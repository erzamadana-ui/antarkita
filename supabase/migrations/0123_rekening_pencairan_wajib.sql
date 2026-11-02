-- =====================================================================
-- 0123 — Rekening pencairan mitra WAJIB + auto-sweep saldo ke rekening + titik sambung provider disbursement
--   Keputusan GM 31 Okt 2026 (docs/KONTRAK-31OKT.md keputusan 3 & 4):
--   • Tabel `bank_accounts` lama (0019; 1 baris per user: bank_name, account_no, holder, verified) sudah memuat inti
--     "rekening tersimpan" dan dipakai request_withdrawal / admin_review_withdrawal / admin_set_bank_verified / Panel Admin
--     Keuangan. KEPUTUSAN: DIPERLUAS, bukan dibuat tabel baru — kolom id, channel ('bank'|'dana'|'ovo'|'linkaja'|'gopay'|
--     'shopeepay'), bank_code (→ bank_codes), auto_sweep, created_at. Nama kontrak `partner_payout_accounts` disediakan
--     sebagai VIEW (security_invoker) di atas bank_accounts dengan alias holder → account_name.
--   • bank_codes ditambah kode bank virtual e-wallet (DANA/OVO/LINKAJA/GOPAY/SHOPEEPAY) [ASUMSI: cocokkan template BCA];
--     pencocokan alias di admin_payout_batch_export_bca memilih alias TERPANJANG (Danamon ≠ DANA).
--   • RPC mitra: partner_payout_account_set(jsonb), partner_payout_account_mine(), merchant_set_open(boolean).
--   • Penjaga PAYOUT_ACCOUNT_REQUIRED (setelan payout_account_required, default true): driver_set_online(true), register_driver
--     (langkah akhir = payload memuat dokumen id_card_number/license_number/photo_id_url atau final=true; payload boleh menyertakan
--     `payout_account` yang disimpan lebih dulu), travel_partner_register (idem), merchant buka toko (trigger guard_merchant_update
--     saat is_open false→true oleh pemilik; admin/bypass bebas).
--   • request_withdrawal: argumen bank/rekening/nama kosong → memakai rekening tersimpan.
--   • payout_auto_sweep(date,text): dipanggil payout_batch_auto() di tiap cutoff (splice) — mitra (driver/merchant/mitra travel
--     approved) dengan rekening tersimpan, auto_sweep aktif, tanpa penarikan yang belum masuk batch, tanpa fraud_flag med/high, dan
--     saldo − cadangan ≥ payout_min_amount → withdrawal_requests source 'auto_sweep' (approved otomatis bila rekening
--     terverifikasi & ≤ auto_payout_max; selain itu pending untuk admin). Cadangan driver = payout_sweep_driver_reserve
--     (default = driver_min_balance_accept) [ASUMSI].
--   • Provider: setelan payout_provider ('manual'|'api', default manual); tabel payout_provider_jobs; payout_provider_enqueue(batch)
--     dipanggil payout_batch_auto saat batch dibuat (hanya bila 'api'); payout_provider_dispatch() (cron */5) POST ke Edge
--     pay-disburse pola pay_reconcile_dispatch (0111). Hanya wiring — tidak diaktifkan.
--   • Admin: admin_partner_payout_accounts(text), admin_partner_payout_verify(uuid,boolean,text), admin_payout_provider_jobs(text).
-- Idempoten. Tambalan lewat _v3_splice pada BARIS KODE (produksi tanpa komentar di body). Rollback: supabase/rollback/0123_down.sql
-- =====================================================================
do $$
declare s text;
begin
  foreach s in array array[
    -- diubah
    'public.driver_set_online(boolean,double precision,double precision)', 'public.register_driver(jsonb)', 'public.travel_partner_register(jsonb)',
    'public.guard_merchant_update()', 'public.request_withdrawal(bigint,text,text,text)', 'public.payout_batch_auto(timestamptz)',
    'public.admin_payout_batch_export_bca(uuid)', 'public.app_setting_specs()',
    -- baru
    'public.payout_account_require(uuid)', 'public.payout_account_upsert_internal(uuid,jsonb)', 'public.partner_payout_account_set(jsonb)',
    'public.partner_payout_account_mine()', 'public.merchant_set_open(boolean)', 'public.payout_auto_sweep(date,text)',
    'public.payout_provider_enqueue(uuid)', 'public.payout_provider_dispatch()', 'public.admin_partner_payout_accounts(text)',
    'public.admin_partner_payout_verify(uuid,boolean,text)', 'public.admin_payout_provider_jobs(text)'] loop
    perform _mig_backup('0123', s);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 1. Setelan
-- ---------------------------------------------------------------------
insert into app_settings (key, value) values
  ('payout_account_required', 'true'::jsonb),
  ('payout_auto_sweep_enabled', 'true'::jsonb),
  ('payout_sweep_driver_reserve', to_jsonb(greatest(0, setting_num('driver_min_balance_accept', 0))::bigint)),
  ('payout_provider', '"manual"'::jsonb)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 2. bank_codes: e-wallet sebagai kode bank virtual
