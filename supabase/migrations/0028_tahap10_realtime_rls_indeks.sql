-- =====================================================================
-- Tahap 10 (a) — Realtime, perbaikan RLS, dan indeks
--
-- Migrasi ini TIDAK mengubah logika bisnis. Isinya hanya:
--   1. Mendaftarkan `app_settings` ke publication realtime (sakelar layanan
--      di panel admin langsung terasa di aplikasi pelanggan).
--   2. Memperbaiki bug RLS `order_messages.msg_insert` — admin tidak bisa
--      membalas chat pesanan padahal UI-nya ada.
--   3. Menutup temuan advisor yang aman: `search_path` fungsi + indeks
--      penutup untuk kolom foreign key.
--
-- Semua pernyataan idempotent (aman dijalankan ulang).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Realtime: app_settings
--    src/hooks/useAppSettings.ts berlangganan postgres_changes ke tabel ini
--    (baris 91). Tanpa entri publication, perubahan admin baru terasa saat
--    aplikasi dibuka ulang. Kebijakan `settings_select` (qual = true untuk
--    anon+authenticated) sudah mengizinkan realtime mengirim payload.
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'app_settings'
  ) then
    execute 'alter publication supabase_realtime add table public.app_settings';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2. Bug RLS: admin tidak bisa mengirim pesan di chat pesanan
--
--    Kebijakan lama (0002_functions_rls.sql:713) hanya mengizinkan
--    customer_id / driver_id. `msg_select` sudah memuat `is_admin()`,
--    jadi admin BISA membaca tapi TIDAK bisa membalas — chat admin
--    (src/hooks/useOrder.ts:90, insert langsung ke tabel) selalu gagal.
--
--    Perbaikan: tambahkan cabang `is_admin()`. Syarat untuk pelanggan &
--    driver TIDAK dilonggarkan sedikit pun (tetap wajib peserta order dan
--    status accepted/arrived/in_progress). Admin boleh membalas di status
--    apa pun karena tugas dukungan sering terjadi setelah order selesai
--    atau dibatalkan; order tetap wajib ada dan sender_id tetap wajib
--    sama dengan auth.uid() sehingga tidak ada penyamaran identitas.
-- ---------------------------------------------------------------------
drop policy if exists msg_insert on order_messages;
create policy msg_insert on order_messages for insert to authenticated with check (
  sender_id = auth.uid()
  and exists (
    select 1 from orders o
    where o.id = order_messages.order_id
      and (
        is_admin()
        or ((o.customer_id = auth.uid() or o.driver_id = auth.uid())
            and o.status in ('accepted', 'arrived', 'in_progress'))
      )
  )
);

comment on policy msg_insert on order_messages is
  'Tahap 10: peserta order (pelanggan/driver) boleh mengirim saat order berjalan; admin boleh membalas kapan saja. sender_id wajib = auth.uid().';

-- Catatan tabel chat/tiket lain yang diperiksa dan TIDAK diubah:
--  * ticket_messages — sengaja tanpa policy INSERT: semua penulisan lewat
--    RPC security definer (create_ticket, ticket_reply, admin_update_ticket,
--    close_ticket). Admin sudah bisa membalas lewat ticket_reply.
--  * tickets — sama, INSERT hanya lewat create_ticket().
--  * msg_select (order_messages) sudah memuat is_admin(); pemilik merchant
--    memang tidak diberi akses baca chat pesanan (keputusan produk, bukan bug).

-- ---------------------------------------------------------------------
-- 3a. Advisor keamanan: function_search_path_mutable
--     Lima fungsi murni (bukan SECURITY DEFINER) belum mengunci search_path.
--     `alter function ... set search_path` tidak mengubah badan fungsi.
-- ---------------------------------------------------------------------
alter function derive_vehicle_class(vehicle_type, integer, text, boolean) set search_path = public, pg_temp;
alter function driver_can_take(drivers, orders)                           set search_path = public, pg_temp;
alter function report_next_run(text, integer, timestamp with time zone)   set search_path = public, pg_temp;
alter function shopping_driver_share(service_type, bigint)                set search_path = public, pg_temp;
alter function shopping_service_fee(service_type, bigint)                 set search_path = public, pg_temp;

