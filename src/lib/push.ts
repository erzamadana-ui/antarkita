// Notifikasi: satu titik masuk untuk "beri tahu pengguna".
//
// STATUS SAAT INI (penting, jangan sampai salah paham):
//   `expo-notifications` TIDAK ada di package.json, dan tugas ini melarang menambah dependensi.
//   Artinya aplikasi BELUM punya push notification maupun notifikasi lokal sistem:
//     • Saat aplikasi TERBUKA  → modul ini membunyikan suara + getar lewat src/lib/sound.ts. Bekerja.
//     • Saat aplikasi DITUTUP  → tidak ada apa pun yang muncul. Order baru / panggilan masuk /
//       pesan chat TIDAK akan terdengar. Ini batasan nyata, bukan bug yang bisa diperbaiki di sini.
//
// Cara mengaktifkannya nanti (lihat laporan): `npx expo install expo-notifications`,
// daftarkan plugin di app.config.ts, lalu isi bagian bertanda TODO di bawah. Definisi channel
// Android sudah disiapkan di ANDROID_CHANNELS supaya tinggal dipakai.
import { Platform } from 'react-native';
import { play as playSound, startRing, stopRing } from './sound';

export type NotifyKind = 'order' | 'message' | 'call';

/**
 * Channel notifikasi Android yang HARUS dibuat begitu expo-notifications dipasang.
 * Android 8+ mengunci suara & prioritas di level channel: kalau channel dibuat tanpa `sound`,
 * notifikasi selamanya bisu walaupun payload push meminta suara (harus ganti id channel).
 */
export const ANDROID_CHANNELS = [
  {
    id: 'panggilan',
    name: 'Panggilan masuk',
    description: 'Nada dering untuk panggilan suara dalam aplikasi.',
    importance: 'max' as const,          // Notifications.AndroidImportance.MAX
    sound: 'ring.wav',                   // salin assets/sounds/ring.wav ke android/app/src/main/res/raw/
    vibrationPattern: [0, 600, 900, 600, 900],
    enableVibrate: true,
    bypassDnd: false,
    lockscreenVisibility: 'public' as const,
  },
  {
    id: 'order',
    name: 'Order baru',
    description: 'Order masuk untuk mitra driver/merchant.',
    importance: 'high' as const,         // Notifications.AndroidImportance.HIGH
    sound: 'order.wav',
    vibrationPattern: [0, 300, 200, 300],
    enableVibrate: true,
    lockscreenVisibility: 'public' as const,
  },
  {
    id: 'chat',
    name: 'Pesan chat',
    description: 'Pesan baru dari pelanggan/driver.',
    importance: 'high' as const,
    sound: 'message.wav',
    vibrationPattern: [0, 200],
    enableVibrate: true,
    lockscreenVisibility: 'private' as const,
  },
];

/** Channel Android untuk tiap jenis notifikasi. */
export const channelFor = (kind: NotifyKind) => (kind === 'call' ? 'panggilan' : kind === 'order' ? 'order' : 'chat');

/** Apakah notifikasi sistem (push / lokal) tersedia di build ini? Saat ini: tidak. */
export function pushAvailable(): boolean { return false; }

/** Alasan yang bisa ditampilkan/di-log kalau ada yang bertanya kenapa tidak ada notifikasi. */
export const PUSH_UNAVAILABLE_REASON =
  'Notifikasi sistem belum aktif: paket expo-notifications belum dipasang. Suara hanya berbunyi saat aplikasi terbuka.';

let warned = false;
/**
 * Meminta izin + mendaftarkan token push. Sekarang selalu gagal dengan alasan jelas.
 * TODO(expo-notifications): minta izin, buat ANDROID_CHANNELS, ambil Expo push token, simpan ke profil.
 */
export async function registerForPush(): Promise<{ ok: false; reason: string }> {
  if (!warned && __DEV__) { warned = true; console.warn('[AntarKita] ' + PUSH_UNAVAILABLE_REASON); }
  return { ok: false, reason: PUSH_UNAVAILABLE_REASON };
}

/**
 * Beri tahu pengguna tentang sesuatu yang baru terjadi.
 * Saat aplikasi terbuka: bunyi pendek + getar (sound.ts sudah menahan diri bila app di latar belakang).
 * Saat aplikasi tertutup: belum ada apa-apa — lihat catatan di atas.
 */
export function notify(kind: NotifyKind) {
  if (kind === 'call') { startRing(); return; }
  playSound(kind === 'order' ? 'order' : 'message');
}

/** Hentikan nada dering panggilan. */
export function notifyStopRing() { stopRing(); }

/** Ringkasan kemampuan perangkat — dipakai layar diagnostik/laporan QC. */
export function pushCapabilities() {
  return {
    platform: Platform.OS,
    systemNotifications: false,
    inAppSound: true,
    channels: ANDROID_CHANNELS.map((c) => c.id),
    reason: PUSH_UNAVAILABLE_REASON,
  };
}

export default { notify, notifyStopRing, registerForPush, pushAvailable, pushCapabilities, ANDROID_CHANNELS, channelFor };
