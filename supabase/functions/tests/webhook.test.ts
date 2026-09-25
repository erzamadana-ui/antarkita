import assert from "node:assert/strict";
import { hmacSha512Hex, sha512Hex } from "../_shared/crypto.ts";
import { clientIp, RateLimiter } from "../_shared/http.ts";
import { phpJsonEncode } from "../_shared/jsonutil.ts";
import { refundTotalOf } from "../_shared/payments.ts";
import { callerIpAllowed, makeWebhookHandler } from "../pay-webhook/handler.ts";
import { FIELDS, signedPhpBody } from "./_fixtures.ts";
import { jsonRes, MockDb, mkDeps, mockFetch, post, quiet, type Row, settingsRows } from "./_mock.ts";

const KEY = "TEST-Finpay-MerchantKey-0123456789";
const PROD_KEY = "PROD-Finpay-MerchantKey-9876543210";
const MT_KEY = "SB-Mid-server-TESTKEY123";
const MT_PROD_KEY = "Mid-server-PRODKEY999";
const EXT = "AKF-MFY1Q2ZK-3FA9C1";
const MT_EXT = "AKF-ABC-0000AA";

const basePayments = (): Row[] => [
  { id: "p-fin", user_id: "u1", provider: "finpay", env: "sandbox", pay_status: "PENDING", amount: 150000, refunded_amount: 0, external_id: EXT, provider_ref: EXT },
  { id: "p-mt", user_id: "u1", provider: "midtrans", env: "sandbox", pay_status: "PENDING", amount: 150000, refunded_amount: 0, external_id: MT_EXT, provider_ref: MT_EXT },
];

function setup(opts: { settings?: Row; ingest?: Row | ((a: Row) => Row); checkStatus?: unknown; checkThrows?: boolean; users?: Record<string, { id: string }>; payments?: Row[]; env?: Record<string, string>; withdrawals?: Row[]; ingestError?: boolean } = {}) {
  const db = new MockDb({
    app_settings: settingsRows({ payment_provider_active: "finpay", payment_provider_env: "sandbox", payments_simulation_enabled: false, ...(opts.settings ?? {}) }),
    gateway_secrets: [
      { provider: "finpay", env: "sandbox", merchant_id: "MID1", server_key: KEY, extra: {} },
      { provider: "finpay", env: "production", merchant_id: "MID1", server_key: PROD_KEY, extra: {} },
      { provider: "midtrans", env: "sandbox", server_key: MT_KEY, client_key: "SB-Mid-client-x" },
      { provider: "midtrans", env: "production", server_key: MT_PROD_KEY, client_key: "Mid-client-x" },
    ],
    payments: opts.payments ?? basePayments(),
    withdrawal_requests: opts.withdrawals ?? [],
  }, {
    payment_event_ingest: (a) => opts.ingestError
      ? { data: null, error: { message: "connection reset" } }
      : { data: typeof opts.ingest === "function" ? opts.ingest(a) : opts.ingest ?? { duplicate: false, applied: true, pay_status: "PAID", note: "applied" }, error: null },
    payout_event_ingest: () => ({ data: { applied: true }, error: null }),
  });
  const m = mockFetch([
    { match: /finnet\.co\.id\/pg\/payment\/card\/check\//, respond: () => { if (opts.checkThrows) throw new Error("ETIMEDOUT"); return jsonRes(opts.checkStatus ?? { responseCode: "2000000", result: { payment: { status: "PAID", amount: 150000 } } }); } },
    { match: /api\.(sandbox\.)?midtrans\.com\/v2\/.*\/status$/, respond: () => jsonRes(opts.checkStatus ?? { status_code: "200", transaction_status: "settlement", fraud_status: "accept", gross_amount: "150000.00", transaction_id: "tx-1" }) },
  ]);
  const deps = mkDeps({ db, fetch: m.fetch, users: opts.users, env: opts.env });
  return { db, m, deps, h: makeWebhookHandler(deps) };
}

async function mtNotif(key = MT_KEY, over: Row = {}) {
  const n: Row = { transaction_id: "tx-1", order_id: MT_EXT, status_code: "200", gross_amount: "150000.00", transaction_status: "settlement", payment_type: "bank_transfer", va_numbers: [{ bank: "bca", va_number: "12345678901" }], ...over };
  n.signature_key = await sha512Hex(`${n.order_id}${n.status_code}${n.gross_amount}${key}`);
  return n;
}

Deno.test("finpay: callback PAID sah → checkStatus (host env transaksi) → ingest dengan p_env → 2000000", async () => {
  const restore = quiet();
  try {
    const { db, m, h } = setup();
    const { body } = await signedPhpBody();
    const res = await h(post("pay-webhook/finpay", body));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { responseCode: "2000000", responseMessage: "Success" });
    assert.equal(m.calls.length, 1);
    assert.equal(m.calls[0].url, `https://devo.finnet.co.id/pg/payment/card/check/${EXT}`);
    assert.equal(m.calls[0].headers.get("Authorization"), "Basic " + btoa(`MID1:${KEY}`));
    const [call] = db.calls("payment_event_ingest");
    assert.equal(call.args.p_provider, "finpay");
    assert.equal(call.args.p_external_id, EXT);
    assert.equal(call.args.p_provider_status, "PAID");
    assert.equal(call.args.p_amount, 150000);
    assert.equal(call.args.p_signature_ok, true);
    assert.equal(call.args.p_env, "sandbox");
    assert.match(call.args.p_event_id, new RegExp(`^cb-${EXT}-PAID-`));
    assert.equal(call.args.p_raw.signature, "[REDACTED]");
    assert.equal(call.args.p_raw.order.id, EXT); // payload di tingkat atas
    assert.equal(call.args.p_raw._antarkita.verified_via, "raw-strip");
  } finally { restore(); }
});

