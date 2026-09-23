-- =====================================================================
-- 0099 — BUKU BESAR PER ORDER (`order_ledger`) — Skema Bisnis v2
--
-- Sumber: docs/SKEMA-BISNIS-V2-SPEK.md §0, §2, §9 (keputusan 23 Sep 2026).
--
-- Sebelum ini uang hanya bergerak lewat wallet_apply dan `order_economics`
-- merekonstruksi angka dari kolom orders — driver_earning DITIMPA saat selesai,
-- promo 100 % ditanggung platform secara implisit, komisi tidak di-snapshot.
-- Sekarang:
--   • orders menyimpan SNAPSHOT aturan saat dibuat (driver_commission_pct_snap,
--     merchant_fee_pct_snap, promo_funded_by, pg_channel, pg_fee, pg_fee_borne_by,
--     ledger_version=2) dan driver_earning TIDAK ditimpa lagi (driver_earning_final).
--   • order_ledger = satu sumber kebenaran alokasi uang per order per fase
--     (created → adjusted → completed | cancelled/refunded), ditulis ledger_post
--     (idempoten per fase: hapus fase yang sama lalu tulis ulang).
--   • Kredit/debit dompet saat selesai DITURUNKAN dari ledger (driver_payable,
--     merchant_payable, vendor_payable, driver_receivable) — bukan dihitung ulang inline.
--
-- RUMUS KESEIMBANGAN (ledger_check, fase created/adjusted/completed):
--   gross_customer            = total + tip                                       (+, dibayar pelanggan)
--   komponen                  : items_subtotal + delivery_fee + customer_platform_fee + service_fee
--                               + intercity_fare + tip + extras − promo(platform+merchant+sponsor)
--                               + pg_fee_pelanggan  (= gross_customer)
--   driver_commission (C)     = floor(delivery_fee × driver_commission_pct_snap / 100)
--   bonus sesi (B)            = least(C, floor(delivery_fee × driver_bonus_pct / 100))  → entry 'adjustment' (−, driver)
--   merchant_fee (M)          = floor(items_subtotal × merchant_fee_pct_snap / 100)   (hanya bila ada merchant)
--   promo_merchant (Dm)       = least(discount, items_subtotal − M) bila promo_funded_by = 'merchant'
--   promo_sponsor (Ds)        = discount bila promo_funded_by = 'sponsor'; promo_platform (Dp) = discount − Dm − Ds
--   driver_payable            = (delivery_fee − C + B) + tip + extras + driver_service_share    (0 bila tanpa driver)
--   merchant_payable          = items_subtotal − M − Dm                                (food)
--   vendor_payable            = items_subtotal                                          (shop/market: reimburse driver yang menalangi)
--   partner_payable           = round(intercity_fare × travel_send_partner_pct / 100)   (titipan via mitra travel)
--   platform_revenue (R)      = customer_platform_fee + (C − B) + M + (service_fee − driver_service_share)
--                               + (intercity_fare − partner_payable) + [delivery_fee bila tanpa driver] − Dp
--   pg_fee, pg_fee_ppn        = biaya gateway (−, funded_by = pg_fee_borne_by); bila 'customer' ikut menambah total
--   KESEIMBANGAN: gross_customer + Ds = driver_payable + merchant_payable + vendor_payable + partner_payable
--                                       + platform_revenue + (pg_fee + pg_fee_ppn bila ditanggung pelanggan)
--   contribution (§0.6)       = platform_revenue − (pg_fee + pg_fee_ppn bila ditanggung platform)
--   driver_receivable (tunai) = total − vendor_payable − merchant_payable − (driver_payable − tip)
--                               → didebit wallet_apply(driver,'fee') seperti sebelumnya, kini tercatat.
--
-- Isi:
--   1. Skema: promos.funded_by, kolom orders, enum ledger_entry, tabel order_ledger + RLS
--   2. pg_fee_calc (guard: tabel payment_channel_fees dibuat 0100 — bila belum ada → 0,0)
--   3. shopping_service_fee / shopping_driver_share membaca service_economics
--   4. Inti: ledger_calc (murni), ledger_post, ledger_post_travel, ledger_check, ledger_simulate,
--      driver_order_breakdown, merchant_order_breakdown
--   5. Tambalan fungsi lama (pg_get_functiondef + jangkar + penjaga gagal keras, pola 0089/0096):
--      create_order, driver_update_order_status, cancel_order, merchant_update_order, set_shopping_actual,
--      add_tip, driver_set_online, driver_accept_order, travel_book, travel_offer_accept, travel_trip_set_status,
--      travel_booking_cancel, travel_request_set_status, travel_complete_send, estimate_fare, fare_options,
--      shopping_estimate, driver_earnings_summary, view order_economics
--   6. Penjaga migrasi
-- Semua blok idempoten (aman dijalankan ulang).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Skema
-- ---------------------------------------------------------------------
alter table public.promos add column if not exists funded_by text not null default 'platform';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'promos_funded_by_check') then
    alter table public.promos add constraint promos_funded_by_check check (funded_by in ('platform','merchant','sponsor'));
  end if;
end $$;
comment on column public.promos.funded_by is 'Pemilik biaya promo (0099): platform | merchant | sponsor. Promo bukan pendapatan (§0.3).';

