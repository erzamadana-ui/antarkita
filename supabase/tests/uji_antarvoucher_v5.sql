-- Uji AntarVoucher v5 (migrasi 0114, KONTRAK-V5 §6 V5-01…V5-15): mode voucher_only, kode voucher (terbit → auto-redeem →
-- tukar ulang ditolak), cap saldo, batas float BI, kedaluwarsa kode, deposit mitra, PPN inklusif di ledger, pencairan
-- (SLA, batch, settle ok/failed), pemantau SLA, target kota, blokir top up gateway, mode reversibel, PPh memo.
-- Satu transaksi, di-ROLLBACK (RAISE 'SIMULASI_SELESAI'). Lokal: scripts/db-lokal.sh test supabase/tests/uji_antarvoucher_v5.sql
-- Mengandaikan akun uji seed.sql (a0..01 superadmin PIN 123456, a0..02 pelanggan saldo 200.000, a0..03 driver motor saldo 100.000).
-- Kode baris: S<nomor> OK|BUG (penghitung db-lokal.sh); S<nomor> = V5-<nomor>.

create or replace function pg_temp.v5_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', case when p_uid is null then '' else json_build_object('sub', p_uid, 'role', 'authenticated')::text end, true);
$$;
create or replace function pg_temp.v5_saldo(p_user uuid) returns bigint language sql as $$
  select coalesce((select balance from wallets where user_id = p_user), 0);
