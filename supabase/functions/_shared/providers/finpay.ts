// Adaptor Finpay (Finnet) — Payment Gateway "card" API + Disbursement.
// Sumber: docs.finpay.id (riset 24 Sep 2026). Semua yang bertanda "PERLU VERIFIKASI SANDBOX" belum dibuktikan
// dengan kredensial asli — lihat supabase/functions/README-PAY.md.
//
// Auth: HTTP Basic, username = Merchant Id, password = Merchant Key.
// Callback: POST JSON {order, customer, meta, card, result, signature};
//   signature = hash_hmac('sha512', json_encode(<semua field tanpa 'signature'>), merchantKey).
import { hmacSha512Hex, sha256Hex } from "../crypto.ts";
import { fetchWithTimeout, timingSafeEqual } from "../http.ts";
import { deepFind, firstPath, phpJsonEncode, removeTopLevelField, safeParse, toAmount } from "../jsonutil.ts";
import { registerSecret } from "../log.ts";
import type {
  CancelResult, ChannelMapping, CreateChargeInput, CreateChargeResult, PaymentProvider, PayStatus, ProviderConfig,
  ProviderEnv, RefundInput, RefundResult, StatusResult, VerifiedNotification,
} from "./types.ts";

export const FINPAY_BASE_URL: Record<ProviderEnv, string> = {
  sandbox: "https://devo.finnet.co.id",
  production: "https://live.finnet.co.id",
};

/** Path API pembayaran. Override per env lewat gateway_secrets.extra.paths. */
export const FINPAY_PATHS = {
  initiate: "/pg/payment/card/initiate",
  check: "/pg/payment/card/check/{orderId}",
  refund: "/pg/payment/card/refund", // PERLU VERIFIKASI SANDBOX: struktur body refund
  cancel: "/pg/payment/card/cancel/{orderId}", // PERLU VERIFIKASI SANDBOX: metode HTTP (asumsi POST)
  cancelMethod: "POST",
};

/**
 * Path Disbursement — PERLU VERIFIKASI SANDBOX (prefix persis, metode inquiry, nama parameter).
 * Override lewat gateway_secrets.extra.disbursement_paths.
 */
export const FINPAY_DISBURSEMENT_PATHS = {
  inquiry: "/disbursement/inquiry/",
  inquiryMethod: "GET",
  transfer: "/disbursement/transfer",
  /** Endpoint cek status transfer; null = tidak dipakai (belum diketahui). */
  check: null as string | null,
};

/**
 * Pemetaan saluran internal → sourceOfFunds.type Finpay.
 * PERLU VERIFIKASI SANDBOX: nama kode persis harus dicocokkan dengan
 * docs.finpay.id/api-reference/appendix/enumeration/source-of-funds-list.
 * Override: gateway_secrets.extra.channel_map = {"<internal>": "<kode>" | null}.
 * null = tidak didukung (pay-create menolak dengan pesan jelas).
 */
export const DEFAULT_FINPAY_CHANNEL_MAP: Record<string, string | null> = {
  bank_transfer: "", // "" = kode dinamis va_<bank>; tanpa bank → sourceOfFunds tidak dikirim (halaman Finpay yang memilih)
  qris: "qris",
  card: "cc",
  gopay: null, // Tidak ada di daftar publik Finpay → tidak didukung (GoPay bisa membayar lewat QRIS)
  shopeepay: "shopeepay",
  ovo: "ovo",
  dana: "dana",
  linkaja: "linkaja",
  finpay_money: "finpaymoney",
  retail_alfamart: "alfamart",
  retail_indomaret: "indomaret",
  paylater_kredivo: "kredivo",
  paylater_indodana: "indodana",
};

/** Bank VA yang dikenal (kode = va_<bank>). PERLU VERIFIKASI SANDBOX. */
export const FINPAY_VA_BANKS = ["bca", "bri", "bni", "mandiri", "permata", "bsi"];

/** Status Finpay → status kanonik (KONTRAK §3). */
export const FINPAY_STATUS_MAP: Record<string, PayStatus> = {
  PAID: "PAID",
  CAPTURED: "PAID",
  AUTHORIZED: "PENDING",
  PENDING: "PENDING",
  FAILURE: "FAILED",
  FAILED: "FAILED",
  EXPIRED: "EXPIRED",
  CANCELLED: "FAILED",
  CANCELED: "FAILED",
  REFUNDED: "REFUNDED",
  PARTIALLY_REFUNDED: "PARTIALLY_REFUNDED",
};

