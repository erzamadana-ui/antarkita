-- =====================================================================
-- 0072 — Titik tujuan populer (POI), diisi rumah sakit / klinik / puskesmas
--
-- Faskes BUKAN toko AntarShop: pelanggan tidak berbelanja di rumah sakit.
-- Karena itu faskes TIDAK boleh masuk shop_stores (yang dibaca nearby_stores
-- untuk daftar belanja), melainkan ke tabel terpisah `poi_places` yang dipakai
-- sebagai saran TUJUAN (AntarRide / AntarSend / pencarian alamat).
--
-- Pemisahan ini dikunci dua lapis:
--   1. tabel berbeda (poi_places) — tidak ada jalur yang membuatnya muncul di belanja;
--   2. CHECK di shop_stores.category yang menolak kategori faskes.
-- =====================================================================

create table if not exists poi_places (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  kind        text not null default 'lainnya',
  category    text not null default 'faskes',
  address     text,
  lat         double precision not null,
  lng         double precision not null,
  location    geography(point, 4326) generated always as ((st_setsrid(st_makepoint(lng, lat), 4326))::geography) stored,
  city_id     uuid references cities(id) on delete set null,
  phone       text,
  open_hours  text,
  emergency   boolean,
  operator    text,
  source      text not null default 'osm',
  osm_id      text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

do $$ begin
  alter table poi_places add constraint poi_places_kind_chk
    check (kind in ('rumah_sakit','klinik','puskesmas','dokter','apotek_rs','lainnya'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table poi_places add constraint poi_places_category_chk
    check (category in ('faskes','transportasi','pendidikan','publik','lainnya'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table poi_places add constraint poi_places_source_chk check (source in ('admin','crowd','osm'));
exception when duplicate_object then null; end $$;

create unique index if not exists poi_places_osm_id on poi_places (osm_id) where osm_id is not null;
create index if not exists poi_places_location_gix on poi_places using gist (location);
create index if not exists poi_places_city_idx on poi_places (city_id);
create index if not exists poi_places_kind_idx on poi_places (kind) where active;
create index if not exists poi_places_name_trgm on poi_places using gin (lower(name) gin_trgm_ops);

comment on table poi_places is
  'Titik tujuan populer (rumah sakit, klinik, puskesmas, dst). BUKAN toko AntarShop: '
  'tidak pernah dibaca oleh nearby_stores / keranjang belanja. Dipakai sebagai saran tujuan antar-jemput.';
comment on column poi_places.kind is 'rumah_sakit | klinik | puskesmas | dokter | apotek_rs | lainnya';
comment on column poi_places.category is 'Kelompok besar POI; sekarang hanya faskes yang diimpor.';

drop trigger if exists t_poi_places_upd on poi_places;
create trigger t_poi_places_upd before update on poi_places for each row execute function set_updated_at();

alter table poi_places enable row level security;
drop policy if exists poi_places_sel on poi_places;
create policy poi_places_sel on poi_places for select to anon, authenticated using (active or is_admin());
drop policy if exists poi_places_admin on poi_places;
create policy poi_places_admin on poi_places for all to authenticated using (is_admin()) with check (is_admin());
revoke all on poi_places from anon;
grant select on poi_places to anon, authenticated;

-- Kunci pemisahan: kategori faskes tidak boleh nyasar ke katalog belanja.
do $$ begin
  alter table shop_stores add constraint shop_stores_bukan_faskes
    check (category not in ('rumah_sakit','klinik','puskesmas','faskes')
       and brand    not in ('rumah_sakit','klinik','puskesmas','faskes'));
exception when duplicate_object then null; end $$;
comment on constraint shop_stores_bukan_faskes on shop_stores is
  'Faskes tidak boleh masuk daftar belanja — tempatnya di tabel poi_places.';

-- Titik tujuan terdekat untuk aplikasi (dipakai pencarian tujuan, bukan belanja).
create or replace function nearby_poi(p_lat double precision, p_lng double precision,
                                      p_radius_km numeric default 10, p_kind text default null, p_limit int default 40)
returns table (id uuid, name text, kind text, category text, address text, lat double precision, lng double precision,
               phone text, open_hours text, emergency boolean, distance_km numeric)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, p.kind, p.category, p.address, p.lat, p.lng, p.phone, p.open_hours, p.emergency,
         round((st_distance(p.location, st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography) / 1000.0)::numeric, 2)
  from poi_places p
  where p.active
    and (p_kind is null or p_kind = 'all' or p.kind = p_kind)
    and st_dwithin(p.location, st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography,
                   greatest(0.5, least(coalesce(p_radius_km, 10), 50)) * 1000)
  order by st_distance(p.location, st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography)
  limit greatest(1, least(coalesce(p_limit, 40), 200))
$$;
grant execute on function nearby_poi(double precision, double precision, numeric, text, int) to authenticated;
revoke execute on function nearby_poi(double precision, double precision, numeric, text, int) from anon;
