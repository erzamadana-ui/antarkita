-- =====================================================================
-- 0126 — Potongan per transaksi: audit biaya platform + PPN di SEMUA layanan, tambal yang bolong, RPC partner_fee_statement
--   Keputusan GM 31 Okt 2026 (docs/KONTRAK-31OKT.md keputusan 5).
--   HASIL AUDIT (harness lokal, tiap layanan × tunai/saldo, lihat supabase/tests/uji_potongan_0126.sql):
--   • ride_motor/ride_car/food/send/shop/market/box (orders) — SUDAH BENAR: ledger_calc menulis platform_revenue (termasuk PPN inklusif
--     tax_output 0114 v5) per order; saldo: tunai → driver dipotong 'fee' = driver_receivable (order_id terisi), saldo → driver dikredit
--     'earning' = driver_payable (bersih komisi), merchant dikredit merchant_payable (bersih fee merchant). Komisi merchant food tunai
--     dipotong lewat harga yang dibayar driver ke merchant (S − fee − promo merchant) dan disetor driver — tercatat di ledger per order
--     [KEPUTUSAN GM diperlukan bila ingin merchant dipotong langsung dari saldonya: mengubah ledger_calc/driver_update_order_status
--     + uji_skema_bisnis_v2; TIDAK diubah di sini].
--   • titipan antar kota via mitra travel (travel_complete_send) — benar (tunai: setoran = total − porsi mitra; saldo: earning porsi mitra).
--   • BOLONG 1 — travel carter: travel_request_create mengabaikan `paid_via` bila `payment_method` tidak dikirim (e2e S11 hanya mengirim
--     paid_via) → permintaan tunai tercatat 'wallet': saldo pelanggan dipotong saat tawaran diterima dan mitra dikredit 'earning' —
--     potongan tunai tidak terjadi. Tambal: payment_method diturunkan dari coalesce(paid_via, payment_method).
--   • BOLONG 2 — travel kursi bersama tunai: potongan platform digabung SATU baris per trip ('Potongan platform travel (tunai)', tanpa
--     referensi booking) → tidak bisa ditampilkan per transaksi. Tambal: potongan per booking dengan ref = booking id.
--   • BOLONG 3 — mutasi saldo mitra travel (kursi & carter) tanpa referensi (order_id/ref null). Tambal: ref = id booking/permintaan.
--   • BOLONG 4 — ledger travel (ledger_post_travel) tidak memuat baris PPN (tax_output inklusif) seperti orders. Tambal: baris tax_output
--     memo (tidak mengubah keseimbangan gross = partner + revenue).
--   • RPC partner_fee_statement(p_from, p_to) → setof jsonb {order_id, code, service, completed_at, gross, platform_fee, ppn, net_to_partner,
--     paid_via, …} untuk mitra yang login (driver / pemilik merchant / mitra travel), dibaca dari order_ledger (fase completed/adjusted,
--     pembalikan ikut dijumlahkan). platform_fee + ppn = potongan platform (PPN inklusif ppn_pct). Tambahan: role, source, wallet_delta,
--     cash_held, note. partner_fee_statement_summary(p_from, p_to) → total.
-- Idempoten. Tambalan lewat _v3_splice pada BARIS KODE. Rollback: supabase/rollback/0126_down.sql
-- =====================================================================
do $$
declare s text;
begin
  foreach s in array array[
    'public.travel_request_create(jsonb)', 'public.travel_trip_set_status(uuid,text,text)', 'public.travel_request_set_status(uuid,text,text)',
    'public.ledger_post_travel(text,uuid,text,jsonb)',                                                                   -- diubah
    'public.partner_fee_statement(date,date)', 'public.partner_fee_statement_summary(date,date)'] loop                   -- baru
    perform _mig_backup('0126', s);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 1. Tambalan (jangkar baris kode)
