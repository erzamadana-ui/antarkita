-- =====================================================================
-- uji_kota.sql — Uji gerbang wilayah operasi (migrasi 0076–0080)
--
-- Yang dibuktikan — dan yang paling penting ada di bagian 2:
--   1. city_gate()/city_service_status() menjawab jujur untuk kota aktif,
--      kota belum dilayani, dan titik yang jauh dari kota mana pun.
--   2. create_order() BENAR-BENAR MENOLAK pesanan yang titik jemputnya berada
--      di kota yang layanannya belum dibuka — bukan hanya UI yang menyembunyikan
--      tombol. Ini asersi terpenting: siapa pun bisa memanggil RPC langsung
--      dengan kunci anon, jadi penolakan wajib ada di server.
--   3. Sakelar PER LAYANAN bekerja: Medan boleh dibuka untuk AntarShop &
--      AntarSend lebih dulu, sementara AntarRide tetap ditolak.
--   4. Daftar tunggu tercatat, dedup per (pengguna, kota), dan RLS-nya aman:
--      pendaftar hanya melihat barisnya sendiri, kontak orang lain tidak bocor.
--   5. Non-admin tidak bisa membuka kota, mengubah sakelar layanan, menunjuk
--      Perwakilan Kota, maupun membaca daftar kota admin.
--   6. Gagal-tertutup: kota berstatus 'aktif' TANPA baris city_services tetap
--      menolak pesanan (membuka kota harus selalu keputusan sadar per layanan).
--
-- Pola: setiap skenario dibungkus BEGIN … ROLLBACK sehingga status kota milik
-- pemilik TIDAK BERUBAH sedikit pun. Sesi pengguna ditiru lewat
-- set_config('request.jwt.claims', …) yang dibaca auth.uid().
--
-- Cara pakai:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/uji_kota.sql
-- Blok yang lulus mencetak "[OK] …"; kegagalan memunculkan "[GAGAL] …" dan
-- menghentikan skrip.
--
-- Akun uji memakai UUID yang sama dengan supabase/tests/simulasi_e2e.sql:
--   pelanggan a0000000-…-0002, admin a0000000-…-0001, pemilik merchant a0000000-…-0005
--
-- Seluruh blok dijalankan pada basis data proyek (11 Sep 2026): semua asersi LULUS,
-- dan status kota milik pemilik tidak berubah sesudahnya (Pekanbaru & Padang tetap
-- 'aktif', tujuh kota lain tetap 'belum_dilayani', city_waitlist tetap 0 baris).
-- Uji UI pendampingnya: tests/kota/uji-kota.mjs (Playwright, 29 asersi).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Jawaban gerbang: kota aktif, kota belum dilayani, titik luar jangkauan
-- ---------------------------------------------------------------------
begin;
do $$
declare g jsonb; s jsonb;
begin
  -- (a) Pekanbaru: kota operasi — semua layanan dibuka
  g := city_gate('ride_motor', 0.5071, 101.4478);
  if not coalesce((g->>'ok')::boolean, false) then
    raise exception '[GAGAL] Pekanbaru (kota aktif) ditolak gerbang: %', g->>'message';
  end if;
  raise notice '[OK] 1a. Kota aktif (Pekanbaru) lolos gerbang';

  -- (b) Medan: data ada, pesanan tertutup — pesan harus menyebut nama kotanya
  g := city_gate('ride_motor', 3.5952, 98.6722);
  if coalesce((g->>'ok')::boolean, false) then raise exception '[GAGAL] Medan lolos gerbang padahal belum dilayani'; end if;
  if position('Medan' in (g->>'message')) = 0 then
    raise exception '[GAGAL] Pesan penolakan tidak menyebut nama kota: %', g->>'message';
  end if;
  if position('belum melayani' in (g->>'message')) = 0 then
    raise exception '[GAGAL] Pesan penolakan tidak jelas bagi pelanggan: %', g->>'message';
  end if;
  raise notice '[OK] 1b. Kota belum dilayani ditolak dengan pesan yang menyebut namanya';

  -- (c) Titik yang jauh dari kota mana pun (Denpasar) — batas jarak wajar
  g := city_gate('ride_motor', -8.65, 115.21);
  if coalesce((g->>'ok')::boolean, false) then raise exception '[GAGAL] Titik 900+ km dari kota mana pun lolos gerbang'; end if;
  if g->>'reason' <> 'luar_jangkauan' then raise exception '[GAGAL] Alasan penolakan bukan luar_jangkauan: %', g->>'reason'; end if;
  raise notice '[OK] 1c. Titik jauh dari kota mana pun ditolak (batas jarak wajar)';

  -- (d) Status siap tampil untuk aplikasi pelanggan
  s := city_service_status(3.5952, 98.6722);
  if (s->>'headline') <> 'AntarKita belum melayani Medan' then
    raise exception '[GAGAL] Judul untuk pelanggan Medan salah: %', s->>'headline';
  end if;
  if not (s->>'waitlist_open')::boolean then raise exception '[GAGAL] Daftar tunggu tidak dibuka untuk kota belum dilayani'; end if;
  if (s->>'in_range')::boolean is not true then raise exception '[GAGAL] Medan dianggap di luar jangkauan, padahal kotanya ada'; end if;
  raise notice '[OK] 1d. city_service_status() memberi judul, penjelasan, dan pintu daftar tunggu yang benar';
