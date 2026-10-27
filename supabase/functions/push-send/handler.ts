// push-send — mengirim antrean `push_outbox` ke Firebase Cloud Messaging (HTTP v1). Logika murni; index.ts memasang Deps nyata.
//
// Cara dipanggil:
//   • Otomatis oleh database (0116): pg_cron → public.push_dispatch() tiap menit → pg_net POST { "ids": [1,2,3] } ke sini
//     dengan header apikey/Authorization = ANON key (lolos verify_jwt gateway) + `x-push-secret` = Vault push_dispatch_secret.
//   • Manual (server/admin): POST { "user_id": "...", "title": "...", "body": "...", "data": {...} }.
//
// Otorisasi (salah satu):
//   1. header x-push-secret cocok (waktu-konstan) dengan secret PUSH_DISPATCH_SECRET (≥ 16 karakter) — setara service_role;
//   2. Authorization Bearer JWT berperan service_role;
//   3. JWT admin AntarKita (rpc is_admin = true) — 0086.
//   Selain itu → 403. verify_jwt gateway saja tidak cukup: JWT pengguna biasa juga sah.
//
// Kredensial FCM: secret `FCM_SERVICE_ACCOUNT` berisi ISI file JSON service account Firebase (project_id, client_email,
// private_key). BILA BELUM DIISI fungsi TIDAK error: baris antrean ditandai `skipped` + last_error
// 'FCM_SERVICE_ACCOUNT belum diisi', dan balasan { skipped: true }.
import type { Deps } from "../_shared/deps.ts";
import { timingSafeEqual } from "../_shared/http.ts";

// CORS sengaja sama dengan versi sebelumnya (tidak ada x-push-secret: header itu hanya dikirim server→server oleh pg_net).
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

export const FCM_MISSING = "FCM_SERVICE_ACCOUNT belum diisi";
export const FCM_INVALID = "FCM_SERVICE_ACCOUNT bukan JSON sah";
const SECRET_MIN_LEN = 16;

const b64url = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

