-- =====================================================================
-- 0075 — Penjadwalan impor OSM (pg_cron → pg_net → Edge Function osm-import)
--
-- Pola meniru push_dispatch() (0030): database menyimpan URL Edge Function +
-- kunci service_role di tabel tanpa RLS, lalu pg_cron memanggil fungsi lewat
-- pg_net. TIDAK ADA kunci yang ditulis di migrasi ini — pemilik mengisinya
-- sendiri lewat admin_set_osm_config(); selama belum diisi, tick() menjawab
-- { skipped: true, reason } dan tidak pernah error.
-- =====================================================================

create table if not exists osm_import_config (
  id           boolean primary key default true check (id),
  function_url text,
  service_key  text,
  updated_at   timestamptz not null default now()
);
alter table osm_import_config enable row level security;
revoke all on osm_import_config from anon, authenticated;
comment on table osm_import_config is
  'URL Edge Function osm-import + kunci service_role untuk pg_net. Diisi admin lewat admin_set_osm_config(). '
  'Bila kosong, dipakai nilai push_config (URL push-send diganti menjadi osm-import).';

create or replace function admin_set_osm_config(p_url text, p_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Hanya admin'; end if;
  insert into osm_import_config (id, function_url, service_key, updated_at)
  values (true, nullif(trim(coalesce(p_url, '')), ''), nullif(trim(coalesce(p_key, '')), ''), now())
  on conflict (id) do update set
    function_url = coalesce(excluded.function_url, osm_import_config.function_url),
    service_key  = coalesce(excluded.service_key,  osm_import_config.service_key),
    updated_at = now();
  perform log_activity('admin.osm_config', 'osm_import_config', 'osm', 'Konfigurasi penjadwalan impor peta diperbarui', null);
  return jsonb_build_object('ok', true);
end $$;
revoke all on function admin_set_osm_config(text, text) from public, anon;
grant execute on function admin_set_osm_config(text, text) to authenticated;

/** URL + kunci yang dipakai penjadwal; jatuh kembali ke push_config bila belum diisi. */
create or replace function osm_config_resolved()
returns table (function_url text, service_key text)
language sql stable security definer set search_path = public as $$
  select coalesce((select c.function_url from osm_import_config c where c.id),
                  (select replace(p.function_url, 'push-send', 'osm-import') from push_config p where p.id)),
         coalesce((select c.service_key from osm_import_config c where c.id),
                  (select p.service_key from push_config p where p.id))
$$;
revoke all on function osm_config_resolved() from public, anon, authenticated;

/** Dipanggil pg_cron tiap 2 menit: dorong satu potong pekerjaan yang masih antre. */
create or replace function osm_import_tick()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_url text; v_key text; v_job uuid; v_left int; v_req bigint;
begin
  select id into v_job from osm_import_jobs where status in ('pending','running') order by created_at limit 1;
  if v_job is null then return jsonb_build_object('ok', true, 'idle', true); end if;
  select count(*) into v_left from osm_import_tasks where job_id = v_job and status = 'pending';
  if v_left = 0 then return jsonb_build_object('ok', true, 'idle', true, 'job_id', v_job); end if;
  select function_url, service_key into v_url, v_key from osm_config_resolved();
  if v_url is null or v_key is null then
    return jsonb_build_object('skipped', true, 'sisa', v_left,
      'reason', 'URL/kunci Edge Function belum diisi — panggil admin_set_osm_config(url, service_role_key)');
  end if;
  if to_regnamespace('net') is null then
    return jsonb_build_object('skipped', true, 'sisa', v_left, 'reason', 'ekstensi pg_net belum aktif');
  end if;
  select net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body := jsonb_build_object('action', 'run', 'job_id', v_job),
    timeout_milliseconds := 120000) into v_req;
  return jsonb_build_object('ok', true, 'job_id', v_job, 'sisa', v_left, 'request_id', v_req);
end $$;
revoke all on function osm_import_tick() from public, anon;
grant execute on function osm_import_tick() to authenticated;

