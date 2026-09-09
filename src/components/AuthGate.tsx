import React, { useEffect, useState } from 'react';
import { View, Text, Platform } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { useAuth } from '@/store/auth';
import { Loading, Button, IconCircle } from '@/components/ui';
import { colors, font } from '@/lib/theme';
import { APP } from '@/lib/app';

/** Berapa lama menunggu profil sebelum menawarkan jalan keluar. Tanpa ini, satu permintaan jaringan
 *  yang menggantung membuat seluruh aplikasi terkunci di layar "Memuat profil…" tanpa cara keluar. */
const PROFILE_TIMEOUT_MS = 8000;

/** Layar buntu tidak boleh ada: selalu sediakan "Coba lagi" dan "Masuk dengan akun lain". */
function ProfileStuck({ message }: { message?: string | null }) {
  const router = useRouter();
  const loadProfile = useAuth((s) => s.loadProfile);
  const init = useAuth((s) => s.init);
  const signOutLocal = useAuth((s) => s.signOutLocal);
  const [busy, setBusy] = useState(false);

  // "Coba lagi" harus benar-benar memulihkan aplikasi, bukan sekadar memanggil ulang loadProfile().
  // Setelah jaringan sempat putus, klien Supabase bisa tersangkut: permintaan berikutnya TIDAK
  // pernah dikirim lagi walau jaringan sudah pulih (diuji: 0 permintaan baru bahkan 35 detik
  // setelah koneksi kembali), sehingga layar ini jadi buntu. Karena itu: coba muat profil dengan
  // batas waktu; bila tetap gagal, muat ulang aplikasi — sesi tersimpan dibaca ulang dan koneksi
  // dibangun dari nol (terbukti memulihkan aplikasi sampai ke beranda).
  const retry = async () => {
    setBusy(true);
    let ok = false;
    try {
      ok = await Promise.race([
        loadProfile().then(() => !!useAuth.getState().profile).catch(() => false),
        new Promise<boolean>((r) => setTimeout(() => r(false), PROFILE_TIMEOUT_MS)),
      ]);
    } catch { ok = false; }
    if (ok) { setBusy(false); return; }
    if (Platform.OS === 'web' && typeof window !== 'undefined') { window.location.reload(); return; }
    // Android/iOS: tidak ada "reload", jadi bangun ulang sesi & profil dari penyimpanan.
    try { await init(); } catch { /* biarkan layar ini tetap tampil */ }
    setBusy(false);
  };
  const relogin = async () => {
    setBusy(true);
    try { await signOutLocal(); } catch { /* tetap lanjut ke layar masuk */ }
    finally { setBusy(false); router.replace('/(auth)/welcome' as never); }
  };

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 14, backgroundColor: colors.bg }}>
      <IconCircle name="cloud-offline-outline" size={64} bg={colors.tint} color={colors.primary} />
      <Text style={[font.h2, { textAlign: 'center' }]}>Gagal memuat profil</Text>
      <Text style={[font.small, { textAlign: 'center' }]}>
        {message ?? 'Periksa koneksi internet Anda, lalu coba lagi. Bila masih gagal, masuk ulang dengan akun Anda.'}
      </Text>
      <View style={{ alignSelf: 'stretch', gap: 10, marginTop: 6 }}>
        <Button title="Coba lagi" size="lg" icon="refresh-outline" loading={busy} onPress={retry} />
        <Button title="Masuk dengan akun lain" variant="outline" icon="log-in-outline" disabled={busy} onPress={relogin} />
      </View>
    </View>
  );
}

/** Membungkus layout yang butuh login (dan peran tertentu). Tujuan pengalihan disesuaikan dengan aplikasi yang sedang berjalan. */
export function RequireAuth({ children, role }: { children: React.ReactNode; role?: 'admin' | 'driver' | 'merchant' | 'vendor' }) {
  const { session, profile, driver, merchant, marketVendor, ready, profileError } = useAuth();
  const [waitedTooLong, setWaited] = useState(false);

  // Penghitung mulai saat sesi ada tetapi profil belum tiba; direset begitu profil masuk.
  useEffect(() => {
    if (!session || profile) { setWaited(false); return; }
    const id = setTimeout(() => setWaited(true), PROFILE_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [session, profile]);

  if (!ready) return <Loading />;
  if (!session) return <Redirect href="/(auth)/welcome" />;
  if (!profile) {
    if (profileError || waitedTooLong) return <ProfileStuck message={profileError} />;
    return <Loading text="Memuat profil…" />;
  }
  if (role === 'admin' && profile.role !== 'admin') return <Redirect href={(APP === 'admin' ? '/(auth)/login?denied=1' : '/') as never} />;
  if (role === 'driver' && !driver) return <Redirect href={(APP === 'mitra' ? '/mitra/onboarding' : '/') as never} />;
  if (role === 'merchant' && !merchant) return <Redirect href={(APP === 'mitra' ? '/mitra/onboarding' : '/') as never} />;
  if (role === 'vendor' && !marketVendor) return <Redirect href={(APP === 'mitra' ? '/mitra/onboarding' : '/') as never} />;
  return <>{children}</>;
}