/** PEM PKCS#8 → CryptoKey RS256 */
async function importKey(pem: string): Promise<CryptoKey> {
  const body = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return await crypto.subtle.importKey("pkcs8", der.buffer, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
}

/** OAuth2 access token untuk FCM v1 (JWT bearer flow, di-cache selama proses hidup). */
let cachedToken: { token: string; exp: number } | null = null;
export function resetTokenCache() { cachedToken = null; }
async function accessToken(deps: Deps, sa: { client_email: string; private_key: string }): Promise<string> {
  const now = Math.floor(deps.now() / 1000);
  if (cachedToken && cachedToken.exp > now + 60) return cachedToken.token;
  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claim = b64url(new TextEncoder().encode(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })));
  const key = await importKey(sa.private_key);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${claim}`));
  const assertion = `${header}.${claim}.${b64url(sig)}`;
  const res = await deps.fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`OAuth FCM gagal: ${JSON.stringify(body)}`);
  cachedToken = { token: body.access_token, exp: now + (body.expires_in ?? 3600) };
  return cachedToken.token;
}

type Msg = { id?: number; user_id: string; title: string; body?: string | null; data?: Record<string, unknown> };

/** Peran dari payload JWT (tanpa verifikasi tanda tangan — gateway verify_jwt yang memverifikasi). '' bila tidak terbaca. */
function jwtRole(authHeader: string): string {
  const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
  try { return String(JSON.parse(atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).role ?? ""); } catch { return ""; }
}

/** Header x-push-secret cocok dengan env PUSH_DISPATCH_SECRET (≥ 16 karakter), perbandingan waktu-konstan. */
export function pushSecretOk(deps: Deps, req: Request): boolean {
  const want = (deps.env("PUSH_DISPATCH_SECRET") ?? "").trim();
  const got = (req.headers.get("x-push-secret") ?? "").trim();
  return want.length >= SECRET_MIN_LEN && got.length > 0 && timingSafeEqual(got, want);
}

export function makePushSendHandler(deps: Deps) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    try {
      const admin = deps.db;

      // ---- Perizinan: x-push-secret (0116) ATAU service_role ATAU admin AntarKita (0086) ----
      const authHeader = req.headers.get("Authorization") ?? "";
      let via = "secret";
      if (!pushSecretOk(deps, req)) {
        if (jwtRole(authHeader) === "service_role") via = "service_role";
        else {
          const { data: isAdmin, error } = await deps.userDb(authHeader).rpc("is_admin");
          if (error || isAdmin !== true) return json({ error: "Hanya admin" }, 403);
          via = "admin";
        }
      }

      const payload = await req.json().catch(() => ({}));

      // ---- Kumpulkan pesan yang akan dikirim ----
      let msgs: Msg[] = [];
      const ids: number[] = Array.isArray(payload.ids) ? payload.ids.map(Number).filter(Number.isFinite) : [];
      if (ids.length) {
        const { data, error } = await admin.from("push_outbox").select("id,user_id,title,body,data").in("id", ids);
        if (error) return json({ error: error.message }, 500);
        msgs = (data ?? []) as Msg[];
      } else if (payload.user_id && payload.title) {
        msgs = [{ user_id: String(payload.user_id), title: String(payload.title), body: payload.body ?? null, data: payload.data ?? {} }];
      }
      if (!msgs.length) return json({ ok: true, sent: 0, note: "tidak ada pesan untuk dikirim" });

      // ---- Kredensial FCM ----
      const raw = (deps.env("FCM_SERVICE_ACCOUNT") ?? "").trim();
      if (!raw) {
        console.log(`push-send: ${FCM_MISSING} — ${msgs.length} pesan dilewati (skipped), tidak dianggap error. [via ${via}]`);
        if (ids.length) {
          await admin.from("push_outbox")
            .update({ status: "skipped", last_error: FCM_MISSING, sent_at: new Date(deps.now()).toISOString() })
            .in("id", ids);
        }
        return json({ skipped: true, reason: FCM_MISSING, queued: msgs.length });
      }
      let sa: { project_id: string; client_email: string; private_key: string };
      try {
        sa = JSON.parse(raw);
        sa.private_key = sa.private_key.replace(/\\n/g, "\n");
      } catch (_e) {
        console.error(`push-send: ${FCM_INVALID}`);
        if (ids.length) await admin.from("push_outbox").update({ status: "failed", last_error: FCM_INVALID }).in("id", ids);
        return json({ skipped: true, reason: FCM_INVALID });
      }

      const token = await accessToken(deps, sa);
      const url = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`;

      // ---- Token perangkat per pengguna ----
      const users = [...new Set(msgs.map((m) => m.user_id))];
      const { data: toks } = await admin.from("push_tokens").select("user_id,token").in("user_id", users);
      const byUser = new Map<string, string[]>();
      for (const t of toks ?? []) byUser.set(t.user_id, [...(byUser.get(t.user_id) ?? []), t.token]);

      let sent = 0, failed = 0;
      const dead: string[] = [];
      for (const m of msgs) {
        const list = byUser.get(m.user_id) ?? [];
        let ok = 0;
        let lastError: string | null = list.length ? null : "pengguna tidak punya token perangkat";
        for (const dev of list) {
          const flat: Record<string, string> = {};
          for (const [k, v] of Object.entries(m.data ?? {})) flat[k] = typeof v === "string" ? v : JSON.stringify(v);
          const res = await deps.fetch(url, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              message: {
                token: dev,
                notification: { title: m.title, body: m.body ?? undefined },
                data: flat,
                android: { priority: "high", notification: { channel_id: "antarkita", sound: "default" } },
                apns: { payload: { aps: { sound: "default" } } },
              },
            }),
          });
          if (res.ok) { ok++; sent++; }
          else {
            const err = await res.text();
            lastError = `${res.status} ${err.slice(0, 200)}`;
            if (res.status === 404 || /UNREGISTERED|INVALID_ARGUMENT/i.test(err)) dead.push(dev);
          }
        }
        if (!ok) failed++;
        if (m.id) {
          await admin.from("push_outbox").update({
            status: ok ? "sent" : "failed",
            last_error: ok ? null : lastError,
            sent_at: new Date(deps.now()).toISOString(),
          }).eq("id", m.id);
        }
      }
      if (dead.length) await admin.from("push_tokens").delete().in("token", dead);
      return json({ ok: true, sent, failed, tokens_removed: dead.length });
    } catch (e) {
      console.error("push-send:", (e as Error).message);
      return json({ error: (e as Error).message }, 500);
    }
  };
}
