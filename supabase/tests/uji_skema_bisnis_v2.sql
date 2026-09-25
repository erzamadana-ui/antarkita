-- Uji Skema Bisnis v2 (migrasi 0098–0103): aturan per layanan, buku besar order, alokasi dompet,
-- bayar per order via gateway + biaya PKS (0100), iklan (0101), biaya tetap kota/payout/rekonsiliasi (0102), laporan v2 (0103),
-- penutup celah (0104, S80–S86): pagar pesanan belum lunas, pg_fee_estimate, sakelar bayar per order tanpa AntarPay,
-- ambang bisnis ber-PIN, admin_ledger_unbalanced/lookup, hapus biaya kota, rincian merchant pesanan batal.
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
-- 0100: bayar satu pesanan awaiting_payment lewat gateway tiruan = alur midtrans-create (order_payment_prepare +
-- baris payments purpose='order') lalu midtrans-webhook (payment_settle settlement dengan saluran terpetakan).
create or replace function pg_temp.v2_bayar_gateway(p_order uuid, p_channel text default null, p_status text default 'settlement')
returns payments language plpgsql as $$
declare o orders; q jsonb; ext text := 'AKPAY-V2-' || left(md5(random()::text), 12); pay payments; v_claims text := current_setting('request.jwt.claims', true);
begin
  select * into o from orders where id = p_order;
  perform set_config('request.jwt.claims', json_build_object('sub', o.customer_id, 'role', 'authenticated')::text, true);
  q := order_payment_prepare(p_order, p_channel);
  insert into payments (user_id, order_id, purpose, amount, method, provider, status, external_id, pg_channel)
  values (o.customer_id, o.id, 'order', (q->>'gross')::bigint, q->>'channel', 'simulated', 'pending', ext, q->>'channel');
  pay := payment_settle(ext, p_status, jsonb_build_object('uji', 'v2', 'payment_type', q->>'channel', 'transaction_status', p_status), q->>'channel', now());
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  return pay;
end $$;

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
  -- 0100: saluran gateway → awaiting_payment; tiru webhook Midtrans settlement (payments + payment_settle) kecuali diminta tidak dibayar
  if o.status::text = 'awaiting_payment' and not coalesce((p_opsi->>'tanpa_bayar')::boolean, false) then
    perform pg_temp.v2_bayar_gateway(o.id, null);
    select * into o from orders where id = o.id;
  end if;
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

