-- =====================================================================
-- ROLLBACK 0114_antarvoucher_v5_closed_loop.sql (jalankan dalam satu transaksi: psql -1 -f)
-- Memulihkan: semua fungsi yang ditambal 0114 (payment_channel_*, request_topup, order_payment_prepare, voucher_purchase_create,
--             voucher_status_public, admin_voucher_approve, voucher_expire_due, wallet_tx_before_insert, driver_accept_order,
--             driver_set_online, travel_accept_send, travel_offer_create, request_withdrawal, ledger_calc, ledger_check,
--             app_setting_specs, admin_set_settings, setting_json_validate) dari _migration_backup; nilai app_settings yang
--             ditimpa pemasangan pertama (driver_debt_limit, auto_payout_*, payment_channels, pg_methods, gateway_order_payment_enabled).
-- Menghapus : tabel voucher_codes, payout_batches, city_targets; kolom voucher_purchases.code_id/buyer_role,
--             withdrawal_requests.sla_due_at/batch_id; view v_city_target_progress; RPC v5; setelan v5; cron antarvoucher-payout-sla.
-- TIDAK dikembalikan: nilai enum wallet_tx_type 'voucher_redeem' (PostgreSQL tidak bisa DROP VALUE) — baris wallet_transactions
--             bertipe voucher_redeem tetap ada (append-only, DATA UANG). Karena itu rollback penuh HANYA aman sebelum ada kode
--             voucher yang ditukar; sesudahnya: admin_set_payment_mode('gateway') + driver_deposit_required=false (rollback fungsional).
-- =====================================================================
do $$
begin
  if exists (select 1 from public.voucher_codes where status = 'redeemed')
     and coalesce(current_setting('antarkita.force_rollback_0114', true), '') <> 'on' then
    raise exception '0114_down ditolak: sudah ada kode voucher yang ditukar ke saldo. Gunakan admin_set_payment_mode(''gateway'') (rollback fungsional), atau set antarkita.force_rollback_0114=on bila benar-benar yakin (arsipkan voucher_codes dulu).';
  end if;
end $$;

do $$
begin
  if to_regnamespace('cron') is not null and to_regclass('cron.job') is not null then
    perform cron.unschedule(jobid) from cron.job where jobname = 'antarvoucher-payout-sla';
  end if;
exception when others then raise notice '0114_down: cron tidak disentuh (%)', sqlerrm;
end $$;

drop view if exists public.v_city_target_progress;

-- fungsi: yang ditambal dipulihkan, yang baru (def NULL) dihapus
select public._mig_restore('0114');

-- kolom & tabel v5 (FK voucher_purchases.code_id → voucher_codes dilepas dulu)
alter table public.voucher_purchases drop column if exists code_id, drop column if exists buyer_role;
alter table public.withdrawal_requests drop column if exists batch_id, drop column if exists sla_due_at;
drop index if exists public.withdrawal_requests_batch_idx;
drop index if exists public.withdrawal_requests_sla_idx;
drop table if exists public.voucher_codes cascade;
drop table if exists public.payout_batches cascade;
drop table if exists public.city_targets cascade;

-- setelan: nilai yang ditimpa pemasangan pertama dipulihkan; kunci v5 dihapus
update public.app_settings a set value = b.value, updated_at = now()
  from public._migration_backup_settings b where b.version = '0114' and b.key = a.key;
delete from public.app_settings where key in ('payment_mode', 'payment_mode_snapshot', 'voucher_denominations', 'voucher_min_nominal', 'voucher_max_nominal',
  'voucher_balance_cap_customer', 'voucher_balance_cap_partner', 'voucher_float_limit', 'voucher_float_alert_pct', 'voucher_code_ttl_hours',
  'voucher_auto_redeem', 'driver_deposit_required', 'driver_min_balance_accept', 'ppn_pct', 'ppn_inclusive', 'pph_partner_pct',
  'payout_batch_cutoffs', 'payout_fee_per_withdrawal', 'cogs_margin_target_pct');
delete from public._migration_backup_settings where version = '0114';

do $$
begin
  if to_regclass('_lokal.migrasi') is not null then execute $q$delete from _lokal.migrasi where nama like '0114\_%'$q$; end if;
  if to_regclass('supabase_migrations.schema_migrations') is not null then execute $q$delete from supabase_migrations.schema_migrations where version like '0114%'$q$; end if;
end $$;

do $$
begin
  if to_regclass('public.voucher_codes') is not null or to_regclass('public.payout_batches') is not null or to_regclass('public.city_targets') is not null
     or to_regprocedure('public.admin_set_payment_mode(text)') is not null or to_regprocedure('public.voucher_code_redeem(text)') is not null
     or position('payment_mode_require_channel' in pg_get_functiondef('public.payment_channel_require(text)'::regprocedure)) > 0
     or position('driver_deposit_require' in pg_get_functiondef('public.driver_accept_order(uuid)'::regprocedure)) > 0
     or position('tax_incl' in pg_get_functiondef('public.ledger_check(uuid)'::regprocedure)) > 0
     or position('sla_due_at' in pg_get_functiondef('public.request_withdrawal(bigint,text,text,text)'::regprocedure)) > 0
     or exists (select 1 from information_schema.columns where table_name = 'withdrawal_requests' and column_name = 'sla_due_at')
     or exists (select 1 from public.app_settings where key in ('payment_mode', 'voucher_float_limit')) then
    raise exception '0114_down gagal: objek 0114 masih ada';
  end if;
  raise notice '0114_down ok (nilai enum wallet_tx_type.voucher_redeem tetap ada — tidak bisa dicabut)';
end $$;
