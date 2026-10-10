// Hook ringan AntarVoucher v5 (KONTRAK-V5 §4). Tidak mengubah useAppSettings agar tiga app tidak saling bentrok.
import { useCallback, useEffect, useState } from 'react';
import {
  driverDepositStatus, taxSettingsPublic, voucherPublicConfig,
  type DriverDepositStatus, type TaxSettingsPublic, type VoucherPublicConfig,
} from '@/lib/voucherV5';

const FALLBACK: VoucherPublicConfig = {
  payment_mode: 'voucher_only', purchase_enabled: false, denominations: [20000, 50000, 100000, 200000, 500000, 1000000],
  min: 20000, max: 2000000, cap_customer: 2000000, cap_partner: 5000000, code_ttl_hours: 720, auto_redeem: true, banks: [],
};
const TAX_FALLBACK: TaxSettingsPublic = { ppn_pct: 11, ppn_inclusive: true };

let cache: VoucherPublicConfig | null = null;
let taxCache: TaxSettingsPublic | null = null;

/** Konfigurasi publik voucher (anon boleh). Dipakai pelanggan, mitra, admin, landing. */
export function useVoucherConfig() {
  const [config, setConfig] = useState<VoucherPublicConfig>(cache ?? FALLBACK);
  const [loading, setLoading] = useState(!cache);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      setError(null);
      const r = await voucherPublicConfig();
      cache = { ...FALLBACK, ...r };
      setConfig(cache);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  return { config, loading, error, reload, voucherOnly: config.payment_mode === 'voucher_only' };
}

/** Pajak untuk label "termasuk PPN n %". */
export function useTaxSettings() {
  const [tax, setTax] = useState<TaxSettingsPublic>(taxCache ?? TAX_FALLBACK);
  useEffect(() => {
    if (taxCache) return;
    taxSettingsPublic().then((r) => { taxCache = { ...TAX_FALLBACK, ...r }; setTax(taxCache); }).catch(() => undefined);
  }, []);
  return tax;
}

/** Status deposit driver/mitra travel (app Mitra). */
export function useDriverDeposit(enabled = true) {
  const [status, setStatus] = useState<DriverDepositStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    if (!enabled) return;
    try { setError(null); setStatus(await driverDepositStatus()); } catch (e) { setError((e as Error).message); }
  }, [enabled]);
  useEffect(() => { void reload(); }, [reload]);
  return { status, error, reload };
}
