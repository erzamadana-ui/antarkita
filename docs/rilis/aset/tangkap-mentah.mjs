#!/usr/bin/env node
// Tangkap ulang 8 layar mentah untuk screenshot listing Play Store dari BUILD WEB (dist/).
//
//   1. npm ci
//   2. Bangun web persis seperti .github/workflows/web.yml (domain kustom → base path "/"):
//        EXPO_PUBLIC_BASE_URL= EXPO_PUBLIC_SITE_ROOT=https://apps.antarkitaindonesia.com \
//        PAGES_CNAME=apps.antarkitaindonesia.com EXPO_NO_TELEMETRY=1 CI=1 node scripts/build-web.mjs
//   3. PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node docs/rilis/aset/tangkap-mentah.mjs
//        (opsional: HANYA=p-beranda,m-order untuk sebagian layar; SIMPAN_KE=<folder> untuk lokasi lain)
//   4. python3 docs/rilis/aset/bingkai-screenshot.py   → screenshot 1080×1920 di docs/rilis/aset/screenshot/
//
// Cara kerja: dist/ dilayani dari server statis lokal (fallback SPA ke index.html aplikasi yang tepat),
// dibuka di Chromium (Playwright) pada viewport ponsel 412×892 @3x, lokasi GPS Padang, jam dibekukan
// 16.30 WIB. SEMUA permintaan ke Supabase dicegat di peramban (page.route) dan dijawab dengan DATA
// TIRUAN di berkas ini — tidak ada satu pun permintaan yang menyentuh Supabase produksi, tidak ada
// akun nyata, tidak ada kredensial (sesi yang disuntik ke localStorage adalah JWT palsu tanpa tanda
// tangan yang hanya dipercaya oleh supabase-js sisi klien sampai kedaluwarsa).
// Ubin peta juga dicegat dan diganti basemap PROSEDURAL (SVG) karena tile.openstreetmap.org
// diblokir di lingkungan build — jalannya terlihat terlalu teratur bila diperhatikan.
//
// Data tiruan yang tampil (sama seperti versi sebelumnya): pelanggan "Budi Santoso", driver
// "Ahmad Fauzi" (Toyota Avanza, BA 1234 AB), saldo AntarPay Rp250.000, kode order AK2609150042.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
function loadPlaywright() {
  try { return require('playwright'); } catch { /* tidak ada di node_modules proyek */ }
  const g = execSync('npm root -g', { encoding: 'utf8' }).trim();
  return require(path.join(g, 'playwright'));
}
const { chromium } = loadPlaywright();

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const DIST = path.join(ROOT, 'dist');
const OUT = process.env.SIMPAN_KE ? path.resolve(process.env.SIMPAN_KE) : path.join(HERE, 'screenshot', 'mentah');
const HANYA = process.env.HANYA ? new Set(process.env.HANYA.split(',').map((s) => s.trim())) : null;

if (!fs.existsSync(path.join(DIST, 'index.html')) || !fs.existsSync(path.join(DIST, 'mitra', 'index.html'))) {
  console.error('dist/ belum ada — jalankan scripts/build-web.mjs dulu (lihat komentar di atas).');
  process.exit(1);
}

// ---------------------------------------------------------------------------------------------
// Server statis dist/ dengan fallback SPA ke index.html aplikasi yang sesuai awalan path.
// ---------------------------------------------------------------------------------------------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.woff': 'font/woff', '.map': 'application/json', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };
function serveDist() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://x');
      let p = decodeURIComponent(url.pathname);
      let file = path.join(DIST, p);
      if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
      if (!fs.existsSync(file)) {
        const app = p.startsWith('/mitra') ? 'mitra' : p.startsWith('/admin') ? 'admin' : '';
        file = path.join(DIST, app, 'index.html');
      }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, base: `http://127.0.0.1:${srv.address().port}` }));
  });
}

// ---------------------------------------------------------------------------------------------
// Sesi & data tiruan
// ---------------------------------------------------------------------------------------------
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n').filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).trim()]; }));
const SB_URL = env.EXPO_PUBLIC_SUPABASE_URL || 'https://invalid.supabase.co';
const SB_REF = new URL(SB_URL).hostname.split('.')[0];
const STORAGE_KEY = `sb-${SB_REF}-auth-token`;

