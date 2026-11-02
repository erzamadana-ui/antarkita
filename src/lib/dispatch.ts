// Dispatch penawaran bertahap & re-assign (migrasi 0122) — helper MURNI + bus kejadian kecil.
//
// Kontrak (docs/KONTRAK-31OKT.md §0122):
//   • driver_available_orders() → kolom offer_id, offer_expires_at, offer_round, offer_seconds_left,
//     dispatch_mode 'offer'|'direct'|'broadcast'. Baris 'offer' = penawaran eksklusif untuk SAYA.
//   • driver_offer_mine() → objek penawaran aktif saya / null.
//   • driver_decline_offer(p_offer, p_reason) → ronde berikutnya seketika.
//   • driver_accept_order driver lain → 'OFFER_HELD: order sedang ditawarkan ke driver lain (N dtk) …'.
//   • Push data.kind 'order_offer' { offer_id, order_id, order_code, round, expires_at, offer_seconds }.
//   • Re-assign: order 'accepted' ≥ dispatch_accept_no_move_minutes (5) tanpa bergerak ≥ 300 m → dilepas
//     (order_events 'driver_released', notifikasi driver data.kind 'accept_no_move').
// Diuji tanpa server: scripts/test-antifraud-parse.mjs.

import type { AvailableOrder } from './types';

/** Alasan tolak penawaran (disimpan ke order_offers.reason / order_rejections.reason). */
export const DECLINE_REASONS = ['Terlalu jauh', 'Arah berlawanan', 'Muatan berat/besar', 'Pembayaran tunai', 'Sedang istirahat', 'Lainnya'] as const;

/** Default setelan server (dispatch_cfg) — hanya untuk teks sebelum nilai asli termuat. */
export const DEFAULT_OFFER_SECONDS = 25;
export const DEFAULT_NO_MOVE_MINUTES = 5;
/** Peringatan lokal tampil 1 menit sebelum server melepas order (accept_no_move). */
export const NO_MOVE_WARN_MINUTES = 4;

/** Bentuk `driver_offer_mine()`. */
export interface DriverOffer {
  offer_id: string; order_id: string; code: string; round: number; offered_at: string; expires_at: string; seconds_left: number;
  service: AvailableOrder['service']; service_label: string; pickup_address: string; dropoff_address: string;
  pickup_lat: number; pickup_lng: number; dropoff_lat: number; dropoff_lng: number;
  distance_km: number; distance_to_pickup_km: number; fare_delivery: number; items_subtotal: number; total: number;
  driver_earning: number; driver_service_share: number | null; payment_method: AvailableOrder['payment_method'];
  merchant_name: string | null; vehicle_class: string | null; helpers: number | null; weight_kg: number | null; notes: string | null; created_at: string;
}

/** Sisa detik penawaran dihitung dari `expires_at` (jam klien) — server mengirim offer_seconds_left hanya saat fetch. */
export function offerSecondsLeft(expiresAt: string | null | undefined, now: number = Date.now()): number {
  if (!expiresAt) return 0;
  const t = new Date(expiresAt).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.ceil((t - now) / 1000));
}

/** Baris penawaran eksklusif untuk saya yang masih berlaku. */
export function isOfferRow(o: Pick<AvailableOrder, 'dispatch_mode' | 'offer_id' | 'offer_expires_at'>, now: number = Date.now()): boolean {
  return o.dispatch_mode === 'offer' && !!o.offer_id && offerSecondsLeft(o.offer_expires_at, now) > 0;
}

/** Pisahkan feed driver: penawaran eksklusif (paling atas) vs siaran/langsung. */
export function splitOffers<T extends Pick<AvailableOrder, 'dispatch_mode' | 'offer_id' | 'offer_expires_at'>>(list: T[], now: number = Date.now()): { offers: T[]; rest: T[] } {
  const offers: T[] = []; const rest: T[] = [];
  for (const o of list) (isOfferRow(o, now) ? offers : rest).push(o);
  return { offers, rest };
}

