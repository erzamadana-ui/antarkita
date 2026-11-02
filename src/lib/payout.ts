// Rekening pencairan mitra wajib + auto-sweep (migrasi 0123) — tipe & helper MURNI.
//
// Kontrak (docs/KONTRAK-31OKT.md §0123):
//   partner_payout_account_mine() → ada: {exists:true, required, id, channel, bank_code, bank_name, account_no,
//     account_no_masked, account_name, verified, verified_at, auto_sweep, min_sweep, sweep_enabled, created_at, updated_at}
//     belum ada: {exists:false, required, channels[], banks:[{code,name}], min_sweep, sweep_enabled}
//   partner_payout_account_set(p) — p = {channel, bank_code (wajib bila 'bank'), account_no, account_name, auto_sweep?}
//     e-wallet: account_no = nomor HP 08xx (9–15 digit); ganti nomor/bank/saluran → verified direset.
//   Penjaga 'PAYOUT_ACCOUNT_REQUIRED: …' di driver_set_online(true), register_driver (langkah akhir),
//     travel_partner_register, merchant_set_open(true), request_withdrawal.
//   Auto-sweep: 3 sesi/hari (09:00/13:00/17:00 WIB), saldo − cadangan ≥ min_sweep, approved otomatis bila verified.
// Diuji tanpa server: scripts/test-antifraud-parse.mjs.

export type PayoutChannel = 'bank' | 'dana' | 'ovo' | 'linkaja' | 'gopay' | 'shopeepay';
export const PAYOUT_CHANNELS: { key: PayoutChannel; label: string; icon: string; color: string }[] = [
  { key: 'bank', label: 'Bank', icon: 'business-outline', color: '#187A85' },
  { key: 'dana', label: 'DANA', icon: 'phone-portrait-outline', color: '#118EEA' },
  { key: 'ovo', label: 'OVO', icon: 'phone-portrait-outline', color: '#4C3494' },
  { key: 'linkaja', label: 'LinkAja', icon: 'phone-portrait-outline', color: '#E31E24' },
  { key: 'gopay', label: 'GoPay', icon: 'phone-portrait-outline', color: '#00AED6' },
  { key: 'shopeepay', label: 'ShopeePay', icon: 'phone-portrait-outline', color: '#EE4D2D' },
];
export const EWALLET_CHANNELS: PayoutChannel[] = ['dana', 'ovo', 'linkaja', 'gopay', 'shopeepay'];
export const PAYOUT_SESSIONS = ['09:00', '13:00', '17:00'] as const;
export const PAYOUT_ACCOUNT_ROUTE = '/payout-account';

export interface PayoutBank { code: string; name: string }
export interface PayoutAccountMine {
  exists: boolean; required: boolean; min_sweep: number; sweep_enabled: boolean;
  id?: string; channel?: PayoutChannel; bank_code?: string | null; bank_name?: string; account_no?: string; account_no_masked?: string;
  account_name?: string; verified?: boolean; verified_at?: string | null; auto_sweep?: boolean; created_at?: string; updated_at?: string;
  channels?: PayoutChannel[]; banks?: PayoutBank[];
}
export interface PayoutAccountForm { channel: PayoutChannel; bank_code: string | null; account_no: string; account_name: string; auto_sweep: boolean }

export const channelLabel = (c: PayoutChannel | string | null | undefined) => PAYOUT_CHANNELS.find((x) => x.key === c)?.label ?? (c ? String(c).toUpperCase() : '-');
export const isEwallet = (c: PayoutChannel | string | null | undefined) => EWALLET_CHANNELS.includes(c as PayoutChannel);

/** Hanya digit (nomor rekening / HP). */
export const digitsOnly = (v: string) => (v ?? '').replace(/\D/g, '');

/**
 * Validasi klien — cermin aturan payout_account_upsert_internal (0123). Mengembalikan pesan galat
 * pertama atau null bila layak dikirim; server tetap memvalidasi ulang.
 */
