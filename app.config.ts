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

// Versi rilis App Store (iOS).
//   CFBundleShortVersionString ← package.json "version" (sama dengan Android, satu sumber kebenaran)
//   CFBundleVersion (buildNumber) ← env IOS_BUILD_NUMBER, atau GITHUB_RUN_NUMBER + offset, default '1'.
// Apple menolak unggahan dengan buildNumber yang sudah pernah dipakai pada versionString yang sama,
// jadi nilainya HARUS naik tiap unggahan ke App Store Connect / TestFlight.
// CATATAN: `eas.json` memakai `"appVersionSource": "remote"` — untuk build lewat EAS, EAS-lah yang
// menetapkan buildNumber (autoIncrement) dan nilai di bawah diabaikan. Nilai ini tetap dipakai untuk
// `expo prebuild` lokal/CI dan untuk build Xcode manual, supaya keduanya tidak pernah kosong.
const IOS_BUILD_NUMBER_OFFSET = 100;
const envIosBuild = Number.parseInt(process.env.IOS_BUILD_NUMBER ?? '', 10);
const iosBuildNumber = String(
  envIosBuild > 0 ? envIosBuild : runNumber > 0 ? runNumber + IOS_BUILD_NUMBER_OFFSET : 1,
);

const config: ExpoConfig = {
  name: m.name,
  slug: m.slug,
  version: pkg.version,
  scheme: m.scheme,
  orientation: 'portrait',
  icon: `${assets}/icon.png`,
  userInterfaceStyle: 'light',
  backgroundColor: '#F4F7F8',
  // ------------------------------------------------------------------ iOS (App Store)
  // Disiapkan lengkap walau pemilik belum punya akun Apple Developer. Rujukan lengkap:
  // docs/rilis/APP-STORE-LISTING.md dan docs/rilis/RUNBOOK-LISTING-IOS.md.
  ios: {
    // Hanya Admin yang dipakai di layar besar — dan Admin TIDAK dipublikasikan ke App Store
    // (web saja). Untuk Pelanggan & Mitra nilainya false, sehingga App Store Connect TIDAK
    // meminta screenshot iPad 13" (yang wajib begitu aplikasi menyatakan mendukung iPad).
    supportsTablet: APP === 'admin',
    bundleIdentifier: m.id,
    buildNumber: iosBuildNumber,
    // Menulis ITSAppUsesNonExemptEncryption=false ke Info.plist lewat jalur resmi Expo.
    // Tanpa ini App Store Connect menahan tiap build di "Missing Compliance" dan meminta
    // jawaban manual soal ekspor enkripsi sebelum build bisa dipakai TestFlight/rilis.
    // Jawaban false SAH di sini: aplikasi hanya memakai HTTPS/TLS standar sistem (Supabase,
    // Midtrans, DTLS-SRTP bawaan WebRTC) — semuanya termasuk pengecualian "exempt".
    config: { usesNonExemptEncryption: false },
    infoPlist: {
      // Bahasa utama aplikasi Indonesia; App Store menampilkan bahasa ini pada halaman produk.
      CFBundleDevelopmentRegion: 'id',
      CFBundleAllowMixedLocalizations: true,
      // Teks izin. Apple MENOLAK kalimat generik ("aplikasi butuh lokasi Anda") — tiap teks di
      // bawah menyebut FITUR KONKRET yang memakainya. Bahasa Indonesia karena aplikasi rilis
      // hanya untuk storefront Indonesia.
      NSLocationWhenInUseUsageDescription:
        `${m.name} memakai lokasi Anda saat aplikasi terbuka untuk menentukan titik jemput, mencari mitra terdekat, dan menampilkan posisi pesanan di peta.`,
      // TIDAK ADA NSLocationAlwaysAndWhenInUseUsageDescription.
      // Diverifikasi di src/hooks/useLocation.ts: aplikasi HANYA memanggil
      // requestForegroundPermissionsAsync + watchPositionAsync. Mendeklarasikan izin "Always"
      // tanpa memakainya adalah alasan penolakan Apple (Guideline 5.1.1 & 5.1.2 — izin yang
      // diminta harus sepadan dengan fitur yang benar-benar ada). Bila kelak pelacakan latar
      // untuk Mitra diaktifkan, tambahkan kunci ini + UIBackgroundModes ['location'] KHUSUS
      // APP === 'mitra', lalu siapkan penjelasan untuk App Review.
      NSCameraUsageDescription:
        'Kamera dipakai saat Anda memotret foto profil, dokumen pendaftaran mitra (KTP, SIM, STNK), selfie verifikasi keamanan, dan foto bukti serah terima pesanan.',
      NSPhotoLibraryUsageDescription:
        'Galeri dipakai saat Anda memilih foto profil, dokumen pendaftaran mitra, foto produk, atau bukti transfer top up dari album Anda.',
      // Ditulis eksplisit (tidak hanya mengandalkan plugin react-native-webrtc) supaya teks izin
      // mikrofon di iOS selalu Bahasa Indonesia dan jelas alasannya.
      NSMicrophoneUsageDescription:
        'Mikrofon dipakai hanya saat Anda menelepon mitra atau pelanggan lewat panggilan suara di dalam aplikasi, agar nomor HP kedua pihak tidak perlu dibagikan. Panggilan tidak direkam.',
      // ITSAppUsesNonExemptEncryption TIDAK ditulis di sini — sudah diurus oleh
      // `ios.config.usesNonExemptEncryption: false` di atas. Menulis keduanya membuat Expo
      // mencetak peringatan "Ignoring abstract property ios.config.usesNonExemptEncryption"
      // pada setiap prebuild; hasil Info.plist-nya sama persis.
      // TIDAK ADA NSUserTrackingUsageDescription: aplikasi tidak memakai IDFA, tidak ada SDK iklan
      // maupun analitik pihak ketiga, dan tidak menggabungkan data dengan data perusahaan lain.
      // App Tracking Transparency karena itu tidak dipicu — lihat APP-STORE-LISTING.md §5.
    },
    // --------------------------------------------------------- Privacy Manifest (wajib sejak 2024)
    // Ditulis Expo ke ios/<Proyek>/PrivacyInfo.xcprivacy saat prebuild
    // (@expo/config-plugins → ios/PrivacyInfo.js).
    //
    // Kenapa hanya NSPrivacyAccessedAPITypes yang diisi:
    //   Apple: "You only need to supply NSPrivacyAccessedAPITypes for apps and third-party SDKs on
    //   iOS, iPadOS, tvOS, visionOS, and watchOS." Untuk APLIKASI, deklarasi data yang dikumpulkan
    //   adalah kuesioner App Privacy di App Store Connect (jawabannya ada di APP-STORE-LISTING.md §4),
    //   bukan berkas ini. NSPrivacyCollectedDataTypes sengaja TIDAK diisi supaya tidak ada dua sumber
    //   kebenaran yang bisa saling bertentangan saat review.
    //
    // Daftar di bawah BUKAN tebakan: setiap kategori & kode alasan disalin dari privacy manifest
    // yang benar-benar ada di dependensi yang terpasang (diperiksa 9 Sep 2026):
    //   node_modules/react-native/React/Resources/PrivacyInfo.xcprivacy       → FileTimestamp C617.1, UserDefaults CA92.1
    //   node_modules/expo-file-system/ios/PrivacyInfo.xcprivacy               → FileTimestamp 0A2A.1/3B52.1, DiskSpace E174.1/85F4.1
    //   node_modules/expo-notifications/ios/PrivacyInfo.xcprivacy             → UserDefaults CA92.1
    //   node_modules/@react-native-async-storage/async-storage/.../PrivacyInfo.xcprivacy → FileTimestamp C617.1
    // Pod ditautkan statis ke biner aplikasi, jadi pemakaian API itu ikut muncul di binary utama;
    // mendeklarasikannya di manifest aplikasi mencegah surat ITMS-91053 dari App Store Connect.
    privacyManifests: {
      NSPrivacyTracking: false,
      NSPrivacyTrackingDomains: [],
      NSPrivacyAccessedAPITypes: [
        {
          // Metadata berkas di dalam kontainer aplikasi (cache peta, berkas unggahan sementara).
          NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryFileTimestamp',
          NSPrivacyAccessedAPITypeReasons: ['C617.1'],
        },
        {
          // NSUserDefaults untuk preferensi aplikasi sendiri (bahasa, sesi, setelan notifikasi).
          NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults',
          NSPrivacyAccessedAPITypeReasons: ['CA92.1'],
        },
        {
          // Cek ruang kosong sebelum menulis berkas (unggah foto dokumen & bukti transfer).
          NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryDiskSpace',
          NSPrivacyAccessedAPITypeReasons: ['E174.1'],
        },
      ],
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
    // Diverifikasi 9 Sep 2026 pada hasil `expo prebuild`: keenam izin di bawah muncul di AndroidManifest.xml
    // dengan atribut `tools:node="remove"` sehingga HILANG dari manifest akhir setelah manifest merger.
    // AD_ID (com.google.android.gms.permission.AD_ID) diblokir supaya konsisten dengan jawaban Play Console
    // "Advertising ID → No" (Data safety). Tanpa ini, pustaka Google Play services mana pun yang kelak masuk
    // sebagai dependensi transitif dapat menyisipkannya diam-diam dan membuat deklarasi kita menjadi salah.
    blockedPermissions: [
      'android.permission.ACCESS_BACKGROUND_LOCATION',
      'android.permission.FOREGROUND_SERVICE', 'android.permission.FOREGROUND_SERVICE_LOCATION',
      'android.permission.SYSTEM_ALERT_WINDOW',
      'android.permission.READ_MEDIA_IMAGES', 'android.permission.READ_MEDIA_VIDEO',
      'com.google.android.gms.permission.AD_ID',
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
    // faceIDPermission: false → HAPUS NSFaceIDUsageDescription dari Info.plist.
    // Plugin expo-secure-store selalu menyisipkan teks bawaan berbahasa Inggris
    // "Allow $(PRODUCT_NAME) to access your Face ID biometric data." padahal aplikasi TIDAK
    // pernah memakai SecureStore dengan `requireAuthentication` (diperiksa: tidak ada satu pun
    // pemakaian di src/). Izin biometrik yang dideklarasikan tapi tak dipakai adalah bahan
    // pertanyaan App Review dan membuat label privasi tampak lebih rakus dari kenyataannya.
    // Nilai `false` benar-benar menghapus kunci — lihat applyPermissions() di
    // node_modules/@expo/config-plugins/build/ios/Permissions.js.
    ['expo-secure-store', { faceIDPermission: false }],
    // PENTING (iOS): teks izin di bawah HARUS sama persis dengan yang ada di `ios.infoPlist`.
    // Plugin-plugin ini menulis kunci NSxxxUsageDescription sendiri, dan pada `expo prebuild`
    // nilai plugin bisa menimpa nilai `ios.infoPlist`. Kalau dibiarkan berbeda, teks izin yang
    // muncul di iPhone adalah versi pendek/generik — persis yang ditolak App Review.
    // Diverifikasi lewat `expo prebuild -p ios` lalu membaca ios/*/Info.plist (lihat RUNBOOK-LISTING-IOS.md §9).
    // Ketiga nilai `false` di bawah MENGHAPUS kunci Info.plist yang plugin expo-location
    // sisipkan otomatis dengan teks bawaan berbahasa Inggris:
    //   NSLocationAlwaysAndWhenInUseUsageDescription / NSLocationAlwaysUsageDescription
    //     → "Allow $(PRODUCT_NAME) to access your location"
    //   NSMotionUsageDescription
    //     → "Allow $(PRODUCT_NAME) to detect your current motion activity"
    // Terbukti muncul di ios/AntarKita/Info.plist hasil `expo prebuild -p ios` pada 9 Sep 2026.
    // Keduanya adalah masalah ganda: (1) teks generik berbahasa Inggris yang ditolak App Review,
    // dan (2) mendeklarasikan izin lokasi "Always" + gerak yang TIDAK dipakai aplikasi
    // (src/hooks/useLocation.ts hanya memakai requestForegroundPermissionsAsync).
    ['expo-location', {
      isIosBackgroundLocationEnabled: false,
      isAndroidBackgroundLocationEnabled: false,
      locationAlwaysAndWhenInUsePermission: false,
      locationAlwaysPermission: false,
      motionUsagePermission: false,
      locationWhenInUsePermission: `${m.name} memakai lokasi Anda saat aplikasi terbuka untuk menentukan titik jemput, mencari mitra terdekat, dan menampilkan posisi pesanan di peta.`,
    }],
    ['expo-image-picker', {
      photosPermission: 'Galeri dipakai saat Anda memilih foto profil, dokumen pendaftaran mitra, foto produk, atau bukti transfer top up dari album Anda.',
      cameraPermission: 'Kamera dipakai saat Anda memotret foto profil, dokumen pendaftaran mitra (KTP, SIM, STNK), selfie verifikasi keamanan, dan foto bukti serah terima pesanan.',
    }],
    ['expo-splash-screen', { backgroundColor: m.bg, image: `${assets}/splash-icon.png`, imageWidth: 140 }],
    // Teks kamera lama ("Kamera tidak dipakai untuk panggilan suara.") sengaja diganti: kalimat itu
    // MENYANGKAL pemakaian, padahal kamera memang dipakai fitur lain di aplikasi yang sama. Bila
    // kalimat itu yang menang di Info.plist, pengguna melihat izin kamera yang menjelaskan bahwa
    // kamera tidak dipakai — kontradiksi yang wajar dipertanyakan reviewer.
    ['@config-plugins/react-native-webrtc', {
      cameraPermission: 'Kamera dipakai saat Anda memotret foto profil, dokumen pendaftaran mitra (KTP, SIM, STNK), selfie verifikasi keamanan, dan foto bukti serah terima pesanan.',
      microphonePermission: 'Mikrofon dipakai hanya saat Anda menelepon mitra atau pelanggan lewat panggilan suara di dalam aplikasi, agar nomor HP kedua pihak tidak perlu dibagikan. Panggilan tidak direkam.',
    }],
    // Notifikasi push (FCM v1 langsung — server memakai Edge Function push-send, BUKAN Expo Push Service).
    //   defaultChannel 'antarkita' HARUS sama dengan channel_id yang dikirim server
    //   (supabase/functions/push-send/index.ts: android.notification.channel_id = 'antarkita').
    //   sounds: berkas .wav disalin ke res/raw (Android) & bundel (iOS) supaya channel 'panggilan'
    //   punya nada dering sendiri — Android 8+ mengunci suara di level channel, jadi channel yang
    //   terlanjur dibuat tanpa suara HARUS ganti id (lihat ANDROID_CHANNELS di src/lib/push.ts).
    //   icon: siluet monokrom 96x96 putih + latar transparan (dibuat oleh docs/rilis/aset/buat-ikon-notifikasi.py).
    //   Android 5+ membuang warna ikon kecil dan hanya memakai kanal alfanya, lalu mewarnainya dengan `color`
    //   di bawah — ikon berwarna akan tampil sebagai kotak putih di status bar.
    ['expo-notifications', {
      icon: `${assets}/notification-icon.png`,
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
