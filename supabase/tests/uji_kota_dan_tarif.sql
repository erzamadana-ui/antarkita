-- =====================================================================
-- uji_kota_dan_tarif.sql — Uji dataset kota Indonesia (migrasi 0091–0094)
--                          dan hak akses tarif/penarikan/saluran bayar (0089, 0090, 0095, 0096)
--
-- Yang dibuktikan:
--   1. Dataset kota lengkap: >= 520 baris, tepat 4 kota 'aktif' (Batam, Dumai,
--      Padang, Pekanbaru), >= 500 kota 'segera', dan tidak ada kota aktif tanpa
--      koordinat.
--   2. city_at_point() memilih kota yang benar untuk enam titik uji dari Sumatera
--      sampai Papua (nama sesuai penamaan Kepmendagri: 'Kota …' / 'Kabupaten …').
--   3. Koreksi dataset ikut masuk: 'Kabupaten Ogan Komering Ilir' (bukan 'Komering
--      Ilir'), bujur Kabupaten Wakatobi 123.5 (bukan 23.5), dan nama panjang
--      Yogyakarta/Cirebon/Bandung setelah perapian 0094.
--   4. fare_options boleh dipanggil anon DAN authenticated (0095) — tanpa ini daftar
--      kelas kendaraan & tombol pesan hilang di aplikasi saat token sesi disegarkan.
--   5. fare_options untuk AntarRide di Batam mengembalikan >= 3 kelas dan
--      service_enabled = true.
--   6. withdrawal_allowed_roles() hanya mitra (driver, merchant, admin); customer
--      tidak boleh menarik saldo (0090).
--   7. payment_gateway_channel_keys() memuat saluran gateway (gopay, ovo, dana,
--      shopeepay, qris) (0089).
--   8. fare_options yang dipanggil anon TIDAK membocorkan drivers_nearby (null) —
--      tanpa ini posisi driver bisa ditriangulasi tanpa akun (0096).
--   9. shopping_estimate boleh dipanggil anon (0096) — bug kelas yang sama dengan
--      0095 untuk AntarShop/AntarMarket.
--
-- Sifat uji: HANYA MEMBACA. Tidak ada INSERT/UPDATE/DELETE; satu-satunya
-- perubahan adalah set_config(..., true) yang bersifat lokal transaksi dan
-- hilang begitu blok selesai. Tidak perlu service_role: cukup peran postgres
-- bawaan SQL editor Supabase (atau pemilik basis data lewat psql). Karena
-- auth.uid() null dalam sesi ini, estimate_fare tidak menulis ke lookup_rate.
--
-- Cara pakai:
--   a) SQL editor Supabase: tempel seluruh isi berkas ini lalu Run. Blok yang
--      lulus mencetak "[OK] …" di panel pesan; kegagalan memunculkan galat
--      "[GAGAL] …" dan menghentikan eksekusi. Baris SELECT terakhir menampilkan
--      ringkasan angka agar tetap ada hasil tabel di editor.
--   b) psql:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/uji_kota_dan_tarif.sql
--
-- Konvensi mengikuti supabase/tests/simulasi_e2e.sql & uji_kota.sql:
-- blok DO $$ … RAISE EXCEPTION '[GAGAL] …' bila gagal, RAISE NOTICE '[OK] …' bila lulus.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Jumlah & status kota
-- ---------------------------------------------------------------------
do $$
declare
  v_total int; v_aktif int; v_segera int; v_tanpa_lokasi int;
  v_nama_aktif text;
begin
  select count(*) into v_total from cities;
  if v_total < 520 then
    raise exception '[GAGAL] 1a. Jumlah kota hanya % (harus >= 520) — dataset Kepmendagri (0091–0093) belum masuk?', v_total;
  end if;
  raise notice '[OK] 1a. Jumlah kota = % (>= 520)', v_total;

  select count(*), string_agg(name, ', ' order by name) into v_aktif, v_nama_aktif
    from cities where service_status = 'aktif';
  if v_aktif <> 4 then
    raise exception '[GAGAL] 1b. Kota aktif = % (harus tepat 4): %', v_aktif, coalesce(v_nama_aktif, '-');
  end if;
  if v_nama_aktif <> 'Batam, Dumai, Padang, Pekanbaru' then
    raise exception '[GAGAL] 1b. Kota aktif bukan Batam, Dumai, Padang, Pekanbaru melainkan: %', v_nama_aktif;
  end if;
  raise notice '[OK] 1b. Tepat 4 kota aktif: %', v_nama_aktif;

  select count(*) into v_segera from cities where service_status = 'segera';
  if v_segera < 500 then
    raise exception '[GAGAL] 1c. Kota berstatus segera hanya % (harus >= 500)', v_segera;
  end if;
  raise notice '[OK] 1c. Kota berstatus segera = % (>= 500)', v_segera;

  -- kota tanpa koordinat tetapi active=true akan membuat city_at_point()/nearest_city() melewatkannya diam-diam
  select count(*) into v_tanpa_lokasi from cities where active and location is null;
  if v_tanpa_lokasi <> 0 then
    raise exception '[GAGAL] 1d. Ada % kota active=true tanpa koordinat (location null)', v_tanpa_lokasi;
  end if;
  raise notice '[OK] 1d. Tidak ada kota aktif (active=true) tanpa koordinat';
