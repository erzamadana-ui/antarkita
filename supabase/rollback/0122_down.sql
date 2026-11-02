-- =====================================================================
-- ROLLBACK 0122_dispatch_penawaran_bertahap.sql (satu transaksi: psql -1 -f)
-- Memulihkan: driver_available_orders (tipe hasil lama), driver_accept_order, driver_reject_order, cancel_order, create_order,
--             app_setting_specs dari _migration_backup '0122'.
-- Menghapus : fungsi baru (dispatch_*, driver_decline_offer, driver_offer_mine, admin_dispatch_summary), cron antarkita_dispatch,
--             tabel order_offers, setelan dispatch_*.
-- Catatan   : order_rejections/fraud_flags/notifications yang dibuat dispatch DIPERTAHANKAN (jejak audit). Order yang sedang 'searching'
--             kembali ke siaran lama seketika. Jalankan 0122_down SEBELUM 0121_down bila keduanya dicabut (create_order ditambal bertingkat).
-- =====================================================================
do $$ begin
  if not exists (select 1 from public._migration_backup where version = '0122') then
    raise exception '0122_down ditolak: tidak ada cadangan versi 0122 — 0122 belum diterapkan?';
  end if;
end $$;
do $$
begin
  if to_regnamespace('cron') is not null then
    perform cron.unschedule('antarkita_dispatch');
  end if;
exception when others then raise notice '0122_down: cron antarkita_dispatch tidak dicabut (%)', sqlerrm;
end $$;
-- driver_available_orders: tipe hasil berubah → harus di-drop dulu agar definisi lama bisa dipulihkan
drop function if exists public.driver_available_orders();
select public._mig_restore('0122');
drop table if exists public.order_offers;
delete from public.app_settings where key in ('dispatch_enabled', 'dispatch_offer_seconds', 'dispatch_offer_rounds', 'dispatch_offer_radius_step_km',
  'dispatch_accept_no_move_minutes', 'dispatch_no_move_min_progress_m', 'dispatch_priority_penalty_m_per_s', 'dispatch_no_move_suspend_count', 'dispatch_offer_on_create');
