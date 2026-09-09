import { create } from 'zustand';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session } from '@supabase/supabase-js';
import { supabase, peekBootRecovery, friendlyError } from '@/lib/supabase';
import type { Profile, Driver, Merchant, Wallet, TravelPartner, MarketVendor } from '@/lib/types';

interface AuthState {
  session: Session | null;
  profile: Profile | null;
  driver: Driver | null;
  merchant: Merchant | null;
  travelPartner: TravelPartner | null;
  marketVendor: MarketVendor | null;
  wallet: Wallet | null;
  loading: boolean;       // inisialisasi awal
  ready: boolean;
  /** Terisi bila pemuatan profil GAGAL (jaringan mati / sesi ditolak server). Dipakai AuthGate untuk
      menampilkan jalan keluar, bukan memutar "Memuat profil…" selamanya. */
  profileError: string | null;
  init: () => Promise<void>;
  loadProfile: () => Promise<void>;
  refreshWallet: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (p: { email: string; password: string; full_name: string; phone: string }) => Promise<void>;
  signOut: () => Promise<void>;
  /** Keluar yang TIDAK BISA menggantung: dipakai layar "Gagal memuat profil" saat jaringan mati.
      signOut() biasa menunggu panggilan /logout ke server (dan pelepasan token push), dan permintaan
      yang menggantung bukan galat — jadi tanpa batas waktu tombolnya berputar selamanya. */
  signOutLocal: () => Promise<void>;
  /** Sedang dalam alur pemulihan kata sandi (tautan email) — sesi ada tetapi pengguna harus membuat kata sandi baru dulu */
  recovery: boolean;
  setRecovery: (v: boolean) => void;
  /** Rute tujuan sekali pakai saat boot tanpa sesi (mis. tautan pemulihan kedaluwarsa → /(auth)/forgot) */
  pendingRoute: string | null;
  setPendingRoute: (r: string | null) => void;
  updateProfile: (p: Partial<Pick<Profile, 'full_name' | 'phone' | 'avatar_url'>>) => Promise<void>;
}

let subscribed = false;

/** Hapus sesi Supabase yang tersimpan (kunci "sb-<ref>-auth-token") tanpa menyentuh jaringan. */
async function purgePersistedSession(): Promise<void> {
  const hit = (k: string) => /^sb-.*-auth-token(-code-verifier)?$/.test(k);
  try {
    if (Platform.OS === 'web') {
      if (typeof localStorage === 'undefined') return;
      Object.keys(localStorage).filter(hit).forEach((k) => localStorage.removeItem(k));
    } else {
      const keys = await AsyncStorage.getAllKeys();
      const mine = keys.filter(hit);
      if (mine.length) await AsyncStorage.multiRemove(mine);
    }
  } catch { /* penyimpanan tidak tersedia — abaikan */ }
}

/** Galat yang berarti "sesi ini tidak lagi sah" — token kedaluwarsa, dicabut admin, atau akun dihapus.
    Dibedakan dari galat jaringan karena penanganannya berbeda: yang ini harus keluar, bukan coba lagi. */
function isAuthRejection(error: { message?: string; code?: string } | null | undefined): boolean {
  if (!error) return false;
  const m = (error.message ?? '').toLowerCase();
  return m.includes('jwt') || m.includes('token') || m.includes('unauthorized')
    || m.includes('invalid claim') || m.includes('not authenticated') || error.code === 'PGRST301';
}

