// Edge Function: pay-refund — lihat handler.ts. Deploy: supabase functions deploy pay-refund
import { realDeps } from "../_shared/db.ts";
import { makePayRefundHandler } from "./handler.ts";

Deno.serve(makePayRefundHandler(realDeps()));
