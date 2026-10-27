// Uji push-send (0116): otorisasi x-push-secret / service_role / admin, FCM_SERVICE_ACCOUNT kosong → skipped + last_error,
// pengiriman FCM v1 (OAuth JWT bearer + messages:send) dengan fetch tiruan, token mati dihapus.
import assert from "node:assert/strict";
import { FCM_MISSING, makePushSendHandler, pushSecretOk, resetTokenCache } from "../push-send/handler.ts";
import { jsonRes, MockDb, mkDeps, mockFetch, post, quiet, type Row } from "./_mock.ts";

const SECRET = "RAHASIA-PUSH-UJI-0123456789-abcdef";
const b64u = (s: string) => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
/** JWT palsu (tanpa tanda tangan sah) — handler hanya membaca klaim role; gateway verify_jwt yang memverifikasi tanda tangan. */
const fakeJwt = (role: string) => `${b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${b64u(JSON.stringify({ role, sub: "u1" }))}.ttd`;

function setup(o: { env?: Record<string, string>; outbox?: Row[]; tokens?: Row[]; isAdmin?: boolean; fetch?: typeof fetch } = {}) {
  const db = new MockDb({
    push_outbox: o.outbox ?? [
      { id: 1, user_id: "u1", title: "Halo", body: "isi", data: { route: "home", n: 2 }, status: "sending", attempts: 1, last_error: null, sent_at: null },
      { id: 2, user_id: "u2", title: "Tanpa token", body: null, data: {}, status: "sending", attempts: 1, last_error: null, sent_at: null },
    ],
    push_tokens: o.tokens ?? [{ user_id: "u1", token: "tok-a" }, { user_id: "u1", token: "tok-mati" }],
  });
  const userDb = new MockDb({}, o.isAdmin === undefined ? {} : { is_admin: () => ({ data: o.isAdmin, error: null }) });
  const deps = mkDeps({ db, userDb, env: { SUPABASE_SERVICE_ROLE_KEY: "svc-key", ...(o.env ?? {}) }, fetch: o.fetch });
  return { db, userDb, deps, handler: makePushSendHandler(deps) };
}

Deno.test("push-send: tanpa kredensial → 403; secret salah → 403; secret cocok → lolos (FCM kosong → skipped + last_error)", async () => {
  const restore = quiet();
  try {
    const { db, handler } = setup({ env: { PUSH_DISPATCH_SECRET: SECRET } });
    // tanpa apa pun: is_admin tidak ada di tiruan → error → 403
    let res = await handler(post("push-send", { ids: [1, 2] }));
    assert.equal(res.status, 403);
    // secret salah (panjang sama) → 403, antrean tidak disentuh
    res = await handler(post("push-send", { ids: [1, 2] }, { "x-push-secret": SECRET.slice(0, -1) + "X" }));
    assert.equal(res.status, 403);
    assert.equal(db.updates.length, 0);
    // secret cocok → otorisasi lolos; FCM_SERVICE_ACCOUNT kosong → skipped, baris outbox diberi last_error
    res = await handler(post("push-send", { ids: [1, 2] }, { "x-push-secret": SECRET, apikey: "anon", Authorization: `Bearer ${fakeJwt("anon")}` }));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, { skipped: true, reason: FCM_MISSING, queued: 2 });
    assert.equal(db.updates.length, 1);
    assert.equal(db.updates[0].count, 2);
    assert.equal(db.updates[0].patch.status, "skipped");
    assert.equal(db.updates[0].patch.last_error, "FCM_SERVICE_ACCOUNT belum diisi");
    assert.ok(db.tables.push_outbox.every((r) => r.status === "skipped" && r.last_error === FCM_MISSING && r.sent_at));
  } finally { restore(); }
});

