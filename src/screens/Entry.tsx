// Layar awal tiap aplikasi: menentukan ke mana pengguna diarahkan setelah login.
import React, { useState } from 'react';
import { Redirect } from 'expo-router';
import { useAuth } from '@/store/auth';
import { useMode, modeHome } from '@/store/mode';
import { Loading } from '@/components/ui';
import { APP } from '@/lib/app';

export default function Entry() {
  const { session, profile, driver, merchant, travelPartner, marketVendor, ready, recovery, pendingRoute } = useAuth();
  // Tujuan tanpa sesi dikunci saat mount agar tidak berubah (ke welcome) ketika pendingRoute dibersihkan oleh layar tujuan
  const [noSessionTarget] = useState(() => pendingRoute ?? '/(auth)/welcome');
  const mode = useMode((s) => s.mode);
  const persisted = useMode((s) => s.persisted);
  if (!ready) return <Loading />;
  if (!session) return <Redirect href={noSessionTarget as never} />;
  if (recovery) return <Redirect href={'/(auth)/reset' as never} />;
  if (!profile) return <Loading text="Memuat profil…" />;

  if (APP === 'admin') {
    // Aplikasi Admin: hanya akun admin. Akun lain diarahkan ke layar penolakan (di (auth)/login).
    return <Redirect href={(profile.role === 'admin' ? '/(admin)' : '/(auth)/login?denied=1') as never} />;
  }

  if (APP === 'mitra') {
    // Aplikasi Mitra: driver / merchant / mitra travel. Akun tanpa peran mitra → onboarding pilih jenis mitra.
    let target = mode;
    if (target === 'driver' && !driver) target = 'customer';
    if (target === 'merchant' && !merchant) target = 'customer';
    if (target === 'customer' || target === 'admin' || !persisted) {
      if (driver) target = 'driver'; else if (merchant) target = 'merchant'; else if (travelPartner) return <Redirect href={'/driver/travel' as never} />; else if (marketVendor) return <Redirect href={'/(vendor)' as never} />; else return <Redirect href={'/mitra/onboarding' as never} />;
    }
    return <Redirect href={modeHome[target] as never} />;
  }

  // Aplikasi Pelanggan: semua akun (termasuk admin/driver) memakai mode pelanggan.
  return <Redirect href="/(customer)" />;
}
