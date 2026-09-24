-- =====================================================================
-- 0109 — IKLAN v3: KAMPANYE (cpc/cpm/cpa/flat), EVENT, ANGGARAN, LABEL "Sponsored" — Finpay v3
--
-- Sumber: docs/finpay-v3/KONTRAK-API-V3.md §7 (menyempurnakan 0101), §0.2 (iklan = sumber pendapatan
-- platform), §9 v2 (transparansi label). Harga produk seluruhnya [ASUMSI] — admin mengubah lewat
-- admin_set_ad_product (PIN + audit).
--
--   • ad_products + pricing_model/unit_price/min_budget/min_days/max_days/requires_approval/label
--     (+ unit_pct untuk cpa persen). Kolom v2 unit/price TETAP dipakai pembelian paket harian lama
--     (merchant_ad_request) — kampanye v3 memakai pricing_model/unit_price.
--   • merchant_ads menjadi kampanye (budget, spent, radius, center, creative, metrik, status baru).
--   • ad_events (append-only; unique (campaign, user, event, dedupe_key): impresi per hari dibatasi
--     frequency cap, klik per bucket ads_click_dedupe_minutes) & ad_budget_ledger (fund/charge/refund/adjust).
--     Setiap charge → order_ledger (source merchant_ads, entry ads_revenue, fase completed).
--   • merchant_campaign_create/set/campaigns/report, ads_serve (radius PostGIS + frequency cap + anggaran;
--     mencatat impresi), ads_click (dedupe; cpc), ads_conversion (cpa; dipanggil create_order bila
--     p_ad_campaign_id / p.ad_campaign_id), admin_campaigns/review/set, admin_ads_report.
--   • create_order(p jsonb, p_ad_campaign_id uuid default null) — SATU fungsi (bukan overload, supaya
--     rpc('create_order', {p}) lama tidak ambigu); klien lama tetap jalan.
--   • nearby_merchants_v2: ad_label 'Sponsored' (ad_products.label) + campaign_id; urutan tetap v2
--     (bertanda di atas, sisanya jarak) — UI menampilkan blok "Sponsored" terpisah.
--   • expire_merchant_ads: kampanye lewat masa → 'ended' + sisa anggaran dikembalikan; anggaran di bawah
--     biaya berikutnya → 'budget_exhausted'.
-- Semua blok idempoten.
-- =====================================================================

do $$
declare s text;
begin
  foreach s in array array[
    'public.nearby_merchants_v2(double precision,double precision,numeric,text,boolean)', 'public.expire_merchant_ads()',
    'public.merchant_my_ads()', 'public.admin_set_ad_product(text,jsonb)', 'public.create_order(jsonb)', 'public.create_order(jsonb,uuid)',
    'public.ads_next_cost(text,bigint)', 'public.ads_remaining(uuid)', 'public.ads_charge(uuid,bigint,bigint,text)', 'public.ads_refund_remaining(uuid,text)',
    'public.merchant_campaign_create(text,text,bigint,integer,numeric,jsonb,uuid)', 'public.merchant_campaign_set(uuid,text,bigint)',
    'public.merchant_campaigns()', 'public.merchant_campaign_report(uuid,date,date)',
    'public.ads_serve(text,double precision,double precision,text,text,integer)', 'public.ads_click(uuid,text)', 'public.ads_conversion(uuid,uuid)',
    'public.admin_campaigns(text)', 'public.admin_campaign_review(uuid,boolean,text)', 'public.admin_campaign_set(uuid,text)',
    'public.admin_ads_report(date,date)', 'public.ads_activate(uuid)'] loop
    perform _mig_backup('0109', s);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 1. Skema
