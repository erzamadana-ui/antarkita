// Panel Admin v3 (branch finpay-v3) — tipe & helper klien untuk kontrak docs/finpay-v3/KONTRAK-API-V3.md.
// File ini milik Agen E (Panel Admin). JANGAN menaruh tipe admin di `types.ts` (milik Agen C).
//
// Isi:
//  • Tipe hasil RPC admin v3 (fee per provider, secret gateway, refund, dispute, approval, rekonsiliasi,
//    contribution margin, iklan/kampanye, payout).
//  • RBAC: `useAdminRole` (cache `my_admin_role()`), `adminCan(perm)`, matriks cadangan per peran (§5).
//  • Helper: `invokeEdge` (edge function + pesan galat yang terbaca), `rpcList`/`rpcOr` (fallback bila RPC
//    belum ada), `maskSecret` (kunci tidak pernah tampil penuh), `webhookUrl`, label sumber angka.
import { create } from 'zustand';
import { rpc, supabase, friendlyError } from '@/lib/supabase';
import { toast } from '@/components/ui';
import { handleAdminError } from '@/store/adminSecurity';

/* ───────────────────────────── RBAC (§5) ───────────────────────────── */

export type AdminRole = 'superadmin' | 'finance' | 'ops' | 'cs' | 'viewer';
/**
 * Nama izin yang dipakai UI untuk menyembunyikan menu/aksi. Server tetap penentu akhir (`admin_require`).
 * Bila `my_admin_role().perms` memakai nama lain, cukup sesuaikan daftar ini.
 */
export type AdminPerm =
  // nama UI (dipetakan ke nama server lewat SERVER_PERM_ALIAS)
  | 'audit' | 'settings' | 'gateway' | 'approvals' | 'refund_approve' | 'ads_review' | 'ads_product' | 'ops' | 'tickets'
  // nama server (admin_role_perms, migrasi 0107)
  | 'view' | 'orders_view' | 'payments_view' | 'ledger' | 'report' | 'refund' | 'refund_execute' | 'payout' | 'reconcile' | 'fee'
  | 'wallet_adjust' | 'approval' | 'dispute' | 'dispute_resolve' | 'ticket' | 'driver' | 'merchant' | 'city' | 'orders' | 'ads'
  | 'pricing' | 'promo' | 'gateway_secret' | 'payment_config' | 'admin_role';

export const ADMIN_ROLES: { value: AdminRole; label: string; desc: string }[] = [
  { value: 'superadmin', label: 'Superadmin', desc: 'Semua izin, termasuk mengatur peran admin & rahasia gateway' },
  { value: 'finance', label: 'Keuangan', desc: 'Refund, payout, rekonsiliasi, fee (maker), buku besar, laporan' },
  { value: 'ops', label: 'Operasional', desc: 'Driver/merchant/kota/order, review iklan, tarif (maker)' },
  { value: 'cs', label: 'Customer service', desc: 'Tiket, dispute (buka/investigasi), lihat order & pembayaran — tanpa uang' },
  { value: 'viewer', label: 'Pemantau', desc: 'Baca saja' },
];
export const adminRoleLabel = (r?: string | null) => ADMIN_ROLES.find((x) => x.value === r)?.label ?? (r || '—');

/**
 * Matriks cadangan (dipakai bila server mengirim `role` tanpa `perms`) — SAMA PERSIS dengan `admin_role_perms()` (0107).
 * Nama izin server; izin UI dipetakan lewat SERVER_PERM_ALIAS.
 */
export const ROLE_PERMS: Record<AdminRole, string[]> = {
  superadmin: ['*'],
  finance: ['view', 'orders_view', 'payments_view', 'ledger', 'report', 'refund', 'refund_execute', 'payout', 'reconcile', 'fee', 'wallet_adjust', 'approval', 'dispute', 'dispute_resolve'],
  ops: ['view', 'orders_view', 'payments_view', 'report', 'driver', 'merchant', 'city', 'orders', 'ads', 'pricing', 'promo', 'dispute', 'ticket'],
  cs: ['view', 'orders_view', 'payments_view', 'ticket', 'dispute'],
  viewer: ['view', 'orders_view', 'payments_view', 'ledger', 'report'],
};

