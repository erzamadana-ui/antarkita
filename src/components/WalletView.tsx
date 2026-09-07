import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, RefreshControl, ScrollView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { LinearTransition } from 'react-native-reanimated';
import { Card, Empty, Row, IconCircle, Badge } from '@/components/ui';
import { BrandGradient } from '@/components/glass';
import { AnimatedNumber, Entrance, PressableScale, Skeleton } from '@/components/motion';
import { useAuth } from '@/store/auth';
import { supabase } from '@/lib/supabase';
import { colors, font, radius, shadow } from '@/lib/theme';
import { rupiah, formatDate } from '@/lib/format';
import type { WalletTx, TopupRequest, WithdrawalRequest } from '@/lib/types';

const txMeta: Record<WalletTx['type'], { label: string; icon: string; color: string }> = {
  topup: { label: 'Top up', icon: 'arrow-down-circle', color: colors.success },
  payment: { label: 'Pembayaran', icon: 'cart', color: colors.danger },
  earning: { label: 'Pendapatan', icon: 'cash', color: colors.success },
  refund: { label: 'Refund', icon: 'refresh-circle', color: colors.info },
  withdrawal: { label: 'Penarikan', icon: 'arrow-up-circle', color: colors.warning },
  fee: { label: 'Potongan platform', icon: 'remove-circle', color: colors.danger },
  adjustment: { label: 'Penyesuaian', icon: 'construct', color: colors.textSecondary },
};

/** Tampilan dompet yang dipakai customer & driver/merchant. */
export function WalletView({ allowWithdraw, bottomSpace = 40 }: { allowWithdraw?: boolean; bottomSpace?: number }) {
  const router = useRouter();
  const { wallet, refreshWallet, session } = useAuth();
  const [txs, setTxs] = useState<WalletTx[]>([]);
  const [pending, setPending] = useState<(TopupRequest | WithdrawalRequest)[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const uid = session?.user.id;

  const load = useCallback(async () => {
    if (!uid) return;
    const [{ data: t }, { data: tp }, { data: wd }] = await Promise.all([
      supabase.from('wallet_transactions').select('*').eq('user_id', uid).order('created_at', { ascending: false }).limit(50),
      supabase.from('topup_requests').select('*').eq('user_id', uid).eq('status', 'pending'),
      supabase.from('withdrawal_requests').select('*').eq('user_id', uid).eq('status', 'pending'),
    ]);
    setTxs((t as WalletTx[]) ?? []);
    setPending([...((tp as TopupRequest[]) ?? []), ...((wd as WithdrawalRequest[]) ?? [])]);
    setLoaded(true);
    await refreshWallet();
  }, [uid, refreshWallet]);
  useEffect(() => { load(); }, [load]);

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: bottomSpace, maxWidth: 720, width: '100%', alignSelf: 'center' }} showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
      <Entrance index={0} from="zoom">
        <BrandGradient colors={[colors.primary, colors.primaryDark]} style={[s.balance, shadow.glow(colors.primary)]}>
          <View style={s.orb} /><View style={[s.orb, { right: -60, top: 30, width: 160, height: 160, opacity: 0.12 }]} />
          <Row between>
            <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 13, fontWeight: '600' }}>Saldo AntarPay</Text>
            <Ionicons name="wallet" size={20} color="rgba(255,255,255,0.8)" />
          </Row>
          <AnimatedNumber value={wallet?.balance ?? 0} format={rupiah} style={{ color: '#fff', fontSize: 36, fontWeight: '800', marginVertical: 8, letterSpacing: -0.5 }} />
          <Row gap={10} style={{ marginTop: 8 }}>
            <WalletAction icon="add" label="Top Up" onPress={() => router.push('/pay/topup')} />
            {allowWithdraw && <WalletAction icon="arrow-up" label="Tarik Saldo" onPress={() => router.push('/pay/withdraw')} />}
          </Row>
        </BrandGradient>
      </Entrance>

      {pending.length > 0 && (
        <Entrance index={1}><Card style={{ marginTop: 16, backgroundColor: 'rgba(245,158,11,0.12)', borderColor: 'rgba(245,158,11,0.3)' }}>
          <Row gap={8}><Ionicons name="time" size={16} color={colors.warning} /><Text style={{ fontWeight: '700', color: colors.warning }}>Menunggu verifikasi admin</Text></Row>
          {pending.map((p) => (
            <Row key={p.id} between style={{ marginTop: 6 }}>
              <Text style={font.small}>{'bank_name' in p ? 'Penarikan' : 'Top up'} · {formatDate(p.created_at)}</Text>
              <Text style={{ fontWeight: '700' }}>{rupiah(p.amount)}</Text>
            </Row>
          ))}
        </Card></Entrance>
      )}

      <Entrance index={2}><Text style={[font.label, { marginTop: 20, marginBottom: 8 }]}>Riwayat transaksi</Text></Entrance>
      {!loaded ? (
        <Card padded={false}>{[0, 1, 2].map((i) => <Row key={i} gap={12} style={{ padding: 14 }}><Skeleton width={38} height={38} radius={19} /><View style={{ flex: 1, gap: 6 }}><Skeleton width="60%" height={14} /><Skeleton width="35%" height={11} /></View><Skeleton width={70} height={14} /></Row>)}</Card>
      ) : txs.length === 0 ? <Empty icon="wallet-outline" title="Belum ada transaksi" /> : (
        <Entrance index={3}><Card padded={false}>
          {txs.map((t, i) => {
            const m = txMeta[t.type];
            return (
              <Animated.View key={t.id} layout={LinearTransition}>
                <Row gap={12} style={{ padding: 14, borderTopWidth: i ? 1 : 0, borderTopColor: 'rgba(11,31,42,0.07)' }}>
                  <IconCircle name={m.icon as never} color={m.color} size={38} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ fontWeight: '600', color: colors.text }} numberOfLines={1}>{t.note ?? m.label}</Text>
                    <Text style={font.tiny}>{formatDate(t.created_at)}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ fontWeight: '800', color: t.amount >= 0 ? colors.success : colors.text }}>{t.amount >= 0 ? '+' : '-'}{rupiah(Math.abs(t.amount))}</Text>
                    <Text style={font.tiny}>Saldo {rupiah(t.balance_after)}</Text>
                  </View>
                </Row>
              </Animated.View>
            );
          })}
        </Card></Entrance>
      )}
      <View style={{ marginTop: 16 }}>
        <Badge text="Top up manual via transfer bank, diverifikasi admin ≤ 1×24 jam" color={colors.textSecondary} />
      </View>
    </ScrollView>
  );
}

function WalletAction({ icon, label, onPress }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; onPress: () => void }) {
  return (
    <PressableScale onPress={onPress} scaleTo={0.95} style={s.action}>
      <Ionicons name={icon} size={18} color="#fff" />
      <Text style={{ color: '#fff', fontWeight: '800', fontSize: 14 }}>{label}</Text>
    </PressableScale>
  );
}

const s = StyleSheet.create({
  balance: { borderRadius: radius.xxl, padding: 20, overflow: 'hidden' },
  orb: { position: 'absolute', right: -30, top: -50, width: 200, height: 200, borderRadius: 100, backgroundColor: '#fff', opacity: 0.08 },
  action: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.18)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)', borderRadius: radius.md, paddingVertical: 11 },
});