export const useAuth = create<AuthState>((set, get) => ({
  session: null, profile: null, driver: null, merchant: null, travelPartner: null, marketVendor: null, wallet: null, loading: true, ready: false, profileError: null,

  init: async () => {
    const { data } = await supabase.auth.getSession();
    // `ready` HARUS menyala begitu status sesi diketahui, TANPA menunggu profil. Bila pemuatan profil
    // ditunggu di sini dan jaringan menggantung, RootLayout terkunci di <Loading/> tanpa teks selamanya
    // (di ponsel: layar splash tidak pernah hilang) sehingga jalan keluar 8 detik di AuthGate —
    // "Gagal memuat profil" + "Coba lagi"/"Masuk dengan akun lain" — tidak pernah sempat tampil.
    set({ session: data.session, loading: false, ready: true });
    if (data.session) void get().loadProfile();
    if (!subscribed) {
      subscribed = true;
      supabase.auth.onAuthStateChange((event, session) => {
        if (event === 'PASSWORD_RECOVERY') set({ recovery: true });
        set({ session });
        if (session) get().loadProfile();
        else set({ profile: null, driver: null, merchant: null, travelPartner: null, marketVendor: null, wallet: null });
      });
    }
  },

  loadProfile: async () => {
    const uid = get().session?.user.id;
    if (!uid) return;
    try {
      const rows = await Promise.all([
        supabase.from('profiles').select('*').eq('id', uid).maybeSingle(),
        supabase.from('drivers').select('*').eq('id', uid).maybeSingle(),
        supabase.from('merchants').select('*').eq('owner_id', uid).maybeSingle(),
        supabase.from('travel_partners').select('*').eq('id', uid).maybeSingle(),
        supabase.from('wallets').select('*').eq('user_id', uid).maybeSingle(),
        supabase.from('market_vendors').select('*').eq('id', uid).maybeSingle(),
      ]);
      const [{ data: profile }, { data: driver }, { data: merchant }, { data: travel }, { data: wallet }, { data: vendor }] = rows;

      // Sesi ditolak server (token kedaluwarsa/dicabut/akun dihapus): JANGAN diam — keluarkan pengguna
      // ke layar masuk. Sebelumnya galat ini ditelan, profile tetap null, dan AuthGate memutar
      // "Memuat profil…" tanpa batas sehingga aplikasi tampak macet total.
      if (rows.some((r) => isAuthRejection(r.error))) {
        await supabase.auth.signOut().catch(() => {});
        set({ session: null, profile: null, driver: null, merchant: null, travelPartner: null, marketVendor: null, wallet: null, profileError: null });
        return;
      }
      // Profil wajib ada; kegagalan lain (jaringan) ditandai supaya UI bisa menawarkan "Coba lagi".
      const err = rows.find((r) => r.error)?.error;
      if (err && !profile) { set({ profileError: friendlyError(err.message) }); return; }

      set({ profile: (profile as Profile) ?? null, driver: (driver as Driver) ?? null, merchant: (merchant as Merchant) ?? null, travelPartner: (travel as TravelPartner) ?? null, marketVendor: (vendor as MarketVendor) ?? null, wallet: (wallet as Wallet) ?? null, profileError: null });
    } catch (ex) {
      set({ profileError: friendlyError((ex as Error).message) });
    }
  },

  refreshWallet: async () => {
    const uid = get().session?.user.id;
    if (!uid) return;
    const { data } = await supabase.from('wallets').select('*').eq('user_id', uid).maybeSingle();
    if (data) set({ wallet: data as Wallet });
  },

  signIn: async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    if (error) throw new Error(friendlyError(error.message));
    // Set sesi & muat profil sebelum navigasi agar tidak "memantul" kembali ke halaman masuk
    set({ session: data.session });
    await get().loadProfile();
  },

  signUp: async ({ email, password, full_name, phone }) => {
    const cleanPhone = phone.replace(/\s|-/g, '').replace(/^0/, '+62');
    const { data, error } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(), password, options: { data: { full_name: full_name.trim(), phone: cleanPhone } },
    });
    if (error) throw new Error(friendlyError(error.message));
    if (data.user && data.user.identities && data.user.identities.length === 0) throw new Error('Email sudah terdaftar, silakan masuk');
    if (!data.session) {
      // Email auto-terkonfirmasi oleh trigger DB; langsung masuk
      const { data: d2, error: e2 } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
      if (e2) throw new Error(friendlyError(e2.message));
      set({ session: d2.session });
    } else set({ session: data.session });
    await get().loadProfile();
  },

  recovery: peekBootRecovery() === 'tokens',
  setRecovery: (v) => set({ recovery: v }),
  pendingRoute: peekBootRecovery() === 'error' ? '/(auth)/forgot' : null,
  setPendingRoute: (r) => set({ pendingRoute: r }),

  signOut: async () => {
    await supabase.auth.signOut();
    set({ session: null, recovery: false, profile: null, driver: null, merchant: null, travelPartner: null, marketVendor: null, wallet: null, profileError: null });
  },

  signOutLocal: async () => {
    // Beri kesempatan jalur normal (lepas token push + /logout) selesai, tetapi jangan pernah
    // menunggu lebih dari 2,5 detik.
    await Promise.race([
      get().signOut().catch(() => {}),
      new Promise<void>((r) => setTimeout(r, 2500)),
    ]);
    // Apa pun hasilnya: buang sesi yang tersimpan supaya memuat ulang halaman tidak mengembalikan
    // sesi rusak yang sama, lalu kosongkan state.
    await purgePersistedSession();
    set({ session: null, recovery: false, profile: null, driver: null, merchant: null, travelPartner: null, marketVendor: null, wallet: null, profileError: null });
  },

  updateProfile: async (p) => {
    const uid = get().session?.user.id;
    if (!uid) return;
    const { error } = await supabase.from('profiles').update(p).eq('id', uid);
    if (error) throw new Error(friendlyError(error.message));
    await get().loadProfile();
  },
}));

export const useUserId = () => useAuth((s) => s.session?.user.id ?? null);