const WAKTU = new Date('2026-09-15T09:30:00Z');            // 16.30 WIB → sapaan "Selamat sore"
const iso = (menitLalu) => new Date(WAKTU.getTime() - menitLalu * 60000).toISOString();
const UID_BUDI = 'aaaaaaaa-0000-4000-8000-000000000001';   // pelanggan (dan driver di aplikasi Mitra)
const UID_AHMAD = 'bbbbbbbb-0000-4000-8000-000000000002';  // driver yang melayani pesanan pelanggan
const ORDER_ID = 'cccccccc-0000-4000-8000-000000000003';
const ORDER_CODE = 'AK2609150042';
const MERCHANT_ID = 'dddddddd-0000-4000-8000-000000000004';
const PADANG = { lat: -0.9471, lng: 100.4172 };
const JEMPUT = { lat: -0.9471, lng: 100.4172, alamat: 'Jl. Sudirman No. 45, Padang Barat, Kota Padang' };
const TUJUAN = { lat: -0.9538, lng: 100.3602, alamat: 'Plaza Andalas, Jl. Pemuda, Padang Barat, Kota Padang' };
const RUTE = [[-0.9471, 100.4172], [-0.9478, 100.4090], [-0.9502, 100.3980], [-0.9512, 100.3840], [-0.9530, 100.3700], [-0.9538, 100.3602]];
const DRIVER_POS = { lat: -0.9448, lng: 100.4231, heading: 250 };

