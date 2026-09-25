-- =====================================================================
-- 0108 — REFUND, DISPUTE, DUAL APPROVAL REFUND — Finpay v3
--
-- Sumber: docs/finpay-v3/KONTRAK-API-V3.md §4 (refund_requests, refund_policy_calc, disputes,
-- dual approval), §3 (REFUND_REQUESTED → PARTIALLY_REFUNDED | REFUNDED; DISPUTED), §6 (ledger refund
-- pro-rata & dispute), §0.8 v2 (closed-loop saldo) + PKS Midtrans Pasal 7.4b (tanpa AntarPay, dana
-- dikembalikan lewat gateway, bukan ke saldo).
--
--   • refund_policy_calc(order) — per fase pesanan: sebelum merchant menerima = 100 %; sesudah diproses
--     = harga barang tidak kembali (merchant/driver yang sudah membeli menerima kompensasi); ongkir kembali
--     bila driver belum mengambil; biaya platform kembali; biaya metode pembayaran yang dibebankan ke
--     pelanggan TIDAK kembali. Diskon dialokasikan pro-rata (barang/ongkir).
--   • refund_requests + RPC: refund_request (pelanggan, pesanan batal/ditolak & sudah PAID),
--     admin_refund_approve (maker) → admin_refund_confirm (checker ≠ maker) bila ≥ refund_dual_approval_min,
--     admin_refund_reject, refund_claim/refund_execute_result (service_role, edge pay-refund),
--     admin_refund_requests (daftar Panel Admin). destination 'wallet' dieksekusi langsung (wallet_apply refund).
--   • Efek refund selesai: payments.refunded_amount & pay_status (PARTIALLY_REFUNDED/REFUNDED),
--     orders.payment_status, buku besar fase 'refunded' (append-only, set ulang):
--       pesanan batal  → refund −R, bagian tertahan (merchant_payable/vendor_payable/platform_revenue)
--       pesanan selesai → refund −R + pembalikan pro-rata driver/merchant/vendor/partner payable & platform_revenue,
--                         saldo mitra dikoreksi (adjustment) sebesar pembaliknya.
--   • disputes + dispute_open / my_disputes / admin_disputes / admin_dispute_resolve (PIN; refund →
--     refund_requests maker=admin). Ledger: baris 'dispute' (source disputes, fase adjusted) saat dibuka,
--     dibalik saat selesai.
--   • Kait 0105 diisi: payment_refund_auto → refund_requests late_payment (saldo bila AntarPay aktif,
--     gateway bila tidak); payment_hook_after_ingest → refund selesai dari provider / chargeback → sengketa.
--   • cancel_order / merchant_update_order: pesanan gateway yang sudah PAID saat AntarPay NONAKTIF tidak
--     lagi dikreditkan ke saldo (stored value) — dibuat refund_requests (gateway) otomatis.
-- Semua blok idempoten.
-- =====================================================================

do $$
declare s text;
begin
  foreach s in array array[
    'public.payment_refund_auto(uuid,text)', 'public.payment_hook_after_ingest(uuid,text,text,bigint,jsonb)',
    'public.receipt_refundable_note(orders)', 'public.cancel_order(uuid,text)', 'public.merchant_update_order(uuid,merchant_order_status)',
    'public.refund_policy_calc(uuid)', 'public.refund_request(uuid,bigint,text)', 'public.admin_refund_approve(uuid)',
    'public.admin_refund_confirm(uuid)', 'public.admin_refund_reject(uuid,text)', 'public.refund_claim(uuid)',
    'public.refund_execute_result(uuid,boolean,text,text)', 'public.refund_apply_effects(uuid)', 'public.refund_approval_apply(uuid,uuid)',
    'public.refund_approval_reject(uuid,text)', 'public.refund_via_request(orders)', 'public.refund_auto_on_cancel(uuid,uuid,text)',
    'public.admin_refund_requests(text)', 'public.refund_create_internal(uuid,bigint,text,text,uuid,text,uuid)',
    'public.dispute_open(uuid,text,bigint,text)', 'public.my_disputes()', 'public.admin_disputes(text)',
    'public.admin_dispute_resolve(uuid,text,text,bigint)', 'public.refund_execute_result(uuid,text,text,jsonb,text)',
    'public.order_refunds_done(uuid)', 'public.refund_record_wallet(uuid,uuid,bigint,text)', 'public.refund_order_cumulative(uuid,uuid)',
    'public.admin_refunds(text)'] loop
    perform _mig_backup('0108', s);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 1. Tabel
-- ---------------------------------------------------------------------
create table if not exists public.refund_requests (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid references public.orders(id),
  payment_id    uuid references public.payments(id),
  requested_by  uuid references public.profiles(id),
  amount        bigint not null check (amount > 0),
  kind          text not null check (kind in ('full', 'partial')),
  reason        text,
  destination   text not null check (destination in ('gateway', 'wallet')),
  status        text not null default 'requested' check (status in ('requested','approved','executing','done','failed','rejected')),
  maker         uuid references public.profiles(id),
  checker       uuid references public.profiles(id),
  provider_ref  text,
  source        text not null default 'customer' check (source in ('customer','admin','system','dispute','provider')),
  dispute_id    uuid,
  approval_id   uuid references public.approval_requests(id),
  policy        jsonb,
  created_at    timestamptz not null default now(),
  decided_at    timestamptz,
  executed_at   timestamptz,
  note          text,
  check (checker is null or maker is null or checker <> maker)
);
create index if not exists refund_requests_order_idx on public.refund_requests (order_id, created_at);
create index if not exists refund_requests_payment_idx on public.refund_requests (payment_id) where payment_id is not null;
create index if not exists refund_requests_status_idx on public.refund_requests (status, created_at);
-- S3: maksimal satu permintaan refund TERBUKA dari pelanggan per pesanan
create unique index if not exists refund_requests_one_open_customer on public.refund_requests (order_id)
  where source = 'customer' and status in ('requested', 'approved', 'executing');
comment on table public.refund_requests is
  'Finpay v3 §4: permintaan refund. requested → approved (maker; ≥ refund_dual_approval_min butuh checker ≠ maker) → executing (pay-refund) → done|failed; rejected. destination wallet = wallet_apply refund (hanya bila AntarPay aktif / fallback).';
alter table public.refund_requests enable row level security;
drop policy if exists refund_requests_read on public.refund_requests;
create policy refund_requests_read on public.refund_requests for select to authenticated
  using (is_admin() or requested_by = auth.uid() or exists (select 1 from orders o where o.id = order_id and o.customer_id = auth.uid()));
revoke all on public.refund_requests from public, anon, authenticated;
grant select on public.refund_requests to authenticated;
grant all on public.refund_requests to service_role;

create table if not exists public.disputes (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid references public.orders(id),
  payment_id    uuid references public.payments(id),
  opened_by     uuid references public.profiles(id),
  party_role    text not null check (party_role in ('customer','driver','merchant')),
  kind          text not null check (kind in ('amount_mismatch','not_received','chargeback','payout_missing','other')),
  amount        bigint not null default 0 check (amount >= 0),
  description   text,
  status        text not null default 'open' check (status in ('open','investigating','resolved_refund','resolved_no_refund','closed')),
  assigned_to   uuid references public.profiles(id),
  resolution    text,
  refund_id     uuid references public.refund_requests(id),
  created_at    timestamptz not null default now(),
  resolved_at   timestamptz
);
create index if not exists disputes_order_idx on public.disputes (order_id);
create index if not exists disputes_status_idx on public.disputes (status, created_at);
comment on table public.disputes is 'Finpay v3 §4: sengketa pembayaran/pencairan. Ledger: baris dispute (source disputes, fase adjusted) saat dibuka, dibalik saat diselesaikan.';
alter table public.disputes enable row level security;
drop policy if exists disputes_read on public.disputes;
create policy disputes_read on public.disputes for select to authenticated using (is_admin() or opened_by = auth.uid());
revoke all on public.disputes from public, anon, authenticated;
grant select on public.disputes to authenticated;
grant all on public.disputes to service_role;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'refund_requests_dispute_fk') then
    alter table public.refund_requests add constraint refund_requests_dispute_fk foreign key (dispute_id) references public.disputes(id);
  end if;
  if to_regprocedure('public.audit_trigger()') is not null then
    if not exists (select 1 from pg_trigger where tgname = 't_audit_refund_requests') then
      create trigger t_audit_refund_requests after insert or update on public.refund_requests for each row execute function audit_trigger();
    end if;
    if not exists (select 1 from pg_trigger where tgname = 't_audit_disputes') then
      create trigger t_audit_disputes after insert or update on public.disputes for each row execute function audit_trigger();
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2. Kebijakan refund per fase
-- ---------------------------------------------------------------------
-- T5: refund yang SUDAH terjadi untuk satu pesanan = refund_requests done (selain late_payment) + refund saldo
-- jalur lama (cancel_order/merchant_update_order v2: wallet_transactions refund tanpa ref RF-/external_id pembayaran,
-- bukan refund tip) yang belum tercatat sebagai refund_requests (policy.path = cancel_wallet).
create or replace function public.order_refunds_done(p_order uuid)
returns bigint language sql stable security definer set search_path = public as $$
  select coalesce((select sum(r.amount) from refund_requests r where r.order_id = p_order and r.status = 'done' and coalesce(r.reason, '') <> 'late_payment'), 0)
       + greatest(0,
           coalesce((select sum(t.amount) from wallet_transactions t join orders o on o.id = t.order_id
                      where t.order_id = p_order and t.user_id = o.customer_id and t.type = 'refund'
                        and (t.ref is null or (t.ref not like 'RF-%' and not exists (select 1 from payments x where x.external_id = t.ref)))
                        and coalesce(t.note, '') not ilike 'Refund tip%'), 0)
           - coalesce((select sum(r.amount) from refund_requests r where r.order_id = p_order and r.status = 'done' and r.policy->>'path' = 'cancel_wallet'), 0))::bigint;
