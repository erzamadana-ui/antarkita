-- =====================================================================
-- 0116 Push dispatch tanpa service_role key di tabel (audit 28 Sep G-05/G-26)
--
-- Masalah: push_dispatch() (pg_cron tiap menit) membaca push_config(function_url, service_key) yang KOSONG dan
-- diam-diam mengembalikan {skipped} → notifikasi push tidak pernah terkirim. Desainnya juga menyimpan kunci
-- service_role di tabel biasa (risiko bocor).
--
-- Mekanisme baru:
--   • push_dispatch() memanggil Edge Function push-send dengan header
--       apikey / Authorization: Bearer <anon key>   (kunci publik; lolos verify_jwt gateway)
--       x-push-secret: <rahasia>                     (otorisasi sesungguhnya; edge membandingkan dengan
--                                                     env PUSH_DISPATCH_SECRET secara waktu-konstan)
--     Rahasia dibaca dari Vault (vault.decrypted_secrets, name = 'push_dispatch_secret'); bila ekstensi
--     supabase_vault tidak ada → kolom cadangan push_config.dispatch_secret.
--   • Konfigurasi kosong TIDAK lagi diam: {ok:false, error:'PUSH_CONFIG_KOSONG'} + baris security_events
--     kind 'push.config_missing' (maksimal 1× per jam).
--   • RPC admin: admin_set_push_dispatch(url, anon_key, secret), admin_push_dispatch_status(), admin_push_test(user).
--     admin_set_push_config(url, key) lama tetap ada → diarahkan ke mekanisme baru (key = anon key).
--   • push_config: kolom anon_key, dispatch_secret (cadangan), last_dispatch_at, last_request_id, last_error.
--     service_key lama dipindah ke anon_key lalu dikosongkan (tidak ada lagi kunci rahasia di tabel).
-- Tanggal: 27 Okt 2026 · branch golive-v6 · dasar: 0030 (push), 0086 (assert_background_or_admin), 0111 (RBAC).
-- Idempoten. Rollback: supabase/rollback/0116_down.sql. Uji: supabase/tests/uji_push_0116.sql.
-- Lokal: GUC antarkita.push_vault_off=on memaksa jalur cadangan (tanpa vault) untuk uji.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Cadangan fungsi (rollback _mig_restore('0116'))
-- ---------------------------------------------------------------------
do $$
declare s text;
begin
  foreach s in array array[
    -- diubah
    'public.push_dispatch(integer)', 'public.admin_set_push_config(text,text)',
    -- baru (NULL → dihapus saat rollback)
    'public.push_vault_available()', 'public.push_dispatch_secret_get()', 'public.push_dispatch_secret_set(text)',
    'public.push_config_missing_event(text,jsonb)', 'public.admin_set_push_dispatch(text,text,text)',
    'public.admin_push_dispatch_status()', 'public.admin_push_test(uuid)'] loop
    perform _mig_backup('0116', s);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 1. push_config: kolom baru; kunci lama dipindah ke anon_key
-- ---------------------------------------------------------------------
alter table public.push_config
  add column if not exists anon_key         text,
  add column if not exists dispatch_secret  text,       -- cadangan bila Vault tidak ada; NULL bila rahasia ada di Vault
  add column if not exists last_dispatch_at timestamptz,
  add column if not exists last_request_id  bigint,
  add column if not exists last_error       text;
update public.push_config set anon_key = coalesce(anon_key, service_key), service_key = null
 where service_key is not null;
comment on table  public.push_config is 'Push (0030/0116) — URL Edge Function push-send + anon key (publik). Rahasia x-push-secret ada di Vault (push_dispatch_secret) atau kolom dispatch_secret bila Vault tidak ada. Diisi admin lewat admin_set_push_dispatch().';
comment on column public.push_config.service_key is '0116: tidak dipakai lagi (dulu kunci service_role). Dikosongkan; dipertahankan hanya untuk kompatibilitas/rollback.';
comment on column public.push_config.anon_key is '0116: anon key (JWT publik) — header apikey & Authorization Bearer ke push-send agar lolos verify_jwt gateway.';
comment on column public.push_config.dispatch_secret is '0116: cadangan rahasia x-push-secret bila ekstensi supabase_vault tidak ada. NULL bila disimpan di Vault.';

