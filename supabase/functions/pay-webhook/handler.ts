// pay-webhook — penerima notifikasi semua provider (KONTRAK §9).
//   POST /pay-webhook/finpay               callback pembayaran Finpay (HMAC-SHA512) → checkStatus → payment_event_ingest
//   POST /pay-webhook/finpay-disbursement  callback disbursement Finpay (HMAC-SHA512) → payout_event_ingest
//   POST /pay-webhook/midtrans             notifikasi Midtrans (SHA512) → checkStatus → payment_event_ingest
//                                          (juga dipakai midtrans-webhook lama sebagai pembungkus tipis)
//   POST /pay-webhook/simulated            simulasi (JWT pemilik + payments_simulation_enabled + env≠production)
// Deploy dengan --no-verify-jwt (provider memanggil tanpa JWT); keaslian dicek lewat signature.
//
// Keamanan (review T1/T2/S5/R6):
//  • Env TERIKAT ke transaksi: transaksi dicari dulu (payments.env / prefiks external_id disbursement), lalu signature
//    diverifikasi HANYA dengan kunci env itu, checkStatus ke host env itu, dan p_env dikirim ke payment_event_ingest.
//  • Transaksi tidak ditemukan / provider lain → 200 + log (tanpa menulis apa pun).
//  • Signature salah → 401, TIDAK ditulis ke payment_events (append-only; cegah DoS) — hanya log bersampel + hitungan.
//  • Rate limit per IP (default 60/menit, WEBHOOK_RATE_LIMIT_PER_MIN); IP di allowlist provider dikecualikan.
//  • Retry: duplikat → 200; error DB / RPC 'error: …' / provider tak bisa dihubungi → 5xx agar provider mengirim ulang.
import { loadPaySettings, simulationAllowed } from "../_shared/config.ts";
import type { Deps } from "../_shared/deps.ts";
import { clientIp, HttpError, json, preflight, RateLimiter, readBodyLimited, readJson, routeAfter } from "../_shared/http.ts";
import { ingestPaymentEvent, ingestPayoutEvent } from "../_shared/ingest.ts";
import { firstPath, safeParse } from "../_shared/jsonutil.ts";
import { log } from "../_shared/log.ts";
import { disbursementEnvOf, findPaymentByRef, paymentEnv, refundTotalOf } from "../_shared/payments.ts";
import { buildProvider, disbursementSecrets, FinpayProvider, providerFor } from "../_shared/providers/index.ts";
import { SIMULATED_ALLOWED_STATUSES } from "../_shared/providers/simulated.ts";
import type { PaymentProvider, ProviderEnv, VerifiedNotification } from "../_shared/providers/types.ts";

const FINPAY_OK = { responseCode: "2000000", responseMessage: "Success" };
const finpayErr = (status: number, code: string, msg: string) => json({ responseCode: code, responseMessage: msg }, status);

const parseList = (v: string | undefined) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

/**
 * Allowlist IP callback: kosong = TIDAK memblokir (pemanggil mencatat peringatan). IP dari clientIp() (R6).
 */
export function callerIpAllowed(req: Request, allowlist: string | undefined): boolean {
  const list = parseList(allowlist);
  if (!list.length) return true;
  const ip = clientIp(req);
  return !!ip && list.includes(ip);
}

const PUBLIC_ROUTES = new Set(["finpay", "finpay-disbursement", "midtrans"]);

export interface WebhookOptions {
  /** Paksa rute (dipakai midtrans-webhook lama → "midtrans"). */
  forceRoute?: string;
}