end $$;
rollback;

-- ---------------------------------------------------------------------
-- 2. ASERSI TERPENTING — create_order() MENOLAK di server
--    (UI yang menyembunyikan tombol tidak cukup: RPC bisa dipanggil langsung)
-- ---------------------------------------------------------------------
begin;
do $$
declare
  cust uuid := 'a0000000-0000-4000-8000-000000000002';
  o orders; v_msg text;
begin
  -- bersihkan order aktif akun uji supaya batas "maksimal 3 pesanan aktif" tidak mengganggu
  update orders set status = 'cancelled' where customer_id = cust and status in ('searching','accepted','arrived','in_progress');
  perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);

  -- (a) DARI KOTA AKTIF: harus DITERIMA (gerbang tidak boleh memblokir operasi nyata)
  o := create_order(jsonb_build_object('service','ride_motor','vehicle_class','motor_economy',
    'pickup',  jsonb_build_object('lat',0.4810,'lng',101.4349,'address','Jl. Sudirman 45, Pekanbaru'),
    'dropoff', jsonb_build_object('lat',0.5000,'lng',101.4400,'address','Plaza Pekanbaru'),
    'paid_via','cash'));
  if o.id is null then raise exception '[GAGAL] Pesanan dari kota aktif tidak terbuat'; end if;
  raise notice '[OK] 2a. Pesanan dari kota AKTIF diterima (%)', o.code;

  -- (b) DARI KOTA BELUM DILAYANI: harus DITOLAK
  begin
    o := create_order(jsonb_build_object('service','ride_motor','vehicle_class','motor_economy',
      'pickup',  jsonb_build_object('lat',3.5952,'lng',98.6722,'address','Jl. Gatot Subroto, Medan'),
      'dropoff', jsonb_build_object('lat',3.6100,'lng',98.6800,'address','Medan Mall'),
      'paid_via','cash'));
    raise exception '[GAGAL] BAHAYA: create_order MENERIMA pesanan dari Medan yang belum dilayani — pelanggan akan mencari driver lalu gagal';
  exception when others then
    v_msg := sqlerrm;
    if position('[GAGAL]' in v_msg) > 0 then raise; end if;
    if position('Medan' in v_msg) = 0 then raise exception '[GAGAL] Pesan penolakan tidak menyebut kota: %', v_msg; end if;
    raise notice '[OK] 2b. create_order MENOLAK pesanan dari kota belum dilayani — "%"', v_msg;
  end;

  -- (c) DARI TITIK DI LUAR SEMUA KOTA: harus DITOLAK
  begin
    o := create_order(jsonb_build_object('service','ride_motor','vehicle_class','motor_economy',
      'pickup',  jsonb_build_object('lat',-8.6500,'lng',115.2100,'address','Denpasar'),
      'dropoff', jsonb_build_object('lat',-8.6600,'lng',115.2200,'address','Sanur'),
      'paid_via','cash'));
    raise exception '[GAGAL] BAHAYA: create_order menerima pesanan 900+ km dari kota layanan mana pun';
  exception when others then
    v_msg := sqlerrm;
    if position('[GAGAL]' in v_msg) > 0 then raise; end if;
    if position('luar wilayah layanan' in v_msg) = 0 then raise exception '[GAGAL] Pesan luar jangkauan tidak jelas: %', v_msg; end if;
    raise notice '[OK] 2c. create_order MENOLAK titik jemput di luar radius kota mana pun';
  end;

  -- (d) Penjaga kode: definisi create_order benar-benar memanggil city_gate
  if position('city_gate' in (select pg_get_functiondef(p.oid) from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace where n.nspname='public' and p.proname='create_order')) = 0 then
    raise exception '[GAGAL] create_order tidak memanggil city_gate — penegakan hilang dari server';
  end if;
  raise notice '[OK] 2d. Definisi create_order memanggil city_gate (penegakan ada di server, bukan hanya UI)';
