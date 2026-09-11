-- =====================================================================
-- 0076 — Sakelar layanan per kota (gerbang wilayah operasi)
--
-- MASALAH YANG DIPECAHKAN
--   Data tempat (apotek, pasar, minimarket, supermarket, faskes) diisi untuk
--   SELURUH Indonesia, tetapi driver hanya ada di sebagian kecil kota.
--   Tanpa gerbang, pelanggan di kota tanpa driver bisa memesan, pesanannya
--   mencari driver, lalu gagal — ulasan bintang satu yang pasti, dan bisa
--   diuji peninjau Google/Apple dari mana saja.
--
-- KOMPATIBILITAS DENGAN `cities.active` (PENTING)
--   Kolom `cities.active` SUDAH dipakai kode lain dengan arti "kota terdaftar
--   di sistem" — nearest_city(), import_places(), useTravel(), blast promo,
--   dropdown gudang/rute. Artinya TIDAK diubah dan nilainya TIDAK disentuh.
--   Status operasi ditaruh di kolom BARU `service_status`, sehingga:
--     • kota tetap muncul di daftar & data tempat tetap bisa ditelusuri;
--     • hanya kemampuan MEMESAN yang dikunci.
--
-- TIGA STATUS
--   'belum_dilayani' — data ada, pesanan tertutup (bawaan untuk kota baru)
--   'segera'         — daftar tunggu dibuka, pesanan masih tertutup
--   'aktif'          — melayani; layanan mana saja ditentukan per baris city_services
--
-- SAKELAR PER LAYANAN, BUKAN HANYA PER KOTA
--   Tabel `city_services` menyimpan satu baris per (kota, layanan). Medan boleh
--   dibuka untuk AntarShop & AntarSend lebih dulu, AntarRide menyusul.
--   GAGAL-TERTUTUP: tidak ada baris = layanan TERTUTUP, walau kota berstatus
--   'aktif'. Membuka kota harus selalu keputusan sadar per layanan.
-- =====================================================================

-- ---------- 1. Kolom status & penanggung jawab pada cities ----------
alter table cities
  add column if not exists service_status text not null default 'belum_dilayani',
  add column if not exists status_note text,
  add column if not exists status_changed_at timestamptz,
  add column if not exists status_changed_by uuid references profiles(id) on delete set null,
  -- Perwakilan Kota (PIC): admin yang bertanggung jawab atas operasi kota ini.
  add column if not exists manager_id uuid references profiles(id) on delete set null,
  add column if not exists manager_note text,
  -- Radius wajar dari pusat kota. Titik jemput di luar radius kota mana pun ditolak.
  add column if not exists radius_km numeric not null default 35;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cities_service_status_check') then
    alter table cities add constraint cities_service_status_check
      check (service_status in ('belum_dilayani', 'segera', 'aktif'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'cities_radius_km_check') then
    alter table cities add constraint cities_radius_km_check check (radius_km > 0 and radius_km <= 200);
  end if;
end $$;

comment on column cities.active is
  'Kota terdaftar di sistem (dipakai nearest_city, impor tempat, rute travel). BUKAN penanda kota melayani pesanan — itu service_status.';
comment on column cities.service_status is
  'Status operasi: belum_dilayani (data ada, pesanan tertutup) | segera (daftar tunggu dibuka) | aktif (melayani, per layanan lihat city_services).';
comment on column cities.manager_id is 'Perwakilan Kota (PIC) — admin penanggung jawab operasi kota ini.';
comment on column cities.radius_km is 'Radius wajar dari pusat kota; titik jemput di luar radius kota mana pun ditolak create_order.';

create index if not exists cities_service_status_idx on cities (service_status);
create index if not exists cities_manager_idx on cities (manager_id) where manager_id is not null;

-- ---------- 2. Sakelar per layanan per kota ----------
create table if not exists city_services (
  city_id   uuid not null references cities(id) on delete cascade,
  service   service_type not null,
  enabled   boolean not null default false,
  opened_at timestamptz,
  opened_by uuid references profiles(id) on delete set null,
  note      text,
  updated_at timestamptz not null default now(),
  primary key (city_id, service)
);
comment on table city_services is
  'Satu baris per (kota, layanan). Tidak ada baris = layanan TERTUTUP di kota itu (gagal-tertutup).';

create index if not exists city_services_enabled_idx on city_services (service) where enabled;

-- ---------- 3. RLS ----------
alter table city_services enable row level security;

drop policy if exists city_services_select on city_services;
create policy city_services_select on city_services
  for select to anon, authenticated using (true);   -- pelanggan harus tahu layanan mana yang dibuka

drop policy if exists city_services_admin on city_services;
create policy city_services_admin on city_services
  for all to authenticated using (is_admin()) with check (is_admin());

grant select on city_services to anon, authenticated;
grant insert, update, delete on city_services to authenticated;   -- tetap disaring RLS is_admin()

-- ---------- 4. Penjaga: cities tidak boleh kehilangan arti kolom lama ----------
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'cities' and column_name = 'active') then
    raise exception 'Kolom cities.active hilang — kompatibilitas kode lama rusak';
  end if;
end $$;
