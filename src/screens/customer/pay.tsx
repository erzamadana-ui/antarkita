// Tab Pembayaran: metode bayar (tunai / AntarVoucher / e-wallet / e-money) + riwayat saldo AntarVoucher
import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Screen, Row } from '@/components/ui';
import { PressableScale } from '@/components/motion';
import { WalletView } from '@/components/WalletView';
import { PaymentMethodsPanel } from '@/components/PaymentMethods';
import { TAB_BAR_SPACE } from '@/components/GlassTabBar';
import { colors, radius, shadow } from '@/lib/theme';
import { useT } from '@/lib/i18n';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { font } from '@/lib/theme';

type Tab = 'methods' | 'wallet';

export default function CustomerPay() {
  const [tab, setTab] = useState<Tab>('methods');
  const t = useT();
  const router = useRouter();
  const tabs: { key: Tab; label: string }[] = [{ key: 'methods', label: 'Metode' }, { key: 'wallet', label: 'Saldo' }];
  const pills = (
    <View style={s.inner}>
      <Row gap={8} style={{ paddingBottom: 12 }}>
        {tabs.map((x) => (
          <PressableScale key={x.key} onPress={() => setTab(x.key)} scaleTo={0.94} style={[s.tab, tab === x.key && s.tabOn]}>
            <Text style={{ fontSize: 14, fontWeight: '700', color: tab === x.key ? '#fff' : colors.text }}>{x.label}</Text>
          </PressableScale>
        ))}
      </Row>
    </View>
  );
  return (
    <Screen title={t('payment_methods')} scroll={tab === 'methods'} padded={false} bottomSpace={TAB_BAR_SPACE + 16}>
      {tab === 'methods' ? <View style={{ paddingTop: 6 }}>{pills}<View style={[s.inner, { gap: 14 }]}><HistoryLink onPress={() => router.push('/pay/history' as never)} label={t('payment_history')} /><PaymentMethodsPanel /></View></View> : <View style={{ flex: 1, paddingTop: 6 }}>{pills}<WalletView bottomSpace={TAB_BAR_SPACE + 16} /></View>}
    </Screen>
  );
}

/** Pintu ke riwayat pembayaran (status, bukti transaksi, kode bantuan CS). */
function HistoryLink({ onPress, label }: { onPress: () => void; label: string }) {
  return (
    <PressableScale onPress={onPress} scaleTo={0.98} haptic={false} style={s.link}>
      <View style={s.linkIcon}><Ionicons name="time-outline" size={20} color={colors.primary} /></View>
      <View style={{ flex: 1 }}><Text style={{ fontWeight: '700', color: colors.text }}>{label}</Text><Text style={font.tiny}>Status, bukti transaksi & kode bantuan CS</Text></View>
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </PressableScale>
  );
}

const s = StyleSheet.create({
  link: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: radius.lg, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, ...shadow.soft },
  linkIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center' },
  inner: { width: '100%', maxWidth: 720, alignSelf: 'center', paddingHorizontal: 16 },
  tab: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 18, paddingVertical: 12, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, backgroundColor: '#fff', ...shadow.soft },
  tabOn: { backgroundColor: colors.primary, borderColor: colors.primary },
});
