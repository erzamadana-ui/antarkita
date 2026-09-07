-- =====================================================================
-- 0030 — Tahap 11
--   A. "AntarNow": pesan driver tertentu lewat kode 6 karakter (drivers.code,
--      orders.preferred_driver_id, masa tahan + fallback, RPC kode & statistik).
--   B. Fondasi notifikasi push: push_tokens + RLS, register/unregister,
--      antrean push_outbox + pemicu (notifications, order_messages, call_logs),
--      pengirim push_dispatch() lewat pg_net → Edge Function `push-send` (FCM v1).
--   C. Perbaikan pendaftaran ulang setelah akun dihapus.
--
-- ---------------------------------------------------------------------
-- AKAR MASALAH BAGIAN C (dibuktikan dari log GoTrue, bukan dugaan)
-- ---------------------------------------------------------------------
-- Log auth (7 Sep 2026 09:07 UTC, POST /signup, status 500):
--   "unable to find user from email identity for duplicates: error finding user:
--    sql: Scan error on column index 1, name \"banned_until\":
--    unsupported Scan, storing driver.Value type string into type *time.Time"
-- dan pada POST /token (masuk) 09:09:32 UTC:
--   "error finding user: sql: Scan error on column index 1, name \"banned_until\": ..."
--
-- Penyebab: 0023 & 0026 memblokir login dengan `banned_until = 'infinity'::timestamptz`.
-- PostgreSQL mengirim nilai itu ke kabel sebagai teks 'infinity'; driver Go milik GoTrue
-- memetakan kolom banned_until ke *time.Time yang TIDAK mengenal 'infinity', sehingga
-- SETIAP pembacaan baris auth.users itu gagal. Akibatnya bukan hanya login yang mati:
-- pemeriksaan duplikat e-mail saat /signup pun error 500 → pengguna melihat
-- "Database error finding user". Jadi masalahnya bukan baris ganda dan bukan trigger
-- pembuat profil — melainkan nilai 'infinity' pada auth.users.banned_until.
--
-- Perbaikan di berkas ini:
--   1. Semua pemblokiran memakai batas berhingga (2999-12-31) lewat auth_ban_ts().
--   2. Baris lama yang terlanjur 'infinity' dinormalkan (auth_fix_infinite_bans()).
--   3. Sesuai kontrak: admin_delete_partner (semua kind yang menonaktifkan akun) dan
--      request_account_deletion MELEPAS e-mail & nomor HP di auth.users menjadi tombstone
--      <uid>@deleted.antarkita.invalid (termasuk auth.identities.identity_data->>'email',
--      karena GoTrue mencari duplikat lewat identitas e-mail), sehingga e-mail asli bebas
--      dipakai mendaftar lagi.
--   4. handle_new_user() dibuat tahan-ulang (ON CONFLICT DO UPDATE / DO NOTHING) supaya
--      tidak pernah melempar error yang membuat GoTrue gagal membuat pengguna.
-- =====================================================================

-- =====================================================================
-- C. PENDAFTARAN ULANG SETELAH AKUN DIHAPUS
-- =====================================================================

/** Batas blokir login yang aman untuk GoTrue (berhingga, bukan 'infinity'). */
create or replace function auth_ban_ts()
returns timestamptz language sql immutable as $$ select '2999-12-31 23:59:59+00'::timestamptz $$;
comment on function auth_ban_ts() is
  'Tahap 11 — pengganti ''infinity'' untuk auth.users.banned_until. GoTrue (Go) tidak bisa memindai ''infinity'' ke *time.Time sehingga seluruh baca baris pengguna gagal ("Database error finding user").';

/** Normalkan baris auth.users yang terlanjur diblokir dengan 'infinity'. Aman dipanggil berulang. */
create or replace function auth_fix_infinite_bans()
returns integer language plpgsql security definer set search_path = public as $$
declare v_n int := 0;
begin
  begin
    update auth.users set banned_until = auth_ban_ts()
     where banned_until = 'infinity'::timestamptz;
    get diagnostics v_n = row_count;
  exception when others then
    raise notice 'auth_fix_infinite_bans: tidak bisa mengubah auth.users (%)', sqlerrm;
  end;
  return v_n;
end $$;
revoke all on function auth_fix_infinite_bans() from public, anon, authenticated;

/**
 * Lepas identitas login (e-mail + nomor HP) sebuah akun menjadi tombstone
 * <uid>@deleted.antarkita.invalid, sehingga e-mail asli bebas dipakai mendaftar ulang.
 * p_ban=true sekaligus memblokir login akun lama (dengan batas berhingga).
 * Tidak pernah melempar error ke pemanggil: bila hak akses auth.* tidak ada, cukup RAISE NOTICE.
 */
