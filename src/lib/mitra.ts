// Aplikasi Mitra (driver · merchant · pedagang pasar) — tipe & helper Finpay v3.
// Sumber nama RPC/kolom: docs/finpay-v3/KONTRAK-API-V3.md (§0, §4, §7, §8). Angka uang TIDAK dihitung ulang
// di klien bila server sudah menghitungnya; helper di sini hanya menormalkan bentuk balasan & memformat.
//
// RPC yang dibungkus di sini:
//  - service_economics_public(p_service)                           → persen komisi/fee (bukan konstanta klien)
//  - my_withdrawals()                                              → penarikan + payout_status (§8)
//  - my_disputes() / dispute_open(p_order, p_kind, p_amount, p_description)   (§4)
//  - merchant_campaigns() / merchant_campaign_report(p_id, p_from, p_to)       (§7)
import { useEffect, useState } from 'react';
import { Platform, Share, Alert } from 'react-native';
import { rpc, supabase } from '@/lib/supabase';
import { toCsv } from '@/lib/csv';
import { colors } from '@/lib/theme';
import { rupiah, pctLabel, serviceLabel } from '@/lib/format';
import type { DriverOrderBreakdown, MerchantOrderBreakdown, ServiceEconomicsPublic, ServiceType, WithdrawalRequest } from '@/lib/types';

/* ───────────────────────── Status settlement & payout (§3, §8) ───────────────────────── */

export type SettlementStatus = 'ORDER_COMPLETED' | 'PAYOUT_PENDING' | 'PAYOUT_SETTLED' | 'RECONCILED';
export type PayoutStatus = 'PAYOUT_PENDING' | 'PAYOUT_PROCESSING' | 'PAYOUT_SETTLED' | 'PAYOUT_FAILED';
/** Penanggung biaya (promo / biaya payment gateway). Nilai tak dikenal tetap ditampilkan apa adanya. */
export type FundedBy = 'platform' | 'merchant' | 'sponsor' | 'customer' | 'driver' | (string & {});

export const settlementMeta: Record<SettlementStatus, { label: string; color: string; hint: string }> = {
  ORDER_COMPLETED: { label: 'Selesai', color: colors.info, hint: 'Pesanan selesai; pendapatan sudah tercatat di saldo Anda.' },
  PAYOUT_PENDING: { label: 'Menunggu pencairan', color: colors.warning, hint: 'Pendapatan ini sedang masuk antrean penarikan ke rekening.' },
  PAYOUT_SETTLED: { label: 'Sudah dicairkan', color: colors.success, hint: 'Dana sudah ditransfer ke rekening Anda.' },
  RECONCILED: { label: 'Terekonsiliasi', color: colors.success, hint: 'Sudah dicocokkan dengan laporan bank/penyedia pembayaran.' },
};
export const payoutMeta: Record<PayoutStatus, { label: string; color: string }> = {
  PAYOUT_PENDING: { label: 'Menunggu diproses', color: colors.warning },
  PAYOUT_PROCESSING: { label: 'Sedang ditransfer', color: colors.info },
  PAYOUT_SETTLED: { label: 'Berhasil ditransfer', color: colors.success },
  PAYOUT_FAILED: { label: 'Gagal — saldo dikembalikan', color: colors.danger },
};
export const settlementLabel = (s?: string | null) => (s && settlementMeta[s as SettlementStatus]?.label) || (s ?? 'Belum selesai');
export const payoutLabel = (s?: string | null) => (s && payoutMeta[s as PayoutStatus]?.label) || (s ?? '—');

export const fundedByLabel = (f?: FundedBy | null) =>
  !f ? 'penanggung belum tercatat'
    : ({ platform: 'ditanggung AntarKita', merchant: 'ditanggung merchant', sponsor: 'ditanggung sponsor', customer: 'dibayar pelanggan', driver: 'ditanggung driver' } as Record<string, string>)[f] ?? `ditanggung ${f}`;

/* ───────────────────────── Rincian per order (§8: kolom baru v3) ───────────────────────── */

/**
 * Kolom tambahan v3 pada `driver_order_breakdown` / `merchant_order_breakdown`.
 * Kontrak §8 WAJIB: settlement_status, payout_status, promo_funded_by, pg_fee_funded_by.
 * Opsional (bila server mengirim; bila tidak, klien melengkapinya dari baris `orders` milik mitra):
 * gross_customer, promo, pg_fee, customer_platform_fee.
 */
