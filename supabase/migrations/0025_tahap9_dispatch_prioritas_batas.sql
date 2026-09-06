-- =====================================================================
-- 0025 — Tahap 9: dispatch dinamis, prioritas driver, tombol tolak,
--        matriks layanan-kendaraan + batas berat/dimensi AntarSend,
--        titipan antar kota lewat mitra travel.
-- Semua ambang batas dapat diubah admin lewat app_settings (admin_set_settings).
-- =====================================================================

-- ---------- 1. Setelan dinamis ----------
insert into app_settings (key, value) values
  ('pickup_radius_km', '{"ride_motor":5,"ride_car":8,"food":5,"send":6,"shop":5,"market":5,"box":15,"default":5}'::jsonb),
  ('send_limits', '{"motor":{"max_kg":20,"max_cm":60},"car":{"max_kg":150,"max_cm":160},"box":{"max_kg":1000,"max_cm":300},"travel":{"max_kg":30,"max_cm":120}}'::jsonb),
  ('priority_tiers', '[{"min_rating":4.8,"delay_s":0},{"min_rating":4.5,"delay_s":20},{"min_rating":4.0,"delay_s":45},{"min_rating":0,"delay_s":75}]'::jsonb),
  ('wait_apology_minutes', '5'::jsonb),
  ('travel_send_partner_pct', '80'::jsonb)
on conflict (key) do nothing;

-- Radius driver melihat order, per layanan (bisa diubah admin kapan saja)
create or replace function pickup_radius_km(p_service service_type)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(
    nullif((select value -> p_service::text from app_settings where key = 'pickup_radius_km'), 'null')::numeric,
    nullif((select value ->> 'default' from app_settings where key = 'pickup_radius_km'), '')::numeric,
    setting_num('search_radius_km', 5));
$$;

-- Batas berat/dimensi AntarSend per kendaraan
create or replace function send_limit(p_vehicle text)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((select value -> p_vehicle from app_settings where key = 'send_limits'),
    case p_vehicle when 'motor' then '{"max_kg":20,"max_cm":60}'::jsonb when 'car' then '{"max_kg":150,"max_cm":160}'::jsonb
                   when 'box' then '{"max_kg":1000,"max_cm":300}'::jsonb else '{"max_kg":30,"max_cm":120}'::jsonb end);
$$;

/** Kendaraan minimal yang sanggup membawa paket; null bila melebihi semua batas. */
create or replace function send_required_vehicle(p_weight numeric, p_size_cm numeric)
returns text language sql stable security definer set search_path = public as $$
  select case
    when coalesce(p_weight,0) <= (send_limit('motor')->>'max_kg')::numeric and coalesce(p_size_cm,0) <= (send_limit('motor')->>'max_cm')::numeric then 'motor'
    when coalesce(p_weight,0) <= (send_limit('car')->>'max_kg')::numeric   and coalesce(p_size_cm,0) <= (send_limit('car')->>'max_cm')::numeric   then 'car'
    when coalesce(p_weight,0) <= (send_limit('box')->>'max_kg')::numeric   and coalesce(p_size_cm,0) <= (send_limit('box')->>'max_cm')::numeric   then 'box'
    else null end;
$$;

/** Jeda (detik) sebelum order tampil ke driver — makin tinggi rating makin cepat melihat order. */
create or replace function driver_priority_delay_s(p_rating numeric, p_count integer)
returns integer language sql stable security definer set search_path = public as $$
  -- driver baru (< 5 ulasan) dianggap 4.6 supaya tetap dapat order tapi tidak mendahului driver terbaik
  select coalesce((
    select (t->>'delay_s')::int
    from jsonb_array_elements(coalesce((select value from app_settings where key = 'priority_tiers'),
      '[{"min_rating":4.8,"delay_s":0},{"min_rating":4.5,"delay_s":20},{"min_rating":4.0,"delay_s":45},{"min_rating":0,"delay_s":75}]'::jsonb)) t
    where (case when coalesce(p_count,0) < 5 then 4.6 else coalesce(p_rating, 4.6) end) >= (t->>'min_rating')::numeric
    order by (t->>'min_rating')::numeric desc limit 1), 0);
$$;

-- ---------- 2. Tombol TOLAK di aplikasi Mitra ----------
create table if not exists order_rejections (
  order_id uuid not null references orders(id) on delete cascade,
  driver_id uuid not null references profiles(id) on delete cascade,
  reason text,
  created_at timestamptz not null default now(),
  primary key (order_id, driver_id)
);
create index if not exists order_rejections_driver_idx on order_rejections (driver_id, created_at desc);
alter table order_rejections enable row level security;
drop policy if exists "tolak milik sendiri" on order_rejections;
create policy "tolak milik sendiri" on order_rejections for select to authenticated using (driver_id = auth.uid() or is_admin());