-- ---------------------------------------------------------------------
insert into public.bank_codes (code, name, bank_code, aliases) values
  ('dana',      'DANA',      'DANA',      array['dana']),
  ('ovo',       'OVO',       'OVO',       array['ovo']),
  ('linkaja',   'LinkAja',   'LINKAJA',   array['linkaja', 'link aja']),
  ('gopay',     'GoPay',     'GOPAY',     array['gopay', 'go pay']),
  ('shopeepay', 'ShopeePay', 'SHOPEEPAY', array['shopeepay', 'shopee pay'])
on conflict (code) do update set name = excluded.name, bank_code = excluded.bank_code, aliases = excluded.aliases;

-- ---------------------------------------------------------------------
-- 3. bank_accounts diperluas + view partner_payout_accounts
-- ---------------------------------------------------------------------
alter table public.bank_accounts
  add column if not exists id         uuid not null default gen_random_uuid(),
  add column if not exists channel    text not null default 'bank',
  add column if not exists bank_code  text,
  add column if not exists auto_sweep boolean not null default true,
  add column if not exists created_at timestamptz not null default now();
create unique index if not exists bank_accounts_id_ux on public.bank_accounts (id);
alter table public.bank_accounts drop constraint if exists bank_accounts_channel_check;
alter table public.bank_accounts add constraint bank_accounts_channel_check check (channel in ('bank', 'dana', 'ovo', 'linkaja', 'gopay', 'shopeepay'));
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'bank_accounts_bank_code_fkey') then
    alter table public.bank_accounts add constraint bank_accounts_bank_code_fkey foreign key (bank_code) references public.bank_codes(code);
  end if;
end $$;
-- isi bank_code baris lama dari alias (alias terpanjang menang)
update public.bank_accounts ba set bank_code =
  (select k.code from bank_codes k where exists (select 1 from unnest(k.aliases) al where ba.bank_name ilike '%' || al || '%')
    order by (select max(length(al)) from unnest(k.aliases) al where ba.bank_name ilike '%' || al || '%') desc limit 1)
 where ba.bank_code is null;
comment on table public.bank_accounts is '0019/0123: rekening pencairan mitra (1 per user). 0123: channel bank|e-wallet, bank_code → bank_codes, auto_sweep. Ditulis lewat partner_payout_account_set / request_withdrawal / admin_review_withdrawal.';
revoke all on public.bank_accounts from public, anon;
grant select on public.bank_accounts to authenticated;
grant all on public.bank_accounts to service_role;

create or replace view public.partner_payout_accounts with (security_invoker = true) as
  select id, user_id, channel, bank_code, bank_name, account_no, holder as account_name, verified, verified_by, verified_at, auto_sweep, created_at, updated_at
    from public.bank_accounts;
comment on view public.partner_payout_accounts is '0123: nama kontrak untuk bank_accounts (alias holder → account_name); RLS tabel dasar berlaku (security_invoker).';
revoke all on public.partner_payout_accounts from public, anon;
grant select on public.partner_payout_accounts to authenticated;
grant select on public.partner_payout_accounts to service_role;

-- withdrawal_requests.source: 'request' (mitra menekan tarik) | 'auto_sweep'
alter table public.withdrawal_requests add column if not exists source text not null default 'request';
alter table public.withdrawal_requests drop constraint if exists withdrawal_requests_source_check;
alter table public.withdrawal_requests add constraint withdrawal_requests_source_check check (source in ('request', 'auto_sweep'));

