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
  s_rad0 jsonb; s_tier0 jsonb; s_dr1 numeric; s_dc1 int; s_dr2 numeric; s_dc2 int; s_km numeric; s_wait numeric; num1 numeric;
  -- Tahap 11 (S34-S37): AntarNow (kode driver), hapus akun → daftar ulang, token push, batas komisi Perpres 27/2026
  c_drv text; c_drv2 text; u_a uuid; u_b uuid; mail11 text; hold11 int; seen boolean; seen2 boolean; left1 int;
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
    select av.priority_note, av.waiting_minutes into k1, s_wait from driver_available_orders() av where av.id = o.id;
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
    -- titipan ini dibayar TUNAI: mitra memegang seluruh uang pelanggan, jadi yang benar adalah mitra MENYETOR
    -- selisihnya ke platform (lihat migrasi 0036). Pada pembayaran dompet barulah mitra dikredit bagiannya.
    log := log || format('S26e %s travel_complete_send → status=%s pembayaran=%s metode=%s saldo mitra travel %s→%s (Δ%s, seharusnya %s) bagian mitra=%s notifikasi pelanggan=%s',
      case when o.status = 'completed' and n >= 3 and b1 - b0 =
             case when o.payment_method = 'cash' then -(o.total - round(o.intercity_fare * setting_num('travel_send_partner_pct', 80) / 100.0)::bigint)
                  else round(o.intercity_fare * setting_num('travel_send_partner_pct', 80) / 100.0)::bigint end
           then 'OK' else 'BUG' end,
      o.status, o.payment_status, o.payment_method, b0, b1, b1 - b0,
      case when o.payment_method = 'cash' then -(o.total - round(o.intercity_fare * setting_num('travel_send_partner_pct', 80) / 100.0)::bigint)
           else round(o.intercity_fare * setting_num('travel_send_partner_pct', 80) / 100.0)::bigint end,
      round(o.intercity_fare * setting_num('travel_send_partner_pct', 80) / 100.0)::bigint, n) || E'\n';
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
    -- Tahap 11: hapus mitra yang menonaktifkan akun ikut melepas e-mail auth.users jadi tombstone
    select email into k1 from auth.users where id = drv;
    log := log || format('S27h %s hapus mitra ''driver'' ikut melepas e-mail auth.users jadi tombstone (%s) sehingga e-mail asli bebas dipakai mendaftar lagi', case when k1 = drv::text || '@deleted.antarkita.invalid' then 'OK' else 'BUG' end, k1) || E'\n';
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

  -- ===== S31 Chat admin di pesanan (kebijakan RLS order_messages — perbaikan migrasi 0028) =====
  -- Catatan: RLS diuji SUNGGUHAN. set_config('role','authenticated') membuat pernyataan berikutnya
  -- tunduk pada kebijakan (peran postgres punya BYPASSRLS, jadi tanpa ini uji akan selalu "lulus" palsu).
  begin
    update orders set status = 'cancelled' where customer_id = cust and status in ('searching','accepted','arrived','in_progress');
    perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
    o := create_order(jsonb_build_object('service', 'ride_motor', 'vehicle_class', 'motor_economy',
      'pickup', jsonb_build_object('lat', 0.4950, 'lng', 101.4320, 'address', 'Jl. Uji Chat Admin'),
      'dropoff', jsonb_build_object('lat', 0.5100, 'lng', 101.4450, 'address', 'Tujuan Uji Chat'), 'paid_via', 'cash'));
    o := cancel_order(o.id, 'uji chat admin');   -- status di luar accepted/arrived/in_progress → cabang is_admin() yang diuji
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
      perform set_config('role', 'authenticated', true);
      insert into order_messages (order_id, sender_id, body) values (o.id, adm, 'Halo, ini Admin AntarKita (uji QC).');
      perform set_config('role', 'none', true);
      select count(*) into n from order_messages where order_id = o.id and sender_id = adm;
      log := log || format('S31a %s admin mengirim pesan di order %s (status %s) → baris tersimpan=%s', case when n = 1 then 'OK' else 'BUG' end, o.code, o.status, n) || E'\n';
    exception when others then
      log := log || format('S31a BUG admin tidak bisa membalas chat pesanan (status %s): %s', o.status, sqlerrm) || E'\n';
      insert into order_messages (order_id, sender_id, body) values (o.id, adm, 'Pesan admin disisipkan langsung karena RLS menolak (uji QC).');
    end;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
      perform set_config('role', 'authenticated', true);
      select count(*) into n2 from order_messages where order_id = o.id;
      perform set_config('role', 'none', true);
      log := log || format('S31b %s pelanggan pemilik order bisa membaca pesan admin → %s baris', case when n2 >= 1 then 'OK' else 'BUG' end, n2) || E'\n';
    exception when others then perform set_config('role', 'none', true); log := log || 'S31b BUG baca pelanggan: ' || sqlerrm || E'\n'; end;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', mown, 'role', 'authenticated')::text, true);
      perform set_config('role', 'authenticated', true);
      select count(*) into n3 from order_messages where order_id = o.id;
      perform set_config('role', 'none', true);
      log := log || format('S31c %s pengguna bukan peserta membaca chat → %s baris (harus 0)', case when n3 = 0 then 'OK' else 'BUG' end, n3) || E'\n';
    exception when others then perform set_config('role', 'none', true); log := log || 'S31c BUG baca pihak ketiga: ' || sqlerrm || E'\n'; end;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', mown, 'role', 'authenticated')::text, true);
      perform set_config('role', 'authenticated', true);
      insert into order_messages (order_id, sender_id, body) values (o.id, mown, 'Saya bukan peserta order ini.');
      perform set_config('role', 'none', true);
      log := log || 'S31d BUG: pengguna bukan peserta bisa menulis di chat pesanan' || E'\n';
    exception when others then log := log || format('S31d OK pengguna bukan peserta ditolak menulis: %s', left(sqlerrm, 60)) || E'\n'; end;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
      perform set_config('role', 'authenticated', true);
      insert into order_messages (order_id, sender_id, body) values (o.id, cust, 'Menyamar sebagai pelanggan.');
      perform set_config('role', 'none', true);
      log := log || 'S31e BUG: sender_id boleh berbeda dari auth.uid() (penyamaran identitas)' || E'\n';
    exception when others then log := log || format('S31e OK sender_id wajib = auth.uid(): %s', left(sqlerrm, 60)) || E'\n'; end;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
      perform set_config('role', 'authenticated', true);
      insert into order_messages (order_id, sender_id, body) values (o.id, cust, 'Halo, order sudah batal.');
      perform set_config('role', 'none', true);
      log := log || 'S31f BUG: pelanggan bisa menulis pada order yang sudah dibatalkan (aturan lama ikut longgar)' || E'\n';
    exception when others then log := log || format('S31f OK syarat peserta TIDAK dilonggarkan (order %s): %s', o.status, left(sqlerrm, 55)) || E'\n'; end;
    begin
      perform set_config('antaraja.bypass', 'on', true);
      update orders set status = 'accepted', driver_id = drv2 where id = o.id;
      perform set_config('antaraja.bypass', 'off', true);
      perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
      perform set_config('role', 'authenticated', true);
      insert into order_messages (order_id, sender_id, body) values (o.id, cust, 'Baik Pak, saya tunggu di depan pagar.');
      perform set_config('role', 'none', true);
      select count(*) into n from order_messages where order_id = o.id and sender_id = cust;
      log := log || format('S31g %s pelanggan tetap bisa chat saat order berjalan (status accepted) → %s baris', case when n = 1 then 'OK' else 'BUG' end, n) || E'\n';
    exception when others then perform set_config('role', 'none', true); log := log || 'S31g BUG pelanggan tidak bisa chat saat order berjalan: ' || sqlerrm || E'\n'; end;
    update orders set status = 'cancelled' where id = o.id;
  exception when others then perform set_config('role', 'none', true); log := log || 'S31 BUG chat admin di pesanan: ' || sqlerrm || E'\n'; end;

  -- ===== S32 Realtime app_settings (publication) + sakelar layanan admin =====
  begin
    select count(*) into n from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'app_settings';
    select relreplident::text into k1 from pg_class where oid = 'public.app_settings'::regclass;
    select count(*) into n2 from pg_policy where polrelid = 'public.app_settings'::regclass and polcmd = 'r';
    log := log || format('S32a %s app_settings terdaftar di publication supabase_realtime=%s (harus 1); replica identity=%s; kebijakan SELECT=%s (payload realtime butuh keduanya)',
      case when n = 1 and n2 >= 1 then 'OK' else 'BUG' end, n, k1, n2) || E'\n';
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    j := app_public_settings();
    bo := (j->'services_enabled'->>'market')::boolean;
    r := admin_set_service_enabled('market', not bo);
    j1 := app_public_settings();
    log := log || format('S32b %s admin_set_service_enabled(market,%s) → app_public_settings().services_enabled.market %s→%s (nilai balik RPC=%s)',
      case when (j1->'services_enabled'->>'market')::boolean = (not bo) then 'OK' else 'BUG' end,
      not bo, bo, j1->'services_enabled'->>'market', r->>'market') || E'\n';
    select count(*) into n3 from app_settings where key = 'services_enabled' and updated_at >= transaction_timestamp();
    log := log || format('S32c %s baris app_settings.services_enabled benar-benar ter-UPDATE (%s baris, updated_at diperbarui) sehingga replikasi mengirim payload', case when n3 = 1 then 'OK' else 'BUG' end, n3) || E'\n';
    r := admin_set_service_enabled('market', bo);
    j1 := app_public_settings();
    log := log || format('S32d %s nilai dikembalikan ke semula: market=%s', case when (j1->'services_enabled'->>'market')::boolean = bo then 'OK' else 'BUG' end, j1->'services_enabled'->>'market') || E'\n';
  exception when others then log := log || 'S32 BUG realtime app_settings: ' || sqlerrm || E'\n'; end;

  -- ===== S33 Setiap notifikasi harus punya kunci tujuan di kolom `data` =====
  -- Kunci yang dibaca aplikasi: src/hooks/useNotifications.ts → notificationData()
  begin
    -- (a) chat admin ↔ pengguna: ticket_id
    select count(*) into n from notifications where created_at >= transaction_timestamp() and kind = 'system' and jsonb_exists(coalesce(data, '{}'::jsonb), 'ticket_id');
    log := log || format('S33a %s notifikasi admin_contact_thread membawa ticket_id → %s baris', case when n >= 1 then 'OK' else 'BUG' end, n) || E'\n';
    -- (b) status pesanan (titipan travel AntarSend): order_id
    select count(*) into n from notifications where created_at >= transaction_timestamp() and kind = 'order' and jsonb_exists(coalesce(data, '{}'::jsonb), 'order_id');
    select count(*) into n2 from notifications where created_at >= transaction_timestamp() and kind = 'order' and not jsonb_exists(coalesce(data, '{}'::jsonb), 'order_id') and not jsonb_exists(coalesce(data, '{}'::jsonb), 'travel_request_id') and not jsonb_exists(coalesce(data, '{}'::jsonb), 'booking_id');
    log := log || format('S33b %s notifikasi kind=order: %s membawa order_id, %s tanpa kunci tujuan apa pun (harus 0)', case when n >= 1 and n2 = 0 then 'OK' else 'BUG' end, n, n2) || E'\n';
    -- (c) travel carter: travel_request_id
    select count(*) into n from notifications where created_at >= transaction_timestamp() and jsonb_exists(coalesce(data, '{}'::jsonb), 'travel_request_id');
    log := log || format('S33c %s notifikasi permintaan/penawaran travel membawa travel_request_id → %s baris', case when n >= 1 then 'OK' else 'BUG' end, n) || E'\n';
    -- (d) pembatalan jadwal travel oleh mitra → notifikasi ke penumpang harus membawa booking_id
    perform set_config('request.jwt.claims', json_build_object('sub', drv2, 'role', 'authenticated')::text, true);
    tt := travel_trip_create(jsonb_build_object('route_id', route1, 'depart_at', (now() + interval '3 days')::text, 'seats_total', 4, 'seat_price', 120000, 'allow_private', false));
    perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
    tb := travel_book(jsonb_build_object('trip_id', tt.id, 'pax', 1, 'pickup_address', 'Jl. Uji Notifikasi', 'pickup_lat', 0.5, 'pickup_lng', 101.44,
      'passengers', jsonb_build_array(jsonb_build_object('name', 'Uji QC')), 'paid_via', 'cash'));
    perform set_config('request.jwt.claims', json_build_object('sub', drv2, 'role', 'authenticated')::text, true);
    perform travel_trip_set_status(tt.id, 'cancelled', 'uji pembatalan jadwal oleh mitra');
    select count(*) into n2 from notifications where user_id = cust and created_at >= transaction_timestamp() and title = 'Travel ' || tb.code || ' dibatalkan';
    select count(*) into n from notifications where user_id = cust and created_at >= transaction_timestamp() and title = 'Travel ' || tb.code || ' dibatalkan' and jsonb_exists(coalesce(data, '{}'::jsonb), 'booking_id');
    log := log || format('S33d %s pembatalan jadwal travel: notifikasi ke penumpang=%s, yang membawa booking_id=%s (harus sama)', case when n2 = 1 and n = 1 then 'OK' else 'BUG' end, n2, n) || E'\n';
    -- (e) pembayaran gateway: payment_settle harus menulis payment_id
    select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
      where ns.nspname = 'public' and p.proname = 'payment_settle' and pg_get_functiondef(p.oid) like '%''payment_id'', p.id%';
    log := log || format('S33e %s payment_settle menulis data.payment_id pada notifikasi pembayaran (%s fungsi cocok)', case when n = 1 then 'OK' else 'BUG' end, n) || E'\n';
    -- (f) pindai statis: fungsi yang menulis notifikasi TANPA kolom `data` sama sekali
    select coalesce(string_agg(distinct p.proname, ', '), '(tidak ada)') into k1
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
      where ns.nspname = 'public' and p.prokind = 'f'
        and pg_get_functiondef(p.oid) ~* 'insert into notifications \(user_id, kind, title, body\)';
    log := log || format('S33f %s fungsi yang menulis notifikasi tanpa kolom data: %s', case when k1 = '(tidak ada)' then 'OK' else 'BUG' end, k1) || E'\n';
    -- (g) pindai dinamis: notifikasi yang lahir dalam simulasi ini tanpa satu pun kunci tujuan
    select coalesce(string_agg(x.info, ' | ' order by x.info), '(tidak ada)'), count(*) into k1, n
      from (select distinct kind::text || ' "' || left(title, 44) || '"' as info from notifications
            where created_at >= transaction_timestamp()
              and not jsonb_exists_any(coalesce(data, '{}'::jsonb),
                    array['order_id','ticket_id','travel_request_id','booking_id','trip_id','payment_id','withdrawal_id','merchant_id','blast_id','suggestion_id','flag_id','report_run_id','target_id'])) x;
    log := log || format('S33g %s jenis notifikasi tanpa kunci tujuan (informatif/tanpa halaman tujuan): %s', case when n = 0 then 'OK' else 'CATATAN' end, k1) || E'\n';
  exception when others then log := log || 'S33 BUG notifikasi tujuan: ' || sqlerrm || E'\n'; end;


  -- ===== S34 AntarNow — pesan driver tertentu lewat kode =====
  begin
    -- pulihkan mitra uji (S28 sengaja menghapus lunak driver) & kosongkan order aktif pelanggan
    perform set_config('antaraja.bypass', 'on', true);
    update drivers set status = 'approved', status_reason = null where id in (drv, drv2);
    update profiles set is_active = true, deletion_requested_at = null, status_reason = null where id in (drv, drv2, cust);
    perform set_config('antaraja.bypass', 'off', true);
    update orders set status = 'cancelled' where customer_id = cust and status in ('scheduled','searching','accepted','arrived','in_progress');
    delete from order_rejections where driver_id in (drv, drv2);
    hold11 := setting_num('direct_order_hold_seconds', 120)::int;

    -- (a) kode driver: format 6 karakter tanpa 0 O 1 I, unik untuk semua driver
    perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
    j := driver_my_code(); c_drv := j->>'code';
    perform set_config('request.jwt.claims', json_build_object('sub', drv2, 'role', 'authenticated')::text, true);
    j1 := driver_my_code(); c_drv2 := j1->>'code';
    select count(*) into n from drivers where code is null;
    select count(*) into n2 from (select code from drivers where code is not null group by code having count(*) > 1) x;
    log := log || format('S34a %s driver_my_code(): kode drv=%s drv2=%s (pola 6 karakter tanpa 0 O 1 I); driver tanpa kode=%s (harus 0); kode kembar=%s (harus 0)',
      case when c_drv ~ '^[2-9A-HJ-NP-Z]{6}$' and c_drv2 ~ '^[2-9A-HJ-NP-Z]{6}$' and c_drv <> c_drv2 and n = 0 and n2 = 0 then 'OK' else 'BUG' end,
      c_drv, c_drv2, n, n2) || E'\n';

    -- (b) pratinjau driver dari kode untuk aplikasi Pelanggan
    perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
    j := driver_by_code(lower(c_drv));
    log := log || format('S34b %s driver_by_code(%s) → nama=%s kendaraan=%s plat=%s layanan=%s (kode huruf kecil ikut diterima)',
      case when (j->>'id') = drv::text and j ? 'services' and j ? 'rating_avg' and j ? 'last_seen_minutes' then 'OK' else 'BUG' end,
      lower(c_drv), j->>'name', j->>'vehicle_type', j->>'vehicle_plate', j->>'services') || E'\n';

    -- (c) order AntarSend memakai kode → preferred_driver_id terisi
    perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
    perform driver_selfie_check('https://x/selfie.jpg'); perform driver_set_online(true, 0.4810, 101.4349);
    perform set_config('request.jwt.claims', json_build_object('sub', drv2, 'role', 'authenticated')::text, true);
    perform driver_selfie_check('https://x/selfie.jpg'); perform driver_set_online(true, 0.4815, 101.4352);
    perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
    o2 := create_order(jsonb_build_object('service', 'send',
      'pickup', jsonb_build_object('lat', 0.4810, 'lng', 101.4349, 'address', 'Jl. Sudirman 45'),
      'dropoff', jsonb_build_object('lat', 0.50, 'lng', 101.44, 'address', 'Plaza Andalas'),
      'paid_via', 'cash', 'weight_kg', 2, 'size_cm', 30,
      'recipient_name', 'Uji AntarNow', 'recipient_phone', '081200000000',
      'driver_code', c_drv));
    log := log || format('S34c %s create_order(driver_code=%s) → order %s, preferred_driver_id=%s (harus driver pemilik kode)',
      case when o2.preferred_driver_id = drv then 'OK' else 'BUG' end, c_drv, o2.code, o2.preferred_driver_id) || E'\n';

    -- (d) selama masa tahan: HANYA driver tujuan yang melihat
    --     (created_at dimundurkan 30 detik agar jeda prioritas rating terlewati, masa tahan %s detik belum habis)
    update orders set created_at = now() - interval '30 seconds' where id = o2.id;
    perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
    select av.direct_for_me, av.direct_hold_left_s into seen, left1 from driver_available_orders() av where av.id = o2.id;
    perform set_config('request.jwt.claims', json_build_object('sub', drv2, 'role', 'authenticated')::text, true);
    select count(*) into n2 from driver_available_orders() av where av.id = o2.id;
    log := log || format('S34d %s masa tahan (%s detik): driver tujuan melihat order dengan direct_for_me=%s & sisa tahan=%s detik; driver lain melihat %s baris (harus 0)',
      case when coalesce(seen, false) and coalesce(left1, 0) > 0 and n2 = 0 then 'OK' else 'BUG' end,
      hold11, seen, left1, n2) || E'\n';

    -- (e) setelah masa tahan lewat & direct_order_fallback=true → driver lain ikut melihat, direct_for_me=false
    bo := setting_flag('direct_order_fallback', true);
    update orders set created_at = now() - make_interval(secs => hold11 + 30) where id = o2.id;
    perform set_config('request.jwt.claims', json_build_object('sub', drv2, 'role', 'authenticated')::text, true);
    select av.direct_for_me, av.direct_hold_left_s into seen2, left1 from driver_available_orders() av where av.id = o2.id;
    select count(*) into n3 from driver_available_orders() av where av.id = o2.id;
    perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
    select count(*) into n from driver_available_orders() av where av.id = o2.id;
    log := log || format('S34e %s setelah masa tahan (fallback=%s): driver lain melihat %s baris dengan direct_for_me=%s & sisa tahan=%s; driver tujuan tetap melihat %s baris',
      case when bo and n3 = 1 and seen2 = false and coalesce(left1, -1) = 0 and n = 1 then 'OK' else 'BUG' end,
      bo, n3, seen2, left1, n) || E'\n';

    -- (f) fallback dimatikan → order tetap milik driver tujuan saja
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    perform admin_set_settings(jsonb_build_object('direct_order_fallback', false));
    perform set_config('request.jwt.claims', json_build_object('sub', drv2, 'role', 'authenticated')::text, true);
    select count(*) into n2 from driver_available_orders() av where av.id = o2.id;
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    perform admin_set_settings(jsonb_build_object('direct_order_fallback', true));
    log := log || format('S34f %s direct_order_fallback=false: driver lain melihat %s baris walau masa tahan lewat (harus 0)',
      case when n2 = 0 then 'OK' else 'BUG' end, n2) || E'\n';

    -- (g) kode salah ditolak dengan pesan jelas
    perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
    update orders set status = 'cancelled' where customer_id = cust and status in ('searching','accepted','arrived','in_progress');
    begin
      o2 := create_order(jsonb_build_object('service', 'send',
        'pickup', jsonb_build_object('lat', 0.4810, 'lng', 101.4349, 'address', 'Jl. Sudirman 45'),
        'dropoff', jsonb_build_object('lat', 0.50, 'lng', 101.44, 'address', 'Plaza Andalas'),
        'paid_via', 'cash', 'weight_kg', 2, 'size_cm', 30, 'driver_code', 'ZZZZZZ'));
      log := log || 'S34g BUG: kode driver yang tidak ada tetap diterima' || E'\n';
    exception when others then
      log := log || format('S34g %s kode tidak dikenal ditolak: %s',
        case when sqlerrm ilike '%tidak ditemukan%' then 'OK' else 'BUG' end, left(sqlerrm, 90)) || E'\n';
    end;

    -- (h) driver tidak melayani layanan yang dipesan → ditolak dengan pesan jelas
    begin
      o2 := create_order(jsonb_build_object('service', 'ride_motor', 'vehicle_class', 'motor_economy',
        'pickup', jsonb_build_object('lat', 0.4810, 'lng', 101.4349, 'address', 'Jl. Sudirman 45'),
        'dropoff', jsonb_build_object('lat', 0.50, 'lng', 101.44, 'address', 'Plaza Andalas'),
        'paid_via', 'cash', 'driver_code', c_drv2));
      log := log || 'S34h BUG: driver bermobil tetap bisa dipesan untuk AntarRide (motor)' || E'\n';
    exception when others then
      log := log || format('S34h %s driver mobil ditolak untuk AntarRide: %s',
        case when sqlerrm ilike '%tidak melayani%' then 'OK' else 'BUG' end, left(sqlerrm, 90)) || E'\n';
    end;

    -- (i) statistik order langsung untuk kartu aplikasi Mitra
    perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
    j := driver_direct_stats();
    log := log || format('S34i %s driver_direct_stats() → hari ini=%s minggu ini=%s total=%s (masa tahan %s detik, fallback %s)',
      case when (j->>'today')::int >= 1 and (j->>'total')::int >= 1 and (j->>'code') = c_drv then 'OK' else 'BUG' end,
      j->>'today', j->>'this_week', j->>'total', j->>'hold_seconds', j->>'fallback') || E'\n';
  exception when others then log := log || 'S34 BUG AntarNow: ' || sqlerrm || E'\n'; end;

  -- ===== S35 Hapus akun lewat panel admin → e-mail bebas dipakai mendaftar ulang =====
  -- Akar masalah lama: banned_until = 'infinity' membuat GoTrue gagal memindai baris auth.users
  -- ("Database error finding user") dan e-mail tidak pernah dilepas sehingga tidak bisa daftar ulang.
  begin
    u_a := gen_random_uuid(); u_b := gen_random_uuid(); mail11 := 'uji.s35.' || left(u_a::text, 8) || '@antaraja.id';
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                            created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
    values ('00000000-0000-0000-0000-000000000000', u_a, 'authenticated', 'authenticated', mail11,
            extensions.crypt('rahasia123', extensions.gen_salt('bf')), now(), now(), now(),
            '{"provider":"email","providers":["email"]}'::jsonb,
            jsonb_build_object('full_name', 'Uji Daftar Ulang', 'phone', '+628100000001', 'email', mail11));
    insert into auth.identities (id, user_id, provider_id, provider, identity_data, created_at, updated_at)
    values (gen_random_uuid(), u_a, u_a::text, 'email', jsonb_build_object('sub', u_a::text, 'email', mail11), now(), now());
    select count(*) into n from profiles where id = u_a;
    log := log || format('S35a %s pendaftaran pertama: trigger handle_new_user membuat profil (%s baris)', case when n = 1 then 'OK' else 'BUG' end, n) || E'\n';

    insert into admin_security (user_id, pin_hash) select adm, extensions.crypt('123456', extensions.gen_salt('bf')) where not exists (select 1 from admin_security where user_id = adm);
    update admin_security set pin_hash = extensions.crypt('123456', extensions.gen_salt('bf')), failed = 0, locked_until = null where user_id = adm;
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    perform admin_unlock('123456');
    r := admin_delete_partner('user', u_a, 'Uji hapus akun lalu daftar ulang');

    select email into k1 from auth.users where id = u_a;
    select count(*) into n from auth.users where email = mail11;
    log := log || format('S35b %s setelah admin_delete_partner(''user''): e-mail auth.users jadi tombstone %s; baris memakai e-mail asli=%s (harus 0)',
      case when k1 = u_a::text || '@deleted.antarkita.invalid' and n = 0 then 'OK' else 'BUG' end, k1, n) || E'\n';
    select identity_data->>'email' into k1 from auth.identities where user_id = u_a;
    select count(*) into n2 from auth.identities where identity_data->>'email' = mail11;
    log := log || format('S35c %s auth.identities ikut ditombstone (%s); identitas memakai e-mail asli=%s (harus 0, GoTrue memeriksa duplikat lewat identitas)',
      case when k1 = u_a::text || '@deleted.antarkita.invalid' and n2 = 0 then 'OK' else 'BUG' end, k1, n2) || E'\n';
    select banned_until::text into k1 from auth.users where id = u_a;
    select count(*) into n3 from auth.users where banned_until = 'infinity'::timestamptz;
    log := log || format('S35d %s blokir login memakai batas berhingga (%s) dan tidak ada lagi baris ''infinity'' (%s baris) — inilah penyebab "Database error finding user"',
      case when k1 = '2999-12-31 23:59:59+00' and n3 = 0 then 'OK' else 'BUG' end, k1, n3) || E'\n';

    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                            created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
    values ('00000000-0000-0000-0000-000000000000', u_b, 'authenticated', 'authenticated', mail11,
            extensions.crypt('rahasia456', extensions.gen_salt('bf')), now(), now(), now(),
            '{"provider":"email","providers":["email"]}'::jsonb,
            jsonb_build_object('full_name', 'Uji Daftar Ulang 2', 'phone', '+628100000002', 'email', mail11));
    select count(*) into n from auth.users where email = mail11;
    select count(*) into n2 from profiles where id = u_b and is_active;
    select count(*) into n3 from wallets where user_id = u_b;
    log := log || format('S35e %s daftar ulang dengan e-mail asli berhasil: auth.users=%s baris, profil aktif=%s, dompet=%s',
      case when n = 1 and n2 = 1 and n3 = 1 then 'OK' else 'BUG' end, n, n2, n3) || E'\n';
  exception when others then log := log || 'S35 BUG hapus akun → daftar ulang: ' || sqlerrm || E'\n'; end;

  -- ===== S36 Token push: idempotent, bisa dicabut, dan tertutup untuk pengguna lain (RLS) =====
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
    r := register_push_token('tok-uji-s36-pelanggan', 'android', 'pelanggan');
    j := register_push_token('tok-uji-s36-pelanggan', 'android', 'pelanggan');
    select count(*) into n from push_tokens where token = 'tok-uji-s36-pelanggan';
    log := log || format('S36a %s register_push_token idempotent: dipanggil 2x → %s baris (harus 1), milik pelanggan uji',
      case when n = 1 and (j->>'ok')::boolean then 'OK' else 'BUG' end, n) || E'\n';

    perform set_config('role', 'authenticated', true);
    select count(*) into n from push_tokens where token = 'tok-uji-s36-pelanggan';
    perform set_config('role', 'none', true);
    perform set_config('request.jwt.claims', json_build_object('sub', mown, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    select count(*) into n2 from push_tokens where token = 'tok-uji-s36-pelanggan';
    perform set_config('role', 'none', true);
    log := log || format('S36b %s RLS push_tokens: pemilik membaca %s baris (harus 1), pengguna lain membaca %s baris (harus 0)',
      case when n = 1 and n2 = 0 then 'OK' else 'BUG' end, n, n2) || E'\n';

    perform set_config('request.jwt.claims', json_build_object('sub', mown, 'role', 'authenticated')::text, true);
    r := unregister_push_token('tok-uji-s36-pelanggan');
    select count(*) into n from push_tokens where token = 'tok-uji-s36-pelanggan';
    log := log || format('S36c %s pengguna lain tidak bisa mencabut token orang lain: removed=%s (harus 0), baris tersisa=%s (harus 1)',
      case when (r->>'removed')::int = 0 and n = 1 then 'OK' else 'BUG' end, r->>'removed', n) || E'\n';

    -- pemicu server: notifikasi baru untuk pemilik token harus masuk antrean push_outbox
    select count(*) into n2 from push_outbox where user_id = cust;
    insert into notifications (user_id, kind, title, body, data)
    values (cust, 'system', 'Uji pemicu push', 'Notifikasi uji S36', jsonb_build_object('order_id', o.id));
    select count(*) into n3 from push_outbox where user_id = cust;
    log := log || format('S36d %s pemicu notifications → push_outbox bertambah %s baris (antrean dikirim push_dispatch() lewat pg_net ke Edge Function push-send)',
      case when n3 = n2 + 1 then 'OK' else 'BUG' end, n3 - n2) || E'\n';

    perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
    r := unregister_push_token('tok-uji-s36-pelanggan');
    select count(*) into n from push_tokens where token = 'tok-uji-s36-pelanggan';
    log := log || format('S36e %s unregister_push_token oleh pemilik: removed=%s, baris tersisa=%s (harus 0)',
      case when (r->>'removed')::int = 1 and n = 0 then 'OK' else 'BUG' end, r->>'removed', n) || E'\n';

    j := push_dispatch(10);
    log := log || format('S36f %s push_dispatch() aman saat push_config belum diisi (tanpa error): %s',
      case when j ? 'skipped' or j ? 'ok' then 'OK' else 'BUG' end, j::text) || E'\n';
  exception when others then perform set_config('role', 'none', true); log := log || 'S36 BUG token push: ' || sqlerrm || E'\n'; end;

  -- ===== S37 Batas komisi roda dua (Perpres 27/2026) =====
  begin
    select commission_pct into num1 from pricing where service = 'ride_motor';
    log := log || format('S37a %s komisi ride_motor = %s%% (harus <= %s%% sesuai Perpres 27/2026)',
      case when num1 <= commission_cap_two_wheel() then 'OK' else 'BUG' end, num1, commission_cap_two_wheel()) || E'\n';

    begin
      update pricing set commission_pct = 20 where service = 'ride_motor';
      log := log || 'S37b BUG pengawal tidak menolak komisi 20% untuk ride_motor' || E'\n';
    exception when others then
      log := log || format('S37b OK pengawal menolak komisi di atas batas: %s', left(sqlerrm, 90)) || E'\n';
    end;

    begin
      update pricing set commission_pct = 7 where service = 'ride_motor';
      select commission_pct into num1 from pricing where service = 'ride_motor';
      log := log || format('S37c %s nilai di bawah batas tetap diterima (7%%): sekarang %s%%',
        case when num1 = 7 then 'OK' else 'BUG' end, num1) || E'\n';
      update pricing set commission_pct = commission_cap_two_wheel() where service = 'ride_motor';
    exception when others then log := log || 'S37c BUG nilai sah ikut ditolak: ' || sqlerrm || E'\n'; end;

    select commission_pct into num1 from pricing where service = 'ride_car';
    log := log || format('S37d %s layanan non-roda-dua tidak terpengaruh: ride_car = %s%% (keputusan food/send menunggu opini hukum)',
      case when num1 = 20 then 'OK' else 'BUG' end, num1) || E'\n';
  exception when others then log := log || 'S37 BUG batas komisi: ' || sqlerrm || E'\n'; end;

  -- ===== S38 QC UANG — identitas bagi hasil tiap layanan (bayar AntarPay/dompet) =====
  -- Aturan uji: total yang dipotong dari pelanggan HARUS persis = kredit driver + kredit merchant + sisa platform,
  -- dan sisa platform tidak boleh negatif. Semua angka nyata dicetak agar bisa diperiksa manual.
  begin
    declare
      c0 bigint; c1 bigint; dr0 bigint; dr1 bigint; mo0 bigint; mo1 bigint;
      plat bigint; de0 bigint; komisi numeric; dbal bigint;
    begin
      -- rapikan sisa skenario sebelumnya (semua tetap ikut rollback)
      update orders set status = 'cancelled' where customer_id = cust and status in ('scheduled','searching','accepted','arrived','in_progress');
      update orders set status = 'cancelled' where driver_id in (drv, drv2, dbox) and status in ('accepted','arrived','in_progress');
      perform set_config('antaraja.bypass', 'on', true);
      update drivers set status = 'approved', status_reason = null where id in (drv, drv2, dbox);
      update profiles set is_active = true, deletion_requested_at = null, status_reason = null where id in (drv, drv2, dbox, cust, mown);
      perform set_config('antaraja.bypass', 'off', true);
      delete from order_rejections where driver_id in (drv, drv2, dbox);
      -- skenario lama (S27) mengubah wallets.balance langsung sebagai alat bantu uji; catat koreksinya di buku besar
      -- agar invarian global S53 benar-benar menguji kode aplikasi, bukan bekas alat bantu uji.
      insert into wallet_transactions (user_id, type, amount, balance_after, order_id, note)
      select wl.user_id, 'adjustment', wl.balance - coalesce(bb.jml, 0), wl.balance, null, 'Koreksi alat bantu uji QC (S27 mengubah saldo langsung)'
      from wallets wl left join (select wt.user_id as uid, sum(wt.amount) as jml from wallet_transactions wt group by wt.user_id) bb on bb.uid = wl.user_id
      where wl.balance <> coalesce(bb.jml, 0);
      perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
      tp := request_topup(10000000, 'bank_transfer', 'https://x/bukti.jpg', 'saldo uji S38');
      perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
      perform admin_review_topup(tp.id, true, 'saldo uji S38');

      -- (a) AntarRide motor
      select commission_pct into komisi from pricing where service = 'ride_motor';
      perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
      perform driver_selfie_check('https://x/selfie.jpg'); perform driver_set_online(true, 0.4810, 101.4349);
      perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
      select balance into c0 from wallets where user_id = cust; select balance into dr0 from wallets where user_id = drv;
      o := create_order(jsonb_build_object('service','ride_motor','vehicle_class','motor_economy',
        'pickup', jsonb_build_object('lat',0.4810,'lng',101.4349,'address','S38 Jemput'),
        'dropoff', jsonb_build_object('lat',0.50,'lng',101.44,'address','S38 Tujuan'), 'paid_via','wallet'));
      de0 := o.driver_earning;
      select pin into v_pin from order_pins where order_id = o.id;
      perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
      o := driver_accept_order(o.id); o := driver_update_order_status(o.id, 'arrived', null);
      o := driver_update_order_status(o.id, 'in_progress', v_pin); o := driver_update_order_status(o.id, 'completed', null);
      select balance into c1 from wallets where user_id = cust; select balance into dr1 from wallets where user_id = drv;
      plat := o.total - (dr1 - dr0);
      log := log || format('S38a %s ride_motor dompet %s: total=%s | pelanggan %s→%s (Δ%s, harus -%s) | driver Δ%s (harus %s) | platform=%s | komisi dasar %s%% dari fare %s → driver_awal %s (batas Perpres %s%%)',
        case when c1 - c0 = -o.total and dr1 - dr0 = o.driver_earning and plat >= 0
               and de0 = o.fare_delivery - floor(o.fare_delivery * komisi / 100.0) and komisi <= commission_cap_two_wheel() then 'OK' else 'BUG' end,
        o.code, o.total, c0, c1, c1 - c0, o.total, dr1 - dr0, o.driver_earning, plat, komisi, o.fare_delivery, de0, commission_cap_two_wheel()) || E'\n';

      -- (b) AntarRide mobil
      perform set_config('request.jwt.claims', json_build_object('sub', drv2, 'role', 'authenticated')::text, true);
      perform driver_selfie_check('https://x/selfie.jpg'); perform driver_set_online(true, 0.4946, 101.4314);
      perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
      select balance into c0 from wallets where user_id = cust; select balance into dr0 from wallets where user_id = drv2;
      o := create_order(jsonb_build_object('service','ride_car','vehicle_class','car_economy',
        'pickup', jsonb_build_object('lat',0.4946,'lng',101.4314,'address','S38b Jemput'),
        'dropoff', jsonb_build_object('lat',0.52,'lng',101.45,'address','S38b Tujuan'), 'paid_via','wallet'));
      select pin into v_pin from order_pins where order_id = o.id;
      perform set_config('request.jwt.claims', json_build_object('sub', drv2, 'role', 'authenticated')::text, true);
      o := driver_accept_order(o.id); o := driver_update_order_status(o.id, 'arrived', null);
      o := driver_update_order_status(o.id, 'in_progress', v_pin); o := driver_update_order_status(o.id, 'completed', null);
      select balance into c1 from wallets where user_id = cust; select balance into dr1 from wallets where user_id = drv2;
      plat := o.total - (dr1 - dr0);
      log := log || format('S38b %s ride_car dompet %s: total=%s pelanggan Δ%s (harus -%s) driver Δ%s (harus %s) platform=%s (fare=%s biaya jasa aplikasi=%s)',
        case when c1 - c0 = -o.total and dr1 - dr0 = o.driver_earning and plat = o.total - o.driver_earning and plat >= 0 then 'OK' else 'BUG' end,
        o.code, o.total, c1 - c0, o.total, dr1 - dr0, o.driver_earning, plat, o.fare_delivery, o.platform_fee) || E'\n';

      -- (c) AntarFood: pelanggan = driver + merchant + platform
      perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
      perform driver_set_online(true, -0.9405, 100.3625);
      perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
      select balance into c0 from wallets where user_id = cust; select balance into dr0 from wallets where user_id = drv; select balance into mo0 from wallets where user_id = mown;
      o := create_order(jsonb_build_object('service','food','merchant_id', merch,
        'items', jsonb_build_array(jsonb_build_object('menu_item_id', menu1, 'qty', 2)),
        'dropoff', jsonb_build_object('lat',-0.945,'lng',100.36,'address','S38c Kos'), 'paid_via','wallet'));
      perform set_config('request.jwt.claims', json_build_object('sub', mown, 'role', 'authenticated')::text, true);
      begin o := merchant_update_order(o.id, 'accepted'); exception when others then null; end;
      o := merchant_update_order(o.id, 'ready');
      perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
      o := driver_accept_order(o.id); o := driver_update_order_status(o.id, 'arrived', null);
      o := driver_update_order_status(o.id, 'in_progress', null); o := driver_update_order_status(o.id, 'completed', null);
      select balance into c1 from wallets where user_id = cust; select balance into dr1 from wallets where user_id = drv; select balance into mo1 from wallets where user_id = mown;
      plat := o.total - (dr1 - dr0) - (mo1 - mo0);
      log := log || format('S38c %s food dompet %s: total=%s (ongkir %s + jasa %s + makanan %s) | pelanggan Δ%s | driver Δ%s (harus %s) | merchant Δ%s (harus %s = %s - komisi merchant) | platform=%s',
        case when c1 - c0 = -o.total and dr1 - dr0 = o.driver_earning and mo1 - mo0 = o.merchant_earning and plat >= 0
               and o.total = (dr1 - dr0) + (mo1 - mo0) + plat then 'OK' else 'BUG' end,
        o.code, o.total, o.fare_delivery, o.platform_fee, o.items_subtotal, c1 - c0, dr1 - dr0, o.driver_earning, mo1 - mo0, o.merchant_earning, o.items_subtotal, plat) || E'\n';

      -- (d) AntarSend dalam kota
      perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
      perform driver_set_online(true, 0.4810, 101.4349);
      perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
      select balance into c0 from wallets where user_id = cust; select balance into dr0 from wallets where user_id = drv;
      o := create_order(jsonb_build_object('service','send','weight_kg',3,'size_cm',30,
        'pickup', jsonb_build_object('lat',0.4810,'lng',101.4349,'address','S38d Toko'),
        'dropoff', jsonb_build_object('lat',0.50,'lng',101.44,'address','S38d Rumah'),
        'recipient_name','Sari','recipient_phone','0811','paid_via','wallet'));
      perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
      o := driver_accept_order(o.id); o := driver_update_order_status(o.id, 'arrived', null);
      o := driver_update_order_status(o.id, 'in_progress', null); o := driver_update_order_status(o.id, 'completed', null);
      select balance into c1 from wallets where user_id = cust; select balance into dr1 from wallets where user_id = drv;
      plat := o.total - (dr1 - dr0);
      log := log || format('S38d %s send dompet %s: total=%s pelanggan Δ%s driver Δ%s (harus %s) platform=%s',
        case when c1 - c0 = -o.total and dr1 - dr0 = o.driver_earning and plat >= 0 then 'OK' else 'BUG' end,
        o.code, o.total, c1 - c0, dr1 - dr0, o.driver_earning, plat) || E'\n';

      -- (e) AntarBox (driver box + helper)
      perform set_config('request.jwt.claims', json_build_object('sub', dbox, 'role', 'authenticated')::text, true);
      perform driver_selfie_check('https://x/selfie.jpg'); perform driver_set_online(true, 0.4950, 101.4320);
      perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
      select balance into c0 from wallets where user_id = cust; select balance into dr0 from wallets where user_id = dbox;
      o := create_order(jsonb_build_object('service','box','helpers',2,'purpose','pindahan',
        'pickup', jsonb_build_object('lat',0.4950,'lng',101.4320,'address','S38e Kos lama'),
        'dropoff', jsonb_build_object('lat',0.5100,'lng',101.4450,'address','S38e Kos baru'), 'paid_via','wallet'));
      select pin into v_pin from order_pins where order_id = o.id;
      perform set_config('request.jwt.claims', json_build_object('sub', dbox, 'role', 'authenticated')::text, true);
      o := driver_accept_order(o.id); o := driver_update_order_status(o.id, 'arrived', null);
      o := driver_update_order_status(o.id, 'in_progress', v_pin); o := driver_update_order_status(o.id, 'completed', null);
      select balance into c1 from wallets where user_id = cust; select balance into dr1 from wallets where user_id = dbox;
      plat := o.total - (dr1 - dr0);
      log := log || format('S38e %s box dompet %s: total=%s (fare %s termasuk 2 helper) pelanggan Δ%s driver Δ%s (harus %s) platform=%s',
        case when c1 - c0 = -o.total and dr1 - dr0 = o.driver_earning and plat >= 0 then 'OK' else 'BUG' end,
        o.code, o.total, o.fare_delivery, c1 - c0, dr1 - dr0, o.driver_earning, plat) || E'\n';

      -- (f) AntarShop: driver harus menerima penggantian belanja + jasa belanja
      perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
      perform driver_set_online(true, 0.5168, 101.4463);
      perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
      select balance into c0 from wallets where user_id = cust; select balance into dr0 from wallets where user_id = drv;
      o := create_order(jsonb_build_object('service','shop','shop_store_id', store1, 'shop_vehicle','motor',
        'shopping_list', jsonb_build_array(jsonb_build_object('product_id', prod1, 'qty', 2)),
        'dropoff', jsonb_build_object('lat',0.52,'lng',101.45,'address','S38f Rumah'), 'paid_via','wallet'));
      perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
      o := driver_accept_order(o.id); o := driver_update_order_status(o.id, 'arrived', null);
      o := set_shopping_actual(o.id, 149000, 'https://x/nota.jpg', null);
      o := driver_update_order_status(o.id, 'in_progress', null); o := driver_update_order_status(o.id, 'completed', null);
      select balance into c1 from wallets where user_id = cust; select balance into dr1 from wallets where user_id = drv;
      plat := o.total - (dr1 - dr0);
      log := log || format('S38f %s shop dompet %s: anggaran=%s belanja riil=%s jasa belanja=%s (bagian driver %s) total=%s | pelanggan Δ%s (harus -%s) | driver Δ%s (harus %s = pendapatan %s + ganti belanja %s) | platform=%s',
        case when c1 - c0 = -o.total and dr1 - dr0 = o.driver_earning + o.items_subtotal and plat >= 0 then 'OK' else 'BUG' end,
        o.code, o.est_budget, o.items_subtotal, o.service_fee, o.driver_service_share, o.total, c1 - c0, o.total,
        dr1 - dr0, o.driver_earning + o.items_subtotal, o.driver_earning, o.items_subtotal, plat) || E'\n';

      -- (g) AntarMarket
      perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
      perform driver_set_online(true, 0.5345, 101.4407);
      perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
      select balance into c0 from wallets where user_id = cust; select balance into dr0 from wallets where user_id = drv;
      o := create_order(jsonb_build_object('service','market','market_id', mk, 'shop_vehicle','motor',
        'shopping_list', jsonb_build_array(jsonb_build_object('item_id', item1, 'qty', 2)),
        'dropoff', jsonb_build_object('lat',0.52,'lng',101.45,'address','S38g Rumah'), 'paid_via','wallet'));
      perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
      o := driver_accept_order(o.id); o := driver_update_order_status(o.id, 'arrived', null);
      o := set_shopping_actual(o.id, 29000, 'https://x/nota.jpg', jsonb_build_array(jsonb_build_object('item_id', item1, 'price', 14500, 'qty', 2)));
      o := driver_update_order_status(o.id, 'in_progress', null); o := driver_update_order_status(o.id, 'completed', null);
      select balance into c1 from wallets where user_id = cust; select balance into dr1 from wallets where user_id = drv;
      plat := o.total - (dr1 - dr0);
      log := log || format('S38g %s market dompet %s: belanja riil=%s jasa=%s total=%s pelanggan Δ%s driver Δ%s (harus %s) platform=%s',
        case when c1 - c0 = -o.total and dr1 - dr0 = o.driver_earning + o.items_subtotal and plat >= 0 then 'OK' else 'BUG' end,
        o.code, o.items_subtotal, o.service_fee, o.total, c1 - c0, dr1 - dr0, o.driver_earning + o.items_subtotal, plat) || E'\n';
    end;
  exception when others then log := log || 'S38 BUG identitas bagi hasil dompet: ' || sqlerrm || E'\n'; end;

  -- ===== S39 QC UANG — order TUNAI: uang tunai yang dipegang driver harus persis pendapatannya =====
  -- Invarian: total tunai yang diterima driver - penggantian barang - potongan wallet = driver_earning.
  begin
    declare c0 bigint; c1 bigint; dr0 bigint; dr1 bigint; sisa bigint; harus bigint;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
      perform driver_set_online(true, 0.4810, 101.4349);
      perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
      select balance into c0 from wallets where user_id = cust; select balance into dr0 from wallets where user_id = drv;
      o := create_order(jsonb_build_object('service','ride_motor','vehicle_class','motor_economy',
        'pickup', jsonb_build_object('lat',0.4810,'lng',101.4349,'address','S39a Jemput'),
        'dropoff', jsonb_build_object('lat',0.50,'lng',101.44,'address','S39a Tujuan'), 'paid_via','cash'));
      select pin into v_pin from order_pins where order_id = o.id;
      perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
      o := driver_accept_order(o.id); o := driver_update_order_status(o.id, 'arrived', null);
      o := driver_update_order_status(o.id, 'in_progress', v_pin); o := driver_update_order_status(o.id, 'completed', null);
      select balance into c1 from wallets where user_id = cust; select balance into dr1 from wallets where user_id = drv;
      sisa := o.total + (dr1 - dr0);
      log := log || format('S39a %s ride_motor tunai %s: pelanggan bayar tunai %s (saldo pelanggan Δ%s harus 0) | potongan wallet driver Δ%s | sisa di tangan driver=%s (harus = pendapatan %s)',
        case when c1 = c0 and sisa = o.driver_earning then 'OK' else 'BUG' end,
        o.code, o.total, c1 - c0, dr1 - dr0, sisa, o.driver_earning) || E'\n';

      perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
      select balance into dr0 from wallets where user_id = drv;
      o := create_order(jsonb_build_object('service','send','weight_kg',3,'size_cm',30,
        'pickup', jsonb_build_object('lat',0.4810,'lng',101.4349,'address','S39b Toko'),
        'dropoff', jsonb_build_object('lat',0.50,'lng',101.44,'address','S39b Rumah'),
        'recipient_name','Sari','recipient_phone','0811','paid_via','cash'));
      perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
      o := driver_accept_order(o.id); o := driver_update_order_status(o.id, 'arrived', null);
      o := driver_update_order_status(o.id, 'in_progress', null); o := driver_update_order_status(o.id, 'completed', null);
      select balance into dr1 from wallets where user_id = drv;
      sisa := o.total + (dr1 - dr0);
      log := log || format('S39b %s send tunai %s: tunai %s potongan wallet Δ%s sisa=%s (harus %s)',
        case when sisa = o.driver_earning then 'OK' else 'BUG' end, o.code, o.total, dr1 - dr0, sisa, o.driver_earning) || E'\n';

      -- (c) AntarShop tunai: driver menalangi belanja, harus balik modal persis
      perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
      perform driver_set_online(true, 0.5168, 101.4463);
      perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
      select balance into dr0 from wallets where user_id = drv;
      o := create_order(jsonb_build_object('service','shop','shop_store_id', store1, 'shop_vehicle','motor',
        'shopping_list', jsonb_build_array(jsonb_build_object('product_id', prod1, 'qty', 1)),
        'dropoff', jsonb_build_object('lat',0.52,'lng',101.45,'address','S39c Rumah'), 'paid_via','cash'));
      perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
      o := driver_accept_order(o.id); o := driver_update_order_status(o.id, 'arrived', null);
      o := set_shopping_actual(o.id, 74500, 'https://x/nota.jpg', null);
      o := driver_update_order_status(o.id, 'in_progress', null); o := driver_update_order_status(o.id, 'completed', null);
      select balance into dr1 from wallets where user_id = drv;
      sisa := o.total - o.items_subtotal + (dr1 - dr0);
      log := log || format('S39c %s shop tunai %s: tunai diterima %s - modal belanja %s + potongan wallet %s = %s (harus = pendapatan %s)',
        case when sisa = o.driver_earning then 'OK' else 'BUG' end, o.code, o.total, o.items_subtotal, dr1 - dr0, sisa, o.driver_earning) || E'\n';
    end;
  exception when others then log := log || 'S39 BUG order tunai: ' || sqlerrm || E'\n'; end;

  -- ===== S40 QC UANG — siapa yang menanggung diskon promo pada order TUNAI =====
  begin
    declare dr0 bigint; dr1 bigint; sisa bigint;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
      insert into promos (code, description, discount_type, value, max_discount, min_total, service, quota, is_active, valid_from, valid_to)
      values ('QCTUNAI40', 'Uji QC diskon order tunai', 'fixed', 3000, null, 0, null, 50, true, now() - interval '1 day', now() + interval '1 day')
      on conflict (code) do update set is_active = true, value = 3000, quota = 50, used_count = 0, valid_to = now() + interval '1 day';
      perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
      perform driver_set_online(true, 0.4810, 101.4349);
      perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
      select balance into dr0 from wallets where user_id = drv;
      o := create_order(jsonb_build_object('service','ride_motor','vehicle_class','motor_economy',
        'pickup', jsonb_build_object('lat',0.4810,'lng',101.4349,'address','S40 Jemput'),
        'dropoff', jsonb_build_object('lat',0.50,'lng',101.44,'address','S40 Tujuan'),
        'paid_via','cash','promo_code','QCTUNAI40'));
      select pin into v_pin from order_pins where order_id = o.id;
      perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
      o := driver_accept_order(o.id); o := driver_update_order_status(o.id, 'arrived', null);
      o := driver_update_order_status(o.id, 'in_progress', v_pin); o := driver_update_order_status(o.id, 'completed', null);
      select balance into dr1 from wallets where user_id = drv;
      sisa := o.total + (dr1 - dr0);
      log := log || format('S40 %s promo pada order TUNAI %s: diskon=%s total tunai=%s potongan platform=%s sisa driver=%s (harus %s). Selisih=%s → %s',
        case when sisa = o.driver_earning then 'OK' else 'BUG' end, o.code, o.discount, o.total, dr1 - dr0, sisa, o.driver_earning,
        o.driver_earning - sisa,
        case when sisa = o.driver_earning then 'diskon ditanggung platform' else 'diskon dipotong dari pendapatan driver' end) || E'\n';
    end;
  exception when others then log := log || 'S40 BUG promo tunai: ' || sqlerrm || E'\n'; end;

  -- ===== S41 QC UANG — AntarSend antar kota TUNAI: ongkir antar kota harus disetor ke platform =====
  begin
    declare dr0 bigint; dr1 bigint; sisa bigint;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
      perform driver_set_online(true, -0.9405, 100.3625);
      perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
      select balance into dr0 from wallets where user_id = drv;
      o := create_order(jsonb_build_object('service','send','send_scope','intercity','dest_city_id', city_bkt, 'warehouse_id', wh_dest,
        'weight_kg', 3, 'size_cm', 40,
        'pickup', jsonb_build_object('lat',-0.9405,'lng',100.3625,'address','S41 Toko'),
        'dropoff', jsonb_build_object('lat',-0.3,'lng',100.37,'address','S41 Bukittinggi'),
        'recipient_name','Andi','recipient_phone','0812','paid_via','cash'));
      perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
      o := driver_accept_order(o.id); o := driver_update_order_status(o.id, 'arrived', null);
      o := driver_update_order_status(o.id, 'in_progress', null); o := driver_update_order_status(o.id, 'completed', null);
      select balance into dr1 from wallets where user_id = drv;
      sisa := o.total + (dr1 - dr0);
      log := log || format('S41 %s send antar kota TUNAI %s: ongkir kota=%s + jasa=%s + ongkir antar kota=%s → tunai %s | potongan platform=%s | sisa driver=%s (harus %s) | selisih=%s',
        case when sisa = o.driver_earning then 'OK' else 'BUG' end, o.code, o.fare_delivery, o.platform_fee, o.intercity_fare, o.total,
        dr1 - dr0, sisa, o.driver_earning, sisa - o.driver_earning) || E'\n';
      log := log || format('S41b catatan: ongkir antar kota %s dipakai membayar mitra travel/gudang di sisi platform; bila tidak ditagih ke driver order tunai, platform membayar tanpa pernah menerima.', o.intercity_fare) || E'\n';
    end;
  exception when others then log := log || 'S41 BUG send antar kota tunai: ' || sqlerrm || E'\n'; end;

  -- ===== S42 QC UANG — AntarFood TUNAI: bagian merchant =====
  begin
    declare dr0 bigint; dr1 bigint; mo0 bigint; mo1 bigint; sisa bigint;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
      perform driver_set_online(true, -0.9405, 100.3625);
      perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
      select balance into dr0 from wallets where user_id = drv; select balance into mo0 from wallets where user_id = mown;
      o := create_order(jsonb_build_object('service','food','merchant_id', merch,
        'items', jsonb_build_array(jsonb_build_object('menu_item_id', menu1, 'qty', 2)),
        'dropoff', jsonb_build_object('lat',-0.945,'lng',100.36,'address','S42 Kos'), 'paid_via','cash'));
      perform set_config('request.jwt.claims', json_build_object('sub', mown, 'role', 'authenticated')::text, true);
      begin o := merchant_update_order(o.id, 'accepted'); exception when others then null; end;
      o := merchant_update_order(o.id, 'ready');
      perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
      o := driver_accept_order(o.id); o := driver_update_order_status(o.id, 'arrived', null);
      o := driver_update_order_status(o.id, 'in_progress', null); o := driver_update_order_status(o.id, 'completed', null);
      select balance into dr1 from wallets where user_id = drv; select balance into mo1 from wallets where user_id = mown;
      sisa := o.total - o.merchant_earning + (dr1 - dr0);
      log := log || format('S42 %s food TUNAI %s: tunai %s (makanan %s) | driver bayar merchant tunai %s | potongan platform=%s | sisa driver=%s (harus %s) | saldo merchant Δ%s (tunai: wajar 0)',
        case when sisa = o.driver_earning then 'OK' else 'BUG' end, o.code, o.total, o.items_subtotal, o.merchant_earning,
        dr1 - dr0, sisa, o.driver_earning, mo1 - mo0) || E'\n';
    end;
  exception when others then log := log || 'S42 BUG food tunai: ' || sqlerrm || E'\n'; end;

  -- ===== S43 QC UANG — aturan promo: kedaluwarsa, kuota habis, dipakai 2x orang yang sama, diskon > subtotal =====
  begin
    declare d1x bigint; d2x bigint; kuota int; pakai int;
    begin
      perform set_config('antaraja.bypass', 'on', true);
      insert into promos (code, description, discount_type, value, max_discount, min_total, service, quota, used_count, is_active, valid_from, valid_to)
      values ('QCEXP43', 'Uji QC promo kedaluwarsa', 'fixed', 5000, null, 0, null, 100, 0, true, now() - interval '10 days', now() - interval '1 day'),
             ('QCKUOTA43', 'Uji QC kuota habis', 'fixed', 2000, null, 0, null, 1, 0, true, now() - interval '1 day', now() + interval '1 day'),
             ('QCDUA43', 'Uji QC dipakai dua kali orang sama', 'fixed', 2000, null, 0, null, 50, 0, true, now() - interval '1 day', now() + interval '1 day'),
             ('QCBESAR43', 'Uji QC diskon melebihi subtotal', 'fixed', 99999999, null, 0, null, 50, 0, true, now() - interval '1 day', now() + interval '1 day')
      on conflict (code) do update set is_active = true, used_count = 0, quota = excluded.quota, value = excluded.value,
        valid_from = excluded.valid_from, valid_to = excluded.valid_to;
      perform set_config('antaraja.bypass', 'off', true);
      perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
      update orders set status = 'cancelled' where customer_id = cust and status in ('scheduled','searching','accepted','arrived','in_progress');

      -- (a) kode kedaluwarsa harus ditolak
      begin
        o := create_order(jsonb_build_object('service','ride_motor','vehicle_class','motor_economy','pickup', jsonb_build_object('lat',0.4810,'lng',101.4349,'address','A'),
          'dropoff', jsonb_build_object('lat',0.49,'lng',101.44,'address','B'), 'paid_via','cash','promo_code','QCEXP43'));
        log := log || format('S43a BUG kode kedaluwarsa QCEXP43 diterima (order %s diskon %s)', o.code, o.discount) || E'\n';
        perform cancel_order(o.id, 'uji');
      exception when others then
        log := log || format('S43a %s kode kedaluwarsa ditolak: %s', case when sqlerrm ilike '%promo%' then 'OK' else 'BUG' end, left(sqlerrm, 70)) || E'\n';
      end;

      -- (b) kuota habis: pemakaian ke-2 harus ditolak
      o := create_order(jsonb_build_object('service','ride_motor','vehicle_class','motor_economy','pickup', jsonb_build_object('lat',0.4810,'lng',101.4349,'address','A'),
        'dropoff', jsonb_build_object('lat',0.49,'lng',101.44,'address','B1'), 'paid_via','cash','promo_code','QCKUOTA43'));
      d1x := o.discount; ordid := o.id;
      select quota, used_count into kuota, pakai from promos where code = 'QCKUOTA43';
      begin
        o2 := create_order(jsonb_build_object('service','ride_motor','vehicle_class','motor_economy','pickup', jsonb_build_object('lat',0.4810,'lng',101.4349,'address','A'),
          'dropoff', jsonb_build_object('lat',0.49,'lng',101.44,'address','B2'), 'paid_via','cash','promo_code','QCKUOTA43'));
        log := log || format('S43b BUG kuota habis tidak ditegakkan: order ke-2 %s tetap dapat diskon %s (kuota=%s terpakai=%s)', o2.code, o2.discount, kuota, pakai) || E'\n';
        perform cancel_order(o2.id, 'uji');
      exception when others then
        log := log || format('S43b %s kuota habis (kuota=%s terpakai=%s) → pemakaian ke-2 ditolak: %s',
          case when sqlerrm ilike '%promo%' then 'OK' else 'BUG' end, kuota, pakai, left(sqlerrm, 60)) || E'\n';
      end;
      perform cancel_order(ordid, 'uji');

      -- (c) orang yang sama memakai kode yang sama dua kali
      o := create_order(jsonb_build_object('service','ride_motor','vehicle_class','motor_economy','pickup', jsonb_build_object('lat',0.4810,'lng',101.4349,'address','A'),
        'dropoff', jsonb_build_object('lat',0.49,'lng',101.44,'address','C1'), 'paid_via','cash','promo_code','QCDUA43'));
      d1x := o.discount; ordid := o.id;
      begin
        o2 := create_order(jsonb_build_object('service','ride_motor','vehicle_class','motor_economy','pickup', jsonb_build_object('lat',0.4810,'lng',101.4349,'address','A'),
          'dropoff', jsonb_build_object('lat',0.49,'lng',101.44,'address','C2'), 'paid_via','cash','promo_code','QCDUA43'));
        d2x := o2.discount;
        log := log || format('S43c BUG pelanggan yang sama memakai QCDUA43 dua kali: order 1 diskon=%s, order 2 %s diskon=%s (tidak ada batas per pengguna)', d1x, o2.code, d2x) || E'\n';
        perform cancel_order(o2.id, 'uji');
      exception when others then
        log := log || format('S43c OK pemakaian kedua oleh orang yang sama ditolak (diskon pertama %s): %s', d1x, left(sqlerrm, 70)) || E'\n';
      end;
      perform cancel_order(ordid, 'uji');

      -- (d) diskon jauh lebih besar dari subtotal → total tidak boleh negatif / gratis berlebihan
      o := create_order(jsonb_build_object('service','ride_motor','vehicle_class','motor_economy','pickup', jsonb_build_object('lat',0.4810,'lng',101.4349,'address','A'),
        'dropoff', jsonb_build_object('lat',0.49,'lng',101.44,'address','D'), 'paid_via','cash','promo_code','QCBESAR43'));
      log := log || format('S43d %s diskon Rp99.999.999 pada ongkir %s: diskon tercatat=%s total=%s (harus >= 0 dan diskon <= ongkir)',
        case when o.discount <= o.fare_delivery and o.total >= 0 then 'OK' else 'BUG' end, o.fare_delivery, o.discount, o.total) || E'\n';
      perform cancel_order(o.id, 'uji');

      -- (e) pembatalan mengembalikan kuota promo
      select used_count into pakai from promos where code = 'QCBESAR43';
      log := log || format('S43e %s pembatalan mengembalikan kuota promo QCBESAR43 → used_count=%s (harus 0)', case when pakai = 0 then 'OK' else 'BUG' end, pakai) || E'\n';
    end;
  exception when others then log := log || 'S43 BUG aturan promo: ' || sqlerrm || E'\n'; end;

  -- ===== S44 QC UANG — pembatalan di tiap tahap: dana kembali utuh, tidak ada uang tercipta/menguap =====
  begin
    declare c0 bigint; c1 bigint; dr0 bigint; dr1 bigint; tot bigint;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
      perform driver_set_online(true, 0.4810, 101.4349);
      perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
      update orders set status = 'cancelled' where customer_id = cust and status in ('scheduled','searching','accepted','arrived','in_progress');

      -- (a) batal saat masih mencari driver
      select balance into c0 from wallets where user_id = cust;
      o := create_order(jsonb_build_object('service','ride_motor','vehicle_class','motor_economy','pickup', jsonb_build_object('lat',0.4810,'lng',101.4349,'address','S44a'),
        'dropoff', jsonb_build_object('lat',0.50,'lng',101.44,'address','S44a2'), 'paid_via','wallet'));
      tot := o.total; o := cancel_order(o.id, 'uji batal searching');
      select balance into c1 from wallets where user_id = cust;
      log := log || format('S44a %s batal saat SEARCHING: dipotong %s lalu dikembalikan, saldo %s→%s (Δ%s harus 0) status=%s bayar=%s',
        case when c1 = c0 and o.status = 'cancelled' and o.payment_status = 'refunded' then 'OK' else 'BUG' end, tot, c0, c1, c1 - c0, o.status, o.payment_status) || E'\n';

      -- (b) batal setelah driver menerima
      select balance into c0 from wallets where user_id = cust; select balance into dr0 from wallets where user_id = drv;
      o := create_order(jsonb_build_object('service','ride_motor','vehicle_class','motor_economy','pickup', jsonb_build_object('lat',0.4810,'lng',101.4349,'address','S44b'),
        'dropoff', jsonb_build_object('lat',0.50,'lng',101.44,'address','S44b2'), 'paid_via','wallet'));
      tot := o.total;
      perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
      o := driver_accept_order(o.id);
      perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
      o := cancel_order(o.id, 'uji batal accepted');
      select balance into c1 from wallets where user_id = cust; select balance into dr1 from wallets where user_id = drv;
      log := log || format('S44b %s batal saat ACCEPTED: total=%s pelanggan Δ%s (harus 0) driver Δ%s (harus 0 — tidak ada biaya pembatalan yang ditagihkan) status=%s',
        case when c1 = c0 and dr1 = dr0 and o.status = 'cancelled' then 'OK' else 'BUG' end, tot, c1 - c0, dr1 - dr0, o.status) || E'\n';

      -- (c) batal setelah driver tiba
      select balance into c0 from wallets where user_id = cust; select balance into dr0 from wallets where user_id = drv;
      o := create_order(jsonb_build_object('service','ride_motor','vehicle_class','motor_economy','pickup', jsonb_build_object('lat',0.4810,'lng',101.4349,'address','S44c'),
        'dropoff', jsonb_build_object('lat',0.50,'lng',101.44,'address','S44c2'), 'paid_via','wallet'));
      tot := o.total;
      perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
      o := driver_accept_order(o.id); o := driver_update_order_status(o.id, 'arrived', null);
      perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
      o := cancel_order(o.id, 'uji batal arrived');
      select balance into c1 from wallets where user_id = cust; select balance into dr1 from wallets where user_id = drv;
      log := log || format('S44c %s batal saat ARRIVED: total=%s pelanggan Δ%s (harus 0) driver Δ%s (harus 0) status=%s',
        case when c1 = c0 and dr1 = dr0 and o.status = 'cancelled' then 'OK' else 'BUG' end, tot, c1 - c0, dr1 - dr0, o.status) || E'\n';

      -- (d) batal saat perjalanan berlangsung harus DITOLAK untuk pelanggan
      o := create_order(jsonb_build_object('service','ride_motor','vehicle_class','motor_economy','pickup', jsonb_build_object('lat',0.4810,'lng',101.4349,'address','S44d'),
        'dropoff', jsonb_build_object('lat',0.50,'lng',101.44,'address','S44d2'), 'paid_via','wallet'));
      select pin into v_pin from order_pins where order_id = o.id; ordid := o.id;
      perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
      o := driver_accept_order(o.id); o := driver_update_order_status(o.id, 'arrived', null); o := driver_update_order_status(o.id, 'in_progress', v_pin);
      begin
        perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
        perform cancel_order(ordid, 'driver batal saat jalan');
        log := log || 'S44d BUG driver bisa membatalkan order yang sedang berjalan' || E'\n';
      exception when others then log := log || format('S44d OK driver tidak bisa membatalkan saat IN_PROGRESS: %s', left(sqlerrm, 60)) || E'\n'; end;
      begin
        perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
        perform cancel_order(ordid, 'pelanggan batal saat jalan');
        log := log || 'S44e BUG pelanggan bisa membatalkan order yang sedang berjalan' || E'\n';
      exception when others then log := log || format('S44e OK pelanggan tidak bisa membatalkan saat IN_PROGRESS: %s', left(sqlerrm, 60)) || E'\n'; end;

      -- (f) TIP yang sudah dibayar sebelum order batal
      perform set_config('request.jwt.claims', json_build_object('sub', drv2, 'role', 'authenticated')::text, true);
      perform driver_set_online(true, 0.4946, 101.4314);
      perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
      select balance into c0 from wallets where user_id = cust; select balance into dr0 from wallets where user_id = drv2;
      o2 := create_order(jsonb_build_object('service','ride_car','vehicle_class','car_economy',
        'pickup', jsonb_build_object('lat',0.4946,'lng',101.4314,'address','S44f'),
        'dropoff', jsonb_build_object('lat',0.52,'lng',101.45,'address','S44f2'), 'paid_via','wallet'));
      perform set_config('request.jwt.claims', json_build_object('sub', drv2, 'role', 'authenticated')::text, true);
      o2 := driver_accept_order(o2.id);
      perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
      o2 := add_tip(o2.id, 20000);
      o2 := cancel_order(o2.id, 'uji tip lalu batal');
      select balance into c1 from wallets where user_id = cust; select balance into dr1 from wallets where user_id = drv2;
      log := log || format('S44f %s tip Rp20.000 dibayar saat ACCEPTED lalu order dibatalkan: pelanggan Δ%s (harus 0) driver Δ%s (harus 0) tip tercatat=%s → uang %s',
        case when c1 = c0 and dr1 = dr0 then 'OK' else 'BUG' end, c1 - c0, dr1 - dr0, o2.tip,
        case when c1 = c0 and dr1 = dr0 then 'kembali utuh' else format('MENGUAP Rp%s (dipotong dari pelanggan, tidak masuk ke siapa pun)', c0 - c1) end) || E'\n';

      -- (g) merchant menolak pesanan food yang sudah dibayar
      perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
      select balance into c0 from wallets where user_id = cust;
      o := create_order(jsonb_build_object('service','food','merchant_id', merch,
        'items', jsonb_build_array(jsonb_build_object('menu_item_id', menu1, 'qty', 1)),
        'dropoff', jsonb_build_object('lat',-0.945,'lng',100.36,'address','S44g'), 'paid_via','wallet','promo_code','QCDUA43'));
      tot := o.total; d0 := o.discount;
      perform set_config('request.jwt.claims', json_build_object('sub', mown, 'role', 'authenticated')::text, true);
      o := merchant_update_order(o.id, 'rejected');
      select balance into c1 from wallets where user_id = cust;
      select used_count into n from promos where code = 'QCDUA43';
      log := log || format('S44g %s merchant menolak order dibayar (total=%s diskon=%s): pelanggan Δ%s (harus 0) status=%s bayar=%s | kuota promo QCDUA43 terpakai=%s (harus dikembalikan seperti cancel_order)',
        case when c1 = c0 and o.status = 'cancelled' and o.payment_status = 'refunded' then 'OK' else 'BUG' end,
        tot, d0, c1 - c0, o.status, o.payment_status, n) || E'\n';
    end;
  exception when others then log := log || 'S44 BUG pembatalan bertahap: ' || sqlerrm || E'\n'; end;

  -- ===== S45 QC UANG — pembatalan sepihak & refund oleh admin =====
  begin
    declare c0 bigint; c1 bigint; dr0 bigint; dr1 bigint; tot bigint; adj bigint;
    begin
      -- tutup sisa order aktif dari S44 (satu order sengaja ditinggalkan IN_PROGRESS untuk menguji penolakan pembatalan)
      perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
      for ordid in select id from orders where status in ('scheduled','searching','accepted','arrived','in_progress') and (customer_id = cust or driver_id in (drv, drv2, dbox)) loop
        perform cancel_order(ordid, 'bersih sisa uji S44 (dana dikembalikan lewat cancel_order)');
      end loop;
      perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
      perform driver_set_online(true, 0.4810, 101.4349);
      perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
      select balance into c0 from wallets where user_id = cust; select balance into dr0 from wallets where user_id = drv;
      o := create_order(jsonb_build_object('service','ride_motor','vehicle_class','motor_economy','pickup', jsonb_build_object('lat',0.4810,'lng',101.4349,'address','S45'),
        'dropoff', jsonb_build_object('lat',0.50,'lng',101.44,'address','S45b'), 'paid_via','wallet'));
      tot := o.total;
      select pin into v_pin from order_pins where order_id = o.id;
      perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
      o := driver_accept_order(o.id); o := driver_update_order_status(o.id, 'arrived', null); o := driver_update_order_status(o.id, 'in_progress', v_pin);
      perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
      o := cancel_order(o.id, 'Pembatalan sepihak admin (uji QC)');
      select balance into c1 from wallets where user_id = cust; select balance into dr1 from wallets where user_id = drv;
      log := log || format('S45a %s admin membatalkan order IN_PROGRESS: total=%s pelanggan Δ%s (harus 0, dana kembali utuh) driver Δ%s (harus 0) status=%s bayar=%s dibatalkan_oleh=%s',
        case when c1 = c0 and dr1 = dr0 and o.status = 'cancelled' and o.payment_status = 'refunded' then 'OK' else 'BUG' end,
        tot, c1 - c0, dr1 - dr0, o.status, o.payment_status, case when o.cancelled_by = adm then 'admin' else o.cancelled_by::text end) || E'\n';

      -- refund manual admin lewat penyesuaian saldo (butuh buka kunci PIN)
      update admin_security set pin_hash = extensions.crypt('123456', extensions.gen_salt('bf')), failed = 0, locked_until = null where user_id = adm;
      perform admin_lock();
      begin
        perform admin_adjust_wallet(cust, 25000, 'Uji refund manual admin tanpa PIN');
        log := log || 'S45b BUG penyesuaian saldo admin diterima tanpa buka kunci PIN' || E'\n';
      exception when others then log := log || format('S45b OK penyesuaian saldo butuh PIN admin: %s', left(sqlerrm, 55)) || E'\n'; end;
      perform admin_unlock('123456');
      select balance into c0 from wallets where user_id = cust;
      adj := admin_adjust_wallet(cust, 25000, 'Uji refund manual admin (QC)');
      select balance into c1 from wallets where user_id = cust;
      select count(*) into n from wallet_transactions where user_id = cust and type = 'adjustment' and amount = 25000 and created_at >= transaction_timestamp();
      log := log || format('S45c %s refund manual admin +25.000: saldo %s→%s (Δ%s) baris mutasi adjustment=%s',
        case when c1 - c0 = 25000 and n = 1 then 'OK' else 'BUG' end, c0, c1, c1 - c0, n) || E'\n';
      -- tarik kembali agar saldo kembali seperti semula
      perform admin_adjust_wallet(cust, -25000, 'Uji QC: kembalikan penyesuaian');
    end;
  exception when others then log := log || 'S45 BUG pembatalan/refund admin: ' || sqlerrm || E'\n'; end;

  -- ===== S46 QC UANG — top up: manual, ditolak, webhook Midtrans (mode simulasi) & webhook ganda =====
  begin
    declare c0 bigint; c1 bigint; c2 bigint; ext text; pay payments; jum int;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
      -- (a) top up manual ditolak admin → saldo tidak berubah
      select balance into c0 from wallets where user_id = cust;
      tp := request_topup(150000, 'bank_transfer', 'https://x/bukti.jpg', 'uji tolak');
      perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
      tp := admin_review_topup(tp.id, false, 'bukti tidak jelas');
      select balance into c1 from wallets where user_id = cust;
      log := log || format('S46a %s top up manual DITOLAK: status=%s saldo %s→%s (Δ%s harus 0)',
        case when c1 = c0 and tp.status = 'rejected' then 'OK' else 'BUG' end, tp.status, c0, c1, c1 - c0) || E'\n';

      -- (b) top up manual disetujui dua kali → hanya satu kredit
      perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
      tp := request_topup(150000, 'bank_transfer', 'https://x/bukti.jpg', 'uji setujui');
      perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
      tp := admin_review_topup(tp.id, true, 'ok');
      select balance into c1 from wallets where user_id = cust;
      begin
        perform admin_review_topup(tp.id, true, 'ok lagi');
        select balance into c2 from wallets where user_id = cust;
        log := log || format('S46b BUG persetujuan top up kedua diterima: saldo %s→%s (dobel Rp%s)', c1, c2, c2 - c1) || E'\n';
      exception when others then
        select balance into c2 from wallets where user_id = cust;
        log := log || format('S46b %s top up +150.000 sekali (%s→%s), persetujuan ulang ditolak: %s',
          case when c1 - c0 = 150000 and c2 = c1 then 'OK' else 'BUG' end, c0, c1, left(sqlerrm, 45)) || E'\n';
      end;

      -- (c) webhook Midtrans mode simulasi: settlement dikirim DUA KALI dengan id sama → hanya satu kredit
      ext := 'AKPAY-QC-' || left(gen_random_uuid()::text, 8);
      insert into payments (user_id, order_id, purpose, amount, method, provider, status, external_id)
      values (cust, null, 'topup', 275000, 'qris', 'simulated', 'pending', ext) returning * into pay;
      select balance into c0 from wallets where user_id = cust;
      pay := payment_settle(ext, 'settlement', jsonb_build_object('uji', 'webhook-1'));
      select balance into c1 from wallets where user_id = cust;
      pay := payment_settle(ext, 'settlement', jsonb_build_object('uji', 'webhook-2-duplikat'));
      select balance into c2 from wallets where user_id = cust;
      select count(*) into jum from wallet_transactions where ref = ext;
      log := log || format('S46c %s webhook settlement dikirim 2x (external_id=%s): saldo %s→%s→%s | kredit pertama=%s (harus 275000) kredit kedua=%s (harus 0) | baris mutasi ber-ref sama=%s (harus 1) status=%s',
        case when c1 - c0 = 275000 and c2 = c1 and jum = 1 then 'OK' else 'BUG' end, ext, c0, c1, c2, c1 - c0, c2 - c1, jum, pay.status) || E'\n';

      -- (d) webhook gagal/kedaluwarsa tidak menambah saldo
      ext := 'AKPAY-QC-' || left(gen_random_uuid()::text, 8);
      insert into payments (user_id, order_id, purpose, amount, method, provider, status, external_id)
      values (cust, null, 'topup', 99000, 'qris', 'simulated', 'pending', ext);
      select balance into c0 from wallets where user_id = cust;
      pay := payment_settle(ext, 'expire', null);
      select balance into c1 from wallets where user_id = cust;
      select count(*) into jum from wallet_transactions where ref = ext;
      log := log || format('S46d %s webhook status "expire": saldo Δ%s (harus 0) baris mutasi=%s (harus 0) status pembayaran=%s',
        case when c1 = c0 and jum = 0 then 'OK' else 'BUG' end, c1 - c0, jum, pay.status) || E'\n';

      -- (e) external_id yang tidak dikenal harus ditolak (bukan diam-diam membuat saldo)
      begin
        pay := payment_settle('AKPAY-TIDAK-ADA-QC', 'settlement', null);
        log := log || 'S46e BUG webhook dengan external_id tak dikenal diterima' || E'\n';
      exception when others then log := log || format('S46e OK webhook external_id tak dikenal ditolak: %s', left(sqlerrm, 50)) || E'\n'; end;
    end;
  exception when others then log := log || 'S46 BUG top up: ' || sqlerrm || E'\n'; end;

  -- ===== S47 QC UANG — penarikan dana: saldo kurang, melebihi saldo, penarikan ganda, ditolak → refund =====
  begin
    declare b_awal bigint; b1x bigint; b2x bigint; w2 withdrawal_requests;
    begin
      -- pakai pemilik merchant sebagai penguji agar tidak mengganggu saldo driver di skenario lain
      perform set_config('antaraja.bypass', 'on', true);
      insert into bank_accounts (user_id, bank_name, account_no, holder, verified)
      values (mown, 'BCA', '900900', 'Uji Tarik', true)
      on conflict (user_id) do update set verified = true, bank_name = 'BCA', account_no = '900900', holder = 'Uji Tarik';
      perform set_config('antaraja.bypass', 'off', true);
      perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
      insert into admin_security (user_id, pin_hash) select adm, extensions.crypt('123456', extensions.gen_salt('bf')) where not exists (select 1 from admin_security where user_id = adm);
      update admin_security set pin_hash = extensions.crypt('123456', extensions.gen_salt('bf')), failed = 0, locked_until = null where user_id = adm;
      perform admin_unlock('123456');
      for f in select * from fraud_flags where subject_id = mown and status = 'open' loop perform admin_review_fraud(f.id, 'dismissed', 'uji QC', false); end loop;
      -- setel saldo uji tepat 100.000 lewat penyesuaian resmi (tercatat di buku besar)
      select balance into b_awal from wallets where user_id = mown;
      perform admin_adjust_wallet(mown, 100000 - b_awal, 'Uji QC S47: setel saldo penguji ke Rp100.000');
      select balance into b_awal from wallets where user_id = mown;

      perform set_config('request.jwt.claims', json_build_object('sub', mown, 'role', 'authenticated')::text, true);
      -- (a) di bawah minimum
      begin perform request_withdrawal(5000, 'BCA', '900900', 'Uji Tarik');
        log := log || 'S47a BUG penarikan Rp5.000 (di bawah minimum) diterima' || E'\n';
      exception when others then log := log || format('S47a OK penarikan di bawah minimum ditolak: %s', left(sqlerrm, 50)) || E'\n'; end;

      -- (b) nominal negatif
      begin perform request_withdrawal(-50000, 'BCA', '900900', 'Uji Tarik');
        select balance into b1x from wallets where user_id = mown;
        log := log || format('S47b BUG penarikan nominal NEGATIF diterima → saldo %s→%s', b_awal, b1x) || E'\n';
      exception when others then log := log || format('S47b OK penarikan nominal negatif ditolak: %s', left(sqlerrm, 50)) || E'\n'; end;

      -- (c) melebihi saldo
      begin perform request_withdrawal(b_awal + 1, 'BCA', '900900', 'Uji Tarik');
        select balance into b1x from wallets where user_id = mown;
        log := log || format('S47c BUG penarikan melebihi saldo (%s > %s) diterima → saldo jadi %s', b_awal + 1, b_awal, b1x) || E'\n';
      exception when others then log := log || format('S47c OK penarikan melebihi saldo (%s > %s) ditolak: %s', b_awal + 1, b_awal, left(sqlerrm, 45)) || E'\n'; end;

      -- (d) penarikan ganda (double-spend): dua kali tarik seluruh saldo
      w := request_withdrawal(b_awal, 'BCA', '900900', 'Uji Tarik');
      select balance into b1x from wallets where user_id = mown;
      begin
        w2 := request_withdrawal(b_awal, 'BCA', '900900', 'Uji Tarik');
        select balance into b2x from wallets where user_id = mown;
        log := log || format('S47d BUG double-spend penarikan: dua permintaan Rp%s masing-masing berhasil, saldo %s→%s→%s (minus %s)', b_awal, b_awal, b1x, b2x, -b2x) || E'\n';
      exception when others then
        select balance into b2x from wallets where user_id = mown;
        log := log || format('S47d %s penarikan kedua atas saldo yang sama ditolak: saldo %s→%s (harus 0) permintaan ke-2 gagal: %s',
          case when b1x = 0 and b2x = 0 then 'OK' else 'BUG' end, b_awal, b2x, left(sqlerrm, 40)) || E'\n';
      end;

      -- (e) admin menolak penarikan → saldo kembali utuh
      perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
      perform admin_unlock('123456');
      if w.status = 'pending' then
        w := admin_review_withdrawal(w.id, false, 'uji tolak QC');
      else
        -- penarikan disetujui otomatis; buat satu lagi yang manual untuk menguji jalur penolakan
        perform admin_adjust_wallet(mown, 60000, 'Uji QC S47e: modal uji penolakan');
        perform set_config('request.jwt.claims', json_build_object('sub', mown, 'role', 'authenticated')::text, true);
        perform set_config('antaraja.bypass', 'on', true);
        update bank_accounts set verified = false where user_id = mown;
        perform set_config('antaraja.bypass', 'off', true);
        w := request_withdrawal(60000, 'BNI', '900901', 'Uji Tarik');
        perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
        perform admin_unlock('123456');
        w := admin_review_withdrawal(w.id, false, 'uji tolak QC');
      end if;
      select balance into b2x from wallets where user_id = mown;
      log := log || format('S47e %s penarikan Rp%s ditolak admin → saldo dikembalikan menjadi %s (harus = nominal yang ditolak) status=%s auto=%s',
        case when b2x = w.amount and w.status = 'rejected' then 'OK' else 'BUG' end, w.amount, b2x, w.status, w.auto) || E'\n';

      -- (f) tidak ada saldo negatif akibat penarikan
      select count(*) into n from wallets where user_id = mown and balance < 0;
      log := log || format('S47f %s saldo penguji tidak pernah minus setelah semua percobaan penarikan (%s baris minus, saldo akhir %s)',
        case when n = 0 then 'OK' else 'BUG' end, n, b2x) || E'\n';
    end;
  exception when others then log := log || 'S47 BUG penarikan dana: ' || sqlerrm || E'\n'; end;

  -- ===== S48 QC UANG — konkurensi & idempotensi: satu order satu driver, order kembar =====
  begin
    declare c0 bigint; c1 bigint; tot bigint; id1 uuid; id2 uuid; siapa uuid;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
      update orders set status = 'cancelled' where customer_id = cust and status in ('scheduled','searching','accepted','arrived','in_progress');
      perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
      perform driver_set_online(true, 0.4950, 101.4320);
      perform set_config('request.jwt.claims', json_build_object('sub', drv2, 'role', 'authenticated')::text, true);
      perform driver_set_online(true, 0.4950, 101.4320);
      perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
      o := create_order(jsonb_build_object('service','send','weight_kg',3,'size_cm',30,
        'pickup', jsonb_build_object('lat',0.4950,'lng',101.4320,'address','S48 Toko'),
        'dropoff', jsonb_build_object('lat',0.5000,'lng',101.4400,'address','S48 Rumah'),
        'recipient_name','Sari','recipient_phone','0811','paid_via','cash'));
      ordid := o.id;
      -- dua driver berebut order yang sama
      perform set_config('request.jwt.claims', json_build_object('sub', drv2, 'role', 'authenticated')::text, true);
      o := driver_accept_order(ordid);
      siapa := o.driver_id;
      begin
        perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
        o2 := driver_accept_order(ordid);
        log := log || format('S48a BUG dua driver memegang order yang sama: driver_id akhir=%s', o2.driver_id) || E'\n';
      exception when others then
        select driver_id into siapa from orders where id = ordid;
        select count(*) into n from order_events where order_id = ordid and status = 'accepted';
        log := log || format('S48a %s dua driver berebut order %s: pemenang=%s, driver kedua ditolak (%s); baris peristiwa "accepted"=%s (harus 1)',
          case when siapa = drv2 and n = 1 then 'OK' else 'BUG' end, o.code, case when siapa = drv2 then 'driver-2' else siapa::text end, left(sqlerrm, 45), n) || E'\n';
      end;
      -- driver melepas order → driver lain baru boleh mengambil
      perform set_config('request.jwt.claims', json_build_object('sub', drv2, 'role', 'authenticated')::text, true);
      perform cancel_order(ordid, 'lepas order untuk uji');
      perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
      o := driver_accept_order(ordid);
      log := log || format('S48b %s setelah driver-2 melepas, driver-1 boleh mengambil: status=%s driver=%s',
        case when o.driver_id = drv and o.status = 'accepted' then 'OK' else 'BUG' end, o.status, case when o.driver_id = drv then 'driver-1' else o.driver_id::text end) || E'\n';
      perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
      perform cancel_order(ordid, 'bersih');

      -- create_order dipanggil dua kali cepat (double tap): pastikan tidak ada saldo ganda tersembunyi
      select balance into c0 from wallets where user_id = cust;
      o := create_order(jsonb_build_object('service','ride_motor','vehicle_class','motor_economy',
        'pickup', jsonb_build_object('lat',0.4810,'lng',101.4349,'address','S48c'),
        'dropoff', jsonb_build_object('lat',0.50,'lng',101.44,'address','S48c2'), 'paid_via','wallet'));
      id1 := o.id; tot := o.total;
      begin
        o2 := create_order(jsonb_build_object('service','ride_motor','vehicle_class','motor_economy',
          'pickup', jsonb_build_object('lat',0.4810,'lng',101.4349,'address','S48c'),
          'dropoff', jsonb_build_object('lat',0.50,'lng',101.44,'address','S48c2'), 'paid_via','wallet'));
        id2 := o2.id;
      exception when others then id2 := null; k1 := sqlerrm; end;
      select balance into c1 from wallets where user_id = cust;
      if id2 is null then
        log := log || format('S48c OK panggilan create_order kedua (double tap) ditolak: %s; saldo dipotong sekali Rp%s', left(k1, 60), c0 - c1) || E'\n';
      else
        log := log || format('S48c CATATAN double tap menghasilkan 2 order (%s & %s) dan 2 pemotongan Rp%s+Rp%s=Rp%s; tidak ada uang tercipta/hilang, tetapi tidak ada kunci idempotensi di create_order — pelanggan wajib membatalkan order kembar untuk dapat refund',
          o.code, o2.code, tot, o2.total, c0 - c1) || E'\n';
        perform cancel_order(id2, 'batal order kembar');
      end if;
      select balance into c1 from wallets where user_id = cust;
      perform cancel_order(id1, 'bersih');
      select balance into c1 from wallets where user_id = cust;
      log := log || format('S48d %s setelah semua order kembar dibatalkan, saldo kembali ke nilai semula (%s, Δ%s harus 0)',
        case when c1 = c0 then 'OK' else 'BUG' end, c1, c1 - c0) || E'\n';
    end;
  exception when others then log := log || 'S48 BUG konkurensi: ' || sqlerrm || E'\n'; end;

  -- ===== S49 QC UANG — pembatalan AntarShop setelah driver terlanjur belanja =====
  begin
    declare c0 bigint; c1 bigint; dr0 bigint; dr1 bigint; belanja bigint; tot bigint;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
      perform driver_set_online(true, 0.5168, 101.4463);
      perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
      select balance into c0 from wallets where user_id = cust; select balance into dr0 from wallets where user_id = drv;
      o := create_order(jsonb_build_object('service','shop','shop_store_id', store1, 'shop_vehicle','motor',
        'shopping_list', jsonb_build_array(jsonb_build_object('product_id', prod1, 'qty', 2)),
        'dropoff', jsonb_build_object('lat',0.52,'lng',101.45,'address','S49 Rumah'), 'paid_via','wallet'));
      perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
      o := driver_accept_order(o.id); o := driver_update_order_status(o.id, 'arrived', null);
      o := set_shopping_actual(o.id, 149000, 'https://x/nota.jpg', null);
      belanja := o.items_subtotal; tot := o.total; ordid := o.id;
      perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
      begin
        o := cancel_order(ordid, 'uji batal setelah driver belanja');
        select balance into c1 from wallets where user_id = cust; select balance into dr1 from wallets where user_id = drv;
        log := log || format('S49 %s pelanggan membatalkan SETELAH driver membayar belanja Rp%s di toko: pelanggan Δ%s (refund penuh Rp%s) driver Δ%s (harus dapat ganti Rp%s) → %s',
          case when dr1 - dr0 >= belanja then 'OK' else 'BUG' end, belanja, c1 - c0, tot, dr1 - dr0, belanja,
          case when dr1 - dr0 >= belanja then 'driver diganti' else format('driver menombok Rp%s, uang belanja hilang dari sistem', belanja - (dr1 - dr0)) end) || E'\n';
      exception when others then
        select balance into c1 from wallets where user_id = cust; select balance into dr1 from wallets where user_id = drv;
        log := log || format('S49 OK pembatalan ditolak setelah driver membayar belanja Rp%s (pelanggan Δ%s driver Δ%s): %s',
          belanja, c1 - c0, dr1 - dr0, left(sqlerrm, 90)) || E'\n';
        perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
        o := driver_update_order_status(ordid, 'in_progress', null); o := driver_update_order_status(ordid, 'completed', null);
      end;
    end;
  exception when others then log := log || 'S49 BUG batal setelah belanja: ' || sqlerrm || E'\n'; end;

  -- ===== S50 QC UANG — bagi hasil travel: kursi bersama, carter, titipan antar kota (dompet & tunai) =====
  begin
    declare c0 bigint; c1 bigint; p0 bigint; p1 bigint; plat bigint; tunai bigint;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
      update orders set status = 'cancelled' where customer_id = cust and status in ('scheduled','searching','accepted','arrived','in_progress');

      -- (a) kursi bersama dibayar dompet
      perform set_config('request.jwt.claims', json_build_object('sub', drv2, 'role', 'authenticated')::text, true);
      tt := travel_trip_create(jsonb_build_object('route_id', route1, 'depart_at', (now() + interval '2 days')::text, 'seats_total', 6, 'seat_price', 150000, 'allow_private', false));
      perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
      select balance into c0 from wallets where user_id = cust; select balance into p0 from wallets where user_id = drv2;
      tb := travel_book(jsonb_build_object('trip_id', tt.id, 'pax', 2, 'pickup_address', 'S50a Jemput', 'pickup_lat', 0.5, 'pickup_lng', 101.44,
        'passengers', jsonb_build_array(jsonb_build_object('name','A'), jsonb_build_object('name','B')), 'paid_via', 'wallet'));
      select balance into c1 from wallets where user_id = cust;
      perform set_config('request.jwt.claims', json_build_object('sub', drv2, 'role', 'authenticated')::text, true);
      perform travel_trip_set_status(tt.id, 'departed', null);
      perform travel_trip_set_status(tt.id, 'arrived', null);
      select balance into p1 from wallets where user_id = drv2;
      plat := tb.price - (p1 - p0);
      log := log || format('S50a %s travel kursi bersama DOMPET %s: harga tagihan=%s (2 kursi @150.000 + biaya aplikasi %s) | pelanggan Δ%s (harus -%s) | mitra Δ%s (harus %s) | platform=%s',
        case when c1 - c0 = -tb.price and p1 - p0 = tb.partner_earning and plat >= 0 then 'OK' else 'BUG' end,
        tb.code, tb.price, tb.platform_fee, c1 - c0, tb.price, p1 - p0, tb.partner_earning, plat) || E'\n';

      -- (b) kursi bersama dibayar TUNAI: mitra menerima tunai, platform harus menagih komisinya
      perform set_config('request.jwt.claims', json_build_object('sub', drv2, 'role', 'authenticated')::text, true);
      tt := travel_trip_create(jsonb_build_object('route_id', route1, 'depart_at', (now() + interval '3 days')::text, 'seats_total', 6, 'seat_price', 150000, 'allow_private', false));
      perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
      select balance into c0 from wallets where user_id = cust; select balance into p0 from wallets where user_id = drv2;
      tb := travel_book(jsonb_build_object('trip_id', tt.id, 'pax', 1, 'pickup_address', 'S50b Jemput', 'pickup_lat', 0.5, 'pickup_lng', 101.44,
        'passengers', jsonb_build_array(jsonb_build_object('name','C')), 'paid_via', 'cash'));
      perform set_config('request.jwt.claims', json_build_object('sub', drv2, 'role', 'authenticated')::text, true);
      perform travel_trip_set_status(tt.id, 'departed', null);
      perform travel_trip_set_status(tt.id, 'arrived', null);
      select balance into c1 from wallets where user_id = cust; select balance into p1 from wallets where user_id = drv2;
      tunai := tb.price + (p1 - p0);
      log := log || format('S50b %s travel kursi bersama TUNAI %s: tunai diterima mitra=%s | saldo pelanggan Δ%s (harus 0) | potongan platform ke mitra Δ%s | sisa mitra=%s (harus %s)',
        case when c1 = c0 and tunai = tb.partner_earning then 'OK' else 'BUG' end,
        tb.code, tb.price, c1 - c0, p1 - p0, tunai, tb.partner_earning) || E'\n';

      -- (c) pembatalan booking travel → dana kembali utuh
      perform set_config('request.jwt.claims', json_build_object('sub', drv2, 'role', 'authenticated')::text, true);
      tt := travel_trip_create(jsonb_build_object('route_id', route1, 'depart_at', (now() + interval '4 days')::text, 'seats_total', 6, 'seat_price', 150000, 'allow_private', false));
      perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
      select balance into c0 from wallets where user_id = cust;
      tb := travel_book(jsonb_build_object('trip_id', tt.id, 'pax', 1, 'pickup_address', 'S50c Jemput', 'pickup_lat', 0.5, 'pickup_lng', 101.44,
        'passengers', jsonb_build_array(jsonb_build_object('name','D')), 'paid_via', 'wallet'));
      tb := travel_booking_cancel(tb.id, 'uji batal');
      select balance into c1 from wallets where user_id = cust;
      log := log || format('S50c %s batal booking travel %s: dipotong %s lalu dikembalikan, saldo Δ%s (harus 0) status=%s bayar=%s',
        case when c1 = c0 and tb.status = 'cancelled' and tb.payment_status = 'refunded' then 'OK' else 'BUG' end,
        tb.code, tb.price, c1 - c0, tb.status, tb.payment_status) || E'\n';

      -- (d) carter (permintaan → tawaran → selesai) dibayar dompet
      perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
      tr := travel_request_create(jsonb_build_object('kind','charter','depart_at', (now() + interval '5 days')::text,
        'pickup_address','S50d Pekanbaru','pickup_lat',0.5,'pickup_lng',101.44,'dropoff_address','Bukittinggi','pax',4,
        'accommodation','customer','fuel','partner','budget',600000,'paid_via','wallet'));
      perform set_config('request.jwt.claims', json_build_object('sub', drv2, 'role', 'authenticated')::text, true);
      tofr := travel_offer_create(tr.id, 500000, jsonb_build_object('base', 500000), 'Innova 2021');
      perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
      select balance into c0 from wallets where user_id = cust; select balance into p0 from wallets where user_id = drv2;
      tr := travel_offer_accept(tofr.id);
      select balance into c1 from wallets where user_id = cust;
      perform set_config('request.jwt.claims', json_build_object('sub', drv2, 'role', 'authenticated')::text, true);
      perform travel_request_set_status(tr.id, 'ongoing', null);
      tr := travel_request_set_status(tr.id, 'completed', null);
      select balance into p1 from wallets where user_id = drv2;
      plat := tr.price - (p1 - p0);
      log := log || format('S50d %s travel carter DOMPET %s: harga=%s | pelanggan Δ%s (harus -%s) | mitra Δ%s (harus %s) | biaya platform tercatat=%s | platform nyata=%s',
        case when c1 - c0 = -tr.price and p1 - p0 = tr.partner_earning and plat = tr.platform_fee then 'OK' else 'BUG' end,
        tr.code, tr.price, c1 - c0, tr.price, p1 - p0, tr.partner_earning, tr.platform_fee, plat) || E'\n';

      -- (e) carter dibatalkan mendadak (< 12 jam) → potongan 30%
      perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
      tr := travel_request_create(jsonb_build_object('kind','charter','depart_at', (now() + interval '4 hours')::text,
        'pickup_address','S50e Pekanbaru','pickup_lat',0.5,'pickup_lng',101.44,'dropoff_address','Bukittinggi','pax',4,
        'accommodation','customer','fuel','partner','budget',400000,'paid_via','wallet'));
      perform set_config('request.jwt.claims', json_build_object('sub', drv2, 'role', 'authenticated')::text, true);
      tofr := travel_offer_create(tr.id, 400000, jsonb_build_object('base', 400000), 'Innova 2021');
      perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
      select balance into c0 from wallets where user_id = cust;
      tr := travel_offer_accept(tofr.id);
      tr := travel_request_set_status(tr.id, 'cancelled', 'uji batal mendadak');
      select balance into c1 from wallets where user_id = cust;
      log := log || format('S50e %s carter dibatalkan < 12 jam sebelum berangkat: harga=%s saldo Δ%s (harus -%s = potongan 30%%) status bayar=%s',
        case when c1 - c0 = -(tr.price - floor(tr.price * 0.7)::bigint) and tr.payment_status = 'refunded' then 'OK' else 'BUG' end,
        tr.price, c1 - c0, tr.price - floor(tr.price * 0.7)::bigint, tr.payment_status) || E'\n';

      -- (f) titipan AntarSend antar kota lewat mitra travel — DIBAYAR DOMPET
      perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
      select balance into c0 from wallets where user_id = cust; select balance into p0 from wallets where user_id = drv2;
      o := create_order(jsonb_build_object('service','send','send_scope','intercity','via','travel','dest_city_id', city_bkt, 'warehouse_id', wh_dest,
        'weight_kg', 5, 'size_cm', 40, 'pickup', jsonb_build_object('lat',-0.9405,'lng',100.3625,'address','S50f Toko'),
        'dropoff', jsonb_build_object('lat',-0.3,'lng',100.37,'address','S50f Bukittinggi'),
        'recipient_name','Andi','recipient_phone','0812','paid_via','wallet'));
      perform set_config('request.jwt.claims', json_build_object('sub', drv2, 'role', 'authenticated')::text, true);
      o := travel_accept_send(o.id); o := travel_pickup_send(o.id); o := travel_complete_send(o.id);
      select balance into c1 from wallets where user_id = cust; select balance into p1 from wallets where user_id = drv2;
      plat := o.total - (p1 - p0);
      log := log || format('S50f %s titipan travel DOMPET %s: total=%s (ongkir antar kota %s) pelanggan Δ%s (harus -%s) mitra Δ%s (harus %s%% x %s) platform=%s',
        case when c1 - c0 = -o.total and p1 - p0 = round(o.intercity_fare * setting_num('travel_send_partner_pct', 80) / 100.0)::bigint and plat >= 0 then 'OK' else 'BUG' end,
        o.code, o.total, o.intercity_fare, c1 - c0, o.total, p1 - p0, setting_num('travel_send_partner_pct', 80), o.intercity_fare, plat) || E'\n';

      -- (g) titipan AntarSend antar kota lewat mitra travel — DIBAYAR TUNAI
      perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
      select balance into c0 from wallets where user_id = cust; select balance into p0 from wallets where user_id = drv2;
      o := create_order(jsonb_build_object('service','send','send_scope','intercity','via','travel','dest_city_id', city_bkt, 'warehouse_id', wh_dest,
        'weight_kg', 5, 'size_cm', 40, 'pickup', jsonb_build_object('lat',-0.9405,'lng',100.3625,'address','S50g Toko'),
        'dropoff', jsonb_build_object('lat',-0.3,'lng',100.37,'address','S50g Bukittinggi'),
        'recipient_name','Andi','recipient_phone','0812','paid_via','cash'));
      perform set_config('request.jwt.claims', json_build_object('sub', drv2, 'role', 'authenticated')::text, true);
      o := travel_accept_send(o.id); o := travel_pickup_send(o.id); o := travel_complete_send(o.id);
      select balance into c1 from wallets where user_id = cust; select balance into p1 from wallets where user_id = drv2;
      tunai := o.total + (p1 - p0);
      log := log || format('S50g %s titipan travel TUNAI %s: tunai diterima mitra=%s | saldo pelanggan Δ%s (harus 0) | saldo mitra Δ%s | sisa di tangan mitra=%s (harus %s = bagian mitra) | selisih=%s',
        case when c1 = c0 and tunai = round(o.intercity_fare * setting_num('travel_send_partner_pct', 80) / 100.0)::bigint then 'OK' else 'BUG' end,
        o.code, o.total, c1 - c0, p1 - p0, tunai, round(o.intercity_fare * setting_num('travel_send_partner_pct', 80) / 100.0)::bigint,
        tunai - round(o.intercity_fare * setting_num('travel_send_partner_pct', 80) / 100.0)::bigint) || E'\n';
    end;
  exception when others then log := log || 'S50 BUG bagi hasil travel: ' || sqlerrm || E'\n'; end;

  -- ===== S51 QC UANG — tip, harga dinamis (surge), dan pesanan terjadwal =====
  begin
    declare c0 bigint; c1 bigint; dr0 bigint; dr1 bigint; f1 bigint; f2 bigint; de1 bigint; de2 bigint; tot bigint;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
      perform driver_set_online(true, 0.4810, 101.4349);
      perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
      update orders set status = 'cancelled' where customer_id = cust and status in ('scheduled','searching','accepted','arrived','in_progress');

      -- (a) tip SESUDAH order selesai: pelanggan berkurang persis, driver bertambah persis
      select balance into c0 from wallets where user_id = cust; select balance into dr0 from wallets where user_id = drv;
      o := create_order(jsonb_build_object('service','ride_motor','vehicle_class','motor_economy',
        'pickup', jsonb_build_object('lat',0.4810,'lng',101.4349,'address','S51a'),
        'dropoff', jsonb_build_object('lat',0.50,'lng',101.44,'address','S51a2'), 'paid_via','wallet'));
      select pin into v_pin from order_pins where order_id = o.id;
      perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
      o := driver_accept_order(o.id); o := driver_update_order_status(o.id, 'arrived', null);
      o := driver_update_order_status(o.id, 'in_progress', v_pin); o := driver_update_order_status(o.id, 'completed', null);
      tot := o.total;
      perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
      o := add_tip(o.id, 7000);
      select balance into c1 from wallets where user_id = cust; select balance into dr1 from wallets where user_id = drv;
      log := log || format('S51a %s tip Rp7.000 setelah selesai: pelanggan Δ%s (harus -%s) driver Δ%s (harus %s) tip di order=%s pendapatan driver=%s',
        case when c1 - c0 = -(tot + 7000) and dr1 - dr0 = o.driver_earning and o.tip = 7000 then 'OK' else 'BUG' end,
        c1 - c0, tot + 7000, dr1 - dr0, o.driver_earning, o.tip, o.driver_earning) || E'\n';

      -- (b) tip melebihi saldo harus ditolak, tidak boleh membuat saldo minus
      select balance into c0 from wallets where user_id = cust;
      begin
        perform add_tip(o.id, 500000000);
        log := log || 'S51b BUG tip di atas batas diterima' || E'\n';
      exception when others then
        select balance into c1 from wallets where user_id = cust;
        log := log || format('S51b %s tip di luar batas ditolak dan saldo tidak berubah (Δ%s): %s',
          case when c1 = c0 then 'OK' else 'BUG' end, c1 - c0, left(sqlerrm, 55)) || E'\n';
      end;

      -- (c) surge: komisi tetap proporsional, driver ikut menikmati kenaikan
      perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
      j := estimate_fare('ride_motor', 0.4810, 101.4349, 0.50, 101.44, null);
      f1 := (j->>'fare')::bigint;
      o := create_order(jsonb_build_object('service','ride_motor','vehicle_class','motor_economy',
        'pickup', jsonb_build_object('lat',0.4810,'lng',101.4349,'address','S51c'),
        'dropoff', jsonb_build_object('lat',0.50,'lng',101.44,'address','S51c2'), 'paid_via','cash'));
      de1 := o.driver_earning; f2 := o.fare_delivery; ordid := o.id;
      r := estimate_fare('ride_motor', 0.4810, 101.4349, 0.50, 101.44, null);
      log := log || format('S51c %s harga dinamis: tarif dasar=%s pengali permintaan=%s tarif order=%s bagian driver=%s (%s%% dari tarif) — porsi driver tidak berubah oleh surge',
        case when f2 > 0 and de1 > 0 and abs(round(de1 * 100.0 / f2, 1) - round((f2 - floor(f2 * (select commission_pct from pricing where service='ride_motor') / 100.0)) * 100.0 / f2, 1)) < 0.2 then 'OK' else 'BUG' end,
        f1, coalesce(r->'demand'->>'multiplier', '1.00'), f2, de1, round(de1 * 100.0 / nullif(f2,0), 1)) || E'\n';
      perform cancel_order(ordid, 'bersih');

      -- (d) pesanan terjadwal: dana ditahan saat pemesanan, kembali utuh bila dibatalkan, tanpa biaya jadwal tersembunyi
      select balance into c0 from wallets where user_id = cust;
      o := create_order(jsonb_build_object('service','ride_motor','vehicle_class','motor_economy','scheduled_at', (now() + interval '45 minutes')::text,
        'pickup', jsonb_build_object('lat',0.4810,'lng',101.4349,'address','S51d'),
        'dropoff', jsonb_build_object('lat',0.50,'lng',101.44,'address','S51d2'), 'paid_via','wallet'));
      select balance into c1 from wallets where user_id = cust;
      tot := o.total;
      log := log || format('S51d %s pesanan terjadwal: status=%s total=%s (ongkir %s + jasa aplikasi %s, tanpa biaya jadwal tambahan) dana ditahan Δ%s',
        case when o.status = 'scheduled' and c1 - c0 = -o.total and o.total = o.fare_delivery + o.platform_fee then 'OK' else 'BUG' end,
        o.status, o.total, o.fare_delivery, o.platform_fee, c1 - c0) || E'\n';
      o := cancel_order(o.id, 'uji batal terjadwal');
      select balance into c1 from wallets where user_id = cust;
      log := log || format('S51e %s pembatalan pesanan terjadwal mengembalikan dana utuh: saldo Δ%s (harus 0) status=%s',
        case when c1 = c0 and o.status = 'cancelled' then 'OK' else 'BUG' end, c1 - c0, o.status) || E'\n';
    end;
  exception when others then log := log || 'S51 BUG tip/surge/jadwal: ' || sqlerrm || E'\n'; end;

  -- ===== S52 QC UANG — deposit/saldo minus driver untuk order tunai =====
  begin
    declare dr0 bigint; dr1 bigint; batas bigint := -500000;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
      perform admin_unlock('123456');
      select balance into dr0 from wallets where user_id = drv;
      -- turunkan saldo driver tepat ke ambang agar bisa diuji (tercatat sebagai mutasi resmi)
      perform admin_adjust_wallet(drv, -(dr0 - 1000), 'Uji QC S52: setel saldo driver ke Rp1.000');
      select balance into dr0 from wallets where user_id = drv;
      perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
      perform driver_set_online(true, 0.4810, 101.4349);
      perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
      o := create_order(jsonb_build_object('service','ride_motor','vehicle_class','motor_economy',
        'pickup', jsonb_build_object('lat',0.4810,'lng',101.4349,'address','S52'),
        'dropoff', jsonb_build_object('lat',0.50,'lng',101.44,'address','S52b'), 'paid_via','cash'));
      select pin into v_pin from order_pins where order_id = o.id;
      perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
      o := driver_accept_order(o.id); o := driver_update_order_status(o.id, 'arrived', null);
      o := driver_update_order_status(o.id, 'in_progress', v_pin); o := driver_update_order_status(o.id, 'completed', null);
      select balance into dr1 from wallets where user_id = drv;
      log := log || format('S52a %s order TUNAI dengan saldo driver Rp%s: potongan platform Rp%s membuat saldo menjadi %s (boleh minus sebagai utang deposit)',
        case when dr1 = dr0 - (o.total - o.driver_earning) then 'OK' else 'BUG' end, dr0, o.total - o.driver_earning, dr1) || E'\n';

      -- ambang -500.000: driver tidak boleh menerima order baru
      perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
      perform admin_adjust_wallet(drv, batas - dr1 - 1, 'Uji QC S52: dorong saldo driver melewati ambang minus');
      select balance into dr1 from wallets where user_id = drv;
      perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
      o := create_order(jsonb_build_object('service','ride_motor','vehicle_class','motor_economy',
        'pickup', jsonb_build_object('lat',0.4810,'lng',101.4349,'address','S52c'),
        'dropoff', jsonb_build_object('lat',0.50,'lng',101.44,'address','S52c2'), 'paid_via','cash'));
      ordid := o.id;
      begin
        perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
        perform driver_accept_order(ordid);
        log := log || format('S52b BUG driver bersaldo %s (di bawah ambang %s) masih bisa menerima order tunai', dr1, batas) || E'\n';
      exception when others then
        log := log || format('S52b %s driver bersaldo %s (di bawah ambang %s) ditolak menerima order: %s',
          case when sqlerrm ilike '%minus%' or sqlerrm ilike '%top up%' then 'OK' else 'BUG' end, dr1, batas, left(sqlerrm, 60)) || E'\n';
      end;
      perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
      perform cancel_order(ordid, 'bersih');
      -- kembalikan saldo driver
      perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
      perform admin_adjust_wallet(drv, 600000, 'Uji QC S52: kembalikan saldo driver');
      select balance into dr1 from wallets where user_id = drv;
      log := log || format('S52c %s hanya dompet DRIVER yang boleh minus; setelah dipulihkan saldo driver=%s dan tidak ada dompet pelanggan/merchant minus (%s baris)',
        case when (select count(*) from wallets wl join profiles pr on pr.id = wl.user_id where wl.balance < 0 and pr.role <> 'driver') = 0 then 'OK' else 'BUG' end,
        dr1, (select count(*) from wallets wl join profiles pr on pr.id = wl.user_id where wl.balance < 0 and pr.role <> 'driver')) || E'\n';
    end;
  exception when others then log := log || 'S52 BUG deposit driver: ' || sqlerrm || E'\n'; end;

  -- ===== S53 QC UANG — INVARIAN GLOBAL di akhir seluruh simulasi =====
  begin
    declare rusak int; minus int; tanpa_bagi int; rincian text;
    begin
      -- (a) jumlah seluruh mutasi wallet_transactions per pengguna = wallets.balance
      with bb as (select wt.user_id as uid, sum(wt.amount) as jml from wallet_transactions wt group by wt.user_id)
      select count(*), coalesce(string_agg(wl.user_id::text || ' selisih ' || (wl.balance - coalesce(bb.jml,0)), '; '), '')
        into rusak, rincian
        from wallets wl left join bb on bb.uid = wl.user_id
        where wl.balance <> coalesce(bb.jml, 0);
      log := log || format('S53a %s buku besar cocok: dompet yang saldonya tidak sama dengan jumlah mutasinya = %s baris%s',
        case when rusak = 0 then 'OK' else 'BUG' end, rusak, case when rusak = 0 then '' else ' → ' || left(rincian, 200) end) || E'\n';

      -- (b) tidak ada order selesai tanpa baris pembagian uang
      select count(*), coalesce(string_agg(od.code || '/' || od.service || '/' || od.paid_via, ', '), '')
        into tanpa_bagi, rincian
        from orders od where od.status = 'completed'
          and not exists (select 1 from wallet_transactions wt where wt.order_id = od.id);
      log := log || format('S53b %s order berstatus selesai tanpa satu pun baris pembagian uang = %s%s',
        case when tanpa_bagi = 0 then 'OK' else 'BUG' end, tanpa_bagi, case when tanpa_bagi = 0 then '' else ' → ' || left(rincian, 200) end) || E'\n';

      -- (c) saldo negatif hanya boleh pada dompet driver (utang deposit order tunai)
      select count(*), coalesce(string_agg(coalesce(pr.role::text,'?') || ' ' || wl.balance, ', '), '')
        into minus, rincian
        from wallets wl left join profiles pr on pr.id = wl.user_id
        where wl.balance < 0 and not exists (select 1 from drivers dd where dd.id = wl.user_id);
      log := log || format('S53c %s dompet bersaldo negatif di luar driver = %s%s | saldo pelanggan uji=%s merchant uji=%s (dua-duanya harus >= 0)',
        case when minus = 0 and (select balance from wallets where user_id = cust) >= 0 and (select balance from wallets where user_id = mown) >= 0 then 'OK' else 'BUG' end,
        minus, case when minus = 0 then '' else ' → ' || left(rincian, 200) end,
        (select balance from wallets where user_id = cust), (select balance from wallets where user_id = mown)) || E'\n';

      -- (d) tiap order selesai berbayar dompet: potongan pelanggan = total order
      select count(*), coalesce(string_agg(x.code || ' bayar ' || x.dibayar || ' vs total+tip ' || (x.total + x.tip), ', '), '')
        into rusak, rincian
        from (select od.code, od.total,
                     od.tip,
                     -coalesce((select sum(wt.amount) from wallet_transactions wt where wt.order_id = od.id and wt.user_id = od.customer_id and wt.type in ('payment','refund')), 0) as dibayar
              from orders od where od.status = 'completed' and od.payment_method = 'wallet' and od.completed_at >= transaction_timestamp()) x
        where x.dibayar <> x.total + x.tip;
      log := log || format('S53d %s order dompet selesai yang potongan pelanggannya tidak sama dengan total order + tip = %s%s',
        case when rusak = 0 then 'OK' else 'BUG' end, rusak, case when rusak = 0 then '' else ' → ' || left(rincian, 240) end) || E'\n';

      -- (e) uang keluar platform per pesanan tidak boleh melebihi promo yang memang ia berikan.
      --     jumlah seluruh mutasi dompet yang menempel pada satu order = diskon - bagian kotor platform,
      --     jadi nilainya harus <= diskon pesanan itu. Lebih dari itu berarti platform membayar tanpa menerima.
      select count(*), coalesce(string_agg(z.code || ' (' || z.service || '/' || z.paid_via || ') keluar ' || z.jml || ' > diskon ' || z.diskon, ', '), '')
        into rusak, rincian
        from (select od.code, od.service::text as service, od.paid_via, coalesce(od.discount, 0) as diskon,
                     coalesce((select sum(wt.amount) from wallet_transactions wt where wt.order_id = od.id), 0) as jml
              from orders od where od.created_at >= transaction_timestamp()) z
        where z.jml > z.diskon;
      log := log || format('S53e %s order yang membuat platform membayar lebih besar dari yang diterimanya (jumlah mutasi dompet per order > diskon) = %s%s',
        case when rusak = 0 then 'OK' else 'BUG' end, rusak, case when rusak = 0 then '' else ' → ' || left(rincian, 240) end) || E'\n';
    end;
  exception when others then log := log || 'S53 BUG invarian global: ' || sqlerrm || E'\n'; end;

  raise exception using message = 'SIMULASI_SELESAI' || log;
end $sim$;
