import { create } from 'zustand';
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
  init: () => Promise<void>;
  loadProfile: () => Promise<void>;
  refreshWallet: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (p: { email: string; password: string; full_name: string; phone: string }) => Promise<void>;
  signOut: () => Promise<void>;
  /** Sedang dalam alur pemulihan kata sandi (tautan email) — sesi ada tetapi pengguna harus membuat kata sandi baru dulu */
  recovery: boolean;
  setRecovery: (v: boolean) => void;
  /** Rute tujuan sekali pakai saat boot tanpa sesi (mis. tautan pemulihan kedaluwarsa → /(auth)/forgot) */
  pendingRoute: string | null;
  setPendingRoute: (r: string | null) => void;
  updateProfile: (p: Partial<Pick<Profile, 'full_name' | 'phone' | 'avatar_url'>>) => Promise<void>;
}

let subscribed = false;

export const useAuth = create<AuthState>((set, get) => ({
  session: null, profile: null, driver: null, merchant: null, travelPartner: null, marketVendor: null, wallet: null, loading: true, ready: false,

  init: async () => {
    const { data } = await supabase.auth.getSession();
    set({ session: data.session });
    if (data.session) await get().loadProfile();
    set({ loading: false, ready: true });
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
    const [{ data: profile }, { data: driver }, { data: merchant }, { data: travel }, { data: wallet }, { data: vendor }] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', uid).maybeSingle(),
      supabase.from('drivers').select('*').eq('id', uid).maybeSingle(),
      supabase.from('merchants').select('*').eq('owner_id', uid).maybeSingle(),
      supabase.from('travel_partners').select('*').eq('id', uid).maybeSingle(),
      supabase.from('wallets').select('*').eq('user_id', uid).maybeSingle(),
      supabase.from('market_vendors').select('*').eq('id', uid).maybeSingle(),
    ]);
    set({ profile: (profile as Profile) ?? null, driver: (driver as Driver) ?? null, merchant: (merchant as Merchant) ?? null, travelPartner: (travel as TravelPartner) ?? null, marketVendor: (vendor as MarketVendor) ?? null, wallet: (wallet as Wallet) ?? null });
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
    set({ session: null, recovery: false, profile: null, driver: null, merchant: null, travelPartner: null, marketVendor: null, wallet: null });
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
