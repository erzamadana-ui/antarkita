import assert from "node:assert/strict";
import { makePayCreateHandler } from "../pay-create/handler.ts";
import { makePayRefundHandler, refundVisible } from "../pay-refund/handler.ts";
import { makeReconcileHandler, wibDayRange, yesterdayWib } from "../pay-reconcile/handler.ts";
import { makeDisburseHandler, namesMatch } from "../pay-disburse/handler.ts";
import { jsonRes, MockDb, mkDeps, mockFetch, post, quiet, type Row, settingsRows } from "./_mock.ts";

const KEY = "TEST-Finpay-MerchantKey-0123456789";
const ORDER = "11111111-2222-4333-8444-555555555555";
const auth = { Authorization: "Bearer good" };

function createSetup(o: { initiate?: () => Response; settings?: Row; channel?: string } = {}) {
  const db: MockDb = new MockDb({
    app_settings: settingsRows({ payment_provider_active: "finpay", payment_provider_env: "sandbox", order_payment_timeout_min: 15, ...(o.settings ?? {}) }),
    gateway_secrets: [{ provider: "finpay", env: "sandbox", merchant_id: "MID1", server_key: KEY, extra: {} }],
    profiles: [{ id: "u1", full_name: "Budi Santoso", email: "budi@example.com", phone: "081234567890" }],
    payments: [],
  }, {
    payment_intent_create: (a) => {
      const rows = db.tables.payments;
      let r = rows.find((x) => x.order_id === a.p_order && x.pay_status === "PENDING");
      if (!r) {
        r = { id: `pay-${rows.length + 1}`, user_id: a.p_user, order_id: a.p_order, purpose: a.p_purpose, amount: a.p_amount, provider: a.p_provider, pg_channel: a.p_channel, pay_status: "PENDING", external_id: "AKORD-260924100000-1a2b3c4d", provider_ref: "AKORD-260924100000-1a2b3c4d", checkout_token: null, support_ref: "AK-1A2B3C", expires_at: "2026-09-24T03:10:00Z" };
        rows.push(r);
      }
      return { data: { ...r }, error: null };
    },
    payment_event_ingest: () => ({ data: { duplicate: false, applied: true, pay_status: "FAILED", note: null }, error: null }),
  });
  const userDb = new MockDb({}, {
    order_payment_prepare: (a) => a.p_order === ORDER
      ? { data: { order_id: ORDER, code: "AK-ORD-1", channel: a.p_channel ?? "qris", gross: 150000, expires_at: "2026-09-24T03:10:00Z" }, error: null }
      : { data: null, error: { message: "Pesanan bukan milik Anda" } },
  });
  const m = mockFetch([{ match: /\/pg\/payment\/card\/initiate$/, respond: o.initiate ?? (() => jsonRes({ responseCode: "2000000", redirecturl: "https://devo.finnet.co.id/pay/x", stringQr: "000201QR" })) }]);
  const deps = mkDeps({ db, userDb, fetch: m.fetch, users: { good: { id: "u1", email: "budi@example.com" } } });
  return { db, userDb, m, h: makePayCreateHandler(deps) };
}

Deno.test("pay-create order: nominal dari server (bukan body), expiry dibatasi sisa waktu order, idempoten", async () => {
  const restore = quiet();
  try {
    const { db, m, h } = createSetup();
    const res = await h(post("pay-create", { purpose: "order", order_id: ORDER, amount: 1, channel: "qris" }, auth));
    assert.equal(res.status, 200, await res.clone().text());
    const out = await res.json();
    assert.equal(out.provider, "finpay");
    assert.equal(out.qr_string, "000201QR");
    assert.equal(out.checkout_url, "https://devo.finnet.co.id/pay/x");
    assert.equal(out.support_ref, "AK-1A2B3C");
    assert.equal(out.external_id, "AKORD-260924100000-1a2b3c4d"); // external_id dari payment_intent_create (0105) dipakai apa adanya
    assert.ok(out.external_id.length <= 30);
    assert.equal(db.calls("payment_intent_create")[0].args.p_amount, 150000);
    const sent = JSON.parse(m.calls[0].body!);
    assert.equal(sent.order.amount, 150000);
    assert.equal(sent.order.id, out.external_id);
    assert.equal(sent.order.timeout, 10); // min(15 menit setting, 10 menit sisa order)
    assert.deepEqual(sent.sourceOfFunds, { type: "qris" });
    assert.equal(sent.url.callbackUrl, "https://proj.supabase.co/functions/v1/pay-webhook/finpay");
    // panggilan kedua → intent sama, TIDAK ada charge baru
    const again = await (await h(post("pay-create", { purpose: "order", order_id: ORDER, channel: "qris" }, auth))).json();
    assert.equal(again.reused, true);
    assert.equal(again.payment_id, out.payment_id);
    assert.equal(m.calls.length, 1);
  } finally { restore(); }
});

