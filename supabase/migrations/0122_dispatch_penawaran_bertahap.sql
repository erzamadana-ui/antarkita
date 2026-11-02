-- =====================================================================
-- 0122 — Dispatch penawaran bertahap & re-assign otomatis (keputusan GM 31 Okt 2026 no. 6) — docs/KONTRAK-31OKT.md §0122
--   Desain (menjaga perilaku lama sebagai fallback):
--   • Penawaran bertahap adalah LAPISAN EKSKLUSIVITAS di atas siaran lama: selama ada penawaran aktif ('offered', belum
--     kedaluwarsa) untuk suatu order, hanya pemegang penawaran yang melihat/menerimanya. Tanpa penawaran aktif (sebelum tick
--     cron pertama ≤ 10 dtk, jeda antar ronde ≤ 10 dtk, tidak ada kandidat, atau ronde habis) → mode siaran lama:
--     driver_available_orders() memakai radius/prioritas rating lama dan driver_accept_order() boleh dipakai siapa pun yang cocok.
--     Dengan begitu simulasi_e2e (accept langsung pada order searching) tetap valid.
--   • dispatch_tick(p_now) — cron tiap 10 detik (pg_cron ≥ 1.5 mendukung '10 seconds'):
--       1) penawaran lewat waktu → 'expired';  2) dispatch_release_stale(): order 'accepted' > N menit tanpa 'arrived' dan
--       jarak driver→jemput tidak mengecil ≥ 300 m dan driver masih > 300 m dari jemput → order kembali 'searching', driver lama dikecualikan (order_rejections) +
--       fraud_flag 'accept_no_move' (auto-suspend pada flag ke-N dalam 7 hari [ASUMSI 3]), notifikasi pelanggan & driver;
--       3) untuk setiap order 'searching' tanpa penawaran aktif dan ronde < dispatch_offer_rounds → dispatch_offer_next():
--       kandidat = driver online/approved/aktif, lokasi segar (≤ 15 menit [ASUMSI]), driver_can_take, tanpa order aktif, tanpa
--       penawaran aktif lain, belum pernah ditawari/menolak order ini, saldo ≥ batas minus; radius ronde r =
--       least(pickup_radius_km(layanan), r × dispatch_offer_radius_step_km); urutan = jarak + penalti prioritas rating
--       (driver_priority_delay_s × dispatch_priority_penalty_m_per_s [ASUMSI 20 m/dtk]). Push ke driver "Order baru untuk Anda — 25 dtk".
--   • driver_accept_order: ditolak bila penawaran aktif dipegang driver lain; pemegang/siapa pun (siaran) → diterima, penawaran
--     lain dibatalkan, baris penawaran pemenang 'accepted' + jarak saat terima (dasar deteksi tidak bergerak).
--   • driver_decline_offer(p_offer, p_reason) → 'declined' + order_rejections + langsung ronde berikutnya.
--     driver_reject_order lama → ikut menolak penawaran aktif order itu. driver_offer_mine() → penawaran aktif saya (jsonb/null).
--   • cancel_order: driver melepas → baris penawarannya 'cancelled' (driver_cancel) + dikecualikan; pelanggan/admin batal →
--     semua penawaran aktif 'cancelled' (order_cancelled).
--   • Setelan [ASUMSI]: dispatch_enabled true, dispatch_offer_seconds 25, dispatch_offer_rounds 6, dispatch_offer_radius_step_km 1,
--     dispatch_accept_no_move_minutes 5, dispatch_no_move_min_progress_m 300, dispatch_priority_penalty_m_per_s 20,
--     dispatch_no_move_suspend_count 3, dispatch_offer_on_create false (true = penawaran ronde 1 dibuat seketika di create_order).
-- Idempoten. Rollback: supabase/rollback/0122_down.sql
-- =====================================================================
do $$
declare s text;
begin
  foreach s in array array[
    -- diubah
    'public.driver_available_orders()', 'public.driver_accept_order(uuid)', 'public.driver_reject_order(uuid,text)',
    'public.cancel_order(uuid,text)', 'public.create_order(jsonb,uuid)', 'public.app_setting_specs()',
    -- baru
    'public.dispatch_cfg()', 'public.dispatch_active_offer(uuid,timestamptz)', 'public.dispatch_offer_next(uuid,timestamptz)',
    'public.dispatch_expire(timestamptz)', 'public.dispatch_release_stale(timestamptz)', 'public.dispatch_tick(timestamptz)',
    'public.dispatch_accept_guard(uuid,uuid)', 'public.dispatch_on_accept(uuid,uuid)', 'public.dispatch_on_driver_release(uuid,uuid,text)',
    'public.driver_decline_offer(uuid,text)', 'public.driver_offer_mine()', 'public.admin_dispatch_summary()'] loop
    perform _mig_backup('0122', s);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 1. Setelan
-- ---------------------------------------------------------------------
insert into app_settings (key, value) values
  ('dispatch_enabled',                    'true'::jsonb),
  ('dispatch_offer_seconds',              '25'::jsonb),
  ('dispatch_offer_rounds',               '6'::jsonb),
  ('dispatch_offer_radius_step_km',       '1'::jsonb),
  ('dispatch_accept_no_move_minutes',     '5'::jsonb),
  ('dispatch_no_move_min_progress_m',     '300'::jsonb),
  ('dispatch_priority_penalty_m_per_s',   '20'::jsonb),
  ('dispatch_no_move_suspend_count',      '3'::jsonb),
  ('dispatch_offer_on_create',            'false'::jsonb)
