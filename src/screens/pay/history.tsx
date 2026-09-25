// Riwayat pembayaran (`/pay/history`) — dari `my_payment_history(p_limit)` (KONTRAK-API-V3 §2):
// status berwarna, provider & kanal, kode bantuan CS (support_ref). Ketuk pembayaran pesanan → bukti transaksi.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, RefreshControl, FlatList } from 'react-native';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Screen, Row, Badge, Empty, Button } from '@/components/ui';
import { PressableScale, Skeleton } from '@/components/motion';
import { SupportRef } from '@/components/OrderDetails';
import { fetchPaymentHistory, providerLabel } from '@/lib/payments';
import { useT } from '@/lib/i18n';
import { colors, font, radius, shadow } from '@/lib/theme';
import { rupiah, formatDate, payStatusLabel, payStatusColor } from '@/lib/format';
import { channelLabel } from '@/store/payprefs';
import type { PaymentHistoryRow } from '@/lib/types';

export default function PaymentHistory() {
  const router = useRouter();
  const t = useT();
  const [rows, setRows] = useState<PaymentHistoryRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => {
    try { setRows(await fetchPaymentHistory(50)); setErr(null); } catch (e) { setErr((e as Error).message); setRows((r) => r ?? []); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  return (
    <Screen title={t('payment_history')} back scroll={false} maxWidth={640}>
      {rows === null ? (
        <View style={{ gap: 10 }}>{[0, 1, 2, 3].map((i) => <Skeleton key={i} height={96} radius={radius.lg} />)}</View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(x) => x.id}
          contentContainerStyle={{ gap: 10, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListHeaderComponent={err ? <View style={s.err}><Text style={[font.small, { color: colors.danger, flex: 1 }]}>{err}</Text><Button title={t('retry')} size="sm" variant="ghost" icon="refresh" onPress={load} /></View> : null}
          ListEmptyComponent={err ? null : <Empty icon="card-outline" title={t('payment_history_empty')} subtitle="Pembayaran lewat e-wallet, QRIS, VA, dan kartu akan tampil di sini." />}
          renderItem={({ item: p }) => {
            const color = payStatusColor(p.pay_status);
            const ch = p.channel_label ?? (p.channel ? channelLabel(p.channel) : '—');
            return (
              <PressableScale disabled={!p.order_id} onPress={() => p.order_id && router.push({ pathname: '/orders/receipt', params: { id: p.order_id } } as never)} scaleTo={0.98} haptic={false} style={s.item}>
                <Row gap={12} style={{ alignItems: 'flex-start' }}>
                  <View style={[s.icon, { backgroundColor: color + '1A' }]}><Ionicons name={p.purpose === 'topup' ? 'add-circle-outline' : 'receipt-outline'} size={20} color={color} /></View>
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <Row between style={{ gap: 8 }}>
                      <Text style={{ fontWeight: '700', color: colors.text, flex: 1 }} numberOfLines={1}>{p.purpose === 'topup' ? 'Top up AntarVoucher' : `Pesanan ${p.order_code ?? ''}`}</Text>
                      <Text style={{ fontWeight: '700', color: colors.text }}>{rupiah(p.amount)}</Text>
                    </Row>
                    <Text style={font.tiny} numberOfLines={1}>{ch} · {p.provider_label ?? providerLabel(p.provider)} · {formatDate(p.paid_at ?? p.created_at)}</Text>
                    <Row gap={6} style={{ marginTop: 2, flexWrap: 'wrap' }}>
                      <Badge text={payStatusLabel[p.pay_status] ?? p.pay_status} color={color} />
                      {p.refunded_amount ? <Badge text={`Dikembalikan ${rupiah(p.refunded_amount)}`} color={colors.info} /> : null}
                    </Row>
                  </View>
                  {p.order_id ? <Ionicons name="chevron-forward" size={18} color={colors.textMuted} style={{ marginTop: 10 }} /> : null}
                </Row>
                {p.support_ref ? <View style={{ marginTop: 8 }}><SupportRef code={p.support_ref} compact /></View> : null}
              </PressableScale>
            );
          }}
        />
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  item: { padding: 12, borderRadius: radius.lg, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, ...shadow.soft },
  icon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  err: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: radius.md, backgroundColor: colors.dangerLight, marginBottom: 6 },
});
