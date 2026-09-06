-- Tahap 8 (6 Sep 2026): batas jarak per layanan (dalam kota vs antar kota), impor tempat dari peta (OSM) langsung ke database,
-- tombol on/off layanan di panel admin, katalog kendaraan driver
insert into app_settings (key, value) values
  ('max_km_ride_motor', '25'), ('max_km_ride_car', '60'), ('max_km_food', '15'), ('max_km_send', '35'), ('max_km_shop', '15'), ('max_km_market', '15'), ('max_km_box', '80'),
  ('same_city_services', '["ride_motor","food","shop","market"]'),
  ('services_enabled', '{"ride_motor":true,"ride_car":true,"food":true,"send":true,"shop":true,"market":true,"box":true,"travel":true}'),
  ('osm_import_enabled', 'true'), ('osm_import_radius_km', '5')
on conflict (key) do nothing;

alter table shop_stores add column if not exists osm_id text;
alter table markets add column if not exists osm_id text;
create unique index if not exists shop_stores_osm_id on shop_stores (osm_id) where osm_id is not null;
create unique index if not exists markets_osm_id on markets (osm_id) where osm_id is not null;

-- ============================================================================
-- 1. Batas jarak & kota per layanan
-- ============================================================================
create or replace function service_enabled(p_service text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select (value->>p_service)::boolean from app_settings where key = 'services_enabled'), true);
$$;

create or replace function service_limit_km(p_service service_type)
returns numeric language sql stable security definer set search_path = public as $$
  select setting_num('max_km_' || p_service::text, case p_service when 'ride_motor' then 25 when 'ride_car' then 60 when 'food' then 15 when 'send' then 35 when 'shop' then 15 when 'market' then 15 when 'box' then 80 else 1000 end);
$$;

-- Mengembalikan {ok, max_km, same_city_required, same_city, message}
create or replace function check_service_distance(p_service service_type, p_km numeric, p_pick_lat double precision, p_pick_lng double precision, p_drop_lat double precision, p_drop_lng double precision, p_scope text default 'in_city')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_max numeric := service_limit_km(p_service); v_same boolean := true; v_need boolean; c1 uuid; c2 uuid; v_msg text;
begin
  if p_service = 'send' and p_scope = 'intercity' then return jsonb_build_object('ok', true, 'max_km', null, 'same_city_required', false, 'same_city', true); end if;
  v_need := coalesce((select value ? p_service::text from app_settings where key = 'same_city_services'), p_service in ('ride_motor','food','shop','market'));
  if v_need and p_drop_lat is not null then
    c1 := nearest_city(p_pick_lat, p_pick_lng, 40); c2 := nearest_city(p_drop_lat, p_drop_lng, 40);
    if c1 is not null and c2 is not null and c1 <> c2 then v_same := false; end if;
  end if;
  if p_km > v_max then
    v_msg := format('Jarak %s km melebihi batas %s dalam kota (%s km).', round(p_km, 1), case p_service when 'ride_motor' then 'AntarRide' when 'ride_car' then 'AntarCar' when 'food' then 'AntarFood' when 'send' then 'AntarSend' when 'shop' then 'AntarShop' when 'market' then 'AntarMarket' when 'box' then 'AntarBox' else p_service::text end, v_max)
      || case when p_service in ('ride_motor','ride_car') then ' Untuk perjalanan antar kota gunakan AntarTravel (kursi bersama / carter).' when p_service = 'send' then ' Gunakan AntarSend Antar Kota (lewat gudang mitra).' else ' Pilih toko/pasar/merchant yang lebih dekat.' end;
  elsif not v_same then
    v_msg := 'Titik jemput dan tujuan berada di kota berbeda. ' || case when p_service = 'ride_motor' then 'Ojek motor hanya melayani dalam kota — gunakan AntarTravel untuk antar kota.' else 'Layanan ini hanya melayani dalam satu kota.' end;
  end if;
  return jsonb_build_object('ok', v_msg is null, 'max_km', v_max, 'same_city_required', v_need, 'same_city', v_same, 'message', v_msg);
end $$;

