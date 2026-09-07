import React, { useState } from 'react';
import { View, Text, ScrollView, RefreshControl, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import { Entrance, LiveDot, Skeleton } from '@/components/motion';
import { TAB_BAR_SPACE } from '@/components/GlassTabBar';
import { CallButton } from '@/components/call/IncomingCall';
import { Screen, Row, Badge, Button, Chip, Empty, toast } from '@/components/ui';
import { useAuth } from '@/store/auth';
import { useMyOrders } from '@/hooks/useOrder';
import { rpc } from '@/lib/supabase';
import { colors, font, motion, radius, shadow } from '@/lib/theme';
import { rupiah, formatTime, merchantStatusLabel, statusLabel } from '@/lib/format';
import type { Order, MerchantOrderStatus } from '@/lib/types';

export default function MerchantOrders() {
  const merchant = useAuth((s) => s.merchant);
  const { orders, loading, reload } = useMyOrders('merchant', merchant?.id);
  const [tab, setTab] = useState<'new' | 'process' | 'done'>('new');
  const [refreshing, setRefreshing] = useState(false);

  const isActive = (o: Order) => !['completed', 'cancelled'].includes(o.status);
  const lists = {
    new: orders.filter((o) => isActive(o) && o.merchant_status === 'pending'),
    process: orders.filter((o) => isActive(o) && (o.merchant_status === 'accepted' || o.merchant_status === 'ready')),
    done: orders.filter((o) => !isActive(o)),
  };
  const act = async (o: Order, st: MerchantOrderStatus) => {
    try { await rpc('merchant_update_order', { p_order_id: o.id, p_status: st }); toast.success(st === 'accepted' ? 'Pesanan diterima, mulai siapkan' : st === 'ready' ? 'Pesanan siap, driver akan mengambil' : 'Pesanan ditolak'); reload(); }
    catch (e) { toast.error((e as Error).message); }
  };

  if (merchant && merchant.status !== 'approved') {
    return <Screen title="Pesanan"><Empty icon="hourglass-outline" title="Menunggu verifikasi admin" subtitle="Toko akan tampil di AntarFood setelah disetujui. Anda sudah bisa menyiapkan menu." /></Screen>;
  }
  return (
    <Screen title={merchant?.name ?? 'Pesanan'} scroll={false} padded={false}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8 }}>
        <Chip label={`Baru (${lists.new.length})`} active={tab === 'new'} onPress={() => setTab('new')} />
        <Chip label={`Diproses (${lists.process.length})`} active={tab === 'process'} onPress={() => setTab('process')} />
        <Chip label="Selesai" active={tab === 'done'} onPress={() => setTab('done')} />
      </ScrollView>
      <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 4, gap: 12, paddingBottom: TAB_BAR_SPACE + 16, width: '100%', maxWidth: 720, alignSelf: 'center' }} showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await reload(); setRefreshing(false); }} tintColor={colors.primary} />}>
        {loading ? [0, 1].map((i) => <View key={i} style={[s.card, { gap: 10 }]}><Skeleton width="40%" height={16} /><Skeleton width="90%" height={12} /><Skeleton width="70%" height={12} /></View>) : (
        <Animated.View key={tab} entering={FadeIn.duration(motion.base)} exiting={FadeOut.duration(motion.fast)} layout={LinearTransition} style={{ gap: 12 }}>
          {lists[tab].length === 0 && <Empty icon="receipt-outline" title={tab === 'new' ? 'Belum ada pesanan baru' : 'Kosong'} subtitle="Pesanan baru akan muncul otomatis." />}
          {lists[tab].map((o, i) => {
            const pending = o.merchant_status === 'pending' && isActive(o);
            return (
              <Entrance key={o.id} index={Math.min(i, 6)} from="up"><View style={[s.card, pending && { borderColor: colors.primary }]}>
                <Row between style={{ alignItems: 'flex-start' }}>
                  <Row gap={10} style={{ flex: 1, minWidth: 0 }}>
                    <View style={s.icon}><Ionicons name="receipt-outline" size={20} color={colors.primary} /></View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Row gap={6}>{pending && <LiveDot color={colors.primary} size={7} />}<Text style={[font.h3, { fontSize: 16 }]}>{o.code}</Text></Row>
                      <Text style={font.tiny} numberOfLines={1}>{formatTime(o.created_at)} · {o.payment_method === 'cash' ? 'Tunai (driver bayar di kasir)' : 'AntarPay'}</Text>
                    </View>
                  </Row>
                  <Badge text={o.merchant_status ? merchantStatusLabel[o.merchant_status] : statusLabel(o.status, o.service)} color={o.merchant_status === 'ready' ? colors.success : o.status === 'cancelled' ? colors.danger : colors.warning} />
                </Row>
                <View style={s.items}>
                  {o.order_items?.map((it) => <Row key={it.id} between style={{ alignItems: 'flex-start' }}><Text style={[font.body, { flex: 1 }]}>{it.qty}× {it.name}{it.notes ? <Text style={font.tiny}>  ({it.notes})</Text> : null}</Text><Text style={{ fontWeight: '600', color: colors.text }}>{rupiah(it.price * it.qty)}</Text></Row>)}
                  <Row between style={s.total}><Text style={font.small}>Pendapatan bersih Anda</Text><Text style={{ fontWeight: '800', color: colors.primary, fontSize: 16 }}>{rupiah(o.merchant_earning)}</Text></Row>
                </View>
                <Row between style={{ marginTop: 10 }}>
                  <Row gap={4} style={{ flex: 1 }}><Ionicons name="bicycle-outline" size={14} color={colors.textMuted} /><Text style={font.tiny}>Driver: {o.status === 'searching' ? 'belum ada' : o.status === 'accepted' ? 'menuju toko' : o.status === 'arrived' ? 'sudah di toko' : o.status}</Text></Row>
                  {isActive(o) && (
                    <Row gap={8}>
                      {!!o.driver_id && <CallButton peer={{ id: o.driver_id, name: 'Driver', role: 'driver' }} orderId={o.id} size={34} color={colors.primary} />}
                      <CallButton peer={{ id: o.customer_id, name: 'Pelanggan', role: 'customer' }} orderId={o.id} size={34} color={colors.info} />
                    </Row>
                  )}
                </Row>
                {pending && (
                  <Row gap={8} style={{ marginTop: 12 }}>
                    <Button title="Tolak" variant="outline" color={colors.danger} size="sm" onPress={() => act(o, 'rejected')} />
                    <Button title="Terima & Siapkan" size="sm" style={{ flex: 1 }} onPress={() => act(o, 'accepted')} />
                  </Row>
                )}
                {o.merchant_status === 'accepted' && isActive(o) && <Button title="Pesanan Siap Diambil" size="sm" icon="checkmark-circle-outline" style={{ marginTop: 12 }} onPress={() => act(o, 'ready')} />}
              </View></Entrance>
            );
          })}
        </Animated.View>
        )}
      </ScrollView>
    </Screen>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: '#fff', borderRadius: radius.lg, padding: 14, borderWidth: 1, borderColor: colors.border, ...shadow.soft },
  icon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center' },
  items: { marginTop: 12, gap: 6, padding: 12, borderRadius: radius.md, backgroundColor: colors.bgSoft },
  total: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8, marginTop: 4 },
});
