// Preferensi metode pembayaran pelanggan (tunai / AntarPay / e-wallet pilihan) — tersimpan di tabel payment_prefs
import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import type { PaymentPrefs } from '@/lib/types';

interface S { prefs: PaymentPrefs | null; loaded: boolean; load: (uid: string) => Promise<void>; save: (uid: string, p: Partial<PaymentPrefs>) => Promise<void> }
export const usePayPrefs = create<S>((set, get) => ({
  prefs: null, loaded: false,
  load: async (uid) => {
    const { data } = await supabase.from('payment_prefs').select('*').eq('user_id', uid).maybeSingle();
    set({ prefs: (data as PaymentPrefs) ?? { user_id: uid, default_method: 'cash', ewallet: null }, loaded: true });
  },
  save: async (uid, p) => {
    const next = { ...(get().prefs ?? { user_id: uid, default_method: 'cash', ewallet: null }), ...p, user_id: uid } as PaymentPrefs;
    set({ prefs: next });
    await supabase.from('payment_prefs').upsert({ user_id: uid, default_method: next.default_method, ewallet: next.ewallet, updated_at: new Date().toISOString() });
  },
}));

export const EWALLETS = [
  { key: 'gopay', label: 'GoPay', color: '#00AA13', icon: 'wallet' },
  { key: 'ovo', label: 'OVO', color: '#4C2A86', icon: 'wallet' },
  { key: 'dana', label: 'DANA', color: '#118EEA', icon: 'wallet' },
  { key: 'shopeepay', label: 'ShopeePay', color: '#EE4D2D', icon: 'wallet' },
  { key: 'qris', label: 'QRIS', color: '#0B1F2A', icon: 'qr-code' },
  { key: 'bank_transfer', label: 'VA Bank', color: '#2F80ED', icon: 'business' },
] as const;
export type EwalletKey = typeof EWALLETS[number]['key'];

/**
 * Saluran pembayaran yang bisa dinyalakan/dimatikan admin satu per satu (migrasi 0089).
 * Urutannya = urutan tampil di Panel Admin dan di aplikasi pelanggan.
 * Kunci HARUS sama dengan `payment_channel_keys()` di server.
 */
export const PAYMENT_CHANNELS = [
  { key: 'cash', label: 'Tunai / COD', hint: 'Bayar langsung ke driver / kurir', icon: 'cash-outline', color: '#16A34A' },
  { key: 'antarpay', label: 'AntarPay (saldo)', hint: 'Saldo dompet dipotong otomatis', icon: 'wallet-outline', color: '#0E7C7B' },
  { key: 'emoney_nfc', label: 'E-money (kartu NFC)', hint: 'Flazz · e-money Mandiri · BRIZZI · TapCash', icon: 'radio-outline', color: '#7C3AED' },
  { key: 'gopay', label: 'GoPay', hint: 'Midtrans Snap', icon: 'phone-portrait-outline', color: '#00AA13' },
  { key: 'shopeepay', label: 'ShopeePay', hint: 'Midtrans Snap', icon: 'phone-portrait-outline', color: '#EE4D2D' },
  { key: 'qris', label: 'QRIS', hint: 'Semua aplikasi pembayaran QRIS', icon: 'qr-code-outline', color: '#0B1F2A' },
  { key: 'ovo', label: 'OVO', hint: 'Dilayani lewat QRIS', icon: 'phone-portrait-outline', color: '#4C2A86' },
  { key: 'dana', label: 'DANA', hint: 'Dilayani lewat QRIS', icon: 'phone-portrait-outline', color: '#118EEA' },
  { key: 'bank_transfer', label: 'Transfer bank (VA)', hint: 'BCA · Mandiri · BNI · BRI · Permata', icon: 'business-outline', color: '#2F80ED' },
  { key: 'card', label: 'Kartu kredit/debit', hint: 'Visa · Mastercard · JCB', icon: 'card-outline', color: '#334155' },
] as const;
export type PaymentChannelKey = typeof PAYMENT_CHANNELS[number]['key'];
/** Saluran yang dilayani payment gateway (disinkronkan ke `pg_methods`). */
export const GATEWAY_CHANNELS: string[] = ['gopay', 'shopeepay', 'qris', 'ovo', 'dana', 'bank_transfer', 'card'];
/** Label saluran untuk pesan/daftar (mengikuti `payment_channel_label()` di server). */
export const channelLabel = (key: string) => PAYMENT_CHANNELS.find((c) => c.key === key)?.label ?? key;
