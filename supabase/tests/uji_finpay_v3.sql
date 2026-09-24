-- Uji Finpay v3 (migrasi 0105–0110): provider pembayaran & feature flag, payments kanonik, inbox webhook
-- (duplikat, tidak berurutan, terlambat), intent idempoten, K1 simulasi, refund (penuh/sebagian, dual approval),
-- dispute, RBAC, penguncian tulis langsung, append-only, payout & disbursement, rekonsiliasi, iklan v3.
-- Kontrak: docs/finpay-v3/KONTRAK-API-V3.md. Dijalankan dalam SATU transaksi lalu di-ROLLBACK
-- (blok DO diakhiri RAISE 'SIMULASI_SELESAI' + log). Cara pakai lokal:
--   scripts/db-lokal.sh test supabase/tests/uji_finpay_v3.sql
-- Mengandaikan akun uji seed.sql (a0..01 admin superadmin, ..02 pelanggan, ..03 driver motor, ..04 driver mobil,
-- ..05 pemilik merchant b0..01) + fixture scripts/db-lokal/pasca/seed.sql, PIN admin 123456.
-- Admin tambahan (finance, cs, viewer, ops) dibuat di dalam transaksi ini.
-- Kode baris: S<nomor><huruf> OK|BUG — dihitung db-lokal.sh.

create or replace function pg_temp.v3_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', case when p_uid is null then '' else json_build_object('sub', p_uid, 'role', 'authenticated')::text end, true);
$$;

create or replace function pg_temp.v3_saldo(p_user uuid) returns bigint language sql as $$
  select coalesce((select balance from wallets where user_id = p_user), 0);
$$;

