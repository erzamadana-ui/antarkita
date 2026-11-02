-- =====================================================================
-- uji_potongan_0126.sql — Potongan per transaksi semua layanan (migrasi 0126)
--   1. orders (ride_motor, ride_car, food, send, shop, market, box) × tunai/saldo: tiap order selesai punya mutasi saldo driver ber-order_id;
--      tunai: fee = −driver_receivable = −platform_revenue (termasuk PPN inklusif); saldo: earning = driver_payable; food saldo: merchant earning = merchant_payable
--   2. travel kursi bersama tunai & saldo: mutasi per booking dengan ref = booking id (bukan gabungan per trip); tunai: fee = −(price − partner_earning); ledger punya tax_output
--   3. travel carter dengan HANYA paid_via='cash' → payment_method cash (saldo pelanggan tidak dipotong), selesai → fee = −platform_fee ber-ref; saldo → earning ber-ref
--   4. titipan antar kota via mitra travel tunai & saldo
--   5. partner_fee_statement (driver, merchant, mitra travel): satu baris per transaksi; platform_fee + ppn = potongan; net = wallet earning (saldo) / payable (tunai);
--      ppn = round(fee × 11/111); summary konsisten; pelanggan tanpa transaksi → kosong; tanpa login ditolak
-- Pola (a): blok DO diakhiri RAISE 'SIMULASI_SELESAI' + log (baris "Sxx OK|BUG").   Lokal: scripts/db-lokal.sh test supabase/tests/uji_potongan_0126.sql
-- Akun seed: a0..01 admin (PIN 123456), ..02 pelanggan, ..03 driver motor, ..04 driver mobil/mitra travel, ..05 pemilik merchant, ..06 driver box.
-- =====================================================================
create or replace function pg_temp.p26_jalankan(p_service text, p_pay text)
returns orders language plpgsql as $$
declare
  cust uuid := 'a0000000-0000-4000-8000-000000000002'; drv uuid := 'a0000000-0000-4000-8000-000000000003';
  drv2 uuid := 'a0000000-0000-4000-8000-000000000004'; mown uuid := 'a0000000-0000-4000-8000-000000000005'; dbox uuid := 'a0000000-0000-4000-8000-000000000006';
  merch uuid := 'b0000000-0000-4000-8000-000000000001'; menu1 uuid; store1 uuid; prod1 uuid; mk uuid; item1 uuid; o orders; p jsonb; v_pin text; v_drv uuid;
