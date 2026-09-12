-- =====================================================================
-- 0086 — Pengerasan keamanan (uji keamanan 12 Sep 2026: mobile, panel admin, database)
--
-- Temuan yang ditutup di sini:
--   K1  [TINGGI] Driver bisa mengubah sendiri kolom kelas kendaraan/kapasitas/skor verifikasi/masa percobaan/kode
--       lewat UPDATE langsung (policy drivers_update_own) → guard trigger diperluas.
--   K2  [SEDANG] Merchant bisa mengubah skor verifikasi/masa percobaan/alasan status sendiri → guard diperluas.
--   K3  [SEDANG] Fungsi pekerjaan latar (osm_import_tick, push_dispatch, release_scheduled_orders,
--       push_requeue_stuck, osm_auto_refresh, run_*) bisa dipanggil setiap pengguna login → hanya cron/service_role/admin.
--   K4  [SEDANG] admin_city_drivers tanpa cek admin → ditambah.
--   K5  [SEDANG] exec_login (PIN portal eksekutif) tanpa kunci percobaan → 5 gagal = kunci 15 menit.
--   K6  [RENDAH] Fungsi trigger & fungsi internal bisa di-EXECUTE anon/authenticated → dicabut.
--   K7  [RENDAH] search_path tidak dikunci pada trg_orders_client_request_id & qa_run_script.
--   K8  [RENDAH] spatial_ref_sys (PostGIS) terbaca anon/authenticated → dicabut.
--   K9  [RENDAH] app_settings terbaca anon (87 kunci) → hanya pengguna login; anon memakai app_public_settings().
-- Idempoten: aman dijalankan ulang.
-- =====================================================================

-- K1: kolom sensitif driver hanya admin (register_driver memakai antaraja.bypass, jadi tetap jalan)
create or replace function public.guard_driver_update() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if current_setting('antaraja.bypass', true) = 'on' or auth.uid() is null then return new; end if;   -- bypass eksplisit atau cron/sistem (tanpa JWT)
  if not is_admin() then
    if new.status <> old.status or new.rating_avg <> old.rating_avg or new.rating_count <> old.rating_count
       or new.total_trips <> old.total_trips or new.last_selfie_at is distinct from old.last_selfie_at
       or new.vehicle_class is distinct from old.vehicle_class
       or new.vehicle_capacity is distinct from old.vehicle_capacity
       or new.verify_score is distinct from old.verify_score
       or new.auto_verified is distinct from old.auto_verified
       or new.probation_until is distinct from old.probation_until
       or new.status_reason is distinct from old.status_reason
       or new.code is distinct from old.code
       or new.vehicle_type is distinct from old.vehicle_type
       or new.vehicle_year is distinct from old.vehicle_year
       or new.is_electric is distinct from old.is_electric then
      raise exception 'Kolom ini hanya bisa diubah admin (perubahan kendaraan lewat pendaftaran ulang driver)';
    end if;
  end if;
  return new;
end $$;

-- K2: kolom sensitif merchant hanya admin
create or replace function public.guard_merchant_update() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if current_setting('antaraja.bypass', true) = 'on' or auth.uid() is null then return new; end if;
  if not is_admin() then
    if new.status <> old.status or new.rating_avg <> old.rating_avg or new.rating_count <> old.rating_count
       or new.owner_id is distinct from old.owner_id or new.halal_verified <> old.halal_verified
       or new.verify_score is distinct from old.verify_score
       or new.auto_verified is distinct from old.auto_verified
       or new.probation_until is distinct from old.probation_until
       or new.status_reason is distinct from old.status_reason then
      raise exception 'Kolom ini hanya bisa diubah admin';
    end if;
    if new.is_halal <> old.is_halal then new.halal_verified := false; end if;
  end if;
  return new;
end $$;

-- K3/K4: penjaga pekerjaan latar — boleh: cron/postgres (auth.uid() null), service_role, admin
create or replace function public.assert_background_or_admin() returns void
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then return; end if;                                   -- pg_cron / service_role tanpa sub
  if coalesce(current_setting('request.jwt.claim.role', true), (current_setting('request.jwt.claims', true)::jsonb ->> 'role')) = 'service_role' then return; end if;
  if is_admin() then return; end if;
  raise exception 'Hanya admin';
end $$;
revoke all on function public.assert_background_or_admin() from public, anon, authenticated;

