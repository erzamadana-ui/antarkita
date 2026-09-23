// Rincian pendapatan per order dari buku besar (Skema Bisnis v2 §9, migrasi 0099):
//  - DriverEarningBreakdown   → rpc('driver_order_breakdown', { p_order })
//  - MerchantOrderBreakdown   → rpc('merchant_order_breakdown', { p_order })
// Angka TIDAK dihitung ulang di klien: server membaca order_ledger (fase completed → adjusted → created),
// atau kolom orders untuk order lama sebelum buku besar (phase = null).
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Row, Button } from '@/components/ui';
import { Skeleton } from '@/components/motion';
import { PriceSummary, type PriceRow } from '@/components/BookingSheet';
import { rpc } from '@/lib/supabase';
import { colors, font, radius } from '@/lib/theme';
import { rupiah, pctLabel, ONGKIR_FULL_DRIVER } from '@/lib/format';
import type { DriverOrderBreakdown as DriverBd, MerchantOrderBreakdown as MerchantBd, OrderStatus } from '@/lib/types';

/** Muat satu RPC rincian; `dep` (mis. status order) memicu muat ulang saat order berubah fase. */
function useBreakdown<T>(fn: string, orderId: string | null | undefined, dep?: unknown, enabled = true) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    if (!orderId || !enabled) return;
    setLoading(true);
    try { setData(await rpc<T>(fn, { p_order: orderId })); setError(null); }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [fn, orderId, enabled]);
  useEffect(() => { load(); }, [load, dep]);
  return { data, error, loading, reload: load };
}

function ErrorLine({ text, onRetry }: { text: string; onRetry: () => void }) {
  return (
    <View style={s.err}>
      <Row gap={6}><Ionicons name="alert-circle" size={16} color={colors.warning} /><Text style={[font.tiny, { flex: 1, color: colors.text }]}>Rincian belum bisa dimuat: {text}</Text></Row>
      <Button title="Coba lagi" size="sm" variant="ghost" icon="refresh" onPress={onRetry} />
    </View>
  );
}

const LoadingLines = () => <View style={{ gap: 6 }}><Skeleton width="70%" height={12} /><Skeleton width="55%" height={12} /><Skeleton width="80%" height={12} /></View>;

/** Keterangan fase buku besar: order belum selesai = perkiraan; order lama = dari kolom pesanan. */
const phaseNote = (phase: string | null, status?: OrderStatus) =>
  phase == null ? 'Order lama (sebelum buku besar) — rincian dari data pesanan.'
    : phase !== 'completed' && status !== 'completed' ? 'Perkiraan — angka final dicatat saat order selesai.'
      : null;

