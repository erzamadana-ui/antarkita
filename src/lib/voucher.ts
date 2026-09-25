// AntarVoucher (migrasi 0112) — pembelian voucher lewat transfer ke rekening resmi PT Antar Kita Indonesia.
// Voucher HANYA terbit setelah tim Finance mencocokkan mutasi bank + disetujui admin lain (maker ≠ checker).
// Screenshot bukti transfer tidak pernah menambah saldo; "Saya sudah transfer" hanya informasi bantu pencocokan.
import { rpc } from '@/lib/supabase';
import { colors } from '@/lib/theme';

export type VoucherStatus =
  | 'awaiting_transfer' | 'submitted' | 'matched' | 'amount_mismatch' | 'issued' | 'expired' | 'cancelled'
  | 'rejected' | 'refund_requested' | 'refund_pending' | 'refunded' | 'disputed';

export interface VoucherStatusPublic {
  brand: string;
  enabled: boolean;
  purchase_enabled: boolean;
  banks_ready: number;
  min: number;
  max: number;
  ttl_hours: number;
}

export interface VoucherBankAccount { bank_code: string; bank_name: string; account_no: string; account_name: string }

export interface VoucherPurchase {
  id: string;
  reference: string;
  nominal: number;
  unique_code: number;
  transfer_amount: number;
  status: VoucherStatus;
  expires_at: string;
  created_at?: string;
  updated_at?: string;
  submitted_at?: string | null;
  sender_name?: string | null;
  sender_bank?: string | null;
  received_amount?: number | null;
  issued_amount?: number | null;
  refund_amount?: number | null;
  reason?: string | null;
  /** Hanya ada selama rekening masih terverifikasi (my_voucher_purchases). */
  bank_name?: string | null;
  account_no?: string | null;
  account_name?: string | null;
  idempotent?: boolean;
}

/** Nilai bawaan = default server 0112 (dipakai bila status belum termuat). */
export const VOUCHER_DEFAULTS = { min: 20000, max: 2000000, ttl_hours: 24 };
export const VOUCHER_PRESETS = [50000, 100000, 200000, 500000, 1000000];
export const VOUCHER_OPEN: VoucherStatus[] = ['awaiting_transfer', 'submitted', 'matched', 'amount_mismatch'];

type Tone = 'info' | 'warning' | 'success' | 'danger' | 'neutral';
export const voucherStatusMeta: Record<VoucherStatus, { label: string; hint: string; tone: Tone; icon: string }> = {
  awaiting_transfer: { label: 'Menunggu transfer', hint: 'Transfer tepat sesuai nominal sebelum batas waktu.', tone: 'warning', icon: 'time-outline' },
  submitted: { label: 'Menunggu pencocokan', hint: 'Terima kasih. Tim Finance sedang mencocokkan dana masuk di rekening resmi.', tone: 'info', icon: 'search-outline' },
  matched: { label: 'Dana ditemukan', hint: 'Dana sudah cocok dan menunggu persetujuan akhir. Saldo segera bertambah.', tone: 'info', icon: 'checkmark-done-outline' },
  amount_mismatch: { label: 'Nominal tidak sesuai', hint: 'Dana masuk tidak sama dengan nominal transfer. Tim kami akan menghubungi Anda, atau laporkan masalah.', tone: 'warning', icon: 'alert-circle-outline' },
  issued: { label: 'Berhasil — saldo masuk', hint: 'AntarVoucher sudah ditambahkan ke saldo Anda.', tone: 'success', icon: 'checkmark-circle' },
  expired: { label: 'Kedaluwarsa', hint: 'Batas waktu transfer terlewat. Bila Anda sudah transfer, laporkan masalah agar dana ditelusuri.', tone: 'neutral', icon: 'hourglass-outline' },
  cancelled: { label: 'Dibatalkan', hint: 'Pembelian ini dibatalkan.', tone: 'neutral', icon: 'close-circle-outline' },
  rejected: { label: 'Ditolak', hint: 'Pembelian tidak dapat diproses. Bila dana sudah terkirim, laporkan masalah.', tone: 'danger', icon: 'close-circle' },
  refund_requested: { label: 'Pengembalian diajukan', hint: 'Pengembalian dana sedang diproses tim Finance.', tone: 'info', icon: 'return-down-back-outline' },
  refund_pending: { label: 'Pengembalian diproses', hint: 'Dana sedang dikirim kembali ke rekening pengirim.', tone: 'info', icon: 'return-down-back-outline' },
  refunded: { label: 'Dana dikembalikan', hint: 'Dana sudah dikembalikan ke rekening pengirim.', tone: 'success', icon: 'return-down-back' },
  disputed: { label: 'Sedang ditinjau', hint: 'Laporan Anda sedang ditinjau tim kami. Kami akan menghubungi Anda.', tone: 'warning', icon: 'chatbubble-ellipses-outline' },
};
const toneColor: Record<Tone, string> = { info: colors.info, warning: colors.warning, success: colors.success, danger: colors.danger, neutral: colors.textSecondary };
export const voucherStatusLabel = (st: string) => voucherStatusMeta[st as VoucherStatus]?.label ?? st;
export const voucherStatusColor = (st: string) => toneColor[voucherStatusMeta[st as VoucherStatus]?.tone ?? 'neutral'];

export const canMarkSent = (p: VoucherPurchase, now = Date.now()) => (p.status === 'awaiting_transfer' || p.status === 'submitted') && new Date(p.expires_at).getTime() > now;
export const canCancel = (p: VoucherPurchase) => p.status === 'awaiting_transfer';
export const canDispute = (p: VoucherPurchase) => ['awaiting_transfer', 'submitted', 'expired', 'amount_mismatch', 'rejected', 'cancelled'].includes(p.status);
/** Instruksi transfer (rekening + nominal) masih relevan untuk ditampilkan. */
export const showsInstructions = (p: VoucherPurchase, now = Date.now()) => p.status === 'awaiting_transfer' && new Date(p.expires_at).getTime() > now;

