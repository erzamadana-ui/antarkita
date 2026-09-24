-- =====================================================================
-- 0106 — LEDGER v3: append-only + pembalikan, rekonsiliasi harian, contribution margin — Finpay v3
--
-- Sumber: docs/finpay-v3/KONTRAK-API-V3.md §5 (audit_logs/order_ledger/payment_events append-only),
-- §6 (ledger v3, reconciliation_runs, reconcile_daily, admin_contribution_margin).
--
-- Sebelum ini ledger_post/ledger_post_travel/ledger_post_ads MENGHAPUS baris fase lalu menulis ulang.
-- Sekarang buku besar append-only:
--   • ledger_apply_set(sumber, fase, baris) — bandingkan baris AKTIF fase itu dengan hasil hitung;
--     sama → tidak menulis apa pun (idempoten); berbeda → tulis baris PEMBALIK (reversal_of = id baris
--     lama, amount negatif) lalu baris baru. Jumlah per fase = hasil hitung terakhir, jejak lengkap.
--   • Trigger append-only pada order_ledger & audit_logs (payment_events sejak 0105): UPDATE/DELETE/
--     TRUNCATE ditolak, termasuk admin; hanya sesi pemeliharaan tanpa JWT pengguna yang menyalakan
--     antarkita.append_only_bypass (append_only_bypass(), 0105).
--   • ledger_entry baru: customer_receivable, wallet_liability, tax_output, dispute, unreconciled,
--     payout_fee, ads_impression_cost, ads_click_cost. Kolom order_ledger.payment_id, reversal_of.
--     (Nilai enum TIDAK bisa dihapus saat rollback — lihat supabase/rollback/0106_down.sql.)
--   • ledger_check diperluas: gross + promo_sponsor = driver + merchant + vendor + partner + platform_revenue
--     + pg_fee(pelanggan) + tax_output; fase refunded pada order selesai → refund = Σ pembalikan pro-rata.
--   • reconciliation_runs + reconcile_daily(p_date) (service_role; cron 02:00 WIB = 19:00 UTC) +
--     admin_reconcile_run(p_date): payments PAID ↔ payment_events ↔ ledger gross_customer ↔ wallet_transactions;
--     selisih → baris 'unreconciled' (source reconciliation); cocok → reconciled_at & settlement_status RECONCILED.
--   • admin_contribution_margin(from, to, group) + app_settings.variable_cost_per_order [ASUMSI Rp300].
-- Semua blok idempoten.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Cadangan fungsi (rollback: supabase/rollback/0106_down.sql)
-- ---------------------------------------------------------------------
do $$
declare s text;
begin
  foreach s in array array[
    'public.ledger_post(uuid,text,jsonb)', 'public.ledger_post_travel(text,uuid,text,jsonb)', 'public.ledger_post_ads(uuid)',
    'public.ledger_check(uuid)',
    'public.ledger_apply_set(text,uuid,uuid,text,jsonb,jsonb)', 'public.ledger_append_only()', 'public.reconcile_daily(date,text,uuid)',
    'public.admin_reconcile_run(date)', 'public.admin_reconciliation_runs(integer)', 'public.admin_contribution_margin(date,date,text)',
    'public.disputes_count_for(uuid)'] loop
    perform _mig_backup('0106', s);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 1. Enum & kolom
-- ---------------------------------------------------------------------
alter type public.ledger_entry add value if not exists 'customer_receivable';
alter type public.ledger_entry add value if not exists 'wallet_liability';
alter type public.ledger_entry add value if not exists 'tax_output';
alter type public.ledger_entry add value if not exists 'dispute';
alter type public.ledger_entry add value if not exists 'unreconciled';
alter type public.ledger_entry add value if not exists 'payout_fee';
alter type public.ledger_entry add value if not exists 'ads_impression_cost';
alter type public.ledger_entry add value if not exists 'ads_click_cost';

alter table public.order_ledger add column if not exists payment_id uuid references public.payments(id);
alter table public.order_ledger add column if not exists reversal_of bigint references public.order_ledger(id);
create index if not exists order_ledger_reversal_idx on public.order_ledger (reversal_of) where reversal_of is not null;
create index if not exists order_ledger_payment_idx on public.order_ledger (payment_id) where payment_id is not null;
create index if not exists order_ledger_source_phase_idx on public.order_ledger (source, source_id, phase);
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'order_ledger_source_check'
             and pg_get_constraintdef(oid) not like '%reconciliation%') then
    alter table public.order_ledger drop constraint order_ledger_source_check;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'order_ledger_source_check') then
    alter table public.order_ledger add constraint order_ledger_source_check check (source in
      ('orders','travel_bookings','travel_requests','merchant_ads','payments','disputes','reconciliation','payouts'));
  end if;
end $$;
comment on column public.order_ledger.reversal_of is 'Finpay v3 §6: id baris yang dibalik (baris ini = −amount baris itu). Baris aktif = reversal_of IS NULL dan tidak pernah dibalik.';
comment on column public.order_ledger.payment_id is 'Finpay v3 §6: pembayaran gateway yang mendasari baris ini (bila ada).';

-- ---------------------------------------------------------------------
-- 2. Append-only (order_ledger, audit_logs) — pemeliharaan: append_only_bypass()
-- ---------------------------------------------------------------------
create or replace function public.ledger_append_only()
returns trigger language plpgsql set search_path = public as $$
begin
  if append_only_bypass() then return coalesce(new, old); end if;
  raise exception '% append-only: % ditolak (buku besar/log tidak boleh diubah atau dihapus — tulis baris pembalik)',
    tg_table_name, tg_op;
