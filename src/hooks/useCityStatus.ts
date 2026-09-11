// Status wilayah operasi di sekitar pengguna (migrasi 0076–0080).
//
// KENAPA ADA: data tempat (apotek, pasar, minimarket, faskes) diisi untuk seluruh
// Indonesia, tetapi driver baru ada di sebagian kota. Tanpa gerbang ini, pelanggan
// di kota tanpa driver akan memesan lalu pesanannya gagal mencari driver.
//
// GAGAL-AMAN (sengaja terbuka, bukan tertutup):
//   Bila status belum termuat atau RPC-nya gagal, hook ini menganggap layanan
//   TERBUKA. Alasannya: PENEGAKAN SEBENARNYA ADA DI SERVER (create_order menolak
//   lewat city_gate), jadi salah tebak di klien paling buruk berujung pesan galat
//   yang benar dari server — sementara kalau gagal-tertutup, gangguan jaringan
//   sesaat akan membuat aplikasi tampak "tidak melayani" di kota yang justru aktif.
//
// Cache: per petak ±100 m selama 5 menit, supaya berpindah-pindah layar tidak
// memanggil RPC berulang kali.
import { useCallback, useEffect, useState } from 'react';
import { create } from 'zustand';
import { rpc } from '@/lib/supabase';
import type { CityServiceStatus, LatLng, ServiceType } from '@/lib/types';

const TTL_MS = 5 * 60 * 1000;
/** Kunci cache: 3 desimal ≈ 110 m — cukup halus untuk batas kota, cukup kasar untuk hemat panggilan. */
const keyOf = (p: LatLng) => `${p.lat.toFixed(3)},${p.lng.toFixed(3)}`;

interface Entry { status: CityServiceStatus | null; at: number }
interface State {
  cache: Record<string, Entry>;
  loading: Record<string, boolean>;
  load: (p: LatLng, force?: boolean) => Promise<CityServiceStatus | null>;
  clear: () => void;
}

const inflight = new Map<string, Promise<CityServiceStatus | null>>();

export const useCityStatusStore = create<State>((set, get) => ({
  cache: {}, loading: {},
  load: async (p, force = false) => {
    const key = keyOf(p);
    const hit = get().cache[key];
    if (!force && hit && Date.now() - hit.at < TTL_MS) return hit.status;
    const running = inflight.get(key);
    if (running) return running;
    set((s) => ({ loading: { ...s.loading, [key]: true } }));
    const job = (async () => {
      let status: CityServiceStatus | null = null;
      try {
        status = await rpc<CityServiceStatus>('city_service_status', { p_lat: p.lat, p_lng: p.lng });
      } catch {
        // Gagal-aman: biarkan null → semua layanan dianggap terbuka; server tetap menjaga.
        status = null;
      }
      set((s) => ({ cache: { ...s.cache, [key]: { status, at: Date.now() } }, loading: { ...s.loading, [key]: false } }));
      inflight.delete(key);
      return status;
    })();
    inflight.set(key, job);
    return job;
  },
  clear: () => set({ cache: {}, loading: {} }),
}));

/** Muat ulang paksa (mis. sesudah admin membuka kota, atau saat pengguna menarik-segarkan). */
export const reloadCityStatus = () => useCityStatusStore.getState().clear();

export interface UseCityStatus {
  status: CityServiceStatus | null;
  loading: boolean;
  /** true selama status belum pernah termuat untuk titik ini. */
  unknown: boolean;
  /** Kota tempat titik ini berada (null bila di luar jangkauan semua kota). */
  cityName: string | null;
  /** Kota melayani penuh/sebagian — dipakai untuk spanduk beranda. */
  served: boolean;
  /** Layanan ini boleh dipesan dari titik ini? Gagal-aman: true bila status belum diketahui. */
  serviceOpen: (service: ServiceType | string) => boolean;
  /** Kebalikan `serviceOpen`, dipakai untuk menonaktifkan tombol pesan. */
  blocked: (service: ServiceType | string) => boolean;
  reload: () => void;
}

/**
 * Status wilayah pada sebuah titik (biasanya lokasi pengguna atau titik jemput).
 * `point` boleh null — hook menunggu sampai lokasi tersedia.
 */
export function useCityStatus(point?: LatLng | null): UseCityStatus {
  const key = point ? keyOf(point) : '';
  const entry = useCityStatusStore((s) => (key ? s.cache[key] : undefined));
  const loading = useCityStatusStore((s) => (key ? !!s.loading[key] : false));
  const load = useCityStatusStore((s) => s.load);
  const [, force] = useState(0);

  useEffect(() => { if (point) load(point); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const status = entry?.status ?? null;
  const unknown = !entry;

  const serviceOpen = useCallback((service: ServiceType | string) => {
    if (!status) return true;                       // gagal-aman: server tetap menolak bila memang tertutup
    const v = status.services?.[service as string];
    return v === undefined ? status.ok : v;
  }, [status]);

  const reload = useCallback(() => {
    if (point) load(point, true).then(() => force((n) => n + 1));
  }, [point, load]);

  return {
    status, loading, unknown,
    cityName: status?.city_name ?? null,
    served: status ? status.ok : true,
    serviceOpen,
    blocked: (service) => !serviceOpen(service),
    reload,
  };
}

/** Nama layanan siap tampil — cerminan `service_label()` di server. */
export const SERVICE_LABEL: Record<string, string> = {
  ride_motor: 'AntarRide', ride_car: 'AntarCar', food: 'AntarFood', send: 'AntarSend',
  shop: 'AntarShop', market: 'AntarMarket', box: 'AntarBox', travel: 'AntarTravel',
};

/**
 * Judul tombol pesan saat layanan tertutup di kota ini.
 * Alasannya HARUS terlihat di tombol — tombol yang hilang tanpa penjelasan membuat
 * pelanggan mengira aplikasinya rusak. Dipakai layar Ride/Car/Send/Box/Shop/Market/Food/Travel.
 */
export function cityBlockedLabel(status: CityServiceStatus | null, service: ServiceType | string): string {
  if (!status) return 'Belum melayani wilayah ini';
  if (!status.in_range) return 'Di luar wilayah layanan';
  if (status.status !== 'aktif') return `Belum melayani ${status.city_name ?? 'kota ini'}`;
  return `${SERVICE_LABEL[service as string] ?? service} belum dibuka di ${status.city_name ?? 'kota ini'}`;
}