export function makeWebhookHandler(deps: Deps, opts: WebhookOptions = {}) {
  const limit = Math.max(1, Number(deps.env("WEBHOOK_RATE_LIMIT_PER_MIN") ?? 60) || 60);
  const limiter = new RateLimiter(limit, 60_000, () => deps.now());
  const stats = { badSignature: 0, notFound: 0, rateLimited: 0, allowlistWarned: false };

  return async (req: Request): Promise<Response> => {
    const pre = preflight(req);
    if (pre) return pre;
    if (req.method !== "POST") return json({ error: "Metode tidak diizinkan" }, 405);
    const route = opts.forceRoute ?? routeAfter(req, "pay-webhook");
    const isFinpay = route.startsWith("finpay");
    try {
      if (PUBLIC_ROUTES.has(route) || route === "simulated") {
        const ip = clientIp(req) || "unknown";
        const allow = isFinpay ? deps.env("FINPAY_CALLBACK_IP_ALLOWLIST") : route === "midtrans" ? deps.env("MIDTRANS_CALLBACK_IP_ALLOWLIST") : undefined;
        const list = parseList(allow);
        if (PUBLIC_ROUTES.has(route)) {
          if (!list.length) {
            if (!stats.allowlistWarned) { stats.allowlistWarned = true; log.warn("webhook_ip_allowlist_empty", { route, note: "tidak memblokir; isi *_CALLBACK_IP_ALLOWLIST" }); }
          } else if (!list.includes(ip)) {
            log.warn("webhook_ip_rejected", { route, ip });
            return isFinpay ? finpayErr(403, "4030000", "Forbidden") : json({ error: "Forbidden" }, 403);
          }
        }
        // IP resmi provider (allowlist) tidak dibatasi; selain itu 60/menit per IP.
        if (!list.includes(ip) && !limiter.take(`${route}:${ip}`)) {
          stats.rateLimited++;
          if (stats.rateLimited <= 5 || stats.rateLimited % 100 === 0) log.warn("webhook_rate_limited", { route, ip, total: stats.rateLimited });
          return isFinpay ? finpayErr(429, "4290000", "Too Many Requests") : json({ error: "Terlalu banyak permintaan" }, 429);
        }
      }
      switch (route) {
        case "finpay": return await paymentRoute(deps, req, "finpay", stats);
        case "midtrans": return await paymentRoute(deps, req, "midtrans", stats);
        case "finpay-disbursement": return await finpayDisbursement(deps, req, stats);
        case "simulated": return await simulated(deps, req);
        default: return json({ error: "Rute webhook tidak dikenal" }, 404);
      }
    } catch (e) {
      if (e instanceof HttpError) return isFinpay ? finpayErr(e.status, `${e.status}0000`, e.message) : json({ error: e.message, ...(e.body ?? {}) }, e.status);
      log.error("webhook_unhandled", { route, error: e as Error });
      return isFinpay ? finpayErr(500, "5000000", "Internal error") : json({ error: "Kesalahan server" }, 500);
    }
  };
}

type Stats = { badSignature: number; notFound: number };

function sampled(n: number) { return n <= 5 || n % 50 === 0; }

const ok = (name: "finpay" | "midtrans", extra: Record<string, unknown> = {}) =>
  name === "finpay" ? json(FINPAY_OK, 200) : json({ ok: true, ...extra }, 200);

/** Finpay & Midtrans: cari transaksi → env → verifikasi dengan kunci env itu → konfirmasi → ingest(p_env). */
async function paymentRoute(deps: Deps, req: Request, name: "finpay" | "midtrans", stats: Stats): Promise<Response> {
  const raw = await readBodyLimited(req);
  const parsed = safeParse(raw);
  const externalId = parsed && typeof parsed === "object"
    ? String(firstPath(parsed, name === "finpay" ? ["order.id", "orderId"] : ["order_id"]) ?? "")
    : "";
  if (!externalId) return name === "finpay" ? finpayErr(400, "4000000", "Missing order.id") : json({ error: "order_id kosong" }, 400);

  const pay = await findPaymentByRef(deps.db, externalId); // error DB → throw → 5xx (retry)
  if (!pay || pay.provider !== name) {
    stats.notFound++;
    if (sampled(stats.notFound)) log.warn("webhook_payment_not_found", { provider: name, external_id: externalId, found_provider: pay?.provider ?? null, total: stats.notFound });
    return ok(name, { ignored: true });
  }
  const settings = await loadPaySettings(deps.db);
  const env: ProviderEnv = paymentEnv(pay, settings.env);
  const provider = await providerFor(deps, name, env);
  if (!provider) {
    log.error("webhook_not_configured", { provider: name, env });
    return name === "finpay" ? finpayErr(503, "5030000", "Not configured") : json({ error: "Kunci gateway belum diatur" }, 503);
  }
  const v = await provider.verifyNotification(raw, req.headers);
  if (!v.ok) {
    stats.badSignature++;
    if (sampled(stats.badSignature)) log.warn("webhook_bad_signature", { provider: name, env, reason: v.reason, external_id: externalId, ip: clientIp(req), total: stats.badSignature });
    return name === "finpay" ? finpayErr(401, "4010000", "Invalid signature") : json({ error: "Signature tidak valid" }, 401);
  }
  const res = await confirmAndIngest(deps, provider, v, env);
  if (res === "retry") return name === "finpay" ? finpayErr(503, "5030000", "Temporarily unavailable") : json({ error: "Coba lagi" }, 503);
  if (res.failed) {
    log.error("webhook_ingest_error", { provider: name, external_id: externalId, note: res.note });
    return name === "finpay" ? finpayErr(500, "5000000", "Processing error") : json({ error: "Kesalahan pemrosesan" }, 500);
  }
  return ok(name, { duplicate: res.duplicate, pay_status: res.pay_status });
}

