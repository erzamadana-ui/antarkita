-- =====================================================================
-- uji_impor.sql — Uji impor tempat OpenStreetMap (agen data tempat)
--
-- Semua skenario memakai DATA TIRUAN yang disuntik di dalam SATU transaksi dan
-- selalu DI-ROLLBACK (blok diakhiri RAISE), jadi basis data tidak berubah.
--
-- Cara pakai:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=0 -f supabase/tests/uji_impor.sql
--   atau tempel isinya ke SQL editor Supabase. Ringkasan hasil muncul pada
--   pesan error terakhir (sengaja, supaya transaksi batal).
--
-- Yang dibuktikan di sini:
--   1. kota hasil OSM masuk sebagai gazetteer (active = false) dan idempoten;
--   2. kota layanan lama diadopsi (tidak tergandakan, status layanan tidak berubah);
--   3. CACAT LAMA "kota aktif terdekat tanpa batas jarak" sudah tidak terjadi:
--      tempat di Surabaya TIDAK menempel ke Padang;
--   4. dedupe osm_id: jalan ulang tidak menggandakan baris;
--   5. faskes masuk poi_places dan DITOLAK bila dipaksa masuk shop_stores;
--   6. antrean pekerjaan: enqueue → claim → finish → job selesai + log.
-- =====================================================================
do $uji$
declare
  adm uuid := 'a0000000-0000-4000-8000-000000000001';   -- profil admin
  cust uuid;
  log text := E'\n';
  r jsonb; j jsonb; n int; n2 int; v_city uuid; v_pad uuid; v_txt text;
  v_lat double precision; v_lng double precision; v_active boolean; v_src text;
  v_job uuid; v_task bigint; t osm_import_tasks%rowtype;
  ok boolean;
