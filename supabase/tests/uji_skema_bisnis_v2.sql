-- Uji Skema Bisnis v2 (migrasi 0098 + 0099): aturan per layanan, buku besar order, alokasi dompet.
-- Spesifikasi: docs/SKEMA-BISNIS-V2-SPEK.md §10.1. Dijalankan dalam SATU transaksi lalu di-ROLLBACK
-- (blok DO sengaja diakhiri RAISE 'SIMULASI_SELESAI' + log). Cara pakai lokal:
--   scripts/db-lokal.sh test supabase/tests/uji_skema_bisnis_v2.sql
-- Mengandaikan akun uji seed.sql (a0..01 admin, ..02 pelanggan, ..03 driver motor, ..04 driver mobil/mitra travel,
-- ..05 pemilik merchant, ..06 driver box — fixture scripts/db-lokal/pasca/seed.sql), PIN admin 123456,
-- AntarPay + semua saluran dinyalakan (S0 menyalakannya sendiri bila belum).
--
-- Kode baris: S<nomor><huruf> OK|BUG — dihitung db-lokal.sh. Tiap layanan × (tunai, saldo) × (tanpa promo,
-- promo platform, promo merchant bila ada merchant) → selesai → ledger_check seimbang, delta dompet = payable,
-- ride_motor komisi ≤ 8 %, batal → refund + fase ledger, ledger_simulate = baris order nyata, pg_fee saluran gateway.

-- Pembantu sementara (pg_temp: hilang saat sesi berakhir; tidak menulis apa pun yang bertahan).
-- Menjalankan satu order dari awal sampai selesai, berganti peran lewat request.jwt.claims (transaction-local).
create or replace function pg_temp.v2_jalankan(p_service text, p_pay text, p_promo text, p_opsi jsonb default '{}'::jsonb)
returns orders language plpgsql as $$
declare
  cust uuid := 'a0000000-0000-4000-8000-000000000002'; drv uuid := 'a0000000-0000-4000-8000-000000000003';
  drv2 uuid := 'a0000000-0000-4000-8000-000000000004'; mown uuid := 'a0000000-0000-4000-8000-000000000005';
  dbox uuid := (select id from drivers where vehicle_type in ('box','pickup') order by (status = 'approved') desc, created_at limit 1);
  merch uuid := 'b0000000-0000-4000-8000-000000000001';
  o orders; v_pin text; v_drv uuid; p jsonb; menu1 uuid; store1 uuid; prod1 uuid; mk uuid; item1 uuid;
  v_lat double precision; v_lng double precision;
begin
  select id into menu1 from menu_items where merchant_id = merch and is_available limit 1;
  select id into store1 from shop_stores where active and name ilike 'Indomaret%' limit 1;
  select id into prod1 from shop_products where store_id = store1 and in_stock limit 1;
  select id into mk from markets where active order by name limit 1;
  select id into item1 from market_items where name ilike 'Beras medium' limit 1;

  v_drv := case p_service when 'ride_car' then drv2 when 'box' then dbox else drv end;
  v_lat := case p_service when 'food' then -0.9405 else 0.4810 end; v_lng := case p_service when 'food' then 100.3625 else 101.4349 end;
  perform set_config('request.jwt.claims', json_build_object('sub', v_drv, 'role', 'authenticated')::text, true);
  perform driver_selfie_check('https://x/selfie.jpg'); perform driver_set_online(true, v_lat, v_lng);

  perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
  p := case p_service
    when 'ride_motor' then jsonb_build_object('service','ride_motor','vehicle_class','motor_economy','pickup', jsonb_build_object('lat',0.4810,'lng',101.4349,'address','V2 Jemput'),'dropoff', jsonb_build_object('lat',0.50,'lng',101.44,'address','V2 Tujuan'))
    when 'ride_car'   then jsonb_build_object('service','ride_car','vehicle_class','car_economy','pickup', jsonb_build_object('lat',0.4810,'lng',101.4349,'address','V2 Jemput'),'dropoff', jsonb_build_object('lat',0.52,'lng',101.45,'address','V2 Bandara'))
    when 'food'       then jsonb_build_object('service','food','merchant_id', merch,'items', jsonb_build_array(jsonb_build_object('menu_item_id', menu1, 'qty', 2)),'dropoff', jsonb_build_object('lat',-0.945,'lng',100.36,'address','V2 Kos'))
    when 'send'       then jsonb_build_object('service','send','weight_kg',3,'size_cm',30,'pickup', jsonb_build_object('lat',0.4810,'lng',101.4349,'address','V2 Toko'),'dropoff', jsonb_build_object('lat',0.50,'lng',101.44,'address','V2 Rumah'),'recipient_name','Sari','recipient_phone','0811')
    when 'shop'       then jsonb_build_object('service','shop','shop_store_id', store1,'shop_vehicle','motor','shopping_list', jsonb_build_array(jsonb_build_object('product_id', prod1, 'qty', 2)),'dropoff', jsonb_build_object('lat',0.52,'lng',101.45,'address','V2 Rumah'))
    when 'market'     then jsonb_build_object('service','market','market_id', mk,'shop_vehicle','motor','shopping_list', jsonb_build_array(jsonb_build_object('item_id', item1, 'qty', 2)),'dropoff', jsonb_build_object('lat',0.52,'lng',101.45,'address','V2 Rumah'))
    when 'box'        then jsonb_build_object('service','box','helpers',1,'purpose','pindahan','pickup', jsonb_build_object('lat',0.4950,'lng',101.4320,'address','V2 Kos lama'),'dropoff', jsonb_build_object('lat',0.5100,'lng',101.4450,'address','V2 Kos baru'))
    end;
  p := p || jsonb_build_object('paid_via', p_pay, 'client_request_id', 'v2-' || p_service || '-' || p_pay || '-' || coalesce(p_promo, 'x') || '-' || md5(random()::text));
  if p_promo is not null then p := p || jsonb_build_object('promo_code', p_promo); end if;
  o := create_order(p);
  if coalesce((p_opsi->>'hanya_buat')::boolean, false) then return o; end if;

  if p_service = 'food' then
    perform set_config('request.jwt.claims', json_build_object('sub', mown, 'role', 'authenticated')::text, true);
    o := merchant_update_order(o.id, 'accepted'); o := merchant_update_order(o.id, 'ready');
  end if;
  select pin into v_pin from order_pins where order_id = o.id;
  perform set_config('request.jwt.claims', json_build_object('sub', v_drv, 'role', 'authenticated')::text, true);
  o := driver_accept_order(o.id); o := driver_update_order_status(o.id, 'arrived', null);
  if p_service = 'shop' then o := set_shopping_actual(o.id, 149000, 'https://x/nota.jpg', null); end if;
  if p_service = 'market' then o := set_shopping_actual(o.id, 29000, 'https://x/nota.jpg', jsonb_build_array(jsonb_build_object('item_id', item1, 'price', 14500, 'qty', 2))); end if;
  if coalesce((p_opsi->>'extra')::bigint, 0) > 0 then
    o := request_extra(o.id, 'parking', (p_opsi->>'extra')::bigint, 'Parkir');
    perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
    o := respond_extra(o.id, (o.extras->-1->>'id')::uuid, true);
    perform set_config('request.jwt.claims', json_build_object('sub', v_drv, 'role', 'authenticated')::text, true);
  end if;
  if coalesce((p_opsi->>'tip')::bigint, 0) > 0 then
    perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
    o := add_tip(o.id, (p_opsi->>'tip')::bigint);
    perform set_config('request.jwt.claims', json_build_object('sub', v_drv, 'role', 'authenticated')::text, true);
  end if;
  o := driver_update_order_status(o.id, 'in_progress', v_pin);
  o := driver_update_order_status(o.id, 'completed', null);
  return o;
end $$;

-- saldo dompet (0 bila belum ada dompet)
create or replace function pg_temp.v2_saldo(p_user uuid) returns bigint language sql as $$
  select coalesce((select balance from wallets where user_id = p_user), 0);
$$;

-- jumlah satu jenis baris ledger (nilai mutlak) pada fase tertentu
create or replace function pg_temp.v2_led(p_order uuid, p_entry text, p_phase text default 'completed') returns bigint language sql as $$
  select coalesce(abs(sum(amount)), 0) from order_ledger where order_id = p_order and source = 'orders' and phase = p_phase and entry::text = p_entry;
