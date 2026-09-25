// Pembayaran v3 (KONTRAK-API-V3 §0.4, §1–§4, §9) — satu tempat untuk semua logika uang di sisi Pelanggan:
//  • rincian checkout yang seragam (buildCheckoutRows) — semua angka dari server, TIDAK ada tarif/fee di TS;
//  • provider & kanal aktif dari `payment_provider_public()` — nama provider (Midtrans/Finpay/…) dari server;
//  • pembuatan tagihan lewat edge `pay-create` (bukan `midtrans-create`), idempoten per pesanan di server;
//  • status real-time `my_payment_status` (polling 5 dtk + realtime `payments` + AppState);
//  • bukti transaksi, riwayat, refund & sengketa.
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Platform } from 'react-native';
import { supabase, rpc, friendlyError, realtimeChannel } from './supabase';
import { rupiah, pctLabel, promoOwnerLabel, ONGKIR_FULL_DRIVER } from './format';
import type {
  ServiceType, ServiceEconomicsPublic, PromoFunder, PayProvider, ProviderPublic, ProviderChannel, PgFeeEstimate,
  PayCreateResult, MyPaymentStatus, PayStatus, PaymentHistoryRow, Receipt, RefundPolicy, DisputeKind, DisputeRow, OrderPaymentPrepareV3,
} from './types';

/* ───────────── Provider & kanal ───────────── */

/** Nama tampil provider. Satu-satunya peta nama provider di aplikasi — layar tidak boleh menulis nama provider sendiri. */
const PROVIDER_NAMES: Record<string, string> = { midtrans: 'Midtrans', finpay: 'Finpay', simulated: 'Simulasi' };
export function providerLabel(p?: PayProvider | null): string {
  if (!p) return 'payment gateway';
  return PROVIDER_NAMES[p] ?? p.charAt(0).toUpperCase() + p.slice(1);
}

const PROVIDER_TTL_MS = 5 * 60 * 1000;
let providerCache: { at: number; p: Promise<ProviderPublic> } | null = null;
/** `payment_provider_public()` (anon). Di-cache 5 menit per sesi; `force` memuat ulang (mis. setelah galat). */
export function fetchProviderPublic(force = false): Promise<ProviderPublic> {
  if (!force && providerCache && Date.now() - providerCache.at < PROVIDER_TTL_MS) return providerCache.p;
  const p = rpc<ProviderPublic>('payment_provider_public').then((d) => ({
    provider: d?.provider ?? '', provider_label: d?.provider_label ?? null, env: d?.env ?? 'sandbox', simulation: !!d?.simulation,
    channels: Array.isArray(d?.channels) ? d.channels.map((c) => ({ ...c, fee_pct: Number(c.fee_pct) || 0, fee_fixed: Number(c.fee_fixed) || 0, pass_to_customer: !!c.pass_to_customer, enabled: !!c.enabled })) : [],
  }));
  providerCache = { at: Date.now(), p };
  p.catch(() => { if (providerCache?.p === p) providerCache = null; });
  return p;
}

/** Hook provider aktif + kanal yang `enabled`. `error` diisi bila RPC gagal (UI boleh jatuh ke daftar kanal lama). */
export function useProviderPublic() {
  const [data, setData] = useState<ProviderPublic | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    fetchProviderPublic(tick > 0).then((d) => { if (live) { setData(d); setError(null); } }, (e: Error) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [tick]);
  const channels = (data?.channels ?? []).filter((c) => c.enabled);
  return { provider: data, channels, providerName: data ? data.provider_label || providerLabel(data.provider) : null, error, reload: () => setTick((n) => n + 1) };
}

/** Estimasi biaya satu kanal (dari fee_pct/fee_fixed server) — hanya untuk label kanal, bukan angka tagihan. */
export function channelFeeEstimate(ch: Pick<ProviderChannel, 'fee_pct' | 'fee_fixed'>, amount: number): number {
  return Math.max(0, Math.round((Math.max(0, amount) * (Number(ch.fee_pct) || 0)) / 100) + (Number(ch.fee_fixed) || 0));
}
/** Label biaya per kanal: "+Rp3.500" bila biaya dibebankan ke pelanggan, selain itu "gratis". */
export function channelFeeText(ch: ProviderChannel, amount: number): string {
  if (!ch.pass_to_customer) return 'gratis';
  if (amount > 0) { const f = channelFeeEstimate(ch, amount); return f > 0 ? `+${rupiah(f)}` : 'gratis'; }
  return ch.fee_label ? `+${ch.fee_label}` : 'biaya tampil saat bayar';
}

