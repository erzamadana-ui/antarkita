// Tarif AntarTravel per km & rate card (migrasi 0124) — tipe & helper MURNI.
//
// Kontrak (docs/KONTRAK-31OKT.md §0124):
//   travel_quote(p_from, p_to, p_model, p_mode 'charter'|'shared', p_pax) → TravelQuote (anon + authenticated)
//   travel_rate_cards_public() → { road_factor, shared_markup_pct, tolerance_pct, offer_min_pct, cards[] }
//   travel_trip_create: seat_price/private_price kosong → default quote; diisi → ±travel_price_tolerance_pct (10 %)
//     selain itu 'TRAVEL_PRICE_OUT_OF_RANGE: … — rentang RpA–RpB'
//   travel_offer_create: tawaran < travel_offer_min_pct (90 %) quote carter → 'TRAVEL_OFFER_TOO_LOW: … (minimal RpX)'
// Diuji tanpa server: scripts/test-antifraud-parse.mjs.

export interface TravelQuoteBreakdownRow { key: string; label: string; amount: number }
export interface TravelQuote {
  from_city: { id: string; name: string }; to_city: { id: string; name: string };
  km: number; km_source: 'route' | 'haversine'; km_haversine_x_factor: number; road_factor: number; route_id: string | null;
  rate_card_id: string; model: string; seats: number; mode: 'shared' | 'charter'; pax: number;
  per_km: number; base_fare: number; min_fare: number; charter_multiplier: number; shared_markup_pct: number;
  fare_vehicle: number; fare_total: number; fare_per_seat: number; fare: number;
  customer_platform_fee: number; customer_total: number; commission: number; platform_fee: number; ppn: number; platform_revenue_net: number;
  driver_net: number; driver_share_pct_actual: number; tolerance_pct: number; offer_min_pct: number;
  breakdown: TravelQuoteBreakdownRow[]; quoted_at: string;
}
export interface TravelRateCardPublic { id: string; vehicle_model: string; seats: number; per_km: number; base_fare: number; min_fare: number; charter_multiplier: number; customer_platform_fee: number }
export interface TravelRateCardsPublic { road_factor: number; shared_markup_pct: number; tolerance_pct: number; offer_min_pct: number; cards: TravelRateCardPublic[] }

/** Rentang harga yang diterima server untuk harga acuan `ref` dengan toleransi ± tol %. (floor/ceil seperti travel_trip_prices) */
export function priceRange(ref: number, tolPct: number): { min: number; max: number } {
  const r = Math.max(0, Number(ref) || 0); const t = Math.max(0, Number(tolPct) || 0);
  return { min: Math.floor(r * (100 - t) / 100), max: Math.ceil(r * (100 + t) / 100) };
}
/** Apakah harga mitra berada dalam rentang ± toleransi dari acuan. */
export function priceInRange(price: number, ref: number, tolPct: number): boolean {
  const { min, max } = priceRange(ref, tolPct);
  return price >= min && price <= max;
}
/** Tawaran carter minimum = ceil(quote × offer_min_pct %). (cermin travel_offer_quote_guard) */
export function offerMinPrice(quoteTotal: number, minPct: number): number {
  return Math.ceil((Math.max(0, Number(quoteTotal) || 0) * (Number(minPct) || 0)) / 100);
}

export type TravelPriceErrorCode = 'TRAVEL_PRICE_OUT_OF_RANGE' | 'TRAVEL_OFFER_TOO_LOW' | 'TRAVEL_QUOTE';
export interface ParsedTravelPriceError { code: TravelPriceErrorCode; text: string; min: number | null; max: number | null; reference: number | null }

const rp = (s: string) => Number(s.replace(/\./g, ''));

/** Pecah galat harga travel dari server → kode + rentang/minimum (bila ada). null bila bukan galat travel. */
export function parseTravelPriceError(e: unknown): ParsedTravelPriceError | null {
  const msg = typeof e === 'string' ? e : ((e as Error)?.message ?? String(e ?? ''));
  const m = /^\s*(TRAVEL_PRICE_OUT_OF_RANGE|TRAVEL_OFFER_TOO_LOW|TRAVEL_QUOTE):\s*(.*)$/s.exec(msg);
  if (!m) return null;
  const code = m[1] as TravelPriceErrorCode; const text = m[2].trim();
  if (code === 'TRAVEL_PRICE_OUT_OF_RANGE') {
    const range = /rentang Rp([\d.]+)\s*[–-]\s*Rp([\d.]+)/i.exec(text);
    const ref = /acuan Rp([\d.]+)/i.exec(text);
    return { code, text, min: range ? rp(range[1]) : null, max: range ? rp(range[2]) : null, reference: ref ? rp(ref[1]) : null };
  }
  if (code === 'TRAVEL_OFFER_TOO_LOW') {
    const min = /minimal Rp([\d.]+)/i.exec(text);
    const ref = /Rp([\d.]+)\s*\(minimal/i.exec(text);
    return { code, text, min: min ? rp(min[1]) : null, max: null, reference: ref ? rp(ref[1]) : null };
  }
  return { code, text, min: null, max: null, reference: null };
}

/** Pilih kartu tarif yang cocok dengan model mobil mitra (cocokkan kata kunci; null bila tak ada). */
export function matchRateCard(cards: TravelRateCardPublic[] | null | undefined, vehicleModel: string | null | undefined): TravelRateCardPublic | null {
  if (!cards?.length) return null;
  const m = (vehicleModel ?? '').toLowerCase();
  if (!m) return null;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const words = norm(m).split(' ').filter((w) => w.length >= 3);
  let best: TravelRateCardPublic | null = null; let bestScore = 0;
  for (const c of cards) {
    const cw = norm(c.vehicle_model).split(' ').filter((w) => w.length >= 3);
    const score = cw.filter((w) => words.some((x) => x.includes(w) || w.includes(x))).length;
    if (score > bestScore) { best = c; bestScore = score; }
  }
  return best;
}

/** Baris ringkas rincian quote untuk pelanggan (tanpa komisi internal mitra). */
export function customerQuoteRows(q: TravelQuote): { label: string; value: number; hint?: string }[] {
  const rows: { label: string; value: number; hint?: string }[] = [];
  rows.push({ label: `Jarak ${formatKm(q.km)} km × Rp${q.per_km.toLocaleString('id-ID')}/km`, value: Math.ceil(q.km) * q.per_km, hint: q.km_source === 'route' ? 'Jarak rute resmi' : `Estimasi jalan (pusat kota × ${q.road_factor})` });
  rows.push({ label: 'Tarif dasar', value: q.base_fare });
  if (q.mode === 'charter') {
    rows.push({ label: `Tarif carter ${q.model} (${q.seats} kursi)`, value: q.fare_total, hint: q.charter_multiplier !== 1 ? `Pengali carter ×${q.charter_multiplier}` : undefined });
  } else {
    rows.push({ label: `Tarif per kursi ${q.model}`, value: q.fare_per_seat, hint: `Mobil ${rupiahShort(q.fare_vehicle)} ÷ ${q.seats} kursi + ${q.shared_markup_pct} %` });
    rows.push({ label: `${q.pax} kursi`, value: q.fare });
  }
  rows.push({ label: 'Biaya aplikasi', value: q.customer_platform_fee });
  return rows;
}

export const formatKm = (km: number) => (Math.round(Number(km) * 10) / 10).toLocaleString('id-ID');
const rupiahShort = (n: number) => `Rp${Math.round(n).toLocaleString('id-ID')}`;
