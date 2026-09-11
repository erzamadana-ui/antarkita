-- =====================================================================
-- 0078 — Daftar tunggu kota (city_waitlist)
--
-- Pelanggan di kota yang belum dilayani menekan "Beri tahu saya kalau sudah ada".
-- Hasilnya bukan sekadar pemanis UI: inilah data nyata untuk memutuskan kota mana
-- dibuka berikutnya, jadi kita simpan lokasi, layanan yang diinginkan, dan waktunya.
--
-- KEAMANAN
--   Kontak orang lain TIDAK boleh terbaca siapa pun. RLS: pendaftar hanya melihat
--   barisnya sendiri; admin melihat semua. Tidak ada hak untuk anon.
--   Penulisan lewat RPC security definer supaya ada pembatasan laju & dedup.
-- =====================================================================

create table if not exists city_waitlist (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references profiles(id) on delete cascade,
  city_id     uuid references cities(id) on delete set null,
  -- salinan nama saat mendaftar: tetap berguna kalau baris kota kelak dihapus/diganti
  city_name   text,
  province    text,
  services    text[] not null default '{}',
  contact     text,
  lat         double precision,
  lng         double precision,
  note        text,
  notified_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index if not exists city_waitlist_user_city
  on city_waitlist (user_id, city_id) where user_id is not null and city_id is not null;
create index if not exists city_waitlist_city_idx on city_waitlist (city_id, created_at desc);

alter table city_waitlist enable row level security;

drop policy if exists city_waitlist_self on city_waitlist;
create policy city_waitlist_self on city_waitlist
  for select to authenticated using (user_id = auth.uid() or is_admin());

drop policy if exists city_waitlist_self_del on city_waitlist;
create policy city_waitlist_self_del on city_waitlist
  for delete to authenticated using (user_id = auth.uid() or is_admin());

drop policy if exists city_waitlist_admin on city_waitlist;
create policy city_waitlist_admin on city_waitlist
  for all to authenticated using (is_admin()) with check (is_admin());

-- Sengaja TIDAK ada policy insert untuk pengguna biasa: pendaftaran hanya lewat
-- city_waitlist_join() supaya dedup & batas laju tidak bisa dilewati.
revoke all on city_waitlist from anon;
grant select, delete on city_waitlist to authenticated;

-- ---------- Mendaftar minat ----------
create or replace function city_waitlist_join(
  p_lat double precision default null,
  p_lng double precision default null,
  p_city_id uuid default null,
  p_services text[] default null,
  p_contact text default null,
  p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); c record; v_city uuid := p_city_id; v_svc text[]; n int;
begin
  if v_uid is null then raise exception 'Masuk dulu untuk mendaftar di daftar tunggu'; end if;

  if v_city is null then
    select * into c from city_at_point(p_lat, p_lng);
    if found then v_city := c.id; end if;
  end if;
  if v_city is null then raise exception 'Kota tidak dikenali. Nyalakan izin lokasi atau pilih kota dulu.'; end if;
  select ct.id, ct.name, ct.province into c from cities ct where ct.id = v_city;
  if not found then raise exception 'Kota tidak dikenali'; end if;

  -- hanya layanan yang benar-benar ada di sistem
  select array_agg(x) into v_svc from unnest(coalesce(p_services, '{}'::text[])) x
   where x in (select unnest(enum_range(null::service_type))::text);

  -- batas laju sederhana: maksimal 5 pendaftaran per pengguna per jam
  select count(*) into n from city_waitlist w where w.user_id = v_uid and w.created_at > now() - interval '1 hour';
  if n >= 5 then raise exception 'Terlalu banyak pendaftaran. Coba lagi satu jam lagi.'; end if;

  -- Perbarui bila sudah terdaftar, kalau belum baru disisipkan (tidak bergantung pada
  -- penebakan indeks parsial oleh ON CONFLICT).
  update city_waitlist w
     set services = coalesce(v_svc, w.services),
         contact  = coalesce(nullif(trim(coalesce(p_contact, '')), ''), w.contact),
         note     = coalesce(nullif(trim(coalesce(p_note, '')), ''), w.note),
         lat = coalesce(p_lat, w.lat), lng = coalesce(p_lng, w.lng),
         city_name = c.name, province = c.province, updated_at = now()
   where w.user_id = v_uid and w.city_id = v_city;
  if not found then
    insert into city_waitlist (user_id, city_id, city_name, province, services, contact, lat, lng, note)
    values (v_uid, v_city, c.name, c.province, coalesce(v_svc, '{}'::text[]),
            nullif(trim(coalesce(p_contact, '')), ''), p_lat, p_lng, nullif(trim(coalesce(p_note, '')), ''));
  end if;

  select count(*) into n from city_waitlist w where w.city_id = v_city;
  return jsonb_build_object('ok', true, 'city_id', v_city, 'city_name', c.name, 'total', n,
    'message', format('Terima kasih! Kami akan mengabari Anda begitu AntarKita membuka layanan di %s.', c.name));
end $$;

-- ---------- Apakah saya sudah terdaftar di kota ini? ----------
create or replace function city_waitlist_mine(p_city_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when exists (select 1 from city_waitlist w where w.city_id = p_city_id and w.user_id = auth.uid())
              then jsonb_build_object('joined', true,
                     'services', (select to_jsonb(w.services) from city_waitlist w where w.city_id = p_city_id and w.user_id = auth.uid()),
                     'total', (select count(*) from city_waitlist w where w.city_id = p_city_id))
              else jsonb_build_object('joined', false, 'total', (select count(*) from city_waitlist w where w.city_id = p_city_id)) end;
$$;

revoke execute on function city_waitlist_join(double precision, double precision, uuid, text[], text, text) from public, anon;
revoke execute on function city_waitlist_mine(uuid) from public, anon;
grant execute on function city_waitlist_join(double precision, double precision, uuid, text[], text, text) to authenticated;
grant execute on function city_waitlist_mine(uuid) to authenticated;
