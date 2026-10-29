-- Uji GO-LIVE 0115 (closed-loop BCA, verifikasi pemilik, G-06 lockout PIN, G-07 race accept):
--   S1 rekening BCA tampil publik · S2 sakelar go-live · S3 pembelian voucher via 'bca' · S4 saluran (gopay/qris ditolak, cash/antarpay lolos)
--   S5 admin_unlock PIN salah 5× → failed=5 & terkunci (ok:false, bukan RAISE) · S6 exec_login salah → ok:false, benar → ok:true
--   S7 race: driver dengan order aktif tidak bisa accept order kedua (RPC) dan index unik menolak penulisan langsung
--   S8 admin_voucher_bank_verify_owner: alasan pendek ditolak, non-superadmin ditolak, placeholder ditolak, rekening sah → public_ok
--   S9 placeholder Himbara nonaktif; daftar bank_code diperluas
-- Satu transaksi, di-ROLLBACK (RAISE 'SIMULASI_SELESAI'). Lokal: scripts/db-lokal.sh test supabase/tests/uji_golive_0115.sql
-- Mengandaikan akun uji seed.sql (a0..01 superadmin PIN 123456, a0..02 pelanggan, a0..03 driver motor approved).

create or replace function pg_temp.g_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', case when p_uid is null then '' else json_build_object('sub', p_uid, 'role', 'authenticated')::text end, true);
$$;
create or replace function pg_temp.g_admin(p_role text) returns uuid language plpgsql as $$
declare u uuid := gen_random_uuid(); mail text := 'uji.0115.' || p_role || '.' || left(u::text, 8) || '@antaraja.id';
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values ('00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated', mail, extensions.crypt('rahasia123', extensions.gen_salt('bf')), now(), now(), now(),
          '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('full_name', 'Admin 0115 ' || p_role, 'phone', '+6282' || (floor(random() * 1e9))::bigint, 'email', mail));
  perform pg_temp.g_as(null);
  perform set_config('antaraja.bypass', 'on', true);
  update profiles set role = 'admin' where id = u;
  perform set_config('antaraja.bypass', 'off', true);
  update profiles set admin_role = p_role where id = u;
  insert into admin_security (user_id, pin_hash) values (u, extensions.crypt('123456', extensions.gen_salt('bf')));
  perform pg_temp.g_as(u);
  perform admin_unlock('123456');
  return u;
end $$;

do $sim$
declare
  log text := '';
  adm uuid := 'a0000000-0000-4000-8000-000000000001'; cust0 uuid := 'a0000000-0000-4000-8000-000000000002'; drv uuid := 'a0000000-0000-4000-8000-000000000003';
  fin uuid; bca uuid; bri uuid; cimb uuid;
  r jsonb; r2 jsonb; r3 jsonb; ok boolean; msg text; msg2 text; msg3 text; msg4 text; n int; n2 int; i int; st text;
  o1 orders; o2 orders; o3 orders; v_name text;
begin
  -- ===== S0 persiapan: superadmin buka kunci; sisa uji manual driver/pelanggan dibersihkan (ikut ROLLBACK) =====
  begin
    perform pg_temp.g_as(adm);
    r := admin_unlock('123456');
    perform set_config('antaraja.bypass', 'on', true);
    update orders set status = 'cancelled' where (driver_id = drv or customer_id = cust0) and status in ('scheduled', 'searching', 'accepted', 'arrived', 'in_progress');
    update drivers set is_online = false where id = drv;
    delete from fraud_flags where subject_id = drv and status = 'open';
    perform set_config('antaraja.bypass', 'off', true);
    select id into bca from company_bank_accounts where bank_code = 'bca' and account_no = '0181320108';
    select id into bri from company_bank_accounts where bank_code = 'bri';
    v_name := voucher_account_holder_name();   -- 0117: nama pemilik rekening
    log := log || format('S0 %s persiapan: admin_unlock ok=%s, bca=%s, legal_entity="%s"', case when (r->>'ok')::boolean and bca is not null then 'OK' else 'BUG' end, r->>'ok', bca is not null, v_name) || E'\n';
  exception when others then log := log || 'S0 BUG persiapan: ' || sqlerrm || E'\n'; end;

  -- ===== S1 rekening BCA tampil di voucher_bank_accounts_public() & voucher_public_config() =====
  begin
    perform pg_temp.g_as(cust0);
    select count(*) into n from voucher_bank_accounts_public() where bank_code = 'bca' and account_no = '0181320108' and account_name = v_name;
    r := voucher_public_config();
    select count(*) into n2 from jsonb_array_elements(r->'banks') b where b->>'bank_code' = 'bca' and b->>'account_no' = '0181320108';
    ok := n = 1 and n2 = 1 and r->>'account_holder' = v_name and (select owner_verified_at is not null and owner_verified_reason like 'Keputusan GM%' from company_bank_accounts where id = bca);
    log := log || format('S1 %s rekening BCA publik: voucher_bank_accounts_public=%s, voucher_public_config.banks=%s (total %s), a.n. "%s", owner_verified=%s',
      case when ok then 'OK' else 'BUG' end, n, n2, jsonb_array_length(r->'banks'), v_name, (select owner_verified_at is not null from company_bank_accounts where id = bca)) || E'\n';
  exception when others then log := log || 'S1 BUG rekening publik: ' || sqlerrm || E'\n'; end;

  -- ===== S2 sakelar go-live: antarvoucher_enabled, purchase_enabled, payment_mode, saluran, pg_methods, simulasi mati =====
  begin
    r := voucher_status_public(); r2 := payment_channels_public();
    ok := antarvoucher_enabled() and (r->>'purchase_enabled')::boolean and (r->>'banks_ready')::int >= 1 and payment_mode() = 'voucher_only'
          and not (r2->>'gopay')::boolean and not (r2->>'qris')::boolean and not (r2->>'bank_transfer')::boolean and (r2->>'cash')::boolean and (r2->>'antarpay')::boolean
          and (select value = '[]'::jsonb from app_settings where key = 'pg_methods') and not gateway_order_payment_enabled()
          and coalesce((select lower(value #>> '{}') = 'true' from app_settings where key = 'antarvoucher_purchase_enabled'), false)
          and not coalesce((select lower(value #>> '{}') = 'true' from app_settings where key = 'payments_simulation_enabled'), false)
          and (select count(*) from _migration_backup_settings where version = '0115') >= 7;
    log := log || format('S2 %s sakelar: antarvoucher_enabled=%s purchase_enabled=%s banks_ready=%s payment_mode=%s gopay=%s qris=%s cash=%s antarpay=%s pg_methods=%s gateway_order=%s backup_0115=%s',
      case when ok then 'OK' else 'BUG' end, antarvoucher_enabled(), r->>'purchase_enabled', r->>'banks_ready', payment_mode(), r2->>'gopay', r2->>'qris', r2->>'cash', r2->>'antarpay',
      (select value from app_settings where key = 'pg_methods'), gateway_order_payment_enabled(), (select count(*) from _migration_backup_settings where version = '0115')) || E'\n';
  exception when others then log := log || 'S2 BUG sakelar: ' || sqlerrm || E'\n'; end;

  -- ===== S3 pembelian voucher Rp50.000 via 'bca' sebagai pelanggan uji =====
  begin
    perform pg_temp.g_as(cust0);
    r := voucher_code_purchase_create(50000, 'bca', 'golive-0115-idem-1');
    r2 := voucher_code_purchase_create(50000, 'bca', 'golive-0115-idem-1');
    ok := r->'code'->>'status' = 'pending_payment' and r->'purchase'->>'status' = 'awaiting_transfer' and (r->'purchase'->>'bank_account_id')::uuid = bca
          and (r->'purchase'->>'transfer_amount')::bigint between 50001 and 50999 and r2->'code'->>'id' = r->'code'->>'id'
          and r->'code'->>'code' ~ '^AKV-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$';
    log := log || format('S3 %s beli via bca: kode %s (%s), pembelian %s %s, transfer Rp%s ke %s, idempoten=%s',
      case when ok then 'OK' else 'BUG' end, r->'code'->>'code', r->'code'->>'status', r->'purchase'->>'reference', r->'purchase'->>'status', r->'purchase'->>'transfer_amount',
      (select bank_name from company_bank_accounts where id = (r->'purchase'->>'bank_account_id')::uuid), r2->'code'->>'id' = r->'code'->>'id') || E'\n';
  exception when others then log := log || 'S3 BUG beli: ' || sqlerrm || E'\n'; end;

  -- ===== S4 saluran: gopay & qris ditolak PAYMENT_MODE_VOUCHER_ONLY; cash & antarpay (wallet) lolos =====
  begin
    msg := ''; begin perform payment_channel_require('gopay'); exception when others then msg := sqlerrm; end;
    msg2 := ''; begin perform payment_channel_require('qris'); exception when others then msg2 := sqlerrm; end;
    msg3 := ''; begin perform payment_channel_require('cash'); exception when others then msg3 := sqlerrm; end;
    msg4 := ''; begin perform payment_channel_require('wallet'); exception when others then msg4 := sqlerrm; end;
    ok := msg like 'PAYMENT_MODE_VOUCHER_ONLY%' and msg2 like 'PAYMENT_MODE_VOUCHER_ONLY%' and msg3 = '' and msg4 = '';
    log := log || format('S4 %s saluran: gopay → %s; qris → %s; cash → %s; wallet/antarpay → %s',
      case when ok then 'OK' else 'BUG' end, left(msg, 32), left(msg2, 32), coalesce(nullif(msg3, ''), 'lolos'), coalesce(nullif(msg4, ''), 'lolos')) || E'\n';
  exception when others then log := log || 'S4 BUG saluran: ' || sqlerrm || E'\n'; end;

  -- ===== S5 G-06 admin_unlock: PIN salah 5× → ok:false tiap kali, failed=5, terkunci; PIN benar saat terkunci → ok:false; reset → ok:true =====
  begin
    perform pg_temp.g_as(adm);
    update admin_security set failed = 0, locked_until = null, unlocked_until = null where user_id = adm;
    select count(*) into n2 from security_events where kind = 'admin.unlock_failed' and user_id = adm;
    n := 0; msg := '';
    for i in 1..5 loop
      r := admin_unlock('000000');
      if r->>'ok' = 'false' then n := n + 1; end if;
      msg := r->>'error';
    end loop;
    r2 := admin_unlock('123456');   -- benar, tetapi sudah terkunci
    r3 := admin_pin_status();
    select failed, case when locked_until > now() then 'terkunci' else 'bebas' end into i, st from admin_security where user_id = adm;
    ok := n = 5 and i = 5 and st = 'terkunci' and msg like 'PIN salah (5/5)%' and r2->>'ok' = 'false' and r2->>'error' like 'Terlalu banyak percobaan%'
          and (r3->>'locked_until') is not null and not (r3->>'unlocked')::boolean
          and (select count(*) from security_events where kind = 'admin.unlock_failed' and user_id = adm) = n2 + 5;
    update admin_security set failed = 0, locked_until = null where user_id = adm;
    r := admin_unlock('123456');
    ok := ok and (r->>'ok')::boolean and (r->>'unlocked')::boolean and (r->>'has_pin')::boolean;
    log := log || format('S5 %s admin_unlock: salah 5× → ok:false ×%s, failed=%s, %s, pesan ke-5 "%s"; PIN benar saat terkunci → "%s"; security_events +%s; setelah reset → ok=%s unlocked=%s',
      case when ok then 'OK' else 'BUG' end, n, i, st, msg, r2->>'error', (select count(*) from security_events where kind = 'admin.unlock_failed' and user_id = adm) - n2, r->>'ok', r->>'unlocked') || E'\n';
  exception when others then log := log || 'S5 BUG admin_unlock: ' || sqlerrm || E'\n'; end;

  -- ===== S6 G-06 exec_login: PIN salah → ok:false failed=1 (tersimpan); benar → ok:true + token; 5× salah → terkunci =====
  begin
    perform pg_temp.g_as(adm);
    insert into exec_access (user_id, level, pin_hash, active) select adm, 'vp', extensions.crypt('654321', extensions.gen_salt('bf')), true where not exists (select 1 from exec_access where user_id = adm);
    update exec_access set pin_hash = extensions.crypt('654321', extensions.gen_salt('bf')), active = true, failed = 0, locked_until = null where user_id = adm;
    r := exec_login('999999');
    select failed into i from exec_access where user_id = adm;
    r2 := exec_login('654321');
    select failed into n from exec_access where user_id = adm;
    for i in 1..5 loop r3 := exec_login('999999'); end loop;
    select failed, case when locked_until > now() then 'terkunci' else 'bebas' end into n2, st from exec_access where user_id = adm;
    msg := (exec_login('654321'))->>'error';
    ok := r->>'ok' = 'false' and (r->>'failed')::int = 1 and r->>'error' like 'PIN eksekutif salah (1/5)%'
          and (r2->>'ok')::boolean and length(r2->>'token') = 64 and r2->>'level' = 'vp' and (r2->>'expires_at') is not null and n = 0
          and n2 = 5 and st = 'terkunci' and r3->>'ok' = 'false' and msg like 'Terlalu banyak percobaan%'
          and exists (select 1 from exec_sessions where token = r2->>'token' and user_id = adm);
    update exec_access set failed = 0, locked_until = null where user_id = adm;
    log := log || format('S6 %s exec_login: salah → ok=%s failed=%s "%s"; benar → ok=%s token=%s level=%s (failed reset=%s); 5× salah → failed=%s %s; benar saat terkunci → "%s"',
      case when ok then 'OK' else 'BUG' end, r->>'ok', r->>'failed', r->>'error', r2->>'ok', length(r2->>'token'), r2->>'level', n, n2, st, msg) || E'\n';
  exception when others then log := log || 'S6 BUG exec_login: ' || sqlerrm || E'\n'; end;

  -- ===== S7 G-07 race: driver dengan order aktif → accept kedua ditolak; penulisan langsung ditolak index unik; arrived pada order yang sama tetap boleh =====
  begin
    perform pg_temp.g_as(adm);
    perform set_config('antaraja.bypass', 'on', true);
    update drivers set is_online = true, status = 'approved' where id = drv;
    perform set_config('antaraja.bypass', 'off', true);
    perform pg_temp.g_as(cust0);
    o1 := create_order(jsonb_build_object('service', 'ride_motor', 'vehicle_class', 'motor_economy', 'pickup', jsonb_build_object('lat', 0.4810, 'lng', 101.4349, 'address', 'Jl. Sudirman 45'), 'dropoff', jsonb_build_object('lat', 0.50, 'lng', 101.44, 'address', 'Plaza Andalas'), 'paid_via', 'cash'));
    o2 := create_order(jsonb_build_object('service', 'ride_motor', 'vehicle_class', 'motor_economy', 'pickup', jsonb_build_object('lat', 0.4815, 'lng', 101.4350, 'address', 'Jl. Sudirman 46'), 'dropoff', jsonb_build_object('lat', 0.51, 'lng', 101.45, 'address', 'Pasar Raya'), 'paid_via', 'cash'));
    perform pg_temp.g_as(drv);
    o1 := driver_accept_order(o1.id);
    msg := ''; begin o3 := driver_accept_order(o2.id); exception when others then msg := sqlerrm; end;
    -- pagar index: penulisan langsung (di luar RPC) order kedua ke driver yang sama
    msg2 := ''; st := '';
    begin
      perform set_config('antaraja.bypass', 'on', true);
      update orders set driver_id = drv, status = 'accepted', accepted_at = now() where id = o2.id;
      perform set_config('antaraja.bypass', 'off', true);
    exception when others then msg2 := sqlerrm; st := sqlstate; perform set_config('antaraja.bypass', 'off', true); end;
    -- transisi sah pada order yang sama tidak terhalang index
    msg3 := ''; begin o1 := driver_update_order_status(o1.id, 'arrived', null); exception when others then msg3 := sqlerrm; end;
    select count(*) into n from orders where driver_id = drv and status in ('accepted', 'arrived', 'in_progress');
    ok := o1.status = 'arrived' and msg = 'Selesaikan order aktif dulu' and st = '23505' and msg2 like '%orders_one_active_per_driver%' and msg3 = '' and n = 1
          and (select status from orders where id = o2.id) = 'searching'
          and position('for update' in pg_get_functiondef('public.driver_accept_order(uuid)'::regprocedure)) > 0;
    log := log || format('S7 %s race accept: order-1 %s; accept order-2 → "%s"; tulis langsung order-2 → %s %s; arrived order-1 → %s; order aktif driver=%s; order-2 tetap %s',
      case when ok then 'OK' else 'BUG' end, o1.status, msg, st, left(msg2, 60), coalesce(nullif(msg3, ''), 'ok'), n, (select status from orders where id = o2.id)) || E'\n';
    perform pg_temp.g_as(cust0);
    perform cancel_order(o2.id, 'uji 0115');
  exception when others then perform set_config('antaraja.bypass', 'off', true); log := log || 'S7 BUG race: ' || sqlerrm || E'\n'; end;

  -- ===== S8 admin_voucher_bank_verify_owner: alasan pendek, non-superadmin, placeholder ditolak; rekening sah → public_ok + security_events =====
  begin
    fin := pg_temp.g_admin('finance');
    perform pg_temp.g_as(adm);
    r := admin_voucher_bank_upsert(jsonb_build_object('bank_code', 'cimb', 'bank_name', 'CIMB Niaga', 'account_no', '7001234567', 'account_name', v_name, 'active', true, 'display_order', 2));
    cimb := (r->>'id')::uuid;
    update company_bank_accounts set active = true where id = cimb;   -- upsert baru selalu active=false (0112); diaktifkan untuk uji
    msg := ''; begin perform admin_voucher_bank_verify_owner(cimb, 'pendek'); exception when others then msg := sqlerrm; end;
    perform pg_temp.g_as(fin);
    msg2 := ''; begin perform admin_voucher_bank_verify_owner(cimb, 'alasan cukup panjang untuk uji'); exception when others then msg2 := sqlerrm; end;
    perform pg_temp.g_as(adm);
    msg3 := ''; begin perform admin_voucher_bank_verify_owner(bri, 'alasan cukup panjang untuk uji'); exception when others then msg3 := sqlerrm; end;
    select count(*) into n2 from security_events where kind = 'voucher.bank_owner_verify';
    ok := not (r->>'public_ok')::boolean and msg like '%minimal 10 karakter%' and msg2 like 'ADMIN_FORBIDDEN%' and msg3 like '%placeholder%'
          and (select voucher_bank_account_public_ok(b) from company_bank_accounts b where id = cimb) = false;
    r2 := admin_voucher_bank_verify_owner(cimb, 'Uji 0115: rekening CIMB operasional (keputusan GM)');
    select count(*) into n from voucher_bank_accounts_public() where bank_code = 'cimb';
    ok := ok and (r2->>'public_ok')::boolean and n = 1 and (select count(*) from security_events where kind = 'voucher.bank_owner_verify') = n2 + 1
          and exists (select 1 from audit_logs where action = 'voucher.bank_owner_verify' and entity_id = cimb::text)
          and (select owner_verified_by = adm from company_bank_accounts where id = cimb);
    log := log || format('S8 %s verify_owner: sebelum public_ok=%s; alasan pendek → "%s"; finance → %s; placeholder BRI → "%s"; superadmin alasan sah → public_ok=%s, tampil publik=%s, security_events +%s',
      case when ok then 'OK' else 'BUG' end, r->>'public_ok', left(msg, 45), left(msg2, 20), left(msg3, 40), r2->>'public_ok', n,
      (select count(*) from security_events where kind = 'voucher.bank_owner_verify') - n2) || E'\n';
  exception when others then log := log || 'S8 BUG verify_owner: ' || sqlerrm || E'\n'; end;

  -- ===== S9 placeholder Himbara nonaktif (tidak dihapus); CHECK bank_code menerima bank baru & menolak kode liar =====
  begin
    select count(*), count(*) filter (where active) into n, n2 from company_bank_accounts where is_placeholder and account_no is null;
    perform pg_temp.g_as(adm);
    msg := ''; begin perform admin_voucher_bank_upsert(jsonb_build_object('bank_code', 'bankliar', 'bank_name', 'X', 'account_no', '12345678', 'account_name', v_name)); exception when others then msg := sqlerrm; end;
    ok := n = 5 and n2 = 0 and msg like '%company_bank_accounts_bank_code_check%'
          and (select count(*) from voucher_bank_accounts_public() where bank_code in ('bri', 'bni', 'mandiri', 'btn', 'bsi')) = 0;
    log := log || format('S9 %s placeholder Himbara: %s baris, aktif=%s (harus 0), tampil publik=0; bank_code liar → %s',
      case when ok then 'OK' else 'BUG' end, n, n2, left(msg, 60)) || E'\n';
  exception when others then log := log || 'S9 BUG placeholder: ' || sqlerrm || E'\n'; end;

  raise exception using message = 'SIMULASI_SELESAI' || E'\n' || log;
end $sim$;
