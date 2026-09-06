import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import { Platform, AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  console.warn('EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY belum diisi di .env');
}

// Ditangkap SEBELUM klien dibuat, karena supabase-js (detectSessionInUrl) bisa mengonsumsi hash URL saat inisialisasi
let BOOT_RECOVERY = captureRecovery();

export const supabase = createClient(url ?? 'https://invalid.supabase.co', anonKey ?? 'anon', {
  auth: {
    storage: Platform.OS === 'web' ? undefined : AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: Platform.OS === 'web',
  },
  realtime: { params: { eventsPerSecond: 10 } },
});

// Refresh token hanya saat app di foreground (rekomendasi Supabase untuk RN)
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}

/** Panggil RPC dan lempar error dalam bahasa yang ramah. */
export async function rpc<T = unknown>(fn: string, params?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, params as never);
  if (error) throw new Error(friendlyError(error.message));
  return data as T;
}

export function friendlyError(msg: string): string {
  if (!msg) return 'Terjadi kesalahan';
  if (msg.includes('Invalid login credentials')) return 'Email atau kata sandi salah';
  if (msg.includes('User already registered')) return 'Email sudah terdaftar, silakan masuk';
  if (msg.includes('Password should be')) return 'Kata sandi minimal 6 karakter';
  if (msg.includes('Email not confirmed')) return 'Email belum dikonfirmasi';
  if (msg.includes('Failed to fetch') || msg.includes('Network request failed')) return 'Tidak bisa terhubung ke server. Periksa koneksi internet.';
  if (msg.includes('JWT expired')) return 'Sesi berakhir, silakan masuk kembali';
  if (/rate limit|only request this after|over_email_send_rate_limit/i.test(msg)) return 'Terlalu sering meminta email. Tunggu beberapa menit lalu coba lagi.';
  if (/same password|different from the old/i.test(msg)) return 'Kata sandi baru harus berbeda dari kata sandi lama';
  if (/Token has expired|otp_expired|is invalid or has expired/i.test(msg)) return 'Kode/tautan sudah kedaluwarsa atau tidak valid. Minta tautan baru.';
  if (/Auth session missing/i.test(msg)) return 'Sesi pemulihan tidak ditemukan. Buka tautan dari email sekali lagi.';
  if (/Unable to validate email|invalid format/i.test(msg)) return 'Format email tidak valid';
  return msg.replace(/^.*?:\s*/, (m) => (m.length > 40 ? '' : m));
}

/**
 * Token pemulihan kata sandi dari URL (web). Supabase mengarahkan ke situs dengan
 * `#access_token=…&refresh_token=…&type=recovery` (atau `#error=…&error_code=otp_expired`).
 * Di GitHub Pages tautan bisa lewat 404.html → `?r=/…#…`, jadi hash juga dicari di parameter `r`.
 */
export function recoveryFromUrl(): { access_token: string; refresh_token: string } | { error: string } | null {
  const v = BOOT_RECOVERY; BOOT_RECOVERY = null; return v;
}
/** Intip (tanpa mengonsumsi) apakah URL boot membawa alur pemulihan: 'tokens' | 'error' | null. */
export function peekBootRecovery(): 'tokens' | 'error' | null {
  return BOOT_RECOVERY == null ? null : 'error' in BOOT_RECOVERY ? 'error' : 'tokens';
}
function captureRecovery(): { access_token: string; refresh_token: string } | { error: string } | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = [window.location.hash, new URLSearchParams(window.location.search).get('r') ?? '']
      .map((x) => (x.includes('#') ? x.slice(x.indexOf('#') + 1) : x.replace(/^#/, '')))
      .find((x) => /type=recovery|error_code=/.test(x));
    if (!raw) return null;
    const q = new URLSearchParams(raw);
    if (q.get('error') || q.get('error_code')) return { error: q.get('error_description') || q.get('error_code') || q.get('error') || 'error' };
    const access_token = q.get('access_token'); const refresh_token = q.get('refresh_token');
    if (q.get('type') === 'recovery' && access_token && refresh_token) return { access_token, refresh_token };
    return null;
  } catch { return null; }
}

let chSeq = 0;
/**
 * Channel realtime dengan topik UNIK per pemanggil.
 * supabase-js memakai ulang channel bertopik sama; bila satu layar sudah subscribe dan layar lain
 * memanggil `.on('postgres_changes', …)` pada topik yang sama, realtime-js melempar
 * "cannot add `postgres_changes` callbacks … after `subscribe()`" dan layar gagal dirender.
 * Dipakai untuk semua langganan postgres_changes (broadcast di lib/call.ts sengaja memakai topik sama).
 */
export function realtimeChannel(name: string) {
  chSeq = (chSeq + 1) % 1e6;
  return supabase.channel(`${name}#${Date.now().toString(36)}${chSeq.toString(36)}`);
}
