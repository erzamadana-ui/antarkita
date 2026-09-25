-- =====================================================================
-- 0103 — LAPORAN EKSEKUTIF v2 (`exec_report_v2`) — satu definisi pendapatan dari `order_ledger`
--
-- Sumber: docs/SKEMA-BISNIS-V2-SPEK.md §0.5 (take rate bersih), §0.6 (contribution & EBITDA kota), §7.
--
-- Definisi (dipakai SEMUA laporan sejak migrasi ini — tidak ada definisi pendapatan kedua):
--   unit              = order selesai & tidak direfund (orders, travel_bookings, travel_requests) — per tanggal selesai WIB
--   gmv_net           = items_subtotal + delivery_fee + intercity_fare (ongkir & biaya platform dilaporkan terpisah di rinciannya)
--   sumber pendapatan = merchant_fee + customer_platform_fee + driver_commission (kotor) + service_fee_platform
--                       + ads (ads_revenue) + other (margin antar kota, ongkir tanpa driver, denda batal)
--   revenue_net       = Σ sumber − promo_platform                      (= pembilang take rate §0.5)
--   take_rate_net_pct = revenue_net ÷ gmv_net × 100
--   contribution      = revenue_net − insentif (bonus sesi driver) − biaya PG ditanggung platform
--                       − biaya PG yang hangus pada order refund − variable_ops (city_fixed_costs, pro-rata per order) − biaya payout
--                       (per order: = ledger platform_revenue − pg_fee platform = ledger_check.contribution)
--   ebitda_city       = contribution kota − biaya tetap kota (pro-rata hari untuk rentang parsial)
-- Order sebelum 0099 (ledger_version 1, tanpa baris ledger) memakai rumus order_economics lama sebagai cadangan (legacy=true).
--
-- Isi:
--   1. view order_economics_v2 (kolom kompatibel order_economics + kolom ledger)
--   2. ledger_units(from, to) — baris unit per sumber (internal)
--   3. skema_v2_report(from, to, filters) (internal) → exec_report_v2(token, …) & admin_exec_report_v2(…)
--   4. admin_city_fixed_costs + ringkasan EBITDA kota
--   5. Penyelarasan: admin_dashboard_stats.revenue_month, exec_report_data (summary/monthly/by_service revenue),
--      admin_finance_cascade / admin_order_split / exec_pnl_data membaca order_economics_v2
--   6. Penjaga migrasi. Idempoten.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. order_economics_v2
-- ---------------------------------------------------------------------
create or replace view public.order_economics_v2 with (security_invoker = on) as
select
  e.id, e.code, e.created_at, e.completed_at, e.status, e.service, e.city_id, e.city_name, e.customer_id, e.driver_id, e.merchant_id,
  e.payment_method, e.total, e.platform_fee, e.fare_delivery, e.items_subtotal, e.merchant_earning,
  (case when l.has then l.promo_p else e.discount end)::bigint                        as discount,        -- promo DITANGGUNG PLATFORM (v2)
  e.tip, e.extras_total, e.service_fee, e.driver_service_share, e.intercity_fare,
  e.driver_earning, e.driver_base, e.gateway_paid, e.refund,
  (case when l.has then l.comm - l.bonus else e.commission end)::bigint             as commission,      -- komisi bersih bonus sesi
  (case when l.has then l.mfee else e.merchant_margin end)::bigint                   as merchant_margin,
  e.service_company,
  (case when l.has then l.rev + l.promo_p - l.pf - (l.comm - l.bonus) - l.mfee - e.service_company else e.intercity_margin end)::bigint as intercity_margin,
  (case when l.has then l.pg_plat else e.gateway_fee end)::bigint                    as gateway_fee,     -- biaya PG aktual ditanggung platform
  (case when l.has then l.drv - l.tip - l.extras else e.driver_payout end)::bigint   as driver_payout,
  (case when l.has then l.merch else e.merchant_payout end)::bigint                  as merchant_payout,
  (case when l.has then l.rev + l.promo_p else e.revenue end)::bigint                as revenue,         -- sebelum promo platform
  e.revenue_billed,
  -- kolom ledger v2
  coalesce(l.has, false)                                                             as has_ledger,
  not coalesce(l.has, false)                                                         as legacy,
  l.phase                                                                            as ledger_phase,
  o.payment_status, o.promo_funded_by, o.pg_fee_borne_by,
  coalesce(o.pg_channel, payment_channel_of(o.paid_via))                             as pg_channel,
  (case when l.has then l.items + l.fare + l.ic else e.items_subtotal + e.fare_delivery + e.intercity_fare end)::bigint as gmv_net,
  (case when l.has then l.pf else e.platform_fee end)::bigint                        as customer_platform_fee,
  (case when l.has then l.comm else e.commission end)::bigint                        as driver_commission,
  (case when l.has then l.bonus else 0 end)::bigint                                  as incentives,
  (case when l.has then l.mfee else e.merchant_margin end)::bigint                   as merchant_fee,
  e.service_company::bigint                                                          as service_fee_platform,
  (case when l.has then l.rev + l.promo_p - l.pf - (l.comm - l.bonus) - l.mfee - e.service_company else e.intercity_margin end)::bigint as other_revenue,
  (case when l.has then l.promo_p else e.discount end)::bigint                       as promo_platform,
  (case when l.has then l.promo_m else 0 end)::bigint                                as promo_merchant,
  (case when l.has then l.promo_s else 0 end)::bigint                                as promo_sponsor,
  (case when l.has then l.rev + l.bonus else e.revenue - e.discount end)::bigint     as revenue_net,
  (case when l.has then l.pg_plat + l.pg_cust else e.gateway_fee end)::bigint        as pg_fee_total,
  (case when l.has then l.pg_plat else e.gateway_fee end)::bigint                    as pg_fee_platform,
  (case when l.has then l.pg_cust else 0 end)::bigint                                as pg_fee_customer,
  (case when l.has then l.rev - l.pg_plat else e.revenue - e.discount - e.gateway_fee end)::bigint as contribution
