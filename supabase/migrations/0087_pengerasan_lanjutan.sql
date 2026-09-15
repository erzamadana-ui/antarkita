-- =====================================================================
-- 0087 — Pengerasan lanjutan (audit keamanan lanjutan 15 Sep 2026)
--
-- Diterapkan ke produksi 15 Sep 2026 setelah tinjauan direktur utama (L1 tetap dikomentari).
-- Semua blok IDEMPOTEN (aman dijalankan ulang). Hanya menutup temuan yang bisa
-- ditutup lewat SQL; sisanya (2FA dashboard, Pro/PITR, WAF, PDP) di luar cakupan SQL.
--
-- Temuan yang ditutup di sini:
--   L3 [RENDAH] View order_economics tanpa security_invoker → jalan dgn hak pemilik (bypass RLS).
--   L2 [SEDANG] resolve_address & estimate_fare tanpa pembatas laju untuk pengguna login.
--   L7 [INFO/PERF] 7 foreign key tanpa indeks penutup.
--   L1 [SEDANG] (OPSIONAL, DIKOMENTARI) phone/email profil terlihat lawan transaksi (UU PDP)
--              — mengubah alur CS/driver, WAJIB keputusan Direktur Utama/Produk sebelum diaktifkan.
--
-- Di LUAR SQL (tidak ada di file ini): 2FA akun dashboard, Leaked Password Protection & PITR (Pro),
--   SSL enforcement/Network Restrictions, WAF/DDoS & rate-limit anon per-IP (Cloudflare/edge),
--   rotasi kunci, pendaftaran PSE Kominfo & kepatuhan UU PDP, pentest independen.
-- =====================================================================

-- ---------------------------------------------------------------------
-- L3 — order_economics berjalan dengan hak PEMANGGIL (hormati RLS).
-- Saat ini SELECT belum di-grant ke anon/authenticated (belum bocor), ini pertahanan berlapis
-- agar grant tak sengaja di masa depan tidak membocorkan finansial seluruh order.
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
             where n.nspname='public' and c.relname='order_economics' and c.relkind='v') then
    execute 'alter view public.order_economics set (security_invoker = on)';
  end if;
end $$;

-- Pastikan tidak ada grant SELECT yang bocor ke peran publik (idempoten; no-op bila memang belum ada).
revoke select on public.order_economics from anon, authenticated;

-- ---------------------------------------------------------------------
-- L2 — Pembatas laju untuk PENGGUNA LOGIN pada lookup mahal.
-- Catatan: rate_take() mengembalikan TRUE bila auth.uid() null, jadi ini TIDAK membatasi anon.
--   Pembatasan anon per-IP HARUS di lapisan edge/WAF (Cloudflare) — tidak bisa andal di dalam Postgres.
-- Ambang default dapat diatur lewat app_settings (setting_num). Konservatif agar tidak mengganggu UX normal.
-- ---------------------------------------------------------------------

-- resolve_address: tambah rate_take di awal untuk pengguna login (badan asli dipertahankan).
create or replace function public.resolve_address(p_lat double precision, p_lng double precision)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_gh text; v_row geocode_cache%rowtype; v_ttl int;
begin
  -- L2: pembatas laju untuk pengguna login (anon dilewati oleh rate_take → tangani di WAF)
  if auth.uid() is not null and not rate_take('resolve_address', setting_num('resolve_per_hour', 600)::int) then
    raise exception 'Terlalu banyak permintaan alamat. Coba lagi sebentar.';
  end if;
  if p_lat is null or p_lng is null or p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180 then
    return jsonb_build_object('hit', false, 'address', null);
  end if;
  v_gh := st_geohash(st_setsrid(st_makepoint(p_lng, p_lat), 4326), 7);
  v_ttl := coalesce((select geocode_cache_ttl_days from map_config where id), 90);
  select * into v_row from geocode_cache where geohash7 = v_gh and created_at > now() - make_interval(days => v_ttl);
  if v_row.geohash7 is null then
    return jsonb_build_object('hit', false, 'address', null, 'geohash', v_gh);
  end if;
  update geocode_cache set hits = hits + 1, last_hit_at = now() where geohash7 = v_gh;
  return jsonb_build_object('hit', true, 'address', v_row.address, 'provider', v_row.provider, 'geohash', v_gh);
end $function$;

-- estimate_fare: tambah rate_take di awal untuk pengguna login (badan asli dipertahankan; tetap STABLE).
create or replace function public.estimate_fare(
  p_service service_type, p_pickup_lat double precision, p_pickup_lng double precision,
  p_drop_lat double precision, p_drop_lng double precision, p_route_km numeric default null)
returns jsonb language plpgsql volatile security definer set search_path to 'public' as $function$
declare v_straight numeric; v_km numeric; v_fare bigint; v_fee bigint; v_ratio numeric;
        s pricing_sessions; v_dm jsonb; v_mult numeric; v_lim jsonb;
