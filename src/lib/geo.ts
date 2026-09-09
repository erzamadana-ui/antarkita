// ============================================================================
// Lapisan penyedia geo (ubin, autocomplete, reverse geocode, rute).
//
// Penyedia TIDAK ter-hardcode: dipilih dari `map_public_config()` (migrasi 0061)
// yang disetel pemilik di Panel Admin → Peta. Berpindah penyedia tidak memerlukan
// rilis ulang aplikasi — lihat src/lib/mapConfig.ts.
//
// Adaptor yang tersedia:
//   • 'stadia'   — Stadia Maps (pilihan utama riset: ubin + autocomplete + geocode + rute satu vendor)
//   • 'mapbox'   — Mapbox (cadangan)
//   • 'google'   — Google Maps Platform (hanya bila pemilik sengaja memilihnya; termahal)
//   • 'osm_free' — Nominatim/Photon/OSRM demo — HANYA UNTUK PENGEMBANGAN, lihat peringatan di bawah.
//
// ⚠️ PERINGATAN 'osm_free' (docs/riset/RISET-PETA-DAN-BIAYA.md §2):
//   - Nominatim MELARANG autocomplete secara eksplisit dan menyatakan pelanggarnya "will get you banned".
//   - photon.komoot.io adalah situs demo; "extensive usage will be throttled or completely banned".
//   - router.project-osrm.org adalah layanan demo yang "forbids heavy usage".
//   - tile.openstreetmap.org memblokir "without prior notice".
//   Semua ini TIDAK BOLEH dipakai untuk operasi komersial. Adaptor ini sengaja
//   dipertahankan hanya agar pengembangan lokal tetap jalan tanpa kunci API.
// ============================================================================
import type { LatLng, Place } from './types';
import { rpc } from './supabase';
import { getMapConfig, primeMapConfig, type MapProvider } from './mapConfig';

// Kebijakan Nominatim menuntut User-Agent yang menyebut aplikasi DAN kontak yang VALID.
// (Sebelumnya tertulis support@antaraja.id — alamat yang tidak pernah ada.)
const UA = 'AntarKita/1.0 (erzamadana@gmail.com)';

/** Kunci Google warisan dari .env. Hanya dipakai bila pemilik memilih penyedia 'google' di Panel Admin. */
const GOOGLE_ENV_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY || '';

// ---------------------------------------------------------------------------
// Cache HTTP dalam-memori (per sesi). Dulu tanpa batas & tanpa kedaluwarsa;
// sekarang dibatasi agar tidak menggelembung pada sesi panjang.
// ---------------------------------------------------------------------------
const MEM_TTL_MS = 10 * 60 * 1000;
const MEM_MAX = 300;
const cache = new Map<string, { at: number; v: unknown }>();
function memGet<T>(k: string): T | undefined {
  const e = cache.get(k);
  if (!e) return undefined;
  if (Date.now() - e.at > MEM_TTL_MS) { cache.delete(k); return undefined; }
  return e.v as T;
}
function memSet(k: string, v: unknown) {
  if (cache.size >= MEM_MAX) { const first = cache.keys().next().value; if (first) cache.delete(first); }
  cache.set(k, { at: Date.now(), v });
}

async function getJson<T>(url: string, timeoutMs = 8000): Promise<T> {
  const hit = memGet<T>(url);
  if (hit !== undefined) return hit;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json', 'User-Agent': UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as T;
    memSet(url, json);
    return json;
  } finally {
    clearTimeout(t);
  }
}

async function postJson<T>(url: string, body: unknown, timeoutMs = 8000): Promise<T> {
  const key = `POST ${url} ${JSON.stringify(body)}`;
  const hit = memGet<T>(key);
  if (hit !== undefined) return hit;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: 'POST', signal: ctrl.signal, headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': UA }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as T;
    memSet(key, json);
    return json;
  } finally {
    clearTimeout(t);
  }
}