create or replace function auth_release_identity(p_user uuid, p_ban boolean default true)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_tomb text := p_user::text || '@deleted.antarkita.invalid';
begin
  if p_user is null then return false; end if;
  begin
    -- GoTrue mencari duplikat lewat auth.identities (kolom email = identity_data->>'email')
    update auth.identities
       set identity_data = jsonb_set(coalesce(identity_data, '{}'::jsonb), '{email}', to_jsonb(v_tomb)),
           updated_at = now()
     where user_id = p_user and coalesce(identity_data->>'email', '') <> v_tomb;
    update auth.users set
      email = v_tomb,
      phone = null,
      email_change = '', email_change_token_new = '', email_change_token_current = '',
      phone_change = '', phone_change_token = '',
      raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) - 'email' - 'phone' - 'full_name' - 'phone_verified' - 'email_verified',
      banned_until = case when p_ban then auth_ban_ts() else null end
    where id = p_user;
    return true;
  exception when others then
    raise notice 'auth_release_identity(%): tidak bisa mengubah auth.* (%) — login tetap diblokir lewat profiles.is_active', p_user, sqlerrm;
    return false;
  end;
end $$;
revoke all on function auth_release_identity(uuid, boolean) from public, anon, authenticated;
comment on function auth_release_identity(uuid, boolean) is
  'Tahap 11 — melepas e-mail & nomor HP akun terhapus jadi tombstone <uid>@deleted.antarkita.invalid (auth.users + auth.identities) agar e-mail asli bisa dipakai mendaftar lagi.';

-- --- Trigger pembuat profil dibuat tahan-ulang: tidak boleh menggagalkan GoTrue ---
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, phone, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(coalesce(new.email,''), '@', 1)),
    new.raw_user_meta_data->>'phone',
    new.email
  )
  on conflict (id) do update set
    full_name = coalesce(excluded.full_name, profiles.full_name),
    phone     = coalesce(excluded.phone, profiles.phone),
    email     = coalesce(excluded.email, profiles.email),
    is_active = true,
    deletion_requested_at = null,
    updated_at = now();
  insert into public.wallets (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
exception when others then
  -- Jangan pernah menggagalkan pembuatan pengguna di GoTrue karena masalah profil.
  raise warning 'handle_new_user(%) gagal: %', new.id, sqlerrm;
  return new;
end $$;
comment on function handle_new_user() is
  'Membuat profil + dompet untuk pengguna auth baru. Sejak 0030 idempotent (ON CONFLICT) dan tidak pernah melempar error ke GoTrue.';

-- --- Tambal admin_delete_partner: batas ban berhingga + lepas e-mail/HP ---
do $do$
declare
  def text;
  old_ban text := $a$      update auth.users set banned_until = 'infinity'::timestamptz where id = p_id;$a$;
  new_ban text := $b$      update auth.users set banned_until = auth_ban_ts() where id = p_id;
      perform auth_release_identity(p_id, true);$b$;
  old_if  text := $c$  if p_kind = 'user' then
    begin
      update auth.users set banned_until = auth_ban_ts() where id = p_id;$c$;
  new_if  text := $d$  if p_kind in ('user','driver','merchant','vendor','travel') then
    begin
      update auth.users set banned_until = auth_ban_ts() where id = v_user;$d$;
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'admin_delete_partner';
  if def is null then raise exception 'admin_delete_partner belum ada — jalankan migrasi 0026 & 0027 lebih dulu'; end if;
  if position('auth_release_identity' in def) > 0 then return; end if;   -- sudah ditambal
  if position(old_ban in def) = 0 then
    raise exception 'anchor banned_until admin_delete_partner tidak ditemukan — definisi fungsi sudah berubah';
  end if;
  def := replace(def, old_ban, new_ban);
  -- pemilik akun (v_user) yang dinonaktifkan, bukan hanya kind 'user'
  if position(old_if in def) = 0 then
    raise exception 'anchor blok if admin_delete_partner tidak ditemukan';
  end if;
  def := replace(def, old_if, new_if);
  def := replace(def, $e$      perform auth_release_identity(p_id, true);$e$, $f$      perform auth_release_identity(v_user, true);$f$);
  execute def;
end $do$;
revoke all on function admin_delete_partner(text, uuid, text) from public, anon;
grant execute on function admin_delete_partner(text, uuid, text) to authenticated;
comment on function admin_delete_partner(text, uuid, text) is
  'Tahap 9/11 — hapus lunak mitra/pengguna (wajib PIN admin + alasan >= 10 huruf). Sejak 0030: blokir login memakai batas berhingga (bukan ''infinity'', yang membuat GoTrue error) dan melepas e-mail/HP akun jadi tombstone agar bisa mendaftar ulang.';

-- --- Tambal request_account_deletion: batas ban berhingga + lepas e-mail/HP ---
do $do$
declare
  def text;
  old_ban text := $a$  begin
    update auth.users set banned_until = 'infinity'::timestamptz where id = v_uid;
  exception when others then
    raise notice 'Tidak bisa mengubah auth.users (%): login hanya diblokir lewat is_active', sqlerrm;
  end;$a$;
  new_ban text := $b$  begin
    update auth.users set banned_until = auth_ban_ts() where id = v_uid;
    perform auth_release_identity(v_uid, true);
  exception when others then
    raise notice 'Tidak bisa mengubah auth.users (%): login hanya diblokir lewat is_active', sqlerrm;
  end;$b$;
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'request_account_deletion';
  if def is null then raise exception 'request_account_deletion belum ada — jalankan migrasi 0023 lebih dulu'; end if;
  if position('auth_release_identity' in def) > 0 then return; end if;
  if position(old_ban in def) = 0 then
    raise exception 'anchor banned_until request_account_deletion tidak ditemukan — definisi fungsi sudah berubah';
  end if;
  execute replace(def, old_ban, new_ban);
end $do$;
revoke all on function request_account_deletion() from public, anon;
grant execute on function request_account_deletion() to authenticated;
comment on function request_account_deletion() is
  'Hapus akun atas permintaan pengguna. Sejak 0030: e-mail & nomor HP di auth.users dilepas jadi tombstone (bisa daftar ulang) dan blokir login memakai batas berhingga agar GoTrue tetap bisa membaca baris pengguna.';

-- --- admin_finalize_account_deletion: ganti 'infinity' + pakai helper ---
create or replace function admin_finalize_account_deletion(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_prev text := coalesce(current_setting('antaraja.bypass', true), 'off');
begin
  if not is_admin() then raise exception 'Hanya admin'; end if;
  if not exists (select 1 from profiles where id = p_user and deletion_requested_at is not null) then
    raise exception 'Pengguna ini tidak meminta penghapusan akun';
  end if;
  perform set_config('antaraja.bypass', 'on', true);
  update driver_documents set photo_id_url = null, photo_vehicle_url = null, license_number = null, id_card_number = null where driver_id = p_user;
  update market_vendors set id_card_url = null, market_card_url = null, photo_url = null, phone = null,
    bank_name = null, bank_account = null, bank_holder = null where id = p_user;
  perform set_config('antaraja.bypass', v_prev, true);
  begin
    delete from auth.identities where user_id = p_user;
    update auth.users set
      email = p_user::text || '@deleted.antarkita.invalid',
      phone = null,
      encrypted_password = md5(gen_random_uuid()::text),
      raw_user_meta_data = '{}'::jsonb,
      banned_until = auth_ban_ts()
    where id = p_user;
  exception when others then
    raise exception 'Gagal membersihkan auth.users: %. Hapus pengguna lewat Supabase Dashboard → Authentication.', sqlerrm;
  end;
  perform log_activity('profile.deletion_finalized', 'profiles', p_user::text, 'PII akun dihapus permanen oleh admin', null);
end $$;
revoke all on function admin_finalize_account_deletion(uuid) from public, anon;
grant execute on function admin_finalize_account_deletion(uuid) to authenticated;

-- Bereskan baris yang terlanjur 'infinity' (satu kali, idempotent)
select auth_fix_infinite_bans();

-- =====================================================================
-- A. "AntarNow" — pesan driver tertentu lewat kode
-- =====================================================================

/** Setelan boolean dari app_settings (pelengkap setting_num). */
create or replace function setting_flag(p_key text, p_default boolean)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select (value)::text::boolean from app_settings where key = p_key), p_default)
$$;
grant execute on function setting_flag(text, boolean) to authenticated;

