-- =====================================================================
-- 0102 — BIAYA TETAP KOTA, PAYOUT TERSETTLE, REKONSILIASI HARIAN — Skema Bisnis v2
--
-- Sumber: docs/SKEMA-BISNIS-V2-SPEK.md §0.4 (approved ≠ uang sampai; settled hanya setelah konfirmasi
-- bank/provider), §0.6 (EBITDA kota = Σ contribution − biaya tetap kota), §5, §6, §2 (driver_debt_limit
-- berlaku juga untuk mitra travel).
--
-- Isi:
--   1. city_fixed_costs (kota × bulan × kategori) + RLS; RPC admin_set_city_fixed_cost (PIN, audit) & admin_city_fixed_costs(month)
--      kategori 'variable_ops' [ASUMSI] = biaya variabel non-order (support, fraud, asuransi, cloud) → dialokasikan
--      pro-rata per order selesai bulan itu di contribution (0103), BUKAN biaya tetap.
--   2. withdrawal_requests.settled_at / provider_ref / settled_by + admin_mark_withdrawal_settled(id, ref) (PIN, audit)
--   3. v_reconciliation_daily (per tanggal settlement WIB) + admin_reconciliation(from, to) (admin, security definer)
--   4. Batas saldo minus (app_settings.driver_debt_limit) untuk mitra travel: travel_trip_create & travel_offer_create
--      menolak mitra yang saldonya di bawah batas (sama dengan driver_set_online/driver_accept_order sejak 0099).
--      Catatan: debit tunai travel (0029/0036) sendiri TIDAK diblokir (uangnya sudah dipegang mitra) — pagar ada
--      di pintu masuk order baru, seperti driver.
--   5. Penjaga migrasi. Idempoten.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Biaya tetap kota
-- ---------------------------------------------------------------------
create table if not exists public.city_fixed_costs (
  id          uuid primary key default gen_random_uuid(),
  city_id     uuid not null references public.cities(id) on delete cascade,
  month       date not null check (extract(day from month) = 1),
  category    text not null check (category in ('tim','akuisisi','kantor','legal','teknologi','lainnya','variable_ops')),
  amount      bigint not null check (amount >= 0),
  note        text,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (city_id, month, category)
);
create index if not exists city_fixed_costs_month_idx on public.city_fixed_costs (month);
comment on table public.city_fixed_costs is
  'Skema Bisnis v2 (0102): biaya tetap per kota per bulan (tanggal 1). EBITDA kota = Σ contribution − Σ biaya tetap. Kategori variable_ops [ASUMSI] = biaya variabel non-order (support/fraud/asuransi/cloud) yang dialokasikan pro-rata per order selesai ke contribution, bukan biaya tetap.';

alter table public.city_fixed_costs enable row level security;
drop policy if exists city_fixed_costs_admin on public.city_fixed_costs;
create policy city_fixed_costs_admin on public.city_fixed_costs for select to authenticated using (is_admin());
revoke all on public.city_fixed_costs from public, anon, authenticated;
grant select on public.city_fixed_costs to authenticated;
grant all on public.city_fixed_costs to service_role;
do $$
begin
  if to_regprocedure('public.audit_trigger()') is not null
     and not exists (select 1 from pg_trigger where tgname = 't_audit_city_fixed_costs' and tgrelid = 'public.city_fixed_costs'::regclass) then
    create trigger t_audit_city_fixed_costs after insert or delete or update on public.city_fixed_costs for each row execute function audit_trigger();
  end if;
end $$;