-- ---------------------------------------------------------------------
-- 2. Vault: deteksi + baca/tulis rahasia (dinamis agar aman tanpa ekstensi)
-- ---------------------------------------------------------------------
create or replace function public.push_vault_available()
returns boolean language plpgsql stable set search_path = public, pg_catalog as $$
begin
  if coalesce(current_setting('antarkita.push_vault_off', true), '') = 'on' then return false; end if;   -- uji lokal
  return to_regnamespace('vault') is not null
     and to_regclass('vault.secrets') is not null
     and to_regclass('vault.decrypted_secrets') is not null
     and to_regprocedure('vault.create_secret(text,text,text,uuid)') is not null
     and to_regprocedure('vault.update_secret(uuid,text,text,text,uuid)') is not null;
end $$;
revoke all on function public.push_vault_available() from public, anon, authenticated, service_role;

/** Rahasia x-push-secret: Vault (push_dispatch_secret) → cadangan push_config.dispatch_secret. NULL bila belum diisi. */
create or replace function public.push_dispatch_secret_get()
returns text language plpgsql stable security definer set search_path = public, pg_catalog as $$
declare v_secret text;
begin
  if push_vault_available() then
    begin
      execute $q$select decrypted_secret from vault.decrypted_secrets where name = 'push_dispatch_secret' limit 1$q$ into v_secret;
    exception when others then
      raise warning 'push_dispatch_secret_get: vault tidak terbaca (%), memakai cadangan', sqlerrm;
      v_secret := null;
    end;
  end if;
  if v_secret is null then select dispatch_secret into v_secret from push_config where id; end if;
  return nullif(trim(coalesce(v_secret, '')), '');
end $$;
revoke all on function public.push_dispatch_secret_get() from public, anon, authenticated, service_role;

/** Simpan rahasia: Vault bila ada (create/update), selain itu kolom cadangan. Mengembalikan 'vault' | 'table'. */
create or replace function public.push_dispatch_secret_set(p_secret text)
returns text language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_id uuid;
begin
  if p_secret is null or length(p_secret) < 16 then raise exception 'PUSH_SECRET_PENDEK: rahasia minimal 16 karakter'; end if;
  insert into push_config (id) values (true) on conflict (id) do nothing;
  if push_vault_available() then
    execute $q$select id from vault.secrets where name = 'push_dispatch_secret' limit 1$q$ into v_id;
    if v_id is null then
      execute $q$select vault.create_secret($1, 'push_dispatch_secret', 'AntarKita 0116 — header x-push-secret push_dispatch() → Edge Function push-send (sama dengan env PUSH_DISPATCH_SECRET)')$q$
        into v_id using p_secret;
    else
      execute $q$select vault.update_secret($1, $2)$q$ using v_id, p_secret;
    end if;
    update push_config set dispatch_secret = null, updated_at = now() where id;   -- jangan ada salinan di tabel
    return 'vault';
  end if;
  update push_config set dispatch_secret = p_secret, updated_at = now() where id;
  return 'table';
end $$;
revoke all on function public.push_dispatch_secret_set(text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3. Peristiwa keamanan "push.config_missing" — maksimal 1 baris per jam
-- ---------------------------------------------------------------------
create or replace function public.push_config_missing_event(p_reason text, p_detail jsonb default '{}'::jsonb)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from security_events where kind = 'push.config_missing' and created_at > now() - interval '1 hour') then
    return false;
  end if;
  insert into security_events (kind, user_id, detail)
  values ('push.config_missing', null, coalesce(p_detail, '{}'::jsonb) || jsonb_build_object('reason', p_reason, 'at', now()));
  return true;