on conflict (key) do nothing;

create or replace function public.dispatch_cfg()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'enabled',            setting_flag('dispatch_enabled', true),
    'offer_seconds',      greatest(5, setting_num('dispatch_offer_seconds', 25))::int,
    'rounds',             greatest(1, setting_num('dispatch_offer_rounds', 6))::int,
    'radius_step_km',     greatest(0.2, setting_num('dispatch_offer_radius_step_km', 1)),
    'no_move_minutes',    greatest(1, setting_num('dispatch_accept_no_move_minutes', 5)),
    'min_progress_m',     greatest(50, setting_num('dispatch_no_move_min_progress_m', 300)),
    'penalty_m_per_s',    greatest(0, setting_num('dispatch_priority_penalty_m_per_s', 20)),
    'no_move_suspend',    greatest(1, setting_num('dispatch_no_move_suspend_count', 3))::int,
    'offer_on_create',    setting_flag('dispatch_offer_on_create', false));
$$;
revoke all on function public.dispatch_cfg() from public, anon;
grant execute on function public.dispatch_cfg() to authenticated;

-- ---------------------------------------------------------------------
-- 2. Tabel penawaran
-- ---------------------------------------------------------------------
create table if not exists public.order_offers (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references public.orders(id) on delete cascade,
  driver_id     uuid not null references public.drivers(id) on delete cascade,
  round         int not null default 1,
  offered_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  status        text not null default 'offered' check (status in ('offered', 'accepted', 'declined', 'expired', 'cancelled')),
  responded_at  timestamptz,
  reason        text,
  distance_m    numeric,
  accept_dist_m numeric,
  unique (order_id, driver_id)
);
create index if not exists order_offers_active_idx on public.order_offers (expires_at) where status = 'offered';
create index if not exists order_offers_driver_active_idx on public.order_offers (driver_id) where status = 'offered';
create index if not exists order_offers_order_idx on public.order_offers (order_id, round);
comment on table public.order_offers is '0122: penawaran order bertahap ke driver (satu baris per order×driver). round 0 = diterima lewat siaran tanpa penawaran.';
alter table public.order_offers enable row level security;
drop policy if exists order_offers_read on public.order_offers;
create policy order_offers_read on public.order_offers for select to authenticated using (driver_id = auth.uid() or admin_has('orders_view'));
revoke all on public.order_offers from public, anon, authenticated;
grant select on public.order_offers to authenticated;
grant all on public.order_offers to service_role;

-- penawaran aktif suatu order (bila ada)
create or replace function public.dispatch_active_offer(p_order uuid, p_now timestamptz default now())
returns order_offers language sql stable security definer set search_path = public as $$
  select f.* from order_offers f where f.order_id = p_order and f.status = 'offered' and f.expires_at > coalesce(p_now, now())
  order by f.offered_at desc limit 1;
