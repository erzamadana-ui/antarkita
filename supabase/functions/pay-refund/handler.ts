// pay-refund — eksekusi refund_requests yang sudah 'approved' (KONTRAK §4, §9).
// Body: { refund_id }. Admin JWT + admin_has('refund_execute') (+ admin_require_unlock bila tersedia).
// Alur: klaim atomik approved→executing (refund_execute_result 'executing') → destination:
//   • 'wallet'  → refund_execute_result('done') — DB menjalankan wallet_apply('refund').
//   • 'gateway' → provider.refund → payment_event_ingest(REFUNDED|PARTIALLY_REFUNDED) → refund_execute_result('done').
//     Tidak didukung provider → 'failed' + note 'provider_unsupported' (admin mengganti tujuan ke wallet).
//     Hasil tidak pasti (timeout) → checkStatus; bila belum terlihat refund → tetap 'executing' (pay-reconcile menyapu).
import { requireAdminPerm } from "../_shared/auth.ts";
import { loadPaySettings, simulationAllowed } from "../_shared/config.ts";
import type { Deps } from "../_shared/deps.ts";
import { HttpError, json, preflight, readJson, UUID_RE } from "../_shared/http.ts";
import { ingestPaymentEvent, refundExecuteResult } from "../_shared/ingest.ts";
import { log } from "../_shared/log.ts";
import { providerFor } from "../_shared/providers/index.ts";
import { paymentEnv } from "../_shared/payments.ts";
export { paymentEnv };
import type { PaymentProvider, ProviderName } from "../_shared/providers/types.ts";

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

/** Status provider yang dikirim ke payment_event_ingest setelah refund sukses. */
export function refundProviderStatus(provider: ProviderName, full: boolean): string {
  if (provider === "midtrans") return full ? "refund" : "partial_refund";
  return full ? "REFUNDED" : "PARTIALLY_REFUNDED";
}

/**
 * Apakah refund INI sudah terlihat di provider? REFUNDED → ya. PARTIALLY_REFUNDED hanya bisa dianggap refund ini
 * bila belum ada refund lain yang tercatat (refunded_amount = 0); selain itu ambigu → tidak diselesaikan otomatis.
 */
export function refundVisible(status: string | null, alreadyRefunded: unknown): boolean {
  if (status === "REFUNDED") return true;
  return status === "PARTIALLY_REFUNDED" && Math.round(Number(alreadyRefunded ?? 0)) === 0;
}

export function makePayRefundHandler(deps: Deps) {
  return async (req: Request): Promise<Response> => {
    const pre = preflight(req);
    if (pre) return pre;
    if (req.method !== "POST") return json({ error: "Metode tidak diizinkan" }, 405);
    try {
      const { user } = await requireAdminPerm(deps, req, "refund_execute");
      const body = await readJson<{ refund_id?: string }>(req, 4096);
      const id = String(body.refund_id ?? "");
      if (!UUID_RE.test(id)) throw new HttpError(400, "refund_id wajib");
      return json(await executeRefund(deps, id, user.id));
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message, ...(e.body ?? {}) }, e.status);
      log.error("pay_refund_unhandled", { error: e as Error });
      return json({ error: "Kesalahan server" }, 500);
    }
  };
}