alter table public.orders add column if not exists driver_commission_pct_snap numeric(5,2);
alter table public.orders add column if not exists merchant_fee_pct_snap numeric(5,2);
alter table public.orders add column if not exists promo_funded_by text;
alter table public.orders add column if not exists pg_channel text;
alter table public.orders add column if not exists pg_fee bigint not null default 0;
alter table public.orders add column if not exists pg_fee_ppn bigint not null default 0;
alter table public.orders add column if not exists pg_fee_borne_by text;
alter table public.orders add column if not exists driver_earning_final bigint;
-- ledger_version: baris lama (sebelum 0099) = 1 (driver_earning sudah ditimpa saat selesai),
-- baris baru = 2 (driver_earning = dasar, driver_earning_final = akhir). Default kolom diset
-- 1 dulu supaya baris yang sudah ada mendapat 1, lalu default diubah ke 2 untuk baris baru.
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'orders' and column_name = 'ledger_version') then
    alter table public.orders add column ledger_version int not null default 1;
    alter table public.orders alter column ledger_version set default 2;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'orders_promo_funded_by_check') then
    alter table public.orders add constraint orders_promo_funded_by_check check (promo_funded_by is null or promo_funded_by in ('platform','merchant','sponsor'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'orders_pg_fee_borne_by_check') then
    alter table public.orders add constraint orders_pg_fee_borne_by_check check (pg_fee_borne_by is null or pg_fee_borne_by in ('platform','customer'));
  end if;
end $$;
comment on column public.orders.driver_earning is 'Pendapatan DASAR driver dari ongkir (ongkir − komisi) saat order dibuat. Sejak 0099 TIDAK ditimpa saat selesai — lihat driver_earning_final.';
comment on column public.orders.driver_earning_final is 'Pendapatan akhir driver saat selesai (= driver_payable di order_ledger): ongkir bersih + tip + extras + bagian jasa belanja + bonus sesi.';
comment on column public.orders.ledger_version is '1 = order sebelum 0099 (driver_earning ditimpa saat selesai); 2 = alokasi lewat order_ledger.';

do $$
begin
  if not exists (select 1 from pg_type where typname = 'ledger_entry') then
    create type public.ledger_entry as enum (
      'gross_customer', 'items_subtotal', 'delivery_fee',
      'customer_platform_fee', 'service_fee', 'intercity_fare', 'tip', 'extras',
      'promo_platform', 'promo_merchant', 'promo_sponsor',
      'driver_commission', 'merchant_fee',
      'driver_payable', 'merchant_payable', 'vendor_payable', 'partner_payable',
      'platform_revenue', 'pg_fee', 'pg_fee_ppn', 'driver_receivable',
      'refund', 'adjustment', 'ads_revenue');
  end if;
end $$;

create table if not exists public.order_ledger (
  id          bigserial primary key,
  order_id    uuid references public.orders(id) on delete cascade,
  source      text not null default 'orders' check (source in ('orders','travel_bookings','travel_requests','merchant_ads')),
  source_id   uuid,
  service     service_type,
  city_id     uuid,
  city        text,
  entry       ledger_entry not null,
  amount      bigint not null,
  party_role  text check (party_role in ('customer','driver','merchant','vendor','partner','platform','gateway','sponsor')),
  party_id    uuid,
  funded_by   text,
  phase       text not null check (phase in ('created','completed','cancelled','refunded','settled','adjusted')),
  pg_channel  text,
  note        text,
  created_at  timestamptz not null default now()
);
create index if not exists order_ledger_order_idx on public.order_ledger (order_id);
create index if not exists order_ledger_created_idx on public.order_ledger (created_at);
create index if not exists order_ledger_service_phase_idx on public.order_ledger (service, phase);
create index if not exists order_ledger_source_idx on public.order_ledger (source, source_id) where source_id is not null;
create index if not exists order_ledger_party_idx on public.order_ledger (party_id) where party_id is not null;
comment on table public.order_ledger is
  'Buku besar per order (0099): satu baris per komponen/alokasi per fase. Tanda: (+) uang masuk/hak platform, (−) keluar/kewajiban ke mitra. Ditulis hanya oleh ledger_post/ledger_post_travel (security definer); klien tidak menulis.';

alter table public.order_ledger enable row level security;
drop policy if exists order_ledger_select on public.order_ledger;
create policy order_ledger_select on public.order_ledger for select to authenticated
  using (is_admin() or party_id = auth.uid());
-- default privileges Supabase memberi anon/authenticated ALL (termasuk TRUNCATE yang TIDAK tunduk RLS)
-- → cabut semuanya, lalu beri authenticated hanya SELECT (RLS: admin semua; mitra hanya baris party_id miliknya)
revoke all on public.order_ledger from public, anon, authenticated;
grant select on public.order_ledger to authenticated;
grant all on public.order_ledger to service_role;
revoke all on sequence public.order_ledger_id_seq from public, anon, authenticated;
grant usage, select on sequence public.order_ledger_id_seq to service_role;

-- ---------------------------------------------------------------------
-- 2. pg_fee_calc — biaya gateway dari payment_channel_fees (dibuat migrasi 0100).
--    Aman urutan: bila tabelnya belum ada → (0, 0). 0100 boleh mendefinisikan ulang.
-- ---------------------------------------------------------------------
create or replace function public.pg_fee_calc(p_channel text, p_amount bigint)
returns table(fee bigint, ppn bigint)
language plpgsql stable security definer set search_path = public as $$
declare v_pct numeric; v_fixed bigint; v_incl boolean; v_ppn_pct numeric; v_active boolean; v_rows int := 0;
begin
  fee := 0; ppn := 0;
  if p_channel is null or p_amount is null or p_amount <= 0 or to_regclass('public.payment_channel_fees') is null then
    return next; return;   -- tabel belum ada (sebelum 0100) → (0,0): create_order tetap jalan
  end if;
  begin
    execute 'select fee_pct, fee_fixed, ppn_included, ppn_pct, active from public.payment_channel_fees where channel = $1 limit 1'
      into v_pct, v_fixed, v_incl, v_ppn_pct, v_active using lower(trim(p_channel));
    get diagnostics v_rows = row_count;
  exception when undefined_column or undefined_table then
    -- bentuk tabel 0100 berbeda dari yang diandaikan di sini → jangan gagalkan order; 0100 wajib mendefinisikan ulang fungsi ini
    raise warning 'pg_fee_calc: payment_channel_fees tidak cocok (%) → biaya 0', sqlerrm;
    return next; return;
  end;
  if v_rows = 0 or coalesce(v_active, true) = false then return next; return; end if;
  fee := round(p_amount * coalesce(v_pct, 0) / 100.0)::bigint + coalesce(v_fixed, 0);
  ppn := case when coalesce(v_incl, false) then 0 else round(fee * coalesce(v_ppn_pct, 11) / 100.0)::bigint end;
  return next;
end $$;
grant execute on function public.pg_fee_calc(text, bigint) to anon, authenticated;
comment on function public.pg_fee_calc(text, bigint) is
  'Biaya payment gateway (fee, ppn) untuk saluran & nominal (PKS Midtrans). Membaca payment_channel_fees (0100); bila tabel belum ada → (0,0).';

-- ---------------------------------------------------------------------
-- 3. Jasa belanja shop/market membaca service_economics (fallback setelan 0013)
-- ---------------------------------------------------------------------
create or replace function public.shopping_service_fee(p_service service_type, p_subtotal bigint)
returns bigint language sql stable set search_path = public, pg_temp as $$
  select greatest(
    coalesce((select service_fee_min from service_economics where service = p_service),
             case when p_service = 'market' then setting_num('market_service_min', 8000) else setting_num('shop_service_min', 5000) end)::bigint,
    floor(p_subtotal * coalesce((select service_fee_pct from service_economics where service = p_service),
             case when p_service = 'market' then setting_num('market_service_pct', 10) else setting_num('shop_service_pct', 5) end) / 100.0)::bigint);
$$;

create or replace function public.shopping_driver_share(p_service service_type, p_fee bigint)
returns bigint language sql stable set search_path = public, pg_temp as $$
  select floor(p_fee * coalesce((select service_fee_driver_share_pct from service_economics where service = p_service),
             case when p_service = 'market' then setting_num('market_driver_share_pct', 70) else setting_num('shop_driver_share_pct', 70) end) / 100.0)::bigint;
$$;

-- ---------------------------------------------------------------------
-- 4. Inti buku besar
-- ---------------------------------------------------------------------
-- 4a. ledger_calc: perhitungan MURNI dari satu baris orders (boleh baris sintetis untuk simulasi).
--     Keluaran: ringkasan angka + 'entries' (baris yang akan ditulis).
create or replace function public.ledger_calc(o orders)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  se service_economics; pr pricing; ses pricing_sessions;
  F bigint := coalesce(o.fare_delivery, 0); PF bigint := coalesce(o.platform_fee, 0); S bigint := coalesce(o.items_subtotal, 0);
  SF bigint := coalesce(o.service_fee, 0); dshare bigint := coalesce(o.driver_service_share, 0); IC bigint := coalesce(o.intercity_fare, 0);
  D bigint := coalesce(o.discount, 0); T bigint := coalesce(o.tip, 0); X bigint := coalesce(o.extras_total, 0); tot bigint := coalesce(o.total, 0);
  dc numeric; mf numeric; C bigint; B bigint := 0; M bigint := 0; Dm bigint := 0; Ds bigint := 0; Dp bigint;
  funded text; has_driver boolean; vendor bigint := 0; merch bigint := 0; partner bigint := 0; ic_platform bigint; f_platform bigint := 0;
  sf_platform bigint; drv bigint := 0; R bigint; pgf bigint := coalesce(o.pg_fee, 0); pgp bigint := coalesce(o.pg_fee_ppn, 0);
  borne text := coalesce(o.pg_fee_borne_by, 'platform'); pg_cust bigint; gross bigint; recv bigint := 0; comp bigint;
  owner uuid; sess_note text := null; e jsonb := '[]'::jsonb; is_cash boolean := (o.payment_method = 'cash');
begin
  select * into se from service_economics where service = o.service;
  select * into pr from pricing where service = o.service;
  dc := coalesce(o.driver_commission_pct_snap, se.driver_commission_pct, pr.commission_pct, 0);
  mf := coalesce(o.merchant_fee_pct_snap, se.merchant_fee_pct, pr.merchant_commission_pct, 0);
  has_driver := (o.driver_id is not null) or (o.travel_partner_id is null);   -- sebelum diterima: dianggap akan ada driver
  C := floor(F * dc / 100.0)::bigint;
  if o.created_at is not null then
    ses := current_pricing_session(o.service, o.created_at);
    if ses.id is not null and coalesce(ses.driver_bonus_pct, 0) > 0 then
      B := least(C, floor(F * ses.driver_bonus_pct / 100.0)::bigint);
      sess_note := 'Bonus sesi ' || ses.name || ' ' || ses.driver_bonus_pct || '%';
    end if;
  end if;
  if o.merchant_id is not null then
    M := floor(S * mf / 100.0)::bigint;
    select owner_id into owner from merchants where id = o.merchant_id;
  end if;
  funded := coalesce(o.promo_funded_by, 'platform');
  if funded = 'merchant' and o.merchant_id is null then funded := 'platform'; end if;
  if funded = 'merchant' then Dm := least(D, greatest(0, S - M)); elsif funded = 'sponsor' then Ds := D; end if;
  Dp := D - Dm - Ds;
  if o.service in ('shop', 'market') then vendor := S; end if;
  if o.merchant_id is not null then merch := S - M - Dm; end if;
  if o.travel_partner_id is not null then partner := round(IC * setting_num('travel_send_partner_pct', 80) / 100.0)::bigint; end if;
  ic_platform := IC - partner;
  if has_driver then
    drv := (F - C + B) + T + X + dshare; sf_platform := SF - dshare;
  else
    f_platform := F; sf_platform := SF; C := 0; B := 0;   -- tanpa driver (titipan via mitra travel): ongkir & jasa ke platform
  end if;
  pg_cust := case when borne = 'customer' then pgf + pgp else 0 end;
  R := PF + (C - B) + M + sf_platform + ic_platform + f_platform - Dp;
  gross := tot + T;
  comp := S + F + PF + SF + IC + T + X - D + pg_cust;
  if is_cash then
    if has_driver then recv := tot - vendor - merch - (drv - T);
    elsif o.travel_partner_id is not null then recv := tot - partner; end if;
  end if;

  -- baris buku besar (hanya yang tidak nol; gross_customer selalu ditulis)
  e := e || jsonb_build_object('entry', 'gross_customer', 'amount', gross, 'party_role', 'customer', 'party_id', o.customer_id, 'note', 'total ' || tot || ' + tip ' || T);
  if S <> 0 then e := e || jsonb_build_object('entry', 'items_subtotal', 'amount', S, 'party_role', 'customer', 'party_id', o.customer_id); end if;
  if F <> 0 then e := e || jsonb_build_object('entry', 'delivery_fee', 'amount', F, 'party_role', 'customer', 'party_id', o.customer_id); end if;
  if PF <> 0 then e := e || jsonb_build_object('entry', 'customer_platform_fee', 'amount', PF, 'party_role', 'customer', 'party_id', o.customer_id); end if;
  if SF <> 0 then e := e || jsonb_build_object('entry', 'service_fee', 'amount', SF, 'party_role', 'customer', 'party_id', o.customer_id); end if;
  if IC <> 0 then e := e || jsonb_build_object('entry', 'intercity_fare', 'amount', IC, 'party_role', 'customer', 'party_id', o.customer_id); end if;
  if T <> 0 then e := e || jsonb_build_object('entry', 'tip', 'amount', T, 'party_role', 'customer', 'party_id', o.customer_id); end if;
  if X <> 0 then e := e || jsonb_build_object('entry', 'extras', 'amount', X, 'party_role', 'customer', 'party_id', o.customer_id); end if;
  if Dp <> 0 then e := e || jsonb_build_object('entry', 'promo_platform', 'amount', -Dp, 'party_role', 'platform', 'funded_by', 'platform', 'note', o.promo_code); end if;
  if Dm <> 0 then e := e || jsonb_build_object('entry', 'promo_merchant', 'amount', -Dm, 'party_role', 'merchant', 'party_id', owner, 'funded_by', 'merchant', 'note', o.promo_code); end if;
  if Ds <> 0 then e := e || jsonb_build_object('entry', 'promo_sponsor', 'amount', -Ds, 'party_role', 'sponsor', 'funded_by', 'sponsor', 'note', o.promo_code); end if;
  if C <> 0 then e := e || jsonb_build_object('entry', 'driver_commission', 'amount', C, 'party_role', 'platform', 'note', 'komisi ' || dc || '% dari ongkir ' || F); end if;
  if B <> 0 then e := e || jsonb_build_object('entry', 'adjustment', 'amount', -B, 'party_role', 'driver', 'party_id', o.driver_id, 'note', sess_note); end if;
  if M <> 0 then e := e || jsonb_build_object('entry', 'merchant_fee', 'amount', M, 'party_role', 'platform', 'note', 'fee merchant ' || mf || '% dari ' || S); end if;
  if drv <> 0 then e := e || jsonb_build_object('entry', 'driver_payable', 'amount', -drv, 'party_role', 'driver', 'party_id', o.driver_id,
      'note', 'ongkir bersih ' || (F - C + B) || ' + tip ' || T || ' + extras ' || X || ' + jasa belanja ' || dshare || case when is_cash then ' (tunai: dipegang driver)' else '' end); end if;
  if merch <> 0 then e := e || jsonb_build_object('entry', 'merchant_payable', 'amount', -merch, 'party_role', 'merchant', 'party_id', owner,
      'note', 'nilai pesanan ' || S || ' − fee ' || M || ' − promo merchant ' || Dm || case when is_cash then ' (tunai: dibayar driver ke merchant)' else '' end); end if;
  if vendor <> 0 then e := e || jsonb_build_object('entry', 'vendor_payable', 'amount', -vendor, 'party_role', 'vendor', 'party_id', o.driver_id,
      'note', 'penggantian belanja yang ditalangi driver di toko/pasar'); end if;
  if partner <> 0 then e := e || jsonb_build_object('entry', 'partner_payable', 'amount', -partner, 'party_role', 'partner', 'party_id', o.travel_partner_id,
      'note', 'porsi mitra travel ' || setting_num('travel_send_partner_pct', 80) || '% dari ongkir antar kota'); end if;
  e := e || jsonb_build_object('entry', 'platform_revenue', 'amount', R, 'party_role', 'platform',
      'note', 'biaya platform ' || PF || ' + komisi ' || (C - B) || ' + fee merchant ' || M || ' + jasa belanja platform ' || sf_platform || ' + antar kota ' || ic_platform || ' + ongkir tanpa driver ' || f_platform || ' − promo platform ' || Dp);
  if pgf <> 0 then e := e || jsonb_build_object('entry', 'pg_fee', 'amount', -pgf, 'party_role', 'gateway', 'funded_by', borne, 'note', 'ditanggung ' || case when borne = 'customer' then 'pelanggan' else 'platform' end); end if;
  if pgp <> 0 then e := e || jsonb_build_object('entry', 'pg_fee_ppn', 'amount', -pgp, 'party_role', 'gateway', 'funded_by', borne, 'note', 'PPN biaya gateway'); end if;
  if is_cash and recv <> 0 then e := e || jsonb_build_object('entry', 'driver_receivable', 'amount', recv,
      'party_role', case when has_driver then 'driver' else 'partner' end, 'party_id', coalesce(o.driver_id, o.travel_partner_id),
      'note', case when recv > 0 then 'setoran ke platform dari uang tunai yang dipegang' else 'platform mengembalikan selisih tunai' end); end if;

  return jsonb_build_object(
    'gross_customer', gross, 'components_total', comp, 'total', tot,
    'delivery_fee', F, 'customer_platform_fee', PF, 'items_subtotal', S, 'service_fee', SF, 'driver_service_share', dshare,
    'intercity_fare', IC, 'tip', T, 'extras', X, 'discount', D,
    'driver_commission_pct', dc, 'driver_commission', C, 'bonus', B, 'merchant_fee_pct', mf, 'merchant_fee', M,
    'promo_funded_by', funded, 'promo_platform', Dp, 'promo_merchant', Dm, 'promo_sponsor', Ds,
    'driver_payable', drv, 'merchant_payable', merch, 'vendor_payable', vendor, 'partner_payable', partner,
    'platform_revenue', R, 'pg_fee', pgf, 'pg_fee_ppn', pgp, 'pg_fee_borne_by', borne, 'pg_channel', o.pg_channel,
    'contribution', R - case when borne = 'platform' then pgf + pgp else 0 end,
    'driver_receivable', recv, 'payment_method', o.payment_method, 'has_driver', has_driver,
    'balanced', (gross + Ds = drv + merch + vendor + partner + R + pg_cust) and (gross = comp),
    'diff', gross + Ds - (drv + merch + vendor + partner + R + pg_cust),
    'diff_components', gross - comp,
    'entries', e);
end $$;
revoke all on function public.ledger_calc(orders) from public, anon, authenticated;

-- 4b. ledger_post: tulis baris fase untuk satu order (idempoten per fase).
--     p_extra untuk fase cancelled/refunded: {refund, tip_refund, reimburse, penalty}.
create or replace function public.ledger_post(p_order uuid, p_phase text, p_extra jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o orders; c jsonb; x jsonb; v_refund bigint; v_tip bigint; v_reimb bigint; v_pen bigint; v_city_id uuid; v_city text;
begin
  if p_phase not in ('created','completed','cancelled','refunded','settled','adjusted') then raise exception 'Fase ledger tidak dikenal: %', p_phase; end if;
  select * into o from orders where id = p_order;
  if not found then raise exception 'ledger_post: order % tidak ditemukan', p_order; end if;
  v_city_id := o.city_id; v_city := o.city;
  delete from order_ledger where order_id = o.id and source = 'orders' and phase = p_phase;

  if p_phase in ('created', 'adjusted', 'completed') then
    c := ledger_calc(o);
    for x in select * from jsonb_array_elements(c->'entries') loop
      insert into order_ledger (order_id, source, source_id, service, city_id, city, entry, amount, party_role, party_id, funded_by, phase, pg_channel, note)
      values (o.id, 'orders', o.id, o.service, v_city_id, v_city, (x->>'entry')::ledger_entry, (x->>'amount')::bigint,
              x->>'party_role', nullif(x->>'party_id', '')::uuid, x->>'funded_by', p_phase, o.pg_channel, x->>'note');
    end loop;
    return c || jsonb_build_object('phase', p_phase, 'order_id', o.id);
  end if;

  -- cancelled / refunded: dana kembali ke pelanggan; penggantian belanja ke driver; denda (travel) sebagai pendapatan
  v_refund := coalesce((p_extra->>'refund')::bigint, 0); v_tip := coalesce((p_extra->>'tip_refund')::bigint, 0);
  v_reimb := coalesce((p_extra->>'reimburse')::bigint, 0); v_pen := coalesce((p_extra->>'penalty')::bigint, 0);
  if v_refund <> 0 then
    insert into order_ledger (order_id, source, source_id, service, city_id, city, entry, amount, party_role, party_id, phase, pg_channel, note)
    values (o.id, 'orders', o.id, o.service, v_city_id, v_city, 'refund', -v_refund, 'customer', o.customer_id, p_phase, o.pg_channel, 'refund pembatalan ' || o.code);
  end if;
  if v_tip <> 0 then
    insert into order_ledger (order_id, source, source_id, service, city_id, city, entry, amount, party_role, party_id, phase, pg_channel, note)
    values (o.id, 'orders', o.id, o.service, v_city_id, v_city, 'refund', -v_tip, 'customer', o.customer_id, p_phase, o.pg_channel, 'refund tip ' || o.code);
  end if;
  if v_reimb <> 0 then
    insert into order_ledger (order_id, source, source_id, service, city_id, city, entry, amount, party_role, party_id, phase, pg_channel, note)
    values (o.id, 'orders', o.id, o.service, v_city_id, v_city, 'vendor_payable', -v_reimb, 'vendor', o.driver_id, p_phase, o.pg_channel, 'penggantian belanja yang sudah dibeli driver (order batal)');
  end if;
  if v_pen <> 0 then
    insert into order_ledger (order_id, source, source_id, service, city_id, city, entry, amount, party_role, phase, pg_channel, note)
    values (o.id, 'orders', o.id, o.service, v_city_id, v_city, 'platform_revenue', v_pen, 'platform', p_phase, o.pg_channel, 'denda batal');
  end if;
  if v_refund = 0 and v_tip = 0 and v_reimb = 0 and v_pen = 0 then
    -- batal tanpa aliran dana (tunai / belum dibayar): tetap tulis penanda fase (refund 0) supaya
    -- ledger_check melihat fase cancelled, bukan jatuh kembali ke fase created
    insert into order_ledger (order_id, source, source_id, service, city_id, city, entry, amount, party_role, party_id, phase, pg_channel, note)
    values (o.id, 'orders', o.id, o.service, v_city_id, v_city, 'refund', 0, 'customer', o.customer_id, p_phase, o.pg_channel, 'batal tanpa dana kembali ' || o.code);
  end if;
  return jsonb_build_object('phase', p_phase, 'order_id', o.id, 'refund', v_refund, 'tip_refund', v_tip, 'reimburse', v_reimb, 'penalty', v_pen);
end $$;
revoke all on function public.ledger_post(uuid, text, jsonb) from public, anon, authenticated;
comment on function public.ledger_post(uuid, text, jsonb) is
  'Tulis buku besar satu order untuk satu fase (idempoten: hapus fase sama lalu tulis ulang). Internal — dipanggil create_order/driver_update_order_status/cancel_order/merchant_update_order/set_shopping_actual/add_tip/travel_complete_send.';

-- 4c. ledger_post_travel: booking kursi/carter (travel_bookings) & permintaan carter/harian (travel_requests)
create or replace function public.ledger_post_travel(p_source text, p_source_id uuid, p_phase text, p_extra jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  b travel_bookings; r travel_requests; t travel_trips; v_partner uuid; v_cust uuid; v_code text;
  gross bigint; PF bigint := 0; base bigint; fee bigint; partner bigint; rev bigint; recv bigint := 0; is_cash boolean; v_city uuid; v_city_name text;
  v_refund bigint := coalesce((p_extra->>'refund')::bigint, 0); v_pen bigint := coalesce((p_extra->>'penalty')::bigint, 0); v_paid boolean;
begin
  if p_source not in ('travel_bookings', 'travel_requests') then raise exception 'ledger_post_travel: sumber tidak dikenal %', p_source; end if;
  if p_phase not in ('created','completed','cancelled','refunded','settled','adjusted') then raise exception 'Fase ledger tidak dikenal: %', p_phase; end if;
  if p_source = 'travel_bookings' then
    select * into b from travel_bookings where id = p_source_id;
    if not found then raise exception 'ledger_post_travel: booking % tidak ditemukan', p_source_id; end if;
    select * into t from travel_trips where id = b.trip_id;
    v_partner := t.partner_id; v_cust := b.customer_id; v_code := b.code;
    gross := b.price; PF := b.platform_fee; base := b.price - b.platform_fee; partner := b.partner_earning; fee := base - partner;
    is_cash := (b.payment_method = 'cash'); v_paid := (b.payment_status in ('paid', 'refunded'));
    select r2.from_city, c.name into v_city, v_city_name from travel_routes r2 left join cities c on c.id = r2.from_city where r2.id = t.route_id;
  else
    select * into r from travel_requests where id = p_source_id;
    if not found then raise exception 'ledger_post_travel: permintaan % tidak ditemukan', p_source_id; end if;
    select o.partner_id into v_partner from travel_offers o where o.id = r.accepted_offer_id;
    v_partner := coalesce(v_partner, r.partner_id); v_cust := r.customer_id; v_code := r.code;
    gross := r.price; base := r.price; fee := r.platform_fee; partner := r.partner_earning;
    is_cash := (r.payment_method = 'cash'); v_paid := (r.payment_status in ('paid', 'refunded'));
    v_city := r.from_city; select name into v_city_name from cities where id = r.from_city;
  end if;
  rev := PF + fee;
  if is_cash then recv := gross - partner; end if;

  delete from order_ledger where source = p_source and source_id = p_source_id and phase = p_phase;
  if p_phase in ('created', 'completed', 'adjusted') then
    insert into order_ledger (source, source_id, service, city_id, city, entry, amount, party_role, party_id, phase, note) values
      (p_source, p_source_id, 'travel', v_city, v_city_name, 'gross_customer', gross, 'customer', v_cust, p_phase, v_code),
      (p_source, p_source_id, 'travel', v_city, v_city_name, 'intercity_fare', base, 'customer', v_cust, p_phase, 'harga kursi/carter');
    if PF <> 0 then insert into order_ledger (source, source_id, service, city_id, city, entry, amount, party_role, party_id, phase, note)
      values (p_source, p_source_id, 'travel', v_city, v_city_name, 'customer_platform_fee', PF, 'customer', v_cust, p_phase, null); end if;
    if fee <> 0 then insert into order_ledger (source, source_id, service, city_id, city, entry, amount, party_role, party_id, phase, note)
      values (p_source, p_source_id, 'travel', v_city, v_city_name, 'merchant_fee', fee, 'platform', null, p_phase, 'fee mitra travel'); end if;
    if partner <> 0 then insert into order_ledger (source, source_id, service, city_id, city, entry, amount, party_role, party_id, phase, note)
      values (p_source, p_source_id, 'travel', v_city, v_city_name, 'partner_payable', -partner, 'partner', v_partner, p_phase, case when is_cash then 'tunai: dipegang mitra' else null end); end if;
    insert into order_ledger (source, source_id, service, city_id, city, entry, amount, party_role, party_id, phase, note)
      values (p_source, p_source_id, 'travel', v_city, v_city_name, 'platform_revenue', rev, 'platform', null, p_phase, 'biaya platform ' || PF || ' + fee mitra ' || fee);
    if is_cash and recv <> 0 then insert into order_ledger (source, source_id, service, city_id, city, entry, amount, party_role, party_id, phase, note)
      values (p_source, p_source_id, 'travel', v_city, v_city_name, 'driver_receivable', recv, 'partner', v_partner, p_phase, 'setoran mitra ke platform dari uang tunai'); end if;
  else
    if v_refund <> 0 then insert into order_ledger (source, source_id, service, city_id, city, entry, amount, party_role, party_id, phase, note)
      values (p_source, p_source_id, 'travel', v_city, v_city_name, 'refund', -v_refund, 'customer', v_cust, p_phase, 'refund ' || v_code); end if;
    if v_pen <> 0 then insert into order_ledger (source, source_id, service, city_id, city, entry, amount, party_role, party_id, phase, note)
      values (p_source, p_source_id, 'travel', v_city, v_city_name, 'platform_revenue', v_pen, 'platform', null, p_phase, 'denda batal'); end if;
    if v_refund = 0 and v_pen = 0 then   -- penanda fase batal tanpa aliran dana
      insert into order_ledger (source, source_id, service, city_id, city, entry, amount, party_role, party_id, phase, note)
      values (p_source, p_source_id, 'travel', v_city, v_city_name, 'refund', 0, 'customer', v_cust, p_phase, 'batal tanpa dana kembali ' || v_code);
    end if;
  end if;
  return jsonb_build_object('source', p_source, 'source_id', p_source_id, 'phase', p_phase, 'gross_customer', gross, 'customer_platform_fee', PF,
    'merchant_fee', fee, 'partner_payable', partner, 'platform_revenue', rev, 'driver_receivable', recv, 'refund', v_refund, 'penalty', v_pen,
    'balanced', (gross = partner + rev));
end $$;
revoke all on function public.ledger_post_travel(text, uuid, text, jsonb) from public, anon, authenticated;

-- 4d. ledger_check: putusan keseimbangan satu order (admin) — fase terakhir yang berlaku
create or replace function public.ledger_check(p_order uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_phase text; o orders; agg record; v_bal boolean; v_diff bigint; v_diffc bigint; v_paid bigint; v_alloc bigint; v_comp bigint;
begin
  if not is_admin() and not exists (select 1 from orders x where x.id = p_order and (x.customer_id = auth.uid() or x.driver_id = auth.uid() or x.travel_partner_id = auth.uid() or (x.merchant_id is not null and owns_merchant(x.merchant_id)))) then
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
    coalesce(-sum(amount) filter (where entry = 'pg_fee' and funded_by = 'customer'), 0) + coalesce(-sum(amount) filter (where entry = 'pg_fee_ppn' and funded_by = 'customer'), 0) as pg_cust,
    coalesce(-sum(amount) filter (where entry = 'pg_fee' and coalesce(funded_by, 'platform') = 'platform'), 0) + coalesce(-sum(amount) filter (where entry = 'pg_fee_ppn' and coalesce(funded_by, 'platform') = 'platform'), 0) as pg_plat,
    coalesce(sum(amount) filter (where entry = 'driver_receivable'), 0) as recv,
    coalesce(-sum(amount) filter (where entry = 'refund'), 0) as refund,
    count(*) as rows_n
  into agg from order_ledger where order_id = p_order and source = 'orders' and phase = v_phase;

  if v_phase in ('created', 'adjusted', 'completed') then
    v_alloc := agg.drv + agg.merch + agg.vendor + agg.partner + agg.rev + agg.pg_cust;
    v_diff := agg.gross + agg.promo_s - v_alloc;
    v_comp := agg.items + agg.fare + agg.pf + agg.sf + agg.ic + agg.tip + agg.extras - agg.promo_p - agg.promo_m - agg.promo_s + agg.pg_cust;
    v_diffc := agg.gross - v_comp;
    v_bal := (v_diff = 0 and v_diffc = 0 and agg.gross = o.total + o.tip);
    return jsonb_build_object('order_id', p_order, 'code', o.code, 'service', o.service, 'phase', v_phase, 'status', o.status,
      'verdict', case when v_bal then 'balanced' else 'unbalanced' end, 'balanced', v_bal, 'diff', v_diff, 'diff_components', v_diffc,
      'gross_customer', agg.gross, 'allocated', v_alloc, 'components_total', v_comp,
      'formula', 'gross_customer + promo_sponsor = driver_payable + merchant_payable + vendor_payable + partner_payable + platform_revenue + pg_fee(pelanggan)',
      'driver_payable', agg.drv, 'merchant_payable', agg.merch, 'vendor_payable', agg.vendor, 'partner_payable', agg.partner,
      'platform_revenue', agg.rev, 'pg_fee_platform', agg.pg_plat, 'pg_fee_customer', agg.pg_cust, 'contribution', agg.rev - agg.pg_plat,
      'driver_commission', agg.comm, 'bonus', agg.bonus, 'merchant_fee', agg.mfee,
      'promo_platform', agg.promo_p, 'promo_merchant', agg.promo_m, 'promo_sponsor', agg.promo_s,
      'driver_receivable', agg.recv, 'rows', agg.rows_n);
  else
    -- cancelled/refunded: yang dikembalikan + penggantian + denda harus = yang pernah dibayar (total + tip) bila memang direfund
    v_paid := case when o.payment_status = 'refunded' then o.total else 0 end;
    v_alloc := agg.refund + agg.vendor + agg.rev;
    v_bal := case when o.payment_status = 'refunded' then v_alloc >= v_paid else true end;
    return jsonb_build_object('order_id', p_order, 'code', o.code, 'service', o.service, 'phase', v_phase, 'status', o.status,
      'verdict', case when v_bal then 'refund_ok' else 'refund_short' end, 'balanced', v_bal,
      'diff', v_alloc - v_paid, 'refund', agg.refund, 'reimburse', agg.vendor, 'penalty', agg.rev, 'paid', v_paid, 'rows', agg.rows_n);
  end if;
end $$;
revoke all on function public.ledger_check(uuid) from public, anon;
grant execute on function public.ledger_check(uuid) to authenticated;
comment on function public.ledger_check(uuid) is 'Putusan keseimbangan buku besar satu order (fase terakhir yang berlaku) + selisih. Admin, atau pihak dalam order itu.';

-- 4e. ledger_simulate: hitung alokasi satu order hipotetis (murni, tanpa tulis) — Panel Admin "Aturan Bisnis"
create or replace function public.ledger_simulate(p_service service_type, p_fare bigint, p_subtotal bigint, p_promo bigint,
  p_promo_funded_by text, p_channel text, p_helpers int default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare o orders; se service_economics; v_ch text := payment_channel_of(coalesce(p_channel, 'cash')); v_fee bigint := 0; v_ppn bigint := 0; v_helper bigint := setting_num('helper_fee', 50000)::bigint; c jsonb;
begin
  -- keluaran memuat seluruh aturan (merchant_fee_pct, pg_fee_policy) → hanya admin (klien: service_economics_public)
  if not coalesce(is_admin(), false) then raise exception 'Hanya admin'; end if;
  select * into se from service_economics where service = p_service;
  o.id := '00000000-0000-4000-8000-000000000000'::uuid;
  o.code := 'SIMULASI'; o.service := p_service; o.status := 'completed'; o.created_at := now();
  o.customer_id := auth.uid();
  o.driver_id := case when p_service = 'travel' then null else '00000000-0000-4000-8000-000000000001'::uuid end;
  o.merchant_id := case when p_service = 'food' then '00000000-0000-4000-8000-000000000002'::uuid else null end;
  o.fare_delivery := greatest(0, coalesce(p_fare, 0)) + case when p_service = 'box' then greatest(0, coalesce(p_helpers, 0)) * v_helper else 0 end;
  o.helpers := case when p_service = 'box' then greatest(0, coalesce(p_helpers, 0)) else 0 end;
  o.platform_fee := coalesce(se.customer_platform_fee, (select platform_fee from pricing where service = p_service), 0);
  o.items_subtotal := case when p_service in ('food', 'shop', 'market') then greatest(0, coalesce(p_subtotal, 0)) else 0 end;
  o.service_fee := case when p_service in ('shop', 'market') then shopping_service_fee(p_service, o.items_subtotal) else 0 end;
  o.driver_service_share := case when p_service in ('shop', 'market') then shopping_driver_share(p_service, o.service_fee) else 0 end;
  o.intercity_fare := 0; o.tip := 0; o.extras_total := 0;
  o.discount := least(greatest(0, coalesce(p_promo, 0)), o.fare_delivery + case when p_service = 'food' then o.items_subtotal else 0 end);
  o.promo_funded_by := case when lower(coalesce(p_promo_funded_by, '')) in ('platform', 'merchant', 'sponsor') then lower(p_promo_funded_by) else coalesce(se.promo_default_funded_by, 'platform') end;
  o.driver_commission_pct_snap := coalesce(se.driver_commission_pct, 0);
  o.merchant_fee_pct_snap := coalesce(se.merchant_fee_pct, 0);
  o.payment_method := case when v_ch = 'cash' then 'cash'::payment_method else 'wallet'::payment_method end;
  o.paid_via := coalesce(p_channel, 'cash'); o.pg_channel := v_ch;
  o.ledger_version := 2;
  o.total := o.fare_delivery + o.platform_fee + o.items_subtotal + o.service_fee - o.discount;
  if v_ch = any (payment_gateway_channel_keys()) then
    select f.fee, f.ppn into v_fee, v_ppn from pg_fee_calc(v_ch, o.total) f;
  end if;
  o.pg_fee := coalesce(v_fee, 0); o.pg_fee_ppn := coalesce(v_ppn, 0); o.pg_fee_borne_by := coalesce(se.pg_fee_policy, 'platform');
  if o.pg_fee_borne_by = 'customer' then o.total := o.total + o.pg_fee + o.pg_fee_ppn; end if;
  o.driver_earning := o.fare_delivery - floor(o.fare_delivery * o.driver_commission_pct_snap / 100.0)::bigint;
  o.merchant_earning := case when o.merchant_id is not null then o.items_subtotal - floor(o.items_subtotal * o.merchant_fee_pct_snap / 100.0)::bigint
      - case when o.promo_funded_by = 'merchant' then least(o.discount, greatest(0, o.items_subtotal - floor(o.items_subtotal * o.merchant_fee_pct_snap / 100.0)::bigint)) else 0 end else 0 end;
  c := ledger_calc(o);
  return c || jsonb_build_object('simulated', true, 'service', p_service, 'channel', v_ch, 'rules', to_jsonb(se));
end $$;
revoke all on function public.ledger_simulate(service_type, bigint, bigint, bigint, text, text, int) from public, anon;
grant execute on function public.ledger_simulate(service_type, bigint, bigint, bigint, text, text, int) to authenticated;   -- is_admin() di dalam
comment on function public.ledger_simulate(service_type, bigint, bigint, bigint, text, text, int) is
  'Simulasi alokasi satu order (murni, tanpa tulis) memakai aturan service_economics saat ini — untuk Panel Admin Aturan Bisnis.';

-- 4f. Rincian transparan untuk driver & merchant (§9)
create or replace function public.driver_order_breakdown(p_order uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare o orders; v_phase text; agg record; v_uid uuid := auth.uid();
begin
  select * into o from orders where id = p_order;
  if not found then raise exception 'Order tidak ditemukan'; end if;
  if not (coalesce(o.driver_id = v_uid, false) or coalesce(o.travel_partner_id = v_uid, false) or coalesce(is_admin(), false)) then raise exception 'Bukan order Anda'; end if;
  select phase into v_phase from order_ledger where order_id = p_order and source = 'orders' and phase in ('completed', 'adjusted', 'created')
   order by case phase when 'completed' then 0 when 'adjusted' then 1 else 2 end limit 1;
  if v_phase is null then
    -- order lama (sebelum 0099): dari kolom orders
    return jsonb_build_object('order_id', o.id, 'code', o.code, 'service', o.service, 'status', o.status, 'phase', null, 'ledger_version', o.ledger_version,
      'payment_method', o.payment_method, 'ongkir', o.fare_delivery, 'komisi_pct', null,
      'komisi', case when o.ledger_version >= 2 then o.fare_delivery - o.driver_earning else null end,
      'tip', o.tip, 'extras', o.extras_total, 'service_share', o.driver_service_share, 'bonus', null,
      'bersih', coalesce(o.driver_earning_final, o.driver_earning), 'receivable', null, 'memegang_tunai', case when o.payment_method = 'cash' then o.total else 0 end);
  end if;
  select
    coalesce(sum(amount) filter (where entry = 'delivery_fee'), 0) as fare,
    coalesce(sum(amount) filter (where entry = 'driver_commission'), 0) as comm,
    coalesce(-sum(amount) filter (where entry = 'adjustment' and party_role = 'driver'), 0) as bonus,
    coalesce(sum(amount) filter (where entry = 'tip'), 0) as tip,
    coalesce(sum(amount) filter (where entry = 'extras'), 0) as extras,
    coalesce(-sum(amount) filter (where entry = 'driver_payable'), 0) as drv,
    coalesce(-sum(amount) filter (where entry = 'vendor_payable'), 0) as vendor,
    coalesce(-sum(amount) filter (where entry = 'partner_payable'), 0) as partner,
    coalesce(sum(amount) filter (where entry = 'driver_receivable'), 0) as recv,
    coalesce(-sum(amount) filter (where entry = 'merchant_payable'), 0) as merch
  into agg from order_ledger where order_id = p_order and source = 'orders' and phase = v_phase;
  return jsonb_build_object('order_id', o.id, 'code', o.code, 'service', o.service, 'status', o.status, 'phase', v_phase, 'ledger_version', o.ledger_version,
    'payment_method', o.payment_method, 'paid_via', o.paid_via,
    'ongkir', agg.fare, 'komisi_pct', coalesce(o.driver_commission_pct_snap, 0), 'komisi', agg.comm,
    'tip', agg.tip, 'extras', agg.extras, 'service_share', o.driver_service_share, 'bonus', agg.bonus,
    'bersih', case when o.travel_partner_id = v_uid and o.driver_id is distinct from v_uid then agg.partner else agg.drv end,
    'penggantian_belanja', agg.vendor,
    'receivable', agg.recv,
    'memegang_tunai', case when o.payment_method = 'cash' then o.total else 0 end,
    'setor_merchant_tunai', case when o.payment_method = 'cash' then agg.merch else 0 end,
    'keterangan', case when o.payment_method = 'cash' then format('Anda memegang Rp%s tunai; setoran ke platform Rp%s', replace(to_char(o.total, 'FM999,999,999,999'), ',', '.'), replace(to_char(agg.recv, 'FM999,999,999,999'), ',', '.')) else 'Dibayar ke saldo AntarPay saat order selesai' end);
end $$;
revoke all on function public.driver_order_breakdown(uuid) from public, anon;
grant execute on function public.driver_order_breakdown(uuid) to authenticated;
comment on function public.driver_order_breakdown(uuid) is 'Rincian pendapatan driver/mitra per order dari order_ledger (§9): ongkir, komisi %, tip, extras, bagian jasa belanja, bonus, bersih, setoran tunai.';

create or replace function public.merchant_order_breakdown(p_order uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare o orders; v_phase text; agg record;
begin
  select * into o from orders where id = p_order;
  if not found then raise exception 'Order tidak ditemukan'; end if;
  if o.merchant_id is null then raise exception 'Bukan pesanan merchant'; end if;
  if not (coalesce(owns_merchant(o.merchant_id), false) or coalesce(is_admin(), false)) then raise exception 'Bukan pesanan merchant Anda'; end if;
  select phase into v_phase from order_ledger where order_id = p_order and source = 'orders' and phase in ('completed', 'adjusted', 'created')
   order by case phase when 'completed' then 0 when 'adjusted' then 1 else 2 end limit 1;
  if v_phase is null then
    return jsonb_build_object('order_id', o.id, 'code', o.code, 'status', o.status, 'phase', null, 'ledger_version', o.ledger_version,
      'nilai_pesanan', o.items_subtotal, 'fee_pct', null, 'fee', o.items_subtotal - o.merchant_earning, 'promo_merchant', 0, 'diterima', o.merchant_earning, 'payment_method', o.payment_method);
  end if;
  select
    coalesce(sum(amount) filter (where entry = 'items_subtotal'), 0) as items,
    coalesce(sum(amount) filter (where entry = 'merchant_fee'), 0) as fee,
    coalesce(-sum(amount) filter (where entry = 'promo_merchant'), 0) as promo_m,
    coalesce(-sum(amount) filter (where entry = 'merchant_payable'), 0) as merch
  into agg from order_ledger where order_id = p_order and source = 'orders' and phase = v_phase;
  return jsonb_build_object('order_id', o.id, 'code', o.code, 'status', o.status, 'phase', v_phase, 'ledger_version', o.ledger_version,
    'nilai_pesanan', agg.items, 'fee_pct', coalesce(o.merchant_fee_pct_snap, 0), 'fee', agg.fee, 'promo_merchant', agg.promo_m,
    'diterima', agg.merch, 'payment_method', o.payment_method,
    'keterangan', case when o.payment_method = 'cash' then 'Dibayar tunai oleh driver saat mengambil pesanan' else 'Dikreditkan ke saldo AntarPay saat order selesai' end);
end $$;
revoke all on function public.merchant_order_breakdown(uuid) from public, anon;
grant execute on function public.merchant_order_breakdown(uuid) to authenticated;
comment on function public.merchant_order_breakdown(uuid) is 'Rincian per order untuk merchant dari order_ledger (§9): nilai pesanan, fee platform %, promo ditanggung merchant, diterima.';

-- ---------------------------------------------------------------------
-- 5. Tambalan fungsi lama — pola 0089/0096: definisi TERKINI (pg_get_functiondef),
--    jangkar unik, penanda idempoten, penjaga gagal keras bila jangkar hilang.
--    Pembantu sementara skema_v2_splice() dihapus di akhir migrasi.
-- ---------------------------------------------------------------------
create or replace function public.skema_v2_splice(p_fn text, p_anchor text, p_new text, p_marker text, p_all boolean default false)
returns void language plpgsql as $$
declare def text; n int;
begin
  if (select count(*) from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace where ns.nspname = 'public' and p.proname = p_fn) > 1 then
    raise exception '0099 batal: fungsi % punya lebih dari satu overload — tambalan tidak tahu mana yang dimaksud', p_fn;
  end if;
  select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = p_fn;
  if def is null then raise exception '0099 batal: fungsi % tidak ditemukan', p_fn; end if;
  if position(p_marker in def) > 0 then
    raise notice '0099: % sudah ditambal (%), dilewati', p_fn, p_marker; return;
  end if;
  n := (length(def) - length(replace(def, p_anchor, ''))) / greatest(1, length(p_anchor));
  if n = 0 then
    raise exception '0099 batal: jangkar tidak ditemukan di % — definisi berubah, tambalan TIDAK terpasang. Jangkar: %', p_fn, left(p_anchor, 120);
  end if;
  if n > 1 and not p_all then
    raise exception '0099 batal: jangkar tidak unik (% kali) di % — periksa ulang. Jangkar: %', n, p_fn, left(p_anchor, 120);
  end if;
  execute replace(def, p_anchor, p_new);
end $$;

-- 5a. create_order — snapshot aturan, promo funded_by, biaya PG, ledger 'created'
select skema_v2_splice('create_order',
  $a$  v_pdrv drivers%rowtype; v_pref uuid; v_probe orders%rowtype;$a$,
  $a$  v_pdrv drivers%rowtype; v_pref uuid; v_probe orders%rowtype;
  -- 0099 skema bisnis v2: aturan per layanan, promo funded_by, biaya gateway
  se service_economics%rowtype; v_dc numeric; v_mf numeric; v_funded text := 'platform'; v_dm bigint := 0;
  v_pg_ch text; v_pg_fee bigint := 0; v_pg_ppn bigint := 0; v_pg_cust bigint := 0; v_promo promos%rowtype;$a$,
  '0099 skema bisnis v2: aturan per layanan');

select skema_v2_splice('create_order',
  $a$  v_fare := (v_est->>'fare')::bigint; v_fee := (v_est->>'platform_fee')::bigint;$a$,
  $a$  v_fare := (v_est->>'fare')::bigint; v_fee := (v_est->>'platform_fee')::bigint;
  select * into se from service_economics where service = v_service;   -- 0099: biaya platform pelanggan dari aturan per layanan
  if found then v_fee := se.customer_platform_fee; end if;$a$,
  '0099: biaya platform pelanggan');

select skema_v2_splice('create_order',
  $a$  v_disc := apply_promo(v_order.promo_code, v_service, v_fare + case when v_service = 'food' then v_sub else 0 end);
  v_total := v_fare + v_fee + v_sub + v_ic_fare + v_service_fee - v_disc;

  update orders set items_subtotal = v_sub, discount = v_disc, total = v_total,
    driver_earning = v_fare - floor(v_fare * pr.commission_pct / 100.0),
    merchant_earning = case when v_service = 'food' then v_sub - floor(v_sub * pr.merchant_commission_pct / 100.0) else 0 end
  where id = v_order.id returning * into v_order;$a$,
  $a$  v_disc := apply_promo(v_order.promo_code, v_service, v_fare + case when v_service = 'food' then v_sub else 0 end);
  -- 0099 alokasi v2: komisi & fee dari service_economics (pricing.* hanya fallback bila barisnya tidak ada)
  v_dc := coalesce(se.driver_commission_pct, pr.commission_pct, 0);
  v_mf := coalesce(se.merchant_fee_pct, pr.merchant_commission_pct, 0);
  if v_order.promo_code is not null then
    select * into v_promo from promos where code = v_order.promo_code;
    v_funded := coalesce(nullif(v_promo.funded_by, ''), se.promo_default_funded_by, 'platform');
  end if;
  if v_funded = 'merchant' and v_merchant.id is null then v_funded := 'platform'; end if;   -- tanpa merchant, promo tidak bisa ditanggung merchant
  if v_funded = 'merchant' then v_dm := least(v_disc, greatest(0, v_sub - floor(v_sub * v_mf / 100.0)::bigint)); end if;
  v_pg_ch := payment_channel_of(v_paid_via);
  if v_pg_ch = any (payment_gateway_channel_keys()) then
    select f.fee, f.ppn into v_pg_fee, v_pg_ppn from pg_fee_calc(v_pg_ch, v_fare + v_fee + v_sub + v_ic_fare + v_service_fee - v_disc) f;
    v_pg_fee := coalesce(v_pg_fee, 0); v_pg_ppn := coalesce(v_pg_ppn, 0);
  end if;
  if coalesce(se.pg_fee_policy, 'platform') = 'customer' then v_pg_cust := v_pg_fee + v_pg_ppn; end if;   -- "Biaya pembayaran" ditambahkan ke total
  v_total := v_fare + v_fee + v_sub + v_ic_fare + v_service_fee - v_disc + v_pg_cust;

  update orders set items_subtotal = v_sub, discount = v_disc, total = v_total,
    driver_earning = v_fare - floor(v_fare * v_dc / 100.0),
    merchant_earning = case when v_service = 'food' then v_sub - floor(v_sub * v_mf / 100.0) - v_dm else 0 end,
    driver_commission_pct_snap = v_dc, merchant_fee_pct_snap = v_mf,
    promo_funded_by = case when v_disc > 0 then v_funded else null end,
    pg_channel = v_pg_ch, pg_fee = v_pg_fee, pg_fee_ppn = v_pg_ppn,
    pg_fee_borne_by = case when v_pg_fee + v_pg_ppn > 0 then coalesce(se.pg_fee_policy, 'platform') else null end,
    ledger_version = 2
  where id = v_order.id returning * into v_order;$a$,
  '0099 alokasi v2');

select skema_v2_splice('create_order',
  $a$  return v_order;
end$a$,
  $a$  perform ledger_post(v_order.id, 'created');   -- 0099: buku besar fase created
  return v_order;
end$a$,
  'ledger_post(v_order.id');

-- 5b. driver_update_order_status — cabang completed: alokasi dari ledger, driver_earning tidak ditimpa
do $$
declare def text; p1 int; p2 int;
  a_start constant text := $a$    select * into pr from pricing where service = o.service;
    v_comm := o.fare_delivery - o.driver_earning;$a$;
  a_end constant text := $a$      if o.tip > 0 then perform wallet_apply(o.driver_id, 'earning', o.tip, o.id, 'Tip dari pelanggan ' || o.code); end if;
    end if;
$a$;
  baru constant text := $n$    -- 0099 skema bisnis v2: alokasi dari buku besar (ledger_post menghitung dari snapshot aturan saat order dibuat)
    v_led := ledger_post(o.id, 'completed');
    update orders set driver_earning_final = (v_led->>'driver_payable')::bigint where id = o.id returning * into o;
    if o.payment_method = 'wallet' then
      if (v_led->>'driver_payable')::bigint <> 0 then
        perform wallet_apply(o.driver_id, 'earning', (v_led->>'driver_payable')::bigint, o.id, 'Pendapatan ' || o.code);
      end if;
      if (v_led->>'vendor_payable')::bigint > 0 then
        perform wallet_apply(o.driver_id, 'earning', (v_led->>'vendor_payable')::bigint, o.id, 'Penggantian belanja ' || o.code);
      end if;
      if o.merchant_id is not null and (v_led->>'merchant_payable')::bigint > 0 then
        select owner_id into v_owner from merchants where id = o.merchant_id;
        if v_owner is not null then
          perform wallet_apply(v_owner, 'earning', (v_led->>'merchant_payable')::bigint, o.id, 'Penjualan ' || o.code);
        end if;
      end if;
    else
      -- tunai: driver memegang uang pelanggan; setoran = driver_receivable dari ledger
      -- (total − penggantian belanja − bagian merchant yang dibayar tunai − pendapatan driver tanpa tip)
      v_fee := (v_led->>'driver_receivable')::bigint;
      if v_fee <> 0 then
        perform wallet_apply(o.driver_id, 'fee', -v_fee, o.id,
          case when v_fee > 0 then 'Potongan platform ' || o.code
               else 'Selisih setoran tunai dikembalikan ' || o.code end);
      end if;
      if o.tip > 0 then perform wallet_apply(o.driver_id, 'earning', o.tip, o.id, 'Tip dari pelanggan ' || o.code); end if;
    end if;
$n$;
begin
  select pg_get_functiondef(p.oid) into def from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'driver_update_order_status';
  if def is null then raise exception '0099 batal: driver_update_order_status tidak ditemukan'; end if;
  if position('0099 skema bisnis v2' in def) > 0 then raise notice '0099: driver_update_order_status sudah ditambal, dilewati'; return; end if;
  p1 := position(a_start in def); p2 := position(a_end in def);
  if p1 = 0 or p2 = 0 or p2 < p1 then
    raise exception '0099 batal: jangkar cabang completed tidak ditemukan di driver_update_order_status (awal=%, akhir=%) — tambalan TIDAK terpasang', p1, p2;
  end if;
  if position('v_pin text; v_owed bigint;' in def) = 0 then
    raise exception '0099 batal: deklarasi driver_update_order_status berubah — tambalan TIDAK terpasang';
  end if;
  def := left(def, p1 - 1) || baru || substr(def, p2 + length(a_end));
  def := replace(def, 'v_pin text; v_owed bigint;', 'v_pin text; v_owed bigint; v_led jsonb;');
  execute def;
end $$;

-- 5c. cancel_order — fase cancelled/refunded
select skema_v2_splice('cancel_order',
  $a$  if o.promo_code is not null then update promos set used_count = greatest(0, used_count - 1) where code = o.promo_code; end if;
  insert into order_events (order_id, status, actor_id, note) values (o.id, 'cancelled', v_uid, p_reason);$a$,
  $a$  if o.promo_code is not null then update promos set used_count = greatest(0, used_count - 1) where code = o.promo_code; end if;
  -- 0099: buku besar fase cancelled/refunded (dana kembali + penggantian belanja driver)
  perform ledger_post(o.id, case when o.payment_status = 'refunded' then 'refunded' else 'cancelled' end,
    jsonb_build_object('refund', case when o.payment_status = 'refunded' then o.total - case when v_belanja > 0 and o.driver_id is not null then v_belanja else 0 end else 0 end,
                       'reimburse', case when o.payment_status = 'refunded' and v_belanja > 0 and o.driver_id is not null then v_belanja else 0 end,
                       'tip_refund', v_tip));
  insert into order_events (order_id, status, actor_id, note) values (o.id, 'cancelled', v_uid, p_reason);$a$,
  '0099: buku besar fase cancelled');

-- 5d. merchant_update_order (reject) — fase cancelled/refunded
select skema_v2_splice('merchant_update_order',
  $a$    if o.promo_code is not null then update promos set used_count = greatest(0, used_count - 1) where code = o.promo_code; end if;
    insert into order_events (order_id, status, actor_id, note) values (o.id, 'cancelled', auth.uid(), 'Merchant menolak');$a$,
  $a$    if o.promo_code is not null then update promos set used_count = greatest(0, used_count - 1) where code = o.promo_code; end if;
    perform ledger_post(o.id, case when o.payment_status = 'refunded' then 'refunded' else 'cancelled' end,   -- 0099
      jsonb_build_object('refund', case when o.payment_status = 'refunded' then o.total else 0 end, 'tip_refund', v_tip));
    insert into order_events (order_id, status, actor_id, note) values (o.id, 'cancelled', auth.uid(), 'Merchant menolak');$a$,
  'ledger_post(o.id');

-- 5e. set_shopping_actual — fase adjusted
select skema_v2_splice('set_shopping_actual',
  $a$  insert into order_events (order_id, status, actor_id, note) values (o.id, 'shop_total', auth.uid(),$a$,
  $a$  perform ledger_post(o.id, 'adjusted');   -- 0099: alokasi ulang setelah nota belanja
  insert into order_events (order_id, status, actor_id, note) values (o.id, 'shop_total', auth.uid(),$a$,
  'ledger_post(o.id');

-- 5f. add_tip setelah selesai — tambah ke driver_earning_final (bukan driver_earning) + tulis ulang ledger completed
select skema_v2_splice('add_tip',
  $a$    update orders set tip = tip + p_amount, driver_earning = driver_earning + p_amount where id = o.id returning * into o;$a$,
  $a$    update orders set tip = tip + p_amount, driver_earning_final = coalesce(driver_earning_final, driver_earning) + p_amount where id = o.id returning * into o;   -- 0099
    perform ledger_post(o.id, 'completed');$a$,
  'driver_earning_final');

-- 5g. batas saldo minus driver dari app_settings.driver_debt_limit
select skema_v2_splice('driver_set_online',
  $a$    if coalesce(v_bal, 0) < -500000 then raise exception 'Saldo minus melebihi batas (Rp500.000). Top up saldo dulu.'; end if;$a$,
  $a$    if coalesce(v_bal, 0) < setting_num('driver_debt_limit', -500000)::bigint then   -- 0099: batas dari app_settings
      raise exception 'Saldo minus melebihi batas (Rp%). Top up saldo dulu.', replace(to_char(abs(setting_num('driver_debt_limit', -500000)), 'FM999,999,999,999'), ',', '.');
    end if;$a$,
  'driver_debt_limit');
select skema_v2_splice('driver_accept_order',
  $a$  if coalesce(v_bal, 0) < -500000 then raise exception 'Saldo minus melebihi batas. Top up dulu untuk menerima order.'; end if;$a$,
  $a$  if coalesce(v_bal, 0) < setting_num('driver_debt_limit', -500000)::bigint then   -- 0099: batas dari app_settings
    raise exception 'Saldo minus melebihi batas (Rp%). Top up dulu untuk menerima order.', replace(to_char(abs(setting_num('driver_debt_limit', -500000)), 'FM999,999,999,999'), ',', '.');
  end if;$a$,
  'driver_debt_limit');

-- 5h. travel_book — fee & komisi dari service_economics('travel'); ledger created
select skema_v2_splice('travel_book',
  $a$v_fee bigint := setting_num('travel_platform_fee', 5000)::bigint; v_comm numeric := setting_num('travel_commission_pct', 10);$a$,
  $a$v_fee bigint := coalesce((select customer_platform_fee from service_economics where service = 'travel'), setting_num('travel_platform_fee', 5000)::bigint);   -- 0099 service_economics
  v_comm numeric := coalesce((select merchant_fee_pct from service_economics where service = 'travel'), setting_num('travel_commission_pct', 10));$a$,
  '0099 service_economics');
select skema_v2_splice('travel_book',
  $a$  perform log_activity('travel.booked',$a$,
  $a$  perform ledger_post_travel('travel_bookings', b.id, 'created');   -- 0099
  perform log_activity('travel.booked',$a$,
  'ledger_post_travel');

-- 5i. travel_offer_accept — komisi dari service_economics('travel'); ledger created
select skema_v2_splice('travel_offer_accept',
  $a$v_comm numeric := setting_num('travel_request_commission_pct', 10);$a$,
  $a$v_comm numeric := coalesce((select merchant_fee_pct from service_economics where service = 'travel'),   -- 0099 service_economics
    setting_num('travel_request_commission_pct', 10));$a$,
  '0099 service_economics');
select skema_v2_splice('travel_offer_accept',
  $a$  perform log_activity('travel.accepted',$a$,
  $a$  perform ledger_post_travel('travel_requests', r.id, 'created');   -- 0099
  perform log_activity('travel.accepted',$a$,
  'ledger_post_travel');

-- 5j. travel_trip_set_status — arrived → completed per booking; cancelled → refunded/cancelled
select skema_v2_splice('travel_trip_set_status',
  $a$      update travel_bookings set status = 'completed', payment_status = 'paid' where id = b.id;$a$,
  $a$      update travel_bookings set status = 'completed', payment_status = 'paid' where id = b.id;
      perform ledger_post_travel('travel_bookings', b.id, 'completed');   -- 0099$a$,
  'ledger_post_travel');
select skema_v2_splice('travel_trip_set_status',
  $a$      if b.payment_status = 'paid' then perform wallet_apply(b.customer_id, 'refund', b.price, null, 'Refund travel ' || b.code); end if;$a$,
  $a$      if b.payment_status = 'paid' then perform wallet_apply(b.customer_id, 'refund', b.price, null, 'Refund travel ' || b.code); end if;
      perform ledger_post_travel('travel_bookings', b.id, case when b.payment_status = 'paid' then 'refunded' else 'cancelled' end,
        jsonb_build_object('refund', case when b.payment_status = 'paid' then b.price else 0 end));   -- 0099 batal$a$,
  '0099 batal');

-- 5k. travel_booking_cancel (pelanggan membatalkan)
select skema_v2_splice('travel_booking_cancel',
  $a$  if b.payment_status = 'refunded' then perform wallet_apply(b.customer_id, 'refund', b.price, null, 'Refund travel ' || b.code); end if;$a$,
  $a$  if b.payment_status = 'refunded' then perform wallet_apply(b.customer_id, 'refund', b.price, null, 'Refund travel ' || b.code); end if;
  perform ledger_post_travel('travel_bookings', b.id, case when b.payment_status = 'refunded' then 'refunded' else 'cancelled' end,
    jsonb_build_object('refund', case when b.payment_status = 'refunded' then b.price else 0 end));   -- 0099$a$,
  'ledger_post_travel');

-- 5l. travel_request_set_status — cancelled (denda 30 % = platform_revenue) & completed
select skema_v2_splice('travel_request_set_status',
  $a$ where id = r.id returning * into r;
    if o.partner_id is not null then insert into notifications$a$,
  $a$ where id = r.id returning * into r;
    perform ledger_post_travel('travel_requests', r.id, case when r.payment_status = 'refunded' then 'refunded' else 'cancelled' end,   -- 0099
      jsonb_build_object('refund', coalesce(v_refund, 0), 'penalty', case when r.payment_status = 'refunded' then r.price - coalesce(v_refund, 0) else 0 end));
    if o.partner_id is not null then insert into notifications$a$,
  'ledger_post_travel');
select skema_v2_splice('travel_request_set_status',
  $a$    update travel_requests set status = 'completed', payment_status = 'paid' where id = r.id returning * into r;$a$,
  $a$    update travel_requests set status = 'completed', payment_status = 'paid' where id = r.id returning * into r;
    perform ledger_post_travel('travel_requests', r.id, 'completed');   -- 0099 selesai$a$,
  '0099 selesai');

-- 5m. travel_complete_send — titipan antar kota via mitra travel
select skema_v2_splice('travel_complete_send',
  $a$  insert into order_events(order_id, status, note) values (p_order, 'completed', 'Titipan diterima di kota tujuan');$a$,
  $a$  insert into order_events(order_id, status, note) values (p_order, 'completed', 'Titipan diterima di kota tujuan');
  perform ledger_post(o.id, 'completed');   -- 0099: partner_payable = porsi mitra, sisanya platform$a$,
  'ledger_post(o.id');

-- 5n. estimate_fare — platform_fee dari service_economics + kunci customer_platform_fee
select skema_v2_splice('estimate_fare',
  $a$  select fare, platform_fee into v_fare, v_fee from calc_fare(p_service, v_km);$a$,
  $a$  select fare, platform_fee into v_fare, v_fee from calc_fare(p_service, v_km);
  v_fee := coalesce((select customer_platform_fee from service_economics where service = p_service), v_fee);   -- 0099 customer_platform_fee$a$,
  '0099 customer_platform_fee');
select skema_v2_splice('estimate_fare',
  $a$'fare', v_fare, 'platform_fee', v_fee, 'total', v_fare + v_fee,$a$,
  $a$'fare', v_fare, 'platform_fee', v_fee, 'customer_platform_fee', v_fee, 'total', v_fare + v_fee,$a$,
  $a$'customer_platform_fee', v_fee$a$);
grant execute on function public.estimate_fare(service_type, double precision, double precision, double precision, double precision, numeric) to anon, authenticated;

-- 5o. fare_options & shopping_estimate — tampilkan customer_platform_fee terpisah (total tetap = fare + biaya platform)
select skema_v2_splice('fare_options',
  $a$'helpers_fee', greatest(0, p_helpers) * v_helper,$a$,
  $a$'customer_platform_fee', (v_est->>'platform_fee')::bigint,   -- 0099
    'helpers_fee', greatest(0, p_helpers) * v_helper,$a$,
  'customer_platform_fee');
grant execute on function public.fare_options(service_type, double precision, double precision, double precision, double precision, numeric, integer) to anon, authenticated;
alter function public.fare_options(service_type, double precision, double precision, double precision, double precision, numeric, integer) volatile;

select skema_v2_splice('shopping_estimate',
  $a$'fare', v_fare, 'service_fee', v_service, 'subtotal', greatest(0, p_subtotal),$a$,
  $a$'fare', v_fare, 'service_fee', v_service, 'subtotal', greatest(0, p_subtotal), 'customer_platform_fee', v_fee,   -- 0099$a$,
  'customer_platform_fee');
grant execute on function public.shopping_estimate(service_type, double precision, double precision, double precision, double precision, bigint, text, numeric) to anon, authenticated;

-- 5p. driver_earnings_summary — jumlahkan pendapatan AKHIR (driver_earning_final, fallback driver_earning untuk order lama)
select skema_v2_splice('driver_earnings_summary',
  $a$sum(driver_earning)$a$,
  $a$sum(coalesce(driver_earning_final, driver_earning))$a$,
  'driver_earning_final', true);

-- 5q. view order_economics — driver_earning = pendapatan akhir; driver_base = dasar (ledger_version 2 tidak ditimpa)
do $$
declare def text; n1 int; n2 int;
  a1 constant text := 'o.driver_earning,';
  g1 constant text := 'COALESCE(o.driver_earning_final, o.driver_earning) AS driver_earning,';
  -- bentuk kurung GREATEST(...) berbeda antar versi/pretty-print → cocokkan dengan regex, bungkus hasil tangkapan
  a2 constant text := 'GREATEST\(\(?0\)?::bigint, [^\n]*o\.driver_earning - o\.tip[^\n]*o\.driver_service_share\)+';
  g2 constant text := 'CASE WHEN (o.ledger_version >= 2) THEN o.driver_earning ELSE \1 END';
begin
  if to_regclass('public.order_economics') is null then raise notice '0099: view order_economics tidak ada, dilewati'; return; end if;
  def := pg_get_viewdef('public.order_economics'::regclass, true);
  if position('driver_earning_final' in def) > 0 then raise notice '0099: order_economics sudah ditambal, dilewati'; return; end if;
  n1 := (length(def) - length(replace(def, a1, ''))) / length(a1);
  n2 := (select count(*) from regexp_matches(def, a2, 'g'));
  if n1 <> 1 or n2 <> 1 then
    raise exception '0099 batal: jangkar view order_economics tidak unik/tidak ada (a1=%, a2=%) — view TIDAK ditambal', n1, n2;
  end if;
  def := replace(regexp_replace(def, '(' || a2 || ')', g2), a1, g1);
  def := rtrim(rtrim(def), ';');
  execute 'create or replace view public.order_economics with (security_invoker = on) as ' || def;
end $$;

drop function if exists public.skema_v2_splice(text, text, text, text, boolean);

-- ---------------------------------------------------------------------
-- 6. Penjaga migrasi — semua tambalan benar-benar terpasang
-- ---------------------------------------------------------------------
do $$
declare
  chk record; def text; n int := 0; miss text := '';
begin
  for chk in select * from (values
      ('create_order', 'ledger_post(v_order.id'), ('create_order', 'driver_commission_pct_snap = v_dc'),
      ('driver_update_order_status', 'ledger_post(o.id, ''completed'')'), ('driver_update_order_status', 'driver_earning_final'),
      ('cancel_order', 'ledger_post(o.id'), ('merchant_update_order', 'ledger_post(o.id'), ('set_shopping_actual', 'ledger_post(o.id, ''adjusted'')'),
      ('add_tip', 'driver_earning_final'),
      ('driver_set_online', 'driver_debt_limit'), ('driver_accept_order', 'driver_debt_limit'),
      ('travel_book', 'ledger_post_travel'), ('travel_book', '0099 service_economics'),
      ('travel_offer_accept', 'ledger_post_travel'), ('travel_offer_accept', '0099 service_economics'),
      ('travel_trip_set_status', 'ledger_post_travel(''travel_bookings'', b.id, ''completed'')'), ('travel_trip_set_status', '0099 batal'),
      ('travel_booking_cancel', 'ledger_post_travel'),
      ('travel_request_set_status', 'ledger_post_travel(''travel_requests'', r.id, ''completed'')'), ('travel_request_set_status', '''penalty'''),
      ('travel_complete_send', 'ledger_post(o.id'),
      ('estimate_fare', '0099 customer_platform_fee'), ('estimate_fare', '''customer_platform_fee'', v_fee'),
      ('fare_options', 'customer_platform_fee'), ('shopping_estimate', 'customer_platform_fee'),
      ('driver_earnings_summary', 'driver_earning_final')
    ) as t(fn, marker) loop
    select pg_get_functiondef(p.oid) into def from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = chk.fn;
    if def is null or position(chk.marker in def) = 0 then miss := miss || chk.fn || '[' || chk.marker || '] '; else n := n + 1; end if;
  end loop;
  if miss <> '' then raise exception '0099 batal: tambalan belum terpasang: %', miss; end if;
  if position('driver_earning = driver_earning + v_extra_driver' in (select pg_get_functiondef('public.driver_update_order_status'::regproc))) > 0 then
    raise exception '0099 batal: driver_update_order_status masih menimpa driver_earning';
  end if;
  if position('pr.commission_pct / 100.0' in (select pg_get_functiondef('public.create_order'::regproc))) > 0 then
    raise exception '0099 batal: create_order masih memakai pricing.commission_pct';
  end if;
  if position('-500000 then' in (select pg_get_functiondef('public.driver_set_online'::regproc))) > 0
     or position('-500000 then' in (select pg_get_functiondef('public.driver_accept_order'::regproc))) > 0 then
    raise exception '0099 batal: batas saldo minus masih hard-code';
  end if;
  if position('driver_earning_final' in pg_get_viewdef('public.order_economics'::regclass)) = 0 then
    raise exception '0099 batal: view order_economics belum memakai driver_earning_final';
  end if;
  if not has_function_privilege('anon', 'public.fare_options(service_type,double precision,double precision,double precision,double precision,numeric,integer)', 'EXECUTE')
     or not has_function_privilege('anon', 'public.shopping_estimate(service_type,double precision,double precision,double precision,double precision,bigint,text,numeric)', 'EXECUTE')
     or not has_function_privilege('anon', 'public.estimate_fare(service_type,double precision,double precision,double precision,double precision,numeric)', 'EXECUTE') then
    raise exception '0099 batal: grant anon pada fare_options/shopping_estimate/estimate_fare hilang';
  end if;
  if has_function_privilege('authenticated', 'public.ledger_post(uuid,text,jsonb)', 'EXECUTE') then
    raise exception '0099 batal: ledger_post tidak boleh dipanggil langsung oleh klien';
  end if;
  if has_table_privilege('authenticated', 'public.order_ledger', 'INSERT') or has_table_privilege('authenticated', 'public.order_ledger', 'UPDATE')
     or has_table_privilege('authenticated', 'public.order_ledger', 'DELETE') or has_table_privilege('authenticated', 'public.order_ledger', 'TRUNCATE')
     or has_table_privilege('anon', 'public.order_ledger', 'SELECT') then
    raise exception '0099 batal: hak tulis/TRUNCATE klien atau baca anon pada order_ledger masih ada';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.order_ledger'::regclass) then
    raise exception '0099 batal: RLS order_ledger tidak aktif';
  end if;
  if has_function_privilege('anon', 'public.ledger_simulate(service_type,bigint,bigint,bigint,text,text,integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.ledger_calc(orders)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.ledger_calc(orders)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.ledger_post_travel(text,uuid,text,jsonb)', 'EXECUTE') then
    raise exception '0099 batal: ledger_calc/ledger_post_travel/ledger_simulate terbuka untuk klien';
  end if;
  if exists (select 1 from pg_policies where tablename = 'order_ledger' and cmd in ('INSERT','UPDATE','DELETE','ALL')) then
    raise exception '0099 batal: order_ledger tidak boleh punya kebijakan tulis untuk klien';
  end if;
  if to_regclass('public.payment_channel_fees') is null
     and exists (select 1 from pg_fee_calc('qris', 100000) f where f.fee <> 0 or f.ppn <> 0) then
    raise exception '0099 batal: pg_fee_calc harus (0,0) selama payment_channel_fees belum ada';
  end if;
  raise notice '0099 ok: % tambalan terpasang; order_ledger, ledger_post/check/simulate, breakdown driver & merchant siap', n;
end $$;

comment on function public.create_order(jsonb) is
  'Membuat pesanan untuk semua layanan (ride/car/food/send/box/shop/market). '
  'Sejak 0080 pesanan DITOLAK bila titik jemput berada di kota yang layanannya belum dibuka. '
  'Sejak 0083 idempoten: p.client_request_id yang sama mengembalikan pesanan yang sudah ada. '
  'Sejak 0088/0089 paid_via DITOLAK bila AntarPay/salurannya dimatikan admin. '
  'Sejak 0099 komisi/fee/biaya platform dibaca dari service_economics (snapshot ke orders), promo punya pemilik biaya (promos.funded_by), buku besar order_ledger fase created.';
comment on function public.driver_update_order_status(uuid, order_status, text) is
  'Transisi status oleh driver. Sejak 0099 saat completed: ledger_post(''completed'') → driver_earning_final; kredit/debit dompet diturunkan dari driver_payable/vendor_payable/merchant_payable/driver_receivable; driver_earning (dasar) tidak ditimpa.';
