// Tautan unduh APK Android — HANYA tampil di web (Platform.OS === 'web') pada app Pelanggan & Mitra.
// Keputusan GM 27 Okt 2026: APK didistribusikan langsung lewat GitHub Release (bukan Play Store dulu).
// URL dari EXPO_PUBLIC_APK_URL → APK_URL (src/lib/app.ts); satu tautan yang sama untuk kedua app
// (halaman rilis memuat berkas pelanggan & mitra), tetapi labelnya dibedakan agar mitra tidak salah unduh.
import React from 'react';
import { View, Text, Linking, Platform, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { PressableScale } from '@/components/motion';
import { colors, font, radius } from '@/lib/theme';
import { APK_URL, APP } from '@/lib/app';

export const APK_LABEL = APP === 'mitra' ? 'Unduh aplikasi Android (APK Mitra)' : 'Unduh aplikasi Android (APK)';
export const APK_FILE_HINT = APP === 'mitra' ? 'Pilih berkas antarkita-mitra-*.apk' : 'Pilih berkas antarkita-pelanggan-*.apk';

/** Benar hanya bila tautan APK perlu ditampilkan: web + bukan app Admin. */
export const SHOW_APK_LINK = Platform.OS === 'web' && APP !== 'admin';

export function openApk() {
  return Linking.openURL(APK_URL).catch(() => { /* popup diblokir: pengguna bisa klik ulang */ });
}

/** Banner kartu (welcome/login/akun): ikon Android, judul, petunjuk berkas, tombol buka. `compact` = satu baris tanpa petunjuk. */
export function ApkBanner({ compact, style }: { compact?: boolean; style?: object }) {
  if (!SHOW_APK_LINK) return null;
  return (
    <PressableScale onPress={openApk} scaleTo={0.985} haptic={false} accessibilityRole="link" accessibilityLabel={APK_LABEL} style={[s.box, compact && s.boxCompact, style]} testID="apk-banner">
      <View style={s.icon}><Ionicons name="logo-android" size={22} color="#fff" /></View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={[font.body, { fontWeight: '700', color: colors.text }]} numberOfLines={2}>{APK_LABEL}</Text>
        {!compact ? <Text style={font.tiny} numberOfLines={2}>Versi HP lebih lengkap: notifikasi, lokasi, dan panggilan. {APK_FILE_HINT}, lalu izinkan instal dari sumber tidak dikenal.</Text> : null}
      </View>
      <Ionicons name="download-outline" size={20} color={colors.primary} />
    </PressableScale>
  );
}

const s = StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: radius.lg, backgroundColor: '#fff', borderWidth: 1.5, borderColor: colors.primary + '55' },
  boxCompact: { padding: 10, borderRadius: radius.md },
  icon: { width: 40, height: 40, borderRadius: 14, backgroundColor: '#3DDC84', alignItems: 'center', justifyContent: 'center' },
});
