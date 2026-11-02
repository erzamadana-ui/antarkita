-- =====================================================================
-- uji_antifraud_0121.sql — Anti order fiktif (migrasi 0121)
--   1. Setelan antifraud_* + app_setting_specs + tabel customer_strikes + kolom profil
--   2. Akun baru (< 24 jam) tunai > Rp100.000 → NEW_ACCOUNT_CASH_CAP; order yang sama via saldo → diterima
--   3. Telepon kosong → PHONE_REQUIRED; antifraud_phone_required=false → lolos
--   4. > 3 pesanan/jam → ORDER_RATE (pesanan ke-4 ditolak, pesanan batal tetap dihitung)
--   5. No-show: belum N menit → NOSHOW_WAIT; laporan ke-1 → strike 1; ke-2 → cash_blocked (tunai ditolak, saldo boleh);
--      ke-3 → akun ditangguhkan (create_order 'Akun nonaktif'); refund saldo & fee no-show ke driver; fraud_flags
--   6. Admin: admin_antifraud_summary(), admin_customer_strikes('suspended'), admin_customer_strike_clear → aktif kembali & tunai boleh;
--      non-admin ditolak
--   7. my_antifraud_status()
-- Pola (b): begin; do $$ … raise notice '[OK] …' $$; rollback;   Lokal: scripts/db-lokal.sh test supabase/tests/uji_antifraud_0121.sql
-- Mengandaikan akun seed.sql: a0..01 superadmin (PIN 123456), a0..03 driver motor approved.
-- =====================================================================
begin;
create or replace function pg_temp.af_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', case when p_uid is null then '' else json_build_object('sub', p_uid, 'role', 'authenticated')::text end, true);
$$;
create or replace function pg_temp.af_customer(p_phone text) returns uuid language plpgsql as $$
declare u uuid := gen_random_uuid(); mail text := 'uji.0121.' || left(u::text, 8) || '@antaraja.id';
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values ('00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated', mail, extensions.crypt('rahasia123', extensions.gen_salt('bf')), now(), now(), now(),
          '{"provider":"email","providers":["email"]}'::jsonb, jsonb_strip_nulls(jsonb_build_object('full_name', 'Pelanggan 0121', 'phone', p_phone, 'email', mail)));
  perform set_config('antaraja.bypass', 'on', true);
  update profiles set phone = p_phone where id = u;
  perform set_config('antaraja.bypass', 'off', true);
  return u;
end $$;
create or replace function pg_temp.af_ride(p_pay text) returns jsonb language sql as $$
  select jsonb_build_object('service', 'ride_motor', 'vehicle_class', 'motor_economy',
    'pickup', jsonb_build_object('lat', 0.4810, 'lng', 101.4349, 'address', 'Jl. Sudirman 45'),
    'dropoff', jsonb_build_object('lat', 0.50, 'lng', 101.44, 'address', 'Plaza Andalas'), 'paid_via', p_pay, 'client_request_id', 'af-' || gen_random_uuid()::text);
$$;
do $$
declare
  adm  constant uuid := 'a0000000-0000-4000-8000-000000000001';
  drv  constant uuid := 'a0000000-0000-4000-8000-000000000003';
  cnew uuid; cnophone uuid; cust uuid; o orders; o2 orders; r jsonb; msg text; n int; i int; b0 bigint; b1 bigint; d0 bigint; d1 bigint; p profiles;
