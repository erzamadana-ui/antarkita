-- =====================================================================
-- 0085 — Produksi bersih dari data uji (persiapan publikasi Play Store, 12 Sep 2026)
--
-- Temuan: akun uji `*@antaraja.id` (kata sandi pernah tertulis di README repositori PUBLIK),
-- 8 merchant contoh tanpa pemilik (termasuk nama merek nyata), 21 promo contoh aktif, dan nama
-- gudang "Antar Aja" (merek lama) masih tampil di aplikasi publik.
--
-- Prinsip: SEMBUNYIKAN & KUNCI, bukan hapus — data ini masih dipakai skrip simulasi (S0 memulihkannya
-- di dalam transaksi yang di-ROLLBACK) dan penghapusan transaksi lama merusak buku besar.
-- Penghapusan permanen (bila diinginkan) ada di docs/rilis/reset-data-uji.sql dan dijalankan pemilik.
--
-- Yang dilakukan:
--   1. Akun uji (customer/driver/driver2/merchant @antaraja.id): profil nonaktif, login DIBLOKIR
--      (auth.users.banned_until), driver ditangguhkan & offline, mitra travel ditangguhkan.
--      Akun admin@antaraja.id TIDAK disentuh (dipakai pemilik) — kata sandinya WAJIB diganti pemilik.
--   2. Merchant contoh (owner_id NULL atau milik akun uji): status 'suspended', is_open=false.
--   3. Promo contoh: is_active=false (admin bisa mengaktifkan lagi satu per satu dari Panel Admin).
--   4. Nama gudang "Antar Aja" → "AntarKita".
-- Idempoten: aman dijalankan ulang.
-- =====================================================================
do $$
declare uji uuid[] := array['a0000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000003',
                            'a0000000-0000-4000-8000-000000000004','a0000000-0000-4000-8000-000000000005']::uuid[];
        n int;
begin
  perform set_config('antaraja.bypass', 'on', true);

  -- 1. akun uji
  update profiles set is_active = false where id = any(uji) and is_active;
  update auth.users set banned_until = '2999-12-31 23:59:59+00'
   where id = any(uji) and (banned_until is null or banned_until < now());
  update drivers set status = 'suspended', is_online = false, status_reason = coalesce(status_reason, 'Akun uji dinonaktifkan untuk produksi (0085)')
   where id = any(uji) and (status <> 'suspended' or is_online);
  update travel_partners set status = 'suspended' where id = any(uji) and status <> 'suspended';
  update market_vendors set status = 'suspended' where id = any(uji) and status <> 'suspended';

  -- 2. merchant contoh
  update merchants set status = 'suspended', is_open = false
   where (owner_id is null or owner_id = any(uji)) and (status <> 'suspended' or is_open);
  get diagnostics n = row_count;

  -- 3. promo contoh (semua promo yang ada saat migrasi ini = data contoh 3 Sep 2026)
  update promos set is_active = false where is_active;

  -- 4. merek lama
  update warehouses set name = replace(name, 'Antar Aja', 'AntarKita') where name like '%Antar Aja%';

  perform set_config('antaraja.bypass', 'off', true);
  raise notice '0085: akun uji dikunci, % merchant contoh disembunyikan, promo contoh dinonaktifkan', n;
end $$;
