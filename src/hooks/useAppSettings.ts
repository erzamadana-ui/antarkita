// Pengaturan publik aplikasi (layanan aktif, batas jarak, impor peta, batas AntarSend, ambang permohonan maaf)
// — dimuat sekali, di-cache di modul.
import { useEffect } from 'react';
import { create } from 'zustand';
import { rpc } from '@/lib/supabase';
import type { AppPublicSettings, SendLimit, SendLimits, SendVehicle } from '@/lib/types';

interface State { settings: AppPublicSettings | null; loading: boolean; loadedAt: number; load: (force?: boolean) => Promise<void> }

const STALE_MS = 5 * 60 * 1000;
let inflight: Promise<void> | null = null;

/** Nilai bawaan = default migrasi 0025 (dipakai bila server belum mengirim `send_limits`). */
export const DEFAULT_SEND_LIMITS: SendLimits = {
  motor: { max_kg: 20, max_cm: 60 },
  car: { max_kg: 150, max_cm: 160 },
  box: { max_kg: 1000, max_cm: 300 },
  travel: { max_kg: 30, max_cm: 120 },
};
const DEFAULT_WAIT_APOLOGY_MIN = 5;

const num = (v: unknown, fallback: number) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : fallback; };
function normalizeSendLimits(raw: unknown): SendLimits {
  const src = (raw ?? {}) as Partial<Record<SendVehicle, Partial<SendLimit>>>;
  const one = (k: SendVehicle): SendLimit => ({
    max_kg: num(src?.[k]?.max_kg, DEFAULT_SEND_LIMITS[k].max_kg),
    max_cm: num(src?.[k]?.max_cm, DEFAULT_SEND_LIMITS[k].max_cm),
  });
  return { motor: one('motor'), car: one('car'), box: one('box'), travel: one('travel') };
}

export const useAppSettingsStore = create<State>((set, get) => ({
  settings: null, loading: false, loadedAt: 0,
  load: async (force = false) => {
    const { loadedAt } = get();
    if (!force && loadedAt && Date.now() - loadedAt < STALE_MS) return;
    if (inflight) return inflight;
    set({ loading: true });
    inflight = (async () => {
      try {
        const r = await rpc<Partial<AppPublicSettings> | null>('app_public_settings');
        set({
          settings: {
            services_enabled: r?.services_enabled ?? {},
            max_km: r?.max_km ?? {},
            osm_import_enabled: r?.osm_import_enabled ?? true,
            osm_import_radius_km: Number(r?.osm_import_radius_km ?? 5) || 5,
            pickup_radius_km: r?.pickup_radius_km ?? {},
            send_limits: normalizeSendLimits(r?.send_limits),
            priority_tiers: Array.isArray(r?.priority_tiers) ? r!.priority_tiers : [],
            wait_apology_minutes: num(r?.wait_apology_minutes, DEFAULT_WAIT_APOLOGY_MIN),
          },
          loadedAt: Date.now(),
        });
      } catch { /* pakai nilai lama / default: semua layanan dianggap aktif */ }
      finally { set({ loading: false }); inflight = null; }
    })();
    return inflight;
  },
}));

/** Urutan kendaraan AntarSend dari yang paling kecil. */
const SEND_ORDER: SendVehicle[] = ['motor', 'car', 'box'];

/** Kendaraan terkecil yang sanggup membawa paket, atau null bila melebihi semua batas (cerminan `send_required_vehicle`). */
export function requiredSendVehicle(weightKg: number, sizeCm: number, limits: SendLimits): SendVehicle | null {
  return SEND_ORDER.find((v) => weightKg <= limits[v].max_kg && sizeCm <= limits[v].max_cm) ?? null;
}
/** Muat batas mitra travel (titipan door to door)? */
export const fitsTravel = (weightKg: number, sizeCm: number, limits: SendLimits) =>
  weightKg <= limits.travel.max_kg && sizeCm <= limits.travel.max_cm;

/** Baca pengaturan publik. `isEnabled` bernilai true bila belum dimuat atau kunci tidak ada (gagal aman). */
export function useAppSettings() {
  const settings = useAppSettingsStore((s) => s.settings);
  const loading = useAppSettingsStore((s) => s.loading);
  const load = useAppSettingsStore((s) => s.load);
  useEffect(() => { load(); }, [load]);
  const isEnabled = (service: string) => settings?.services_enabled?.[service] !== false;
  const maxKm = (service: string): number | null => { const v = settings?.max_km?.[service]; return typeof v === 'number' && v > 0 ? v : null; };
  const sendLimits = settings?.send_limits ?? DEFAULT_SEND_LIMITS;
  const waitApologyMinutes = settings?.wait_apology_minutes ?? DEFAULT_WAIT_APOLOGY_MIN;
  return { settings, loading, isEnabled, maxKm, sendLimits, waitApologyMinutes, reload: () => load(true) };
}
