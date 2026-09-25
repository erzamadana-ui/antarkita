-- =====================================================================
-- 0101 — IKLAN & BOOST MERCHANT (`ad_products`, `merchant_ads`) — Skema Bisnis v2
--
-- Sumber: docs/SKEMA-BISNIS-V2-SPEK.md §4, §0.5 (iklan/boost = sumber pendapatan platform),
-- §0.8 (dibayar dari saldo pendapatan merchant: closed-loop, aman PKS Midtrans Pasal 7.4b), §9 (label "Iklan").
--
-- Sebelum ini hanya ada `blasts` (0009) tanpa harga; komponen MerchantAds = merchant terdekat (bukan berbayar).
-- Sekarang:
--   • ad_products  : katalog produk iklan (harga/unit/penempatan) — diatur admin (PIN + audit).
--   • merchant_ads : iklan per merchant. Aktif → pendapatan dicatat di order_ledger
--                    (source='merchant_ads', entry='ads_revenue', phase='completed'); pembatalan dengan refund
--                    → baris ads_revenue negatif (phase='refunded'). Satu sumber kebenaran laporan (0103).
--   • merchant_ad_request(product, days) : merchant membeli sendiri dari saldo pendapatan (wallet_apply 'payment').
--   • nearby_merchants_v2 : sama dengan nearby_merchants + kolom boosted/featured/ad_label, merchant ber-iklan di atas.
--     nearby_merchants (RETURNS TABLE) TIDAK diubah: menambah kolom mengubah tipe hasil, dan mengurutkan
--     merchant berbayar ke atas tanpa kolom label melanggar transparansi §9 — klien pindah ke _v2 bersama label "Iklan".
--
-- Isi: 1 tabel + RLS · 2 nilai awal [ASUMSI] · 3 ledger_post_ads · 4 RPC admin · 5 RPC merchant
--      6 expire_merchant_ads + cron · 7 nearby_merchants_v2 · 8 penjaga. Idempoten.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Tabel
-- ---------------------------------------------------------------------
create table if not exists public.ad_products (
  code        text primary key check (code ~ '^[a-z0-9_]{2,40}$'),
  name        text not null,
  description text,
  unit        text not null check (unit in ('per_day','per_week','per_order')),
  price       bigint not null check (price >= 0),
  placement   text not null check (placement in ('featured_home','boost_nearby','banner_category')),
  active      boolean not null default true,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);
comment on table public.ad_products is 'Skema Bisnis v2 (0101): produk iklan/boost merchant. Harga [ASUMSI] diubah admin lewat admin_set_ad_product (PIN + audit).';

