// Uji end-to-end infrastruktur peta dengan Playwright (Chromium) + penyedia tiruan.
//
// Yang dibuktikan:
//   1. Peta tetap merender (Leaflet meminta ubin sungguhan dari URL konfigurasi).
//   2. Atribusi peta tampil dan berganti mengikuti penyedia.
//   3. Pencarian tempat jalan lewat adaptor penyedia yang benar.
//   4. Rute muncul (polyline tergambar) dan penundaan rute bekerja.
//   5. GANTI PENYEDIA DARI PANEL ADMIN BENAR-BENAR MENGUBAH URL UBIN YANG DIMINTA
//      — dibuktikan dari daftar permintaan jaringan, bukan dari kode.
//   6. Kunci rahasia penyedia tidak pernah sampai ke klien.
//   7. Penjaga fit ulang 150 m & nilai bawaan hemat bekerja.
//
// Jalankan:
//   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
//   NODE_PATH=$(npm root -g) node tests/peta/uji-peta.mjs
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

// playwright dipasang global (bukan dependensi npm proyek — proyek tidak menambah dependensi).
const require_ = createRequire(import.meta.url);
const { chromium } = require_(process.env.PLAYWRIGHT_MODULE || 'playwright');

const PORT = Number(process.env.PORT || 4260);
const BASE = `http://localhost:${PORT}`;

// PNG 1×1 transparan — jawaban untuk setiap permintaan ubin.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

let lulus = 0, gagal = 0;
const ok = (nama, syarat, detail = '') => {
  if (syarat) { lulus++; console.log(`[OK]    ${nama}${detail ? ' — ' + detail : ''}`); }
  else { gagal++; console.error(`[GAGAL] ${nama}${detail ? ' — ' + detail : ''}`); }
};

// --- jawaban tiruan penyedia ----------------------------------------------------------
const STADIA_AUTOCOMPLETE = { features: [
  { geometry: { coordinates: [101.4478, 0.5071] }, properties: { name: 'Jalan Jenderal Sudirman', label: 'Jalan Jenderal Sudirman, Pekanbaru, Riau, Indonesia' } },
  { geometry: { coordinates: [101.4501, 0.5099] }, properties: { name: 'Sudirman City Square', label: 'Sudirman City Square, Pekanbaru, Riau, Indonesia' } },
] };
const STADIA_REVERSE = { features: [{ properties: { name: 'Jalan Riau 12', label: 'Jalan Riau 12, Pekanbaru, Riau, Indonesia' } }] };
const PHOTON = { features: [{ geometry: { coordinates: [101.4478, 0.5071] }, properties: { name: 'Jalan Sudirman', city: 'Pekanbaru', state: 'Riau', countrycode: 'ID' } }] };
const NOMINATIM_REV = { display_name: 'Jalan Riau 12, Pekanbaru, Riau, 28112, Indonesia', name: 'Jalan Riau 12', address: { road: 'Jalan Riau', house_number: '12', city: 'Pekanbaru' } };
const OSRM = { routes: [{ distance: 2450, duration: 420, geometry: { coordinates: [[101.4478, 0.5071], [101.4520, 0.5110], [101.4578, 0.5171]] } }] };
// Valhalla (Stadia): shape polyline presisi 6
const STADIA_ROUTE = { trip: { summary: { length: 2.45, time: 420 }, legs: [{ shape: '_gjaBsct_gAo}@o}@o}@o}@' }] } };

