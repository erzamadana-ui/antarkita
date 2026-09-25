// Edge Function: pay-create — lihat handler.ts. Deploy: supabase functions deploy pay-create (JWT pengguna diverifikasi di dalam).
import { realDeps } from "../_shared/db.ts";
import { makePayCreateHandler } from "./handler.ts";

Deno.serve(makePayCreateHandler(realDeps()));
