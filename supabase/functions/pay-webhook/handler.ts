// pay-webhook — penerima notifikasi semua provider (KONTRAK §9).
//   POST /pay-webhook/finpay               callback pembayaran Finpay (HMAC-SHA512) → checkStatus → payment_event_ingest
//   POST /pay-webhook/finpay-disbursement  callback disbursement Finpay (HMAC-SHA512) → payout_event_ingest
//   POST /pay-webhook/midtrans             notifikasi Midtrans (SHA512) → checkStatus (PAID) → payment_event_ingest
//   POST /pay-webhook/simulated            simulasi (JWT pemilik + payments_simulation_enabled + env≠production)
// Deploy dengan --no-verify-jwt (provider memanggil tanpa JWT); keaslian dicek lewat signature.
// Duplikat → selalu 200. Error DB → 5xx agar provider mengulang. Log tanpa rahasia.
import { loadPaySettings, simulationAllowed } from "../_shared/config.ts";
import type { Deps } from "../_shared/deps.ts";
import { HttpError, json, preflight, readBodyLimited, readJson, routeAfter } from "../_shared/http.ts";
import { ingestPaymentEvent, ingestPayoutEvent } from "../_shared/ingest.ts";
import { sha256Hex } from "../_shared/crypto.ts";
import { safeParse } from "../_shared/jsonutil.ts";
import { log } from "../_shared/log.ts";
import { buildProvider, FinpayProvider, providerCandidates } from "../_shared/providers/index.ts";
import { SIMULATED_ALLOWED_STATUSES } from "../_shared/providers/simulated.ts";
import type { PaymentProvider, VerifiedNotification } from "../_shared/providers/types.ts";

const FINPAY_OK = { responseCode: "2000000", responseMessage: "Success" };

/**
 * Allowlist IP callback opsional: env FINPAY_CALLBACK_IP_ALLOWLIST="1.2.3.4,5.6.7.8" (kosong = tidak dicek).
 * IP klien diambil dari x-forwarded-for (entri pertama) yang diisi gateway Supabase. Lapisan tambahan saja —
 * keamanan utama tetap HMAC + checkStatus.
 */
export function callerIpAllowed(req: Request, allowlist: string | undefined): boolean {
  const list = (allowlist ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!list.length) return true;
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || (req.headers.get("x-real-ip") ?? "").trim();
  return !!ip && list.includes(ip);
}
const finpayErr = (status: number, code: string, msg: string) => json({ responseCode: code, responseMessage: msg }, status);

export function makeWebhookHandler(deps: Deps) {
  return async (req: Request): Promise<Response> => {
    const pre = preflight(req);
    if (pre) return pre;
    if (req.method !== "POST") return json({ error: "Metode tidak diizinkan" }, 405);
    const route = routeAfter(req, "pay-webhook");
    try {
      switch (route) {
        case "finpay": return await finpayPayment(deps, req);
        case "finpay-disbursement": return await finpayDisbursement(deps, req);
        case "midtrans": return await midtrans(deps, req);
        case "simulated": return await simulated(deps, req);
        default: return json({ error: "Rute webhook tidak dikenal" }, 404);
      }
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message, ...(e.body ?? {}) }, e.status);
      log.error("webhook_unhandled", { route, error: e as Error });
      return route.startsWith("finpay") ? finpayErr(500, "5000000", "Internal error") : json({ error: "Kesalahan server" }, 500);
    }
  };
}

/** Coba verifikasi dengan kandidat kunci (env aktif, lalu env lain). */
async function verifyWith(deps: Deps, name: "finpay" | "midtrans", raw: string, headers: Headers) {
  const settings = await loadPaySettings(deps.db);
  const cands = await providerCandidates(deps, name, settings.env);
  let last: VerifiedNotification | null = null;
  for (const c of cands) {
    const p = buildProvider(name, c.secrets, deps, c.env)!;
    const v = await p.verifyNotification(raw, headers);
    if (v.ok) return { provider: p, v, env: c.env, configured: true };
    last = v;
  }
  return { provider: null as PaymentProvider | null, v: last, env: settings.env, configured: cands.length > 0 };
}

/** Catat percobaan bersignature salah untuk audit — status dibuat tidak-terpetakan supaya mustahil diterapkan. */
async function recordBadSignature(deps: Deps, provider: string, raw: string, v: VerifiedNotification | null) {
  try {
    const h = (await sha256Hex(raw)).slice(0, 24);
    await ingestPaymentEvent(deps, {
      provider, eventId: `badsig-${h}`, externalId: v?.externalId ?? null, providerStatus: "SIGNATURE_INVALID",
      amount: null, signatureOk: false, raw: { reason: v?.reason ?? "unknown", body_sha256_24: h, claimed_status: v?.providerStatus ?? null, body: safeParse(raw) },
    });
  } catch { /* audit best-effort; balasan tetap 401 */ }
}

async function finpayPayment(deps: Deps, req: Request): Promise<Response> {
  if (!callerIpAllowed(req, deps.env("FINPAY_CALLBACK_IP_ALLOWLIST"))) {
    log.warn("finpay_webhook_ip_rejected", { ip: req.headers.get("x-forwarded-for") });
    return finpayErr(403, "4030000", "Forbidden");
  }
  const raw = await readBodyLimited(req);
  const { provider, v, env, configured } = await verifyWith(deps, "finpay", raw, req.headers);
  if (!configured) {
    log.error("finpay_webhook_not_configured", {});
    return finpayErr(503, "5030000", "Not configured");
  }
  if (!provider || !v?.ok) {
    log.warn("finpay_webhook_bad_signature", { reason: v?.reason, external_id: v?.externalId });
    await recordBadSignature(deps, "finpay", raw, v);
    return finpayErr(401, "4010000", "Invalid signature");
  }
  if (!v.externalId) return finpayErr(400, "4000000", "Missing order.id");
  const res = await confirmAndIngest(deps, provider, v, env);
  if (res === "retry") return finpayErr(503, "5030000", "Temporarily unavailable");
  return json(FINPAY_OK, 200);
}

