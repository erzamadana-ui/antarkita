-- 0096: shopping_estimate boleh dipanggil anon + fare_options tidak membocorkan jumlah driver ke anon.
--
-- (a) shopping_estimate → anon.
--     Bug kelas yang sama dengan 0095 (fare_options). Layar AntarShop/AntarMarket memanggil
--     shopping_estimate dari klien lalu menelan galatnya diam-diam (.catch(() => null)).
--     Saat panggilan sampai ke server sebagai anon (mis. token sesi sedang disegarkan),
--     42501 "permission denied for function shopping_estimate" membuat kotak tarif kosong dan
--     tombol pesan tidak muncul, tanpa pesan apa pun bagi pelanggan. Fungsi ini hanya
--     menghitung ongkir + biaya jasa dari tabel tarif (memanggil estimate_fare yang sudah
--     terbuka untuk anon sejak awal), tidak menulis, tidak membaca data pribadi. Pembuatan
--     order tetap tertutup (create_order butuh auth.uid()).
--
-- (b) fare_options: 'drivers_nearby' hanya untuk pengguna masuk.
--     Sejak 0095 fare_options bisa dipanggil anon. Kunci drivers_nearby menghitung driver
--     online dalam radius 6 km dari titik jemput. Siapa pun tanpa akun bisa memanggilnya
--     berulang dengan titik jemput berbeda dan, dari perubahan hitungan, menriangulasi posisi
--     driver. Sekarang anon menerima drivers_nearby = null; pengguna masuk tetap melihat
--     angkanya seperti sebelumnya. Disisipkan lewat pg_get_functiondef + replace pada jangkar
--     (pola 0089/0090) supaya definisi fare_options terbaru — apa pun versinya — tidak
--     ditulis ulang dari nol.
--
-- (c) fare_options ditandai VOLATILE: ia memanggil estimate_fare yang sudah VOLATILE sejak
--     0087 (rate_take menulis ke lookup_rate); STABLE pada pemanggil adalah janji yang salah.
--
-- (d) Penjaga di akhir: migrasi batal bila salah satu perubahan tidak benar-benar terpasang.

-- ---------- (a) shopping_estimate boleh dipanggil anon ----------
grant execute on function public.shopping_estimate(service_type, double precision, double precision, double precision, double precision, bigint, text, numeric) to anon;

-- ---------- (b) drivers_nearby = null untuk anon (sisip pada jangkar) ----------
do $$
declare
  def text;
  -- awal subkueri hitung driver
  anchor1 constant text := $a$'drivers_nearby', (select count(*) from drivers d$a$;
  ganti1  constant text := $a$'drivers_nearby', case when auth.uid() is null then null else (select count(*) from drivers d$a$;
  -- akhir subkueri (radius 6 km) — komentar penanda di ujung baris agar migrasi ini idempoten
  anchor2 constant text := $a$, 6000))$a$;
  ganti2  constant text := $a$, 6000)) end   -- 0096: anon tidak melihat jumlah driver$a$;
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fare_options';
  if def is null then raise exception '0096 batal: fare_options tidak ditemukan'; end if;
  if position('-- 0096' in def) > 0 or position('auth.uid() is null then null' in def) > 0 then
    raise notice '0096: penjaga drivers_nearby sudah terpasang — dilewati';
    return;
  end if;
  if position(anchor1 in def) = 0 then
    raise exception '0096 batal: jangkar awal drivers_nearby tidak ditemukan di fare_options — penjaga TIDAK terpasang';
  end if;
  if position(anchor2 in def) = 0 then
    raise exception '0096 batal: jangkar akhir (radius 6000) tidak ditemukan di fare_options — penjaga TIDAK terpasang';
  end if;
  -- kedua jangkar harus muncul tepat sekali, supaya replace tidak mengenai tempat lain
  if (length(def) - length(replace(def, anchor1, ''))) / length(anchor1) <> 1
     or (length(def) - length(replace(def, anchor2, ''))) / length(anchor2) <> 1 then
    raise exception '0096 batal: jangkar fare_options tidak unik — definisi berubah, periksa ulang';
  end if;
  execute replace(replace(def, anchor1, ganti1), anchor2, ganti2);
end $$;

-- ---------- (c) volatile: mengikuti estimate_fare ----------
alter function public.fare_options(service_type, double precision, double precision, double precision, double precision, numeric, integer) volatile;

comment on function public.fare_options(service_type, double precision, double precision, double precision, double precision, numeric, integer) is
  'Estimasi tarif per kelas kendaraan (+ pembantu untuk AntarBox). Boleh dipanggil anon sejak 0095. '
  'Sejak 0096 drivers_nearby = null untuk anon (mencegah triangulasi posisi driver); '
  'VOLATILE karena memanggil estimate_fare yang menulis rate-limit.';

-- ---------- (d) Penjaga migrasi ----------
do $$
declare def text; vol "char";
begin
  if not has_function_privilege('anon',
       'public.shopping_estimate(service_type,double precision,double precision,double precision,double precision,bigint,text,numeric)', 'EXECUTE') then
    raise exception '0096 batal: shopping_estimate masih belum boleh dipanggil anon';
  end if;
  select pg_get_functiondef(p.oid), p.provolatile into def, vol
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fare_options';
  if position('auth.uid() is null then null' in def) = 0 then
    raise exception '0096 batal: fare_options masih menghitung drivers_nearby untuk anon';
  end if;
  if vol <> 'v' then
    raise exception '0096 batal: fare_options belum VOLATILE (provolatile=%)', vol;
  end if;
  if not has_function_privilege('anon',
       'public.fare_options(service_type,double precision,double precision,double precision,double precision,numeric,integer)', 'EXECUTE') then
    raise exception '0096 batal: grant anon pada fare_options (0095) hilang setelah replace';
  end if;
  raise notice '0096 ok: shopping_estimate → anon; fare_options drivers_nearby=null untuk anon; fare_options VOLATILE';
end $$;