create or replace function driver_reject_order(p_order uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d drivers%rowtype; o orders%rowtype;
begin
  select * into d from drivers where id = auth.uid();
  if not found then raise exception 'Hanya mitra driver'; end if;
  select * into o from orders where id = p_order;
  if not found then raise exception 'Pesanan tidak ditemukan'; end if;
  if o.driver_id = auth.uid() then raise exception 'Pesanan sudah Anda terima — gunakan menu batalkan bila perlu'; end if;
  insert into order_rejections(order_id, driver_id, reason) values (p_order, auth.uid(), nullif(trim(coalesce(p_reason,'')),''))
  on conflict (order_id, driver_id) do update set reason = coalesce(excluded.reason, order_rejections.reason), created_at = now();
  return jsonb_build_object('ok', true, 'order_id', p_order,
    'hidden', true, 'rejections_today', (select count(*) from order_rejections where driver_id = auth.uid() and created_at > now() - interval '24 hours'));
end $$;
revoke all on function driver_reject_order(uuid, text) from public, anon;
grant execute on function driver_reject_order(uuid, text) to authenticated;

/** Info antrean prioritas untuk kartu di aplikasi Mitra. */
create or replace function driver_priority_info()
returns jsonb language plpgsql security definer set search_path = public as $$
declare d drivers%rowtype; v_delay int; v_next numeric;
begin
  select * into d from drivers where id = auth.uid();
  if not found then raise exception 'Hanya mitra driver'; end if;
  v_delay := driver_priority_delay_s(d.rating_avg, d.rating_count);
  select min((t->>'min_rating')::numeric) into v_next from jsonb_array_elements(
    coalesce((select value from app_settings where key = 'priority_tiers'), '[]'::jsonb)) t
   where (t->>'delay_s')::int < v_delay;
  return jsonb_build_object(
    'rating', coalesce(d.rating_avg, 0), 'rating_count', coalesce(d.rating_count, 0),
    'tier_delay_s', v_delay, 'next_tier_rating', v_next,
    'is_new_driver', coalesce(d.rating_count,0) < 5,
    'drivers_ahead', (select count(*) from drivers x where x.status = 'approved' and x.is_online
                      and driver_priority_delay_s(x.rating_avg, x.rating_count) < v_delay),
    'tiers', coalesce((select value from app_settings where key = 'priority_tiers'), '[]'::jsonb));
end $$;
revoke all on function driver_priority_info() from public, anon;
grant execute on function driver_priority_info() to authenticated;

-- ---------- 3. Matriks layanan-kendaraan + batas muatan ----------
create or replace function driver_can_take(d drivers, o orders)
returns boolean language sql stable as $$
  select case
    when o.service = 'ride_motor' then d.vehicle_type = 'motor'
    when o.service = 'ride_car'   then d.vehicle_type = 'car'
    when o.service = 'box'        then d.vehicle_type in ('box','pickup')
    when o.service = 'food'       then d.vehicle_type in ('motor','car')
    when o.service = 'send'       then
      -- titipan antar kota yang dititipkan ke mitra travel bukan untuk driver kota
      coalesce(o.package_details->>'via','driver') <> 'travel'
      and case send_required_vehicle(o.weight_kg, nullif(o.package_details->>'size_cm','')::numeric)
            when 'motor' then d.vehicle_type in ('motor','car','box','pickup')
            when 'car'   then d.vehicle_type in ('car','box','pickup')
            when 'box'   then d.vehicle_type in ('box','pickup')
            else false end
    when o.service in ('shop','market') and o.shop_vehicle = 'car' then d.vehicle_type = 'car'
    else d.vehicle_type in ('motor','car')
  end
  and (o.vehicle_class is null or exists (
    select 1 from vehicle_classes oc join vehicle_classes dc on dc.code = coalesce(d.vehicle_class, derive_vehicle_class(d.vehicle_type, d.vehicle_year, d.vehicle_condition, d.is_electric))
    where oc.code = o.vehicle_class and (not oc.is_ev or d.is_electric)
      and (dc.rank >= oc.rank or (o.status = 'searching' and o.created_at < now() - (setting_num('class_fallback_minutes', 3) || ' minutes')::interval))))
$$;

-- ---------- 4. Feed order driver: radius dinamis, tolak, prioritas rating ----------
drop function if exists driver_available_orders();
create or replace function driver_available_orders()
returns table(id uuid, code text, service service_type, pickup_address text, dropoff_address text,
  pickup_lat double precision, pickup_lng double precision, dropoff_lat double precision, dropoff_lng double precision,
  distance_km numeric, fare_delivery bigint, items_subtotal bigint, total bigint, driver_earning bigint,
  payment_method payment_method, merchant_status merchant_order_status, created_at timestamptz, distance_to_pickup_km numeric, merchant_name text,
  vehicle_class text, helpers int, scheduled_at timestamptz, send_scope text, shop_vehicle text, driver_service_share bigint,
  weight_kg numeric, parcel_size_cm numeric, waiting_minutes numeric, priority_note text)
language plpgsql stable security definer set search_path = public as $$
declare d drivers%rowtype; v_delay int;
begin
  select * into d from drivers where drivers.id = auth.uid();
  if not found or d.status <> 'approved' then return; end if;
  v_delay := driver_priority_delay_s(d.rating_avg, d.rating_count);
  return query
  select o.id, o.code, o.service, o.pickup_address, o.dropoff_address,
    o.pickup_lat, o.pickup_lng, o.dropoff_lat, o.dropoff_lng,
    o.distance_km, o.fare_delivery, o.items_subtotal, o.total, o.driver_earning,
    o.payment_method, o.merchant_status, o.created_at,
    round((st_distance(o.pickup_location, d.location) / 1000.0)::numeric, 2), coalesce(m.name, o.shop_store),
    o.vehicle_class, o.helpers, o.scheduled_at, o.send_scope, o.shop_vehicle, o.driver_service_share,
    o.weight_kg, nullif(o.package_details->>'size_cm','')::numeric,
    round((extract(epoch from now() - o.created_at) / 60.0)::numeric, 1),
    case when v_delay = 0 then 'Prioritas tertinggi — rating Anda bagus'
         when extract(epoch from now() - o.created_at) < v_delay then null
         else 'Dibuka untuk semua driver setelah ' || v_delay || ' detik' end
  from orders o left join merchants m on m.id = o.merchant_id
  where o.status = 'searching'
    and driver_can_take(d, o)
    and (o.merchant_status is null or o.merchant_status <> 'rejected')
    and d.location is not null
    and st_dwithin(o.pickup_location, d.location, pickup_radius_km(o.service) * 1000)
    and extract(epoch from now() - o.created_at) >= v_delay
    and not exists (select 1 from order_rejections r where r.order_id = o.id and r.driver_id = d.id)
  order by 18 asc limit 20;
end $$;
grant execute on function driver_available_orders() to authenticated;

-- ---------- 5. AntarSend antar kota lewat mitra travel ----------
alter table orders add column if not exists travel_partner_id uuid references travel_partners(id);
create index if not exists orders_travel_partner_idx on orders (travel_partner_id) where travel_partner_id is not null;

drop policy if exists "mitra travel lihat titipan" on orders;
create policy "mitra travel lihat titipan" on orders for select to authenticated
  using (travel_partner_id = auth.uid()
     or (service = 'send' and status = 'searching' and coalesce(package_details->>'via','') = 'travel'
         and exists (select 1 from travel_partners tp where tp.id = auth.uid() and tp.status = 'approved')));

/** Titipan antar kota yang menunggu mitra travel (sudah disaring batas berat & dimensi). */
create or replace function travel_send_available()
returns jsonb language plpgsql security definer set search_path = public as $$
declare tp travel_partners%rowtype; v_lim jsonb := send_limit('travel');
begin
  select * into tp from travel_partners where id = auth.uid();
  if not found or tp.status <> 'approved' then raise exception 'Hanya mitra travel aktif'; end if;
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from (
    select o.id, o.code, o.pickup_address, o.dropoff_address, o.city, c2.name as dest_city,
      o.weight_kg, nullif(o.package_details->>'size_cm','')::numeric as size_cm, o.package_details,
      o.recipient_name, o.total, o.intercity_fare,
      round(o.intercity_fare * setting_num('travel_send_partner_pct', 80) / 100.0)::bigint as partner_earning,
      o.payment_method, o.payment_status, o.created_at
    from orders o left join cities c2 on c2.id = o.dest_city_id
    where o.service = 'send' and o.status = 'searching' and coalesce(o.package_details->>'via','') = 'travel'
      and coalesce(o.weight_kg,0) <= (v_lim->>'max_kg')::numeric
      and coalesce(nullif(o.package_details->>'size_cm','')::numeric,0) <= (v_lim->>'max_cm')::numeric
    limit 50) x), '[]'::jsonb);