export interface MyAdminRole { role: AdminRole | null; perms: string[] }

interface AdminRoleState {
  info: MyAdminRole | null;
  loaded: boolean;
  /** Galat terakhir (mis. RPC belum ada di server) — saat galat, UI tidak menyembunyikan apa pun. */
  error: string | null;
  load: (force?: boolean) => Promise<void>;
}
let inflight: Promise<void> | null = null;

export const useAdminRole = create<AdminRoleState>((set, get) => ({
  info: null, loaded: false, error: null,
  load: async (force = false) => {
    if (get().loaded && !force) return;
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        const r = await rpc<MyAdminRole | MyAdminRole[] | null>('my_admin_role');
        const one = Array.isArray(r) ? r[0] ?? null : r;
        const role = (one?.role ?? null) as AdminRole | null;
        const perms = Array.isArray(one?.perms) ? one!.perms.map(String) : [];
        set({ info: { role, perms }, loaded: true, error: null });
      } catch (e) {
        set({ info: null, loaded: true, error: (e as Error).message });
      } finally { inflight = null; }
    })();
    return inflight;
  },
}));

/** Alias izin UI → izin server (`admin_role_perms` di migrasi 0107). */
const SERVER_PERM_ALIAS: Record<string, string[]> = {
  audit: ['report'], settings: ['payment_config'], gateway: ['payment_config', 'gateway_secret'],
  approvals: ['approval'], refund_approve: ['refund'], ads_review: ['ads'], ads_product: ['ads'],
  ops: ['driver', 'merchant', 'city', 'orders'], tickets: ['ticket'],
};
/** Izin efektif untuk sebuah info peran. `null` (belum termuat / RPC gagal) → izinkan; server tetap memeriksa. */
export function permsAllow(info: MyAdminRole | null, perm?: AdminPerm | AdminPerm[] | null): boolean {
  if (!perm || (Array.isArray(perm) && perm.length === 0)) return true;
  if (!info || !info.role) return true;
  if (info.role === 'superadmin') return true;
  const list = info.perms.length ? info.perms : ROLE_PERMS[info.role] ?? [];
  if (list.includes('*') || list.includes('all')) return true;
  const want = Array.isArray(perm) ? perm : [perm];
  // Nama izin UI → nama izin server (admin_role_perms, migrasi 0107). Satu izin UI boleh dipenuhi salah satu alias server.
  return want.some((p) => [p, ...(SERVER_PERM_ALIAS[p] ?? [])].some((s) => list.includes(s)));
}
/** Hook: `const can = useAdminCan(); can('refund_approve')`. */
export function useAdminCan() {
  const info = useAdminRole((s) => s.info);
  return (perm?: AdminPerm | AdminPerm[] | null) => permsAllow(info, perm);
}
export const adminCan = (perm?: AdminPerm | AdminPerm[] | null) => permsAllow(useAdminRole.getState().info, perm);

/* ───────────────────────────── Helper umum ───────────────────────────── */

/**
 * Galat simpan pengaturan (admin_set_settings v3): SETTING_UNKNOWN (kunci di luar app_setting_specs) dan
 * izin payment_config diberi pesan jelas; selebihnya diteruskan ke `handleAdminError` (PIN/ADMIN_LOCKED).
 */
export function handleSettingsError(e: unknown): void {
  const msg = String((e as Error)?.message ?? e ?? '');
  if (msg.includes('SETTING_UNKNOWN')) {
    const key = /kunci pengaturan (\S+)/.exec(msg)?.[1];
    toast.error(`Pengaturan ${key ? `“${key}” ` : ''}ditolak server: kunci tidak terdaftar di app_setting_specs. Hubungi pengembang untuk menambah spesifikasinya.`);
    return;
  }
  if (/izin payment_config/i.test(msg)) { toast.error('Menyimpan pengaturan butuh izin payment_config (superadmin).'); return; }
  const perm = /\(izin ([a-z_]+)\)/i.exec(msg)?.[1];
  if (perm) { toast.error(`Peran admin Anda tidak punya izin “${perm}” untuk pengaturan ini.`); return; }
  handleAdminError(e);
}


