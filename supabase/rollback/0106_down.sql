-- =====================================================================
-- ROLLBACK 0106_ledger_v3_rekonsiliasi.sql (psql -1 -f; setelah 0107_down)
-- Memulihkan: ledger_post / ledger_post_travel / ledger_post_ads (v2: hapus-lalu-tulis per fase), ledger_check (v2);
-- hak audit_logs sebelum 0106; tanpa trigger append-only order_ledger/audit_logs.
-- Menghapus: reconciliation_runs, reconcile_daily/admin_reconcile_run/admin_reconciliation_runs/admin_contribution_margin,
-- ledger_apply_set, jadwal cron antarkita_reconcile_daily, app_settings.variable_cost_per_order.
-- TIDAK BISA dikembalikan: nilai enum ledger_entry yang ditambahkan (customer_receivable, wallet_liability, tax_output,
-- dispute, unreconciled, payout_fee, ads_impression_cost, ads_click_cost) — PostgreSQL tidak punya
-- ALTER TYPE … DROP VALUE; nilai itu tetap ada tetapi tidak dipakai kode v2. Baris order_ledger yang sudah ditulis
-- (termasuk baris pembalik & sumber payments/disputes/reconciliation/payouts) tetap; kolom payment_id/reversal_of
-- dihapus (jumlah per fase tetap benar karena baris pembalik ikut terjumlah). CHECK source v2 dipulihkan hanya bila
-- tidak ada baris bersumber baru (NOTICE bila ada).
-- =====================================================================
drop trigger if exists t_order_ledger_append_only on public.order_ledger;
drop trigger if exists t_order_ledger_no_truncate on public.order_ledger;
drop trigger if exists t_audit_logs_append_only on public.audit_logs;
drop trigger if exists t_audit_logs_no_truncate on public.audit_logs;
do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'antarkita_reconcile_daily';
exception when others then raise notice '0106_down: pg_cron tidak tersedia (%)', sqlerrm;
end $$;

select public._mig_restore('0106');
select public._mig_restore_acl('0106');

drop table if exists public.reconciliation_runs;
drop index if exists public.order_ledger_reversal_idx;
drop index if exists public.order_ledger_payment_idx;
drop index if exists public.order_ledger_source_phase_idx;
alter table public.order_ledger drop column if exists reversal_of;
alter table public.order_ledger drop column if exists payment_id;
do $$
begin
  if exists (select 1 from public.order_ledger where source not in ('orders','travel_bookings','travel_requests','merchant_ads')) then
    raise notice '0106_down: ada baris order_ledger bersumber v3 — CHECK source v3 dipertahankan';
  else
    alter table public.order_ledger drop constraint if exists order_ledger_source_check;
    alter table public.order_ledger add constraint order_ledger_source_check check (source in ('orders','travel_bookings','travel_requests','merchant_ads'));
  end if;
end $$;
delete from public.app_settings where key = 'variable_cost_per_order';

do $$
begin
  if to_regclass('_lokal.migrasi') is not null then execute $q$delete from _lokal.migrasi where nama like '0106\_%'$q$; end if;
  if to_regclass('supabase_migrations.schema_migrations') is not null then execute $q$delete from supabase_migrations.schema_migrations where version like '0106%'$q$; end if;
end $$;

do $$
begin
  if to_regclass('public.reconciliation_runs') is not null or to_regprocedure('public.ledger_apply_set(text,uuid,uuid,text,jsonb,jsonb)') is not null
     or pg_get_functiondef('public.ledger_post(uuid,text,jsonb)'::regprocedure) !~* 'delete\s+from\s+order_ledger'
     or exists (select 1 from pg_trigger where tgname in ('t_order_ledger_append_only', 't_audit_logs_append_only')) then
    raise exception '0106_down gagal: objek 0106 masih ada';
  end if;
  raise notice '0106_down ok (nilai enum ledger_entry v3 tetap — tidak bisa dihapus PostgreSQL)';
end $$;