end $$;
revoke all on function public.ledger_append_only() from public, anon, authenticated;
drop trigger if exists t_order_ledger_append_only on public.order_ledger;
create trigger t_order_ledger_append_only before update or delete on public.order_ledger for each row execute function ledger_append_only();
drop trigger if exists t_order_ledger_no_truncate on public.order_ledger;
create trigger t_order_ledger_no_truncate before truncate on public.order_ledger for each statement execute function ledger_append_only();
drop trigger if exists t_audit_logs_append_only on public.audit_logs;
create trigger t_audit_logs_append_only before update or delete on public.audit_logs for each row execute function ledger_append_only();
drop trigger if exists t_audit_logs_no_truncate on public.audit_logs;
create trigger t_audit_logs_no_truncate before truncate on public.audit_logs for each statement execute function ledger_append_only();
-- klien: audit_logs hanya SELECT (RLS admin) — tulis lewat log_activity (security definer)
do $$ begin perform _mig_backup_acl('0106', 'public.audit_logs'); end $$;
revoke insert, update, delete, truncate on public.audit_logs from public, anon, authenticated;
revoke all on public.audit_logs from anon;

-- ---------------------------------------------------------------------
-- 3. ledger_apply_set — inti append-only (internal)
--    p_rows: [{entry, amount, party_role, party_id, funded_by, note}], p_ctx: {service, city_id, city, pg_channel, payment_id}
-- ---------------------------------------------------------------------
create or replace function public.ledger_apply_set(p_source text, p_source_id uuid, p_order uuid, p_phase text, p_rows jsonb, p_ctx jsonb default '{}'::jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare v_cur jsonb; v_new jsonb; n int := 0;
begin
  select coalesce(jsonb_agg(jsonb_build_object('e', l.entry::text, 'a', l.amount, 'r', l.party_role, 'p', l.party_id, 'f', l.funded_by)
                            order by l.entry::text, l.amount, l.party_role, l.party_id::text, l.funded_by), '[]'::jsonb)
    into v_cur
    from order_ledger l
   where l.source = p_source and l.source_id = p_source_id and l.phase = p_phase and l.reversal_of is null
     and not exists (select 1 from order_ledger r where r.reversal_of = l.id);
  select coalesce(jsonb_agg(jsonb_build_object('e', x->>'entry', 'a', (x->>'amount')::bigint, 'r', x->>'party_role',
                            'p', nullif(x->>'party_id', '')::uuid, 'f', x->>'funded_by')
                            order by x->>'entry', (x->>'amount')::bigint, x->>'party_role', x->>'party_id', x->>'funded_by'), '[]'::jsonb)
    into v_new
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) x;
  if v_cur = v_new then return 0; end if;   -- idempoten: tidak ada perubahan → tidak ada baris baru

  -- balik semua baris aktif fase ini
  insert into order_ledger (order_id, source, source_id, service, city_id, city, entry, amount, party_role, party_id, funded_by, phase, pg_channel, note, payment_id, reversal_of)
  select l.order_id, l.source, l.source_id, l.service, l.city_id, l.city, l.entry, -l.amount, l.party_role, l.party_id, l.funded_by, l.phase, l.pg_channel,
         'pembalikan #' || l.id, l.payment_id, l.id
    from order_ledger l
   where l.source = p_source and l.source_id = p_source_id and l.phase = p_phase and l.reversal_of is null
     and not exists (select 1 from order_ledger r where r.reversal_of = l.id);
  -- tulis set baru
  insert into order_ledger (order_id, source, source_id, service, city_id, city, entry, amount, party_role, party_id, funded_by, phase, pg_channel, note, payment_id)
  select p_order, p_source, p_source_id, nullif(p_ctx->>'service', '')::service_type, nullif(p_ctx->>'city_id', '')::uuid, p_ctx->>'city',
         (x->>'entry')::ledger_entry, (x->>'amount')::bigint, x->>'party_role', nullif(x->>'party_id', '')::uuid, x->>'funded_by', p_phase,
         p_ctx->>'pg_channel', x->>'note', nullif(p_ctx->>'payment_id', '')::uuid
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) x;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.ledger_apply_set(text, uuid, uuid, text, jsonb, jsonb) from public, anon, authenticated;
comment on function public.ledger_apply_set(text, uuid, uuid, text, jsonb, jsonb) is
  'Finpay v3 §6 (internal): tulis set baris satu (sumber, fase) secara append-only — sama dengan baris aktif → 0 baris; berbeda → baris pembalik (reversal_of) + baris baru.';

