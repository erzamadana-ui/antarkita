-- =====================================================================
-- Antar Aja — Seed data uji (akun demo, merchant, menu, promo)
-- Password semua akun demo: AntarAja#2026
-- =====================================================================
create or replace function seed_user(p_id uuid, p_email text, p_name text, p_phone text, p_password text)
returns void language plpgsql security definer as $$
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token,
    email_change_token_new, email_change, is_super_admin)
  values ('00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated', p_email,
    crypt(p_password, gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('full_name', p_name, 'phone', p_phone),
    now(), now(), '', '', '', '', false)
  on conflict (id) do nothing;
  insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), p_id, p_id::text, 'email',
    jsonb_build_object('sub', p_id::text, 'email', p_email, 'email_verified', true, 'phone_verified', false), now(), now(), now())
  on conflict do nothing;
end $$;

select seed_user('a0000000-0000-4000-8000-000000000001', 'admin@antaraja.id',    'Admin Antar Aja',  '+6281100000001', 'AntarAja#2026');
select seed_user('a0000000-0000-4000-8000-000000000002', 'customer@antaraja.id', 'Budi Santoso',     '+6281100000002', 'AntarAja#2026');
select seed_user('a0000000-0000-4000-8000-000000000003', 'driver@antaraja.id',   'Ahmad Fauzi',      '+6281100000003', 'AntarAja#2026');
select seed_user('a0000000-0000-4000-8000-000000000004', 'driver2@antaraja.id',  'Rina Kartika',     '+6281100000004', 'AntarAja#2026');
select seed_user('a0000000-0000-4000-8000-000000000005', 'merchant@antaraja.id', 'Mak Syukur',       '+6281100000005', 'AntarAja#2026');
drop function seed_user(uuid, text, text, text, text);

-- Role
set local antaraja.bypass = 'on';
update profiles set role = 'admin'    where id = 'a0000000-0000-4000-8000-000000000001';
update profiles set role = 'driver'   where id in ('a0000000-0000-4000-8000-000000000003','a0000000-0000-4000-8000-000000000004');
update profiles set role = 'merchant' where id = 'a0000000-0000-4000-8000-000000000005';

-- Saldo awal demo
update wallets set balance = 200000 where user_id = 'a0000000-0000-4000-8000-000000000002';
insert into wallet_transactions (user_id, type, amount, balance_after, note) values ('a0000000-0000-4000-8000-000000000002', 'topup', 200000, 200000, 'Saldo demo awal');
update wallets set balance = 100000 where user_id in ('a0000000-0000-4000-8000-000000000003','a0000000-0000-4000-8000-000000000004');
insert into wallet_transactions (user_id, type, amount, balance_after, note) values
  ('a0000000-0000-4000-8000-000000000003', 'topup', 100000, 100000, 'Deposit awal driver'),
  ('a0000000-0000-4000-8000-000000000004', 'topup', 100000, 100000, 'Deposit awal driver');

-- Driver demo (Padang)
insert into drivers (id, vehicle_type, vehicle_brand, vehicle_plate, vehicle_color, license_number, status, is_online, location, last_seen_at, rating_avg, rating_count, total_trips) values
  ('a0000000-0000-4000-8000-000000000003', 'motor', 'Honda Vario 160', 'BA 1234 AB', 'Hitam', 'SIM-C-000123', 'approved', false, st_setsrid(st_makepoint(100.4172, -0.9471), 4326)::geography, now(), 4.90, 128, 412),
  ('a0000000-0000-4000-8000-000000000004', 'car',   'Toyota Avanza',   'BA 5678 CD', 'Putih', 'SIM-A-000456', 'approved', false, st_setsrid(st_makepoint(100.3620, -0.9150), 4326)::geography, now(), 4.85, 64, 201);