create table if not exists public.merchant_ads (
  id           uuid primary key default gen_random_uuid(),
  merchant_id  uuid not null references public.merchants(id) on delete cascade,
  product_code text not null references public.ad_products(code),
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  price_paid   bigint not null default 0 check (price_paid >= 0),
  status       text not null default 'draft' check (status in ('draft','pending_payment','active','expired','cancelled')),
  paid_via     text,                -- 'wallet' (saldo pendapatan merchant) | 'admin' (ditagih di luar aplikasi) | 'gratis'
  payment_id   uuid references public.payments(id),
  refunded     bigint not null default 0 check (refunded >= 0),
  activated_at timestamptz,         -- pertama kali berstatus active (dasar pengakuan pendapatan iklan)
  note         text,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists merchant_ads_live_idx on public.merchant_ads (merchant_id, ends_at) where status = 'active';
create index if not exists merchant_ads_status_idx on public.merchant_ads (status, created_at desc);
comment on table public.merchant_ads is 'Skema Bisnis v2 (0101): iklan per merchant. status active + starts_at ≤ now() < ends_at = tayang. Pendapatan → order_ledger(source=merchant_ads, entry=ads_revenue).';

alter table public.ad_products enable row level security;
drop policy if exists ad_products_read on public.ad_products;
create policy ad_products_read on public.ad_products for select to anon, authenticated using (active or is_admin());
revoke all on public.ad_products from public, anon, authenticated;
grant select on public.ad_products to anon, authenticated;
grant all on public.ad_products to service_role;

alter table public.merchant_ads enable row level security;
drop policy if exists merchant_ads_read on public.merchant_ads;
create policy merchant_ads_read on public.merchant_ads for select to authenticated using (is_admin() or owns_merchant(merchant_id));
revoke all on public.merchant_ads from public, anon, authenticated;
grant select on public.merchant_ads to authenticated;
grant all on public.merchant_ads to service_role;

do $$
begin
  if to_regprocedure('public.audit_trigger()') is not null then
    if not exists (select 1 from pg_trigger where tgname = 't_audit_ad_products' and tgrelid = 'public.ad_products'::regclass) then
      create trigger t_audit_ad_products after insert or delete or update on public.ad_products for each row execute function audit_trigger();
    end if;
    if not exists (select 1 from pg_trigger where tgname = 't_audit_merchant_ads' and tgrelid = 'public.merchant_ads'::regclass) then
      create trigger t_audit_merchant_ads after insert or delete or update on public.merchant_ads for each row execute function audit_trigger();
    end if;
  end if;
  if to_regprocedure('public.set_updated_at()') is not null
     and not exists (select 1 from pg_trigger where tgname = 't_merchant_ads_upd' and tgrelid = 'public.merchant_ads'::regclass) then
    create trigger t_merchant_ads_upd before update on public.merchant_ads for each row execute function set_updated_at();
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2. Nilai awal [ASUMSI] — admin mengubah dari Panel Admin → Iklan & Boost
-- ---------------------------------------------------------------------
insert into public.ad_products (code, name, description, unit, price, placement) values
  ('featured_home',   'Unggulan Beranda',     '[ASUMSI] Rp25.000/hari — tampil di deretan "Unggulan" beranda pelanggan dengan label Iklan', 'per_day',  25000, 'featured_home'),
  ('boost_nearby',    'Boost Terdekat',       '[ASUMSI] Rp15.000/hari — urutan teratas daftar merchant terdekat dengan label Iklan',        'per_day',  15000, 'boost_nearby'),
  ('banner_category', 'Banner Kategori',      '[ASUMSI] Rp50.000/minggu — banner di halaman kategori',                                       'per_week', 50000, 'banner_category')
on conflict (code) do nothing;

-- ---------------------------------------------------------------------
-- 3. Buku besar iklan (internal): ads_revenue saat aktif; refund → ads_revenue negatif fase refunded
-- ---------------------------------------------------------------------
create or replace function public.ledger_post_ads(p_ad uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a merchant_ads; m merchants; v_city uuid; v_city_name text; pr ad_products;
begin
  select * into a from merchant_ads where id = p_ad;
  if not found then raise exception 'ledger_post_ads: iklan % tidak ditemukan', p_ad; end if;
  select * into m from merchants where id = a.merchant_id;
  select * into pr from ad_products where code = a.product_code;
  if m.lat is not null then v_city := nearest_city(m.lat, m.lng); end if;
  select name into v_city_name from cities where id = v_city;
  delete from order_ledger where source = 'merchant_ads' and source_id = a.id;
  if a.activated_at is not null and a.price_paid > 0 then   -- pernah tayang/dibayar → pendapatan diakui
    insert into order_ledger (source, source_id, service, city_id, city, entry, amount, party_role, party_id, phase, note)
    values ('merchant_ads', a.id, 'food', v_city, coalesce(v_city_name, m.address), 'ads_revenue', a.price_paid, 'merchant', m.owner_id, 'completed',
            coalesce(pr.name, a.product_code) || ' · ' || m.name || ' · ' || to_char(a.starts_at at time zone 'Asia/Jakarta', 'DD Mon') || '–' || to_char(a.ends_at at time zone 'Asia/Jakarta', 'DD Mon') || ' · ' || coalesce(a.paid_via, '-'));
  end if;
  if a.refunded > 0 then
    insert into order_ledger (source, source_id, service, city_id, city, entry, amount, party_role, party_id, phase, note)
    values ('merchant_ads', a.id, 'food', v_city, coalesce(v_city_name, m.address), 'ads_revenue', -a.refunded, 'merchant', m.owner_id, 'refunded', 'refund iklan dibatalkan');
  end if;
  return jsonb_build_object('ad_id', a.id, 'status', a.status, 'ads_revenue', case when a.activated_at is not null then a.price_paid else 0 end - a.refunded, 'city_id', v_city);
end $$;
revoke all on function public.ledger_post_ads(uuid) from public, anon, authenticated;

-- harga iklan untuk durasi tertentu
create or replace function public.ad_price(p_product text, p_days int)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare pr ad_products; v_units int; v_days int;
begin
  select * into pr from ad_products where code = p_product;
  if not found then raise exception 'Produk iklan tidak dikenal: %', coalesce(p_product, 'kosong'); end if;
  if p_days is null or p_days < 1 or p_days > 90 then raise exception 'Durasi iklan 1–90 hari'; end if;
  if pr.unit = 'per_day' then v_units := p_days; v_days := p_days;
  elsif pr.unit = 'per_week' then v_units := ceil(p_days / 7.0)::int; v_days := v_units * 7;
  else raise exception 'Produk % dihitung per pesanan — belum bisa dibeli per hari', pr.name; end if;
  return jsonb_build_object('product', pr.code, 'name', pr.name, 'unit', pr.unit, 'units', v_units, 'days', v_days,
    'unit_price', pr.price, 'price', pr.price * v_units, 'placement', pr.placement, 'active', pr.active);
end $$;
grant execute on function public.ad_price(text, int) to authenticated;
revoke all on function public.ad_price(text, int) from public, anon;

-- ---------------------------------------------------------------------
-- 4. RPC admin
-- ---------------------------------------------------------------------
create or replace function public.admin_set_ad_product(p_code text, p_patch jsonb)
returns ad_products
language plpgsql security definer set search_path = public as $$
declare b ad_products; a ad_products; k text; v_code text := lower(trim(coalesce(p_code, ''))); v_new boolean := false; ringkas text;
  allowed constant text[] := array['name','description','unit','price','placement','active'];
begin
  if not is_admin() then raise exception 'Hanya admin'; end if;
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
    b.code := v_code; b.active := true;
  end if;
  a := b;
  begin
    if p_patch ? 'name' then a.name := nullif(trim(p_patch->>'name'), ''); end if;
    if p_patch ? 'description' then a.description := p_patch->>'description'; end if;
    if p_patch ? 'unit' then a.unit := lower(trim(p_patch->>'unit')); end if;
    if p_patch ? 'price' then a.price := (p_patch->>'price')::bigint; end if;
    if p_patch ? 'placement' then a.placement := lower(trim(p_patch->>'placement')); end if;
    if p_patch ? 'active' then a.active := (p_patch->>'active')::boolean; end if;
  exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'Nilai patch tidak valid: %', sqlerrm; end;
  if a.name is null then raise exception 'Nama produk wajib diisi'; end if;
  if a.unit not in ('per_day','per_week','per_order') then raise exception 'unit harus per_day|per_week|per_order'; end if;
  if a.placement not in ('featured_home','boost_nearby','banner_category') then raise exception 'placement harus featured_home|boost_nearby|banner_category'; end if;
  if a.price is null or a.price < 0 or a.price > 100000000 then raise exception 'Harga iklan harus Rp0–Rp100.000.000'; end if;
  if a.active is null then raise exception 'active harus true|false'; end if;
  if v_new then
    insert into ad_products (code, name, description, unit, price, placement, active, updated_at, updated_by)
    values (a.code, a.name, a.description, a.unit, a.price, a.placement, a.active, now(), auth.uid()) returning * into a;
  else
    update ad_products set name = a.name, description = a.description, unit = a.unit, price = a.price, placement = a.placement,
      active = a.active, updated_at = now(), updated_by = auth.uid() where code = v_code returning * into a;
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

-- Buat/ubah iklan atas nama merchant (PIN). p_id null → buat baru; selain itu ubah (mis. batalkan).
-- p_price null → harga katalog × durasi; paid_via 'admin' (ditagih di luar aplikasi) atau 'gratis' bila 0.
-- p_refund = true saat membatalkan iklan yang dibayar dari saldo → sisa hari dikembalikan pro-rata ke saldo pemilik.
create or replace function public.admin_set_merchant_ad(p_merchant_id uuid, p_product text, p_start timestamptz, p_end timestamptz,
  p_status text, p_id uuid default null, p_price bigint default null, p_refund boolean default false)
returns merchant_ads
language plpgsql security definer set search_path = public as $$
declare a merchant_ads; b merchant_ads; m merchants; pr ad_products; v_days int; v_status text := lower(trim(coalesce(p_status, ''))); v_ref bigint := 0;
begin
  if not is_admin() then raise exception 'Hanya admin'; end if;
  perform admin_require_unlock();
  if v_status not in ('draft','pending_payment','active','expired','cancelled') then raise exception 'Status iklan harus draft|pending_payment|active|expired|cancelled'; end if;
  select * into m from merchants where id = p_merchant_id;
  if not found then raise exception 'Merchant tidak ditemukan'; end if;
  if p_id is null then
    select * into pr from ad_products where code = p_product;
    if not found then raise exception 'Produk iklan tidak dikenal: %', coalesce(p_product, 'kosong'); end if;
    if p_start is null or p_end is null or p_end <= p_start then raise exception 'Periode iklan tidak valid'; end if;
    if p_end - p_start > interval '366 days' then raise exception 'Periode iklan maksimal 1 tahun'; end if;
    if m.status <> 'approved' and v_status = 'active' then raise exception 'Merchant belum disetujui — iklan tidak bisa diaktifkan'; end if;
    v_days := greatest(1, ceil(extract(epoch from (p_end - p_start)) / 86400.0)::int);
    if p_price is not null and p_price < 0 then raise exception 'Harga tidak boleh negatif'; end if;
    insert into merchant_ads (merchant_id, product_code, starts_at, ends_at, price_paid, status, paid_via, created_by, note, activated_at)
    values (m.id, pr.code, p_start, p_end,
      coalesce(p_price, pr.price * case pr.unit when 'per_week' then ceil(v_days / 7.0)::int when 'per_day' then v_days else 1 end),
      v_status, case when coalesce(p_price, 1) = 0 then 'gratis' else 'admin' end, auth.uid(), 'dibuat admin atas nama merchant',
      case when v_status = 'active' then now() end)
    returning * into a;
    b := null;
  else
    select * into b from merchant_ads where id = p_id for update;
    if not found or b.merchant_id <> p_merchant_id then raise exception 'Iklan tidak ditemukan untuk merchant ini'; end if;
    if b.status = 'cancelled' then raise exception 'Iklan sudah dibatalkan'; end if;
    if p_start is not null and p_end is not null and p_end <= p_start then raise exception 'Periode iklan tidak valid'; end if;
    if v_status = 'cancelled' and p_refund and b.paid_via = 'wallet' and b.refunded = 0 then
      -- pro-rata sisa waktu tayang
      v_ref := case when now() <= b.starts_at then b.price_paid
                    when now() >= b.ends_at then 0
                    else floor(b.price_paid * extract(epoch from (b.ends_at - now())) / extract(epoch from (b.ends_at - b.starts_at)))::bigint end;
      if v_ref > 0 then perform wallet_apply(m.owner_id, 'refund', v_ref, null, 'Refund iklan dibatalkan ' || b.product_code, 'AD-' || b.id::text); end if;
    end if;
    update merchant_ads set starts_at = coalesce(p_start, starts_at), ends_at = coalesce(p_end, ends_at), status = v_status,
      price_paid = coalesce(p_price, price_paid), refunded = refunded + v_ref,
      activated_at = coalesce(activated_at, case when v_status = 'active' then now() end) where id = b.id returning * into a;
  end if;
  perform ledger_post_ads(a.id);
  perform log_activity(case when b.id is null then 'ads.created' else 'ads.updated' end, 'merchant_ads', a.id::text,
    'Iklan ' || a.product_code || ' ' || m.name || ': ' || coalesce(b.status, 'baru') || ' → ' || a.status || case when v_ref > 0 then ' (refund Rp' || v_ref || ')' else '' end,
    jsonb_build_object('before', to_jsonb(b), 'after', to_jsonb(a), 'refund', v_ref));
  return a;
end $$;
revoke all on function public.admin_set_merchant_ad(uuid, text, timestamptz, timestamptz, text, uuid, bigint, boolean) from public, anon;
grant execute on function public.admin_set_merchant_ad(uuid, text, timestamptz, timestamptz, text, uuid, bigint, boolean) to authenticated;

-- iklan tayang yang periodenya sudah habis → expired (dipanggil cron & RPC daftar)
create or replace function public.expire_merchant_ads()
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update merchant_ads set status = 'expired' where status = 'active' and ends_at <= now();
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.expire_merchant_ads() from public, anon, authenticated;
grant execute on function public.expire_merchant_ads() to service_role;

create or replace function public.admin_merchant_ads(p_status text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_status text := nullif(lower(trim(coalesce(p_status, ''))), 'all');
begin
  if not is_admin() then raise exception 'Hanya admin'; end if;
  perform expire_merchant_ads();
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', a.id, 'merchant_id', a.merchant_id, 'merchant_name', m.name, 'owner_id', m.owner_id,
      'product_code', a.product_code, 'product_name', pr.name, 'placement', pr.placement, 'unit', pr.unit,
      'starts_at', a.starts_at, 'ends_at', a.ends_at, 'price_paid', a.price_paid, 'refunded', a.refunded,
      'status', a.status, 'paid_via', a.paid_via, 'created_at', a.created_at, 'note', a.note,
      'is_live', a.status = 'active' and now() >= a.starts_at and now() < a.ends_at) order by a.created_at desc)
    from merchant_ads a join merchants m on m.id = a.merchant_id join ad_products pr on pr.code = a.product_code
    where v_status is null or nullif(v_status, '') is null or a.status = v_status), '[]'::jsonb);