-- ---------------------------------------------------------------------
-- BOLONG 1: carter — payment_method mengikuti paid_via bila payment_method tidak dikirim
select _v3_splice('0126', 'public.travel_request_create(jsonb)',
  $a$    case when coalesce(p->>'payment_method', 'wallet') = 'cash' then 'cash'::payment_method else 'wallet'::payment_method end, coalesce(nullif(p->>'paid_via', ''), coalesce(p->>'payment_method', 'wallet')))$a$,
  $a$    case when coalesce(nullif(p->>'paid_via', ''), p->>'payment_method', 'wallet') = 'cash' then 'cash'::payment_method else 'wallet'::payment_method end, coalesce(nullif(p->>'paid_via', ''), coalesce(p->>'payment_method', 'wallet')))$a$,
  $a$coalesce(nullif(p->>'paid_via', ''), p->>'payment_method', 'wallet') = 'cash'$a$);

-- BOLONG 2 & 3: kursi bersama — mutasi per booking dengan referensi; tunai dipotong per booking (akumulasi v_fee_total menjadi 0 → no-op)
select _v3_splice('0126', 'public.travel_trip_set_status(uuid,text,text)',
  $a$        perform wallet_apply(t.partner_id, 'earning', b.partner_earning, null, 'Pendapatan travel ' || b.code);$a$,
  $a$        perform wallet_apply(t.partner_id, 'earning', b.partner_earning, null, 'Pendapatan travel ' || b.code, b.id::text);$a$,
  $a$'Pendapatan travel ' || b.code, b.id::text$a$);
select _v3_splice('0126', 'public.travel_trip_set_status(uuid,text,text)',
  $a$        v_fee_total := v_fee_total + (b.price - b.partner_earning);$a$,
  $a$        if b.price - b.partner_earning <> 0 then perform wallet_apply(t.partner_id, 'fee', -(b.price - b.partner_earning), null, 'Potongan platform travel (tunai) ' || b.code, b.id::text); end if;$a$,
  $a$'Potongan platform travel (tunai) ' || b.code$a$);

-- BOLONG 3: carter — referensi permintaan pada mutasi saldo mitra
select _v3_splice('0126', 'public.travel_request_set_status(uuid,text,text)',
  $a$      perform wallet_apply(o.partner_id, 'earning', r.partner_earning, null, 'Pendapatan travel ' || r.code);$a$,
  $a$      perform wallet_apply(o.partner_id, 'earning', r.partner_earning, null, 'Pendapatan travel ' || r.code, r.id::text);$a$,
  $a$'Pendapatan travel ' || r.code, r.id::text$a$);
select _v3_splice('0126', 'public.travel_request_set_status(uuid,text,text)',
  $a$      perform wallet_apply(o.partner_id, 'fee', -r.platform_fee, null, 'Komisi platform travel ' || r.code);$a$,
  $a$      perform wallet_apply(o.partner_id, 'fee', -r.platform_fee, null, 'Komisi platform travel ' || r.code, r.id::text);$a$,
  $a$'Komisi platform travel ' || r.code, r.id::text$a$);

