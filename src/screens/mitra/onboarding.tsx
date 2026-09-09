// Aplikasi Mitra — layar pilih jenis mitra untuk akun yang belum punya peran mitra.
import React, { useState } from 'react';
import { View, Text, Platform, Alert, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Screen, Row, Avatar, Badge, Button, type IconName } from '@/components/ui';
import { Entrance, PressableScale } from '@/components/motion';
import { ServiceIllustration, type ArtKind } from '@/components/ServiceArt';
import { useAuth } from '@/store/auth';
import { colors, font, radius, shadow } from '@/lib/theme';

// `short` dipakai untuk teks tombol footer: judul penuh ("Driver motor / mobil") membuat
// "Lanjut daftar · …" terpotong pada layar 360px.
const OPTIONS: { key: string; title: string; short: string; sub: string; art: ArtKind; color: string; href: string }[] = [
  { key: 'driver', title: 'Driver motor / mobil', short: 'Driver', sub: 'AntarRide, AntarCar, AntarFood, AntarSend, AntarShop, AntarMarket', art: 'rider', color: colors.ride, href: '/account/become-driver' },
  { key: 'box', title: 'Mobil box / pick up', short: 'Mobil box', sub: 'AntarBox: kirim barang, pindahan rumah/kost', art: 'box', color: colors.box, href: '/account/become-driver?vehicle=box' },
  { key: 'travel', title: 'Mitra travel & sopir pribadi', short: 'Mitra travel', sub: 'Kursi bersama, carter privat, atau sopir harian antar kota', art: 'travel', color: colors.travel, href: '/account/become-travel' },
  { key: 'merchant', title: 'Merchant makanan & minuman', short: 'Merchant', sub: 'Jual ke pelanggan AntarFood, badge halal', art: 'food', color: colors.food, href: '/account/become-merchant' },
  { key: 'vendor', title: 'Pedagang pasar tradisional', short: 'Lapak pasar', sub: 'Daftarkan lapak & barang dagangan Anda di AntarMarket', art: 'market', color: colors.market, href: '/account/become-vendor' },
];
const STATUS_LABEL: Record<string, string> = { pending: 'menunggu verifikasi', rejected: 'ditolak, kirim ulang', suspended: 'ditangguhkan' };
const LINKS: { icon: IconName; color?: string; title: string; subtitle?: string; key: 'support' | 'logout'; danger?: boolean }[] = [
  { icon: 'chatbubbles-outline', color: colors.info, title: 'Bantuan & tiket aduan', key: 'support' },
  { icon: 'log-out-outline', title: 'Keluar', key: 'logout', danger: true },
];

