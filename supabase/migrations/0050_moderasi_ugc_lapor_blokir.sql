-- =====================================================================
-- 0050_moderasi_ugc_lapor_blokir.sql
-- Moderasi Konten Buatan Pengguna (UGC) — PELAPORAN + BLOKIR PENGGUNA
--
-- Alasan: kebijakan Google Play "User Generated Content"
-- (https://support.google.com/googleplay/android-developer/answer/9876937)
-- mewajibkan aplikasi dengan UGC dan interaksi 1:1 antar pengguna untuk
-- menyediakan:
--   (a) "in-app functionality to report content and users", dan
--   (b) "in-app functionality for blocking users".
-- AntarKita punya chat pesanan, panggilan suara WebRTC, ulasan/rating, dan
-- foto merchant — jadi keduanya WAJIB ada sebelum akses produksi.
--
-- Berkas ini membuat:
--   1. Tabel `user_blocks`   — daftar blokir milik masing-masing pengguna.
--   2. Tabel `content_reports` — laporan konten/pengguna + jejak tinjauan admin.
--   3. RPC pengguna: block_user, unblock_user, my_blocks, report_content.
--   4. RPC admin:    admin_list_reports, admin_resolve_report.
--   5. PENEGAKAN NYATA (bukan sekadar tabel):
--        · `driver_can_take()` — inti pencocokan driver↔pesanan yang dipakai
--          `driver_available_orders()` DAN `driver_accept_order()` — kini
--          menolak pasangan yang saling memblokir.
--        · `nearby_drivers()` — driver terblokir tidak muncul di peta.
--        · trigger `orders` — order AntarNow ke driver terblokir ditolak.
--        · trigger `order_messages` — pesan chat antar pihak terblokir ditolak.
--   6. Batas laju `report_content` (20/jam) supaya tidak jadi alat spam.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. TABEL user_blocks
-- ---------------------------------------------------------------------
create table if not exists user_blocks (
  blocker_id uuid not null references profiles(id) on delete cascade,
  blocked_id uuid not null references profiles(id) on delete cascade,
  reason     text,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint user_blocks_bukan_diri_sendiri check (blocker_id <> blocked_id)
);
comment on table user_blocks is 'Blokir antar pengguna (syarat kebijakan UGC Google Play). Blokir bersifat dua arah dalam penegakannya: pihak mana pun yang memblokir membuat keduanya tidak dipasangkan lagi dan tidak bisa berkirim pesan.';

create index if not exists user_blocks_blocked_idx on user_blocks (blocked_id);

alter table user_blocks enable row level security;

-- Pengguna HANYA melihat & mengelola blokirnya sendiri. Penting: pihak yang
-- diblokir tidak boleh tahu siapa yang memblokirnya (mencegah pembalasan).
drop policy if exists blocks_select on user_blocks;
create policy blocks_select on user_blocks for select
  using (blocker_id = auth.uid() or is_admin());
drop policy if exists blocks_insert on user_blocks;
create policy blocks_insert on user_blocks for insert
  with check (blocker_id = auth.uid());
drop policy if exists blocks_update on user_blocks;
create policy blocks_update on user_blocks for update
  using (blocker_id = auth.uid()) with check (blocker_id = auth.uid());
drop policy if exists blocks_delete on user_blocks;
create policy blocks_delete on user_blocks for delete
  using (blocker_id = auth.uid());

revoke all on user_blocks from anon, public;
grant select, insert, update, delete on user_blocks to authenticated;

-- ---------------------------------------------------------------------
-- 2. TABEL content_reports
-- ---------------------------------------------------------------------
create table if not exists content_reports (
  id             uuid primary key default gen_random_uuid(),
  reporter_id    uuid not null references profiles(id) on delete cascade,
  target_user_id uuid references profiles(id) on delete set null,
  target_kind    text not null check (target_kind in ('user','chat','call','review','merchant','merchant_photo','order','other')),
  target_id      text,
  category       text not null check (category in ('pelecehan','penipuan','seksual','kekerasan','spam','lainnya')),
  detail         text,
  -- Status jelas supaya penanganan bisa dibuktikan ke Google:
  --   open     = baru masuk, belum ditinjau
  --   reviewed = sudah ditinjau, tidak ada pelanggaran / cukup diperingatkan
  --   actioned = ditindak (pengguna ditangguhkan / konten dihapus)
  --   rejected = laporan ditolak (tidak terbukti / salah sasaran)
  status         text not null default 'open' check (status in ('open','reviewed','actioned','rejected')),
  created_at     timestamptz not null default now(),
  -- Batas waktu tinjauan (SLA internal 48 jam). Dipakai admin_list_reports
  -- untuk menandai laporan yang lewat tenggat.
  due_at         timestamptz not null default now() + interval '48 hours',
  reviewed_by    uuid references profiles(id),
  reviewed_at    timestamptz,
  action_taken   text
);
comment on table content_reports is 'Laporan konten/pengguna dari dalam aplikasi (syarat kebijakan UGC Google Play). Ditulis hanya lewat RPC report_content() yang berbatas laju.';

create index if not exists content_reports_status_idx   on content_reports (status, created_at desc);
create index if not exists content_reports_reporter_idx on content_reports (reporter_id, created_at desc);
create index if not exists content_reports_target_idx   on content_reports (target_user_id, created_at desc);

alter table content_reports enable row level security;

-- Pelapor melihat laporannya sendiri; admin melihat semua.
drop policy if exists reports_select on content_reports;
create policy reports_select on content_reports for select
  using (reporter_id = auth.uid() or is_admin());
-- Tidak ada policy INSERT/UPDATE/DELETE: penulisan hanya lewat RPC
-- (report_content / admin_resolve_report) agar batas laju & validasi
-- tidak bisa dilewati dari klien.

revoke all on content_reports from anon, public;
grant select on content_reports to authenticated;

-- ---------------------------------------------------------------------
-- 3. HELPER: apakah dua pengguna saling terblokir?
-- ---------------------------------------------------------------------
-- SECURITY DEFINER supaya bisa dipanggil dari fungsi pencocokan mana pun
-- tanpa terhalang RLS user_blocks (yang sengaja ketat).
create or replace function is_blocked_pair(p_a uuid, p_b uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$
  select p_a is not null and p_b is not null and p_a <> p_b and exists (
    select 1 from user_blocks ub
    where (ub.blocker_id = p_a and ub.blocked_id = p_b)
       or (ub.blocker_id = p_b and ub.blocked_id = p_a)
  );
$$;
revoke execute on function is_blocked_pair(uuid, uuid) from public, anon;
grant execute on function is_blocked_pair(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 4. RPC PENGGUNA — blokir
-- ---------------------------------------------------------------------
create or replace function block_user(p_user uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Silakan masuk dulu'; end if;
  if p_user is null or p_user = v_uid then raise exception 'Tidak bisa memblokir diri sendiri'; end if;
  if not exists (select 1 from profiles where id = p_user) then raise exception 'Pengguna tidak ditemukan'; end if;
  if not rate_take('block_user', 30) then
    raise exception 'Terlalu banyak permintaan blokir dalam satu jam. Coba lagi nanti.';
  end if;
  insert into user_blocks (blocker_id, blocked_id, reason)
  values (v_uid, p_user, nullif(trim(coalesce(p_reason, '')), ''))
  on conflict (blocker_id, blocked_id) do update set reason = coalesce(excluded.reason, user_blocks.reason);
  perform log_activity('moderation.block', 'user_blocks', p_user::text,
    'Pengguna memblokir pengguna lain' || coalesce(' · alasan: ' || p_reason, ''),
    jsonb_build_object('blocked_id', p_user, 'reason', p_reason));
end $$;
revoke execute on function block_user(uuid, text) from public, anon;
grant execute on function block_user(uuid, text) to authenticated;

create or replace function unblock_user(p_user uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Silakan masuk dulu'; end if;
  delete from user_blocks where blocker_id = v_uid and blocked_id = p_user;
  perform log_activity('moderation.unblock', 'user_blocks', p_user::text,
    'Pengguna membuka blokir pengguna lain', jsonb_build_object('blocked_id', p_user));
end $$;
revoke execute on function unblock_user(uuid) from public, anon;
grant execute on function unblock_user(uuid) to authenticated;

-- Daftar "Pengguna diblokir" untuk menu Akun.
create or replace function my_blocks()
returns table (blocked_id uuid, full_name text, avatar_url text, role user_role, reason text, created_at timestamptz)
language sql
stable security definer
set search_path to 'public'
as $$
  select ub.blocked_id, coalesce(p.full_name, 'Pengguna'), p.avatar_url, p.role, ub.reason, ub.created_at
  from user_blocks ub
  left join profiles p on p.id = ub.blocked_id
  where ub.blocker_id = auth.uid()
  order by ub.created_at desc
$$;
revoke execute on function my_blocks() from public, anon;
grant execute on function my_blocks() to authenticated;

-- ---------------------------------------------------------------------
-- 5. RPC PENGGUNA — pelaporan konten/pengguna
-- ---------------------------------------------------------------------
create or replace function report_content(
  p_target_user uuid,
  p_kind        text,
  p_id          text default null,
  p_category    text default 'lainnya',
  p_detail      text default null
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_uid uuid := auth.uid(); v_id uuid;
begin
  if v_uid is null then raise exception 'Silakan masuk dulu'; end if;
  if p_kind not in ('user','chat','call','review','merchant','merchant_photo','order','other') then
    raise exception 'Jenis laporan tidak dikenal';
  end if;
  if p_category not in ('pelecehan','penipuan','seksual','kekerasan','spam','lainnya') then
    raise exception 'Kategori laporan tidak dikenal';
  end if;
  if p_target_user is not null and p_target_user = v_uid then
    raise exception 'Tidak bisa melaporkan diri sendiri';
  end if;
  -- Batas laju: 20 laporan per jam per pengguna, agar pelaporan tidak
  -- dipakai untuk menyerang mitra/pelanggan lain (spam moderasi).
  if not rate_take('report_content', 20) then
    raise exception 'Anda sudah mengirim banyak laporan dalam satu jam terakhir. Coba lagi nanti.';
  end if;
  insert into content_reports (reporter_id, target_user_id, target_kind, target_id, category, detail)
  values (v_uid, p_target_user, p_kind, nullif(trim(coalesce(p_id, '')), ''), p_category,
          nullif(trim(coalesce(p_detail, '')), ''))
  returning id into v_id;
  perform log_activity('moderation.report', 'content_reports', v_id::text,
    'Laporan konten baru · ' || p_kind || ' · ' || p_category,
    jsonb_build_object('target_user_id', p_target_user, 'target_kind', p_kind, 'target_id', p_id, 'category', p_category));
  -- Beri tahu semua admin aktif supaya tenggat 48 jam terkejar.
  insert into notifications (user_id, kind, title, body, data)
  select a.id, 'system', 'Laporan konten baru',
         'Kategori ' || p_category || ' · jenis ' || p_kind || '. Tinjau di Panel Admin → Laporan Pengguna.',
         jsonb_build_object('report_id', v_id)
  from profiles a where a.role = 'admin' and a.is_active;
  return v_id;
end $$;
revoke execute on function report_content(uuid, text, text, text, text) from public, anon;
grant execute on function report_content(uuid, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 6. RPC ADMIN — antrean & penyelesaian laporan
-- ---------------------------------------------------------------------
create or replace function admin_list_reports(p_status text default null)
returns table (
  id uuid, created_at timestamptz, status text, category text, target_kind text, target_id text, detail text,
  reporter_id uuid, reporter_name text, target_user_id uuid, target_name text, target_role user_role,
  target_active boolean, due_at timestamptz, overdue boolean,
  reviewed_by uuid, reviewer_name text, reviewed_at timestamptz, action_taken text
)
language sql
stable security definer
set search_path to 'public'
as $$
  select r.id, r.created_at, r.status, r.category, r.target_kind, r.target_id, r.detail,
         r.reporter_id, coalesce(rp.full_name, 'Pengguna'),
         r.target_user_id, tp.full_name, tp.role, tp.is_active,
         r.due_at, (r.status = 'open' and r.due_at < now()),
         r.reviewed_by, vp.full_name, r.reviewed_at, r.action_taken
  from content_reports r
  left join profiles rp on rp.id = r.reporter_id
  left join profiles tp on tp.id = r.target_user_id
  left join profiles vp on vp.id = r.reviewed_by
  where is_admin()
    and (p_status is null or p_status = 'all' or r.status = p_status)
  order by (r.status = 'open') desc, r.created_at desc
  limit 500
$$;
revoke execute on function admin_list_reports(text) from public, anon;
grant execute on function admin_list_reports(text) to authenticated;

-- p_action: 'reviewed' (ditinjau, tidak melanggar) | 'suspend' (tangguhkan
-- pengguna yang dilaporkan) | 'rejected' (laporan ditolak).
create or replace function admin_resolve_report(p_id uuid, p_action text, p_note text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare r content_reports; v_status text; v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  if not is_admin() then raise exception 'Hanya admin'; end if;
  if p_action not in ('reviewed','suspend','rejected') then raise exception 'Aksi tidak dikenal'; end if;
  select * into r from content_reports where id = p_id;
  if not found then raise exception 'Laporan tidak ditemukan'; end if;

  v_status := case p_action when 'suspend' then 'actioned' when 'rejected' then 'rejected' else 'reviewed' end;

  if p_action = 'suspend' then
    if r.target_user_id is null then raise exception 'Laporan ini tidak menunjuk pengguna tertentu'; end if;
    if v_note is null or length(v_note) < 5 then raise exception 'Tulis alasan penangguhan (min. 5 huruf)'; end if;
    -- admin_set_user sudah menulis audit sendiri + menyimpan alasan di profil.
    perform admin_set_user(r.target_user_id, null, false, v_note);
  end if;

  update content_reports
     set status = v_status, reviewed_by = auth.uid(), reviewed_at = now(),
         action_taken = case p_action
           when 'suspend'  then 'Pengguna ditangguhkan' || coalesce(' · ' || v_note, '')
           when 'rejected' then 'Laporan ditolak' || coalesce(' · ' || v_note, '')
           else 'Ditinjau, tidak ada pelanggaran' || coalesce(' · ' || v_note, '') end
   where id = p_id;

  -- Jejak audit wajib: admin harus bisa membuktikan penanganan ke Google.
  perform log_activity('moderation.resolve_report', 'content_reports', p_id::text,
    'Laporan ' || r.target_kind || '/' || r.category || ' diselesaikan: ' || v_status || coalesce(' · ' || v_note, ''),
    jsonb_build_object('action', p_action, 'status', v_status, 'target_user_id', r.target_user_id, 'note', v_note));

  -- Kabari pelapor bahwa laporannya ditangani (transparansi moderasi).
  insert into notifications (user_id, kind, title, body, data)
  values (r.reporter_id, 'system', 'Laporan Anda sudah ditinjau',
          case v_status
            when 'actioned' then 'Terima kasih. Kami menindak akun yang Anda laporkan.'
            when 'rejected' then 'Terima kasih. Setelah ditinjau, kami belum menemukan pelanggaran.'
            else 'Terima kasih. Laporan Anda sudah kami tinjau.' end,
          jsonb_build_object('report_id', p_id, 'status', v_status));
end $$;
revoke execute on function admin_resolve_report(uuid, text, text) from public, anon;
grant execute on function admin_resolve_report(uuid, text, text) to authenticated;

-- =====================================================================
-- 7. PENEGAKAN — pasangan terblokir tidak boleh dipasangkan
-- =====================================================================
-- `driver_can_take(d, o)` adalah SATU-SATUNYA predikat kecocokan yang dipakai
-- baik oleh `driver_available_orders()` (daftar order yang dilihat driver)
-- maupun `driver_accept_order()` (saat driver menekan "Ambil"). Dengan
-- menambahkan syarat blokir DI SINI, keduanya ikut tertutup sekaligus —
-- termasuk celah "driver menebak id order lalu memanggil accept langsung".
create or replace function driver_can_take(d drivers, o orders)
returns boolean
language sql
stable
set search_path to 'public', 'pg_temp'
as $$
  select case
    when o.service = 'ride_motor' then d.vehicle_type = 'motor'
    when o.service = 'ride_car'   then d.vehicle_type = 'car'
    when o.service = 'box'        then d.vehicle_type in ('box','pickup')
    when o.service = 'food'       then d.vehicle_type in ('motor','car')
    when o.service = 'send'       then
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
  -- MODERASI UGC (0050): jangan pernah pasangkan pihak yang saling memblokir.
  and not is_blocked_pair(d.id, o.customer_id)
$$;

-- Driver yang terblokir juga tidak boleh muncul sebagai titik di peta
-- pelanggan (dan sebaliknya) — supaya blokir terasa nyata, bukan kosmetik.
create or replace function nearby_drivers(p_lat double precision, p_lng double precision, p_vehicle vehicle_type default null::vehicle_type, p_radius_km numeric default 5)
returns table(id uuid, lat double precision, lng double precision, heading real, vehicle_type vehicle_type, distance_km numeric)
language sql
stable security definer
set search_path to 'public'
as $$
  select d.id, d.lat, d.lng, d.heading, d.vehicle_type,
    round((st_distance(d.location, st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography) / 1000.0)::numeric, 2)
  from drivers d
  where d.is_online and d.status = 'approved' and d.location is not null
    and d.last_seen_at > now() - interval '5 minutes'
    and (p_vehicle is null or d.vehicle_type = p_vehicle)
    and st_dwithin(d.location, st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography, p_radius_km * 1000)
    and not is_blocked_pair(d.id, auth.uid())
  order by 6 limit 30
$$;
revoke execute on function nearby_drivers(double precision, double precision, vehicle_type, numeric) from public, anon;
grant execute on function nearby_drivers(double precision, double precision, vehicle_type, numeric) to authenticated;

-- Order AntarNow (pesan driver tertentu lewat kode) lewat `create_order`:
-- dijaga trigger agar isi `create_order` (±17 kB) tidak perlu ditulis ulang —
-- lebih aman terhadap perubahan agen lain.
create or replace function trg_blokir_order_pasangan()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.preferred_driver_id is not null and is_blocked_pair(new.customer_id, new.preferred_driver_id) then
    raise exception 'Anda dan mitra ini saling memblokir. Buka blokir di Akun → Pengguna diblokir bila ingin memesan lagi.';
  end if;
  if new.driver_id is not null and is_blocked_pair(new.customer_id, new.driver_id) then
    raise exception 'Pesanan tidak bisa dipasangkan: salah satu pihak memblokir yang lain.';
  end if;
  return new;
end $$;
drop trigger if exists t_orders_blokir on orders;
create trigger t_orders_blokir before insert or update of driver_id, preferred_driver_id on orders
  for each row execute function trg_blokir_order_pasangan();

-- Chat pesanan: pesan dari pihak yang terblokir ditolak di sisi basis data,
-- bukan sekadar disembunyikan di aplikasi.
create or replace function trg_blokir_pesan_order()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_other uuid;
begin
  select case when o.customer_id = new.sender_id then o.driver_id else o.customer_id end
    into v_other from orders o where o.id = new.order_id;
  if v_other is not null and is_blocked_pair(new.sender_id, v_other) then
    raise exception 'Pesan tidak terkirim. Anda dan pengguna ini tidak dapat saling berkirim pesan karena ada blokir aktif.';
  end if;
  return new;
end $$;
drop trigger if exists t_order_messages_blokir on order_messages;
create trigger t_order_messages_blokir before insert on order_messages
  for each row execute function trg_blokir_pesan_order();

-- Panggilan suara WebRTC dicatat di `call_logs`; blokir menutup jalur ini juga.
create or replace function trg_blokir_panggilan()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if is_blocked_pair(new.caller_id, new.callee_id) then
    raise exception 'Panggilan tidak dapat dilakukan karena ada blokir aktif antara Anda dan pengguna ini.';
  end if;
  return new;
end $$;
drop trigger if exists t_call_logs_blokir on call_logs;
create trigger t_call_logs_blokir before insert on call_logs
  for each row execute function trg_blokir_panggilan();
