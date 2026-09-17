-- 0094_rapikan_kota_lama
-- Rapikan baris kota lama supaya konsisten dengan impor Kepmendagri (0091-0093).
--
-- Masalah yang ditemukan setelah impor: 13 dari 514 baris Kepmendagri tidak jadi masuk
-- karena namanya bentrok dengan baris lama.
--   * 4 di antaranya kota yang memang sudah aktif (Batam, Dumai, Padang, Pekanbaru) -- biarkan.
--   * 4 baris admin lama bernama singkat (Bukittinggi, Jambi, Medan, Palembang) -- biarkan
--     namanya, cukup samakan statusnya. Nama ini muncul di teks UI, jadi tidak diganti.
--   * 5 sisanya bentrok dengan baris arsip OSM yang sudah active=false, sehingga Bandung,
--     Cirebon dan Yogyakarta justru hilang sama sekali dari daftar. Ini yang diperbaiki.
--
-- Tidak ada baris yang dihapus dan 4 kota aktif tidak disentuh.

-- 1) Arsipkan 5 baris OSM nonaktif yang memblokir nama resmi.
update cities
   set name = name || ' (arsip OSM)',
       status_note = coalesce(status_note || ' | ', '') || '0094: diarsipkan, digantikan baris Kepmendagri.'
 where source = 'osm' and active = false
   and name in ('Bandung','Cirebon','Kabupaten Bandung','Kabupaten Cirebon','Yogyakarta');

-- 2) Masukkan 5 baris Kepmendagri yang tadi terblokir.
insert into cities (name, province, location, radius_km, kind, population, source, service_status, active, imported_at)
select v.nama, v.prov, st_setsrid(st_makepoint(v.lng, v.lat), 4326)::geography,
       v.rad, v.kind, v.pend, 'admin', 'segera', true, now()
from (values
('Kota Bandung','Jawa Barat',-6.910656,107.609870,25,'kota',2591763),
('Kota Cirebon','Jawa Barat',-6.706735,108.558247,25,'kota',356629),
('Kabupaten Bandung','Jawa Barat',-7.021855,107.527551,50,'kabupaten',3839721),
('Kabupaten Cirebon','Jawa Barat',-6.764528,108.478620,50,'kabupaten',2489046),
('Kota Yogyakarta','Daerah Istimewa Yogyakarta',-7.799905,110.391371,25,'kota',415605)
) as v(nama, prov, lat, lng, rad, kind, pend)
on conflict (name) do nothing;

-- 3) Samakan status baris admin lama yang namanya singkat menjadi 'segera'.
update cities set service_status = 'segera', status_changed_at = now()
 where service_status = 'belum_dilayani' and source = 'admin'
   and name in ('Bukittinggi','Jakarta','Jambi','Medan','Palembang');

-- Penjaga: migrasi batal kalau hasil akhirnya tidak sesuai harapan.
do $$
declare v_segera int; v_aktif int; v_total int; v_kepmendagri int;
begin
  select count(*) into v_aktif from cities where service_status = 'aktif';
  select count(*) into v_segera from cities where service_status = 'segera';
  select count(*) into v_total from cities;
  select count(*) into v_kepmendagri from cities where source = 'admin' and imported_at is not null;
  if v_aktif <> 4 then
    raise exception '0094 batal: kota aktif % (harus tetap 4)', v_aktif;
  end if;
  if v_segera <> 511 then
    raise exception '0094 batal: kota segera % (harus 511)', v_segera;
  end if;
  if v_kepmendagri <> 506 then
    raise exception '0094 batal: baris impor Kepmendagri % (harus 506)', v_kepmendagri;
  end if;
  raise notice '0094 ok: total %, aktif %, segera %', v_total, v_aktif, v_segera;
end $$;
