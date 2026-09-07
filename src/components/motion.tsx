// Primitif gerak — semua menghormati pengaturan "Reduce Motion".
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View, Text, Platform, type PressableProps, type StyleProp, type ViewStyle, type TextStyle } from 'react-native';
import * as Haptics from 'expo-haptics';
import Animated, {
  useSharedValue, useAnimatedStyle, withSpring, withTiming, withRepeat, withDelay, withSequence, Easing,
  useReducedMotion, FadeInDown, FadeInUp, FadeIn, FadeOut, ZoomIn, Layout, LinearTransition, interpolate, cancelAnimation,
} from 'react-native-reanimated';
import { colors, motion } from '@/lib/theme';

export { FadeIn, FadeOut, FadeInDown, FadeInUp, ZoomIn, Layout, LinearTransition };

/**
 * Muncul dengan jeda berurutan (index * stagger).
 *
 * PENTING (bug "menu blank" di APK Android): dulu komponen ini memakai animasi layout
 * `entering={FadeInDown.delay(...)}`. Animasi `entering` dijalankan oleh modul
 * LayoutAnimations Reanimated di sisi native — pada build release Android animasi itu
 * bisa TIDAK PERNAH dijalankan (layar dibekukan `react-native-screens`, induk re-render /
 * remount saat navigasi cepat, atau view sudah terpasang sebelum manajer animasi siap).
 * Bila itu terjadi, view tetap berada di keadaan awal animasi, yaitu `opacity: 0` —
 * selamanya. Hasilnya: grid layanan, pesanan berjalan, dan promo hilang walau datanya ada.
 *
 * Sekarang animasi digerakkan dari mount (useEffect + shared value) dan SELALU berakhir
 * di keadaan terlihat (progress = 1), dengan jaring pengaman timer yang memaksa nilai akhir
 * bila animasi tidak berjalan. API tidak berubah: `index`, `from`, `delay`, `style`.
 */
const ENTRANCE_SHIFT = 14;
export function Entrance({ children, index = 0, style, from = 'down', delay = 0 }: { children: React.ReactNode; index?: number; style?: StyleProp<ViewStyle>; from?: 'down' | 'up' | 'fade' | 'zoom'; delay?: number }) {
  const reduce = useReducedMotion();
  const d = delay + Math.min(index, 8) * motion.stagger;
  // 0 = keadaan awal animasi, 1 = terlihat penuh. Reduce Motion → langsung 1 (tanpa animasi).
  const p = useSharedValue(reduce ? 1 : 0);
  useEffect(() => {
    if (reduce) { cancelAnimation(p); p.value = 1; return; }
    p.value = withDelay(d, withTiming(1, { duration: motion.slow, easing: motion.easeOut }));
    // Jaring pengaman: apa pun yang terjadi pada UI thread, sesudah jeda + durasi + margin
    // elemen dipaksa terlihat. Idempoten — bila animasi normal, nilainya memang sudah 1.
    const tm = setTimeout(() => { cancelAnimation(p); p.value = 1; }, d + motion.slow + 400);
    return () => clearTimeout(tm);
  }, [reduce, d, p]);
  const a = useAnimatedStyle(() => {
    const t = p.value;
    if (from === 'fade') return { opacity: t, transform: [] };
    if (from === 'zoom') return { opacity: t, transform: [{ scale: 0.94 + t * 0.06 }] };
    // 'down' = datang dari bawah (seperti FadeInDown), 'up' = datang dari atas.
    return { opacity: t, transform: [{ translateY: (1 - t) * ENTRANCE_SHIFT * (from === 'up' ? -1 : 1) }] };
  }, [from]);
  return <Animated.View style={[style, a]}>{children}</Animated.View>;
}

/** Pressable dengan efek pegas (mengecil saat ditekan) + haptic ringan. */
const OUTER_KEYS = new Set(['width', 'height', 'flex', 'flexGrow', 'flexShrink', 'flexBasis', 'alignSelf', 'margin', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight', 'marginHorizontal', 'marginVertical', 'position', 'top', 'left', 'right', 'bottom', 'zIndex', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight']);
export function PressableScale({ children, style, scaleTo = 0.96, haptic = true, disabled, onPress, ...rest }: PressableProps & { children: React.ReactNode; style?: StyleProp<ViewStyle>; scaleTo?: number; haptic?: boolean }) {
  const s = useSharedValue(1);
  const reduce = useReducedMotion();
  const a = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  // Properti tata letak (lebar/flex/margin/posisi) harus dipasang di Pressable luar agar berlaku terhadap induk (Row/grid);
  // sisanya (warna, padding, radius) di View dalam yang dianimasikan.
  const flat = (StyleSheet.flatten(style) ?? {}) as Record<string, unknown>;
  const outer: Record<string, unknown> = {}; const innerStyle: Record<string, unknown> = {};
  for (const k of Object.keys(flat)) { if (OUTER_KEYS.has(k)) outer[k] = flat[k]; else innerStyle[k] = flat[k]; }
  if ('width' in outer || 'flex' in outer || 'flexGrow' in outer) innerStyle.width = '100%';
  if ('height' in outer) innerStyle.height = '100%';
  return (
    <Pressable
      style={outer as ViewStyle}
      disabled={disabled}
      onPressIn={() => { if (!reduce) s.value = withSpring(scaleTo, motion.spring); }}
      onPressOut={() => { s.value = withSpring(1, motion.springBouncy); }}
      onPress={(e) => { if (haptic && Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); onPress?.(e); }}
      {...rest}
    >
      <Animated.View style={[a, innerStyle as ViewStyle, disabled && { opacity: 0.5 }]}>{children}</Animated.View>
    </Pressable>
  );
}