-- Merchant demo
insert into merchants (id, owner_id, name, description, category, address, location, image_url, status, rating_avg, rating_count, prep_minutes) values
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000005', 'Sate Padang Mak Syukur', 'Sate padang legendaris dengan kuah kental rempah', 'Makanan', 'Jl. Sudirman No. 12, Padang', st_setsrid(st_makepoint(100.3625, -0.9405), 4326)::geography, 'https://images.unsplash.com/photo-1529042410759-befb1204b468?w=600', 'approved', 4.80, 950, 15),
  ('b0000000-0000-4000-8000-000000000002', null, 'RM Sederhana Bundo Kanduang', 'Masakan Padang otentik: rendang, ayam pop, gulai tunjang', 'Makanan', 'Jl. Pemuda No. 8, Padang', st_setsrid(st_makepoint(100.3560, -0.9500), 4326)::geography, 'https://images.unsplash.com/photo-1604908176997-125f25cc6f3d?w=600', 'approved', 4.70, 1230, 10),
  ('b0000000-0000-4000-8000-000000000003', null, 'Kopi Kubik Padang', 'Kopi susu gula aren, es kopi, dan roti bakar', 'Minuman', 'Jl. Khatib Sulaiman No. 45, Padang', st_setsrid(st_makepoint(100.3720, -0.9250), 4326)::geography, 'https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=600', 'approved', 4.60, 410, 8),
  ('b0000000-0000-4000-8000-000000000004', null, 'Martabak Kubang Hayuda', 'Martabak mesir kubang & martabak manis', 'Jajanan', 'Jl. M. Yamin No. 130, Padang', st_setsrid(st_makepoint(100.3600, -0.9440), 4326)::geography, 'https://images.unsplash.com/photo-1608039829572-78524f79c4c7?w=600', 'approved', 4.75, 620, 12),
  ('b0000000-0000-4000-8000-000000000005', null, 'Ayam Geprek Bensu Padang', 'Ayam geprek sambal level 1-10', 'Makanan', 'Jl. Veteran No. 20, Padang', st_setsrid(st_makepoint(100.3680, -0.9350), 4326)::geography, 'https://images.unsplash.com/photo-1562967914-608f82629710?w=600', 'approved', 4.50, 880, 12),
  ('b0000000-0000-4000-8000-000000000006', null, 'Es Durian Ganti Nan Lamo', 'Es durian dan es campur khas Padang', 'Minuman', 'Jl. Pulau Karam No. 3, Padang', st_setsrid(st_makepoint(100.3580, -0.9560), 4326)::geography, 'https://images.unsplash.com/photo-1488900128323-21503983a07e?w=600', 'approved', 4.65, 300, 8),
  ('b0000000-0000-4000-8000-000000000007', null, 'Pekanbaru Mie Ayam Pak Kumis', 'Mie ayam & bakso', 'Makanan', 'Jl. Sudirman No. 200, Pekanbaru', st_setsrid(st_makepoint(101.4478, 0.5071), 4326)::geography, 'https://images.unsplash.com/photo-1569718212165-3a8278d5f624?w=600', 'approved', 4.55, 210, 10),
  ('b0000000-0000-4000-8000-000000000008', null, 'Sate Ocu Kampar', 'Sate ocu khas Kampar', 'Makanan', 'Jl. Tuanku Tambusai No. 50, Pekanbaru', st_setsrid(st_makepoint(101.4300, 0.5150), 4326)::geography, 'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=600', 'approved', 4.70, 340, 15);

