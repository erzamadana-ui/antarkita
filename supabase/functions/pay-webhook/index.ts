// Edge Function: pay-webhook — lihat handler.ts. Deploy: supabase functions deploy pay-webhook --no-verify-jwt
import { realDeps } from "../_shared/db.ts";
import { makeWebhookHandler } from "./handler.ts";

Deno.serve(makeWebhookHandler(realDeps()));