-- ---------------------------------------------------------------------
alter table public.ad_products add column if not exists pricing_model text not null default 'flat';
alter table public.ad_products add column if not exists unit_price bigint;
alter table public.ad_products add column if not exists unit_pct numeric(5,2);
alter table public.ad_products add column if not exists min_budget bigint not null default 50000;
alter table public.ad_products add column if not exists min_days int not null default 1;
alter table public.ad_products add column if not exists max_days int not null default 30;
alter table public.ad_products add column if not exists requires_approval boolean not null default true;
alter table public.ad_products add column if not exists label text not null default 'Sponsored';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ad_products_pricing_model_check') then
    alter table public.ad_products add constraint ad_products_pricing_model_check check (pricing_model in ('flat','cpc','cpm','cpa'));
  end if;
  if exists (select 1 from pg_constraint where conname = 'ad_products_placement_check' and pg_get_constraintdef(oid) not like '%search_top%') then
    alter table public.ad_products drop constraint ad_products_placement_check;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ad_products_placement_check') then
    alter table public.ad_products add constraint ad_products_placement_check check (placement in
      ('featured_home','boost_nearby','banner_category','search_top','banner_home','radius_promo','sponsored_voucher','post_checkout_cross'));
  end if;
  if exists (select 1 from pg_constraint where conname = 'ad_products_unit_check' and pg_get_constraintdef(oid) not like '%per_click%') then
    alter table public.ad_products drop constraint ad_products_unit_check;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ad_products_unit_check') then
    alter table public.ad_products add constraint ad_products_unit_check check (unit in ('per_day','per_week','per_order','per_click','per_mille'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ad_products_days_check') then
    alter table public.ad_products add constraint ad_products_days_check check (min_days >= 1 and max_days >= min_days and max_days <= 366);
  end if;
end $$;
comment on column public.ad_products.pricing_model is 'Finpay v3 §7: flat (unit_price per hari/minggu, ditagih saat aktif) | cpc (per klik) | cpm (per 1000 impresi) | cpa (per konversi: unit_pct % nilai barang, atau unit_price).';
comment on column public.ad_products.unit_pct is 'cpa: persen dari nilai barang pesanan yang ditagihkan per konversi (mis. 5). NULL = pakai unit_price.';

-- nilai [ASUMSI] kontrak §7 — hanya mengisi kolom baru yang masih kosong (tidak menimpa ubahan admin)
update public.ad_products set pricing_model = 'flat', unit_price = 25000, min_budget = 25000, min_days = 1, max_days = 30 where code = 'featured_home' and unit_price is null;
update public.ad_products set pricing_model = 'cpc',  unit_price = 500,   min_budget = 50000, min_days = 1, max_days = 30 where code = 'boost_nearby' and unit_price is null;
update public.ad_products set pricing_model = 'flat', unit_price = 50000, min_budget = 50000, min_days = 7, max_days = 91 where code = 'banner_category' and unit_price is null;
insert into public.ad_products (code, name, description, unit, price, placement, pricing_model, unit_price, unit_pct, min_budget, min_days, max_days) values
  ('search_top',          'Teratas Pencarian',     '[ASUMSI] Rp700/klik, min Rp50.000 — hasil teratas pencarian merchant dengan label Sponsored', 'per_click', 700,   'search_top',          'cpc', 700,   null, 50000,  1, 30),
  ('banner_home',         'Banner Beranda',        '[ASUMSI] Rp15.000 per 1.000 impresi, min Rp100.000',                                            'per_mille', 15000, 'banner_home',         'cpm', 15000, null, 100000, 1, 30),
  ('radius_promo',        'Promo Radius',          '[ASUMSI] Rp10.000 per 1.000 impresi, min Rp50.000 — tampil ke pelanggan dalam radius merchant',  'per_mille', 10000, 'radius_promo',        'cpm', 10000, null, 50000,  1, 30),
  ('sponsored_voucher',   'Voucher Bersponsor',    '[ASUMSI] 5 % dari nilai pesanan per konversi, min Rp100.000',                                   'per_order', 0,     'sponsored_voucher',   'cpa', 0,     5,    100000, 1, 30),
  ('post_checkout_cross', 'Rekomendasi Sesudah Checkout', '[ASUMSI] Rp400/klik — rekomendasi merchant lain sesudah checkout',                        'per_click', 400,   'post_checkout_cross', 'cpc', 400,   null, 50000,  1, 30)
on conflict (code) do nothing;
update public.ad_products set unit_price = price where unit_price is null;

alter table public.merchant_ads add column if not exists name text;
alter table public.merchant_ads add column if not exists budget bigint;
alter table public.merchant_ads add column if not exists spent bigint not null default 0;
alter table public.merchant_ads add column if not exists radius_km numeric(6,2);
alter table public.merchant_ads add column if not exists center geography(point, 4326);
alter table public.merchant_ads add column if not exists category text;
alter table public.merchant_ads add column if not exists creative jsonb not null default '{}'::jsonb;
alter table public.merchant_ads add column if not exists review_note text;
alter table public.merchant_ads add column if not exists reviewed_by uuid;
alter table public.merchant_ads add column if not exists reviewed_at timestamptz;
alter table public.merchant_ads add column if not exists paused_by text;
alter table public.merchant_ads add column if not exists impressions int not null default 0;
alter table public.merchant_ads add column if not exists clicks int not null default 0;
alter table public.merchant_ads add column if not exists conversions int not null default 0;
alter table public.merchant_ads add column if not exists conversion_value bigint not null default 0;
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'merchant_ads_status_check' and pg_get_constraintdef(oid) not like '%budget_exhausted%') then
    alter table public.merchant_ads drop constraint merchant_ads_status_check;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'merchant_ads_status_check') then
    alter table public.merchant_ads add constraint merchant_ads_status_check check (status in
      ('draft','pending_payment','pending_review','approved','rejected','active','paused','ended','budget_exhausted','cancelled','expired'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'merchant_ads_paused_by_check') then
    alter table public.merchant_ads add constraint merchant_ads_paused_by_check check (paused_by is null or paused_by in ('merchant','admin','system'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'merchant_ads_budget_check') then
    alter table public.merchant_ads add constraint merchant_ads_budget_check check (budget is null or (budget >= 0 and spent >= 0 and spent <= budget));
  end if;
end $$;
create index if not exists merchant_ads_campaign_live_idx on public.merchant_ads (status, ends_at) where budget is not null;
create index if not exists merchant_ads_center_idx on public.merchant_ads using gist (center) where center is not null;
comment on column public.merchant_ads.budget is 'Finpay v3 §7: anggaran kampanye (NULL = paket harian v2). Dana ditahan dari saldo merchant saat dibuat (closed-loop). spent = Σ charge.';

create table if not exists public.ad_events (
  id          bigserial primary key,
  campaign_id uuid not null references public.merchant_ads(id),
  user_id     uuid references public.profiles(id),
  event       text not null check (event in ('impression','click','conversion')),
  placement   text,
  order_id    uuid references public.orders(id),
  cost        bigint not null default 0 check (cost >= 0),
  billable    boolean not null default false,
  dedupe_key  text not null,
  created_at  timestamptz not null default now(),
  unique (campaign_id, user_id, event, dedupe_key)
);
create index if not exists ad_events_campaign_idx on public.ad_events (campaign_id, event, created_at);
comment on table public.ad_events is 'Finpay v3 §7 (append-only): impresi (dedupe_key imp:YYYY-MM-DD:k, k ≤ frequency cap), klik (clk:<bucket menit>; duplikat dicatat dup:… tidak ditagih), konversi (order:<id>).';

create table if not exists public.ad_budget_ledger (
  id          bigserial primary key,
  campaign_id uuid not null references public.merchant_ads(id),
  amount      bigint not null,
  kind        text not null check (kind in ('fund','charge','refund','adjust')),
  ref         bigint references public.ad_events(id),
  note        text,
  created_at  timestamptz not null default now()
);
create index if not exists ad_budget_ledger_campaign_idx on public.ad_budget_ledger (campaign_id, created_at);
comment on table public.ad_budget_ledger is 'Finpay v3 §7 (append-only): fund +anggaran/topup, charge −biaya (ref ad_events), refund +sisa anggaran yang dikembalikan ke saldo merchant (nilai positif = dana keluar dari kampanye ke merchant), adjust ±. spent = −Σ charge; sisa = budget − spent − Σ refund.';

do $$
declare t text;
begin
  foreach t in array array['ad_events', 'ad_budget_ledger'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('drop trigger if exists t_%s_append_only on public.%I', t, t);
    execute format('create trigger t_%s_append_only before update or delete on public.%I for each row execute function ledger_append_only()', t, t);
  end loop;
end $$;
drop policy if exists ad_events_read on public.ad_events;
create policy ad_events_read on public.ad_events for select to authenticated
  using (is_admin() or exists (select 1 from merchant_ads a where a.id = campaign_id and owns_merchant(a.merchant_id)));
drop policy if exists ad_budget_ledger_read on public.ad_budget_ledger;
create policy ad_budget_ledger_read on public.ad_budget_ledger for select to authenticated
  using (is_admin() or exists (select 1 from merchant_ads a where a.id = campaign_id and owns_merchant(a.merchant_id)));
grant select on public.ad_events, public.ad_budget_ledger to authenticated;
revoke all on sequence public.ad_events_id_seq, public.ad_budget_ledger_id_seq from public, anon, authenticated;

alter table public.orders add column if not exists ad_campaign_id uuid references public.merchant_ads(id);
create index if not exists orders_ad_campaign_idx on public.orders (ad_campaign_id) where ad_campaign_id is not null;

-- ---------------------------------------------------------------------
-- 2. Inti anggaran
-- ---------------------------------------------------------------------
create or replace function public.ads_next_cost(p_model text, p_unit bigint)
returns bigint language sql immutable set search_path = public as $$
  select case p_model when 'cpc' then greatest(1, coalesce(p_unit, 0)) when 'cpm' then greatest(1, ceil(coalesce(p_unit, 0) / 1000.0)::bigint)
                      when 'cpa' then 1 else 0 end;
$$;
create or replace function public.ads_remaining(p_campaign uuid)
returns bigint language sql stable security definer set search_path = public as $$
  select coalesce(a.budget, 0) - coalesce(a.spent, 0) - coalesce((select sum(l.amount) from ad_budget_ledger l where l.campaign_id = a.id and l.kind = 'refund'), 0)
  from merchant_ads a where a.id = p_campaign;
$$;
revoke all on function public.ads_next_cost(text, bigint) from public, anon;
grant execute on function public.ads_next_cost(text, bigint) to authenticated, service_role;
revoke all on function public.ads_remaining(uuid) from public, anon, authenticated;

-- Tagih kampanye (internal). Biaya > sisa → tidak ditagih, status budget_exhausted. Mengembalikan biaya yang ditagih.
create or replace function public.ads_charge(p_campaign uuid, p_cost bigint, p_event bigint, p_note text)
returns bigint language plpgsql security definer set search_path = public as $$
declare a merchant_ads; pr ad_products; m merchants; v_rem bigint; v_city uuid; v_city_name text;
begin
  if coalesce(p_cost, 0) <= 0 then return 0; end if;
  select * into a from merchant_ads where id = p_campaign for update;
  select * into pr from ad_products where code = a.product_code;
  v_rem := ads_remaining(a.id);
  if p_cost > v_rem then
    update merchant_ads set status = 'budget_exhausted', paused_by = 'system' where id = a.id and status = 'active';
    return 0;
  end if;
  update merchant_ads set spent = spent + p_cost, price_paid = spent + p_cost, activated_at = coalesce(activated_at, now()) where id = a.id returning * into a;
  insert into ad_budget_ledger (campaign_id, amount, kind, ref, note) values (a.id, -p_cost, 'charge', p_event, p_note);
  select * into m from merchants where id = a.merchant_id;
  if m.lat is not null then v_city := nearest_city(m.lat, m.lng); end if;
  select name into v_city_name from cities where id = v_city;
  insert into order_ledger (source, source_id, service, city_id, city, entry, amount, party_role, party_id, phase, note)
  values ('merchant_ads', a.id, 'food', v_city, coalesce(v_city_name, m.address), 'ads_revenue', p_cost, 'merchant', m.owner_id, 'completed',
          coalesce(pr.name, a.product_code) || ' · ' || coalesce(a.name, m.name) || ' · ' || coalesce(p_note, pr.pricing_model));
  if a.status = 'active' and ads_remaining(a.id) < ads_next_cost(pr.pricing_model, pr.unit_price) and pr.pricing_model <> 'flat' then
    update merchant_ads set status = 'budget_exhausted', paused_by = 'system' where id = a.id;
  end if;
  return p_cost;
end $$;
revoke all on function public.ads_charge(uuid, bigint, bigint, text) from public, anon, authenticated;

-- Kembalikan sisa anggaran ke saldo merchant (internal)
create or replace function public.ads_refund_remaining(p_campaign uuid, p_note text)
returns bigint language plpgsql security definer set search_path = public as $$
declare a merchant_ads; m merchants; v_rem bigint;
begin
  select * into a from merchant_ads where id = p_campaign for update;
  if a.budget is null then return 0; end if;
  v_rem := ads_remaining(a.id);
  if v_rem <= 0 then return 0; end if;
  select * into m from merchants where id = a.merchant_id;
  perform wallet_apply(m.owner_id, 'refund', v_rem, null, 'Sisa anggaran iklan ' || coalesce(a.name, a.product_code) || ' — ' || coalesce(p_note, 'dikembalikan'), 'ADR-' || a.id::text);
  insert into ad_budget_ledger (campaign_id, amount, kind, note) values (a.id, v_rem, 'refund', coalesce(p_note, 'sisa anggaran dikembalikan ke saldo merchant'));
  return v_rem;
end $$;
revoke all on function public.ads_refund_remaining(uuid, text) from public, anon, authenticated;

-- Aktifkan kampanye (disetujui / tanpa review): periode mulai sekarang; flat ditagih penuh saat aktif
create or replace function public.ads_activate(p_campaign uuid)
returns merchant_ads language plpgsql security definer set search_path = public as $$
declare a merchant_ads; pr ad_products; v_days int; v_flat bigint;
begin
  select * into a from merchant_ads where id = p_campaign for update;
  select * into pr from ad_products where code = a.product_code;
  v_days := greatest(1, ceil(extract(epoch from (a.ends_at - a.starts_at)) / 86400.0)::int);
  update merchant_ads set status = 'active', starts_at = now(), ends_at = now() + make_interval(days => v_days), activated_at = coalesce(activated_at, now()), paused_by = null
   where id = a.id returning * into a;
  if pr.pricing_model = 'flat' and not exists (select 1 from ad_budget_ledger where campaign_id = a.id and kind = 'charge') then
    v_flat := least(a.budget, (ad_price(pr.code, v_days)->>'price')::bigint);
    perform ads_charge(a.id, v_flat, null, 'flat ' || v_days || ' hari');
    select * into a from merchant_ads where id = a.id;
  end if;
  return a;
end $$;
revoke all on function public.ads_activate(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. RPC merchant
-- ---------------------------------------------------------------------
create or replace function public.merchant_campaign_create(p_product text, p_name text, p_budget bigint, p_days int, p_radius_km numeric,
  p_creative jsonb, p_merchant_id uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); m merchants; pr ad_products; n int; v_bal bigint; a merchant_ads; v_flat bigint; v_radius numeric := coalesce(p_radius_km, 5);
  v_head text := btrim(coalesce(p_creative->>'headline', ''));
begin
  if v_uid is null then raise exception 'Harus login'; end if;
  if p_merchant_id is not null then select * into m from merchants where id = p_merchant_id and owner_id = v_uid;
  else
    select count(*) into n from merchants where owner_id = v_uid;
    if n > 1 then raise exception 'Anda memiliki % merchant — pilih merchant yang diiklankan', n; end if;
    select * into m from merchants where owner_id = v_uid;
  end if;
  if m.id is null then raise exception 'Hanya pemilik merchant yang bisa membuat kampanye iklan'; end if;
  if m.status <> 'approved' then raise exception 'Merchant belum disetujui admin'; end if;
  select * into pr from ad_products where code = lower(trim(coalesce(p_product, '')));
  if not found or not pr.active then raise exception 'Produk iklan % tidak tersedia', coalesce(p_product, '-'); end if;
  if p_days is null or p_days < pr.min_days or p_days > pr.max_days then raise exception 'Durasi % harus % – % hari', pr.name, pr.min_days, pr.max_days; end if;
  if p_budget is null or p_budget < pr.min_budget then raise exception 'Anggaran minimal Rp% untuk %', pr.min_budget, pr.name; end if;
  if p_budget > 100000000 then raise exception 'Anggaran maksimal Rp100.000.000'; end if;
  if pr.pricing_model = 'flat' then
    v_flat := (ad_price(pr.code, p_days)->>'price')::bigint;
    if p_budget < v_flat then raise exception 'Anggaran % hari % minimal Rp%', p_days, pr.name, v_flat; end if;
  end if;
  if v_radius < 0.5 or v_radius > 50 then raise exception 'Radius 0,5 – 50 km'; end if;
  if p_creative is not null and jsonb_typeof(p_creative) <> 'object' then raise exception 'creative harus objek {headline, image_url, cta}'; end if;
  if length(v_head) < 3 or length(v_head) > 80 then raise exception 'Judul iklan (headline) 3–80 karakter'; end if;
  if m.location is null then raise exception 'Lokasi merchant belum diatur — radius iklan tidak bisa dihitung'; end if;
  select balance into v_bal from wallets where user_id = v_uid for update;
  if coalesce(v_bal, 0) < p_budget then
    raise exception 'Saldo pendapatan tidak cukup: perlu Rp%, saldo Rp%', to_char(p_budget, 'FM999G999G999'), to_char(coalesce(v_bal, 0), 'FM999G999G999');
  end if;
  insert into merchant_ads (merchant_id, product_code, starts_at, ends_at, price_paid, status, paid_via, created_by, note,
    name, budget, spent, radius_km, center, category, creative)
  values (m.id, pr.code, now(), now() + make_interval(days => p_days), 0, case when pr.requires_approval then 'pending_review' else 'approved' end,
    'campaign', v_uid, 'kampanye v3 ' || pr.pricing_model, coalesce(nullif(btrim(p_name), ''), pr.name || ' · ' || m.name), p_budget, 0, v_radius,
    m.location, m.category, jsonb_build_object('headline', v_head, 'image_url', nullif(btrim(coalesce(p_creative->>'image_url', '')), ''),
      'cta', coalesce(nullif(btrim(coalesce(p_creative->>'cta', '')), ''), 'Pesan sekarang')))
  returning * into a;
  -- dana ditahan dari saldo merchant (closed-loop, tidak ada uang masuk dari luar)
  perform wallet_apply(v_uid, 'payment', -p_budget, null, 'Dana kampanye iklan ' || a.name, 'ADC-' || a.id::text);
  insert into ad_budget_ledger (campaign_id, amount, kind, note) values (a.id, p_budget, 'fund', 'dana awal kampanye');
  if not pr.requires_approval then a := ads_activate(a.id); end if;
  perform log_activity('ads.campaign_created', 'merchant_ads', a.id::text,
    'Kampanye ' || a.name || ' (' || pr.pricing_model || ', Rp' || p_budget || ', ' || p_days || ' hari) → ' || a.status,
    jsonb_build_object('after', to_jsonb(a) - 'center'));
  return a.id;
end $$;
revoke all on function public.merchant_campaign_create(text, text, bigint, int, numeric, jsonb, uuid) from public, anon;
grant execute on function public.merchant_campaign_create(text, text, bigint, int, numeric, jsonb, uuid) to authenticated;

create or replace function public.merchant_campaign_set(p_id uuid, p_action text, p_amount bigint default null)
returns merchant_ads language plpgsql security definer set search_path = public as $$
declare a merchant_ads; b merchant_ads; pr ad_products; v_act text := lower(trim(coalesce(p_action, ''))); v_bal bigint; v_ref bigint := 0; v_owner uuid;
begin
  if auth.uid() is null then raise exception 'Harus login'; end if;
  select * into b from merchant_ads where id = p_id for update;
  if not found or b.budget is null or not owns_merchant(b.merchant_id) then raise exception 'Kampanye tidak ditemukan'; end if;
  select * into pr from ad_products where code = b.product_code;
  select owner_id into v_owner from merchants where id = b.merchant_id;
  a := b;
  if v_act = 'pause' then
    if b.status <> 'active' then raise exception 'Hanya kampanye aktif yang bisa dijeda (status %)', b.status; end if;
    update merchant_ads set status = 'paused', paused_by = 'merchant' where id = b.id returning * into a;
  elsif v_act = 'resume' then
    if b.status <> 'paused' then raise exception 'Kampanye tidak sedang dijeda (status %)', b.status; end if;
    if b.paused_by = 'admin' then raise exception 'Kampanye dijeda admin — hubungi CS'; end if;
    if b.ends_at <= now() then raise exception 'Periode kampanye sudah berakhir'; end if;
    if ads_remaining(b.id) < ads_next_cost(pr.pricing_model, pr.unit_price) then raise exception 'Anggaran habis — tambah anggaran (topup) dulu'; end if;
    update merchant_ads set status = 'active', paused_by = null where id = b.id returning * into a;
  elsif v_act = 'topup' then
    if p_amount is null or p_amount < 10000 then raise exception 'Tambah anggaran minimal Rp10.000'; end if;
    if b.status not in ('pending_review','approved','active','paused','budget_exhausted') then raise exception 'Kampanye % tidak bisa ditambah anggarannya', b.status; end if;
    select balance into v_bal from wallets where user_id = v_owner for update;
    if coalesce(v_bal, 0) < p_amount then raise exception 'Saldo pendapatan tidak cukup: perlu Rp%', p_amount; end if;
    perform wallet_apply(v_owner, 'payment', -p_amount, null, 'Tambah anggaran iklan ' || b.name, 'ADC-' || b.id::text);
    insert into ad_budget_ledger (campaign_id, amount, kind, note) values (b.id, p_amount, 'fund', 'tambah anggaran');
    update merchant_ads set budget = budget + p_amount,
      status = case when status = 'budget_exhausted' and ends_at > now() then 'active' else status end,
      paused_by = case when status = 'budget_exhausted' then null else paused_by end
     where id = b.id returning * into a;
  elsif v_act = 'stop' then
    if b.status in ('ended','cancelled','rejected','expired') then raise exception 'Kampanye sudah %', b.status; end if;
    update merchant_ads set status = case when b.activated_at is null then 'cancelled' else 'ended' end, paused_by = 'merchant',
      ends_at = case when b.activated_at is not null and ends_at > now() then greatest(now(), starts_at + interval '1 second') else ends_at end
     where id = b.id returning * into a;
    v_ref := ads_refund_remaining(b.id, 'dihentikan merchant');
  else
    raise exception 'Aksi harus pause|resume|stop|topup';
  end if;
  perform log_activity('ads.campaign_' || v_act, 'merchant_ads', a.id::text, 'Kampanye ' || a.name || ': ' || b.status || ' → ' || a.status
      || case when v_ref > 0 then ' (sisa Rp' || v_ref || ' dikembalikan)' else '' end || case when v_act = 'topup' then ' (+Rp' || p_amount || ')' else '' end,
    jsonb_build_object('before', to_jsonb(b) - 'center', 'after', to_jsonb(a) - 'center', 'refund', v_ref));
  return a;
end $$;
revoke all on function public.merchant_campaign_set(uuid, text, bigint) from public, anon;
grant execute on function public.merchant_campaign_set(uuid, text, bigint) to authenticated;

create or replace function public.merchant_campaigns()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'product', a.product_code, 'product_name', pr.name, 'pricing_model', pr.pricing_model,
      'unit_price', pr.unit_price, 'status', a.status, 'paused_by', a.paused_by, 'review_note', a.review_note, 'starts_at', a.starts_at, 'ends_at', a.ends_at,
      'budget', a.budget, 'spent', a.spent, 'remaining', ads_remaining(a.id), 'radius_km', a.radius_km, 'creative', a.creative, 'label', pr.label,
      'impressions', a.impressions, 'clicks', a.clicks, 'ctr', case when a.impressions > 0 then round(100.0 * a.clicks / a.impressions, 2) else 0 end,
      'conversions', a.conversions, 'conversion_value', a.conversion_value,
      'roas', case when a.spent > 0 then round(a.conversion_value::numeric / a.spent, 2) end, 'merchant_id', a.merchant_id, 'merchant', m.name)
    order by a.created_at desc), '[]'::jsonb)
  from merchant_ads a join merchants m on m.id = a.merchant_id join ad_products pr on pr.code = a.product_code
  where m.owner_id = auth.uid() and a.budget is not null;
$$;
revoke all on function public.merchant_campaigns() from public, anon;
grant execute on function public.merchant_campaigns() to authenticated;

create or replace function public.merchant_campaign_report(p_id uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare a merchant_ads; v_from date := coalesce(p_from, (now() at time zone 'Asia/Jakarta')::date - 29); v_to date := coalesce(p_to, (now() at time zone 'Asia/Jakarta')::date);
begin
  select * into a from merchant_ads where id = p_id;
  if not found or a.budget is null or not (coalesce(owns_merchant(a.merchant_id), false) or coalesce(admin_has('ads'), false) or coalesce(admin_has('report'), false)) then
    raise exception 'Kampanye tidak ditemukan';
  end if;
  if v_to < v_from or v_to - v_from > 366 then raise exception 'Rentang tanggal tidak valid (maks 366 hari)'; end if;
  return jsonb_build_object('campaign_id', a.id, 'name', a.name, 'from', v_from, 'to', v_to,
    'days', (select coalesce(jsonb_agg(jsonb_build_object('day', g.d::date,
        'impressions', coalesce(e.imp, 0), 'clicks', coalesce(e.clk, 0), 'billable_clicks', coalesce(e.bclk, 0),
        'ctr', case when coalesce(e.imp, 0) > 0 then round(100.0 * coalesce(e.clk, 0) / e.imp, 2) else 0 end,
        'conversions', coalesce(e.conv, 0), 'conversion_value', coalesce(e.cval, 0), 'spent', coalesce(s.spent, 0),
        'roas', case when coalesce(s.spent, 0) > 0 then round(coalesce(e.cval, 0)::numeric / s.spent, 2) end) order by g.d), '[]'::jsonb)
      from generate_series(v_from, v_to, interval '1 day') g(d)
      left join (select (x.created_at at time zone 'Asia/Jakarta')::date dd, count(*) filter (where x.event = 'impression') imp,
                   count(*) filter (where x.event = 'click') clk, count(*) filter (where x.event = 'click' and x.billable) bclk,
                   count(*) filter (where x.event = 'conversion') conv,
                   coalesce(sum(o.items_subtotal) filter (where x.event = 'conversion'), 0) cval
                 from ad_events x left join orders o on o.id = x.order_id where x.campaign_id = a.id group by 1) e on e.dd = g.d::date
      left join (select (l.created_at at time zone 'Asia/Jakarta')::date dd, -sum(l.amount) spent from ad_budget_ledger l
                 where l.campaign_id = a.id and l.kind = 'charge' group by 1) s on s.dd = g.d::date),
    'totals', (select jsonb_build_object('spent', coalesce(-sum(amount) filter (where kind = 'charge'), 0), 'funded', coalesce(sum(amount) filter (where kind = 'fund'), 0),
        'refunded', coalesce(sum(amount) filter (where kind = 'refund'), 0)) from ad_budget_ledger where campaign_id = a.id),
    'conversion_value', a.conversion_value, 'roas', case when a.spent > 0 then round(a.conversion_value::numeric / a.spent, 2) end);
end $$;
revoke all on function public.merchant_campaign_report(uuid, date, date) from public, anon;
grant execute on function public.merchant_campaign_report(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------
-- 4. RPC pelanggan: tayang, klik, konversi
-- ---------------------------------------------------------------------
create or replace function public.ads_serve(p_placement text, p_lat double precision, p_lng double precision, p_category text default null,
  p_q text default null, p_limit int default 3)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_cap int := greatest(1, setting_num('ads_frequency_cap_per_day', 5)::int); v_day text := to_char(now() at time zone 'Asia/Jakarta', 'YYYY-MM-DD');
  c record; v_seen int; v_ev bigint; v_n bigint; v_cost bigint; res jsonb := '[]'::jsonb; v_lim int := least(10, greatest(1, coalesce(p_limit, 3)));
  v_pt geography := st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography; v_bill boolean;
begin
  if p_lat is null or p_lng is null then raise exception 'Lokasi wajib diisi'; end if;
  for c in
    select a.id, a.merchant_id, m.name as merchant, a.creative, pr.label, pr.pricing_model, pr.unit_price, pr.placement,
           round((st_distance(a.center, v_pt) / 1000.0)::numeric, 2) as distance_km
      from merchant_ads a join ad_products pr on pr.code = a.product_code join merchants m on m.id = a.merchant_id
     where a.budget is not null and a.status = 'active' and now() >= a.starts_at and now() < a.ends_at
       and pr.placement = lower(trim(coalesce(p_placement, ''))) and m.status = 'approved'
       and a.center is not null and st_dwithin(a.center, v_pt, coalesce(a.radius_km, 5) * 1000)
       and ads_remaining(a.id) >= ads_next_cost(pr.pricing_model, pr.unit_price)
       and (p_category is null or p_category = '' or m.category ilike p_category or a.category ilike p_category)
       and (p_q is null or p_q = '' or m.name ilike '%' || p_q || '%' or m.category ilike '%' || p_q || '%')
     order by st_distance(a.center, v_pt), a.created_at
  loop
    exit when jsonb_array_length(res) >= v_lim;
    v_bill := false; v_cost := 0;
    if v_uid is not null then
      -- frequency cap: maks v_cap impresi per pengguna per kampanye per hari (WIB)
      select count(*) into v_seen from ad_events where campaign_id = c.id and user_id = v_uid and event = 'impression' and dedupe_key like 'imp:' || v_day || ':%';
      continue when v_seen >= v_cap;
      v_bill := c.pricing_model = 'cpm';
      insert into ad_events (campaign_id, user_id, event, placement, billable, dedupe_key)
      values (c.id, v_uid, 'impression', c.placement, v_bill, 'imp:' || v_day || ':' || (v_seen + 1))
      on conflict do nothing returning id into v_ev;
      continue when v_ev is null;
    else
      insert into ad_events (campaign_id, user_id, event, placement, billable, dedupe_key)
      values (c.id, null, 'impression', c.placement, false, 'anon:' || gen_random_uuid()) returning id into v_ev;   -- anonim: tidak ditagih
    end if;
    update merchant_ads set impressions = impressions + 1 where id = c.id;
    if v_bill then
      select count(*) into v_n from ad_events where campaign_id = c.id and event = 'impression' and billable;
      v_cost := floor(v_n * c.unit_price / 1000.0)::bigint - floor((v_n - 1) * c.unit_price / 1000.0)::bigint;   -- per 1.000 impresi, dibulatkan kumulatif
      perform ads_charge(c.id, v_cost, v_ev, 'cpm impresi #' || v_n);
    end if;
    res := res || jsonb_build_object('campaign_id', c.id, 'merchant_id', c.merchant_id, 'merchant', c.merchant,
      'headline', c.creative->>'headline', 'image_url', c.creative->>'image_url', 'cta', c.creative->>'cta',
      'label', coalesce(c.label, 'Sponsored'), 'distance_km', c.distance_km, 'placement', c.placement);
  end loop;
  return res;
end $$;
revoke all on function public.ads_serve(text, double precision, double precision, text, text, int) from public;
grant execute on function public.ads_serve(text, double precision, double precision, text, text, int) to anon, authenticated;
comment on function public.ads_serve(text, double precision, double precision, text, text, int) is
  'Finpay v3 §7: iklan aktif untuk penempatan, dalam radius kampanye (PostGIS), anggaran ≥ biaya berikutnya, frequency cap per pengguna per hari; MENCATAT impresi (cpm ditagih, anonim tidak ditagih). Hasil wajib ditampilkan dengan label (Sponsored).';

create or replace function public.ads_click(p_campaign_id uuid, p_placement text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); a merchant_ads; pr ad_products; v_bucket bigint; v_ev bigint; v_cost bigint := 0;
  v_min int := greatest(1, setting_num('ads_click_dedupe_minutes', 30)::int);
begin
  select * into a from merchant_ads where id = p_campaign_id;
  if not found or a.budget is null then raise exception 'Iklan tidak ditemukan'; end if;
  select * into pr from ad_products where code = a.product_code;
  if v_uid is null then
    insert into ad_events (campaign_id, user_id, event, placement, billable, dedupe_key) values (a.id, null, 'click', p_placement, false, 'anon:' || gen_random_uuid());
    update merchant_ads set clicks = clicks + 1 where id = a.id;
    return jsonb_build_object('charged', false, 'reason', 'anonymous');
  end if;
  if a.status <> 'active' or now() < a.starts_at or now() >= a.ends_at then
    insert into ad_events (campaign_id, user_id, event, placement, billable, dedupe_key) values (a.id, v_uid, 'click', p_placement, false, 'inactive:' || gen_random_uuid());
    return jsonb_build_object('charged', false, 'reason', 'inactive', 'status', a.status);
  end if;
  v_bucket := floor(extract(epoch from now()) / (v_min * 60))::bigint;
  if exists (select 1 from ad_events where campaign_id = a.id and user_id = v_uid and event = 'click' and dedupe_key = 'clk:' || v_bucket) then
    -- klik berulang dalam jendela dedupe: dicatat (laporan fraud) tetapi TIDAK ditagih
    insert into ad_events (campaign_id, user_id, event, placement, billable, dedupe_key) values (a.id, v_uid, 'click', p_placement, false, 'dup:' || gen_random_uuid());
    update merchant_ads set clicks = clicks + 1 where id = a.id;
    return jsonb_build_object('charged', false, 'reason', 'dedupe');
  end if;
  if pr.pricing_model = 'cpc' then
    v_cost := greatest(1, coalesce(pr.unit_price, 0));
    if ads_remaining(a.id) < v_cost then
      update merchant_ads set status = 'budget_exhausted', paused_by = 'system' where id = a.id and status = 'active';
      insert into ad_events (campaign_id, user_id, event, placement, billable, dedupe_key) values (a.id, v_uid, 'click', p_placement, false, 'nobudget:' || gen_random_uuid());
      return jsonb_build_object('charged', false, 'reason', 'budget_exhausted');
    end if;
  end if;
  insert into ad_events (campaign_id, user_id, event, placement, cost, billable, dedupe_key)
  values (a.id, v_uid, 'click', p_placement, v_cost, v_cost > 0, 'clk:' || v_bucket)
  on conflict do nothing returning id into v_ev;
  if v_ev is null then return jsonb_build_object('charged', false, 'reason', 'dedupe'); end if;
  update merchant_ads set clicks = clicks + 1 where id = a.id;
  if v_cost > 0 then v_cost := ads_charge(a.id, v_cost, v_ev, 'cpc klik'); end if;
  return jsonb_build_object('charged', v_cost > 0, 'cost', v_cost, 'status', (select status from merchant_ads where id = a.id));
end $$;
revoke all on function public.ads_click(uuid, text) from public;
grant execute on function public.ads_click(uuid, text) to anon, authenticated;

create or replace function public.ads_conversion(p_campaign uuid, p_order uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a merchant_ads; pr ad_products; o orders; v_ev bigint; v_cost bigint := 0; v_val bigint;
begin
  select * into a from merchant_ads where id = p_campaign for update;
  if not found or a.budget is null then return jsonb_build_object('attributed', false, 'reason', 'not_campaign'); end if;
  select * into o from orders where id = p_order;
  if o.merchant_id is distinct from a.merchant_id then return jsonb_build_object('attributed', false, 'reason', 'merchant_mismatch'); end if;
  select * into pr from ad_products where code = a.product_code;
  v_val := coalesce(o.items_subtotal, 0);
  insert into ad_events (campaign_id, user_id, event, placement, order_id, billable, dedupe_key)
  values (a.id, o.customer_id, 'conversion', pr.placement, o.id, pr.pricing_model = 'cpa' and a.status = 'active', 'order:' || o.id)
  on conflict do nothing returning id into v_ev;
  if v_ev is null then return jsonb_build_object('attributed', false, 'reason', 'duplicate'); end if;
  update merchant_ads set conversions = conversions + 1, conversion_value = conversion_value + v_val where id = a.id;
  if pr.pricing_model = 'cpa' and a.status = 'active' then
    v_cost := case when pr.unit_pct is not null then round(v_val * pr.unit_pct / 100.0)::bigint else coalesce(pr.unit_price, 0) end;
    v_cost := least(v_cost, greatest(0, ads_remaining(a.id)));
    v_cost := ads_charge(a.id, v_cost, v_ev, 'cpa konversi ' || o.code);
    if ads_remaining(a.id) <= 0 then update merchant_ads set status = 'budget_exhausted', paused_by = 'system' where id = a.id and status = 'active'; end if;
  end if;
  return jsonb_build_object('attributed', true, 'cost', v_cost, 'conversion_value', v_val);
end $$;
revoke all on function public.ads_conversion(uuid, uuid) from public, anon, authenticated;

-- create_order: p_ad_campaign_id (atau p.ad_campaign_id) → orders.ad_campaign_id + ads_conversion
select _v3_splice('0109', 'public.create_order(jsonb)',
  $a$  perform ledger_post(v_order.id, 'created');   -- 0099: buku besar fase created$a$,
  $a$  -- 0109 atribusi iklan: gagal atribusi tidak menggagalkan pesanan
  if coalesce(p_ad_campaign_id, nullif(p->>'ad_campaign_id', '')::uuid) is not null then
    begin
      update orders set ad_campaign_id = coalesce(p_ad_campaign_id, nullif(p->>'ad_campaign_id', '')::uuid)
       where id = v_order.id and exists (select 1 from merchant_ads x where x.id = coalesce(p_ad_campaign_id, nullif(p->>'ad_campaign_id', '')::uuid))
      returning * into v_order;
      if v_order.ad_campaign_id is not null then perform ads_conversion(v_order.ad_campaign_id, v_order.id); end if;
    exception when others then
      insert into order_events (order_id, status, actor_id, note) values (v_order.id, 'note', v_uid, 'Atribusi iklan gagal: ' || left(sqlerrm, 120));
    end;
  end if;
  perform ledger_post(v_order.id, 'created');   -- 0099: buku besar fase created$a$,
  '0109 atribusi iklan');
do $$
declare def text; v_cmt text;
begin
  if to_regprocedure('public.create_order(jsonb,uuid)') is not null then raise notice '0109: create_order(jsonb, uuid) sudah ada, dilewati'; return; end if;
  def := pg_get_functiondef('public.create_order(jsonb)'::regprocedure);
  v_cmt := obj_description('public.create_order(jsonb)'::regprocedure, 'pg_proc');
  if position('CREATE OR REPLACE FUNCTION public.create_order(p jsonb)' in def) = 0 then raise exception '0109 batal: kepala create_order berubah'; end if;
  def := replace(def, 'CREATE OR REPLACE FUNCTION public.create_order(p jsonb)', 'CREATE OR REPLACE FUNCTION public.create_order(p jsonb, p_ad_campaign_id uuid DEFAULT NULL::uuid)');
  drop function public.create_order(jsonb);
  execute def;
  execute format('comment on function public.create_order(jsonb, uuid) is %L', coalesce(v_cmt, '') ||
    ' Sejak 0105 biaya PG ke pelanggan hanya bila pg_fee_borne_by_for=customer (§0.5); 0107 rate_take; 0109 p_ad_campaign_id (atau p.ad_campaign_id) → orders.ad_campaign_id + ads_conversion.');
end $$;
revoke all on function public.create_order(jsonb, uuid) from public, anon;
grant execute on function public.create_order(jsonb, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 5. RPC admin
-- ---------------------------------------------------------------------
create or replace function public.admin_set_ad_product(p_code text, p_patch jsonb)
returns ad_products
language plpgsql security definer set search_path = public as $$
declare b ad_products; a ad_products; k text; v_code text := lower(trim(coalesce(p_code, ''))); v_new boolean := false; ringkas text;
  allowed constant text[] := array['name','description','unit','price','placement','active','pricing_model','unit_price','unit_pct','min_budget',
    'min_days','max_days','requires_approval','label'];
begin
  if not is_admin() then raise exception 'Hanya admin'; end if;
  perform admin_require('ads');   -- 0109 RBAC
  perform admin_require_unlock();
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then raise exception 'Patch kosong: kirim objek {kolom: nilai}'; end if;
  for k in select jsonb_object_keys(p_patch) loop
    if not (k = any (allowed)) then raise exception 'Kolom tidak dikenal: %', k; end if;
  end loop;
  if v_code !~ '^[a-z0-9_]{2,40}$' then raise exception 'Kode produk iklan: huruf kecil/angka/_ 2–40 karakter'; end if;
  select * into b from ad_products where code = v_code for update;
  if not found then
    v_new := true;
    if not (p_patch ? 'name' and p_patch ? 'unit' and p_patch ? 'price' and p_patch ? 'placement') then
      raise exception 'Produk baru wajib mengisi name, unit, price, placement';
    end if;
    b.code := v_code; b.active := true; b.pricing_model := 'flat'; b.min_budget := 50000; b.min_days := 1; b.max_days := 30;
    b.requires_approval := true; b.label := 'Sponsored';
  end if;
  a := b;
  begin
    if p_patch ? 'name' then a.name := nullif(trim(p_patch->>'name'), ''); end if;
    if p_patch ? 'description' then a.description := p_patch->>'description'; end if;
    if p_patch ? 'unit' then a.unit := lower(trim(p_patch->>'unit')); end if;
    if p_patch ? 'price' then a.price := (p_patch->>'price')::bigint; end if;
    if p_patch ? 'placement' then a.placement := lower(trim(p_patch->>'placement')); end if;
    if p_patch ? 'active' then a.active := (p_patch->>'active')::boolean; end if;
    if p_patch ? 'pricing_model' then a.pricing_model := lower(trim(p_patch->>'pricing_model')); end if;
    if p_patch ? 'unit_price' then a.unit_price := (p_patch->>'unit_price')::bigint; end if;
    if p_patch ? 'unit_pct' then a.unit_pct := nullif(p_patch->>'unit_pct', '')::numeric; end if;
    if p_patch ? 'min_budget' then a.min_budget := (p_patch->>'min_budget')::bigint; end if;
    if p_patch ? 'min_days' then a.min_days := (p_patch->>'min_days')::int; end if;
    if p_patch ? 'max_days' then a.max_days := (p_patch->>'max_days')::int; end if;
    if p_patch ? 'requires_approval' then a.requires_approval := (p_patch->>'requires_approval')::boolean; end if;
    if p_patch ? 'label' then a.label := nullif(btrim(p_patch->>'label'), ''); end if;
  exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'Nilai patch tidak valid: %', sqlerrm; end;
  if a.name is null then raise exception 'Nama produk wajib diisi'; end if;
  if a.unit not in ('per_day','per_week','per_order','per_click','per_mille') then raise exception 'unit harus per_day|per_week|per_order|per_click|per_mille'; end if;
  if a.placement not in ('featured_home','boost_nearby','banner_category','search_top','banner_home','radius_promo','sponsored_voucher','post_checkout_cross') then
    raise exception 'placement tidak dikenal: %', a.placement;
  end if;
  if a.pricing_model not in ('flat','cpc','cpm','cpa') then raise exception 'pricing_model harus flat|cpc|cpm|cpa'; end if;
  if a.price is null or a.price < 0 or a.price > 100000000 then raise exception 'Harga iklan harus Rp0–Rp100.000.000'; end if;
  if a.unit_price is not null and (a.unit_price < 0 or a.unit_price > 100000000) then raise exception 'unit_price harus Rp0–Rp100.000.000'; end if;
  if a.unit_pct is not null and (a.unit_pct < 0 or a.unit_pct > 50) then raise exception 'unit_pct harus 0–50 %%'; end if;
  if a.min_days < 1 or a.max_days < a.min_days or a.max_days > 366 then raise exception 'min_days/max_days tidak valid'; end if;
  if a.label is null or length(a.label) > 20 then raise exception 'Label wajib (maks 20 karakter), mis. Sponsored'; end if;
  if a.active is null then raise exception 'active harus true|false'; end if;
  if v_new then
    insert into ad_products (code, name, description, unit, price, placement, active, pricing_model, unit_price, unit_pct, min_budget, min_days, max_days,
      requires_approval, label, updated_at, updated_by)
    values (a.code, a.name, a.description, a.unit, a.price, a.placement, a.active, a.pricing_model, coalesce(a.unit_price, a.price), a.unit_pct, a.min_budget,
      a.min_days, a.max_days, a.requires_approval, a.label, now(), auth.uid()) returning * into a;
  else
    update ad_products set name = a.name, description = a.description, unit = a.unit, price = a.price, placement = a.placement, active = a.active,
      pricing_model = a.pricing_model, unit_price = a.unit_price, unit_pct = a.unit_pct, min_budget = a.min_budget, min_days = a.min_days,
      max_days = a.max_days, requires_approval = a.requires_approval, label = a.label, updated_at = now(), updated_by = auth.uid()
     where code = v_code returning * into a;
  end if;
  select string_agg(format('%s: %s → %s', x.key, x.lama, x.baru), ', ') into ringkas
  from (select key, bj.value #>> '{}' as lama, aj.value #>> '{}' as baru
        from jsonb_each(to_jsonb(b)) bj(key, value) join jsonb_each(to_jsonb(a)) aj using (key)
        where key = any (allowed) and bj.value is distinct from aj.value) x;
  perform log_activity(case when v_new then 'ads.product_created' else 'ads.product_updated' end, 'ad_products', v_code,
    'Produk iklan ' || v_code || case when v_new then ' dibuat' else ' diubah: ' || coalesce(ringkas, '(tidak ada perubahan nilai)') end,
    jsonb_build_object('before', case when v_new then null else to_jsonb(b) end, 'after', to_jsonb(a), 'patch', p_patch));
  return a;
end $$;
revoke all on function public.admin_set_ad_product(text, jsonb) from public, anon;
grant execute on function public.admin_set_ad_product(text, jsonb) to authenticated;

create or replace function public.admin_campaigns(p_status text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_st text := nullif(nullif(lower(trim(coalesce(p_status, ''))), ''), 'all');
begin
  perform admin_require('view');
  perform expire_merchant_ads();
  return coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'merchant_id', a.merchant_id, 'merchant', m.name, 'product', a.product_code,
      'product_name', pr.name, 'pricing_model', pr.pricing_model, 'unit_price', pr.unit_price, 'placement', pr.placement, 'label', pr.label,
      'status', a.status, 'paused_by', a.paused_by, 'budget', a.budget, 'spent', a.spent, 'remaining', ads_remaining(a.id),
      'starts_at', a.starts_at, 'ends_at', a.ends_at, 'radius_km', a.radius_km, 'category', a.category, 'creative', a.creative,
      'review_note', a.review_note, 'reviewed_by', a.reviewed_by, 'reviewed_at', a.reviewed_at,
      'impressions', a.impressions, 'clicks', a.clicks, 'conversions', a.conversions, 'conversion_value', a.conversion_value,
      'fraud_clicks', (select count(*) from ad_events e where e.campaign_id = a.id and e.event = 'click' and e.dedupe_key like 'dup:%'),
      'created_at', a.created_at) order by a.created_at desc)
    from merchant_ads a join merchants m on m.id = a.merchant_id join ad_products pr on pr.code = a.product_code
    where a.budget is not null and (v_st is null or a.status = v_st)), '[]'::jsonb);
end $$;
revoke all on function public.admin_campaigns(text) from public, anon;
grant execute on function public.admin_campaigns(text) to authenticated;

create or replace function public.admin_campaign_review(p_id uuid, p_approve boolean, p_note text default null)
returns merchant_ads language plpgsql security definer set search_path = public as $$
declare a merchant_ads; b merchant_ads; v_ref bigint := 0;
begin
  perform admin_require('ads');
  perform admin_require_unlock();
  if p_approve is null then raise exception 'Keputusan wajib diisi'; end if;
  select * into b from merchant_ads where id = p_id for update;
  if not found or b.budget is null then raise exception 'Kampanye tidak ditemukan'; end if;
  if b.status <> 'pending_review' then raise exception 'Kampanye tidak menunggu review (status %)', b.status; end if;
  if not p_approve and length(btrim(coalesce(p_note, ''))) < 5 then raise exception 'Tulis alasan penolakan (brand safety) min. 5 karakter'; end if;
  update merchant_ads set review_note = nullif(btrim(coalesce(p_note, '')), ''), reviewed_by = auth.uid(), reviewed_at = now(),
    status = case when p_approve then 'approved' else 'rejected' end where id = b.id returning * into a;
  if p_approve then a := ads_activate(a.id);
  else v_ref := ads_refund_remaining(a.id, 'kampanye ditolak admin'); end if;
  perform log_activity(case when p_approve then 'ads.campaign_approved' else 'ads.campaign_rejected' end, 'merchant_ads', a.id::text,
    'Kampanye ' || a.name || ' ' || case when p_approve then 'disetujui → ' || a.status else 'ditolak (dana Rp' || v_ref || ' dikembalikan)' end || coalesce(': ' || p_note, ''),
    jsonb_build_object('before', to_jsonb(b) - 'center', 'after', to_jsonb(a) - 'center', 'refund', v_ref));
  insert into notifications (user_id, kind, title, body, data)
  select m.owner_id, 'system', case when p_approve then 'Kampanye iklan aktif' else 'Kampanye iklan ditolak' end,
    'Kampanye ' || a.name || case when p_approve then ' sudah tayang.' else ' ditolak: ' || coalesce(p_note, '-') || '. Dana Rp' || v_ref || ' dikembalikan ke saldo.' end,
    jsonb_build_object('campaign_id', a.id) from merchants m where m.id = a.merchant_id;
  return a;
end $$;
revoke all on function public.admin_campaign_review(uuid, boolean, text) from public, anon;
grant execute on function public.admin_campaign_review(uuid, boolean, text) to authenticated;

create or replace function public.admin_campaign_set(p_id uuid, p_action text)
returns merchant_ads language plpgsql security definer set search_path = public as $$
declare a merchant_ads; b merchant_ads; v_act text := lower(trim(coalesce(p_action, ''))); v_ref bigint := 0;
begin
  perform admin_require('ads');
  perform admin_require_unlock();
  select * into b from merchant_ads where id = p_id for update;
  if not found or b.budget is null then raise exception 'Kampanye tidak ditemukan'; end if;
  if v_act = 'pause' then
    if b.status not in ('active', 'budget_exhausted') then raise exception 'Kampanye % tidak bisa dijeda', b.status; end if;
    update merchant_ads set status = 'paused', paused_by = 'admin' where id = b.id returning * into a;
  elsif v_act = 'resume' then
    if b.status <> 'paused' then raise exception 'Kampanye tidak sedang dijeda'; end if;
    if b.ends_at <= now() then raise exception 'Periode kampanye sudah berakhir'; end if;
    update merchant_ads set status = 'active', paused_by = null where id = b.id returning * into a;
  elsif v_act in ('stop', 'cancel') then
    if b.status in ('ended','cancelled','rejected','expired') then raise exception 'Kampanye sudah %', b.status; end if;
    update merchant_ads set status = case when v_act = 'cancel' or b.activated_at is null then 'cancelled' else 'ended' end, paused_by = 'admin',
      ends_at = case when b.activated_at is not null and ends_at > now() then greatest(now(), starts_at + interval '1 second') else ends_at end where id = b.id returning * into a;
    v_ref := ads_refund_remaining(b.id, 'dihentikan admin');
  else raise exception 'Aksi harus pause|resume|stop|cancel'; end if;
  perform log_activity('ads.campaign_admin_' || v_act, 'merchant_ads', a.id::text, 'Kampanye ' || a.name || ': ' || b.status || ' → ' || a.status
      || case when v_ref > 0 then ' (sisa Rp' || v_ref || ' dikembalikan)' else '' end,
    jsonb_build_object('before', to_jsonb(b) - 'center', 'after', to_jsonb(a) - 'center', 'refund', v_ref));
  return a;
end $$;
revoke all on function public.admin_campaign_set(uuid, text) from public, anon;
grant execute on function public.admin_campaign_set(uuid, text) to authenticated;

create or replace function public.admin_ads_report(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_from timestamptz; v_to timestamptz;
begin
  perform admin_require('report');
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then raise exception 'Rentang tanggal tidak valid (maks 400 hari)'; end if;
  v_from := p_from::timestamp at time zone 'Asia/Jakarta'; v_to := (p_to + 1)::timestamp at time zone 'Asia/Jakarta';
  return jsonb_build_object('from', p_from, 'to', p_to,
    'revenue_total', (select coalesce(sum(amount), 0) from order_ledger where source = 'merchant_ads' and entry = 'ads_revenue' and created_at >= v_from and created_at < v_to),
    'campaign_spend', (select coalesce(-sum(amount), 0) from ad_budget_ledger where kind = 'charge' and created_at >= v_from and created_at < v_to),
    'by_product', (select coalesce(jsonb_agg(jsonb_build_object('product', x.code, 'name', x.name, 'pricing_model', x.pricing_model, 'revenue', x.rev) order by x.rev desc), '[]'::jsonb)
      from (select pr.code, pr.name, pr.pricing_model, sum(l.amount) rev from order_ledger l join merchant_ads a on a.id = l.source_id join ad_products pr on pr.code = a.product_code
            where l.source = 'merchant_ads' and l.entry = 'ads_revenue' and l.created_at >= v_from and l.created_at < v_to group by pr.code, pr.name, pr.pricing_model) x),
    'by_merchant', (select coalesce(jsonb_agg(jsonb_build_object('merchant_id', x.merchant_id, 'merchant', x.name, 'revenue', x.rev, 'conversion_value', x.cval,
          'roas', case when x.spend > 0 then round(x.cval::numeric / x.spend, 2) end) order by x.rev desc), '[]'::jsonb)
      from (select a.merchant_id, m.name, sum(l.amount) rev,
                   (select coalesce(sum(o.items_subtotal), 0) from ad_events e join orders o on o.id = e.order_id join merchant_ads a2 on a2.id = e.campaign_id
                     where a2.merchant_id = a.merchant_id and e.event = 'conversion' and e.created_at >= v_from and e.created_at < v_to) cval,
                   (select coalesce(-sum(b.amount), 0) from ad_budget_ledger b join merchant_ads a3 on a3.id = b.campaign_id
                     where a3.merchant_id = a.merchant_id and b.kind = 'charge' and b.created_at >= v_from and b.created_at < v_to) spend
            from order_ledger l join merchant_ads a on a.id = l.source_id join merchants m on m.id = a.merchant_id
            where l.source = 'merchant_ads' and l.entry = 'ads_revenue' and l.created_at >= v_from and l.created_at < v_to group by a.merchant_id, m.name) x),
    'events', (select jsonb_build_object('impressions', count(*) filter (where event = 'impression'), 'billable_impressions', count(*) filter (where event = 'impression' and billable),
        'clicks', count(*) filter (where event = 'click'), 'billable_clicks', count(*) filter (where event = 'click' and billable),
        'fraud_dedupe_clicks', count(*) filter (where event = 'click' and dedupe_key like 'dup:%'), 'conversions', count(*) filter (where event = 'conversion'))
      from ad_events where created_at >= v_from and created_at < v_to),
    'conversion_value', (select coalesce(sum(o.items_subtotal), 0) from ad_events e join orders o on o.id = e.order_id where e.event = 'conversion' and e.created_at >= v_from and e.created_at < v_to),
    'labels', jsonb_build_object('prices', '[ASUMSI] harga ad_products — admin mengubah lewat admin_set_ad_product', 'roas', 'conversion_value ÷ biaya kampanye (ad_budget_ledger charge)'));
end $$;
revoke all on function public.admin_ads_report(date, date) from public, anon;
grant execute on function public.admin_ads_report(date, date) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Kedaluwarsa & anggaran habis
-- ---------------------------------------------------------------------
create or replace function public.expire_merchant_ads()
returns int language plpgsql security definer set search_path = public as $$
declare n int; n2 int := 0; c record;
begin
  -- paket harian v2
  update merchant_ads set status = 'expired' where budget is null and status = 'active' and ends_at <= now();
  get diagnostics n = row_count;
  -- kampanye v3: lewat masa → ended + sisa anggaran kembali ke saldo merchant
  for c in select id from merchant_ads where budget is not null and status in ('active','paused','budget_exhausted','approved') and ends_at <= now() for update skip locked loop
    update merchant_ads set status = 'ended', paused_by = coalesce(paused_by, 'system') where id = c.id;
    perform ads_refund_remaining(c.id, 'periode kampanye berakhir');
    n2 := n2 + 1;
  end loop;
  -- anggaran di bawah biaya berikutnya → budget_exhausted
  update merchant_ads a set status = 'budget_exhausted', paused_by = 'system'
    from ad_products pr where pr.code = a.product_code and a.budget is not null and a.status = 'active' and pr.pricing_model <> 'flat'
     and ads_remaining(a.id) < ads_next_cost(pr.pricing_model, pr.unit_price);
  return n + n2;
end $$;
revoke all on function public.expire_merchant_ads() from public, anon, authenticated;
grant execute on function public.expire_merchant_ads() to service_role;

create or replace function public.merchant_my_ads()
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'ads', coalesce((select jsonb_agg(jsonb_build_object(
        'id', a.id, 'merchant_id', a.merchant_id, 'merchant_name', m.name, 'product_code', a.product_code, 'product_name', pr.name,
        'placement', pr.placement, 'starts_at', a.starts_at, 'ends_at', a.ends_at, 'price_paid', a.price_paid, 'refunded', a.refunded,
        'status', case when a.status = 'active' and a.ends_at <= now() then 'expired' else a.status end, 'paid_via', a.paid_via,
        'is_live', a.status = 'active' and now() >= a.starts_at and now() < a.ends_at, 'label', pr.label) order by a.created_at desc)
      from merchant_ads a join merchants m on m.id = a.merchant_id join ad_products pr on pr.code = a.product_code
      where m.owner_id = auth.uid() and a.budget is null), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'name', name, 'description', description, 'unit', unit,
        'price', price, 'placement', placement) order by price) from ad_products where active and unit in ('per_day', 'per_week')), '[]'::jsonb),
    'campaign_products', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'name', name, 'description', description, 'pricing_model', pricing_model,
        'unit_price', unit_price, 'unit_pct', unit_pct, 'min_budget', min_budget, 'min_days', min_days, 'max_days', max_days, 'placement', placement,
        'requires_approval', requires_approval, 'label', label) order by pricing_model, code) from ad_products where active), '[]'::jsonb),
    'campaigns', merchant_campaigns(),
    'balance', coalesce((select balance from wallets where user_id = auth.uid()), 0));