/** Galat "fungsi/tabel belum ada" dari PostgREST — dipakai untuk fallback. */
export const isMissing = (e: unknown) =>
  /Could not find the function|could not find|does not exist|PGRST202|PGRST205|schema cache|relation .* does not exist/i.test(String((e as Error)?.message ?? e ?? ''));

/** Hasil RPC yang berupa array / {items} / {rows} / {results} → array. */
export function asList<T = Record<string, unknown>>(x: unknown): T[] {
  if (Array.isArray(x)) return x as T[];
  if (x && typeof x === 'object') {
    const o = x as Record<string, unknown>;
    for (const k of ['items', 'rows', 'results', 'data', 'list']) if (Array.isArray(o[k])) return o[k] as T[];
  }
  return [];
}

/** Panggil RPC; bila RPC belum ada di server (galat "function not found"), jalankan `fallback`. */
export async function rpcOr<T>(fn: string, params: Record<string, unknown> | undefined, fallback: () => Promise<T>): Promise<{ data: T; via: 'rpc' | 'fallback' }> {
  try { return { data: await rpc<T>(fn, params), via: 'rpc' }; }
  catch (e) { if (isMissing(e)) return { data: await fallback(), via: 'fallback' }; throw e; }
}

/**
 * Panggil edge function Supabase dan lempar Error dengan pesan dari badan respons (bukan
 * "Edge Function returned a non-2xx status code"). Balasan `{error}` dengan HTTP 200 juga dianggap galat.
 */
export async function invokeEdge<T = Record<string, unknown>>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(name, { body });
  if (error) {
    let msg = error.message;
    const ctx = (error as { context?: { json?: () => Promise<unknown>; text?: () => Promise<string> } }).context;
    try {
      if (ctx?.json) {
        const j = (await ctx.json()) as { error?: string; message?: string } | null;
        msg = j?.error ?? j?.message ?? msg;
      }
    } catch { /* badan bukan JSON */ }
    throw new Error(friendlyError(String(msg)));
  }
  const d = data as unknown as { error?: string } | null;
  if (d && typeof d === 'object' && typeof d.error === 'string' && d.error) throw new Error(friendlyError(d.error));
  return data as T;
}

/**
 * Samarkan nilai rahasia. Nilai yang sudah tersamar dari server (mengandung • * … x) dibiarkan;
 * nilai lain dipotong jadi 6 awal / 4 akhir sesuai kontrak §1 — kunci tidak pernah tampil penuh.
 */
export function maskSecret(v?: string | null): string | null {
  if (v == null || v === '') return null;
  const s = String(v);
  if (/[•*…]|x{3,}/i.test(s)) return s;
  if (s.length <= 10) return `${'•'.repeat(4)}${s.slice(-2)}`;
  return `${s.slice(0, 6)}••••${s.slice(-4)}`;
}

/** URL dasar project Supabase (dari env build); cadangan = project produksi lama. */
export const SUPABASE_BASE = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://qwltshvzrsykxdvhbxcv.supabase.co').replace(/\/+$/, '');
/** URL webhook yang harus didaftarkan di dashboard provider (kontrak §9: pay-webhook/{provider}). */
export const webhookUrl = (provider: string) => `${SUPABASE_BASE}/functions/v1/pay-webhook/${provider}`;

export type PaymentProvider = 'midtrans' | 'finpay';
export type PaymentEnv = 'sandbox' | 'production';
export const PROVIDERS: { value: PaymentProvider; label: string }[] = [
  { value: 'midtrans', label: 'Midtrans' },
  { value: 'finpay', label: 'Finpay (Finnet)' },
];
export const providerLabel = (p?: string | null) => PROVIDERS.find((x) => x.value === p)?.label ?? (p || '—');

