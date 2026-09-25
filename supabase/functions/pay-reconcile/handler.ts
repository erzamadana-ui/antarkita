// pay-reconcile — dipanggil cron (pg_cron/pg_net 02:00 WIB) atau manual oleh server (KONTRAK §6, §9).
// Otorisasi: header x-cron-secret = env CRON_SECRET, ATAU Authorization: Bearer <service_role key>.
// Body opsional: { date?: 'YYYY-MM-DD' (default kemarin WIB), limit?: number (default 100, maks 300), skip_daily?: boolean }
// Langkah:
//  1. PENDING > 30 menit (≤ 7 hari) → checkStatus → ingest bila status provider ≠ PENDING (event_id recon-<ts>-<external_id>).
//     Masih PENDING di provider padahal sudah lewat expires_at + 15 menit → cancel di provider → ingest EXPIRED.
//  2. PAID pada tanggal H-1 → checkStatus konfirmasi; beda (mis. REFUNDED/FAILED) → ingest + dicatat mismatch.
//  3. Refund 'executing' > 10 menit → checkStatus; bila provider sudah REFUNDED/PARTIALLY_REFUNDED → selesaikan.
//  4. reconcile_daily(p_date).
import { isCronOrServiceRole } from "../_shared/auth.ts";
import { loadPaySettings } from "../_shared/config.ts";
import type { Deps } from "../_shared/deps.ts";
import { HttpError, json, preflight, readJson } from "../_shared/http.ts";
import { ingestPaymentEvent } from "../_shared/ingest.ts";
import { log } from "../_shared/log.ts";
import { providerFor } from "../_shared/providers/index.ts";
import type { PaymentProvider, ProviderEnv, ProviderName } from "../_shared/providers/types.ts";
import { finishDone, refundVisible } from "../pay-refund/handler.ts";
import { paymentEnv, refundTotalOf } from "../_shared/payments.ts";

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

const PENDING_AGE_MIN = 30;
const EXPIRY_GRACE_MIN = 15;

/** Field tambahan untuk ingest dari hasil checkStatus: refund_amount kumulatif bila status refund. */
function reconRaw(provider: string, c: { status: string | null; raw: unknown }): Record<string, unknown> {
  // Respons status di tingkat atas (payment_settle membaca gross_amount/payment_type/va_numbers dari p_raw).
  const base = c.raw && typeof c.raw === "object" && !Array.isArray(c.raw) ? { ...(c.raw as Record<string, unknown>) } : {};
  if (c.status !== "REFUNDED" && c.status !== "PARTIALLY_REFUNDED") return base;
  const total = refundTotalOf(provider, c.raw);
  return { ...base, event_type: "refund", ...(total !== null ? { refund_amount: total } : {}) };
}

/** Tanggal WIB (UTC+7) kemarin sebagai 'YYYY-MM-DD'. */
export function yesterdayWib(nowMs: number): string {
  return new Date(nowMs + 7 * 3600_000 - 86400_000).toISOString().slice(0, 10);
}

/** Rentang UTC untuk satu tanggal WIB. */
export function wibDayRange(date: string): { from: string; to: string } {
  const from = new Date(`${date}T00:00:00+07:00`);
  return { from: from.toISOString(), to: new Date(from.getTime() + 86400_000).toISOString() };
}

export function makeReconcileHandler(deps: Deps) {
  return async (req: Request): Promise<Response> => {
    const pre = preflight(req);
    if (pre) return pre;
    if (req.method !== "POST") return json({ error: "Metode tidak diizinkan" }, 405);
    if (!isCronOrServiceRole(deps, req)) return json({ error: "Tidak diizinkan" }, 401);
    try {
      const body = await readJson<{ date?: string; limit?: number; skip_daily?: boolean }>(req, 4096);
      const date = /^\d{4}-\d{2}-\d{2}$/.test(String(body.date ?? "")) ? String(body.date) : yesterdayWib(deps.now());
      const limit = Math.max(1, Math.min(300, Math.round(Number(body.limit ?? 100)) || 100));
      return json(await reconcile(deps, date, limit, body.skip_daily === true));
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      log.error("reconcile_unhandled", { error: e as Error });
      return json({ error: "Kesalahan server" }, 500);
    }
  };
}