export default function MitraOnboarding() {
  const router = useRouter();
  const { profile, driver, merchant, travelPartner, marketVendor, signOut } = useAuth();
  const [choice, setChoice] = useState(OPTIONS[0].key);
  // Badge status pengajuan: sebelumnya menampilkan kode mentah ("Driver: rejected").
  const pending = ([
    [driver?.status, 'Driver'], [merchant?.status, 'Merchant'], [travelPartner?.status, 'Travel'], [marketVendor?.status, 'Pedagang pasar'],
  ] as [string | undefined, string][])
    .filter(([st]) => st && st !== 'approved')
    .map(([st, label]) => ({ text: `${label}: ${STATUS_LABEL[st as string] ?? st}`, danger: st !== 'pending' }));
  const confirmSignOut = () => {
    const doIt = async () => { await signOut(); router.replace('/(auth)/welcome'); };
    if (Platform.OS === 'web') { if (confirm('Keluar dari akun?')) doIt(); return; }
    Alert.alert('Keluar', 'Keluar dari akun?', [{ text: 'Batal' }, { text: 'Keluar', style: 'destructive', onPress: doIt }]);
  };
  const selected = OPTIONS.find((o) => o.key === choice) ?? OPTIONS[0];
  const onLink = (k: typeof LINKS[number]['key']) => k === 'support' ? router.push('/support' as never) : confirmSignOut();

  return (
    <Screen title="Jadi Mitra" footer={<Button title={`Lanjut daftar · ${selected.short}`} size="lg" icon="arrow-forward" onPress={() => router.push(selected.href as never)} />}>
      {/* Ilustrasi dalam lingkaran tint + judul besar */}
      <Entrance index={0} from="zoom">
        <View style={{ alignItems: 'center', marginTop: 6 }}>
          <View style={s.artCircle}><ServiceIllustration kind={selected.art} size={84} /></View>
          <Text style={[font.display, { textAlign: 'center', marginTop: 16 }]}>Satu akun,{'\n'}banyak peluang</Text>
          <Text style={[font.small, { textAlign: 'center', marginTop: 6 }]}>Driver, mitra travel, merchant, atau pedagang pasar — pilih jenis kemitraan yang cocok untuk Anda.</Text>
        </View>
      </Entrance>

      <Entrance index={1}>
        <Row gap={12} style={s.profile}>
          <Avatar name={profile?.full_name} url={profile?.avatar_url} size={44} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[font.body, { fontWeight: '700' }]} numberOfLines={1}>{profile?.full_name}</Text>
            <Text style={font.tiny}>Akun ini belum terdaftar sebagai mitra aktif.</Text>
          </View>
        </Row>
        {pending.length > 0 && <Row gap={6} style={{ marginTop: 10, flexWrap: 'wrap' }}>{pending.map((p) => <Badge key={p.text} text={p.text} color={p.danger ? colors.danger : colors.warning} />)}</Row>}
      </Entrance>

      {/* Kartu pilihan dengan radio bulat */}
      <Text style={[font.label, { marginTop: 22, marginBottom: 8 }]}>Jenis kemitraan</Text>
      <View style={{ gap: 10 }}>
        {OPTIONS.map((o, i) => {
          const active = o.key === choice;
          return (
            <Entrance key={o.key} index={2 + i}>
              <PressableScale onPress={() => setChoice(o.key)} scaleTo={0.985} haptic={false} style={[s.option, active && s.optionActive]}>
                <View style={[s.optionArt, { backgroundColor: o.color + '14' }]}><ServiceIllustration kind={o.art} size={40} /></View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[font.body, { fontWeight: '700' }]}>{o.title}</Text>
                  <Text style={font.tiny} numberOfLines={2}>{o.sub}</Text>
                </View>
                <View style={[s.radio, active && { borderColor: colors.primary }]}>{active && <View style={s.radioDot} />}</View>
              </PressableScale>
            </Entrance>
          );
        })}
      </View>

      <Entrance index={7}>
        <Text style={[font.label, { marginTop: 22, marginBottom: 8 }]}>Lainnya</Text>
        <View style={s.card}>
          {LINKS.map((it, i) => (
            <PressableScale key={it.key} onPress={() => onLink(it.key)} scaleTo={0.985} haptic={false} style={[s.item, i < LINKS.length - 1 && s.itemBorder]}>
              <View style={[s.itemIcon, it.danger && { backgroundColor: colors.dangerLight }, it.color && !it.danger && { backgroundColor: it.color + '14' }]}>
                <Ionicons name={it.icon} size={20} color={it.danger ? colors.danger : it.color ?? colors.primary} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[font.body, { fontWeight: '700' }, it.danger && { color: colors.danger }]} numberOfLines={1}>{it.title}</Text>
                {it.subtitle ? <Text style={font.tiny} numberOfLines={1}>{it.subtitle}</Text> : null}
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </PressableScale>
          ))}
        </View>
      </Entrance>
      <Text style={[font.tiny, { textAlign: 'center', marginTop: 20 }]}>Pengajuan diverifikasi admin (dokumen, kendaraan, sertifikasi). Notifikasi masuk di kotak masuk.</Text>
    </Screen>
  );
}

const s = StyleSheet.create({
  artCircle: { width: 132, height: 132, borderRadius: 66, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.primaryLight },
  profile: { marginTop: 20, padding: 12, borderRadius: radius.lg, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, ...shadow.soft },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 20, backgroundColor: '#fff', borderWidth: 1.5, borderColor: colors.border, ...shadow.soft },
  optionActive: { borderColor: colors.primary, backgroundColor: colors.tint },
  optionArt: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  radioDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.primary },
  card: { backgroundColor: '#fff', borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, ...shadow.soft },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  itemBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  itemIcon: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center' },
});
