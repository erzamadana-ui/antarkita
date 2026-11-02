-- Rollback 0124 (satu transaksi: psql -1 -f): pulihkan travel_trip_create / travel_book / travel_offer_create / app_setting_specs dari
-- _mig_backup('0124'), hapus RPC quote/rate card/kebijakan harga, tabel travel_rate_cards, kolom tambahan, setelan.
-- Data booking yang sudah memakai rate card tetap utuh (price/platform_fee/partner_earning adalah kolom lama); hanya kolom memo
-- commission/ppn/price_breakdown dan travel_offers.quote yang hilang. Trip yang harganya dari quote tetap tersimpan apa adanya.
do $$ begin
  if not exists (select 1 from public._migration_backup where version = '0124') then
    raise exception '0124_down ditolak: tidak ada cadangan versi 0124 — 0124 belum diterapkan?';
  end if;
end $$;
select public._mig_restore('0124');
alter table public.travel_partners drop column if exists rate_card_id;
alter table public.travel_bookings drop column if exists commission;
alter table public.travel_bookings drop column if exists ppn;
alter table public.travel_bookings drop column if exists price_breakdown;
alter table public.travel_offers drop column if exists quote;
drop table if exists public.travel_rate_cards;
delete from public.app_settings where key in ('travel_road_factor', 'travel_distance_source', 'travel_shared_markup_pct', 'travel_price_tolerance_pct', 'travel_offer_min_pct',
  'promo_budget_pct_max', 'promo_default_funded_by', 'driver_min_share_pct') or key like 'fare_floor_per_km_%';
do $$ begin
  if to_regprocedure('public.travel_quote(uuid,uuid,text,text,integer)') is not null or to_regclass('public.travel_rate_cards') is not null then
    raise exception '0124_down gagal: objek 0124 masih ada';
  end if;
  if position('travel_trip_prices' in pg_get_functiondef('public.travel_trip_create(jsonb)'::regprocedure)) > 0 then
    raise exception '0124_down gagal: travel_trip_create masih memuat tambalan 0124';
  end if;
  raise notice '0124_down ok';
end $$;
