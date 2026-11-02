-- =====================================================================
-- ROLLBACK 0123_rekening_pencairan_wajib.sql (satu transaksi: psql -1 -f)
-- Memulihkan: driver_set_online, register_driver, travel_partner_register, guard_merchant_update, request_withdrawal,
--             payout_batch_auto, admin_payout_batch_export_bca, app_setting_specs dari _migration_backup '0123'.
-- Menghapus : fungsi baru (payout_account_require, payout_account_upsert_internal, partner_payout_account_set/mine, merchant_set_open,
--             payout_auto_sweep, payout_provider_enqueue/dispatch, admin_partner_payout_accounts/verify, admin_payout_provider_jobs),
--             cron antarkita_payout_provider_dispatch, view partner_payout_accounts, tabel payout_provider_jobs, kode e-wallet di bank_codes,
--             setelan payout_account_required / payout_auto_sweep_enabled / payout_sweep_driver_reserve / payout_provider.
-- Catatan   : kolom tambahan bank_accounts (id, channel, bank_code, auto_sweep, created_at) dan withdrawal_requests.source DIPERTAHANKAN
--             (data; tidak mengganggu fungsi lama). withdrawal_requests source 'auto_sweep' yang sudah dibuat tetap (data uang).
-- =====================================================================
do $$ begin
  if not exists (select 1 from public._migration_backup where version = '0123') then
    raise exception '0123_down ditolak: tidak ada cadangan versi 0123 — 0123 belum diterapkan?';
  end if;
end $$;
select public._mig_restore('0123');
do $$
begin
  if to_regnamespace('cron') is not null then
    perform cron.unschedule('antarkita_payout_provider_dispatch');
  end if;
exception when others then raise notice '0123_down: cron antarkita_payout_provider_dispatch tidak dicabut (%)', sqlerrm;
end $$;
drop view if exists public.partner_payout_accounts;
drop table if exists public.payout_provider_jobs;
-- bank_code e-wallet pada bank_accounts dilepas dulu agar baris bank_codes bisa dihapus (FK)
update public.bank_accounts set bank_code = null where bank_code in ('dana', 'ovo', 'linkaja', 'gopay', 'shopeepay');
delete from public.bank_codes where code in ('dana', 'ovo', 'linkaja', 'gopay', 'shopeepay');
delete from public.app_settings where key in ('payout_account_required', 'payout_auto_sweep_enabled', 'payout_sweep_driver_reserve', 'payout_provider');