/** `pg_fee_estimate(service, channel, amount)` — `amount` = total SEBELUM biaya pembayaran. */
export async function estimatePgFee(service: ServiceType, channel: string, amount: number): Promise<PgFeeEstimate> {
  return rpc<PgFeeEstimate>('pg_fee_estimate', { p_service: service, p_channel: channel, p_amount: Math.max(0, Math.round(amount)) });
}

/* ───────────── Rincian checkout (§0.4) ───────────── */

export type PriceRow = { label: string; value: number; minus?: boolean; hint?: string | null; estimate?: boolean; keep?: boolean };

/** Biaya metode pembayaran untuk rincian checkout. `fee` = bagian yang DITAMBAHKAN ke total pelanggan. */
export type PayFeeEstimate = {
  kind: 'gateway' | 'cash' | 'wallet';
  channel: string | null; label: string;
  provider: PayProvider | null; providerName: string | null;
  /** 'customer' = dibebankan ke pelanggan; 'platform' = ditanggung AntarKita; 'unknown' = belum bisa dihitung. */
  policy: 'customer' | 'platform' | 'unknown';
  fee: number; error: string | null;
};

export interface CheckoutRowsInput {
  service: ServiceType; econ?: ServiceEconomicsPublic | null;
  /** Harga barang/makanan (null = layanan tanpa barang, mis. ride). */
  items?: number | null; itemsLabel?: string; itemsHint?: string | null;
  ongkir: number; ongkirLabel?: string; ongkirHint?: string | null;
  /** Komponen ongkir tambahan (mis. ongkir antar kota) — ditaruh tepat setelah ongkir. */
  ongkirExtra?: PriceRow[];
  /** Jasa belanja (shop/market) — dibagi driver & platform sesuai aturan server. */
  serviceFee?: number;
  platformFee: number;
  pay?: PayFeeEstimate | null;
  /** Biaya tambahan: tip, pembantu angkat, parkir/tol, dll. */
  extra?: PriceRow[];
  discount: number; promoCode?: string | null; promoFunder?: PromoFunder | null; hasMerchant?: boolean;
  /** Subsidi selain kode promo (mis. subsidi ongkir) + penanggungnya. */
  subsidy?: { label: string; value: number; funder?: PromoFunder | null } | null;
  /** Pajak — baris hanya muncul bila > 0. */
  tax?: number | null;
}

/** Keterangan ongkir: 100 % untuk driver (komisi 0 di server) atau komisi platform x % (ride). */
function ongkirHintOf(service: ServiceType, econ?: ServiceEconomicsPublic | null): string | null {
  const comm = econ?.driver_commission_pct;
  if (comm == null) return ONGKIR_FULL_DRIVER.includes(service) ? '100 % untuk driver' : null;
  if (Number(comm) === 0) return '100 % untuk driver — platform tidak memotong ongkir';
  return `Tarif untuk driver · komisi platform ${pctLabel(comm)}`;
}

/** Baris "Biaya metode pembayaran (<Provider>)" — Rp0 + "ditanggung AntarKita" bila tidak dibebankan ke pelanggan. */
export function paymentFeeRow(pay: PayFeeEstimate): PriceRow {
  if (pay.kind !== 'gateway') return { label: `Biaya metode pembayaran (${pay.label})`, value: 0, keep: true, hint: 'Tanpa biaya metode pembayaran' };
  const name = pay.providerName ?? providerLabel(pay.provider);
  if (pay.policy === 'customer') return { label: `Biaya metode pembayaran (${name})`, value: pay.fee, keep: true, estimate: true, hint: `${pay.label} · nilai final tampil di halaman bayar` };
  if (pay.policy === 'platform') return { label: `Biaya metode pembayaran (${name})`, value: 0, keep: true, hint: `${pay.label} · ditanggung AntarKita` };
  return { label: `Biaya metode pembayaran (${name})`, value: 0, keep: true, hint: pay.error ?? `${pay.label} · bila ada biaya, ditampilkan di halaman bayar sebelum Anda membayar` };
}

/**
 * Rincian checkout seragam untuk semua layanan (§0.4): harga barang · ongkir · jasa belanja · biaya platform AntarKita ·
 * biaya metode pembayaran (provider aktif) · biaya tambahan · diskon/subsidi (+ penanggung) · pajak (bila > 0).
 * Total dihitung pemanggil dari angka server yang sama (lihat layar layanan).
 */
