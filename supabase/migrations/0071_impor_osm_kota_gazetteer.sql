-- =====================================================================
-- 0071 — Gazetteer kota/kabupaten se-Indonesia untuk impor OpenStreetMap
--
-- Tabel `cities` sebelumnya hanya berisi 9 kota layanan. Untuk data tempat
-- se-Indonesia kita butuh daftar LENGKAP kota & kabupaten (±514 baris) sebagai
-- rujukan geografis: setiap apotek/pasar/toko/faskes ditempelkan ke wilayah
-- administratif terdekat.
--
-- ARTI KOLOM LAMA TIDAK DIUBAH.
--   `cities.active`         — sakelar lama ("melayani"), dipakai nearest_city()
--                             pada pemeriksaan jarak & aturan satu-kota.
--   `cities.service_status` — sakelar layanan baru milik agen lain
--                             ('belum_dilayani' | 'segera' | 'aktif').
--   Baris hasil impor OSM masuk dengan active = FALSE dan service_status
--   biarkan default 'belum_dilayani', jadi menambah gazetteer TIDAK membuat
--   satu pun kota baru dianggap dilayani. Yang membedakan "kota rujukan" dari
--   "kota layanan" adalah kolom BARU `source` ('admin' vs 'osm').
--
-- Catatan: cities.lat/lng adalah kolom GENERATED dari `location`; semua
-- penulisan koordinat dilakukan lewat `location`.
-- =====================================================================

alter table cities
  add column if not exists osm_id      text,
  add column if not exists kind        text not null default 'kota',
  add column if not exists population  integer,
  add column if not exists source      text not null default 'admin',
  add column if not exists imported_at timestamptz;

