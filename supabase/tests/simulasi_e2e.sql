-- Simulasi transaksi ujung-ke-ujung AntarKita (semua peran) — dijalankan dalam satu transaksi lalu di-ROLLBACK (data tidak berubah).
-- Cara pakai: jalankan di SQL editor Supabase sebagai postgres; hasil log ada di pesan error terakhir (sengaja RAISE agar rollback).
do $sim$
declare
  cust uuid := 'a0000000-0000-4000-8000-000000000002'; drv uuid := 'a0000000-0000-4000-8000-000000000003'; drv2 uuid := 'a0000000-0000-4000-8000-000000000004';
  mown uuid := 'a0000000-0000-4000-8000-000000000005'; adm uuid := 'a0000000-0000-4000-8000-000000000001';
  merch uuid := 'b0000000-0000-4000-8000-000000000001'; menu1 uuid; store1 uuid; prod1 uuid; mk uuid; item1 uuid; route1 uuid; wh_dest uuid; city_bkt uuid;
  o orders; o2 orders; r jsonb; j jsonb; v_pin text; b0 bigint; b1 bigint; d0 bigint; d1 bigint; m0 bigint; m1 bigint; n int; t tickets; tr travel_requests; tt travel_trips; tb travel_bookings; tofr travel_offers; v market_vendors; vi market_vendor_items; f fraud_flags; w withdrawal_requests; tp topup_requests; log text := E'\n';
  -- Tahap 9 (S22-S30): dispatch dinamis, matriks kendaraan, titipan mitra travel, panel admin, portal eksekutif
  dbox uuid; n2 int; n3 int; j1 jsonb; j2 jsonb; jr jsonb; k1 text; ordid uuid; d_from date; d_to date;
  dm drivers; dc drivers; db drivers; bo boolean; bo2 boolean; bo3 boolean;
  s_rad0 jsonb; s_tier0 jsonb; s_dr1 numeric; s_dc1 int; s_dr2 numeric; s_dc2 int; s_km numeric; s_wait numeric;
