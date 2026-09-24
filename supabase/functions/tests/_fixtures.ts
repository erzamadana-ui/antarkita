// Fixture callback Finpay buatan sendiri (merchantKey uji) — bukan data Finpay asli.
import { hmacSha512Hex } from "../_shared/crypto.ts";
import { phpJsonEncode } from "../_shared/jsonutil.ts";

export const KEY = "TEST-Finpay-MerchantKey-0123456789";

/** Fixture callback: field dengan '/', unicode (BMP & astral), kutip, backslash, newline, objek kosong. */
export const FIELDS = {
  order: { id: "AKF-MFY1Q2ZK-3FA9C1", amount: 150000, description: "Nasi Goreng / Es Teh — \"Gula Aren\" ☕ 😀 C:\\path\nbaris2" },
  customer: { email: "budi/andi@example.com", firstName: "Budi", lastName: "Śantoso" },
  meta: { data: { url: "https://antarkita.id/a/b?x=1&y=2" } },
  card: {},
  result: { payment: { status: "PAID", amount: 150000, datetime: "2026-09-24 10:00:00", reference: "FP-REF/001" } },
};

export async function signedPhpBody(fields: Record<string, unknown> = FIELDS, key = KEY, opts = {}) {
  const signed = phpJsonEncode(fields, opts);
  const sig = await hmacSha512Hex(key, signed);
  return { signed, sig, body: signed.slice(0, -1) + `,"signature":"${sig}"}` };
}