export function buildCheckoutRows(p: CheckoutRowsInput): PriceRow[] {
  const rows: PriceRow[] = [];
  if (p.items != null) rows.push({ label: p.itemsLabel ?? 'Harga barang', value: p.items, keep: true, hint: p.itemsHint ?? null });
  rows.push({ label: p.ongkirLabel ?? 'Ongkir', value: p.ongkir, keep: true, hint: p.ongkirHint !== undefined ? p.ongkirHint : ongkirHintOf(p.service, p.econ) });
  if (p.ongkirExtra) rows.push(...p.ongkirExtra);
  if (p.serviceFee) rows.push({ label: 'Jasa belanja', value: p.serviceFee, hint: 'Jasa belanja oleh driver (dibagi driver & platform)' });
  rows.push({ label: 'Biaya platform AntarKita', value: p.platformFee, keep: true, hint: 'Biaya aplikasi, terpisah dari ongkir' });
  if (p.pay) rows.push(paymentFeeRow(p.pay));
  if (p.extra) rows.push(...p.extra);
  if (p.discount > 0) {
    // create_order: promo "merchant" tanpa merchant (ride/send/…) otomatis ditanggung platform
    const funder: PromoFunder | null = p.promoFunder === 'merchant' && !p.hasMerchant ? 'platform' : p.promoFunder ?? null;
    rows.push({ label: `Diskon promo${p.promoCode ? ` (${p.promoCode})` : ''}`, value: p.discount, minus: true, hint: funder ? promoOwnerLabel[funder] : null });
  }
  if (p.subsidy && p.subsidy.value > 0) rows.push({ label: p.subsidy.label, value: p.subsidy.value, minus: true, hint: p.subsidy.funder ? promoOwnerLabel[p.subsidy.funder].replace('Promo', 'Subsidi') : null });
  if ((p.tax ?? 0) > 0) rows.push({ label: 'Pajak', value: p.tax ?? 0 });
  return rows;
}

/** Keterangan di bawah rincian checkout. */
export function checkoutNoteText(pay: PayFeeEstimate | null | undefined, econError?: string | null): string | null {
  if (econError) return `Aturan biaya layanan belum termuat (${econError}). Total final dihitung server saat memesan.`;
  if (!pay || pay.kind !== 'gateway') return null;
  const name = pay.providerName ?? providerLabel(pay.provider);
  if (pay.error) return pay.error;
  if (pay.policy === 'customer') return `Dibayar per pesanan lewat ${name} (${pay.label}). Halaman bayar terbuka setelah Anda menekan Pesan.`;
  if (pay.policy === 'platform') return `Dibayar per pesanan lewat ${name} (${pay.label}). Biaya metode pembayaran ditanggung AntarKita.`;
  return `Dibayar per pesanan lewat ${name} (${pay.label}). Bila ada biaya, nilainya ditampilkan di halaman bayar sebelum Anda membayar.`;
}

/* ───────────── Tagihan (edge pay-create) ───────────── */

export const PAY_TIMEOUT_TEXT = 'Server pembayaran tidak merespons. Coba lagi — tagihan tidak akan dibuat dua kali.';
export class PaymentTimeoutError extends Error { constructor() { super(PAY_TIMEOUT_TEXT); this.name = 'PaymentTimeoutError'; } }

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new PaymentTimeoutError()), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

/** Pesan galat edge function: badan JSON `{error|message}` bila ada, selain itu pesan ramah. */
async function edgeErrorText(error: unknown, data: { error?: string; message?: string } | null | undefined): Promise<string> {
  if (data?.error) return friendlyError(data.message ?? data.error);
  const ctx = (error as { context?: { json?: () => Promise<unknown> } } | null)?.context;
  if (ctx && typeof ctx.json === 'function') {
    try { const b = (await ctx.json()) as { error?: string; message?: string } | null; if (b?.error || b?.message) return friendlyError(b.message ?? b.error ?? ''); } catch { /* badan bukan JSON */ }
  }
  return friendlyError((error as Error | null)?.message ?? 'Tagihan pembayaran gagal dibuat');
}

export type CreatePaymentBody = { purpose: 'order' | 'topup'; order_id?: string; amount?: number; channel: string };
/**
 * Buat (atau ambil ulang) tagihan lewat edge `pay-create`. Server idempoten per pesanan: bila masih ada intent
 * PENDING yang belum kedaluwarsa, yang dikembalikan intent yang SAMA (pemanggil membandingkan `payment_id`).
 */
