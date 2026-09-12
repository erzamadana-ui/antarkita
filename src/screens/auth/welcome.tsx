// Onboarding gaya kit: latar putih, ilustrasi besar dalam lingkaran tint, judul besar, indikator 01/03, tombol teal + tombol putih border
import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { Button, Row } from '@/components/ui';
import { Entrance, PressableScale } from '@/components/motion';
import { BrandLogo } from '@/components/Logo';
import { ServiceIllustration, type ArtKind } from '@/components/ServiceArt';
import { useT } from '@/lib/i18n';
import { colors, font, motion, radius, shadow } from '@/lib/theme';
import { LanguageRow } from '@/components/LanguagePicker';
import { APP, APP_NAME, APP_TAGLINE } from '@/lib/app';

type Slide = { art: ArtKind; title: string; sub: string; chips: string[] };

const SLIDES: Record<typeof APP, Slide[]> = {
  pelanggan: [
    { art: 'rider', title: 'Antar apa saja,\nbersama kita', sub: 'Ojek, mobil, makanan, kirim barang, dan belanja. Satu aplikasi untuk semua kebutuhan harian.', chips: ['AntarRide', 'AntarCar', 'AntarFood', 'AntarSend'] },
    { art: 'travel', title: 'Jalan-jalan antar kota,\njemput di rumah', sub: 'Kursi bersama, carter privat, atau sopir harian dari mitra travel resmi.', chips: ['Kursi bersama', 'Carter privat', 'Sopir harian'] },
    { art: 'market', title: 'Belanja dibelikan,\nbayar harga riil', sub: 'Minimarket, apotek, sampai pasar tradisional. Driver kirim foto nota, Anda bayar sesuai nota.', chips: ['AntarShop', 'AntarMarket', 'AntarPay'] },
  ],
  mitra: [
    { art: 'rider', title: 'Penghasilan tambahan,\njadwal Anda sendiri', sub: 'Jadi mitra driver motor, mobil, atau box. Terima pesanan kapan pun Anda siap.', chips: ['Driver motor', 'Driver mobil', 'Mobil box'] },
    { art: 'food', title: 'Buka toko,\njangkau lebih banyak pelanggan', sub: 'Daftarkan usaha makanan Anda; pesanan diantar driver AntarKita.', chips: ['Merchant makanan', 'Halal / non-halal'] },
    { art: 'travel', title: 'Mitra travel\n& sopir harian', sub: 'Jual kursi perjalanan antar kota, terima carter privat, atau tawarkan jasa sopir harian.', chips: ['Kursi bersama', 'Carter', 'Sopir harian'] },
  ],
  admin: [
    { art: 'pay', title: 'Panel operasional\nAntarKita', sub: 'Khusus akun admin: verifikasi mitra, katalog, promo, gateway pembayaran, dan laporan.', chips: ['Verifikasi', 'Katalog', 'Laporan'] },
  ],
};

export default function Welcome() {
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const wide = width >= 900;
  const short = !wide && height < 780;
  const t = useT();
  const slides = SLIDES[APP];
  const [i, setI] = useState(0);
  const slide = slides[i];
  const last = i === slides.length - 1;
  const pad = (n: number) => String(n).padStart(2, '0');

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1 }} showsVerticalScrollIndicator={false} bounces={false}>
        <View style={[s.wrap, wide && { flexDirection: 'row', alignItems: 'center', gap: 56, paddingHorizontal: 64 }]}>
          <View style={{ flex: 1, justifyContent: 'center' }}>
            <Entrance index={0}>
              <Row between>
                <Row gap={10}><BrandLogo size={36} /><View><Text style={[font.h3, { fontSize: 16 }]}>{APP_NAME[APP]}</Text><Text style={font.tiny}>{APP_TAGLINE}</Text></View></Row>
                {!last && slides.length > 1 ? <PressableScale onPress={() => setI(slides.length - 1)} hitSlop={8} scaleTo={0.94}><Text style={{ color: colors.primary, fontWeight: '700', fontSize: 14 }}>Lewati</Text></PressableScale> : null}
              </Row>
            </Entrance>

            <Animated.View key={i} entering={FadeIn.duration(motion.slow)} exiting={FadeOut.duration(motion.fast)} style={{ alignItems: 'center', marginTop: wide ? 40 : short ? 16 : 28 }}>
              <View style={[s.artRing, short && { width: 200, height: 200, borderRadius: 100 }]}>
                <View style={[s.artInner, short && { width: 160, height: 160, borderRadius: 80 }]}><ServiceIllustration kind={slide.art} size={wide ? 180 : short ? 112 : 150} /></View>
              </View>
              <Text style={[font.display, { fontSize: wide ? 40 : short ? 26 : 30, lineHeight: wide ? 46 : short ? 32 : 36, textAlign: 'center', marginTop: short ? 18 : 28 }]}>{slide.title}</Text>
              <Text style={[font.small, { textAlign: 'center', marginTop: 10, fontSize: 14, lineHeight: 21, maxWidth: 360 }]}>{slide.sub}</Text>
              <Row gap={6} style={{ flexWrap: 'wrap', justifyContent: 'center', marginTop: 14 }}>
                {slide.chips.map((c) => <View key={c} style={s.chip}><Text style={s.chipText}>{c}</Text></View>)}
              </Row>
            </Animated.View>

            {slides.length > 1 && (
              <Row between style={{ marginTop: 24 }}>
                <Row gap={6}>
                  {slides.map((_, k) => <PressableScale key={k} onPress={() => setI(k)} hitSlop={6} scaleTo={0.9} style={[s.dot, k === i && s.dotOn]}><View /></PressableScale>)}
                </Row>
                <Text style={[font.small, { fontWeight: '700', color: colors.text }]}>{pad(i + 1)}<Text style={font.tiny}>/{pad(slides.length)}</Text></Text>
              </Row>
            )}
          </View>

          <Entrance index={2} style={wide ? { width: 400 } : undefined}>
            <View style={{ gap: 10, marginTop: 20 }}>
              {!last && slides.length > 1 ? (
                <Button title="Lanjut" size="lg" icon="arrow-forward" onPress={() => setI(i + 1)} />
              ) : APP !== 'admin' ? (
                <Button title={APP === 'mitra' ? 'Daftar jadi mitra' : t('create_account')} size="lg" onPress={() => router.push('/(auth)/register')} />
              ) : null}
              <Button title={t('login')} size="lg" variant={last && APP === 'admin' ? 'primary' : 'outline'} color={last && APP === 'admin' ? colors.primary : colors.text} style={!(last && APP === 'admin') ? s.whiteBtn : undefined} onPress={() => router.push('/(auth)/login')} />
              <Text style={[font.tiny, { textAlign: 'center' }]}>{APP === 'mitra' ? 'Sudah punya akun mitra? Masuk, lalu lanjutkan pengajuan kemitraan Anda.' : APP === 'admin' ? 'Akun pelanggan/mitra tidak bisa masuk ke panel ini.' : t('partner_hint')}</Text>
              <LanguageRow />
            </View>
          </Entrance>
        </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, padding: 24, justifyContent: 'space-between', width: '100%', maxWidth: 1100, alignSelf: 'center' },
  artRing: { width: 260, height: 260, borderRadius: 130, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.primaryLight },
  artInner: { width: 210, height: 210, borderRadius: 105, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', ...shadow.card },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, backgroundColor: '#fff' },
  chipText: { color: colors.text, fontWeight: '700', fontSize: 12 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.border },
  dotOn: { width: 24, backgroundColor: colors.primary },
  whiteBtn: { backgroundColor: '#fff', borderColor: colors.border, borderWidth: 1.5 },
});