-- Upsert satu sel (kota, bulan, kategori). amount 0 tetap disimpan (jejak "sudah diisi nol").
create or replace function public.admin_set_city_fixed_cost(p_city_id uuid, p_month date, p_category text, p_amount bigint, p_note text default null)
returns city_fixed_costs
language plpgsql security definer set search_path = public as $$
declare b city_fixed_costs; a city_fixed_costs; v_month date := date_trunc('month', p_month)::date; v_cat text := lower(trim(coalesce(p_category, ''))); v_city text;
begin
  if not is_admin() then raise exception 'Hanya admin'; end if;
  perform admin_require_unlock();
  select name into v_city from cities where id = p_city_id;
  if v_city is null then raise exception 'Kota tidak ditemukan'; end if;
  if p_month is null then raise exception 'Bulan wajib diisi'; end if;
  if v_month < date '2024-01-01' or v_month > (date_trunc('month', now()) + interval '12 months')::date then raise exception 'Bulan di luar rentang wajar (2024 s.d. 12 bulan ke depan)'; end if;
  if v_cat not in ('tim','akuisisi','kantor','legal','teknologi','lainnya','variable_ops') then
    raise exception 'Kategori harus tim|akuisisi|kantor|legal|teknologi|lainnya|variable_ops';
  end if;
  if p_amount is null or p_amount < 0 or p_amount > 100000000000 then raise exception 'Nominal harus Rp0–Rp100 miliar'; end if;
  select * into b from city_fixed_costs where city_id = p_city_id and month = v_month and category = v_cat for update;
  if found then
    update city_fixed_costs set amount = p_amount, note = coalesce(p_note, note), updated_at = now(), created_by = coalesce(created_by, auth.uid())
     where id = b.id returning * into a;
  else
    insert into city_fixed_costs (city_id, month, category, amount, note, created_by) values (p_city_id, v_month, v_cat, p_amount, p_note, auth.uid())
    returning * into a;
  end if;
  perform log_activity('city_cost.updated', 'city_fixed_costs', a.id::text,
    format('Biaya %s %s %s: Rp%s → Rp%s', v_cat, v_city, to_char(v_month, 'YYYY-MM'), coalesce(b.amount::text, '-'), a.amount),
    jsonb_build_object('before', to_jsonb(b), 'after', to_jsonb(a)));
  return a;
end $$;
revoke all on function public.admin_set_city_fixed_cost(uuid, date, text, bigint, text) from public, anon;
grant execute on function public.admin_set_city_fixed_cost(uuid, date, text, bigint, text) to authenticated;

-- Daftar biaya satu bulan (0103 menambahkan ringkasan EBITDA kota bulan itu)
create or replace function public.admin_city_fixed_costs(p_month date default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_month date := date_trunc('month', coalesce(p_month, (now() at time zone 'Asia/Jakarta')::date))::date;
begin
  if not is_admin() then raise exception 'Hanya admin'; end if;
  return jsonb_build_object('month', v_month,
    'rows', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'city_id', f.city_id, 'city', c.name, 'category', f.category,
        'amount', f.amount, 'note', f.note, 'updated_at', f.updated_at) order by c.name, f.category)
      from city_fixed_costs f join cities c on c.id = f.city_id where f.month = v_month), '[]'::jsonb),
    'by_city', coalesce((select jsonb_agg(jsonb_build_object('city_id', x.city_id, 'city', x.name, 'fixed', x.fixed, 'variable_ops', x.var, 'total', x.fixed + x.var) order by x.name)
      from (select f.city_id, c.name, coalesce(sum(f.amount) filter (where f.category <> 'variable_ops'), 0) fixed,
                   coalesce(sum(f.amount) filter (where f.category = 'variable_ops'), 0) var
            from city_fixed_costs f join cities c on c.id = f.city_id where f.month = v_month group by f.city_id, c.name) x), '[]'::jsonb),
    'total_fixed', (select coalesce(sum(amount), 0) from city_fixed_costs where month = v_month and category <> 'variable_ops'),
    'total_variable_ops', (select coalesce(sum(amount), 0) from city_fixed_costs where month = v_month and category = 'variable_ops'));
end $$;
revoke all on function public.admin_city_fixed_costs(date) from public, anon;
grant execute on function public.admin_city_fixed_costs(date) to authenticated;

-- ---------------------------------------------------------------------
-- 2. Payout tersettle: approved ≠ uang sampai (§0.4)
-- ---------------------------------------------------------------------
alter table public.withdrawal_requests add column if not exists settled_at timestamptz;
alter table public.withdrawal_requests add column if not exists provider_ref text;
alter table public.withdrawal_requests add column if not exists settled_by uuid;
create index if not exists withdrawal_requests_unsettled_idx on public.withdrawal_requests (created_at) where status = 'approved' and settled_at is null;
comment on column public.withdrawal_requests.settled_at is 'Dana benar-benar sampai (konfirmasi bank/provider) — diisi admin_mark_withdrawal_settled (0102). approved ≠ settled.';