/** Label sumber angka (kontrak: [FAKTA-PUBLIK]/[KONTRAK]/[ASUMSI]) + nada warna. */
export const SOURCE_LABELS = ['[FAKTA-PUBLIK]', '[KONTRAK]', '[ASUMSI]', '[PERLU-KONFIRMASI-KONTRAK]'] as const;
export type SourceTone = 'ok' | 'info' | 'wait' | 'bad' | 'neutral';
export function sourceTone(label?: string | null): SourceTone {
  const t = String(label ?? '').toUpperCase();
  if (t.includes('PERLU')) return 'bad';
  if (t.includes('FAKTA')) return 'ok';
  if (t.includes('KONTRAK')) return 'info';
  if (t.includes('ASUMSI')) return 'wait';
  return 'neutral';
}

/** YYYY-MM-DD hari ini (WIB). */
export const todayWib = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
export const addDaysYmd = (ymd: string, d: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + d * 86400e3).toISOString().slice(0, 10);

/* ───────────────────────────── §1 Fee & gateway ───────────────────────────── */

/** Satu baris `payment_channel_fees` v3 — `admin_payment_channel_fees(p_provider)`. */
export interface ChannelFeeV3 {
  channel: string; provider: string; label: string | null;
  effective_from: string;
  fee_pct: number; fee_fixed: number; fee_pct_under_100k?: number | null;
  ppn_included: boolean; ppn_pct: number;
  hold_days?: number | null; hold_days_by_bank?: Record<string, number> | null; min_auto_disburse?: number | null;
  pass_to_customer: boolean; pass_to_customer_legal_ok: boolean;
  source_label?: string | null; source?: string | null; note?: string | null; notes?: string | null;
  funded_by?: string | null;
  active: boolean; updated_at?: string | null; updated_by?: string | null;
}
/** QRIS: `pass_to_customer` DIKUNCI false (larangan surcharge BI) — kontrak §0.5. */
export const isQris = (channel: string) => /qris/i.test(channel);
export const QRIS_LOCK_NOTE = 'QRIS: biaya MDR tidak boleh dibebankan ke pelanggan (larangan surcharge oleh Bank Indonesia). Kolom ini dikunci — biaya QRIS selalu ditanggung platform/merchant.';

/** `payment_provider_public()` (anon). */
export interface PaymentProviderPublic {
  provider: string; env: string; simulation: boolean;
  channels: { key: string; label: string; fee_label?: string | null; fee_pct?: number | null; fee_fixed?: number | null; pass_to_customer?: boolean; enabled?: boolean }[];
}

/** Satu baris `admin_gateway_secrets()` — nilai kunci SUDAH tersamar di server. */
export interface GatewaySecretRow {
  provider: string; env: string;
  merchant_id?: string | null;
  server_key?: string | null; client_key?: string | null; callback_token?: string | null;
  server_key_masked?: string | null; client_key_masked?: string | null; callback_token_masked?: string | null;
  has_server_key?: boolean; has_callback_token?: boolean; configured?: boolean;
  /** 0105: nama kunci di kolom extra (nilainya tidak pernah dikirim ke klien), mis. ['cron_secret']. */ extra_keys?: string[] | null;
  /** 0105: baris ini = provider & env aktif. */ active?: boolean;
  updated_at?: string | null; updated_by?: string | null; updated_by_name?: string | null;
}
export const SECRET_FIELDS: { key: 'merchant_id' | 'server_key' | 'client_key' | 'callback_token'; label: string; secret: boolean; hint: string }[] = [
  { key: 'merchant_id', label: 'Merchant ID', secret: false, hint: 'ID merchant dari dashboard provider' },
  { key: 'server_key', label: 'Server key / Merchant key', secret: true, hint: 'Finpay: Merchant Key · Midtrans: Server Key' },
  { key: 'client_key', label: 'Client key', secret: false, hint: 'opsional (Midtrans Snap)' },
  { key: 'callback_token', label: 'Callback token / secret', secret: true, hint: 'untuk verifikasi signature webhook' },
];

