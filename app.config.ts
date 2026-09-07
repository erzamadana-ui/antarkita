import type { ExpoConfig } from 'expo/config';
import pkg from './package.json';

// Satu basis kode → 3 aplikasi berbeda. Pilih lewat env APP=pelanggan|mitra|admin (default: pelanggan).
//   APP=mitra npx expo export --platform web   → web aplikasi Mitra
//   APP=mitra npx expo prebuild -p android     → proyek Android aplikasi Mitra
// Rute tiap aplikasi ada di apps/<app>/app, layar bersama di src/screens, komponen di src/.
type AppKind = 'pelanggan' | 'mitra' | 'admin';
const APP = ((process.env.APP || process.env.EXPO_PUBLIC_APP || 'pelanggan') as AppKind);
process.env.EXPO_PUBLIC_APP = APP;

// Base URL untuk hosting web di sub-path (GitHub Pages: https://<user>.github.io/antarkita/[mitra|admin])
const baseUrl = process.env.EXPO_PUBLIC_BASE_URL ?? '';

const META: Record<AppKind, { name: string; slug: string; scheme: string; id: string; bg: string; desc: string }> = {
  pelanggan: { name: 'AntarKita', slug: 'antarkita', scheme: 'antarkita', id: 'id.antarkita.app', bg: '#0E9488', desc: 'AntarKita — ojek, mobil, makanan, belanja, kirim barang, dan travel antar kota dalam satu aplikasi.' },
  mitra: { name: 'AntarKita Mitra', slug: 'antarkita-mitra', scheme: 'antarkitamitra', id: 'id.antarkita.mitra', bg: '#0F2A28', desc: 'AntarKita Mitra — aplikasi driver, merchant, mitra travel, dan mobil box.' },
  admin: { name: 'AntarKita Admin', slug: 'antarkita-admin', scheme: 'antarkitaadmin', id: 'id.antarkita.admin', bg: '#1F3A38', desc: 'AntarKita Admin — panel operasional, CS, keuangan, dan portal eksekutif.' },
};
const m = META[APP];
const assets = `./apps/${APP}/assets`;

// ------------------------------------------------------------------ Firebase (push notification)
// google-services.json TIDAK PERNAH masuk repositori (berisi kunci proyek Firebase). Yang dibaca di
// sini hanya PATH-nya lewat variabel lingkungan GOOGLE_SERVICES_JSON:
//   • CI/EAS  → simpan sebagai secret BERKAS bernama GOOGLE_SERVICES_JSON; EAS menulisnya ke disk
//               lalu mengisi variabel lingkungan dengan path berkas itu (tidak perlu diubah di sini).
//   • Lokal   → salin berkas dari Firebase Console, lalu isi di .env:
//                 GOOGLE_SERVICES_JSON=./google-services.json      (sudah masuk .gitignore)
// Bila variabel kosong, konfigurasi TIDAK menyertakan googleServicesFile sehingga
// `expo prebuild` & gradle tetap jalan — aplikasi hanya belum bisa menerima push (bukan crash).
// Satu berkas google-services.json boleh memuat ketiga applicationId (pelanggan/mitra/admin).
const googleServicesFile = (process.env.GOOGLE_SERVICES_JSON ?? '').trim() || undefined;

// Versi rilis Play Store.
//   versionName  ← package.json "version" (satu sumber kebenaran)
//   versionCode  ← env ANDROID_VERSION_CODE (CI: github.run_number + ANDROID_VERSION_CODE_OFFSET), default 1 saat dev lokal.
// ANDROID_VERSION_CODE_OFFSET dibaca oleh .github/workflows/release-aab.yml (grep) — jangan ganti nama konstanta ini.
const ANDROID_VERSION_CODE_OFFSET = 100;
const envCode = Number.parseInt(process.env.ANDROID_VERSION_CODE ?? '', 10);
const runNumber = Number.parseInt(process.env.GITHUB_RUN_NUMBER ?? '', 10);
const versionCode = envCode > 0 ? envCode : runNumber > 0 ? runNumber + ANDROID_VERSION_CODE_OFFSET : 1;