from order_economics e
join orders o on o.id = e.id
left join lateral (
  select true as has, x.phase,
    coalesce(sum(x.amount) filter (where x.entry = 'customer_platform_fee'), 0) as pf,
    coalesce(sum(x.amount) filter (where x.entry = 'driver_commission'), 0) as comm,
    coalesce(-sum(x.amount) filter (where x.entry = 'adjustment' and x.party_role = 'driver'), 0) as bonus,
    coalesce(sum(x.amount) filter (where x.entry = 'merchant_fee'), 0) as mfee,
    coalesce(-sum(x.amount) filter (where x.entry = 'promo_platform'), 0) as promo_p,
    coalesce(-sum(x.amount) filter (where x.entry = 'promo_merchant'), 0) as promo_m,
    coalesce(-sum(x.amount) filter (where x.entry = 'promo_sponsor'), 0) as promo_s,
    coalesce(sum(x.amount) filter (where x.entry = 'platform_revenue'), 0) as rev,
    coalesce(-sum(x.amount) filter (where x.entry = 'driver_payable'), 0) as drv,
    coalesce(-sum(x.amount) filter (where x.entry = 'merchant_payable'), 0) as merch,
    coalesce(sum(x.amount) filter (where x.entry = 'tip'), 0) as tip,
    coalesce(sum(x.amount) filter (where x.entry = 'extras'), 0) as extras,
    coalesce(sum(x.amount) filter (where x.entry = 'items_subtotal'), 0) as items,
    coalesce(sum(x.amount) filter (where x.entry = 'delivery_fee'), 0) as fare,
    coalesce(sum(x.amount) filter (where x.entry = 'intercity_fare'), 0) as ic,
    coalesce(-sum(x.amount) filter (where x.entry in ('pg_fee', 'pg_fee_ppn') and coalesce(x.funded_by, 'platform') = 'platform'), 0) as pg_plat,
    coalesce(-sum(x.amount) filter (where x.entry in ('pg_fee', 'pg_fee_ppn') and x.funded_by = 'customer'), 0) as pg_cust
  from order_ledger x
  where x.order_id = e.id and x.source = 'orders'
    and x.phase = (select y.phase from order_ledger y where y.order_id = e.id and y.source = 'orders' and y.phase in ('completed', 'adjusted', 'created')
                   order by case y.phase when 'completed' then 0 when 'adjusted' then 1 else 2 end limit 1)
  group by x.phase
) l on true;
comment on view public.order_economics_v2 is
  'Ekonomi per order dari order_ledger (0103). Kolom lama order_economics tetap (discount = promo ditanggung platform, commission = komisi − bonus sesi, gateway_fee = biaya PG aktual ditanggung platform) sehingga revenue − discount − gateway_fee = contribution ledger. legacy=true: order tanpa ledger (sebelum 0099) → rumus lama.';
revoke all on public.order_economics_v2 from public, anon, authenticated;
grant select on public.order_economics_v2 to service_role;

-- ---------------------------------------------------------------------
-- 2. ledger_units — satu baris per unit ekonomi (internal; semua laporan v2 mengagregasi dari sini)
-- ---------------------------------------------------------------------
create or replace function public.ledger_units(p_from date, p_to date)
returns table(kind text, source text, source_id uuid, order_id uuid, service service_type, city_id uuid, city text, merchant_id uuid,
  pg_channel text, is_cash boolean, promo_owner text, day date, orders int, gmv_net bigint,
  merchant_fee bigint, customer_platform_fee bigint, driver_commission bigint, service_fee_platform bigint, ads bigint, other bigint,
  promo_platform bigint, promo_merchant bigint, promo_sponsor bigint, incentives bigint, revenue_net bigint,
  pg_fee_total bigint, pg_fee_platform bigint, pg_fee_customer bigint, refund bigint, refund_pg_cost bigint, contribution bigint, legacy boolean)
