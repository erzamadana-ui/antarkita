-- =====================================================================
-- ROLLBACK 0109_iklan_v3_kampanye.sql (psql -1 -f; setelah 0110_down)
-- Memulihkan: create_order(jsonb) (menghapus create_order(jsonb, uuid)), nearby_merchants_v2 (tanpa
-- campaign_id, label 'Iklan'), expire_merchant_ads, merchant_my_ads, admin_set_ad_product.
-- Menghapus: ad_events, ad_budget_ledger, orders.ad_campaign_id, kolom kampanye merchant_ads, kolom v3 ad_products,
-- produk iklan baru (bila tidak dipakai).
-- DATA: kampanye yang sudah ada tetap sebagai baris merchant_ads (status dipetakan ke nilai v2:
--   active→active, pending_review/approved/paused/draft→draft, ended/budget_exhausted→expired, rejected→cancelled);
--   pendapatan iklan di order_ledger (append-only) tetap. Produk iklan baru yang masih dipakai kampanye TIDAK
--   dihapus → CHECK placement/unit v3 dipertahankan (NOTICE).
-- =====================================================================
drop trigger if exists t_orders_ads_conversion on public.orders;
select public._mig_restore('0109');

update public.merchant_ads set status = case status when 'active' then 'active' when 'ended' then 'expired' when 'budget_exhausted' then 'expired'
    when 'rejected' then 'cancelled' when 'pending_review' then 'draft' when 'approved' then 'draft' when 'paused' then 'draft' else status end
 where status not in ('draft','pending_payment','active','expired','cancelled');
alter table public.merchant_ads drop constraint if exists merchant_ads_status_check;
alter table public.merchant_ads add constraint merchant_ads_status_check check (status in ('draft','pending_payment','active','expired','cancelled'));

alter table public.orders drop column if exists ad_campaign_id;
drop table if exists public.ad_budget_ledger;
drop table if exists public.ad_events;

alter table public.merchant_ads drop constraint if exists merchant_ads_paused_by_check;
alter table public.merchant_ads drop constraint if exists merchant_ads_budget_check;
drop index if exists public.merchant_ads_campaign_live_idx;
drop index if exists public.merchant_ads_center_idx;
alter table public.merchant_ads drop column if exists name, drop column if exists budget, drop column if exists spent, drop column if exists radius_km,
  drop column if exists center, drop column if exists category, drop column if exists creative, drop column if exists review_note,
  drop column if exists reviewed_by, drop column if exists reviewed_at, drop column if exists paused_by, drop column if exists impressions,
  drop column if exists clicks, drop column if exists conversions, drop column if exists conversion_value;

delete from public.ad_products p where p.code in ('search_top','banner_home','radius_promo','sponsored_voucher','post_checkout_cross')
  and not exists (select 1 from public.merchant_ads a where a.product_code = p.code);
alter table public.ad_products drop constraint if exists ad_products_pricing_model_check;
alter table public.ad_products drop constraint if exists ad_products_days_check;
do $$
begin
  if exists (select 1 from public.ad_products where placement not in ('featured_home','boost_nearby','banner_category') or unit not in ('per_day','per_week','per_order')) then
    raise notice '0109_down: produk iklan v3 masih dipakai kampanye — CHECK placement/unit v3 dipertahankan';
  else
    alter table public.ad_products drop constraint if exists ad_products_placement_check;
    alter table public.ad_products add constraint ad_products_placement_check check (placement in ('featured_home','boost_nearby','banner_category'));
    alter table public.ad_products drop constraint if exists ad_products_unit_check;
    alter table public.ad_products add constraint ad_products_unit_check check (unit in ('per_day','per_week','per_order'));
  end if;
end $$;
alter table public.ad_products drop column if exists pricing_model, drop column if exists unit_price, drop column if exists unit_pct,
  drop column if exists min_budget, drop column if exists min_days, drop column if exists max_days, drop column if exists requires_approval, drop column if exists label;

do $$
begin
  if to_regclass('_lokal.migrasi') is not null then execute $q$delete from _lokal.migrasi where nama like '0109\_%'$q$; end if;
  if to_regclass('supabase_migrations.schema_migrations') is not null then execute $q$delete from supabase_migrations.schema_migrations where version like '0109%'$q$; end if;
end $$;

do $$
begin
  if to_regprocedure('public.create_order(jsonb)') is null or to_regprocedure('public.create_order(jsonb,uuid)') is not null
     or to_regclass('public.ad_events') is not null or to_regprocedure('public.ads_serve(text,double precision,double precision,text,text,integer)') is not null
     or exists (select 1 from information_schema.columns where table_name = 'merchant_ads' and column_name = 'budget') then
    raise exception '0109_down gagal: objek 0109 masih ada / create_order(jsonb) belum pulih';
  end if;
  if position('0109 atribusi iklan' in pg_get_functiondef('public.create_order(jsonb)'::regprocedure)) > 0 then raise exception '0109_down gagal: create_order masih memuat atribusi iklan'; end if;
  raise notice '0109_down ok';
end $$;