-- ---------------------------------------------------------------------
-- 3c. Advisor keamanan: anon_security_definer_function_executable
--     Dua RPC driver masih bisa dipanggil tanpa login (lolos dari penyaringan
--     0017 karena dibuat belakangan di 0025). Keduanya sudah aman secara
--     logika (`driver_available_orders` langsung `return` bila auth.uid()
--     bukan driver approved), tapi tidak ada alasan anon boleh memanggilnya.
--     Ini murni perubahan hak akses — badan fungsi tidak disentuh.
--     RPC publik lain (estimate_fare, calc_fare, shared_order,
--     gateway_public_config, app_public_settings, service_enabled,
--     service_limit_km, send_limit, send_required_vehicle,
--     current_pricing_session) memang dipakai landing web tanpa login.
-- ---------------------------------------------------------------------
revoke execute on function driver_available_orders() from anon, public;
revoke execute on function driver_priority_delay_s(numeric, integer) from anon, public;

-- ---------------------------------------------------------------------
-- 3b. Advisor performa: unindexed_foreign_keys (51 temuan)
--     Kolom FK nullable & jarang terisi memakai indeks parsial
--     (`where ... is not null`) agar murah untuk tabel panas seperti orders;
--     Postgres tetap memakainya untuk pemeriksaan FK dan filter kesetaraan.
-- ---------------------------------------------------------------------

-- blasts (siaran promo admin)
create index if not exists blasts_admin_idx    on blasts (admin_id)    where admin_id is not null;
create index if not exists blasts_city_idx     on blasts (city_id)     where city_id is not null;
create index if not exists blasts_merchant_idx on blasts (merchant_id) where merchant_id is not null;

-- call_logs (riwayat panggilan)
create index if not exists call_logs_caller_idx on call_logs (caller_id, started_at desc);
create index if not exists call_logs_order_idx  on call_logs (order_id) where order_id is not null;

-- referensi admin / eksekutif
create index if not exists competitor_prices_created_by_idx on competitor_prices (created_by) where created_by is not null;
create index if not exists exec_access_created_by_idx       on exec_access (created_by)       where created_by is not null;
create index if not exists exec_sessions_user_idx           on exec_sessions (user_id);

-- fraud
create index if not exists fraud_flags_order_idx on fraud_flags (order_id) where order_id is not null;

-- tarif antar kota
create index if not exists intercity_rates_to_city_idx on intercity_rates (to_city);

-- pasar
create index if not exists market_price_log_market_idx  on market_price_log (market_id) where market_id is not null;
create index if not exists market_price_log_order_idx   on market_price_log (order_id)  where order_id is not null;
create index if not exists market_prices_item_idx       on market_prices (item_id);
create index if not exists market_vendor_items_item_idx on market_vendor_items (item_id) where item_id is not null;
create index if not exists markets_city_idx             on markets (city_id) where city_id is not null;

-- merchant
create index if not exists merchant_documents_reviewed_by_idx on merchant_documents (reviewed_by) where reviewed_by is not null;

-- notifikasi
create index if not exists notifications_merchant_idx on notifications (merchant_id, created_at desc) where merchant_id is not null;

-- order & turunannya
create index if not exists order_items_menu_item_idx on order_items (menu_item_id) where menu_item_id is not null;
create index if not exists order_messages_sender_idx on order_messages (sender_id);
create index if not exists orders_city_id_idx        on orders (city_id)             where city_id is not null;
create index if not exists orders_dest_city_idx      on orders (dest_city_id)        where dest_city_id is not null;
create index if not exists orders_market_idx         on orders (market_id)           where market_id is not null;
create index if not exists orders_origin_wh_idx      on orders (origin_warehouse_id) where origin_warehouse_id is not null;
create index if not exists orders_shop_store_idx     on orders (shop_store_id)       where shop_store_id is not null;
create index if not exists orders_warehouse_idx      on orders (warehouse_id)        where warehouse_id is not null;