/* ───────────────────────────── §2/§6 Pembayaran, ledger, rekonsiliasi ───────────────────────────── */

export type PayStatus = 'PENDING' | 'PAID' | 'FAILED' | 'EXPIRED' | 'REFUND_REQUESTED' | 'PARTIALLY_REFUNDED' | 'REFUNDED' | 'DISPUTED' | 'RECONCILED';
export const PAY_STATUS_LABEL: Record<string, string> = {
  PENDING: 'Menunggu', PAID: 'Dibayar', FAILED: 'Gagal', EXPIRED: 'Kedaluwarsa', REFUND_REQUESTED: 'Refund diminta',
  PARTIALLY_REFUNDED: 'Refund sebagian', REFUNDED: 'Direfund', DISPUTED: 'Sengketa', RECONCILED: 'Terekonsiliasi',
};
export const payStatusTone = (s?: string | null): SourceTone =>
  s === 'PAID' || s === 'RECONCILED' ? 'ok' : s === 'PENDING' || s === 'REFUND_REQUESTED' ? 'wait' : s === 'FAILED' || s === 'DISPUTED' ? 'bad' : s === 'EXPIRED' ? 'neutral' : 'info';

/** Kolom `payments` v3 yang dipakai panel (query tabel, RLS admin select). */
export interface PaymentRowV3 {
  id: string; user_id: string; order_id: string | null; purpose: string; amount: number; method: string | null; provider: string; env?: string | null;
  status: string; pay_status?: PayStatus | null; external_id: string | null; provider_ref?: string | null; provider_txn_id?: string | null;
  support_ref?: string | null; expires_at?: string | null; paid_at?: string | null; created_at: string; refunded_amount?: number | null; reconciled_at?: string | null;
}
export const PAYMENT_COLS_V3 = 'id,user_id,order_id,purpose,amount,method,provider,env,status,pay_status,external_id,provider_ref,support_ref,expires_at,paid_at,created_at,refunded_amount';

/** `payment_events` — inbox webhook (append-only). */
export interface PaymentEvent {
  id: number; provider: string; event_id: string; external_id: string | null; payment_id: string | null; event_type: string | null;
  provider_status: string | null; amount: number | null; signature_ok: boolean | null; raw: unknown; received_at: string; processed_at: string | null; result: string | null;
}

/** `reconciliation_runs`. */
export interface ReconciliationRun {
  id: string; run_date: string; provider: string | null; kind: 'daily' | 'manual'; payments_checked: number; mismatches: number;
  unreconciled_amount: number; status: 'running' | 'done' | 'failed'; report: Record<string, unknown> | null; created_by: string | null; created_at: string;
}

/** Nilai `ledger_entry` baru di v3 (§6) + label Indonesia. */
export const LEDGER_ENTRY_V3_LABEL: Record<string, string> = {
  customer_receivable: 'Dana pelanggan di PG/hold', wallet_liability: 'Liabilitas saldo', tax_output: 'Pajak keluaran',
  dispute: 'Sengketa', unreconciled: 'Belum terekonsiliasi (selisih)', payout_fee: 'Biaya pencairan',
  ads_impression_cost: 'Biaya iklan · impresi', ads_click_cost: 'Biaya iklan · klik',
};

/* ───────────────────────────── §4 Refund, dispute, approval ───────────────────────────── */

export type RefundStatus = 'requested' | 'approved' | 'executing' | 'done' | 'failed' | 'rejected';
export interface RefundRequest {
  id: string; order_id: string | null; payment_id: string | null; requested_by: string | null; amount: number; kind: 'full' | 'partial';
  reason: string | null; destination: 'gateway' | 'wallet'; status: RefundStatus; maker: string | null; checker: string | null;
  provider_ref: string | null; created_at: string; decided_at: string | null; executed_at: string | null; note: string | null;
  // kolom pelengkap bila RPC admin_refunds menyertakan
  order_code?: string | null; requested_by_name?: string | null; maker_name?: string | null; checker_name?: string | null;
  provider?: string | null; support_ref?: string | null; needs_checker?: boolean | null;
}
export const REFUND_STATUS_LABEL: Record<RefundStatus, string> = {
  requested: 'Diajukan', approved: 'Disetujui', executing: 'Dieksekusi', done: 'Selesai', failed: 'Gagal', rejected: 'Ditolak',
};
export const refundTone = (s: string): SourceTone => (s === 'done' ? 'ok' : s === 'requested' || s === 'executing' ? 'wait' : s === 'approved' ? 'info' : s === 'failed' || s === 'rejected' ? 'bad' : 'neutral');

