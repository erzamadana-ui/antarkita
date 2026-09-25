-- =====================================================================
-- 0098 — ATURAN BISNIS PER LAYANAN (`service_economics`) — Skema Bisnis v2
--
-- Sumber: docs/SKEMA-BISNIS-V2-SPEK.md §0, §1 (keputusan 23 Sep 2026).
--
-- Satu tabel menjadi sumber kebenaran aturan uang per layanan, menggantikan
-- `pricing.commission_pct` / `pricing.merchant_commission_pct` / `pricing.platform_fee`
-- (nilai lama disalin ke kolom `notes` untuk jejak; kolom pricing TIDAK dihapus,
-- hanya berhenti dibaca oleh create_order sejak 0099).
--
--   • driver_commission_pct   : potongan platform dari ongkir/tarif jasa driver
--                               (ride_motor ≤ commission_cap_two_wheel, pagar 0031 — trigger diperluas ke tabel ini)
--   • merchant_fee_pct        : fee platform dari nilai barang merchant/vendor
--   • customer_platform_fee   : biaya platform pelanggan (nominal/order, tampil terpisah)
--   • service_fee_pct/min     : shop/market — jasa belanja dari subtotal
--   • service_fee_driver_share_pct : porsi driver dari jasa belanja
--   • pg_fee_policy           : siapa menanggung biaya payment gateway ('platform'|'customer')
--   • promo_default_funded_by : pemilik biaya promo bila promo tidak menyebut ('platform'|'merchant'|'sponsor')
--
-- Prinsip §0.1: ongkir adalah hak driver → food/send/shop/market driver_commission_pct = 0.
-- Label angka di `notes`: [FAKTA SUMBER] / [ASUMSI] (wajib bisa diubah admin, dengan PIN + audit).
--
-- Isi:
--   1. Tabel service_economics + RLS (admin baca/tulis langsung; klien lewat RPC)
--   2. Nilai awal (on conflict do nothing) + jejak nilai lama pricing di notes
--   3. Pagar komisi roda dua (0031) diperluas ke service_economics
--   4. app_settings.driver_debt_limit (batas saldo minus driver, default -500000)
--   5. RPC admin_set_service_economics(service, patch jsonb)  — is_admin + admin_require_unlock + validasi + log_activity
--   6. RPC service_economics_public(service)                 — untuk klien (anon, authenticated)
--   7. Penjaga migrasi
-- Semua blok idempoten (aman dijalankan ulang).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Tabel
-- ---------------------------------------------------------------------
create table if not exists public.service_economics (
  service                       service_type primary key,
  driver_commission_pct         numeric(5,2) not null default 0 check (driver_commission_pct between 0 and 100),
  merchant_fee_pct              numeric(5,2) not null default 0 check (merchant_fee_pct between 0 and 100),
  customer_platform_fee         bigint       not null default 0 check (customer_platform_fee >= 0),
  service_fee_pct               numeric(5,2) not null default 0 check (service_fee_pct between 0 and 100),
  service_fee_min               bigint       not null default 0 check (service_fee_min >= 0),
  service_fee_driver_share_pct  numeric(5,2) not null default 0 check (service_fee_driver_share_pct between 0 and 100),
  pg_fee_policy                 text not null default 'platform' check (pg_fee_policy in ('platform','customer')),
  promo_default_funded_by       text not null default 'platform' check (promo_default_funded_by in ('platform','merchant','sponsor')),
  notes       text,
  updated_at  timestamptz default now(),
  updated_by  uuid
);
comment on table public.service_economics is
  'Skema Bisnis v2 (0098): aturan uang per layanan — satu sumber kebenaran (menggantikan pricing.commission_pct/merchant_commission_pct/platform_fee). Diubah hanya lewat admin_set_service_economics (PIN + audit).';
