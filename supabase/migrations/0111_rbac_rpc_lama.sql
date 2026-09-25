-- =====================================================================
-- 0111 — RBAC UNTUK RPC ADMIN LAMA, TULIS LANGSUNG TARIF SESI/ANTARKOTA/TRAVEL, CRON pay-reconcile — Finpay v3
--
-- Perbaikan temuan tinjauan keamanan:
--   T4  ±60 RPC admin_% lama (sebelum v3) hanya memeriksa is_admin() → peran viewer/cs bisa mengubah data
--       (admin_set_user, admin_set_service_economics, admin_set_bank_verified, admin_set_antarpay_enabled, …).
--       SETIAP fungsi admin_% VOLATILE yang bisa dieksekusi authenticated dan belum memuat admin_require(
--       disisipi `perform admin_require('<izin>')` (izin sesuai domain; RPC baca → 'view'/'payments_view').
--       Pengecualian (layanan diri sendiri, bukan data orang lain): admin_set_pin, admin_unlock, admin_lock,
--       admin_log_event. admin_set_user ditulis ulang: izin admin_role + PIN, tidak boleh mengubah diri sendiri,
--       superadmin aktif terakhir tidak boleh diturunkan/dinonaktifkan.
--   R5  UPDATE/INSERT/DELETE langsung pricing_sessions, intercity_rates, travel_routes dicabut → RPC ber-PIN
--       admin_set_pricing_session / admin_set_intercity_rate / admin_set_travel_route (izin pricing, audit).
--   (b) pg_cron → pg_net → Edge Function pay-reconcile (header x-cron-secret dari gateway_secrets.extra.cron_secret):
--       antarkita_pay_reconcile_pending (tiap 15 menit) & antarkita_pay_reconcile_daily (01.30 WIB, sebelum
--       reconcile_daily SQL 02.00 WIB). Tanpa URL/secret → dilewati (tercatat), tidak pernah error.
-- Idempoten (penanda '0111 RBAC'); rollback: supabase/rollback/0111_down.sql.
-- =====================================================================

do $$
declare s text;
begin
  foreach s in array array['public.admin_set_user(uuid,user_role,boolean,text)',
    'public.admin_set_pricing_session(uuid,jsonb)', 'public.admin_set_intercity_rate(uuid,jsonb)', 'public.admin_set_travel_route(uuid,jsonb)',
    'public.admin_rpc_perm(text)', 'public.pay_reconcile_dispatch(jsonb)'] loop
    perform _mig_backup('0111', s);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 1. Peta izin RPC admin lama (dipakai migrasi & uji penjaga)
-- ---------------------------------------------------------------------
create or replace function public.admin_rpc_perm(p_name text)
returns text language sql immutable set search_path = public as $$
  select case
    when p_name in ('admin_adjust_wallet') then 'wallet_adjust'
    when p_name in ('admin_review_merchant','admin_set_merchant_status','admin_upsert_store','admin_upsert_product','admin_import_products',
                    'admin_set_product_stock','admin_upsert_market','admin_upsert_market_item','admin_set_market_prices','admin_review_market_vendor') then 'merchant'
    when p_name in ('admin_set_driver_class','admin_set_driver_status','admin_set_travel_partner','admin_review_fraud','admin_delete_partner') then 'driver'
    when p_name in ('admin_update_ticket','admin_handle_sos','admin_contact_thread','admin_resolve_report') then 'ticket'
    when p_name in ('admin_blast_promo','admin_set_promo','admin_run_automation') then 'promo'
    when p_name in ('admin_set_bank_verified') then 'payout'
    when p_name in ('admin_set_exec','admin_reset_pin','admin_finalize_account_deletion','admin_set_user') then 'admin_role'
    when p_name in ('admin_set_push_config','admin_set_map_config','admin_set_osm_config','admin_set_turn_config') then 'gateway_secret'
    when p_name in ('admin_set_antarpay_enabled','admin_set_payment_channel','admin_set_gateway_order_payment') then 'payment_config'
    when p_name in ('admin_set_service_economics','admin_set_service_enabled') then 'pricing'
    when p_name in ('admin_set_payment_channel_fee','admin_set_city_fixed_cost') then 'fee'
    when p_name in ('admin_set_merchant_ad','admin_merchant_ads') then 'ads'
    when p_name in ('admin_upsert_scheduled_report') then 'report'
    when p_name in ('admin_review_place_suggestion','admin_osm_enqueue','admin_osm_cancel','admin_osm_rapikan_kota',
                    'admin_set_city_status','admin_set_city_service','admin_set_city_manager') then 'city'
    when p_name in ('admin_gateway_status') then 'payments_view'
    when p_name in ('admin_map_status','admin_map_probe_urls','admin_turn_status','admin_osm_status','admin_list_deletion_requests') then 'view'
    -- fungsi admin_% baru yang belum terdaftar: tebak dari nama (paling ketat bila tidak cocok)
    when p_name ~ '(driver|partner|fraud)' then 'driver'
    when p_name ~ '(merchant|store|product|market|vendor)' then 'merchant'
    when p_name ~ '(ticket|sos|contact)' then 'ticket'
    when p_name ~ 'promo' then 'promo'
    when p_name ~ '(city|osm|place|map)' then 'city'
    when p_name ~ '(pricing|economics|tarif)' then 'pricing'
    when p_name ~ '(wallet|topup|withdraw|payout|bank)' then 'payout'
    when p_name ~ '(refund)' then 'refund'
    when p_name ~ '(gateway|payment|antarpay)' then 'payment_config'
    when p_name ~ '(^admin_ads?_|campaign)' then 'ads'
    else 'admin_role' end;
$$;
revoke all on function public.admin_rpc_perm(text) from public, anon, authenticated;
comment on function public.admin_rpc_perm(text) is 'Finpay v3 T4 (0111): izin admin_require untuk RPC admin_% lama menurut domain.';

-- ---------------------------------------------------------------------
-- 2. admin_set_user: izin admin_role + PIN, bukan diri sendiri, superadmin terakhir dilindungi
-- ---------------------------------------------------------------------
create or replace function public.admin_set_user(p_user uuid, p_role user_role default null, p_active boolean default null, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare b profiles;
begin
  if not is_admin() then raise exception 'Hanya admin'; end if;
  perform admin_require('admin_role');   -- 0111 RBAC
  perform admin_require_unlock();
  if p_user is null then raise exception 'Pengguna wajib diisi'; end if;
  if p_user = auth.uid() then raise exception 'SELF_CHANGE: admin tidak boleh mengubah peran/status akunnya sendiri'; end if;
  select * into b from profiles where id = p_user for update;
  if not found then raise exception 'Pengguna tidak ditemukan'; end if;
  if p_active = false and length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'Tulis alasan penonaktifan (min. 5 huruf)'; end if;
  if b.role = 'admin' and b.admin_role = 'superadmin' and b.is_active
     and ((p_role is not null and p_role <> 'admin') or p_active = false)
     and (select count(*) from profiles where role = 'admin' and is_active and admin_role = 'superadmin') <= 1 then
    raise exception 'Superadmin aktif terakhir tidak boleh diturunkan atau dinonaktifkan';
  end if;
  perform set_config('antaraja.bypass', 'on', true);
  update profiles set role = coalesce(p_role, role), is_active = coalesce(p_active, is_active),
    status_reason = case when p_active is not null then p_reason else status_reason end where id = p_user;
  perform set_config('antaraja.bypass', 'off', true);
  perform log_activity('user.status_reason', 'profiles', p_user::text, 'Akun ' || case when p_active is false then 'dinonaktifkan' when p_active then 'diaktifkan' else 'diubah' end
    || coalesce(' · alasan: ' || p_reason, '') || coalesce(' · role ' || p_role::text, ''),
    jsonb_build_object('role', p_role, 'active', p_active, 'reason', p_reason, 'before_role', b.role, 'before_admin_role', b.admin_role));
end $$;
revoke all on function public.admin_set_user(uuid, user_role, boolean, text) from public, anon;
grant execute on function public.admin_set_user(uuid, user_role, boolean, text) to authenticated;
comment on function public.admin_set_user(uuid, user_role, boolean, text) is
  'Ubah role/status akun. v3 T4 (0111): izin admin_role + PIN; akun sendiri ditolak; superadmin aktif terakhir tidak boleh diturunkan/dinonaktifkan. Promosi ke admin → admin_role viewer (atur lewat admin_set_admin_role).';

-- ---------------------------------------------------------------------
-- 3. Sisipkan admin_require ke semua RPC admin_% volatile yang belum punya
-- ---------------------------------------------------------------------
do $$
declare r record; def text; v_perm text; pos int; head text; body text; v_new text; n int := 0;
  exempt constant text[] := array['admin_set_pin','admin_unlock','admin_lock','admin_log_event','admin_require_unlock','admin_has','admin_require',
                                  'admin_role_perms','admin_role_of','admin_rpc_perm'];
begin
  for r in select p.oid, p.proname, l.lanname, 'public.' || p.proname || '(' || oidvectortypes(p.proargtypes) || ')' as sig
             from pg_proc p join pg_language l on l.oid = p.prolang
            where p.pronamespace = 'public'::regnamespace and p.proname like 'admin\_%' and p.prokind = 'f' and p.provolatile = 'v'
              and has_function_privilege('authenticated', p.oid, 'EXECUTE')
            order by p.proname loop
    continue when r.proname = any (exempt);
    def := pg_get_functiondef(r.oid);
    continue when position('admin_require(' in def) > 0;
    v_perm := admin_rpc_perm(r.proname);
    pos := position('$function$' in def);
    if pos = 0 then raise exception '0111 batal: % tidak memakai $function$ (tubuh SQL standar?) — tambal manual', r.sig; end if;
    head := left(def, pos + 9); body := substr(def, pos + 10);
    if r.lanname = 'plpgsql' then
      if body !~* '\mbegin\M' then raise exception '0111 batal: blok begin tidak ditemukan di %', r.sig; end if;
      body := regexp_replace(body, '\mbegin\M', 'begin' || E'\n  perform public.admin_require(' || quote_literal(v_perm) || ');   -- 0111 RBAC', 'i');
    elsif r.lanname = 'sql' then
      body := E'\n  select public.admin_require(' || quote_literal(v_perm) || ');   -- 0111 RBAC' || body;
    else
      raise exception '0111 batal: bahasa % di % tidak didukung', r.lanname, r.sig;
    end if;
    perform _mig_backup('0111', r.sig);
    execute head || body;
    n := n + 1;
  end loop;
  raise notice '0111: % RPC admin lama disisipi admin_require', n;
end $$;

-- ---------------------------------------------------------------------
-- 4. R5: tulis langsung tarif sesi / antarkota / rute travel → RPC ber-PIN
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['public.pricing_sessions','public.intercity_rates','public.travel_routes'] loop
    perform _mig_backup_acl('0111', t);
  end loop;
end $$;
drop policy if exists pricing_sessions_admin on public.pricing_sessions;
drop policy if exists icr_admin on public.intercity_rates;
drop policy if exists tr_admin on public.travel_routes;
revoke insert, update, delete, truncate on public.pricing_sessions, public.intercity_rates, public.travel_routes from public, anon, authenticated;

create or replace function public.admin_set_pricing_session(p_id uuid, p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b pricing_sessions; a pricing_sessions; k text;
  allowed constant text[] := array['name','level','days','start_time','end_time','multiplier','driver_bonus_pct','services','active','note','_delete'];
begin
  perform admin_require('pricing');
  perform admin_require_unlock();
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then raise exception 'Patch kosong: kirim objek {kolom: nilai}'; end if;
  for k in select jsonb_object_keys(p_patch) loop
    if not (k = any (allowed)) then raise exception 'Kolom tidak dikenal: %', k; end if;
  end loop;
  if p_id is not null then
    select * into b from pricing_sessions where id = p_id for update;
    if not found then raise exception 'Sesi harga tidak ditemukan'; end if;
    if coalesce((p_patch->>'_delete')::boolean, false) then
      delete from pricing_sessions where id = p_id;
      perform log_activity('pricing_session.deleted', 'pricing_sessions', p_id::text, 'Sesi harga ' || b.name || ' dihapus', jsonb_build_object('before', to_jsonb(b)));
      return jsonb_build_object('deleted', true, 'id', p_id);
    end if;
  end if;
  begin
    a := jsonb_populate_record(coalesce(b, null::pricing_sessions), p_patch - '_delete');
  exception when others then raise exception 'Nilai sesi harga tidak valid: %', sqlerrm; end;
  if coalesce(btrim(a.name), '') = '' or a.level is null or a.start_time is null or a.end_time is null then raise exception 'name, level, start_time, end_time wajib'; end if;
  if coalesce(a.multiplier, 1) < 0.5 or coalesce(a.multiplier, 1) > 5 then raise exception 'multiplier harus 0,5–5'; end if;
  if coalesce(a.driver_bonus_pct, 0) < 0 or coalesce(a.driver_bonus_pct, 0) > 100 then raise exception 'driver_bonus_pct harus 0–100'; end if;
  if p_id is null then
    insert into pricing_sessions (name, level, days, start_time, end_time, multiplier, driver_bonus_pct, services, active, note)
    values (a.name, a.level, coalesce(a.days, '{0,1,2,3,4,5,6}'), a.start_time, a.end_time, coalesce(a.multiplier, 1), coalesce(a.driver_bonus_pct, 0),
            a.services, coalesce(a.active, true), a.note) returning * into a;
  else
    update pricing_sessions set name = a.name, level = a.level, days = a.days, start_time = a.start_time, end_time = a.end_time, multiplier = a.multiplier,
      driver_bonus_pct = a.driver_bonus_pct, services = a.services, active = a.active, note = a.note where id = p_id returning * into a;
  end if;
  perform log_activity(case when p_id is null then 'pricing_session.created' else 'pricing_session.updated' end, 'pricing_sessions', a.id::text,
    'Sesi harga ' || a.name || case when p_id is null then ' dibuat' else ' diubah' end, jsonb_build_object('before', to_jsonb(b), 'after', to_jsonb(a)));
  return to_jsonb(a);
end $$;
revoke all on function public.admin_set_pricing_session(uuid, jsonb) from public, anon;
grant execute on function public.admin_set_pricing_session(uuid, jsonb) to authenticated;
comment on function public.admin_set_pricing_session(uuid, jsonb) is
  'Finpay v3 R5 (0111): pengganti tulis langsung pricing_sessions. p_id null = buat; {"_delete": true} = hapus. Izin pricing + PIN + audit.';

create or replace function public.admin_set_intercity_rate(p_id uuid, p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b intercity_rates; a intercity_rates; k text;
  allowed constant text[] := array['from_city','to_city','base_fare','per_kg','eta_days','active','_delete'];
begin
  perform admin_require('pricing');
  perform admin_require_unlock();
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then raise exception 'Patch kosong: kirim objek {kolom: nilai}'; end if;
  for k in select jsonb_object_keys(p_patch) loop
    if not (k = any (allowed)) then raise exception 'Kolom tidak dikenal: %', k; end if;
  end loop;
  if p_id is not null then
    select * into b from intercity_rates where id = p_id for update;
    if not found then raise exception 'Tarif antarkota tidak ditemukan'; end if;
    if coalesce((p_patch->>'_delete')::boolean, false) then
      delete from intercity_rates where id = p_id;
      perform log_activity('intercity_rate.deleted', 'intercity_rates', p_id::text, 'Tarif antarkota dihapus', jsonb_build_object('before', to_jsonb(b)));
      return jsonb_build_object('deleted', true, 'id', p_id);
    end if;
  end if;
  begin
    a := jsonb_populate_record(coalesce(b, null::intercity_rates), p_patch - '_delete');
  exception when others then raise exception 'Nilai tarif antarkota tidak valid: %', sqlerrm; end;
  if a.from_city is null or a.to_city is null or a.from_city = a.to_city then raise exception 'from_city & to_city wajib dan berbeda'; end if;
  if least(coalesce(a.base_fare, 0), coalesce(a.per_kg, 0)) < 0 or coalesce(a.eta_days, 1) < 0 or coalesce(a.eta_days, 1) > 60 then raise exception 'Nilai tarif/ETA tidak valid'; end if;
  if p_id is null then
    insert into intercity_rates (from_city, to_city, base_fare, per_kg, eta_days, active)
    values (a.from_city, a.to_city, coalesce(a.base_fare, 15000), coalesce(a.per_kg, 8000), coalesce(a.eta_days, 2), coalesce(a.active, true)) returning * into a;
  else
    update intercity_rates set from_city = a.from_city, to_city = a.to_city, base_fare = a.base_fare, per_kg = a.per_kg, eta_days = a.eta_days, active = a.active
     where id = p_id returning * into a;
  end if;
  perform log_activity(case when p_id is null then 'intercity_rate.created' else 'intercity_rate.updated' end, 'intercity_rates', a.id::text,
    'Tarif antarkota ' || case when p_id is null then 'dibuat' else 'diubah' end || ': dasar Rp' || a.base_fare || ' + Rp' || a.per_kg || '/kg',
    jsonb_build_object('before', to_jsonb(b), 'after', to_jsonb(a)));
  return to_jsonb(a);
end $$;
revoke all on function public.admin_set_intercity_rate(uuid, jsonb) from public, anon;
grant execute on function public.admin_set_intercity_rate(uuid, jsonb) to authenticated;
comment on function public.admin_set_intercity_rate(uuid, jsonb) is
  'Finpay v3 R5 (0111): pengganti tulis langsung intercity_rates. p_id null = buat; {"_delete": true} = hapus. Izin pricing + PIN + audit.';

create or replace function public.admin_set_travel_route(p_id uuid, p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b travel_routes; a travel_routes; k text; v_id uuid := p_id;
  allowed constant text[] := array['from_city','to_city','distance_km','duration_h','seat_price','private_price','private_price_large','min_pax','active','_delete'];
begin
  perform admin_require('pricing');
  perform admin_require_unlock();
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then raise exception 'Patch kosong: kirim objek {kolom: nilai}'; end if;
  for k in select jsonb_object_keys(p_patch) loop
    if not (k = any (allowed)) then raise exception 'Kolom tidak dikenal: %', k; end if;
  end loop;
  -- tanpa id: rute (from_city, to_city) yang sudah ada diperbarui (setara upsert onConflict from_city,to_city di Panel Admin lama)
  if v_id is null and p_patch ? 'from_city' and p_patch ? 'to_city' then
    select id into v_id from travel_routes where from_city = (p_patch->>'from_city')::uuid and to_city = (p_patch->>'to_city')::uuid;
  end if;
  if v_id is not null then
    select * into b from travel_routes where id = v_id for update;
    if not found then raise exception 'Rute travel tidak ditemukan'; end if;
    if coalesce((p_patch->>'_delete')::boolean, false) then
      delete from travel_routes where id = v_id;
      perform log_activity('travel_route.deleted', 'travel_routes', v_id::text, 'Rute travel dihapus', jsonb_build_object('before', to_jsonb(b)));
      return jsonb_build_object('deleted', true, 'id', v_id);
    end if;
  end if;
  begin
    a := jsonb_populate_record(coalesce(b, null::travel_routes), p_patch - '_delete');
  exception when others then raise exception 'Nilai rute travel tidak valid: %', sqlerrm; end;
  if a.from_city is null or a.to_city is null or a.from_city = a.to_city then raise exception 'from_city & to_city wajib dan berbeda'; end if;
  if a.seat_price is null or a.private_price is null or a.seat_price < 0 or a.private_price < 0 or coalesce(a.private_price_large, 0) < 0 then raise exception 'Harga kursi/privat wajib dan ≥ 0'; end if;
  if coalesce(a.min_pax, 4) < 1 or coalesce(a.min_pax, 4) > 60 then raise exception 'min_pax harus 1–60'; end if;
  if v_id is null then
    insert into travel_routes (from_city, to_city, distance_km, duration_h, seat_price, private_price, private_price_large, min_pax, active)
    values (a.from_city, a.to_city, coalesce(a.distance_km, 0), coalesce(a.duration_h, 0), a.seat_price, a.private_price, a.private_price_large,
            coalesce(a.min_pax, 4), coalesce(a.active, true)) returning * into a;
  else
    update travel_routes set from_city = a.from_city, to_city = a.to_city, distance_km = a.distance_km, duration_h = a.duration_h, seat_price = a.seat_price,
      private_price = a.private_price, private_price_large = a.private_price_large, min_pax = a.min_pax, active = a.active
     where id = v_id returning * into a;
  end if;
  perform log_activity(case when v_id is null then 'travel_route.created' else 'travel_route.updated' end, 'travel_routes', a.id::text,
    'Rute travel ' || case when v_id is null then 'dibuat' else 'diubah' end || ': kursi Rp' || a.seat_price || ', privat Rp' || a.private_price,
    jsonb_build_object('before', to_jsonb(b), 'after', to_jsonb(a)));
  return to_jsonb(a);
end $$;
revoke all on function public.admin_set_travel_route(uuid, jsonb) from public, anon;
grant execute on function public.admin_set_travel_route(uuid, jsonb) to authenticated;
comment on function public.admin_set_travel_route(uuid, jsonb) is
  'Finpay v3 R5 (0111): pengganti tulis langsung travel_routes. p_id null = buat (atau perbarui rute from_city→to_city yang sama); {"_delete": true} = hapus. Izin pricing + PIN + audit.';

-- ---------------------------------------------------------------------
-- 5. (b) Cron pay-reconcile (pg_cron → pg_net → Edge Function)
-- ---------------------------------------------------------------------
create or replace function public.pay_reconcile_dispatch(p_body jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_base text; v_url text; v_secret text; v_req bigint;
begin
  -- URL: turunan URL Edge Function push-send/osm-import yang sudah dikonfigurasi (…/functions/v1/<nama>)
  select coalesce((select function_url from push_config where id), (select function_url from osm_import_config where id)) into v_base;
  if v_base is not null and v_base ~ '/functions/v1/' then v_url := regexp_replace(v_base, '/functions/v1/.*$', '/functions/v1/pay-reconcile'); end if;
  -- secret: gateway_secrets.extra.cron_secret (diisi lewat admin_set_gateway_secret; TIDAK pernah ditulis ke log)
  select g.extra->>'cron_secret' into v_secret from gateway_secrets g
   where coalesce(g.extra->>'cron_secret', '') <> ''
   order by (g.provider = payment_provider_active()) desc, (g.env = payment_provider_env()) desc limit 1;
  if v_url is null or v_secret is null then
    return jsonb_build_object('skipped', true, 'reason', case when v_url is null then 'URL Edge Function belum diatur (push_config/osm_import_config)'
                                                             else 'gateway_secrets.extra.cron_secret belum diisi' end);
  end if;
  if to_regnamespace('net') is null then return jsonb_build_object('skipped', true, 'reason', 'ekstensi pg_net belum aktif'); end if;
  select net.http_post(url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body := coalesce(p_body, '{}'::jsonb), timeout_milliseconds := 120000) into v_req;
  return jsonb_build_object('ok', true, 'url', v_url, 'request_id', v_req, 'body', coalesce(p_body, '{}'::jsonb));
end $$;
revoke all on function public.pay_reconcile_dispatch(jsonb) from public, anon, authenticated;
comment on function public.pay_reconcile_dispatch(jsonb) is
  'Finpay v3 (b) (0111, pg_cron): POST Edge Function pay-reconcile dengan header x-cron-secret = gateway_secrets.extra.cron_secret (sama dengan env CRON_SECRET edge). Tanpa URL/secret → {skipped}.';

do $$ begin perform cron.unschedule('antarkita_pay_reconcile_pending'); exception when others then null; end $$;
do $$ begin perform cron.unschedule('antarkita_pay_reconcile_daily'); exception when others then null; end $$;
do $$ begin
  perform cron.schedule('antarkita_pay_reconcile_pending', '*/15 * * * *', $c$select public.pay_reconcile_dispatch('{"skip_daily": true}'::jsonb);$c$);
  -- 01.30 WIB: konfirmasi PAID H-1 ke provider SEBELUM reconcile_daily SQL (antarkita_reconcile_daily, 02.00 WIB)
  perform cron.schedule('antarkita_pay_reconcile_daily', '30 18 * * *', $c$select public.pay_reconcile_dispatch('{"skip_daily": true}'::jsonb);$c$);
exception when others then raise notice 'pg_cron tidak tersedia: %', sqlerrm; end $$;

-- ---------------------------------------------------------------------
-- 6. Penjaga migrasi
-- ---------------------------------------------------------------------
do $$
declare v_bad text; t text;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'admin\_%' and p.prokind = 'f' and p.provolatile = 'v'
     and has_function_privilege('authenticated', p.oid, 'EXECUTE')
     and p.proname not in ('admin_set_pin','admin_unlock','admin_lock','admin_log_event','admin_require_unlock')
     and position('admin_require(' in pg_get_functiondef(p.oid)) = 0;
  if v_bad is not null then raise exception '0111 batal: RPC admin tanpa admin_require: %', v_bad; end if;
  foreach t in array array['pricing_sessions','intercity_rates','travel_routes'] loop
    if has_table_privilege('authenticated', 'public.' || t, 'UPDATE') or has_table_privilege('authenticated', 'public.' || t, 'INSERT')
       or has_table_privilege('authenticated', 'public.' || t, 'DELETE') then
      raise exception '0111 batal: authenticated masih bisa menulis langsung ke %', t;
    end if;
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and cmd in ('INSERT','UPDATE','DELETE','ALL')) then
      raise exception '0111 batal: % masih punya kebijakan RLS tulis', t;
    end if;
  end loop;
  if position('SELF_CHANGE' in pg_get_functiondef('public.admin_set_user(uuid,user_role,boolean,text)'::regprocedure)) = 0 then
    raise exception '0111 batal: admin_set_user belum dilindungi';
  end if;
  if has_function_privilege('authenticated', 'public.pay_reconcile_dispatch(jsonb)', 'EXECUTE') then raise exception '0111 batal: pay_reconcile_dispatch terbuka'; end if;
  raise notice '0111 ok: semua RPC admin_%% volatile memuat admin_require; tulis langsung pricing_sessions/intercity_rates/travel_routes dicabut; cron pay-reconcile terdaftar';
end $$;