const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function sesiPalsu(uid, email, nama) {
  const exp = Math.floor(WAKTU.getTime() / 1000) + 3600 * 24 * 30;
  const user = { id: uid, aud: 'authenticated', role: 'authenticated', email, email_confirmed_at: iso(60 * 24 * 90), phone: '', app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: { full_name: nama }, identities: [], created_at: iso(60 * 24 * 90), updated_at: iso(60) };
  const jwt = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ iss: `${SB_URL}/auth/v1`, sub: uid, aud: 'authenticated', exp, iat: exp - 3600, email, role: 'authenticated', session_id: 'eeeeeeee-0000-4000-8000-000000000005' })}.tiruan`;
  return { access_token: jwt, refresh_token: 'tiruan-refresh', token_type: 'bearer', expires_in: 3600 * 24 * 30, expires_at: exp, user };
}

const profil = {
  [UID_BUDI]: { id: UID_BUDI, full_name: 'Budi Santoso', phone: '+6281234567890', email: 'budi@contoh.id', avatar_url: null, role: 'customer', is_active: true, created_at: iso(60 * 24 * 90), locale: 'id', emergency_contact_name: 'Sari Santoso', emergency_contact_phone: '+6281298765432' },
  [UID_AHMAD]: { id: UID_AHMAD, full_name: 'Ahmad Fauzi', phone: '+6281355556666', email: 'ahmad@contoh.id', avatar_url: null, role: 'driver', is_active: true, created_at: iso(60 * 24 * 400), locale: 'id' },
};
const driverRow = (id) => ({
  id, vehicle_type: 'car', vehicle_brand: 'Toyota', vehicle_model: 'Avanza', vehicle_plate: 'BA 1234 AB', vehicle_color: 'Hitam', vehicle_year: 2022,
  vehicle_class: 'car_standard', fuel_type: 'bensin', status: 'approved', is_online: true, lat: DRIVER_POS.lat, lng: DRIVER_POS.lng, heading: DRIVER_POS.heading,
  last_seen_at: iso(0), rating_avg: 4.9, rating_count: 213, total_trips: 1280, created_at: iso(60 * 24 * 400), last_selfie_at: iso(180), vehicle_condition: 'baik', is_electric: false,
});
const wallet = { user_id: UID_BUDI, balance: 250000, updated_at: iso(30) };
const order = {
  id: ORDER_ID, code: ORDER_CODE, service: 'ride_car', customer_id: UID_BUDI, driver_id: UID_AHMAD, merchant_id: null, status: 'accepted', merchant_status: null,
  pickup_address: JEMPUT.alamat, pickup_lat: JEMPUT.lat, pickup_lng: JEMPUT.lng, dropoff_address: TUJUAN.alamat, dropoff_lat: TUJUAN.lat, dropoff_lng: TUJUAN.lng,
  distance_km: 6.4, duration_min: 16, route_geometry: RUTE, fare_delivery: 19000, items_subtotal: 0, platform_fee: 2000, discount: 0, promo_code: null, total: 21000,
  driver_earning: 17100, merchant_earning: 0, payment_method: 'wallet', payment_status: 'paid', paid_via: 'wallet', notes: null, recipient_name: null, recipient_phone: null,
  package_details: null, tip: 0, extras: [], extras_total: 0, share_token: 'tiruan-share', city: 'Padang', vehicle_class: 'car_standard', helpers: 0,
  created_at: iso(6), accepted_at: iso(3), started_at: null, completed_at: null, cancel_reason: null, scheduled_at: null, preferred_driver_id: null, order_items: [], merchant: null,
};
const orderEvents = [
  { id: 1, order_id: ORDER_ID, status: 'searching', actor_id: UID_BUDI, note: 'Pesanan dibuat', created_at: iso(6) },
  { id: 2, order_id: ORDER_ID, status: 'accepted', actor_id: UID_AHMAD, note: 'Driver Ahmad Fauzi menerima order', created_at: iso(3) },
];
const promos = [
  { code: 'HEMAT5', title: 'Hemat 5rb tiap hari', description: 'Diskon Rp5.000 untuk AntarRide & AntarCar', discount_type: 'fixed', value: 5000, max_discount: null, min_total: 15000, service: 'ride_motor', quota: null, used_count: 12, valid_from: null, valid_to: null, is_active: true, image_url: '/promos/HEMAT5.jpg', sort_order: 1 },
  { code: 'MAKANENAK', title: 'Makan enak diskon 20%', description: 'AntarFood, maks. Rp15.000', discount_type: 'percent', value: 20, max_discount: 15000, min_total: 30000, service: 'food', quota: null, used_count: 40, valid_from: null, valid_to: null, is_active: true, image_url: '/promos/MAKANENAK.jpg', sort_order: 2 },
  { code: 'ANTARKOTA', title: 'Travel antar kota', description: 'Potongan Rp20.000 booking AntarTravel', discount_type: 'fixed', value: 20000, max_discount: null, min_total: 100000, service: 'travel', quota: null, used_count: 3, valid_from: null, valid_to: null, is_active: true, image_url: '/promos/ANTARKOTA.jpg', sort_order: 3 },
];
const merchantsDekat = [
  { id: MERCHANT_ID, owner_id: null, name: 'Sate Padang Mak Syukur', description: null, category: 'Masakan Padang', address: 'Jl. Pemuda No. 12', lat: -0.9500, lng: 100.3650, image_url: null, is_open: true, status: 'approved', rating_avg: 4.8, rating_count: 320, prep_minutes: 15, opening_hours: null, created_at: iso(9999), distance_km: 1.2, delivery_fee: 8000, is_halal: true, halal_verified: true },
  { id: 'dddddddd-0000-4000-8000-000000000014', owner_id: null, name: 'Kopi Kubik', description: null, category: 'Kopi & minuman', address: 'Jl. Veteran No. 3', lat: -0.9460, lng: 100.4100, image_url: null, is_open: true, status: 'approved', rating_avg: 4.7, rating_count: 150, prep_minutes: 10, opening_hours: null, created_at: iso(9999), distance_km: 0.8, delivery_fee: 6000, is_halal: false, halal_verified: false },
  { id: 'dddddddd-0000-4000-8000-000000000024', owner_id: null, name: 'Bakso Urat Pak Min', description: null, category: 'Bakso & mie', address: 'Jl. Khatib Sulaiman', lat: -0.9420, lng: 100.4000, image_url: null, is_open: true, status: 'approved', rating_avg: 4.6, rating_count: 98, prep_minutes: 12, opening_hours: null, created_at: iso(9999), distance_km: 2.1, delivery_fee: 9000, is_halal: true, halal_verified: false },
];
const seringDipesan = {
  merchants: [{ merchant_id: MERCHANT_ID, name: 'Sate Padang Mak Syukur', image_url: null, category: 'Masakan Padang', rating_avg: 4.8, is_halal: true, halal_verified: true, is_open: true, count: 5, last_at: iso(60 * 24 * 2) }],
  routes: [{ service: 'ride_car', dropoff_address: TUJUAN.alamat, dropoff_lat: TUJUAN.lat, dropoff_lng: TUJUAN.lng, pickup_address: JEMPUT.alamat, pickup_lat: JEMPUT.lat, pickup_lng: JEMPUT.lng, shop_store: null, count: 3, last_at: iso(60 * 24 * 3) }],
  services: { ride_car: 3, food: 5 },
  recent: [{ address: 'Bandara Minangkabau, Ketaping, Padang Pariaman', lat: -0.7869, lng: 100.2806, service: 'ride_car' }],
};
const savedPlaces = [
  { id: 'ffffffff-0000-4000-8000-000000000006', user_id: UID_BUDI, label: 'Rumah', address: 'Jl. Sudirman No. 45, Padang', lat: JEMPUT.lat, lng: JEMPUT.lng },
];
const kelas = (code, label, description, multiplier, rank, drivers, is_ev = false, seats = 4) => ({ code, label, description, is_ev, seats, rank, multiplier, fare: Math.round(19000 * multiplier / 500) * 500, total: Math.round(19000 * multiplier / 500) * 500 + 2000, drivers_nearby: drivers });
const fareOptions = (service, km) => ({
  distance_km: km, straight_km: Math.round(km / 1.3 * 100) / 100, fare: 19000, platform_fee: 2000, total: 21000, duration_min: Math.max(3, Math.round(km / 25 * 60)), limit: null, service_enabled: true, demand: null, session: null, helpers_fee: 0,
  classes: service === 'ride_car'
    ? [kelas('car_economy', 'Hemat', 'Mobil kecil, 1–3 penumpang', 0.85, 1, 4), kelas('car_standard', 'Standar', 'MPV nyaman, 1–4 penumpang', 1, 2, 7), kelas('car_premium', 'Premium', 'Mobil premium, sopir berpengalaman', 1.4, 3, 2), kelas('car_ev', 'Listrik', 'Mobil listrik, ramah lingkungan', 1.1, 2, 1, true)]
    : [kelas('motor_economy', 'Hemat', 'Motor bebek/matic', 0.6, 1, 9, false, null), kelas('motor_standard', 'Standar', 'Motor matic 125cc+, helm bersih', 0.7, 2, 14, false, null), kelas('motor_ev', 'Listrik', 'Motor listrik, senyap', 0.75, 2, 3, true, null)],
});
const orderTersedia = [
  { id: 'cccccccc-0000-4000-8000-000000000013', code: 'AK2609150051', service: 'ride_car', pickup_address: 'RS M. Djamil, Jl. Perintis Kemerdekaan, Padang', dropoff_address: 'Pantai Air Manis, Padang Selatan', pickup_lat: -0.9402, pickup_lng: 100.4262, dropoff_lat: -0.9780, dropoff_lng: 100.3620, distance_km: 8.1, fare_delivery: 18000, items_subtotal: 0, total: 20000, driver_earning: 16200, payment_method: 'wallet', merchant_status: null, created_at: iso(1), distance_to_pickup_km: 0.7, merchant_name: null, vehicle_class: 'car_standard', helpers: 0, scheduled_at: null, send_scope: null, priority_note: null },
  { id: 'cccccccc-0000-4000-8000-000000000023', code: 'AK2609150052', service: 'send', pickup_address: 'Jl. Khatib Sulaiman No. 8, Padang Utara', dropoff_address: 'Jl. Bypass KM 9, Kuranji, Padang', pickup_lat: -0.9524, pickup_lng: 100.4098, dropoff_lat: -0.9150, dropoff_lng: 100.4130, distance_km: 4.6, fare_delivery: 22000, items_subtotal: 0, total: 24000, driver_earning: 19800, payment_method: 'cash', merchant_status: null, created_at: iso(2), distance_to_pickup_km: 1.3, merchant_name: null, vehicle_class: null, helpers: 0, scheduled_at: null, send_scope: 'in_city', priority_note: null },
];
const walletTx = [
  { id: 'aaaaaaaa-0000-4000-8000-000000000101', user_id: UID_BUDI, type: 'payment', amount: -21000, balance_after: 250000, order_id: ORDER_ID, note: `AntarCar ${ORDER_CODE}`, created_at: iso(6) },
  { id: 'aaaaaaaa-0000-4000-8000-000000000102', user_id: UID_BUDI, type: 'topup', amount: 200000, balance_after: 271000, order_id: null, note: 'Top up via GoPay', created_at: iso(60 * 24 * 1) },
  { id: 'aaaaaaaa-0000-4000-8000-000000000103', user_id: UID_BUDI, type: 'refund', amount: 12000, balance_after: 71000, order_id: null, note: 'Pengembalian pesanan dibatalkan', created_at: iso(60 * 24 * 4) },
];
const notifikasi = [
  { id: 1, user_id: UID_BUDI, kind: 'order', title: 'Driver menuju lokasi Anda', body: 'Ahmad Fauzi · Toyota Avanza BA 1234 AB', image_url: null, promo_code: null, merchant_id: null, data: { order_id: ORDER_ID, code: ORDER_CODE }, read_at: null, created_at: iso(3) },
  { id: 2, user_id: UID_BUDI, kind: 'promo', title: 'Hemat 5rb tiap hari', body: 'Pakai kode HEMAT5 untuk AntarRide & AntarCar', image_url: null, promo_code: 'HEMAT5', merchant_id: null, data: null, read_at: iso(60 * 24), created_at: iso(60 * 24 * 2) },
];

// ------------------------------------------------------------------------------------ REST & RPC
const eqParam = (q, key) => { const v = q.get(key); return v && v.startsWith('eq.') ? v.slice(3) : null; };
function tabel(nama, q, app) {
  switch (nama) {
    case 'profiles': { const id = eqParam(q, 'id'); return id ? [profil[id]].filter(Boolean) : Object.values(profil); }
    case 'drivers': {
      const id = eqParam(q, 'id');
      if (app === 'mitra') return id === UID_BUDI || !id ? [driverRow(UID_BUDI)] : id === UID_AHMAD ? [driverRow(UID_AHMAD)] : [];
      return id === UID_AHMAD ? [driverRow(UID_AHMAD)] : [];
    }
    case 'wallets': return [wallet];
    case 'merchants': case 'travel_partners': case 'market_vendors': return [];
    case 'orders': {
      const id = eqParam(q, 'id');
      if (id) return id === ORDER_ID ? [order] : [];
      if (app === 'mitra') return [{ ...order, driver_id: UID_BUDI }];
      return [order];
    }
    case 'order_events': return orderEvents;
    case 'order_pins': return [{ order_id: ORDER_ID, pin: '4821' }];
    case 'order_messages': case 'ratings': case 'topup_requests': case 'withdrawal_requests': return [];
    case 'wallet_transactions': return walletTx;
    case 'promos': return promos;
    case 'saved_places': return savedPlaces;
    case 'notifications': return notifikasi;
    case 'payment_prefs': return [{ user_id: UID_BUDI, default_method: 'ewallet', ewallet: 'gopay', updated_at: iso(60) }];
    case 'app_settings': return [{ key: 'direct_order_hold_seconds', value: 90 }, { key: 'direct_order_fallback', value: true }];
    default: return [];
  }
}
function rpcMock(fn, body) {
  switch (fn) {
    case 'app_public_settings': return { services_enabled: {}, max_km: {}, osm_import_enabled: true, osm_import_radius_km: 5, pickup_radius_km: {}, send_limits: null, priority_tiers: [{ min_rating: 4.8, delay_s: 0 }, { min_rating: 4.5, delay_s: 10 }, { min_rating: 0, delay_s: 20 }], wait_apology_minutes: 5 };
    case 'map_public_config': return { tile_provider: 'osm_free', tile_url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', tile_attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', tile_max_zoom: 19, geocode_provider: 'osm_free', route_provider: 'osm_free', autocomplete_min_chars: 4, autocomplete_debounce_ms: 700, defer_routing: true, refit_min_meters: 150, driver_poll_ms: 10000, track_max_zoom: 16, uses_free_osm: true };
    case 'city_service_status': return { ok: true, in_range: true, status: 'aktif', city_id: 'padang', city_name: 'Padang', province: 'Sumatera Barat', distance_km: 0.4, services: {}, open_labels: [], closed_labels: [] };
    case 'nearby_merchants': return merchantsDekat;
    case 'customer_frequent': return seringDipesan;
    case 'resolve_address': {
      const { p_lat, p_lng } = body ?? {};
      const dekat = (t) => Math.abs(p_lat - t.lat) < 0.0015 && Math.abs(p_lng - t.lng) < 0.0015;
      return { hit: true, address: dekat(TUJUAN) ? TUJUAN.alamat : dekat(JEMPUT) ? JEMPUT.alamat : `Jl. Veteran No. 12, Padang Barat, Kota Padang` };
    }
    case 'cache_address': return null;
    case 'my_blocks': return [];
    case 'fare_options': return fareOptions(body?.p_service ?? 'ride_motor', body?.p_route_km ?? 6.4);
    case 'driver_available_orders': return orderTersedia;
    case 'driver_priority_info': return { rating: 4.9, rating_count: 213, tier_delay_s: 0, next_tier_rating: null, is_new_driver: false, drivers_ahead: 0, tiers: [{ min_rating: 4.8, delay_s: 0 }, { min_rating: 4.5, delay_s: 10 }, { min_rating: 0, delay_s: 20 }] };
    case 'driver_my_code': return { code: 'BUDI42', orders_direct_today: 2, share_text: 'Pesan saya langsung di AntarKita dengan kode BUDI42' };
    case 'driver_update_location': case 'notifications_mark_read': case 'register_push_token': return null;
    case 'driver_set_online': return driverRow(UID_BUDI);
    default: return null;
  }
}

// -------------------------------------------------------------------------- basemap prosedural
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function hash(...n) { let h = 2166136261; for (const v of n) { h ^= (v | 0) + 0x9e3779b9; h = Math.imul(h, 16777619); h ^= h >>> 13; } return (h >>> 0) / 4294967296; }
function tileSvg(z, x, y) {
  // Jarak antar jalan mengikuti zoom (z16 ≈ 95 px, z14 ≈ 47 px) supaya kepadatan blok masuk akal.
  const S = 256, SX = clamp(95 * 2 ** ((z - 16) / 2), 40, 300), SY = SX * 0.88;
  const gx0 = x * S, gy0 = y * S;
  const el = [`<rect width="${S}" height="${S}" fill="#ECE8DD"/>`];
  const cols = [], rows = [];
  for (let c = Math.floor((gx0 - SX) / SX); c <= Math.floor((gx0 + S + SX) / SX); c++) cols.push({ i: c, p: c * SX + hash(z, c, 7) * SX * 0.5 });
  for (let r = Math.floor((gy0 - SY) / SY); r <= Math.floor((gy0 + S + SY) / SY); r++) rows.push({ i: r, p: r * SY + hash(z, r, 11) * SY * 0.5 });
  // blok: taman & bangunan
  for (let ci = 0; ci < cols.length - 1; ci++) for (let ri = 0; ri < rows.length - 1; ri++) {
    const c = cols[ci], r = rows[ri];
    const x0 = c.p - gx0 + 8, x1 = cols[ci + 1].p - gx0 - 8, y0 = r.p - gy0 + 8, y1 = rows[ri + 1].p - gy0 - 8;
    if (x1 <= x0 || y1 <= y0) continue;
    const h = hash(z, c.i, r.i);
    if (h < 0.11) { el.push(`<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" rx="6" fill="#CFE6C3"/>`); continue; }
    const n = SX < 60 ? 1 : 1 + Math.floor(hash(z, c.i, r.i, 3) * 3);
    for (let k = 0; k < n; k++) {
      const bw = (x1 - x0) * (0.25 + hash(z, c.i, r.i, k, 1) * 0.4), bh = (y1 - y0) * (0.25 + hash(z, c.i, r.i, k, 2) * 0.4);
      const bx = x0 + hash(z, c.i, r.i, k, 4) * (x1 - x0 - bw), by = y0 + hash(z, c.i, r.i, k, 5) * (y1 - y0 - bh);
      el.push(`<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="2" fill="#F4F1E9" stroke="#DCD6C8" stroke-width="0.8"/>`);
    }
  }
  // jalan
  for (const c of cols) { const major = c.i % 4 === 0; el.push(`<line x1="${c.p - gx0}" y1="0" x2="${c.p - gx0}" y2="${S}" stroke="${major ? '#FBE9A6' : '#FFFFFF'}" stroke-width="${major ? 9 : 5}"/>`); }
  for (const r of rows) { const major = r.i % 3 === 0; el.push(`<line x1="0" y1="${r.p - gy0}" x2="${S}" y2="${r.p - gy0}" stroke="${major ? '#FBE9A6' : '#FFFFFF'}" stroke-width="${major ? 9 : 5}"/>`); }
  // sungai: kurva halus dalam koordinat piksel global (lebar mengikuti zoom)
  const latR = -0.9585; const n = 2 ** z;
  const riverY = (1 - Math.log(Math.tan(latR * Math.PI / 180) + 1 / Math.cos(latR * Math.PI / 180)) / Math.PI) / 2 * n * S;
  const amp = 260, lam = 900;
  const pts = [];
  for (let px = -20; px <= S + 20; px += 16) { const gx = gx0 + px; pts.push(`${px},${(riverY + amp * Math.sin(gx / lam) - gy0).toFixed(1)}`); }
  const w = clamp(6 * 2 ** (z - 14), 3, 40);
  if (Math.abs(riverY - gy0) < amp + S + 60) el.push(`<polyline points="${pts.join(' ')}" fill="none" stroke="#A8D4E6" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">${el.join('')}</svg>`;
}