end $$;

-- ---------------------------------------------------------------------
-- 2. city_at_point() untuk enam titik uji (Sumatera → Jawa → Papua)
-- ---------------------------------------------------------------------
do $$
declare
  r record;
  v_nama text; v_status text;
  -- (label, lat, lng, nama kota yang diharapkan)
  titik text[][] := array[
    ['Batam',          '1.0456',  '104.0305', 'Batam'],
    ['Pekanbaru',      '0.5071',  '101.4478', 'Pekanbaru'],
    ['Surabaya',       '-7.2589', '112.7470', 'Kota Surabaya'],
    ['Jakarta Pusat',  '-6.1729', '106.8187', 'Kota Administrasi Jakarta Pusat'],
    ['Bandung',        '-6.9107', '107.6099', 'Kota Bandung'],
    ['Jayapura',       '-2.5626', '140.6926', 'Kota Jayapura']
  ];
  i int;
begin
  for i in 1 .. array_length(titik, 1) loop
    v_nama := null; v_status := null;
    select c.name, c.service_status into v_nama, v_status
      from city_at_point(titik[i][2]::double precision, titik[i][3]::double precision) c
     limit 1;
    if v_nama is null then
      raise exception '[GAGAL] 2. city_at_point(%, %) untuk % tidak menemukan kota apa pun', titik[i][2], titik[i][3], titik[i][1];
    end if;
    if v_nama <> titik[i][4] then
      raise exception '[GAGAL] 2. city_at_point untuk % memilih "%" (harus "%")', titik[i][1], v_nama, titik[i][4];
    end if;
    raise notice '[OK] 2%. city_at_point(%, %) → "%" (status %)', chr(96 + i), titik[i][2], titik[i][3], v_nama, v_status;
  end loop;

  -- Batam adalah kota operasi: statusnya harus 'aktif', bukan sekadar terdaftar
  select c.service_status into v_status from city_at_point(1.0456, 104.0305) c limit 1;
  if v_status <> 'aktif' then
    raise exception '[GAGAL] 2g. Batam terdeteksi tetapi status "%" (harus aktif)', v_status;
  end if;
  raise notice '[OK] 2g. Batam berstatus aktif';
end $$;

-- ---------------------------------------------------------------------
-- 3. Nama-nama hasil koreksi & perapian dataset (0091–0094)
-- ---------------------------------------------------------------------
do $$
declare
  v_lng double precision; v_nama text; v_hilang text;
begin
  -- nama yang wajib ada setelah koreksi/perapian
  select string_agg(x.nama, ', ') into v_hilang
    from (values ('Kabupaten Ogan Komering Ilir'), ('Kabupaten Wakatobi'), ('Kota Yogyakarta'),
                 ('Kota Cirebon'), ('Kabupaten Bandung'), ('Kabupaten Cirebon')) x(nama)
   where not exists (select 1 from cities c where c.name = x.nama);
  if v_hilang is not null then
    raise exception '[GAGAL] 3a. Nama kota berikut tidak ditemukan: %', v_hilang;
  end if;
  raise notice '[OK] 3a. Semua nama hasil koreksi/perapian ada (OKI, Wakatobi, Yogyakarta, Cirebon, Bandung)';

  -- koreksi bujur Wakatobi: sumber mentah menulis 23.5389, yang benar 123.5389
  select st_x(location::geometry) into v_lng from cities where name = 'Kabupaten Wakatobi' limit 1;
  if v_lng is null or v_lng < 123 or v_lng > 124 then
    raise exception '[GAGAL] 3b. Bujur Kabupaten Wakatobi = % (harus antara 123 dan 124) — koreksi dataset hilang', v_lng;
  end if;
  raise notice '[OK] 3b. Bujur Kabupaten Wakatobi = % (koreksi 23.5 → 123.5 masuk)', round(v_lng::numeric, 4);

  -- nama salah dari dataset sumber ('Kabupaten Ogan Komering', tanpa "Ilir") tidak boleh ikut masuk,
  -- dan baris OSM yang diarsipkan 0094 tidak boleh lagi memakai nama resmi yang pendek
  select string_agg(name, ', ') into v_nama from cities
   where name in ('Kabupaten Ogan Komering', 'Bandung', 'Cirebon', 'Yogyakarta') and source = 'osm';
  if v_nama is not null then
    raise exception '[GAGAL] 3c. Nama salah/arsip OSM masih memakai nama resmi: %', v_nama;
  end if;
  if exists (select 1 from cities where name = 'Kabupaten Ogan Komering') then
    raise exception '[GAGAL] 3c. Nama salah dari sumber mentah "Kabupaten Ogan Komering" ikut masuk';
  end if;
  raise notice '[OK] 3c. Nama salah "Kabupaten Ogan Komering" tidak ada & arsip OSM (0094) tidak memakai nama resmi pendek';
