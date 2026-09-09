-- =====================================================================
-- 0040 — Perbaikan keamanan (agen keamanan & perlindungan data)
--
-- Temuan yang diperbaiki di sini:
--   (A) Tabel QC internal `_qc_sim_chunks` & `_qc_sim_log` memberi hak
--       SELECT/INSERT ke anon+authenticated dengan RLS mati → permukaan
--       tulis publik (sampah/DoS ringan, kebocoran data uji). Kunci total.
--   (B) `spatial_ref_sys` (PostGIS) memberi INSERT/UPDATE/DELETE ke
--       anon+authenticated → siapa pun bisa menyuntik baris SRID sampah.
--       Cabut tulis, sisakan SELECT (dibutuhkan PostGIS/pencarian).
--   (C) `driver_by_code()` membocorkan PLAT NOMOR + status online/last-seen
--       driver ke SEMUA pengguna login tanpa batas laju → panen data driver
--       (stalking) dengan menebak/mengenumerasi kode 6 karakter. Tambahkan
--       pembatas laju per pengguna (tidak mengganggu satu kali pratinjau
--       sebelum memesan; menghentikan enumerasi massal). Sama untuk
--       create_ticket (anti-spam tiket).
--
-- Pola: idempotent, aman dijalankan ulang.
-- =====================================================================

-- ---------- (A) Kunci tabel QC internal ----------
do $$
begin
  if to_regclass('public._qc_sim_chunks') is not null then
    execute 'revoke all on table public._qc_sim_chunks from anon, authenticated';
    execute 'alter table public._qc_sim_chunks enable row level security';
  end if;
  if to_regclass('public._qc_sim_log') is not null then
    execute 'revoke all on table public._qc_sim_log from anon, authenticated';
    execute 'alter table public._qc_sim_log enable row level security';
  end if;
end $$;

-- ---------- (B) Cabut hak tulis pada spatial_ref_sys ----------
-- CATATAN: hak INSERT/UPDATE/DELETE pada spatial_ref_sys diberikan lewat
-- role PUBLIC pada tabel milik `supabase_admin`. Peran migrasi (postgres)
-- BUKAN pemilik tabel, sehingga revoke dari PUBLIC tidak berlaku dan
-- anon/authenticated tetap bisa menulis. Ini keterbatasan PostGIS/Supabase
-- yang hanya bisa ditutup oleh supabase_admin. Risiko rendah: hanya baris
-- definisi SRID sampah, tidak menyentuh data aplikasi. LAPORKAN ke tim
-- infrastruktur; revoke di bawah bersifat best-effort (dari anon/auth saja).
do $$
begin
  if to_regclass('public.spatial_ref_sys') is not null then
    begin
      execute 'revoke insert, update, delete on table public.spatial_ref_sys from anon, authenticated';
    exception when others then null; end;
  end if;
end $$;

-- ---------- (C) Pembatas laju ringan (per pengguna, per jam) ----------
create table if not exists public.lookup_rate (
  user_id      uuid        not null,
  kind         text        not null,
  window_start timestamptz not null,
  n            int         not null default 0,
  primary key (user_id, kind, window_start)
);
alter table public.lookup_rate enable row level security;   -- deny-all: hanya SECURITY DEFINER yang menyentuh
revoke all on table public.lookup_rate from anon, authenticated;

-- Naikkan penghitung jam berjalan; kembalikan true bila MASIH di bawah batas.
create or replace function public.rate_take(p_kind text, p_limit int)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_win timestamptz := date_trunc('hour', now()); v_n int;
begin
  if v_uid is null then return true; end if;   -- fungsi pemanggil menangani "harus login"
  insert into lookup_rate (user_id, kind, window_start, n)
  values (v_uid, p_kind, v_win, 1)
  on conflict (user_id, kind, window_start) do update set n = lookup_rate.n + 1
  returning n into v_n;
  -- bersihkan jendela lama sesekali (murah, tidak setiap panggilan)
  if v_n = 1 then
    delete from lookup_rate where window_start < now() - interval '2 hours';
  end if;
  return v_n <= p_limit;
