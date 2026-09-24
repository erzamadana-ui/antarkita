// Pembuatan pesanan yang IDEMPOTEN (migrasi 0083; Standar Testing §6.2 & E2E-07).
//
// Masalah: ketuk ganda tombol "Pesan", atau koneksi putus setelah server menerima
// permintaan tetapi sebelum balasan sampai, membuat DUA pesanan dan DUA potongan dompet.
//
// Cara kerja: setiap percobaan pesan membawa `client_request_id`. Server menyimpan kunci
// itu pada pesanan; permintaan ulang dengan kunci sama mengembalikan pesanan yang sudah ada.
//
// Kunci = nonce sesi + sidik isi pesanan (tanpa bagian yang berubah tiap percobaan seperti
// geometri rute). Jadi:
//   • ulang kirim isi yang SAMA (retry/ketuk ganda)      → kunci sama  → satu pesanan;
//   • pengguna mengubah tujuan/menu lalu memesan lagi   → kunci beda  → pesanan baru;
//   • sesudah satu pesanan BERHASIL, nonce diputar       → pesanan identik berikutnya (disengaja) tetap dibuat.
import { rpc } from './supabase';
import type { Order } from './types';

const VOLATILE = new Set(['route_geometry', 'route_km', 'duration_min', 'client_request_id']);

function stable(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  const o = v as Record<string, unknown>;
  return '{' + Object.keys(o).filter((k) => !VOLATILE.has(k) && o[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + stable(o[k])).join(',') + '}';
}
/** FNV-1a 32-bit — cukup sebagai sidik isi (bukan keamanan). */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}
const rand = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

let nonce = rand();
let lastSuccess: string | null = null;

/** Kunci idempotensi untuk isi pesanan `p` (diekspor untuk uji). */
export function orderRequestKey(p: Record<string, unknown>): string {
  return `${nonce}-${fnv1a(stable(p))}`;
}

/**
 * Ganti `rpc('create_order', { p })`. Menyisipkan `client_request_id` dan memutar nonce
 * setelah berhasil supaya pesanan identik yang memang disengaja tetap bisa dibuat.
 */
export async function createOrder(p: Record<string, unknown>, opts: { adCampaignId?: string | null } = {}): Promise<Order> {
  // Iklan v3 (§7): kampanye yang diklik pelanggan sebelum memesan → server mencatat konversi (orders.ad_campaign_id).
  // create_order menerima satu argumen jsonb `p`, jadi kampanye dikirim sebagai kunci di dalam `p`
  // (`ad_campaign_id`; alias `p_ad_campaign_id` sesuai penamaan kontrak). Tanpa klik iklan → kunci tidak dikirim.
  const body: Record<string, unknown> = opts.adCampaignId ? { ...p, ad_campaign_id: opts.adCampaignId, p_ad_campaign_id: opts.adCampaignId } : p;
  let key = orderRequestKey(body);
  if (key === lastSuccess) { nonce = rand(); key = orderRequestKey(body); }
  const o = await rpc<Order>('create_order', { p: { ...body, client_request_id: key } });
  lastSuccess = key;
  return o;
}

/** Hanya untuk uji: reset status modul. */
export const __resetOrderRequest = () => { nonce = rand(); lastSuccess = null; };
