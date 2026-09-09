-- =====================================================================
-- 0070_qc_kunci_grant_fungsi_admin_peta.sql
--
-- TEMUAN QC (advisor keamanan, sesudah migrasi 0061):
--   Tiga fungsi admin peta yang dibuat migrasi 0061 masih bisa DIPANGGIL
--   oleh peran `anon` (pengunjung yang belum masuk):
--     • admin_map_status()
--     • admin_set_map_config(jsonb)
--     • admin_map_probe_urls(double precision, double precision)
--   ditambah cache_address(...) yang sebenarnya hanya diperuntukkan bagi
--   pengguna yang sudah masuk.
--
-- SEBABNYA: PostgreSQL memberi EXECUTE kepada PUBLIC secara BAWAAN pada setiap
-- fungsi baru. Migrasi 0061 sudah menulis `grant execute … to authenticated`,
-- tetapi TIDAK PERNAH mencabut hak bawaan PUBLIC itu — sehingga `anon` ikut
-- mewarisinya lewat PUBLIC. Seluruh fungsi admin lain di proyek ini sudah
-- dikunci dengan pola `revoke execute … from public, anon`
-- (lihat 0032_qc_hardening_grants_searchpath.sql:43-53).
--   Terbukti: dari 61 fungsi `admin_*`, HANYA ketiga fungsi peta ini yang
--   masih dapat dieksekusi `anon`.
--
-- DAMPAK: berlapis, bukan kebocoran langsung. Ketiga fungsi tetap memeriksa
-- is_admin() di dalam badannya dan menolak non-admin (dibuktikan
-- supabase/tests/uji_peta.sql bagian 6a/6b/6c). Namun admin_map_probe_urls()
-- MENGEMBALIKAN URL yang memuat kunci penyedia peta, jadi pemeriksaan internal
-- itu adalah satu-satunya penghalang. Mengembalikan pola dua lapis
-- (hak eksekusi + pemeriksaan is_admin) menutup risiko bila salah satu lapis
-- kelak berubah.
--
-- Tidak ada perubahan perilaku untuk aplikasi: Panel Admin selalu memanggil
-- ketiga fungsi ini sebagai pengguna yang sudah masuk (authenticated).
--
-- SENGAJA TIDAK DIUBAH (memang harus terbuka untuk anon):
--   • map_public_config()  — dibaca aplikasi SEBELUM pengguna masuk; tanpa ini
--                            peta akan kosong di layar login/registrasi.
--   • resolve_address(...) — pembacaan cache alamat, dipakai sebelum masuk.
-- =====================================================================

revoke execute on function admin_map_status()                                  from public, anon;
revoke execute on function admin_set_map_config(jsonb)                         from public, anon;
revoke execute on function admin_map_probe_urls(double precision, double precision) from public, anon;
revoke execute on function cache_address(double precision, double precision, text, text) from public, anon;

-- Pastikan pemakai sah tetap punya hak (revoke di atas juga mencabut lewat PUBLIC).
grant execute on function admin_map_status()                                   to authenticated;
grant execute on function admin_set_map_config(jsonb)                          to authenticated;
grant execute on function admin_map_probe_urls(double precision, double precision) to authenticated;
grant execute on function cache_address(double precision, double precision, text, text) to authenticated;

-- Penjaga: gagalkan migrasi bila masih ada fungsi admin peta yang bisa dipanggil anon.
do $$
declare n int;
begin
  select count(*) into n
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public'
    and p.proname in ('admin_map_status','admin_set_map_config','admin_map_probe_urls','cache_address')
    and has_function_privilege('anon', p.oid, 'EXECUTE');
  if n > 0 then
    raise exception '0070 gagal: masih ada % fungsi admin peta yang dapat dieksekusi anon', n;
  end if;
end $$;