export interface BreakdownV3Extra {
  settlement_status?: SettlementStatus | null; payout_status?: PayoutStatus | null;
  promo_funded_by?: FundedBy | null; pg_fee_funded_by?: FundedBy | null;
  gross_customer?: number | null; promo?: number | null; pg_fee?: number | null; customer_platform_fee?: number | null;
}
export type DriverBreakdownV3 = DriverOrderBreakdown & BreakdownV3Extra;
export type MerchantBreakdownV3 = MerchantOrderBreakdown & BreakdownV3Extra;

/** Kolom `orders` yang dipakai sebagai cadangan rincian (dibaca `select('*')` agar tahan kolom baru/lama). */
export interface OrderMoneyRow {
  id: string; code: string; service: ServiceType; status: string; total: number; discount: number; platform_fee: number;
  fare_delivery: number; items_subtotal: number; promo_funded_by?: FundedBy | null; pg_fee?: number | null; pg_fee_ppn?: number | null;
  pg_fee_borne_by?: FundedBy | null; settlement_status?: SettlementStatus | null; payment_method: string;
}
export async function loadOrderMoney(orderId: string): Promise<OrderMoneyRow | null> {
  const { data } = await supabase.from('orders').select('*').eq('id', orderId).maybeSingle();
  return (data as OrderMoneyRow | null) ?? null;
}

/* ───────────────────────── Aturan bisnis publik (service_economics_public) ───────────────────────── */