create or replace function public.admin_mark_withdrawal_settled(p_id uuid, p_provider_ref text)
returns withdrawal_requests
language plpgsql security definer set search_path = public as $$
declare w withdrawal_requests; b withdrawal_requests; v_ref text := nullif(trim(coalesce(p_provider_ref, '')), '');
begin
  if not is_admin() then raise exception 'Hanya admin'; end if;
  perform admin_require_unlock();
  if v_ref is null or length(v_ref) < 3 or length(v_ref) > 120 then raise exception 'Nomor referensi bank/provider wajib diisi (3–120 karakter)'; end if;
  select * into b from withdrawal_requests where id = p_id for update;
  if not found then raise exception 'Permintaan penarikan tidak ditemukan'; end if;
  if b.status <> 'approved' then raise exception 'Hanya penarikan berstatus approved yang bisa ditandai settled (status %)', b.status; end if;
  if b.settled_at is not null then raise exception 'Penarikan sudah settled % (ref %)', b.settled_at, b.provider_ref; end if;
  if exists (select 1 from withdrawal_requests x where x.provider_ref = v_ref and x.id <> b.id) then raise exception 'Referensi % sudah dipakai penarikan lain', v_ref; end if;
  update withdrawal_requests set settled_at = now(), provider_ref = v_ref, settled_by = auth.uid() where id = b.id returning * into w;
  insert into notifications (user_id, kind, title, body, data) values (w.user_id, 'system', 'Dana penarikan sudah ditransfer',
    'Rp' || to_char(w.amount, 'FM999G999G999') || ' ke ' || w.bank_name || ' ' || w.bank_account || ' sudah ditransfer (ref ' || v_ref || ').',
    jsonb_build_object('withdrawal_id', w.id, 'provider_ref', v_ref));
  perform log_activity('withdrawal.settled', 'withdrawal_requests', w.id::text, 'Penarikan Rp' || w.amount || ' settled, ref ' || v_ref,
    jsonb_build_object('before', to_jsonb(b), 'after', to_jsonb(w)));
  return w;