$$;

do $sim$
declare
  cust uuid := 'a0000000-0000-4000-8000-000000000002'; drv uuid := 'a0000000-0000-4000-8000-000000000003'; drv2 uuid := 'a0000000-0000-4000-8000-000000000004';
  mown uuid := 'a0000000-0000-4000-8000-000000000005'; adm uuid := 'a0000000-0000-4000-8000-000000000001';
  dbox uuid; merch uuid := 'b0000000-0000-4000-8000-000000000001'; route1 uuid;
  o orders; o2 orders; r jsonb; lc jsonb; sim jsonb; bd jsonb; tp topup_requests; tt travel_trips; tb travel_bookings; tr travel_requests; tofr travel_offers;
  log text := E'\n'; n int; n2 int; k text; svc text; pay text; promo text;
  c0 bigint; c1 bigint; d0 bigint; d1 bigint; m0 bigint; m1 bigint; p0 bigint; p1 bigint; v_drv uuid; v_dc numeric; v_pf bigint; fee_q bigint; ppn_q bigint;
  se service_economics; se0 service_economics; ok boolean; alasan text; b0 bigint; b1 bigint;
begin
  select id into dbox from drivers where vehicle_type in ('box','pickup') order by (status = 'approved') desc, created_at limit 1;
  select id into route1 from travel_routes where active and from_city = (select id from cities where name = 'Pekanbaru') and to_city = (select id from cities where name = 'Padang') limit 1;

  -- ===== S0 Persiapan: bersihkan sisa, nyalakan AntarPay + saluran, PIN admin, saldo pelanggan, promo uji =====
  begin
    perform set_config('antaraja.bypass', 'on', true);
    update orders set status = 'cancelled' where customer_id = cust and status in ('scheduled','searching','accepted','arrived','in_progress');
    update orders set status = 'cancelled' where driver_id in (drv, drv2, dbox) and status in ('accepted','arrived','in_progress');
    update profiles set is_active = true where id in (cust, drv, drv2, mown, adm, dbox) and not is_active;
    update drivers set status = 'approved', status_reason = null, is_online = false where id in (drv, drv2, dbox) and status <> 'approved';
    update merchants set status = 'approved', is_open = true where id = merch and (status <> 'approved' or not is_open);
    update travel_partners set status = 'approved' where id = drv2 and status <> 'approved';
    perform set_config('antaraja.bypass', 'off', true);
    delete from order_rejections where driver_id in (drv, drv2, dbox);
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    insert into admin_security (user_id, pin_hash) select adm, extensions.crypt('123456', extensions.gen_salt('bf')) where not exists (select 1 from admin_security where user_id = adm);
    update admin_security set pin_hash = extensions.crypt('123456', extensions.gen_salt('bf')), failed = 0, locked_until = null where user_id = adm;
    perform admin_unlock('123456');
    r := admin_set_antarpay_enabled(true);
    foreach k in array payment_channel_keys() loop r := admin_set_payment_channel(k, true); end loop;
    -- promo uji: pemilik biaya platform (semua layanan) & merchant (food)
    insert into promos (code, description, discount_type, value, max_discount, min_total, service, quota, used_count, is_active, valid_from, valid_to, per_user_limit, funded_by)
    values ('V2PLATFORM', 'Uji v2: promo ditanggung platform', 'fixed', 2000, null, 0, null, 500, 0, true, now() - interval '1 day', now() + interval '1 day', null, 'platform'),
           ('V2MERCHANT', 'Uji v2: promo ditanggung merchant', 'fixed', 5000, null, 0, 'food', 500, 0, true, now() - interval '1 day', now() + interval '1 day', null, 'merchant')
    on conflict (code) do update set is_active = true, value = excluded.value, quota = 500, used_count = 0, valid_to = excluded.valid_to, per_user_limit = null, funded_by = excluded.funded_by, service = excluded.service;
    -- saldo pelanggan: request_topup dibatasi 10.000–10.000.000 per permintaan (topup_requests_amount_check)
    -- → isi langsung lewat wallet_apply (mutasi tercatat, invarian saldo = Σ mutasi tetap terjaga)
    perform wallet_apply(cust, 'topup', 20000000, null, 'saldo uji v2');
    log := log || format('S0 %s persiapan: AntarPay=%s saluran gopay=%s saldo pelanggan=%s promo V2PLATFORM/V2MERCHANT siap, driver box=%s',
      case when antarpay_enabled() and payment_channel_enabled('gopay') and pg_temp.v2_saldo(cust) >= 20000000 and dbox is not null then 'OK' else 'BUG' end,
      antarpay_enabled(), payment_channel_enabled('gopay'), pg_temp.v2_saldo(cust), dbox) || E'\n';
  exception when others then log := log || 'S0 BUG persiapan: ' || sqlerrm || E'\n'; end;

  -- ===== S1 Tabel aturan (0098): 8 baris, pagar roda dua, RPC publik, RPC admin (PIN + validasi + audit) =====
  begin
    select count(*) into n from service_economics;
    select * into se from service_economics where service = 'ride_motor';
    log := log || format('S1a %s service_economics %s baris; ride_motor komisi=%s%% (cap %s%%), food ongkir hak driver komisi=%s%% fee merchant=%s%%',
      case when n = 8 and se.driver_commission_pct <= commission_cap_two_wheel() and (select driver_commission_pct from service_economics where service = 'food') = 0
                and (select merchant_fee_pct from service_economics where service = 'food') = 15 then 'OK' else 'BUG' end,
      n, se.driver_commission_pct, commission_cap_two_wheel(), (select driver_commission_pct from service_economics where service = 'food'), (select merchant_fee_pct from service_economics where service = 'food')) || E'\n';
    -- publik (anon)
    perform set_config('request.jwt.claims', '', true);
    r := service_economics_public('send');
    log := log || format('S1b %s service_economics_public(send) tanpa login: customer_platform_fee=%s (harus %s), tidak membuka merchant_fee_pct=%s',
      case when (r->>'customer_platform_fee')::bigint = (select customer_platform_fee from service_economics where service = 'send') and r ? 'merchant_fee_pct' = false then 'OK' else 'BUG' end,
      r->>'customer_platform_fee', (select customer_platform_fee from service_economics where service = 'send'), r ? 'merchant_fee_pct') || E'\n';
    -- admin tanpa PIN → tolak
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    perform admin_lock();
    begin se := admin_set_service_economics('ride_car', '{"driver_commission_pct": 16}'); log := log || 'S1c BUG aturan bisa diubah tanpa buka kunci PIN' || E'\n';
    exception when others then log := log || format('S1c %s tanpa PIN ditolak: %s', case when sqlerrm ilike '%ADMIN_LOCKED%' or sqlerrm ilike '%PIN%' then 'OK' else 'BUG' end, left(sqlerrm, 50)) || E'\n'; end;
    perform admin_unlock('123456');
    -- pagar roda dua lewat RPC
    begin se := admin_set_service_economics('ride_motor', jsonb_build_object('driver_commission_pct', commission_cap_two_wheel() + 1)); log := log || 'S1d BUG komisi ride_motor di atas cap diterima' || E'\n';
    exception when others then log := log || format('S1d %s komisi ride_motor %s%% ditolak: %s', case when sqlerrm ilike '%dibatasi maksimal%' then 'OK' else 'BUG' end, commission_cap_two_wheel() + 1, left(sqlerrm, 60)) || E'\n'; end;
    -- pagar roda dua lewat UPDATE langsung (trigger)
    begin update service_economics set driver_commission_pct = 20 where service = 'ride_motor'; log := log || 'S1e BUG trigger tidak menolak komisi 20% ride_motor' || E'\n';
    exception when others then log := log || format('S1e %s trigger menolak UPDATE langsung: %s', case when sqlerrm ilike '%dibatasi maksimal%' then 'OK' else 'BUG' end, left(sqlerrm, 60)) || E'\n'; end;
    -- validasi rentang & kolom asing
    begin se := admin_set_service_economics('send', '{"customer_platform_fee": -1}'); log := log || 'S1f BUG nominal negatif diterima' || E'\n';
    exception when others then log := log || format('S1f %s nominal negatif ditolak: %s', case when sqlerrm ilike '%≥ 0%' or sqlerrm ilike '%>= 0%' then 'OK' else 'BUG' end, left(sqlerrm, 50)) || E'\n'; end;
    begin se := admin_set_service_economics('send', '{"kolom_asing": 1}'); log := log || 'S1g BUG kolom asing diterima' || E'\n';
    exception when others then log := log || format('S1g %s kolom asing ditolak: %s', case when sqlerrm ilike '%tidak dikenal%' then 'OK' else 'BUG' end, left(sqlerrm, 50)) || E'\n'; end;
    -- perubahan sah + audit
    select count(*) into n from audit_logs where action = 'economics.updated';
    se := admin_set_service_economics('ride_car', '{"driver_commission_pct": 20, "notes": "uji v2"}');
    select count(*) into n2 from audit_logs where action = 'economics.updated';
    log := log || format('S1h %s ride_car komisi 15→%s%% tersimpan; audit economics.updated +%s baris (before=%s after=%s)',
      case when se.driver_commission_pct = 20 and n2 = n + 1
                and (select detail->'before'->>'driver_commission_pct' from audit_logs where action = 'economics.updated' order by created_at desc, id desc limit 1) = '15.00'
                and (select detail->'after'->>'driver_commission_pct' from audit_logs where action = 'economics.updated' order by created_at desc, id desc limit 1) = '20.00' then 'OK' else 'BUG' end,
      se.driver_commission_pct, n2 - n,
      (select detail->'before'->>'driver_commission_pct' from audit_logs where action = 'economics.updated' order by created_at desc, id desc limit 1),
      (select detail->'after'->>'driver_commission_pct' from audit_logs where action = 'economics.updated' order by created_at desc, id desc limit 1)) || E'\n';
    -- non-admin ditolak
    perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
    begin se := admin_set_service_economics('ride_car', '{"driver_commission_pct": 1}'); log := log || 'S1i BUG pelanggan bisa mengubah aturan' || E'\n';
    exception when others then log := log || format('S1i %s non-admin ditolak: %s', case when sqlerrm like 'Hanya admin%' then 'OK' else 'BUG' end, left(sqlerrm, 30)) || E'\n'; end;
    -- kembalikan
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    se := admin_set_service_economics('ride_car', '{"driver_commission_pct": 15}');
    log := log || format('S1j %s ride_car dikembalikan ke %s%%; driver_debt_limit=%s', case when se.driver_commission_pct = 15 and setting_num('driver_debt_limit', 0) = -500000 then 'OK' else 'BUG' end, se.driver_commission_pct, setting_num('driver_debt_limit', 0)) || E'\n';
  exception when others then log := log || 'S1 BUG aturan bisnis: ' || sqlerrm || E'\n'; end;

  -- ===== S2 Estimasi menampilkan biaya platform terpisah (fare_options / shopping_estimate / estimate_fare) =====
  begin
    perform set_config('request.jwt.claims', '', true);
    r := fare_options('ride_car', 0.4810, 101.4349, 0.52, 101.45, null, 0);
    v_pf := (select customer_platform_fee from service_economics where service = 'ride_car');
    log := log || format('S2a %s fare_options(ride_car) anon: customer_platform_fee=%s (harus %s), platform_fee=%s, kelas[0].total = fare + biaya platform → %s',
      case when (r->>'customer_platform_fee')::bigint = v_pf and (r->>'platform_fee')::bigint = v_pf
                and (r->'classes'->0->>'total')::bigint = (r->'classes'->0->>'fare')::bigint + v_pf then 'OK' else 'BUG' end,
      r->>'customer_platform_fee', v_pf, r->>'platform_fee', r->'classes'->0->>'total') || E'\n';
    r := shopping_estimate('market', 0.5345, 101.4407, 0.52, 101.45, 100000, 'motor', null);
    v_pf := (select customer_platform_fee from service_economics where service = 'market');
    log := log || format('S2b %s shopping_estimate(market) anon: customer_platform_fee=%s (harus %s) service_fee=%s (harus %s = max(min, 10%%)) total=%s',
      case when (r->>'customer_platform_fee')::bigint = v_pf and (r->>'service_fee')::bigint = shopping_service_fee('market', 100000)
                and (r->>'total')::bigint = (r->>'fare')::bigint + v_pf + (r->>'service_fee')::bigint + 100000 then 'OK' else 'BUG' end,
      r->>'customer_platform_fee', v_pf, r->>'service_fee', shopping_service_fee('market', 100000), r->>'total') || E'\n';
    r := estimate_fare('send', 0.4810, 101.4349, 0.50, 101.44, null);
    v_pf := (select customer_platform_fee from service_economics where service = 'send');
    log := log || format('S2c %s estimate_fare(send): platform_fee=%s customer_platform_fee=%s (harus %s dari service_economics, bukan pricing.platform_fee=%s)',
      case when (r->>'customer_platform_fee')::bigint = v_pf and (r->>'platform_fee')::bigint = v_pf then 'OK' else 'BUG' end,
      r->>'platform_fee', r->>'customer_platform_fee', v_pf, (select platform_fee from pricing where service = 'send')) || E'\n';
  exception when others then log := log || 'S2 BUG estimasi: ' || sqlerrm || E'\n'; end;

  -- ===== S3 Matriks layanan × (tunai, saldo) × (tanpa promo, promo platform, promo merchant) → selesai =====
  --   tiap order: (1) ledger_check seimbang, (2) delta dompet pelanggan/driver/merchant = payable, (3) driver_earning dasar
  --   tidak ditimpa & driver_earning_final = driver_payable, (4) snapshot komisi/fee = service_economics, (5) ledger_simulate = order nyata
  n := 10;
  for svc, pay, promo in
    select * from (values
      ('ride_motor','cash',null), ('ride_motor','wallet',null), ('ride_motor','cash','V2PLATFORM'), ('ride_motor','wallet','V2PLATFORM'),
      ('ride_car','cash',null), ('ride_car','wallet',null), ('ride_car','wallet','V2PLATFORM'),
      ('food','cash',null), ('food','wallet',null), ('food','cash','V2MERCHANT'), ('food','wallet','V2MERCHANT'), ('food','wallet','V2PLATFORM'),
      ('send','cash',null), ('send','wallet',null), ('send','cash','V2PLATFORM'),
      ('shop','cash',null), ('shop','wallet',null), ('shop','wallet','V2PLATFORM'),
      ('market','cash',null), ('market','wallet',null),
      ('box','cash',null), ('box','wallet',null), ('box','wallet','V2PLATFORM')
    ) as t(a, b, c)
  loop
    n := n + 1;
    begin
      v_drv := case svc when 'ride_car' then drv2 when 'box' then dbox else drv end;
      select * into se from service_economics where service = svc::service_type;
      c0 := pg_temp.v2_saldo(cust); d0 := pg_temp.v2_saldo(v_drv); m0 := pg_temp.v2_saldo(mown);
      o := pg_temp.v2_jalankan(svc, pay, promo);
      c1 := pg_temp.v2_saldo(cust); d1 := pg_temp.v2_saldo(v_drv); m1 := pg_temp.v2_saldo(mown);
      perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
      lc := ledger_check(o.id);
      -- (2) delta dompet yang diharapkan dari ledger
      ok := true; alasan := '';
      if not coalesce((lc->>'balanced')::boolean, false) then ok := false; alasan := alasan || format(' ledger tidak seimbang diff=%s/%s;', lc->>'diff', lc->>'diff_components'); end if;
      if pay = 'wallet' then
        if c1 - c0 <> -o.total then ok := false; alasan := alasan || format(' pelanggan Δ%s≠-%s;', c1 - c0, o.total); end if;
        if d1 - d0 <> (lc->>'driver_payable')::bigint + (lc->>'vendor_payable')::bigint then ok := false; alasan := alasan || format(' driver Δ%s≠payable %s+vendor %s;', d1 - d0, lc->>'driver_payable', lc->>'vendor_payable'); end if;
        if m1 - m0 <> (lc->>'merchant_payable')::bigint then ok := false; alasan := alasan || format(' merchant Δ%s≠%s;', m1 - m0, lc->>'merchant_payable'); end if;
      else
        if c1 <> c0 then ok := false; alasan := alasan || format(' saldo pelanggan berubah Δ%s;', c1 - c0); end if;
        if d1 - d0 <> -(lc->>'driver_receivable')::bigint + o.tip then ok := false; alasan := alasan || format(' driver Δ%s≠-receivable %s;', d1 - d0, lc->>'driver_receivable'); end if;
        if m1 <> m0 then ok := false; alasan := alasan || format(' merchant tunai Δ%s≠0;', m1 - m0); end if;
        -- tunai: uang di tangan driver − setoran − talangan − setoran ke merchant = pendapatan bersih (tanpa tip)
        if o.total - (lc->>'driver_receivable')::bigint - (lc->>'vendor_payable')::bigint - (lc->>'merchant_payable')::bigint <> (lc->>'driver_payable')::bigint - o.tip then ok := false; alasan := alasan || ' identitas tunai driver gagal;'; end if;
      end if;
      -- (3) driver_earning dasar & final
      if o.driver_earning <> o.fare_delivery - floor(o.fare_delivery * se.driver_commission_pct / 100.0) then ok := false; alasan := alasan || format(' driver_earning dasar %s≠%s;', o.driver_earning, o.fare_delivery - floor(o.fare_delivery * se.driver_commission_pct / 100.0)); end if;
      if o.driver_earning_final <> (lc->>'driver_payable')::bigint then ok := false; alasan := alasan || format(' driver_earning_final %s≠payable %s;', o.driver_earning_final, lc->>'driver_payable'); end if;
      -- (4) snapshot
      if o.driver_commission_pct_snap <> se.driver_commission_pct or o.merchant_fee_pct_snap <> se.merchant_fee_pct or o.ledger_version <> 2 or o.platform_fee <> se.customer_platform_fee then ok := false; alasan := alasan || ' snapshot aturan tidak cocok;'; end if;
      -- promo
      if promo is null and o.discount <> 0 then ok := false; alasan := alasan || ' diskon tanpa promo;'; end if;
      if promo = 'V2PLATFORM' and not (o.discount = 2000 and o.promo_funded_by = 'platform' and (lc->>'promo_platform')::bigint = 2000 and (lc->>'promo_merchant')::bigint = 0) then ok := false; alasan := alasan || format(' promo platform: disc=%s funded=%s promo_platform=%s;', o.discount, o.promo_funded_by, lc->>'promo_platform'); end if;
      if promo = 'V2MERCHANT' and not (o.discount = 5000 and o.promo_funded_by = 'merchant' and (lc->>'promo_merchant')::bigint = 5000 and (lc->>'promo_platform')::bigint = 0
           and o.merchant_earning = o.items_subtotal - floor(o.items_subtotal * se.merchant_fee_pct / 100.0) - 5000
           and (lc->>'platform_revenue')::bigint = o.platform_fee + (lc->>'merchant_fee')::bigint + (lc->>'driver_commission')::bigint - (lc->>'bonus')::bigint) then ok := false; alasan := alasan || format(' promo merchant: disc=%s funded=%s merchant_earning=%s promo_merchant=%s revenue=%s;', o.discount, o.promo_funded_by, o.merchant_earning, lc->>'promo_merchant', lc->>'platform_revenue'); end if;
      -- ongkir hak driver (food/send/shop/market): komisi 0 → driver_payable ≥ ongkir
      if svc in ('food','send','shop','market') and ((lc->>'driver_commission')::bigint <> 0 or (lc->>'driver_payable')::bigint < o.fare_delivery) then ok := false; alasan := alasan || ' ongkir dipotong padahal hak driver;'; end if;
      -- (5) simulasi = nyata
      sim := ledger_simulate(svc::service_type, o.fare_delivery, o.items_subtotal, o.discount, o.promo_funded_by, pay, 0);
      if (sim->>'driver_payable')::bigint <> (lc->>'driver_payable')::bigint - o.tip - o.extras_total
         or (sim->>'merchant_payable')::bigint <> (lc->>'merchant_payable')::bigint
         or (sim->>'platform_revenue')::bigint <> (lc->>'platform_revenue')::bigint
         or (sim->>'vendor_payable')::bigint <> (lc->>'vendor_payable')::bigint
         or not (sim->>'balanced')::boolean then
        ok := false; alasan := alasan || format(' simulasi≠nyata (driver %s/%s merchant %s/%s revenue %s/%s);', sim->>'driver_payable', lc->>'driver_payable', sim->>'merchant_payable', lc->>'merchant_payable', sim->>'platform_revenue', lc->>'platform_revenue');
      end if;
      log := log || format('S%s %s %s %s %s %s: total=%s ongkir=%s (komisi %s%%=%s bonus=%s) barang=%s biaya platform=%s jasa=%s diskon=%s [%s] | driver_payable=%s merchant_payable=%s vendor=%s revenue=%s receivable=%s | Δcust=%s Δdrv=%s Δmerch=%s%s',
        n, case when ok then 'OK' else 'BUG' end, svc, pay, coalesce(promo, 'tanpa promo'), o.code, o.total, o.fare_delivery, o.driver_commission_pct_snap, lc->>'driver_commission', lc->>'bonus',
        o.items_subtotal, o.platform_fee, o.service_fee, o.discount, coalesce(o.promo_funded_by, '-'), lc->>'driver_payable', lc->>'merchant_payable', lc->>'vendor_payable', lc->>'platform_revenue', lc->>'driver_receivable',
        c1 - c0, d1 - d0, m1 - m0, alasan) || E'\n';
    exception when others then log := log || format('S%s BUG %s %s %s: %s', n, svc, pay, coalesce(promo, '-'), sqlerrm) || E'\n'; end;
  end loop;

  -- ===== S40 ride_motor: porsi driver ≥ 92 % dari ongkir (komisi ≤ 8 %) di baris ledger =====
  begin
    o := pg_temp.v2_jalankan('ride_motor', 'wallet', null);
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    lc := ledger_check(o.id);
    log := log || format('S40 %s ride_motor %s: komisi snapshot=%s%% (≤ %s), komisi ledger=%s ≤ 8%% dari ongkir %s, driver_payable %s ≥ 92%% ongkir',
      case when o.driver_commission_pct_snap <= commission_cap_two_wheel() and (lc->>'driver_commission')::bigint <= floor(o.fare_delivery * 0.08)
                and (lc->>'driver_payable')::bigint >= ceil(o.fare_delivery * 0.92) then 'OK' else 'BUG' end,
      o.code, o.driver_commission_pct_snap, commission_cap_two_wheel(), lc->>'driver_commission', o.fare_delivery, lc->>'driver_payable') || E'\n';
  exception when others then log := log || 'S40 BUG: ' || sqlerrm || E'\n'; end;

  -- ===== S41 Tip + extras pada order TUNAI: receivable = total − (payable − tip); tip masuk dompet driver =====
  begin
    d0 := pg_temp.v2_saldo(drv); c0 := pg_temp.v2_saldo(cust);
    o := pg_temp.v2_jalankan('send', 'cash', null, '{"extra": 3000, "tip": 5000}');
    d1 := pg_temp.v2_saldo(drv); c1 := pg_temp.v2_saldo(cust);
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    lc := ledger_check(o.id);
    log := log || format('S41 %s send tunai %s tip=%s extras=%s: total=%s driver_payable=%s (ongkir %s + tip + extras) receivable=%s | Δdrv=%s (harus tip − receivable = %s) Δcust=%s (harus -tip) seimbang=%s',
      case when o.tip = 5000 and o.extras_total = 3000 and (lc->>'driver_payable')::bigint = o.fare_delivery + 5000 + 3000
                and (lc->>'driver_receivable')::bigint = o.total - ((lc->>'driver_payable')::bigint - 5000)
                and d1 - d0 = 5000 - (lc->>'driver_receivable')::bigint and c1 - c0 = -5000 and (lc->>'balanced')::boolean
                and pg_temp.v2_led(o.id, 'tip') = 5000 and pg_temp.v2_led(o.id, 'extras') = 3000 then 'OK' else 'BUG' end,
      o.code, o.tip, o.extras_total, o.total, lc->>'driver_payable', o.fare_delivery, lc->>'driver_receivable', d1 - d0, 5000 - (lc->>'driver_receivable')::bigint, c1 - c0, lc->>'balanced') || E'\n';
  exception when others then log := log || 'S41 BUG: ' || sqlerrm || E'\n'; end;

  -- ===== S42 Tip SETELAH selesai: driver_earning dasar tetap, driver_earning_final naik, ledger completed ditulis ulang =====
  begin
    o := pg_temp.v2_jalankan('ride_motor', 'wallet', null);
    b0 := o.driver_earning; b1 := o.driver_earning_final; d0 := pg_temp.v2_saldo(drv);
    perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
    o := add_tip(o.id, 4000);
    d1 := pg_temp.v2_saldo(drv);
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    lc := ledger_check(o.id);
    log := log || format('S42 %s tip 4000 setelah selesai: driver_earning %s→%s (tetap), final %s→%s (+4000), ledger driver_payable=%s gross=%s seimbang=%s Δdrv=%s',
      case when o.driver_earning = b0 and o.driver_earning_final = b1 + 4000 and (lc->>'driver_payable')::bigint = b1 + 4000 and (lc->>'gross_customer')::bigint = o.total + 4000
                and (lc->>'balanced')::boolean and d1 - d0 = 4000 then 'OK' else 'BUG' end,
      b0, o.driver_earning, b1, o.driver_earning_final, lc->>'driver_payable', lc->>'gross_customer', lc->>'balanced', d1 - d0) || E'\n';
  exception when others then log := log || 'S42 BUG: ' || sqlerrm || E'\n'; end;

  -- ===== S43 Pembatalan: refund + fase ledger =====
  begin
    -- (a) saldo, dibatalkan pelanggan sebelum driver → refunded
    c0 := pg_temp.v2_saldo(cust);
    o := pg_temp.v2_jalankan('box', 'wallet', 'V2PLATFORM', '{"hanya_buat": true}');
    perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
    c1 := pg_temp.v2_saldo(cust);
    o := cancel_order(o.id, 'uji batal v2');
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    lc := ledger_check(o.id);
    log := log || format('S43a %s box saldo dibatalkan: dipotong %s, kembali %s (saldo Δ%s harus 0) status=%s bayar=%s | ledger fase=%s refund=%s verdict=%s; fase created tetap tersimpan=%s baris',
      case when pg_temp.v2_saldo(cust) = c0 and o.status = 'cancelled' and o.payment_status = 'refunded' and lc->>'phase' = 'refunded'
                and (lc->>'refund')::bigint = o.total and (lc->>'balanced')::boolean
                and (select count(*) from order_ledger where order_id = o.id and phase = 'created') > 0 then 'OK' else 'BUG' end,
      c0 - c1, pg_temp.v2_saldo(cust) - c1, pg_temp.v2_saldo(cust) - c0, o.status, o.payment_status, lc->>'phase', lc->>'refund', lc->>'verdict',
      (select count(*) from order_ledger where order_id = o.id and phase = 'created')) || E'\n';
    -- (b) tunai dibatalkan → fase cancelled tanpa refund
    o := pg_temp.v2_jalankan('ride_motor', 'cash', null, '{"hanya_buat": true}');
    perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
    o := cancel_order(o.id, 'uji batal tunai');
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    lc := ledger_check(o.id);
    log := log || format('S43b %s ride_motor tunai dibatalkan: fase=%s refund=%s (harus 0) verdict=%s',
      case when lc->>'phase' = 'cancelled' and (lc->>'refund')::bigint = 0 and (lc->>'balanced')::boolean then 'OK' else 'BUG' end, lc->>'phase', lc->>'refund', lc->>'verdict') || E'\n';
    -- (c) merchant menolak pesanan saldo → refunded + promo merchant dikembalikan
    c0 := pg_temp.v2_saldo(cust);
    o := pg_temp.v2_jalankan('food', 'wallet', 'V2MERCHANT', '{"hanya_buat": true}');
    perform set_config('request.jwt.claims', json_build_object('sub', mown, 'role', 'authenticated')::text, true);
    o := merchant_update_order(o.id, 'rejected');
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    lc := ledger_check(o.id);
    log := log || format('S43c %s food ditolak merchant: saldo Δ%s (harus 0) bayar=%s fase=%s refund=%s (=total %s)',
      case when pg_temp.v2_saldo(cust) = c0 and o.payment_status = 'refunded' and lc->>'phase' = 'refunded' and (lc->>'refund')::bigint = o.total then 'OK' else 'BUG' end,
      pg_temp.v2_saldo(cust) - c0, o.payment_status, lc->>'phase', lc->>'refund', o.total) || E'\n';
    -- (d) belanja sudah dibayar driver lalu admin membatalkan → driver diganti (vendor_payable), sisa refund
    c0 := pg_temp.v2_saldo(cust); d0 := pg_temp.v2_saldo(drv);
    o := pg_temp.v2_jalankan('shop', 'wallet', null, '{"hanya_buat": true}');
    perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
    o := driver_accept_order(o.id); o := driver_update_order_status(o.id, 'arrived', null);
    o := set_shopping_actual(o.id, 149000, 'https://x/nota.jpg', null);
    n2 := (select count(*) from order_ledger where order_id = o.id and phase = 'adjusted');
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    o := cancel_order(o.id, 'uji batal admin setelah belanja');
    d1 := pg_temp.v2_saldo(drv);
    lc := ledger_check(o.id);
    log := log || format('S43d %s shop batal setelah belanja: fase adjusted tertulis=%s baris; driver diganti Δ%s (harus %s) refund pelanggan %s + reimburse %s = total %s → verdict=%s saldo pelanggan Δ%s',
      case when n2 > 0 and d1 - d0 = 149000 and (lc->>'reimburse')::bigint = 149000 and (lc->>'refund')::bigint + (lc->>'reimburse')::bigint = o.total and (lc->>'balanced')::boolean
                and pg_temp.v2_saldo(cust) - c0 = -149000 then 'OK' else 'BUG' end,
      n2, d1 - d0, 149000, lc->>'refund', lc->>'reimburse', o.total, lc->>'verdict', pg_temp.v2_saldo(cust) - c0) || E'\n';
    -- kembalikan saldo pelanggan yang terpakai untuk belanja (agar skenario lain tidak terganggu)
    perform admin_adjust_wallet(cust, 149000, 'uji v2: pulihkan saldo S43d');
  exception when others then log := log || 'S43 BUG pembatalan: ' || sqlerrm || E'\n'; end;

  -- ===== S44 Saluran gateway (qris/gopay): pg_channel & pg_fee snapshot sesuai pg_fee_calc; ledger tetap seimbang =====
  begin
    select f.fee, f.ppn into fee_q, ppn_q from pg_fee_calc('qris', 100000) f;
    o := pg_temp.v2_jalankan('ride_motor', 'qris', null);
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    lc := ledger_check(o.id);
    select f.fee, f.ppn into fee_q, ppn_q from pg_fee_calc('qris', o.fare_delivery + o.platform_fee - o.discount) f;
    log := log || format('S44a %s ride_motor via qris %s: pg_channel=%s pg_fee=%s ppn=%s (pg_fee_calc → %s/%s; tabel payment_channel_fees %s) borne_by=%s | ledger pg_fee baris=%s seimbang=%s contribution=%s = revenue %s − pg %s',
      case when o.pg_channel = 'qris' and o.pg_fee = fee_q and o.pg_fee_ppn = ppn_q and (lc->>'balanced')::boolean
                and pg_temp.v2_led(o.id, 'pg_fee') = fee_q
                and (lc->>'contribution')::bigint = (lc->>'platform_revenue')::bigint - (lc->>'pg_fee_platform')::bigint then 'OK' else 'BUG' end,
      o.code, o.pg_channel, o.pg_fee, o.pg_fee_ppn, fee_q, ppn_q, case when to_regclass('public.payment_channel_fees') is null then 'BELUM ADA (0100) → 0' else 'ada' end,
      coalesce(o.pg_fee_borne_by, '-'), pg_temp.v2_led(o.id, 'pg_fee'), lc->>'balanced', lc->>'contribution', lc->>'platform_revenue', lc->>'pg_fee_platform') || E'\n';
    o := pg_temp.v2_jalankan('send', 'cash', null);
    log := log || format('S44b %s order tunai: pg_channel=%s pg_fee=%s (harus cash/0)', case when o.pg_channel = 'cash' and o.pg_fee = 0 then 'OK' else 'BUG' end, o.pg_channel, o.pg_fee) || E'\n';
    o := pg_temp.v2_jalankan('send', 'wallet', null);
    log := log || format('S44c %s order saldo AntarPay: pg_channel=%s pg_fee=%s (harus antarpay/0 — biaya top up dicatat terpisah)', case when o.pg_channel = 'antarpay' and o.pg_fee = 0 then 'OK' else 'BUG' end, o.pg_channel, o.pg_fee) || E'\n';
  exception when others then log := log || 'S44 BUG gateway: ' || sqlerrm || E'\n'; end;

  -- ===== S45 Kebijakan biaya PG ditanggung PELANGGAN: total bertambah "Biaya pembayaran", revenue platform tidak berkurang =====
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    se := admin_set_service_economics('ride_car', '{"pg_fee_policy": "customer"}');
    select f.fee, f.ppn into fee_q, ppn_q from pg_fee_calc('card', 100000) f;
    c0 := pg_temp.v2_saldo(cust);
    o := pg_temp.v2_jalankan('ride_car', 'card', null);
    c1 := pg_temp.v2_saldo(cust);
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    lc := ledger_check(o.id);
    select f.fee, f.ppn into fee_q, ppn_q from pg_fee_calc('card', o.fare_delivery + o.platform_fee) f;
    log := log || format('S45 %s ride_car via card, policy=customer: total=%s = ongkir %s + biaya platform %s + biaya pembayaran %s (fee %s + ppn %s); pelanggan Δ%s; revenue=%s (= platform fee + komisi − bonus: %s) seimbang=%s%s',
      case when o.total = o.fare_delivery + o.platform_fee + fee_q + ppn_q and c1 - c0 = -o.total and (lc->>'balanced')::boolean
                and (lc->>'platform_revenue')::bigint = o.platform_fee + (lc->>'driver_commission')::bigint - (lc->>'bonus')::bigint
                and (fee_q = 0 or (o.pg_fee_borne_by = 'customer' and (lc->>'pg_fee_customer')::bigint = fee_q + ppn_q)) then 'OK' else 'BUG' end,
      o.total, o.fare_delivery, o.platform_fee, o.pg_fee + o.pg_fee_ppn, o.pg_fee, o.pg_fee_ppn, c1 - c0, lc->>'platform_revenue', o.platform_fee + (lc->>'driver_commission')::bigint - (lc->>'bonus')::bigint, lc->>'balanced',
      case when fee_q = 0 then ' (payment_channel_fees belum ada → biaya 0, hanya jalur yang diuji)' else '' end) || E'\n';
    se := admin_set_service_economics('ride_car', '{"pg_fee_policy": "platform"}');
  exception when others then log := log || 'S45 BUG pg_fee_policy customer: ' || sqlerrm || E'\n';
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    begin se := admin_set_service_economics('ride_car', '{"pg_fee_policy": "platform"}'); exception when others then null; end;
  end;

  -- ===== S46 Perubahan aturan admin langsung berlaku & di-snapshot: ride_car komisi 20 % → order baru memotong 20 %; order lama tetap 15 % =====
  begin
    o2 := pg_temp.v2_jalankan('ride_car', 'wallet', null);
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    se := admin_set_service_economics('ride_car', '{"driver_commission_pct": 20}');
    d0 := pg_temp.v2_saldo(drv2);
    o := pg_temp.v2_jalankan('ride_car', 'wallet', null);
    d1 := pg_temp.v2_saldo(drv2);
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    lc := ledger_check(o.id);
    log := log || format('S46 %s ride_car komisi diubah 15→20%%: order lama snap=%s%%, order baru snap=%s%% komisi=%s (=floor(%s×20%%)=%s) driver Δ%s = payable %s',
      case when o2.driver_commission_pct_snap = 15 and o.driver_commission_pct_snap = 20 and (lc->>'driver_commission')::bigint = floor(o.fare_delivery * 0.20)
                and d1 - d0 = (lc->>'driver_payable')::bigint and (lc->>'balanced')::boolean then 'OK' else 'BUG' end,
      o2.driver_commission_pct_snap, o.driver_commission_pct_snap, lc->>'driver_commission', o.fare_delivery, floor(o.fare_delivery * 0.20), d1 - d0, lc->>'driver_payable') || E'\n';
    se := admin_set_service_economics('ride_car', '{"driver_commission_pct": 15}');
    -- ledger order lama tidak berubah oleh aturan baru (snapshot), ledger_check tetap seimbang
    lc := ledger_check(o2.id);
    log := log || format('S46b %s order lama %s tetap komisi 15%% di ledger (%s) dan seimbang=%s', case when (lc->>'driver_commission')::bigint = floor(o2.fare_delivery * 0.15) and (lc->>'balanced')::boolean then 'OK' else 'BUG' end, o2.code, lc->>'driver_commission', lc->>'balanced') || E'\n';
  exception when others then log := log || 'S46 BUG snapshot aturan: ' || sqlerrm || E'\n';
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    begin se := admin_set_service_economics('ride_car', '{"driver_commission_pct": 15}'); exception when others then null; end;
  end;

  -- ===== S47 Batas saldo minus driver dari app_settings.driver_debt_limit (bukan hard-code) =====
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    d0 := pg_temp.v2_saldo(drv);
    perform admin_adjust_wallet(drv, -(d0 + 150000), 'uji v2: saldo driver -150.000');
    -- batas -500.000 (default): masih boleh online; order uji dibuat SEBELUM batas diperketat
    -- (v2_jalankan menyalakan driver lebih dulu — di bawah batas baru itu sendiri akan ditolak)
    o := pg_temp.v2_jalankan('ride_motor', 'cash', null, '{"hanya_buat": true}');
    perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
    perform driver_set_online(true, 0.4810, 101.4349);
    ok := true;
    -- ubah batas ke -100.000 → harus ditolak dengan angka baru di pesan (format Rp100.000)
    update app_settings set value = '-100000'::jsonb, updated_at = now() where key = 'driver_debt_limit';
    begin perform driver_set_online(true, 0.4810, 101.4349); ok := false; alasan := 'driver_set_online tidak menolak';
    exception when others then alasan := left(sqlerrm, 70); if sqlerrm not like '%100.000%' then ok := false; end if; end;
    begin perform driver_accept_order(o.id); ok := false; alasan := alasan || ' | driver_accept_order tidak menolak';
    exception when others then alasan := alasan || ' | ' || left(sqlerrm, 60); if sqlerrm not like '%100.000%' then ok := false; end if; end;
    update app_settings set value = '-500000'::jsonb, updated_at = now() where key = 'driver_debt_limit';
    perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
    perform cancel_order(o.id, 'bersih');
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    perform admin_adjust_wallet(drv, d0 + 150000, 'uji v2: pulihkan saldo driver');
    log := log || format('S47 %s saldo driver -150.000: batas -500.000 boleh online; batas diubah -100.000 → ditolak (%s); dipulihkan ke %s', case when ok then 'OK' else 'BUG' end, alasan, setting_num('driver_debt_limit', 0)) || E'\n';
  exception when others then log := log || 'S47 BUG batas minus: ' || sqlerrm || E'\n';
    update app_settings set value = '-500000'::jsonb where key = 'driver_debt_limit';
  end;

  -- ===== S48 Travel: booking kursi (saldo & tunai) → arrived; carter batal mendadak → denda 30 % = platform_revenue =====
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', drv2, 'role', 'authenticated')::text, true);
    tt := travel_trip_create(jsonb_build_object('route_id', route1, 'depart_at', (now() + interval '2 days')::text, 'seats_total', 6, 'seat_price', 150000, 'allow_private', false));
    perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
    c0 := pg_temp.v2_saldo(cust); p0 := pg_temp.v2_saldo(drv2);
    tb := travel_book(jsonb_build_object('trip_id', tt.id, 'pax', 2, 'pickup_address', 'V2 Jemput', 'pickup_lat', 0.5, 'pickup_lng', 101.44, 'passengers', jsonb_build_array(jsonb_build_object('name','A'), jsonb_build_object('name','B')), 'paid_via', 'wallet'));
    n := (select count(*) from order_ledger where source = 'travel_bookings' and source_id = tb.id and phase = 'created');
    perform set_config('request.jwt.claims', json_build_object('sub', drv2, 'role', 'authenticated')::text, true);
    perform travel_trip_set_status(tt.id, 'departed', null); perform travel_trip_set_status(tt.id, 'arrived', null);
    c1 := pg_temp.v2_saldo(cust); p1 := pg_temp.v2_saldo(drv2);
    select coalesce(-sum(amount) filter (where entry = 'partner_payable'), 0), coalesce(sum(amount) filter (where entry = 'platform_revenue'), 0), coalesce(sum(amount) filter (where entry = 'gross_customer'), 0),
           coalesce(sum(amount) filter (where entry = 'customer_platform_fee'), 0), coalesce(sum(amount) filter (where entry = 'merchant_fee'), 0)
      into b0, b1, d0, v_pf, d1
      from order_ledger where source = 'travel_bookings' and source_id = tb.id and phase = 'completed';
    log := log || format('S48a %s travel kursi SALDO %s: harga=%s (2×150.000 + biaya platform %s, fee mitra 10%%=%s) | ledger created=%s baris; completed: gross=%s partner_payable=%s revenue=%s (gross = partner + revenue: %s) | mitra Δ%s = partner_payable; pelanggan Δ%s',
      case when n > 0 and d0 = tb.price and b0 = tb.partner_earning and d0 = b0 + b1 and p1 - p0 = b0 and c1 - c0 = -tb.price
                and v_pf = (select customer_platform_fee from service_economics where service = 'travel') and d1 = floor(300000 * 0.10) then 'OK' else 'BUG' end,
      tb.code, tb.price, v_pf, d1, n, d0, b0, b1, d0 = b0 + b1, p1 - p0, c1 - c0) || E'\n';
    -- tunai
    perform set_config('request.jwt.claims', json_build_object('sub', drv2, 'role', 'authenticated')::text, true);
    tt := travel_trip_create(jsonb_build_object('route_id', route1, 'depart_at', (now() + interval '3 days')::text, 'seats_total', 6, 'seat_price', 150000, 'allow_private', false));
    perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
    p0 := pg_temp.v2_saldo(drv2);
    tb := travel_book(jsonb_build_object('trip_id', tt.id, 'pax', 1, 'pickup_address', 'V2 Jemput', 'pickup_lat', 0.5, 'pickup_lng', 101.44, 'passengers', jsonb_build_array(jsonb_build_object('name','C')), 'paid_via', 'cash'));
    perform set_config('request.jwt.claims', json_build_object('sub', drv2, 'role', 'authenticated')::text, true);
    perform travel_trip_set_status(tt.id, 'departed', null); perform travel_trip_set_status(tt.id, 'arrived', null);
    p1 := pg_temp.v2_saldo(drv2);
    select coalesce(sum(amount) filter (where entry = 'driver_receivable'), 0), coalesce(-sum(amount) filter (where entry = 'partner_payable'), 0) into b0, b1
      from order_ledger where source = 'travel_bookings' and source_id = tb.id and phase = 'completed';
    log := log || format('S48b %s travel kursi TUNAI %s: mitra memegang %s, setoran (driver_receivable, party mitra)=%s = harga − partner_payable %s; mitra Δ%s = −setoran',
      case when b0 = tb.price - tb.partner_earning and b1 = tb.partner_earning and p1 - p0 = -b0 then 'OK' else 'BUG' end, tb.code, tb.price, b0, b1, p1 - p0) || E'\n';
    -- carter: terima tawaran (created) → batal < 12 jam → refund 70 %, denda 30 % tercatat platform_revenue
    perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
    tr := travel_request_create(jsonb_build_object('kind','charter','depart_at', (now() + interval '5 hours')::text, 'pickup_address','V2 Pekanbaru','pickup_lat',0.5,'pickup_lng',101.44,'dropoff_address','Bukittinggi','pax',4,'accommodation','customer','fuel','partner','budget',500000,'paid_via','wallet'));
    perform set_config('request.jwt.claims', json_build_object('sub', drv2, 'role', 'authenticated')::text, true);
    tofr := travel_offer_create(tr.id, 400000, jsonb_build_object('base', 400000), 'Innova 2021');
    perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
    c0 := pg_temp.v2_saldo(cust);
    tr := travel_offer_accept(tofr.id);
    n := (select count(*) from order_ledger where source = 'travel_requests' and source_id = tr.id and phase = 'created');
    tr := travel_request_set_status(tr.id, 'cancelled', 'uji v2 batal mendadak');
    c1 := pg_temp.v2_saldo(cust);
    select coalesce(-sum(amount) filter (where entry = 'refund'), 0), coalesce(sum(amount) filter (where entry = 'platform_revenue' and note = 'denda batal'), 0) into b0, b1
      from order_ledger where source = 'travel_requests' and source_id = tr.id and phase = 'refunded';
    log := log || format('S48c %s carter %s diterima (ledger created=%s baris) lalu batal < 12 jam: pelanggan Δ%s (harus -120.000 = denda 30%%), ledger refunded: refund=%s denda platform_revenue=%s',
      case when n > 0 and c1 - c0 = -120000 and b0 = 280000 and b1 = 120000 and tr.payment_status = 'refunded' then 'OK' else 'BUG' end, tr.code, n, c1 - c0, b0, b1) || E'\n';
    -- carter selesai (saldo) → completed: partner_payable = 90 %
    perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
    tr := travel_request_create(jsonb_build_object('kind','charter','depart_at', (now() + interval '5 days')::text, 'pickup_address','V2 Pekanbaru','pickup_lat',0.5,'pickup_lng',101.44,'dropoff_address','Bukittinggi','pax',4,'accommodation','customer','fuel','partner','budget',500000,'paid_via','wallet'));
    perform set_config('request.jwt.claims', json_build_object('sub', drv2, 'role', 'authenticated')::text, true);
    tofr := travel_offer_create(tr.id, 500000, jsonb_build_object('base', 500000), 'Innova 2021');
    perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
    tr := travel_offer_accept(tofr.id);
    perform set_config('request.jwt.claims', json_build_object('sub', drv2, 'role', 'authenticated')::text, true);
    p0 := pg_temp.v2_saldo(drv2);
    perform travel_request_set_status(tr.id, 'ongoing', null); tr := travel_request_set_status(tr.id, 'completed', null);
    p1 := pg_temp.v2_saldo(drv2);
    select coalesce(-sum(amount) filter (where entry = 'partner_payable'), 0), coalesce(sum(amount) filter (where entry = 'platform_revenue'), 0), coalesce(sum(amount) filter (where entry = 'gross_customer'), 0) into b0, b1, d0
      from order_ledger where source = 'travel_requests' and source_id = tr.id and phase = 'completed';
    log := log || format('S48d %s carter selesai %s: gross=%s partner_payable=%s (harus %s = 90%%) revenue=%s (fee mitra 10%%) mitra Δ%s',
      case when d0 = 500000 and b0 = 450000 and b1 = 50000 and p1 - p0 = 450000 and d0 = b0 + b1 then 'OK' else 'BUG' end, tr.code, d0, b0, 450000, b1, p1 - p0) || E'\n';
  exception when others then log := log || 'S48 BUG travel: ' || sqlerrm || E'\n'; end;

  -- ===== S49 Rincian transparan mitra & merchant + RLS order_ledger =====
  begin
    d0 := pg_temp.v2_saldo(drv); m0 := pg_temp.v2_saldo(mown);
    o := pg_temp.v2_jalankan('food', 'wallet', 'V2MERCHANT');
    d1 := pg_temp.v2_saldo(drv); m1 := pg_temp.v2_saldo(mown);
    perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
    bd := driver_order_breakdown(o.id);
    log := log || format('S49a %s driver_order_breakdown %s: ongkir=%s komisi %s%%=%s tip=%s extras=%s bagian jasa=%s bonus=%s bersih=%s (= Δdompet driver %s) fase=%s',
      case when (bd->>'bersih')::bigint = d1 - d0 and (bd->>'ongkir')::bigint = o.fare_delivery and (bd->>'komisi')::bigint = 0 and bd->>'phase' = 'completed' then 'OK' else 'BUG' end,
      o.code, bd->>'ongkir', bd->>'komisi_pct', bd->>'komisi', bd->>'tip', bd->>'extras', bd->>'service_share', bd->>'bonus', bd->>'bersih', d1 - d0, bd->>'phase') || E'\n';
    perform set_config('request.jwt.claims', json_build_object('sub', mown, 'role', 'authenticated')::text, true);
    bd := merchant_order_breakdown(o.id);
    log := log || format('S49b %s merchant_order_breakdown %s: nilai pesanan=%s fee %s%%=%s promo merchant=%s diterima=%s (= Δdompet merchant %s = %s − %s − %s)',
      case when (bd->>'diterima')::bigint = m1 - m0 and (bd->>'promo_merchant')::bigint = 5000 and (bd->>'fee')::bigint = floor(o.items_subtotal * 0.15)
                and (bd->>'diterima')::bigint = o.items_subtotal - floor(o.items_subtotal * 0.15) - 5000 then 'OK' else 'BUG' end,
      o.code, bd->>'nilai_pesanan', bd->>'fee_pct', bd->>'fee', bd->>'promo_merchant', bd->>'diterima', m1 - m0, o.items_subtotal, floor(o.items_subtotal * 0.15), 5000) || E'\n';
    -- pihak lain tidak boleh melihat rincian
    perform set_config('request.jwt.claims', json_build_object('sub', drv2, 'role', 'authenticated')::text, true);
    begin bd := driver_order_breakdown(o.id); log := log || 'S49c BUG driver lain bisa melihat rincian order' || E'\n';
    exception when others then log := log || format('S49c %s driver lain ditolak: %s', case when sqlerrm like 'Bukan order Anda%' then 'OK' else 'BUG' end, left(sqlerrm, 30)) || E'\n'; end;
    -- RLS: driver hanya melihat baris party_id miliknya (tidak ada platform_revenue), admin melihat semua
    perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select count(*), count(*) filter (where party_id = drv), count(*) filter (where entry = 'platform_revenue') into n, n2, b0 from order_ledger where order_id = o.id;
    reset role;
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select count(*) into b1 from order_ledger where order_id = o.id;
    reset role;
    log := log || format('S49d %s RLS order_ledger: driver melihat %s baris (semua party_id sendiri=%s, platform_revenue=%s harus 0); admin melihat %s baris (> driver)',
      case when n > 0 and n = n2 and b0 = 0 and b1 > n then 'OK' else 'BUG' end, n, n = n2, b0, b1) || E'\n';
    -- klien tidak bisa menulis ledger
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin insert into order_ledger (order_id, entry, amount, phase) values (o.id, 'adjustment', 1, 'adjusted'); reset role; log := log || 'S49e BUG klien bisa menulis order_ledger' || E'\n';
    exception when others then reset role; log := log || format('S49e %s tulis order_ledger sebagai klien ditolak: %s', case when sqlerrm ilike '%permission denied%' or sqlerrm ilike '%row-level security%' then 'OK' else 'BUG' end, left(sqlerrm, 50)) || E'\n'; end;
    set local role authenticated;   -- blok S49e di atas sudah reset role → jalankan ulang sebagai klien
    begin perform ledger_post(o.id, 'adjusted'); reset role; log := log || 'S49f BUG ledger_post bisa dipanggil langsung' || E'\n';
    exception when others then reset role; log := log || format('S49f %s ledger_post langsung dari klien ditolak: %s', case when sqlerrm ilike '%permission denied%' then 'OK' else 'BUG' end, left(sqlerrm, 50)) || E'\n'; end;
    -- ledger_post idempoten per fase: dipanggil ulang (sebagai pemilik) tidak menggandakan baris
    reset role;
    perform set_config('request.jwt.claims', '', true);
    select count(*) into n from order_ledger where order_id = o.id and phase = 'completed';
    r := ledger_post(o.id, 'completed');
    select count(*) into n2 from order_ledger where order_id = o.id and phase = 'completed';
    log := log || format('S49g %s ledger_post idempoten: baris fase completed %s → %s (sama)', case when n = n2 and n > 0 then 'OK' else 'BUG' end, n, n2) || E'\n';
  exception when others then reset role; log := log || 'S49 BUG rincian/RLS: ' || sqlerrm || E'\n'; end;

  -- ===== S51 Pengerasan akses: anon/non-admin tidak bisa membaca rincian/aturan; TRUNCATE ledger ditolak; pg_fee_calc tanpa tabel = 0/0 =====
  begin
    select id into o from orders where ledger_version = 2 and status = 'completed' and driver_id is not null and created_at >= transaction_timestamp() limit 1;
    -- (a) anon: auth.uid() NULL tidak boleh lolos pemeriksaan pemilik
    perform set_config('request.jwt.claims', '', true);
    begin bd := driver_order_breakdown(o.id); log := log || 'S51a BUG anon bisa membaca driver_order_breakdown' || E'\n';
    exception when others then log := log || format('S51a %s anon membaca driver_order_breakdown ditolak: %s', case when sqlerrm like 'Bukan order Anda%' then 'OK' else 'BUG' end, left(sqlerrm, 30)) || E'\n'; end;
    -- (b) ledger_simulate membuka seluruh aturan → hanya admin
    perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
    begin sim := ledger_simulate('food', 8000, 60000, 0, null, 'cash', 0); log := log || 'S51b BUG non-admin bisa menjalankan ledger_simulate' || E'\n';
    exception when others then log := log || format('S51b %s ledger_simulate non-admin ditolak: %s', case when sqlerrm like 'Hanya admin%' then 'OK' else 'BUG' end, left(sqlerrm, 30)) || E'\n'; end;
    -- (c) TRUNCATE tidak tunduk RLS → hak klien harus dicabut
    set local role authenticated;
    begin truncate order_ledger; reset role; log := log || 'S51c BUG klien bisa TRUNCATE order_ledger' || E'\n';
    exception when others then reset role; log := log || format('S51c %s TRUNCATE order_ledger sebagai klien ditolak: %s', case when sqlerrm ilike '%permission denied%' then 'OK' else 'BUG' end, left(sqlerrm, 50)) || E'\n'; end;
    reset role;
    -- (d) pg_fee_calc aman urutan
    select f.fee, f.ppn into fee_q, ppn_q from pg_fee_calc('qris', 100000) f;
    log := log || format('S51d %s pg_fee_calc(qris, 100.000) = %s/%s; payment_channel_fees %s',
      case when to_regclass('public.payment_channel_fees') is not null or (fee_q = 0 and ppn_q = 0) then 'OK' else 'BUG' end,
      fee_q, ppn_q, case when to_regclass('public.payment_channel_fees') is null then 'belum ada → harus 0/0' else 'ada' end) || E'\n';
  exception when others then reset role; log := log || 'S51 BUG pengerasan akses: ' || sqlerrm || E'\n'; end;

  -- ===== S50 Invarian global: semua order v2 selesai dalam simulasi seimbang; dompet = jumlah mutasi =====
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    select count(*), count(*) filter (where (ledger_check(id)->>'balanced')::boolean) into n, n2
      from orders where ledger_version = 2 and status = 'completed' and created_at >= transaction_timestamp();
    select count(*) into b0 from wallets wl left join (select user_id, sum(amount) jml from wallet_transactions group by user_id) t on t.user_id = wl.user_id where wl.balance <> coalesce(t.jml, 0);
    log := log || format('S50 %s invarian: %s order v2 selesai dalam simulasi, %s seimbang; dompet yang saldonya ≠ jumlah mutasi = %s (harus 0)',
      case when n > 0 and n = n2 and b0 = 0 then 'OK' else 'BUG' end, n, n2, b0) || E'\n';
  exception when others then log := log || 'S50 BUG invarian: ' || sqlerrm || E'\n'; end;

  raise exception using message = 'SIMULASI_SELESAI' || log;
end $sim$;
