-- =====================================================================
-- 0073 — Antrean pekerjaan impor OSM (tahan timeout Edge Function)
--
-- Overpass tidak boleh ditembak dengan satu kueri raksasa "seluruh Indonesia":
-- pasti timeout dan melanggar etika pemakaian. Karena itu pekerjaan dipecah
-- menjadi SATU TUGAS PER KOTA/KABUPATEN (atau per provinsi untuk impor kota),
-- disimpan di tabel ini, lalu dikerjakan potong demi potong oleh Edge Function
-- `osm-import`. Setiap panggilan Edge Function hanya mengambil beberapa tugas
-- (sesuai anggaran waktu ±55 detik) lalu berhenti; sisa tugas dilanjutkan oleh
-- panggilan berikutnya (tombol admin atau pg_cron). Kemajuan tidak hilang.
-- =====================================================================

create table if not exists osm_import_jobs (
  id           uuid primary key default gen_random_uuid(),
  target       text not null,
  scope        text not null,
  province     text,
  city_id      uuid references cities(id) on delete set null,
  status       text not null default 'pending',
  max_per_task int  not null default 600,
  tasks_total  int  not null default 0,
  tasks_done   int  not null default 0,
  tasks_failed int  not null default 0,
  fetched      int  not null default 0,
  inserted     int  not null default 0,
  updated      int  not null default 0,
  skipped      int  not null default 0,
  counts       jsonb not null default '{}'::jsonb,
  note         text,
  created_by   uuid references profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  started_at   timestamptz,
  finished_at  timestamptz,
  updated_at   timestamptz not null default now()
);
do $$ begin
  alter table osm_import_jobs add constraint osm_jobs_target_chk
    check (target in ('kota','apotek','pasar','minimarket','supermarket','faskes','semua'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table osm_import_jobs add constraint osm_jobs_scope_chk check (scope in ('nasional','provinsi','kota'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table osm_import_jobs add constraint osm_jobs_status_chk
    check (status in ('pending','running','done','cancelled','failed'));
exception when duplicate_object then null; end $$;

create table if not exists osm_import_tasks (
  id          bigserial primary key,
  job_id      uuid not null references osm_import_jobs(id) on delete cascade,
  seq         int  not null default 0,
  kind        text not null,
  target      text not null,
  province    text,
  city_id     uuid references cities(id) on delete cascade,
  city_name   text,
  area_osm_id text,
  lat         double precision,
  lng         double precision,
  radius_km   numeric,
  status      text not null default 'pending',
  attempts    int  not null default 0,
  fetched     int,
  inserted    int,
  updated     int,
  skipped     int,
  counts      jsonb,
  endpoint    text,
  error       text,
  claimed_at  timestamptz,
  finished_at timestamptz,
  created_at  timestamptz not null default now()
);
do $$ begin
  alter table osm_import_tasks add constraint osm_tasks_kind_chk
    check (kind in ('provinsi_discover','kota','tempat'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table osm_import_tasks add constraint osm_tasks_status_chk
    check (status in ('pending','running','done','failed','skipped'));
exception when duplicate_object then null; end $$;

create index if not exists osm_tasks_job_status_idx on osm_import_tasks (job_id, status, seq);
create index if not exists osm_tasks_status_idx on osm_import_tasks (status) where status in ('pending','running');
create index if not exists osm_jobs_status_idx on osm_import_jobs (status, created_at desc);

comment on table osm_import_jobs is 'Pekerjaan impor OpenStreetMap (satu permintaan admin / jadwal). Lihat Edge Function osm-import.';
comment on table osm_import_tasks is 'Potongan pekerjaan impor: satu baris = satu kueri Overpass (satu kota / satu provinsi).';

alter table osm_import_jobs  enable row level security;
alter table osm_import_tasks enable row level security;
drop policy if exists osm_jobs_admin on osm_import_jobs;
create policy osm_jobs_admin  on osm_import_jobs  for select to authenticated using (is_admin());
drop policy if exists osm_tasks_admin on osm_import_tasks;
create policy osm_tasks_admin on osm_import_tasks for select to authenticated using (is_admin());
revoke all on osm_import_jobs, osm_import_tasks from anon, authenticated;
grant select on osm_import_jobs, osm_import_tasks to authenticated;

drop trigger if exists t_osm_jobs_upd on osm_import_jobs;
create trigger t_osm_jobs_upd before update on osm_import_jobs for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- Admin: buat pekerjaan + pecah menjadi tugas per kota/provinsi
-- ---------------------------------------------------------------------
create or replace function admin_osm_enqueue(p_target text, p_scope text default 'nasional',
                                             p_province text default null, p_city_id uuid default null,
                                             p_max_per_task int default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_job uuid; v_n int := 0; v_max int := greatest(50, least(coalesce(p_max_per_task, setting_num('osm_import_max_per_task', 600)::int), 3000));
begin
  if not is_admin() then raise exception 'Hanya admin'; end if;
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

  insert into osm_import_jobs (target, scope, province, city_id, max_per_task, status, created_by)
  values (p_target, p_scope, nullif(trim(p_province), ''), p_city_id, v_max, 'pending', auth.uid())
  returning id into v_job;

  if p_target = 'kota' then
    if p_scope = 'nasional' then
      -- daftar provinsi diambil dari OSM juga (tidak dikarang): satu tugas penemuan dulu
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
    jsonb_build_object('target', p_target, 'scope', p_scope, 'province', p_province, 'city_id', p_city_id, 'tasks', v_n));
  return jsonb_build_object('ok', true, 'job_id', v_job, 'tasks', v_n);
end $$;
revoke all on function admin_osm_enqueue(text, text, text, uuid, int) from public, anon;
grant execute on function admin_osm_enqueue(text, text, text, uuid, int) to authenticated;

-- ---------------------------------------------------------------------
-- Edge Function (service_role): ambil tugas, kembalikan hasil
-- ---------------------------------------------------------------------
create or replace function osm_claim_tasks(p_job uuid default null, p_limit int default 4)
returns setof osm_import_tasks language plpgsql security definer set search_path = public as $$
declare v_job uuid;
begin
  -- tugas yang tersangkut > 10 menit dikembalikan ke antrean
  update osm_import_tasks set status = 'pending'
   where status = 'running' and attempts < 3 and claimed_at < now() - interval '10 minutes';
  update osm_import_tasks set status = 'failed', error = coalesce(error, 'melebihi 3 percobaan'), finished_at = now()
   where status = 'running' and attempts >= 3 and claimed_at < now() - interval '10 minutes';

  select id into v_job from osm_import_jobs
   where (p_job is null or id = p_job) and status in ('pending','running')
   order by created_at limit 1;
  if v_job is null then return; end if;
  update osm_import_jobs set status = 'running', started_at = coalesce(started_at, now()) where id = v_job and status = 'pending';

  return query
  with c as (
    select id from osm_import_tasks
     where job_id = v_job and status = 'pending'
     order by seq limit greatest(1, least(coalesce(p_limit, 4), 20))
     for update skip locked)
  update osm_import_tasks t set status = 'running', attempts = t.attempts + 1, claimed_at = now()
    from c where t.id = c.id returning t.*;
end $$;
revoke all on function osm_claim_tasks(uuid, int) from public, anon, authenticated;
grant execute on function osm_claim_tasks(uuid, int) to service_role;

create or replace function osm_finish_task(p_task bigint, p_status text, p_stats jsonb default '{}'::jsonb,
                                           p_error text default null, p_endpoint text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t osm_import_tasks%rowtype; j osm_import_jobs%rowtype; v_left int; k text;
begin
  if p_status not in ('done','failed','skipped') then raise exception 'Status tugas tidak valid'; end if;
  update osm_import_tasks set
    status = p_status, finished_at = now(),
    fetched = coalesce((p_stats->>'fetched')::int, 0), inserted = coalesce((p_stats->>'inserted')::int, 0),
    updated = coalesce((p_stats->>'updated')::int, 0), skipped = coalesce((p_stats->>'skipped')::int, 0),
    counts = coalesce(p_stats->'counts', '{}'::jsonb), error = left(nullif(p_error, ''), 500), endpoint = p_endpoint
   where id = p_task returning * into t;
  if t.id is null then return jsonb_build_object('ok', false, 'reason', 'tugas tidak ditemukan'); end if;

  update osm_import_jobs set
    tasks_done   = tasks_done + case when p_status <> 'failed' then 1 else 0 end,
    tasks_failed = tasks_failed + case when p_status = 'failed' then 1 else 0 end,
    fetched  = fetched  + coalesce(t.fetched, 0),
    inserted = inserted + coalesce(t.inserted, 0),
    updated  = updated  + coalesce(t.updated, 0),
    skipped  = skipped  + coalesce(t.skipped, 0)
   where id = t.job_id returning * into j;

  -- gabungkan pencacah per kategori
  if t.counts is not null and t.counts <> '{}'::jsonb then
    for k in select jsonb_object_keys(t.counts) loop
      update osm_import_jobs set counts = counts || jsonb_build_object(k, coalesce((counts->>k)::int, 0) + coalesce((t.counts->>k)::int, 0))
       where id = t.job_id;
    end loop;
  end if;

  select count(*) into v_left from osm_import_tasks where job_id = t.job_id and status in ('pending','running');
  if v_left = 0 then
    update osm_import_jobs set status = case when tasks_failed >= greatest(1, tasks_total) then 'failed' else 'done' end,
                               finished_at = now() where id = t.job_id returning * into j;
    perform log_activity('osm.job_done', 'osm_import_jobs', j.id::text,
      format('Impor peta selesai: %s (%s) — %s baru, %s diperbarui, %s dilewati, %s tugas gagal',
             j.target, j.scope, j.inserted, j.updated, j.skipped, j.tasks_failed),
      jsonb_build_object('target', j.target, 'scope', j.scope, 'counts', j.counts,
                         'inserted', j.inserted, 'updated', j.updated, 'skipped', j.skipped,
                         'tasks_total', j.tasks_total, 'tasks_failed', j.tasks_failed));
  end if;
  return jsonb_build_object('ok', true, 'job_status', j.status, 'sisa', v_left);
end $$;
revoke all on function osm_finish_task(bigint, text, jsonb, text, text) from public, anon, authenticated;
grant execute on function osm_finish_task(bigint, text, jsonb, text, text) to service_role;

/** Tambah tugas per provinsi setelah tahap penemuan (dipanggil Edge Function). */
create or replace function osm_add_city_tasks(p_job uuid, p_provinces jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_n int := 0; v_base int;
begin
  select coalesce(max(seq), 0) into v_base from osm_import_tasks where job_id = p_job;
  insert into osm_import_tasks (job_id, seq, kind, target, province)
  select p_job, v_base + row_number() over (order by x.value->>'name'), 'kota', 'kota', x.value->>'name'
    from jsonb_array_elements(coalesce(p_provinces, '[]'::jsonb)) x
   where coalesce(trim(x.value->>'name'), '') <> ''
     and not exists (select 1 from osm_import_tasks t where t.job_id = p_job and t.kind = 'kota' and lower(t.province) = lower(x.value->>'name'));
  get diagnostics v_n = row_count;
  update osm_import_jobs set tasks_total = tasks_total + v_n where id = p_job;
  return jsonb_build_object('ok', true, 'tasks', v_n);
end $$;
revoke all on function osm_add_city_tasks(uuid, jsonb) from public, anon, authenticated;
grant execute on function osm_add_city_tasks(uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------
-- Admin: pantau & batalkan
-- ---------------------------------------------------------------------
create or replace function admin_osm_cancel(p_job uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if not is_admin() then raise exception 'Hanya admin'; end if;
  update osm_import_tasks set status = 'skipped', finished_at = now(), error = 'dibatalkan admin'
   where job_id = p_job and status in ('pending','running');
  get diagnostics v_n = row_count;
  update osm_import_jobs set status = 'cancelled', finished_at = now() where id = p_job and status in ('pending','running');
  perform log_activity('osm.job_cancelled', 'osm_import_jobs', p_job::text, format('Impor peta dibatalkan (%s tugas tersisa dibuang)', v_n), null);
  return jsonb_build_object('ok', true, 'dibatalkan', v_n);
end $$;
revoke all on function admin_osm_cancel(uuid) from public, anon;
grant execute on function admin_osm_cancel(uuid) to authenticated;

create or replace function admin_osm_status(p_limit int default 8)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if not is_admin() then raise exception 'Hanya admin'; end if;
  select jsonb_build_object(
    'jobs', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
        select j.*, (select count(*) from osm_import_tasks t where t.job_id = j.id and t.status = 'pending') as tasks_pending,
               (select count(*) from osm_import_tasks t where t.job_id = j.id and t.status = 'running') as tasks_running,
               (select c.name from cities c where c.id = j.city_id) as city_name
          from osm_import_jobs j order by j.created_at desc limit greatest(1, least(coalesce(p_limit, 8), 50))) x), '[]'::jsonb),
    'gagal', coalesce((select jsonb_agg(jsonb_build_object('kota', t.city_name, 'provinsi', t.province, 'error', t.error, 'waktu', t.finished_at))
                        from (select * from osm_import_tasks where status = 'failed' order by finished_at desc nulls last limit 10) t), '[]'::jsonb),
    'data', jsonb_build_object(
      'kota_total',       (select count(*) from cities),
      'kota_osm',         (select count(*) from cities where source = 'osm'),
      'kota_dilayani',    (select count(*) from cities where coalesce(service_status, 'belum_dilayani') = 'aktif'),
      'apotek',           (select count(*) from shop_stores where category = 'apotek'),
      'minimarket',       (select count(*) from shop_stores where category = 'minimarket'),
      'supermarket',      (select count(*) from shop_stores where category = 'supermarket'),
      'toko_total',       (select count(*) from shop_stores),
      'toko_osm',         (select count(*) from shop_stores where osm_id is not null),
      'pasar',            (select count(*) from markets),
      'pasar_osm',        (select count(*) from markets where osm_id is not null),
      'faskes',           (select count(*) from poi_places where category = 'faskes'),
      'rumah_sakit',      (select count(*) from poi_places where kind = 'rumah_sakit'),
      'klinik',           (select count(*) from poi_places where kind in ('klinik','puskesmas','dokter')),
      'tanpa_kota',       (select count(*) from shop_stores where city_id is null) + (select count(*) from markets where city_id is null) + (select count(*) from poi_places where city_id is null)),
    'terakhir', jsonb_build_object(
      'kota',   (select max(imported_at) from cities),
      'toko',   (select max(updated_at) from shop_stores where osm_id is not null),
      'pasar',  (select max(updated_at) from markets where osm_id is not null),
      'faskes', (select max(updated_at) from poi_places)),
    'pengaturan', jsonb_build_object(
      'osm_import_enabled', coalesce((select value::text::boolean from app_settings where key = 'osm_import_enabled'), true),
      'osm_city_assign_max_km', setting_num('osm_city_assign_max_km', 60),
      'osm_import_max_per_task', setting_num('osm_import_max_per_task', 600)),
    'provinsi', coalesce((select jsonb_agg(q.p order by q.p) from (select distinct province as p from cities where province is not null) q), '[]'::jsonb)
  ) into v;
  return v;
end $$;
revoke all on function admin_osm_status(int) from public, anon;
grant execute on function admin_osm_status(int) to authenticated;
