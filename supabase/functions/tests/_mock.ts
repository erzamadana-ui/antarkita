// Tiruan client Supabase (PostgREST subset) + fetch + Deps — tanpa jaringan.
import type { AuthUser, DbLike, DbResult, Deps } from "../_shared/deps.ts";

// deno-lint-ignore no-explicit-any
export type Row = Record<string, any>;
type RpcHandler = (args: Row) => DbResult | Promise<DbResult>;

class Query implements PromiseLike<DbResult> {
  private filters: ((r: Row) => boolean)[] = [];
  private op: "select" | "update" = "select";
  private patch: Row = {};
  private mode: "many" | "maybe" | "single" = "many";
  private lim = Infinity;
  constructor(private db: MockDb, private table: string) {}
  select(_cols?: string) { return this; }
  update(patch: Row) { this.op = "update"; this.patch = patch; return this; }
  eq(c: string, v: unknown) { this.filters.push((r) => r[c] === v); return this; }
  neq(c: string, v: unknown) { this.filters.push((r) => r[c] !== v); return this; }
  in(c: string, vs: unknown[]) { this.filters.push((r) => vs.includes(r[c])); return this; }
  is(c: string, v: unknown) { this.filters.push((r) => (v === null ? r[c] === null || r[c] === undefined : r[c] === v)); return this; }
  lt(c: string, v: string) { this.filters.push((r) => r[c] != null && String(r[c]) < v); return this; }
  gt(c: string, v: string) { this.filters.push((r) => r[c] != null && String(r[c]) > v); return this; }
  gte(c: string, v: string) { this.filters.push((r) => r[c] != null && String(r[c]) >= v); return this; }
  order(_c: string, _o?: unknown) { return this; }
  limit(n: number) { this.lim = n; return this; }
  maybeSingle() { this.mode = "maybe"; return this; }
  single() { this.mode = "single"; return this; }
  private exec(): DbResult {
    const rows = (this.db.tables[this.table] ??= []);
    let hit = rows.filter((r) => this.filters.every((f) => f(r))).slice(0, this.lim);
    if (this.op === "update") {
      this.db.updates.push({ table: this.table, patch: this.patch, count: hit.length });
      hit.forEach((r) => Object.assign(r, this.patch));
      hit = hit.map((r) => ({ ...r }));
    }
    if (this.mode === "maybe") return { data: hit[0] ?? null, error: null };
    if (this.mode === "single") return hit[0] ? { data: hit[0], error: null } : { data: null, error: { message: "not found", code: "PGRST116" } };
    return { data: hit, error: null };
  }
  then<A, B>(ok?: ((v: DbResult) => A | PromiseLike<A>) | null, bad?: ((e: unknown) => B | PromiseLike<B>) | null) {
    return Promise.resolve().then(() => this.exec()).then(ok, bad);
  }
}

export class MockDb implements DbLike {
  tables: Record<string, Row[]> = {};
  rpcCalls: { fn: string; args: Row }[] = [];
  updates: { table: string; patch: Row; count: number }[] = [];
  handlers: Record<string, RpcHandler> = {};
  constructor(tables: Record<string, Row[]> = {}, handlers: Record<string, RpcHandler> = {}) {
    this.tables = tables;
    this.handlers = handlers;
  }
  from(table: string) { return new Query(this, table); }
  async rpc(fn: string, args: Row = {}): Promise<DbResult> {
    this.rpcCalls.push({ fn, args });
    const h = this.handlers[fn];
    if (!h) return { data: null, error: { message: `function ${fn} not found`, code: "PGRST202" } };
    return await h(args);
  }
  calls(fn: string) { return this.rpcCalls.filter((c) => c.fn === fn); }
}

export function settingsRows(s: Row): Row[] {
  return Object.entries(s).map(([key, value]) => ({ key, value }));
}

export interface FetchCall { url: string; method: string; headers: Headers; body: string | null }
export type Route = { match: RegExp; method?: string; respond: (c: FetchCall) => Response | Promise<Response> };

export function mockFetch(routes: Route[]) {
  const calls: FetchCall[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const c: FetchCall = { url, method: (init?.method ?? "GET").toUpperCase(), headers: new Headers(init?.headers), body: (init?.body as string) ?? null };
    calls.push(c);
    const r = routes.find((x) => x.match.test(url) && (!x.method || x.method === c.method));
    if (!r) throw new Error(`mockFetch: tidak ada rute untuk ${c.method} ${url}`);
    return await r.respond(c);
  }) as typeof fetch;
  return { fetch: f, calls };
}

export const jsonRes = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

export function mkDeps(o: { db: MockDb; userDb?: MockDb; users?: Record<string, AuthUser>; env?: Record<string, string>; fetch?: typeof fetch; now?: number }): Deps {
  const env: Record<string, string> = { SUPABASE_URL: "https://proj.supabase.co", ...(o.env ?? {}) };
  return {
    db: o.db,
    userDb: () => o.userDb ?? o.db,
    getUser: (h: string) => Promise.resolve(o.users?.[h.replace(/^Bearer\s+/i, "")] ?? null),
    env: (k) => env[k],
    fetch: o.fetch ?? (() => Promise.reject(new Error("network disabled in tests"))) as typeof fetch,
    now: () => o.now ?? Date.parse("2026-09-24T03:00:00Z"),
  };
}

export function post(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`https://proj.supabase.co/functions/v1/${path}`, {
    method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** Silence log JSON selama tes. */
export function quiet() {
  const o = { log: console.log, warn: console.warn, error: console.error };
  console.log = () => {}; console.warn = () => {}; console.error = () => {};
  return () => Object.assign(console, o);
}
