import React, { useState } from 'react';
import { View, Text, ScrollView, RefreshControl, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
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

// Tahap driver dari sudut pandang merchant. Tanpa peta ini status mentah ('in_progress', 'completed')
// bocor ke layar dalam bahasa Inggris.
const DRIVER_STAGE: Record<string, string> = {
  searching: 'belum ada', accepted: 'menuju toko', arrived: 'sudah di toko',
  in_progress: 'mengantar ke pelanggan', completed: 'pesanan selesai', cancelled: 'order dibatalkan',
};

export default function MerchantOrders() {
  const router = useRouter();
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
  // Laporan penjualan ringkas (hari ini & 7 hari) dari order yang sudah dimuat — merchant sebelumnya
  // tidak punya angka penjualan sama sekali di aplikasi.
  const sales = (() => {
    const done = orders.filter((o) => o.status === 'completed');
    const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
    const week = Date.now() - 7 * 86400000;
    const sum = (list: Order[]) => list.reduce((a, o) => a + (o.merchant_earning ?? 0), 0);
    const today = done.filter((o) => new Date(o.created_at).getTime() >= startToday.getTime());
    const last7 = done.filter((o) => new Date(o.created_at).getTime() >= week);
    const cancelled = orders.filter((o) => o.status === 'cancelled').length;
    return { todayCount: today.length, todayEarning: sum(today), weekCount: last7.length, weekEarning: sum(last7), cancelled };
  })();
  const act = async (o: Order, st: MerchantOrderStatus) => {
    try { await rpc('merchant_update_order', { p_order_id: o.id, p_status: st }); toast.success(st === 'accepted' ? 'Pesanan diterima, mulai siapkan' : st === 'ready' ? 'Pesanan siap, driver akan mengambil' : 'Pesanan ditolak'); reload(); }
    catch (e) { toast.error((e as Error).message); }
  };

  if (merchant && merchant.status !== 'approved') {
    // Sebelumnya SEMUA status non-approved (termasuk ditolak & ditangguhkan) dikabari "menunggu verifikasi" —
    // merchant yang ditangguhkan jadi menunggu selamanya tanpa tahu harus berbuat apa.
    const rejected = merchant.status === 'rejected';
    const suspended = merchant.status === 'suspended';
    return (
      <Screen title="Pesanan">
        <Empty icon={rejected ? 'refresh-circle-outline' : suspended ? 'lock-closed-outline' : 'hourglass-outline'}
          title={suspended ? 'Toko ditangguhkan' : rejected ? 'Pengajuan toko ditolak' : 'Menunggu verifikasi admin'}
          subtitle={suspended ? 'Toko Anda sementara disembunyikan dari AntarFood. Hubungi CS AntarKita untuk peninjauan.'
            : rejected ? 'Perbaiki data & dokumen usaha Anda lalu ajukan ulang dari halaman dokumen.'
            : 'Toko akan tampil di AntarFood setelah disetujui. Anda sudah bisa menyiapkan menu.'}
          action={
            <View style={{ gap: 10, width: '100%' }}>
              {(rejected || suspended) && <Button title={rejected ? 'Perbaiki & ajukan ulang' : 'Lihat dokumen usaha'} icon="document-text-outline" onPress={() => router.push('/merchant/documents' as never)} />}
              <Button title="Hubungi CS AntarKita" variant="secondary" icon="chatbubbles-outline" onPress={() => router.push('/support' as never)} />
            </View>
          } />
      </Screen>
    );
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
          {tab === 'done' && (
            <View style={s.report}>
              <Row between><Text style={font.label}>Laporan penjualan</Text><Badge text={`${sales.cancelled} dibatalkan`} color={sales.cancelled ? colors.danger : colors.textMuted} /></Row>
              <Row gap={10} style={{ marginTop: 10 }}>
                <View style={s.reportBox}>
                  <Text style={font.tiny}>Hari ini</Text>
                  <Text style={{ fontWeight: '800', color: colors.primary, fontSize: 17 }} numberOfLines={1}>{rupiah(sales.todayEarning)}</Text>
                  <Text style={font.tiny}>{sales.todayCount} pesanan selesai</Text>
                </View>
                <View style={s.reportBox}>
                  <Text style={font.tiny}>7 hari terakhir</Text>
                  <Text style={{ fontWeight: '800', color: colors.primary, fontSize: 17 }} numberOfLines={1}>{rupiah(sales.weekEarning)}</Text>
                  <Text style={font.tiny}>{sales.weekCount} pesanan selesai</Text>
                </View>
              </Row>
              <Text style={[font.tiny, { marginTop: 8 }]}>Angka di atas adalah pendapatan bersih Anda (setelah potongan platform) dari 50 pesanan terakhir. Rincian saldo & penarikan ada di tab Toko.</Text>
            </View>
          )}
          {lists[tab].length === 0 && <Empty icon="receipt-outline" title={tab === 'new' ? 'Belum ada pesanan baru' : 'Kosong'} subtitle="Pesanan baru akan muncul otomatis." />}
          {lists[tab].map((o, i) => {
            const pending = o.merchant_status === 'pending' && isActive(o);
            return (
              <Entrance key={o.id} index={Math.min(i, 6)} from="up"><View style={[s.card, pending && { borderColor: colors.primary }]}>
                <Row between style={{ alignItems: 'flex-start' }}>
                  <Row gap={10} style={{ flex: 1, minWidth: 0 }}>
                    <View style={s.icon}><Ionicons name="receipt-outline" size={20} color={colors.primary} /></View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Row gap={6}>{pending && <LiveDot color={colors.primary} size={7} />}<Text style={[font.h3, { fontSize: 16 }]} numberOfLines={1}>{o.code}</Text></Row>
                      {/* Metode bayar dipisah ke barisnya sendiri: digabung dengan jam, teks "Tunai (driver bayar
                          di kasir)" terpotong jadi "Tunai (…" di layar 360–390px — persis info yang dibutuhkan kasir. */}
                      <Text style={font.tiny} numberOfLines={1}>{formatTime(o.created_at)}</Text>
                      <Row gap={4} style={{ minWidth: 0 }}>
                        <Ionicons name={o.payment_method === 'cash' ? 'cash-outline' : 'wallet-outline'} size={12} color={o.payment_method === 'cash' ? colors.warning : colors.primary} />
                        <Text style={[font.tiny, { fontWeight: '700', flexShrink: 1, color: o.payment_method === 'cash' ? colors.warning : colors.primary }]} numberOfLines={2}>{o.payment_method === 'cash' ? 'Tunai — driver bayar di kasir' : 'Dibayar AntarPay'}</Text>
                      </Row>
                    </View>
                  </Row>
                  {/* Order yang sudah selesai/batal harus memakai status ORDER: sebelumnya pesanan selesai
                      tetap berlabel "Siap diambil" karena merchant_status-nya masih 'ready'. */}
                  <Badge text={isActive(o) && o.merchant_status ? merchantStatusLabel[o.merchant_status] : statusLabel(o.status, o.service)} color={o.status === 'cancelled' ? colors.danger : o.status === 'completed' ? colors.success : o.merchant_status === 'ready' ? colors.success : colors.warning} />
                </Row>
                <View style={s.items}>
                  {o.order_items?.map((it) => <Row key={it.id} between style={{ alignItems: 'flex-start' }}><Text style={[font.body, { flex: 1 }]}>{it.qty}× {it.name}{it.notes ? <Text style={font.tiny}>  ({it.notes})</Text> : null}</Text><Text style={{ fontWeight: '600', color: colors.text }}>{rupiah(it.price * it.qty)}</Text></Row>)}
                  <Row between style={s.total}><Text style={font.small}>Pendapatan bersih Anda</Text><Text style={{ fontWeight: '800', color: colors.primary, fontSize: 16 }}>{rupiah(o.merchant_earning)}</Text></Row>
                </View>
                <Row between style={{ marginTop: 10 }}>
                  <Row gap={4} style={{ flex: 1, minWidth: 0 }}><Ionicons name="bicycle-outline" size={14} color={colors.textMuted} /><Text style={font.tiny} numberOfLines={1}>Driver: {DRIVER_STAGE[o.status] ?? statusLabel(o.status, o.service).toLowerCase()}</Text></Row>
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
  report: { backgroundColor: '#fff', borderRadius: radius.lg, padding: 14, borderWidth: 1, borderColor: colors.border, ...shadow.soft },
  reportBox: { flex: 1, gap: 2, padding: 12, borderRadius: radius.md, backgroundColor: colors.tint },
});