end $$;
revoke all on function public.admin_merchant_ads(text) from public, anon;
grant execute on function public.admin_merchant_ads(text) to authenticated;

-- ---------------------------------------------------------------------
-- 5. RPC merchant: beli iklan dari saldo pendapatan (closed-loop) & daftar iklan sendiri
-- ---------------------------------------------------------------------
create or replace function public.merchant_ad_request(p_product text, p_days int, p_merchant_id uuid default null)
returns merchant_ads
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); m merchants; q jsonb; v_price bigint; v_bal bigint; v_start timestamptz; a merchant_ads; n int;
begin
  if v_uid is null then raise exception 'Harus login'; end if;
  if p_merchant_id is not null then
    select * into m from merchants where id = p_merchant_id and owner_id = v_uid;
  else
    select count(*) into n from merchants where owner_id = v_uid;
    if n > 1 then raise exception 'Anda memiliki % merchant — pilih merchant yang diiklankan', n; end if;
    select * into m from merchants where owner_id = v_uid;
  end if;
  if m.id is null then raise exception 'Hanya pemilik merchant yang bisa memasang iklan'; end if;
  if m.status <> 'approved' then raise exception 'Merchant belum disetujui admin'; end if;
  q := ad_price(p_product, p_days);
  if not (q->>'active')::boolean then raise exception 'Produk iklan % sedang tidak dijual', q->>'name'; end if;
  v_price := (q->>'price')::bigint;
  -- iklan produk yang sama yang masih tayang → iklan baru menyambung setelahnya
  select greatest(now(), coalesce(max(ends_at), now())) into v_start from merchant_ads
   where merchant_id = m.id and product_code = p_product and status = 'active' and ends_at > now();
  select balance into v_bal from wallets where user_id = v_uid for update;
  if coalesce(v_bal, 0) < v_price then
    raise exception 'Saldo pendapatan tidak cukup: perlu Rp%, saldo Rp%', to_char(v_price, 'FM999G999G999'), to_char(coalesce(v_bal, 0), 'FM999G999G999');
  end if;
  insert into merchant_ads (merchant_id, product_code, starts_at, ends_at, price_paid, status, paid_via, created_by, note, activated_at)
  values (m.id, p_product, v_start, v_start + make_interval(days => (q->>'days')::int), v_price, 'active', 'wallet', v_uid,
          'dibeli merchant: ' || (q->>'units') || ' × ' || (q->>'unit'), now())
  returning * into a;
  if v_price > 0 then
    perform wallet_apply(v_uid, 'payment', -v_price, null, 'Iklan ' || (q->>'name') || ' ' || m.name || ' ' || (q->>'days') || ' hari', 'AD-' || a.id::text);
  end if;
  perform ledger_post_ads(a.id);
  perform log_activity('ads.purchased', 'merchant_ads', a.id::text, 'Merchant ' || m.name || ' membeli iklan ' || (q->>'name') || ' ' || (q->>'days') || ' hari Rp' || v_price,
    jsonb_build_object('after', to_jsonb(a), 'quote', q));
  return a;
