// Adaptor Midtrans (Snap + Core API) — port dari midtrans-create / midtrans-webhook lama.
// Signature notifikasi: SHA512(order_id + status_code + gross_amount + serverKey).
import { sha512Hex } from "../crypto.ts";
import { fetchWithTimeout, timingSafeEqual } from "../http.ts";
import { safeParse, toAmount } from "../jsonutil.ts";
import { registerSecret } from "../log.ts";
import type {
  CancelResult, ChannelMapping, CreateChargeInput, CreateChargeResult, PaymentProvider, PayStatus, ProviderConfig,
  ProviderEnv, RefundInput, RefundResult, StatusResult, VerifiedNotification,
} from "./types.ts";

export const MIDTRANS_URLS: Record<ProviderEnv, { snap: string; api: string }> = {
  sandbox: { snap: "https://app.sandbox.midtrans.com", api: "https://api.sandbox.midtrans.com" },
  production: { snap: "https://app.midtrans.com", api: "https://api.midtrans.com" },
};

/** Saluran internal → enabled_payments Snap (OVO/DANA lewat QRIS seperti kode lama). */
export const MIDTRANS_ENABLED_PAYMENTS: Record<string, string[] | null> = {
  gopay: ["gopay"],
  shopeepay: ["shopeepay"],
  qris: ["other_qris"],
  bank_transfer: ["bank_transfer", "echannel", "permata_va", "bca_va", "bni_va", "bri_va", "cimb_va"],
  ovo: ["other_qris"],
  dana: ["other_qris"],
  card: ["credit_card"],
  retail_alfamart: ["alfamart"], alfamart: ["alfamart"],
  retail_indomaret: ["indomaret"], indomaret: ["indomaret"],
  paylater_kredivo: ["kredivo"], kredivo: ["kredivo"],
  akulaku: ["akulaku"],
  linkaja: null, finpay_money: null, paylater_indodana: null,
  any: [],
};

export function mapMidtransChannel(channel: string | null): ChannelMapping {
  if (!channel || channel === "any") return { supported: true, code: null, enabledPayments: [] };
  const v = MIDTRANS_ENABLED_PAYMENTS[channel.toLowerCase()];
  if (v === undefined) return { supported: false, code: null, note: `Saluran ${channel} tidak dikenal untuk Midtrans` };
  if (v === null) return { supported: false, code: null, note: `Saluran ${channel} tidak tersedia di Midtrans` };
  return { supported: true, code: channel.toLowerCase(), enabledPayments: v };
}

/**
 * Lipat transaction_status + fraud_status menjadi satu status provider:
 * capture+accept → "capture"; capture+challenge → "pending"; capture+deny → "deny".
 * (KONTRAK §3: "settlement/capture(accept) → PAID").
 */
export function foldMidtransStatus(transactionStatus: string, fraudStatus?: string | null): string {
  const t = String(transactionStatus ?? "").toLowerCase();
  if (t === "capture") {
    const f = String(fraudStatus ?? "accept").toLowerCase();
    return f === "accept" ? "capture" : f === "deny" ? "deny" : "pending";
  }
  return t;
}

export function normalizeMidtransStatus(s: string | null | undefined, fraudStatus?: string | null): PayStatus | null {
  const t = foldMidtransStatus(String(s ?? ""), fraudStatus);
  switch (t) {
    case "settlement": case "capture": return "PAID";
    case "pending": case "authorize": return "PENDING";
    case "expire": return "EXPIRED";
    case "deny": case "cancel": case "failure": return "FAILED";
    case "refund": return "REFUNDED";
    case "partial_refund": return "PARTIALLY_REFUNDED";
    case "chargeback": case "partial_chargeback": return "DISPUTED";
    default: return null;
  }
}

type Notif = Record<string, unknown> & {
  payment_type?: string; bank?: string; va_numbers?: { bank?: string }[]; permata_va_number?: string; store?: string;
};

