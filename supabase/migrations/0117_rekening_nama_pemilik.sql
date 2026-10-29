-- =====================================================================
-- 0117 — Nama pemilik rekening resmi dipisah dari nama badan usaha
--   Keputusan GM 29 Okt 2026: rekening BCA 0181320108 atas nama "Erza Pradipta Madana" (rekening perorangan),
--   sementara nama badan usaha (voucher_legal_entity_name) tetap dipakai untuk S&K/label.
--   • app_settings.voucher_account_holder_name = nama a.n. rekening yang WAJIB sama dengan company_bank_accounts.account_name
--     (voucher_bank_account_public_ok & admin_voucher_bank_verify_owner kini memeriksa nama pemilik, fallback nama badan usaha).
--   • Rekening BCA aktif diperbarui ke nama pemilik; verifikasi pemilik tetap berlaku (nomor tidak berubah).
--   • voucher_public_config() menambah 'account_holder'.
-- Idempoten. Rollback: supabase/rollback/0117_down.sql
-- =====================================================================
do $$ begin perform _mig_backup('0117', 'public.voucher_bank_account_public_ok(public.company_bank_accounts)');
             perform _mig_backup('0117', 'public.admin_voucher_bank_verify_owner(uuid,text)');
             perform _mig_backup('0117', 'public.voucher_public_config()');
             perform _mig_backup('0117', 'public.app_setting_specs()'); end $$;

insert into app_settings (key, value) values ('voucher_account_holder_name', '"Erza Pradipta Madana"'::jsonb)
on conflict (key) do update set value = excluded.value, updated_at = now();

create or replace function public.voucher_account_holder_name()
returns text language sql stable security definer set search_path = public as $$
  select coalesce(nullif(btrim(coalesce((select value #>> '{}' from app_settings where key = 'voucher_account_holder_name'), '')), ''),
                  (select value #>> '{}' from app_settings where key = 'voucher_legal_entity_name'));
$$;
grant execute on function public.voucher_account_holder_name() to anon, authenticated;

create or replace function public.voucher_bank_account_public_ok(b public.company_bank_accounts)
returns boolean language sql stable security definer set search_path = public as $$
  select b.active and not b.is_placeholder and coalesce(b.account_no, '') ~ '^[0-9]{8,20}$'
     and lower(trim(coalesce(b.account_name, ''))) = lower(trim(coalesce(voucher_account_holder_name(), '#')))   -- 0117: nama pemilik rekening
     and ((b.finance_verified_at is not null and b.legal_verified_at is not null and b.finance_verified_by is distinct from b.legal_verified_by)
          or b.owner_verified_at is not null);
$$;
revoke all on function public.voucher_bank_account_public_ok(public.company_bank_accounts) from public, anon, authenticated;

select _v3_splice('0117', 'public.admin_voucher_bank_verify_owner(uuid,text)',
  $a$  if lower(trim(coalesce(b.account_name, ''))) <> lower(trim(coalesce((select value #>> '{}' from app_settings where key = 'voucher_legal_entity_name'), '#'))) then
    raise exception 'Nama rekening harus sama dengan nama badan usaha (voucher_legal_entity_name)';$a$,
  $a$  if lower(trim(coalesce(b.account_name, ''))) <> lower(trim(coalesce(voucher_account_holder_name(), '#'))) then   -- 0117
    raise exception 'Nama rekening harus sama dengan nama pemilik rekening resmi (voucher_account_holder_name)';$a$,
  '0117 nama pemilik rekening');

-- voucher_public_config: tambah account_holder
select _v3_splice('0117', 'public.voucher_public_config()',
  $a$    'legal_entity', (select value #>> '{}' from app_settings where key = 'voucher_legal_entity_name'),$a$,
  $a$    'legal_entity', (select value #>> '{}' from app_settings where key = 'voucher_legal_entity_name'),
    'account_holder', voucher_account_holder_name(),   -- 0117$a$,
  '0117 account_holder');

-- Rekening BCA aktif → nama pemilik (nomor tetap; verifikasi pemilik tetap berlaku karena nomor tidak berubah)
update company_bank_accounts
   set account_name = voucher_account_holder_name(), updated_at = now()
 where bank_code = 'bca' and account_no = '0181320108' and active;

-- spesifikasi setelan: tampil di Panel Admin › Pengaturan (app_setting_specs(); pola 0114)
select _v3_splice('0117', 'public.app_setting_specs()',
  $a$    ('voucher_min_nominal',        'int',     1000, 100000000, null, '20000', 'Rp', 'UANG', 'Nominal pembelian AntarVoucher minimum', 'payment_config'),$a$,
  $a$    ('voucher_account_holder_name', 'text',   null::numeric, null::numeric, null::text[], '"Erza Pradipta Madana"'::jsonb, '', 'UANG', '0117: nama pemilik rekening resmi (a.n.) — harus sama dengan nama di company_bank_accounts', 'payment_config'),
    ('voucher_min_nominal',        'int',     1000, 100000000, null, '20000', 'Rp', 'UANG', 'Nominal pembelian AntarVoucher minimum', 'payment_config'),$a$,
  '0117 voucher_account_holder_name');

do $$ begin
  perform log_activity('voucher.bank_holder_name', 'app_settings', 'voucher_account_holder_name',
    'Nama pemilik rekening resmi ditetapkan (keputusan GM 29 Okt 2026)', jsonb_build_object('holder', voucher_account_holder_name()));
end $$;

-- penjaga
do $$ begin
  if not exists (select 1 from company_bank_accounts b where voucher_bank_account_public_ok(b)) then
    raise exception '0117 batal: tidak ada rekening yang lolos voucher_bank_account_public_ok setelah perubahan nama';
  end if;
  if position('account_holder' in pg_get_functiondef('public.voucher_public_config()'::regprocedure)) = 0 then
    raise exception '0117 batal: voucher_public_config belum memuat account_holder';
  end if;
  raise notice '0117 ok: pemilik rekening = %', voucher_account_holder_name();
end $$;