end $$;
rollback;

-- ---------------------------------------------------------------------
-- 3. Sakelar PER LAYANAN per kota (strategi pemilik: buka yang paling mudah dulu)
-- ---------------------------------------------------------------------
begin;
do $$
declare
  cust uuid := 'a0000000-0000-4000-8000-000000000002';
  adm  uuid := 'a0000000-0000-4000-8000-000000000001';
  medan uuid; j jsonb; o orders; v_msg text;
begin
  select id into medan from cities where name = 'Medan';
  update orders set status = 'cancelled' where customer_id = cust and status in ('searching','accepted','arrived','in_progress');

  -- admin membuka Medan HANYA untuk AntarShop & AntarSend
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  j := admin_set_city_status(medan, 'aktif', array['shop','send'], 'uji sakelar per layanan');
  if not ((j->'services'->>'shop')::boolean and (j->'services'->>'send')::boolean) then
    raise exception '[GAGAL] AntarShop/AntarSend tidak terbuka setelah kota dibuka';
  end if;
  if (j->'services'->>'ride_motor')::boolean then
    raise exception '[GAGAL] AntarRide ikut terbuka padahal tidak dipilih — sakelar per layanan bocor';
  end if;
  raise notice '[OK] 3a. Membuka kota untuk sebagian layanan tidak ikut membuka layanan lain';

  -- pelanggan: AntarRide tetap ditolak, pesannya menyebut layanan yang sudah bisa
  perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
  begin
    o := create_order(jsonb_build_object('service','ride_motor','vehicle_class','motor_economy',
      'pickup',  jsonb_build_object('lat',3.5952,'lng',98.6722,'address','Medan'),
      'dropoff', jsonb_build_object('lat',3.6100,'lng',98.6800,'address','Medan Mall'),
      'paid_via','cash'));
    raise exception '[GAGAL] AntarRide diterima di Medan padahal hanya AntarShop & AntarSend yang dibuka';
  exception when others then
    v_msg := sqlerrm;
    if position('[GAGAL]' in v_msg) > 0 then raise; end if;
    if position('AntarRide belum dibuka' in v_msg) = 0 then raise exception '[GAGAL] Pesan layanan tertutup tidak jelas: %', v_msg; end if;
    if position('AntarShop' in v_msg) = 0 then raise exception '[GAGAL] Pesan tidak memberi tahu layanan yang SUDAH bisa dipakai: %', v_msg; end if;
    raise notice '[OK] 3b. Layanan yang belum dibuka ditolak & pelanggan diberi tahu layanan yang sudah bisa — "%"', v_msg;
  end;

  -- menutup satu layanan kembali
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  j := admin_set_city_service(medan, 'shop', false);
  if (j->'services'->>'shop')::boolean then raise exception '[GAGAL] AntarShop tidak tertutup setelah dimatikan'; end if;
  if not (j->'services'->>'send')::boolean then raise exception '[GAGAL] Menutup AntarShop ikut menutup AntarSend'; end if;
  raise notice '[OK] 3c. Menutup satu layanan tidak mengganggu layanan lain di kota yang sama';

  -- menutup kota menutup seluruh layanannya
  j := admin_set_city_status(medan, 'belum_dilayani', null, 'ditutup lagi');
  if (j->'services'->>'send')::boolean then raise exception '[GAGAL] Layanan masih terbuka setelah kota ditutup'; end if;
  raise notice '[OK] 3d. Menutup kota menutup seluruh layanannya sekaligus';
