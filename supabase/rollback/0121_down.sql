-- =====================================================================
-- ROLLBACK 0121_anti_order_fiktif.sql (satu transaksi: psql -1 -f)
-- Memulihkan: create_order, app_setting_specs dari _migration_backup '0121'.
-- Menghapus : fungsi baru (antifraud_*, driver_report_no_show, admin_antifraud_summary, admin_customer_strikes,
--             admin_customer_strike_clear, my_antifraud_status), tabel customer_strikes, kolom profiles.cash_blocked_until &
--             profiles.strike_count, setelan antifraud_*.
-- Catatan   : fraud_flags/notifications/order_events yang sudah tercatat DIPERTAHANKAN (jejak audit). Pelanggan yang
--             dinonaktifkan otomatis (is_active=false) TIDAK diaktifkan kembali otomatis — tinjau lewat admin.
-- =====================================================================
do $$ begin
  if not exists (select 1 from public._migration_backup where version = '0121') then
    raise exception '0121_down ditolak: tidak ada cadangan versi 0121 — 0121 belum diterapkan?';
  end if;
end $$;
select public._mig_restore('0121');
drop table if exists public.customer_strikes;
alter table public.profiles drop column if exists cash_blocked_until;
alter table public.profiles drop column if exists strike_count;
delete from public.app_settings where key in ('antifraud_new_account_hours', 'antifraud_new_account_cash_max', 'antifraud_orders_per_hour_max',
  'antifraud_active_orders_max', 'antifraud_noshow_strike_cash_block', 'antifraud_noshow_strike_suspend', 'antifraud_phone_required',
  'antifraud_noshow_wait_minutes', 'antifraud_noshow_fee', 'antifraud_cash_block_days');
