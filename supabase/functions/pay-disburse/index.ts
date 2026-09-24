// Edge Function: pay-disburse — lihat handler.ts. Deploy: supabase functions deploy pay-disburse
import { realDeps } from "../_shared/db.ts";
import { makeDisburseHandler } from "./handler.ts";

Deno.serve(makeDisburseHandler(realDeps()));
