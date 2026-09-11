-- =====================================================================
-- 0077 — RPC status kota & layanan
--
--   city_at_point(lat, lng)        → kota terdekat + jaraknya (pembantu internal)
--   city_open_services(city)       → {layanan: dibuka?} di satu kota (murni tingkat kota)
--   city_service_status(lat, lng)  → status siap tampil untuk aplikasi pelanggan
--   city_gate(service, lat, lng)   → {ok, message} — dipakai create_order (0079) & UI
--
-- SEMUA teks pesan ditulis di SERVER dalam Bahasa Indonesia, supaya aplikasi,
-- pesan galat create_order, dan Panel Admin memakai kalimat yang sama persis.
-- =====================================================================

-- ---------- Kota terdekat dari sebuah titik ----------
-- Sengaja TIDAK menyaring `active`: kota yang tidak aktif pun perlu DISEBUT namanya
-- agar pesan ke pelanggan jujur ("AntarKita belum melayani Medan"), bukan
-- "di luar jangkauan" yang membingungkan.
create or replace function city_at_point(p_lat double precision, p_lng double precision)
returns table (id uuid, name text, province text, service_status text, radius_km numeric, distance_km numeric)
language sql stable security definer set search_path = public as $$
  select c.id, c.name, c.province, c.service_status, c.radius_km,
         round((st_distance(c.location, st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography) / 1000.0)::numeric, 2)
  from cities c
  where c.location is not null and p_lat is not null and p_lng is not null
  -- URUTAN SENGAJA BERTINGKAT, bukan sekadar "terdekat":
  --   (1) kota yang MELAYANI dan titik ini ada di dalam radiusnya menang lebih dulu;
  --   (2) baru sesudah itu kota terdekat mana pun, supaya pesan penolakan tetap menyebut
  --       nama kota yang masuk akal bagi pelanggan.
  -- Tanpa tingkat (1), satu desa hasil impor OSM (migrasi 0071, masuk dengan active=false
  -- dan service_status='belum_dilayani') yang kebetulan 5 km dari pusat Pekanbaru akan
  -- "menutupi" Pekanbaru dan MEMBLOKIR pelanggan di kota yang justru sedang beroperasi.
  order by (c.service_status = 'aktif'
            and st_dwithin(c.location, st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography, c.radius_km * 1000)) desc,
           st_distance(c.location, st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography)
  limit 1;
$$;

-- ---------- Layanan yang dibuka di satu kota (tingkat kota saja) ----------
-- GAGAL-TERTUTUP: tidak ada baris city_services = tertutup, walau kota 'aktif'.
create or replace function city_open_services(p_city uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(t.sv::text, t.buka), '{}'::jsonb) from (
    select s.sv,
      coalesce((select c.service_status from cities c where c.id = p_city), 'belum_dilayani') = 'aktif'
        and coalesce((select cs.enabled from city_services cs where cs.city_id = p_city and cs.service = s.sv), false) as buka
    from (select unnest(enum_range(null::service_type)) as sv) s
  ) t;
$$;