insert into menu_items (merchant_id, name, description, price, category, sort_order) values
  ('b0000000-0000-4000-8000-000000000001', 'Sate Padang 10 Tusuk', 'Sate daging sapi + kuah kental + ketupat', 30000, 'Sate', 1),
  ('b0000000-0000-4000-8000-000000000001', 'Sate Padang 20 Tusuk', 'Porsi jumbo', 55000, 'Sate', 2),
  ('b0000000-0000-4000-8000-000000000001', 'Sate Lidah', 'Sate lidah sapi 10 tusuk', 35000, 'Sate', 3),
  ('b0000000-0000-4000-8000-000000000001', 'Kerupuk Kulit', 'Kerupuk jangek', 5000, 'Tambahan', 4),
  ('b0000000-0000-4000-8000-000000000001', 'Teh Talua', 'Teh telur khas Minang', 12000, 'Minuman', 5),
  ('b0000000-0000-4000-8000-000000000002', 'Nasi Rendang', 'Nasi + rendang daging + sayur', 28000, 'Nasi', 1),
  ('b0000000-0000-4000-8000-000000000002', 'Nasi Ayam Pop', 'Nasi + ayam pop + sambal lado', 25000, 'Nasi', 2),
  ('b0000000-0000-4000-8000-000000000002', 'Nasi Gulai Tunjang', 'Nasi + gulai tunjang', 30000, 'Nasi', 3),
  ('b0000000-0000-4000-8000-000000000002', 'Nasi Dendeng Balado', 'Nasi + dendeng balado', 32000, 'Nasi', 4),
  ('b0000000-0000-4000-8000-000000000002', 'Es Teh Manis', '', 5000, 'Minuman', 5),
  ('b0000000-0000-4000-8000-000000000003', 'Kopi Susu Gula Aren', 'Signature', 18000, 'Kopi', 1),
  ('b0000000-0000-4000-8000-000000000003', 'Es Kopi Hitam', '', 12000, 'Kopi', 2),
  ('b0000000-0000-4000-8000-000000000003', 'Matcha Latte', '', 22000, 'Non-Kopi', 3),
  ('b0000000-0000-4000-8000-000000000003', 'Roti Bakar Coklat Keju', '', 15000, 'Snack', 4),
  ('b0000000-0000-4000-8000-000000000004', 'Martabak Kubang Daging', 'Martabak mesir isi daging + kuah cuka', 35000, 'Martabak', 1),
  ('b0000000-0000-4000-8000-000000000004', 'Martabak Manis Coklat Keju', '', 32000, 'Martabak', 2),
  ('b0000000-0000-4000-8000-000000000004', 'Martabak Manis Kacang', '', 28000, 'Martabak', 3),
  ('b0000000-0000-4000-8000-000000000005', 'Ayam Geprek Original', 'Ayam geprek + nasi + sambal level pilihan', 18000, 'Geprek', 1),
  ('b0000000-0000-4000-8000-000000000005', 'Ayam Geprek Keju', '', 23000, 'Geprek', 2),
  ('b0000000-0000-4000-8000-000000000005', 'Es Teh Jumbo', '', 6000, 'Minuman', 3),
  ('b0000000-0000-4000-8000-000000000006', 'Es Durian', 'Es durian asli', 20000, 'Es', 1),
  ('b0000000-0000-4000-8000-000000000006', 'Es Campur', '', 15000, 'Es', 2),
  ('b0000000-0000-4000-8000-000000000007', 'Mie Ayam Bakso', '', 18000, 'Mie', 1),
  ('b0000000-0000-4000-8000-000000000007', 'Bakso Urat Jumbo', '', 22000, 'Bakso', 2),
  ('b0000000-0000-4000-8000-000000000008', 'Sate Ocu 10 Tusuk', '', 30000, 'Sate', 1),
  ('b0000000-0000-4000-8000-000000000008', 'Sate Ocu 20 Tusuk', '', 55000, 'Sate', 2);

insert into promos (code, description, discount_type, value, max_discount, min_total, service, quota) values
  ('ANTARBARU', 'Diskon 50% s.d. Rp10.000 untuk pengguna baru', 'percent', 50, 10000, 10000, null, 1000),
  ('HEMAT5', 'Potongan Rp5.000 min. transaksi Rp20.000', 'fixed', 5000, null, 20000, null, null),
  ('MAKANENAK', 'Diskon 20% AntarFood s.d. Rp15.000', 'percent', 20, 15000, 30000, 'food', 500);

insert into saved_places (user_id, label, address, lat, lng) values
  ('a0000000-0000-4000-8000-000000000002', 'Rumah', 'Jl. Sudirman No. 45, Padang', -0.9471, 100.4172),
  ('a0000000-0000-4000-8000-000000000002', 'Kantor', 'Jl. Khatib Sulaiman, Padang', -0.9250, 100.3720);

