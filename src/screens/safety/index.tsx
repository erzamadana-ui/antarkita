// Pusat Keamanan — SOS, kontak darurat, verifikasi wajah (driver), bagikan perjalanan, laporan insiden, tips
import React from 'react';
import { View, Text, StyleSheet, Linking } from 'react-native';
import { useRouter } from 'expo-router';
import { Screen, Card, Row, Badge, Button, ListItem, Divider, IconCircle } from '@/components/ui';
import { Entrance } from '@/components/motion';
import { SosButton, EmergencyContactCard } from '@/components/Safety';
import { useAuth } from '@/store/auth';
import { useMode } from '@/store/mode';
import { colors, font, radius, shadow } from '@/lib/theme';
import { formatDate } from '@/lib/format';

const TIPS_DRIVER = [
  ['Verifikasi wajah tiap sebelum online', 'Mencegah akun dipakai orang lain — standar Gojek/Grab.'],
  ['Cocokkan PIN pelanggan', 'Minta 4 digit PIN sebelum memulai perjalanan ride.'],
  ['Nomor HP disamarkan', 'Telepon & chat lewat aplikasi; nomor Anda tidak dibagikan (UU PDP).'],
  ['Gunakan helm SNI & patuhi lalu lintas', 'Rating dan prioritas order dipengaruhi laporan pelanggan.'],
  ['Jangan bawa pelanggan di luar aplikasi', 'Perjalanan di luar aplikasi tidak dilindungi asuransi & tidak tercatat.'],
  ['Istirahat tiap 4 jam online', 'Kelelahan = risiko kecelakaan. Sistem mengingatkan Anda.'],
];
const TIPS_CUSTOMER = [
  ['Cocokkan plat & wajah driver', 'Lihat kartu driver di layar lacak sebelum naik.'],
  ['Sebutkan PIN ke driver', 'Driver hanya bisa memulai perjalanan dengan PIN Anda.'],
  ['Bagikan perjalanan', 'Kirim tautan pantau posisi ke keluarga/teman.'],
  ['Nomor HP Anda disamarkan', 'Driver menelepon lewat aplikasi, bukan nomor asli.'],
  ['Tombol SOS', 'Tahan 2 detik — tim keamanan & kontak darurat dihubungi.'],
];

export default function SafetyCenter() {
  const router = useRouter();
  const { driver } = useAuth();
  const mode = useMode((s) => s.mode);
  const isDriver = mode === 'driver';
  const tips = isDriver ? TIPS_DRIVER : TIPS_CUSTOMER;
  const selfieOk = driver?.last_selfie_at && Date.now() - new Date(driver.last_selfie_at).getTime() < 20 * 3600e3;

  return (
    <Screen title="Pusat Keamanan" back>
      <View style={{ gap: 16 }}>
        <Entrance index={0}>
          <View style={s.hero}>
            {/* Ikon + teks satu baris; tombol SOS di bawah selebar kartu agar teks tidak terjepit di layar sempit */}
            <Row gap={12} style={{ alignItems: 'flex-start' }}>
              <IconCircle name="shield-checkmark-outline" size={52} bg={colors.tint} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={font.h2}>Anda dilindungi</Text>
                <Text style={[font.small, { marginTop: 2 }]}>Panggilan tersamar, PIN penjemputan, bagikan perjalanan, SOS 24 jam, dan asuransi perjalanan mitra.</Text>
              </View>
            </Row>
            <SosButton style={{ marginTop: 14 }} />
          </View>
        </Entrance>

        {isDriver && driver && (
          <Entrance index={1}><Card solid style={{ gap: 8 }}>
            <Row between>
              <Row gap={10}><IconCircle name="person-circle-outline" size={40} bg={selfieOk ? colors.successLight : colors.accentLight} color={selfieOk ? colors.success : colors.warning} /><View><Text style={font.h3}>Verifikasi wajah</Text><Text style={font.tiny}>{driver.last_selfie_at ? `Terakhir ${formatDate(driver.last_selfie_at)}` : 'Belum pernah verifikasi'}</Text></View></Row>
              <Badge text={selfieOk ? 'Aktif' : 'Perlu verifikasi'} color={selfieOk ? colors.success : colors.warning} />
            </Row>
            <Text style={font.tiny}>Wajib setiap 20 jam sebelum online — akan diminta otomatis saat Anda menyalakan saklar online.</Text>
          </Card></Entrance>
        )}

        <Entrance index={2}><EmergencyContactCard /></Entrance>

        <Entrance index={3}><Card solid padded={false}>
          <View style={{ paddingHorizontal: 12 }}>
            <ListItem icon="warning-outline" iconColor={colors.danger} title="Laporkan insiden / kecelakaan" subtitle="Prioritas darurat, CS menghubungi Anda" onPress={() => router.push({ pathname: '/support/new', params: { category: 'safety' } } as never)} />
            <Divider style={{ marginVertical: 0 }} />
            <ListItem icon="chatbubbles-outline" iconColor={colors.info} title="Pusat Bantuan & tiket" subtitle="Kendala pesanan, saldo, akun" onPress={() => router.push('/support' as never)} />
            <Divider style={{ marginVertical: 0 }} />
            <ListItem icon="call-outline" iconColor={colors.danger} title="Panggilan darurat 112" subtitle="Polisi · ambulans · pemadam" onPress={() => Linking.openURL('tel:112')} />
          </View>
        </Card></Entrance>

        <Entrance index={4}><Card solid style={{ gap: 10 }}>
          <Text style={font.label}>Standar keselamatan {isDriver ? 'mitra' : 'pelanggan'}</Text>
          {tips.map(([t, d]) => (
            <Row key={t} gap={10} style={{ alignItems: 'flex-start' }}>
              <IconCircle name="checkmark" size={28} bg={colors.successLight} color={colors.success} />
              <View style={{ flex: 1 }}><Text style={{ fontWeight: '700', color: colors.text, fontSize: 14 }}>{t}</Text><Text style={font.tiny}>{d}</Text></View>
            </Row>
          ))}
        </Card></Entrance>
        <Entrance index={5}><Button title="Kembali" variant="ghost" onPress={() => router.back()} /></Entrance>
      </View>
    </Screen>
  );
}
const s = StyleSheet.create({ hero: { borderRadius: radius.lg, padding: 16, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, ...shadow.card } });
