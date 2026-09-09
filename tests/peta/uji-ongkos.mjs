// Uji regresi ONGKOS untuk penundaan rute (defer_routing).
//
// Kenapa berkas ini ada:
//   `create_order` MENGHITUNG ULANG ongkos di server dari `route_km` yang dikirim klien
//   (0002_functions_rls.sql:196 → estimate_fare(..., (p->>'route_km')::numeric)).
//   Sejak `defer_routing` menyala, tarif yang DILIHAT pengguna dihitung dari jarak
//   PRATINJAU (garis lurus × 1,3), sedangkan rute sungguhan baru diambil saat tombol
//   pesan ditekan. Bila jarak rute sungguhan ikut dikirim sebagai `route_km`, pelanggan
//   ditagih berbeda dari yang ditampilkan — rute jalan hampir tidak pernah tepat 1,3×.
//
// Yang dijaga uji ini (memakai src/lib/geo.ts YANG SEBENARNYA):
//   A. Pratinjau tidak memanggil penyedia rute sama sekali.
//   B. finalizeRoute() mengembalikan route_km yang SAMA PERSIS dengan jarak pratinjau
//      yang menjadi dasar harga — inilah yang membuat tagihan == yang ditampilkan.
//   C. finalizeRoute() tetap mengembalikan GEOMETRI rute sungguhan untuk
//      orders.route_geometry (bukan garis lurus dua titik).
//   D. Tanpa pratinjau, route_km dikirim null (server memakai bawaan 1,3× garis lurus,
//      yaitu angka yang juga dipakai saat tarif ditampilkan).
//
// Jalankan: node tests/peta/uji-ongkos.mjs
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const out = join(here, 'build-ongkos');

let lulus = 0, gagal = 0;
const ok = (nama, syarat, detail = '') => {
  if (syarat) { lulus++; console.log(`[OK]    ${nama}${detail ? ' — ' + detail : ''}`); }
  else { gagal++; console.error(`[GAGAL] ${nama}${detail ? ' — ' + detail : ''}`); }
};

// --- kompilasi modul aplikasi yang sebenarnya -----------------------------------------
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const REWRITE = { './supabase': './supabase.js', './mapConfig': './mapConfig.js', './types': './types.js',
  react: './react.js', 'react-native': './react-native.js',
  '@react-native-async-storage/async-storage': './async-storage.js', zustand: './zustand.js' };

