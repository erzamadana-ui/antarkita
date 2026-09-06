import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Screen, Row, Avatar, Badge, Button, CircleButton, type IconName } from '@/components/ui';
import { Entrance, PressableScale } from '@/components/motion';
import { TAB_BAR_SPACE } from '@/components/GlassTabBar';
import { VehicleServiceMatrix } from '@/components/driver';
import { useAuth } from '@/store/auth';
import { useMode } from '@/store/mode';
import { colors, font, radius, shadow } from '@/lib/theme';
import { FUEL_LABEL } from '@/lib/vehicles';

type Item = { icon: IconName; color?: string; title: string; subtitle?: string; onPress: () => void; danger?: boolean };

export default function DriverAccount() {
  const router = useRouter();
  const { profile, driver, merchant, signOut, marketVendor } = useAuth();
  const setMode = useMode((s) => s.setMode);
  const approved = driver?.status === 'approved';

  const groups: { title: string; items: Item[] }[] = [
    { title: 'Akun & kendaraan', items: [
      { icon: 'person-outline', title: 'Edit profil', subtitle: 'Nama, nomor HP, foto', onPress: () => router.push('/account/edit') },
      { icon: 'car-outline', title: 'Data kendaraan & dokumen', subtitle: [driver?.vehicle_class ? `Kelas: ${driver.vehicle_class}` : null, [driver?.vehicle_brand, driver?.vehicle_model].filter(Boolean).join(' ') || null, driver?.vehicle_year ? String(driver.vehicle_year) : null].filter(Boolean).join(' · ') || 'SIM, STNK, foto kendaraan', onPress: () => router.push('/account/become-driver') },
      { icon: 'bus-outline', color: colors.travel, title: 'Mitra AntarTravel', subtitle: 'Jadwal travel antar kota, manifest penumpang', onPress: () => router.push('/driver/travel' as never) },
    ] },
    { title: 'Lainnya', items: [
      { icon: 'shield-checkmark-outline', color: colors.danger, title: 'Pusat Keamanan', subtitle: 'SOS, verifikasi wajah, kontak darurat, laporan insiden', onPress: () => router.push('/safety' as never) },
      { icon: 'chatbubbles-outline', color: colors.info, title: 'Bantuan & tiket aduan', subtitle: 'CS online', onPress: () => router.push('/support' as never) },
      { icon: 'language-outline', title: 'Bahasa / Language', onPress: () => router.push('/account/language') },
      { icon: 'key-outline', title: 'Ganti kata sandi', subtitle: 'Perbarui kata sandi akun Anda', onPress: () => router.push('/account/password' as never) },
      { icon: 'trash-outline', color: colors.danger, title: 'Hapus akun', subtitle: 'Hapus data pribadi secara permanen', onPress: () => router.push('/account/delete' as never) },
    ] },
  ];

  return (
    <Screen title="Akun Mitra" bottomSpace={TAB_BAR_SPACE + 16} right={<CircleButton icon="create-outline" onPress={() => router.push('/account/edit')} />}>
      {/* Profil ala "Mine Page": avatar besar di tengah, nama, kendaraan, badge status */}
      <Entrance index={0} from="zoom">
        <View style={{ alignItems: 'center', marginTop: 8 }}>
          <View style={s.avatarRing}><Avatar name={profile?.full_name} url={profile?.avatar_url} size={96} /></View>
          <Text style={[font.h1, { marginTop: 12, textAlign: 'center' }]}>{profile?.full_name}</Text>
          <Text style={[font.small, { textAlign: 'center' }]}>{[[driver?.vehicle_brand, driver?.vehicle_model].filter(Boolean).join(' '), driver?.fuel_type ? FUEL_LABEL[driver.fuel_type] : null, driver?.vehicle_plate].filter(Boolean).join(' · ')}</Text>
          <Badge text={approved ? 'Mitra aktif' : `Status: ${driver?.status ?? '-'}`} color={approved ? colors.success : colors.warning} style={{ marginTop: 8 }} />
        </View>
      </Entrance>
      {/* 3 statistik: rating / ulasan / trip */}
      <Entrance index={1}>
        <View style={s.stats}>
          <View style={s.stat}>
            <Row gap={4}><Ionicons name="star" size={16} color={colors.accent} /><Text style={[font.h2, { color: colors.primary }]}>{Number(driver?.rating_avg ?? 5).toFixed(2)}</Text></Row>
            <Text style={font.tiny}>Rating</Text>
          </View>
          <View style={s.vDivider} />
          <View style={s.stat}>
            <Text style={[font.h2, { color: colors.primary }]}>{driver?.rating_count ?? 0}</Text>
            <Text style={font.tiny}>Ulasan</Text>
          </View>
          <View style={s.vDivider} />
          <PressableScale onPress={() => router.push('/(driver)/history' as never)} scaleTo={0.97} haptic={false} style={s.stat}>
            <Text style={[font.h2, { color: colors.primary }]}>{driver?.total_trips ?? 0}</Text>
            <Text style={font.tiny}>Total trip</Text>
          </PressableScale>
        </View>
      </Entrance>

      {/* Penjelasan singkat: layanan apa saja yang bisa diambil kendaraan ini (matriks server `driver_can_take`) */}
      <Entrance index={2} style={{ marginTop: 16 }}>
        <VehicleServiceMatrix vehicle={driver?.vehicle_type} />
      </Entrance>

      {groups.map((g, gi) => (
        <Entrance key={g.title} index={gi + 3}>
          <Text style={[font.label, { marginTop: 22, marginBottom: 8 }]}>{g.title}</Text>
          <View style={s.card}>
            {g.items.map((it, i) => (
              <PressableScale key={it.title} onPress={it.onPress} scaleTo={0.985} haptic={false} style={[s.item, i < g.items.length - 1 && s.itemBorder]}>
                <View style={[s.itemIcon, it.color && { backgroundColor: it.color + '14' }]}>
                  <Ionicons name={it.icon} size={20} color={it.color ?? colors.primary} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[font.body, { fontWeight: '700' }]} numberOfLines={1}>{it.title}</Text>
                  {it.subtitle ? <Text style={font.tiny} numberOfLines={2}>{it.subtitle}</Text> : null}
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
              </PressableScale>
            ))}
          </View>
        </Entrance>
      ))}

      <Entrance index={4} style={{ marginTop: 22, gap: 10 }}>
        {merchant ? <Button title="Beralih ke Mode Merchant" variant="secondary" icon="storefront-outline" onPress={async () => { await setMode('merchant'); router.replace('/(merchant)'); }} /> : null}
        {marketVendor ? <Button title="Beralih ke Lapak Pasar" variant="secondary" icon="basket-outline" onPress={() => router.replace('/(vendor)' as never)} /> : null}
        <Button title="Keluar" variant="outline" color={colors.danger} icon="log-out-outline" onPress={async () => { await signOut(); router.replace('/(auth)/welcome'); }} />
      </Entrance>
      <Row style={{ justifyContent: 'center', marginTop: 24 }}><Text style={font.tiny}>AntarKita Mitra v3.0</Text></Row>
    </Screen>
  );
}

const s = StyleSheet.create({
  avatarRing: { padding: 4, borderRadius: 60, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, ...shadow.card },
  stats: { flexDirection: 'row', alignItems: 'center', marginTop: 16, padding: 14, borderRadius: radius.lg, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, ...shadow.soft },
  stat: { flex: 1, alignItems: 'center', gap: 2 },
  vDivider: { width: 1, height: 36, backgroundColor: colors.border },
  card: { backgroundColor: '#fff', borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, ...shadow.soft },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  itemBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  itemIcon: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center' },
});