insert into app_settings (key, value) values
  ('direct_order_hold_seconds', '120'::jsonb),
  ('direct_order_fallback', 'true'::jsonb)
on conflict (key) do nothing;

-- ---------- kode driver ----------
alter table drivers add column if not exists code text;
create unique index if not exists drivers_code_key on drivers (code) where code is not null;

/** Kode acak 6 karakter tanpa karakter membingungkan (tanpa 0 O 1 I). */
create or replace function gen_driver_code()
returns text language plpgsql volatile set search_path = public as $$
declare
  alfabet text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';   -- 32 karakter, tanpa 0 O 1 I
  v_code text;
begin
  for i in 1..40 loop
    v_code := '';
    for j in 1..6 loop
      v_code := v_code || substr(alfabet, 1 + floor(random() * length(alfabet))::int, 1);
    end loop;
    if not exists (select 1 from drivers where code = v_code) then return v_code; end if;
  end loop;
  raise exception 'Gagal membuat kode driver unik, coba lagi';
end $$;
revoke all on function gen_driver_code() from public, anon, authenticated;

create or replace function trg_driver_code()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.code is null or trim(new.code) = '' then new.code := gen_driver_code(); else new.code := upper(trim(new.code)); end if;
  return new;
end $$;
drop trigger if exists t_driver_code on drivers;
create trigger t_driver_code before insert on drivers for each row execute function trg_driver_code();

-- Kode untuk driver lama (idempotent — hanya yang masih kosong)
do $do$
declare r record;
begin
  perform set_config('antaraja.bypass', 'on', true);
  for r in select id from drivers where code is null loop
    update drivers set code = gen_driver_code() where id = r.id;
  end loop;
  perform set_config('antaraja.bypass', 'off', true);
