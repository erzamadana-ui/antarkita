-- =====================================================================
-- 0079 — Panel Admin: Kota & Wilayah + status kota nyata
--
--   admin_list_cities(...)        → daftar kota + status + layanan + daftar tunggu + driver
--   admin_city_drivers(city)      → hitungan driver di satu kota (dipakai dialog konfirmasi)
--   admin_set_city_status(...)    → ubah status kota; saat membuka, daftar layanan WAJIB
--   admin_set_city_service(...)   → buka/tutup satu layanan di satu kota
--   admin_set_city_manager(...)   → tunjuk Perwakilan Kota (PIC)
--   admin_city_waitlist(city)     → isi daftar tunggu satu kota
--
-- DATA NYATA YANG DIUBAH MIGRASI INI (hanya status kota, tidak ada yang lain):
--   Pekanbaru & Padang → 'aktif', seluruh layanan dibuka.
--   Tujuh kota lain (Batam, Bukittinggi, Dumai, Jakarta, Jambi, Medan, Palembang)
--   → 'belum_dilayani'. Kolom `cities.active` TIDAK disentuh.
-- =====================================================================

-- ---------- Hitungan driver di sekitar pusat kota ----------
-- Tabel drivers tidak menyimpan kota; kedekatan dihitung dari posisi terakhir driver.
create or replace function admin_city_drivers(p_city_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'approved', count(*) filter (where d.status = 'approved'),
    'online',   count(*) filter (where d.status = 'approved' and d.is_online and d.last_seen_at > now() - interval '15 minutes'),
    'recent',   count(*) filter (where d.status = 'approved' and d.last_seen_at > now() - interval '7 days'),
    'pending',  count(*) filter (where d.status = 'pending'))
  from drivers d
  join profiles pr on pr.id = d.id and pr.is_active
  join cities c on c.id = p_city_id
  where d.location is not null and c.location is not null
    and st_dwithin(d.location, c.location, greatest(c.radius_km, 1) * 1000);
$$;

