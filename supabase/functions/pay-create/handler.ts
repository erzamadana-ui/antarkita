// pay-create — membuat intent pembayaran di provider aktif (KONTRAK §9).
// Body: { purpose: 'order'|'topup', order_id?, amount? (hanya topup), channel, bank? (VA), simulate? }
// Balasan: { payment_id, external_id, provider, checkout_url?, checkout_token?, qr_string?, payment_code?, expires_at, support_ref,
//            reused, simulated, client_key?, is_production? }
//
// Keamanan:
//  • JWT pengguna wajib (diverifikasi ke Supabase Auth).
//  • purpose='order': nominal TIDAK dari body — diambil dari server lewat order_payment_prepare (JWT pengguna → cek
//    kepemilikan, status awaiting_payment, saluran aktif) lalu payment_intent_create (service_role) mengecek ulang.
//  • Idempoten: payment_intent_create mengembalikan intent PENDING yang sama; charge ke provider hanya dibuat SEKALI
//    per intent (klaim atomik kolom checkout_token), karena Finpay tidak punya header idempotency.
import { loadPaySettings, simulationAllowed, type PaySettings } from "../_shared/config.ts";
import type { AuthUser, Deps } from "../_shared/deps.ts";
import { HttpError, json, preflight, readJson, UUID_RE } from "../_shared/http.ts";
import { ingestPaymentEvent } from "../_shared/ingest.ts";
import { isValidProviderOrderId, newExternalId } from "../_shared/ids.ts";
import { log } from "../_shared/log.ts";
import { MidtransProvider, providerFor } from "../_shared/providers/index.ts";
import type { CreateChargeResult, PaymentProvider, ProviderName } from "../_shared/providers/types.ts";
import { requireUser } from "../_shared/auth.ts";
import { paymentEnv } from "../_shared/payments.ts";

type Body = { purpose?: string; order_id?: string; amount?: number | string; channel?: string; bank?: string; simulate?: boolean };
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

const CLAIM_PREFIX = "claim:";
const STALE_CLAIM_MS = 90_000;

/** Kegagalan status per provider untuk menutup intent yang gagal dibuat (payment_event_ingest → FAILED). */
const FAILED_STATUS: Record<ProviderName, string> = { finpay: "FAILURE", midtrans: "failure", simulated: "FAILED" };

export function makePayCreateHandler(deps: Deps) {
  return async (req: Request): Promise<Response> => {
    const pre = preflight(req);
    if (pre) return pre;
    if (req.method !== "POST") return json({ error: "Metode tidak diizinkan" }, 405);
    try {
      return await handle(deps, req);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message, ...(e.body ?? {}) }, e.status);
      log.error("pay_create_unhandled", { error: e as Error });
      return json({ error: "Kesalahan server" }, 500);
    }
  };
}

