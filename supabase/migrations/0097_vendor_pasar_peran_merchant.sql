-- =====================================================================
-- 0097 — PEDAGANG PASAR (market_vendors) MENDAPAT PERAN 'merchant' SAAT DISETUJUI
--
-- MASALAH: apply_market_vendor (0018:439) dan admin_review_market_vendor (0018:507)
-- tidak pernah mengubah profiles.role. Berbeda dengan register_driver (0004:38),
-- register_merchant (0007:76) dan travel_partner_register (0011:151), pedagang pasar
-- tetap berperan 'customer'. Sejak 0090, request_withdrawal memanggil
-- withdrawal_require_allowed() yang hanya meloloskan role driver/merchant/admin
-- (withdrawal_allowed_roles, 0090:19-22) — jadi pedagang pasar yang sudah
-- 'approved' DITOLAK saat menarik pendapatannya, padahal listing Play menjanjikan
-- "cairkan pendapatan" untuk semua jenis mitra.
--
-- PERBAIKAN: sisipkan ke admin_review_market_vendor — tepat setelah baris
-- "Pedagang tidak ditemukan" — perubahan role ke 'merchant' bila p_status =
-- 'approved'. Peran 'merchant' dipilih karena: (a) ada di enum user_role
-- (0001_schema.sql:8), (b) termasuk withdrawal_allowed_roles() (0090:21),
-- (c) pedagang pasar secara bisnis = penjual, bukan pengemudi.
-- Role tidak diturunkan kembali saat rejected/suspended (konsisten dengan
-- driver/merchant: role tidak pernah dicabut otomatis; withdrawal tetap dijaga
-- saldo & status lain).
-- Pola: pg_get_functiondef + anchor-splicing (seperti 0090). Idempoten.
-- =====================================================================

-- 1) Prasyarat: enum & daftar peran penarikan memang memuat 'merchant'.
do $$
begin
  if not exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
                 where t.typname = 'user_role' and e.enumlabel = 'merchant') then
    raise exception 'enum user_role tidak memuat ''merchant'' — migrasi 0097 dibatalkan';
  end if;
  if not ('merchant' = any (withdrawal_allowed_roles())) then
    raise exception 'withdrawal_allowed_roles() tidak memuat ''merchant'' — migrasi 0097 dibatalkan';
  end if;
end $$;

-- 2) Sisipkan penetapan peran ke admin_review_market_vendor.
do $$
declare
  def text;
  anchor constant text := $a$  if not found then raise exception 'Pedagang tidak ditemukan'; end if;$a$;
  patch  constant text := $p$
  -- 0097: pedagang pasar yang disetujui mendapat peran 'merchant' agar lolos withdrawal_require_allowed (0090).
  -- Pemanggil sudah dipastikan admin di atas, sehingga guard_profile_update (0002:58) mengizinkan perubahan role.
  if p_status = 'approved' then
    update profiles set role = 'merchant' where id = p_id and role = 'customer';
  end if;$p$;
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'admin_review_market_vendor';
  if def is null then raise exception 'admin_review_market_vendor tidak ditemukan'; end if;
  if position('-- 0097' in def) > 0 then
    raise notice 'Penetapan peran vendor sudah terpasang — dilewati';
    return;
  end if;
  if position(anchor in def) = 0 then
    raise exception 'Jangkar "Pedagang tidak ditemukan" tidak ditemukan di admin_review_market_vendor — patch TIDAK terpasang';
  end if;
  execute replace(def, anchor, anchor || patch);
end $$;

-- 3) Penjaga migrasi: fungsi hasil splice benar-benar memuat marker.
do $$
declare n int;
begin
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'admin_review_market_vendor'
     and pg_get_functiondef(p.oid) like '%-- 0097%';
  if n <> 1 then raise exception 'admin_review_market_vendor tidak memuat marker 0097 — migrasi 0097 gagal'; end if;
end $$;

-- 4) Backfill idempoten: vendor yang SUDAH approved sebelum migrasi ini.
--    Dijalankan tanpa auth.uid() (migrasi), jadi guard_profile_update harus dilewati
--    lewat antaraja.bypass (pola 0007:75-77 / 0023:74). set_config is_local=true →
--    berlaku hanya di transaksi migrasi ini.
do $$
declare n int;
begin
  perform set_config('antaraja.bypass', 'on', true);
  update profiles p set role = 'merchant'
    from market_vendors v
   where v.id = p.id and v.status = 'approved' and p.role = 'customer';
  get diagnostics n = row_count;
  perform set_config('antaraja.bypass', 'off', true);
  raise notice 'Backfill 0097: % pedagang pasar approved dinaikkan ke role merchant', n;
end $$;

comment on function admin_review_market_vendor(uuid, approval_status, text) is
  'Admin menyetujui/menolak/menangguhkan pedagang pasar. Sejak 0097 status approved '
  'juga menetapkan profiles.role = ''merchant'' (bila masih customer) supaya pedagang '
  'boleh menarik saldo lewat request_withdrawal (penjaga 0090).';