end $$;

-- ---------------------------------------------------------------------
-- 4. ACL fare_options: anon DAN authenticated boleh EXECUTE (0095)
-- ---------------------------------------------------------------------
do $$
declare
  sig constant text := 'public.fare_options(service_type,double precision,double precision,double precision,double precision,numeric,integer)';
begin
  if not has_function_privilege('anon', sig, 'EXECUTE') then
    raise exception '[GAGAL] 4a. anon TIDAK boleh memanggil fare_options — daftar kelas & tombol pesan akan hilang saat token disegarkan (lihat 0095)';
  end if;
  raise notice '[OK] 4a. anon boleh memanggil fare_options';

  if not has_function_privilege('authenticated', sig, 'EXECUTE') then
    raise exception '[GAGAL] 4b. authenticated TIDAK boleh memanggil fare_options';
  end if;
  raise notice '[OK] 4b. authenticated boleh memanggil fare_options';
end $$;

-- ---------------------------------------------------------------------
-- 5. fare_options AntarRide di Batam: >= 3 kelas & layanan aktif
-- ---------------------------------------------------------------------
do $$
declare j jsonb; n int;
begin
  -- tiru sesi anon (lokal blok ini saja); auth.uid() tetap null sehingga tidak ada tulisan rate-limit
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);

  j := fare_options('ride_motor', 0.9930, 104.0095, 1.02, 104.03, 3.6, 0);
  if j is null or jsonb_typeof(j) <> 'object' then
    raise exception '[GAGAL] 5a. fare_options tidak mengembalikan objek jsonb: %', j;
  end if;
  if jsonb_typeof(j->'classes') <> 'array' then
    raise exception '[GAGAL] 5a. Kunci classes bukan array: %', j->'classes';
  end if;
  n := jsonb_array_length(j->'classes');
  if n < 3 then
    raise exception '[GAGAL] 5a. Kelas kendaraan ride_motor hanya % (harus >= 3): %', n, j->'classes';
  end if;
  raise notice '[OK] 5a. fare_options ride_motor Batam: % kelas (%), jarak % km, tarif dasar %',
    n, (select string_agg(c->>'code', ',') from jsonb_array_elements(j->'classes') c), j->>'distance_km', j->>'fare';

  if coalesce((j->>'service_enabled')::boolean, false) is not true then
    raise exception '[GAGAL] 5b. service_enabled = % (harus true) — AntarRide sedang dimatikan admin?', j->>'service_enabled';
  end if;
  raise notice '[OK] 5b. service_enabled = true';
end $$;

-- ---------------------------------------------------------------------
-- 6. withdrawal_allowed_roles(): hanya mitra (0090)
-- ---------------------------------------------------------------------
do $$
declare peran text[];
begin
  peran := withdrawal_allowed_roles();
  if not (peran @> array['driver', 'merchant', 'admin']) then
    raise exception '[GAGAL] 6a. withdrawal_allowed_roles() = % — driver/merchant/admin harus ada', peran;
  end if;
  raise notice '[OK] 6a. withdrawal_allowed_roles() memuat driver, merchant, admin';

  if 'customer' = any (peran) then
    raise exception '[GAGAL] 6b. customer BISA menarik saldo: %', peran;
  end if;
  raise notice '[OK] 6b. customer tidak termasuk peran yang boleh menarik saldo (%)', array_to_string(peran, ',');
end $$;

-- ---------------------------------------------------------------------
-- 7. payment_gateway_channel_keys(): saluran gateway (0089)
-- ---------------------------------------------------------------------
do $$
declare kunci text[]; v_hilang text;
begin
  if to_regprocedure('public.payment_gateway_channel_keys()') is null then
    raise exception '[GAGAL] 7a. Fungsi payment_gateway_channel_keys() tidak ada';
  end if;
  raise notice '[OK] 7a. Fungsi payment_gateway_channel_keys() ada';

  kunci := payment_gateway_channel_keys();
  select string_agg(x.k, ', ') into v_hilang
    from unnest(array['gopay', 'ovo', 'dana', 'shopeepay', 'qris']) x(k)
   where not (x.k = any (kunci));
  if v_hilang is not null then
    raise exception '[GAGAL] 7b. Saluran gateway hilang: % (isi sekarang: %)', v_hilang, kunci;
  end if;
  raise notice '[OK] 7b. payment_gateway_channel_keys() = %', array_to_string(kunci, ',');