end $$;
revoke all on function public.admin_mark_withdrawal_settled(uuid, text) from public, anon;
grant execute on function public.admin_mark_withdrawal_settled(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Rekonsiliasi harian (§6)
--    Per pembayaran gateway yang settlement: nilai yang harus "cocok" di sisi AntarKita =
--      • top up / refund-karena-pesanan-batal: Σ wallet_transactions ber-ref external_id
--      • bayar pesanan: gross_customer buku besar fase created pesanan itu (total, tanpa tip)
--    diff = payments_settled − (gross_customer_digital + wallet_credited)  → harus 0.
--    net_settlement = payments_settled − (pg_fee + ppn) = yang seharusnya dicairkan Midtrans; held = yang masih ditahan (hold_until > now()).
-- ---------------------------------------------------------------------
create or replace view public.v_reconciliation_daily with (security_invoker = on) as
with p as (
  select pm.id, pm.purpose, pm.amount, pm.pg_fee, pm.pg_fee_ppn, pm.hold_until, pm.order_id,
    (pm.settlement_time at time zone 'Asia/Jakarta')::date as day,
    coalesce((select sum(t.amount) from wallet_transactions t where t.ref = pm.external_id and t.user_id = pm.user_id and t.type in ('topup', 'refund')), 0)::bigint as wallet_credited,
    coalesce((select sum(t.amount) from wallet_transactions t where t.ref = pm.external_id and t.user_id = pm.user_id and t.type = 'refund'), 0)::bigint as late_refund
  from payments pm
  where pm.status = 'settlement' and pm.settlement_time is not null
), q as (
  select p.*,
    case when p.purpose = 'order' and p.wallet_credited = 0 then
      coalesce((select sum(l.amount) filter (where l.entry = 'gross_customer') - coalesce(sum(l.amount) filter (where l.entry = 'tip'), 0)
                from order_ledger l where l.order_id = p.order_id and l.source = 'orders' and l.phase = 'created'), 0)
    else 0 end::bigint as order_gross
  from p
)
select day,
  count(*)::int                                                     as payments_count,
  count(*) filter (where purpose = 'order')::int                    as order_payments,
  coalesce(sum(amount), 0)::bigint                                  as payments_settled,
  coalesce(sum(order_gross), 0)::bigint                             as gross_customer_digital,
  coalesce(sum(wallet_credited) filter (where purpose = 'topup'), 0)::bigint as topups_credited,
  coalesce(sum(late_refund), 0)::bigint                             as late_payment_refunds,
  coalesce(sum(pg_fee), 0)::bigint                                  as pg_fee,
  coalesce(sum(pg_fee_ppn), 0)::bigint                              as pg_fee_ppn,
  coalesce(sum(pg_fee + pg_fee_ppn), 0)::bigint                     as pg_fee_total,
  coalesce(sum(amount - pg_fee - pg_fee_ppn), 0)::bigint            as net_settlement,
  coalesce(sum(amount - pg_fee - pg_fee_ppn) filter (where hold_until > now()), 0)::bigint as held_amount,
  (coalesce(sum(amount), 0) - coalesce(sum(order_gross), 0) - coalesce(sum(wallet_credited), 0))::bigint as diff
from q group by day;
comment on view public.v_reconciliation_daily is
  'Rekonsiliasi harian gateway (0102, §6) per tanggal settlement WIB: diff = pembayaran settlement − (gross_customer pesanan digital + dana yang dikreditkan ke saldo) → harus 0. Hanya lewat admin_reconciliation().';
revoke all on public.v_reconciliation_daily from public, anon, authenticated;
grant select on public.v_reconciliation_daily to service_role;

create or replace function public.admin_reconciliation(p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_sla numeric := setting_num('payout_sla_hours', 24);
begin
  if not is_admin() then raise exception 'Hanya admin'; end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Rentang tanggal tidak valid'; end if;
  if p_to - p_from > 400 then raise exception 'Rentang maksimal 400 hari'; end if;
  return jsonb_build_object('from', p_from, 'to', p_to,
    'days', coalesce((select jsonb_agg(to_jsonb(r) order by r.day) from v_reconciliation_daily r where r.day between p_from and p_to), '[]'::jsonb),
    'totals', (select jsonb_build_object('payments_settled', coalesce(sum(payments_settled), 0), 'gross_customer_digital', coalesce(sum(gross_customer_digital), 0),
        'topups_credited', coalesce(sum(topups_credited), 0), 'late_payment_refunds', coalesce(sum(late_payment_refunds), 0),
        'pg_fee_total', coalesce(sum(pg_fee_total), 0), 'net_settlement', coalesce(sum(net_settlement), 0), 'held_amount', coalesce(sum(held_amount), 0),
        'diff', coalesce(sum(diff), 0), 'abs_diff', coalesce(sum(abs(diff)), 0), 'days_with_diff', count(*) filter (where diff <> 0))
      from v_reconciliation_daily where day between p_from and p_to),
    'payouts', jsonb_build_object(
      'sla_hours', v_sla,
      'approved_unsettled', (select jsonb_build_object('count', count(*), 'amount', coalesce(sum(w.amount), 0),
          'overdue', count(*) filter (where coalesce(w.reviewed_at, w.created_at) < now() - make_interval(hours => v_sla::int)),
          'items', coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'user_id', w.user_id, 'name', pr.full_name, 'amount', w.amount, 'bank_name', w.bank_name,
              'bank_account', w.bank_account, 'account_name', w.account_name, 'auto', w.auto, 'approved_at', coalesce(w.reviewed_at, w.created_at),
              'created_at', w.created_at) order by w.created_at), '[]'::jsonb))
        from withdrawal_requests w left join profiles pr on pr.id = w.user_id where w.status = 'approved' and w.settled_at is null),
      'settled', (select jsonb_build_object('count', count(*), 'amount', coalesce(sum(amount), 0),
          'on_time', count(*) filter (where settled_at - coalesce(reviewed_at, created_at) <= make_interval(hours => v_sla::int)))
        from withdrawal_requests where settled_at is not null and (settled_at at time zone 'Asia/Jakarta')::date between p_from and p_to),
      'approved_in_range', (select count(*) from withdrawal_requests where status = 'approved' and (created_at at time zone 'Asia/Jakarta')::date between p_from and p_to)),
    'labels', jsonb_build_object('payout_sla_hours', '[ASUMSI] SLA pencairan 24 jam sejak disetujui (app_settings.payout_sla_hours)',
      'diff', '[FAKTA SUMBER] §6: selisih harus 0 sebelum scale-up'));
end $$;
revoke all on function public.admin_reconciliation(date, date) from public, anon;
grant execute on function public.admin_reconciliation(date, date) to authenticated;

