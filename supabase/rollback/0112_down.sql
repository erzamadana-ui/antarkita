-- =====================================================================
-- ROLLBACK 0112_antarvoucher.sql (jalankan dalam satu transaksi: psql -1 -f)
-- Memulihkan: semua fungsi yang di-rebrand/diubah 0112 (teks "AntarPay", admin_review_topup tanpa blokir screenshot,
--             payment_channel_label, antarpay_require_enabled) dari _migration_backup; app_settings.bank_account semula.
-- Menghapus : tabel voucher_purchases, voucher_bank_mutations, company_bank_accounts; RPC voucher_*/admin_voucher_*;
--             trigger & kolom audit baru wallet_transactions; setelan 0112; jadwal cron antarvoucher-expire.
-- TIDAK dikembalikan (DATA UANG): baris wallet_transactions hasil penerbitan/refund voucher tetap ada (append-only,
--             saldo dompet sudah bergerak). Karena itu rollback penuh HANYA aman sebelum ada pembelian voucher nyata;
--             sesudahnya: matikan flag antarvoucher_purchase_enabled saja (rollback fungsional tanpa menyentuh data).
-- =====================================================================
do $$
begin
  if exists (select 1 from public.voucher_purchases where status in ('issued', 'refund_requested', 'refund_pending') and reference not like 'AKV-L-%')
     and coalesce(current_setting('antarkita.force_rollback_0112', true), '') <> 'on' then
    raise exception '0112_down ditolak: sudah ada voucher terbit. Matikan flag antarvoucher_purchase_enabled, atau set antarkita.force_rollback_0112=on bila benar-benar yakin (arsipkan tabel dulu).';
  end if;
end $$;

do $$
begin
  if to_regnamespace('cron') is not null and to_regclass('cron.job') is not null then
    perform cron.unschedule(jobid) from cron.job where jobname = 'antarvoucher-expire';
  end if;
exception when others then raise notice '0112_down: cron tidak disentuh (%)', sqlerrm;
end $$;

drop trigger if exists t_wallet_tx_append_only on public.wallet_transactions;
drop trigger if exists t_wallet_tx_before_insert on public.wallet_transactions;

select public._mig_restore('0112');

drop table if exists public.voucher_bank_mutations cascade;
drop table if exists public.voucher_purchases cascade;
drop table if exists public.company_bank_accounts cascade;

drop index if exists public.wallet_transactions_idem_uidx;
drop index if exists public.wallet_transactions_bank_ref_idx;
alter table public.wallet_transactions drop constraint if exists wallet_transactions_status_check;
alter table public.wallet_transactions
  drop column if exists balance_before, drop column if exists idempotency_key, drop column if exists bank_ref,
  drop column if exists created_by, drop column if exists approved_by, drop column if exists correction_reason,
  drop column if exists refund_ref, drop column if exists settlement_ref, drop column if exists source,
  drop column if exists status, drop column if exists seq;

update public.app_settings a set value = b.value, updated_at = now()
  from public._migration_backup_settings b where b.version = '0112' and b.key = a.key;
delete from public.app_settings where key in ('antarvoucher_purchase_enabled', 'voucher_purchase_ttl_hours', 'voucher_purchase_min',
  'voucher_purchase_max', 'voucher_max_open_per_user', 'voucher_float_cap', 'voucher_legal_entity_name', 'legacy_topup_manual_approval');
drop table if exists public._migration_backup_settings;

do $$
begin
  if to_regclass('_lokal.migrasi') is not null then execute $q$delete from _lokal.migrasi where nama like '0112\_%'$q$; end if;
  if to_regclass('supabase_migrations.schema_migrations') is not null then execute $q$delete from supabase_migrations.schema_migrations where version like '0112%'$q$; end if;
end $$;

do $$
begin
  if to_regclass('public.voucher_purchases') is not null or to_regprocedure('public.antarvoucher_enabled()') is not null
     or position('TOPUP_REQUIRE_BANK_MATCH' in pg_get_functiondef('public.admin_review_topup(uuid,boolean,text)'::regprocedure)) > 0
     or exists (select 1 from information_schema.columns where table_name = 'wallet_transactions' and column_name = 'balance_before')
     or public.payment_channel_label('antarpay') <> 'AntarPay (saldo)' then
    raise exception '0112_down gagal: objek 0112 masih ada';
  end if;
  raise notice '0112_down ok';
end $$;
