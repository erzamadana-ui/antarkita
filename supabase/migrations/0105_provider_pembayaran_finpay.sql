-- =====================================================================
-- 0105 — PROVIDER PEMBAYARAN (Midtrans ↔ Finpay), payments kanonik, inbox webhook,
--        intent idempoten, mesin status, K1 (simulasi), struk pelanggan — Finpay v3
--
-- Sumber: docs/finpay-v3/KONTRAK-API-V3.md §0 (prinsip), §1 (provider & feature flag,
-- gateway_secrets, payment_channel_fees), §2 (payments kanonik, payment_events, RPC),
-- §3 (mesin status). Basis: skema bisnis v2 (0098–0104) tetap berlaku.
-- Tarif Finpay: [FAKTA-PUBLIK] finpay.id/biaya-transaksi (diambil 9 Jul 2026); PPN belum jelas →
-- ppn_included=false [ASUMSI]; baris yang rentangnya publik saja → [ASUMSI]; QRIS 0 % ≤ Rp100.000
-- mulai 1 Okt 2026 (kebijakan BI) → [PERLU-KONFIRMASI-KONTRAK].
--
-- Isi:
--   0. Pembantu migrasi v3 (dipakai 0105–0110 & rollback): _migration_backup, _mig_backup,
--      _mig_restore, _v3_splice — definisi fungsi lama disimpan sebelum ditambal supaya
--      supabase/rollback/0105_down.sql … 0110_down.sql bisa memulihkannya persis.
--   1. app_settings baru + business_setting_specs_v3() (ubah lewat admin_set_settings: PIN + audit)
--   2. gateway_secrets dikunci (provider, env) + admin_set_gateway_secret / admin_gateway_secrets
--      (nilai kunci TIDAK ke log — hanya 6 awal / 4 akhir); admin_set_gateway (v2) & gateway_public_config
--      disesuaikan dengan PK baru.
--   3. payment_channel_fees versi per provider + effective_from + pass_to_customer(+legal_ok);
--      QRIS pass_to_customer DIKUNCI false (CHECK); seed Finpay berlabel; pg_fee_calc v3 (2 argumen
--      lama tetap jalan); pg_fee_borne_by_for (§0.5); payment_provider_public() (anon).
--   4. payments kanonik (pay_status, provider_ref, …, support_ref AK-xxxxxx) + trigger sinkron
--      status↔pay_status + satu intent PENDING per order; orders.settlement_status / payment_support_ref.
--   5. payment_events (inbox append-only) + admin_payment_events.
--   6. RBAC dasar admin_has/admin_require (versi is_admin; 0107 menggantinya dengan matriks peran).
--   7. payment_settle v3 — TUTUP CELAH K1: jalur simulasi hanya bila payments_simulation_enabled
--      AND payment_provider_env<>'production' AND payments.provider='simulated'; jalur order wajib
--      lolos sakelar AntarPay/gateway_order_payment. Dana yang tidak bisa dipakai → payment_refund_auto
--      (0105: saldo seperti v2; 0108: refund_requests).
--   8. payment_intent_create, payment_event_ingest (mesin status §3), payment_mark_reconciled (service_role).
--   9. order_payment_prepare v3, create_order (pg_fee_borne_by_for), my_payment_status,
--      my_payment_history, my_receipt.
--  10. admin_set_settings / admin_business_settings v3.
--  11. Penjaga migrasi.
-- Semua blok idempoten (aman dijalankan ulang).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Pembantu migrasi v3 (dipertahankan sampai 0105_down; tidak untuk klien)
-- ---------------------------------------------------------------------
create table if not exists public._migration_backup (
  version   text not null,          -- '0105' … '0110'
  fn        text not null,          -- tanda tangan regprocedure, mis. 'public.pg_fee_calc(text,bigint)'
  def       text,                   -- pg_get_functiondef sebelum migrasi; NULL = fungsi baru (dihapus saat rollback)
  acl       text,                   -- proacl sebelum migrasi (dipulihkan saat rollback)
  cmt       text,                   -- komentar fungsi
  saved_at  timestamptz not null default now(),
  primary key (version, fn)
);
comment on table public._migration_backup is
  'Finpay v3 (0105): definisi fungsi SEBELUM migrasi 0105–0110 menambal/menggantinya. Dipakai supabase/rollback/*_down.sql (_mig_restore). def NULL = fungsi baru milik migrasi itu.';
alter table public._migration_backup enable row level security;
revoke all on public._migration_backup from public, anon, authenticated;

create or replace function public._mig_backup(p_version text, p_sig text)
returns void language plpgsql set search_path = public, pg_catalog as $$
declare v_oid oid := to_regprocedure(p_sig);
begin
  insert into _migration_backup (version, fn, def, acl, cmt)
  values (p_version, p_sig,
          case when v_oid is not null then pg_get_functiondef(v_oid) end,
          case when v_oid is not null then (select proacl::text from pg_proc where oid = v_oid) end,
          case when v_oid is not null then obj_description(v_oid, 'pg_proc') end)
  on conflict (version, fn) do nothing;   -- migrasi dijalankan ulang: simpan definisi ASLI, bukan versi yang sudah ditambal
end $$;
revoke all on function public._mig_backup(text, text) from public, anon, authenticated;

-- Pulihkan semua fungsi yang dicadangkan satu migrasi: fungsi baru dihapus dulu, lalu definisi lama
-- dibuat ulang (drop dulu bila tipe hasil berubah), hak EXECUTE & komentar dikembalikan.
create or replace function public._mig_restore(p_version text)
returns int language plpgsql set search_path = public, pg_catalog as $$
declare r record; a record; n int := 0;
begin
  for r in select * from _migration_backup where version = p_version and def is null order by fn loop
    execute 'drop function if exists ' || r.fn;
    n := n + 1;
  end loop;
  for r in select * from _migration_backup where version = p_version and def is not null order by fn loop
    begin
      execute r.def;
    exception when invalid_function_definition or duplicate_function then   -- tipe hasil/nama parameter berubah
      execute 'drop function if exists ' || r.fn;
      execute r.def;
    end;
    execute 'revoke all on function ' || r.fn || ' from public, anon, authenticated, service_role';
    if r.acl is null then
      execute 'grant execute on function ' || r.fn || ' to public';
    else
      for a in select e.grantee, g.rolname from aclexplode(r.acl::aclitem[]) e left join pg_roles g on g.oid = e.grantee
               where e.privilege_type = 'EXECUTE' loop
        if a.grantee = 0 then execute 'grant execute on function ' || r.fn || ' to public';
        elsif a.rolname is not null and a.rolname not in ('postgres', 'supabase_admin') then
          execute format('grant execute on function %s to %I', r.fn, a.rolname);
        end if;
      end loop;
    end if;
    execute format('comment on function %s is %L', r.fn, r.cmt);
    n := n + 1;
  end loop;
  delete from _migration_backup where version = p_version;
  return n;
end $$;
revoke all on function public._mig_restore(text) from public, anon, authenticated;

-- Hak akses tabel sebelum migrasi mencabut/mengubahnya (dipulihkan rollback)
create table if not exists public._migration_backup_acl (
  version  text not null,
  obj      text not null,          -- 'public.app_settings'
  acl      text,                   -- relacl sebelum migrasi
  saved_at timestamptz not null default now(),
  primary key (version, obj)
);
alter table public._migration_backup_acl enable row level security;
revoke all on public._migration_backup_acl from public, anon, authenticated;

create or replace function public._mig_backup_acl(p_version text, p_table text)
returns void language plpgsql set search_path = public, pg_catalog as $$
begin
  insert into _migration_backup_acl (version, obj, acl)
  values (p_version, p_table, (select relacl::text from pg_class where oid = to_regclass(p_table)))
  on conflict (version, obj) do nothing;
end $$;
revoke all on function public._mig_backup_acl(text, text) from public, anon, authenticated;

create or replace function public._mig_restore_acl(p_version text)
returns int language plpgsql set search_path = public, pg_catalog as $$
declare r record; a record; n int := 0;
begin
  for r in select * from _migration_backup_acl where version = p_version loop
    continue when to_regclass(r.obj) is null;
    execute format('revoke all on table %s from public, anon, authenticated, service_role', r.obj);
    for a in select e.grantee, g.rolname, e.privilege_type from aclexplode(coalesce(r.acl, '{}')::aclitem[]) e left join pg_roles g on g.oid = e.grantee loop
      if a.grantee = 0 then execute format('grant %s on table %s to public', a.privilege_type, r.obj);
      elsif a.rolname is not null and a.rolname not in ('postgres', 'supabase_admin') then execute format('grant %s on table %s to %I', a.privilege_type, r.obj, a.rolname);
      end if;
    end loop;
    n := n + 1;
  end loop;
  delete from _migration_backup_acl where version = p_version;
  return n;
end $$;
revoke all on function public._mig_restore_acl(text) from public, anon, authenticated;

-- Tambal satu fungsi (tanda tangan eksplisit → aman terhadap overload): cadangkan dulu, jangkar wajib
-- ada & unik (kecuali p_all), penanda idempoten, gagal keras bila jangkar hilang (pola 0099–0104).
create or replace function public._v3_splice(p_version text, p_sig text, p_anchor text, p_new text, p_marker text, p_all boolean default false)
returns void language plpgsql set search_path = public, pg_catalog as $$
declare def text; n int; v_oid oid := to_regprocedure(p_sig); v_name text := split_part(p_sig, '(', 1);
begin
  if v_oid is null then
    -- tanda tangan berubah oleh migrasi sesudahnya (mis. 0109 create_order(jsonb, uuid)): pakai satu-satunya overload bernama sama
    if (select count(*) from pg_proc where oid::regprocedure::text like replace(v_name, 'public.', '') || '(%' and pronamespace = 'public'::regnamespace) = 1 then
      select oid into v_oid from pg_proc where oid::regprocedure::text like replace(v_name, 'public.', '') || '(%' and pronamespace = 'public'::regnamespace;
    else
      raise exception '% batal: fungsi % tidak ditemukan', p_version, p_sig;
    end if;
  end if;
  perform _mig_backup(p_version, p_sig);
  def := pg_get_functiondef(v_oid);
  if position(p_marker in def) > 0 then raise notice '%: % sudah ditambal (%), dilewati', p_version, p_sig, left(p_marker, 60); return; end if;
  n := (length(def) - length(replace(def, p_anchor, ''))) / greatest(1, length(p_anchor));
  if n = 0 then raise exception '% batal: jangkar tidak ditemukan di % — tambalan TIDAK terpasang. Jangkar: %', p_version, p_sig, left(p_anchor, 140); end if;
  if n > 1 and not p_all then raise exception '% batal: jangkar tidak unik (% kali) di %. Jangkar: %', p_version, n, p_sig, left(p_anchor, 140); end if;
  execute replace(def, p_anchor, p_new);