end $$;
revoke all on function public.merchant_ad_request(text, int, uuid) from public, anon;
grant execute on function public.merchant_ad_request(text, int, uuid) to authenticated;
comment on function public.merchant_ad_request(text, int, uuid) is
  'Merchant membeli iklan/boost dari saldo pendapatan (closed-loop, §0.8): wallet_apply(payment, -harga), status active langsung, pendapatan ads_revenue di order_ledger.';

create or replace function public.merchant_my_ads()
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'ads', coalesce((select jsonb_agg(jsonb_build_object(
        'id', a.id, 'merchant_id', a.merchant_id, 'merchant_name', m.name, 'product_code', a.product_code, 'product_name', pr.name,
        'placement', pr.placement, 'starts_at', a.starts_at, 'ends_at', a.ends_at, 'price_paid', a.price_paid, 'refunded', a.refunded,
        'status', case when a.status = 'active' and a.ends_at <= now() then 'expired' else a.status end, 'paid_via', a.paid_via,
        'is_live', a.status = 'active' and now() >= a.starts_at and now() < a.ends_at) order by a.created_at desc)
      from merchant_ads a join merchants m on m.id = a.merchant_id join ad_products pr on pr.code = a.product_code
      where m.owner_id = auth.uid()), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'name', name, 'description', description, 'unit', unit,
        'price', price, 'placement', placement) order by price) from ad_products where active and unit <> 'per_order'), '[]'::jsonb),
    'balance', coalesce((select balance from wallets where user_id = auth.uid()), 0));
