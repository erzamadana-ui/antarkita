// Rekening pencairan mitra (0123 partner_payout_account_mine / _set) — satu cache untuk semua layar Mitra.
import { useCallback, useEffect, useState } from 'react';
import { rpc, supabase } from '@/lib/supabase';
import { useAuth } from '@/store/auth';
import { EWALLET_CHANNELS, payoutPayload, type PayoutAccountForm, type PayoutAccountMine, type PayoutBank } from '@/lib/payout';

let cache: PayoutAccountMine | null = null;
const subs = new Set<(v: PayoutAccountMine | null) => void>();
const publish = (v: PayoutAccountMine | null) => { cache = v; subs.forEach((f) => f(v)); };

/**
 * Status rekening pencairan. `enabled` false → tidak memanggil RPC.
 * `missing` true hanya bila server MENYATAKAN wajib (`required`) dan rekening belum ada.
 * RPC gagal → `missing` false (server tetap menolak lewat PAYOUT_ACCOUNT_REQUIRED).
 */
export function usePayoutAccount(enabled = true) {
  const uid = useAuth((s) => s.session?.user.id);
  const [mine, setMine] = useState<PayoutAccountMine | null>(cache);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!cache);
  useEffect(() => { subs.add(setMine); return () => { subs.delete(setMine); }; }, []);
  const reload = useCallback(async () => {
    if (!enabled || !uid) { setLoading(false); return; }
    try { publish(await rpc<PayoutAccountMine>('partner_payout_account_mine')); setError(null); }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [enabled, uid]);
  useEffect(() => { void reload(); }, [reload]);
  const save = useCallback(async (f: PayoutAccountForm) => {
    const res = await rpc<PayoutAccountMine>('partner_payout_account_set', { p: payoutPayload(f) });
    publish(res);
    return res;
  }, []);
  const missing = !!mine && mine.required && !mine.exists;
  return { mine, error, loading, reload, save, missing };
}

export function invalidatePayoutAccount() { cache = null; }

let banksCache: PayoutBank[] | null = null;
/**
 * Daftar bank (bank_codes, tanpa e-wallet). `partner_payout_account_mine()` hanya menyertakan `banks` saat rekening belum ada,
 * jadi untuk mengubah rekening yang sudah tersimpan daftar dibaca langsung dari tabel (policy bank_codes_read, 0119).
 */
export function usePayoutBanks(seed?: PayoutBank[] | null) {
  const [banks, setBanks] = useState<PayoutBank[]>(seed?.length ? seed : banksCache ?? []);
  useEffect(() => { if (seed?.length) { banksCache = seed; setBanks(seed); } }, [seed]);
  useEffect(() => {
    if (seed?.length || banksCache) return;
    let alive = true;
    supabase.from('bank_codes').select('code,name').order('name').then(({ data }) => {
      const rows = ((data ?? []) as PayoutBank[]).filter((b) => !EWALLET_CHANNELS.includes(b.code as never));
      if (rows.length) { banksCache = rows; if (alive) setBanks(rows); }
    });
    return () => { alive = false; };
  }, [seed]);
  return banks;
}
