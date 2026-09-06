import React, { useEffect } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, useWindowDimensions, Platform } from 'react-native';
import { Slot, usePathname, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import Animated, { FadeIn, useSharedValue, useAnimatedStyle, withSpring, useReducedMotion } from 'react-native-reanimated';
import { RequireAuth } from '@/components/AuthGate';
import { AdminUnlockGate } from '@/components/AdminUnlockGate';
import { AmbientBackground, BrandGradient } from '@/components/glass';
import { PressableScale } from '@/components/motion';
import { BrandLogo } from '@/components/Logo';
import { useAuth } from '@/store/auth';
import { useMode } from '@/store/mode';
import { colors, font, glass, motion, radius, shadow } from '@/lib/theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];
const NAV: { href: string; label: string; icon: IconName; iconActive: IconName }[] = [
  { href: '/(admin)', label: 'Dashboard', icon: 'grid-outline', iconActive: 'grid' },
  { href: '/(admin)/orders', label: 'Pesanan', icon: 'receipt-outline', iconActive: 'receipt' },
  { href: '/(admin)/drivers', label: 'Driver', icon: 'bicycle-outline', iconActive: 'bicycle' },
  { href: '/(admin)/travel', label: 'Mitra Travel', icon: 'bus-outline', iconActive: 'bus' },
  { href: '/(admin)/merchants', label: 'Merchant', icon: 'storefront-outline', iconActive: 'storefront' },
  { href: '/(admin)/users', label: 'Pengguna', icon: 'people-outline', iconActive: 'people' },
  { href: '/(admin)/finance', label: 'Keuangan', icon: 'cash-outline', iconActive: 'cash' },
  { href: '/(admin)/pricing', label: 'Tarif & Promo', icon: 'pricetags-outline', iconActive: 'pricetags' },
  { href: '/(admin)/pricing-intel', label: 'Intelijen Harga', icon: 'trending-up-outline', iconActive: 'trending-up' },
  { href: '/(admin)/blast', label: 'Blast Promo', icon: 'megaphone-outline', iconActive: 'megaphone' },
  { href: '/(admin)/logistics', label: 'Logistik & Travel', icon: 'map-outline', iconActive: 'map' },
  { href: '/(admin)/shop', label: 'AntarShop · Toko', icon: 'basket-outline', iconActive: 'basket' },
  { href: '/(admin)/market', label: 'AntarMarket · Pasar', icon: 'storefront-outline', iconActive: 'storefront' },
  { href: '/(admin)/places', label: 'Data Tempat', icon: 'map-outline', iconActive: 'map' },
  { href: '/(admin)/vendors', label: 'Mitra Pasar', icon: 'basket-outline', iconActive: 'basket' },
  { href: '/(admin)/gateway', label: 'Payment Gateway', icon: 'card-outline', iconActive: 'card' },
  { href: '/(admin)/automation', label: 'Otomasi', icon: 'flash-outline', iconActive: 'flash' },
  { href: '/(admin)/security', label: 'Pusat Keamanan', icon: 'shield-checkmark-outline', iconActive: 'shield-checkmark' },
  { href: '/(admin)/cs', label: 'CS & Tiket', icon: 'chatbubbles-outline', iconActive: 'chatbubbles' },
  { href: '/(admin)/activity', label: 'Log Aktivitas', icon: 'time-outline', iconActive: 'time' },
  { href: '/(admin)/settings', label: 'Pengaturan', icon: 'settings-outline', iconActive: 'settings' },
  { href: '/exec', label: 'Portal Eksekutif', icon: 'shield-half-outline', iconActive: 'shield-half' },
];
const ITEM_H = 44;

export default function AdminLayout() {
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  const pathname = usePathname();
  const router = useRouter();
  const { profile, signOut } = useAuth();
  const setMode = useMode((s) => s.setMode);
  const reduce = useReducedMotion();
  const isActive = (href: string) => { const p = href.replace('/(admin)', '') || '/'; return pathname === p || (p !== '/' && pathname.startsWith(p + '/')); };
  const activeIdx = Math.max(0, NAV.findIndex((n) => isActive(n.href)));
  const y = useSharedValue(activeIdx * (ITEM_H + 4));
  useEffect(() => { y.value = reduce ? activeIdx * (ITEM_H + 4) : withSpring(activeIdx * (ITEM_H + 4), motion.spring); }, [activeIdx, reduce, y]);
  const indicator = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));

  return (
    <RequireAuth role="admin">
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <AmbientBackground tint="teal" />
        <SafeAreaView style={{ flex: 1 }} edges={['top']}>
          <View style={{ flex: 1, flexDirection: wide ? 'row' : 'column' }}>
            {wide ? (
              <View style={s.sidebarWrap}>
                <View style={[s.sidebar, shadow.card]}>
                  {Platform.OS !== 'android' && <BlurView intensity={glass.blurStrong} tint="light" style={StyleSheet.absoluteFill} />}
                  <View style={s.brand}>
                    <BrandLogo size={36} />
                    <View><Text style={{ color: colors.text, fontSize: 17, fontWeight: '800' }}>AntarKita</Text><Text style={font.tiny}>Panel Admin</Text></View>
                  </View>
                  <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 10, gap: 4, paddingBottom: 8 }} showsVerticalScrollIndicator={false}>
                    <Animated.View style={[s.indicator, indicator]} />
                    {NAV.map((n) => {
                      const active = isActive(n.href);
                      return (
                        <Pressable key={n.href} onPress={() => (n.href === '/exec' ? router.push('/exec' as never) : router.replace(n.href as never))} style={(st) => [s.side, !active && (st as { hovered?: boolean }).hovered && { backgroundColor: 'rgba(11,31,42,0.04)' }]}>
                          <Ionicons name={active ? n.iconActive : n.icon} size={18} color={active ? colors.primary : colors.textSecondary} />
                          <Text style={{ color: active ? colors.primary : colors.textSecondary, fontWeight: active ? '800' : '600', fontSize: 14 }}>{n.label}</Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                  <View style={s.footer}>
                    <Text style={{ color: colors.text, fontWeight: '700' }} numberOfLines={1}>{profile?.full_name}</Text>
                    <PressableScale haptic={false} onPress={async () => { await signOut(); router.replace('/(auth)/welcome'); }} style={s.footBtn}><Ionicons name="log-out-outline" size={16} color={colors.danger} /><Text style={{ color: colors.danger, fontWeight: '700', fontSize: 13 }}>Keluar</Text></PressableScale>
                  </View>
                </View>
              </View>
            ) : (
              <View style={s.topbar}>
                {Platform.OS !== 'android' && <BlurView intensity={glass.blur} tint="light" style={StyleSheet.absoluteFill} />}
                <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 8, gap: 10 }}>
                  <BrandLogo size={28} />
                  <Text style={[font.h3, { flex: 1 }]}>Panel Admin</Text>
                  <PressableScale onPress={async () => { await signOut(); router.replace('/(auth)/welcome'); }} scaleTo={0.9} style={s.iconBtn}><Ionicons name="log-out-outline" size={20} color={colors.danger} /></PressableScale>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, padding: 10 }}>
                  {NAV.map((n) => {
                    const active = isActive(n.href);
                    return (
                      <PressableScale key={n.href} haptic={false} scaleTo={0.94} onPress={() => (n.href === '/exec' ? router.push('/exec' as never) : router.replace(n.href as never))} style={[s.chip, active && s.chipActive]}>
                        <Ionicons name={active ? n.iconActive : n.icon} size={16} color={active ? '#fff' : colors.textSecondary} />
                        <Text style={{ color: active ? '#fff' : colors.textSecondary, fontWeight: '700', fontSize: 13 }}>{n.label}</Text>
                      </PressableScale>
                    );
                  })}
                </ScrollView>
              </View>
            )}
            {/* Transisi halaman: fade + geser naik halus setiap pindah rute */}
            <AdminUnlockGate>
              <Animated.View key={pathname} entering={reduce ? undefined : FadeIn.duration(motion.base)} style={{ flex: 1 }}>
                <Slot />
              </Animated.View>
            </AdminUnlockGate>
          </View>
        </SafeAreaView>
      </View>
    </RequireAuth>
  );
}