export async function createPayment(body: CreatePaymentBody, timeoutMs = 25000): Promise<PayCreateResult> {
  const res = await withTimeout(supabase.functions.invoke<PayCreateResult>('pay-create', { body }), timeoutMs);
  if (res.error || !res.data || res.data.error) throw new Error(await edgeErrorText(res.error, res.data));
  return res.data;
}

/** Simulasi (hanya provider `simulated` + `payments_simulation_enabled` + env sandbox — server yang memutuskan). */
export async function simulatePayment(externalId: string, ok: boolean): Promise<void> {
  const { data, error } = await supabase.functions.invoke<{ ok?: boolean; error?: string; message?: string }>('pay-webhook/simulated', { body: { external_id: externalId, status: ok ? 'PAID' : 'FAILED' } });
  if (error || data?.error) throw new Error(await edgeErrorText(error, data));
}

/** `order_payment_prepare(p_order, p_channel)` — rincian & biaya final pesanan untuk kanal terpilih. */
export const prepareOrderPayment = (orderId: string, channel: string | null) =>
  rpc<OrderPaymentPrepareV3>('order_payment_prepare', { p_order: orderId, p_channel: channel });

/** Buka halaman pembayaran provider: web → tab baru (fallback redirect), native → aplikasi/peramban sistem. */
export function openCheckout(url: string) {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const w = window.open(url, '_blank', 'noopener');
    if (!w) window.location.href = url;
    return;
  }
  Linking.openURL(url).catch(() => { /* tidak ada aplikasi yang bisa membuka URL */ });
}

/* ───────────── Status real-time ───────────── */

export const FINAL_PAY: PayStatus[] = ['PAID', 'FAILED', 'EXPIRED', 'REFUNDED', 'RECONCILED'];
export const isPaidLike = (s?: PayStatus | null) => s === 'PAID' || s === 'RECONCILED' || s === 'REFUND_REQUESTED' || s === 'PARTIALLY_REFUNDED' || s === 'REFUNDED' || s === 'DISPUTED';

export const fetchPaymentStatus = async (orderId: string) => {
  const d = await rpc<MyPaymentStatus | MyPaymentStatus[] | null>('my_payment_status', { p_order: orderId });
  const row = Array.isArray(d) ? d[0] ?? null : d;
  return row && row.pay_status ? row : null;
};

/**
 * Status pembayaran satu pesanan: `my_payment_status` tiap `intervalMs` (default 5 dtk) + realtime tabel `payments`
 * (topik unik lewat realtimeChannel — lihat bug postgres_changes) + muat ulang saat aplikasi kembali aktif.
 * `stopOnFinal`: polling berhenti setelah status final / bila tidak ada tagihan (realtime & AppState tetap memperbarui).
 */