$$;
revoke all on function public.dispatch_active_offer(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.dispatch_active_offer(uuid, timestamptz) to service_role;

-- ---------------------------------------------------------------------
-- 3. Inti: tawarkan order ke driver berikutnya
-- ---------------------------------------------------------------------
create or replace function public.dispatch_offer_next(p_order uuid, p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path = public as $$
declare c jsonb := dispatch_cfg(); v_now timestamptz := coalesce(p_now, now()); o orders%rowtype; f order_offers; v_used int; r int;
        v_rounds int := (c->>'rounds')::int; v_step numeric := (c->>'radius_step_km')::numeric; v_pen numeric := (c->>'penalty_m_per_s')::numeric;
        v_radius_m numeric; v_max_m numeric; v_hold numeric := setting_num('direct_order_hold_seconds', 120); v_fallback boolean := setting_flag('direct_order_fallback', true);
        v_debt bigint := setting_num('driver_debt_limit', -500000)::bigint; cand record; v_secs int := (c->>'offer_seconds')::int;
begin
  if not (c->>'enabled')::boolean then return jsonb_build_object('mode', 'disabled'); end if;
  select * into o from orders where id = p_order for update skip locked;
  if not found then return jsonb_build_object('mode', 'locked'); end if;
  if o.status <> 'searching' or order_payment_pending(o) or (o.merchant_status is not null and o.merchant_status = 'rejected') then
    return jsonb_build_object('mode', 'not_searching', 'status', o.status);
  end if;
  f := dispatch_active_offer(o.id, v_now);
  if f.id is not null then return jsonb_build_object('mode', 'offer', 'offer_id', f.id, 'driver_id', f.driver_id, 'round', f.round, 'expires_at', f.expires_at, 'existing', true); end if;
  -- AntarNow (kode driver): selama masa tahan, order hanya untuk driver pilihan → biarkan jalur lama
  if o.preferred_driver_id is not null and (not v_fallback or o.created_at > v_now - (v_hold || ' seconds')::interval) then
    return jsonb_build_object('mode', 'direct', 'driver_id', o.preferred_driver_id);
  end if;
  select count(*) into v_used from order_offers where order_id = o.id and status <> 'accepted';
  if v_used >= v_rounds then return jsonb_build_object('mode', 'broadcast', 'rounds_used', v_used); end if;
  v_max_m := pickup_radius_km(o.service) * 1000;
  for r in (v_used + 1) .. v_rounds loop
    v_radius_m := least(v_max_m, v_step * r * 1000);
    select d.id, st_distance(o.pickup_location, d.location) as dist_m,
           driver_priority_delay_s(d.rating_avg, d.rating_count) as delay_s
      into cand
      from drivers d join profiles p on p.id = d.id
     where d.status = 'approved' and d.is_online and p.is_active and d.location is not null
       and coalesce(d.last_seen_at, d.updated_at) > v_now - interval '15 minutes'
       and st_dwithin(o.pickup_location, d.location, v_radius_m)
       and driver_can_take(d, o)
       and not is_blocked_pair(d.id, o.customer_id)
       and not exists (select 1 from order_offers x where x.order_id = o.id and x.driver_id = d.id)
       and not exists (select 1 from order_rejections rj where rj.order_id = o.id and rj.driver_id = d.id)
       and not exists (select 1 from orders a where a.driver_id = d.id and a.status in ('accepted', 'arrived', 'in_progress'))
       and not exists (select 1 from order_offers y where y.driver_id = d.id and y.status = 'offered' and y.expires_at > v_now)
       and coalesce((select w.balance from wallets w where w.user_id = d.id), 0) >= v_debt
     order by st_distance(o.pickup_location, d.location) + driver_priority_delay_s(d.rating_avg, d.rating_count) * v_pen asc, d.rating_avg desc, d.id
     limit 1;
    if found then
      insert into order_offers (order_id, driver_id, round, offered_at, expires_at, status, distance_m)
      values (o.id, cand.id, r, v_now, v_now + (v_secs || ' seconds')::interval, 'offered', round(cand.dist_m::numeric, 0))
      returning * into f;
      perform push_enqueue(cand.id, 'Order baru untuk Anda — ' || v_secs || ' dtk',
        service_label(o.service) || ' · ' || round((cand.dist_m / 1000.0)::numeric, 1) || ' km dari Anda · ' || o.pickup_address || ' · Rp' || replace(to_char(o.driver_earning + coalesce(o.driver_service_share, 0), 'FM999,999,999,999'), ',', '.'),
        jsonb_build_object('kind', 'order_offer', 'offer_id', f.id, 'order_id', o.id, 'order_code', o.code, 'round', r, 'expires_at', f.expires_at, 'offer_seconds', v_secs), 'order_offer');
      return jsonb_build_object('mode', 'offer', 'offer_id', f.id, 'driver_id', f.driver_id, 'round', r, 'expires_at', f.expires_at, 'distance_m', f.distance_m, 'radius_m', v_radius_m);
    end if;
  end loop;
  return jsonb_build_object('mode', 'waiting', 'rounds_used', v_used, 'radius_m', v_radius_m);
end $$;
revoke all on function public.dispatch_offer_next(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.dispatch_offer_next(uuid, timestamptz) to service_role;

create or replace function public.dispatch_expire(p_now timestamptz default now())
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update order_offers set status = 'expired', responded_at = coalesce(p_now, now()) where status = 'offered' and expires_at <= coalesce(p_now, now());
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.dispatch_expire(timestamptz) from public, anon, authenticated;
grant execute on function public.dispatch_expire(timestamptz) to service_role;

-- ---------------------------------------------------------------------
-- 4. Re-assign: diterima tapi tidak bergerak
-- ---------------------------------------------------------------------
create or replace function public.dispatch_release_stale(p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path = public as $$
declare c jsonb := dispatch_cfg(); v_now timestamptz := coalesce(p_now, now()); v_min numeric := (c->>'no_move_minutes')::numeric; v_prog numeric := (c->>'min_progress_m')::numeric;
        rec record; v_out jsonb := '[]'::jsonb; n int := 0; v_flags int; v_susp boolean; v_name text; d jsonb;
begin
  for rec in
    select o.id as order_id, o.code, o.customer_id, o.driver_id, o.accepted_at, f.accept_dist_m,
           st_distance(o.pickup_location, d.location) as now_dist_m, d.last_seen_at
      from orders o
      join order_offers f on f.order_id = o.id and f.driver_id = o.driver_id and f.status = 'accepted'
      join drivers d on d.id = o.driver_id
     where o.status = 'accepted' and o.arrived_at is null and o.driver_id is not null
       and o.accepted_at <= v_now - (v_min || ' minutes')::interval
       and f.accept_dist_m is not null
       and (d.location is null
            or (st_distance(o.pickup_location, d.location) > v_prog                       -- belum dekat titik jemput
                and st_distance(o.pickup_location, d.location) > f.accept_dist_m - v_prog)) -- dan belum mendekat ≥ min_progress
     limit 100
  loop
    perform set_config('antaraja.bypass', 'on', true);
    update orders set driver_id = null, status = 'searching', accepted_at = null, arrived_at = null where id = rec.order_id and status = 'accepted' and driver_id = rec.driver_id;
    if not found then perform set_config('antaraja.bypass', 'off', true); continue; end if;
    update order_offers set status = 'cancelled', reason = 'accept_no_move', responded_at = v_now where order_id = rec.order_id and driver_id = rec.driver_id;
    insert into order_rejections (order_id, driver_id, reason) values (rec.order_id, rec.driver_id, 'accept_no_move')
      on conflict (order_id, driver_id) do update set reason = 'accept_no_move', created_at = v_now;
    insert into order_events (order_id, status, actor_id, note) values (rec.order_id, 'driver_released', rec.driver_id,
      'Driver tidak bergerak ke titik jemput selama ' || v_min || ' menit (jarak ' || round(rec.accept_dist_m) || ' m → ' || coalesce(round(rec.now_dist_m)::text, '?') || ' m) — pesanan dicarikan driver lain');
    select count(*) into v_flags from fraud_flags where kind = 'accept_no_move' and subject_id = rec.driver_id and created_at > v_now - interval '7 days';
    v_susp := v_flags + 1 >= (c->>'no_move_suspend')::int;
    perform fraud_flag('accept_no_move', case when v_susp then 'high' else 'med' end, rec.driver_id, rec.order_id,
      jsonb_build_object('accepted_at', rec.accepted_at, 'minutes', v_min, 'accept_dist_m', round(rec.accept_dist_m), 'now_dist_m', round(coalesce(rec.now_dist_m, -1)), 'last_seen_at', rec.last_seen_at, 'flags_7d', v_flags + 1), v_susp);
    select full_name into v_name from profiles where id = rec.driver_id;
    insert into notifications (user_id, kind, title, body, data) values (rec.customer_id, 'order', 'Driver diganti · ' || rec.code,
      'Driver sebelumnya tidak bergerak ke lokasi Anda. Kami sedang mencarikan driver lain — mohon tunggu sebentar.', jsonb_build_object('order_id', rec.order_id, 'event', 'driver_released'));
    insert into notifications (user_id, kind, title, body, data) values (rec.driver_id, 'system', 'Order ' || rec.code || ' dilepas otomatis',
      'Anda tidak bergerak ke titik jemput selama ' || v_min || ' menit setelah menerima order. Order dialihkan ke driver lain dan tercatat sebagai strike (' || (v_flags + 1) || '/' || (c->>'no_move_suspend') || ').',
      jsonb_build_object('order_id', rec.order_id, 'kind', 'accept_no_move'));
    perform set_config('antaraja.bypass', 'off', true);
    d := dispatch_offer_next(rec.order_id, v_now);
    n := n + 1;
    v_out := v_out || jsonb_build_object('order_id', rec.order_id, 'code', rec.code, 'driver_id', rec.driver_id, 'driver_name', v_name, 'accept_dist_m', round(rec.accept_dist_m), 'now_dist_m', round(coalesce(rec.now_dist_m, -1)), 'suspended', v_susp, 'next', d);
  end loop;
  return jsonb_build_object('released', n, 'items', v_out);
end $$;
revoke all on function public.dispatch_release_stale(timestamptz) from public, anon, authenticated;
grant execute on function public.dispatch_release_stale(timestamptz) to service_role;

-- ---------------------------------------------------------------------
-- 5. Tick (cron 10 detik) — p_now untuk simulasi waktu di uji
-- ---------------------------------------------------------------------
create or replace function public.dispatch_tick(p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path = public as $$
declare c jsonb := dispatch_cfg(); v_now timestamptz := coalesce(p_now, now()); n_exp int; rel jsonb; oid uuid; d jsonb;
        n_offer int := 0; n_bc int := 0; n_wait int := 0; n_other int := 0; v_rounds int := (c->>'rounds')::int;
        v_hold numeric := setting_num('direct_order_hold_seconds', 120); v_fallback boolean := setting_flag('direct_order_fallback', true);
begin
  if not (c->>'enabled')::boolean then return jsonb_build_object('enabled', false); end if;
  if not pg_try_advisory_xact_lock(hashtext('antarkita_dispatch_tick')) then return jsonb_build_object('skipped', 'locked'); end if;
  n_exp := dispatch_expire(v_now);
  rel := dispatch_release_stale(v_now);
  for oid in
    select o.id from orders o
     where o.status = 'searching' and not order_payment_pending(o)
       and (o.merchant_status is null or o.merchant_status <> 'rejected')
       and o.created_at <= v_now
       and (o.preferred_driver_id is null or (v_fallback and o.created_at <= v_now - (v_hold || ' seconds')::interval))
       and not exists (select 1 from order_offers f where f.order_id = o.id and f.status = 'offered' and f.expires_at > v_now)
       and (select count(*) from order_offers f where f.order_id = o.id and f.status <> 'accepted') < v_rounds
     order by o.created_at
     limit 200
  loop
    d := dispatch_offer_next(oid, v_now);
    case d->>'mode'
      when 'offer' then n_offer := n_offer + 1;
      when 'broadcast' then n_bc := n_bc + 1;
      when 'waiting' then n_wait := n_wait + 1;
      else n_other := n_other + 1;
    end case;
  end loop;
  -- order 'searching' yang ronde penawarannya sudah habis = mode siaran (tidak diiterasi lagi)
  select count(*) into n_bc from orders o where o.status = 'searching'
     and (select count(*) from order_offers f where f.order_id = o.id and f.status <> 'accepted') >= v_rounds;
  return jsonb_build_object('at', v_now, 'expired', n_exp, 'released', rel->'released', 'offered', n_offer, 'broadcast', n_bc, 'waiting', n_wait, 'other', n_other, 'release_items', rel->'items');
end $$;
revoke all on function public.dispatch_tick(timestamptz) from public, anon, authenticated;
grant execute on function public.dispatch_tick(timestamptz) to service_role;

do $$
begin
  if to_regnamespace('cron') is not null then
    perform cron.schedule('antarkita_dispatch', '10 seconds', 'select public.dispatch_tick()');
  end if;
exception when others then raise notice '0122: cron antarkita_dispatch tidak dijadwalkan (%)', sqlerrm;
end $$;

-- ---------------------------------------------------------------------
-- 6. Kait untuk accept / decline / lepas
-- ---------------------------------------------------------------------
-- dipanggil driver_accept_order sebelum update: penawaran aktif milik driver lain → tolak
create or replace function public.dispatch_accept_guard(p_order uuid, p_driver uuid)
returns void language plpgsql security definer set search_path = public as $$
declare f order_offers;
begin
  f := dispatch_active_offer(p_order, now());
  if f.id is not null and f.driver_id <> p_driver then
    raise exception 'OFFER_HELD: order sedang ditawarkan ke driver lain (% dtk). Tunggu giliran atau pilih order lain.', greatest(0, ceil(extract(epoch from f.expires_at - now())))::int;
  end if;
end $$;
revoke all on function public.dispatch_accept_guard(uuid, uuid) from public, anon, authenticated;
grant execute on function public.dispatch_accept_guard(uuid, uuid) to service_role;

-- dipanggil driver_accept_order sesudah update: baris pemenang 'accepted' (+jarak saat terima), penawaran lain dibatalkan
create or replace function public.dispatch_on_accept(p_order uuid, p_driver uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_dist numeric;
begin
  select st_distance(o.pickup_location, d.location) into v_dist from orders o join drivers d on d.id = p_driver where o.id = p_order;
  insert into order_offers (order_id, driver_id, round, offered_at, expires_at, status, responded_at, distance_m, accept_dist_m)
  values (p_order, p_driver, 0, now(), now(), 'accepted', now(), round(coalesce(v_dist, 0)), round(coalesce(v_dist, 0)))
  on conflict (order_id, driver_id) do update set status = 'accepted', responded_at = now(), accept_dist_m = round(coalesce(v_dist, 0)), reason = null;
  update order_offers set status = 'cancelled', reason = 'taken', responded_at = now() where order_id = p_order and driver_id <> p_driver and status = 'offered';
end $$;
revoke all on function public.dispatch_on_accept(uuid, uuid) from public, anon, authenticated;
grant execute on function public.dispatch_on_accept(uuid, uuid) to service_role;

-- dipanggil cancel_order saat driver melepas order (kembali searching)
create or replace function public.dispatch_on_driver_release(p_order uuid, p_driver uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update order_offers set status = 'cancelled', reason = coalesce(p_reason, 'driver_cancel'), responded_at = now() where order_id = p_order and driver_id = p_driver and status in ('accepted', 'offered');
  insert into order_rejections (order_id, driver_id, reason) values (p_order, p_driver, coalesce(p_reason, 'driver_cancel'))
    on conflict (order_id, driver_id) do update set reason = coalesce(excluded.reason, order_rejections.reason), created_at = now();
end $$;
revoke all on function public.dispatch_on_driver_release(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.dispatch_on_driver_release(uuid, uuid, text) to service_role;

-- driver menolak penawaran → ronde berikutnya seketika
create or replace function public.driver_decline_offer(p_offer uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare f order_offers; d jsonb;
begin
  select * into f from order_offers where id = p_offer for update;
  if not found or f.driver_id <> auth.uid() then raise exception 'Penawaran tidak ditemukan'; end if;
  if f.status <> 'offered' then return jsonb_build_object('ok', false, 'status', f.status, 'order_id', f.order_id); end if;
  update order_offers set status = 'declined', responded_at = now(), reason = nullif(btrim(coalesce(p_reason, '')), '') where id = f.id;
  insert into order_rejections (order_id, driver_id, reason) values (f.order_id, f.driver_id, nullif(btrim(coalesce(p_reason, '')), ''))
    on conflict (order_id, driver_id) do update set reason = coalesce(excluded.reason, order_rejections.reason), created_at = now();
  begin
    d := dispatch_offer_next(f.order_id, now());
  exception when others then d := jsonb_build_object('mode', 'error', 'error', left(sqlerrm, 160));
  end;
  return jsonb_build_object('ok', true, 'offer_id', f.id, 'order_id', f.order_id, 'status', 'declined', 'next', d,
    'rejections_today', (select count(*) from order_rejections where driver_id = auth.uid() and created_at > now() - interval '24 hours'));
end $$;
revoke all on function public.driver_decline_offer(uuid, text) from public, anon;
grant execute on function public.driver_decline_offer(uuid, text) to authenticated;

-- penawaran aktif saya (1 objek atau null)
create or replace function public.driver_offer_mine()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'offer_id', f.id, 'order_id', o.id, 'code', o.code, 'round', f.round, 'offered_at', f.offered_at, 'expires_at', f.expires_at,
    'seconds_left', greatest(0, ceil(extract(epoch from f.expires_at - now())))::int,
    'service', o.service, 'service_label', service_label(o.service), 'pickup_address', o.pickup_address, 'dropoff_address', o.dropoff_address,
    'pickup_lat', o.pickup_lat, 'pickup_lng', o.pickup_lng, 'dropoff_lat', o.dropoff_lat, 'dropoff_lng', o.dropoff_lng,
    'distance_km', o.distance_km, 'distance_to_pickup_km', round((f.distance_m / 1000.0)::numeric, 2),
    'fare_delivery', o.fare_delivery, 'items_subtotal', o.items_subtotal, 'total', o.total, 'driver_earning', o.driver_earning,
    'driver_service_share', o.driver_service_share, 'payment_method', o.payment_method, 'merchant_name', coalesce(m.name, o.shop_store),
    'vehicle_class', o.vehicle_class, 'helpers', o.helpers, 'weight_kg', o.weight_kg, 'notes', o.notes, 'created_at', o.created_at)
  from order_offers f join orders o on o.id = f.order_id left join merchants m on m.id = o.merchant_id
  where f.driver_id = auth.uid() and f.status = 'offered' and f.expires_at > now() and o.status = 'searching'
  order by f.offered_at desc limit 1;
$$;
revoke all on function public.driver_offer_mine() from public, anon;
grant execute on function public.driver_offer_mine() to authenticated;

create or replace function public.admin_dispatch_summary()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform admin_require('orders_view');
  return jsonb_build_object(
    'cfg', dispatch_cfg(),
    'offers_24h', (select count(*) from order_offers where offered_at > now() - interval '24 hours'),
    'accepted_24h', (select count(*) from order_offers where status = 'accepted' and round > 0 and responded_at > now() - interval '24 hours'),
    'declined_24h', (select count(*) from order_offers where status = 'declined' and responded_at > now() - interval '24 hours'),
    'expired_24h', (select count(*) from order_offers where status = 'expired' and responded_at > now() - interval '24 hours'),
    'released_no_move_7d', (select count(*) from fraud_flags where kind = 'accept_no_move' and created_at > now() - interval '7 days'),
    'active_offers', (select count(*) from order_offers where status = 'offered' and expires_at > now()),
    'searching_orders', (select count(*) from orders where status = 'searching'),
    'avg_round_accepted_7d', (select round(avg(round), 2) from order_offers where status = 'accepted' and round > 0 and responded_at > now() - interval '7 days'),
    'cron', (case when to_regclass('cron.job') is not null then (select exists (select 1 from cron.job where jobname = 'antarkita_dispatch')) else null end));
end $$;
revoke all on function public.admin_dispatch_summary() from public, anon;
grant execute on function public.admin_dispatch_summary() to authenticated;

-- ---------------------------------------------------------------------
-- 7. driver_available_orders — tipe hasil berubah (kolom tambahan) → drop + create
-- ---------------------------------------------------------------------
drop function if exists public.driver_available_orders();
create function public.driver_available_orders()
returns table(id uuid, code text, service service_type, pickup_address text, dropoff_address text, pickup_lat double precision, pickup_lng double precision,
  dropoff_lat double precision, dropoff_lng double precision, distance_km numeric, fare_delivery bigint, items_subtotal bigint, total bigint, driver_earning bigint,
  payment_method payment_method, merchant_status merchant_order_status, created_at timestamptz, distance_to_pickup_km numeric, merchant_name text, vehicle_class text,
  helpers integer, scheduled_at timestamptz, send_scope text, shop_vehicle text, driver_service_share bigint, weight_kg numeric, parcel_size_cm numeric,
  waiting_minutes numeric, priority_note text, direct_for_me boolean, direct_hold_left_s integer,
  offer_id uuid, offer_expires_at timestamptz, offer_round integer, offer_seconds_left integer, dispatch_mode text)
language plpgsql stable security definer set search_path = public as $$
declare d drivers%rowtype; v_delay int; v_hold numeric; v_fallback boolean;
begin
  select * into d from drivers where drivers.id = auth.uid();
  if not found or d.status <> 'approved' then return; end if;
  v_delay := driver_priority_delay_s(d.rating_avg, d.rating_count);
  v_hold := setting_num('direct_order_hold_seconds', 120);
  v_fallback := setting_flag('direct_order_fallback', true);
  return query
  select o.id, o.code, o.service, o.pickup_address, o.dropoff_address,
    o.pickup_lat, o.pickup_lng, o.dropoff_lat, o.dropoff_lng,
    o.distance_km, o.fare_delivery, o.items_subtotal, o.total, o.driver_earning,
    o.payment_method, o.merchant_status, o.created_at,
    round((st_distance(o.pickup_location, d.location) / 1000.0)::numeric, 2), coalesce(m.name, o.shop_store),
    o.vehicle_class, o.helpers, o.scheduled_at, o.send_scope, o.shop_vehicle, o.driver_service_share,
    o.weight_kg, nullif(o.package_details->>'size_cm','')::numeric,
    round((extract(epoch from now() - o.created_at) / 60.0)::numeric, 1),
    case when fm.id is not null then 'Ditawarkan khusus untuk Anda — ronde ' || fm.round
         when v_delay = 0 then 'Prioritas tertinggi — rating Anda bagus'
         when extract(epoch from now() - o.created_at) < v_delay then null
         else 'Dibuka untuk semua driver setelah ' || v_delay || ' detik' end,
    (o.preferred_driver_id is not null and o.preferred_driver_id = d.id),
    case when o.preferred_driver_id is null then null
         else greatest(0, ceil(v_hold - extract(epoch from now() - o.created_at)))::int end,
    fm.id, fm.expires_at, fm.round,
    case when fm.id is null then null else greatest(0, ceil(extract(epoch from fm.expires_at - now())))::int end,
    case when fm.id is not null then 'offer' when o.preferred_driver_id = d.id then 'direct' else 'broadcast' end
  from orders o
  left join merchants m on m.id = o.merchant_id
  left join order_offers fm on fm.order_id = o.id and fm.driver_id = d.id and fm.status = 'offered' and fm.expires_at > now()
  where o.status = 'searching'
    and not order_payment_pending(o)
    and driver_can_take(d, o)
    and (o.merchant_status is null or o.merchant_status <> 'rejected')
    and d.location is not null
    and not exists (select 1 from order_rejections r where r.order_id = o.id and r.driver_id = d.id)
    and (
      fm.id is not null
      or (
        not exists (select 1 from order_offers fx where fx.order_id = o.id and fx.status = 'offered' and fx.expires_at > now())
        and st_dwithin(o.pickup_location, d.location, pickup_radius_km(o.service) * 1000)
        and extract(epoch from now() - o.created_at) >= v_delay
        and (o.preferred_driver_id is null
             or o.preferred_driver_id = d.id
             or (v_fallback and extract(epoch from now() - o.created_at) >= v_hold))
      )
    )
  order by (fm.id is not null) desc, 30 desc nulls last, 18 asc limit 20;
end $$;
revoke all on function public.driver_available_orders() from public, anon;
grant execute on function public.driver_available_orders() to authenticated;

-- ---------------------------------------------------------------------
-- 8. Tambalan fungsi lama (jangkar = baris KODE tanpa komentar)
-- ---------------------------------------------------------------------
-- driver_accept_order: penjaga penawaran + pencatatan accept
select _v3_splice('0122', 'public.driver_accept_order(uuid)',
  $a$if not found or not driver_can_take(d, o) then raise exception 'Order sudah diambil driver lain atau tidak cocok dengan kendaraan Anda'; end if;$a$,
  $a$if not found or not driver_can_take(d, o) then raise exception 'Order sudah diambil driver lain atau tidak cocok dengan kendaraan Anda'; end if;
  perform dispatch_accept_guard(o.id, d.id);$a$,
  'dispatch_accept_guard(o.id');
select _v3_splice('0122', 'public.driver_accept_order(uuid)',
  $a$insert into order_events (order_id, status, actor_id, note) values (o.id, 'accepted', d.id, 'Driver menerima pesanan');$a$,
  $a$insert into order_events (order_id, status, actor_id, note) values (o.id, 'accepted', d.id, 'Driver menerima pesanan');
  perform dispatch_on_accept(o.id, d.id);$a$,
  'dispatch_on_accept(o.id');

-- driver_reject_order lama: ikut menolak penawaran aktif untuk order itu
select _v3_splice('0122', 'public.driver_reject_order(uuid,text)',
  $a$if o.driver_id = auth.uid() then raise exception 'Pesanan sudah Anda terima — gunakan menu batalkan bila perlu'; end if;$a$,
  $a$if o.driver_id = auth.uid() then raise exception 'Pesanan sudah Anda terima — gunakan menu batalkan bila perlu'; end if;
  update order_offers set status = 'declined', responded_at = now(), reason = nullif(trim(coalesce(p_reason,'')),'') where order_id = p_order and driver_id = auth.uid() and status = 'offered';$a$,
  'update order_offers set status = ''declined''');

-- cancel_order: driver melepas → penawaran dibatalkan + dikecualikan; pelanggan/admin batal → semua penawaran aktif dibatalkan
select _v3_splice('0122', 'public.cancel_order(uuid,text)',
  $a$update orders set driver_id = null, status = 'searching', accepted_at = null, arrived_at = null where id = o.id returning * into o;$a$,
  $a$update orders set driver_id = null, status = 'searching', accepted_at = null, arrived_at = null where id = o.id returning * into o;
    perform dispatch_on_driver_release(o.id, v_uid, 'driver_cancel');$a$,
  'dispatch_on_driver_release(o.id');
select _v3_splice('0122', 'public.cancel_order(uuid,text)',
  $a$if o.promo_code is not null then update promos set used_count = greatest(0, used_count - 1) where code = o.promo_code; end if;$a$,
  $a$if o.promo_code is not null then update promos set used_count = greatest(0, used_count - 1) where code = o.promo_code; end if;
  update order_offers set status = 'cancelled', reason = 'order_cancelled', responded_at = now() where order_id = o.id and status = 'offered';$a$,
  'reason = ''order_cancelled''');

-- create_order: penawaran ronde 1 seketika bila dispatch_offer_on_create (default false; gagal tidak menggagalkan pesanan)
select _v3_splice('0122', 'public.create_order(jsonb,uuid)',
  $a$perform ledger_post(v_order.id, 'created');$a$,
  $a$perform ledger_post(v_order.id, 'created');
  if v_order.status = 'searching' and setting_flag('dispatch_offer_on_create', false) then
    begin perform dispatch_offer_next(v_order.id, now()); exception when others then null; end;
  end if;$a$,
  'dispatch_offer_on_create');

-- spesifikasi setelan
select _v3_splice('0122', 'public.app_setting_specs()',
  $a$('direct_order_hold_seconds',  'int',     0, 3600, null, null, 'detik', 'OTOMASI', 'Tahan order langsung', 'orders'),$a$,
  $a$('direct_order_hold_seconds',  'int',     0, 3600, null, null, 'detik', 'OTOMASI', 'Tahan order langsung', 'orders'),
    ('dispatch_enabled',                  'bool',    null, null, null, 'true', '', 'OTOMASI', '0122: penawaran bertahap ke driver terdekat (false = siaran lama saja)', 'orders'),
    ('dispatch_offer_seconds',            'int',     5, 300, null, '25', 'detik', 'OTOMASI', '0122: lama tiap penawaran [ASUMSI]', 'orders'),
    ('dispatch_offer_rounds',             'int',     1, 50, null, '6', 'ronde', 'OTOMASI', '0122: jumlah ronde sebelum siaran [ASUMSI]', 'orders'),
    ('dispatch_offer_radius_step_km',     'numeric', 0.2, 50, null, '1', 'km', 'OTOMASI', '0122: radius bertambah per ronde (dibatasi pickup_radius_km) [ASUMSI]', 'orders'),
    ('dispatch_accept_no_move_minutes',   'int',     1, 60, null, '5', 'menit', 'OTOMASI', '0122: diterima tanpa bergerak → order dialihkan [ASUMSI]', 'orders'),
    ('dispatch_no_move_min_progress_m',   'int',     50, 5000, null, '300', 'meter', 'OTOMASI', '0122: jarak ke jemput harus mengecil minimal sekian [ASUMSI]', 'orders'),
    ('dispatch_priority_penalty_m_per_s', 'int',     0, 1000, null, '20', 'm/dtk', 'OTOMASI', '0122: penalti jarak per detik prioritas rating saat memilih kandidat [ASUMSI]', 'orders'),
    ('dispatch_no_move_suspend_count',    'int',     1, 50, null, '3', 'flag/7 hari', 'KEAMANAN', '0122: flag accept_no_move dalam 7 hari → tangguhkan otomatis [ASUMSI]', 'driver'),
    ('dispatch_offer_on_create',          'bool',    null, null, null, 'false', '', 'OTOMASI', '0122: buat penawaran ronde 1 seketika saat pesanan dibuat (tanpa menunggu cron)', 'orders'),$a$,
  'dispatch_offer_seconds');

-- ---------------------------------------------------------------------
-- 9. Penjaga
-- ---------------------------------------------------------------------
do $$
declare v_cron boolean := false;
begin
  if to_regclass('public.order_offers') is null then raise exception '0122 batal: tabel order_offers belum ada'; end if;
  if position('dispatch_accept_guard' in pg_get_functiondef('public.driver_accept_order(uuid)'::regprocedure)) = 0 then raise exception '0122 batal: driver_accept_order belum memakai penjaga penawaran'; end if;
  if position('dispatch_on_accept' in pg_get_functiondef('public.driver_accept_order(uuid)'::regprocedure)) = 0 then raise exception '0122 batal: driver_accept_order belum mencatat accept'; end if;
  if position('dispatch_on_driver_release' in pg_get_functiondef('public.cancel_order(uuid,text)'::regprocedure)) = 0 then raise exception '0122 batal: cancel_order belum melepas penawaran'; end if;
  if position('order_cancelled' in pg_get_functiondef('public.cancel_order(uuid,text)'::regprocedure)) = 0 then raise exception '0122 batal: cancel_order belum membatalkan penawaran aktif'; end if;
  if position('order_offers' in pg_get_functiondef('public.driver_reject_order(uuid,text)'::regprocedure)) = 0 then raise exception '0122 batal: driver_reject_order belum menolak penawaran'; end if;
  if position('dispatch_offer_on_create' in pg_get_functiondef('public.create_order(jsonb,uuid)'::regprocedure)) = 0 then raise exception '0122 batal: create_order belum punya kait dispatch_offer_on_create'; end if;
  if position('offer_id' in pg_get_functiondef('public.driver_available_orders()'::regprocedure)) = 0 then raise exception '0122 batal: driver_available_orders belum memuat offer_id'; end if;
  if not exists (select 1 from app_setting_specs() where key = 'dispatch_offer_seconds') then raise exception '0122 batal: app_setting_specs belum memuat dispatch_*'; end if;
  if (select count(*) from app_settings where key like 'dispatch_%') < 9 then raise exception '0122 batal: setelan dispatch belum lengkap'; end if;
  if to_regclass('cron.job') is not null then
    execute $q$select exists (select 1 from cron.job where jobname = 'antarkita_dispatch')$q$ into v_cron;
  end if;
  raise notice '0122 ok: cfg=%, cron=%', dispatch_cfg(), v_cron;
end $$;
