# Tahap 11 — Kontrak API (dipakai bersama tim backend, aplikasi Pelanggan, aplikasi Mitra)

## A. "AntarNow" — pesan driver tertentu tanpa pencarian acak (migrasi 0030)
Tujuan: pelanggan yang sudah bertemu driver langsung (mangkal, langganan, jemput di lokasi yang sama)
cukup memasukkan **kode driver** sehingga order langsung menuju driver itu.

- `drivers.code` — kode unik 6 karakter huruf besar+angka tanpa karakter membingungkan (tanpa `0 O 1 I`).
  Dibuat otomatis untuk driver lama & baru; ditampilkan di aplikasi Mitra.
- `orders.preferred_driver_id uuid` — driver tujuan langsung (null = pencarian normal).
- Setelan admin: `direct_order_hold_seconds` (default 120) — berapa lama order hanya ditawarkan ke driver itu;
  `direct_order_fallback` (default true) — setelah lewat, order dilepas ke driver lain.

RPC:
- `rpc('driver_my_code')` → `{ code, orders_direct_today, share_text }` — dipakai aplikasi Mitra (tampilkan besar, bisa disalin).
- `rpc('driver_by_code', { p_code })` → `{ id, code, name, avatar_url, vehicle_type, vehicle_class, vehicle_brand, vehicle_model, vehicle_plate, rating_avg, rating_count, total_trips, is_online, last_seen_minutes, services }`
  atau error berbahasa Indonesia bila kode tidak ada / driver tidak aktif.
- `create_order` menerima field tambahan `driver_code` (string). Server memvalidasi: kode ada, driver `approved`,
  kendaraannya cocok untuk layanan yang dipesan (`driver_can_take`), lalu mengisi `orders.preferred_driver_id`.
  Bila kode tidak cocok → error jelas ("Driver ini tidak melayani AntarCar", dst.).
- `driver_available_orders` menambah kolom `direct_for_me boolean` dan `direct_hold_left_s int`.
  Order dengan `preferred_driver_id` HANYA tampil untuk driver itu selama masa tahan; setelah lewat dan
  `direct_order_fallback` true, tampil untuk driver lain (kolom `direct_for_me` = false).
- `rpc('driver_direct_stats')` (opsional) → jumlah order langsung hari ini/minggu ini untuk kartu di aplikasi Mitra.

## B. Notifikasi (migrasi 0030 + Edge Function)
- `push_tokens (user_id uuid, token text primary key, platform text, app text, updated_at timestamptz)` — RLS: pemilik saja.
- `rpc('register_push_token', { p_token, p_platform, p_app })` / `rpc('unregister_push_token', { p_token })`.
- Edge Function `push-send` (dipanggil trigger/DB atau server) mengirim ke FCM v1 memakai secret `FCM_SERVICE_ACCOUNT`.
  Bila secret belum diisi, fungsi mengembalikan `{ skipped: true }` dan mencatat log — tidak error.
- Pemicu: notifikasi baru di tabel `notifications`, pesan chat baru (`order_messages`), dan panggilan masuk (`call_logs`).

## C. Perbaikan pendaftaran ulang setelah akun dihapus admin (migrasi 0030)
`admin_delete_partner`/`request_account_deletion` harus **melepas email & nomor HP** di `auth.users`
(ganti jadi tombstone `<uid>@deleted.antarkita.invalid`) agar orang yang sama bisa mendaftar lagi
dengan email aslinya, dan agar GoTrue tidak menemukan baris ganda.