-- ---------- Status siap tampil untuk aplikasi pelanggan ----------
create or replace function city_service_status(p_lat double precision, p_lng double precision)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  c record; v_city jsonb; v_all jsonb := '{}'::jsonb; v_open text[]; v_closed text[]; k text;
begin
  if p_lat is null or p_lng is null then
    return jsonb_build_object(
      'ok', false, 'in_range', false, 'status', 'tidak_diketahui', 'services', '{}'::jsonb,
      'open_services', '[]'::jsonb, 'closed_services', '[]'::jsonb, 'waitlist_open', false,
      'headline', 'Lokasi Anda belum diketahui',
      'body', 'Nyalakan izin lokasi supaya kami bisa memastikan AntarKita sudah melayani daerah Anda.');
  end if;

  select * into c from city_at_point(p_lat, p_lng);

  -- (a) tidak ada kota sama sekali, atau jauh di luar radius kota mana pun
  if not found or c.id is null or c.distance_km > c.radius_km then
    return jsonb_build_object(
      'ok', false, 'in_range', false, 'status', 'luar_jangkauan', 'services', '{}'::jsonb,
      'open_services', '[]'::jsonb, 'closed_services', '[]'::jsonb, 'waitlist_open', true,
      'city_id', c.id, 'city_name', c.name, 'province', c.province, 'distance_km', c.distance_km,
      'headline', 'AntarKita belum menjangkau lokasi ini',
      'body', case when c.name is null
        then 'Lokasi Anda berada jauh dari kota layanan AntarKita mana pun. Anda tetap bisa menelusuri data tempat, tetapi pesanan belum bisa dibuat dari sini.'
        else format('Lokasi Anda sekitar %s km dari %s — masih di luar wilayah layanan terdekat kami. Anda tetap bisa menelusuri data tempat, tetapi pesanan belum bisa dibuat dari sini.', round(c.distance_km), c.name) end);
  end if;

  -- (b) kota ketemu — kumpulkan layanan yang benar-benar bisa dipakai
  --     (dibuka di kota DAN tidak sedang dimatikan global oleh admin)
  v_city := city_open_services(c.id);
  for k in select jsonb_object_keys(v_city) loop
    v_all := v_all || jsonb_build_object(k, (v_city->>k)::boolean and service_enabled(k));
  end loop;
  select array_agg(service_label(kk::service_type) order by kk) into v_open
    from jsonb_object_keys(v_all) kk where (v_all->>kk)::boolean;
  select array_agg(service_label(kk::service_type) order by kk) into v_closed
    from jsonb_object_keys(v_all) kk where not (v_all->>kk)::boolean;

  return jsonb_build_object(
    'ok', coalesce(array_length(v_open, 1), 0) > 0,
    'in_range', true, 'status', c.service_status,
    'city_id', c.id, 'city_name', c.name, 'province', c.province, 'distance_km', c.distance_km,
    'services', v_all,
    'open_services', to_jsonb(coalesce(v_open, '{}'::text[])),
    'closed_services', to_jsonb(coalesce(v_closed, '{}'::text[])),
    'waitlist_open', c.service_status <> 'aktif' or coalesce(array_length(v_closed, 1), 0) > 0,
    'headline', case
      when c.service_status = 'aktif' and coalesce(array_length(v_open, 1), 0) > 0 and coalesce(array_length(v_closed, 1), 0) = 0
        then format('AntarKita melayani %s', c.name)
      when c.service_status = 'aktif' and coalesce(array_length(v_open, 1), 0) > 0
        then format('Sebagian layanan sudah dibuka di %s', c.name)
      when c.service_status = 'aktif'
        then format('Layanan di %s sedang ditutup sementara', c.name)
      when c.service_status = 'segera'
        then format('AntarKita segera hadir di %s', c.name)
      else format('AntarKita belum melayani %s', c.name) end,
    'body', case
      when c.service_status = 'aktif' and coalesce(array_length(v_open, 1), 0) > 0 and coalesce(array_length(v_closed, 1), 0) = 0
        then 'Semua layanan tersedia di kota Anda.'
      when c.service_status = 'aktif' and coalesce(array_length(v_open, 1), 0) > 0
        then format('Sudah bisa dipakai: %s. Belum dibuka: %s — kami sedang menambah driver untuk layanan itu.',
                    array_to_string(v_open, ', '), array_to_string(v_closed, ', '))
      when c.service_status = 'aktif'
        then 'Semua layanan di kota ini sedang ditutup sementara. Silakan coba lagi nanti.'
      when c.service_status = 'segera'
        then format('Kami sedang menyiapkan driver di %s. Data tempat sudah bisa Anda telusuri; pesanan dibuka begitu driver siap. Daftar sekarang supaya kami kabari lebih dulu.', c.name)
      else format('Data tempat di %s sudah kami kumpulkan dan tetap bisa Anda telusuri, tetapi pesanan belum bisa dibuat karena driver belum tersedia di sini. Beri tahu kami kalau Anda membutuhkannya — kota dengan peminat terbanyak kami buka lebih dulu.', c.name) end);
