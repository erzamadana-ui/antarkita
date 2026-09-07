-- =====================================================================
-- Tahap 10 (b) — Perbaikan hasil QC menyeluruh (S0–S33)
--
-- Temuan QC setelah perubahan besar hari ini (panggilan/suara, offline,
-- komponen Entrance, realtime app_settings, RLS order_messages 0028,
-- indeks & search_path 0028, panel admin baru, impor ikon):
--
--   1. TIDAK ADA regresi database dari perubahan hari ini. Seluruh
--      31 skenario lama (S0–S30) lulus, termasuk kebijakan RLS
--      `order_messages.msg_insert` hasil migrasi 0028 (diuji sungguhan
--      dengan berpindah ke role `authenticated` di S31 — role postgres
--      punya BYPASSRLS sehingga uji tanpa perpindahan role akan lulus
--      palsu).
--
--   2. BUG UX LAMA yang baru ketahuan lewat skenario baru S33:
--      `travel_trip_set_status(..., 'cancelled', ...)` mengirim notifikasi
--      "Travel <kode> dibatalkan" ke penumpang TANPA kolom `data` sama
--      sekali. Semua notifikasi lain membawa kunci tujuan
--      (ticket_id / order_id / travel_request_id / payment_id /
--      withdrawal_id / blast_id / suggestion_id) yang dibaca
--      `notificationData()` di src/hooks/useNotifications.ts, sehingga
--      hanya notifikasi ini yang tidak bisa dibuka ke halaman mana pun.
--      Migrasi ini menambahkan `booking_id`, `trip_id`, dan `code`.
--
-- Migrasi ini TIDAK mengubah logika bisnis: satu-satunya perubahan pada
-- badan fungsi adalah kolom `data` pada INSERT notifikasi. Alur
-- pembatalan, refund, potongan platform, dan status booking persis sama.
-- =====================================================================

create or replace function travel_trip_set_status(p_trip uuid, p_status text, p_note text default null)
returns travel_trips
language plpgsql
security definer
set search_path to 'public'
as $function$
declare t travel_trips%rowtype; b travel_bookings; v_admin boolean := is_admin(); v_fee_total bigint := 0;
begin
  select * into t from travel_trips where id = p_trip for update;
  if not found or not (t.partner_id = auth.uid() or v_admin) then raise exception 'Jadwal tidak ditemukan'; end if;
  if p_status not in ('confirmed','departed','arrived','cancelled') then raise exception 'Status tidak valid'; end if;
  if p_status = 'departed' and t.status not in ('open','confirmed','full') then raise exception 'Jadwal tidak bisa diberangkatkan'; end if;
  if p_status = 'arrived' and t.status <> 'departed' then raise exception 'Belum berangkat'; end if;
  update travel_trips set status = p_status, notes = coalesce(p_note, notes) where id = t.id returning * into t;
  if p_status = 'departed' then
    update travel_bookings set status = 'picked_up' where trip_id = t.id and status in ('booked','confirmed');
  elsif p_status = 'arrived' then
    for b in select * from travel_bookings where trip_id = t.id and status in ('booked','confirmed','picked_up') loop
      update travel_bookings set status = 'completed', payment_status = 'paid' where id = b.id;
      if b.payment_method = 'wallet' then
        perform wallet_apply(t.partner_id, 'earning', b.partner_earning, null, 'Pendapatan travel ' || b.code);
      else
        v_fee_total := v_fee_total + (b.price - b.partner_earning);
      end if;
    end loop;
    if v_fee_total > 0 then perform wallet_apply(t.partner_id, 'fee', -v_fee_total, null, 'Potongan platform travel (tunai)'); end if;
    update travel_partners set total_trips = total_trips + 1 where id = t.partner_id;
  elsif p_status = 'cancelled' then
    for b in select * from travel_bookings where trip_id = t.id and status in ('booked','confirmed') loop
      update travel_bookings set status = 'cancelled', payment_status = case when payment_status = 'paid' then 'refunded' else payment_status end, notes = coalesce(p_note, 'Dibatalkan mitra travel') where id = b.id;
      if b.payment_status = 'paid' then perform wallet_apply(b.customer_id, 'refund', b.price, null, 'Refund travel ' || b.code); end if;
      -- PERBAIKAN QC tahap 10: sebelumnya notifikasi ini dikirim tanpa kolom `data`,
      -- sehingga kotak masuk tidak punya tujuan saat notifikasi diketuk.
      insert into notifications (user_id, kind, title, body, data)
      values (b.customer_id, 'order', 'Travel ' || b.code || ' dibatalkan',
              coalesce(p_note, 'Jadwal dibatalkan mitra travel. Dana dikembalikan ke AntarPay bila sudah dibayar.'),
              jsonb_build_object('booking_id', b.id, 'trip_id', t.id, 'code', b.code));
    end loop;
  end if;
  perform log_activity('travel.trip_' || p_status, 'travel_trips', t.id::text, 'Trip travel → ' || p_status || coalesce(' · ' || p_note, ''), jsonb_build_object('partner_id', t.partner_id));
  return t;
end $function$;

comment on function travel_trip_set_status(uuid, text, text) is
  'Mitra travel/admin mengubah status jadwal. Tahap 10 (QC): notifikasi pembatalan kini membawa data.booking_id/trip_id/code agar bisa dibuka dari kotak masuk.';

-- =====================================================================
-- Catatan pemeriksaan kesehatan skema (7 Sep 2026) — TIDAK ada perubahan
-- lain yang perlu diterapkan:
--   * Tabel tanpa primary key ............ 0
--   * RLS mati di tabel publik ........... hanya spatial_ref_sys (milik
--     ekstensi PostGIS, tidak bisa diubah tanpa reinstall — sama seperti
--     catatan di 0028)
--   * RLS nyala tanpa policy ............. exec_sessions & gateway_secrets
--     (memang deny-all: hanya service_role / SECURITY DEFINER)
--   * Fungsi tanpa search_path ........... 0 (ditutup oleh 0028)
--   * Indeks duplikat / redundan ......... 0 (tidak ada indeks dengan
--     kolom+predikat sama, dan tidak ada yang menjadi prefiks indeks lain)
--   * Kolom tak terpakai ................. 0 dari 471 kolom. Lima kolom
--     memang hanya dipakai sisi server dan tidak pernah muncul di src/:
--     admin_security.pin_hash, exec_access.pin_hash, exec_access.created_by,
--     competitor_prices.created_by, travel_bookings.pickup_location.
--
-- Temuan yang dilaporkan tapi SENGAJA tidak diubah di sini:
--   * Notifikasi informatif tanpa halaman tujuan (memang tidak punya
--     tujuan): "Akun driver aktif", "Akun mitra dipulihkan",
--     "Akun mitra ditangguhkan sementara", "Peringatan pembatalan",
--     "Lapak Anda aktif di AntarMarket" (admin_review_market_vendor hanya
--     mengirim data.status). Menambahkan kunci tujuan di sini butuh rute
--     baru di aplikasi, jadi diserahkan ke keputusan produk.
--   * Perubahan status pesanan biasa (accepted/arrived/completed) memang
--     tidak membuat baris `notifications` sama sekali — aplikasi memakai
--     langganan realtime tabel `orders`. Ini keputusan desain, bukan bug.
--   * src/hooks/useAppSettings.ts baris 9-11 masih memuat catatan
--     "app_settings belum terdaftar di publication realtime". Sejak
--     migrasi 0028 catatan itu sudah usang (S32 membuktikan tabelnya
--     terdaftar) — komentar perlu dibersihkan di sisi aplikasi.
-- =====================================================================
