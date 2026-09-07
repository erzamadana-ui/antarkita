// Notifikasi: satu titik masuk untuk "beri tahu pengguna".
//
// DUA LAPIS yang berbeda — jangan tertukar:
//   1. Bunyi DALAM aplikasi (notify / startRing) → src/lib/sound.ts. Hanya saat aplikasi terbuka.
//   2. PUSH NOTIFICATION sistem (muncul walau aplikasi tertutup) → berkas ini, memakai
//      expo-notifications + Firebase Cloud Messaging.
//
// ALUR PUSH (server sudah siap, lihat migrasi 0030 & supabase/functions/push-send):
//   a. initPush()  → minta izin → ambil TOKEN PERANGKAT FCM → rpc('register_push_token',
//                    { p_token, p_platform, p_app }) → baris di tabel push_tokens.
//   b. Server: trigger di `notifications`, `order_messages`, `call_logs` mengisi antrean
//      push_outbox → pg_cron menjalankan push_dispatch() tiap menit → Edge Function `push-send`
//      mengirim ke FCM HTTP v1 dengan android.notification.channel_id = 'antarkita'.
//   c. Perangkat menerima: aplikasi terbuka → listener di bawah; aplikasi tertutup → notifikasi
//      sistem, lalu ketukan pengguna masuk lewat addNotificationResponseReceivedListener /
//      getLastNotificationResponseAsync (cold start).
//   d. disposePush() → rpc('unregister_push_token') sebelum keluar akun, supaya notifikasi tidak
//      nyasar ke pengguna berikutnya di perangkat yang sama.
//
// BENTUK `data` yang BENAR-BENAR dikirim server (dibaca dari migrasi 0030, bukan karangan):
//   • dari tabel notifications : { ...notifications.data, kind, notification_id }
//   • dari chat pesanan        : { order_id, message_id, route: 'chat' }
//   • dari panggilan masuk     : { call_id, order_id, caller_id, route: 'call' }
//   Edge Function meratakan semua nilai menjadi string (JSON.stringify untuk non-string).
//
// BATASAN JUJUR (syarat pemilik ada di laporan):
//   • ANDROID: berfungsi penuh setelah google-services.json terpasang (env GOOGLE_SERVICES_JSON)
//     dan secret FCM_SERVICE_ACCOUNT diisi di Supabase.
//   • iOS: BELUM. getDevicePushTokenAsync() di iOS mengembalikan token APNs, sedangkan
//     push-send mengirim lewat FCM v1 yang menuntut token registrasi FCM. Menyambungkannya butuh
//     SDK Firebase iOS (@react-native-firebase/messaging) atau dukungan APNs di Edge Function.
//     Token APNs sengaja TIDAK didaftarkan supaya tabel push_tokens tidak terisi token yang pasti gagal.
//   • WEB: FCM web butuh Firebase JS SDK + service worker + kunci VAPID — di luar cakupan ini.
//     Metro memakai src/lib/push.web.ts di web (API sama, tanpa expo-notifications) sehingga bundel
//     web tetap ramping; web memakai bunyi dalam aplikasi (sound.ts) seperti sebelumnya.
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { rpc } from './supabase';
import { APP } from './app';
import { play as playSound, startRing, stopRing } from './sound';
import { useCall } from './call';
import { notificationData, notifTargetFor } from '@/hooks/useNotifications';

export type NotifyKind = 'order' | 'message' | 'call';

const TOKEN_KEY = 'ak.push.token';       // token terakhir yang berhasil didaftarkan
const DENIED_KEY = 'ak.push.denied';     // izin pernah ditolak → jangan menodong berulang kali

/**
 * Channel notifikasi Android. WAJIB dibuat sebelum notifikasi pertama tiba.
 * Android 8+ mengunci suara & prioritas di level channel: channel yang terlanjur dibuat tanpa
 * suara akan selamanya bisu walau payload push meminta suara — satu-satunya jalan keluar adalah
 * MENGGANTI id channel (jangan sekadar mengubah nilainya di sini).
 *
 * id 'antarkita' HARUS sama dengan channel_id yang dikirim server
 * (supabase/functions/push-send/index.ts) dan dengan `defaultChannel` di app.config.ts.
 */
export const ANDROID_CHANNELS = [
  {
    id: 'antarkita',
    name: 'Notifikasi AntarKita',
    description: 'Pesanan, chat, promo, dan info penting dari AntarKita.',
    importance: Notifications.AndroidImportance.MAX,
    sound: 'default',
    vibrationPattern: [0, 300, 200, 300],
    enableVibrate: true,
    showBadge: true,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  },
  {
    id: 'panggilan',
    name: 'Panggilan masuk',
    description: 'Nada dering untuk panggilan suara dalam aplikasi.',
    // ring.wav disalin ke res/raw oleh plugin expo-notifications (lihat app.config.ts → sounds).
    importance: Notifications.AndroidImportance.MAX,
    sound: 'ring.wav',
    vibrationPattern: [0, 600, 900, 600, 900],
    enableVibrate: true,
    showBadge: false,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  },
] as const;