async function handle(deps: Deps, req: Request): Promise<Response> {
  const { user, authHeader } = await requireUser(deps, req);
  const body = await readJson<Body>(req, 8192);
  const purpose = body.purpose === "topup" ? "topup" : body.purpose === "order" ? "order" : null;
  if (!purpose) throw new HttpError(400, "purpose harus 'order' atau 'topup'");
  const settings = await loadPaySettings(deps.db);

  // ---- Pilih provider ----
  let providerName: ProviderName = settings.providerActive;
  let provider = await providerFor(deps, providerName, settings.env);
  const simOk = simulationAllowed(settings, deps.env);
  if (simOk && (body.simulate === true || !provider)) {
    providerName = "simulated";
    provider = await providerFor(deps, "simulated", settings.env);
  }
  if (!provider) throw new HttpError(503, `Gateway ${settings.providerActive} belum dikonfigurasi. Hubungi admin.`);

  let channel = typeof body.channel === "string" && body.channel.trim() ? body.channel.trim().toLowerCase() : null;
  const bank = typeof body.bank === "string" ? body.bank.trim().toLowerCase() : null;

  // ---- Nominal dari server ----
  let amount: number;
  let orderId: string | null = null;
  let expiryMin: number;
  let description: string;
  let orderCode: string | null = null;
  if (purpose === "order") {
    orderId = String(body.order_id ?? "");
    if (!UUID_RE.test(orderId)) throw new HttpError(400, "order_id wajib diisi");
    const { data: quote, error } = await deps.userDb(authHeader).rpc("order_payment_prepare", { p_order: orderId, p_channel: channel });
    if (error || !quote) throw new HttpError(400, error?.message ?? "Pesanan tidak dapat dibayar");
    const q = (Array.isArray(quote) ? quote[0] : quote) as Row;
    amount = Math.round(Number(q.gross));
    if (!Number.isFinite(amount) || amount <= 0) throw new HttpError(400, "Total pesanan tidak valid");
    channel = (q.channel as string) ?? channel;
    orderCode = (q.code as string) ?? null;
    description = `Pesanan AntarKita ${orderCode ?? ""}`.trim();
    expiryMin = settings.orderTimeoutMin;
    if (q.expires_at) {
      const left = Math.floor((new Date(q.expires_at).getTime() - deps.now()) / 60000);
      if (Number.isFinite(left)) expiryMin = Math.max(1, Math.min(expiryMin, left));
    }
  } else {
    amount = await validateTopup(deps, body, channel);
    description = "Top up AntarPay";
    expiryMin = settings.topupTimeoutMin;
  }

  const mapping = provider.mapChannel(channel, bank);
  if (!mapping.supported) throw new HttpError(400, mapping.note ?? "Metode pembayaran tidak tersedia", { channel });

  // ---- Intent (idempoten per order) ----
  const { data: intentData, error: intentErr } = await deps.db.rpc("payment_intent_create", {
    p_user: user.id, p_purpose: purpose, p_order: orderId, p_amount: amount, p_channel: channel, p_provider: providerName,
  });
  if (intentErr || !intentData) throw new HttpError(400, intentErr?.message ?? "Intent pembayaran gagal dibuat");
  let row = (Array.isArray(intentData) ? intentData[0] : intentData) as Row;
  if (row.pay_status && row.pay_status !== "PENDING") throw new HttpError(409, "Pembayaran ini sudah tidak menunggu", { pay_status: row.pay_status });
  // T1: env & provider TERIKAT ke intent (payments.env diisi DB saat intent dibuat) — charge dibuat dengan kunci
  // dan host env intent, sehingga callback kelak diverifikasi dengan kunci yang sama.
  const rowEnv = paymentEnv(row, settings.env);
  const rowProvider = (row.provider ?? providerName) as ProviderName;
  if (rowProvider !== providerName || rowEnv !== provider.env) {
    const alt = await providerFor(deps, rowProvider, rowEnv);
    if (!alt || (rowProvider === "simulated" && !simOk)) throw new HttpError(409, "Ada pembayaran tertunda dari metode/lingkungan lain (atau kunci gateway lingkungan itu belum diisi). Tunggu hingga kedaluwarsa.");
    provider = alt;
    providerName = rowProvider;
  }

  // (d) Intent PENDING aktif yang dikembalikan DB (order maupun topup, 0105 R4) → JANGAN buat charge baru.
  if (hasCheckout(row)) return json(respond(row, provider, true));
  if (row.provider_txn_id || row.raw?.create) {
    // Charge sudah pernah dibuat untuk intent ini tetapi instruksi bayar tidak tersimpan → jangan charge ulang order.id sama.
    throw new HttpError(409, "Pembayaran sebelumnya masih aktif. Tunggu hingga kedaluwarsa atau hubungi CS.", { payment_id: row.id, support_ref: row.support_ref ?? null });
  }

  // ---- Klaim atomik supaya charge hanya dibuat sekali per intent ----
  const nowMs = deps.now();
  const claimToken = `${CLAIM_PREFIX}${nowMs}:${crypto.randomUUID().slice(0, 8)}`;
  const externalId = isValidProviderOrderId(row.external_id) ? String(row.external_id) : newExternalId("AKF", nowMs);
  const claimed = await claim(deps, row, claimToken, externalId, nowMs);
  if (claimed === "stale") {
    // Proses sebelumnya mati di tengah jalan — charge mungkin sudah ada di provider dengan order.id itu tetapi
    // pelanggan tidak pernah menerima instruksi bayar. Batalkan di provider (best-effort) lalu tutup intent (FAILED)
    // supaya percobaan berikutnya membuat intent + order.id baru.
    const ext = String(row.provider_ref ?? row.external_id ?? "");
    log.warn("pay_create_stale_claim", { payment_id: row.id, external_id: ext });
    if (ext) {
      await provider.cancel(ext).catch(() => null);
      await closeFailed(deps, provider, ext, amount, { ok: false, error: "stale_claim", raw: null });
    }
    throw new HttpError(409, "Sesi pembayaran sebelumnya terputus. Silakan coba bayar lagi.", { retry: true });
  }
  if (!claimed) {
    // Permintaan lain sedang membuat charge — tunggu sebentar lalu kembalikan hasilnya.
    for (let i = 0; i < 4; i++) {
      await new Promise((r) => setTimeout(r, 600));
      const { data } = await deps.db.from("payments").select("*").eq("id", row.id).maybeSingle();
      if (data && hasCheckout(data)) return json(respond(data, provider, true));
    }
    throw new HttpError(409, "Pembayaran sedang disiapkan, coba lagi sebentar.");
  }
  row = claimed;

  // ---- Charge ke provider ----
  const customer = await customerOf(deps, user);
  let charge: CreateChargeResult;
  try {
    charge = await provider.createCharge({
      externalId, amount, channel, bank, description, expiryMinutes: expiryMin, customer, purpose,
      successUrl: deps.env("PAY_RETURN_URL") ?? null, failUrl: deps.env("PAY_RETURN_URL") ?? null, backUrl: deps.env("PAY_RETURN_URL") ?? null,
      meta: { user_id: user.id, order_code: orderCode },
    });
  } catch (e) {
    charge = { ok: false, error: (e as Error).message, raw: null };
  }
  if (!charge.ok) {
    log.warn("pay_create_charge_failed", { provider: providerName, external_id: externalId, error: charge.error, http: charge.httpStatus });
    await closeFailed(deps, provider, externalId, amount, charge);
    throw new HttpError(502, charge.error ?? "Gateway menolak transaksi");
  }

  const patch = {
    checkout_url: charge.checkoutUrl ?? null,
    checkout_token: charge.checkoutToken ?? null,
    qr_string: charge.qrString ?? null,
    payment_code: charge.paymentCode ?? null,
    expires_at: charge.expiresAt ?? new Date(nowMs + expiryMin * 60000).toISOString(),
    provider_txn_id: charge.providerTxnId ?? null,
    raw: { create: charge.raw, _antarkita: { env: provider.env, channel, provider_channel: charge.providerChannel ?? null, qr_image_url: charge.qrImageUrl ?? null } },
  };
  const { data: updated, error: upErr } = await deps.db.from("payments").update(patch).eq("id", row.id).eq("checkout_token", claimToken).select("*").maybeSingle();
  if (upErr) log.error("pay_create_update_failed", { payment_id: row.id, message: upErr.message });
  const finalRow = updated ?? { ...row, ...patch };
  log.info("pay_create_ok", { payment_id: row.id, provider: providerName, external_id: externalId, purpose, channel, amount });
  return json(respond(finalRow, provider, false));
}