export function normalizeFinpayStatus(s: string | null | undefined): PayStatus | null {
  if (!s) return null;
  return FINPAY_STATUS_MAP[String(s).trim().toUpperCase().replace(/[\s-]+/g, "_")] ?? null;
}

const isKnownStatus = (v: unknown) => typeof v === "string" && normalizeFinpayStatus(v) !== null;

export function mapFinpayChannel(channel: string | null, bank?: string | null, override?: Record<string, unknown> | null): ChannelMapping {
  if (!channel || channel === "any") return { supported: true, code: null, note: "sourceOfFunds tidak dikirim" };
  const ch = channel.trim().toLowerCase();
  const map: Record<string, string | null> = { ...DEFAULT_FINPAY_CHANNEL_MAP };
  if (override && typeof override === "object") {
    for (const [k, v] of Object.entries(override)) map[k.toLowerCase()] = v === null ? null : String(v);
  }
  // Kode Finpay langsung (mis. "va_bca") diterima bila memang ada di peta sebagai nilai.
  if (!(ch in map)) {
    const values = new Set(Object.values(map).filter((v): v is string => !!v));
    if (values.has(ch) || /^va_[a-z]+$/.test(ch) && FINPAY_VA_BANKS.includes(ch.slice(3))) return { supported: true, code: ch };
    return { supported: false, code: null, note: `Saluran ${channel} tidak dikenal untuk Finpay` };
  }
  const code = map[ch];
  if (code === null) return { supported: false, code: null, note: `Saluran ${channel} belum tersedia di Finpay` };
  if (ch === "bank_transfer" && code === "") {
    const b = (bank ?? "").trim().toLowerCase();
    if (!b) return { supported: true, code: null, note: "bank VA dipilih di halaman Finpay" };
    if (!FINPAY_VA_BANKS.includes(b)) return { supported: false, code: null, note: `Bank VA ${bank} belum didukung` };
    return { supported: true, code: `va_${b}` };
  }
  return { supported: true, code };
}

/** Kebalikan peta: sourceOfFunds.type → kunci saluran internal (untuk laporan biaya). */
export function finpayChannelToInternal(code: string | null | undefined): string | null {
  if (!code) return null;
  const c = String(code).toLowerCase();
  if (c.startsWith("va_")) return "bank_transfer";
  for (const [k, v] of Object.entries(DEFAULT_FINPAY_CHANNEL_MAP)) if (v && v === c) return k;
  return null;
}

export interface SignatureCheck {
  ok: boolean;
  via?: "raw-strip" | "php-encode" | "php-encode-assoc" | "json-compact";
  reason?: string;
  parsed?: Record<string, unknown>;
}

/**
 * Verifikasi signature callback Finpay:
 *   (a) raw body dengan field "signature" dihapus secara tekstual (byte lain tidak berubah),
 *   (b) re-serialisasi ala PHP json_encode (escape '/' dan unicode), juga varian assoc-array (objek kosong → []),
 *   (c) JSON.stringify ringkas (bila pengirim bukan PHP).
 * Semua kandidat tetap membutuhkan Merchant Key (HMAC) — tidak melemahkan keamanan.
 */
export async function verifyFinpaySignature(rawBody: string, merchantKey: string): Promise<SignatureCheck> {
  if (!merchantKey) return { ok: false, reason: "merchant_key_missing" };
  const parsed = safeParse(rawBody);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, reason: "body_not_object" };
  const obj = parsed as Record<string, unknown>;
  const sigRaw = obj.signature;
  if (typeof sigRaw !== "string" || !/^[0-9a-fA-F]{128}$/.test(sigRaw.trim())) return { ok: false, reason: "signature_missing_or_malformed", parsed: obj };
  const given = sigRaw.trim().toLowerCase();
  const { signature: _drop, ...rest } = obj;
  const candidates: [NonNullable<SignatureCheck["via"]>, string | null][] = [
    ["raw-strip", removeTopLevelField(rawBody, "signature")],
    ["php-encode", phpJsonEncode(rest)],
    ["php-encode-assoc", phpJsonEncode(rest, { emptyObjectAsArray: true })],
    ["json-compact", JSON.stringify(rest)],
  ];
  let match: SignatureCheck["via"] | undefined;
  const tried = new Set<string>();
  for (const [via, msg] of candidates) {
    if (msg === null || tried.has(msg)) continue;
    tried.add(msg);
    const expected = await hmacSha512Hex(merchantKey, msg);
    if (timingSafeEqual(expected, given) && !match) match = via;
  }
  return match ? { ok: true, via: match, parsed: obj } : { ok: false, reason: "signature_mismatch", parsed: obj };
}

