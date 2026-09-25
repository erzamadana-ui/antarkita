// Antarmuka adaptor payment gateway (KONTRAK-API-V3 §9).
// Semua adaptor murni: I/O jaringan hanya lewat `fetch` yang disuntikkan (tes memakai fetch tiruan).

export type ProviderName = "finpay" | "midtrans" | "simulated";
export type ProviderEnv = "sandbox" | "production";

/** Status kanonik `payments.pay_status` (KONTRAK §2–§3). */
export type PayStatus =
  | "PENDING" | "PAID" | "FAILED" | "EXPIRED" | "REFUND_REQUESTED" | "PARTIALLY_REFUNDED" | "REFUNDED" | "DISPUTED";

/** Kunci saluran internal (payment_channel_fees.channel, v3). */
export const INTERNAL_CHANNELS = [
  "bank_transfer", "qris", "card", "gopay", "shopeepay", "ovo", "dana", "linkaja", "finpay_money",
  "retail_alfamart", "retail_indomaret", "paylater_kredivo", "paylater_indodana",
] as const;
export type InternalChannel = typeof INTERNAL_CHANNELS[number];

export interface ProviderConfig {
  env: ProviderEnv;
  merchantId?: string | null;
  /** Midtrans: Server Key. Finpay: Merchant Key (password Basic Auth & kunci HMAC callback). */
  serverKey: string;
  clientKey?: string | null;
  callbackToken?: string | null;
  /** gateway_secrets.extra — mis. channel_map, base_url, paths. */
  extra?: Record<string, unknown>;
  /** URL webhook yang dikirim ke provider (callbackUrl / X-Override-Notification). */
  notificationUrl?: string | null;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export interface Customer {
  email?: string | null;
  firstName: string;
  lastName?: string | null;
  phone?: string | null;
}

export interface CreateChargeInput {
  externalId: string;
  amount: number;
  /** Kunci saluran internal atau null (pelanggan memilih di halaman provider). */
  channel: string | null;
  /** Sub-pilihan saluran, mis. bank VA ("bca"). */
  bank?: string | null;
  description: string;
  expiryMinutes: number;
  customer: Customer;
  purpose: "order" | "topup";
  items?: { id: string; name: string; price: number; quantity: number }[];
  successUrl?: string | null;
  failUrl?: string | null;
  backUrl?: string | null;
  meta?: Record<string, unknown>;
}

export interface CreateChargeResult {
  ok: boolean;
  checkoutUrl?: string | null;
  checkoutToken?: string | null;
  qrString?: string | null;
  qrImageUrl?: string | null;
  paymentCode?: string | null;
  expiresAt?: string | null;
  providerTxnId?: string | null;
  /** Kode saluran yang dikirim ke provider (mis. sourceOfFunds.type Finpay). */
  providerChannel?: string | null;
  httpStatus?: number;
  error?: string;
  raw: unknown;
}

export interface StatusResult {
  ok: boolean;
  found: boolean;
  /** Status mentah dari provider (Finpay: PAID/…; Midtrans: settlement/…; capture+fraud sudah dilipat). */
  providerStatus: string;
  status: PayStatus | null;
  amount: number | null;
  providerTxnId?: string | null;
  httpStatus?: number;
  error?: string;
  raw: unknown;
}

export interface RefundInput {
  externalId: string;
  amount: number;
  totalAmount: number;
  reason: string;
  /** Referensi unik refund (refund_requests.id) — Midtrans refund_key; Finpay tidak punya idempotency. */
  refundKey: string;
}

export interface RefundResult {
  ok: boolean;
  /** false = provider/saluran tidak mendukung refund (admin memilih tujuan wallet). */
  supported: boolean;
  /** true = diterima provider tetapi belum final. */
  pending?: boolean;
  providerRef?: string | null;
  providerStatus?: string | null;
  httpStatus?: number;
  error?: string;
  raw: unknown;
}

export interface CancelResult { ok: boolean; httpStatus?: number; error?: string; raw: unknown }

export interface VerifiedNotification {
  ok: boolean;
  reason?: string;
  /** ID deterministik untuk dedupe di payment_events(provider, event_id). */
  eventId: string;
  externalId: string | null;
  providerStatus: string;
  amount: number | null;
  /** Kunci saluran internal bila bisa diturunkan. */
  channel?: string | null;
  /** Cara signature lolos (untuk audit): 'raw-strip' | 'php-encode' | … */
  verifiedVia?: string;
  raw: unknown;
}

export interface ChannelMapping {
  supported: boolean;
  /** Finpay: sourceOfFunds.type (null = tidak dikirim). Midtrans: dipakai enabledPayments. */
  code: string | null;
  enabledPayments?: string[];
  note?: string;
}

export interface PaymentProvider {
  readonly name: ProviderName;
  readonly env: ProviderEnv;
  createCharge(input: CreateChargeInput): Promise<CreateChargeResult>;
  checkStatus(externalId: string): Promise<StatusResult>;
  refund(input: RefundInput): Promise<RefundResult>;
  cancel(externalId: string): Promise<CancelResult>;
  verifyNotification(rawBody: string, headers: Headers): Promise<VerifiedNotification>;
  normalizeStatus(providerStatus: string): PayStatus | null;
  mapChannel(channel: string | null, bank?: string | null): ChannelMapping;
}

/** Status terminal: tidak boleh mundur ke PENDING. */
export const TERMINAL: ReadonlySet<PayStatus> = new Set(["PAID", "FAILED", "EXPIRED", "REFUNDED"]);
