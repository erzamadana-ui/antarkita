-- Rollback 0117: pulihkan fungsi dari cadangan _mig_backup('0117'), kembalikan nama rekening ke nama badan usaha, hapus setelan.
select _mig_restore('0117');
update company_bank_accounts set account_name = (select value #>> '{}' from app_settings where key = 'voucher_legal_entity_name'), updated_at = now()
 where bank_code = 'bca' and account_no = '0181320108';
delete from app_settings where key = 'voucher_account_holder_name';
drop function if exists public.voucher_account_holder_name();