language sql stable security definer set search_path = public as $$
  -- (1) order selesai & tidak direfund
  select 'order', 'orders', v.id, v.id, v.service, v.city_id, v.city_name, v.merchant_id,
    v.pg_channel, v.payment_method = 'cash', case when v.promo_platform + v.promo_merchant + v.promo_sponsor > 0 then coalesce(v.promo_funded_by, 'platform') end,
    (v.completed_at at time zone 'Asia/Jakarta')::date, 1, v.gmv_net,
    v.merchant_fee, v.customer_platform_fee, v.driver_commission, v.service_fee_platform, 0::bigint, v.other_revenue,
    v.promo_platform, v.promo_merchant, v.promo_sponsor, v.incentives, v.revenue_net,
    v.pg_fee_total, v.pg_fee_platform, v.pg_fee_customer, 0::bigint, 0::bigint, v.contribution, v.legacy
  from order_economics_v2 v
  where v.status = 'completed' and v.payment_status <> 'refunded'
    and v.completed_at >= (p_from::timestamp at time zone 'Asia/Jakarta') and v.completed_at < ((p_to + 1)::timestamp at time zone 'Asia/Jakarta')
  union all
  -- (2) travel kursi/carter selesai
  select 'travel', t.source, t.source_id, null::uuid, 'travel'::service_type, t.city_id, t.city, null::uuid,
    t.pg_channel, t.pg_channel = 'cash', null::text, t.day, 1, t.ic,
    t.mfee, t.pf, 0::bigint, 0::bigint, 0::bigint, t.rev - t.pf - t.mfee,
    0::bigint, 0::bigint, 0::bigint, 0::bigint, t.rev, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, t.rev, false
  from (
    select l.source, l.source_id, (array_agg(l.city_id))[1] as city_id, (array_agg(l.city))[1] as city,
      payment_channel_of(coalesce(b.paid_via, r.paid_via, case when coalesce(b.payment_method, r.payment_method) = 'cash' then 'cash' else 'wallet' end)) as pg_channel,
      (min(l.created_at) at time zone 'Asia/Jakarta')::date as day,
      coalesce(sum(l.amount) filter (where l.entry = 'intercity_fare'), 0) as ic,
      coalesce(sum(l.amount) filter (where l.entry = 'customer_platform_fee'), 0) as pf,
      coalesce(sum(l.amount) filter (where l.entry = 'merchant_fee'), 0) as mfee,
      coalesce(sum(l.amount) filter (where l.entry = 'platform_revenue'), 0) as rev
    from order_ledger l
    left join travel_bookings b on l.source = 'travel_bookings' and b.id = l.source_id
    left join travel_requests r on l.source = 'travel_requests' and r.id = l.source_id
    where l.source in ('travel_bookings', 'travel_requests') and l.phase = 'completed'
      and coalesce(b.payment_status, r.payment_status::text) <> 'refunded'
    group by l.source, l.source_id, b.paid_via, r.paid_via, b.payment_method, r.payment_method
  ) t
  where t.day between p_from and p_to
  union all
  -- (3) denda batal (platform_revenue pada fase cancelled/refunded)
  select 'penalty', l.source, coalesce(l.source_id, l.order_id), l.order_id, l.service, l.city_id, l.city, o.merchant_id,
    coalesce(o.pg_channel, payment_channel_of(o.paid_via)), case when o.id is not null then o.payment_method = 'cash' end, null::text,
    (l.created_at at time zone 'Asia/Jakarta')::date, 0, 0::bigint,
    0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, l.amount, 0::bigint, 0::bigint, 0::bigint, 0::bigint, l.amount,
    0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, l.amount, false
  from order_ledger l left join orders o on o.id = l.order_id
  where l.entry = 'platform_revenue' and l.phase in ('cancelled', 'refunded') and l.amount <> 0
    and l.created_at >= (p_from::timestamp at time zone 'Asia/Jakarta') and l.created_at < ((p_to + 1)::timestamp at time zone 'Asia/Jakarta')
  union all
  -- (4) iklan/boost merchant
  select 'ads', 'merchant_ads', l.source_id, null::uuid, coalesce(l.service, 'food'), l.city_id, l.city, a.merchant_id,
    null::text, null::boolean, null::text, (l.created_at at time zone 'Asia/Jakarta')::date, 0, 0::bigint,
    0::bigint, 0::bigint, 0::bigint, 0::bigint, l.amount, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, l.amount,
    0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, l.amount, false
  from order_ledger l join merchant_ads a on a.id = l.source_id
  where l.source = 'merchant_ads' and l.entry = 'ads_revenue'
    and l.created_at >= (p_from::timestamp at time zone 'Asia/Jakarta') and l.created_at < ((p_to + 1)::timestamp at time zone 'Asia/Jakarta')
  union all
  -- (5) refund (dana kembali ke pelanggan) + biaya PG yang hangus pada order gateway yang direfund
  select 'refund', f.source, f.source_id, f.order_id, f.service, f.city_id, f.city, f.merchant_id, f.pg_channel, f.is_cash, null::text, f.day, 0, 0::bigint,
    0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint,
    0::bigint, 0::bigint, 0::bigint, f.refund, f.pg_lost, -f.pg_lost, false
  from (
    select l.source, coalesce(l.source_id, l.order_id) as source_id, l.order_id, l.service, (array_agg(l.city_id))[1] as city_id, (array_agg(l.city))[1] as city,
      o.merchant_id, coalesce(o.pg_channel, payment_channel_of(o.paid_via)) as pg_channel, case when o.id is not null then o.payment_method = 'cash' end as is_cash,
      (max(l.created_at) at time zone 'Asia/Jakarta')::date as day, -sum(l.amount)::bigint as refund,
      (case when o.payment_status = 'refunded' and o.pg_channel = any (payment_gateway_channel_keys()) then o.pg_fee + o.pg_fee_ppn else 0 end)::bigint as pg_lost
    from order_ledger l left join orders o on o.id = l.order_id
    where l.entry = 'refund' and l.phase = 'refunded'
    group by l.source, coalesce(l.source_id, l.order_id), l.order_id, l.service, o.id, o.merchant_id, o.pg_channel, o.paid_via, o.payment_method, o.payment_status, o.pg_fee, o.pg_fee_ppn
  ) f
  where f.day between p_from and p_to and (f.refund <> 0 or f.pg_lost <> 0);
$$;
revoke all on function public.ledger_units(date, date) from public, anon, authenticated;
comment on function public.ledger_units(date, date) is
  'Unit ekonomi v2 per tanggal WIB (0103): order/travel selesai, denda, iklan, refund — sumber tunggal exec_report_v2, admin_dashboard_stats.revenue_month, exec_report_data.revenue. Internal.';

-- ---------------------------------------------------------------------
-- 3. Laporan v2
-- ---------------------------------------------------------------------
insert into app_settings (key, value) values
  ('take_rate_north_star_pct', '25'::jsonb),
  ('payout_fee_per_withdrawal', '0'::jsonb),
  ('gate_payout_on_time_pct', '95'::jsonb),
  ('gate_retention_driver_pct', '60'::jsonb),
  ('gate_retention_merchant_pct', '70'::jsonb),
  ('gate_refund_max_pct', '2'::jsonb)
on conflict (key) do nothing;