end $do$;

comment on column drivers.code is 'Tahap 11 — kode AntarNow 6 karakter (huruf besar + angka, tanpa 0 O 1 I) untuk memesan driver ini secara langsung.';

-- ---------- order langsung ----------
alter table orders add column if not exists preferred_driver_id uuid references profiles(id);
create index if not exists orders_preferred_driver_idx on orders (preferred_driver_id, created_at)
  where preferred_driver_id is not null;
comment on column orders.preferred_driver_id is 'Tahap 11 — driver tujuan AntarNow. Selama direct_order_hold_seconds hanya driver ini yang melihat order.';

/** Nama layanan untuk pesan kesalahan berbahasa Indonesia. */
create or replace function service_label(p_service service_type)
returns text language sql immutable as $$
  select case p_service
    when 'ride_motor' then 'AntarRide' when 'ride_car' then 'AntarCar'
    when 'food' then 'AntarFood'      when 'send' then 'AntarSend'
    when 'shop' then 'AntarShop'      when 'box' then 'AntarBox'
    when 'travel' then 'AntarTravel'  when 'market' then 'AntarMarket'
    else p_service::text end
$$;
grant execute on function service_label(service_type) to authenticated;

/** Layanan yang bisa dikerjakan sebuah jenis kendaraan (cerminan driver_can_take). */
create or replace function driver_service_codes(p_vehicle vehicle_type)
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(s order by s), '{}'::text[]) from (
    select unnest(array['ride_motor','ride_car','food','send','shop','market','box']) as s
  ) x where service_enabled(x.s) and case x.s
      when 'ride_motor' then p_vehicle = 'motor'
      when 'ride_car'   then p_vehicle = 'car'
      when 'box'        then p_vehicle in ('box','pickup')
      when 'food'       then p_vehicle in ('motor','car')
      when 'send'       then true
      else p_vehicle in ('motor','car') end
$$;
grant execute on function driver_service_codes(vehicle_type) to authenticated;

/** Aplikasi Mitra: kode saya + jumlah order langsung hari ini + teks siap bagikan. */
create or replace function driver_my_code()
returns jsonb language plpgsql security definer set search_path = public as $$
declare d drivers%rowtype; v_today int; v_name text;
begin
  select * into d from drivers where id = auth.uid();
  if not found then raise exception 'Hanya mitra driver'; end if;
  if d.code is null then
    perform set_config('antaraja.bypass', 'on', true);
    update drivers set code = gen_driver_code() where id = d.id returning * into d;
    perform set_config('antaraja.bypass', 'off', true);
  end if;
  select count(*) into v_today from orders o
   where o.preferred_driver_id = d.id
     and o.created_at >= date_trunc('day', now() at time zone 'Asia/Jakarta') at time zone 'Asia/Jakarta';
  select full_name into v_name from profiles where id = d.id;
  return jsonb_build_object(
    'code', d.code,
    'orders_direct_today', v_today,
    'share_text', 'Pesan saya langsung di AntarKita! Buka aplikasi → AntarNow → masukkan kode ' || d.code
                  || coalesce(' (' || v_name || ')', '') || '.');
end $$;
revoke all on function driver_my_code() from public, anon;
grant execute on function driver_my_code() to authenticated;

/** Aplikasi Pelanggan: pratinjau driver dari kode sebelum memesan. */
create or replace function driver_by_code(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^0-9A-Za-z]', '', 'g'));
  d drivers%rowtype; pf profiles%rowtype;
begin
  if length(v_code) <> 6 then
    raise exception 'Kode driver terdiri dari 6 karakter. Periksa kembali kode yang Anda masukkan.';
  end if;
  select * into d from drivers where code = v_code;
  if not found then
    raise exception 'Kode driver % tidak ditemukan. Minta driver membuka menu "Kode Saya" di aplikasi Mitra.', v_code;
  end if;
  select * into pf from profiles where id = d.id;
  if d.status <> 'approved' or not coalesce(pf.is_active, false) then
    raise exception 'Driver dengan kode % sedang tidak aktif. Silakan pesan seperti biasa.', v_code;
  end if;
  return jsonb_build_object(
    'id', d.id, 'code', d.code, 'name', pf.full_name, 'avatar_url', pf.avatar_url,
    'vehicle_type', d.vehicle_type, 'vehicle_class', d.vehicle_class,
    'vehicle_brand', d.vehicle_brand, 'vehicle_model', d.vehicle_model, 'vehicle_plate', d.vehicle_plate,
    'rating_avg', d.rating_avg, 'rating_count', d.rating_count, 'total_trips', d.total_trips,
    'is_online', d.is_online,
    'last_seen_minutes', case when d.last_seen_at is null then null
                              else round((extract(epoch from now() - d.last_seen_at) / 60.0)::numeric, 0)::int end,
    'services', to_jsonb(driver_service_codes(d.vehicle_type)));