$$;
revoke all on function public.merchant_my_ads() from public, anon;
grant execute on function public.merchant_my_ads() to authenticated;

-- ---------------------------------------------------------------------
-- 6. Jadwal kedaluwarsa iklan
-- ---------------------------------------------------------------------
do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'antarkita_expire_merchant_ads';
  perform cron.schedule('antarkita_expire_merchant_ads', '7 * * * *', $c$select public.expire_merchant_ads();$c$);
exception when others then
  raise notice '0101: pg_cron tidak tersedia (%) — jadwalkan expire_merchant_ads() secara manual', sqlerrm;
end $$;

-- ---------------------------------------------------------------------
-- 7. nearby_merchants_v2 — kolom boosted/featured + label "Iklan"; boosted di atas
--    (badan disalin dari nearby_merchants 0028/0087 terkini; nearby_merchants lama tetap apa adanya)
-- ---------------------------------------------------------------------
create or replace function public.nearby_merchants_v2(p_lat double precision, p_lng double precision, p_radius_km numeric default 15,
  p_q text default null, p_halal boolean default null)
returns table(id uuid, name text, description text, category text, address text, image_url text, is_open boolean, rating_avg numeric,
  rating_count integer, prep_minutes integer, lat double precision, lng double precision, distance_km numeric, delivery_fee bigint,
  is_halal boolean, halal_verified boolean, boosted boolean, featured boolean, ad_label text)
