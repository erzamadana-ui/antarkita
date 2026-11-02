-- =====================================================================
-- uji_dispatch_0122.sql — Dispatch penawaran bertahap & re-assign (migrasi 0122)
--   1. Setelan dispatch_*, tabel order_offers, cron antarkita_dispatch (bila cron ada)
--   2. 3 driver motor online pada jarak 300 m / 800 m / 1,5 km → dispatch_tick menawarkan ke yang TERDEKAT (ronde 1, radius 1 km);
--      feed: pemegang penawaran melihat baris offer_id/dispatch_mode='offer', driver lain tidak; driver_offer_mine()
--   3. Pemegang menolak (driver_decline_offer) → ronde 2 seketika ke driver berikut; penolak tercatat di order_rejections
--   4. Kedaluwarsa (p_now + 30 dtk) → 'expired' → ronde 3 ke driver ke-3; driver lain yang mencoba accept → OFFER_HELD
--   5. Setelah dispatch_offer_rounds (=3 dalam uji) → tidak ada penawaran baru (mode 'broadcast'): semua driver cocok melihat
--      order di feed (dispatch_mode='broadcast') dan boleh menerima langsung
--   6. Accept oleh pemegang penawaran → baris 'accepted' (+accept_dist_m); driver dengan order aktif tidak ditawari order berikutnya
--   7. Re-assign: accepted > 5 menit tanpa bergerak → kembali 'searching', driver lama dikecualikan + fraud_flag accept_no_move,
--      notifikasi pelanggan & driver, langsung ditawarkan ke driver berikutnya; driver yang MENDEKAT ≥ 300 m TIDAK dilepas
--   8. cancel_order pelanggan → penawaran aktif 'cancelled' (order_cancelled); driver_reject_order lama → penawaran 'declined'
-- Pola (b): begin; do $$ … raise notice '[OK] …' $$; rollback;   Lokal: scripts/db-lokal.sh test supabase/tests/uji_dispatch_0122.sql
-- Mengandaikan akun seed.sql: a0..01 superadmin (PIN 123456), a0..02 pelanggan.
-- =====================================================================
begin;
create or replace function pg_temp.dp_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', case when p_uid is null then '' else json_build_object('sub', p_uid, 'role', 'authenticated')::text end, true);
$$;
-- driver motor approved + online di (lat,lng), rating default (5.00/0 ulasan → setara 4.6 → prioritas sama untuk semuanya)
create or replace function pg_temp.dp_driver(p_name text, p_lat double precision, p_lng double precision) returns uuid language plpgsql as $$
declare u uuid := gen_random_uuid(); mail text := 'uji.0122.' || left(u::text, 8) || '@antaraja.id';
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values ('00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated', mail, extensions.crypt('rahasia123', extensions.gen_salt('bf')), now(), now(), now(),
          '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('full_name', p_name, 'phone', '+6284' || (floor(random() * 1e9))::bigint, 'email', mail));
  perform set_config('antaraja.bypass', 'on', true);
  update profiles set role = 'driver' where id = u;
  insert into drivers (id, vehicle_type, vehicle_brand, vehicle_plate, vehicle_color, status, is_online, location, last_seen_at, last_selfie_at)
  values (u, 'motor', 'Honda Beat', 'BM ' || (1000 + floor(random() * 8999))::int || ' UJ', 'Hitam', 'approved', true, st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography, now(), now());
  insert into wallets (user_id) values (u) on conflict do nothing;
  perform set_config('antaraja.bypass', 'off', true);
  return u;
end $$;
create or replace function pg_temp.dp_move(p_drv uuid, p_lat double precision, p_lng double precision) returns void language plpgsql as $$
begin
  perform set_config('antaraja.bypass', 'on', true);
  update drivers set location = st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography, last_seen_at = now() where id = p_drv;
  perform set_config('antaraja.bypass', 'off', true);
end $$;
create or replace function pg_temp.dp_ride() returns jsonb language sql as $$
  select jsonb_build_object('service', 'ride_motor', 'vehicle_class', 'motor_economy',
    'pickup', jsonb_build_object('lat', 0.4810, 'lng', 101.4349, 'address', 'Jl. Sudirman 45'),
    'dropoff', jsonb_build_object('lat', 0.50, 'lng', 101.44, 'address', 'Plaza Andalas'), 'paid_via', 'cash', 'client_request_id', 'dp-' || gen_random_uuid()::text);
$$;
do $$
declare
  adm  constant uuid := 'a0000000-0000-4000-8000-000000000001';
  cust constant uuid := 'a0000000-0000-4000-8000-000000000002';
  plat constant double precision := 0.4810; plng constant double precision := 101.4349;   -- titik jemput; 0.001° lintang ≈ 111 m
  d1 uuid; d2 uuid; d3 uuid; d4 uuid; o orders; o2 orders; o3 orders; t0 timestamptz := now(); r jsonb; r2 jsonb; f order_offers; msg text; n int; n2 int; n3 int;
  v_cron boolean := null;
begin
  perform pg_temp.dp_as(adm);
  r := admin_unlock('123456');
  if not coalesce((r->>'ok')::boolean, false) then raise exception '[GAGAL] admin_unlock seed gagal: %', r; end if;
  perform set_config('antaraja.bypass', 'on', true);
  update orders set status = 'cancelled' where customer_id = cust and status in ('scheduled', 'searching', 'accepted', 'arrived', 'in_progress');
  update drivers set is_online = false where is_online;   -- hanya driver uji yang online (ikut ROLLBACK)
  insert into app_settings (key, value) values ('driver_deposit_required', 'false'::jsonb), ('rate_limit_create_order_per_hour', '100000'::jsonb),
    ('antifraud_orders_per_hour_max', '1000'::jsonb), ('antifraud_new_account_hours', '0'::jsonb), ('dispatch_offer_rounds', '3'::jsonb),
    ('priority_tiers', '[{"min_rating":0,"delay_s":0}]'::jsonb), ('dispatch_enabled', 'true'::jsonb), ('dispatch_offer_on_create', 'false'::jsonb)
    on conflict (key) do update set value = excluded.value, updated_at = now();
  perform set_config('antaraja.bypass', 'off', true);
  d1 := pg_temp.dp_driver('Driver Dekat 330m', plat + 0.0030, plng);     -- ≈ 330 m
  d2 := pg_temp.dp_driver('Driver Sedang 800m', plat + 0.0072, plng);    -- ≈ 800 m
  d3 := pg_temp.dp_driver('Driver Jauh 1500m', plat + 0.0135, plng);     -- ≈ 1,5 km

  -- ===== 1. setelan & skema =====
  if to_regclass('public.order_offers') is null then raise exception '[GAGAL] tabel order_offers'; end if;
  if (dispatch_cfg()->>'offer_seconds')::int <> 25 or (dispatch_cfg()->>'rounds')::int <> 3 or (dispatch_cfg()->>'no_move_minutes')::numeric <> 5 then raise exception '[GAGAL] dispatch_cfg: %', dispatch_cfg(); end if;
  if not exists (select 1 from app_setting_specs() where key = 'dispatch_offer_seconds') then raise exception '[GAGAL] app_setting_specs dispatch_*'; end if;
  if to_regclass('cron.job') is not null then
    execute $q$select exists (select 1 from cron.job where jobname = 'antarkita_dispatch' and schedule = '10 seconds')$q$ into v_cron;
    if not v_cron then raise exception '[GAGAL] cron antarkita_dispatch tidak terjadwal 10 detik'; end if;
  end if;
  raise notice '[OK] 1. setelan: cfg=% cron=%', dispatch_cfg(), v_cron;

  -- ===== 2. ronde 1 → driver terdekat =====
  perform pg_temp.dp_as(cust);
  o := create_order(pg_temp.dp_ride());
  perform pg_temp.dp_as(null);
  r := dispatch_tick(t0);
  if (r->>'offered')::int <> 1 then raise exception '[GAGAL] tick 1: %', r; end if;
  select * into f from order_offers where order_id = o.id and status = 'offered';
  if f.driver_id <> d1 or f.round <> 1 or f.expires_at <> t0 + interval '25 seconds' then raise exception '[GAGAL] penawaran ronde 1 bukan ke driver terdekat: % ronde % exp %', f.driver_id = d1, f.round, f.expires_at; end if;
  perform pg_temp.dp_as(d1);
  select count(*) into n from driver_available_orders() av where av.id = o.id and av.offer_id = f.id and av.dispatch_mode = 'offer' and av.offer_round = 1 and av.offer_seconds_left between 1 and 25;
  r2 := driver_offer_mine();
  perform pg_temp.dp_as(d2);
  select count(*) into n2 from driver_available_orders() av where av.id = o.id;
  perform pg_temp.dp_as(d3);
  select count(*) into n3 from driver_available_orders() av where av.id = o.id;
  if n <> 1 or n2 <> 0 or n3 <> 0 then raise exception '[GAGAL] feed ronde 1: d1=% d2=% d3=% (harus 1/0/0)', n, n2, n3; end if;
  if (r2->>'offer_id')::uuid <> f.id or (r2->>'order_id')::uuid <> o.id then raise exception '[GAGAL] driver_offer_mine: %', r2; end if;
  if (select count(*) from push_outbox where user_id = d1 and source = 'order_offer') <> 0 and not exists (select 1 from push_tokens where user_id = d1) then raise exception '[GAGAL] push tanpa token'; end if;
  raise notice '[OK] 2. ronde 1 → driver terdekat (300 m) ronde=% exp=t0+25s; feed d1 offer (seconds_left=%), d2/d3 kosong; driver_offer_mine ok', f.round, r2->>'seconds_left';

  -- ===== 3. tolak → ronde 2 seketika ke driver berikut =====
  perform pg_temp.dp_as(d1);
  r := driver_decline_offer(f.id, 'terlalu jauh');
  if not (r->>'ok')::boolean or r->'next'->>'mode' <> 'offer' or (r->'next'->>'driver_id')::uuid <> d2 or (r->'next'->>'round')::int <> 2 then raise exception '[GAGAL] decline → ronde 2: %', r; end if;
  if (select status from order_offers where id = f.id) <> 'declined' then raise exception '[GAGAL] status penawaran d1 bukan declined'; end if;
  if not exists (select 1 from order_rejections where order_id = o.id and driver_id = d1) then raise exception '[GAGAL] penolak tidak masuk order_rejections'; end if;
  select * into f from order_offers where order_id = o.id and status = 'offered';
  perform pg_temp.dp_as(d2);
  select count(*) into n2 from driver_available_orders() av where av.id = o.id and av.dispatch_mode = 'offer';
  perform pg_temp.dp_as(d1);
  select count(*) into n from driver_available_orders() av where av.id = o.id;
  if n2 <> 1 or n <> 0 then raise exception '[GAGAL] feed ronde 2: d2=% d1=%', n2, n; end if;
  raise notice '[OK] 3. d1 menolak → declined + order_rejections; ronde 2 seketika ke d2 (800 m), feed d2 offer, d1 tidak melihat';

  -- ===== 4. kedaluwarsa → ronde 3; accept oleh driver lain ditolak =====
  perform pg_temp.dp_as(null);
  r := dispatch_tick(t0 + interval '30 seconds');
  if (r->>'expired')::int <> 1 or (r->>'offered')::int <> 1 then raise exception '[GAGAL] tick 2 (expire+ronde 3): %', r; end if;
  if (select status from order_offers where id = f.id) <> 'expired' then raise exception '[GAGAL] penawaran d2 belum expired'; end if;
  select * into f from order_offers where order_id = o.id and status = 'offered';
  if f.driver_id <> d3 or f.round <> 3 then raise exception '[GAGAL] ronde 3 bukan ke d3: % ronde %', f.driver_id = d3, f.round; end if;
  perform pg_temp.dp_as(d2);
  msg := ''; begin o2 := driver_accept_order(o.id); raise exception '[GAGAL] d2 bisa accept saat penawaran dipegang d3'; exception when others then msg := sqlerrm; end;
  if msg not like 'OFFER_HELD:%' then raise exception '[GAGAL] penolakan accept salah: %', msg; end if;
  raise notice '[OK] 4. d2 kedaluwarsa (p_now+30s) → expired; ronde 3 ke d3 (1,5 km, radius 3 km); accept d2 → %', left(msg, 50);

  -- ===== 5. ronde habis → siaran =====
  perform pg_temp.dp_as(null);
  r := dispatch_tick(t0 + interval '60 seconds');
  if (r->>'expired')::int <> 1 or (r->>'offered')::int <> 0 or (r->>'broadcast')::int <> 1 then raise exception '[GAGAL] tick 3 (siaran): %', r; end if;
  d4 := pg_temp.dp_driver('Driver Baru 2km', plat + 0.018, plng);   -- driver baru online setelah ronde habis
  r := dispatch_tick(t0 + interval '70 seconds');
  if (r->>'offered')::int <> 0 then raise exception '[GAGAL] masih menawarkan setelah ronde habis: %', r; end if;
  perform pg_temp.dp_as(d2);
  select count(*) into n2 from driver_available_orders() av where av.id = o.id and av.dispatch_mode = 'broadcast';
  perform pg_temp.dp_as(d3);
  select count(*) into n3 from driver_available_orders() av where av.id = o.id and av.dispatch_mode = 'broadcast';
  perform pg_temp.dp_as(d4);
  select count(*) into n from driver_available_orders() av where av.id = o.id and av.dispatch_mode = 'broadcast';
  if n2 <> 1 or n3 <> 1 or n <> 1 then raise exception '[GAGAL] feed siaran: d2=% d3=% d4=%', n2, n3, n; end if;
  perform pg_temp.dp_as(d1);
  select count(*) into n from driver_available_orders() av where av.id = o.id;
  if n <> 0 then raise exception '[GAGAL] penolak d1 melihat order di siaran'; end if;
  perform pg_temp.dp_as(d4);
  o := driver_accept_order(o.id);
  if o.status <> 'accepted' or o.driver_id <> d4 then raise exception '[GAGAL] accept siaran d4'; end if;
  select * into f from order_offers where order_id = o.id and driver_id = d4;
  if f.status <> 'accepted' or f.round <> 0 or f.accept_dist_m is null then raise exception '[GAGAL] baris accept siaran: % % %', f.status, f.round, f.accept_dist_m; end if;
  raise notice '[OK] 5. ronde habis (3) → siaran: d2/d3/d4 melihat (broadcast), d1 (penolak) tidak; d4 accept langsung → baris accepted ronde 0 jarak % m', f.accept_dist_m;
  -- selesaikan order d4 agar d4 bebas lagi (lepas lewat cancel_order driver → dikecualikan dari order ini)
  perform pg_temp.dp_as(d4); o := cancel_order(o.id, 'uji lepas');
  if (select status from order_offers where order_id = o.id and driver_id = d4) <> 'cancelled' or not exists (select 1 from order_rejections where order_id = o.id and driver_id = d4) then raise exception '[GAGAL] lepas driver tidak membatalkan baris penawaran/mengecualikan'; end if;
  perform pg_temp.dp_as(cust); perform cancel_order(o.id, 'uji selesai');

  -- ===== 6. accept oleh pemegang penawaran; driver dengan order aktif tidak ditawari =====
  perform pg_temp.dp_as(cust);
  o2 := create_order(pg_temp.dp_ride());
  perform pg_temp.dp_as(null);
  r := dispatch_tick(t0 + interval '80 seconds');
  select * into f from order_offers where order_id = o2.id and status = 'offered';
  if f.driver_id <> d1 then raise exception '[GAGAL] order 2 ronde 1 bukan ke d1 (terdekat & bebas)'; end if;
  perform pg_temp.dp_as(d1);
  o2 := driver_accept_order(o2.id);
  select * into f from order_offers where order_id = o2.id and driver_id = d1;
  if o2.driver_id <> d1 or f.status <> 'accepted' or f.round <> 1 or f.accept_dist_m not between 250 and 350 then raise exception '[GAGAL] accept pemegang: % % %', f.status, f.round, f.accept_dist_m; end if;
  if (select count(*) from order_offers where order_id = o2.id and status = 'offered') <> 0 then raise exception '[GAGAL] masih ada penawaran aktif setelah accept'; end if;
  perform pg_temp.dp_as(cust);
  o3 := create_order(pg_temp.dp_ride());
  perform pg_temp.dp_as(null);
  r := dispatch_tick(t0 + interval '90 seconds');
  select * into f from order_offers where order_id = o3.id and status = 'offered';
  if f.driver_id = d1 or f.driver_id <> d2 then raise exception '[GAGAL] order 3 ditawarkan ke % (harus d2: d1 punya order aktif)', f.driver_id; end if;
  raise notice '[OK] 6. d1 accept penawaran ronde 1 → accepted (jarak % m), tidak ada penawaran aktif tersisa; order berikutnya ke d2 karena d1 sibuk', (select accept_dist_m from order_offers where order_id = o2.id and driver_id = d1);
  -- order 3 dibatalkan pelanggan → penawaran d2 'cancelled' (order_cancelled)
  perform pg_temp.dp_as(cust); perform cancel_order(o3.id, 'uji batal');
  if (select status || ':' || reason from order_offers where id = f.id) <> 'cancelled:order_cancelled' then raise exception '[GAGAL] cancel pelanggan tidak membatalkan penawaran: %', (select status || ':' || coalesce(reason, '') from order_offers where id = f.id); end if;

  -- ===== 7. re-assign: tidak bergerak 5 menit =====
  perform pg_temp.dp_as(null);
  update orders set accepted_at = now() - interval '6 minutes' where id = o2.id;
  perform pg_temp.dp_move(d1, plat + 0.0004, plng);   -- mendekat ke 45 m (turun ≥ 300 m) → tidak dilepas
  r := dispatch_release_stale(now());
  if (r->>'released')::int <> 0 then raise exception '[GAGAL] driver yang mendekat dilepas: %', r; end if;
  perform pg_temp.dp_move(d1, plat + 0.0030, plng);   -- kembali ke 330 m (tidak ada kemajuan)
  select count(*) into n from notifications where user_id = cust and data->>'event' = 'driver_released';
  r := dispatch_tick(now());
  if (r->>'released')::int <> 1 then raise exception '[GAGAL] tidak dilepas: %', r; end if;
  select * into o2 from orders where id = o2.id;
  if o2.status <> 'searching' or o2.driver_id is not null or o2.accepted_at is not null then raise exception '[GAGAL] order tidak kembali searching: % %', o2.status, o2.driver_id; end if;
  if (select status || ':' || reason from order_offers where order_id = o2.id and driver_id = d1) <> 'cancelled:accept_no_move' then raise exception '[GAGAL] baris penawaran d1 tidak ditandai accept_no_move'; end if;
  if not exists (select 1 from order_rejections where order_id = o2.id and driver_id = d1 and reason = 'accept_no_move') then raise exception '[GAGAL] d1 tidak dikecualikan'; end if;
  if not exists (select 1 from fraud_flags where subject_id = d1 and order_id = o2.id and kind = 'accept_no_move') then raise exception '[GAGAL] fraud_flag accept_no_move'; end if;
  if (select count(*) from notifications where user_id = cust and data->>'event' = 'driver_released') <> n + 1 then raise exception '[GAGAL] notifikasi pelanggan driver diganti'; end if;
  if not exists (select 1 from notifications where user_id = d1 and data->>'kind' = 'accept_no_move') then raise exception '[GAGAL] notifikasi driver dilepas'; end if;
  if not exists (select 1 from order_events where order_id = o2.id and status = 'driver_released') then raise exception '[GAGAL] order_events driver_released'; end if;
  select * into f from order_offers where order_id = o2.id and status = 'offered';
  if f.driver_id <> d2 then raise exception '[GAGAL] setelah dilepas tidak langsung ditawarkan ke d2: %', r; end if;
  if (select status from drivers where id = d1) <> 'approved' then raise exception '[GAGAL] d1 ditangguhkan pada flag pertama (harus pada flag ke-3)'; end if;
  raise notice '[OK] 7. mendekat ≥300 m → tidak dilepas; diam 6 menit → searching, d1 dikecualikan + fraud_flag accept_no_move (status tetap approved), notifikasi pelanggan & driver, ditawarkan ke d2 (ronde %)', f.round;

  -- ===== 8. driver_reject_order lama menolak penawaran aktif =====
  perform pg_temp.dp_as(d2);
  r := driver_reject_order(o2.id, 'sibuk');
  if (select status from order_offers where id = f.id) <> 'declined' then raise exception '[GAGAL] driver_reject_order tidak menolak penawaran'; end if;
  perform pg_temp.dp_as(adm);
  r := admin_dispatch_summary();
  if (r->>'offers_24h')::int < 5 or (r->>'released_no_move_7d')::int < 1 then raise exception '[GAGAL] admin_dispatch_summary: %', r; end if;
  perform pg_temp.dp_as(cust); perform cancel_order(o2.id, 'uji selesai');
  raise notice '[OK] 8. driver_reject_order lama → penawaran declined; admin_dispatch_summary offers_24h=% released_no_move_7d=%', r->>'offers_24h', r->>'released_no_move_7d';

  raise exception 'SELESAI_DISPATCH_0122 (semua langkah lulus; transaksi dibatalkan)';
end $$;
rollback;