Deno.test("T1: transaksi production + callback bertanda tangan kunci SANDBOX → 401, tanpa checkStatus/ingest", async () => {
  const restore = quiet();
  try {
    const pays = basePayments();
    pays[0].env = "production";
    const { db, m, h } = setup({ payments: pays, settings: { payment_provider_env: "sandbox" } });
    const { body } = await signedPhpBody(FIELDS, KEY); // kunci sandbox
    const res = await h(post("pay-webhook/finpay", body));
    assert.equal(res.status, 401);
    assert.equal(m.calls.length, 0);
    assert.equal(db.calls("payment_event_ingest").length, 0);
  } finally { restore(); }
});

Deno.test("T1: transaksi production + kunci production → check ke live.finnet, p_env=production", async () => {
  const restore = quiet();
  try {
    const pays = basePayments();
    pays[0].env = "production";
    const { db, m, h } = setup({ payments: pays });
    const signed = phpJsonEncode(FIELDS);
    const sig = await hmacSha512Hex(PROD_KEY, signed);
    const res = await h(post("pay-webhook/finpay", signed.slice(0, -1) + `,"signature":"${sig}"}`));
    assert.equal(res.status, 200);
    assert.match(m.calls[0].url, /^https:\/\/live\.finnet\.co\.id\//);
    assert.equal(db.calls("payment_event_ingest")[0].args.p_env, "production");
  } finally { restore(); }
});

Deno.test("finpay: transaksi tidak dikenal / milik provider lain → 200 tanpa ingest & tanpa jaringan", async () => {
  const restore = quiet();
  try {
    const { db, m, h } = setup({ payments: [] });
    const { body } = await signedPhpBody();
    const res = await h(post("pay-webhook/finpay", body));
    assert.equal(res.status, 200);
    assert.equal((await res.json()).responseCode, "2000000");
    const pays = basePayments();
    pays[0].provider = "midtrans";
    const s2 = setup({ payments: pays });
    assert.equal((await s2.h(post("pay-webhook/finpay", body))).status, 200);
    assert.equal(db.calls("payment_event_ingest").length + s2.db.calls("payment_event_ingest").length, 0);
    assert.equal(m.calls.length + s2.m.calls.length, 0);
  } finally { restore(); }
});

Deno.test("S5: signature salah → 401 dan TIDAK ada tulisan ke payment_events", async () => {
  const restore = quiet();
  try {
    const { db, m, h } = setup();
    const { body } = await signedPhpBody(FIELDS, "kunci-penyerang");
    assert.equal((await h(post("pay-webhook/finpay", body))).status, 401);
    assert.equal(m.calls.length, 0);
    assert.equal(db.calls("payment_event_ingest").length, 0);
  } finally { restore(); }
});

Deno.test("finpay: duplikat → 200; error RPC (DB) → 500; RPC note 'error: …' → 500 (provider mengirim ulang)", async () => {
  const restore = quiet();
  try {
    const { body } = await signedPhpBody();
    let s = setup({ ingest: { duplicate: true, applied: false, pay_status: "PAID", note: "duplicate_event" } });
    assert.equal((await s.h(post("pay-webhook/finpay", body))).status, 200);
    s = setup({ ingestError: true });
    const r1 = await s.h(post("pay-webhook/finpay", body));
    assert.equal(r1.status, 500);
    assert.equal((await r1.json()).responseCode, "5000000");
    s = setup({ ingest: { duplicate: false, applied: false, pay_status: "PENDING", note: "error: deadlock detected" } });
    assert.equal((await s.h(post("pay-webhook/finpay", body))).status, 500);
    // status terminal diabaikan DB tetap 200
    s = setup({ ingest: { duplicate: false, applied: false, pay_status: "PAID", note: "ignored_terminal" } });
    assert.equal((await s.h(post("pay-webhook/finpay", body))).status, 200);
  } finally { restore(); }
});

Deno.test("finpay: checkStatus gagal (jaringan) → 503 dan tidak ada ingest", async () => {
  const restore = quiet();
  try {
    const { db, h } = setup({ checkThrows: true });
    const { body } = await signedPhpBody();
    assert.equal((await h(post("pay-webhook/finpay", body))).status, 503);
    assert.equal(db.calls("payment_event_ingest").length, 0);
  } finally { restore(); }
});

Deno.test("finpay: status/amount provider menang atas callback; not found → UNCONFIRMED", async () => {
  const restore = quiet();
  try {
    const { body } = await signedPhpBody();
    let s = setup({ checkStatus: { responseCode: "2000000", result: { payment: { status: "PENDING" } } } });
    await s.h(post("pay-webhook/finpay", body));
    assert.equal(s.db.calls("payment_event_ingest")[0].args.p_provider_status, "PENDING");
    s = setup({ checkStatus: { responseCode: "2000000", result: { payment: { status: "PAID", amount: 1000 } } } });
    await s.h(post("pay-webhook/finpay", body));
    const c = s.db.calls("payment_event_ingest")[0];
    assert.equal(c.args.p_amount, 1000);
    assert.match(c.args.p_raw._antarkita.note, /amount_mismatch/);
    s = setup({ checkStatus: { responseCode: "4040001", responseMessage: "Not found" } });
    assert.equal((await s.h(post("pay-webhook/finpay", body))).status, 200);
    const u = s.db.calls("payment_event_ingest")[0];
    assert.equal(u.args.p_provider_status, "UNCONFIRMED");
    assert.match(u.args.p_event_id, /-unconfirmed$/);
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

Deno.test("body > 64 KiB 413; rute tak dikenal 404; GET 405; body tanpa order.id 400", async () => {
  const restore = quiet();
  try {
    const { h } = setup();
    assert.equal((await h(post("pay-webhook/finpay", "x".repeat(70000)))).status, 413);
    assert.equal((await h(post("pay-webhook/paypal", "{}"))).status, 404);
    assert.equal((await h(new Request("https://proj.supabase.co/functions/v1/pay-webhook/finpay"))).status, 405);
    assert.equal((await h(post("pay-webhook/finpay", "{}"))).status, 400);
  } finally { restore(); }
});

Deno.test("midtrans: settlement sah → cek status → ingest 'settlement' + p_env, field notifikasi di tingkat atas", async () => {
  const restore = quiet();
  try {
    const { db, m, h } = setup();
    const n = await mtNotif();
    const res = await h(post("pay-webhook/midtrans", n));
    assert.equal(res.status, 200);
    assert.equal(m.calls.length, 1);
    assert.match(m.calls[0].url, /api\.sandbox\.midtrans\.com/);
    const [c] = db.calls("payment_event_ingest");
    assert.equal(c.args.p_provider, "midtrans");
    assert.equal(c.args.p_provider_status, "settlement");
    assert.equal(c.args.p_amount, 150000);
    assert.equal(c.args.p_env, "sandbox");
    assert.equal(c.args.p_raw.gross_amount, "150000.00"); // dibaca payment_settle
    assert.equal(c.args.p_raw.payment_type, "bank_transfer");
    assert.equal(c.args.p_raw.va_numbers[0].bank, "bca");
    assert.equal((await h(post("pay-webhook/midtrans", { ...n, gross_amount: "1.00" }))).status, 401);
  } finally { restore(); }
});

Deno.test("T1/T2 midtrans: kunci env lain ditolak; transaksi bukan Midtrans → 200 tanpa ingest", async () => {
  const restore = quiet();
  try {
    const { db, h } = setup();
    assert.equal((await h(post("pay-webhook/midtrans", await mtNotif(MT_PROD_KEY)))).status, 401); // transaksi sandbox, kunci production
    const pays = basePayments();
    pays[1].provider = "finpay";
    const s2 = setup({ payments: pays });
    assert.equal((await s2.h(post("pay-webhook/midtrans", await mtNotif()))).status, 200);
    assert.equal(db.calls("payment_event_ingest").length + s2.db.calls("payment_event_ingest").length, 0);
  } finally { restore(); }
});

Deno.test("T2: pembungkus midtrans-webhook (forceRoute) memakai jalur yang sama", async () => {
  const restore = quiet();
  try {
    const { db, deps } = setup();
    const legacy = makeWebhookHandler(deps, { forceRoute: "midtrans" });
    const req = new Request("https://proj.supabase.co/functions/v1/midtrans-webhook", { method: "POST", body: JSON.stringify(await mtNotif()) });
    assert.equal((await legacy(req)).status, 200);
    assert.equal(db.calls("payment_event_ingest")[0].args.p_env, "sandbox");
    // jalur simulasi lama tidak ada lagi: {simulate} tanpa signature → 400/401, tanpa ingest
    const sim = await legacy(new Request("https://x/midtrans-webhook", { method: "POST", body: JSON.stringify({ simulate: MT_EXT, order_id: MT_EXT }) }));
    assert.equal(sim.status, 401);
    assert.equal(db.calls("payment_event_ingest").length, 1);
  } finally { restore(); }
});

Deno.test("T2: refund/partial_refund/chargeback Midtrans → refund_amount kumulatif eksplisit", async () => {
  const restore = quiet();
  try {
    const pays = basePayments();
    pays[1].pay_status = "PAID";
    const check = {
      status_code: "200", transaction_status: "partial_refund", gross_amount: "150000.00", transaction_id: "tx-1",
      refund_amount: "20000.00", refunds: [{ refund_amount: "30000.00" }, { refund_amount: "20000.00" }],
    };
    const { db, h } = setup({ payments: pays, checkStatus: check });
    const n = await mtNotif(MT_KEY, { transaction_status: "partial_refund", refund_amount: "20000.00" });
    assert.equal((await h(post("pay-webhook/midtrans", n))).status, 200);
    const [c] = db.calls("payment_event_ingest");
    assert.equal(c.args.p_provider_status, "partial_refund");
    assert.equal(c.args.p_raw.refund_amount, 50000); // jumlah refunds[] dari respons status
    assert.equal(c.args.p_raw.event_type, "refund");
    const cb = setup({ payments: pays, checkStatus: { status_code: "200", transaction_status: "chargeback", gross_amount: "150000.00", transaction_id: "tx-1" } });
    await cb.h(post("pay-webhook/midtrans", await mtNotif(MT_KEY, { transaction_status: "chargeback" })));
    assert.equal(cb.db.calls("payment_event_ingest")[0].args.p_provider_status, "chargeback");
    assert.equal(refundTotalOf("midtrans", { refund_amount: "1000.00" }), 1000);
    assert.equal(refundTotalOf("midtrans", {}), null);
    assert.equal(refundTotalOf("finpay", { data: { refundAmount: 7000 } }), 7000);
  } finally { restore(); }
});

Deno.test("simulated: syarat ketat (JWT, flag, env≠production, provider simulated, pemilik, payments.env)", async () => {
  const restore = quiet();
  try {
    const pay = { id: "p1", user_id: "u1", provider: "simulated", env: "sandbox", pay_status: "PENDING", amount: 50000, external_id: "AKF-SIM-000001" };
    const users = { good: { id: "u1" }, other: { id: "u2" } };
    const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
    const body = { external_id: "AKF-SIM-000001", status: "PAID" };

    let s = setup({ users, payments: [pay] });
    assert.equal((await s.h(post("pay-webhook/simulated", body))).status, 401);
    assert.equal((await s.h(post("pay-webhook/simulated", body, auth("good")))).status, 403); // flag mati
    s = setup({ users, payments: [pay], settings: { payments_simulation_enabled: true, payment_provider_env: "production" } });
    assert.equal((await s.h(post("pay-webhook/simulated", body, auth("good")))).status, 403);
    s = setup({ users, payments: [pay], settings: { payments_simulation_enabled: true }, env: { PAYMENTS_SIMULATION_HARD_OFF: "true" } });
    assert.equal((await s.h(post("pay-webhook/simulated", body, auth("good")))).status, 403);
    s = setup({ users, payments: [{ ...pay, provider: "finpay" }], settings: { payments_simulation_enabled: true } });
    assert.equal((await s.h(post("pay-webhook/simulated", body, auth("good")))).status, 403);
    s = setup({ users, payments: [{ ...pay, env: "production" }], settings: { payments_simulation_enabled: true } });
    assert.equal((await s.h(post("pay-webhook/simulated", body, auth("good")))).status, 403); // transaksi production
    s = setup({ users, payments: [pay], settings: { payments_simulation_enabled: true } });
    assert.equal((await s.h(post("pay-webhook/simulated", body, auth("other")))).status, 404);
    assert.equal((await s.h(post("pay-webhook/simulated", { ...body, status: "REFUNDED" }, auth("good")))).status, 400);
    const ok = await s.h(post("pay-webhook/simulated", body, auth("good")));
    assert.equal(ok.status, 200);
    const [c] = s.db.calls("payment_event_ingest");
    assert.equal(c.args.p_provider, "simulated");
    assert.equal(c.args.p_provider_status, "PAID");
    assert.equal(c.args.p_env, "sandbox");
  } finally { restore(); }
});

Deno.test("finpay-disbursement: env dari prefiks AKDS-/AKD-, kunci env lain ditolak, tak dikenal → 200", async () => {
  const restore = quiet();
  try {
    const W = [{ id: "w1", provider: "finpay", provider_ref: "AKDS-MFY1Q2ZK-ABCDEF", payout_status: "PAYOUT_PROCESSING" }];
    const fields = { order: { id: "AKDS-MFY1Q2ZK-ABCDEF", amount: 250000 }, transactionStatus: "00", beneficiary: { accountNumber: "1234567890" } };
    const signed = phpJsonEncode(fields);
    const body = (k: string) => hmacSha512Hex(k, signed).then((sig) => signed.slice(0, -1) + `,"signature":"${sig}"}`);
    let s = setup({ withdrawals: W, settings: { payment_provider_env: "production" } });
    assert.equal((await s.h(post("pay-webhook/finpay-disbursement", await body(KEY)))).status, 200); // AKDS → sandbox, walau setting production
    const [c] = s.db.calls("payout_event_ingest");
    assert.equal(c.args.p_external_id, "AKDS-MFY1Q2ZK-ABCDEF");
    assert.equal(c.args.p_status, "PAYOUT_SETTLED");
    assert.equal(c.args.p_raw.callback.beneficiary.accountNumber, "******7890");
    s = setup({ withdrawals: W });
    assert.equal((await s.h(post("pay-webhook/finpay-disbursement", await body(PROD_KEY)))).status, 401);
    assert.equal(s.db.calls("payout_event_ingest").length, 0);
    s = setup({ withdrawals: [] });
    assert.equal((await s.h(post("pay-webhook/finpay-disbursement", await body(KEY)))).status, 200);
    assert.equal(s.db.calls("payout_event_ingest").length, 0);
  } finally { restore(); }
});

Deno.test("R6 clientIp: cf-connecting-ip / x-real-ip / entri TERAKHIR x-forwarded-for", () => {
  const r = (h: Record<string, string>) => new Request("https://x/", { headers: h });
  assert.equal(clientIp(r({ "x-forwarded-for": "6.6.6.6, 10.0.0.1, 1.2.3.4" })), "1.2.3.4");
  assert.equal(clientIp(r({ "x-forwarded-for": "6.6.6.6", "x-real-ip": "5.5.5.5" })), "5.5.5.5");
  assert.equal(clientIp(r({ "x-forwarded-for": "6.6.6.6", "x-real-ip": "5.5.5.5", "cf-connecting-ip": "4.4.4.4" })), "4.4.4.4");
  assert.equal(clientIp(r({})), "");
});

Deno.test("S5 allowlist: kosong tidak memblokir; terisi → IP lain 403 (entri pertama XFF palsu tidak lolos)", async () => {
  const r = (xff: string) => new Request("https://x/pay-webhook/finpay", { method: "POST", headers: { "x-forwarded-for": xff } });
  assert.equal(callerIpAllowed(r("9.9.9.9"), undefined), true);
  assert.equal(callerIpAllowed(r("9.9.9.9"), ""), true);
  assert.equal(callerIpAllowed(r("6.6.6.6, 1.2.3.4"), "1.2.3.4,5.6.7.8"), true);
  assert.equal(callerIpAllowed(r("1.2.3.4, 6.6.6.6"), "1.2.3.4"), false);
  const restore = quiet();
  try {
    const { h, db } = setup({ env: { FINPAY_CALLBACK_IP_ALLOWLIST: "1.2.3.4" } });
    const { body } = await signedPhpBody();
    assert.equal((await h(post("pay-webhook/finpay", body, { "x-forwarded-for": "1.2.3.4, 6.6.6.6" }))).status, 403);
    assert.equal(db.calls("payment_event_ingest").length, 0);
    assert.equal((await h(post("pay-webhook/finpay", body, { "x-forwarded-for": "1.2.3.4" }))).status, 200);
    const s2 = setup();
    assert.equal((await s2.h(post("pay-webhook/finpay", body, { "x-forwarded-for": "6.6.6.6" }))).status, 200); // kosong = tidak memblokir
  } finally { restore(); }
});

Deno.test("S5 rate limit per IP (60/menit default), IP allowlist dikecualikan", async () => {
  let t = 0;
  const rl = new RateLimiter(3, 60_000, () => t);
  assert.deepEqual([rl.take("a"), rl.take("a"), rl.take("a"), rl.take("a"), rl.take("b")], [true, true, true, false, true]);
  t = 60_000;
  assert.equal(rl.take("a"), true);
  const restore = quiet();
  try {
    const { h } = setup({ env: { WEBHOOK_RATE_LIMIT_PER_MIN: "2" } });
    const bad = (await signedPhpBody(FIELDS, "x")).body;
    const codes: number[] = [];
    for (let i = 0; i < 3; i++) codes.push((await h(post("pay-webhook/finpay", bad, { "x-forwarded-for": "7.7.7.7" }))).status);
    assert.deepEqual(codes, [401, 401, 429]);
    assert.equal((await h(post("pay-webhook/finpay", bad, { "x-forwarded-for": "8.8.8.8" }))).status, 401); // IP lain tidak terdampak
    const s2 = setup({ env: { WEBHOOK_RATE_LIMIT_PER_MIN: "1", FINPAY_CALLBACK_IP_ALLOWLIST: "1.2.3.4" } });
    const good = (await signedPhpBody()).body;
    for (let i = 0; i < 3; i++) assert.equal((await s2.h(post("pay-webhook/finpay", good, { "x-forwarded-for": "1.2.3.4" }))).status, 200);
  } finally { restore(); }
});