/** `merchant_fee_pct` belum dibuka server v2 (0104) — dibaca bila v3 menambahkannya, tidak pernah ditebak klien. */
export type EconomicsPublicV3 = ServiceEconomicsPublic & { merchant_fee_pct?: number | null };
const econCache = new Map<ServiceType, Promise<EconomicsPublicV3>>();
export function loadEconomics(service: ServiceType): Promise<EconomicsPublicV3> {
  let p = econCache.get(service);
  if (!p) {
    p = rpc<EconomicsPublicV3>('service_economics_public', { p_service: service });
    p.catch(() => econCache.delete(service));
    econCache.set(service, p);
  }
  return p;
}
export function useServiceEconomics(services: ServiceType[]) {
  const key = services.join(',');
  const [data, setData] = useState<Partial<Record<ServiceType, EconomicsPublicV3>>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true;
    const list = key.split(',').filter(Boolean) as ServiceType[];
    setLoading(true);
    Promise.all(list.map((s) => loadEconomics(s).then((e) => [s, e] as const)))
      .then((rows) => { if (live) { setData(Object.fromEntries(rows)); setError(null); } })
      .catch((e: Error) => { if (live) setError(e.message); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [key]);
  return { data, error, loading };
}

/** Layanan pengantaran/belanja driver. Persen diambil dari server; daftar ini hanya urutan tampilan. */
export const DRIVER_SERVICES: ServiceType[] = ['ride_motor', 'ride_car', 'food', 'send', 'shop', 'market', 'box'];

/** "Ongkir AntarFood, AntarSend … 100 % milik Anda. Komisi AntarKita: AntarRide 8 %, AntarCar 15 %." — dari angka server. */
export function driverCommissionText(econ: Partial<Record<ServiceType, EconomicsPublicV3>>): string | null {
  const known = DRIVER_SERVICES.filter((s) => econ[s]);
  if (!known.length) return null;
  const full = known.filter((s) => Number(econ[s]!.driver_commission_pct) === 0);
  const cut = known.filter((s) => Number(econ[s]!.driver_commission_pct) > 0);
  const join = (a: string[]) => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} & ${a[a.length - 1]}`);
  const parts: string[] = [];
  if (full.length) parts.push(`Ongkir ${join(full.map((s) => serviceLabel[s]))} 100 % milik Anda (komisi 0 %).`);
  if (cut.length) parts.push(`Komisi AntarKita hanya dari tarif ${join(cut.map((s) => `${serviceLabel[s]} ${pctLabel(econ[s]!.driver_commission_pct)}`))}.`);
  return parts.join(' ');
}

/* ───────────────────────── Penarikan / payout (§8) ───────────────────────── */

export interface MyWithdrawal extends Omit<WithdrawalRequest, 'status'> {
  status: string; fee?: number | null; provider?: 'manual' | 'finpay' | string | null; provider_ref?: string | null; inquiry_ref?: string | null;
  payout_status?: PayoutStatus | null; failed_reason?: string | null; settled_at?: string | null;
}
/** `my_withdrawals()`; bila RPC belum terpasang (DB lama) jatuh ke tabel `withdrawal_requests` milik sendiri. */
export async function loadMyWithdrawals(uid: string): Promise<{ rows: MyWithdrawal[]; v3: boolean }> {
  try {
    const d = await rpc<MyWithdrawal[] | { withdrawals: MyWithdrawal[] }>('my_withdrawals');
    return { rows: Array.isArray(d) ? d : d?.withdrawals ?? [], v3: true };
  } catch {
    const { data } = await supabase.from('withdrawal_requests').select('*').eq('user_id', uid).order('created_at', { ascending: false }).limit(20);
    return { rows: (data as MyWithdrawal[]) ?? [], v3: false };
  }
}
/** Status payout efektif: kolom v3 bila ada, kalau tidak dipetakan dari status lama (pending/approved/rejected). */
export const payoutOf = (w: MyWithdrawal): PayoutStatus =>
  w.payout_status ?? (w.status === 'approved' ? 'PAYOUT_SETTLED' : w.status === 'rejected' ? 'PAYOUT_FAILED' : 'PAYOUT_PENDING');

/* ───────────────────────── Selisih & dispute (§4) ───────────────────────── */

export type DisputeKind = 'amount_mismatch' | 'payout_missing' | 'other';
export type DisputeStatus = 'open' | 'investigating' | 'resolved_refund' | 'resolved_no_refund' | 'closed';
export const disputeKindLabel: Record<string, string> = {
  amount_mismatch: 'Nominal tidak sesuai', payout_missing: 'Pencairan belum masuk', other: 'Lainnya',
  not_received: 'Dana tidak diterima', chargeback: 'Chargeback',
};
export const disputeStatusMeta: Record<DisputeStatus, { label: string; color: string }> = {
  open: { label: 'Dibuka', color: colors.warning },
  investigating: { label: 'Sedang diperiksa', color: colors.info },
  resolved_refund: { label: 'Selesai — ada penyesuaian', color: colors.success },
  resolved_no_refund: { label: 'Selesai — tanpa penyesuaian', color: colors.textSecondary },
  closed: { label: 'Ditutup', color: colors.textMuted },
};
export interface MyDispute {
  id: string; order_id: string | null; order_code?: string | null; payment_id?: string | null; party_role?: string | null;
  kind: string; amount: number | null; description: string | null; status: DisputeStatus | string; resolution?: string | null;
  created_at: string; resolved_at?: string | null;
}
export async function loadMyDisputes(): Promise<MyDispute[]> {
  const d = await rpc<MyDispute[] | { disputes: MyDispute[] }>('my_disputes');
  return Array.isArray(d) ? d : d?.disputes ?? [];
}
export function openDispute(p: { orderId: string; kind: DisputeKind; amount: number | null; description: string }) {
  return rpc<unknown>('dispute_open', { p_order: p.orderId, p_kind: p.kind, p_amount: p.amount, p_description: p.description });
}

/* ───────────────────────── Iklan v3 — kampanye (§7) ───────────────────────── */

export type AdPricingModel = 'flat' | 'cpc' | 'cpm' | 'cpa';
export interface AdProductV3 {
  code: string; name: string; description: string | null; placement: string; active: boolean;
  /** v2 (0101): unit & price. v3: pricing_model & unit_price. */
  unit?: 'per_day' | 'per_week' | 'per_order' | string; price?: number;
  pricing_model?: AdPricingModel | null; unit_price?: number | null;
  min_budget?: number | null; min_days?: number | null; max_days?: number | null; requires_approval?: boolean | null; label?: string | null;
}
/** Nama penempatan (kode produk seed §7 + penempatan v2). Kode baru dari admin jatuh ke nama produk. */
export const placementLabel: Record<string, string> = {
  featured_home: 'Unggulan di beranda', boost_nearby: 'Teratas di merchant terdekat', search_top: 'Teratas di hasil pencarian',
  banner_home: 'Banner beranda', banner_category: 'Banner kategori', radius_promo: 'Promo dalam radius',
  sponsored_voucher: 'Voucher bersponsor', post_checkout_cross: 'Rekomendasi setelah checkout',
};
export const pricingModelLabel: Record<AdPricingModel, string> ={ flat: 'Harga tetap', cpc: 'Bayar per klik (CPC)', cpm: 'Bayar per 1.000 tayangan (CPM)', cpa: 'Bayar per transaksi (CPA)' };
export const productModel = (p: AdProductV3): AdPricingModel => p.pricing_model ?? 'flat';
export const productUnitPrice = (p: AdProductV3) => Number(p.unit_price ?? p.price ?? 0);
/** "Rp500 / klik", "Rp15.000 / 1.000 tayangan", "Rp25.000 / hari", "5 % dari nilai pesanan". */
export function productPriceText(p: AdProductV3): string {
  const u = productUnitPrice(p);
  switch (productModel(p)) {
    case 'cpc': return `${rupiah(u)} / klik`;
    case 'cpm': return `${rupiah(u)} / 1.000 tayangan`;
    // Kontrak §7: sponsored_voucher "5 % dari nilai order" disimpan di unit_price (bigint) — nilai kecil dibaca sebagai persen.
    // 0109: cpa memakai kolom `unit_pct` (persen dari nilai pesanan); unit_price hanya cadangan.
    case 'cpa': { const pct = Number((p as { unit_pct?: number | null }).unit_pct ?? 0);
      return pct > 0 ? `${pctLabel(pct)} dari nilai pesanan` : u > 0 && u <= 100 ? `${pctLabel(u)} dari nilai pesanan` : `${rupiah(u)} / transaksi`; }
    default: return `${rupiah(u)}${p.unit === 'per_week' ? ' / minggu' : p.unit === 'per_order' ? ' / pesanan' : ' / hari'}`;
  }
}

export type CampaignStatus = 'draft' | 'pending_review' | 'approved' | 'rejected' | 'active' | 'paused' | 'ended' | 'budget_exhausted' | 'cancelled' | 'expired';
export const campaignStatusMeta: Record<CampaignStatus, { label: string; color: string }> = {
  draft: { label: 'Draf', color: colors.textMuted },
  pending_review: { label: 'Menunggu tinjauan', color: colors.warning },
  approved: { label: 'Disetujui', color: colors.info },
  rejected: { label: 'Ditolak', color: colors.danger },
  active: { label: 'Tayang', color: colors.success },
  paused: { label: 'Dijeda', color: colors.warning },
  ended: { label: 'Selesai', color: colors.textSecondary },
  budget_exhausted: { label: 'Budget habis', color: colors.danger },
  cancelled: { label: 'Dihentikan', color: colors.textMuted },
  expired: { label: 'Kedaluwarsa', color: colors.textMuted },
};
export const campaignStatusOf = (s: string) => campaignStatusMeta[s as CampaignStatus] ?? { label: s, color: colors.textMuted };
export const CAMPAIGN_RUNNING: CampaignStatus[] = ['draft', 'pending_review', 'approved', 'active', 'paused', 'budget_exhausted'];
export type CampaignAction = 'pause' | 'resume' | 'stop' | 'topup';
export function campaignActions(status: string, pausedBy?: string | null): CampaignAction[] {
  switch (status) {
    case 'active': return ['pause', 'topup', 'stop'];
    case 'paused': return pausedBy && pausedBy !== 'merchant' ? ['topup', 'stop'] : ['resume', 'topup', 'stop'];
    case 'budget_exhausted': return ['topup', 'stop'];
    case 'pending_review': case 'approved': case 'draft': return ['stop'];
    default: return [];
  }
}
export const campaignActionLabel: Record<CampaignAction, string> = { pause: 'Jeda', resume: 'Lanjutkan', stop: 'Hentikan', topup: 'Tambah budget' };

export interface CampaignCreative { headline?: string | null; image_url?: string | null; cta?: string | null }
export interface Campaign {
  id: string; merchant_id: string; product_code: string; product_name?: string | null; pricing_model?: AdPricingModel | null; label?: string | null;
  name: string | null; budget: number; spent: number; radius_km: number | null; category?: string | null; creative: CampaignCreative | null;
  status: CampaignStatus | string; review_note?: string | null; paused_by?: string | null;
  starts_at?: string | null; ends_at?: string | null; created_at: string;
  impressions: number; clicks: number; conversions: number; conversion_value: number;
  ctr?: number | null; roas?: number | null;
}
export async function loadCampaigns(): Promise<Campaign[]> {
  const d = await rpc<Campaign[] | { campaigns: Campaign[] }>('merchant_campaigns');
  return Array.isArray(d) ? d : d?.campaigns ?? [];
}
export function campaignSet(id: string, action: CampaignAction, amount?: number | null) {
  return rpc<unknown>('merchant_campaign_set', { p_id: id, p_action: action, p_amount: amount ?? null });
}

export interface CampaignReportRow { day: string; impressions: number; clicks: number; ctr: number; conversions: number; conversion_value: number; spent: number; roas: number | null }
type RawReportRow = Partial<CampaignReportRow> & { date?: string };
/** Normalisasi `merchant_campaign_report`: array harian, atau `{rows|daily: [...]}`. CTR/ROAS dihitung ulang bila kosong. */
export async function loadCampaignReport(id: string, from: string, to: string): Promise<CampaignReportRow[]> {
  const d = await rpc<RawReportRow[] | { rows?: RawReportRow[]; daily?: RawReportRow[] }>('merchant_campaign_report', { p_id: id, p_from: from, p_to: to });
  const raw = Array.isArray(d) ? d : d?.rows ?? d?.daily ?? [];
  return raw.map((r) => {
    const impressions = Number(r.impressions ?? 0), clicks = Number(r.clicks ?? 0), spent = Number(r.spent ?? 0), value = Number(r.conversion_value ?? 0);
    return {
      day: String(r.day ?? r.date ?? ''), impressions, clicks, spent, conversions: Number(r.conversions ?? 0), conversion_value: value,
      ctr: r.ctr != null ? Number(r.ctr) : impressions ? (clicks / impressions) * 100 : 0,
      roas: r.roas != null ? Number(r.roas) : spent ? value / spent : null,
    };
  }).sort((a, b) => a.day.localeCompare(b.day));
}
export function sumReport(rows: CampaignReportRow[]) {
  const t = rows.reduce((a, r) => ({ impressions: a.impressions + r.impressions, clicks: a.clicks + r.clicks, conversions: a.conversions + r.conversions, conversion_value: a.conversion_value + r.conversion_value, spent: a.spent + r.spent }),
    { impressions: 0, clicks: 0, conversions: 0, conversion_value: 0, spent: 0 });
  return { ...t, ctr: t.impressions ? (t.clicks / t.impressions) * 100 : 0, roas: t.spent ? t.conversion_value / t.spent : null };
}
/** CTR dalam persen (2,5 = 2,5 %) — kontrak §7 memakai konvensi persen = numeric. */
export const ctrText = (ctr: number | null | undefined) => `${(Number(ctr) || 0).toLocaleString('id-ID', { maximumFractionDigits: 2 })} %`;
export const roasText = (roas: number | null | undefined) => (roas == null ? '—' : `${roas.toLocaleString('id-ID', { maximumFractionDigits: 2 })}×`);
export const numberId = (n: number | null | undefined) => (Number(n) || 0).toLocaleString('id-ID');

/* ───────────────────────── Periode laporan & ekspor CSV ───────────────────────── */

export type PeriodKey = 'today' | '7d' | 'month';
export const PERIODS: { key: PeriodKey; label: string }[] = [{ key: 'today', label: 'Hari ini' }, { key: '7d', label: '7 hari' }, { key: 'month', label: 'Bulan ini' }];
export function periodRange(k: PeriodKey, now = new Date()): { from: Date; to: Date } {
  const from = new Date(now);
  if (k === 'today') from.setHours(0, 0, 0, 0);
  else if (k === '7d') { from.setDate(from.getDate() - 6); from.setHours(0, 0, 0, 0); }
  else { from.setDate(1); from.setHours(0, 0, 0, 0); }
  return { from, to: now };
}
/** YYYY-MM-DD menurut jam lokal perangkat (dipakai sebagai parameter `date`). */
export const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Ekspor CSV untuk mitra (bukan admin — tidak memanggil admin_log_event).
 * Web: unduh berkas. Native: lembar bagikan dengan isi CSV (bisa disimpan ke Drive/Files/WhatsApp).
 */
export async function exportMitraCsv(filename: string, headers: string[], rows: unknown[][]): Promise<void> {
  if (!rows.length) throw new Error('Tidak ada data untuk diekspor pada periode ini');
  const csv = toCsv(headers, rows);
  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return;
  }
  await Share.share({ title: filename, message: csv });
}

/** Konfirmasi lintas platform (web: window.confirm; native: Alert). */
export function confirmAsync(title: string, message: string, okText = 'Ya, lanjutkan'): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(typeof window !== 'undefined' ? window.confirm(`${title}\n\n${message}`) : false);
  return new Promise((resolve) => Alert.alert(title, message, [{ text: 'Batal', style: 'cancel', onPress: () => resolve(false) }, { text: okText, onPress: () => resolve(true) }], { cancelable: true, onDismiss: () => resolve(false) }));
}

/** Hanya angka → number (input nominal). */
export const parseAmount = (v: string) => Number(v.replace(/\D/g, '')) || 0;