export function validatePayoutForm(f: PayoutAccountForm): string | null {
  if (!PAYOUT_CHANNELS.some((c) => c.key === f.channel)) return 'Pilih saluran pencairan';
  const name = (f.account_name ?? '').trim();
  if (name.length < 3) return 'Nama pemilik rekening minimal 3 huruf';
  const no = digitsOnly(f.account_no);
  if (f.channel === 'bank') {
    if (!f.bank_code) return 'Pilih bank tujuan';
    if (no.length < 6 || no.length > 20) return 'Nomor rekening harus 6–20 digit';
  } else if (!/^08[0-9]{7,13}$/.test(no)) return 'Nomor e-wallet harus nomor HP 08xx (9–15 digit)';
  return null;
}

/** Payload `p` untuk partner_payout_account_set / register_*.payout_account. */
export function payoutPayload(f: PayoutAccountForm): Record<string, unknown> {
  return {
    channel: f.channel,
    bank_code: f.channel === 'bank' ? f.bank_code : f.channel,
    account_no: digitsOnly(f.account_no),
    account_name: f.account_name.trim(),
    auto_sweep: !!f.auto_sweep,
  };
}

/** Isi form dari rekening tersimpan (atau default kosong). */
export function formFromMine(m: PayoutAccountMine | null | undefined): PayoutAccountForm {
  if (!m?.exists) return { channel: 'bank', bank_code: null, account_no: '', account_name: '', auto_sweep: true };
  return { channel: (m.channel ?? 'bank') as PayoutChannel, bank_code: m.channel === 'bank' ? (m.bank_code ?? null) : null, account_no: m.account_no ?? '', account_name: m.account_name ?? '', auto_sweep: m.auto_sweep !== false };
}

/** Galat PAYOUT_ACCOUNT_REQUIRED dari server? */
export const isPayoutRequiredError = (e: unknown) => /PAYOUT_ACCOUNT_REQUIRED/i.test((e as Error)?.message ?? String(e ?? ''));

/** Teks ramah pengganti pesan server (menyebut menu yang benar di aplikasi ini). */
export const PAYOUT_REQUIRED_TEXT = 'Rekening pencairan (bank / e-wallet) wajib diisi dulu sebelum Anda bisa online atau menerima pendapatan. Isi sekali, saldo dicairkan otomatis tiap sesi.';

/** Ringkasan rekening satu baris: "BCA •••• 1234 a.n. BUDI" / "DANA 0812… a.n. …". */
export function accountSummary(m: PayoutAccountMine | null | undefined): string | null {
  if (!m?.exists) return null;
  const bank = m.channel === 'bank' ? (m.bank_name ?? m.bank_code ?? 'Bank') : channelLabel(m.channel);
  return `${bank} ${m.account_no_masked ?? m.account_no ?? ''} a.n. ${m.account_name ?? ''}`.trim();
}

/** Status verifikasi untuk badge. */
export function verificationBadge(m: PayoutAccountMine | null | undefined): { text: string; tone: 'success' | 'warning' | 'muted' } {
  if (!m?.exists) return { text: 'Belum diisi', tone: 'muted' };
  return m.verified ? { text: 'Terverifikasi', tone: 'success' } : { text: 'Menunggu verifikasi admin', tone: 'warning' };
}

/** Kalimat penjelasan auto-sweep untuk layar pencairan/rekening. */
export function sweepExplanation(m: PayoutAccountMine | null | undefined): string {
  const min = m?.min_sweep ?? 20000;
  const sessions = PAYOUT_SESSIONS.join(' / ');
  if (m && m.sweep_enabled === false) return `Pencairan otomatis sedang dimatikan admin. Ajukan penarikan manual; diproses pada sesi ${sessions} WIB.`;
  if (m?.exists && m.auto_sweep === false) return `Auto-sweep Anda nonaktif — saldo tidak dicairkan otomatis. Ajukan penarikan manual; diproses pada sesi ${sessions} WIB.`;
  return `Auto-sweep aktif: saldo di atas cadangan (minimal Rp${min.toLocaleString('id-ID')}) dicairkan otomatis ke rekening ini pada sesi ${sessions} WIB tanpa perlu mengajukan. Rekening terverifikasi cair otomatis; belum terverifikasi menunggu persetujuan admin sekali.`;
}
