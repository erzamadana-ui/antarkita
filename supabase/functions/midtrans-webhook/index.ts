// Edge Function: notifikasi Midtrans (HTTP notification) → verifikasi signature → payment_settle().
// v3: jalur {simulate} lama dihapus → pay-webhook/simulated. Transaksi baru (pay-create) memakai pay-webhook/midtrans.
// verify_jwt = false karena Midtrans memanggil tanpa JWT; keaslian dicek lewat signature_key (SHA-512 server key).
//
// Skema Bisnis v2 (migrasi 0100): saluran pembayaran diekstrak dari notifikasi (payment_type + bank/va_numbers/
// acquirer/issuer/store) lalu dipetakan ke kunci payment_channel_fees (bank_transfer, card, gopay, shopeepay, qris,
// dana, ovo, akulaku, kredivo, alfamart, indomaret) dan diteruskan ke payment_settle(p_channel, p_settlement_time)
// agar biaya PG (pg_fee + PPN), hold_until, dan — untuk purpose='order' — status pesanan + buku besar terisi.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
async function sha512(s: string) { const d = await crypto.subtle.digest("SHA-512", new TextEncoder().encode(s)); return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join(""); }

type MidtransNotif = {
  payment_type?: string; bank?: string; va_numbers?: { bank?: string; va_number?: string }[]; permata_va_number?: string;
  acquirer?: string; issuer?: string; store?: string; settlement_time?: string; transaction_time?: string;
  [k: string]: unknown;
};

// Kunci saluran (payment_channel_fees.channel) dari notifikasi Midtrans.
// bank_transfer/echannel/permata → bank_transfer (VA, bank untuk hold H+n dibaca payment_settle dari raw);
// credit_card → card; cstore → alfamart|indomaret (field store); qris tetap qris apa pun acquirer/issuer-nya
// (tarif QRIS 0,7 % berlaku untuk semua penerbit — Lampiran QRIS PKS).
export function channelOf(n: MidtransNotif): string | null {
  const t = String(n.payment_type ?? "").toLowerCase();
  switch (t) {
    case "bank_transfer": case "echannel": case "permata": return "bank_transfer";
    case "credit_card": return "card";
    case "gopay": return "gopay";
    case "shopeepay": return "shopeepay";
    case "qris": return "qris";
    case "dana": return "dana";
    case "ovo": return "ovo";
    case "akulaku": return "akulaku";
    case "kredivo": return "kredivo";
    case "cstore": {
      const s = String(n.store ?? "").toLowerCase();
      return s.includes("indomaret") ? "indomaret" : s.includes("alfa") ? "alfamart" : null;
    }
    default: return null;
  }
}

// Bank VA (untuk hold H+n: BSI/SeaBank H+2) — informatif; payment_settle juga membaca dari raw.
export function bankOf(n: MidtransNotif): string | null {
  const t = String(n.payment_type ?? "").toLowerCase();
  if (Array.isArray(n.va_numbers) && n.va_numbers[0]?.bank) return String(n.va_numbers[0].bank).toLowerCase();
  if (t === "permata" || n.permata_va_number) return "permata";
  if (t === "echannel") return "mandiri";
  return n.bank ? String(n.bank).toLowerCase() : null;
}

// Midtrans mengirim "YYYY-MM-DD HH:mm:ss" dalam WIB (GMT+7) tanpa zona → ISO dengan +07:00.
export function settlementIso(n: MidtransNotif): string | null {
  const raw = (n.settlement_time ?? n.transaction_time) as string | undefined;
  if (!raw || typeof raw !== "string") return null;
  const m = raw.trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/);
  if (!m) return null;
  const d = new Date(`${m[1]}T${m[2]}+07:00`);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const body = await req.json();
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    // Server key: secret → tabel gateway_secrets (diisi admin dari panel)
    // v3: gateway_secrets berkunci (provider, env) → bisa lebih dari satu kunci Midtrans; signature dicoba ke setiap kunci.
    const keys: string[] = [];
    if (Deno.env.get("MIDTRANS_SERVER_KEY")) keys.push(Deno.env.get("MIDTRANS_SERVER_KEY")!);
    { const { data } = await admin.from("gateway_secrets").select("server_key").eq("provider", "midtrans"); for (const r of data ?? []) if (r.server_key && !keys.includes(r.server_key as string)) keys.push(r.server_key as string); }
    const serverKey = keys[0] ?? "";

    // ---- Simulasi lama DIHAPUS (v3) — gunakan POST /pay-webhook/simulated (JWT pemilik, payments_simulation_enabled, env≠production) ----
    if (body.simulate) return json({ error: "Simulasi dipindahkan ke pay-webhook/simulated", use: "pay-webhook/simulated" }, 410);

    // ---- Notifikasi Midtrans asli ----
    if (!serverKey) return json({ error: "Server key belum diatur" }, 400);
    const { order_id, status_code, gross_amount, signature_key, transaction_status, fraud_status } = body;
    let sigOk = false;
    for (const k of keys) { if ((await sha512(`${order_id}${status_code}${gross_amount}${k}`)) === String(signature_key ?? "")) { sigOk = true; break; } }
    if (!sigOk) return json({ error: "Signature tidak valid" }, 403);
    let status = "pending";
    if (transaction_status === "capture") status = fraud_status === "accept" ? "settlement" : "pending";
    else if (transaction_status === "settlement") status = "settlement";
    else if (["cancel", "deny", "expire", "failure"].includes(transaction_status)) status = transaction_status;

    const notif = body as MidtransNotif;
    const channel = channelOf(notif);
    const raw = { ...body, _antarkita: { channel, bank: bankOf(notif), acquirer: notif.acquirer ?? null, issuer: notif.issuer ?? null } };
    const { data, error } = await admin.rpc("payment_settle", {
      p_external_id: order_id, p_status: status, p_raw: raw,
      p_channel: channel, p_settlement_time: status === "settlement" ? settlementIso(notif) : null,
    });
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, status: data?.status, channel, pg_fee: data?.pg_fee ?? 0, pg_fee_ppn: data?.pg_fee_ppn ?? 0 });
  } catch (e) { return json({ error: (e as Error).message }, 500); }
});
