// Status antifraud pelanggan (0121 my_antifraud_status) — dibagi antar layar checkout lewat cache modul.
import { useCallback, useEffect, useState } from 'react';
import { rpc } from '@/lib/supabase';
import { useAuth } from '@/store/auth';
import { antifraudBanner, type MyAntifraudStatus } from '@/lib/antifraud';

let cache: { at: number; value: MyAntifraudStatus } | null = null;
const STALE_MS = 60_000;

/** Ambil status antifraud (cache 60 dtk). Gagal-aman: null → UI tidak menyembunyikan apa pun (server tetap penjaga akhir). */
export function useAntifraudStatus(enabled = true) {
  const uid = useAuth((s) => s.session?.user.id);
  const [status, setStatus] = useState<MyAntifraudStatus | null>(cache && Date.now() - cache.at < STALE_MS ? cache.value : null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async (force = false) => {
    if (!enabled || !uid) return;
    if (!force && cache && Date.now() - cache.at < STALE_MS) { setStatus(cache.value); return; }
    try {
      const v = await rpc<MyAntifraudStatus>('my_antifraud_status');
      cache = { at: Date.now(), value: v }; setStatus(v); setError(null);
    } catch (e) { setError((e as Error).message); }
  }, [enabled, uid]);
  useEffect(() => { void reload(); }, [reload]);
  return { status, error, reload };
}

/** Buang cache (mis. setelah galat CASH_BLOCKED agar banner langsung ikut). */
export function invalidateAntifraudStatus() { cache = null; }

/**
 * Penjaga checkout (0121): `cashHidden` bila tunai diblokir atau akun baru & nominal > cash_max_now;
 * `banner` = teks alasan untuk ditampilkan di atas pilihan pembayaran (null bila tidak ada).
 * RPC gagal / bukan aplikasi pelanggan → tidak menyembunyikan apa pun.
 */
export function useAntarfraudGuard(enabled: boolean, amount?: number | null) {
  const { status, error, reload } = useAntifraudStatus(enabled);
  const cashHidden = !!status && (status.cash_blocked || (status.is_new_account && status.cash_max_now != null && (amount ?? 0) > status.cash_max_now));
  const banner = enabled ? antifraudBanner(status, amount) : null;
  return { status, error, reload, cashHidden, banner };
}
