-- =====================================================================
-- uji_travel_tarif_0124.sql — Tarif AntarTravel per km & kebijakan harga (migrasi 0124)
--   1. travel_city_distance_km Pekanbaru→Padang = haversine pusat kota × travel_road_factor (±1 km dari hitungan ulang)
--   2. travel_quote Innova charter & shared (km dari rute aktif 'route_first'; kota tanpa rute → haversine×faktor); rumus & breakdown konsisten
--   3. travel_trip_create: harga mitra di luar ±10 % quote ditolak (TRAVEL_PRICE_OUT_OF_RANGE); tanpa harga → default quote; dalam toleransi → diterima
--   4. travel_book: harga trip tetap, commission/ppn/price_breakdown tersimpan, partner_earning = driver_net, ledger travel menerima angka quote
--   5. travel_offer_create: tawaran carter < 90 % quote ditolak (TRAVEL_OFFER_TOO_LOW); tawaran wajar diterima + quote tersimpan
--   6. admin_set_travel_rate_card: non-admin ditolak; admin ubah per_km → quote berubah; porsi mitra < driver_min_share_pct ditolak; travel_rate_cards_public
--   7. pricing_policy_check: patuh → kosong; komisi ride_car dinaikkan 25 % → pelanggaran driver_share_min & fare_floor; admin_pricing_policy
-- Pola (b): begin; do $$ … raise notice '[OK] …' $$; rollback;   Lokal: scripts/db-lokal.sh test supabase/tests/uji_travel_tarif_0124.sql
-- Mengandaikan akun seed.sql: a0..01 superadmin (PIN 123456), a0..02 pelanggan, a0..04 mitra travel (Toyota HiAce Commuter, 8 kursi).
-- =====================================================================
begin;
do $$
declare
  adm  constant uuid := 'a0000000-0000-4000-8000-000000000001';
  cust constant uuid := 'a0000000-0000-4000-8000-000000000002';
  drv2 constant uuid := 'a0000000-0000-4000-8000-000000000004';
  pku uuid; pdg uuid; dmi uuid; route1 uuid; r jsonb; q jsonb; qs jsonb; q2 jsonb; v_msg text; n int;
  v_hav numeric; v_km numeric; v_factor numeric := setting_num('travel_road_factor', 1.25); v_tol numeric := setting_num('travel_price_tolerance_pct', 10);
  rc travel_rate_cards; tt travel_trips; tb travel_bookings; tr travel_requests; tofr travel_offers; b0 bigint; b1 bigint;
  exp_vehicle bigint; exp_seat bigint; ref_seat bigint; v_fare bigint; led jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  r := admin_unlock('123456');
  if not coalesce((r->>'ok')::boolean, false) then raise exception '[GAGAL] admin_unlock seed gagal: %', r; end if;
  select id into pku from cities where name = 'Pekanbaru' and active;
  select id into pdg from cities where name = 'Padang' and active;
  select id into dmi from cities where name = 'Dumai' and active;
  select id into route1 from travel_routes where from_city = pku and to_city = pdg and active limit 1;
  if pku is null or pdg is null or dmi is null or route1 is null then raise exception '[GAGAL] kota Pekanbaru/Padang/Dumai atau rute PKU→PDG tidak ada'; end if;
  perform set_config('antaraja.bypass', 'on', true);
  update profiles set is_active = true where id in (cust, drv2, adm) and not is_active;
  update travel_partners set status = 'approved' where id = drv2 and status <> 'approved';
  update wallets set balance = greatest(balance, 5000000) where user_id = cust;
  update wallets set balance = greatest(balance, 1000000) where user_id = drv2;
  perform set_config('antaraja.bypass', 'off', true);

  -- ===== 1. jarak pusat kota =====
  select round((st_distance(a.location, b.location, false) / 1000.0)::numeric, 1) into v_hav from cities a, cities b where a.id = pku and b.id = pdg;
  v_km := travel_city_distance_km(pku, pdg);
  if v_km is null or abs(v_km - round(v_hav * v_factor, 1)) > 1 then raise exception '[GAGAL] travel_city_distance_km=% ≠ %×%=%', v_km, v_hav, v_factor, round(v_hav * v_factor, 1); end if;
  if v_km < 200 or v_km > 320 then raise exception '[GAGAL] jarak PKU→PDG % km di luar rentang wajar 200–320 (haversine ±202 km × 1,25)', v_km; end if;
  raise notice '[OK] 1. Pekanbaru→Padang haversine % km × % = % km (jarak jalan rute seed 355 km)', v_hav, v_factor, v_km;

  -- ===== 2. quote Innova charter & shared =====
  select * into rc from travel_rate_cards where vehicle_model = 'Innova Reborn' and active;
  if rc.id is null then raise exception '[GAGAL] rate card Innova Reborn tidak ada'; end if;
  q := travel_quote(pku, pdg, 'Innova Reborn', 'charter', 1);
  if q->>'km_source' <> 'route' or (q->>'km')::numeric <> (select distance_km from travel_routes where id = route1) then raise exception '[GAGAL] km quote harus dari rute aktif: %', q - 'breakdown'; end if;
  exp_vehicle := (ceil(greatest(rc.base_fare + ceil((q->>'km')::numeric) * rc.per_km, rc.min_fare) / 1000.0) * 1000)::bigint;
  if (q->>'fare_vehicle')::bigint <> exp_vehicle or (q->>'fare_total')::bigint <> (ceil(exp_vehicle * rc.charter_multiplier / 1000.0) * 1000)::bigint then
    raise exception '[GAGAL] fare charter % ≠ rumus %', q->>'fare_total', exp_vehicle;
  end if;
  if (q->>'commission')::bigint <> floor((q->>'fare')::bigint * rc.platform_fee_pct / 100.0)::bigint
     or (q->>'platform_fee')::bigint <> (q->>'commission')::bigint + rc.platform_fee_flat
     or (q->>'driver_net')::bigint <> (q->>'fare')::bigint - (q->>'commission')::bigint
     or (q->>'customer_total')::bigint <> (q->>'fare')::bigint + rc.platform_fee_flat
     or (q->>'ppn')::bigint <> round((q->>'platform_fee')::bigint * setting_num('ppn_pct', 11) / (100 + setting_num('ppn_pct', 11)))::bigint
     or (q->>'driver_share_pct_actual')::numeric < rc.driver_share_pct
     or jsonb_array_length(q->'breakdown') < 5 then
    raise exception '[GAGAL] pembagian quote tidak konsisten: %', q - 'breakdown';
  end if;
  qs := travel_quote(pku, pdg, 'Innova Reborn', 'shared', 3);
  exp_seat := (ceil(exp_vehicle / rc.seats::numeric * (1 + setting_num('travel_shared_markup_pct', 15) / 100.0) / 1000.0) * 1000)::bigint;
  if (qs->>'fare_per_seat')::bigint <> exp_seat or (qs->>'fare')::bigint <> exp_seat * 3 or (qs->>'pax')::int <> 3 then raise exception '[GAGAL] quote shared: %', qs - 'breakdown'; end if;
  q2 := travel_quote(dmi, pdg, 'Avanza/Xenia', 'charter', 1);   -- tidak ada rute Dumai→Padang → haversine × faktor
  if q2->>'km_source' <> 'haversine' or (q2->>'km')::numeric <> travel_city_distance_km(dmi, pdg) then raise exception '[GAGAL] quote tanpa rute harus haversine: %', q2 - 'breakdown'; end if;
  begin perform travel_quote(pku, pku, 'Innova Reborn', 'charter', 1); raise exception '[GAGAL] asal = tujuan lolos'; exception when others then v_msg := sqlerrm; end;
  if v_msg like '[GAGAL]%' then raise exception '%', v_msg; end if;
  raise notice '[OK] 2. quote PKU→PDG Innova: % km (%) carter Rp% (mitra Rp%, komisi Rp%, biaya Rp%, PPN Rp%) · per kursi Rp% · Dumai→Padang % km (%)',
    q->>'km', q->>'km_source', q->>'fare_total', q->>'driver_net', q->>'commission', q->>'customer_platform_fee', q->>'ppn', qs->>'fare_per_seat', q2->>'km', q2->>'km_source';

  -- ===== 3. travel_trip_create: ±toleransi =====
  perform set_config('request.jwt.claims', json_build_object('sub', drv2, 'role', 'authenticated')::text, true);
  rc := travel_rate_card_for_partner(drv2);
  if rc.vehicle_model <> 'Hiace Commuter' then raise exception '[GAGAL] mitra "Toyota HiAce Commuter" dipetakan ke rate card %', rc.vehicle_model; end if;
  ref_seat := (travel_quote(pku, pdg, rc.id::text, 'shared', 1)->>'fare_per_seat')::bigint;
  begin
    perform travel_trip_create(jsonb_build_object('route_id', route1, 'depart_at', (now() + interval '1 day')::text, 'seats_total', 6, 'seat_price', floor(ref_seat * 0.7)));
    raise exception '[GAGAL] harga kursi 70 %% quote diterima';
  exception when others then v_msg := sqlerrm; end;
  if v_msg not like 'TRAVEL_PRICE_OUT_OF_RANGE%' then raise exception '[GAGAL] pesan: %', v_msg; end if;
  begin
    perform travel_trip_create(jsonb_build_object('route_id', route1, 'depart_at', (now() + interval '1 day')::text, 'seats_total', 6, 'seat_price', ceil(ref_seat * 1.25)));
    raise exception '[GAGAL] harga kursi 125 %% quote diterima';
  exception when others then v_msg := sqlerrm; end;
  if v_msg not like 'TRAVEL_PRICE_OUT_OF_RANGE%' then raise exception '[GAGAL] pesan: %', v_msg; end if;
  tt := travel_trip_create(jsonb_build_object('route_id', route1, 'depart_at', (now() + interval '1 day')::text, 'seats_total', 6, 'allow_private', true));
  if tt.seat_price <> ref_seat or tt.private_price <> (travel_quote(pku, pdg, rc.id::text, 'charter', 1)->>'fare_total')::bigint then
    raise exception '[GAGAL] default harga trip ≠ quote (kursi % vs %, carter %)', tt.seat_price, ref_seat, tt.private_price;
  end if;
  perform travel_trip_set_status(tt.id, 'cancelled', 'uji');
  tt := travel_trip_create(jsonb_build_object('route_id', route1, 'depart_at', (now() + interval '1 day')::text, 'seats_total', 6, 'seat_price', floor(ref_seat * 0.95)));
  if tt.seat_price <> floor(ref_seat * 0.95) then raise exception '[GAGAL] harga 95 %% tidak tersimpan'; end if;
  raise notice '[OK] 3. trip: 70 %% & 125 %% quote ditolak (TRAVEL_PRICE_OUT_OF_RANGE); default = quote Rp%/kursi (%); 95 %% = Rp% diterima', ref_seat, rc.vehicle_model, tt.seat_price;

  -- ===== 4. travel_book: harga trip tetap + breakdown tersimpan + ledger =====
  perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
  select balance into b0 from wallets where user_id = cust;
  tb := travel_book(jsonb_build_object('trip_id', tt.id, 'pax', 2, 'pickup_address', 'Jl. Uji 0124', 'pickup_lat', 0.5, 'pickup_lng', 101.44,
          'passengers', jsonb_build_array(jsonb_build_object('name', 'A'), jsonb_build_object('name', 'B')), 'paid_via', 'wallet'));
  select balance into b1 from wallets where user_id = cust;
  v_fare := tt.seat_price * 2;
  if tb.price <> v_fare + rc.platform_fee_flat or tb.platform_fee <> rc.platform_fee_flat then raise exception '[GAGAL] harga booking % / biaya % (harap % + %)', tb.price, tb.platform_fee, v_fare, rc.platform_fee_flat; end if;
  if tb.commission <> floor(v_fare * rc.platform_fee_pct / 100.0) or tb.partner_earning <> v_fare - tb.commission
     or tb.ppn <> round((tb.commission + tb.platform_fee) * setting_num('ppn_pct', 11) / (100 + setting_num('ppn_pct', 11)))
     or tb.price_breakdown is null or (tb.price_breakdown->>'driver_net')::bigint <> tb.partner_earning or tb.price_breakdown->>'model' <> rc.vehicle_model
     or (tb.price_breakdown->>'unit_price')::bigint <> tt.seat_price then
    raise exception '[GAGAL] breakdown booking: komisi % mitra % ppn % %', tb.commission, tb.partner_earning, tb.ppn, tb.price_breakdown;
  end if;
  if b0 - b1 <> tb.price then raise exception '[GAGAL] dompet dipotong % ≠ harga %', b0 - b1, tb.price; end if;
  led := ledger_check_source('travel_bookings', tb.id);
  select coalesce(sum(amount), 0) into n from order_ledger where source = 'travel_bookings' and source_id = tb.id and phase = 'created' and entry = 'platform_revenue';
  if n <> tb.commission + tb.platform_fee then raise exception '[GAGAL] ledger platform_revenue % ≠ komisi+biaya % (%)', n, tb.commission + tb.platform_fee, led; end if;
  select coalesce(-sum(amount), 0) into n from order_ledger where source = 'travel_bookings' and source_id = tb.id and phase = 'created' and entry = 'partner_payable';
  if n <> tb.partner_earning then raise exception '[GAGAL] ledger partner_payable % ≠ mitra %', n, tb.partner_earning; end if;
  raise notice '[OK] 4. booking %: harga Rp% (2 × Rp% + biaya Rp%), komisi Rp%, PPN Rp%, mitra Rp%; ledger platform_revenue & partner_payable = quote', tb.code, tb.price, tt.seat_price, tb.platform_fee, tb.commission, tb.ppn, tb.partner_earning;

  -- ===== 5. travel_offer_create: < 90 % quote carter ditolak =====
  tr := travel_request_create(jsonb_build_object('kind', 'charter', 'depart_at', (now() + interval '2 days')::text, 'pickup_address', 'Pekanbaru', 'pickup_lat', 0.5071, 'pickup_lng', 101.4478,
          'dropoff_address', 'Padang', 'dropoff_lat', -0.9471, 'dropoff_lng', 100.3543, 'from_city', pku, 'to_city', pdg, 'pax', 6, 'paid_via', 'wallet'));
  if tr.from_city <> pku or tr.to_city <> pdg then raise exception '[GAGAL] kota permintaan % → %', tr.from_city, tr.to_city; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', drv2, 'role', 'authenticated')::text, true);
  q := travel_quote(pku, pdg, rc.id::text, 'charter', 6);
  begin
    perform travel_offer_create(tr.id, floor((q->>'fare_total')::bigint * 0.8)::bigint, null, 'murah');
    raise exception '[GAGAL] tawaran 80 %% quote diterima';
  exception when others then v_msg := sqlerrm; end;
  if v_msg not like 'TRAVEL_OFFER_TOO_LOW%' then raise exception '[GAGAL] pesan: %', v_msg; end if;
  tofr := travel_offer_create(tr.id, ceil((q->>'fare_total')::bigint * 0.95)::bigint, jsonb_build_object('base', q->>'fare_total'), 'wajar');
  if tofr.quote is null or (tofr.quote->>'fare_total')::bigint <> (q->>'fare_total')::bigint or (tofr.quote->>'offer_vs_quote_pct')::numeric < 90 then
    raise exception '[GAGAL] quote tawaran tidak tersimpan: %', tofr.quote - 'breakdown';
  end if;
  raise notice '[OK] 5. tawaran carter PKU→PDG %: 80 %% quote Rp% ditolak (TRAVEL_OFFER_TOO_LOW); 95 %% = Rp% diterima, quote tersimpan', rc.vehicle_model, q->>'fare_total', tofr.price;

  -- ===== 6. rate card: non-admin ditolak; admin ubah; publik =====
  begin perform admin_set_travel_rate_card(jsonb_build_object('vehicle_model', 'Innova Reborn', 'per_km', 9000)); raise exception '[GAGAL] mitra bisa set rate card'; exception when others then v_msg := sqlerrm; end;
  if v_msg like '[GAGAL]%' then raise exception '%', v_msg; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
  begin perform admin_travel_rate_cards(); raise exception '[GAGAL] pelanggan bisa admin_travel_rate_cards'; exception when others then v_msg := sqlerrm; end;
  if v_msg like '[GAGAL]%' then raise exception '%', v_msg; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  r := admin_set_travel_rate_card(jsonb_build_object('vehicle_model', 'Innova Reborn', 'per_km', 5000, 'note', 'uji 0124'));
  q2 := travel_quote(pku, pdg, 'Innova Reborn', 'charter', 1);
  if (r->>'per_km')::bigint <> 5000 or (q2->>'per_km')::bigint <> 5000
     or (q2->>'fare_total')::bigint <> (ceil(greatest((r->>'base_fare')::bigint + ceil((q2->>'km')::numeric) * 5000, (r->>'min_fare')::bigint) / 1000.0) * 1000)::bigint then
    raise exception '[GAGAL] perubahan per_km tidak terpakai: % / %', r, q2 - 'breakdown';
  end if;
  begin perform admin_set_travel_rate_card(jsonb_build_object('vehicle_model', 'Innova Reborn', 'driver_share_pct', 70)); raise exception '[GAGAL] porsi mitra 70 %% diterima'; exception when others then v_msg := sqlerrm; end;
  if v_msg like '[GAGAL]%' or v_msg not ilike '%driver_min_share_pct%' then raise exception '[GAGAL] pesan porsi mitra: %', v_msg; end if;
  r := admin_set_travel_rate_card(jsonb_build_object('vehicle_model', 'Uji Elf Long', 'match_regex', 'elf long', 'seats', 16, 'per_km', 7000));
  if (r->>'seats')::int <> 16 or (travel_rate_card_pick('Isuzu ELF Long 2022', 16)).vehicle_model <> 'Uji Elf Long' then raise exception '[GAGAL] rate card baru/pemetaan: %', r; end if;
  select count(*) into n from admin_travel_rate_cards();
  if n < 6 then raise exception '[GAGAL] admin_travel_rate_cards % baris', n; end if;
  r := travel_rate_cards_public();
  if jsonb_array_length(r->'cards') < 6 or (r->'cards'->0) ? 'driver_share_pct' or (r->>'road_factor')::numeric <> v_factor then raise exception '[GAGAL] travel_rate_cards_public: %', r; end if;
  raise notice '[OK] 6. non-admin ditolak; Innova 4.500→5.000/km → carter Rp%; porsi 70 %% ditolak; kartu baru "Uji Elf Long" dipetakan; publik % kartu', q2->>'fare_total', jsonb_array_length(r->'cards');

  -- ===== 7. kebijakan harga =====
  select count(*) into n from pricing_policy_check() x where x->>'severity' = 'violation';
  if n <> 0 then raise exception '[GAGAL] kondisi awal seharusnya patuh, ada % pelanggaran: %', n, (select jsonb_agg(x) from pricing_policy_check() x); end if;
  r := admin_pricing_policy();
  if not (r->>'ok')::boolean or jsonb_array_length(r->'services') < 7 or (r->'policy'->>'driver_min_share_pct')::numeric <> setting_num('driver_min_share_pct', 80) then raise exception '[GAGAL] admin_pricing_policy: %', r; end if;
  perform admin_set_service_economics('ride_car', jsonb_build_object('driver_commission_pct', 25));
  select count(*) into n from pricing_policy_check() x where x->>'service' = 'ride_car' and x->>'rule' = 'driver_share_min' and x->>'severity' = 'violation';
  if n <> 1 then raise exception '[GAGAL] komisi mobil 25 %% tidak terdeteksi (porsi 75 %% < 80 %%)'; end if;
  perform admin_set_service_economics('ride_car', jsonb_build_object('driver_commission_pct', 15));
  perform admin_set_settings(jsonb_build_object('fare_floor_per_km_ride_motor', 2500));   -- floor > bersih driver 2.300×92 % = 2.116
  select count(*) into n from pricing_policy_check() x where x->>'service' = 'ride_motor' and x->>'rule' = 'fare_floor_per_km';
  if n <> 1 then raise exception '[GAGAL] floor 2.500 ride_motor tidak terdeteksi'; end if;
  r := admin_pricing_policy();
  if (r->>'ok')::boolean or jsonb_array_length(r->'violations') < 1 then raise exception '[GAGAL] admin_pricing_policy ok=% padahal ada pelanggaran', r->>'ok'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
  begin perform pricing_policy_check(); raise exception '[GAGAL] pelanggan bisa pricing_policy_check'; exception when others then v_msg := sqlerrm; end;
  if v_msg like '[GAGAL]%' then raise exception '%', v_msg; end if;
  raise notice '[OK] 7. kebijakan: awal patuh (0 pelanggaran); komisi mobil 25 %% → driver_share_min; floor motor 2.500 → fare_floor_per_km; admin_pricing_policy ok=false; pelanggan ditolak';
  raise notice '[OK] SELESAI_TRAVEL_0124';
end $$;
rollback;
