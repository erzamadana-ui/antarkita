-- =====================================================================
-- 0125 — Manager Kota: data manager (tabel city_managers), template target KPI per tier, admin_kpi_apply_template
--   Keputusan GM 31 Okt 2026 (docs/KONTRAK-31OKT.md keputusan 2 & 9):
--   • city_managers (1 baris per kota): identitas kandidat/manager (full_name, phone, email), profile_id (akun app, boleh null saat
--     masih kandidat), salary_base default 15.000.000 (keputusan GM), start_date, status kandidat|aktif|nonaktif, tier 1–3, note.
--     Trigger city_managers_sync_city: profile_id terisi & status aktif → cities.manager_id = profile_id (KPI 0118 city_manager_kpi_mine
--     memakai cities.manager_id); status nonaktif / profile dilepas → cities.manager_id dikosongkan bila masih menunjuk profil itu.
--   • kpi_target_templates (tier 1–3 × month_no 1–6): target & bobot default + bonus_pool. ANGKA SEED = [ASUMSI] agen DB (ramp 6 bulan;
--     tier 1 bulan ke-6 ≈ 4.500 order/bulan ≈ 150/hari — agen SDM menghitung ulang target yang menutup gaji 15 jt dan memperbaruinya
--     lewat admin_set_kpi_target_template). Tier [ASUMSI]: 1 = kota besar (Pekanbaru, Padang, Batam), 2 = kota menengah (Dumai,
--     Bukittinggi), 3 = kabupaten/kota kecil.
--   • admin_kpi_apply_template(p_city, p_month): tier dari city_managers kota itu; month_no = bulan ke-n sejak start_date (atau bulan
--     pertama bila start_date kosong), dibatasi 1..6 (setelah bulan ke-6 memakai baris ke-6); menulis target lewat admin_set_city_manager_kpi
--     (validasi + audit 0118) → mengembalikan hasil kalkulasi KPI + {template:{tier,month_no}}.
--   • RPC: admin_city_managers(), admin_set_city_manager_profile(jsonb), admin_city_manager_delete(uuid), admin_kpi_target_templates(),
--     admin_set_kpi_target_template(jsonb), admin_kpi_apply_template(uuid,date). Izin 'city' (+ PIN untuk tulis). Setelan
--     city_manager_salary_default (15.000.000).
-- Idempoten. Rollback: supabase/rollback/0125_down.sql
-- =====================================================================
do $$
declare s text;
begin
  foreach s in array array[
    'public.app_setting_specs()',                                                                  -- diubah
    'public.city_managers_sync_city()', 'public.admin_city_managers()', 'public.admin_set_city_manager_profile(jsonb)',
    'public.admin_city_manager_delete(uuid)', 'public.admin_kpi_target_templates()', 'public.admin_set_kpi_target_template(jsonb)',
    'public.admin_kpi_apply_template(uuid,date)'] loop                                               -- baru
    perform _mig_backup('0125', s);
  end loop;
end $$;

