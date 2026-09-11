// Server uji gerbang wilayah: melayani halaman harness + meniru RPC Supabase
// dengan ATURAN YANG SAMA seperti migrasi 0076–0080.
//
// Yang ditiru:
//   POST /mock/rpc/city_service_status → cerminan city_service_status(p_lat, p_lng)
//   POST /mock/rpc/city_waitlist_join  → cerminan city_waitlist_join(...)
//   POST /mock/rpc/create_order        → cerminan create_order(): MENOLAK pesanan dari kota
//                                        yang layanannya belum dibuka. Inilah yang membuktikan
//                                        penegakan tidak bergantung pada UI.
//   POST /mock/admin/set_city          → yang dilakukan Panel Admin saat pemilik membuka kota
//   POST /mock/fail                    → memaksa RPC status gagal (menguji sifat gagal-aman)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4281);

const SERVICES = ['ride_motor', 'ride_car', 'food', 'send', 'shop', 'box', 'travel', 'market'];
const LABEL = {
  ride_motor: 'AntarRide', ride_car: 'AntarCar', food: 'AntarFood', send: 'AntarSend',
  shop: 'AntarShop', box: 'AntarBox', travel: 'AntarTravel', market: 'AntarMarket',
};

// --- "basis data" kota: persis nilai awal migrasi 0079 -------------------------------
const allOn = () => Object.fromEntries(SERVICES.map((s) => [s, true]));
const allOff = () => Object.fromEntries(SERVICES.map((s) => [s, false]));
const START = () => [
  { id: 'c-pku', name: 'Pekanbaru', province: 'Riau', lat: 0.5071, lng: 101.4478, radius_km: 35, service_status: 'aktif', services: allOn() },
  { id: 'c-pdg', name: 'Padang', province: 'Sumatera Barat', lat: -0.9471, lng: 100.3543, radius_km: 35, service_status: 'aktif', services: allOn() },
  { id: 'c-mdn', name: 'Medan', province: 'Sumatera Utara', lat: 3.5952, lng: 98.6722, radius_km: 35, service_status: 'belum_dilayani', services: allOff() },
  { id: 'c-btm', name: 'Batam', province: 'Kepulauan Riau', lat: 1.0456, lng: 104.0305, radius_km: 35, service_status: 'segera', services: allOff() },
  { id: 'c-jkt', name: 'Jakarta', province: 'DKI Jakarta', lat: -6.2088, lng: 106.8456, radius_km: 35, service_status: 'belum_dilayani', services: allOff() },
];
let cities = START();
let waitlist = [];
let failStatus = false;   // paksa city_service_status gagal → menguji gagal-aman di klien

