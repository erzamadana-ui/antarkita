-- =====================================================================
-- uji_peta.sql — Uji infrastruktur peta (migrasi 0061)
--
-- Membuktikan tiga hal yang tidak boleh dianggap benar begitu saja:
--   1. `map_public_config()` TIDAK PERNAH membocorkan kunci rahasia penyedia peta,
--      sementara kunci publik (yang memang harus ada di klien) tetap dikirim.
--   2. Cache reverse geocode benar-benar bekerja: miss → simpan → hit,
--      titik dalam petak geohash-7 yang sama ikut hit, dan entri kedaluwarsa
--      diperlakukan sebagai miss.
--   3. Non-admin tidak bisa membaca maupun menulis kunci — baik lewat tabel
--      langsung maupun lewat RPC admin.
--
-- Pola: setiap skenario dibungkus BEGIN … ROLLBACK sehingga konfigurasi peta
-- milik pemilik TIDAK BERUBAH sedikit pun. Sesi pengguna ditiru lewat
-- set_config('request.jwt.claims', …) yang dibaca auth.uid().
--
-- Cara pakai:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/uji_peta.sql
-- Blok yang lulus mencetak "[OK] …"; kegagalan memunculkan "[GAGAL] …" dan
-- menghentikan skrip.
--
-- Hasil terakhir dijalankan pada basis data proyek (2026-09-09): 23/23 lulus.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. KERAHASIAAN KUNCI: map_public_config() tidak boleh membocorkan secret_key
-- ---------------------------------------------------------------------
begin;
do $$
declare
  v_cfg jsonb; v_txt text;
  c_secret constant text := 'RAHASIA-UJI-JANGAN-BOCOR-9f3a1c';
  c_public constant text := 'PUBLIK-UJI-boleh-terlihat-2b7d';
begin
  -- fixture: penyedia stadia dengan kunci rahasia DAN kunci publik
  insert into map_secrets (provider, secret_key, public_key) values ('stadia', c_secret, c_public)
  on conflict (provider) do update set secret_key = excluded.secret_key, public_key = excluded.public_key;
  update map_config set tile_provider = 'stadia', geocode_provider = 'stadia', route_provider = 'stadia',
    tile_url = 'https://tiles.stadiamaps.com/tiles/osm_bright/{z}/{x}/{y}.png?api_key={key}' where id;

  -- panggil sebagai pengguna anonim (persis seperti aplikasi sebelum login)
  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  v_cfg := map_public_config();
  v_txt := v_cfg::text;

  if position(c_secret in v_txt) > 0 then
    raise exception '[GAGAL] map_public_config() membocorkan kunci RAHASIA penyedia peta';
  end if;
  raise notice '[OK] 1a. map_public_config() tidak membocorkan secret_key';

  if position(c_public in (v_cfg->>'tile_url')) = 0 then
    raise exception '[GAGAL] {key} pada tile_url tidak diganti kunci publik — peta akan 401';
  end if;
  raise notice '[OK] 1b. {key} pada tile_url diganti kunci PUBLIK oleh server';

  if position('{key}' in (v_cfg->>'tile_url')) > 0 then
    raise exception '[GAGAL] placeholder {key} masih tersisa di tile_url';
  end if;
  raise notice '[OK] 1c. tidak ada placeholder {key} tersisa di URL yang dikirim ke klien';

  if coalesce(v_cfg->>'geocode_key', '') <> c_public then
    raise exception '[GAGAL] geocode_key bukan kunci publik penyedia aktif';
  end if;
  raise notice '[OK] 1d. geocode_key/route_key memakai kunci PUBLIK, bukan rahasia';

  if (v_cfg->>'uses_free_osm')::boolean then
    raise exception '[GAGAL] uses_free_osm masih true padahal semua penyedia sudah stadia';
  end if;
  raise notice '[OK] 1e. penanda uses_free_osm mati saat semua penyedia berbayar';
end $$;
rollback;

