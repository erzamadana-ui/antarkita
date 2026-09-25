-- =====================================================================
-- ROLLBACK 0111_rbac_rpc_lama.sql (psql -1 -f; PERTAMA, sebelum 0110_down)
-- Memulihkan: semua RPC admin_% lama tanpa admin_require (definisi sebelum 0111, dari _migration_backup),
-- admin_set_user (0019/…), hak tulis & kebijakan RLS admin pada pricing_sessions/intercity_rates/travel_routes.
-- Menghapus: admin_set_pricing_session / admin_set_intercity_rate / admin_set_travel_route, admin_rpc_perm,
-- pay_reconcile_dispatch + jadwal cron antarkita_pay_reconcile_pending/daily.
-- DATA: tidak ada data yang hilang (audit_logs append-only tetap).
-- =====================================================================
do $$ begin perform cron.unschedule('antarkita_pay_reconcile_pending'); exception when others then null; end $$;
do $$ begin perform cron.unschedule('antarkita_pay_reconcile_daily'); exception when others then null; end $$;

select public._mig_restore('0111');
select public._mig_restore_acl('0111');

-- kebijakan RLS tulis admin (definisi sebelum 0111)
drop policy if exists pricing_sessions_admin on public.pricing_sessions;
create policy pricing_sessions_admin on public.pricing_sessions to authenticated using (is_admin()) with check (is_admin());
drop policy if exists icr_admin on public.intercity_rates;
create policy icr_admin on public.intercity_rates to authenticated using (is_admin()) with check (is_admin());
drop policy if exists tr_admin on public.travel_routes;
create policy tr_admin on public.travel_routes to authenticated using (is_admin()) with check (is_admin());

do $$
begin
  if to_regclass('_lokal.migrasi') is not null then execute $q$delete from _lokal.migrasi where nama like '0111\_%'$q$; end if;
  if to_regclass('supabase_migrations.schema_migrations') is not null then execute $q$delete from supabase_migrations.schema_migrations where version like '0111%'$q$; end if;
end $$;

do $$
begin
  if to_regprocedure('public.admin_set_pricing_session(uuid,jsonb)') is not null or to_regprocedure('public.pay_reconcile_dispatch(jsonb)') is not null
     or position('0111 RBAC' in pg_get_functiondef('public.admin_set_bank_verified(uuid,boolean)'::regprocedure)) > 0
     or position('SELF_CHANGE' in pg_get_functiondef('public.admin_set_user(uuid,user_role,boolean,text)'::regprocedure)) > 0
     or not has_table_privilege('authenticated', 'public.pricing_sessions', 'UPDATE') then
    raise exception '0111_down gagal: objek/hak 0111 belum pulih';
  end if;
  raise notice '0111_down ok';
end $$;
