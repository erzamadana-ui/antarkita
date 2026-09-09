// Layar awal tiap aplikasi: menentukan ke mana pengguna diarahkan setelah login.
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { useAuth } from '@/store/auth';
import { useMode, modeHome } from '@/store/mode';
import { Loading, Button, Empty } from '@/components/ui';
import { colors } from '@/lib/theme';
import { APP } from '@/lib/app';

/** Batas waktu memuat profil sebelum pengguna diberi jalan keluar (lihat PROFILE_TIMEOUT_MS). */
const PROFILE_TIMEOUT_MS = 8000;

export default function Entry() {
  const { session, profile, driver, merchant, travelPartner, marketVendor, ready, recovery, pendingRoute } = useAuth();
  const router = useRouter();
  const loadProfile = useAuth((s) => s.loadProfile);
  const signOut = useAuth((s) => s.signOut);
  // Profil gagal dimuat (tanpa internet / sesi kedaluwarsa) dulu membuat layar ini
  // menggantung selamanya di "Memuat profil…" tanpa jalan keluar. Sekarang setelah
  // PROFILE_TIMEOUT_MS pengguna diberi tombol "Coba lagi" dan "Masuk dengan akun lain".
  const [stalled, setStalled] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const waiting = ready && !!session && !profile && !recovery;
  useEffect(() => {
    if (!waiting) { setStalled(false); return; }
    const t = setTimeout(() => setStalled(true), PROFILE_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [waiting]);
  // Tujuan tanpa sesi dikunci saat mount agar tidak berubah (ke welcome) ketika pendingRoute dibersihkan oleh layar tujuan
  const [noSessionTarget] = useState(() => pendingRoute ?? '/(auth)/welcome');
  const mode = useMode((s) => s.mode);
  const persisted = useMode((s) => s.persisted);
  if (!ready) return <Loading />;
  if (!session) return <Redirect href={noSessionTarget as never} />;
  if (recovery) return <Redirect href={'/(auth)/reset' as never} />;
  if (!profile) {
    if (!stalled) return <Loading text="Memuat profil…" />;
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center' }}>
        <Empty
          icon="cloud-offline-outline"
          title="Gagal memuat profil"
          subtitle="Periksa koneksi internet Anda, lalu coba lagi. Bila tetap gagal, masuk kembali dengan akun Anda."
          action={(
            <View style={{ gap: 10, alignSelf: 'stretch', paddingHorizontal: 24 }}>
              <Button title="Coba lagi" icon="refresh" loading={retrying} onPress={async () => { setRetrying(true); setStalled(false); try { await loadProfile(); } finally { setRetrying(false); } }} />
              <Button title="Masuk dengan akun lain" variant="outline" icon="log-out-outline" onPress={async () => { await signOut(); router.replace('/(auth)/login' as never); }} />
            </View>
          )}
        />
      </View>
    );
  }

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