/** Kunci saluran dari notifikasi Midtrans (port channelOf lama; kunci payment_channel_fees Midtrans 0100). */
export function midtransChannelOf(n: Notif): string | null {
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

export async function midtransSignature(orderId: string, statusCode: string, grossAmount: string, serverKey: string): Promise<string> {
  return await sha512Hex(`${orderId}${statusCode}${grossAmount}${serverKey}`);
}

export class MidtransProvider implements PaymentProvider {
  readonly name = "midtrans" as const;
  readonly env: ProviderEnv;
  private readonly f: typeof fetch;
  private readonly urls: { snap: string; api: string };

  constructor(private readonly cfg: ProviderConfig) {
    this.env = cfg.env;
    this.f = cfg.fetch ?? fetch;
    this.urls = MIDTRANS_URLS[cfg.env];
    registerSecret(cfg.serverKey);
  }

  get clientKey(): string | null { return this.cfg.clientKey ?? null; }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { "Content-Type": "application/json", Accept: "application/json", Authorization: "Basic " + btoa(this.cfg.serverKey + ":"), ...extra };
  }

  private async call(method: string, url: string, body?: unknown, extraHeaders: Record<string, string> = {}) {
    const res = await fetchWithTimeout(this.f, url, { method, headers: this.headers(extraHeaders), body: body !== undefined ? JSON.stringify(body) : undefined }, this.cfg.timeoutMs ?? 15000);
    const text = await res.text();
    return { status: res.status, json: (safeParse(text) ?? { _text: text.slice(0, 500) }) as Record<string, unknown> };
  }

  normalizeStatus(s: string): PayStatus | null { return normalizeMidtransStatus(s); }
  mapChannel(channel: string | null): ChannelMapping { return mapMidtransChannel(channel); }

  async createCharge(input: CreateChargeInput): Promise<CreateChargeResult> {
    const ch = this.mapChannel(input.channel);
    if (!ch.supported) return { ok: false, error: ch.note, raw: null };
    const items = input.items?.length ? input.items : [{ id: input.purpose, price: Math.round(input.amount), quantity: 1, name: input.description.slice(0, 50) }];
    const body = {
      transaction_details: { order_id: input.externalId, gross_amount: Math.round(input.amount) },
      item_details: items,
      customer_details: { first_name: input.customer.firstName, last_name: input.customer.lastName ?? undefined, email: input.customer.email ?? undefined, phone: input.customer.phone ?? undefined },
      enabled_payments: ch.enabledPayments?.length ? ch.enabledPayments : undefined,
      expiry: { unit: "minutes", duration: Math.max(1, Math.round(input.expiryMinutes)) },
      custom_field1: String(input.meta?.user_id ?? ""), custom_field2: input.purpose, custom_field3: String(input.meta?.order_code ?? ""),
      callbacks: input.successUrl ? { finish: input.successUrl } : undefined,
    };
    // Notifikasi transaksi baru diarahkan ke pay-webhook/midtrans; transaksi lama tetap ke URL dashboard (midtrans-webhook).
    const extraHeaders: Record<string, string> = this.cfg.notificationUrl ? { "X-Override-Notification": this.cfg.notificationUrl } : {};
    let r;
    try {
      r = await this.call("POST", `${this.urls.snap}/snap/v1/transactions`, body, extraHeaders);
    } catch (e) {
      return { ok: false, error: `Midtrans tidak dapat dihubungi: ${(e as Error).message}`, raw: null };
    }
    const j = r.json;
    if (r.status < 200 || r.status >= 300 || typeof j.token !== "string") {
      const msgs = Array.isArray(j.error_messages) ? (j.error_messages as string[]).join(", ") : `HTTP ${r.status}`;
      return { ok: false, httpStatus: r.status, error: `Midtrans menolak transaksi: ${msgs}`, raw: j };
    }
    return {
      ok: true, httpStatus: r.status, raw: j, checkoutToken: j.token as string, checkoutUrl: (j.redirect_url as string) ?? null,
      expiresAt: new Date(Date.now() + input.expiryMinutes * 60000).toISOString(), providerChannel: ch.code,
    };
  }

  async checkStatus(externalId: string): Promise<StatusResult> {
    let r;
    try {
      r = await this.call("GET", `${this.urls.api}/v2/${encodeURIComponent(externalId)}/status`);
    } catch (e) {
      return { ok: false, found: false, providerStatus: "", status: null, amount: null, error: (e as Error).message, raw: null };
    }
    const j = r.json;
    const sc = String(j.status_code ?? "");
    if (r.status === 404 || sc === "404") return { ok: true, found: false, providerStatus: "NOT_FOUND", status: null, amount: null, httpStatus: r.status, raw: j };
    if (r.status >= 500 || r.status === 401 || sc === "401") return { ok: false, found: false, providerStatus: "", status: null, amount: null, httpStatus: r.status, error: `HTTP ${r.status}/${sc}`, raw: j };
    const folded = foldMidtransStatus(String(j.transaction_status ?? ""), j.fraud_status as string | undefined);
    return {
      ok: !!folded, found: !!folded, providerStatus: folded, status: normalizeMidtransStatus(folded), amount: toAmount(j.gross_amount),
      providerTxnId: (j.transaction_id as string) ?? null, httpStatus: r.status, raw: j,
    };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    let r;
    try {
      r = await this.call("POST", `${this.urls.api}/v2/${encodeURIComponent(input.externalId)}/refund`, {
        refund_key: input.refundKey.slice(0, 40), amount: Math.round(input.amount), reason: input.reason.slice(0, 100),
      });
    } catch (e) {
      return { ok: false, supported: true, error: `unknown_result: ${(e as Error).message}`, raw: null };
    }
    const j = r.json;
    const sc = String(j.status_code ?? r.status);
    if (sc === "200" || sc === "201") {
      const st = String(j.transaction_status ?? "");
      return { ok: true, supported: true, pending: !(st === "refund" || st === "partial_refund"), providerStatus: st || null, providerRef: (j.refund_key as string) ?? input.refundKey, httpStatus: r.status, raw: j };
    }
    // 412: transaksi tidak bisa dimodifikasi / saluran tidak mendukung refund
    const unsupported = sc === "412" || /not\s*(be\s*)?(allowed|support)/i.test(String(j.status_message ?? ""));
    return { ok: false, supported: !unsupported, httpStatus: r.status, error: String(j.status_message ?? `HTTP ${r.status}`), raw: j };
  }

  async cancel(externalId: string): Promise<CancelResult> {
    try {
      const r = await this.call("POST", `${this.urls.api}/v2/${encodeURIComponent(externalId)}/cancel`);
      const sc = String(r.json.status_code ?? r.status);
      return { ok: sc === "200", httpStatus: r.status, raw: r.json };
    } catch (e) {
      return { ok: false, error: (e as Error).message, raw: null };
    }
  }

  async verifyNotification(rawBody: string, _headers: Headers): Promise<VerifiedNotification> {
    const p = safeParse(rawBody);
    if (!p || typeof p !== "object" || Array.isArray(p)) return { ok: false, reason: "body_not_object", eventId: "", externalId: null, providerStatus: "", amount: null, raw: null };
    const n = p as Notif;
    const orderId = String(n.order_id ?? ""), statusCode = String(n.status_code ?? ""), gross = String(n.gross_amount ?? "");
    const given = String(n.signature_key ?? "").toLowerCase();
    const folded = foldMidtransStatus(String(n.transaction_status ?? ""), n.fraud_status as string | undefined);
    let ok = false;
    if (orderId && given && this.cfg.serverKey) {
      const expected = await midtransSignature(orderId, statusCode, gross, this.cfg.serverKey);
      ok = timingSafeEqual(expected, given);
    }
    return {
      ok, reason: ok ? undefined : "signature_mismatch", verifiedVia: ok ? "sha512" : undefined,
      eventId: `mt-${String(n.transaction_id ?? orderId)}-${folded}-${statusCode}`,
      externalId: orderId || null, providerStatus: folded, amount: toAmount(gross), channel: midtransChannelOf(n), raw: n,
    };
  }
}