function compile(srcRel, outRel) {
  const js = ts.transpileModule(readFileSync(join(root, srcRel), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ES2020, target: ts.ScriptTarget.ES2020, isolatedModules: true },
    fileName: srcRel,
  }).outputText;
  writeFileSync(join(out, outRel), js.replace(/(from\s+|import\s*\()\s*(['"])([^'"]+)\2/g,
    (m, pre, q, spec) => `${pre}${q}${REWRITE[spec] ?? spec}${q}`));
}
compile('src/lib/mapConfig.ts', 'mapConfig.js');
compile('src/lib/geo.ts', 'geo.js');

writeFileSync(join(out, 'types.js'), 'export {};\n');
writeFileSync(join(out, 'react.js'), 'export function useEffect() {}\nexport default { useEffect };\n');
writeFileSync(join(out, 'react-native.js'), `
export const AppState = { addEventListener() { return { remove() {} }; } };
export const Platform = { OS: 'web' };
`);
writeFileSync(join(out, 'async-storage.js'), 'export default { async getItem() { return null; }, async setItem() {} };\n');
writeFileSync(join(out, 'zustand.js'), `
export function create(init) {
  let state; const set = (p) => { state = { ...state, ...(typeof p === 'function' ? p(state) : p) }; };
  const get = () => state; state = init(set, get);
  const useStore = (sel) => (sel ? sel(state) : state);
  useStore.getState = get; useStore.setState = set; return useStore;
}
`);
// map_public_config seperti migrasi 0061 (bawaan: defer_routing menyala, penyedia osm_free)
writeFileSync(join(out, 'supabase.js'), `
export async function rpc(fn) {
  if (fn === 'map_public_config') return {
    tile_provider: 'osm_free', tile_url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    tile_attribution: '© OpenStreetMap contributors', tile_max_zoom: 19,
    geocode_provider: 'osm_free', geocode_key: null, route_provider: 'osm_free', route_key: null,
    autocomplete_min_chars: 4, autocomplete_debounce_ms: 700, defer_routing: true,
    refit_min_meters: 150, driver_poll_ms: 10000, track_max_zoom: 16, uses_free_osm: true,
  };
  throw new Error('rpc ' + fn + ' tidak ditiru');
}
export const supabase = {};
export function realtimeChannel() { return { on() { return this; }, subscribe() { return this; } }; }
`);

// --- penyedia rute tiruan --------------------------------------------------------------
// Rasio jalan 1,55× garis lurus: nilai realistis kota, dan sengaja BUKAN 1,3 supaya
// perbedaan antara pratinjau dan rute sungguhan benar-benar terlihat.
const RASIO_JALAN = 1.55;
let panggilanRute = 0;

function haversineKm(a, b) {
  const R = 6371, dLat = ((b.lat - a.lat) * Math.PI) / 180, dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes('router.project-osrm.org')) {
    panggilanRute++;
    const m = /driving\/([-\d.]+),([-\d.]+);([-\d.]+),([-\d.]+)/.exec(u);
    const a = { lng: +m[1], lat: +m[2] }, b = { lng: +m[3], lat: +m[4] };
    const km = haversineKm(a, b) * RASIO_JALAN;
    // geometri rute sungguhan: lebih dari dua titik (dibedakan dari garis lurus pratinjau)
    const geom = [[a.lng, a.lat], [(a.lng + b.lng) / 2 + 0.004, (a.lat + b.lat) / 2 + 0.004],
                  [(a.lng + b.lng) / 2 - 0.002, (a.lat + b.lat) / 2 + 0.001], [b.lng, b.lat]];
    return { ok: true, json: async () => ({ routes: [{ distance: km * 1000, duration: (km / 24) * 3600, geometry: { coordinates: geom } }] }) };
  }
  throw new Error('permintaan jaringan tak terduga: ' + u);
};

const geo = await import(pathToFileURL(join(out, 'geo.js')).href);

// --- 7 alur pemesanan yang disentuh tim peta -------------------------------------------
// (titik jemput → titik antar seperti di layar masing-masing)
const ALUR = [
  { nama: 'ride motor', a: { lat: 0.5071, lng: 101.4478 }, b: { lat: 0.4650, lng: 101.4020 } },
  { nama: 'ride car',   a: { lat: 0.5330, lng: 101.4470 }, b: { lat: 0.4820, lng: 101.3760 } },
  { nama: 'send',       a: { lat: 0.5071, lng: 101.4478 }, b: { lat: 0.5450, lng: 101.4700 } },
  { nama: 'box',        a: { lat: 0.4900, lng: 101.4200 }, b: { lat: 0.5600, lng: 101.4900 } },
  { nama: 'shop',       a: { lat: 0.5100, lng: 101.4300 }, b: { lat: 0.5000, lng: 101.4600 } },
  { nama: 'market',     a: { lat: 0.5200, lng: 101.4100 }, b: { lat: 0.4700, lng: 101.4500 } },
  { nama: 'food',       a: { lat: 0.5150, lng: 101.4400 }, b: { lat: 0.4950, lng: 101.4150 } },
];

console.log('uji-ongkos — pratinjau vs tagihan (defer_routing menyala)\n');

const kmDipakaiServer = [];
for (const f of ALUR) {
  panggilanRute = 0;

  // 1. PRATINJAU — persis yang dilakukan layar: getRoute() lalu tarif diminta dengan r.distance_km
  const pratinjau = await geo.getRoute(f.a, f.b);
  const kmDitampilkan = pratinjau.distance_km;      // ← jarak yang menjadi dasar harga yang DILIHAT pengguna
  ok(`${f.nama}: pratinjau tidak memanggil penyedia rute`, panggilanRute === 0 && pratinjau.estimated === true,
    `${kmDitampilkan} km (perkiraan)`);

  // 2. PESAN — finalizeRoute() dipanggil tepat sebelum create_order
  const fin = await geo.finalizeRoute(f.a, f.b, pratinjau);
  ok(`${f.nama}: rute sungguhan diambil saat memesan`, panggilanRute === 1, `${panggilanRute} panggilan`);

  // 3. UANG — route_km yang dikirim HARUS sama dengan yang menjadi dasar harga
  ok(`${f.nama}: route_km terkirim == jarak yang ditampilkan`, fin.route_km === kmDitampilkan,
    `ditampilkan ${kmDitampilkan} km · terkirim ${fin.route_km} km`);

  // 4. GEOMETRI — tetap rute sungguhan, bukan garis lurus dua titik
  const nyata = fin.coords && fin.coords.length > 2;
  ok(`${f.nama}: route_geometry berisi rute sungguhan`, nyata, `${fin.coords?.length ?? 0} titik`);

  kmDipakaiServer.push({ nama: f.nama, a: f.a, b: f.b, ditampilkan: kmDitampilkan, dikirim: fin.route_km });
}

// --- tanpa pratinjau (layar shop/market saat rute belum siap) ---------------------------
panggilanRute = 0;
const tanpa = await geo.finalizeRoute(ALUR[0].a, ALUR[0].b, null);
ok('tanpa pratinjau: route_km dikirim null (server pakai bawaan 1,3× yang sama dengan tarif tampil)',
  tanpa.route_km === null && tanpa.duration_min === null, `route_km=${tanpa.route_km}`);
ok('tanpa pratinjau: geometri tetap rute sungguhan', (tanpa.coords?.length ?? 0) > 2, `${tanpa.coords?.length ?? 0} titik`);

// --- pratinjau yang sudah rute sungguhan (defer_routing dimatikan pemilik) ---------------
panggilanRute = 0;
const sudahNyata = { distance_km: 9.99, duration_min: 21, coords: [[0.5, 101.4], [0.5, 101.41], [0.49, 101.42]], estimated: false };
const fin2 = await geo.finalizeRoute(ALUR[0].a, ALUR[0].b, sudahNyata);
ok('pratinjau sudah rute sungguhan: tidak ada panggilan rute tambahan', panggilanRute === 0, `${panggilanRute} panggilan`);
ok('pratinjau sudah rute sungguhan: route_km tetap angka yang ditampilkan', fin2.route_km === 9.99, `${fin2.route_km} km`);

rmSync(out, { recursive: true, force: true });

console.log(`\n${lulus} lulus, ${gagal} gagal`);
if (gagal) process.exit(1);

// Angka untuk pemeriksaan silang ke server (estimate_fare) — dicetak agar bisa diverifikasi
// manual bahwa ongkos dari `ditampilkan` dan `dikirim` benar-benar identik.
console.log('\nJarak yang dipakai server per alur (harus sama di kedua kolom):');
for (const r of kmDipakaiServer) console.log(`  ${r.nama.padEnd(12)} ditampilkan=${r.ditampilkan}  dikirim=${r.dikirim}`);
