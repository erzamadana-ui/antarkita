// Lookup transaksi & env transaksi (T1: env terikat ke payment, bukan ke setting saat ini).
import type { DbLike } from "./deps.ts";
import { deepFind, toAmount } from "./jsonutil.ts";
import type { ProviderEnv } from "./providers/types.ts";

// deno-lint-ignore no-explicit-any
export type PaymentRow = Record<string, any>;

const REF_RE = /^[A-Za-z0-9_-]{1,64}$/;
const COLS = "id, user_id, provider, env, pay_status, amount, refunded_amount, external_id, provider_ref, raw";

/**
 * payments berdasarkan external_id lalu provider_ref (service_role). null = tidak ada.
 * Error DB dilempar (pemanggil menjawab 5xx supaya provider mengirim ulang).
 */
export async function findPaymentByRef(db: DbLike, ref: string | null | undefined): Promise<PaymentRow | null> {
  if (!ref || !REF_RE.test(ref)) return null;
  for (const col of ["external_id", "provider_ref"]) {
    const { data, error } = await db.from("payments").select(COLS).eq(col, ref).maybeSingle();
    if (error) throw new Error(`lookup payments.${col}: ${error.message}`);
    if (data) return data as PaymentRow;
  }
  return null;
}

/** Env transaksi: payments.env (0105) → raw._antarkita.env (pra-kolom) → fallback (setting saat ini). */
export function paymentEnv(p: PaymentRow | null | undefined, fallback: ProviderEnv): ProviderEnv {
  const e = p?.env ?? p?.raw?._antarkita?.env;
  return e === "production" || e === "sandbox" ? e : fallback;
}

/** Env disbursement dari prefiks external_id buatan pay-disburse: AKD- = production, AKDS- = sandbox. */
export function disbursementEnvOf(ref: string | null | undefined): ProviderEnv | null {
  if (!ref) return null;
  if (/^AKDS-/.test(ref)) return "sandbox";
  if (/^AKD-/.test(ref)) return "production";
  return null;
}
export const disbursementPrefix = (env: ProviderEnv) => (env === "production" ? "AKD" : "AKDS");

/**
 * Total refund KUMULATIF dari payload provider (payment_event_ingest 0105 membaca p_raw.refund_amount).
 * Midtrans: jumlah refunds[].refund_amount, selain itu refund_amount. Finpay: PERLU VERIFIKASI SANDBOX —
 * dicari refundAmount/refund_amount/totalRefund/refundedAmount. null = tidak diketahui (DB → needs_review).
 */
export function refundTotalOf(provider: string, ...sources: unknown[]): number | null {
  for (const src of sources) {
    if (!src || typeof src !== "object") continue;
    if (provider === "midtrans") {
      const o = src as Record<string, unknown>;
      if (Array.isArray(o.refunds) && o.refunds.length) {
        let sum = 0, any = false;
        for (const r of o.refunds as Record<string, unknown>[]) {
          const a = toAmount(r?.refund_amount);
          if (a !== null) { sum += a; any = true; }
        }
        if (any) return sum;
      }
      const single = toAmount(o.refund_amount);
      if (single !== null) return single;
    } else {
      const v = toAmount(deepFind(src, ["totalRefund", "refundedAmount", "refundAmount", "refund_amount"]));
      if (v !== null) return v;
    }
  }
  return null;
}