end $$;
revoke all on function travel_send_available() from public, anon;
grant execute on function travel_send_available() to authenticated;

create or replace function travel_accept_send(p_order uuid)
returns orders language plpgsql security definer set search_path = public as $$
declare tp travel_partners%rowtype; o orders%rowtype; v_lim jsonb := send_limit('travel');
begin
  select * into tp from travel_partners where id = auth.uid();
  if not found or tp.status <> 'approved' then raise exception 'Hanya mitra travel aktif'; end if;
  select * into o from orders where id = p_order for update;
  if not found then raise exception 'Titipan tidak ditemukan'; end if;
  if o.status <> 'searching' or coalesce(o.package_details->>'via','') <> 'travel' then raise exception 'Titipan ini sudah diambil mitra lain'; end if;
  if coalesce(o.weight_kg,0) > (v_lim->>'max_kg')::numeric or coalesce(nullif(o.package_details->>'size_cm','')::numeric,0) > (v_lim->>'max_cm')::numeric then
    raise exception 'Ukuran/berat titipan melebihi batas mitra travel (maks % kg, sisi terpanjang % cm)', v_lim->>'max_kg', v_lim->>'max_cm';
  end if;
  update orders set travel_partner_id = tp.id, status = 'accepted', accepted_at = now(), updated_at = now() where id = p_order returning * into o;
  insert into order_events(order_id, status, note) values (p_order, 'accepted', 'Titipan diambil mitra travel ' || coalesce(tp.company_name, tp.driver_name, 'AntarTravel'));
  insert into notifications (user_id, kind, title, body, data) values (o.customer_id, 'order', 'Titipan Anda diambil mitra travel',
    'Paket ' || o.code || ' akan dibawa mitra AntarTravel. Pantau statusnya di aplikasi.', jsonb_build_object('order_id', o.id));
  return o;
