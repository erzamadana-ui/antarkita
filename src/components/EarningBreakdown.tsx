// Rincian pendapatan per order dari buku besar (Skema Bisnis v2 §9 + Finpay v3 §8):
//  - DriverEarningBreakdown   → rpc('driver_order_breakdown', { p_order })
//  - MerchantOrderBreakdown   → rpc('merchant_order_breakdown', { p_order })
//  - DisputeSheet             → rpc('dispute_open', { p_order, p_kind, p_amount, p_description })  (§4)
// Angka hak mitra TIDAK dihitung ulang di klien: server membaca order_ledger (fase completed → adjusted → created),
// atau kolom orders untuk order lama sebelum buku besar (phase = null). Baris informasi (nilai transaksi pelanggan,
// promo, biaya pembayaran + penanggungnya) memakai kolom v3 bila dikirim server, bila tidak dibaca dari baris `orders`.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Modal, Pressable, ScrollView } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Row, Button, Badge, Chip, Input, CircleButton, toast } from '@/components/ui';
import { Skeleton } from '@/components/motion';
import { rpc } from '@/lib/supabase';
import { colors, font, radius, shadow } from '@/lib/theme';
import { rupiah, pctLabel } from '@/lib/format';
import {
  settlementMeta, payoutMeta, fundedByLabel, loadOrderMoney, openDispute, disputeKindLabel, parseAmount,
  type DriverBreakdownV3, type MerchantBreakdownV3, type OrderMoneyRow, type SettlementStatus, type PayoutStatus, type DisputeKind,
} from '@/lib/mitra';
import type { OrderStatus } from '@/lib/types';

/** Muat satu RPC rincian + baris order (cadangan kolom v3); `dep` (mis. status order) memicu muat ulang. */
function useBreakdown<T>(fn: string, orderId: string | null | undefined, dep?: unknown, enabled = true) {
  const [data, setData] = useState<T | null>(null);
  const [order, setOrder] = useState<OrderMoneyRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    if (!orderId || !enabled) return;
    setLoading(true);
    try {
      const [b, o] = await Promise.all([rpc<T>(fn, { p_order: orderId }), loadOrderMoney(orderId).catch(() => null)]);
      setData(b); setOrder(o); setError(null);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [fn, orderId, enabled]);
  useEffect(() => { load(); }, [load, dep]);
  return { data, order, error, loading, reload: load };
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

type Line = { label: string; value: number; sign?: '-' | '+'; hint?: string | null; keep?: boolean };

/** Baris uang dari sudut pandang mitra: potongan ditulis "−Rp…" berwarna gelap (bukan hijau seperti diskon pelanggan). */
function MoneyLines({ title, lines, total, totalLabel }: { title?: string; lines: Line[]; total?: number; totalLabel?: string }) {
  const shown = lines.filter((l) => l.keep || l.value !== 0);
  return (
    <View style={{ gap: 6 }}>
      {title ? <Text style={font.label}>{title}</Text> : null}
      {shown.map((l) => (
        <View key={l.label}>
          <Row between style={{ alignItems: 'flex-start', gap: 8 }}>
            <Text style={[font.small, { flex: 1 }]}>{l.label}</Text>
            <Text style={{ color: l.sign === '-' ? colors.danger : colors.text, fontWeight: '600' }}>{l.sign === '-' ? '−' : l.sign === '+' ? '+' : ''}{rupiah(l.value)}</Text>
          </Row>
          {l.hint ? <Text style={[font.tiny, { marginTop: 1 }]}>{l.hint}</Text> : null}
        </View>
      ))}
      {total != null ? (
        <Row between style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8, marginTop: 2 }}>
          <Text style={[font.body, { fontWeight: '700' }]}>{totalLabel}</Text>
          <Text style={[font.price, { color: colors.primary }]}>{rupiah(total)}</Text>
        </Row>
      ) : null}
    </View>
  );
}