const s = StyleSheet.create({
  sidebarWrap: { width: 250, padding: 12, paddingRight: 0 },
  sidebar: { flex: 1, borderRadius: radius.xl, backgroundColor: Platform.OS === 'android' ? 'rgba(255,255,255,0.96)' : 'rgba(255,255,255,0.92)', borderWidth: 1, borderColor: glass.border, overflow: 'hidden', paddingBottom: 8 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 18 },
  logo: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  logoSm: { width: 28, height: 28, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  indicator: { position: 'absolute', left: 10, right: 10, top: 0, height: ITEM_H, borderRadius: radius.md, backgroundColor: colors.primary + '1A', borderWidth: 1, borderColor: colors.primary + '33' },
  side: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, height: ITEM_H, borderRadius: radius.md },
  footer: { padding: 14, gap: 6, borderTopWidth: 1, borderTopColor: glass.border, marginTop: 8 },
  footBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  topbar: { backgroundColor: Platform.OS === 'android' ? 'rgba(255,255,255,0.96)' : 'rgba(255,255,255,0.92)', borderBottomWidth: 1, borderBottomColor: glass.border, overflow: 'hidden' },
  iconBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primary + '14', alignItems: 'center', justifyContent: 'center' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.92)', borderWidth: 1, borderColor: glass.border },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary, ...shadow.glow(colors.primary) },
});