$$;
create or replace function pg_temp.v5_admin(p_role text) returns uuid language plpgsql as $$
declare u uuid := gen_random_uuid(); mail text := 'uji.v5.' || p_role || '.' || left(u::text, 8) || '@antaraja.id';
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values ('00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated', mail, extensions.crypt('rahasia123', extensions.gen_salt('bf')), now(), now(), now(),
          '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('full_name', 'Admin v5 ' || p_role, 'phone', '+6282' || (floor(random() * 1e9))::bigint, 'email', mail));
  perform pg_temp.v5_as(null);
  perform set_config('antaraja.bypass', 'on', true);
  update profiles set role = 'admin' where id = u;
  perform set_config('antaraja.bypass', 'off', true);
  update profiles set admin_role = p_role where id = u;
  insert into admin_security (user_id, pin_hash) values (u, extensions.crypt('123456', extensions.gen_salt('bf')));
  perform pg_temp.v5_as(u);
  perform admin_unlock('123456');
  return u;
end $$;
create or replace function pg_temp.v5_customer() returns uuid language plpgsql as $$
declare u uuid := gen_random_uuid(); mail text := 'uji.v5.cust.' || left(u::text, 8) || '@antaraja.id';
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values ('00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated', mail, extensions.crypt('rahasia123', extensions.gen_salt('bf')), now(), now(), now(),
          '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('full_name', 'Pelanggan v5', 'phone', '+6283' || (floor(random() * 1e9))::bigint, 'email', mail));
  return u;
end $$;
-- beli + cocokkan mutasi (finA) + setujui (finB) dalam satu langkah; mengembalikan jsonb {purchase, code, approve}
create or replace function pg_temp.v5_beli_setujui(p_user uuid, p_nominal bigint, p_idem text, p_finA uuid, p_finB uuid, p_bri uuid, p_mut text)
returns jsonb language plpgsql as $$
declare r jsonb; a jsonb; m jsonb;
begin
  perform pg_temp.v5_as(p_user);
  r := voucher_code_purchase_create(p_nominal, 'bri', p_idem);
  perform pg_temp.v5_as(p_finA);
  m := admin_voucher_mutation_add(p_bri, p_mut, (r->'purchase'->>'transfer_amount')::bigint, now(), 'PENGIRIM', null);
  perform pg_temp.v5_as(p_finB);
  a := admin_voucher_approve((r->'purchase'->>'id')::uuid, 'uji v5');
  return r || jsonb_build_object('approve', a, 'mutation', m);
end $$;

do $sim$
declare
  log text := '';
  adm uuid := 'a0000000-0000-4000-8000-000000000001'; cust0 uuid := 'a0000000-0000-4000-8000-000000000002'; drv uuid := 'a0000000-0000-4000-8000-000000000003';
  cust uuid; cust2 uuid; finA uuid; finB uuid; legal uuid; bri uuid; city uuid; v_month date := date_trunc('month', now())::date;
  r jsonb; r2 jsonb; r3 jsonb; p1 jsonb; p2 jsonb; p3 jsonb; c1 jsonb; ok boolean; msg text; msg2 text; msg3 text; n int; n2 int; b0 bigint; b1 bigint; d0 bigint; d1 bigint;
  o orders; v_pin text; wt wallet_transactions; vc voucher_codes; w1 withdrawal_requests; w2 withdrawal_requests; w3 withdrawal_requests; pb payout_batches; t_r numeric; t_tax bigint; t_fixed bigint; tp topup_requests;
begin
  -- ===== S0 persiapan: mode voucher_only, deposit mitra (min 20.000), admin finance×2 + legal, rekening BRI terverifikasi, pembelian dibuka =====
  begin
    perform pg_temp.v5_as(adm);
    perform admin_unlock('123456');
    -- sisa uji manual di DB lokal (ikut di-ROLLBACK): order aktif & fraud flag driver uji
    perform set_config('antaraja.bypass', 'on', true);
    update orders set status = 'cancelled' where (driver_id = drv or customer_id = cust0) and status in ('scheduled','searching','accepted','arrived','in_progress');
    update drivers set is_online = false where id = drv;
    delete from fraud_flags where subject_id = drv and status = 'open';
    perform set_config('antaraja.bypass', 'off', true);
    perform admin_set_antarpay_enabled(true);
    r := admin_set_payment_mode('voucher_only');
    perform admin_set_settings('{"driver_deposit_required": true, "driver_min_balance_accept": 20000, "voucher_auto_redeem": true, "voucher_balance_cap_customer": 2000000, "voucher_balance_cap_partner": 5000000, "voucher_float_limit": 1000000000, "voucher_float_alert_pct": 65}'::jsonb);
    update app_settings set value = '0'::jsonb where key = 'driver_debt_limit';
    finA := pg_temp.v5_admin('finance'); finB := pg_temp.v5_admin('finance'); legal := pg_temp.v5_admin('superadmin');
    cust := pg_temp.v5_customer(); cust2 := pg_temp.v5_customer();
    select id into bri from company_bank_accounts where bank_code = 'bri';
    perform pg_temp.v5_as(adm);
    perform admin_voucher_bank_upsert(jsonb_build_object('id', bri, 'account_no', '0000111122223333', 'account_name', 'PT Antar Kita Indonesia', 'active', true));
    perform pg_temp.v5_as(finA); perform admin_voucher_bank_verify(bri, 'finance');
    perform pg_temp.v5_as(legal); perform admin_voucher_bank_verify(bri, 'legal');
    perform pg_temp.v5_as(adm); perform admin_set_antarvoucher_purchase_enabled(true);
    r2 := voucher_public_config();
    ok := payment_mode() = 'voucher_only' and (r2->>'purchase_enabled')::boolean and jsonb_array_length(r2->'banks') = 1 and jsonb_typeof(r2->'denominations') = 'array'
          and (r2->>'cap_customer')::bigint = 2000000 and (r2->'tax'->>'ppn_pct')::numeric = 11 and (driver_deposit_status()->>'required')::boolean;
    log := log || format('S0 %s persiapan: payment_mode=%s purchase_enabled=%s bank=%s denominasi=%s cap=%s/%s ppn=%s%%',
      case when ok then 'OK' else 'BUG' end, payment_mode(), r2->>'purchase_enabled', jsonb_array_length(r2->'banks'), r2->'denominations', r2->>'cap_customer', r2->>'cap_partner', r2->'tax'->>'ppn_pct') || E'\n';
  exception when others then log := log || 'S0 BUG persiapan: ' || sqlerrm || E'\n'; end;

  -- ===== V5-01 mode voucher_only menolak gateway (gopay), menerima cash & wallet =====
  begin
    perform pg_temp.v5_as(cust0);
    msg := ''; begin o := create_order(jsonb_build_object('service', 'ride_motor', 'vehicle_class', 'motor_economy', 'pickup', jsonb_build_object('lat', 0.4810, 'lng', 101.4349, 'address', 'V5-01'), 'dropoff', jsonb_build_object('lat', 0.50, 'lng', 101.44, 'address', 'Plaza Andalas'), 'paid_via', 'gopay')); perform cancel_order(o.id, 'uji'); exception when others then msg := sqlerrm; end;
    msg2 := ''; begin o := create_order(jsonb_build_object('service', 'ride_motor', 'vehicle_class', 'motor_economy', 'pickup', jsonb_build_object('lat', 0.4810, 'lng', 101.4349, 'address', 'V5-01'), 'dropoff', jsonb_build_object('lat', 0.50, 'lng', 101.44, 'address', 'Plaza Andalas'), 'paid_via', 'cash')); perform cancel_order(o.id, 'uji'); exception when others then msg2 := sqlerrm; end;
    msg3 := ''; begin o := create_order(jsonb_build_object('service', 'ride_motor', 'vehicle_class', 'motor_economy', 'pickup', jsonb_build_object('lat', 0.4810, 'lng', 101.4349, 'address', 'V5-01'), 'dropoff', jsonb_build_object('lat', 0.50, 'lng', 101.44, 'address', 'Plaza Andalas'), 'paid_via', 'wallet')); perform cancel_order(o.id, 'uji'); exception when others then msg3 := sqlerrm; end;
    r := payment_channels_public();
    ok := msg like 'PAYMENT_MODE_VOUCHER_ONLY%' and msg2 = '' and msg3 = '' and not (r->>'gopay')::boolean and not (r->>'qris')::boolean and (r->>'cash')::boolean and (r->>'antarpay')::boolean;
    log := log || format('S1 %s voucher_only: gopay → %s; cash → %s; wallet → %s; saluran publik gopay=%s cash=%s antarpay=%s',
      case when ok then 'OK' else 'BUG' end, left(msg, 40), coalesce(nullif(msg2, ''), 'diterima'), coalesce(nullif(msg3, ''), 'diterima'), r->>'gopay', r->>'cash', r->>'antarpay') || E'\n';
  exception when others then log := log || 'S1 BUG mode: ' || sqlerrm || E'\n'; end;

  -- ===== V5-02 beli voucher → kode pending_payment, pembelian awaiting_transfer, idempoten =====
  begin
    perform pg_temp.v5_as(cust);
    p1 := voucher_code_purchase_create(100000, 'bri', 'v5-idem-1');
    r := voucher_code_purchase_create(100000, 'bri', 'v5-idem-1');
    select count(*) into n from my_voucher_codes();
    ok := p1->'code'->>'status' = 'pending_payment' and p1->'purchase'->>'status' = 'awaiting_transfer' and p1->'code'->>'code' ~ '^AKV-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$'
          and (p1->'code'->>'nominal')::bigint = 100000 and r->'code'->>'id' = p1->'code'->>'id' and (r->'purchase'->>'idempotent')::boolean and n = 1
          and p1->'purchase'->>'buyer_role' = 'customer' and pg_temp.v5_saldo(cust) = 0;
    log := log || format('S2 %s beli: kode %s status=%s, pembelian %s %s (transfer Rp%s), ulang kunci sama → kode sama=%s, kode saya=%s, saldo tetap %s',
      case when ok then 'OK' else 'BUG' end, p1->'code'->>'code', p1->'code'->>'status', p1->'purchase'->>'reference', p1->'purchase'->>'status', p1->'purchase'->>'transfer_amount',
      r->'code'->>'id' = p1->'code'->>'id', n, pg_temp.v5_saldo(cust)) || E'\n';
  exception when others then log := log || 'S2 BUG beli: ' || sqlerrm || E'\n'; end;

  -- ===== V5-03 setujui (checker ≠ maker) → kode issued + auto-redeem → saldo naik, kind voucher_redeem, kode redeemed =====
  begin
    perform pg_temp.v5_as(finA);
    r := admin_voucher_mutation_add(bri, 'V5-MUT-0001', (p1->'purchase'->>'transfer_amount')::bigint, now(), 'PELANGGAN V5', null);
    msg := ''; begin r2 := admin_voucher_approve((p1->'purchase'->>'id')::uuid, null); exception when others then msg := sqlerrm; end;
    perform pg_temp.v5_as(finB);
    r2 := admin_voucher_approve((p1->'purchase'->>'id')::uuid, 'cocok');
    select * into vc from voucher_codes where id = (p1->'code'->>'id')::uuid;
    select * into wt from wallet_transactions where idempotency_key = 'voucher:' || (p1->'purchase'->>'id');
    select count(*) into n from wallet_transactions where user_id = cust and type::text = 'voucher_redeem';
    ok := msg like 'MAKER_CHECKER%' and r2->>'status' = 'issued' and vc.status = 'redeemed' and vc.redeemed_by = cust and vc.issued_at is not null and vc.expires_at > now()
          and vc.nominal = (p1->'purchase'->>'transfer_amount')::bigint and pg_temp.v5_saldo(cust) = vc.nominal and n = 1
          and wt.type::text = 'voucher_redeem' and wt.source = 'voucher_purchase' and wt.approved_by = finB and wt.bank_ref = 'V5-MUT-0001' and wt.balance_before = 0
          and (select wallet_tx_id from voucher_purchases where id = (p1->'purchase'->>'id')::uuid) = wt.id;
    log := log || format('S3 %s setujui: pencocok sendiri → %s; finance lain → %s; kode %s → %s oleh pembeli; saldo 0→%s; ledger kind=%s source=%s bank_ref=%s approver=finB',
      case when ok then 'OK' else 'BUG' end, left(msg, 20), r2->>'status', vc.code, vc.status, pg_temp.v5_saldo(cust), wt.type, wt.source, wt.bank_ref) || E'\n';
  exception when others then log := log || 'S3 BUG setujui: ' || sqlerrm || E'\n'; end;

  -- ===== V5-04 tukar ulang kode → ditolak (pemilik & orang lain); kode asal-asalan → tidak ditemukan =====
  begin
    perform pg_temp.v5_as(cust);
    msg := ''; begin wt := voucher_code_redeem(p1->'code'->>'code'); exception when others then msg := sqlerrm; end;
    perform pg_temp.v5_as(cust2);
    msg2 := ''; begin wt := voucher_code_redeem(lower(replace(p1->'code'->>'code', '-', ''))); exception when others then msg2 := sqlerrm; end;
    msg3 := ''; begin wt := voucher_code_redeem('AKV-ZZZZ-ZZZZ-ZZZ2'); exception when others then msg3 := sqlerrm; end;
    log := log || format('S4 %s tukar ulang: pemilik → %s; orang lain (tanpa strip, huruf kecil) → %s; kode ngawur → %s; saldo tetap %s/%s',
      case when msg like 'VOUCHER_CODE_USED%' and msg2 like 'VOUCHER_CODE_USED%' and msg3 like 'VOUCHER_CODE_INVALID%' and pg_temp.v5_saldo(cust2) = 0 then 'OK' else 'BUG' end,
      left(msg, 25), left(msg2, 25), left(msg3, 25), pg_temp.v5_saldo(cust), pg_temp.v5_saldo(cust2)) || E'\n';
  exception when others then log := log || 'S4 BUG tukar ulang: ' || sqlerrm || E'\n'; end;

  -- ===== V5-05 cap saldo pelanggan → pembelian berikutnya ditolak; cap normal → diterima =====
  begin
    perform pg_temp.v5_as(adm); perform admin_set_settings('{"voucher_balance_cap_customer": 150000}'::jsonb);
    perform pg_temp.v5_as(cust);
    msg := ''; begin r := voucher_code_purchase_create(100000, 'bri', 'v5-idem-cap'); exception when others then msg := sqlerrm; end;
    perform pg_temp.v5_as(adm); perform admin_set_settings('{"voucher_balance_cap_customer": 2000000}'::jsonb);
    perform pg_temp.v5_as(cust);
    p2 := voucher_code_purchase_create(100000, 'bri', 'v5-idem-2');
    log := log || format('S5 %s cap pelanggan 150.000 (saldo %s): beli 100.000 → %s; cap 2 jt → %s %s',
      case when msg like 'VOUCHER_BALANCE_CAP%' and p2->'code'->>'status' = 'pending_payment' then 'OK' else 'BUG' end, pg_temp.v5_saldo(cust), left(msg, 30), p2->'purchase'->>'reference', p2->'code'->>'status') || E'\n';
  exception when others then log := log || 'S5 BUG cap: ' || sqlerrm || E'\n'; end;

  -- ===== V5-06 batas float BI → pembelian ditolak + voucher_float_status.alert =====
  begin
    update app_settings set value = '100000'::jsonb where key = 'voucher_float_limit';
    perform pg_temp.v5_as(cust2);
    msg := ''; begin r := voucher_code_purchase_create(50000, 'bri', 'v5-idem-float'); exception when others then msg := sqlerrm; end;
    perform pg_temp.v5_as(finA);
    r2 := voucher_float_status(null);
    update app_settings set value = '1000000000'::jsonb where key = 'voucher_float_limit';
    r3 := voucher_float_status(null);
    perform pg_temp.v5_as(cust2);
    msg2 := ''; begin perform voucher_float_status(null); exception when others then msg2 := sqlerrm; end;
    ok := msg like 'VOUCHER_FLOAT_LIMIT%' and (r2->>'alert')::boolean and (r2->>'pct')::numeric >= 65 and not (r3->>'alert')::boolean
          and (r3->>'total_outstanding')::bigint = (select sum(balance) from wallets where balance > 0) and (r3->>'customers')::bigint + (r3->>'partners')::bigint = (r3->>'total_outstanding')::bigint
          and (r3->>'limit')::bigint = 1000000000 and msg2 like 'Tidak berhak%';
    log := log || format('S6 %s float: batas 100.000 → %s; status alert=%s pct=%s; batas 1 M → alert=%s beredar=%s (pelanggan %s + mitra %s); pelanggan lihat → %s',
      case when ok then 'OK' else 'BUG' end, left(msg, 25), r2->>'alert', r2->>'pct', r3->>'alert', r3->>'total_outstanding', r3->>'customers', r3->>'partners', left(msg2, 15)) || E'\n';
  exception when others then log := log || 'S6 BUG float: ' || sqlerrm || E'\n'; end;

  -- ===== V5-07 auto_redeem mati: kode terbit, lewat TTL → expired (saldo tetap); kode hadiah ditukar orang lain =====
  begin
    update app_settings set value = 'false'::jsonb where key = 'voucher_auto_redeem';
    perform pg_temp.v5_as(finA);
    r := admin_voucher_mutation_add(bri, 'V5-MUT-0002', (p2->'purchase'->>'transfer_amount')::bigint, now(), 'PELANGGAN V5', null);
    b0 := pg_temp.v5_saldo(cust);
    perform pg_temp.v5_as(finB);
    r2 := admin_voucher_approve((p2->'purchase'->>'id')::uuid, null);
    select * into vc from voucher_codes where id = (p2->'code'->>'id')::uuid;
    ok := r2->>'status' = 'issued' and vc.status = 'issued' and pg_temp.v5_saldo(cust) = b0 and vc.expires_at between now() + interval '719 hours' and now() + interval '721 hours';
    update voucher_codes set expires_at = now() - interval '1 minute' where id = vc.id;
    n := voucher_expire_due();
    select * into vc from voucher_codes where id = vc.id;
    perform pg_temp.v5_as(cust);
    msg := ''; begin wt := voucher_code_redeem(vc.code); exception when others then msg := sqlerrm; end;
    ok := ok and n >= 1 and vc.status = 'expired' and msg like 'VOUCHER_CODE_EXPIRED%' and pg_temp.v5_saldo(cust) = b0;
    -- kode hadiah: cust2 beli (auto_redeem mati) → kode issued → ditukar oleh cust
    p3 := pg_temp.v5_beli_setujui(cust2, 50000, 'v5-idem-3', finA, finB, bri, 'V5-MUT-0003');
    perform pg_temp.v5_as(cust);
    wt := voucher_code_redeem(p3->'code'->>'code');
    select * into vc from voucher_codes where id = (p3->'code'->>'id')::uuid;
    ok := ok and p3->'approve'->>'status' = 'issued' and pg_temp.v5_saldo(cust2) = 0 and vc.status = 'redeemed' and vc.redeemed_by = cust and vc.buyer_id = cust2
          and pg_temp.v5_saldo(cust) = b0 + vc.nominal and wt.type::text = 'voucher_redeem' and wt.amount = vc.nominal;
    update app_settings set value = 'true'::jsonb where key = 'voucher_auto_redeem';
    log := log || format('S7 %s TTL: terbit tanpa redeem (saldo tetap %s), kedaluwarsa job=%s status=%s, tukar → %s; kode hadiah milik pelanggan2 ditukar pelanggan1: %s +%s → saldo %s',
      case when ok then 'OK' else 'BUG' end, b0, n, (select status from voucher_codes where id = (p2->'code'->>'id')::uuid), left(msg, 25), vc.status, vc.nominal, pg_temp.v5_saldo(cust)) || E'\n';
  exception when others then update app_settings set value = 'true'::jsonb where key = 'voucher_auto_redeem'; log := log || 'S7 BUG TTL: ' || sqlerrm || E'\n'; end;

  -- ===== V5-08 driver saldo 0 & deposit_required (min 20.000) → online/accept ditolak DEPOSIT_REQUIRED; setelah beli voucher → diterima =====
  begin
    perform pg_temp.v5_as(adm);
    perform wallet_apply(drv, 'adjustment', -pg_temp.v5_saldo(drv), null, 'uji v5: kosongkan saldo driver');
    perform pg_temp.v5_as(drv);
    perform driver_selfie_check('https://x/selfie.jpg');
    r := driver_deposit_status();
    msg := ''; begin perform driver_set_online(true, 0.4810, 101.4349); exception when others then msg := sqlerrm; end;
    p3 := pg_temp.v5_beli_setujui(drv, 100000, 'v5-drv-1', finA, finB, bri, 'V5-MUT-0004');
    perform pg_temp.v5_as(drv);
    r2 := driver_deposit_status();
    perform driver_set_online(true, 0.4810, 101.4349);
    ok := pg_temp.v5_saldo(drv) = (p3->'purchase'->>'transfer_amount')::bigint and msg like 'DEPOSIT_REQUIRED%' and not (r->>'can_accept')::boolean and (r->>'shortfall')::bigint = 20000
          and (r2->>'can_accept')::boolean and (r2->>'shortfall')::bigint = 0 and p3->'purchase'->>'buyer_role' = 'partner'
          and (select is_online from drivers where id = drv) and (select status from voucher_codes where id = (p3->'code'->>'id')::uuid) = 'redeemed';
    log := log || format('S8 %s deposit: saldo 0 → online → %s (status can_accept=%s kekurangan=%s); beli voucher (peran %s) → saldo %s → online=%s',
      case when ok then 'OK' else 'BUG' end, left(msg, 45), r->>'can_accept', r->>'shortfall', p3->'purchase'->>'buyer_role', pg_temp.v5_saldo(drv), (select is_online from drivers where id = drv)) || E'\n';
  exception when others then log := log || 'S8 BUG deposit: ' || sqlerrm || E'\n'; end;

  -- ===== V5-09 order tunai selesai → komisi dipotong saldo driver; ledger: tax_output = round(R×11/111), tanpa pg_fee, seimbang =====
  begin
    perform pg_temp.v5_as(cust0);
    o := create_order(jsonb_build_object('service', 'ride_motor', 'vehicle_class', 'motor_economy', 'pickup', jsonb_build_object('lat', 0.4810, 'lng', 101.4349, 'address', 'Jl. Sudirman 45'), 'dropoff', jsonb_build_object('lat', 0.50, 'lng', 101.44, 'address', 'Plaza Andalas'), 'paid_via', 'cash'));
    select pin into v_pin from order_pins where order_id = o.id;
    perform pg_temp.v5_as(drv);
    d0 := pg_temp.v5_saldo(drv);
    o := driver_accept_order(o.id); o := driver_update_order_status(o.id, 'arrived', null); o := driver_update_order_status(o.id, 'in_progress', v_pin); o := driver_update_order_status(o.id, 'completed', null);
    d1 := pg_temp.v5_saldo(drv);
    r := ledger_calc(o); r2 := ledger_check(o.id);
    t_r := (r->>'platform_revenue')::numeric; t_tax := round(t_r * 11 / 111)::bigint;
    select count(*) into n from order_ledger where order_id = o.id and phase = 'completed' and reversal_of is null and entry::text = 'tax_output' and funded_by = 'inclusive' and amount = -t_tax;
    select count(*) into n2 from order_ledger where order_id = o.id and entry::text in ('pg_fee', 'pg_fee_ppn');
    ok := o.status::text = 'completed' and d1 = d0 - (r->>'driver_receivable')::bigint and (r->>'tax_output')::bigint = t_tax and (r->>'platform_revenue_net')::bigint = t_r - t_tax
          and n = 1 and n2 = 0 and (r2->>'balanced')::boolean and (r2->>'tax_inclusive')::bigint = t_tax and (r2->>'platform_revenue_net')::bigint = t_r - t_tax and (r->>'pg_fee')::bigint = 0
          and exists (select 1 from wallet_transactions where user_id = drv and order_id = o.id and type::text = 'fee');
    log := log || format('S9 %s order tunai %s total %s: saldo driver %s→%s (setoran tunai = komisi %s + biaya platform); R=%s PPN=%s (round(R×11/111)=%s) bersih=%s; baris tax_output=%s pg_fee=%s; ledger_check %s',
      case when ok then 'OK' else 'BUG' end, o.code, o.total, d0, d1, r->>'driver_commission', t_r, r->>'tax_output', t_tax, r->>'platform_revenue_net', n, n2, r2->>'verdict') || E'\n';
  exception when others then log := log || 'S9 BUG order tunai: ' || sqlerrm || E'\n'; end;

  -- ===== V5-10 pencairan: sla_due_at +24 jam; auto-approve ≤ batas (rekening terverifikasi); batch → export → settle ok/failed =====
  begin
    -- fraud flag otomatis dari order kilat S9 (mis. kecepatan GPS) memblokir auto-payout — bukan objek uji ini; dibersihkan (ikut ROLLBACK)
    perform set_config('antaraja.bypass', 'on', true);
    delete from fraud_flags where subject_id = drv and status = 'open'; get diagnostics n2 = row_count;
    perform set_config('antaraja.bypass', 'off', true);
    perform pg_temp.v5_as(drv);
    d0 := pg_temp.v5_saldo(drv);
    w1 := request_withdrawal(20000, 'BRI', '1234567890', 'Driver Uji');
    perform pg_temp.v5_as(adm);
    w1 := admin_review_withdrawal(w1.id, true, 'rekening dicek');
    perform pg_temp.v5_as(drv);
    w2 := request_withdrawal(20000, 'BRI', '1234567890', 'Driver Uji');
    ok := w1.status = 'approved' and not w1.auto and w2.status = 'approved' and w2.auto and w1.sla_due_at between now() + interval '23 hours' and now() + interval '25 hours'
          and w2.sla_due_at between now() + interval '23 hours' and now() + interval '25 hours' and pg_temp.v5_saldo(drv) = d0 - 40000;
    perform pg_temp.v5_as(adm);
    pb := admin_payout_batch_create();
    select count(*) into n from admin_payout_batch_export(pb.id);
    ok := ok and pb.count = 2 and pb.total = 40000 and n = 2 and (select status from payout_batches where id = pb.id) = 'exported'
          and (select count(*) from withdrawal_requests where batch_id = pb.id) = 2;
    msg := format('pb.count=%s n=%s w1.batch=%s w2.batch=%s approved_unbatched=%s', pb.count, n, (select batch_id from withdrawal_requests where id = w1.id), (select batch_id from withdrawal_requests where id = w2.id), (select string_agg(id::text || ':' || status || ':' || payout_status || ':' || coalesce(batch_id::text, '-'), ' | ') from withdrawal_requests where user_id = drv));
    r := admin_payout_batch_settle(pb.id, jsonb_build_array(jsonb_build_object('withdrawal_id', w1.id, 'bank_ref', 'BRI-OUT-V5-1', 'status', 'ok'),
                                                            jsonb_build_object('withdrawal_id', w2.id, 'status', 'failed', 'reason', 'nomor rekening tidak valid')));
    select * into w1 from withdrawal_requests where id = w1.id; select * into w2 from withdrawal_requests where id = w2.id;
    ok := ok and (r->>'ok')::int = 1 and (r->>'failed')::int = 1 and (r->>'remaining')::int = 0 and r->'batch'->>'status' = 'settled'
          and w1.settled_at is not null and w1.payout_status = 'PAYOUT_SETTLED' and w1.provider_ref = 'BRI-OUT-V5-1'
          and w2.status = 'rejected' and w2.payout_status = 'PAYOUT_FAILED' and pg_temp.v5_saldo(drv) = d0 - 20000
          and exists (select 1 from wallet_transactions where user_id = drv and type::text = 'refund' and ref = w2.id::text);
    log := log || format('S10 %s pencairan: w1 pending→approved manual, w2 auto=%s, SLA +24j; batch %s transfer Rp%s → export %s baris → settle: ok=%s failed=%s batch=%s; w1 %s ref %s; w2 %s saldo kembali (driver %s→%s); fraud flag S9 dibersihkan=%s',
      case when ok then 'OK' else 'BUG' end, w2.auto, pb.count, pb.total, n, r->>'ok', r->>'failed', r->'batch'->>'status', w1.payout_status, w1.provider_ref, w2.payout_status, d0, pg_temp.v5_saldo(drv), n2) || E'\n';
  exception when others then log := log || 'S10 BUG pencairan: ' || sqlerrm || ' [' || msg || ']' || E'\n'; end;

  -- ===== V5-11 payout_sla_check → security_events payout.sla_breach sekali per request; antrean menandai overdue =====
  begin
    perform pg_temp.v5_as(drv);
    w3 := request_withdrawal(20000, 'BRI', '1234567890', 'Driver Uji');
    update withdrawal_requests set sla_due_at = now() - interval '1 hour' where id = w3.id;
    perform pg_temp.v5_as(null);
    n := payout_sla_check(); n2 := payout_sla_check();
    perform pg_temp.v5_as(finA);
    select x into r from admin_payout_queue() x where (x->>'id')::uuid = w3.id;
    ok := n = 1 and n2 = 0 and (select count(*) from security_events where kind = 'payout.sla_breach' and detail->>'withdrawal_id' = w3.id::text) = 1
          and (r->>'overdue')::boolean and (r->>'sla_remaining_min')::int < 0
          and (select count(*) from notifications where user_id in (finA, finB) and data->>'withdrawal_id' = w3.id::text) = 2;
    log := log || format('S11 %s SLA: due lewat → cek pertama=%s event, kedua=%s; antrean overdue=%s sisa=%s menit; notifikasi finance=%s',
      case when ok then 'OK' else 'BUG' end, n, n2, r->>'overdue', r->>'sla_remaining_min', (select count(*) from notifications where user_id in (finA, finB) and data->>'withdrawal_id' = w3.id::text)) || E'\n';
  exception when others then log := log || 'S11 BUG SLA: ' || sqlerrm || E'\n'; end;

  -- ===== V5-12 target kota: upsert + progres (cogs_per_order, pct, status, platform_fee_recommended) =====
  begin
    city := o.city_id;
    if city is null then select id into city from cities where name = 'Pekanbaru'; end if;
    perform pg_temp.v5_as(adm);
    perform admin_set_city_fixed_cost(city, v_month, 'tim', 30000000, 'uji v5');
    select coalesce(sum(amount), 0) into t_fixed from city_fixed_costs where city_id = city and month = v_month;
    r := to_jsonb(admin_set_city_targets(jsonb_build_object('city_id', city, 'month', v_month, 'target_orders', 10000, 'target_npr', 50000000, 'target_active_drivers', 50, 'pic_ops', 'Budi', 'pic_finance', 'Sari')));
    r2 := to_jsonb(admin_set_city_targets(jsonb_build_object('city_id', city, 'month', v_month, 'target_orders', 10000, 'pic_ops', 'Budi Santoso')));
    select x into r3 from city_targets_progress(v_month, null) x where (x->>'city_id')::uuid = city;
    perform pg_temp.v5_as(finA);
    select count(*) into n from v_city_target_progress;
    perform pg_temp.v5_as(cust0);
    msg := ''; begin perform city_targets_progress(v_month, null); exception when others then msg := sqlerrm; end;
    ok := (r->>'target_orders')::int = 10000 and r2->>'pic_ops' = 'Budi Santoso' and (r2->>'target_npr')::bigint = 50000000
          and (r3->>'cogs_per_order')::bigint = round(t_fixed / 10000.0) and (r3->>'fixed_costs')::bigint = t_fixed
          and (r3->>'platform_fee_recommended')::bigint = ceil(round(t_fixed / 10000.0) * 1.3 / 500) * 500
          and (r3->>'orders')::int >= 1 and (r3->>'cogs_per_order_actual')::bigint = round(t_fixed::numeric / greatest((r3->>'orders')::int, 1))
          and (r3->>'status') in ('behind', 'at_risk', 'on_track') and (r3->>'pct_orders')::numeric = round((r3->>'orders')::int * 100.0 / 10000, 1)
          and (r3->>'npr')::bigint = (r3->>'platform_revenue')::bigint - (r3->>'tax_output')::bigint and n >= 1 and msg like 'Tidak berhak%';
    log := log || format('S12 %s target kota %s: target 10.000 order (PIC %s/%s); biaya tetap Rp%s → COGS/order %s (realisasi %s order → %s); rekomendasi biaya layanan %s; NPR %s = R %s − PPN %s; pct %s%% status %s; pelanggan → %s',
      case when ok then 'OK' else 'BUG' end, r3->>'city', r2->>'pic_ops', r2->>'pic_finance', t_fixed, r3->>'cogs_per_order', r3->>'orders', r3->>'cogs_per_order_actual', r3->>'platform_fee_recommended',
      r3->>'npr', r3->>'platform_revenue', r3->>'tax_output', r3->>'pct_orders', r3->>'status', left(msg, 15)) || E'\n';
  exception when others then log := log || 'S12 BUG target kota: ' || sqlerrm || E'\n'; end;

  -- ===== V5-13 request_topup & order_payment_prepare di voucher_only → PAYMENT_MODE_VOUCHER_ONLY =====
  begin
    perform pg_temp.v5_as(cust0);
    msg := ''; begin tp := request_topup(50000, 'bank_transfer', 'proofs/x.jpg', 'uji'); exception when others then msg := sqlerrm; end;
    msg2 := ''; begin r := order_payment_prepare(gen_random_uuid(), 'gopay'); exception when others then msg2 := sqlerrm; end;
    log := log || format('S13 %s voucher_only: request_topup → %s; order_payment_prepare → %s',
      case when msg like 'PAYMENT_MODE_VOUCHER_ONLY%' and msg2 like 'PAYMENT_MODE_VOUCHER_ONLY%' then 'OK' else 'BUG' end, left(msg, 40), left(msg2, 40)) || E'\n';
  exception when others then log := log || 'S13 BUG topup: ' || sqlerrm || E'\n'; end;

  -- ===== V5-14 admin_set_payment_mode('gateway') mengembalikan saluran (reversibel); finance tidak boleh; kembali ke voucher_only =====
  begin
    perform pg_temp.v5_as(finA);
    msg := ''; begin r := admin_set_payment_mode('gateway'); exception when others then msg := sqlerrm; end;
    perform pg_temp.v5_as(adm);
    r := admin_set_payment_mode('gateway');
    perform pg_temp.v5_as(cust0);
    msg2 := ''; begin tp := request_topup(50000, 'bank_transfer', 'proofs/x.jpg', 'uji gateway'); exception when others then msg2 := sqlerrm; end;
    r2 := payment_channels_public();
    perform pg_temp.v5_as(adm);
    r3 := admin_set_payment_mode('voucher_only');
    select count(*) into n from security_events where kind = 'payment.mode_set';
    ok := msg like 'ADMIN_FORBIDDEN%' and r->>'payment_mode' = 'gateway' and (r2->>'gopay')::boolean and msg2 = '' and tp.status = 'pending'
          and r3->>'payment_mode' = 'voucher_only' and not (r3->'payment_channels'->>'gopay')::boolean and not (r3->'payment_channels'->>'bank_transfer')::boolean
          and (r3->'payment_channels'->>'cash')::boolean and (r3->'payment_channels'->>'antarpay')::boolean and not (r3->>'gateway_order_payment_enabled')::boolean
          and payment_mode() = 'voucher_only' and n >= 3;
    log := log || format('S14 %s mode: finance → %s; superadmin → gateway (gopay publik=%s, request_topup → %s); kembali voucher_only (gopay=%s cash=%s gateway_order=%s); security_events=%s',
      case when ok then 'OK' else 'BUG' end, left(msg, 20), r2->>'gopay', coalesce(nullif(msg2, ''), 'diterima'), r3->'payment_channels'->>'gopay', r3->'payment_channels'->>'cash', r3->>'gateway_order_payment_enabled', n) || E'\n';
  exception when others then log := log || 'S14 BUG mode reversibel: ' || sqlerrm || E'\n'; end;

  -- ===== V5-15 PPh 0 → tidak ada entry; set 2 % → entry tax_output kedua berlabel pph (memo); validasi 0–30; publik =====
  begin
    perform pg_temp.v5_as(adm);
    r := ledger_calc(o);
    select count(*) into n from jsonb_array_elements(r->'entries') e where e->>'entry' = 'tax_output' and e->>'funded_by' = 'pph';
    msg := ''; begin perform admin_set_tax_settings('{"pph_partner_pct": 40}'::jsonb); exception when others then msg := sqlerrm; end;
    perform admin_set_tax_settings('{"pph_partner_pct": 2}'::jsonb);
    r2 := ledger_calc(o);
    select count(*) into n2 from jsonb_array_elements(r2->'entries') e where e->>'entry' = 'tax_output' and e->>'funded_by' = 'pph' and (e->>'amount')::bigint = -round((r2->>'driver_payable')::numeric * 2 / 100);
    r3 := admin_set_tax_settings('{"pph_partner_pct": 0}'::jsonb);
    ok := n = 0 and msg like '%0–30%' and n2 = 1 and (r2->>'pph_memo')::bigint = round((r2->>'driver_payable')::numeric * 2 / 100) and (r2->>'balanced')::boolean
          and (r3->>'pph_partner_pct')::numeric = 0 and (tax_settings_public()->>'ppn_pct')::numeric = 11 and tax_settings_public()->>'label' like 'termasuk PPN 11%';
    log := log || format('S15 %s PPh: 0 → entry pph=%s; 40 %% → %s; 2 %% → entry pph=%s (memo Rp%s dari driver_payable %s, ledger tetap seimbang=%s); dikembalikan 0; label publik "%s"',
      case when ok then 'OK' else 'BUG' end, n, left(msg, 30), n2, r2->>'pph_memo', r2->>'driver_payable', r2->>'balanced', tax_settings_public()->>'label') || E'\n';
  exception when others then log := log || 'S15 BUG PPh: ' || sqlerrm || E'\n'; end;

  -- ===== S16 RLS & invarian: kode orang lain tidak terlihat; anon baca konfigurasi publik; dompet = Σ mutasi; kode redeemed ↔ 1 kredit =====
  begin
    perform pg_temp.v5_as(cust2);
    set local role authenticated;
    select count(*) into n from voucher_codes where buyer_id = cust and redeemed_by = cust;   -- kode milik cust (bukan cust2)
    select count(*) into n2 from voucher_codes;                                                 -- hanya kode cust2 (pembeli) → ≥ 1
    reset role;
    perform pg_temp.v5_as(null); set local role anon;
    r := voucher_public_config();
    msg := ''; begin perform voucher_code_redeem('AKV-AAAA-BBBB-CCCC'); exception when others then msg := sqlerrm; end;
    reset role;
    select count(*) into b0 from wallets wl left join (select user_id, sum(amount) jml from wallet_transactions group by user_id) t on t.user_id = wl.user_id where wl.balance <> coalesce(t.jml, 0);
    select count(*) into b1 from voucher_codes c where c.status = 'redeemed' and (select count(*) from wallet_transactions t where t.id = c.wallet_tx_id and t.amount = c.nominal and t.type::text = 'voucher_redeem') <> 1;
    log := log || format('S16 %s RLS/invarian: kode orang lain terlihat=%s, kode sendiri=%s; anon config mode=%s; anon tukar → %s; dompet ≠ Σ mutasi=%s; kode redeemed tanpa tepat 1 kredit=%s',
      case when n = 0 and n2 >= 1 and r->>'payment_mode' = 'voucher_only' and msg like '%permission denied%' and b0 = 0 and b1 = 0 then 'OK' else 'BUG' end,
      n, n2, r->>'payment_mode', left(msg, 30), b0, b1) || E'\n';
  exception when others then reset role; log := log || 'S16 BUG RLS: ' || sqlerrm || E'\n'; end;

  raise exception using message = 'SIMULASI_SELESAI' || E'\n' || log;
end $sim$;