end $$;

-- ---------- Gerbang satu layanan di satu titik (dipakai create_order) ----------
create or replace function city_gate(p_service service_type, p_lat double precision, p_lng double precision)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c record; v_buka boolean; v_lain text;
begin
  if p_lat is null or p_lng is null then
    return jsonb_build_object('ok', false, 'reason', 'tanpa_lokasi',
      'message', 'Titik jemput belum lengkap. Pilih lokasi jemput lebih dulu.');
  end if;

  select * into c from city_at_point(p_lat, p_lng);

  if not found or c.id is null then
    return jsonb_build_object('ok', false, 'reason', 'luar_jangkauan',
      'message', 'AntarKita belum melayani wilayah ini. Belum ada kota layanan kami di sekitar titik jemput Anda.');
  end if;

  if c.distance_km > c.radius_km then
    return jsonb_build_object('ok', false, 'reason', 'luar_jangkauan',
      'city_id', c.id, 'city_name', c.name, 'distance_km', c.distance_km,
      'message', format('Titik jemput Anda sekitar %s km dari %s — di luar wilayah layanan AntarKita. Pesanan hanya bisa dibuat dari dalam kota yang sudah kami layani.',
                        round(c.distance_km), c.name));
  end if;

  if c.service_status <> 'aktif' then
    return jsonb_build_object('ok', false, 'reason', 'kota_tertutup',
      'city_id', c.id, 'city_name', c.name, 'status', c.service_status,
      'message', format('AntarKita belum melayani %s. Data tempat tetap bisa Anda telusuri, tetapi pesanan belum bisa dibuat karena driver belum tersedia di sini.%s',
        c.name,
        case when c.service_status = 'segera'
             then ' Kota ini sedang kami siapkan — daftar di daftar tunggu supaya kami kabari begitu dibuka.'
             else ' Daftar di daftar tunggu supaya kota ini naik prioritas.' end));
  end if;

  v_buka := coalesce((select cs.enabled from city_services cs where cs.city_id = c.id and cs.service = p_service), false);
  if not v_buka then
    select string_agg(service_label(cs.service), ', ' order by cs.service) into v_lain
      from city_services cs where cs.city_id = c.id and cs.enabled and service_enabled(cs.service::text);
    return jsonb_build_object('ok', false, 'reason', 'layanan_tertutup',
      'city_id', c.id, 'city_name', c.name, 'status', c.service_status,
      'message', format('%s belum dibuka di %s.%s', service_label(p_service), c.name,
        case when v_lain is null then ' Belum ada layanan AntarKita yang dibuka di kota ini.'
             else format(' Yang sudah bisa dipakai di sini: %s.', v_lain) end));
  end if;

  return jsonb_build_object('ok', true, 'reason', 'aktif',
    'city_id', c.id, 'city_name', c.name, 'status', c.service_status, 'distance_km', c.distance_km);
end $$;

-- ---------- Hak akses ----------
-- city_at_point & city_open_services: pembantu, tidak perlu dipanggil klien.
revoke execute on function city_at_point(double precision, double precision)  from public, anon, authenticated;
revoke execute on function city_open_services(uuid)                           from public, anon, authenticated;
-- Dua ini memang dibaca aplikasi (termasuk sebelum pengguna masuk).
revoke execute on function city_service_status(double precision, double precision) from public;
revoke execute on function city_gate(service_type, double precision, double precision) from public;
grant execute on function city_service_status(double precision, double precision) to anon, authenticated;
grant execute on function city_gate(service_type, double precision, double precision) to anon, authenticated;
