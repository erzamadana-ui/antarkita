// Impor tempat (toko / pasar) dari OpenStreetMap lewat Overpass API, lalu simpan ke server via rpc import_places.
// Semua fungsi menelan error: UI tidak boleh gagal hanya karena peta tidak bisa dihubungi.
import { rpc } from './supabase';

export type OsmKind = 'store' | 'market';
export interface OsmPlace {
  name: string; lat: number; lng: number; osm_id: string;
  brand?: string; category?: string; address?: string; open_hours?: string; phone?: string;
}
export interface OsmImportResult { inserted: number; skipped: number; fetched: number }

const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const TIMEOUT_MS = 12000;
const MAX_PER_CALL = 80;

type OsmElement = { type: 'node' | 'way' | 'relation'; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> };

function buildQuery(kind: OsmKind, lat: number, lng: number, radiusM: number) {
  const around = `(around:${Math.round(radiusM)},${lat},${lng})`;
  const body = kind === 'store'
    ? `node["shop"~"convenience|supermarket|chemist|general"]${around};way["shop"~"convenience|supermarket|chemist|general"]${around};node["amenity"="pharmacy"]${around};way["amenity"="pharmacy"]${around};`
    : `node["amenity"="marketplace"]${around};way["amenity"="marketplace"]${around};node["shop"="market"]${around};way["shop"="market"]${around};`;
  return `[out:json][timeout:${Math.round(TIMEOUT_MS / 1000)}];(${body});out center tags;`;
}

async function postOverpass(endpoint: string, query: string): Promise<OsmElement[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(query), signal: ctrl.signal });
    if (!res.ok) throw new Error(`Overpass ${res.status}`);
    const json = (await res.json()) as { elements?: OsmElement[] };
    return json.elements ?? [];
  } finally { clearTimeout(timer); }
}

function brandOf(tags: Record<string, string>, kind: OsmKind): string | undefined {
  if (kind !== 'store') return undefined;
  const t = `${tags.brand ?? ''} ${tags.name ?? ''}`.toLowerCase();
  if (t.includes('indomaret')) return 'indomaret';
  if (t.includes('alfamart') || t.includes('alfamidi')) return 'alfamart';
  if (t.includes('apotek') || t.includes('apotik') || t.includes('farma') || tags.amenity === 'pharmacy' || tags.shop === 'chemist') return 'apotek';
  if (tags.shop === 'supermarket' || t.includes('supermarket') || t.includes('swalayan') || t.includes('hypermart')) return 'supermarket';
  return 'lainnya';
}
function categoryOf(tags: Record<string, string>, brand: string | undefined): string | undefined {
  if (!brand) return undefined;
  if (brand === 'apotek') return 'apotek';
  if (brand === 'supermarket') return 'supermarket';
  if (brand === 'indomaret' || brand === 'alfamart' || tags.shop === 'convenience') return 'minimarket';
  return 'lainnya';
}
function addressOf(tags: Record<string, string>): string | undefined {
  const parts = [tags['addr:street'], tags['addr:housenumber']].filter(Boolean);
  if (parts.length === 0) return tags['addr:full'] || undefined;
  return parts.join(' ');
}

function mapElements(kind: OsmKind, els: OsmElement[]): OsmPlace[] {
  const out: OsmPlace[] = [];
  const seen = new Set<string>();
  for (const el of els) {
    const tags = el.tags ?? {};
    const name = (tags.name ?? tags['name:id'] ?? tags.brand ?? '').trim();
    if (name.length < 3) continue;
    const lat = el.lat ?? el.center?.lat; const lng = el.lon ?? el.center?.lon;
    if (typeof lat !== 'number' || typeof lng !== 'number') continue;
    const osm_id = `${el.type}/${el.id}`;
    if (seen.has(osm_id)) continue; seen.add(osm_id);
    const brand = brandOf(tags, kind);
    out.push({
      name, lat, lng, osm_id, brand, category: categoryOf(tags, brand), address: addressOf(tags),
      open_hours: tags.opening_hours || undefined, phone: tags.phone || tags['contact:phone'] || undefined,
    });
  }
  return out;
}

/** Ambil daftar toko/pasar dari OpenStreetMap di sekitar titik. Mengembalikan [] bila gagal. */
export async function fetchOsmPlaces(kind: OsmKind, lat: number, lng: number, radiusKm: number): Promise<OsmPlace[]> {
  const query = buildQuery(kind, lat, lng, Math.max(0.5, radiusKm) * 1000);
  for (const ep of ENDPOINTS) {
    try {
      const els = await postOverpass(ep, query);
      return mapElements(kind, els);
    } catch { /* coba endpoint berikutnya */ }
  }
  return [];
}

/** Ambil dari peta lalu simpan ke server (dedup di server). Tidak pernah melempar. */
export async function importOsmPlaces(kind: OsmKind, lat: number, lng: number, radiusKm: number): Promise<OsmImportResult> {
  const result: OsmImportResult = { inserted: 0, skipped: 0, fetched: 0 };
  try {
    const places = await fetchOsmPlaces(kind, lat, lng, radiusKm);
    result.fetched = places.length;
    if (places.length === 0) return result;
    // Urutkan dari yang terdekat agar batas 80 per panggilan memuat tempat paling relevan
    const sorted = [...places].sort((a, b) => Math.hypot(a.lat - lat, a.lng - lng) - Math.hypot(b.lat - lat, b.lng - lng));
    for (let i = 0; i < sorted.length; i += MAX_PER_CALL) {
      const chunk = sorted.slice(i, i + MAX_PER_CALL);
      try {
        const r = await rpc<{ inserted?: number; skipped?: number; disabled?: boolean }>('import_places', { p_kind: kind, p_places: chunk });
        result.inserted += r?.inserted ?? 0; result.skipped += r?.skipped ?? 0;
        if (r?.disabled) break;
      } catch { break; }
    }
  } catch { /* ditelan */ }
  return result;
}
