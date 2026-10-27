-- =====================================================================
-- uji_push_0116.sql — Uji push dispatch tanpa service_role key (migrasi 0116)
--
-- Membuktikan:
--   1. Konfigurasi kosong → push_dispatch() {ok:false, error:'PUSH_CONFIG_KOSONG'} + security_events 'push.config_missing'
--      tepat 1 baris (pemanggilan kedua tidak menambah — batas 1×/jam). Antrean kosong → {ok:true, queued:0} tanpa event.
--   2. admin_set_push_dispatch(url, anon, secret): rahasia ke Vault (bila ada) — kolom dispatch_secret NULL, status
--      configured=true, balasan & audit_logs TIDAK memuat rahasia; rahasia < 16 karakter ditolak.
--   3. push_dispatch() memanggil net.http_post (stub lokal) dengan header apikey/Bearer = anon key, x-push-secret = rahasia;
--      baris outbox → 'sending', attempts+1.
--   4. Jalur cadangan tanpa Vault (GUC antarkita.push_vault_off=on): rahasia ke push_config.dispatch_secret dan dipakai.
--   5. admin_push_test(user): 1 baris 'Uji notifikasi AntarKita' + dispatch ok.
--   6. Non-admin & anon ditolak (RPC admin, push_dispatch); push_config tidak terbaca authenticated.
--   7. admin_set_push_config(url, key) lama → anon_key terisi, service_key tetap NULL.
--
-- Pola (b) db-lokal.sh: begin; do $$ … raise notice '[OK] …' $$; rollback;  → tidak mengubah data.
-- Lokal: scripts/db-lokal.sh test supabase/tests/uji_push_0116.sql
-- Mengandaikan akun seed.sql: a0..01 superadmin (PIN 123456), a0..02 pelanggan, a0..03 driver.
-- =====================================================================

begin;
do $$
declare
  adm  constant uuid := 'a0000000-0000-4000-8000-000000000001';
  cust constant uuid := 'a0000000-0000-4000-8000-000000000002';
  drv  constant uuid := 'a0000000-0000-4000-8000-000000000003';
  c_url    constant text := 'https://proyek.supabase.co/functions/v1/push-send';
  c_anon   constant text := 'eyJhbGciOiJIUzI1NiJ9.ANON-KEY-UJI-PUBLIK-0123456789.tandatangan';
  c_secret constant text := 'RAHASIA-PUSH-UJI-JANGAN-BOCOR-2026-abc';
  c_secret2 constant text := 'RAHASIA-CADANGAN-TABEL-0116-xyz';
  r jsonb; st jsonb; v_msg text; n int; n2 int; v_id bigint; v_id2 bigint; v_req bigint; v_row push_outbox; v_log net._lokal_http_log;
  v_vault boolean;