end $$;
revoke all on function public.push_config_missing_event(text, jsonb) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4. push_dispatch(): anon key + x-push-secret; konfigurasi kosong → ok:false + security_events
-- ---------------------------------------------------------------------
create or replace function public.push_dispatch(p_limit integer default 100)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cfg push_config%rowtype; v_ids bigint[]; v_req bigint; v_key text; v_secret text; v_missing text[] := '{}';
begin
  perform public.assert_background_or_admin();
  select * into cfg from push_config where id;
  select coalesce(array_agg(id), '{}'::bigint[]) into v_ids from (
    select id from push_outbox where status = 'pending' order by id limit greatest(1, coalesce(p_limit, 100))
  ) x;
  if array_length(v_ids, 1) is null then
    return jsonb_build_object('ok', true, 'queued', 0);
  end if;
  v_key := nullif(trim(coalesce(cfg.anon_key, cfg.service_key, '')), '');   -- service_key: kompatibilitas pra-0116
  v_secret := push_dispatch_secret_get();
  if cfg.function_url is null then v_missing := array_append(v_missing, 'function_url'); end if;
  if v_key is null then v_missing := array_append(v_missing, 'anon_key'); end if;
  if v_secret is null then v_missing := array_append(v_missing, 'push_dispatch_secret'); end if;
  if array_length(v_missing, 1) is not null then
    perform push_config_missing_event('config', jsonb_build_object('missing', to_jsonb(v_missing), 'queued', array_length(v_ids, 1)));
    insert into push_config (id, last_error) values (true, 'PUSH_CONFIG_KOSONG: ' || array_to_string(v_missing, ', '))
    on conflict (id) do update set last_error = excluded.last_error;
    return jsonb_build_object('ok', false, 'error', 'PUSH_CONFIG_KOSONG', 'missing', to_jsonb(v_missing), 'queued', array_length(v_ids, 1),
      'hint', 'panggil admin_set_push_dispatch(function_url, anon_key, secret) dan isi secret PUSH_DISPATCH_SECRET di Edge Function');
  end if;
  if to_regnamespace('net') is null then
    perform push_config_missing_event('pg_net', jsonb_build_object('queued', array_length(v_ids, 1)));
    update push_config set last_error = 'PG_NET_TIDAK_AKTIF' where id;
    return jsonb_build_object('ok', false, 'error', 'PG_NET_TIDAK_AKTIF', 'queued', array_length(v_ids, 1));
  end if;
  update push_outbox set status = 'sending', attempts = attempts + 1 where id = any(v_ids);
  select net.http_post(
    url := cfg.function_url,
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'apikey', v_key,
                                  'Authorization', 'Bearer ' || v_key,
                                  'x-push-secret', v_secret),
    body := jsonb_build_object('ids', to_jsonb(v_ids)),
    timeout_milliseconds := 8000) into v_req;
  update push_config set last_dispatch_at = now(), last_request_id = v_req, last_error = null where id;
  return jsonb_build_object('ok', true, 'queued', array_length(v_ids, 1), 'request_id', v_req);
end $$;
revoke all on function public.push_dispatch(integer) from public, anon;
grant execute on function public.push_dispatch(integer) to authenticated;   -- isi: assert_background_or_admin (0086)
comment on function public.push_dispatch(integer) is
  '0116: POST push_outbox pending ke Edge Function push-send lewat pg_net; header apikey/Bearer = anon key (publik), x-push-secret = Vault push_dispatch_secret (cadangan push_config.dispatch_secret). Konfigurasi kosong → {ok:false,error:PUSH_CONFIG_KOSONG} + security_events push.config_missing (≤1/jam).';

