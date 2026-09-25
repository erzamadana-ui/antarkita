import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import { Screen, Row, Badge, Button } from '@/components/ui';
import { WalletView } from '@/components/WalletView';
import { AnimatedNumber, Entrance, PressableScale, Skeleton } from '@/components/motion';
import { TAB_BAR_SPACE } from '@/components/GlassTabBar';
import { DriverEarningBreakdown } from '@/components/EarningBreakdown';
import { useAuth } from '@/store/auth';
import { useMyOrders } from '@/hooks/useOrder';
import { rpc } from '@/lib/supabase';
import { colors, font, motion, radius, shadow } from '@/lib/theme';
import { rupiah, formatDate, serviceLabel, driverEarningOf } from '@/lib/format';
import { useServiceEconomics, driverCommissionText, DRIVER_SERVICES } from '@/lib/mitra';
import { EarningsReportCard, MyDisputesCard } from '@/screens/mitra/finance';
import type { Order } from '@/lib/types';

type Summary = { today: number; today_trips: number; week: number; month: number };

export default function DriverEarnings() {
  const uid = useAuth((s) => s.session?.user.id);
  const [sum, setSum] = useState<Summary | null>(null);
  const [sumErr, setSumErr] = useState<string | null>(null);
  // driver_earnings_summary (0099) menjumlahkan driver_earning_final — pendapatan akhir, bukan dasar.
  const load = useCallback(async () => {
    try { setSum(await rpc<Summary>('driver_earnings_summary')); setSumErr(null); }
    catch (e) { setSumErr((e as Error).message); }
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);

  const header = (
    <View style={{ gap: 12, marginBottom: 12 }}>
      {/* Kartu hari ini (teal) */}
      <Entrance index={0} from="zoom">
        <View style={s.hero}>
          <Row gap={8}>
            <View style={s.heroIcon}><Ionicons name="sunny-outline" size={20} color="#fff" /></View>
            <Text style={s.lbl}>Pendapatan bersih hari ini</Text>
          </Row>
          <AnimatedNumber value={sum?.today ?? 0} format={rupiah} style={{ color: '#fff', fontSize: 30, fontWeight: '700', letterSpacing: -0.5, marginTop: 8 }} />
          <Text style={s.lbl}>{sum?.today_trips ?? 0} trip selesai</Text>
        </View>
      </Entrance>
      {sumErr ? (
        <Row gap={8} style={s.err}>
          <Ionicons name="alert-circle" size={16} color={colors.warning} />
          <Text style={[font.tiny, { flex: 1, color: colors.text }]}>Ringkasan pendapatan belum bisa dimuat: {sumErr}</Text>
          <Button title="Coba lagi" size="sm" variant="ghost" onPress={load} />
        </Row>
      ) : null}
      {/* Statistik 2 kolom */}
      <Entrance index={1}>
        <Row gap={12} style={{ flexWrap: 'wrap' }}>
          <View style={s.stat}>
            <View style={s.statIcon}><Ionicons name="calendar-outline" size={20} color={colors.primary} /></View>
            <AnimatedNumber value={sum?.week ?? 0} format={rupiah} style={[font.h3, { marginTop: 10, color: colors.primary }]} />
            <Text style={font.tiny}>7 hari terakhir</Text>
          </View>
          <View style={s.stat}>
            <View style={s.statIcon}><Ionicons name="stats-chart-outline" size={20} color={colors.primary} /></View>
            <AnimatedNumber value={sum?.month ?? 0} format={rupiah} style={[font.h3, { marginTop: 10, color: colors.primary }]} />
            <Text style={font.tiny}>Bulan ini</Text>
          </View>
        </Row>
      </Entrance>
      <Entrance index={2}><EarningRules /></Entrance>
      <Entrance index={3}><EarningsReportCard role="driver" ownerId={uid} /></Entrance>
      <Entrance index={4}><RecentOrderBreakdowns uid={uid} /></Entrance>
      <Entrance index={5}><MyDisputesCard /></Entrance>
    </View>
  );

  return (
    <Screen title="Pendapatan" scroll={false} padded={false}>
      <WalletView allowWithdraw bottomSpace={TAB_BAR_SPACE + 16} header={header} />
    </Screen>
  );
}

/**
 * Aturan uang yang berlaku (§0.1): persen komisi dibaca dari service_economics_public per layanan —
 * TIDAK ditulis tetap di aplikasi (ongkir food/send/shop/market/box 100 % driver; ride ≤ 8 % motor, ≤ 15 % mobil).
 */
function EarningRules() {
  const { data, error, loading } = useServiceEconomics(DRIVER_SERVICES);
  const text = driverCommissionText(data);
  return (
    <Row gap={8} style={s.note}>
      <Ionicons name="information-circle-outline" size={16} color={colors.primary} />
      <Text style={[font.tiny, { flex: 1 }]}>
        {text ?? (loading ? 'Memuat aturan komisi terbaru…' : `Aturan komisi belum bisa dimuat${error ? ` (${error})` : ''} — persentase yang berlaku selalu tercantum di rincian tiap order.`)}
        {' '}Tip pelanggan & biaya tambahan (parkir/tol/tunggu) 100 % milik Anda.
        {' '}Order tunai: Anda memegang uang pelanggan, lalu setoran ke platform (biaya platform, komisi, fee merchant) dipotong dari saldo saat order selesai. Jaga saldo tetap di atas batas minus yang ditetapkan admin.
      </Text>
    </Row>
  );
}

/** Rincian per order untuk order selesai terakhir (driver_order_breakdown) — ketuk untuk membuka. */
function RecentOrderBreakdowns({ uid }: { uid?: string }) {
  const { orders, loading } = useMyOrders('driver', uid);
  const done = useMemo(() => orders.filter((o) => o.status === 'completed').slice(0, 10), [orders]);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <View style={s.card}>
      <Row between><Text style={font.h3}>Rincian per order</Text><Badge text={`${done.length} terakhir`} color={colors.textMuted} /></Row>
      <Text style={font.tiny}>Nilai transaksi pelanggan · promo & biaya pembayaran (+ penanggung) · ongkir · komisi AntarKita · tip · extras · pendapatan bersih · status pencairan — langsung dari buku besar order.</Text>
      {loading ? <View style={{ gap: 8, marginTop: 6 }}><Skeleton height={44} radius={radius.md} /><Skeleton height={44} radius={radius.md} /></View>
        : done.length === 0 ? <Text style={[font.small, { marginTop: 6 }]}>Belum ada order selesai.</Text>
        : done.map((o) => <OrderRow key={o.id} o={o} open={open === o.id} onToggle={() => setOpen(open === o.id ? null : o.id)} />)}
    </View>
  );
}