begin
  -- ===== persiapan: admin login + PIN; konfigurasi dikosongkan; event lama dibersihkan (semua di-ROLLBACK) =====
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  r := admin_unlock('123456');
  if not coalesce((r->>'ok')::boolean, false) then raise exception '[GAGAL] admin_unlock seed gagal: %', r; end if;
  delete from push_config;
  delete from security_events where kind = 'push.config_missing';
  delete from net._lokal_http_log;
  update push_outbox set status = 'sent', sent_at = now() where status in ('pending', 'sending');   -- antrean lama disingkirkan
  if to_regclass('vault.secrets') is not null then execute $q$delete from vault.secrets where name = 'push_dispatch_secret'$q$; end if;
  insert into push_tokens (user_id, token, platform, app) values (cust, 'fcm-token-uji-0116-' || gen_random_uuid()::text, 'android', 'customer')
    on conflict do nothing;
  v_vault := push_vault_available();
  raise notice '[OK] 0. persiapan: admin terbuka, push_config kosong, vault tersedia = %', v_vault;

  -- ===== 1a. antrean kosong + konfigurasi kosong → ok:true queued:0, tanpa event =====
  r := push_dispatch(10);
  if not ((r->>'ok')::boolean and (r->>'queued')::int = 0) then raise exception '[GAGAL] antrean kosong seharusnya {ok:true,queued:0}: %', r; end if;
  select count(*) into n from security_events where kind = 'push.config_missing';
  if n <> 0 then raise exception '[GAGAL] antrean kosong tidak boleh membuat security_events (ada %)', n; end if;
  raise notice '[OK] 1a. antrean kosong → {ok:true, queued:0} tanpa security_events';

  -- ===== 1b. ada antrean + konfigurasi kosong → ok:false PUSH_CONFIG_KOSONG + 1 security_events =====
  insert into push_outbox (user_id, title, body, data, source) values (cust, 'Uji 0116', 'konfigurasi kosong', '{}'::jsonb, 'notification') returning id into v_id;
  r := push_dispatch(10);
  if (r->>'ok')::boolean or r->>'error' <> 'PUSH_CONFIG_KOSONG' then raise exception '[GAGAL] konfigurasi kosong harus {ok:false,error:PUSH_CONFIG_KOSONG}: %', r; end if;
  if not (r->'missing' ? 'function_url' and r->'missing' ? 'anon_key' and r->'missing' ? 'push_dispatch_secret') then raise exception '[GAGAL] daftar missing tidak lengkap: %', r; end if;
  select count(*) into n from security_events where kind = 'push.config_missing';
  if n <> 1 then raise exception '[GAGAL] security_events push.config_missing harus 1 baris (ada %)', n; end if;
  select status, attempts into v_row.status, v_row.attempts from push_outbox where id = v_id;
  if v_row.status <> 'pending' or v_row.attempts <> 0 then raise exception '[GAGAL] baris antrean tidak boleh disentuh saat konfigurasi kosong (status %, attempts %)', v_row.status, v_row.attempts; end if;
  raise notice '[OK] 1b. konfigurasi kosong → {ok:false, error:PUSH_CONFIG_KOSONG, missing:%} + security_events 1 baris', r->'missing';

  -- ===== 1c. pemanggilan kedua dalam 1 jam → tetap ok:false, event TIDAK bertambah =====
  r := push_dispatch(10);
  if (r->>'ok')::boolean then raise exception '[GAGAL] pemanggilan kedua seharusnya tetap ok:false: %', r; end if;
  select count(*) into n from security_events where kind = 'push.config_missing';
  if n <> 1 then raise exception '[GAGAL] security_events membanjir: % baris', n; end if;
  st := admin_push_dispatch_status();
  if (st->>'configured')::boolean or (st->>'has_secret')::boolean or (st->>'outbox_pending')::int < 1 or coalesce(st->>'last_error', '') not like 'PUSH_CONFIG_KOSONG%' then
    raise exception '[GAGAL] admin_push_dispatch_status saat kosong salah: %', st;
  end if;
  raise notice '[OK] 1c. pemanggilan kedua tidak menambah event (batas 1×/jam); status: configured=false, last_error=%', st->>'last_error';

  -- ===== 2a. rahasia pendek ditolak =====
  begin
    perform admin_set_push_dispatch(c_url, c_anon, 'pendek');
    raise exception '[GAGAL] rahasia < 16 karakter diterima';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg like '[GAGAL]%' then raise; end if;
    if v_msg not like 'PUSH_SECRET_PENDEK%' then raise exception '[GAGAL] pesan penolakan rahasia pendek salah: %', v_msg; end if;
  end;
  raise notice '[OK] 2a. rahasia < 16 karakter ditolak (PUSH_SECRET_PENDEK)';

  -- ===== 2b. admin_set_push_dispatch → tersimpan; rahasia tidak bocor =====
  st := admin_set_push_dispatch(c_url, c_anon, c_secret);
  if not (st->>'configured')::boolean or not (st->>'has_secret')::boolean or st->>'url' <> c_url then raise exception '[GAGAL] status setelah set salah: %', st; end if;
  if position(c_secret in st::text) > 0 or position(c_anon in st::text) > 0 then raise exception '[GAGAL] status membocorkan rahasia/anon key'; end if;
  if v_vault then
    if st->>'secret_store' <> 'vault' then raise exception '[GAGAL] secret_store harus vault: %', st->>'secret_store'; end if;
    if (select dispatch_secret from push_config where id) is not null then raise exception '[GAGAL] rahasia masih tersalin di push_config.dispatch_secret'; end if;
    execute $q$select count(*) from vault.decrypted_secrets where name = 'push_dispatch_secret' and decrypted_secret = $1$q$ into n using c_secret;
    if n <> 1 then raise exception '[GAGAL] rahasia tidak ada di vault (% baris)', n; end if;
  else
    if st->>'secret_store' <> 'table' then raise exception '[GAGAL] tanpa vault secret_store harus table: %', st->>'secret_store'; end if;
  end if;
  if (select service_key from push_config where id) is not null then raise exception '[GAGAL] push_config.service_key terisi'; end if;
  if (select anon_key from push_config where id) <> c_anon then raise exception '[GAGAL] anon_key tidak tersimpan'; end if;
  select count(*) into n from audit_logs where action = 'admin.push_config' and (coalesce(detail::text, '') like '%' || c_secret || '%' or coalesce(summary, '') like '%' || c_secret || '%');
  if n > 0 then raise exception '[GAGAL] audit_logs memuat rahasia'; end if;
  select count(*) into n from audit_logs where action = 'admin.push_config' and (detail->>'secret_changed')::boolean;
  if n < 1 then raise exception '[GAGAL] audit_logs admin.push_config tidak tercatat'; end if;
  raise notice '[OK] 2b. admin_set_push_dispatch tersimpan (secret_store=%), rahasia tidak ada di balasan/audit_logs/push_config.service_key', st->>'secret_store';

  -- ===== 3. push_dispatch → net.http_post dengan header yang benar =====
  r := push_dispatch(10);
  if not (r->>'ok')::boolean or (r->>'queued')::int <> 1 then raise exception '[GAGAL] dispatch setelah konfigurasi harus ok (queued 1): %', r; end if;
  v_req := (r->>'request_id')::bigint;
  select * into v_log from net._lokal_http_log where id = v_req;
  if not found then raise exception '[GAGAL] net.http_post stub tidak tercatat (request_id %)', v_req; end if;
  if v_log.url <> c_url then raise exception '[GAGAL] URL salah: %', v_log.url; end if;
  if v_log.headers->>'x-push-secret' <> c_secret then raise exception '[GAGAL] header x-push-secret salah'; end if;
  if v_log.headers->>'apikey' <> c_anon or v_log.headers->>'Authorization' <> 'Bearer ' || c_anon then raise exception '[GAGAL] header apikey/Authorization bukan anon key: %', v_log.headers - 'x-push-secret'; end if;
  if not (v_log.body->'ids' @> to_jsonb(array[v_id])) then raise exception '[GAGAL] body ids tidak memuat %: %', v_id, v_log.body; end if;
  select * into v_row from push_outbox where id = v_id;
  if v_row.status <> 'sending' or v_row.attempts <> 1 then raise exception '[GAGAL] baris outbox harus sending/attempts=1 (status %, attempts %)', v_row.status, v_row.attempts; end if;
  st := admin_push_dispatch_status();
  if st->>'last_error' is not null or (st->>'last_request_id')::bigint <> v_req or st->>'last_dispatch_at' is null then raise exception '[GAGAL] status setelah dispatch salah: %', st; end if;
  raise notice '[OK] 3. push_dispatch → net.http_post(url, apikey+Bearer anon, x-push-secret) ids=%; outbox sending; status last_request_id=%', v_log.body->'ids', v_req;

  -- ===== 4. jalur cadangan tanpa Vault =====
  perform set_config('antarkita.push_vault_off', 'on', true);
  st := admin_set_push_dispatch(null, null, c_secret2);
  if st->>'secret_store' <> 'table' or not (st->>'configured')::boolean then raise exception '[GAGAL] jalur cadangan: %', st; end if;
  if (select dispatch_secret from push_config where id) <> c_secret2 then raise exception '[GAGAL] dispatch_secret cadangan tidak tersimpan'; end if;
  if (select function_url from push_config where id) <> c_url then raise exception '[GAGAL] parameter NULL mengubah function_url'; end if;
  insert into push_outbox (user_id, title, body, data, source) values (cust, 'Uji 0116 cadangan', null, '{}'::jsonb, 'notification') returning id into v_id2;
  r := push_dispatch(10);
  select * into v_log from net._lokal_http_log where id = (r->>'request_id')::bigint;
  if v_log.headers->>'x-push-secret' <> c_secret2 then raise exception '[GAGAL] jalur cadangan: x-push-secret bukan rahasia tabel'; end if;
  perform set_config('antarkita.push_vault_off', 'off', true);
  if v_vault and push_dispatch_secret_get() <> c_secret then raise exception '[GAGAL] setelah vault aktif kembali rahasia vault harus menang'; end if;
  raise notice '[OK] 4. tanpa Vault: rahasia ke push_config.dispatch_secret dan dipakai; NULL = tidak mengubah URL/anon key';

  -- ===== 5. admin_push_test =====
  r := admin_push_test(cust);
  if not (r->>'ok')::boolean or (r->>'tokens')::int < 1 or not (r->'dispatch'->>'ok')::boolean then raise exception '[GAGAL] admin_push_test: %', r; end if;
  select * into v_row from push_outbox where id = (r->>'outbox_id')::bigint;
  if v_row.title <> 'Uji notifikasi AntarKita' or v_row.user_id <> cust or v_row.status <> 'sending' or v_row.source <> 'push_test' then
    raise exception '[GAGAL] baris uji salah: % % % %', v_row.title, v_row.user_id, v_row.status, v_row.source;
  end if;
  select * into v_log from net._lokal_http_log where id = (r->'dispatch'->>'request_id')::bigint;
  if not (v_log.body->'ids' @> to_jsonb(array[v_row.id])) then raise exception '[GAGAL] baris uji tidak ikut dikirim: %', v_log.body; end if;
  r := admin_push_test(drv);   -- driver seed tanpa token → tetap antre, ada warning
  if r->>'warning' is null or (r->>'tokens')::int <> 0 then raise exception '[GAGAL] admin_push_test tanpa token harus memberi warning: %', r; end if;
  raise notice '[OK] 5. admin_push_test: baris "Uji notifikasi AntarKita" dikirim (outbox_id %), tanpa token → warning', v_row.id;

  -- ===== 6. non-admin & anon =====
  perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
  begin
    perform admin_set_push_dispatch(c_url, c_anon, c_secret);
    raise exception '[GAGAL] non-admin bisa admin_set_push_dispatch';
  exception when others then get stacked diagnostics v_msg = message_text; if v_msg like '[GAGAL]%' then raise; end if; end;
  begin
    perform admin_push_dispatch_status();
    raise exception '[GAGAL] non-admin bisa admin_push_dispatch_status';
  exception when others then get stacked diagnostics v_msg = message_text; if v_msg like '[GAGAL]%' then raise; end if; end;
  begin
    perform admin_push_test(cust);
    raise exception '[GAGAL] non-admin bisa admin_push_test';
  exception when others then get stacked diagnostics v_msg = message_text; if v_msg like '[GAGAL]%' then raise; end if; end;
  begin
    perform push_dispatch(10);
    raise exception '[GAGAL] non-admin bisa push_dispatch';
  exception when others then get stacked diagnostics v_msg = message_text; if v_msg like '[GAGAL]%' then raise; end if; end;
  if has_table_privilege('authenticated', 'public.push_config', 'SELECT') or has_table_privilege('anon', 'public.push_config', 'SELECT') then
    raise exception '[GAGAL] push_config terbaca anon/authenticated';
  end if;
  if has_function_privilege('authenticated', 'public.push_dispatch_secret_get()', 'EXECUTE') or has_function_privilege('authenticated', 'public.push_dispatch_secret_set(text)', 'EXECUTE') then
    raise exception '[GAGAL] fungsi rahasia terbuka untuk authenticated';
  end if;
  if has_function_privilege('anon', 'public.admin_set_push_dispatch(text,text,text)', 'EXECUTE') or has_function_privilege('anon', 'public.admin_push_test(uuid)', 'EXECUTE') then
    raise exception '[GAGAL] RPC admin terbuka untuk anon';
  end if;
  raise notice '[OK] 6. non-admin ditolak (set/status/test/dispatch); push_config & fungsi rahasia tertutup untuk anon/authenticated';

  -- ===== 7. kompatibilitas admin_set_push_config(url, key) =====
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  r := admin_set_push_config('https://proyek.supabase.co/functions/v1/push-send', 'eyJhbGciOiJIUzI1NiJ9.ANON-KEY-BARU-0123456789.ttd');
  if (select anon_key from push_config where id) not like '%ANON-KEY-BARU%' or (select service_key from push_config where id) is not null then
    raise exception '[GAGAL] admin_set_push_config lama tidak mengisi anon_key / mengisi service_key';
  end if;
  if not (r->>'has_secret')::boolean then raise exception '[GAGAL] admin_set_push_config menghapus rahasia'; end if;
  raise notice '[OK] 7. admin_set_push_config(url, key) lama → anon_key (service_key tetap NULL), rahasia tidak tersentuh';

  raise notice '[OK] SELESAI uji_push_0116 — semua skenario lolos (transaksi di-ROLLBACK)';
end $$;
rollback;
