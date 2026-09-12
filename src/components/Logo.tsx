// Logo AntarKita — konsep C29 "Dua Tetes Bersatu": dua tetes air saling mengunci membentuk lingkaran utuh (semangat yin-yang).
// Sumber: kanvas "AntarKita Logo Concepts" (pilihan Erza, 4 Sep 2026). Latar lingkaran berbeda per aplikasi: pelanggan teal, mitra tinta, admin abu-hijau.
import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing, useReducedMotion } from 'react-native-reanimated';
import { colors, font, shadow } from '@/lib/theme';
import { APP, BRAND } from '@/lib/app';

export const LOGO_BG: Record<string, string> = { pelanggan: '#0E9488', mitra: '#0F2A28', admin: '#1F3A38' };

/** Ikon logo: lingkaran berwarna + dua tetes (putih & mint). */
export function BrandLogo({ size = 48, tone, style, flat }: { size?: number; tone?: 'pelanggan' | 'mitra' | 'admin' | 'white'; style?: object; flat?: boolean }) {
  const bg = tone === 'white' ? '#FFFFFF' : LOGO_BG[tone ?? APP] ?? LOGO_BG.pelanggan;
  const dropA = tone === 'white' ? '#0E9488' : '#FFFFFF';
  const dropB = tone === 'white' ? '#0B6E64' : '#BFF3EA';
  return (
    <View style={[{ width: size, height: size, borderRadius: size / 2 }, !flat && shadow.glow(bg === '#FFFFFF' ? colors.primary : bg), style]}>
      <Svg width={size} height={size} viewBox="0 0 96 96">
        <Circle cx="48" cy="48" r="48" fill={bg} />
        <Path d="M48 18C48 18 66 26 66 44C66 53 59 60 50 60C43 60 38 55 38 48C38 43 41 40 46 40C49 40 51 42 51 45" fill={dropA} />
        <Path d="M48 78C48 78 30 70 30 52C30 43 37 36 46 36C53 36 58 41 58 48C58 53 55 56 50 56C47 56 45 54 45 51" fill={dropB} />
      </Svg>
    </View>
  );
}

/** Wordmark "AntarKita": "Antar" tinta, "Kita" teal (atau putih/mint di latar gelap). */
export function Wordmark({ size = 22, dark }: { size?: number; dark?: boolean }) {
  return (
    <Text style={{ fontSize: size, fontWeight: '700', letterSpacing: -size * 0.02, color: dark ? '#fff' : colors.text, lineHeight: size * 1.2 }}>
      Antar<Text style={{ color: dark ? '#BFF3EA' : colors.primary }}>Kita</Text>
    </Text>
  );
}

/** Logo + nama merek (untuk header/welcome). */
export function LogoLockup({ size = 40, dark, sub }: { size?: number; dark?: boolean; sub?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <BrandLogo size={size} />
      <View>
        <Wordmark size={size * 0.52} dark={dark} />
        <Text style={{ fontSize: Math.max(11, size * 0.26), color: dark ? 'rgba(255,255,255,0.8)' : colors.textSecondary, fontWeight: '600', letterSpacing: 0.6 }}>{sub ?? (APP === 'mitra' ? 'APLIKASI MITRA' : APP === 'admin' ? 'PANEL ADMIN' : 'ANTAR APA SAJA, BERSAMA KITA')}</Text>
      </View>
    </View>
  );
}

/** Logo berdenyut untuk halaman loading. */
export function LogoPulse({ size = 72, text }: { size?: number; text?: string }) {
  const p = useSharedValue(0);
  const reduce = useReducedMotion();
  useEffect(() => { if (!reduce) p.value = withRepeat(withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.sin) }), -1, true); }, [p, reduce]);
  const ring = useAnimatedStyle(() => ({ opacity: 0.5 - p.value * 0.5, transform: [{ scale: 1 + p.value * 0.6 }] }));
  const logo = useAnimatedStyle(() => ({ transform: [{ scale: 1 + p.value * 0.04 }] }));
  return (
    <View style={{ alignItems: 'center', gap: 14 }}>
      <View style={{ width: size * 1.8, height: size * 1.8, alignItems: 'center', justifyContent: 'center' }}>
        <Animated.View style={[{ position: 'absolute', width: size, height: size, borderRadius: size / 2, borderWidth: 2, borderColor: colors.primary }, ring]} />
        <Animated.View style={logo}><BrandLogo size={size} /></Animated.View>
      </View>
      {text ? <Text style={s.text}>{text}</Text> : null}
    </View>
  );
}

export { BRAND };
const s = StyleSheet.create({ text: { color: colors.textSecondary, fontWeight: '600', fontSize: 14 } });