end $$;
revoke all on function driver_by_code(text) from public, anon;
grant execute on function driver_by_code(text) to authenticated;

/** Kartu statistik order langsung di aplikasi Mitra. */
create or replace function driver_direct_stats()
returns jsonb language plpgsql security definer set search_path = public as $$
declare d drivers%rowtype; v_today int; v_week int; v_total int; v_done int;
begin
  select * into d from drivers where id = auth.uid();
  if not found then raise exception 'Hanya mitra driver'; end if;
  select count(*) filter (where o.created_at >= date_trunc('day', now() at time zone 'Asia/Jakarta') at time zone 'Asia/Jakarta'),
         count(*) filter (where o.created_at >= date_trunc('week', now() at time zone 'Asia/Jakarta') at time zone 'Asia/Jakarta'),
         count(*),
         count(*) filter (where o.status = 'completed')
    into v_today, v_week, v_total, v_done
    from orders o where o.preferred_driver_id = d.id;
  return jsonb_build_object('code', d.code, 'today', coalesce(v_today,0), 'this_week', coalesce(v_week,0),
                            'total', coalesce(v_total,0), 'completed', coalesce(v_done,0),
                            'hold_seconds', setting_num('direct_order_hold_seconds', 120)::int,
                            'fallback', setting_flag('direct_order_fallback', true));
end $$;
revoke all on function driver_direct_stats() from public, anon;
grant execute on function driver_direct_stats() to authenticated;

-- ---------- tambal create_order: terima driver_code ----------
do $do$
declare
  def text;
  old_decl text := $a$  v_shop_store text := p->>'shop_store';$a$;
  new_decl text := $b$  v_shop_store text := p->>'shop_store';
  v_dcode text := upper(regexp_replace(coalesce(p->>'driver_code', ''), '[^0-9A-Za-z]', '', 'g'));
  v_pdrv drivers%rowtype; v_pref uuid; v_probe orders%rowtype;$b$;
  old_pr text := $c$  select * into pr from pricing where service = v_service;$c$;
  new_pr text := $d$  select * into pr from pricing where service = v_service;

  -- AntarNow: pesan driver tertentu lewat kode 6 karakter
  if v_dcode <> '' then
    if length(v_dcode) <> 6 then raise exception 'Kode driver terdiri dari 6 karakter. Periksa kembali kode yang Anda masukkan.'; end if;
    select * into v_pdrv from drivers where code = v_dcode;
    if not found then raise exception 'Kode driver % tidak ditemukan. Minta driver membuka menu "Kode Saya" di aplikasi Mitra.', v_dcode; end if;
    if v_pdrv.id = v_uid then raise exception 'Anda tidak bisa memesan ke kode Anda sendiri.'; end if;
    if v_pdrv.status <> 'approved' or not exists (select 1 from profiles where id = v_pdrv.id and is_active) then
      raise exception 'Driver dengan kode % sedang tidak aktif. Silakan pesan seperti biasa.', v_dcode;
    end if;
    v_probe.service := v_service;
    v_probe.status := 'searching'::order_status;
    v_probe.created_at := now();
    v_probe.vehicle_class := v_class.code;
    v_probe.shop_vehicle := case when v_service in ('shop','market') then v_vehicle else 'motor' end;
    v_probe.weight_kg := v_weight;
    v_probe.package_details := coalesce(p->'package_details','{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object('size_cm', nullif(p->>'size_cm',''), 'via', nullif(p->>'via','')));
    if not driver_can_take(v_pdrv, v_probe) then
      raise exception 'Driver ini tidak melayani %. Kendaraannya % — pilih layanan lain atau pesan tanpa kode.',
        service_label(v_service), v_pdrv.vehicle_type;
    end if;
    v_pref := v_pdrv.id;
  end if;$d$;
  old_cols text := $e$    shop_store_id, market_id, shop_vehicle, service_fee, driver_service_share)$e$;
  new_cols text := $f$    shop_store_id, market_id, shop_vehicle, service_fee, driver_service_share, preferred_driver_id)$f$;
  old_vals text := $g$    v_store.id, v_market.id, case when v_service in ('shop','market') then v_vehicle else 'motor' end, v_service_fee, v_driver_share)$g$;
  new_vals text := $h$    v_store.id, v_market.id, case when v_service in ('shop','market') then v_vehicle else 'motor' end, v_service_fee, v_driver_share, v_pref)$h$;
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_order';
  if def is null then raise exception 'create_order belum ada'; end if;
  if position('v_dcode' in def) > 0 then return; end if;   -- sudah ditambal
  if position(old_decl in def) = 0 or position(old_pr in def) = 0
     or position(old_cols in def) = 0 or position(old_vals in def) = 0 then
    raise exception 'anchor create_order tidak ditemukan — definisi fungsi sudah berubah';
  end if;
  def := replace(def, old_decl, new_decl);
  def := replace(def, old_pr,   new_pr);
  def := replace(def, old_cols, new_cols);
  def := replace(def, old_vals, new_vals);
  execute def;
