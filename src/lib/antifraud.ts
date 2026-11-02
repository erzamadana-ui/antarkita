// Anti order fiktif (migrasi 0121) — helper MURNI untuk aplikasi Pelanggan & Mitra.
//
// Server (create_order / driver_report_no_show) melempar pesan berawalan KODE TETAP supaya UI bisa
// memetakan ke CTA yang tepat. Kode persis dari supabase/migrations/0121_anti_order_fiktif.sql:
//   PHONE_REQUIRED: …          → CTA "Isi nomor HP" (/account/edit)
//   CASH_BLOCKED: … sampai …   → CTA "Beli AntarVoucher" (/pay/voucher) — hanya paid_via 'cash'
//   ORDER_RATE: maksimal N …   → tunggu (tanpa CTA)
//   NEW_ACCOUNT_CASH_CAP: …    → saran bayar saldo AntarVoucher
//   NOSHOW_WAIT: tunggu minimal N menit … → driver harus menunggu (sisa menit dihitung dari arrived_at)
// Pesan sudah melewati friendlyError (src/lib/supabase.ts) yang MEMPERTAHANKAN prefix ≤ 40 karakter.
// Diuji tanpa server: scripts/test-antifraud-parse.mjs.

export type OrderErrorCode = 'PHONE_REQUIRED' | 'CASH_BLOCKED' | 'ORDER_RATE' | 'NEW_ACCOUNT_CASH_CAP';
export type OrderErrorCta = 'phone' | 'voucher' | 'wallet' | 'wait';

export interface ParsedOrderError {
  code: OrderErrorCode;
  /** Teks server tanpa prefix kode (sudah berbahasa Indonesia). */
  text: string;
  /** Judul singkat untuk dialog/toast. */
  title: string;
  cta: OrderErrorCta;
  /** Label tombol CTA (null untuk 'wait'). */
  ctaLabel: string | null;
  /** Rute tujuan CTA (null untuk 'wait'/'wallet'). */
  route: string | null;
  /** Nominal batas tunai (NEW_ACCOUNT_CASH_CAP) bila bisa dibaca dari pesan. */
  cashMax?: number | null;
  /** Tanggal blokir tunai (CASH_BLOCKED) bila bisa dibaca dari pesan (teks apa adanya). */
  until?: string | null;
}

const CODES: OrderErrorCode[] = ['PHONE_REQUIRED', 'CASH_BLOCKED', 'ORDER_RATE', 'NEW_ACCOUNT_CASH_CAP'];

export const PHONE_EDIT_ROUTE = '/account/edit';
export const VOUCHER_ROUTE = '/pay/voucher';

/** Baca angka rupiah "Rp100.000" / "Rp 100000" → 100000. */
export function parseRupiah(text: string): number | null {
  const m = /Rp\s?([\d.]+)/i.exec(text);
  if (!m) return null;
  const n = Number(m[1].replace(/\./g, ''));
  return Number.isFinite(n) ? n : null;
}

/** Pecah pesan galat create_order menjadi kode + CTA. null bila bukan galat antifraud. */
export function parseOrderError(e: unknown): ParsedOrderError | null {
  const msg = typeof e === 'string' ? e : ((e as Error)?.message ?? String(e ?? ''));
  const m = /^\s*([A-Z_]+):\s*(.*)$/s.exec(msg);
  if (!m || !CODES.includes(m[1] as OrderErrorCode)) return null;
  const code = m[1] as OrderErrorCode;
  const text = m[2].trim();
  switch (code) {
    case 'PHONE_REQUIRED':
      return { code, text: text || 'Lengkapi nomor telepon di profil sebelum memesan.', title: 'Nomor HP diperlukan', cta: 'phone', ctaLabel: 'Isi nomor HP', route: PHONE_EDIT_ROUTE };
    case 'CASH_BLOCKED': {
      const until = /sampai\s+([^\s]+(?:\s+\d{1,2}[:.]\d{2})?)/i.exec(text)?.[1] ?? null;
      return { code, text: text || 'Pembayaran tunai dinonaktifkan untuk akun Anda. Gunakan saldo AntarVoucher.', title: 'Tunai dinonaktifkan sementara', cta: 'voucher', ctaLabel: 'Beli AntarVoucher', route: VOUCHER_ROUTE, until };
    }
    case 'ORDER_RATE':
      return { code, text: text || 'Terlalu banyak pesanan dalam satu jam. Coba lagi beberapa saat.', title: 'Terlalu banyak pesanan', cta: 'wait', ctaLabel: null, route: null };
    case 'NEW_ACCOUNT_CASH_CAP':
      return { code, text: text || 'Akun baru hanya bisa bayar tunai dengan nominal terbatas. Gunakan saldo AntarVoucher.', title: 'Batas tunai akun baru', cta: 'wallet', ctaLabel: 'Bayar dengan AntarVoucher', route: null, cashMax: parseRupiah(text) };
  }
}

