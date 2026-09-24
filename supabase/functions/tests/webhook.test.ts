import assert from "node:assert/strict";
import { hmacSha512Hex, sha512Hex } from "../_shared/crypto.ts";
import { phpJsonEncode } from "../_shared/jsonutil.ts";
import { callerIpAllowed, makeWebhookHandler } from "../pay-webhook/handler.ts";
import { FIELDS, signedPhpBody } from "./_fixtures.ts";
import { jsonRes, MockDb, mkDeps, mockFetch, post, quiet, type Row, settingsRows } from "./_mock.ts";

const KEY = "TEST-Finpay-MerchantKey-0123456789";
const PROD_KEY = "PROD-Finpay-MerchantKey-9876543210";
const MT_KEY = "SB-Mid-server-TESTKEY123";

function setup(opts: { settings?: Row; ingest?: Row; checkStatus?: unknown; checkThrows?: boolean; users?: Record<string, { id: string }>; payments?: Row[]; env?: Record<string, string> } = {}) {
  const db = new MockDb({
    app_settings: settingsRows({ payment_provider_active: "finpay", payment_provider_env: "sandbox", payments_simulation_enabled: false, ...(opts.settings ?? {}) }),
    gateway_secrets: [
      { provider: "finpay", env: "sandbox", merchant_id: "MID1", server_key: KEY, extra: {} },
      { provider: "finpay", env: "production", merchant_id: "MID1", server_key: PROD_KEY, extra: {} },
      { provider: "midtrans", env: "sandbox", server_key: MT_KEY, client_key: "SB-Mid-client-x" },
    ],
    payments: opts.payments ?? [],
  }, {
    payment_event_ingest: () => ({ data: opts.ingest ?? { duplicate: false, applied: true, pay_status: "PAID", note: null }, error: null }),
    payout_event_ingest: () => ({ data: { ok: true }, error: null }),
  });
  const m = mockFetch([
    { match: /finnet\.co\.id\/pg\/payment\/card\/check\//, respond: () => { if (opts.checkThrows) throw new Error("ETIMEDOUT"); return jsonRes(opts.checkStatus ?? { responseCode: "2000000", result: { payment: { status: "PAID", amount: 150000 } } }); } },
    { match: /api\.sandbox\.midtrans\.com\/v2\/.*\/status$/, respond: () => jsonRes(opts.checkStatus ?? { status_code: "200", transaction_status: "settlement", fraud_status: "accept", gross_amount: "150000.00", transaction_id: "tx-1" }) },
  ]);
  const deps = mkDeps({ db, fetch: m.fetch, users: opts.users, env: opts.env });
  return { db, m, h: makeWebhookHandler(deps) };
}

Deno.test("finpay: callback PAID sah → checkStatus → payment_event_ingest → balasan 2000000", async () => {
  const restore = quiet();
  try {
    const { db, m, h } = setup();
    const { body } = await signedPhpBody();
    const res = await h(post("pay-webhook/finpay", body));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { responseCode: "2000000", responseMessage: "Success" });
    assert.equal(m.calls.length, 1);
    assert.equal(m.calls[0].url, "https://devo.finnet.co.id/pg/payment/card/check/AKF-MFY1Q2ZK-3FA9C1");
    assert.equal(m.calls[0].headers.get("Authorization"), "Basic " + btoa(`MID1:${KEY}`));
    const [call] = db.calls("payment_event_ingest");
    assert.equal(call.args.p_provider, "finpay");
    assert.equal(call.args.p_external_id, "AKF-MFY1Q2ZK-3FA9C1");
    assert.equal(call.args.p_provider_status, "PAID");
    assert.equal(call.args.p_amount, 150000);
    assert.equal(call.args.p_signature_ok, true);
    assert.match(call.args.p_event_id, /^cb-AKF-MFY1Q2ZK-3FA9C1-PAID-/);
    assert.equal(call.args.p_raw.callback.signature, "[REDACTED]"); // raw tersimpan tanpa signature
    assert.equal(call.args.p_raw._antarkita.verified_via, "raw-strip");
  } finally { restore(); }
});

Deno.test("finpay: duplikat → tetap 200", async () => {
  const restore = quiet();
  try {
    const { h } = setup({ ingest: { duplicate: true, applied: false, pay_status: "PAID", note: null } });
    const { body } = await signedPhpBody();
    const res = await h(post("pay-webhook/finpay", body));
    assert.equal(res.status, 200);
    assert.equal((await res.json()).responseCode, "2000000");
  } finally { restore(); }
});

Deno.test("finpay: signature salah → 401, TIDAK ada checkStatus, audit SIGNATURE_INVALID signature_ok=false", async () => {
  const restore = quiet();
  try {
    const { db, m, h } = setup();
    const { body } = await signedPhpBody(FIELDS, "kunci-penyerang");
    const res = await h(post("pay-webhook/finpay", body));
    assert.equal(res.status, 401);
    assert.equal(m.calls.length, 0);
    const calls = db.calls("payment_event_ingest");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].args.p_signature_ok, false);
    assert.equal(calls[0].args.p_provider_status, "SIGNATURE_INVALID");
    assert.equal(calls[0].args.p_amount, null);
  } finally { restore(); }
});

