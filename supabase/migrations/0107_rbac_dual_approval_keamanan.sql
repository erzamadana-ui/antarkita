-- =====================================================================
-- 0107 — RBAC ADMIN, DUAL APPROVAL (maker-checker), PENGUNCIAN TULIS LANGSUNG, RATE LIMIT — Finpay v3
--
-- Sumber: docs/finpay-v3/KONTRAK-API-V3.md §4 (approval_requests), §5 (RBAC admin), aturan umum
-- ("tulis tabel finansial/aturan HANYA lewat RPC"), temuan audit K3 (Panel Admin v2 menulis
-- app_settings/pricing/promos langsung dari klien; tidak ada batas laju pada create_order/
-- order_payment_prepare/request_withdrawal).
--
--   1. profiles.admin_role ('superadmin','finance','ops','cs','viewer'; NULL = bukan admin). Admin yang
--      sudah ada → superadmin. Promosi baru ke role admin → 'viewer' (hak terkecil) sampai superadmin
--      menaikkan lewat admin_set_admin_role (PIN). Kolom hanya bisa diubah RPC itu (trigger).
--   2. admin_role_perms / admin_has(perm) / admin_require(perm) (menggantikan versi is_admin 0105),
--      my_admin_role() → {role, perms} untuk menyembunyikan menu Panel Admin.
--   3. approval_requests + admin_approvals / admin_approval_decide (checker ≠ maker, PIN).
--      admin_adjust_wallet v3: |amount| ≥ wallet_adjust_dual_approval_min → approval (dieksekusi saat disetujui).
--      admin_set_payment_channel_fee oleh non-superadmin → approval 'fee_change' (finance = maker).
--   4. CABUT tulis langsung klien: app_settings, service_economics, pricing, promos, payment_channel_fees,
--      ad_products (kebijakan RLS tulis admin dihapus) → RPC: admin_set_settings (0019/0104/0105),
--      admin_set_service_economics (0098), admin_set_pricing(p_id, p_patch), admin_set_promo(p_id, p_patch),
--      admin_upsert_promo(p jsonb) — semuanya PIN + log. (Panel Admin v2 masih UPDATE langsung → Agen E
--      memindahkan ke RPC ini.)
--   5. rate_take di create_order, order_payment_prepare, request_withdrawal (batas per jam dari
--      app_settings.rate_limit_*_per_hour, default 30 [ASUMSI]).
--   6. admin_review_withdrawal / admin_review_topup / admin_mark_withdrawal_settled: PIN + izin peran.
-- audit_logs append-only sudah dipasang 0106. Semua blok idempoten.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Cadangan
-- ---------------------------------------------------------------------
do $$
declare s text;
begin
  foreach s in array array[
    'public.admin_has(text)', 'public.admin_require(text)', 'public.admin_adjust_wallet(uuid,bigint,text)',
    'public.admin_review_withdrawal(uuid,boolean,text)', 'public.admin_review_topup(uuid,boolean,text)',
    'public.admin_mark_withdrawal_settled(uuid,text)', 'public.create_order(jsonb)', 'public.order_payment_prepare(uuid,text)',
    'public.request_withdrawal(bigint,text,text,text)', 'public.admin_set_payment_channel_fee(text,text,date,jsonb)',
    'public.admin_role_perms(text)', 'public.my_admin_role()', 'public.admin_set_admin_role(uuid,text)', 'public.profiles_admin_role_guard()',
    'public.approval_execute(uuid)', 'public.admin_approvals(text)', 'public.admin_approval_decide(uuid,boolean,text)',
    'public.admin_adjust_wallet_v3(uuid,bigint,text)', 'public.admin_set_pricing(text,jsonb)', 'public.admin_set_promo(text,jsonb)',
    'public.admin_upsert_promo(jsonb)', 'public.admin_role_of(uuid)'] loop
    perform _mig_backup('0107', s);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 1. profiles.admin_role
-- ---------------------------------------------------------------------
alter table public.profiles add column if not exists admin_role text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_admin_role_check') then
    alter table public.profiles add constraint profiles_admin_role_check check (admin_role is null or admin_role in ('superadmin','finance','ops','cs','viewer'));
  end if;
end $$;
comment on column public.profiles.admin_role is 'Finpay v3 §5: peran admin (superadmin|finance|ops|cs|viewer); NULL = bukan admin. role=''admin'' tetap syarat. Ubah hanya lewat admin_set_admin_role (superadmin + PIN).';

-- admin yang sudah ada → superadmin (sekali; migrasi ulang tidak menimpa peran yang sudah diatur)
update public.profiles set admin_role = 'superadmin' where role = 'admin' and admin_role is null;

create or replace function public.profiles_admin_role_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.admin_role is distinct from old.admin_role
     and auth.uid() is not null and coalesce(current_setting('antarkita.admin_role_bypass', true), '') <> 'on' then
    raise exception 'admin_role hanya bisa diubah lewat admin_set_admin_role (superadmin + PIN)';
  end if;
  if new.role::text <> 'admin' then new.admin_role := null;
  elsif new.admin_role is null then new.admin_role := 'viewer';   -- promosi baru: hak terkecil
  end if;
  return new;