/** Channel Android untuk tiap jenis notifikasi. */
export const channelFor = (kind: NotifyKind) => (kind === 'call' ? 'panggilan' : 'antarkita');

/**
 * Apakah push sistem MUNGKIN di platform ini? (bukan berarti izin sudah diberikan)
 * Lihat catatan batasan di kepala berkas untuk alasan iOS/web.
 */
export function pushAvailable(): boolean {
  if (Platform.OS !== 'android') return false;
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) return false; // Expo Go
  return true;
}

export const PUSH_UNAVAILABLE_REASON =
  Platform.OS === 'web'
    ? 'Push notification belum tersedia di versi web. Buka aplikasi Android agar tetap menerima pemberitahuan saat aplikasi ditutup.'
    : Platform.OS === 'ios'
      ? 'Push notification iOS belum aktif: server mengirim lewat Firebase (FCM), sedangkan iOS memakai APNs. Perlu dukungan APNs di server.'
      : Constants.executionEnvironment === ExecutionEnvironment.StoreClient
        ? 'Push notification tidak berfungsi di Expo Go. Pakai APK/AAB hasil build.'
        : 'Push notification belum aktif di perangkat ini.';

// --------------------------------------------------------------------------- status
export interface PushStatus {
  /** Sudah punya token yang terdaftar di server? */
  registered: boolean;
  /** Izin notifikasi dari sistem operasi. */
  permission: 'granted' | 'denied' | 'undetermined' | 'unsupported';
  reason?: string;
}
let status: PushStatus = { registered: false, permission: 'undetermined' };
export const pushStatus = (): PushStatus => status;

// ----------------------------------------------------------------- rute dari payload
type RawData = Record<string, unknown> | null | undefined;

/**
 * Halaman tujuan saat notifikasi sistem DIKETUK.
 * Sengaja memakai peta yang sama dengan kotak masuk (notifTargetFor) supaya tujuannya identik,
 * ditambah dua jalur yang hanya ada di push: route 'chat' dan route 'call'.
 */
export function routeForPushData(raw: RawData): string | null {
  const d = (raw ?? {}) as Record<string, unknown>;
  const route = typeof d.route === 'string' ? d.route : undefined;
  const orderId = typeof d.order_id === 'string' ? d.order_id : undefined;

  if (route === 'call') {
    // Panggilan hanya bisa dibuka bila memang masih berlangsung (state ada di src/lib/call.ts).
    // Bila sudah lewat, jangan buka layar panggilan kosong — arahkan ke pesanannya bila ada.
    const call = useCall.getState();
    if ((call.phase === 'incoming' || call.phase === 'connecting' || call.phase === 'active') && call.callId) return `/call/${call.callId}`;
    return orderId ? `/order/${orderId}` : null;
  }
  if (route === 'chat' && orderId) return `/order/${orderId}/chat`;

  const target = notifTargetFor(notificationData({ data: d, merchant_id: null }));
  if (target) return target.route;
  // Tanpa tujuan spesifik: buka kotak masuk supaya ketukan tidak berakhir tanpa reaksi.
  return APP === 'admin' ? null : '/inbox';
}

// --------------------------------------------------------------- navigasi aman (cold start)
let pendingRoute: string | null = null;
let navReady = false;

/** Dipanggil RootLayout begitu navigator siap. Rute yang tertunda (cold start) langsung dibuka. */
export function markNavigationReady() {
  navReady = true;
  flushPendingRoute();
}

/** Buka rute yang tertunda (bila ada). Aman dipanggil berkali-kali. */
export function flushPendingRoute() {
  if (!navReady || !pendingRoute) return;
  const route = pendingRoute;
  pendingRoute = null;
  void navigate(route);
}

async function navigate(route: string) {
  try {
    // Import dinamis: `router` expo-router tidak boleh disentuh sebelum navigator terpasang.
    const { router } = await import('expo-router');
    router.push(route as never);
  } catch { /* rute tidak dikenal / navigator belum siap: diabaikan dengan tenang */ }
}

function openFromPush(raw: RawData) {
  const route = routeForPushData(raw);
  if (!route) return;
  if (!navReady) { pendingRoute = route; return; }
  void navigate(route);
}

// ----------------------------------------------------------------------- listener
let handlerSet = false;
let subs: { remove: () => void }[] = [];
let ringGuard: ReturnType<typeof setTimeout> | null = null;