function hasCheckout(r: Row): boolean {
  const tok = typeof r.checkout_token === "string" ? r.checkout_token : "";
  return !!(r.checkout_url || r.qr_string || r.payment_code || (tok && !tok.startsWith(CLAIM_PREFIX)) ||
    (r.provider === "simulated" && !!r.raw?._antarkita && !tok.startsWith(CLAIM_PREFIX)));
}

/** UPDATE … WHERE checkout_token IS NULL — hanya satu permintaan yang menang. null = sedang diproses; "stale" = klaim basi. */
async function claim(deps: Deps, row: Row, token: string, externalId: string, nowMs: number): Promise<Row | null | "stale"> {
  const patch = { checkout_token: token, external_id: externalId, provider_ref: externalId };
  const { data, error } = await deps.db.from("payments").update(patch).eq("id", row.id).is("checkout_token", null).select("*").maybeSingle();
  if (error) log.error("pay_create_claim_failed", { payment_id: row.id, message: error.message });
  if (data) return data as Row;
  const cur = typeof row.checkout_token === "string" ? row.checkout_token : "";
  const ts = Number(cur.slice(CLAIM_PREFIX.length).split(":")[0]);
  if (cur.startsWith(CLAIM_PREFIX) && Number.isFinite(ts) && nowMs - ts > STALE_CLAIM_MS) return "stale";
  return null;
}

