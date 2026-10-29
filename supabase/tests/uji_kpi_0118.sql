-- =====================================================================
-- uji_kpi_0118.sql — KPI Manager Kota (migrasi 0118)
--   1. admin_set_city_manager_kpi: upsert target (bobot default 30/30/20/20, pool default dari kpi_bonus_default_pool); bobot ≠ 100 ditolak
--   2. Fixture: 2 merchant approved baru + 1 driver approved baru di Pekanbaru (entity_city), 3 order completed (2 merchant, 1 driver aktif)
--   3. admin_city_manager_kpi: actual, pct (cap 120), score, grade, bonus_earned sesuai rumus; kota tanpa target → has_target=false
--   4. Komponen bertarget 0 dilewati (bobot dinormalisasi); score < 60 → bonus 0, grade D
--   5. city_manager_kpi_mine: manager melihat kotanya sendiri; non-admin ditolak di admin_*; exec_city_manager_kpi dengan token
--   6. city_manager_kpi_summary
-- Pola (b): begin; do $$ … raise notice '[OK] …' $$; rollback;   Lokal: scripts/db-lokal.sh test supabase/tests/uji_kpi_0118.sql
-- Mengandaikan akun seed.sql: a0..01 superadmin (PIN 123456), a0..02 pelanggan.
-- =====================================================================
begin;
do $$
declare
  adm  constant uuid := 'a0000000-0000-4000-8000-000000000001';
  cust constant uuid := 'a0000000-0000-4000-8000-000000000002';
  v_month date := date_trunc('month', now())::date;
  city uuid; city2 uuid; mgr uuid; m1 uuid; m2 uuid; d1 uuid; r jsonb; r2 jsonb; n int; v_msg text; tok text;
  exp_score numeric; exp_bonus bigint;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  r := admin_unlock('123456');
  if not coalesce((r->>'ok')::boolean, false) then raise exception '[GAGAL] admin_unlock seed gagal: %', r; end if;
  select id into city from cities where name = 'Pekanbaru' and active;
  select id into city2 from cities where name = 'Padang' and active;
  if city is null or city2 is null then raise exception '[GAGAL] kota Pekanbaru/Padang tidak ada'; end if;

  -- ===== 1. target: bobot salah ditolak; upsert dengan pool default =====
  begin
    perform admin_set_city_manager_kpi(jsonb_build_object('city_id', city, 'month', v_month, 'target_merchant_new', 4, 'weight_merchant_new', 50));
    raise exception '[GAGAL] bobot 50+30+20+20 seharusnya ditolak';
  exception when others then v_msg := sqlerrm; end;
  if v_msg not like 'KPI_WEIGHTS%' then raise exception '[GAGAL] pesan bobot: %', v_msg; end if;
  r := admin_set_city_manager_kpi(jsonb_build_object('city_id', city, 'month', v_month,
         'target_merchant_new', 4, 'target_driver_new', 2, 'target_merchant_active', 2, 'target_driver_active', 2, 'target_orders', 10, 'note', 'uji 0118'));
  if not ((r->>'has_target')::boolean and (r->'targets'->>'merchant_new')::int = 4 and (r->'weights'->>'merchant_new')::int = 30
          and (r->>'bonus_pool')::bigint = greatest(0, setting_num('kpi_bonus_default_pool', 1000000))::bigint) then
    raise exception '[GAGAL] upsert target: %', r;
  end if;
  raise notice '[OK] 1. target disimpan (pool default Rp%, bobot 30/30/20/20); bobot ≠ 100 → %', r->>'bonus_pool', left(v_msg, 40);

  -- ===== 2. fixture: merchant & driver baru di Pekanbaru, order completed =====
  perform set_config('antaraja.bypass', 'on', true);
  -- pemilik merchant & driver: pengguna baru (profil dibuat trigger handle_new_user)
  m1 := gen_random_uuid(); m2 := gen_random_uuid(); d1 := gen_random_uuid(); mgr := gen_random_uuid();
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated', 'uji0118.' || left(u::text, 8) || '@antaraja.id',
         extensions.crypt('rahasia123', extensions.gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb,
         jsonb_build_object('full_name', 'Uji 0118 ' || left(u::text, 4), 'phone', '+6285' || (floor(random() * 1e9))::bigint)
    from unnest(array[m1, m2, d1, mgr]) u;
  update profiles set role = 'merchant' where id in (m1, m2);
  update profiles set role = 'driver' where id = d1;
  update profiles set role = 'admin' where id = mgr;   -- admin_role → 'viewer' otomatis (guard 0107)
  insert into merchants (id, owner_id, name, category, address, location, status)
  values (gen_random_uuid(), m1, 'Warung Uji 0118 A', 'Makanan', 'Pekanbaru', st_setsrid(st_makepoint(101.44, 0.51), 4326)::geography, 'approved'),
         (gen_random_uuid(), m2, 'Warung Uji 0118 B', 'Makanan', 'Pekanbaru', st_setsrid(st_makepoint(101.45, 0.50), 4326)::geography, 'approved');
  insert into drivers (id, vehicle_type, vehicle_plate, status, location)
  values (d1, 'motor', 'BM 0118 UJ', 'approved', st_setsrid(st_makepoint(101.448, 0.507), 4326)::geography);
  -- 3 order completed: 2 merchant berbeda, 1 driver yang sama
  insert into orders (service, customer_id, driver_id, merchant_id, status, pickup_address, pickup_location, dropoff_address, dropoff_location, completed_at, payment_method, city_id)
  select 'food', cust, d1, m.id, 'completed', 'Pekanbaru', st_setsrid(st_makepoint(101.44, 0.51), 4326)::geography, 'Pekanbaru', st_setsrid(st_makepoint(101.45, 0.50), 4326)::geography,
         now(), 'cash', city
    from merchants m where m.owner_id in (m1, m2);
  insert into orders (service, customer_id, driver_id, status, pickup_address, pickup_location, dropoff_address, dropoff_location, completed_at, payment_method, city_id)
  values ('ride_motor', cust, d1, 'completed', 'Pekanbaru', st_setsrid(st_makepoint(101.44, 0.51), 4326)::geography, 'Pekanbaru', st_setsrid(st_makepoint(101.45, 0.50), 4326)::geography, now(), 'cash', city);
  update cities set manager_id = mgr where id = city;
  perform set_config('antaraja.bypass', 'off', true);
  if entity_city(st_setsrid(st_makepoint(101.44, 0.51), 4326)::geography) <> city then raise exception '[GAGAL] entity_city Pekanbaru'; end if;
  raise notice '[OK] 2. fixture: 2 merchant + 1 driver approved baru, 3 order completed di Pekanbaru; manager ditunjuk';

  -- ===== 3. hitung: actual ≥ fixture; pct/score/grade/bonus konsisten dengan rumus =====
  select x into r from admin_city_manager_kpi(v_month, city) x;
  if r is null then raise exception '[GAGAL] Pekanbaru tidak muncul'; end if;
  if (r->'actual'->>'merchant_new')::int < 2 or (r->'actual'->>'driver_new')::int < 1 or (r->'actual'->>'merchant_active')::int < 2
     or (r->'actual'->>'driver_active')::int < 1 or (r->'actual'->>'orders')::int < 3 then
    raise exception '[GAGAL] actual kurang dari fixture: %', r->'actual';
  end if;
  -- rumus ulang dari actual yang dilaporkan
  exp_score := round((least(120, round((r->'actual'->>'merchant_new')::int * 100.0 / 4, 1)) * 30
                     + least(120, round((r->'actual'->>'driver_new')::int * 100.0 / 2, 1)) * 30
                     + round((least(120, round((r->'actual'->>'merchant_active')::int * 100.0 / 2, 1)) + least(120, round((r->'actual'->>'driver_active')::int * 100.0 / 2, 1))) / 2, 1) * 20
                     + least(120, round((r->'actual'->>'orders')::int * 100.0 / 10, 1)) * 20) / 100, 1);
  exp_bonus := case when exp_score < 60 then 0 else round((r->>'bonus_pool')::bigint * least(exp_score, 120) / 100.0)::bigint end;
  if (r->>'score')::numeric <> exp_score or (r->>'bonus_earned')::bigint <> exp_bonus
     or r->>'grade' <> (case when exp_score >= 100 then 'A' when exp_score >= 80 then 'B' when exp_score >= 60 then 'C' else 'D' end)
     or (r->'pct'->>'merchant_active')::numeric > 120 or r->>'manager_id' <> mgr::text then
    raise exception '[GAGAL] skor: dapat score=% grade=% bonus=%, harap score=% bonus=%', r->>'score', r->>'grade', r->>'bonus_earned', exp_score, exp_bonus;
  end if;
  select x into r2 from admin_city_manager_kpi(v_month, city2) x;
  if r2 is null or (r2->>'has_target')::boolean or r2->>'score' is not null or (r2->>'bonus_earned')::bigint <> 0 then raise exception '[GAGAL] Padang tanpa target: %', r2; end if;
  raise notice '[OK] 3. Pekanbaru: actual % → pct % → score % grade % bonus Rp% / pool Rp%; Padang has_target=false',
    r->'actual', r->'pct', r->>'score', r->>'grade', r->>'bonus_earned', r->>'bonus_pool';

  -- ===== 4. target 0 dilewati (hanya orders bertarget, pct 30/10=300 → cap 120 → score 120 → A, bonus pool×1.2); target besar → D, bonus 0 =====
  r := admin_set_city_manager_kpi(jsonb_build_object('city_id', city, 'month', v_month, 'target_merchant_new', 0, 'target_driver_new', 0,
         'target_merchant_active', 0, 'target_driver_active', 0, 'target_orders', 1, 'bonus_pool', 500000));
  if not ((r->>'score')::numeric = 120 and r->>'grade' = 'A' and (r->>'bonus_earned')::bigint = 600000 and r->'pct'->>'merchant_new' is null and r->'pct'->>'active' is null) then
    raise exception '[GAGAL] normalisasi bobot/cap 120: %', r;
  end if;
  r := admin_set_city_manager_kpi(jsonb_build_object('city_id', city, 'month', v_month, 'target_merchant_new', 1000, 'target_driver_new', 1000,
         'target_merchant_active', 1000, 'target_driver_active', 1000, 'target_orders', 1000));
  if not ((r->>'score')::numeric < 60 and r->>'grade' = 'D' and (r->>'bonus_earned')::bigint = 0 and (r->>'bonus_pool')::bigint = 500000) then
    raise exception '[GAGAL] grade D / bonus 0: %', r;
  end if;
  raise notice '[OK] 4. target 0 dilewati → score 120 A bonus 120%% pool; target 1000 → score % D bonus 0', r->>'score';

  -- ===== 5. hak akses: pelanggan ditolak; manager melihat kotanya; exec token =====
  perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
  begin perform admin_city_manager_kpi(v_month, null); raise exception '[GAGAL] pelanggan bisa admin_city_manager_kpi'; exception when others then v_msg := sqlerrm; end;
  if v_msg like '[GAGAL]%' then raise exception '%', v_msg; end if;
  begin perform admin_set_city_manager_kpi(jsonb_build_object('city_id', city, 'month', v_month)); raise exception '[GAGAL] pelanggan bisa set KPI'; exception when others then v_msg := sqlerrm; end;
  if v_msg like '[GAGAL]%' then raise exception '%', v_msg; end if;
  select count(*) into n from city_manager_kpi_mine(v_month);
  if n <> 0 then raise exception '[GAGAL] pelanggan bukan manager tetapi melihat % kota', n; end if;
  begin perform exec_city_manager_kpi('token-palsu', v_month); raise exception '[GAGAL] token palsu lolos'; exception when others then v_msg := sqlerrm; end;
  if v_msg like '[GAGAL]%' then raise exception '%', v_msg; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', mgr, 'role', 'authenticated')::text, true);
  select count(*), min(x->>'city_id') into n, v_msg from city_manager_kpi_mine(v_month) x;
  if n <> 1 or v_msg <> city::text then raise exception '[GAGAL] manager melihat % kota (harap 1 Pekanbaru)', n; end if;
  -- exec: superadmin dengan sesi eksekutif
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  insert into exec_access (user_id, level, pin_hash, active) select adm, 'vp', extensions.crypt('654321', extensions.gen_salt('bf')), true where not exists (select 1 from exec_access where user_id = adm);
  update exec_access set pin_hash = extensions.crypt('654321', extensions.gen_salt('bf')), active = true, failed = 0, locked_until = null where user_id = adm;
  r := exec_login('654321'); tok := r->>'token';
  select count(*) into n from exec_city_manager_kpi(tok, v_month) x where (x->>'city_id')::uuid = city;
  if n <> 1 then raise exception '[GAGAL] exec_city_manager_kpi tidak memuat Pekanbaru (%)', n; end if;
  raise notice '[OK] 5. pelanggan ditolak (admin_* & mine kosong); manager melihat 1 kota; exec token palsu ditolak, token sah OK';

  -- ===== 6. ringkasan =====
  r := city_manager_kpi_summary(v_month);
  if not ((r->>'cities_with_target')::int >= 1 and (r->>'cities_total')::int >= (r->>'cities_with_target')::int and (r->'grades'->>'D')::int >= 1
          and (r->>'total_bonus_pool')::bigint >= 500000 and (r->>'cities_with_manager')::int >= 1) then
    raise exception '[GAGAL] summary: %', r;
  end if;
  raise notice '[OK] 6. summary: kota=% bertarget=% manager=% avg=% grades=% pool=% earned=%', r->>'cities_total', r->>'cities_with_target', r->>'cities_with_manager', r->>'avg_score', r->'grades', r->>'total_bonus_pool', r->>'total_bonus_earned';
  raise notice '[OK] SELESAI_KPI_0118';
end $$;
rollback;