// ------------------------------------------------------------------------------------ intersep
async function pasangIntersep(context, app) {
  const uid = UID_BUDI;
  const sesi = sesiPalsu(uid, 'budi@contoh.id', 'Budi Santoso');
  await context.addInitScript(({ key, sesi, mode }) => {
    try {
      localStorage.setItem(key, JSON.stringify(sesi));
      if (mode) localStorage.setItem('antaraja.mode', mode);
      localStorage.setItem('antaraja.locale', 'id');
    } catch { /* noop */ }
  }, { key: STORAGE_KEY, sesi, mode: app === 'mitra' ? 'driver' : null });

  const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers: { 'access-control-allow-origin': '*' } });
  await context.route('**/*.supabase.co/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (p.startsWith('/auth/v1/user')) return json(route, sesi.user);
    if (p.startsWith('/auth/v1/token')) return json(route, sesi);
    if (p.startsWith('/auth/v1/logout')) return route.fulfill({ status: 204 });
    if (p.startsWith('/auth/v1/health')) return json(route, { name: 'GoTrue', version: 'tiruan' });
    if (p.startsWith('/rest/v1/rpc/')) {
      const fn = p.slice('/rest/v1/rpc/'.length);
      let body = null; try { body = JSON.parse(req.postData() || 'null'); } catch { /* noop */ }
      const out = rpcMock(fn, body);
      if (out === null && !TAHU_RPC.has(fn)) console.log(`   · rpc tak dikenal → null: ${fn}`);
      return json(route, out);
    }
    if (p.startsWith('/rest/v1/')) {
      const nama = p.slice('/rest/v1/'.length).split('/')[0];
      const accept = req.headers()['accept'] ?? '';
      if (req.method() !== 'GET') return json(route, [], req.method() === 'POST' ? 201 : 200);
      const rows = tabel(nama, url.searchParams, app);
      if (accept.includes('pgrst.object')) return rows.length ? json(route, rows[0]) : json(route, { code: 'PGRST116', message: 'no rows' }, 406);
      return json(route, rows);
    }
    if (p.startsWith('/storage/')) return route.fulfill({ status: 404 });
    return route.fulfill({ status: 204 });
  });
  const TAHU_RPC = new Set(['cache_address', 'driver_update_location', 'notifications_mark_read', 'register_push_token']);

  // Ubin peta → basemap prosedural (tile.openstreetmap.org diblokir di lingkungan build).
  await context.route(/\/(\d+)\/(\d+)\/(\d+)\.png(\?.*)?$/, async (route) => {
    const m = route.request().url().match(/\/(\d+)\/(\d+)\/(\d+)\.png/);
    try { return await route.fulfill({ status: 200, contentType: 'image/svg+xml', body: tileSvg(+m[1], +m[2], +m[3]) }); }
    catch (e) { console.log(`   · ubin gagal: ${e.message}`); return route.abort(); }
  });
  // Penyedia geocoding/rute gratis & layanan pihak ketiga lain: jangan pernah keluar jaringan.
  await context.route(/nominatim\.openstreetmap\.org|router\.project-osrm\.org|photon\.komoot\.io|maps\.googleapis\.com|api\.stadiamaps\.com|api\.mapbox\.com|gstatic\.com|googleapis\.com/, (route) => route.abort());
  // Realtime (WebSocket): terima koneksi tanpa server supaya klien tidak terus mencoba ulang.
  await context.routeWebSocket(/realtime\/v1/, () => {});
}

