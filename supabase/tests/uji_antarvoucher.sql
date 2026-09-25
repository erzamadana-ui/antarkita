-- Uji AntarVoucher (migrasi 0112): rebrand, rekening resmi (placeholder → verifikasi Finance+Legal),
-- pembelian via transfer + kode unik, pencocokan mutasi bank, maker-checker, anti kredit ganda, salah nominal,
-- transfer ganda, kedaluwarsa, batal, sengketa, refund, saldo tidak cukup, ledger append-only, float cap,
-- rekonsiliasi, RLS, top up lama berbasis screenshot DIBLOKIR.
-- Satu transaksi, di-ROLLBACK (RAISE 'SIMULASI_SELESAI'). Lokal: scripts/db-lokal.sh test supabase/tests/uji_antarvoucher.sql
-- Kode baris: S<nomor> OK|BUG (penghitung db-lokal.sh).

create or replace function pg_temp.av_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', case when p_uid is null then '' else json_build_object('sub', p_uid, 'role', 'authenticated')::text end, true);
$$;
create or replace function pg_temp.av_saldo(p_user uuid) returns bigint language sql as $$
  select coalesce((select balance from wallets where user_id = p_user), 0);
$$;
create or replace function pg_temp.av_admin(p_role text) returns uuid language plpgsql as $$
declare u uuid := gen_random_uuid(); mail text := 'uji.av.' || p_role || '.' || left(u::text, 8) || '@antaraja.id';
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values ('00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated', mail, extensions.crypt('rahasia123', extensions.gen_salt('bf')), now(), now(), now(),
          '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('full_name', 'Admin ' || p_role, 'phone', '+6282' || (floor(random() * 1e9))::bigint, 'email', mail));
  perform pg_temp.av_as(null);
  perform set_config('antaraja.bypass', 'on', true);
  update profiles set role = 'admin' where id = u;
  perform set_config('antaraja.bypass', 'off', true);
  update profiles set admin_role = p_role where id = u;
  insert into admin_security (user_id, pin_hash) values (u, extensions.crypt('123456', extensions.gen_salt('bf')));
  perform pg_temp.av_as(u);
  perform admin_unlock('123456');
  return u;
end $$;
create or replace function pg_temp.av_customer() returns uuid language plpgsql as $$
declare u uuid := gen_random_uuid(); mail text := 'uji.av.cust.' || left(u::text, 8) || '@antaraja.id';
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values ('00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated', mail, extensions.crypt('rahasia123', extensions.gen_salt('bf')), now(), now(), now(),
          '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('full_name', 'Pelanggan AV', 'phone', '+6283' || (floor(random() * 1e9))::bigint, 'email', mail));
  return u;
end $$;

do $sim$
declare
  log text := '';
  adm uuid := 'a0000000-0000-4000-8000-000000000001';
  cust uuid; cust2 uuid;
  finA uuid; finB uuid; legal uuid; vw uuid; cs uuid;
  bri uuid; bni uuid;
  r jsonb; r2 jsonb; r3 jsonb; ok boolean; msg text; msg2 text; n int; n2 int; b0 bigint; b1 bigint;
  p1 jsonb; p2 jsonb; p3 jsonb; p4 jsonb; m1 jsonb; m2 jsonb; m3 jsonb;
  tp topup_requests; wt wallet_transactions;
  v_entity text;
begin
  -- ===== V0 persiapan =====
  begin
    perform pg_temp.av_as(adm);
    perform admin_unlock('123456');
    perform admin_set_antarpay_enabled(true);
    finA := pg_temp.av_admin('finance'); finB := pg_temp.av_admin('finance'); legal := pg_temp.av_admin('superadmin');
    vw := pg_temp.av_admin('viewer'); cs := pg_temp.av_admin('cs');
    cust := pg_temp.av_customer(); cust2 := pg_temp.av_customer();
    select id into bri from company_bank_accounts where bank_code = 'bri';
    select id into bni from company_bank_accounts where bank_code = 'bni';
    log := log || format('S0 %s persiapan: 5 rekening placeholder=%s, admin finance×2/legal/viewer/cs, pelanggan baru saldo=%s',
      case when (select count(*) from company_bank_accounts where is_placeholder and account_no is null) = 5 and bri is not null then 'OK' else 'BUG' end,
      (select count(*) from company_bank_accounts where is_placeholder), pg_temp.av_saldo(cust)) || E'\n';
  exception when others then log := log || 'S0 BUG persiapan: ' || sqlerrm || E'\n'; end;

  -- ===== V1 rebrand & kompatibilitas nama lama =====
  begin
    select count(*) into n from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.prosrc like '%AntarPay%' and p.proname not like '\_%';
    ok := payment_channel_label('antarpay') = 'AntarVoucher (saldo)' and antarvoucher_enabled() = antarpay_enabled()
          and to_regprocedure('public.admin_set_antarpay_enabled(boolean)') is not null and to_regclass('public.wallets') is not null
          and (select value->>'number' from app_settings where key = 'bank_account') = '-' and n = 0;
    log := log || format('S1 %s rebrand: label=%s, alias antarpay_enabled tetap, fungsi berteks "AntarPay"=%s, rekening lama dinetralkan=%s',
      case when ok then 'OK' else 'BUG' end, payment_channel_label('antarpay'), n, (select value->>'name' from app_settings where key = 'bank_account')) || E'\n';
  exception when others then log := log || 'S1 BUG rebrand: ' || sqlerrm || E'\n'; end;

  -- ===== V2 feature flag default OFF & rekening belum siap =====
  begin
    perform pg_temp.av_as(cust);
    msg := ''; begin r := voucher_purchase_create(100000, 'bri', null); exception when others then msg := sqlerrm; end;
    r2 := voucher_status_public();
    perform pg_temp.av_as(adm);
    msg2 := ''; begin r := admin_set_antarvoucher_purchase_enabled(true); exception when others then msg2 := sqlerrm; end;
    ok := msg like 'VOUCHER_PURCHASE_DISABLED%' and msg2 like 'VOUCHER_BANK_NOT_READY%' and not (r2->>'purchase_enabled')::boolean and (r2->>'banks_ready')::int = 0;
    perform pg_temp.av_as(cust);
    select count(*) into n from voucher_bank_accounts_public();
    log := log || format('S2 %s flag default mati: beli → %s; aktifkan tanpa rekening terverifikasi → %s; rekening publik=%s',
      case when ok and n = 0 then 'OK' else 'BUG' end, left(msg, 40), left(msg2, 40), n) || E'\n';
  exception when others then log := log || 'S2 BUG flag: ' || sqlerrm || E'\n'; end;

  -- ===== V3 rekening: validasi nomor, nama badan usaha, verifikasi Finance ≠ Legal =====
  begin
    perform pg_temp.av_as(adm);
    msg := ''; begin r := admin_voucher_bank_upsert(jsonb_build_object('id', bri, 'account_no', '12ab')); exception when others then msg := sqlerrm; end;
    r := admin_voucher_bank_upsert(jsonb_build_object('id', bri, 'account_no', '0000111122223333', 'account_name', 'Erza Pradipta Madana', 'active', true));
    perform pg_temp.av_as(finA); r2 := admin_voucher_bank_verify(bri, 'finance');
    msg2 := ''; begin r2 := admin_voucher_bank_verify(bri, 'legal'); exception when others then msg2 := sqlerrm; end;
    perform pg_temp.av_as(legal); r2 := admin_voucher_bank_verify(bri, 'legal');
    ok := msg like '%8–20 digit%' and msg2 like 'MAKER_CHECKER%' and not (r2->>'public_ok')::boolean;   -- nama pribadi → tidak tampil
    -- nama diganti ke badan usaha resmi → verifikasi batal, harus ulang
    perform pg_temp.av_as(adm);
    r := admin_voucher_bank_upsert(jsonb_build_object('id', bri, 'account_name', 'PT Antar Kita Indonesia'));
    b0 := (select count(*) from company_bank_accounts where id = bri and finance_verified_at is null and legal_verified_at is null);
    perform pg_temp.av_as(finA); perform admin_voucher_bank_verify(bri, 'finance');
    perform pg_temp.av_as(legal); r2 := admin_voucher_bank_verify(bri, 'legal');
    perform pg_temp.av_as(vw);
    msg := ''; begin perform admin_voucher_bank_verify(bni, 'finance'); exception when others then msg := sqlerrm; end;
    log := log || format('S3 %s rekening: nomor huruf ditolak; nama pribadi → public_ok=false; ganti nama → verifikasi direset=%s; Finance+Legal → public_ok=%s; viewer verifikasi → %s',
      case when ok and b0 = 1 and (r2->>'public_ok')::boolean and msg like 'ADMIN_FORBIDDEN%' then 'OK' else 'BUG' end, b0, r2->>'public_ok', left(msg, 30)) || E'\n';
  exception when others then log := log || 'S3 BUG rekening: ' || sqlerrm || E'\n'; end;

  -- ===== V4 aktifkan pembelian (superadmin + PIN) =====
  begin
    perform pg_temp.av_as(finA);
    msg := ''; begin r := admin_set_antarvoucher_purchase_enabled(true); exception when others then msg := sqlerrm; end;
    perform pg_temp.av_as(adm);
    r := admin_set_antarvoucher_purchase_enabled(true);
    perform pg_temp.av_as(cust);
    r2 := voucher_status_public();
    select count(*) into n from voucher_bank_accounts_public();
    log := log || format('S4 %s aktifkan pembelian: finance → %s; superadmin → %s; publik purchase_enabled=%s, rekening tampil=%s (hanya BRI terverifikasi)',
      case when msg like 'ADMIN_FORBIDDEN%' and (r2->>'purchase_enabled')::boolean and n = 1 then 'OK' else 'BUG' end, left(msg, 30), r->>'antarvoucher_purchase_enabled', r2->>'purchase_enabled', n) || E'\n';
  exception when others then log := log || 'S4 BUG aktifkan: ' || sqlerrm || E'\n'; end;

  -- ===== V5 buat pembelian: validasi nominal, rekening placeholder ditolak, kode unik, idempoten =====
  begin
    perform pg_temp.av_as(cust);
    msg := ''; begin r := voucher_purchase_create(5000, 'bri', null); exception when others then msg := sqlerrm; end;
    msg2 := ''; begin r := voucher_purchase_create(100500, 'bri', null); exception when others then msg2 := sqlerrm; end;
    ok := msg like 'VOUCHER_NOMINAL_INVALID%' and msg2 like 'VOUCHER_NOMINAL_INVALID%';
    msg := ''; begin r := voucher_purchase_create(100000, 'bni', null); exception when others then msg := sqlerrm; end;
    ok := ok and msg like 'VOUCHER_BANK_NOT_READY%';
    p1 := voucher_purchase_create(100000, 'bri', 'idem-av-1');
    r := voucher_purchase_create(100000, 'bri', 'idem-av-1');
    ok := ok and (r->>'id') = (p1->>'id') and (r->>'idempotent')::boolean and (p1->>'reference') like 'AKV-%'
          and (p1->>'transfer_amount')::bigint = 100000 + (p1->>'unique_code')::int and (p1->>'unique_code')::int between 1 and 999
          and (p1->>'account_no') = '0000111122223333' and (p1->>'status') = 'awaiting_transfer'
          and (p1->>'expires_at')::timestamptz between now() + interval '23 hours' and now() + interval '25 hours';
    log := log || format('S5 %s buat pembelian: nominal 5.000 & 100.500 ditolak; BNI placeholder ditolak; %s transfer Rp%s (kode unik %s); ulang kunci sama → id sama=%s',
      case when ok then 'OK' else 'BUG' end, p1->>'reference', p1->>'transfer_amount', p1->>'unique_code', (r->>'id') = (p1->>'id')) || E'\n';
  exception when others then log := log || 'S5 BUG buat: ' || sqlerrm || E'\n'; end;

  -- ===== V6 batas pembelian terbuka per pengguna =====
  begin
    perform pg_temp.av_as(cust);
    p2 := voucher_purchase_create(50000, 'bri', 'idem-av-2');
    msg := ''; begin r := voucher_purchase_create(70000, 'bri', 'idem-av-3'); exception when others then msg := sqlerrm; end;
    log := log || format('S6 %s pembelian terbuka ke-3 → %s', case when msg like 'VOUCHER_TOO_MANY_OPEN%' then 'OK' else 'BUG' end, left(msg, 40)) || E'\n';
  exception when others then log := log || 'S6 BUG batas: ' || sqlerrm || E'\n'; end;

  -- ===== V7 "sudah transfer" + bukti TIDAK menambah saldo =====
  begin
    perform pg_temp.av_as(cust);
    b0 := pg_temp.av_saldo(cust);
    r := voucher_purchase_mark_sent((p1->>'id')::uuid, 'Budi Pengirim', 'BRI');
    log := log || format('S7 %s tandai sudah transfer: status=%s, saldo tetap %s → %s', case when r->>'status' = 'submitted' and pg_temp.av_saldo(cust) = b0 then 'OK' else 'BUG' end,
      r->>'status', b0, pg_temp.av_saldo(cust)) || E'\n';
  exception when others then log := log || 'S7 BUG tandai: ' || sqlerrm || E'\n'; end;

  -- ===== V8 jalur lama top up + screenshot: persetujuan DIBLOKIR, konversi ke voucher =====
  begin
    perform pg_temp.av_as(cust2);
    tp := request_topup(150000, 'bank_transfer', 'proofs/x.jpg', 'screenshot');
    perform pg_temp.av_as(adm);
    msg := ''; begin perform admin_review_topup(tp.id, true, 'bukti oke'); exception when others then msg := sqlerrm; end;
    b0 := pg_temp.av_saldo(cust2);
    r := admin_topup_convert_to_voucher(tp.id);
    ok := msg like 'TOPUP_REQUIRE_BANK_MATCH%' and b0 = 0 and r->>'status' = 'submitted' and (r->>'transfer_amount')::bigint = 150000
          and (select status::text from topup_requests where id = tp.id) = 'rejected';
    p4 := r;
    log := log || format('S8 %s top up lama berbukti screenshot: setujui → %s; saldo=%s; dikonversi ke %s (menunggu mutasi bank)',
      case when ok then 'OK' else 'BUG' end, left(msg, 40), b0, r->>'reference') || E'\n';
  exception when others then log := log || 'S8 BUG top up lama: ' || sqlerrm || E'\n'; end;

  -- ===== V9 mutasi bank → pencocokan otomatis; mutasi yang sama ditolak (anti kredit ganda) =====
  begin
    perform pg_temp.av_as(finA);
    m1 := admin_voucher_mutation_add(bri, 'BRI-MUT-0001', (p1->>'transfer_amount')::bigint, now(), 'BUDI PENGIRIM', null);
    msg := ''; begin m2 := admin_voucher_mutation_add(bri, 'BRI-MUT-0001', (p1->>'transfer_amount')::bigint, now(), 'BUDI PENGIRIM', null); exception when others then msg := sqlerrm; end;
    select to_jsonb(v) into r from voucher_purchases v where id = (p1->>'id')::uuid;
    log := log || format('S9 %s mutasi Rp%s → cocok otomatis (kandidat=%s) status pembelian=%s; mutasi sama dicatat ulang → %s',
      case when (m1->>'auto_match_candidates')::int = 1 and r->>'status' = 'matched' and msg like 'MUTATION_DUPLICATE%' and pg_temp.av_saldo(cust) = 0 then 'OK' else 'BUG' end,
      m1->>'amount', m1->>'auto_match_candidates', r->>'status', left(msg, 30)) || E'\n';
  exception when others then log := log || 'S9 BUG mutasi: ' || sqlerrm || E'\n'; end;

  -- ===== V10 penerbitan: maker ≠ checker, RBAC, idempoten, ledger lengkap =====
  begin
    perform pg_temp.av_as(finA);
    msg := ''; begin r := admin_voucher_approve((p1->>'id')::uuid, null); exception when others then msg := sqlerrm; end;
    perform pg_temp.av_as(cs);
    msg2 := ''; begin r := admin_voucher_approve((p1->>'id')::uuid, null); exception when others then msg2 := sqlerrm; end;
    perform pg_temp.av_as(finB);
    r := admin_voucher_approve((p1->>'id')::uuid, 'cocok rekening koran');
    r2 := admin_voucher_approve((p1->>'id')::uuid, null);
    select * into wt from wallet_transactions where idempotency_key = 'voucher:' || (p1->>'id');
    select count(*) into n from wallet_transactions where user_id = cust and type = 'topup';
    ok := msg like 'MAKER_CHECKER%' and msg2 like 'ADMIN_FORBIDDEN%' and r->>'status' = 'issued' and (r2->>'idempotent')::boolean and n = 1
          and pg_temp.av_saldo(cust) = (p1->>'transfer_amount')::bigint
          and wt.balance_before = 0 and wt.balance_after = (p1->>'transfer_amount')::bigint and wt.bank_ref = 'BRI-MUT-0001'
          and wt.approved_by = finB and wt.source = 'voucher_purchase' and wt.ref = p1->>'reference';
    log := log || format('S10 %s terbit: pencocok sendiri → %s; CS → %s; finance lain → %s saldo %s; ulang → idempoten, mutasi topup=%s; ledger saldo %s→%s bank_ref=%s approver=finB',
      case when ok then 'OK' else 'BUG' end, left(msg, 20), left(msg2, 20), r->>'status', pg_temp.av_saldo(cust), n, wt.balance_before, wt.balance_after, wt.bank_ref) || E'\n';
  exception when others then log := log || 'S10 BUG terbit: ' || sqlerrm || E'\n'; end;

  -- ===== V11 salah nominal: tidak cocok otomatis → cocok manual (amount_mismatch) → terbit sebesar dana diterima =====
  begin
    perform pg_temp.av_as(finA);
    m2 := admin_voucher_mutation_add(bri, 'BRI-MUT-0002', (p2->>'transfer_amount')::bigint - 7, now(), 'BUDI', 'kurang 7 rupiah');
    r := admin_voucher_match((p2->>'id')::uuid, (m2->>'id')::uuid, 'dicocokkan manual (berita transfer AKV sesuai)');
    b0 := pg_temp.av_saldo(cust);
    perform pg_temp.av_as(finB);
    r2 := admin_voucher_approve((p2->>'id')::uuid, null);
    log := log || format('S11 %s salah nominal: kandidat otomatis=%s; manual → %s; terbit Rp%s (diterima), saldo +%s',
      case when (m2->>'auto_match_candidates')::int = 0 and r->>'status' = 'amount_mismatch' and (r2->>'issued_amount')::bigint = (m2->>'amount')::bigint
                and pg_temp.av_saldo(cust) - b0 = (m2->>'amount')::bigint then 'OK' else 'BUG' end,
      m2->>'auto_match_candidates', r->>'status', r2->>'issued_amount', pg_temp.av_saldo(cust) - b0) || E'\n';
  exception when others then log := log || 'S11 BUG salah nominal: ' || sqlerrm || E'\n'; end;

  -- ===== V12 transfer ganda: mutasi kedua untuk pembelian yang sudah terbit → tidak cocok → dikembalikan =====
  begin
    perform pg_temp.av_as(finA);
    b0 := pg_temp.av_saldo(cust);
    m3 := admin_voucher_mutation_add(bri, 'BRI-MUT-0003', (p1->>'transfer_amount')::bigint, now(), 'BUDI', 'transfer ganda');
    msg := ''; begin r := admin_voucher_match((p1->>'id')::uuid, (m3->>'id')::uuid, null); exception when others then msg := sqlerrm; end;
    r := admin_voucher_mutation_refund((m3->>'id')::uuid, 'Transfer ganda untuk ' || (p1->>'reference'));
    msg2 := ''; begin perform pg_temp.av_as(finA); r2 := admin_voucher_mutation_refund_done((m3->>'id')::uuid, ''); exception when others then msg2 := sqlerrm; end;
    r2 := admin_voucher_mutation_refund_done((m3->>'id')::uuid, 'BRI-OUT-9001');
    log := log || format('S12 %s transfer ganda: kandidat=%s; cocokkan ke pembelian terbit → %s; refund → %s → %s (ref %s); saldo tidak bertambah (%s→%s)',
      case when (m3->>'auto_match_candidates')::int = 0 and msg like 'VOUCHER_STATE%' and r->>'status' = 'refund_pending' and r2->>'status' = 'refunded'
                and msg2 like 'Referensi transfer%' and pg_temp.av_saldo(cust) = b0 then 'OK' else 'BUG' end,
      m3->>'auto_match_candidates', left(msg, 25), r->>'status', r2->>'status', r2->>'refund_bank_ref', b0, pg_temp.av_saldo(cust)) || E'\n';
  exception when others then log := log || 'S12 BUG transfer ganda: ' || sqlerrm || E'\n'; end;

  -- ===== V13 kedaluwarsa + transfer terlambat (≤7 hari) tetap dapat dicocokkan =====
  begin
    perform pg_temp.av_as(cust);
    p3 := voucher_purchase_create(30000, 'bri', 'idem-av-4');
    update voucher_purchases set expires_at = now() - interval '1 minute' where id = (p3->>'id')::uuid;
    n := voucher_expire_due();
    msg := ''; begin r := voucher_purchase_mark_sent((p3->>'id')::uuid, 'x', 'y'); exception when others then msg := sqlerrm; end;
    perform pg_temp.av_as(finA);
    m1 := admin_voucher_mutation_add(bri, 'BRI-MUT-0004', (p3->>'transfer_amount')::bigint, now(), 'BUDI', 'terlambat');
    select to_jsonb(v) into r from voucher_purchases v where id = (p3->>'id')::uuid;
    log := log || format('S13 %s kedaluwarsa: job=%s baris; tandai kirim → %s; transfer terlambat → cocok otomatis status=%s',
      case when n >= 1 and msg like 'VOUCHER_STATE%' and r->>'status' = 'matched' then 'OK' else 'BUG' end, n, left(msg, 25), r->>'status') || E'\n';
  exception when others then log := log || 'S13 BUG kedaluwarsa: ' || sqlerrm || E'\n'; end;

  -- ===== V14 tolak pembelian tercocok → dana wajib dikembalikan; batal & sengketa oleh pengguna =====
  begin
    perform pg_temp.av_as(finB);
    r := admin_voucher_reject((p3->>'id')::uuid, 'Pengirim minta batal');
    select status into msg2 from voucher_bank_mutations where id = (m1->>'id')::uuid;
    perform pg_temp.av_as(cust2);
    p2 := voucher_purchase_create(40000, 'bri', 'idem-av-5');
    r2 := voucher_purchase_cancel((p2->>'id')::uuid);
    p3 := voucher_purchase_create(45000, 'bri', 'idem-av-6');
    perform voucher_purchase_mark_sent((p3->>'id')::uuid, 'Sari', 'BRI');
    msg := ''; begin r3 := voucher_purchase_cancel((p3->>'id')::uuid); exception when others then msg := sqlerrm; end;
    r3 := voucher_purchase_dispute((p3->>'id')::uuid, 'Sudah transfer 2 jam tapi belum masuk');
    log := log || format('S14 %s tolak tercocok → mutasi %s; batal sebelum transfer → %s; batal sesudah transfer → %s; sengketa → %s',
      case when r->>'status' = 'rejected' and msg2 = 'refund_pending' and r2->>'status' = 'cancelled' and msg like 'VOUCHER_STATE%' and r3->>'status' = 'disputed' then 'OK' else 'BUG' end,
      msg2, r2->>'status', left(msg, 25), r3->>'status') || E'\n';
  exception when others then log := log || 'S14 BUG tolak/batal: ' || sqlerrm || E'\n'; end;

  -- ===== V15 refund voucher terbit (sisa saldo) — maker ≠ checker =====
  begin
    perform pg_temp.av_as(finA);
    r := admin_voucher_refund_request((p1->>'id')::uuid, 'Pelanggan menutup akun');
    msg := ''; begin r2 := admin_voucher_refund_execute((p1->>'id')::uuid); exception when others then msg := sqlerrm; end;
    b0 := pg_temp.av_saldo(cust);
    perform pg_temp.av_as(finB);
    r2 := admin_voucher_refund_execute((p1->>'id')::uuid);
    select * into wt from wallet_transactions where idempotency_key = 'voucher-refund:' || (p1->>'id');
    log := log || format('S15 %s refund voucher: pengaju eksekusi sendiri → %s; finance lain → %s Rp%s; saldo %s→%s; ledger refund_ref=%s approver≠maker=%s',
      case when msg like 'MAKER_CHECKER%' and r2->>'status' = 'refund_pending' and (r2->>'refund_amount')::bigint = (p1->>'transfer_amount')::bigint
                and pg_temp.av_saldo(cust) = b0 - (p1->>'transfer_amount')::bigint and wt.refund_ref like 'RFV-%' and wt.approved_by <> wt.created_by then 'OK' else 'BUG' end,
      left(msg, 20), r2->>'status', r2->>'refund_amount', b0, pg_temp.av_saldo(cust), wt.refund_ref, wt.approved_by <> wt.created_by) || E'\n';
  exception when others then log := log || 'S15 BUG refund: ' || sqlerrm || E'\n'; end;

  -- ===== V16 saldo tidak cukup: penyesuaian/penarikan tidak boleh membuat saldo pelanggan minus =====
  begin
    b0 := pg_temp.av_saldo(cust2);
    perform pg_temp.av_as(cust2);
    msg := ''; begin perform wallet_apply(cust2, 'payment', -(b0 + 1000), null, 'uji belanja lebih dari saldo'); exception when others then msg := sqlerrm; end;
    perform pg_temp.av_as(adm);
    msg2 := ''; begin perform wallet_apply(cust2, 'adjustment', -(b0 + 1), null, 'uji koreksi minus'); exception when others then msg2 := sqlerrm; end;
    log := log || format('S16 %s saldo tidak cukup: bayar sendiri → %s; koreksi minus → %s; saldo tetap %s',
      case when msg like 'SALDO_TIDAK_CUKUP%' and msg2 like 'SALDO_TIDAK_CUKUP%' and pg_temp.av_saldo(cust2) = b0 then 'OK' else 'BUG' end, left(msg, 20), left(msg2, 20), pg_temp.av_saldo(cust2)) || E'\n';
  exception when others then log := log || 'S16 BUG saldo minus: ' || sqlerrm || E'\n'; end;

  -- ===== V17 ledger append-only =====
  begin
    select * into wt from wallet_transactions where idempotency_key = 'voucher:' || (p1->>'id');
    msg := ''; begin update wallet_transactions set amount = amount + 1 where id = wt.id; exception when others then msg := sqlerrm; end;
    msg2 := ''; begin delete from wallet_transactions where id = wt.id; exception when others then msg2 := sqlerrm; end;
    update wallet_transactions set pg_fee = 0 where id = wt.id;   -- satu-satunya kolom yang boleh (biaya PG platform)
    select count(*) into n from wallet_transactions where balance_before is null or balance_before <> balance_after - amount;
    log := log || format('S17 %s append-only: ubah nominal → %s; hapus → %s; ubah pg_fee → boleh; baris saldo_awal tidak konsisten=%s',
      case when msg like 'LEDGER_APPEND_ONLY%' and msg2 like 'LEDGER_APPEND_ONLY%' and n = 0 then 'OK' else 'BUG' end, left(msg, 20), left(msg2, 20), n) || E'\n';
  exception when others then log := log || 'S17 BUG append-only: ' || sqlerrm || E'\n'; end;

  -- ===== V18 batas dana float =====
  begin
    perform pg_temp.av_as(finA);
    m1 := admin_voucher_mutation_add(bri, 'BRI-MUT-0005', 150000, now(), 'CUST2', 'konversi top up lama');
    update app_settings set value = '1000'::jsonb where key = 'voucher_float_cap';
    perform pg_temp.av_as(finB);
    msg := ''; begin r := admin_voucher_approve((p4->>'id')::uuid, null); exception when others then msg := sqlerrm; end;
    update app_settings set value = '900000000'::jsonb where key = 'voucher_float_cap';
    r := admin_voucher_approve((p4->>'id')::uuid, null);
    log := log || format('S18 %s float cap: batas Rp1.000 → %s; batas normal → %s (konversi top up lama selesai, saldo pelanggan2=%s)',
      case when msg like 'VOUCHER_FLOAT_CAP%' and r->>'status' = 'issued' and pg_temp.av_saldo(cust2) = 150000 then 'OK' else 'BUG' end, left(msg, 20), r->>'status', pg_temp.av_saldo(cust2)) || E'\n';
  exception when others then log := log || 'S18 BUG float: ' || sqlerrm || E'\n'; end;

  -- ===== V19 rekonsiliasi: rumus saldo per pemilik & voucher terbit = mutasi bank tercocok =====
  begin
    perform pg_temp.av_as(cust);
    r := wallet_statement(cust, current_date - 1, current_date + 1);
    perform pg_temp.av_as(cust2);
    msg := ''; begin r3 := wallet_statement(cust, current_date - 1, current_date + 1); exception when others then msg := sqlerrm; end;
    perform pg_temp.av_as(finA);
    r2 := admin_wallet_reconcile(current_date - 1, current_date + 1);
    log := log || format('S19 %s rekonsiliasi: pelanggan1 awal %s + beli %s − refund keluar %s = %s (ledger %s, selisih %s); orang lain → %s; global ok=%s, voucher terbit %s = mutasi %s',
      case when (r->>'selisih')::bigint = 0 and (r->>'saldo_akhir_ledger')::bigint = (r->>'saldo_dompet_sekarang')::bigint and msg like 'Tidak berhak%'
                and (r2->>'ok')::boolean and (r2->>'selisih_voucher_vs_bank')::bigint = 0 then 'OK' else 'BUG' end,
      r->>'saldo_awal', r->>'pembelian', r->>'refund_keluar', r->>'saldo_akhir_hitung', r->>'saldo_akhir_ledger', r->>'selisih', left(msg, 15),
      r2->>'ok', r2->>'voucher_terbit', r2->>'mutasi_bank_tercocok') || E'\n';
  exception when others then log := log || 'S19 BUG rekonsiliasi: ' || sqlerrm || E'\n'; end;

  -- ===== V20 RLS: pelanggan tidak bisa membaca rekening mentah, mutasi bank, atau pembelian orang lain =====
  begin
    perform pg_temp.av_as(cust2);
    set local role authenticated;
    msg := ''; begin select count(*) into n from company_bank_accounts; exception when others then msg := sqlerrm; end;
    select count(*) into n from voucher_bank_mutations;
    select count(*) into n2 from voucher_purchases where user_id = cust;
    reset role;
    perform pg_temp.av_as(null); set local role anon;
    msg2 := ''; begin perform voucher_bank_accounts_public(); exception when others then msg2 := sqlerrm; end;
    reset role;
    log := log || format('S20 %s RLS: rekening mentah → %s; mutasi terlihat=%s; pembelian orang lain terlihat=%s; anon daftar rekening → %s',
      case when msg like '%permission denied%' and n = 0 and n2 = 0 and msg2 like '%permission denied%' then 'OK' else 'BUG' end, left(msg, 30), n, n2, left(msg2, 30)) || E'\n';
  exception when others then reset role; log := log || 'S20 BUG RLS: ' || sqlerrm || E'\n'; end;

  -- ===== V21 invarian: dompet = Σ mutasi; setiap voucher terbit punya tepat satu mutasi & satu kredit =====
  begin
    select count(*) into n from wallets wl left join (select user_id, sum(amount) jml from wallet_transactions group by user_id) t on t.user_id = wl.user_id
     where wl.balance <> coalesce(t.jml, 0);
    select count(*) into n2 from voucher_purchases v where v.issued_amount is not null
       and (select count(*) from wallet_transactions t where t.idempotency_key = 'voucher:' || v.id) <> 1;
    log := log || format('S21 %s invarian: dompet ≠ Σ mutasi=%s; voucher terbit tanpa tepat 1 kredit=%s', case when n = 0 and n2 = 0 then 'OK' else 'BUG' end, n, n2) || E'\n';
  exception when others then log := log || 'S21 BUG invarian: ' || sqlerrm || E'\n'; end;

  raise exception using message = 'SIMULASI_SELESAI' || E'\n' || log;
end $sim$;
