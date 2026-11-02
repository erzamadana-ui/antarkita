-- =====================================================================
-- uji_payout_accounts_0123.sql — Rekening pencairan mitra wajib + auto-sweep + provider (migrasi 0123)
--   1. Struktur: bank_accounts.channel/bank_code/auto_sweep, view partner_payout_accounts, bank_codes e-wallet, withdrawal_requests.source, specs
--   2. partner_payout_account_set: pelanggan ditolak; e-wallet nomor salah ditolak; DANA valid → mine() exists, verified=false, masked; ganti rekening → verified reset
--   3. Penjaga PAYOUT_ACCOUNT_REQUIRED: driver_set_online(true) tanpa rekening ditolak → ada rekening lolos; merchant buka toko (update is_open & merchant_set_open);
--      register_driver langkah akhir (dokumen) ditolak, tanpa dokumen lolos, payload payout_account lolos; travel_partner_register tanpa rekening ditolak
--   4. request_withdrawal argumen kosong → rekening tersimpan; tanpa rekening → PAYOUT_ACCOUNT_REQUIRED
--   5. Auto-sweep di payout_batch_auto: merchant terverifikasi 300.000 → approved & masuk batch; driver terverifikasi 100.000 − cadangan 30.000 → 70.000;
--      driver belum terverifikasi → pending (tidak masuk batch); panggil ulang → tidak menggandakan; sakelar mati → tidak ada sweep
--   6. CSV BCA: DANA → Kode Bank 'DANA'; Danamon → '011' (bukan DANA)
--   7. Provider: payout_provider=api → payout_provider_jobs queued berisi items; dispatch tanpa URL → skipped; manual → tidak ada job
--   8. Admin: admin_partner_payout_accounts cari nama; admin_partner_payout_verify → verified + notifikasi; non-admin ditolak
-- Pola (b): begin; do $$ … raise notice '[OK] …' $$; rollback;   Lokal: scripts/db-lokal.sh test supabase/tests/uji_payout_accounts_0123.sql
-- Akun seed: a0..01 superadmin (PIN 123456), a0..02 pelanggan, a0..03 driver approved, a0..04 driver/mitra travel, a0..05 pemilik merchant, a0..06 driver box.
-- =====================================================================
begin;
-- helper sementara (pg_temp, ikut ROLLBACK): setel saldo dompet ke nilai pasti lewat wallet_apply
create function pg_temp.reset_wallet(p_user uuid, p_target bigint) returns void language plpgsql as $f$
declare cur bigint;
begin
  insert into wallets (user_id) values (p_user) on conflict do nothing;
  select coalesce(balance, 0) into cur from wallets where user_id = p_user;
  if cur <> p_target then perform wallet_apply(p_user, 'adjustment', p_target - cur, null, 'reset saldo uji 0123'); end if;