$$;
revoke all on function public.order_refunds_done(uuid) from public, anon, authenticated;

create or replace function public.refund_policy_calc(p_order uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare o orders; v_paid bigint := 0; v_phase text; S bigint; F bigint; Fd bigint; PF bigint; SF bigint; X bigint; T bigint; D bigint; pgc bigint;
  d_items bigint := 0; d_fare bigint; items_ok boolean; fare_ok boolean; v_purchased boolean; lines jsonb := '[]'::jsonb;
  v_ref bigint := 0; v_non bigint := 0; v_done bigint := 0; v_pend bigint := 0; v_prov text; ln jsonb;
begin
  select * into o from orders where id = p_order;
  if not found then raise exception 'Pesanan tidak ditemukan'; end if;
  if auth.uid() is not null and not coalesce(is_admin(), false) and o.customer_id <> auth.uid() then raise exception 'Pesanan tidak ditemukan'; end if;
  S := coalesce(o.items_subtotal, 0); Fd := coalesce(o.fare_delivery, 0); F := Fd + coalesce(o.intercity_fare, 0);
  PF := coalesce(o.platform_fee, 0); SF := coalesce(o.service_fee, 0); X := coalesce(o.extras_total, 0); T := coalesce(o.tip, 0); D := coalesce(o.discount, 0);
  pgc := case when o.pg_fee_borne_by = 'customer' then coalesce(o.pg_fee, 0) + coalesce(o.pg_fee_ppn, 0) else 0 end;
  if o.payment_status in ('paid', 'refunded') then v_paid := coalesce(o.total, 0) + T; end if;
  v_purchased := o.service in ('shop', 'market') and (o.actual_items is not null or o.receipt_url is not null);
  v_phase := case when o.status in ('in_progress', 'completed') then 'picked_up'
                  when o.service = 'food' and coalesce(o.merchant_status::text, 'pending') not in ('pending', 'rejected') then 'processed'
                  when v_purchased then 'processed'
                  else 'before_accept' end;
  items_ok := v_phase = 'before_accept';
  fare_ok := v_phase <> 'picked_up';
  if o.service = 'food' and S + Fd > 0 then d_items := floor(D * S::numeric / (S + Fd))::bigint; end if;
  d_fare := D - d_items;
  select provider into v_prov from payments where order_id = o.id and purpose = 'order' and pay_status not in ('PENDING','FAILED','EXPIRED') order by paid_at desc nulls last limit 1;
  lines := jsonb_build_array(
    jsonb_build_object('key', 'items', 'label', 'Harga barang', 'amount', S - d_items, 'refundable', items_ok,
      'reason', case when items_ok then 'merchant/driver belum memproses' when o.service = 'food' then 'merchant sudah memproses pesanan' else 'barang sudah dibeli driver' end),
    jsonb_build_object('key', 'delivery', 'label', case when o.service in ('ride_motor', 'ride_car') then 'Tarif perjalanan' else 'Ongkir' end, 'amount', F - d_fare, 'refundable', fare_ok,
      'reason', case when fare_ok then 'driver belum mengambil pesanan' else 'driver sudah mengambil/mengantar' end),
    jsonb_build_object('key', 'platform_fee', 'label', 'Biaya platform AntarKita', 'amount', PF, 'refundable', true, 'reason', 'biaya platform selalu dikembalikan'));
  if SF <> 0 then lines := lines || jsonb_build_object('key', 'service_fee', 'label', 'Biaya jasa belanja', 'amount', SF, 'refundable', not v_purchased,
      'reason', case when v_purchased then 'jasa belanja sudah dikerjakan' else 'belum berbelanja' end); end if;
  if X <> 0 then lines := lines || jsonb_build_object('key', 'extras', 'label', 'Biaya tambahan', 'amount', X, 'refundable', fare_ok, 'reason', 'mengikuti ongkir'); end if;
  if T <> 0 then lines := lines || jsonb_build_object('key', 'tip', 'label', 'Tip driver', 'amount', T, 'refundable', true, 'reason', 'tip dikembalikan bila pesanan batal'); end if;
  if pgc <> 0 then lines := lines || jsonb_build_object('key', 'payment_fee', 'label', 'Biaya metode pembayaran (' || payment_provider_label(coalesce(v_prov, payment_provider_active())) || ')',
      'amount', pgc, 'refundable', false, 'reason', 'biaya provider tidak dikembalikan provider'); end if;
  for ln in select * from jsonb_array_elements(lines) loop
    if (ln->>'refundable')::boolean then v_ref := v_ref + (ln->>'amount')::bigint; else v_non := v_non + (ln->>'amount')::bigint; end if;
  end loop;
  if v_paid = 0 then v_ref := 0; v_non := 0; end if;
  v_done := order_refunds_done(o.id);   -- T5: refund_requests + refund saldo jalur pembatalan
  select coalesce(sum(amount) filter (where status in ('requested','approved','executing')), 0)
    into v_pend from refund_requests where order_id = o.id and coalesce(reason, '') <> 'late_payment';
  return jsonb_build_object('order_id', o.id, 'code', o.code, 'status', o.status, 'phase', v_phase, 'paid', v_paid,
    'refundable', v_ref, 'non_refundable', v_non, 'already_refunded', v_done, 'pending_refund', v_pend,
    'remaining_refundable', greatest(0, v_ref - v_done - v_pend), 'lines', lines,
    'note', case v_phase when 'before_accept' then 'Sebelum merchant/driver memproses: seluruh pembayaran dikembalikan (kecuali biaya metode pembayaran yang dibebankan ke pelanggan).'
                         when 'processed' then 'Pesanan sudah diproses: harga barang tidak dikembalikan; ongkir & biaya platform dikembalikan.'
                         else 'Driver sudah mengambil/mengantar: hanya biaya platform (dan tip) yang dikembalikan.' end);
end $$;
revoke all on function public.refund_policy_calc(uuid) from public, anon;
grant execute on function public.refund_policy_calc(uuid) to authenticated, service_role;
comment on function public.refund_policy_calc(uuid) is
  'Finpay v3 §4: {refundable, non_refundable, lines:[{key,label,amount,refundable,reason}], phase, paid, already_refunded, pending_refund, remaining_refundable} — dipakai UI pelanggan & admin.';

create or replace function public.receipt_refundable_note(o orders)
returns text language plpgsql stable security definer set search_path = public as $$
declare j jsonb;
begin
  j := refund_policy_calc(o.id);
  return (j->>'note') || ' Dapat dikembalikan: ' || coalesce((select string_agg(x->>'label', ', ') from jsonb_array_elements(j->'lines') x where (x->>'refundable')::boolean), '-')
      || '. Tidak dikembalikan: ' || coalesce((select string_agg(x->>'label', ', ') from jsonb_array_elements(j->'lines') x where not (x->>'refundable')::boolean and (x->>'amount')::bigint <> 0), '-') || '.';
end $$;
revoke all on function public.receipt_refundable_note(orders) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. Efek refund selesai (uang, pembayaran, pesanan, buku besar) — idempoten per order
-- ---------------------------------------------------------------------
create or replace function public.refund_apply_effects(p_refund uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r refund_requests; o orders; p payments; v_done_pay bigint; v_rtot bigint; pol jsonb; v_items_ok boolean; v_items bigint; m_amt bigint := 0; v_amt bigint := 0;
  v_rest bigint; rows jsonb; v_owner uuid; v_ctx jsonb; agg record; base bigint; a bigint := 0; b bigint := 0; v bigint := 0; pt bigint := 0; c bigint;
  v_already bigint; v_fee_pct numeric;
begin
  select * into r from refund_requests where id = p_refund;
  if r.status <> 'done' then raise exception 'refund_apply_effects: refund % belum done', p_refund; end if;
  if r.order_id is not null then select * into o from orders where id = r.order_id for update; end if;
  if r.payment_id is not null then select * into p from payments where id = r.payment_id for update; end if;
  -- (1) dana ke pelanggan (saldo) — gateway sudah dieksekusi provider (pay-refund)
  if r.destination = 'wallet' and not exists (select 1 from wallet_transactions where ref = 'RF-' || r.id::text) then
    perform wallet_apply(coalesce(o.customer_id, p.user_id), 'refund', r.amount, r.order_id,
      'Refund ' || coalesce(o.code, 'pembayaran') || ' (' || r.kind || ')' || coalesce(' — ' || r.reason, ''), 'RF-' || r.id::text);
  end if;
  -- (2) pembayaran
  if p.id is not null then
    select coalesce(sum(amount), 0) into v_done_pay from refund_requests where payment_id = p.id and status = 'done';
    update payments set refunded_amount = least(amount, greatest(refunded_amount, v_done_pay)),
      pay_status = case when least(amount, greatest(refunded_amount, v_done_pay)) >= amount then 'REFUNDED' else 'PARTIALLY_REFUNDED' end
     where id = p.id;
  end if;
  if r.reason = 'late_payment' or o.id is null then return jsonb_build_object('refund_id', r.id, 'ledger', false); end if;

  -- (3) buku besar & mitra
  select coalesce(sum(amount), 0) into v_rtot from refund_requests where order_id = o.id and status = 'done' and coalesce(reason, '') <> 'late_payment';
  select owner_id into v_owner from merchants where id = o.merchant_id;
  v_ctx := jsonb_build_object('service', o.service, 'city_id', o.city_id, 'city', o.city, 'pg_channel', o.pg_channel, 'payment_id', p.id);
  if o.status = 'cancelled' then
    pol := refund_policy_calc(o.id);
    select (x->>'refundable')::boolean, (x->>'amount')::bigint into v_items_ok, v_items from jsonb_array_elements(pol->'lines') x where x->>'key' = 'items';
    if not coalesce(v_items_ok, true) and coalesce(v_items, 0) > 0 then
      if o.service = 'food' and v_owner is not null then
        v_fee_pct := coalesce(o.merchant_fee_pct_snap, 0);
        m_amt := v_items - floor(v_items * v_fee_pct / 100.0)::bigint;   -- merchant menerima harga barang − fee platform
      elsif o.service in ('shop', 'market') and o.driver_id is not null then
        v_amt := v_items;                                                -- penggantian belanja yang sudah dibayar driver
      end if;
    end if;
    v_rest := (o.total + coalesce(o.tip, 0)) - v_rtot - m_amt - v_amt;
    rows := jsonb_build_array(jsonb_build_object('entry', 'refund', 'amount', -v_rtot, 'party_role', 'customer', 'party_id', o.customer_id, 'note', 'refund ' || o.code || ' (refund_requests)'));
    if m_amt <> 0 then rows := rows || jsonb_build_object('entry', 'merchant_payable', 'amount', -m_amt, 'party_role', 'merchant', 'party_id', v_owner, 'note', 'kompensasi barang yang sudah diproses (tidak dikembalikan)'); end if;
    if v_amt <> 0 then rows := rows || jsonb_build_object('entry', 'vendor_payable', 'amount', -v_amt, 'party_role', 'vendor', 'party_id', o.driver_id, 'note', 'penggantian belanja yang sudah dibeli driver'); end if;
    if v_rest <> 0 then rows := rows || jsonb_build_object('entry', 'platform_revenue', 'amount', v_rest, 'party_role', 'platform', 'note', 'bagian tidak dikembalikan (kebijakan refund: fee/biaya metode pembayaran)'); end if;
    perform ledger_apply_set('orders', o.id, o.id, 'refunded', rows, v_ctx);
    update orders set payment_status = 'refunded' where id = o.id and payment_status <> 'refunded';
    -- saldo mitra = selisih target − yang sudah dikreditkan (idempoten)
    if v_owner is not null then
      select coalesce(sum(amount), 0) into v_already from wallet_transactions where ref = 'RFM-' || o.id::text and user_id = v_owner;
      if m_amt - v_already <> 0 then perform wallet_apply(v_owner, 'earning', m_amt - v_already, o.id, 'Kompensasi barang pesanan batal ' || o.code, 'RFM-' || o.id::text); end if;
    end if;
    if o.driver_id is not null then
      select coalesce(sum(amount), 0) into v_already from wallet_transactions where ref = 'RFV-' || o.id::text and user_id = o.driver_id;
      if v_amt - v_already <> 0 then perform wallet_apply(o.driver_id, 'earning', v_amt - v_already, o.id, 'Penggantian belanja pesanan batal ' || o.code, 'RFV-' || o.id::text); end if;
    end if;
  elsif o.status = 'completed' then
    select coalesce(-sum(amount) filter (where entry = 'driver_payable'), 0) as d, coalesce(-sum(amount) filter (where entry = 'merchant_payable'), 0) as m,
           coalesce(-sum(amount) filter (where entry = 'vendor_payable'), 0) as v, coalesce(-sum(amount) filter (where entry = 'partner_payable'), 0) as pt,
           coalesce(sum(amount) filter (where entry = 'platform_revenue'), 0) as rv
      into agg from order_ledger where order_id = o.id and source = 'orders' and phase = 'completed';
    base := agg.d + agg.m + agg.v + agg.pt + agg.rv;
    if o.payment_method = 'wallet' and base > 0 and agg.d >= 0 and agg.m >= 0 then
      a := floor(v_rtot * agg.d::numeric / base)::bigint; b := floor(v_rtot * agg.m::numeric / base)::bigint;
      v := floor(v_rtot * agg.v::numeric / base)::bigint; pt := floor(v_rtot * agg.pt::numeric / base)::bigint;
    end if;
    c := v_rtot - a - b - v - pt;
    rows := jsonb_build_array(jsonb_build_object('entry', 'refund', 'amount', -v_rtot, 'party_role', 'customer', 'party_id', o.customer_id, 'note', 'refund sesudah selesai ' || o.code));
    if a <> 0 then rows := rows || jsonb_build_object('entry', 'driver_payable', 'amount', a, 'party_role', 'driver', 'party_id', o.driver_id, 'note', 'pembalikan pro-rata'); end if;
    if b <> 0 then rows := rows || jsonb_build_object('entry', 'merchant_payable', 'amount', b, 'party_role', 'merchant', 'party_id', v_owner, 'note', 'pembalikan pro-rata'); end if;
    if v <> 0 then rows := rows || jsonb_build_object('entry', 'vendor_payable', 'amount', v, 'party_role', 'vendor', 'party_id', o.driver_id, 'note', 'pembalikan pro-rata'); end if;
    if pt <> 0 then rows := rows || jsonb_build_object('entry', 'partner_payable', 'amount', pt, 'party_role', 'partner', 'party_id', o.travel_partner_id, 'note', 'pembalikan pro-rata'); end if;
    if c <> 0 then rows := rows || jsonb_build_object('entry', 'platform_revenue', 'amount', -c, 'party_role', 'platform', 'note', 'pembalikan pro-rata'); end if;
    perform ledger_apply_set('orders', o.id, o.id, 'refunded', rows, v_ctx);
    if v_rtot >= o.total + coalesce(o.tip, 0) then update orders set payment_status = 'refunded' where id = o.id; end if;
    -- koreksi saldo mitra sebesar pembalikan (selisih terhadap koreksi sebelumnya)
    if o.driver_id is not null then
      select coalesce(-sum(amount), 0) into v_already from wallet_transactions where ref = 'RFC-' || o.id::text || '-d' and user_id = o.driver_id;
      if a + v - v_already <> 0 then perform wallet_apply(o.driver_id, 'adjustment', -(a + v - v_already), o.id, 'Koreksi refund pesanan ' || o.code, 'RFC-' || o.id::text || '-d'); end if;
    end if;
    if v_owner is not null then
      select coalesce(-sum(amount), 0) into v_already from wallet_transactions where ref = 'RFC-' || o.id::text || '-m' and user_id = v_owner;
      if b - v_already <> 0 then perform wallet_apply(v_owner, 'adjustment', -(b - v_already), o.id, 'Koreksi refund pesanan ' || o.code, 'RFC-' || o.id::text || '-m'); end if;
    end if;
    if o.travel_partner_id is not null then
      select coalesce(-sum(amount), 0) into v_already from wallet_transactions where ref = 'RFC-' || o.id::text || '-p' and user_id = o.travel_partner_id;
      if pt - v_already <> 0 then perform wallet_apply(o.travel_partner_id, 'adjustment', -(pt - v_already), o.id, 'Koreksi refund pesanan ' || o.code, 'RFC-' || o.id::text || '-p'); end if;
    end if;
  else
    raise exception 'Refund hanya untuk pesanan batal/selesai (status %)', o.status;
  end if;
  insert into notifications (user_id, kind, title, body, data) values (o.customer_id, 'order', 'Refund selesai',
    'Refund Rp' || to_char(r.amount, 'FM999G999G999') || ' untuk ' || o.code || case when r.destination = 'wallet' then ' masuk ke saldo AntarPay.' else ' dikembalikan ke metode pembayaran asal.' end,
    jsonb_build_object('order_id', o.id, 'refund_id', r.id));
  return jsonb_build_object('refund_id', r.id, 'ledger', true, 'refund_total', v_rtot, 'merchant_retained', m_amt, 'vendor_retained', v_amt);
end $$;
revoke all on function public.refund_apply_effects(uuid) from public, anon, authenticated;

-- eksekusi langsung tujuan saldo; tujuan gateway menunggu pay-refund
create or replace function public.refund_approval_apply(p_refund uuid, p_approval uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r refund_requests;
begin
  select * into r from refund_requests where id = p_refund for update;
  if not found then raise exception 'Refund tidak ditemukan'; end if;
  if r.status <> 'requested' then return to_jsonb(r); end if;
  if r.maker = auth.uid() then raise exception 'DUAL_APPROVAL: checker harus admin lain (bukan maker)'; end if;
  update refund_requests set status = 'approved', checker = auth.uid(), decided_at = now(), approval_id = coalesce(p_approval, approval_id)
   where id = r.id returning * into r;
  if r.destination = 'wallet' then
    update refund_requests set status = 'done', executed_at = now() where id = r.id returning * into r;
    perform refund_apply_effects(r.id);
  end if;
  return to_jsonb(r);
end $$;
revoke all on function public.refund_approval_apply(uuid, uuid) from public, anon, authenticated;

create or replace function public.refund_approval_reject(p_refund uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare r refund_requests;
begin
  update refund_requests set status = 'rejected', checker = coalesce(checker, auth.uid()), decided_at = now(), note = coalesce(p_note, note)
   where id = p_refund and status in ('requested', 'approved') returning * into r;
  if r.payment_id is not null then
    update payments set pay_status = case when refunded_amount > 0 then 'PARTIALLY_REFUNDED' else 'PAID' end
     where id = r.payment_id and pay_status = 'REFUND_REQUESTED'
       and not exists (select 1 from refund_requests x where x.payment_id = r.payment_id and x.status in ('requested','approved','executing'));
  end if;
end $$;
revoke all on function public.refund_approval_reject(uuid, text) from public, anon, authenticated;

-- pembuatan refund internal (pelanggan/admin/sistem/sengketa)
create or replace function public.refund_create_internal(p_order uuid, p_amount bigint, p_reason text, p_source text, p_by uuid, p_destination text default null, p_dispute uuid default null)
returns refund_requests language plpgsql security definer set search_path = public as $$
declare o orders; p payments; pol jsonb; v_amt bigint; v_rem bigint; r refund_requests; v_dest text; v_paid bigint;
begin
  select * into o from orders where id = p_order for update;
  if not found then raise exception 'Pesanan tidak ditemukan'; end if;
  select * into p from payments where order_id = o.id and purpose = 'order' and pay_status in ('PAID','REFUND_REQUESTED','PARTIALLY_REFUNDED','DISPUTED')
   order by paid_at desc nulls last limit 1;
  pol := refund_policy_calc(o.id);
  v_paid := (pol->>'paid')::bigint;
  if v_paid <= 0 then raise exception 'Pesanan % belum dibayar — tidak ada dana untuk direfund', o.code; end if;
  -- pelanggan dibatasi kebijakan; admin/sengketa dibatasi yang dibayar
  v_rem := case when p_source in ('customer', 'system') then (pol->>'remaining_refundable')::bigint
                else v_paid - (pol->>'already_refunded')::bigint - (pol->>'pending_refund')::bigint end;
  v_amt := coalesce(p_amount, v_rem);
  if v_amt is null or v_amt <= 0 then raise exception 'Tidak ada sisa yang bisa direfund untuk %', o.code; end if;
  if v_amt > v_rem then raise exception 'Nominal refund Rp% melebihi sisa yang bisa direfund Rp%', v_amt, v_rem; end if;
  v_dest := coalesce(p_destination, case when p.id is not null then 'gateway' else 'wallet' end);
  if v_dest = 'gateway' and p.id is null then raise exception 'Pesanan tidak dibayar lewat gateway — refund hanya ke saldo'; end if;
  insert into refund_requests (order_id, payment_id, requested_by, amount, kind, reason, destination, source, dispute_id, policy, maker)
  values (o.id, p.id, p_by, v_amt, case when v_amt >= v_paid then 'full' else 'partial' end, p_reason, v_dest, p_source, p_dispute, pol,
          case when p_source in ('admin', 'dispute') then p_by end)
  returning * into r;
  if p.id is not null then update payments set pay_status = 'REFUND_REQUESTED' where id = p.id and pay_status in ('PAID', 'PARTIALLY_REFUNDED'); end if;
  perform log_activity('refund.requested', 'refund_requests', r.id::text,
    'Refund ' || r.kind || ' Rp' || r.amount || ' untuk ' || o.code || ' (' || p_source || ', tujuan ' || v_dest || ')', jsonb_build_object('refund', to_jsonb(r)));
  return r;
end $$;
revoke all on function public.refund_create_internal(uuid, bigint, text, text, uuid, text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. RPC refund
-- ---------------------------------------------------------------------
create or replace function public.refund_request(p_order uuid, p_amount bigint default null, p_reason text default null)
returns refund_requests language plpgsql security definer set search_path = public as $$
declare o orders; r refund_requests;
begin
  if auth.uid() is null then raise exception 'Harus login'; end if;
  select * into o from orders where id = p_order;
  if not found or o.customer_id <> auth.uid() then raise exception 'Pesanan tidak ditemukan'; end if;
  if o.status <> 'cancelled' then raise exception 'Refund hanya untuk pesanan yang dibatalkan/ditolak (status %). Untuk pesanan selesai, ajukan sengketa.', o.status; end if;
  if o.payment_status = 'refunded' then raise exception 'Pesanan % sudah direfund', o.code; end if;
  if o.payment_status <> 'paid' then raise exception 'Pesanan % belum dibayar — tidak ada yang direfund', o.code; end if;
  -- idempoten: permintaan terbuka tanpa nominal baru → kembalikan yang ada; S3: dengan nominal baru → ditolak (satu terbuka per pesanan)
  select * into r from refund_requests where order_id = o.id and status in ('requested', 'approved', 'executing') and coalesce(reason, '') <> 'late_payment'
   order by created_at desc limit 1;
  if found then
    if p_amount is null then return r; end if;
    raise exception 'REFUND_OPEN: masih ada permintaan refund Rp% (%) untuk % — tunggu selesai sebelum mengajukan lagi', r.amount, r.status, o.code;
  end if;
  return refund_create_internal(o.id, p_amount, coalesce(nullif(btrim(p_reason), ''), 'permintaan pelanggan'), 'customer', auth.uid(), null, null);
end $$;
revoke all on function public.refund_request(uuid, bigint, text) from public, anon;
grant execute on function public.refund_request(uuid, bigint, text) to authenticated;
comment on function public.refund_request(uuid, bigint, text) is
  'Finpay v3 §4 (pelanggan): refund pesanan yang dibatalkan/ditolak & sudah PAID. p_amount null = sisa yang bisa direfund menurut refund_policy_calc. Idempoten.';

create or replace function public.admin_refund_requests(p_status text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_st text := nullif(nullif(lower(trim(coalesce(p_status, ''))), ''), 'all');
begin
  perform admin_require('payments_view');
  return coalesce((select jsonb_agg(to_jsonb(r) || jsonb_build_object('order_code', o.code, 'customer', pc.full_name, 'maker_name', pm.full_name,
        'checker_name', pk.full_name, 'support_ref', p.support_ref, 'provider', p.provider,
        'needs_checker', r.status = 'requested' and r.maker is not null,
        'dual_approval', r.amount >= setting_num('refund_dual_approval_min', 200000)) order by r.created_at desc)
    from refund_requests r left join orders o on o.id = r.order_id left join payments p on p.id = r.payment_id
    left join profiles pc on pc.id = o.customer_id left join profiles pm on pm.id = r.maker left join profiles pk on pk.id = r.checker
    where v_st is null or r.status = v_st), '[]'::jsonb);
end $$;
revoke all on function public.admin_refund_requests(text) from public, anon;
grant execute on function public.admin_refund_requests(text) to authenticated;

-- S3: nilai refund kumulatif pesanan (selain refund otomatis pembatalan & late_payment), termasuk p_refund
create or replace function public.refund_order_cumulative(p_order uuid, p_refund uuid)
returns bigint language sql stable security definer set search_path = public as $$
  select coalesce(sum(r.amount), 0)::bigint from refund_requests r
   where r.order_id = p_order and coalesce(r.reason, '') <> 'late_payment' and coalesce(r.policy->>'path', '') <> 'cancel_wallet'
     and (r.id = p_refund or r.status in ('requested', 'approved', 'executing', 'done'));
$$;
revoke all on function public.refund_order_cumulative(uuid, uuid) from public, anon, authenticated;

create or replace function public.admin_refund_approve(p_id uuid)
returns refund_requests language plpgsql security definer set search_path = public as $$
declare r refund_requests; v_min bigint := setting_num('refund_dual_approval_min', 200000)::bigint; ap approval_requests;
begin
  perform admin_require('refund');
  perform admin_require_unlock();
  select * into r from refund_requests where id = p_id for update;
  if not found then raise exception 'Refund tidak ditemukan'; end if;
  if r.status <> 'requested' then raise exception 'Refund sudah %', r.status; end if;
  if r.maker is not null and r.maker <> auth.uid() then
    raise exception 'Refund ini sudah disetujui maker lain — gunakan admin_refund_confirm (checker)';
  end if;
  update refund_requests set maker = auth.uid(), decided_at = now() where id = r.id returning * into r;
  -- S3: ambang dual approval KUMULATIF per pesanan (memecah refund tidak melewati checker)
  if r.amount >= v_min or (r.order_id is not null and refund_order_cumulative(r.order_id, r.id) >= v_min) then
    -- dual approval: tunggu checker ≠ maker
    select * into ap from approval_requests where kind = 'refund' and ref_id = r.id and status = 'pending';
    if ap.id is null then
      insert into approval_requests (kind, ref_id, payload, amount, maker, note)
      values ('refund', r.id, jsonb_build_object('order_id', r.order_id, 'amount', r.amount, 'destination', r.destination), r.amount, auth.uid(),
              'refund ≥ Rp' || v_min || ' butuh admin kedua') returning * into ap;
      update refund_requests set approval_id = ap.id where id = r.id returning * into r;
    end if;
    perform log_activity('refund.maker_approved', 'refund_requests', r.id::text, 'Refund Rp' || r.amount || ' disetujui maker, menunggu checker', jsonb_build_object('approval_id', ap.id));
  else
    update refund_requests set status = 'approved', decided_at = now() where id = r.id returning * into r;
    if r.destination = 'wallet' then
      update refund_requests set status = 'done', executed_at = now() where id = r.id returning * into r;
      perform refund_apply_effects(r.id);
    end if;
    perform log_activity('refund.approved', 'refund_requests', r.id::text, 'Refund Rp' || r.amount || ' disetujui (' || r.destination || ')', jsonb_build_object('refund', to_jsonb(r)));
  end if;
  select * into r from refund_requests where id = r.id;
  return r;
end $$;
revoke all on function public.admin_refund_approve(uuid) from public, anon;
grant execute on function public.admin_refund_approve(uuid) to authenticated;

create or replace function public.admin_refund_confirm(p_id uuid)
returns refund_requests language plpgsql security definer set search_path = public as $$
declare r refund_requests; ap approval_requests;
begin
  perform admin_require('refund');
  perform admin_require_unlock();
  select * into r from refund_requests where id = p_id for update;
  if not found then raise exception 'Refund tidak ditemukan'; end if;
  if r.status <> 'requested' or r.maker is null then raise exception 'Refund belum disetujui maker (status %)', r.status; end if;
  if r.maker = auth.uid() then raise exception 'DUAL_APPROVAL: maker tidak boleh menjadi checker refund yang sama'; end if;
  select * into ap from approval_requests where kind = 'refund' and ref_id = r.id and status = 'pending' for update;
  if ap.id is not null then
    if ap.expires_at <= now() then   -- R2
      raise exception 'APPROVAL_EXPIRED: permintaan persetujuan refund kedaluwarsa % — maker perlu mengajukan ulang', ap.expires_at;
    end if;
    update approval_requests set status = 'approved', checker = auth.uid(), decided_at = now(), note = 'dikonfirmasi lewat admin_refund_confirm' where id = ap.id;
  end if;
  perform refund_approval_apply(r.id, ap.id);
  select * into r from refund_requests where id = r.id;
  perform log_activity('refund.checker_approved', 'refund_requests', r.id::text, 'Refund Rp' || r.amount || ' dikonfirmasi checker → ' || r.status,
    jsonb_build_object('refund', to_jsonb(r)));
  return r;
end $$;
revoke all on function public.admin_refund_confirm(uuid) from public, anon;
grant execute on function public.admin_refund_confirm(uuid) to authenticated;

create or replace function public.admin_refund_reject(p_id uuid, p_note text default null)
returns refund_requests language plpgsql security definer set search_path = public as $$
declare r refund_requests;
begin
  perform admin_require('refund');
  perform admin_require_unlock();
  select * into r from refund_requests where id = p_id for update;
  if not found then raise exception 'Refund tidak ditemukan'; end if;
  if r.status not in ('requested', 'approved') then raise exception 'Refund % tidak bisa ditolak', r.status; end if;
  if length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'Tulis alasan penolakan'; end if;
  update approval_requests set status = 'rejected', checker = case when maker <> auth.uid() then auth.uid() end, decided_at = now(), note = p_note
   where kind = 'refund' and ref_id = r.id and status = 'pending';
  perform refund_approval_reject(r.id, p_note);
  select * into r from refund_requests where id = r.id;
  perform log_activity('refund.rejected', 'refund_requests', r.id::text, 'Refund Rp' || r.amount || ' ditolak: ' || p_note, jsonb_build_object('refund', to_jsonb(r)));
  return r;
end $$;
revoke all on function public.admin_refund_reject(uuid, text) from public, anon;
grant execute on function public.admin_refund_reject(uuid, text) to authenticated;

-- edge pay-refund (service_role): klaim → eksekusi ke provider → hasil
create or replace function public.refund_claim(p_id uuid)
returns refund_requests language plpgsql security definer set search_path = public as $$
declare r refund_requests;
begin
  update refund_requests set status = 'executing' where id = p_id and status = 'approved' and destination = 'gateway' returning * into r;
  if not found then
    select * into r from refund_requests where id = p_id;
    raise exception 'Refund % tidak bisa dieksekusi (status %, tujuan %)', p_id, r.status, r.destination;
  end if;
  return r;
end $$;
revoke all on function public.refund_claim(uuid) from public, anon, authenticated;
grant execute on function public.refund_claim(uuid) to service_role;

create or replace function public.refund_execute_result(p_id uuid, p_ok boolean, p_provider_ref text, p_note text default null)
returns refund_requests language plpgsql security definer set search_path = public as $$
declare r refund_requests;
begin
  select * into r from refund_requests where id = p_id for update;
  if not found then raise exception 'Refund tidak ditemukan'; end if;
  if r.status = 'done' then return r; end if;   -- idempoten (webhook REFUNDED bisa datang lebih dulu)
  if r.status not in ('approved', 'executing') then raise exception 'Refund % belum disetujui (status %)', p_id, r.status; end if;
  if coalesce(p_ok, false) then
    update refund_requests set status = 'done', executed_at = now(), provider_ref = coalesce(nullif(btrim(p_provider_ref), ''), provider_ref),
      note = coalesce(p_note, note) where id = r.id returning * into r;
    perform refund_apply_effects(r.id);
  else
    update refund_requests set status = 'failed', executed_at = now(), provider_ref = coalesce(nullif(btrim(p_provider_ref), ''), provider_ref),
      note = coalesce(p_note, 'provider menolak refund') where id = r.id returning * into r;
    if r.payment_id is not null then
      update payments set pay_status = case when refunded_amount > 0 then 'PARTIALLY_REFUNDED' else 'PAID' end
       where id = r.payment_id and pay_status = 'REFUND_REQUESTED';
    end if;
  end if;
  perform log_activity('refund.' || r.status, 'refund_requests', r.id::text, 'Eksekusi refund Rp' || r.amount || ' → ' || r.status || coalesce(' (' || r.provider_ref || ')', ''),
    jsonb_build_object('refund', to_jsonb(r)));
  return r;
end $$;
revoke all on function public.refund_execute_result(uuid, boolean, text, text) from public, anon, authenticated;
grant execute on function public.refund_execute_result(uuid, boolean, text, text) to service_role;
comment on function public.refund_execute_result(uuid, boolean, text, text) is
  'Finpay v3 §4 (service_role, edge pay-refund): hasil eksekusi refund ke provider. ok → done + efek (refunded_amount, pay_status, orders, ledger pro-rata); gagal → failed. Idempoten.';

-- Adapter kompatibilitas edge pay-refund (Agen B memanggil 5 argumen: p_status 'executing'|'done'|'failed', p_raw).
-- Tanda tangan kontrak §4 tetap refund_execute_result(p_id, p_ok, p_provider_ref, p_note) di atas; nama argumen
-- berbeda (p_status/p_raw) sehingga PostgREST tidak ambigu.
create or replace function public.refund_execute_result(p_id uuid, p_status text, p_provider_ref text, p_raw jsonb, p_note text default null)
returns refund_requests language plpgsql security definer set search_path = public as $$
declare r refund_requests; v text := lower(btrim(coalesce(p_status, '')));
begin
  if v = 'executing' then   -- klaim atomik: HANYA dari approved (baris dikunci); sudah diklaim/selesai → RAISE
    select * into r from refund_requests where id = p_id for update;
    if not found then raise exception 'REFUND_NOT_FOUND: refund % tidak ditemukan', p_id; end if;
    if r.status in ('executing', 'done') then
      raise exception 'REFUND_ALREADY_CLAIMED: refund % sudah % — tidak dieksekusi dua kali', p_id, r.status;
    end if;
    if r.status <> 'approved' or r.destination <> 'gateway' then
      raise exception 'Refund % tidak bisa dieksekusi (status %, tujuan %)', p_id, r.status, r.destination;
    end if;
    update refund_requests set status = 'executing' where id = r.id returning * into r;
    return r;
  elsif v in ('done', 'failed') then
    return refund_execute_result(p_id, v = 'done', p_provider_ref, coalesce(p_note, p_raw->>'reason'));
  end if;
  raise exception 'p_status harus executing|done|failed';
end $$;
revoke all on function public.refund_execute_result(uuid, text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.refund_execute_result(uuid, text, text, jsonb, text) to service_role;

-- ---------------------------------------------------------------------
-- 5. Kait 0105: pembayaran terlambat & event provider
-- ---------------------------------------------------------------------
create or replace function public.payment_refund_auto(p_payment uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare p payments; o orders; r refund_requests; v_label text; v_dest text;
begin
  select * into p from payments where id = p_payment;
  if not found then return null; end if;
  if p.order_id is not null then select * into o from orders where id = p.order_id; end if;
  select * into r from refund_requests where payment_id = p.id and reason = 'late_payment' and status <> 'rejected';
  if found then return r.id; end if;   -- idempoten
  v_label := payment_channel_label(coalesce(p.pg_channel, p.method));
  -- AntarPay aktif → kembali ke saldo (closed-loop, perilaku v2); nonaktif → kembali lewat gateway (PKS 7.4b)
  v_dest := case when antarpay_enabled() then 'wallet' else 'gateway' end;
  insert into refund_requests (order_id, payment_id, requested_by, amount, kind, reason, destination, source, status, note, decided_at)
  values (p.order_id, p.id, p.user_id, p.amount, 'full', 'late_payment', v_dest, 'system',
          case when v_dest = 'wallet' then 'done' else 'requested' end, coalesce(p_reason, 'pembayaran terlambat'), now())
  returning * into r;
  if v_dest = 'wallet' then
    perform wallet_apply(p.user_id, 'refund', p.amount, p.order_id,
      'Refund pembayaran ' || coalesce(o.code, 'pesanan') || ' — ' || coalesce(p_reason, '-'), p.external_id);
    update wallet_transactions set pg_fee = p.pg_fee + p.pg_fee_ppn where ref = p.external_id and user_id = p.user_id and type = 'refund';
    update refund_requests set executed_at = now() where id = r.id;
    update payments set refunded_amount = amount, pay_status = 'REFUNDED', note = coalesce(note, 'late_paid') where id = p.id;
    insert into notifications (user_id, kind, title, body, data) values (p.user_id, 'system', 'Pembayaran dikembalikan ke saldo',
      'Rp' || to_char(p.amount, 'FM999G999G999') || ' via ' || v_label || ' diterima setelah ' || coalesce(o.code, 'pesanan') || ' tidak bisa diproses (' || coalesce(p_reason, '-') || '). Dana masuk ke saldo AntarPay Anda.',
      jsonb_build_object('payment_id', p.id, 'order_id', p.order_id, 'refund_id', r.id));
  else
    update payments set pay_status = 'REFUND_REQUESTED', note = coalesce(note, 'late_paid') where id = p.id;
    insert into notifications (user_id, kind, title, body, data) values (p.user_id, 'system', 'Pembayaran akan dikembalikan',
      'Rp' || to_char(p.amount, 'FM999G999G999') || ' via ' || v_label || ' diterima setelah ' || coalesce(o.code, 'pesanan') || ' tidak bisa diproses (' || coalesce(p_reason, '-') || '). Dana dikembalikan ke metode pembayaran asal setelah diverifikasi (kode ' || p.support_ref || ').',
      jsonb_build_object('payment_id', p.id, 'order_id', p.order_id, 'refund_id', r.id, 'support_ref', p.support_ref));
  end if;
  perform log_activity('refund.late_payment', 'refund_requests', r.id::text, 'Pembayaran terlambat ' || p.external_id || ' Rp' || p.amount || ' → refund ' || v_dest,
    jsonb_build_object('payment_id', p.id, 'reason', p_reason));
  return r.id;
end $$;
revoke all on function public.payment_refund_auto(uuid, text) from public, anon, authenticated;

create or replace function public.payment_hook_after_ingest(p_payment uuid, p_prev text, p_new text, p_amount bigint, p_raw jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare p payments; r refund_requests; v_done bigint; v_delta bigint; d disputes; v_rid uuid; v_pref text;
begin
  select * into p from payments where id = p_payment;
  if p_new in ('REFUNDED', 'PARTIALLY_REFUNDED') then
    -- S1: refund ditutup HANYA bila event menyebut refund_request_id kita atau provider_ref refund yang sama
    v_rid := case when coalesce(p_raw->>'refund_request_id', '') ~ '^[0-9a-f-]{36}$' then (p_raw->>'refund_request_id')::uuid end;
    v_pref := nullif(btrim(coalesce(p_raw->>'refund_id', p_raw->>'refundId', p_raw->>'refund_key', p_raw->'refunds'->-1->>'refund_key', '')), '');
    select * into r from refund_requests
     where payment_id = p.id and status in ('executing', 'approved') and destination = 'gateway'
       and ((v_rid is not null and id = v_rid) or (v_pref is not null and provider_ref = v_pref))
     order by created_at limit 1 for update;
    if found then
      update refund_requests set status = 'done', executed_at = now(), provider_ref = coalesce(provider_ref, v_pref)
       where id = r.id;
      perform refund_apply_effects(r.id);
      return 'refund_done:' || r.id;
    end if;
    if exists (select 1 from refund_requests where payment_id = p.id and status in ('executing', 'approved', 'requested')) then
      -- ada refund terbuka tetapi event tidak cocok → dicatat saja (payment_events), refund TIDAK ditutup
      update payments set note = 'needs_review: event refund provider tidak cocok dengan refund terbuka' where id = p.id;
      return 'refund_unmatched';
    end if;
    -- refund dilakukan langsung di dasbor provider → catat supaya buku besar & rekonsiliasi cocok
    select coalesce(sum(amount), 0) into v_done from refund_requests where payment_id = p.id and status = 'done';
    v_delta := p.refunded_amount - v_done;
    if v_delta > 0 and p.order_id is not null then
      insert into refund_requests (order_id, payment_id, requested_by, amount, kind, reason, destination, source, status, executed_at, decided_at, note)
      values (p.order_id, p.id, null, v_delta, case when p_new = 'REFUNDED' then 'full' else 'partial' end, 'provider_refund', 'gateway', 'provider', 'done', now(), now(),
              'refund tercatat dari notifikasi provider') returning * into r;
      begin perform refund_apply_effects(r.id);
      exception when others then update refund_requests set note = note || ' — efek buku besar gagal: ' || left(sqlerrm, 120) where id = r.id; end;
      return 'refund_recorded:' || r.id;
    end if;
    return 'refund_no_match';
  elsif p_new = 'DISPUTED' then
    if not exists (select 1 from disputes where payment_id = p.id and kind = 'chargeback' and status in ('open', 'investigating')) then
      insert into disputes (order_id, payment_id, opened_by, party_role, kind, amount, description)
      values (p.order_id, p.id, p.user_id, 'customer', 'chargeback', coalesce(p_amount, p.amount), 'Chargeback/sengketa dari provider ' || p.provider)
      returning * into d;
      insert into order_ledger (order_id, source, source_id, entry, amount, party_role, party_id, phase, note, payment_id)
      values (p.order_id, 'disputes', d.id, 'dispute', -d.amount, 'customer', p.user_id, 'adjusted', 'chargeback dibuka', p.id);
      return 'dispute_opened:' || d.id;
    end if;
    return 'dispute_exists';
  end if;
  return null;
end $$;
revoke all on function public.payment_hook_after_ingest(uuid, text, text, bigint, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 6. Pembatalan pesanan gateway yang sudah PAID saat AntarPay nonaktif → refund_requests (bukan saldo)
-- ---------------------------------------------------------------------
create or replace function public.refund_via_request(o orders)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(o.payment_status::text = 'paid', false)
     and coalesce(o.pg_channel, payment_channel_of(o.paid_via)) = any (payment_gateway_channel_keys())
     and not antarpay_enabled()
     and exists (select 1 from payments x where x.order_id = o.id and x.purpose = 'order' and x.pay_status in ('PAID','PARTIALLY_REFUNDED','REFUND_REQUESTED','DISPUTED'));
$$;
revoke all on function public.refund_via_request(orders) from public, anon, authenticated;

create or replace function public.refund_auto_on_cancel(p_order uuid, p_by uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare r refund_requests; o orders;
begin
  select * into o from orders where id = p_order;
  if exists (select 1 from refund_requests where order_id = p_order and status in ('requested','approved','executing','done') and coalesce(reason, '') <> 'late_payment') then return null; end if;
  begin
    r := refund_create_internal(p_order, null, coalesce(nullif(btrim(p_reason), ''), 'pesanan dibatalkan'), 'system', p_by, 'gateway', null);
  exception when others then
    insert into order_events (order_id, status, actor_id, note) values (p_order, 'note', p_by, 'Refund otomatis belum dibuat: ' || left(sqlerrm, 150));
    return null;
  end;
  insert into order_events (order_id, status, actor_id, note) values (p_order, 'refund_requested', p_by,
    'Refund Rp' || r.amount || ' (' || r.kind || ') diajukan ke metode pembayaran asal — menunggu verifikasi admin');
  insert into notifications (user_id, kind, title, body, data) values (o.customer_id, 'order', 'Refund diajukan',
    'Pesanan ' || o.code || ' dibatalkan. Refund Rp' || to_char(r.amount, 'FM999G999G999') || ' diproses ke metode pembayaran asal (kode ' || coalesce(o.payment_support_ref, '-') || ').',
    jsonb_build_object('order_id', o.id, 'refund_id', r.id));
  return r.id;
end $$;
revoke all on function public.refund_auto_on_cancel(uuid, uuid, text) from public, anon, authenticated;

-- T5: refund ke SALDO saat pembatalan (AntarPay aktif / bayar saldo) tercatat sebagai refund_requests (done, wallet,
-- policy.path = cancel_wallet) + payments.refunded_amount/pay_status — supaya refund_policy_calc/sengketa tidak
-- mengembalikan dana yang sama lagi lewat gateway. Uang & buku besar tetap oleh cancel_order (tidak dijalankan ulang).
create or replace function public.refund_record_wallet(p_order uuid, p_by uuid, p_amount bigint, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare o orders; p payments; r refund_requests;
begin
  if coalesce(p_amount, 0) <= 0 then return null; end if;
  select * into o from orders where id = p_order;
  if not found then return null; end if;
  select * into p from payments where order_id = o.id and purpose = 'order' and pay_status in ('PAID','REFUND_REQUESTED','PARTIALLY_REFUNDED','DISPUTED')
   order by paid_at desc nulls last limit 1 for update;
  insert into refund_requests (order_id, payment_id, requested_by, amount, kind, reason, destination, source, status, decided_at, executed_at, note, policy)
  values (o.id, p.id, p_by, p_amount, case when p_amount >= o.total then 'full' else 'partial' end, coalesce(nullif(btrim(p_reason), ''), 'pesanan dibatalkan'),
          'wallet', 'system', 'done', now(), now(), 'refund saldo otomatis saat pembatalan (dana sudah dikreditkan cancel_order/merchant_update_order)',
          jsonb_build_object('path', 'cancel_wallet'))
  returning * into r;
  if p.id is not null then
    update payments set refunded_amount = least(amount, refunded_amount + p_amount),
      pay_status = case when least(amount, refunded_amount + p_amount) >= amount then 'REFUNDED' else 'PARTIALLY_REFUNDED' end,
      note = coalesce(note, 'refund saldo saat pembatalan')
     where id = p.id;
  end if;
  return r.id;
end $$;
revoke all on function public.refund_record_wallet(uuid, uuid, bigint, text) from public, anon, authenticated;

select _v3_splice('0108', 'public.cancel_order(uuid,text)',
  $a$payment_status = case when payment_status = 'paid' then 'refunded' else payment_status end$a$,
  $a$payment_status = case when payment_status = 'paid' and not refund_via_request(o) then 'refunded' else payment_status end   /* 0108 refund gateway */$a$,
  '0108 refund gateway');
select _v3_splice('0108', 'public.cancel_order(uuid,text)',
  $a$  if order_payment_pending(o) then   -- 0104 belum lunas: belum ada dana masuk → tidak ada refund$a$,
  $a$  if refund_via_request(o) then perform refund_auto_on_cancel(o.id, v_uid, coalesce(p_reason, 'pesanan dibatalkan')); end if;   -- 0108 AntarPay nonaktif: refund lewat gateway
  if order_payment_pending(o) then   -- 0104 belum lunas: belum ada dana masuk → tidak ada refund$a$,
  '0108 AntarPay nonaktif');
select _v3_splice('0108', 'public.cancel_order(uuid,text)',
  $a$  if v_tip > 0 then
    perform wallet_apply(o.customer_id, 'refund', v_tip, o.id, 'Refund tip pesanan dibatalkan ' || o.code);$a$,
  $a$  if o.payment_status = 'refunded' then   -- 0108 T5: refund saldo tercatat di refund_requests + payments
    perform refund_record_wallet(o.id, v_uid, o.total - case when v_belanja > 0 and o.driver_id is not null then v_belanja else 0 end, coalesce(p_reason, 'pesanan dibatalkan'));
  end if;
  if v_tip > 0 then
    perform wallet_apply(o.customer_id, 'refund', v_tip, o.id, 'Refund tip pesanan dibatalkan ' || o.code);$a$,
  '0108 T5');
select _v3_splice('0108', 'public.merchant_update_order(uuid,merchant_order_status)',
  $a$payment_status = case when payment_status = 'paid' then 'refunded' else payment_status end$a$,
  $a$payment_status = case when payment_status = 'paid' and not refund_via_request(o) then 'refunded' else payment_status end   /* 0108 refund gateway */$a$,
  '0108 refund gateway');
select _v3_splice('0108', 'public.merchant_update_order(uuid,merchant_order_status)',
  $a$    if o.payment_status = 'refunded' then perform wallet_apply(o.customer_id, 'refund', o.total, o.id, 'Refund ' || o.code); end if;$a$,
  $a$    if refund_via_request(o) then perform refund_auto_on_cancel(o.id, auth.uid(), 'Merchant menolak pesanan'); end if;   -- 0108 AntarPay nonaktif
    if o.payment_status = 'refunded' then perform wallet_apply(o.customer_id, 'refund', o.total, o.id, 'Refund ' || o.code); end if;$a$,
  '0108 AntarPay nonaktif');
select _v3_splice('0108', 'public.merchant_update_order(uuid,merchant_order_status)',
  $a$    if o.payment_status = 'refunded' then perform wallet_apply(o.customer_id, 'refund', o.total, o.id, 'Refund ' || o.code); end if;$a$,
  $a$    if o.payment_status = 'refunded' then perform wallet_apply(o.customer_id, 'refund', o.total, o.id, 'Refund ' || o.code); end if;
    if o.payment_status = 'refunded' then perform refund_record_wallet(o.id, auth.uid(), o.total, 'Merchant menolak pesanan'); end if;   -- 0108 T5$a$,
  '0108 T5');

-- ---------------------------------------------------------------------
-- 7. Sengketa
-- ---------------------------------------------------------------------
create or replace function public.dispute_open(p_order uuid, p_kind text, p_amount bigint, p_description text)
returns disputes language plpgsql security definer set search_path = public as $$
declare o orders; v_uid uuid := auth.uid(); v_role text; d disputes; v_kind text := lower(trim(coalesce(p_kind, ''))); v_pay uuid; v_paid bigint;
begin
  if v_uid is null then raise exception 'Harus login'; end if;
  -- R1: batas laju pembukaan sengketa
  if not rate_take('dispute_open', greatest(1, setting_num('rate_limit_dispute_per_hour', 5)::int)) then
    raise exception 'RATE_LIMIT: terlalu banyak sengketa dalam 1 jam. Coba lagi nanti.';
  end if;
  select * into o from orders where id = p_order for update;
  if not found then raise exception 'Pesanan tidak ditemukan'; end if;
  v_role := case when o.customer_id = v_uid then 'customer' when o.driver_id = v_uid or o.travel_partner_id = v_uid then 'driver'
                 when o.merchant_id is not null and owns_merchant(o.merchant_id) then 'merchant' end;
  if v_role is null then raise exception 'Hanya pihak dalam pesanan yang bisa membuka sengketa'; end if;
  if v_kind not in ('amount_mismatch','not_received','chargeback','payout_missing','other') then
    raise exception 'Jenis sengketa harus amount_mismatch|not_received|chargeback|payout_missing|other';
  end if;
  -- R1: jenis per peran — chargeback hanya dari sistem/admin (event provider); payout_missing hanya mitra
  if v_kind = 'chargeback' then raise exception 'DISPUTE_KIND: chargeback hanya dibuka sistem/admin dari notifikasi provider'; end if;
  if v_kind = 'payout_missing' and v_role = 'customer' then raise exception 'DISPUTE_KIND: payout_missing hanya untuk mitra (driver/merchant)'; end if;
  if v_kind = 'not_received' and v_role <> 'customer' then raise exception 'DISPUTE_KIND: not_received hanya untuk pelanggan'; end if;
  if length(btrim(coalesce(p_description, ''))) < 10 then raise exception 'Jelaskan masalahnya (min. 10 karakter)'; end if;
  -- R1: nominal ≤ yang dibayar; pesanan belum dibayar → nominal 0 dan tanpa baris ledger
  v_paid := case when o.payment_status in ('paid', 'refunded') then coalesce(o.total, 0) + coalesce(o.tip, 0) else 0 end;
  if p_amount is null or p_amount < 0 then raise exception 'Nominal sengketa tidak valid'; end if;
  if p_amount > v_paid then
    raise exception 'DISPUTE_AMOUNT: nominal sengketa Rp% melebihi yang dibayar Rp%', p_amount, v_paid;
  end if;
  -- R1: satu sengketa terbuka per pesanan per pihak
  if exists (select 1 from disputes where order_id = o.id and opened_by = v_uid and status in ('open', 'investigating')) then
    raise exception 'DISPUTE_OPEN: Anda masih punya sengketa terbuka untuk pesanan ini';
  end if;
  select id into v_pay from payments where order_id = o.id and purpose = 'order' and pay_status not in ('PENDING','FAILED','EXPIRED') order by paid_at desc nulls last limit 1;
  insert into disputes (order_id, payment_id, opened_by, party_role, kind, amount, description)
  values (o.id, v_pay, v_uid, v_role, v_kind, p_amount, btrim(p_description)) returning * into d;
  if p_amount > 0 and v_paid > 0 then
    insert into order_ledger (order_id, source, source_id, service, city_id, city, entry, amount, party_role, party_id, phase, note, payment_id)
    values (o.id, 'disputes', d.id, o.service, o.city_id, o.city, 'dispute', -p_amount, v_role, v_uid, 'adjusted', 'sengketa dibuka: ' || v_kind, v_pay);
  end if;
  perform log_activity('dispute.opened', 'disputes', d.id::text, 'Sengketa ' || v_kind || ' Rp' || p_amount || ' untuk ' || o.code || ' oleh ' || v_role,
    jsonb_build_object('dispute', to_jsonb(d)));
  return d;
end $$;
revoke all on function public.dispute_open(uuid, text, bigint, text) from public, anon;
grant execute on function public.dispute_open(uuid, text, bigint, text) to authenticated;

create or replace function public.my_disputes()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(d) || jsonb_build_object('order_code', o.code, 'refund_status', r.status, 'refund_amount', r.amount) order by d.created_at desc), '[]'::jsonb)
  from disputes d left join orders o on o.id = d.order_id left join refund_requests r on r.id = d.refund_id
  where d.opened_by = auth.uid();
$$;
revoke all on function public.my_disputes() from public, anon;
grant execute on function public.my_disputes() to authenticated;

create or replace function public.admin_disputes(p_status text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_st text := nullif(nullif(lower(trim(coalesce(p_status, ''))), ''), 'all');
begin
  perform admin_require('dispute');
  return coalesce((select jsonb_agg(to_jsonb(d) || jsonb_build_object('order_code', o.code, 'opened_by_name', pr.full_name, 'assigned_name', pa.full_name,
        'support_ref', p.support_ref, 'pay_status', p.pay_status, 'refund_status', r.status) order by d.created_at desc)
    from disputes d left join orders o on o.id = d.order_id left join profiles pr on pr.id = d.opened_by left join profiles pa on pa.id = d.assigned_to
    left join payments p on p.id = d.payment_id left join refund_requests r on r.id = d.refund_id
    where v_st is null or d.status = v_st), '[]'::jsonb);
end $$;
revoke all on function public.admin_disputes(text) from public, anon;
grant execute on function public.admin_disputes(text) to authenticated;

create or replace function public.admin_dispute_resolve(p_id uuid, p_status text, p_resolution text, p_refund_amount bigint default null)
returns disputes language plpgsql security definer set search_path = public as $$
declare d disputes; b disputes; v_st text := lower(trim(coalesce(p_status, ''))); r refund_requests; v_min bigint := setting_num('refund_dual_approval_min', 200000)::bigint;
  ap approval_requests; o orders;
begin
  if v_st not in ('investigating', 'resolved_refund', 'resolved_no_refund', 'closed') then
    raise exception 'Status harus investigating|resolved_refund|resolved_no_refund|closed';
  end if;
  perform admin_require(case when v_st = 'investigating' then 'dispute' else 'dispute_resolve' end);
  perform admin_require_unlock();
  select * into b from disputes where id = p_id for update;
  if not found then raise exception 'Sengketa tidak ditemukan'; end if;
  if b.status not in ('open', 'investigating') then raise exception 'Sengketa sudah %', b.status; end if;
  if v_st <> 'investigating' and length(btrim(coalesce(p_resolution, ''))) < 5 then raise exception 'Tulis resolusi (min. 5 karakter)'; end if;
  update disputes set status = v_st, resolution = coalesce(nullif(btrim(p_resolution), ''), resolution),
    assigned_to = coalesce(assigned_to, auth.uid()), resolved_at = case when v_st <> 'investigating' then now() end
   where id = b.id returning * into d;
  if v_st = 'resolved_refund' then
    if d.order_id is null then raise exception 'Sengketa tanpa pesanan tidak bisa direfund otomatis'; end if;
    select * into o from orders where id = d.order_id;
    r := refund_create_internal(d.order_id, coalesce(p_refund_amount, nullif(d.amount, 0)), 'sengketa: ' || coalesce(p_resolution, d.kind), 'dispute', auth.uid(),
      case when exists (select 1 from payments x where x.order_id = d.order_id and x.purpose = 'order' and x.pay_status in ('PAID','PARTIALLY_REFUNDED','REFUND_REQUESTED','DISPUTED'))
           then 'gateway' else 'wallet' end, d.id);
    update disputes set refund_id = r.id where id = d.id returning * into d;
    -- admin = maker; ≥ ambang (S3: kumulatif per pesanan) → tunggu checker; di bawah → disetujui (saldo: langsung dieksekusi)
    if r.amount >= v_min or refund_order_cumulative(r.order_id, r.id) >= v_min then
      insert into approval_requests (kind, ref_id, payload, amount, maker, note)
      values ('refund', r.id, jsonb_build_object('order_id', r.order_id, 'amount', r.amount, 'dispute_id', d.id), r.amount, auth.uid(), 'refund sengketa butuh admin kedua')
      returning * into ap;
      update refund_requests set approval_id = ap.id, decided_at = now() where id = r.id;
    else
      update refund_requests set status = 'approved', decided_at = now() where id = r.id returning * into r;
      if r.destination = 'wallet' then
        update refund_requests set status = 'done', executed_at = now() where id = r.id returning * into r;
        perform refund_apply_effects(r.id);
      end if;
    end if;
  end if;
  if v_st <> 'investigating' then
    perform ledger_apply_set('disputes', d.id, d.order_id, 'adjusted', '[]'::jsonb, '{}'::jsonb);   -- balik baris dispute
    if v_st = 'resolved_no_refund' and d.payment_id is not null then
      update payments set pay_status = 'PAID', note = 'sengketa ditolak' where id = d.payment_id and pay_status = 'DISPUTED';
    end if;
  end if;
  perform log_activity('dispute.' || v_st, 'disputes', d.id::text, 'Sengketa ' || d.kind || ' → ' || v_st || coalesce(' (refund Rp' || r.amount || ')', ''),
    jsonb_build_object('before', to_jsonb(b), 'after', to_jsonb(d), 'refund_id', r.id));
  return d;
end $$;
revoke all on function public.admin_dispute_resolve(uuid, text, text, bigint) from public, anon;
grant execute on function public.admin_dispute_resolve(uuid, text, text, bigint) to authenticated;

-- ---------------------------------------------------------------------
-- 8. Penjaga migrasi
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['cancel_order', 'merchant_update_order'] loop
    if position('0108 refund gateway' in (select pg_get_functiondef(p.oid) from pg_proc p where p.proname = t and p.pronamespace = 'public'::regnamespace)) = 0
       or position('0108 AntarPay nonaktif' in (select pg_get_functiondef(p.oid) from pg_proc p where p.proname = t and p.pronamespace = 'public'::regnamespace)) = 0
       or position('0108 T5' in (select pg_get_functiondef(p.oid) from pg_proc p where p.proname = t and p.pronamespace = 'public'::regnamespace)) = 0 then
      raise exception '0108 batal: tambalan refund belum terpasang di %', t;
    end if;
  end loop;
  if has_function_privilege('authenticated', 'public.refund_execute_result(uuid,boolean,text,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.refund_claim(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.refund_execute_result(uuid,text,text,jsonb,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.refund_apply_effects(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.refund_request(uuid,bigint,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.dispute_open(uuid,text,bigint,text)', 'EXECUTE')
     or has_table_privilege('authenticated', 'public.refund_requests', 'INSERT') or has_table_privilege('authenticated', 'public.disputes', 'UPDATE') then
    raise exception '0108 batal: RPC/tabel refund terbuka';
  end if;
  if position('refund_requests' in pg_get_functiondef('public.payment_refund_auto(uuid,text)'::regprocedure)) = 0 then
    raise exception '0108 batal: payment_refund_auto belum membuat refund_requests';
  end if;
  raise notice '0108 ok: refund_requests (+ dual approval), refund_policy_calc, disputes, kait pembayaran terlambat/chargeback, pembatalan gateway tanpa saldo';
end $$;

-- ---------------------------------------------------------------------
-- 9. Alias untuk Panel Admin (kontrak §4 memakai nama `admin_refunds`)
-- ---------------------------------------------------------------------
create or replace function public.admin_refunds(p_status text default null)
returns jsonb language sql stable security definer set search_path = public as $$
  select public.admin_refund_requests(p_status);
$$;
revoke all on function public.admin_refunds(text) from public, anon;
grant execute on function public.admin_refunds(text) to authenticated;
comment on function public.admin_refunds(text) is 'Alias admin_refund_requests (Panel Admin v3).';
