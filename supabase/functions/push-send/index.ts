// Edge Function: push-send — lihat handler.ts (antrean push_outbox → FCM HTTP v1).
// Otorisasi: x-push-secret = secret PUSH_DISPATCH_SECRET (dipakai pg_cron/push_dispatch 0116), atau JWT service_role, atau JWT admin.
// Secret: FCM_SERVICE_ACCOUNT (JSON service account Firebase), PUSH_DISPATCH_SECRET (≥ 16 karakter, sama dengan Vault push_dispatch_secret).
// Deploy: supabase functions deploy push-send  (verify_jwt = true: pg_net mengirim apikey/Bearer anon key agar lolos gateway).
import { realDeps } from "../_shared/db.ts";
import { makePushSendHandler } from "./handler.ts";

Deno.serve(makePushSendHandler(realDeps()));