language sql stable security definer set search_path = public as $$
  with base as (
    select m.id, m.name, m.description, m.category, m.address, m.image_url, m.is_open, m.rating_avg, m.rating_count, m.prep_minutes,
      m.lat, m.lng,
      round((st_distance(m.location, st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography) / 1000.0)::numeric, 2) as distance_km,
      (select fare from calc_fare('food'::service_type, (greatest(0.5, st_distance(m.location, st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography) / 1000.0 * 1.3))::numeric)) as delivery_fee,
      m.is_halal, m.halal_verified,
      exists (select 1 from merchant_ads a join ad_products pr on pr.code = a.product_code
               where a.merchant_id = m.id and a.status = 'active' and now() >= a.starts_at and now() < a.ends_at and pr.placement = 'boost_nearby') as boosted,
      exists (select 1 from merchant_ads a join ad_products pr on pr.code = a.product_code
               where a.merchant_id = m.id and a.status = 'active' and now() >= a.starts_at and now() < a.ends_at and pr.placement = 'featured_home') as featured
    from merchants m
    where m.status = 'approved' and m.location is not null
      and st_dwithin(m.location, st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography, p_radius_km * 1000)
      and (p_halal is null or m.is_halal = p_halal)
      and (p_q is null or p_q = '' or m.name ilike '%' || p_q || '%' or m.category ilike '%' || p_q || '%'
           or exists (select 1 from menu_items mi where mi.merchant_id = m.id and mi.name ilike '%' || p_q || '%'))
  )
  select b.*, case when b.boosted or b.featured then 'Iklan' end as ad_label
  from base b
  order by b.boosted desc, b.distance_km limit 50
