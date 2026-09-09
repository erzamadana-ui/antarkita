// Konfigurasi peta dari server (migrasi 0061) — INI YANG MEMBUAT PENYEDIA BISA DIGANTI
// TANPA RILIS ULANG.
//
// Sebelumnya `TILE_URL` adalah konstanta di src/components/map/shared.ts yang ikut
// ter-bundle ke dalam APK/IPA. Bila penyedia ubin memblokir kita (kebijakan OSMF
// menyebut "access may be blocked without prior notice"), peta menjadi abu-abu di
// SEMUA perangkat dan satu-satunya perbaikan adalah rilis toko baru — 3–21 hari.
//
// Sekarang: aplikasi membaca `map_public_config()` saat mulai, menyimpannya di
// AsyncStorage, dan memakai nilai bawaan yang aman bila server tidak terjangkau.
// Pemilik cukup mengubah penyedia di Panel Admin → Peta; aplikasi yang sedang
// berjalan mengambil konfigurasi baru saat kembali ke depan (maksimal 5 menit).
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { rpc } from './supabase';

/** Penyedia yang punya adaptor di src/lib/geo.ts. */
export type MapProvider = 'stadia' | 'mapbox' | 'google' | 'osm_free';

export interface MapConfig {
  tile_provider: MapProvider;
  /** URL ubin siap pakai — kunci publik sudah disisipkan server (placeholder {key}). */
  tile_url: string;
  tile_attribution: string;
  tile_max_zoom: number;
  geocode_provider: MapProvider;
  geocode_key: string | null;
  route_provider: MapProvider;
  route_key: string | null;
  /** Hemat §5.2: minimum karakter sebelum autocomplete dipanggil. */
  autocomplete_min_chars: number;
  /** Hemat §5.2: jeda ketik sebelum autocomplete dipanggil. */
  autocomplete_debounce_ms: number;
  /** Hemat §5.3: tunda panggilan rute sungguhan sampai pengguna melanjutkan. */
  defer_routing: boolean;
  /** Hemat §5.5: jarak minimum gerak driver sebelum peta di-fit ulang. */
  refit_min_meters: number;
  /** Hemat §5.5: jeda polling posisi driver. */
  driver_poll_ms: number;
  /** Hemat §5.5: batas zoom saat melacak (lebih rendah = lebih sedikit set ubin). */
  track_max_zoom: number;
  /** true bila masih ada layanan yang memakai endpoint gratis yang melanggar syarat pakai. */
  uses_free_osm: boolean;
}

/**
 * Nilai bawaan yang aman: sama persis dengan perilaku lama (OSM gratis) supaya
 * aplikasi TIDAK PERNAH kehilangan peta hanya karena konfigurasi gagal dimuat.
 * Angka tuning sudah memakai nilai hemat — bila server tidak terjangkau,
 * penghematan tetap berlaku.
 *
 * PERINGATAN: 'osm_free' hanya untuk PENGEMBANGAN. Keempat endpoint gratis
 * (tile.openstreetmap.org, nominatim.openstreetmap.org, router.project-osrm.org,
 * photon.komoot.io) melarang pemakaian komersial dan dapat memblokir tanpa
 * pemberitahuan — lihat docs/riset/RISET-PETA-DAN-BIAYA.md §2.
 */
export const DEFAULT_MAP_CONFIG: MapConfig = {
  tile_provider: 'osm_free',
  tile_url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  tile_attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  tile_max_zoom: 19,
  geocode_provider: 'osm_free',
  geocode_key: null,
  route_provider: 'osm_free',
  route_key: null,
  autocomplete_min_chars: 4,
  autocomplete_debounce_ms: 700,
  defer_routing: true,
  refit_min_meters: 150,
  driver_poll_ms: 10000,
  track_max_zoom: 16,
  uses_free_osm: true,
};

const STORAGE_KEY = 'antarkita.map_config.v1';
/** Umur cache konfigurasi peta. Lebih panjang dari app_settings (60 dtk) karena jarang berubah,
 *  tapi cukup pendek agar peralihan penyedia darurat terasa dalam hitungan menit. */
const STALE_MS = 5 * 60 * 1000;

const str = (v: unknown, d: string) => (typeof v === 'string' && v.trim() ? v : d);
const num = (v: unknown, d: number) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };
const prov = (v: unknown, d: MapProvider): MapProvider =>
  v === 'stadia' || v === 'mapbox' || v === 'google' || v === 'osm_free' ? v : d;

