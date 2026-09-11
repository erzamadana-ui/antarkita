-- =====================================================================
-- 0081 — QC gabungan: menutup CELAH di antara dua penjaga (0071b vs city_at_point)
--
-- LATAR
--   Dua tim menambal risiko yang sama dari sisi berbeda:
--     • 0071b (waktu TULIS)  — baris gazetteer BARU tidak disisipkan bila jatuh di
--       dalam radius_km kota ber-source 'admin';
--     • 0077/0080 (waktu BACA) — city_at_point() bertingkat: kota yang MELAYANI
--       ('aktif') dan mencakup titik menang lebih dulu, baru kota terdekat mana pun.
--
--   Keduanya benar, tetapi tidak saling menutupi seluruh permukaan:
--     (a) 0071b hanya berlaku pada cabang INSERT. Baris yang SUDAH ADA (mis. impor
--         yang berjalan sebelum penjaga dipasang, atau disisipkan lewat jalur lain)
--         masuk ke cabang UPDATE — penjaga tidak pernah menyentuhnya lagi, jadi
--         gazetteer yang terlanjur menyaingi kota tidak bisa dibersihkan penjaga itu.
--     (b) Tingkat (1) city_at_point() hanya mengistimewakan kota ber-status 'aktif'.
--         Tujuh dari sembilan kota kurasi (Medan, Batam, Jakarta, Jambi, Palembang,
--         Dumai, Bukittinggi) BUKAN 'aktif', jadi tidak dilindungi tingkat mana pun.
--
--   Akibatnya (dibuktikan dalam transaksi rollback, 11 Sep 2026): satu baris
--   'Kelurahan Sunggal' 7 km dari pusat Medan membuat pelanggan Medan biasa
--   (6 km dari pusat kota, 600 m dari kelurahan itu) melihat
--       "AntarKita belum melayani Kelurahan Sunggal"
--   alih-alih "… belum melayani Medan", dan city_waitlist_join() mencatat minatnya
--   atas nama KELURAHAN, bukan kota. Itu merusak dasar keputusan pemilik di Panel
--   Admin ("kota dengan peminat terbanyak dibuka lebih dulu") dan mematahkan asersi
--   uji_kota 1b/1d begitu impor gazetteer yang sebenarnya dijalankan.
--
-- PERBAIKAN
--   Aturan 0071b dipindahkan juga ke waktu BACA sebagai TINGKAT KEDUA:
--     (1) kota yang MELAYANI dan mencakup titik      → menang lebih dulu;
--     (2) kota KURASI MANUSIA (source='admin') yang mencakup titik → menang berikutnya;
--     (3) baru kota terdekat mana pun.
--   Dengan begitu baris gazetteer tidak pernah bisa "menutupi" kota kurasi di dalam
--   radiusnya — baik baris baru (dicegah 0071b) maupun baris lama (dikalahkan di sini).
--   Perilaku untuk Pekanbaru & Padang TIDAK berubah (tetap menang di tingkat 1).
--
--   Sekalian: `revoke execute … from anon` pada 0071/0072 TIDAK berpengaruh karena
--   hak bawaan PostgreSQL untuk fungsi ada pada PUBLIC, bukan pada anon. Kedua fungsi
--   itu masih bisa dipanggil anon lewat /rest/v1/rpc/. Dicabut dari PUBLIC sesuai pola
--   pengetatan yang dipakai 0032/0070 ("from public, anon").
-- =====================================================================

-- ---------- 1. city_at_point(): tambah tingkat kota kurasi manusia ----------
create or replace function city_at_point(p_lat double precision, p_lng double precision)
returns table (id uuid, name text, province text, service_status text, radius_km numeric, distance_km numeric)
language sql stable security definer set search_path = public as $$
  select c.id, c.name, c.province, c.service_status, c.radius_km,
         round((st_distance(c.location, st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography) / 1000.0)::numeric, 2)
  from cities c
  where c.location is not null and p_lat is not null and p_lng is not null
  -- URUTAN BERTINGKAT (lihat kepala berkas):
  --   (1) kota yang MELAYANI dan mencakup titik ini;
  --   (2) kota kurasi manusia (source='admin') yang mencakup titik ini — supaya baris
  --       gazetteer OSM tidak pernah menutupi nama kota yang dikenal pelanggan,
  --       walau kotanya belum dilayani/segera;
  --   (3) baru kota terdekat mana pun.
  order by (c.service_status = 'aktif'
            and st_dwithin(c.location, st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography, c.radius_km * 1000)) desc,
           (c.source = 'admin'
            and st_dwithin(c.location, st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography, c.radius_km * 1000)) desc,
           st_distance(c.location, st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography)
  limit 1;
$$;
comment on function city_at_point(double precision, double precision) is
  'Kota untuk sebuah titik, BERTINGKAT: (1) kota melayani yang mencakup titik, '
  '(2) kota kurasi admin yang mencakup titik, (3) kota terdekat mana pun. '
  'Tingkat (2) adalah aturan 0071b yang ditegakkan pada waktu baca, sehingga baris '
  'gazetteer lama sekalipun tidak bisa menyaingi kota kurasi di dalam radiusnya.';
revoke execute on function city_at_point(double precision, double precision) from public, anon, authenticated;

-- ---------- 2. Hak eksekusi: cabut dari PUBLIC, bukan hanya dari anon ----------
revoke execute on function nearest_city_any(double precision, double precision, numeric) from public, anon;
grant  execute on function nearest_city_any(double precision, double precision, numeric) to authenticated, service_role;
revoke execute on function nearby_poi(double precision, double precision, numeric, text, int) from public, anon;
grant  execute on function nearby_poi(double precision, double precision, numeric, text, int) to authenticated;

-- ---------- 3. Penjaga migrasi: buktikan kedua perbaikan benar-benar terpasang ----------
-- Penjaga ini sengaja TIDAK menyentuh tabel cities (data nyata pemilik). Bukti
-- perilakunya ada di supabase/tests/uji_kota.sql bagian 11, di dalam transaksi rollback.
do $$
declare def text; n int;
begin
  -- (a) tingkat kota kurasi benar-benar ada di definisi akhir city_at_point
  select pg_get_functiondef(p.oid) into def from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'city_at_point';
  if def is null then raise exception '0081 GAGAL: city_at_point tidak ditemukan'; end if;
  if position('c.service_status = ''aktif''' in def) = 0 then
    raise exception '0081 GAGAL: tingkat kota MELAYANI hilang dari city_at_point';
  end if;
  if position('c.source = ''admin''' in def) = 0 then
    raise exception '0081 GAGAL: tingkat kota KURASI hilang dari city_at_point — celah gazetteer terbuka lagi';
  end if;
  raise notice '0081 OK: city_at_point bertingkat (melayani → kurasi admin → terdekat)';

  -- (b) hak eksekusi benar-benar tertutup untuk anon
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname in ('nearest_city_any', 'nearby_poi', 'city_at_point')
     and has_function_privilege('anon', p.oid, 'execute');
  if n <> 0 then raise exception '0081 GAGAL: masih ada % fungsi yang bisa dipanggil anon', n; end if;
  raise notice '0081 OK: nearest_city_any / nearby_poi / city_at_point tertutup untuk anon';
end $$;