export async function executeRefund(deps: Deps, id: string, adminId: string | null) {
  const { data: rr, error } = await deps.db.from("refund_requests").select("*").eq("id", id).maybeSingle();
  if (error) throw new HttpError(500, "Refund tidak dapat dibaca");
  if (!rr) throw new HttpError(404, "Refund tidak ditemukan");
  if (rr.status !== "approved") throw new HttpError(409, `Refund berstatus '${rr.status}', harus 'approved'`);
  const amount = Math.round(Number(rr.amount));
  if (!(amount > 0)) throw new HttpError(400, "Nominal refund tidak valid");

  // Klaim atomik — RPC menolak bila status sudah bukan 'approved' (mencegah eksekusi ganda).
  try {
    await refundExecuteResult(deps, id, "executing", null, { by: adminId, at: new Date(deps.now()).toISOString() }, null);
  } catch (e) {
    throw new HttpError(409, `Refund tidak dapat diklaim: ${(e as Error).message}`);
  }

  if (rr.destination === "wallet") {
    await refundExecuteResult(deps, id, "done", null, { destination: "wallet", by: adminId }, "wallet");
    log.info("refund_done_wallet", { refund_id: id, amount });
    return { ok: true, refund_id: id, status: "done", destination: "wallet" };
  }

  const { data: pay } = await deps.db.from("payments").select("*").eq("id", rr.payment_id).maybeSingle();
  if (!pay) {
    await refundExecuteResult(deps, id, "failed", null, { reason: "payment_not_found" }, "payment_not_found");
    throw new HttpError(404, "Pembayaran untuk refund ini tidak ditemukan");
  }
  const settings = await loadPaySettings(deps.db);
  const pname = pay.provider as ProviderName;
  if (pname === "simulated" && !simulationAllowed(settings, deps.env)) {
    await refundExecuteResult(deps, id, "failed", null, { reason: "simulation_disabled" }, "simulation_disabled");
    throw new HttpError(409, "Refund transaksi simulasi hanya saat simulasi aktif");
  }
  const env = paymentEnv(pay, settings.env);
  const provider = await providerFor(deps, pname, env);
  if (!provider) {
    await refundExecuteResult(deps, id, "failed", null, { reason: "provider_not_configured", provider: pname }, "provider_not_configured");
    throw new HttpError(503, `Gateway ${pname} belum dikonfigurasi`);
  }
  const externalId = String(pay.provider_ref ?? pay.external_id);
  const total = Math.round(Number(pay.amount));
  const already = Math.round(Number(pay.refunded_amount ?? 0));
  if (already + amount > total) {
    await refundExecuteResult(deps, id, "failed", null, { reason: "exceeds_paid", total, already, amount }, "exceeds_paid");
    throw new HttpError(409, "Nominal refund melebihi sisa pembayaran");
  }
  const full = already + amount >= total;

  const r = await provider.refund({ externalId, amount, totalAmount: total, reason: String(rr.reason ?? "refund"), refundKey: id });
  if (r.ok && !r.pending) {
    return await finishDone(deps, provider, id, externalId, amount, full, r.providerRef ?? null, r.raw, already + amount);
  }
  if (r.ok && r.pending) {
    await refundExecuteResult(deps, id, "executing", r.providerRef ?? null, { refund: r.raw }, "provider_pending");
    log.info("refund_provider_pending", { refund_id: id, external_id: externalId });
    return { ok: true, refund_id: id, status: "executing", note: "provider_pending" };
  }
  if (!r.supported) {
    await refundExecuteResult(deps, id, "failed", null, { refund: r.raw, error: r.error }, "provider_unsupported");
    return { ok: false, refund_id: id, status: "failed", note: "provider_unsupported", message: "Saluran ini tidak mendukung refund via gateway. Ubah tujuan ke saldo (wallet) lalu setujui ulang." };
  }
  if ((r.error ?? "").startsWith("unknown_result")) {
    // Jangan ulangi refund membabi buta (Finpay tanpa idempotency): cek status dulu.
    const c = await provider.checkStatus(externalId);
    if (c.ok && refundVisible(c.status, already)) {
      return await finishDone(deps, provider, id, externalId, amount, full, null, { refund: r.raw, check: c.raw }, already + amount);
    }
    await refundExecuteResult(deps, id, "executing", null, { refund_error: r.error, check: c.raw }, "unknown_result");
    return { ok: false, refund_id: id, status: "executing", note: "unknown_result", message: "Hasil refund belum pasti; rekonsiliasi akan memeriksa ulang. Jangan eksekusi ulang manual." };
  }
  await refundExecuteResult(deps, id, "failed", null, { refund: r.raw, error: r.error, http: r.httpStatus }, "provider_error");
  return { ok: false, refund_id: id, status: "failed", note: "provider_error", message: r.error };
}

/**
 * Tutup refund sukses. `cumulative` = total refund pembayaran ini SETELAH refund ini — dikirim sebagai
 * p_raw.refund_amount karena payment_event_ingest (0105) mengisi payments.refunded_amount dari field itu.
 */
export async function finishDone(deps: Deps, provider: PaymentProvider, id: string, externalId: string, amount: number, full: boolean, providerRef: string | null, raw: unknown, cumulative: number) {
  const r = await ingestPaymentEvent(deps, {
    provider: provider.name, eventId: `refund-${id}`, externalId, providerStatus: refundProviderStatus(provider.name, full),
    amount, signatureOk: true, env: provider.env, raw: { event_type: "refund", refund_request_id: id, refund_amount: cumulative, response: raw },
  });
  if (r.failed) throw new Error(`payment_event_ingest: ${r.note}`);
  await refundExecuteResult(deps, id, "done", providerRef, { response: raw }, null);
  log.info("refund_done_gateway", { refund_id: id, external_id: externalId, amount, full });
  return { ok: true, refund_id: id, status: "done", destination: "gateway", provider_ref: providerRef };
}
