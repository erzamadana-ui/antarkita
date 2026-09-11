-- =====================================================================
-- 0080 — PENEGAKAN GERBANG KOTA DI SERVER
--
-- UI yang menyembunyikan tombol TIDAK CUKUP: siapa pun bisa memanggil
-- rpc('create_order') langsung dengan kunci anon. Jadi penolakan harus ada di
-- dalam create_order itu sendiri.
--
-- CARA: create_order sudah pernah ditambal dengan pola yang sama pada migrasi
-- 0021 (pg_get_functiondef + sisip penjaga di jangkar yang pasti). Pola itu
-- dipakai lagi di sini supaya tidak menyalin ulang 200 baris definisi fungsi
-- (yang justru berisiko menghapus tambalan migrasi lain).
--
-- LETAK PENJAGA: tepat SESUDAH titik jemput dipastikan lengkap dan SEBELUM
-- pekerjaan apa pun yang berbiaya (validasi keranjang, estimasi tarif, insert).
-- Dengan begitu pelanggan mendapat alasan yang benar lebih dulu, bukan galat
-- lain yang menyesatkan.
--
-- JIKA JANGKAR TIDAK DITEMUKAN migrasi ini SENGAJA GAGAL. Melewatinya diam-diam
-- berarti gerbang tidak terpasang — persis bug yang ingin dicegah.
-- =====================================================================

do $$
declare
  def text;
  anchor constant text := $a$  if v_pick_lat is null then raise exception 'Lokasi jemput tidak lengkap'; end if;$a$;
  guard  constant text := $g$
  -- Gerbang wilayah (0080): pesanan hanya dari kota yang layanannya sudah dibuka.
  declare v_gate jsonb;
  begin
    v_gate := city_gate(v_service, v_pick_lat, v_pick_lng);
    if not coalesce((v_gate->>'ok')::boolean, false) then
      raise exception '%', coalesce(v_gate->>'message', 'AntarKita belum melayani wilayah titik jemput Anda.');
    end if;
  end;
$g$;
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_order';
  if def is null then raise exception 'create_order tidak ditemukan'; end if;
  if position('city_gate' in def) > 0 then
    raise notice 'Gerbang kota sudah terpasang di create_order — dilewati';
    return;
  end if;
  if position(anchor in def) = 0 then
    raise exception 'Jangkar gerbang kota tidak ditemukan di create_order — penegakan TIDAK terpasang';
  end if;
  execute replace(def, anchor, anchor || guard);
end $$;

-- Penjaga migrasi: pastikan penegakan benar-benar ada di definisi akhir.
do $$
declare def text;
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_order';
  if position('city_gate' in def) = 0 then
    raise exception 'create_order tidak memanggil city_gate — gerbang kota gagal dipasang';
  end if;
end $$;

-- Komentar lama (0030) dipertahankan, keterangan gerbang kota ditambahkan di belakangnya.
comment on function create_order(jsonb) is
  'Membuat pesanan. Sejak 0030 menerima field opsional `driver_code` (AntarNow): kode divalidasi (ada, driver approved & aktif, kendaraannya cocok lewat driver_can_take) lalu mengisi orders.preferred_driver_id. '
  'Sejak 0080 pesanan DITOLAK bila titik jemput berada di kota yang layanannya belum dibuka, atau di luar radius kota mana pun (lihat city_gate).';

-- =====================================================================
-- AntarTravel tidak lewat create_order (alurnya travel_request_create /
-- travel_book), jadi gerbangnya harus dipasang terpisah — kalau tidak,
-- sakelar "travel" per kota hanya akan jadi hiasan di Panel Admin.
--
-- Supaya kalimat penolakan tidak bercabang dua, keputusan & pesannya
-- dipindahkan ke satu tempat: city_gate_by_city(). city_gate() dari 0077
-- kini tinggal mencari kota terdekat + memeriksa radius, lalu menyerahkan
-- keputusan ke fungsi itu (perilakunya untuk create_order tidak berubah).
-- =====================================================================

create or replace function city_gate_by_city(p_city_id uuid, p_service service_type)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c cities%rowtype; v_buka boolean; v_lain text;
begin
  if p_city_id is null then
    return jsonb_build_object('ok', false, 'reason', 'luar_jangkauan',
      'message', 'AntarKita belum melayani wilayah ini. Belum ada kota layanan kami di sekitar titik jemput Anda.');
  end if;
  select * into c from cities where id = p_city_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'luar_jangkauan',
      'message', 'AntarKita belum melayani wilayah ini. Kota asal tidak dikenali.');
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
    'city_id', c.id, 'city_name', c.name, 'status', c.service_status);