$$;
revoke all on function public.merchant_my_ads() from public, anon;
grant execute on function public.merchant_my_ads() to authenticated;

-- ---------------------------------------------------------------------
-- 7. nearby_merchants_v2 — label Sponsored + campaign_id (tipe hasil berubah → drop & buat ulang)
-- ---------------------------------------------------------------------
drop function if exists public.nearby_merchants_v2(double precision, double precision, numeric, text, boolean);
create or replace function public.nearby_merchants_v2(p_lat double precision, p_lng double precision, p_radius_km numeric default 15,
  p_q text default null, p_halal boolean default null)
returns table(id uuid, name text, description text, category text, address text, image_url text, is_open boolean, rating_avg numeric,
  rating_count integer, prep_minutes integer, lat double precision, lng double precision, distance_km numeric, delivery_fee bigint,
  is_halal boolean, halal_verified boolean, boosted boolean, featured boolean, ad_label text, campaign_id uuid)
language sql stable security definer set search_path = public as $$
  with pt as (select st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography g),
  base as (
    select m.id, m.name, m.description, m.category, m.address, m.image_url, m.is_open, m.rating_avg, m.rating_count, m.prep_minutes,
      m.lat, m.lng,
      round((st_distance(m.location, pt.g) / 1000.0)::numeric, 2) as distance_km,
      (select fare from calc_fare('food'::service_type, (greatest(0.5, st_distance(m.location, pt.g) / 1000.0 * 1.3))::numeric)) as delivery_fee,
      m.is_halal, m.halal_verified,
      -- paket harian v2
      exists (select 1 from merchant_ads a join ad_products pr on pr.code = a.product_code
               where a.merchant_id = m.id and a.budget is null and a.status = 'active' and now() >= a.starts_at and now() < a.ends_at and pr.placement = 'boost_nearby') as boost_v2,
      exists (select 1 from merchant_ads a join ad_products pr on pr.code = a.product_code
               where a.merchant_id = m.id and a.budget is null and a.status = 'active' and now() >= a.starts_at and now() < a.ends_at and pr.placement = 'featured_home') as feat_v2,
      -- kampanye v3 aktif yang menjangkau titik pelanggan & masih punya anggaran
      (select a.id from merchant_ads a join ad_products pr on pr.code = a.product_code
        where a.merchant_id = m.id and a.budget is not null and a.status = 'active' and now() >= a.starts_at and now() < a.ends_at
          and pr.placement in ('boost_nearby', 'featured_home') and a.center is not null and st_dwithin(a.center, pt.g, coalesce(a.radius_km, 5) * 1000)
          and ads_remaining(a.id) >= ads_next_cost(pr.pricing_model, pr.unit_price)
        order by (pr.placement = 'boost_nearby') desc, a.created_at limit 1) as camp
    from merchants m, pt
    where m.status = 'approved' and m.location is not null
      and st_dwithin(m.location, pt.g, p_radius_km * 1000)
      and (p_halal is null or m.is_halal = p_halal)
      and (p_q is null or p_q = '' or m.name ilike '%' || p_q || '%' or m.category ilike '%' || p_q || '%'
           or exists (select 1 from menu_items mi where mi.merchant_id = m.id and mi.name ilike '%' || p_q || '%'))
  ), lab as (
    select b.*, (select pr.placement from merchant_ads a join ad_products pr on pr.code = a.product_code where a.id = b.camp) as camp_place
    from base b
  )
  select l.id, l.name, l.description, l.category, l.address, l.image_url, l.is_open, l.rating_avg, l.rating_count, l.prep_minutes, l.lat, l.lng,
    l.distance_km, l.delivery_fee, l.is_halal, l.halal_verified,
    (l.boost_v2 or coalesce(l.camp_place = 'boost_nearby', false)) as boosted,
    (l.feat_v2 or coalesce(l.camp_place = 'featured_home', false)) as featured,
    case when l.boost_v2 or l.feat_v2 or l.camp is not null
         then coalesce((select pr.label from merchant_ads a join ad_products pr on pr.code = a.product_code where a.id = l.camp), 'Sponsored') end as ad_label,
    l.camp as campaign_id
  from lab l
  order by (l.boost_v2 or coalesce(l.camp_place = 'boost_nearby', false)) desc, l.distance_km limit 50