-- estimate_fare: sertakan batas layanan agar UI bisa menolak sebelum memesan
create or replace function estimate_fare(p_service service_type, p_pickup_lat double precision, p_pickup_lng double precision, p_drop_lat double precision, p_drop_lng double precision, p_route_km numeric default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_straight numeric; v_km numeric; v_fare bigint; v_fee bigint; v_ratio numeric; s pricing_sessions; v_dm jsonb; v_mult numeric; v_lim jsonb;
begin
  v_straight := st_distance(st_setsrid(st_makepoint(p_pickup_lng, p_pickup_lat), 4326)::geography, st_setsrid(st_makepoint(p_drop_lng, p_drop_lat), 4326)::geography) / 1000.0;
  v_ratio := setting_num('max_route_ratio', 2.5);
  v_km := coalesce(p_route_km, v_straight * 1.3);
  v_km := least(greatest(v_km, v_straight), greatest(v_straight * v_ratio, 0.5));
  v_km := round(v_km, 2);
  select fare, platform_fee into v_fare, v_fee from calc_fare(p_service, v_km);
  s := current_pricing_session(p_service);
  v_dm := demand_multiplier(p_service, p_pickup_lat, p_pickup_lng);
  v_mult := coalesce((v_dm->>'multiplier')::numeric, 1);
  if v_mult > 1 then v_fare := round_to((v_fare * v_mult)::bigint, 500); end if;
  v_lim := check_service_distance(p_service, v_km, p_pickup_lat, p_pickup_lng, p_drop_lat, p_drop_lng, 'in_city');
  return jsonb_build_object('distance_km', v_km, 'straight_km', round(v_straight, 2),
    'fare', v_fare, 'platform_fee', v_fee, 'total', v_fare + v_fee,
    'duration_min', greatest(3, ceil(v_km / 25.0 * 60)),
    'session', case when s.id is null then null else jsonb_build_object('name', s.name, 'level', s.level, 'multiplier', s.multiplier) end,
    'demand', case when v_mult > 1 then v_dm else null end,
    'limit', v_lim, 'service_enabled', service_enabled(p_service::text));
end $$;

-- create_order: tolak layanan nonaktif & jarak di luar batas (disisipkan setelah estimasi)
do $$
declare def text; anchor text := $a$  v_fare := (v_est->>'fare')::bigint; v_fee := (v_est->>'platform_fee')::bigint;$a$;
  guard text := $g$  if not service_enabled(v_service::text) then raise exception 'Layanan ini sedang dinonaktifkan sementara oleh admin'; end if;
  if not coalesce((check_service_distance(v_service, (v_est->>'distance_km')::numeric, v_pick_lat, v_pick_lng, v_drop_lat, v_drop_lng, v_scope)->>'ok')::boolean, true) then
    raise exception '%', check_service_distance(v_service, (v_est->>'distance_km')::numeric, v_pick_lat, v_pick_lng, v_drop_lat, v_drop_lng, v_scope)->>'message';
  end if;
$g$;
begin
  select pg_get_functiondef(p.oid) into def from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='create_order';
  if position('check_service_distance' in def) > 0 then return; end if;
  if position(anchor in def) = 0 then raise exception 'anchor create_order tidak ditemukan'; end if;
  execute replace(def, anchor, anchor || E'\n' || guard);
end $$;

-- ============================================================================
-- 2. Impor tempat dari peta (OpenStreetMap) langsung menjadi toko / pasar aktif
-- ============================================================================
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
    if p_kind = 'store' then
      if exists (select 1 from shop_stores s where (v_osm is not null and s.osm_id = v_osm) or (st_dwithin(s.location, v_pt, 60) and (lower(s.name) = lower(v_name) or similarity(lower(s.name), lower(v_name)) > 0.6))) then v_skip := v_skip + 1; continue; end if;
      v_brand := coalesce(nullif(it->>'brand', ''), case when v_name ilike '%indomaret%' then 'indomaret' when v_name ilike '%alfamart%' or v_name ilike '%alfamidi%' then 'alfamart' when v_name ilike '%apotek%' or v_name ilike '%apotik%' or v_name ilike '%farma%' then 'apotek' else 'lainnya' end);
      v_cat := coalesce(nullif(it->>'category', ''), case when v_brand = 'apotek' then 'apotek' when v_name ilike '%supermarket%' or v_name ilike '%swalayan%' or v_name ilike '%hypermart%' or v_name ilike '%mart%' and v_brand = 'lainnya' then 'supermarket' else 'minimarket' end);
      v_city := (select id from cities c where c.active order by st_distance(c.location, v_pt) limit 1);
      insert into shop_stores (name, brand, category, address, lat, lng, city_id, open_hours, phone, catalog_source, active, osm_id)
      values (v_name, v_brand, v_cat, nullif(it->>'address', ''), v_lat, v_lng, v_city, nullif(it->>'open_hours', ''), nullif(it->>'phone', ''), 'osm', true, v_osm);
    else
      if exists (select 1 from markets m where (v_osm is not null and m.osm_id = v_osm) or (st_dwithin(m.location, v_pt, 80) and (lower(m.name) = lower(v_name) or similarity(lower(m.name), lower(v_name)) > 0.6))) then v_skip := v_skip + 1; continue; end if;
      v_city := (select id from cities c where c.active order by st_distance(c.location, v_pt) limit 1);
      insert into markets (name, address, lat, lng, city_id, open_hours, notes, active, osm_id)
      values (v_name, nullif(it->>'address', ''), v_lat, v_lng, v_city, coalesce(nullif(it->>'open_hours', ''), '05:00-14:00'), 'Sumber: OpenStreetMap', true, v_osm);
    end if;
    v_ins := v_ins + 1;
  end loop;
  if v_ins > 0 then perform log_activity('place.imported', case when p_kind = 'store' then 'shop_stores' else 'markets' end, 'osm', format('[otomatis] %s %s baru diimpor dari peta oleh pengguna', v_ins, case when p_kind = 'store' then 'toko' else 'pasar' end), jsonb_build_object('inserted', v_ins, 'skipped', v_skip, 'user', auth.uid())); end if;
  return jsonb_build_object('inserted', v_ins, 'skipped', v_skip);
end $$;
revoke execute on function import_places(text, jsonb) from public, anon;

-- Pengaturan publik untuk aplikasi (layanan aktif, batas jarak, impor peta)
create or replace function app_public_settings()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'services_enabled', coalesce((select value from app_settings where key = 'services_enabled'), '{}'::jsonb),
    'max_km', jsonb_build_object('ride_motor', service_limit_km('ride_motor'), 'ride_car', service_limit_km('ride_car'), 'food', service_limit_km('food'), 'send', service_limit_km('send'), 'shop', service_limit_km('shop'), 'market', service_limit_km('market'), 'box', service_limit_km('box')),
    'osm_import_enabled', coalesce((select value::text::boolean from app_settings where key = 'osm_import_enabled'), true),
    'osm_import_radius_km', setting_num('osm_import_radius_km', 5)
  );