const R = 6371;
const rad = (d) => (d * Math.PI) / 180;
function distanceKm(aLat, aLng, bLat, bLng) {
  const dLat = rad(bLat - aLat), dLng = rad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
/**
 * Cerminan city_at_point() SESUDAH migrasi 0081 — BERTINGKAT, bukan sekadar "terdekat":
 *   (1) kota yang MELAYANI ('aktif') dan titiknya ada di dalam radiusnya;
 *   (2) kota KURASI MANUSIA (source 'admin') yang mencakup titik — supaya baris
 *       gazetteer hasil impor OSM tidak pernah menutupi nama kota yang dikenal
 *       pelanggan, walau kota itu belum dilayani;
 *   (3) baru kota terdekat mana pun.
 * `active` tetap tidak disaring: kota tertutup pun perlu DISEBUT namanya.
 */
function cityAtPoint(lat, lng) {
  let best = null, bestRank = -1;
  for (const c of cities) {
    const d = distanceKm(lat, lng, c.lat, c.lng);
    const didalam = d <= (c.radius_km ?? 35);
    const rank = c.service_status === 'aktif' && didalam ? 2 : (c.source ?? 'admin') === 'admin' && didalam ? 1 : 0;
    if (!best || rank > bestRank || (rank === bestRank && d < best.distance_km)) {
      best = { ...c, distance_km: Math.round(d * 100) / 100 };
      bestRank = rank;
    }
  }
  return best;
}

/** Cerminan city_service_status(): seluruh teksnya ditulis di server, seperti di SQL. */
function cityServiceStatus(lat, lng) {
  if (lat == null || lng == null) {
    return {
      ok: false, in_range: false, status: 'tidak_diketahui', services: {}, open_services: [], closed_services: [],
      waitlist_open: false, city_id: null, city_name: null, province: null, distance_km: null,
      headline: 'Lokasi Anda belum diketahui',
      body: 'Nyalakan izin lokasi supaya kami bisa memastikan AntarKita sudah melayani daerah Anda.',
    };
  }
  const c = cityAtPoint(lat, lng);
  if (!c || c.distance_km > c.radius_km) {
    return {
      ok: false, in_range: false, status: 'luar_jangkauan', services: {}, open_services: [], closed_services: [],
      waitlist_open: true, city_id: c?.id ?? null, city_name: c?.name ?? null, province: c?.province ?? null,
      distance_km: c?.distance_km ?? null,
      headline: 'AntarKita belum menjangkau lokasi ini',
      body: c
        ? `Lokasi Anda sekitar ${Math.round(c.distance_km)} km dari ${c.name} — masih di luar wilayah layanan terdekat kami. Anda tetap bisa menelusuri data tempat, tetapi pesanan belum bisa dibuat dari sini.`
        : 'Lokasi Anda berada jauh dari kota layanan AntarKita mana pun. Anda tetap bisa menelusuri data tempat, tetapi pesanan belum bisa dibuat dari sini.',
    };
  }
  // Gagal-tertutup: kota harus 'aktif' DAN layanannya punya sakelar menyala.
  const services = Object.fromEntries(SERVICES.map((s) => [s, c.service_status === 'aktif' && !!c.services[s]]));
  const open = SERVICES.filter((s) => services[s]).map((s) => LABEL[s]).sort();
  const closed = SERVICES.filter((s) => !services[s]).map((s) => LABEL[s]).sort();
  const headline =
    c.service_status === 'aktif' && open.length > 0 && closed.length === 0 ? `AntarKita melayani ${c.name}`
    : c.service_status === 'aktif' && open.length > 0 ? `Sebagian layanan sudah dibuka di ${c.name}`
    : c.service_status === 'aktif' ? `Layanan di ${c.name} sedang ditutup sementara`
    : c.service_status === 'segera' ? `AntarKita segera hadir di ${c.name}`
    : `AntarKita belum melayani ${c.name}`;
  const body =
    c.service_status === 'aktif' && open.length > 0 && closed.length === 0 ? 'Semua layanan tersedia di kota Anda.'
    : c.service_status === 'aktif' && open.length > 0 ? `Sudah bisa dipakai: ${open.join(', ')}. Belum dibuka: ${closed.join(', ')} — kami sedang menambah driver untuk layanan itu.`
    : c.service_status === 'aktif' ? 'Semua layanan di kota ini sedang ditutup sementara. Silakan coba lagi nanti.'
    : c.service_status === 'segera' ? `Kami sedang menyiapkan driver di ${c.name}. Data tempat sudah bisa Anda telusuri; pesanan dibuka begitu driver siap. Daftar sekarang supaya kami kabari lebih dulu.`
    : `Data tempat di ${c.name} sudah kami kumpulkan dan tetap bisa Anda telusuri, tetapi pesanan belum bisa dibuat karena driver belum tersedia di sini. Beri tahu kami kalau Anda membutuhkannya — kota dengan peminat terbanyak kami buka lebih dulu.`;
  return {
    ok: open.length > 0, in_range: true, status: c.service_status,
    city_id: c.id, city_name: c.name, province: c.province, distance_km: c.distance_km,
    services, open_services: open, closed_services: closed,
    waitlist_open: c.service_status !== 'aktif' || closed.length > 0,
    headline, body,
  };
}

/** Cerminan city_gate() — dipakai create_order tiruan. */
function cityGate(service, lat, lng) {
  if (lat == null || lng == null) return { ok: false, reason: 'tanpa_lokasi', message: 'Titik jemput belum lengkap. Pilih lokasi jemput lebih dulu.' };
  const c = cityAtPoint(lat, lng);
  if (!c) return { ok: false, reason: 'luar_jangkauan', message: 'AntarKita belum melayani wilayah ini. Belum ada kota layanan kami di sekitar titik jemput Anda.' };
  if (c.distance_km > c.radius_km) {
    return { ok: false, reason: 'luar_jangkauan', city_name: c.name, message: `Titik jemput Anda sekitar ${Math.round(c.distance_km)} km dari ${c.name} — di luar wilayah layanan AntarKita. Pesanan hanya bisa dibuat dari dalam kota yang sudah kami layani.` };
  }
  if (c.service_status !== 'aktif') {
    const ekor = c.service_status === 'segera'
      ? ' Kota ini sedang kami siapkan — daftar di daftar tunggu supaya kami kabari begitu dibuka.'
      : ' Daftar di daftar tunggu supaya kota ini naik prioritas.';
    return { ok: false, reason: 'kota_tertutup', city_name: c.name, message: `AntarKita belum melayani ${c.name}. Data tempat tetap bisa Anda telusuri, tetapi pesanan belum bisa dibuat karena driver belum tersedia di sini.${ekor}` };
  }
  if (!c.services[service]) {
    const lain = SERVICES.filter((s) => c.services[s]).map((s) => LABEL[s]).sort().join(', ');
    return {
      ok: false, reason: 'layanan_tertutup', city_name: c.name,
      message: `${LABEL[service]} belum dibuka di ${c.name}.${lain ? ` Yang sudah bisa dipakai di sini: ${lain}.` : ' Belum ada layanan AntarKita yang dibuka di kota ini.'}`,
    };
  }
  return { ok: true, reason: 'aktif', city_id: c.id, city_name: c.name };
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const send = (code, body, type = 'application/json') => {
    res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };

  if (req.method === 'POST') {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString() || '{}') : {};

    if (url.pathname === '/mock/rpc/city_service_status') {
      if (failStatus) return send(500, { message: 'gangguan jaringan uji' });
      return send(200, cityServiceStatus(body.p_lat, body.p_lng));
    }

    if (url.pathname === '/mock/rpc/city_waitlist_mine') {
      const mine = waitlist.find((w) => w.city_id === body.p_city_id);
      return send(200, { joined: !!mine, services: mine?.services ?? null, total: waitlist.filter((w) => w.city_id === body.p_city_id).length });
    }

    if (url.pathname === '/mock/rpc/city_waitlist_join') {
      const c = cities.find((x) => x.id === body.p_city_id);
      if (!c) return send(400, { message: 'Kota tidak dikenali. Nyalakan izin lokasi atau pilih kota dulu.' });
      const idx = waitlist.findIndex((w) => w.city_id === c.id);      // dedup per (pengguna, kota)
      const row = { city_id: c.id, city_name: c.name, services: body.p_services ?? [], note: body.p_note ?? null, at: Date.now() };
      if (idx >= 0) waitlist[idx] = row; else waitlist.push(row);
      return send(200, {
        ok: true, city_id: c.id, city_name: c.name, total: waitlist.filter((w) => w.city_id === c.id).length,
        message: `Terima kasih! Kami akan mengabari Anda begitu AntarKita membuka layanan di ${c.name}.`,
      });
    }

    // Inilah jalur yang dipakai "penyerang" yang melewati UI dan memanggil RPC langsung.
    if (url.pathname === '/mock/rpc/create_order') {
      const p = body.p ?? {};
      const gate = cityGate(p.service, p.pickup?.lat, p.pickup?.lng);
      if (!gate.ok) return send(400, { message: gate.message });
      return send(200, { id: 'o-1', code: 'AA-UJI-1', status: 'searching' });
    }

    // Panel Admin: buka kota untuk sebagian layanan (admin_set_city_status)
    if (url.pathname === '/mock/admin/set_city') {
      const c = cities.find((x) => x.id === body.city_id || x.name === body.city);
      if (!c) return send(404, { message: 'Kota tidak ditemukan' });
      if (body.status === 'aktif' && (!body.services || body.services.length === 0)) {
        return send(400, { message: 'Membuka kota harus menyebut layanan mana yang dibuka. Tidak ada layanan yang dipilih.' });
      }
      c.service_status = body.status;
      c.services = Object.fromEntries(SERVICES.map((s) => [s, body.status === 'aktif' && (body.services ?? []).includes(s)]));
      return send(200, { ok: true, services: c.services });
    }

    if (url.pathname === '/mock/fail') { failStatus = !!body.on; return send(200, { ok: true, failStatus }); }
    if (url.pathname === '/mock/reset') { cities = START(); waitlist = []; failStatus = false; return send(200, { ok: true }); }
    return send(404, { message: 'not found' });
  }

  if (url.pathname === '/mock/state') return send(200, { cities, waitlist, failStatus });

  const file = url.pathname === '/' ? '/harness.html' : url.pathname;
  try {
    const buf = await readFile(join(here, file.replace(/^\/+/, '')));
    return send(200, buf.toString(), MIME[extname(file)] ?? 'application/octet-stream');
  } catch {
    return send(404, 'tidak ditemukan', 'text/plain; charset=utf-8');
  }
});

server.listen(PORT, () => console.log(`harness kota: http://localhost:${PORT}`));