/** Rincian pendapatan driver per order: Ongkir · Komisi platform x % · Tip · Extras · Bagian biaya layanan · Bonus sesi · Pendapatan bersih. */
export function DriverEarningBreakdown({ orderId, status, title = 'Rincian pendapatan' }: { orderId: string; status?: OrderStatus; title?: string | null }) {
  const { data: b, error, loading, reload } = useBreakdown<DriverBd>('driver_order_breakdown', orderId, status);
  if (!b) return <View style={{ gap: 8 }}>{title ? <Text style={font.h3}>{title}</Text> : null}{error ? <ErrorLine text={error} onRetry={reload} /> : <LoadingLines />}</View>;
  const full = ONGKIR_FULL_DRIVER.includes(b.service);
  const rows: PriceRow[] = [{ label: 'Ongkir', value: b.ongkir ?? 0, keep: true }];
  if (full) rows.push({ label: 'Komisi platform 0 %', value: 0, keep: true, hint: 'Ongkir sepenuhnya milik Anda' });
  else if (b.komisi != null) rows.push({ label: `Komisi platform ${b.komisi_pct != null ? pctLabel(b.komisi_pct) : ''}`.trim(), value: b.komisi, minus: true, keep: true });
  rows.push(
    { label: 'Tip pelanggan', value: b.tip ?? 0 },
    { label: 'Biaya tambahan (extras)', value: b.extras ?? 0 },
    { label: 'Bagian biaya layanan', value: b.service_share ?? 0, hint: 'Porsi Anda dari jasa belanja' },
    { label: 'Bonus sesi', value: b.bonus ?? 0, hint: 'Pengurangan komisi saat sesi bonus berlaku' },
  );
  const cash = b.payment_method === 'cash';
  const recv = b.receivable ?? 0;
  const note = phaseNote(b.phase, status ?? b.status);
  return (
    <View style={{ gap: 10 }}>
      {title ? <Row between><Text style={font.h3}>{title}</Text>{loading ? <Text style={font.tiny}>memperbarui…</Text> : null}</Row> : null}
      <PriceSummary rows={rows} total={b.bersih ?? 0} totalLabel="Pendapatan bersih" note={note} />
      {(b.penggantian_belanja ?? 0) > 0 && (
        <Row between style={s.info}>
          <Text style={[font.small, { flex: 1 }]}>Penggantian belanja yang Anda talangi</Text>
          <Text style={{ fontWeight: '700', color: colors.text }}>{rupiah(b.penggantian_belanja)}</Text>
        </Row>
      )}
      {cash ? (
        <View style={s.cash}>
          <Row gap={8} style={{ alignItems: 'flex-start' }}>
            <Ionicons name="cash-outline" size={18} color={colors.warning} style={{ marginTop: 1 }} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[font.small, { color: colors.text, fontWeight: '700' }]}>
                Anda memegang tunai {rupiah(b.memegang_tunai)}{b.receivable != null ? ` · ${recv >= 0 ? `Setoran ke platform ${rupiah(recv)}` : `Platform mengembalikan ${rupiah(-recv)} ke saldo Anda`}` : ''}
              </Text>
              {(b.setor_merchant_tunai ?? 0) > 0 && <Text style={font.tiny}>Termasuk pembayaran ke merchant {rupiah(b.setor_merchant_tunai)} saat mengambil pesanan.</Text>}
              <Text style={font.tiny}>{b.receivable != null ? 'Setoran dipotong otomatis dari saldo AntarPay Anda saat order selesai.' : 'Setoran order lama dipotong dari saldo sesuai aturan saat itu.'}</Text>
            </View>
          </Row>
        </View>
      ) : b.keterangan ? <Text style={font.tiny}>{b.keterangan}</Text> : null}
    </View>
  );
}

/** Rincian per pesanan untuk merchant: Nilai pesanan · Fee platform x % · Promo ditanggung merchant · Diterima. */
export function MerchantOrderBreakdown({ orderId, status, auto = true }: { orderId: string; status?: OrderStatus; auto?: boolean }) {
  const [open, setOpen] = useState(auto);
  const { data: b, error, reload } = useBreakdown<MerchantBd>('merchant_order_breakdown', orderId, status, open);
  if (!open) return <Button title="Lihat rincian pendapatan" size="sm" variant="ghost" icon="receipt-outline" onPress={() => setOpen(true)} />;
  if (!b) return error ? <ErrorLine text={error} onRetry={reload} /> : <LoadingLines />;
  const rows: PriceRow[] = [
    { label: 'Nilai pesanan', value: b.nilai_pesanan ?? 0, keep: true },
    { label: `Fee platform${b.fee_pct != null ? ` ${pctLabel(b.fee_pct)}` : ''}`, value: b.fee ?? 0, minus: true, keep: true },
    { label: 'Promo ditanggung merchant', value: b.promo_merchant ?? 0, minus: true },
  ];
  return <PriceSummary rows={rows} total={b.diterima ?? 0} totalLabel="Diterima" note={[phaseNote(b.phase, status ?? b.status), b.keterangan].filter(Boolean).join(' ') || null} />;
}

const s = StyleSheet.create({
  err: { gap: 4, padding: 10, borderRadius: radius.md, backgroundColor: colors.warning + '14', borderWidth: 1, borderColor: colors.warning + '44' },
  cash: { padding: 10, borderRadius: radius.md, backgroundColor: colors.warning + '14', borderWidth: 1, borderColor: colors.warning + '44' },
  info: { padding: 10, borderRadius: radius.md, backgroundColor: colors.bgSoft },
});
