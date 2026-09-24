import assert from "node:assert/strict";
import { hmacSha512Hex } from "../_shared/crypto.ts";
import { phpJsonEncode, removeTopLevelField } from "../_shared/jsonutil.ts";
import {
  bankCodeOf, FinpayProvider, finpayChannelToInternal, mapFinpayChannel, normalizeDisbursementStatus, normalizeFinpayStatus,
  verifyFinpaySignature,
} from "../_shared/providers/finpay.ts";
import { jsonRes, mockFetch, quiet } from "./_mock.ts";

import { FIELDS, KEY, signedPhpBody } from "./_fixtures.ts";

Deno.test("phpJsonEncode: escape '/', unicode per unit UTF-16 (huruf kecil), kontrol", () => {
  assert.equal(phpJsonEncode({ a: "x/y", b: "é", c: "😀", d: "\"\\\n\t\u0001", e: null, f: [1, true], g: {} }),
    '{"a":"x\\/y","b":"\\u00e9","c":"\\ud83d\\ude00","d":"\\"\\\\\\n\\t\\u0001","e":null,"f":[1,true],"g":{}}');
  assert.equal(phpJsonEncode({ g: {} }, { emptyObjectAsArray: true }), '{"g":[]}');
  assert.equal(phpJsonEncode("~\u007f"), '"~\u007f"'); // DEL tidak di-escape PHP
});

Deno.test("removeTopLevelField: akhir / tengah / awal / satu-satunya / bersarang tidak tersentuh", () => {
  assert.equal(removeTopLevelField('{"a":1,"signature":"x"}', "signature"), '{"a":1}');
  assert.equal(removeTopLevelField('{"a":1,"signature":"x","b":{"signature":"keep"}}', "signature"), '{"a":1,"b":{"signature":"keep"}}');
  assert.equal(removeTopLevelField('{"signature":"x","a":"s,}\\"q"}', "signature"), '{"a":"s,}\\"q"}');
  assert.equal(removeTopLevelField('{"signature":"x"}', "signature"), "{}");
  assert.equal(removeTopLevelField('{"a":{"signature":1}}', "signature"), null);
  assert.equal(removeTopLevelField("[1,2]", "signature"), null);
  assert.equal(removeTopLevelField('{"a": [1, {"b": "}"}] , "signature" : "x" }', "signature"), '{"a": [1, {"b": "}"}]  }');
});

Deno.test("signature Finpay (a): body PHP apa adanya → lolos via raw-strip", async () => {
  const { body } = await signedPhpBody();
  assert.ok(body.includes("\\/") && body.includes("\\u"), "fixture harus mengandung escape PHP");
  const r = await verifyFinpaySignature(body, KEY);
  assert.equal(r.ok, true);
  assert.equal(r.via, "raw-strip");
});

Deno.test("signature Finpay (b): body diserialisasi ulang tanpa escape (JSON.stringify) → lolos via php-encode", async () => {
  const { sig } = await signedPhpBody();
  const body = JSON.stringify({ ...FIELDS, signature: sig });
  assert.ok(body.includes("https://antarkita.id/a/b") && body.includes("☕"));
  const r = await verifyFinpaySignature(body, KEY);
  assert.equal(r.ok, true);
  assert.equal(r.via, "php-encode");
});

Deno.test("signature Finpay: body pretty-printed & signature di tengah", async () => {
  const { sig } = await signedPhpBody();
  const pretty = JSON.stringify({ ...FIELDS, signature: sig }, null, 2);
  assert.equal((await verifyFinpaySignature(pretty, KEY)).ok, true);
  // signature di tengah: pengirim menandatangani objek tanpa signature dengan urutan asli
  const { order, customer, ...rest } = FIELDS;
  const signedMid = phpJsonEncode({ order, customer, ...rest });
  const s2 = await hmacSha512Hex(KEY, signedMid);
  const mid = phpJsonEncode({ order, signature: s2, customer, ...rest });
  const r = await verifyFinpaySignature(mid, KEY);
  assert.equal(r.ok, true);
  assert.equal(r.via, "raw-strip");
});