Deno.test("finpay: checkStatus gagal (jaringan) → 503 dan tidak ada ingest PAID", async () => {
  const restore = quiet();
  try {
    const { db, h } = setup({ checkThrows: true });
    const { body } = await signedPhpBody();
    const res = await h(post("pay-webhook/finpay", body));
    assert.equal(res.status, 503);
    assert.equal(db.calls("payment_event_ingest").length, 0);
  } finally { restore(); }
});

Deno.test("finpay: callback PAID tetapi provider bilang PENDING → yang di-ingest PENDING (status provider menang)", async () => {
  const restore = quiet();
  try {
    const { db, h } = setup({ checkStatus: { responseCode: "2000000", result: { payment: { status: "PENDING" } } } });
    const { body } = await signedPhpBody();
    assert.equal((await h(post("pay-webhook/finpay", body))).status, 200);
    const [c] = db.calls("payment_event_ingest");
    assert.equal(c.args.p_provider_status, "PENDING");
    assert.match(c.args.p_raw._antarkita.note, /callback=PAID;check=PENDING/);
  } finally { restore(); }
});

Deno.test("finpay: amount provider berbeda → amount provider yang dikirim + catatan", async () => {
  const restore = quiet();
  try {
    const { db, h } = setup({ checkStatus: { responseCode: "2000000", result: { payment: { status: "PAID", amount: 1000 } } } });
    const { body } = await signedPhpBody();
    await h(post("pay-webhook/finpay", body));
    const [c] = db.calls("payment_event_ingest");
    assert.equal(c.args.p_amount, 1000);
    assert.match(c.args.p_raw._antarkita.note, /amount_mismatch/);
  } finally { restore(); }
});

Deno.test("finpay: provider tidak mengenal order → UNCONFIRMED (tidak bisa jadi PAID)", async () => {
  const restore = quiet();
  try {
    const { db, h } = setup({ checkStatus: { responseCode: "4040001", responseMessage: "Not found" } });
    const { body } = await signedPhpBody();
    assert.equal((await h(post("pay-webhook/finpay", body))).status, 200);
    const [c] = db.calls("payment_event_ingest");
    assert.equal(c.args.p_provider_status, "UNCONFIRMED");
    assert.match(c.args.p_event_id, /-unconfirmed$/);
  } finally { restore(); }
});