function OrderRow({ o, open, onToggle }: { o: Order; open: boolean; onToggle: () => void }) {
  return (
    <Animated.View layout={LinearTransition.springify().stiffness(280).damping(22)} style={s.row}>
      <PressableScale onPress={onToggle} scaleTo={0.99} haptic={false}>
        <Row between>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[font.body, { fontWeight: '700' }]} numberOfLines={1}>{serviceLabel[o.service]} · {o.code}</Text>
            <Text style={font.tiny}>{formatDate(o.completed_at ?? o.created_at)} · {o.payment_method === 'cash' ? 'Tunai' : 'Non-tunai'}</Text>
          </View>
          <Text style={{ fontWeight: '700', color: colors.primary }}>{rupiah(driverEarningOf(o))}</Text>
          <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} style={{ marginLeft: 6 }} />
        </Row>
      </PressableScale>
      {open && <Animated.View entering={FadeInDown.duration(motion.fast)} style={{ marginTop: 10 }}><DriverEarningBreakdown orderId={o.id} status={o.status} title={null} /></Animated.View>}
    </Animated.View>
  );
}

const s = StyleSheet.create({
  hero: { borderRadius: radius.lg, padding: 18, backgroundColor: colors.primary, ...shadow.glow(colors.primary) },
  heroIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  lbl: { color: 'rgba(255,255,255,0.88)', fontSize: 12, fontWeight: '600' },
  stat: { flexGrow: 1, flexBasis: 150, minWidth: 150, flexShrink: 1, padding: 14, borderRadius: radius.lg, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, ...shadow.soft },
  statIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center' },
  note: { padding: 12, borderRadius: radius.md, backgroundColor: colors.tint, alignItems: 'flex-start' },
  err: { padding: 10, borderRadius: radius.md, backgroundColor: colors.warning + '14', alignItems: 'center' },
  card: { gap: 8, padding: 14, borderRadius: radius.lg, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, ...shadow.soft },
  row: { padding: 10, borderRadius: radius.md, backgroundColor: colors.bgSoft, borderWidth: 1, borderColor: colors.border },
});