/**
 * Defense-in-depth: signature sah TIDAK cukup untuk status bernilai uang. Untuk status selain PENDING, status
 * ditanyakan ulang ke provider (checkStatus, host env transaksi) dan status/amount dari provider-lah yang di-ingest.
 * Gagal menghubungi provider → "retry" (5xx, provider mengulang; rekonsiliasi juga menangkapnya).
 */
async function confirmAndIngest(deps: Deps, provider: PaymentProvider, v: VerifiedNotification, env: ProviderEnv) {
  const claimed = provider.normalizeStatus(v.providerStatus);
  let providerStatus = v.providerStatus;
  let amount = v.amount;
  let check: unknown = null;
  let note: string | null = null;
  if (claimed !== "PENDING") {
    const c = await provider.checkStatus(v.externalId!);
    check = c.raw;
    if (c.providerStatus === "NOT_FOUND") {
      // Provider tidak mengenal transaksi padahal callback bersignature sah → dicatat untuk audit, tidak diterapkan.
      note = "unconfirmed_not_found";
      providerStatus = "UNCONFIRMED";
      amount = null;
    } else if (!c.ok || !c.found) {
      log.warn("webhook_checkstatus_failed", { provider: provider.name, external_id: v.externalId, claimed: v.providerStatus, error: c.error });
      return "retry" as const;
    } else {
      if (c.providerStatus.toUpperCase() !== v.providerStatus.toUpperCase()) note = `callback=${v.providerStatus};check=${c.providerStatus}`;
      providerStatus = c.providerStatus;
      if (c.amount !== null) {
        if (v.amount !== null && c.amount !== v.amount) note = `${note ? note + ";" : ""}amount_mismatch callback=${v.amount} check=${c.amount}`;
        amount = c.amount;
      }
    }
    if (note) log.warn("webhook_status_reconciled", { provider: provider.name, external_id: v.externalId, note });
  }
  const finalStatus = provider.normalizeStatus(providerStatus);
  // Payload callback di TINGKAT ATAS: payment_settle (0105) membaca gross_amount, va_numbers, payment_type,
  // settlement_time, _antarkita.channel dari p_raw untuk cek nominal, biaya PG, dan hold.
  const raw: Record<string, unknown> = {
    ...(v.raw && typeof v.raw === "object" ? v.raw as Record<string, unknown> : {}),
    check,
    _antarkita: { env, verified_via: v.verifiedVia, channel: v.channel ?? null, claimed_status: v.providerStatus, pay_status: finalStatus, note },
  };
  if (finalStatus === "REFUNDED" || finalStatus === "PARTIALLY_REFUNDED") {
    // Total refund kumulatif eksplisit (DB 0105 hanya memakai p_raw.refund_amount untuk refund sebagian).
    const total = refundTotalOf(provider.name, check, v.raw);
    if (total !== null) raw.refund_amount = total;
    raw.event_type = "refund";
  } else if (finalStatus === "DISPUTED") raw.event_type = "chargeback";
  const eventId = note === "unconfirmed_not_found" ? `${v.eventId}-unconfirmed` : v.eventId;
  return await ingestPaymentEvent(deps, {
    provider: provider.name, eventId, externalId: v.externalId, providerStatus, amount, signatureOk: true, env, raw,
  });
}