// ---------------------------------------------------------------------------
// Geometri dasar (tanpa panggilan jaringan)
// ---------------------------------------------------------------------------
export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function bearing(a: LatLng, b: LatLng): number {
  const y = Math.sin(((b.lng - a.lng) * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180);
  const x = Math.cos((a.lat * Math.PI) / 180) * Math.sin((b.lat * Math.PI) / 180) -
    Math.sin((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.cos(((b.lng - a.lng) * Math.PI) / 180);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Jarak dalam meter — dipakai penjaga gambar-ulang peta (§5.5). */
export const distanceMeters = (a: LatLng, b: LatLng) => haversineKm(a, b) * 1000;

// ---------------------------------------------------------------------------
// Sesi pencarian (session token)
// ---------------------------------------------------------------------------
// Mapbox Search Box menagih PER SESI, bukan per ketikan: seluruh ketikan dalam satu
// sesi + satu pilihan = 1 unit tagihan. Google Autocomplete Session Usage bahkan $0.
// Karena itu token sesi dibuat saat layar Pilih Lokasi dibuka dan diakhiri saat
// pengguna memilih hasil. Stadia menagih per permintaan (tidak memakai token).
let sessionToken: string | null = null;
const randomToken = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`;
/** Mulai sesi pencarian baru (dipanggil saat layar Pilih Lokasi dibuka). */
export function newSearchSession(): string { sessionToken = randomToken(); return sessionToken; }
/** Akhiri sesi pencarian (dipanggil saat pengguna memilih satu hasil). */
export function endSearchSession() { sessionToken = null; }
const currentSession = () => sessionToken ?? newSearchSession();

// ---------------------------------------------------------------------------
// Pencarian tempat (autocomplete)
// ---------------------------------------------------------------------------
export async function searchPlaces(q: string, near?: LatLng): Promise<Place[]> {
  primeMapConfig();
  const cfg = getMapConfig();
  const query = q.trim();
  // Hemat §5.2: minimum karakter datang dari server (bawaan 4, dulu 3).
  // Query 3 karakter di Indonesia hampir selalu terlalu umum ("jal", "pas") dan
  // hasilnya dibuang pengguna → ±10% permintaan autocomplete hilang tanpa efek terasa.
  if (query.length < cfg.autocomplete_min_chars) return [];
  try {
    return await searchByProvider(cfg.geocode_provider, cfg.geocode_key, query, near);
  } catch {
    // Tidak ada fallback lintas-penyedia yang melanggar syarat pakai.
    // (Dulu Photon gagal → jatuh ke Nominatim, yaitu pola autocomplete yang DILARANG
    //  eksplisit oleh kebijakan Nominatim dan berkonsekuensi ban.)
    return [];
  }
}

function searchByProvider(provider: MapProvider, key: string | null, q: string, near?: LatLng): Promise<Place[]> {
  switch (provider) {
    case 'stadia': return stadiaSearch(q, key, near);
    case 'mapbox': return mapboxSearch(q, key, near);
    case 'google': return googleSearch(q, key, near);
    default: return freeOsmSearch(q, near);
  }
}

/** Stadia Maps — Geocoding (Pelias) autocomplete. 1 kredit/permintaan. */
async function stadiaSearch(q: string, key: string | null, near?: LatLng): Promise<Place[]> {
  const focus = near ? `&focus.point.lat=${near.lat}&focus.point.lon=${near.lng}` : '';
  const url = `https://api.stadiamaps.com/geocoding/v1/autocomplete?text=${encodeURIComponent(q)}&boundary.country=IDN&size=8&lang=id${focus}&api_key=${encodeURIComponent(key ?? '')}`;
  const json = await getJson<{ features?: { geometry: { coordinates: [number, number] }; properties: Record<string, string> }[] }>(url);
  return (json.features ?? []).map((f) => ({
    name: f.properties.name || f.properties.label || q,
    address: shortAddress(f.properties.label || f.properties.name || q),
    lat: f.geometry.coordinates[1],
    lng: f.geometry.coordinates[0],
  }));
}

/** Mapbox — Search Box forward. Ditagih per SESI, karena itu session_token diikutkan. */
async function mapboxSearch(q: string, key: string | null, near?: LatLng): Promise<Place[]> {
  const prox = near ? `&proximity=${near.lng},${near.lat}` : '';
  const url = `https://api.mapbox.com/search/searchbox/v1/forward?q=${encodeURIComponent(q)}&country=id&language=id&limit=8${prox}&session_token=${encodeURIComponent(currentSession())}&access_token=${encodeURIComponent(key ?? '')}`;
  const json = await getJson<{ features?: { geometry: { coordinates: [number, number] }; properties: Record<string, string> }[] }>(url);
  return (json.features ?? []).map((f) => ({
    name: f.properties.name || f.properties.full_address || q,
    address: shortAddress(f.properties.full_address || f.properties.place_formatted || f.properties.name || q),
    lat: f.geometry.coordinates[1],
    lng: f.geometry.coordinates[0],
  }));
}

/**
 * Google — Places Text Search.
 * ⚠️ CATATAN BIAYA (riset §3.2): Text Search adalah SKU Pro seharga $32/1.000 —
 * 11× lebih mahal dari Places Autocomplete ($2,83/1.000, bahkan $0 dengan session token).
 * Adaptor ini dipertahankan apa adanya untuk kompatibilitas; bila pemilik benar-benar
 * memilih Google, ganti dulu ke Autocomplete + Place Details dengan session token.
 */
async function googleSearch(q: string, key: string | null, near?: LatLng): Promise<Place[]> {
  const k = key || GOOGLE_ENV_KEY;
  const loc = near ? `&location=${near.lat},${near.lng}&radius=30000` : '';
  const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(q)}&region=id&language=id${loc}&key=${encodeURIComponent(k)}`;
  const json = await getJson<{ results: { name: string; formatted_address: string; geometry: { location: { lat: number; lng: number } } }[] }>(url);
  return json.results.slice(0, 8).map((r) => ({ name: r.name, address: r.formatted_address, lat: r.geometry.location.lat, lng: r.geometry.location.lng }));
}

/** ⚠️ PENGEMBANGAN SAJA — Photon adalah situs demo Komoot, bukan API komersial. */
async function freeOsmSearch(q: string, near?: LatLng): Promise<Place[]> {
  const bias = near ? `&lat=${near.lat}&lon=${near.lng}` : '';
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=8&lang=en${bias}`;
  const json = await getJson<{ features: { geometry: { coordinates: [number, number] }; properties: Record<string, string> }[] }>(url);
  return json.features
    .filter((f) => !f.properties.countrycode || f.properties.countrycode === 'ID')
    .map((f) => {
      const p = f.properties;
      const parts = [p.street && p.housenumber ? `${p.street} ${p.housenumber}` : p.street, p.district, p.city || p.county, p.state].filter(Boolean);
      const name = p.name || parts[0] || q;
      return { name, address: uniq([name, ...parts]).join(', '), lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] };
    });
}

// ---------------------------------------------------------------------------
// Reverse geocode — dengan cache bersama di Supabase
// ---------------------------------------------------------------------------
/**
 * Alur: cek cache Supabase (geohash presisi 7 ≈ 153 m) → bila meleset baru panggil
 * penyedia → simpan hasilnya.
 *
 * HEMAT: riset §5.1 memperkirakan rasio hit 70% sesudah satu bulan operasi
 * (dasar: Pekanbaru ±632 km² ≈ 27.000 petak geohash-7 di area terbangun, sementara
 * Skenario A menghasilkan 60.750 reverse geocode/bulan yang terkonsentrasi di koridor
 * utama) → reverse geocode −70%. Cache ini dibagi SELURUH pengguna, berbeda dari
 * cache dalam-memori lama yang hanya hidup dalam satu sesi.
 *
 * CATATAN LISENSI: Mapbox membedakan geocoding "temporary" (tidak boleh disimpan)
 * dan "permanent". Bila pemilik memakai Mapbox, konfirmasikan tingkat permanent
 * sebelum caching diandalkan. Nominatim mengizinkan (bahkan mewajibkan) caching.
 */
export async function reverseGeocode(p: LatLng): Promise<string> {
  primeMapConfig();
  const cfg = getMapConfig();
  // 1. cache bersama
  try {
    const hit = await rpc<{ hit?: boolean; address?: string | null }>('resolve_address', { p_lat: p.lat, p_lng: p.lng });
    if (hit?.hit && hit.address) return hit.address;
  } catch { /* cache opsional — lanjut ke penyedia */ }
  // 2. penyedia
  let address: string;
  try {
    address = await reverseByProvider(cfg.geocode_provider, cfg.geocode_key, p);
  } catch {
    return fallbackLabel(p);
  }
  if (!address) return fallbackLabel(p);
  // 3. simpan (tidak menunggu; kegagalan tidak boleh menghambat UI)
  rpc('cache_address', { p_lat: p.lat, p_lng: p.lng, p_address: address, p_provider: cfg.geocode_provider }).catch(() => {});
  return address;
}

function reverseByProvider(provider: MapProvider, key: string | null, p: LatLng): Promise<string> {
  switch (provider) {
    case 'stadia': return stadiaReverse(p, key);
    case 'mapbox': return mapboxReverse(p, key);
    case 'google': return googleReverse(p, key);
    default: return freeOsmReverse(p);
  }
}

async function stadiaReverse(p: LatLng, key: string | null): Promise<string> {
  const url = `https://api.stadiamaps.com/geocoding/v1/reverse?point.lat=${p.lat}&point.lon=${p.lng}&size=1&lang=id&api_key=${encodeURIComponent(key ?? '')}`;
  const json = await getJson<{ features?: { properties: Record<string, string> }[] }>(url);
  const pr = json.features?.[0]?.properties;
  return pr ? shortAddress(pr.label || pr.name || '') : '';
}

async function mapboxReverse(p: LatLng, key: string | null): Promise<string> {
  const url = `https://api.mapbox.com/search/geocode/v6/reverse?longitude=${p.lng}&latitude=${p.lat}&limit=1&language=id&access_token=${encodeURIComponent(key ?? '')}`;
  const json = await getJson<{ features?: { properties: Record<string, string> }[] }>(url);
  const pr = json.features?.[0]?.properties;
  return pr ? shortAddress(pr.full_address || pr.name || '') : '';
}

async function googleReverse(p: LatLng, key: string | null): Promise<string> {
  const k = key || GOOGLE_ENV_KEY;
  const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${p.lat},${p.lng}&language=id&key=${encodeURIComponent(k)}`;
  const json = await getJson<{ results: { formatted_address: string }[] }>(url);
  return json.results[0]?.formatted_address ?? '';
}

/** ⚠️ PENGEMBANGAN SAJA — Nominatim membatasi 1 permintaan/detik dan melarang query sistematis. */
async function freeOsmReverse(p: LatLng): Promise<string> {
  const url = `https://nominatim.openstreetmap.org/reverse?lat=${p.lat}&lon=${p.lng}&format=jsonv2&zoom=18&addressdetails=1`;
  const json = await getJson<{ display_name?: string; name?: string; address?: Record<string, string> }>(url);
  const a = json.address ?? {};
  const parts = uniq([json.name, a.road ? `${a.road}${a.house_number ? ' ' + a.house_number : ''}` : '', a.neighbourhood || a.suburb || a.village, a.city_district, a.city || a.town || a.county].filter(Boolean) as string[]);
  return parts.length ? parts.join(', ') : json.display_name ? shortAddress(json.display_name) : '';
}

// ---------------------------------------------------------------------------
// Rute
// ---------------------------------------------------------------------------
export interface RouteResult { distance_km: number; duration_min: number; coords: [number, number][]; estimated: boolean }

/**
 * Perkiraan rute TANPA panggilan jaringan: garis lurus × 1,3.
 *
 * Pengali 1,3 sengaja SAMA PERSIS dengan yang dipakai server: `estimate_fare`
 * (0021_…:55) menghitung `v_km := coalesce(p_route_km, v_straight * 1.3)` lalu
 * menjepitnya ke `[v_straight, v_straight × max_route_ratio]`. Artinya ongkos yang
 * ditampilkan dari perkiraan ini IDENTIK dengan yang dihitung server bila klien tidak
 * mengirim route_km sama sekali — tarif tidak berubah, hanya panggilan penyedia yang hilang.
 */
export function estimateRoute(a: LatLng, b: LatLng): RouteResult {
  const d = haversineKm(a, b) * 1.3;
  return {
    distance_km: Math.round(d * 100) / 100,
    duration_min: Math.max(3, Math.round((d / 25) * 60)),
    coords: [[a.lat, a.lng], [b.lat, b.lng]],
    estimated: true,
  };
}

/** Bulatkan koordinat ke 4 desimal (±11 m) supaya getar GPS memakai ulang rute yang sama. */
const qz = (n: number) => Math.round(n * 1e4) / 1e4;
const routeKey = (a: LatLng, b: LatLng, p: string) => `${p}|${qz(a.lat)},${qz(a.lng)}|${qz(b.lat)},${qz(b.lng)}`;
const routeCache = new Map<string, { at: number; v: RouteResult }>();
const ROUTE_TTL_MS = 15 * 60 * 1000;

export interface RouteOptions {
  /**
   * true = pengguna benar-benar melanjutkan (memilih kelas / menekan tombol pesan),
   * jadi rute sungguhan memang dibutuhkan untuk disimpan ke `orders.route_geometry`.
   * false/undefined = pratinjau; bila `defer_routing` menyala, cukup perkiraan lokal.
   */
  final?: boolean;
}

/**
 * HEMAT §5.3 (perkiraan −40% panggilan routing):
 * Dulu `getRoute()` dipanggil pada SETIAP perubahan pickup/dropoff, sebelum
 * `fare_options`, termasuk perubahan yang segera dibatalkan pengguna dan pesanan yang
 * akhirnya ditinggalkan. Sekarang pratinjau memakai perkiraan PostGIS-setara (gratis),
 * dan penyedia baru dipanggil sekali dengan `{ final: true }` saat pengguna melanjutkan
 * — yaitu saat geometri rute benar-benar dipakai (`orders.route_geometry`).
 * Dua sumber angka −40%: (a) panggilan pada pesanan yang ditinggalkan, dan
 * (b) panggilan pada perubahan titik beruntun (riset §5.3).
 */
export async function getRoute(a: LatLng, b: LatLng, opts?: RouteOptions): Promise<RouteResult> {
  primeMapConfig();
  const cfg = getMapConfig();
  if (!opts?.final && cfg.defer_routing) return estimateRoute(a, b);

  const key = routeKey(a, b, cfg.route_provider);
  const hit = routeCache.get(key);
  if (hit && Date.now() - hit.at < ROUTE_TTL_MS) return hit.v;
  try {
    const r = await routeByProvider(cfg.route_provider, cfg.route_key, a, b);
    routeCache.set(key, { at: Date.now(), v: r });
    return r;
  } catch {
    return estimateRoute(a, b);
  }
}

/** Nilai yang dikirim ke `create_order`. Sengaja BUKAN `RouteResult`. */
export interface FinalRoute {
  /**
   * Jarak yang dipakai server untuk MENGHITUNG ONGKOS (`create_order` → `estimate_fare`).
   * Wajib sama persis dengan jarak yang dipakai saat tarif DITAMPILKAN, dan `null`
   * bila saat itu memang tidak ada jarak yang dikirim (server memakai bawaan 1,3×garis lurus).
   */
  route_km: number | null;
  duration_min: number | null;
  /** Geometri rute SUNGGUHAN untuk `orders.route_geometry` (tidak memengaruhi ongkos). */
  coords: [number, number][] | null;
}

/**
 * Naikkan pratinjau menjadi rute sungguhan tepat sebelum pesanan dibuat.
 *
 * ⚠️ ATURAN UANG — jangan diubah tanpa membaca ini:
 * `create_order` MENGHITUNG ULANG ongkos dari `route_km` yang dikirim
 * (0002_…:196 → `estimate_fare(..., (p->>'route_km')::numeric)`), sedangkan tarif yang
 * sudah dilihat pengguna dihitung dari jarak PRATINJAU. Karena `defer_routing` menyala,
 * pratinjau adalah garis lurus × 1,3 sementara rute sungguhan hampir tidak pernah tepat
 * 1,3× — mengirim jarak rute sungguhan berarti pelanggan ditagih berbeda dari yang
 * ditampilkan (terbukti: 6,9 km garis lurus → tampil Rp19.500, tertagih Rp23.000 pada
 * rasio jalan 1,55).
 *
 * Karena itu yang "dinaikkan" hanyalah GEOMETRI. Angka jarak/durasi tetap angka yang
 * menjadi dasar harga yang ditampilkan.
 */
export async function finalizeRoute(a: LatLng, b: LatLng, preview?: RouteResult | null): Promise<FinalRoute> {
  const real = preview && !preview.estimated ? preview : await getRoute(a, b, { final: true });
  return {
    // Jarak/durasi HARGA: apa adanya dari pratinjau (null bila pratinjau belum ada,
    // yang berarti tarif tadi juga dihitung server tanpa route_km).
    route_km: preview ? preview.distance_km : null,
    duration_min: preview ? preview.duration_min : null,
    // Geometri: rute sungguhan bila berhasil diambil.
    coords: real.coords.length > 1 ? real.coords : (preview?.coords ?? null),
  };
}

function routeByProvider(provider: MapProvider, key: string | null, a: LatLng, b: LatLng): Promise<RouteResult> {
  switch (provider) {
    case 'stadia': return stadiaRoute(a, b, key);
    case 'mapbox': return mapboxRoute(a, b, key);
    case 'google': return googleRoute(a, b, key);
    default: return freeOsmRoute(a, b);
  }
}

/** Stadia Maps — Routing (Valhalla). POST; `shape` adalah polyline presisi 6. */
async function stadiaRoute(a: LatLng, b: LatLng, key: string | null): Promise<RouteResult> {
  const url = `https://api.stadiamaps.com/route/v1?api_key=${encodeURIComponent(key ?? '')}`;
  const json = await postJson<{ trip?: { legs?: { shape?: string }[]; summary?: { length?: number; time?: number } } }>(url, {
    locations: [{ lat: a.lat, lon: a.lng }, { lat: b.lat, lon: b.lng }],
    costing: 'auto',
    directions_options: { units: 'kilometers' },
  }, 9000);
  const trip = json.trip;
  if (!trip?.summary) throw new Error('no route');
  const coords = (trip.legs ?? []).flatMap((l) => (l.shape ? decodePolyline(l.shape, 1e6) : []));
  return {
    distance_km: Math.round((trip.summary.length ?? 0) * 100) / 100,
    duration_min: Math.max(2, Math.round(((trip.summary.time ?? 0) / 60) * 1.15)), // koreksi lalu lintas kota
    coords: coords.length > 1 ? coords : [[a.lat, a.lng], [b.lat, b.lng]],
    estimated: false,
  };
}

/** Mapbox — Directions API. */
async function mapboxRoute(a: LatLng, b: LatLng, key: string | null): Promise<RouteResult> {
  const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson&access_token=${encodeURIComponent(key ?? '')}`;
  const json = await getJson<{ routes: { distance: number; duration: number; geometry: { coordinates: [number, number][] } }[] }>(url, 9000);
  const r = json.routes?.[0];
  if (!r) throw new Error('no route');
  return {
    distance_km: Math.round((r.distance / 1000) * 100) / 100,
    duration_min: Math.max(2, Math.round((r.duration / 60) * 1.15)),
    coords: r.geometry.coordinates.map(([lng, lat]) => [lat, lng] as [number, number]),
    estimated: false,
  };
}

async function googleRoute(a: LatLng, b: LatLng, key: string | null): Promise<RouteResult> {
  const k = key || GOOGLE_ENV_KEY;
  const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${a.lat},${a.lng}&destination=${b.lat},${b.lng}&mode=driving&key=${encodeURIComponent(k)}`;
  const json = await getJson<{ routes: { legs: { distance: { value: number }; duration: { value: number } }[]; overview_polyline: { points: string } }[] }>(url);
  const r = json.routes[0];
  if (!r) throw new Error('no route');
  const leg = r.legs[0];
  return { distance_km: Math.round((leg.distance.value / 1000) * 100) / 100, duration_min: Math.round(leg.duration.value / 60), coords: decodePolyline(r.overview_polyline.points), estimated: false };
}

/** ⚠️ PENGEMBANGAN SAJA — router.project-osrm.org adalah server demo tanpa SLA. */
async function freeOsmRoute(a: LatLng, b: LatLng): Promise<RouteResult> {
  const url = `https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson`;
  const json = await getJson<{ routes: { distance: number; duration: number; geometry: { coordinates: [number, number][] } }[] }>(url, 7000);
  const r = json.routes[0];
  if (!r) throw new Error('no route');
  return {
    distance_km: Math.round((r.distance / 1000) * 100) / 100,
    duration_min: Math.max(2, Math.round((r.duration / 60) * 1.15)),
    coords: r.geometry.coordinates.map(([lng, lat]) => [lat, lng] as [number, number]),
    estimated: false,
  };
}

/** Polyline terkode Google/Valhalla. `factor` 1e5 (Google/OSRM) atau 1e6 (Valhalla). */
function decodePolyline(str: string, factor = 1e5): [number, number][] {
  let index = 0, lat = 0, lng = 0; const out: [number, number][] = [];
  while (index < str.length) {
    let b, shift = 0, result = 0;
    do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1; shift = 0; result = 0;
    do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    out.push([lat / factor, lng / factor]);
  }
  return out;
}

const uniq = (arr: (string | undefined)[]) => Array.from(new Set(arr.filter(Boolean) as string[]));
const shortAddress = (s: string) => s.split(',').map((x) => x.trim()).filter((x) => !/^\d{5}$/.test(x) && x !== 'Indonesia').slice(0, 4).join(', ');
const fallbackLabel = (p: LatLng) => `Titik peta (${p.lat.toFixed(5)}, ${p.lng.toFixed(5)})`;
