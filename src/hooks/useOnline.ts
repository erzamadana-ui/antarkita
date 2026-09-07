// Deteksi online/offline lintas platform TANPA dependensi baru.
//   • Web            → navigator.onLine + event 'online'/'offline', diperkuat probe berkala.
//   • Android / iOS  → probe ringan ke host Supabase (fetch + AbortController). React Native tidak
//                      punya navigator.onLine yang bisa dipercaya, dan @react-native-community/netinfo
//                      tidak terpasang, jadi kegagalan fetch-lah sinyal utamanya.
//
// Satu state dipakai bersama semua layar (satu timer, bukan satu timer per komponen).
import { useCallback, useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';

const HOST = process.env.EXPO_PUBLIC_SUPABASE_URL;
const PROBE = HOST ? `${HOST.replace(/\/+$/, '')}/auth/v1/health` : 'https://www.gstatic.com/generate_204';
const POLL_ONLINE = 45_000;
const POLL_OFFLINE = 8_000;

/** Pola pesan galat jaringan dari semua platform (Android/iOS/web/Node). */
export const NETWORK_ERROR_RE =
  /UnknownHostException|Unable to resolve host|Network request failed|Failed to fetch|NetworkError|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_NETWORK|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET|fetch failed|Load failed|TypeError: Failed|The Internet connection appears to be offline|timeout|timed out|AbortError|socket hang up/i;

/** Apakah error/pesan ini kegagalan jaringan (bukan kesalahan logika/izin)? */
export function isNetworkError(e: unknown): boolean {
  const msg = typeof e === 'string' ? e : ((e as Error)?.message ?? String(e ?? ''));
  return NETWORK_ERROR_RE.test(msg);
}

export const OFFLINE_MESSAGE = 'Tidak ada koneksi internet. Periksa jaringan lalu coba lagi.';

// ------------------------------------------------------------------ state bersama
let online = true;
let checking = false;
let timer: ReturnType<typeof setTimeout> | null = null;
const subs = new Set<(v: boolean) => void>();
const emit = () => subs.forEach((f) => { try { f(online); } catch { /* noop */ } });

function set(v: boolean) { if (online !== v) { online = v; emit(); } }

/** Dipanggil dari mana saja saat sebuah request gagal karena jaringan. */
export function reportNetworkError(e?: unknown) { if (e === undefined || isNetworkError(e)) { set(false); schedule(0); } }
export function isOnline() { return online; }

async function probe(timeoutMs = 7000): Promise<boolean> {
  // Web: kalau browser sudah bilang offline, tidak usah buang request.
  if (Platform.OS === 'web') {
    try { if (typeof navigator !== 'undefined' && navigator.onLine === false) return false; } catch { /* noop */ }
  }
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const to = setTimeout(() => { try { ctrl?.abort(); } catch { /* noop */ } }, timeoutMs);
  try {
    // Status HTTP apa pun = ada jaringan. Yang kita cari hanyalah lemparan error.
    await fetch(PROBE, { method: 'GET', cache: 'no-store', signal: ctrl?.signal as AbortSignal | undefined });
    return true;
  } catch {
    return false;
  } finally { clearTimeout(to); }
}

/** Cek sekarang juga (dipakai tombol "Coba lagi"). */
export async function recheck(): Promise<boolean> {
  if (checking) return online;
  checking = true;
  try { const ok = await probe(); set(ok); return ok; }
  finally { checking = false; schedule(); }
}

function schedule(delay = online ? POLL_ONLINE : POLL_OFFLINE) {
  if (timer) clearTimeout(timer);
  if (subs.size === 0) { timer = null; return; }           // tidak ada layar yang peduli → berhenti
  timer = setTimeout(() => { recheck(); }, delay);
}

if (Platform.OS === 'web' && typeof window !== 'undefined') {
  try {
    window.addEventListener('online', () => { set(true); recheck(); });
    window.addEventListener('offline', () => set(false));
    if (typeof navigator !== 'undefined' && navigator.onLine === false) online = false;
  } catch { /* noop */ }
}
AppState.addEventListener('change', (st) => { if (st === 'active' && subs.size > 0) recheck(); });

/**
 * Status koneksi. `online` optimistis (true) sampai terbukti sebaliknya, jadi UI tidak
 * berkedip "offline" saat pertama kali dibuka.
 */
export function useOnline() {
  const [value, setValue] = useState(online);
  useEffect(() => {
    subs.add(setValue);
    setValue(online);
    if (subs.size === 1) schedule(1500);      // pemeriksa pertama menyalakan timer bersama
    return () => { subs.delete(setValue); if (subs.size === 0 && timer) { clearTimeout(timer); timer = null; } };
  }, []);
  const retry = useCallback(async () => recheck(), []);
  return { online: value, offline: !value, retry, checking };
}

export default useOnline;