-- Contoh harga kompetitor (untuk halaman intelijen harga admin) — perbarui dengan survei nyata
insert into competitor_prices (competitor, service, base_fare, per_km, min_fare, level, source, note)
select * from (values
 ('Kompetitor A','ride_motor'::service_type,0,2600,10000,'middle','Contoh referensi — perbarui dengan survei aplikasi kompetitor','Data contoh'),
 ('Kompetitor B','ride_motor'::service_type,0,2500,9500,'middle','Contoh referensi — perbarui dengan survei aplikasi kompetitor','Data contoh'),
 ('Kompetitor A','ride_motor'::service_type,0,3400,13000,'high','Contoh referensi (jam sibuk)','Data contoh'),
 ('Kompetitor A','ride_car'::service_type,0,5000,20000,'middle','Contoh referensi','Data contoh'),
 ('Kompetitor B','ride_car'::service_type,0,4800,19000,'middle','Contoh referensi','Data contoh'),
 ('Kompetitor A','food'::service_type,0,2500,9000,'middle','Contoh referensi (ongkir)','Data contoh'),
 ('Kompetitor A','send'::service_type,0,2700,10000,'middle','Contoh referensi','Data contoh'),
 ('Kompetitor A','shop'::service_type,3000,2700,12000,'middle','Contoh referensi (jasa belanja)','Data contoh')
) v(competitor, service, base_fare, per_km, min_fare, level, source, note)
where not exists (select 1 from competitor_prices);

