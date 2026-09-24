// Pembungkus RPC service_role (KONTRAK §2, §4, §6, §8). Nama & parameter HARUS sama dengan migrasi Agen A.
import type { Deps } from "./deps.ts";
import { log, redact } from "./log.ts";

export interface IngestResult { duplicate: boolean; applied: boolean; pay_status: string | null; note: string | null }

export interface IngestArgs {
  provider: string;
  eventId: string;
  externalId: string | null;
  providerStatus: string;
  amount: number | null;
  signatureOk: boolean;
  raw: unknown;
}

/** payment_event_ingest(p_provider, p_event_id, p_external_id, p_provider_status, p_amount, p_signature_ok, p_raw). */
export async function ingestPaymentEvent(deps: Deps, a: IngestArgs): Promise<IngestResult> {
  const { data, error } = await deps.db.rpc("payment_event_ingest", {
    p_provider: a.provider,
    p_event_id: a.eventId.slice(0, 200),
    p_external_id: a.externalId,
    p_provider_status: a.providerStatus,
    p_amount: a.amount,
    p_signature_ok: a.signatureOk,
    p_raw: redact(a.raw), // PAN/kunci tidak pernah masuk DB
  });
  if (error) {
    log.error("payment_event_ingest_failed", { provider: a.provider, event_id: a.eventId, external_id: a.externalId, code: error.code, message: error.message });
    throw new Error(`payment_event_ingest: ${error.message}`);
  }
  const r = (Array.isArray(data) ? data[0] : data) ?? {};
  const out: IngestResult = { duplicate: !!r.duplicate, applied: !!r.applied, pay_status: r.pay_status ?? null, note: r.note ?? null };
  log.info("payment_event_ingested", { provider: a.provider, event_id: a.eventId, external_id: a.externalId, provider_status: a.providerStatus, ...out });
  return out;
}

/** payout_event_ingest(p_external_id, p_status, p_raw) — p_status = PAYOUT_SETTLED | PAYOUT_PROCESSING | PAYOUT_FAILED. */
export async function ingestPayoutEvent(deps: Deps, externalId: string, status: string, raw: unknown) {
  const { data, error } = await deps.db.rpc("payout_event_ingest", { p_external_id: externalId, p_status: status, p_raw: redact(raw) });
  if (error) {
    log.error("payout_event_ingest_failed", { external_id: externalId, status, code: error.code, message: error.message });
    throw new Error(`payout_event_ingest: ${error.message}`);
  }
  log.info("payout_event_ingested", { external_id: externalId, status });
  return data;
}

/**
 * refund_execute_result(p_id, p_status, p_provider_ref, p_raw, p_note) — p_status:
 *   'executing' = klaim atomik approved→executing (RPC WAJIB menolak bila status bukan 'approved'),
 *   'done' | 'failed' = hasil akhir. destination='wallet' → RPC menjalankan wallet_apply('refund').
 */
export async function refundExecuteResult(deps: Deps, id: string, status: "executing" | "done" | "failed", providerRef: string | null, raw: unknown, note: string | null) {
  const { data, error } = await deps.db.rpc("refund_execute_result", { p_id: id, p_status: status, p_provider_ref: providerRef, p_raw: redact(raw), p_note: note });
  if (error) {
    log.error("refund_execute_result_failed", { refund_id: id, status, code: error.code, message: error.message });
    throw new Error(`refund_execute_result: ${error.message}`);
  }
  return data;
}
