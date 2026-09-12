// Tab Pembayaran: metode bayar (tunai / AntarPay / e-wallet / e-money) + riwayat saldo AntarPay
import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Screen, Row } from '@/components/ui';
import { PressableScale } from '@/components/motion';
import { WalletView } from '@/components/WalletView';
import { PaymentMethodsPanel } from '@/components/PaymentMethods';
import { TAB_BAR_SPACE } from '@/components/GlassTabBar';
import { colors, radius, shadow } from '@/lib/theme';
import { useT } from '@/lib/i18n';

type Tab = 'methods' | 'wallet';

export default function CustomerPay() {
  const [tab, setTab] = useState<Tab>('methods');
  const t = useT();
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
      {tab === 'methods' ? <View style={{ paddingTop: 6 }}>{pills}<View style={s.inner}><PaymentMethodsPanel /></View></View> : <View style={{ flex: 1, paddingTop: 6 }}>{pills}<WalletView bottomSpace={TAB_BAR_SPACE + 16} /></View>}
    </Screen>
  );
}

const s = StyleSheet.create({
  inner: { width: '100%', maxWidth: 720, alignSelf: 'center', paddingHorizontal: 16 },
  tab: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 18, paddingVertical: 12, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, backgroundColor: '#fff', ...shadow.soft },
  tabOn: { backgroundColor: colors.primary, borderColor: colors.primary },
});