end $$;
rollback;

-- ---------------------------------------------------------------------
-- 4. Gagal-tertutup: kota 'aktif' tanpa baris city_services tetap menolak
--    (mis. status diubah langsung lewat SQL, bukan lewat admin_set_city_status)
-- ---------------------------------------------------------------------
begin;
do $$
declare medan uuid; g jsonb;
begin
  select id into medan from cities where name = 'Medan';
  delete from city_services where city_id = medan;
  update cities set service_status = 'aktif' where id = medan;
  g := city_gate('shop', 3.5952, 98.6722);
  if coalesce((g->>'ok')::boolean, false) then
    raise exception '[GAGAL] Kota "aktif" tanpa sakelar layanan justru membuka semua layanan — seharusnya gagal-tertutup';
  end if;
  raise notice '[OK] 4. Kota aktif tanpa baris city_services tetap TERTUTUP (gagal-tertutup)';
end $$;
rollback;

-- ---------------------------------------------------------------------
-- 5. Daftar tunggu: tercatat, dedup, dan RLS-nya aman
-- ---------------------------------------------------------------------
begin;
do $$
declare
  cust  uuid := 'a0000000-0000-4000-8000-000000000002';
  lain  uuid := 'a0000000-0000-4000-8000-000000000005';
  adm   uuid := 'a0000000-0000-4000-8000-000000000001';
  medan uuid; j jsonb; n int;
