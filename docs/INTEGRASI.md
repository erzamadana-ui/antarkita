# Panduan Integrasi Lanjutan

## 1. Pembayaran otomatis (Midtrans / Xendit)

Saat ini top up AntarVoucher dilakukan manual (transfer → bukti → admin verifikasi → `admin_review_topup`). Untuk otomatis:

1. Daftar merchant Midtrans (Snap) atau Xendit (Invoice). Simpan **Server Key** sebagai secret Supabase: `supabase secrets set MIDTRANS_SERVER_KEY=...`.
2. Buat Edge Function `create-topup` (Deno): menerima `{ amount }` dari klien (JWT diverifikasi), memanggil API Snap/Invoice, menyimpan `topup_requests` dengan `method='midtrans'` dan `ref=<order_id gateway>`, mengembalikan URL pembayaran. Klien membukanya dengan `expo-web-browser`.
3. Buat Edge Function `payment-webhook` (`verify_jwt=false`): memverifikasi signature (SHA-512 Midtrans / callback token Xendit), lalu memanggil fungsi SQL `admin_review_topup` menggunakan **service role** (atau fungsi khusus `system_apply_topup(ref)`), sehingga saldo bertambah otomatis.
4. Di `src/app/pay/topup.tsx`, tambahkan tombol "Bayar otomatis (QRIS/VA)" yang memanggil `supabase.functions.invoke('create-topup')`.

Jangan pernah menaruh server key di aplikasi klien.

## 2. Push notification

1. `npx expo install expo-notifications expo-device`.
2. Saat login, minta izin & ambil `ExpoPushToken`, simpan ke `profiles.push_token` (kolom sudah ada).
3. Buat Edge Function `notify` yang menerima `{ user_id, title, body, data }` dan memanggil `https://exp.host/--/api/v2/push/send`.
4. Buat trigger Postgres `after insert on order_events` → `pg_net` (`net.http_post`) ke Edge Function `notify` untuk customer/driver/merchant sesuai status (`accepted`, `arrived`, `completed`, `merchant_ready`, dst.).
5. Untuk APK/IPA produksi: konfigurasi FCM (Android) & APNs (iOS) di `eas credentials`.

## 3. Google Maps penuh (peta native)

* Isi `EXPO_PUBLIC_GOOGLE_MAPS_KEY` → pencarian/rute pindah ke Google tanpa ubah kode.
* Untuk tampilan peta Google native: `npx expo install react-native-maps`, tambahkan plugin di `app.config.ts` (`android.config.googleMaps.apiKey`), lalu buat `MapView.native.tsx` berbasis `react-native-maps` dengan antarmuka yang sama (`MapProps` di `src/components/map/shared.ts`). Web tetap Leaflet atau ganti ke `@vis.gl/react-google-maps`.

## 4. Verifikasi OTP nomor HP

Supabase Auth mendukung phone OTP via Twilio/Vonage/MessageBird. Aktifkan di Dashboard → Authentication → Providers → Phone, lalu ganti alur login ke `supabase.auth.signInWithOtp({ phone })` + `verifyOtp`.

## 5. Dispatch otomatis (penugasan driver oleh sistem)

Saat ini driver memilih order dari daftar terdekat (first-come). Untuk penugasan otomatis ala Gojek:
* Edge Function terjadwal (`pg_cron` tiap 5 detik) memilih order `searching` tertua, mencari driver online terdekat (`nearby_drivers`) yang belum menerima tawaran, menulis `order_offers(order_id, driver_id, expires_at)`; klien driver menampilkan tawaran 15 detik (terima/tolak); jika kedaluwarsa, lanjut ke driver berikutnya.
* Tambah bobot: rating, jarak, tingkat penerimaan.

## 6. Skala & biaya

* Supabase Free: 500 MB DB, 1 GB storage, 2 juta pesan realtime/bulan — cukup untuk uji hingga ratusan pengguna. Upgrade Pro (US$25/bln) saat produksi.
* OSRM/Nominatim publik: batasi ≤1 req/detik. Untuk produksi sewa MapTiler/Google atau host OSRM sendiri.
* GitHub Pages gratis; custom domain (mis. `app.antaraja.id`) bisa dipasang di Settings → Pages.

## Payment gateway — Midtrans Snap (tahap 3)
Alur: aplikasi → Edge Function `midtrans-create` → Snap (redirect_url) → Midtrans mengirim notifikasi ke `midtrans-webhook` → `payment_settle()` → saldo AntarVoucher bertambah.
Tanpa key, aplikasi berjalan dalam **mode simulasi** (tombol "Bayar (simulasi berhasil)").