Deno.test("signature Finpay: pengirim assoc-array (objek kosong → []) tetapi body berisi {}", async () => {
  const { sig } = await signedPhpBody(FIELDS, KEY, { emptyObjectAsArray: true });
  const body = phpJsonEncode({ ...FIELDS, signature: sig });
  const r = await verifyFinpaySignature(body, KEY);
  assert.equal(r.ok, true);
  assert.equal(r.via, "php-encode-assoc");
});

Deno.test("signature Finpay: huruf besar diterima; tamper/kunci salah/tanpa signature/format salah ditolak", async () => {
  const { body, sig } = await signedPhpBody();
  assert.equal((await verifyFinpaySignature(body.replace(sig, sig.toUpperCase()), KEY)).ok, true);
  const tampered = body.replace('"amount":150000', '"amount":1500000');
  assert.equal((await verifyFinpaySignature(tampered, KEY)).ok, false);
  assert.equal((await verifyFinpaySignature(body.replace('"PAID"', '"PAID "'), KEY)).ok, false);
  assert.equal((await verifyFinpaySignature(body, KEY + "x")).ok, false);
  assert.equal((await verifyFinpaySignature(body, "")).reason, "merchant_key_missing");
  const noSig = phpJsonEncode(FIELDS);
  assert.equal((await verifyFinpaySignature(noSig, KEY)).reason, "signature_missing_or_malformed");
  assert.equal((await verifyFinpaySignature(body.replace(sig, sig.slice(0, 64)), KEY)).reason, "signature_missing_or_malformed");
  assert.equal((await verifyFinpaySignature("not json", KEY)).reason, "body_not_object");
});

Deno.test("verifyNotification Finpay: ekstraksi externalId/status/amount + eventId deterministik", async () => {
  const p = new FinpayProvider({ env: "sandbox", merchantId: "M1", serverKey: KEY });
  const { body } = await signedPhpBody();
  const a = await p.verifyNotification(body, new Headers());
  const b = await p.verifyNotification(body, new Headers());
  assert.equal(a.ok, true);
  assert.equal(a.externalId, "AKF-MFY1Q2ZK-3FA9C1");
  assert.equal(a.providerStatus, "PAID");
  assert.equal(a.amount, 150000);
  assert.equal(a.eventId, b.eventId);
  assert.match(a.eventId, /^cb-AKF-MFY1Q2ZK-3FA9C1-PAID-[0-9a-f]{16}$/);
});

Deno.test("normalisasi status Finpay (KONTRAK §3)", () => {
  const cases: [string, string | null][] = [
    ["PAID", "PAID"], ["CAPTURED", "PAID"], ["AUTHORIZED", "PENDING"], ["PENDING", "PENDING"], ["FAILURE", "FAILED"],
    ["EXPIRED", "EXPIRED"], ["CANCELLED", "FAILED"], ["REFUNDED", "REFUNDED"], ["PARTIALLY_REFUNDED", "PARTIALLY_REFUNDED"],
    ["paid", "PAID"], ["partially refunded", "PARTIALLY_REFUNDED"], ["WHATEVER", null], ["", null],
  ];
  for (const [i, o] of cases) assert.equal(normalizeFinpayStatus(i), o, i);
});