Deno.test("finpay: callback ditandatangani kunci env lain (production) tetap diverifikasi", async () => {
  const restore = quiet();
  try {
    const { db, m, h } = setup({ checkStatus: { responseCode: "2000000", result: { payment: { status: "PAID", amount: 150000 } } } });
    const signed = phpJsonEncode(FIELDS);
    const sig = await hmacSha512Hex(PROD_KEY, signed);
    const res = await h(post("pay-webhook/finpay", signed.slice(0, -1) + `,"signature":"${sig}"}`));
    // check ke host production — mock hanya mengenal pola finnet.co.id apa pun host-nya
    assert.equal(res.status, 200);
    assert.match(m.calls[0].url, /^https:\/\/live\.finnet\.co\.id\//);
    assert.equal(db.calls("payment_event_ingest")[0].args.p_raw._antarkita.env, "production");
  } finally { restore(); }
});

Deno.test("finpay: callback PENDING tidak memanggil checkStatus", async () => {
  const restore = quiet();
  try {
    const { m, db, h } = setup();
    const f = structuredClone(FIELDS);
    f.result.payment.status = "PENDING";
    const { body } = await signedPhpBody(f);
    assert.equal((await h(post("pay-webhook/finpay", body))).status, 200);
    assert.equal(m.calls.length, 0);
    assert.equal(db.calls("payment_event_ingest")[0].args.p_provider_status, "PENDING");
  } finally { restore(); }
});

Deno.test("finpay: body > 64 KiB ditolak 413; rute tak dikenal 404; GET 405", async () => {
  const restore = quiet();
  try {
    const { h } = setup();
    assert.equal((await h(post("pay-webhook/finpay", "x".repeat(70000)))).status, 413);
    assert.equal((await h(post("pay-webhook/paypal", "{}"))).status, 404);
    assert.equal((await h(new Request("https://proj.supabase.co/functions/v1/pay-webhook/finpay"))).status, 405);
  } finally { restore(); }
});

Deno.test("midtrans: notifikasi settlement sah → cek status → ingest 'settlement'", async () => {
  const restore = quiet();
  try {
    const { db, m, h } = setup();
    const n: Row = { transaction_id: "tx-1", order_id: "AKF-ABC-0000AA", status_code: "200", gross_amount: "150000.00", transaction_status: "settlement", payment_type: "gopay" };
    n.signature_key = await sha512Hex(`${n.order_id}${n.status_code}${n.gross_amount}${MT_KEY}`);
    const res = await h(post("pay-webhook/midtrans", n));
    assert.equal(res.status, 200);
    assert.equal(m.calls.length, 1);
    const [c] = db.calls("payment_event_ingest");
    assert.equal(c.args.p_provider, "midtrans");
    assert.equal(c.args.p_provider_status, "settlement");
    assert.equal(c.args.p_amount, 150000);
    // signature salah
    const bad = await h(post("pay-webhook/midtrans", { ...n, gross_amount: "1.00" }));
    assert.equal(bad.status, 401);
  } finally { restore(); }
});

Deno.test("simulated: syarat ketat (JWT, flag, env≠production, provider simulated, pemilik)", async () => {
  const restore = quiet();
  try {
    const pay = { id: "p1", user_id: "u1", provider: "simulated", pay_status: "PENDING", amount: 50000, external_id: "AKF-SIM-000001" };
    const users = { good: { id: "u1" }, other: { id: "u2" } };
    const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
    const body = { external_id: "AKF-SIM-000001", status: "PAID" };

    let s = setup({ users, payments: [pay] });
    assert.equal((await s.h(post("pay-webhook/simulated", body))).status, 401); // tanpa JWT
    assert.equal((await s.h(post("pay-webhook/simulated", body, auth("good")))).status, 403); // flag mati

    s = setup({ users, payments: [pay], settings: { payments_simulation_enabled: true, payment_provider_env: "production" } });
    assert.equal((await s.h(post("pay-webhook/simulated", body, auth("good")))).status, 403); // production

    s = setup({ users, payments: [pay], settings: { payments_simulation_enabled: true }, env: { PAYMENTS_SIMULATION_HARD_OFF: "true" } });
    assert.equal((await s.h(post("pay-webhook/simulated", body, auth("good")))).status, 403); // dimatikan paksa

    s = setup({ users, payments: [{ ...pay, provider: "finpay" }], settings: { payments_simulation_enabled: true } });
    assert.equal((await s.h(post("pay-webhook/simulated", body, auth("good")))).status, 403); // bukan transaksi simulasi

    s = setup({ users, payments: [pay], settings: { payments_simulation_enabled: true } });
    assert.equal((await s.h(post("pay-webhook/simulated", body, auth("other")))).status, 404); // bukan pemilik
    assert.equal((await s.h(post("pay-webhook/simulated", { ...body, status: "REFUNDED" }, auth("good")))).status, 400);
    const ok = await s.h(post("pay-webhook/simulated", body, auth("good")));
    assert.equal(ok.status, 200);
    const [c] = s.db.calls("payment_event_ingest");
    assert.equal(c.args.p_provider, "simulated");
    assert.equal(c.args.p_provider_status, "PAID");
    assert.equal(c.args.p_amount, 50000);
  } finally { restore(); }
});

Deno.test("finpay-disbursement: callback sah → payout_event_ingest; salah → 401", async () => {
  const restore = quiet();
  try {
    const { db, h } = setup();
    const fields = { order: { id: "AKD-MFY1Q2ZK-ABCDEF", amount: 250000 }, transactionStatus: "00", beneficiary: { accountNumber: "1234567890" } };
    const signed = phpJsonEncode(fields);
    const sig = await hmacSha512Hex(KEY, signed);
    const res = await h(post("pay-webhook/finpay-disbursement", signed.slice(0, -1) + `,"signature":"${sig}"}`));
    assert.equal(res.status, 200);
    const [c] = db.calls("payout_event_ingest");
    assert.equal(c.args.p_external_id, "AKD-MFY1Q2ZK-ABCDEF");
    assert.equal(c.args.p_status, "PAYOUT_SETTLED");
    assert.equal(c.args.p_raw.callback.beneficiary.accountNumber, "******7890"); // PII disamarkan di raw
    const bad = await h(post("pay-webhook/finpay-disbursement", signed.slice(0, -1) + `,"signature":"${"0".repeat(128)}"}`));
    assert.equal(bad.status, 401);
    assert.equal(db.calls("payout_event_ingest").length, 1);
  } finally { restore(); }
});

Deno.test("allowlist IP callback opsional", async () => {
  const r = (ip?: string) => new Request("https://x/pay-webhook/finpay", { method: "POST", headers: ip ? { "x-forwarded-for": ip } : {} });
  assert.equal(callerIpAllowed(r("9.9.9.9"), undefined), true);
  assert.equal(callerIpAllowed(r("9.9.9.9"), ""), true);
  assert.equal(callerIpAllowed(r("1.2.3.4, 10.0.0.1"), "1.2.3.4,5.6.7.8"), true);
  assert.equal(callerIpAllowed(r("9.9.9.9"), "1.2.3.4"), false);
  assert.equal(callerIpAllowed(r(), "1.2.3.4"), false);
  const restore = quiet();
  try {
    const { h, db } = setup({ env: { FINPAY_CALLBACK_IP_ALLOWLIST: "1.2.3.4" } });
    const { body } = await signedPhpBody();
    assert.equal((await h(post("pay-webhook/finpay", body, { "x-forwarded-for": "6.6.6.6" }))).status, 403);
    assert.equal(db.calls("payment_event_ingest").length, 0);
    assert.equal((await h(post("pay-webhook/finpay", body, { "x-forwarded-for": "1.2.3.4" }))).status, 200);
  } finally { restore(); }
});