insert into app_settings (key, value) values ('city_manager_salary_default', '15000000'::jsonb) on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 1. Tabel city_managers
-- ---------------------------------------------------------------------
create table if not exists public.city_managers (
  id           uuid primary key default gen_random_uuid(),
  city_id      uuid not null unique references public.cities(id) on delete cascade,
  full_name    text not null check (length(btrim(full_name)) >= 3),
  phone        text,
  email        text,
  profile_id   uuid references public.profiles(id) on delete set null,
  salary_base  bigint not null default 15000000 check (salary_base >= 0),
  start_date   date,
  status       text not null default 'kandidat' check (status in ('kandidat', 'aktif', 'nonaktif')),
  tier         int not null default 2 check (tier between 1 and 3),
  note         text,
  created_by   uuid references public.profiles(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists city_managers_profile_idx on public.city_managers (profile_id) where profile_id is not null;
comment on table public.city_managers is '0125: Manager Kota per kota (kandidat/aktif/nonaktif), gaji dasar default Rp15 jt (keputusan GM), tier 1–3 untuk template KPI. Ditulis lewat admin_set_city_manager_profile.';
alter table public.city_managers enable row level security;
drop policy if exists city_managers_admin on public.city_managers;
create policy city_managers_admin on public.city_managers for select to authenticated using (admin_has('view') or profile_id = auth.uid());
revoke all on public.city_managers from public, anon, authenticated;
grant select on public.city_managers to authenticated;
grant all on public.city_managers to service_role;

create or replace function public.city_managers_sync_city()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.profile_id is not null then update cities set manager_id = null where id = old.city_id and manager_id = old.profile_id; end if;
    return old;
  end if;
  new.updated_at := now();
  if new.profile_id is not null and new.status = 'aktif' then
    update cities set manager_id = new.profile_id where id = new.city_id and manager_id is distinct from new.profile_id;
  elsif tg_op = 'UPDATE' and old.profile_id is not null and (new.profile_id is distinct from old.profile_id or new.status <> 'aktif') then
    update cities set manager_id = null where id = new.city_id and manager_id = old.profile_id;
  elsif new.profile_id is not null and new.status <> 'aktif' then
    update cities set manager_id = null where id = new.city_id and manager_id = new.profile_id;
  end if;
  return new;
end $$;
drop trigger if exists t_city_managers_sync on public.city_managers;
create trigger t_city_managers_sync before insert or update or delete on public.city_managers for each row execute function city_managers_sync_city();

-- ---------------------------------------------------------------------
-- 2. Template target KPI per tier × bulan ke-n  [ASUMSI angka]
-- ---------------------------------------------------------------------
create table if not exists public.kpi_target_templates (
  tier                   int not null check (tier between 1 and 3),
  month_no               int not null check (month_no between 1 and 6),
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
  primary key (tier, month_no),
  constraint kpi_target_templates_weights_100 check (weight_merchant_new + weight_driver_new + weight_active + weight_orders = 100)
);
comment on table public.kpi_target_templates is '0125: template target KPI Manager Kota per tier (1–3) × bulan ke-1..6. Seed = [ASUMSI] agen DB; agen SDM memperbarui lewat admin_set_kpi_target_template.';
alter table public.kpi_target_templates enable row level security;
drop policy if exists kpi_target_templates_admin on public.kpi_target_templates;
create policy kpi_target_templates_admin on public.kpi_target_templates for select to authenticated using (admin_has('view'));
revoke all on public.kpi_target_templates from public, anon, authenticated;
grant select on public.kpi_target_templates to authenticated;
grant all on public.kpi_target_templates to service_role;

-- seed [ASUMSI]: tier 1 ramp 300→4.500 order/bulan; tier 2 = 60 %; tier 3 = 35 % (dibulatkan); bobot 30/30/20/20 (0118);
-- bulan 1–2 menekankan akuisisi (bobot baru 35/35/15/15), bulan 5–6 menekankan aktivitas & order (20/20/25/35)
insert into public.kpi_target_templates (tier, month_no, target_merchant_new, target_driver_new, target_merchant_active, target_driver_active, target_orders,
                                         weight_merchant_new, weight_driver_new, weight_active, weight_orders, bonus_pool, note)
select t.tier, m.month_no,
       ceil(m.mnew * t.f)::int, ceil(m.dnew * t.f)::int, ceil(m.mact * t.f)::int, ceil(m.dact * t.f)::int, ceil(m.orders * t.f)::int,
       m.w1, m.w2, m.w3, m.w4, t.pool, '[ASUMSI 0125] seed awal — agen SDM menghitung ulang agar kontribusi menutup gaji Rp15 jt'
  from (values (1, 1.00, 1500000::bigint), (2, 0.60, 1000000::bigint), (3, 0.35, 750000::bigint)) t(tier, f, pool)
  cross join (values
    (1, 20, 30,  15,  25,  300, 35, 35, 15, 15),
    (2, 25, 40,  35,  55,  900, 35, 35, 15, 15),
    (3, 30, 50,  60,  90, 1800, 30, 30, 20, 20),
    (4, 30, 50,  85, 130, 2700, 30, 30, 20, 20),
    (5, 30, 50, 110, 170, 3600, 20, 20, 25, 35),
    (6, 30, 50, 130, 200, 4500, 20, 20, 25, 35)) m(month_no, mnew, dnew, mact, dact, orders, w1, w2, w3, w4)
on conflict (tier, month_no) do nothing;

-- ---------------------------------------------------------------------
-- 3. RPC manager kota
-- ---------------------------------------------------------------------
create or replace function public.admin_city_managers()
returns setof jsonb language plpgsql stable security definer set search_path = public as $$
declare v_month date := date_trunc('month', now())::date;
begin
  perform admin_require('view');
  return query
    select jsonb_build_object('id', cm.id, 'city_id', cm.city_id, 'city_name', c.name, 'province', c.province, 'service_status', c.service_status,
      'full_name', cm.full_name, 'phone', cm.phone, 'email', cm.email, 'profile_id', cm.profile_id, 'profile_name', pr.full_name, 'profile_role', pr.role,
      'city_manager_id_synced', c.manager_id is not distinct from cm.profile_id,
      'salary_base', cm.salary_base, 'start_date', cm.start_date, 'status', cm.status, 'tier', cm.tier, 'note', cm.note,
      'month_no', case when cm.start_date is null then null else greatest(1, (extract(year from v_month) - extract(year from cm.start_date)) * 12 + extract(month from v_month) - extract(month from cm.start_date) + 1)::int end,
      'has_target_this_month', exists (select 1 from city_manager_kpi_targets t where t.city_id = cm.city_id and t.month = v_month),
      'kpi', (select k->'score' from city_manager_kpi_calc(v_month, cm.city_id) k limit 1),
      'kpi_grade', (select k->>'grade' from city_manager_kpi_calc(v_month, cm.city_id) k limit 1),
      'created_at', cm.created_at, 'updated_at', cm.updated_at)
      from city_managers cm join cities c on c.id = cm.city_id left join profiles pr on pr.id = cm.profile_id
     order by case cm.status when 'aktif' then 0 when 'kandidat' then 1 else 2 end, c.name;
end $$;
revoke all on function public.admin_city_managers() from public, anon;
grant execute on function public.admin_city_managers() to authenticated;

create or replace function public.admin_set_city_manager_profile(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cm city_managers; b city_managers; v_city uuid; v_id uuid; v_profile uuid; v_status text; v_tier int; v_salary bigint; v_name text; v_city_name text;
begin
  perform admin_require('city');
  perform admin_require_unlock();
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'Data manager harus objek JSON'; end if;
  v_id := nullif(p->>'id', '')::uuid; v_city := nullif(p->>'city_id', '')::uuid;
  if v_id is not null then select * into b from city_managers where id = v_id; if not found then raise exception 'Manager kota tidak ditemukan'; end if; v_city := coalesce(v_city, b.city_id);
  elsif v_city is not null then select * into b from city_managers where city_id = v_city; end if;
  if v_city is null then raise exception 'city_id wajib diisi'; end if;
  select name into v_city_name from cities where id = v_city;
  if v_city_name is null then raise exception 'Kota tidak ditemukan'; end if;
  v_name := coalesce(nullif(btrim(p->>'full_name'), ''), b.full_name);
  if v_name is null or length(v_name) < 3 then raise exception 'Nama manager minimal 3 huruf'; end if;
  v_status := coalesce(nullif(lower(btrim(p->>'status')), ''), b.status, 'kandidat');
  if v_status not in ('kandidat', 'aktif', 'nonaktif') then raise exception 'Status harus kandidat|aktif|nonaktif'; end if;
  v_tier := coalesce((p->>'tier')::int, b.tier, 2);
  if v_tier not between 1 and 3 then raise exception 'Tier harus 1–3'; end if;
  v_salary := coalesce((p->>'salary_base')::bigint, b.salary_base, greatest(0, setting_num('city_manager_salary_default', 15000000))::bigint);
  if v_salary < 0 then raise exception 'Gaji dasar tidak boleh negatif'; end if;
  if p ? 'profile_id' then v_profile := nullif(p->>'profile_id', '')::uuid; else v_profile := b.profile_id; end if;
  if v_profile is not null then
    if not exists (select 1 from profiles where id = v_profile and coalesce(is_active, true)) then raise exception 'Akun manager (profile_id) tidak ditemukan / nonaktif'; end if;
    if exists (select 1 from city_managers x where x.profile_id = v_profile and x.city_id <> v_city and x.status = 'aktif') and v_status = 'aktif' then
      raise exception 'Akun ini sudah menjadi Manager Kota aktif di kota lain';
    end if;
  end if;
  if v_status = 'aktif' and v_profile is null then raise exception 'Manager aktif wajib punya akun aplikasi (profile_id)'; end if;
  if p ? 'phone' and nullif(btrim(p->>'phone'), '') is not null and btrim(p->>'phone') !~ '^(\+62|0)8[0-9]{7,13}$' then raise exception 'Nomor HP tidak valid (08xx / +628xx)'; end if;
  insert into city_managers (id, city_id, full_name, phone, email, profile_id, salary_base, start_date, status, tier, note, created_by)
  values (coalesce(v_id, gen_random_uuid()), v_city, v_name, coalesce(nullif(btrim(p->>'phone'), ''), b.phone), coalesce(nullif(btrim(p->>'email'), ''), b.email), v_profile, v_salary,
          coalesce(nullif(p->>'start_date', '')::date, b.start_date), v_status, v_tier, coalesce(nullif(btrim(p->>'note'), ''), b.note), auth.uid())
  on conflict (city_id) do update set full_name = excluded.full_name, phone = excluded.phone, email = excluded.email, profile_id = excluded.profile_id,
    salary_base = excluded.salary_base, start_date = excluded.start_date, status = excluded.status, tier = excluded.tier, note = excluded.note, updated_at = now()
  returning * into cm;
  perform log_activity('city_manager.set', 'city_managers', cm.id::text,
    format('Manager Kota %s: %s (%s, tier %s, gaji Rp%s)', v_city_name, cm.full_name, cm.status, cm.tier, cm.salary_base),
    jsonb_build_object('before', to_jsonb(b), 'after', to_jsonb(cm)));
  return (select x from admin_city_managers() x where (x->>'id')::uuid = cm.id);
end $$;
revoke all on function public.admin_set_city_manager_profile(jsonb) from public, anon;
grant execute on function public.admin_set_city_manager_profile(jsonb) to authenticated;

create or replace function public.admin_city_manager_delete(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cm city_managers;
begin
  perform admin_require('city');
  perform admin_require_unlock();
  delete from city_managers where id = p_id returning * into cm;
  if not found then raise exception 'Manager kota tidak ditemukan'; end if;
  perform log_activity('city_manager.delete', 'city_managers', cm.id::text, 'Manager Kota dihapus: ' || cm.full_name, to_jsonb(cm));
  return jsonb_build_object('ok', true, 'deleted', to_jsonb(cm));
end $$;
revoke all on function public.admin_city_manager_delete(uuid) from public, anon;
grant execute on function public.admin_city_manager_delete(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Template: lihat, ubah, terapkan
-- ---------------------------------------------------------------------
create or replace function public.admin_kpi_target_templates()
returns setof jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform admin_require('view');
  return query select to_jsonb(t) from kpi_target_templates t order by t.tier, t.month_no;
end $$;
revoke all on function public.admin_kpi_target_templates() from public, anon;
grant execute on function public.admin_kpi_target_templates() to authenticated;

create or replace function public.admin_set_kpi_target_template(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t kpi_target_templates; b kpi_target_templates; v_tier int; v_mn int; w1 int; w2 int; w3 int; w4 int;
begin
  perform admin_require('city');
  perform admin_require_unlock();
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'Template harus objek JSON'; end if;
  v_tier := (p->>'tier')::int; v_mn := (p->>'month_no')::int;
  if v_tier is null or v_mn is null or v_tier not between 1 and 3 or v_mn not between 1 and 6 then raise exception 'tier 1–3 dan month_no 1–6 wajib'; end if;
  select * into b from kpi_target_templates where tier = v_tier and month_no = v_mn;
  w1 := coalesce((p->>'weight_merchant_new')::int, b.weight_merchant_new, 30); w2 := coalesce((p->>'weight_driver_new')::int, b.weight_driver_new, 30);
  w3 := coalesce((p->>'weight_active')::int, b.weight_active, 20); w4 := coalesce((p->>'weight_orders')::int, b.weight_orders, 20);
  if least(w1, w2, w3, w4) < 0 or w1 + w2 + w3 + w4 <> 100 then raise exception 'KPI_WEIGHTS: jumlah bobot harus 100 (sekarang %)', w1 + w2 + w3 + w4; end if;
  insert into kpi_target_templates (tier, month_no, target_merchant_new, target_driver_new, target_merchant_active, target_driver_active, target_orders,
                                    weight_merchant_new, weight_driver_new, weight_active, weight_orders, bonus_pool, note, updated_by, updated_at)
  values (v_tier, v_mn, coalesce((p->>'target_merchant_new')::int, b.target_merchant_new, 0), coalesce((p->>'target_driver_new')::int, b.target_driver_new, 0),
          coalesce((p->>'target_merchant_active')::int, b.target_merchant_active, 0), coalesce((p->>'target_driver_active')::int, b.target_driver_active, 0),
          coalesce((p->>'target_orders')::int, b.target_orders, 0), w1, w2, w3, w4, coalesce((p->>'bonus_pool')::bigint, b.bonus_pool, 0),
          coalesce(nullif(btrim(p->>'note'), ''), b.note), auth.uid(), now())
  on conflict (tier, month_no) do update set target_merchant_new = excluded.target_merchant_new, target_driver_new = excluded.target_driver_new,
    target_merchant_active = excluded.target_merchant_active, target_driver_active = excluded.target_driver_active, target_orders = excluded.target_orders,
    weight_merchant_new = excluded.weight_merchant_new, weight_driver_new = excluded.weight_driver_new, weight_active = excluded.weight_active,
    weight_orders = excluded.weight_orders, bonus_pool = excluded.bonus_pool, note = excluded.note, updated_by = excluded.updated_by, updated_at = now()
  returning * into t;
  perform log_activity('city_kpi.template', 'kpi_target_templates', v_tier || ':' || v_mn, format('Template KPI tier %s bulan ke-%s diperbarui', v_tier, v_mn),
    jsonb_build_object('before', to_jsonb(b), 'after', to_jsonb(t)));
  return to_jsonb(t);
end $$;
revoke all on function public.admin_set_kpi_target_template(jsonb) from public, anon;
grant execute on function public.admin_set_kpi_target_template(jsonb) to authenticated;

create or replace function public.admin_kpi_apply_template(p_city uuid, p_month date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cm city_managers; t kpi_target_templates; v_month date := date_trunc('month', coalesce(p_month, now()))::date; v_mn int; r jsonb;
begin
  perform admin_require('city');
  perform admin_require_unlock();
  select * into cm from city_managers where city_id = p_city;
  if not found then raise exception 'KPI_TEMPLATE_NO_TIER: kota belum punya data Manager Kota (tier) — isi lewat admin_set_city_manager_profile'; end if;
  if cm.start_date is null then v_mn := 1;
  else v_mn := ((extract(year from v_month) - extract(year from date_trunc('month', cm.start_date))) * 12 + extract(month from v_month) - extract(month from cm.start_date))::int + 1; end if;
  if v_mn < 1 then raise exception 'KPI_TEMPLATE_BEFORE_START: bulan % sebelum start_date manager (%)', to_char(v_month, 'YYYY-MM'), cm.start_date; end if;
  v_mn := least(6, v_mn);
  select * into t from kpi_target_templates where tier = cm.tier and month_no = v_mn;
  if not found then raise exception 'KPI_TEMPLATE_MISSING: template tier % bulan ke-% belum ada', cm.tier, v_mn; end if;
  r := admin_set_city_manager_kpi(jsonb_build_object('city_id', p_city, 'month', v_month,
         'target_merchant_new', t.target_merchant_new, 'target_driver_new', t.target_driver_new, 'target_merchant_active', t.target_merchant_active,
         'target_driver_active', t.target_driver_active, 'target_orders', t.target_orders,
         'weight_merchant_new', t.weight_merchant_new, 'weight_driver_new', t.weight_driver_new, 'weight_active', t.weight_active, 'weight_orders', t.weight_orders,
         'bonus_pool', t.bonus_pool, 'note', format('Template tier %s bulan ke-%s (0125)%s', cm.tier, v_mn, coalesce(' — ' || t.note, ''))));
  perform log_activity('city_kpi.template_applied', 'city_manager_kpi_targets', p_city::text || ':' || to_char(v_month, 'YYYY-MM'),
    format('Template KPI tier %s bulan ke-%s diterapkan ke %s', cm.tier, v_mn, (select name from cities where id = p_city)),
    jsonb_build_object('tier', cm.tier, 'month_no', v_mn, 'template', to_jsonb(t)));
  return r || jsonb_build_object('template', jsonb_build_object('tier', cm.tier, 'month_no', v_mn, 'salary_base', cm.salary_base, 'manager', cm.full_name));
end $$;
revoke all on function public.admin_kpi_apply_template(uuid, date) from public, anon;
grant execute on function public.admin_kpi_apply_template(uuid, date) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Spesifikasi setelan (jangkar baris kode 0118)
-- ---------------------------------------------------------------------
select _v3_splice('0125', 'public.app_setting_specs()',
  $a$    ('kpi_bonus_default_pool',     'int',     0, 1000000000, null, '1000000', 'Rp', 'UANG', '0118: pool bonus bulanan default Manager Kota saat target dibuat [ASUMSI 1 jt]', 'city'),$a$,
  $a$    ('kpi_bonus_default_pool',     'int',     0, 1000000000, null, '1000000', 'Rp', 'UANG', '0118: pool bonus bulanan default Manager Kota saat target dibuat [ASUMSI 1 jt]', 'city'),
    ('city_manager_salary_default', 'int',    0, 1000000000, null, '15000000', 'Rp', 'UANG', '0125: gaji dasar default Manager Kota (keputusan GM Rp15 jt)', 'city'),$a$,
  'city_manager_salary_default');

-- ---------------------------------------------------------------------
-- 6. Penjaga
-- ---------------------------------------------------------------------
do $$
begin
  if to_regclass('public.city_managers') is null or to_regclass('public.kpi_target_templates') is null then raise exception '0125 batal: tabel belum ada'; end if;
  if (select count(*) from kpi_target_templates) <> 18 then raise exception '0125 batal: template harus 18 baris (3 tier × 6 bulan), ada %', (select count(*) from kpi_target_templates); end if;
  if to_regprocedure('public.admin_city_managers()') is null or to_regprocedure('public.admin_set_city_manager_profile(jsonb)') is null
     or to_regprocedure('public.admin_city_manager_delete(uuid)') is null or to_regprocedure('public.admin_kpi_apply_template(uuid,date)') is null
     or to_regprocedure('public.admin_set_kpi_target_template(jsonb)') is null or to_regprocedure('public.admin_kpi_target_templates()') is null then
    raise exception '0125 batal: fungsi belum lengkap';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 't_city_managers_sync') then raise exception '0125 batal: trigger sinkron belum ada'; end if;
  if not exists (select 1 from app_setting_specs() where key = 'city_manager_salary_default') then raise exception '0125 batal: app_setting_specs belum memuat city_manager_salary_default'; end if;
  raise notice '0125 ok: city_managers=%, template=% baris, gaji default Rp%', (select count(*) from city_managers), (select count(*) from kpi_target_templates), setting_num('city_manager_salary_default', 0);
end $$;
