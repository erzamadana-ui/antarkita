// KPI Manager Kota (migrasi 0118) — pembungkus RPC & tipe untuk Panel Admin (/kpi-kota) dan Portal Eksekutif.
// Kontrak: admin_city_manager_kpi(p_month, p_city) · admin_set_city_manager_kpi(p) · city_manager_kpi_summary(p_month)
//          exec_city_manager_kpi(p_exec_token, p_month). Penunjukan manager tetap lewat admin_set_city_manager (0079).
import { rpc } from '@/lib/supabase';

export type KpiComponent = 'merchant_new' | 'driver_new' | 'merchant_active' | 'driver_active' | 'orders';
export const KPI_COMPONENTS: KpiComponent[] = ['merchant_new', 'driver_new', 'merchant_active', 'driver_active', 'orders'];
export const KPI_LABEL: Record<KpiComponent, string> = {
  merchant_new: 'Merchant baru', driver_new: 'Driver baru', merchant_active: 'Merchant aktif', driver_active: 'Driver aktif', orders: 'Order selesai',
};
export type KpiGrade = 'A' | 'B' | 'C' | 'D';
export type KpiComponents = Record<KpiComponent, number>;

export interface CityManagerKpiRow {
  city_id: string;
  city_name: string;
  manager_id: string | null;
  manager_name: string | null;
  month: string;
  targets: Partial<KpiComponents> | null;
  actual: Partial<KpiComponents> | null;
  /** Persen capaian per komponen (maks 120); null bila target komponen itu 0 (dilewati dari skor). */
  pct: Partial<Record<KpiComponent, number | null>> | null;
  score: number | null;
  grade: KpiGrade | null;
  bonus_pool: number | null;
  bonus_earned: number | null;
  has_target: boolean;
  weights: Partial<Record<'merchant_new' | 'driver_new' | 'active' | 'orders', number>> | null;
  note?: string | null;
  updated_at?: string | null;
}

/** Hasil city_manager_kpi_summary(p_month) — bentuk persis migrasi 0118. */
export interface CityManagerKpiSummary {
  month: string;
  cities_total: number;
  cities_with_target: number;
  cities_with_manager: number;
  avg_score: number | null;
  grades: Partial<Record<KpiGrade, number>> | null;
  total_bonus_pool: number;
  total_bonus_earned: number;
  actual: { merchant_new: number; driver_new: number; orders: number } | null;
}

export interface SetCityManagerKpiInput {
  city_id: string;
  /** 'YYYY-MM-01' */
  month: string;
  target_merchant_new: number;
  target_driver_new: number;
  target_merchant_active: number;
  target_driver_active: number;
  target_orders: number;
  weight_merchant_new: number;
  weight_driver_new: number;
  weight_active: number;
  weight_orders: number;
  bonus_pool: number;
  note?: string | null;
}

/** Bobot bawaan form (jumlah 100) = default kolom tabel city_manager_kpi_targets (0118): 30 / 30 / 20 / 20. */
export const KPI_DEFAULT_WEIGHTS = { weight_merchant_new: 30, weight_driver_new: 30, weight_active: 20, weight_orders: 20 } as const;
/** Ambang grade (0118): A ≥ 100, B ≥ 80, C ≥ 60, D < 60. Capaian per komponen dibatasi 120 %. Bonus = pool × min(skor,120)/100 bila skor ≥ 60. */
export const KPI_GRADE_RULE = 'A ≥ 100 · B ≥ 80 · C ≥ 60 · D < 60';

export const GRADE_COLOR: Record<KpiGrade, string> = { A: '#17A673', B: '#2F6FED', C: '#D9880B', D: '#DC4B50' };

const asArray = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

export const adminCityManagerKpi = async (month: string | null, cityId: string | null = null) =>
  asArray<CityManagerKpiRow>(await rpc('admin_city_manager_kpi', { p_month: month, p_city: cityId }));
export const adminSetCityManagerKpi = (p: SetCityManagerKpiInput) => rpc<unknown>('admin_set_city_manager_kpi', { p });
export const cityManagerKpiSummary = (month: string) => rpc<CityManagerKpiSummary | null>('city_manager_kpi_summary', { p_month: month });
export const execCityManagerKpi = async (execToken: string, month: string) =>
  asArray<CityManagerKpiRow>(await rpc('exec_city_manager_kpi', { p_exec_token: execToken, p_month: month }));

/** Urutan peringkat: skor tertinggi dulu; kota tanpa target di bawah. */
export const rankKpi = (rows: CityManagerKpiRow[]) =>
  [...rows].sort((a, b) => Number(b.has_target) - Number(a.has_target) || Number(b.score ?? -1) - Number(a.score ?? -1) || a.city_name.localeCompare(b.city_name));
