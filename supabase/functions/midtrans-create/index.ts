// Edge Function: buat transaksi Midtrans Snap — top up AntarVoucher ATAU bayar satu pesanan (purpose='order').
// Kunci dibaca dari (1) secret MIDTRANS_SERVER_KEY / MIDTRANS_CLIENT_KEY / MIDTRANS_IS_PRODUCTION, atau
// (2) tabel gateway_secrets yang diisi admin dari Panel Admin → Payment Gateway (tanpa CLI).
// Tanpa keduanya → mode simulasi agar alur tetap bisa diuji.
// Aksi khusus: { action: "status" } (admin) → cek koneksi ke Midtrans dengan kunci yang tersimpan.
//
// Bayar per order (Skema Bisnis v2, migrasi 0100; PKS Midtrans Pasal 7.4b — bukan isi saldo):
//   body { purpose: "order", order_id, method? }  (method = kunci saluran gateway; default saluran saat create_order)
//   → RPC order_payment_prepare (JWT pelanggan): pesanan milik pemanggil & berstatus awaiting_payment, saluran aktif,
//     biaya PG dihitung ulang (pg_fee_calc; pg_fee_policy='customer' → "Biaya pembayaran" ditambahkan ke total)
//   → payments(purpose='order', order_id, amount = gross) → Snap dengan enabled_payments saluran itu
//   → webhook settlement → payment_settle: orders.payment_status='paid', status 'searching', buku besar.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
// Pemetaan metode aplikasi → enabled_payments Snap. OVO/DANA lewat QRIS (dipindai dari aplikasi e-wallet masing-masing).
// Label saluran (0089) — sama dengan payment_channel_label() di server, untuk pesan penolakan berbahasa Indonesia.
const CHANNEL_LABEL: Record<string, string> = { gopay: "GoPay", shopeepay: "ShopeePay", qris: "QRIS", ovo: "OVO", dana: "DANA", bank_transfer: "Transfer bank (VA)", card: "Kartu kredit/debit" };
const METHODS: Record<string, string[]> = { gopay: ["gopay"], shopeepay: ["shopeepay"], qris: ["other_qris"], bank_transfer: ["bank_transfer", "echannel", "permata_va", "bca_va", "bni_va", "bri_va", "cimb_va"], ovo: ["other_qris"], dana: ["other_qris"], card: ["credit_card"], any: [] };

type OrderQuote = {
  order_id: string; code: string; service: string; channel: string; channel_label: string; gross: number;
  pg_fee: number; pg_fee_ppn: number; pg_fee_borne_by: string | null; customer_payment_fee: number; expires_at: string; timeout_min: number;
};