begin
  -- L2: pembatas laju untuk pengguna login (anon dilewati oleh rate_take → tangani di WAF)
  if auth.uid() is not null and not rate_take('estimate_fare', setting_num('estimate_per_hour', 1200)::int) then
    raise exception 'Terlalu banyak permintaan estimasi tarif. Coba lagi sebentar.';
  end if;
  v_straight := st_distance(st_setsrid(st_makepoint(p_pickup_lng, p_pickup_lat), 4326)::geography,
                            st_setsrid(st_makepoint(p_drop_lng, p_drop_lat), 4326)::geography) / 1000.0;
  v_ratio := setting_num('max_route_ratio', 2.5);
  v_km := coalesce(p_route_km, v_straight * 1.3);
  v_km := least(greatest(v_km, v_straight), greatest(v_straight * v_ratio, 0.5));
  v_km := round(v_km, 2);
  select fare, platform_fee into v_fare, v_fee from calc_fare(p_service, v_km);
  s := current_pricing_session(p_service);
  v_dm := demand_multiplier(p_service, p_pickup_lat, p_pickup_lng);
  v_mult := coalesce((v_dm->>'multiplier')::numeric, 1);
  if v_mult > 1 then v_fare := round_to((v_fare * v_mult)::bigint, 500); end if;
  v_lim := check_service_distance(p_service, v_km, p_pickup_lat, p_pickup_lng, p_drop_lat, p_drop_lng, 'in_city');
  return jsonb_build_object('distance_km', v_km, 'straight_km', round(v_straight, 2),
    'fare', v_fare, 'platform_fee', v_fee, 'total', v_fare + v_fee,
    'duration_min', greatest(3, ceil(v_km / 25.0 * 60)),
    'session', case when s.id is null then null else jsonb_build_object('name', s.name, 'level', s.level, 'multiplier', s.multiplier) end,
    'demand', case when v_mult > 1 then v_dm else null end,
    'limit', v_lim, 'service_enabled', service_enabled(p_service::text));
end $function$;
-- NOTE: rate_take() menulis ke lookup_rate, jadi estimate_fare diubah dari STABLE → VOLATILE (INSERT tidak boleh
--       terjadi di dalam fungsi non-volatile). Ambang 1200/jam ≈ 20 estimasi/menit — jauh di atas pemakaian wajar.

-- ---------------------------------------------------------------------
-- L7 — Indeks penutup untuk 7 foreign key tanpa indeks (performa; concurrently bila memungkinkan di luar txn).
-- ---------------------------------------------------------------------
create index if not exists cities_status_changed_by_idx      on public.cities            (status_changed_by);
create index if not exists city_services_opened_by_idx       on public.city_services     (opened_by);
create index if not exists content_reports_reviewed_by_idx   on public.content_reports   (reviewed_by);
create index if not exists osm_import_jobs_city_id_idx        on public.osm_import_jobs   (city_id);
create index if not exists osm_import_jobs_created_by_idx     on public.osm_import_jobs   (created_by);
create index if not exists osm_import_tasks_city_id_idx       on public.osm_import_tasks  (city_id);
create index if not exists promo_redemptions_user_id_idx      on public.promo_redemptions (user_id);

-- ---------------------------------------------------------------------
-- L1 — (OPSIONAL / DIKOMENTARI) Minimalisasi kontak untuk UU PDP.
-- Saat ini profiles_select membuka phone & email ke lawan transaksi. Untuk mematuhi prinsip
-- minimalisasi data, alur yang disarankan: JANGAN buka phone/email langsung; sediakan panggilan/
-- pesan DALAM APLIKASI + nomor tersamar via RPC. Ini MENGUBAH alur CS/driver → butuh persetujuan
-- Direktur Utama & tim Produk. Diberikan sebagai referensi, JANGAN aktifkan tanpa keputusan.
--
-- -- Contoh RPC kontak tersamar (hanya untuk order aktif milik pemanggil):
-- -- create or replace function public.order_contact(p_order_id uuid)
-- -- returns jsonb language plpgsql security definer set search_path to 'public' as $fn$
-- -- declare o orders%rowtype; v_phone text; v_masked text;
-- -- begin
-- --   select * into o from orders where id = p_order_id;
-- --   if not found or not (o.customer_id = auth.uid() or o.driver_id = auth.uid() or is_admin()) then
-- --     raise exception 'Bukan pesanan Anda'; end if;
-- --   if o.status not in ('accepted','arrived','in_progress') and not is_admin() then
-- --     raise exception 'Kontak hanya tersedia saat pesanan aktif'; end if;
-- --   -- pihak yang dilihat = lawan dari pemanggil
-- --   select phone into v_phone from profiles
-- --     where id = case when o.customer_id = auth.uid() then o.driver_id else o.customer_id end;
-- --   v_masked := case when v_phone is null then null
-- --                    else left(v_phone, 4) || '****' || right(v_phone, 3) end;
-- --   return jsonb_build_object('phone_masked', v_masked); -- panggilan asli lewat gateway suara/VoIP
-- -- end $fn$;
-- --
-- -- Lalu persempit policy agar phone/email tidak ikut terbuka ke lawan transaksi (perlu pemisahan
-- -- kolom via view ber-security_invoker atau column-privileges) — rancang bersama tim Produk.

-- =====================================================================
-- Selesai 0087.
-- =====================================================================
