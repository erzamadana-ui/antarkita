-- =====================================================================
-- uji_payout_0119.sql — Pencairan 3 sesi harian (migrasi 0119)
--   1. Setelan: cutoffs 09:00/13:00/17:00, payout_auto_batch_enabled, payout_min_amount; cadangan nilai lama '0119'
--   2. Fixture: driver (BCA) & merchant (Mandiri) request_withdrawal dengan rekening terverifikasi → auto-approved (≤ auto_payout_max)
--   3. payout_batch_auto(p_now = 10:00 WIB) → sesi 09:00 'dibuat' (2 transfer), 13:00 & 17:00 belum ada; notifikasi admin
--      (notifications + push_outbox source payout_session + security_events payout.session_ready); panggil ulang → tidak menggandakan
--   4. admin_payout_sessions(hari ini) → 3 baris: 09:00 dibuat, 13:00/17:00 menunggu; non-admin ditolak
--   5. CSV BCA: header + 2 baris; BCA → Kode Bank kosong, Mandiri → 008
--   6. settle semua ok → batch settled, sesi 'selesai' + closed_at
--   7. payout_min_amount: penarikan 20.000 (< 50.000) → sesi 13:00 'kosong'; sesi 17:00 (terakhir) mengambilnya → 'dibuat' 1 transfer
--   8. admin_payout_batch_create_now: kosong → PAYOUT_BATCH_EMPTY; ada antrean → sesi 'manual'; admin_payout_batch_create() lama tetap jalan
-- Pola (b): begin; do $$ … raise notice '[OK] …' $$; rollback;   Lokal: scripts/db-lokal.sh test supabase/tests/uji_payout_0119.sql
-- Mengandaikan akun seed.sql: a0..01 superadmin (PIN 123456), a0..03 driver approved, a0..05 pemilik merchant approved.
-- =====================================================================
begin;
do $$
declare
  adm  constant uuid := 'a0000000-0000-4000-8000-000000000001';
  cust constant uuid := 'a0000000-0000-4000-8000-000000000002';
  drv  constant uuid := 'a0000000-0000-4000-8000-000000000003';
  mer  constant uuid := 'a0000000-0000-4000-8000-000000000005';
  v_today date := (now() at time zone 'Asia/Jakarta')::date;
  t10 timestamptz; t13 timestamptz; t17 timestamptz;
  w1 withdrawal_requests; w2 withdrawal_requests; w3 withdrawal_requests; r jsonb; r2 jsonb; s jsonb; n int; n2 int; n3 int; v_msg text;
  b uuid; csv text; lines text[]; pb payout_batches;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  r := admin_unlock('123456');
  if not coalesce((r->>'ok')::boolean, false) then raise exception '[GAGAL] admin_unlock seed gagal: %', r; end if;
  t10 := (v_today + time '10:00') at time zone 'Asia/Jakarta';
  t13 := (v_today + time '13:05') at time zone 'Asia/Jakarta';
  t17 := (v_today + time '17:05') at time zone 'Asia/Jakarta';

  -- ===== persiapan: antrean lama dibersihkan (masuk batch pembersihan — ikut ROLLBACK), sesi hari ini dikosongkan, token push admin =====
  perform set_config('antaraja.bypass', 'on', true);
  perform payout_batch_create_internal(null, 'pembersihan uji 0119', 0);
  delete from payout_sessions where session_date = v_today;
  delete from fraud_flags where subject_id in (drv, mer) and status = 'open';
  insert into push_tokens (user_id, token, platform, app) values (adm, 'fcm-uji-0119-' || gen_random_uuid()::text, 'android', 'admin') on conflict do nothing;
  insert into bank_accounts (user_id, bank_name, account_no, holder, verified) values (drv, 'BCA', '1234567890', 'Ahmad Fauzi', true)
    on conflict (user_id) do update set bank_name = 'BCA', account_no = '1234567890', holder = 'Ahmad Fauzi', verified = true;
  insert into bank_accounts (user_id, bank_name, account_no, holder, verified) values (mer, 'Bank Mandiri', '9876543210', 'Mak Syukur', true)
    on conflict (user_id) do update set bank_name = 'Bank Mandiri', account_no = '9876543210', holder = 'Mak Syukur', verified = true;
  perform wallet_apply(mer, 'topup', 300000, null, 'saldo uji 0119');
  perform wallet_apply(drv, 'topup', 100000, null, 'saldo uji 0119');
  perform set_config('antaraja.bypass', 'off', true);

  -- ===== 1. setelan =====
  if payout_cutoffs() <> array['09:00', '13:00', '17:00'] then raise exception '[GAGAL] cutoffs: %', payout_cutoffs(); end if;
  if not coalesce((select lower(value #>> '{}') = 'true' from app_settings where key = 'payout_auto_batch_enabled'), false) then raise exception '[GAGAL] payout_auto_batch_enabled'; end if;
  if setting_num('payout_min_amount', 0) <> 50000 then raise exception '[GAGAL] payout_min_amount'; end if;
  if not exists (select 1 from _migration_backup_settings where version = '0119' and key = 'payout_batch_cutoffs') then raise exception '[GAGAL] cadangan cutoffs lama'; end if;
  if not exists (select 1 from app_setting_specs() where key in ('payout_auto_batch_enabled', 'payout_min_amount')) then raise exception '[GAGAL] app_setting_specs'; end if;
  raise notice '[OK] 1. setelan: cutoffs %, auto=true, min=50000, cadangan lama=%', payout_cutoffs(), (select value from _migration_backup_settings where version = '0119' and key = 'payout_batch_cutoffs');

  -- ===== 2. fixture: driver 60.000 (BCA) & merchant 100.000 (Mandiri) → auto-approved =====
  perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
  w1 := request_withdrawal(60000, 'BCA', '1234567890', 'Ahmad Fauzi');
  perform set_config('request.jwt.claims', json_build_object('sub', mer, 'role', 'authenticated')::text, true);
  w2 := request_withdrawal(100000, 'Bank Mandiri', '9876543210', 'Mak Syukur');
  if w1.status <> 'approved' or not w1.auto then raise exception '[GAGAL] driver tidak auto-approved: % %', w1.status, w1.review_note; end if;
  if w2.status <> 'approved' or not w2.auto then raise exception '[GAGAL] merchant tidak auto-approved: % %', w2.status, w2.review_note; end if;
  if w1.batch_id is not null or w2.batch_id is not null or w1.provider <> 'manual' then raise exception '[GAGAL] fixture batch/provider'; end if;
  raise notice '[OK] 2. fixture: driver Rp60.000 BCA & merchant Rp100.000 Mandiri auto-approved (provider manual, belum batch)';

  -- ===== 3. payout_batch_auto @10:00 → sesi 09:00 dibuat (2 transfer); 13:00/17:00 belum; notifikasi; idempoten =====
  perform set_config('request.jwt.claims', '', true);
  select count(*) into n from security_events where kind = 'payout.session_ready';
  select count(*) into n2 from push_outbox where user_id = adm and source = 'payout_session';
  select count(*) into n3 from notifications where user_id = adm and data->>'kind' = 'payout_session';
  r := payout_batch_auto(t10);
  if (r->>'new_sessions')::int <> 1 then raise exception '[GAGAL] auto @10:00 new_sessions=% (%)', r->>'new_sessions', r; end if;
  s := r->'sessions'->0;
  b := (s->>'batch_id')::uuid;
  if s->>'cutoff' <> '09:00' or s->>'status' <> 'dibuat' or (s->>'items')::int <> 2 or (s->>'total')::bigint <> 160000 or b is null then raise exception '[GAGAL] sesi 09:00: %', s; end if;
  if (select count(*) from withdrawal_requests where batch_id = b) <> 2 then raise exception '[GAGAL] batch tidak berisi 2 baris'; end if;
  if (select cutoff from payout_batches where id = b) <> 'Sesi 09:00 ' || to_char(v_today, 'DD-MM-YYYY') then raise exception '[GAGAL] label batch: %', (select cutoff from payout_batches where id = b); end if;
  if (select count(*) from security_events where kind = 'payout.session_ready') <> n + 1 then raise exception '[GAGAL] security_events payout.session_ready'; end if;
  if (select count(*) from push_outbox where user_id = adm and source = 'payout_session') <> n2 + 1 then raise exception '[GAGAL] push_outbox admin'; end if;
  if (select count(*) from notifications where user_id = adm and data->>'kind' = 'payout_session') <> n3 + 1 then raise exception '[GAGAL] notifications admin'; end if;
  r2 := payout_batch_auto(t10);
  if (r2->>'new_sessions')::int <> 0 or (select count(*) from payout_sessions where session_date = v_today) <> 1 or (select count(*) from payout_batches where cutoff like 'Sesi 09:00%' and created_at > now() - interval '1 minute') <> 1 then
    raise exception '[GAGAL] panggil ulang menggandakan: %', r2;
  end if;
  raise notice '[OK] 3. auto @10:00 → sesi 09:00 dibuat: 2 transfer Rp160.000 (batch %), notifikasi admin +1/+1/+1; panggil ulang → 0 sesi baru', left(b::text, 8);

  -- ===== 4. admin_payout_sessions: 3 baris; non-admin ditolak =====
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  select count(*), count(*) filter (where x->>'status' = 'menunggu'), count(*) filter (where x->>'cutoff' = '09:00' and x->>'status' = 'dibuat' and (x->>'items')::int = 2 and (x->>'settled_items')::int = 0)
    into n, n2, n3 from admin_payout_sessions(v_today) x;
  if n <> 3 or n2 <> 2 or n3 <> 1 then raise exception '[GAGAL] admin_payout_sessions: %/%/%', n, n2, n3; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
  begin perform admin_payout_sessions(v_today); raise exception '[GAGAL] pelanggan bisa admin_payout_sessions'; exception when others then v_msg := sqlerrm; end;
  if v_msg like '[GAGAL]%' then raise exception '%', v_msg; end if;
  begin perform admin_payout_batch_export_bca(b); raise exception '[GAGAL] pelanggan bisa ekspor'; exception when others then v_msg := sqlerrm; end;
  if v_msg like '[GAGAL]%' then raise exception '%', v_msg; end if;
  raise notice '[OK] 4. admin_payout_sessions: 3 sesi (09:00 dibuat 2 transfer, 13:00 & 17:00 menunggu); pelanggan ditolak';

  -- ===== 5. CSV BCA =====
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  csv := admin_payout_batch_export_bca(b);
  lines := regexp_split_to_array(csv, E'\r\n');
  if array_length(lines, 1) <> 3 or lines[1] <> 'No Rekening Tujuan,Nominal,Nama Penerima,Berita,Kode Bank' then raise exception '[GAGAL] CSV: %', csv; end if;
  if not (lines[2] = '1234567890,60000,Ahmad Fauzi,AntarKita ' || left(w1.id::text, 8) || ',' ) then raise exception '[GAGAL] baris BCA: %', lines[2]; end if;
  if not (lines[3] = '9876543210,100000,Mak Syukur,AntarKita ' || left(w2.id::text, 8) || ',008') then raise exception '[GAGAL] baris Mandiri: %', lines[3]; end if;
  if (select status from payout_batches where id = b) <> 'exported' then raise exception '[GAGAL] batch belum exported'; end if;
  select count(*) into n from admin_payout_batch_export(b);   -- ekspor lama tetap ada
  if n <> 2 then raise exception '[GAGAL] admin_payout_batch_export lama: % baris', n; end if;
  raise notice '[OK] 5. CSV BCA: header + 2 baris (BCA kode kosong, Mandiri 008); batch exported; ekspor lama 2 baris';

  -- ===== 6. settle → sesi selesai =====
  r := admin_payout_batch_settle(b, jsonb_build_array(jsonb_build_object('withdrawal_id', w1.id, 'bank_ref', 'BCA-0119-1', 'status', 'ok'),
                                                      jsonb_build_object('withdrawal_id', w2.id, 'bank_ref', 'BCA-0119-2', 'status', 'ok')));
  if r->'batch'->>'status' <> 'settled' or (r->>'ok')::int <> 2 then raise exception '[GAGAL] settle: %', r; end if;
  select x into s from admin_payout_sessions(v_today) x where x->>'cutoff' = '09:00';
  if s->>'status' <> 'selesai' or s->>'closed_at' is null or (s->>'settled_items')::int <> 2 then raise exception '[GAGAL] sesi belum selesai: %', s; end if;
  raise notice '[OK] 6. settle 2 ok → batch settled, sesi 09:00 selesai (settled_items=2, closed_at terisi)';

  -- ===== 7. payout_min_amount: 20.000 → 13:00 kosong; 17:00 (terakhir) mengambil → dibuat 1 =====
  perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
  w3 := request_withdrawal(20000, 'BCA', '1234567890', 'Ahmad Fauzi');
  if w3.status <> 'approved' then raise exception '[GAGAL] w3 tidak approved: %', w3.review_note; end if;
  perform set_config('request.jwt.claims', '', true);
  r := payout_batch_auto(t13);
  s := r->'sessions'->0;
  if (r->>'new_sessions')::int <> 1 or s->>'cutoff' <> '13:00' or s->>'status' <> 'kosong' then raise exception '[GAGAL] sesi 13:00 harus kosong (min 50.000): %', r; end if;
  r := payout_batch_auto(t17);
  s := r->'sessions'->0;
  if (r->>'new_sessions')::int <> 1 or s->>'cutoff' <> '17:00' or s->>'status' <> 'dibuat' or (s->>'items')::int <> 1 or (s->>'total')::bigint <> 20000 then raise exception '[GAGAL] sesi 17:00: %', r; end if;
  if (select batch_id from withdrawal_requests where id = w3.id) <> (s->>'batch_id')::uuid then raise exception '[GAGAL] w3 tidak masuk batch 17:00'; end if;
  raise notice '[OK] 7. Rp20.000 < payout_min_amount → sesi 13:00 kosong; sesi 17:00 (terakhir) dibuat 1 transfer Rp20.000';

  -- ===== 8. manual: kosong → PAYOUT_BATCH_EMPTY; ada antrean → sesi manual; admin_payout_batch_create lama =====
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  begin perform admin_payout_batch_create_now('uji'); raise exception '[GAGAL] create_now kosong lolos'; exception when others then v_msg := sqlerrm; end;
  if v_msg not like 'PAYOUT_BATCH_EMPTY%' then raise exception '[GAGAL] create_now kosong: %', v_msg; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', mer, 'role', 'authenticated')::text, true);
  w2 := request_withdrawal(50000, 'Bank Mandiri', '9876543210', 'Mak Syukur');
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  r := admin_payout_batch_create_now('Transfer susulan');
  if r->'session'->>'cutoff' <> 'manual' or r->'session'->>'status' <> 'dibuat' or (r->'session'->>'items')::int <> 1 or r->'batch'->>'cutoff' <> 'Transfer susulan' then raise exception '[GAGAL] create_now: %', r; end if;
  select count(*) into n from admin_payout_sessions(v_today) x where x->>'cutoff' = 'manual';
  if n <> 1 then raise exception '[GAGAL] sesi manual tidak tampil (%)', n; end if;
  begin pb := admin_payout_batch_create(); raise exception '[GAGAL] create lama kosong lolos'; exception when others then v_msg := sqlerrm; end;
  if v_msg not like 'PAYOUT_BATCH_EMPTY%' then raise exception '[GAGAL] create lama: %', v_msg; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
  w1 := request_withdrawal(20000, 'BCA', '1234567890', 'Ahmad Fauzi');
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  pb := admin_payout_batch_create();
  if pb.count <> 1 or pb.total <> 20000 or pb.status <> 'open' then raise exception '[GAGAL] admin_payout_batch_create lama: %', to_jsonb(pb); end if;
  raise notice '[OK] 8. create_now kosong → PAYOUT_BATCH_EMPTY; ada antrean → sesi manual 1 transfer; admin_payout_batch_create() lama tetap (1 transfer Rp20.000)';
  raise notice '[OK] SELESAI_PAYOUT_0119';
end $$;
rollback;