end $$;

-- ---------------------------------------------------------------------
-- 8. Anon memanggil fare_options → drivers_nearby harus NULL (0096)
--    Pemanggil tanpa akun tidak boleh bisa menriangulasi posisi driver dari
--    perubahan hitungan driver di sekitar titik jemput.
-- ---------------------------------------------------------------------
do $$
declare j jsonb; n_bocor int; n_kelas int;
begin
  -- tiru sesi anon: tidak ada 'sub' → auth.uid() null (lokal blok ini saja)
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  if auth.uid() is not null then
    raise exception '[GAGAL] 8. auth.uid() tidak null dalam sesi uji anon — uji tidak sahih';
  end if;

  j := fare_options('ride_motor', 0.9930, 104.0095, 1.02, 104.03, 3.6, 0);
  n_kelas := jsonb_array_length(j->'classes');
  if n_kelas = 0 then
    raise exception '[GAGAL] 8. fare_options tidak mengembalikan kelas — tidak ada yang bisa diperiksa';
  end if;
  -- kunci drivers_nearby harus ADA (kontrak klien tetap) tetapi bernilai null untuk anon
  select count(*) into n_bocor from jsonb_array_elements(j->'classes') c
   where not (c ? 'drivers_nearby') or jsonb_typeof(c->'drivers_nearby') <> 'null';
  if n_bocor <> 0 then
    raise exception '[GAGAL] 8. drivers_nearby BOCOR ke anon pada % dari % kelas: %', n_bocor, n_kelas,
      (select string_agg(c->>'code' || '=' || coalesce(c->>'drivers_nearby', 'null'), ',') from jsonb_array_elements(j->'classes') c);
  end if;
  raise notice '[OK] 8. drivers_nearby = null untuk anon pada semua % kelas (tarif tetap terisi: %)', n_kelas, j->>'fare';

  -- definisi fungsinya sendiri memuat penjaga (bukan kebetulan tidak ada driver online)
  if position('auth.uid() is null then null' in (select pg_get_functiondef(p.oid) from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'fare_options')) = 0 then
    raise exception '[GAGAL] 8. Definisi fare_options tidak memuat penjaga anon (0096) — null di atas hanya kebetulan';
  end if;
  raise notice '[OK] 8b. Definisi fare_options memuat penjaga "auth.uid() is null then null"';
end $$;

-- ---------------------------------------------------------------------
-- 9. ACL shopping_estimate: anon boleh EXECUTE (0096)
-- ---------------------------------------------------------------------
do $$
declare
  sig constant text := 'public.shopping_estimate(service_type,double precision,double precision,double precision,double precision,bigint,text,numeric)';
begin
  if to_regprocedure(sig) is null then
    raise exception '[GAGAL] 9. Fungsi shopping_estimate dengan tanda tangan % tidak ada', sig;
  end if;
  if not has_function_privilege('anon', sig, 'EXECUTE') then
    raise exception '[GAGAL] 9a. anon TIDAK boleh memanggil shopping_estimate — kotak tarif AntarShop/AntarMarket kosong saat token disegarkan (lihat 0096)';
  end if;
  raise notice '[OK] 9a. anon boleh memanggil shopping_estimate';
  if not has_function_privilege('authenticated', sig, 'EXECUTE') then
    raise exception '[GAGAL] 9b. authenticated TIDAK boleh memanggil shopping_estimate';
  end if;
  raise notice '[OK] 9b. authenticated boleh memanggil shopping_estimate';
end $$;

-- ---------------------------------------------------------------------
-- Ringkasan (hanya membaca) — supaya SQL editor tetap menampilkan hasil tabel
-- ---------------------------------------------------------------------
select
  (select count(*) from cities)                                   as total_kota,
  (select count(*) from cities where service_status = 'aktif')    as kota_aktif,
  (select count(*) from cities where service_status = 'segera')   as kota_segera,
  (select string_agg(name, ', ' order by name) from cities where service_status = 'aktif') as nama_kota_aktif,
  has_function_privilege('anon', 'public.fare_options(service_type,double precision,double precision,double precision,double precision,numeric,integer)', 'EXECUTE') as fare_options_anon,
  has_function_privilege('anon', 'public.shopping_estimate(service_type,double precision,double precision,double precision,double precision,bigint,text,numeric)', 'EXECUTE') as shopping_estimate_anon,
  array_to_string(withdrawal_allowed_roles(), ',')                as peran_tarik_saldo,
  array_to_string(payment_gateway_channel_keys(), ',')            as saluran_gateway,
  'SEMUA UJI LULUS'                                               as hasil;
