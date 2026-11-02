// Panel Admin · 9 keputusan GM 31 Okt 2026 (docs/KONTRAK-31OKT.md, migrasi 0121–0126).
// Tipe & pembungkus RPC untuk layar baru: Manager Kota (0125), Anti Order Fiktif (0121) + Dispatch (0122),
// Rekening Pencairan Mitra (0123), Rate Card Travel & Kebijakan Harga (0124). Bentuk JSON mengikuti migrasi final.
// Berkas ini milik agen Frontend Admin; jangan menaruh tipe admin di `types.ts`.
import { rpc } from '@/lib/supabase';

const asArray = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/* ───────────────────────────── 0125 · Manager Kota ───────────────────────────── */

export type CityManagerStatus = 'kandidat' | 'aktif' | 'nonaktif';
export const CITY_MANAGER_STATUS: { value: CityManagerStatus; label: string; tone: 'wait' | 'ok' | 'off' }[] = [
  { value: 'kandidat', label: 'Kandidat', tone: 'wait' },
  { value: 'aktif', label: 'Aktif', tone: 'ok' },
  { value: 'nonaktif', label: 'Nonaktif', tone: 'off' },
];
export const cityManagerStatusMeta = (s?: string | null) => CITY_MANAGER_STATUS.find((x) => x.value === s) ?? { value: 'kandidat' as const, label: s || '—', tone: 'off' as const };
/** Tier kota [ASUMSI kontrak 0125]: 1 kota besar (Pekanbaru, Padang, Batam), 2 menengah (Dumai, Bukittinggi), 3 kabupaten/kecil. */
export const CITY_TIERS: { value: 1 | 2 | 3; label: string; desc: string }[] = [
  { value: 1, label: 'Tier 1 · kota besar', desc: 'Pekanbaru, Padang, Batam — target 100 %' },
  { value: 2, label: 'Tier 2 · menengah', desc: 'Dumai, Bukittinggi — target 60 %' },
  { value: 3, label: 'Tier 3 · kabupaten/kecil', desc: 'target 35 %' },
];
/** Gaji dasar default Manager Kota (keputusan GM; setelan city_manager_salary_default). */
export const CITY_MANAGER_SALARY_DEFAULT = 15_000_000;

/** Satu baris `admin_city_managers()` (0125). */
export interface CityManagerRow {
  id: string; city_id: string; city_name: string; province: string | null; service_status: string | null;
  full_name: string; phone: string | null; email: string | null;
  profile_id: string | null; profile_name: string | null; profile_role: string | null;
  /** cities.manager_id sudah sama dengan profile_id (trigger sinkron). */
  city_manager_id_synced: boolean;
  salary_base: number; start_date: string | null; status: CityManagerStatus; tier: 1 | 2 | 3; note: string | null;
  /** Bulan ke-n sejak start_date (null bila start_date kosong). */
  month_no: number | null;
  has_target_this_month: boolean;
  /** Skor KPI bulan ini (city_manager_kpi_calc) — null bila belum ada target. */
  kpi: number | null; kpi_grade: string | null;
  created_at: string; updated_at: string;
}
export interface SetCityManagerInput {
  id?: string | null; city_id: string; full_name: string; phone?: string | null; email?: string | null; profile_id?: string | null;
  salary_base?: number | null; start_date?: string | null; status?: CityManagerStatus; tier?: number; note?: string | null;
}
export const adminCityManagers = async () => asArray<CityManagerRow>(await rpc('admin_city_managers'));
export const adminSetCityManagerProfile = (p: SetCityManagerInput) => rpc<CityManagerRow>('admin_set_city_manager_profile', { p });
export const adminCityManagerDelete = (id: string) => rpc<{ ok: boolean; deleted: unknown }>('admin_city_manager_delete', { p_id: id });

