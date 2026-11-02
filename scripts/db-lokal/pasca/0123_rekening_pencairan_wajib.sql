-- =====================================================================
-- pasca/0123 — fixture LOKAL (harness db-lokal), transaksi yang sama dengan migrasi 0123.
-- Akun uji seed (cust, drv, drv2, mown, dbox) diberi rekening pencairan supaya penjaga
-- PAYOUT_ACCOUNT_REQUIRED tidak memutus simulasi_e2e/uji lain pada DB yang SUDAH di-seed
-- (saat `reset`, profil belum ada → tidak ada baris; pasca/seed.sql mengisinya setelah seed).
-- Di produksi rekening akun uji diisi lewat aplikasi (Saldo › Rekening pencairan), bukan migrasi.
-- =====================================================================
insert into public.bank_accounts (user_id, bank_name, account_no, holder, channel, bank_code, verified)
select v.uid, v.bank, v.no, v.holder, 'bank', v.code, false
  from (values ('a0000000-0000-4000-8000-000000000002'::uuid, 'BCA', '1234500002', 'Budi Santoso', 'bca'),
               ('a0000000-0000-4000-8000-000000000003'::uuid, 'BCA', '1234567890', 'Ahmad Fauzi', 'bca'),
               ('a0000000-0000-4000-8000-000000000004'::uuid, 'BRI', '1234500004', 'Rina Kartika', 'bri'),
               ('a0000000-0000-4000-8000-000000000005'::uuid, 'Bank Mandiri', '9876543210', 'Mak Syukur', 'mandiri'),
               ('a0000000-0000-4000-8000-000000000006'::uuid, 'BNI', '1234500006', 'Dedi Box', 'bni')) v(uid, bank, no, holder, code)
 where exists (select 1 from public.profiles p where p.id = v.uid)
on conflict (user_id) do nothing;