-- Tahap 4: label halal demo (klaim + 2 terverifikasi)
update merchants set is_halal = true where name not ilike '%kopi%';
update merchants set halal_verified = true where id in ('b0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000002');
update promos set image_url = 'https://erzamadana-ui.github.io/antarkita/promos/' || code || '.jpg', sort_order = case code when 'ANTARBARU' then 1 when 'MAKANENAK' then 2 else 3 end where code in ('ANTARBARU','MAKANENAK','HEMAT5');
insert into promos (code, title, description, discount_type, value, max_discount, min_total, service, quota, is_active, image_url, sort_order) values
('RIDEHEMAT', 'Ride Hemat 15%', 'AntarRide · s.d. Rp5.000 · min. Rp15.000', 'percent', 15, 5000, 15000, 'ride_motor', 500, true, 'https://erzamadana-ui.github.io/antarkita/promos/RIDEHEMAT.jpg', 4),
('CARKELUARGA', 'AntarCar Diskon Rp10.000', 'Kelas Standar & Premium · min. Rp40.000', 'fixed', 10000, null, 40000, 'ride_car', 500, true, 'https://erzamadana-ui.github.io/antarkita/promos/CARKELUARGA.jpg', 5),
('LISTRIKHIJAU', 'Naik Mobil Listrik Hemat 20%', 'AntarCar Listrik · s.d. Rp15.000', 'percent', 20, 15000, 30000, 'ride_car', 500, true, 'https://erzamadana-ui.github.io/antarkita/promos/LISTRIKHIJAU.jpg', 6),
('SENDKILAT', 'Ongkir Kirim Rp3.000', 'AntarSend dalam kota · min. Rp12.000', 'fixed', 3000, null, 12000, 'send', 500, true, 'https://erzamadana-ui.github.io/antarkita/promos/SENDKILAT.jpg', 7),
('ANTARKOTA', 'Antar Kota Hemat Rp15.000', 'AntarSend antar kota via gudang mitra', 'fixed', 15000, null, 50000, 'send', 500, true, 'https://erzamadana-ui.github.io/antarkita/promos/ANTARKOTA.jpg', 8),
('PINDAHAN', 'Pindahan Hemat Rp50.000', 'AntarBox mobil box + pembantu · min. Rp300.000', 'fixed', 50000, null, 300000, 'box', 500, true, 'https://erzamadana-ui.github.io/antarkita/promos/PINDAHAN.jpg', 9),
('PICKUPHEMAT', 'Pick Up Diskon 10%', 'AntarBox pick up · s.d. Rp30.000', 'percent', 10, 30000, 80000, 'box', 500, true, 'https://erzamadana-ui.github.io/antarkita/promos/PICKUPHEMAT.jpg', 10),
('TRAVELPAGI', 'Travel Pagi Hemat Rp20.000', 'AntarTravel keberangkatan 05.00–09.00', 'fixed', 20000, null, 120000, 'ride_car', 500, true, 'https://erzamadana-ui.github.io/antarkita/promos/TRAVELPAGI.jpg', 11),
('BELANJAHEMAT', 'Ongkir Belanja Rp5.000', 'AntarShop Alfamart/Indomaret · min. Rp50.000', 'fixed', 5000, null, 50000, 'shop', 500, true, 'https://erzamadana-ui.github.io/antarkita/promos/BELANJAHEMAT.jpg', 12),
('SARAPAN', 'Sarapan Diskon 25%', 'AntarFood 06.00–10.00 · s.d. Rp12.000', 'percent', 25, 12000, 25000, 'food', 500, true, 'https://erzamadana-ui.github.io/antarkita/promos/SARAPAN.jpg', 13),
('MAKANSIANG', 'Makan Siang Rp8.000 Off', 'AntarFood 11.00–14.00 · min. Rp30.000', 'fixed', 8000, null, 30000, 'food', 500, true, 'https://erzamadana-ui.github.io/antarkita/promos/MAKANSIANG.jpg', 14),
('NGOPI', 'Ngopi Diskon 30%', 'Kopi & minuman · s.d. Rp10.000', 'percent', 30, 10000, 20000, 'food', 500, true, 'https://erzamadana-ui.github.io/antarkita/promos/NGOPI.jpg', 15),
('HALALFEST', 'Halal Fest 20%', 'Merchant halal terverifikasi · s.d. Rp15.000', 'percent', 20, 15000, 35000, 'food', 500, true, 'https://erzamadana-ui.github.io/antarkita/promos/HALALFEST.jpg', 16),
('WEEKEND', 'Weekend Hemat 15%', 'Semua layanan Sabtu–Minggu · s.d. Rp10.000', 'percent', 15, 10000, 20000, null, 500, true, 'https://erzamadana-ui.github.io/antarkita/promos/WEEKEND.jpg', 17),
('GAJIAN', 'Gajian Diskon Rp20.000', 'Tanggal 25–31 · min. Rp100.000', 'fixed', 20000, null, 100000, null, 500, true, 'https://erzamadana-ui.github.io/antarkita/promos/GAJIAN.jpg', 18),
('TOPUP50', 'Top Up Bonus 5%', 'Top up AntarPay via e-wallet · s.d. Rp25.000', 'percent', 5, 25000, 100000, null, 500, true, 'https://erzamadana-ui.github.io/antarkita/promos/TOPUP50.jpg', 19),
('AJAKTEMAN', 'Ajak Teman Rp15.000', 'Teman baru pakai kode ini, kamu dapat bonus', 'fixed', 15000, null, 20000, null, 500, true, 'https://erzamadana-ui.github.io/antarkita/promos/AJAKTEMAN.jpg', 20)
on conflict (code) do update set title = excluded.title, description = excluded.description, image_url = excluded.image_url, sort_order = excluded.sort_order;
-- ===== Tahap 6: seed toko katalog, produk, pasar tradisional, bahan masak (harga acuan = perkiraan, wajib disurvei admin) =====
insert into shop_stores (name, brand, category, address, lat, lng, open_hours, catalog_source) values
  ('Indomaret Sudirman Pekanbaru', 'indomaret', 'minimarket', 'Jl. Jend. Sudirman No. 199, Pekanbaru', 0.5168, 101.4463, '07:00-23:00', 'admin'),
  ('Alfamart Nangka Pekanbaru', 'alfamart', 'minimarket', 'Jl. Tuanku Tambusai (Nangka), Pekanbaru', 0.4985, 101.4197, '07:00-23:00', 'admin'),
  ('Apotek K-24 Arifin Ahmad', 'apotek', 'apotek', 'Jl. Arifin Ahmad, Pekanbaru', 0.4813, 101.4275, '00:00-24:00', 'admin'),
  ('Hypermart Mal SKA Pekanbaru', 'supermarket', 'supermarket', 'Mal SKA, Jl. Soekarno-Hatta, Pekanbaru', 0.4795, 101.4194, '10:00-22:00', 'admin'),
  ('Indomaret Khatib Sulaiman Padang', 'indomaret', 'minimarket', 'Jl. Khatib Sulaiman, Padang', -0.9219, 100.3574, '07:00-23:00', 'admin'),
  ('Alfamart Veteran Padang', 'alfamart', 'minimarket', 'Jl. Veteran, Padang', -0.9401, 100.3611, '07:00-23:00', 'admin'),
  ('Apotek Kimia Farma Padang', 'apotek', 'apotek', 'Jl. Proklamasi, Padang', -0.9463, 100.3651, '07:00-22:00', 'admin'),
  ('Transmart Padang', 'supermarket', 'supermarket', 'Jl. Khatib Sulaiman, Padang', -0.9152, 100.3588, '10:00-22:00', 'admin')
