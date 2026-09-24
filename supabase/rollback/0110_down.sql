-- =====================================================================
-- ROLLBACK 0110_payout_disbursement.sql (jalankan dalam satu transaksi: psql -1 -f)
-- Urutan rollback penuh: 0110_down → 0109_down → 0108_down → 0107_down → 0106_down → 0105_down.
-- Memulihkan: admin_mark_withdrawal_settled, driver/merchant_order_breakdown (definisi sebelum 0110,
-- dari _migration_backup). Menghapus: withdrawal_orders, trigger & kolom payout, RPC baru.
-- TIDAK dikembalikan (data): orders.settlement_status yang sudah PAYOUT_PENDING/SETTLED tetap (nilai
-- sah menurut 0105); baris order_ledger source 'payouts' (append-only) tetap.
-- =====================================================================
drop trigger if exists t_withdrawal_payout_defaults on public.withdrawal_requests;
drop trigger if exists t_withdrawal_link_orders on public.withdrawal_requests;
drop trigger if exists t_withdrawal_status_sync on public.withdrawal_requests;

select public._mig_restore('0110');

drop table if exists public.withdrawal_orders;
drop index if exists public.withdrawal_requests_payout_idx;
drop index if exists public.withdrawal_requests_provider_ref_idx;
alter table public.withdrawal_requests drop constraint if exists withdrawal_requests_provider_check;
alter table public.withdrawal_requests drop constraint if exists withdrawal_requests_payout_status_check;
alter table public.withdrawal_requests drop constraint if exists withdrawal_requests_fee_check;
alter table public.withdrawal_requests drop column if exists provider;
alter table public.withdrawal_requests drop column if exists inquiry_ref;
alter table public.withdrawal_requests drop column if exists fee;
alter table public.withdrawal_requests drop column if exists payout_status;
alter table public.withdrawal_requests drop column if exists failed_reason;
alter table public.withdrawal_requests drop column if exists payout_updated_at;

-- catatan migrasi (harness lokal / Supabase CLI) bila ada
do $$
begin
  if to_regclass('_lokal.migrasi') is not null then execute $q$delete from _lokal.migrasi where nama like '0110\_%'$q$; end if;
  if to_regclass('supabase_migrations.schema_migrations') is not null then execute $q$delete from supabase_migrations.schema_migrations where version like '0110%'$q$; end if;
end $$;

do $$
begin
  if to_regprocedure('public.payout_event_ingest(text,text,jsonb)') is not null or to_regclass('public.withdrawal_orders') is not null
     or exists (select 1 from information_schema.columns where table_name = 'withdrawal_requests' and column_name = 'payout_status')
     or position('PAYOUT_SETTLED' in pg_get_functiondef('public.admin_mark_withdrawal_settled(uuid,text)'::regprocedure)) > 0 then
    raise exception '0110_down gagal: objek 0110 masih ada';
  end if;
  raise notice '0110_down ok';
end $$;
