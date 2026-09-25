import assert from "node:assert/strict";
import { hmacSha512Hex, sha512Hex } from "../_shared/crypto.ts";
import { routeAfter, timingSafeEqual } from "../_shared/http.ts";
import { isValidProviderOrderId, newExternalId } from "../_shared/ids.ts";
import { redact, redactString, registerSecret } from "../_shared/log.ts";

Deno.test("sha512: vektor NIST 'abc'", async () => {
  assert.equal(await sha512Hex("abc"),
    "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f");
});

Deno.test("hmac-sha512: RFC 4231 test case 2", async () => {
  assert.equal(await hmacSha512Hex("Jefe", "what do ya want for nothing?"),
    "164b7a7bfcf819e2e395fbe73b56e0a387bd64222e831fd610270cd7ea2505549758bf75c05a994a6d034f65f8f0e6fdcaeab1a34d4a6b4b636e070a38bce737");
});

Deno.test("timingSafeEqual: sama/beda/panjang beda/kosong/bytes", () => {
  assert.equal(timingSafeEqual("abcdef", "abcdef"), true);
  assert.equal(timingSafeEqual("abcdef", "abcdeg"), false);
  assert.equal(timingSafeEqual("abc", "abcdef"), false);
  assert.equal(timingSafeEqual("abcdef", "abc"), false);
  assert.equal(timingSafeEqual("", ""), true);
  assert.equal(timingSafeEqual("", "a"), false);
  assert.equal(timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3])), true);
  assert.equal(timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4])), false);
  // prefiks tidak lolos (panjang ikut dibandingkan)
  assert.equal(timingSafeEqual("a\u0000", "a"), false);
});

Deno.test("routeAfter: path Supabase functions", () => {
  assert.equal(routeAfter(new Request("https://x.supabase.co/functions/v1/pay-webhook/finpay"), "pay-webhook"), "finpay");
  assert.equal(routeAfter(new Request("https://x.supabase.co/pay-webhook/finpay-disbursement?x=1"), "pay-webhook"), "finpay-disbursement");
  assert.equal(routeAfter(new Request("https://x.supabase.co/functions/v1/pay-webhook"), "pay-webhook"), "");
});

Deno.test("external_id: format AKF-<base36>-<6hex>, ≤30 char, unik", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 500; i++) {
    const id = newExternalId();
    assert.ok(id.length <= 30, id);
    assert.match(id, /^AKF-[0-9A-Z]+-[0-9A-F]{6}$/);
    assert.ok(isValidProviderOrderId(id));
    seen.add(id);
  }
  assert.equal(seen.size, 500);
  // Tanggal jauh ke depan tetap ≤ 30
  const far = newExternalId("AKD", Date.parse("2999-12-31T23:59:59Z"), "abcdef");
  assert.ok(far.length <= 30);
  assert.equal(newExternalId("AKF", 0, "00ff00"), "AKF-0-00FF00");
  assert.equal(isValidProviderOrderId("AKORD-1727150000000-1a2b3c4d-XXXXXXXX"), false); // > 30
  assert.equal(isValidProviderOrderId("AK_1"), false); // underscore dilarang
});

Deno.test("redaksi log: kunci sensitif, PII, PAN, JWT, kunci Midtrans, secret terdaftar", () => {
  registerSecret("FinpayMerchantKey-SUPER-SECRET-999");
  const out = redact({
    merchantKey: "abc", server_key: "SB-Mid-server-xyz", Authorization: "Basic QUJDOkRFRg==", signature: "deadbeef",
    signature_ok: true, external_id: "AKF-1-ABCDEF", amount: 150000,
    email: "budi.santoso@example.com", mobilePhone: "+6281234567890", bank_account: "1234567890",
    card: { number: "4111 1111 1111 1111", cvv: "123", pan: "4111111111111111" },
    note: "error with key FinpayMerchantKey-SUPER-SECRET-999 and card 4111-1111-1111-1111 token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig12345 Bearer abcdefghijkl",
    nested: [{ api_key: "k", ok: "SB-Mid-client-abc123" }],
    // deno-lint-ignore no-explicit-any
  }) as Record<string, any>;
  assert.equal(out.merchantKey, "[REDACTED]");
  assert.equal(out.server_key, "[REDACTED]");
  assert.equal(out.Authorization, "[REDACTED]");
  assert.equal(out.signature, "[REDACTED]");
  assert.equal(out.signature_ok, true);
  assert.equal(out.external_id, "AKF-1-ABCDEF");
  assert.equal(out.amount, 150000);
  assert.equal(out.email, "b***@example.com");
  assert.ok(String(out.mobilePhone).endsWith("7890") && !String(out.mobilePhone).includes("812345"));
  assert.ok(String(out.bank_account).endsWith("7890") && !String(out.bank_account).includes("123456"));
  assert.equal(out.card.cvv, "[REDACTED]");
  assert.equal(out.card.pan, "[REDACTED]");
  assert.equal(out.card.number, "[PAN ****1111]");
  const note = String(out.note);
  assert.ok(!note.includes("SUPER-SECRET"), note);
  assert.ok(!note.includes("4111-1111"), note);
  assert.ok(note.includes("[REDACTED_JWT]"), note);
  assert.ok(note.includes("Bearer [REDACTED]"), note);
  assert.equal(out.nested[0].api_key, "[REDACTED]");
  assert.equal(out.nested[0].ok, "[REDACTED_MIDTRANS_KEY]");
});

Deno.test("redaksi: angka biasa (bukan Luhn) tidak disensor; siklus aman", () => {
  assert.equal(redactString("order 1234567890123 total"), "order 1234567890123 total"); // 13 digit, bukan Luhn
  const a: Record<string, unknown> = { x: 1 };
  a.self = a;
  assert.deepEqual(redact(a), { x: 1, self: "[circular]" });
});