Deno.test("pemetaan channel Finpay: default, VA dinamis, tidak didukung, override", () => {
  assert.deepEqual(mapFinpayChannel("qris", null), { supported: true, code: "qris" });
  assert.equal(mapFinpayChannel("card", null).code, "cc");
  assert.equal(mapFinpayChannel("finpay_money", null).code, "finpaymoney");
  assert.equal(mapFinpayChannel("retail_alfamart", null).code, "alfamart");
  assert.equal(mapFinpayChannel("retail_indomaret", null).code, "indomaret");
  assert.equal(mapFinpayChannel("paylater_kredivo", null).code, "kredivo");
  assert.equal(mapFinpayChannel("paylater_indodana", null).code, "indodana");
  for (const c of ["shopeepay", "ovo", "dana", "linkaja"]) assert.equal(mapFinpayChannel(c, null).code, c);
  assert.equal(mapFinpayChannel("bank_transfer", "BCA").code, "va_bca");
  assert.equal(mapFinpayChannel("bank_transfer", "bsi").code, "va_bsi");
  assert.deepEqual({ ...mapFinpayChannel("bank_transfer", null), note: undefined }, { supported: true, code: null, note: undefined });
  assert.equal(mapFinpayChannel("bank_transfer", "jago").supported, false);
  assert.equal(mapFinpayChannel("gopay", null).supported, false);
  assert.equal(mapFinpayChannel("bitcoin", null).supported, false);
  assert.equal(mapFinpayChannel("va_mandiri", null).code, "va_mandiri"); // kode langsung
  assert.equal(mapFinpayChannel(null, null).code, null);
  // override dari gateway_secrets.extra.channel_map
  const ov = { gopay: "qris", card: "credit_card", ovo: null, bank_transfer: "va_permata" };
  assert.equal(mapFinpayChannel("gopay", null, ov).code, "qris");
  assert.equal(mapFinpayChannel("card", null, ov).code, "credit_card");
  assert.equal(mapFinpayChannel("ovo", null, ov).supported, false);
  assert.equal(mapFinpayChannel("bank_transfer", "bca", ov).code, "va_permata");
  // kebalikan
  assert.equal(finpayChannelToInternal("va_bri"), "bank_transfer");
  assert.equal(finpayChannelToInternal("cc"), "card");
  assert.equal(finpayChannelToInternal("finpaymoney"), "finpay_money");
  assert.equal(finpayChannelToInternal("zzz"), null);
});

Deno.test("status disbursement & kode bank", () => {
  assert.equal(normalizeDisbursementStatus("00"), "PAYOUT_SETTLED");
  assert.equal(normalizeDisbursementStatus("03"), "PAYOUT_PROCESSING");
  assert.equal(normalizeDisbursementStatus("08"), "PAYOUT_PROCESSING");
  assert.equal(normalizeDisbursementStatus("04"), "PAYOUT_FAILED");
  assert.equal(normalizeDisbursementStatus("06"), "PAYOUT_FAILED");
  assert.equal(normalizeDisbursementStatus("99"), null);
  assert.equal(bankCodeOf("BCA"), "014");
  assert.equal(bankCodeOf("Bank Mandiri"), "008");
  assert.equal(bankCodeOf("bank syariah indonesia"), "451");
  assert.equal(bankCodeOf("014"), "014");
  assert.equal(bankCodeOf("Bank Antah"), null);
  assert.equal(bankCodeOf("Bank Antah", { antah: "999" }), "999");
});