const config: ExpoConfig = {
  name: m.name,
  slug: m.slug,
  version: pkg.version,
  scheme: m.scheme,
  orientation: 'portrait',
  icon: `${assets}/icon.png`,
  userInterfaceStyle: 'light',
  backgroundColor: '#F4F7F8',
  ios: {
    supportsTablet: APP === 'admin',
    bundleIdentifier: m.id,
    infoPlist: {
      NSLocationWhenInUseUsageDescription: `${m.name} memakai lokasi Anda untuk menentukan titik jemput dan melacak perjalanan.`,
      NSLocationAlwaysAndWhenInUseUsageDescription: 'Mitra driver membagikan lokasi saat online agar pelanggan bisa melacak pesanan.',
      NSCameraUsageDescription: 'Kamera dipakai untuk foto profil, dokumen mitra, selfie keamanan, dan bukti pengiriman.',
      NSPhotoLibraryUsageDescription: 'Galeri dipakai untuk mengunggah foto profil, dokumen mitra, dan bukti transfer.',
      // Ditulis eksplisit (tidak hanya mengandalkan plugin react-native-webrtc) supaya teks izin
      // mikrofon di iOS selalu Bahasa Indonesia dan jelas alasannya.
      NSMicrophoneUsageDescription: 'Mikrofon dipakai hanya untuk panggilan suara di dalam aplikasi. Nomor HP Anda tidak dibagikan.',
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: m.id,
    versionCode,
    ...(googleServicesFile ? { googleServicesFile } : {}),
    adaptiveIcon: { foregroundImage: `${assets}/adaptive-icon.png`, backgroundColor: m.bg },
    // Izin minimal (Play Store). Lokasi hanya foreground (useLocation.ts memakai requestForegroundPermissionsAsync +
    // watchPositionAsync saat aplikasi terbuka) — TIDAK ada background location / foreground service. Kamera & mikrofon:
    // foto profil/dokumen/bukti kirim dan panggilan suara WebRTC. Bila kelak pelacakan latar untuk Mitra diaktifkan,
    // tambahkan FOREGROUND_SERVICE + FOREGROUND_SERVICE_LOCATION (+ ACCESS_BACKGROUND_LOCATION) khusus APP === 'mitra'
    // dan isi deklarasi + video di Play Console (lihat docs/rilis/PLAY-STORE-LISTING.md).
    // RECORD_AUDIO diminta saat pengguna menekan tombol telepon (lihat src/lib/webrtc.native.ts).
    // MODIFY_AUDIO_SETTINGS BENAR-BENAR dipakai sekarang: src/lib/audioRoute.native.ts memindah rute
    // earpiece ↔ loudspeaker lewat expo-audio (AudioManager.setSpeakerphoneOn di balik layar).
    // VIBRATE dipakai nada dering & notifikasi in-app (src/lib/sound.ts).
    // POST_NOTIFICATIONS (Android 13+) diminta saat pengguna sudah masuk — lihat src/lib/push.ts.
    permissions: [
      'android.permission.ACCESS_COARSE_LOCATION', 'android.permission.ACCESS_FINE_LOCATION',
      'android.permission.CAMERA', 'android.permission.RECORD_AUDIO', 'android.permission.MODIFY_AUDIO_SETTINGS',
      'android.permission.INTERNET', 'android.permission.ACCESS_NETWORK_STATE', 'android.permission.VIBRATE', 'android.permission.WAKE_LOCK',
      'android.permission.POST_NOTIFICATIONS',
    ],
    // Izin yang ditambahkan template/pustaka tetapi tidak dipakai — diblokir agar tidak muncul di manifest & review Play.
    blockedPermissions: [
      'android.permission.ACCESS_BACKGROUND_LOCATION',
      'android.permission.FOREGROUND_SERVICE', 'android.permission.FOREGROUND_SERVICE_LOCATION',
      'android.permission.SYSTEM_ALERT_WINDOW',
      'android.permission.READ_MEDIA_IMAGES', 'android.permission.READ_MEDIA_VIDEO',
    ],
  },
  web: {
    output: 'single',
    favicon: `${assets}/favicon.png`,
    bundler: 'metro',
    name: m.name,
    shortName: m.name,
    themeColor: m.bg,
    backgroundColor: '#F4F7F8',
    description: m.desc,
  },
  plugins: [
    ['expo-router', { root: `./apps/${APP}/app` }],
    'expo-secure-store',
    ['expo-location', { locationWhenInUsePermission: `${m.name} memakai lokasi Anda untuk titik jemput dan pelacakan.` }],
    ['expo-image-picker', { photosPermission: 'Galeri dipakai untuk unggah foto & bukti transfer.' }],
    ['expo-splash-screen', { backgroundColor: m.bg, image: `${assets}/splash-icon.png`, imageWidth: 140 }],
    ['@config-plugins/react-native-webrtc', { cameraPermission: 'Kamera tidak dipakai untuk panggilan suara.', microphonePermission: 'Mikrofon dipakai untuk panggilan suara dalam aplikasi. Nomor HP Anda tidak dibagikan.' }],
    // Notifikasi push (FCM v1 langsung — server memakai Edge Function push-send, BUKAN Expo Push Service).
    //   defaultChannel 'antarkita' HARUS sama dengan channel_id yang dikirim server
    //   (supabase/functions/push-send/index.ts: android.notification.channel_id = 'antarkita').
    //   sounds: berkas .wav disalin ke res/raw (Android) & bundel (iOS) supaya channel 'panggilan'
    //   punya nada dering sendiri — Android 8+ mengunci suara di level channel, jadi channel yang
    //   terlanjur dibuat tanpa suara HARUS ganti id (lihat ANDROID_CHANNELS di src/lib/push.ts).
    //   icon: belum disetel karena aset notification-icon.png (96x96 putih transparan) belum ada;
    //   tanpa itu Android memakai ikon aplikasi. Tambahkan `icon: \`${assets}/notification-icon.png\``
    //   begitu asetnya tersedia.
    ['expo-notifications', {
      color: m.bg,
      defaultChannel: 'antarkita',
      sounds: ['./assets/sounds/ring.wav', './assets/sounds/order.wav', './assets/sounds/message.wav'],
      enableBackgroundRemoteNotifications: false,
    }],
    'expo-localization',
  ],
  experiments: { typedRoutes: false, reactCompiler: true, baseUrl },
  extra: { app: APP, eas: { projectId: process.env.EAS_PROJECT_ID ?? '' } },
};

export default config;
