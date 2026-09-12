import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Row, Badge } from '@/components/ui';
import { PressableScale, LiveDot, ProgressBar } from '@/components/motion';
import { ServiceArt } from '@/components/ServiceArt';
import { colors, font, radius, glass, shadow } from '@/lib/theme';
import { rupiah, statusLabel, statusColor, formatDate, serviceLabel } from '@/lib/format';
import { serviceDef } from '@/lib/services';
import type { Order } from '@/lib/types';

const PROGRESS: Record<string, number> = { scheduled: 0.05, searching: 0.15, accepted: 0.4, arrived: 0.6, in_progress: 0.85, completed: 1, cancelled: 1 };

export function OrderCard({ order, href, compact }: { order: Order; href?: string; compact?: boolean }) {
  const router = useRouter();
  const def = serviceDef(order.service);
  const active = !['completed', 'cancelled'].includes(order.status);
  const sc = statusColor(order.status);
  return (
    <PressableScale onPress={() => router.push((href ?? `/order/${order.id}`) as never)} scaleTo={0.98} style={[s.card, active && shadow.glow(def.color)]}>
      <Row gap={12}>
        <ServiceArt kind={def.art} color={def.color} size={46} glow={false} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Row between>
            <Text style={[font.h3, { fontSize: 16 }]}>{serviceLabel[order.service]}</Text>
            <Text style={{ fontWeight: '700', color: colors.text }}>{rupiah(order.total)}</Text>
          </Row>
          <Text style={font.tiny}>{order.code} · {formatDate(order.created_at)}</Text>
        </View>
      </Row>
      {!compact && (
        <View style={{ marginTop: 10, gap: 4 }}>
          <Row gap={8}><View style={[s.dot, { backgroundColor: colors.primary }]} /><Text style={font.small} numberOfLines={1}>{order.merchant?.name ?? order.pickup_address}</Text></Row>
          <Row gap={8}><View style={[s.dot, { backgroundColor: colors.danger, borderRadius: 2 }]} /><Text style={font.small} numberOfLines={1}>{order.dropoff_address}</Text></Row>
        </View>
      )}
      {active && <View style={{ marginTop: 10 }}><ProgressBar progress={PROGRESS[order.status] ?? 0} color={sc} height={4} /></View>}
      <Row between style={{ marginTop: 10 }}>
        <Row gap={6}>
          {active && <LiveDot color={sc} size={7} />}
          <Badge text={statusLabel(order.status, order.service, order.merchant_status)} color={sc} />
        </Row>
        <Text style={font.tiny}>{order.payment_method === 'wallet' ? 'AntarPay' : 'Tunai'}</Text>
      </Row>
    </PressableScale>
  );
}

const s = StyleSheet.create({
  card: { marginBottom: 12, backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: radius.xl, padding: 14, borderWidth: 1, borderColor: glass.border, ...shadow.card },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