Deno.test("FinpayProvider.createCharge: Basic auth, body sesuai kontrak, respons adaptif", async () => {
  const restore = quiet();
  try {
    const m = mockFetch([{ match: /\/pg\/payment\/card\/initiate$/, method: "POST", respond: () => jsonRes({ responseCode: "2000000", responseMessage: "Success", redirecturl: "https://devo.finnet.co.id/pay/abc", expiryLink: "2026-09-24 10:15:00", stringQr: "00020101021226..." }) }]);
    const p = new FinpayProvider({ env: "sandbox", merchantId: "MID1", serverKey: KEY, fetch: m.fetch, notificationUrl: "https://proj.supabase.co/functions/v1/pay-webhook/finpay" });
    const r = await p.createCharge({ externalId: "AKF-X-000001", amount: 150000, channel: "qris", description: "Pesanan", expiryMinutes: 15, customer: { firstName: "Budi Santoso", email: "b@x.id", phone: "0812-3456-7890" }, purpose: "order" });
    assert.equal(r.ok, true);
    assert.equal(r.checkoutUrl, "https://devo.finnet.co.id/pay/abc");
    assert.equal(r.qrString, "00020101021226...");
    assert.equal(r.expiresAt, "2026-09-24T03:15:00.000Z");
    const c = m.calls[0];
    assert.equal(c.url, "https://devo.finnet.co.id/pg/payment/card/initiate");
    assert.equal(c.headers.get("Authorization"), "Basic " + btoa(`MID1:${KEY}`));
    const b = JSON.parse(c.body!);
    assert.deepEqual(b.order, { id: "AKF-X-000001", amount: 150000, description: "Pesanan", timeout: 15 });
    assert.deepEqual(b.customer, { email: "b@x.id", firstName: "Budi", lastName: "Santoso", mobilePhone: "+6281234567890" });
    assert.equal(b.url.callbackUrl, "https://proj.supabase.co/functions/v1/pay-webhook/finpay");
    assert.deepEqual(b.sourceOfFunds, { type: "qris" });
    // production memakai live.finnet.co.id
    const m2 = mockFetch([{ match: /live\.finnet\.co\.id/, respond: () => jsonRes({ responseCode: "4000001", responseMessage: "Invalid Mandatory Field" }, 400) }]);
    const p2 = new FinpayProvider({ env: "production", merchantId: "MID1", serverKey: KEY, fetch: m2.fetch });
    const r2 = await p2.createCharge({ externalId: "AKF-X-000002", amount: 1000, channel: "gopay", description: "x", expiryMinutes: 15, customer: { firstName: "A" }, purpose: "topup" });
    assert.equal(r2.ok, false); // gopay tidak didukung → tidak ada request
    assert.equal(m2.calls.length, 0);
    const r3 = await p2.createCharge({ externalId: "AKF-X-000003", amount: 1000, channel: "ovo", description: "x", expiryMinutes: 15, customer: { firstName: "A" }, purpose: "topup" });
    assert.equal(r3.ok, false);
    assert.match(r3.error!, /Invalid Mandatory Field/);
    assert.match(m2.calls[0].url, /^https:\/\/live\.finnet\.co\.id\//);
  } finally { restore(); }
});

Deno.test("FinpayProvider.checkStatus: bentuk respons berbeda & not found", async () => {
  const shapes: [unknown, string, number | null][] = [
    [{ responseCode: "2000000", order: { id: "A", amount: 5000 }, result: { payment: { status: "PAID", amount: 5000 } } }, "PAID", 5000],
    [{ responseCode: "2000000", data: { result: { payment: { status: "EXPIRED" } } } }, "EXPIRED", null],
    [{ responseCode: "2000000", data: { order: { status: "CAPTURED", amount: "7000.00" } } }, "CAPTURED", null],
    [{ responseCode: "2000000", transaction: { detail: { status: "REFUNDED" } } }, "REFUNDED", null],
  ];
  for (const [resp, st, amt] of shapes) {
    const m = mockFetch([{ match: /\/check\/A$/, respond: () => jsonRes(resp) }]);
    const r = await new FinpayProvider({ env: "sandbox", serverKey: KEY, fetch: m.fetch }).checkStatus("A");
    assert.equal(r.ok, true, JSON.stringify(resp));
    assert.equal(r.providerStatus, st);
    if (amt !== null) assert.equal(r.amount, amt);
  }
  const nf = mockFetch([{ match: /check/, respond: () => jsonRes({ responseCode: "4040001", responseMessage: "Not Found" }, 404) }]);
  const r = await new FinpayProvider({ env: "sandbox", serverKey: KEY, fetch: nf.fetch }).checkStatus("A");
  assert.equal(r.found, false);
  assert.equal(r.providerStatus, "NOT_FOUND");
  const down = mockFetch([{ match: /check/, respond: () => { throw new Error("ECONNRESET"); } }]);
  const d = await new FinpayProvider({ env: "sandbox", serverKey: KEY, fetch: down.fetch }).checkStatus("A");
  assert.equal(d.ok, false);
  assert.equal(d.found, false);
});