async function loadKeys(admin: ReturnType<typeof createClient>) {
  // v3 (T1): kunci HARUS sesuai payment_provider_env — payments.env diisi trigger dari setting yang sama, dan
  // pay-webhook/midtrans memverifikasi notifikasi hanya dengan kunci env transaksi. Tidak ada fallback ke env lain.
  const { data: envRow } = await admin.from("app_settings").select("value").eq("key", "payment_provider_env").maybeSingle();
  const want = envRow?.value === "production" ? "production" : "sandbox";
  const env = { server: Deno.env.get("MIDTRANS_SERVER_KEY") ?? "", client: Deno.env.get("MIDTRANS_CLIENT_KEY") ?? "", prod: (Deno.env.get("MIDTRANS_IS_PRODUCTION") ?? "false") === "true", source: "secret" };
  if (env.server && env.prod === (want === "production")) return env;
  const { data: rows } = await admin.from("gateway_secrets").select("*").eq("provider", "midtrans");
  const list = (rows ?? []).filter((r: Record<string, unknown>) => r.server_key);
  const data = list.find((r: Record<string, unknown>) => r.env === want) ?? list.find((r: Record<string, unknown>) => r.env == null && !!r.is_production === (want === "production"));
  if (data?.server_key) return { server: data.server_key as string, client: (data.client_key as string) ?? "", prod: data.env ? data.env === "production" : !!data.is_production, source: "admin" };
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

    const purpose: string = body.purpose === "order" ? "order" : "topup";

    // ---- Guard provider v3 (KONTRAK-API-V3 §9): transaksi pesanan baru lewat pay-create bila provider aktif bukan Midtrans ----
    {
      const { data: act } = await admin.from("app_settings").select("value").eq("key", "payment_provider_active").maybeSingle();
      const active = typeof act?.value === "string" ? act.value : "midtrans"; // setting belum ada (pra-v3) → perilaku lama
      if (purpose === "order" && active !== "midtrans") {
        return json({ error: "Metode pembayaran telah diperbarui. Perbarui aplikasi lalu coba lagi.", provider: active, use: "pay-create" }, 409);
      }
    }
    // Mode simulasi lama dihapus (v3): tanpa server key tidak ada transaksi yang dibuat. Simulasi kini hanya lewat
    // pay-create + pay-webhook/simulated (payments_simulation_enabled & env≠production).
    if (!keys.server) return json({ error: "Gateway Midtrans belum dikonfigurasi. Hubungi admin.", configured: false }, 503);
    const { data: prof } = await admin.from("profiles").select("full_name, email, phone").eq("id", user.id).single();
    const provider = keys.server ? "midtrans" : "simulated";
    const customer = { first_name: prof?.full_name ?? "Pengguna", email: prof?.email ?? user.email, phone: prof?.phone ?? undefined };

    // =================== Bayar satu pesanan (purpose='order') ===================
    if (purpose === "order") {
      const orderId = typeof body.order_id === "string" ? body.order_id : "";
      if (!/^[0-9a-f-]{36}$/i.test(orderId)) return json({ error: "order_id wajib diisi" }, 400);
      const method = typeof body.method === "string" && body.method !== "any" ? body.method : null;
      // Validasi kepemilikan, status awaiting_payment, saluran aktif & hitung gross — di server (JWT pelanggan → auth.uid()).
      const { data: quote, error: qErr } = await supa.rpc("order_payment_prepare", { p_order: orderId, p_channel: method });
      if (qErr || !quote) return json({ error: qErr?.message ?? "Pesanan tidak dapat dibayar" }, 400);
      const q = quote as OrderQuote;
      const gross = Math.round(Number(q.gross));
      if (!gross || gross <= 0) return json({ error: "Total pesanan tidak valid" }, 400);
      const minutesLeft = Math.max(1, Math.floor((new Date(q.expires_at).getTime() - Date.now()) / 60000));

      // Transaksi Snap yang masih menunggu untuk pesanan & nominal yang sama → pakai ulang (ketuk ganda / buka ulang layar)
      const { data: pending } = await admin.from("payments").select("*")
        .eq("order_id", q.order_id).eq("purpose", "order").eq("status", "pending").eq("amount", gross).eq("pg_channel", q.channel)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (pending && (pending.snap_token || provider === "simulated")) {
        return json({ payment: pending, reused: true, simulated: provider === "simulated", snap_token: pending.snap_token, redirect_url: pending.redirect_url, client_key: keys.client || null, is_production: keys.prod, order: q });
      }

      const externalId = `AKORD-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
      const { data: pay, error } = await admin.from("payments").insert({ user_id: user.id, order_id: q.order_id, purpose: "order", amount: gross, method: q.channel, pg_channel: q.channel, provider, external_id: externalId }).select("*").single();
      if (error) return json({ error: error.message }, 500);
      if (!keys.server) return json({ payment: pay, simulated: true, order: q, message: "Mode simulasi: isi Server Key Midtrans di Panel Admin → Payment Gateway untuk transaksi asli." });

      // item_details harus berjumlah = gross_amount. Biaya pembayaran (policy=customer) tampil sebagai baris terpisah (§9).
      const fee = Math.max(0, Math.round(Number(q.customer_payment_fee ?? 0)));
      const items = fee > 0 && fee < gross
        ? [{ id: q.code, price: gross - fee, quantity: 1, name: `Pesanan ${q.code}` }, { id: "payment_fee", price: fee, quantity: 1, name: "Biaya pembayaran" }]
        : [{ id: q.code, price: gross, quantity: 1, name: `Pesanan ${q.code}` }];
      const snapBody = {
        transaction_details: { order_id: externalId, gross_amount: gross },
        item_details: items,
        customer_details: customer,
        enabled_payments: METHODS[q.channel]?.length ? METHODS[q.channel] : undefined,
        expiry: { unit: "minutes", duration: minutesLeft },
        custom_field1: user.id, custom_field2: "order", custom_field3: q.code,
      };
      const res = await fetch(`${base}/snap/v1/transactions`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: "Basic " + btoa(keys.server + ":") }, body: JSON.stringify(snapBody) });
      const snap = await res.json();
      if (!res.ok || !snap.token) { await admin.from("payments").update({ status: "failure", raw: snap }).eq("id", pay.id); return json({ error: snap.error_messages?.join(", ") ?? "Midtrans menolak transaksi" }, 502); }
      const { data: updated } = await admin.from("payments").update({ snap_token: snap.token, redirect_url: snap.redirect_url, raw: snap }).eq("id", pay.id).select("*").single();
      return json({ payment: updated, simulated: false, snap_token: snap.token, redirect_url: snap.redirect_url, client_key: keys.client || null, is_production: keys.prod, order: q });
    }

    // =================== Top up AntarVoucher (alur lama) ===================
    // ---- Sakelar AntarVoucher (migrasi 0088): saat nonaktif, tidak ada transaksi Snap baru yang dibuat ----
    const { data: antarpayOn, error: toggleErr } = await admin.rpc("antarpay_enabled");
    if (toggleErr) return json({ error: "Status AntarVoucher tidak dapat diperiksa — coba lagi" }, 503);
    if (antarpayOn !== true) return json({ error: "AntarVoucher sedang dinonaktifkan sementara. Gunakan pembayaran tunai.", antarpay_enabled: false }, 403);

    const { amount, method = "any" } = body;
    const amt = Math.round(Number(amount));
    const { data: cfg } = await admin.rpc("gateway_public_config");
    const min = Number(cfg?.topup_min ?? 10000), max = Number(cfg?.topup_max ?? 10000000);
    if (!amt || amt < min || amt > max) return json({ error: `Nominal Rp${min.toLocaleString("id-ID")} – Rp${max.toLocaleString("id-ID")}` }, 400);
    const allowed: string[] = Array.isArray(cfg?.methods) ? cfg.methods : [];
    if (method !== "any" && allowed.length && !allowed.includes(method)) return json({ error: "Metode pembayaran tidak diaktifkan admin" }, 400);
    // ---- Saluran pembayaran per metode (migrasi 0089): sumber kebenaran, tidak bergantung pada pg_methods yang bisa kosong ----
    // Saldo AntarVoucher adalah rail top up: kalau saluran 'antarpay' mati, top up ditutup supaya pelanggan
    // tidak menyetor dana ke dompet yang tak bisa dipakai.
    {
      const { data: apOn, error: apErr } = await admin.rpc("payment_channel_enabled", { p_key: "antarpay" });
      if (apErr) return json({ error: "Status saluran pembayaran tidak dapat diperiksa — coba lagi" }, 503);
      if (apOn !== true) return json({ error: "Saluran AntarVoucher (saldo) sedang dinonaktifkan. Top up ditutup sementara.", channel: "antarpay" }, 403);
    }
    if (method !== "any") {
      const { data: chOn, error: chErr } = await admin.rpc("payment_channel_enabled", { p_key: method });
      if (chErr) return json({ error: "Status saluran pembayaran tidak dapat diperiksa — coba lagi" }, 503);
      if (chOn !== true) return json({ error: `Metode pembayaran ${CHANNEL_LABEL[method] ?? method} sedang dinonaktifkan. Pilih metode lain.`, channel: method }, 403);
    }

    const externalId = `AKPAY-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const { data: pay, error } = await admin.from("payments").insert({ user_id: user.id, order_id: null, purpose: "topup", amount: amt, method, pg_channel: method !== "any" ? method : null, provider, external_id: externalId }).select("*").single();
    if (error) return json({ error: error.message }, 500);
    if (!keys.server) return json({ payment: pay, simulated: true, message: "Mode simulasi: isi Server Key Midtrans di Panel Admin → Payment Gateway untuk transaksi asli." });

    const snapBody = {
      transaction_details: { order_id: externalId, gross_amount: amt },
      item_details: [{ id: "topup", price: amt, quantity: 1, name: "Top up AntarVoucher" }],
      customer_details: customer,
      enabled_payments: METHODS[method]?.length ? METHODS[method] : undefined,
      expiry: { unit: "minutes", duration: 30 },
      custom_field1: user.id, custom_field2: "topup",
    };
    const res = await fetch(`${base}/snap/v1/transactions`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: "Basic " + btoa(keys.server + ":") }, body: JSON.stringify(snapBody) });
    const snap = await res.json();
    if (!res.ok || !snap.token) { await admin.from("payments").update({ status: "failure", raw: snap }).eq("id", pay.id); return json({ error: snap.error_messages?.join(", ") ?? "Midtrans menolak transaksi" }, 502); }
    const { data: updated } = await admin.from("payments").update({ snap_token: snap.token, redirect_url: snap.redirect_url, raw: snap }).eq("id", pay.id).select("*").single();
    return json({ payment: updated, simulated: false, snap_token: snap.token, redirect_url: snap.redirect_url, client_key: keys.client || null, is_production: keys.prod });
  } catch (e) { return json({ error: (e as Error).message }, 500); }
});