$$;
grant execute on function app_public_settings() to anon, authenticated;

-- Admin: on/off layanan
create or replace function admin_set_service_enabled(p_service text, p_enabled boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if not is_admin() then raise exception 'Hanya admin'; end if;
  if p_service not in ('ride_motor','ride_car','food','send','shop','market','box','travel') then raise exception 'Layanan tidak dikenal'; end if;
  insert into app_settings (key, value) values ('services_enabled', jsonb_build_object(p_service, p_enabled))
  on conflict (key) do update set value = app_settings.value || jsonb_build_object(p_service, p_enabled), updated_at = now() returning value into v;
  perform log_activity('service.toggle', 'app_settings', 'services_enabled', 'Layanan ' || p_service || case when p_enabled then ' diaktifkan' else ' DINONAKTIFKAN' end, jsonb_build_object('service', p_service, 'enabled', p_enabled));
  return v;
end $$;

-- Admin: mitra travel lengkap (untuk halaman Mitra Travel)
create or replace function admin_travel_partners(p_status text default 'all')
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(tp) || jsonb_build_object(
      'full_name', (select full_name from profiles where id = tp.id), 'phone', (select phone from profiles where id = tp.id), 'email', (select email from profiles where id = tp.id),
      'base_city_name', (select name from cities where id = tp.base_city_id),
      'trips', (select count(*) from travel_trips t where t.partner_id = tp.id), 'bookings', (select count(*) from travel_bookings b join travel_trips t on t.id = b.trip_id where t.partner_id = tp.id),
      'requests_done', (select count(*) from travel_requests r where r.partner_id = tp.id and r.status = 'completed'),
      'offers', (select count(*) from travel_offers o where o.partner_id = tp.id),
      'wallet', (select balance from wallets where user_id = tp.id)) order by tp.created_at desc), '[]'::jsonb)
  from travel_partners tp where is_admin() and (p_status is null or p_status = 'all' or tp.status::text = p_status);