-- ---------------------------------------------------------------------
-- 4. ledger_post / ledger_post_travel / ledger_post_ads — tanpa DELETE
-- ---------------------------------------------------------------------
create or replace function public.ledger_post(p_order uuid, p_phase text, p_extra jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o orders; c jsonb; v_rows jsonb := '[]'::jsonb; v_refund bigint; v_tip bigint; v_reimb bigint; v_pen bigint; v_ctx jsonb; v_pay uuid;
begin
  if p_phase not in ('created','completed','cancelled','refunded','settled','adjusted') then raise exception 'Fase ledger tidak dikenal: %', p_phase; end if;
  select * into o from orders where id = p_order;
  if not found then raise exception 'ledger_post: order % tidak ditemukan', p_order; end if;
  select id into v_pay from payments where order_id = o.id and purpose = 'order' and pay_status not in ('PENDING','FAILED','EXPIRED')
   order by paid_at desc nulls last limit 1;
  v_ctx := jsonb_build_object('service', o.service, 'city_id', o.city_id, 'city', o.city, 'pg_channel', o.pg_channel, 'payment_id', v_pay);

  if p_phase in ('created', 'adjusted', 'completed') then
    c := ledger_calc(o);
    perform ledger_apply_set('orders', o.id, o.id, p_phase, c->'entries', v_ctx);   -- 0106 append-only
    return c || jsonb_build_object('phase', p_phase, 'order_id', o.id);
  end if;

  -- cancelled / refunded: dana kembali ke pelanggan; penggantian belanja ke driver; denda (travel) sebagai pendapatan
  v_refund := coalesce((p_extra->>'refund')::bigint, 0); v_tip := coalesce((p_extra->>'tip_refund')::bigint, 0);
  v_reimb := coalesce((p_extra->>'reimburse')::bigint, 0); v_pen := coalesce((p_extra->>'penalty')::bigint, 0);
  if v_refund <> 0 then v_rows := v_rows || jsonb_build_object('entry', 'refund', 'amount', -v_refund, 'party_role', 'customer', 'party_id', o.customer_id, 'note', 'refund pembatalan ' || o.code); end if;
  if v_tip <> 0 then v_rows := v_rows || jsonb_build_object('entry', 'refund', 'amount', -v_tip, 'party_role', 'customer', 'party_id', o.customer_id, 'note', 'refund tip ' || o.code); end if;
  if v_reimb <> 0 then v_rows := v_rows || jsonb_build_object('entry', 'vendor_payable', 'amount', -v_reimb, 'party_role', 'vendor', 'party_id', o.driver_id, 'note', 'penggantian belanja yang sudah dibeli driver (order batal)'); end if;
  if v_pen <> 0 then v_rows := v_rows || jsonb_build_object('entry', 'platform_revenue', 'amount', v_pen, 'party_role', 'platform', 'note', 'denda batal'); end if;
  if v_refund = 0 and v_tip = 0 and v_reimb = 0 and v_pen = 0 then
    -- batal tanpa aliran dana: penanda fase (refund 0) supaya ledger_check melihat fase cancelled
    v_rows := v_rows || jsonb_build_object('entry', 'refund', 'amount', 0, 'party_role', 'customer', 'party_id', o.customer_id, 'note', 'batal tanpa dana kembali ' || o.code);
  end if;
  perform ledger_apply_set('orders', o.id, o.id, p_phase, v_rows, v_ctx);
  return jsonb_build_object('phase', p_phase, 'order_id', o.id, 'refund', v_refund, 'tip_refund', v_tip, 'reimburse', v_reimb, 'penalty', v_pen);
end $$;
revoke all on function public.ledger_post(uuid, text, jsonb) from public, anon, authenticated;
comment on function public.ledger_post(uuid, text, jsonb) is
  'Tulis buku besar satu order untuk satu fase (0099; v3 0106: APPEND-ONLY — hasil sama → tidak menulis; berbeda → baris pembalik + baris baru, tanpa DELETE). Internal.';

create or replace function public.ledger_post_travel(p_source text, p_source_id uuid, p_phase text, p_extra jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  b travel_bookings; r travel_requests; t travel_trips; v_partner uuid; v_cust uuid; v_code text;
  gross bigint; PF bigint := 0; base bigint; fee bigint; partner bigint; rev bigint; recv bigint := 0; is_cash boolean; v_city uuid; v_city_name text;
  v_refund bigint := coalesce((p_extra->>'refund')::bigint, 0); v_pen bigint := coalesce((p_extra->>'penalty')::bigint, 0);
  v_rows jsonb := '[]'::jsonb;
begin
  if p_source not in ('travel_bookings', 'travel_requests') then raise exception 'ledger_post_travel: sumber tidak dikenal %', p_source; end if;
  if p_phase not in ('created','completed','cancelled','refunded','settled','adjusted') then raise exception 'Fase ledger tidak dikenal: %', p_phase; end if;
  if p_source = 'travel_bookings' then
    select * into b from travel_bookings where id = p_source_id;
    if not found then raise exception 'ledger_post_travel: booking % tidak ditemukan', p_source_id; end if;
    select * into t from travel_trips where id = b.trip_id;
    v_partner := t.partner_id; v_cust := b.customer_id; v_code := b.code;
    gross := b.price; PF := b.platform_fee; base := b.price - b.platform_fee; partner := b.partner_earning; fee := base - partner;
    is_cash := (b.payment_method = 'cash');
    select r2.from_city, c.name into v_city, v_city_name from travel_routes r2 left join cities c on c.id = r2.from_city where r2.id = t.route_id;
  else
    select * into r from travel_requests where id = p_source_id;
    if not found then raise exception 'ledger_post_travel: permintaan % tidak ditemukan', p_source_id; end if;
    select o.partner_id into v_partner from travel_offers o where o.id = r.accepted_offer_id;
    v_partner := coalesce(v_partner, r.partner_id); v_cust := r.customer_id; v_code := r.code;
    gross := r.price; base := r.price; fee := r.platform_fee; partner := r.partner_earning;
    is_cash := (r.payment_method = 'cash');
    v_city := r.from_city; select name into v_city_name from cities where id = r.from_city;
  end if;
  rev := PF + fee;
  if is_cash then recv := gross - partner; end if;

  if p_phase in ('created', 'completed', 'adjusted') then
    v_rows := jsonb_build_array(
      jsonb_build_object('entry', 'gross_customer', 'amount', gross, 'party_role', 'customer', 'party_id', v_cust, 'note', v_code),
      jsonb_build_object('entry', 'intercity_fare', 'amount', base, 'party_role', 'customer', 'party_id', v_cust, 'note', 'harga kursi/carter'));
    if PF <> 0 then v_rows := v_rows || jsonb_build_object('entry', 'customer_platform_fee', 'amount', PF, 'party_role', 'customer', 'party_id', v_cust); end if;
    if fee <> 0 then v_rows := v_rows || jsonb_build_object('entry', 'merchant_fee', 'amount', fee, 'party_role', 'platform', 'note', 'fee mitra travel'); end if;
    if partner <> 0 then v_rows := v_rows || jsonb_build_object('entry', 'partner_payable', 'amount', -partner, 'party_role', 'partner', 'party_id', v_partner, 'note', case when is_cash then 'tunai: dipegang mitra' end); end if;
    v_rows := v_rows || jsonb_build_object('entry', 'platform_revenue', 'amount', rev, 'party_role', 'platform', 'note', 'biaya platform ' || PF || ' + fee mitra ' || fee);
    if is_cash and recv <> 0 then v_rows := v_rows || jsonb_build_object('entry', 'driver_receivable', 'amount', recv, 'party_role', 'partner', 'party_id', v_partner, 'note', 'setoran mitra ke platform dari uang tunai'); end if;
  else
    if v_refund <> 0 then v_rows := v_rows || jsonb_build_object('entry', 'refund', 'amount', -v_refund, 'party_role', 'customer', 'party_id', v_cust, 'note', 'refund ' || v_code); end if;
    if v_pen <> 0 then v_rows := v_rows || jsonb_build_object('entry', 'platform_revenue', 'amount', v_pen, 'party_role', 'platform', 'note', 'denda batal'); end if;
    if v_refund = 0 and v_pen = 0 then
      v_rows := v_rows || jsonb_build_object('entry', 'refund', 'amount', 0, 'party_role', 'customer', 'party_id', v_cust, 'note', 'batal tanpa dana kembali ' || v_code);
    end if;
  end if;
  perform ledger_apply_set(p_source, p_source_id, null, p_phase, v_rows,
    jsonb_build_object('service', 'travel', 'city_id', v_city, 'city', v_city_name));   -- 0106 append-only
  return jsonb_build_object('source', p_source, 'source_id', p_source_id, 'phase', p_phase, 'gross_customer', gross, 'customer_platform_fee', PF,
    'merchant_fee', fee, 'partner_payable', partner, 'platform_revenue', rev, 'driver_receivable', recv, 'refund', v_refund, 'penalty', v_pen,
    'balanced', (gross = partner + rev));
end $$;
revoke all on function public.ledger_post_travel(text, uuid, text, jsonb) from public, anon, authenticated;

create or replace function public.ledger_post_ads(p_ad uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a merchant_ads; m merchants; v_city uuid; v_city_name text; pr ad_products; v_ctx jsonb; v_rows jsonb := '[]'::jsonb; v_note text;
begin
  select * into a from merchant_ads where id = p_ad;
  if not found then raise exception 'ledger_post_ads: iklan % tidak ditemukan', p_ad; end if;
  -- kampanye v3 (0109, budget terisi): pendapatan dicatat per tagihan (ads_charge), bukan di sini
  if to_jsonb(a) ? 'budget' and (to_jsonb(a)->>'budget') is not null then
    return jsonb_build_object('ad_id', a.id, 'status', a.status, 'campaign', true, 'note', 'kampanye: pendapatan per tagihan (ad_budget_ledger)');
  end if;
  select * into m from merchants where id = a.merchant_id;
  select * into pr from ad_products where code = a.product_code;
  if m.lat is not null then v_city := nearest_city(m.lat, m.lng); end if;
  select name into v_city_name from cities where id = v_city;
  v_ctx := jsonb_build_object('service', 'food', 'city_id', v_city, 'city', coalesce(v_city_name, m.address));
  v_note := coalesce(pr.name, a.product_code) || ' · ' || m.name || ' · ' || to_char(a.starts_at at time zone 'Asia/Jakarta', 'DD Mon') || '–' || to_char(a.ends_at at time zone 'Asia/Jakarta', 'DD Mon') || ' · ' || coalesce(a.paid_via, '-');
  if a.activated_at is not null and a.price_paid > 0 then
    v_rows := jsonb_build_array(jsonb_build_object('entry', 'ads_revenue', 'amount', a.price_paid, 'party_role', 'merchant', 'party_id', m.owner_id, 'note', v_note));
  end if;
  perform ledger_apply_set('merchant_ads', a.id, null, 'completed', v_rows, v_ctx);   -- 0106 append-only
  perform ledger_apply_set('merchant_ads', a.id, null, 'refunded',
    case when a.refunded > 0 then jsonb_build_array(jsonb_build_object('entry', 'ads_revenue', 'amount', -a.refunded, 'party_role', 'merchant', 'party_id', m.owner_id, 'note', 'refund iklan dibatalkan')) else '[]'::jsonb end,
    v_ctx);
  return jsonb_build_object('ad_id', a.id, 'status', a.status, 'ads_revenue', case when a.activated_at is not null then a.price_paid else 0 end - a.refunded, 'city_id', v_city);
end $$;
revoke all on function public.ledger_post_ads(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. ledger_check v3
-- ---------------------------------------------------------------------
create or replace function public.ledger_check(p_order uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_phase text; o orders; agg record; rf record; v_bal boolean; v_diff bigint; v_diffc bigint; v_paid bigint; v_alloc bigint; v_comp bigint;
  v_has_ref boolean := false; v_ref_ok boolean := true; v_ref_diff bigint := 0; v_res jsonb; v_disp record;
begin
  -- pemanggil latar (cron/service_role, auth.uid() NULL; fungsi ini tidak diberikan ke anon) atau admin atau pihak order
  if auth.uid() is not null and not is_admin() and not exists (select 1 from orders x where x.id = p_order and (x.customer_id = auth.uid() or x.driver_id = auth.uid() or x.travel_partner_id = auth.uid() or (x.merchant_id is not null and owns_merchant(x.merchant_id)))) then
    raise exception 'Tidak berhak';
  end if;
  select * into o from orders where id = p_order;
  if not found then return jsonb_build_object('order_id', p_order, 'verdict', 'not_found', 'balanced', null); end if;
  select phase into v_phase from order_ledger where order_id = p_order and source = 'orders'
   order by case phase when 'completed' then 0 when 'refunded' then 1 when 'cancelled' then 2 when 'adjusted' then 3 when 'created' then 4 else 5 end limit 1;
  if v_phase is null then return jsonb_build_object('order_id', p_order, 'code', o.code, 'verdict', 'no_ledger', 'balanced', null, 'ledger_version', o.ledger_version); end if;

  select
    coalesce(sum(amount) filter (where entry = 'gross_customer'), 0) as gross,
    coalesce(sum(amount) filter (where entry = 'items_subtotal'), 0) as items,
    coalesce(sum(amount) filter (where entry = 'delivery_fee'), 0) as fare,
    coalesce(sum(amount) filter (where entry = 'customer_platform_fee'), 0) as pf,
    coalesce(sum(amount) filter (where entry = 'service_fee'), 0) as sf,
    coalesce(sum(amount) filter (where entry = 'intercity_fare'), 0) as ic,
    coalesce(sum(amount) filter (where entry = 'tip'), 0) as tip,
    coalesce(sum(amount) filter (where entry = 'extras'), 0) as extras,
    coalesce(-sum(amount) filter (where entry = 'promo_platform'), 0) as promo_p,
    coalesce(-sum(amount) filter (where entry = 'promo_merchant'), 0) as promo_m,
    coalesce(-sum(amount) filter (where entry = 'promo_sponsor'), 0) as promo_s,
    coalesce(sum(amount) filter (where entry = 'driver_commission'), 0) as comm,
    coalesce(-sum(amount) filter (where entry = 'adjustment' and party_role = 'driver'), 0) as bonus,
    coalesce(sum(amount) filter (where entry = 'merchant_fee'), 0) as mfee,
    coalesce(-sum(amount) filter (where entry = 'driver_payable'), 0) as drv,
    coalesce(-sum(amount) filter (where entry = 'merchant_payable'), 0) as merch,
    coalesce(-sum(amount) filter (where entry = 'vendor_payable'), 0) as vendor,
    coalesce(-sum(amount) filter (where entry = 'partner_payable'), 0) as partner,
    coalesce(sum(amount) filter (where entry = 'platform_revenue'), 0) as rev,
    coalesce(-sum(amount) filter (where entry = 'tax_output'), 0) as tax,
    coalesce(-sum(amount) filter (where entry = 'pg_fee' and funded_by = 'customer'), 0) + coalesce(-sum(amount) filter (where entry = 'pg_fee_ppn' and funded_by = 'customer'), 0) as pg_cust,
    coalesce(-sum(amount) filter (where entry = 'pg_fee' and coalesce(funded_by, 'platform') = 'platform'), 0) + coalesce(-sum(amount) filter (where entry = 'pg_fee_ppn' and coalesce(funded_by, 'platform') = 'platform'), 0) as pg_plat,
    coalesce(sum(amount) filter (where entry = 'driver_receivable'), 0) as recv,
    coalesce(-sum(amount) filter (where entry = 'refund'), 0) as refund,
    count(*) as rows_n
  into agg from order_ledger where order_id = p_order and source = 'orders' and phase = v_phase;

  select exists (select 1 from order_ledger where order_id = p_order and source = 'orders' and phase = 'refunded') into v_has_ref;
  if v_phase = 'completed' and v_has_ref then
    -- 0106: refund sesudah selesai (sengketa/komplain) — refund = Σ pembalikan pro-rata (payable ↑, platform_revenue ↓)
    select coalesce(-sum(amount) filter (where entry = 'refund'), 0) as refund,
           coalesce(sum(amount) filter (where entry = 'driver_payable'), 0) as drv,
           coalesce(sum(amount) filter (where entry = 'merchant_payable'), 0) as merch,
           coalesce(sum(amount) filter (where entry = 'vendor_payable'), 0) as vendor,
           coalesce(sum(amount) filter (where entry = 'partner_payable'), 0) as partner,
           coalesce(-sum(amount) filter (where entry = 'platform_revenue'), 0) as rev
      into rf from order_ledger where order_id = p_order and source = 'orders' and phase = 'refunded';
    v_ref_diff := rf.refund - (rf.drv + rf.merch + rf.vendor + rf.partner + rf.rev);
    v_ref_ok := v_ref_diff = 0;
  end if;
  select count(*) filter (where status in ('open', 'investigating')) as open_n, count(*) as n into v_disp
    from disputes_count_for(p_order);

  if v_phase in ('created', 'adjusted', 'completed') then
    v_alloc := agg.drv + agg.merch + agg.vendor + agg.partner + agg.rev + agg.pg_cust + agg.tax;
    v_diff := agg.gross + agg.promo_s - v_alloc;
    v_comp := agg.items + agg.fare + agg.pf + agg.sf + agg.ic + agg.tip + agg.extras - agg.promo_p - agg.promo_m - agg.promo_s + agg.pg_cust;
    v_diffc := agg.gross - v_comp;
    v_bal := (v_diff = 0 and v_diffc = 0 and agg.gross = o.total + o.tip) and v_ref_ok;
    v_res := jsonb_build_object('order_id', p_order, 'code', o.code, 'service', o.service, 'phase', v_phase, 'status', o.status,
      'verdict', case when v_bal then 'balanced' else 'unbalanced' end, 'balanced', v_bal, 'diff', v_diff, 'diff_components', v_diffc,
      'gross_customer', agg.gross, 'allocated', v_alloc, 'components_total', v_comp,
      'formula', 'gross_customer + promo_sponsor = driver_payable + merchant_payable + vendor_payable + partner_payable + platform_revenue + pg_fee(pelanggan) + tax_output',
      'driver_payable', agg.drv, 'merchant_payable', agg.merch, 'vendor_payable', agg.vendor, 'partner_payable', agg.partner,
      'platform_revenue', agg.rev, 'pg_fee_platform', agg.pg_plat, 'pg_fee_customer', agg.pg_cust, 'tax_output', agg.tax, 'contribution', agg.rev - agg.pg_plat,
      'driver_commission', agg.comm, 'bonus', agg.bonus, 'merchant_fee', agg.mfee,
      'promo_platform', agg.promo_p, 'promo_merchant', agg.promo_m, 'promo_sponsor', agg.promo_s,
      'driver_receivable', agg.recv, 'rows', agg.rows_n);
    if v_has_ref and v_phase = 'completed' then
      v_res := v_res || jsonb_build_object('refund', rf.refund, 'refund_check', jsonb_build_object('ok', v_ref_ok, 'diff', v_ref_diff,
        'formula', 'refund = Δdriver_payable + Δmerchant_payable + Δvendor_payable + Δpartner_payable + Δplatform_revenue (fase refunded)',
        'driver_payable_reversed', rf.drv, 'merchant_payable_reversed', rf.merch, 'platform_revenue_reversed', rf.rev));
    end if;
  else
    -- cancelled/refunded: dikembalikan + penggantian + bagian yang tertahan (merchant/driver/platform) = yang dibayar bila direfund
    v_paid := case when o.payment_status = 'refunded' then o.total else 0 end;
    v_alloc := agg.refund + agg.vendor + agg.rev + agg.merch + agg.drv + agg.partner;
    v_bal := case when o.payment_status = 'refunded' then v_alloc >= v_paid else true end;
    v_res := jsonb_build_object('order_id', p_order, 'code', o.code, 'service', o.service, 'phase', v_phase, 'status', o.status,
      'verdict', case when v_bal then 'refund_ok' else 'refund_short' end, 'balanced', v_bal,
      'diff', v_alloc - v_paid, 'refund', agg.refund, 'reimburse', agg.vendor, 'penalty', agg.rev, 'retained_merchant', agg.merch,
      'retained_driver', agg.drv, 'paid', v_paid, 'rows', agg.rows_n);
  end if;
  return v_res || jsonb_build_object('disputes_open', coalesce(v_disp.open_n, 0));
end $$;
revoke all on function public.ledger_check(uuid) from public, anon;
grant execute on function public.ledger_check(uuid) to authenticated, service_role;
comment on function public.ledger_check(uuid) is
  'Putusan keseimbangan buku besar satu order (0099; v3 0106: + tax_output; fase refunded sesudah selesai → refund = Σ pembalikan pro-rata; baris pembalik ikut terjumlah). Admin, pihak order, atau pemanggil latar.';

-- Jumlah sengketa per order (0108 mengisi tabel disputes; sebelum itu 0 baris)
create or replace function public.disputes_count_for(p_order uuid)
returns table(status text) language plpgsql stable security definer set search_path = public as $$
begin
  if to_regclass('public.disputes') is null then return; end if;
  return query execute 'select status::text from public.disputes where order_id = $1' using p_order;
end $$;
revoke all on function public.disputes_count_for(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 6. Rekonsiliasi harian
-- ---------------------------------------------------------------------
insert into app_settings (key, value) values ('variable_cost_per_order', '300'::jsonb) on conflict (key) do nothing;

create table if not exists public.reconciliation_runs (
  id                   uuid primary key default gen_random_uuid(),
  run_date             date not null,
  provider             text,
  kind                 text not null default 'daily' check (kind in ('daily', 'manual')),
  payments_checked     int not null default 0,
  mismatches           int not null default 0,
  unreconciled_amount  bigint not null default 0,
  status               text not null default 'running' check (status in ('running', 'done', 'failed')),
  report               jsonb,
  created_by           uuid,
  created_at           timestamptz not null default now(),
  finished_at          timestamptz
);
create index if not exists reconciliation_runs_date_idx on public.reconciliation_runs (run_date desc, created_at desc);
comment on table public.reconciliation_runs is
  'Finpay v3 §6: satu baris per jalannya rekonsiliasi (harian via cron 02:00 WIB atau manual admin). report.items = selisih per pembayaran.';
alter table public.reconciliation_runs enable row level security;
drop policy if exists reconciliation_runs_admin on public.reconciliation_runs;
create policy reconciliation_runs_admin on public.reconciliation_runs for select to authenticated using (is_admin());
revoke all on public.reconciliation_runs from public, anon, authenticated;
grant select on public.reconciliation_runs to authenticated;
grant all on public.reconciliation_runs to service_role;

create or replace function public.reconcile_daily(p_date date, p_kind text default 'daily', p_by uuid default null)
returns reconciliation_runs language plpgsql security definer set search_path = public as $$
declare
  run reconciliation_runs; p record; v_ev_ok boolean; v_ev_n int; v_exp bigint; v_diff bigint; v_reason text; v_items jsonb := '[]'::jsonb;
  v_checked int := 0; v_bad int := 0; v_unrec bigint := 0; v_wallet bigint; v_late bigint; v_gross bigint; v_ok int := 0; v_ord int;
begin
  if p_date is null then raise exception 'Tanggal rekonsiliasi wajib diisi'; end if;
  if p_kind not in ('daily', 'manual') then raise exception 'kind harus daily|manual'; end if;
  insert into reconciliation_runs (run_date, provider, kind, created_by) values (p_date, 'all', p_kind, p_by) returning * into run;

  for p in select * from payments pm
            where pm.pay_status not in ('PENDING', 'FAILED', 'EXPIRED')
              and (coalesce(pm.settlement_time, pm.paid_at) at time zone 'Asia/Jakarta')::date = p_date
            order by pm.created_at loop
    v_checked := v_checked + 1; v_reason := null;
    -- (a) inbox provider: bila pembayaran lewat payment_event_ingest, wajib ada event PAID dengan nominal cocok
    select count(*), bool_or(payment_status_map(e.provider, e.provider_status, e.raw) = 'PAID' and (e.amount is null or e.amount = p.amount))
      into v_ev_n, v_ev_ok from payment_events e where e.payment_id = p.id and e.signature_ok;
    v_ev_ok := case when v_ev_n = 0 then true else coalesce(v_ev_ok, false) end;
    -- (b) sisi AntarKita: saldo yang dikreditkan (top up / refund keterlambatan) atau gross_customer order (tanpa tip)
    select coalesce(sum(t.amount) filter (where t.type = 'topup'), 0), coalesce(sum(t.amount) filter (where t.type = 'refund'), 0)
      into v_wallet, v_late from wallet_transactions t where t.ref = p.external_id and t.user_id = p.user_id;
    v_exp := 0;
    if p.purpose = 'topup' then v_exp := v_wallet;
    elsif v_late > 0 then v_exp := v_late;
    else
      if to_regclass('public.refund_requests') is not null then
        execute 'select coalesce(sum(amount), 0) from public.refund_requests where payment_id = $1 and reason = ''late_payment'' and status <> ''rejected'''
          into v_late using p.id;
      end if;
      if v_late > 0 then v_exp := v_late;
      else
        select coalesce(sum(l.amount) filter (where l.entry = 'gross_customer'), 0) - coalesce(sum(l.amount) filter (where l.entry = 'tip'), 0)
          into v_gross from order_ledger l where l.order_id = p.order_id and l.source = 'orders' and l.phase = 'created';
        v_exp := coalesce(v_gross, 0);
      end if;
    end if;
    v_diff := p.amount - v_exp;
    if not v_ev_ok then v_reason := 'event provider PAID tidak ada/nominal beda';
    elsif v_diff <> 0 then v_reason := case when p.purpose = 'topup' then 'saldo top up ' || v_exp || ' ≠ pembayaran ' || p.amount
                                             else 'gross_customer/refund ' || v_exp || ' ≠ pembayaran ' || p.amount end;
    end if;

    if v_reason is null then
      v_ok := v_ok + 1;
      update payments set reconciled_at = coalesce(reconciled_at, now()), reconcile_run_id = run.id where id = p.id;
      update orders set settlement_status = 'RECONCILED' where id = p.order_id and settlement_status = 'PAYOUT_SETTLED';
    else
      v_bad := v_bad + 1;
      v_unrec := v_unrec + abs(case when v_diff <> 0 then v_diff else p.amount end);
      v_items := v_items || jsonb_build_object('payment_id', p.id, 'external_id', p.external_id, 'support_ref', p.support_ref, 'provider', p.provider,
        'purpose', p.purpose, 'order_id', p.order_id, 'amount', p.amount, 'expected', v_exp, 'diff', v_diff, 'events', v_ev_n, 'reason', v_reason);
      -- baris 'unreconciled' (sekali per pembayaran & nilai; jalan ulang tidak menggandakan)
      if not exists (select 1 from order_ledger l where l.source = 'reconciliation' and l.payment_id = p.id and l.entry = 'unreconciled'
                     and l.amount = case when v_diff <> 0 then v_diff else p.amount end and l.reversal_of is null
                     and not exists (select 1 from order_ledger z where z.reversal_of = l.id)) then
        insert into order_ledger (order_id, source, source_id, service, entry, amount, party_role, phase, pg_channel, note, payment_id)
        values (p.order_id, 'reconciliation', run.id, (select service from orders where id = p.order_id), 'unreconciled',
                case when v_diff <> 0 then v_diff else p.amount end, 'gateway', 'adjusted', p.pg_channel,
                'rekonsiliasi ' || p_date || ': ' || v_reason || ' (' || p.external_id || ')', p.id);
      end if;
      update payments set reconciled_at = null where id = p.id and reconciled_at is not null;
    end if;
  end loop;

  -- order non-gateway (saldo/tunai) yang payout-nya sudah settled & buku besarnya seimbang → RECONCILED
  update orders o set settlement_status = 'RECONCILED'
   where o.settlement_status = 'PAYOUT_SETTLED' and (o.completed_at at time zone 'Asia/Jakarta')::date <= p_date
     and not exists (select 1 from payments x where x.order_id = o.id and x.purpose = 'order' and x.pay_status not in ('PENDING','FAILED','EXPIRED') and x.reconciled_at is null)
     and coalesce((ledger_check(o.id)->>'balanced')::boolean, false);
  get diagnostics v_ord = row_count;

  update reconciliation_runs set payments_checked = v_checked, mismatches = v_bad, unreconciled_amount = v_unrec, status = 'done', finished_at = now(),
    report = jsonb_build_object('date', p_date, 'checked', v_checked, 'matched', v_ok, 'mismatches', v_bad, 'unreconciled_amount', v_unrec,
      'orders_reconciled', v_ord, 'items', v_items,
      'rules', 'payments PAID ↔ payment_events(PAID, nominal) ↔ ledger gross_customer (fase created, tanpa tip) / wallet_transactions (top up, refund keterlambatan) / refund_requests late_payment')
   where id = run.id returning * into run;
  return run;
end $$;
revoke all on function public.reconcile_daily(date, text, uuid) from public, anon, authenticated;
grant execute on function public.reconcile_daily(date, text, uuid) to service_role;
comment on function public.reconcile_daily(date, text, uuid) is
  'Finpay v3 §6 (service_role; cron 02:00 WIB untuk H-1): pembayaran PAID tanggal settlement p_date dibandingkan dengan payment_events, ledger gross_customer, wallet_transactions & refund_requests late_payment. Selisih → order_ledger entry unreconciled (source reconciliation, sekali per nilai); cocok → payments.reconciled_at + orders PAYOUT_SETTLED→RECONCILED.';

create or replace function public.admin_reconcile_run(p_date date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare run reconciliation_runs;
begin
  perform admin_require('reconcile');
  if p_date is null or p_date > (now() at time zone 'Asia/Jakarta')::date then raise exception 'Tanggal tidak valid (maks hari ini)'; end if;
  run := reconcile_daily(p_date, 'manual', auth.uid());
  perform log_activity('reconcile.run', 'reconciliation_runs', run.id::text,
    format('Rekonsiliasi manual %s: %s pembayaran dicek, %s selisih (Rp%s)', p_date, run.payments_checked, run.mismatches, run.unreconciled_amount),
    jsonb_build_object('run_id', run.id, 'date', p_date, 'mismatches', run.mismatches));
  return to_jsonb(run);
end $$;
revoke all on function public.admin_reconcile_run(date) from public, anon;
grant execute on function public.admin_reconcile_run(date) to authenticated;

create or replace function public.admin_reconciliation_runs(p_limit int default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform admin_require('reconcile');
  return coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc) from
    (select * from reconciliation_runs order by created_at desc limit least(200, greatest(1, coalesce(p_limit, 30)))) r), '[]'::jsonb);
end $$;
revoke all on function public.admin_reconciliation_runs(int) from public, anon;
grant execute on function public.admin_reconciliation_runs(int) to authenticated;

do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'antarkita_reconcile_daily';
  -- 02:00 WIB = 19:00 UTC; merekonsiliasi hari kemarin (WIB)
  perform cron.schedule('antarkita_reconcile_daily', '0 19 * * *',
    $c$select public.reconcile_daily(((now() at time zone 'Asia/Jakarta')::date - 1), 'daily', null);$c$);
exception when others then
  raise notice '0106: pg_cron tidak tersedia (%) — jadwalkan reconcile_daily() manual', sqlerrm;
end $$;

-- ---------------------------------------------------------------------
-- 7. Contribution margin
-- ---------------------------------------------------------------------
create or replace function public.admin_contribution_margin(p_from date, p_to date, p_group text default 'service')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_vc numeric := setting_num('variable_cost_per_order', 300); v_g text := lower(coalesce(p_group, 'service')); v_rows jsonb; v_tot jsonb;
begin
  perform admin_require('report');
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Rentang tanggal tidak valid'; end if;
  if p_to - p_from > 400 then raise exception 'Rentang maksimal 400 hari'; end if;
  if v_g not in ('service', 'city', 'merchant', 'month') then raise exception 'p_group harus service|city|merchant|month'; end if;
  with u as (
    select case v_g when 'service' then x.service::text
                    when 'city' then coalesce(x.city, 'Lainnya')
                    when 'merchant' then coalesce((select m.name from merchants m where m.id = x.merchant_id), 'Tanpa merchant')
                    else to_char(x.day, 'YYYY-MM') end as key, x.*
      from ledger_units(p_from, p_to) x
  ), g as (
    select key,
      count(*) filter (where kind in ('order', 'travel'))::bigint as orders,
      coalesce(sum(gmv_net), 0)::bigint as gross,
      coalesce(sum(revenue_net + promo_platform), 0)::bigint as platform_revenue,
      coalesce(sum(pg_fee_platform), 0)::bigint as pg_fee_platform,
      coalesce(sum(promo_platform), 0)::bigint as promo_platform,
      coalesce(sum(refund_pg_cost), 0)::bigint as refund_fraud,
      coalesce(sum(revenue_net), 0)::bigint as revenue_net,
      coalesce(sum(contribution), 0)::bigint as contribution
    from u group by key
  )
  select coalesce(jsonb_agg(jsonb_build_object('key', key, 'orders', orders, 'gross', gross, 'platform_revenue', platform_revenue,
           'pg_fee_platform', pg_fee_platform, 'promo_platform', promo_platform, 'refund_fraud', refund_fraud,
           'variable_cost', round(orders * v_vc)::bigint, 'contribution_margin', contribution - round(orders * v_vc)::bigint,
           'take_rate_net_pct', case when gross > 0 then round(100.0 * revenue_net / gross, 2) else 0 end) order by gross desc, key), '[]'::jsonb),
         jsonb_build_object('orders', coalesce(sum(orders), 0), 'gross', coalesce(sum(gross), 0), 'platform_revenue', coalesce(sum(platform_revenue), 0),
           'pg_fee_platform', coalesce(sum(pg_fee_platform), 0), 'promo_platform', coalesce(sum(promo_platform), 0), 'refund_fraud', coalesce(sum(refund_fraud), 0),
           'variable_cost', round(coalesce(sum(orders), 0) * v_vc)::bigint,
           'contribution_margin', coalesce(sum(contribution), 0) - round(coalesce(sum(orders), 0) * v_vc)::bigint,
           'take_rate_net_pct', case when coalesce(sum(gross), 0) > 0 then round(100.0 * sum(revenue_net) / sum(gross), 2) else 0 end)
    into v_rows, v_tot from g;
  return jsonb_build_object('from', p_from, 'to', p_to, 'group', v_g, 'variable_cost_per_order', v_vc,
    'labels', jsonb_build_object('variable_cost_per_order', '[ASUMSI] app_settings.variable_cost_per_order', 'take_rate_net_pct', 'revenue_net ÷ gross (gmv_net) × 100 — bukan laba'),
    'rows', v_rows, 'totals', v_tot);
end $$;
revoke all on function public.admin_contribution_margin(date, date, text) from public, anon;
grant execute on function public.admin_contribution_margin(date, date, text) to authenticated;
comment on function public.admin_contribution_margin(date, date, text) is
  'Finpay v3 §6: per service|city|merchant|month — orders, gross (gmv_net), platform_revenue (sebelum promo), pg_fee_platform, promo_platform, refund_fraud (biaya PG hangus refund), variable_cost (orders × variable_cost_per_order [ASUMSI]), contribution_margin, take_rate_net_pct. Sumber: ledger_units (order_ledger).';

-- ---------------------------------------------------------------------
-- 8. Penjaga migrasi
-- ---------------------------------------------------------------------
do $$
declare n int; def text;
begin
  select count(*) into n from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'ledger_entry'
    and e.enumlabel in ('customer_receivable','wallet_liability','tax_output','dispute','unreconciled','payout_fee','ads_impression_cost','ads_click_cost');
  if n <> 8 then raise exception '0106 batal: nilai ledger_entry baru baru % dari 8', n; end if;
  foreach def in array array['public.ledger_post(uuid,text,jsonb)', 'public.ledger_post_travel(text,uuid,text,jsonb)', 'public.ledger_post_ads(uuid)'] loop
    if pg_get_functiondef(def::regprocedure) ~* 'delete\s+from\s+order_ledger' then raise exception '0106 batal: % masih menghapus baris buku besar', def; end if;
  end loop;
  if not exists (select 1 from pg_trigger where tgname = 't_order_ledger_append_only') or not exists (select 1 from pg_trigger where tgname = 't_audit_logs_append_only')
     or not exists (select 1 from pg_trigger where tgname = 't_payment_events_append_only') then
    raise exception '0106 batal: trigger append-only belum lengkap';
  end if;
  -- append-only benar-benar menolak (tanpa bypass)
  begin
    update order_ledger set note = note where id = (select min(id) from order_ledger);
    if found then raise exception '0106 batal: UPDATE order_ledger tidak ditolak'; end if;
  exception when others then if sqlerrm like '0106 batal%' then raise; end if; end;
  begin
    delete from audit_logs where id = (select min(id) from audit_logs);
    if found then raise exception '0106 batal: DELETE audit_logs tidak ditolak'; end if;
  exception when others then if sqlerrm like '0106 batal%' then raise; end if; end;
  if has_function_privilege('authenticated', 'public.reconcile_daily(date,text,uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.ledger_apply_set(text,uuid,uuid,text,jsonb,jsonb)', 'EXECUTE')
     or has_function_privilege('anon', 'public.admin_contribution_margin(date,date,text)', 'EXECUTE')
     or has_table_privilege('authenticated', 'public.audit_logs', 'DELETE') or has_table_privilege('authenticated', 'public.reconciliation_runs', 'INSERT') then
    raise exception '0106 batal: fungsi/tabel internal terbuka untuk klien';
  end if;
  if to_regnamespace('cron') is not null and not exists (select 1 from cron.job where jobname = 'antarkita_reconcile_daily' and schedule = '0 19 * * *') then
    raise exception '0106 batal: jadwal rekonsiliasi 02:00 WIB belum terpasang';
  end if;
  raise notice '0106 ok: ledger append-only (pembalikan), ledger_check v3, reconciliation_runs + reconcile_daily (cron 19:00 UTC), admin_contribution_margin';
end $$;