-- ---------- Daftar kota untuk Panel Admin ----------
create or replace function admin_list_cities(p_q text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not is_admin() then raise exception 'Hanya admin'; end if;
  select coalesce(jsonb_agg(x order by x->>'service_status', x->>'name'), '[]'::jsonb) into v from (
    select jsonb_build_object(
      'id', c.id, 'name', c.name, 'province', c.province,
      'lat', c.lat, 'lng', c.lng,
      'active', c.active,                       -- arti lama: kota terdaftar di sistem
      'service_status', c.service_status,       -- arti baru: status operasi
      'status_note', c.status_note,
      'status_changed_at', c.status_changed_at,
      'radius_km', c.radius_km,
      'manager_id', c.manager_id,
      'manager_name', (select pr.full_name from profiles pr where pr.id = c.manager_id),
      'manager_note', c.manager_note,
      'services', city_open_services(c.id),
      'waitlist', (select count(*) from city_waitlist w where w.city_id = c.id),
      'waitlist_30d', (select count(*) from city_waitlist w where w.city_id = c.id and w.created_at > now() - interval '30 days'),
      'drivers', admin_city_drivers(c.id),
      'orders_30d', (select count(*) from orders o where o.city_id = c.id and o.created_at > now() - interval '30 days')
    ) as x
    from cities c
    where p_q is null or p_q = '' or c.name ilike '%' || p_q || '%' or coalesce(c.province, '') ilike '%' || p_q || '%'
  ) t;
  return v;
end $$;

-- ---------- Ubah status kota ----------
-- Membuka kota ('aktif') WAJIB menyertakan daftar layanan. Baris city_services
-- ditulis eksplisit untuk SEMUA layanan (yang tidak disebut = ditutup), sehingga
-- tidak pernah ada kota "aktif" yang diam-diam membuka layanan tanpa driver.
create or replace function admin_set_city_status(
  p_city_id uuid, p_status text, p_services text[] default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c cities%rowtype; v_uid uuid := auth.uid(); v_svc text[]; v_drv jsonb; sv service_type;
begin
  if not is_admin() then raise exception 'Hanya admin'; end if;
  if p_status not in ('belum_dilayani', 'segera', 'aktif') then raise exception 'Status kota tidak dikenal: %', p_status; end if;
  select * into c from cities where id = p_city_id;
  if not found then raise exception 'Kota tidak ditemukan'; end if;

  if p_status = 'aktif' then
    select array_agg(x) into v_svc from unnest(coalesce(p_services, '{}'::text[])) x
     where x in (select unnest(enum_range(null::service_type))::text);
    if coalesce(array_length(v_svc, 1), 0) = 0 then
      raise exception 'Membuka kota harus menyebut layanan mana yang dibuka. Tidak ada layanan yang dipilih.';
    end if;
  end if;

  update cities set service_status = p_status, status_note = nullif(trim(coalesce(p_note, '')), ''),
                    status_changed_at = now(), status_changed_by = v_uid
   where id = p_city_id;

  if p_status = 'aktif' then
    for sv in select unnest(enum_range(null::service_type)) loop
      insert into city_services (city_id, service, enabled, opened_at, opened_by, updated_at)
      values (p_city_id, sv, sv::text = any(v_svc), case when sv::text = any(v_svc) then now() end, v_uid, now())
      on conflict (city_id, service) do update
        set enabled = excluded.enabled,
            opened_at = case when excluded.enabled and not city_services.enabled then now() else city_services.opened_at end,
            opened_by = v_uid, updated_at = now();
    end loop;
  else
    -- kota ditutup: semua layanan ikut tertutup, riwayat pembukaan tetap tersimpan
    update city_services set enabled = false, updated_at = now() where city_id = p_city_id;
  end if;

  v_drv := admin_city_drivers(p_city_id);
  perform log_activity('city.status', 'cities', p_city_id::text,
    format('Status kota %s diubah menjadi %s (%s driver aktif di sekitar)', c.name, p_status, coalesce(v_drv->>'approved', '0')),
    jsonb_build_object('city', c.name, 'status', p_status, 'services', coalesce(to_jsonb(v_svc), '[]'::jsonb), 'drivers', v_drv, 'note', p_note));

  return jsonb_build_object('ok', true, 'city_id', p_city_id, 'city_name', c.name,
    'service_status', p_status, 'services', city_open_services(p_city_id), 'drivers', v_drv);
end $$;

-- ---------- Buka / tutup satu layanan ----------
create or replace function admin_set_city_service(p_city_id uuid, p_service text, p_enabled boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c cities%rowtype; v_uid uuid := auth.uid(); v_sv service_type;
begin
  if not is_admin() then raise exception 'Hanya admin'; end if;
  if p_service not in (select unnest(enum_range(null::service_type))::text) then raise exception 'Layanan tidak dikenal: %', p_service; end if;
  select * into c from cities where id = p_city_id;
  if not found then raise exception 'Kota tidak ditemukan'; end if;
  if p_enabled and c.service_status <> 'aktif' then
    raise exception 'Kota % masih berstatus %. Buka kotanya dulu sebelum membuka layanan.', c.name, c.service_status;
  end if;
  v_sv := p_service::service_type;

  insert into city_services (city_id, service, enabled, opened_at, opened_by, updated_at)
  values (p_city_id, v_sv, p_enabled, case when p_enabled then now() end, v_uid, now())
  on conflict (city_id, service) do update
    set enabled = excluded.enabled,
        opened_at = case when excluded.enabled and not city_services.enabled then now() else city_services.opened_at end,
        opened_by = v_uid, updated_at = now();

  perform log_activity('city.service', 'cities', p_city_id::text,
    format('%s %s di %s', service_label(v_sv), case when p_enabled then 'DIBUKA' else 'ditutup' end, c.name),
    jsonb_build_object('city', c.name, 'service', p_service, 'enabled', p_enabled, 'drivers', admin_city_drivers(p_city_id)));

  return jsonb_build_object('ok', true, 'services', city_open_services(p_city_id));
end $$;

-- ---------- Perwakilan Kota (PIC) ----------
create or replace function admin_set_city_manager(p_city_id uuid, p_manager_id uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c cities%rowtype; v_name text;
begin
  if not is_admin() then raise exception 'Hanya admin'; end if;
  select * into c from cities where id = p_city_id;
  if not found then raise exception 'Kota tidak ditemukan'; end if;
  if p_manager_id is not null then
    select pr.full_name into v_name from profiles pr where pr.id = p_manager_id and pr.role = 'admin' and pr.is_active;
    if v_name is null then raise exception 'Perwakilan Kota harus pengguna admin yang aktif'; end if;
  end if;
  update cities set manager_id = p_manager_id, manager_note = nullif(trim(coalesce(p_note, '')), '') where id = p_city_id;
  perform log_activity('city.manager', 'cities', p_city_id::text,
    case when p_manager_id is null then format('Perwakilan Kota %s dicabut', c.name)
         else format('%s ditunjuk sebagai Perwakilan Kota %s', v_name, c.name) end,
    jsonb_build_object('city', c.name, 'manager_id', p_manager_id, 'manager_name', v_name));
  return jsonb_build_object('ok', true, 'manager_id', p_manager_id, 'manager_name', v_name);
end $$;

-- ---------- Calon Perwakilan Kota ----------
create or replace function admin_city_manager_options()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not is_admin() then raise exception 'Hanya admin'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', pr.id, 'name', pr.full_name, 'phone', pr.phone) order by pr.full_name), '[]'::jsonb)
    into v from profiles pr where pr.role = 'admin' and pr.is_active;
  return v;
end $$;

-- ---------- Isi daftar tunggu satu kota ----------
create or replace function admin_city_waitlist(p_city_id uuid, p_limit int default 200)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not is_admin() then raise exception 'Hanya admin'; end if;
  select coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]'::jsonb) into v from (
    select jsonb_build_object('id', w.id, 'name', pr.full_name, 'phone', coalesce(w.contact, pr.phone),
      'services', to_jsonb(w.services), 'note', w.note, 'created_at', w.created_at) as x
    from city_waitlist w left join profiles pr on pr.id = w.user_id
    where w.city_id = p_city_id order by w.created_at desc limit greatest(1, least(1000, p_limit))
  ) t;
  return v;
end $$;

-- ---------- Hak akses (pola 0032/0070: cabut PUBLIC & anon, beri ke authenticated) ----------
revoke execute on function admin_city_drivers(uuid)                                  from public, anon;
revoke execute on function admin_list_cities(text)                                   from public, anon;
revoke execute on function admin_set_city_status(uuid, text, text[], text)           from public, anon;
revoke execute on function admin_set_city_service(uuid, text, boolean)               from public, anon;
revoke execute on function admin_set_city_manager(uuid, uuid, text)                  from public, anon;
revoke execute on function admin_city_manager_options()                              from public, anon;
revoke execute on function admin_city_waitlist(uuid, int)                            from public, anon;
grant execute on function admin_city_drivers(uuid)                                   to authenticated;
grant execute on function admin_list_cities(text)                                    to authenticated;
grant execute on function admin_set_city_status(uuid, text, text[], text)            to authenticated;
grant execute on function admin_set_city_service(uuid, text, boolean)                to authenticated;
grant execute on function admin_set_city_manager(uuid, uuid, text)                   to authenticated;
grant execute on function admin_city_manager_options()                               to authenticated;
grant execute on function admin_city_waitlist(uuid, int)                             to authenticated;

-- =====================================================================
-- DATA NYATA: kota yang beroperasi hari ini
-- =====================================================================
update cities set service_status = 'aktif', status_changed_at = now(),
       status_note = 'Kota operasi perdana AntarKita.'
 where name in ('Pekanbaru', 'Padang') and service_status <> 'aktif';

insert into city_services (city_id, service, enabled, opened_at, updated_at)
select c.id, s.sv, true, now(), now()
  from cities c cross join (select unnest(enum_range(null::service_type)) as sv) s
 where c.name in ('Pekanbaru', 'Padang')
on conflict (city_id, service) do update set enabled = true, updated_at = now();

update cities set service_status = 'belum_dilayani'
 where name not in ('Pekanbaru', 'Padang') and service_status = 'belum_dilayani';

-- Penjaga: pastikan hasil akhir persis seperti yang dimaksud pemilik.
do $$
declare n int;
begin
  select count(*) into n from cities where service_status = 'aktif';
  if n <> 2 then raise exception 'Kota aktif seharusnya 2 (Pekanbaru & Padang), ditemukan %', n; end if;
  select count(*) into n from city_services cs join cities c on c.id = cs.city_id
   where c.service_status = 'aktif' and cs.enabled;
  if n < 16 then raise exception 'Layanan yang dibuka di kota aktif kurang dari 16 baris (2 kota × 8 layanan), ditemukan %', n; end if;
end $$;
