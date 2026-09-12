// Edge Function: turn-credentials — mengeluarkan kredensial TURN BERUMUR PENDEK (Cloudflare Realtime)
// untuk panggilan suara di jaringan seluler (CGNAT). Lihat migrasi 0082.
//
// Cara dipanggil (klien, src/lib/call.ts): supabase.functions.invoke('turn-credentials', { body: {} })
//   → { iceServers: [...], ttl: 7200, expiresAt: <epoch ms>, configured: true }
//   Bila belum dikonfigurasi/nonaktif → { iceServers: [], configured: false } — klien memakai STUN saja.
//
// Keamanan:
//   • verify_jwt (bawaan) hanya memastikan JWT sah — kunci anon pun JWT sah. Karena itu di sini
//     pengguna DIVERIFIKASI lewat auth.getUser(); tanpa pengguna login → 401.
//   • api_token Cloudflare dibaca dari turn_secrets memakai service_role; TIDAK PERNAH dikirim ke klien.
//   • Cloudflare mengembalikan username/credential sementara (TTL) — itulah yang diteruskan.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // 1. Siapa yang meminta? Wajib pengguna login (bukan sekadar kunci anon).
    const auth = req.headers.get("Authorization") ?? "";
    const user = createClient(url, anonKey, { global: { headers: { Authorization: auth } } });
    const { data: who, error: whoErr } = await user.auth.getUser();
    if (whoErr || !who?.user) return json({ error: "Harus masuk untuk menelepon" }, 401);

    // 2. Ambil konfigurasi (service_role — tabel tanpa policy).
    const admin = createClient(url, serviceKey);
    const { data: cfg, error: cfgErr } = await admin.from("turn_secrets")
      .select("provider, token_id, api_token, ttl_seconds, enabled").eq("id", 1).maybeSingle();
    if (cfgErr) return json({ error: cfgErr.message }, 500);
    if (!cfg || !cfg.enabled || !cfg.token_id || !cfg.api_token) {
      return json({ iceServers: [], configured: false, reason: "TURN belum dikonfigurasi (Panel Admin → Pengaturan → Panggilan)" });
    }

    // 3. Minta kredensial sementara ke Cloudflare.
    const ttl = Math.min(Math.max(Number(cfg.ttl_seconds) || 7200, 300), 86400);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    let res: Response;
    try {
      res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${cfg.token_id}/credentials/generate-ice-servers`, {
        method: "POST",
        headers: { Authorization: `Bearer ${cfg.api_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ttl }),
        signal: ctrl.signal,
      });
    } finally { clearTimeout(timer); }
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !Array.isArray(body?.iceServers)) {
      const detail = `Cloudflare ${res.status}: ${JSON.stringify(body).slice(0, 200)}`;
      await admin.from("turn_issue_log").insert({ user_id: who.user.id, ok: false, detail });
      // Jangan gagalkan panggilan: klien jatuh ke STUN (tetap tersambung di Wi-Fi / NAT ramah).
      return json({ iceServers: [], configured: true, ok: false, reason: detail }, 200);
    }
    await admin.from("turn_issue_log").insert({ user_id: who.user.id, ok: true, detail: `ttl=${ttl}` });
    return json({ iceServers: body.iceServers, ttl, expiresAt: Date.now() + ttl * 1000, configured: true, ok: true });
  } catch (e) {
    return json({ error: (e as Error).message ?? String(e) }, 500);
  }
});
