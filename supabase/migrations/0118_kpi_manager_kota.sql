-- =====================================================================
-- 0118 — KPI Manager Kota (Perwakilan Kota: cities.manager_id → profiles, RPC 0079)
--   Keputusan GM 29 Okt 2026: tugas Manager Kota = mencari kerja sama merchant & driver; KPI dipakai untuk
--   penilaian kinerja & komponen gaji (bonus_pool × skor).
--   • Tabel city_manager_kpi_targets (target + bobot + bonus_pool per kota per bulan; PK (city_id, month)).
--   • Realisasi per kota per bulan:
--       merchant_new    = merchants status approved dengan created_at di bulan itu, kota = entity_city(location)
--                         [ASUMSI: merchants tidak punya approved_at → created_at dipakai sebagai tanggal bergabung]
--       driver_new      = drivers status approved dengan created_at di bulan itu, kota = entity_city(location)
--       merchant_active = merchant dengan ≥1 order completed bulan itu (orders.city_id)
--       driver_active   = driver dengan ≥1 order completed bulan itu (orders.city_id)
--       orders          = order completed bulan itu di kota (orders.city_id; diisi trigger set_order_city dari pickup)
--   • Skor: pct_i = min(120, realisasi/target×100); komponen bertarget 0 dilewati (bobot dinormalisasi ulang);
--     komponen "active" = rata-rata pct merchant_active & driver_active (yang bertarget); score = Σ bobot×pct / Σ bobot;
--     grade A ≥100, B ≥80, C ≥60, D <60; bonus_earned = bonus_pool × min(score,120)/100 bila score ≥ 60, selain itu 0
--     [ASUMSI skema bonus — tandai untuk keputusan GM].
--   • entity_city(geography): kota aktif terdekat dalam radius_km kota itu [ASUMSI: merchants/drivers tidak punya city_id].
--   • Kota yang ikut dinilai: cities.active dan (service_status='aktif' atau punya manager_id atau punya target bulan itu)
--     [ASUMSI: 511 kabupaten OSM berstatus 'segera' tidak dinilai sampai punya target/manager].
--   • RPC: admin_set_city_manager_kpi(jsonb), admin_city_manager_kpi(date,uuid), city_manager_kpi_mine(date),
--          exec_city_manager_kpi(text,date), city_manager_kpi_summary(date). Setelan kpi_bonus_default_pool (1.000.000 [ASUMSI]).
-- Idempoten. Rollback: supabase/rollback/0118_down.sql
-- =====================================================================
do $$
declare s text;
begin
  foreach s in array array[
    'public.app_setting_specs()',                                    -- diubah
    'public.entity_city(geography)', 'public.city_manager_kpi_calc(date,uuid)', 'public.admin_set_city_manager_kpi(jsonb)',
    'public.admin_city_manager_kpi(date,uuid)', 'public.city_manager_kpi_mine(date)', 'public.exec_city_manager_kpi(text,date)',
    'public.city_manager_kpi_summary(date)'] loop                    -- baru (NULL → dihapus saat rollback)
    perform _mig_backup('0118', s);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 1. Tabel target
-- ---------------------------------------------------------------------
create table if not exists public.city_manager_kpi_targets (
  city_id                uuid not null references public.cities(id) on delete cascade,
  month                  date not null check (extract(day from month) = 1),
  target_merchant_new    int not null default 0 check (target_merchant_new >= 0),
  target_driver_new      int not null default 0 check (target_driver_new >= 0),
  target_merchant_active int not null default 0 check (target_merchant_active >= 0),
  target_driver_active   int not null default 0 check (target_driver_active >= 0),
  target_orders          int not null default 0 check (target_orders >= 0),
  weight_merchant_new    int not null default 30 check (weight_merchant_new between 0 and 100),
  weight_driver_new      int not null default 30 check (weight_driver_new between 0 and 100),
  weight_active          int not null default 20 check (weight_active between 0 and 100),
  weight_orders          int not null default 20 check (weight_orders between 0 and 100),
  bonus_pool             bigint not null default 0 check (bonus_pool >= 0),
  note                   text,
  updated_by             uuid references public.profiles(id),
  updated_at             timestamptz not null default now(),
  primary key (city_id, month),
  constraint city_manager_kpi_weights_100 check (weight_merchant_new + weight_driver_new + weight_active + weight_orders = 100)
);
comment on table public.city_manager_kpi_targets is '0118: target KPI bulanan Manager Kota (merchant/driver baru & aktif, order) + bobot (Σ=100) + pool bonus. Ditulis hanya lewat admin_set_city_manager_kpi.';
alter table public.city_manager_kpi_targets enable row level security;
revoke all on public.city_manager_kpi_targets from public, anon, authenticated;
grant all on public.city_manager_kpi_targets to service_role;

