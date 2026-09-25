// Kontrak dependensi handler — memisahkan pembuatan client Supabase (db.ts) dari logika,
// supaya handler bisa dites dengan client tiruan tanpa jaringan.

// deno-lint-ignore no-explicit-any
export interface DbResult<T = any> { data: T; error: { message: string; code?: string; details?: string } | null }

/** Subset client Supabase yang dipakai handler (rpc + query builder PostgREST). */
export interface DbLike {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<DbResult>;
  // deno-lint-ignore no-explicit-any
  from(table: string): any;
}

export interface AuthUser { id: string; email?: string | null }

export interface Deps {
  /** Client service_role (melewati RLS) — HANYA di server. */
  db: DbLike;
  /** Client ber-JWT pengguna — RPC yang memakai auth.uid() (order_payment_prepare, admin_has, …). */
  userDb(authHeader: string): DbLike;
  /** Verifikasi JWT pengguna ke Supabase Auth (bukan sekadar decode). */
  getUser(authHeader: string): Promise<AuthUser | null>;
  env(name: string): string | undefined;
  fetch: typeof fetch;
  now(): number;
}
