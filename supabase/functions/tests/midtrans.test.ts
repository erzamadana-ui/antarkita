import assert from "node:assert/strict";
import { sha512Hex } from "../_shared/crypto.ts";
import {
  foldMidtransStatus, mapMidtransChannel, midtransChannelOf, midtransSignature, MidtransProvider, normalizeMidtransStatus,
} from "../_shared/providers/midtrans.ts";
import { SimulatedProvider } from "../_shared/providers/simulated.ts";

const SK = "SB-Mid-server-TESTKEY123";

async function notif(over: Record<string, unknown> = {}) {
  const n: Record<string, unknown> = {
    transaction_id: "tx-1", order_id: "AKF-ABC-0000AA", status_code: "200", gross_amount: "150000.00",
    transaction_status: "settlement", fraud_status: "accept", payment_type: "qris", ...over,
  };
  n.signature_key = await sha512Hex(`${n.order_id}${n.status_code}${n.gross_amount}${SK}`);
  return n;
}

Deno.test("signature Midtrans: SHA512(order_id+status_code+gross_amount+serverKey)", async () => {
  assert.equal(await midtransSignature("o1", "200", "10000.00", "k"), await sha512Hex("o120010000.00k"));
  const p = new MidtransProvider({ env: "sandbox", serverKey: SK });
  const n = await notif();
  const ok = await p.verifyNotification(JSON.stringify(n), new Headers());
  assert.equal(ok.ok, true);
  assert.equal(ok.externalId, "AKF-ABC-0000AA");
  assert.equal(ok.amount, 150000);
  assert.equal(ok.providerStatus, "settlement");
  assert.equal(ok.channel, "qris");
  assert.equal(ok.eventId, "mt-tx-1-settlement-200");
  // tamper gross_amount
  const bad = await p.verifyNotification(JSON.stringify({ ...n, gross_amount: "1500000.00" }), new Headers());
  assert.equal(bad.ok, false);
  // huruf besar pada signature diterima
  const up = await p.verifyNotification(JSON.stringify({ ...n, signature_key: String(n.signature_key).toUpperCase() }), new Headers());
  assert.equal(up.ok, true);
  // kunci salah
  const other = new MidtransProvider({ env: "sandbox", serverKey: SK + "x" });
  assert.equal((await other.verifyNotification(JSON.stringify(n), new Headers())).ok, false);
  assert.equal((await p.verifyNotification("{bad", new Headers())).ok, false);
});

Deno.test("normalisasi status Midtrans (KONTRAK §3) + lipat fraud_status", () => {
  const cases: [string, string | null, string | null][] = [
    ["settlement", null, "PAID"], ["capture", "accept", "PAID"], ["capture", "challenge", "PENDING"], ["capture", "deny", "FAILED"],
    ["pending", null, "PENDING"], ["expire", null, "EXPIRED"], ["deny", null, "FAILED"], ["cancel", null, "FAILED"],
    ["failure", null, "FAILED"], ["refund", null, "REFUNDED"], ["partial_refund", null, "PARTIALLY_REFUNDED"],
    ["chargeback", null, "DISPUTED"], ["partial_chargeback", null, "DISPUTED"], ["authorize", null, "PENDING"], ["???", null, null],
  ];
  for (const [t, f, o] of cases) assert.equal(normalizeMidtransStatus(t, f), o, `${t}/${f}`);
  assert.equal(foldMidtransStatus("capture", "challenge"), "pending");
  assert.equal(foldMidtransStatus("capture", undefined), "capture");
});

Deno.test("pemetaan channel Midtrans + channelOf notifikasi", () => {
  assert.deepEqual(mapMidtransChannel("qris").enabledPayments, ["other_qris"]);
  assert.deepEqual(mapMidtransChannel("retail_alfamart").enabledPayments, ["alfamart"]);
  assert.equal(mapMidtransChannel("linkaja").supported, false);
  assert.equal(mapMidtransChannel("finpay_money").supported, false);
  assert.equal(mapMidtransChannel("nope").supported, false);
  assert.equal(mapMidtransChannel(null).supported, true);
  assert.equal(midtransChannelOf({ payment_type: "echannel" }), "bank_transfer");
  assert.equal(midtransChannelOf({ payment_type: "credit_card" }), "card");
  assert.equal(midtransChannelOf({ payment_type: "cstore", store: "Indomaret" }), "indomaret");
  assert.equal(midtransChannelOf({ payment_type: "cstore", store: "alfamart" }), "alfamart");
  assert.equal(midtransChannelOf({ payment_type: "wat" }), null);
});

Deno.test("capture+challenge → status provider 'pending' (bukan PAID)", async () => {
  const p = new MidtransProvider({ env: "sandbox", serverKey: SK });
  const n = await notif({ transaction_status: "capture", fraud_status: "challenge", payment_type: "credit_card" });
  const v = await p.verifyNotification(JSON.stringify(n), new Headers());
  assert.equal(v.ok, true);
  assert.equal(v.providerStatus, "pending");
  assert.equal(p.normalizeStatus(v.providerStatus), "PENDING");
});

Deno.test("SimulatedProvider: normalisasi kanonik & dilarang di production", async () => {
  const s = new SimulatedProvider("sandbox");
  assert.equal(s.normalizeStatus("paid"), "PAID");
  assert.equal(s.normalizeStatus("x"), null);
  const prod = new SimulatedProvider("production");
  const r = await prod.createCharge({ externalId: "A", amount: 1, channel: null, description: "", expiryMinutes: 1, customer: { firstName: "a" }, purpose: "topup" });
  assert.equal(r.ok, false);
});
