-- =====================================================================
-- pasca/seed.sql — pasangan pra/seed.sql (harness LOKAL)
-- Memindahkan nilai sementara drivers.license_number ke driver_documents
-- (letak resminya sejak 0004_review_fixes.sql) lalu menghapus kolom
-- sementara, sehingga skema akhir sama persis dengan hasil migrasi.
-- =====================================================================
insert into public.driver_documents (driver_id, license_number)
select id, license_number from public.drivers where license_number is not null
on conflict (driver_id) do update set license_number = excluded.license_number;

alter table public.drivers drop column if exists license_number;

-- =====================================================================
-- Data uji tambahan yang DIASUMSIKAN supabase/tests/simulasi_e2e.sql tetapi
-- tidak dibuat seed.sql. Di produksi keduanya lahir dari uji manual lewat
-- aplikasi (docs/LAPORAN-UJI-SIMULASI.md), bukan dari migrasi/seed:
--   (a) drv2 (Rina Kartika, a0..04) terdaftar sebagai MITRA TRAVEL disetujui
--       — S10/S11/S26/S27/S33/S50 memanggil travel_trip_create dst. sebagai drv2;
--       S0 hanya "memulihkan" status ke approved bila barisnya sudah ada.
--   (b) satu driver ber-kendaraan box/pickup (S25 matriks kendaraan membaca
--       `dbox` dari drivers where vehicle_type in ('box','pickup')).
-- Dibuat lewat RPC aplikasi bila memungkinkan supaya jalurnya sama dengan produksi.
-- =====================================================================
do $$
declare
  drv2 uuid := 'a0000000-0000-4000-8000-000000000004';
  adm  uuid := 'a0000000-0000-4000-8000-000000000001';
  dbox uuid := 'a0000000-0000-4000-8000-000000000006';
  v_pw text := nullif(current_setting('app.seed_password', true), '');
  t travel_partners;
begin
  -- (a) mitra travel drv2 (Pekanbaru), disetujui admin
  if not exists (select 1 from travel_partners where id = drv2) then
    perform set_config('request.jwt.claims', json_build_object('sub', drv2, 'role', 'authenticated')::text, true);
    t := travel_partner_register(jsonb_build_object(
      'company_name', 'Rina Travel Pekanbaru', 'vehicle_model', 'Toyota HiAce Commuter', 'vehicle_plate', 'BM 2020 TR',
      'vehicle_year', 2022, 'seats', 8, 'partner_type', 'agency', 'offers_shared', true, 'offers_charter', true,
      'base_lat', 0.5071, 'base_lng', 101.4478, 'driver_name', 'Rina Kartika', 'bio', 'Akun uji lokal (harness db-lokal)'));
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    perform admin_set_travel_partner(drv2, 'approved', 'seed lokal');
    perform set_config('request.jwt.claims', '', true);
    raise notice 'pasca/seed: mitra travel % (%) disetujui', t.company_name, drv2;
  end if;

  -- (b) driver box uji (Pekanbaru): akun auth + profil (trigger handle_new_user) + baris drivers
  if not exists (select 1 from drivers where vehicle_type in ('box', 'pickup')) then
    if v_pw is null then raise exception 'pasca/seed: app.seed_password belum disetel'; end if;
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token,
      email_change_token_new, email_change, is_super_admin)
    values ('00000000-0000-0000-0000-000000000000', dbox, 'authenticated', 'authenticated', 'driverbox@antaraja.id',
      extensions.crypt(v_pw, extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('full_name', 'Dedi Box', 'phone', '+6281100000006'),
      now(), now(), '', '', '', '', false)
    on conflict (id) do nothing;
    insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), dbox, dbox::text, 'email',
      jsonb_build_object('sub', dbox::text, 'email', 'driverbox@antaraja.id', 'email_verified', true, 'phone_verified', false), now(), now(), now())
    on conflict do nothing;
    perform set_config('antaraja.bypass', 'on', true);
    update profiles set role = 'driver' where id = dbox;
    insert into drivers (id, vehicle_type, vehicle_brand, vehicle_model, vehicle_plate, vehicle_color, vehicle_year, fuel_type, status, is_online,
                         location, last_seen_at, rating_avg, rating_count, total_trips)
    values (dbox, 'box', 'Mitsubishi', 'Colt L300 Box', 'BM 8080 BX', 'Putih', 2021, 'diesel', 'approved', false,
            st_setsrid(st_makepoint(101.4349, 0.4810), 4326)::geography, now(), 4.80, 40, 120)
    on conflict (id) do nothing;
    perform set_config('antaraja.bypass', 'off', true);
    raise notice 'pasca/seed: driver box uji driverbox@antaraja.id (%) dibuat', dbox;
  end if;

  -- (c) Setelan pembayaran LOKAL: AntarPay (0088) + semua saluran (0089) dinyalakan,
  --     dan PIN admin uji = 123456 (admin_security). Default migrasi = semuanya mati
  --     (produksi memutuskan lewat panel admin). uji_idempotensi.sql memesan dengan
  --     paid_via='wallet' tanpa menyalakannya sendiri → "AntarPay sedang dinonaktifkan
  --     sementara"; simulasi_e2e S0 menyalakannya sendiri lalu memulihkan di S54/S55.
  insert into app_settings (key, value) values ('antarpay_enabled', 'true'::jsonb)
  on conflict (key) do update set value = 'true'::jsonb, updated_at = now();
  update app_settings
     set value = (select jsonb_object_agg(k, true) from jsonb_object_keys(value) k), updated_at = now()
   where key = 'payment_channels' and jsonb_typeof(value) = 'object';
  insert into app_settings (key, value)
  values ('pg_methods', (select coalesce(jsonb_agg(x), '[]'::jsonb) from unnest(payment_gateway_channel_keys()) x))
  on conflict (key) do update set value = excluded.value, updated_at = now();
  insert into admin_security (user_id, pin_hash, pin_set_at)
  values (adm, extensions.crypt('123456', extensions.gen_salt('bf')), now())
  on conflict (user_id) do update set pin_hash = excluded.pin_hash, failed = 0, locked_until = null;
  raise notice 'pasca/seed: AntarPay + semua saluran pembayaran dinyalakan (lokal); PIN admin uji = 123456';
end $$;