$$;
revoke execute on function admin_travel_partners(text) from public, anon;
revoke execute on function admin_set_service_enabled(text, boolean) from public, anon;
revoke execute on function check_service_distance(service_type, numeric, double precision, double precision, double precision, double precision, text) from public, anon;

-- ============================================================================
-- 3. Katalog kendaraan driver: merek/model/bahan bakar konsisten dengan tipe kendaraan
-- ============================================================================
alter table drivers add column if not exists vehicle_model text, add column if not exists fuel_type text check (fuel_type is null or fuel_type in ('bensin','diesel','listrik','hybrid'));
create or replace function register_driver(p jsonb)
returns drivers language plpgsql security definer set search_path = public as $$
declare d drivers%rowtype; v_type vehicle_type := coalesce((p->>'vehicle_type')::vehicle_type, 'motor');
  v_year int := nullif(p->>'vehicle_year', '')::int; v_cond text := coalesce(nullif(p->>'vehicle_condition', ''), 'baik');
  v_fuel text := nullif(p->>'fuel_type', ''); v_ev boolean;
begin
  if auth.uid() is null then raise exception 'Harus login'; end if;
  if v_year is not null and (v_year < 1990 or v_year > extract(year from now())::int + 1) then raise exception 'Tahun kendaraan tidak valid'; end if;
  if v_fuel is not null and v_fuel not in ('bensin','diesel','listrik','hybrid') then raise exception 'Jenis bahan bakar tidak valid'; end if;
  if v_type = 'motor' and v_fuel = 'diesel' then raise exception 'Motor tidak memakai diesel — periksa jenis bahan bakar'; end if;
  if length(trim(coalesce(p->>'vehicle_brand',''))) < 2 then raise exception 'Merek kendaraan wajib diisi'; end if;
  v_ev := coalesce((p->>'is_electric')::boolean, v_fuel = 'listrik', false);
  if v_fuel = 'listrik' then v_ev := true; elsif v_fuel in ('bensin','diesel') then v_ev := false; end if;
  perform set_config('antaraja.bypass', 'on', true);
  insert into drivers (id, vehicle_type, vehicle_brand, vehicle_model, fuel_type, vehicle_plate, vehicle_color, vehicle_year, vehicle_condition, is_electric, vehicle_capacity, vehicle_class)
  values (auth.uid(), v_type, p->>'vehicle_brand', nullif(p->>'vehicle_model',''), v_fuel, upper(p->>'vehicle_plate'), p->>'vehicle_color', v_year, v_cond, v_ev, p->>'vehicle_capacity', derive_vehicle_class(v_type, v_year, v_cond, v_ev))
  on conflict (id) do update set vehicle_type = excluded.vehicle_type, vehicle_brand = excluded.vehicle_brand, vehicle_model = excluded.vehicle_model, fuel_type = excluded.fuel_type,
    vehicle_plate = excluded.vehicle_plate, vehicle_color = excluded.vehicle_color, vehicle_year = excluded.vehicle_year,
    vehicle_condition = excluded.vehicle_condition, is_electric = excluded.is_electric, vehicle_capacity = excluded.vehicle_capacity,
    vehicle_class = excluded.vehicle_class,
    status = case when drivers.status in ('suspended','approved') then drivers.status else 'pending' end
  returning * into d;
  insert into driver_documents (driver_id, license_number, id_card_number, photo_id_url, photo_vehicle_url)
  values (auth.uid(), p->>'license_number', p->>'id_card_number', p->>'photo_id_url', p->>'photo_vehicle_url')
  on conflict (driver_id) do update set license_number = excluded.license_number, id_card_number = excluded.id_card_number,
    photo_id_url = coalesce(excluded.photo_id_url, driver_documents.photo_id_url),
    photo_vehicle_url = coalesce(excluded.photo_vehicle_url, driver_documents.photo_vehicle_url), updated_at = now();
  update profiles set role = 'driver' where id = auth.uid() and role = 'customer';
  perform set_config('antaraja.bypass', 'off', true);
  return d;
end $$;
