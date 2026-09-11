// Kerangka Panel Admin — sidebar berkelompok (gaya dashboard SaaS), latar abu muda, konten putih.
import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, useWindowDimensions } from 'react-native';
import { Slot, usePathname, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { FadeIn, useReducedMotion } from 'react-native-reanimated';
import { RequireAuth } from '@/components/AuthGate';
import { AdminUnlockGate } from '@/components/AdminUnlockGate';
import { PressableScale } from '@/components/motion';
import { BrandLogo } from '@/components/Logo';
import { useAuth } from '@/store/auth';
import { adminFont, adminTone, adminRadius, adminShadow, adminIcon, AdminCallBar } from '@/components/admin';
import { colors, fam, motion } from '@/lib/theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];
type NavItem = { href: string; label: string; icon: IconName; iconActive: IconName };
type NavGroup = { title: string; items: NavItem[] };

/** Struktur menu panel admin — dikelompokkan agar mudah dipindai. */
export const NAV_GROUPS: NavGroup[] = [
  {
    title: 'Ringkasan',
    items: [
      { href: '/(admin)', label: 'Dashboard', icon: 'grid-outline', iconActive: 'grid' },
      { href: '/exec', label: 'Portal Eksekutif', icon: 'shield-half-outline', iconActive: 'shield-half' },
    ],
  },
  {
    title: 'Operasional',
    items: [
      { href: '/(admin)/orders', label: 'Pesanan', icon: 'receipt-outline', iconActive: 'receipt' },
      { href: '/(admin)/drivers', label: 'Driver', icon: 'bicycle-outline', iconActive: 'bicycle' },
      { href: '/(admin)/travel', label: 'Mitra Travel', icon: 'bus-outline', iconActive: 'bus' },
      { href: '/(admin)/merchants', label: 'Merchant', icon: 'restaurant-outline', iconActive: 'restaurant' },
      { href: '/(admin)/vendors', label: 'Mitra Pasar', icon: 'leaf-outline', iconActive: 'leaf' },
      { href: '/(admin)/logistics', label: 'Logistik & Travel', icon: 'navigate-outline', iconActive: 'navigate' },
      { href: '/(admin)/kota', label: 'Kota & Wilayah', icon: 'globe-outline', iconActive: 'globe' },
    ],
  },
  {
    title: 'Katalog & Harga',
    items: [
      { href: '/(admin)/shop', label: 'AntarShop · Toko', icon: 'basket-outline', iconActive: 'basket' },
      { href: '/(admin)/market', label: 'AntarMarket · Pasar', icon: 'storefront-outline', iconActive: 'storefront' },
      { href: '/(admin)/places', label: 'Data Tempat', icon: 'map-outline', iconActive: 'map' },
      { href: '/(admin)/data-tempat', label: 'Impor Peta (OSM)', icon: 'cloud-download-outline', iconActive: 'cloud-download' },
      { href: '/(admin)/pricing', label: 'Tarif & Promo', icon: 'pricetags-outline', iconActive: 'pricetags' },
      { href: '/(admin)/pricing-intel', label: 'Intelijen Harga', icon: 'trending-up-outline', iconActive: 'trending-up' },
      { href: '/(admin)/blast', label: 'Blast Promo', icon: 'megaphone-outline', iconActive: 'megaphone' },
    ],
  },
  {
    title: 'Keuangan',
    items: [
      { href: '/(admin)/finance', label: 'Keuangan', icon: 'cash-outline', iconActive: 'cash' },
      { href: '/(admin)/finance-report', label: 'Laporan Keuangan', icon: 'document-text-outline', iconActive: 'document-text' },
      { href: '/(admin)/gateway', label: 'Payment Gateway', icon: 'card-outline', iconActive: 'card' },
    ],
  },
  {
    title: 'Pengguna & Dukungan',
    items: [
      { href: '/(admin)/users', label: 'Pengguna', icon: 'people-outline', iconActive: 'people' },
      { href: '/(admin)/cs', label: 'CS & Tiket', icon: 'chatbubbles-outline', iconActive: 'chatbubbles' },
      { href: '/(admin)/reports', label: 'Laporan Pengguna', icon: 'flag-outline', iconActive: 'flag' },
    ],
  },
  {
    title: 'Sistem',
    items: [
      { href: '/(admin)/automation', label: 'Otomasi', icon: 'flash-outline', iconActive: 'flash' },
      { href: '/(admin)/security', label: 'Pusat Keamanan', icon: 'shield-checkmark-outline', iconActive: 'shield-checkmark' },
      { href: '/(admin)/activity', label: 'Log Aktivitas', icon: 'time-outline', iconActive: 'time' },
      { href: '/(admin)/map', label: 'Peta', icon: 'globe-outline', iconActive: 'globe' },
      { href: '/(admin)/settings', label: 'Pengaturan', icon: 'settings-outline', iconActive: 'settings' },
    ],
  },
];
const NAV_FLAT = NAV_GROUPS.flatMap((g) => g.items);

export default function AdminLayout() {
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  const pathname = usePathname();
  const router = useRouter();
  const { profile, signOut } = useAuth();
  const reduce = useReducedMotion();
  const isActive = (href: string) => {
    const p = href.replace('/(admin)', '') || '/';
    return pathname === p || (p !== '/' && pathname.startsWith(p + '/'));
  };
  const go = (href: string) => (href === '/exec' ? router.push('/exec' as never) : router.replace(href as never));

  return (
    <RequireAuth role="admin">
      <View style={{ flex: 1, backgroundColor: adminTone.bg }}>
        <SafeAreaView style={{ flex: 1 }} edges={['top']}>
          <View style={{ flex: 1, flexDirection: wide ? 'row' : 'column' }}>
            {wide ? (
              <View style={s.sidebar}>
                <View style={s.brand}>
                  <BrandLogo size={32} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={adminFont.h2} numberOfLines={1}>AntarKita</Text>
                    <Text style={adminFont.tiny} numberOfLines={1}>Panel Admin</Text>
                  </View>
                </View>
                <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 10, paddingBottom: 12, gap: 2 }} showsVerticalScrollIndicator={false}>
                  {NAV_GROUPS.map((g) => (
                    <View key={g.title} style={{ marginTop: 12 }}>
                      <Text style={[adminFont.label, s.groupTitle]}>{g.title}</Text>
                      {g.items.map((n) => {
                        const active = isActive(n.href);
                        return (
                          <Pressable key={n.href} onPress={() => go(n.href)} style={(st) => [s.item, !active && (st as { hovered?: boolean }).hovered && { backgroundColor: adminTone.surfaceAlt }, active && s.itemOn]}>
                            {active ? <View style={s.marker} /> : null}
                            <Ionicons name={active ? n.iconActive : n.icon} size={adminIcon.md} color={active ? colors.primary : adminTone.muted} />
                            <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, ...fam(active ? 700 : 500), color: active ? colors.primaryDark : adminTone.ink2 }}>{n.label}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  ))}
                </ScrollView>
                <View style={s.foot}>
                  <Text style={{ color: adminTone.ink, fontSize: 12.5, ...fam(700) }} numberOfLines={1}>{profile?.full_name ?? 'Admin'}</Text>
                  <PressableScale haptic={false} onPress={async () => { await signOut(); router.replace('/(auth)/welcome'); }} style={s.footBtn}>
                    <Ionicons name="log-out-outline" size={adminIcon.md} color={colors.danger} />
                    <Text style={{ color: colors.danger, fontSize: 12.5, ...fam(700) }}>Keluar</Text>
                  </PressableScale>
                </View>
              </View>
            ) : (
              <View style={s.topbar}>
                <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 10, gap: 10 }}>
                  <BrandLogo size={26} />
                  <Text style={[adminFont.h1, { flex: 1 }]}>Panel Admin</Text>
                  <PressableScale onPress={async () => { await signOut(); router.replace('/(auth)/welcome'); }} scaleTo={0.9} style={s.iconBtn}>
                    <Ionicons name="log-out-outline" size={adminIcon.lg} color={colors.danger} />
                  </PressableScale>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, padding: 10 }}>
                  {NAV_FLAT.map((n) => {
                    const active = isActive(n.href);
                    return (
                      <PressableScale key={n.href} haptic={false} scaleTo={0.95} onPress={() => go(n.href)} style={[s.chip, active && s.chipOn]}>
                        <Ionicons name={active ? n.iconActive : n.icon} size={adminIcon.md} color={active ? '#fff' : adminTone.muted} />
                        <Text style={{ color: active ? '#fff' : adminTone.ink2, fontSize: 12.5, ...fam(700) }}>{n.label}</Text>
                      </PressableScale>
                    );
                  })}
                </ScrollView>
              </View>
            )}
            <View style={{ flex: 1, minWidth: 0 }}>
              <AdminUnlockGate>
                <Animated.View key={pathname} entering={reduce ? undefined : FadeIn.duration(motion.base)} style={{ flex: 1 }}>
                  <Slot />
                </Animated.View>
              </AdminUnlockGate>
            </View>
          </View>
          <AdminCallBar />
        </SafeAreaView>
      </View>
    </RequireAuth>
  );
}

const s = StyleSheet.create({
  sidebar: { width: 244, backgroundColor: adminTone.surface, borderRightWidth: 1, borderRightColor: adminTone.border, ...adminShadow.card },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: adminTone.border },
  groupTitle: { paddingHorizontal: 10, paddingBottom: 6, color: adminTone.faint },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10, height: 36, borderRadius: adminRadius.md, marginBottom: 1 },
  itemOn: { backgroundColor: colors.primary + '12' },
  marker: { position: 'absolute', left: 0, top: 8, bottom: 8, width: 3, borderRadius: 2, backgroundColor: colors.primary },
  foot: { paddingHorizontal: 16, paddingVertical: 12, gap: 4, borderTopWidth: 1, borderTopColor: adminTone.border },
  footBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
  topbar: { backgroundColor: adminTone.surface, borderBottomWidth: 1, borderBottomColor: adminTone.border },
  iconBtn: { width: 34, height: 34, borderRadius: 10, backgroundColor: adminTone.surfaceAlt, borderWidth: 1, borderColor: adminTone.border, alignItems: 'center', justifyContent: 'center' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 11, paddingVertical: 7, borderRadius: 999, backgroundColor: adminTone.surface, borderWidth: 1, borderColor: adminTone.border },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
});