/** Status Disbursement Finpay → payout_status (KONTRAK §8). Tidak dikenal → null (jangan anggap gagal). */
export function normalizeDisbursementStatus(code: unknown): "PAYOUT_SETTLED" | "PAYOUT_PROCESSING" | "PAYOUT_FAILED" | null {
  const c = String(code ?? "").trim();
  switch (c) {
    case "00": return "PAYOUT_SETTLED";
    case "03": return "PAYOUT_PROCESSING"; // pending
    case "08": return "PAYOUT_PROCESSING"; // menunggu approval (di dashboard Finpay)
    case "04": return "PAYOUT_FAILED"; // refunded (dana kembali ke merchant)
    case "06": return "PAYOUT_FAILED";
    default: return null;
  }
}

/** Kode bank tujuan disbursement (kode BI 3 digit). PERLU VERIFIKASI SANDBOX: format kode yang diminta Finpay. */
export const FINPAY_BANK_CODES: Record<string, string> = {
  bca: "014", bri: "002", bni: "009", mandiri: "008", bsi: "451", "bank syariah indonesia": "451", cimb: "022", "cimb niaga": "022",
  permata: "013", danamon: "011", btn: "200", jago: "542", "bank jago": "542", seabank: "535", bjb: "110", mega: "426",
  ocbc: "028", "ocbc nisp": "028", panin: "019", maybank: "016", btpn: "213", jenius: "213", muamalat: "147", sinarmas: "153",
};

export function bankCodeOf(bankName: string, override?: Record<string, unknown> | null): string | null {
  const n = String(bankName ?? "").trim().toLowerCase().replace(/^bank\s+/, "").replace(/\s*\(.*\)$/, "");
  if (/^\d{3}$/.test(n)) return n;
  const map: Record<string, string> = { ...FINPAY_BANK_CODES };
  if (override) for (const [k, v] of Object.entries(override)) if (v) map[k.toLowerCase()] = String(v);
  return map[n] ?? map[`bank ${n}`] ?? null;
}

function pickResponseCode(j: unknown): string {
  return String(firstPath(j, ["responseCode", "response_code", "data.responseCode"]) ?? "");
}

function normalizePhone(p?: string | null): string | undefined {
  if (!p) return undefined;
  const d = String(p).replace(/[^\d+]/g, "");
  if (d.startsWith("+")) return d;
  if (d.startsWith("62")) return "+" + d;
  if (d.startsWith("0")) return "+62" + d.slice(1);
  return d || undefined;
}

export class FinpayProvider implements PaymentProvider {
  readonly name = "finpay" as const;
  readonly env: ProviderEnv;
  private readonly f: typeof fetch;
  private readonly base: string;
  private readonly paths: typeof FINPAY_PATHS;
  private readonly dpaths: typeof FINPAY_DISBURSEMENT_PATHS;
  private readonly extra: Record<string, unknown>;

  constructor(private readonly cfg: ProviderConfig) {
    this.env = cfg.env;
    this.f = cfg.fetch ?? fetch;
    this.extra = cfg.extra ?? {};
    const override = typeof this.extra.base_url === "string" && /^https:\/\//.test(this.extra.base_url) ? this.extra.base_url : null;
    this.base = (override ?? FINPAY_BASE_URL[cfg.env]).replace(/\/+$/, "");
    this.paths = { ...FINPAY_PATHS, ...(this.extra.paths as Record<string, string> ?? {}) };
    this.dpaths = { ...FINPAY_DISBURSEMENT_PATHS, ...(this.extra.disbursement_paths as Record<string, string> ?? {}) };
    registerSecret(cfg.serverKey);
  }

  private authHeader(): string {
    return "Basic " + btoa(`${this.cfg.merchantId ?? ""}:${this.cfg.serverKey}`);
  }