insert into app_settings (key, value) values ('kpi_bonus_default_pool', '1000000'::jsonb) on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 2. Pemetaan entitas → kota
-- ---------------------------------------------------------------------
create or replace function public.entity_city(p_loc geography)
returns uuid language sql stable security definer set search_path = public as $$
  select c.id from cities c
   where c.active and c.location is not null and p_loc is not null
     and st_dwithin(c.location, p_loc, c.radius_km * 1000)
   order by st_distance(c.location, p_loc) limit 1;
$$;
revoke all on function public.entity_city(geography) from public, anon;
grant execute on function public.entity_city(geography) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Inti perhitungan (internal; tanpa pemeriksaan hak — pembungkusnya yang memeriksa)
-- ---------------------------------------------------------------------
create or replace function public.city_manager_kpi_calc(p_month date default null, p_city uuid default null)
returns setof jsonb language plpgsql stable security definer set search_path = public as $$
declare v_month date := date_trunc('month', coalesce(p_month, now()))::date; v_end timestamptz;
begin
  v_end := (v_month + interval '1 month')::timestamptz;
  return query
  with kota as (
    select c.id, c.name, c.manager_id, pr.full_name as manager_name
      from cities c left join profiles pr on pr.id = c.manager_id
     where c.active and (p_city is null or c.id = p_city)
       and (c.service_status = 'aktif' or c.manager_id is not null
            or exists (select 1 from city_manager_kpi_targets t where t.city_id = c.id and t.month = v_month))
  ), mnew as (
    select x.city_id, count(*) as n from (
      select entity_city(m.location) as city_id from merchants m
       where m.status = 'approved' and m.location is not null and m.created_at >= v_month and m.created_at < v_end) x
     where x.city_id is not null group by x.city_id
  ), dnew as (
    select x.city_id, count(*) as n from (
      select entity_city(d.location) as city_id from drivers d
       where d.status = 'approved' and d.location is not null and d.created_at >= v_month and d.created_at < v_end) x
     where x.city_id is not null group by x.city_id
  ), od as (
    select o.city_id, count(*) as orders,
           count(distinct o.merchant_id) filter (where o.merchant_id is not null) as merchants_active,
           count(distinct o.driver_id) filter (where o.driver_id is not null) as drivers_active
      from orders o
     where o.status::text = 'completed' and o.city_id is not null
       and coalesce(o.completed_at, o.updated_at, o.created_at) >= v_month and coalesce(o.completed_at, o.updated_at, o.created_at) < v_end
     group by o.city_id
  ), base as (
    select k.id, k.name, k.manager_id, k.manager_name, t.*, t.city_id is not null as has_target,
           coalesce(mn.n, 0)::int as a_mnew, coalesce(dn.n, 0)::int as a_dnew,
           coalesce(o.merchants_active, 0)::int as a_mact, coalesce(o.drivers_active, 0)::int as a_dact, coalesce(o.orders, 0)::int as a_orders
      from kota k
      left join city_manager_kpi_targets t on t.city_id = k.id and t.month = v_month
      left join mnew mn on mn.city_id = k.id
      left join dnew dn on dn.city_id = k.id
      left join od o on o.city_id = k.id
  ), pct as (
    select b.*,
      case when b.target_merchant_new    > 0 then least(120, round(b.a_mnew   * 100.0 / b.target_merchant_new, 1))    end as p_mnew,
      case when b.target_driver_new      > 0 then least(120, round(b.a_dnew   * 100.0 / b.target_driver_new, 1))      end as p_dnew,
      case when b.target_merchant_active > 0 then least(120, round(b.a_mact   * 100.0 / b.target_merchant_active, 1)) end as p_mact,
      case when b.target_driver_active   > 0 then least(120, round(b.a_dact   * 100.0 / b.target_driver_active, 1))   end as p_dact,
      case when b.target_orders          > 0 then least(120, round(b.a_orders * 100.0 / b.target_orders, 1))          end as p_orders
      from base b
  ), sc as (
    select p.*,
      case when p.p_mact is null and p.p_dact is null then null
           else round((coalesce(p.p_mact, 0) + coalesce(p.p_dact, 0)) / ((p.p_mact is not null)::int + (p.p_dact is not null)::int), 1) end as p_active,
      (case when p.p_mnew is not null then p.weight_merchant_new else 0 end
       + case when p.p_dnew is not null then p.weight_driver_new else 0 end
       + case when p.p_mact is not null or p.p_dact is not null then p.weight_active else 0 end
       + case when p.p_orders is not null then p.weight_orders else 0 end) as w_sum
      from pct p
  ), fin as (
    select s.*,
      case when not s.has_target or coalesce(s.w_sum, 0) = 0 then null
           else round((coalesce(s.p_mnew, 0) * s.weight_merchant_new + coalesce(s.p_dnew, 0) * s.weight_driver_new
                       + coalesce(s.p_active, 0) * s.weight_active + coalesce(s.p_orders, 0) * s.weight_orders) / s.w_sum, 1) end as score
      from sc s
  )
  select jsonb_build_object(
    'city_id', f.id, 'city_name', f.name, 'manager_id', f.manager_id, 'manager_name', f.manager_name,
    'month', v_month, 'has_target', f.has_target,
    'targets', jsonb_build_object('merchant_new', coalesce(f.target_merchant_new, 0), 'driver_new', coalesce(f.target_driver_new, 0),
                                  'merchant_active', coalesce(f.target_merchant_active, 0), 'driver_active', coalesce(f.target_driver_active, 0),
                                  'orders', coalesce(f.target_orders, 0)),
    'weights', jsonb_build_object('merchant_new', coalesce(f.weight_merchant_new, 30), 'driver_new', coalesce(f.weight_driver_new, 30),
                                  'active', coalesce(f.weight_active, 20), 'orders', coalesce(f.weight_orders, 20)),
    'actual',  jsonb_build_object('merchant_new', f.a_mnew, 'driver_new', f.a_dnew, 'merchant_active', f.a_mact, 'driver_active', f.a_dact, 'orders', f.a_orders),
    'pct',     jsonb_build_object('merchant_new', f.p_mnew, 'driver_new', f.p_dnew, 'merchant_active', f.p_mact, 'driver_active', f.p_dact,
                                  'active', f.p_active, 'orders', f.p_orders),
    'score', f.score,
    'grade', case when f.score is null then null when f.score >= 100 then 'A' when f.score >= 80 then 'B' when f.score >= 60 then 'C' else 'D' end,
    'bonus_pool', coalesce(f.bonus_pool, 0),
    'bonus_earned', case when f.score is null or f.score < 60 then 0 else round(coalesce(f.bonus_pool, 0) * least(f.score, 120) / 100.0)::bigint end,
    'note', f.note, 'updated_at', f.updated_at)
  from fin f
  order by (f.has_target) desc, f.score desc nulls last, f.name;
