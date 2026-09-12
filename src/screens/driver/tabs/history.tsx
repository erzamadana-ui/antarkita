import React, { useMemo, useState } from 'react';
import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Screen, Empty, Row, Badge, Chip } from '@/components/ui';
import { Entrance, PressableScale, Skeleton } from '@/components/motion';
import { ServiceIllustration } from '@/components/ServiceArt';
import { TAB_BAR_SPACE } from '@/components/GlassTabBar';
import { useAuth } from '@/store/auth';
import { useMyOrders } from '@/hooks/useOrder';
import { serviceDef } from '@/lib/services';
import { colors, font, radius, shadow } from '@/lib/theme';
import { rupiah, formatDate, serviceLabel, statusLabel, statusColor } from '@/lib/format';
import type { Order } from '@/lib/types';

type Filter = 'all' | 'active' | 'completed' | 'cancelled';
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'Semua' }, { key: 'active', label: 'Berjalan' }, { key: 'completed', label: 'Selesai' }, { key: 'cancelled', label: 'Dibatalkan' },
];

export default function DriverHistory() {
  const router = useRouter();
  const uid = useAuth((s) => s.session?.user.id);
  const { orders, loading } = useMyOrders('driver', uid);
  const [filter, setFilter] = useState<Filter>('all');

  const completed = useMemo(() => orders.filter((o) => o.status === 'completed'), [orders]);
  const earned = useMemo(() => completed.reduce((a, o) => a + (o.driver_earning ?? 0), 0), [completed]);
  const list = useMemo(() => orders.filter((o) => filter === 'all' ? true : filter === 'completed' ? o.status === 'completed' : filter === 'cancelled' ? o.status === 'cancelled' : !['completed', 'cancelled'].includes(o.status)), [orders, filter]);

  return (
    <Screen title="Riwayat Order" scroll={false} padded={false}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: TAB_BAR_SPACE + 16, width: '100%', maxWidth: 720, alignSelf: 'center' }} showsVerticalScrollIndicator={false}>
        {/* Statistik 2 kolom */}
        <Entrance index={0}>
          <Row gap={12}>
            <View style={s.stat}>
              <View style={s.statIcon}><Ionicons name="checkmark-done-outline" size={20} color={colors.primary} /></View>
              <Text style={[font.h2, { marginTop: 10 }]}>{completed.length}</Text>
              <Text style={font.tiny}>Trip selesai</Text>
            </View>
            <View style={s.stat}>
              <View style={s.statIcon}><Ionicons name="cash-outline" size={20} color={colors.primary} /></View>
              <Text style={[font.h2, { marginTop: 10, color: colors.primary }]} numberOfLines={1}>{rupiah(earned)}</Text>
              <Text style={font.tiny}>Pendapatan dari riwayat</Text>
            </View>
          </Row>
        </Entrance>

        {/* Chip pil filter */}
        <Entrance index={1}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 14 }}>
            {FILTERS.map((f) => <Chip key={f.key} label={f.label} active={filter === f.key} onPress={() => setFilter(f.key)} />)}
          </ScrollView>
        </Entrance>

        {loading ? [0, 1, 2].map((i) => <View key={i} style={[s.row, { marginBottom: 10 }]}><Skeleton width={56} height={56} radius={28} /><View style={{ flex: 1, gap: 6 }}><Skeleton width="50%" height={14} /><Skeleton width="80%" height={12} /></View></View>)
          : list.length === 0 ? <Empty icon="receipt-outline" title="Belum ada order" subtitle="Order yang Anda terima akan tampil di sini." />
          : <View style={{ gap: 10 }}>{list.map((o, i) => <Entrance key={o.id} index={Math.min(i + 2, 8)} from="up"><HistoryRow order={o} onPress={() => router.push(`/driver/order/${o.id}` as never)} /></Entrance>)}</View>}
      </ScrollView>
    </Screen>
  );
}

function HistoryRow({ order: o, onPress }: { order: Order; onPress: () => void }) {
  const def = serviceDef(o.service);
  const sc = statusColor(o.status);
  return (
    <PressableScale onPress={onPress} scaleTo={0.98} haptic={false} style={s.row}>
      <View style={[s.thumb, { backgroundColor: def.color + '14' }]}><ServiceIllustration kind={def.art} size={36} /></View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Row between>
          <Text style={[font.body, { fontWeight: '700', flex: 1 }]} numberOfLines={1}>{serviceLabel[o.service]}</Text>
          <Text style={{ fontWeight: '700', color: colors.primary }}>{rupiah(o.driver_earning)}</Text>
        </Row>
        <Row gap={4}><Ionicons name="location-outline" size={12} color={colors.textMuted} /><Text style={font.tiny} numberOfLines={1}>{o.merchant?.name ?? o.dropoff_address}</Text></Row>
        <Row between>
          <Text style={font.tiny}>{o.code} · {formatDate(o.created_at)}</Text>
          <Badge text={statusLabel(o.status, o.service, o.merchant_status)} color={sc} />
        </Row>
      </View>
    </PressableScale>
  );
}

const s = StyleSheet.create({
  stat: { flex: 1, padding: 14, borderRadius: radius.lg, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, ...shadow.soft },
  statIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 20, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, ...shadow.soft },
  thumb: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center' },
});