-- akun admin uji dengan peran tertentu (auth.users → handle_new_user → profiles), PIN 123456
create or replace function pg_temp.v3_admin(p_role text) returns uuid language plpgsql as $$
declare u uuid := gen_random_uuid(); mail text := 'uji.v3.' || p_role || '.' || left(u::text, 8) || '@antaraja.id';
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values ('00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated', mail, extensions.crypt('rahasia123', extensions.gen_salt('bf')), now(), now(), now(),
          '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('full_name', 'Admin ' || p_role, 'phone', '+6281' || (floor(random() * 1e9))::bigint, 'email', mail));
  perform pg_temp.v3_as(null);
  perform set_config('antaraja.bypass', 'on', true);
  update profiles set role = 'admin' where id = u;
  perform set_config('antaraja.bypass', 'off', true);
  update profiles set admin_role = p_role where id = u;   -- tanpa JWT (sesi pemeliharaan) — di aplikasi lewat admin_set_admin_role
  insert into admin_security (user_id, pin_hash) values (u, extensions.crypt('123456', extensions.gen_salt('bf')));
  perform pg_temp.v3_as(u);
  perform admin_unlock('123456');
  return u;
end $$;

-- pesanan pelanggan uji (belum diproses)
create or replace function pg_temp.v3_order(p_service text, p_pay text) returns orders language plpgsql as $$
declare cust uuid := 'a0000000-0000-4000-8000-000000000002'; merch uuid := 'b0000000-0000-4000-8000-000000000001'; menu1 uuid; p jsonb;
begin
  select id into menu1 from menu_items where merchant_id = merch and is_available limit 1;
  perform pg_temp.v3_as(cust);
  p := case p_service
    when 'food' then jsonb_build_object('service','food','merchant_id', merch,'items', jsonb_build_array(jsonb_build_object('menu_item_id', menu1, 'qty', 2)),
                                       'dropoff', jsonb_build_object('lat',-0.945,'lng',100.36,'address','V3 Kos'))
    else jsonb_build_object('service','ride_motor','vehicle_class','motor_economy','pickup', jsonb_build_object('lat',0.4810,'lng',101.4349,'address','V3 Jemput'),
                            'dropoff', jsonb_build_object('lat',0.50,'lng',101.44,'address','V3 Tujuan')) end;
  return create_order(p || jsonb_build_object('paid_via', p_pay, 'client_request_id', 'v3-' || md5(random()::text)));
end $$;

-- alur edge pay-create + pay-webhook: order_payment_prepare (JWT pelanggan) → payment_intent_create (service_role) → event PAID
create or replace function pg_temp.v3_intent(p_order uuid, p_channel text default null, p_provider text default 'finpay') returns payments language plpgsql as $$
declare o orders; q jsonb;
begin
  select * into o from orders where id = p_order;
  perform pg_temp.v3_as(o.customer_id);
  q := order_payment_prepare(p_order, p_channel);
  perform pg_temp.v3_as(null);
  return payment_intent_create(o.customer_id, 'order', p_order, (q->>'gross')::bigint, q->>'channel', p_provider);
end $$;

create or replace function pg_temp.v3_bayar(p_order uuid, p_channel text default null) returns payments language plpgsql as $$
declare pay payments; r jsonb;
begin
  pay := pg_temp.v3_intent(p_order, p_channel, 'finpay');
  r := payment_event_ingest('finpay', 'ev-' || pay.id || '-paid', pay.external_id, 'PAID', pay.amount, true,
    jsonb_build_object('order', jsonb_build_object('id', pay.external_id, 'amount', pay.amount), 'transaction', jsonb_build_object('status', 'PAID')));
  select * into pay from payments where id = pay.id;
  return pay;
end $$;

-- selesaikan pesanan (food: merchant terima & siap) oleh driver motor uji
create or replace function pg_temp.v3_selesai(p_order uuid) returns orders language plpgsql as $$
declare o orders; v_pin text; drv uuid := 'a0000000-0000-4000-8000-000000000003'; mown uuid := 'a0000000-0000-4000-8000-000000000005';
  v_lat double precision; v_lng double precision;
begin
  select * into o from orders where id = p_order;
  if o.service = 'food' then
    perform pg_temp.v3_as(mown);
    if o.merchant_status = 'pending' then o := merchant_update_order(o.id, 'accepted'); end if;
    if o.merchant_status = 'accepted' then o := merchant_update_order(o.id, 'ready'); end if;
    v_lat := -0.9405; v_lng := 100.3625;
  else v_lat := 0.4810; v_lng := 101.4349; end if;
  perform pg_temp.v3_as(drv);
  perform driver_selfie_check('https://x/selfie.jpg'); perform driver_set_online(true, v_lat, v_lng);
  select pin into v_pin from order_pins where order_id = o.id;
  o := driver_accept_order(o.id); o := driver_update_order_status(o.id, 'arrived', null);
  o := driver_update_order_status(o.id, 'in_progress', v_pin);
  o := driver_update_order_status(o.id, 'completed', null);
  return o;
end $$;

do $sim$
declare
  cust uuid := 'a0000000-0000-4000-8000-000000000002'; drv uuid := 'a0000000-0000-4000-8000-000000000003'; drv2 uuid := 'a0000000-0000-4000-8000-000000000004';
  mown uuid := 'a0000000-0000-4000-8000-000000000005'; adm uuid := 'a0000000-0000-4000-8000-000000000001'; merch uuid := 'b0000000-0000-4000-8000-000000000001';
  fin uuid; cs uuid; vw uuid; ops uuid;
  log text := E'\n'; ok boolean; alasan text; r jsonb; r2 jsonb; n int; n2 int; b0 bigint; b1 bigint; c0 bigint; c1 bigint; m0 bigint; m1 bigint; d0 bigint; d1 bigint;
  f bigint; pp bigint; o orders; o4 orders; oD orders; o2 orders; pay payments; pay2 payments; pay4 payments; payD payments;
  rf refund_requests; rf2 refund_requests; w withdrawal_requests; dsp disputes; camp uuid; camp2 uuid; a merchant_ads; run reconciliation_runs; v_lat double precision; v_lng double precision;
  v_ext text; i int; v_err text; pol jsonb; lc jsonb; ap approval_requests; pcf payment_channel_fees;
begin
  -- ===== S0 Persiapan (ikut di-ROLLBACK) =====
  begin
    perform set_config('antaraja.bypass', 'on', true);
    update orders set status = 'cancelled' where customer_id = cust and status in ('scheduled','awaiting_payment','searching','accepted','arrived','in_progress');
    update orders set status = 'cancelled' where driver_id in (drv, drv2) and status in ('accepted','arrived','in_progress');
    update profiles set is_active = true where id in (cust, drv, drv2, mown, adm) and not is_active;
    update drivers set status = 'approved', status_reason = null, is_online = false where id in (drv, drv2) and status <> 'approved';
    update merchants set status = 'approved', is_open = true where id = merch and (status <> 'approved' or not is_open);
    perform set_config('antaraja.bypass', 'off', true);
    delete from order_rejections where driver_id in (drv, drv2);
    perform pg_temp.v3_as(adm);
    insert into admin_security (user_id, pin_hash) select adm, extensions.crypt('123456', extensions.gen_salt('bf')) where not exists (select 1 from admin_security where user_id = adm);
    update admin_security set pin_hash = extensions.crypt('123456', extensions.gen_salt('bf')), failed = 0, locked_until = null where user_id = adm;
    perform admin_unlock('123456');
    r := admin_set_antarpay_enabled(true);
    foreach alasan in array payment_channel_keys() loop r := admin_set_payment_channel(alasan, true); end loop;
    r := admin_set_gateway_order_payment(true);
    -- batas laju dilonggarkan untuk puluhan pesanan dalam satu transaksi (S33 menguji batasnya)
    insert into app_settings (key, value) values ('rate_limit_create_order_per_hour', '100000'), ('rate_limit_payment_prepare_per_hour', '100000'),
      ('rate_limit_withdrawal_per_hour', '100000'), ('payments_simulation_enabled', 'false'), ('payment_provider_env', '"sandbox"'),
      ('payment_provider_active', '"midtrans"'), ('refund_dual_approval_min', '200000'), ('wallet_adjust_dual_approval_min', '100000'), ('disbursement_provider', '"manual"')
    on conflict (key) do update set value = excluded.value, updated_at = now();
    perform wallet_apply(cust, 'topup', 5000000, null, 'saldo uji v3');
    perform wallet_apply(mown, 'earning', 300000, null, 'saldo pendapatan merchant uji v3 (iklan)');
    fin := pg_temp.v3_admin('finance'); cs := pg_temp.v3_admin('cs'); vw := pg_temp.v3_admin('viewer'); ops := pg_temp.v3_admin('ops');
    select lat, lng into v_lat, v_lng from merchants where id = merch;
    log := log || format('S0 %s persiapan: superadmin=%s finance/cs/viewer/ops dibuat, AntarPay=%s, bayar per pesanan via gateway=%s',
      case when (select admin_role from profiles where id = adm) = 'superadmin' and (select admin_role from profiles where id = fin) = 'finance' and antarpay_enabled()
                and gateway_order_payment_enabled() then 'OK' else 'BUG' end,
      (select admin_role from profiles where id = adm), antarpay_enabled(), gateway_order_payment_enabled()) || E'\n';
  exception when others then log := log || 'S0 BUG persiapan: ' || sqlerrm || E'\n'; end;

  -- ===== S1 Feature flag provider midtrans ↔ finpay (payment_provider_public anon; admin_set_settings PIN + izin) =====
  begin
    perform pg_temp.v3_as(null); set local role anon;
    r := payment_provider_public();
    reset role;
    perform pg_temp.v3_as(adm);
    perform admin_set_settings('{"payment_provider_active": "finpay"}');
    perform pg_temp.v3_as(null); set local role anon;
    r2 := payment_provider_public();
    reset role;
    ok := r->>'provider' = 'midtrans' and r2->>'provider' = 'finpay' and r2->>'env' = 'sandbox' and (r2->>'simulation')::boolean = false
      and exists (select 1 from jsonb_array_elements(r2->'channels') x where x->>'key' = 'bank_transfer' and (x->>'fee_fixed')::bigint = 3500 and (x->>'enabled')::boolean)
      and exists (select 1 from jsonb_array_elements(r2->'channels') x where x->>'key' = 'qris' and (x->>'fee_pct')::numeric = 0.7 and not (x->>'pass_to_customer')::boolean)
      and exists (select 1 from jsonb_array_elements(r2->'channels') x where x->>'key' = 'linkaja' and not (x->>'enabled')::boolean);
    -- kembali ke midtrans lalu finpay lagi (transaksi baru S4+ memakai finpay)
    perform pg_temp.v3_as(adm);
    perform admin_set_settings('{"payment_provider_active": "midtrans"}');
    ok := ok and payment_provider_active() = 'midtrans';
    perform admin_set_settings('{"payment_provider_active": "finpay"}');
    begin perform admin_set_settings('{"payment_provider_active": "doku"}'); ok := false; exception when others then null; end;
    log := log || format('S1a %s provider publik: awal=%s → finpay (env %s, simulasi %s, VA Rp3.500, QRIS 0,7 %% tanpa surcharge, LinkAja belum didukung app) → midtrans → finpay; nilai tak dikenal ditolak; audit provider_switched=%s',
      case when ok and payment_provider_active() = 'finpay' and exists (select 1 from audit_logs where action = 'payment.provider_switched' and created_at >= transaction_timestamp()) then 'OK' else 'BUG' end,
      r->>'provider', r2->>'env', r2->>'simulation', exists (select 1 from audit_logs where action = 'payment.provider_switched' and created_at >= transaction_timestamp())) || E'\n';
  exception when others then reset role; log := log || 'S1 BUG feature flag: ' || sqlerrm || E'\n'; end;

  -- ===== S2 pg_fee_calc: provider & effective_from memilih baris yang benar =====
  begin
    select x.fee, x.ppn into f, pp from pg_fee_calc('qris', 50000, 'finpay', '2026-09-30 10:00+07') x;
    ok := f = 350 and pp = 39;
    select x.fee into f from pg_fee_calc('qris', 50000, 'finpay', '2026-10-01 00:30+07') x;
    ok := ok and f = 0;
    select x.fee into f from pg_fee_calc('qris', 150000, 'finpay', '2026-10-02 10:00+07') x;
    ok := ok and f = 1050;
    select x.fee, x.ppn into f, pp from pg_fee_calc('bank_transfer', 100000) x;   -- 2 argumen lama → provider aktif (finpay)
    ok := ok and f = 3500 and pp = 385;
    select x.fee, x.ppn into f, pp from pg_fee_calc('bank_transfer', 100000, 'midtrans') x;
    log := log || format('S2 %s pg_fee_calc: QRIS Finpay 30 Sep Rp50.000=350+39; 1 Okt (≤Rp100.000)=0; 2 Okt Rp150.000=1.050; 2 argumen (aktif finpay) VA=3.500+385; midtrans VA=%s+%s',
      case when ok and f = 4000 and pp = 440 then 'OK' else 'BUG' end, f, pp) || E'\n';
  exception when others then log := log || 'S2 BUG pg_fee_calc: ' || sqlerrm || E'\n'; end;

  -- ===== S3 QRIS pass_to_customer dikunci false (RPC + CHECK) =====
  begin
    perform pg_temp.v3_as(adm);
    begin perform admin_set_payment_channel_fee('finpay', 'qris', '2026-01-01', '{"pass_to_customer": true, "pass_to_customer_legal_ok": true}'); v_err := 'RPC menerima';
    exception when others then v_err := sqlerrm; end;
    begin update payment_channel_fees set pass_to_customer = true where provider = 'finpay' and channel = 'qris'; alasan := 'UPDATE diterima';
    exception when check_violation then alasan := 'CHECK menolak'; end;
    log := log || format('S3 %s QRIS surcharge: RPC → %s | UPDATE langsung → %s',
      case when v_err like 'QRIS tidak boleh%' and alasan = 'CHECK menolak' then 'OK' else 'BUG' end, left(v_err, 70), alasan) || E'\n';
  exception when others then log := log || 'S3 BUG QRIS: ' || sqlerrm || E'\n'; end;

  -- ===== S4 Bayar sukses (Finpay QRIS): prepare → intent → webhook PAID → order dibayar, ledger seimbang, selesai =====
  begin
    c0 := pg_temp.v3_saldo(cust);
    o4 := pg_temp.v3_order('ride_motor', 'qris');
    perform pg_temp.v3_as(cust);
    r := order_payment_prepare(o4.id, null);
    pay4 := pg_temp.v3_bayar(o4.id);
    select * into o4 from orders where id = o4.id;
    perform pg_temp.v3_as(cust);
    r2 := my_payment_status(o4.id);
    perform pg_temp.v3_as(adm);
    lc := ledger_check(o4.id);
    ok := o4.status::text = 'searching' and o4.payment_status = 'paid' and pay4.pay_status = 'PAID' and pay4.status = 'settlement' and pay4.provider = 'finpay'
      and pay4.support_ref ~ '^AK-[0-9A-F]{6}$' and o4.payment_support_ref = pay4.support_ref and r->>'provider' = 'finpay' and (r->>'pg_fee_customer')::bigint = 0
      and r2->>'pay_status' = 'PAID' and r2->>'support_ref' = pay4.support_ref and pay4.paid_at is not null
      and o4.pg_fee = round(o4.total * 0.007) and o4.pg_fee_ppn = round(round(o4.total * 0.007) * 0.11) and (lc->>'balanced')::boolean and pg_temp.v3_saldo(cust) = c0;
    log := log || format('S4a %s bayar sukses %s: status=%s bayar=%s pay_status=%s (legacy %s) provider=%s support_ref=%s biaya PG %s+%s ditanggung %s (pelanggan %s) ledger=%s saldo Δ%s',
      case when ok then 'OK' else 'BUG' end, o4.code, o4.status, o4.payment_status, pay4.pay_status, pay4.status, pay4.provider, pay4.support_ref,
      o4.pg_fee, o4.pg_fee_ppn, o4.pg_fee_borne_by, r->>'pg_fee_customer', lc->>'verdict', pg_temp.v3_saldo(cust) - c0) || E'\n';
    o4 := pg_temp.v3_selesai(o4.id);
    perform pg_temp.v3_as(adm);
    lc := ledger_check(o4.id);
    log := log || format('S4b %s pesanan gateway selesai: settlement_status=%s ledger=%s',
      case when o4.status = 'completed' and o4.settlement_status = 'ORDER_COMPLETED' and (lc->>'balanced')::boolean then 'OK' else 'BUG' end, o4.settlement_status, lc->>'verdict') || E'\n';
  exception when others then log := log || 'S4 BUG bayar sukses: ' || sqlerrm || E'\n'; end;

  -- ===== S5 Webhook duplikat (event_id sama) → tidak diproses dua kali =====
  begin
    n := (select count(*) from order_events where order_id = o4.id);
    perform pg_temp.v3_as(null);
    r := payment_event_ingest('finpay', 'ev-' || pay4.id || '-paid', pay4.external_id, 'PAID', pay4.amount, true, '{"ulang": true}');
    log := log || format('S5 %s webhook duplikat: duplicate=%s applied=%s; event di inbox=%s; order_events tetap %s→%s',
      case when (r->>'duplicate')::boolean and not (r->>'applied')::boolean and (select count(*) from payment_events where provider = 'finpay' and event_id = 'ev-' || pay4.id || '-paid') = 1
                and (select count(*) from order_events where order_id = o4.id) = n then 'OK' else 'BUG' end,
      r->>'duplicate', r->>'applied', (select count(*) from payment_events where provider = 'finpay' and event_id = 'ev-' || pay4.id || '-paid'), n,
      (select count(*) from order_events where order_id = o4.id)) || E'\n';
  exception when others then log := log || 'S5 BUG duplikat: ' || sqlerrm || E'\n'; end;

  -- ===== S6 Webhook tidak berurutan: PENDING sesudah PAID → diabaikan =====
  begin
    r := payment_event_ingest('finpay', 'ev-' || pay4.id || '-late-pending', pay4.external_id, 'PENDING', pay4.amount, true, '{}');
    r2 := payment_event_ingest('finpay', 'ev-' || pay4.id || '-bad-sig', pay4.external_id, 'EXPIRED', pay4.amount, false, '{}');
    log := log || format('S6 %s PENDING sesudah PAID: applied=%s note=%s pay_status=%s | tanda tangan salah: applied=%s note=%s',
      case when not (r->>'applied')::boolean and r->>'note' = 'ignored_out_of_order' and (select pay_status from payments where id = pay4.id) = 'PAID'
                and not (r2->>'applied')::boolean and r2->>'note' = 'signature_invalid' then 'OK' else 'BUG' end,
      r->>'applied', r->>'note', (select pay_status from payments where id = pay4.id), r2->>'applied', r2->>'note') || E'\n';
  exception when others then log := log || 'S6 BUG tidak berurutan: ' || sqlerrm || E'\n'; end;

  -- ===== S7 Intent ganda per order → satu intent (idempoten); ganti saluran → intent lama digantikan =====
  begin
    o := pg_temp.v3_order('ride_motor', 'qris');
    pay := pg_temp.v3_intent(o.id); pay2 := pg_temp.v3_intent(o.id);
    ok := pay.id = pay2.id and (select count(*) from payments where order_id = o.id and pay_status = 'PENDING') = 1 and pay.expires_at is not null;
    pay2 := pg_temp.v3_intent(o.id, 'gopay');
    ok := ok and pay2.id <> pay.id and (select pay_status from payments where id = pay.id) = 'FAILED'
      and (select count(*) from payments where order_id = o.id and pay_status = 'PENDING') = 1;
    -- penulis lama (midtrans-create) memasukkan baris pending langsung → tetap satu PENDING
    perform pg_temp.v3_as(null);
    insert into payments (user_id, order_id, purpose, amount, method, provider, status, external_id, pg_channel)
    values (cust, o.id, 'order', pay2.amount, 'gopay', 'midtrans', 'pending', 'AKORD-V3-LEGACY-' || left(md5(random()::text), 8), 'gopay');
    log := log || format('S7 %s intent ganda: panggilan 2× → id sama=%s; ganti ke gopay → intent lama FAILED, PENDING=%s; sisipan lama → PENDING tetap %s',
      case when ok and (select count(*) from payments where order_id = o.id and pay_status = 'PENDING') = 1 then 'OK' else 'BUG' end,
      pay.id = (select id from payments where id = pay.id), 1, (select count(*) from payments where order_id = o.id and pay_status = 'PENDING')) || E'\n';
    perform pg_temp.v3_as(cust); perform cancel_order(o.id, 'uji S7 bersih');
  exception when others then log := log || 'S7 BUG intent ganda: ' || sqlerrm || E'\n'; end;

  -- ===== S8 Bayar gagal (FAILURE) → FAILED, pesanan tetap menunggu pembayaran =====
  begin
    o := pg_temp.v3_order('ride_motor', 'qris');
    pay := pg_temp.v3_intent(o.id);
    perform pg_temp.v3_as(null);
    r := payment_event_ingest('finpay', 'ev-' || pay.id || '-fail', pay.external_id, 'FAILURE', pay.amount, true, '{}');
    select * into pay from payments where id = pay.id; select * into o from orders where id = o.id;
    log := log || format('S8 %s bayar gagal: applied=%s pay_status=%s (legacy %s), pesanan %s/%s (bisa dicoba lagi)',
      case when (r->>'applied')::boolean and pay.pay_status = 'FAILED' and pay.status = 'failure' and o.status::text = 'awaiting_payment' and o.payment_status = 'unpaid' then 'OK' else 'BUG' end,
      r->>'applied', pay.pay_status, pay.status, o.status, o.payment_status) || E'\n';
    perform pg_temp.v3_as(cust); perform cancel_order(o.id, 'uji S8 bersih');
  exception when others then log := log || 'S8 BUG gagal: ' || sqlerrm || E'\n'; end;

  -- ===== S9 Kedaluwarsa (EXPIRED) =====
  begin
    oD := pg_temp.v3_order('ride_motor', 'qris');
    payD := pg_temp.v3_intent(oD.id);
    perform pg_temp.v3_as(null);
    r := payment_event_ingest('finpay', 'ev-' || payD.id || '-exp', payD.external_id, 'EXPIRED', payD.amount, true, '{}');
    select * into payD from payments where id = payD.id;
    log := log || format('S9 %s kedaluwarsa: applied=%s pay_status=%s (legacy %s)',
      case when (r->>'applied')::boolean and payD.pay_status = 'EXPIRED' and payD.status = 'expire' then 'OK' else 'BUG' end, r->>'applied', payD.pay_status, payD.status) || E'\n';
  exception when others then log := log || 'S9 BUG kedaluwarsa: ' || sqlerrm || E'\n'; end;

  -- ===== S10 Webhook terlambat: PAID sesudah EXPIRED (pesanan sudah dibatalkan otomatis) → late_paid + refund_requests =====
  begin
    perform set_config('antaraja.bypass', 'on', true);
    update orders set created_at = now() - interval '16 minutes' where id = oD.id;
    perform set_config('antaraja.bypass', 'off', true);
    perform pg_temp.v3_as(null);
    n := expire_unpaid_orders();
    c0 := pg_temp.v3_saldo(cust);
    r := payment_event_ingest('finpay', 'ev-' || payD.id || '-latepaid', payD.external_id, 'PAID', payD.amount, true, '{"terlambat": true}');
    select * into payD from payments where id = payD.id; select * into oD from orders where id = oD.id;
    select * into rf from refund_requests where payment_id = payD.id and reason = 'late_payment';
    log := log || format('S10 %s PAID sesudah EXPIRED: applied=%s note=%s; pesanan %s; refund_requests %s/%s tujuan %s Rp%s; saldo pelanggan Δ%s (AntarPay aktif → saldo); pay_status=%s refunded=%s',
      case when (r->>'applied')::boolean and r->>'note' = 'late_paid' and oD.status = 'cancelled' and rf.id is not null and rf.status = 'done' and rf.destination = 'wallet'
                and rf.amount = payD.amount and pg_temp.v3_saldo(cust) - c0 = payD.amount and payD.pay_status = 'REFUNDED' and payD.refunded_amount = payD.amount then 'OK' else 'BUG' end,
      r->>'applied', r->>'note', oD.status, rf.reason, rf.status, rf.destination, rf.amount, pg_temp.v3_saldo(cust) - c0, payD.pay_status, payD.refunded_amount) || E'\n';
  exception when others then log := log || 'S10 BUG terlambat: ' || sqlerrm || E'\n'; end;

  -- ===== S11 K1: simulasi ditolak saat production; hanya sandbox + sakelar simulasi =====
  begin
    perform pg_temp.v3_as(adm);
    perform admin_set_settings('{"payment_provider_env": "production", "payments_simulation_enabled": true}');
    perform pg_temp.v3_as(null);
    begin perform payment_intent_create(cust, 'topup', null, 50000, 'qris', 'simulated'); v_err := 'intent simulasi diterima';
    exception when others then v_err := sqlerrm; end;
    v_ext := 'AKPAY-V3-SIM-' || left(md5(random()::text), 8);
    insert into payments (user_id, purpose, amount, method, provider, status, external_id) values (cust, 'topup', 50000, 'qris', 'simulated', 'pending', v_ext);
    begin perform payment_settle(v_ext, 'settlement', '{"simulated": true}'); alasan := 'settle simulasi diterima';
    exception when others then alasan := sqlerrm; end;
    ok := v_err like 'Simulasi pembayaran nonaktif%' and alasan like 'Simulasi pembayaran ditolak%' and not payments_simulation_active();
    perform pg_temp.v3_as(adm);
    perform admin_set_settings('{"payment_provider_env": "sandbox"}');
    c0 := pg_temp.v3_saldo(cust);
    perform pg_temp.v3_as(null);
    pay := payment_settle(v_ext, 'settlement', '{"simulated": true}');
    ok := ok and payments_simulation_active() and pay.pay_status = 'PAID' and pg_temp.v3_saldo(cust) - c0 = 50000;
    perform pg_temp.v3_as(adm);
    perform admin_set_settings('{"payments_simulation_enabled": false}');
    log := log || format('S11 %s K1 production: intent → %s | payment_settle → %s | sandbox+simulasi → PAID saldo Δ%s; simulasi kini %s',
      case when ok and not payments_simulation_active() then 'OK' else 'BUG' end, left(v_err, 45), left(alasan, 45), pg_temp.v3_saldo(cust) - c0, payments_simulation_active()) || E'\n';
  exception when others then log := log || 'S11 BUG simulasi: ' || sqlerrm || E'\n'; end;

  -- ===== S12–S15 Refund (AntarPay NONAKTIF: dana kembali lewat gateway, bukan saldo) =====
  begin
    perform pg_temp.v3_as(adm);
    r := admin_set_antarpay_enabled(false);
    log := log || format('S12a %s AntarPay dimatikan, bayar per pesanan via gateway tetap %s', case when not antarpay_enabled() and gateway_order_payment_enabled() then 'OK' else 'BUG' end,
      gateway_order_payment_enabled()) || E'\n';
  exception when others then log := log || 'S12a BUG sakelar: ' || sqlerrm || E'\n'; end;

  -- S12 refund penuh: batal SEBELUM merchant menerima
  begin
    o := pg_temp.v3_order('food', 'qris');
    pay := pg_temp.v3_bayar(o.id);
    c0 := pg_temp.v3_saldo(cust);
    perform pg_temp.v3_as(cust);
    o := cancel_order(o.id, 'uji S12 batal sebelum diproses');
    pol := refund_policy_calc(o.id);
    select * into rf from refund_requests where order_id = o.id;
    rf2 := refund_request(o.id);   -- idempoten: permintaan terbuka dikembalikan
    ok := o.status = 'cancelled' and o.payment_status = 'paid' and rf.id = rf2.id and rf.kind = 'full' and rf.destination = 'gateway' and rf.status = 'requested'
      and rf.amount = o.total and pol->>'phase' = 'before_accept' and (pol->>'refundable')::bigint = o.total and (select pay_status from payments where id = pay.id) = 'REFUND_REQUESTED';
    perform pg_temp.v3_as(fin);
    rf := admin_refund_approve(rf.id);
    ok := ok and rf.status = 'approved' and rf.maker = fin;
    perform pg_temp.v3_as(null);
    rf := refund_claim(rf.id);
    rf := refund_execute_result(rf.id, true, 'FP-RF-S12', 'uji');
    select * into pay from payments where id = pay.id; select * into o from orders where id = o.id;
    perform pg_temp.v3_as(adm); lc := ledger_check(o.id);
    r := payment_event_ingest('finpay', 'ev-' || pay.id || '-refunded', pay.external_id, 'REFUNDED', pay.amount, true, '{}');
    log := log || format('S12b %s refund PENUH %s (sebelum merchant terima): kebijakan fase=%s refundable=%s=total %s; permintaan %s/%s → maker finance → done ref %s; pay_status=%s refunded=%s; bayar=%s; saldo pelanggan Δ%s (gateway); ledger=%s; webhook REFUNDED ulang=%s',
      case when ok and rf.status = 'done' and pay.pay_status = 'REFUNDED' and pay.refunded_amount = pay.amount and o.payment_status = 'refunded'
                and pg_temp.v3_saldo(cust) = c0 and (lc->>'balanced')::boolean and lc->>'phase' = 'refunded' and r->>'note' = 'no_change' then 'OK' else 'BUG' end,
      o.code, pol->>'phase', pol->>'refundable', o.total, rf.kind, rf.destination, rf.provider_ref, pay.pay_status, pay.refunded_amount, o.payment_status,
      pg_temp.v3_saldo(cust) - c0, lc->>'verdict', r->>'note') || E'\n';
  exception when others then log := log || 'S12 BUG refund penuh: ' || sqlerrm || E'\n'; end;

  -- S13 refund sebagian: batal SETELAH merchant memproses (harga barang tidak kembali; merchant menerima kompensasi)
  begin
    o := pg_temp.v3_order('food', 'qris');
    pay := pg_temp.v3_bayar(o.id);
    perform pg_temp.v3_as(mown); o := merchant_update_order(o.id, 'accepted');
    m0 := pg_temp.v3_saldo(mown);
    perform pg_temp.v3_as(cust);
    o := cancel_order(o.id, 'uji S13 batal setelah diproses');
    pol := refund_policy_calc(o.id);
    select * into rf from refund_requests where order_id = o.id;
    perform pg_temp.v3_as(fin); rf := admin_refund_approve(rf.id);
    -- jalur adapter edge pay-refund (5 argumen): klaim 'executing' lalu 'done'
    perform pg_temp.v3_as(null);
    rf := refund_execute_result(rf.id, 'executing', null, '{"by": "pay-refund"}'::jsonb, null);
    alasan := rf.status;
    rf := refund_execute_result(rf.id, 'done', 'FP-RF-S13', '{}'::jsonb, null);
    select * into pay from payments where id = pay.id; select * into o from orders where id = o.id;
    perform pg_temp.v3_as(adm); lc := ledger_check(o.id);
    b0 := (select (x->>'amount')::bigint from jsonb_array_elements(pol->'lines') x where x->>'key' = 'items');
    log := log || format('S13 %s refund SEBAGIAN %s (sesudah diproses): fase=%s refundable=%s + tidak=%s (barang %s) = dibayar %s; kind=%s; pay_status=%s refunded=%s/%s; merchant +%s (barang − fee %s%%); ledger=%s diff=%s',
      case when alasan = 'executing' and pol->>'phase' = 'processed' and (pol->>'refundable')::bigint + (pol->>'non_refundable')::bigint = (pol->>'paid')::bigint and (pol->>'non_refundable')::bigint = b0
                and rf.kind = 'partial' and rf.amount = (pol->>'refundable')::bigint and rf.status = 'done' and pay.pay_status = 'PARTIALLY_REFUNDED' and pay.refunded_amount = rf.amount
                and pg_temp.v3_saldo(mown) - m0 = b0 - floor(b0 * o.merchant_fee_pct_snap / 100.0) and (lc->>'balanced')::boolean then 'OK' else 'BUG' end,
      o.code, pol->>'phase', pol->>'refundable', pol->>'non_refundable', b0, pol->>'paid', rf.kind, pay.pay_status, pay.refunded_amount, pay.amount,
      pg_temp.v3_saldo(mown) - m0, o.merchant_fee_pct_snap, lc->>'verdict', lc->>'diff') || E'\n';
    -- S14 perbandingan kebijakan: sebelum diterima vs sesudah diproses
    log := log || format('S14 %s refund_policy_calc: sebelum diterima → seluruh pembayaran; sesudah diproses → harga barang (%s) tidak dikembalikan, ongkir & biaya platform dikembalikan (%s)',
      case when (select bool_and((x->>'refundable')::boolean) from jsonb_array_elements(pol->'lines') x where x->>'key' in ('delivery','platform_fee'))
                and not (select (x->>'refundable')::boolean from jsonb_array_elements(pol->'lines') x where x->>'key' = 'items') then 'OK' else 'BUG' end,
      b0, pol->>'refundable') || E'\n';
  exception when others then log := log || 'S13 BUG refund sebagian: ' || sqlerrm || E'\n'; end;

  -- S15 dual approval refund: maker ≠ checker; maker = checker ditolak
  begin
    update app_settings set value = '10000'::jsonb where key = 'refund_dual_approval_min';
    o := pg_temp.v3_order('food', 'qris');
    pay := pg_temp.v3_bayar(o.id);
    perform pg_temp.v3_as(cust); o := cancel_order(o.id, 'uji S15 dual approval');
    select * into rf from refund_requests where order_id = o.id;
    perform pg_temp.v3_as(fin); rf := admin_refund_approve(rf.id);
    ok := rf.status = 'requested' and rf.maker = fin and rf.approval_id is not null;
    begin perform admin_refund_confirm(rf.id); v_err := 'maker = checker diterima'; exception when others then v_err := sqlerrm; end;
    begin perform admin_approval_decide(rf.approval_id, true, 'coba sendiri'); alasan := 'approval sendiri diterima'; exception when others then alasan := sqlerrm; end;
    perform pg_temp.v3_as(adm); rf := admin_refund_confirm(rf.id);
    ok := ok and rf.status = 'approved' and rf.checker = adm and v_err like 'DUAL_APPROVAL%' and alasan like 'DUAL_APPROVAL%'
      and (select status from approval_requests where id = rf.approval_id) = 'approved';
    perform pg_temp.v3_as(null); rf := refund_execute_result(rf.id, true, 'FP-RF-S15', null);
    perform pg_temp.v3_as(adm); lc := ledger_check(o.id);
    log := log || format('S15 %s dual approval refund Rp%s (≥ ambang 10.000): maker finance → requested; maker=checker → %s | approval sendiri → %s; checker superadmin → %s → %s; ledger=%s',
      case when ok and rf.status = 'done' and (lc->>'balanced')::boolean then 'OK' else 'BUG' end, rf.amount, left(v_err, 40), left(alasan, 40), 'approved', rf.status, lc->>'verdict') || E'\n';
    update app_settings set value = '200000'::jsonb where key = 'refund_dual_approval_min';
  exception when others then log := log || 'S15 BUG dual approval: ' || sqlerrm || E'\n';
    update app_settings set value = '200000'::jsonb where key = 'refund_dual_approval_min';
  end;

  -- AntarPay dinyalakan lagi untuk skenario saldo/penarikan
  begin perform pg_temp.v3_as(adm); r := admin_set_antarpay_enabled(true); exception when others then log := log || 'S15z BUG AntarPay: ' || sqlerrm || E'\n'; end;

  -- ===== S16 RBAC: cs tidak bisa uang, finance bisa, viewer baca saja; peran dikelola superadmin =====
  begin
    perform pg_temp.v3_as(cs);
    r := my_admin_role();
    begin perform admin_refund_approve(rf.id); v_err := 'cs bisa approve refund'; exception when others then v_err := sqlerrm; end;
    begin perform admin_adjust_wallet(cust, 1000, 'uji cs'); alasan := 'cs bisa adjust saldo'; exception when others then alasan := sqlerrm; end;
    ok := r->>'role' = 'cs' and not (r->'perms' ? 'refund') and v_err like 'ADMIN_FORBIDDEN%' and alasan like 'ADMIN_FORBIDDEN%';
    r2 := admin_disputes(null);   -- cs boleh melihat sengketa
    perform pg_temp.v3_as(vw);
    r2 := admin_payment_events(pay4.external_id);
    ok := ok and jsonb_array_length(r2->'events') >= 1;
    begin perform admin_set_settings('{"refund_dual_approval_min": 1}'); v_err := 'viewer bisa ubah setelan'; exception when others then v_err := sqlerrm; end;
    begin perform admin_reconcile_run(current_date); alasan := 'viewer bisa rekonsiliasi'; exception when others then alasan := sqlerrm; end;
    ok := ok and v_err like 'ADMIN_FORBIDDEN%' and alasan like 'ADMIN_FORBIDDEN%';
    perform pg_temp.v3_as(fin);
    begin perform admin_set_admin_role(cs, 'finance'); v_err := 'finance bisa ubah peran'; exception when others then v_err := sqlerrm; end;
    perform pg_temp.v3_as(adm);
    r := admin_set_admin_role(vw, 'ops');
    begin perform admin_set_admin_role(adm, 'viewer'); alasan := 'superadmin terakhir turun'; exception when others then alasan := sqlerrm; end;
    r2 := admin_set_admin_role(vw, 'viewer');
    -- admin_role tidak bisa diubah langsung oleh admin (trigger)
    perform pg_temp.v3_as(adm);
    begin update profiles set admin_role = 'superadmin' where id = cs; n := 1; exception when others then n := 0; end;
    log := log || format('S16 %s RBAC: cs → refund %s, saldo %s; viewer → lihat event %s, ubah setelan/rekonsiliasi ditolak; finance ubah peran → %s; superadmin ubah viewer→ops OK, turunkan superadmin terakhir → %s; UPDATE admin_role langsung ditolak=%s',
      case when ok and v_err like 'ADMIN_FORBIDDEN%' and r->>'admin_role' = 'ops' and alasan like 'Superadmin terakhir%' and n = 0 and (select admin_role from profiles where id = cs) = 'cs' then 'OK' else 'BUG' end,
      'ditolak', 'ditolak', 'boleh', left(v_err, 30), left(alasan, 30), n = 0) || E'\n';
  exception when others then log := log || 'S16 BUG RBAC: ' || sqlerrm || E'\n'; end;

  -- ===== S17 Tulis langsung tabel aturan/finansial oleh admin ditolak; RPC ber-PIN jalan =====
  begin
    perform pg_temp.v3_as(adm);
    n := 0; alasan := '';
    set local role authenticated;
    begin update app_settings set value = value where key = 'driver_debt_limit'; alasan := alasan || ' app_settings'; exception when insufficient_privilege then n := n + 1; end;
    begin update service_economics set customer_platform_fee = customer_platform_fee where service = 'send'; alasan := alasan || ' service_economics'; exception when insufficient_privilege then n := n + 1; end;
    begin update pricing set platform_fee = platform_fee where service = 'send'; alasan := alasan || ' pricing'; exception when insufficient_privilege then n := n + 1; end;
    begin insert into promos (code, value) values ('V3HACK', 1000); alasan := alasan || ' promos'; exception when insufficient_privilege then n := n + 1; end;
    begin update payment_channel_fees set fee_pct = 0 where channel = 'qris'; alasan := alasan || ' payment_channel_fees'; exception when insufficient_privilege then n := n + 1; end;
    begin update ad_products set unit_price = 1 where code = 'boost_nearby'; alasan := alasan || ' ad_products'; exception when insufficient_privilege then n := n + 1; end;
    reset role;
    perform pg_temp.v3_as(ops);
    r := to_jsonb(admin_set_pricing('ride_car', '{"platform_fee": 4500}'));
    r2 := to_jsonb(admin_upsert_promo('{"code": "V3PROMO", "value": 3000, "funded_by": "merchant", "service": "food"}'));
    r2 := to_jsonb(admin_set_promo('V3PROMO', '{"is_active": false}'));
    perform pg_temp.v3_as(cs);
    begin perform admin_set_pricing('ride_car', '{"platform_fee": 1}'); v_err := 'cs bisa ubah tarif'; exception when others then v_err := sqlerrm; end;
    log := log || format('S17 %s tulis langsung admin ditolak %s/6 tabel%s; ops lewat RPC: pricing.platform_fee=%s promo V3PROMO aktif=%s; cs ubah tarif → %s',
      case when n = 6 and alasan = '' and (r->>'platform_fee')::bigint = 4500 and (r2->>'is_active')::boolean = false and v_err like 'ADMIN_FORBIDDEN%'
                and exists (select 1 from audit_logs where action = 'pricing.updated' and created_at >= transaction_timestamp()) then 'OK' else 'BUG' end,
      n, case when alasan <> '' then ' (lolos:' || alasan || ')' else '' end, r->>'platform_fee', r2->>'is_active', left(v_err, 30)) || E'\n';
  exception when others then reset role; log := log || 'S17 BUG tulis langsung: ' || sqlerrm || E'\n'; end;

  -- ===== S18 Append-only: audit_logs, order_ledger, payment_events menolak UPDATE/DELETE (termasuk admin) =====
  begin
    perform pg_temp.v3_as(null);
    n := 0;
    begin update audit_logs set summary = 'x' where id = (select max(id) from audit_logs); exception when others then if sqlerrm like '%append-only%' then n := n + 1; end if; end;
    begin delete from audit_logs where id = (select max(id) from audit_logs); exception when others then if sqlerrm like '%append-only%' then n := n + 1; end if; end;
    begin delete from order_ledger where order_id = o4.id; exception when others then if sqlerrm like '%append-only%' then n := n + 1; end if; end;
    begin update payment_events set raw = '{}' where payment_id = pay4.id; exception when others then if sqlerrm like '%append-only%' then n := n + 1; end if; end;
    begin delete from payment_events where payment_id = pay4.id; exception when others then if sqlerrm like '%append-only%' then n := n + 1; end if; end;
    begin update payment_events set result = 'ubah' where payment_id = pay4.id and processed_at is not null; exception when others then if sqlerrm like '%sudah diproses%' then n := n + 1; end if; end;
    -- bypass pemeliharaan TIDAK berlaku bila ada JWT pengguna (admin)
    perform pg_temp.v3_as(adm); perform set_config('antarkita.append_only_bypass', 'on', true);
    begin delete from audit_logs where id = (select max(id) from audit_logs); exception when others then if sqlerrm like '%append-only%' then n := n + 1; end if; end;
    perform set_config('antarkita.append_only_bypass', 'off', true);
    set local role authenticated;
    begin delete from audit_logs where id = (select max(id) from audit_logs); exception when insufficient_privilege then n := n + 1; end;
    reset role;
    log := log || format('S18 %s append-only: %s/8 perubahan ditolak (audit_logs UPDATE/DELETE, order_ledger DELETE, payment_events UPDATE/DELETE/ubah hasil, bypass dengan JWT admin, DELETE sebagai klien)',
      case when n = 8 then 'OK' else 'BUG' end, n) || E'\n';
  exception when others then reset role; log := log || 'S18 BUG append-only: ' || sqlerrm || E'\n'; end;

  -- ===== S19 Payout PENDING → PROCESSING → SETTLED (provider) + settlement_status pesanan =====
  begin
    perform set_config('antaraja.bypass', 'on', true);
    insert into bank_accounts (user_id, bank_name, account_no, holder, verified) values (drv, 'BCA', '111222333', 'Driver Uji', true)
    on conflict (user_id) do update set bank_name = 'BCA', account_no = '111222333', holder = 'Driver Uji', verified = true;
    update fraud_flags set status = 'dismissed' where subject_id = drv and status = 'open';
    perform set_config('antaraja.bypass', 'off', true);
    perform pg_temp.v3_as(drv);
    w := request_withdrawal(20000, 'BCA', '111222333', 'Driver Uji');
    if w.status = 'pending' then perform pg_temp.v3_as(fin); w := admin_review_withdrawal(w.id, true, 'uji v3'); end if;
    ok := w.payout_status = 'PAYOUT_PENDING' and w.provider = 'manual' and exists (select 1 from withdrawal_orders where withdrawal_id = w.id and order_id = o4.id)
      and (select settlement_status from orders where id = o4.id) = 'PAYOUT_PENDING';
    perform pg_temp.v3_as(null);
    r := payout_event_ingest(w.id::text, 'PROCESSING', '{"inquiry_ref": "INQ-V3-1"}');
    r2 := payout_event_ingest(w.id::text, 'SUCCESS', '{"reference": "FP-TRF-V3-1", "fee": 2500}');
    select * into w from withdrawal_requests where id = w.id;
    perform pg_temp.v3_as(drv);
    r := my_withdrawals(); lc := driver_order_breakdown(o4.id);
    log := log || format('S19 %s payout: pending(%s, %s pesanan tertaut) → PROCESSING → %s settled_at=%s ref=%s fee=%s → ledger payout_fee=%s; pesanan %s settlement=%s payout=%s; my_withdrawals=%s',
      case when ok and w.payout_status = 'PAYOUT_SETTLED' and w.settled_at is not null and w.provider_ref = 'FP-TRF-V3-1' and w.fee = 2500 and w.inquiry_ref = 'INQ-V3-1'
                and (select sum(amount) from order_ledger where source = 'payouts' and source_id = w.id and entry = 'payout_fee') = -2500
                and lc->>'settlement_status' = 'PAYOUT_SETTLED' and lc->>'payout_status' = 'PAYOUT_SETTLED' and lc ? 'pg_fee_funded_by'
                and (r->0->>'payout_status') = 'PAYOUT_SETTLED' then 'OK' else 'BUG' end,
      w.provider, (select count(*) from withdrawal_orders where withdrawal_id = w.id), w.payout_status, w.settled_at is not null, w.provider_ref, w.fee,
      (select sum(amount) from order_ledger where source = 'payouts' and source_id = w.id), o4.code, lc->>'settlement_status', lc->>'payout_status', r->0->>'payout_status') || E'\n';
  exception when others then log := log || 'S19 BUG payout: ' || sqlerrm || E'\n'; end;

  -- ===== S20 Payout gagal → saldo kembali (sekali), status terminal tidak mundur =====
  begin
    d0 := pg_temp.v3_saldo(drv);
    perform pg_temp.v3_as(drv);
    w := request_withdrawal(20000, 'BCA', '111222333', 'Driver Uji');
    if w.status = 'pending' then perform pg_temp.v3_as(fin); w := admin_review_withdrawal(w.id, true, 'uji v3'); end if;
    d1 := pg_temp.v3_saldo(drv);
    perform pg_temp.v3_as(null);
    r := payout_event_ingest(w.id::text, 'FAILED', '{"reason": "rekening tidak valid"}');
    r2 := payout_event_ingest(w.id::text, 'FAILED', '{"reason": "ulang"}');
    select * into w from withdrawal_requests where id = w.id;
    perform pg_temp.v3_as(null);
    log := log || format('S20 %s payout gagal: saldo %s → %s (−20.000) → %s; payout_status=%s status=%s alasan=%s; event gagal ulang → %s (tidak refund dua kali)',
      case when d1 = d0 - 20000 and pg_temp.v3_saldo(drv) = d0 and w.payout_status = 'PAYOUT_FAILED' and w.status = 'rejected' and w.failed_reason = 'rekening tidak valid'
                and r2->>'note' = 'no_change' and (select count(*) from wallet_transactions where ref = 'WDF-' || w.id::text) = 1 then 'OK' else 'BUG' end,
      d0, d1, pg_temp.v3_saldo(drv), w.payout_status, w.status, w.failed_reason, r2->>'note') || E'\n';
  exception when others then log := log || 'S20 BUG payout gagal: ' || sqlerrm || E'\n'; end;

  -- ===== S21 Rekonsiliasi: selisih → unreconciled + reconciliation_runs; cocok → reconciled_at & RECONCILED =====
  begin
    perform pg_temp.v3_as(null);
    -- top up "PAID" tanpa kredit saldo (mis. webhook hilang di sisi AntarKita) → harus ketahuan
    insert into payments (user_id, purpose, amount, method, provider, external_id, pg_channel, pay_status, settlement_time)
    values (cust, 'topup', 50000, 'qris', 'finpay', 'AKPAY-V3-RECON-' || left(md5(random()::text), 8), 'qris', 'PAID', now())
    returning * into pay2;
    run := reconcile_daily((now() at time zone 'Asia/Jakarta')::date, 'daily', null);
    n := (select count(*) from order_ledger where source = 'reconciliation' and payment_id = pay2.id and entry = 'unreconciled');
    run := reconcile_daily((now() at time zone 'Asia/Jakarta')::date, 'daily', null);   -- jalan ulang: tidak menggandakan baris
    perform pg_temp.v3_as(fin); r := admin_reconcile_run((now() at time zone 'Asia/Jakarta')::date);
    perform pg_temp.v3_as(cs);
    begin perform admin_reconcile_run((now() at time zone 'Asia/Jakarta')::date); v_err := 'cs bisa rekonsiliasi'; exception when others then v_err := sqlerrm; end;
    log := log || format('S21 %s rekonsiliasi %s: dicek=%s selisih=%s (Rp%s) status=%s; baris unreconciled top up=%s (jalan ulang tetap %s); pembayaran S4 reconciled=%s pesanan %s; manual finance=%s; cs → %s',
      case when run.status = 'done' and run.mismatches >= 1 and run.unreconciled_amount >= 50000 and n = 1
                and (select count(*) from order_ledger where source = 'reconciliation' and payment_id = pay2.id and entry = 'unreconciled') = 1
                and exists (select 1 from jsonb_array_elements(run.report->'items') x where (x->>'payment_id')::uuid = pay2.id)
                and (select reconciled_at from payments where id = pay4.id) is not null and (select settlement_status from orders where id = o4.id) = 'RECONCILED'
                and r->>'kind' = 'manual' and v_err like 'ADMIN_FORBIDDEN%' then 'OK' else 'BUG' end,
      run.run_date, run.payments_checked, run.mismatches, run.unreconciled_amount, run.status, n,
      (select count(*) from order_ledger where source = 'reconciliation' and payment_id = pay2.id), (select reconciled_at from payments where id = pay4.id) is not null,
      (select settlement_status from orders where id = o4.id), r->>'status', left(v_err, 30)) || E'\n';
  exception when others then log := log || 'S21 BUG rekonsiliasi: ' || sqlerrm || E'\n'; end;

  -- ===== S22 Sengketa: buka (pelanggan) → investigasi (cs) → selesai dengan refund sebagian (finance) =====
  begin
    o2 := pg_temp.v3_order('food', 'wallet');
    o2 := pg_temp.v3_selesai(o2.id);
    c0 := pg_temp.v3_saldo(cust); d0 := pg_temp.v3_saldo(drv); m0 := pg_temp.v3_saldo(mown);
    perform pg_temp.v3_as(cust);
    dsp := dispute_open(o2.id, 'not_received', 20000, 'Satu porsi tidak ada di pesanan yang diterima');
    r := my_disputes();
    b0 := (select sum(amount) from order_ledger where source = 'disputes' and source_id = dsp.id);
    perform pg_temp.v3_as(cs);
    dsp := admin_dispute_resolve(dsp.id, 'investigating', null);
    begin perform admin_dispute_resolve(dsp.id, 'resolved_refund', 'cs coba refund', 20000); v_err := 'cs bisa refund sengketa'; exception when others then v_err := sqlerrm; end;
    perform pg_temp.v3_as(fin);
    dsp := admin_dispute_resolve(dsp.id, 'resolved_refund', 'Terbukti kurang satu porsi', 20000);
    select * into rf from refund_requests where id = dsp.refund_id;
    perform pg_temp.v3_as(adm); lc := ledger_check(o2.id);
    log := log || format('S22 %s sengketa %s: dibuka (my_disputes=%s, ledger dispute %s) → investigating (cs) → cs refund %s → finance resolved_refund: refund %s/%s Rp%s ke %s; pelanggan +%s, driver %s, merchant %s; ledger=%s refund_check=%s; baris dispute dibalik (Σ=%s)',
      case when jsonb_array_length(r) >= 1 and b0 = -20000 and v_err like 'ADMIN_FORBIDDEN%' and dsp.status = 'resolved_refund' and rf.status = 'done' and rf.amount = 20000
                and rf.destination = 'wallet' and rf.maker = fin and pg_temp.v3_saldo(cust) - c0 = 20000
                and (pg_temp.v3_saldo(drv) - d0) + (pg_temp.v3_saldo(mown) - m0) <= 0 and (lc->>'balanced')::boolean and (lc->'refund_check'->>'ok')::boolean
                and (select sum(amount) from order_ledger where source = 'disputes' and source_id = dsp.id) = 0 then 'OK' else 'BUG' end,
      o2.code, jsonb_array_length(r), b0, left(v_err, 25), rf.kind, rf.status, rf.amount, rf.destination, pg_temp.v3_saldo(cust) - c0, pg_temp.v3_saldo(drv) - d0,
      pg_temp.v3_saldo(mown) - m0, lc->>'verdict', lc->'refund_check'->>'ok', (select sum(amount) from order_ledger where source = 'disputes' and source_id = dsp.id)) || E'\n';
  exception when others then log := log || 'S22 BUG sengketa: ' || sqlerrm || E'\n'; end;

  -- ===== S23 Penyesuaian saldo ≥ ambang → dual approval =====
  begin
    c0 := pg_temp.v3_saldo(cust);
    perform pg_temp.v3_as(adm);
    b0 := admin_adjust_wallet(cust, 150000, 'uji v3 kompensasi besar');
    select * into ap from approval_requests where kind = 'wallet_adjust' and maker = adm order by created_at desc limit 1;
    ok := b0 = c0 and pg_temp.v3_saldo(cust) = c0 and ap.status = 'pending' and ap.amount = 150000;
    begin perform admin_approval_decide(ap.id, true, 'sendiri'); v_err := 'maker menyetujui sendiri'; exception when others then v_err := sqlerrm; end;
    perform pg_temp.v3_as(cs);
    begin perform admin_approval_decide(ap.id, true, 'cs'); alasan := 'cs menyetujui'; exception when others then alasan := sqlerrm; end;
    perform pg_temp.v3_as(fin);
    r := admin_approval_decide(ap.id, true, 'disetujui finance');
    c1 := pg_temp.v3_saldo(cust);
    perform pg_temp.v3_as(adm);
    r2 := admin_adjust_wallet_v3(cust, 50000, 'uji v3 kecil');
    log := log || format('S23 %s adjust Rp150.000 (≥ 100.000): saldo tetap, approval pending; maker → %s; cs → %s; finance setuju → saldo +%s; Rp50.000 → %s saldo +%s',
      case when ok and v_err like 'DUAL_APPROVAL%' and alasan like 'ADMIN_FORBIDDEN%' and r->>'status' = 'approved' and c1 - c0 = 150000
                and r2->>'status' = 'executed' and pg_temp.v3_saldo(cust) - c1 = 50000 then 'OK' else 'BUG' end,
      left(v_err, 30), left(alasan, 30), c1 - c0, r2->>'status', pg_temp.v3_saldo(cust) - c1) || E'\n';
  exception when others then log := log || 'S23 BUG dual approval saldo: ' || sqlerrm || E'\n'; end;

  -- ===== S25 Iklan: kampanye → review → aktif (dana ditahan dari saldo merchant) =====
  begin
    m0 := pg_temp.v3_saldo(mown);
    perform pg_temp.v3_as(mown);
    camp := merchant_campaign_create('boost_nearby', 'Sate Padang V3', 50000, 7, 5, '{"headline": "Sate Padang legendaris", "cta": "Pesan"}');
    select * into a from merchant_ads where id = camp;
    ok := a.status = 'pending_review' and pg_temp.v3_saldo(mown) - m0 = -50000 and (select sum(amount) from ad_budget_ledger where campaign_id = camp and kind = 'fund') = 50000;
    perform pg_temp.v3_as(cs);
    begin perform admin_campaign_review(camp, true, 'ok'); v_err := 'cs bisa review'; exception when others then v_err := sqlerrm; end;
    perform pg_temp.v3_as(ops);
    a := admin_campaign_review(camp, true, 'brand safety OK');
    log := log || format('S25 %s kampanye %s: pending_review, saldo merchant Δ%s, fund=%s; cs review → %s; ops setujui → %s (mulai %s)',
      case when ok and v_err like 'ADMIN_FORBIDDEN%' and a.status = 'active' and a.activated_at is not null and a.reviewed_by = ops then 'OK' else 'BUG' end,
      a.name, pg_temp.v3_saldo(mown) - m0, 50000, left(v_err, 25), a.status, a.starts_at is not null) || E'\n';
  exception when others then log := log || 'S25 BUG kampanye: ' || sqlerrm || E'\n'; end;

  -- ===== S26 ads_serve: dalam radius tampil (impresi dicatat), luar radius tidak =====
  begin
    perform pg_temp.v3_as(cust);
    r := ads_serve('boost_nearby', v_lat + 0.01, v_lng + 0.01, null, null, 3);
    r2 := ads_serve('boost_nearby', 0.5071, 101.4478, null, null, 3);   -- Pekanbaru (± 250 km)
    log := log || format('S26 %s ads_serve: dalam radius (±1,5 km) tampil=%s label=%s jarak=%s km; luar radius tampil=%s; impresi tercatat=%s (cpc → tidak ditagih, spent=%s)',
      case when exists (select 1 from jsonb_array_elements(r) x where (x->>'campaign_id')::uuid = camp and x->>'label' = 'Sponsored')
                and not exists (select 1 from jsonb_array_elements(r2) x where (x->>'campaign_id')::uuid = camp)
                and (select impressions from merchant_ads where id = camp) = 1 and (select spent from merchant_ads where id = camp) = 0 then 'OK' else 'BUG' end,
      exists (select 1 from jsonb_array_elements(r) x where (x->>'campaign_id')::uuid = camp), (select x->>'label' from jsonb_array_elements(r) x where (x->>'campaign_id')::uuid = camp),
      (select x->>'distance_km' from jsonb_array_elements(r) x where (x->>'campaign_id')::uuid = camp),
      exists (select 1 from jsonb_array_elements(r2) x where (x->>'campaign_id')::uuid = camp), (select impressions from merchant_ads where id = camp), (select spent from merchant_ads where id = camp)) || E'\n';
  exception when others then log := log || 'S26 BUG ads_serve: ' || sqlerrm || E'\n'; end;

  -- ===== S27 Frequency cap: maks 5 impresi per pengguna per kampanye per hari =====
  begin
    perform pg_temp.v3_as(cust);
    n := 0;
    for i in 1..6 loop
      r := ads_serve('boost_nearby', v_lat + 0.01, v_lng + 0.01, null, null, 3);
      if exists (select 1 from jsonb_array_elements(r) x where (x->>'campaign_id')::uuid = camp) then n := n + 1; end if;
    end loop;
    n2 := (select count(*) from ad_events where campaign_id = camp and user_id = cust and event = 'impression');
    log := log || format('S27 %s frequency cap %s/hari: 6 panggilan lagi → tampil %s kali (total impresi pelanggan %s)',
      case when n = 4 and n2 = 5 then 'OK' else 'BUG' end, setting_num('ads_frequency_cap_per_day', 5), n, n2) || E'\n';
  exception when others then log := log || 'S27 BUG frequency cap: ' || sqlerrm || E'\n'; end;

  -- ===== S28 Klik berulang dalam jendela dedupe tidak ditagih =====
  begin
    perform pg_temp.v3_as(cust);
    r := ads_click(camp, 'boost_nearby');
    r2 := ads_click(camp, 'boost_nearby');
    log := log || format('S28 %s klik: pertama charged=%s biaya=%s; kedua (≤ %s menit) charged=%s alasan=%s; spent=%s; klik dedupe tercatat=%s',
      case when (r->>'charged')::boolean and (r->>'cost')::bigint = 500 and not (r2->>'charged')::boolean and r2->>'reason' = 'dedupe'
                and (select spent from merchant_ads where id = camp) = 500
                and (select count(*) from ad_events where campaign_id = camp and event = 'click' and dedupe_key like 'dup:%') = 1 then 'OK' else 'BUG' end,
      r->>'charged', r->>'cost', setting_num('ads_click_dedupe_minutes', 30), r2->>'charged', r2->>'reason', (select spent from merchant_ads where id = camp),
      (select count(*) from ad_events where campaign_id = camp and event = 'click' and dedupe_key like 'dup:%')) || E'\n';
  exception when others then log := log || 'S28 BUG klik: ' || sqlerrm || E'\n'; end;

  -- ===== S32 Label Sponsored + campaign_id di nearby_merchants_v2 =====
  begin
    perform pg_temp.v3_as(null);
    select to_jsonb(x) into r from nearby_merchants_v2(v_lat + 0.005, v_lng + 0.005, 15, null, null) x where x.id = merch;
    select to_jsonb(x) into r2 from nearby_merchants_v2(v_lat + 0.005, v_lng + 0.005, 15, null, null) x where x.id <> merch and x.campaign_id is null limit 1;
    log := log || format('S32 %s nearby_merchants_v2: merchant beriklan ad_label=%s campaign_id cocok=%s boosted=%s; merchant organik ad_label=%s',
      case when r->>'ad_label' = 'Sponsored' and (r->>'campaign_id')::uuid = camp and (r->>'boosted')::boolean and (r2 is null or r2->>'ad_label' is null) then 'OK' else 'BUG' end,
      r->>'ad_label', (r->>'campaign_id')::uuid = camp, r->>'boosted', coalesce(r2->>'ad_label', 'null')) || E'\n';
  exception when others then log := log || 'S32 BUG label: ' || sqlerrm || E'\n'; end;

  -- ===== S31 Konversi (create_order p_ad_campaign_id) + laporan ROAS = ad_budget_ledger =====
  begin
    perform pg_temp.v3_as(cust);
    o := create_order(jsonb_build_object('service','food','merchant_id', merch,
           'items', jsonb_build_array(jsonb_build_object('menu_item_id', (select id from menu_items where merchant_id = merch and is_available limit 1), 'qty', 1)),
           'dropoff', jsonb_build_object('lat',-0.945,'lng',100.36,'address','V3 Kos'), 'paid_via', 'wallet', 'client_request_id', 'v3-ads-' || md5(random()::text)), camp);
    select * into a from merchant_ads where id = camp;
    perform pg_temp.v3_as(mown);
    r := merchant_campaign_report(camp, (now() at time zone 'Asia/Jakarta')::date, (now() at time zone 'Asia/Jakarta')::date);
    perform pg_temp.v3_as(fin);
    r2 := admin_ads_report((now() at time zone 'Asia/Jakarta')::date, (now() at time zone 'Asia/Jakarta')::date);
    log := log || format('S31 %s konversi %s: orders.ad_campaign_id=%s conversions=%s nilai=%s (=barang %s); laporan spent=%s (= −Σ charge ad_budget_ledger %s = campaign.spent %s) ROAS=%s (= %s/%s); admin: pendapatan iklan=%s fraud dedupe=%s',
      case when o.ad_campaign_id = camp and a.conversions = 1 and a.conversion_value = o.items_subtotal and (r->'totals'->>'spent')::bigint = a.spent and a.spent = 500
                and (r->>'roas')::numeric = round(a.conversion_value::numeric / a.spent, 2) and (r->'days'->0->>'conversions')::int = 1
                and (r2->>'revenue_total')::bigint >= 500 and (r2->'events'->>'fraud_dedupe_clicks')::int >= 1 then 'OK' else 'BUG' end,
      o.code, o.ad_campaign_id = camp, a.conversions, a.conversion_value, o.items_subtotal, r->'totals'->>'spent',
      (select -sum(amount) from ad_budget_ledger where campaign_id = camp and kind = 'charge'), a.spent, r->>'roas', a.conversion_value, a.spent,
      r2->>'revenue_total', r2->'events'->>'fraud_dedupe_clicks') || E'\n';
    perform pg_temp.v3_as(cust); perform cancel_order(o.id, 'uji S31 bersih');
  exception when others then log := log || 'S31 BUG konversi/ROAS: ' || sqlerrm || E'\n'; end;

  -- ===== S30 Stop kampanye → sisa anggaran kembali ke saldo merchant =====
  begin
    m0 := pg_temp.v3_saldo(mown);
    perform pg_temp.v3_as(mown);
    a := merchant_campaign_set(camp, 'stop');
    log := log || format('S30 %s stop: status=%s, sisa Rp%s kembali ke saldo merchant (Δ%s); ad_budget_ledger fund=%s charge=%s refund=%s; ledger iklan seimbang=%s',
      case when a.status = 'ended' and pg_temp.v3_saldo(mown) - m0 = 49500 and ads_remaining(camp) = 0
                and (select sum(amount) from ad_budget_ledger where campaign_id = camp and kind = 'refund') = 49500
                and (ledger_check_source('merchant_ads', camp)->>'balanced')::boolean then 'OK' else 'BUG' end,
      a.status, 49500, pg_temp.v3_saldo(mown) - m0, (select sum(amount) from ad_budget_ledger where campaign_id = camp and kind = 'fund'),
      (select sum(amount) from ad_budget_ledger where campaign_id = camp and kind = 'charge'), (select sum(amount) from ad_budget_ledger where campaign_id = camp and kind = 'refund'),
      ledger_check_source('merchant_ads', camp)->>'balanced') || E'\n';
  exception when others then log := log || 'S30 BUG stop: ' || sqlerrm || E'\n'; end;

  -- ===== S29 Anggaran habis → budget_exhausted =====
  begin
    perform pg_temp.v3_as(ops);
    perform admin_set_ad_product('post_checkout_cross', '{"unit_price": 25000}');
    perform pg_temp.v3_as(mown);
    camp2 := merchant_campaign_create('post_checkout_cross', 'Cross V3', 50000, 3, 5, '{"headline": "Coba juga sate kami"}');
    perform pg_temp.v3_as(ops); a := admin_campaign_review(camp2, true, 'ok');
    perform pg_temp.v3_as(cust); r := ads_click(camp2, 'post_checkout_cross');
    perform pg_temp.v3_as(drv); r2 := ads_click(camp2, 'post_checkout_cross');
    select * into a from merchant_ads where id = camp2;
    perform pg_temp.v3_as(drv2); lc := ads_click(camp2, 'post_checkout_cross');
    log := log || format('S29 %s anggaran Rp50.000 cpc Rp25.000: klik1 %s, klik2 %s → status=%s spent=%s sisa=%s; klik3 charged=%s (%s)',
      case when (r->>'charged')::boolean and (r2->>'charged')::boolean and a.status = 'budget_exhausted' and a.spent = 50000 and ads_remaining(camp2) = 0
                and not (lc->>'charged')::boolean then 'OK' else 'BUG' end,
      r->>'cost', r2->>'cost', a.status, a.spent, ads_remaining(camp2), lc->>'charged', lc->>'reason') || E'\n';
  exception when others then log := log || 'S29 BUG anggaran habis: ' || sqlerrm || E'\n'; end;

  -- ===== S33 Rate limit create_order (rate_take) =====
  begin
    update app_settings set value = '1'::jsonb where key = 'rate_limit_create_order_per_hour';
    begin o := pg_temp.v3_order('ride_motor', 'cash'); v_err := 'pesanan dibuat'; exception when others then v_err := sqlerrm; end;
    update app_settings set value = '100000'::jsonb where key = 'rate_limit_create_order_per_hour';
    log := log || format('S33 %s batas laju create_order (1/jam, pelanggan sudah membuat banyak pesanan): %s', case when v_err like 'RATE_LIMIT%' then 'OK' else 'BUG' end, left(v_err, 60)) || E'\n';
  exception when others then log := log || 'S33 BUG rate limit: ' || sqlerrm || E'\n'; end;

  -- ===== S34 admin_contribution_margin =====
  begin
    perform pg_temp.v3_as(fin);
    r := admin_contribution_margin((now() at time zone 'Asia/Jakarta')::date - 1, (now() at time zone 'Asia/Jakarta')::date, 'service');
    log := log || format('S34 %s contribution margin per layanan: %s baris, variable_cost_per_order=%s [ASUMSI], total orders=%s CM=%s take rate=%s%%',
      case when jsonb_array_length(r->'rows') >= 1 and (r->>'variable_cost_per_order')::numeric = 300 and (r->'totals')::jsonb ? 'contribution_margin'
                and (r->'totals'->>'variable_cost')::bigint = (r->'totals'->>'orders')::bigint * 300 then 'OK' else 'BUG' end,
      jsonb_array_length(r->'rows'), r->>'variable_cost_per_order', r->'totals'->>'orders', r->'totals'->>'contribution_margin', r->'totals'->>'take_rate_net_pct') || E'\n';
  exception when others then log := log || 'S34 BUG contribution margin: ' || sqlerrm || E'\n'; end;

  -- ===== S35 Struk pelanggan (§0.4) =====
  begin
    perform pg_temp.v3_as(cust);
    r := my_receipt(o4.id);
    r2 := my_payment_history(10);
    log := log || format('S35 %s my_receipt %s: baris=%s, biaya metode pembayaran="%s" (%s), pajak ada=%s, total=%s, support_ref=%s, refundable_note ada=%s; riwayat pembayaran memuat support_ref=%s',
      case when (select array_agg(x->>'key' order by x->>'key') from jsonb_array_elements(r->'lines') x) @> array['delivery','items','payment_fee','platform_fee','tax']
                and (select x->>'label' from jsonb_array_elements(r->'lines') x where x->>'key' = 'payment_fee') like '%Finpay%'
                and r->>'support_ref' = pay4.support_ref and length(r->>'refundable_note') > 20 and (r->>'total')::bigint = o4.total
                and exists (select 1 from jsonb_array_elements(r2) x where x->>'support_ref' = pay4.support_ref) then 'OK' else 'BUG' end,
      o4.code, jsonb_array_length(r->'lines'), (select x->>'label' from jsonb_array_elements(r->'lines') x where x->>'key' = 'payment_fee'),
      (select x->>'note' from jsonb_array_elements(r->'lines') x where x->>'key' = 'payment_fee'),
      exists (select 1 from jsonb_array_elements(r->'lines') x where x->>'key' = 'tax'), r->>'total', r->>'support_ref', length(r->>'refundable_note') > 20,
      exists (select 1 from jsonb_array_elements(r2) x where x->>'support_ref' = pay4.support_ref)) || E'\n';
  exception when others then log := log || 'S35 BUG struk: ' || sqlerrm || E'\n'; end;

  -- ===== S36 Perubahan tarif oleh finance (maker) → approval fee_change → superadmin (checker) =====
  begin
    perform pg_temp.v3_as(fin);
    pcf := admin_set_payment_channel_fee('finpay', 'dana', '2026-01-01', '{"fee_pct": 1.8}');
    select * into ap from approval_requests where kind = 'fee_change' and maker = fin order by created_at desc limit 1;
    ok := pcf.fee_pct = 2.0 and ap.status = 'pending';
    begin perform admin_approval_decide(ap.id, true, 'sendiri'); v_err := 'maker setuju sendiri'; exception when others then v_err := sqlerrm; end;
    perform pg_temp.v3_as(adm);
    r := admin_approval_decide(ap.id, true, 'tarif sesuai kontrak');
    log := log || format('S36 %s tarif Finpay DANA oleh finance: langsung berubah=%s, approval %s; maker setuju → %s; superadmin setuju → fee_pct=%s',
      case when ok and v_err like 'DUAL_APPROVAL%' and r->>'status' = 'approved'
                and (select fee_pct from payment_channel_fees where provider = 'finpay' and channel = 'dana' and effective_from = '2026-01-01') = 1.8 then 'OK' else 'BUG' end,
      pcf.fee_pct <> 2.0, ap.status, left(v_err, 30), (select fee_pct from payment_channel_fees where provider = 'finpay' and channel = 'dana' and effective_from = '2026-01-01')) || E'\n';
  exception when others then log := log || 'S36 BUG maker-checker tarif: ' || sqlerrm || E'\n'; end;

  -- ===== S37 Kunci gateway per (provider, env): tersamar, tidak ke log =====
  begin
    perform pg_temp.v3_as(adm);
    r := admin_set_gateway_secret('finpay', 'sandbox', '{"merchant_id": "AK-V3", "server_key": "FINPAY-MERCHANT-KEY-SECRET-987654", "callback_token": "cb-token-rahasia-abc123"}');
    r2 := admin_gateway_secrets();
    perform pg_temp.v3_as(fin);
    begin perform admin_gateway_secrets(); v_err := 'finance bisa lihat kunci'; exception when others then v_err := sqlerrm; end;
    log := log || format('S37 %s gateway_secrets finpay/sandbox: server_key=%s configured=%s; log tanpa nilai utuh=%s; finance → %s',
      case when r->>'server_key' = 'FINPAY••••7654' and exists (select 1 from jsonb_array_elements(r2->'items') x where x->>'provider' = 'finpay' and x->>'env' = 'sandbox' and (x->>'configured')::boolean)
                and not exists (select 1 from audit_logs where created_at >= transaction_timestamp() and (detail::text like '%SECRET-987654%' or detail::text like '%rahasia-abc123%'))
                and v_err like 'ADMIN_FORBIDDEN%' then 'OK' else 'BUG' end,
      r->>'server_key', r->>'configured',
      not exists (select 1 from audit_logs where created_at >= transaction_timestamp() and (detail::text like '%SECRET-987654%' or detail::text like '%rahasia-abc123%')), left(v_err, 30)) || E'\n';
  exception when others then log := log || 'S37 BUG kunci gateway: ' || sqlerrm || E'\n'; end;

  -- ===== S24 Invarian: semua pesanan simulasi ini seimbang (ledger_check), sumber iklan seimbang, dompet = Σ mutasi =====
  begin
    perform pg_temp.v3_as(adm);
    select count(*), count(*) filter (where coalesce((ledger_check(id)->>'balanced')::boolean, true)) into n, n2
      from orders where created_at >= transaction_timestamp() and exists (select 1 from order_ledger l where l.order_id = orders.id and l.source = 'orders');
    select count(*) into b0 from merchant_ads a2 where a2.created_at >= transaction_timestamp() and not coalesce((ledger_check_source('merchant_ads', a2.id)->>'balanced')::boolean, false);
    select count(*) into b1 from wallets wl left join (select user_id, sum(amount) jml from wallet_transactions group by user_id) t on t.user_id = wl.user_id where wl.balance <> coalesce(t.jml, 0);
    log := log || format('S24 %s invarian: %s pesanan simulasi berbuku besar, %s seimbang; kampanye tidak seimbang=%s; dompet ≠ Σ mutasi=%s; baris order_ledger pembalik=%s (append-only)',
      case when n > 0 and n = n2 and b0 = 0 and b1 = 0 then 'OK' else 'BUG' end, n, n2, b0, b1,
      (select count(*) from order_ledger where reversal_of is not null and created_at >= transaction_timestamp())) || E'\n';
  exception when others then log := log || 'S24 BUG invarian: ' || sqlerrm || E'\n'; end;

  raise exception using message = 'SIMULASI_SELESAI' || log;
end $sim$;
