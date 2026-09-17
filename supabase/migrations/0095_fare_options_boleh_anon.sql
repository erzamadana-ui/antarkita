-- 0095: fare_options boleh dipanggil anon.
--
-- Gejala (dilaporkan 17 Sep 2026, APK Android): di AntarRide/AntarCar/AntarBox, daftar
-- kelas kendaraan kosong, kotak tarif tidak muncul, dan TOMBOL PESAN hilang sama sekali.
-- Jarak & rute tetap tampil, jadi jaringan dan geocoding baik-baik saja.
--
-- Temuan: estimate_fare, resolve_address dan city_service_status sudah di-grant ke anon,
-- tetapi fare_options hanya ke authenticated. Panggilan yang sampai ke server sebagai anon
-- (mis. saat token sesi sedang disegarkan) ditolak 42501 "permission denied for function
-- fare_options". Klien menelan galat itu diam-diam (.catch(() => null)) sehingga layar
-- terlihat buntu tanpa penjelasan.
-- Bukti: tabel lookup_rate tidak punya satu pun baris kind='estimate_fare' untuk pengguna
-- yang mengalami gejala, padahal ada baris kind='resolve_address' pada jam yang sama —
-- artinya fare_options memang tidak pernah dieksekusi, bukan gagal di tengah jalan.
--
-- Kenapa aman: fare_options hanya menghitung harga dari tabel tarif + menghitung jumlah
-- driver online di sekitar. Tidak ada data pribadi, tidak menulis apa pun, dan kalkulator
-- intinya (estimate_fare) sudah terbuka untuk anon sejak awal. Pembuatan order tetap
-- tertutup (create_order butuh auth.uid()).
--
-- Perbaikan sisi klien menyertai migrasi ini: tombol pesan sekarang SELALU tampil begitu
-- titik jemput & tujuan terisi; bila tarif gagal dimuat, tombolnya berubah jadi
-- "Coba lagi" dan pesan galat aslinya ditampilkan, tidak lagi ditelan diam-diam.
grant execute on function public.fare_options(service_type, double precision, double precision, double precision, double precision, numeric, integer) to anon;

do $$
declare v_acl text;
begin
  select array_to_string(p.proacl::text[], ',') into v_acl
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fare_options';
  if v_acl not like '%anon=%' then
    raise exception '0095 batal: fare_options masih belum boleh dipanggil anon (acl=%)', v_acl;
  end if;
  if v_acl not like '%authenticated=%' then
    raise exception '0095 batal: grant authenticated pada fare_options hilang (acl=%)', v_acl;
  end if;
end $$;