begin
  select id into medan from cities where name = 'Medan';

  perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
  j := city_waitlist_join(3.5952, 98.6722, null, array['ride_motor','food'], null, 'butuh ojek di Medan');
  if not (j->>'ok')::boolean then raise exception '[GAGAL] Pendaftaran daftar tunggu gagal'; end if;
  select count(*) into n from city_waitlist where city_id = medan and user_id = cust;
  if n <> 1 then raise exception '[GAGAL] Baris daftar tunggu tidak tersimpan (ditemukan %)', n; end if;
  raise notice '[OK] 5a. Minat pelanggan tercatat beserta kota & layanan yang diinginkan';

  -- mendaftar dua kali di kota yang sama tidak menggandakan baris
  j := city_waitlist_join(3.5952, 98.6722, null, array['shop'], null, null);
  select count(*) into n from city_waitlist where city_id = medan and user_id = cust;
  if n <> 1 then raise exception '[GAGAL] Pendaftaran kedua menggandakan baris (ditemukan %)', n; end if;
  raise notice '[OK] 5b. Mendaftar ulang memperbarui baris yang sama, tidak menggandakan';

  -- RLS: pengguna lain TIDAK boleh melihat baris pendaftar
  perform set_config('request.jwt.claims', json_build_object('sub', lain, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into n from city_waitlist where user_id = cust;
  perform set_config('role', 'postgres', true);
  if n <> 0 then raise exception '[GAGAL] BOCOR: pengguna lain bisa membaca % baris daftar tunggu orang', n; end if;
  raise notice '[OK] 5c. RLS aman — pengguna lain tidak bisa membaca daftar tunggu (kontak tidak bocor)';

  -- admin melihat hitungan & isinya
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  j := admin_list_cities(null);
  select (e->>'waitlist')::int into n from jsonb_array_elements(j) e where e->>'name' = 'Medan';
  if coalesce(n, 0) < 1 then raise exception '[GAGAL] Hitungan daftar tunggu tidak terlihat di Panel Admin'; end if;
  if jsonb_array_length(admin_city_waitlist(medan, 100)) < 1 then raise exception '[GAGAL] Isi daftar tunggu tidak terbaca admin'; end if;
  raise notice '[OK] 5d. Panel Admin melihat jumlah & isi daftar tunggu per kota';
end $$;
rollback;

-- ---------------------------------------------------------------------
-- 6. Non-admin tidak bisa membuka kota atau menyentuh sakelar
-- ---------------------------------------------------------------------
begin;
do $$
declare
  cust  uuid := 'a0000000-0000-4000-8000-000000000002';
  medan uuid; n int;
begin
  select id into medan from cities where name = 'Medan';
  perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);

  begin perform admin_set_city_status(medan, 'aktif', array['ride_motor'], 'coba');
        raise exception '[GAGAL] Non-admin BISA membuka kota'; exception when others then
        if position('[GAGAL]' in sqlerrm) > 0 then raise; end if; end;
  raise notice '[OK] 6a. Non-admin tidak bisa membuka kota (admin_set_city_status)';

  begin perform admin_set_city_service(medan, 'shop', true);
        raise exception '[GAGAL] Non-admin BISA membuka satu layanan'; exception when others then
        if position('[GAGAL]' in sqlerrm) > 0 then raise; end if; end;
  raise notice '[OK] 6b. Non-admin tidak bisa membuka/menutup layanan per kota';

  begin perform admin_set_city_manager(medan, cust, null);
        raise exception '[GAGAL] Non-admin BISA menunjuk Perwakilan Kota'; exception when others then
        if position('[GAGAL]' in sqlerrm) > 0 then raise; end if; end;
  raise notice '[OK] 6c. Non-admin tidak bisa menunjuk Perwakilan Kota';

  begin perform admin_list_cities(null);
        raise exception '[GAGAL] Non-admin BISA membaca daftar kota admin'; exception when others then
        if position('[GAGAL]' in sqlerrm) > 0 then raise; end if; end;
  raise notice '[OK] 6d. Non-admin tidak bisa membaca daftar kota Panel Admin';

  -- lapis kedua: RLS tabel sakelar menolak tulisan dari pengguna biasa
  perform set_config('role', 'authenticated', true);
  begin
    insert into city_services (city_id, service, enabled) values (medan, 'shop', true);
    perform set_config('role', 'postgres', true);
    raise exception '[GAGAL] BOCOR: pengguna biasa bisa menulis langsung ke city_services';
  exception when others then
    perform set_config('role', 'postgres', true);
    if position('[GAGAL]' in sqlerrm) > 0 then raise; end if;
  end;
  raise notice '[OK] 6e. RLS city_services menolak tulisan langsung dari pengguna biasa';

  -- anon tidak boleh memanggil fungsi admin sama sekali (lapis hak eksekusi)
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname in
     ('admin_list_cities','admin_set_city_status','admin_set_city_service','admin_set_city_manager','admin_city_waitlist','admin_city_drivers','admin_city_manager_options')
     and has_function_privilege('anon', p.oid, 'execute');
  if n <> 0 then raise exception '[GAGAL] Masih ada % fungsi admin kota yang bisa dipanggil anon', n; end if;
  raise notice '[OK] 6f. Tidak ada fungsi admin kota yang bisa dipanggil anon';
end $$;
rollback;

-- ---------------------------------------------------------------------
-- 7. Kompatibilitas: arti cities.active tidak diubah diam-diam
-- ---------------------------------------------------------------------
begin;
do $$
declare n int;
begin
  -- semua kota tetap `active` (terdaftar di sistem) walau pesanannya tertutup,
  -- supaya nearest_city(), impor tempat, rute travel, dan blast promo tetap jalan
  -- CATATAN 0071/0081: kota hasil impor OSM (source = 'osm') memang gazetteer dengan active = false;
  -- yang tidak boleh berubah adalah kota LAYANAN (source = 'admin').
  select count(*) into n from cities where not active and coalesce(source, 'admin') <> 'osm';
  if n <> 0 then raise exception '[GAGAL] % kota layanan kehilangan cities.active — kode lama (nearest_city, impor tempat, travel) ikut rusak', n; end if;
  raise notice '[OK] 7a. cities.active kota layanan tidak disentuh (gazetteer OSM memang nonaktif): data tempat & rute antar kota tetap berfungsi';

  -- nearest_city() (dipakai AntarSend antar kota) masih mengenali kota tertutup
  if nearest_city(3.5952, 98.6722, 40) is null then
    raise exception '[GAGAL] nearest_city() tidak lagi mengenali Medan — fungsi lama rusak';
  end if;
  raise notice '[OK] 7b. nearest_city() tetap bekerja seperti sebelumnya';

  -- kota tertutup tetap terlihat pelanggan untuk MENELUSURI data tempat
  select count(*) into n from cities where service_status <> 'aktif';
  if n = 0 then raise exception '[GAGAL] Tidak ada kota belum dilayani — data uji tidak sesuai'; end if;
  raise notice '[OK] 7c. % kota belum dilayani tetap terdaftar dan bisa ditelusuri', n;
end $$;
rollback;

-- ---------------------------------------------------------------------
-- 8. Perwakilan Kota (PIC)
-- ---------------------------------------------------------------------
begin;
do $$
declare
  adm uuid := 'a0000000-0000-4000-8000-000000000001';
  cust uuid := 'a0000000-0000-4000-8000-000000000002';
  medan uuid; j jsonb; v_nama text;
begin
  select id into medan from cities where name = 'Medan';
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);

  j := admin_set_city_manager(medan, adm, 'PIC sementara');
  if j->>'manager_id' is null then raise exception '[GAGAL] Perwakilan Kota tidak tersimpan'; end if;
  select e->>'manager_name' into v_nama from jsonb_array_elements(admin_list_cities(null)) e where e->>'name' = 'Medan';
  if v_nama is null then raise exception '[GAGAL] Nama Perwakilan Kota tidak muncul di daftar kota admin'; end if;
  raise notice '[OK] 8a. Perwakilan Kota tersimpan dan namanya tampil di daftar kota (%)', v_nama;

  -- bukan admin tidak boleh ditunjuk sebagai Perwakilan Kota
  begin
    perform admin_set_city_manager(medan, cust, null);
    raise exception '[GAGAL] Pengguna non-admin bisa ditunjuk sebagai Perwakilan Kota';
  exception when others then if position('[GAGAL]' in sqlerrm) > 0 then raise; end if; end;
  raise notice '[OK] 8b. Hanya pengguna admin aktif yang bisa jadi Perwakilan Kota';
