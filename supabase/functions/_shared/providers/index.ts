// Pabrik adaptor provider + pemuatan rahasia per env.
import { getSecrets, OTHER_ENV, type GatewaySecrets } from "../config.ts";
import type { Deps } from "../deps.ts";
import { log } from "../log.ts";
import { FinpayProvider } from "./finpay.ts";
import { MidtransProvider } from "./midtrans.ts";
import { SimulatedProvider } from "./simulated.ts";
import type { PaymentProvider, ProviderEnv, ProviderName } from "./types.ts";

export { FinpayProvider, MidtransProvider, SimulatedProvider };

/** URL webhook publik: PAY_WEBHOOK_BASE_URL atau <SUPABASE_URL>/functions/v1. */
export function webhookUrl(deps: Pick<Deps, "env">, route: string): string {
  const base = (deps.env("PAY_WEBHOOK_BASE_URL") ?? `${(deps.env("SUPABASE_URL") ?? "").replace(/\/+$/, "")}/functions/v1`).replace(/\/+$/, "");
  return `${base}/pay-webhook/${route}`;
}

export function buildProvider(name: ProviderName, s: GatewaySecrets | null, deps: Pick<Deps, "env" | "fetch">, env: ProviderEnv): PaymentProvider | null {
  if (name === "simulated") return new SimulatedProvider(env);
  if (!s) return null;
  const cfg = {
    env: s.env, merchantId: s.merchantId, serverKey: s.serverKey, clientKey: s.clientKey, callbackToken: s.callbackToken,
    extra: s.extra, fetch: deps.fetch, notificationUrl: webhookUrl(deps, name),
  };
  return name === "finpay" ? new FinpayProvider(cfg) : new MidtransProvider(cfg);
}

/**
 * Adaptor untuk (provider, env). Midtrans: bila tak ada kunci untuk env itu, jatuh ke env lain (perilaku lama:
 * kunci tersimpan menentukan sandbox/production) dengan peringatan. Finpay: ketat per env.
 */
export async function providerFor(deps: Deps, name: ProviderName, env: ProviderEnv): Promise<PaymentProvider | null> {
  if (name === "simulated") return new SimulatedProvider(env);
  let s = await getSecrets(deps.db, name, env, deps.env);
  if (!s && name === "midtrans") {
    s = await getSecrets(deps.db, name, OTHER_ENV(env), deps.env);
    if (s) log.warn("midtrans_env_fallback", { wanted: env, using: s.env });
  }
  return buildProvider(name, s, deps, s?.env ?? env);
}

/** Kandidat verifikasi webhook: env aktif dulu, lalu env lain (callback transaksi lama setelah pindah env). */
export async function providerCandidates(deps: Deps, name: "finpay" | "midtrans" | "finpay_disbursement", activeEnv: ProviderEnv): Promise<{ env: ProviderEnv; secrets: GatewaySecrets }[]> {
  const out: { env: ProviderEnv; secrets: GatewaySecrets }[] = [];
  for (const e of [activeEnv, OTHER_ENV(activeEnv)]) {
    const s = await getSecrets(deps.db, name, e, deps.env);
    if (s && !out.some((o) => o.secrets.serverKey === s.serverKey)) out.push({ env: e, secrets: s });
  }
  return out;
}

/** Rahasia disbursement: provider 'finpay_disbursement' bila ada, selain itu kredensial 'finpay'. */
export async function disbursementSecrets(deps: Deps, env: ProviderEnv): Promise<GatewaySecrets | null> {
  return (await getSecrets(deps.db, "finpay_disbursement", env, deps.env)) ?? (await getSecrets(deps.db, "finpay", env, deps.env));
}