/** Informasi transaksi pelanggan (bukan potongan mitra kecuali disebut): promo & biaya pembayaran beserta penanggungnya. */
function CustomerInfo({ gross, promo, promoBy, pgFee, pgBy, platformFee, extra }: { gross: number | null; promo: number; promoBy?: string | null; pgFee: number; pgBy?: string | null; platformFee?: number | null; extra?: Line[] }) {
  const lines: Line[] = [];
  if (gross != null) lines.push({ label: 'Nilai transaksi pelanggan', value: gross, keep: true, hint: 'Total yang dibayar pelanggan untuk pesanan ini.' });
  if (platformFee) lines.push({ label: 'Biaya platform (dibayar pelanggan)', value: platformFee, hint: 'Pendapatan AntarKita dari pelanggan — tidak memotong hak Anda.' });
  if (promo > 0) lines.push({ label: `Promo/diskon pelanggan · ${fundedByLabel(promoBy)}`, value: promo, hint: promoBy === 'merchant' ? null : 'Tidak memotong hak Anda.' });
  if (pgFee > 0) lines.push({ label: `Biaya metode pembayaran · ${fundedByLabel(pgBy)}`, value: pgFee, hint: pgBy === 'customer' ? 'Ditambahkan ke tagihan pelanggan.' : pgBy === 'platform' || !pgBy ? 'Tidak memotong hak Anda.' : null });
  if (extra) lines.push(...extra);
  if (!lines.length) return null;
  return <View style={s.info}><MoneyLines title="Transaksi pelanggan" lines={lines} /></View>;
}

/** Status settlement (order) & payout (penarikan) — kontrak §3/§8. */
export function SettlementBadges({ settlement, payout }: { settlement?: SettlementStatus | null; payout?: PayoutStatus | null }) {
  if (!settlement && !payout) return null;
  const st = settlement ? settlementMeta[settlement] : null;
  const po = payout ? payoutMeta[payout] : null;
  return (
    <View style={{ gap: 4 }}>
      <Row gap={6} style={{ flexWrap: 'wrap' }}>
        {st ? <Badge text={`Settlement: ${st.label}`} color={st.color} /> : null}
        {po ? <Badge text={`Pencairan: ${po.label}`} color={po.color} /> : null}
      </Row>
      {st ? <Text style={font.tiny}>{st.hint}</Text> : null}
    </View>
  );
}

/** Tombol + lembar "Laporkan selisih" (dispute_open). */
function ReportDiff({ orderId, code, suggested }: { orderId: string; code?: string; suggested?: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button title="Laporkan selisih" size="sm" variant="ghost" icon="flag-outline" color={colors.warning} onPress={() => setOpen(true)} />
      <DisputeSheet visible={open} orderId={orderId} orderCode={code} suggestedAmount={suggested} onClose={() => setOpen(false)} />
    </>
  );
}

const KINDS: DisputeKind[] = ['amount_mismatch', 'payout_missing', 'other'];

