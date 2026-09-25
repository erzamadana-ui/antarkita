-- =====================================================================
-- ROLLBACK 0107_rbac_dual_approval_keamanan.sql (psql -1 -f; setelah 0108_down)
-- Memulihkan: admin_has/admin_require (versi is_admin 0105), admin_adjust_wallet (0019, tanpa dual approval),
-- admin_review_withdrawal/admin_review_topup/admin_mark_withdrawal_settled, create_order, order_payment_prepare,
-- request_withdrawal (tanpa rate_take), admin_set_payment_channel_fee (tanpa maker-checker); hak tulis & kebijakan
-- RLS admin pada app_settings/service_economics/pricing/promos/payment_channel_fees/ad_products seperti sebelum 0107.
-- Menghapus: approval_requests, profiles.admin_role (+ trigger), RPC RBAC/approval/pricing/promo.
-- DATA: permintaan persetujuan yang masih pending ikut terhapus (penyesuaian saldo/tarif belum dieksekusi).
-- =====================================================================
drop trigger if exists t_profiles_admin_role_guard on public.profiles;
drop trigger if exists t_audit_approval_requests on public.approval_requests;

select public._mig_restore('0107');
select public._mig_restore_acl('0107');

-- kebijakan RLS tulis admin (definisi 0003/0098 sebelum 0107)
drop policy if exists service_economics_admin_read on public.service_economics;
drop policy if exists settings_admin on public.app_settings;
create policy settings_admin on public.app_settings to authenticated using (is_admin()) with check (is_admin());
drop policy if exists service_economics_admin on public.service_economics;
create policy service_economics_admin on public.service_economics for all to authenticated using (is_admin()) with check (is_admin());
drop policy if exists pricing_admin on public.pricing;
create policy pricing_admin on public.pricing to authenticated using (is_admin()) with check (is_admin());
drop policy if exists promos_admin on public.promos;
create policy promos_admin on public.promos to authenticated using (is_admin()) with check (is_admin());

drop table if exists public.approval_requests;
alter table public.profiles drop constraint if exists profiles_admin_role_check;
alter table public.profiles drop column if exists admin_role;

do $$
begin
  if to_regclass('_lokal.migrasi') is not null then execute $q$delete from _lokal.migrasi where nama like '0107\_%'$q$; end if;
  if to_regclass('supabase_migrations.schema_migrations') is not null then execute $q$delete from supabase_migrations.schema_migrations where version like '0107%'$q$; end if;
end $$;

do $$
begin
  if to_regclass('public.approval_requests') is not null or to_regprocedure('public.my_admin_role()') is not null
     or exists (select 1 from information_schema.columns where table_name = 'profiles' and column_name = 'admin_role')
     or position('0107 rate_take' in (select pg_get_functiondef(oid) from pg_proc where proname = 'create_order' and pronamespace = 'public'::regnamespace)) > 0
     or not has_table_privilege('authenticated', 'public.app_settings', 'UPDATE') then
    raise exception '0107_down gagal: objek/hak 0107 belum pulih';
  end if;
  raise notice '0107_down ok';
end $$;