end $$;
rollback;

-- ---------------------------------------------------------------------
-- 9. Membuka kota memaksa keputusan sadar (tanpa layanan = ditolak)
-- ---------------------------------------------------------------------
begin;
do $$
declare adm uuid := 'a0000000-0000-4000-8000-000000000001'; medan uuid;
begin
  select id into medan from cities where name = 'Medan';
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  begin
    perform admin_set_city_status(medan, 'aktif', null, null);
    raise exception '[GAGAL] Kota bisa dibuka tanpa menyebut satu pun layanan';
  exception when others then
    if position('[GAGAL]' in sqlerrm) > 0 then raise; end if;
    if position('harus menyebut layanan' in sqlerrm) = 0 then raise exception '[GAGAL] Pesan tidak jelas: %', sqlerrm; end if;
  end;
  raise notice '[OK] 9. Membuka kota wajib menyebut layanan mana yang dibuka';
end $$;
rollback;

-- ---------------------------------------------------------------------
-- 10. Kota hasil impor OSM tidak boleh "menutupi" kota yang sedang beroperasi
--     (regresi yang mahal: satu desa 6 km dari pusat Pekanbaru bisa membuat
--      seluruh pelanggan Pekanbaru ditolak kalau pemilihan kota hanya "terdekat")
-- ---------------------------------------------------------------------
begin;
do $$
declare v_desa uuid; g jsonb;
begin
  insert into cities (name, province, location, active)
  values ('Desa Uji Dekat Pekanbaru', 'Riau', st_setsrid(st_makepoint(101.4900, 0.5400), 4326), false)
  returning id into v_desa;

  g := city_gate('ride_motor', 0.5071, 101.4478);
  if not coalesce((g->>'ok')::boolean, false) or g->>'city_name' <> 'Pekanbaru' then
    raise exception '[GAGAL] Pelanggan di pusat Pekanbaru tertutup oleh kota impor (%): %', g->>'city_name', g->>'message';
  end if;
  raise notice '[OK] 10a. Kota impor tidak menutupi Pekanbaru di pusat kota';

  -- titik persis di desa impor, tetapi masih di dalam radius Pekanbaru
  g := city_gate('ride_motor', 0.5400, 101.4900);
  if not coalesce((g->>'ok')::boolean, false) or g->>'city_name' <> 'Pekanbaru' then
    raise exception '[GAGAL] Titik dalam radius Pekanbaru justru dinilai dari kota impor (%): %', g->>'city_name', g->>'message';
  end if;
  raise notice '[OK] 10b. Titik di dalam radius kota operasi tetap dinilai dari kota operasi';

  -- kota impor yang JAUH dari kota operasi tetap harus menutup pesanan
  insert into cities (name, province, location, active)
  values ('Desa Uji Jauh', 'Papua', st_setsrid(st_makepoint(140.7000, -2.5300), 4326), false);
  g := city_gate('ride_motor', -2.5300, 140.7000);
  if coalesce((g->>'ok')::boolean, false) then
    raise exception '[GAGAL] Kota hasil impor justru terbuka untuk pesanan';
  end if;
  raise notice '[OK] 10c. Kota hasil impor masuk sebagai TERTUTUP (gagal-tertutup)';