export function normalizeMapConfig(raw: unknown): MapConfig {
  const r = (raw ?? {}) as Record<string, unknown>;
  const d = DEFAULT_MAP_CONFIG;
  return {
    tile_provider: prov(r.tile_provider, d.tile_provider),
    tile_url: str(r.tile_url, d.tile_url),
    tile_attribution: str(r.tile_attribution, d.tile_attribution),
    tile_max_zoom: Math.min(22, Math.max(10, num(r.tile_max_zoom, d.tile_max_zoom))),
    geocode_provider: prov(r.geocode_provider, d.geocode_provider),
    geocode_key: typeof r.geocode_key === 'string' && r.geocode_key ? r.geocode_key : null,
    route_provider: prov(r.route_provider, d.route_provider),
    route_key: typeof r.route_key === 'string' && r.route_key ? r.route_key : null,
    autocomplete_min_chars: Math.min(8, Math.max(2, num(r.autocomplete_min_chars, d.autocomplete_min_chars))),
    autocomplete_debounce_ms: Math.min(3000, Math.max(200, num(r.autocomplete_debounce_ms, d.autocomplete_debounce_ms))),
    defer_routing: r.defer_routing !== false,
    refit_min_meters: Math.min(2000, Math.max(0, Number(r.refit_min_meters) >= 0 ? Number(r.refit_min_meters) : d.refit_min_meters)),
    driver_poll_ms: Math.min(60000, Math.max(3000, num(r.driver_poll_ms, d.driver_poll_ms))),
    track_max_zoom: Math.min(20, Math.max(10, num(r.track_max_zoom, d.track_max_zoom))),
    uses_free_osm: r.uses_free_osm !== false,
  };
}

interface State { config: MapConfig; loadedAt: number; loading: boolean; load: (force?: boolean) => Promise<void> }

let inflight: Promise<void> | null = null;
let hydrated = false;

/** Simpan salinan lokal supaya cold start (sebelum jaringan siap) tetap memakai penyedia terakhir. */
async function persist(cfg: MapConfig) {
  try {
    if (Platform.OS === 'web') { globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(cfg)); return; }
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  } catch { /* penyimpanan lokal opsional */ }
}
async function readPersisted(): Promise<MapConfig | null> {
  try {
    const raw = Platform.OS === 'web' ? globalThis.localStorage?.getItem(STORAGE_KEY) : await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? normalizeMapConfig(JSON.parse(raw)) : null;
  } catch { return null; }
}

export const useMapConfigStore = create<State>((set, get) => ({
  config: DEFAULT_MAP_CONFIG,
  loadedAt: 0,
  loading: false,
  load: async (force = false) => {
    const { loadedAt } = get();
    if (!force && loadedAt && Date.now() - loadedAt < STALE_MS) return;
    if (inflight) return inflight;
    set({ loading: true });
    inflight = (async () => {
      // (a) salinan lokal lebih dulu supaya peta langsung memakai penyedia yang benar
      if (!hydrated) {
        hydrated = true;
        const local = await readPersisted();
        if (local) set({ config: local });
      }
      try {
        const cfg = normalizeMapConfig(await rpc<unknown>('map_public_config'));
        set({ config: cfg, loadedAt: Date.now() });
        persist(cfg);
        if (cfg.uses_free_osm && __DEV__) {
          console.warn('[peta] Masih memakai endpoint OSM gratis. Endpoint ini MELARANG pemakaian komersial dan dapat memblokir tanpa pemberitahuan. Ganti penyedia di Panel Admin → Peta sebelum rilis.');
        }
      } catch { /* pakai salinan lokal / bawaan aman */ }
      finally { set({ loading: false }); inflight = null; }
    })();
    return inflight;
  },
}));

/** Konfigurasi peta saat ini (sinkron). Selalu terisi — bawaan aman bila belum dimuat. */
export const getMapConfig = (): MapConfig => useMapConfigStore.getState().config;
/** Muat ulang paksa (dipakai sesudah admin menyimpan konfigurasi). */
export const reloadMapConfig = () => useMapConfigStore.getState().load(true);

let watchersReady = false;
function ensureWatchers() {
  if (watchersReady) return;
  watchersReady = true;
  // Aplikasi kembali ke depan → penyedia bisa saja sudah diganti pemilik saat aplikasi di latar.
  AppState.addEventListener('change', (st) => { if (st === 'active') useMapConfigStore.getState().load(); });
}

/** Hook: baca konfigurasi peta dan pastikan sudah/sedang dimuat. */
export function useMapConfig(): MapConfig {
  const config = useMapConfigStore((s) => s.config);
  const load = useMapConfigStore((s) => s.load);
  useEffect(() => { ensureWatchers(); load(); }, [load]);
  return config;
}

/** Muat konfigurasi peta sekali saat aplikasi mulai (dipanggil dari lapisan peta & geo). */
export function primeMapConfig() { ensureWatchers(); void useMapConfigStore.getState().load(); }

/** Atribusi HTML → teks polos untuk ditampilkan di badge React Native. */
export function attributionText(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&copy;/gi, '©')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}