comment on column public.service_economics.driver_commission_pct is 'Potongan platform dari ongkir/tarif jasa driver (%). ride_motor dibatasi commission_cap_two_wheel (0031). food/send/shop/market = 0: ongkir hak driver.';
comment on column public.service_economics.merchant_fee_pct is 'Fee platform dari nilai barang merchant/vendor (%). travel: fee mitra travel.';
comment on column public.service_economics.customer_platform_fee is 'Biaya platform pelanggan per order (Rp), tampil terpisah di checkout.';
comment on column public.service_economics.pg_fee_policy is 'Siapa menanggung biaya payment gateway: platform (dipotong dari pendapatan platform) atau customer (ditambahkan ke total sebagai "Biaya pembayaran").';
comment on column public.service_economics.promo_default_funded_by is 'Pemilik biaya promo bila promos.funded_by kosong: platform | merchant | sponsor.';

alter table public.service_economics enable row level security;
drop policy if exists service_economics_admin on public.service_economics;
create policy service_economics_admin on public.service_economics
  for all to authenticated using (is_admin()) with check (is_admin());
-- pembacaan non-admin hanya lewat service_economics_public() (security definer)
-- default privileges Supabase memberi anon/authenticated ALL (termasuk TRUNCATE yang tidak tunduk RLS) → cabut dulu.
-- authenticated: SELECT/INSERT/UPDATE (RLS membatasi ke admin; pagar roda dua tetap lewat trigger); tanpa DELETE/TRUNCATE.
revoke all on public.service_economics from public, anon, authenticated;
grant select, update on public.service_economics to authenticated;
grant all on public.service_economics to service_role;

