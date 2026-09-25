import React from 'react';
import { Tabs } from 'expo-router';
import { RequireAuth } from '@/components/AuthGate';
import { makeGlassTabBar } from '@/components/GlassTabBar';
import { colors } from '@/lib/theme';
import { WALLET_UI } from '@/lib/features';

const TabBar = makeGlassTabBar({
  index: { label: 'Beranda', tk: 'home', icon: 'home-outline', iconActive: 'home' },
  orders: { label: 'Pesanan', tk: 'orders', icon: 'receipt-outline', iconActive: 'receipt' },
  pay: { label: WALLET_UI ? 'Voucher' : 'Bayar', icon: 'card-outline', iconActive: 'card' },
  account: { label: 'Akun', tk: 'account', icon: 'person-outline', iconActive: 'person' },
}, colors.primary, { icon: 'paper-plane', href: '/ride?service=ride_motor', accessibilityLabel: 'Pesan AntarRide' });

export default function CustomerLayout() {
  return (
    <RequireAuth>
      <Tabs tabBar={(p) => <TabBar {...p} />} screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: 'transparent' } }}>
        <Tabs.Screen name="index" options={{ title: 'Beranda' }} />
        <Tabs.Screen name="orders" options={{ title: 'Pesanan' }} />
        <Tabs.Screen name="pay" options={{ title: WALLET_UI ? 'AntarVoucher' : 'Pembayaran' }} />
        <Tabs.Screen name="account" options={{ title: 'Akun' }} />
      </Tabs>
    </RequireAuth>
  );
}