end $$;
drop trigger if exists t_profiles_admin_role_guard on public.profiles;
create trigger t_profiles_admin_role_guard before insert or update of role, admin_role on public.profiles
  for each row execute function profiles_admin_role_guard();

create or replace function public.admin_role_of(p_user uuid)
returns text language sql stable security definer set search_path = public as $$
  select case when p.role = 'admin' and p.is_active then p.admin_role end from profiles p where p.id = p_user;
$$;
revoke all on function public.admin_role_of(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Matriks izin
-- ---------------------------------------------------------------------
create or replace function public.admin_role_perms(p_role text)
returns text[] language sql immutable set search_path = public as $$
  select case p_role
    when 'superadmin' then array['*','view','orders_view','payments_view','ledger','report','refund','refund_execute','payout','reconcile','fee',
                                 'wallet_adjust','approval','dispute','dispute_resolve','ticket','driver','merchant','city','orders','ads','pricing',
                                 'promo','gateway_secret','payment_config','admin_role']
    when 'finance'    then array['view','orders_view','payments_view','ledger','report','refund','refund_execute','payout','reconcile','fee',
                                 'wallet_adjust','approval','dispute','dispute_resolve']
    when 'ops'        then array['view','orders_view','payments_view','report','driver','merchant','city','orders','ads','pricing','promo','dispute','ticket']
    when 'cs'         then array['view','orders_view','payments_view','ticket','dispute']
    when 'viewer'     then array['view','orders_view','payments_view','ledger','report']
    else array[]::text[] end;
$$;
grant execute on function public.admin_role_perms(text) to authenticated, service_role;

create or replace function public.admin_has(p_perm text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(is_admin(), false) and exists (
    select 1 from profiles p where p.id = auth.uid() and p.admin_role is not null
       and (p.admin_role = 'superadmin' or p_perm = any (admin_role_perms(p.admin_role))));
$$;
create or replace function public.admin_require(p_perm text)
returns void language plpgsql stable security definer set search_path = public as $$
declare v_role text;
begin
  if not coalesce(is_admin(), false) then raise exception 'Hanya admin'; end if;
  if not admin_has(p_perm) then
    select admin_role into v_role from profiles where id = auth.uid();
    raise exception 'ADMIN_FORBIDDEN: peran admin % tidak punya izin %', coalesce(v_role, '(belum diatur)'), p_perm;
  end if;
end $$;
revoke all on function public.admin_has(text) from public, anon;
revoke all on function public.admin_require(text) from public, anon;
grant execute on function public.admin_has(text) to authenticated, service_role;
grant execute on function public.admin_require(text) to authenticated, service_role;

create or replace function public.my_admin_role()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when coalesce(is_admin(), false) then
    jsonb_build_object('role', p.admin_role, 'perms', to_jsonb(admin_role_perms(p.admin_role)))
  else jsonb_build_object('role', null, 'perms', '[]'::jsonb) end
  from (select 1) x left join profiles p on p.id = auth.uid();
$$;
revoke all on function public.my_admin_role() from public, anon;
grant execute on function public.my_admin_role() to authenticated;
comment on function public.my_admin_role() is 'Finpay v3 §5: {role, perms[]} admin yang login (Panel Admin menyembunyikan menu). Bukan admin → role null.';

create or replace function public.admin_set_admin_role(p_user uuid, p_role text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b profiles; a profiles; v_role text := nullif(lower(trim(coalesce(p_role, ''))), '');
begin
  perform admin_require('admin_role');
  perform admin_require_unlock();
  if v_role is not null and v_role not in ('superadmin','finance','ops','cs','viewer') then raise exception 'Peran harus superadmin|finance|ops|cs|viewer'; end if;
  select * into b from profiles where id = p_user for update;
  if not found then raise exception 'Pengguna tidak ditemukan'; end if;
  if b.role <> 'admin' then raise exception 'Pengguna bukan admin — jadikan admin dulu (admin_set_user)'; end if;
  if v_role is null then raise exception 'Peran wajib diisi (untuk mencabut admin gunakan admin_set_user)'; end if;
  if b.admin_role = 'superadmin' and v_role <> 'superadmin'
     and (select count(*) from profiles where role = 'admin' and is_active and admin_role = 'superadmin') <= 1 then
    raise exception 'Superadmin terakhir tidak boleh diturunkan';
  end if;
  perform set_config('antarkita.admin_role_bypass', 'on', true);
  update profiles set admin_role = v_role where id = p_user returning * into a;
  perform set_config('antarkita.admin_role_bypass', 'off', true);
  perform log_activity('admin.role_changed', 'profiles', p_user::text,
    'Peran admin ' || coalesce(a.full_name, p_user::text) || ': ' || coalesce(b.admin_role, '-') || ' → ' || a.admin_role,
    jsonb_build_object('before', b.admin_role, 'after', a.admin_role));
  insert into security_events (kind, user_id, detail) values ('admin.role_changed', auth.uid(), jsonb_build_object('target', p_user, 'before', b.admin_role, 'after', a.admin_role));
  return jsonb_build_object('user_id', p_user, 'admin_role', a.admin_role, 'perms', to_jsonb(admin_role_perms(a.admin_role)));
end $$;
revoke all on function public.admin_set_admin_role(uuid, text) from public, anon;
grant execute on function public.admin_set_admin_role(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 3. approval_requests (maker-checker)
-- ---------------------------------------------------------------------
create table if not exists public.approval_requests (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('refund','wallet_adjust','fee_change','payout_batch')),
  ref_id      uuid,
  payload     jsonb not null default '{}'::jsonb,
  amount      bigint,
  maker       uuid not null references public.profiles(id),
  checker     uuid references public.profiles(id),
  status      text not null default 'pending' check (status in ('pending','approved','rejected','expired')),
  created_at  timestamptz not null default now(),
  decided_at  timestamptz,
  expires_at  timestamptz not null default now() + interval '7 days',
  result      jsonb,
  note        text,
  check (checker is null or checker <> maker)
);
create index if not exists approval_requests_status_idx on public.approval_requests (status, created_at desc);
create index if not exists approval_requests_ref_idx on public.approval_requests (kind, ref_id) where ref_id is not null;
comment on table public.approval_requests is 'Finpay v3 §4: maker-checker generik (refund, wallet_adjust, fee_change, payout_batch). checker ≠ maker (CHECK). Ditulis hanya lewat RPC.';
alter table public.approval_requests enable row level security;
drop policy if exists approval_requests_admin on public.approval_requests;
create policy approval_requests_admin on public.approval_requests for select to authenticated using (is_admin());
revoke all on public.approval_requests from public, anon, authenticated;
grant select on public.approval_requests to authenticated;
grant all on public.approval_requests to service_role;
do $$
begin
  if to_regprocedure('public.audit_trigger()') is not null
     and not exists (select 1 from pg_trigger where tgname = 't_audit_approval_requests' and tgrelid = 'public.approval_requests'::regclass) then
    create trigger t_audit_approval_requests after insert or update on public.approval_requests for each row execute function audit_trigger();
  end if;
end $$;

-- Eksekusi approval yang disetujui (internal; dipanggil admin_approval_decide)
create or replace function public.approval_execute(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a approval_requests; v_bal bigint; r jsonb;
begin
  select * into a from approval_requests where id = p_id;
  if a.kind = 'wallet_adjust' then
    v_bal := wallet_apply((a.payload->>'user_id')::uuid, 'adjustment', (a.payload->>'amount')::bigint, null,
      coalesce(a.payload->>'note', 'Penyesuaian admin') || ' [disetujui ' || left(a.id::text, 8) || ']', 'APV-' || a.id::text);
    perform log_activity('wallet.adjusted', 'wallets', a.payload->>'user_id',
      'Penyesuaian saldo Rp' || (a.payload->>'amount') || ' dieksekusi (maker ' || a.maker || ', checker ' || auth.uid() || ')',
      jsonb_build_object('approval_id', a.id, 'amount', (a.payload->>'amount')::bigint, 'balance_after', v_bal));
    return jsonb_build_object('balance_after', v_bal);
  elsif a.kind = 'fee_change' then
    perform set_config('antarkita.approval_exec', 'on', true);
    r := to_jsonb(admin_set_payment_channel_fee(a.payload->>'provider', a.payload->>'channel', (a.payload->>'effective_from')::date, a.payload->'patch'));
    perform set_config('antarkita.approval_exec', 'off', true);
    return r;
  elsif a.kind = 'refund' then
    if to_regprocedure('public.refund_approval_apply(uuid,uuid)') is null then raise exception 'Modul refund (0108) belum terpasang'; end if;
    execute 'select public.refund_approval_apply($1, $2)' into r using a.ref_id, a.id;
    return r;
  else
    raise exception 'Jenis approval % belum bisa dieksekusi otomatis — tandai manual', a.kind;
  end if;
end $$;
revoke all on function public.approval_execute(uuid) from public, anon, authenticated;

create or replace function public.admin_approvals(p_status text default 'pending')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_st text := nullif(lower(trim(coalesce(p_status, ''))), 'all');
begin
  perform admin_require('view');
  return coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'ref_id', a.ref_id, 'payload', a.payload, 'amount', a.amount,
      'maker', a.maker, 'maker_name', pm.full_name, 'checker', a.checker, 'checker_name', pc.full_name,
      'status', case when a.status = 'pending' and a.expires_at < now() then 'expired' else a.status end,
      'created_at', a.created_at, 'decided_at', a.decided_at, 'expires_at', a.expires_at, 'note', a.note, 'result', a.result,
      'can_decide', a.status = 'pending' and a.maker <> auth.uid() and admin_has('approval')) order by a.created_at desc)
    from approval_requests a left join profiles pm on pm.id = a.maker left join profiles pc on pc.id = a.checker
    where v_st is null or a.status = v_st), '[]'::jsonb);
