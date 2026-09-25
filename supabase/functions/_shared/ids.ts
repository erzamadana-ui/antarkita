// Pembuat ID eksternal. Finpay: order.id ≤ 30 karakter, alfanumerik + '-'; tidak ada header idempotency,
// jadi order.id WAJIB unik per percobaan charge.
import { randomHex } from "./crypto.ts";

export const PROVIDER_ORDER_ID_RE = /^[A-Za-z0-9-]{1,30}$/;

/** `<PREFIX>-<base36 epoch ms>-<6 hex>`; contoh AKF-MFY1Q2ZK-3FA9C1 (19 karakter). */
export function newExternalId(prefix = "AKF", now: number = Date.now(), rand: string = randomHex(3)): string {
  const p = prefix.replace(/[^A-Za-z0-9]/g, "").slice(0, 6) || "AKF";
  const id = `${p}-${now.toString(36).toUpperCase()}-${rand.slice(0, 6).toUpperCase()}`;
  if (!PROVIDER_ORDER_ID_RE.test(id)) throw new Error("external_id tidak valid");
  return id;
}

export function isValidProviderOrderId(id: unknown): id is string {
  return typeof id === "string" && PROVIDER_ORDER_ID_RE.test(id);
}
