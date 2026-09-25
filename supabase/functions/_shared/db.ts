// Pembuatan client Supabase (service_role & JWT pengguna) + Deps runtime.
// Satu-satunya file _shared yang mengimpor supabase-js; tes TIDAK mengimpor file ini (memakai Deps tiruan).
// deno-lint-ignore no-import-prefix -- pola sama dengan fungsi lain (tanpa import map)
import { createClient } from "npm:@supabase/supabase-js@2";
import type { AuthUser, DbLike, Deps } from "./deps.ts";
import { registerSecret } from "./log.ts";

export { getSecrets, getSetting, loadPaySettings } from "./config.ts";

const url = () => Deno.env.get("SUPABASE_URL") ?? "";
const anon = () => Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const service = () => Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

let cachedService: DbLike | null = null;

/** Client service_role (melewati RLS). Jangan pernah dikirim/di-log ke klien. */
export function serviceClient(): DbLike {
  if (!cachedService) {
    registerSecret(service());
    registerSecret(Deno.env.get("CRON_SECRET"));
    cachedService = createClient(url(), service(), { auth: { persistSession: false, autoRefreshToken: false } }) as unknown as DbLike;
  }
  return cachedService;
}

/** Client dengan JWT pengguna (auth.uid() terisi) — untuk RPC yang memeriksa kepemilikan/peran. */
export function userClient(authHeader: string): DbLike {
  return createClient(url(), anon() || service(), {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as DbLike;
}

/** Verifikasi JWT ke Supabase Auth (tanda tangan & kedaluwarsa diperiksa server Auth). */
export async function getUser(authHeader: string): Promise<AuthUser | null> {
  if (!/^Bearer\s+\S+/i.test(authHeader)) return null;
  const c = createClient(url(), anon() || service(), { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
  const { data, error } = await c.auth.getUser();
  if (error || !data?.user) return null;
  return { id: data.user.id, email: data.user.email ?? null };
}

export function realDeps(): Deps {
  return {
    db: serviceClient(),
    userDb: userClient,
    getUser,
    env: (k) => Deno.env.get(k),
    fetch: (input, init) => fetch(input, init),
    now: () => Date.now(),
  };
}