-- BOLONG 4: PPN inklusif (memo) pada ledger travel — pola 0114 v5 (tidak ikut rumus keseimbangan ledger_check_source)
select _v3_splice('0126', 'public.ledger_post_travel(text,uuid,text,jsonb)',
  $a$    v_rows := v_rows || jsonb_build_object('entry', 'platform_revenue', 'amount', rev, 'party_role', 'platform', 'note', 'biaya platform ' || PF || ' + fee mitra ' || fee);$a$,
  $a$    v_rows := v_rows || jsonb_build_object('entry', 'platform_revenue', 'amount', rev, 'party_role', 'platform', 'note', 'biaya platform ' || PF || ' + fee mitra ' || fee);
    if rev > 0 and setting_num('ppn_pct', 11) > 0 and coalesce((select lower(value #>> '{}') = 'true' from app_settings where key = 'ppn_inclusive'), true) then
      v_rows := v_rows || jsonb_build_object('entry', 'tax_output', 'amount', -round(rev * setting_num('ppn_pct', 11) / (100 + setting_num('ppn_pct', 11)))::bigint, 'party_role', 'platform', 'funded_by', 'inclusive',
        'note', 'PPN ' || setting_num('ppn_pct', 11) || '% termasuk dalam pendapatan platform ' || rev || ' (0126)');
    end if;$a$,
  $a$termasuk dalam pendapatan platform ' || rev || ' (0126)$a$);

-- ---------------------------------------------------------------------
-- 2. Laporan potongan per transaksi untuk mitra yang login
-- ---------------------------------------------------------------------
create or replace function public.partner_fee_statement(p_from date default null, p_to date default null)
returns setof jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_from timestamptz; v_to timestamptz; v_ppn numeric := setting_num('ppn_pct', 11);
        v_incl boolean := coalesce((select lower(value #>> '{}') = 'true' from app_settings where key = 'ppn_inclusive'), true);
begin
  if v_uid is null then raise exception 'Harus login'; end if;
  v_from := (coalesce(p_from, (now() at time zone 'Asia/Jakarta')::date - 30)::timestamp at time zone 'Asia/Jakarta');
  v_to   := ((coalesce(p_to, (now() at time zone 'Asia/Jakarta')::date) + 1)::timestamp at time zone 'Asia/Jakarta');
  return query
  with led as (
    -- fase terakhir (completed/adjusted) per sumber; pembalikan ikut dijumlahkan sehingga sum = nilai aktif
    select l.source, l.source_id, l.order_id,
           coalesce(sum(amount) filter (where entry = 'delivery_fee'), 0)                               as fare,
           coalesce(sum(amount) filter (where entry = 'tip'), 0)                                        as tip,
           coalesce(sum(amount) filter (where entry = 'extras'), 0)                                     as extras,
           coalesce(sum(amount) filter (where entry = 'driver_commission'), 0)                          as commission,
           coalesce(-sum(amount) filter (where entry = 'adjustment' and party_role = 'driver'), 0)      as bonus,
           coalesce(-sum(amount) filter (where entry = 'driver_payable'), 0)                            as driver_payable,
           coalesce(sum(amount) filter (where entry = 'items_subtotal'), 0)                             as items,
           coalesce(sum(amount) filter (where entry = 'merchant_fee'), 0)                               as merchant_fee,
           coalesce(-sum(amount) filter (where entry = 'promo_merchant'), 0)                            as promo_merchant,
           coalesce(-sum(amount) filter (where entry = 'merchant_payable'), 0)                          as merchant_payable,
           coalesce(sum(amount) filter (where entry = 'intercity_fare'), 0)                             as intercity,
           coalesce(sum(amount) filter (where entry = 'customer_platform_fee'), 0)                      as cust_pf,
           coalesce(-sum(amount) filter (where entry = 'partner_payable'), 0)                           as partner_payable,
           coalesce(sum(amount) filter (where entry = 'driver_receivable'), 0)                          as receivable,
           coalesce(sum(amount) filter (where entry = 'platform_revenue'), 0)                           as revenue,
           coalesce(-sum(amount) filter (where entry = 'tax_output' and funded_by = 'inclusive'), 0)    as tax_incl,
           min(created_at) filter (where reversal_of is null)                                           as posted_at
      from order_ledger l
     where l.phase = (select x.phase from order_ledger x where x.source = l.source and x.source_id = l.source_id and x.phase in ('completed', 'adjusted') order by x.id desc limit 1)
     group by l.source, l.source_id, l.order_id
  ), rows_ as (
    -- (a) driver: order yang ia selesaikan
    select 'driver'::text as role, 'orders'::text as source, o.id as order_id, o.id as source_id, o.code, o.service::text as service, o.completed_at, o.payment_method::text as paid_via,
           (d.driver_payable + d.commission - d.bonus) as gross,   -- = ongkir + tip + extras + jasa belanja driver (sebelum komisi)
           (d.commission - d.bonus) as fee, d.driver_payable as net,
           case when o.payment_method = 'cash' then -d.receivable else d.driver_payable end as wallet_delta,
           case when o.payment_method = 'cash' then o.total else 0 end as cash_held,
           case when o.payment_method = 'cash' then 'Tunai dipegang driver; setoran ke platform dipotong dari saldo' else 'Pendapatan bersih dikredit ke saldo' end as note
      from orders o join led d on d.source = 'orders' and d.source_id = o.id
     where o.driver_id = v_uid and o.status::text = 'completed' and o.completed_at >= v_from and o.completed_at < v_to
    union all
    -- (b) pemilik merchant: pesanan merchant miliknya
    select 'merchant', 'orders', o.id, o.id, o.code, o.service::text, o.completed_at, o.payment_method::text,
           d.items, d.merchant_fee, d.merchant_payable,
           case when o.payment_method = 'cash' then 0 else d.merchant_payable end,
           case when o.payment_method = 'cash' then d.merchant_payable else 0 end,
           case when o.payment_method = 'cash' then 'Dibayar driver tunai sebesar nilai pesanan − fee merchant' || case when d.promo_merchant > 0 then ' − promo merchant ' || d.promo_merchant else '' end
                else 'Nilai pesanan − fee merchant' || case when d.promo_merchant > 0 then ' − promo merchant ' || d.promo_merchant else '' end || ' dikredit ke saldo' end
      from orders o join led d on d.source = 'orders' and d.source_id = o.id
     where o.merchant_id in (select m.id from merchants m where m.owner_id = v_uid) and o.status::text = 'completed' and o.completed_at >= v_from and o.completed_at < v_to
    union all
    -- (c) mitra travel: titipan antar kota (orders.travel_partner_id)
    select 'travel', 'orders', o.id, o.id, o.code, 'travel_send', o.completed_at, o.payment_method::text,
           d.intercity, d.intercity - d.partner_payable, d.partner_payable,
           case when o.payment_method = 'cash' then -d.receivable else d.partner_payable end,
           case when o.payment_method = 'cash' then o.total else 0 end,
           case when o.payment_method = 'cash' then 'Tunai dipegang mitra; setoran dipotong dari saldo' else 'Porsi mitra dikredit ke saldo' end
      from orders o join led d on d.source = 'orders' and d.source_id = o.id
     where o.travel_partner_id = v_uid and o.driver_id is null and o.status::text = 'completed' and o.completed_at >= v_from and o.completed_at < v_to
    union all
    -- (d) mitra travel: kursi bersama (travel_bookings)
    select 'travel', 'travel_bookings', null::uuid, b.id, b.code, 'travel_shared', d.posted_at, b.payment_method::text,
           d.intercity, d.intercity - d.partner_payable, d.partner_payable,
           case when b.payment_method = 'cash' then -d.revenue else d.partner_payable end,   -- tunai: setoran = fee mitra + biaya platform pelanggan yang dipegang mitra
           case when b.payment_method = 'cash' then d.intercity + d.cust_pf else 0 end,
           case when b.payment_method = 'cash' then 'Tunai dipegang mitra; potongan platform dipotong dari saldo per booking' else 'Porsi mitra dikredit ke saldo' end
      from travel_bookings b join travel_trips t on t.id = b.trip_id join led d on d.source = 'travel_bookings' and d.source_id = b.id
     where t.partner_id = v_uid and b.status = 'completed' and d.posted_at >= v_from and d.posted_at < v_to
    union all
    -- (e) mitra travel: carter (travel_requests)
    select 'travel', 'travel_requests', null::uuid, r.id, r.code, 'travel_charter', d.posted_at, r.payment_method::text,
           d.intercity, d.intercity - d.partner_payable, d.partner_payable,
           case when r.payment_method = 'cash' then -(d.intercity - d.partner_payable) else d.partner_payable end,
           case when r.payment_method = 'cash' then d.intercity else 0 end,
           case when r.payment_method = 'cash' then 'Tunai dipegang mitra; komisi platform dipotong dari saldo' else 'Porsi mitra dikredit ke saldo' end
      from travel_requests r join led d on d.source = 'travel_requests' and d.source_id = r.id
     where r.status = 'completed' and d.posted_at >= v_from and d.posted_at < v_to
       and coalesce((select o.partner_id from travel_offers o where o.id = r.accepted_offer_id), r.partner_id) = v_uid
  )
  select jsonb_build_object(
    'order_id', x.order_id, 'source', x.source, 'source_id', x.source_id, 'code', x.code, 'service', x.service, 'role', x.role,
    'completed_at', x.completed_at, 'gross', x.gross,
    'platform_fee', case when v_incl and v_ppn > 0 then x.fee - round(x.fee * v_ppn / (100 + v_ppn))::bigint else x.fee end,
    'ppn', case when v_incl and v_ppn > 0 then round(x.fee * v_ppn / (100 + v_ppn))::bigint else 0 end,
    'fee_total', x.fee, 'net_to_partner', x.net, 'paid_via', x.paid_via, 'wallet_delta', x.wallet_delta, 'cash_held', x.cash_held, 'note', x.note)
    from rows_ x
   order by x.completed_at desc nulls last, x.code;
end $$;
revoke all on function public.partner_fee_statement(date, date) from public, anon;
grant execute on function public.partner_fee_statement(date, date) to authenticated;
comment on function public.partner_fee_statement(date, date) is
  '0126: potongan per transaksi untuk mitra yang login (driver/merchant/mitra travel) dari order_ledger. platform_fee + ppn = potongan platform (PPN inklusif ppn_pct); net_to_partner = yang menjadi hak mitra; wallet_delta = mutasi saldo AntarVoucher (tunai: negatif = setoran).';

create or replace function public.partner_fee_statement_summary(p_from date default null, p_to date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  select jsonb_build_object(
    'from', coalesce(p_from, (now() at time zone 'Asia/Jakarta')::date - 30), 'to', coalesce(p_to, (now() at time zone 'Asia/Jakarta')::date),
    'count', count(*), 'gross', coalesce(sum((x->>'gross')::bigint), 0), 'platform_fee', coalesce(sum((x->>'platform_fee')::bigint), 0),
    'ppn', coalesce(sum((x->>'ppn')::bigint), 0), 'fee_total', coalesce(sum((x->>'fee_total')::bigint), 0),
    'net_to_partner', coalesce(sum((x->>'net_to_partner')::bigint), 0), 'wallet_delta', coalesce(sum((x->>'wallet_delta')::bigint), 0),
    'cash_held', coalesce(sum((x->>'cash_held')::bigint), 0),
    'cash_count', count(*) filter (where x->>'paid_via' = 'cash'), 'wallet_count', count(*) filter (where x->>'paid_via' <> 'cash'),
    'by_service', coalesce((select jsonb_object_agg(s.service, s.n) from (select x2->>'service' as service, count(*) as n from partner_fee_statement(p_from, p_to) x2 group by 1) s), '{}'::jsonb))
    into r from partner_fee_statement(p_from, p_to) x;
  return r;
end $$;
revoke all on function public.partner_fee_statement_summary(date, date) from public, anon;
grant execute on function public.partner_fee_statement_summary(date, date) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Penjaga
-- ---------------------------------------------------------------------
do $$
begin
  if position($m$coalesce(nullif(p->>'paid_via', ''), p->>'payment_method', 'wallet') = 'cash'$m$ in pg_get_functiondef('public.travel_request_create(jsonb)'::regprocedure)) = 0 then raise exception '0126 batal: travel_request_create belum ditambal'; end if;
  if position('Potongan platform travel (tunai) '' || b.code' in pg_get_functiondef('public.travel_trip_set_status(uuid,text,text)'::regprocedure)) = 0
     or position('b.code, b.id::text' in pg_get_functiondef('public.travel_trip_set_status(uuid,text,text)'::regprocedure)) = 0 then raise exception '0126 batal: travel_trip_set_status belum ditambal'; end if;
  if position('r.code, r.id::text' in pg_get_functiondef('public.travel_request_set_status(uuid,text,text)'::regprocedure)) = 0 then raise exception '0126 batal: travel_request_set_status belum ditambal'; end if;
  if position('(0126)' in pg_get_functiondef('public.ledger_post_travel(text,uuid,text,jsonb)'::regprocedure)) = 0 then raise exception '0126 batal: ledger_post_travel belum memuat PPN'; end if;
  if to_regprocedure('public.partner_fee_statement(date,date)') is null or to_regprocedure('public.partner_fee_statement_summary(date,date)') is null then raise exception '0126 batal: RPC laporan belum ada'; end if;
  raise notice '0126 ok: tambalan travel terpasang, partner_fee_statement siap';
end $$;