end $f$;
do $$
declare
  adm  constant uuid := 'a0000000-0000-4000-8000-000000000001';
  cust constant uuid := 'a0000000-0000-4000-8000-000000000002';
  drv  constant uuid := 'a0000000-0000-4000-8000-000000000003';
  drv2 constant uuid := 'a0000000-0000-4000-8000-000000000004';
  mer  constant uuid := 'a0000000-0000-4000-8000-000000000005';
  dbox constant uuid := 'a0000000-0000-4000-8000-000000000006';
  v_today date := (now() at time zone 'Asia/Jakarta')::date;
  t10 timestamptz; t13 timestamptz; t17 timestamptz;
  r jsonb; s jsonb; j jsonb; n int; n2 int; v_msg text; v_bal bigint; w withdrawal_requests; b uuid; csv text; lines text[]; d drivers; m merchants; acc_id uuid; u uuid;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  r := admin_unlock('123456');
  if not coalesce((r->>'ok')::boolean, false) then raise exception '[GAGAL] admin_unlock seed gagal: %', r; end if;
  t10 := (v_today + time '10:00') at time zone 'Asia/Jakarta';
  t13 := (v_today + time '13:05') at time zone 'Asia/Jakarta';
  t17 := (v_today + time '17:05') at time zone 'Asia/Jakarta';

  -- ===== persiapan (ikut ROLLBACK): antrean lama ke batch pembersihan, sesi hari ini kosong, saldo & rekening akun uji disetel =====
  perform set_config('antaraja.bypass', 'on', true);
  perform payout_batch_create_internal(null, 'pembersihan uji 0123', 0);
  delete from withdrawal_requests where user_id in (cust, drv, drv2, mer, dbox) and settled_at is null and status in ('pending', 'approved') and batch_id is null;
  delete from payout_sessions where session_date = v_today;
  delete from payout_provider_jobs;
  delete from fraud_flags where subject_id in (drv, drv2, mer, dbox) and status = 'open';
  update profiles set is_active = true where id in (cust, drv, drv2, mer, dbox);
  update drivers set status = 'approved', is_online = false where id in (drv, drv2, dbox);
  update merchants set status = 'approved', is_open = true where owner_id = mer;
  update travel_partners set status = 'approved' where id = drv2;
  insert into app_settings (key, value) values ('payout_auto_sweep_enabled', 'true'::jsonb), ('payout_account_required', 'true'::jsonb),
    ('payout_sweep_driver_reserve', '30000'::jsonb), ('payout_provider', '"manual"'::jsonb), ('auto_payout_enabled', 'true'::jsonb),
    ('rate_limit_withdrawal_per_hour', '100000'::jsonb), ('driver_deposit_required', 'false'::jsonb), ('driver_debt_limit', '-500000'::jsonb)
  on conflict (key) do update set value = excluded.value, updated_at = now();
  perform pg_temp.reset_wallet(mer, 300000); perform pg_temp.reset_wallet(drv, 100000); perform pg_temp.reset_wallet(drv2, 0); perform pg_temp.reset_wallet(dbox, 40000); perform pg_temp.reset_wallet(cust, 0);
  delete from bank_accounts where user_id in (cust, drv, drv2, mer, dbox);
  insert into bank_accounts (user_id, bank_name, account_no, holder, channel, bank_code, verified) values
    (mer,  'Bank Mandiri', '9876543210', 'Mak Syukur',   'bank', 'mandiri', true),
    (drv,  'BCA',          '1234567890', 'Ahmad Fauzi',  'bank', 'bca',     true),
    (dbox, 'Danamon',      '5555666677', 'Dedi Box',     'bank', 'danamon', true);
  perform set_config('antaraja.bypass', 'off', true);

  -- ===== 1. struktur =====
  if not exists (select 1 from information_schema.columns where table_name = 'bank_accounts' and column_name in ('channel', 'bank_code', 'auto_sweep', 'id', 'created_at') having count(*) = 5) then raise exception '[GAGAL] kolom bank_accounts'; end if;
  if to_regclass('public.partner_payout_accounts') is null then raise exception '[GAGAL] view partner_payout_accounts'; end if;
  if (select count(*) from partner_payout_accounts where user_id = mer and account_name = 'Mak Syukur' and channel = 'bank' and bank_code = 'mandiri') <> 1 then raise exception '[GAGAL] view alias account_name'; end if;
  if (select count(*) from bank_codes where code in ('dana', 'ovo', 'linkaja', 'gopay', 'shopeepay') and bank_code in ('DANA', 'OVO', 'LINKAJA', 'GOPAY', 'SHOPEEPAY')) <> 5 then raise exception '[GAGAL] bank_codes e-wallet'; end if;
  if not exists (select 1 from information_schema.columns where table_name = 'withdrawal_requests' and column_name = 'source') then raise exception '[GAGAL] withdrawal_requests.source'; end if;
  if (select count(*) from app_setting_specs() where key in ('payout_account_required', 'payout_auto_sweep_enabled', 'payout_sweep_driver_reserve', 'payout_provider')) <> 4 then raise exception '[GAGAL] app_setting_specs'; end if;
  raise notice '[OK] 1. struktur: bank_accounts diperluas (channel/bank_code/auto_sweep), view partner_payout_accounts, 5 kode e-wallet, withdrawal_requests.source, 4 setelan';

  -- ===== 2. partner_payout_account_set / mine =====
  perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
  v_msg := ''; begin perform partner_payout_account_set(jsonb_build_object('channel', 'bank', 'bank_code', 'bca', 'account_no', '1234500002', 'account_name', 'Budi Santoso')); exception when others then v_msg := sqlerrm; end;
  if v_msg not ilike '%hanya untuk mitra%' then raise exception '[GAGAL] pelanggan bisa set rekening: %', v_msg; end if;
  r := partner_payout_account_mine();
  if (r->>'exists')::boolean or not (r->>'required')::boolean or jsonb_array_length(r->'banks') < 11 then raise exception '[GAGAL] mine() kosong: %', r; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', drv2, 'role', 'authenticated')::text, true);
  v_msg := ''; begin perform partner_payout_account_set(jsonb_build_object('channel', 'dana', 'account_no', '12345', 'account_name', 'Rina Kartika')); exception when others then v_msg := sqlerrm; end;
  if v_msg not ilike '%08xx%' then raise exception '[GAGAL] nomor e-wallet salah diterima: %', v_msg; end if;
  v_msg := ''; begin perform partner_payout_account_set(jsonb_build_object('channel', 'bank', 'bank_code', 'bankxyz', 'account_no', '12345678', 'account_name', 'Rina Kartika')); exception when others then v_msg := sqlerrm; end;
  if v_msg not ilike '%tidak dikenal%' then raise exception '[GAGAL] kode bank asing diterima: %', v_msg; end if;
  r := partner_payout_account_set(jsonb_build_object('channel', 'dana', 'account_no', '0812-3456-7890', 'account_name', 'Rina Kartika'));
  if not (r->>'exists')::boolean or r->>'channel' <> 'dana' or r->>'bank_code' <> 'dana' or r->>'bank_name' <> 'DANA' or r->>'account_no' <> '081234567890'
     or r->>'account_no_masked' <> '••••••••7890' or (r->>'verified')::boolean or not (r->>'auto_sweep')::boolean then raise exception '[GAGAL] set DANA: %', r; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  perform admin_set_bank_verified(drv2, true);
  perform set_config('request.jwt.claims', json_build_object('sub', drv2, 'role', 'authenticated')::text, true);
  if not (select verified from bank_accounts where user_id = drv2) then raise exception '[GAGAL] verifikasi admin lama'; end if;
  r := partner_payout_account_set(jsonb_build_object('channel', 'dana', 'account_no', '081234567890', 'account_name', 'Rina K.', 'auto_sweep', false));
  if not (r->>'verified')::boolean or (r->>'auto_sweep')::boolean then raise exception '[GAGAL] ganti nama saja harus tetap verified: %', r; end if;
  r := partner_payout_account_set(jsonb_build_object('channel', 'ovo', 'account_no', '081234567890', 'account_name', 'Rina Kartika'));
  if (r->>'verified')::boolean or r->>'bank_name' <> 'OVO' then raise exception '[GAGAL] ganti saluran harus reset verified: %', r; end if;
  raise notice '[OK] 2. set/mine: pelanggan ditolak; e-wallet nomor/kode salah ditolak; DANA 081234567890 tersimpan (masked %, verified=false); ganti nama tetap verified; ganti saluran → verified reset', r->>'account_no_masked';

  -- ===== 3. penjaga PAYOUT_ACCOUNT_REQUIRED =====
  perform set_config('antaraja.bypass', 'on', true); delete from bank_accounts where user_id = drv2; perform set_config('antaraja.bypass', 'off', true);
  perform set_config('request.jwt.claims', json_build_object('sub', drv2, 'role', 'authenticated')::text, true);
  perform driver_selfie_check('https://x/selfie.jpg');
  v_msg := ''; begin perform driver_set_online(true, 0.4946, 101.4314); exception when others then v_msg := sqlerrm; end;
  if v_msg not like 'PAYOUT_ACCOUNT_REQUIRED%' then raise exception '[GAGAL] driver tanpa rekening bisa online: %', v_msg; end if;
  perform partner_payout_account_set(jsonb_build_object('channel', 'bank', 'bank_code', 'bri', 'account_no', '1234500004', 'account_name', 'Rina Kartika'));
  d := driver_set_online(true, 0.4946, 101.4314);
  if not d.is_online then raise exception '[GAGAL] driver dengan rekening tidak online'; end if;
  perform driver_set_online(false, null, null);
  -- merchant: tutup lalu buka tanpa rekening → ditolak (update langsung & RPC); dengan rekening → lolos
  perform set_config('request.jwt.claims', json_build_object('sub', mer, 'role', 'authenticated')::text, true);
  update merchants set is_open = false where owner_id = mer;
  perform set_config('antaraja.bypass', 'on', true); delete from bank_accounts where user_id = mer; perform set_config('antaraja.bypass', 'off', true);
  v_msg := ''; begin update merchants set is_open = true where owner_id = mer; exception when others then v_msg := sqlerrm; end;
  if v_msg not like 'PAYOUT_ACCOUNT_REQUIRED%' then raise exception '[GAGAL] merchant tanpa rekening bisa buka (update): %', v_msg; end if;
  v_msg := ''; begin perform merchant_set_open(true); exception when others then v_msg := sqlerrm; end;
  if v_msg not like 'PAYOUT_ACCOUNT_REQUIRED%' then raise exception '[GAGAL] merchant tanpa rekening bisa buka (rpc): %', v_msg; end if;
  perform partner_payout_account_set(jsonb_build_object('channel', 'bank', 'bank_code', 'mandiri', 'account_no', '9876543210', 'account_name', 'Mak Syukur'));
  m := merchant_set_open(true);
  if not m.is_open then raise exception '[GAGAL] merchant_set_open gagal membuka'; end if;
  perform set_config('antaraja.bypass', 'on', true); update bank_accounts set verified = true where user_id = mer; perform set_config('antaraja.bypass', 'off', true);
  -- register_driver (cust belum punya rekening): tanpa dokumen lolos, dengan dokumen ditolak, dengan payload payout_account lolos
  perform set_config('antaraja.bypass', 'on', true); delete from bank_accounts where user_id = cust; perform set_config('antaraja.bypass', 'off', true);
  perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
  d := register_driver(jsonb_build_object('vehicle_type', 'motor', 'vehicle_brand', 'Honda', 'vehicle_model', 'BeAT', 'fuel_type', 'bensin', 'vehicle_plate', 'bm 1234 xx', 'vehicle_year', 2021));
  v_msg := ''; begin perform register_driver(jsonb_build_object('vehicle_type', 'motor', 'vehicle_brand', 'Honda', 'vehicle_model', 'BeAT', 'fuel_type', 'bensin', 'vehicle_plate', 'bm 1234 xx', 'vehicle_year', 2021, 'license_number', 'SIM-C-001', 'id_card_number', '1471000000000001')); exception when others then v_msg := sqlerrm; end;
  if v_msg not like 'PAYOUT_ACCOUNT_REQUIRED%' then raise exception '[GAGAL] register_driver langkah akhir tanpa rekening lolos: %', v_msg; end if;
  d := register_driver(jsonb_build_object('vehicle_type', 'motor', 'vehicle_brand', 'Honda', 'vehicle_model', 'BeAT', 'fuel_type', 'bensin', 'vehicle_plate', 'bm 1234 xx', 'vehicle_year', 2021, 'license_number', 'SIM-C-001', 'id_card_number', '1471000000000001',
    'payout_account', jsonb_build_object('channel', 'gopay', 'account_no', '081200000002', 'account_name', 'Budi Santoso')));
  if (select channel from bank_accounts where user_id = cust) <> 'gopay' then raise exception '[GAGAL] payout_account dalam payload register_driver tidak tersimpan'; end if;
  -- travel_partner_register tanpa rekening ditolak (dbox belum jadi mitra travel)
  perform set_config('antaraja.bypass', 'on', true); delete from bank_accounts where user_id = dbox; perform set_config('antaraja.bypass', 'off', true);
  perform set_config('request.jwt.claims', json_build_object('sub', dbox, 'role', 'authenticated')::text, true);
  v_msg := ''; begin perform travel_partner_register(jsonb_build_object('company_name', 'Dedi Travel', 'vehicle_model', 'HiAce', 'vehicle_plate', 'BM 1 TR', 'seats', 8, 'partner_type', 'agency', 'base_lat', 0.5071, 'base_lng', 101.4478)); exception when others then v_msg := sqlerrm; end;
  if v_msg not like 'PAYOUT_ACCOUNT_REQUIRED%' then raise exception '[GAGAL] travel_partner_register tanpa rekening lolos: %', v_msg; end if;
  perform set_config('antaraja.bypass', 'on', true);
  insert into bank_accounts (user_id, bank_name, account_no, holder, channel, bank_code, verified) values (dbox, 'Danamon', '5555666677', 'Dedi Box', 'bank', 'danamon', true);
  perform set_config('antaraja.bypass', 'off', true);
  -- setelan mati → penjaga lepas
  perform set_config('antaraja.bypass', 'on', true); update app_settings set value = 'false'::jsonb where key = 'payout_account_required'; delete from bank_accounts where user_id = cust; perform set_config('antaraja.bypass', 'off', true);
  perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
  d := register_driver(jsonb_build_object('vehicle_type', 'motor', 'vehicle_brand', 'Honda', 'vehicle_model', 'BeAT', 'fuel_type', 'bensin', 'vehicle_plate', 'bm 1234 xx', 'vehicle_year', 2021, 'id_card_number', '1471000000000001'));
  perform set_config('antaraja.bypass', 'on', true); update app_settings set value = 'true'::jsonb where key = 'payout_account_required'; perform set_config('antaraja.bypass', 'off', true);
  raise notice '[OK] 3. penjaga: driver online, merchant buka (update & RPC), register_driver langkah akhir, travel_partner_register → PAYOUT_ACCOUNT_REQUIRED tanpa rekening; lolos setelah rekening/payload payout_account; setelan mati → lepas';

  -- ===== 4. request_withdrawal argumen kosong → rekening tersimpan =====
  perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
  w := request_withdrawal(20000, null, null, null);
  if w.bank_name <> 'BCA' or w.bank_account <> '1234567890' or w.account_name <> 'Ahmad Fauzi' or w.status <> 'approved' or w.source <> 'request' then raise exception '[GAGAL] withdrawal rekening tersimpan: %', to_jsonb(w); end if;
  perform set_config('antaraja.bypass', 'on', true);
  update withdrawal_requests set status = 'rejected' where id = w.id;   -- bersihkan supaya sweep tidak terhalang (saldo sudah −20.000)
  perform wallet_apply(drv, 'refund', 20000, null, 'uji 0123');
  perform set_config('antaraja.bypass', 'off', true);
  perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
  v_msg := ''; begin perform request_withdrawal(20000, '', '', ''); exception when others then v_msg := sqlerrm; end;
  if v_msg not like 'PAYOUT_ACCOUNT_REQUIRED%' and v_msg not ilike '%mitra%' then raise exception '[GAGAL] withdrawal tanpa rekening: %', v_msg; end if;
  raise notice '[OK] 4. request_withdrawal(20000, null, null, null) → memakai rekening tersimpan BCA 1234567890 (approved); tanpa rekening ditolak';

  -- ===== 5. auto-sweep di payout_batch_auto =====
  -- keadaan: mer 300.000 verified (Mandiri); drv 100.000 verified (BCA), cadangan 30.000 → 70.000; dbox 40.000 verified → < min 50.000 (lewat);
  --          drv2 0 saldo (lewat); tambah: drv2 diberi 120.000 tapi rekening BRI belum verified → pending
  perform set_config('antaraja.bypass', 'on', true);
  perform pg_temp.reset_wallet(drv2, 120000);
  delete from fraud_flags where subject_id = drv2 and status = 'open';   -- flag gps_jump dari driver_set_online (skenario 3) bukan objek uji ini
  perform set_config('request.jwt.claims', '', true);
  perform set_config('antaraja.bypass', 'off', true);
  r := payout_batch_auto(t10);
  s := r->'sessions'->0; b := (s->>'batch_id')::uuid;
  if (r->>'new_sessions')::int <> 1 or s->>'status' <> 'dibuat' then raise exception '[GAGAL] sesi 09:00 tidak dibuat: %', r; end if;
  select count(*), coalesce(sum(amount), 0) into n, v_bal from withdrawal_requests where batch_id = b and source = 'auto_sweep';
  if n <> 2 or v_bal <> 370000 then raise exception '[GAGAL] sweep batch: % baris Rp% (harap 2 / 370.000): %', n, v_bal, (select jsonb_agg(jsonb_build_object('u', user_id, 'a', amount, 'st', status, 'src', source)) from withdrawal_requests where created_at > now() - interval '1 minute'); end if;
  if (select amount from withdrawal_requests where batch_id = b and user_id = drv) <> 70000 then raise exception '[GAGAL] cadangan driver tidak disisakan'; end if;
  if (select balance from wallets where user_id = drv) <> 30000 or (select balance from wallets where user_id = mer) <> 0 then raise exception '[GAGAL] saldo setelah sweep: drv=% mer=%', (select balance from wallets where user_id = drv), (select balance from wallets where user_id = mer); end if;
  select count(*) into n from withdrawal_requests where user_id = drv2 and source = 'auto_sweep' and status = 'pending' and batch_id is null and amount = 90000;
  if n <> 1 then raise exception '[GAGAL] driver belum terverifikasi harus pending: %', (select jsonb_agg(to_jsonb(x)) from withdrawal_requests x where x.user_id = drv2 and x.created_at > now() - interval '1 minute'); end if;
  if exists (select 1 from withdrawal_requests where user_id = dbox and source = 'auto_sweep') then raise exception '[GAGAL] saldo < min ikut disapu'; end if;
  if (select count(*) from notifications where user_id = mer and data->>'kind' = 'auto_sweep') < 1 then raise exception '[GAGAL] notifikasi sweep merchant'; end if;
  r := payout_batch_auto(t13);
  if (r->'sessions'->0->>'status') <> 'kosong' or exists (select 1 from withdrawal_requests where source = 'auto_sweep' and user_id in (drv, mer, drv2) and batch_id is distinct from b and status = 'approved') then raise exception '[GAGAL] sweep menggandakan: %', r; end if;
  perform set_config('antaraja.bypass', 'on', true);
  perform pg_temp.reset_wallet(mer, 500000);
  update app_settings set value = 'false'::jsonb where key = 'payout_auto_sweep_enabled';
  perform set_config('antaraja.bypass', 'off', true);
  r := payout_batch_auto(t17);
  if (r->'sessions'->0->>'status') <> 'kosong' then raise exception '[GAGAL] sakelar sweep mati tapi tetap menyapu: %', r; end if;
  perform set_config('antaraja.bypass', 'on', true); update app_settings set value = 'true'::jsonb where key = 'payout_auto_sweep_enabled'; perform set_config('antaraja.bypass', 'off', true);
  raise notice '[OK] 5. auto-sweep @09:00: merchant 300.000 + driver 70.000 (cadangan 30.000) approved → batch % (Rp370.000); driver belum verified (drv2, cadangan 30.000) → pending 90.000; < min dilewati; ulang tidak ganda; sakelar mati → kosong', left(b::text, 8);

  -- ===== 6. CSV BCA: e-wallet & Danamon =====
  perform set_config('antaraja.bypass', 'on', true);
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  update bank_accounts set verified = true where user_id = drv2;
  update withdrawal_requests set status = 'approved', reviewed_at = now() where user_id = drv2 and source = 'auto_sweep' and status = 'pending';
  update withdrawal_requests set bank_name = 'DANA', bank_account = '081234567890' where user_id = drv2 and source = 'auto_sweep';
  perform pg_temp.reset_wallet(dbox, 60000);
  perform set_config('antaraja.bypass', 'off', true);
  perform set_config('request.jwt.claims', json_build_object('sub', dbox, 'role', 'authenticated')::text, true);
  w := request_withdrawal(60000, null, null, null);
  if w.status <> 'approved' or w.bank_name <> 'Danamon' then raise exception '[GAGAL] withdrawal Danamon: %', to_jsonb(w); end if;
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  r := admin_payout_batch_create_now('uji 0123 e-wallet');
  csv := admin_payout_batch_export_bca((r->'session'->>'batch_id')::uuid);
  lines := regexp_split_to_array(csv, E'\r\n');
  if array_length(lines, 1) <> 3 then raise exception '[GAGAL] CSV baris: %', csv; end if;
  if not exists (select 1 from unnest(lines) l where l like '081234567890,90000,Rina%,DANA') then raise exception '[GAGAL] baris DANA: %', csv; end if;
  if not exists (select 1 from unnest(lines) l where l like '5555666677,60000,Dedi Box,%,011') then raise exception '[GAGAL] baris Danamon harus 011: %', csv; end if;
  raise notice '[OK] 6. CSV BCA: DANA → Kode Bank DANA; Danamon → 011 (alias terpanjang menang)';

  -- ===== 7. provider api: job antre; dispatch tanpa URL → skipped =====
  perform set_config('antaraja.bypass', 'on', true);
  update app_settings set value = '"api"'::jsonb where key = 'payout_provider';
  perform pg_temp.reset_wallet(mer, 500000);
  delete from payout_sessions where session_date = v_today;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('antaraja.bypass', 'off', true);
  r := payout_batch_auto(t10);
  b := (r->'sessions'->0->>'batch_id')::uuid;
  if b is null then raise exception '[GAGAL] batch api tidak dibuat: %', r; end if;
  select to_jsonb(x) into j from payout_provider_jobs x where batch_id = b;
  if j is null or j->>'status' <> 'queued' or jsonb_array_length(j->'request'->'items') <> 1 or (j->'request'->'items'->0->>'amount')::bigint <> 500000 or j->'request'->'items'->0->>'bank_code' <> '008' then raise exception '[GAGAL] job provider: %', j; end if;
  r := payout_provider_dispatch();
  if not coalesce((r->>'skipped')::boolean, false) then raise exception '[GAGAL] dispatch tanpa URL harus skipped: %', r; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  select count(*) into n from admin_payout_provider_jobs('queued');
  if n <> 1 then raise exception '[GAGAL] admin_payout_provider_jobs: %', n; end if;
  perform set_config('antaraja.bypass', 'on', true); update app_settings set value = '"manual"'::jsonb where key = 'payout_provider'; perform set_config('antaraja.bypass', 'off', true);
  if payout_provider_enqueue(b) is not null then raise exception '[GAGAL] provider manual tidak boleh antre'; end if;
  raise notice '[OK] 7. payout_provider=api → payout_provider_jobs queued (1 item Rp500.000, kode 008); dispatch tanpa URL → skipped; manual → tidak antre';

  -- ===== 8. admin =====
  select count(*) into n from admin_partner_payout_accounts('Mak Syukur');
  if n <> 1 then raise exception '[GAGAL] admin_partner_payout_accounts: %', n; end if;
  select id into acc_id from bank_accounts where user_id = mer;
  perform set_config('antaraja.bypass', 'on', true); update bank_accounts set verified = false where id = acc_id; perform set_config('antaraja.bypass', 'off', true);
  select count(*) into n from notifications where user_id = mer and data->>'kind' = 'payout_account';
  r := admin_partner_payout_verify(acc_id, true, 'cocok dengan KTP');
  if not (r->>'verified')::boolean or (select count(*) from notifications where user_id = mer and data->>'kind' = 'payout_account') <> n + 1 then raise exception '[GAGAL] verify: %', r; end if;
  if (select count(*) from security_events where kind = 'payout.account_verify' and user_id = mer) < 1 then raise exception '[GAGAL] security_events verify'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
  v_msg := ''; begin perform admin_partner_payout_accounts(null); exception when others then v_msg := sqlerrm; end;
  if v_msg = '' then raise exception '[GAGAL] pelanggan bisa admin_partner_payout_accounts'; end if;
  v_msg := ''; begin perform admin_partner_payout_verify(acc_id, false, null); exception when others then v_msg := sqlerrm; end;
  if v_msg = '' then raise exception '[GAGAL] pelanggan bisa verify'; end if;
  raise notice '[OK] 8. admin: daftar rekening (cari nama) 1 baris; verify → verified + notifikasi + security_events; non-admin ditolak';
  raise notice '[OK] SELESAI_PAYOUT_ACCOUNTS_0123';
end $$;
rollback;
