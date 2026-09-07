// Edge Function: push-send — mengirim antrean `push_outbox` ke Firebase Cloud Messaging (HTTP v1).
//
// Cara dipanggil:
//   • Otomatis oleh database: pg_cron menjalankan public.push_dispatch() setiap menit; fungsi itu
//     memakai pg_net untuk POST { "ids": [1,2,3] } ke sini dengan header Authorization service_role.
//   • Manual (server/admin): POST { "user_id": "...", "title": "...", "body": "...", "data": {...} }.
//
// Kredensial FCM: secret `FCM_SERVICE_ACCOUNT` berisi ISI file JSON service account Firebase
// (project_id, client_email, private_key). BILA SECRET BELUM DIISI fungsi TIDAK error:
// baris antrean ditandai `skipped`, dicatat di log, dan balasan { skipped: true }.
//
// verify_jwt = true: pemanggil wajib membawa JWT sah (service_role key dari pg_net, atau token admin).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

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
async function accessToken(sa: { client_email: string; private_key: string }): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
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
  const res = await fetch("https://oauth2.googleapis.com/token", {
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
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
    const raw = (Deno.env.get("FCM_SERVICE_ACCOUNT") ?? "").trim();
    if (!raw) {
      console.log(`push-send: FCM_SERVICE_ACCOUNT belum diisi — ${msgs.length} pesan dilewati (skipped), tidak dianggap error.`);
      if (ids.length) {
        await admin.from("push_outbox")
          .update({ status: "skipped", last_error: "FCM_SERVICE_ACCOUNT belum diisi", sent_at: new Date().toISOString() })
          .in("id", ids);
      }
      return json({ skipped: true, reason: "FCM_SERVICE_ACCOUNT belum diisi", queued: msgs.length });
    }
    let sa: { project_id: string; client_email: string; private_key: string };
    try {
      sa = JSON.parse(raw);
      sa.private_key = sa.private_key.replace(/\\n/g, "\n");
    } catch (_e) {
      console.error("push-send: FCM_SERVICE_ACCOUNT bukan JSON service account yang sah");
      if (ids.length) await admin.from("push_outbox").update({ status: "failed", last_error: "FCM_SERVICE_ACCOUNT bukan JSON sah" }).in("id", ids);
      return json({ skipped: true, reason: "FCM_SERVICE_ACCOUNT bukan JSON sah" });
    }

    const token = await accessToken(sa);
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
        const res = await fetch(url, {
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
          sent_at: new Date().toISOString(),
        }).eq("id", m.id);
      }
    }
    if (dead.length) await admin.from("push_tokens").delete().in("token", dead);
    return json({ ok: true, sent, failed, tokens_removed: dead.length });
  } catch (e) {
    console.error("push-send:", (e as Error).message);
    return json({ error: (e as Error).message }, 500);
  }
});