/** Lembar pelaporan selisih pembayaran/pencairan untuk satu order. */
export function DisputeSheet({ visible, orderId, orderCode, suggestedAmount, onClose, onDone }: { visible: boolean; orderId: string; orderCode?: string; suggestedAmount?: number; onClose: () => void; onDone?: () => void }) {
  const [kind, setKind] = useState<DisputeKind>('amount_mismatch');
  const [amount, setAmount] = useState('');
  const [desc, setDesc] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (visible) { setKind('amount_mismatch'); setAmount(''); setDesc(''); } }, [visible]);
  const amt = parseAmount(amount);
  const submit = async () => {
    if (kind === 'amount_mismatch' && amt <= 0) return toast.error('Isi nominal selisih yang Anda harapkan');
    if (desc.trim().length < 10) return toast.error('Jelaskan selisihnya minimal 10 karakter');
    setBusy(true);
    try {
      await openDispute({ orderId, kind, amount: amt > 0 ? amt : null, description: desc.trim() });
      toast.success('Laporan terkirim — tim keuangan AntarKita akan memeriksa');
      onDone?.(); onClose();
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={s.modalBg}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <Animated.View entering={FadeInDown.springify().stiffness(280).damping(18)} style={s.modal}>
          <View style={s.handle} />
          <ScrollView contentContainerStyle={{ gap: 12 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Row between><Text style={font.h2}>Laporkan selisih</Text><CircleButton icon="close" onPress={onClose} /></Row>
            {orderCode ? <Text style={font.small}>Pesanan {orderCode}</Text> : null}
            <Text style={font.label}>Jenis masalah</Text>
            <Row gap={8} style={{ flexWrap: 'wrap' }}>{KINDS.map((k) => <Chip key={k} label={disputeKindLabel[k]} active={kind === k} onPress={() => setKind(k)} color={colors.warning} />)}</Row>
            <Input label={kind === 'amount_mismatch' ? 'Nominal selisih (Rp)' : 'Nominal terkait (opsional)'} keyboardType="number-pad" placeholder={suggestedAmount ? String(suggestedAmount) : '0'}
              value={amount} onChangeText={(v) => setAmount(v.replace(/\D/g, ''))} />
            {amt > 0 ? <Text style={font.tiny}>{rupiah(amt)}</Text> : null}
            <Input label="Keterangan" placeholder="Contoh: ongkir di rincian Rp12.000, tetapi saldo hanya bertambah Rp10.000" value={desc} onChangeText={setDesc} multiline />
            <Text style={font.tiny}>Laporan dicatat di buku besar sebagai selisih yang sedang diperiksa. Status dapat dipantau di menu “Laporan selisih”.</Text>
            <Button title="Kirim laporan" icon="paper-plane-outline" loading={busy} onPress={submit} color={colors.warning} />
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

/** Rincian pendapatan driver per order: transaksi pelanggan → hak driver (ongkir 100 % / setelah komisi x %) → bersih. */
export function DriverEarningBreakdown({ orderId, status, title = 'Rincian pendapatan', disputable = true }: { orderId: string; status?: OrderStatus; title?: string | null; disputable?: boolean }) {
  const { data: b, order: o, error, loading, reload } = useBreakdown<DriverBreakdownV3>('driver_order_breakdown', orderId, status);
  if (!b) return <View style={{ gap: 8 }}>{title ? <Text style={font.h3}>{title}</Text> : null}{error ? <ErrorLine text={error} onRetry={reload} /> : <LoadingLines />}</View>;
  // Persen komisi dari snapshot order (server). 0 % = ongkir 100 % hak driver (food/send/shop/market/box, §0.1).
  const pct = b.komisi_pct;
  const full = pct != null ? Number(pct) === 0 : (b.komisi ?? 0) === 0;
  const lines: Line[] = [{ label: 'Ongkir / tarif perjalanan', value: b.ongkir ?? 0, keep: true }];
  if (full) lines.push({ label: 'Komisi AntarKita 0 %', value: 0, keep: true, hint: 'Ongkir 100 % hak Anda.' });
  else if (b.komisi != null) lines.push({ label: `Komisi AntarKita${pct != null ? ` ${pctLabel(pct)}` : ''}`, value: b.komisi, sign: '-', keep: true, hint: 'Hak Anda = tarif setelah komisi.' });
  lines.push(
    { label: 'Tip pelanggan', value: b.tip ?? 0, sign: '+' },
    { label: 'Biaya tambahan (extras)', value: b.extras ?? 0, sign: '+', hint: 'Parkir/tol/tunggu yang disetujui pelanggan' },
    { label: 'Bagian jasa belanja', value: b.service_share ?? 0, sign: '+' },
    { label: 'Bonus sesi', value: b.bonus ?? 0, sign: '+', hint: 'Pengurangan komisi saat sesi bonus berlaku' },
  );
  const cash = b.payment_method === 'cash';
  const recv = b.receivable ?? 0;
  const note = phaseNote(b.phase, status ?? b.status);
  const gross = b.gross_customer ?? o?.total ?? null;
  const promo = b.promo ?? o?.discount ?? 0;
  const pg = b.pg_fee ?? ((o?.pg_fee ?? 0) + (o?.pg_fee_ppn ?? 0));
  const settlement = b.settlement_status ?? o?.settlement_status ?? null;
  return (
    <View style={{ gap: 10 }}>
      {title ? <Row between><Text style={font.h3}>{title}</Text>{loading ? <Text style={font.tiny}>memperbarui…</Text> : null}</Row> : null}
      <CustomerInfo gross={gross} promo={promo} promoBy={b.promo_funded_by ?? o?.promo_funded_by} pgFee={pg} pgBy={b.pg_fee_funded_by ?? o?.pg_fee_borne_by} platformFee={b.customer_platform_fee ?? o?.platform_fee} />
      <MoneyLines title="Hak Anda" lines={lines} total={b.bersih ?? 0} totalLabel="Pendapatan bersih" />
      {note ? <Text style={font.tiny}>{note}</Text> : null}
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
      <SettlementBadges settlement={settlement} payout={b.payout_status} />
      {disputable && (status ?? b.status) === 'completed' ? <ReportDiff orderId={orderId} code={b.code} /> : null}
    </View>
  );
}

/** Rincian per pesanan untuk merchant: transaksi pelanggan → nilai barang − fee AntarKita x % − promo merchant = diterima. */
export function MerchantOrderBreakdown({ orderId, status, auto = true, disputable = true }: { orderId: string; status?: OrderStatus; auto?: boolean; disputable?: boolean }) {
  const [open, setOpen] = useState(auto);
  const { data: b, order: o, error, reload } = useBreakdown<MerchantBreakdownV3>('merchant_order_breakdown', orderId, status, open);
  if (!open) return <Button title="Lihat rincian pendapatan" size="sm" variant="ghost" icon="receipt-outline" onPress={() => setOpen(true)} />;
  if (!b) return error ? <ErrorLine text={error} onRetry={reload} /> : <LoadingLines />;
  const lines: Line[] = [
    { label: 'Nilai barang', value: b.nilai_pesanan ?? 0, keep: true },
    { label: `Fee AntarKita${b.fee_pct != null ? ` ${pctLabel(b.fee_pct)}` : ''}`, value: b.fee ?? 0, sign: '-', keep: true, hint: 'Hak merchant = nilai barang − fee.' },
    { label: 'Promo ditanggung merchant', value: b.promo_merchant ?? 0, sign: '-' },
  ];
  const gross = b.gross_customer ?? o?.total ?? null;
  const promo = b.promo ?? o?.discount ?? 0;
  const promoBy = b.promo_funded_by ?? o?.promo_funded_by;
  const pg = b.pg_fee ?? ((o?.pg_fee ?? 0) + (o?.pg_fee_ppn ?? 0));
  const ongkir = o?.fare_delivery ?? 0;
  const note = [phaseNote(b.phase, status ?? b.status), b.keterangan].filter(Boolean).join(' ') || null;
  const settlement = b.settlement_status ?? o?.settlement_status ?? null;
  return (
    <View style={{ gap: 10 }}>
      <CustomerInfo gross={gross} promo={promo} promoBy={promoBy} pgFee={pg} pgBy={b.pg_fee_funded_by ?? o?.pg_fee_borne_by} platformFee={b.customer_platform_fee ?? o?.platform_fee}
        extra={ongkir > 0 ? [{ label: 'Ongkir (100 % hak driver)', value: ongkir, hint: 'Tidak termasuk hak merchant.' }] : undefined} />
      <MoneyLines title="Hak merchant" lines={lines} total={b.diterima ?? 0} totalLabel="Diterima" />
      {note ? <Text style={font.tiny}>{note}</Text> : null}
      <SettlementBadges settlement={settlement} payout={b.payout_status} />
      {disputable && (status ?? b.status) === 'completed' ? <ReportDiff orderId={orderId} code={b.code} /> : null}
    </View>
  );
}

const s = StyleSheet.create({
  err: { gap: 4, padding: 10, borderRadius: radius.md, backgroundColor: colors.warning + '14', borderWidth: 1, borderColor: colors.warning + '44' },
  cash: { padding: 10, borderRadius: radius.md, backgroundColor: colors.warning + '14', borderWidth: 1, borderColor: colors.warning + '44' },
  info: { padding: 10, borderRadius: radius.md, backgroundColor: colors.bgSoft },
  modalBg: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  modal: { backgroundColor: '#fff', borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: 20, paddingBottom: 32, maxHeight: '92%', width: '100%', maxWidth: 640, alignSelf: 'center', overflow: 'hidden', ...shadow.sheet },
  handle: { width: 44, height: 5, borderRadius: 3, backgroundColor: colors.border, alignSelf: 'center', marginBottom: 12 },
});