-- audit perubahan langsung (bila trigger audit generik tersedia)
do $$
begin
  if to_regprocedure('public.audit_trigger()') is not null then
    if not exists (select 1 from pg_trigger where tgname = 't_audit_service_economics' and tgrelid = 'public.service_economics'::regclass) then
      create trigger t_audit_service_economics after insert or delete or update on public.service_economics
        for each row execute function audit_trigger();
    end if;
  end if;
  if to_regprocedure('public.set_updated_at()') is not null then
    if not exists (select 1 from pg_trigger where tgname = 't_service_economics_upd' and tgrelid = 'public.service_economics'::regclass) then
      create trigger t_service_economics_upd before update on public.service_economics
        for each row execute function set_updated_at();
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2. Nilai awal (spec §1) — tidak menimpa nilai yang sudah diatur admin
-- ---------------------------------------------------------------------
do $$
declare
  -- jejak nilai lama pricing per layanan (dicatat di notes agar bisa ditelusuri)
  jejak text;
  v_cap numeric := coalesce((select (value #>> '{}')::numeric from app_settings where key = 'commission_cap_two_wheel'), 8);
  r record;
begin
  for r in
    select * from (values
      ('ride_motor'::service_type, least(8, v_cap)::numeric, 0::numeric, 1000::bigint, 0::numeric, 0::bigint, 0::numeric,
        '[FAKTA SUMBER] komisi 8 % = batas regulasi roda dua (pagar 0031, porsi driver ≥ 92 %); [ASUMSI] biaya platform Rp1.000 (= pricing.platform_fee lama)'),
      ('ride_car',   15, 0, 4000, 0, 0, 0,
        '[ASUMSI] komisi 15 % (roda empat tidak diatur cap 8 %); [ASUMSI] biaya platform Rp4.000 (= pricing.platform_fee lama)'),
      ('food',        0, 15, 2000, 0, 0, 0,
        '[FAKTA SUMBER] ongkir hak driver (komisi 0); [FAKTA kode] fee merchant 15 % = pricing.merchant_commission_pct lama; [ASUMSI] biaya platform Rp2.000'),
      ('send',        0, 0, 3000, 0, 0, 0,
        '[FAKTA SUMBER] ongkir hak driver (komisi 0); [ASUMSI] pendapatan platform = biaya platform Rp3.000 saja'),
      ('shop',        0, 0, 1000, 5, 5000, 70,
        '[FAKTA SUMBER] ongkir hak driver (komisi 0); [FAKTA kode] jasa belanja 5 % / min Rp5.000 / driver 70 % = nilai 0013 (shop_service_pct/min, shop_driver_share_pct); [ASUMSI] biaya platform Rp1.000'),
      ('market',      0, 0, 1000, 10, 8000, 70,
        '[FAKTA SUMBER] ongkir hak driver (komisi 0); [FAKTA kode] jasa belanja 10 % / min Rp8.000 / driver 70 % = nilai 0013 (market_service_pct/min, market_driver_share_pct); [ASUMSI] biaya platform Rp1.000'),
      ('box',        10, 0, 2000, 0, 0, 0,
        '[ASUMSI] komisi 10 % (kargo, bukan penumpang — tidak tunduk cap roda dua); [ASUMSI] biaya platform Rp2.000 (= pricing.platform_fee lama)'),
      ('travel',      0, 10, 5000, 0, 0, 0,
        '[FAKTA kode] fee mitra travel 10 % = travel_commission_pct / travel_request_commission_pct lama; biaya platform Rp5.000 = travel_platform_fee lama; titipan antar kota: porsi mitra 80 % tetap (travel_send_partner_pct)')
    ) as t(service, dc, mf, pf, sp, sm, ds, catatan)
  loop
    select format('nilai lama pricing: commission_pct=%s merchant_commission_pct=%s platform_fee=%s',
                  p.commission_pct, p.merchant_commission_pct, p.platform_fee)
      into jejak from pricing p where p.service = r.service;
    insert into service_economics (service, driver_commission_pct, merchant_fee_pct, customer_platform_fee,
      service_fee_pct, service_fee_min, service_fee_driver_share_pct, pg_fee_policy, promo_default_funded_by, notes)
    values (r.service, r.dc, r.mf, r.pf, r.sp, r.sm, r.ds, 'platform', 'platform',
      r.catatan || coalesce(' · ' || jejak, ' · (tidak ada baris pricing)'))
    on conflict (service) do nothing;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 3. Pagar komisi roda dua (0031) diperluas ke service_economics
-- ---------------------------------------------------------------------
create or replace function public.guard_commission_cap_economics()
returns trigger language plpgsql set search_path = public as $$
declare v_cap numeric := commission_cap_two_wheel();
begin
  if new.service::text = any (two_wheel_services()) and new.driver_commission_pct > v_cap then
    raise exception 'Komisi layanan % dibatasi maksimal %%% (angkutan sepeda motor berbasis aplikasi, commission_cap_two_wheel). Nilai % ditolak.',
      new.service, v_cap, new.driver_commission_pct;
  end if;
  return new;
end $$;
drop trigger if exists t_guard_commission_cap on public.service_economics;
create trigger t_guard_commission_cap before insert or update of driver_commission_pct on public.service_economics
  for each row execute function guard_commission_cap_economics();

-- Turunkan yang sudah terlanjur di atas batas (bila tabel sudah ada sebelum pagar terpasang)
update service_economics set driver_commission_pct = commission_cap_two_wheel()
 where service::text = any (two_wheel_services()) and driver_commission_pct > commission_cap_two_wheel();

-- ---------------------------------------------------------------------
-- 4. Batas saldo minus driver (sebelumnya hard-code -500000 di 0007/0009)
-- ---------------------------------------------------------------------
insert into app_settings (key, value) values ('driver_debt_limit', '-500000'::jsonb)
  on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 5. RPC admin: ubah aturan satu layanan (PIN + audit sebelum/sesudah)
-- ---------------------------------------------------------------------
create or replace function public.admin_set_service_economics(p_service service_type, p_patch jsonb)
returns service_economics
language plpgsql security definer set search_path = public as $$
declare
  b service_economics;           -- sebelum
  a service_economics;           -- sesudah
  k text;
  allowed constant text[] := array['driver_commission_pct','merchant_fee_pct','customer_platform_fee',
    'service_fee_pct','service_fee_min','service_fee_driver_share_pct','pg_fee_policy','promo_default_funded_by','notes'];
  v_cap numeric := commission_cap_two_wheel();
  ringkas text := '';
begin
  if not is_admin() then raise exception 'Hanya admin'; end if;
  perform admin_require_unlock();
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception 'Patch kosong: kirim objek {kolom: nilai}';
  end if;
  for k in select jsonb_object_keys(p_patch) loop
    if not (k = any (allowed)) then raise exception 'Kolom tidak dikenal: %', k; end if;
  end loop;

  select * into b from service_economics where service = p_service for update;
  if not found then
    insert into service_economics (service) values (p_service) returning * into b;
  end if;
  a := b;

  if p_patch ? 'driver_commission_pct' then a.driver_commission_pct := (p_patch->>'driver_commission_pct')::numeric; end if;
  if p_patch ? 'merchant_fee_pct' then a.merchant_fee_pct := (p_patch->>'merchant_fee_pct')::numeric; end if;
  if p_patch ? 'customer_platform_fee' then a.customer_platform_fee := (p_patch->>'customer_platform_fee')::bigint; end if;
  if p_patch ? 'service_fee_pct' then a.service_fee_pct := (p_patch->>'service_fee_pct')::numeric; end if;
  if p_patch ? 'service_fee_min' then a.service_fee_min := (p_patch->>'service_fee_min')::bigint; end if;
  if p_patch ? 'service_fee_driver_share_pct' then a.service_fee_driver_share_pct := (p_patch->>'service_fee_driver_share_pct')::numeric; end if;
  if p_patch ? 'pg_fee_policy' then a.pg_fee_policy := lower(trim(p_patch->>'pg_fee_policy')); end if;
  if p_patch ? 'promo_default_funded_by' then a.promo_default_funded_by := lower(trim(p_patch->>'promo_default_funded_by')); end if;
  if p_patch ? 'notes' then a.notes := p_patch->>'notes'; end if;

  -- validasi rentang (pesan jelas sebelum constraint tabel)
  if a.driver_commission_pct is null or a.driver_commission_pct < 0 or a.driver_commission_pct > 100 then raise exception 'driver_commission_pct harus 0–100'; end if;
  if a.merchant_fee_pct is null or a.merchant_fee_pct < 0 or a.merchant_fee_pct > 100 then raise exception 'merchant_fee_pct harus 0–100'; end if;
  if a.service_fee_pct is null or a.service_fee_pct < 0 or a.service_fee_pct > 100 then raise exception 'service_fee_pct harus 0–100'; end if;
  if a.service_fee_driver_share_pct is null or a.service_fee_driver_share_pct < 0 or a.service_fee_driver_share_pct > 100 then raise exception 'service_fee_driver_share_pct harus 0–100'; end if;
  if a.customer_platform_fee is null or a.customer_platform_fee < 0 then raise exception 'customer_platform_fee harus ≥ 0'; end if;
  if a.service_fee_min is null or a.service_fee_min < 0 then raise exception 'service_fee_min harus ≥ 0'; end if;
  if a.pg_fee_policy not in ('platform','customer') then raise exception 'pg_fee_policy harus platform|customer'; end if;
  if a.promo_default_funded_by not in ('platform','merchant','sponsor') then raise exception 'promo_default_funded_by harus platform|merchant|sponsor'; end if;
  if p_service::text = any (two_wheel_services()) and a.driver_commission_pct > v_cap then
    raise exception 'Komisi % dibatasi maksimal %%% (commission_cap_two_wheel). Nilai % ditolak.', p_service, v_cap, a.driver_commission_pct;
  end if;

  update service_economics set
    driver_commission_pct = a.driver_commission_pct, merchant_fee_pct = a.merchant_fee_pct,
    customer_platform_fee = a.customer_platform_fee, service_fee_pct = a.service_fee_pct,
    service_fee_min = a.service_fee_min, service_fee_driver_share_pct = a.service_fee_driver_share_pct,
    pg_fee_policy = a.pg_fee_policy, promo_default_funded_by = a.promo_default_funded_by,
    notes = a.notes, updated_at = now(), updated_by = auth.uid()
  where service = p_service returning * into a;

  -- ringkasan lama→baru hanya untuk kolom yang berubah
  select string_agg(format('%s: %s → %s', x.key, x.lama, x.baru), ', ') into ringkas
  from (
    select key, bj.value #>> '{}' as lama, aj.value #>> '{}' as baru
    from jsonb_each(to_jsonb(b)) bj(key, value) join jsonb_each(to_jsonb(a)) aj using (key)
    where key = any (allowed) and bj.value is distinct from aj.value
  ) x;

  perform log_activity('economics.updated', 'service_economics', p_service::text,
    'Aturan bisnis ' || p_service::text || ' diubah: ' || coalesce(ringkas, '(tidak ada perubahan nilai)'),
    jsonb_build_object('before', to_jsonb(b), 'after', to_jsonb(a), 'patch', p_patch));
  return a;
end $$;
revoke all on function public.admin_set_service_economics(service_type, jsonb) from public, anon;
grant execute on function public.admin_set_service_economics(service_type, jsonb) to authenticated;
comment on function public.admin_set_service_economics(service_type, jsonb) is
  'Panel Admin → Aturan Bisnis (0098): ubah aturan uang satu layanan. Butuh is_admin() + admin_require_unlock(); validasi rentang + pagar roda dua; log_activity economics.updated {before, after}.';

-- Pembacaan lengkap untuk Panel Admin (semua layanan)
create or replace function public.admin_service_economics()
returns setof service_economics
language sql stable security definer set search_path = public as $$
  select * from service_economics where is_admin() order by service;
$$;
revoke all on function public.admin_service_economics() from public, anon;
grant execute on function public.admin_service_economics() to authenticated;

-- ---------------------------------------------------------------------
-- 6. RPC baca untuk klien (rincian transparan di checkout / pendapatan mitra)
-- ---------------------------------------------------------------------
create or replace function public.service_economics_public(p_service service_type)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'service', p_service,
    'customer_platform_fee', coalesce(e.customer_platform_fee, p.platform_fee, 0),
    'service_fee_pct', coalesce(e.service_fee_pct, 0),
    'service_fee_min', coalesce(e.service_fee_min, 0),
    'driver_commission_pct', coalesce(e.driver_commission_pct, 0))
  from (select 1) x
  left join service_economics e on e.service = p_service
  left join pricing p on p.service = p_service;
$$;
grant execute on function public.service_economics_public(service_type) to anon, authenticated;
comment on function public.service_economics_public(service_type) is
  'Rincian aturan bisnis yang boleh dilihat klien (0098): biaya platform pelanggan, jasa belanja, komisi driver. Tidak membuka pg_fee_policy/merchant_fee_pct.';

-- ---------------------------------------------------------------------
-- 7. Penjaga migrasi
-- ---------------------------------------------------------------------
do $$
declare n int; v numeric;
begin
  select count(*) into n from service_economics;
  if n < 8 then raise exception '0098 batal: baru % dari 8 baris service_economics', n; end if;
  select driver_commission_pct into v from service_economics where service = 'ride_motor';
  if v > commission_cap_two_wheel() then raise exception '0098 batal: komisi ride_motor % > cap %', v, commission_cap_two_wheel(); end if;
  if not exists (select 1 from pg_trigger where tgname = 't_guard_commission_cap' and tgrelid = 'public.service_economics'::regclass) then
    raise exception '0098 batal: pagar komisi roda dua belum terpasang di service_economics';
  end if;
  if not exists (select 1 from app_settings where key = 'driver_debt_limit') then
    raise exception '0098 batal: app_settings.driver_debt_limit belum ada';
  end if;
  -- pagar harus benar-benar menolak
  begin
    update service_economics set driver_commission_pct = commission_cap_two_wheel() + 1 where service = 'ride_motor';
    raise exception '0098 batal: pagar komisi roda dua tidak menolak nilai di atas cap';
  exception when others then
    if sqlerrm like '0098 batal%' then raise; end if;
  end;
  if not has_function_privilege('anon', 'public.service_economics_public(service_type)', 'EXECUTE') then
    raise exception '0098 batal: service_economics_public belum boleh dipanggil anon';
  end if;
  raise notice '0098 ok: service_economics % baris, pagar roda dua aktif, driver_debt_limit=%', n,
    (select value from app_settings where key = 'driver_debt_limit');
end $$;