export function usePaymentStatus(orderId: string | null | undefined, opts: { enabled?: boolean; intervalMs?: number; stopOnFinal?: boolean } = {}) {
  const enabled = opts.enabled ?? true;
  const intervalMs = opts.intervalMs ?? 5000;
  const stopOnFinal = opts.stopOnFinal ?? false;
  const [status, setStatus] = useState<MyPaymentStatus | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failStreak, setFailStreak] = useState(0);
  const cur = useRef<MyPaymentStatus | null>(null);
  const once = useRef(false);
  const refresh = useCallback(async () => {
    if (!orderId) return null;
    try {
      const s = await fetchPaymentStatus(orderId);
      cur.current = s; once.current = true; setStatus(s); setError(null); setFailStreak(0); setLoaded(true);
      return s;
    } catch (e) { setError((e as Error).message); setFailStreak((n) => n + 1); setLoaded(true); return cur.current; }
  }, [orderId]);
  useEffect(() => {
    if (!orderId || !enabled) return;
    refresh();
    // stopOnFinal: berhenti bila status final, atau bila memang tidak ada tagihan (tunai/AntarVoucher) — realtime & AppState tetap jalan.
    const t = setInterval(() => { if (stopOnFinal && once.current && (!cur.current || FINAL_PAY.includes(cur.current.pay_status))) return; refresh(); }, intervalMs);
    const ch = realtimeChannel(`pay-${orderId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments', filter: `order_id=eq.${orderId}` }, () => { refresh(); })
      .subscribe();
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') refresh(); });
    return () => { clearInterval(t); supabase.removeChannel(ch); sub.remove(); };
  }, [orderId, enabled, intervalMs, stopOnFinal, refresh]);
  return { status, loaded, error, failStreak, refresh };
}

/* ───────────── Bukti, riwayat, refund, sengketa ───────────── */

export const fetchReceipt = (orderId: string) => rpc<Receipt>('my_receipt', { p_order: orderId });
export const fetchPaymentHistory = (limit = 50) => rpc<PaymentHistoryRow[]>('my_payment_history', { p_limit: limit }).then((d) => d ?? []);
export const fetchRefundPolicy = (orderId: string) => rpc<RefundPolicy>('refund_policy_calc', { p_order: orderId });
/** `amount` null = pengembalian penuh atas komponen yang bisa dikembalikan. */
export const REFUND_OPEN_TEXT = 'Pengajuan pengembalian dana untuk pesanan ini masih diproses. Tunggu hasilnya sebelum mengajukan lagi — statusnya tampil di detail pesanan.';
export const DISPUTE_OPEN_TEXT = 'Anda sudah punya laporan masalah pembayaran yang masih terbuka untuk pesanan ini. Pantau perkembangannya di Pusat Bantuan.';
/**
 * RPC dengan kode galat bisnis yang harus diterjemahkan SEBELUM friendlyError (yang memangkas awalan "KODE: …").
 * `codes`: kode server → pesan ramah.
 */
async function rpcCoded<T>(fn: string, params: Record<string, unknown>, codes: Record<string, string>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, params as never);
  if (error) {
    const raw = [error.message, (error as { details?: string }).details, (error as { hint?: string }).hint, (error as { code?: string }).code].filter(Boolean).join(' ');
    const hit = Object.keys(codes).find((c) => raw.includes(c));
    throw new Error(hit ? codes[hit] : friendlyError(error.message));
  }
  return data as T;
}
export const requestRefund = (orderId: string, reason: string, amount: number | null = null) =>
  rpcCoded<unknown>('refund_request', { p_order: orderId, p_amount: amount, p_reason: reason }, { REFUND_OPEN: REFUND_OPEN_TEXT });
export const openDispute = (orderId: string, kind: DisputeKind, amount: number | null, description: string) =>
  rpcCoded<unknown>('dispute_open', { p_order: orderId, p_kind: kind, p_amount: amount, p_description: description }, { DISPUTE_OPEN: DISPUTE_OPEN_TEXT });
export const fetchMyDisputes = () => rpc<DisputeRow[]>('my_disputes').then((d) => d ?? []);

/** Baris bukti transaksi: `lines` dari server bila ada; bila tidak, disusun dari kolom datar `my_receipt` dengan urutan §0.4. */
export function receiptRows(r: Receipt, providerName?: string | null): PriceRow[] {
  if (Array.isArray(r.lines) && r.lines.length) {
    return r.lines
      .filter((l) => !(l.key === 'tax' && !(Number(l.amount) > 0)))   // pajak: baris hanya bila > 0
      .map((l) => ({ label: l.label, value: Math.abs(Number(l.amount) || 0), minus: !!l.minus || Number(l.amount) < 0, hint: l.hint ?? l.note ?? null, keep: true }));
  }
  const rows: PriceRow[] = [];
  if (r.items_subtotal) rows.push({ label: 'Harga barang', value: r.items_subtotal, keep: true });
  rows.push({ label: 'Ongkir', value: r.delivery_fee ?? 0, keep: true, hint: r.driver_share_note ?? null });
  if (r.intercity_fare) rows.push({ label: 'Ongkir antar kota', value: r.intercity_fare });
  if (r.service_fee) rows.push({ label: 'Jasa belanja', value: r.service_fee });
  rows.push({ label: 'Biaya platform AntarKita', value: r.platform_fee ?? 0, keep: true });
  const pg = r.pg_fee_customer ?? 0;
  rows.push({ label: `Biaya metode pembayaran (${providerName ?? providerLabel(r.provider)})`, value: pg, keep: true, hint: pg === 0 && r.provider ? 'Ditanggung AntarKita' : null });
  if (r.helpers_fee) rows.push({ label: 'Pembantu angkat', value: r.helpers_fee });
  if (r.extras) rows.push({ label: 'Biaya tambahan (parkir/tol/tunggu)', value: r.extras });
  if (r.tip) rows.push({ label: 'Tip driver', value: r.tip });
  if (r.discount) rows.push({ label: `Diskon promo${r.promo_code ? ` (${r.promo_code})` : ''}`, value: r.discount, minus: true, hint: r.promo_funded_by ? promoOwnerLabel[r.promo_funded_by] : null });
  if ((r.tax ?? 0) > 0) rows.push({ label: 'Pajak', value: r.tax ?? 0 });
  return rows;
}