end $$;

-- city_gate(): cari kota terdekat, periksa radius wajar, sisanya delegasikan.
create or replace function city_gate(p_service service_type, p_lat double precision, p_lng double precision)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c record;
begin
  if p_lat is null or p_lng is null then
    return jsonb_build_object('ok', false, 'reason', 'tanpa_lokasi',
      'message', 'Titik jemput belum lengkap. Pilih lokasi jemput lebih dulu.');
  end if;
  select * into c from city_at_point(p_lat, p_lng);
  if not found or c.id is null then return city_gate_by_city(null, p_service); end if;
  if c.distance_km > c.radius_km then
    return jsonb_build_object('ok', false, 'reason', 'luar_jangkauan',
      'city_id', c.id, 'city_name', c.name, 'distance_km', c.distance_km,
      'message', format('Titik jemput Anda sekitar %s km dari %s — di luar wilayah layanan AntarKita. Pesanan hanya bisa dibuat dari dalam kota yang sudah kami layani.',
                        round(c.distance_km), c.name));
  end if;
  return city_gate_by_city(c.id, p_service) || jsonb_build_object('distance_km', c.distance_km);
end $$;

revoke execute on function city_gate_by_city(uuid, service_type) from public, anon;
grant execute on function city_gate_by_city(uuid, service_type) to authenticated;

-- ---------- Penjaga di travel_request_create (carter / sopir harian) ----------
do $$
declare def text;
  anchor constant text := $a$  insert into travel_requests (code, customer_id, kind, partner_id, from_city, to_city, pickup_address, pickup_lat, pickup_lng, dropoff_address, dropoff_lat, dropoff_lng,$a$;
  guard constant text := $g$  declare v_gate jsonb;
  begin
    v_gate := city_gate_by_city(v_from, 'travel');
    if not coalesce((v_gate->>'ok')::boolean, false) then raise exception '%', v_gate->>'message'; end if;
  end;
$g$;
begin
  select pg_get_functiondef(p.oid) into def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'travel_request_create';
  if def is null then raise exception 'travel_request_create tidak ditemukan'; end if;
  if position('city_gate_by_city' in def) > 0 then return; end if;
  if position(anchor in def) = 0 then raise exception 'Jangkar gerbang kota tidak ditemukan di travel_request_create'; end if;
  execute replace(def, anchor, guard || anchor);
end $$;

-- ---------- Penjaga di travel_book (pesan kursi / carter pada jadwal mitra) ----------
do $$
declare def text;
  anchor constant text := $a$  if coalesce(p->>'pickup_address', '') = '' then raise exception 'Isi alamat jemput'; end if;$a$;
  guard constant text := $g$
  declare v_gate jsonb;
  begin
    v_gate := city_gate_by_city((select r.from_city from travel_routes r where r.id = t.route_id), 'travel');
    if not coalesce((v_gate->>'ok')::boolean, false) then raise exception '%', v_gate->>'message'; end if;
  end;
$g$;
begin
  select pg_get_functiondef(p.oid) into def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'travel_book';
  if def is null then raise exception 'travel_book tidak ditemukan'; end if;
  if position('city_gate_by_city' in def) > 0 then return; end if;
  if position(anchor in def) = 0 then raise exception 'Jangkar gerbang kota tidak ditemukan di travel_book'; end if;
  execute replace(def, anchor, anchor || guard);
end $$;

-- Penjaga akhir: ketiga jalur pemesanan benar-benar bergerbang.
do $$
declare n int;
begin
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname in ('create_order', 'travel_request_create', 'travel_book')
     and pg_get_functiondef(p.oid) like '%city_gate%';
  if n <> 3 then raise exception 'Baru % dari 3 jalur pemesanan yang bergerbang kota', n; end if;
end $$;

-- =====================================================================
-- Pemilihan kota untuk sebuah titik — diperbaiki dan dinyatakan ulang di sini
-- supaya basis data yang sudah terlanjur memakai 0077 versi awal ikut terkoreksi.
-- (Isinya sama persis dengan definisi di berkas 0077; menjalankan keduanya aman.)
--
-- SEBABNYA: migrasi 0071 (agen impor peta) memasukkan ribuan kota/desa Indonesia
-- dengan active=false. Tanpa urutan bertingkat, desa hasil impor yang lebih dekat
-- bisa mengalahkan kota operasi dan memblokir pelanggan Pekanbaru/Padang.
-- =====================================================================
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