/** Kunci idempotensi acak (tahan ketuk ganda / kirim ulang saat jaringan putus). */
export function newIdempotencyKey(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) { try { return `av-${c.randomUUID()}`; } catch { /* lanjut ke cadangan */ } }
  let s = '';
  for (let i = 0; i < 24; i++) s += Math.floor(Math.random() * 36).toString(36);
  return `av-${Date.now().toString(36)}-${s}`;
}

/** Sisa waktu → "23 jam 05 mnt", "12:34" (di bawah 1 jam), atau "Waktu habis". */
export function formatCountdown(ms: number): string {
  if (ms <= 0) return 'Waktu habis';
  const t = Math.floor(ms / 1000);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  if (h >= 24) return `${Math.floor(h / 24)} hari ${h % 24} jam`;
  if (h > 0) return `${h} jam ${String(m).padStart(2, '0')} mnt`;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/** Nominal bulat (tanpa "Rp") dipisah: bagian depan + 3 digit terakhir (kode unik). */
export function splitTransferAmount(amount: number): { head: string; tail: string } {
  const txt = String(Math.max(0, Math.round(amount))).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return { head: `Rp${txt.slice(0, -3)}`, tail: txt.slice(-3) };   // head sudah diakhiri titik pemisah ribuan
}

/** Validasi nominal di sisi aplikasi (server tetap sumber kebenaran). Mengembalikan pesan galat atau null. */
export function validateNominal(n: number, min: number, max: number, fmt: (v: number) => string): string | null {
  if (!n) return 'Masukkan nominal';
  if (n < min) return `Minimal ${fmt(min)}`;
  if (n > max) return `Maksimal ${fmt(max)}`;
  if (n % 1000 !== 0) return 'Nominal harus kelipatan Rp1.000';
  return null;
}

const ERRORS: [string, string][] = [
  ['VOUCHER_PURCHASE_DISABLED', 'Pembelian AntarVoucher lewat transfer rekening resmi belum dibuka. Silakan gunakan top up instan.'],
  ['VOUCHER_BANK_NOT_READY', 'Rekening resmi untuk bank ini belum tersedia. Pilih bank lain atau coba lagi nanti.'],
  ['VOUCHER_TOO_MANY_OPEN', 'Masih ada pembelian yang berjalan. Selesaikan transfernya atau batalkan dulu sebelum membuat yang baru.'],
  ['VOUCHER_STATE', 'Status pembelian sudah berubah (mungkin sudah diproses atau kedaluwarsa). Muat ulang untuk melihat status terbaru.'],
  ['VOUCHER_BUSY', 'Sistem sedang sibuk. Coba lagi sebentar.'],
  ['SALDO_TIDAK_CUKUP', 'Saldo AntarVoucher tidak cukup untuk transaksi ini.'],
];
/** Pesan ramah untuk kode galat server 0112 (pesan lain diteruskan apa adanya — sudah melalui friendlyError). */
export function voucherError(e: unknown): string {
  const msg = String((e as Error)?.message ?? e ?? '');
  if (msg.includes('VOUCHER_NOMINAL_INVALID')) {
    const rest = msg.split('VOUCHER_NOMINAL_INVALID:')[1]?.trim();
    return rest ? `Nominal tidak valid — ${rest}.` : 'Nominal tidak valid.';
  }
  for (const [code, text] of ERRORS) if (msg.includes(code)) return text;
  return msg || 'Terjadi kesalahan';
}

/** RPC tidak ada di server lama (sebelum 0112). */
export const isMissingRpc = (e: unknown) => /could not find the function|does not exist|PGRST202|schema cache/i.test(String((e as Error)?.message ?? e));

// ---- RPC ----
export const fetchVoucherStatus = () => rpc<VoucherStatusPublic>('voucher_status_public');
export const fetchVoucherBanks = async () => (await rpc<VoucherBankAccount[] | null>('voucher_bank_accounts_public')) ?? [];
export const fetchMyVoucherPurchases = async () => (await rpc<VoucherPurchase[] | null>('my_voucher_purchases')) ?? [];
export const createVoucherPurchase = (nominal: number, bankCode: string, key: string) =>
  rpc<VoucherPurchase>('voucher_purchase_create', { p_nominal: nominal, p_bank_code: bankCode, p_idempotency_key: key });
export const markVoucherSent = (id: string, senderName?: string, senderBank?: string) =>
  rpc<VoucherPurchase>('voucher_purchase_mark_sent', { p_id: id, p_sender_name: senderName?.trim() || null, p_sender_bank: senderBank?.trim() || null });
export const cancelVoucherPurchase = (id: string) => rpc<VoucherPurchase>('voucher_purchase_cancel', { p_id: id });
export const disputeVoucherPurchase = (id: string, reason: string) => rpc<VoucherPurchase>('voucher_purchase_dispute', { p_id: id, p_reason: reason.trim() });

export interface WalletStatement {
  saldo_awal: number; pembelian: number; pendapatan: number; refund_masuk: number; penggunaan: number; refund_keluar: number;
  payout: number; koreksi: number; lain: number; saldo_akhir_hitung: number; saldo_akhir_ledger: number; selisih: number; rumus: string;
  jumlah_mutasi?: number;
}
export const fetchWalletStatement = (uid: string, from: string, to: string) => rpc<WalletStatement>('wallet_statement', { p_user: uid, p_from: from, p_to: to });
