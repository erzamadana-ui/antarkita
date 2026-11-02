-- =====================================================================
-- uji_city_managers_0125.sql — Manager Kota: data, template KPI per tier, apply template (migrasi 0125)
--   1. Struktur: city_managers, kpi_target_templates 18 baris (3 tier × 6 bulan), setelan gaji default 15 jt
--   2. admin_set_city_manager_profile: kandidat tanpa akun (gaji default 15 jt, tier 1); validasi (status salah, tier 4, aktif tanpa profile, HP salah)
--   3. Sinkron cities.manager_id: aktif + profile_id → terisi; nonaktif → dikosongkan; aktif lagi → terisi; akun yang sama aktif di kota lain ditolak
--   4. admin_kpi_apply_template: kota tanpa manager → KPI_TEMPLATE_NO_TIER; start_date bulan ini → bulan ke-1 tier 1; start 3 bulan lalu → bulan ke-4;
--      start 9 bulan lalu → dibatasi bulan ke-6; bulan sebelum start → KPI_TEMPLATE_BEFORE_START; target tertulis di city_manager_kpi_targets & terbaca admin_city_manager_kpi
--   5. admin_set_kpi_target_template: ubah angka → apply memakai angka baru; bobot ≠ 100 ditolak
--   6. admin_city_managers: baris lengkap (city_name, month_no, has_target_this_month); admin_city_manager_delete → cities.manager_id dilepas; non-admin ditolak
-- Pola (b): begin; do $$ … raise notice '[OK] …' $$; rollback;   Lokal: scripts/db-lokal.sh test supabase/tests/uji_city_managers_0125.sql
-- Akun seed: a0..01 superadmin (PIN 123456), a0..02 pelanggan.
-- =====================================================================
begin;
do $$
declare
  adm  constant uuid := 'a0000000-0000-4000-8000-000000000001';
  cust constant uuid := 'a0000000-0000-4000-8000-000000000002';
  v_month date := date_trunc('month', now())::date;
  city uuid; city2 uuid; mgr uuid; r jsonb; r2 jsonb; t jsonb; n int; v_msg text; cm_id uuid; cm2_id uuid;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  r := admin_unlock('123456');
  if not coalesce((r->>'ok')::boolean, false) then raise exception '[GAGAL] admin_unlock seed gagal: %', r; end if;
  select id into city from cities where name = 'Pekanbaru' and active;
  select id into city2 from cities where name = 'Dumai' and active;
  if city is null or city2 is null then raise exception '[GAGAL] kota Pekanbaru/Dumai tidak ada'; end if;
  perform set_config('antaraja.bypass', 'on', true);
  delete from city_managers where city_id in (city, city2);
  delete from city_manager_kpi_targets where city_id in (city, city2);
  update cities set manager_id = null where id in (city, city2);
  mgr := gen_random_uuid();
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values ('00000000-0000-0000-0000-000000000000', mgr, 'authenticated', 'authenticated', 'uji0125.' || left(mgr::text, 8) || '@antaraja.id',
          extensions.crypt('rahasia123', extensions.gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb,
          jsonb_build_object('full_name', 'Manajer Uji 0125', 'phone', '+6285' || (floor(random() * 1e9))::bigint));
  perform set_config('antaraja.bypass', 'off', true);

  -- ===== 1. struktur =====
  if (select count(*) from kpi_target_templates) <> 18 then raise exception '[GAGAL] template % baris', (select count(*) from kpi_target_templates); end if;
  if (select count(*) from kpi_target_templates where weight_merchant_new + weight_driver_new + weight_active + weight_orders = 100) <> 18 then raise exception '[GAGAL] bobot template'; end if;
  if (select target_orders from kpi_target_templates where tier = 1 and month_no = 6) <= (select target_orders from kpi_target_templates where tier = 1 and month_no = 1) then raise exception '[GAGAL] template harus menanjak'; end if;
  if (select target_orders from kpi_target_templates where tier = 3 and month_no = 6) >= (select target_orders from kpi_target_templates where tier = 1 and month_no = 6) then raise exception '[GAGAL] tier 3 harus lebih kecil dari tier 1'; end if;
  if setting_num('city_manager_salary_default', 0) <> 15000000 then raise exception '[GAGAL] gaji default'; end if;
  if (select column_default from information_schema.columns where table_name = 'city_managers' and column_name = 'salary_base') <> '15000000' then raise exception '[GAGAL] default salary_base'; end if;
  raise notice '[OK] 1. struktur: 18 template (tier 1 bulan 1 → 6: % → % order), gaji default Rp15.000.000', (select target_orders from kpi_target_templates where tier = 1 and month_no = 1), (select target_orders from kpi_target_templates where tier = 1 and month_no = 6);

  -- ===== 2. set profile: kandidat + validasi =====
  r := admin_set_city_manager_profile(jsonb_build_object('city_id', city, 'full_name', 'Andi Pratama', 'phone', '081234567001', 'email', 'andi@contoh.id', 'tier', 1, 'note', 'kandidat wawancara'));
  cm_id := (r->>'id')::uuid;
  if r->>'status' <> 'kandidat' or (r->>'salary_base')::bigint <> 15000000 or (r->>'tier')::int <> 1 or r->>'city_name' <> 'Pekanbaru' or r->>'profile_id' is not null then raise exception '[GAGAL] kandidat: %', r; end if;
  v_msg := ''; begin perform admin_set_city_manager_profile(jsonb_build_object('id', cm_id, 'status', 'cuti')); exception when others then v_msg := sqlerrm; end;
  if v_msg not ilike '%kandidat|aktif|nonaktif%' then raise exception '[GAGAL] status salah diterima: %', v_msg; end if;
  v_msg := ''; begin perform admin_set_city_manager_profile(jsonb_build_object('id', cm_id, 'tier', 4)); exception when others then v_msg := sqlerrm; end;
  if v_msg not ilike '%Tier harus%' then raise exception '[GAGAL] tier 4 diterima: %', v_msg; end if;
  v_msg := ''; begin perform admin_set_city_manager_profile(jsonb_build_object('id', cm_id, 'status', 'aktif')); exception when others then v_msg := sqlerrm; end;
  if v_msg not ilike '%wajib punya akun%' then raise exception '[GAGAL] aktif tanpa profile diterima: %', v_msg; end if;
  v_msg := ''; begin perform admin_set_city_manager_profile(jsonb_build_object('id', cm_id, 'phone', '12345')); exception when others then v_msg := sqlerrm; end;
  if v_msg not ilike '%HP tidak valid%' then raise exception '[GAGAL] HP salah diterima: %', v_msg; end if;
  v_msg := ''; begin perform admin_set_city_manager_profile(jsonb_build_object('city_id', city2, 'full_name', 'Xy')); exception when others then v_msg := sqlerrm; end;
  if v_msg not ilike '%minimal 3 huruf%' then raise exception '[GAGAL] nama pendek diterima: %', v_msg; end if;
  raise notice '[OK] 2. kandidat Pekanbaru tersimpan (gaji default Rp15 jt, tier 1, tanpa akun); status/tier/aktif-tanpa-akun/HP/nama salah ditolak';

  -- ===== 3. sinkron cities.manager_id =====
  r := admin_set_city_manager_profile(jsonb_build_object('id', cm_id, 'profile_id', mgr, 'status', 'aktif', 'start_date', v_month));
  if (select manager_id from cities where id = city) is distinct from mgr or not (r->>'city_manager_id_synced')::boolean then raise exception '[GAGAL] manager_id tidak sinkron: %', r; end if;
  r := admin_set_city_manager_profile(jsonb_build_object('id', cm_id, 'status', 'nonaktif'));
  if (select manager_id from cities where id = city) is not null then raise exception '[GAGAL] nonaktif tidak melepas manager_id'; end if;
  r := admin_set_city_manager_profile(jsonb_build_object('id', cm_id, 'status', 'aktif'));
  if (select manager_id from cities where id = city) is distinct from mgr then raise exception '[GAGAL] aktif lagi tidak mengisi manager_id'; end if;
  v_msg := ''; begin perform admin_set_city_manager_profile(jsonb_build_object('city_id', city2, 'full_name', 'Andi Pratama', 'profile_id', mgr, 'status', 'aktif', 'tier', 2)); exception when others then v_msg := sqlerrm; end;
  if v_msg not ilike '%kota lain%' then raise exception '[GAGAL] akun ganda aktif diterima: %', v_msg; end if;
  -- manager bisa melihat KPI kotanya (0118 city_manager_kpi_mine lewat cities.manager_id)
  perform set_config('request.jwt.claims', json_build_object('sub', mgr, 'role', 'authenticated')::text, true);
  select count(*) into n from city_manager_kpi_mine(v_month) x where (x->>'city_id')::uuid = city;
  if n <> 1 then raise exception '[GAGAL] city_manager_kpi_mine tidak melihat kotanya (%)', n; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  raise notice '[OK] 3. sinkron: aktif+akun → cities.manager_id terisi; nonaktif → kosong; aktif lagi → terisi; akun aktif di kota lain ditolak; city_manager_kpi_mine melihat Pekanbaru';

  -- ===== 4. apply template =====
  v_msg := ''; begin perform admin_kpi_apply_template(city2, v_month); exception when others then v_msg := sqlerrm; end;
  if v_msg not like 'KPI_TEMPLATE_NO_TIER%' then raise exception '[GAGAL] kota tanpa manager: %', v_msg; end if;
  r := admin_kpi_apply_template(city, v_month);
  select to_jsonb(k) into t from kpi_target_templates k where tier = 1 and month_no = 1;
  if (r->'template'->>'month_no')::int <> 1 or (r->'template'->>'tier')::int <> 1 or (r->'targets'->>'orders')::int <> (t->>'target_orders')::int
     or (r->'weights'->>'merchant_new')::int <> (t->>'weight_merchant_new')::int or (r->>'bonus_pool')::bigint <> (t->>'bonus_pool')::bigint then raise exception '[GAGAL] apply bulan 1: % vs %', r, t; end if;
  if not exists (select 1 from city_manager_kpi_targets where city_id = city and month = v_month and target_orders = (t->>'target_orders')::int) then raise exception '[GAGAL] target tidak tertulis'; end if;
  select count(*) into n from admin_city_manager_kpi(v_month, city) x where (x->>'has_target')::boolean and (x->'targets'->>'orders')::int = (t->>'target_orders')::int;
  if n <> 1 then raise exception '[GAGAL] admin_city_manager_kpi tidak membaca target'; end if;
  -- start 3 bulan lalu → bulan ke-4 untuk bulan ini
  perform admin_set_city_manager_profile(jsonb_build_object('id', cm_id, 'start_date', (v_month - interval '3 months')::date));
  r := admin_kpi_apply_template(city, v_month);
  if (r->'template'->>'month_no')::int <> 4 or (r->'targets'->>'orders')::int <> (select target_orders from kpi_target_templates where tier = 1 and month_no = 4) then raise exception '[GAGAL] apply bulan 4: %', r->'template'; end if;
  -- start 9 bulan lalu → dibatasi bulan ke-6
  perform admin_set_city_manager_profile(jsonb_build_object('id', cm_id, 'start_date', (v_month - interval '9 months')::date));
  r := admin_kpi_apply_template(city, v_month);
  if (r->'template'->>'month_no')::int <> 6 then raise exception '[GAGAL] apply > 6 bulan: %', r->'template'; end if;
  -- bulan sebelum start → ditolak
  v_msg := ''; begin perform admin_kpi_apply_template(city, (v_month - interval '12 months')::date); exception when others then v_msg := sqlerrm; end;
  if v_msg not like 'KPI_TEMPLATE_BEFORE_START%' then raise exception '[GAGAL] bulan sebelum start diterima: %', v_msg; end if;
  -- tier 2 (Dumai) kandidat tanpa start_date → bulan ke-1 tier 2
  r2 := admin_set_city_manager_profile(jsonb_build_object('city_id', city2, 'full_name', 'Sari Dewi', 'tier', 2));
  cm2_id := (r2->>'id')::uuid;
  r := admin_kpi_apply_template(city2, v_month);
  if (r->'template'->>'tier')::int <> 2 or (r->'template'->>'month_no')::int <> 1 or (r->'targets'->>'orders')::int <> (select target_orders from kpi_target_templates where tier = 2 and month_no = 1) then raise exception '[GAGAL] apply tier 2: %', r->'template'; end if;
  raise notice '[OK] 4. apply template: tanpa manager → KPI_TEMPLATE_NO_TIER; start bulan ini → tier 1 bulan 1 (order %); start −3 bln → bulan 4; −9 bln → dibatasi 6; sebelum start ditolak; Dumai tier 2 bulan 1', t->>'target_orders';

  -- ===== 5. ubah template =====
  v_msg := ''; begin perform admin_set_kpi_target_template(jsonb_build_object('tier', 2, 'month_no', 1, 'weight_orders', 90)); exception when others then v_msg := sqlerrm; end;
  if v_msg not like 'KPI_WEIGHTS%' then raise exception '[GAGAL] bobot template salah diterima: %', v_msg; end if;
  t := admin_set_kpi_target_template(jsonb_build_object('tier', 2, 'month_no', 1, 'target_orders', 777, 'bonus_pool', 1234000, 'note', 'uji 0125'));
  if (t->>'target_orders')::int <> 777 or (t->>'bonus_pool')::bigint <> 1234000 then raise exception '[GAGAL] set template: %', t; end if;
  r := admin_kpi_apply_template(city2, v_month);
  if (r->'targets'->>'orders')::int <> 777 or (r->>'bonus_pool')::bigint <> 1234000 then raise exception '[GAGAL] apply tidak memakai template baru: %', r; end if;
  select count(*) into n from admin_kpi_target_templates();
  if n <> 18 then raise exception '[GAGAL] admin_kpi_target_templates %', n; end if;
  raise notice '[OK] 5. template tier 2 bulan 1 diubah (order 777, pool 1.234.000) → apply memakai angka baru; bobot ≠ 100 ditolak';

  -- ===== 6. daftar, hapus, hak =====
  select x into r from admin_city_managers() x where (x->>'id')::uuid = cm_id;
  if r->>'city_name' <> 'Pekanbaru' or r->>'profile_name' <> 'Manajer Uji 0125' or (r->>'month_no')::int <> 10 or not (r->>'has_target_this_month')::boolean then raise exception '[GAGAL] admin_city_managers: %', r; end if;
  if (select (x->>'status') from admin_city_managers() x limit 1) <> 'aktif' then raise exception '[GAGAL] urutan: aktif dulu'; end if;
  r := admin_city_manager_delete(cm_id);
  if not (r->>'ok')::boolean or exists (select 1 from city_managers where id = cm_id) or (select manager_id from cities where id = city) is not null then raise exception '[GAGAL] delete / manager_id tidak dilepas'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
  v_msg := ''; begin perform admin_city_managers(); exception when others then v_msg := sqlerrm; end;
  if v_msg = '' then raise exception '[GAGAL] pelanggan bisa admin_city_managers'; end if;
  v_msg := ''; begin perform admin_set_city_manager_profile(jsonb_build_object('city_id', city2, 'full_name', 'Hacker')); exception when others then v_msg := sqlerrm; end;
  if v_msg = '' then raise exception '[GAGAL] pelanggan bisa set manager'; end if;
  v_msg := ''; begin perform admin_kpi_apply_template(city2, v_month); exception when others then v_msg := sqlerrm; end;
  if v_msg = '' then raise exception '[GAGAL] pelanggan bisa apply template'; end if;
  raise notice '[OK] 6. admin_city_managers lengkap (month_no 10, target bulan ini ada); delete → cities.manager_id dilepas; non-admin ditolak';
  raise notice '[OK] SELESAI_CITY_MANAGERS_0125';
end $$;
rollback;
