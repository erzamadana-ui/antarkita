-- =====================================================================
-- 0074 — Penyimpanan tempat hasil OSM + PERBAIKAN CACAT penetapan kota
--
-- CACAT LAMA (0021, import_places):
--     v_city := (select id from cities where active order by st_distance(...) limit 1);
--   Tanpa batas jarak dan hanya melihat kota AKTIF. Dengan data nasional, apotek
--   di Surabaya akan menempel ke Padang hanya karena Padang kota aktif terdekat.
--
-- PERBAIKAN:
--   * penetapan kota memakai nearest_city_any() → seluruh gazetteer + BATAS JARAK
--     (app_settings.osm_city_assign_max_km, default 60 km);
--   * bila tak ada kota dalam batas → city_id NULL (bukan kota asal-asalan).
--     Baris tanpa kota tetap tersimpan dan dihitung di panel admin ("tanpa kota");
--   * tugas impor per-kota mengirim p_city_id (kota area Overpass); nilai itu hanya
--     dipakai bila titiknya memang masih dalam jangkauan wajar kota tersebut.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Kota untuk sebuah titik: berbatas jarak, boleh NULL.
-- ---------------------------------------------------------------------
create or replace function place_city_id(p_lat double precision, p_lng double precision, p_hint uuid default null)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare v_max numeric := setting_num('osm_city_assign_max_km', 60); v_id uuid;
begin
  if p_lat is null or p_lng is null then return null; end if;
  -- petunjuk dari tugas impor (kota area Overpass) dipakai bila titik masih masuk akal
  if p_hint is not null then
    select c.id into v_id from cities c
     where c.id = p_hint and c.location is not null
       and st_dwithin(c.location, st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography, (v_max * 2) * 1000);
    if v_id is not null then return v_id; end if;
  end if;
  return nearest_city_any(p_lat, p_lng, v_max);
end $$;
comment on function place_city_id(double precision, double precision, uuid) is
  'Kota untuk sebuah tempat: kota terdekat dalam batas osm_city_assign_max_km (NULL bila tidak ada). '
  'Menggantikan pola lama "kota aktif terdekat tanpa batas jarak".';