/** Gelombang radar (mencari driver). */
export function Radar({ color = colors.primary, size = 120, children }: { color?: string; size?: number; children?: React.ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {!reduce && [0, 1, 2].map((i) => <Ring key={i} delay={i * 700} color={color} size={size} />)}
      <View style={{ width: size * 0.42, height: size * 0.42, borderRadius: size, backgroundColor: color + '22', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: color + '66' }}>{children}</View>
    </View>
  );
}
function Ring({ delay, color, size }: { delay: number; color: string; size: number }) {
  const p = useSharedValue(0);
  useEffect(() => { p.value = withDelay(delay, withRepeat(withTiming(1, { duration: 2100, easing: Easing.out(Easing.quad) }), -1, false)); return () => cancelAnimation(p); }, [delay, p]);
  const a = useAnimatedStyle(() => ({ opacity: interpolate(p.value, [0, 0.7, 1], [0.55, 0.15, 0]), transform: [{ scale: interpolate(p.value, [0, 1], [0.4, 1]) }] }));
  return <Animated.View style={[{ position: 'absolute', width: size, height: size, borderRadius: size, borderWidth: 2, borderColor: color, backgroundColor: color + '14' }, a]} />;
}

/** Titik berdenyut (status live). */
export function LiveDot({ color = colors.success, size = 10 }: { color?: string; size?: number }) {
  const p = useSharedValue(0);
  const reduce = useReducedMotion();
  useEffect(() => { if (!reduce) p.value = withRepeat(withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.sin) }), -1, true); }, [p, reduce]);
  const a = useAnimatedStyle(() => ({ opacity: 0.35 + p.value * 0.65, transform: [{ scale: 1 + p.value * 0.6 }] }));
  return (
    <View style={{ width: size * 2, height: size * 2, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={[{ position: 'absolute', width: size * 2, height: size * 2, borderRadius: size, backgroundColor: color + '33' }, a]} />
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />
    </View>
  );
}

/** Placeholder berkilau saat memuat. Aman: opacity minimum 0.45 walau animasi tidak pernah jalan. */
export function Skeleton({ width = '100%', height = 16, radius = 10, style }: { width?: number | `${number}%`; height?: number; radius?: number; style?: StyleProp<ViewStyle> }) {
  const p = useSharedValue(0);
  const reduce = useReducedMotion();
  useEffect(() => { if (!reduce) p.value = withRepeat(withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.quad) }), -1, true); }, [p, reduce]);
  const a = useAnimatedStyle(() => ({ opacity: 0.45 + p.value * 0.4 }));
  return <Animated.View style={[{ width, height, borderRadius: radius, backgroundColor: 'rgba(11,31,42,0.09)' }, a, style]} />;
}

/** Angka yang berjalan ke nilai baru (dipakai untuk saldo). */
export function AnimatedNumber({ value, format = (n) => String(Math.round(n)), style, duration = 700 }: { value: number; format?: (n: number) => string; style?: StyleProp<TextStyle>; duration?: number }) {
  const reduce = useReducedMotion();
  const [display, setDisplay] = useState(value);
  useEffect(() => {
    if (reduce || Platform.OS !== 'web' && Math.abs(value - display) < 1) { setDisplay(value); return; }
    const from = display, to = value, start = Date.now();
    let raf: number | ReturnType<typeof setTimeout>;
    const tick = () => {
      const k = Math.min(1, (Date.now() - start) / duration);
      const e = 1 - Math.pow(1 - k, 3);
      setDisplay(from + (to - from) * e);
      if (k < 1) raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(tick) : setTimeout(tick, 16);
    };
    tick();
    return () => { if (typeof raf === 'number' && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf); else if (raf) clearTimeout(raf as ReturnType<typeof setTimeout>); };
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return <Text style={style}>{format(display)}</Text>;
}

/** Bar progres status pesanan (0..1) dengan animasi lebar. */
export function ProgressBar({ progress, color = colors.primary, height = 6, track = 'rgba(11,31,42,0.08)' }: { progress: number; color?: string; height?: number; track?: string }) {
  const w = useSharedValue(0);
  const reduce = useReducedMotion();
  useEffect(() => {
    const to = Math.max(0, Math.min(1, progress));
    if (reduce) { cancelAnimation(w); w.value = to; return; }
    w.value = withTiming(to, { duration: motion.slow, easing: motion.easeOut });
    // Jaring pengaman sama seperti Entrance: bar tidak boleh tertinggal di 0 bila animasi gagal.
    const tm = setTimeout(() => { cancelAnimation(w); w.value = to; }, motion.slow + 400);
    return () => clearTimeout(tm);
  }, [progress, w, reduce]);
  const a = useAnimatedStyle(() => ({ width: `${w.value * 100}%` }));
  return (
    <View style={{ height, borderRadius: height, backgroundColor: track, overflow: 'hidden' }}>
      <Animated.View style={[{ height, borderRadius: height, backgroundColor: color }, a]} />
    </View>
  );
}

/** Goyangan kecil untuk menarik perhatian (mis. saldo kurang). */
export function useShake() {
  const x = useSharedValue(0);
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  const shake = () => { x.value = withSequence(withTiming(-8, { duration: 50 }), withTiming(8, { duration: 50 }), withTiming(-6, { duration: 50 }), withTiming(6, { duration: 50 }), withTiming(0, { duration: 50 })); };
  return { style, shake };
}

export const st = StyleSheet.create({});