begin
  select id into menu1 from menu_items where merchant_id = merch and is_available limit 1;
  select id into store1 from shop_stores where active and name ilike 'Indomaret%' limit 1;
  select id into prod1 from shop_products where store_id = store1 and in_stock limit 1;
  select id into mk from markets where active order by name limit 1;
  select id into item1 from market_items where name ilike 'Beras medium' limit 1;
  v_drv := case p_service when 'ride_car' then drv2 when 'box' then dbox else drv end;
  perform set_config('request.jwt.claims', json_build_object('sub', v_drv, 'role', 'authenticated')::text, true);
  perform driver_selfie_check('https://x/selfie.jpg');
  perform driver_set_online(true, case when p_service = 'food' then -0.9405 else 0.4810 end, case when p_service = 'food' then 100.3625 else 101.4349 end);
  perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
  p := case p_service
    when 'ride_motor' then jsonb_build_object('service','ride_motor','vehicle_class','motor_economy','pickup', jsonb_build_object('lat',0.4810,'lng',101.4349,'address','A'),'dropoff', jsonb_build_object('lat',0.50,'lng',101.44,'address','B'))
    when 'ride_car'   then jsonb_build_object('service','ride_car','vehicle_class','car_economy','pickup', jsonb_build_object('lat',0.4810,'lng',101.4349,'address','A'),'dropoff', jsonb_build_object('lat',0.52,'lng',101.45,'address','B'))
    when 'food'       then jsonb_build_object('service','food','merchant_id', merch,'items', jsonb_build_array(jsonb_build_object('menu_item_id', menu1, 'qty', 2)),'dropoff', jsonb_build_object('lat',-0.945,'lng',100.36,'address','Kos'))
    when 'send'       then jsonb_build_object('service','send','weight_kg',3,'size_cm',30,'pickup', jsonb_build_object('lat',0.4810,'lng',101.4349,'address','Toko'),'dropoff', jsonb_build_object('lat',0.50,'lng',101.44,'address','Rumah'),'recipient_name','Sari','recipient_phone','0811')
    when 'shop'       then jsonb_build_object('service','shop','shop_store_id', store1,'shop_vehicle','motor','shopping_list', jsonb_build_array(jsonb_build_object('product_id', prod1, 'qty', 2)),'dropoff', jsonb_build_object('lat',0.52,'lng',101.45,'address','Rumah'))
    when 'market'     then jsonb_build_object('service','market','market_id', mk,'shop_vehicle','motor','shopping_list', jsonb_build_array(jsonb_build_object('item_id', item1, 'qty', 2)),'dropoff', jsonb_build_object('lat',0.52,'lng',101.45,'address','Rumah'))
    when 'box'        then jsonb_build_object('service','box','helpers',1,'purpose','pindahan','pickup', jsonb_build_object('lat',0.4950,'lng',101.4320,'address','Kos lama'),'dropoff', jsonb_build_object('lat',0.5100,'lng',101.4450,'address','Kos baru'))
    end;
  p := p || jsonb_build_object('paid_via', p_pay, 'client_request_id', 'p26-' || p_service || '-' || p_pay || '-' || md5(random()::text));
  o := create_order(p);
  if p_service = 'food' then
    perform set_config('request.jwt.claims', json_build_object('sub', mown, 'role', 'authenticated')::text, true);
    o := merchant_update_order(o.id, 'accepted'); o := merchant_update_order(o.id, 'ready');
  end if;
  select pin into v_pin from order_pins where order_id = o.id;
  perform set_config('request.jwt.claims', json_build_object('sub', v_drv, 'role', 'authenticated')::text, true);
  o := driver_accept_order(o.id); o := driver_update_order_status(o.id, 'arrived', null);
  if p_service = 'shop' then o := set_shopping_actual(o.id, 149000, 'https://x/nota.jpg', null); end if;
  if p_service = 'market' then o := set_shopping_actual(o.id, 29000, 'https://x/nota.jpg', jsonb_build_array(jsonb_build_object('item_id', item1, 'price', 14500, 'qty', 2))); end if;
  o := driver_update_order_status(o.id, 'in_progress', v_pin);
  o := driver_update_order_status(o.id, 'completed', null);
  return o;
end $$;

do $sim$
declare
  adm uuid := 'a0000000-0000-4000-8000-000000000001'; cust uuid := 'a0000000-0000-4000-8000-000000000002'; drv uuid := 'a0000000-0000-4000-8000-000000000003';
  drv2 uuid := 'a0000000-0000-4000-8000-000000000004'; mown uuid := 'a0000000-0000-4000-8000-000000000005'; dbox uuid := 'a0000000-0000-4000-8000-000000000006';
  svc text; pay text; o orders; r jsonb; k1 text; lc jsonb; w record; tr travel_requests; tt travel_trips; tb travel_bookings; tofr travel_offers; route1 uuid; city_bkt uuid; wh_dest uuid;
  v_drv uuid; seq0 bigint; n int; m0 bigint; m1 bigint; c0 bigint; c1 bigint; ok boolean; log text := E'\n'; v_from date; v_to date; st jsonb; sm jsonb; v_ppn numeric := setting_num('ppn_pct', 11);
  n_tx int := 0; n_ok int := 0; codes text[] := '{}'; bA boolean; bB boolean; bC boolean; bD boolean; nA int; nB int; nC int; nD int;