async function main() {
  const srv = spawn(process.execPath, [new URL('./server.mjs', import.meta.url).pathname], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((r) => srv.stdout.on('data', (d) => String(d).includes('harness peta') && r()));

  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  /** Setiap URL yang benar-benar diminta peramban — inilah bukti "ganti penyedia berhasil". */
  const diminta = [];
  await ctx.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith(BASE)) return route.continue();
    diminta.push(url);

    // ubin (semua penyedia)
    if (/\.png(\?|$)|tiles\/256\//.test(url) || /tile\.openstreetmap\.org/.test(url) || /tiles\.stadiamaps\.com/.test(url) || /api\.mapbox\.com\/styles/.test(url)) {
      return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    }
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (url.includes('api.stadiamaps.com/geocoding/v1/autocomplete')) return json(STADIA_AUTOCOMPLETE);
    if (url.includes('api.stadiamaps.com/geocoding/v1/reverse')) return json(STADIA_REVERSE);
    if (url.includes('api.stadiamaps.com/route/v1')) return json(STADIA_ROUTE);
    if (url.includes('photon.komoot.io')) return json(PHOTON);
    if (url.includes('nominatim.openstreetmap.org/reverse')) return json(NOMINATIM_REV);
    if (url.includes('router.project-osrm.org')) return json(OSRM);
    if (url.includes('api.mapbox.com/search/searchbox/v1/forward')) return json(STADIA_AUTOCOMPLETE);
    if (url.includes('api.mapbox.com/search/geocode/v6/reverse')) return json({ features: [{ properties: { full_address: 'Jalan Riau 12, Pekanbaru' } }] });
    if (url.includes('api.mapbox.com/directions')) return json(OSRM);
    return route.fulfill({ status: 404, body: '' });
  });

  page.on('pageerror', (e) => { gagal++; console.error('[GAGAL] galat halaman:', e.message); });

  await page.request.post(`${BASE}/mock/reset`);
  await page.goto(BASE);
  await page.waitForFunction(() => globalThis.__siap === true);

  // ---------------------------------------------------------------------
  // 1. Bawaan aman: konfigurasi dimuat, penyedia awal = OSM gratis (pengembangan)
  // ---------------------------------------------------------------------
  let cfg = await page.evaluate(() => globalThis.__muat());
  ok('1. Konfigurasi peta dimuat dari server', cfg.tile_provider === 'osm_free', `penyedia=${cfg.tile_provider}`);
  ok('1b. Penanda uses_free_osm menyala saat masih memakai endpoint gratis', cfg.uses_free_osm === true);
  ok('1c. Nilai hemat bawaan terpasang',
    cfg.autocomplete_min_chars === 4 && cfg.autocomplete_debounce_ms === 700 && cfg.refit_min_meters === 150 && cfg.driver_poll_ms === 10000,
    `${cfg.autocomplete_min_chars} huruf · ${cfg.autocomplete_debounce_ms} ms · ${cfg.refit_min_meters} m · ${cfg.driver_poll_ms} ms`);

  const bocor = JSON.stringify(cfg);
  ok('1d. Kunci RAHASIA penyedia tidak pernah sampai ke klien',
    !bocor.includes('RAHASIA-STADIA') && !bocor.includes('RAHASIA-MAPBOX') && !bocor.includes('sk.'));

  // ---------------------------------------------------------------------
  // 2. Peta merender & meminta ubin dari URL konfigurasi
  // ---------------------------------------------------------------------
  diminta.length = 0;
  await page.evaluate(() => globalThis.__render());
  const rendered = await page.evaluate(() => globalThis.__hasil.rendered);
  const ubinOsm = diminta.filter((u) => u.includes('tile.openstreetmap.org'));
  ok('2. Peta merender (lapisan ubin Leaflet terbentuk)', rendered === true);
  ok('2b. Ubin diminta dari URL konfigurasi (OSM)', ubinOsm.length > 0, `${ubinOsm.length} permintaan, contoh: ${ubinOsm[0]}`);

  // ---------------------------------------------------------------------
  // 3. Atribusi tampil
  // ---------------------------------------------------------------------
  let attr = (await page.textContent('[data-testid="map-attribution"]')) ?? '';
  ok('3. Atribusi peta tampil', attr.includes('OpenStreetMap'), `"${attr}"`);
  const terlihat = await page.isVisible('[data-testid="map-attribution"]');
  ok('3b. Atribusi benar-benar terlihat (tidak tertutup)', terlihat);

  // ---------------------------------------------------------------------
  // 4. GANTI PENYEDIA DARI PANEL ADMIN → URL UBIN BERUBAH
  // ---------------------------------------------------------------------
  diminta.length = 0;
  const urlBaru = await page.evaluate(() => globalThis.__gantiPenyedia('stadia'));
  const ubinStadia = diminta.filter((u) => u.includes('tiles.stadiamaps.com'));
  const ubinLama = diminta.filter((u) => u.includes('tile.openstreetmap.org'));
  ok('4. Ganti penyedia dari Panel Admin mengubah URL ubin yang DIMINTA jaringan',
    ubinStadia.length > 0 && ubinLama.length === 0,
    `${ubinStadia.length} permintaan ke Stadia, ${ubinLama.length} ke OSM. Contoh: ${ubinStadia[0]}`);
  ok('4b. Kunci PUBLIK penyedia disisipkan server ke URL ubin',
    urlBaru.includes('api_key=PUBLIK-STADIA-UJI') && ubinStadia.every((u) => u.includes('api_key=PUBLIK-STADIA-UJI')));
  ok('4c. Kunci RAHASIA tidak pernah muncul di permintaan jaringan',
    !diminta.some((u) => u.includes('RAHASIA')));

  attr = (await page.textContent('[data-testid="map-attribution"]')) ?? '';
  ok('4d. Atribusi ikut berganti mengikuti penyedia baru', attr.includes('Stadia Maps'), `"${attr}"`);

  cfg = await page.evaluate(() => globalThis.__hasil.config);
  ok('4e. Peringatan endpoint gratis padam setelah pindah ke penyedia berbayar', cfg.uses_free_osm === false);

  // ---------------------------------------------------------------------
  // 5. Pencarian tempat memakai adaptor penyedia aktif
  // ---------------------------------------------------------------------
  diminta.length = 0;
  const hasilCari = await page.evaluate(() => globalThis.__cari('jalan sudirman'));
  const urlCari = diminta.find((u) => u.includes('/geocoding/v1/autocomplete')) ?? '';
  ok('5. Pencarian tempat jalan lewat adaptor Stadia', hasilCari.length === 2 && urlCari.includes('api.stadiamaps.com'), `${hasilCari.length} hasil`);
  ok('5b. Hasil pencarian berisi koordinat & alamat', hasilCari[0]?.lat === 0.5071 && !!hasilCari[0]?.address, JSON.stringify(hasilCari[0]));
  ok('5c. Query di bawah minimal karakter tidak memanggil penyedia sama sekali',
    (await page.evaluate(async () => { const n0 = performance.now(); const r = await globalThis.__cari('jal'); return { r, n0 }; })).r.length === 0);
  const cariPendek = diminta.filter((u) => u.includes('autocomplete')).length;
  ok('5d. Tepat satu panggilan autocomplete untuk dua query (yang 3 huruf ditahan)', cariPendek === 1, `${cariPendek} panggilan`);

  // ---------------------------------------------------------------------
  // 6. Cache reverse geocode: panggilan kedua tidak menyentuh penyedia
  // ---------------------------------------------------------------------
  diminta.length = 0;
  const a1 = await page.evaluate(() => globalThis.__reverse(0.5071, 101.4478));
  const panggil1 = diminta.filter((u) => u.includes('/geocoding/v1/reverse')).length;
  const a2 = await page.evaluate(() => globalThis.__reverse(0.50715, 101.44785));   // ±8 m, petak sama
  const panggil2 = diminta.filter((u) => u.includes('/geocoding/v1/reverse')).length;
  ok('6. Reverse geocode pertama memanggil penyedia', panggil1 === 1 && a1.includes('Jalan Riau'), a1);
  ok('6b. Reverse geocode kedua di petak yang sama dilayani cache (0 panggilan penyedia)',
    panggil2 === panggil1 && a2 === a1, `total panggilan penyedia tetap ${panggil2}`);

  // ---------------------------------------------------------------------
  // 7. Rute: penundaan + rute sungguhan + polyline tergambar
  // ---------------------------------------------------------------------
  diminta.length = 0;
  const pratinjau = await page.evaluate(() => globalThis.__rute(false));
  const panggilPratinjau = diminta.filter((u) => u.includes('/route/v1')).length;
  ok('7. Pratinjau rute TIDAK memanggil penyedia (tunda rute aktif)', panggilPratinjau === 0 && pratinjau.estimated === true, `${pratinjau.distance_km} km (perkiraan)`);

  const estimasi = await page.evaluate(() => globalThis.__estimasi());
  const lurus = 1.5673;  // haversine 0.5071,101.4478 → 0.5171,101.4578 ≈ 1,567 km
  ok('7b. Perkiraan memakai rumus yang sama dengan server (garis lurus × 1,3)',
    Math.abs(estimasi.distance_km - Math.round(lurus * 1.3 * 100) / 100) < 0.05, `${estimasi.distance_km} km`);

  const rute = await page.evaluate(() => globalThis.__rute(true));
  const panggilFinal = diminta.filter((u) => u.includes('/route/v1')).length;
  ok('7c. Rute sungguhan dipanggil hanya saat pengguna melanjutkan', panggilFinal === 1 && rute.estimated === false, `${rute.distance_km} km · ${rute.duration_min} mnt`);
  ok('7d. Geometri rute terurai (polyline presisi 6 Valhalla)', rute.coords.length > 1, `${rute.coords.length} titik`);

  await page.evaluate((coords) => globalThis.__update({ polyline: coords, markers: [], fitTo: null }), rute.coords);
  await page.waitForTimeout(300);
  const garis = await page.evaluate(() => globalThis.__polyline());
  ok('7e. Rute muncul di peta (polyline tergambar)', garis > 0, `${garis} garis`);

  // ---------------------------------------------------------------------
  // 8. Penjaga gambar-ulang peta 150 m
  // ---------------------------------------------------------------------
  const dekat = await page.evaluate(() => globalThis.__shouldRefit([{ lat: 0.5071, lng: 101.4478 }], [{ lat: 0.50715, lng: 101.44785 }], 150));
  const jauh = await page.evaluate(() => globalThis.__shouldRefit([{ lat: 0.5071, lng: 101.4478 }], [{ lat: 0.5091, lng: 101.4498 }], 150));
  ok('8. Gerak driver < 150 m tidak memicu fit ulang peta', dekat === false);
  ok('8b. Gerak driver > 150 m tetap memicu fit ulang peta', jauh === true);

  // ---------------------------------------------------------------------
  // 9. Gagal-aman: server tidak terjangkau → bawaan aman, peta tidak mati
  // ---------------------------------------------------------------------
  const aman = await page.evaluate(() => globalThis.__normalize({ tile_url: '', tile_provider: 'entah', autocomplete_min_chars: 0 }));
  ok('9. Konfigurasi rusak/kosong jatuh ke bawaan aman (peta tidak pernah kosong)',
    aman.tile_url.includes('tile.openstreetmap.org') && aman.tile_provider === 'osm_free' && aman.autocomplete_min_chars === 4);

  // ---------------------------------------------------------------------
  // 10. Kembali ke Mapbox: URL ubin berubah lagi (bukti jalur ini bisa dipakai berulang)
  // ---------------------------------------------------------------------
  diminta.length = 0;
  const urlMapbox = await page.evaluate(() => globalThis.__gantiPenyedia('mapbox'));
  const ubinMapbox = diminta.filter((u) => u.includes('api.mapbox.com/styles'));
  ok('10. Pindah penyedia kedua kalinya (Stadia → Mapbox) juga langsung terpakai',
    ubinMapbox.length > 0 && urlMapbox.includes('access_token=pk.PUBLIK-MAPBOX-UJI'),
    `${ubinMapbox.length} permintaan, contoh: ${ubinMapbox[0]}`);
  ok('10b. Token rahasia Mapbox (sk.…) tidak pernah dikirim ke klien', !diminta.some((u) => u.includes('sk.RAHASIA')));

  await browser.close();
  srv.kill();

  console.log(`\n${lulus} lulus, ${gagal} gagal`);
  process.exit(gagal === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
