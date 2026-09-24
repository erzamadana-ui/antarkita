import React from 'react';
import { Tabs } from 'expo-router';
import { RequireAuth } from '@/components/AuthGate';
import { makeGlassTabBar } from '@/components/GlassTabBar';
import { colors } from '@/lib/theme';

const TabBar = makeGlassTabBar({
  index: { label: 'Lapak', icon: 'storefront-outline', iconActive: 'storefront' },
  items: { label: 'Barang', icon: 'basket-outline', iconActive: 'basket' },
  earnings: { label: 'Pendapatan', tk: 'earnings', icon: 'wallet-outline', iconActive: 'wallet' },
  account: { label: 'Akun', icon: 'person-outline', iconActive: 'person' },
}, colors.market, { icon: 'add', href: '/(vendor)/items?add=1', accessibilityLabel: 'Tambah barang' });

export default function VendorLayout() {
  return (
    <RequireAuth role="vendor">
      <Tabs tabBar={(p) => <TabBar {...p} />} screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: 'transparent' } }}>
        <Tabs.Screen name="index" options={{ title: 'Lapak' }} />
        <Tabs.Screen name="items" options={{ title: 'Barang' }} />
        <Tabs.Screen name="earnings" options={{ title: 'Pendapatan' }} />
        <Tabs.Screen name="account" options={{ title: 'Akun' }} />
      </Tabs>
    </RequireAuth>
  );
}