/** Template target KPI per tier × bulan ke-n (`kpi_target_templates`). */
export interface KpiTargetTemplate {
  tier: 1 | 2 | 3; month_no: number;
  target_merchant_new: number; target_driver_new: number; target_merchant_active: number; target_driver_active: number; target_orders: number;
  weight_merchant_new: number; weight_driver_new: number; weight_active: number; weight_orders: number;
  bonus_pool: number; note: string | null; updated_by: string | null; updated_at: string;
}
export const TEMPLATE_TARGET_KEYS = ['target_merchant_new', 'target_driver_new', 'target_merchant_active', 'target_driver_active', 'target_orders'] as const;
export const TEMPLATE_WEIGHT_KEYS = ['weight_merchant_new', 'weight_driver_new', 'weight_active', 'weight_orders'] as const;
export type TemplateNumKey = typeof TEMPLATE_TARGET_KEYS[number] | typeof TEMPLATE_WEIGHT_KEYS[number] | 'bonus_pool';
export const TEMPLATE_KEY_LABEL: Record<TemplateNumKey, string> = {
  target_merchant_new: 'Merchant baru', target_driver_new: 'Driver baru', target_merchant_active: 'Merchant aktif', target_driver_active: 'Driver aktif', target_orders: 'Order',
  weight_merchant_new: 'Bobot merchant baru %', weight_driver_new: 'Bobot driver baru %', weight_active: 'Bobot mitra aktif %', weight_orders: 'Bobot order %', bonus_pool: 'Bonus pool (Rp)',
};
export const adminKpiTargetTemplates = async () => asArray<KpiTargetTemplate>(await rpc('admin_kpi_target_templates'));
export const adminSetKpiTargetTemplate = (p: Partial<KpiTargetTemplate> & { tier: number; month_no: number }) => rpc<KpiTargetTemplate>('admin_set_kpi_target_template', { p });
/** Terapkan template ke target KPI kota bulan itu (admin_set_city_manager_kpi di server). Galat: KPI_TEMPLATE_NO_TIER / KPI_TEMPLATE_BEFORE_START / KPI_TEMPLATE_MISSING. */
export const adminKpiApplyTemplate = (cityId: string, month: string | null) =>
  rpc<Record<string, unknown> & { template?: { tier: number; month_no: number; salary_base: number; manager: string } }>('admin_kpi_apply_template', { p_city: cityId, p_month: month });

/* ───────────────────────────── 0121 · Anti order fiktif ───────────────────────────── */

export interface AntifraudLimits {
  new_account_hours: number; new_account_cash_max: number; orders_per_hour_max: number; active_orders_max: number;
  strike_cash_block: number; strike_suspend: number; phone_required: boolean; noshow_wait_minutes: number; noshow_fee: number; cash_block_days: number;
}
export interface AntifraudSummary {
  strikes_7d: number; strikes_30d: number; strikes_open: number; customers_with_strikes: number; customers_cash_blocked: number; customers_suspended: number;
  by_kind_30d: Record<string, number>; rejections_24h: { cash_blocked: number; auto_suspend: number }; limits: AntifraudLimits;
}
export type StrikeKind = 'no_show' | 'fake_address' | 'cancel_abuse';
export const STRIKE_KIND_LABEL: Record<string, string> = { no_show: 'Tidak muncul (no-show)', fake_address: 'Alamat fiktif', cancel_abuse: 'Batal berulang' };
export type StrikeStatusFilter = 'all' | 'active' | 'cash_blocked' | 'suspended' | 'cleared';
export const STRIKE_STATUS_FILTERS: { key: StrikeStatusFilter; label: string }[] = [
  { key: 'all', label: 'Semua' }, { key: 'active', label: 'Strike aktif' }, { key: 'cash_blocked', label: 'Tunai diblokir' }, { key: 'suspended', label: 'Ditangguhkan' }, { key: 'cleared', label: 'Sudah dipulihkan' },
];
export const STRIKE_STATUS_LABEL: Record<string, { label: string; tone: 'wait' | 'ok' | 'bad' | 'off' | 'info' }> = {
  active: { label: 'Strike aktif', tone: 'wait' }, cash_blocked: { label: 'Tunai diblokir', tone: 'info' }, suspended: { label: 'Ditangguhkan', tone: 'bad' }, cleared: { label: 'Bersih', tone: 'ok' },
};
export interface CustomerStrike {
  id: string; order_id: string | null; order_code: string | null; kind: StrikeKind; evidence_url: string | null; note: string | null;
  created_by: string | null; created_by_name: string | null; created_at: string; cleared_at: string | null; cleared_note: string | null;
}
export interface CustomerStrikeRow {
  customer_id: string; full_name: string | null; phone: string | null; is_active: boolean; strike_count: number;
  cash_blocked_until: string | null; cash_blocked: boolean; status: 'active' | 'cash_blocked' | 'suspended' | 'cleared';
  last_strike_at: string | null; orders_30d: number; strikes: CustomerStrike[];
}
export const adminAntifraudSummary = () => rpc<AntifraudSummary>('admin_antifraud_summary');
export const adminCustomerStrikes = async (status: StrikeStatusFilter) => asArray<CustomerStrikeRow>(await rpc('admin_customer_strikes', { p_status: status }));
export const adminCustomerStrikeClear = (customerId: string, note: string | null) =>
  rpc<{ ok: boolean; customer_id: string; cleared: number; reactivated: boolean; strike_count: number; cash_blocked_until: string | null; is_active: boolean }>('admin_customer_strike_clear', { p_customer: customerId, p_note: note });