revoke all on function place_city_id(double precision, double precision, uuid) from public, anon;
grant execute on function place_city_id(double precision, double precision, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Simpan hasil Overpass (dipanggil Edge Function dengan service_role).
-- Idempoten: osm_id adalah kunci dedupe; baris lama tanpa osm_id yang berdekatan
-- & senama DIADOPSI (diberi osm_id) supaya tidak tergandakan.
-- Kolom `active` TIDAK PERNAH ditimpa saat memperbarui: penonaktifan oleh admin bertahan.
-- ---------------------------------------------------------------------
create or replace function osm_upsert_places(p_kind text, p_places jsonb, p_city_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  it jsonb; v_ins int := 0; v_upd int := 0; v_skip int := 0; v_n int := 0;
  v_counts jsonb := '{}'::jsonb; v_key text;
  v_name text; v_lat double precision; v_lng double precision; v_osm text; v_pt geography;
  v_brand text; v_cat text; v_kind text; v_city uuid; v_id uuid;
begin
  if p_kind not in ('store','market','faskes') then raise exception 'Jenis tempat tidak dikenal: %', p_kind; end if;
  if not coalesce((select value::text::boolean from app_settings where key = 'osm_import_enabled'), true) then
    return jsonb_build_object('inserted', 0, 'updated', 0, 'skipped', 0, 'disabled', true);
  end if;

  for it in select * from jsonb_array_elements(coalesce(p_places, '[]'::jsonb)) loop
    v_n := v_n + 1; exit when v_n > 3000;
    v_name := trim(coalesce(it->>'name', ''));
    v_lat := nullif(it->>'lat','')::double precision;
    v_lng := nullif(it->>'lng','')::double precision;
    v_osm := nullif(trim(coalesce(it->>'osm_id','')), '');
    if length(v_name) < 3 or v_lat is null or v_lng is null
       or v_lat < -11.5 or v_lat > 7.5 or v_lng < 94 or v_lng > 142 then
      v_skip := v_skip + 1; continue;
    end if;
    v_pt := st_setsrid(st_makepoint(v_lng, v_lat), 4326)::geography;
    v_city := place_city_id(v_lat, v_lng, p_city_id);

    if p_kind = 'store' then
      v_brand := coalesce(nullif(it->>'brand',''), 'lainnya');
      v_cat   := coalesce(nullif(it->>'category',''), 'minimarket');
      if v_cat in ('rumah_sakit','klinik','puskesmas','faskes') then v_skip := v_skip + 1; continue; end if;  -- faskes bukan toko
      v_id := null;
      if v_osm is not null then select s.id into v_id from shop_stores s where s.osm_id = v_osm; end if;
      if v_id is null then
        select s.id into v_id from shop_stores s
         where s.osm_id is null and st_dwithin(s.location, v_pt, 60)
           and (lower(s.name) = lower(v_name) or similarity(lower(s.name), lower(v_name)) > 0.6)
         limit 1;
      end if;
      if v_id is not null then
        update shop_stores set name = v_name, brand = v_brand, category = v_cat,
               address = coalesce(nullif(it->>'address',''), address), lat = v_lat, lng = v_lng,
               city_id = coalesce(v_city, city_id),
               open_hours = coalesce(nullif(it->>'open_hours',''), open_hours),
               phone = coalesce(nullif(it->>'phone',''), phone),
               osm_id = coalesce(v_osm, osm_id), catalog_source = 'osm', updated_at = now()
         where id = v_id;
        v_upd := v_upd + 1;
      else
        insert into shop_stores (name, brand, category, address, lat, lng, city_id, open_hours, phone, catalog_source, active, osm_id)
        values (v_name, v_brand, v_cat, nullif(it->>'address',''), v_lat, v_lng, v_city,
                coalesce(nullif(it->>'open_hours',''), '07:00-22:00'), nullif(it->>'phone',''), 'osm', true, v_osm);
        v_ins := v_ins + 1;
      end if;
      v_key := v_cat;

    elsif p_kind = 'market' then
      v_id := null;
      if v_osm is not null then select m.id into v_id from markets m where m.osm_id = v_osm; end if;
      if v_id is null then
        select m.id into v_id from markets m
         where m.osm_id is null and st_dwithin(m.location, v_pt, 80)
           and (lower(m.name) = lower(v_name) or similarity(lower(m.name), lower(v_name)) > 0.6)
         limit 1;
      end if;
      if v_id is not null then
        update markets set name = v_name, address = coalesce(nullif(it->>'address',''), address),
               lat = v_lat, lng = v_lng, city_id = coalesce(v_city, city_id),
               open_hours = coalesce(nullif(it->>'open_hours',''), open_hours),
               osm_id = coalesce(v_osm, osm_id), updated_at = now()
         where id = v_id;
        v_upd := v_upd + 1;
      else
        insert into markets (name, address, lat, lng, city_id, open_hours, notes, active, osm_id)
        values (v_name, nullif(it->>'address',''), v_lat, v_lng, v_city,
                coalesce(nullif(it->>'open_hours',''), '05:00-14:00'), 'Sumber: OpenStreetMap', true, v_osm);
        v_ins := v_ins + 1;
      end if;
      v_key := 'pasar';

    else  -- faskes → poi_places (titik tujuan, BUKAN toko)
      v_kind := coalesce(nullif(it->>'kind',''), 'lainnya');
      if v_kind not in ('rumah_sakit','klinik','puskesmas','dokter','apotek_rs','lainnya') then v_kind := 'lainnya'; end if;
      v_id := null;
      if v_osm is not null then select p.id into v_id from poi_places p where p.osm_id = v_osm; end if;
      if v_id is null then
        select p.id into v_id from poi_places p
         where p.osm_id is null and st_dwithin(p.location, v_pt, 120)
           and (lower(p.name) = lower(v_name) or similarity(lower(p.name), lower(v_name)) > 0.6)
         limit 1;
      end if;
      if v_id is not null then
        update poi_places set name = v_name, kind = v_kind, category = 'faskes',
               address = coalesce(nullif(it->>'address',''), address), lat = v_lat, lng = v_lng,
               city_id = coalesce(v_city, city_id),
               phone = coalesce(nullif(it->>'phone',''), phone),
               open_hours = coalesce(nullif(it->>'open_hours',''), open_hours),
               emergency = coalesce((it->>'emergency')::boolean, emergency),
               operator = coalesce(nullif(it->>'operator',''), operator),
               osm_id = coalesce(v_osm, osm_id), source = 'osm'
         where id = v_id;
        v_upd := v_upd + 1;
      else
        insert into poi_places (name, kind, category, address, lat, lng, city_id, phone, open_hours, emergency, operator, source, osm_id, active)
        values (v_name, v_kind, 'faskes', nullif(it->>'address',''), v_lat, v_lng, v_city,
                nullif(it->>'phone',''), nullif(it->>'open_hours',''), (it->>'emergency')::boolean,
                nullif(it->>'operator',''), 'osm', v_osm, true);
        v_ins := v_ins + 1;
      end if;
      v_key := v_kind;
    end if;

    v_counts := v_counts || jsonb_build_object(v_key, coalesce((v_counts->>v_key)::int, 0) + 1);
  end loop;

  return jsonb_build_object('inserted', v_ins, 'updated', v_upd, 'skipped', v_skip, 'counts', v_counts);
end $$;
comment on function osm_upsert_places(text, jsonb, uuid) is
  'Simpan toko/pasar/faskes hasil Overpass. Dedupe lewat osm_id (jalan ulang tidak menggandakan), '
  'kota ditetapkan place_city_id() yang BERBATAS JARAK, dan kolom active tidak pernah ditimpa.';
revoke all on function osm_upsert_places(text, jsonb, uuid) from public, anon, authenticated;
grant execute on function osm_upsert_places(text, jsonb, uuid) to service_role;

-- ---------------------------------------------------------------------
-- import_places (dipanggil aplikasi pelanggan, radius kecil) — cacat kota diperbaiki.
-- Isi fungsi sama seperti 0021 kecuali dua baris penetapan kota.
-- ---------------------------------------------------------------------
create or replace function import_places(p_kind text, p_places jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare it jsonb; v_ins int := 0; v_skip int := 0; v_pt geography; v_city uuid; v_name text; v_brand text; v_cat text; v_osm text; v_lat double precision; v_lng double precision; v_n int := 0;
begin
  if auth.uid() is null then raise exception 'Masuk dulu'; end if;
  if not coalesce((select value::text::boolean from app_settings where key = 'osm_import_enabled'), true) then return jsonb_build_object('inserted', 0, 'skipped', 0, 'disabled', true); end if;
  if p_kind not in ('store','market') then raise exception 'Jenis tidak valid'; end if;
  for it in select * from jsonb_array_elements(coalesce(p_places, '[]'::jsonb)) loop
    v_n := v_n + 1; exit when v_n > 80;
    v_name := trim(coalesce(it->>'name', '')); v_lat := (it->>'lat')::double precision; v_lng := (it->>'lng')::double precision; v_osm := nullif(it->>'osm_id', '');
    if length(v_name) < 3 or v_lat is null or v_lng is null then v_skip := v_skip + 1; continue; end if;
    v_pt := st_setsrid(st_makepoint(v_lng, v_lat), 4326)::geography;
    -- PERBAIKAN: kota terdekat DALAM BATAS JARAK dari seluruh gazetteer; NULL bila tidak ada.
    v_city := place_city_id(v_lat, v_lng, null);
    if p_kind = 'store' then
      if exists (select 1 from shop_stores s where (v_osm is not null and s.osm_id = v_osm) or (st_dwithin(s.location, v_pt, 60) and (lower(s.name) = lower(v_name) or similarity(lower(s.name), lower(v_name)) > 0.6))) then v_skip := v_skip + 1; continue; end if;
      v_brand := coalesce(nullif(it->>'brand', ''), case when v_name ilike '%indomaret%' then 'indomaret' when v_name ilike '%alfamart%' or v_name ilike '%alfamidi%' then 'alfamart' when v_name ilike '%apotek%' or v_name ilike '%apotik%' or v_name ilike '%farma%' then 'apotek' else 'lainnya' end);
      v_cat := coalesce(nullif(it->>'category', ''), case when v_brand = 'apotek' then 'apotek' when v_name ilike '%supermarket%' or v_name ilike '%swalayan%' or v_name ilike '%hypermart%' or v_name ilike '%mart%' and v_brand = 'lainnya' then 'supermarket' else 'minimarket' end);
      if v_cat in ('rumah_sakit','klinik','puskesmas','faskes') then v_skip := v_skip + 1; continue; end if;
      insert into shop_stores (name, brand, category, address, lat, lng, city_id, open_hours, phone, catalog_source, active, osm_id)
      values (v_name, v_brand, v_cat, nullif(it->>'address', ''), v_lat, v_lng, v_city, nullif(it->>'open_hours', ''), nullif(it->>'phone', ''), 'osm', true, v_osm);
    else
      if exists (select 1 from markets m where (v_osm is not null and m.osm_id = v_osm) or (st_dwithin(m.location, v_pt, 80) and (lower(m.name) = lower(v_name) or similarity(lower(m.name), lower(v_name)) > 0.6))) then v_skip := v_skip + 1; continue; end if;
      insert into markets (name, address, lat, lng, city_id, open_hours, notes, active, osm_id)
      values (v_name, nullif(it->>'address', ''), v_lat, v_lng, v_city, coalesce(nullif(it->>'open_hours', ''), '05:00-14:00'), 'Sumber: OpenStreetMap', true, v_osm);
    end if;
    v_ins := v_ins + 1;
  end loop;
  if v_ins > 0 then perform log_activity('place.imported', case when p_kind = 'store' then 'shop_stores' else 'markets' end, 'osm', format('[otomatis] %s %s baru diimpor dari peta oleh pengguna', v_ins, case when p_kind = 'store' then 'toko' else 'pasar' end), jsonb_build_object('inserted', v_ins, 'skipped', v_skip, 'user', auth.uid())); end if;
  return jsonb_build_object('inserted', v_ins, 'skipped', v_skip);
end $$;
revoke execute on function import_places(text, jsonb) from public, anon;

-- ---------------------------------------------------------------------
-- Rapikan data lama yang terlanjur salah tempel (mis. toko OSM yang city_id-nya
-- menunjuk kota berjarak ratusan km). Hanya menyentuh baris yang jelas salah.
-- ---------------------------------------------------------------------
create or replace function admin_osm_rapikan_kota()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_s int := 0; v_m int := 0; v_p int := 0; v_max numeric := setting_num('osm_city_assign_max_km', 60);
begin
  if not is_admin() then raise exception 'Hanya admin'; end if;
  update shop_stores s set city_id = place_city_id(s.lat, s.lng, null)
   where s.city_id is null
      or not exists (select 1 from cities c where c.id = s.city_id and st_dwithin(c.location, s.location, v_max * 2 * 1000));
  get diagnostics v_s = row_count;
  update markets m set city_id = place_city_id(m.lat, m.lng, null)
   where m.city_id is null
      or not exists (select 1 from cities c where c.id = m.city_id and st_dwithin(c.location, m.location, v_max * 2 * 1000));
  get diagnostics v_m = row_count;
  update poi_places p set city_id = place_city_id(p.lat, p.lng, null)
   where p.city_id is null
      or not exists (select 1 from cities c where c.id = p.city_id and st_dwithin(c.location, p.location, v_max * 2 * 1000));
  get diagnostics v_p = row_count;
  perform log_activity('osm.rapikan_kota', 'shop_stores', 'osm',
    format('Penetapan kota dirapikan: %s toko, %s pasar, %s faskes', v_s, v_m, v_p), null);
  return jsonb_build_object('ok', true, 'toko', v_s, 'pasar', v_m, 'faskes', v_p);
end $$;
revoke all on function admin_osm_rapikan_kota() from public, anon;
grant execute on function admin_osm_rapikan_kota() to authenticated;
