-- =====================================================================
-- ROLLBACK 0126_potongan_per_transaksi.sql (satu transaksi: psql -1 -f)
-- Memulihkan: travel_request_create, travel_trip_set_status, travel_request_set_status, ledger_post_travel dari _migration_backup '0126'.
-- Menghapus : partner_fee_statement(date,date), partner_fee_statement_summary(date,date).
-- Catatan   : baris order_ledger tax_output travel & wallet_transactions.ref yang sudah tertulis DIPERTAHANKAN (data).
-- =====================================================================
do $$ begin
  if not exists (select 1 from public._migration_backup where version = '0126') then
    raise exception '0126_down ditolak: tidak ada cadangan versi 0126 — 0126 belum diterapkan?';
  end if;
end $$;
select public._mig_restore('0126');
