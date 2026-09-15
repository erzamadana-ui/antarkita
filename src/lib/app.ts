import { Linking } from 'react-native';
import Constants from 'expo-constants';
// Identitas aplikasi yang sedang dibangun. Satu basis kode → 3 aplikasi berbeda:
//   pelanggan (AntarKita), mitra (AntarKita Mitra), admin (AntarKita Admin)
// Dipilih lewat env APP saat build (lihat app.config.ts) dan dibaca di runtime via EXPO_PUBLIC_APP.
export type AppKind = 'pelanggan' | 'mitra' | 'admin';

// Cadangan bila EXPO_PUBLIC_APP tidak ter-inline saat bundling native: baca extra.app dari app config hasil prebuild.
const fromExtra = (Constants.expoConfig?.extra as { app?: AppKind } | undefined)?.app;
export const APP: AppKind = ((process.env.EXPO_PUBLIC_APP as AppKind) || fromExtra || 'pelanggan');
export const IS_CUSTOMER_APP = APP === 'pelanggan';
export const IS_PARTNER_APP = APP === 'mitra';
export const IS_ADMIN_APP = APP === 'admin';

export const BRAND = 'AntarKita';
export const APP_NAME: Record<AppKind, string> = { pelanggan: 'AntarKita', mitra: 'AntarKita Mitra', admin: 'AntarKita Admin' };
export const APP_TAGLINE = 'Antar apa saja, bersama kita';

/** Alamat web tiap aplikasi (dipakai untuk tautan silang: "Buka aplikasi Mitra", dll.).
 *  Domain resmi: https://apps.antarkitaindonesia.com (GitHub Pages, domain kustom). URL lama
 *  https://erzamadana-ui.github.io/antarkita/ tetap dialihkan GitHub ke domain ini. */
export const SITE_ROOT = (process.env.EXPO_PUBLIC_SITE_ROOT || 'https://apps.antarkitaindonesia.com').replace(/\/$/, '');
const SITE = SITE_ROOT;
export const APP_URL: Record<AppKind, string> = { pelanggan: `${SITE}/`, mitra: `${SITE}/mitra/`, admin: `${SITE}/admin/` };
export const APK_URL = process.env.EXPO_PUBLIC_APK_URL || 'https://github.com/erzamadana-ui/antarkita/releases/latest';

/** Buka aplikasi lain (web) — dipakai untuk tautan silang antar 3 aplikasi. */
export async function openApp(kind: AppKind) {
  await Linking.openURL(APP_URL[kind]);
}