do $$ begin
  alter table cities add constraint cities_kind_chk check (kind in ('kota','kabupaten','provinsi','lainnya'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table cities add constraint cities_source_chk check (source in ('admin','osm'));
exception when duplicate_object then null; end $$;

create unique index if not exists cities_osm_id on cities (osm_id) where osm_id is not null;
create index if not exists cities_location_gix on cities using gist (location);
create index if not exists cities_province_idx on cities (province);
create index if not exists cities_source_idx on cities (source);

comment on column cities.active is
  'Sakelar LAYANAN lama: true = AntarKita melayani kota ini (dipakai nearest_city / batas satu-kota). '
  'BUKAN penanda "data valid". Baris gazetteer hasil impor OSM selalu active = false '
  '(sakelar layanan yang berlaku sekarang ada di kolom service_status).';
comment on column cities.source is 'admin = kota layanan yang diisi manusia; osm = baris gazetteer hasil impor OpenStreetMap.';
comment on column cities.kind is 'kota | kabupaten | provinsi | lainnya — mengikuti batas administratif OSM.';
comment on column cities.osm_id is 'Kunci dedupe OSM, format "relation/123". Dipakai juga sebagai area Overpass: area(3600000000 + id).';
comment on column cities.population is 'Penduduk menurut tag OSM population (bila tersedia) — dipakai mengurutkan prioritas impor.';

-- ---------------------------------------------------------------------
-- Pencarian kota untuk PENEMPELAN DATA (bukan untuk aturan layanan)
-- nearest_city() hanya melihat kota aktif — benar untuk aturan layanan,
-- tetapi SALAH untuk menempelkan tempat: apotek di Surabaya tidak boleh
-- menempel ke Padang hanya karena Padang kebetulan kota aktif terdekat.
-- Fungsi ini melihat SELURUH gazetteer dan WAJIB punya batas jarak.
-- ---------------------------------------------------------------------
create or replace function nearest_city_any(p_lat double precision, p_lng double precision, p_max_km numeric default null)
returns uuid language sql stable security definer set search_path = public as $$
  select c.id from cities c
   where c.location is not null
     and st_dwithin(c.location, st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography,
                    coalesce(p_max_km, setting_num('osm_city_assign_max_km', 60)) * 1000)
   order by st_distance(c.location, st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography)
   limit 1
$$;
comment on function nearest_city_any(double precision, double precision, numeric) is
  'Kota/kabupaten TERDEKAT dalam batas jarak (default app_settings.osm_city_assign_max_km = 60 km), '
  'tanpa melihat kolom active/service_status. NULL bila tidak ada yang masuk batas — dipakai impor tempat.';
grant execute on function nearest_city_any(double precision, double precision, numeric) to authenticated;
revoke execute on function nearest_city_any(double precision, double precision, numeric) from anon;

insert into app_settings (key, value) values
  ('osm_city_assign_max_km', '60'),
  ('osm_import_max_per_task', '600'),
  ('osm_import_pause_ms', '1500')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- Upsert kota hasil impor OSM. Idempoten lewat osm_id; kota lama (9 kota
-- layanan) DIADOPSI berdasarkan nama sehingga tidak tergandakan dan tidak
-- kehilangan status layanannya.
-- ---------------------------------------------------------------------
create or replace function osm_upsert_cities(p_places jsonb, p_province text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  it jsonb; v_ins int := 0; v_upd int := 0; v_skip int := 0;
  v_osm text; v_raw text; v_name text; v_kind text; v_prov text; v_lat double precision; v_lng double precision;
  v_pop int; v_id uuid; v_try text; v_n int; v_pt geography;
begin
  for it in select * from jsonb_array_elements(coalesce(p_places, '[]'::jsonb)) loop
    v_osm := nullif(trim(coalesce(it->>'osm_id','')), '');
    v_raw := trim(coalesce(it->>'name',''));
    v_lat := nullif(it->>'lat','')::double precision;
    v_lng := nullif(it->>'lng','')::double precision;
    v_pop := nullif(regexp_replace(coalesce(it->>'population',''), '[^0-9]', '', 'g'), '')::int;
    v_prov := coalesce(nullif(trim(coalesce(it->>'province','')), ''), p_province);
    -- kotak Indonesia: buang koordinat yang jelas di luar wilayah
    if length(v_raw) < 3 or v_lat is null or v_lng is null
       or v_lat < -11.5 or v_lat > 7.5 or v_lng < 94 or v_lng > 142 then
      v_skip := v_skip + 1; continue;
    end if;
    v_pt := st_setsrid(st_makepoint(v_lng, v_lat), 4326)::geography;
    -- "Kota Padang" → kota/Padang ; "Kabupaten Agam" → kabupaten/Kabupaten Agam
    if v_raw ilike 'kota administrasi %' then v_kind := 'kota'; v_name := trim(substr(v_raw, 18));
    elsif v_raw ilike 'kota %'      then v_kind := 'kota';      v_name := trim(substr(v_raw, 6));
    elsif v_raw ilike 'kabupaten %' then v_kind := 'kabupaten'; v_name := v_raw;
    else v_kind := 'kota'; v_name := v_raw; end if;

    v_id := null;
    if v_osm is not null then select id into v_id from cities where osm_id = v_osm; end if;
    if v_id is null then  -- adopsi baris lama yang namanya sama (kota layanan yang sudah ada)
      select id into v_id from cities
       where lower(name) in (lower(v_name), lower(v_raw))
       order by (source = 'admin') desc limit 1;
    end if;

    if v_id is not null then
      update cities set
        osm_id     = coalesce(v_osm, osm_id),
        kind       = v_kind,
        province   = coalesce(v_prov, province),
        population = coalesce(v_pop, population),
        -- titik kota layanan yang diisi admin TIDAK ditimpa; hanya baris OSM yang disegarkan
        location   = case when source = 'osm' or location is null then v_pt else location end,
        imported_at = now()
      where id = v_id;
      v_upd := v_upd + 1;
    else
      -- cities.name unik secara global: bila bentrok, bubuhi provinsi (lalu id OSM)
      v_try := v_name; v_n := 0;
      while exists (select 1 from cities where lower(name) = lower(v_try)) loop
        v_n := v_n + 1;
        v_try := case when v_n = 1 and v_prov is not null then v_name || ' (' || v_prov || ')'
                      else v_name || ' (' || coalesce(v_osm, v_n::text) || ')' end;
        exit when v_n > 2;
      end loop;
      insert into cities (name, province, location, active, osm_id, kind, population, source, imported_at)
      values (v_try, v_prov, v_pt, false, v_osm, v_kind, v_pop, 'osm', now());
      v_ins := v_ins + 1;
    end if;
  end loop;
  return jsonb_build_object('inserted', v_ins, 'updated', v_upd, 'skipped', v_skip);
end $$;
comment on function osm_upsert_cities(jsonb, text) is
  'Simpan kota/kabupaten hasil Overpass. Baris baru SELALU active = false & service_status default '
  '(belum_dilayani) — gazetteer bukan daftar kota yang dilayani.';
revoke all on function osm_upsert_cities(jsonb, text) from public, anon, authenticated;
grant execute on function osm_upsert_cities(jsonb, text) to service_role;

-- =====================================================================
-- 0071b (revisi, diterapkan terpisah) — gazetteer tidak boleh MENYAINGI kota layanan
--
-- Agen lain menambahkan city_at_point() / city_gate(): keduanya memilih kota
-- TERDEKAT dari seluruh isi tabel `cities`, lalu memakai service_status kota itu
-- untuk memutuskan "dilayani atau belum". Bila gazetteer nasional dimasukkan apa
-- adanya, baris baru bisa lebih dekat ke pengguna daripada kota layanan yang
-- dikurasi manusia — contoh paling jelas: "Kota Administrasi Jakarta Pusat/Selatan/…"
-- akan mengalahkan baris "Jakarta", sehingga pengguna Jakarta tiba-tiba dianggap
-- BELUM DILAYANI.
--
-- Karena itu baris gazetteer BARU tidak disisipkan bila titiknya masih berada di
-- dalam radius layanan kota ber-source 'admin' (kota kurasi manusia). Wilayah itu
-- sudah terwakili; tempat di sana tetap menempel ke kota layanan tersebut.
-- Baris yang sudah ada (dicocokkan lewat osm_id / nama) tetap diperbarui seperti biasa.
-- =====================================================================
create or replace function osm_upsert_cities(p_places jsonb, p_province text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  it jsonb; v_ins int := 0; v_upd int := 0; v_skip int := 0; v_wakil int := 0;
  v_osm text; v_raw text; v_name text; v_kind text; v_prov text; v_lat double precision; v_lng double precision;
  v_pop int; v_id uuid; v_try text; v_n int; v_pt geography;
begin
  for it in select * from jsonb_array_elements(coalesce(p_places, '[]'::jsonb)) loop
    v_osm := nullif(trim(coalesce(it->>'osm_id','')), '');
    v_raw := trim(coalesce(it->>'name',''));
    v_lat := nullif(it->>'lat','')::double precision;
    v_lng := nullif(it->>'lng','')::double precision;
    v_pop := nullif(regexp_replace(coalesce(it->>'population',''), '[^0-9]', '', 'g'), '')::int;
    v_prov := coalesce(nullif(trim(coalesce(it->>'province','')), ''), p_province);
    if length(v_raw) < 3 or v_lat is null or v_lng is null
       or v_lat < -11.5 or v_lat > 7.5 or v_lng < 94 or v_lng > 142 then
      v_skip := v_skip + 1; continue;
    end if;
    v_pt := st_setsrid(st_makepoint(v_lng, v_lat), 4326)::geography;
    if v_raw ilike 'kota administrasi %' then v_kind := 'kota'; v_name := trim(substr(v_raw, 18));
    elsif v_raw ilike 'kota %'      then v_kind := 'kota';      v_name := trim(substr(v_raw, 6));
    elsif v_raw ilike 'kabupaten %' then v_kind := 'kabupaten'; v_name := v_raw;
    else v_kind := 'kota'; v_name := v_raw; end if;

    v_id := null;
    if v_osm is not null then select id into v_id from cities where osm_id = v_osm; end if;
    if v_id is null then
      select id into v_id from cities
       where lower(name) in (lower(v_name), lower(v_raw))
       order by (source = 'admin') desc limit 1;
    end if;

    if v_id is not null then
      update cities set
        osm_id     = coalesce(v_osm, osm_id),
        kind       = v_kind,
        province   = coalesce(v_prov, province),
        population = coalesce(v_pop, population),
        location   = case when source = 'osm' or location is null then v_pt else location end,
        imported_at = now()
      where id = v_id;
      v_upd := v_upd + 1;
    else
      -- jangan menyaingi kota layanan kurasi manusia di dalam radius layanannya
      if exists (select 1 from cities c where c.source = 'admin' and c.location is not null
                   and st_dwithin(c.location, v_pt, coalesce(c.radius_km, 35) * 1000)) then
        v_wakil := v_wakil + 1; v_skip := v_skip + 1; continue;
      end if;
      v_try := v_name; v_n := 0;
      while exists (select 1 from cities where lower(name) = lower(v_try)) loop
        v_n := v_n + 1;
        v_try := case when v_n = 1 and v_prov is not null then v_name || ' (' || v_prov || ')'
                      else v_name || ' (' || coalesce(v_osm, v_n::text) || ')' end;
        exit when v_n > 2;
      end loop;
      insert into cities (name, province, location, active, osm_id, kind, population, source, imported_at)
      values (v_try, v_prov, v_pt, false, v_osm, v_kind, v_pop, 'osm', now());
      v_ins := v_ins + 1;
    end if;
  end loop;
  return jsonb_build_object('inserted', v_ins, 'updated', v_upd, 'skipped', v_skip, 'diwakili_kota_layanan', v_wakil);
end $$;
comment on function osm_upsert_cities(jsonb, text) is
  'Simpan kota/kabupaten hasil Overpass. Baris baru SELALU active = false & service_status default. '
  'Baris baru di dalam radius layanan kota ber-source admin sengaja TIDAK disisipkan agar '
  'city_at_point()/city_gate() tetap memilih kota layanan yang benar.';
revoke all on function osm_upsert_cities(jsonb, text) from public, anon, authenticated;
grant execute on function osm_upsert_cities(jsonb, text) to service_role;
