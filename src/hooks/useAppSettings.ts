// Pengaturan publik aplikasi (layanan aktif, batas jarak, impor peta) — dimuat sekali, di-cache di modul.
import { useEffect } from 'react';
import { create } from 'zustand';
import { rpc } from '@/lib/supabase';
import type { AppPublicSettings } from '@/lib/types';

interface State { settings: AppPublicSettings | null; loading: boolean; loadedAt: number; load: (force?: boolean) => Promise<void> }

const STALE_MS = 5 * 60 * 1000;
let inflight: Promise<void> | null = null;

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
          },
          loadedAt: Date.now(),
        });
      } catch { /* pakai nilai lama / default: semua layanan dianggap aktif */ }
      finally { set({ loading: false }); inflight = null; }
    })();
    return inflight;
  },
}));

/** Baca pengaturan publik. `isEnabled` bernilai true bila belum dimuat atau kunci tidak ada (gagal aman). */
export function useAppSettings() {
  const settings = useAppSettingsStore((s) => s.settings);
  const loading = useAppSettingsStore((s) => s.loading);
  const load = useAppSettingsStore((s) => s.load);
  useEffect(() => { load(); }, [load]);
  const isEnabled = (service: string) => settings?.services_enabled?.[service] !== false;
  const maxKm = (service: string): number | null => { const v = settings?.max_km?.[service]; return typeof v === 'number' && v > 0 ? v : null; };
  return { settings, loading, isEnabled, maxKm, reload: () => load(true) };
}
