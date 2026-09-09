-- ============================================================================
-- 0061 — Infrastruktur peta: penyedia dapat diganti dari Panel Admin + cache hemat
--
-- LATAR (docs/riset/RISET-PETA-DAN-BIAYA.md §2.5): aplikasi memakai empat layanan
-- gratis yang MELARANG pemakaian komersial (tile.openstreetmap.org,
-- nominatim.openstreetmap.org, router.project-osrm.org, photon.komoot.io).
-- Pelanggaran terparah: `TILE_URL` ter-hardcode ke dalam APK/IPA, sehingga bila
-- diblokir peta mati di semua perangkat dan hanya bisa diperbaiki lewat rilis toko
-- baru (3–21 hari peta abu-abu).
--
-- Migrasi ini memindahkan SELURUH konfigurasi peta ke basis data:
--   • map_config   — satu baris: URL ubin, atribusi, penyedia geocode/rute, tuning hemat
--   • map_secrets  — kunci API per penyedia (pola gateway_secrets: RLS tanpa policy)
--   • map_public_config()   — RPC publik; HANYA mengembalikan yang aman dipublikasikan
--   • admin_map_status() / admin_set_map_config() — hanya admin
--   • geocode_cache + resolve_address()/cache_address() — hemat ±70% reverse geocode
--
-- Sesudah migrasi ini, pemilik berpindah penyedia dari Panel Admin → Pengaturan →
-- Peta dalam hitungan menit, TANPA membangun ulang aplikasi.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Konfigurasi peta (non-rahasia)
-- ---------------------------------------------------------------------------
create table if not exists map_config (
  id boolean primary key default true check (id),        -- satu baris saja
  tile_provider text not null default 'osm_free',        -- 'stadia' | 'mapbox' | 'osm_free'
  -- Template URL ubin. Placeholder {key} diganti server dengan kunci PUBLIK penyedia
  -- (lihat map_public_config). {z}/{x}/{y} tetap dibiarkan untuk Leaflet.
  tile_url text not null default 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  tile_attribution text not null default '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  tile_max_zoom int not null default 19 check (tile_max_zoom between 10 and 22),
  geocode_provider text not null default 'osm_free',     -- pencarian tempat + reverse geocode
  route_provider text not null default 'osm_free',       -- rute & jarak tempuh
  -- Tuning hemat (§5 riset). Disimpan di server agar bisa disetel tanpa rilis ulang.
  autocomplete_min_chars int not null default 4 check (autocomplete_min_chars between 2 and 8),
  autocomplete_debounce_ms int not null default 700 check (autocomplete_debounce_ms between 200 and 3000),
  geocode_cache_ttl_days int not null default 90 check (geocode_cache_ttl_days between 1 and 3650),
  defer_routing boolean not null default true,           -- rute sungguhan baru dipanggil saat pengguna melanjutkan
  refit_min_meters int not null default 150 check (refit_min_meters between 0 and 2000),
  driver_poll_ms int not null default 10000 check (driver_poll_ms between 3000 and 60000),
  track_max_zoom int not null default 16 check (track_max_zoom between 10 and 20),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
comment on table map_config is
  'Konfigurasi peta yang dibaca aplikasi saat mulai lewat map_public_config(). Tidak boleh dibaca langsung klien — RLS sengaja tanpa policy.';
comment on column map_config.tile_url is
  'Template URL ubin. {key} diganti kunci PUBLIK penyedia oleh map_public_config(). Kunci ubin klien WAJIB dibatasi per-domain/per-bundle di dashboard penyedia.';

alter table map_config enable row level security;         -- sengaja tanpa policy: hanya security definer & service_role
revoke all on map_config from anon, authenticated;
insert into map_config (id) values (true) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Kunci API penyedia peta — RAHASIA (pola gateway_secrets, migrasi 0016)
-- ---------------------------------------------------------------------------
-- secret_key : kunci yang TIDAK BOLEH keluar dari server (dipakai proxy/uji koneksi sisi server).
--              Tidak pernah dikirim mentah ke klien; ke admin hanya dikirim tersamar.
-- public_key : kunci yang MEMANG harus ada di klien (ubin Leaflet, autocomplete dari perangkat).
--              WAJIB dibatasi per-domain (web) dan per-bundle-id/package-name (Android/iOS)
--              di dashboard penyedia — tanpa pembatasan itu, kunci ini bisa dipakai siapa pun
--              yang membongkar APK. Ini bukan celah kode, melainkan konfigurasi akun penyedia.
create table if not exists map_secrets (
  provider text primary key,                              -- 'stadia' | 'mapbox' | 'osm_free'
  secret_key text,
  public_key text,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
comment on table map_secrets is
  'Kunci API penyedia peta. RLS nyala tanpa policy — hanya service_role & fungsi security definer. secret_key tidak pernah dikirim ke klien.';
alter table map_secrets enable row level security;        -- sengaja tanpa policy: hanya service_role
revoke all on map_secrets from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Cache reverse geocoding (riset §5.1 — perkiraan hemat 70% reverse geocode)
-- ---------------------------------------------------------------------------
-- Kunci = geohash presisi 7 (±153 m × 153 m). place-picker memanggil reverse geocode
-- pada SETIAP moveend; di kota, ribuan pengguna menggeser peta melewati petak yang sama.
-- Cache ini dibagi seluruh pengguna (bukan per sesi seperti cache dalam-memori lama).
create table if not exists geocode_cache (
  geohash7 text primary key,
  address text not null,
  provider text not null default 'unknown',
  lat double precision not null,
  lng double precision not null,
  hits int not null default 0,
  created_at timestamptz not null default now(),
  last_hit_at timestamptz not null default now()
);
comment on table geocode_cache is
  'Cache alamat hasil reverse geocode, berkunci geohash presisi 7 (±153 m). Dibaca/ditulis hanya lewat resolve_address()/cache_address().';
create index if not exists geocode_cache_created_idx on geocode_cache (created_at);
alter table geocode_cache enable row level security;      -- sengaja tanpa policy: hanya lewat RPC security definer
revoke all on geocode_cache from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. RPC publik — hanya yang aman dipublikasikan
-- ---------------------------------------------------------------------------
-- Yang TIDAK PERNAH keluar dari fungsi ini: map_secrets.secret_key.
-- Yang keluar: konfigurasi non-rahasia + public_key penyedia aktif (kunci klien),
-- karena ubin Leaflet & autocomplete memang dipanggil dari perangkat pengguna.
create or replace function map_public_config()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c map_config%rowtype; v_tile_key text; v_geo_key text; v_route_key text;
begin
  select * into c from map_config where id;
  if c.id is null then
    -- Gagal-aman: konfigurasi belum ada → kembalikan bawaan OSM gratis (khusus pengembangan).
    return jsonb_build_object(
      'tile_provider', 'osm_free',
      'tile_url', 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      'tile_attribution', '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      'tile_max_zoom', 19, 'geocode_provider', 'osm_free', 'route_provider', 'osm_free',
      'autocomplete_min_chars', 4, 'autocomplete_debounce_ms', 700, 'defer_routing', true,
      'refit_min_meters', 150, 'driver_poll_ms', 10000, 'track_max_zoom', 16,
      'uses_free_osm', true);
  end if;
  select public_key into v_tile_key from map_secrets where provider = c.tile_provider;
  select public_key into v_geo_key from map_secrets where provider = c.geocode_provider;
  select public_key into v_route_key from map_secrets where provider = c.route_provider;
  return jsonb_build_object(
    'tile_provider', c.tile_provider,
    -- {key} diganti di server: klien tidak perlu tahu dari mana kunci datang.
    'tile_url', replace(c.tile_url, '{key}', coalesce(v_tile_key, '')),
    'tile_attribution', c.tile_attribution,
    'tile_max_zoom', c.tile_max_zoom,
    'geocode_provider', c.geocode_provider,
    'geocode_key', v_geo_key,
    'route_provider', c.route_provider,
    'route_key', v_route_key,
    'autocomplete_min_chars', c.autocomplete_min_chars,
    'autocomplete_debounce_ms', c.autocomplete_debounce_ms,
    'defer_routing', c.defer_routing,
    'refit_min_meters', c.refit_min_meters,
    'driver_poll_ms', c.driver_poll_ms,
    'track_max_zoom', c.track_max_zoom,
    -- true bila salah satu layanan masih memakai endpoint gratis yang melanggar syarat pakai
    'uses_free_osm', (c.tile_provider = 'osm_free' or c.geocode_provider = 'osm_free' or c.route_provider = 'osm_free'),
    'updated_at', c.updated_at);
end $$;
grant execute on function map_public_config() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Cache reverse geocode — baca & tulis
-- ---------------------------------------------------------------------------
-- Alur klien: resolve_address() → bila miss, panggil penyedia → cache_address().
create or replace function resolve_address(p_lat double precision, p_lng double precision)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_gh text; v_row geocode_cache%rowtype; v_ttl int;
begin
  if p_lat is null or p_lng is null or p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180 then
    return jsonb_build_object('hit', false, 'address', null);
  end if;
  v_gh := st_geohash(st_setsrid(st_makepoint(p_lng, p_lat), 4326), 7);
  v_ttl := coalesce((select geocode_cache_ttl_days from map_config where id), 90);
  select * into v_row from geocode_cache where geohash7 = v_gh and created_at > now() - make_interval(days => v_ttl);
  if v_row.geohash7 is null then
    return jsonb_build_object('hit', false, 'address', null, 'geohash', v_gh);
  end if;
  update geocode_cache set hits = hits + 1, last_hit_at = now() where geohash7 = v_gh;
  return jsonb_build_object('hit', true, 'address', v_row.address, 'provider', v_row.provider, 'geohash', v_gh);
end $$;
grant execute on function resolve_address(double precision, double precision) to anon, authenticated;

-- Menulis hasil penyedia ke cache. Sengaja "insert bila belum ada" (bukan overwrite):
-- pengguna mana pun bisa memanggilnya, jadi entri yang sudah ada tidak boleh ditimpa.
-- Nilai divalidasi (panjang alamat & rentang koordinat) agar cache tidak diracuni sampah.
create or replace function cache_address(p_lat double precision, p_lng double precision, p_address text, p_provider text default 'unknown')
returns boolean language plpgsql security definer set search_path = public as $$
declare v_gh text; v_addr text;
begin
  if auth.uid() is null then return false; end if;                    -- hanya pengguna terautentikasi yang boleh menulis
  v_addr := btrim(coalesce(p_address, ''));
  if length(v_addr) < 3 or length(v_addr) > 200 then return false; end if;
  if p_lat is null or p_lng is null or p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180 then return false; end if;
  v_gh := st_geohash(st_setsrid(st_makepoint(p_lng, p_lat), 4326), 7);
  insert into geocode_cache (geohash7, address, provider, lat, lng)
  values (v_gh, v_addr, coalesce(nullif(btrim(p_provider), ''), 'unknown'), p_lat, p_lng)
  on conflict (geohash7) do nothing;
  return true;
end $$;
grant execute on function cache_address(double precision, double precision, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Panel Admin — status & penyimpanan konfigurasi
-- ---------------------------------------------------------------------------
create or replace function admin_map_status()
returns jsonb language plpgsql security definer set search_path = public as $$
declare c map_config%rowtype;
begin
  if not is_admin() then raise exception 'Hanya admin'; end if;
  select * into c from map_config where id;
  return jsonb_build_object(
    'tile_provider', c.tile_provider, 'tile_url', c.tile_url, 'tile_attribution', c.tile_attribution,
    'tile_max_zoom', c.tile_max_zoom, 'geocode_provider', c.geocode_provider, 'route_provider', c.route_provider,
    'autocomplete_min_chars', c.autocomplete_min_chars, 'autocomplete_debounce_ms', c.autocomplete_debounce_ms,
    'geocode_cache_ttl_days', c.geocode_cache_ttl_days, 'defer_routing', c.defer_routing,
    'refit_min_meters', c.refit_min_meters, 'driver_poll_ms', c.driver_poll_ms, 'track_max_zoom', c.track_max_zoom,
    'uses_free_osm', (c.tile_provider = 'osm_free' or c.geocode_provider = 'osm_free' or c.route_provider = 'osm_free'),
    'updated_at', c.updated_at, 'updated_by', (select full_name from profiles where id = c.updated_by),
    -- Kunci ditampilkan TERSAMAR. secret_key tidak pernah dikirim utuh, bahkan ke admin.
    'providers', coalesce((select jsonb_object_agg(s.provider, jsonb_build_object(
        'has_secret', coalesce(s.secret_key, '') <> '',
        'secret_masked', case when coalesce(s.secret_key, '') = '' then null
                              else left(s.secret_key, 4) || '••••' || right(s.secret_key, 4) end,
        'has_public', coalesce(s.public_key, '') <> '',
        'public_masked', case when coalesce(s.public_key, '') = '' then null
                              else left(s.public_key, 4) || '••••' || right(s.public_key, 4) end,
        'updated_at', s.updated_at)) from map_secrets s), '{}'::jsonb),
    'cache', (select jsonb_build_object('rows', count(*), 'hits', coalesce(sum(hits), 0),
        'last_7d', count(*) filter (where created_at > now() - interval '7 days')) from geocode_cache));
end $$;
grant execute on function admin_map_status() to authenticated;

create or replace function admin_set_map_config(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_prov text;
begin
  if not is_admin() then raise exception 'Hanya admin'; end if;

  update map_config set
    tile_provider = coalesce(nullif(btrim(p->>'tile_provider'), ''), tile_provider),
    tile_url = coalesce(nullif(btrim(p->>'tile_url'), ''), tile_url),
    tile_attribution = coalesce(nullif(btrim(p->>'tile_attribution'), ''), tile_attribution),
    tile_max_zoom = coalesce((p->>'tile_max_zoom')::int, tile_max_zoom),
    geocode_provider = coalesce(nullif(btrim(p->>'geocode_provider'), ''), geocode_provider),
    route_provider = coalesce(nullif(btrim(p->>'route_provider'), ''), route_provider),
    autocomplete_min_chars = coalesce((p->>'autocomplete_min_chars')::int, autocomplete_min_chars),
    autocomplete_debounce_ms = coalesce((p->>'autocomplete_debounce_ms')::int, autocomplete_debounce_ms),
    geocode_cache_ttl_days = coalesce((p->>'geocode_cache_ttl_days')::int, geocode_cache_ttl_days),
    defer_routing = coalesce((p->>'defer_routing')::boolean, defer_routing),
    refit_min_meters = coalesce((p->>'refit_min_meters')::int, refit_min_meters),
    driver_poll_ms = coalesce((p->>'driver_poll_ms')::int, driver_poll_ms),
    track_max_zoom = coalesce((p->>'track_max_zoom')::int, track_max_zoom),
    updated_at = now(), updated_by = auth.uid()
  where id;

  -- Kunci penyedia. Kunci kosong = "jangan ubah"; kirim clear_secret/clear_public untuk menghapus.
  if p ? 'key_provider' then
    v_prov := nullif(btrim(p->>'key_provider'), '');
    if v_prov is not null then
      insert into map_secrets (provider, secret_key, public_key, updated_by)
      values (v_prov, nullif(btrim(p->>'secret_key'), ''), nullif(btrim(p->>'public_key'), ''), auth.uid())
      on conflict (provider) do update set
        secret_key = case when coalesce(btrim(p->>'secret_key'), '') <> '' then btrim(p->>'secret_key')
                          when coalesce((p->>'clear_secret')::boolean, false) then null
                          else map_secrets.secret_key end,
        public_key = case when coalesce(btrim(p->>'public_key'), '') <> '' then btrim(p->>'public_key')
                          when coalesce((p->>'clear_public')::boolean, false) then null
                          else map_secrets.public_key end,
        updated_at = now(), updated_by = auth.uid();
    end if;
  end if;

  -- Log tanpa membocorkan kunci: hanya dicatat penyedia mana yang disentuh.
  perform log_activity('map_config', 'map_config', 'peta', 'Konfigurasi peta diubah',
    jsonb_build_object('tile_provider', p->>'tile_provider', 'geocode_provider', p->>'geocode_provider',
      'route_provider', p->>'route_provider', 'key_provider', p->>'key_provider',
      'secret_changed', coalesce(btrim(p->>'secret_key'), '') <> '', 'public_changed', coalesce(btrim(p->>'public_key'), '') <> ''));
  return admin_map_status();
end $$;
grant execute on function admin_set_map_config(jsonb) to authenticated;

-- Uji koneksi dari Panel Admin: mengembalikan URL siap-pakai (kunci publik sudah disisipkan)
-- agar tombol "Uji" benar-benar memanggil satu ubin + satu geocode dari peramban admin.
-- secret_key tidak ikut; yang dikirim hanya kunci yang memang sudah ada di klien.
create or replace function admin_map_probe_urls(p_lat double precision default 0.5071, p_lng double precision default 101.4478)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c map_config%rowtype; v_tile text; v_geo text; v_geo_url text; v_route_key text; v_route_url text;
begin
  if not is_admin() then raise exception 'Hanya admin'; end if;
  select * into c from map_config where id;
  select public_key into v_tile from map_secrets where provider = c.tile_provider;
  select public_key into v_geo from map_secrets where provider = c.geocode_provider;
  select public_key into v_route_key from map_secrets where provider = c.route_provider;

  v_geo_url := case c.geocode_provider
    when 'stadia' then 'https://api.stadiamaps.com/geocoding/v1/reverse?point.lat=' || p_lat || '&point.lon=' || p_lng || '&size=1&api_key=' || coalesce(v_geo, '')
    when 'mapbox' then 'https://api.mapbox.com/geocoding/v5/mapbox.places/' || p_lng || ',' || p_lat || '.json?limit=1&access_token=' || coalesce(v_geo, '')
    else 'https://nominatim.openstreetmap.org/reverse?lat=' || p_lat || '&lon=' || p_lng || '&format=jsonv2&zoom=18' end;

  v_route_url := case c.route_provider
    when 'stadia' then 'https://api.stadiamaps.com/route/v1?api_key=' || coalesce(v_route_key, '')
    when 'mapbox' then 'https://api.mapbox.com/directions/v5/mapbox/driving/' || p_lng || ',' || p_lat || ';' || (p_lng + 0.01) || ',' || (p_lat + 0.01) || '?overview=false&access_token=' || coalesce(v_route_key, '')
    else 'https://router.project-osrm.org/route/v1/driving/' || p_lng || ',' || p_lat || ';' || (p_lng + 0.01) || ',' || (p_lat + 0.01) || '?overview=false' end;

  return jsonb_build_object(
    -- satu ubin nyata di sekitar Pekanbaru pada zoom 14
    'tile_url', replace(replace(replace(replace(c.tile_url, '{key}', coalesce(v_tile, '')), '{z}', '14'), '{x}', '12921'), '{y}', '8154'),
    'geocode_url', v_geo_url,
    'route_url', v_route_url,
    'route_method', case when c.route_provider = 'stadia' then 'POST' else 'GET' end,
    'tile_provider', c.tile_provider, 'geocode_provider', c.geocode_provider, 'route_provider', c.route_provider);
end $$;
grant execute on function admin_map_probe_urls(double precision, double precision) to authenticated;
