// Status PIN panel admin (sesi terbuka/terkunci) — dipakai gerbang PIN & layar yang memanggil RPC sensitif
import { create } from 'zustand';
import { router } from 'expo-router';
import { rpc } from '@/lib/supabase';
import { toast } from '@/components/ui';

export interface AdminPinStatus { has_pin: boolean; unlocked: boolean; unlocked_until: string | null; locked_until: string | null; session_minutes: number }

interface AdminSecurityState {
  status: AdminPinStatus | null;
  loaded: boolean;
  modal: boolean;                       // paksa tampilkan modal PIN (mis. setelah error ADMIN_LOCKED)
  refresh: () => Promise<AdminPinStatus | null>;
  unlock: (pin: string) => Promise<AdminPinStatus | null>;
  lock: () => Promise<void>;
  openModal: () => void;
  closeModal: () => void;
  /** Pastikan sesi terbuka sebelum tindakan sensitif. Mengembalikan true bila boleh lanjut. */
  ensureUnlocked: () => Promise<boolean>;
}

export const useAdminSecurity = create<AdminSecurityState>((set, get) => ({
  status: null, loaded: false, modal: false,
  refresh: async () => {
    try {
      const st = await rpc<AdminPinStatus | null>('admin_pin_status');
      const norm = st ? { ...st, has_pin: !!st.has_pin, unlocked: !!st.unlocked } : null;
      set({ status: norm, loaded: true, modal: get().modal && !!norm && !norm.unlocked });
      return norm;
    } catch { set({ loaded: true }); return get().status; }
  },
  unlock: async (pin) => {
    // 0115 G-06: PIN salah tidak lagi RAISE (supaya counter & lockout tersimpan) — RPC mengembalikan {ok:false, error, failed, locked_until}
    const st = await rpc<AdminPinStatus & { ok?: boolean; error?: string; failed?: number }>('admin_unlock', { p_pin: pin });
    if (st && st.ok === false) {
      set((s) => ({ status: s.status ? { ...s.status, unlocked: false, locked_until: st.locked_until ?? s.status.locked_until } : s.status }));
      throw new Error(st.error || 'PIN salah');
    }
    const norm = { ...st, has_pin: !!st.has_pin, unlocked: !!st.unlocked };
    set({ status: norm, modal: false });
    return norm;
  },
  lock: async () => {
    await rpc('admin_lock');
    set((s) => ({ status: s.status ? { ...s.status, unlocked: false, unlocked_until: null } : s.status }));
  },
  openModal: () => set({ modal: true }),
  closeModal: () => set({ modal: false }),
  ensureUnlocked: async () => {
    const st = await get().refresh();
    if (!st || !st.has_pin) { toast.error('Atur PIN panel admin dulu di Pusat Keamanan'); router.push('/(admin)/security' as never); return false; }
    if (!st.unlocked) { set({ modal: true }); return false; }
    return true;
  },
}));

/** Tangani error RPC sensitif: ADMIN_PIN_REQUIRED → arahkan ke Pusat Keamanan; ADMIN_LOCKED → tampilkan modal PIN. Mengembalikan true bila ditangani. */
export function handleAdminError(e: unknown): boolean {
  const msg = String((e as Error)?.message ?? e ?? '');
  if (msg.includes('ADMIN_PIN_REQUIRED')) {
    toast.error('Atur PIN 6 digit di Pusat Keamanan sebelum tindakan sensitif');
    useAdminSecurity.getState().refresh();
    router.push('/(admin)/security' as never);
    return true;
  }
  if (msg.includes('ADMIN_LOCKED')) {
    toast.error('Sesi panel terkunci — masukkan PIN untuk melanjutkan');
    useAdminSecurity.setState({ modal: true });
    useAdminSecurity.getState().refresh();
    return true;
  }
  toast.error(msg.replace(/^ADMIN_[A-Z_]+:\s*/, '') || 'Terjadi kesalahan');
  return false;
}