end $$;
revoke all on function travel_accept_send(uuid) from public, anon;
grant execute on function travel_accept_send(uuid) to authenticated;

create or replace function travel_pickup_send(p_order uuid)
returns orders language plpgsql security definer set search_path = public as $$
declare o orders%rowtype;
begin
  select * into o from orders where id = p_order and travel_partner_id = auth.uid() for update;
  if not found then raise exception 'Titipan bukan milik Anda'; end if;
  if o.status <> 'accepted' then raise exception 'Status titipan tidak sesuai'; end if;
  update orders set status = 'in_progress', started_at = now(), updated_at = now() where id = p_order returning * into o;
  insert into order_events(order_id, status, note) values (p_order, 'in_progress', 'Titipan dijemput mitra travel, dalam perjalanan antar kota');
  insert into notifications (user_id, kind, title, body, data) values (o.customer_id, 'order', 'Titipan dalam perjalanan', 'Paket ' || o.code || ' sedang dibawa menuju kota tujuan.', jsonb_build_object('order_id', o.id));
  return o;
end $$;
revoke all on function travel_pickup_send(uuid) from public, anon;
grant execute on function travel_pickup_send(uuid) to authenticated;

create or replace function travel_complete_send(p_order uuid)
returns orders language plpgsql security definer set search_path = public as $$
declare o orders%rowtype; v_earn bigint;
begin
  select * into o from orders where id = p_order and travel_partner_id = auth.uid() for update;
  if not found then raise exception 'Titipan bukan milik Anda'; end if;
  if o.status <> 'in_progress' then raise exception 'Titipan belum dijemput'; end if;
  v_earn := round(coalesce(o.intercity_fare,0) * setting_num('travel_send_partner_pct', 80) / 100.0)::bigint;
  update orders set status = 'completed', completed_at = now(), updated_at = now(),
    payment_status = case when o.payment_method = 'cash' then 'paid'::payment_status else o.payment_status end
  where id = p_order returning * into o;
  insert into order_events(order_id, status, note) values (p_order, 'completed', 'Titipan diterima di kota tujuan');
  if v_earn > 0 then perform wallet_apply(o.travel_partner_id, 'earning', v_earn, o.id, 'Pendapatan titipan antar kota ' || o.code); end if;
  insert into notifications (user_id, kind, title, body, data) values (o.customer_id, 'order', 'Titipan sudah sampai', 'Paket ' || o.code || ' sudah diterima di kota tujuan.', jsonb_build_object('order_id', o.id));
  return o;