-- pembayaran
create index if not exists payments_order_idx on payments (order_id) where order_id is not null;

-- usulan tempat (crowdsource)
create index if not exists place_suggestion_votes_user_idx on place_suggestion_votes (user_id);
create index if not exists place_suggestions_submitted_idx on place_suggestions (submitted_by, created_at desc);

-- penilaian
create index if not exists ratings_rater_idx on ratings (rater_id);
create index if not exists ratings_ratee_idx on ratings (ratee_id, ratee_kind);

-- laporan terjadwal
create index if not exists report_runs_report_idx on report_runs (report_id) where report_id is not null;

-- toko (AntarShop)
create index if not exists shop_stores_city_idx on shop_stores (city_id) where city_id is not null;

-- SOS
create index if not exists sos_alerts_user_idx       on sos_alerts (user_id, created_at desc);
create index if not exists sos_alerts_handled_by_idx on sos_alerts (handled_by) where handled_by is not null;
create index if not exists sos_alerts_order_idx      on sos_alerts (order_id)   where order_id is not null;
create index if not exists sos_alerts_ticket_idx     on sos_alerts (ticket_id)  where ticket_id is not null;

-- tiket dukungan
create index if not exists ticket_messages_sender_idx on ticket_messages (sender_id) where sender_id is not null;
create index if not exists tickets_assigned_idx       on tickets (assigned_to) where assigned_to is not null;
create index if not exists tickets_order_idx          on tickets (order_id)    where order_id is not null;

-- dompet: topup & tarik dana
create index if not exists topup_requests_user_idx           on topup_requests (user_id, created_at desc);
create index if not exists topup_requests_reviewed_by_idx    on topup_requests (reviewed_by) where reviewed_by is not null;
create index if not exists withdrawal_requests_user_idx      on withdrawal_requests (user_id, created_at desc);
create index if not exists withdrawal_requests_reviewer_idx  on withdrawal_requests (reviewed_by) where reviewed_by is not null;

-- travel
create index if not exists travel_offers_partner_idx    on travel_offers (partner_id);
create index if not exists travel_partners_base_city_idx on travel_partners (base_city_id) where base_city_id is not null;
create index if not exists travel_requests_from_city_idx on travel_requests (from_city) where from_city is not null;
create index if not exists travel_requests_to_city_idx   on travel_requests (to_city)   where to_city is not null;
create index if not exists travel_requests_offer_idx     on travel_requests (accepted_offer_id) where accepted_offer_id is not null;
create index if not exists travel_requests_partner_idx   on travel_requests (partner_id) where partner_id is not null;
create index if not exists travel_routes_to_city_idx     on travel_routes (to_city);
create index if not exists travel_trips_partner_idx      on travel_trips (partner_id);

-- gudang
create index if not exists warehouses_city_idx on warehouses (city_id);

-- =====================================================================
-- Temuan advisor yang SENGAJA dibiarkan (alasan di docs/UKURAN-APK-DAN-DATA.md
-- dan komentar 0003_harden_grants.sql):
--   * spatial_ref_sys tanpa RLS + postgis/pg_trgm di schema public — objek
--     ekstensi milik supabase_admin, memindahkannya butuh reinstall.
--   * exec_sessions & gateway_secrets "RLS enabled, no policy" — memang
--     deny-all; hanya service_role/SECURITY DEFINER yang boleh menyentuh.
--   * auth_rls_initplan (46) & multiple_permissive_policies (10) — perbaikannya
--     menulis ulang seluruh kebijakan RLS; ditunda agar tidak mencampur
--     perubahan berisiko dengan migrasi indeks ini.
--   * auth_leaked_password_protection — sakelar Dashboard, bukan SQL.
-- =====================================================================