/** Ubah `driver_offer_mine()` menjadi baris AvailableOrder agar kartu/peta yang sama bisa dipakai. */
export function offerToAvailable(f: DriverOffer, now: number = Date.now()): AvailableOrder {
  return {
    id: f.order_id, code: f.code, service: f.service, pickup_address: f.pickup_address, dropoff_address: f.dropoff_address,
    pickup_lat: f.pickup_lat, pickup_lng: f.pickup_lng, dropoff_lat: f.dropoff_lat, dropoff_lng: f.dropoff_lng, distance_km: Number(f.distance_km) || 0,
    fare_delivery: f.fare_delivery, items_subtotal: f.items_subtotal, total: f.total, driver_earning: f.driver_earning, payment_method: f.payment_method,
    merchant_status: null, created_at: f.created_at, distance_to_pickup_km: Number(f.distance_to_pickup_km) || 0, merchant_name: f.merchant_name,
    vehicle_class: f.vehicle_class, helpers: f.helpers ?? 0, weight_kg: f.weight_kg, driver_service_share: f.driver_service_share,
    priority_note: `Ditawarkan khusus untuk Anda — ronde ${f.round}`,
    offer_id: f.offer_id, offer_expires_at: f.expires_at, offer_round: f.round, offer_seconds_left: offerSecondsLeft(f.expires_at, now), dispatch_mode: 'offer',
  };
}

/** Galat `OFFER_HELD:` → sisa detik penawaran driver lain (null bila bukan OFFER_HELD). */
export function parseOfferHeld(e: unknown): { secondsLeft: number | null; text: string } | null {
  const msg = typeof e === 'string' ? e : ((e as Error)?.message ?? String(e ?? ''));
  if (!/^\s*OFFER_HELD:/.test(msg)) return null;
  const s = /\((\d+)\s*dtk\)/i.exec(msg);
  const secondsLeft = s ? Number(s[1]) : null;
  return { secondsLeft, text: `Order sedang ditawarkan ke driver lain${secondsLeft != null ? ` (${secondsLeft} dtk)` : ''}. Tunggu giliran Anda atau pilih order lain.` };
}
export const isOfferHeld = (e: unknown) => parseOfferHeld(e) !== null;

/**
 * Status timer "Menuju penjemputan" sejak accept (0122 re-assign).
 *  - elapsedMin : menit sejak accepted_at
 *  - warn       : ≥ NO_MOVE_WARN_MINUTES (4) → peringatan kuning "bergerak sekarang"
 *  - critical   : ≥ noMoveMinutes (5) → server dapat melepas order kapan saja
 *  - leftSec    : sisa detik sebelum batas server (0 bila lewat)
 */
export function noMoveState(acceptedAt: string | null | undefined, noMoveMinutes: number = DEFAULT_NO_MOVE_MINUTES, now: number = Date.now()) {
  if (!acceptedAt) return { elapsedMin: 0, elapsedSec: 0, warn: false, critical: false, leftSec: noMoveMinutes * 60 };
  const t = new Date(acceptedAt).getTime();
  const elapsedSec = Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / 1000)) : 0;
  const limit = noMoveMinutes * 60;
  return {
    elapsedMin: Math.floor(elapsedSec / 60), elapsedSec,
    warn: elapsedSec >= NO_MOVE_WARN_MINUTES * 60 && elapsedSec < limit,
    critical: elapsedSec >= limit,
    leftSec: Math.max(0, limit - elapsedSec),
  };
}

/** "0:47" untuk hitung mundur. */
export function mmss(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Data push `kind:'order_offer'` (nilai sudah diratakan ke string oleh push-send). */
export function isOrderOfferPush(data: Record<string, unknown> | null | undefined): boolean {
  return (data?.kind as string | undefined) === 'order_offer';
}

// ----------------------------------------------------------------- bus kejadian (push → hook)
// src/lib/push.ts memanggil emitDispatchEvent('offer') saat push order_offer tiba; hook driver (useDispatchOffer)
// berlangganan dan memanggil driver_offer_mine() seketika tanpa menunggu polling 5 detik.
type DispatchEvent = 'offer' | 'released';
const listeners = new Set<(ev: DispatchEvent, data?: Record<string, unknown>) => void>();
export function onDispatchEvent(fn: (ev: DispatchEvent, data?: Record<string, unknown>) => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
export function emitDispatchEvent(ev: DispatchEvent, data?: Record<string, unknown>) {
  listeners.forEach((fn) => { try { fn(ev, data); } catch { /* noop */ } });
}