/* ───────────────────────────── 0122 · Dispatch penawaran bertahap ───────────────────────────── */

export interface DispatchCfg {
  enabled: boolean; offer_seconds: number; rounds: number; radius_step_km: number; no_move_minutes: number; min_progress_m: number;
  penalty_m_per_s: number; no_move_suspend: number; offer_on_create: boolean;
}
export interface DispatchSummary {
  cfg: DispatchCfg; offers_24h: number; accepted_24h: number; declined_24h: number; expired_24h: number; released_no_move_7d: number;
  active_offers: number; searching_orders: number; avg_round_accepted_7d: number | null;
  /** true/false = cron antarkita_dispatch terdaftar; null = pg_cron tidak tersedia. */
  cron: boolean | null;
}
export const adminDispatchSummary = () => rpc<DispatchSummary>('admin_dispatch_summary');

/* ───────────────────────────── 0123 · Rekening pencairan mitra ───────────────────────────── */

export type PayoutChannel = 'bank' | 'dana' | 'ovo' | 'linkaja' | 'gopay' | 'shopeepay';
export const PAYOUT_CHANNEL_LABEL: Record<string, string> = { bank: 'Bank', dana: 'DANA', ovo: 'OVO', linkaja: 'LinkAja', gopay: 'GoPay', shopeepay: 'ShopeePay' };
export const EWALLET_CODES = ['DANA', 'OVO', 'LINKAJA', 'GOPAY', 'SHOPEEPAY'];
/** Kanal dari kode/nama bank (untuk baris lama tanpa kolom `channel`): kode e-wallet virtual → e-wallet, selain itu bank. */
export const channelFromBank = (code?: string | null, name?: string | null): PayoutChannel => {
  const k = String(code ?? name ?? '').trim().toUpperCase().replace(/\s+/g, '');
  const hit = EWALLET_CODES.find((c) => k === c || k.startsWith(c));
  return (hit ? hit.toLowerCase() : 'bank') as PayoutChannel;
};
export const isEwallet = (channel?: string | null) => !!channel && channel !== 'bank';
/** Samarkan nomor rekening/HP: 4 digit terakhir terlihat. */
export const maskAccountNo = (no?: string | null) => {
  const s = String(no ?? '').replace(/\s/g, '');
  if (!s) return '—';
  if (s.length <= 4) return '•'.repeat(s.length);
  return `${'•'.repeat(Math.max(2, s.length - 4))}${s.slice(-4)}`;
};
export type PartnerType = 'driver' | 'merchant' | 'travel' | 'lainnya';
export const PARTNER_TYPE_LABEL: Record<string, string> = { driver: 'Driver', merchant: 'Merchant', travel: 'Mitra travel', lainnya: 'Lainnya' };
export interface PartnerPayoutAccount {
  id: string; user_id: string; full_name: string | null; phone: string | null; role: string | null; partner_type: PartnerType;
  channel: PayoutChannel; bank_code: string | null; bank_name: string | null; account_no: string; account_name: string;
  verified: boolean; verified_by: string | null; verified_at: string | null; auto_sweep: boolean;
  balance: number; open_withdrawals: number; created_at: string; updated_at: string;
}
export const adminPartnerPayoutAccounts = async (q: string | null) => asArray<PartnerPayoutAccount>(await rpc('admin_partner_payout_accounts', { p_q: q }));
export const adminPartnerPayoutVerify = (id: string, ok: boolean, note: string | null) => rpc<Record<string, unknown>>('admin_partner_payout_verify', { p_id: id, p_ok: ok, p_note: note });

export type ProviderJobStatus = 'queued' | 'sent' | 'done' | 'failed';
export const PROVIDER_JOB_STATUS: Record<string, { label: string; tone: 'wait' | 'info' | 'ok' | 'bad' }> = {
  queued: { label: 'Antre', tone: 'wait' }, sent: { label: 'Terkirim', tone: 'info' }, done: { label: 'Selesai', tone: 'ok' }, failed: { label: 'Gagal', tone: 'bad' },
};
export interface PayoutProviderJob {
  id: string; batch_id: string; provider: 'manual' | 'api' | string; status: ProviderJobStatus;
  request: { batch_id?: string; items?: { withdrawal_id: string; amount: number; bank_name: string; bank_code: string; account_no: string; account_name: string }[] } | null;
  response: unknown; error: string | null; created_at: string; updated_at: string;
  batch_label: string | null; batch_status: string | null; batch_total: number | null; batch_count: number | null;
}
export const adminPayoutProviderJobs = async (status: string | null) => asArray<PayoutProviderJob>(await rpc('admin_payout_provider_jobs', { p_status: status }));