do $$
declare f record;
begin
  for f in select p.oid, p.proname, pg_get_functiondef(p.oid) def
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public'
             and p.proname in ('osm_import_tick','push_dispatch','release_scheduled_orders','push_requeue_stuck','osm_auto_refresh',
                               'run_scheduled_reports','run_retention_campaign','run_verification_backlog')
  loop
    if f.def !~ 'assert_background_or_admin' then
      if f.def ~* 'LANGUAGE sql' then
        execute format('revoke execute on function %s from anon, authenticated', f.oid::regprocedure);
        raise notice 'K3: % dicabut dari anon/authenticated (fungsi SQL)', f.proname;
      else
        execute replace(f.def, E'\nbegin\n', E'\nbegin\n  perform public.assert_background_or_admin();\n');
        raise notice 'K3: % diberi penjaga', f.proname;
      end if;
    end if;
  end loop;
end $$;
-- admin_city_drivers adalah fungsi SQL → dibuat ulang sebagai plpgsql dengan cek admin
create or replace function public.admin_city_drivers(p_city_id uuid) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare r jsonb;
begin
  if not is_admin() then raise exception 'Hanya admin'; end if;
  select jsonb_build_object(
    'approved', count(*) filter (where d.status = 'approved'),
    'online',   count(*) filter (where d.status = 'approved' and d.is_online and d.last_seen_at > now() - interval '15 minutes'),
    'recent',   count(*) filter (where d.status = 'approved' and d.last_seen_at > now() - interval '7 days'),
    'pending',  count(*) filter (where d.status = 'pending')) into r
  from drivers d
  join profiles pr on pr.id = d.id and pr.is_active
  join cities c on c.id = p_city_id
  where d.location is not null and c.location is not null
    and st_dwithin(d.location, c.location, greatest(c.radius_km, 1) * 1000);
  return r;
end $$;
grant execute on function public.admin_city_drivers(uuid) to authenticated;
revoke execute on function public.admin_city_drivers(uuid) from anon;

-- K5: kunci percobaan PIN eksekutif
alter table public.exec_access add column if not exists failed int not null default 0;
alter table public.exec_access add column if not exists locked_until timestamptz;
create or replace function public.exec_login(p_pin text) returns jsonb
language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare a exec_access%rowtype; v_token text;
begin
  select * into a from exec_access where user_id = auth.uid() and active;
  if not found then raise exception 'Akun Anda tidak memiliki akses eksekutif'; end if;
  if a.locked_until is not null and a.locked_until > now() then
    raise exception 'Terlalu banyak percobaan. Coba lagi dalam % menit.', ceil(extract(epoch from (a.locked_until - now())) / 60);
  end if;
  if p_pin is null or a.pin_hash <> crypt(p_pin, a.pin_hash) then
    update exec_access set failed = failed + 1,
      locked_until = case when failed + 1 >= 5 then now() + interval '15 minutes' else locked_until end
      where user_id = auth.uid();
    perform log_activity('exec.login_failed', 'exec_access', auth.uid()::text, 'Percobaan login eksekutif gagal (' || (a.failed + 1) || '/5)', null);
    insert into security_events (kind, user_id, detail) values ('exec.login_failed', auth.uid(), jsonb_build_object('failed', a.failed + 1));
    raise exception 'PIN eksekutif salah (%/5)', a.failed + 1;
  end if;
  delete from exec_sessions where expires_at < now();
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into exec_sessions (token, user_id, level, expires_at) values (v_token, auth.uid(), a.level, now() + interval '30 minutes');
  update exec_access set last_login_at = now(), failed = 0, locked_until = null where user_id = auth.uid();
  perform log_activity('exec.login', 'exec_access', auth.uid()::text, 'Login portal eksekutif (' || a.level || ')', null);
  return jsonb_build_object('token', v_token, 'level', a.level, 'expires_at', now() + interval '30 minutes');
end $$;

-- K6: fungsi trigger & internal tidak boleh dipanggil lewat RPC
do $$
declare f record;
begin
  for f in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and (p.prorettype = 'trigger'::regtype
              or p.proname in ('qa_run_script','osm_add_city_tasks','osm_claim_tasks','osm_config_resolved','osm_enqueue_core',
                               'osm_finish_task','osm_release_task','osm_upsert_cities','osm_upsert_places','push_enqueue',
                               'exec_pnl_data','exec_report_data','exec_recommendations','verification_score_driver','verification_score_merchant'))
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.oid::regprocedure);
  end loop;
end $$;

-- K7: search_path
alter function public.trg_orders_client_request_id() set search_path = public;
alter function public.qa_run_script(bigint, text) set search_path = public, pg_temp;

-- K8: tabel PostGIS
revoke all on table public.spatial_ref_sys from anon, authenticated;

-- K9: app_settings hanya untuk pengguna login (anon memakai app_public_settings())
drop policy if exists settings_select on public.app_settings;
create policy settings_select on public.app_settings for select to authenticated using (true);