end $$;
revoke all on function public.rate_take(text, int) from public, anon, authenticated;

-- ---------- (C1) driver_by_code: batasi enumerasi ----------
create or replace function public.driver_by_code(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^0-9A-Za-z]', '', 'g'));
  v_lim  int  := setting_num('driver_code_lookup_per_hour', 40)::int;
  d drivers%rowtype; pf profiles%rowtype;
begin
  if auth.uid() is null then raise exception 'Harus login'; end if;
  if not rate_take('driver_by_code', v_lim) then
    insert into security_events (kind, user_id, detail)
      values ('driver_code.rate_limited', auth.uid(), jsonb_build_object('limit_per_hour', v_lim));
    raise exception 'Terlalu banyak pencarian kode driver. Coba lagi dalam beberapa saat.';
  end if;
  if length(v_code) <> 6 then
    raise exception 'Kode driver terdiri dari 6 karakter. Periksa kembali kode yang Anda masukkan.';
  end if;
  select * into d from drivers where code = v_code;
  if not found then
    raise exception 'Kode driver % tidak ditemukan. Minta driver membuka menu "Kode Saya" di aplikasi Mitra.', v_code;
  end if;
  select * into pf from profiles where id = d.id;
  if d.status <> 'approved' or not coalesce(pf.is_active, false) then
    raise exception 'Driver dengan kode % sedang tidak aktif. Silakan pesan seperti biasa.', v_code;
  end if;
  return jsonb_build_object(
    'id', d.id, 'code', d.code, 'name', pf.full_name, 'avatar_url', pf.avatar_url,
    'vehicle_type', d.vehicle_type, 'vehicle_class', d.vehicle_class,
    'vehicle_brand', d.vehicle_brand, 'vehicle_model', d.vehicle_model, 'vehicle_plate', d.vehicle_plate,
    'rating_avg', d.rating_avg, 'rating_count', d.rating_count, 'total_trips', d.total_trips,
    'is_online', d.is_online,
    'last_seen_minutes', case when d.last_seen_at is null then null
                              else round((extract(epoch from now() - d.last_seen_at) / 60.0)::numeric, 0)::int end,
    'services', to_jsonb(driver_service_codes(d.vehicle_type)));
end $$;
revoke all on function public.driver_by_code(text) from public, anon;
grant execute on function public.driver_by_code(text) to authenticated;

-- ---------- (C2) create_ticket: anti-spam ----------
-- Bungkus penjaga laju di depan definisi lama (tanpa mengubah logika inti).
do $do$
declare def text;
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='create_ticket';
  if def is null then raise exception 'create_ticket belum ada'; end if;
  if position('ticket.rate_limited' in def) > 0 then return; end if;   -- sudah ditambal
  -- sisipkan cek laju tepat setelah cek login
  def := replace(def,
    $old$  if auth.uid() is null then raise exception 'Harus login'; end if;$old$,
    $new$  if auth.uid() is null then raise exception 'Harus login'; end if;
  if not rate_take('create_ticket', setting_num('ticket_per_hour', 10)::int) then
    insert into security_events (kind, user_id, detail) values ('ticket.rate_limited', auth.uid(), '{}'::jsonb);
    raise exception 'Terlalu banyak tiket dibuat. Tunggu sebentar sebelum membuat tiket baru.';
  end if;$new$);
  if position('ticket.rate_limited' in def) = 0 then
    raise exception 'anchor create_ticket tidak ditemukan — definisi fungsi sudah berubah';
  end if;
  execute def;
end $do$;

-- pengaturan default (bisa diubah admin lewat admin_set_settings)
insert into app_settings (key, value) values
  ('driver_code_lookup_per_hour', '40'::jsonb),
  ('ticket_per_hour', '10'::jsonb)
on conflict (key) do nothing;