async function closeFailed(deps: Deps, provider: PaymentProvider, externalId: string, amount: number, charge: CreateChargeResult) {
  try {
    await ingestPaymentEvent(deps, {
      provider: provider.name, eventId: `create-failed-${externalId}`, externalId, providerStatus: FAILED_STATUS[provider.name],
      amount, signatureOk: true, env: provider.env, raw: { create_failed: true, error: charge.error, http: charge.httpStatus, response: charge.raw },
    });
  } catch { /* sudah di-log */ }
}

async function validateTopup(deps: Deps, body: Body, channel: string | null): Promise<number> {
  const { data: on, error: onErr } = await deps.db.rpc("antarpay_enabled");
  if (onErr) throw new HttpError(503, "Status AntarPay tidak dapat diperiksa — coba lagi");
  if (on !== true) throw new HttpError(403, "AntarPay sedang dinonaktifkan sementara.", { antarpay_enabled: false });
  const amt = Math.round(Number(body.amount));
  const { data: cfg } = await deps.db.rpc("gateway_public_config");
  const min = Number(cfg?.topup_min ?? 10000), max = Number(cfg?.topup_max ?? 10000000);
  if (!amt || amt < min || amt > max) throw new HttpError(400, `Nominal Rp${min.toLocaleString("id-ID")} – Rp${max.toLocaleString("id-ID")}`);
  for (const key of ["antarpay", ...(channel ? [channel] : [])]) {
    const { data, error } = await deps.db.rpc("payment_channel_enabled", { p_key: key });
    if (error) throw new HttpError(503, "Status saluran pembayaran tidak dapat diperiksa — coba lagi");
    if (data !== true) throw new HttpError(403, `Saluran ${key} sedang dinonaktifkan.`, { channel: key });
  }
  return amt;
}

async function customerOf(deps: Deps, user: AuthUser) {
  const { data: prof } = await deps.db.from("profiles").select("full_name, email, phone").eq("id", user.id).maybeSingle();
  const name = String(prof?.full_name ?? "Pelanggan AntarKita").trim() || "Pelanggan AntarKita";
  const [firstName, ...rest] = name.split(/\s+/);
  return { firstName, lastName: rest.join(" ") || null, email: (prof?.email as string) ?? user.email ?? null, phone: (prof?.phone as string) ?? null };
}

function respond(r: Row, provider: PaymentProvider, reused: boolean) {
  const tok = typeof r.checkout_token === "string" && !r.checkout_token.startsWith(CLAIM_PREFIX) ? r.checkout_token : null;
  const out: Record<string, unknown> = {
    payment_id: r.id, external_id: r.provider_ref ?? r.external_id, provider: provider.name,
    checkout_url: r.checkout_url ?? null, checkout_token: tok, qr_string: r.qr_string ?? null, payment_code: r.payment_code ?? null,
    expires_at: r.expires_at ?? null, support_ref: r.support_ref ?? null, amount: r.amount ?? null,
    reused, simulated: provider.name === "simulated",
  };
  if (provider instanceof MidtransProvider) { out.client_key = provider.clientKey; out.is_production = provider.env === "production"; }
  return out;
}

export type { PaySettings };