end $$;
rollback;

-- ---------------------------------------------------------------------
-- 11. CELAH DI ANTARA DUA PENJAGA (migrasi 0081)
--
--     Penjaga 0071b bekerja pada waktu TULIS dan hanya pada cabang INSERT:
--     baris gazetteer yang SUDAH TERLANJUR ADA (impor yang jalan sebelum penjaga
--     dipasang, atau disisipkan lewat jalur lain) masuk lewat cabang UPDATE dan
--     tidak pernah tersentuh lagi. Tingkat (1) city_at_point() hanya
--     mengistimewakan kota ber-status 'aktif' — tujuh dari sembilan kota kurasi
--     TIDAK 'aktif', jadi tanpa 0081 mereka tidak dilindungi penjaga mana pun.
--
--     Yang diuji di sini: satu kelurahan hasil impor 7 km dari pusat Medan TIDAK
--     boleh menutupi nama "Medan" bagi pelanggan Medan biasa, dan daftar tunggunya
--     harus tercatat atas nama KOTA (dasar keputusan "kota dengan peminat terbanyak
--     dibuka lebih dulu" di Panel Admin), bukan atas nama kelurahan.
-- ---------------------------------------------------------------------
begin;
do $$
declare
  cust uuid := 'a0000000-0000-4000-8000-000000000002';
  g jsonb; s jsonb; v_nama text;
begin
  -- baris gazetteer LAMA: disisipkan langsung, jadi penjaga 0071b tidak berlaku
  insert into cities (name, province, location, active, osm_id, kind, source, imported_at)
  values ('Kelurahan Sunggal (uji)', 'Sumatera Utara',
          st_setsrid(st_makepoint(98.7000, 3.6500), 4326)::geography, false,
          'relation/uji-11', 'lainnya', 'osm', now());

  -- pelanggan Medan biasa: ~6 km dari pusat kota, ~0,6 km dari kelurahan impor
  select c.name into v_nama from city_at_point(3.6450, 98.6980) c;
  if v_nama <> 'Medan' then
    raise exception '[GAGAL] 11a. Baris gazetteer menutupi kota kurasi: city_at_point memilih "%"', v_nama;
  end if;
  raise notice '[OK] 11a. Kelurahan hasil impor tidak menutupi kota kurasi yang belum dilayani';

  g := city_gate('ride_motor', 3.6450, 98.6980);
  if coalesce((g->>'ok')::boolean, false) then raise exception '[GAGAL] 11b. Kota tertutup malah lolos gerbang'; end if;
  if position('Medan' in (g->>'message')) = 0 then
    raise exception '[GAGAL] 11b. Pesan penolakan menyebut kelurahan, bukan kota: %', g->>'message';
  end if;
  s := city_service_status(3.6450, 98.6980);
  if (s->>'headline') <> 'AntarKita belum melayani Medan' then
    raise exception '[GAGAL] 11b. Judul untuk pelanggan salah: %', s->>'headline';
  end if;
  raise notice '[OK] 11b. Pesan & judul tetap menyebut "Medan", bukan nama kelurahan';

  -- daftar tunggu harus menempel ke KOTA, supaya prioritas pembukaan kota tetap benar
  perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
  perform city_waitlist_join(3.6450, 98.6980, null, array['ride_motor'], null, 'uji celah penjaga');
  select c.name into v_nama from city_waitlist w join cities c on c.id = w.city_id
   where w.user_id = cust order by w.created_at desc limit 1;
  if v_nama <> 'Medan' then
    raise exception '[GAGAL] 11c. Daftar tunggu tercatat atas nama "%", bukan kota — prioritas pembukaan kota rusak', v_nama;
  end if;
  raise notice '[OK] 11c. Minat pelanggan tercatat atas nama KOTA (Medan), bukan kelurahan hasil impor';

  -- kota operasi tidak terpengaruh perubahan ini
  g := city_gate('ride_motor', 0.5071, 101.4478);
  if not coalesce((g->>'ok')::boolean, false) or g->>'city_name' <> 'Pekanbaru' then
    raise exception '[GAGAL] 11d. Kota operasi ikut terdampak: % / %', g->>'city_name', g->>'message';
  end if;
  raise notice '[OK] 11d. Pekanbaru tetap lolos gerbang (tingkat kota MELAYANI masih menang lebih dulu)';

  -- di LUAR radius kota kurasi mana pun, gazetteer tetap boleh jadi rujukan — dan tetap tertutup
  g := city_gate('ride_motor', 3.6450, 99.9000);
  if coalesce((g->>'ok')::boolean, false) then
    raise exception '[GAGAL] 11e. Titik di luar radius kota mana pun justru lolos gerbang';
  end if;
  raise notice '[OK] 11e. Di luar radius kota kurasi, gerbang tetap menolak (gagal-tertutup)';
end $$;
rollback;

-- ---------------------------------------------------------------------
-- 12. Hak eksekusi fungsi bantu impor tidak bocor ke anon (migrasi 0081)
--     `revoke … from anon` saja TIDAK cukup: hak bawaan fungsi ada pada PUBLIC.
-- ---------------------------------------------------------------------
begin;
do $$
declare n int; v text;
begin
  select count(*), coalesce(string_agg(p.proname, ', '), '') into n, v
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public'
     and p.proname in ('nearest_city_any', 'nearby_poi', 'city_at_point', 'city_open_services',
                       'osm_upsert_cities', 'osm_upsert_places', 'osm_claim_tasks', 'osm_finish_task')
     and has_function_privilege('anon', p.oid, 'execute');
  if n <> 0 then raise exception '[GAGAL] 12. Masih bisa dipanggil anon: %', v; end if;
  raise notice '[OK] 12. Fungsi bantu impor & pemilih kota tertutup untuk anon (dicabut dari PUBLIC, bukan hanya dari anon)';
end $$;
rollback;