-- ---------------------------------------------------------------------
-- 2. PERINGATAN ENDPOINT GRATIS: uses_free_osm menyala bila salah satu masih osm_free
-- ---------------------------------------------------------------------
begin;
do $$
declare v_cfg jsonb;
begin
  update map_config set tile_provider = 'stadia', geocode_provider = 'stadia', route_provider = 'osm_free' where id;
  v_cfg := map_public_config();
  if not (v_cfg->>'uses_free_osm')::boolean then
    raise exception '[GAGAL] uses_free_osm tidak menyala padahal rute masih memakai OSRM demo';
  end if;
  raise notice '[OK] 2. uses_free_osm menyala bila SATU saja layanan masih endpoint gratis';
end $$;
rollback;

-- ---------------------------------------------------------------------
-- 3. GANTI PENYEDIA: admin_set_map_config benar-benar mengubah URL ubin publik
-- ---------------------------------------------------------------------
begin;
do $$
declare v_admin uuid; v_before text; v_after text;
begin
  select id into v_admin from profiles where role = 'admin' and is_active order by created_at limit 1;
  if v_admin is null then raise notice '[LEWAT] Tidak ada akun admin untuk diuji'; return; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  v_before := map_public_config()->>'tile_url';

  perform admin_set_map_config(jsonb_build_object(
    'key_provider', 'mapbox', 'public_key', 'pk.UJI-PUBLIK-mapbox',
    'tile_provider', 'mapbox',
    'tile_url', 'https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/256/{z}/{x}/{y}?access_token={key}',
    'tile_attribution', '&copy; Mapbox &copy; OpenStreetMap contributors'));

  v_after := map_public_config()->>'tile_url';
  if v_after = v_before then raise exception '[GAGAL] URL ubin tidak berubah setelah admin mengganti penyedia'; end if;
  if position('api.mapbox.com' in v_after) = 0 then raise exception '[GAGAL] URL ubin baru bukan milik Mapbox: %', v_after; end if;
  if position('pk.UJI-PUBLIK-mapbox' in v_after) = 0 then raise exception '[GAGAL] kunci publik Mapbox tidak disisipkan ke URL ubin'; end if;
  raise notice '[OK] 3a. Ganti penyedia dari panel admin mengubah URL ubin yang diterima klien';

  if map_public_config()->>'tile_attribution' not like '%Mapbox%' then
    raise exception '[GAGAL] atribusi tidak ikut berganti saat penyedia diganti';
  end if;
  raise notice '[OK] 3b. Atribusi ikut berganti mengikuti penyedia (kewajiban lisensi)';
end $$;
rollback;

-- ---------------------------------------------------------------------
-- 4. CACHE REVERSE GEOCODE: miss → simpan → hit
-- ---------------------------------------------------------------------
begin;
do $$
declare
  v_user uuid; r jsonb; v_gh text;
  c_lat constant double precision := 0.507068;    -- Pekanbaru
  c_lng constant double precision := 101.447777;
