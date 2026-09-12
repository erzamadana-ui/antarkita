import React, { useState } from 'react';
import { View, Text, RefreshControl, ScrollView, StyleSheet } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import { Screen, Empty, Row, IconCircle } from '@/components/ui';
import { OrderCard } from '@/components/OrderCard';
import { Entrance, PressableScale, Skeleton } from '@/components/motion';
import { TAB_BAR_SPACE } from '@/components/GlassTabBar';
import { useAuth } from '@/store/auth';
import { useMyOrders } from '@/hooks/useOrder';
import { colors, font, motion, radius, shadow } from '@/lib/theme';

type Tab = 'active' | 'history';

export default function CustomerOrders() {
  const uid = useAuth((s) => s.session?.user.id);
  const { orders, loading, reload } = useMyOrders('customer', uid);
  const [tab, setTab] = useState<Tab>('active');
  const [refreshing, setRefreshing] = useState(false);
  const active = orders.filter((o) => !['completed', 'cancelled'].includes(o.status));
  const history = orders.filter((o) => ['completed', 'cancelled'].includes(o.status));
  const list = tab === 'active' ? active : history;
  const done = history.filter((o) => o.status === 'completed').length;

  const tabs: { key: Tab; label: string }[] = [{ key: 'active', label: `Berjalan (${active.length})` }, { key: 'history', label: 'Riwayat' }];

  return (
    <Screen title="Pesanan Saya" scroll={false} padded={false}>
      <View style={s.inner}>
        <Entrance index={0}>
          <View style={s.stats}>
            <Row gap={12} style={{ flex: 1 }}>
              <IconCircle name="time-outline" size={44} bg={colors.tint} />
              <View><Text style={[font.h2, { color: colors.primary }]}>{active.length}</Text><Text style={font.tiny}>Berjalan</Text></View>
            </Row>
            <View style={s.vDivider} />
            <Row gap={12} style={{ flex: 1 }}>
              <IconCircle name="checkmark-done-outline" size={44} bg={colors.successLight} color={colors.success} />
              <View><Text style={[font.h2, { color: colors.text }]}>{done}</Text><Text style={font.tiny}>Selesai</Text></View>
            </Row>
          </View>
        </Entrance>
        <Row gap={8} style={{ paddingVertical: 12 }}>
          {tabs.map((x) => (
            <PressableScale key={x.key} onPress={() => setTab(x.key)} scaleTo={0.94} style={[s.tab, tab === x.key && s.tabOn]}>
              <Text style={{ fontSize: 14, fontWeight: '700', color: tab === x.key ? '#fff' : colors.text }}>{x.label}</Text>
            </PressableScale>
          ))}
        </Row>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 4, paddingBottom: TAB_BAR_SPACE + 16, width: '100%', maxWidth: 720, alignSelf: 'center' }} showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await reload(); setRefreshing(false); }} tintColor={colors.primary} />}>
        {loading ? [0, 1, 2].map((i) => <View key={i} style={s.skel}><Skeleton width="40%" height={16} /><Skeleton width="90%" height={12} /><Skeleton width="70%" height={12} /></View>) : (
          <Animated.View key={tab} entering={FadeIn.duration(motion.base)} exiting={FadeOut.duration(motion.fast)} layout={LinearTransition}>
            {list.length === 0 ? (
              <Empty icon="receipt-outline" title={tab === 'active' ? 'Belum ada pesanan berjalan' : 'Belum ada riwayat'} subtitle="Pesan AntarRide, AntarFood, atau AntarSend dari Beranda." />
            ) : list.map((o, i) => <Entrance key={o.id} index={Math.min(i, 6)} from="up"><OrderCard order={o} /></Entrance>)}
          </Animated.View>
        )}
      </ScrollView>
    </Screen>
  );
}

const s = StyleSheet.create({
  inner: { width: '100%', maxWidth: 720, alignSelf: 'center', paddingHorizontal: 16, paddingTop: 6 },
  stats: { flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: radius.lg, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, ...shadow.soft },
  vDivider: { width: 1, height: 36, backgroundColor: colors.border, marginHorizontal: 12 },
  tab: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 12, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, backgroundColor: '#fff', ...shadow.soft },
  tabOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  skel: { marginBottom: 12, gap: 10, padding: 14, backgroundColor: '#fff', borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border },
});