begin
  select id into menu1 from menu_items where merchant_id = merch and is_available limit 1;
  select id into store1 from shop_stores where active and name ilike 'Indomaret%' limit 1;
  select id into prod1 from shop_products where store_id = store1 and in_stock limit 1;
  select id into mk from markets where active order by name limit 1;
  select id into item1 from market_items where name ilike 'Beras medium' limit 1;
  select id into city_bkt from cities where name = 'Bukittinggi';
  select id into route1 from travel_routes where active and from_city = (select id from cities where name = 'Pekanbaru') and to_city = (select id from cities where name = 'Padang') limit 1;
  select id into wh_dest from warehouses where city_id = city_bkt and active limit 1;
  select id into dbox from drivers where vehicle_type in ('box','pickup') and status = 'approved' order by created_at limit 1;

  -- ===== S0 Pembersihan sisa uji manual (ikut di-rollback): order aktif lama akun uji ditutup agar batas 3 order aktif & "selesaikan order aktif dulu" tidak mengganggu =====
  begin
    update orders set status = 'cancelled' where customer_id = cust and status in ('searching','accepted','arrived','in_progress'); get diagnostics n = row_count;
    update orders set status = 'cancelled' where driver_id in (drv, drv2) and status in ('accepted','arrived','in_progress'); get diagnostics m0 = row_count;
    if n + m0 > 0 then log := log || format('S0 bersih: %s order aktif lama pelanggan uji & %s order aktif lama driver uji ditutup (hanya dalam transaksi simulasi)', n, m0) || E'\n'; end if;
    -- mitra uji bisa saja tertinggal berstatus suspended dari uji sebelumnya; kembalikan ke approved agar seluruh alur bisa dijalankan
    k1 := (select string_agg(id::text || '=' || status, ', ') from drivers where id in (drv, drv2) and status <> 'approved');
    if k1 is not null then
      perform set_config('antaraja.bypass', 'on', true);
      update drivers set status = 'approved', status_reason = null where id in (drv, drv2) and status <> 'approved';
      perform set_config('antaraja.bypass', 'off', true);
      log := log || format('S0 bersih: status mitra uji dipulihkan ke approved (sebelumnya %s)', k1) || E'\n';
    end if;
  exception when others then log := log || 'S0 BUG bersih: ' || sqlerrm || E'\n'; end;

  -- ===== S0 Saldo uji pelanggan (top up manual disetujui admin) =====
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
    tp := request_topup(2000000, 'bank_transfer', 'https://x/bukti.jpg', 'saldo uji');
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    perform admin_review_topup(tp.id, true, 'saldo uji');
    log := log || format('S0 OK saldo uji pelanggan=%s', (select balance from wallets where user_id = cust)) || E'\n';
  exception when others then log := log || 'S0 BUG topup: ' || sqlerrm || E'\n'; end;

  -- ===== S1 Ride motor (wallet) =====
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
    perform driver_selfie_check('https://x/selfie.jpg'); perform driver_set_online(true, 0.4810, 101.4349);
    perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
    select balance into b0 from wallets where user_id = cust;
    o := create_order(jsonb_build_object('service', 'ride_motor', 'vehicle_class', 'motor_economy', 'pickup', jsonb_build_object('lat', 0.4810, 'lng', 101.4349, 'address', 'Jl. Sudirman 45'), 'dropoff', jsonb_build_object('lat', 0.50, 'lng', 101.44, 'address', 'Plaza Andalas'), 'paid_via', 'wallet'));
    select balance into b1 from wallets where user_id = cust;
    select pin into v_pin from order_pins where order_id = o.id;
    perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
    select balance into d0 from wallets where user_id = drv;
    o := driver_accept_order(o.id);
    o := driver_update_order_status(o.id, 'arrived', null);
    begin o := driver_update_order_status(o.id, 'in_progress', '0000'); log := log || 'S1 BUG: PIN salah diterima' || E'\n'; exception when others then if sqlerrm not like '%PIN%' then raise; end if; end;
    o := driver_update_order_status(o.id, 'in_progress', v_pin);
    o := driver_update_order_status(o.id, 'completed', null);
    select balance into d1 from wallets where user_id = drv;
    perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
    perform rate_order(o.id, 'driver', 5, 'Mantap');
    perform add_tip(o.id, 5000);
    log := log || format('S1 OK ride_motor %s total=%s cust %s→%s (potong %s) driver +%s status=%s pin=%s', o.code, o.total, b0, b1, b0 - b1, d1 - d0, o.status, v_pin) || E'\n';
  exception when others then log := log || 'S1 BUG ride_motor: ' || sqlerrm || E'\n'; end;

  -- ===== S2 Ride car (tunai, kelas mobil) =====
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', drv2, 'role', 'authenticated')::text, true);
    perform driver_selfie_check('https://x/selfie.jpg'); perform driver_set_online(true, 0.4946, 101.4314);
    perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
    o := create_order(jsonb_build_object('service', 'ride_car', 'vehicle_class', 'car_economy', 'pickup', jsonb_build_object('lat', 0.4946, 'lng', 101.4314, 'address', 'Rumah'), 'dropoff', jsonb_build_object('lat', 0.52, 'lng', 101.45, 'address', 'Bandara SSK II'), 'paid_via', 'cash'));
    select pin into v_pin from order_pins where order_id = o.id;
    perform set_config('request.jwt.claims', json_build_object('sub', drv2, 'role', 'authenticated')::text, true);
    select balance into d0 from wallets where user_id = drv2;
    o := driver_accept_order(o.id); o := driver_update_order_status(o.id, 'arrived', null); o := driver_update_order_status(o.id, 'in_progress', v_pin); o := driver_update_order_status(o.id, 'completed', null);
    select balance into d1 from wallets where user_id = drv2;
    log := log || format('S2 OK ride_car %s total=%s fare=%s potongan platform driver=%s', o.code, o.total, o.fare_delivery, d0 - d1) || E'\n';
  exception when others then log := log || 'S2 BUG ride_car: ' || sqlerrm || E'\n'; end;

  -- ===== S3 Food (wallet, promo, merchant, PIN tidak wajib) =====
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
    perform driver_selfie_check('https://x/selfie.jpg'); perform driver_set_online(true, -0.9405, 100.3625);
    perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
    select balance into b0 from wallets where user_id = cust; select balance into m0 from wallets where user_id = mown;
    o := create_order(jsonb_build_object('service', 'food', 'merchant_id', merch, 'items', jsonb_build_array(jsonb_build_object('menu_item_id', menu1, 'qty', 2)), 'dropoff', jsonb_build_object('lat', -0.945, 'lng', 100.36, 'address', 'Kos Andalas'), 'paid_via', 'wallet', 'promo_code', 'ANTARBARU'));
    perform set_config('request.jwt.claims', json_build_object('sub', mown, 'role', 'authenticated')::text, true);
    begin o := merchant_update_order(o.id, 'accepted'); exception when others then log := log || 'S3 note merchant accepted: ' || sqlerrm || E'\n'; end;
    begin o := merchant_update_order(o.id, 'preparing'); exception when others then null; end;
    o := merchant_update_order(o.id, 'ready');
    perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
    o := driver_accept_order(o.id); o := driver_update_order_status(o.id, 'arrived', null); o := driver_update_order_status(o.id, 'in_progress', null); o := driver_update_order_status(o.id, 'completed', null);
    select balance into b1 from wallets where user_id = cust; select balance into m1 from wallets where user_id = mown;
    perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
    perform rate_order(o.id, 'merchant', 4, 'Enak');
    log := log || format('S3 OK food %s sub=%s disc=%s total=%s cust -%s merchant +%s merchant_earning=%s', o.code, o.items_subtotal, o.discount, o.total, b0 - b1, m1 - m0, o.merchant_earning) || E'\n';
  exception when others then log := log || 'S3 BUG food: ' || sqlerrm || E'\n'; end;

  -- ===== S4 Send dalam kota (tunai) + extra biaya =====
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
    o := create_order(jsonb_build_object('service', 'send', 'pickup', jsonb_build_object('lat', -0.9405, 'lng', 100.3625, 'address', 'Toko A'), 'dropoff', jsonb_build_object('lat', -0.95, 'lng', 100.37, 'address', 'Rumah B'), 'recipient_name', 'Siti', 'recipient_phone', '0813', 'package_details', jsonb_build_object('type', 'dokumen'), 'paid_via', 'cash'));
    perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
    o := driver_accept_order(o.id); o := driver_update_order_status(o.id, 'arrived', null);
    o := request_extra(o.id, 'parking', 3000, 'Parkir');
    perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
    o := respond_extra(o.id, (o.extras->-1->>'id')::uuid, true);
    perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
    o := driver_update_order_status(o.id, 'in_progress', null); o := driver_update_order_status(o.id, 'completed', null);
    log := log || format('S4 OK send %s total=%s extras=%s', o.code, o.total, o.extras_total) || E'\n';
  exception when others then log := log || 'S4 BUG send: ' || sqlerrm || E'\n'; end;

  -- ===== S5 Send antar kota (Padang → Bukittinggi) =====
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
    o := create_order(jsonb_build_object('service', 'send', 'send_scope', 'intercity', 'dest_city_id', city_bkt, 'warehouse_id', wh_dest, 'weight_kg', 2.5, 'pickup', jsonb_build_object('lat', -0.9405, 'lng', 100.3625, 'address', 'Toko A'), 'dropoff', jsonb_build_object('lat', -0.3, 'lng', 100.37, 'address', 'Bukittinggi'), 'recipient_name', 'Andi', 'recipient_phone', '0812', 'paid_via', 'wallet'));
    log := log || format('S5 OK send_intercity %s ongkir dalam kota=%s antar kota=%s total=%s drop=%s', o.code, o.fare_delivery, o.intercity_fare, o.total, o.dropoff_address) || E'\n';
    perform cancel_order(o.id, 'uji');
  exception when others then log := log || 'S5 BUG send_intercity: ' || sqlerrm || E'\n'; end;

  -- ===== S6 Box (mobil box + helper) → batal & refund =====
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
    select balance into b0 from wallets where user_id = cust;
    o := create_order(jsonb_build_object('service', 'box', 'helpers', 2, 'purpose', 'pindahan', 'pickup', jsonb_build_object('lat', -0.9405, 'lng', 100.3625, 'address', 'Kos lama'), 'dropoff', jsonb_build_object('lat', -0.93, 'lng', 100.38, 'address', 'Kos baru'), 'paid_via', 'wallet'));
    select balance into b1 from wallets where user_id = cust;
    o := cancel_order(o.id, 'Berubah pikiran');
    select balance into d1 from wallets where user_id = cust;
    log := log || format('S6 OK box %s total=%s dipotong=%s refund kembali=%s status=%s', o.code, o.total, b0 - b1, d1 - b1, o.status) || E'\n';
    if d1 <> b0 then log := log || 'S6 BUG: refund tidak penuh' || E'\n'; end if;
  exception when others then log := log || 'S6 BUG box: ' || sqlerrm || E'\n'; end;

  -- ===== S7 AntarShop (wallet) =====
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
    perform driver_selfie_check('https://x/selfie.jpg'); perform driver_set_online(true, 0.5168, 101.4463);
    perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
    select balance into b0 from wallets where user_id = cust;
    o := create_order(jsonb_build_object('service', 'shop', 'shop_store_id', store1, 'shop_vehicle', 'motor', 'shopping_list', jsonb_build_array(jsonb_build_object('product_id', prod1, 'qty', 2)), 'dropoff', jsonb_build_object('lat', 0.52, 'lng', 101.45, 'address', 'Rumah'), 'paid_via', 'wallet'));
    perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
    select balance into d0 from wallets where user_id = drv;
    o := driver_accept_order(o.id); o := driver_update_order_status(o.id, 'arrived', null);
    o := set_shopping_actual(o.id, 149000, 'https://x/nota.jpg', null);
    o := driver_update_order_status(o.id, 'in_progress', null); o := driver_update_order_status(o.id, 'completed', null);
    select balance into b1 from wallets where user_id = cust; select balance into d1 from wallets where user_id = drv;
    log := log || format('S7 OK shop %s anggaran=%s riil=%s jasa=%s total=%s cust -%s driver +%s', o.code, o.est_budget, o.items_subtotal, o.service_fee, o.total, b0 - b1, d1 - d0) || E'\n';
  exception when others then log := log || 'S7 BUG shop: ' || sqlerrm || E'\n'; end;

  -- ===== S8 AntarMarket + pedagang + koefisien =====
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', mown, 'role', 'authenticated')::text, true);
    v := apply_market_vendor(jsonb_build_object('market_id', mk, 'stall_name', 'Lapak Uji', 'categories', jsonb_build_array('sembako'), 'phone', '0812', 'photo_url', 'x', 'id_card_url', 'y'));
    vi := vendor_upsert_item(jsonb_build_object('name', 'Beras medium premium', 'category', 'sembako', 'unit', 'kg', 'price', 15000, 'grade', 'A', 'photo_url', 'z', 'item_id', item1));
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    perform admin_review_market_vendor(v.id, 'approved', null);
    perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
    perform driver_selfie_check('https://x/selfie.jpg'); perform driver_set_online(true, 0.5345, 101.4407);
    perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
    select balance into b0 from wallets where user_id = cust;
    o := create_order(jsonb_build_object('service', 'market', 'market_id', mk, 'shop_vehicle', 'motor', 'shopping_list', jsonb_build_array(jsonb_build_object('item_id', item1, 'qty', 2), jsonb_build_object('vendor_item_id', vi.id, 'name', vi.name, 'qty', 1)), 'dropoff', jsonb_build_object('lat', 0.52, 'lng', 101.45, 'address', 'Rumah'), 'paid_via', 'wallet'));
    log := log || format('S8a OK market %s list=%s anggaran=%s', o.code, (select string_agg(coalesce(x->>'vendor_name', 'acuan') || ':' || (x->>'price'), ', ') from jsonb_array_elements(o.shopping_list) x), o.est_budget) || E'\n';
    perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
    o := driver_accept_order(o.id); o := driver_update_order_status(o.id, 'arrived', null);
    -- harga 2x acuan → harus ditolak
    begin o := set_shopping_actual(o.id, 60000, 'https://x/nota.jpg', jsonb_build_array(jsonb_build_object('item_id', item1, 'price', 30000, 'qty', 2))); log := log || 'S8 BUG: harga 2x acuan tidak ditolak' || E'\n';
    exception when others then log := log || 'S8b OK hard cap: ' || sqlerrm || E'\n'; end;
    -- harga 1.35x tanpa nota → harus minta foto nota
    begin o := set_shopping_actual(o.id, 44000, null, jsonb_build_array(jsonb_build_object('item_id', item1, 'price', 19500, 'qty', 2))); log := log || 'S8 BUG: outlier tanpa nota diterima' || E'\n';
    exception when others then log := log || 'S8c OK nota wajib: ' || sqlerrm || E'\n'; end;
    o := set_shopping_actual(o.id, 54000, 'https://x/nota.jpg', jsonb_build_array(jsonb_build_object('item_id', item1, 'price', 19500, 'qty', 2), jsonb_build_object('item_id', vi.item_id, 'price', 15000, 'qty', 1)));
    select count(*) into n from fraud_flags where order_id = o.id and kind = 'price_outlier';
    o := driver_update_order_status(o.id, 'in_progress', null); o := driver_update_order_status(o.id, 'completed', null);
    select balance into b1 from wallets where user_id = cust;
    log := log || format('S8d OK market selesai total=%s riil=%s flag_outlier=%s cust -%s', o.total, o.items_subtotal, n, b0 - b1) || E'\n';
  exception when others then log := log || 'S8 BUG market: ' || sqlerrm || E'\n'; end;

  -- ===== S9 Pembatalan driver berulang → tangguhkan otomatis → admin pulihkan =====
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
    perform driver_selfie_check('https://x/selfie.jpg'); perform driver_set_online(true, 0.4810, 101.4349);
    for n in 1..3 loop
      perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
      o := create_order(jsonb_build_object('service', 'ride_motor', 'vehicle_class', 'motor_economy', 'pickup', jsonb_build_object('lat', 0.4810, 'lng', 101.4349, 'address', 'A'), 'dropoff', jsonb_build_object('lat', 0.49, 'lng', 101.44, 'address', 'B'), 'paid_via', 'cash'));
      perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
      o := driver_accept_order(o.id);
      o := cancel_order(o.id, 'uji batal');
      perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
      perform cancel_order(o.id, 'bersih');
      m0 := n;
      -- batas 3 pembatalan/24 jam dihitung termasuk pembatalan nyata driver uji hari ini → berhenti begitu ditangguhkan
      exit when (select status from drivers where id = drv) = 'suspended';
    end loop;
    select * into f from fraud_flags where subject_id = drv and kind = 'cancel_spam' and severity = 'high' order by created_at desc limit 1;
    log := log || format('S9a %s driver status=%s flag=%s auto=%s setelah %s pembatalan dalam simulasi (total 24 jam=%s)', case when (select status from drivers where id = drv) = 'suspended' then 'OK' else 'BUG' end, (select status from drivers where id = drv), f.kind, f.auto_action, m0, f.detail->>'cancellations_24h') || E'\n';
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    perform admin_review_fraud(f.id, 'dismissed', 'Uji sistem', true);
    log := log || format('S9b %s driver dipulihkan status=%s', case when (select status from drivers where id = drv) = 'approved' then 'OK' else 'BUG' end, (select status from drivers where id = drv)) || E'\n';
  exception when others then log := log || 'S9 BUG cancel-spam: ' || sqlerrm || E'\n'; end;

  -- ===== S10 Travel kursi bersama =====
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', drv2, 'role', 'authenticated')::text, true);
    tt := travel_trip_create(jsonb_build_object('route_id', route1, 'depart_at', (now() + interval '1 day')::text, 'seats_total', 6, 'seat_price', 150000, 'allow_private', true, 'private_price', 800000));
    perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
    select balance into b0 from wallets where user_id = cust;
    tb := travel_book(jsonb_build_object('trip_id', tt.id, 'pax', 2, 'pickup_address', 'Jl. Sudirman 45', 'pickup_lat', 0.5, 'pickup_lng', 101.44, 'passengers', jsonb_build_array(jsonb_build_object('name', 'Budi'), jsonb_build_object('name', 'Ani')), 'paid_via', 'wallet'));
    select balance into b1 from wallets where user_id = cust;
    perform set_config('request.jwt.claims', json_build_object('sub', drv2, 'role', 'authenticated')::text, true);
    r := travel_trip_manifest(tt.id);
    perform travel_trip_set_status(tt.id, 'departed', null);
    perform travel_trip_set_status(tt.id, 'arrived', null);
    perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
    perform travel_rate(tb.id, 5);
    log := log || format('S10 OK travel shared booking=%s pax=%s total=%s cust -%s manifest=%s', tb.code, tb.pax, tb.price + tb.platform_fee, b0 - b1, jsonb_array_length(r)) || E'\n';
  exception when others then log := log || 'S10 BUG travel shared: ' || sqlerrm || E'\n'; end;

  -- ===== S11 Travel carter (permintaan → tawaran → terima → selesai → nilai) =====
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
    tr := travel_request_create(jsonb_build_object('kind', 'charter', 'depart_at', (now() + interval '2 days')::text, 'pickup_address', 'Jl. Sudirman 199, Pekanbaru', 'pickup_lat', 0.5, 'pickup_lng', 101.44, 'dropoff_address', 'Bukittinggi', 'pax', 4, 'accommodation', 'customer', 'fuel', 'partner', 'budget', 600000, 'paid_via', 'wallet'));
    perform set_config('request.jwt.claims', json_build_object('sub', drv2, 'role', 'authenticated')::text, true);
    tofr := travel_offer_create(tr.id, 500000, jsonb_build_object('base', 500000), 'Innova 2021');
    perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
    select balance into b0 from wallets where user_id = cust;
    r := to_jsonb(travel_offer_accept(tofr.id));
    select balance into b1 from wallets where user_id = cust;
    perform set_config('request.jwt.claims', json_build_object('sub', drv2, 'role', 'authenticated')::text, true);
    perform travel_request_set_status(tr.id, 'ongoing', null);
    perform travel_request_set_status(tr.id, 'completed', null);
    perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
    perform travel_request_rate(tr.id, 5, 'Sopir ramah');
    j := travel_request_detail(tr.id);
    log := log || format('S11 OK travel charter %s status=%s harga=%s cust -%s', tr.code, j->>'status', tofr.price, b0 - b1) || E'\n';
  exception when others then log := log || 'S11 BUG travel charter: ' || sqlerrm || E'\n'; end;

  -- ===== S12 Dompet: top up manual → admin setujui; penarikan otomatis & manual (PIN admin) =====
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
    select balance into b0 from wallets where user_id = cust;
    tp := request_topup(100000, 'bank_transfer', 'https://x/bukti.jpg', 'uji');
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    perform admin_review_topup(tp.id, true, 'ok');
    select balance into b1 from wallets where user_id = cust;
    log := log || format('S12a %s topup manual +%s', case when b1 - b0 = 100000 then 'OK' else 'BUG' end, b1 - b0) || E'\n';
    insert into bank_accounts (user_id, bank_name, account_no, holder, verified) values (drv, 'BCA', '111', 'Driver', true) on conflict (user_id) do update set verified = true, bank_name = 'BCA', account_no = '111';
    perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
    w := request_withdrawal(50000, 'BCA', '111', 'Driver');
    log := log || format('S12b %s penarikan saat ada flag fraud terbuka → manual (status=%s auto=%s)', case when not w.auto then 'OK' else 'BUG' end, w.status, w.auto) || E'\n';
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    for f in select * from fraud_flags where subject_id = drv and status = 'open' loop perform admin_review_fraud(f.id, 'dismissed', 'uji', false); end loop;
    perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
    w := request_withdrawal(40000, 'BCA', '111', 'Driver');
    log := log || format('S12b2 %s penarikan otomatis setelah flag ditutup status=%s auto=%s', case when w.auto then 'OK' else 'BUG' end, w.status, w.auto) || E'\n';
    perform set_config('request.jwt.claims', json_build_object('sub', drv2, 'role', 'authenticated')::text, true);
    w := request_withdrawal(50000, 'BNI', '222', 'Driver 2');
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    update admin_security set pin_hash = extensions.crypt('123456', extensions.gen_salt('bf')), failed = 0, locked_until = null where user_id = adm;
    insert into admin_security (user_id, pin_hash) select adm, extensions.crypt('123456', extensions.gen_salt('bf')) where not exists (select 1 from admin_security where user_id = adm);
    perform admin_lock();
    begin perform admin_review_withdrawal(w.id, true, 'ok'); log := log || 'S12c BUG: review tanpa PIN diterima' || E'\n'; exception when others then log := log || 'S12c OK terkunci: ' || left(sqlerrm, 40) || E'\n'; end;
    r := admin_unlock('123456');
    w := admin_review_withdrawal(w.id, true, 'ok');
    log := log || format('S12d %s penarikan manual status=%s rekening terverifikasi=%s', case when w.status = 'approved' then 'OK' else 'BUG' end, w.status, (select verified from bank_accounts where user_id = drv2)) || E'\n';
  exception when others then log := log || 'S12 BUG dompet: ' || sqlerrm || E'\n'; end;

  -- ===== S13 Tiket CS & SOS =====
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
    t := create_ticket(jsonb_build_object('subject', 'Driver kasar', 'category', 'driver', 'body', 'Uji aduan'));
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    perform ticket_reply(t.id, 'Kami tindak lanjuti', null, false);
    perform admin_update_ticket(t.id, 'resolved', 'high', adm, 'ditindak');
    perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
    perform close_ticket(t.id, 5, 'cepat');
    r := to_jsonb(sos_trigger(null, 0.5, 101.44, 'uji sos'));
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    perform admin_handle_sos((r->>'id')::uuid, 'handled', 'uji');
    j := cs_stats();
    log := log || format('S13 OK tiket %s ditutup rating 5; SOS ditangani; cs_stats=%s', t.id, left(j::text, 60)) || E'\n';
  exception when others then log := log || 'S13 BUG CS/SOS: ' || sqlerrm || E'\n'; end;

  -- ===== S14 Pesanan terjadwal =====
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
    o := create_order(jsonb_build_object('service', 'ride_motor', 'scheduled_at', (now() + interval '45 minutes')::text, 'pickup', jsonb_build_object('lat', 0.4810, 'lng', 101.4349, 'address', 'A'), 'dropoff', jsonb_build_object('lat', 0.49, 'lng', 101.44, 'address', 'B'), 'paid_via', 'wallet'));
    n := release_scheduled_orders();
    log := log || format('S14 %s terjadwal status=%s scheduled_at=%s dirilis sekarang=%s', case when o.status = 'scheduled' then 'OK' else 'BUG' end, o.status, o.scheduled_at, n) || E'\n';
    perform cancel_order(o.id, 'uji');
  exception when others then log := log || 'S14 BUG terjadwal: ' || sqlerrm || E'\n'; end;

  -- ===== S15 Admin: statistik, blast, kelas driver, gateway, otomasi, eksekutif =====
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    j := admin_dashboard_stats(); r := admin_traffic_stats(3);
    perform admin_blast_promo(jsonb_build_object('title', 'Uji blast', 'body', 'Diskon uji', 'promo_code', 'ANTARBARU', 'merchant_id', merch, 'audience', 'all'));
    perform admin_set_driver_class(drv2, 'car_standard');
    j := admin_gateway_status(); r := admin_automation_status();
    j := exec_report_data(3);
    log := log || format('S15 OK admin stats ok; blast ok; kelas driver=%s; gateway configured=%s; otomasi pending=%s; exec rekomendasi=%s', (select vehicle_class from drivers where id = drv2), j->>'configured', r->'pending', jsonb_array_length((exec_report_data(3))->'recommendations')) || E'\n';
  exception when others then log := log || 'S15 BUG admin: ' || sqlerrm || E'\n'; end;

  -- ===== S16 Harga dinamis: 3 order mencari driver tanpa driver online =====
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
    perform driver_set_online(false, 0.4810, 101.4349);
    perform set_config('request.jwt.claims', json_build_object('sub', drv2, 'role', 'authenticated')::text, true);
    perform driver_set_online(false, 0.4946, 101.4314);
    perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
    j := estimate_fare('ride_motor', 0.4810, 101.4349, 0.49, 101.44, null);
    for n in 1..2 loop
      o := create_order(jsonb_build_object('service', 'ride_motor', 'pickup', jsonb_build_object('lat', 0.4810, 'lng', 101.4349, 'address', 'A'), 'dropoff', jsonb_build_object('lat', 0.49, 'lng', 101.44, 'address', 'B'), 'paid_via', 'cash'));
    end loop;
    r := estimate_fare('ride_motor', 0.4810, 101.4349, 0.49, 101.44, null);
    log := log || format('S16 %s harga dinamis: sebelum=%s sesudah=%s demand=%s', case when (r->>'fare')::bigint > (j->>'fare')::bigint then 'OK' else 'BUG' end, j->>'fare', r->>'fare', r->'demand') || E'\n';
    -- S17 fallback kelas: order Standar berumur >3 menit boleh diambil driver Hemat
    update orders set created_at = now() - interval '4 minutes' where id = o.id;
    perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
    perform driver_set_online(true, 0.4810, 101.4349);
    o := driver_accept_order(o.id);
    log := log || format('S17 %s fallback kelas: order %s (kelas %s) diambil driver Hemat setelah 4 menit', case when o.driver_id = drv then 'OK' else 'BUG' end, o.code, o.vehicle_class) || E'\n';
  exception when others then log := log || 'S16/17 BUG: ' || sqlerrm || E'\n'; end;

  -- ===== S18 Batas jarak per layanan (dalam kota vs antar kota) =====
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
    -- motor dalam kota Pekanbaru (< 25 km) → boleh
    j := estimate_fare('ride_motor', 0.4810, 101.4349, 0.50, 101.44, null);
    log := log || format('S18a %s motor dalam kota %s km limit.ok=%s max=%s', case when (j->'limit'->>'ok')::boolean then 'OK' else 'BUG' end, j->>'distance_km', j->'limit'->>'ok', j->'limit'->>'max_km') || E'\n';
    -- motor Pekanbaru → Padang (≈300 km, kota berbeda) → ditolak dengan pesan
    j := estimate_fare('ride_motor', 0.507, 101.448, -0.947, 100.354, null);
    log := log || format('S18b %s motor Pekanbaru→Padang %s km limit.ok=%s same_city=%s pesan=%s', case when not (j->'limit'->>'ok')::boolean and j->'limit'->>'message' is not null then 'OK' else 'BUG' end, j->>'distance_km', j->'limit'->>'ok', j->'limit'->>'same_city', left(j->'limit'->>'message', 70)) || E'\n';
    -- motor masih satu kota tapi > 25 km (Pekanbaru utara) → ditolak karena jarak
    j := estimate_fare('ride_motor', 0.507, 101.448, 0.70, 101.448, null);
    log := log || format('S18c %s motor satu kota %s km limit.ok=%s same_city=%s pesan=%s', case when not (j->'limit'->>'ok')::boolean and (j->'limit'->>'same_city')::boolean then 'OK' else 'BUG' end, j->>'distance_km', j->'limit'->>'ok', j->'limit'->>'same_city', left(j->'limit'->>'message', 60)) || E'\n';
    -- create_order motor antar kota harus DITOLAK
    begin
      o := create_order(jsonb_build_object('service', 'ride_motor', 'pickup', jsonb_build_object('lat', 0.507, 'lng', 101.448, 'address', 'Pekanbaru'), 'dropoff', jsonb_build_object('lat', -0.947, 'lng', 100.354, 'address', 'Padang'), 'paid_via', 'cash'));
      log := log || format('S18d BUG: order motor antar kota diterima %s (%s km)', o.code, o.distance_km) || E'\n'; perform cancel_order(o.id, 'uji');
    exception when others then log := log || 'S18d OK motor antar kota ditolak: ' || left(sqlerrm, 90) || E'\n'; end;
    -- send dalam kota (< 35 km) → boleh
    o := create_order(jsonb_build_object('service', 'send', 'pickup', jsonb_build_object('lat', 0.4810, 'lng', 101.4349, 'address', 'Toko A'), 'dropoff', jsonb_build_object('lat', 0.52, 'lng', 101.45, 'address', 'Rumah B'), 'recipient_name', 'Siti', 'recipient_phone', '0813', 'paid_via', 'cash'));
    log := log || format('S18e OK send dalam kota %s %s km status=%s', o.code, o.distance_km, o.status) || E'\n';
    perform cancel_order(o.id, 'uji');
    -- send antar kota lewat jalur gudang (scope intercity) → check_service_distance selalu ok walau 300 km
    j := check_service_distance('send', 300, 0.507, 101.448, -0.947, 100.354, 'intercity');
    log := log || format('S18f %s send antar kota scope=intercity 300 km ok=%s same_city_required=%s', case when (j->>'ok')::boolean then 'OK' else 'BUG' end, j->>'ok', j->>'same_city_required') || E'\n';
    -- food > 15 km (merchant Padang → Lubuk Buaya utara) → ditolak
    begin
      o := create_order(jsonb_build_object('service', 'food', 'merchant_id', merch, 'items', jsonb_build_array(jsonb_build_object('menu_item_id', menu1, 'qty', 1)), 'dropoff', jsonb_build_object('lat', -0.80, 'lng', 100.36, 'address', 'Jauh'), 'paid_via', 'cash'));
      log := log || format('S18g BUG: food %s km diterima %s', o.distance_km, o.code) || E'\n'; perform cancel_order(o.id, 'uji');
    exception when others then log := log || 'S18g OK food > 15 km ditolak: ' || left(sqlerrm, 80) || E'\n'; end;
  exception when others then log := log || 'S18 BUG batas jarak: ' || sqlerrm || E'\n'; end;

  -- ===== S19 Toggle layanan oleh admin (shop off → order ditolak → on → order OK) =====
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    r := admin_set_service_enabled('shop', false);
    j := app_public_settings();
    log := log || format('S19a %s shop dinonaktifkan services_enabled.shop=%s (public=%s)', case when (j->'services_enabled'->>'shop')::boolean = false then 'OK' else 'BUG' end, r->>'shop', j->'services_enabled'->>'shop') || E'\n';
    perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
    begin
      o := create_order(jsonb_build_object('service', 'shop', 'shop_store_id', store1, 'shop_vehicle', 'motor', 'shopping_list', jsonb_build_array(jsonb_build_object('product_id', prod1, 'qty', 1)), 'dropoff', jsonb_build_object('lat', 0.52, 'lng', 101.45, 'address', 'Rumah'), 'paid_via', 'cash'));
      log := log || format('S19b BUG: order shop diterima padahal layanan nonaktif %s', o.code) || E'\n'; perform cancel_order(o.id, 'uji');
    exception when others then log := log || format('S19b %s order shop saat nonaktif ditolak: %s', case when sqlerrm ilike '%nonaktif%' then 'OK' else 'BUG' end, left(sqlerrm, 70)) || E'\n'; end;
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    r := admin_set_service_enabled('shop', true);
    perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
    o := create_order(jsonb_build_object('service', 'shop', 'shop_store_id', store1, 'shop_vehicle', 'motor', 'shopping_list', jsonb_build_array(jsonb_build_object('product_id', prod1, 'qty', 1)), 'dropoff', jsonb_build_object('lat', 0.52, 'lng', 101.45, 'address', 'Rumah'), 'paid_via', 'cash'));
    log := log || format('S19c %s shop diaktifkan lagi services_enabled.shop=%s → order %s status=%s', case when (r->>'shop')::boolean then 'OK' else 'BUG' end, r->>'shop', o.code, o.status) || E'\n';
    perform cancel_order(o.id, 'uji');
    -- layanan tak dikenal & non-admin harus ditolak
    begin r := admin_set_service_enabled('shop', false); log := log || 'S19d BUG: pelanggan bisa mematikan layanan' || E'\n'; exception when others then log := log || 'S19d OK non-admin ditolak: ' || left(sqlerrm, 40) || E'\n'; end;
  exception when others then log := log || 'S19 BUG toggle layanan: ' || sqlerrm || E'\n'; end;

  -- ===== S20 Impor tempat dari peta (OSM) oleh pelanggan → toko/pasar aktif, dedup osm_id & jarak+nama =====
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
    j := jsonb_build_array(
      jsonb_build_object('osm_id', 'uji/n/1001', 'name', 'Alfamart Arifin Ahmad', 'brand', 'alfamart', 'category', 'minimarket', 'lat', 0.4900, 'lng', 101.4450, 'address', 'Jl. Arifin Ahmad', 'open_hours', '06:00-23:00'),
      jsonb_build_object('osm_id', 'uji/n/1002', 'name', 'Indomaret Tuanku Tambusai', 'brand', 'indomaret', 'category', 'minimarket', 'lat', 0.5050, 'lng', 101.4300, 'address', 'Jl. Tuanku Tambusai', 'open_hours', '24 jam'),
      jsonb_build_object('osm_id', 'uji/n/1003', 'name', 'Apotek K-24 Sudirman', 'brand', 'apotek', 'category', 'apotek', 'lat', 0.5120, 'lng', 101.4480, 'address', 'Jl. Jend. Sudirman', 'open_hours', '24 jam'));
    select count(*) into b0 from shop_stores;
    r := import_places('store', j);
    select count(*) into b1 from shop_stores;
    log := log || format('S20a %s impor 3 toko inserted=%s skipped=%s (baris shop_stores %s→%s)', case when (r->>'inserted')::int = 3 and b1 - b0 = 3 then 'OK' else 'BUG' end, r->>'inserted', r->>'skipped', b0, b1) || E'\n';
    r := import_places('store', j);
    log := log || format('S20b %s impor ulang osm_id sama inserted=%s skipped=%s', case when (r->>'inserted')::int = 0 and (r->>'skipped')::int = 3 then 'OK' else 'BUG' end, r->>'inserted', r->>'skipped') || E'\n';
    -- 30 m dari Indomaret Sudirman Pekanbaru dengan nama mirip → dianggap duplikat
    r := import_places('store', jsonb_build_array(jsonb_build_object('osm_id', 'uji/n/1004', 'name', 'Indomaret Sudirman', 'lat', 0.51707, 'lng', 101.4463)));
    log := log || format('S20c %s toko 30 m dari toko lama nama mirip inserted=%s skipped=%s', case when (r->>'inserted')::int = 0 and (r->>'skipped')::int = 1 then 'OK' else 'BUG' end, r->>'inserted', r->>'skipped') || E'\n';
    select count(*) into n from shop_stores where osm_id like 'uji/n/%' and catalog_source = 'osm' and active and city_id = (select id from cities where name = 'Pekanbaru');
    log := log || format('S20d %s baris osm aktif kota Pekanbaru=%s brand=%s', case when n = 3 then 'OK' else 'BUG' end, n, (select string_agg(brand || '/' || category, ',' order by osm_id) from shop_stores where osm_id like 'uji/n/%')) || E'\n';
    select count(*) into m0 from markets;
    r := import_places('market', jsonb_build_array(jsonb_build_object('osm_id', 'uji/m/2001', 'name', 'Pasar Sukaramai', 'lat', 0.495, 'lng', 101.435, 'address', 'Jl. Sukaramai', 'open_hours', '05:00-13:00')));
    select count(*) into m1 from markets;
    log := log || format('S20e %s impor 1 pasar inserted=%s skipped=%s aktif=%s catatan=%s', case when (r->>'inserted')::int = 1 and m1 - m0 = 1 then 'OK' else 'BUG' end, r->>'inserted', r->>'skipped', (select active from markets where osm_id = 'uji/m/2001'), (select notes from markets where osm_id = 'uji/m/2001')) || E'\n';
    r := import_places('market', jsonb_build_array(jsonb_build_object('osm_id', 'uji/m/2001', 'name', 'Pasar Sukaramai', 'lat', 0.495, 'lng', 101.435)));
    log := log || format('S20f %s impor ulang pasar skipped=%s', case when (r->>'skipped')::int = 1 then 'OK' else 'BUG' end, r->>'skipped') || E'\n';
    begin r := import_places('warung', '[]'::jsonb); log := log || 'S20g BUG: jenis tidak valid diterima' || E'\n'; exception when others then log := log || 'S20g OK jenis tidak valid ditolak: ' || sqlerrm || E'\n'; end;
  exception when others then log := log || 'S20 BUG impor tempat: ' || sqlerrm || E'\n'; end;

  -- ===== S21 register_driver v2: validasi bahan bakar/merek, simpan model & fuel_type, is_electric otomatis =====
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
    if exists (select 1 from drivers where id = cust) then log := log || 'S21 note: pelanggan uji sudah punya baris driver' || E'\n'; end if;
    begin
      perform register_driver(jsonb_build_object('vehicle_type', 'motor', 'vehicle_brand', 'Honda', 'vehicle_model', 'BeAT', 'fuel_type', 'diesel', 'vehicle_plate', 'bm 1234 xx', 'vehicle_year', 2021));
      log := log || 'S21a BUG: motor diesel diterima' || E'\n';
    exception when others then log := log || 'S21a OK motor diesel ditolak: ' || sqlerrm || E'\n'; end;
    begin
      perform register_driver(jsonb_build_object('vehicle_type', 'motor', 'vehicle_brand', '', 'vehicle_model', 'BeAT', 'fuel_type', 'bensin', 'vehicle_plate', 'bm 1234 xx', 'vehicle_year', 2021));
      log := log || 'S21b BUG: merek kosong diterima' || E'\n';
    exception when others then log := log || 'S21b OK merek kosong ditolak: ' || sqlerrm || E'\n'; end;
    begin
      perform register_driver(jsonb_build_object('vehicle_type', 'motor', 'vehicle_brand', 'Honda', 'vehicle_model', 'BeAT', 'fuel_type', 'solar', 'vehicle_plate', 'bm 1234 xx'));
      log := log || 'S21c BUG: bahan bakar "solar" diterima' || E'\n';
    exception when others then log := log || 'S21c OK bahan bakar tak dikenal ditolak: ' || sqlerrm || E'\n'; end;
    -- valid: Honda BeAT bensin 2021
    r := to_jsonb(register_driver(jsonb_build_object('vehicle_type', 'motor', 'vehicle_brand', 'Honda', 'vehicle_model', 'BeAT', 'fuel_type', 'bensin', 'vehicle_plate', 'bm 1234 xx', 'vehicle_color', 'Hitam', 'vehicle_year', 2021, 'vehicle_condition', 'baik', 'license_number', 'SIM-C-001', 'id_card_number', '1471000000000001', 'photo_id_url', 'https://x/ktp.jpg', 'photo_vehicle_url', 'https://x/motor.jpg')));
    log := log || format('S21d %s daftar motor Honda BeAT bensin: brand=%s model=%s fuel=%s listrik=%s plat=%s kelas=%s status=%s role=%s',
      case when r->>'vehicle_model' = 'BeAT' and r->>'fuel_type' = 'bensin' and (r->>'is_electric')::boolean = false and r->>'vehicle_plate' = 'BM 1234 XX' and (select role::text from profiles where id = cust) = 'driver' then 'OK' else 'BUG' end,
      r->>'vehicle_brand', r->>'vehicle_model', r->>'fuel_type', r->>'is_electric', r->>'vehicle_plate', r->>'vehicle_class', r->>'status', (select role from profiles where id = cust)) || E'\n';
    -- ganti ke motor listrik Gesits G1 → is_electric harus true otomatis
    r := to_jsonb(register_driver(jsonb_build_object('vehicle_type', 'motor', 'vehicle_brand', 'Gesits', 'vehicle_model', 'G1', 'fuel_type', 'listrik', 'vehicle_plate', 'bm 5678 ev', 'vehicle_year', 2024, 'license_number', 'SIM-C-001', 'id_card_number', '1471000000000001')));
    log := log || format('S21e %s ganti Gesits G1 listrik: model=%s fuel=%s listrik=%s kelas=%s dokumen tersimpan=%s',
      case when (r->>'is_electric')::boolean and r->>'fuel_type' = 'listrik' and (select vehicle_model from drivers where id = cust) = 'G1' then 'OK' else 'BUG' end,
      r->>'vehicle_model', r->>'fuel_type', r->>'is_electric', r->>'vehicle_class', (select license_number from driver_documents where driver_id = cust)) || E'\n';
    -- is_electric=true dikirim klien tapi fuel bensin → fuel menang (false)
    r := to_jsonb(register_driver(jsonb_build_object('vehicle_type', 'motor', 'vehicle_brand', 'Yamaha', 'vehicle_model', 'NMAX', 'fuel_type', 'bensin', 'is_electric', true, 'vehicle_plate', 'bm 9999 zz', 'vehicle_year', 2022)));
    log := log || format('S21f %s fuel bensin + is_electric=true dari klien → is_electric=%s', case when (r->>'is_electric')::boolean = false then 'OK' else 'BUG' end, r->>'is_electric') || E'\n';
  exception when others then log := log || 'S21 BUG register_driver: ' || sqlerrm || E'\n'; end;

  -- ===== S22 Radius jemput dinamis per layanan (app_settings.pickup_radius_km) =====
  begin
    -- pastikan akun uji bersih & aktif (semua tetap di-rollback)
    update orders set status = 'cancelled' where customer_id = cust and status in ('searching','accepted','arrived','in_progress');
    update orders set status = 'cancelled' where driver_id in (drv, drv2) and status in ('accepted','arrived','in_progress');
    perform set_config('antaraja.bypass', 'on', true);
    update drivers set status = 'approved' where id in (drv, drv2);
    perform set_config('antaraja.bypass', 'off', true);
    select value into s_rad0 from app_settings where key = 'pickup_radius_km';
    select value into s_tier0 from app_settings where key = 'priority_tiers';
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    -- selama uji dispatch semua driver melihat order seketika; antrean prioritas diuji khusus di S24
    perform admin_set_settings(jsonb_build_object('priority_tiers', '[{"min_rating":0,"delay_s":0}]'::jsonb,
                                                  'pickup_radius_km', s_rad0 || '{"ride_motor":1}'::jsonb));
    perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
    perform driver_selfie_check('https://x/selfie.jpg'); perform driver_set_online(true, 0.4946, 101.4314);
    perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
    -- titik jemput ~7 km di utara posisi driver uji
    o := create_order(jsonb_build_object('service', 'ride_motor', 'vehicle_class', 'motor_economy',
      'pickup', jsonb_build_object('lat', 0.5600, 'lng', 101.4314, 'address', 'Jl. Uji Radius'),
      'dropoff', jsonb_build_object('lat', 0.5650, 'lng', 101.4400, 'address', 'Tujuan Uji'), 'paid_via', 'cash'));
    perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
    select round((st_distance(o.pickup_location, d.location) / 1000.0)::numeric, 2) into s_km from drivers d where d.id = drv;
    select count(*) into n from driver_available_orders() av where av.id = o.id;
    log := log || format('S22a %s radius ride_motor=1 km, jarak driver→jemput=%s km → baris di feed driver=%s (harus 0)', case when n = 0 then 'OK' else 'BUG' end, s_km, n) || E'\n';
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    perform admin_set_settings(jsonb_build_object('pickup_radius_km', s_rad0 || '{"ride_motor":20}'::jsonb));
    perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
    select count(*) into n2 from driver_available_orders() av where av.id = o.id;
    log := log || format('S22b %s radius dinaikkan jadi %s km → order muncul (%s baris)', case when n2 = 1 then 'OK' else 'BUG' end, pickup_radius_km('ride_motor'), n2) || E'\n';
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    perform admin_set_settings(jsonb_build_object('pickup_radius_km', s_rad0));
    perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
    select count(*) into n3 from driver_available_orders() av where av.id = o.id;
    log := log || format('S22c %s radius dikembalikan ke setelan semula (%s km) → order di luar jangkauan lagi (%s baris)', case when n3 = 0 then 'OK' else 'BUG' end, s_rad0->>'ride_motor', n3) || E'\n';
    perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
    perform cancel_order(o.id, 'uji radius selesai');
  exception when others then log := log || 'S22 BUG radius dinamis: ' || sqlerrm || E'\n'; end;

  -- ===== S23 Tombol TOLAK di aplikasi Mitra (order_rejections) =====
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
    perform driver_set_online(true, 0.4946, 101.4314);
    perform set_config('request.jwt.claims', json_build_object('sub', drv2, 'role', 'authenticated')::text, true);
    perform driver_selfie_check('https://x/selfie.jpg'); perform driver_set_online(true, 0.4946, 101.4314);
    perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
    o := create_order(jsonb_build_object('service', 'send', 'weight_kg', 5, 'size_cm', 40,
      'pickup', jsonb_build_object('lat', 0.4950, 'lng', 101.4320, 'address', 'Toko Uji Tolak'),
      'dropoff', jsonb_build_object('lat', 0.5000, 'lng', 101.4400, 'address', 'Rumah Uji'),
      'recipient_name', 'Sari', 'recipient_phone', '0811', 'paid_via', 'cash'));
    perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
    select count(*) into n from driver_available_orders() av where av.id = o.id;
    perform set_config('request.jwt.claims', json_build_object('sub', drv2, 'role', 'authenticated')::text, true);
    select count(*) into n2 from driver_available_orders() av where av.id = o.id;
    log := log || format('S23a %s sebelum ditolak order %s terlihat driver1=%s driver2=%s', case when n = 1 and n2 = 1 then 'OK' else 'BUG' end, o.code, n, n2) || E'\n';
    perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
    r := driver_reject_order(o.id, 'terlalu jauh');
    select count(*) into n from driver_available_orders() av where av.id = o.id;
    perform set_config('request.jwt.claims', json_build_object('sub', drv2, 'role', 'authenticated')::text, true);
    select count(*) into n2 from driver_available_orders() av where av.id = o.id;
    select count(*) into n3 from order_rejections where order_id = o.id and driver_id = drv and reason = 'terlalu jauh';
    log := log || format('S23b %s setelah driver1 menolak: feed driver1=%s (harus 0) feed driver2=%s (harus 1) baris order_rejections=%s alasan="%s" tolakan 24 jam=%s',
      case when n = 0 and n2 = 1 and n3 = 1 then 'OK' else 'BUG' end, n, n2, n3,
      (select reason from order_rejections where order_id = o.id and driver_id = drv), r->>'rejections_today') || E'\n';
    -- driver yang sudah memegang order tidak boleh memakai tombol tolak
    perform set_config('request.jwt.claims', json_build_object('sub', drv2, 'role', 'authenticated')::text, true);
    o := driver_accept_order(o.id);
    begin perform driver_reject_order(o.id, 'coba tolak order sendiri'); log := log || 'S23c BUG: driver pemegang order bisa menolak' || E'\n';
    exception when others then log := log || 'S23c OK order yang sudah diterima tidak bisa ditolak: ' || left(sqlerrm, 60) || E'\n'; end;
    o := cancel_order(o.id, 'uji selesai');
    perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
    perform cancel_order(o.id, 'uji tombol tolak selesai');
  exception when others then log := log || 'S23 BUG tombol tolak: ' || sqlerrm || E'\n'; end;

  -- ===== S24 Antrean prioritas driver berdasarkan rating (priority_tiers) =====
  begin
    select rating_avg, rating_count into s_dr1, s_dc1 from drivers where id = drv;
    select rating_avg, rating_count into s_dr2, s_dc2 from drivers where id = drv2;
    perform set_config('antaraja.bypass', 'on', true);
    update drivers set rating_avg = 4.20, rating_count = 30 where id = drv;    -- driver rating rendah
    update drivers set rating_avg = 4.90, rating_count = 64 where id = drv2;   -- driver rating tinggi
    perform set_config('antaraja.bypass', 'off', true);
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    perform admin_set_settings(jsonb_build_object('priority_tiers', '[{"min_rating":4.8,"delay_s":0},{"min_rating":0,"delay_s":60}]'::jsonb));
    select driver_priority_delay_s(4.20, 30), driver_priority_delay_s(4.90, 64) into n, n2;
    perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
    perform driver_set_online(true, 0.4946, 101.4314); j := driver_priority_info();
    perform set_config('request.jwt.claims', json_build_object('sub', drv2, 'role', 'authenticated')::text, true);
    perform driver_set_online(true, 0.4946, 101.4314); j1 := driver_priority_info();
    log := log || format('S24a %s driver_priority_delay_s rating 4.20=%s dtk & rating 4.90=%s dtk (driver_priority_info: %s dtk vs %s dtk, drivers_ahead driver rating rendah=%s, next_tier=%s)',
      case when n = 60 and n2 = 0 and (j->>'tier_delay_s')::int = 60 and (j1->>'tier_delay_s')::int = 0 then 'OK' else 'BUG' end,
      n, n2, j->>'tier_delay_s', j1->>'tier_delay_s', j->>'drivers_ahead', j->>'next_tier_rating') || E'\n';
    perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
    o := create_order(jsonb_build_object('service', 'send', 'weight_kg', 3, 'size_cm', 30,
      'pickup', jsonb_build_object('lat', 0.4950, 'lng', 101.4320, 'address', 'Toko Uji Prioritas'),
      'dropoff', jsonb_build_object('lat', 0.5000, 'lng', 101.4400, 'address', 'Rumah Uji'),
      'recipient_name', 'Sari', 'recipient_phone', '0811', 'paid_via', 'cash'));
    perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
    select count(*) into n from driver_available_orders() av where av.id = o.id;
    perform set_config('request.jwt.claims', json_build_object('sub', drv2, 'role', 'authenticated')::text, true);
    select count(*) into n2 from driver_available_orders() av where av.id = o.id;
    log := log || format('S24b %s order %s baru dibuat: feed driver rating rendah=%s (harus 0) feed driver rating tinggi=%s (harus 1)', case when n = 0 and n2 = 1 then 'OK' else 'BUG' end, o.code, n, n2) || E'\n';
    update orders set created_at = now() - interval '2 minutes' where id = o.id;   -- order "dituakan" 2 menit
    perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
    select count(*) into n from driver_available_orders() av where av.id = o.id;
    select f.priority_note, f.waiting_minutes into k1, s_wait from driver_available_orders() av where av.id = o.id;
    perform set_config('request.jwt.claims', json_build_object('sub', drv2, 'role', 'authenticated')::text, true);
    select count(*) into n2 from driver_available_orders() av where av.id = o.id;
    log := log || format('S24c %s setelah order berumur 2 menit: feed rating rendah=%s feed rating tinggi=%s waiting_minutes=%s priority_note="%s"',
      case when n = 1 and n2 = 1 then 'OK' else 'BUG' end, n, n2, s_wait, coalesce(k1, '(null)')) || E'\n';
    perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
    perform cancel_order(o.id, 'uji prioritas selesai');
    -- pulihkan rating driver uji; tier tetap 0 detik untuk skenario dispatch berikutnya
    perform set_config('antaraja.bypass', 'on', true);
    update drivers set rating_avg = s_dr1, rating_count = s_dc1 where id = drv;
    update drivers set rating_avg = s_dr2, rating_count = s_dc2 where id = drv2;
    perform set_config('antaraja.bypass', 'off', true);
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    perform admin_set_settings(jsonb_build_object('priority_tiers', '[{"min_rating":0,"delay_s":0}]'::jsonb));
  exception when others then log := log || 'S24 BUG prioritas rating: ' || sqlerrm || E'\n'; end;

  -- ===== S25 Matriks layanan↔kendaraan & batas berat/dimensi AntarSend =====
  begin
    select * into dm from drivers where id = drv; select * into dc from drivers where id = drv2; select * into db from drivers where id = dbox;
    log := log || format('S25 kendaraan uji: motor=%s mobil=%s box=%s | batas motor=%s car=%s box=%s travel=%s',
      dm.vehicle_type, dc.vehicle_type, db.vehicle_type, send_limit('motor'), send_limit('car'), send_limit('box'), send_limit('travel')) || E'\n';
    perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
    o := create_order(jsonb_build_object('service', 'send', 'weight_kg', 5, 'size_cm', 40,
      'pickup', jsonb_build_object('lat', 0.4950, 'lng', 101.4320, 'address', 'Toko A'),
      'dropoff', jsonb_build_object('lat', 0.5000, 'lng', 101.4400, 'address', 'Rumah B'), 'recipient_name', 'Sari', 'recipient_phone', '0811', 'paid_via', 'cash'));
    select driver_can_take(dm, o), driver_can_take(dc, o), driver_can_take(db, o) into bo, bo2, bo3;
    log := log || format('S25a %s send 5 kg/40 cm (kendaraan minimal: %s) → motor=%s mobil=%s box=%s', case when bo and bo2 and bo3 then 'OK' else 'BUG' end, send_required_vehicle(5, 40), bo, bo2, bo3) || E'\n';
    perform cancel_order(o.id, 'uji matriks');
    o := create_order(jsonb_build_object('service', 'send', 'weight_kg', 80, 'size_cm', 150,
      'pickup', jsonb_build_object('lat', 0.4950, 'lng', 101.4320, 'address', 'Toko A'),
      'dropoff', jsonb_build_object('lat', 0.5000, 'lng', 101.4400, 'address', 'Rumah B'), 'recipient_name', 'Sari', 'recipient_phone', '0811', 'paid_via', 'cash'));
    select driver_can_take(dm, o), driver_can_take(dc, o), driver_can_take(db, o) into bo, bo2, bo3;
    log := log || format('S25b %s send 80 kg/150 cm (kendaraan minimal: %s) → motor=%s (harus false) mobil=%s box=%s', case when not bo and bo2 and bo3 then 'OK' else 'BUG' end, send_required_vehicle(80, 150), bo, bo2, bo3) || E'\n';
    perform cancel_order(o.id, 'uji matriks');
    o := create_order(jsonb_build_object('service', 'send', 'weight_kg', 500, 'size_cm', 250,
      'pickup', jsonb_build_object('lat', 0.4950, 'lng', 101.4320, 'address', 'Toko A'),
      'dropoff', jsonb_build_object('lat', 0.5000, 'lng', 101.4400, 'address', 'Rumah B'), 'recipient_name', 'Sari', 'recipient_phone', '0811', 'paid_via', 'cash'));
    select driver_can_take(dm, o), driver_can_take(dc, o), driver_can_take(db, o) into bo, bo2, bo3;
    log := log || format('S25c %s send 500 kg/250 cm (kendaraan minimal: %s) → motor=%s mobil=%s (harus false) box=%s (harus true)', case when not bo and not bo2 and bo3 then 'OK' else 'BUG' end, send_required_vehicle(500, 250), bo, bo2, bo3) || E'\n';
    perform cancel_order(o.id, 'uji matriks');
    begin
      o := create_order(jsonb_build_object('service', 'send', 'weight_kg', 5000, 'size_cm', 400,
        'pickup', jsonb_build_object('lat', 0.4950, 'lng', 101.4320, 'address', 'Toko A'),
        'dropoff', jsonb_build_object('lat', 0.5000, 'lng', 101.4400, 'address', 'Rumah B'), 'recipient_name', 'Sari', 'recipient_phone', '0811', 'paid_via', 'cash'));
      log := log || 'S25d BUG: paket 5000 kg/400 cm diterima create_order' || E'\n';
    exception when others then
      log := log || format('S25d %s paket 5000 kg/400 cm ditolak create_order: %s', case when sqlerrm ilike '%AntarBox%' then 'OK' else 'BUG (pesan tidak menyarankan AntarBox)' end, sqlerrm) || E'\n';
    end;
    o := create_order(jsonb_build_object('service', 'ride_car', 'vehicle_class', 'car_economy',
      'pickup', jsonb_build_object('lat', 0.4950, 'lng', 101.4320, 'address', 'Rumah'),
      'dropoff', jsonb_build_object('lat', 0.5100, 'lng', 101.4450, 'address', 'Mall'), 'paid_via', 'cash'));
    select driver_can_take(dm, o), driver_can_take(dc, o) into bo, bo2;
    log := log || format('S25e %s ride_car → driver motor=%s (harus false) driver mobil=%s (harus true)', case when not bo and bo2 then 'OK' else 'BUG' end, bo, bo2) || E'\n';
    perform cancel_order(o.id, 'uji matriks');
    o := create_order(jsonb_build_object('service', 'ride_motor', 'vehicle_class', 'motor_economy',
      'pickup', jsonb_build_object('lat', 0.4950, 'lng', 101.4320, 'address', 'Rumah'),
      'dropoff', jsonb_build_object('lat', 0.5100, 'lng', 101.4450, 'address', 'Mall'), 'paid_via', 'cash'));
    select driver_can_take(dm, o), driver_can_take(dc, o), driver_can_take(db, o) into bo, bo2, bo3;
    log := log || format('S25f %s ride_motor → motor=%s (harus true) mobil=%s (harus false) box=%s (harus false)', case when bo and not bo2 and not bo3 then 'OK' else 'BUG' end, bo, bo2, bo3) || E'\n';
    perform cancel_order(o.id, 'uji matriks');
    o := create_order(jsonb_build_object('service', 'food', 'merchant_id', merch,
      'items', jsonb_build_array(jsonb_build_object('menu_item_id', menu1, 'qty', 1)),
      'dropoff', jsonb_build_object('lat', -0.945, 'lng', 100.36, 'address', 'Kos Andalas'), 'paid_via', 'cash'));
    select driver_can_take(dm, o), driver_can_take(dc, o), driver_can_take(db, o) into bo, bo2, bo3;
    log := log || format('S25g %s food → motor=%s mobil=%s (dua-duanya harus true) box=%s (harus false)', case when bo and bo2 and not bo3 then 'OK' else 'BUG' end, bo, bo2, bo3) || E'\n';
    perform cancel_order(o.id, 'uji matriks');
    o := create_order(jsonb_build_object('service', 'box', 'helpers', 1, 'purpose', 'pindahan',
      'pickup', jsonb_build_object('lat', 0.4950, 'lng', 101.4320, 'address', 'Kos lama'),
      'dropoff', jsonb_build_object('lat', 0.5100, 'lng', 101.4450, 'address', 'Kos baru'), 'paid_via', 'cash'));
    select driver_can_take(dm, o), driver_can_take(dc, o), driver_can_take(db, o) into bo, bo2, bo3;
    log := log || format('S25h %s box → motor=%s mobil=%s (harus false) box=%s (harus true)', case when not bo and not bo2 and bo3 then 'OK' else 'BUG' end, bo, bo2, bo3) || E'\n';
    perform cancel_order(o.id, 'uji matriks');
  exception when others then log := log || 'S25 BUG matriks layanan-kendaraan: ' || sqlerrm || E'\n'; end;

  -- ===== S26 Titipan AntarSend antar kota lewat mitra travel =====
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
    perform driver_selfie_check('https://x/selfie.jpg'); perform driver_set_online(true, -0.9405, 100.3625);
    perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
    -- kontrol: kiriman antar kota lewat gudang (tanpa via) tetap terlihat driver kota
    o2 := create_order(jsonb_build_object('service', 'send', 'send_scope', 'intercity', 'dest_city_id', city_bkt, 'warehouse_id', wh_dest,
      'weight_kg', 4, 'size_cm', 40, 'pickup', jsonb_build_object('lat', -0.9405, 'lng', 100.3625, 'address', 'Toko A'),
      'dropoff', jsonb_build_object('lat', -0.3, 'lng', 100.37, 'address', 'Bukittinggi'), 'recipient_name', 'Andi', 'recipient_phone', '0812', 'paid_via', 'cash'));
    o := create_order(jsonb_build_object('service', 'send', 'send_scope', 'intercity', 'via', 'travel', 'dest_city_id', city_bkt, 'warehouse_id', wh_dest,
      'weight_kg', 5, 'size_cm', 40, 'pickup', jsonb_build_object('lat', -0.9405, 'lng', 100.3625, 'address', 'Toko A'),
      'dropoff', jsonb_build_object('lat', -0.3, 'lng', 100.37, 'address', 'Bukittinggi'), 'recipient_name', 'Andi', 'recipient_phone', '0812', 'paid_via', 'cash'));
    perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
    select count(*) into n from driver_available_orders() av where av.id = o.id;
    select count(*) into n2 from driver_available_orders() av where av.id = o2.id;
    log := log || format('S26a %s titipan via=%s di feed driver kota=%s (harus 0); kontrol kiriman gudang %s di feed=%s (harus 1)',
      case when n = 0 and n2 = 1 then 'OK' else 'BUG' end, o.package_details->>'via', n, o2.code, n2) || E'\n';
    perform set_config('request.jwt.claims', json_build_object('sub', drv2, 'role', 'authenticated')::text, true);
    j := travel_send_available();
    select count(*) into n from jsonb_array_elements(j) x where (x->>'id')::uuid = o.id;
    select (x->>'partner_earning')::bigint into b0 from jsonb_array_elements(j) x where (x->>'id')::uuid = o.id;
    log := log || format('S26b %s titipan %s muncul di travel_send_available (%s baris): ongkir antar kota=%s bagian mitra=%s (travel_send_partner_pct=%s%%)',
      case when n = 1 and b0 = round(o.intercity_fare * setting_num('travel_send_partner_pct', 80) / 100.0)::bigint then 'OK' else 'BUG' end,
      o.code, n, o.intercity_fare, b0, setting_num('travel_send_partner_pct', 80)) || E'\n';
    o := travel_accept_send(o.id);
    log := log || format('S26c %s travel_accept_send → status=%s travel_partner_id=%s', case when o.status = 'accepted' and o.travel_partner_id = drv2 then 'OK' else 'BUG' end, o.status, o.travel_partner_id) || E'\n';
    o := travel_pickup_send(o.id);
    log := log || format('S26d %s travel_pickup_send → status=%s', case when o.status = 'in_progress' then 'OK' else 'BUG' end, o.status) || E'\n';
    select balance into b0 from wallets where user_id = drv2;
    o := travel_complete_send(o.id);
    select balance into b1 from wallets where user_id = drv2;
    select count(*) into n from notifications where user_id = cust and (data->>'order_id')::uuid = o.id;
    log := log || format('S26e %s travel_complete_send → status=%s pembayaran=%s saldo mitra travel %s→%s (+%s, seharusnya %s) notifikasi pelanggan=%s',
      case when o.status = 'completed' and b1 - b0 = round(o.intercity_fare * setting_num('travel_send_partner_pct', 80) / 100.0)::bigint and n >= 3 then 'OK' else 'BUG' end,
      o.status, o.payment_status, b0, b1, b1 - b0, round(o.intercity_fare * setting_num('travel_send_partner_pct', 80) / 100.0)::bigint, n) || E'\n';
    perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
    perform cancel_order(o2.id, 'uji kontrol selesai');
    begin
      o2 := create_order(jsonb_build_object('service', 'send', 'send_scope', 'intercity', 'via', 'travel', 'dest_city_id', city_bkt, 'warehouse_id', wh_dest,
        'weight_kg', 50, 'size_cm', 40, 'pickup', jsonb_build_object('lat', -0.9405, 'lng', 100.3625, 'address', 'Toko A'),
        'dropoff', jsonb_build_object('lat', -0.3, 'lng', 100.37, 'address', 'Bukittinggi'), 'recipient_name', 'Andi', 'recipient_phone', '0812', 'paid_via', 'cash'));
      log := log || 'S26f BUG: titipan 50 kg lewat mitra travel diterima create_order' || E'\n';
    exception when others then log := log || format('S26f %s titipan 50 kg ditolak create_order: %s', case when sqlerrm ilike '%travel%' then 'OK' else 'BUG' end, left(sqlerrm, 130)) || E'\n'; end;
    -- berat dinaikkan setelah order dibuat → travel_accept_send harus tetap menolak
    o2 := create_order(jsonb_build_object('service', 'send', 'send_scope', 'intercity', 'via', 'travel', 'dest_city_id', city_bkt, 'warehouse_id', wh_dest,
      'weight_kg', 25, 'size_cm', 40, 'pickup', jsonb_build_object('lat', -0.9405, 'lng', 100.3625, 'address', 'Toko A'),
      'dropoff', jsonb_build_object('lat', -0.3, 'lng', 100.37, 'address', 'Bukittinggi'), 'recipient_name', 'Andi', 'recipient_phone', '0812', 'paid_via', 'cash'));
    update orders set weight_kg = 50 where id = o2.id;
    perform set_config('request.jwt.claims', json_build_object('sub', drv2, 'role', 'authenticated')::text, true);
    begin perform travel_accept_send(o2.id); log := log || 'S26g BUG: travel_accept_send menerima titipan 50 kg' || E'\n';
    exception when others then log := log || format('S26g %s travel_accept_send menolak titipan 50 kg: %s', case when sqlerrm ilike '%batas mitra travel%' then 'OK' else 'BUG' end, left(sqlerrm, 130)) || E'\n'; end;
    perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
    perform cancel_order(o2.id, 'uji titipan selesai');
  exception when others then log := log || 'S26 BUG titipan mitra travel: ' || sqlerrm || E'\n'; end;

  -- ===== S27 Hapus mitra: wajib PIN admin, alasan >= 10 huruf, bebas order aktif & saldo nol =====
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
    perform driver_set_online(true, 0.4946, 101.4314);
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    insert into admin_security (user_id, pin_hash) select adm, extensions.crypt('123456', extensions.gen_salt('bf')) where not exists (select 1 from admin_security where user_id = adm);
    update admin_security set pin_hash = extensions.crypt('123456', extensions.gen_salt('bf')), failed = 0, locked_until = null where user_id = adm;
    perform admin_lock();
    begin perform admin_delete_partner('driver', drv, 'Uji hapus mitra driver oleh QC');
      log := log || 'S27a BUG: hapus mitra diterima tanpa buka kunci PIN' || E'\n';
    exception when others then log := log || format('S27a %s tanpa PIN ditolak: %s', case when sqlerrm ilike '%ADMIN_LOCKED%' or sqlerrm ilike '%PIN%' then 'OK' else 'BUG' end, left(sqlerrm, 70)) || E'\n'; end;
    r := admin_unlock('123456');
    begin perform admin_delete_partner('driver', drv, 'nakal');
      log := log || 'S27b BUG: alasan 5 huruf diterima' || E'\n';
    exception when others then log := log || format('S27b %s alasan < 10 huruf ditolak: %s', case when sqlerrm ilike '%10 huruf%' then 'OK' else 'BUG' end, left(sqlerrm, 70)) || E'\n'; end;
    begin perform admin_delete_partner('kurir', drv, 'Uji jenis mitra tidak dikenal');
      log := log || 'S27c BUG: jenis mitra tidak dikenal diterima' || E'\n';
    exception when others then log := log || format('S27c %s jenis mitra tak dikenal ditolak: %s', case when sqlerrm ilike '%tidak dikenal%' then 'OK' else 'BUG' end, left(sqlerrm, 70)) || E'\n'; end;
    perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
    o2 := create_order(jsonb_build_object('service', 'ride_motor', 'vehicle_class', 'motor_economy',
      'pickup', jsonb_build_object('lat', 0.4950, 'lng', 101.4320, 'address', 'A'),
      'dropoff', jsonb_build_object('lat', 0.5100, 'lng', 101.4450, 'address', 'B'), 'paid_via', 'cash'));
    perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
    o2 := driver_accept_order(o2.id);
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    begin perform admin_delete_partner('driver', drv, 'Uji hapus mitra driver oleh QC');
      log := log || 'S27d BUG: mitra dengan pesanan aktif tetap dihapus' || E'\n';
    exception when others then log := log || format('S27d %s pesanan aktif menahan penghapusan: %s', case when sqlerrm ilike '%aktif%' then 'OK' else 'BUG' end, left(sqlerrm, 80)) || E'\n'; end;
    perform cancel_order(o2.id, 'bersih untuk uji hapus mitra');
    select balance into b0 from wallets where user_id = drv;
    begin perform admin_delete_partner('driver', drv, 'Uji hapus mitra driver oleh QC');
      log := log || 'S27e BUG: mitra dengan saldo tersisa tetap dihapus' || E'\n';
    exception when others then log := log || format('S27e %s saldo Rp%s menahan penghapusan: %s', case when sqlerrm ilike '%saldo%' then 'OK' else 'BUG' end, b0, left(sqlerrm, 80)) || E'\n'; end;
    perform set_config('antaraja.bypass', 'on', true);
    update wallets set balance = 0 where user_id = drv;
    perform set_config('antaraja.bypass', 'off', true);
    select count(*) into n from security_events where kind = 'admin.partner_delete';
    r := admin_delete_partner('driver', drv, 'Uji hapus mitra driver oleh QC');
    select count(*) into n2 from security_events where kind = 'admin.partner_delete';
    log := log || format('S27f %s penghapusan berhasil setelah kondisi bersih: ok=%s status driver=%s profil aktif=%s alasan tercatat="%s" security_events %s→%s',
      case when (r->>'ok')::boolean and (select status from drivers where id = drv) = 'suspended' and (select is_active from profiles where id = drv) = false and n2 = n + 1 then 'OK' else 'BUG' end,
      r->>'ok', (select status from drivers where id = drv), (select is_active from profiles where id = drv), (select status_reason from drivers where id = drv), n, n2) || E'\n';
    -- mitra travel yang sedang membawa titipan pelanggan tidak boleh bisa dihapus (perbaikan migrasi 0027)
    perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
    o2 := create_order(jsonb_build_object('service', 'send', 'send_scope', 'intercity', 'via', 'travel', 'dest_city_id', city_bkt, 'warehouse_id', wh_dest,
      'weight_kg', 5, 'size_cm', 40, 'pickup', jsonb_build_object('lat', -0.9405, 'lng', 100.3625, 'address', 'Toko A'),
      'dropoff', jsonb_build_object('lat', -0.3, 'lng', 100.37, 'address', 'Bukittinggi'), 'recipient_name', 'Andi', 'recipient_phone', '0812', 'paid_via', 'cash'));
    perform set_config('request.jwt.claims', json_build_object('sub', drv2, 'role', 'authenticated')::text, true);
    o2 := travel_accept_send(o2.id);
    perform set_config('antaraja.bypass', 'on', true);
    update wallets set balance = 0 where user_id = drv2;   -- agar yang diuji murni pemeriksaan pekerjaan aktif
    perform set_config('antaraja.bypass', 'off', true);
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    begin
      perform admin_delete_partner('travel', drv2, 'Uji hapus mitra travel oleh QC');
      log := log || format('S27g BUG: mitra travel dihapus padahal masih membawa titipan aktif %s (status %s)', o2.code, o2.status) || E'\n';
    exception when others then log := log || format('S27g %s titipan aktif menahan penghapusan mitra travel: %s', case when sqlerrm ilike '%aktif%' then 'OK' else 'BUG' end, left(sqlerrm, 90)) || E'\n'; end;
    perform cancel_order(o2.id, 'bersih untuk uji hapus mitra travel');
  exception when others then log := log || 'S27 BUG hapus mitra: ' || sqlerrm || E'\n'; end;

  -- ===== S28 Chat admin ↔ pengguna (admin_contact_thread) =====
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    update tickets set status = 'closed' where user_id = cust and category = 'account' and status not in ('resolved','closed');
    r := admin_contact_thread(cust, 'Uji chat admin QC');
    select count(*) into n2 from ticket_messages where ticket_id = (r->>'ticket_id')::uuid;
    select count(*) into n3 from notifications where user_id = cust and (data->>'ticket_id')::uuid = (r->>'ticket_id')::uuid;
    log := log || format('S28a %s tiket dibuat kode=%s created=%s status=%s pesan pembuka=%s notifikasi=%s',
      case when (r->>'created')::boolean and n2 >= 2 and n3 = 1 then 'OK' else 'BUG' end, r->>'code', r->>'created', r->>'status', n2, n3) || E'\n';
    j := admin_contact_thread(cust, 'Uji chat admin QC (panggilan kedua)');
    log := log || format('S28b %s panggilan kedua memakai tiket yang sama (%s) created=%s',
      case when (j->>'ticket_id') = (r->>'ticket_id') and not (j->>'created')::boolean then 'OK' else 'BUG' end, j->>'code', j->>'created') || E'\n';
    perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
    begin perform admin_contact_thread(adm, 'coba'); log := log || 'S28c BUG: non-admin bisa memulai chat admin' || E'\n';
    exception when others then log := log || format('S28c OK non-admin ditolak: %s', left(sqlerrm, 40)) || E'\n'; end;
  exception when others then log := log || 'S28 BUG chat admin: ' || sqlerrm || E'\n'; end;

  -- ===== S29 Laporan keuangan bertingkat (admin_finance_cascade) & bagi hasil satu order =====
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    d_from := (now() at time zone 'Asia/Jakarta')::date - 1; d_to := (now() at time zone 'Asia/Jakarta')::date + 1;
    j1 := admin_finance_cascade(d_from, d_to, 'service', null);
    select count(*) into n from jsonb_array_elements(j1->'rows') x where (x->>'net_margin')::bigint <> (x->>'revenue')::bigint - (x->>'promo')::bigint - (x->>'gateway_fee')::bigint;
    select count(*) into n2 from jsonb_array_elements(j1->'rows') x where (x->>'cogs')::bigint <> (x->>'driver_payout')::bigint + (x->>'merchant_payout')::bigint + (x->>'gateway_fee')::bigint + (x->>'promo')::bigint;
    log := log || format('S29a %s level 1 per layanan: %s baris (level=%s sub_group=%s); pelanggaran net_margin=revenue-promo-gateway=%s, pelanggaran cogs=driver+merchant+gateway+promo=%s; total order=%s selesai=%s gmv=%s revenue=%s cogs=%s net=%s',
      case when n = 0 and n2 = 0 and (j1->>'level')::int = 1 then 'OK' else 'BUG' end,
      jsonb_array_length(j1->'rows'), j1->>'level', j1->>'sub_group', n, n2,
      j1->'totals'->>'orders', j1->'totals'->>'completed', j1->'totals'->>'gmv', j1->'totals'->>'revenue', j1->'totals'->>'cogs', j1->'totals'->>'net_margin') || E'\n';
    select x->>'key' into k1 from jsonb_array_elements(j1->'rows') x where (x->>'completed')::int > 0 order by (x->>'gmv')::bigint desc limit 1;
    j2 := admin_finance_cascade(d_from, d_to, 'service', k1);
    select x into jr from jsonb_array_elements(j1->'rows') x where x->>'key' = k1;
    log := log || format('S29b %s level 2 layanan "%s" (level=%s sub_group=%s, %s baris kota, %s order dirinci): total level 2 order=%s gmv=%s revenue=%s cogs=%s net=%s == baris level 1 order=%s gmv=%s revenue=%s cogs=%s net=%s',
      case when j2->'totals'->>'orders' = jr->>'orders' and j2->'totals'->>'gmv' = jr->>'gmv' and j2->'totals'->>'revenue' = jr->>'revenue'
             and j2->'totals'->>'net_margin' = jr->>'net_margin' and j2->'totals'->>'cogs' = jr->>'cogs' and (j2->>'level')::int = 2 then 'OK' else 'BUG' end,
      k1, j2->>'level', j2->>'sub_group', jsonb_array_length(j2->'rows'), jsonb_array_length(j2->'orders'),
      j2->'totals'->>'orders', j2->'totals'->>'gmv', j2->'totals'->>'revenue', j2->'totals'->>'cogs', j2->'totals'->>'net_margin',
      jr->>'orders', jr->>'gmv', jr->>'revenue', jr->>'cogs', jr->>'net_margin') || E'\n';
    j := admin_finance_cascade(d_from, d_to, 'city', null);
    select count(*) into n from jsonb_array_elements(j->'rows') x where (x->>'net_margin')::bigint <> (x->>'revenue')::bigint - (x->>'promo')::bigint - (x->>'gateway_fee')::bigint;
    select x->>'key' into k1 from jsonb_array_elements(j->'rows') x where (x->>'completed')::int > 0 order by (x->>'gmv')::bigint desc limit 1;
    jr := admin_finance_cascade(d_from, d_to, 'city', k1);
    select x into j2 from jsonb_array_elements(j->'rows') x where x->>'key' = k1;
    log := log || format('S29c %s level 1 per kota: %s baris (pelanggaran identitas=%s); level 2 kota "%s" sub_group=%s gmv=%s == baris level 1 gmv=%s revenue=%s',
      case when n = 0 and jr->'totals'->>'gmv' = j2->>'gmv' and jr->'totals'->>'revenue' = j2->>'revenue' and jr->>'sub_group' = 'service' then 'OK' else 'BUG' end,
      jsonb_array_length(j->'rows'), n, k1, jr->>'sub_group', jr->'totals'->>'gmv', j2->>'gmv', j2->>'revenue') || E'\n';
    select (x->>'id')::uuid into ordid from jsonb_array_elements(jr->'orders') x where x->>'status' = 'completed' limit 1;
    j2 := admin_order_split(ordid);
    select x into jr from jsonb_array_elements(jr->'orders') x where (x->>'id')::uuid = ordid;
    log := log || format('S29d %s admin_order_split order %s: gross=%s revenue platform=%s (baris laporan %s) gateway=%s (laporan %s) promo=%s driver=%s merchant=%s cogs=%s net_margin=%s (revenue-promo-gateway=%s) margin=%s%%',
      case when j2->'platform'->>'revenue' = jr->>'revenue' and j2->>'gateway_fee' = jr->>'gateway_fee'
             and (j2->>'net_margin')::bigint = (j2->'platform'->>'revenue')::bigint - (j2->>'promo')::bigint - (j2->>'gateway_fee')::bigint
             and (j2->>'cogs')::bigint = (j2->>'driver_payout')::bigint + (j2->>'merchant_payout')::bigint + (j2->>'gateway_fee')::bigint + (j2->>'promo')::bigint then 'OK' else 'BUG' end,
      j2->>'code', j2->>'gross', j2->'platform'->>'revenue', jr->>'revenue', j2->>'gateway_fee', jr->>'gateway_fee', j2->>'promo',
      j2->>'driver_payout', j2->>'merchant_payout', j2->>'cogs', j2->>'net_margin',
      (j2->'platform'->>'revenue')::bigint - (j2->>'promo')::bigint - (j2->>'gateway_fee')::bigint, j2->>'margin_pct') || E'\n';
    begin perform admin_finance_cascade(d_from, d_to, 'kecamatan', null); log := log || 'S29e BUG: pengelompokan tak dikenal diterima' || E'\n';
    exception when others then log := log || format('S29e OK pengelompokan tak dikenal ditolak: %s', left(sqlerrm, 60)) || E'\n'; end;
    begin perform admin_finance_cascade(d_to, d_from, 'service', null); log := log || 'S29f BUG: rentang tanggal terbalik diterima' || E'\n';
    exception when others then log := log || format('S29f OK rentang tanggal terbalik ditolak: %s', left(sqlerrm, 60)) || E'\n'; end;
  exception when others then log := log || 'S29 BUG laporan keuangan: ' || sqlerrm || E'\n'; end;

  -- ===== S30 Portal eksekutif: laporan laba rugi (exec_report.pnl) =====
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    insert into exec_access (user_id, level, pin_hash, active) select adm, 'vp', extensions.crypt('654321', extensions.gen_salt('bf')), true where not exists (select 1 from exec_access where user_id = adm);
    update exec_access set pin_hash = extensions.crypt('654321', extensions.gen_salt('bf')), active = true where user_id = adm;
    r := exec_login('654321');
    j := exec_report(r->>'token', 6);
    j1 := j->'pnl'->'totals';
    select count(*) into n from (select unnest(array['summary','monthly','by_service','by_city','supply','quality','fraud','automation','finance','recommendations','level','top_merchants','gmv_growth_pct','prev_gmv','generated_at']) k) x where not (j ? x.k);
    log := log || format('S30a %s exec_login level=%s → exec_report: field lama yang hilang=%s, bagian pnl ada=%s (by_month=%s bulan, by_service=%s layanan)',
      case when n = 0 and (j ? 'pnl') then 'OK' else 'BUG' end, j->>'level', n, (j ? 'pnl'), jsonb_array_length(j->'pnl'->'by_month'), jsonb_array_length(j->'pnl'->'by_service')) || E'\n';
    log := log || format('S30b %s pnl.totals: revenue=%s cogs=%s gross_margin=%s (revenue-cogs=%s) margin=%s%% | cogs = driver %s + merchant %s + gateway %s + promo %s | gmv=%s platform_take=%s',
      case when (j1->>'gross_margin')::bigint = (j1->>'revenue')::bigint - (j1->>'cogs')::bigint
             and (j1->>'cogs')::bigint = (j1->>'driver_payout')::bigint + (j1->>'merchant_payout')::bigint + (j1->>'gateway_fee')::bigint + (j1->>'promo')::bigint then 'OK' else 'BUG' end,
      j1->>'revenue', j1->>'cogs', j1->>'gross_margin', (j1->>'revenue')::bigint - (j1->>'cogs')::bigint, j1->>'margin_pct',
      j1->>'driver_payout', j1->>'merchant_payout', j1->>'gateway_fee', j1->>'promo', j1->>'gmv', j1->>'platform_take') || E'\n';
    select count(*) into n from jsonb_array_elements(j->'pnl'->'by_service') x where (x->>'gross_margin')::bigint <> (x->>'revenue')::bigint - (x->>'cogs')::bigint;
    select count(*) into n2 from jsonb_array_elements(j->'pnl'->'by_month') x where (x->>'gross_margin')::bigint <> (x->>'revenue')::bigint - (x->>'cogs')::bigint;
    log := log || format('S30c %s identitas gross_margin = revenue - cogs: pelanggaran per layanan=%s, per bulan=%s', case when n = 0 and n2 = 0 then 'OK' else 'BUG' end, n, n2) || E'\n';
    begin perform exec_report('token-palsu-123', 6); log := log || 'S30d BUG: token eksekutif palsu diterima' || E'\n';
    exception when others then log := log || format('S30d OK token eksekutif palsu ditolak: %s', left(sqlerrm, 40)) || E'\n'; end;
    -- kembalikan setelan dispatch ke nilai semula (tetap ikut rollback)
    perform admin_set_settings(jsonb_build_object('priority_tiers', s_tier0, 'pickup_radius_km', s_rad0));
  exception when others then log := log || 'S30 BUG portal eksekutif: ' || sqlerrm || E'\n'; end;

  raise exception using message = 'SIMULASI_SELESAI' || log;
end $sim$;
