-- =====================================================================
-- ROLLBACK 0119_payout_3_sesi.sql (satu transaksi: psql -1 -f)
-- Memulihkan: admin_payout_batch_create, admin_payout_batch_settle, request_withdrawal, app_setting_specs dari _migration_backup '0119';
--             payout_batch_cutoffs dari _migration_backup_settings '0119'.
-- Menghapus : fungsi baru (payout_batch_create_internal, payout_batch_auto, admin_payout_sessions, admin_payout_batch_create_now,
--             admin_payout_batch_export_bca, payout_cutoffs), cron antarkita_payout_batch_auto, tabel payout_sessions & bank_codes,
--             setelan payout_auto_batch_enabled & payout_min_amount.
-- Catatan   : payout_batches yang sudah dibuat sesi otomatis DIPERTAHANKAN (data uang; tetap bisa di-settle lewat admin_payout_batch_settle).
-- =====================================================================
do $$ begin
  if not exists (select 1 from public._migration_backup where version = '0119') then
    raise exception '0119_down ditolak: tidak ada cadangan versi 0119 — 0119 belum diterapkan?';
  end if;
end $$;
select public._mig_restore('0119');
do $$
begin
  if to_regnamespace('cron') is not null then
    perform cron.unschedule('antarkita_payout_batch_auto');
  end if;
exception when others then raise notice '0119_down: cron antarkita_payout_batch_auto tidak dicabut (%)', sqlerrm;
end $$;
drop table if exists public.payout_sessions;
drop table if exists public.bank_codes;
update public.app_settings a set value = b.value, updated_at = now()
  from public._migration_backup_settings b where b.version = '0119' and b.key = a.key and b.value is not null;
delete from public._migration_backup_settings where version = '0119';
delete from public.app_settings where key in ('payout_auto_batch_enabled', 'payout_min_amount');