// ------------------------------------------------------------------------------------ layar
const tunggu = (ms) => new Promise((r) => setTimeout(r, ms));
async function siap(page, teks, extraMs = 2500) {
  await page.getByText(teks, { exact: false }).first().waitFor({ timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
  await tunggu(extraMs);
}
/** Geser sheet (pegangan di tengah bawah) ke atas supaya isi kartu terlihat. */
async function tarikSheet(page, dariY, keY) {
  const x = 206;
  await page.addStyleTag({ content: '* { user-select: none !important; -webkit-user-select: none !important; }' }); // tarikan mouse jangan menyorot teks
  await page.mouse.move(x, dariY); await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(x, dariY + (keY - dariY) * i / 12);
  await page.mouse.up();
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await tunggu(1200);
}

const LAYAR = [
  { nama: 'p-beranda', app: 'pelanggan', path: '/', async isi(page) { await siap(page, 'Mau ke mana?'); } },
  { nama: 'p-ride', app: 'pelanggan', path: '/ride?service=ride_motor', async isi(page) {
    await siap(page, 'Tujuan terakhir', 1500);
    // pilih tujuan "Plaza Andalas" supaya kelas kendaraan & estimasi tarif tampil (seperti di HP)
    await page.getByText('Plaza Andalas', { exact: false }).first().click();
    await siap(page, 'Total estimasi', 2500);
  } },
  { nama: 'p-ride-peta', app: 'pelanggan', path: '/place-picker?target=pickup&title=Titik%20jemput&mode=map', async isi(page) { await siap(page, 'Lokasi terpilih', 3500); } },
  { nama: 'p-lacak', app: 'pelanggan', path: `/order/${ORDER_ID}`, async isi(page) {
    await siap(page, 'Ahmad Fauzi', 3000);
    if (process.env.LACAK_BUKA) await tarikSheet(page, 892 - 205, 892 - 470);
  } },
  { nama: 'p-pay', app: 'pelanggan', path: '/pay', async isi(page) { await siap(page, 'Saldo AntarPay'); } },
  { nama: 'm-beranda', app: 'mitra', path: '/mitra/', async isi(page) { await siap(page, 'order tersedia', 3500); } },
  { nama: 'm-order', app: 'mitra', path: `/mitra/driver/order/${ORDER_ID}`, async isi(page) {
    await siap(page, 'Budi Santoso', 3000);
    await tarikSheet(page, 892 - 215, 892 - 560);
  } },
  { nama: 'm-account', app: 'mitra', path: '/mitra/(driver)/account', async isi(page) { await siap(page, 'Akun Mitra'); } },
  // Bukan untuk listing: bukti layar moderasi UGC (Akun → Pengguna diblokir) untuk formulir Play Console.
  { nama: 'bukti-ugc-blokir', app: 'pelanggan', path: '/account/blocks', async isi(page) { await siap(page, 'diblokir', 2000); }, keluaran: path.join(HERE, 'screenshot', 'bukti-ugc-blokir.png') },
];

(async () => {
  const { srv, base } = await serveDist();
  const browser = await chromium.launch({ headless: true, args: ['--disable-gpu', '--font-render-hinting=none'] });
  fs.mkdirSync(OUT, { recursive: true });
  const gagal = [];
  for (const L of LAYAR) {
    if (HANYA && !HANYA.has(L.nama)) continue;
    const context = await browser.newContext({
      viewport: { width: 412, height: 892 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
      locale: 'id-ID', timezoneId: 'Asia/Jakarta', geolocation: L.app === 'mitra' ? { latitude: DRIVER_POS.lat, longitude: DRIVER_POS.lng, accuracy: 12 } : { latitude: PADANG.lat, longitude: PADANG.lng, accuracy: 12 }, permissions: ['geolocation'],
      colorScheme: 'light', reducedMotion: 'no-preference',
    });
    await pasangIntersep(context, L.app);
    const page = await context.newPage();
    // Jam dimulai dari WAKTU tetapi TETAP BERJALAN (bukan setFixedTime: Leaflet menghitung fade-in ubin
    // dari +new Date(), jadi jam yang beku membuat semua ubin peta tinggal di opacity 0 → peta abu-abu).
    await page.clock.install({ time: WAKTU });
    page.on('pageerror', (e) => console.log(`   · pageerror: ${e.message}`));
    if (process.env.DEBUG_JARINGAN) {
      page.on('requestfailed', (r) => console.log(`   · gagal: ${r.url()} ${r.failure()?.errorText ?? ''}`));
      page.on('request', (r) => { if (!r.url().startsWith('http://127.0.0.1')) console.log(`   · req: ${r.method()} ${r.url().slice(0, 140)}`); });
      page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`   · konsol[${m.type()}]: ${m.text().slice(0, 200)}`); });
    }
    const keluaran = L.keluaran ?? path.join(OUT, `${L.nama}.png`);
    process.stdout.write(`▶ ${L.nama}  ${L.path}\n`);
    try {
      await page.goto(base + L.path, { waitUntil: 'load' });
      await L.isi(page);
      if (process.env.DEBUG_JARINGAN) console.log('   · ubin:', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('img.leaflet-tile')].slice(0, 4).map((i) => ({ src: i.src.slice(-22), ok: i.complete, w: i.naturalWidth, cls: i.className, st: i.getAttribute('style')?.slice(0, 80), cw: i.clientWidth })))));
      await page.screenshot({ path: keluaran, type: 'png' });
      console.log(`   ✔ ${path.relative(ROOT, keluaran)}`);
    } catch (e) {
      gagal.push(L.nama);
      const dbg = path.join(OUT, `_gagal-${L.nama}.png`);
      await page.screenshot({ path: dbg, type: 'png' }).catch(() => {});
      console.log(`   ✖ ${L.nama}: ${e.message.split('\n')[0]} (lihat ${path.relative(ROOT, dbg)})`);
    }
    await context.close();
  }
  await browser.close();
  srv.close();
  if (gagal.length) { console.log(`\n${gagal.length} layar gagal: ${gagal.join(', ')}`); process.exit(1); }
  console.log('\nSelesai. Lanjutkan: python3 docs/rilis/aset/bingkai-screenshot.py');
})();