Deno.test("push-send: PUSH_DISPATCH_SECRET belum diisi / < 16 karakter → header tidak pernah lolos (tidak ada jalan pintas)", () => {
  const req = (s: string) => post("push-send", {}, { "x-push-secret": s });
  assert.equal(pushSecretOk(mkDeps({ db: new MockDb(), env: {} }), req("apa-saja")), false);
  assert.equal(pushSecretOk(mkDeps({ db: new MockDb(), env: { PUSH_DISPATCH_SECRET: "pendek" } }), req("pendek")), false);
  assert.equal(pushSecretOk(mkDeps({ db: new MockDb(), env: { PUSH_DISPATCH_SECRET: SECRET } }), req("")), false);
  assert.equal(pushSecretOk(mkDeps({ db: new MockDb(), env: { PUSH_DISPATCH_SECRET: SECRET } }), post("push-send", {})), false);
  assert.equal(pushSecretOk(mkDeps({ db: new MockDb(), env: { PUSH_DISPATCH_SECRET: SECRET } }), req(SECRET)), true);
  assert.equal(pushSecretOk(mkDeps({ db: new MockDb(), env: { PUSH_DISPATCH_SECRET: ` ${SECRET} ` } }), req(SECRET)), true); // trim
});

Deno.test("push-send: JWT service_role lolos tanpa secret; JWT pengguna biasa → is_admin; admin lolos, non-admin 403", async () => {
  const restore = quiet();
  try {
    let s = setup({ env: { PUSH_DISPATCH_SECRET: SECRET } });
    let res = await s.handler(post("push-send", { ids: [1] }, { Authorization: `Bearer ${fakeJwt("service_role")}` }));
    assert.equal(res.status, 200);
    assert.equal((await res.json()).skipped, true);
    assert.equal(s.userDb.calls("is_admin").length, 0);

    s = setup({ isAdmin: true });
    res = await s.handler(post("push-send", { ids: [1] }, { Authorization: `Bearer ${fakeJwt("authenticated")}` }));
    assert.equal(res.status, 200);
    assert.equal(s.userDb.calls("is_admin").length, 1);

    s = setup({ isAdmin: false, env: { PUSH_DISPATCH_SECRET: SECRET } });
    res = await s.handler(post("push-send", { ids: [1] }, { Authorization: `Bearer ${fakeJwt("authenticated")}`, "x-push-secret": "salah-salah-salah-salah" }));
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { error: "Hanya admin" });
    assert.equal(s.db.updates.length, 0);
  } finally { restore(); }
});

Deno.test("push-send: OPTIONS → CORS tanpa perubahan; ids kosong & tanpa user_id → sent 0", async () => {
  const { handler } = setup({ env: { PUSH_DISPATCH_SECRET: SECRET } });
  const pre = await handler(new Request("https://proj.supabase.co/functions/v1/push-send", { method: "OPTIONS" }));
  assert.equal(pre.status, 200);
  assert.equal(pre.headers.get("Access-Control-Allow-Headers"), "authorization, x-client-info, apikey, content-type");
  assert.equal(pre.headers.get("Access-Control-Allow-Methods"), "POST, OPTIONS");
  const res = await handler(post("push-send", { ids: [] }, { "x-push-secret": SECRET }));
  assert.deepEqual(await res.json(), { ok: true, sent: 0, note: "tidak ada pesan untuk dikirim" });
});