-- ---------------------------------------------------------------------
-- 4. Penjaga & upsert internal
-- ---------------------------------------------------------------------
create or replace function public.payout_account_require(p_user uuid)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not coalesce((select lower(value #>> '{}') = 'true' from app_settings where key = 'payout_account_required'), true) then return; end if;
  if not exists (select 1 from bank_accounts where user_id = p_user) then
    raise exception 'PAYOUT_ACCOUNT_REQUIRED: rekening pencairan (bank/e-wallet) wajib diisi dulu di menu Saldo › Rekening pencairan.';
  end if;
end $$;
revoke all on function public.payout_account_require(uuid) from public, anon;
grant execute on function public.payout_account_require(uuid) to authenticated;

create or replace function public.payout_account_upsert_internal(p_user uuid, p jsonb)
returns bank_accounts language plpgsql security definer set search_path = public as $$
declare v_channel text := lower(coalesce(nullif(btrim(p->>'channel'), ''), 'bank')); v_code text := lower(nullif(btrim(p->>'bank_code'), ''));
        v_no text := regexp_replace(coalesce(p->>'account_no', ''), '[^0-9]', '', 'g'); v_name text := btrim(coalesce(p->>'account_name', p->>'holder', ''));
        v_bank text; k bank_codes; ba bank_accounts; v_auto boolean := coalesce((p->>'auto_sweep')::boolean, true);
begin
  if p_user is null then raise exception 'Harus login'; end if;
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'Data rekening harus objek JSON'; end if;
  if v_channel not in ('bank', 'dana', 'ovo', 'linkaja', 'gopay', 'shopeepay') then raise exception 'Saluran pencairan tidak dikenal: %', v_channel; end if;
  if length(v_name) < 3 then raise exception 'Nama pemilik rekening minimal 3 huruf'; end if;
  if v_channel = 'bank' then
    if v_code is null then raise exception 'Kode bank wajib diisi (lihat bank_codes)'; end if;
    select * into k from bank_codes where code = v_code and code not in ('dana', 'ovo', 'linkaja', 'gopay', 'shopeepay');
    if not found then raise exception 'Kode bank tidak dikenal: %', v_code; end if;
    if length(v_no) < 6 or length(v_no) > 20 then raise exception 'Nomor rekening harus 6–20 digit'; end if;
    v_bank := coalesce(nullif(btrim(p->>'bank_name'), ''), k.name);
  else
    v_code := v_channel;
    select * into k from bank_codes where code = v_code;
    if not found then raise exception 'Kode e-wallet % belum terdaftar di bank_codes', v_code; end if;
    if v_no !~ '^08[0-9]{7,13}$' then raise exception 'Nomor e-wallet harus nomor HP 08xx (9–15 digit)'; end if;
    v_bank := k.name;
  end if;
  insert into bank_accounts (user_id, bank_name, account_no, holder, channel, bank_code, auto_sweep)
  values (p_user, v_bank, v_no, v_name, v_channel, v_code, v_auto)
  on conflict (user_id) do update set
    verified = case when bank_accounts.account_no = excluded.account_no and bank_accounts.bank_code is not distinct from excluded.bank_code
                         and bank_accounts.channel = excluded.channel then bank_accounts.verified else false end,
    bank_name = excluded.bank_name, account_no = excluded.account_no, holder = excluded.holder, channel = excluded.channel,
    bank_code = excluded.bank_code, auto_sweep = excluded.auto_sweep, updated_at = now()
  returning * into ba;
  perform log_activity('payout_account.set', 'bank_accounts', ba.id::text,
    'Rekening pencairan disimpan: ' || ba.bank_name || ' ' || ba.account_no || ' a.n. ' || ba.holder,
    jsonb_build_object('user_id', p_user, 'channel', ba.channel, 'bank_code', ba.bank_code, 'verified', ba.verified, 'auto_sweep', ba.auto_sweep));
  return ba;
end $$;
revoke all on function public.payout_account_upsert_internal(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.payout_account_upsert_internal(uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------
-- 5. RPC mitra
-- ---------------------------------------------------------------------
create or replace function public.partner_payout_account_mine()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare ba bank_accounts; v_req boolean := coalesce((select lower(value #>> '{}') = 'true' from app_settings where key = 'payout_account_required'), true);
begin
  if auth.uid() is null then raise exception 'Harus login'; end if;
  select * into ba from bank_accounts where user_id = auth.uid();
  if not found then
    return jsonb_build_object('exists', false, 'required', v_req, 'channels', jsonb_build_array('bank', 'dana', 'ovo', 'linkaja', 'gopay', 'shopeepay'),
      'banks', coalesce((select jsonb_agg(jsonb_build_object('code', k.code, 'name', k.name) order by k.name) from bank_codes k where k.code not in ('dana', 'ovo', 'linkaja', 'gopay', 'shopeepay')), '[]'::jsonb),
      'min_sweep', greatest(20000, setting_num('payout_min_amount', 50000))::bigint,
      'sweep_enabled', coalesce((select lower(value #>> '{}') = 'true' from app_settings where key = 'payout_auto_sweep_enabled'), true));
  end if;
  return jsonb_build_object('exists', true, 'required', v_req, 'id', ba.id, 'channel', ba.channel, 'bank_code', ba.bank_code, 'bank_name', ba.bank_name,
    'account_no', ba.account_no, 'account_no_masked', repeat('•', greatest(0, length(ba.account_no) - 4)) || right(ba.account_no, 4),
    'account_name', ba.holder, 'verified', ba.verified, 'verified_at', ba.verified_at, 'auto_sweep', ba.auto_sweep,
    'min_sweep', greatest(20000, setting_num('payout_min_amount', 50000))::bigint,
    'sweep_enabled', coalesce((select lower(value #>> '{}') = 'true' from app_settings where key = 'payout_auto_sweep_enabled'), true),
    'created_at', ba.created_at, 'updated_at', ba.updated_at);
end $$;
revoke all on function public.partner_payout_account_mine() from public, anon;
grant execute on function public.partner_payout_account_mine() to authenticated;

create or replace function public.partner_payout_account_set(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_role text;
begin
  if auth.uid() is null then raise exception 'Harus login'; end if;
  select role::text into v_role from profiles where id = auth.uid();
  if not (v_role = any (withdrawal_allowed_roles()) or exists (select 1 from drivers where id = auth.uid())
          or exists (select 1 from merchants where owner_id = auth.uid()) or exists (select 1 from travel_partners where id = auth.uid())) then
    raise exception 'Rekening pencairan hanya untuk mitra (driver, merchant, mitra travel).';
  end if;
  if not rate_take('payout_account_set', 20) then raise exception 'RATE_LIMIT: terlalu sering mengubah rekening. Coba lagi nanti.'; end if;
  perform payout_account_upsert_internal(auth.uid(), p);
  return partner_payout_account_mine();
end $$;
revoke all on function public.partner_payout_account_set(jsonb) from public, anon;
grant execute on function public.partner_payout_account_set(jsonb) to authenticated;

create or replace function public.merchant_set_open(p_open boolean)
returns merchants language plpgsql security definer set search_path = public as $$
declare m merchants;
begin
  select * into m from merchants where owner_id = auth.uid() order by created_at limit 1;
  if not found then raise exception 'Belum terdaftar sebagai merchant'; end if;
  if p_open then
    if m.status <> 'approved' then raise exception 'Toko belum disetujui admin'; end if;
    perform payout_account_require(m.owner_id);
  end if;
  update merchants set is_open = p_open where id = m.id returning * into m;
  return m;
end $$;
revoke all on function public.merchant_set_open(boolean) from public, anon;
grant execute on function public.merchant_set_open(boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Auto-sweep saldo mitra → withdrawal_requests (source auto_sweep)
-- ---------------------------------------------------------------------
create or replace function public.payout_auto_sweep(p_date date default null, p_cutoff text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_on boolean := coalesce((select lower(value #>> '{}') = 'true' from app_settings where key = 'payout_auto_sweep_enabled'), true);
        v_min bigint := greatest(20000, setting_num('payout_min_amount', 50000))::bigint;
        v_max bigint := setting_num('auto_payout_max', 1000000)::bigint;
        v_res bigint := greatest(0, setting_num('payout_sweep_driver_reserve', setting_num('driver_min_balance_accept', 0)))::bigint;
        v_auto_on boolean := coalesce((select lower(value #>> '{}') = 'true' from app_settings where key = 'auto_payout_enabled'), true);
        v_sla int := greatest(1, setting_num('payout_sla_hours', 24)::int);
        v_label text := coalesce('sesi ' || p_cutoff || ' ' || to_char(coalesce(p_date, (now() at time zone 'Asia/Jakarta')::date), 'DD-MM-YYYY'), 'otomatis');
        rec record; w withdrawal_requests; v_amt bigint; v_auto boolean; n int := 0; n_pend int := 0; v_total bigint := 0; v_out jsonb := '[]'::jsonb;
begin
  if not v_on then return jsonb_build_object('enabled', false, 'swept', 0, 'total', 0); end if;
  perform pg_advisory_xact_lock(hashtext('payout_auto_sweep'));
  for rec in
    select ba.*, wl.balance, pr.full_name,
           exists (select 1 from drivers d where d.id = ba.user_id and d.status = 'approved') as is_driver,
           exists (select 1 from merchants m where m.owner_id = ba.user_id and m.status = 'approved') as is_merchant,
           exists (select 1 from travel_partners t where t.id = ba.user_id and t.status = 'approved') as is_travel
      from bank_accounts ba
      join wallets wl on wl.user_id = ba.user_id
      join profiles pr on pr.id = ba.user_id
     where ba.auto_sweep and coalesce(pr.is_active, true) and pr.role::text in ('driver', 'merchant')
       and wl.balance >= v_min
       and not exists (select 1 from withdrawal_requests x where x.user_id = ba.user_id and x.settled_at is null and x.batch_id is null and x.status in ('pending', 'approved'))
       and not exists (select 1 from fraud_flags f where f.subject_id = ba.user_id and f.status = 'open' and f.severity in ('med', 'high'))
     order by wl.balance desc
  loop
    continue when not (rec.is_driver or rec.is_merchant or rec.is_travel);
    v_amt := rec.balance - case when rec.is_driver then v_res else 0 end;
    continue when v_amt < v_min;
    perform 1 from wallets where user_id = rec.user_id for update;
    select balance into v_amt from wallets where user_id = rec.user_id;
    v_amt := v_amt - case when rec.is_driver then v_res else 0 end;
    continue when v_amt < v_min;
    v_auto := v_auto_on and rec.verified and v_amt <= v_max;
    perform wallet_apply(rec.user_id, 'withdrawal', -v_amt, null, 'Pencairan otomatis ' || v_label || ' ke ' || rec.bank_name || ' ' || rec.account_no);
    insert into withdrawal_requests (user_id, amount, bank_name, bank_account, account_name, sla_due_at, source, status, auto, reviewed_at, review_note)
    values (rec.user_id, v_amt, rec.bank_name, rec.account_no, rec.holder, now() + make_interval(hours => v_sla), 'auto_sweep',
            case when v_auto then 'approved'::topup_status else 'pending'::topup_status end, v_auto,
            case when v_auto then now() end,
            case when v_auto then 'Pencairan otomatis ' || v_label || ' (rekening terverifikasi)'
                 else 'Pencairan otomatis ' || v_label || ' — menunggu verifikasi admin' || case when not rec.verified then ' (rekening belum terverifikasi)' else ' (di atas batas otomatis)' end end)
    returning * into w;
    insert into notifications (user_id, kind, title, body, data) values (rec.user_id, 'system',
      case when v_auto then 'Saldo dicairkan otomatis' else 'Pencairan otomatis menunggu admin' end,
      'Rp' || replace(to_char(v_amt, 'FM999,999,999,999'), ',', '.') || ' ke ' || rec.bank_name || ' ' || rec.account_no || ' (' || v_label || ').',
      jsonb_build_object('withdrawal_id', w.id, 'kind', 'auto_sweep'));
    perform log_activity('withdrawal.auto_sweep', 'withdrawal_requests', w.id::text, '[auto-sweep] Rp' || v_amt || ' ' || v_label || ' → ' || w.status,
      jsonb_build_object('amount', v_amt, 'user_id', rec.user_id, 'status', w.status, 'reserve', case when rec.is_driver then v_res else 0 end));
    n := n + 1; v_total := v_total + v_amt; if not v_auto then n_pend := n_pend + 1; end if;
    v_out := v_out || jsonb_build_object('withdrawal_id', w.id, 'user_id', rec.user_id, 'amount', v_amt, 'status', w.status);
  end loop;
  return jsonb_build_object('enabled', true, 'swept', n, 'pending_review', n_pend, 'total', v_total, 'min', v_min, 'driver_reserve', v_res, 'items', v_out);
end $$;
revoke all on function public.payout_auto_sweep(date, text) from public, anon, authenticated;
grant execute on function public.payout_auto_sweep(date, text) to service_role;

-- ---------------------------------------------------------------------
-- 7. Provider disbursement (titik sambung, tidak aktif)
-- ---------------------------------------------------------------------
create table if not exists public.payout_provider_jobs (
  id          uuid primary key default gen_random_uuid(),
  batch_id    uuid not null references public.payout_batches(id),
  provider    text not null,
  status      text not null default 'queued' check (status in ('queued', 'sent', 'done', 'failed')),
  request     jsonb not null default '{}'::jsonb,
  response    jsonb,
  error       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists payout_provider_jobs_status_idx on public.payout_provider_jobs (status, created_at);
comment on table public.payout_provider_jobs is '0123: antrean kirim batch pencairan ke provider disbursement (edge pay-disburse) saat payout_provider = api. Wiring saja.';
alter table public.payout_provider_jobs enable row level security;
drop policy if exists payout_provider_jobs_admin on public.payout_provider_jobs;
create policy payout_provider_jobs_admin on public.payout_provider_jobs for select to authenticated using (admin_has('payments_view'));
revoke all on public.payout_provider_jobs from public, anon, authenticated;
grant select on public.payout_provider_jobs to authenticated;
grant all on public.payout_provider_jobs to service_role;

create or replace function public.payout_provider_enqueue(p_batch uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_prov text := lower(coalesce((select value #>> '{}' from app_settings where key = 'payout_provider'), 'manual')); j payout_provider_jobs;
begin
  if v_prov <> 'api' or p_batch is null then return null; end if;
  if exists (select 1 from payout_provider_jobs where batch_id = p_batch and status in ('queued', 'sent', 'done')) then
    return (select id from payout_provider_jobs where batch_id = p_batch and status in ('queued', 'sent', 'done') order by created_at desc limit 1);
  end if;
  insert into payout_provider_jobs (batch_id, provider, request)
  values (p_batch, coalesce(nullif(lower((select value #>> '{}' from app_settings where key = 'disbursement_provider')), 'manual'), 'finpay'),
          jsonb_build_object('batch_id', p_batch, 'items', coalesce((select jsonb_agg(jsonb_build_object('withdrawal_id', w.id, 'amount', w.amount,
            'bank_name', w.bank_name, 'account_no', w.bank_account, 'account_name', w.account_name,
            'bank_code', (select k.bank_code from bank_codes k where exists (select 1 from unnest(k.aliases) al where w.bank_name ilike '%' || al || '%')
                           order by (select max(length(al)) from unnest(k.aliases) al where w.bank_name ilike '%' || al || '%') desc limit 1)))
            from withdrawal_requests w where w.batch_id = p_batch and w.status = 'approved' and w.settled_at is null), '[]'::jsonb)))
  returning * into j;
  perform log_activity('payout.provider_enqueue', 'payout_provider_jobs', j.id::text, 'Batch pencairan diantrekan ke provider ' || j.provider, jsonb_build_object('batch_id', p_batch));
  return j.id;
end $$;
revoke all on function public.payout_provider_enqueue(uuid) from public, anon, authenticated;
grant execute on function public.payout_provider_enqueue(uuid) to service_role;

create or replace function public.payout_provider_dispatch()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_prov text := lower(coalesce((select value #>> '{}' from app_settings where key = 'payout_provider'), 'manual'));
        v_base text; v_url text; v_secret text; v_req bigint; j payout_provider_jobs; n int := 0;
begin
  if v_prov <> 'api' then return jsonb_build_object('skipped', true, 'reason', 'payout_provider = ' || v_prov); end if;
  select coalesce((select function_url from push_config where id), (select function_url from osm_import_config where id)) into v_base;
  if v_base is not null and v_base ~ '/functions/v1/' then v_url := regexp_replace(v_base, '/functions/v1/.*$', '/functions/v1/pay-disburse'); end if;
  select g.extra->>'cron_secret' into v_secret from gateway_secrets g where coalesce(g.extra->>'cron_secret', '') <> ''
   order by (g.provider = payment_provider_active()) desc, (g.env = payment_provider_env()) desc limit 1;
  if v_url is null or v_secret is null then
    return jsonb_build_object('skipped', true, 'reason', case when v_url is null then 'URL Edge Function belum diatur (push_config/osm_import_config)' else 'gateway_secrets.extra.cron_secret belum diisi' end);
  end if;
  if to_regnamespace('net') is null then return jsonb_build_object('skipped', true, 'reason', 'ekstensi pg_net belum aktif'); end if;
  for j in select * from payout_provider_jobs where status = 'queued' order by created_at limit 5 loop
    select net.http_post(url := v_url, headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
      body := jsonb_build_object('job_id', j.id, 'batch_id', j.batch_id, 'provider', j.provider), timeout_milliseconds := 120000) into v_req;
    update payout_provider_jobs set status = 'sent', response = jsonb_build_object('request_id', v_req, 'sent_at', now()), updated_at = now() where id = j.id;
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'url', v_url, 'sent', n);
end $$;
revoke all on function public.payout_provider_dispatch() from public, anon, authenticated;
grant execute on function public.payout_provider_dispatch() to service_role;

do $$
begin
  if to_regnamespace('cron') is not null then
    perform cron.schedule('antarkita_payout_provider_dispatch', '*/5 * * * *', 'select public.payout_provider_dispatch()');
  end if;
exception when others then raise notice '0123: cron antarkita_payout_provider_dispatch tidak dijadwalkan (%)', sqlerrm;
end $$;

-- ---------------------------------------------------------------------
-- 8. Admin
-- ---------------------------------------------------------------------
create or replace function public.admin_partner_payout_accounts(p_q text default null)
returns setof jsonb language plpgsql stable security definer set search_path = public as $$
declare q text := nullif(btrim(coalesce(p_q, '')), '');
begin
  perform admin_require('payments_view');
  return query
    select jsonb_build_object('id', ba.id, 'user_id', ba.user_id, 'full_name', pr.full_name, 'phone', pr.phone, 'role', pr.role,
      'partner_type', case when exists (select 1 from drivers d where d.id = ba.user_id) then 'driver'
                           when exists (select 1 from merchants m where m.owner_id = ba.user_id) then 'merchant'
                           when exists (select 1 from travel_partners t where t.id = ba.user_id) then 'travel' else 'lainnya' end,
      'channel', ba.channel, 'bank_code', ba.bank_code, 'bank_name', ba.bank_name, 'account_no', ba.account_no, 'account_name', ba.holder,
      'verified', ba.verified, 'verified_by', ba.verified_by, 'verified_at', ba.verified_at, 'auto_sweep', ba.auto_sweep,
      'balance', coalesce(wl.balance, 0),
      'open_withdrawals', (select count(*) from withdrawal_requests w where w.user_id = ba.user_id and w.settled_at is null and w.status in ('pending', 'approved')),
      'created_at', ba.created_at, 'updated_at', ba.updated_at)
      from bank_accounts ba join profiles pr on pr.id = ba.user_id left join wallets wl on wl.user_id = ba.user_id
     where q is null or pr.full_name ilike '%' || q || '%' or ba.account_no like '%' || q || '%' or ba.holder ilike '%' || q || '%' or ba.bank_name ilike '%' || q || '%'
     order by ba.verified, ba.updated_at desc;
end $$;
revoke all on function public.admin_partner_payout_accounts(text) from public, anon;
grant execute on function public.admin_partner_payout_accounts(text) to authenticated;

create or replace function public.admin_partner_payout_verify(p_id uuid, p_ok boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ba bank_accounts;
begin
  perform admin_require('payout');
  perform admin_require_unlock();
  select * into ba from bank_accounts where id = p_id for update;
  if not found then raise exception 'Rekening tidak ditemukan'; end if;
  update bank_accounts set verified = p_ok, verified_by = auth.uid(), verified_at = now(), updated_at = now() where id = p_id returning * into ba;
  perform log_activity('bank.verified', 'bank_accounts', ba.user_id::text,
    'Rekening ' || ba.bank_name || ' ' || ba.account_no || case when p_ok then ' diverifikasi' else ' dicabut verifikasinya' end || coalesce(' · ' || p_note, ''),
    jsonb_build_object('verified', p_ok, 'note', p_note, 'account_id', ba.id));
  insert into security_events (kind, user_id, detail) values ('payout.account_verify', ba.user_id, jsonb_build_object('account_id', ba.id, 'verified', p_ok, 'by', auth.uid()));
  insert into notifications (user_id, kind, title, body, data) values (ba.user_id, 'system',
    case when p_ok then 'Rekening pencairan terverifikasi' else 'Rekening pencairan perlu diperiksa' end,
    case when p_ok then ba.bank_name || ' ' || ba.account_no || ' a.n. ' || ba.holder || ' sudah diverifikasi; pencairan otomatis aktif.'
         else coalesce(p_note, 'Periksa kembali data rekening Anda di menu Saldo › Rekening pencairan.') end,
    jsonb_build_object('kind', 'payout_account', 'account_id', ba.id, 'verified', p_ok));
  return to_jsonb(ba);
end $$;
revoke all on function public.admin_partner_payout_verify(uuid, boolean, text) from public, anon;
grant execute on function public.admin_partner_payout_verify(uuid, boolean, text) to authenticated;

create or replace function public.admin_payout_provider_jobs(p_status text default null)
returns setof jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform admin_require('payments_view');
  return query select to_jsonb(j) || jsonb_build_object('batch_label', b.cutoff, 'batch_status', b.status, 'batch_total', b.total, 'batch_count', b.count)
    from payout_provider_jobs j join payout_batches b on b.id = j.batch_id
   where p_status is null or j.status = p_status order by j.created_at desc limit 200;
end $$;
revoke all on function public.admin_payout_provider_jobs(text) from public, anon;
grant execute on function public.admin_payout_provider_jobs(text) to authenticated;

-- ---------------------------------------------------------------------
-- 9. Tambalan fungsi lama (jangkar pada BARIS KODE)
-- ---------------------------------------------------------------------
-- driver_set_online(true): rekening wajib (setelah cek approved, sebelum cek saldo/deposit)
select _v3_splice('0123', 'public.driver_set_online(boolean,double precision,double precision)',
  $a$    if d.status <> 'approved' then raise exception 'Akun driver belum disetujui admin'; end if;$a$,
  $a$    if d.status <> 'approved' then raise exception 'Akun driver belum disetujui admin'; end if;
    perform payout_account_require(d.id);$a$,
  'payout_account_require');

-- register_driver: payload.payout_account disimpan; langkah akhir (dokumen/final) menuntut rekening
select _v3_splice('0123', 'public.register_driver(jsonb)',
  $a$  if length(trim(coalesce(p->>'vehicle_brand',''))) < 2 then raise exception 'Merek kendaraan wajib diisi'; end if;$a$,
  $a$  if length(trim(coalesce(p->>'vehicle_brand',''))) < 2 then raise exception 'Merek kendaraan wajib diisi'; end if;
  if jsonb_typeof(p->'payout_account') = 'object' then perform payout_account_upsert_internal(auth.uid(), p->'payout_account'); end if;
  if coalesce((p->>'final')::boolean, false) or coalesce(p->>'id_card_number', p->>'license_number', p->>'photo_id_url') is not null then perform payout_account_require(auth.uid()); end if;$a$,
  'payout_account_require');

-- travel_partner_register: idem (pendaftaran mitra travel satu langkah → selalu dicek)
select _v3_splice('0123', 'public.travel_partner_register(jsonb)',
  $a$  if coalesce((p->>'seats')::int, 0) < 3 then raise exception 'Kursi penumpang minimal 3'; end if;$a$,
  $a$  if coalesce((p->>'seats')::int, 0) < 3 then raise exception 'Kursi penumpang minimal 3'; end if;
  if jsonb_typeof(p->'payout_account') = 'object' then perform payout_account_upsert_internal(auth.uid(), p->'payout_account'); end if;
  perform payout_account_require(auth.uid());$a$,
  'payout_account_require');

-- merchant buka toko (update langsung is_open oleh pemilik; admin & bypass bebas)
select _v3_splice('0123', 'public.guard_merchant_update()',
  $a$    if new.is_halal <> old.is_halal then new.halal_verified := false; end if;$a$,
  $a$    if new.is_halal <> old.is_halal then new.halal_verified := false; end if;
    if new.is_open and not old.is_open then perform payout_account_require(new.owner_id); end if;$a$,
  'payout_account_require');

-- request_withdrawal: argumen kosong → rekening tersimpan
select _v3_splice('0123', 'public.request_withdrawal(bigint,text,text,text)',
  $a$  if p_amount < 10000 then raise exception 'Minimal penarikan Rp10.000'; end if;$a$,
  $a$  if p_amount < 10000 then raise exception 'Minimal penarikan Rp10.000'; end if;
  if nullif(btrim(coalesce(p_bank, '')), '') is null or nullif(btrim(coalesce(p_account, '')), '') is null or nullif(btrim(coalesce(p_name, '')), '') is null then
    select * into ba from bank_accounts where user_id = auth.uid();
    if not found then raise exception 'PAYOUT_ACCOUNT_REQUIRED: rekening pencairan belum tersimpan — isi di menu Saldo › Rekening pencairan.'; end if;
    p_bank := ba.bank_name; p_account := ba.account_no; p_name := ba.holder;
  end if;$a$,
  'PAYOUT_ACCOUNT_REQUIRED');

-- payout_batch_auto: auto-sweep sebelum batch sesi + antrean provider saat batch dibuat
select _v3_splice('0123', 'public.payout_batch_auto(timestamptz)',
  $a$    if v_enabled then$a$,
  $a$    if v_enabled then
      perform payout_auto_sweep(v_date, cut);$a$,
  'payout_auto_sweep');
select _v3_splice('0123', 'public.payout_batch_auto(timestamptz)',
  $a$      update payout_sessions set status = 'dibuat', batch_id = (r->>'batch_id')::uuid, items = (r->>'count')::int, total = (r->>'total')::bigint where id = s.id returning * into s;$a$,
  $a$      update payout_sessions set status = 'dibuat', batch_id = (r->>'batch_id')::uuid, items = (r->>'count')::int, total = (r->>'total')::bigint where id = s.id returning * into s;
      perform payout_provider_enqueue(s.batch_id);$a$,
  'payout_provider_enqueue');

-- CSV BCA: alias terpanjang menang (Danamon vs DANA)
select _v3_splice('0123', 'public.admin_payout_batch_export_bca(uuid)',
  $a$where exists (select 1 from unnest(k.aliases) al where w.bank_name ilike '%' || al || '%') limit 1), ''),$a$,
  $a$where exists (select 1 from unnest(k.aliases) al where w.bank_name ilike '%' || al || '%')
                         order by (select max(length(al)) from unnest(k.aliases) al where w.bank_name ilike '%' || al || '%') desc limit 1), ''),$a$,
  'max(length(al))');

-- spesifikasi setelan
select _v3_splice('0123', 'public.app_setting_specs()',
  $a$    ('payout_min_amount',          'int',     0, 100000000, null, '50000', 'Rp', 'UANG', '0119: nominal minimum ikut batch otomatis sesi awal; sesi terakhir mengambil semua [ASUMSI]', 'payout'),$a$,
  $a$    ('payout_min_amount',          'int',     0, 100000000, null, '50000', 'Rp', 'UANG', '0119: nominal minimum ikut batch otomatis sesi awal; sesi terakhir mengambil semua [ASUMSI]', 'payout'),
    ('payout_account_required',    'bool',    null, null, null, 'true', '', 'UANG', '0123: rekening pencairan wajib sebelum driver online / merchant buka / mitra travel daftar', 'payout'),
    ('payout_auto_sweep_enabled',  'bool',    null, null, null, 'true', '', 'UANG', '0123: cairkan saldo mitra otomatis ke rekening tersimpan di tiap sesi (≥ payout_min_amount)', 'payout'),
    ('payout_sweep_driver_reserve','int',     0, 100000000, null, '0', 'Rp', 'UANG', '0123: saldo driver yang disisakan saat auto-sweep (default = driver_min_balance_accept) [ASUMSI]', 'payout'),
    ('payout_provider',            'text',    null, null, array['manual','api'], '"manual"', '', 'UANG', '0123: manual = CSV bank; api = antre ke provider disbursement (edge pay-disburse) — belum diaktifkan', 'payout'),$a$,
  'payout_account_required');

-- ---------------------------------------------------------------------
-- 10. Penjaga
-- ---------------------------------------------------------------------
do $$
declare v_cron boolean := false;
begin
  if to_regclass('public.partner_payout_accounts') is null or to_regclass('public.payout_provider_jobs') is null then raise exception '0123 batal: view/tabel belum ada'; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'bank_accounts' and column_name = 'channel') then raise exception '0123 batal: bank_accounts.channel belum ada'; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'withdrawal_requests' and column_name = 'source') then raise exception '0123 batal: withdrawal_requests.source belum ada'; end if;
  if (select count(*) from bank_codes where code in ('dana', 'ovo', 'linkaja', 'gopay', 'shopeepay')) <> 5 then raise exception '0123 batal: kode e-wallet belum lengkap'; end if;
  if position('payout_account_require' in pg_get_functiondef('public.driver_set_online(boolean,double precision,double precision)'::regprocedure)) = 0 then raise exception '0123 batal: driver_set_online belum dijaga'; end if;
  if position('payout_account_require' in pg_get_functiondef('public.register_driver(jsonb)'::regprocedure)) = 0 then raise exception '0123 batal: register_driver belum dijaga'; end if;
  if position('payout_account_require' in pg_get_functiondef('public.travel_partner_register(jsonb)'::regprocedure)) = 0 then raise exception '0123 batal: travel_partner_register belum dijaga'; end if;
  if position('payout_account_require' in pg_get_functiondef('public.guard_merchant_update()'::regprocedure)) = 0 then raise exception '0123 batal: guard_merchant_update belum dijaga'; end if;
  if position('PAYOUT_ACCOUNT_REQUIRED' in pg_get_functiondef('public.request_withdrawal(bigint,text,text,text)'::regprocedure)) = 0 then raise exception '0123 batal: request_withdrawal belum memakai rekening tersimpan'; end if;
  if position('payout_auto_sweep' in pg_get_functiondef('public.payout_batch_auto(timestamptz)'::regprocedure)) = 0
     or position('payout_provider_enqueue' in pg_get_functiondef('public.payout_batch_auto(timestamptz)'::regprocedure)) = 0 then raise exception '0123 batal: payout_batch_auto belum memanggil sweep/provider'; end if;
  if position('max(length(al))' in pg_get_functiondef('public.admin_payout_batch_export_bca(uuid)'::regprocedure)) = 0 then raise exception '0123 batal: ekspor CSV belum ditambal'; end if;
  if not exists (select 1 from app_setting_specs() where key = 'payout_provider') then raise exception '0123 batal: app_setting_specs belum memuat payout_provider'; end if;
  if to_regclass('cron.job') is not null then
    execute $q$select exists (select 1 from cron.job where jobname = 'antarkita_payout_provider_dispatch')$q$ into v_cron;
  end if;
  raise notice '0123 ok: rekening=% (terverifikasi %), cron provider=%', (select count(*) from bank_accounts), (select count(*) from bank_accounts where verified), v_cron;
end $$;
