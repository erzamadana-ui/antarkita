// Pesanan berjalan sebagai "bubble" — ringkas; ketuk untuk membuka detail.
import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { FadeInDown, FadeOut, LinearTransition, ZoomIn } from 'react-native-reanimated';
import { Row, Badge, Button } from '@/components/ui';
import { Glass } from '@/components/glass';
import { PressableScale, LiveDot, ProgressBar } from '@/components/motion';
import { ServiceArt } from '@/components/ServiceArt';
import { serviceDef } from '@/lib/services';
import { colors, font, radius, motion, glass } from '@/lib/theme';
import { rupiah, statusLabel, statusColor, serviceLabel } from '@/lib/format';
import { useT } from '@/lib/i18n';
import type { Order } from '@/lib/types';

const PROGRESS: Record<string, number> = { scheduled: 0.05, searching: 0.15, accepted: 0.4, arrived: 0.6, in_progress: 0.85, completed: 1 };

export function ActiveOrderBubbles({ orders, hrefFor = (o) => `/order/${o.id}`, role = 'customer' }: { orders: Order[]; hrefFor?: (o: Order) => string; role?: 'customer' | 'driver' }) {
  const router = useRouter();
  const t = useT();
  const [open, setOpen] = useState<string | null>(null);
  if (orders.length === 0) return null;
  const sel = orders.find((o) => o.id === open) ?? null;
  return (
    <Animated.View layout={LinearTransition.springify().stiffness(280).damping(18)} style={{ gap: 10 }}>
      <Row gap={12} style={{ flexWrap: 'wrap' }}>
        {orders.map((o, i) => {
          const def = serviceDef(o.service); const sc = statusColor(o.status); const active = open === o.id;
          return (
            <Animated.View key={o.id} entering={ZoomIn.delay(i * 60).duration(motion.base)}>
              <PressableScale onPress={() => setOpen(active ? null : o.id)} scaleTo={0.9} style={[s.bubble, active && { borderColor: def.color, backgroundColor: def.color + '1F' }]}>
                <ServiceArt kind={def.art} color={def.color} size={46} glow={active} />
                <View style={[s.dot, { backgroundColor: '#fff' }]}><LiveDot color={o.status === 'searching' ? colors.accent : sc} size={7} /></View>
                <Text style={[s.bubbleText, active && { color: def.color }]} numberOfLines={1}>{def.label.replace('Antar', '')}</Text>
              </PressableScale>
            </Animated.View>
          );
        })}
      </Row>
      {sel && (
        <Animated.View key={sel.id} entering={FadeInDown.springify().stiffness(280).damping(18)} exiting={FadeOut.duration(motion.fast)}>
          <Glass variant="strong" radius={radius.xl}>
            <View style={{ padding: 14, gap: 10 }}>
              <Row between>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontWeight: '700', color: colors.text }} numberOfLines={1}>{statusLabel(sel.status, sel.service, sel.merchant_status)}</Text>
                  <Text style={font.tiny} numberOfLines={1}>{serviceLabel[sel.service]} · {sel.code}</Text>
                </View>
                <Text style={{ fontWeight: '700', color: colors.text }}>{rupiah(sel.total)}</Text>
              </Row>
              <ProgressBar progress={PROGRESS[sel.status] ?? 0.1} color={sel.status === 'searching' ? colors.accent : statusColor(sel.status)} />
              <View style={{ gap: 4 }}>
                <Row gap={8}><View style={[s.pt, { backgroundColor: colors.primary }]} /><Text style={font.small} numberOfLines={1}>{sel.merchant?.name ?? sel.shop_store ?? sel.pickup_address}</Text></Row>
                <Row gap={8}><View style={[s.pt, { backgroundColor: colors.danger, borderRadius: 2 }]} /><Text style={font.small} numberOfLines={1}>{sel.dropoff_address}</Text></Row>
              </View>
              <Row gap={8}>
                {!!sel.driver?.profile?.full_name && <Badge text={`${role === 'customer' ? t('driver') : t('customer')}: ${sel.driver.profile.full_name}`} color={colors.info} />}
                <Badge text={sel.payment_method === 'wallet' ? 'AntarPay' : t('cash')} color={colors.textSecondary} />
              </Row>
              <Row gap={8}>
                <Button title={t('track')} icon="navigate" size="sm" style={{ flex: 1 }} onPress={() => router.push(hrefFor(sel) as never)} />
                {sel.driver_id && sel.status !== 'searching' && <Button title={t('chat')} icon="chatbubble-ellipses" size="sm" variant="secondary" onPress={() => router.push(`/order/${sel.id}/chat` as never)} />}
                <PressableScale onPress={() => setOpen(null)} scaleTo={0.9} style={s.close}><Ionicons name="chevron-up" size={20} color={colors.textSecondary} /></PressableScale>
              </Row>
            </View>
          </Glass>
        </Animated.View>
      )}
    </Animated.View>
  );
}

const s = StyleSheet.create({
  bubble: { alignItems: 'center', gap: 4, padding: 6, paddingBottom: 8, borderRadius: radius.xl, borderWidth: 1.5, borderColor: glass.border, backgroundColor: 'rgba(255,255,255,0.92)', width: 70 },
  dot: { position: 'absolute', top: 4, right: 6, width: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  bubbleText: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },
  pt: { width: 8, height: 8, borderRadius: 4 },
  close: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(11,31,42,0.06)', alignItems: 'center', justifyContent: 'center' },
});
