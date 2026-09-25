// Pembacaan app_settings & gateway_secrets (murni terhadap DbLike — tanpa import supabase-js).
import type { DbLike } from "./deps.ts";
import { registerSecret } from "./log.ts";
import type { ProviderEnv } from "./providers/types.ts";

export async function getSetting<T>(db: DbLike, key: string, fallback: T): Promise<T> {
  const { data, error } = await db.from("app_settings").select("value").eq("key", key).maybeSingle();
  if (error || !data || data.value === null || data.value === undefined) return fallback;
  return data.value as T;
}

export interface PaySettings {
  providerActive: "midtrans" | "finpay";
  env: ProviderEnv;
  simulationEnabled: boolean;
  orderTimeoutMin: number;
  topupTimeoutMin: number;
  disbursementProvider: "manual" | "finpay";
}

const PAY_KEYS = [
  "payment_provider_active", "payment_provider_env", "payments_simulation_enabled", "order_payment_timeout_min",
  "topup_payment_timeout_min", "disbursement_provider",
];

const asBool = (v: unknown) => v === true || v === "true";

/** Semua setting pembayaran dalam satu query. Nilai tak dikenal → default aman (sandbox, simulasi mati). */
export async function loadPaySettings(db: DbLike): Promise<PaySettings> {
  const { data } = await db.from("app_settings").select("key, value").in("key", PAY_KEYS);
  const m = new Map<string, unknown>((data ?? []).map((r: { key: string; value: unknown }) => [r.key, r.value]));
  const provider = String(m.get("payment_provider_active") ?? "midtrans");
  const env = String(m.get("payment_provider_env") ?? "sandbox");
  const n = (k: string, d: number) => { const x = Number(m.get(k)); return Number.isFinite(x) && x > 0 ? x : d; };
  return {
    providerActive: provider === "finpay" ? "finpay" : "midtrans",
    env: env === "production" ? "production" : "sandbox",
    simulationEnabled: asBool(m.get("payments_simulation_enabled")),
    orderTimeoutMin: Math.min(24 * 60, n("order_payment_timeout_min", 15)),
    topupTimeoutMin: Math.min(24 * 60, n("topup_payment_timeout_min", 30)),
    disbursementProvider: String(m.get("disbursement_provider") ?? "manual") === "finpay" ? "finpay" : "manual",
  };
}

/** Simulasi hanya bila flag aktif DAN env bukan production DAN tidak dimatikan paksa lewat env var. */
export function simulationAllowed(s: PaySettings, envVar: (k: string) => string | undefined): boolean {
  return s.simulationEnabled && s.env !== "production" && envVar("PAYMENTS_SIMULATION_HARD_OFF") !== "true";
}

export interface GatewaySecrets {
  provider: string;
  env: ProviderEnv;
  merchantId: string | null;
  serverKey: string;
  clientKey: string | null;
  callbackToken: string | null;
  extra: Record<string, unknown>;
  source: "env" | "db" | "db-legacy";
}

/**
 * Rahasia gateway untuk (provider, env).
 * Urutan: (1) env var override, (2) gateway_secrets baris (provider, env), (3) baris lama tanpa kolom env
 * (Midtrans pra-v3: env dari is_production). Mengembalikan null bila kunci kosong.
 * Env override: FINPAY_MERCHANT_ID / FINPAY_MERCHANT_KEY / FINPAY_BASE_URL (WAJIB + FINPAY_ENV = env-nya),
 * FINPAY_DISB_MERCHANT_ID / FINPAY_DISB_MERCHANT_KEY, MIDTRANS_SERVER_KEY / MIDTRANS_CLIENT_KEY / MIDTRANS_IS_PRODUCTION.
 */
export async function getSecrets(db: DbLike, provider: string, env: ProviderEnv, envVar: (k: string) => string | undefined): Promise<GatewaySecrets | null> {
  const fromEnv = envOverride(provider, env, envVar);
  if (fromEnv) { registerSecret(fromEnv.serverKey); return fromEnv; }
  const { data, error } = await db.from("gateway_secrets").select("*").eq("provider", provider);
  if (error || !Array.isArray(data) || data.length === 0) return null;
  // deno-lint-ignore no-explicit-any
  const rows = data as any[];
  let row = rows.find((r) => r.env === env);
  let source: GatewaySecrets["source"] = "db";
  if (!row) {
    row = rows.find((r) => r.env === undefined || r.env === null);
    source = "db-legacy";
    if (row && (row.is_production ? "production" : "sandbox") !== env) row = undefined;
  }
  if (!row || !row.server_key) return null;
  registerSecret(row.server_key);
  registerSecret(row.callback_token);
  const extra = row.extra && typeof row.extra === "object" ? { ...row.extra } : {};
  const base = envVar("FINPAY_BASE_URL");
  if (provider.startsWith("finpay") && base) extra.base_url = base;
  return {
    provider, env, merchantId: row.merchant_id ?? null, serverKey: String(row.server_key), clientKey: row.client_key ?? null,
    callbackToken: row.callback_token ?? null, extra, source,
  };
}

function envOverride(provider: string, env: ProviderEnv, envVar: (k: string) => string | undefined): GatewaySecrets | null {
  if (provider === "finpay" || provider === "finpay_disbursement") {
    const pre = provider === "finpay" ? "FINPAY" : "FINPAY_DISB";
    const key = envVar(`${pre}_MERCHANT_KEY`);
    const restrict = envVar("FINPAY_ENV");
    // T1: override env var WAJIB menyebut env-nya (FINPAY_ENV) — tanpa itu diabaikan, agar kunci sandbox tidak
    // pernah dipakai untuk transaksi production (atau sebaliknya).
    if (!key || !restrict || restrict !== env) return null;
    const extra: Record<string, unknown> = {};
    if (envVar("FINPAY_BASE_URL")) extra.base_url = envVar("FINPAY_BASE_URL");
    return { provider, env, merchantId: envVar(`${pre}_MERCHANT_ID`) ?? null, serverKey: key, clientKey: null, callbackToken: null, extra, source: "env" };
  }
  if (provider === "midtrans") {
    const key = envVar("MIDTRANS_SERVER_KEY");
    if (!key) return null;
    const keyEnv: ProviderEnv = envVar("MIDTRANS_IS_PRODUCTION") === "true" ? "production" : "sandbox";
    if (keyEnv !== env) return null;
    return { provider, env, merchantId: null, serverKey: key, clientKey: envVar("MIDTRANS_CLIENT_KEY") ?? null, callbackToken: null, extra: {}, source: "env" };
  }
  return null;
}

export const OTHER_ENV = (e: ProviderEnv): ProviderEnv => (e === "production" ? "sandbox" : "production");
