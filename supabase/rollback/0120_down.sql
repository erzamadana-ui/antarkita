-- Rollback 0120 (satu transaksi: psql -1 -f): hapus RPC aset merek (dari _mig_backup('0120', NULL)) dan tabel brand_assets.
-- Berkas fisik di public/brand/ tidak disentuh (ada di repo, bukan di database).
do $$ begin
  if not exists (select 1 from public._migration_backup where version = '0120') then
    raise exception '0120_down ditolak: tidak ada cadangan versi 0120 — 0120 belum diterapkan?';
  end if;
end $$;
select public._mig_restore('0120');
drop table if exists public.brand_assets;
