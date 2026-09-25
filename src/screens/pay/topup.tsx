// Isi AntarVoucher (`/pay/topup`) — dua jalur resmi:
//  1. Top up instan lewat payment gateway (`/pay/gateway`) — saldo masuk otomatis.
//  2. Transfer ke rekening resmi PT Antar Kita Indonesia (`/pay/voucher`, migrasi 0112) — saldo masuk setelah
//     tim Finance mencocokkan mutasi bank.
// Alur lama "transfer manual + unggah screenshot" (app_settings.bank_account + request_topup) DIHAPUS:
// rekening non-resmi & saldo berbasis screenshot adalah risiko P0.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Screen } from '@/components/ui';
import { Entrance, PressableScale } from '@/components/motion';
import { useAntarVoucher } from '@/hooks/useAppSettings';
import { AntarVoucherOffBanner } from '@/components/AntarVoucherNotice';
import { colors, font, radius } from '@/lib/theme';

export default function TopUp() {
  const router = useRouter();
  const { enabled: antarVoucherOn } = useAntarVoucher();   // 0088: gateway top up ditolak server saat nonaktif

  return (
    <Screen title="Isi AntarVoucher" back maxWidth={560}>
      <View style={{ gap: 16 }}>
        {!antarVoucherOn && <Entrance index={0}><AntarVoucherOffBanner /></Entrance>}
        <Entrance index={0}>
          <Option
            icon="flash"
            color={colors.primary}
            title="Top up instan"
            subtitle="GoPay, OVO, DANA, ShopeePay, QRIS, atau virtual account. Saldo langsung masuk otomatis lewat payment gateway."
            disabled={!antarVoucherOn}
            onPress={() => router.push('/pay/gateway' as never)}
          />
        </Entrance>
        <Entrance index={1}>
          <Option
            icon="business"
            color={colors.info}
            title="Transfer ke rekening resmi AntarKita"
            subtitle="Transfer bank ke rekening atas nama PT Antar Kita Indonesia. Saldo masuk setelah dana dicocokkan tim Finance — tanpa unggah bukti."
            onPress={() => router.push('/pay/voucher' as never)}
          />
        </Entrance>
        <Entrance index={2}>
          <View style={s.warn}>
            <Ionicons name="shield-checkmark-outline" size={20} color={colors.danger} />
            <Text style={[font.small, { flex: 1, minWidth: 0, color: colors.text }]}>Jangan transfer ke rekening selain yang tertera di aplikasi. AntarKita tidak pernah meminta transfer lewat chat atau telepon.</Text>
          </View>
        </Entrance>
      </View>
    </Screen>
  );
}

function Option({ icon, color, title, subtitle, onPress, disabled }: { icon: React.ComponentProps<typeof Ionicons>['name']; color: string; title: string; subtitle: string; onPress: () => void; disabled?: boolean }) {
  return (
    <PressableScale disabled={disabled} onPress={onPress} scaleTo={0.98} accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled: !!disabled }}
      style={[s.opt, { backgroundColor: color + '14', borderColor: color + '44' }, disabled && { opacity: 0.5 }]}>
      <View style={[s.optIcon, { backgroundColor: color }]}><Ionicons name={icon} size={20} color="#fff" /></View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={{ fontWeight: '700', color: colors.text, fontSize: 16 }}>{title}</Text>
        <Text style={font.tiny}>{subtitle}</Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={color} />
    </PressableScale>
  );
}

const s = StyleSheet.create({
  opt: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 72, padding: 14, borderRadius: radius.lg, borderWidth: 1.5 },
  optIcon: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  warn: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 12, borderRadius: radius.md, backgroundColor: colors.dangerLight },
});