Deno.test("pay-create: tanpa JWT 401; order orang lain 400; saluran tidak didukung 400; purpose salah 400", async () => {
  const restore = quiet();
  try {
    const { h, m } = createSetup();
    assert.equal((await h(post("pay-create", { purpose: "order", order_id: ORDER }))).status, 401);
    assert.equal((await h(post("pay-create", { purpose: "order", order_id: "99999999-2222-4333-8444-555555555555" }, auth))).status, 400);
    assert.equal((await h(post("pay-create", { purpose: "order", order_id: ORDER, channel: "gopay" }, auth))).status, 400);
    assert.equal((await h(post("pay-create", { purpose: "donasi" }, auth))).status, 400);
    assert.equal(m.calls.length, 0);
  } finally { restore(); }
});

Deno.test("pay-create: provider menolak → 502 + intent ditutup FAILED (payment_event_ingest 'FAILURE')", async () => {
  const restore = quiet();
  try {
    const { db, h } = createSetup({ initiate: () => jsonRes({ responseCode: "4000001", responseMessage: "Invalid Field Format" }, 400) });
    const res = await h(post("pay-create", { purpose: "order", order_id: ORDER, channel: "qris" }, auth));
    assert.equal(res.status, 502);
    const [c] = db.calls("payment_event_ingest");
    assert.equal(c.args.p_provider, "finpay");
    assert.equal(c.args.p_provider_status, "FAILURE");
    assert.match(c.args.p_event_id, /^create-failed-AKORD-/);
  } finally { restore(); }
});

Deno.test("pay-create: kunci Finpay kosong & simulasi mati → 503; simulasi aktif (sandbox) → provider simulated", async () => {
  const restore = quiet();
  try {
    const a = createSetup();
    a.db.tables.gateway_secrets = [];
    assert.equal((await a.h(post("pay-create", { purpose: "order", order_id: ORDER, channel: "qris" }, auth))).status, 503);
    const b = createSetup({ settings: { payments_simulation_enabled: true } });
    b.db.tables.gateway_secrets = [];
    const out = await (await b.h(post("pay-create", { purpose: "order", order_id: ORDER, channel: "qris" }, auth))).json();
    assert.equal(out.provider, "simulated");
    assert.equal(out.simulated, true);
    assert.equal(b.m.calls.length, 0);
    // simulasi tidak pernah dipakai di production walau flag true
    const c = createSetup({ settings: { payments_simulation_enabled: true, payment_provider_env: "production" } });
    c.db.tables.gateway_secrets = [];
    assert.equal((await c.h(post("pay-create", { purpose: "order", order_id: ORDER, channel: "qris" }, auth))).status, 503);
  } finally { restore(); }
});