end $do$;
revoke all on function create_order(jsonb) from public, anon;
grant execute on function create_order(jsonb) to authenticated;
comment on function create_order(jsonb) is
  'Membuat pesanan. Sejak 0030 menerima field opsional `driver_code` (AntarNow): kode divalidasi (ada, driver approved & aktif, kendaraannya cocok lewat driver_can_take) lalu mengisi orders.preferred_driver_id.';

-- ---------- tambal driver_available_orders: kolom direct_for_me & direct_hold_left_s ----------
do $do$
declare
  def text;
  old_ret text := $a$waiting_minutes numeric, priority_note text)$a$;
  new_ret text := $b$waiting_minutes numeric, priority_note text, direct_for_me boolean, direct_hold_left_s integer)$b$;
  old_decl text := $c$declare d drivers%rowtype; v_delay int;$c$;
  new_decl text := $d$declare d drivers%rowtype; v_delay int; v_hold numeric; v_fallback boolean;$d$;
  old_init text := $e$  v_delay := driver_priority_delay_s(d.rating_avg, d.rating_count);$e$;
  new_init text := $f$  v_delay := driver_priority_delay_s(d.rating_avg, d.rating_count);
  v_hold := setting_num('direct_order_hold_seconds', 120);
  v_fallback := setting_flag('direct_order_fallback', true);$f$;
  old_sel text := $g$         else 'Dibuka untuk semua driver setelah ' || v_delay || ' detik' end
  from orders o left join merchants m on m.id = o.merchant_id$g$;
  new_sel text := $h$         else 'Dibuka untuk semua driver setelah ' || v_delay || ' detik' end,
    (o.preferred_driver_id is not null and o.preferred_driver_id = d.id),
    case when o.preferred_driver_id is null then null
         else greatest(0, ceil(v_hold - extract(epoch from now() - o.created_at)))::int end
  from orders o left join merchants m on m.id = o.merchant_id$h$;
  old_where text := $i$    and not exists (select 1 from order_rejections r where r.order_id = o.id and r.driver_id = d.id)$i$;
  new_where text := $j$    and not exists (select 1 from order_rejections r where r.order_id = o.id and r.driver_id = d.id)
    and (o.preferred_driver_id is null
         or o.preferred_driver_id = d.id
         or (v_fallback and extract(epoch from now() - o.created_at) >= v_hold))$j$;
  old_ord text := $k$  order by 18 asc limit 20;$k$;
  new_ord text := $l$  order by 30 desc nulls last, 18 asc limit 20;$l$;
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'driver_available_orders';
  if def is null then raise exception 'driver_available_orders belum ada — jalankan migrasi 0025 lebih dulu'; end if;
  if position('direct_for_me' in def) > 0 then return; end if;   -- sudah ditambal
  if position(old_ret in def) = 0 or position(old_decl in def) = 0 or position(old_init in def) = 0
     or position(old_sel in def) = 0 or position(old_where in def) = 0 or position(old_ord in def) = 0 then
    raise exception 'anchor driver_available_orders tidak ditemukan — definisi fungsi sudah berubah';
  end if;
  def := replace(def, old_ret,   new_ret);
  def := replace(def, old_decl,  new_decl);
  def := replace(def, old_init,  new_init);
  def := replace(def, old_sel,   new_sel);
  def := replace(def, old_where, new_where);
  def := replace(def, old_ord,   new_ord);
  -- kolom balik bertambah → RETURNS TABLE berubah, wajib DROP dulu
  drop function if exists driver_available_orders();
  execute def;
end $do$;
grant execute on function driver_available_orders() to authenticated;
comment on function driver_available_orders() is
  'Feed order untuk driver. Sejak 0030 menambah kolom direct_for_me (order AntarNow ditujukan ke saya) dan direct_hold_left_s (sisa masa tahan, detik). Order langsung hanya tampil untuk driver tujuan selama masa tahan; setelah lewat dan direct_order_fallback=true, tampil untuk driver lain dengan direct_for_me=false.';

-- =====================================================================
-- B. FONDASI PUSH (server)
-- =====================================================================

create table if not exists push_tokens (
  user_id    uuid not null references profiles(id) on delete cascade,
  token      text primary key,
  platform   text,
  app        text,
  updated_at timestamptz not null default now()
);
create index if not exists push_tokens_user_idx on push_tokens (user_id);
alter table push_tokens enable row level security;
drop policy if exists "token push milik sendiri" on push_tokens;
create policy "token push milik sendiri" on push_tokens for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on push_tokens from anon;
grant select, insert, update, delete on push_tokens to authenticated;
comment on table push_tokens is 'Tahap 11 — token FCM per perangkat. RLS: hanya pemilik yang bisa membaca/menulis.';