on conflict do nothing;
update shop_stores set city_id = nearest_city(lat, lng) where city_id is null;

-- katalog dasar (harga toko: perkiraan Sep 2026 — admin memperbarui lewat panel / impor CSV)
with items(sku, name, category, unit, price) as (values
  ('beras-setra-5', 'Beras Setra Ramos 5 kg', 'sembako', 'karung', 74500), ('minyak-bimoli-2l', 'Minyak Goreng Bimoli 2 L', 'sembako', 'pouch', 39900), ('minyakita-1l', 'MinyaKita 1 L', 'sembako', 'pouch', 17000),
  ('gula-gulaku-1', 'Gula Pasir Gulaku 1 kg', 'sembako', 'pack', 18900), ('telur-1kg', 'Telur Ayam 1 kg', 'sembako', 'kg', 30500), ('tepung-segitiga-1', 'Tepung Terigu Segitiga Biru 1 kg', 'sembako', 'pack', 13500),
  ('indomie-goreng', 'Indomie Goreng', 'sembako', 'pcs', 3500), ('indomie-kari', 'Indomie Kari Ayam', 'sembako', 'pcs', 3600), ('kecap-bango-220', 'Kecap Manis Bango 220 ml', 'dapur', 'btl', 12900),
  ('susu-uht-ultra-1l', 'Susu UHT Ultra Milk 1 L', 'minuman', 'pack', 21500), ('aqua-600', 'Aqua 600 ml', 'minuman', 'btl', 4000), ('aqua-galon', 'Aqua Galon 19 L (isi ulang)', 'minuman', 'galon', 22000),
  ('teh-pucuk-350', 'Teh Pucuk Harum 350 ml', 'minuman', 'btl', 4000), ('kopi-kapal-api-165', 'Kopi Kapal Api Special 165 g', 'minuman', 'pack', 16500),
  ('sabun-lifebuoy', 'Sabun Lifebuoy 85 g', 'kebersihan', 'pcs', 5200), ('rinso-770', 'Rinso Anti Noda 770 g', 'kebersihan', 'pack', 24500), ('sunlight-700', 'Sunlight Jeruk Nipis 700 ml', 'kebersihan', 'pouch', 16900),
  ('pepsodent-190', 'Pepsodent 190 g', 'kebersihan', 'pcs', 15500), ('tisu-paseo-250', 'Tisu Paseo 250 lembar', 'kebersihan', 'pack', 18900),
  ('chitato-68', 'Chitato 68 g', 'snack', 'pcs', 11500), ('roti-sari-roti', 'Sari Roti Tawar', 'snack', 'pcs', 16000), ('biskuit-roma-300', 'Roma Kelapa 300 g', 'snack', 'pack', 12500),
  ('pampers-m', 'Popok Bayi Merries M 34', 'bayi', 'pack', 89000), ('sgm-900', 'Susu SGM Eksplor 1+ 900 g', 'bayi', 'box', 96000),
  ('paracetamol', 'Paracetamol 500 mg (strip 10)', 'obat', 'strip', 4000), ('tolak-angin', 'Tolak Angin Cair (5 sachet)', 'obat', 'pack', 21000), ('betadine-15', 'Betadine 15 ml', 'obat', 'btl', 19500),
  ('vitamin-c-ipi', 'Vitamin C IPI (tube 50)', 'obat', 'tube', 8500), ('minyak-kayu-putih-60', 'Minyak Kayu Putih Cap Lang 60 ml', 'obat', 'btl', 27000), ('masker-50', 'Masker Medis 3-ply (50)', 'obat', 'box', 32000)
)
insert into shop_products (store_id, sku, name, category, unit, price, in_stock)
select s.id, i.sku, i.name, i.category, i.unit,
  case when s.category = 'supermarket' then round(i.price * 0.96 / 100) * 100 when s.brand = 'alfamart' then i.price + 200 else i.price end,
  not (i.sku in ('telur-1kg') and s.brand = 'indomaret' and s.name like '%Sudirman%')