$$;
revoke all on function public.nearby_merchants_v2(double precision, double precision, numeric, text, boolean) from public;
grant execute on function public.nearby_merchants_v2(double precision, double precision, numeric, text, boolean) to anon, authenticated;
comment on function public.nearby_merchants_v2(double precision, double precision, numeric, text, boolean) is
  'Merchant terdekat + penanda iklan (0101; v3 0109): boosted/featured dari paket harian v2 atau kampanye aktif yang menjangkau titik pelanggan; ad_label ''Sponsored'' (ad_products.label) + campaign_id. Urutan: bertanda boosted di atas, sisanya jarak (organik tidak diubah). Klien WAJIB menampilkan label & blok Sponsored terpisah.';

-- ---------------------------------------------------------------------
-- 8. Penjaga migrasi
-- ---------------------------------------------------------------------
do $$
begin
  if (select count(*) from pg_proc where proname = 'create_order' and pronamespace = 'public'::regnamespace) <> 1
     or to_regprocedure('public.create_order(jsonb,uuid)') is null then
    raise exception '0109 batal: create_order harus tepat satu fungsi (p jsonb, p_ad_campaign_id uuid default null)';
  end if;
  if position('0109 atribusi iklan' in pg_get_functiondef('public.create_order(jsonb,uuid)'::regprocedure)) = 0
     or position('0107 rate_take' in pg_get_functiondef('public.create_order(jsonb,uuid)'::regprocedure)) = 0
     or position('0105 pg_fee_borne_by_for' in pg_get_functiondef('public.create_order(jsonb,uuid)'::regprocedure)) = 0 then
    raise exception '0109 batal: create_order kehilangan tambalan';
  end if;
  if has_function_privilege('anon', 'public.create_order(jsonb,uuid)', 'EXECUTE') or not has_function_privilege('authenticated', 'public.create_order(jsonb,uuid)', 'EXECUTE') then
    raise exception '0109 batal: hak create_order salah';
  end if;
  if (select count(*) from ad_products where code in ('featured_home','boost_nearby','search_top','banner_home','banner_category','radius_promo','sponsored_voucher','post_checkout_cross')) <> 8 then
    raise exception '0109 batal: produk iklan v3 belum lengkap';
  end if;
  if has_table_privilege('authenticated', 'public.ad_events', 'INSERT') or has_table_privilege('authenticated', 'public.ad_budget_ledger', 'INSERT')
     or has_function_privilege('authenticated', 'public.ads_charge(uuid,bigint,bigint,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.ads_conversion(uuid,uuid)', 'EXECUTE')
     or not has_function_privilege('anon', 'public.ads_serve(text,double precision,double precision,text,text,integer)', 'EXECUTE')
     or not has_function_privilege('anon', 'public.nearby_merchants_v2(double precision,double precision,numeric,text,boolean)', 'EXECUTE') then
    raise exception '0109 batal: hak akses iklan salah';
  end if;
  raise notice '0109 ok: kampanye iklan v3 (8 produk), ad_events/ad_budget_ledger append-only, ads_serve/click/conversion, create_order(p, p_ad_campaign_id), label Sponsored';
end $$;