/** `refund_policy_calc(p_order)`. */
export interface RefundPolicyCalc { refundable: number; non_refundable: number; lines: { label: string; amount: number; refundable: boolean }[]; phase?: string | null; note?: string | null }

export type DisputeStatus = 'open' | 'investigating' | 'resolved_refund' | 'resolved_no_refund' | 'closed';
export interface Dispute {
  id: string; order_id: string | null; payment_id: string | null; opened_by: string | null; party_role: 'customer' | 'driver' | 'merchant';
  kind: 'amount_mismatch' | 'not_received' | 'chargeback' | 'payout_missing' | 'other'; amount: number | null; description: string | null;
  status: DisputeStatus; assigned_to: string | null; resolution: string | null; created_at: string; resolved_at: string | null;
  order_code?: string | null; opened_by_name?: string | null; assigned_to_name?: string | null;
}
export const DISPUTE_STATUS_LABEL: Record<DisputeStatus, string> = {
  open: 'Terbuka', investigating: 'Diinvestigasi', resolved_refund: 'Selesai · refund', resolved_no_refund: 'Selesai · tanpa refund', closed: 'Ditutup',
};
export const DISPUTE_KIND_LABEL: Record<string, string> = {
  amount_mismatch: 'Nominal tidak sesuai', not_received: 'Barang/jasa tidak diterima', chargeback: 'Chargeback', payout_missing: 'Pencairan belum masuk', other: 'Lainnya',
};
export const PARTY_ROLE_LABEL: Record<string, string> = { customer: 'Pelanggan', driver: 'Driver', merchant: 'Merchant' };

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired';
export interface ApprovalRequest {
  id: string; kind: 'refund' | 'wallet_adjust' | 'fee_change' | 'payout_batch' | string; ref_id: string | null; payload: Record<string, unknown> | null;
  amount: number | null; maker: string | null; checker: string | null; status: ApprovalStatus; created_at: string; decided_at: string | null; note: string | null;
  maker_name?: string | null; checker_name?: string | null; summary?: string | null;
}
export const APPROVAL_KIND_LABEL: Record<string, string> = { refund: 'Refund', wallet_adjust: 'Penyesuaian saldo', fee_change: 'Perubahan fee', payout_batch: 'Batch pencairan' };
export const APPROVAL_STATUS_LABEL: Record<ApprovalStatus, string> = { pending: 'Menunggu', approved: 'Disetujui', rejected: 'Ditolak', expired: 'Kedaluwarsa' };

/* ───────────────────────────── §6 Contribution margin ───────────────────────────── */

export type ContributionGroup = 'service' | 'city' | 'merchant' | 'month';
export interface ContributionRow {
  key: string | null; label?: string | null; orders: number; gross: number; platform_revenue: number; pg_fee_platform: number;
  promo_platform: number; refund_fraud: number; variable_cost: number; contribution_margin: number; take_rate_net_pct: number;
}

/* ───────────────────────────── §7 Iklan v3 ───────────────────────────── */

export type CampaignStatus = 'draft' | 'pending_review' | 'approved' | 'rejected' | 'active' | 'paused' | 'ended' | 'budget_exhausted' | 'cancelled' | 'expired';
export const CAMPAIGN_STATUS_LABEL: Record<CampaignStatus, string> = {
  draft: 'Draf', pending_review: 'Menunggu review', approved: 'Disetujui', rejected: 'Ditolak', active: 'Tayang', paused: 'Dijeda',
  ended: 'Selesai', budget_exhausted: 'Budget habis', cancelled: 'Dibatalkan', expired: 'Kedaluwarsa',
};
export const campaignTone = (s: string): SourceTone =>
  s === 'active' || s === 'approved' ? 'ok' : s === 'pending_review' || s === 'paused' ? 'wait' : s === 'rejected' || s === 'cancelled' ? 'bad' : s === 'budget_exhausted' ? 'info' : 'neutral';
