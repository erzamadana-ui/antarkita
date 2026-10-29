-- Rollback 0118 (satu transaksi: psql -1 -f): pulihkan app_setting_specs dari _mig_backup('0118'), hapus RPC KPI, tabel target, setelan.
-- Data target KPI ikut terhapus (bukan data uang; bonus yang sudah dibayar dicatat di luar sistem/penggajian).
do $$ begin
  if not exists (select 1 from public._migration_backup where version = '0118') then
    raise exception '0118_down ditolak: tidak ada cadangan versi 0118 — 0118 belum diterapkan?';
  end if;
end $$;
select public._mig_restore('0118');
drop table if exists public.city_manager_kpi_targets;
delete from public.app_settings where key = 'kpi_bonus_default_pool';
