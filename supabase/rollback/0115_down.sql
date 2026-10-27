-- =====================================================================
-- ROLLBACK 0115_golive_bca_closed_loop.sql (jalankan dalam satu transaksi: psql -1 -f)
-- Memulihkan: voucher_bank_account_public_ok (syarat Finance+Legal saja), admin_unlock & exec_login (PIN salah → RAISE, perilaku
--             pra-G-06), driver_accept_order (tanpa FOR UPDATE / pagar index) dari _migration_backup; setelan app_settings
--             (antarvoucher_purchase_enabled, payment_mode, payment_channels, pg_methods, gateway_order_payment_enabled,
--             antarpay_enabled, payments_simulation_enabled) dan status aktif rekening dari _migration_backup_settings '0115'.
-- Menghapus : RPC admin_voucher_bank_verify_owner; index orders_one_active_per_driver; kolom owner_verified_*;
--             payment_mode_snapshot bila dibuat 0115; baris rekening BCA 0115 bila belum pernah dipakai pembelian/mutasi
--             (bila sudah dipakai: baris DIPERTAHANKAN nonaktif, CHECK bank_code tetap diperluas — DATA UANG).
-- Catatan   : setelah rollback, pembelian AntarVoucher tertutup kembali (tidak ada rekening lolos Finance+Legal) dan
--             lockout PIN kembali tidak efektif (G-06). Gunakan hanya bila 0115 benar-benar harus dicabut.
-- =====================================================================
do $$
begin
  if not exists (select 1 from public._migration_backup where version = '0115') then
    raise exception '0115_down ditolak: tidak ada cadangan fungsi versi 0115 (_migration_backup) — 0115 belum diterapkan?';
  end if;
end $$;

-- fungsi: yang ditambal dipulihkan, yang baru (def NULL) dihapus
select public._mig_restore('0115');

drop index if exists public.orders_one_active_per_driver;

-- setelan
update public.app_settings a set value = b.value, updated_at = now()
  from public._migration_backup_settings b
 where b.version = '0115' and b.key = a.key and b.key <> 'company_bank_accounts_active';
delete from public.app_settings where key = 'payment_mode_snapshot' and value->>'saved_by' = '0115';

-- rekening: status aktif dipulihkan; baris BCA 0115 dihapus bila belum dipakai
do $$
declare v_act jsonb := (select value from public._migration_backup_settings where version = '0115' and key = 'company_bank_accounts_active');
        r record; v_bca uuid; v_used int;
begin
  if v_act is not null then
    for r in select key::uuid as id, (value #>> '{}')::boolean as active from jsonb_each(v_act) loop
      update public.company_bank_accounts set active = r.active, updated_at = now() where id = r.id and active is distinct from r.active;
    end loop;
  end if;
  select id into v_bca from public.company_bank_accounts where bank_code = 'bca' and account_no = '0181320108';
  if v_bca is not null and (v_act is null or not (v_act ? v_bca::text)) then   -- baris dibuat 0115
    select count(*) into v_used from (
      select 1 from public.voucher_purchases where bank_account_id = v_bca
      union all select 1 from public.voucher_bank_mutations where bank_account_id = v_bca) x;
    if v_used = 0 then
      delete from public.company_bank_accounts where id = v_bca;
      raise notice '0115_down: baris rekening BCA dihapus (belum pernah dipakai)';
    else
      update public.company_bank_accounts set active = false, updated_at = now() where id = v_bca;
      raise notice '0115_down: rekening BCA sudah dipakai % pembelian/mutasi — baris dipertahankan (nonaktif)', v_used;
    end if;
  end if;
end $$;

alter table public.company_bank_accounts
  drop column if exists owner_verified_reason,
  drop column if exists owner_verified_at,
  drop column if exists owner_verified_by;

-- CHECK bank_code: dikembalikan ke daftar Himbara 0112 hanya bila tidak ada baris di luar daftar itu
do $$
begin
  if exists (select 1 from public.company_bank_accounts where bank_code not in ('bri', 'bni', 'mandiri', 'btn', 'bsi')) then
    raise notice '0115_down: masih ada rekening non-Himbara — CHECK bank_code tetap diperluas';
  else
    alter table public.company_bank_accounts drop constraint if exists company_bank_accounts_bank_code_check;
    alter table public.company_bank_accounts add constraint company_bank_accounts_bank_code_check
      check (bank_code in ('bri', 'bni', 'mandiri', 'btn', 'bsi'));
  end if;
end $$;

delete from public._migration_backup_settings where version = '0115';

do $$
begin
  if to_regclass('_lokal.migrasi') is not null then execute $q$delete from _lokal.migrasi where nama like '0115\_%'$q$; end if;
  if to_regclass('supabase_migrations.schema_migrations') is not null then execute $q$delete from supabase_migrations.schema_migrations where version like '0115%'$q$; end if;
end $$;

do $$
begin
  if to_regprocedure('public.admin_voucher_bank_verify_owner(uuid,text)') is not null
     or to_regclass('public.orders_one_active_per_driver') is not null
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'company_bank_accounts' and column_name = 'owner_verified_at')
     or position('owner_verified_at' in pg_get_functiondef('public.voucher_bank_account_public_ok(public.company_bank_accounts)'::regprocedure)) > 0
     or position('0115 G-06' in pg_get_functiondef('public.admin_unlock(text)'::regprocedure)) > 0
     or position('0115 G-06' in pg_get_functiondef('public.exec_login(text)'::regprocedure)) > 0
     or position('0115 G-07' in pg_get_functiondef('public.driver_accept_order(uuid)'::regprocedure)) > 0
     or exists (select 1 from public._migration_backup_settings where version = '0115') then
    raise exception '0115_down gagal: objek 0115 masih ada';
  end if;
  raise notice '0115_down ok (payment_mode=%, purchase_enabled=%)', payment_mode(), voucher_status_public()->>'purchase_enabled';
end $$;