  private async call(method: string, path: string, body?: unknown): Promise<{ status: number; json: unknown; text: string }> {
    const res = await fetchWithTimeout(this.f, this.base + path, {
      method,
      headers: { Authorization: this.authHeader(), Accept: "application/json", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }, this.cfg.timeoutMs ?? 15000);
    const text = await res.text();
    return { status: res.status, json: safeParse(text) ?? { _text: text.slice(0, 500) }, text };
  }

  normalizeStatus(s: string): PayStatus | null { return normalizeFinpayStatus(s); }

  mapChannel(channel: string | null, bank?: string | null): ChannelMapping {
    return mapFinpayChannel(channel, bank, this.extra.channel_map as Record<string, unknown> | undefined);
  }

  async createCharge(input: CreateChargeInput): Promise<CreateChargeResult> {
    const ch = this.mapChannel(input.channel, input.bank);
    if (!ch.supported) return { ok: false, error: ch.note ?? "Saluran tidak didukung", raw: null };
    const nameParts = (input.customer.firstName || "Pelanggan").trim().split(/\s+/);
    const firstName = nameParts[0].slice(0, 50);
    const lastName = (input.customer.lastName || nameParts.slice(1).join(" ") || firstName).slice(0, 50);
    const amount = this.extra.amount_as_string === true ? String(Math.round(input.amount)) : Math.round(input.amount);
    const body: Record<string, unknown> = {
      customer: { email: input.customer.email ?? undefined, firstName, lastName, mobilePhone: normalizePhone(input.customer.phone) },
      order: { id: input.externalId, amount, description: input.description.slice(0, 100), timeout: Math.max(1, Math.round(input.expiryMinutes)) },
      url: {
        callbackUrl: this.cfg.notificationUrl ?? undefined,
        successUrl: input.successUrl ?? undefined, failUrl: input.failUrl ?? undefined, backUrl: input.backUrl ?? undefined,
      },
    };
    if (ch.code) body.sourceOfFunds = { type: ch.code };
    let r;
    try {
      r = await this.call("POST", this.paths.initiate, body);
    } catch (e) {
      return { ok: false, error: `Finpay tidak dapat dihubungi: ${(e as Error).message}`, raw: null };
    }
    const j = r.json;
    const code = pickResponseCode(j);
    const checkoutUrl = deepFind(j, ["redirecturl", "redirectUrl", "redirect_url"]) as string | undefined;
    const qrString = deepFind(j, ["stringQr", "qrString", "qr_string"]) as string | undefined;
    const qrImageUrl = deepFind(j, ["imageurl", "imageUrl", "qrImage"]) as string | undefined;
    const paymentCode = deepFind(j, ["paymentCode", "payment_code", "vaNumber", "va_number"]) as string | undefined;
    const expiry = deepFind(j, ["expiryLink", "expiryTime", "expiredDate"]);
    const ok = r.status >= 200 && r.status < 300 && (code.startsWith("200") || !!(checkoutUrl || qrString || paymentCode));
    if (!ok) {
      const msg = String(deepFind(j, ["responseMessage", "message", "error"]) ?? `HTTP ${r.status}`);
      return { ok: false, httpStatus: r.status, error: `Finpay menolak transaksi: ${msg}`, raw: j };
    }
    return {
      ok: true, httpStatus: r.status, raw: j, providerChannel: ch.code,
      checkoutUrl: checkoutUrl ?? null, qrString: qrString ?? null, qrImageUrl: qrImageUrl ?? null, paymentCode: paymentCode ?? null,
      checkoutToken: null,
      expiresAt: parseExpiry(expiry) ?? new Date(Date.now() + input.expiryMinutes * 60000).toISOString(),
      providerTxnId: (deepFind(j, ["reference", "transactionId", "trxId"]) as string | undefined) ?? null,
    };
  }

  async checkStatus(externalId: string): Promise<StatusResult> {
    let r;
    try {
      r = await this.call("GET", this.paths.check.replace("{orderId}", encodeURIComponent(externalId)));
    } catch (e) {
      return { ok: false, found: false, providerStatus: "", status: null, amount: null, error: (e as Error).message, raw: null };
    }
    const j = r.json;
    const code = pickResponseCode(j);
    if (r.status === 404 || code.startsWith("404")) return { ok: true, found: false, providerStatus: "NOT_FOUND", status: null, amount: null, httpStatus: r.status, raw: j };
    if (r.status >= 500 || r.status === 401 || r.status === 403) {
      return { ok: false, found: false, providerStatus: "", status: null, amount: null, httpStatus: r.status, error: `HTTP ${r.status}`, raw: j };
    }
    let st = firstPath(j, [
      "result.payment.status", "data.result.payment.status", "data.status", "order.status", "data.order.status",
      "paymentStatus", "transactionStatus", "data.paymentStatus", "status",
    ]);
    if (!isKnownStatus(st)) st = deepFind(j, ["status", "paymentStatus", "transactionStatus"], isKnownStatus);
    const providerStatus = typeof st === "string" ? st.toUpperCase() : "";
    const amount = toAmount(firstPath(j, ["result.payment.amount", "data.result.payment.amount", "order.amount", "data.order.amount", "amount", "data.amount"]));
    return {
      ok: !!providerStatus, found: !!providerStatus, providerStatus, status: normalizeFinpayStatus(providerStatus), amount,
      httpStatus: r.status, raw: j, error: providerStatus ? undefined : "status tidak ditemukan di respons",
      providerTxnId: (deepFind(j, ["reference", "transactionId"]) as string | undefined) ?? null,
    };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    // PERLU VERIFIKASI SANDBOX: struktur body refund. Default {order:{id}, refund:{amount, reason}};
    // extra.refund_shape = "order_amount" → {order:{id, amount}}.
    const body = this.extra.refund_shape === "order_amount"
      ? { order: { id: input.externalId, amount: Math.round(input.amount) } }
      : { order: { id: input.externalId }, refund: { amount: Math.round(input.amount), reason: input.reason.slice(0, 100) } };
    let r;
    try {
      r = await this.call("POST", this.paths.refund, body);
    } catch (e) {
      return { ok: false, supported: true, error: `unknown_result: ${(e as Error).message}`, raw: null };
    }
    const j = r.json;
    const code = pickResponseCode(j);
    const msg = String(deepFind(j, ["responseMessage", "message"]) ?? "");
    const st = deepFind(j, ["status", "refundStatus"], isKnownStatus) as string | undefined;
    const norm = normalizeFinpayStatus(st);
    if (r.status >= 200 && r.status < 300 && (code.startsWith("200") || norm === "REFUNDED" || norm === "PARTIALLY_REFUNDED")) {
      return {
        ok: true, supported: true, pending: !(norm === "REFUNDED" || norm === "PARTIALLY_REFUNDED"), httpStatus: r.status,
        providerStatus: st ?? null, providerRef: (deepFind(j, ["refundId", "reference", "refCode"]) as string | undefined) ?? null, raw: j,
      };
    }
    const unsupported = r.status === 405 || /not\s*support|tidak\s*didukung|not allowed|cannot be refunded/i.test(msg);
    return { ok: false, supported: !unsupported, httpStatus: r.status, error: msg || `HTTP ${r.status}`, raw: j };
  }

  async cancel(externalId: string): Promise<CancelResult> {
    try {
      const r = await this.call(this.paths.cancelMethod || "POST", this.paths.cancel.replace("{orderId}", encodeURIComponent(externalId)));
      const code = pickResponseCode(r.json);
      return { ok: r.status >= 200 && r.status < 300 && (code === "" || code.startsWith("200")), httpStatus: r.status, raw: r.json };
    } catch (e) {
      return { ok: false, error: (e as Error).message, raw: null };
    }
  }

  async verifyNotification(rawBody: string, _headers: Headers): Promise<VerifiedNotification> {
    const v = await verifyFinpaySignature(rawBody, this.cfg.serverKey);
    const p = v.parsed ?? {};
    const externalId = (firstPath(p, ["order.id", "orderId"]) as string | undefined) ?? null;
    let st = firstPath(p, ["result.payment.status", "result.status", "order.status", "status"]);
    if (!isKnownStatus(st)) st = deepFind(p, ["status", "paymentStatus"], isKnownStatus);
    const providerStatus = typeof st === "string" ? st.toUpperCase() : "";
    const amount = toAmount(firstPath(p, ["result.payment.amount", "order.amount", "amount"]));
    const sof = (firstPath(p, ["sourceOfFunds.type", "result.payment.sourceOfFunds.type", "result.sourceOfFunds.type", "result.payment.channel"]) as string | undefined) ?? null;
    const bodyHash = (await sha256Hex(removeTopLevelField(rawBody, "signature") ?? rawBody)).slice(0, 16);
    return {
      ok: v.ok, reason: v.reason, verifiedVia: v.via,
      eventId: `cb-${externalId ?? "none"}-${providerStatus || "UNKNOWN"}-${bodyHash}`,
      externalId, providerStatus, amount, channel: finpayChannelToInternal(sof), raw: p,
    };
  }

  // ------------------------------ Disbursement ------------------------------
  async disburseInquiry(p: { bankCode: string; accountNumber: string; amount: number }) {
    const params = { bankCode: p.bankCode, accountNumber: p.accountNumber, amount: String(Math.round(p.amount)) };
    const method = (this.dpaths.inquiryMethod || "GET").toUpperCase();
    const path = method === "GET" ? `${this.dpaths.inquiry}?${new URLSearchParams(params)}` : this.dpaths.inquiry;
    const r = await this.call(method, path, method === "GET" ? undefined : params);
    const j = r.json;
    const code = pickResponseCode(j);
    const refCode = deepFind(j, ["refCode", "referenceCode", "inquiryRef", "reffCode"]) as string | undefined;
    const accountName = deepFind(j, ["accountName", "beneficiaryName", "accountHolderName", "customerName"]) as string | undefined;
    const fee = toAmount(deepFind(j, ["feeAmount", "fee", "adminFee"]));
    const ok = r.status >= 200 && r.status < 300 && !!refCode && (code === "" || code.startsWith("200") || code === "00");
    return { ok, refCode: refCode ?? null, accountName: accountName ?? null, fee, httpStatus: r.status, raw: j,
      error: ok ? undefined : String(deepFind(j, ["responseMessage", "message"]) ?? `HTTP ${r.status}`) };
  }

  async disburseTransfer(p: { externalId: string; refCode: string; bankCode: string; accountNumber: string; accountName: string; amount: number; description: string }) {
    // PERLU VERIFIKASI SANDBOX: struktur body transfer.
    const body = {
      order: { id: p.externalId, amount: Math.round(p.amount), description: p.description.slice(0, 100) },
      refCode: p.refCode,
      beneficiary: { bankCode: p.bankCode, accountNumber: p.accountNumber, accountName: p.accountName },
    };
    const r = await this.call("POST", this.dpaths.transfer, body);
    const j = r.json;
    const code = deepFind(j, ["transactionStatus", "statusCode", "status", "responseCode"], (v) => /^\d{2}$/.test(String(v)));
    return { httpStatus: r.status, statusCode: code != null ? String(code) : null, payoutStatus: normalizeDisbursementStatus(code), raw: j };
  }

  async disburseCheck(externalId: string) {
    if (!this.dpaths.check) return null;
    const r = await this.call("GET", this.dpaths.check.replace("{orderId}", encodeURIComponent(externalId)));
    const code = deepFind(r.json, ["transactionStatus", "statusCode", "status"], (v) => /^\d{2}$/.test(String(v)));
    return { httpStatus: r.status, statusCode: code != null ? String(code) : null, payoutStatus: normalizeDisbursementStatus(code), raw: r.json };
  }

  /** Callback disbursement: HMAC-SHA512 sama dengan callback pembayaran. */
  async verifyDisbursementCallback(rawBody: string) {
    const v = await verifyFinpaySignature(rawBody, this.cfg.serverKey);
    const p = v.parsed ?? {};
    const externalId = (firstPath(p, ["order.id", "orderId", "referenceId"]) as string | undefined) ?? null;
    const code = deepFind(p, ["transactionStatus", "statusCode", "status"], (x) => /^\d{2}$/.test(String(x)));
    const bodyHash = (await sha256Hex(removeTopLevelField(rawBody, "signature") ?? rawBody)).slice(0, 16);
    return {
      ok: v.ok, reason: v.reason, via: v.via, externalId, statusCode: code != null ? String(code) : null,
      payoutStatus: normalizeDisbursementStatus(code), eventId: `dcb-${externalId ?? "none"}-${code ?? "NA"}-${bodyHash}`, raw: p,
    };
  }
}

function parseExpiry(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return new Date(v > 1e12 ? v : v * 1000).toISOString();
  const s = String(v).trim();
  // "YYYY-MM-DD HH:mm:ss" tanpa zona → WIB (asumsi, PERLU VERIFIKASI SANDBOX)
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/);
  const d = m ? new Date(`${m[1]}T${m[2]}+07:00`) : new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString();
}