create or replace function public.skema_v2_report(p_from date, p_to date, p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  f jsonb := coalesce(p_filters, '{}'::jsonb);
  v_services text[]; v_cities uuid[]; v_cohort text; v_pay text; v_cd text; v_promo text;
  v_m0 date; v_start date; v_sla numeric := setting_num('payout_sla_hours', 24); v_payout_fee numeric := setting_num('payout_fee_per_withdrawal', 0);
  v_payouts bigint; v_topup_pg bigint; r jsonb; s jsonb; g jsonb; v_w8 jsonb; v_recon record; v_pay_ok record; v_ret_d record; v_ret_m record; v_ref record;
begin
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Rentang tanggal tidak valid'; end if;
  if p_to - p_from > 400 then raise exception 'Rentang maksimal 400 hari'; end if;
  if jsonb_typeof(f) <> 'object' then raise exception 'p_filters harus objek JSON'; end if;
  -- filter (§7): service[], city_id[], merchant_cohort, payment_method, cash_digital, promo_owner
  v_services := case jsonb_typeof(f->'service') when 'array' then array(select jsonb_array_elements_text(f->'service')) when 'string' then array[f->>'service'] end;
  if cardinality(v_services) = 0 then v_services := null; end if;
  begin
    v_cities := case jsonb_typeof(f->'city_id') when 'array' then array(select jsonb_array_elements_text(f->'city_id'))::uuid[] when 'string' then array[(f->>'city_id')::uuid] end;
  exception when invalid_text_representation then raise exception 'city_id harus uuid'; end;
  if cardinality(v_cities) = 0 then v_cities := null; end if;
  v_cohort := coalesce(nullif(lower(f->>'merchant_cohort'), ''), 'all');
  v_pay := nullif(nullif(lower(f->>'payment_method'), ''), 'all');
  v_cd := coalesce(nullif(lower(f->>'cash_digital'), ''), 'all');
  v_promo := nullif(nullif(lower(f->>'promo_owner'), ''), 'all');
  if v_cohort not in ('new_30d', 'active', 'all') then raise exception 'merchant_cohort harus new_30d|active|all'; end if;
  if v_cd not in ('cash', 'digital', 'all') then raise exception 'cash_digital harus cash|digital|all'; end if;
  if v_promo is not null and v_promo not in ('platform', 'merchant', 'sponsor', 'none') then raise exception 'promo_owner harus platform|merchant|sponsor|none|all'; end if;
  if v_pay is not null and not (v_pay = any (payment_channel_keys())) then raise exception 'payment_method tidak dikenal: %', v_pay; end if;

  v_m0 := (date_trunc('month', p_to) - interval '11 months')::date;
  v_start := least(date_trunc('month', p_from)::date, v_m0, p_to - 56);
  v_payouts := (select count(*) from withdrawal_requests where settled_at is not null and (settled_at at time zone 'Asia/Jakarta')::date between p_from and p_to);
  v_topup_pg := (select coalesce(sum(pg_fee), 0) from wallet_transactions where pg_fee > 0 and (created_at at time zone 'Asia/Jakarta')::date between p_from and p_to);

  with ua as (select * from ledger_units(v_start, p_to)),
  mc as (select merchant_id, min(day) first_day from ua where merchant_id is not null and kind = 'order' group by merchant_id),
  den as (select x.city_id, date_trunc('month', x.day)::date as month, count(*) n from ua x where x.kind in ('order', 'travel') group by 1, 2),
  vo as (select c.city_id, c.month, c.amount::numeric / d.n as rate from city_fixed_costs c join den d on d.city_id = c.city_id and d.month = c.month where c.category = 'variable_ops'),
  uf as (   -- unit terfilter (seluruh jendela) + alokasi variable_ops per order
    select x.*, coalesce(case when x.kind in ('order', 'travel') then vo.rate end, 0)::numeric as vo_alloc,
      date_trunc('month', x.day)::date as month, coalesce(mc.first_day, p_to) as m_first
    from ua x left join vo on vo.city_id = x.city_id and vo.month = date_trunc('month', x.day)::date
    left join mc on mc.merchant_id = x.merchant_id
    where (v_services is null or x.service::text = any (v_services))
      and (v_cities is null or x.city_id = any (v_cities))
      and (v_cohort = 'all' or (x.merchant_id is not null and ((v_cohort = 'new_30d') = (coalesce(mc.first_day, p_to) >= p_to - 30))))
      and (v_pay is null or x.pg_channel = v_pay)
      and (v_cd = 'all' or (v_cd = 'cash' and x.is_cash) or (v_cd = 'digital' and x.is_cash = false))
      and (v_promo is null or (v_promo = 'none' and x.promo_owner is null and x.kind in ('order', 'travel')) or x.promo_owner = v_promo)
  ),
  u as (select * from uf where day between p_from and p_to),
  -- biaya tetap kota (pro-rata hari untuk bulan yang terpotong rentang) + variable_ops bulan tanpa order (tidak teralokasi)
  fx as (
    select c.city_id, sum(round(c.amount * (least(p_to, (c.month + interval '1 month' - interval '1 day')::date) - greatest(p_from, c.month) + 1)::numeric
                                / extract(day from (c.month + interval '1 month' - interval '1 day'))))::bigint as fixed
    from city_fixed_costs c
    where c.month <= p_to and (c.month + interval '1 month' - interval '1 day')::date >= p_from
      and (c.category <> 'variable_ops' or not exists (select 1 from den d where d.city_id = c.city_id and d.month = c.month))
      and (v_cities is null or c.city_id = any (v_cities))
    group by c.city_id
  ),
  fxm as (
    select c.month, sum(c.amount)::bigint as fixed from city_fixed_costs c
    where c.month between v_m0 and p_to and (v_cities is null or c.city_id = any (v_cities))
      and (c.category <> 'variable_ops' or not exists (select 1 from den d where d.city_id = c.city_id and d.month = c.month))
    group by c.month
  ),
  tot as (
    select count(*) filter (where kind in ('order', 'travel'))::bigint n,
      coalesce(sum(gmv_net), 0)::bigint gmv, coalesce(sum(merchant_fee), 0)::bigint mfee, coalesce(sum(customer_platform_fee), 0)::bigint pf,
      coalesce(sum(driver_commission), 0)::bigint comm, coalesce(sum(service_fee_platform), 0)::bigint sfp, coalesce(sum(ads), 0)::bigint ads,
      coalesce(sum(other), 0)::bigint oth, coalesce(sum(promo_platform), 0)::bigint pp, coalesce(sum(promo_merchant), 0)::bigint pm,
      coalesce(sum(promo_sponsor), 0)::bigint ps, coalesce(sum(incentives), 0)::bigint inc, coalesce(sum(revenue_net), 0)::bigint rn,
      coalesce(sum(pg_fee_total), 0)::bigint pgt, coalesce(sum(pg_fee_platform), 0)::bigint pgp, coalesce(sum(pg_fee_customer), 0)::bigint pgc,
      coalesce(sum(refund), 0)::bigint rf, coalesce(sum(refund_pg_cost), 0)::bigint rfpg, round(coalesce(sum(vo_alloc), 0))::bigint vo,
      coalesce(sum(contribution), 0)::bigint contrib, count(*) filter (where legacy)::bigint leg
    from u
  )
  select jsonb_build_object(
    'summary', (select jsonb_build_object(
        'orders', t.n, 'gmv_net', t.gmv,
        'platform_revenue', jsonb_build_object('merchant_fee', t.mfee, 'customer_platform_fee', t.pf, 'driver_commission', t.comm,
            'service_fee_platform', t.sfp, 'ads', t.ads, 'other', t.oth, 'total', t.mfee + t.pf + t.comm + t.sfp + t.ads + t.oth),
        'promo', jsonb_build_object('platform', t.pp, 'merchant', t.pm, 'sponsor', t.ps, 'total', t.pp + t.pm + t.ps),
        'revenue_net', t.rn,
        'take_rate_net_pct', case when t.gmv > 0 then round(100.0 * t.rn / t.gmv, 2) else 0 end,
        'take_rate_target_pct', setting_num('take_rate_north_star_pct', 25),
        'incentives_total', t.inc,
        'pg_fee_total', t.pgt, 'pg_fee_platform', t.pgp, 'pg_fee_customer', t.pgc, 'pg_fee_topup', v_topup_pg,
        'payout_fee_total', round(v_payouts * v_payout_fee)::bigint, 'payouts_settled', v_payouts,
        'refund_total', t.rf, 'refund_pg_cost', t.rfpg, 'variable_ops_total', t.vo,
        'contribution_total', t.contrib - t.vo - round(v_payouts * v_payout_fee)::bigint,
        'contribution_per_order', case when t.n > 0 then round((t.contrib - t.vo - round(v_payouts * v_payout_fee))::numeric / t.n) else 0 end,
        'fixed_costs_total', (select coalesce(sum(fixed), 0) from fx),
        'ebitda', t.contrib - t.vo - round(v_payouts * v_payout_fee)::bigint - (select coalesce(sum(fixed), 0) from fx),
        'legacy_units', t.leg) from tot t),
    'by_city', (select coalesce(jsonb_agg(jsonb_build_object('city_id', z.city_id, 'city', z.city, 'orders', z.n, 'gmv_net', z.gmv, 'revenue', z.rn,
          'contribution', z.contrib, 'fixed_costs', z.fixed, 'ebitda_city', z.contrib - z.fixed,
          'take_rate_pct', case when z.gmv > 0 then round(100.0 * z.rn / z.gmv, 2) else 0 end) order by z.gmv desc, z.city), '[]'::jsonb)
        from (select coalesce(a.city_id, fx.city_id) city_id, coalesce(a.city, (select name from cities where id = fx.city_id), 'Lainnya') city,
                coalesce(a.n, 0) n, coalesce(a.gmv, 0) gmv, coalesce(a.rn, 0) rn, coalesce(a.contrib, 0) contrib, coalesce(fx.fixed, 0) fixed
              from (select city_id, (array_agg(city))[1] city, count(*) filter (where kind in ('order', 'travel')) n, sum(gmv_net) gmv, sum(revenue_net) rn,
                      (sum(contribution) - round(sum(vo_alloc)))::bigint contrib
                    from u group by city_id) a
              full join fx on fx.city_id = a.city_id) z),
    'by_service', (select coalesce(jsonb_agg(jsonb_build_object('service', service, 'orders', n, 'gmv_net', gmv, 'revenue', rn, 'contribution', contrib, 'pg_fee', pg,
          'take_rate_pct', case when gmv > 0 then round(100.0 * rn / gmv, 2) else 0 end) order by gmv desc), '[]'::jsonb)
        from (select service, count(*) filter (where kind in ('order', 'travel')) n, sum(gmv_net) gmv, sum(revenue_net) rn,
                (sum(contribution) - round(sum(vo_alloc)))::bigint contrib, sum(pg_fee_total) pg from u group by service) q),
    'by_payment', (select coalesce(jsonb_agg(jsonb_build_object('channel', pg_channel, 'label', payment_channel_label(pg_channel), 'orders', n, 'gmv_net', gmv,
          'revenue', rn, 'pg_fee', pg, 'pg_fee_platform', pgp, 'contribution', contrib) order by gmv desc), '[]'::jsonb)
        from (select pg_channel, count(*) filter (where kind in ('order', 'travel')) n, sum(gmv_net) gmv, sum(revenue_net) rn, sum(pg_fee_total) pg,
                sum(pg_fee_platform) pgp, (sum(contribution) - round(sum(vo_alloc)))::bigint contrib from u where pg_channel is not null group by pg_channel) q),
    'by_month', (select coalesce(jsonb_agg(jsonb_build_object('month', to_char(g.m, 'YYYY-MM'), 'orders', coalesce(q.n, 0), 'gmv_net', coalesce(q.gmv, 0),
          'revenue', coalesce(q.rn, 0), 'contribution', coalesce(q.contrib, 0), 'fixed_costs', coalesce(fxm.fixed, 0),
          'ebitda', coalesce(q.contrib, 0) - coalesce(fxm.fixed, 0),
          'take_rate_pct', case when coalesce(q.gmv, 0) > 0 then round(100.0 * q.rn / q.gmv, 2) else 0 end) order by g.m), '[]'::jsonb)
        from generate_series(v_m0, date_trunc('month', p_to)::date, interval '1 month') g(m)
        left join (select month, count(*) filter (where kind in ('order', 'travel')) n, sum(gmv_net) gmv, sum(revenue_net) rn,
                     (sum(contribution) - round(sum(vo_alloc)))::bigint contrib from uf where month >= v_m0 group by month) q on q.month = g.m::date
        left join fxm on fxm.month = g.m::date),
    'cohort', (select coalesce(jsonb_agg(jsonb_build_object('cohort', to_char(c, 'YYYY-MM'), 'merchants', m, 'orders', n, 'gmv_net', gmv, 'revenue', rn) order by c), '[]'::jsonb)
        from (select date_trunc('month', m_first)::date c, count(distinct merchant_id) m, count(*) filter (where kind = 'order') n, sum(gmv_net) gmv, sum(revenue_net) rn
              from u where merchant_id is not null group by 1) q),
    'weeks', (select coalesce(jsonb_agg(jsonb_build_object('week', to_char(w.wk, 'IYYY-"W"IW'), 'from', w.wk::date, 'orders', coalesce(q.n, 0),
          'contribution', coalesce(q.contrib, 0)) order by w.wk), '[]'::jsonb)
        from generate_series(date_trunc('week', p_to::timestamp) - interval '7 weeks', date_trunc('week', p_to::timestamp), interval '1 week') w(wk)
        left join (select date_trunc('week', day::timestamp) wk, count(*) filter (where kind in ('order', 'travel')) n,
                     (sum(contribution) - round(sum(vo_alloc)))::bigint contrib from uf group by 1) q on q.wk = w.wk)
  ) into r;

  -- ----- gerbang scale-up (§7) -----
  select coalesce(sum(abs(diff)), 0) abs_diff, count(*) filter (where diff <> 0) bad_days, count(*) days into v_recon
    from v_reconciliation_daily where day between p_from and p_to;
  select count(*) filter (where settled_at is not null and settled_at - coalesce(reviewed_at, created_at) <= make_interval(hours => v_sla::int)) on_time,
         count(*) filter (where settled_at is not null or coalesce(reviewed_at, created_at) < now() - make_interval(hours => v_sla::int)) due
    into v_pay_ok from withdrawal_requests where status = 'approved' and (created_at at time zone 'Asia/Jakarta')::date between p_from and p_to;
  with a as (select distinct driver_id x from orders where status = 'completed' and driver_id is not null and (completed_at at time zone 'Asia/Jakarta')::date between p_to - 59 and p_to - 30),
       b as (select distinct driver_id x from orders where status = 'completed' and driver_id is not null and (completed_at at time zone 'Asia/Jakarta')::date between p_to - 29 and p_to)
  select (select count(*) from a) base, (select count(*) from a join b using (x)) kept into v_ret_d;
  with a as (select distinct merchant_id x from orders where status = 'completed' and merchant_id is not null and (completed_at at time zone 'Asia/Jakarta')::date between p_to - 59 and p_to - 30),
       b as (select distinct merchant_id x from orders where status = 'completed' and merchant_id is not null and (completed_at at time zone 'Asia/Jakarta')::date between p_to - 29 and p_to)
  select (select count(*) from a) base, (select count(*) from a join b using (x)) kept into v_ret_m;
  select count(*) total, count(*) filter (where payment_status = 'refunded') refunded,
         (select count(*) from fraud_flags where (created_at at time zone 'Asia/Jakarta')::date between p_from and p_to) fraud,
         (select count(*) from fraud_flags where status = 'open' and severity = 'high') fraud_high_open
    into v_ref from orders where (created_at at time zone 'Asia/Jakarta')::date between p_from and p_to;

  g := jsonb_build_object(
    'contribution_positive_8w', jsonb_build_object(
      'status', case when (select bool_and((w->>'contribution')::bigint > 0) from jsonb_array_elements(r->'weeks') w) then 'pass' else 'fail' end,
      'weeks_positive', (select count(*) from jsonb_array_elements(r->'weeks') w where (w->>'contribution')::bigint > 0), 'weeks_required', 8),
    'reconciliation_diff_zero', jsonb_build_object('status', case when v_recon.abs_diff = 0 then 'pass' else 'fail' end,
      'abs_diff', v_recon.abs_diff, 'days_with_diff', v_recon.bad_days, 'days', v_recon.days),
    'payout_on_time', jsonb_build_object(
      'status', case when v_pay_ok.due = 0 then 'no_data' when 100.0 * v_pay_ok.on_time / v_pay_ok.due >= setting_num('gate_payout_on_time_pct', 95) then 'pass' else 'fail' end,
      'pct', case when v_pay_ok.due > 0 then round(100.0 * v_pay_ok.on_time / v_pay_ok.due, 1) end, 'on_time', v_pay_ok.on_time, 'due', v_pay_ok.due,
      'target_pct', setting_num('gate_payout_on_time_pct', 95), 'sla_hours', v_sla),
    'retention_30d_driver', jsonb_build_object(
      'status', case when v_ret_d.base = 0 then 'no_data' when 100.0 * v_ret_d.kept / v_ret_d.base >= setting_num('gate_retention_driver_pct', 60) then 'pass' else 'fail' end,
      'pct', case when v_ret_d.base > 0 then round(100.0 * v_ret_d.kept / v_ret_d.base, 1) end, 'retained', v_ret_d.kept, 'base', v_ret_d.base,
      'target_pct', setting_num('gate_retention_driver_pct', 60)),
    'retention_30d_merchant', jsonb_build_object(
      'status', case when v_ret_m.base = 0 then 'no_data' when 100.0 * v_ret_m.kept / v_ret_m.base >= setting_num('gate_retention_merchant_pct', 70) then 'pass' else 'fail' end,
      'pct', case when v_ret_m.base > 0 then round(100.0 * v_ret_m.kept / v_ret_m.base, 1) end, 'retained', v_ret_m.kept, 'base', v_ret_m.base,
      'target_pct', setting_num('gate_retention_merchant_pct', 70)),
    'fraud_refund', jsonb_build_object(
      'status', case when v_ref.total = 0 then 'no_data' when 100.0 * v_ref.refunded / v_ref.total <= setting_num('gate_refund_max_pct', 2) and v_ref.fraud_high_open = 0 then 'pass' else 'fail' end,
      'refund_pct', case when v_ref.total > 0 then round(100.0 * v_ref.refunded / v_ref.total, 2) end, 'refunded_orders', v_ref.refunded, 'orders', v_ref.total,
      'fraud_flags', v_ref.fraud, 'fraud_high_open', v_ref.fraud_high_open, 'max_refund_pct', setting_num('gate_refund_max_pct', 2)));
  g := g || jsonb_build_object('scale_up_ready', not exists (select 1 from jsonb_each(g) e where e.value->>'status' <> 'pass'));

  s := jsonb_build_object(
    'take_rate_target_pct', jsonb_build_object('value', setting_num('take_rate_north_star_pct', 25), 'label', 'FAKTA SUMBER', 'note', 'North-star portofolio matang — bukan target per order dan bukan laba (§0.5)'),
    'take_rate_net_pct', jsonb_build_object('label', 'HASIL PILOT', 'note', 'Dihitung dari order_ledger periode ini'),
    'contribution_per_order', jsonb_build_object('label', 'HASIL PILOT', 'note', 'revenue_net − insentif − biaya PG platform − biaya PG hangus refund − variable_ops − payout (§0.6)'),
    'ebitda_city', jsonb_build_object('label', 'HASIL PILOT', 'note', 'contribution kota − biaya tetap kota (city_fixed_costs, pro-rata hari)'),
    'pg_fee', jsonb_build_object('label', 'FAKTA SUMBER', 'note', 'Tarif PKS Midtrans Ver.Aug-26 Pasal 6 (payment_channel_fees); PPN 11 % [ASUMSI]'),
    'ppn_pct', jsonb_build_object('value', 11, 'label', 'ASUMSI', 'note', 'Tarif efektif PPN jasa gateway — payment_channel_fees.ppn_pct'),
    'payout_fee_per_withdrawal', jsonb_build_object('value', v_payout_fee, 'label', 'ASUMSI', 'note', 'Biaya transfer pencairan per transaksi (app_settings.payout_fee_per_withdrawal) — isi dari tagihan bank/provider'),
    'variable_ops', jsonb_build_object('label', 'ASUMSI', 'note', 'city_fixed_costs kategori variable_ops dialokasikan pro-rata per order selesai bulan itu'),
    'ads_prices', jsonb_build_object('label', 'ASUMSI', 'note', 'Harga ad_products awal (Rp25.000/hari, Rp15.000/hari, Rp50.000/minggu)'),
    'gate_payout_on_time_pct', jsonb_build_object('value', setting_num('gate_payout_on_time_pct', 95), 'label', 'ASUMSI'),
    'gate_retention_driver_pct', jsonb_build_object('value', setting_num('gate_retention_driver_pct', 60), 'label', 'ASUMSI'),
    'gate_retention_merchant_pct', jsonb_build_object('value', setting_num('gate_retention_merchant_pct', 70), 'label', 'ASUMSI'),
    'gate_refund_max_pct', jsonb_build_object('value', setting_num('gate_refund_max_pct', 2), 'label', 'ASUMSI'),
    'gate_contribution_weeks', jsonb_build_object('value', 8, 'label', 'FAKTA SUMBER', 'note', '≥ 8 minggu contribution > 0 (§7)'),
    'gate_reconciliation_diff', jsonb_build_object('value', 0, 'label', 'FAKTA SUMBER', 'note', 'diff rekonsiliasi = 0 (§6/§7)'),
    'order_payment_timeout_min', jsonb_build_object('value', setting_num('order_payment_timeout_min', 15), 'label', 'ASUMSI'),
    'ride_motor_commission_cap_pct', jsonb_build_object('value', commission_cap_two_wheel(), 'label', 'FAKTA SUMBER', 'note', 'Porsi driver roda dua ≥ 92 % (§0.2)'));

  return jsonb_build_object('generated_at', now(), 'from', p_from, 'to', p_to,
      'filters', jsonb_build_object('service', v_services, 'city_id', v_cities, 'merchant_cohort', v_cohort, 'payment_method', v_pay, 'cash_digital', v_cd, 'promo_owner', v_promo),
      'definitions', jsonb_build_object(
        'gmv_net', 'Σ items_subtotal + delivery_fee + intercity_fare order selesai & tidak direfund',
        'revenue_net', 'merchant_fee + customer_platform_fee + driver_commission + service_fee_platform + ads + other − promo_platform',
        'take_rate_net_pct', 'revenue_net ÷ gmv_net × 100',
        'contribution_total', 'revenue_net − incentives − pg_fee_platform − refund_pg_cost − variable_ops − payout_fee',
        'ebitda_city', 'contribution kota − biaya tetap kota'))
    || (r - 'weeks') || jsonb_build_object('weeks', r->'weeks', 'gates', g, 'labels', s);
end $$;
revoke all on function public.skema_v2_report(date, date, jsonb) from public, anon, authenticated;

create or replace function public.exec_report_v2(p_token text, p_from date, p_to date, p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s exec_sessions;
begin
  s := exec_valid(p_token);
  if s.token is null then raise exception 'EXEC_SESSION_EXPIRED'; end if;
  return skema_v2_report(p_from, p_to, p_filters) || jsonb_build_object('level', s.level);
end $$;
revoke all on function public.exec_report_v2(text, date, date, jsonb) from public, anon;
grant execute on function public.exec_report_v2(text, date, date, jsonb) to authenticated;
comment on function public.exec_report_v2(text, date, date, jsonb) is
  'Laporan eksekutif Skema Bisnis v2 (0103, §7): token exec_login; filter {service[], city_id[], merchant_cohort, payment_method, cash_digital, promo_owner}; summary/by_city/by_service/by_payment/by_month/cohort/weeks/gates/labels dari order_ledger.';

create or replace function public.admin_exec_report_v2(p_from date, p_to date, p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Hanya admin'; end if;
  return skema_v2_report(p_from, p_to, p_filters) || jsonb_build_object('level', 'admin');
end $$;
revoke all on function public.admin_exec_report_v2(date, date, jsonb) from public, anon;
grant execute on function public.admin_exec_report_v2(date, date, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Biaya tetap kota + ringkasan EBITDA bulan itu
-- ---------------------------------------------------------------------
create or replace function public.admin_city_fixed_costs(p_month date default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_month date := date_trunc('month', coalesce(p_month, (now() at time zone 'Asia/Jakarta')::date))::date;
  v_end date := (date_trunc('month', coalesce(p_month, (now() at time zone 'Asia/Jakarta')::date)) + interval '1 month' - interval '1 day')::date;
  rep jsonb;
begin
  if not is_admin() then raise exception 'Hanya admin'; end if;
  rep := skema_v2_report(v_month, v_end, '{}'::jsonb);
  return jsonb_build_object('month', v_month,
    'rows', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'city_id', f.city_id, 'city', c.name, 'category', f.category,
        'amount', f.amount, 'note', f.note, 'updated_at', f.updated_at) order by c.name, f.category)
      from city_fixed_costs f join cities c on c.id = f.city_id where f.month = v_month), '[]'::jsonb),
    'by_city', coalesce((select jsonb_agg(jsonb_build_object('city_id', x.city_id, 'city', x.name, 'fixed', x.fixed, 'variable_ops', x.var, 'total', x.fixed + x.var) order by x.name)
      from (select f.city_id, c.name, coalesce(sum(f.amount) filter (where f.category <> 'variable_ops'), 0) fixed,
                   coalesce(sum(f.amount) filter (where f.category = 'variable_ops'), 0) var
            from city_fixed_costs f join cities c on c.id = f.city_id where f.month = v_month group by f.city_id, c.name) x), '[]'::jsonb),
    'total_fixed', (select coalesce(sum(amount), 0) from city_fixed_costs where month = v_month and category <> 'variable_ops'),
    'total_variable_ops', (select coalesce(sum(amount), 0) from city_fixed_costs where month = v_month and category = 'variable_ops'),
    'ebitda', rep->'by_city',
    'summary', jsonb_build_object('contribution_total', rep->'summary'->'contribution_total', 'fixed_costs_total', rep->'summary'->'fixed_costs_total', 'ebitda', rep->'summary'->'ebitda'));
end $$;
revoke all on function public.admin_city_fixed_costs(date) from public, anon;
grant execute on function public.admin_city_fixed_costs(date) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Penyelarasan definisi pendapatan (tambalan jangkar, gagal keras)
-- ---------------------------------------------------------------------
create or replace function public.skema_v2_splice(p_fn text, p_anchor text, p_new text, p_marker text, p_all boolean default false)
returns void language plpgsql as $$
declare def text; n int;
begin
  if (select count(*) from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace where ns.nspname = 'public' and p.proname = p_fn) > 1 then
    raise exception 'skema v2 batal: fungsi % punya lebih dari satu overload', p_fn;
  end if;
  select pg_get_functiondef(p.oid) into def from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace where ns.nspname = 'public' and p.proname = p_fn;
  if def is null then raise exception 'skema v2 batal: fungsi % tidak ditemukan', p_fn; end if;
  if position(p_marker in def) > 0 then raise notice 'skema v2: % sudah ditambal (%), dilewati', p_fn, p_marker; return; end if;
  n := (length(def) - length(replace(def, p_anchor, ''))) / greatest(1, length(p_anchor));
  if n = 0 then raise exception 'skema v2 batal: jangkar tidak ditemukan di % — tambalan TIDAK terpasang. Jangkar: %', p_fn, left(p_anchor, 120); end if;
  if n > 1 and not p_all then raise exception 'skema v2 batal: jangkar tidak unik (% kali) di %', n, p_fn; end if;
  execute replace(def, p_anchor, p_new);
end $$;

-- 5a. admin_dashboard_stats.revenue_month (bentuk tetap: angka)
select skema_v2_splice('admin_dashboard_stats',
  $a$'revenue_month', (select coalesce(sum(platform_fee + (fare_delivery - driver_earning) + (items_subtotal - merchant_earning)),0) from orders where status = 'completed' and date_trunc('month', completed_at) = date_trunc('month', now())),$a$,
  $a$'revenue_month', (select coalesce(sum(u.revenue_net), 0) from ledger_units(date_trunc('month', now() at time zone 'Asia/Jakarta')::date, (now() at time zone 'Asia/Jakarta')::date) u),   -- 0103 ledger$a$,
  '0103 ledger');

-- 5b. exec_report_data: summary.revenue, monthly[].revenue, by_service[].revenue
select skema_v2_splice('exec_report_data',
  $a$'revenue', coalesce(sum(platform_fee + (fare_delivery - driver_earning) + (items_subtotal - merchant_earning) * (merchant_id is not null)::int + coalesce(service_fee - driver_service_share, 0)) filter (where status = 'completed'), 0),$a$,
  $a$'revenue', (select coalesce(sum(u.revenue_net), 0) from ledger_units((v_from at time zone 'Asia/Jakarta')::date, (now() at time zone 'Asia/Jakarta')::date) u),   -- 0103 ledger summary$a$,
  '0103 ledger summary');
select skema_v2_splice('exec_report_data',
  $a$'revenue', coalesce((select sum(platform_fee + (fare_delivery - driver_earning) + coalesce(service_fee - driver_service_share, 0)) from orders o where o.status = 'completed' and date_trunc('month', o.created_at) = m), 0),$a$,
  $a$'revenue', (select coalesce(sum(u.revenue_net), 0) from ledger_units((m at time zone 'Asia/Jakarta')::date, ((m + interval '1 month') at time zone 'Asia/Jakarta')::date - 1) u),   -- 0103 ledger monthly$a$,
  '0103 ledger monthly');
select skema_v2_splice('exec_report_data',
  $a$coalesce(sum(platform_fee + (fare_delivery - driver_earning) + coalesce(service_fee - driver_service_share, 0)) filter (where status = 'completed'), 0) rev from orders where created_at >= v_from group by service$a$,
  $a$(select coalesce(sum(u.revenue_net), 0) from ledger_units((v_from at time zone 'Asia/Jakarta')::date, (now() at time zone 'Asia/Jakarta')::date) u where u.service = orders.service) rev from orders where created_at >= v_from group by service /* 0103 ledger by_service */$a$,
  '0103 ledger by_service');

-- 5c. pembaca order_economics → order_economics_v2 (kolom kompatibel)
select skema_v2_splice('admin_finance_cascade', $a$select * from order_economics
$a$, $a$select * from order_economics_v2   -- 0103
$a$, 'order_economics_v2');
select skema_v2_splice('admin_order_split', $a$declare e order_economics%rowtype;$a$, $a$declare e order_economics_v2%rowtype; /* 0103 */$a$, 'order_economics_v2%rowtype');
select skema_v2_splice('admin_order_split', $a$select * into e from order_economics where id = p_order;$a$, $a$select * into e from order_economics_v2 where id = p_order;$a$, 'from order_economics_v2 where');
select skema_v2_splice('exec_pnl_data', $a$select * from order_economics where created_at >= v_from$a$, $a$select * from order_economics_v2 where created_at >= v_from$a$, 'order_economics_v2');

drop function if exists public.skema_v2_splice(text, text, text, text, boolean);

-- ---------------------------------------------------------------------
-- 6. Penjaga migrasi
-- ---------------------------------------------------------------------
do $$
declare chk record; def text; miss text := ''; j jsonb;
begin
  for chk in select * from (values
      ('admin_dashboard_stats', '0103 ledger'), ('exec_report_data', '0103 ledger summary'), ('exec_report_data', '0103 ledger monthly'),
      ('exec_report_data', '0103 ledger by_service'), ('admin_finance_cascade', 'order_economics_v2'), ('admin_order_split', 'order_economics_v2%rowtype'),
      ('admin_order_split', 'from order_economics_v2 where'), ('exec_pnl_data', 'order_economics_v2')) as t(fn, marker) loop
    select pg_get_functiondef(p.oid) into def from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace where ns.nspname = 'public' and p.proname = chk.fn;
    if def is null or position(chk.marker in def) = 0 then miss := miss || chk.fn || '[' || chk.marker || '] '; end if;
  end loop;
  if miss <> '' then raise exception '0103 batal: tambalan belum terpasang: %', miss; end if;
  if exists (select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace where ns.nspname = 'public' and p.prokind = 'f'
             and p.proname in ('admin_dashboard_stats', 'exec_report_data') and pg_get_functiondef(p.oid) like '%(fare_delivery - driver_earning) + (items_subtotal - merchant_earning)),0)%') then
    raise exception '0103 batal: definisi pendapatan lama masih ada';
  end if;
  if has_function_privilege('authenticated', 'public.ledger_units(date,date)', 'EXECUTE') or has_function_privilege('authenticated', 'public.skema_v2_report(date,date,jsonb)', 'EXECUTE')
     or has_function_privilege('anon', 'public.exec_report_v2(text,date,date,jsonb)', 'EXECUTE') or has_table_privilege('authenticated', 'public.order_economics_v2', 'SELECT') then
    raise exception '0103 batal: fungsi/view internal laporan terbuka untuk klien';
  end if;
  j := skema_v2_report(current_date - 7, current_date, '{}'::jsonb);
  if not (j ? 'summary' and j ? 'by_city' and j ? 'by_service' and j ? 'by_payment' and j ? 'by_month' and j ? 'cohort' and j ? 'gates' and j ? 'labels') then
    raise exception '0103 batal: bentuk keluaran exec_report_v2 tidak lengkap';
  end if;
  if jsonb_array_length(j->'by_month') <> 12 then raise exception '0103 batal: by_month harus 12 bulan'; end if;
  raise notice '0103 ok: order_economics_v2, ledger_units, exec_report_v2/admin_exec_report_v2, pendapatan diselaraskan ke ledger';
end $$;