/** Galat NOSHOW_WAIT → sisa menit yang harus ditunggu driver (dari arrived_at bila ada). null bila bukan NOSHOW_WAIT. */
export function parseNoShowWait(e: unknown, arrivedAt?: string | null, now: number = Date.now()): { waitMinutes: number; leftMinutes: number; text: string } | null {
  const msg = typeof e === 'string' ? e : ((e as Error)?.message ?? String(e ?? ''));
  const m = /^\s*NOSHOW_WAIT:\s*(.*)$/s.exec(msg);
  if (!m) return null;
  const wait = Number(/(\d+(?:[.,]\d+)?)\s*menit/i.exec(m[1])?.[1]?.replace(',', '.')) || 0;
  let left = wait;
  if (arrivedAt) {
    const since = (now - new Date(arrivedAt).getTime()) / 60000;
    left = Math.max(0, wait - since);
  }
  const leftRounded = Math.max(1, Math.ceil(left));
  return { waitMinutes: wait, leftMinutes: leftRounded, text: `Tunggu ${leftRounded} menit lagi di titik jemput sebelum melaporkan pelanggan tidak hadir (minimal ${wait} menit sejak tiba).` };
}

/** Sisa menit sebelum driver boleh melapor no-show (klien; server tetap penjaga akhir). */
export function noShowMinutesLeft(arrivedAt: string | null | undefined, waitMinutes: number, now: number = Date.now()): number {
  if (!arrivedAt) return waitMinutes;
  const since = (now - new Date(arrivedAt).getTime()) / 60000;
  return Math.max(0, Math.ceil(waitMinutes - since));
}

// ----------------------------------------------------------------------- notifikasi ramah
/**
 * Teks ramah untuk notifikasi antifraud & re-assign dispatch (0121/0122):
 *   data.kind 'antifraud_*' (strike / cash_blocked / suspended / cleared) dan data.event 'driver_released'.
 * Mengembalikan null bila bukan notifikasi semacam itu (UI memakai judul/isi asli).
 */
export function friendlyNotifText(data: Record<string, unknown> | null | undefined): { title: string; body: string; tone: 'info' | 'warning' | 'danger' | 'success' } | null {
  const d = data ?? {};
  const kind = typeof d.kind === 'string' ? d.kind : '';
  const event = typeof d.event === 'string' ? d.event : '';
  if (event === 'driver_released') {
    return { title: 'Driver diganti', body: 'Driver sebelumnya tidak bergerak ke lokasi Anda. Kami sedang mencarikan driver lain — mohon tunggu sebentar.', tone: 'info' };
  }
  if (kind === 'accept_no_move') {
    return { title: 'Order dilepas otomatis', body: 'Anda tidak bergerak ke titik jemput setelah menerima order, jadi order dialihkan ke driver lain dan tercatat sebagai strike. Terima order hanya bila Anda siap berangkat.', tone: 'warning' };
  }
  if (!kind.startsWith('antifraud')) return null;
  if (/suspend/.test(kind)) return { title: 'Akun ditangguhkan', body: 'Akun Anda ditangguhkan karena beberapa laporan tidak hadir di titik jemput. Hubungi CS AntarKita untuk peninjauan.', tone: 'danger' };
  if (/cash_block/.test(kind)) return { title: 'Pembayaran tunai dinonaktifkan', body: 'Karena laporan tidak hadir, pembayaran tunai dinonaktifkan sementara. Anda tetap bisa memesan dengan saldo AntarVoucher.', tone: 'warning' };
  if (/clear/.test(kind)) return { title: 'Catatan pelanggaran dihapus', body: 'Admin menghapus catatan pelanggaran Anda. Semua metode pembayaran kembali tersedia.', tone: 'success' };
  return { title: 'Laporan tidak hadir', body: 'Driver melaporkan Anda tidak hadir di titik jemput. Pastikan Anda siap saat driver tiba — laporan berulang membatasi pembayaran tunai.', tone: 'warning' };
}

// ----------------------------------------------------------------------- status pelanggan
/** Bentuk `my_antifraud_status()` (kontrak 0121). */
export interface MyAntifraudStatus {
  strike_count: number;
  cash_blocked_until: string | null;
  cash_blocked: boolean;
  phone_verified: boolean;
  account_age_hours: number;
  is_new_account: boolean;
  cash_max_now: number | null;
  orders_last_hour: number;
  active_orders: number;
  strikes: { kind: string; created_at: string; order_id: string | null }[];
  limits: Record<string, unknown>;
}

/** Banner yang perlu ditampilkan di checkout berdasarkan status antifraud (null = tidak ada). */
export function antifraudBanner(st: MyAntifraudStatus | null | undefined, subtotal?: number | null): { text: string; tone: 'warning' | 'danger' | 'info' } | null {
  if (!st) return null;
  if (st.cash_blocked) {
    const until = st.cash_blocked_until ? new Date(st.cash_blocked_until) : null;
    const untilTxt = until && !Number.isNaN(until.getTime()) ? ` sampai ${until.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}` : '';
    return { tone: 'danger', text: `Pembayaran tunai dinonaktifkan${untilTxt} karena ${st.strike_count} laporan tidak hadir. Gunakan saldo AntarVoucher.` };
  }
  if (st.strike_count > 0) {
    return { tone: 'warning', text: `${st.strike_count} laporan tidak hadir tercatat di akun Anda. Pastikan Anda siap saat driver tiba — laporan ke-2 menonaktifkan pembayaran tunai.` };
  }
  if (st.is_new_account && st.cash_max_now != null && subtotal != null && subtotal > st.cash_max_now) {
    return { tone: 'info', text: `Akun baru: pembayaran tunai maksimal Rp${st.cash_max_now.toLocaleString('id-ID')} selama 24 jam pertama. Pesanan ini lebih besar — gunakan saldo AntarVoucher.` };
  }
  if (!st.phone_verified) {
    return { tone: 'info', text: 'Lengkapi nomor HP di profil Anda agar pesanan bisa dibuat dan driver bisa menghubungi Anda.' };
  }
  return null;
}