async function midtrans(deps: Deps, req: Request): Promise<Response> {
  const raw = await readBodyLimited(req);
  const { provider, v, env, configured } = await verifyWith(deps, "midtrans", raw, req.headers);
  if (!configured) return json({ error: "Server key belum diatur" }, 503);
  if (!provider || !v?.ok) {
    log.warn("midtrans_webhook_bad_signature", { reason: v?.reason, external_id: v?.externalId });
    await recordBadSignature(deps, "midtrans", raw, v);
    return json({ error: "Signature tidak valid" }, 401);
  }
  if (!v.externalId) return json({ error: "order_id kosong" }, 400);
  const res = await confirmAndIngest(deps, provider, v, env);
  if (res === "retry") return json({ error: "Coba lagi" }, 503);
  return json({ ok: true, duplicate: res.duplicate, pay_status: res.pay_status }, 200);
}

/**
 * Defense-in-depth: signature sah TIDAK cukup untuk status bernilai uang. Untuk status selain PENDING, status
 * ditanyakan ulang ke provider (checkStatus) dan status/amount dari provider-lah yang di-ingest.
 * Gagal menghubungi provider → "retry" (5xx, provider mengulang; rekonsiliasi juga menangkapnya).
 */
async function confirmAndIngest(deps: Deps, provider: PaymentProvider, v: VerifiedNotification, env: string) {
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
  const eventId = note === "unconfirmed_not_found" ? `${v.eventId}-unconfirmed` : v.eventId;
  return await ingestPaymentEvent(deps, {
    provider: provider.name, eventId, externalId: v.externalId, providerStatus, amount, signatureOk: true,
    raw: {
      callback: v.raw, check,
      _antarkita: { env, verified_via: v.verifiedVia, channel: v.channel ?? null, claimed_status: v.providerStatus, pay_status: provider.normalizeStatus(providerStatus), note },
    },
  });
}

async function finpayDisbursement(deps: Deps, req: Request): Promise<Response> {
  if (!callerIpAllowed(req, deps.env("FINPAY_CALLBACK_IP_ALLOWLIST"))) return finpayErr(403, "4030000", "Forbidden");
  const raw = await readBodyLimited(req);
  const settings = await loadPaySettings(deps.db);
  const cands = await providerCandidates(deps, "finpay_disbursement", settings.env);
  const fin = await providerCandidates(deps, "finpay", settings.env);
  for (const c of fin) if (!cands.some((x) => x.secrets.serverKey === c.secrets.serverKey)) cands.push(c);
  if (!cands.length) return finpayErr(503, "5030000", "Not configured");
  let verified: Awaited<ReturnType<FinpayProvider["verifyDisbursementCallback"]>> | null = null;
  let prov: FinpayProvider | null = null;
  for (const c of cands) {
    const p = buildProvider("finpay", c.secrets, deps, c.env) as FinpayProvider;
    const r = await p.verifyDisbursementCallback(raw);
    if (r.ok) { verified = r; prov = p; break; }
    verified = r;
  }
  if (!verified?.ok || !prov) {
    log.warn("finpay_disbursement_bad_signature", { reason: verified?.reason, external_id: verified?.externalId });
    return finpayErr(401, "4010000", "Invalid signature");
  }
  if (!verified.externalId) return finpayErr(400, "4000000", "Missing order.id");
  let status = verified.payoutStatus;
  let check: unknown = null;
  // Konfirmasi status bila endpoint cek disbursement dikonfigurasi (extra.disbursement_paths.check).
  try {
    const c = await prov.disburseCheck(verified.externalId);
    if (c) { check = c.raw; if (c.payoutStatus) status = c.payoutStatus; }
  } catch (e) {
    log.warn("disbursement_check_failed", { external_id: verified.externalId, error: e as Error });
    if (status === "PAYOUT_FAILED") return finpayErr(503, "5030000", "Temporarily unavailable"); // gagal → saldo dikembalikan: wajib yakin
  }
  if (!status) status = "PAYOUT_PROCESSING"; // kode tak dikenal: jangan anggap gagal
  await ingestPayoutEvent(deps, verified.externalId, status, { callback: verified.raw, check, _antarkita: { event_id: verified.eventId, status_code: verified.statusCode, verified_via: verified.via } });
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
  const { data: p, error } = await deps.db.from("payments").select("id, user_id, provider, pay_status, amount, external_id")
    .eq("external_id", externalId).maybeSingle();
  if (error) return json({ error: "Pembayaran tidak dapat dibaca" }, 500);
  if (!p || p.user_id !== user.id) return json({ error: "Pembayaran tidak ditemukan" }, 404);
  if (p.provider !== "simulated") return json({ error: "Pembayaran ini bukan transaksi simulasi" }, 403);
  const r = await ingestPaymentEvent(deps, {
    provider: "simulated", eventId: `sim-${externalId}-${status}`, externalId, providerStatus: status, amount: Number(p.amount),
    signatureOk: true, raw: { simulated: true, by: user.id, at: new Date(deps.now()).toISOString(), env: settings.env },
  });
  return json({ ok: true, ...r });
}
