-- 0082 — TURN server (Cloudflare Realtime) untuk panggilan suara di jaringan seluler (CGNAT).
--
-- Masalah: EXPO_PUBLIC_TURN_URL/USER/PASS di build = kredensial statis tertanam di APK; siapa pun
-- yang membongkar APK bisa memakai kuota TURN perusahaan. Cloudflare memang tidak menyediakan
-- kredensial statis — kredensialnya BERUMUR PENDEK dan dibuat lewat API token dari sisi server.
--
-- Rancangan (sama dengan pola map_secrets, migrasi 0061):
--   • turn_secrets  — satu baris: Token ID + API token Cloudflare. RLS nyala TANPA policy, dicabut
--                     dari anon/authenticated → hanya service_role (Edge Function) yang bisa membaca.
--   • Edge Function `turn-credentials` — memverifikasi JWT pengguna, membaca turn_secrets dengan
--                     service_role, memanggil Cloudflare, mengembalikan iceServers berumur pendek.
--   • admin_turn_status() / admin_set_turn_config(jsonb) — Panel Admin → Pengaturan, tanpa build ulang.
--
-- Yang TIDAK PERNAH keluar ke klien: api_token. Klien hanya menerima username/credential
-- sementara (TTL) hasil generate Cloudflare.

create table if not exists turn_secrets (
  id smallint primary key default 1 check (id = 1),
  provider text not null default 'cloudflare',
  token_id text,                 -- "Turn Token ID" di dashboard Cloudflare → Realtime → TURN Server
  api_token text,                -- "API Token" (hanya tampil sekali saat dibuat)
  ttl_seconds int not null default 7200 check (ttl_seconds between 300 and 86400),
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
comment on table turn_secrets is
  'Kredensial Cloudflare Realtime TURN. RLS nyala tanpa policy — hanya service_role (Edge Function turn-credentials). api_token tidak pernah dikirim ke klien.';
alter table turn_secrets enable row level security;        -- sengaja tanpa policy
revoke all on turn_secrets from public, anon, authenticated;

-- Log hasil uji/pemakaian (agar admin tahu TURN benar-benar mengeluarkan kredensial).
create table if not exists turn_issue_log (
  id bigserial primary key,
  user_id uuid,
  ok boolean not null,
  detail text,
  created_at timestamptz not null default now()
);
alter table turn_issue_log enable row level security;
revoke all on turn_issue_log from public, anon, authenticated;
create index if not exists turn_issue_log_created_idx on turn_issue_log (created_at desc);

create or replace function admin_turn_status()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if not is_admin() then raise exception 'Hanya admin'; end if;
  select jsonb_build_object(
    'configured', coalesce(s.token_id, '') <> '' and coalesce(s.api_token, '') <> '',
    'enabled', s.enabled,
    'provider', s.provider,
    'token_id_masked', case when coalesce(s.token_id, '') = '' then null else left(s.token_id, 4) || '••••' || right(s.token_id, 4) end,
    'api_token_masked', case when coalesce(s.api_token, '') = '' then null else left(s.api_token, 4) || '••••' || right(s.api_token, 4) end,
    'ttl_seconds', s.ttl_seconds,
    'updated_at', s.updated_at,
    'last_issue', (select jsonb_build_object('ok', l.ok, 'detail', l.detail, 'at', l.created_at)
                   from turn_issue_log l order by l.created_at desc limit 1),
    'issued_7d', (select count(*) from turn_issue_log where ok and created_at > now() - interval '7 days'),
    'failed_7d', (select count(*) from turn_issue_log where not ok and created_at > now() - interval '7 days'))
  into v from turn_secrets s where s.id = 1;
  return coalesce(v, jsonb_build_object('configured', false, 'enabled', false, 'provider', 'cloudflare', 'ttl_seconds', 7200));
end $$;
revoke all on function admin_turn_status() from public, anon;
grant execute on function admin_turn_status() to authenticated;

-- p: { token_id?, api_token?, ttl_seconds?, enabled?, clear? }  — kunci kosong = "jangan ubah".
create or replace function admin_set_turn_config(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Hanya admin'; end if;
  if coalesce((p->>'clear')::boolean, false) then
    delete from turn_secrets where id = 1;
    perform log_activity('turn_config', 'turn_secrets', 'panggilan', 'Kredensial TURN dihapus', '{}'::jsonb);
    return admin_turn_status();
  end if;
  insert into turn_secrets (id, token_id, api_token, ttl_seconds, enabled, updated_by)
  values (1, nullif(btrim(p->>'token_id'), ''), nullif(btrim(p->>'api_token'), ''),
          coalesce((p->>'ttl_seconds')::int, 7200), coalesce((p->>'enabled')::boolean, true), auth.uid())
  on conflict (id) do update set
    token_id  = coalesce(nullif(btrim(p->>'token_id'), ''), turn_secrets.token_id),
    api_token = coalesce(nullif(btrim(p->>'api_token'), ''), turn_secrets.api_token),
    ttl_seconds = coalesce((p->>'ttl_seconds')::int, turn_secrets.ttl_seconds),
    enabled = coalesce((p->>'enabled')::boolean, turn_secrets.enabled),
    updated_at = now(), updated_by = auth.uid();
  perform log_activity('turn_config', 'turn_secrets', 'panggilan', 'Konfigurasi TURN diubah',
    jsonb_build_object('token_changed', coalesce(btrim(p->>'api_token'), '') <> '',
                       'enabled', p->>'enabled', 'ttl_seconds', p->>'ttl_seconds'));
  return admin_turn_status();
end $$;
revoke all on function admin_set_turn_config(jsonb) from public, anon;
grant execute on function admin_set_turn_config(jsonb) to authenticated;
