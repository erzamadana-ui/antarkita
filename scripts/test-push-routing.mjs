// Uji rute push notification TANPA perangkat & TANPA server.
//
// Yang diuji adalah KODE ASLI (src/lib/push.ts + src/hooks/useNotifications.ts), dijalankan dengan
// modul native/jaringan yang dipalsukan. Payload yang dipakai persis bentuk yang dikirim server —
// lihat supabase/migrations/0030_...sql (trg_push_notification / trg_push_order_message /
// trg_push_call) dan supabase/functions/push-send/index.ts (semua nilai `data` diratakan ke string).
//
// Jalankan:  node scripts/test-push-routing.mjs
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function compile(file, stubs) {
  const js = ts.transpileModule(readFileSync(path.join(ROOT, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  const req = (name) => {
    if (!(name in stubs)) throw new Error(`modul tak terduga di ${file}: ${name}`);
    return stubs[name];
  };
  // eslint-disable-next-line no-new-func
  new Function('exports', 'require', 'module', js)(module.exports, req, module);
  return module.exports;
}

/** Bangun ulang push.ts untuk satu aplikasi (pelanggan/mitra/admin) + satu keadaan panggilan. */
function build({ app = 'pelanggan', call = { phase: 'idle', callId: null } } = {}) {
  const react = { useCallback: (f) => f, useEffect: () => {}, useState: (v) => [v, () => {}] };
  const notif = compile('src/hooks/useNotifications.ts', {
    react,
    '@/lib/supabase': { supabase: {}, rpc: async () => ({}), realtimeChannel: () => ({ on: () => ({ subscribe: () => ({}) }) }) },
    '@/lib/app': { APP: app },
  });

  const rpcCalls = [];
  const store = new Map();
  const push = compile('src/lib/push.ts', {
    'react-native': { Platform: { OS: 'android' } },
    '@react-native-async-storage/async-storage': {
      __esModule: true,
      default: {
        getItem: async (k) => store.get(k) ?? null,
        setItem: async (k, v) => { store.set(k, v); },
        removeItem: async (k) => { store.delete(k); },
      },
    },
    'expo-notifications': {
      AndroidImportance: { MAX: 5, HIGH: 4 },
      AndroidNotificationVisibility: { PUBLIC: 1, PRIVATE: 2 },
      setNotificationHandler: () => {},
      setNotificationChannelAsync: async () => null,
      getPermissionsAsync: async () => ({ granted: true, canAskAgain: true }),
      requestPermissionsAsync: async () => ({ granted: true, canAskAgain: true }),
      getDevicePushTokenAsync: async () => ({ type: 'android', data: 'TOKEN-FCM-PALSU' }),
      getLastNotificationResponseAsync: async () => null,
      addNotificationReceivedListener: () => ({ remove() {} }),
      addNotificationResponseReceivedListener: () => ({ remove() {} }),
      addPushTokenListener: () => ({ remove() {} }),
    },
    'expo-device': { isDevice: true },
    'expo-constants': { __esModule: true, default: { executionEnvironment: 'standalone' }, ExecutionEnvironment: { StoreClient: 'storeClient' } },
    './supabase': { rpc: async (fn, params) => { rpcCalls.push({ fn, params }); return { ok: true }; } },
    './app': { APP: app },
    './sound': { play: () => {}, startRing: () => {}, stopRing: () => {} },
    './call': { useCall: { getState: () => call } },
    '@/hooks/useNotifications': notif,
  });
  return { push, notif, rpcCalls };
}

let ok = 0;
const check = (label, fn) => { fn(); ok++; console.log('  ✓ ' + label); };
console.log('push.ts — uji rute notifikasi & pendaftaran token');

// ------------------------------------------------------- payload asli dari server
{
  const { push } = build({ app: 'pelanggan' });
  const r = push.routeForPushData;

  check('chat pesanan → layar chat pesanan', () => {
    // trg_push_order_message: { order_id, message_id, route: 'chat' }
    assert.equal(r({ order_id: 'o-1', message_id: '9', route: 'chat' }), '/order/o-1/chat');
  });

  check('notifikasi pesanan → detail pesanan', () => {
    // trg_push_notification: notifications.data || { kind, notification_id }
    assert.equal(r({ order_id: 'o-2', kind: 'order', notification_id: '12' }), '/order/o-2');
  });

  check('notifikasi tiket CS → percakapan tiket', () => {
    assert.equal(r({ ticket_id: 't-7', kind: 'system' }), '/support/t-7');
  });

  check('notifikasi AntarPay (pelanggan) → halaman AntarPay', () => {
    assert.equal(r({ payment_id: 'p-3', kind: 'system' }), '/(customer)/pay');
  });

  check('pengumuman tanpa tujuan → kotak masuk (bukan diam saja)', () => {
    assert.equal(r({ kind: 'promo', notification_id: '30' }), '/inbox');
  });

  check('panggilan yang sudah lewat → jangan buka layar panggilan kosong', () => {
    // phase 'idle' = tidak ada panggilan berlangsung → jatuh ke pesanannya
    assert.equal(r({ call_id: 'c-1', order_id: 'o-9', caller_id: 'u-1', route: 'call' }), '/order/o-9');
    assert.equal(r({ call_id: 'c-1', order_id: null, caller_id: 'u-1', route: 'call' }), null);
  });
}

// -------------------------------------------------- panggilan yang MASIH berlangsung
{
  const { push } = build({ call: { phase: 'incoming', callId: 'c-42' } });
  check('panggilan masih berdering → buka layar panggilan yang benar', () => {
    assert.equal(push.routeForPushData({ call_id: 'c-42', route: 'call' }), '/call/c-42');
  });
}

// ------------------------------------------------- peta tujuan berbeda tiap aplikasi
{
  const mitra = build({ app: 'mitra' }).push;
  check('aplikasi Mitra: AntarPay → halaman penghasilan, bukan halaman pelanggan', () => {
    assert.equal(mitra.routeForPushData({ withdrawal_id: 'w-1' }), '/(driver)/earnings');
  });
  const admin = build({ app: 'admin' }).push;
  check('aplikasi Admin: tanpa tujuan → tidak memaksa membuka /inbox (rute itu tidak ada di Admin)', () => {
    assert.equal(admin.routeForPushData({ kind: 'system' }), null);
  });
}

// ------------------------------------------------------------ pendaftaran & pelepasan token
{
  const { push, rpcCalls } = build();
  const st = await push.initPush();
  check('initPush() mendaftarkan token FCM dengan p_platform & p_app', () => {
    assert.equal(st.registered, true);
    const reg = rpcCalls.find((c) => c.fn === 'register_push_token');
    assert.ok(reg, 'register_push_token harus dipanggil');
    assert.deepEqual(reg.params, { p_token: 'TOKEN-FCM-PALSU', p_platform: 'android', p_app: 'pelanggan' });
  });

  await push.disposePush();
  check('disposePush() melepas token yang sama (dipanggil sebelum keluar akun)', () => {
    const un = rpcCalls.find((c) => c.fn === 'unregister_push_token');
    assert.ok(un, 'unregister_push_token harus dipanggil');
    assert.deepEqual(un.params, { p_token: 'TOKEN-FCM-PALSU' });
    assert.equal(push.pushStatus().registered, false);
  });
}

// --------------------------------------------------------------- kegagalan tidak boleh crash
{
  // RPC gagal (offline / RLS) → status jujur, TIDAK melempar.
  const broken = compileBroken();
  const st = await broken.initPush();
  check('RPC gagal → tidak crash, status.registered false + alasan tercatat', () => {
    assert.equal(st.registered, false);
    assert.match(String(st.reason), /jaringan/i);
  });
}

function compileBroken() {
  const react = { useCallback: (f) => f, useEffect: () => {}, useState: (v) => [v, () => {}] };
  const notif = compile('src/hooks/useNotifications.ts', {
    react,
    '@/lib/supabase': { supabase: {}, rpc: async () => ({}), realtimeChannel: () => ({}) },
    '@/lib/app': { APP: 'pelanggan' },
  });
  const store = new Map();
  return compile('src/lib/push.ts', {
    'react-native': { Platform: { OS: 'android' } },
    '@react-native-async-storage/async-storage': {
      __esModule: true,
      default: { getItem: async (k) => store.get(k) ?? null, setItem: async (k, v) => { store.set(k, v); }, removeItem: async (k) => { store.delete(k); } },
    },
    'expo-notifications': {
      AndroidImportance: { MAX: 5 }, AndroidNotificationVisibility: { PUBLIC: 1 },
      setNotificationHandler: () => {}, setNotificationChannelAsync: async () => null,
      getPermissionsAsync: async () => ({ granted: true, canAskAgain: true }),
      requestPermissionsAsync: async () => ({ granted: true, canAskAgain: true }),
      getDevicePushTokenAsync: async () => ({ type: 'android', data: 'TOKEN-X' }),
      getLastNotificationResponseAsync: async () => null,
      addNotificationReceivedListener: () => ({ remove() {} }),
      addNotificationResponseReceivedListener: () => ({ remove() {} }),
      addPushTokenListener: () => ({ remove() {} }),
    },
    'expo-device': { isDevice: true },
    'expo-constants': { __esModule: true, default: { executionEnvironment: 'standalone' }, ExecutionEnvironment: { StoreClient: 'storeClient' } },
    './supabase': { rpc: async () => { throw new Error('Koneksi jaringan bermasalah'); } },
    './app': { APP: 'pelanggan' },
    './sound': { play: () => {}, startRing: () => {}, stopRing: () => {} },
    './call': { useCall: { getState: () => ({ phase: 'idle', callId: null }) } },
    '@/hooks/useNotifications': notif,
  });
}

console.log(`\n${ok} pemeriksaan lulus.`);