// ------------------------------ pay-refund ------------------------------
function refundSetup(o: { rr?: Row; pay?: Row; adminHas?: boolean; refundResp?: () => Response; checkResp?: () => Response } = {}) {
  const rr = { id: "aaaaaaaa-2222-4333-8444-555555555555", payment_id: "p1", amount: 50000, status: "approved", destination: "gateway", reason: "batal", ...(o.rr ?? {}) };
  const pay = { id: "p1", provider: "finpay", provider_ref: "AKF-X-111111", external_id: "AKF-X-111111", amount: 150000, refunded_amount: 0, raw: { _antarkita: { env: "sandbox" } }, ...(o.pay ?? {}) };
  const db = new MockDb({
    app_settings: settingsRows({ payment_provider_active: "finpay", payment_provider_env: "sandbox" }),
    gateway_secrets: [{ provider: "finpay", env: "sandbox", merchant_id: "MID1", server_key: KEY }],
    refund_requests: [rr], payments: [pay],
  }, {
    refund_execute_result: (a) => {
      if (a.p_status === "executing" && rr.status !== "approved" && rr.status !== "executing") return { data: null, error: { message: "bukan approved" } };
      rr.status = a.p_status as string;
      return { data: { id: rr.id, status: rr.status }, error: null };
    },
    payment_event_ingest: () => ({ data: { duplicate: false, applied: true, pay_status: "PARTIALLY_REFUNDED" }, error: null }),
  });
  const userDb = new MockDb({}, { admin_has: (a) => ({ data: o.adminHas !== false && a.p_perm === "refund_execute", error: null }) });
  const m = mockFetch([
    { match: /\/pg\/payment\/card\/refund$/, respond: o.refundResp ?? (() => jsonRes({ responseCode: "2000000", status: "PARTIALLY_REFUNDED", refundId: "RF1" })) },
    { match: /\/check\//, respond: o.checkResp ?? (() => jsonRes({ responseCode: "2000000", result: { payment: { status: "PAID" } } })) },
  ]);
  const deps = mkDeps({ db, userDb, fetch: m.fetch, users: { good: { id: "admin1" } } });
  return { rr, db, m, h: makePayRefundHandler(deps) };
}

Deno.test("pay-refund: gateway sukses → klaim executing → ingest PARTIALLY_REFUNDED → done", async () => {
  const restore = quiet();
  try {
    const { rr, db, m, h } = refundSetup();
    const res = await h(post("pay-refund", { refund_id: rr.id }, auth));
    assert.equal(res.status, 200, await res.clone().text());
    assert.equal((await res.json()).status, "done");
    const seq = db.calls("refund_execute_result").map((c) => c.args.p_status);
    assert.deepEqual(seq, ["executing", "done"]);
    const [ing] = db.calls("payment_event_ingest");
    assert.equal(ing.args.p_provider_status, "PARTIALLY_REFUNDED");
    assert.equal(ing.args.p_event_id, `refund-${rr.id}`);
    assert.equal(ing.args.p_amount, 50000);
    assert.equal(ing.args.p_raw.refund_amount, 50000); // kumulatif (belum ada refund sebelumnya)
    assert.equal(JSON.parse(m.calls[0].body!).refund.amount, 50000);
    // eksekusi ulang ditolak (status sudah done)
    assert.equal((await h(post("pay-refund", { refund_id: rr.id }, auth))).status, 409);
  } finally { restore(); }
});

Deno.test("pay-refund: tanpa izin 403; wallet → done tanpa provider; tidak didukung → failed; timeout → tetap executing", async () => {
  const restore = quiet();
  try {
    let s = refundSetup({ adminHas: false });
    assert.equal((await s.h(post("pay-refund", { refund_id: s.rr.id }, auth))).status, 403);

    s = refundSetup({ rr: { destination: "wallet" } });
    const w = await (await s.h(post("pay-refund", { refund_id: s.rr.id }, auth))).json();
    assert.equal(w.destination, "wallet");
    assert.equal(s.m.calls.length, 0);
    assert.equal(s.db.calls("refund_execute_result").at(-1)!.args.p_note, "wallet");

    s = refundSetup({ refundResp: () => jsonRes({ responseCode: "4050000", responseMessage: "Refund not supported for this channel" }, 405) });
    const u = await (await s.h(post("pay-refund", { refund_id: s.rr.id }, auth))).json();
    assert.equal(u.note, "provider_unsupported");
    assert.equal(s.rr.status, "failed");

    s = refundSetup({ refundResp: () => { throw new Error("timeout"); } });
    const t = await (await s.h(post("pay-refund", { refund_id: s.rr.id }, auth))).json();
    assert.equal(t.note, "unknown_result");
    assert.equal(s.rr.status, "executing");
    assert.equal(s.db.calls("payment_event_ingest").length, 0);

    // melebihi sisa pembayaran
    s = refundSetup({ pay: { refunded_amount: 120000 } });
    assert.equal((await s.h(post("pay-refund", { refund_id: s.rr.id }, auth))).status, 409);
  } finally { restore(); }
});

Deno.test("refundVisible: PARTIALLY_REFUNDED hanya jika belum ada refund lain", () => {
  assert.equal(refundVisible("REFUNDED", 999), true);
  assert.equal(refundVisible("PARTIALLY_REFUNDED", 0), true);
  assert.equal(refundVisible("PARTIALLY_REFUNDED", 5000), false);
  assert.equal(refundVisible("PAID", 0), false);
});

// ------------------------------ pay-reconcile ------------------------------
Deno.test("pay-reconcile: otorisasi cron/service_role; PENDING menggantung → ingest; PAID kemarin dikonfirmasi; reconcile_daily", async () => {
  const restore = quiet();
  try {
    const now = Date.parse("2026-09-24T19:00:00Z"); // 25 Sep 02:00 WIB
    const db = new MockDb({
      app_settings: settingsRows({ payment_provider_active: "finpay", payment_provider_env: "sandbox" }),
      gateway_secrets: [{ provider: "finpay", env: "sandbox", merchant_id: "MID1", server_key: KEY }],
      payments: [
        { id: "a", provider: "finpay", provider_ref: "AKF-A-000001", pay_status: "PENDING", amount: 1000, created_at: "2026-09-24T17:00:00.000Z", expires_at: "2026-09-24T17:15:00.000Z" },
        { id: "b", provider: "finpay", provider_ref: "AKF-B-000002", pay_status: "PENDING", amount: 2000, created_at: "2026-09-24T18:59:00.000Z" }, // < 30 menit: dilewati
        { id: "c", provider: "finpay", provider_ref: "AKF-C-000003", pay_status: "PENDING", amount: 3000, created_at: "2026-09-24T16:00:00.000Z", expires_at: "2026-09-24T16:15:00.000Z" },
        { id: "d", provider: "finpay", provider_ref: "AKF-D-000004", pay_status: "PAID", amount: 4000, created_at: "2026-09-24T05:00:00.000Z", paid_at: "2026-09-24T05:01:00.000Z" },
        { id: "e", provider: "simulated", provider_ref: "AKF-E-000005", pay_status: "PENDING", amount: 5000, created_at: "2026-09-24T10:00:00.000Z" },
      ],
      refund_requests: [],
    }, {
      payment_event_ingest: () => ({ data: { duplicate: false, applied: true }, error: null }),
      reconcile_daily: (a) => ({ data: { run_date: a.p_date, mismatches: 0 }, error: null }),
    });
    const status: Record<string, unknown> = {
      "AKF-A-000001": { responseCode: "2000000", result: { payment: { status: "PAID", amount: 1000 } } },
      "AKF-C-000003": { responseCode: "2000000", result: { payment: { status: "PENDING" } } },
      "AKF-D-000004": { responseCode: "2000000", result: { payment: { status: "REFUNDED", amount: 4000 } } },
    };
    const m = mockFetch([
      { match: /\/check\//, respond: (c) => jsonRes(status[c.url.split("/").pop()!]) },
      { match: /\/cancel\//, respond: () => jsonRes({ responseCode: "2000000" }) },
    ]);
    const deps = mkDeps({ db, fetch: m.fetch, now, env: { CRON_SECRET: "cron-secret-0123456789", SUPABASE_SERVICE_ROLE_KEY: "svc-key-xyz" } });
    const h = makeReconcileHandler(deps);
    assert.equal((await h(post("pay-reconcile", {}))).status, 401);
    assert.equal((await h(post("pay-reconcile", {}, { "x-cron-secret": "salah" }))).status, 401);
    assert.equal((await h(post("pay-reconcile", {}, { Authorization: "Bearer bukan" }))).status, 401);
    const res = await h(post("pay-reconcile", {}, { "x-cron-secret": "cron-secret-0123456789" }));
    assert.equal(res.status, 200);
    const s = await res.json();
    assert.equal(s.date, "2026-09-24");
    assert.equal(s.pending_checked, 2);
    assert.equal(s.pending_updated, 1);
    assert.equal(s.pending_expired, 1);
    assert.equal(s.paid_checked, 1);
    assert.equal(s.paid_mismatch, 1);
    const ing = db.calls("payment_event_ingest").map((c) => [c.args.p_external_id, c.args.p_provider_status, String(c.args.p_event_id).startsWith(`recon-${now}-`)]);
    assert.deepEqual(ing, [["AKF-A-000001", "PAID", true], ["AKF-C-000003", "EXPIRED", true], ["AKF-D-000004", "REFUNDED", true]]);
    assert.ok(m.calls.some((c) => c.url.endsWith("/cancel/AKF-C-000003")));
    assert.deepEqual(db.calls("reconcile_daily")[0].args, { p_date: "2026-09-24" });
    // service_role juga boleh
    assert.equal((await h(post("pay-reconcile", { skip_daily: true }, { Authorization: "Bearer svc-key-xyz" }))).status, 200);
  } finally { restore(); }
});

Deno.test("tanggal WIB kemarin & rentangnya", () => {
  assert.equal(yesterdayWib(Date.parse("2026-09-24T19:00:00Z")), "2026-09-24"); // 25 Sep 02:00 WIB
  assert.equal(yesterdayWib(Date.parse("2026-09-24T16:30:00Z")), "2026-09-23"); // 24 Sep 23:30 WIB
  assert.deepEqual(wibDayRange("2026-09-24"), { from: "2026-09-23T17:00:00.000Z", to: "2026-09-24T17:00:00.000Z" });
});

// ------------------------------ pay-disburse ------------------------------
Deno.test("pay-disburse: inquiry → cocok nama → klaim → transfer → payout_event_ingest", async () => {
  const restore = quiet();
  try {
    const W = "bbbbbbbb-2222-4333-8444-555555555555";
    const mk = (settings: Row, accountNameBank = "BUDI SANTOSO") => {
      const db = new MockDb({
        app_settings: settingsRows({ payment_provider_env: "sandbox", ...settings }),
        gateway_secrets: [{ provider: "finpay", env: "sandbox", merchant_id: "MID1", server_key: KEY }],
        withdrawal_requests: [{ id: W, amount: 250000, bank_name: "BCA", bank_account: "123-456-7890", account_name: "Budi Santoso", status: "approved", settled_at: null, provider_ref: null, payout_status: null }],
      }, { payout_event_ingest: () => ({ data: { ok: true }, error: null }) });
      const userDb = new MockDb({}, { admin_has: (a) => ({ data: a.p_perm === "payout_execute", error: null }) });
      const m = mockFetch([
        { match: /\/disbursement\/inquiry\//, respond: () => jsonRes({ responseCode: "2000000", refCode: "INQ-1", accountName: accountNameBank, feeAmount: 2500 }) },
        { match: /\/disbursement\/transfer$/, respond: () => jsonRes({ responseCode: "2000000", transactionStatus: "03" }) },
      ]);
      return { db, m, h: makeDisburseHandler(mkDeps({ db, userDb, fetch: m.fetch, users: { good: { id: "admin1" } } })) };
    };
    let s = mk({ disbursement_provider: "manual" });
    assert.equal((await s.h(post("pay-disburse", { withdrawal_id: W }, auth))).status, 409);

    s = mk({ disbursement_provider: "finpay" }, "SITI AMINAH");
    assert.equal((await s.h(post("pay-disburse", { withdrawal_id: W }, auth))).status, 422);
    assert.equal(s.db.calls("payout_event_ingest").length, 0);

    s = mk({ disbursement_provider: "finpay" });
    const res = await s.h(post("pay-disburse", { withdrawal_id: W }, auth));
    assert.equal(res.status, 200, await res.clone().text());
    const out = await res.json();
    assert.equal(out.payout_status, "PAYOUT_PROCESSING");
    assert.match(out.external_id, /^AKD-/);
    const inq = new URL(s.m.calls[0].url);
    assert.equal(inq.searchParams.get("bankCode"), "014");
    assert.equal(inq.searchParams.get("accountNumber"), "1234567890");
    const tr = JSON.parse(s.m.calls[1].body!);
    assert.equal(tr.order.id, out.external_id);
    assert.equal(tr.refCode, "INQ-1");
    const [c] = s.db.calls("payout_event_ingest");
    assert.equal(c.args.p_external_id, out.external_id);
    assert.equal(c.args.p_status, "PAYOUT_PROCESSING");
    assert.equal(s.db.tables.withdrawal_requests[0].provider_ref, out.external_id);
    // tidak bisa dieksekusi dua kali
    assert.equal((await s.h(post("pay-disburse", { withdrawal_id: W }, auth))).status, 409);
  } finally { restore(); }
});

Deno.test("namesMatch: toleran gelar/urutan, menolak nama lain", () => {
  assert.equal(namesMatch("Budi Santoso", "BUDI SANTOSO"), true);
  assert.equal(namesMatch("Ir. Budi Santoso, S.T.", "BUDI SANTOSO"), true);
  assert.equal(namesMatch("Budi", "BUDI SANTOSO"), true);
  assert.equal(namesMatch("Budi Santoso", "SITI AMINAH"), false);
  assert.equal(namesMatch("", "X"), false);
});