-- ---------------------------------------------------------------------
-- Inti pembuatan pekerjaan dipisah agar bisa dipakai penjadwal (tanpa admin)
-- dan tombol admin (dengan pemeriksaan is_admin). Menggantikan isi
-- admin_osm_enqueue dari 0073 tanpa mengubah tanda tangannya.
-- ---------------------------------------------------------------------
create or replace function osm_enqueue_core(p_target text, p_scope text, p_province text, p_city_id uuid,
                                            p_max_per_task int, p_by uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_job uuid; v_n int := 0;
  v_max int := greatest(50, least(coalesce(p_max_per_task, setting_num('osm_import_max_per_task', 600)::int), 3000));
begin
  if not coalesce((select value::text::boolean from app_settings where key = 'osm_import_enabled'), true) then
    return jsonb_build_object('skipped', true, 'reason', 'Impor peta sedang dimatikan (app_settings.osm_import_enabled)');
  end if;
  if p_target not in ('kota','apotek','pasar','minimarket','supermarket','faskes','semua') then raise exception 'Jenis data tidak dikenal'; end if;
  if p_scope not in ('nasional','provinsi','kota') then raise exception 'Cakupan tidak dikenal'; end if;
  if p_scope = 'provinsi' and coalesce(trim(p_province), '') = '' then raise exception 'Pilih provinsi dulu'; end if;
  if p_scope = 'kota' and p_city_id is null then raise exception 'Pilih kota dulu'; end if;
  if exists (select 1 from osm_import_jobs where status in ('pending','running')) then
    return jsonb_build_object('skipped', true, 'reason', 'Masih ada pekerjaan impor yang berjalan — tunggu selesai atau batalkan dulu');
  end if;

  insert into osm_import_jobs (target, scope, province, city_id, max_per_task, status, created_by, note)
  values (p_target, p_scope, nullif(trim(p_province), ''), p_city_id, v_max, 'pending', p_by, p_note)
  returning id into v_job;

  if p_target = 'kota' then
    if p_scope = 'nasional' then
      insert into osm_import_tasks (job_id, seq, kind, target) values (v_job, 0, 'provinsi_discover', 'kota');
      v_n := 1;
    elsif p_scope = 'provinsi' then
      insert into osm_import_tasks (job_id, seq, kind, target, province) values (v_job, 0, 'kota', 'kota', trim(p_province));
      v_n := 1;
    else
      raise exception 'Impor daftar kota hanya untuk cakupan nasional atau provinsi';
    end if;
  else
    insert into osm_import_tasks (job_id, seq, kind, target, province, city_id, city_name, area_osm_id, lat, lng, radius_km)
    select v_job, row_number() over (order by c.population desc nulls last, c.name), 'tempat', p_target,
           c.province, c.id, c.name, c.osm_id, c.lat, c.lng, coalesce(c.radius_km, 25)
      from cities c
     where c.location is not null
       and (p_scope = 'nasional'
            or (p_scope = 'provinsi' and lower(coalesce(c.province,'')) = lower(trim(p_province)))
            or (p_scope = 'kota' and c.id = p_city_id));
    get diagnostics v_n = row_count;
  end if;

  if v_n = 0 then
    update osm_import_jobs set status = 'failed', note = 'Tidak ada kota yang cocok — impor daftar kota dulu', finished_at = now() where id = v_job;
    return jsonb_build_object('skipped', true, 'reason', 'Belum ada kota pada cakupan itu. Jalankan impor "Daftar kota" lebih dulu.', 'job_id', v_job);
  end if;
  update osm_import_jobs set tasks_total = v_n where id = v_job;
  perform log_activity('osm.job_created', 'osm_import_jobs', v_job::text,
    format('Impor peta dibuat: %s (%s) — %s tugas', p_target, p_scope, v_n),
    jsonb_build_object('target', p_target, 'scope', p_scope, 'province', p_province, 'city_id', p_city_id, 'tasks', v_n, 'by', p_by));
  return jsonb_build_object('ok', true, 'job_id', v_job, 'tasks', v_n);
end $$;
revoke all on function osm_enqueue_core(text, text, text, uuid, int, uuid, text) from public, anon, authenticated;

create or replace function admin_osm_enqueue(p_target text, p_scope text default 'nasional',
                                             p_province text default null, p_city_id uuid default null,
                                             p_max_per_task int default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Hanya admin'; end if;
  return osm_enqueue_core(p_target, p_scope, p_province, p_city_id, p_max_per_task, auth.uid(), null);
end $$;
revoke all on function admin_osm_enqueue(text, text, text, uuid, int) from public, anon;
grant execute on function admin_osm_enqueue(text, text, text, uuid, int) to authenticated;

/** Penyegaran berkala (default MATI). Aktifkan dengan app_settings.osm_auto_refresh_enabled = true. */
create or replace function osm_auto_refresh()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_last timestamptz; v_days numeric := setting_num('osm_auto_refresh_days', 30);
begin
  if not coalesce((select value::text::boolean from app_settings where key = 'osm_auto_refresh_enabled'), false) then
    return jsonb_build_object('skipped', true, 'reason', 'penyegaran otomatis dimatikan (osm_auto_refresh_enabled)');
  end if;
  select max(created_at) into v_last from osm_import_jobs where target = 'semua' and scope = 'nasional';
  if v_last is not null and v_last > now() - make_interval(days => v_days::int) then
    return jsonb_build_object('skipped', true, 'reason', format('impor nasional terakhir %s — belum waktunya', v_last));
  end if;
  return osm_enqueue_core('semua', 'nasional', null, null, null, null, 'penyegaran otomatis');
end $$;
revoke all on function osm_auto_refresh() from public, anon, authenticated;

insert into app_settings (key, value) values
  ('osm_auto_refresh_enabled', 'false'),
  ('osm_auto_refresh_days', '30')
on conflict (key) do nothing;

-- Jadwal: dorong antrean tiap 2 menit; cek penyegaran tiap hari pukul 02.00 WIB (19.00 UTC).
do $$ begin
  perform cron.unschedule('antarkita_osm_import');
exception when others then null; end $$;
do $$ begin
  perform cron.schedule('antarkita_osm_import', '*/2 * * * *', $c$select public.osm_import_tick();$c$);
exception when others then raise notice 'pg_cron tidak tersedia: %', sqlerrm; end $$;
do $$ begin
  perform cron.unschedule('antarkita_osm_refresh');
exception when others then null; end $$;
do $$ begin
  perform cron.schedule('antarkita_osm_refresh', '0 19 * * *', $c$select public.osm_auto_refresh();$c$);
exception when others then raise notice 'pg_cron tidak tersedia: %', sqlerrm; end $$;
