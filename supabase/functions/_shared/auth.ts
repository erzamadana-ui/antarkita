// Otorisasi bersama untuk edge function pembayaran.
import type { AuthUser, Deps } from "./deps.ts";
import { bearer, HttpError, timingSafeEqual } from "./http.ts";
import { log } from "./log.ts";

export async function requireUser(deps: Deps, req: Request): Promise<{ user: AuthUser; authHeader: string }> {
  const authHeader = req.headers.get("Authorization") ?? "";
  const user = await deps.getUser(authHeader);
  if (!user) throw new HttpError(401, "Harus login");
  return { user, authHeader };
}

/**
 * Admin dengan izin RBAC (KONTRAK §5: admin_has(p_perm)). Juga mencoba admin_require_unlock() (PIN) bila fungsi itu
 * tersedia untuk authenticated; bila fungsinya belum ada (PGRST202) → dilewati dengan peringatan log.
 */
export async function requireAdminPerm(deps: Deps, req: Request, perm: string): Promise<{ user: AuthUser; authHeader: string }> {
  const { user, authHeader } = await requireUser(deps, req);
  const udb = deps.userDb(authHeader);
  const { data, error } = await udb.rpc("admin_has", { p_perm: perm });
  if (error) {
    log.error("admin_has_failed", { perm, code: error.code, message: error.message });
    throw new HttpError(403, "Izin admin tidak dapat diperiksa");
  }
  if (data !== true) throw new HttpError(403, `Butuh izin admin '${perm}'`);
  const unlock = await udb.rpc("admin_require_unlock", {});
  if (unlock.error) {
    if (unlock.error.code === "PGRST202") log.warn("admin_require_unlock_missing", { perm });
    else throw new HttpError(403, unlock.error.message || "PIN admin diperlukan", { need_unlock: true });
  }
  return { user, authHeader };
}

/** Cron: header x-cron-secret = env CRON_SECRET, atau Authorization Bearer = service_role key. Waktu-konstan. */
export function isCronOrServiceRole(deps: Deps, req: Request): boolean {
  const cron = deps.env("CRON_SECRET") ?? "";
  const got = req.headers.get("x-cron-secret") ?? "";
  if (cron.length >= 16 && got && timingSafeEqual(got, cron)) return true;
  const svc = deps.env("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const tok = bearer(req);
  return svc.length > 0 && tok.length > 0 && timingSafeEqual(tok, svc);
}