async function fakeServiceAccount() {
  const kp = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", kp.privateKey));
  let b = ""; for (const x of der) b += String.fromCharCode(x);
  const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(b).replace(/(.{64})/g, "$1\n")}\n-----END PRIVATE KEY-----\n`;
  return { json: JSON.stringify({ project_id: "antarkita-uji", client_email: "fcm@antarkita-uji.iam.gserviceaccount.com", private_key: pem.replace(/\n/g, "\\n") }), pub: kp.publicKey };
}

Deno.test("push-send: FCM terisi → OAuth JWT bearer (RS256 sah) + messages:send per token; sent/failed, token mati dihapus, outbox diperbarui", async () => {
  const restore = quiet();
  try {
    resetTokenCache();
    const sa = await fakeServiceAccount();
    const seenTokens: string[] = [];
    let assertion = "";
    const { fetch, calls } = mockFetch([
      { match: /oauth2\.googleapis\.com\/token$/, method: "POST", respond: (c) => { assertion = new URLSearchParams(c.body ?? "").get("assertion") ?? ""; return jsonRes({ access_token: "ya29.uji", expires_in: 3599 }); } },
      { match: /fcm\.googleapis\.com\/v1\/projects\/antarkita-uji\/messages:send$/, method: "POST", respond: (c) => {
        const m = JSON.parse(c.body ?? "{}").message;
        seenTokens.push(m.token);
        assert.equal(c.headers.get("Authorization"), "Bearer ya29.uji");
        assert.equal(m.android.notification.channel_id, "antarkita");
        if (m.token === "tok-mati") return jsonRes({ error: { status: "NOT_FOUND", details: [{ errorCode: "UNREGISTERED" }] } }, 404);
        assert.deepEqual(m.data, { route: "home", n: "2" }); // data di-flatten ke string
        return jsonRes({ name: "projects/antarkita-uji/messages/1" });
      } },
    ]);
    const { db, handler } = setup({ env: { PUSH_DISPATCH_SECRET: SECRET, FCM_SERVICE_ACCOUNT: sa.json }, fetch });
    const res = await handler(post("push-send", { ids: [1, 2] }, { "x-push-secret": SECRET }));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, sent: 1, failed: 1, tokens_removed: 1 });
    // JWT OAuth ditandatangani dengan kunci service account (verifikasi dengan kunci publiknya)
    const [h, c, sig] = assertion.split(".");
    const sigBytes = Uint8Array.from(atob(sig.replace(/-/g, "+").replace(/_/g, "/")), (ch) => ch.charCodeAt(0));
    assert.equal(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", sa.pub, sigBytes, new TextEncoder().encode(`${h}.${c}`)), true);
    const claim = JSON.parse(atob(c.replace(/-/g, "+").replace(/_/g, "/")));
    assert.equal(claim.iss, "fcm@antarkita-uji.iam.gserviceaccount.com");
    assert.equal(claim.scope, "https://www.googleapis.com/auth/firebase.messaging");
    assert.equal(claim.exp - claim.iat, 3600);
    assert.deepEqual(seenTokens.sort(), ["tok-a", "tok-mati"]);
    assert.equal(calls.filter((x) => /oauth2/.test(x.url)).length, 1);
    // outbox: u1 terkirim (1 dari 2 token ok), u2 gagal (tanpa token); token mati dihapus
    const o1 = db.tables.push_outbox.find((r) => r.id === 1)!, o2 = db.tables.push_outbox.find((r) => r.id === 2)!;
    assert.equal(o1.status, "sent"); assert.equal(o1.last_error, null); assert.ok(o1.sent_at);
    assert.equal(o2.status, "failed"); assert.equal(o2.last_error, "pengguna tidak punya token perangkat");
    assert.deepEqual(db.tables.push_tokens.map((t) => t.token), ["tok-a"]);
    assert.deepEqual(db.deletes, [{ table: "push_tokens", count: 1 }]);
    // panggilan kedua memakai token OAuth dari cache (tidak ada permintaan oauth baru)
    db.tables.push_outbox.push({ id: 3, user_id: "u1", title: "Lagi", body: null, data: {}, status: "sending" });
    await handler(post("push-send", { ids: [3] }, { "x-push-secret": SECRET }));
    assert.equal(calls.filter((x) => /oauth2/.test(x.url)).length, 1);
    resetTokenCache();
  } finally { restore(); }
});

Deno.test("push-send: FCM_SERVICE_ACCOUNT bukan JSON → failed + last_error, tanpa fetch", async () => {
  const restore = quiet();
  try {
    const { db, handler } = setup({ env: { PUSH_DISPATCH_SECRET: SECRET, FCM_SERVICE_ACCOUNT: "{bukan json" } });
    const res = await handler(post("push-send", { ids: [1] }, { "x-push-secret": SECRET }));
    assert.deepEqual(await res.json(), { skipped: true, reason: "FCM_SERVICE_ACCOUNT bukan JSON sah" });
    assert.equal(db.tables.push_outbox.find((r) => r.id === 1)!.status, "failed");
    assert.equal(db.tables.push_outbox.find((r) => r.id === 1)!.last_error, "FCM_SERVICE_ACCOUNT bukan JSON sah");
  } finally { restore(); }
});