from shop_stores s cross join items i
where (s.category in ('minimarket','supermarket') and i.category <> 'obat') or (s.category = 'apotek' and i.category in ('obat','kebersihan','bayi')) or (s.category = 'supermarket' and i.category = 'obat')
on conflict (store_id, sku) do nothing;

-- pasar tradisional
insert into markets (name, address, lat, lng, open_hours, notes) values
  ('Pasar Bawah Pekanbaru', 'Jl. Saleh Abbas, Senapelan, Pekanbaru', 0.5345, 101.4407, '05:00-16:00', 'Pasar tertua Pekanbaru; ikan & bumbu lengkap pagi hari'),
  ('Pasar Cik Puan', 'Jl. Tuanku Tambusai, Pekanbaru', 0.5029, 101.4269, '05:00-14:00', 'Sayur, ayam, daging'),
  ('Pasar Pagi Arengka', 'Jl. Soekarno-Hatta (Arengka), Pekanbaru', 0.4778, 101.4029, '04:30-12:00', 'Pasar pagi, ramai jam 06.00–09.00'),
  ('Pasar Raya Padang', 'Jl. Pasar Raya, Padang', -0.9497, 100.3597, '05:00-17:00', 'Pasar induk kota Padang'),
  ('Pasar Lubuk Buaya', 'Jl. Adinegoro, Lubuk Buaya, Padang', -0.8557, 100.3453, '05:00-13:00', 'Sayur & ikan segar'),
  ('Pasar Siteba', 'Jl. Siteba, Nanggalo, Padang', -0.9146, 100.3789, '05:00-13:00', null)
on conflict do nothing;
update markets set city_id = nearest_city(lat, lng) where city_id is null;

