-- =====================================================================
-- 0110 — PAYOUT & DISBURSEMENT (manual | Finpay) + status settlement pesanan — Finpay v3
--
-- Sumber: docs/finpay-v3/KONTRAK-API-V3.md §8 (payout & disbursement), §3 (settlement_status pesanan:
-- ORDER_COMPLETED → PAYOUT_PENDING → PAYOUT_SETTLED → RECONCILED), §6 (entry payout_fee).
--
--   • withdrawal_requests + provider ('manual'|'finpay'; default app_settings.disbursement_provider saat
--     diajukan), inquiry_ref, fee, payout_status (PAYOUT_PENDING|PROCESSING|SETTLED|FAILED), failed_reason.
--   • withdrawal_orders: pesanan selesai (bayar saldo/gateway) milik mitra yang payable-nya ikut dicairkan
--     → orders.settlement_status PAYOUT_PENDING; settled → PAYOUT_SETTLED; gagal/ditolak → ORDER_COMPLETED.
--     [ASUMSI] satu penarikan mencakup semua payable pesanan selesai mitra itu yang belum pernah dicairkan.
--   • payout_event_ingest(p_external_id, p_status, p_raw) (service_role, edge pay-disburse): PROCESSING →
--     SETTLED (settled_at, biaya → order_ledger payout_fee) | FAILED (saldo dikembalikan wallet_apply refund,
--     notifikasi). Status terminal tidak mundur.
--   • admin_mark_withdrawal_settled (0102) → payout_status PAYOUT_SETTLED + pesanan terkait PAYOUT_SETTLED.
--   • my_withdrawals(); driver_order_breakdown / merchant_order_breakdown + settlement_status, payout_status,
--     promo_funded_by, pg_fee_funded_by (inti v2 dipertahankan sebagai _driver/_merchant_order_breakdown_v2).
-- Semua blok idempoten.
-- =====================================================================

do $$
declare s text;
begin
  foreach s in array array[
    'public.admin_mark_withdrawal_settled(uuid,text)', 'public.driver_order_breakdown(uuid)', 'public.merchant_order_breakdown(uuid)',
    'public._driver_order_breakdown_v2(uuid)', 'public._merchant_order_breakdown_v2(uuid)', 'public.withdrawal_payout_defaults()',
    'public.withdrawal_link_orders()', 'public.withdrawal_status_sync()', 'public.payout_event_ingest(text,text,jsonb)', 'public.my_withdrawals()',
    'public.payout_status_map(text)', 'public.order_payout_extras(orders,text)'] loop
    perform _mig_backup('0110', s);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 1. Kolom & tautan pesanan
-- ---------------------------------------------------------------------
alter table public.withdrawal_requests add column if not exists provider text;
alter table public.withdrawal_requests add column if not exists inquiry_ref text;
alter table public.withdrawal_requests add column if not exists fee bigint not null default 0;
alter table public.withdrawal_requests add column if not exists payout_status text;
alter table public.withdrawal_requests add column if not exists failed_reason text;
alter table public.withdrawal_requests add column if not exists payout_updated_at timestamptz;
update public.withdrawal_requests set provider = 'manual' where provider is null;
update public.withdrawal_requests set payout_status = case when settled_at is not null then 'PAYOUT_SETTLED' when status = 'rejected' then 'PAYOUT_FAILED' else 'PAYOUT_PENDING' end,
  failed_reason = case when status = 'rejected' and settled_at is null then coalesce(review_note, 'ditolak admin') end
 where payout_status is null;