end $$;
revoke all on function public.city_manager_kpi_calc(date, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. RPC admin / manager / eksekutif / ringkasan
-- ---------------------------------------------------------------------
create or replace function public.admin_set_city_manager_kpi(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t city_manager_kpi_targets; b city_manager_kpi_targets; v_city uuid; v_month date; v_name text; v_pool bigint;
        w1 int; w2 int; w3 int; w4 int; r jsonb;
begin
  perform admin_require('city');
  perform admin_require_unlock();
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'Target KPI harus objek JSON'; end if;
  v_city := (p->>'city_id')::uuid; v_month := date_trunc('month', (p->>'month')::date)::date;
  if v_city is null or v_month is null then raise exception 'city_id dan month wajib diisi'; end if;
  select name into v_name from cities where id = v_city;
  if v_name is null then raise exception 'Kota tidak ditemukan'; end if;
  select * into b from city_manager_kpi_targets where city_id = v_city and month = v_month;
  w1 := coalesce((p->>'weight_merchant_new')::int, b.weight_merchant_new, 30);
  w2 := coalesce((p->>'weight_driver_new')::int, b.weight_driver_new, 30);
  w3 := coalesce((p->>'weight_active')::int, b.weight_active, 20);
  w4 := coalesce((p->>'weight_orders')::int, b.weight_orders, 20);
  if least(w1, w2, w3, w4) < 0 or w1 + w2 + w3 + w4 <> 100 then raise exception 'KPI_WEIGHTS: jumlah bobot harus 100 (sekarang %)', w1 + w2 + w3 + w4; end if;
  v_pool := coalesce((p->>'bonus_pool')::bigint, b.bonus_pool, greatest(0, setting_num('kpi_bonus_default_pool', 1000000))::bigint);
  if v_pool < 0 then raise exception 'bonus_pool tidak boleh negatif'; end if;
  if least(coalesce((p->>'target_merchant_new')::int, 0), coalesce((p->>'target_driver_new')::int, 0), coalesce((p->>'target_merchant_active')::int, 0),
           coalesce((p->>'target_driver_active')::int, 0), coalesce((p->>'target_orders')::int, 0)) < 0 then
    raise exception 'Target tidak boleh negatif';
  end if;
  insert into city_manager_kpi_targets (city_id, month, target_merchant_new, target_driver_new, target_merchant_active, target_driver_active, target_orders,
                                        weight_merchant_new, weight_driver_new, weight_active, weight_orders, bonus_pool, note, updated_by, updated_at)
  values (v_city, v_month, coalesce((p->>'target_merchant_new')::int, 0), coalesce((p->>'target_driver_new')::int, 0), coalesce((p->>'target_merchant_active')::int, 0),
          coalesce((p->>'target_driver_active')::int, 0), coalesce((p->>'target_orders')::int, 0), w1, w2, w3, w4, v_pool, nullif(btrim(p->>'note'), ''), auth.uid(), now())
  on conflict (city_id, month) do update set
    target_merchant_new    = coalesce((p->>'target_merchant_new')::int, city_manager_kpi_targets.target_merchant_new),
    target_driver_new      = coalesce((p->>'target_driver_new')::int, city_manager_kpi_targets.target_driver_new),
    target_merchant_active = coalesce((p->>'target_merchant_active')::int, city_manager_kpi_targets.target_merchant_active),
    target_driver_active   = coalesce((p->>'target_driver_active')::int, city_manager_kpi_targets.target_driver_active),
    target_orders          = coalesce((p->>'target_orders')::int, city_manager_kpi_targets.target_orders),
    weight_merchant_new = w1, weight_driver_new = w2, weight_active = w3, weight_orders = w4, bonus_pool = v_pool,
    note = coalesce(nullif(btrim(p->>'note'), ''), city_manager_kpi_targets.note), updated_by = auth.uid(), updated_at = now()
  returning * into t;
  perform log_activity('city_kpi.updated', 'city_manager_kpi_targets', v_city::text || ':' || to_char(v_month, 'YYYY-MM'),
    format('Target KPI Manager Kota %s %s: merchant baru %s, driver baru %s, aktif %s/%s, order %s, pool Rp%s', v_name, to_char(v_month, 'YYYY-MM'),
           t.target_merchant_new, t.target_driver_new, t.target_merchant_active, t.target_driver_active, t.target_orders, t.bonus_pool),
    jsonb_build_object('before', to_jsonb(b), 'after', to_jsonb(t)));
  select x into r from city_manager_kpi_calc(v_month, v_city) x limit 1;
  return coalesce(r, to_jsonb(t));
end $$;
revoke all on function public.admin_set_city_manager_kpi(jsonb) from public, anon;
grant execute on function public.admin_set_city_manager_kpi(jsonb) to authenticated;

create or replace function public.admin_city_manager_kpi(p_month date default null, p_city uuid default null)
returns setof jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform admin_require('view');
  return query select * from city_manager_kpi_calc(p_month, p_city);
end $$;
revoke all on function public.admin_city_manager_kpi(date, uuid) from public, anon;
grant execute on function public.admin_city_manager_kpi(date, uuid) to authenticated;

-- Manager Kota melihat kota yang ia pegang (bisa lebih dari satu)
create or replace function public.city_manager_kpi_mine(p_month date default null)
returns setof jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Harus login'; end if;
  return query
    select x from cities c, lateral city_manager_kpi_calc(p_month, c.id) x
     where c.manager_id = auth.uid() and c.active
     order by c.name;
end $$;
revoke all on function public.city_manager_kpi_mine(date) from public, anon;
grant execute on function public.city_manager_kpi_mine(date) to authenticated;

-- Portal Eksekutif (pola exec_valid 0103/0114)
create or replace function public.exec_city_manager_kpi(p_exec_token text, p_month date default null)
returns setof jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not coalesce(is_admin(), false) and (p_exec_token is null or (select user_id from exec_valid(p_exec_token)) is null) then
    raise exception 'Tidak berhak';
  end if;
  return query select * from city_manager_kpi_calc(p_month, null);
end $$;
revoke all on function public.exec_city_manager_kpi(text, date) from public, anon;
grant execute on function public.exec_city_manager_kpi(text, date) to authenticated;

create or replace function public.city_manager_kpi_summary(p_month date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_month date := date_trunc('month', coalesce(p_month, now()))::date; r jsonb;
begin
  if not coalesce(is_admin(), false) then raise exception 'Hanya admin'; end if;
  select jsonb_build_object(
    'month', v_month,
    'cities_total', count(*),
    'cities_with_target', count(*) filter (where (x->>'has_target')::boolean),
    'cities_with_manager', count(*) filter (where x->>'manager_id' is not null),
    'avg_score', round(avg((x->>'score')::numeric), 1),
    'grades', jsonb_build_object('A', count(*) filter (where x->>'grade' = 'A'), 'B', count(*) filter (where x->>'grade' = 'B'),
                                 'C', count(*) filter (where x->>'grade' = 'C'), 'D', count(*) filter (where x->>'grade' = 'D')),
    'total_bonus_pool', coalesce(sum((x->>'bonus_pool')::bigint), 0),
    'total_bonus_earned', coalesce(sum((x->>'bonus_earned')::bigint), 0),
    'actual', jsonb_build_object('merchant_new', coalesce(sum((x->'actual'->>'merchant_new')::int), 0), 'driver_new', coalesce(sum((x->'actual'->>'driver_new')::int), 0),
                                 'orders', coalesce(sum((x->'actual'->>'orders')::int), 0)))
    into r from city_manager_kpi_calc(v_month, null) x;
  return r;
end $$;
revoke all on function public.city_manager_kpi_summary(date) from public, anon;
grant execute on function public.city_manager_kpi_summary(date) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Spesifikasi setelan (Panel Admin › Pengaturan) — jangkar pada baris kode, bukan komentar (pola 0117)
-- ---------------------------------------------------------------------
select _v3_splice('0118', 'public.app_setting_specs()',
  $a$    ('voucher_min_nominal',        'int',     1000, 100000000, null, '20000', 'Rp', 'UANG', 'Nominal pembelian AntarVoucher minimum', 'payment_config'),$a$,
  $a$    ('kpi_bonus_default_pool',     'int',     0, 1000000000, null, '1000000', 'Rp', 'UANG', '0118: pool bonus bulanan default Manager Kota saat target dibuat [ASUMSI 1 jt]', 'city'),
    ('voucher_min_nominal',        'int',     1000, 100000000, null, '20000', 'Rp', 'UANG', 'Nominal pembelian AntarVoucher minimum', 'payment_config'),$a$,
  '0118: pool bonus');

-- ---------------------------------------------------------------------
-- 6. Penjaga
-- ---------------------------------------------------------------------
do $$
begin
  if to_regclass('public.city_manager_kpi_targets') is null then raise exception '0118 batal: tabel city_manager_kpi_targets belum ada'; end if;
  if to_regprocedure('public.city_manager_kpi_calc(date,uuid)') is null or to_regprocedure('public.admin_set_city_manager_kpi(jsonb)') is null
     or to_regprocedure('public.city_manager_kpi_mine(date)') is null or to_regprocedure('public.exec_city_manager_kpi(text,date)') is null
     or to_regprocedure('public.city_manager_kpi_summary(date)') is null or to_regprocedure('public.entity_city(geography)') is null then
    raise exception '0118 batal: fungsi KPI belum lengkap';
  end if;
  if not exists (select 1 from app_setting_specs() where key = 'kpi_bonus_default_pool') then raise exception '0118 batal: app_setting_specs belum memuat kpi_bonus_default_pool'; end if;
  perform 1 from city_manager_kpi_calc(date_trunc('month', now())::date, null) limit 1;   -- fungsi inti bisa dijalankan
  raise notice '0118 ok: KPI Manager Kota siap (kota dinilai sekarang: %)', (select count(*) from city_manager_kpi_calc(null, null));
end $$;
