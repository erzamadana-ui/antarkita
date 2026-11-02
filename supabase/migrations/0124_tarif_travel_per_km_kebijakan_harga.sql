-- =====================================================================
-- 0124 — Tarif AntarTravel per km (rate card per model mobil) + kebijakan harga (keputusan GM 7 & 8, 31 Okt 2026)
--   Keputusan 7 (travel):
--   • Tabel travel_rate_cards: model mobil → kursi, Rp/km, tarif dasar, tarif minimum, komisi platform %, biaya platform tetap,
--     pengali carter, jaminan porsi mitra %. Seed 5 model [ASUMSI angka — kalibrasi admin lewat admin_set_travel_rate_card]:
--       Avanza/Xenia 7 kursi Rp3.500/km · Innova Reborn 7 Rp4.500/km · Hiace Commuter 14 Rp6.500/km · Hiace Premio 11 Rp8.000/km · Alphard 6 Rp12.000/km
--       tarif dasar Rp25.000 · minimum Rp150.000 · komisi 10 % · biaya platform pelanggan Rp5.000 (= service_economics.travel lama) · porsi mitra ≥ 85 %.
--   • travel_city_distance_km(from,to) = jarak bola (haversine) pusat kota × travel_road_factor (1,25).
--     travel_quote memakai travel_routes.distance_km bila rute aktif ada (travel_distance_source='route_first' [ASUMSI: jarak jalan
--     Pekanbaru–Padang 355 km vs haversine×1,25 = 253 km → faktor 1,25 terlalu rendah untuk koridor Bukit Barisan; rute = sumber lebih jujur).
--   • travel_quote(from,to,model,mode,pax) → JSON lengkap (km, tarif, fare_total / fare_per_seat, platform_fee, ppn, driver_net, breakdown[]).
--     Kursi bersama = fare_total ÷ kursi × (1 + travel_shared_markup_pct 15 %) [ASUMSI], dibulatkan ke atas Rp1.000.
--   • Integrasi (splice minimal pada baris kode, fungsi lama dicadangkan _mig_backup):
--       travel_trip_create : seat_price/private_price default = quote; nilai mitra harus dalam ±travel_price_tolerance_pct (10 %) → TRAVEL_PRICE_OUT_OF_RANGE.
--       travel_book        : harga trip tetap; komisi & biaya platform dari rate card mitra; kolom commission/ppn/price_breakdown terisi →
--                            ledger_post_travel membaca platform_fee & partner_earning dari baris booking (menerima angka quote tanpa perubahan ledger).
--       travel_offer_create: tawaran carter < travel_offer_min_pct (90 %) quote ditolak (TRAVEL_OFFER_TOO_LOW); quote acuan disimpan di travel_offers.quote.
--   • RPC admin: admin_travel_rate_cards(), admin_set_travel_rate_card(jsonb) (izin pricing + PIN). Publik: travel_rate_cards_public().
--   Keputusan 8 (kebijakan harga):
--   • Setelan promo_budget_pct_max 5, promo_default_funded_by 'platform', driver_min_share_pct 80, fare_floor_per_km_<layanan> [ASUMSI].
--   • pricing_policy_check() → daftar pelanggaran (porsi driver < minimum, tarif driver/km < floor, promo melampaui anggaran, funded_by ≠ default);
--     admin_pricing_policy() → ringkasan panel admin. Dokumen: docs/KEBIJAKAN-HARGA.md.
-- Tidak menyentuh create_order / driver_* / ledger_calc / request_withdrawal.
-- Idempoten. Rollback: supabase/rollback/0124_down.sql. Uji: supabase/tests/uji_travel_tarif_0124.sql
-- =====================================================================
do $$
declare s text;
begin
  foreach s in array array[
    'public.app_setting_specs()', 'public.travel_trip_create(jsonb)', 'public.travel_book(jsonb)',
    'public.travel_offer_create(uuid,bigint,jsonb,text)',                                            -- diubah (splice)
    'public.travel_city_distance_km(uuid,uuid)', 'public.travel_rate_card_pick(text,integer)', 'public.travel_rate_card_for_partner(uuid)',
    'public.travel_fare_split(bigint,travel_rate_cards)', 'public.travel_quote(uuid,uuid,text,text,integer)',
    'public.travel_trip_prices(travel_partners,travel_routes,jsonb)', 'public.travel_booking_apply_quote(uuid)',
    'public.travel_offer_quote_guard(travel_requests,travel_partners,bigint)',
    'public.admin_travel_rate_cards()', 'public.admin_set_travel_rate_card(jsonb)', 'public.travel_rate_cards_public()',
    'public.pricing_policy_check()', 'public.admin_pricing_policy()'] loop                           -- baru (NULL → dihapus saat rollback)
    perform _mig_backup('0124', s);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 1. Setelan
-- ---------------------------------------------------------------------
insert into app_settings (key, value) values
  ('travel_road_factor',          '1.25'::jsonb),
  ('travel_distance_source',      '"route_first"'::jsonb),
  ('travel_shared_markup_pct',    '15'::jsonb),
  ('travel_price_tolerance_pct',  '10'::jsonb),
  ('travel_offer_min_pct',        '90'::jsonb),
  ('promo_budget_pct_max',        '5'::jsonb),
  ('promo_default_funded_by',     '"platform"'::jsonb),
  ('driver_min_share_pct',        '80'::jsonb),
  ('fare_floor_per_km_ride_motor','2000'::jsonb),
  ('fare_floor_per_km_ride_car',  '3500'::jsonb),
  ('fare_floor_per_km_send',      '2000'::jsonb),
  ('fare_floor_per_km_food',      '2000'::jsonb),
  ('fare_floor_per_km_shop',      '2000'::jsonb),
  ('fare_floor_per_km_market',    '2000'::jsonb),
  ('fare_floor_per_km_box',       '5000'::jsonb),
  ('fare_floor_per_km_travel',    '3000'::jsonb)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 2. Tabel rate card + kolom pendukung
-- ---------------------------------------------------------------------
create table if not exists public.travel_rate_cards (
  id                 uuid primary key default gen_random_uuid(),
  vehicle_model      text not null unique,
  match_regex        text,                                   -- cocokkan travel_partners.vehicle_model (~*), mis. 'innova|kijang'
  seats              int not null check (seats between 2 and 60),
  per_km             bigint not null check (per_km between 500 and 100000),
  base_fare          bigint not null default 25000 check (base_fare >= 0),
  min_fare           bigint not null default 150000 check (min_fare >= 0),
  driver_share_pct   numeric(5,2) not null default 85 check (driver_share_pct between 50 and 100),
  platform_fee_pct   numeric(5,2) not null default 10 check (platform_fee_pct between 0 and 50),
  platform_fee_flat  bigint not null default 0 check (platform_fee_flat >= 0),
  charter_multiplier numeric(4,2) not null default 1.0 check (charter_multiplier between 0.5 and 3),
  sort_order         int not null default 100,
  active             boolean not null default true,
  note               text,
  updated_by         uuid references public.profiles(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint travel_rate_cards_share_fee check (driver_share_pct + platform_fee_pct <= 100)
);
comment on table public.travel_rate_cards is '0124: rate card AntarTravel per model mobil (Rp/km, tarif dasar/minimum, komisi platform, biaya platform tetap, pengali carter, jaminan porsi mitra). Ditulis hanya lewat admin_set_travel_rate_card; dibaca travel_quote.';
alter table public.travel_rate_cards enable row level security;
revoke all on public.travel_rate_cards from public, anon, authenticated;
grant all on public.travel_rate_cards to service_role;

insert into public.travel_rate_cards (vehicle_model, match_regex, seats, per_km, base_fare, min_fare, driver_share_pct, platform_fee_pct, platform_fee_flat, charter_multiplier, sort_order, note) values
  ('Avanza/Xenia',    'avanza|xenia|veloz|ertiga|mobilio|rush|terios', 7,  3500,  25000, 150000, 85, 10, 5000, 1.0, 10, '[ASUMSI 31 Okt] MPV kecil; kalibrasi dengan harga pasar carter Pekanbaru'),
  ('Innova Reborn',   'innova|kijang|zenix',                            7,  4500,  25000, 150000, 85, 10, 5000, 1.0, 20, '[ASUMSI 31 Okt] MPV menengah'),
  ('Hiace Commuter',  'commuter|elf|hiace(?!.*premio)',                 14, 6500,  25000, 150000, 85, 10, 5000, 1.0, 30, '[ASUMSI 31 Okt] minibus 14 kursi'),
  ('Hiace Premio',    'premio',                                         11, 8000,  25000, 150000, 85, 10, 5000, 1.0, 40, '[ASUMSI 31 Okt] minibus premium 11 kursi'),
  ('Alphard',         'alphard|vellfire',                               6,  12000, 25000, 150000, 85, 10, 5000, 1.0, 50, '[ASUMSI 31 Okt] MPV mewah')
on conflict (vehicle_model) do nothing;

alter table public.travel_partners add column if not exists rate_card_id uuid references public.travel_rate_cards(id) on delete set null;
comment on column public.travel_partners.rate_card_id is '0124: rate card yang dipatok admin untuk mitra ini (NULL → dicocokkan dari vehicle_model/seats).';
alter table public.travel_bookings add column if not exists commission bigint not null default 0;
alter table public.travel_bookings add column if not exists ppn bigint not null default 0;
alter table public.travel_bookings add column if not exists price_breakdown jsonb;
comment on column public.travel_bookings.commission is '0124: komisi platform dari harga kursi/carter (= price − platform_fee − partner_earning).';
comment on column public.travel_bookings.ppn is '0124: PPN inklusif di dalam (platform_fee + commission) — memo, konsisten ledger_calc 0114.';
comment on column public.travel_bookings.price_breakdown is '0124: rincian harga saat pesan (travel_fare_split + model/rate card) — tetap walau rate card berubah.';
alter table public.travel_offers add column if not exists quote jsonb;
comment on column public.travel_offers.quote is '0124: quote carter acuan saat tawaran dibuat (NULL bila kota asal/tujuan tidak diketahui).';

-- ---------------------------------------------------------------------
-- 3. Jarak antar pusat kota
-- ---------------------------------------------------------------------
create or replace function public.travel_city_distance_km(p_from uuid, p_to uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select round((st_distance(a.location, b.location, false) / 1000.0 * setting_num('travel_road_factor', 1.25))::numeric, 1)
    from cities a, cities b
   where a.id = p_from and b.id = p_to and a.location is not null and b.location is not null;
$$;
comment on function public.travel_city_distance_km(uuid, uuid) is '0124: jarak bola (haversine) pusat kota × travel_road_factor, km 1 desimal; NULL bila kota/lokasi tidak ada.';
revoke all on function public.travel_city_distance_km(uuid, uuid) from public;
grant execute on function public.travel_city_distance_km(uuid, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. Pemilihan rate card
-- ---------------------------------------------------------------------
-- p_model: id uuid / nama persis / teks model bebas (dicocokkan match_regex); p_seats: cadangan — kursi terdekat; NULL → Rp/km termurah
create or replace function public.travel_rate_card_pick(p_model text default null, p_seats int default null)
returns travel_rate_cards language plpgsql stable security definer set search_path = public as $$
declare rc travel_rate_cards; v_model text := nullif(btrim(coalesce(p_model, '')), '');
begin
  if v_model is not null then
    if v_model ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      select * into rc from travel_rate_cards where id = v_model::uuid and active; if found then return rc; end if;
    end if;
    select * into rc from travel_rate_cards where active and lower(vehicle_model) = lower(v_model); if found then return rc; end if;
    select * into rc from travel_rate_cards
     where active and match_regex is not null and v_model ~* match_regex
     order by case when p_seats is not null then abs(seats - p_seats) else 0 end, sort_order limit 1;
    if found then return rc; end if;
  end if;
  if p_seats is not null then
    select * into rc from travel_rate_cards where active order by abs(seats - p_seats), per_km, sort_order limit 1;
    if found then return rc; end if;
  end if;
  select * into rc from travel_rate_cards where active order by per_km, sort_order limit 1;
  return rc;   -- NULL bila tidak ada rate card aktif
end $$;
revoke all on function public.travel_rate_card_pick(text, int) from public, anon;
grant execute on function public.travel_rate_card_pick(text, int) to authenticated;

create or replace function public.travel_rate_card_for_partner(p_partner uuid)
returns travel_rate_cards language plpgsql stable security definer set search_path = public as $$
declare tp travel_partners; rc travel_rate_cards;
begin
  select * into tp from travel_partners where id = p_partner;
  if not found then return travel_rate_card_pick(null, null); end if;
  if tp.rate_card_id is not null then
    select * into rc from travel_rate_cards where id = tp.rate_card_id and active; if found then return rc; end if;
  end if;
  return travel_rate_card_pick(tp.vehicle_model, tp.seats);
end $$;
revoke all on function public.travel_rate_card_for_partner(uuid) from public, anon;
grant execute on function public.travel_rate_card_for_partner(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Pembagian tarif (satu sumber untuk quote & booking)
-- ---------------------------------------------------------------------
--   commission = floor(fare × platform_fee_pct) dibatasi agar driver_net ≥ driver_share_pct × fare;
--   customer_platform_fee = platform_fee_flat (ditambahkan ke tagihan pelanggan, pola travel_book lama);
--   platform_fee_total = commission + flat; ppn = PPN inklusif di dalam platform_fee_total (ppn_inclusive, pola ledger_calc 0114).
create or replace function public.travel_fare_split(p_fare bigint, rc travel_rate_cards)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_comm bigint; v_cap bigint; v_flat bigint := coalesce(rc.platform_fee_flat, 0); v_tot bigint; v_ppn bigint := 0;
        ppn numeric := setting_num('ppn_pct', 11);
        ppn_incl boolean := coalesce((select lower(value #>> '{}') = 'true' from app_settings where key = 'ppn_inclusive'), true);
begin
  if p_fare is null or p_fare < 0 then raise exception 'travel_fare_split: tarif tidak valid'; end if;
  v_comm := floor(p_fare * coalesce(rc.platform_fee_pct, 10) / 100.0)::bigint;
  v_cap  := p_fare - ceil(p_fare * coalesce(rc.driver_share_pct, 85) / 100.0)::bigint;   -- komisi maksimum agar porsi mitra terjaga
  if v_comm > v_cap then v_comm := greatest(0, v_cap); end if;
  v_tot := v_comm + v_flat;
  if ppn_incl and ppn > 0 and v_tot > 0 then v_ppn := round(v_tot * ppn / (100 + ppn))::bigint; end if;
  return jsonb_build_object(
    'fare', p_fare, 'commission', v_comm, 'commission_pct', coalesce(rc.platform_fee_pct, 10),
    'customer_platform_fee', v_flat, 'customer_total', p_fare + v_flat,
    'platform_fee', v_tot, 'ppn', v_ppn, 'ppn_pct', ppn, 'ppn_inclusive', ppn_incl, 'platform_revenue_net', v_tot - v_ppn,
    'driver_net', p_fare - v_comm,
    'driver_share_pct_actual', case when p_fare > 0 then round((p_fare - v_comm) * 100.0 / p_fare, 1) else null end,
    'driver_share_pct_min', coalesce(rc.driver_share_pct, 85));
end $$;
revoke all on function public.travel_fare_split(bigint, travel_rate_cards) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 6. Quote
-- ---------------------------------------------------------------------
create or replace function public.travel_quote(p_from uuid, p_to uuid, p_model text default null, p_mode text default 'charter', p_pax int default 1)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare rc travel_rate_cards; v_km numeric; v_km_src text; v_hav numeric; v_route travel_routes; v_from cities; v_to cities;
        v_mode text := lower(coalesce(nullif(btrim(p_mode), ''), 'charter')); v_pax int := greatest(1, coalesce(p_pax, 1));
        v_dist bigint; v_raw bigint; v_vehicle bigint; v_total bigint; v_seat bigint; v_fare bigint; v_min_adj bigint := 0;
        v_markup numeric := setting_num('travel_shared_markup_pct', 15); v_factor numeric := setting_num('travel_road_factor', 1.25);
        v_src text := coalesce((select value #>> '{}' from app_settings where key = 'travel_distance_source'), 'route_first');
        sp jsonb; bd jsonb := '[]'::jsonb;
begin
  if v_mode not in ('shared', 'charter') then raise exception 'TRAVEL_QUOTE: mode harus shared|charter'; end if;
  if p_from is null or p_to is null then raise exception 'TRAVEL_QUOTE: kota asal dan tujuan wajib diisi'; end if;
  if p_from = p_to then raise exception 'TRAVEL_QUOTE: kota asal dan tujuan sama'; end if;
  select * into v_from from cities where id = p_from; if not found then raise exception 'TRAVEL_QUOTE: kota asal tidak ditemukan'; end if;
  select * into v_to   from cities where id = p_to;   if not found then raise exception 'TRAVEL_QUOTE: kota tujuan tidak ditemukan'; end if;
  rc := travel_rate_card_pick(p_model, null);
  if rc.id is null then raise exception 'TRAVEL_QUOTE: belum ada rate card travel aktif'; end if;
  v_hav := travel_city_distance_km(p_from, p_to);
  select * into v_route from travel_routes r where r.from_city = p_from and r.to_city = p_to and r.active and r.distance_km > 0 limit 1;
  if v_src = 'route_first' and v_route.id is not null then v_km := v_route.distance_km; v_km_src := 'route';
  else v_km := v_hav; v_km_src := 'haversine'; end if;
  if v_km is null then raise exception 'TRAVEL_QUOTE: lokasi pusat kota % / % belum ada', v_from.name, v_to.name; end if;

  v_dist := (ceil(v_km) * rc.per_km)::bigint;
  v_raw := rc.base_fare + v_dist;
  if v_raw < rc.min_fare then v_min_adj := rc.min_fare - v_raw; end if;
  v_vehicle := (ceil(greatest(v_raw, rc.min_fare) / 1000.0) * 1000)::bigint;                 -- tarif mobil penuh, dibulatkan ke atas Rp1.000
  v_total := (ceil(v_vehicle * rc.charter_multiplier / 1000.0) * 1000)::bigint;               -- carter
  v_seat := (ceil(v_vehicle / rc.seats::numeric * (1 + v_markup / 100.0) / 1000.0) * 1000)::bigint;   -- per kursi (bersama)
  v_fare := case when v_mode = 'charter' then v_total else v_seat * v_pax end;
  sp := travel_fare_split(v_fare, rc);

  bd := bd || jsonb_build_object('key', 'base_fare', 'label', 'Tarif dasar', 'amount', rc.base_fare)
           || jsonb_build_object('key', 'distance', 'label', format('%s km × Rp%s/km', v_km, to_char(rc.per_km, 'FM999G999G999')), 'amount', v_dist);
  if v_min_adj > 0 then bd := bd || jsonb_build_object('key', 'min_fare', 'label', 'Penyesuaian tarif minimum', 'amount', v_min_adj); end if;
  if v_vehicle - greatest(v_raw, rc.min_fare) <> 0 then bd := bd || jsonb_build_object('key', 'rounding', 'label', 'Pembulatan Rp1.000', 'amount', v_vehicle - greatest(v_raw, rc.min_fare)); end if;
  if v_mode = 'charter' then
    if rc.charter_multiplier <> 1 then bd := bd || jsonb_build_object('key', 'charter_multiplier', 'label', 'Pengali carter ×' || rc.charter_multiplier, 'amount', v_total - v_vehicle); end if;
  else
    bd := bd || jsonb_build_object('key', 'per_seat', 'label', format('Per kursi: Rp%s ÷ %s kursi × %s %% markup', to_char(v_vehicle, 'FM999G999G999'), rc.seats, 100 + v_markup), 'amount', v_seat)
             || jsonb_build_object('key', 'pax', 'label', v_pax || ' kursi', 'amount', v_fare);
  end if;
  bd := bd || jsonb_build_object('key', 'customer_platform_fee', 'label', 'Biaya platform (pelanggan)', 'amount', sp->'customer_platform_fee')
           || jsonb_build_object('key', 'commission', 'label', 'Komisi platform ' || (sp->>'commission_pct') || ' %', 'amount', sp->'commission')
           || jsonb_build_object('key', 'ppn', 'label', 'PPN ' || (sp->>'ppn_pct') || ' % (termasuk)', 'amount', sp->'ppn')
           || jsonb_build_object('key', 'driver_net', 'label', 'Diterima mitra', 'amount', sp->'driver_net');

  return jsonb_build_object(
    'from_city', jsonb_build_object('id', v_from.id, 'name', v_from.name), 'to_city', jsonb_build_object('id', v_to.id, 'name', v_to.name),
    'km', v_km, 'km_source', v_km_src, 'km_haversine_x_factor', v_hav, 'road_factor', v_factor, 'route_id', v_route.id,
    'rate_card_id', rc.id, 'model', rc.vehicle_model, 'seats', rc.seats, 'mode', v_mode, 'pax', v_pax,
    'per_km', rc.per_km, 'base_fare', rc.base_fare, 'min_fare', rc.min_fare, 'charter_multiplier', rc.charter_multiplier, 'shared_markup_pct', v_markup,
    'fare_vehicle', v_vehicle, 'fare_total', v_total, 'fare_per_seat', v_seat, 'fare', v_fare,
    'customer_platform_fee', sp->'customer_platform_fee', 'customer_total', sp->'customer_total',
    'commission', sp->'commission', 'platform_fee', sp->'platform_fee', 'ppn', sp->'ppn', 'platform_revenue_net', sp->'platform_revenue_net',
    'driver_net', sp->'driver_net', 'driver_share_pct_actual', sp->'driver_share_pct_actual',
    'tolerance_pct', setting_num('travel_price_tolerance_pct', 10), 'offer_min_pct', setting_num('travel_offer_min_pct', 90),
    'breakdown', bd, 'quoted_at', now());
end $$;
comment on function public.travel_quote(uuid, uuid, text, text, int) is '0124: acuan tarif AntarTravel pusat kota asal→tujuan × model mobil. mode shared → fare_per_seat & fare = per kursi × pax; charter → fare_total. platform_fee = komisi + biaya platform tetap; ppn inklusif; driver_net = fare − komisi.';
revoke all on function public.travel_quote(uuid, uuid, text, text, int) from public;
grant execute on function public.travel_quote(uuid, uuid, text, text, int) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 7. Integrasi travel_trip_create: harga trip = quote per kursi (mitra boleh ±toleransi)
-- ---------------------------------------------------------------------
create or replace function public.travel_trip_prices(tp travel_partners, r travel_routes, p jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare rc travel_rate_cards; qs jsonb; qc jsonb; v_tol numeric := setting_num('travel_price_tolerance_pct', 10);
        v_seat bigint := nullif(p->>'seat_price', '')::bigint; v_priv bigint := nullif(p->>'private_price', '')::bigint;
        ref_seat bigint; ref_priv bigint;
begin
  rc := travel_rate_card_for_partner(tp.id);
  if rc.id is null then   -- tanpa rate card aktif: perilaku lama (harga rute)
    return jsonb_build_object('seat_price', coalesce(v_seat, r.seat_price),
      'private_price', coalesce(v_priv, case when tp.seats >= 10 then coalesce(r.private_price_large, r.private_price) else r.private_price end), 'quote', null);
  end if;
  qs := travel_quote(r.from_city, r.to_city, rc.id::text, 'shared', 1);
  qc := travel_quote(r.from_city, r.to_city, rc.id::text, 'charter', 1);
  ref_seat := (qs->>'fare_per_seat')::bigint; ref_priv := (qc->>'fare_total')::bigint;
  if v_seat is not null and (v_seat < ref_seat * (100 - v_tol) / 100.0 or v_seat > ref_seat * (100 + v_tol) / 100.0) then
    raise exception 'TRAVEL_PRICE_OUT_OF_RANGE: harga kursi Rp% di luar ±% %% acuan Rp% (%) — rentang Rp%–Rp%',
      to_char(v_seat, 'FM999G999G999'), v_tol, to_char(ref_seat, 'FM999G999G999'), rc.vehicle_model,
      to_char(floor(ref_seat * (100 - v_tol) / 100.0), 'FM999G999G999'), to_char(ceil(ref_seat * (100 + v_tol) / 100.0), 'FM999G999G999');
  end if;
  if v_priv is not null and (v_priv < ref_priv * (100 - v_tol) / 100.0 or v_priv > ref_priv * (100 + v_tol) / 100.0) then
    raise exception 'TRAVEL_PRICE_OUT_OF_RANGE: harga carter Rp% di luar ±% %% acuan Rp% (%) — rentang Rp%–Rp%',
      to_char(v_priv, 'FM999G999G999'), v_tol, to_char(ref_priv, 'FM999G999G999'), rc.vehicle_model,
      to_char(floor(ref_priv * (100 - v_tol) / 100.0), 'FM999G999G999'), to_char(ceil(ref_priv * (100 + v_tol) / 100.0), 'FM999G999G999');
  end if;
  return jsonb_build_object('seat_price', coalesce(v_seat, ref_seat), 'private_price', coalesce(v_priv, ref_priv),
    'quote', jsonb_build_object('shared', qs, 'charter', qc));
end $$;
revoke all on function public.travel_trip_prices(travel_partners, travel_routes, jsonb) from public, anon, authenticated;

select _v3_splice('0124', 'public.travel_trip_create(jsonb)',
  $a$coalesce((p->>'seat_price')::bigint, r.seat_price), case when tp.seats >= 10 then coalesce(r.private_price_large, r.private_price) else r.private_price end,$a$,
  $a$(travel_trip_prices(tp, r, p)->>'seat_price')::bigint, (travel_trip_prices(tp, r, p)->>'private_price')::bigint,   -- 0124: acuan quote ±toleransi$a$,
  'travel_trip_prices(tp, r, p)');

-- ---------------------------------------------------------------------
-- 8. Integrasi travel_book: harga trip tetap; komisi/biaya platform dari rate card; rincian disimpan
-- ---------------------------------------------------------------------
create or replace function public.travel_booking_apply_quote(p_booking uuid)
returns travel_bookings language plpgsql security definer set search_path = public as $$
declare b travel_bookings; t travel_trips; rc travel_rate_cards; v_fare bigint; sp jsonb; v_route travel_routes;
begin
  select * into b from travel_bookings where id = p_booking for update;
  if not found then raise exception 'travel_booking_apply_quote: booking % tidak ada', p_booking; end if;
  select * into t from travel_trips where id = b.trip_id;
  rc := travel_rate_card_for_partner(t.partner_id);
  if rc.id is null then return b; end if;                       -- tanpa rate card: biarkan angka travel_book lama
  v_fare := b.price - b.platform_fee;                           -- harga kursi × pax / carter (tetap, dari trip)
  sp := travel_fare_split(v_fare, rc);
  select * into v_route from travel_routes where id = t.route_id;
  update travel_bookings set
    commission = (sp->>'commission')::bigint,
    partner_earning = (sp->>'driver_net')::bigint,
    ppn = (sp->>'ppn')::bigint,
    price_breakdown = sp || jsonb_build_object('rate_card_id', rc.id, 'model', rc.vehicle_model, 'mode', case when b.is_private then 'charter' else 'shared' end,
      'pax', b.pax, 'unit_price', case when b.is_private then t.private_price else t.seat_price end,
      'route_km', v_route.distance_km, 'from_city', v_route.from_city, 'to_city', v_route.to_city, 'computed_at', now(), 'source', '0124 travel_booking_apply_quote')
  where id = b.id returning * into b;
  return b;
end $$;
revoke all on function public.travel_booking_apply_quote(uuid) from public, anon, authenticated;

select _v3_splice('0124', 'public.travel_book(jsonb)',
  $a$  if not found or t.status not in ('open','confirmed') then raise exception 'Jadwal tidak tersedia'; end if;$a$,
  $a$  if not found or t.status not in ('open','confirmed') then raise exception 'Jadwal tidak tersedia'; end if;
  v_fee  := coalesce((select rc.platform_fee_flat from travel_rate_card_for_partner(t.partner_id) rc), v_fee);   -- 0124: biaya platform & komisi dari rate card mitra
  v_comm := coalesce((select rc.platform_fee_pct  from travel_rate_card_for_partner(t.partner_id) rc), v_comm);$a$,
  '0124: biaya platform & komisi dari rate card mitra');

select _v3_splice('0124', 'public.travel_book(jsonb)',
  $a$  if v_pay = 'wallet' then$a$,
  $a$  b := travel_booking_apply_quote(b.id);   -- 0124: commission/ppn/price_breakdown; partner_earning dari travel_fare_split
  if v_pay = 'wallet' then$a$,
  '0124: commission/ppn/price_breakdown');

-- ---------------------------------------------------------------------
-- 9. Integrasi travel_offer_create: tawaran carter di bawah ambang quote ditolak; quote disimpan
-- ---------------------------------------------------------------------
create or replace function public.travel_offer_quote_guard(r travel_requests, tp travel_partners, p_price bigint)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare rc travel_rate_cards; q jsonb; v_min numeric := setting_num('travel_offer_min_pct', 90); v_floor bigint;
begin
  if r.kind <> 'charter' or r.from_city is null or r.to_city is null or r.from_city = r.to_city or coalesce(r.days, 1) <> 1 then return null; end if;
  rc := travel_rate_card_for_partner(tp.id);
  if rc.id is null then return null; end if;
  if nullif(btrim(coalesce(r.vehicle_pref, '')), '') is not null then   -- pelanggan minta model tertentu → acuan model itu [ASUMSI]
    rc := coalesce(travel_rate_card_pick(r.vehicle_pref, tp.seats), rc);
  end if;
  q := travel_quote(r.from_city, r.to_city, rc.id::text, 'charter', r.pax);
  v_floor := ceil((q->>'fare_total')::numeric * v_min / 100.0)::bigint;
  if p_price < v_floor then
    raise exception 'TRAVEL_OFFER_TOO_LOW: tawaran Rp% di bawah % %% acuan carter % Rp% (minimal Rp%)',
      to_char(p_price, 'FM999G999G999'), v_min, rc.vehicle_model, to_char((q->>'fare_total')::bigint, 'FM999G999G999'), to_char(v_floor, 'FM999G999G999');
  end if;
  return q || jsonb_build_object('offer_price', p_price, 'offer_min_price', v_floor, 'offer_vs_quote_pct', round(p_price * 100.0 / (q->>'fare_total')::numeric, 1));
end $$;
revoke all on function public.travel_offer_quote_guard(travel_requests, travel_partners, bigint) from public, anon, authenticated;

select _v3_splice('0124', 'public.travel_offer_create(uuid,bigint,jsonb,text)',
  $a$declare r travel_requests%rowtype; tp travel_partners%rowtype; o travel_offers%rowtype;$a$,
  $a$declare r travel_requests%rowtype; tp travel_partners%rowtype; o travel_offers%rowtype; v_q124 jsonb;$a$,
  'v_q124 jsonb;');
select _v3_splice('0124', 'public.travel_offer_create(uuid,bigint,jsonb,text)',
  $a$  if p_price < 50000 or p_price > 50000000 then raise exception 'Harga penawaran tidak wajar'; end if;$a$,
  $a$  if p_price < 50000 or p_price > 50000000 then raise exception 'Harga penawaran tidak wajar'; end if;
  v_q124 := travel_offer_quote_guard(r, tp, p_price);   -- 0124: < travel_offer_min_pct quote carter → TRAVEL_OFFER_TOO_LOW$a$,
  'travel_offer_quote_guard(r, tp, p_price)');
select _v3_splice('0124', 'public.travel_offer_create(uuid,bigint,jsonb,text)',
  $a$  returning * into o;$a$,
  $a$  returning * into o;
  if v_q124 is not null then update travel_offers set quote = v_q124 where id = o.id returning * into o; end if;   -- 0124 quote acuan$a$,
  '0124 quote acuan');

-- ---------------------------------------------------------------------
-- 10. RPC rate card: admin & publik
-- ---------------------------------------------------------------------
create or replace function public.admin_travel_rate_cards()
returns setof jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform admin_require('view');
  return query
    select to_jsonb(rc) || jsonb_build_object(
      'partners_matched', (select count(*) from travel_partners tp where tp.status = 'approved' and (travel_rate_card_for_partner(tp.id)).id = rc.id),
      'driver_net_per_km', round(rc.per_km * (100 - rc.platform_fee_pct) / 100.0),
      'fare_floor_per_km', setting_num('fare_floor_per_km_travel', 3000),
      'sample_pku_pdg', (select travel_quote(a.id, b.id, rc.id::text, 'charter', 1) - 'breakdown' from cities a, cities b where a.name = 'Pekanbaru' and b.name = 'Padang' limit 1))
      from travel_rate_cards rc order by rc.active desc, rc.sort_order, rc.vehicle_model;
end $$;
revoke all on function public.admin_travel_rate_cards() from public, anon;
grant execute on function public.admin_travel_rate_cards() to authenticated;

create or replace function public.admin_set_travel_rate_card(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b travel_rate_cards; a travel_rate_cards; v_id uuid; v_model text; k text;
        allowed constant text[] := array['id','vehicle_model','match_regex','seats','per_km','base_fare','min_fare','driver_share_pct','platform_fee_pct',
                                         'platform_fee_flat','charter_multiplier','sort_order','active','note'];
begin
  perform admin_require('pricing');
  perform admin_require_unlock();
  if p is null or jsonb_typeof(p) <> 'object' or p = '{}'::jsonb then raise exception 'Rate card harus objek JSON'; end if;
  for k in select jsonb_object_keys(p) loop
    if not (k = any (allowed)) then raise exception 'Kolom tidak dikenal: %', k; end if;
  end loop;
  v_id := nullif(p->>'id', '')::uuid; v_model := nullif(btrim(coalesce(p->>'vehicle_model', '')), '');
  if v_id is not null then select * into b from travel_rate_cards where id = v_id for update;
  elsif v_model is not null then select * into b from travel_rate_cards where lower(vehicle_model) = lower(v_model) for update; end if;
  if b.id is null and v_model is null then raise exception 'vehicle_model wajib untuk rate card baru'; end if;
  if b.id is null and (p->>'seats') is null then raise exception 'seats wajib untuk rate card baru'; end if;
  if b.id is null and (p->>'per_km') is null then raise exception 'per_km wajib untuk rate card baru'; end if;
  if p ? 'match_regex' and nullif(btrim(p->>'match_regex'), '') is not null then
    perform 'uji' ~* (p->>'match_regex');   -- regex harus valid
  end if;
  insert into travel_rate_cards (id, vehicle_model, match_regex, seats, per_km, base_fare, min_fare, driver_share_pct, platform_fee_pct, platform_fee_flat,
                                 charter_multiplier, sort_order, active, note, updated_by, updated_at)
  values (coalesce(b.id, gen_random_uuid()), coalesce(v_model, b.vehicle_model),
          case when p ? 'match_regex' then nullif(btrim(p->>'match_regex'), '') else b.match_regex end,
          coalesce((p->>'seats')::int, b.seats), coalesce((p->>'per_km')::bigint, b.per_km),
          coalesce((p->>'base_fare')::bigint, b.base_fare, 25000), coalesce((p->>'min_fare')::bigint, b.min_fare, 150000),
          coalesce((p->>'driver_share_pct')::numeric, b.driver_share_pct, 85), coalesce((p->>'platform_fee_pct')::numeric, b.platform_fee_pct, 10),
          coalesce((p->>'platform_fee_flat')::bigint, b.platform_fee_flat, 5000), coalesce((p->>'charter_multiplier')::numeric, b.charter_multiplier, 1.0),
          coalesce((p->>'sort_order')::int, b.sort_order, 100), coalesce((p->>'active')::boolean, b.active, true),
          case when p ? 'note' then nullif(btrim(p->>'note'), '') else b.note end, auth.uid(), now())
  on conflict (id) do update set
    vehicle_model = excluded.vehicle_model, match_regex = excluded.match_regex, seats = excluded.seats, per_km = excluded.per_km, base_fare = excluded.base_fare,
    min_fare = excluded.min_fare, driver_share_pct = excluded.driver_share_pct, platform_fee_pct = excluded.platform_fee_pct, platform_fee_flat = excluded.platform_fee_flat,
    charter_multiplier = excluded.charter_multiplier, sort_order = excluded.sort_order, active = excluded.active, note = excluded.note, updated_by = auth.uid(), updated_at = now()
  returning * into a;
  if a.driver_share_pct < setting_num('driver_min_share_pct', 80) then
    raise exception 'driver_share_pct % di bawah kebijakan driver_min_share_pct % %% (keputusan GM 8)', a.driver_share_pct, setting_num('driver_min_share_pct', 80);
  end if;
  perform log_activity('travel.rate_card', 'travel_rate_cards', a.id::text,
    format('Rate card travel %s: %s kursi, Rp%s/km, dasar Rp%s, min Rp%s, komisi %s %%, biaya Rp%s, carter ×%s, %s',
           a.vehicle_model, a.seats, a.per_km, a.base_fare, a.min_fare, a.platform_fee_pct, a.platform_fee_flat, a.charter_multiplier, case when a.active then 'aktif' else 'nonaktif' end),
    jsonb_build_object('before', to_jsonb(b), 'after', to_jsonb(a), 'patch', p));
  return to_jsonb(a);
end $$;
revoke all on function public.admin_set_travel_rate_card(jsonb) from public, anon;
grant execute on function public.admin_set_travel_rate_card(jsonb) to authenticated;

create or replace function public.travel_rate_cards_public()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'road_factor', setting_num('travel_road_factor', 1.25),
    'shared_markup_pct', setting_num('travel_shared_markup_pct', 15),
    'tolerance_pct', setting_num('travel_price_tolerance_pct', 10),
    'offer_min_pct', setting_num('travel_offer_min_pct', 90),
    'cards', coalesce((select jsonb_agg(jsonb_build_object('id', rc.id, 'vehicle_model', rc.vehicle_model, 'seats', rc.seats, 'per_km', rc.per_km,
                 'base_fare', rc.base_fare, 'min_fare', rc.min_fare, 'charter_multiplier', rc.charter_multiplier, 'customer_platform_fee', rc.platform_fee_flat)
                 order by rc.sort_order, rc.vehicle_model)
               from travel_rate_cards rc where rc.active), '[]'::jsonb));
$$;
revoke all on function public.travel_rate_cards_public() from public;
grant execute on function public.travel_rate_cards_public() to anon, authenticated;

-- ---------------------------------------------------------------------
-- 11. Kebijakan harga (keputusan 8): pemeriksaan & panel admin
-- ---------------------------------------------------------------------
create or replace function public.pricing_policy_check()
returns setof jsonb language plpgsql stable security definer set search_path = public as $$
declare se service_economics; pr pricing; rc travel_rate_cards; v_min numeric := setting_num('driver_min_share_pct', 80);
        v_share numeric; v_floor numeric; v_net numeric; v_cap numeric := commission_cap_two_wheel();
        v_funded text := coalesce((select value #>> '{}' from app_settings where key = 'promo_default_funded_by'), 'platform');
        v_budget numeric := setting_num('promo_budget_pct_max', 5); v_rev bigint; v_promo bigint; v_month date := date_trunc('month', now())::date;
begin
  if not coalesce(is_admin(), false) then raise exception 'Hanya admin'; end if;
  for se in select * from service_economics order by service loop
    select * into pr from pricing where service = se.service;
    -- porsi driver/mitra dari tarif layanan (travel: mitra travel dikenai merchant_fee_pct)
    v_share := case when se.service = 'travel' then 100 - se.merchant_fee_pct else 100 - se.driver_commission_pct end;
    if v_share < v_min then
      return next jsonb_build_object('service', se.service, 'rule', 'driver_share_min', 'severity', 'violation', 'value', v_share, 'limit', v_min,
        'message', format('Porsi %s %s %% di bawah minimum %s %% (komisi %s %%)', case when se.service = 'travel' then 'mitra travel' else 'driver' end, v_share, v_min,
                          case when se.service = 'travel' then se.merchant_fee_pct else se.driver_commission_pct end));
    end if;
    if se.service::text = any (two_wheel_services()) and se.driver_commission_pct > v_cap then
      return next jsonb_build_object('service', se.service, 'rule', 'two_wheel_cap', 'severity', 'violation', 'value', se.driver_commission_pct, 'limit', v_cap,
        'message', format('Komisi roda dua %s %% melebihi batas regulasi %s %%', se.driver_commission_pct, v_cap));
    end if;
    if se.service <> 'travel' and pr.service is not null then
      v_floor := setting_num('fare_floor_per_km_' || se.service::text, 0);
      v_net := round(pr.per_km * v_share / 100.0);
      if v_floor > 0 and v_net < v_floor then
        return next jsonb_build_object('service', se.service, 'rule', 'fare_floor_per_km', 'severity', 'violation', 'value', v_net, 'limit', v_floor,
          'message', format('Tarif bersih driver Rp%s/km (Rp%s/km × %s %%) di bawah floor Rp%s/km', v_net, pr.per_km, v_share, v_floor));
      end if;
    end if;
    if se.promo_default_funded_by <> v_funded then
      return next jsonb_build_object('service', se.service, 'rule', 'promo_funded_by', 'severity', 'info', 'value', se.promo_default_funded_by, 'limit', v_funded,
        'message', format('Promo %s default ditanggung %s, kebijakan: %s', se.service, se.promo_default_funded_by, v_funded));
    end if;
  end loop;
  -- travel: tiap rate card aktif
  v_floor := setting_num('fare_floor_per_km_travel', 0);
  for rc in select * from travel_rate_cards where active order by sort_order loop
    v_net := round(rc.per_km * (100 - rc.platform_fee_pct) / 100.0);
    if rc.driver_share_pct < v_min or (100 - rc.platform_fee_pct) < v_min then
      return next jsonb_build_object('service', 'travel', 'rule', 'driver_share_min', 'severity', 'violation', 'value', least(rc.driver_share_pct, 100 - rc.platform_fee_pct), 'limit', v_min,
        'message', format('Rate card %s: porsi mitra %s %% di bawah minimum %s %%', rc.vehicle_model, least(rc.driver_share_pct, 100 - rc.platform_fee_pct), v_min), 'rate_card_id', rc.id);
    end if;
    if v_floor > 0 and v_net < v_floor then
      return next jsonb_build_object('service', 'travel', 'rule', 'fare_floor_per_km', 'severity', 'violation', 'value', v_net, 'limit', v_floor,
        'message', format('Rate card %s: bersih mitra Rp%s/km di bawah floor Rp%s/km', rc.vehicle_model, v_net, v_floor), 'rate_card_id', rc.id);
    end if;
  end loop;
  -- promo bulan berjalan vs anggaran (% pendapatan platform) — dari buku besar
  select coalesce(sum(amount) filter (where entry = 'platform_revenue'), 0), coalesce(-sum(amount) filter (where entry = 'promo_platform'), 0)
    into v_rev, v_promo from order_ledger where created_at >= v_month and phase in ('created', 'completed', 'adjusted');
  if v_rev > 0 and v_promo > v_rev * v_budget / 100.0 then
    return next jsonb_build_object('service', '*', 'rule', 'promo_budget', 'severity', 'violation', 'value', round(v_promo * 100.0 / v_rev, 1), 'limit', v_budget,
      'message', format('Promo platform bulan ini Rp%s = %s %% pendapatan platform Rp%s, melampaui anggaran %s %%', v_promo, round(v_promo * 100.0 / v_rev, 1), v_rev, v_budget));
  end if;
  return;
end $$;
comment on function public.pricing_policy_check() is '0124: daftar pelanggaran kebijakan harga (keputusan GM 8): driver_share_min, two_wheel_cap, fare_floor_per_km, promo_funded_by (info), promo_budget. Kosong = patuh.';
revoke all on function public.pricing_policy_check() from public, anon;
grant execute on function public.pricing_policy_check() to authenticated;

create or replace function public.admin_pricing_policy()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_month date := date_trunc('month', now())::date; v_rev bigint; v_promo bigint; r jsonb; v_min numeric := setting_num('driver_min_share_pct', 80);
begin
  perform admin_require('view');
  select coalesce(sum(amount) filter (where entry = 'platform_revenue'), 0), coalesce(-sum(amount) filter (where entry = 'promo_platform'), 0)
    into v_rev, v_promo from order_ledger where created_at >= v_month and phase in ('created', 'completed', 'adjusted');
  select jsonb_build_object(
    'policy', jsonb_build_object('principle', 'Kompetitif, kesejahteraan driver, keberlanjutan aplikasi — tanpa bakar promo (GM 31 Okt 2026)',
      'driver_min_share_pct', v_min, 'promo_budget_pct_max', setting_num('promo_budget_pct_max', 5),
      'promo_default_funded_by', coalesce((select value #>> '{}' from app_settings where key = 'promo_default_funded_by'), 'platform'),
      'two_wheel_commission_cap', commission_cap_two_wheel(),
      'fare_floor_per_km', (select jsonb_object_agg(replace(key, 'fare_floor_per_km_', ''), value) from app_settings where key like 'fare_floor_per_km_%')),
    'services', (select jsonb_agg(jsonb_build_object(
        'service', se.service, 'driver_commission_pct', se.driver_commission_pct, 'merchant_fee_pct', se.merchant_fee_pct, 'customer_platform_fee', se.customer_platform_fee,
        'promo_default_funded_by', se.promo_default_funded_by, 'per_km', pr.per_km, 'min_fare', pr.min_fare, 'base_fare', pr.base_fare,
        'driver_share_pct', case when se.service = 'travel' then 100 - se.merchant_fee_pct else 100 - se.driver_commission_pct end,
        'driver_net_per_km', case when pr.per_km is not null then round(pr.per_km * (100 - se.driver_commission_pct) / 100.0) end,
        'customer_per_km', pr.per_km, 'customer_min_total', case when pr.min_fare is not null then pr.min_fare + se.customer_platform_fee end,
        'fare_floor_per_km', setting_num('fare_floor_per_km_' || se.service::text, 0)) order by se.service)
      from service_economics se left join pricing pr on pr.service = se.service),
    'travel_rate_cards', (select jsonb_agg(jsonb_build_object('id', rc.id, 'vehicle_model', rc.vehicle_model, 'seats', rc.seats, 'per_km', rc.per_km, 'platform_fee_pct', rc.platform_fee_pct,
        'driver_net_per_km', round(rc.per_km * (100 - rc.platform_fee_pct) / 100.0), 'active', rc.active) order by rc.sort_order) from travel_rate_cards rc),
    'promo', jsonb_build_object('month', v_month, 'platform_revenue', v_rev, 'promo_platform_spend', v_promo,
      'spend_pct', case when v_rev > 0 then round(v_promo * 100.0 / v_rev, 1) else null end, 'budget_pct_max', setting_num('promo_budget_pct_max', 5),
      'budget_remaining', greatest(0, round(v_rev * setting_num('promo_budget_pct_max', 5) / 100.0) - v_promo)),
    'market_reference', jsonb_build_object('note', '[ASUMSI 31 Okt 2026, belum diverifikasi lapangan] Pekanbaru: Gojek/Grab motor ±Rp2.500–3.000/km, minimum Rp10–12 rb; mobil ±Rp4.500–6.000/km, minimum Rp15–20 rb',
      'ride_motor_per_km', jsonb_build_array(2500, 3000), 'ride_motor_min', jsonb_build_array(10000, 12000), 'ride_car_per_km', jsonb_build_array(4500, 6000), 'ride_car_min', jsonb_build_array(15000, 20000)),
    'violations', coalesce((select jsonb_agg(x) from pricing_policy_check() x), '[]'::jsonb),
    'ok', not exists (select 1 from pricing_policy_check() x where x->>'severity' = 'violation'),
    'generated_at', now()) into r;
  return r;
end $$;
revoke all on function public.admin_pricing_policy() from public, anon;
grant execute on function public.admin_pricing_policy() to authenticated;

-- ---------------------------------------------------------------------
-- 12. Spesifikasi setelan (Panel Admin › Pengaturan) — jangkar pada baris kode (pola 0117/0118)
-- ---------------------------------------------------------------------
select _v3_splice('0124', 'public.app_setting_specs()',
  $a$    ('voucher_min_nominal',        'int',     1000, 100000000, null, '20000', 'Rp', 'UANG', 'Nominal pembelian AntarVoucher minimum', 'payment_config'),$a$,
  $a$    ('travel_road_factor',         'numeric', 1, 2.5, null, '1.25', '×', 'TRAVEL', '0124: faktor jarak jalan atas jarak bola pusat kota (haversine) untuk quote tanpa rute', 'pricing'),
    ('travel_distance_source',     'text',    null::numeric, null::numeric, array['route_first','haversine'], '"route_first"'::jsonb, '', 'TRAVEL', '0124: sumber km quote — rute aktif dulu, atau selalu haversine×faktor', 'pricing'),
    ('travel_shared_markup_pct',   'numeric', 0, 100, null, '15', '%', 'TRAVEL', '0124: markup harga per kursi = tarif mobil ÷ kursi × (1+markup) [ASUMSI 15]', 'pricing'),
    ('travel_price_tolerance_pct', 'numeric', 0, 50, null, '10', '%', 'TRAVEL', '0124: mitra boleh menyimpang ± dari quote saat buka jadwal', 'pricing'),
    ('travel_offer_min_pct',       'numeric', 50, 100, null, '90', '%', 'TRAVEL', '0124: tawaran carter minimal % dari quote', 'pricing'),
    ('promo_budget_pct_max',       'numeric', 0, 50, null, '5', '%', 'UANG', '0124: anggaran promo platform maks % pendapatan platform bulan berjalan (keputusan GM 8)', 'promo'),
    ('promo_default_funded_by',    'text',    null::numeric, null::numeric, array['platform','merchant','sponsor'], '"platform"'::jsonb, '', 'UANG', '0124: penanggung promo default (kebijakan)', 'promo'),
    ('driver_min_share_pct',       'numeric', 50, 100, null, '80', '%', 'UANG', '0124: porsi minimum driver/mitra dari tarif layanan (keputusan GM 8)', 'pricing'),
    ('fare_floor_per_km_ride_motor','int',    0, 100000, null, '2000', 'Rp/km', 'UANG', '0124: tarif bersih driver minimum per km — ride_motor [ASUMSI]', 'pricing'),
    ('fare_floor_per_km_ride_car', 'int',     0, 100000, null, '3500', 'Rp/km', 'UANG', '0124: floor driver/km — ride_car [ASUMSI]', 'pricing'),
    ('fare_floor_per_km_send',     'int',     0, 100000, null, '2000', 'Rp/km', 'UANG', '0124: floor driver/km — send [ASUMSI]', 'pricing'),
    ('fare_floor_per_km_food',     'int',     0, 100000, null, '2000', 'Rp/km', 'UANG', '0124: floor driver/km — food [ASUMSI]', 'pricing'),
    ('fare_floor_per_km_shop',     'int',     0, 100000, null, '2000', 'Rp/km', 'UANG', '0124: floor driver/km — shop [ASUMSI]', 'pricing'),
    ('fare_floor_per_km_market',   'int',     0, 100000, null, '2000', 'Rp/km', 'UANG', '0124: floor driver/km — market [ASUMSI]', 'pricing'),
    ('fare_floor_per_km_box',      'int',     0, 100000, null, '5000', 'Rp/km', 'UANG', '0124: floor driver/km — box [ASUMSI]', 'pricing'),
    ('fare_floor_per_km_travel',   'int',     0, 100000, null, '3000', 'Rp/km', 'UANG', '0124: floor mitra travel/km per rate card [ASUMSI]', 'pricing'),
    ('voucher_min_nominal',        'int',     1000, 100000000, null, '20000', 'Rp', 'UANG', 'Nominal pembelian AntarVoucher minimum', 'payment_config'),$a$,
  '0124: faktor jarak jalan');

-- ---------------------------------------------------------------------
-- 13. Penjaga
-- ---------------------------------------------------------------------
do $$
declare q jsonb; pku uuid; pdg uuid; d text;
begin
  if to_regclass('public.travel_rate_cards') is null then raise exception '0124 batal: tabel travel_rate_cards belum ada'; end if;
  if (select count(*) from travel_rate_cards where active) < 1 then raise exception '0124 batal: tidak ada rate card aktif'; end if;
  if to_regprocedure('public.travel_quote(uuid,uuid,text,text,integer)') is null or to_regprocedure('public.travel_city_distance_km(uuid,uuid)') is null
     or to_regprocedure('public.admin_set_travel_rate_card(jsonb)') is null or to_regprocedure('public.admin_travel_rate_cards()') is null
     or to_regprocedure('public.travel_rate_cards_public()') is null or to_regprocedure('public.pricing_policy_check()') is null
     or to_regprocedure('public.admin_pricing_policy()') is null then
    raise exception '0124 batal: fungsi belum lengkap';
  end if;
  d := pg_get_functiondef('public.travel_trip_create(jsonb)'::regprocedure);
  if position('travel_trip_prices(tp, r, p)' in d) = 0 then raise exception '0124 batal: travel_trip_create belum tersambung ke quote'; end if;
  d := pg_get_functiondef('public.travel_book(jsonb)'::regprocedure);
  if position('travel_booking_apply_quote(b.id)' in d) = 0 or position('travel_rate_card_for_partner(t.partner_id)' in d) = 0 then raise exception '0124 batal: travel_book belum tersambung'; end if;
  d := pg_get_functiondef('public.travel_offer_create(uuid,bigint,jsonb,text)'::regprocedure);
  if position('travel_offer_quote_guard(r, tp, p_price)' in d) = 0 or position('set quote = v_q124' in d) = 0 then raise exception '0124 batal: travel_offer_create belum tersambung'; end if;
  if not exists (select 1 from app_setting_specs() where key = 'driver_min_share_pct') then raise exception '0124 batal: app_setting_specs belum memuat setelan 0124'; end if;
  select id into pku from cities where name = 'Pekanbaru' and active limit 1;
  select id into pdg from cities where name = 'Padang' and active limit 1;
  if pku is not null and pdg is not null then
    q := travel_quote(pku, pdg, 'Innova Reborn', 'charter', 1);
    if (q->>'fare_total')::bigint <= 0 or (q->>'driver_net')::bigint <= 0 then raise exception '0124 batal: quote Pekanbaru→Padang tidak masuk akal: %', q; end if;
    raise notice '0124 ok: Pekanbaru→Padang % km (%) · Innova carter Rp% · per kursi Rp% · mitra Rp% · rate card aktif %',
      q->>'km', q->>'km_source', q->>'fare_total', q->>'fare_per_seat', q->>'driver_net', (select count(*) from travel_rate_cards where active);
  else
    raise notice '0124 ok: rate card aktif % (kota Pekanbaru/Padang tidak ada untuk uji quote)', (select count(*) from travel_rate_cards where active);
  end if;
end $$;