end $$;
revoke all on function travel_complete_send(uuid) from public, anon;
grant execute on function travel_complete_send(uuid) to authenticated;

-- ---------- 6. create_order: validasi berat & dimensi AntarSend ----------
do $do$
declare def text;
  anchor text := $a$  if not service_enabled(v_service::text) then raise exception 'Layanan ini sedang dinonaktifkan sementara oleh admin'; end if;$a$;
  guard text := $g$  if v_service = 'send' then
    declare v_size numeric := nullif(p->>'size_cm','')::numeric; v_need text;
    begin
      v_need := send_required_vehicle(v_weight, v_size);
      if v_need is null then
        raise exception 'Paket % kg / % cm melebihi batas AntarSend (maks % kg, sisi terpanjang % cm). Gunakan AntarBox untuk barang sebesar ini.',
          coalesce(v_weight,0), coalesce(v_size,0), send_limit('box')->>'max_kg', send_limit('box')->>'max_cm';
      end if;
      if coalesce(p->>'via','') = 'travel' then
        if v_scope <> 'intercity' then raise exception 'Titipan lewat mitra travel hanya untuk kiriman antar kota'; end if;
        if coalesce(v_weight,0) > (send_limit('travel')->>'max_kg')::numeric or coalesce(v_size,0) > (send_limit('travel')->>'max_cm')::numeric then
          raise exception 'Titipan lewat mitra travel maksimal % kg dan sisi terpanjang % cm. Paket Anda % kg / % cm — gunakan gudang AntarSend.',
            send_limit('travel')->>'max_kg', send_limit('travel')->>'max_cm', coalesce(v_weight,0), coalesce(v_size,0);
        end if;
      end if;
    end;
  end if;$g$;
begin
  select pg_get_functiondef(p.oid) into def from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='create_order';
  if position('send_required_vehicle' in def) > 0 then return; end if;
  if position(anchor in def) = 0 then raise exception 'anchor create_order tidak ditemukan'; end if;
  execute replace(def, anchor, anchor || E'\n' || guard);
end $do$;

-- Simpan ukuran & jalur pengiriman ke package_details (dipakai dispatch & mitra travel)
do $do$
declare def text; old text := $o$p->'package_details', nullif(upper(p->>'promo_code'), '')$o$;
  neu text := $n$coalesce(p->'package_details','{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object('size_cm', nullif(p->>'size_cm',''), 'via', nullif(p->>'via',''))), nullif(upper(p->>'promo_code'), '')$n$;
begin
  select pg_get_functiondef(p.oid) into def from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='create_order';
  if position($x$'size_cm', nullif(p->>'size_cm','')$x$ in def) > 0 then return; end if;
  if position(old in def) = 0 then raise exception 'anchor package_details create_order tidak ditemukan'; end if;
  execute replace(def, old, neu);
end $do$;

-- ---------- 7. Setelan publik untuk aplikasi ----------
create or replace function app_public_settings()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'services_enabled', coalesce((select value from app_settings where key = 'services_enabled'), '{}'::jsonb),
    'max_km', jsonb_build_object('ride_motor', service_limit_km('ride_motor'), 'ride_car', service_limit_km('ride_car'), 'food', service_limit_km('food'),
                                 'send', service_limit_km('send'), 'shop', service_limit_km('shop'), 'market', service_limit_km('market'), 'box', service_limit_km('box')),
    'osm_import_enabled', coalesce((select value::text::boolean from app_settings where key = 'osm_import_enabled'), true),
    'osm_import_radius_km', setting_num('osm_import_radius_km', 5),
    'pickup_radius_km', coalesce((select value from app_settings where key = 'pickup_radius_km'), '{}'::jsonb),
    'send_limits', coalesce((select value from app_settings where key = 'send_limits'), '{}'::jsonb),
    'priority_tiers', coalesce((select value from app_settings where key = 'priority_tiers'), '[]'::jsonb),
    'wait_apology_minutes', setting_num('wait_apology_minutes', 5)
  );
$$;
grant execute on function app_public_settings() to anon, authenticated;

revoke all on function pickup_radius_km(service_type) from public, anon;
grant execute on function pickup_radius_km(service_type) to authenticated;
grant execute on function send_limit(text) to anon, authenticated;
grant execute on function send_required_vehicle(numeric, numeric) to anon, authenticated;
grant execute on function driver_priority_delay_s(numeric, integer) to authenticated;
