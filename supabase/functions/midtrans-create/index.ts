// Edge Function: buat transaksi Midtrans Snap (top up AntarPay) — plug-and-play.
// Kunci dibaca dari (1) secret MIDTRANS_SERVER_KEY / MIDTRANS_CLIENT_KEY / MIDTRANS_IS_PRODUCTION, atau
// (2) tabel gateway_secrets yang diisi admin dari Panel Admin → Payment Gateway (tanpa CLI).
// Tanpa keduanya → mode simulasi agar alur tetap bisa diuji.
// Aksi khusus: { action: "status" } (admin) → cek koneksi ke Midtrans dengan kunci yang tersimpan.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
// Pemetaan metode aplikasi → enabled_payments Snap. OVO/DANA lewat QRIS (dipindai dari aplikasi e-wallet masing-masing).
const METHODS: Record<string, string[]> = { gopay: ["gopay"], shopeepay: ["shopeepay"], qris: ["other_qris"], bank_transfer: ["bank_transfer", "echannel", "permata_va", "bca_va", "bni_va", "bri_va", "cimb_va"], ovo: ["other_qris"], dana: ["other_qris"], card: ["credit_card"], any: [] };

async function loadKeys(admin: ReturnType<typeof createClient>) {
  const env = { server: Deno.env.get("MIDTRANS_SERVER_KEY") ?? "", client: Deno.env.get("MIDTRANS_CLIENT_KEY") ?? "", prod: (Deno.env.get("MIDTRANS_IS_PRODUCTION") ?? "false") === "true", source: "secret" };
  if (env.server) return env;
  const { data } = await admin.from("gateway_secrets").select("server_key, client_key, is_production").eq("provider", "midtrans").maybeSingle();
  if (data?.server_key) return { server: data.server_key as string, client: (data.client_key as string) ?? "", prod: !!data.is_production, source: "admin" };
  return { server: "", client: "", prod: false, source: "none" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const auth = req.headers.get("Authorization") ?? "";
    const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const { data: { user } } = await supa.auth.getUser();
    if (!user) return json({ error: "Harus login" }, 401);
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json();
    const keys = await loadKeys(admin);
    const base = keys.prod ? "https://app.midtrans.com" : "https://app.sandbox.midtrans.com";
    const apiBase = keys.prod ? "https://api.midtrans.com" : "https://api.sandbox.midtrans.com";

    // ---- Admin: uji koneksi (tanpa membuat transaksi asli: cek status order_id dummy → 404 = kunci valid, 401 = kunci salah) ----
    if (body.action === "status") {
      const { data: prof } = await admin.from("profiles").select("role").eq("id", user.id).single();
      if (prof?.role !== "admin") return json({ error: "Hanya admin" }, 403);
      if (!keys.server) return json({ configured: false, source: keys.source, message: "Server key belum diisi — mode simulasi aktif" });
      const res = await fetch(`${apiBase}/v2/AK-PING-${Date.now()}/status`, { headers: { Accept: "application/json", Authorization: "Basic " + btoa(keys.server + ":") } });
      const d = await res.json().catch(() => ({}));
      const ok = res.status === 404 || d?.status_code === "404";
      return json({ configured: true, source: keys.source, is_production: keys.prod, reachable: ok, http: res.status, message: ok ? "Kunci valid, Midtrans dapat dihubungi" : res.status === 401 ? "Server key ditolak Midtrans (401) — periksa kunci & mode sandbox/production" : `Respons Midtrans: ${res.status}` });
    }

    // ---- Sakelar AntarPay (migrasi 0088): saat nonaktif, tidak ada transaksi Snap baru yang dibuat ----
    const { data: antarpayOn, error: toggleErr } = await admin.rpc("antarpay_enabled");
    if (toggleErr) return json({ error: "Status AntarPay tidak dapat diperiksa — coba lagi" }, 503);
    if (antarpayOn !== true) return json({ error: "AntarPay sedang dinonaktifkan sementara. Gunakan pembayaran tunai.", antarpay_enabled: false }, 403);

    const { amount, method = "any", purpose = "topup", order_id = null } = body;
    const amt = Math.round(Number(amount));
    const { data: cfg } = await admin.rpc("gateway_public_config");
    const min = Number(cfg?.topup_min ?? 10000), max = Number(cfg?.topup_max ?? 10000000);
    if (!amt || amt < min || amt > max) return json({ error: `Nominal Rp${min.toLocaleString("id-ID")} – Rp${max.toLocaleString("id-ID")}` }, 400);
    const allowed: string[] = Array.isArray(cfg?.methods) ? cfg.methods : [];
    if (method !== "any" && allowed.length && !allowed.includes(method)) return json({ error: "Metode pembayaran tidak diaktifkan admin" }, 400);

    const { data: prof } = await admin.from("profiles").select("full_name, email, phone").eq("id", user.id).single();
    const externalId = `AKPAY-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const provider = keys.server ? "midtrans" : "simulated";
    const { data: pay, error } = await admin.from("payments").insert({ user_id: user.id, order_id, purpose, amount: amt, method, provider, external_id: externalId }).select("*").single();
    if (error) return json({ error: error.message }, 500);
    if (!keys.server) return json({ payment: pay, simulated: true, message: "Mode simulasi: isi Server Key Midtrans di Panel Admin → Payment Gateway untuk transaksi asli." });

    const snapBody = {
      transaction_details: { order_id: externalId, gross_amount: amt },
      item_details: [{ id: purpose, price: amt, quantity: 1, name: purpose === "topup" ? "Top up AntarPay" : "Pembayaran pesanan AntarKita" }],
      customer_details: { first_name: prof?.full_name ?? "Pengguna", email: prof?.email ?? user.email, phone: prof?.phone ?? undefined },
      enabled_payments: METHODS[method]?.length ? METHODS[method] : undefined,
      expiry: { unit: "minutes", duration: 30 },
      custom_field1: user.id, custom_field2: purpose,
    };
    const res = await fetch(`${base}/snap/v1/transactions`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: "Basic " + btoa(keys.server + ":") }, body: JSON.stringify(snapBody) });
    const snap = await res.json();
    if (!res.ok || !snap.token) { await admin.from("payments").update({ status: "failure", raw: snap }).eq("id", pay.id); return json({ error: snap.error_messages?.join(", ") ?? "Midtrans menolak transaksi" }, 502); }
    const { data: updated } = await admin.from("payments").update({ snap_token: snap.token, redirect_url: snap.redirect_url, raw: snap }).eq("id", pay.id).select("*").single();
    return json({ payment: updated, simulated: false, snap_token: snap.token, redirect_url: snap.redirect_url, client_key: keys.client || null, is_production: keys.prod });
  } catch (e) { return json({ error: (e as Error).message }, 500); }
});
