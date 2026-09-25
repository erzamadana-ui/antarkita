// Provider simulasi — HANYA untuk sandbox/dev. Syarat pakai (dicek di pay-create & pay-webhook/simulated, dan
// dicek ulang oleh payment_event_ingest di DB): payments_simulation_enabled=true, payment_provider_env≠'production',
// dan payments.provider='simulated'. Tidak ada jaringan; pelunasan lewat POST /pay-webhook/simulated (JWT pemilik).
import type {
  CancelResult, ChannelMapping, CreateChargeInput, CreateChargeResult, PaymentProvider, PayStatus, ProviderEnv,
  RefundInput, RefundResult, StatusResult, VerifiedNotification,
} from "./types.ts";

const CANON: Record<string, PayStatus> = {
  PAID: "PAID", PENDING: "PENDING", FAILED: "FAILED", EXPIRED: "EXPIRED", REFUNDED: "REFUNDED", PARTIALLY_REFUNDED: "PARTIALLY_REFUNDED",
};

export const SIMULATED_ALLOWED_STATUSES = ["PAID", "FAILED", "EXPIRED"] as const;

export class SimulatedProvider implements PaymentProvider {
  readonly name = "simulated" as const;
  constructor(readonly env: ProviderEnv = "sandbox") {}

  normalizeStatus(s: string): PayStatus | null { return CANON[String(s ?? "").toUpperCase()] ?? null; }
  mapChannel(channel: string | null): ChannelMapping { return { supported: true, code: channel }; }

  createCharge(input: CreateChargeInput): Promise<CreateChargeResult> {
    if (this.env === "production") return Promise.resolve({ ok: false, error: "Simulasi dilarang di production", raw: null });
    return Promise.resolve({
      ok: true, raw: { simulated: true }, checkoutUrl: null, checkoutToken: null,
      qrString: input.channel === "qris" ? `SIMULATED-QRIS-${input.externalId}` : null,
      paymentCode: input.channel === "bank_transfer" || String(input.channel ?? "").startsWith("retail_") ? `9999${Date.now().toString().slice(-8)}` : null,
      expiresAt: new Date(Date.now() + input.expiryMinutes * 60000).toISOString(), providerChannel: input.channel,
    });
  }

  checkStatus(_externalId: string): Promise<StatusResult> {
    // Tidak ada sumber eksternal; rekonsiliasi melewati provider simulasi.
    return Promise.resolve({ ok: false, found: false, providerStatus: "", status: null, amount: null, error: "simulated_no_remote", raw: null });
  }

  refund(input: RefundInput): Promise<RefundResult> {
    if (this.env === "production") return Promise.resolve({ ok: false, supported: false, error: "Simulasi dilarang di production", raw: null });
    return Promise.resolve({ ok: true, supported: true, pending: false, providerStatus: input.amount >= input.totalAmount ? "REFUNDED" : "PARTIALLY_REFUNDED", providerRef: `SIMREF-${input.refundKey.slice(0, 8)}`, raw: { simulated: true } });
  }

  cancel(_externalId: string): Promise<CancelResult> { return Promise.resolve({ ok: true, raw: { simulated: true } }); }

  verifyNotification(_rawBody: string, _headers: Headers): Promise<VerifiedNotification> {
    // Simulasi tidak memakai signature; otorisasi = JWT pemilik + flag (lihat pay-webhook).
    return Promise.resolve({ ok: false, reason: "use_jwt_route", eventId: "", externalId: null, providerStatus: "", amount: null, raw: null });
  }
}