/* ───────────────────────────── 0124 · Rate card AntarTravel ───────────────────────────── */

export interface TravelRateCard {
  id: string; vehicle_model: string; match_regex: string | null; seats: number; per_km: number; base_fare: number; min_fare: number;
  driver_share_pct: number; platform_fee_pct: number; platform_fee_flat: number; charter_multiplier: number; sort_order: number; active: boolean; note: string | null;
  updated_by: string | null; created_at: string; updated_at: string;
  // tambahan admin_travel_rate_cards()
  partners_matched: number; driver_net_per_km: number; fare_floor_per_km: number;
  sample_pku_pdg: TravelQuote | null;
}
export interface TravelQuoteLine { key: string; label: string; amount: number }
export interface TravelQuote {
  from_city: { id: string; name: string }; to_city: { id: string; name: string };
  km: number; km_source: 'route' | 'haversine'; km_haversine_x_factor: number; road_factor: number; route_id: string | null;
  rate_card_id: string; model: string; seats: number; mode: 'shared' | 'charter'; pax: number;
  per_km: number; base_fare: number; min_fare: number; charter_multiplier: number; shared_markup_pct: number;
  fare_vehicle: number; fare_total: number; fare_per_seat: number; fare: number;
  customer_platform_fee: number; customer_total: number; commission: number; platform_fee: number; ppn: number; platform_revenue_net: number;
  driver_net: number; driver_share_pct_actual: number; tolerance_pct: number; offer_min_pct: number;
  breakdown: TravelQuoteLine[]; quoted_at: string;
}
export interface SetTravelRateCardInput {
  id?: string; vehicle_model?: string; match_regex?: string | null; seats?: number; per_km?: number; base_fare?: number; min_fare?: number;
  driver_share_pct?: number; platform_fee_pct?: number; platform_fee_flat?: number; charter_multiplier?: number; sort_order?: number; active?: boolean; note?: string | null;
}
export const adminTravelRateCards = async () => asArray<TravelRateCard>(await rpc('admin_travel_rate_cards'));
export const adminSetTravelRateCard = (p: SetTravelRateCardInput) => rpc<TravelRateCard>('admin_set_travel_rate_card', { p });
export const travelQuote = (from: string, to: string, model: string | null, mode: 'shared' | 'charter', pax: number) =>
  rpc<TravelQuote>('travel_quote', { p_from: from, p_to: to, p_model: model, p_mode: mode, p_pax: pax });

/* ───────────────────────────── 0124 · Kebijakan harga (keputusan 8) ───────────────────────────── */

export type PolicyRule = 'driver_share_min' | 'two_wheel_cap' | 'fare_floor_per_km' | 'promo_budget' | 'promo_funded_by';
export const POLICY_RULE_LABEL: Record<string, string> = {
  driver_share_min: 'Porsi minimum driver/mitra', two_wheel_cap: 'Batas komisi roda dua (regulasi)', fare_floor_per_km: 'Tarif bersih minimum per km',
  promo_budget: 'Anggaran promo bulanan', promo_funded_by: 'Penanggung promo default',
};
export interface PolicyViolation {
  service: string; rule: PolicyRule; severity: 'violation' | 'info'; value: number | string | null; limit: number | string | null; message: string; rate_card_id?: string | null;
}
export interface PricingPolicyService {
  service: string; driver_commission_pct: number; merchant_fee_pct: number; customer_platform_fee: number; promo_default_funded_by: string;
  per_km: number | null; min_fare: number | null; base_fare: number | null; driver_share_pct: number; driver_net_per_km: number | null;
  customer_per_km: number | null; customer_min_total: number | null; fare_floor_per_km: number;
}
export interface PricingPolicy {
  policy: {
    principle: string; driver_min_share_pct: number; promo_budget_pct_max: number; promo_default_funded_by: string; two_wheel_commission_cap: number;
    fare_floor_per_km: Record<string, number | string> | null;
  };
  services: PricingPolicyService[] | null;
  travel_rate_cards: { id: string; vehicle_model: string; seats: number; per_km: number; platform_fee_pct: number; driver_net_per_km: number; active: boolean }[] | null;
  promo: { month: string; platform_revenue: number; promo_platform_spend: number; spend_pct: number | null; budget_pct_max: number; budget_remaining: number };
  market_reference: { note: string; ride_motor_per_km: number[]; ride_motor_min: number[]; ride_car_per_km: number[]; ride_car_min: number[] } | null;
  violations: PolicyViolation[]; ok: boolean; generated_at: string;
}
export const adminPricingPolicy = () => rpc<PricingPolicy>('admin_pricing_policy');
export const pricingPolicyCheck = async () => asArray<PolicyViolation>(await rpc('pricing_policy_check'));