-- bahan masak & harga acuan (perkiraan; kategori PIHPS + bahan umum) — WAJIB disurvei admin sebelum dipakai komersial
insert into market_items (name, category, unit, ref_price, price_source, sort) values
  ('Beras medium', 'sembako', 'kg', 14500, 'admin', 10), ('Beras premium', 'sembako', 'kg', 16500, 'admin', 11), ('Gula pasir', 'sembako', 'kg', 18000, 'admin', 12), ('Minyak goreng curah', 'sembako', 'liter', 17000, 'admin', 13), ('Telur ayam ras', 'sembako', 'kg', 29000, 'admin', 14), ('Tepung terigu', 'sembako', 'kg', 12500, 'admin', 15),
  ('Cabai merah keriting', 'bumbu', 'kg', 42000, 'admin', 20), ('Cabai merah besar', 'bumbu', 'kg', 40000, 'admin', 21), ('Cabai rawit merah', 'bumbu', 'kg', 55000, 'admin', 22), ('Cabai rawit hijau', 'bumbu', 'kg', 45000, 'admin', 23), ('Bawang merah', 'bumbu', 'kg', 38000, 'admin', 24), ('Bawang putih', 'bumbu', 'kg', 40000, 'admin', 25), ('Bawang bombay', 'bumbu', 'kg', 30000, 'admin', 26), ('Jahe', 'bumbu', 'kg', 35000, 'admin', 27), ('Kunyit', 'bumbu', 'kg', 20000, 'admin', 28), ('Lengkuas', 'bumbu', 'kg', 15000, 'admin', 29), ('Serai', 'bumbu', 'ikat', 5000, 'admin', 30), ('Daun salam & jeruk', 'bumbu', 'ikat', 3000, 'admin', 31), ('Kelapa parut', 'bumbu', 'butir', 8000, 'admin', 32), ('Kemiri', 'bumbu', 'ons', 6000, 'admin', 33),
  ('Ayam potong (broiler)', 'daging_ikan', 'ekor', 45000, 'admin', 40), ('Ayam kampung', 'daging_ikan', 'ekor', 85000, 'admin', 41), ('Daging sapi', 'daging_ikan', 'kg', 140000, 'admin', 42), ('Ikan tongkol', 'daging_ikan', 'kg', 38000, 'admin', 43), ('Ikan kembung', 'daging_ikan', 'kg', 40000, 'admin', 44), ('Ikan nila', 'daging_ikan', 'kg', 36000, 'admin', 45), ('Ikan lele', 'daging_ikan', 'kg', 28000, 'admin', 46), ('Udang', 'daging_ikan', 'kg', 90000, 'admin', 47), ('Tahu', 'daging_ikan', 'papan', 7000, 'admin', 48), ('Tempe', 'daging_ikan', 'papan', 7000, 'admin', 49),
  ('Tomat', 'sayur', 'kg', 14000, 'admin', 50), ('Kentang', 'sayur', 'kg', 18000, 'admin', 51), ('Wortel', 'sayur', 'kg', 16000, 'admin', 52), ('Kol / kubis', 'sayur', 'kg', 10000, 'admin', 53), ('Sawi hijau', 'sayur', 'ikat', 5000, 'admin', 54), ('Kangkung', 'sayur', 'ikat', 4000, 'admin', 55), ('Bayam', 'sayur', 'ikat', 4000, 'admin', 56), ('Kacang panjang', 'sayur', 'ikat', 6000, 'admin', 57), ('Buncis', 'sayur', 'kg', 16000, 'admin', 58), ('Terong', 'sayur', 'kg', 12000, 'admin', 59), ('Timun', 'sayur', 'kg', 10000, 'admin', 60), ('Labu siam', 'sayur', 'kg', 9000, 'admin', 61), ('Daun singkong', 'sayur', 'ikat', 3000, 'admin', 62), ('Nangka muda', 'sayur', 'kg', 12000, 'admin', 63), ('Jagung manis', 'sayur', 'buah', 5000, 'admin', 64), ('Toge', 'sayur', 'kg', 12000, 'admin', 65),
  ('Pisang', 'buah', 'sisir', 18000, 'admin', 70), ('Jeruk medan', 'buah', 'kg', 30000, 'admin', 71), ('Pepaya', 'buah', 'buah', 15000, 'admin', 72), ('Semangka', 'buah', 'kg', 9000, 'admin', 73), ('Apel fuji', 'buah', 'kg', 40000, 'admin', 74), ('Mangga', 'buah', 'kg', 25000, 'admin', 75), ('Alpukat', 'buah', 'kg', 30000, 'admin', 76),
  ('Santan instan (Kara 200 ml)', 'lainnya', 'pcs', 8000, 'admin', 80), ('Garam', 'lainnya', 'bungkus', 4000, 'admin', 81), ('Kerupuk', 'lainnya', 'bungkus', 10000, 'admin', 82), ('Gas LPG 3 kg (isi ulang)', 'lainnya', 'tabung', 22000, 'admin', 83)
on conflict do nothing;
