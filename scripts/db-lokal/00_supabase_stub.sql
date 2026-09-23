-- =====================================================================
-- 00_supabase_stub.sql — tiruan (stub) lapisan platform Supabase untuk
-- PostgreSQL 16 LOKAL, agar supabase/migrations/*.sql, seed.sql, dan
-- supabase/tests/*.sql bisa dijalankan tanpa menyentuh produksi.
--
-- Dijalankan oleh scripts/db-lokal.sh (perintah `reset` / `migrate`).
-- IDEMPOTEN: aman dijalankan berulang pada database yang sama.
-- JANGAN dijalankan di proyek Supabase sungguhan — di sana semua objek
-- ini sudah disediakan platform (GoTrue, Storage, pg_cron, pg_net).
--
-- Yang ditiru (hasil grep `auth\.|storage\.|extensions\.|net\.|cron\.|
-- realtime` pada migrasi + seed + tests):
--   1. Peran  : anon, authenticated, service_role, supabase_admin,
--               authenticator, supabase_auth_admin, supabase_storage_admin
--               (0003 memberi grant ke supabase_auth_admin; grant lain ke
--               anon/authenticated/service_role/postgres).
--   2. Skema  : auth, storage, extensions, graphql_public, cron, net.
--   3. Ekstensi: pgcrypto & uuid-ossp di `extensions` (letak bawaan
--               Supabase; migrasi memakai extensions.crypt/gen_salt/
--               gen_random_bytes dan seed memakai crypt() tanpa prefiks
--               lewat search_path). postgis & pg_trgm di `public` — sama
--               seperti produksi (0001/0018 membuatnya tanpa `with schema`,
--               0040 mengecek public.spatial_ref_sys).
--   4. search_path database = "$user", public, extensions (seperti
--               `postgres` db di Supabase).
--   5. auth.users + auth.identities (kolom GoTrue yang dipakai migrasi,
--               seed, dan simulasi_e2e S35), auth.uid()/role()/jwt()/email()
--               membaca `request.jwt.claims` (dipakai tests lewat
--               set_config('request.jwt.claims', ..., true)).
--   6. storage.buckets, storage.objects (RLS), storage.foldername/
--               filename/extension — 0002/0007/0024 membuat policy di sini.
--   7. Publication `supabase_realtime` (0002/0006/0007/0009/0011/0015/0028
--               melakukan `alter publication supabase_realtime add table`).
--   8. Shim pg_cron: cron.job + cron.schedule()/unschedule() — hanya
--               MENCATAT jadwal, tidak pernah menjalankan apa pun
--               (0019 memanggil cron.schedule di luar blok DO → wajib ada).
--   9. Shim pg_net: net.http_post()/http_get() — hanya mencatat ke
--               net._lokal_http_log dan mengembalikan id palsu
--               (0030 push_dispatch mengecek to_regnamespace('net')).
--  10. Placeholder public.qa_run_script(bigint, text) — ada di produksi
--               tanpa migrasi; 0086 melakukan ALTER FUNCTION padanya.
--  11. _lokal.migrasi — pencatat migrasi yang sudah diterapkan (db-lokal.sh).
-- Juga: hak bawaan proyek Supabase pada skema public (default privileges
-- FOR ROLE postgres → anon/authenticated/service_role), dan kepemilikan
-- skema auth/storage oleh supabase_auth_admin/supabase_storage_admin.
-- Rincian & alasan tiap butir: docs/UJI-DB-LOKAL.md.
-- =====================================================================

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------
-- 1. Peran
-- ---------------------------------------------------------------------
do $$
declare r text;
begin
  foreach r in array array['anon','authenticated','service_role','supabase_admin',
                           'authenticator','supabase_auth_admin','supabase_storage_admin']
  loop
    if not exists (select 1 from pg_roles where rolname = r) then
      execute format('create role %I nologin', r);
    end if;
  end loop;
  -- service_role & supabase_admin melewati RLS seperti di Supabase
  execute 'alter role service_role bypassrls';
  execute 'alter role supabase_admin bypassrls';
  -- authenticator boleh berganti ke peran API (meniru PostgREST)
  execute 'grant anon, authenticated, service_role to authenticator';
end $$;

-- ---------------------------------------------------------------------
-- 2. Skema
-- ---------------------------------------------------------------------
create schema if not exists auth;
create schema if not exists storage;
create schema if not exists extensions;
create schema if not exists graphql_public;
create schema if not exists cron;
create schema if not exists net;

-- Seperti di Supabase: skema auth milik supabase_auth_admin, storage milik
-- supabase_storage_admin. Penting: pemeriksaan FK auth.identities → auth.users
-- dijalankan sebagai PEMILIK tabel pengacu; tanpa USAGE pada skema auth,
-- seed.sql gagal dengan "permission denied for schema auth".
alter schema auth    owner to supabase_auth_admin;
alter schema storage owner to supabase_storage_admin;
grant usage on schema auth, storage, extensions, graphql_public
  to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role, supabase_auth_admin;

-- Hak bawaan proyek Supabase pada skema public (dibuat platform saat proyek
-- lahir): setiap tabel/sequence/fungsi baru milik `postgres` otomatis boleh
-- diakses anon/authenticated/service_role; RLS yang membatasi. Tanpa ini,
-- `set local role authenticated` di simulasi_e2e S31 gagal dengan
-- "permission denied for table order_messages". Migrasi 0003 kemudian
-- mencabut bagian FUNGSI dari hak bawaan ini (tetap berlaku di sini).
grant all on all tables    in schema public to postgres, anon, authenticated, service_role;
grant all on all sequences in schema public to postgres, anon, authenticated, service_role;
grant all on all functions in schema public to postgres, anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on tables    to postgres, anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to postgres, anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on functions to postgres, anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3. Ekstensi + 4. search_path
-- ---------------------------------------------------------------------
create extension if not exists pgcrypto    with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists postgis     with schema public;
create extension if not exists pg_trgm     with schema public;
grant execute on all functions in schema extensions to anon, authenticated, service_role;
alter default privileges in schema extensions grant execute on functions to anon, authenticated, service_role;

do $$ begin
  execute format('alter database %I set search_path = "$user", public, extensions', current_database());
end $$;
set search_path = "$user", public, extensions;

-- ---------------------------------------------------------------------
-- 5. auth.* (GoTrue)
-- ---------------------------------------------------------------------
create table if not exists auth.users (
  instance_id                 uuid,
  id                          uuid primary key,
  aud                         varchar(255),
  role                        varchar(255),
  email                       varchar(255),
  encrypted_password          varchar(255),
  email_confirmed_at          timestamptz,
  invited_at                  timestamptz,
  confirmation_token          varchar(255),
  confirmation_sent_at        timestamptz,
  recovery_token              varchar(255),
  recovery_sent_at            timestamptz,
  email_change_token_new      varchar(255),
  email_change                varchar(255),
  email_change_sent_at        timestamptz,
  last_sign_in_at             timestamptz,
  raw_app_meta_data           jsonb,
  raw_user_meta_data          jsonb,
  is_super_admin              boolean,
  created_at                  timestamptz,
  updated_at                  timestamptz,
  phone                       text unique,
  phone_confirmed_at          timestamptz,
  phone_change                text default '',
  phone_change_token          varchar(255) default '',
  phone_change_sent_at        timestamptz,
  confirmed_at                timestamptz generated always as (least(email_confirmed_at, phone_confirmed_at)) stored,
  email_change_token_current  varchar(255) default '',
  email_change_confirm_status smallint default 0,
  banned_until                timestamptz,
  reauthentication_token      varchar(255) default '',
  reauthentication_sent_at    timestamptz,
  is_sso_user                 boolean not null default false,
  deleted_at                  timestamptz,
  is_anonymous                boolean not null default false
);
create unique index if not exists users_email_partial_key on auth.users (email) where is_sso_user = false;
create index if not exists users_instance_id_idx on auth.users (instance_id);

create table if not exists auth.identities (
  provider_id     text not null,
  user_id         uuid not null references auth.users(id) on delete cascade,
  identity_data   jsonb not null,
  provider        text not null,
  last_sign_in_at timestamptz,
  created_at      timestamptz,
  updated_at      timestamptz,
  email           text generated always as (lower(identity_data ->> 'email')) stored,
  id              uuid primary key default gen_random_uuid(),
  constraint identities_provider_id_provider_unique unique (provider_id, provider)
);
create index if not exists identities_user_id_idx on auth.identities (user_id);
create index if not exists identities_email_idx on auth.identities (email text_pattern_ops);

-- Seperti di Supabase: tabel auth.* milik supabase_auth_admin, tidak bisa
-- dibaca peran API. Migrasi/tests berjalan sebagai superuser sehingga
-- tetap bisa menulisnya.
alter table auth.users      owner to supabase_auth_admin;
alter table auth.identities owner to supabase_auth_admin;
revoke all on auth.users, auth.identities from anon, authenticated;

-- auth.uid(): sub dari klaim JWT (request.jwt.claim.sub ATAU request.jwt.claims::jsonb->>'sub');
-- null bila tidak ada (koneksi langsung / belum set_config).
create or replace function auth.uid() returns uuid
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create or replace function auth.role() returns text
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;

create or replace function auth.email() returns text
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
  )::text
$$;

create or replace function auth.jwt() returns jsonb
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;

grant execute on function auth.uid(), auth.role(), auth.email(), auth.jwt()
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 6. storage.* (Supabase Storage)
-- ---------------------------------------------------------------------
create table if not exists storage.buckets (
  id                 text primary key,
  name               text not null unique,
  owner              uuid,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now(),
  public             boolean default false,
  avif_autodetection boolean default false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  owner_id           text
);

create table if not exists storage.objects (
  id               uuid primary key default gen_random_uuid(),
  bucket_id        text references storage.buckets(id),
  name             text,
  owner            uuid,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now(),
  last_accessed_at timestamptz default now(),
  metadata         jsonb,
  path_tokens      text[] generated always as (string_to_array(name, '/')) stored,
  version          text,
  owner_id         text,
  user_metadata    jsonb
);
create unique index if not exists bucketid_objname on storage.objects (bucket_id, name);
create index if not exists name_prefix_search on storage.objects (name text_pattern_ops);
alter table storage.objects enable row level security;
alter table storage.buckets enable row level security;

alter table storage.buckets owner to supabase_storage_admin;
alter table storage.objects owner to supabase_storage_admin;
grant select on storage.buckets to anon, authenticated, service_role;
grant all on storage.objects, storage.buckets to service_role;
grant select, insert, update, delete on storage.objects to anon, authenticated;

create or replace function storage.foldername(name text) returns text[]
language plpgsql immutable as $$
declare _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1:array_length(_parts, 1) - 1];
end $$;

create or replace function storage.filename(name text) returns text
language plpgsql immutable as $$
declare _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[array_length(_parts, 1)];
end $$;

create or replace function storage.extension(name text) returns text
language plpgsql immutable as $$
declare _parts text[]; _filename text;
begin
  select string_to_array(name, '/') into _parts;
  select _parts[array_length(_parts, 1)] into _filename;
  return reverse(split_part(reverse(_filename), '.', 1));
end $$;

grant execute on function storage.foldername(text), storage.filename(text), storage.extension(text)
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 7. Publication realtime
-- ---------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    execute 'create publication supabase_realtime';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 8. Shim pg_cron (mencatat saja, tidak mengeksekusi)
-- ---------------------------------------------------------------------
create table if not exists cron.job (
  jobid    bigserial primary key,
  schedule text not null,
  command  text not null,
  nodename text not null default 'localhost',
  nodeport int  not null default 5432,
  database text not null default current_database(),
  username text not null default current_user,
  active   boolean not null default true,
  jobname  text unique
);
create table if not exists cron.job_run_details (
  jobid       bigint,
  runid       bigserial primary key,
  job_pid     int,
  database    text,
  username    text,
  command     text,
  status      text,
  return_message text,
  start_time  timestamptz,
  end_time    timestamptz
);

create or replace function cron.schedule(job_name text, schedule text, command text) returns bigint
language plpgsql as $$
declare v_id bigint;
begin
  insert into cron.job (jobname, schedule, command)
  values (job_name, schedule, command)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command, active = true
  returning jobid into v_id;
  return v_id;
end $$;

create or replace function cron.schedule(schedule text, command text) returns bigint
language plpgsql as $$
declare v_id bigint;
begin
  insert into cron.job (schedule, command) values (schedule, command) returning jobid into v_id;
  return v_id;
end $$;

create or replace function cron.unschedule(job_id bigint) returns boolean
language plpgsql as $$
begin
  delete from cron.job where jobid = job_id;
  if not found then raise exception 'could not find valid entry for job %', job_id; end if;
  return true;
end $$;

create or replace function cron.unschedule(job_name text) returns boolean
language plpgsql as $$
begin
  delete from cron.job where jobname = job_name;
  if not found then raise exception 'could not find valid entry for job ''%''', job_name; end if;
  return true;
end $$;

-- ---------------------------------------------------------------------
-- 9. Shim pg_net (mencatat saja, tidak ada HTTP keluar)
-- ---------------------------------------------------------------------
create table if not exists net._lokal_http_log (
  id         bigserial primary key,
  method     text not null,
  url        text not null,
  headers    jsonb,
  body       jsonb,
  params     jsonb,
  timeout_ms int,
  created_at timestamptz not null default now()
);

create or replace function net.http_post(
  url text,
  body jsonb default '{}'::jsonb,
  params jsonb default '{}'::jsonb,
  headers jsonb default '{"Content-Type": "application/json"}'::jsonb,
  timeout_milliseconds int default 5000
) returns bigint language plpgsql as $$
declare v_id bigint;
begin
  insert into net._lokal_http_log (method, url, headers, body, params, timeout_ms)
  values ('POST', url, headers, body, params, timeout_milliseconds) returning id into v_id;
  return v_id;
end $$;

create or replace function net.http_get(
  url text,
  params jsonb default '{}'::jsonb,
  headers jsonb default '{}'::jsonb,
  timeout_milliseconds int default 5000
) returns bigint language plpgsql as $$
declare v_id bigint;
begin
  insert into net._lokal_http_log (method, url, headers, params, timeout_ms)
  values ('GET', url, headers, params, timeout_milliseconds) returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- 10. Objek produksi yang dibuat DI LUAR migrasi (placeholder)
--
-- 0086_pengerasan_keamanan.sql baris 158:
--   alter function public.qa_run_script(bigint, text) set search_path = public, pg_temp;
--   → ERROR: function public.qa_run_script(bigint, text) does not exist
-- Fungsi itu ada di produksi (dibuat lewat SQL editor, lihat
-- docs/uji/UJI-KEAMANAN-2026-09-12.md T10) tetapi tidak pernah ditulis di
-- migrasi mana pun. Placeholder ini hanya agar ALTER FUNCTION 0086 punya
-- sasaran; memanggilnya langsung menolak.
-- ---------------------------------------------------------------------
do $$ begin
  if to_regprocedure('public.qa_run_script(bigint, text)') is null then
    execute $fn$
      create function public.qa_run_script(p_id bigint, p_script text) returns jsonb
      language plpgsql as $body$
      begin
        raise exception 'qa_run_script(%, ...) hanya ada di produksi — placeholder harness lokal (scripts/db-lokal/00_supabase_stub.sql)', p_id;
      end $body$
    $fn$;
    execute 'revoke execute on function public.qa_run_script(bigint, text) from public';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 11. Pencatatan migrasi lokal (dipakai db-lokal.sh agar `migrate` idempoten)
-- ---------------------------------------------------------------------
create schema if not exists _lokal;
create table if not exists _lokal.migrasi (
  nama       text primary key,
  applied_at timestamptz not null default now()
);
