# Tahap 9 — Kontrak API (dipakai bersama tim: backend, aplikasi, panel admin, QC)
Semua nama fungsi/kolom di bawah ini SUDAH/AKAN ada di migrasi `0025` (dispatch) dan `0026` (analitik & admin).
Front-end memanggilnya lewat `rpc('<nama>', { ... })` dari `@/lib/supabase`.

## A. Radius & batas dinamis (0025)
- `app_settings.pickup_radius_km` (jsonb) — radius driver melihat order per layanan, mis.
  `{"ride_motor":5,"ride_car":8,"food":5,"send":6,"shop":5,"market":5,"box":15,"default":5}`.
  Admin mengubahnya lewat `admin_set_settings({ pickup_radius_km: {...} })`.
- `app_settings.send_limits` (jsonb) — batas berat & dimensi AntarSend per kendaraan:
  `{"motor":{"max_kg":20,"max_cm":60},"car":{"max_kg":150,"max_cm":160},"box":{"max_kg":1000,"max_cm":300},"travel":{"max_kg":30,"max_cm":120}}`.
- `app_settings.priority_tiers` (jsonb) — antrean prioritas driver berdasarkan rating:
  `[{"min_rating":4.8,"delay_s":0},{"min_rating":4.5,"delay_s":20},{"min_rating":4.0,"delay_s":45},{"min_rating":0,"delay_s":75}]`.
- `app_settings.wait_apology_minutes` (number, default 5) — ambang layar permohonan maaf pelanggan.
- `rpc('app_public_settings')` — kini juga mengembalikan `pickup_radius_km`, `send_limits`, `priority_tiers`, `wait_apology_minutes`.

## B. Dispatch driver (0025)
- `rpc('driver_available_orders')` — kolom baru: `weight_kg`, `parcel_size_cm`, `waiting_minutes`, `priority_note`.
  Order yang sudah ditolak driver tsb tidak muncul lagi; order baru hanya muncul untuk driver
  berating tinggi pada detik-detik awal (lihat `priority_tiers`).
- `rpc('driver_reject_order', { p_order: uuid, p_reason: text })` — tombol **Tolak** di aplikasi Mitra.
  Alasan bebas (mis. "terlalu jauh", "muatan berat"). Tidak ada penalti; hanya menyembunyikan order itu.
- `rpc('driver_priority_info')` → `{ rating, tier_delay_s, next_tier_rating, drivers_ahead }` untuk kartu info prioritas.
- Matriks kendaraan (server, `driver_can_take`):
  | Layanan | motor | car | box/pickup |
  |---|---|---|---|
  | AntarRide (motor) | ya | – | – |
  | AntarCar | – | ya | – |
  | AntarFood | ya | ya | – |
  | AntarSend dalam kota | ya (≤ batas motor) | ya (≤ batas car) | ya |
  | AntarShop/Market | ya (kecuali `shop_vehicle='car'`) | ya | – |
  | AntarBox | – | – | ya |

## C. AntarSend antar kota lewat mitra travel (0025)
- `orders.travel_partner_id` — mitra travel yang membawa titipan.
- `rpc('travel_send_available')` — daftar order `send` `send_scope='intercity'` yang muat batas travel.
- `rpc('travel_accept_send', { p_order })`, `rpc('travel_pickup_send', { p_order })`, `rpc('travel_complete_send', { p_order })`.

## D. Panel admin (0026)
- `rpc('admin_delete_partner', { p_kind: 'driver'|'merchant'|'vendor'|'travel'|'user', p_id: uuid, p_reason: text })`
  — WAJIB PIN admin aktif (`admin_require_unlock`) dan `p_reason` minimal 10 karakter. Soft-delete + anonimisasi + log.
- `rpc('admin_contact_thread', { p_user: uuid, p_subject: text })` → `{ ticket_id }` — memulai/melanjutkan chat admin↔pengguna.
- Telepon: dari panel admin memakai modul panggilan yang sudah ada (`@/lib/call`, topik `call:<uid>`).
- `rpc('admin_finance_cascade', { p_from: date, p_to: date, p_group: 'service'|'city', p_key: text|null })`
  → level 1 ringkasan per grup; bila `p_key` diisi → rincian sub-grup (kota ⇄ layanan) + daftar order.
- `rpc('admin_order_split', { p_order: uuid })` → bagi hasil satu order (pendapatan kotor, driver, merchant, promo, biaya gateway, marjin bersih).

## E. Portal Eksekutif (0026)
- `rpc('exec_report', …)` — bagian baru `pnl`: `revenue`, `cogs` (payout driver + merchant + gateway + promo), `gross_margin`,
  `margin_pct`, dipecah per bulan dan per layanan.