insert into app_settings (key, value) values ('payout_sla_hours', '24'::jsonb) on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 4. Batas saldo minus mitra travel (driver_debt_limit) di pintu masuk order baru
-- ---------------------------------------------------------------------
create or replace function public.skema_v2_splice(p_fn text, p_anchor text, p_new text, p_marker text, p_all boolean default false)
returns void language plpgsql as $$
declare def text; n int;
begin
  if (select count(*) from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace where ns.nspname = 'public' and p.proname = p_fn) > 1 then
    raise exception 'skema v2 batal: fungsi % punya lebih dari satu overload', p_fn;
  end if;
  select pg_get_functiondef(p.oid) into def from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace where ns.nspname = 'public' and p.proname = p_fn;
  if def is null then raise exception 'skema v2 batal: fungsi % tidak ditemukan', p_fn; end if;
  if position(p_marker in def) > 0 then raise notice 'skema v2: % sudah ditambal (%), dilewati', p_fn, p_marker; return; end if;
  n := (length(def) - length(replace(def, p_anchor, ''))) / greatest(1, length(p_anchor));
  if n = 0 then raise exception 'skema v2 batal: jangkar tidak ditemukan di % — tambalan TIDAK terpasang. Jangkar: %', p_fn, left(p_anchor, 120); end if;
  if n > 1 and not p_all then raise exception 'skema v2 batal: jangkar tidak unik (% kali) di %', n, p_fn; end if;
  execute replace(def, p_anchor, p_new);
end $$;

select skema_v2_splice('travel_trip_create',
  $a$  if not found or tp.status <> 'approved' then raise exception 'Akun mitra travel belum disetujui admin'; end if;$a$,
  $a$  if not found or tp.status <> 'approved' then raise exception 'Akun mitra travel belum disetujui admin'; end if;
  if coalesce((select balance from wallets where user_id = tp.id), 0) < setting_num('driver_debt_limit', -500000)::bigint then   -- 0102 driver_debt_limit mitra travel
    raise exception 'Saldo minus melebihi batas (Rp%). Setor/top up dulu sebelum membuka jadwal travel.', replace(to_char(abs(setting_num('driver_debt_limit', -500000)), 'FM999,999,999,999'), ',', '.');
  end if;$a$,
  '0102 driver_debt_limit');

select skema_v2_splice('travel_offer_create',
  $a$  if not found then raise exception 'Bukan mitra travel aktif'; end if;$a$,
  $a$  if not found then raise exception 'Bukan mitra travel aktif'; end if;
  if coalesce((select balance from wallets where user_id = tp.id), 0) < setting_num('driver_debt_limit', -500000)::bigint then   -- 0102 driver_debt_limit mitra travel
    raise exception 'Saldo minus melebihi batas (Rp%). Setor/top up dulu sebelum mengirim penawaran.', replace(to_char(abs(setting_num('driver_debt_limit', -500000)), 'FM999,999,999,999'), ',', '.');
  end if;$a$,
  '0102 driver_debt_limit');

drop function if exists public.skema_v2_splice(text, text, text, text, boolean);

-- ---------------------------------------------------------------------
-- 5. Penjaga migrasi
-- ---------------------------------------------------------------------
do $$
begin
  if position('0102 driver_debt_limit' in pg_get_functiondef('public.travel_trip_create(jsonb)'::regprocedure)) = 0
     or position('0102 driver_debt_limit' in pg_get_functiondef('public.travel_offer_create(uuid,bigint,jsonb,text)'::regprocedure)) = 0 then
    raise exception '0102 batal: pagar saldo minus mitra travel belum terpasang';
  end if;
  if has_table_privilege('authenticated', 'public.city_fixed_costs', 'INSERT') or has_table_privilege('anon', 'public.city_fixed_costs', 'SELECT')
     or has_table_privilege('authenticated', 'public.v_reconciliation_daily', 'SELECT') then
    raise exception '0102 batal: city_fixed_costs / v_reconciliation_daily terbuka untuk klien';
  end if;
  if has_function_privilege('anon', 'public.admin_mark_withdrawal_settled(uuid,text)', 'EXECUTE') or has_function_privilege('anon', 'public.admin_reconciliation(date,date)', 'EXECUTE') then
    raise exception '0102 batal: RPC admin terbuka untuk anon';
  end if;
  if not exists (select 1 from information_schema.columns where table_name = 'withdrawal_requests' and column_name = 'settled_at') then
    raise exception '0102 batal: kolom settled_at belum ada';
  end if;
  perform * from v_reconciliation_daily limit 1;
  raise notice '0102 ok: city_fixed_costs, payout settled, v_reconciliation_daily, pagar saldo minus mitra travel';
end $$;