create or replace function register_push_token(p_token text, p_platform text default null, p_app text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_tok text := nullif(trim(coalesce(p_token, '')), '');
begin
  if v_uid is null then raise exception 'Silakan masuk terlebih dahulu'; end if;
  if v_tok is null then raise exception 'Token notifikasi kosong'; end if;
  insert into push_tokens (user_id, token, platform, app)
  values (v_uid, v_tok, nullif(trim(coalesce(p_platform, '')), ''), nullif(trim(coalesce(p_app, '')), ''))
  on conflict (token) do update set
    user_id = excluded.user_id,
    platform = coalesce(excluded.platform, push_tokens.platform),
    app = coalesce(excluded.app, push_tokens.app),
    updated_at = now();
  return jsonb_build_object('ok', true, 'tokens', (select count(*) from push_tokens where user_id = v_uid));
end $$;
revoke all on function register_push_token(text, text, text) from public, anon;
grant execute on function register_push_token(text, text, text) to authenticated;

create or replace function unregister_push_token(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_n int;
begin
  if v_uid is null then raise exception 'Silakan masuk terlebih dahulu'; end if;
  delete from push_tokens where token = nullif(trim(coalesce(p_token, '')), '') and user_id = v_uid;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'removed', v_n, 'tokens', (select count(*) from push_tokens where user_id = v_uid));
end $$;
revoke all on function unregister_push_token(text) from public, anon;
grant execute on function unregister_push_token(text) to authenticated;

-- ---------- antrean kirim ----------
create table if not exists push_outbox (
  id          bigserial primary key,
  user_id     uuid not null references profiles(id) on delete cascade,
  title       text not null,
  body        text,
  data        jsonb not null default '{}'::jsonb,
  source      text not null,                     -- notification | chat | call
  status      text not null default 'pending',   -- pending | sending | sent | skipped | failed
  attempts    int  not null default 0,
  last_error  text,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz
);
create index if not exists push_outbox_pending_idx on push_outbox (status, created_at) where status in ('pending','sending');
alter table push_outbox enable row level security;   -- tanpa policy: hanya fungsi security definer / service_role
revoke all on push_outbox from anon, authenticated;
comment on table push_outbox is 'Tahap 11 — antrean notifikasi push. Diisi trigger (notifications, order_messages, call_logs), dikirim push_dispatch() → Edge Function push-send (FCM v1).';

-- Konfigurasi pemanggilan Edge Function (URL + kunci). Sengaja tanpa policy RLS,
-- meniru pola gateway_secrets: hanya fungsi security definer & service_role yang membacanya.
create table if not exists push_config (
  id           boolean primary key default true check (id),
  function_url text,
  service_key  text,
  updated_at   timestamptz not null default now()
);
alter table push_config enable row level security;
revoke all on push_config from anon, authenticated;
comment on table push_config is 'Tahap 11 — URL Edge Function push-send + kunci service_role yang dipakai pg_net. Diisi admin lewat admin_set_push_config().';

create or replace function admin_set_push_config(p_url text, p_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Hanya admin'; end if;
  insert into push_config (id, function_url, service_key, updated_at)
  values (true, nullif(trim(coalesce(p_url, '')), ''), nullif(trim(coalesce(p_key, '')), ''), now())
  on conflict (id) do update set
    function_url = coalesce(excluded.function_url, push_config.function_url),
    service_key  = coalesce(excluded.service_key,  push_config.service_key),
    updated_at = now();
  perform log_activity('admin.push_config', 'push_config', 'push', 'Konfigurasi pengirim push diperbarui', null);
  return jsonb_build_object('ok', true);
end $$;
revoke all on function admin_set_push_config(text, text) from public, anon;
grant execute on function admin_set_push_config(text, text) to authenticated;

/** Masukkan satu notifikasi ke antrean push (dipakai trigger). */
create or replace function push_enqueue(p_user uuid, p_title text, p_body text, p_data jsonb, p_source text)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  if p_user is null or coalesce(trim(p_title), '') = '' then return null; end if;
  -- tidak perlu antre bila pengguna belum punya token sama sekali
  if not exists (select 1 from push_tokens where user_id = p_user) then return null; end if;
  insert into push_outbox (user_id, title, body, data, source)
  values (p_user, p_title, p_body, coalesce(p_data, '{}'::jsonb), p_source)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function push_enqueue(uuid, text, text, jsonb, text) from public, anon, authenticated;

-- --- Pemicu 1: notifikasi baru ---
create or replace function trg_push_notification()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform push_enqueue(new.user_id, new.title, new.body,
    coalesce(new.data, '{}'::jsonb) || jsonb_build_object('kind', new.kind, 'notification_id', new.id), 'notification');
  return new;
exception when others then raise warning 'trg_push_notification: %', sqlerrm; return new;
end $$;
drop trigger if exists t_push_notification on notifications;
create trigger t_push_notification after insert on notifications for each row execute function trg_push_notification();

-- --- Pemicu 2: pesan chat pesanan baru ---
create or replace function trg_push_order_message()
returns trigger language plpgsql security definer set search_path = public as $$
declare o orders%rowtype; v_to uuid; v_name text;
begin
  select * into o from orders where id = new.order_id;
  if not found then return new; end if;
  -- lawan bicara: pelanggan ↔ driver
  if new.sender_id = o.customer_id then v_to := o.driver_id;
  elsif new.sender_id = o.driver_id then v_to := o.customer_id;
  else v_to := o.customer_id; end if;
  if v_to is null or v_to = new.sender_id then return new; end if;
  select full_name into v_name from profiles where id = new.sender_id;
  perform push_enqueue(v_to, coalesce(v_name, 'Pesan baru') || ' · ' || o.code, left(new.body, 140),
    jsonb_build_object('order_id', o.id, 'message_id', new.id, 'route', 'chat'), 'chat');
  return new;
exception when others then raise warning 'trg_push_order_message: %', sqlerrm; return new;
end $$;
drop trigger if exists t_push_order_message on order_messages;
create trigger t_push_order_message after insert on order_messages for each row execute function trg_push_order_message();

-- --- Pemicu 3: panggilan masuk ---
create or replace function trg_push_call()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  if new.status <> 'ringing' then return new; end if;   -- status: ringing|answered|missed|declined|ended
  select full_name into v_name from profiles where id = new.caller_id;
  perform push_enqueue(new.callee_id, 'Panggilan masuk dari ' || coalesce(v_name, 'AntarKita'), null,
    jsonb_build_object('call_id', new.id, 'order_id', new.order_id, 'caller_id', new.caller_id, 'route', 'call'), 'call');
  return new;
exception when others then raise warning 'trg_push_call: %', sqlerrm; return new;
end $$;
drop trigger if exists t_push_call on call_logs;
create trigger t_push_call after insert on call_logs for each row execute function trg_push_call();

/**
 * Kirim antrean ke Edge Function `push-send` lewat pg_net (asinkron).
 * Bila push_config belum diisi → { skipped: true } TANPA error (baris tetap di antrean).
 * Dijadwalkan pg_cron setiap menit (lihat bawah). Bisa juga dipanggil manual oleh admin.
 */
create or replace function push_dispatch(p_limit int default 100)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cfg push_config%rowtype; v_ids bigint[]; v_req bigint;
begin
  select * into cfg from push_config where id;
  select coalesce(array_agg(id), '{}'::bigint[]) into v_ids from (
    select id from push_outbox where status = 'pending' order by id limit greatest(1, coalesce(p_limit, 100))
  ) x;
  if array_length(v_ids, 1) is null then
    return jsonb_build_object('ok', true, 'queued', 0);
  end if;
  if cfg.function_url is null or cfg.service_key is null then
    return jsonb_build_object('skipped', true, 'queued', array_length(v_ids, 1),
      'reason', 'push_config belum diisi — panggil admin_set_push_config(url, service_role_key)');
  end if;
  if to_regnamespace('net') is null then
    return jsonb_build_object('skipped', true, 'queued', array_length(v_ids, 1),
      'reason', 'ekstensi pg_net belum aktif');
  end if;
  update push_outbox set status = 'sending', attempts = attempts + 1 where id = any(v_ids);
  select net.http_post(
    url := cfg.function_url,
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'Authorization', 'Bearer ' || cfg.service_key),
    body := jsonb_build_object('ids', to_jsonb(v_ids)),
    timeout_milliseconds := 8000) into v_req;
  return jsonb_build_object('ok', true, 'queued', array_length(v_ids, 1), 'request_id', v_req);
end $$;
revoke all on function push_dispatch(int) from public, anon;
grant execute on function push_dispatch(int) to authenticated;

/** Jaring pengaman: baris yang tersangkut di 'sending' > 10 menit dikembalikan ke 'pending'. */
create or replace function push_requeue_stuck()
returns integer language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  update push_outbox set status = 'pending'
   where status = 'sending' and attempts < 5 and created_at < now() - interval '10 minutes';
  get diagnostics v_n = row_count;
  update push_outbox set status = 'failed', last_error = coalesce(last_error, 'melebihi 5 percobaan')
   where status = 'sending' and attempts >= 5;
  delete from push_outbox where status in ('sent','skipped','failed') and created_at < now() - interval '7 days';
  return v_n;
end $$;
revoke all on function push_requeue_stuck() from public, anon, authenticated;

-- Jadwal pg_cron (proyek ini sudah memakai pg_cron)
do $do$
begin
  if to_regnamespace('cron') is not null then
    perform cron.unschedule('antarkita_push_dispatch') where exists (select 1 from cron.job where jobname = 'antarkita_push_dispatch');
    perform cron.schedule('antarkita_push_dispatch', '* * * * *', $c$select public.push_dispatch(100);$c$);
    perform cron.unschedule('antarkita_push_requeue') where exists (select 1 from cron.job where jobname = 'antarkita_push_requeue');
    perform cron.schedule('antarkita_push_requeue', '*/15 * * * *', $c$select public.push_requeue_stuck();$c$);
  end if;
exception when others then raise notice 'pg_cron push: %', sqlerrm;
end $do$;
