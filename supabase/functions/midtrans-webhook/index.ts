// Edge Function: midtrans-webhook (URL notifikasi lama di dashboard Midtrans) — v3: PEMBUNGKUS TIPIS.
// Semua notifikasi diteruskan ke handler pay-webhook/midtrans yang sama (review T2):
//   transaksi dicari dulu (payments.provider harus 'midtrans'; tidak ditemukan → 200 tanpa tulis), signature
//   SHA512(order_id+status_code+gross_amount+serverKey) HANYA dengan kunci env transaksi (payments.env), cek status ke
//   Midtrans, lalu payment_event_ingest(..., p_env). Tidak ada lagi payment_settle langsung, tidak ada coba-semua-kunci,
//   tidak ada jalur simulasi. Status refund/partial_refund/chargeback ikut diterima (REFUNDED/PARTIALLY_REFUNDED/DISPUTED)
//   dengan refund_amount kumulatif dari refunds[]/refund_amount.
// Rate limit per IP & allowlist opsional MIDTRANS_CALLBACK_IP_ALLOWLIST berlaku sama.
// Deploy: supabase functions deploy midtrans-webhook --no-verify-jwt
import { realDeps } from "../_shared/db.ts";
import { makeWebhookHandler } from "../pay-webhook/handler.ts";

Deno.serve(makeWebhookHandler(realDeps(), { forceRoute: "midtrans" }));
