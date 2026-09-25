// Edge Function: pay-reconcile — lihat handler.ts.
// Deploy: supabase functions deploy pay-reconcile --no-verify-jwt  (otorisasi x-cron-secret / service_role di dalam)
import { realDeps } from "../_shared/db.ts";
import { makeReconcileHandler } from "./handler.ts";

Deno.serve(makeReconcileHandler(realDeps()));
