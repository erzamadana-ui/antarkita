// Ekspor CSV dari panel admin: dicatat ke log keamanan (admin.export) lalu diunduh (web) — di native hanya pemberitahuan
import { Platform, Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { rpc } from '@/lib/supabase';
import { toast } from '@/components/ui';
import type { PayoutExportRow } from '@/lib/voucherV5';

const cell = (v: unknown) => {
  if (v == null) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((r) => r.map(cell).join(',')).join('\n');
}

/** Catat ekspor ke security_events lalu unduh. `what` = nama data (users/finance/orders). */
export async function adminExportCsv(what: string, filename: string, headers: string[], rows: unknown[][]): Promise<void> {
  if (Platform.OS !== 'web' || typeof document === 'undefined') { toast.show('Ekspor tersedia di versi web'); return; }
  if (!rows.length) { toast.error('Tidak ada data untuk diekspor'); return; }
  try { await rpc('admin_log_event', { p_kind: 'admin.export', p_detail: { what, rows: rows.length, filename } }); }
  catch (e) { toast.error((e as Error).message); return; }
  const blob = new Blob(['﻿' + toCsv(headers, rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast.success(`${rows.length} baris diekspor · tercatat di log keamanan`);
}

/* ───────────── AntarVoucher v5 — CSV transfer massal bank (KONTRAK-V5 §3 admin_payout_batch_export) ───────────── */

/** Kolom CSV transfer massal: nama, bank, no rekening, nominal, berita (format umum template transfer massal bank). */
export const PAYOUT_CSV_HEADERS = ['nama', 'bank', 'no rekening', 'nominal', 'berita'] as const;

/** Baris CSV dari hasil `admin_payout_batch_export`. Nominal bilangan bulat rupiah tanpa pemisah ribuan. */
export function payoutRowsToCsv(rows: PayoutExportRow[]): string {
  return toCsv([...PAYOUT_CSV_HEADERS], rows.map((r) => [
    r.account_name || r.name || '', r.bank_code || '', r.account_no || '', Math.round(Number(r.amount || 0)), r.note || `AntarKita payout ${r.withdrawal_id.slice(0, 8)}`,
  ]));
}

/**
 * Unduh CSV transfer massal untuk satu batch pencairan.
 * Web: unduh berkas; native: buka lembar bagikan + salin ke papan klip (tidak ada akses sistem berkas tanpa modul tambahan).
 * Ekspor dicatat ke security_events (admin.export) seperti ekspor lain; galat log dilempar ke pemanggil (jangan ditelan).
 */
export async function exportPayoutBatchCsv(batchId: string, rows: PayoutExportRow[]): Promise<void> {
  if (!rows.length) { toast.error('Batch tidak punya baris untuk diekspor'); return; }
  const filename = `transfer-massal-${batchId.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.csv`;
  await rpc('admin_log_event', { p_kind: 'admin.export', p_detail: { what: 'payout_batch', batch_id: batchId, rows: rows.length, filename } });
  const csv = payoutRowsToCsv(rows);
  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast.success(`${rows.length} baris transfer diunduh (${filename})`);
    return;
  }
  await Clipboard.setStringAsync(csv);
  try { await Share.share({ title: filename, message: csv }); toast.success(`${rows.length} baris transfer dibagikan & disalin ke papan klip`); }
  catch { toast.show('CSV disalin ke papan klip'); }
}
