// Tab bar gaya kit: pil putih berisi ikon bulat (aktif = lingkaran tint teal) + tombol aksi bulat teal terpisah di kanan (FAB)
import React, { useEffect } from 'react';
import { View, Text, Pressable, StyleSheet, Platform, useWindowDimensions } from 'react-native';
import type { BottomTabBarProps } from 'expo-router/build/react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, useReducedMotion } from 'react-native-reanimated';
import { colors, motion, radius, shadow } from '@/lib/theme';
import { useI18n, translate, isRTL, type TKey } from '@/lib/i18n';

type IconName = React.ComponentProps<typeof Ionicons>['name'];
export type TabSpec = Record<string, { label: string; icon: IconName; iconActive: IconName; tk?: TKey }>;
export type TabFab = { icon: IconName; href?: string; onPress?: () => void; color?: string; accessibilityLabel?: string };

/** Tinggi ruang yang perlu disisakan konten di bawah (pil 64 + margin). */
export const TAB_BAR_SPACE = 96;

export function makeGlassTabBar(spec: TabSpec, accent = colors.primary, fab?: TabFab) {
  return function GlassTabBar({ state, navigation }: BottomTabBarProps) {
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const { width } = useWindowDimensions();
    const reduce = useReducedMotion();
    const locale = useI18n((st) => st.locale);
    const routes = state.routes.filter((r) => spec[r.name]);
    const fabW = fab ? 64 + 12 : 0;
    const barWidth = Math.min(width - 32 - fabW, 440);
    const tabW = (barWidth - 12) / routes.length;
    const activeIdx = Math.max(0, routes.findIndex((r) => r.key === state.routes[state.index].key));
    const visualIdx = isRTL(locale) ? routes.length - 1 - activeIdx : activeIdx;
    const x = useSharedValue(visualIdx * tabW);
    useEffect(() => { x.value = reduce ? visualIdx * tabW : withSpring(visualIdx * tabW, motion.spring); }, [visualIdx, tabW, reduce, x]);
    const pill = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
    return (
      <View pointerEvents="box-none" style={[s.wrap, { paddingBottom: Math.max(insets.bottom, 14) }]}>
        <View style={s.row}>
          <View style={[s.bar, { width: barWidth }]}>
            <Animated.View style={[s.pill, { width: tabW }, pill]}>
              <View style={[s.pillCircle, { backgroundColor: accent + '1F' }]} />
            </Animated.View>
            {routes.map((r) => {
              const focused = state.routes[state.index].key === r.key;
              const sp = spec[r.name];
              return (
                <Pressable key={r.key} accessibilityRole="button" accessibilityLabel={sp.tk ? translate(locale, sp.tk) : sp.label} accessibilityState={focused ? { selected: true } : {}}
                  onPress={() => { if (Platform.OS !== 'web') Haptics.selectionAsync().catch(() => {}); const e = navigation.emit({ type: 'tabPress', target: r.key, canPreventDefault: true }); if (!focused && !e.defaultPrevented) navigation.navigate(r.name); }}
                  style={[s.tab, { width: tabW }]}>
                  <Ionicons name={focused ? sp.iconActive : sp.icon} size={22} color={focused ? accent : colors.textMuted} />
                  {(() => {
                    const text = sp.tk ? translate(locale, sp.tk) : sp.label;
                    // Ukuran huruf mengikuti lebar tab & panjang label supaya label panjang ("Pendapatan") tidak terpotong
                    const fs = Math.max(9, Math.min(12, Math.floor((tabW - 8) / (text.length * 0.56))));
                    return <Text style={[s.label, { fontSize: fs, color: focused ? accent : colors.textMuted }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{text}</Text>;
                  })()}
                </Pressable>
              );
            })}
          </View>
          {fab && (
            <Pressable accessibilityRole="button" accessibilityLabel={fab.accessibilityLabel ?? 'Aksi cepat'}
              onPress={() => { if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); if (fab.onPress) fab.onPress(); else if (fab.href) router.push(fab.href as never); }}
              style={[s.fab, { backgroundColor: fab.color ?? accent }, shadow.glow(fab.color ?? accent)]}>
              <Ionicons name={fab.icon} size={26} color="#fff" />
            </Pressable>
          )}
        </View>
      </View>
    );
  };
}

const s = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center', paddingHorizontal: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  bar: { flexDirection: 'row', padding: 6, height: 64, borderRadius: radius.full, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: colors.border, overflow: 'hidden', ...shadow.card },
  pill: { position: 'absolute', top: 6, bottom: 6, left: 6, alignItems: 'center', justifyContent: 'center' },
  pillCircle: { width: 52, height: 52, borderRadius: 26 },
  tab: { alignItems: 'center', justifyContent: 'center', gap: 1, paddingHorizontal: 3, overflow: 'hidden' },
  label: { fontSize: 12, fontWeight: '700', maxWidth: '100%' },
  fab: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
});