alter table public.withdrawal_requests alter column provider set default 'manual';
alter table public.withdrawal_requests alter column provider set not null;
alter table public.withdrawal_requests alter column payout_status set default 'PAYOUT_PENDING';
alter table public.withdrawal_requests alter column payout_status set not null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'withdrawal_requests_provider_check') then
    alter table public.withdrawal_requests add constraint withdrawal_requests_provider_check check (provider in ('manual', 'finpay'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'withdrawal_requests_payout_status_check') then
    alter table public.withdrawal_requests add constraint withdrawal_requests_payout_status_check
      check (payout_status in ('PAYOUT_PENDING','PAYOUT_PROCESSING','PAYOUT_SETTLED','PAYOUT_FAILED'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'withdrawal_requests_fee_check') then
    alter table public.withdrawal_requests add constraint withdrawal_requests_fee_check check (fee >= 0);
  end if;
end $$;
create index if not exists withdrawal_requests_payout_idx on public.withdrawal_requests (payout_status, created_at);
create index if not exists withdrawal_requests_provider_ref_idx on public.withdrawal_requests (provider_ref) where provider_ref is not null;
comment on column public.withdrawal_requests.payout_status is 'Finpay v3 §8: PAYOUT_PENDING → PAYOUT_PROCESSING → PAYOUT_SETTLED | PAYOUT_FAILED (saldo dikembalikan). approved ≠ settled.';

create table if not exists public.withdrawal_orders (
  withdrawal_id uuid not null references public.withdrawal_requests(id) on delete cascade,
  order_id      uuid not null references public.orders(id),
  role          text not null check (role in ('driver', 'merchant', 'partner')),
  created_at    timestamptz not null default now(),
  primary key (withdrawal_id, order_id, role)
);
create index if not exists withdrawal_orders_order_idx on public.withdrawal_orders (order_id);
comment on table public.withdrawal_orders is 'Finpay v3 §3/§8: pesanan yang payable-nya ikut pencairan ini ([ASUMSI] semua pesanan selesai non-tunai mitra yang belum dicairkan).';
alter table public.withdrawal_orders enable row level security;
drop policy if exists withdrawal_orders_read on public.withdrawal_orders;
create policy withdrawal_orders_read on public.withdrawal_orders for select to authenticated
  using (is_admin() or exists (select 1 from withdrawal_requests w where w.id = withdrawal_id and w.user_id = auth.uid()));
revoke all on public.withdrawal_orders from public, anon, authenticated;
grant select on public.withdrawal_orders to authenticated;
grant all on public.withdrawal_orders to service_role;

create or replace function public.withdrawal_payout_defaults()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.provider := coalesce(new.provider, case when lower(coalesce((select value #>> '{}' from app_settings where key = 'disbursement_provider'), 'manual')) = 'finpay'
                                              then 'finpay' else 'manual' end);
  new.payout_status := coalesce(new.payout_status, 'PAYOUT_PENDING');
  return new;
end $$;
drop trigger if exists t_withdrawal_payout_defaults on public.withdrawal_requests;
create trigger t_withdrawal_payout_defaults before insert on public.withdrawal_requests for each row execute function withdrawal_payout_defaults();
alter table public.withdrawal_requests alter column provider drop default;   -- diisi trigger dari disbursement_provider

create or replace function public.withdrawal_link_orders()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into withdrawal_orders (withdrawal_id, order_id, role)
  select new.id, o.id, case when o.driver_id = new.user_id then 'driver' when o.travel_partner_id = new.user_id then 'partner' else 'merchant' end
    from orders o left join merchants m on m.id = o.merchant_id
   where o.status = 'completed' and o.settlement_status = 'ORDER_COMPLETED' and o.payment_method = 'wallet'
     and (o.driver_id = new.user_id or o.travel_partner_id = new.user_id or m.owner_id = new.user_id)
     and o.completed_at <= new.created_at
  on conflict do nothing;
  update orders set settlement_status = 'PAYOUT_PENDING'
   where id in (select order_id from withdrawal_orders where withdrawal_id = new.id) and settlement_status = 'ORDER_COMPLETED';
  return null;
end $$;
drop trigger if exists t_withdrawal_link_orders on public.withdrawal_requests;
create trigger t_withdrawal_link_orders after insert on public.withdrawal_requests for each row execute function withdrawal_link_orders();

-- ditolak admin (admin_review_withdrawal) → PAYOUT_FAILED, pesanan kembali ORDER_COMPLETED
create or replace function public.withdrawal_status_sync()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'rejected' and old.status is distinct from 'rejected' and new.payout_status <> 'PAYOUT_SETTLED' then
    new.payout_status := 'PAYOUT_FAILED';
    new.failed_reason := coalesce(new.failed_reason, new.review_note, 'ditolak admin');
    update orders set settlement_status = 'ORDER_COMPLETED'
     where id in (select order_id from withdrawal_orders where withdrawal_id = new.id) and settlement_status = 'PAYOUT_PENDING';
  end if;
  if new.payout_status is distinct from old.payout_status then new.payout_updated_at := now(); end if;
  return new;
end $$;
drop trigger if exists t_withdrawal_status_sync on public.withdrawal_requests;
create trigger t_withdrawal_status_sync before update on public.withdrawal_requests for each row execute function withdrawal_status_sync();

-- ---------------------------------------------------------------------
-- 2. Penandaan settled manual (0102) → payout_status + settlement pesanan
-- ---------------------------------------------------------------------
create or replace function public.admin_mark_withdrawal_settled(p_id uuid, p_provider_ref text)
returns withdrawal_requests
language plpgsql security definer set search_path = public as $$
declare w withdrawal_requests; b withdrawal_requests; v_ref text := nullif(trim(coalesce(p_provider_ref, '')), '');
begin
  if not is_admin() then raise exception 'Hanya admin'; end if;
  perform admin_require('payout');   -- 0107 RBAC
  perform admin_require_unlock();
  if v_ref is null or length(v_ref) < 3 or length(v_ref) > 120 then raise exception 'Nomor referensi bank/provider wajib diisi (3–120 karakter)'; end if;
  select * into b from withdrawal_requests where id = p_id for update;
  if not found then raise exception 'Permintaan penarikan tidak ditemukan'; end if;
  if b.status <> 'approved' then raise exception 'Hanya penarikan berstatus approved yang bisa ditandai settled (status %)', b.status; end if;
  if b.settled_at is not null then raise exception 'Penarikan sudah settled % (ref %)', b.settled_at, b.provider_ref; end if;
  if b.payout_status = 'PAYOUT_FAILED' then raise exception 'Pencairan sudah gagal (%) — saldo sudah dikembalikan', b.failed_reason; end if;
  if exists (select 1 from withdrawal_requests x where x.provider_ref = v_ref and x.id <> b.id) then raise exception 'Referensi % sudah dipakai penarikan lain', v_ref; end if;
  update withdrawal_requests set settled_at = now(), provider_ref = v_ref, settled_by = auth.uid(), payout_status = 'PAYOUT_SETTLED'   -- 0110
   where id = b.id returning * into w;
  update orders set settlement_status = 'PAYOUT_SETTLED'
   where id in (select order_id from withdrawal_orders where withdrawal_id = w.id) and settlement_status in ('ORDER_COMPLETED', 'PAYOUT_PENDING');
  insert into notifications (user_id, kind, title, body, data) values (w.user_id, 'system', 'Dana penarikan sudah ditransfer',
    'Rp' || to_char(w.amount, 'FM999G999G999') || ' ke ' || w.bank_name || ' ' || w.bank_account || ' sudah ditransfer (ref ' || v_ref || ').',
    jsonb_build_object('withdrawal_id', w.id, 'provider_ref', v_ref));
  perform log_activity('withdrawal.settled', 'withdrawal_requests', w.id::text, 'Penarikan Rp' || w.amount || ' settled, ref ' || v_ref,
    jsonb_build_object('before', to_jsonb(b), 'after', to_jsonb(w)));
  return w;
end $$;
revoke all on function public.admin_mark_withdrawal_settled(uuid, text) from public, anon;
grant execute on function public.admin_mark_withdrawal_settled(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Event disbursement provider (service_role, edge pay-disburse)
-- ---------------------------------------------------------------------
create or replace function public.payout_status_map(p_status text)
returns text language sql immutable set search_path = public as $$
  select case upper(btrim(coalesce(p_status, '')))
    when 'PENDING' then 'PAYOUT_PROCESSING' when 'PROCESSING' then 'PAYOUT_PROCESSING' when 'SUBMITTED' then 'PAYOUT_PROCESSING'
    when 'INQUIRY_OK' then 'PAYOUT_PROCESSING' when 'PAYOUT_PROCESSING' then 'PAYOUT_PROCESSING'
    when 'SUCCESS' then 'PAYOUT_SETTLED' when 'SETTLED' then 'PAYOUT_SETTLED' when 'PAID' then 'PAYOUT_SETTLED' when 'COMPLETED' then 'PAYOUT_SETTLED'
    when 'DONE' then 'PAYOUT_SETTLED' when 'PAYOUT_SETTLED' then 'PAYOUT_SETTLED'
    when 'FAILED' then 'PAYOUT_FAILED' when 'FAILURE' then 'PAYOUT_FAILED' when 'REJECTED' then 'PAYOUT_FAILED' when 'CANCELLED' then 'PAYOUT_FAILED'
    when 'ERROR' then 'PAYOUT_FAILED' when 'PAYOUT_FAILED' then 'PAYOUT_FAILED'
    else null end;
$$;

create or replace function public.payout_event_ingest(p_external_id text, p_status text, p_raw jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare w withdrawal_requests; b withdrawal_requests; v_new text := payout_status_map(p_status); v_fee bigint; v_reason text; v_ref text;
begin
  select * into b from withdrawal_requests
   where provider_ref = p_external_id or inquiry_ref = p_external_id or id::text = p_external_id
   order by (id::text = p_external_id) desc limit 1 for update;
  if not found then return jsonb_build_object('applied', false, 'note', 'withdrawal_not_found'); end if;
  if v_new is null then return jsonb_build_object('applied', false, 'payout_status', b.payout_status, 'note', 'unknown_status'); end if;
  if b.payout_status in ('PAYOUT_SETTLED', 'PAYOUT_FAILED') then   -- terminal: tidak mundur
    return jsonb_build_object('applied', false, 'payout_status', b.payout_status, 'note', case when b.payout_status = v_new then 'no_change' else 'ignored_terminal' end);
  end if;
  if b.status <> 'approved' then return jsonb_build_object('applied', false, 'payout_status', b.payout_status, 'note', 'not_approved:' || b.status); end if;
  if v_new = b.payout_status then return jsonb_build_object('applied', false, 'payout_status', b.payout_status, 'note', 'no_change'); end if;
  v_fee := nullif(coalesce(p_raw->>'fee', p_raw->>'transferFee', ''), '')::bigint;
  v_ref := coalesce(nullif(p_raw->>'reference', ''), nullif(p_raw->>'transfer_id', ''), nullif(p_raw->>'transferId', ''), b.provider_ref, p_external_id);
  if v_new = 'PAYOUT_PROCESSING' then
    update withdrawal_requests set payout_status = v_new, provider = case when provider = 'manual' and p_raw ? 'provider' then lower(p_raw->>'provider') else provider end,
      inquiry_ref = coalesce(nullif(p_raw->>'inquiry_ref', ''), nullif(p_raw->>'inquiryId', ''), inquiry_ref), provider_ref = v_ref, fee = coalesce(v_fee, fee)
     where id = b.id returning * into w;
  elsif v_new = 'PAYOUT_SETTLED' then
    update withdrawal_requests set payout_status = v_new, settled_at = coalesce(settled_at, now()), provider_ref = v_ref, fee = coalesce(v_fee, fee)
     where id = b.id returning * into w;
    update orders set settlement_status = 'PAYOUT_SETTLED'
     where id in (select order_id from withdrawal_orders where withdrawal_id = w.id) and settlement_status in ('ORDER_COMPLETED', 'PAYOUT_PENDING');
    if w.fee > 0 then
      insert into order_ledger (source, source_id, entry, amount, party_role, party_id, phase, note)
      values ('payouts', w.id, 'payout_fee', -w.fee, 'platform', w.user_id, 'settled', 'biaya transfer pencairan ' || coalesce(w.provider_ref, '') || ' (' || w.provider || ')');
    end if;
    insert into notifications (user_id, kind, title, body, data) values (w.user_id, 'system', 'Dana penarikan sudah ditransfer',
      'Rp' || to_char(w.amount, 'FM999G999G999') || ' ke ' || w.bank_name || ' ' || w.bank_account || ' sudah ditransfer (ref ' || coalesce(w.provider_ref, '-') || ').',
      jsonb_build_object('withdrawal_id', w.id, 'provider_ref', w.provider_ref));
  else
    v_reason := coalesce(nullif(p_raw->>'reason', ''), nullif(p_raw->>'responseMessage', ''), nullif(p_raw->>'message', ''), 'pencairan gagal di provider');
    update withdrawal_requests set payout_status = 'PAYOUT_FAILED', failed_reason = v_reason, status = 'rejected',
      review_note = coalesce(review_note || ' · ', '') || 'gagal: ' || v_reason, provider_ref = v_ref
     where id = b.id returning * into w;
    if not exists (select 1 from wallet_transactions where ref = 'WDF-' || w.id::text) then
      perform wallet_apply(w.user_id, 'refund', w.amount, null, 'Pencairan gagal, saldo dikembalikan (' || v_reason || ')', 'WDF-' || w.id::text);
    end if;
    update orders set settlement_status = 'ORDER_COMPLETED'
     where id in (select order_id from withdrawal_orders where withdrawal_id = w.id) and settlement_status = 'PAYOUT_PENDING';
    insert into notifications (user_id, kind, title, body, data) values (w.user_id, 'system', 'Pencairan gagal',
      'Pencairan Rp' || to_char(w.amount, 'FM999G999G999') || ' gagal (' || v_reason || '). Saldo sudah dikembalikan — periksa rekening lalu ajukan ulang.',
      jsonb_build_object('withdrawal_id', w.id));
  end if;
  perform log_activity('withdrawal.' || lower(w.payout_status), 'withdrawal_requests', w.id::text,
    'Pencairan Rp' || w.amount || ' → ' || w.payout_status || coalesce(' (' || w.failed_reason || ')', ''),
    jsonb_build_object('before', b.payout_status, 'after', w.payout_status, 'raw', p_raw));
  return jsonb_build_object('applied', true, 'payout_status', w.payout_status, 'withdrawal_id', w.id, 'note', lower(w.payout_status));
end $$;
revoke all on function public.payout_event_ingest(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.payout_event_ingest(text, text, jsonb) to service_role;
comment on function public.payout_event_ingest(text, text, jsonb) is
  'Finpay v3 §8 (service_role, edge pay-disburse): status transfer dari provider. PROCESSING / SETTLED (settled_at, pesanan PAYOUT_SETTLED, biaya → ledger payout_fee) / FAILED (saldo dikembalikan sekali, pesanan ORDER_COMPLETED, notifikasi). Terminal tidak mundur.';

create or replace function public.my_withdrawals()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'amount', w.amount, 'fee', w.fee, 'bank_name', w.bank_name, 'bank_account', w.bank_account,
      'account_name', w.account_name, 'status', w.status, 'payout_status', w.payout_status, 'provider', w.provider, 'provider_ref', w.provider_ref,
      'settled_at', w.settled_at, 'failed_reason', w.failed_reason, 'auto', w.auto, 'created_at', w.created_at, 'reviewed_at', w.reviewed_at,
      'orders', (select count(*) from withdrawal_orders x where x.withdrawal_id = w.id)) order by w.created_at desc), '[]'::jsonb)
  from withdrawal_requests w where w.user_id = auth.uid();
$$;
revoke all on function public.my_withdrawals() from public, anon;
grant execute on function public.my_withdrawals() to authenticated;

-- ---------------------------------------------------------------------
-- 4. Rincian mitra per pesanan + status settlement/payout
-- ---------------------------------------------------------------------
create or replace function public.order_payout_extras(o orders, p_role text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'settlement_status', o.settlement_status,
    'payout_status', (select w.payout_status from withdrawal_orders x join withdrawal_requests w on w.id = x.withdrawal_id
                       where x.order_id = o.id and (p_role is null or x.role = p_role) order by w.created_at desc limit 1),
    'payout_withdrawal_id', (select w.id from withdrawal_orders x join withdrawal_requests w on w.id = x.withdrawal_id
                       where x.order_id = o.id and (p_role is null or x.role = p_role) order by w.created_at desc limit 1),
    'promo_funded_by', case when coalesce(o.discount, 0) > 0 then coalesce(o.promo_funded_by, 'platform') end,
    'pg_fee_funded_by', case when coalesce(o.pg_fee, 0) + coalesce(o.pg_fee_ppn, 0) > 0 then coalesce(o.pg_fee_borne_by, 'platform') end);
$$;
revoke all on function public.order_payout_extras(orders, text) from public, anon, authenticated;

do $$
declare def text;
begin
  if to_regprocedure('public._driver_order_breakdown_v2(uuid)') is null then
    def := pg_get_functiondef('public.driver_order_breakdown(uuid)'::regprocedure);
    if position('CREATE OR REPLACE FUNCTION public.driver_order_breakdown(p_order uuid)' in def) = 0 then raise exception '0110 batal: kepala driver_order_breakdown berubah'; end if;
    execute replace(def, 'CREATE OR REPLACE FUNCTION public.driver_order_breakdown(p_order uuid)', 'CREATE OR REPLACE FUNCTION public._driver_order_breakdown_v2(p_order uuid)');
  end if;
  if to_regprocedure('public._merchant_order_breakdown_v2(uuid)') is null then
    def := pg_get_functiondef('public.merchant_order_breakdown(uuid)'::regprocedure);
    if position('CREATE OR REPLACE FUNCTION public.merchant_order_breakdown(p_order uuid)' in def) = 0 then raise exception '0110 batal: kepala merchant_order_breakdown berubah'; end if;
    execute replace(def, 'CREATE OR REPLACE FUNCTION public.merchant_order_breakdown(p_order uuid)', 'CREATE OR REPLACE FUNCTION public._merchant_order_breakdown_v2(p_order uuid)');
  end if;
end $$;
revoke all on function public._driver_order_breakdown_v2(uuid) from public, anon, authenticated;
revoke all on function public._merchant_order_breakdown_v2(uuid) from public, anon, authenticated;

create or replace function public.driver_order_breakdown(p_order uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare j jsonb; o orders;
begin
  j := _driver_order_breakdown_v2(p_order);   -- pemeriksaan hak akses & angka v2 (0099) apa adanya
  select * into o from orders where id = p_order;
  return j || order_payout_extras(o, case when o.travel_partner_id = auth.uid() and o.driver_id is distinct from auth.uid() then 'partner'
                                         when coalesce(is_admin(), false) and o.driver_id is distinct from auth.uid() then null else 'driver' end);
end $$;
revoke all on function public.driver_order_breakdown(uuid) from public, anon;
grant execute on function public.driver_order_breakdown(uuid) to authenticated;
comment on function public.driver_order_breakdown(uuid) is 'Rincian pendapatan driver/mitra per order (0099) + Finpay v3 §8: settlement_status, payout_status, promo_funded_by, pg_fee_funded_by.';

create or replace function public.merchant_order_breakdown(p_order uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare j jsonb; o orders;
begin
  j := _merchant_order_breakdown_v2(p_order);   -- 0099/0104 apa adanya
  select * into o from orders where id = p_order;
  return j || order_payout_extras(o, case when coalesce(is_admin(), false) and not coalesce(owns_merchant(o.merchant_id), false) then null else 'merchant' end);
end $$;
revoke all on function public.merchant_order_breakdown(uuid) from public, anon;
grant execute on function public.merchant_order_breakdown(uuid) to authenticated;
comment on function public.merchant_order_breakdown(uuid) is 'Rincian per order untuk merchant (0099/0104) + Finpay v3 §8: settlement_status, payout_status, promo_funded_by, pg_fee_funded_by.';

-- ---------------------------------------------------------------------
-- 5. Penjaga migrasi
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from withdrawal_requests where payout_status is null or provider is null) then raise exception '0110 batal: withdrawal_requests lama belum terisi'; end if;
  if exists (select 1 from withdrawal_requests where settled_at is not null and payout_status <> 'PAYOUT_SETTLED') then raise exception '0110 batal: settled lama ≠ PAYOUT_SETTLED'; end if;
  if position('PAYOUT_SETTLED' in pg_get_functiondef('public.admin_mark_withdrawal_settled(uuid,text)'::regprocedure)) = 0 then raise exception '0110 batal: admin_mark_withdrawal_settled belum menulis payout_status'; end if;
  if has_function_privilege('authenticated', 'public.payout_event_ingest(text,text,jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public._driver_order_breakdown_v2(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.my_withdrawals()', 'EXECUTE') or has_table_privilege('authenticated', 'public.withdrawal_orders', 'INSERT') then
    raise exception '0110 batal: RPC/tabel payout terbuka';
  end if;
  raise notice '0110 ok: payout_status + provider disbursement, withdrawal_orders → settlement_status pesanan, payout_event_ingest, my_withdrawals, rincian mitra v3';
end $$;