begin
  v_from := (now() at time zone 'Asia/Jakarta')::date; v_to := v_from;
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  perform admin_unlock('123456');
  perform admin_set_antarpay_enabled(true);
  foreach k1 in array payment_channel_keys() loop perform admin_set_payment_channel(k1, true); end loop;
  insert into app_settings (key, value) values ('payments_simulation_enabled','true'), ('payment_provider_env','"sandbox"'), ('rate_limit_create_order_per_hour','100000'),
    ('antifraud_orders_per_hour_max','100000'), ('antifraud_new_account_hours','0'), ('antifraud_active_orders_max','100'), ('driver_deposit_required','false'),
    ('driver_debt_limit','-5000000'), ('payout_auto_sweep_enabled','false'), ('ppn_inclusive','true')
  on conflict (key) do update set value = excluded.value;
  perform set_config('antaraja.bypass', 'on', true);
  update orders set status = 'cancelled' where (customer_id = cust or driver_id in (drv, drv2, dbox)) and status in ('searching','accepted','arrived','in_progress','awaiting_payment');
  update profiles set is_active = true where id in (cust, drv, drv2, mown, adm, dbox);
  update drivers set status = 'approved', is_online = false where id in (drv, drv2, dbox);
  update merchants set status = 'approved', is_open = true where owner_id = mown;
  update travel_partners set status = 'approved' where id = drv2;
  delete from fraud_flags where subject_id in (drv, drv2, dbox, mown, cust) and status = 'open';
  perform wallet_apply(cust, 'topup', 5000000, null, 'uji 0126');
  perform set_config('antaraja.bypass', 'off', true);

  -- ===== S1 orders: tiap layanan × tunai/saldo =====
  foreach svc in array array['ride_motor','ride_car','food','send','shop','market','box'] loop
    foreach pay in array array['cash','wallet'] loop
      begin
        v_drv := case svc when 'ride_car' then drv2 when 'box' then dbox else drv end;
        seq0 := (select coalesce(max(seq), 0) from wallet_transactions);
        m0 := (select coalesce(balance, 0) from wallets where user_id = mown);
        o := pg_temp.p26_jalankan(svc, pay);
        m1 := (select coalesce(balance, 0) from wallets where user_id = mown);
        perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
        lc := ledger_check(o.id);
        n_tx := n_tx + 1; codes := codes || o.code;
        ok := coalesce((lc->>'balanced')::boolean, false) and (lc->>'platform_revenue')::bigint > 0 and (lc->>'tax_output')::bigint > 0;
        if pay = 'cash' then
          -- satu mutasi 'fee' driver ber-order_id senilai −driver_receivable (= −platform_revenue bila tanpa merchant/vendor)
          select count(*) as n, coalesce(sum(amount), 0) as amt into w from wallet_transactions where order_id = o.id and user_id = v_drv and type = 'fee' and seq > seq0;
          ok := ok and w.n = 1 and w.amt = -(lc->>'driver_receivable')::bigint and (lc->>'driver_receivable')::bigint > 0;
          if svc not in ('food', 'shop', 'market') then ok := ok and (lc->>'driver_receivable')::bigint = (lc->>'platform_revenue')::bigint; end if;
          if svc = 'food' then ok := ok and (lc->>'driver_receivable')::bigint = (lc->>'platform_revenue')::bigint and m1 = m0; end if;   -- fee merchant ikut setoran driver (dibayar driver S − fee)
        else
          select count(*) as n, coalesce(sum(amount), 0) as amt into w from wallet_transactions where order_id = o.id and user_id = v_drv and type = 'earning' and seq > seq0 and note like 'Pendapatan %';
          ok := ok and w.n = 1 and w.amt = (lc->>'driver_payable')::bigint;
          if svc in ('shop', 'market') then ok := ok and exists (select 1 from wallet_transactions where order_id = o.id and user_id = v_drv and type = 'earning' and amount = (lc->>'vendor_payable')::bigint and note like 'Penggantian belanja%'); end if;
          if svc = 'food' then ok := ok and m1 - m0 = (lc->>'merchant_payable')::bigint and exists (select 1 from wallet_transactions where order_id = o.id and user_id = mown and type = 'earning' and amount = (lc->>'merchant_payable')::bigint); end if;
        end if;
        if ok then n_ok := n_ok + 1; end if;
        log := log || format('S1 %s %s %s %s: total=%s revenue=%s (PPN %s) receivable=%s driver_payable=%s merchant_payable=%s vendor=%s Δmerchant=%s',
          case when ok then 'OK' else 'BUG' end, rpad(svc, 10), rpad(pay, 6), o.code, o.total, lc->>'platform_revenue', lc->>'tax_output', lc->>'driver_receivable', lc->>'driver_payable', lc->>'merchant_payable', lc->>'vendor_payable', m1 - m0) || E'\n';
      exception when others then log := log || format('S1 BUG %s %s: %s', svc, pay, sqlerrm) || E'\n'; end;
    end loop;
  end loop;

  -- ===== S2 travel kursi bersama (per booking, ref) =====
  select id into city_bkt from cities where name = 'Bukittinggi';
  select id into route1 from travel_routes where active and from_city = (select id from cities where name = 'Pekanbaru') and to_city = (select id from cities where name = 'Padang') limit 1;
  select id into wh_dest from warehouses where city_id = city_bkt and active limit 1;
  foreach pay in array array['cash','wallet'] loop
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', drv2, 'role', 'authenticated')::text, true);
      tt := travel_trip_create(jsonb_build_object('route_id', route1, 'depart_at', (now() + interval '1 day')::text, 'seats_total', 6));
      perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
      tb := travel_book(jsonb_build_object('trip_id', tt.id, 'pax', 2, 'pickup_address', 'A', 'pickup_lat', 0.5, 'pickup_lng', 101.44, 'passengers', jsonb_build_array(jsonb_build_object('name', 'Budi'), jsonb_build_object('name', 'Ani')), 'paid_via', pay));
      perform set_config('request.jwt.claims', json_build_object('sub', drv2, 'role', 'authenticated')::text, true);
      seq0 := (select coalesce(max(seq), 0) from wallet_transactions);
      perform travel_trip_set_status(tt.id, 'departed', null); perform travel_trip_set_status(tt.id, 'arrived', null);
      select * into tb from travel_bookings where id = tb.id;
      select count(*) as n, coalesce(sum(amount), 0) as amt, bool_and(ref = tb.id::text) as refok into w from wallet_transactions where user_id = drv2 and seq > seq0;
      n_tx := n_tx + 1; codes := codes || tb.code;
      ok := tb.status = 'completed' and w.n = 1 and coalesce(w.refok, false)
        and w.amt = case when pay = 'cash' then -(tb.price - tb.partner_earning) else tb.partner_earning end
        and exists (select 1 from order_ledger where source = 'travel_bookings' and source_id = tb.id and phase = 'completed' and entry = 'tax_output' and funded_by = 'inclusive' and amount < 0)
        and not exists (select 1 from wallet_transactions where user_id = drv2 and seq > seq0 and note = 'Potongan platform travel (tunai)');
      if ok then n_ok := n_ok + 1; end if;
      log := log || format('S2 %s travel_shared %s %s: price=%s pf=%s partner=%s → mutasi mitra %s baris Σ%s ref=%s; ledger PPN=%s', case when ok then 'OK' else 'BUG' end, rpad(pay, 6), tb.code, tb.price, tb.platform_fee, tb.partner_earning, w.n, w.amt, w.refok,
        (select -sum(amount) from order_ledger where source = 'travel_bookings' and source_id = tb.id and phase = 'completed' and entry = 'tax_output')) || E'\n';
    exception when others then log := log || format('S2 BUG travel_shared %s: %s', pay, sqlerrm) || E'\n'; end;
  end loop;

  -- ===== S3 travel carter (paid_via saja) =====
  foreach pay in array array['cash','wallet'] loop
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
      c0 := (select balance from wallets where user_id = cust);
      tr := travel_request_create(jsonb_build_object('kind', 'charter', 'depart_at', (now() + interval '2 days')::text, 'pickup_address', 'Pekanbaru', 'pickup_lat', 0.5, 'pickup_lng', 101.44, 'dropoff_address', 'Bukittinggi', 'pax', 4, 'accommodation', 'customer', 'fuel', 'partner', 'budget', 600000, 'paid_via', pay));
      perform set_config('request.jwt.claims', json_build_object('sub', drv2, 'role', 'authenticated')::text, true);
      tofr := travel_offer_create(tr.id, 500000, jsonb_build_object('base', 500000), 'Innova');
      perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
      perform travel_offer_accept(tofr.id);
      c1 := (select balance from wallets where user_id = cust);
      perform set_config('request.jwt.claims', json_build_object('sub', drv2, 'role', 'authenticated')::text, true);
      seq0 := (select coalesce(max(seq), 0) from wallet_transactions);
      perform travel_request_set_status(tr.id, 'ongoing', null); perform travel_request_set_status(tr.id, 'completed', null);
      select * into tr from travel_requests where id = tr.id;
      select count(*) as n, coalesce(sum(amount), 0) as amt, bool_and(ref = tr.id::text) as refok into w from wallet_transactions where user_id = drv2 and seq > seq0;
      n_tx := n_tx + 1; codes := codes || tr.code;
      ok := tr.status = 'completed' and tr.payment_method::text = pay and w.n = 1 and coalesce(w.refok, false)
        and w.amt = case when pay = 'cash' then -tr.platform_fee else tr.partner_earning end
        and (case when pay = 'cash' then c1 = c0 else c1 = c0 - tr.price end)
        and exists (select 1 from order_ledger where source = 'travel_requests' and source_id = tr.id and phase = 'completed' and entry = 'tax_output' and amount < 0);
      if ok then n_ok := n_ok + 1; end if;
      log := log || format('S3 %s travel_charter %s %s: payment_method=%s price=%s fee=%s partner=%s Δcust=%s → mutasi mitra %s baris Σ%s ref=%s', case when ok then 'OK' else 'BUG' end, rpad(pay, 6), tr.code, tr.payment_method, tr.price, tr.platform_fee, tr.partner_earning, c1 - c0, w.n, w.amt, w.refok) || E'\n';
    exception when others then log := log || format('S3 BUG travel_charter %s: %s', pay, sqlerrm) || E'\n'; end;
  end loop;

  -- ===== S4 titipan antar kota via mitra travel =====
  foreach pay in array array['cash','wallet'] loop
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
      o := create_order(jsonb_build_object('service', 'send', 'send_scope', 'intercity', 'via', 'travel', 'dest_city_id', city_bkt, 'warehouse_id', wh_dest, 'weight_kg', 2, 'pickup', jsonb_build_object('lat', 0.4810, 'lng', 101.4349, 'address', 'Toko A'), 'dropoff', jsonb_build_object('lat', -0.3, 'lng', 100.37, 'address', 'Bukittinggi'), 'recipient_name', 'Andi', 'recipient_phone', '0812', 'paid_via', pay, 'client_request_id', 'p26-tr-' || pay || md5(random()::text)));
      perform set_config('request.jwt.claims', json_build_object('sub', drv2, 'role', 'authenticated')::text, true);
      o := travel_accept_send(o.id); o := travel_pickup_send(o.id); o := travel_complete_send(o.id);
      perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
      lc := ledger_check(o.id);
      select count(*) as n, coalesce(sum(amount), 0) as amt into w from wallet_transactions where order_id = o.id and user_id = drv2;
      n_tx := n_tx + 1; codes := codes || o.code;
      ok := coalesce((lc->>'balanced')::boolean, false) and w.n = 1 and w.amt = case when pay = 'cash' then -(lc->>'driver_receivable')::bigint else (lc->>'partner_payable')::bigint end
        and (pay <> 'cash' or (lc->>'driver_receivable')::bigint = (lc->>'platform_revenue')::bigint);
      if ok then n_ok := n_ok + 1; end if;
      log := log || format('S4 %s titipan_travel %s %s: total=%s antar kota=%s revenue=%s receivable=%s partner=%s → mutasi mitra Σ%s', case when ok then 'OK' else 'BUG' end, rpad(pay, 6), o.code, o.total, o.intercity_fare, lc->>'platform_revenue', lc->>'driver_receivable', lc->>'partner_payable', w.amt) || E'\n';
    exception when others then log := log || format('S4 BUG titipan %s: %s', pay, sqlerrm) || E'\n'; end;
  end loop;
  log := log || format('S4z %s ringkasan audit: %s dari %s transaksi (7 layanan orders ×2, kursi ×2, carter ×2, titipan ×2) memotong biaya platform + PPN per transaksi', case when n_ok = n_tx and n_tx = 20 then 'OK' else 'BUG' end, n_ok, n_tx) || E'\n';

  -- ===== S5 partner_fee_statement =====
  begin
    -- driver drv: ride_motor/food/send/shop/market × 2 = 10 baris hari ini (ditambah transaksi lama hari ini bila ada → cek ⊇)
    perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
    select count(*) filter (where x->>'code' = any (codes)), count(*) filter (where x->>'code' = any (codes) and x->>'role' = 'driver'),
           bool_and((x->>'platform_fee')::bigint + (x->>'ppn')::bigint = (x->>'fee_total')::bigint and (x->>'ppn')::bigint = round((x->>'fee_total')::bigint * v_ppn / (100 + v_ppn))),
           bool_and((x->>'gross')::bigint - (x->>'fee_total')::bigint = (x->>'net_to_partner')::bigint),
           bool_and(case when x->>'paid_via' = 'cash' then (x->>'wallet_delta')::bigint < 0 and (x->>'cash_held')::bigint > 0 else (x->>'wallet_delta')::bigint = (x->>'net_to_partner')::bigint end)
      into nA, nB, bA, bB, bC from partner_fee_statement(v_from, v_to) x where x->>'code' = any (codes);
    -- net saldo = mutasi earning nyata untuk order saldo
    select bool_and(exists (select 1 from wallet_transactions t where t.order_id = (x->>'order_id')::uuid and t.user_id = drv and t.type = 'earning' and t.amount = (x->>'net_to_partner')::bigint))
      into bD from partner_fee_statement(v_from, v_to) x where x->>'code' = any (codes) and x->>'paid_via' = 'wallet';
    sm := partner_fee_statement_summary(v_from, v_to);
    log := log || format('S5a %s statement driver: %s baris transaksi uji (role driver %s), fee+ppn=fee_total & ppn=fee×%s/%s: %s, gross−fee=net: %s, wallet_delta konsisten: %s, net saldo = earning nyata: %s; summary count=%s fee_total=%s ppn=%s by_service=%s',
      case when nA = 10 and nB = 10 and bA and bB and bC and coalesce(bD, false) and (sm->>'count')::int >= 10 then 'OK' else 'BUG' end,
      nA, nB, v_ppn, 100 + v_ppn, bA, bB, bC, bD, sm->>'count', sm->>'fee_total', sm->>'ppn', sm->'by_service') || E'\n';
    -- merchant: 2 baris food (tunai & saldo): gross = nilai pesanan, fee = fee merchant, net = merchant_payable; tunai → cash_held = net, wallet_delta 0
    perform set_config('request.jwt.claims', json_build_object('sub', mown, 'role', 'authenticated')::text, true);
    select count(*), bool_and(x->>'role' = 'merchant' and x->>'service' = 'food'),
           bool_and(case when x->>'paid_via' = 'cash' then (x->>'wallet_delta')::bigint = 0 and (x->>'cash_held')::bigint = (x->>'net_to_partner')::bigint
                         else (x->>'wallet_delta')::bigint = (x->>'net_to_partner')::bigint and exists (select 1 from wallet_transactions t where t.order_id = (x->>'order_id')::uuid and t.user_id = mown and t.amount = (x->>'net_to_partner')::bigint) end),
           min((x->>'fee_total')::bigint)
      into nA, bA, bB, m0 from partner_fee_statement(v_from, v_to) x where x->>'code' = any (codes);
    log := log || format('S5b %s statement merchant: %s baris food, fee merchant min=%s, saldo/tunai konsisten: %s', case when nA = 2 and bA and bB and m0 > 0 then 'OK' else 'BUG' end, nA, m0, bB) || E'\n';
    -- mitra travel drv2: ride_car ×2 (driver) + kursi ×2 + carter ×2 + titipan ×2 = 8
    perform set_config('request.jwt.claims', json_build_object('sub', drv2, 'role', 'authenticated')::text, true);
    select count(*), count(*) filter (where x->>'service' = 'travel_shared'), count(*) filter (where x->>'service' = 'travel_charter'), count(*) filter (where x->>'service' = 'travel_send'), count(*) filter (where x->>'service' = 'ride_car'),
           bool_and((x->>'gross')::bigint - (x->>'fee_total')::bigint = (x->>'net_to_partner')::bigint and (x->>'fee_total')::bigint > 0),
           bool_and(case when x->>'source' = 'orders' then true else exists (select 1 from wallet_transactions t where t.user_id = drv2 and t.ref = x->>'source_id' and t.amount = (x->>'wallet_delta')::bigint) end)
      into nA, nB, nC, nD, n, bA, bB from partner_fee_statement(v_from, v_to) x where x->>'code' = any (codes);
    log := log || format('S5c %s statement mitra travel: %s baris (kursi %s, carter %s, titipan %s, ride_car %s); gross−fee=net & fee>0: %s; wallet_delta travel = mutasi ber-ref: %s',
      case when nA = 8 and nB = 2 and nC = 2 and nD = 2 and n = 2 and bA and bB then 'OK' else 'BUG' end, nA, nB, nC, nD, n, bA, bB) || E'\n';
    -- pelanggan: kosong; tanpa login: ditolak
    perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
    select count(*) into n from partner_fee_statement(v_from, v_to);
    perform set_config('request.jwt.claims', '', true);
    k1 := ''; begin perform partner_fee_statement(v_from, v_to); exception when others then k1 := sqlerrm; end;
    log := log || format('S5d %s pelanggan → %s baris; tanpa login → %s', case when n = 0 and k1 like '%login%' then 'OK' else 'BUG' end, n, k1) || E'\n';
  exception when others then log := log || 'S5 BUG statement: ' || sqlerrm || E'\n'; end;

  raise exception 'SIMULASI_SELESAI %', log;
end $sim$;