begin
  perform pg_temp.af_as(adm);
  r := admin_unlock('123456');
  if not coalesce((r->>'ok')::boolean, false) then raise exception '[GAGAL] admin_unlock seed gagal: %', r; end if;
  perform admin_set_antarpay_enabled(true);
  perform set_config('antaraja.bypass', 'on', true);
  update orders set status = 'cancelled' where driver_id = drv and status in ('scheduled', 'searching', 'accepted', 'arrived', 'in_progress');
  update drivers set status = 'approved', status_reason = null, is_online = false where id = drv;
  delete from fraud_flags where subject_id = drv and status = 'open';
  insert into app_settings (key, value) values ('driver_deposit_required', 'false'::jsonb), ('rate_limit_create_order_per_hour', '100000'::jsonb), ('antifraud_noshow_fee', '5000'::jsonb)
    on conflict (key) do update set value = excluded.value, updated_at = now();
  perform set_config('antaraja.bypass', 'off', true);

  -- ===== 1. setelan & skema =====
  if (select count(*) from app_settings where key like 'antifraud_%') < 10 then raise exception '[GAGAL] setelan antifraud_* kurang'; end if;
  if (antifraud_limits()->>'orders_per_hour_max')::int <> 3 or (antifraud_limits()->>'new_account_cash_max')::bigint <> 100000 or (antifraud_limits()->>'strike_cash_block')::int <> 2 or (antifraud_limits()->>'strike_suspend')::int <> 3 then
    raise exception '[GAGAL] antifraud_limits: %', antifraud_limits(); end if;
  if not exists (select 1 from app_setting_specs() where key = 'antifraud_noshow_strike_suspend') then raise exception '[GAGAL] app_setting_specs'; end if;
  if to_regclass('public.customer_strikes') is null then raise exception '[GAGAL] tabel customer_strikes'; end if;
  if not exists (select 1 from information_schema.columns where table_name = 'profiles' and column_name = 'cash_blocked_until') then raise exception '[GAGAL] kolom profiles.cash_blocked_until'; end if;
  raise notice '[OK] 1. setelan & skema: limits=%', antifraud_limits();

  -- ===== 2. akun baru: tunai > 100rb ditolak, saldo boleh =====
  cnew := pg_temp.af_customer('+6283100000121');
  perform pg_temp.af_as(cnew);
  msg := '';
  begin
    o := create_order(jsonb_build_object('service', 'box', 'helpers', 2, 'purpose', 'pindahan', 'pickup', jsonb_build_object('lat', -0.9405, 'lng', 100.3625, 'address', 'Kos lama'),
      'dropoff', jsonb_build_object('lat', -0.93, 'lng', 100.38, 'address', 'Kos baru'), 'paid_via', 'cash'));
    raise exception '[GAGAL] akun baru tunai Rp% diterima (%)', o.total, o.code;
  exception when others then msg := sqlerrm; end;
  if msg not like 'NEW_ACCOUNT_CASH_CAP:%' then raise exception '[GAGAL] penolakan akun baru salah: %', msg; end if;
  perform set_config('antaraja.bypass', 'on', true); perform wallet_apply(cnew, 'topup', 2000000, null, 'saldo uji 0121'); perform set_config('antaraja.bypass', 'off', true);
  o := create_order(jsonb_build_object('service', 'box', 'helpers', 2, 'purpose', 'pindahan', 'pickup', jsonb_build_object('lat', -0.9405, 'lng', 100.3625, 'address', 'Kos lama'),
      'dropoff', jsonb_build_object('lat', -0.93, 'lng', 100.38, 'address', 'Kos baru'), 'paid_via', 'wallet'));
  if o.total <= 100000 or o.payment_status <> 'paid' then raise exception '[GAGAL] order saldo akun baru: total=% status=%', o.total, o.payment_status; end if;
  perform cancel_order(o.id, 'uji');
  r := my_antifraud_status();
  if not (r->>'is_new_account')::boolean or (r->>'cash_max_now')::bigint <> 100000 then raise exception '[GAGAL] my_antifraud_status akun baru: %', r; end if;
  raise notice '[OK] 2. akun baru: tunai Rp>100.000 ditolak (%), saldo Rp% diterima; my_antifraud_status.is_new_account=true cash_max_now=100000', left(msg, 60), o.total;

  -- ===== 3. telepon wajib =====
  cnophone := pg_temp.af_customer(null);
  perform pg_temp.af_as(cnophone);
  msg := ''; begin o := create_order(pg_temp.af_ride('cash')); raise exception '[GAGAL] tanpa telepon diterima'; exception when others then msg := sqlerrm; end;
  if msg not like 'PHONE_REQUIRED:%' then raise exception '[GAGAL] penolakan telepon salah: %', msg; end if;
  perform pg_temp.af_as(adm); perform admin_set_settings('{"antifraud_phone_required": false}'::jsonb);
  perform pg_temp.af_as(cnophone);
  o := create_order(pg_temp.af_ride('cash'));
  perform cancel_order(o.id, 'uji');
  perform pg_temp.af_as(adm); perform admin_set_settings('{"antifraud_phone_required": true}'::jsonb);
  raise notice '[OK] 3. telepon kosong → PHONE_REQUIRED; setelan dimatikan → lolos (%)', o.code;

  -- ===== 4. > 3 pesanan/jam =====
  cust := pg_temp.af_customer('+6283100000122');
  perform set_config('antaraja.bypass', 'on', true);
  update profiles set created_at = now() - interval '3 days' where id = cust;   -- akun lama: bebas batas tunai akun baru
  perform wallet_apply(cust, 'topup', 3000000, null, 'saldo uji 0121');
  perform set_config('antaraja.bypass', 'off', true);
  perform pg_temp.af_as(cust);
  for i in 1..3 loop o := create_order(pg_temp.af_ride('cash')); perform cancel_order(o.id, 'uji laju'); end loop;
  msg := ''; begin o := create_order(pg_temp.af_ride('cash')); raise exception '[GAGAL] pesanan ke-4 dalam 1 jam diterima'; exception when others then msg := sqlerrm; end;
  if msg not like 'ORDER_RATE:%' then raise exception '[GAGAL] penolakan laju salah: %', msg; end if;
  r := my_antifraud_status();
  if (r->>'orders_last_hour')::int <> 3 then raise exception '[GAGAL] orders_last_hour=%', r->>'orders_last_hour'; end if;
  raise notice '[OK] 4. 3 pesanan/jam diterima (termasuk yang dibatalkan), ke-4 → % ; orders_last_hour=%', left(msg, 40), r->>'orders_last_hour';

  -- ===== 5. no-show bertingkat =====
  perform pg_temp.af_as(adm); perform admin_set_settings('{"antifraud_orders_per_hour_max": 100}'::jsonb);
  perform pg_temp.af_as(drv);
  perform driver_selfie_check('https://x/selfie.jpg'); perform driver_set_online(true, 0.4810, 101.4349);
  for i in 1..3 loop
    perform pg_temp.af_as(cust);
    -- #1 saldo (uji refund − fee), #2 tunai (strike 1 belum memblokir tunai), #3 saldo (setelah strike 2 tunai sudah diblokir)
    o := create_order(pg_temp.af_ride(case when i = 2 then 'cash' else 'wallet' end));
    select balance into b0 from wallets where user_id = cust;
    perform pg_temp.af_as(drv);
    select balance into d0 from wallets where user_id = drv;
    o := driver_accept_order(o.id);
    o := driver_update_order_status(o.id, 'arrived', null);
    if i = 1 then
      msg := ''; begin r := driver_report_no_show(o.id, 'https://x/bukti.jpg', 'ditunggu tidak muncul'); raise exception '[GAGAL] laporan no-show diterima sebelum menunggu'; exception when others then msg := sqlerrm; end;
      if msg not like 'NOSHOW_WAIT:%' then raise exception '[GAGAL] penolakan NOSHOW_WAIT salah: %', msg; end if;
    end if;
    update orders set arrived_at = now() - interval '6 minutes' where id = o.id;
    r := driver_report_no_show(o.id, 'https://x/bukti' || i || '.jpg', 'ditunggu 6 menit tidak muncul');
    select balance into b1 from wallets where user_id = cust;
    select balance into d1 from wallets where user_id = drv;
    select * into o2 from orders where id = o.id;
    if o2.status <> 'cancelled' or o2.cancel_reason <> 'no_show' then raise exception '[GAGAL] order % tidak dibatalkan no_show: % %', i, o2.status, o2.cancel_reason; end if;
    if (r->>'strikes')::int <> i then raise exception '[GAGAL] strike ke-% = %', i, r; end if;
    if i = 1 then
      -- dibayar saldo: refund = total − fee 5.000; fee ke driver
      if (r->>'action') <> 'strike' then raise exception '[GAGAL] aksi strike 1: %', r; end if;
      if b1 - b0 <> o2.total - 5000 then raise exception '[GAGAL] refund saldo no-show: Δcust=% total=% (harus total−5000)', b1 - b0, o2.total; end if;
      if d1 - d0 <> 5000 then raise exception '[GAGAL] fee no-show ke driver Δ=%', d1 - d0; end if;
      raise notice '[OK] 5a. no-show #1 (saldo): NOSHOW_WAIT sebelum 5 menit; setelah 6 menit → order cancelled/no_show, refund Rp% (−fee 5.000), driver +5.000, strike=1 aksi=%', b1 - b0, r->>'action';
    elsif i = 2 then
      if (r->>'action') <> 'cash_blocked' then raise exception '[GAGAL] aksi strike 2: %', r; end if;
      select * into p from profiles where id = cust;
      if p.cash_blocked_until is null or p.cash_blocked_until < now() + interval '29 days' or p.strike_count <> 2 or not p.is_active then raise exception '[GAGAL] profil setelah strike 2: % % %', p.cash_blocked_until, p.strike_count, p.is_active; end if;
      -- tunai (fee 5.000 dipotong dari saldo karena saldo cukup)
      if b0 - b1 <> 5000 or d1 - d0 <> 5000 then raise exception '[GAGAL] fee no-show tunai: Δcust=% Δdrv=%', b0 - b1, d1 - d0; end if;
      perform pg_temp.af_as(cust);
      msg := ''; begin o2 := create_order(pg_temp.af_ride('cash')); raise exception '[GAGAL] tunai diterima saat cash_blocked'; exception when others then msg := sqlerrm; end;
      if msg not like 'CASH_BLOCKED:%' then raise exception '[GAGAL] penolakan CASH_BLOCKED salah: %', msg; end if;
      o2 := create_order(pg_temp.af_ride('wallet'));
      if o2.payment_status <> 'paid' then raise exception '[GAGAL] order saldo saat cash_blocked'; end if;
      perform cancel_order(o2.id, 'uji');
      if not exists (select 1 from notifications where user_id = cust and data->>'kind' = 'antifraud_cash_blocked') then raise exception '[GAGAL] notifikasi cash_blocked'; end if;
      raise notice '[OK] 5b. no-show #2 (tunai): strike=2 → cash_blocked_until=% ; tunai → % ; saldo → diterima (%); fee Rp5.000 dari saldo pelanggan ke driver', to_char(p.cash_blocked_until at time zone 'Asia/Jakarta', 'DD Mon YYYY'), left(msg, 40), o2.code;
    else
      if (r->>'action') <> 'suspended' then raise exception '[GAGAL] aksi strike 3: %', r; end if;
      select * into p from profiles where id = cust;
      if p.is_active or p.strike_count <> 3 then raise exception '[GAGAL] profil setelah strike 3: is_active=% strikes=%', p.is_active, p.strike_count; end if;
      if not exists (select 1 from fraud_flags where subject_id = cust and kind = 'customer_auto_suspend') then raise exception '[GAGAL] fraud_flag customer_auto_suspend'; end if;
      if (select count(*) from fraud_flags where subject_id = cust and kind = 'customer_no_show') <> 3 then raise exception '[GAGAL] fraud_flags customer_no_show ≠ 3'; end if;
      if (select count(*) from customer_strikes where customer_id = cust and cleared_at is null) <> 3 then raise exception '[GAGAL] customer_strikes ≠ 3'; end if;
      perform pg_temp.af_as(cust);
      msg := ''; begin o2 := create_order(pg_temp.af_ride('wallet')); raise exception '[GAGAL] akun ditangguhkan masih bisa memesan'; exception when others then msg := sqlerrm; end;
      if msg not like '%nonaktif%' then raise exception '[GAGAL] pesan akun nonaktif: %', msg; end if;
      raise notice '[OK] 5c. no-show #3: strike=3 → is_active=false, fraud_flag customer_auto_suspend, create_order → "%"', msg;
    end if;
  end loop;

  -- ===== 6. admin =====
  perform pg_temp.af_as(adm);
  r := admin_antifraud_summary();
  if (r->>'customers_suspended')::int < 1 or (r->>'strikes_open')::int < 3 then raise exception '[GAGAL] admin_antifraud_summary: %', r; end if;
  select count(*) into n from admin_customer_strikes('suspended') s where (s->>'customer_id')::uuid = cust and (s->>'status') = 'suspended' and jsonb_array_length(s->'strikes') = 3;
  if n <> 1 then raise exception '[GAGAL] admin_customer_strikes(suspended) tidak memuat pelanggan uji'; end if;
  select count(*) into n from admin_customer_strikes('cash_blocked') s where (s->>'customer_id')::uuid = cust;
  if n <> 0 then raise exception '[GAGAL] admin_customer_strikes(cash_blocked) memuat pelanggan suspended (status harus suspended, bukan cash_blocked)'; end if;
  perform pg_temp.af_as(drv);
  msg := ''; begin r := admin_antifraud_summary(); exception when others then msg := sqlerrm; end;
  if msg = '' then raise exception '[GAGAL] non-admin bisa membaca ringkasan antifraud'; end if;
  perform pg_temp.af_as(adm);
  r := admin_customer_strike_clear(cust, 'uji: dibersihkan');
  select * into p from profiles where id = cust;
  if (r->>'cleared')::int <> 3 or not (r->>'reactivated')::boolean or not p.is_active or p.strike_count <> 0 or p.cash_blocked_until is not null then raise exception '[GAGAL] strike_clear: % / profil %', r, to_jsonb(p); end if;
  if exists (select 1 from fraud_flags where subject_id = cust and status = 'open' and kind like 'customer_%') then raise exception '[GAGAL] fraud_flags pelanggan belum ditutup'; end if;
  perform pg_temp.af_as(cust);
  o2 := create_order(pg_temp.af_ride('cash'));
  perform cancel_order(o2.id, 'uji');
  raise notice '[OK] 6. admin: summary ok; daftar suspended memuat pelanggan; non-admin ditolak; clear % strike → aktif kembali, tunai boleh (%)', r->>'cleared', o2.code;

  -- ===== 7. my_antifraud_status =====
  r := my_antifraud_status();
  if (r->>'strike_count')::int <> 0 or (r->>'cash_blocked')::boolean or not (r->>'phone_verified')::boolean or (r->'limits'->>'orders_per_hour_max') is null then raise exception '[GAGAL] my_antifraud_status: %', r; end if;
  raise notice '[OK] 7. my_antifraud_status: strike_count=0 cash_blocked=false phone_verified=true limits=%', r->'limits';

  raise exception 'SELESAI_ANTIFRAUD_0121 (semua langkah lulus; transaksi dibatalkan)';
end $$;
rollback;
