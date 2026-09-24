// pay-disburse — pencairan penarikan mitra lewat Finpay Disbursement (KONTRAK §8).
// Body: { withdrawal_id, dry_run?: boolean }. Admin JWT + admin_has('payout') (+ admin_require_unlock bila ada).
// Hanya bila app_settings.disbursement_provider = 'finpay'.
// Alur: inquiry (refCode, nama pemilik rekening, fee) → cocokkan nama → klaim baris (provider_ref = external_id,
//   payout_status PAYOUT_PROCESSING) → transfer (order.id = external_id) → payout_event_ingest(p_external_id, p_status, p_raw).
// Callback final diterima di pay-webhook/finpay-disbursement.
import { requireAdminPerm } from "../_shared/auth.ts";
import { loadPaySettings } from "../_shared/config.ts";
import type { Deps } from "../_shared/deps.ts";
import { HttpError, json, preflight, readJson, UUID_RE } from "../_shared/http.ts";
import { ingestPayoutEvent } from "../_shared/ingest.ts";
import { newExternalId } from "../_shared/ids.ts";
import { log } from "../_shared/log.ts";
import { buildProvider, disbursementSecrets } from "../_shared/providers/index.ts";
import { bankCodeOf, type FinpayProvider } from "../_shared/providers/finpay.ts";

/** Nama cocok bila semua token nama di aplikasi (≥ 2 huruf) ada di nama bank, atau sebaliknya (gelar/singkatan diabaikan). */
export function namesMatch(a: string, b: string): boolean {
  const tok = (s: string) => String(s ?? "").toUpperCase().replace(/[^A-Z ]/g, " ").split(/\s+/)
    .filter((t) => t.length >= 2 && !["IR", "DR", "SH", "SE", "ST", "MM", "HJ", "H", "BPK", "IBU", "SDR", "PT", "CV", "TBK"].includes(t));
  const x = tok(a), y = tok(b);
  if (!x.length || !y.length) return false;
  const inY = x.filter((t) => y.includes(t)).length, inX = y.filter((t) => x.includes(t)).length;
  return inY === x.length || inX === y.length;
}

export function makeDisburseHandler(deps: Deps) {
  return async (req: Request): Promise<Response> => {
    const pre = preflight(req);
    if (pre) return pre;
    if (req.method !== "POST") return json({ error: "Metode tidak diizinkan" }, 405);
    try {
      const { user } = await requireAdminPerm(deps, req, "payout");
      const body = await readJson<{ withdrawal_id?: string; dry_run?: boolean }>(req, 4096);
      const id = String(body.withdrawal_id ?? "");
      if (!UUID_RE.test(id)) throw new HttpError(400, "withdrawal_id wajib");
      return json(await disburse(deps, id, user.id, body.dry_run === true));
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message, ...(e.body ?? {}) }, e.status);
      log.error("pay_disburse_unhandled", { error: e as Error });
      return json({ error: "Kesalahan server" }, 500);
    }
  };
}

async function disburse(deps: Deps, id: string, adminId: string, dryRun: boolean) {
  const settings = await loadPaySettings(deps.db);
  if (settings.disbursementProvider !== "finpay") throw new HttpError(409, "Pencairan otomatis nonaktif (disbursement_provider bukan 'finpay'). Gunakan penandaan manual.");
  const s = await disbursementSecrets(deps, settings.env);
  if (!s) throw new HttpError(503, "Kredensial Finpay Disbursement belum diisi");
  const fin = buildProvider("finpay", s, deps, settings.env) as FinpayProvider;

  const { data: w, error } = await deps.db.from("withdrawal_requests").select("*").eq("id", id).maybeSingle();
  if (error) throw new HttpError(500, "Penarikan tidak dapat dibaca");
  if (!w) throw new HttpError(404, "Penarikan tidak ditemukan");
  if (w.status !== "approved") throw new HttpError(409, "Penarikan belum disetujui");
  if (w.settled_at) throw new HttpError(409, "Penarikan sudah selesai");
  if (w.provider_ref || (w.payout_status && w.payout_status !== "PAYOUT_PENDING")) throw new HttpError(409, `Penarikan sedang/sudah diproses (${w.payout_status ?? w.provider_ref})`);
  const bankCode = bankCodeOf(String(w.bank_name ?? ""), s.extra.bank_map as Record<string, unknown> | undefined);
  if (!bankCode) throw new HttpError(422, `Kode bank untuk '${w.bank_name}' tidak dikenal. Tambahkan di gateway_secrets.extra.bank_map.`);
  const accountNumber = String(w.bank_account ?? "").replace(/\D/g, "");
  if (accountNumber.length < 5) throw new HttpError(422, "Nomor rekening tidak valid");
  const amount = Math.round(Number(w.amount));

  // 1. Inquiry
  let inq;
  try {
    inq = await fin.disburseInquiry({ bankCode, accountNumber, amount });
  } catch (e) {
    throw new HttpError(502, `Inquiry Finpay gagal: ${(e as Error).message}`);
  }
  if (!inq.ok || !inq.refCode) throw new HttpError(502, `Inquiry ditolak: ${inq.error ?? "tanpa refCode"}`);
  if (!inq.accountName || !namesMatch(String(w.account_name ?? ""), inq.accountName)) {
    throw new HttpError(422, "Nama pemilik rekening tidak cocok — periksa data mitra sebelum transfer.", { name_app: w.account_name, name_bank: inq.accountName });
  }
  if (dryRun) return { ok: true, dry_run: true, account_name: inq.accountName, fee: inq.fee, bank_code: bankCode };

  // 2. Klaim baris (satu eksekusi saja)
  const externalId = newExternalId("AKD", deps.now());
  const { data: claimed, error: cErr } = await deps.db.from("withdrawal_requests")
    .update({ provider: "finpay", provider_ref: externalId, inquiry_ref: inq.refCode, fee: inq.fee ?? 0, payout_status: "PAYOUT_PROCESSING" })
    .eq("id", id).eq("status", "approved").is("provider_ref", null).is("settled_at", null).select("id").maybeSingle();
  if (cErr) throw new HttpError(500, `Klaim penarikan gagal: ${cErr.message}`);
  if (!claimed) throw new HttpError(409, "Penarikan sudah diklaim proses lain");

  // 3. Transfer
  let tr;
  try {
    tr = await fin.disburseTransfer({ externalId, refCode: inq.refCode, bankCode, accountNumber, accountName: inq.accountName, amount, description: `Pencairan AntarKita ${id.slice(0, 8)}` });
  } catch (e) {
    // Hasil tidak pasti: JANGAN tandai gagal (saldo akan dikembalikan padahal uang mungkin terkirim). Tunggu callback.
    log.warn("disburse_transfer_unknown", { withdrawal_id: id, external_id: externalId, error: e as Error });
    return { ok: false, withdrawal_id: id, external_id: externalId, payout_status: "PAYOUT_PROCESSING", note: "unknown_result" };
  }
  let status = tr.payoutStatus;
  if (!status) status = tr.httpStatus >= 400 && tr.httpStatus < 500 ? "PAYOUT_FAILED" : "PAYOUT_PROCESSING";
  await ingestPayoutEvent(deps, externalId, status, { transfer: tr.raw, inquiry: inq.raw, _antarkita: { by: adminId, status_code: tr.statusCode, http: tr.httpStatus, withdrawal_id: id } });
  log.info("disburse_submitted", { withdrawal_id: id, external_id: externalId, status, code: tr.statusCode });
  return { ok: status !== "PAYOUT_FAILED", withdrawal_id: id, external_id: externalId, payout_status: status, status_code: tr.statusCode, fee: inq.fee };
}
