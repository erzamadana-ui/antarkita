import React from 'react';
import { Redirect, Stack, useGlobalSearchParams } from 'expo-router';
import { useAuth } from '@/store/auth';
import { APP } from '@/lib/app';

export default function AuthLayout() {
  const session = useAuth((s) => s.session);
  const profile = useAuth((s) => s.profile);
  const recovery = useAuth((s) => s.recovery);
  const { denied } = useGlobalSearchParams<{ denied?: string }>();
  // Aplikasi Admin: akun non-admin tetap di layar login (pesan 'bukan admin') agar tidak berputar ke Entry
  const stay = APP === 'admin' && (denied || (profile && profile.role !== 'admin'));
  if (session && !stay && !recovery) return <Redirect href="/" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