function isCall(raw: RawData) { return (raw as { route?: unknown } | null)?.route === 'call'; }

function setForegroundHandler() {
  if (handlerSet) return;
  handlerSet = true;
  // Tanpa ini, Android/iOS MENYEMBUNYIKAN notifikasi yang tiba saat aplikasi sedang dibuka.
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,      // dipertahankan untuk kompatibilitas versi lama
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

function attachListeners() {
  if (subs.length) return;

  // Notifikasi tiba saat aplikasi TERBUKA.
  subs.push(Notifications.addNotificationReceivedListener((n) => {
    const data = n.request.content.data as RawData;
    if (isCall(data)) {
      // Dering + tampilkan layar panggilan. Kartu "Angkat/Tolak" sendiri dibuat oleh sinyal
      // realtime (src/lib/call.ts → IncomingCallOverlay); push adalah jaring pengaman bila
      // realtime telat. Kalau dalam 12 detik tidak ada panggilan nyata, dering dihentikan
      // supaya tidak berbunyi selamanya.
      startRing();
      openFromPush(data);
      if (ringGuard) clearTimeout(ringGuard);
      ringGuard = setTimeout(() => {
        const p = useCall.getState().phase;
        if (p === 'idle' || p === 'ended') stopRing();
      }, 12_000);
      return;
    }
    const d = data as { route?: unknown } | null;
    playSound(d?.route === 'chat' ? 'message' : 'order');
  }));

  // Notifikasi DIKETUK (aplikasi di latar belakang atau sedang terbuka).
  subs.push(Notifications.addNotificationResponseReceivedListener((resp) => {
    stopRing();
    openFromPush(resp.notification.request.content.data as RawData);
  }));

  // Token FCM bisa berputar sendiri (Firebase). Daftarkan ulang supaya push tidak diam-diam mati.
  subs.push(Notifications.addPushTokenListener((t) => {
    const tok = typeof t?.data === 'string' ? t.data : null;
    if (tok) void saveToken(tok);
  }));
}

/** Aplikasi dibuka DARI notifikasi ketika sebelumnya benar-benar TERTUTUP (cold start). */
async function handleColdStart() {
  try {
    const last = await Notifications.getLastNotificationResponseAsync();
    if (last) openFromPush(last.notification.request.content.data as RawData);
  } catch { /* noop */ }
}

// -------------------------------------------------------------------------- token
async function saveToken(token: string) {
  try {
    const prev = await AsyncStorage.getItem(TOKEN_KEY);
    await rpc('register_push_token', { p_token: token, p_platform: Platform.OS, p_app: APP });
    await AsyncStorage.setItem(TOKEN_KEY, token);
    // Token berganti → lepas yang lama supaya tidak ada baris yatim di push_tokens.
    if (prev && prev !== token) { try { await rpc('unregister_push_token', { p_token: prev }); } catch { /* noop */ } }
    status = { ...status, registered: true, reason: undefined };
  } catch (e) {
    status = { ...status, registered: false, reason: (e as Error).message };
  }
}

// --------------------------------------------------------------------------- API
/** Minta izin notifikasi (dan buat channel Android). Tidak pernah melempar. */
export async function ensurePushPermission(ask = true): Promise<PushStatus['permission']> {
  if (Platform.OS === 'web') return 'unsupported';
  try {
    await ensureChannels();
    const cur = await Notifications.getPermissionsAsync();
    if (cur.granted) return 'granted';
    if (!ask) return cur.canAskAgain ? 'undetermined' : 'denied';
    const req = await Notifications.requestPermissionsAsync();
    if (req.granted) { await AsyncStorage.removeItem(DENIED_KEY).catch(() => { /* noop */ }); return 'granted'; }
    await AsyncStorage.setItem(DENIED_KEY, '1').catch(() => { /* noop */ });
    return req.canAskAgain ? 'undetermined' : 'denied';
  } catch { return 'unsupported'; }
}

async function ensureChannels() {
  if (Platform.OS !== 'android') return;
  for (const c of ANDROID_CHANNELS) {
    try {
      await Notifications.setNotificationChannelAsync(c.id, {
        name: c.name,
        description: c.description,
        importance: c.importance,
        sound: c.sound,
        vibrationPattern: [...c.vibrationPattern],
        enableVibrate: c.enableVibrate,
        showBadge: c.showBadge,
        lockscreenVisibility: c.lockscreenVisibility,
      });
    } catch { /* perangkat lama / channel sudah ada: abaikan */ }
  }
}

let initing: Promise<PushStatus> | null = null;

/**
 * Siapkan push notification untuk pengguna yang SEDANG masuk.
 * Aman dipanggil berkali-kali (hasilnya di-cache selama proses hidup) dan TIDAK PERNAH melempar:
 * izin ditolak / token gagal hanya membuat status.registered tetap false.
 */
export function initPush(): Promise<PushStatus> {
  if (initing) return initing;
  initing = (async (): Promise<PushStatus> => {
    // Handler foreground & listener dipasang lebih dulu supaya notifikasi tetap tampil
    // walaupun pendaftaran token gagal.
    if (Platform.OS !== 'web') {
      try { setForegroundHandler(); attachListeners(); await handleColdStart(); } catch { /* noop */ }
    }

    if (!pushAvailable()) {
      status = { registered: false, permission: 'unsupported', reason: PUSH_UNAVAILABLE_REASON };
      if (__DEV__) console.log('[AntarKita/push] ' + PUSH_UNAVAILABLE_REASON);
      return status;
    }
    // Emulator tanpa Google Play Services tidak bisa memberi token FCM — bukan kesalahan pengguna.
    if (!Device.isDevice && __DEV__) console.log('[AntarKita/push] emulator: token FCM hanya muncul bila Google Play Services tersedia.');

    const perm = await ensurePushPermission(true);
    status = { ...status, permission: perm };
    if (perm !== 'granted') {
      status.reason = 'Izin notifikasi belum diberikan. Aktifkan di Pengaturan › Aplikasi › Notifikasi.';
      return status;
    }

    try {
      // getDevicePushTokenAsync = token FCM MURNI (bukan Expo Push Token): server memanggil
      // FCM HTTP v1 langsung, jadi token Expo tidak akan dikenali.
      const t = await Notifications.getDevicePushTokenAsync();
      const token = typeof t?.data === 'string' ? t.data : null;
      if (!token) { status.reason = 'Token perangkat kosong.'; return status; }
      await saveToken(token);
    } catch (e) {
      status = { ...status, registered: false, reason: (e as Error).message };
      if (__DEV__) console.log('[AntarKita/push] gagal ambil token:', (e as Error).message);
    }
    return status;
  })();
  return initing;
}

/**
 * Lepas token perangkat dari akun ini. WAJIB dipanggil SEBELUM signOut (butuh sesi yang masih sah),
 * lihat attachSignOutHook() di bawah. Tidak pernah melempar.
 */
export async function disposePush(): Promise<void> {
  initing = null;
  try {
    const token = await AsyncStorage.getItem(TOKEN_KEY);
    if (token) {
      try { await rpc('unregister_push_token', { p_token: token }); } catch { /* offline: token tetap dihapus lokal */ }
      await AsyncStorage.removeItem(TOKEN_KEY);
    }
  } catch { /* noop */ }
  status = { registered: false, permission: status.permission };
}

/**
 * Pasang disposePush() TEPAT SEBELUM keluar akun tanpa menyentuh src/store/auth.ts
 * (berkas itu milik bagian lain). Caranya: membungkus aksi `signOut` di store zustand satu kali.
 * Idempotent — pemanggilan kedua tidak membungkus dua kali.
 */
let signOutWrapped = false;
export function attachSignOutHook() {
  if (signOutWrapped) return;
  signOutWrapped = true;
  // import dinamis supaya push.ts tidak menciptakan siklus impor dengan store auth
  import('@/store/auth').then(({ useAuth }) => {
    const original = useAuth.getState().signOut;
    useAuth.setState({
      signOut: async () => {
        await disposePush();          // hapus token SELAGI sesi masih sah
        await original();
      },
    });
  }).catch(() => { signOutWrapped = false; });
}

/** Lepas semua listener (dipakai saat unmount root / uji). */
export function stopPushListeners() {
  subs.forEach((s) => { try { s.remove(); } catch { /* noop */ } });
  subs = [];
  if (ringGuard) { clearTimeout(ringGuard); ringGuard = null; }
}

// ------------------------------------------------------------- bunyi dalam aplikasi
/**
 * Beri tahu pengguna tentang sesuatu yang baru terjadi SAAT APLIKASI TERBUKA.
 * (Saat aplikasi tertutup, yang bekerja adalah push notification di atas.)
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
    app: APP,
    systemNotifications: pushAvailable(),
    inAppSound: true,
    channels: ANDROID_CHANNELS.map((c) => c.id),
    registered: status.registered,
    permission: status.permission,
    reason: status.reason ?? (pushAvailable() ? undefined : PUSH_UNAVAILABLE_REASON),
  };
}

export default {
  initPush, disposePush, ensurePushPermission, attachSignOutHook, markNavigationReady,
  notify, notifyStopRing, pushAvailable, pushCapabilities, pushStatus, routeForPushData,
  ANDROID_CHANNELS, channelFor,
};
