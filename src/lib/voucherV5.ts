// AntarVoucher v5 — model closed-loop penuh (docs/antarvoucher/KONTRAK-V5.md).
// Satu-satunya tempat pembungkus RPC v5 di klien; dipakai app pelanggan, mitra, admin.
// Prinsip: pelanggan & mitra MEMBELI VOUCHER (transfer ke rekening PT), kode terbit dari server, saldo closed loop;
// tidak ada payment gateway di mode voucher_only; pencairan by request SLA 24 jam.
import { rpc } from '@/lib/supabase';
import type { VoucherBankAccount, VoucherPurchase } from '@/lib/voucher';

export type PaymentMode = 'voucher_only' | 'gateway';
export type VoucherCodeStatus = 'pending_payment' | 'issued' | 'redeemed' | 'expired' | 'void';

export interface VoucherPublicConfig {
  payment_mode: PaymentMode;
  purchase_enabled: boolean;
  denominations: number[];
  min: number;
  max: number;
  cap_customer: number;
  cap_partner: number;
  code_ttl_hours: number;
  auto_redeem: boolean;
  banks: VoucherBankAccount[];
}

export interface VoucherCode {
  id: string;
  code: string;
  nominal: number;
  status: VoucherCodeStatus;
  purchase_id: string | null;
  issued_at: string | null;
  redeemed_at: string | null;
  expires_at: string | null;
  created_at: string;
}

export interface VoucherPurchaseWithCode { purchase: VoucherPurchase; code: VoucherCode }

export interface DriverDepositStatus {
  required: boolean;
  min_balance: number;
  balance: number;
  can_accept: boolean;
  shortfall: number;
}

export interface TaxSettingsPublic { ppn_pct: number; ppn_inclusive: boolean }

export interface VoucherFloatStatus {
  total_outstanding: number;
  customers: number;
  partners: number;
  limit: number;
  pct: number;
  alert: boolean;
  cap_customer: number;
  cap_partner: number;
  updated_at: string;
}

export interface CityTargetProgress {
  city_id: string;
  city_name: string;
  month: string;
  target_orders: number;
  target_npr: number;
  target_active_drivers: number;
  target_active_merchants: number;
  pic_ops: string | null;
  pic_finance: string | null;
  actual_orders: number;
  actual_npr: number;
  actual_active_drivers: number;
  actual_active_merchants: number;
  pct_orders: number;
  pct_npr: number;
  prorata_pct: number;
  status: 'on_track' | 'at_risk' | 'behind' | 'no_target';
  fixed_costs: number;
  cogs_per_order: number;
  cogs_per_order_actual: number;
  platform_fee_recommended: number;
}

export interface PayoutQueueRow {
  id: string;
  user_id: string;
  name: string;
  role: string;
  amount: number;
  status: string;
  created_at: string;
  sla_due_at: string | null;
  sla_remaining_min: number | null;
  overdue: boolean;
  batch_id: string | null;
  bank_code: string | null;
  account_no: string | null;
  account_name: string | null;
}

export interface PayoutBatch {
  id: string;
  created_at: string;
  cutoff: string | null;
  status: 'open' | 'exported' | 'settled';
  total: number;
  count: number;
  exported_at: string | null;
  settled_at: string | null;
}

export interface PayoutExportRow {
  withdrawal_id: string;
  user_id: string;
  name: string;
  bank_code: string;
  account_no: string;
  account_name: string;
  amount: number;
  note: string;
}

// ---- publik / semua peran
export const voucherPublicConfig = () => rpc<VoucherPublicConfig>('voucher_public_config');
export const taxSettingsPublic = () => rpc<TaxSettingsPublic>('tax_settings_public');

// ---- pelanggan & mitra
export const voucherCodePurchaseCreate = (nominal: number, bankCode: string, idempotencyKey: string) =>
  rpc<VoucherPurchaseWithCode>('voucher_code_purchase_create', { p_nominal: nominal, p_bank_code: bankCode, p_idempotency_key: idempotencyKey });
export const myVoucherCodes = () => rpc<VoucherCode[]>('my_voucher_codes');
export const voucherCodeRedeem = (code: string) => rpc<unknown>('voucher_code_redeem', { p_code: code.trim().toUpperCase() });
export const driverDepositStatus = () => rpc<DriverDepositStatus>('driver_deposit_status');

// ---- admin / exec
export const voucherFloatStatus = () => rpc<VoucherFloatStatus>('voucher_float_status');
export const adminSetPaymentMode = (mode: PaymentMode) => rpc<unknown>('admin_set_payment_mode', { p_mode: mode });
export const adminSetTaxSettings = (p: Partial<{ ppn_pct: number; ppn_inclusive: boolean; pph_partner_pct: number }>) =>
  rpc<unknown>('admin_set_tax_settings', { p });
export const adminSetCityTargets = (p: {
  city_id: string; month: string; target_orders: number; target_npr: number; target_active_drivers: number;
  target_active_merchants: number; pic_ops?: string | null; pic_finance?: string | null; note?: string | null;
}) => rpc<unknown>('admin_set_city_targets', { p });
export const cityTargetsProgress = (month: string) => rpc<CityTargetProgress[]>('city_targets_progress', { p_month: month });
export const adminPayoutQueue = () => rpc<PayoutQueueRow[]>('admin_payout_queue');
export const adminPayoutBatchCreate = () => rpc<PayoutBatch>('admin_payout_batch_create');
export const adminPayoutBatchExport = (batchId: string) => rpc<PayoutExportRow[]>('admin_payout_batch_export', { p_batch: batchId });
export const adminPayoutBatchSettle = (batchId: string, refs: { withdrawal_id: string; bank_ref?: string; status: 'ok' | 'failed'; reason?: string }[]) =>
  rpc<unknown>('admin_payout_batch_settle', { p_batch: batchId, p_refs: refs });

// ---- util
/** PPN inklusif: bagian pajak dari nilai kotor R. */
export function ppnPart(gross: number, ppnPct: number, inclusive: boolean): number {
  if (!ppnPct) return 0;
  return inclusive ? Math.round((gross * ppnPct) / (100 + ppnPct)) : Math.round((gross * ppnPct) / 100);
}
export function formatVoucherCode(raw: string): string {
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const body = s.startsWith('AKV') ? s.slice(3) : s;
  return 'AKV-' + (body.match(/.{1,4}/g) ?? []).slice(0, 3).join('-');
}
export const monthKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