-- 0100: selesaikan pesanan non-food/non-belanja yang sudah 'searching' (driver terima → tiba → PIN → selesai)
create or replace function pg_temp.v2_selesaikan(p_order uuid)
returns orders language plpgsql as $$
declare o orders; v_pin text; v_drv uuid;
begin
  select * into o from orders where id = p_order;
  v_drv := case o.service when 'ride_car' then 'a0000000-0000-4000-8000-000000000004'::uuid
                          when 'box' then (select id from drivers where vehicle_type in ('box','pickup') order by (status = 'approved') desc, created_at limit 1)
                          else 'a0000000-0000-4000-8000-000000000003'::uuid end;
  perform set_config('request.jwt.claims', json_build_object('sub', v_drv, 'role', 'authenticated')::text, true);
  perform driver_selfie_check('https://x/selfie.jpg'); perform driver_set_online(true, 0.4810, 101.4349);
  select pin into v_pin from order_pins where order_id = o.id;
  o := driver_accept_order(o.id); o := driver_update_order_status(o.id, 'arrived', null);
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

  -- ===== S0 fixture Finpay v3 (0105–0110; ikut di-ROLLBACK). Uji v2 memakai payments.provider='simulated', penyesuaian
  --        saldo ≥ Rp100.000, dan pg_fee_policy=customer pada kartu/VA Midtrans. Di v3: K1 (simulasi hanya bila
  --        payments_simulation_enabled & sandbox), dual approval, dan §0.5 (biaya PG ke pelanggan HANYA bila kanal
  --        pass_to_customer & pass_to_customer_legal_ok; QRIS tidak pernah) — diuji di uji_finpay_v3.sql.
  --        Di sini: simulasi dinyalakan, ambang dual approval/rate limit dilonggarkan, kartu & VA Midtrans diberi
  --        izin legal pass-through supaya skenario pg_fee_policy=customer (S45/S62/S81) tetap bermakna.
  begin
    insert into app_settings (key, value) values
      ('payments_simulation_enabled', 'true'::jsonb), ('payment_provider_env', '"sandbox"'::jsonb),
      ('wallet_adjust_dual_approval_min', '1000000000000'::jsonb), ('refund_dual_approval_min', '1000000000000'::jsonb),
      ('rate_limit_create_order_per_hour', '100000'::jsonb), ('rate_limit_payment_prepare_per_hour', '100000'::jsonb),
      ('rate_limit_withdrawal_per_hour', '100000'::jsonb)
    on conflict (key) do update set value = excluded.value, updated_at = now();
    if exists (select 1 from information_schema.columns where table_name = 'payment_channel_fees' and column_name = 'pass_to_customer_legal_ok') then
      execute $q$update payment_channel_fees set pass_to_customer = true, pass_to_customer_legal_ok = true
                 where provider = 'midtrans' and channel in ('card', 'bank_transfer')$q$;
    end if;
  exception when others then log := log || 'S0 BUG fixture v3: ' || sqlerrm || E'\n'; end;

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
    -- 0100: kartu = saluran gateway → dibayar lewat Midtrans per order, saldo AntarPay pelanggan TIDAK dipotong (Δ 0)
    log := log || format('S45 %s ride_car via card, policy=customer: total=%s = ongkir %s + biaya platform %s + biaya pembayaran %s (fee %s + ppn %s); saldo pelanggan Δ%s (gateway → 0); revenue=%s (= platform fee + komisi − bonus: %s) seimbang=%s%s',
      case when o.total = o.fare_delivery + o.platform_fee + fee_q + ppn_q and c1 = c0 and o.payment_status = 'paid' and fee_q > 0 and (lc->>'balanced')::boolean
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

  -- =====================================================================================================
  -- S60+ (migrasi 0100–0103): bayar per order via gateway, biaya PKS, iklan, biaya tetap kota, payout, rekonsiliasi, laporan v2
  -- =====================================================================================================

  -- ===== S60 QRIS per order: awaiting_payment → payment_settle → paid/searching; fee 0,7 % termasuk PPN; batal → refund saldo =====
  begin
    declare pay payments; ext text; q jsonb; v_hold interval;
    begin
      c0 := pg_temp.v2_saldo(cust);
      o := pg_temp.v2_jalankan('ride_motor', 'qris', null, '{"hanya_buat": true, "tanpa_bayar": true}');
      c1 := pg_temp.v2_saldo(cust);
      n := (select count(*) from order_ledger where order_id = o.id and phase = 'created');
      log := log || format('S60a %s qris %s dibuat: status=%s bayar=%s pg_channel=%s saldo pelanggan Δ%s (harus 0, tidak ada rail saldo) ledger created=%s baris',
        case when o.status::text = 'awaiting_payment' and o.payment_status = 'unpaid' and o.pg_channel = 'qris' and c1 = c0 and n > 0 then 'OK' else 'BUG' end,
        o.code, o.status, o.payment_status, o.pg_channel, c1 - c0, n) || E'\n';
      -- driver tidak boleh menerima pesanan yang belum dibayar
      perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
      perform driver_selfie_check('https://x/selfie.jpg'); perform driver_set_online(true, 0.4810, 101.4349);
      begin perform driver_accept_order(o.id); log := log || 'S60b BUG driver bisa menerima pesanan awaiting_payment' || E'\n';
      exception when others then log := log || format('S60b OK driver menerima pesanan belum dibayar ditolak: %s', left(sqlerrm, 60)) || E'\n'; end;
      -- midtrans-create: order_payment_prepare (JWT pelanggan) → payments(order) → webhook settlement
      perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
      q := order_payment_prepare(o.id, null);
      ext := 'AKORD-V2-' || left(md5(random()::text), 10);
      insert into payments (user_id, order_id, purpose, amount, method, provider, status, external_id, pg_channel)
      values (cust, o.id, 'order', (q->>'gross')::bigint, 'qris', 'simulated', 'pending', ext, 'qris');
      pay := payment_settle(ext, 'settlement', '{"payment_type": "qris", "acquirer": "gopay", "issuer": "dana"}'::jsonb, 'qris', now());
      select * into o from orders where id = o.id;
      c1 := pg_temp.v2_saldo(cust);
      v_hold := pay.hold_until - pay.settlement_time;
      log := log || format('S60c %s settlement qris: order status=%s bayar=%s | pg_fee=%s ppn=%s (harus round(total %s × 0,7%%)=%s, PPN termasuk=0) payments.pg_fee=%s hold=%s (H+1) | ledger created pg_fee=%s, event paid=%s, saldo pelanggan Δ%s',
        case when o.status::text = 'searching' and o.payment_status = 'paid' and o.pg_fee = round(o.total * 0.007) and o.pg_fee > 0 and o.pg_fee_ppn = 0
                  and pay.pg_fee = o.pg_fee and pay.pg_channel = 'qris' and v_hold = interval '1 day' and pg_temp.v2_led(o.id, 'pg_fee', 'created') = o.pg_fee
                  and exists (select 1 from order_events where order_id = o.id and status = 'paid') and c1 = c0 and (q->>'gross')::bigint = o.total then 'OK' else 'BUG' end,
        o.status, o.payment_status, o.pg_fee, o.pg_fee_ppn, o.total, round(o.total * 0.007), pay.pg_fee, v_hold, pg_temp.v2_led(o.id, 'pg_fee', 'created'),
        exists (select 1 from order_events where order_id = o.id and status = 'paid'), c1 - c0) || E'\n';
      -- notifikasi ganda (idempoten) tidak memproses dua kali
      n := (select count(*) from order_events where order_id = o.id);
      pay := payment_settle(ext, 'settlement', '{"payment_type": "qris"}'::jsonb, 'qris', now());
      log := log || format('S60d %s webhook settlement ganda: event tetap %s→%s, saldo tetap Δ%s', case when (select count(*) from order_events where order_id = o.id) = n and pg_temp.v2_saldo(cust) = c1 then 'OK' else 'BUG' end,
        n, (select count(*) from order_events where order_id = o.id), pg_temp.v2_saldo(cust) - c1) || E'\n';
      -- pelanggan membatalkan pesanan yang sudah dibayar via gateway → refund ke saldo AntarPay (closed-loop) + ledger refunded
      o := cancel_order(o.id, 'uji S60 batal setelah bayar qris');
      perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
      lc := ledger_check(o.id);
      log := log || format('S60e %s batal setelah bayar qris: bayar=%s saldo pelanggan Δ%s (= total %s) ledger fase=%s refund=%s',
        case when o.payment_status = 'refunded' and pg_temp.v2_saldo(cust) - c1 = o.total and lc->>'phase' = 'refunded' and (lc->>'refund')::bigint = o.total then 'OK' else 'BUG' end,
        o.payment_status, pg_temp.v2_saldo(cust) - c1, o.total, lc->>'phase', lc->>'refund') || E'\n';
      -- alur penuh sampai selesai (food via qris): dompet driver & merchant dikreditkan dari ledger, ledger seimbang, contribution = revenue − pg
      d0 := pg_temp.v2_saldo(drv); m0 := pg_temp.v2_saldo(mown); c0 := pg_temp.v2_saldo(cust);
      o := pg_temp.v2_jalankan('food', 'qris', null);
      perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
      lc := ledger_check(o.id);
      log := log || format('S60f %s food qris %s selesai: pg_fee=%s (0,7%% × %s) driver Δ%s=payable %s merchant Δ%s=payable %s saldo pelanggan Δ%s | seimbang=%s contribution=%s = revenue %s − pg %s',
        case when o.status = 'completed' and o.pg_fee = round(o.total * 0.007) and (lc->>'balanced')::boolean and pg_temp.v2_saldo(drv) - d0 = (lc->>'driver_payable')::bigint
                  and pg_temp.v2_saldo(mown) - m0 = (lc->>'merchant_payable')::bigint and pg_temp.v2_saldo(cust) = c0
                  and (lc->>'contribution')::bigint = (lc->>'platform_revenue')::bigint - o.pg_fee then 'OK' else 'BUG' end,
        o.code, o.pg_fee, o.total, pg_temp.v2_saldo(drv) - d0, lc->>'driver_payable', pg_temp.v2_saldo(mown) - m0, lc->>'merchant_payable', pg_temp.v2_saldo(cust) - c0,
        lc->>'balanced', lc->>'contribution', lc->>'platform_revenue', o.pg_fee) || E'\n';
    end;
  exception when others then log := log || 'S60 BUG qris per order: ' || sqlerrm || E'\n'; end;

  -- ===== S61 VA (bank_transfer, BSI): biaya Rp4.000 + PPN 440, hold H+2, ledger seimbang sampai selesai =====
  begin
    declare pay payments; ext text; q jsonb;
    begin
      o := pg_temp.v2_jalankan('send', 'bank_transfer', null, '{"hanya_buat": true, "tanpa_bayar": true}');
      perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
      q := order_payment_prepare(o.id, null);
      ext := 'AKORD-V2-' || left(md5(random()::text), 10);
      insert into payments (user_id, order_id, purpose, amount, method, provider, status, external_id, pg_channel)
      values (cust, o.id, 'order', (q->>'gross')::bigint, 'bank_transfer', 'simulated', 'pending', ext, 'bank_transfer');
      pay := payment_settle(ext, 'settlement', '{"payment_type": "bank_transfer", "va_numbers": [{"bank": "bsi", "va_number": "123"}]}'::jsonb, 'bank_transfer', now());
      o := pg_temp.v2_selesaikan(o.id);
      perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
      lc := ledger_check(o.id);
      log := log || format('S61 %s send VA BSI %s: pg_fee=%s ppn=%s (harus 4.000 + 440) hold=%s (BSI H+2) ledger pg_fee=%s pg_fee_ppn=%s seimbang=%s contribution=%s = revenue %s − 4.440',
        case when o.pg_fee = 4000 and o.pg_fee_ppn = 440 and pay.hold_until - pay.settlement_time = interval '2 days' and pg_temp.v2_led(o.id, 'pg_fee') = 4000
                  and pg_temp.v2_led(o.id, 'pg_fee_ppn') = 440 and (lc->>'balanced')::boolean and (lc->>'contribution')::bigint = (lc->>'platform_revenue')::bigint - 4440 then 'OK' else 'BUG' end,
        o.code, o.pg_fee, o.pg_fee_ppn, pay.hold_until - pay.settlement_time, pg_temp.v2_led(o.id, 'pg_fee'), pg_temp.v2_led(o.id, 'pg_fee_ppn'), lc->>'balanced', lc->>'contribution', lc->>'platform_revenue') || E'\n';
    end;
  exception when others then log := log || 'S61 BUG VA: ' || sqlerrm || E'\n'; end;

  -- ===== S62 pg_fee_policy=customer: "Biaya pembayaran" baris terpisah di total; ganti saluran saat bayar menghitung ulang =====
  begin
    declare q jsonb; v_base bigint;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
      se := admin_set_service_economics('send', '{"pg_fee_policy": "customer"}');
      o := pg_temp.v2_jalankan('send', 'qris', null, '{"hanya_buat": true, "tanpa_bayar": true}');
      v_base := o.fare_delivery + o.platform_fee - o.discount;
      -- Finpay v3 §0.5: QRIS TIDAK PERNAH dibebankan ke pelanggan (larangan surcharge BI) walau pg_fee_policy=customer
      -- → biaya 0,7 % ditanggung platform, total = dasar (sebelum v3: dasar + 0,7 %).
      ok := o.total = v_base and o.pg_fee = round(v_base * 0.007) and o.pg_fee_borne_by = 'platform';
      alasan := format('qris (v3: tanpa surcharge): total %s = dasar %s + biaya pembayaran %s, pg_fee %s ditanggung %s', o.total, v_base, o.total - v_base, o.pg_fee, o.pg_fee_borne_by);
      -- pelanggan ganti ke VA saat membayar → biaya pembayaran jadi 4.000 + 440
      perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
      q := order_payment_prepare(o.id, 'bank_transfer');
      select * into o from orders where id = o.id;
      ok := ok and (q->>'customer_payment_fee')::bigint = 4440 and o.total = v_base + 4440 and o.pg_channel = 'bank_transfer' and (q->>'gross')::bigint = o.total;
      perform pg_temp.v2_bayar_gateway(o.id, 'bank_transfer');
      o := pg_temp.v2_selesaikan(o.id);
      perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
      lc := ledger_check(o.id);
      log := log || format('S62 %s policy customer %s: %s; ganti VA → customer_payment_fee=%s total=%s (dasar %s + 4.440) | ledger pg_fee_customer=%s pg_fee_platform=%s revenue=%s (= biaya platform %s − promo, tidak dikurangi PG) seimbang=%s',
        case when ok and (lc->>'pg_fee_customer')::bigint = 4440 and (lc->>'pg_fee_platform')::bigint = 0 and (lc->>'platform_revenue')::bigint = o.platform_fee
                  and (lc->>'balanced')::boolean and o.payment_status = 'paid' then 'OK' else 'BUG' end,
        o.code, alasan, q->>'customer_payment_fee', o.total, v_base, lc->>'pg_fee_customer', lc->>'pg_fee_platform', lc->>'platform_revenue', o.platform_fee, lc->>'balanced') || E'\n';
      se := admin_set_service_economics('send', '{"pg_fee_policy": "platform"}');
    end;
  exception when others then log := log || 'S62 BUG policy customer: ' || sqlerrm || E'\n';
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    begin se := admin_set_service_economics('send', '{"pg_fee_policy": "platform"}'); exception when others then null; end;
  end;

  -- ===== S63 expire_unpaid_orders: > 15 menit tanpa bayar → batal otomatis; pembayaran terlambat → refund ke saldo =====
  begin
    declare pay payments; ext text; v_n int; v_used int;
    begin
      o := pg_temp.v2_jalankan('ride_motor', 'gopay', 'V2PLATFORM', '{"hanya_buat": true, "tanpa_bayar": true}');
      v_used := (select used_count from promos where code = 'V2PLATFORM');
      o2 := pg_temp.v2_jalankan('ride_motor', 'gopay', null, '{"hanya_buat": true, "tanpa_bayar": true}');   -- masih dalam batas waktu → tetap
      perform set_config('antaraja.bypass', 'on', true);
      update orders set created_at = now() - interval '16 minutes' where id = o.id;
      perform set_config('antaraja.bypass', 'off', true);
      perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
      v_n := expire_unpaid_orders();
      select * into o from orders where id = o.id; select * into o2 from orders where id = o2.id;
      lc := ledger_check(o.id);
      log := log || format('S63a %s expire_unpaid_orders=%s: %s (16 menit) status=%s alasan="%s" ledger fase=%s promo used %s→%s | %s (baru) status=%s',
        case when v_n >= 1 and o.status = 'cancelled' and lc->>'phase' = 'cancelled' and (select used_count from promos where code = 'V2PLATFORM') = v_used - 1
                  and o2.status::text = 'awaiting_payment' then 'OK' else 'BUG' end,
        v_n, o.code, o.status, o.cancel_reason, lc->>'phase', v_used, (select used_count from promos where code = 'V2PLATFORM'), o2.code, o2.status) || E'\n';
      -- non-admin tidak boleh memicu
      perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
      set local role authenticated;
      begin perform expire_unpaid_orders(); reset role; log := log || 'S63b BUG pelanggan bisa memanggil expire_unpaid_orders' || E'\n';
      exception when others then reset role; log := log || format('S63b %s expire_unpaid_orders dari klien ditolak: %s', case when sqlerrm ilike '%permission denied%' then 'OK' else 'BUG' end, left(sqlerrm, 50)) || E'\n'; end;
      reset role;
      -- dana gateway datang setelah pesanan kedaluwarsa → kembali ke saldo pelanggan (ref = external_id)
      c0 := pg_temp.v2_saldo(cust);
      ext := 'AKORD-V2-' || left(md5(random()::text), 10);
      insert into payments (user_id, order_id, purpose, amount, method, provider, status, external_id, pg_channel)
      values (cust, o.id, 'order', o.total, 'gopay', 'simulated', 'pending', ext, 'gopay');
      pay := payment_settle(ext, 'settlement', '{"payment_type": "gopay"}'::jsonb, 'gopay', now());
      select * into o from orders where id = o.id;
      log := log || format('S63c %s pembayaran terlambat Rp%s untuk pesanan batal: saldo Δ%s (refund closed-loop), status tetap %s, mutasi ref=%s baris, pg_fee gopay 2%%=%s',
        case when pg_temp.v2_saldo(cust) - c0 = o.total and o.status = 'cancelled' and (select count(*) from wallet_transactions where ref = ext and type = 'refund') = 1
                  and pay.pg_fee = round(o.total * 0.02) then 'OK' else 'BUG' end,
        o.total, pg_temp.v2_saldo(cust) - c0, o.status, (select count(*) from wallet_transactions where ref = ext), pay.pg_fee) || E'\n';
      -- bersihkan pesanan kedua (menunggu bayar) agar tidak menghalangi batas 3 pesanan aktif
      perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
      o2 := cancel_order(o2.id, 'uji S63 bersih');
      log := log || format('S63d %s pelanggan membatalkan pesanan awaiting_payment: status=%s bayar=%s', case when o2.status = 'cancelled' and o2.payment_status = 'unpaid' then 'OK' else 'BUG' end, o2.status, o2.payment_status) || E'\n';
    end;
  exception when others then reset role; log := log || 'S63 BUG expire: ' || sqlerrm || E'\n'; end;

  -- ===== S64 Iklan: merchant beli boost dari saldo → ads_revenue di ledger, boosted di atas + label Iklan; batal + refund → bersih 0 =====
  begin
    declare a merchant_ads; a2 merchant_ads; v_first jsonb; v_lat double precision; v_lng double precision;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
      perform wallet_apply(mown, 'earning', 100000, null, 'uji v2: saldo pendapatan merchant untuk iklan');
      m0 := pg_temp.v2_saldo(mown);
      perform set_config('request.jwt.claims', json_build_object('sub', mown, 'role', 'authenticated')::text, true);
      a := merchant_ad_request('boost_nearby', 3);
      m1 := pg_temp.v2_saldo(mown);
      select lat, lng into v_lat, v_lng from merchants where id = merch;
      perform set_config('request.jwt.claims', '', true);
      select to_jsonb(x) into v_first from nearby_merchants_v2(v_lat + 0.01, v_lng + 0.01, 15, null, null) x limit 1;
      log := log || format('S64a %s boost_nearby 3 hari: harga=%s (3 × 15.000) status=%s saldo merchant Δ%s | ledger ads_revenue=%s (source merchant_ads) | nearby_merchants_v2 teratas=%s boosted=%s label=%s',
        case when a.price_paid = 45000 and a.status = 'active' and m1 - m0 = -45000
                  and (select sum(amount) from order_ledger where source = 'merchant_ads' and source_id = a.id and entry = 'ads_revenue') = 45000
                  and (v_first->>'id')::uuid = merch and (v_first->>'boosted')::boolean and v_first->>'ad_label' = 'Sponsored' then 'OK' else 'BUG' end,   -- Finpay v3 §7: label 'Sponsored' (sebelumnya 'Iklan')
        a.price_paid, a.status, m1 - m0, (select sum(amount) from order_ledger where source = 'merchant_ads' and source_id = a.id), v_first->>'name', v_first->>'boosted', v_first->>'ad_label') || E'\n';
      -- saldo kurang → ditolak
      perform set_config('request.jwt.claims', json_build_object('sub', mown, 'role', 'authenticated')::text, true);
      begin a2 := merchant_ad_request('featured_home', 90); log := log || 'S64b BUG iklan melebihi saldo diterima' || E'\n';
      exception when others then log := log || format('S64b %s iklan 90 hari (Rp2.250.000) melebihi saldo ditolak: %s', case when sqlerrm ilike 'Saldo pendapatan tidak cukup%' then 'OK' else 'BUG' end, left(sqlerrm, 60)) || E'\n'; end;
      -- bukan pemilik merchant → ditolak
      perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
      begin a2 := merchant_ad_request('boost_nearby', 1); log := log || 'S64c BUG pelanggan bisa membeli iklan' || E'\n';
      exception when others then log := log || format('S64c %s non-merchant ditolak: %s', case when sqlerrm like 'Hanya pemilik merchant%' then 'OK' else 'BUG' end, left(sqlerrm, 50)) || E'\n'; end;
      -- iklan kedua lalu dibatalkan admin dengan refund (belum mulai tayang → refund penuh) → ads_revenue bersih 0
      perform set_config('request.jwt.claims', json_build_object('sub', mown, 'role', 'authenticated')::text, true);
      a2 := merchant_ad_request('featured_home', 1);
      m0 := pg_temp.v2_saldo(mown);
      perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
      a2 := admin_set_merchant_ad(merch, null, null, null, 'cancelled', a2.id, null, true);
      log := log || format('S64d %s featured_home dibatalkan admin + refund: refunded=%s saldo Δ%s ledger ads bersih=%s; admin_merchant_ads(active) berisi boost=%s; merchant_my_ads=%s iklan',
        case when a2.refunded = 25000 and pg_temp.v2_saldo(mown) - m0 = 25000
                  and (select sum(amount) from order_ledger where source = 'merchant_ads' and source_id = a2.id) = 0
                  and exists (select 1 from jsonb_array_elements(admin_merchant_ads('active')) x where (x->>'id')::uuid = a.id and (x->>'is_live')::boolean) then 'OK' else 'BUG' end,
        a2.refunded, pg_temp.v2_saldo(mown) - m0, (select sum(amount) from order_ledger where source = 'merchant_ads' and source_id = a2.id),
        exists (select 1 from jsonb_array_elements(admin_merchant_ads('active')) x where (x->>'id')::uuid = a.id),
        (select jsonb_array_length(merchant_my_ads()->'ads'))) || E'\n';
      -- produk iklan: ubah harga butuh PIN + audit
      perform admin_lock();
      begin perform admin_set_ad_product('boost_nearby', '{"price": 20000}'); log := log || 'S64e BUG harga iklan bisa diubah tanpa PIN' || E'\n';
      exception when others then perform admin_unlock('123456');
        perform admin_set_ad_product('boost_nearby', '{"price": 20000}');
        log := log || format('S64e %s harga iklan tanpa PIN ditolak (%s); dengan PIN → %s, audit=%s', case when sqlerrm ilike '%ADMIN_LOCKED%' and (select price from ad_products where code = 'boost_nearby') = 20000
            and exists (select 1 from audit_logs where action = 'ads.product_updated' and entity_id = 'boost_nearby') then 'OK' else 'BUG' end, left(sqlerrm, 30),
          (select price from ad_products where code = 'boost_nearby'), exists (select 1 from audit_logs where action = 'ads.product_updated' and entity_id = 'boost_nearby')) || E'\n';
        perform admin_set_ad_product('boost_nearby', '{"price": 15000}');
      end;
    end;
  exception when others then log := log || 'S64 BUG iklan: ' || sqlerrm || E'\n'; end;

  -- ===== S65 Biaya PG: admin_set_payment_channel_fee (PIN, validasi, audit before/after) =====
  begin
    declare f payment_channel_fees;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
      begin f := admin_set_payment_channel_fee('qris', '{"fee_pct": 50}'); log := log || 'S65a BUG fee_pct 50% diterima' || E'\n';
      exception when others then log := log || format('S65a %s fee_pct di luar rentang ditolak: %s', case when sqlerrm like 'fee_pct harus%' then 'OK' else 'BUG' end, left(sqlerrm, 40)) || E'\n'; end;
      f := admin_set_payment_channel_fee('qris', '{"fee_pct": 0.8}');
      select x.fee into fee_q from pg_fee_calc('qris', 100000) x;
      log := log || format('S65b %s qris 0,7 → %s%%: pg_fee_calc(100.000)=%s; audit pg_fee.updated before=%s after=%s; admin_payment_channel_fees=%s saluran',
        case when fee_q = 800 and (select detail->'before'->>'fee_pct' from audit_logs where action = 'pg_fee.updated' order by id desc limit 1) = '0.70'
                  and (select count(*) from admin_payment_channel_fees()) >= 14 then 'OK' else 'BUG' end,
        f.fee_pct, fee_q, (select detail->'before'->>'fee_pct' from audit_logs where action = 'pg_fee.updated' order by id desc limit 1),
        (select detail->'after'->>'fee_pct' from audit_logs where action = 'pg_fee.updated' order by id desc limit 1), (select count(*) from admin_payment_channel_fees())) || E'\n';
      f := admin_set_payment_channel_fee('qris', '{"fee_pct": 0.7}');
      perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
      begin f := admin_set_payment_channel_fee('qris', '{"fee_pct": 0}'); log := log || 'S65c BUG pelanggan bisa mengubah biaya PG' || E'\n';
      exception when others then log := log || format('S65c %s non-admin ditolak: %s', case when sqlerrm like 'Hanya admin%' then 'OK' else 'BUG' end, left(sqlerrm, 30)) || E'\n'; end;
    end;
  exception when others then log := log || 'S65 BUG biaya PG: ' || sqlerrm || E'\n'; end;

  -- ===== S66 exec_report_v2: take rate & contribution = hitungan tangan dari kolom orders (layanan send + ride_car) =====
  begin
    declare v_from date := date_trunc('month', now() at time zone 'Asia/Jakarta')::date; v_to date := (date_trunc('month', now() at time zone 'Asia/Jakarta') + interval '1 month' - interval '1 day')::date;
      tok text; j jsonb; h record; ja jsonb;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
      insert into exec_access (user_id, level, pin_hash, active) select adm, 'vp', extensions.crypt('654321', extensions.gen_salt('bf')), true where not exists (select 1 from exec_access where user_id = adm);
      update exec_access set pin_hash = extensions.crypt('654321', extensions.gen_salt('bf')), active = true where user_id = adm;
      tok := exec_login('654321')->>'token';
      j := exec_report_v2(tok, v_from, v_to, '{"service": ["send", "ride_car"]}'::jsonb);
      -- hitungan tangan (tanpa order_ledger): komisi kotor = ongkir − driver_earning dasar; bonus = final − dasar − tip − extras − jasa
      select count(*) n, coalesce(sum(items_subtotal + fare_delivery + intercity_fare), 0) gmv,
        coalesce(sum(platform_fee + (fare_delivery - driver_earning) + (service_fee - driver_service_share)
                     - case when coalesce(promo_funded_by, 'platform') = 'platform' then discount else 0 end), 0) rn,
        coalesce(sum(coalesce(driver_earning_final, driver_earning) - driver_earning - tip - extras_total - driver_service_share), 0) inc,
        coalesce(sum(case when pg_fee_borne_by = 'platform' then pg_fee + pg_fee_ppn else 0 end), 0) pgp
      into h from orders
      where service in ('send', 'ride_car') and status = 'completed' and payment_status <> 'refunded'
        and (completed_at at time zone 'Asia/Jakarta')::date between v_from and v_to;
      log := log || format('S66a %s exec_report_v2(send, ride_car): orders=%s/%s gmv_net=%s/%s revenue_net=%s/%s take_rate=%s%%/%s%% insentif=%s/%s pg platform=%s/%s contribution=%s/%s per order=%s/%s (laporan/tangan)',
        case when (j->'summary'->>'orders')::bigint = h.n and (j->'summary'->>'gmv_net')::bigint = h.gmv and (j->'summary'->>'revenue_net')::bigint = h.rn
                  and (j->'summary'->>'take_rate_net_pct')::numeric = round(100.0 * h.rn / h.gmv, 2) and (j->'summary'->>'incentives_total')::bigint = h.inc
                  and (j->'summary'->>'pg_fee_platform')::bigint = h.pgp and (j->'summary'->>'contribution_total')::bigint = h.rn - h.inc - h.pgp
                  and (j->'summary'->>'contribution_per_order')::numeric = round((h.rn - h.inc - h.pgp)::numeric / h.n) and h.n > 0 and h.pgp > 0 then 'OK' else 'BUG' end,
        j->'summary'->>'orders', h.n, j->'summary'->>'gmv_net', h.gmv, j->'summary'->>'revenue_net', h.rn, j->'summary'->>'take_rate_net_pct', round(100.0 * h.rn / h.gmv, 2),
        j->'summary'->>'incentives_total', h.inc, j->'summary'->>'pg_fee_platform', h.pgp, j->'summary'->>'contribution_total', h.rn - h.inc - h.pgp,
        j->'summary'->>'contribution_per_order', round((h.rn - h.inc - h.pgp)::numeric / h.n)) || E'\n';
      -- identitas internal + bentuk keluaran
      ja := admin_exec_report_v2(v_from, v_to, '{}'::jsonb);
      log := log || format('S66b %s identitas: Σ sumber − promo platform = revenue_net (%s = %s); contribution = revenue_net − insentif − pg − refund pg − variable_ops − payout (%s); iklan=%s (≥ 45.000 dari S64); by_month=%s; gerbang=%s; label take_rate_target=%s',
        case when (ja->'summary'->'platform_revenue'->>'total')::bigint - (ja->'summary'->'promo'->>'platform')::bigint = (ja->'summary'->>'revenue_net')::bigint
                  and (ja->'summary'->>'contribution_total')::bigint = (ja->'summary'->>'revenue_net')::bigint - (ja->'summary'->>'incentives_total')::bigint
                      - (ja->'summary'->>'pg_fee_platform')::bigint - (ja->'summary'->>'refund_pg_cost')::bigint - (ja->'summary'->>'variable_ops_total')::bigint - (ja->'summary'->>'payout_fee_total')::bigint
                  and (ja->'summary'->'platform_revenue'->>'ads')::bigint >= 45000 and jsonb_array_length(ja->'by_month') = 12
                  and ja->'gates' ? 'contribution_positive_8w' and ja->'gates' ? 'reconciliation_diff_zero' and ja->'gates' ? 'payout_on_time'
                  and ja->'gates' ? 'retention_30d_driver' and ja->'gates' ? 'fraud_refund' and ja->'labels'->'take_rate_target_pct'->>'label' = 'FAKTA SUMBER'
                  and (ja->'summary'->>'refund_pg_cost')::bigint > 0 then 'OK' else 'BUG' end,
        (ja->'summary'->'platform_revenue'->>'total')::bigint - (ja->'summary'->'promo'->>'platform')::bigint, ja->'summary'->>'revenue_net', ja->'summary'->>'contribution_total',
        ja->'summary'->'platform_revenue'->>'ads', jsonb_array_length(ja->'by_month'),
        (select string_agg(e.key || '=' || coalesce(e.value->>'status', e.value::text), ' ') from jsonb_each(ja->'gates') e), ja->'labels'->'take_rate_target_pct'->>'label') || E'\n';
      -- satu definisi pendapatan: dashboard admin & exec_report_data = ledger
      r := admin_dashboard_stats();
      log := log || format('S66c %s pendapatan diselaraskan: admin_dashboard_stats.revenue_month=%s = ledger revenue_net bulan berjalan=%s; exec_report_data(1).summary.revenue=%s',
        case when (r->>'revenue_month')::bigint = (admin_exec_report_v2(v_from, (now() at time zone 'Asia/Jakarta')::date, '{}'::jsonb)->'summary'->>'revenue_net')::bigint
                  and (exec_report_data(1)->'summary'->>'revenue')::bigint = (r->>'revenue_month')::bigint then 'OK' else 'BUG' end,
        r->>'revenue_month', admin_exec_report_v2(v_from, (now() at time zone 'Asia/Jakarta')::date, '{}'::jsonb)->'summary'->>'revenue_net', exec_report_data(1)->'summary'->>'revenue') || E'\n';
      -- admin_finance_cascade (order_economics_v2): net_margin = revenue − promo − gateway = Σ contribution ledger order selesai
      select * into o from orders where status = 'completed' and pg_fee > 0 and created_at >= transaction_timestamp() order by created_at desc limit 1;
      r := admin_finance_cascade((now() at time zone 'Asia/Jakarta')::date - 1, (now() at time zone 'Asia/Jakarta')::date + 1, 'service', null);
      log := log || format('S66d %s admin_finance_cascade via order_economics_v2: totals net_margin=%s = Σ ledger contribution order selesai=%s; admin_order_split cocok=%s',
        case when (r->'totals'->>'net_margin')::bigint = (select sum((ledger_check(id)->>'contribution')::bigint) from orders where status = 'completed' and created_at >= transaction_timestamp())
                  and (admin_order_split(o.id)->>'net_margin')::bigint = (ledger_check(o.id)->>'contribution')::bigint then 'OK' else 'BUG' end,
        r->'totals'->>'net_margin', (select sum((ledger_check(id)->>'contribution')::bigint) from orders where status = 'completed' and created_at >= transaction_timestamp()),
        (admin_order_split(o.id)->>'net_margin')::bigint = (ledger_check(o.id)->>'contribution')::bigint) || E'\n';
      -- token palsu & filter tidak valid
      begin j := exec_report_v2('token-palsu', v_from, v_to, '{}'::jsonb); log := log || 'S66e BUG token palsu diterima' || E'\n';
      exception when others then log := log || format('S66e %s token palsu ditolak: %s', case when sqlerrm like 'EXEC_SESSION_EXPIRED%' then 'OK' else 'BUG' end, left(sqlerrm, 30)) || E'\n'; end;
      begin j := exec_report_v2(tok, v_from, v_to, '{"cash_digital": "kripto"}'::jsonb); log := log || 'S66f BUG filter tidak valid diterima' || E'\n';
      exception when others then log := log || format('S66f %s filter cash_digital tidak valid ditolak: %s', case when sqlerrm like 'cash_digital harus%' then 'OK' else 'BUG' end, left(sqlerrm, 40)) || E'\n'; end;
      -- filter saluran: qris hanya menghitung order qris; tunai + digital = semua order
      j := exec_report_v2(tok, v_from, v_to, '{"payment_method": "qris"}'::jsonb);
      log := log || format('S66g %s filter payment_method=qris: orders=%s (tangan %s); cash %s + digital %s = semua %s',
        case when (j->'summary'->>'orders')::bigint = (select count(*) from orders where pg_channel = 'qris' and status = 'completed' and payment_status <> 'refunded' and (completed_at at time zone 'Asia/Jakarta')::date between v_from and v_to)
                  and (exec_report_v2(tok, v_from, v_to, '{"cash_digital": "cash"}')->'summary'->>'orders')::bigint + (exec_report_v2(tok, v_from, v_to, '{"cash_digital": "digital"}')->'summary'->>'orders')::bigint
                      = (ja->'summary'->>'orders')::bigint then 'OK' else 'BUG' end,
        j->'summary'->>'orders', (select count(*) from orders where pg_channel = 'qris' and status = 'completed' and payment_status <> 'refunded' and (completed_at at time zone 'Asia/Jakarta')::date between v_from and v_to),
        exec_report_v2(tok, v_from, v_to, '{"cash_digital": "cash"}')->'summary'->>'orders', exec_report_v2(tok, v_from, v_to, '{"cash_digital": "digital"}')->'summary'->>'orders', ja->'summary'->>'orders') || E'\n';
    end;
  exception when others then log := log || 'S66 BUG exec_report_v2: ' || sqlerrm || E'\n'; end;

  -- ===== S67 Biaya tetap kota → EBITDA kota; variable_ops mengurangi contribution =====
  begin
    declare v_from date := date_trunc('month', now() at time zone 'Asia/Jakarta')::date; v_to date := (date_trunc('month', now() at time zone 'Asia/Jakarta') + interval '1 month' - interval '1 day')::date;
      v_city uuid; j0 jsonb; j1 jsonb; c city_fixed_costs; x0 jsonb; x1 jsonb;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
      select city_id into v_city from orders where service = 'ride_motor' and status = 'completed' and created_at >= transaction_timestamp() and city_id is not null limit 1;
      j0 := admin_exec_report_v2(v_from, v_to, '{}'::jsonb);
      select x into x0 from jsonb_array_elements(j0->'by_city') x where (x->>'city_id')::uuid = v_city;
      c := admin_set_city_fixed_cost(v_city, v_from, 'tim', 3000000, 'uji v2 tim kota');
      c := admin_set_city_fixed_cost(v_city, v_from + 9, 'variable_ops', 100000, 'uji v2 support/cloud');   -- tanggal apa pun → dinormalkan ke tanggal 1
      j1 := admin_exec_report_v2(v_from, v_to, '{}'::jsonb);
      select x into x1 from jsonb_array_elements(j1->'by_city') x where (x->>'city_id')::uuid = v_city;
      log := log || format('S67a %s kota %s: contribution %s → %s (− variable_ops 100.000) biaya tetap=%s ebitda_city=%s (= contribution − 3.000.000) | summary ebitda=%s bulan c.month=%s',
        case when (x1->>'fixed_costs')::bigint = 3000000 and (x1->>'contribution')::bigint = (x0->>'contribution')::bigint - 100000
                  and (x1->>'ebitda_city')::bigint = (x1->>'contribution')::bigint - 3000000
                  and (j1->'summary'->>'ebitda')::bigint = (j1->'summary'->>'contribution_total')::bigint - (j1->'summary'->>'fixed_costs_total')::bigint
                  and c.month = v_from then 'OK' else 'BUG' end,
        x1->>'city', x0->>'contribution', x1->>'contribution', x1->>'fixed_costs', x1->>'ebitda_city', j1->'summary'->>'ebitda', c.month) || E'\n';
      r := admin_city_fixed_costs(v_from);
      log := log || format('S67b %s admin_city_fixed_costs: total_fixed=%s variable_ops=%s baris=%s ebitda kota tersedia=%s; audit city_cost.updated=%s',
        case when (r->>'total_fixed')::bigint = 3000000 and (r->>'total_variable_ops')::bigint = 100000 and jsonb_array_length(r->'rows') = 2 and jsonb_array_length(r->'ebitda') > 0
                  and (select count(*) from audit_logs where action = 'city_cost.updated' and created_at >= transaction_timestamp()) = 2 then 'OK' else 'BUG' end,
        r->>'total_fixed', r->>'total_variable_ops', jsonb_array_length(r->'rows'), jsonb_array_length(r->'ebitda'),
        (select count(*) from audit_logs where action = 'city_cost.updated' and created_at >= transaction_timestamp())) || E'\n';
      begin c := admin_set_city_fixed_cost(v_city, v_from, 'hiburan', 1, null); log := log || 'S67c BUG kategori asing diterima' || E'\n';
      exception when others then log := log || format('S67c %s kategori asing ditolak: %s', case when sqlerrm like 'Kategori harus%' then 'OK' else 'BUG' end, left(sqlerrm, 40)) || E'\n'; end;
    end;
  exception when others then log := log || 'S67 BUG biaya tetap kota: ' || sqlerrm || E'\n'; end;

  -- ===== S68 Payout: approved ≠ settled; admin_mark_withdrawal_settled (PIN) =====
  begin
    declare w withdrawal_requests;
    begin
      perform set_config('antaraja.bypass', 'on', true);
      insert into bank_accounts (user_id, bank_name, account_no, holder, verified) values (drv, 'BCA', '111222333', 'Driver Uji', true)
      on conflict (user_id) do update set bank_name = 'BCA', account_no = '111222333', holder = 'Driver Uji', verified = true;
      perform set_config('antaraja.bypass', 'off', true);
      perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
      w := request_withdrawal(20000, 'BCA', '111222333', 'Driver Uji');
      perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
      if w.status = 'pending' then w := admin_review_withdrawal(w.id, true, 'uji v2'); end if;
      r := admin_reconciliation((now() at time zone 'Asia/Jakarta')::date, (now() at time zone 'Asia/Jakarta')::date);
      ok := w.status = 'approved' and w.settled_at is null
            and exists (select 1 from jsonb_array_elements(r->'payouts'->'approved_unsettled'->'items') x where (x->>'id')::uuid = w.id);
      begin perform admin_mark_withdrawal_settled(w.id, ' '); ok := false; exception when others then null; end;   -- ref kosong ditolak
      w := admin_mark_withdrawal_settled(w.id, 'BCA-TRF-V2-0001');
      begin perform admin_mark_withdrawal_settled(w.id, 'BCA-TRF-V2-0002'); ok := false; alasan := 'settle ganda diterima';
      exception when others then alasan := left(sqlerrm, 40); end;
      r := admin_reconciliation((now() at time zone 'Asia/Jakarta')::date, (now() at time zone 'Asia/Jakarta')::date);
      log := log || format('S68 %s penarikan %s approved (belum settled, tampil di rekonsiliasi) → settled_at terisi ref=%s oleh admin; settle ulang ditolak (%s); settled hari ini=%s, audit=%s',
        case when ok and w.settled_at is not null and w.provider_ref = 'BCA-TRF-V2-0001' and w.settled_by = adm and (r->'payouts'->'settled'->>'count')::int >= 1
                  and not exists (select 1 from jsonb_array_elements(r->'payouts'->'approved_unsettled'->'items') x where (x->>'id')::uuid = w.id)
                  and exists (select 1 from audit_logs where action = 'withdrawal.settled' and entity_id = w.id::text) then 'OK' else 'BUG' end,
        w.id, w.provider_ref, alasan, r->'payouts'->'settled'->>'count', exists (select 1 from audit_logs where action = 'withdrawal.settled' and entity_id = w.id::text)) || E'\n';
    end;
  exception when others then log := log || 'S68 BUG payout: ' || sqlerrm || E'\n'; end;

  -- ===== S69 Rekonsiliasi harian: diff = 0 (pesanan gateway + top up + refund pembayaran terlambat); top up mencatat pg_fee =====
  begin
    declare pay payments; ext text;
    begin
      -- top up via QRIS (purpose=topup): saldo +penuh, wallet_transactions.pg_fee = 0,7 %
      ext := 'AKPAY-V2-' || left(md5(random()::text), 10);
      insert into payments (user_id, order_id, purpose, amount, method, provider, status, external_id) values (cust, null, 'topup', 200000, 'qris', 'simulated', 'pending', ext);
      c0 := pg_temp.v2_saldo(cust);
      pay := payment_settle(ext, 'settlement', null);   -- pemanggil lama (3 argumen) tetap jalan; saluran dari method
      perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
      r := admin_reconciliation((now() at time zone 'Asia/Jakarta')::date, (now() at time zone 'Asia/Jakarta')::date);
      log := log || format('S69 %s rekonsiliasi hari ini: settlement=%s gross pesanan digital=%s top up=%s refund terlambat=%s pg_fee_total=%s (= Σ payments %s) diff=%s | top up 200.000 saldo Δ%s pg_fee top up=%s (0,7%%)',
        case when (r->'totals'->>'diff')::bigint = 0 and (r->'totals'->>'abs_diff')::bigint = 0 and (r->'totals'->>'payments_settled')::bigint > 0
                  and (r->'totals'->>'late_payment_refunds')::bigint > 0 and (r->'totals'->>'topups_credited')::bigint >= 200000
                  and (r->'totals'->>'pg_fee_total')::bigint = (select sum(pg_fee + pg_fee_ppn) from payments where status = 'settlement' and (settlement_time at time zone 'Asia/Jakarta')::date = (now() at time zone 'Asia/Jakarta')::date)
                  and pg_temp.v2_saldo(cust) - c0 = 200000 and (select pg_fee from wallet_transactions where ref = ext) = 1400
                  and (admin_exec_report_v2((now() at time zone 'Asia/Jakarta')::date, (now() at time zone 'Asia/Jakarta')::date, '{}')->'gates'->'reconciliation_diff_zero'->>'status') = 'pass' then 'OK' else 'BUG' end,
        r->'totals'->>'payments_settled', r->'totals'->>'gross_customer_digital', r->'totals'->>'topups_credited', r->'totals'->>'late_payment_refunds', r->'totals'->>'pg_fee_total',
        (select sum(pg_fee + pg_fee_ppn) from payments where status = 'settlement' and (settlement_time at time zone 'Asia/Jakarta')::date = (now() at time zone 'Asia/Jakarta')::date),
        r->'totals'->>'diff', pg_temp.v2_saldo(cust) - c0, (select pg_fee from wallet_transactions where ref = ext)) || E'\n';
    end;
  exception when others then log := log || 'S69 BUG rekonsiliasi: ' || sqlerrm || E'\n'; end;

  -- ===== S70 Mitra travel: batas saldo minus (driver_debt_limit) menolak jadwal & penawaran baru =====
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    p0 := pg_temp.v2_saldo(drv2);
    perform admin_adjust_wallet(drv2, -(p0 + 150000), 'uji v2: saldo mitra travel -150.000');
    update app_settings set value = '-100000'::jsonb where key = 'driver_debt_limit';
    perform set_config('request.jwt.claims', json_build_object('sub', drv2, 'role', 'authenticated')::text, true);
    ok := true; alasan := '';
    begin tt := travel_trip_create(jsonb_build_object('route_id', route1, 'depart_at', (now() + interval '4 days')::text, 'seats_total', 6, 'seat_price', 150000)); ok := false; alasan := 'jadwal diterima';
    exception when others then alasan := left(sqlerrm, 60); if sqlerrm not like 'Saldo minus melebihi batas (Rp100.000)%' then ok := false; end if; end;
    update app_settings set value = '-500000'::jsonb where key = 'driver_debt_limit';
    tt := travel_trip_create(jsonb_build_object('route_id', route1, 'depart_at', (now() + interval '4 days')::text, 'seats_total', 6, 'seat_price', 150000));
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    perform admin_adjust_wallet(drv2, p0 + 150000, 'uji v2: pulihkan saldo mitra travel');
    log := log || format('S70 %s mitra travel saldo -150.000: batas -100.000 → travel_trip_create ditolak (%s); batas -500.000 → jadwal dibuat=%s', case when ok and tt.id is not null then 'OK' else 'BUG' end, alasan, tt.id is not null) || E'\n';
  exception when others then log := log || 'S70 BUG batas saldo mitra travel: ' || sqlerrm || E'\n';
    update app_settings set value = '-500000'::jsonb where key = 'driver_debt_limit';
  end;

  -- ===== S80 (0104) Pagar pesanan bayar-per-order BELUM LUNAS: driver / pencocokan / jadwal / mitra travel / merchant; batal tanpa refund =====
  begin
    declare vd drivers; o3 orders; ext text; ext2 text; v_n int;
    begin
      select * into vd from drivers where id = drv;
      -- (a) awaiting_payment asli: driver ditolak dengan pesan jelas, tidak ada di daftar, driver_can_take=false
      o := pg_temp.v2_jalankan('ride_motor', 'gopay', null, '{"hanya_buat": true, "tanpa_bayar": true}');
      perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
      perform driver_selfie_check('https://x/selfie.jpg'); perform driver_set_online(true, 0.4810, 101.4349);
      ok := true; alasan := '';
      begin perform driver_accept_order(o.id); ok := false; alasan := 'diterima';
      exception when others then alasan := left(sqlerrm, 70); if sqlerrm not like 'Pesanan ini belum dibayar pelanggan%' then ok := false; end if; end;
      n := (select count(*) from driver_available_orders() x where x.id = o.id);
      log := log || format('S80a %s %s awaiting_payment: driver_accept_order ditolak (%s); tampil di driver_available_orders=%s; driver_can_take=%s',
        case when ok and n = 0 and not driver_can_take(vd, o) and order_payment_pending(o) then 'OK' else 'BUG' end, o.code, alasan, n, driver_can_take(vd, o)) || E'\n';
      -- (b) keadaan tidak konsisten: status searching tetapi payment_status unpaid + saluran gateway → tetap tertahan
      o2 := pg_temp.v2_jalankan('ride_motor', 'qris', null, '{"hanya_buat": true, "tanpa_bayar": true}');
      perform set_config('antaraja.bypass', 'on', true);
      update orders set status = 'searching' where id = o2.id returning * into o2;
      perform set_config('antaraja.bypass', 'off', true);
      o3 := o2; o3.payment_status := 'paid';   -- pembanding: baris yang sama tapi lunas → cocok
      perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
      ok := true; alasan := '';
      begin perform driver_accept_order(o2.id); ok := false; alasan := 'diterima';
      exception when others then alasan := left(sqlerrm, 50); if sqlerrm not like 'Pesanan ini belum dibayar pelanggan%' then ok := false; end if; end;
      n := (select count(*) from driver_available_orders() x where x.id = o2.id);
      perform set_config('request.jwt.claims', json_build_object('sub', drv2, 'role', 'authenticated')::text, true);
      begin perform travel_accept_send(o2.id); ok := false; alasan := alasan || ' | mitra travel diterima';
      exception when others then alasan := alasan || ' | travel: ' || left(sqlerrm, 45); if sqlerrm not like 'Titipan ini belum dibayar%' then ok := false; end if; end;
      log := log || format('S80b %s %s status=searching + unpaid qris (tidak konsisten): %s; di daftar=%s; driver_can_take=%s (pembanding lunas=%s)',
        case when ok and n = 0 and not driver_can_take(vd, o2) and driver_can_take(vd, o3) and (select driver_id from orders where id = o2.id) is null then 'OK' else 'BUG' end,
        o2.code, alasan, n, driver_can_take(vd, o2), driver_can_take(vd, o3)) || E'\n';
      -- (c) booking terjadwal yang belum lunas tidak dirilis ke pencarian driver
      perform set_config('antaraja.bypass', 'on', true);
      update orders set status = 'scheduled', scheduled_at = now() + interval '5 minutes' where id = o2.id;
      perform set_config('antaraja.bypass', 'off', true);
      perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
      v_n := release_scheduled_orders();
      log := log || format('S80c %s release_scheduled_orders=%s: jadwal %s yang belum lunas tetap %s',
        case when (select status::text from orders where id = o2.id) = 'scheduled' then 'OK' else 'BUG' end, v_n, o2.code, (select status from orders where id = o2.id)) || E'\n';
      -- (d) pelanggan membatalkan awaiting_payment yang tagihan Snap-nya pending: tidak ada refund, payments pending → cancel
      ext := 'AKORD-V2-' || left(md5(random()::text), 10);
      insert into payments (user_id, order_id, purpose, amount, method, provider, status, external_id, pg_channel)
      values (cust, o.id, 'order', o.total, 'gopay', 'simulated', 'pending', ext, 'gopay');
      c0 := pg_temp.v2_saldo(cust);
      perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
      o := cancel_order(o.id, 'uji S80 batal sebelum bayar');
      perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
      lc := ledger_check(o.id);
      log := log || format('S80d %s batal %s sebelum bayar: status=%s bayar=%s saldo Δ%s (harus 0) payments=%s ledger fase=%s refund=%s event payment_cancelled=%s',
        case when o.status = 'cancelled' and o.payment_status = 'unpaid' and pg_temp.v2_saldo(cust) = c0 and (select status from payments where external_id = ext) = 'cancel'
                  and lc->>'phase' = 'cancelled' and (lc->>'refund')::bigint = 0 and (select count(*) from wallet_transactions where order_id = o.id and type = 'refund') = 0
                  and exists (select 1 from order_events where order_id = o.id and status = 'payment_cancelled') then 'OK' else 'BUG' end,
        o.code, o.status, o.payment_status, pg_temp.v2_saldo(cust) - c0, (select status from payments where external_id = ext), lc->>'phase', lc->>'refund',
        exists (select 1 from order_events where order_id = o.id and status = 'payment_cancelled')) || E'\n';
      -- (e) kedaluwarsa otomatis ikut menutup tagihan pending (status expire)
      ext2 := 'AKORD-V2-' || left(md5(random()::text), 10);
      perform set_config('antaraja.bypass', 'on', true);
      update orders set status = 'awaiting_payment', scheduled_at = null, created_at = now() - interval '16 minutes' where id = o2.id;
      perform set_config('antaraja.bypass', 'off', true);
      insert into payments (user_id, order_id, purpose, amount, method, provider, status, external_id, pg_channel)
      values (cust, o2.id, 'order', o2.total, 'qris', 'simulated', 'pending', ext2, 'qris');
      v_n := expire_unpaid_orders();
      log := log || format('S80e %s expire_unpaid_orders=%s: %s status=%s, tagihan pending → %s, saldo tetap',
        case when (select status from orders where id = o2.id) = 'cancelled' and (select status from payments where external_id = ext2) = 'expire' and pg_temp.v2_saldo(cust) = c0 then 'OK' else 'BUG' end,
        v_n, o2.code, (select status from orders where id = o2.id), (select status from payments where external_id = ext2)) || E'\n';
      -- (f) merchant tidak bisa memproses pesanan food yang belum dibayar
      o3 := pg_temp.v2_jalankan('food', 'qris', null, '{"hanya_buat": true, "tanpa_bayar": true}');
      perform set_config('request.jwt.claims', json_build_object('sub', mown, 'role', 'authenticated')::text, true);
      ok := true; alasan := '';
      begin perform merchant_update_order(o3.id, 'accepted'); ok := false; alasan := 'diterima';
      exception when others then alasan := left(sqlerrm, 60); if sqlerrm not like '%belum dibayar pelanggan%' then ok := false; end if; end;
      begin perform merchant_update_order(o3.id, 'rejected'); ok := false; alasan := alasan || ' | tolak diterima';
      exception when others then null; end;
      log := log || format('S80f %s food %s awaiting_payment: merchant terima/tolak ditolak (%s); merchant_status tetap %s',
        case when ok and (select merchant_status::text from orders where id = o3.id) = 'pending' then 'OK' else 'BUG' end, o3.code, alasan, (select merchant_status from orders where id = o3.id)) || E'\n';
      perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
      perform cancel_order(o3.id, 'uji S80 bersih');
    end;
  exception when others then log := log || 'S80 BUG pagar belum lunas: ' || sqlerrm || E'\n'; end;

  -- ===== S81 (0104) Checkout: service_economics_public.pg_fee_policy + pg_fee_estimate (anon) = biaya aktual pesanan =====
  begin
    declare v_base bigint; q jsonb;
    begin
      perform set_config('request.jwt.claims', '', true);
      set local role anon;
      r := service_economics_public('send');
      q := pg_fee_estimate('send', 'qris', 100000);
      sim := pg_fee_estimate('send', 'bank_transfer', 100000);
      bd := pg_fee_estimate('send', 'cash', 100000);
      reset role;
      log := log || format('S81a %s anon: pg_fee_policy(send)=%s | qris 100.000 fee=%s ppn=%s borne_by=%s customer_fee=%s | VA fee=%s ppn=%s | tunai total_fee=%s borne_by=%s',
        case when r->>'pg_fee_policy' = 'platform' and (q->>'fee')::bigint = 700 and (q->>'ppn')::bigint = 0 and q->>'borne_by' = 'platform' and (q->>'customer_fee')::bigint = 0
                  and (sim->>'fee')::bigint = 4000 and (sim->>'ppn')::bigint = 440 and (bd->>'total_fee')::bigint = 0 and bd->>'borne_by' is null then 'OK' else 'BUG' end,
        r->>'pg_fee_policy', q->>'fee', q->>'ppn', q->>'borne_by', q->>'customer_fee', sim->>'fee', sim->>'ppn', bd->>'total_fee', coalesce(bd->>'borne_by', 'null')) || E'\n';
      -- policy customer: estimasi = "Biaya pembayaran" yang benar-benar ditambahkan create_order
      perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
      se := admin_set_service_economics('send', '{"pg_fee_policy": "customer"}');
      o := pg_temp.v2_jalankan('send', 'bank_transfer', null, '{"hanya_buat": true, "tanpa_bayar": true}');
      v_base := o.fare_delivery + o.platform_fee - o.discount;
      perform set_config('request.jwt.claims', '', true);
      q := pg_fee_estimate('send', 'bank_transfer', v_base);
      r := service_economics_public('send');
      log := log || format('S81b %s policy customer: service_economics_public=%s; estimasi VA atas dasar %s → customer_fee=%s total_with_fee=%s = total pesanan nyata %s (%s)',
        case when r->>'pg_fee_policy' = 'customer' and q->>'borne_by' = 'customer' and (q->>'customer_fee')::bigint = 4440 and (q->>'total_with_fee')::bigint = o.total then 'OK' else 'BUG' end,
        r->>'pg_fee_policy', v_base, q->>'customer_fee', q->>'total_with_fee', o.total, o.code) || E'\n';
      begin perform pg_fee_estimate('send', 'qris', -1); log := log || 'S81c BUG nominal negatif diterima' || E'\n';
      exception when others then log := log || format('S81c %s nominal negatif ditolak: %s', case when sqlerrm like 'Nominal estimasi%' then 'OK' else 'BUG' end, left(sqlerrm, 45)) || E'\n'; end;
      perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
      perform cancel_order(o.id, 'uji S81 bersih');
      perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
      se := admin_set_service_economics('send', '{"pg_fee_policy": "platform"}');
    end;
  exception when others then reset role; log := log || 'S81 BUG estimasi biaya pembayaran: ' || sqlerrm || E'\n';
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    begin se := admin_set_service_economics('send', '{"pg_fee_policy": "platform"}'); exception when others then null; end;
  end;

  -- ===== S82 (0104) Sakelar gateway_order_payment_enabled: AntarPay MATI tetapi bayar per pesanan via gateway jalan (PKS Pasal 7.4b) =====
  begin
    declare j jsonb; v_audit int;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
      perform admin_unlock('123456');
      r := admin_set_antarpay_enabled(false);
      -- (a) sakelar baru mati (default): perilaku 0088 apa adanya
      perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
      begin o := pg_temp.v2_jalankan('ride_motor', 'gopay', null, '{"hanya_buat": true, "tanpa_bayar": true}'); ok := false; alasan := 'order gopay diterima ' || o.code;
      exception when others then alasan := left(sqlerrm, 50); ok := (sqlerrm like 'AntarPay sedang dinonaktifkan sementara%' or sqlerrm like 'AntarVoucher sedang dinonaktifkan sementara%'); end;
      log := log || format('S82a %s AntarPay mati + sakelar per order mati (default %s): order gopay ditolak (%s)',
        case when ok and not gateway_order_payment_enabled() then 'OK' else 'BUG' end, gateway_order_payment_enabled(), alasan) || E'\n';
      -- (b) sakelar: PIN wajib, non-admin ditolak, audit
      perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
      perform admin_lock();
      ok := true;
      begin r := admin_set_gateway_order_payment(true); ok := false; exception when others then if sqlerrm not ilike '%ADMIN_LOCKED%' and sqlerrm not ilike '%PIN%' then ok := false; end if; end;
      perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
      begin r := admin_set_gateway_order_payment(true); ok := false; exception when others then if sqlerrm not like 'Hanya admin%' then ok := false; end if; end;
      perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
      perform admin_unlock('123456');
      v_audit := (select count(*) from audit_logs where action = 'gateway_order_payment.toggle');
      r := admin_set_gateway_order_payment(true);
      j := app_public_settings();
      log := log || format('S82b %s tanpa PIN & non-admin ditolak; admin+PIN → gateway_order_payment_enabled=%s antarpay=%s; app_public_settings: per order gopay=%s, saldo/top up gopay=%s; audit +%s',
        case when ok and gateway_order_payment_enabled() and not antarpay_enabled() and (j->>'gateway_order_payment_enabled')::boolean
                  and (j->'order_payment_channels'->>'gopay')::boolean and not (j->'payment_channels'->>'gopay')::boolean and not (j->'order_payment_channels'->>'antarpay')::boolean
                  and (select count(*) from audit_logs where action = 'gateway_order_payment.toggle') = v_audit + 1 then 'OK' else 'BUG' end,
        r->>'gateway_order_payment_enabled', r->>'antarpay_enabled', j->'order_payment_channels'->>'gopay', j->'payment_channels'->>'gopay',
        (select count(*) from audit_logs where action = 'gateway_order_payment.toggle') - v_audit) || E'\n';
      -- (c) pelanggan: gopay per order diterima (awaiting_payment, saldo tak tersentuh) → dibayar → selesai, ledger seimbang
      c0 := pg_temp.v2_saldo(cust);
      o := pg_temp.v2_jalankan('ride_motor', 'gopay', null, '{"hanya_buat": true, "tanpa_bayar": true}');
      ok := o.status::text = 'awaiting_payment' and o.payment_status = 'unpaid' and pg_temp.v2_saldo(cust) = c0;
      perform pg_temp.v2_bayar_gateway(o.id, null);
      select * into o from orders where id = o.id;
      ok := ok and o.status::text = 'searching' and o.payment_status = 'paid';
      o := pg_temp.v2_selesaikan(o.id);
      perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
      lc := ledger_check(o.id);
      log := log || format('S82c %s AntarPay mati, per order gopay %s: awaiting→bayar→%s, saldo pelanggan Δ%s, pg_fee=%s (2%%), ledger seimbang=%s',
        case when ok and o.status = 'completed' and pg_temp.v2_saldo(cust) = c0 and o.pg_fee = round(o.total * 0.02) and (lc->>'balanced')::boolean then 'OK' else 'BUG' end,
        o.code, o.status, pg_temp.v2_saldo(cust) - c0, o.pg_fee, lc->>'balanced') || E'\n';
      -- (d) saldo/top up tetap dikuasai sakelar AntarPay
      perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
      alasan := '';
      begin o2 := pg_temp.v2_jalankan('ride_motor', 'wallet', null, '{"hanya_buat": true}'); ok := false; alasan := 'order saldo diterima';
      exception when others then alasan := left(sqlerrm, 40); ok := (sqlerrm like 'AntarPay sedang dinonaktifkan sementara%' or sqlerrm like 'AntarVoucher sedang dinonaktifkan sementara%'); end;
      begin tp := request_topup(50000, 'qris', null, 'uji S82'); ok := false; alasan := alasan || ' | top up diterima';
      exception when others then alasan := alasan || ' | top up: ' || left(sqlerrm, 40); if sqlerrm not like 'AntarPay sedang dinonaktifkan sementara%' and sqlerrm not like 'AntarVoucher sedang dinonaktifkan sementara%' then ok := false; end if; end;
      log := log || format('S82d %s saldo AntarPay tetap tertutup: %s', case when ok then 'OK' else 'BUG' end, alasan) || E'\n';
      -- (e) saluran gateway itu sendiri dimatikan → ditolak dengan nama salurannya
      perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
      perform admin_unlock('123456');
      r := admin_set_payment_channel('gopay', false);
      perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
      begin o2 := pg_temp.v2_jalankan('ride_motor', 'gopay', null, '{"hanya_buat": true, "tanpa_bayar": true}'); ok := false; alasan := 'diterima';
      exception when others then alasan := left(sqlerrm, 60); ok := sqlerrm like 'Metode pembayaran GoPay sedang dinonaktifkan%'; end;
      log := log || format('S82e %s sakelar per order menyala tetapi saluran GoPay mati → ditolak: %s', case when ok then 'OK' else 'BUG' end, alasan) || E'\n';
      -- (f) pulihkan: GoPay on, sakelar per order off, AntarPay on (keadaan uji sebelumnya)
      perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
      perform admin_unlock('123456');
      r := admin_set_payment_channel('gopay', true);
      r := admin_set_gateway_order_payment(false);
      r := admin_set_antarpay_enabled(true);
      log := log || format('S82f %s dipulihkan: gateway_order_payment_enabled=%s antarpay=%s gopay=%s', case when not gateway_order_payment_enabled() and antarpay_enabled() and payment_channel_enabled('gopay') then 'OK' else 'BUG' end,
        gateway_order_payment_enabled(), antarpay_enabled(), payment_channel_enabled('gopay')) || E'\n';
    end;
  exception when others then log := log || 'S82 BUG sakelar bayar per order: ' || sqlerrm || E'\n';
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    begin perform admin_unlock('123456'); r := admin_set_payment_channel('gopay', true); r := admin_set_gateway_order_payment(false); r := admin_set_antarpay_enabled(true); exception when others then null; end;
  end;

  -- ===== S83 (0104) Ambang bisnis lewat admin_set_settings: PIN, validasi, angka JSON, audit, pagar cap roda dua, driver_debt_limit publik =====
  begin
    declare j jsonb; v_audit int; v_wait jsonb;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
      perform admin_lock();
      ok := true; alasan := '';
      begin perform admin_set_settings('{"payout_sla_hours": 48}'); ok := false; alasan := 'tanpa PIN diterima';
      exception when others then alasan := left(sqlerrm, 30); if sqlerrm not ilike '%ADMIN_LOCKED%' and sqlerrm not ilike '%PIN%' then ok := false; end if; end;
      -- v3 T3 (0105): kunci umum (layar Otomasi/Pengaturan) JUGA wajib PIN + izin payment_config
      v_wait := coalesce((select value from app_settings where key = 'wait_apology_minutes'), '5'::jsonb);
      begin perform admin_set_settings(jsonb_build_object('wait_apology_minutes', v_wait)); ok := false; alasan := alasan || ' | kunci umum tanpa PIN diterima';
      exception when others then if sqlerrm not ilike '%ADMIN_LOCKED%' then ok := false; alasan := alasan || ' | ' || left(sqlerrm, 40); end if; end;
      log := log || format('S83a %s ambang bisnis tanpa PIN ditolak (%s); kunci umum (wait_apology_minutes) tanpa PIN juga ditolak (v3 T3)', case when ok then 'OK' else 'BUG' end, alasan) || E'\n';
      perform admin_unlock('123456');
      v_audit := (select count(*) from audit_logs where action = 'settings.business_updated');
      perform admin_set_settings('{"payout_sla_hours": "48", "gate_contribution_weeks": 4, "take_rate_north_star_pct": 22.5}');
      log := log || format('S83b %s disimpan: payout_sla_hours=%s (jsonb %s, dari teks "48") gate_contribution_weeks=%s take_rate=%s; audit +%s before.payout_sla_hours=%s after=%s',
        case when (select value from app_settings where key = 'payout_sla_hours') = '48'::jsonb and (select jsonb_typeof(value) from app_settings where key = 'payout_sla_hours') = 'number'
                  and setting_num('gate_contribution_weeks', 0) = 4 and setting_num('take_rate_north_star_pct', 0) = 22.5
                  and (select count(*) from audit_logs where action = 'settings.business_updated') = v_audit + 1
                  and (select detail->'before'->>'payout_sla_hours' from audit_logs where action = 'settings.business_updated' order by created_at desc, id desc limit 1) = '24'
                  and (select detail->'after'->>'payout_sla_hours' from audit_logs where action = 'settings.business_updated' order by created_at desc, id desc limit 1) = '48' then 'OK' else 'BUG' end,
        (select value from app_settings where key = 'payout_sla_hours'), (select jsonb_typeof(value) from app_settings where key = 'payout_sla_hours'),
        setting_num('gate_contribution_weeks', 0), setting_num('take_rate_north_star_pct', 0), (select count(*) from audit_logs where action = 'settings.business_updated') - v_audit,
        (select detail->'before'->>'payout_sla_hours' from audit_logs where action = 'settings.business_updated' order by created_at desc, id desc limit 1),
        (select detail->'after'->>'payout_sla_hours' from audit_logs where action = 'settings.business_updated' order by created_at desc, id desc limit 1)) || E'\n';
      -- validasi: rentang, bilangan bulat, bukan angka, atomik (satu salah → tidak ada yang tersimpan), kunci ber-RPC khusus
      n := 0; alasan := '';
      begin perform admin_set_settings('{"order_payment_timeout_min": 2}'); exception when others then n := n + 1; alasan := alasan || left(sqlerrm, 40) || ' | '; end;
      begin perform admin_set_settings('{"driver_debt_limit": 1000}'); exception when others then n := n + 1; end;
      begin perform admin_set_settings('{"payout_fee_per_withdrawal": 2.5}'); exception when others then n := n + 1; alasan := alasan || left(sqlerrm, 40) || ' | '; end;
      begin perform admin_set_settings('{"gate_refund_max_pct": "abc"}'); exception when others then n := n + 1; end;
      begin perform admin_set_settings('{"payout_sla_hours": 30, "driver_debt_limit": 5}'); exception when others then n := n + 1; end;
      begin perform admin_set_settings('{"antarpay_enabled": true}'); exception when others then n := n + 1; alasan := alasan || left(sqlerrm, 45); end;
      log := log || format('S83c %s 6 masukan salah ditolak=%s (%s); payout_sla_hours tetap %s (atomik), antarpay tetap %s',
        case when n = 6 and setting_num('payout_sla_hours', 0) = 48 and antarpay_enabled() then 'OK' else 'BUG' end, n, alasan, setting_num('payout_sla_hours', 0), antarpay_enabled()) || E'\n';
      -- commission_cap_two_wheel: di bawah komisi ride_motor yang berlaku → ditolak; naik → komisi boleh naik sampai cap baru
      alasan := '';
      begin perform admin_set_settings('{"commission_cap_two_wheel": 5}'); ok := false; alasan := 'cap 5 diterima';
      exception when others then ok := sqlerrm like 'Batas komisi roda dua%'; alasan := left(sqlerrm, 70); end;
      perform admin_set_settings('{"commission_cap_two_wheel": 10}');
      se := admin_set_service_economics('ride_motor', '{"driver_commission_pct": 9}');
      ok := ok and commission_cap_two_wheel() = 10 and se.driver_commission_pct = 9;
      begin perform admin_set_settings('{"commission_cap_two_wheel": 8}'); ok := false; exception when others then null; end;   -- 9 % berlaku → cap 8 ditolak
      se := admin_set_service_economics('ride_motor', '{"driver_commission_pct": 8}');
      perform admin_set_settings('{"commission_cap_two_wheel": 8}');
      log := log || format('S83d %s cap roda dua: 5 ditolak (%s); 10 diterima → komisi 9 %% boleh; kembali 8 (setelah komisi 8) → cap=%s ride_motor=%s%%',
        case when ok and commission_cap_two_wheel() = 8 and (select driver_commission_pct from service_economics where service = 'ride_motor') = 8 then 'OK' else 'BUG' end,
        alasan, commission_cap_two_wheel(), (select driver_commission_pct from service_economics where service = 'ride_motor')) || E'\n';
      -- driver_debt_limit dibaca aplikasi (anon) + dipakai pagar; gerbang N minggu di laporan
      perform admin_set_settings('{"driver_debt_limit": -250000}');
      perform set_config('request.jwt.claims', '', true);
      set local role anon; j := app_public_settings(); reset role;
      perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
      r := admin_exec_report_v2((now() at time zone 'Asia/Jakarta')::date, (now() at time zone 'Asia/Jakarta')::date, '{}');
      sim := admin_business_settings();
      log := log || format('S83e %s app_public_settings(anon).driver_debt_limit=%s; exec_report_v2 minggu=%s weeks_required=%s label=%s; admin_business_settings %s kunci, payout_sla_hours=%s; admin_automation_status memuat take_rate_north_star_pct=%s',
        case when (j->>'driver_debt_limit')::numeric = -250000 and jsonb_array_length(r->'weeks') = 4 and (r->'gates'->'contribution_positive_8w'->>'weeks_required')::int = 4
                  and (r->'labels'->'gate_contribution_weeks'->>'value')::int = 4 and jsonb_array_length(sim->'settings') = 11
                  and (select (x->>'value')::numeric from jsonb_array_elements(sim->'settings') x where x->>'key' = 'payout_sla_hours') = 48
                  and (admin_automation_status()->'settings') ? 'take_rate_north_star_pct' then 'OK' else 'BUG' end,
        j->>'driver_debt_limit', jsonb_array_length(r->'weeks'), r->'gates'->'contribution_positive_8w'->>'weeks_required', r->'labels'->'gate_contribution_weeks'->>'value',
        jsonb_array_length(sim->'settings'), (select x->>'value' from jsonb_array_elements(sim->'settings') x where x->>'key' = 'payout_sla_hours'),
        (admin_automation_status()->'settings') ? 'take_rate_north_star_pct') || E'\n';
      perform admin_set_settings('{"driver_debt_limit": -500000, "payout_sla_hours": 24, "gate_contribution_weeks": 8, "take_rate_north_star_pct": 25}');
    end;
  exception when others then reset role; log := log || 'S83 BUG ambang bisnis: ' || sqlerrm || E'\n';
    perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    begin perform admin_unlock('123456'); se := admin_set_service_economics('ride_motor', '{"driver_commission_pct": 8}');
      perform admin_set_settings('{"driver_debt_limit": -500000, "payout_sla_hours": 24, "gate_contribution_weeks": 8, "take_rate_north_star_pct": 25, "commission_cap_two_wheel": 8}');
    exception when others then null; end;
  end;

  -- ===== S84 (0104) Buku besar admin: admin_ledger_unbalanced (order selesai 30 hari, balanced=false) + admin_ledger_lookup lintas sumber =====
  begin
    declare v_row bigint; v_code text; v_tb travel_bookings; v_ad uuid; j jsonb; v_verdict text;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
      r := admin_ledger_unbalanced(50);
      n := (r->>'unbalanced')::int;
      -- rusak satu baris platform_revenue order selesai simulasi ini (+1) → harus muncul, selisih −1
      select l.id, x.code into v_row, v_code from order_ledger l join orders x on x.id = l.order_id
       where x.status = 'completed' and x.ledger_version = 2 and x.created_at >= transaction_timestamp() and l.phase = 'completed' and l.entry = 'platform_revenue'
       order by x.completed_at desc limit 1;
      -- Finpay v3 (0106): order_ledger append-only — merusak baris hanya lewat sesi pemeliharaan tanpa JWT + antarkita.append_only_bypass
      perform set_config('request.jwt.claims', '', true); perform set_config('antarkita.append_only_bypass', 'on', true);
      update order_ledger set amount = amount + 1 where id = v_row;
      perform set_config('antarkita.append_only_bypass', 'off', true);
      perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
      r := admin_ledger_unbalanced(50);
      j := (select x from jsonb_array_elements(r->'items') x where x->>'code' = v_code);
      ok := (r->>'unbalanced')::int = n + 1 and j is not null and (j->>'diff')::bigint = -1 and (r->>'checked')::int > 0;
      ok := ok and jsonb_array_length(admin_ledger_unbalanced(1)->'items') <= 1;
      perform set_config('request.jwt.claims', '', true); perform set_config('antarkita.append_only_bypass', 'on', true);
      update order_ledger set amount = amount - 1 where id = v_row;
      perform set_config('antarkita.append_only_bypass', 'off', true);
      perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
      log := log || format('S84a %s admin_ledger_unbalanced: awal %s tidak seimbang dari %s order; baris %s dirusak +1 → muncul (diff=%s), dipulihkan → %s',
        case when ok and n = 0 and (admin_ledger_unbalanced(50)->>'unbalanced')::int = 0 then 'OK' else 'BUG' end, n, r->>'checked', v_code, j->>'diff', admin_ledger_unbalanced(50)->>'unbalanced') || E'\n';
      -- pencarian: kode order (persis & awalan huruf kecil), booking travel (kode), iklan (ID)
      r := admin_ledger_lookup(v_code);
      j := r->'results'->0;
      ok := j->>'source' = 'orders' and j->>'code' = v_code and (j->'check'->>'balanced')::boolean and jsonb_array_length(j->'rows') > 0;
      r := admin_ledger_lookup(lower(left(v_code, 8)));
      ok := ok and exists (select 1 from jsonb_array_elements(r->'results') x where x->>'code' = v_code);
      select * into v_tb from travel_bookings where created_at >= transaction_timestamp() order by created_at limit 1;
      r := admin_ledger_lookup(v_tb.code);
      ok := ok and exists (select 1 from jsonb_array_elements(r->'results') x where x->>'source' = 'travel_bookings' and (x->>'source_id')::uuid = v_tb.id and jsonb_array_length(x->'rows') > 0 and x->'check' ? 'verdict');
      v_verdict := (select x->'check'->>'verdict' from jsonb_array_elements(r->'results') x where x->>'source' = 'travel_bookings' limit 1);
      select id into v_ad from merchant_ads where created_at >= transaction_timestamp() order by created_at limit 1;
      r := admin_ledger_lookup(v_ad::text);
      ok := ok and exists (select 1 from jsonb_array_elements(r->'results') x where x->>'source' = 'merchant_ads' and (x->'check'->>'balanced')::boolean);
      alasan := '';
      begin perform admin_ledger_lookup('AB'); ok := false; exception when others then alasan := left(sqlerrm, 40); end;
      perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
      begin perform admin_ledger_unbalanced(5); ok := false; exception when others then if sqlerrm not like 'Hanya admin%' then ok := false; end if; end;
      begin perform admin_ledger_lookup(v_code); ok := false; exception when others then if sqlerrm not like 'Hanya admin%' then ok := false; end if; end;
      log := log || format('S84b %s admin_ledger_lookup: order %s (persis & awalan), booking travel %s (%s), iklan %s ditemukan dengan baris + putusan; kueri pendek ditolak (%s); non-admin ditolak',
        case when ok then 'OK' else 'BUG' end, v_code, v_tb.code, coalesce(v_verdict, '-'), v_ad, alasan) || E'\n';
    end;
  exception when others then log := log || 'S84 BUG buku besar admin: ' || sqlerrm || E'\n'; end;

  -- ===== S85 (0104) Biaya tetap kota: hapus sel (p_delete, nominal 0) & p_note '' mengosongkan catatan =====
  begin
    declare c city_fixed_costs; v_city uuid := (select id from cities where name = 'Pekanbaru' limit 1); v_m date := date_trunc('month', now() at time zone 'Asia/Jakarta')::date;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
      perform admin_unlock('123456');
      c := admin_set_city_fixed_cost(v_city, v_m, 'kantor', 500000, 'sewa ruko');
      c := admin_set_city_fixed_cost(v_city, v_m, 'kantor', 600000, null);   -- null → catatan tetap
      ok := c.amount = 600000 and c.note = 'sewa ruko';
      c := admin_set_city_fixed_cost(v_city, v_m, 'kantor', 600000, '  ');   -- kosong → dihapus
      ok := ok and c.note is null;
      alasan := '';
      begin c := admin_set_city_fixed_cost(v_city, v_m, 'kantor', 1000, null, true); ok := false; alasan := 'hapus dengan nominal > 0 diterima';
      exception when others then alasan := left(sqlerrm, 45); end;
      c := admin_set_city_fixed_cost(v_city, v_m, 'kantor', 0, null, true);
      ok := ok and c.amount = 600000 and not exists (select 1 from city_fixed_costs where city_id = v_city and month = v_m and category = 'kantor')
            and exists (select 1 from audit_logs where action = 'city_cost.deleted' and entity_id = c.id::text);
      c := admin_set_city_fixed_cost(v_city, v_m, 'kantor', 0, null, true);   -- sudah tidak ada → tidak error, null
      ok := ok and c.id is null;
      c := admin_set_city_fixed_cost(v_city, v_m, 'legal', 0, 'diisi nol');   -- nominal 0 tanpa hapus tetap disimpan
      ok := ok and c.amount = 0 and c.id is not null;
      log := log || format('S85 %s biaya kantor: catatan null=tetap, ""=kosong; hapus nominal>0 ditolak (%s); hapus → baris hilang + audit city_cost.deleted; hapus ulang → null; nominal 0 tanpa hapus tetap tersimpan',
        case when ok then 'OK' else 'BUG' end, alasan) || E'\n';
    end;
  exception when others then log := log || 'S85 BUG biaya tetap kota: ' || sqlerrm || E'\n'; end;

  -- ===== S86 (0104) merchant_order_breakdown pesanan batal/refund → phase cancelled, diterima 0 =====
  begin
    declare o3 orders;
    begin
      m0 := pg_temp.v2_saldo(mown);
      o := pg_temp.v2_jalankan('food', 'wallet', null, '{"hanya_buat": true}');   -- dibayar saldo → ditolak merchant → refund
      perform set_config('request.jwt.claims', json_build_object('sub', mown, 'role', 'authenticated')::text, true);
      o := merchant_update_order(o.id, 'rejected');
      bd := merchant_order_breakdown(o.id);
      o3 := pg_temp.v2_jalankan('food', 'cash', null, '{"hanya_buat": true}');   -- tunai → dibatalkan pelanggan
      perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
      o3 := cancel_order(o3.id, 'uji S86');
      perform set_config('request.jwt.claims', json_build_object('sub', mown, 'role', 'authenticated')::text, true);
      sim := merchant_order_breakdown(o3.id);
      log := log || format('S86 %s ditolak merchant (%s, bayar=%s): phase=%s ledger=%s diterima=%s nilai=%s | batal pelanggan tunai (%s): phase=%s diterima=%s | saldo merchant Δ%s',
        case when o.payment_status = 'refunded' and bd->>'phase' = 'cancelled' and bd->>'ledger_phase' = 'refunded' and (bd->>'diterima')::bigint = 0 and (bd->>'nilai_pesanan')::bigint = o.items_subtotal
                  and sim->>'phase' = 'cancelled' and (sim->>'diterima')::bigint = 0 and pg_temp.v2_saldo(mown) = m0 then 'OK' else 'BUG' end,
        o.code, o.payment_status, bd->>'phase', bd->>'ledger_phase', bd->>'diterima', bd->>'nilai_pesanan', o3.code, sim->>'phase', sim->>'diterima', pg_temp.v2_saldo(mown) - m0) || E'\n';
    end;
  exception when others then log := log || 'S86 BUG rincian merchant batal: ' || sqlerrm || E'\n'; end;

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