export async function reconcile(deps: Deps, date: string, limit: number, skipDaily = false) {
  const settings = await loadPaySettings(deps.db);
  const now = deps.now();
  const providers = new Map<string, PaymentProvider | null>();
  const prov = async (name: ProviderName, env: ProviderEnv) => {
    const k = `${name}:${env}`;
    if (!providers.has(k)) providers.set(k, await providerFor(deps, name, env));
    return providers.get(k)!;
  };
  const summary = { date, pending_checked: 0, pending_updated: 0, pending_expired: 0, paid_checked: 0, paid_mismatch: 0, refunds_finished: 0, errors: 0, daily: null as unknown };

  // 1. PENDING menggantung
  const cutoff = new Date(now - PENDING_AGE_MIN * 60000).toISOString();
  const since = new Date(now - 7 * 86400_000).toISOString();
  const { data: pend, error: pErr } = await deps.db.from("payments").select("*")
    .eq("pay_status", "PENDING").in("provider", ["finpay", "midtrans"]).lt("created_at", cutoff).gt("created_at", since)
    .order("created_at", { ascending: true }).limit(limit);
  if (pErr) log.error("reconcile_query_pending_failed", { message: pErr.message });
  for (const p of (pend ?? []) as Row[]) {
    try {
      const provider = await prov(p.provider, paymentEnv(p, settings.env));
      const ext = String(p.provider_ref ?? p.external_id ?? "");
      if (!provider || !ext) continue;
      summary.pending_checked++;
      const c = await provider.checkStatus(ext);
      if (!c.ok && c.providerStatus !== "NOT_FOUND") { summary.errors++; continue; }
      const expired = p.expires_at && new Date(p.expires_at).getTime() + EXPIRY_GRACE_MIN * 60000 < now;
      if (c.status && c.status !== "PENDING") {
        await ingestPaymentEvent(deps, {
          provider: provider.name, eventId: `recon-${now}-${ext}`, externalId: ext, providerStatus: c.providerStatus, amount: c.amount,
          signatureOk: true, env: provider.env, raw: { ...reconRaw(provider.name, c), reconcile: true, check: c.raw, _antarkita: { env: provider.env, pay_status: c.status } },
        });
        summary.pending_updated++;
      } else if (expired) {
        // Tutup di provider dulu supaya tidak bisa dibayar lagi; hanya bila berhasil → EXPIRED.
        const cancel = c.providerStatus === "NOT_FOUND" ? { ok: true, raw: { not_found: true } } : await provider.cancel(ext);
        if (cancel.ok) {
          await ingestPaymentEvent(deps, {
            provider: provider.name, eventId: `recon-${now}-${ext}`, externalId: ext,
            providerStatus: provider.name === "midtrans" ? "expire" : "EXPIRED", amount: null, signatureOk: true, env: provider.env,
            raw: { reconcile: true, local_expired: true, check: c.raw, cancel: cancel.raw },
          });
          summary.pending_expired++;
        }
      }
    } catch (e) {
      summary.errors++;
      log.warn("reconcile_pending_item_failed", { payment_id: p.id, error: e as Error });
    }
  }

  // 2. PAID kemarin — konfirmasi ke provider
  const { from, to } = wibDayRange(date);
  const { data: paid, error: paidErr } = await deps.db.from("payments").select("*")
    .eq("pay_status", "PAID").in("provider", ["finpay", "midtrans"]).gte("paid_at", from).lt("paid_at", to)
    .order("paid_at", { ascending: true }).limit(limit);
  if (paidErr) log.error("reconcile_query_paid_failed", { message: paidErr.message });
  for (const p of (paid ?? []) as Row[]) {
    try {
      const provider = await prov(p.provider, paymentEnv(p, settings.env));
      const ext = String(p.provider_ref ?? p.external_id ?? "");
      if (!provider || !ext) continue;
      summary.paid_checked++;
      const c = await provider.checkStatus(ext);
      if (!c.ok) { summary.errors++; continue; }
      const amountMismatch = c.amount !== null && Number(p.amount) !== c.amount;
      if (c.status !== "PAID" || amountMismatch) {
        summary.paid_mismatch++;
        log.warn("reconcile_paid_mismatch", { payment_id: p.id, external_id: ext, provider_status: c.providerStatus, amount_db: p.amount, amount_provider: c.amount });
        if (c.status && c.status !== "PAID") {
          await ingestPaymentEvent(deps, {
            provider: provider.name, eventId: `recon-${now}-${ext}`, externalId: ext, providerStatus: c.providerStatus, amount: c.amount,
            signatureOk: true, env: provider.env, raw: { ...reconRaw(provider.name, c), reconcile: true, paid_recheck: true, check: c.raw },
          });
        }
      }
    } catch (e) {
      summary.errors++;
      log.warn("reconcile_paid_item_failed", { payment_id: p.id, error: e as Error });
    }
  }

  // 3. Refund yang masih 'executing'
  const { data: rrs } = await deps.db.from("refund_requests").select("*").eq("status", "executing")
    .lt("decided_at", new Date(now - 10 * 60000).toISOString()).limit(50);
  for (const rr of (rrs ?? []) as Row[]) {
    try {
      const { data: p } = await deps.db.from("payments").select("*").eq("id", rr.payment_id).maybeSingle();
      if (!p) continue;
      const provider = await prov(p.provider, paymentEnv(p, settings.env));
      const ext = String(p.provider_ref ?? p.external_id ?? "");
      if (!provider || !ext) continue;
      const c = await provider.checkStatus(ext);
      if (c.ok && refundVisible(c.status, p.refunded_amount)) {
        const amt = Math.round(Number(rr.amount));
        await finishDone(deps, provider, rr.id, ext, amt, c.status === "REFUNDED", null, { reconcile: true, check: c.raw }, Math.round(Number(p.refunded_amount ?? 0)) + amt);
        summary.refunds_finished++;
      }
    } catch (e) {
      summary.errors++;
      log.warn("reconcile_refund_item_failed", { refund_id: rr.id, error: e as Error });
    }
  }

  // 4. Rekonsiliasi harian di DB
  if (!skipDaily) {
    const { data, error } = await deps.db.rpc("reconcile_daily", { p_date: date });
    if (error) { summary.errors++; log.error("reconcile_daily_failed", { date, message: error.message }); }
    summary.daily = data ?? null;
  }
  log.info("reconcile_done", summary);
  return summary;
}
