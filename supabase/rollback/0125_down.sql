-- =====================================================================
-- ROLLBACK 0125_manager_kota_data.sql (satu transaksi: psql -1 -f)
-- Memulihkan: app_setting_specs dari _migration_backup '0125'.
-- Menghapus : fungsi baru (city_managers_sync_city, admin_city_managers, admin_set_city_manager_profile, admin_city_manager_delete,
--             admin_kpi_target_templates, admin_set_kpi_target_template, admin_kpi_apply_template), trigger t_city_managers_sync,
--             tabel city_managers & kpi_target_templates, setelan city_manager_salary_default.
-- Catatan   : cities.manager_id yang sudah disinkronkan DIPERTAHANKAN; target di city_manager_kpi_targets hasil apply_template DIPERTAHANKAN (0118).
-- =====================================================================
do $$ begin
  if not exists (select 1 from public._migration_backup where version = '0125') then
    raise exception '0125_down ditolak: tidak ada cadangan versi 0125 — 0125 belum diterapkan?';
  end if;
end $$;
drop trigger if exists t_city_managers_sync on public.city_managers;
select public._mig_restore('0125');
drop table if exists public.city_managers;
drop table if exists public.kpi_target_templates;
delete from public.app_settings where key = 'city_manager_salary_default';