async function finpayDisbursement(deps: Deps, req: Request, stats: Stats): Promise<Response> {
  const raw = await readBodyLimited(req);
  const parsed = safeParse(raw);
  const externalId = parsed && typeof parsed === "object" ? String(firstPath(parsed, ["order.id", "orderId", "referenceId"]) ?? "") : "";
  if (!externalId || !/^[A-Za-z0-9_-]{1,64}$/.test(externalId)) return finpayErr(400, "4000000", "Missing order.id");
  const { data: w, error } = await deps.db.from("withdrawal_requests").select("id, provider, provider_ref, payout_status")
    .eq("provider_ref", externalId).maybeSingle();
  if (error) throw new Error(`lookup withdrawal: ${error.message}`);
  if (!w || w.provider !== "finpay") {
    stats.notFound++;
    if (sampled(stats.notFound)) log.warn("disbursement_callback_not_found", { external_id: externalId, total: stats.notFound });
    return json(FINPAY_OK, 200);
  }
  const settings = await loadPaySettings(deps.db);
  const env = disbursementEnvOf(w.provider_ref) ?? settings.env;
  const s = await disbursementSecrets(deps, env);
  if (!s) return finpayErr(503, "5030000", "Not configured");
  const prov = buildProvider("finpay", s, deps, env) as FinpayProvider;
  const verified = await prov.verifyDisbursementCallback(raw);
  if (!verified.ok) {
    stats.badSignature++;
    if (sampled(stats.badSignature)) log.warn("finpay_disbursement_bad_signature", { env, reason: verified.reason, external_id: externalId, total: stats.badSignature });
    return finpayErr(401, "4010000", "Invalid signature");
  }
  let status = verified.payoutStatus;
  let check: unknown = null;
  // Konfirmasi status bila endpoint cek disbursement dikonfigurasi (extra.disbursement_paths.check).
  try {
    const c = await prov.disburseCheck(externalId);
    if (c) { check = c.raw; if (c.payoutStatus) status = c.payoutStatus; }
  } catch (e) {
    log.warn("disbursement_check_failed", { external_id: externalId, error: e as Error });
    if (status === "PAYOUT_FAILED") return finpayErr(503, "5030000", "Temporarily unavailable"); // gagal → saldo dikembalikan: wajib yakin
  }
  if (!status) status = "PAYOUT_PROCESSING"; // kode tak dikenal: jangan anggap gagal
  await ingestPayoutEvent(deps, externalId, status, { callback: verified.raw, check, _antarkita: { env, event_id: verified.eventId, status_code: verified.statusCode, verified_via: verified.via } });
  return json(FINPAY_OK, 200);
}

async function simulated(deps: Deps, req: Request): Promise<Response> {
  const authHeader = req.headers.get("Authorization") ?? "";
  const user = await deps.getUser(authHeader);
  if (!user) return json({ error: "Harus login" }, 401);
  const settings = await loadPaySettings(deps.db);
  if (!simulationAllowed(settings, deps.env)) return json({ error: "Simulasi pembayaran tidak aktif" }, 403);
  const body = await readJson<{ external_id?: string; status?: string }>(req, 8192);
  const externalId = String(body.external_id ?? "");
  const status = String(body.status ?? "PAID").toUpperCase();
  if (!externalId) return json({ error: "external_id wajib" }, 400);
  if (!(SIMULATED_ALLOWED_STATUSES as readonly string[]).includes(status)) return json({ error: "status harus PAID/FAILED/EXPIRED" }, 400);
  const p = await findPaymentByRef(deps.db, externalId);
  if (!p || p.user_id !== user.id) return json({ error: "Pembayaran tidak ditemukan" }, 404);
  if (p.provider !== "simulated") return json({ error: "Pembayaran ini bukan transaksi simulasi" }, 403);
  const env = paymentEnv(p, settings.env);
  if (env === "production") return json({ error: "Simulasi dilarang untuk transaksi production" }, 403);
  const r = await ingestPaymentEvent(deps, {
    provider: "simulated", eventId: `sim-${externalId}-${status}`, externalId, providerStatus: status, amount: Number(p.amount),
    signatureOk: true, env, raw: { simulated: true, by: user.id, at: new Date(deps.now()).toISOString(), env },
  });
  if (r.failed) return json({ error: "Kesalahan pemrosesan", note: r.note }, 500);
  return json({ ok: true, ...r });
}