end $$;
revoke all on function public._v3_splice(text, text, text, text, text, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 0b. Cadangan fungsi yang diganti/ditambah 0105 (sebelum perubahan apa pun)
-- ---------------------------------------------------------------------
do $$
declare s text;
begin
  foreach s in array array[
    -- diganti (definisi lama disimpan)
    'public.pg_fee_calc(text,bigint)', 'public.pg_hold_days(text,text)', 'public.pg_fee_estimate(service_type,text,bigint)',
    'public.admin_set_payment_channel_fee(text,jsonb)', 'public.admin_payment_channel_fees()',
    'public.payment_settle(text,text,jsonb,text,timestamp with time zone)', 'public.order_payment_prepare(uuid,text)',
    'public.gateway_public_config()', 'public.admin_gateway_status()', 'public.admin_set_gateway(jsonb)',
    'public.admin_set_settings(jsonb)', 'public.admin_business_settings()', 'public.create_order(jsonb)',
    'public.ledger_simulate(service_type,bigint,bigint,bigint,text,text,integer)',
    -- baru (NULL → dihapus saat rollback)
    'public.pg_fee_calc(text,bigint,text,timestamp with time zone)', 'public.admin_set_payment_channel_fee(text,text,date,jsonb)',
    'public.admin_payment_channel_fees(text)', 'public.pg_fee_borne_by_for(service_type,text,text,timestamp with time zone)',
    'public.payment_provider_active()', 'public.payment_provider_env()', 'public.payments_simulation_active()',
    'public.payment_provider_label(text)', 'public.payment_provider_public()', 'public.business_setting_specs_v3()',
    'public.admin_set_gateway_secret(text,text,jsonb)', 'public.admin_gateway_secrets()', 'public.gateway_secrets_sync()',
    'public.mask_secret(text)', 'public.gen_support_ref()', 'public.payment_status_to_legacy(text)', 'public.payment_status_from_legacy(text)',
    'public.payments_sync_status()', 'public.orders_settlement_on_complete()', 'public.payment_events_append_only()',
    'public.admin_payment_events(text)', 'public.admin_has(text)', 'public.admin_require(text)',
    'public.payment_status_map(text,text,jsonb)', 'public.payment_refund_auto(uuid,text)',
    'public.payment_hook_after_ingest(uuid,text,text,bigint,jsonb)', 'public.payment_intent_create(uuid,text,uuid,bigint,text,text)',
    'public.payment_event_ingest(text,text,text,text,bigint,boolean,jsonb,text)', 'public.payment_mark_reconciled(uuid,uuid)',
    'public.my_payment_status(uuid)', 'public.my_payment_history(integer)', 'public.my_receipt(uuid)',
    'public.receipt_refundable_note(orders)', 'public.append_only_bypass()',
    -- perbaikan tinjauan keamanan (T2/T3/R3/R4/(a)/(e))
    'public.app_setting_specs()', 'public.setting_json_validate(text,jsonb)', 'public.rate_take_user(uuid,text,integer)',
    'public.payment_supersede(uuid,text)', 'public.payment_channel_provider_ok(text,text)'] loop
    perform _mig_backup('0105', s);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 1. app_settings baru (§1) — nilai default kontrak; tidak menimpa yang sudah diatur admin
-- ---------------------------------------------------------------------
insert into app_settings (key, value) values
  ('payment_provider_active', '"midtrans"'::jsonb),
  ('payment_provider_env', '"sandbox"'::jsonb),
  ('payments_simulation_enabled', 'false'::jsonb),
  ('refund_dual_approval_min', '200000'::jsonb),
  ('wallet_adjust_dual_approval_min', '100000'::jsonb),
  ('disbursement_provider', '"manual"'::jsonb),
  ('ads_frequency_cap_per_day', '5'::jsonb),
  ('ads_click_dedupe_minutes', '30'::jsonb)
on conflict (key) do nothing;

create or replace function public.payment_provider_active()
returns text language sql stable security definer set search_path = public as $$
  select case when lower(coalesce((select value #>> '{}' from app_settings where key = 'payment_provider_active'), 'midtrans')) = 'finpay'
              then 'finpay' else 'midtrans' end;
$$;
create or replace function public.payment_provider_env()
returns text language sql stable security definer set search_path = public as $$
  select case when lower(coalesce((select value #>> '{}' from app_settings where key = 'payment_provider_env'), 'sandbox')) = 'production'
              then 'production' else 'sandbox' end;
$$;
-- K1: simulasi hanya bila sakelar menyala DAN bukan production
create or replace function public.payments_simulation_active()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select lower(value #>> '{}') = 'true' from app_settings where key = 'payments_simulation_enabled'), false)
     and payment_provider_env() <> 'production';
$$;
create or replace function public.payment_provider_label(p_provider text)
returns text language sql immutable set search_path = public as $$
  select case lower(coalesce(p_provider, '')) when 'finpay' then 'Finpay' when 'midtrans' then 'Midtrans'
    when 'simulated' then 'Simulasi' when 'internal' then 'AntarKita' when 'manual' then 'Manual' else coalesce(p_provider, '-') end;
$$;
grant execute on function public.payment_provider_active() to anon, authenticated, service_role;
grant execute on function public.payment_provider_env() to anon, authenticated, service_role;
grant execute on function public.payments_simulation_active() to anon, authenticated, service_role;
grant execute on function public.payment_provider_label(text) to anon, authenticated, service_role;

-- Spesifikasi ambang v3 (numerik & teks). business_setting_specs() v2 (11 kunci) TIDAK diubah —
-- Panel Admin v2 membacanya apa adanya; kunci v3 tampil di admin_business_settings().settings_v3.
-- perm = izin admin (admin_has) yang dibutuhkan untuk mengubah kunci itu (0107: matriks peran).
create or replace function public.business_setting_specs_v3()
returns table(key text, value_type text, min_value numeric, max_value numeric, options text[], default_value jsonb,
  unit text, label text, note text, perm text)
language sql immutable set search_path = public as $$
  select * from (values
    ('payment_provider_active',        'text', null::numeric, null::numeric, array['midtrans','finpay'], '"midtrans"'::jsonb, '', 'KONTRAK', 'Provider pembayaran untuk TRANSAKSI BARU (transaksi lama tetap diproses provider asalnya)', 'payment_config'),
    ('payment_provider_env',           'text', null, null, array['sandbox','production'], '"sandbox"', '', 'KONTRAK', 'Lingkungan provider: sandbox (devo.finnet.co.id / sandbox Midtrans) atau production', 'payment_config'),
    ('payments_simulation_enabled',    'bool', null, null, null::text[], 'false', '', 'KONTRAK', 'Simulasi pembayaran — hanya berlaku bila env ≠ production dan payments.provider = simulated (K1)', 'payment_config'),
    ('disbursement_provider',          'text', null, null, array['manual','finpay'], '"manual"', '', 'KONTRAK', 'Pencairan mitra: manual (transfer admin) atau finpay (pay-disburse)', 'payment_config'),
    ('refund_dual_approval_min',       'int',  0, 10000000000, null, '200000', 'Rp', 'KONTRAK', 'Refund ≥ nilai ini butuh 2 admin berbeda (maker ≠ checker)', 'refund'),
    ('wallet_adjust_dual_approval_min','int',  0, 10000000000, null, '100000', 'Rp', 'KONTRAK', 'Penyesuaian saldo ≥ nilai ini butuh 2 admin berbeda', 'wallet_adjust'),
    ('ads_frequency_cap_per_day',      'int',  1, 100, null, '5', 'impresi', 'KONTRAK', 'Maks impresi iklan yang sama per pengguna per hari', 'ads'),
    ('ads_click_dedupe_minutes',       'int',  1, 1440, null, '30', 'menit', 'KONTRAK', 'Klik pengguna yang sama pada iklan yang sama dalam N menit tidak ditagih', 'ads'),
    ('variable_cost_per_order',        'int',  0, 1000000, null, '300', 'Rp', 'ASUMSI', 'Biaya variabel per order (server, SMS/OTP, CS) untuk contribution margin', 'report'),
    ('rate_limit_create_order_per_hour',   'int', 1, 100000, null, '30', 'per jam', 'ASUMSI', 'Batas pembuatan pesanan per pelanggan per jam (rate_take)', 'payment_config'),
    ('rate_limit_payment_prepare_per_hour','int', 1, 100000, null, '30', 'per jam', 'ASUMSI', 'Batas order_payment_prepare per pelanggan per jam', 'payment_config'),
    ('rate_limit_withdrawal_per_hour',     'int', 1, 100000, null, '30', 'per jam', 'ASUMSI', 'Batas permintaan penarikan saldo per mitra per jam', 'payout'),
    ('rate_limit_topup_intent_per_hour',   'int', 1, 100000, null, '10', 'per jam', 'ASUMSI', 'Batas intent top up (payment_intent_create) per pengguna per jam', 'payment_config'),
    ('rate_limit_dispute_per_hour',        'int', 1, 100000, null, '5',  'per jam', 'ASUMSI', 'Batas pembukaan sengketa (dispute_open) per pengguna per jam', 'dispute'),
    ('auto_payout_enabled',            'bool', null, null, null, 'true', '', 'ASUMSI', 'Pencairan otomatis rekening terverifikasi (0019)', 'payout'),
    ('auto_payout_max',                'int',  0, 100000000, null, '500000', 'Rp', 'ASUMSI', 'Batas nominal satu pencairan otomatis', 'payout'),
    ('auto_payout_daily_max',          'int',  0, 1000000000, null, '1000000', 'Rp', 'ASUMSI', 'Batas total pencairan otomatis per mitra per hari', 'payout')
  ) as t(key, value_type, min_value, max_value, options, default_value, unit, label, note, perm);
$$;
revoke all on function public.business_setting_specs_v3() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 6 (awal). RBAC dasar — dipakai RPC v3 sejak 0105; 0107 menggantinya dengan matriks peran
-- ---------------------------------------------------------------------
create or replace function public.admin_has(p_perm text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(is_admin(), false);
$$;
create or replace function public.admin_require(p_perm text)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not admin_has(p_perm) then raise exception 'Hanya admin (izin %)', coalesce(p_perm, '-'); end if;
end $$;
revoke all on function public.admin_has(text) from public, anon;
revoke all on function public.admin_require(text) from public, anon;
grant execute on function public.admin_has(text) to authenticated, service_role;
grant execute on function public.admin_require(text) to authenticated, service_role;

-- Pengecualian append-only (payment_events, 0106: order_ledger & audit_logs): hanya sesi pemeliharaan
-- tanpa JWT pengguna (migrasi/psql service) yang menyalakan antarkita.append_only_bypass.
create or replace function public.append_only_bypass()
returns boolean language sql stable set search_path = public as $$
  select coalesce(current_setting('antarkita.append_only_bypass', true), '') = 'on' and auth.uid() is null;
$$;
revoke all on function public.append_only_bypass() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. gateway_secrets dikunci (provider, env)
-- ---------------------------------------------------------------------
alter table public.gateway_secrets add column if not exists env text;
alter table public.gateway_secrets add column if not exists callback_token text;
alter table public.gateway_secrets add column if not exists extra jsonb not null default '{}'::jsonb;
-- Migrasi baris lama (hanya midtrans ada): env 'production' bila ada server key NON-sandbox,
-- selain itu 'sandbox'. Aturan Midtrans: server key sandbox berawalan 'SB-' (mis. SB-Mid-server-…).
update public.gateway_secrets set env = case
    when coalesce(btrim(server_key), '') <> '' and btrim(server_key) not like 'SB-%' then 'production'
    else 'sandbox' end
 where env is null;
alter table public.gateway_secrets alter column env set default 'sandbox';
alter table public.gateway_secrets alter column env set not null;
do $$
declare v_pk text;
begin
  if not exists (select 1 from pg_constraint where conname = 'gateway_secrets_env_check') then
    alter table public.gateway_secrets add constraint gateway_secrets_env_check check (env in ('sandbox', 'production'));
  end if;
  select string_agg(a.attname, ',' order by a.attnum) into v_pk
    from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
   where c.conrelid = 'public.gateway_secrets'::regclass and c.contype = 'p';
  if v_pk is distinct from 'provider,env' then
    execute (select 'alter table public.gateway_secrets drop constraint ' || quote_ident(conname) from pg_constraint
              where conrelid = 'public.gateway_secrets'::regclass and contype = 'p');
    alter table public.gateway_secrets add constraint gateway_secrets_pkey primary key (provider, env);
  end if;
end $$;
do $$ begin perform _mig_backup_acl('0105', 'public.gateway_secrets'); end $$;
alter table public.gateway_secrets enable row level security;
revoke all on public.gateway_secrets from public, anon, authenticated;   -- 0016 sudah; ditegaskan ulang (hanya service_role)
grant all on public.gateway_secrets to service_role;
comment on table public.gateway_secrets is
  'Kunci payment gateway per (provider, env) — 0016, dikunci ulang 0105. RLS tanpa policy: hanya service_role/edge function. Finpay: server_key = Merchant Key. Ubah lewat admin_set_gateway_secret (PIN; nilai tidak masuk log).';

-- is_production (kolom v2, dibaca midtrans-create) mengikuti env
create or replace function public.gateway_secrets_sync()
returns trigger language plpgsql set search_path = public as $$
begin
  new.env := lower(coalesce(new.env, 'sandbox'));
  new.is_production := (new.env = 'production');
  new.extra := coalesce(new.extra, '{}'::jsonb);
  return new;
end $$;
drop trigger if exists t_gateway_secrets_sync on public.gateway_secrets;
create trigger t_gateway_secrets_sync before insert or update on public.gateway_secrets
  for each row execute function gateway_secrets_sync();
update public.gateway_secrets set env = env;   -- sinkronkan is_production baris lama

create or replace function public.mask_secret(p text)
returns text language sql immutable set search_path = public as $$
  select case when coalesce(p, '') = '' then null
              when length(p) <= 10 then repeat('•', length(p))
              else left(p, 6) || '••••' || right(p, 4) end;
$$;
revoke all on function public.mask_secret(text) from public, anon;

create or replace function public.admin_set_gateway_secret(p_provider text, p_env text, p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_prov text := lower(trim(coalesce(p_provider, ''))); v_env text := lower(trim(coalesce(p_env, 'sandbox')));
  b gateway_secrets; a gateway_secrets; k text; v_changed text[] := '{}';
  allowed constant text[] := array['merchant_id','server_key','client_key','callback_token','extra','clear_server_key','clear_callback_token'];
begin
  perform admin_require('gateway_secret');
  perform admin_require_unlock();
  if v_prov not in ('midtrans', 'finpay') then raise exception 'Provider harus midtrans|finpay'; end if;
  if v_env not in ('sandbox', 'production') then raise exception 'env harus sandbox|production'; end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then raise exception 'Patch kosong: kirim objek {kolom: nilai}'; end if;
  for k in select jsonb_object_keys(p_patch) loop
    if not (k = any (allowed)) then raise exception 'Kolom tidak dikenal: %', k; end if;
  end loop;
  if p_patch ? 'extra' and jsonb_typeof(p_patch->'extra') <> 'object' then raise exception 'extra harus objek JSON'; end if;
  select * into b from gateway_secrets where provider = v_prov and env = v_env for update;
  if not found then
    insert into gateway_secrets (provider, env, updated_by) values (v_prov, v_env, auth.uid()) returning * into b;
  end if;
  a := b;
  if p_patch ? 'merchant_id' then a.merchant_id := nullif(btrim(p_patch->>'merchant_id'), ''); end if;
  if coalesce(btrim(p_patch->>'server_key'), '') <> '' then a.server_key := btrim(p_patch->>'server_key');
  elsif p_patch ? 'clear_server_key' then a.server_key := null; end if;
  if p_patch ? 'client_key' then a.client_key := nullif(btrim(p_patch->>'client_key'), ''); end if;
  if coalesce(btrim(p_patch->>'callback_token'), '') <> '' then a.callback_token := btrim(p_patch->>'callback_token');
  elsif p_patch ? 'clear_callback_token' then a.callback_token := null; end if;
  if p_patch ? 'extra' then a.extra := coalesce(a.extra, '{}'::jsonb) || (p_patch->'extra'); end if;  -- gabung, bukan ganti (cron_secret dll.)
  if v_env = 'sandbox' and v_prov = 'midtrans' and a.server_key is not null and a.server_key not like 'SB-%' then
    raise exception 'Server key Midtrans sandbox harus berawalan SB-';
  end if;
  if v_env = 'production' and v_prov = 'midtrans' and a.server_key like 'SB-%' then
    raise exception 'Server key sandbox (SB-…) tidak boleh dipakai untuk production';
  end if;
  update gateway_secrets set merchant_id = a.merchant_id, server_key = a.server_key, client_key = a.client_key,
    callback_token = a.callback_token, extra = a.extra, updated_at = now(), updated_by = auth.uid()
   where provider = v_prov and env = v_env returning * into a;
  if a.merchant_id is distinct from b.merchant_id then v_changed := array_append(v_changed, 'merchant_id'); end if;
  if a.server_key is distinct from b.server_key then v_changed := array_append(v_changed, 'server_key'); end if;
  if a.client_key is distinct from b.client_key then v_changed := array_append(v_changed, 'client_key'); end if;
  if a.callback_token is distinct from b.callback_token then v_changed := array_append(v_changed, 'callback_token'); end if;
  if a.extra is distinct from b.extra then v_changed := array_append(v_changed, 'extra'); end if;
  -- log: HANYA nama kolom + nilai tersamar (6 awal / 4 akhir), tidak pernah nilai utuh
  perform log_activity('gateway.secret_updated', 'gateway_secrets', v_prov || ':' || v_env,
    'Kunci ' || payment_provider_label(v_prov) || ' (' || v_env || ') diubah: ' || coalesce(array_to_string(v_changed, ', '), '-'),
    jsonb_build_object('provider', v_prov, 'env', v_env, 'changed', to_jsonb(v_changed),
      'server_key', mask_secret(a.server_key), 'client_key', mask_secret(a.client_key), 'callback_token', mask_secret(a.callback_token),
      'merchant_id', a.merchant_id));
  return jsonb_build_object('provider', a.provider, 'env', a.env, 'merchant_id', a.merchant_id,
    'server_key', mask_secret(a.server_key), 'client_key', mask_secret(a.client_key), 'callback_token', mask_secret(a.callback_token),
    'configured', coalesce(a.server_key, '') <> '', 'updated_at', a.updated_at);
end $$;
revoke all on function public.admin_set_gateway_secret(text, text, jsonb) from public, anon;
grant execute on function public.admin_set_gateway_secret(text, text, jsonb) to authenticated;
comment on function public.admin_set_gateway_secret(text, text, jsonb) is
  'Finpay v3 §1: simpan kunci gateway per (provider, env). admin_require(gateway_secret) + PIN; log hanya nilai tersamar (6 awal/4 akhir). patch: merchant_id, server_key (Finpay: Merchant Key), client_key, callback_token, extra, clear_server_key, clear_callback_token.';

create or replace function public.admin_gateway_secrets()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform admin_require('gateway_secret');
  return jsonb_build_object('active_provider', payment_provider_active(), 'env', payment_provider_env(),
    'simulation', payments_simulation_active(),
    'items', coalesce((select jsonb_agg(jsonb_build_object('provider', g.provider, 'env', g.env, 'merchant_id', g.merchant_id,
        'server_key', mask_secret(g.server_key), 'client_key', mask_secret(g.client_key), 'callback_token', mask_secret(g.callback_token),
        'configured', coalesce(g.server_key, '') <> '', 'extra_keys', (select jsonb_agg(k) from jsonb_object_keys(g.extra) k),
        'active', g.provider = payment_provider_active() and g.env = payment_provider_env(),
        'updated_at', g.updated_at, 'updated_by', (select full_name from profiles where id = g.updated_by)) order by g.provider, g.env)
      from gateway_secrets g), '[]'::jsonb));
end $$;
revoke all on function public.admin_gateway_secrets() from public, anon;
grant execute on function public.admin_gateway_secrets() to authenticated;

-- admin_set_gateway (v2, Midtrans): upsert ke baris (midtrans, env dari is_production)
create or replace function public.admin_set_gateway(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_env text;
begin
  if not is_admin() then raise exception 'Hanya admin'; end if;
  perform admin_require('gateway_secret');   -- 0105/0107
  perform admin_require_unlock();
  v_env := case when coalesce((p->>'is_production')::boolean,
                  coalesce((select is_production from gateway_secrets where provider = 'midtrans' and env = payment_provider_env()), false))
                then 'production' else 'sandbox' end;
  insert into gateway_secrets (provider, env, server_key, client_key, merchant_id, updated_by)
  values ('midtrans', v_env, nullif(p->>'server_key', ''), nullif(p->>'client_key', ''), nullif(p->>'merchant_id', ''), auth.uid())
  on conflict (provider, env) do update set
    server_key = case when p ? 'server_key' and coalesce(p->>'server_key', '') <> '' then p->>'server_key' when p ? 'clear_server_key' then null else gateway_secrets.server_key end,
    client_key = case when p ? 'client_key' then nullif(p->>'client_key', '') else gateway_secrets.client_key end,
    merchant_id = case when p ? 'merchant_id' then nullif(p->>'merchant_id', '') else gateway_secrets.merchant_id end,
    updated_at = now(), updated_by = auth.uid();
  if p ? 'methods' then insert into app_settings (key, value) values ('pg_methods', p->'methods') on conflict (key) do update set value = excluded.value, updated_at = now(); end if;
  if p ? 'topup_min' then insert into app_settings (key, value) values ('pg_topup_min', p->'topup_min') on conflict (key) do update set value = excluded.value, updated_at = now(); end if;
  if p ? 'topup_max' then insert into app_settings (key, value) values ('pg_topup_max', p->'topup_max') on conflict (key) do update set value = excluded.value, updated_at = now(); end if;
  perform log_activity('gateway_config', 'gateway_secrets', 'midtrans:' || v_env, 'Konfigurasi payment gateway diubah' || case when p ? 'server_key' then ' (server key)' else '' end,
    jsonb_build_object('is_production', p->>'is_production', 'env', v_env, 'methods', p->'methods',
      'server_key', mask_secret((select server_key from gateway_secrets where provider = 'midtrans' and env = v_env))));
  return admin_gateway_status();
end $$;

-- gateway_public_config / admin_gateway_status: baris kunci = (midtrans, env aktif) (PK baru → bisa 2 baris)
select _v3_splice('0105', 'public.gateway_public_config()',
  $a$'configured', exists (select 1 from gateway_secrets where provider = 'midtrans' and coalesce(server_key, '') <> ''),
    'is_production', coalesce((select is_production from gateway_secrets where provider = 'midtrans'), false),
    'client_key', (select client_key from gateway_secrets where provider = 'midtrans'),$a$,
  $a$'configured', exists (select 1 from gateway_secrets where provider = 'midtrans' and env = payment_provider_env() and coalesce(server_key, '') <> ''),   -- 0105 (provider, env)
    'is_production', payment_provider_env() = 'production',
    'client_key', (select client_key from gateway_secrets where provider = 'midtrans' and env = payment_provider_env()),
    'provider_active', payment_provider_active(), 'provider_env', payment_provider_env(), 'simulation', payments_simulation_active(),$a$,
  '0105 (provider, env)');
select _v3_splice('0105', 'public.admin_gateway_status()',
  $a$select * into g from gateway_secrets where provider = 'midtrans';$a$,
  $a$select * into g from gateway_secrets where provider = 'midtrans' order by (env = payment_provider_env()) desc limit 1;   -- 0105 (provider, env)$a$,
  '0105 (provider, env)');

-- ---------------------------------------------------------------------
-- 3. payment_channel_fees v3
-- ---------------------------------------------------------------------
alter table public.payment_channel_fees add column if not exists effective_from date not null default '2026-01-01';
alter table public.payment_channel_fees add column if not exists pass_to_customer boolean not null default false;
alter table public.payment_channel_fees add column if not exists pass_to_customer_legal_ok boolean not null default false;
alter table public.payment_channel_fees add column if not exists source_label text;
alter table public.payment_channel_fees add column if not exists note text;
alter table public.payment_channel_fees add column if not exists fee_pct_under_100k numeric(5,2);
update public.payment_channel_fees set source_label = case when provider = 'midtrans' then '[KONTRAK]' else '[FAKTA]' end where source_label is null;
do $$
declare v_pk text;
begin
  select string_agg(a.attname, ',' order by array_position(c.conkey, a.attnum)) into v_pk
    from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
   where c.conrelid = 'public.payment_channel_fees'::regclass and c.contype = 'p';
  if v_pk is distinct from 'provider,channel,effective_from' then
    execute (select 'alter table public.payment_channel_fees drop constraint ' || quote_ident(conname) from pg_constraint
              where conrelid = 'public.payment_channel_fees'::regclass and contype = 'p');
    alter table public.payment_channel_fees add constraint payment_channel_fees_pkey primary key (provider, channel, effective_from);
  end if;
  -- §0.5: QRIS tidak boleh dibebankan ke pelanggan (larangan surcharge BI) — DIKUNCI di tingkat tabel
  if not exists (select 1 from pg_constraint where conname = 'payment_channel_fees_qris_no_surcharge') then
    alter table public.payment_channel_fees add constraint payment_channel_fees_qris_no_surcharge
      check (not (channel = 'qris' and pass_to_customer));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'payment_channel_fees_provider_check') then
    alter table public.payment_channel_fees add constraint payment_channel_fees_provider_check check (provider in ('midtrans', 'finpay', 'internal'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'payment_channel_fees_under100k_check') then
    alter table public.payment_channel_fees add constraint payment_channel_fees_under100k_check check (fee_pct_under_100k is null or fee_pct_under_100k between 0 and 100);
  end if;
end $$;
create index if not exists payment_channel_fees_lookup_idx on public.payment_channel_fees (provider, channel, effective_from desc);
comment on column public.payment_channel_fees.pass_to_customer is 'Finpay v3 §0.5: biaya kanal ini boleh dibebankan ke pelanggan (hanya bila pass_to_customer_legal_ok juga true). QRIS dikunci false (CHECK payment_channel_fees_qris_no_surcharge).';
comment on column public.payment_channel_fees.pass_to_customer_legal_ok is 'Diisi admin SETELAH kajian legal/kontrak provider — tanpa ini biaya tetap ditanggung platform.';
comment on column public.payment_channel_fees.effective_from is 'Tanggal mulai berlaku (WIB). pg_fee_calc memilih baris effective_from ≤ tanggal transaksi yang terbaru.';
comment on column public.payment_channel_fees.fee_pct_under_100k is 'Tarif persen khusus untuk nominal ≤ Rp100.000 (mis. QRIS 0 % mulai 1 Okt 2026). NULL = tidak ada tarif khusus.';

-- Seed Finpay (tidak menimpa perubahan admin)
insert into public.payment_channel_fees (provider, channel, effective_from, label, fee_pct, fee_fixed, ppn_included, ppn_pct, hold_days, source, source_label, notes, note, fee_pct_under_100k) values
  ('finpay', 'bank_transfer',     '2026-01-01', 'Transfer bank (VA)', 0,   3500, false, 11, 1, 'finpay.id/biaya-transaksi (9 Jul 2026)', '[FAKTA-PUBLIK]', 'VA Rp3.500/transaksi; PPN belum jelas → ppn_included=false [ASUMSI]; hold H+1 [ASUMSI]', null, null),
  ('finpay', 'qris',              '2026-01-01', 'QRIS',               0.7, 0,    false, 11, 1, 'finpay.id/biaya-transaksi (9 Jul 2026)', '[FAKTA-PUBLIK]', 'MDR QRIS 0,7 %; PPN belum jelas → ppn_included=false [ASUMSI]', null, null),
  ('finpay', 'qris',              '2026-10-01', 'QRIS',               0.7, 0,    false, 11, 1, 'Kebijakan BI MDR QRIS 0 % ≤ Rp100.000 mulai 1 Okt 2026', '[PERLU-KONFIRMASI-KONTRAK]', 'Tarif 0 % untuk nominal ≤ Rp100.000 (usaha mikro) — konfirmasi apakah berlaku untuk AntarKita di kontrak Finpay', '[PERLU-KONFIRMASI-KONTRAK]', 0),
  ('finpay', 'card',              '2026-01-01', 'Kartu kredit/debit', 2.3, 1000, false, 11, 3, 'finpay.id/biaya-transaksi (9 Jul 2026)', '[FAKTA-PUBLIK]', 'Kartu 2,3 % + Rp1.000; hold H+3 [ASUMSI]', null, null),
  ('finpay', 'gopay',             '2026-01-01', 'GoPay',              2.0, 0,    false, 11, 1, 'finpay.id/biaya-transaksi (9 Jul 2026)', '[ASUMSI]', '[ASUMSI: rentang publik e-wallet 1,5–2 %] → batas atas 2 %', null, null),
  ('finpay', 'shopeepay',         '2026-01-01', 'ShopeePay',          2.0, 0,    false, 11, 1, 'finpay.id/biaya-transaksi (9 Jul 2026)', '[ASUMSI]', '[ASUMSI: rentang publik e-wallet 1,5–2 %] → batas atas 2 %', null, null),
  ('finpay', 'ovo',               '2026-01-01', 'OVO',                2.0, 0,    false, 11, 1, 'finpay.id/biaya-transaksi (9 Jul 2026)', '[ASUMSI]', '[ASUMSI: rentang publik e-wallet 1,5–2 %] → batas atas 2 %', null, null),
  ('finpay', 'dana',              '2026-01-01', 'DANA',               2.0, 0,    false, 11, 1, 'finpay.id/biaya-transaksi (9 Jul 2026)', '[ASUMSI]', '[ASUMSI: rentang publik e-wallet 1,5–2 %] → batas atas 2 %', null, null),
  ('finpay', 'linkaja',           '2026-01-01', 'LinkAja',            2.0, 0,    false, 11, 1, 'finpay.id/biaya-transaksi (9 Jul 2026)', '[ASUMSI]', '[ASUMSI: rentang publik e-wallet 1,5–2 %]; saluran belum ada di aplikasi (payment_channel_keys)', null, null),
  ('finpay', 'finpay_money',      '2026-01-01', 'Finpay Money',       2.0, 0,    false, 11, 1, 'finpay.id/biaya-transaksi (9 Jul 2026)', '[ASUMSI]', '[ASUMSI: rentang publik e-wallet 1,5–2 %]; saluran belum ada di aplikasi', null, null),
  ('finpay', 'retail_alfamart',   '2026-01-01', 'Alfamart',           0,   5000, false, 11, 2, 'finpay.id/biaya-transaksi (9 Jul 2026)', '[ASUMSI]', '[ASUMSI] Rp5.000/transaksi ritel; saluran belum ada di aplikasi', null, null),
  ('finpay', 'retail_indomaret',  '2026-01-01', 'Indomaret',          0,   5000, false, 11, 2, 'finpay.id/biaya-transaksi (9 Jul 2026)', '[ASUMSI]', '[ASUMSI] Rp5.000/transaksi ritel; saluran belum ada di aplikasi', null, null),
  ('finpay', 'paylater_kredivo',  '2026-01-01', 'Kredivo',            2.3, 0,    false, 11, 2, 'finpay.id/biaya-transaksi (9 Jul 2026)', '[ASUMSI]', '[ASUMSI: batas atas rentang publik paylater] 2,3 %; saluran belum ada di aplikasi', null, null),
  ('finpay', 'paylater_indodana', '2026-01-01', 'Indodana',           2.3, 0,    false, 11, 2, 'finpay.id/biaya-transaksi (9 Jul 2026)', '[ASUMSI]', '[ASUMSI: batas atas rentang publik paylater] 2,3 %; saluran belum ada di aplikasi', null, null),
  ('finpay', 'instant_payment',   '2026-01-01', 'Instant payment',    0,   4000, false, 11, 1, 'finpay.id/biaya-transaksi (9 Jul 2026)', '[FAKTA-PUBLIK]', 'Instant payment Rp4.000/transaksi; saluran belum ada di aplikasi', null, null)
on conflict (provider, channel, effective_from) do nothing;
-- (a) GoPay TIDAK didukung adapter Finpay (supabase/functions/_shared/providers/finpay.ts: gopay = null) →
-- baris dinonaktifkan (sekali; admin boleh menyalakan lagi bila adapter sudah mendukung). payment_provider_public
-- menyembunyikan baris nonaktif, payment_intent_create/order_payment_prepare menolaknya (payment_channel_provider_ok).
update public.payment_channel_fees set active = false, note = coalesce(note || ' · ', '') || '[0105] dinonaktifkan: adapter Finpay belum mendukung GoPay'
 where provider = 'finpay' and channel = 'gopay' and coalesce(note, '') not like '%adapter Finpay belum mendukung GoPay%';

-- pg_fee_calc v3: (kanal, nominal, provider default aktif, waktu default now()). Satu fungsi saja:
-- pemanggil 2 argumen lama (create_order, pg_fee_estimate, uji v2) tetap jalan lewat default.
drop function if exists public.pg_fee_calc(text, bigint);
create or replace function public.pg_fee_calc(p_channel text, p_amount bigint, p_provider text default null, p_at timestamptz default now())
returns table(fee bigint, ppn bigint)
language plpgsql stable security definer set search_path = public as $$
declare f payment_channel_fees; v_prov text; v_ch text := lower(trim(coalesce(p_channel, ''))); v_pct numeric;
begin
  fee := 0; ppn := 0;
  if v_ch = '' or p_amount is null or p_amount <= 0 then return next; return; end if;
  v_prov := lower(coalesce(nullif(trim(p_provider), ''), payment_provider_active()));
  if v_prov not in ('midtrans', 'finpay', 'internal') then v_prov := payment_provider_active(); end if;   -- 'simulated' → tarif provider aktif
  select * into f from payment_channel_fees
   where provider = v_prov and channel = v_ch and effective_from <= (coalesce(p_at, now()) at time zone 'Asia/Jakarta')::date
   order by effective_from desc limit 1;
  if not found then   -- kanal internal (tunai/saldo/NFC) dicatat dengan provider 'internal'
    select * into f from payment_channel_fees
     where provider = 'internal' and channel = v_ch and effective_from <= (coalesce(p_at, now()) at time zone 'Asia/Jakarta')::date
     order by effective_from desc limit 1;
  end if;
  if not found or not f.active then return next; return; end if;
  v_pct := case when f.fee_pct_under_100k is not null and p_amount <= 100000 then f.fee_pct_under_100k else f.fee_pct end;
  fee := round(p_amount * v_pct / 100.0)::bigint + f.fee_fixed;
  ppn := case when f.ppn_included then 0 else round(fee * f.ppn_pct / 100.0)::bigint end;
  return next;
end $$;
revoke all on function public.pg_fee_calc(text, bigint, text, timestamptz) from public;
grant execute on function public.pg_fee_calc(text, bigint, text, timestamptz) to anon, authenticated, service_role;
comment on function public.pg_fee_calc(text, bigint, text, timestamptz) is
  'Finpay v3 §1: biaya gateway (fee, ppn) dari payment_channel_fees — baris provider (default payment_provider_active) dengan effective_from ≤ tanggal transaksi (WIB) terbaru; fee_pct_under_100k untuk nominal ≤ Rp100.000. Pemanggil 2 argumen (v2) tetap jalan.';

create or replace function public.pg_hold_days(p_channel text, p_bank text default null)
returns int language sql stable security definer set search_path = public as $$
  select coalesce((f.hold_days_by_bank ->> lower(trim(coalesce(p_bank, ''))))::int, f.hold_days, 0)
  from (select 1) x
  left join lateral (select * from payment_channel_fees c
                      where c.channel = lower(trim(coalesce(p_channel, ''))) and c.provider in (payment_provider_active(), 'internal')
                        and c.effective_from <= (now() at time zone 'Asia/Jakarta')::date
                      order by (c.provider = payment_provider_active()) desc, c.effective_from desc limit 1) f on true;
$$;
revoke all on function public.pg_hold_days(text, text) from public, anon, authenticated;

-- §0.5: siapa menanggung biaya PG. Pelanggan HANYA bila aturan layanan (service_economics.pg_fee_policy = customer)
-- DAN kanal pass_to_customer DAN pass_to_customer_legal_ok. QRIS tidak pernah (dikunci).
create or replace function public.pg_fee_borne_by_for(p_service service_type, p_channel text, p_provider text default null, p_at timestamptz default now())
returns text language plpgsql stable security definer set search_path = public as $$
declare v_pol text; f payment_channel_fees; v_ch text := lower(trim(coalesce(p_channel, '')));
  v_prov text := lower(coalesce(nullif(trim(p_provider), ''), payment_provider_active()));
begin
  if v_prov not in ('midtrans', 'finpay') then v_prov := payment_provider_active(); end if;
  select pg_fee_policy into v_pol from service_economics where service = p_service;
  if coalesce(v_pol, 'platform') <> 'customer' or v_ch = 'qris' then return 'platform'; end if;
  select * into f from payment_channel_fees where provider = v_prov and channel = v_ch
     and effective_from <= (coalesce(p_at, now()) at time zone 'Asia/Jakarta')::date order by effective_from desc limit 1;
  if found and f.pass_to_customer and f.pass_to_customer_legal_ok then return 'customer'; end if;
  return 'platform';
end $$;
revoke all on function public.pg_fee_borne_by_for(service_type, text, text, timestamptz) from public;
grant execute on function public.pg_fee_borne_by_for(service_type, text, text, timestamptz) to anon, authenticated, service_role;
comment on function public.pg_fee_borne_by_for(service_type, text, text, timestamptz) is
  'Finpay v3 §0.5: customer HANYA bila service_economics.pg_fee_policy=customer DAN payment_channel_fees.pass_to_customer DAN pass_to_customer_legal_ok (QRIS selalu platform). Default: platform.';

-- Admin: ubah/tambah versi tarif (provider, kanal, berlaku mulai) — PIN + audit
create or replace function public.admin_set_payment_channel_fee(p_provider text, p_channel text, p_effective_from date, p_patch jsonb)
returns payment_channel_fees
language plpgsql security definer set search_path = public as $$
declare
  b payment_channel_fees; a payment_channel_fees; k text; ringkas text; v_new boolean := false;
  v_prov text := lower(trim(coalesce(p_provider, ''))); v_key text := lower(trim(coalesce(p_channel, '')));
  v_from date := coalesce(p_effective_from, '2026-01-01');
  allowed constant text[] := array['label','fee_pct','fee_fixed','ppn_included','ppn_pct','hold_days','hold_days_by_bank',
    'min_auto_disburse','source','notes','active','pass_to_customer','pass_to_customer_legal_ok','source_label','note','fee_pct_under_100k'];
begin
  perform admin_require('fee');
  perform admin_require_unlock();
  if v_prov not in ('midtrans', 'finpay', 'internal') then raise exception 'Provider harus midtrans|finpay|internal'; end if;
  if v_key !~ '^[a-z0-9_]{2,40}$' then raise exception 'Kode kanal tidak valid'; end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then raise exception 'Patch kosong: kirim objek {kolom: nilai}'; end if;
  for k in select jsonb_object_keys(p_patch) loop
    if not (k = any (allowed)) then raise exception 'Kolom tidak dikenal: %', k; end if;
  end loop;
  select * into b from payment_channel_fees where provider = v_prov and channel = v_key and effective_from = v_from for update;
  if not found then
    -- versi baru: salin dari versi sebelumnya (bila ada) supaya patch cukup berisi yang berubah
    v_new := true;
    select * into b from payment_channel_fees where provider = v_prov and channel = v_key and effective_from < v_from order by effective_from desc limit 1;
    if not found then
      if not (p_patch ? 'label') then raise exception 'Kanal baru wajib mengisi label'; end if;
      b.provider := v_prov; b.channel := v_key; b.fee_pct := 0; b.fee_fixed := 0; b.ppn_included := false; b.ppn_pct := 11;
      b.hold_days := 0; b.hold_days_by_bank := '{}'; b.min_auto_disburse := 50000; b.active := true;
      b.pass_to_customer := false; b.pass_to_customer_legal_ok := false;
    end if;
    b.effective_from := v_from;
  end if;
  a := b;
  begin
    if p_patch ? 'label' then a.label := nullif(trim(p_patch->>'label'), ''); end if;
    if p_patch ? 'fee_pct' then a.fee_pct := (p_patch->>'fee_pct')::numeric; end if;
    if p_patch ? 'fee_fixed' then a.fee_fixed := (p_patch->>'fee_fixed')::bigint; end if;
    if p_patch ? 'ppn_included' then a.ppn_included := (p_patch->>'ppn_included')::boolean; end if;
    if p_patch ? 'ppn_pct' then a.ppn_pct := (p_patch->>'ppn_pct')::numeric; end if;
    if p_patch ? 'hold_days' then a.hold_days := (p_patch->>'hold_days')::int; end if;
    if p_patch ? 'hold_days_by_bank' then a.hold_days_by_bank := coalesce(p_patch->'hold_days_by_bank', '{}'::jsonb); end if;
    if p_patch ? 'min_auto_disburse' then a.min_auto_disburse := (p_patch->>'min_auto_disburse')::bigint; end if;
    if p_patch ? 'source' then a.source := p_patch->>'source'; end if;
    if p_patch ? 'notes' then a.notes := p_patch->>'notes'; end if;
    if p_patch ? 'note' then a.note := p_patch->>'note'; end if;
    if p_patch ? 'source_label' then a.source_label := p_patch->>'source_label'; end if;
    if p_patch ? 'active' then a.active := (p_patch->>'active')::boolean; end if;
    if p_patch ? 'pass_to_customer' then a.pass_to_customer := (p_patch->>'pass_to_customer')::boolean; end if;
    if p_patch ? 'pass_to_customer_legal_ok' then a.pass_to_customer_legal_ok := (p_patch->>'pass_to_customer_legal_ok')::boolean; end if;
    if p_patch ? 'fee_pct_under_100k' then a.fee_pct_under_100k := nullif(p_patch->>'fee_pct_under_100k', '')::numeric; end if;
  exception when invalid_text_representation or numeric_value_out_of_range or datatype_mismatch then
    raise exception 'Nilai patch tidak valid: %', sqlerrm;
  end;
  if a.fee_pct is null or a.fee_pct < 0 or a.fee_pct > 20 then raise exception 'fee_pct harus 0–20 (%%)'; end if;
  if a.fee_fixed is null or a.fee_fixed < 0 or a.fee_fixed > 100000 then raise exception 'fee_fixed harus Rp0–Rp100.000'; end if;
  if a.ppn_pct is null or a.ppn_pct < 0 or a.ppn_pct > 20 then raise exception 'ppn_pct harus 0–20 (%%)'; end if;
  if a.hold_days is null or a.hold_days < 0 or a.hold_days > 30 then raise exception 'hold_days harus 0–30 hari'; end if;
  if a.fee_pct_under_100k is not null and (a.fee_pct_under_100k < 0 or a.fee_pct_under_100k > 20) then raise exception 'fee_pct_under_100k harus 0–20 (%%)'; end if;
  if a.source_label is not null and a.source_label not in ('[FAKTA-PUBLIK]','[KONTRAK]','[ASUMSI]','[PERLU-KONFIRMASI-KONTRAK]','[FAKTA]') then
    raise exception 'source_label harus [FAKTA-PUBLIK]|[KONTRAK]|[ASUMSI]|[PERLU-KONFIRMASI-KONTRAK]';
  end if;
  if a.channel = 'qris' and coalesce(a.pass_to_customer, false) then
    raise exception 'QRIS tidak boleh dibebankan ke pelanggan (larangan surcharge Bank Indonesia) — pass_to_customer dikunci false';
  end if;
  if coalesce(a.pass_to_customer, false) and not coalesce(a.pass_to_customer_legal_ok, false) then
    raise notice 'pass_to_customer aktif tetapi pass_to_customer_legal_ok belum — biaya tetap ditanggung platform sampai kajian legal selesai';
  end if;
  if v_new then
    insert into payment_channel_fees (provider, channel, effective_from, label, fee_pct, fee_fixed, ppn_included, ppn_pct, hold_days, hold_days_by_bank,
      min_auto_disburse, source, notes, active, pass_to_customer, pass_to_customer_legal_ok, source_label, note, fee_pct_under_100k, updated_at, updated_by)
    values (a.provider, a.channel, a.effective_from, a.label, a.fee_pct, a.fee_fixed, a.ppn_included, a.ppn_pct, a.hold_days, a.hold_days_by_bank,
      a.min_auto_disburse, a.source, a.notes, a.active, a.pass_to_customer, a.pass_to_customer_legal_ok, a.source_label, a.note, a.fee_pct_under_100k, now(), auth.uid())
    returning * into a;
  else
    update payment_channel_fees set label = a.label, fee_pct = a.fee_pct, fee_fixed = a.fee_fixed, ppn_included = a.ppn_included, ppn_pct = a.ppn_pct,
      hold_days = a.hold_days, hold_days_by_bank = a.hold_days_by_bank, min_auto_disburse = a.min_auto_disburse, source = a.source, notes = a.notes,
      active = a.active, pass_to_customer = a.pass_to_customer, pass_to_customer_legal_ok = a.pass_to_customer_legal_ok, source_label = a.source_label,
      note = a.note, fee_pct_under_100k = a.fee_pct_under_100k, updated_at = now(), updated_by = auth.uid()
    where provider = v_prov and channel = v_key and effective_from = v_from returning * into a;
  end if;
  select string_agg(format('%s: %s → %s', x.key, x.lama, x.baru), ', ') into ringkas
  from (select key, bj.value #>> '{}' as lama, aj.value #>> '{}' as baru
        from jsonb_each(to_jsonb(b)) bj(key, value) join jsonb_each(to_jsonb(a)) aj using (key)
        where key = any (allowed) and bj.value is distinct from aj.value) x;
  perform log_activity('pg_fee.updated', 'payment_channel_fees', v_prov || ':' || v_key || ':' || v_from,
    'Biaya ' || payment_provider_label(v_prov) || ' ' || v_key || ' berlaku ' || v_from || case when v_new then ' (versi baru)' else '' end || ': ' || coalesce(ringkas, '(tidak ada perubahan nilai)'),
    jsonb_build_object('before', case when v_new then null else to_jsonb(b) end, 'after', to_jsonb(a), 'patch', p_patch));
  return a;
end $$;
revoke all on function public.admin_set_payment_channel_fee(text, text, date, jsonb) from public, anon;
grant execute on function public.admin_set_payment_channel_fee(text, text, date, jsonb) to authenticated;
comment on function public.admin_set_payment_channel_fee(text, text, date, jsonb) is
  'Finpay v3 §1: ubah/buat versi tarif (provider, kanal, effective_from). admin_require(fee) + PIN; QRIS pass_to_customer ditolak; log before/after.';

-- Tanda tangan v2 (Panel Admin v2): ubah versi tarif yang BERLAKU SEKARANG untuk kanal itu
-- (provider = patch.provider, else provider baris midtrans/internal yang ada)
create or replace function public.admin_set_payment_channel_fee(p_channel text, p_patch jsonb)
returns payment_channel_fees
language plpgsql security definer set search_path = public as $$
declare v_key text := lower(trim(coalesce(p_channel, ''))); r payment_channel_fees; v_prov text;
begin
  v_prov := lower(nullif(trim(coalesce(p_patch->>'provider', '')), ''));
  select * into r from payment_channel_fees
   where channel = v_key and (v_prov is null or provider = v_prov) and effective_from <= (now() at time zone 'Asia/Jakarta')::date
   order by (provider = 'midtrans') desc, (provider = 'internal') desc, effective_from desc limit 1;
  if not found then raise exception 'Saluran pembayaran tidak dikenal: %', coalesce(p_channel, 'kosong'); end if;
  return admin_set_payment_channel_fee(r.provider, r.channel, r.effective_from, coalesce(p_patch, '{}'::jsonb) - 'provider');
end $$;
revoke all on function public.admin_set_payment_channel_fee(text, jsonb) from public, anon;
grant execute on function public.admin_set_payment_channel_fee(text, jsonb) to authenticated;
comment on function public.admin_set_payment_channel_fee(text, jsonb) is
  'Kompatibel v2 (0100): ubah versi tarif yang berlaku sekarang untuk kanal (utamakan midtrans/internal). Versi baru → admin_set_payment_channel_fee(provider, channel, effective_from, patch).';

drop function if exists public.admin_payment_channel_fees();
create or replace function public.admin_payment_channel_fees(p_provider text default null)
returns setof payment_channel_fees
language sql stable security definer set search_path = public as $$
  select * from payment_channel_fees
   where admin_has('payments_view') and (p_provider is null or provider = lower(trim(p_provider)))
   order by (provider = 'internal'), provider, channel = any (payment_gateway_channel_keys()) desc, channel, effective_from desc;
$$;
revoke all on function public.admin_payment_channel_fees(text) from public, anon;
grant execute on function public.admin_payment_channel_fees(text) to authenticated;

-- Estimasi biaya di checkout (0104) — sekarang provider aktif + aturan §0.5
create or replace function public.pg_fee_estimate(p_service service_type, p_channel text, p_amount bigint)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_ch text := payment_channel_of(p_channel); v_gw boolean; v_fee bigint := 0; v_ppn bigint := 0; v_pol text; v_borne text; v_cust bigint;
  v_prov text := payment_provider_active();
begin
  if p_amount is null or p_amount < 0 or p_amount > 100000000 then raise exception 'Nominal estimasi harus Rp0–Rp100.000.000'; end if;
  select pg_fee_policy into v_pol from service_economics where service = p_service;
  v_pol := coalesce(v_pol, 'platform');
  v_gw := v_ch = any (payment_gateway_channel_keys());
  if v_gw then
    select f.fee, f.ppn into v_fee, v_ppn from pg_fee_calc(v_ch, p_amount, v_prov) f;
    v_fee := coalesce(v_fee, 0); v_ppn := coalesce(v_ppn, 0);
    v_borne := pg_fee_borne_by_for(p_service, v_ch, v_prov);
  end if;
  v_cust := case when v_borne = 'customer' then v_fee + v_ppn else 0 end;
  return jsonb_build_object(
    'service', p_service, 'channel', v_ch, 'channel_label', payment_channel_label(v_ch), 'is_gateway', v_gw,
    'provider', v_prov, 'provider_label', payment_provider_label(v_prov),
    'amount', p_amount, 'fee', v_fee, 'ppn', v_ppn, 'total_fee', v_fee + v_ppn,
    'borne_by', v_borne, 'policy', v_pol,
    'customer_fee', v_cust, 'total_with_fee', p_amount + v_cust, 'estimate', true,
    'note', case when not v_gw then 'Bukan saluran payment gateway — tidak ada biaya pembayaran'
                 when v_borne = 'customer' then 'Biaya metode pembayaran (' || payment_provider_label(v_prov) || ') ditambahkan ke total; angka final dihitung ulang saat membayar'
                 else 'Biaya metode pembayaran (' || payment_provider_label(v_prov) || ') ditanggung AntarKita — tidak menambah total' end);
end $$;
revoke all on function public.pg_fee_estimate(service_type, text, bigint) from public;
grant execute on function public.pg_fee_estimate(service_type, text, bigint) to anon, authenticated, service_role;

-- Konfigurasi publik provider (anon): provider aktif, env, simulasi, kanal + biaya
create or replace function public.payment_provider_public()
returns jsonb language sql stable security definer set search_path = public as $$
  with cur as (
    select distinct on (f.channel) f.* from payment_channel_fees f
     where f.provider = payment_provider_active() and f.effective_from <= (now() at time zone 'Asia/Jakarta')::date
     order by f.channel, f.effective_from desc
  )
  select jsonb_build_object(
    'provider', payment_provider_active(), 'provider_label', payment_provider_label(payment_provider_active()),
    'env', payment_provider_env(), 'simulation', payments_simulation_active(),
    'gateway_order_payment_enabled', gateway_order_payment_enabled(),
    'channels', coalesce((select jsonb_agg(jsonb_build_object(
        'key', c.channel, 'label', coalesce(c.label, payment_channel_label(c.channel)),
        'fee_label', trim(both ' +' from concat_ws(' + ',
            case when c.fee_pct > 0 then replace(trim(to_char(c.fee_pct, 'FM990.99')), '.', ',') || ' %' end,
            case when c.fee_fixed > 0 then 'Rp' || replace(to_char(c.fee_fixed, 'FM999,999,999'), ',', '.') end))
          || case when c.fee_pct = 0 and c.fee_fixed = 0 then 'Gratis' else '' end
          || case when c.ppn_included then '' else ' (+PPN)' end,
        'fee_pct', c.fee_pct, 'fee_fixed', c.fee_fixed, 'fee_pct_under_100k', c.fee_pct_under_100k,
        'pass_to_customer', c.pass_to_customer and c.pass_to_customer_legal_ok and c.channel <> 'qris',
        'enabled', c.active and c.channel = any (payment_gateway_channel_keys()) and payment_channel_order_enabled(c.channel),
        'supported_by_app', c.channel = any (payment_channel_keys()))
      order by (c.channel = any (payment_gateway_channel_keys())) desc, c.channel) from cur c where c.active), '[]'::jsonb));   -- (a) kanal nonaktif/tidak didukung provider disembunyikan
$$;
grant execute on function public.payment_provider_public() to anon, authenticated, service_role;
comment on function public.payment_provider_public() is
  'Finpay v3 §1 (anon): {provider, env, simulation, channels:[{key,label,fee_label,fee_pct,fee_fixed,pass_to_customer,enabled}]} — kanal = baris payment_channel_fees AKTIF provider aktif yang berlaku hari ini (kanal yang tidak didukung adapter provider, mis. GoPay di Finpay, tidak tampil).';

-- (a) kanal gateway didukung provider = ada baris payment_channel_fees aktif (berlaku hari ini) untuk provider itu
create or replace function public.payment_channel_provider_ok(p_channel text, p_provider text)
returns boolean language sql stable security definer set search_path = public as $$
  select case when lower(coalesce(p_provider, '')) = 'simulated' then true
    else coalesce((select f.active from payment_channel_fees f
                    where f.provider = lower(coalesce(p_provider, '')) and f.channel = lower(trim(coalesce(p_channel, '')))
                      and f.effective_from <= (now() at time zone 'Asia/Jakarta')::date
                    order by f.effective_from desc limit 1), false) end;
$$;
revoke all on function public.payment_channel_provider_ok(text, text) from public, anon;
grant execute on function public.payment_channel_provider_ok(text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4. payments kanonik (§2) + orders.settlement_status / payment_support_ref
-- ---------------------------------------------------------------------
alter table public.payments add column if not exists provider_ref text;
alter table public.payments add column if not exists provider_txn_id text;
alter table public.payments add column if not exists checkout_url text;
alter table public.payments add column if not exists checkout_token text;
alter table public.payments add column if not exists qr_string text;
alter table public.payments add column if not exists payment_code text;
alter table public.payments add column if not exists expires_at timestamptz;
alter table public.payments add column if not exists paid_at timestamptz;
alter table public.payments add column if not exists pay_status text;
alter table public.payments add column if not exists refunded_amount bigint not null default 0;
alter table public.payments add column if not exists reconciled_at timestamptz;
alter table public.payments add column if not exists support_ref text;
alter table public.payments add column if not exists note text;
alter table public.payments add column if not exists reconcile_run_id uuid;
alter table public.payments add column if not exists env text;   -- T1/R: lingkungan provider saat intent dibuat (sandbox|production)
update public.payments set env = payment_provider_env() where env is null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'payments_env_check') then
    alter table public.payments add constraint payments_env_check check (env is null or env in ('sandbox', 'production'));
  end if;
end $$;
comment on column public.payments.env is 'Lingkungan provider (sandbox|production) saat intent dibuat (payment_provider_env). payment_event_ingest(p_env) menolak event dari lingkungan lain.';

alter table public.orders add column if not exists settlement_status text;
alter table public.orders add column if not exists payment_support_ref text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'orders_settlement_status_check') then
    alter table public.orders add constraint orders_settlement_status_check
      check (settlement_status is null or settlement_status in ('ORDER_COMPLETED','PAYOUT_PENDING','PAYOUT_SETTLED','RECONCILED'));
  end if;
end $$;
comment on column public.orders.settlement_status is 'Finpay v3 §3: ORDER_COMPLETED (selesai) → PAYOUT_PENDING (payable masuk penarikan) → PAYOUT_SETTLED → RECONCILED.';
comment on column public.orders.payment_support_ref is 'Kode CS pembayaran terakhir pesanan ini (AK-xxxxxx), sama dengan payments.support_ref intent terakhir.';

create or replace function public.payment_status_to_legacy(p text)
returns text language sql immutable set search_path = public as $$
  select case upper(coalesce(p, 'PENDING'))
    when 'PENDING' then 'pending' when 'EXPIRED' then 'expire' when 'FAILED' then 'failure'
    -- semua status sesudah dana diterima tetap 'settlement' (penanda idempoten payment_settle & rekonsiliasi v2)
    else 'settlement' end;
$$;
create or replace function public.payment_status_from_legacy(p text)
returns text language sql immutable set search_path = public as $$
  select case lower(coalesce(p, 'pending'))
    when 'settlement' then 'PAID' when 'expire' then 'EXPIRED' when 'cancel' then 'FAILED' when 'deny' then 'FAILED' when 'failure' then 'FAILED'
    else 'PENDING' end;
$$;

create or replace function public.gen_support_ref()
returns text language plpgsql volatile set search_path = public as $$
declare v text; n int := 0;
begin
  loop
    v := 'AK-' || upper(substr(md5(gen_random_uuid()::text || clock_timestamp()::text), 1, 6));
    exit when not exists (select 1 from payments where support_ref = v) and not exists (select 1 from orders where payment_support_ref = v);
    n := n + 1;
    if n > 50 then raise exception 'gen_support_ref: gagal membuat kode unik'; end if;
  end loop;
  return v;
end $$;
revoke all on function public.gen_support_ref() from public, anon, authenticated;

-- isi baris lama (sebelum trigger): pay_status dari status, provider_ref, support_ref unik
update public.payments set pay_status = payment_status_from_legacy(status) where pay_status is null;
update public.payments set provider_ref = external_id where provider_ref is null and external_id is not null;
update public.payments set paid_at = coalesce(settlement_time, updated_at) where paid_at is null and pay_status = 'PAID';
do $$
declare r record;
begin
  for r in select id from payments where support_ref is null loop
    update payments set support_ref = gen_support_ref() where id = r.id;
  end loop;
end $$;
-- satu intent PENDING per order: tagihan pending yang lebih lama dianggap diganti (superseded)
update public.payments p set pay_status = 'FAILED', status = 'cancel',
    raw = coalesce(p.raw, '{}'::jsonb) || jsonb_build_object('superseded', true, 'superseded_by_migration', '0105')
 where p.purpose = 'order' and p.order_id is not null and p.pay_status = 'PENDING'
   and exists (select 1 from payments q where q.order_id = p.order_id and q.purpose = 'order' and q.pay_status = 'PENDING'
                and (q.created_at, q.id) > (p.created_at, p.id));
alter table public.payments alter column pay_status set default 'PENDING';
alter table public.payments alter column pay_status set not null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'payments_pay_status_check') then
    alter table public.payments add constraint payments_pay_status_check check (pay_status in
      ('PENDING','PAID','FAILED','EXPIRED','REFUND_REQUESTED','PARTIALLY_REFUNDED','REFUNDED','DISPUTED','RECONCILED'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'payments_refunded_amount_check') then
    alter table public.payments add constraint payments_refunded_amount_check check (refunded_amount >= 0 and refunded_amount <= amount);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'payments_support_ref_format') then
    alter table public.payments add constraint payments_support_ref_format check (support_ref is null or support_ref ~ '^AK-[0-9A-F]{6}$');
  end if;
end $$;
create unique index if not exists payments_support_ref_key on public.payments (support_ref) where support_ref is not null;
create unique index if not exists payments_one_pending_per_order on public.payments (order_id)
  where pay_status = 'PENDING' and purpose = 'order' and order_id is not null;
create index if not exists payments_provider_ref_idx on public.payments (provider_ref) where provider_ref is not null;
create index if not exists payments_pay_status_idx on public.payments (pay_status, created_at);
create unique index if not exists orders_payment_support_ref_key on public.orders (payment_support_ref) where payment_support_ref is not null;
comment on column public.payments.pay_status is 'Finpay v3 §3 status kanonik. Kolom lama status disinkronkan trigger (PAID…→settlement, EXPIRED→expire, FAILED→failure, PENDING→pending).';
comment on column public.payments.support_ref is 'Kode unik AK-xxxxxx untuk CS (ditampilkan ke pelanggan).';

-- Sinkron dua arah: penulis baru mengubah pay_status; penulis lama (payment_settle, midtrans-create,
-- cancel_order, expire_unpaid_orders) mengubah status. Satu intent PENDING per order: intent baru
-- (termasuk dari midtrans-create lama) menggantikan intent PENDING sebelumnya (FAILED, superseded).
create or replace function public.payments_sync_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.pay_status := upper(coalesce(new.pay_status, 'PENDING'));
    if coalesce(new.status, 'pending') <> 'pending' and new.pay_status = 'PENDING' then
      new.pay_status := payment_status_from_legacy(new.status);
    else
      new.status := payment_status_to_legacy(new.pay_status);
    end if;
    new.provider_ref := coalesce(new.provider_ref, new.external_id);
    new.env := coalesce(new.env, payment_provider_env());
    if new.support_ref is null then new.support_ref := gen_support_ref(); end if;
    if new.purpose = 'order' and new.order_id is not null and new.pay_status = 'PENDING' then
      -- (e) intent lama digantikan: FAILED 'superseded' + dicatat di payment_events (dibatalkan manual di dasbor provider)
      perform payment_supersede(x.id, new.external_id)
         from payments x where x.order_id = new.order_id and x.purpose = 'order' and x.pay_status = 'PENDING';
    end if;
  else
    if new.pay_status is distinct from old.pay_status then
      new.pay_status := upper(new.pay_status);
      new.status := payment_status_to_legacy(new.pay_status);
    elsif new.status is distinct from old.status then
      -- penulis lama: settlement tidak menurunkan status sesudah dibayar (REFUNDED dst. tetap)
      if not (new.status = 'settlement' and old.pay_status in ('PAID','REFUND_REQUESTED','PARTIALLY_REFUNDED','REFUNDED','DISPUTED','RECONCILED')) then
        new.pay_status := payment_status_from_legacy(new.status);
      end if;
    end if;
    if new.provider_ref is null then new.provider_ref := new.external_id; end if;
  end if;
  if new.pay_status = 'PAID' and new.paid_at is null then new.paid_at := coalesce(new.settlement_time, now()); end if;
  return new;
end $$;
drop trigger if exists t_payments_sync_status on public.payments;
create trigger t_payments_sync_status before insert or update on public.payments
  for each row execute function payments_sync_status();

-- order selesai → settlement_status ORDER_COMPLETED (§3)
create or replace function public.orders_settlement_on_complete()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' and new.settlement_status is null then
    new.settlement_status := 'ORDER_COMPLETED';
  end if;
  return new;
end $$;
drop trigger if exists t_orders_settlement_on_complete on public.orders;
create trigger t_orders_settlement_on_complete before update of status on public.orders
  for each row execute function orders_settlement_on_complete();
update public.orders set settlement_status = 'ORDER_COMPLETED' where status = 'completed' and settlement_status is null;

-- ---------------------------------------------------------------------
-- 5. payment_events — inbox webhook (append-only: hanya processed_at/result boleh diisi sekali)
-- ---------------------------------------------------------------------
create table if not exists public.payment_events (
  id              bigserial primary key,
  provider        text not null,
  event_id        text not null,
  external_id     text,
  payment_id      uuid references public.payments(id),
  event_type      text,
  provider_status text,
  amount          bigint,
  signature_ok    boolean not null default false,
  raw             jsonb,
  received_at     timestamptz not null default now(),
  processed_at    timestamptz,
  result          text,
  unique (provider, event_id)
);
create index if not exists payment_events_external_idx on public.payment_events (external_id, received_at);
create index if not exists payment_events_payment_idx on public.payment_events (payment_id, received_at) where payment_id is not null;
comment on table public.payment_events is
  'Finpay v3 §2: inbox webhook/cek status provider. unique(provider, event_id) = idempoten; append-only (UPDATE hanya processed_at/result, DELETE/TRUNCATE ditolak). Ditulis hanya lewat payment_event_ingest.';
alter table public.payment_events enable row level security;
drop policy if exists payment_events_admin_read on public.payment_events;
create policy payment_events_admin_read on public.payment_events for select to authenticated using (admin_has('payments_view'));   -- R5
revoke all on public.payment_events from public, anon, authenticated;
grant select on public.payment_events to authenticated;
grant select, insert, update on public.payment_events to service_role;
revoke all on sequence public.payment_events_id_seq from public, anon, authenticated;
grant usage, select on sequence public.payment_events_id_seq to service_role;

create or replace function public.payment_events_append_only()
returns trigger language plpgsql set search_path = public as $$
begin
  if append_only_bypass() then return coalesce(new, old); end if;
  if tg_op = 'TRUNCATE' then raise exception '% append-only: TRUNCATE ditolak', tg_table_name; end if;
  if tg_op = 'DELETE' then raise exception '% append-only: DELETE ditolak (baris %)', tg_table_name, old.id; end if;
  if (to_jsonb(new) - 'processed_at' - 'result') is distinct from (to_jsonb(old) - 'processed_at' - 'result') then
    raise exception 'payment_events append-only: hanya processed_at/result yang boleh diisi (baris %)', old.id;
  end if;
  if old.processed_at is not null and (new.processed_at is distinct from old.processed_at or new.result is distinct from old.result) then
    raise exception 'payment_events append-only: event % sudah diproses (%)', old.id, old.result;
  end if;
  return new;
end $$;
drop trigger if exists t_payment_events_append_only on public.payment_events;
create trigger t_payment_events_append_only before update or delete on public.payment_events
  for each row execute function payment_events_append_only();
drop trigger if exists t_payment_events_no_truncate on public.payment_events;
create trigger t_payment_events_no_truncate before truncate on public.payment_events
  for each statement execute function payment_events_append_only();

-- (e) intent PENDING yang digantikan (ganti saluran/nominal/provider): FAILED + note 'superseded' + baris
-- payment_events 'superseded' (tampil di admin_payment_events(null)) supaya tagihan di provider bisa
-- dibatalkan manual (Midtrans tidak dibatalkan otomatis dari sini).
create or replace function public.payment_supersede(p_payment uuid, p_by text)
returns void language plpgsql security definer set search_path = public as $$
declare p payments;
begin
  update payments set pay_status = 'FAILED', note = 'superseded',
         raw = coalesce(raw, '{}'::jsonb) || jsonb_build_object('superseded', true, 'superseded_by', p_by, 'superseded_at', now())
   where id = p_payment and pay_status = 'PENDING'
  returning * into p;
  if not found then return; end if;
  insert into payment_events (provider, event_id, external_id, payment_id, event_type, provider_status, amount, signature_ok, raw, processed_at, result)
  values (p.provider, 'superseded-' || p.id, p.external_id, p.id, 'superseded', 'SUPERSEDED', p.amount, false,
          jsonb_build_object('superseded_by', p_by, 'provider', p.provider, 'support_ref', p.support_ref),
          now(), case when p.provider = 'midtrans' then 'superseded: batalkan manual tagihan ini di dasbor Midtrans (' || p.external_id || ')'
                      else 'superseded: tagihan lama tidak dipakai lagi (' || p.provider || ')' end)
  on conflict (provider, event_id) do nothing;
end $$;
revoke all on function public.payment_supersede(uuid, text) from public, anon, authenticated;

create or replace function public.admin_payment_events(p_external_id text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_q text := nullif(btrim(coalesce(p_external_id, '')), '');
begin
  perform admin_require('payments_view');
  if v_q is null then
    -- (e) tanpa kueri: daftar intent yang digantikan (perlu dibatalkan manual di dasbor provider)
    return jsonb_build_object('query', null, 'superseded', coalesce((select jsonb_agg(to_jsonb(e) || jsonb_build_object(
        'support_ref', p.support_ref, 'order_id', p.order_id, 'pay_status', p.pay_status) order by e.received_at desc)
      from (select * from payment_events where event_type = 'superseded' order by received_at desc limit 200) e
      left join payments p on p.id = e.payment_id), '[]'::jsonb),
      'events', '[]'::jsonb);
  end if;
  return jsonb_build_object('query', v_q,
    'payment', (select to_jsonb(p) - 'raw' from payments p where p.external_id = v_q or p.provider_ref = v_q or p.support_ref = upper(v_q) limit 1),
    'events', coalesce((select jsonb_agg(to_jsonb(e) order by e.received_at, e.id) from payment_events e
                         where e.external_id = v_q or e.payment_id = (select p.id from payments p where p.external_id = v_q or p.provider_ref = v_q or p.support_ref = upper(v_q) limit 1)), '[]'::jsonb));
end $$;
revoke all on function public.admin_payment_events(text) from public, anon;
grant execute on function public.admin_payment_events(text) to authenticated;

-- ---------------------------------------------------------------------
-- 7. Pemetaan status provider → kanonik (§3) + kait yang diisi 0108
-- ---------------------------------------------------------------------
create or replace function public.payment_status_map(p_provider text, p_status text, p_raw jsonb default null)
returns text language plpgsql immutable set search_path = public as $$
declare s text := upper(btrim(coalesce(p_status, ''))); v_prov text := lower(coalesce(p_provider, ''));
begin
  if s = '' then return null; end if;
  if v_prov = 'midtrans' or (v_prov = 'simulated' and s in ('SETTLEMENT','CAPTURE','EXPIRE','DENY','CANCEL','FAILURE','REFUND','PARTIAL_REFUND','CHARGEBACK','PARTIAL_CHARGEBACK')) then
    return case s
      when 'SETTLEMENT' then 'PAID'
      when 'CAPTURE' then case when lower(coalesce(p_raw->>'fraud_status', 'accept')) = 'accept' then 'PAID' else 'PENDING' end
      when 'PENDING' then 'PENDING' when 'AUTHORIZE' then 'PENDING'
      when 'EXPIRE' then 'EXPIRED'
      when 'DENY' then 'FAILED' when 'CANCEL' then 'FAILED' when 'FAILURE' then 'FAILED'
      when 'REFUND' then 'REFUNDED' when 'PARTIAL_REFUND' then 'PARTIALLY_REFUNDED'
      when 'CHARGEBACK' then 'DISPUTED' when 'PARTIAL_CHARGEBACK' then 'DISPUTED'
      else null end;
  end if;
  -- finpay (+ simulated memakai kosakata kanonik/Finpay)
  return case s
    when 'PAID' then 'PAID' when 'CAPTURED' then 'PAID'
    when 'PENDING' then 'PENDING' when 'AUTHORIZED' then 'PENDING'
    when 'FAILURE' then 'FAILED' when 'FAILED' then 'FAILED' when 'CANCELLED' then 'FAILED' when 'CANCELED' then 'FAILED'
    when 'EXPIRED' then 'EXPIRED'
    when 'REFUNDED' then 'REFUNDED' when 'PARTIALLY_REFUNDED' then 'PARTIALLY_REFUNDED' when 'PARTIAL_REFUNDED' then 'PARTIALLY_REFUNDED'
    when 'DISPUTED' then 'DISPUTED' when 'CHARGEBACK' then 'DISPUTED'
    else null end;
end $$;
grant execute on function public.payment_status_map(text, text, jsonb) to service_role;
revoke all on function public.payment_status_map(text, text, jsonb) from public, anon, authenticated;

-- Dana gateway masuk tetapi pesanan tidak bisa dibayar (batal/kedaluwarsa/nominal beda/sakelar mati).
-- 0105: perilaku v2 — kembalikan ke saldo AntarPay (closed-loop). 0108 menggantinya → refund_requests.
create or replace function public.payment_refund_auto(p_payment uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare p payments; o orders; v_label text;
begin
  select * into p from payments where id = p_payment;
  if not found then return null; end if;
  if p.order_id is not null then select * into o from orders where id = p.order_id; end if;
  v_label := payment_channel_label(coalesce(p.pg_channel, p.method));
  perform wallet_apply(p.user_id, 'refund', p.amount, p.order_id,
    'Refund pembayaran ' || coalesce(o.code, 'pesanan') || ' — ' || coalesce(p_reason, '-'), p.external_id);
  update wallet_transactions set pg_fee = p.pg_fee + p.pg_fee_ppn where ref = p.external_id and user_id = p.user_id and type = 'refund';
  insert into notifications (user_id, kind, title, body, data) values (p.user_id, 'system', 'Pembayaran dikembalikan ke saldo',
    'Rp' || to_char(p.amount, 'FM999G999G999') || ' via ' || v_label || ' diterima setelah ' || coalesce(o.code, 'pesanan') || ' tidak bisa diproses (' || coalesce(p_reason, '-') || '). Dana masuk ke saldo AntarPay Anda.',
    jsonb_build_object('payment_id', p.id, 'order_id', p.order_id));
  return null;
end $$;
revoke all on function public.payment_refund_auto(uuid, text) from public, anon, authenticated;

-- Kait sesudah event provider diterapkan (0108: refund selesai/sengketa chargeback). 0105: tidak ada.
create or replace function public.payment_hook_after_ingest(p_payment uuid, p_prev text, p_new text, p_amount bigint, p_raw jsonb)
returns text language plpgsql security definer set search_path = public as $$
begin
  return null;
end $$;
revoke all on function public.payment_hook_after_ingest(uuid, text, text, bigint, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 7b. payment_settle v3 (TUTUP CELAH K1)
-- ---------------------------------------------------------------------
create or replace function public.payment_settle(p_external_id text, p_status text, p_raw jsonb default null,
  p_channel text default null, p_settlement_time timestamptz default null)
returns payments
language plpgsql security definer set search_path = public as $$
declare
  p payments%rowtype; o orders%rowtype; v_ch text; v_fee bigint := 0; v_ppn bigint := 0; v_bank text; v_settle timestamptz;
  v_ok boolean := false; v_reason text; v_label text; v_fee_prov text; v_mt text; v_gross numeric; v_evid text;
begin
  select * into p from payments where external_id = p_external_id for update;
  if not found then raise exception 'Payment tidak ditemukan'; end if;
  -- 0105 T2: pemanggil langsung (bukan payment_event_ingest). Penanda ingest = GUC transaksi-lokal
  -- antarkita.payment_ingest yang HANYA diset payment_event_ingest (klien PostgREST tidak bisa memanggil
  -- set_config; p_raw._ingest tidak dipercaya karena isi notifikasi di luar tanda tangan bisa ditambah).
  if coalesce(current_setting('antarkita.payment_ingest', true), '') <> 'on' then
    if p.provider not in ('midtrans', 'simulated') then
      raise exception 'PROVIDER_MISMATCH: payment_settle langsung hanya untuk transaksi Midtrans (transaksi % memakai %) — gunakan payment_event_ingest', p.external_id, p.provider;
    end if;
    if p.provider = 'midtrans' then
      -- midtrans-webhook lama: SEMUA status (termasuk refund/partial_refund/chargeback) diteruskan ke mesin status
      -- payment_event_ingest jalur 'midtrans' (duplikat, urutan, nominal gross_amount = payments.amount, REFUNDED/DISPUTED).
      v_mt := lower(coalesce(nullif(btrim(p_raw->>'transaction_status'), ''), p_status));
      begin v_gross := nullif(btrim(coalesce(p_raw->>'gross_amount', '')), '')::numeric;
      exception when others then v_gross := null; end;
      v_evid := 'mt:' || p.external_id || ':' || v_mt || ':' || md5(coalesce(p_raw::text, ''));
      perform payment_event_ingest('midtrans', v_evid, p.external_id, v_mt,
        case when v_gross is not null and v_gross = trunc(v_gross) then v_gross::bigint end, true,
        coalesce(p_raw, '{}'::jsonb) || jsonb_build_object('_via', 'payment_settle', '_channel', p_channel), null);
      select * into p from payments where id = p.id;
      return p;
    end if;
    -- simulated (K1 di bawah): bila nominal dikirim, wajib sama
    if p_raw ? 'gross_amount' and nullif(btrim(coalesce(p_raw->>'gross_amount', '')), '') is not null then
      begin v_gross := (p_raw->>'gross_amount')::numeric; exception when others then v_gross := -1; end;
      if v_gross <> p.amount then raise exception 'AMOUNT_MISMATCH: gross_amount % ≠ nominal pembayaran %', p_raw->>'gross_amount', p.amount; end if;
    end if;
  end if;
  -- 0105 K1: simulasi hanya bila payments_simulation_enabled DAN env ≠ production DAN payments.provider = 'simulated'
  if p_status = 'settlement' and p.provider = 'simulated' and not payments_simulation_active() then
    raise exception 'Simulasi pembayaran ditolak: payments_simulation_enabled=% env=% (hanya sandbox + sakelar simulasi menyala)',
      coalesce((select value #>> '{}' from app_settings where key = 'payments_simulation_enabled'), 'false'), payment_provider_env();
  end if;
  if p.provider <> 'simulated' then
    insert into app_settings (key, value) values ('pg_last_webhook_at', to_jsonb(now())) on conflict (key) do update set value = excluded.value, updated_at = now();
  end if;
  if p.status = 'settlement' then return p; end if;   -- idempoten: notifikasi ganda tidak memproses dua kali
  update payments set status = p_status, raw = coalesce(p_raw, raw), updated_at = now() where id = p.id returning * into p;

  if p_status = 'settlement' then
    v_ch := nullif(lower(trim(coalesce(p_channel, p_raw->>'_channel', p_raw->'_antarkita'->>'channel', ''))), '');
    if v_ch is null then
      v_ch := coalesce(p.pg_channel, case when lower(p.method) = any (payment_gateway_channel_keys()) then lower(p.method) end);
    end if;
    v_label := payment_channel_label(coalesce(v_ch, p.method));
    v_bank := lower(coalesce(p_raw->'va_numbers'->0->>'bank', case when p_raw ? 'permata_va_number' then 'permata' when p_raw->>'payment_type' = 'echannel' then 'mandiri' end, p_raw->>'bank'));
    v_settle := p_settlement_time;
    if v_settle is null and p_raw ? 'settlement_time' then
      begin v_settle := ((p_raw->>'settlement_time')::timestamp at time zone 'Asia/Jakarta');
      exception when others then v_settle := null; end;
    end if;
    v_settle := coalesce(v_settle, now());
    v_fee_prov := case when p.provider in ('midtrans', 'finpay') then p.provider end;   -- 0105: tarif provider transaksi (simulasi → provider aktif)
    if v_ch is not null then select f.fee, f.ppn into v_fee, v_ppn from pg_fee_calc(v_ch, p.amount, v_fee_prov, v_settle) f; end if;
    v_fee := coalesce(v_fee, 0); v_ppn := coalesce(v_ppn, 0);
    update payments set pg_channel = v_ch, pg_fee = v_fee, pg_fee_ppn = v_ppn, settlement_time = v_settle, paid_at = coalesce(paid_at, v_settle),
      hold_until = v_settle + make_interval(days => pg_hold_days(v_ch, v_bank))
    where id = p.id returning * into p;

    if p.purpose = 'order' then
      if p.order_id is not null then select * into o from orders where id = p.order_id for update; end if;
      if o.id is null then v_reason := 'pesanan tidak ditemukan';
      elsif o.status::text <> 'awaiting_payment' or o.payment_status <> 'unpaid' then v_reason := 'pesanan sudah ' || o.status::text || '/' || o.payment_status::text;
      elsif p.amount <> o.total then v_reason := 'nominal ' || p.amount || ' ≠ total pesanan ' || o.total;
      -- 0105 K1: jalur order wajib lolos sakelar AntarPay / bayar per pesanan via gateway (0088/0104)
      elsif not (antarpay_enabled() or gateway_order_payment_enabled()) then v_reason := 'bayar per pesanan via gateway sedang dinonaktifkan';
      else v_ok := true; end if;

      if v_ok then
        update orders set payment_status = 'paid', paid_via = coalesce(v_ch, paid_via), pg_channel = coalesce(v_ch, pg_channel),
          pg_fee = case when pg_fee_borne_by = 'customer' then pg_fee else v_fee end,
          pg_fee_ppn = case when pg_fee_borne_by = 'customer' then pg_fee_ppn else v_ppn end,
          pg_fee_borne_by = case when pg_fee_borne_by = 'customer' then 'customer' when v_fee + v_ppn > 0 then 'platform' else null end,
          payment_support_ref = coalesce(p.support_ref, payment_support_ref),
          status = case when scheduled_at is not null then 'scheduled'::order_status else 'searching'::order_status end
        where id = o.id returning * into o;
        insert into order_events (order_id, status, actor_id, note) values
          (o.id, 'paid', p.user_id, 'Pembayaran ' || v_label || ' diterima (' || p.external_id || ', ' || payment_provider_label(p.provider) || ', ' || coalesce(p.support_ref, '-') || ')'),
          (o.id, o.status::text, p.user_id, case when o.status::text = 'scheduled' then 'Booking terjadwal — driver dicarikan menjelang jadwal' else 'Pesanan dibayar, mencari driver' end);
        perform ledger_post(o.id, 'created');
        insert into notifications (user_id, kind, title, body, data) values (p.user_id, 'order', 'Pembayaran berhasil',
          'Pesanan ' || o.code || ' dibayar via ' || v_label || '. ' || case when o.status::text = 'scheduled' then 'Driver dicarikan menjelang jadwal.' else 'Kami sedang mencarikan driver.' end,
          jsonb_build_object('payment_id', p.id, 'order_id', o.id, 'support_ref', p.support_ref));
      else
        -- dana sudah diterima gateway tetapi pesanan tidak bisa dibayar → pengembalian otomatis
        -- (0105: saldo AntarPay seperti v2; 0108: refund_requests late_payment)
        perform payment_refund_auto(p.id, v_reason);
      end if;
    else
      perform wallet_apply(p.user_id, 'topup', p.amount, p.order_id, 'Top up via ' || p.method || ' (' || p.provider || ')', p.external_id);
      update wallet_transactions set pg_fee = v_fee + v_ppn where ref = p.external_id and user_id = p.user_id and type = 'topup';
      insert into notifications (user_id, kind, title, body, data) values (p.user_id, 'system', 'Top up berhasil', 'Rp' || to_char(p.amount, 'FM999G999G999') || ' masuk ke AntarPay via ' || p.method, jsonb_build_object('payment_id', p.id));
    end if;
  elsif p_status in ('cancel','deny','expire','failure') then
    insert into notifications (user_id, kind, title, body, data) values (p.user_id, 'system', 'Pembayaran ' || p_status,
      'Transaksi ' || p.external_id || ' tidak selesai. ' || case when p.purpose = 'order' then 'Pesanan menunggu pembayaran — coba lagi dengan metode lain sebelum batas waktu.' else 'Coba lagi dengan metode lain.' end,
      jsonb_build_object('payment_id', p.id, 'order_id', p.order_id));
  end if;
  select * into p from payments where id = p.id;
  return p;
end $$;
revoke all on function public.payment_settle(text, text, jsonb, text, timestamptz) from public, anon, authenticated;
grant execute on function public.payment_settle(text, text, jsonb, text, timestamptz) to service_role;
comment on function public.payment_settle(text, text, jsonb, text, timestamptz) is
  'Webhook gateway (0100, v3 0105): idempoten per external_id. T2: pemanggil langsung (bukan payment_event_ingest) hanya untuk provider midtrans (diteruskan ke payment_event_ingest jalur midtrans: gross_amount wajib = amount, refund/chargeback → REFUNDED/DISPUTED) atau simulated (K1); finpay ditolak. K1: settlement provider simulated hanya bila payments_simulation_active(); order hanya bila antarpay_enabled() atau gateway_order_payment_enabled(). settlement → biaya PG provider transaksi + hold_until; purpose=order → paid + ledger_post(created); tidak bisa dibayar → payment_refund_auto. purpose=topup → wallet topup.';

-- ---------------------------------------------------------------------
-- 8. Intent idempoten, ingest event (mesin status §3), tanda rekonsiliasi — service_role
-- ---------------------------------------------------------------------
-- R4: rate_take (0040) memakai auth.uid() (kosong untuk service_role) → varian dengan pengguna eksplisit, tabel sama
create or replace function public.rate_take_user(p_user uuid, p_kind text, p_limit int)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_win timestamptz := date_trunc('hour', now()); v_n int;
begin
  if p_user is null then return true; end if;
  insert into lookup_rate (user_id, kind, window_start, n) values (p_user, p_kind, v_win, 1)
  on conflict (user_id, kind, window_start) do update set n = lookup_rate.n + 1
  returning n into v_n;
  return v_n <= p_limit;
end $$;
revoke all on function public.rate_take_user(uuid, text, int) from public, anon, authenticated;
create or replace function public.payment_intent_create(p_user uuid, p_purpose text, p_order uuid, p_amount bigint, p_channel text, p_provider text)
returns payments language plpgsql security definer set search_path = public as $$
declare o orders; p payments; v_prov text := lower(coalesce(nullif(trim(p_provider), ''), payment_provider_active()));
  v_ch text := lower(nullif(trim(coalesce(p_channel, '')), '')); v_exp timestamptz; v_timeout int; v_ref text; v_ext text;
  v_purpose text := lower(trim(coalesce(p_purpose, '')));
begin
  if p_user is null then raise exception 'p_user wajib diisi'; end if;
  if v_purpose not in ('order', 'topup') then raise exception 'purpose harus order|topup'; end if;
  if v_prov not in ('midtrans', 'finpay', 'simulated') then raise exception 'Provider tidak dikenal: %', v_prov; end if;
  if v_prov = 'simulated' and not payments_simulation_active() then
    raise exception 'Simulasi pembayaran nonaktif (payments_simulation_enabled=false atau env production)';
  end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Nominal tidak valid'; end if;
  if not exists (select 1 from profiles where id = p_user and is_active) then raise exception 'Akun tidak aktif'; end if;

  if v_purpose = 'order' then
    if p_order is null then raise exception 'order_id wajib untuk purpose=order'; end if;
    select * into o from orders where id = p_order for update;
    if not found or o.customer_id <> p_user then raise exception 'Pesanan tidak ditemukan'; end if;
    if o.status::text <> 'awaiting_payment' or o.payment_status <> 'unpaid' then
      raise exception 'Pesanan % tidak menunggu pembayaran (status %, bayar %)', o.code, o.status, o.payment_status;
    end if;
    v_timeout := greatest(1, setting_num('order_payment_timeout_min', 15)::int);
    v_exp := o.created_at + make_interval(mins => v_timeout);
    if v_exp <= now() then raise exception 'Batas waktu pembayaran pesanan % sudah lewat', o.code; end if;
    v_ch := coalesce(v_ch, o.pg_channel);
    if not (v_ch = any (payment_gateway_channel_keys())) then raise exception 'Saluran % bukan payment gateway', payment_channel_label(v_ch); end if;
    perform payment_channel_require_order(v_ch);
    if not payment_channel_provider_ok(v_ch, v_prov) then   -- (a)
      raise exception 'CHANNEL_UNSUPPORTED: saluran % tidak tersedia di %', payment_channel_label(v_ch), payment_provider_label(v_prov);
    end if;
    if p_amount <> o.total then
      raise exception 'Nominal % ≠ total pesanan % — panggil order_payment_prepare dulu (saluran %)', p_amount, o.total, v_ch;
    end if;
    -- idempoten: intent PENDING yang belum kedaluwarsa untuk nominal/saluran/provider yang sama dikembalikan apa adanya
    select * into p from payments where order_id = o.id and purpose = 'order' and pay_status = 'PENDING' for update;
    if found then
      if p.expires_at is not null and p.expires_at <= now() then
        update payments set pay_status = 'EXPIRED', note = 'kedaluwarsa saat intent baru dibuat' where id = p.id;
      elsif p.amount = p_amount and coalesce(p.pg_channel, p.method) = v_ch and p.provider = v_prov and p.env is not distinct from payment_provider_env() then
        return p;
      else
        perform payment_supersede(p.id, 'intent baru (saluran/nominal/provider berubah)');   -- (e)
      end if;
    end if;
    v_ref := o.payment_support_ref;
    if v_ref is null or exists (select 1 from payments where support_ref = v_ref) then v_ref := gen_support_ref(); end if;
  else
    perform antarpay_require_enabled();   -- top up = stored value: hanya bila AntarPay aktif (0088, PKS 7.4b)
    if v_ch is not null then
      perform payment_channel_require(v_ch);
      if v_ch = any (payment_gateway_channel_keys()) and not payment_channel_provider_ok(v_ch, v_prov) then   -- (a)
        raise exception 'CHANNEL_UNSUPPORTED: saluran % tidak tersedia di %', payment_channel_label(v_ch), payment_provider_label(v_prov);
      end if;
    end if;
    if p_amount < setting_num('pg_topup_min', 10000) or p_amount > setting_num('pg_topup_max', 10000000) then
      raise exception 'Nominal top up Rp% – Rp%', setting_num('pg_topup_min', 10000), setting_num('pg_topup_max', 10000000);
    end if;
    -- R4: idempoten — intent top up PENDING yang masih berlaku (nominal/saluran/provider/env sama) dikembalikan
    select * into p from payments
     where user_id = p_user and purpose = 'topup' and pay_status = 'PENDING' and amount = p_amount
       and coalesce(pg_channel, method) is not distinct from coalesce(v_ch, 'any') and provider = v_prov
       and env is not distinct from payment_provider_env() and (expires_at is null or expires_at > now())
     order by created_at desc limit 1 for update;
    if found then return p; end if;
    -- R4: batas laju intent top up per pengguna (service_role → rate_take_user, bukan auth.uid())
    if not rate_take_user(p_user, 'topup_intent', greatest(1, setting_num('rate_limit_topup_intent_per_hour', 10)::int)) then
      raise exception 'RATE_LIMIT: terlalu banyak permintaan top up dalam 1 jam. Coba lagi nanti.';
    end if;
    v_exp := now() + interval '30 minutes';
    v_ref := gen_support_ref();
  end if;
  v_ext := case v_purpose when 'order' then 'AKORD-' else 'AKPAY-' end || to_char(clock_timestamp() at time zone 'Asia/Jakarta', 'YYMMDDHH24MISS') || '-' || substr(md5(gen_random_uuid()::text), 1, 8);
  begin
    insert into payments (user_id, order_id, purpose, amount, method, provider, external_id, provider_ref, pg_channel, expires_at, support_ref, pay_status, env)
    values (p_user, o.id, v_purpose, p_amount, coalesce(v_ch, 'any'), v_prov, v_ext, v_ext, v_ch, v_exp, v_ref, 'PENDING', payment_provider_env())
    returning * into p;
  exception when unique_violation then   -- balapan dua permintaan untuk order yang sama → kembalikan yang menang
    select * into p from payments where order_id = o.id and purpose = 'order' and pay_status = 'PENDING';
    if found then return p; end if;
    raise;
  end;
  if v_purpose = 'order' then update orders set payment_support_ref = p.support_ref where id = o.id; end if;
  return p;
end $$;
revoke all on function public.payment_intent_create(uuid, text, uuid, bigint, text, text) from public, anon, authenticated;
grant execute on function public.payment_intent_create(uuid, text, uuid, bigint, text, text) to service_role;
comment on function public.payment_intent_create(uuid, text, uuid, bigint, text, text) is
  'Finpay v3 §2 (service_role, edge pay-create): buat intent pembayaran. Idempoten per order: intent PENDING yang belum kedaluwarsa dengan nominal/saluran/provider sama dikembalikan; yang berbeda digantikan (FAILED, superseded); unique partial index payments_one_pending_per_order. Order: milik p_user, awaiting_payment, payment_channel_require_order, nominal = orders.total (panggil order_payment_prepare dulu).';

drop function if exists public.payment_event_ingest(text, text, text, text, bigint, boolean, jsonb);   -- diganti versi + p_env
create or replace function public.payment_event_ingest(p_provider text, p_event_id text, p_external_id text, p_provider_status text,
  p_amount bigint, p_signature_ok boolean, p_raw jsonb, p_env text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p payments; v_ev_id bigint; v_prov text := lower(btrim(coalesce(p_provider, ''))); v_new text; v_prev text; v_note text;
  v_applied boolean := false; v_res text; v_st text; v_env text := nullif(lower(btrim(coalesce(p_env, ''))), ''); v_rf bigint; v_rf_txt text;
begin
  if v_prov = '' or btrim(coalesce(p_event_id, '')) = '' then raise exception 'provider & event_id wajib diisi'; end if;
  select * into p from payments where external_id = p_external_id or provider_ref = p_external_id
   order by (external_id = p_external_id) desc limit 1 for update;
  insert into payment_events (provider, event_id, external_id, payment_id, event_type, provider_status, amount, signature_ok, raw)
  values (v_prov, btrim(p_event_id), p_external_id, p.id, coalesce(p_raw->>'event_type', case when p_event_id like 'recon-%' then 'status_check' else 'notification' end),
          p_provider_status, p_amount, coalesce(p_signature_ok, false), p_raw)
  on conflict (provider, event_id) do nothing
  returning id into v_ev_id;
  if v_ev_id is null then   -- event yang sama dikirim ulang provider → tidak diproses dua kali
    return jsonb_build_object('duplicate', true, 'applied', false, 'pay_status', p.pay_status, 'note', 'duplicate_event');
  end if;
  v_prev := p.pay_status;
  v_new := payment_status_map(v_prov, p_provider_status, p_raw);
  -- S2: nominal refund HANYA dari field refund eksplisit (refund_amount), bukan p_amount (nominal transaksi)
  v_rf_txt := nullif(btrim(coalesce(p_raw->>'refund_amount', p_raw->>'refundAmount', '')), '');
  begin v_rf := round(v_rf_txt::numeric)::bigint; exception when others then v_rf := null; end;

  if not coalesce(p_signature_ok, false) then v_res := 'signature_invalid';
  elsif p.id is null then v_res := 'payment_not_found';
  elsif p.provider <> v_prov then v_res := 'provider_mismatch';
  elsif v_env is not null and v_env is distinct from p.env then v_res := 'env_mismatch';   -- T1: event sandbox ≠ transaksi production (dan sebaliknya)
  elsif v_prov = 'simulated' and not payments_simulation_active() then v_res := 'simulation_rejected';
  elsif v_new is null then v_res := 'unknown_status';
  elsif v_new = v_prev and not (v_new = 'PARTIALLY_REFUNDED' and coalesce(v_rf, 0) > p.refunded_amount) then v_res := 'no_change';
  elsif v_new = 'PENDING' then v_res := 'ignored_out_of_order';   -- terminal tidak boleh mundur ke PENDING
  elsif v_new = 'PAID' then
    if v_prev in ('PENDING', 'EXPIRED', 'FAILED') then
      if p_amount is null or p_amount <> p.amount then
        -- R3: nominal wajib ada & sama dengan payments.amount; selisih TIDAK diterapkan, ditandai unreconciled
        v_res := 'amount_mismatch';
        update payments set note = 'unreconciled: amount_mismatch (provider ' || coalesce(p_amount::text, 'tanpa nominal') || ' ≠ ' || p.amount || ')' where id = p.id;
        if not exists (select 1 from order_ledger l where l.source = 'payments' and l.source_id = p.id and l.entry = 'unreconciled') then
          insert into order_ledger (order_id, source, source_id, service, entry, amount, party_role, phase, pg_channel, note, payment_id)
          values (p.order_id, 'payments', p.id, (select service from orders where id = p.order_id), 'unreconciled', coalesce(p_amount, p.amount), 'gateway', 'adjusted',
                  p.pg_channel, 'event PAID ' || v_prov || ' nominal ' || coalesce(p_amount::text, 'kosong') || ' ≠ pembayaran ' || p.amount || ' (' || p.external_id || ', event ' || btrim(p_event_id) || ')', p.id);
        end if;
      else
        if v_prev in ('EXPIRED', 'FAILED') then v_note := 'late_paid'; end if;
        perform set_config('antarkita.payment_ingest', 'on', true);   -- T2: penanda pemanggil sah payment_settle
        -- error internal TIDAK ditelan: RAISE → baris payment_events ikut batal → provider mengirim ulang
        -- (status lama expire/failure → payment_settle memproses; idempoten hanya untuk 'settlement')
        perform payment_settle(p.external_id, 'settlement', coalesce(p_raw, '{}'::jsonb) || jsonb_build_object('_ingest', true, '_ingest_provider', v_prov, '_event_id', p_event_id), null, null);
        v_applied := true;
        perform set_config('antarkita.payment_ingest', 'off', true);
      end if;
    elsif v_prev = 'DISPUTED' then
      update payments set pay_status = 'PAID', note = 'sengketa ditutup provider (dana tetap)' where id = p.id; v_applied := true;
    else v_res := 'ignored_terminal';
    end if;
  elsif v_new in ('FAILED', 'EXPIRED') then
    if v_prev = 'PENDING' then
      perform set_config('antarkita.payment_ingest', 'on', true);
      perform payment_settle(p.external_id, case when v_new = 'EXPIRED' then 'expire' else 'failure' end, coalesce(p_raw, '{}'::jsonb) || jsonb_build_object('_ingest', true), null, null);
      v_applied := true;
      perform set_config('antarkita.payment_ingest', 'off', true);
    else v_res := 'ignored_terminal';
    end if;
  elsif v_new in ('REFUNDED', 'PARTIALLY_REFUNDED') then
    if v_prev in ('PAID', 'REFUND_REQUESTED', 'PARTIALLY_REFUNDED', 'DISPUTED') then
      if v_new = 'REFUNDED' then
        update payments set pay_status = v_new, refunded_amount = amount where id = p.id;
      elsif v_rf is not null and v_rf > 0 then
        update payments set pay_status = v_new, refunded_amount = least(amount, greatest(refunded_amount, v_rf)) where id = p.id;
      else
        update payments set pay_status = v_new, note = 'needs_review: refund sebagian tanpa refund_amount dari provider' where id = p.id;
        v_note := 'needs_review';
      end if;
      v_applied := true;
    else v_res := 'ignored_terminal';
    end if;
  elsif v_new = 'DISPUTED' then
    if v_prev in ('PAID', 'REFUND_REQUESTED', 'PARTIALLY_REFUNDED') then
      update payments set pay_status = 'DISPUTED', note = 'chargeback/sengketa dari provider' where id = p.id; v_applied := true;
    else v_res := 'ignored_terminal';
    end if;
  else v_res := 'unhandled';
  end if;

  if v_applied then
    v_st := payment_hook_after_ingest(p.id, v_prev, v_new, p_amount, p_raw);   -- 0108: tutup refund / buka sengketa
    if v_note is not null and v_note <> 'needs_review' then update payments set note = v_note where id = p.id; end if;
    v_res := coalesce(v_note, 'applied') || coalesce(' · ' || v_st, '');
  end if;
  update payment_events set processed_at = now(), result = v_res where id = v_ev_id;
  return jsonb_build_object('duplicate', false, 'applied', v_applied,
    'pay_status', (select pay_status from payments where id = p.id), 'previous', v_prev, 'mapped', v_new,
    'note', coalesce(v_note, v_res), 'event_id', v_ev_id, 'payment_id', p.id, 'support_ref', p.support_ref);
end $$;
revoke all on function public.payment_event_ingest(text, text, text, text, bigint, boolean, jsonb, text) from public, anon, authenticated;
grant execute on function public.payment_event_ingest(text, text, text, text, bigint, boolean, jsonb, text) to service_role;
comment on function public.payment_event_ingest(text, text, text, text, bigint, boolean, jsonb, text) is
  'Finpay v3 §2/§3 (service_role, edge pay-webhook/pay-reconcile): satu transaksi — inbox payment_events (duplikat event_id → duplicate=true, tidak diproses), kunci payment, mesin status (terminal tidak mundur ke PENDING; PAID sesudah EXPIRED/FAILED → diterapkan + note late_paid; order yang sudah tidak bisa dibayar → payment_refund_auto), payment_settle internal (ledger). Keputusan bisnis (duplicate, ignored_*, amount_mismatch, env_mismatch, signature_invalid, …) dicatat & dijawab normal; error INTERNAL saat memproses → RAISE (baris payment_events ikut batal, provider mengirim ulang). R3: PAID wajib p_amount = payments.amount (selisih → amount_mismatch, tidak diterapkan, baris ledger unreconciled). S2: refund sebagian hanya dari raw.refund_amount (tanpa itu → needs_review). p_env (opsional): ≠ payments.env → env_mismatch. Hasil: {duplicate, applied, pay_status, note}.';

create or replace function public.payment_mark_reconciled(p_payment uuid, p_run uuid)
returns payments language plpgsql security definer set search_path = public as $$
declare p payments;
begin
  update payments set reconciled_at = coalesce(reconciled_at, now()), reconcile_run_id = coalesce(p_run, reconcile_run_id)
   where id = p_payment and pay_status not in ('PENDING', 'FAILED', 'EXPIRED')
  returning * into p;
  if not found then raise exception 'Pembayaran % tidak ada atau belum dibayar', p_payment; end if;
  return p;
end $$;
revoke all on function public.payment_mark_reconciled(uuid, uuid) from public, anon, authenticated;
grant execute on function public.payment_mark_reconciled(uuid, uuid) to service_role;
comment on function public.payment_mark_reconciled(uuid, uuid) is 'Finpay v3 §2: tandai pembayaran cocok hasil rekonsiliasi (reconciled_at; pay_status TIDAK ditimpa — RECONCILED adalah penanda terpisah).';

-- ---------------------------------------------------------------------
-- 9. RPC pelanggan: order_payment_prepare v3, status, riwayat, struk
-- ---------------------------------------------------------------------
create or replace function public.order_payment_prepare(p_order uuid, p_channel text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare o orders; v_ch text; v_base bigint; v_fee bigint := 0; v_ppn bigint := 0; v_borne text; v_total bigint;
  v_timeout int := greatest(1, setting_num('order_payment_timeout_min', 15)::int); v_prov text := payment_provider_active();
begin
  if auth.uid() is null then raise exception 'Harus login'; end if;
  select * into o from orders where id = p_order for update;
  if not found or o.customer_id <> auth.uid() then raise exception 'Pesanan tidak ditemukan'; end if;
  if o.status::text <> 'awaiting_payment' or o.payment_status <> 'unpaid' then
    raise exception 'Pesanan % tidak menunggu pembayaran (status %, bayar %)', o.code, o.status, o.payment_status;
  end if;
  if o.created_at < now() - make_interval(mins => v_timeout) then raise exception 'Batas waktu pembayaran pesanan % sudah lewat', o.code; end if;
  v_ch := coalesce(nullif(lower(trim(coalesce(p_channel, ''))), ''), o.pg_channel);
  if not (v_ch = any (payment_gateway_channel_keys())) then raise exception 'Saluran % bukan payment gateway', payment_channel_label(v_ch); end if;
  perform payment_channel_require_order(v_ch);   -- 0104
  if not payment_channel_provider_ok(v_ch, v_prov) then   -- (a) kanal tidak didukung provider aktif (mis. GoPay di Finpay)
    raise exception 'CHANNEL_UNSUPPORTED: saluran % tidak tersedia di % — pilih metode lain', payment_channel_label(v_ch), payment_provider_label(v_prov);
  end if;
  -- dasar = total tanpa biaya pembayaran yang (mungkin) sudah ditagihkan; biaya dihitung ulang untuk saluran & provider final
  v_base := o.total - case when o.pg_fee_borne_by = 'customer' then o.pg_fee + o.pg_fee_ppn else 0 end;
  select f.fee, f.ppn into v_fee, v_ppn from pg_fee_calc(v_ch, v_base, v_prov) f;
  v_fee := coalesce(v_fee, 0); v_ppn := coalesce(v_ppn, 0);
  v_borne := case when v_fee + v_ppn > 0 then pg_fee_borne_by_for(o.service, v_ch, v_prov) else null end;   -- 0105 §0.5
  v_total := v_base + case when v_borne = 'customer' then v_fee + v_ppn else 0 end;
  if v_total is distinct from o.total or v_ch is distinct from o.pg_channel or v_fee is distinct from o.pg_fee
     or v_ppn is distinct from o.pg_fee_ppn or v_borne is distinct from o.pg_fee_borne_by then
    update orders set total = v_total, paid_via = v_ch, pg_channel = v_ch, pg_fee = v_fee, pg_fee_ppn = v_ppn, pg_fee_borne_by = v_borne
    where id = o.id returning * into o;
    perform ledger_post(o.id, 'created');
  end if;
  if o.payment_support_ref is null then
    update orders set payment_support_ref = gen_support_ref() where id = o.id returning * into o;
  end if;
  return jsonb_build_object('order_id', o.id, 'code', o.code, 'service', o.service, 'channel', v_ch, 'channel_label', payment_channel_label(v_ch),
    'provider', v_prov, 'provider_label', payment_provider_label(v_prov), 'env', payment_provider_env(),
    'gross', o.total, 'pg_fee', o.pg_fee, 'pg_fee_ppn', o.pg_fee_ppn, 'pg_fee_borne_by', o.pg_fee_borne_by,
    'customer_payment_fee', case when o.pg_fee_borne_by = 'customer' then o.pg_fee + o.pg_fee_ppn else 0 end,
    'pg_fee_customer', case when o.pg_fee_borne_by = 'customer' then o.pg_fee + o.pg_fee_ppn else 0 end,
    'pg_fee_label', 'Biaya metode pembayaran (' || payment_provider_label(v_prov) || ')',
    'support_ref', o.payment_support_ref,
    'expires_at', o.created_at + make_interval(mins => v_timeout), 'timeout_min', v_timeout);
end $$;
revoke all on function public.order_payment_prepare(uuid, text) from public, anon;
grant execute on function public.order_payment_prepare(uuid, text) to authenticated, service_role;
comment on function public.order_payment_prepare(uuid, text) is
  'Bayar per order (0100; v3 0105): validasi pemilik & awaiting_payment, (opsional) ganti saluran, biaya PG provider aktif; dibebankan ke pelanggan hanya bila pg_fee_borne_by_for = customer (§0.5). Mengembalikan gross, pg_fee_customer (0 bila ditanggung platform), provider, support_ref.';

-- create_order: siapa menanggung biaya PG mengikuti §0.5 (bukan lagi pg_fee_policy saja)
select _v3_splice('0105', 'public.create_order(jsonb)',
  $a$  if coalesce(se.pg_fee_policy, 'platform') = 'customer' then v_pg_cust := v_pg_fee + v_pg_ppn; end if;$a$,
  $a$  if pg_fee_borne_by_for(v_service, v_pg_ch) = 'customer' then v_pg_cust := v_pg_fee + v_pg_ppn; end if;   -- 0105 pg_fee_borne_by_for (§0.5)$a$,
  '0105 pg_fee_borne_by_for');
select _v3_splice('0105', 'public.create_order(jsonb)',
  $a$pg_fee_borne_by = case when v_pg_fee + v_pg_ppn > 0 then coalesce(se.pg_fee_policy, 'platform') else null end,$a$,
  $a$pg_fee_borne_by = case when v_pg_fee + v_pg_ppn > 0 then pg_fee_borne_by_for(v_service, v_pg_ch) else null end,$a$,
  'then pg_fee_borne_by_for(v_service, v_pg_ch) else null');
select _v3_splice('0105', 'public.ledger_simulate(service_type,bigint,bigint,bigint,text,text,integer)',
  $a$o.pg_fee_borne_by := coalesce(se.pg_fee_policy, 'platform');$a$,
  $a$o.pg_fee_borne_by := pg_fee_borne_by_for(p_service, v_ch);   -- 0105 §0.5$a$,
  '0105 §0.5');

create or replace function public.my_payment_status(p_order uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare o orders; p payments;
begin
  if auth.uid() is null then raise exception 'Harus login'; end if;
  select * into o from orders where id = p_order;
  if not found or o.customer_id <> auth.uid() then raise exception 'Pesanan tidak ditemukan'; end if;
  select * into p from payments where order_id = o.id and purpose = 'order'
   order by (pay_status = 'PENDING') desc, created_at desc limit 1;
  return jsonb_build_object('order_id', o.id, 'code', o.code, 'order_status', o.status, 'payment_status', o.payment_status,
    'pay_status', p.pay_status, 'provider', p.provider, 'provider_label', payment_provider_label(p.provider),
    'channel', coalesce(p.pg_channel, o.pg_channel), 'channel_label', payment_channel_label(coalesce(p.pg_channel, o.pg_channel)),
    'checkout_url', p.checkout_url, 'checkout_token', p.checkout_token, 'qr_string', p.qr_string, 'payment_code', p.payment_code,
    'expires_at', p.expires_at, 'paid_at', p.paid_at, 'amount', coalesce(p.amount, o.total),
    'support_ref', coalesce(p.support_ref, o.payment_support_ref), 'refunded_amount', coalesce(p.refunded_amount, 0),
    'external_id', p.external_id, 'late_paid', coalesce(p.note = 'late_paid', false));
end $$;
revoke all on function public.my_payment_status(uuid) from public, anon;
grant execute on function public.my_payment_status(uuid) to authenticated;

create or replace function public.my_payment_history(p_limit int default 50)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x.j order by x.created_at desc), '[]'::jsonb) from (
    select p.created_at, jsonb_build_object('id', p.id, 'purpose', p.purpose, 'order_id', p.order_id, 'order_code', o.code,
      'amount', p.amount, 'pay_status', p.pay_status, 'provider', p.provider, 'provider_label', payment_provider_label(p.provider),
      'channel', coalesce(p.pg_channel, p.method), 'channel_label', payment_channel_label(coalesce(p.pg_channel, p.method)),
      'support_ref', p.support_ref, 'refunded_amount', p.refunded_amount, 'created_at', p.created_at, 'paid_at', p.paid_at,
      'expires_at', p.expires_at) as j
    from payments p left join orders o on o.id = p.order_id
    where p.user_id = auth.uid()
    order by p.created_at desc limit least(200, greatest(1, coalesce(p_limit, 50)))) x;
$$;
revoke all on function public.my_payment_history(int) from public, anon;
grant execute on function public.my_payment_history(int) to authenticated;

-- teks komponen yang bisa/tidak bisa dikembalikan (0108 menggantinya dengan refund_policy_calc)
create or replace function public.receipt_refundable_note(o orders)
returns text language sql stable set search_path = public as $$
  select 'Biaya platform & ongkir dikembalikan bila pesanan batal sebelum driver mengambil pesanan. '
      || 'Harga barang tidak dikembalikan bila merchant sudah memproses. '
      || 'Biaya metode pembayaran yang dibebankan ke pelanggan tidak dikembalikan bila provider tidak mengembalikannya.';
$$;
revoke all on function public.receipt_refundable_note(orders) from public, anon, authenticated;

create or replace function public.my_receipt(p_order uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare o orders; p payments; v_prov text; v_pgc bigint; v_lines jsonb := '[]'::jsonb; v_tax bigint := 0;
begin
  if auth.uid() is null then raise exception 'Harus login'; end if;
  select * into o from orders where id = p_order;
  if not found or (o.customer_id <> auth.uid() and not coalesce(is_admin(), false)) then raise exception 'Pesanan tidak ditemukan'; end if;
  select * into p from payments where order_id = o.id and purpose = 'order' and pay_status not in ('PENDING', 'FAILED', 'EXPIRED')
   order by paid_at desc nulls last limit 1;
  if p.id is null then select * into p from payments where order_id = o.id and purpose = 'order' order by created_at desc limit 1; end if;
  v_prov := coalesce(p.provider, case when payment_channel_of(o.paid_via) = any (payment_gateway_channel_keys()) then payment_provider_active() end);
  v_pgc := case when o.pg_fee_borne_by = 'customer' then o.pg_fee + o.pg_fee_ppn else 0 end;
  -- §0.4: baris terpisah (yang nol tetap ditulis bila wajib tampil: barang/ongkir/biaya platform/total)
  v_lines := jsonb_build_array(
    jsonb_build_object('key', 'items', 'label', 'Harga barang', 'amount', coalesce(o.items_subtotal, 0)),
    jsonb_build_object('key', 'delivery', 'label', case when o.service in ('ride_motor','ride_car') then 'Tarif perjalanan' else 'Ongkir' end,
      'amount', coalesce(o.fare_delivery, 0) + coalesce(o.intercity_fare, 0)),
    jsonb_build_object('key', 'platform_fee', 'label', 'Biaya platform AntarKita', 'amount', coalesce(o.platform_fee, 0)));
  if coalesce(o.service_fee, 0) <> 0 then v_lines := v_lines || jsonb_build_object('key', 'service_fee', 'label', 'Biaya jasa belanja', 'amount', o.service_fee); end if;
  v_lines := v_lines || jsonb_build_object('key', 'payment_fee', 'label', 'Biaya metode pembayaran' || coalesce(' (' || payment_provider_label(v_prov) || ')', ''),
      'amount', v_pgc, 'borne_by', coalesce(o.pg_fee_borne_by, 'platform'),
      'note', case when coalesce(o.pg_fee_borne_by, 'platform') = 'platform' and o.pg_fee + o.pg_fee_ppn > 0 then 'Ditanggung AntarKita (Rp' || (o.pg_fee + o.pg_fee_ppn) || ')' end);
  if coalesce(o.extras_total, 0) <> 0 then v_lines := v_lines || jsonb_build_object('key', 'extras', 'label', 'Biaya tambahan (parkir/tol/dll)', 'amount', o.extras_total); end if;
  if coalesce(o.tip, 0) <> 0 then v_lines := v_lines || jsonb_build_object('key', 'tip', 'label', 'Tip driver', 'amount', o.tip); end if;
  if coalesce(o.discount, 0) <> 0 then v_lines := v_lines || jsonb_build_object('key', 'discount', 'label', 'Diskon' || coalesce(' ' || o.promo_code, ''),
      'amount', -o.discount, 'funded_by', coalesce(o.promo_funded_by, 'platform'),
      'note', 'Ditanggung ' || case coalesce(o.promo_funded_by, 'platform') when 'merchant' then 'merchant' when 'sponsor' then 'sponsor' else 'AntarKita' end); end if;
  -- (d) pajak dari buku besar (entry tax_output, fase aktif terakhir pesanan); 0 bila tidak ada
  select coalesce(sum(l.amount), 0) into v_tax from order_ledger l
   where l.order_id = o.id and l.source = 'orders' and l.entry::text = 'tax_output'
     and l.phase = coalesce((select l2.phase from order_ledger l2 where l2.order_id = o.id and l2.source = 'orders' and l2.phase in ('completed', 'created')
                              order by case l2.phase when 'completed' then 0 else 1 end limit 1), 'created');
  v_tax := abs(coalesce(v_tax, 0));
  v_lines := v_lines || jsonb_build_object('key', 'tax', 'label', 'Pajak', 'amount', v_tax,
    'note', case when v_tax = 0 then 'Tidak ada pajak terpisah pada transaksi ini' else 'PPN/pajak tercatat di buku besar (tax_output)' end);
  return jsonb_build_object('order_id', o.id, 'code', o.code, 'service', o.service, 'status', o.status, 'created_at', o.created_at, 'completed_at', o.completed_at,
    'payment_method', o.payment_method, 'channel', coalesce(p.pg_channel, payment_channel_of(o.paid_via)),
    'channel_label', payment_channel_label(coalesce(p.pg_channel, payment_channel_of(o.paid_via))),
    'provider', v_prov, 'provider_label', payment_provider_label(v_prov),
    'lines', v_lines, 'total', o.total, 'total_paid', o.total + coalesce(o.tip, 0),
    'payment_status', o.payment_status, 'pay_status', p.pay_status, 'paid_at', p.paid_at,
    'support_ref', coalesce(p.support_ref, o.payment_support_ref), 'refunded_amount', coalesce(p.refunded_amount, 0),
    'refundable_note', receipt_refundable_note(o));
end $$;
revoke all on function public.my_receipt(uuid) from public, anon;
grant execute on function public.my_receipt(uuid) to authenticated;
comment on function public.my_receipt(uuid) is 'Finpay v3 §2/§0.4: struk lengkap — harga barang, ongkir, biaya platform, biaya metode pembayaran (provider), biaya tambahan, tip, diskon (+ penanggung), pajak, total, support_ref, refundable_note.';

-- ---------------------------------------------------------------------
-- 10. admin_set_settings / admin_business_settings v3
-- ---------------------------------------------------------------------
-- T3: spesifikasi SEMUA kunci app_settings yang boleh diubah lewat admin_set_settings. Kunci di luar daftar
-- ditolak. Tipe: int | numeric | bool | text (opsi) | string (teks bebas tervalidasi) | json (validator per kunci).
-- = business_setting_specs (v2, 11 ambang) ∪ business_setting_specs_v3 ∪ kunci umum (otomasi, peta, belanja, dst.).
create or replace function public.app_setting_specs()
returns table(key text, value_type text, min_value numeric, max_value numeric, options text[], default_value jsonb,
  unit text, label text, note text, perm text)
language sql stable set search_path = public as $$
  select s.key, case when s.is_int then 'int' else 'numeric' end, s.min_value, s.max_value, null::text[], to_jsonb(s.default_value),
         s.unit, s.label, s.note, 'payment_config' from business_setting_specs() s
  union all
  select v.key, v.value_type, v.min_value, v.max_value, v.options, v.default_value, v.unit, v.label, v.note, v.perm from business_setting_specs_v3() v
  union all
  select ('max_km_' || e::text), 'numeric', 0.5, 5000, null::text[], null::jsonb, 'km', 'UMUM', 'Batas jarak dalam kota layanan ' || e::text, 'pricing'
    from unnest(enum_range(null::service_type)) e
  union all
  select g.* from (values
    ('admin_session_minutes',      'int',     5::numeric, 720::numeric, null::text[], '60'::jsonb, 'menit', 'KEAMANAN', 'Durasi sesi PIN panel admin', 'admin_role'),
    ('bank_account',               'json',    null, null, null, null, '', 'UANG', 'Rekening tujuan top up manual {bank, name, number}', 'payment_config'),
    ('app_name',                   'string',  1, 60, null, null, '', 'UMUM', 'Nama aplikasi', 'payment_config'),
    ('support_phone',              'string',  6, 20, null, null, '', 'UMUM', 'Nomor CS (+62…)', 'ticket'),
    ('pg_provider',                'text',    null, null, array['midtrans','finpay'], '"midtrans"', '', 'UANG', 'Provider gateway v2 (lama) — v3 memakai payment_provider_active', 'payment_config'),
    ('pg_topup_min',               'int',     1000, 10000000, null, '10000', 'Rp', 'UANG', 'Nominal top up minimum', 'payment_config'),
    ('pg_topup_max',               'int',     10000, 100000000, null, '10000000', 'Rp', 'UANG', 'Nominal top up maksimum', 'payment_config'),
    ('gateway_fee_pct',            'numeric', 0, 10, null, null, '%', 'UANG', 'Asumsi biaya gateway (laporan)', 'fee'),
    ('target_take_rate_pct',       'numeric', 0, 100, null, null, '%', 'UANG', 'Target take rate', 'fee'),
    ('helper_fee',                 'int',     0, 10000000, null, null, 'Rp', 'UANG', 'Biaya helper angkut', 'pricing'),
    ('market_driver_share_pct',    'numeric', 0, 100, null, null, '%', 'UANG', 'Porsi driver jasa belanja pasar', 'pricing'),
    ('market_service_min',         'int',     0, 10000000, null, null, 'Rp', 'UANG', 'Biaya jasa belanja pasar minimum', 'pricing'),
    ('market_service_pct',         'numeric', 0, 100, null, null, '%', 'UANG', 'Biaya jasa belanja pasar', 'pricing'),
    ('shop_driver_share_pct',      'numeric', 0, 100, null, null, '%', 'UANG', 'Porsi driver jasa belanja toko', 'pricing'),
    ('shop_service_min',           'int',     0, 10000000, null, null, 'Rp', 'UANG', 'Biaya jasa belanja toko minimum', 'pricing'),
    ('shop_service_pct',           'numeric', 0, 100, null, null, '%', 'UANG', 'Biaya jasa belanja toko', 'pricing'),
    ('shop_budget_buffer_pct',     'numeric', 0, 100, null, null, '%', 'UANG', 'Cadangan anggaran belanja', 'pricing'),
    ('shop_budget_coef',           'numeric', 1, 5, null, null, '×', 'UANG', 'Koefisien batas total belanja', 'pricing'),
    ('shop_car_factor',            'numeric', 1, 5, null, null, '×', 'UANG', 'Faktor ongkir belanja mobil', 'pricing'),
    ('shop_car_min_budget',        'int',     0, 100000000, null, null, 'Rp', 'UANG', 'Anggaran minimum belanja mobil', 'pricing'),
    ('travel_cancel_free_hours',   'int',     0, 168, null, null, 'jam', 'UANG', 'Batal travel gratis sebelum N jam', 'pricing'),
    ('travel_commission_pct',      'numeric', 0, 100, null, null, '%', 'UANG', 'Komisi travel', 'pricing'),
    ('travel_daily_hours',         'int',     1, 24, null, null, 'jam', 'UMUM', 'Jam operasional travel harian', 'pricing'),
    ('travel_platform_fee',        'int',     0, 10000000, null, null, 'Rp', 'UANG', 'Biaya platform travel', 'pricing'),
    ('travel_request_commission_pct','numeric',0, 100, null, null, '%', 'UANG', 'Komisi permintaan travel', 'pricing'),
    ('travel_send_partner_pct',    'numeric', 0, 100, null, null, '%', 'UANG', 'Porsi mitra kirim antarkota', 'pricing'),
    ('intercity_partner_share_pct','numeric', 0, 100, null, null, '%', 'UANG', 'Porsi mitra antarkota', 'pricing'),
    ('retention_budget_month',     'int',     0, 1000000000, null, null, 'Rp', 'UANG', 'Anggaran promo retensi per bulan', 'promo'),
    ('retention_promo_max',        'int',     0, 10000000, null, null, 'Rp', 'UANG', 'Maks diskon promo retensi', 'promo'),
    ('retention_promo_value',      'numeric', 0, 100, null, null, '%', 'UANG', 'Diskon promo retensi', 'promo'),
    ('retention_cooldown_days',    'int',     1, 365, null, null, 'hari', 'OTOMASI', 'Jeda antar promo retensi', 'promo'),
    ('retention_days',             'int',     1, 365, null, null, 'hari', 'OTOMASI', 'Tidak aktif selama N hari → promo retensi', 'promo'),
    ('retention_enabled',          'bool',    null, null, null, null, '', 'OTOMASI', 'Promo retensi otomatis', 'promo'),
    ('dynamic_pricing_enabled',    'bool',    null, null, null, null, '', 'OTOMASI', 'Harga dinamis', 'pricing'),
    ('dynamic_max_multiplier',     'numeric', 1, 5, null, null, '×', 'OTOMASI', 'Pengganda maksimum', 'pricing'),
    ('dynamic_step',               'numeric', 0, 2, null, null, '×', 'OTOMASI', 'Langkah kenaikan', 'pricing'),
    ('dynamic_radius_km',          'numeric', 0.5, 100, null, null, 'km', 'OTOMASI', 'Radius harga dinamis', 'pricing'),
    ('dynamic_window_min',         'int',     1, 1440, null, null, 'menit', 'OTOMASI', 'Jendela waktu harga dinamis', 'pricing'),
    ('price_coef_min',             'numeric', 0.1, 1, null, null, '×', 'OTOMASI', 'Koef. harga minimum', 'pricing'),
    ('price_coef_max',             'numeric', 1, 10, null, null, '×', 'OTOMASI', 'Koef. harga maksimum', 'pricing'),
    ('price_coef_hard',            'numeric', 1, 10, null, null, '×', 'OTOMASI', 'Koef. tolak (batas keras)', 'pricing'),
    ('auto_verify_enabled',        'bool',    null, null, null, null, '', 'OTOMASI', 'Verifikasi mitra otomatis', 'driver'),
    ('auto_verify_min_score',      'int',     0, 100, null, null, 'skor', 'OTOMASI', 'Skor minimum verifikasi otomatis', 'driver'),
    ('probation_days',             'int',     0, 365, null, null, 'hari', 'OTOMASI', 'Masa percobaan mitra', 'driver'),
    ('probation_daily_orders',     'int',     0, 1000, null, null, 'order', 'OTOMASI', 'Batas order/hari saat percobaan', 'driver'),
    ('driver_selfie_hours',        'int',     1, 168, null, null, 'jam', 'OTOMASI', 'Selfie ulang driver tiap N jam', 'driver'),
    ('driver_code_lookup_per_hour','int',     1, 10000, null, null, 'per jam', 'KEAMANAN', 'Batas cari kode driver per jam', 'driver'),
    ('class_fallback_minutes',     'int',     0, 60, null, null, 'menit', 'OTOMASI', 'Fallback kelas kendaraan', 'orders'),
    ('direct_order_fallback',      'bool',    null, null, null, null, '', 'OTOMASI', 'Order langsung jatuh ke umum bila tidak diterima', 'orders'),
    ('direct_order_hold_seconds',  'int',     0, 3600, null, null, 'detik', 'OTOMASI', 'Tahan order langsung', 'orders'),
    ('schedule_release_min',       'int',     1, 1440, null, null, 'menit', 'OTOMASI', 'Order terjadwal dilepas N menit sebelumnya', 'orders'),
    ('wait_apology_minutes',       'int',     0, 120, null, null, 'menit', 'OTOMASI', 'Pesan maaf bila menunggu lebih dari N menit', 'orders'),
    ('search_radius_km',           'numeric', 0.5, 100, null, null, 'km', 'UMUM', 'Radius pencarian', 'orders'),
    ('max_route_ratio',            'numeric', 1, 10, null, null, '×', 'UMUM', 'Rasio rute maksimum', 'orders'),
    ('fraud_auto_suspend',         'bool',    null, null, null, null, '', 'KEAMANAN', 'Tangguhkan otomatis bila fraud', 'driver'),
    ('fraud_cancel_limit',         'int',     1, 1000, null, null, 'per 24 jam', 'KEAMANAN', 'Pembatalan driver per 24 jam', 'driver'),
    ('fraud_gps_speed_kmh',        'int',     10, 2000, null, null, 'km/jam', 'KEAMANAN', 'Lompatan GPS ditandai di atas', 'driver'),
    ('customer_withdrawal_enabled','bool',    null, null, null, null, '', 'UANG', 'Penarikan saldo oleh pelanggan', 'payment_config'),
    ('reports_enabled',            'bool',    null, null, null, null, '', 'OTOMASI', 'Laporan terjadwal', 'report'),
    ('ticket_per_hour',            'int',     1, 1000, null, null, 'per jam', 'KEAMANAN', 'Batas tiket per jam', 'ticket'),
    ('estimate_per_hour',          'int',     1, 100000, null, null, 'per jam', 'KEAMANAN', 'Batas estimasi tarif per jam', 'orders'),
    ('resolve_per_hour',           'int',     1, 100000, null, null, 'per jam', 'KEAMANAN', 'Batas resolve alamat per jam', 'orders'),
    ('place_auto_approve_reports', 'int',     1, 100, null, null, 'laporan', 'OTOMASI', 'Laporan untuk aktif otomatis', 'city'),
    ('place_dedup_radius_m',       'int',     1, 5000, null, null, 'meter', 'OTOMASI', 'Radius dedup usulan tempat', 'city'),
    ('vendor_quality_min',         'int',     0, 100, null, null, 'skor', 'OTOMASI', 'Skor kualitas minimum pedagang', 'merchant'),
    ('osm_auto_refresh_enabled',   'bool',    null, null, null, null, '', 'PETA', 'Penyegaran impor peta otomatis', 'city'),
    ('osm_auto_refresh_days',      'int',     1, 365, null, null, 'hari', 'PETA', 'Interval penyegaran impor peta', 'city'),
    ('osm_city_assign_max_km',     'numeric', 1, 500, null, null, 'km', 'PETA', 'Jarak maks penetapan kota', 'city'),
    ('osm_import_enabled',         'bool',    null, null, null, null, '', 'PETA', 'Impor tempat dari peta', 'city'),
    ('osm_import_max_per_task',    'int',     50, 3000, null, null, 'tempat', 'PETA', 'Maks tempat per tugas impor', 'city'),
    ('osm_import_pause_ms',        'int',     0, 60000, null, null, 'ms', 'PETA', 'Jeda antar permintaan impor', 'city'),
    ('osm_import_radius_km',       'numeric', 0.5, 100, null, null, 'km', 'PETA', 'Radius impor tempat', 'city'),
    ('pickup_radius_km',           'json',    null, null, null, null, 'km', 'UMUM', 'Radius terima order per layanan {layanan: km}', 'orders'),
    ('priority_tiers',             'json',    null, null, null, null, '', 'UMUM', 'Antrean prioritas driver [{min_rating, delay_s}]', 'orders'),
    ('send_limits',                'json',    null, null, null, null, '', 'UMUM', 'Batas berat/ukuran kirim {kendaraan: {max_kg, max_cm}}', 'orders'),
    ('pin_services',               'json',    null, null, null, null, '', 'UMUM', 'Layanan yang wajib PIN serah terima', 'orders'),
    ('same_city_services',         'json',    null, null, null, null, '', 'UMUM', 'Layanan dalam kota', 'orders')
  ) as g(key, value_type, min_value, max_value, options, default_value, unit, label, note, perm)
  where not exists (select 1 from business_setting_specs() b where b.key = g.key)
    and not exists (select 1 from business_setting_specs_v3() b where b.key = g.key);
$$;
revoke all on function public.app_setting_specs() from public, anon, authenticated;

-- T3: validasi & normalisasi nilai kunci JSON (raise bila salah)
create or replace function public.setting_json_validate(p_key text, v jsonb)
returns jsonb language plpgsql immutable set search_path = public as $$
declare k text; x jsonb; n numeric; e text;
begin
  if p_key = 'bank_account' then
    if jsonb_typeof(v) <> 'object' then raise exception 'bank_account harus objek {bank, name, number}'; end if;
    for k, x in select * from jsonb_each(v) loop
      if k not in ('bank', 'name', 'number', 'branch', 'note') then raise exception 'bank_account: kolom tidak dikenal %', k; end if;
      if jsonb_typeof(x) <> 'string' or length(x #>> '{}') > 100 then raise exception 'bank_account.% harus teks ≤ 100 karakter', k; end if;
    end loop;
    if coalesce(btrim(v->>'bank'), '') = '' or coalesce(btrim(v->>'name'), '') = '' or coalesce(v->>'number', '') !~ '^[0-9][0-9 .-]{4,29}$' then
      raise exception 'bank_account wajib berisi bank, name, dan number (angka 5–30 digit)';
    end if;
    return v;
  elsif p_key = 'pickup_radius_km' then
    if jsonb_typeof(v) <> 'object' then raise exception 'pickup_radius_km harus objek {layanan: km}'; end if;
    for k, x in select * from jsonb_each(v) loop
      if k !~ '^[a-z_]{2,30}$' or jsonb_typeof(x) <> 'number' then raise exception 'pickup_radius_km.% harus angka', k; end if;
      n := (x #>> '{}')::numeric; if n < 0.1 or n > 500 then raise exception 'pickup_radius_km.% harus 0,1–500 km', k; end if;
    end loop;
    return v;
  elsif p_key = 'priority_tiers' then
    if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) not between 1 and 10 then raise exception 'priority_tiers harus larik 1–10 tingkat'; end if;
    for x in select * from jsonb_array_elements(v) loop
      if jsonb_typeof(x) <> 'object' or (select count(*) from jsonb_object_keys(x) kk where kk not in ('min_rating', 'delay_s')) > 0
         or jsonb_typeof(x->'min_rating') <> 'number' or jsonb_typeof(x->'delay_s') <> 'number'
         or (x->>'min_rating')::numeric not between 0 and 5 or (x->>'delay_s')::numeric not between 0 and 3600 then
        raise exception 'priority_tiers: tiap tingkat {min_rating 0–5, delay_s 0–3600}';
      end if;
    end loop;
    return v;
  elsif p_key = 'send_limits' then
    if jsonb_typeof(v) <> 'object' then raise exception 'send_limits harus objek {kendaraan: {max_kg, max_cm}}'; end if;
    for k, x in select * from jsonb_each(v) loop
      if k !~ '^[a-z_]{2,30}$' or jsonb_typeof(x) <> 'object' or (select count(*) from jsonb_object_keys(x) kk where kk not in ('max_kg', 'max_cm')) > 0
         or jsonb_typeof(x->'max_kg') <> 'number' or jsonb_typeof(x->'max_cm') <> 'number'
         or (x->>'max_kg')::numeric not between 0 and 100000 or (x->>'max_cm')::numeric not between 0 and 10000 then
        raise exception 'send_limits.% harus {max_kg 0–100000, max_cm 0–10000}', k;
      end if;
    end loop;
    return v;
  elsif p_key in ('pin_services', 'same_city_services') then
    if jsonb_typeof(v) <> 'array' then raise exception '% harus larik kode layanan', p_key; end if;
    for x in select * from jsonb_array_elements(v) loop
      e := x #>> '{}';
      if jsonb_typeof(x) <> 'string' or not (e = any (enum_range(null::service_type)::text[])) then raise exception '%: layanan tidak dikenal %', p_key, coalesce(e, x::text); end if;
    end loop;
    return v;
  end if;
  raise exception 'Kunci JSON % tidak punya validator', p_key;
end $$;
revoke all on function public.setting_json_validate(text, jsonb) from public, anon, authenticated;

create or replace function public.admin_set_settings(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  k text; v jsonb; s record; n numeric; t text; biz jsonb := '{}'::jsonb; val jsonb := '{}'::jsonb; before jsonb := '{}'::jsonb;
  before_all jsonb := '{}'::jsonb; v_bad text; ringkas text;
  -- 0104 ambang bisnis: sakelar yang punya RPC khusus (PIN + audit sendiri) tidak boleh lewat jalur umum
  protected constant text[] := array['antarpay_enabled', 'payment_channels', 'pg_methods', 'gateway_order_payment_enabled', 'pg_last_webhook_at', 'services_enabled'];
begin
  -- T3: SEMUA kunci = izin payment_config + PIN; kunci di luar app_setting_specs() ditolak
  perform admin_require('payment_config');
  perform admin_require_unlock();
  if p is null or jsonb_typeof(p) <> 'object' or p = '{}'::jsonb then raise exception 'Pengaturan harus objek JSON {kunci: nilai}'; end if;
  -- validasi SEMUA kunci dulu (tidak ada yang ditulis bila satu saja tidak valid)
  for k, v in select * from jsonb_each(p) loop
    if k !~ '^[a-z_0-9]+$' then raise exception 'Kunci tidak valid: %', k; end if;
    if k = any (protected) then raise exception 'Pengaturan % diubah lewat menunya sendiri (PIN + audit), bukan lewat pengaturan umum', k; end if;
    select * into s from app_setting_specs() x where x.key = k;
    if s.key is null then raise exception 'SETTING_UNKNOWN: kunci pengaturan % tidak dikenal (tidak ada di app_setting_specs)', k; end if;
    perform admin_require(s.perm);
    if s.value_type in ('int', 'numeric') then
      if jsonb_typeof(v) = 'number' then n := (v #>> '{}')::numeric;
      elsif jsonb_typeof(v) = 'string' and btrim(v #>> '{}') ~ '^-?[0-9]+(\.[0-9]+)?$' then n := btrim(v #>> '{}')::numeric;
      else raise exception 'Nilai % harus angka', k; end if;
      if s.value_type = 'int' and n <> trunc(n) then raise exception 'Nilai % harus bilangan bulat', k; end if;
      if (s.min_value is not null and n < s.min_value) or (s.max_value is not null and n > s.max_value) then
        raise exception 'Nilai % harus % s.d. % %', k, s.min_value, s.max_value, coalesce(s.unit, '');
      end if;
      val := val || jsonb_build_object(k, n);
    elsif s.value_type = 'bool' then
      if jsonb_typeof(v) = 'boolean' then val := val || jsonb_build_object(k, v);
      elsif lower(coalesce(v #>> '{}', '')) in ('true', 'false') then val := val || jsonb_build_object(k, lower(v #>> '{}')::boolean);
      else raise exception 'Nilai % harus true|false', k; end if;
    elsif s.value_type = 'text' then
      t := lower(btrim(coalesce(v #>> '{}', '')));
      if jsonb_typeof(v) <> 'string' or not (t = any (s.options)) then raise exception 'Nilai % harus salah satu dari: %', k, array_to_string(s.options, ' | '); end if;
      val := val || jsonb_build_object(k, t);
    elsif s.value_type = 'string' then
      t := btrim(coalesce(v #>> '{}', ''));
      if jsonb_typeof(v) <> 'string' or length(t) < coalesce(s.min_value, 0) or length(t) > coalesce(s.max_value, 200) then
        raise exception 'Nilai % harus teks % s.d. % karakter', k, coalesce(s.min_value, 0), coalesce(s.max_value, 200);
      end if;
      if k = 'support_phone' and t !~ '^\+?[0-9][0-9 -]{5,19}$' then raise exception 'support_phone harus nomor telepon (+62…)'; end if;
      val := val || jsonb_build_object(k, t);
    elsif s.value_type = 'json' then
      val := val || jsonb_build_object(k, setting_json_validate(k, v));
    else
      raise exception 'Tipe pengaturan % tidak dikenal (%)', k, s.value_type;
    end if;
    -- ambang bisnis v2/v3 (audit settings.business_updated seperti 0104)
    if exists (select 1 from business_setting_specs() b where b.key = k) or exists (select 1 from business_setting_specs_v3() b where b.key = k) then
      biz := biz || jsonb_build_object(k, val -> k);
    end if;
  end loop;

  if biz ? 'commission_cap_two_wheel' then
    select string_agg(format('%s %s%%', e.service, e.driver_commission_pct), ', ') into v_bad
      from service_economics e where e.service::text = any (two_wheel_services()) and e.driver_commission_pct > (biz->>'commission_cap_two_wheel')::numeric;
    if v_bad is null then
      select string_agg(format('pricing.%s %s%%', pr.service, pr.commission_pct), ', ') into v_bad
        from pricing pr where pr.service::text = any (two_wheel_services()) and pr.commission_pct > (biz->>'commission_cap_two_wheel')::numeric;
    end if;
    if v_bad is not null then
      raise exception 'Batas komisi roda dua % %% lebih rendah dari komisi yang berlaku (%). Turunkan komisinya dulu di Aturan Bisnis.', biz->>'commission_cap_two_wheel', v_bad;
    end if;
  end if;
  select coalesce(jsonb_object_agg(b.key, a.value), '{}'::jsonb) into before_all
    from jsonb_object_keys(val) b(key) left join app_settings a on a.key = b.key;
  select coalesce(jsonb_object_agg(b.key, before_all -> b.key), '{}'::jsonb) into before from jsonb_object_keys(biz) b(key);

  for k, v in select * from jsonb_each(val) loop   -- disimpan dalam bentuk JSON bertipe (angka/boolean/teks/objek)
    insert into app_settings (key, value) values (k, v) on conflict (key) do update set value = excluded.value, updated_at = now();
  end loop;
  perform log_activity('settings.update', 'app_settings', 'batch', 'Pengaturan diubah: ' || (select string_agg(key, ', ') from jsonb_object_keys(val) key),
    jsonb_build_object('before', before_all, 'after', val));
  if biz <> '{}'::jsonb then
    select string_agg(format('%s: %s → %s', b.key, coalesce(before ->> b.key, '-'), biz ->> b.key), ', ') into ringkas from jsonb_object_keys(biz) b(key);
    perform log_activity('settings.business_updated', 'app_settings', 'business', 'Ambang bisnis diubah: ' || ringkas,
      jsonb_build_object('before', before, 'after', biz));
    if biz ? 'payment_provider_active' or biz ? 'payment_provider_env' or biz ? 'payments_simulation_enabled' then
      perform log_activity('payment.provider_switched', 'app_settings', 'payment_provider',
        'Provider pembayaran: ' || payment_provider_active() || ' (' || payment_provider_env() || '), simulasi ' || case when payments_simulation_active() then 'AKTIF' else 'mati' end,
        jsonb_build_object('before', before, 'after', biz));
    end if;
  end if;
end $$;
revoke all on function public.admin_set_settings(jsonb) from public, anon;
grant execute on function public.admin_set_settings(jsonb) to authenticated;
comment on function public.admin_set_settings(jsonb) is
  'Pengaturan app_settings (0019). v3 T3: SEMUA kunci wajib izin payment_config + PIN (admin_require_unlock) + izin per kunci; kunci di luar app_setting_specs() (ambang v2 + v3 + kunci umum: rekening, share %, sesi admin, batas top up, otomasi, peta, JSON radius/tier/batas kirim) DITOLAK. Tipe divalidasi, atomik, audit settings.update (+ settings.business_updated / payment.provider_switched).';

create or replace function public.admin_business_settings()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Hanya admin'; end if;
  return jsonb_build_object(
    'settings', (select jsonb_agg(jsonb_build_object('key', s.key, 'value', coalesce((a.value #>> '{}')::numeric, s.default_value), 'default', s.default_value,
        'min', s.min_value, 'max', s.max_value, 'integer', s.is_int, 'unit', s.unit, 'label', s.label, 'note', s.note, 'stored', a.key is not null) order by s.key)
      from business_setting_specs() s left join app_settings a on a.key = s.key),
    'settings_v3', (select jsonb_agg(jsonb_build_object('key', s.key, 'type', s.value_type, 'value', coalesce(a.value, s.default_value), 'default', s.default_value,
        'min', s.min_value, 'max', s.max_value, 'options', to_jsonb(s.options), 'unit', s.unit, 'label', s.label, 'note', s.note, 'perm', s.perm,
        'can_edit', admin_has(s.perm), 'stored', a.key is not null) order by s.key)
      from business_setting_specs_v3() s left join app_settings a on a.key = s.key),
    'requires_pin', true,
    'payment_provider', jsonb_build_object('active', payment_provider_active(), 'env', payment_provider_env(), 'simulation', payments_simulation_active()),
    'gateway_order_payment_enabled', gateway_order_payment_enabled(),
    'antarpay_enabled', antarpay_enabled());
end $$;
revoke all on function public.admin_business_settings() from public, anon;
grant execute on function public.admin_business_settings() to authenticated;

-- ---------------------------------------------------------------------
-- 11. Penjaga migrasi
-- ---------------------------------------------------------------------
do $$
declare f bigint; pp bigint; n int; j jsonb; def text;
begin
  -- pg_fee_calc: satu fungsi, 2 argumen lama jalan, provider & effective_from dipilih benar
  if (select count(*) from pg_proc where proname = 'pg_fee_calc' and pronamespace = 'public'::regnamespace) <> 1 then
    raise exception '0105 batal: pg_fee_calc harus tepat satu fungsi';
  end if;
  select x.fee, x.ppn into f, pp from pg_fee_calc('qris', 100000, 'midtrans') x;
  if f <> 700 or pp <> 0 then raise exception '0105 batal: pg_fee_calc(qris, midtrans) = %/% (harus 700/0)', f, pp; end if;
  select x.fee, x.ppn into f, pp from pg_fee_calc('bank_transfer', 100000, 'finpay') x;
  if f <> 3500 or pp <> 385 then raise exception '0105 batal: pg_fee_calc(bank_transfer, finpay) = %/% (harus 3.500/385)', f, pp; end if;
  select x.fee into f from pg_fee_calc('qris', 50000, 'finpay', '2026-09-30'::timestamptz) x;
  if f <> 350 then raise exception '0105 batal: QRIS Finpay 30 Sep 2026 (Rp50.000) = % (harus 350)', f; end if;
  select x.fee into f from pg_fee_calc('qris', 50000, 'finpay', '2026-10-02 10:00+07'::timestamptz) x;
  if f <> 0 then raise exception '0105 batal: QRIS Finpay ≥ 1 Okt 2026 ≤ Rp100.000 = % (harus 0)', f; end if;
  if payment_provider_active() = 'midtrans' then
    select x.fee into f from pg_fee_calc('qris', 100000) x;
    if f <> 700 then raise exception '0105 batal: pg_fee_calc 2 argumen (provider aktif midtrans) = %', f; end if;
  end if;
  -- QRIS dikunci
  begin
    update payment_channel_fees set pass_to_customer = true where channel = 'qris' and provider = 'finpay';
    raise exception '0105 batal: QRIS pass_to_customer tidak terkunci';
  exception when check_violation then null; end;
  -- gateway_secrets & payments
  if (select string_agg(a.attname, ',' order by a.attnum) from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
      where c.conrelid = 'public.gateway_secrets'::regclass and c.contype = 'p') <> 'provider,env' then
    raise exception '0105 batal: PK gateway_secrets bukan (provider, env)';
  end if;
  if exists (select 1 from payments where pay_status is null or support_ref is null) then raise exception '0105 batal: payments lama belum punya pay_status/support_ref'; end if;
  if exists (select 1 from payments where payment_status_to_legacy(pay_status) <> status and not (status in ('cancel','deny') and pay_status = 'FAILED')) then
    raise exception '0105 batal: status ↔ pay_status tidak sinkron pada baris lama';
  end if;
  if to_regclass('public.payments_one_pending_per_order') is null then raise exception '0105 batal: unique index intent PENDING belum ada'; end if;
  -- hak akses
  if has_function_privilege('authenticated', 'public.payment_intent_create(uuid,text,uuid,bigint,text,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.payment_event_ingest(text,text,text,text,bigint,boolean,jsonb,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.payment_mark_reconciled(uuid,uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.payment_settle(text,text,jsonb,text,timestamp with time zone)', 'EXECUTE')
     or has_function_privilege('anon', 'public.payment_settle(text,text,jsonb,text,timestamp with time zone)', 'EXECUTE') then
    raise exception '0105 batal: RPC service_role terbuka untuk klien';
  end if;
  if not has_function_privilege('anon', 'public.payment_provider_public()', 'EXECUTE') then raise exception '0105 batal: payment_provider_public harus anon'; end if;
  if has_function_privilege('anon', 'public.my_receipt(uuid)', 'EXECUTE') or has_function_privilege('anon', 'public.admin_set_gateway_secret(text,text,jsonb)', 'EXECUTE') then
    raise exception '0105 batal: RPC pelanggan/admin terbuka untuk anon';
  end if;
  if has_table_privilege('authenticated', 'public.payment_events', 'INSERT') or has_table_privilege('authenticated', 'public.payment_events', 'UPDATE')
     or has_table_privilege('anon', 'public.payment_events', 'SELECT') or has_table_privilege('authenticated', 'public.gateway_secrets', 'SELECT') then
    raise exception '0105 batal: payment_events/gateway_secrets terbuka untuk klien';
  end if;
  -- K1 terpasang
  def := pg_get_functiondef('public.payment_settle(text,text,jsonb,text,timestamp with time zone)'::regprocedure);
  if position('payments_simulation_active()' in def) = 0 or position('gateway_order_payment_enabled()' in def) = 0 or position('''payment_id'', p.id' in def) = 0 then
    raise exception '0105 batal: payment_settle belum memuat pagar K1';
  end if;
  if (select count(*) from pg_proc where proname = 'payment_settle' and pronamespace = 'public'::regnamespace) <> 1 then raise exception '0105 batal: payment_settle harus satu fungsi'; end if;
  if position('0105 pg_fee_borne_by_for' in (select pg_get_functiondef(oid) from pg_proc where proname = 'create_order' and pronamespace = 'public'::regnamespace limit 1)) = 0 then
    raise exception '0105 batal: create_order belum ditambal';
  end if;
  j := payment_provider_public();
  if not (j ? 'provider' and j ? 'env' and j ? 'simulation' and jsonb_typeof(j->'channels') = 'array') then raise exception '0105 batal: payment_provider_public tidak lengkap: %', j; end if;
  if payment_status_map('finpay', 'CAPTURED', null) <> 'PAID' or payment_status_map('finpay', 'CANCELLED', null) <> 'FAILED'
     or payment_status_map('midtrans', 'settlement', null) <> 'PAID' or payment_status_map('midtrans', 'chargeback', null) <> 'DISPUTED'
     or payment_status_map('midtrans', 'capture', '{"fraud_status":"challenge"}') <> 'PENDING' then
    raise exception '0105 batal: pemetaan status provider salah';
  end if;
  select count(*) into n from payment_channel_fees where provider = 'finpay';
  if n < 15 then raise exception '0105 batal: seed Finpay baru % baris', n; end if;
  raise notice '0105 ok: provider %/% (simulasi %), % baris tarif Finpay, payments kanonik + inbox payment_events, K1 terpasang',
    payment_provider_active(), payment_provider_env(), payments_simulation_active(), n;
end $$;