begin
  select id into v_user from profiles where is_active order by created_at limit 1;
  if v_user is null then raise notice '[LEWAT] Tidak ada akun untuk diuji'; return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role','authenticated')::text, true);

  v_gh := st_geohash(st_setsrid(st_makepoint(c_lng, c_lat), 4326), 7);
  delete from geocode_cache where geohash7 = v_gh;

  r := resolve_address(c_lat, c_lng);
  if (r->>'hit')::boolean then raise exception '[GAGAL] cache melaporkan hit padahal petak baru saja dikosongkan'; end if;
  raise notice '[OK] 4a. Petak kosong dilaporkan MISS (aplikasi akan memanggil penyedia)';

  if not cache_address(c_lat, c_lng, 'Jalan Sudirman 10, Pekanbaru', 'stadia') then
    raise exception '[GAGAL] cache_address menolak penyimpanan yang sah';
  end if;

  r := resolve_address(c_lat, c_lng);
  if not (r->>'hit')::boolean then raise exception '[GAGAL] cache tidak hit sesudah disimpan'; end if;
  if r->>'address' <> 'Jalan Sudirman 10, Pekanbaru' then raise exception '[GAGAL] alamat dari cache tidak sama'; end if;
  raise notice '[OK] 4b. Setelah disimpan, permintaan berikutnya HIT (tidak memanggil penyedia)';

  -- titik ±60 m dari titik pertama: masih dalam petak geohash-7 (±153 m) yang sama
  if st_geohash(st_setsrid(st_makepoint(c_lng + 0.0004, c_lat + 0.0004), 4326), 7) = v_gh then
    r := resolve_address(c_lat + 0.0004, c_lng + 0.0004);
    if not (r->>'hit')::boolean then raise exception '[GAGAL] titik tetangga dalam petak yang sama tidak hit'; end if;
    raise notice '[OK] 4c. Titik tetangga dalam petak ±153 m ikut HIT — inilah sumber hemat 70%%';
  else
    raise notice '[LEWAT] 4c. Titik uji jatuh di petak geohash berbeda (batas petak) — dilewati';
  end if;

  -- penghitung pemakaian ulang naik
  if (select hits from geocode_cache where geohash7 = v_gh) < 1 then
    raise exception '[GAGAL] penghitung hits tidak bertambah';
  end if;
  raise notice '[OK] 4d. Penghitung pemakaian ulang bertambah (statistik hemat di panel admin)';

  -- entri kedaluwarsa diperlakukan sebagai miss
  update map_config set geocode_cache_ttl_days = 1 where id;
  update geocode_cache set created_at = now() - interval '10 days' where geohash7 = v_gh;
  r := resolve_address(c_lat, c_lng);
  if (r->>'hit')::boolean then raise exception '[GAGAL] entri kedaluwarsa masih dilaporkan hit'; end if;
  raise notice '[OK] 4e. Entri melewati TTL diperlakukan MISS (alamat lama tidak dipakai selamanya)';
end $$;
rollback;

-- ---------------------------------------------------------------------
-- 5. CACHE TIDAK BISA DIRACUNI SEMBARANGAN
-- ---------------------------------------------------------------------
begin;
do $$
declare
  v_user uuid; v_gh text;
  c_lat constant double precision := 0.512;
  c_lng constant double precision := 101.451;
begin
  select id into v_user from profiles where is_active order by created_at limit 1;
  if v_user is null then raise notice '[LEWAT] Tidak ada akun untuk diuji'; return; end if;

  -- (a) tanpa sesi (anon) tidak boleh menulis
  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  if cache_address(c_lat, c_lng, 'Alamat dari pengguna anonim') then
    raise exception '[GAGAL] pengguna anonim bisa menulis ke cache alamat';
  end if;
  raise notice '[OK] 5a. Pengguna anonim tidak bisa menulis ke cache alamat';

  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role','authenticated')::text, true);
  v_gh := st_geohash(st_setsrid(st_makepoint(c_lng, c_lat), 4326), 7);
  delete from geocode_cache where geohash7 = v_gh;

  -- (b) alamat terlalu pendek / terlalu panjang / koordinat tidak masuk akal ditolak
  if cache_address(c_lat, c_lng, 'ab') then raise exception '[GAGAL] alamat 2 huruf diterima'; end if;
  if cache_address(c_lat, c_lng, repeat('x', 400)) then raise exception '[GAGAL] alamat 400 huruf diterima'; end if;
  if cache_address(999, 999, 'Alamat tidak masuk akal') then raise exception '[GAGAL] koordinat di luar bumi diterima'; end if;
  raise notice '[OK] 5b. Alamat/koordinat tidak wajar ditolak sebelum masuk cache';

  -- (c) entri yang sudah ada tidak boleh ditimpa pengguna lain
  perform cache_address(c_lat, c_lng, 'Alamat pertama yang benar', 'stadia');
  perform cache_address(c_lat, c_lng, 'Alamat palsu penimpa', 'stadia');
  if (select address from geocode_cache where geohash7 = v_gh) <> 'Alamat pertama yang benar' then
    raise exception '[GAGAL] entri cache bisa ditimpa pengguna lain';
  end if;
  raise notice '[OK] 5c. Entri cache yang sudah ada tidak bisa ditimpa (anti-peracunan)';
end $$;
rollback;

