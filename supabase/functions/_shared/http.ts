// Utilitas HTTP bersama: CORS, respons JSON, perbandingan waktu-konstan, pembacaan body terbatas.

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json", ...extra } });
}

/** Balasan preflight CORS atau null bila bukan OPTIONS. */
export function preflight(req: Request): Response | null {
  return req.method === "OPTIONS" ? new Response("ok", { headers: corsHeaders }) : null;
}

export class HttpError extends Error {
  constructor(public status: number, message: string, public body?: Record<string, unknown>) {
    super(message);
  }
}

const enc = new TextEncoder();

/**
 * Perbandingan waktu-konstan. Tidak berhenti di byte pertama yang berbeda; panjang berbeda tetap
 * memindai sepanjang input terpanjang (hasil false). Dipakai untuk signature & secret.
 */
export function timingSafeEqual(a: string | Uint8Array, b: string | Uint8Array): boolean {
  const x = typeof a === "string" ? enc.encode(a) : a;
  const y = typeof b === "string" ? enc.encode(b) : b;
  const len = Math.max(x.length, y.length);
  let diff = x.length ^ y.length;
  for (let i = 0; i < len; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export function bearer(req: Request): string {
  return (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
}

/** Baca body sebagai teks mentah dengan batas ukuran (default 64 KiB) — webhook tidak boleh menerima body raksasa. */
export async function readBodyLimited(req: Request, maxBytes = 65536): Promise<string> {
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > maxBytes) throw new HttpError(413, "Body terlalu besar");
  const buf = new Uint8Array(await req.arrayBuffer());
  if (buf.length > maxBytes) throw new HttpError(413, "Body terlalu besar");
  return new TextDecoder().decode(buf);
}

export async function readJson<T = Record<string, unknown>>(req: Request, maxBytes = 65536): Promise<T> {
  const raw = await readBodyLimited(req, maxBytes);
  if (!raw.trim()) return {} as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new HttpError(400, "Body bukan JSON yang valid");
  }
}

/** Segmen path setelah nama fungsi, mis. /functions/v1/pay-webhook/finpay → "finpay". */
export function routeAfter(req: Request, fnName: string): string {
  const parts = new URL(req.url).pathname.split("/").filter(Boolean);
  const i = parts.lastIndexOf(fnName);
  return i >= 0 ? (parts[i + 1] ?? "") : (parts[parts.length - 1] ?? "");
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** fetch dengan batas waktu (default 15 detik). */
export async function fetchWithTimeout(f: typeof fetch, url: string, init: RequestInit = {}, ms = 15000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await f(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}
