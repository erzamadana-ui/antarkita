// Pendapatan pedagang pasar (vendor AntarMarket). Sejak 0097 pedagang yang disetujui berperan 'merchant'
// (lolos withdrawal_require_allowed), tetapi TIDAK punya baris `merchants` — belanja AntarMarket dibayar driver
// langsung di lapak (ledger `vendor_payable` → penggantian ke driver), jadi nilainya tidak lewat saldo pedagang.
// Kartu ini: saldo + riwayat wallet_transactions + penarikan (my_withdrawals) + laporan selisih;
// bila akun yang sama juga mengelola toko merchant, laporan & rincian merchant_order_breakdown ikut tampil.
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import { Screen, Row, Badge } from '@/components/ui';
import { WalletView } from '@/components/WalletView';
import { Entrance, PressableScale, Skeleton } from '@/components/motion';
import { TAB_BAR_SPACE } from '@/components/GlassTabBar';
import { MerchantOrderBreakdown } from '@/components/EarningBreakdown';
import { useAuth } from '@/store/auth';
import { useMyOrders } from '@/hooks/useOrder';
import { colors, font, motion, radius, shadow } from '@/lib/theme';
import { rupiah, formatDate } from '@/lib/format';
import { EarningsReportCard, MyDisputesCard } from '@/screens/mitra/finance';

export default function VendorEarnings() {
  const merchant = useAuth((s) => s.merchant);
  const header = (
    <View style={{ gap: 12, marginBottom: 12 }}>
      <Entrance index={0}>
        <Row gap={8} style={s.note}>
          <Ionicons name="information-circle-outline" size={16} color={colors.market} />
          <Text style={[font.tiny, { flex: 1 }]}>
            Belanja AntarMarket dibayar driver langsung di lapak Anda saat mengambil barang — nilainya tidak masuk saldo AntarVoucher dan tidak dipotong fee.
            {' '}Saldo di bawah memuat transaksi lain dengan AntarKita (mis. penyesuaian, refund, pendapatan non-tunai) dan bisa dicairkan ke rekening lapak.
          </Text>
        </Row>
      </Entrance>
      {merchant ? (
        <>
          <Entrance index={1}><EarningsReportCard role="merchant" ownerId={merchant.id} accent={colors.market} /></Entrance>
          <Entrance index={2}><MerchantBreakdowns merchantId={merchant.id} /></Entrance>
        </>
      ) : null}
      <Entrance index={3}><MyDisputesCard /></Entrance>
    </View>
  );
  return (
    <Screen title="Pendapatan" scroll={false} padded={false}>
      <WalletView allowWithdraw bottomSpace={TAB_BAR_SPACE + 16} header={header} />
    </Screen>
  );
}

/** Pedagang yang juga mengelola toko merchant: rincian per pesanan toko (merchant_order_breakdown). */
function MerchantBreakdowns({ merchantId }: { merchantId: string }) {
  const { orders, loading } = useMyOrders('merchant', merchantId);
  const done = useMemo(() => orders.filter((o) => o.status === 'completed').slice(0, 8), [orders]);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <View style={s.card}>
      <Row between><Text style={font.h3}>Rincian pesanan toko</Text><Badge text={`${done.length} terakhir`} color={colors.textMuted} /></Row>
      {loading ? <Skeleton height={44} radius={radius.md} />
        : done.length === 0 ? <Text style={font.small}>Belum ada pesanan toko yang selesai.</Text>
        : done.map((o) => (
          <Animated.View key={o.id} layout={LinearTransition} style={s.row}>
            <PressableScale onPress={() => setOpen(open === o.id ? null : o.id)} scaleTo={0.99} haptic={false}>
              <Row between>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[font.body, { fontWeight: '700' }]} numberOfLines={1}>{o.code}</Text>
                  <Text style={font.tiny}>{formatDate(o.completed_at ?? o.created_at)}</Text>
                </View>
                <Text style={{ fontWeight: '700', color: colors.market }}>{rupiah(o.merchant_earning)}</Text>
                <Ionicons name={open === o.id ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} style={{ marginLeft: 6 }} />
              </Row>
            </PressableScale>
            {open === o.id && <Animated.View entering={FadeInDown.duration(motion.fast)} style={{ marginTop: 10 }}><MerchantOrderBreakdown orderId={o.id} status={o.status} /></Animated.View>}
          </Animated.View>
        ))}
    </View>
  );
}

const s = StyleSheet.create({
  note: { padding: 12, borderRadius: radius.md, backgroundColor: colors.market + '12', alignItems: 'flex-start' },
  card: { gap: 8, padding: 14, borderRadius: radius.lg, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, ...shadow.soft },
  row: { padding: 10, borderRadius: radius.md, backgroundColor: colors.bgSoft, borderWidth: 1, borderColor: colors.border },
});