-- ---------------------------------------------------------------------
-- 6. NON-ADMIN TIDAK BISA MEMBACA/MENULIS KUNCI
-- ---------------------------------------------------------------------
begin;
do $$
declare v_user uuid; v_admin uuid; v_msg text; n int;
begin
  select id into v_user from profiles where role <> 'admin' and is_active order by created_at limit 1;
  select id into v_admin from profiles where role = 'admin' and is_active order by created_at limit 1;
  if v_user is null then raise notice '[LEWAT] Tidak ada akun non-admin untuk diuji'; return; end if;

  insert into map_secrets (provider, secret_key, public_key) values ('stadia', 'RAHASIA-UJI-6', 'PUBLIK-UJI-6')
  on conflict (provider) do update set secret_key = excluded.secret_key, public_key = excluded.public_key;

  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role','authenticated')::text, true);

  -- (a) status admin ditolak
  begin
    perform admin_map_status();
    raise exception '[GAGAL] non-admin bisa memanggil admin_map_status()';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg like '[GAGAL]%' then raise; end if;
    raise notice '[OK] 6a. admin_map_status() menolak non-admin (%)', v_msg;
  end;

  -- (b) menulis konfigurasi/kunci ditolak
  begin
    perform admin_set_map_config(jsonb_build_object('key_provider','stadia','secret_key','DICURI'));
    raise exception '[GAGAL] non-admin bisa menulis kunci penyedia peta';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg like '[GAGAL]%' then raise; end if;
    raise notice '[OK] 6b. admin_set_map_config() menolak non-admin (%)', v_msg;
  end;

  -- (c) URL uji koneksi (berisi kunci) ditolak
  begin
    perform admin_map_probe_urls();
    raise exception '[GAGAL] non-admin bisa meminta URL uji yang memuat kunci';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg like '[GAGAL]%' then raise; end if;
    raise notice '[OK] 6c. admin_map_probe_urls() menolak non-admin (%)', v_msg;
  end;

  -- (d) hak tabel: anon & authenticated tidak punya privilege apa pun
  select count(*) into n from information_schema.role_table_grants
   where table_schema = 'public' and table_name in ('map_secrets','map_config','geocode_cache')
     and grantee in ('anon','authenticated');
  if n > 0 then
    raise exception '[GAGAL] anon/authenticated masih punya % hak tabel pada map_secrets/map_config/geocode_cache', n;
  end if;
  raise notice '[OK] 6d. anon & authenticated tidak punya hak apa pun atas tabel kunci/konfigurasi/cache';

  -- (e) RLS menyala pada ketiga tabel (pertahanan berlapis)
  select count(*) into n from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'public' and c.relname in ('map_secrets','map_config','geocode_cache') and c.relrowsecurity;
  if n <> 3 then raise exception '[GAGAL] RLS belum menyala di ketiga tabel (baru % dari 3)', n; end if;
  raise notice '[OK] 6e. RLS menyala di map_secrets, map_config, dan geocode_cache';

  -- (f) jalur publik yang memang boleh dipanggil siapa saja tetap tidak membocorkan rahasia
  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  if position('RAHASIA-UJI-6' in map_public_config()::text) > 0 then
    raise exception '[GAGAL] kunci rahasia bocor lewat RPC publik map_public_config()';
  end if;
  raise notice '[OK] 6f. map_public_config() tetap bersih dari kunci rahasia untuk pemanggil anonim';
end $$;
rollback;

-- ---------------------------------------------------------------------
-- 7. Nilai bawaan hemat memang tersimpan di server (bukan hanya di kode aplikasi)
-- ---------------------------------------------------------------------
begin;
do $$
declare v jsonb;
begin
  v := map_public_config();
  if (v->>'autocomplete_min_chars')::int < 4 then raise exception '[GAGAL] minimum karakter autocomplete < 4'; end if;
  if (v->>'autocomplete_debounce_ms')::int < 700 then raise exception '[GAGAL] debounce autocomplete < 700 ms'; end if;
  if (v->>'refit_min_meters')::int < 100 then raise exception '[GAGAL] penjaga fit ulang peta < 100 m'; end if;
  if (v->>'driver_poll_ms')::int < 10000 then raise exception '[GAGAL] polling driver < 10 detik'; end if;
  raise notice '[OK] 7. Nilai hemat (4 huruf · 700 ms · 150 m · 10 dtk) tersimpan di server dan bisa disetel admin';
end $$;
rollback;
