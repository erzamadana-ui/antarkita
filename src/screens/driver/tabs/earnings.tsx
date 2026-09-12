import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Screen, Row } from '@/components/ui';
import { WalletView } from '@/components/WalletView';
import { AnimatedNumber, Entrance } from '@/components/motion';
import { TAB_BAR_SPACE } from '@/components/GlassTabBar';
import { rpc } from '@/lib/supabase';
import { colors, font, radius, shadow } from '@/lib/theme';
import { rupiah } from '@/lib/format';

export default function DriverEarnings() {
  const [sum, setSum] = useState<{ today: number; today_trips: number; week: number; month: number } | null>(null);
  const load = useCallback(async () => { try { setSum(await rpc('driver_earnings_summary')); } catch { /* noop */ } }, []);
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);
  return (
    <Screen title="Pendapatan" scroll={false} padded={false}>
      <View style={{ padding: 16, paddingBottom: 0, maxWidth: 720, width: '100%', alignSelf: 'center', gap: 12 }}>
        {/* Kartu hari ini (teal) */}
        <Entrance index={0} from="zoom">
          <View style={s.hero}>
            <Row gap={8}>
              <View style={s.heroIcon}><Ionicons name="sunny-outline" size={20} color="#fff" /></View>
              <Text style={s.lbl}>Pendapatan hari ini</Text>
            </Row>
            <AnimatedNumber value={sum?.today ?? 0} format={rupiah} style={{ color: '#fff', fontSize: 30, fontWeight: '700', letterSpacing: -0.5, marginTop: 8 }} />
            <Text style={s.lbl}>{sum?.today_trips ?? 0} trip selesai</Text>
          </View>
        </Entrance>
        {/* Statistik 2 kolom */}
        <Entrance index={1}>
          <Row gap={12}>
            <View style={s.stat}>
              <View style={s.statIcon}><Ionicons name="calendar-outline" size={20} color={colors.primary} /></View>
              <AnimatedNumber value={sum?.week ?? 0} format={rupiah} style={[font.h3, { marginTop: 10, color: colors.primary }]} />
              <Text style={font.tiny}>7 hari terakhir</Text>
            </View>
            <View style={s.stat}>
              <View style={s.statIcon}><Ionicons name="stats-chart-outline" size={20} color={colors.primary} /></View>
              <AnimatedNumber value={sum?.month ?? 0} format={rupiah} style={[font.h3, { marginTop: 10, color: colors.primary }]} />
              <Text style={font.tiny}>Bulan ini</Text>
            </View>
          </Row>
        </Entrance>
        <Entrance index={2}>
          <Row gap={8} style={s.note}>
            <Ionicons name="information-circle-outline" size={16} color={colors.primary} />
            <Text style={[font.tiny, { flex: 1 }]}>Order tunai: potongan platform 20% + biaya layanan dipotong dari saldo. Jaga saldo agar tetap positif (batas minus Rp500.000).</Text>
          </Row>
        </Entrance>
      </View>
      <WalletView allowWithdraw bottomSpace={TAB_BAR_SPACE + 16} />
    </Screen>
  );
}
const s = StyleSheet.create({
  hero: { borderRadius: radius.lg, padding: 18, backgroundColor: colors.primary, ...shadow.glow(colors.primary) },
  heroIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  lbl: { color: 'rgba(255,255,255,0.88)', fontSize: 12, fontWeight: '600' },
  stat: { flex: 1, padding: 14, borderRadius: radius.lg, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, ...shadow.soft },
  statIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center' },
  note: { padding: 12, borderRadius: radius.md, backgroundColor: colors.tint, alignItems: 'flex-start' },
});