begin
  select id into cust from profiles where role = 'customer' limit 1;
  select id into v_pad from cities where name = 'Padang';

  -- ===== S1 Kota baru dari OSM: masuk sebagai gazetteer, BUKAN kota layanan =====
  begin
    r := osm_upsert_cities(jsonb_build_array(
          jsonb_build_object('osm_id','relation/999000001','name','Kota Ujicoba','lat',-7.2575,'lng',112.7521,'population','2874314'),
          jsonb_build_object('osm_id','relation/999000002','name','Kabupaten Ujicoba','lat',-7.55,'lng',112.60,'population','1200000')
        ), 'Jawa Timur');
    select active, source into v_active, v_src from cities where osm_id = 'relation/999000001';
    log := log || format('S1 kota OSM: %s | active=%s source=%s service_status=%s', r, v_active, v_src,
                         (select service_status from cities where osm_id = 'relation/999000001')) || E'\n';
    if v_active is distinct from false then log := log || 'S1 BUG: kota hasil impor tidak boleh active=true' || E'\n'; end if;
    if (r->>'inserted')::int <> 2 then log := log || 'S1 BUG: seharusnya 2 kota baru' || E'\n'; end if;
    if (select kind from cities where osm_id = 'relation/999000002') <> 'kabupaten' then log := log || 'S1 BUG: kind kabupaten salah' || E'\n'; end if;
  exception when others then log := log || 'S1 BUG: ' || sqlerrm || E'\n'; end;

  -- ===== S2 Idempoten: jalan ulang tidak menggandakan =====
  begin
    select count(*) into n from cities;
    r := osm_upsert_cities(jsonb_build_array(
          jsonb_build_object('osm_id','relation/999000001','name','Kota Ujicoba','lat',-7.2575,'lng',112.7521)), 'Jawa Timur');
    select count(*) into n2 from cities;
    log := log || format('S2 jalan ulang kota: %s | baris %s → %s', r, n, n2) || E'\n';
    if n2 <> n or (r->>'inserted')::int <> 0 or (r->>'updated')::int <> 1 then log := log || 'S2 BUG: impor ulang menggandakan/keliru' || E'\n'; end if;
  exception when others then log := log || 'S2 BUG: ' || sqlerrm || E'\n'; end;

  -- ===== S3 Adopsi kota layanan lama ("Kota Padang" → baris Padang yang sudah ada) =====
  begin
    select lat, lng into v_lat, v_lng from cities where id = v_pad;
    select count(*) into n from cities;
    r := osm_upsert_cities(jsonb_build_array(
          jsonb_build_object('osm_id','relation/999000003','name','Kota Padang','lat',-0.95,'lng',100.40,'population','909040')), 'Sumatera Barat');
    select count(*) into n2 from cities;
    select active, source, lat, lng into v_active, v_src, v_lat, v_lng from cities where id = v_pad;
    log := log || format('S3 adopsi Padang: %s | baris %s → %s | active=%s source=%s osm_id=%s lat=%s',
                         r, n, n2, v_active, v_src, (select osm_id from cities where id = v_pad), v_lat) || E'\n';
    if n2 <> n then log := log || 'S3 BUG: Padang tergandakan' || E'\n'; end if;
    if v_active <> true or v_src <> 'admin' then log := log || 'S3 BUG: status kota layanan berubah' || E'\n'; end if;
    if round(v_lat::numeric, 3) <> round((-0.9471)::numeric, 3) then log := log || 'S3 BUG: koordinat kota layanan ditimpa OSM' || E'\n'; end if;
  exception when others then log := log || 'S3 BUG: ' || sqlerrm || E'\n'; end;

  -- ===== S4 CACAT LAMA: tempat di Surabaya tidak boleh menempel ke kota aktif terdekat =====
  begin
    -- pola lama (0021): kota AKTIF terdekat tanpa batas jarak
    select c.name, round((st_distance(c.location, st_setsrid(st_makepoint(112.7521, -7.2575), 4326)::geography)/1000)::numeric, 0)
      into v_txt, n
      from cities c where c.active and c.location is not null
      order by st_distance(c.location, st_setsrid(st_makepoint(112.7521, -7.2575), 4326)::geography) limit 1;
    log := log || format('S4 pola LAMA akan menempel ke kota aktif terdekat: %s (%s km)', v_txt, n) || E'\n';

    delete from cities where osm_id in ('relation/999000001','relation/999000002');  -- kosongkan gazetteer sekitar Surabaya
    r := osm_upsert_places('store', jsonb_build_array(
           jsonb_build_object('osm_id','node/999100001','name','Apotek Uji Surabaya','lat',-7.2575,'lng',112.7521,'brand','apotek','category','apotek')), null);
    select city_id into v_city from shop_stores where osm_id = 'node/999100001';
    log := log || format('S4 pola BARU: %s | city_id=%s', r, coalesce(v_city::text, 'NULL (benar — tidak ada kota dalam 60 km)')) || E'\n';
    if v_city is not null then log := log || 'S4 BUG: apotek Surabaya masih menempel ke kota jauh' || E'\n'; end if;
  exception when others then log := log || 'S4 BUG: ' || sqlerrm || E'\n'; end;

  -- ===== S5 Setelah kota ada di gazetteer, tempat menempel ke kota yang benar =====
  begin
    r := osm_upsert_cities(jsonb_build_array(
          jsonb_build_object('osm_id','relation/999000001','name','Kota Ujicoba','lat',-7.2575,'lng',112.7521)), 'Jawa Timur');
    r := osm_upsert_places('store', jsonb_build_array(
           jsonb_build_object('osm_id','node/999100001','name','Apotek Uji Surabaya','lat',-7.2575,'lng',112.7521,'brand','apotek','category','apotek')), null);
    select city_id into v_city from shop_stores where osm_id = 'node/999100001';
    log := log || format('S5 setelah gazetteer: %s | kota=%s', r, (select name from cities where id = v_city)) || E'\n';
    if v_city is distinct from (select id from cities where osm_id = 'relation/999000001') then
      log := log || 'S5 BUG: kota tidak ditetapkan ke kota terdekat yang benar' || E'\n'; end if;
    if (r->>'updated')::int <> 1 or (r->>'inserted')::int <> 0 then log := log || 'S5 BUG: dedupe osm_id tidak jalan' || E'\n'; end if;
  exception when others then log := log || 'S5 BUG: ' || sqlerrm || E'\n'; end;

  -- ===== S6 Dedupe & kategori: batch campuran dijalankan dua kali =====
  begin
    r := osm_upsert_places('store', jsonb_build_array(
           jsonb_build_object('osm_id','node/999100002','name','Indomaret Uji','lat',-7.2600,'lng',112.7500,'brand','indomaret','category','minimarket'),
           jsonb_build_object('osm_id','node/999100003','name','Superindo Uji','lat',-7.2610,'lng',112.7510,'brand','supermarket','category','supermarket')), null);
    j := osm_upsert_places('store', jsonb_build_array(
           jsonb_build_object('osm_id','node/999100002','name','Indomaret Uji','lat',-7.2600,'lng',112.7500,'brand','indomaret','category','minimarket'),
           jsonb_build_object('osm_id','node/999100003','name','Superindo Uji','lat',-7.2610,'lng',112.7510,'brand','supermarket','category','supermarket')), null);
    select count(*) into n from shop_stores where osm_id in ('node/999100002','node/999100003');
    log := log || format('S6 dedupe toko: pertama=%s kedua=%s | baris=%s', r, j, n) || E'\n';
    if n <> 2 or (j->>'inserted')::int <> 0 or (j->>'updated')::int <> 2 then log := log || 'S6 BUG: impor ulang menggandakan toko' || E'\n'; end if;

    r := osm_upsert_places('market', jsonb_build_array(
           jsonb_build_object('osm_id','way/999100010','name','Pasar Uji Wonokromo','lat',-7.3000,'lng',112.7400)), null);
    j := osm_upsert_places('market', jsonb_build_array(
           jsonb_build_object('osm_id','way/999100010','name','Pasar Uji Wonokromo','lat',-7.3000,'lng',112.7400)), null);
    select count(*) into n from markets where osm_id = 'way/999100010';
    log := log || format('S6 dedupe pasar: pertama=%s kedua=%s | baris=%s', r, j, n) || E'\n';
    if n <> 1 then log := log || 'S6 BUG: pasar tergandakan' || E'\n'; end if;
  exception when others then log := log || 'S6 BUG: ' || sqlerrm || E'\n'; end;

  -- ===== S7 Faskes: masuk poi_places, TIDAK masuk katalog belanja =====
  begin
    r := osm_upsert_places('faskes', jsonb_build_array(
           jsonb_build_object('osm_id','way/999100020','name','RSUD Uji Coba','lat',-7.2650,'lng',112.7450,'kind','rumah_sakit','emergency',true),
           jsonb_build_object('osm_id','node/999100021','name','Klinik Uji Sehat','lat',-7.2660,'lng',112.7460,'kind','klinik'),
           jsonb_build_object('osm_id','node/999100022','name','Puskesmas Uji','lat',-7.2670,'lng',112.7470,'kind','puskesmas')), null);
    select count(*) into n from poi_places where osm_id in ('way/999100020','node/999100021','node/999100022');
    select count(*) into n2 from shop_stores where osm_id in ('way/999100020','node/999100021','node/999100022');
    log := log || format('S7 faskes: %s | poi_places=%s shop_stores=%s | kota=%s', r, n, n2,
                         (select c.name from cities c join poi_places p on p.city_id = c.id where p.osm_id = 'way/999100020')) || E'\n';
    if n <> 3 or n2 <> 0 then log := log || 'S7 BUG: faskes tidak terpisah dari katalog belanja' || E'\n'; end if;

    ok := false;
    begin
      insert into shop_stores (name, brand, category, lat, lng) values ('RS Paksa Masuk Belanja', 'lainnya', 'rumah_sakit', -7.2, 112.7);
    exception when check_violation then ok := true; end;
    log := log || format('S7 CHECK shop_stores menolak kategori faskes: %s', ok) || E'\n';
    if not ok then log := log || 'S7 BUG: faskes masih bisa disisipkan ke shop_stores' || E'\n'; end if;

    -- pastikan nearby_stores (daftar belanja) tidak memuat faskes
    select count(*) into n from nearby_stores(-7.2650, 112.7450, 15, null) s where s.name ilike '%RSUD Uji%' or s.name ilike '%Klinik Uji%';
    log := log || format('S7 nearby_stores memuat faskes: %s baris (harus 0)', n) || E'\n';
    if n <> 0 then log := log || 'S7 BUG: faskes muncul di daftar belanja' || E'\n'; end if;
  exception when others then log := log || 'S7 BUG: ' || sqlerrm || E'\n'; end;

  -- ===== S8 import_places (dipanggil aplikasi pelanggan) juga berbatas jarak =====
  begin
    -- titik di tengah Laut Jawa: jauh (>300 km) dari kota mana pun di gazetteer uji
    perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
    r := import_places('store', jsonb_build_array(
           jsonb_build_object('name','Apotek Klien Uji','lat',-5.5,'lng',110.0,'osm_id','node/999100030')));
    select city_id into v_city from shop_stores where osm_id = 'node/999100030';
    perform set_config('request.jwt.claims', null, true);
    log := log || format('S8 import_places klien: %s | city_id=%s', r, coalesce(v_city::text, 'NULL (benar)')) || E'\n';
    if v_city is not null then log := log || 'S8 BUG: import_places masih menempel ke kota aktif terjauh' || E'\n'; end if;
  exception when others then perform set_config('request.jwt.claims', null, true); log := log || 'S8 BUG: ' || sqlerrm || E'\n'; end;

  -- ===== S9 Antrean pekerjaan: hanya admin, lalu claim → finish → selesai =====
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
    ok := false;
    begin r := admin_osm_enqueue('apotek', 'kota', null, v_pad); exception when others then ok := true; end;
    log := log || format('S9 non-admin ditolak: %s', ok) || E'\n';
    if not ok then log := log || 'S9 BUG: pengguna biasa bisa menjalankan impor' || E'\n'; end if;

    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    r := admin_osm_enqueue('semua', 'kota', null, v_pad);
    v_job := (r->>'job_id')::uuid;
    log := log || format('S9 enqueue admin: %s', r) || E'\n';

    select * into t from osm_claim_tasks(v_job, 1);
    log := log || format('S9 claim: tugas=%s kota=%s area=%s status=%s', t.id, t.city_name, coalesce(t.area_osm_id,'(radius)'), t.status) || E'\n';
    if t.id is null then log := log || 'S9 BUG: tugas tidak bisa diambil' || E'\n'; end if;

    j := osm_finish_task(t.id, 'done', jsonb_build_object('fetched', 12, 'inserted', 9, 'updated', 3, 'skipped', 0,
                                                          'counts', jsonb_build_object('apotek', 4, 'minimarket', 5)), null, 'https://overpass-api.de/api/interpreter');
    select * into j from (select to_jsonb(x) from osm_import_jobs x where x.id = v_job) q;
    log := log || format('S9 job setelah selesai: status=%s tasks_done=%s inserted=%s counts=%s',
                         j->>'status', j->>'tasks_done', j->>'inserted', j->>'counts') || E'\n';
    if j->>'status' <> 'done' then log := log || 'S9 BUG: job tidak ditutup setelah semua tugas selesai' || E'\n'; end if;
    select count(*) into n from audit_logs where action = 'osm.job_done' and entity_id = v_job::text;
    log := log || format('S9 log_activity osm.job_done: %s baris', n) || E'\n';
    if n = 0 then log := log || 'S9 BUG: hasil impor tidak dicatat ke log' || E'\n'; end if;

    r := admin_osm_status(5);
    log := log || format('S9 admin_osm_status data: %s', r->'data') || E'\n';
    perform set_config('request.jwt.claims', null, true);
  exception when others then perform set_config('request.jwt.claims', null, true); log := log || 'S9 BUG: ' || sqlerrm || E'\n'; end;

  -- ===== S10 Penjadwal tidak error saat konfigurasi kosong =====
  begin
    r := osm_import_tick();
    log := log || format('S10 osm_import_tick: %s', r) || E'\n';
    r := osm_auto_refresh();
    log := log || format('S10 osm_auto_refresh (default mati): %s', r) || E'\n';
  exception when others then log := log || 'S10 BUG: ' || sqlerrm || E'\n'; end;

  -- ===== S11 nearby_poi: titik tujuan populer bisa dibaca aplikasi =====
  begin
    select count(*) into n from nearby_poi(-7.2650, 112.7450, 10, null, 20);
    log := log || format('S11 nearby_poi (titik tujuan) mengembalikan %s baris', n) || E'\n';
  exception when others then log := log || 'S11 BUG: ' || sqlerrm || E'\n'; end;

  -- ===== S12 Gazetteer tidak menyaingi kota layanan (lihat 0071b) =====
  -- city_at_point()/city_gate() milik agen kota memilih kota TERDEKAT dari seluruh
  -- tabel cities. "Kota Administrasi Jakarta Pusat" dsb. tidak boleh mengalahkan
  -- baris "Jakarta", karena itu akan membuat pengguna Jakarta dianggap belum dilayani.
  begin
    r := osm_upsert_cities(jsonb_build_array(
          jsonb_build_object('osm_id','relation/998000001','name','Kota Administrasi Jakarta Pusat','lat',-6.1805,'lng',106.8284),
          jsonb_build_object('osm_id','relation/998000002','name','Kota Administrasi Jakarta Selatan','lat',-6.2800,'lng',106.8100),
          jsonb_build_object('osm_id','relation/998000003','name','Kota Surabaya Uji','lat',-7.2575,'lng',112.7521)
        ), 'Uji');
    select count(*) into n from cities where osm_id in ('relation/998000001','relation/998000002');
    select count(*) into n2 from cities where osm_id = 'relation/998000003';
    select c.name into v_txt from city_at_point(-6.2088, 106.8456) c;
    log := log || format('S12 gazetteer vs kota layanan: %s | Jakarta Pusat/Selatan tersisip=%s (harus 0) | kota jauh masuk=%s (harus 1) | city_at_point=%s',
                         r, n, n2, v_txt) || E'\n';
    if n <> 0 then log := log || 'S12 BUG: gazetteer menyaingi kota layanan Jakarta' || E'\n'; end if;
    if n2 <> 1 then log := log || 'S12 BUG: kota jauh malah ikut ditolak' || E'\n'; end if;
  exception when others then log := log || 'S12 BUG: ' || sqlerrm || E'\n'; end;

  raise exception E'HASIL UJI IMPOR (transaksi di-ROLLBACK, data tidak berubah):%', log;
end $uji$;