-- ---------------------------------------------------------------------
-- 5. RPC admin
-- ---------------------------------------------------------------------
/** Simpan URL push-send + anon key + rahasia. Parameter NULL/kosong = jangan ubah nilai itu. Rahasia TIDAK ditulis ke log. */
create or replace function public.admin_set_push_dispatch(p_function_url text, p_anon_key text, p_secret text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_url text := nullif(trim(coalesce(p_function_url, '')), ''); v_key text := nullif(trim(coalesce(p_anon_key, '')), '');
        v_secret text := nullif(trim(coalesce(p_secret, '')), ''); v_store text := null;
begin
  perform admin_require('gateway_secret');
  perform admin_require_unlock();
  if v_url is not null and v_url !~ '^https://' then raise exception 'PUSH_URL_SALAH: function_url harus https://…/functions/v1/push-send'; end if;
  if v_key is not null and length(v_key) < 20 then raise exception 'PUSH_ANON_KEY_PENDEK: anon key tidak valid'; end if;
  insert into push_config (id, function_url, anon_key, updated_at)
  values (true, v_url, v_key, now())
  on conflict (id) do update set
    function_url = coalesce(excluded.function_url, push_config.function_url),
    anon_key     = coalesce(excluded.anon_key,     push_config.anon_key),
    service_key  = null,            -- 0116: tidak ada lagi kunci service_role di tabel
    updated_at   = now();
  if v_secret is not null then v_store := push_dispatch_secret_set(v_secret); end if;
  update push_config set last_error = null where id;
  perform log_activity('admin.push_config', 'push_config', 'push', 'Konfigurasi pengirim push diperbarui (0116)',
    jsonb_build_object('url_changed', v_url is not null, 'anon_key_changed', v_key is not null, 'secret_changed', v_secret is not null, 'secret_store', v_store));
  return admin_push_dispatch_status();
end $$;
revoke all on function public.admin_set_push_dispatch(text, text, text) from public, anon;
grant execute on function public.admin_set_push_dispatch(text, text, text) to authenticated;
comment on function public.admin_set_push_dispatch(text, text, text) is
  '0116: URL Edge Function push-send + anon key (publik) + rahasia x-push-secret (Vault push_dispatch_secret / cadangan kolom). Izin gateway_secret + PIN. Nilai kosong = tidak diubah. Rahasia harus sama dengan secret PUSH_DISPATCH_SECRET di Edge Function.';

/** Kompatibilitas 0030: admin_set_push_config(url, key) → key diperlakukan sebagai ANON key (bukan service_role). */
create or replace function public.admin_set_push_config(p_url text, p_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.admin_require('gateway_secret');   -- 0111 RBAC
  return admin_set_push_dispatch(p_url, p_key, null);
end $$;
revoke all on function public.admin_set_push_config(text, text) from public, anon;
grant execute on function public.admin_set_push_config(text, text) to authenticated;
comment on function public.admin_set_push_config(text, text) is
  '0116: pembungkus kompatibilitas → admin_set_push_dispatch(url, key, null). p_key = anon key (BUKAN service_role). Rahasia diatur lewat admin_set_push_dispatch.';

/** Status pengiriman push untuk Panel Admin — tanpa membocorkan kunci/rahasia. */
create or replace function public.admin_push_dispatch_status()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare cfg push_config%rowtype; v_has_secret boolean; v_store text; v_pending bigint; v_sent bigint; v_failed bigint; v_skipped bigint;
        v_last_err text; v_last_err_at timestamptz; v_cron boolean := false;
begin
  perform admin_require('view');
  select * into cfg from push_config where id;
  v_has_secret := push_dispatch_secret_get() is not null;
  v_store := case when not v_has_secret then null when push_vault_available() and cfg.dispatch_secret is null then 'vault' else 'table' end;
  select count(*) filter (where status = 'pending'),
         count(*) filter (where status = 'sent'    and coalesce(sent_at, created_at) > now() - interval '24 hours'),
         count(*) filter (where status = 'failed'  and coalesce(sent_at, created_at) > now() - interval '24 hours'),
         count(*) filter (where status = 'skipped' and coalesce(sent_at, created_at) > now() - interval '24 hours')
    into v_pending, v_sent, v_failed, v_skipped from push_outbox;
  select last_error, coalesce(sent_at, created_at) into v_last_err, v_last_err_at from push_outbox
   where last_error is not null order by coalesce(sent_at, created_at) desc, id desc limit 1;
  if to_regclass('cron.job') is not null then
    execute $q$select exists (select 1 from cron.job where jobname = 'antarkita_push_dispatch' and active)$q$ into v_cron;
  end if;
  return jsonb_build_object(
    'configured', cfg.function_url is not null and nullif(coalesce(cfg.anon_key, cfg.service_key), '') is not null and v_has_secret,
    'url', cfg.function_url,
    'has_anon_key', nullif(coalesce(cfg.anon_key, cfg.service_key), '') is not null,
    'has_secret', v_has_secret,
    'secret_store', v_store,
    'vault_available', push_vault_available(),
    'outbox_pending', coalesce(v_pending, 0),
    'outbox_sent_24h', coalesce(v_sent, 0),
    'outbox_failed_24h', coalesce(v_failed, 0),
    'outbox_skipped_24h', coalesce(v_skipped, 0),
    'last_error', coalesce(cfg.last_error, v_last_err),
    'last_error_at', case when cfg.last_error is not null then cfg.last_dispatch_at else v_last_err_at end,
    'last_outbox_error', v_last_err,
    'last_dispatch_at', cfg.last_dispatch_at,
    'last_request_id', cfg.last_request_id,
    'cron_active', v_cron,
    'updated_at', cfg.updated_at);
end $$;
revoke all on function public.admin_push_dispatch_status() from public, anon;
grant execute on function public.admin_push_dispatch_status() to authenticated;
comment on function public.admin_push_dispatch_status() is
  '0116: {configured, url, has_anon_key, has_secret, secret_store, outbox_pending, outbox_sent_24h, outbox_failed_24h, last_error, …}. Tidak pernah mengembalikan kunci/rahasia.';

/** Kirim 1 notifikasi uji ke p_user (default: admin pemanggil) lalu jalankan push_dispatch. */
create or replace function public.admin_push_test(p_user uuid default auth.uid())
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user uuid := coalesce(p_user, auth.uid()); v_id bigint; v_tokens int; v_pending bigint; r jsonb;
begin
  perform admin_require('gateway_secret');
  if v_user is null or not exists (select 1 from profiles where id = v_user) then raise exception 'PUSH_USER_TIDAK_ADA: pengguna % tidak ditemukan', v_user; end if;
  select count(*) into v_tokens from push_tokens where user_id = v_user;
  insert into push_outbox (user_id, title, body, data, source)
  values (v_user, 'Uji notifikasi AntarKita', 'Bila pesan ini muncul, pengiriman push dari server sudah berfungsi (' || to_char(now() at time zone 'Asia/Jakarta', 'DD Mon HH24:MI') || ' WIB).',
          jsonb_build_object('kind', 'push_test', 'route', 'home', 'by', auth.uid()), 'push_test')
  returning id into v_id;
  select count(*) into v_pending from push_outbox where status = 'pending';
  r := push_dispatch(least(500, greatest(10, v_pending))::int);   -- pastikan baris uji ikut terkirim walau ada antrean lama
  perform log_activity('admin.push_test', 'push_outbox', v_id::text, 'Uji notifikasi push ke ' || v_user::text,
    jsonb_build_object('user_id', v_user, 'tokens', v_tokens, 'dispatch', r));
  return jsonb_build_object('ok', coalesce((r->>'ok')::boolean, false), 'outbox_id', v_id, 'user_id', v_user, 'tokens', v_tokens,
    'warning', case when v_tokens = 0 then 'pengguna belum punya token perangkat (push_tokens kosong) — buka aplikasi & izinkan notifikasi dulu' end,
    'dispatch', r);
end $$;
revoke all on function public.admin_push_test(uuid) from public, anon;
grant execute on function public.admin_push_test(uuid) to authenticated;
comment on function public.admin_push_test(uuid) is
  '0116: masukkan 1 baris push_outbox "Uji notifikasi AntarKita" untuk p_user (default admin pemanggil) lalu push_dispatch(). Hasil push-send terlihat di admin_push_dispatch_status() ± 1 menit kemudian.';

-- ---------------------------------------------------------------------
-- 6. Penjaga migrasi
-- ---------------------------------------------------------------------
do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.push_dispatch(integer)'::regprocedure);
  if position('x-push-secret' in v_def) = 0 or position('PUSH_CONFIG_KOSONG' in v_def) = 0 then
    raise exception '0116 batal: push_dispatch belum memakai x-push-secret / PUSH_CONFIG_KOSONG';
  end if;
  if exists (select 1 from push_config where service_key is not null) then raise exception '0116 batal: push_config.service_key masih terisi'; end if;
  if has_function_privilege('authenticated', 'public.push_dispatch_secret_get()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.push_dispatch_secret_set(text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.admin_set_push_dispatch(text,text,text)', 'EXECUTE') then
    raise exception '0116 batal: fungsi rahasia push terbuka untuk anon/authenticated';
  end if;
  if has_table_privilege('authenticated', 'public.push_config', 'SELECT') or has_table_privilege('anon', 'public.push_config', 'SELECT') then
    raise exception '0116 batal: push_config terbaca anon/authenticated';
  end if;
  raise notice '0116 ok: push_dispatch memakai anon key + x-push-secret (Vault: %), konfigurasi kosong → PUSH_CONFIG_KOSONG + security_events', push_vault_available();
end $$;