Langkah aktivasi (sandbox dulu):
1. Daftar https://dashboard.midtrans.com → Settings → Access Keys → salin Server Key & Client Key (sandbox: `SB-Mid-server-…`).
2. Supabase → Edge Functions → Secrets: `MIDTRANS_SERVER_KEY`, `MIDTRANS_CLIENT_KEY`, `MIDTRANS_IS_PRODUCTION=false`.
3. Midtrans → Settings → Configuration → **Payment Notification URL**: `https://qwltshvzrsykxdvhbxcv.supabase.co/functions/v1/midtrans-webhook`.
4. Uji top up dari aplikasi (Akun/AntarVoucher → Top Up → Top up instan). Untuk produksi: ganti key produksi & `MIDTRANS_IS_PRODUCTION=true`.
Metode yang dipetakan: GoPay, ShopeePay, QRIS (OVO/DANA lewat QRIS), VA bank (bank_transfer).

## Telepon dalam aplikasi (WebRTC)
- Web: langsung jalan di browser modern (butuh izin mikrofon, HTTPS).
- Android/iOS: memakai `react-native-webrtc` → wajib APK/IPA build (tidak berjalan di Expo Go).
- Sinyal lewat Supabase Realtime (`call:<userId>`, `callsig:<callId>`); log di tabel `call_logs` (tanpa nomor HP).
- STUN Google dipakai default. Untuk jaringan seluler/NAT ketat, isi TURN: `EXPO_PUBLIC_TURN_URL`, `EXPO_PUBLIC_TURN_USER`, `EXPO_PUBLIC_TURN_PASS` (mis. Metered.ca / coturn).

## Sesi harga & intelijen harga
- Tabel `pricing_sessions` (level high/middle/low, hari, jam WIB, multiplier, bonus driver %) → dipakai `calc_fare()`.
- Tabel `competitor_prices` diisi admin (survei manual tarif kompetitor). `pricing_suggestions(km)` menghitung usulan multiplier per sesi.
- Halaman: Panel Admin → Intelijen Harga.

## Multi-bahasa
`src/lib/i18n.ts` — kamus ID/EN/ZH/AR; tambah kunci di objek `id` lalu terjemahannya. Arab = RTL (web: `dir=rtl`; native: I18nManager, perlu muat ulang).

## Tahap 4 — tiket CS, log aktivitas, keamanan

- **CS online**: tiket & pesan ada di tabel `tickets` / `ticket_messages` (realtime). Semua pengguna dengan `role = admin` bertindak sebagai CS. Untuk tim CS terpisah, buat akun admin khusus dan gunakan kolom `assigned_to`.
- **Notifikasi**: pesan CS tampil realtime di aplikasi; untuk push/WhatsApp, hubungkan Edge Function ke webhook `ticket_messages` (lihat bagian Push notification).
- **Log aktivitas** (`audit_logs`): diisi otomatis oleh trigger `audit_trigger()` pada tabel inti. Tambah tabel lain: `create trigger t_audit_<tabel> after insert or update or delete on <tabel> for each row execute function audit_trigger()` lalu tambahkan cabang ringkasan di fungsi.
- **Verifikasi wajah driver**: `app_settings.driver_selfie_hours` (default 20; `0` = nonaktif). Foto disimpan di bucket privat `documents` (`drivers.last_selfie_url`). Untuk pencocokan wajah otomatis, kirim `last_selfie_url` + `photo_id_url` ke layanan face-match (mis. AWS Rekognition / Verihubs) dari Edge Function.
- **PIN penjemputan**: `app_settings.pin_services` (default `["ride_motor","ride_car"]`); PIN di tabel `order_pins` hanya terbaca pelanggan; driver wajib mengirim `p_pin` ke `driver_update_order_status` saat `in_progress`.
- **Bagikan perjalanan**: URL `EXPO_PUBLIC_SITE_URL/share/<share_token>`; RPC `shared_order` boleh dipanggil `anon` dan hanya membuka data non-sensitif (tanpa nomor HP).
- **SOS**: `sos_trigger` → tabel `sos_alerts` + tiket kategori `safety` prioritas `urgent`; admin menandai `handled` / `false_alarm`. Untuk eskalasi otomatis (SMS/telepon ke kontak darurat), pasang webhook pada `sos_alerts` ke Twilio/WhatsApp Business.