end $$;
revoke all on function public.admin_approvals(text) from public, anon;
grant execute on function public.admin_approvals(text) to authenticated;

create or replace function public.admin_approval_decide(p_id uuid, p_approve boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a approval_requests; r jsonb;
begin
  perform admin_require('approval');
  perform admin_require_unlock();
  if p_approve is null then raise exception 'Keputusan wajib diisi'; end if;
  select * into a from approval_requests where id = p_id for update;
  if not found then raise exception 'Permintaan persetujuan tidak ditemukan'; end if;
  if a.status <> 'pending' then raise exception 'Permintaan sudah %', a.status; end if;
  if a.expires_at < now() then
    update approval_requests set status = 'expired', decided_at = now() where id = a.id;
    raise exception 'Permintaan persetujuan sudah kedaluwarsa (%)', a.expires_at;
  end if;
  if a.maker = auth.uid() then raise exception 'DUAL_APPROVAL: pembuat (maker) tidak boleh menyetujui permintaannya sendiri — perlu admin lain (checker)'; end if;
  if a.kind = 'refund' and not admin_has('refund') then raise exception 'ADMIN_FORBIDDEN: persetujuan refund butuh izin refund'; end if;
  if a.kind = 'fee_change' and not admin_has('fee') then raise exception 'ADMIN_FORBIDDEN: persetujuan tarif butuh izin fee'; end if;
  update approval_requests set checker = auth.uid(), decided_at = now(), note = coalesce(p_note, note),
    status = case when p_approve then 'approved' else 'rejected' end where id = a.id returning * into a;
  if p_approve then
    r := approval_execute(a.id);
    update approval_requests set result = r where id = a.id returning * into a;
  elsif a.kind = 'refund' and to_regprocedure('public.refund_approval_reject(uuid,text)') is not null then
    execute 'select public.refund_approval_reject($1, $2)' using a.ref_id, coalesce(p_note, 'ditolak checker');
  end if;
  perform log_activity('approval.' || a.status, 'approval_requests', a.id::text,
    'Persetujuan ' || a.kind || ' ' || a.status || coalesce(' Rp' || a.amount, '') || ' (maker ' || coalesce((select full_name from profiles where id = a.maker), a.maker::text) || ')',
    jsonb_build_object('approval', to_jsonb(a)));
  return to_jsonb(a);
end $$;
revoke all on function public.admin_approval_decide(uuid, boolean, text) from public, anon;
grant execute on function public.admin_approval_decide(uuid, boolean, text) to authenticated;

-- admin_adjust_wallet v3 (tanda tangan tetap; hasil = saldo; saat butuh persetujuan saldo TIDAK berubah)
create or replace function public.admin_adjust_wallet_v3(p_user uuid, p_amount bigint, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_min bigint := setting_num('wallet_adjust_dual_approval_min', 100000)::bigint; a approval_requests; v_bal bigint;
begin
  perform admin_require('wallet_adjust');
  perform admin_require_unlock();
  if p_user is null or not exists (select 1 from profiles where id = p_user) then raise exception 'Pengguna tidak ditemukan'; end if;
  if p_amount is null or p_amount = 0 then raise exception 'Nominal penyesuaian tidak boleh 0'; end if;
  if length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'Tulis alasan penyesuaian (min. 3 huruf)'; end if;
  if abs(p_amount) >= v_min then
    insert into approval_requests (kind, ref_id, payload, amount, maker, note)
    values ('wallet_adjust', p_user, jsonb_build_object('user_id', p_user, 'amount', p_amount, 'note', p_note), p_amount, auth.uid(), p_note)
    returning * into a;
    perform log_activity('wallet.adjust_requested', 'approval_requests', a.id::text,
      'Penyesuaian saldo Rp' || p_amount || ' menunggu persetujuan admin kedua (≥ Rp' || v_min || ')', jsonb_build_object('user_id', p_user, 'amount', p_amount, 'note', p_note));
    return jsonb_build_object('status', 'pending_approval', 'approval_id', a.id, 'threshold', v_min,
      'balance', coalesce((select balance from wallets where user_id = p_user), 0));
  end if;
  v_bal := wallet_apply(p_user, 'adjustment', p_amount, null, coalesce(p_note, 'Penyesuaian admin'));
  perform log_activity('wallet.adjusted', 'wallets', p_user::text, 'Penyesuaian saldo Rp' || p_amount || ': ' || p_note,
    jsonb_build_object('amount', p_amount, 'balance_after', v_bal));
  return jsonb_build_object('status', 'executed', 'balance', v_bal, 'threshold', v_min);
end $$;
revoke all on function public.admin_adjust_wallet_v3(uuid, bigint, text) from public, anon;
grant execute on function public.admin_adjust_wallet_v3(uuid, bigint, text) to authenticated;
comment on function public.admin_adjust_wallet_v3(uuid, bigint, text) is
  'Finpay v3 §4: penyesuaian saldo — |amount| ≥ wallet_adjust_dual_approval_min → approval_requests (status pending_approval, saldo belum berubah); di bawahnya langsung. Izin wallet_adjust + PIN.';

create or replace function public.admin_adjust_wallet(p_user uuid, p_amount bigint, p_note text)
returns bigint language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  if not is_admin() then raise exception 'Hanya admin'; end if;
  r := admin_adjust_wallet_v3(p_user, p_amount, p_note);   -- 0107: dual approval di atas ambang
  return (r->>'balance')::bigint;
end $$;
comment on function public.admin_adjust_wallet(uuid, bigint, text) is
  'Kompatibel 0019: hasil = saldo. Sejak 0107 memanggil admin_adjust_wallet_v3 — nominal ≥ wallet_adjust_dual_approval_min TIDAK langsung dieksekusi (menunggu admin_approval_decide oleh admin lain); saldo yang dikembalikan = saldo saat ini.';

-- fee oleh non-superadmin (finance = maker) → approval 'fee_change'
select _v3_splice('0107', 'public.admin_set_payment_channel_fee(text,text,date,jsonb)',
  $a$  perform admin_require('fee');
  perform admin_require_unlock();$a$,
  $a$  perform admin_require('fee');
  perform admin_require_unlock();
  -- 0107 maker-checker: tarif diubah non-superadmin → approval fee_change (dieksekusi admin lain lewat admin_approval_decide)
  if coalesce(current_setting('antarkita.approval_exec', true), '') <> 'on' and coalesce(admin_role_of(auth.uid()), '') <> 'superadmin' then
    insert into approval_requests (kind, payload, maker, note)
    values ('fee_change', jsonb_build_object('provider', lower(trim(coalesce(p_provider, ''))), 'channel', lower(trim(coalesce(p_channel, ''))),
            'effective_from', coalesce(p_effective_from, '2026-01-01'), 'patch', p_patch), auth.uid(), 'perubahan tarif menunggu checker');
    perform log_activity('pg_fee.change_requested', 'payment_channel_fees', lower(trim(coalesce(p_provider, ''))) || ':' || lower(trim(coalesce(p_channel, ''))),
      'Perubahan tarif menunggu persetujuan admin kedua', jsonb_build_object('patch', p_patch, 'effective_from', p_effective_from));
    select * into a from payment_channel_fees where provider = lower(trim(coalesce(p_provider, ''))) and channel = lower(trim(coalesce(p_channel, '')))
      and effective_from <= coalesce(p_effective_from, '2026-01-01') order by effective_from desc limit 1;
    return a;
  end if;$a$,
  '0107 maker-checker');

-- ---------------------------------------------------------------------
-- 4. Cabut tulis langsung klien → RPC ber-PIN
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['public.app_settings','public.service_economics','public.pricing','public.promos','public.payment_channel_fees','public.ad_products'] loop
    perform _mig_backup_acl('0107', t);
  end loop;
end $$;
drop policy if exists settings_admin on public.app_settings;
revoke insert, update, delete, truncate on public.app_settings from public, anon, authenticated;
revoke all on public.app_settings from anon;
grant select on public.app_settings to authenticated;

drop policy if exists service_economics_admin on public.service_economics;
drop policy if exists service_economics_admin_read on public.service_economics;
create policy service_economics_admin_read on public.service_economics for select to authenticated using (is_admin());
revoke insert, update, delete, truncate on public.service_economics from public, anon, authenticated;

drop policy if exists pricing_admin on public.pricing;
revoke insert, update, delete, truncate on public.pricing from public, anon, authenticated;

drop policy if exists promos_admin on public.promos;
revoke insert, update, delete, truncate on public.promos from public, anon, authenticated;

drop policy if exists payment_channel_fees_admin_write on public.payment_channel_fees;
revoke insert, update, delete, truncate on public.payment_channel_fees from public, anon, authenticated;
drop policy if exists ad_products_admin_write on public.ad_products;
revoke insert, update, delete, truncate on public.ad_products from public, anon, authenticated;

create or replace function public.admin_set_pricing(p_id text, p_patch jsonb)
returns pricing language plpgsql security definer set search_path = public as $$
declare b pricing; a pricing; k text; ringkas text;
  allowed constant text[] := array['base_fare','per_km','per_min','min_fare','platform_fee','commission_pct','merchant_commission_pct','surge_multiplier'];
begin
  perform admin_require('pricing');
  perform admin_require_unlock();
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then raise exception 'Patch kosong: kirim objek {kolom: nilai}'; end if;
  for k in select jsonb_object_keys(p_patch) loop
    if not (k = any (allowed)) then raise exception 'Kolom tidak dikenal: %', k; end if;
  end loop;
  select * into b from pricing where service::text = lower(trim(coalesce(p_id, ''))) for update;
  if not found then raise exception 'Tarif layanan % tidak ditemukan', coalesce(p_id, '-'); end if;
  a := b;
  begin
    if p_patch ? 'base_fare' then a.base_fare := (p_patch->>'base_fare')::bigint; end if;
    if p_patch ? 'per_km' then a.per_km := (p_patch->>'per_km')::bigint; end if;
    if p_patch ? 'per_min' then a.per_min := (p_patch->>'per_min')::bigint; end if;
    if p_patch ? 'min_fare' then a.min_fare := (p_patch->>'min_fare')::bigint; end if;
    if p_patch ? 'platform_fee' then a.platform_fee := (p_patch->>'platform_fee')::bigint; end if;
    if p_patch ? 'commission_pct' then a.commission_pct := (p_patch->>'commission_pct')::numeric; end if;
    if p_patch ? 'merchant_commission_pct' then a.merchant_commission_pct := (p_patch->>'merchant_commission_pct')::numeric; end if;
    if p_patch ? 'surge_multiplier' then a.surge_multiplier := (p_patch->>'surge_multiplier')::numeric; end if;
  exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'Nilai patch tidak valid: %', sqlerrm; end;
  if least(a.base_fare, a.per_km, a.per_min, a.min_fare, a.platform_fee) < 0 then raise exception 'Nilai tarif tidak boleh negatif'; end if;
  if a.commission_pct not between 0 and 100 or a.merchant_commission_pct not between 0 and 100 then raise exception 'Persen harus 0–100'; end if;
  if a.surge_multiplier < 0.5 or a.surge_multiplier > 5 then raise exception 'surge_multiplier harus 0,5–5'; end if;
  update pricing set base_fare = a.base_fare, per_km = a.per_km, per_min = a.per_min, min_fare = a.min_fare, platform_fee = a.platform_fee,
    commission_pct = a.commission_pct, merchant_commission_pct = a.merchant_commission_pct, surge_multiplier = a.surge_multiplier, updated_at = now()
   where service = b.service returning * into a;   -- pagar komisi roda dua (0031) tetap berlaku lewat trigger
  select string_agg(format('%s: %s → %s', x.key, x.lama, x.baru), ', ') into ringkas
  from (select key, bj.value #>> '{}' as lama, aj.value #>> '{}' as baru from jsonb_each(to_jsonb(b)) bj(key, value) join jsonb_each(to_jsonb(a)) aj using (key)
        where key = any (allowed) and bj.value is distinct from aj.value) x;
  perform log_activity('pricing.updated', 'pricing', b.service::text, 'Tarif ' || b.service || ' diubah: ' || coalesce(ringkas, '(tidak ada perubahan)'),
    jsonb_build_object('before', to_jsonb(b), 'after', to_jsonb(a), 'patch', p_patch));
  return a;
end $$;
revoke all on function public.admin_set_pricing(text, jsonb) from public, anon;
grant execute on function public.admin_set_pricing(text, jsonb) to authenticated;
comment on function public.admin_set_pricing(text, jsonb) is 'Finpay v3 K3: pengganti UPDATE langsung pricing dari Panel Admin — izin pricing + PIN + log before/after. p_id = service.';

create or replace function public.admin_upsert_promo(p jsonb)
returns promos language plpgsql security definer set search_path = public as $$
declare b promos; a promos; k text; v_code text := upper(btrim(coalesce(p->>'code', ''))); v_new boolean := false; ringkas text;
  allowed constant text[] := array['code','description','title','image_url','discount_type','value','max_discount','min_total','service','quota',
    'is_active','valid_from','valid_to','sort_order','per_user_limit','funded_by'];
begin
  perform admin_require('promo');
  perform admin_require_unlock();
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'Promo harus objek JSON'; end if;
  for k in select jsonb_object_keys(p) loop
    if not (k = any (allowed)) then raise exception 'Kolom tidak dikenal: %', k; end if;
  end loop;
  if v_code !~ '^[A-Z0-9_-]{3,30}$' then raise exception 'Kode promo 3–30 karakter (huruf besar/angka/_/-)'; end if;
  select * into b from promos where code = v_code for update;
  if not found then
    v_new := true;
    if not (p ? 'value') then raise exception 'Promo baru wajib mengisi value'; end if;
    b.code := v_code; b.discount_type := 'fixed'; b.min_total := 0; b.is_active := true; b.used_count := 0; b.sort_order := 0;
    b.per_user_limit := 1; b.funded_by := 'platform'; b.valid_from := now();
  end if;
  a := b;
  begin
    if p ? 'description' then a.description := p->>'description'; end if;
    if p ? 'title' then a.title := nullif(p->>'title', ''); end if;
    if p ? 'image_url' then a.image_url := nullif(p->>'image_url', ''); end if;
    if p ? 'discount_type' then a.discount_type := lower(p->>'discount_type'); end if;
    if p ? 'value' then a.value := (p->>'value')::bigint; end if;
    if p ? 'max_discount' then a.max_discount := nullif(p->>'max_discount', '')::bigint; end if;
    if p ? 'min_total' then a.min_total := coalesce(nullif(p->>'min_total', '')::bigint, 0); end if;
    if p ? 'service' then a.service := nullif(p->>'service', '')::service_type; end if;
    if p ? 'quota' then a.quota := nullif(p->>'quota', '')::int; end if;
    if p ? 'is_active' then a.is_active := (p->>'is_active')::boolean; end if;
    if p ? 'valid_from' then a.valid_from := nullif(p->>'valid_from', '')::timestamptz; end if;
    if p ? 'valid_to' then a.valid_to := nullif(p->>'valid_to', '')::timestamptz; end if;
    if p ? 'sort_order' then a.sort_order := coalesce(nullif(p->>'sort_order', '')::int, 0); end if;
    if p ? 'per_user_limit' then a.per_user_limit := nullif(p->>'per_user_limit', '')::int; end if;
    if p ? 'funded_by' then a.funded_by := lower(p->>'funded_by'); end if;
  exception when invalid_text_representation or numeric_value_out_of_range or datatype_mismatch then raise exception 'Nilai promo tidak valid: %', sqlerrm; end;
  if a.discount_type not in ('fixed', 'percent') then raise exception 'discount_type harus fixed|percent'; end if;
  if a.value is null or a.value <= 0 or (a.discount_type = 'percent' and a.value > 100) then raise exception 'Nilai diskon tidak valid'; end if;
  if a.funded_by not in ('platform', 'merchant', 'sponsor') then raise exception 'funded_by harus platform|merchant|sponsor'; end if;
  if a.valid_to is not null and a.valid_from is not null and a.valid_to <= a.valid_from then raise exception 'valid_to harus setelah valid_from'; end if;
  if v_new then
    insert into promos (code, description, title, image_url, discount_type, value, max_discount, min_total, service, quota, used_count, is_active,
      valid_from, valid_to, sort_order, per_user_limit, funded_by)
    values (a.code, a.description, a.title, a.image_url, a.discount_type, a.value, a.max_discount, a.min_total, a.service, a.quota, 0, a.is_active,
      a.valid_from, a.valid_to, a.sort_order, a.per_user_limit, a.funded_by) returning * into a;
  else
    update promos set description = a.description, title = a.title, image_url = a.image_url, discount_type = a.discount_type, value = a.value,
      max_discount = a.max_discount, min_total = a.min_total, service = a.service, quota = a.quota, is_active = a.is_active, valid_from = a.valid_from,
      valid_to = a.valid_to, sort_order = a.sort_order, per_user_limit = a.per_user_limit, funded_by = a.funded_by
     where code = v_code returning * into a;
  end if;
  select string_agg(format('%s: %s → %s', x.key, x.lama, x.baru), ', ') into ringkas
  from (select key, bj.value #>> '{}' as lama, aj.value #>> '{}' as baru from jsonb_each(to_jsonb(b)) bj(key, value) join jsonb_each(to_jsonb(a)) aj using (key)
        where key = any (allowed) and bj.value is distinct from aj.value) x;
  perform log_activity(case when v_new then 'promo.created' else 'promo.updated' end, 'promos', v_code,
    'Promo ' || v_code || case when v_new then ' dibuat' else ' diubah: ' || coalesce(ringkas, '(tidak ada perubahan)') end,
    jsonb_build_object('before', case when v_new then null else to_jsonb(b) end, 'after', to_jsonb(a)));
  return a;
end $$;
revoke all on function public.admin_upsert_promo(jsonb) from public, anon;
grant execute on function public.admin_upsert_promo(jsonb) to authenticated;

create or replace function public.admin_set_promo(p_id text, p_patch jsonb)
returns promos language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from promos where code = upper(btrim(coalesce(p_id, '')))) then raise exception 'Promo % tidak ditemukan', coalesce(p_id, '-'); end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then raise exception 'Patch kosong'; end if;
  if p_patch ? 'code' and upper(btrim(p_patch->>'code')) <> upper(btrim(p_id)) then raise exception 'Kode promo tidak bisa diganti'; end if;
  return admin_upsert_promo((p_patch - 'code') || jsonb_build_object('code', upper(btrim(p_id))));
end $$;
revoke all on function public.admin_set_promo(text, jsonb) from public, anon;
grant execute on function public.admin_set_promo(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Rate limit (rate_take, 0040)
-- ---------------------------------------------------------------------
select _v3_splice('0107', 'public.create_order(jsonb)',
  $a$  -- Gerbang wilayah (0080): pesanan hanya dari kota yang layanannya sudah dibuka.$a$,
  $a$  -- 0107 rate_take: batas pesanan baru per pelanggan per jam (permintaan ulang idempoten di atas tidak terhitung)
  if not rate_take('create_order', greatest(1, setting_num('rate_limit_create_order_per_hour', 30)::int)) then
    raise exception 'RATE_LIMIT: terlalu banyak pesanan dalam 1 jam. Coba lagi nanti.';
  end if;
  -- Gerbang wilayah (0080): pesanan hanya dari kota yang layanannya sudah dibuka.$a$,
  '0107 rate_take');
select _v3_splice('0107', 'public.order_payment_prepare(uuid,text)',
  $a$  if auth.uid() is null then raise exception 'Harus login'; end if;$a$,
  $a$  if auth.uid() is null then raise exception 'Harus login'; end if;
  if not rate_take('payment_prepare', greatest(1, setting_num('rate_limit_payment_prepare_per_hour', 30)::int)) then   -- 0107 rate_take
    raise exception 'RATE_LIMIT: terlalu banyak permintaan pembayaran dalam 1 jam. Coba lagi nanti.';
  end if;$a$,
  '0107 rate_take');
select _v3_splice('0107', 'public.request_withdrawal(bigint,text,text,text)',
  $a$  perform withdrawal_require_allowed();  -- 0090: penarikan hanya untuk mitra$a$,
  $a$  perform withdrawal_require_allowed();  -- 0090: penarikan hanya untuk mitra
  if not rate_take('withdrawal', greatest(1, setting_num('rate_limit_withdrawal_per_hour', 30)::int)) then   -- 0107 rate_take
    raise exception 'RATE_LIMIT: terlalu banyak permintaan penarikan dalam 1 jam. Coba lagi nanti.';
  end if;$a$,
  '0107 rate_take');

-- ---------------------------------------------------------------------
-- 6. Review/penandaan uang: PIN + izin peran
-- ---------------------------------------------------------------------
select _v3_splice('0107', 'public.admin_review_withdrawal(uuid,boolean,text)',
  $a$  if not is_admin() then raise exception 'Hanya admin'; end if;
  perform admin_require_unlock();$a$,
  $a$  if not is_admin() then raise exception 'Hanya admin'; end if;
  perform admin_require('payout');   -- 0107 RBAC
  perform admin_require_unlock();$a$,
  '0107 RBAC');
select _v3_splice('0107', 'public.admin_review_topup(uuid,boolean,text)',
  $a$  if not is_admin() then raise exception 'Hanya admin'; end if;$a$,
  $a$  if not is_admin() then raise exception 'Hanya admin'; end if;
  perform admin_require('wallet_adjust');   -- 0107 RBAC: menyetujui top up manual = menambah saldo
  perform admin_require_unlock();           -- 0107: wajib PIN$a$,
  '0107 RBAC');
select _v3_splice('0107', 'public.admin_mark_withdrawal_settled(uuid,text)',
  $a$  if not is_admin() then raise exception 'Hanya admin'; end if;
  perform admin_require_unlock();$a$,
  $a$  if not is_admin() then raise exception 'Hanya admin'; end if;
  perform admin_require('payout');   -- 0107 RBAC
  perform admin_require_unlock();$a$,
  '0107 RBAC');

-- ---------------------------------------------------------------------
-- 7. Penjaga migrasi
-- ---------------------------------------------------------------------
do $$
declare t text; n int;
begin
  foreach t in array array['app_settings','service_economics','pricing','promos','payment_channel_fees','ad_products'] loop
    if has_table_privilege('authenticated', 'public.' || t, 'UPDATE') or has_table_privilege('authenticated', 'public.' || t, 'INSERT')
       or has_table_privilege('authenticated', 'public.' || t, 'DELETE') or has_table_privilege('authenticated', 'public.' || t, 'TRUNCATE') then
      raise exception '0107 batal: authenticated masih bisa menulis langsung ke %', t;
    end if;
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and cmd in ('INSERT','UPDATE','DELETE','ALL')) then
      raise exception '0107 batal: % masih punya kebijakan RLS tulis', t;
    end if;
  end loop;
  if exists (select 1 from profiles where role = 'admin' and admin_role is null) then raise exception '0107 batal: ada admin tanpa admin_role'; end if;
  foreach t in array array['create_order', 'order_payment_prepare', 'request_withdrawal'] loop
    if position('0107 rate_take' in (select pg_get_functiondef(p.oid) from pg_proc p where p.proname = t and p.pronamespace = 'public'::regnamespace)) = 0 then
      raise exception '0107 batal: rate_take belum terpasang di %', t;
    end if;
  end loop;
  foreach t in array array['admin_review_withdrawal', 'admin_review_topup', 'admin_mark_withdrawal_settled'] loop
    if position('0107 RBAC' in (select pg_get_functiondef(p.oid) from pg_proc p where p.proname = t and p.pronamespace = 'public'::regnamespace)) = 0 then
      raise exception '0107 batal: izin/PIN belum terpasang di %', t;
    end if;
  end loop;
  if position('admin_require_unlock' in pg_get_functiondef('public.admin_review_topup(uuid,boolean,text)'::regprocedure)) = 0 then
    raise exception '0107 batal: admin_review_topup belum wajib PIN';
  end if;
  if has_function_privilege('anon', 'public.admin_set_pricing(text,jsonb)', 'EXECUTE') or has_function_privilege('anon', 'public.admin_approval_decide(uuid,boolean,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.approval_execute(uuid)', 'EXECUTE') or has_table_privilege('authenticated', 'public.approval_requests', 'INSERT') then
    raise exception '0107 batal: RPC/tabel approval terbuka';
  end if;
  if not ('refund' = any (admin_role_perms('finance'))) or 'refund' = any (admin_role_perms('cs')) or array_length(admin_role_perms('viewer'), 1) > 5 then
    raise exception '0107 batal: matriks izin salah';
  end if;
  select count(*) into n from profiles where admin_role = 'superadmin';
  raise notice '0107 ok: RBAC (% superadmin), approval_requests, tulis langsung 6 tabel dicabut, rate_take 3 RPC, PIN review top up/penarikan', n;
end $$;