$$;
revoke all on function public.nearby_merchants_v2(double precision, double precision, numeric, text, boolean) from public;
grant execute on function public.nearby_merchants_v2(double precision, double precision, numeric, text, boolean) to anon, authenticated;
comment on function public.nearby_merchants_v2(double precision, double precision, numeric, text, boolean) is
  'Sama dengan nearby_merchants + boosted (iklan boost_nearby tayang) / featured (featured_home) / ad_label ''Iklan''; merchant boosted diurutkan di atas (0101). Klien WAJIB menampilkan ad_label (transparansi §9).';

-- ---------------------------------------------------------------------
-- 8. Penjaga migrasi
-- ---------------------------------------------------------------------
do $$
begin
  if (select count(*) from ad_products where code in ('featured_home','boost_nearby','banner_category')) <> 3 then raise exception '0101 batal: produk iklan awal belum lengkap'; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.merchant_ads'::regclass) or not (select relrowsecurity from pg_class where oid = 'public.ad_products'::regclass) then
    raise exception '0101 batal: RLS iklan belum aktif';
  end if;
  if has_table_privilege('authenticated', 'public.merchant_ads', 'INSERT') or has_table_privilege('authenticated', 'public.merchant_ads', 'TRUNCATE')
     or has_table_privilege('authenticated', 'public.ad_products', 'UPDATE') or has_table_privilege('anon', 'public.merchant_ads', 'SELECT') then
    raise exception '0101 batal: hak tulis klien pada tabel iklan masih ada';
  end if;
  if has_function_privilege('authenticated', 'public.ledger_post_ads(uuid)', 'EXECUTE') then raise exception '0101 batal: ledger_post_ads terbuka untuk klien'; end if;
  if has_function_privilege('anon', 'public.merchant_ad_request(text,integer,uuid)', 'EXECUTE') then raise exception '0101 batal: merchant_ad_request terbuka untuk anon'; end if;
  if not has_function_privilege('anon', 'public.nearby_merchants_v2(double precision,double precision,numeric,text,boolean)', 'EXECUTE') then
    raise exception '0101 batal: nearby_merchants_v2 harus bisa dipanggil anon (beranda tanpa login)';
  end if;
  if (ad_price('boost_nearby', 3)->>'price')::bigint <> 45000 or (ad_price('banner_category', 10)->>'price')::bigint <> 100000 then
    raise exception '0101 batal: perhitungan harga iklan salah';
  end if;
  raise notice '0101 ok: % produk iklan, merchant_ads + RLS, nearby_merchants_v2 (boosted di atas, label Iklan)', (select count(*) from ad_products);
end $$;