export interface AdCampaign {
  id: string; merchant_id: string; merchant_name?: string | null; product_code: string; product_name?: string | null;
  name: string | null; budget: number; spent: number; radius_km: number | null; category: string | null;
  creative: { headline?: string | null; image_url?: string | null; cta?: string | null } | null;
  status: CampaignStatus; review_note: string | null; reviewed_by: string | null; reviewed_at: string | null; paused_by: string | null;
  impressions: number; clicks: number; conversions: number; conversion_value: number;
  starts_at?: string | null; ends_at?: string | null; created_at: string; pricing_model?: string | null; label?: string | null;
}
export type PricingModel = 'flat' | 'cpc' | 'cpm' | 'cpa';
export const PRICING_MODEL_LABEL: Record<PricingModel, string> = {
  flat: 'Flat (per periode)', cpc: 'CPC (per klik)', cpm: 'CPM (per 1.000 impresi)', cpa: 'CPA (per konversi)',
};
export interface AdProductV3 {
  code: string; name: string; description: string | null; placement: string | null; active: boolean;
  unit?: string | null; price?: number | null;
  pricing_model: PricingModel | null; unit_price: number | null; min_budget: number | null; min_days: number | null; max_days: number | null;
  requires_approval: boolean | null; label: string | null; updated_at?: string | null;
}
/** Checklist brand safety sebelum menyetujui kampanye (§7). */
export const BRAND_SAFETY: { key: string; label: string }[] = [
  { key: 'no_misleading', label: 'Tidak ada klaim menyesatkan (harga, diskon, "terbaik/nomor 1" tanpa dasar)' },
  { key: 'no_restricted', label: 'Tidak ada konten dewasa, alkohol, rokok/vape, atau judi' },
  { key: 'image_ok', label: 'Gambar layak: jelas, tidak buram, tidak melanggar hak cipta/merek pihak lain' },
  { key: 'label_sponsored', label: 'Label "Sponsored" akan tampil & tidak disamarkan sebagai hasil organik' },
];

/* ───────────────────────────── §8 Payout ───────────────────────────── */

export type PayoutStatus = 'PAYOUT_PENDING' | 'PAYOUT_PROCESSING' | 'PAYOUT_SETTLED' | 'PAYOUT_FAILED';
export const PAYOUT_STATUS_LABEL: Record<PayoutStatus, string> = {
  PAYOUT_PENDING: 'Menunggu transfer', PAYOUT_PROCESSING: 'Diproses provider', PAYOUT_SETTLED: 'Dana sampai', PAYOUT_FAILED: 'Gagal',
};
export const payoutTone = (s?: string | null): SourceTone => (s === 'PAYOUT_SETTLED' ? 'ok' : s === 'PAYOUT_PROCESSING' ? 'info' : s === 'PAYOUT_FAILED' ? 'bad' : s === 'PAYOUT_PENDING' ? 'wait' : 'neutral');
export interface WithdrawalV3Extra {
  provider?: 'manual' | 'finpay' | null; provider_ref?: string | null; inquiry_ref?: string | null; fee?: number | null;
  payout_status?: PayoutStatus | null; failed_reason?: string | null; settled_at?: string | null; approved_at?: string | null;
}

/** Ringkas uang untuk teks (bukan tabel). */
export const idNum = (n: number | null | undefined, digits = 0) => Number(n ?? 0).toLocaleString('id-ID', { maximumFractionDigits: digits });
/** Potong UUID: "3f2a…9c1d". */
export const shortId = (id?: string | null) => (id ? (id.length > 12 ? `${id.slice(0, 4)}…${id.slice(-4)}` : id) : '—');
