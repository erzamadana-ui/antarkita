# AntarKita

Super-app ala Gojek: **AntarRide** (ojek motor), **AntarCar** (mobil), **AntarFood**, **AntarSend** (dalam/antar kota), **AntarShop** (Indomaret/Alfamart/apotek/supermarket), **AntarMarket** (pasar tradisional), **AntarBox** (mobil box/pick up), **AntarTravel** (travel antar kota, carter, sopir harian), dan **AntarPay** (dompet + payment gateway). Satu basis kode React Native + Expo → **3 aplikasi terpisah** untuk Android, iOS, dan Web; backend **Supabase** (Postgres + PostGIS, Auth, Realtime, Storage, Edge Functions).

## 3 aplikasi (tahap 6)

| Aplikasi | Isi | Web | Android |
|---|---|---|---|
| **AntarKita** (Pelanggan) | semua layanan, pesanan, pembayaran, akun | `https://erzamadana-ui.github.io/antarkita/` | `antarkita-pelanggan-<build>.apk` |
| **AntarKita Mitra** | driver motor/mobil/box, merchant, mitra travel & sopir pribadi | `…/antarkita/mitra/` | `antarkita-mitra-<build>.apk` |
| **AntarKita Admin** | panel operasional, CS, keuangan, katalog, gateway, portal eksekutif | `…/antarkita/admin/` | web (bisa dibungkus APK: `APP=admin`) |

Rute tiap aplikasi ada di `apps/<app>/app` (stub satu baris) → layar bersama di `src/screens`. Pilih aplikasi saat build dengan env `APP=pelanggan|mitra|admin` (lihat `app.config.ts`, `scripts/build-web.mjs`, workflow CI). Satu akun bisa dipakai di ketiga aplikasi; aplikasi Admin hanya menerima akun berperan admin.

| Peran | Fitur |
|---|---|
| Pelanggan | Pesan ride/car/food/send, estimasi tarif rute, tracking driver realtime, chat, promo, wallet & top up, riwayat, rating |
| Mitra Driver | Online/offline, siaran lokasi GPS, daftar order sekitar (radius 5 km), terima order, navigasi, progres status, pendapatan & tarik saldo |
| Merchant | Kelola menu, terima/tolak/siapkan pesanan, buka/tutup toko, saldo penjualan |
| Admin (web) | Dashboard KPI, verifikasi driver & merchant, pengguna, pesanan live, verifikasi top up/penarikan, tarif & promo, pengaturan |

## Akun uji

Akun uji (`*@antaraja.id`) **dinonaktifkan di produksi** sejak 12 Sep 2026 (migrasi 0085): tidak bisa masuk dan tidak tampil di aplikasi publik. Kredensialnya tidak lagi ditulis di repositori mana pun. Untuk pengujian lokal, jalankan `supabase/seed.sql` pada proyek Supabase Anda sendiri; untuk reviewer Google Play, buat akun khusus dari Panel Admin dan isi di *App access* Play Console.

> Data contoh (merchant, menu, promo) hanya untuk lingkungan lokal; di produksi merchant/promo contoh disembunyikan.

## Struktur

```
antar-aja/
├─ app.config.ts          # konfigurasi Expo (nama, ikon, izin, baseUrl web)
├─ eas.json               # profil EAS Build (APK preview, AAB/iOS production)
├─ .env                   # URL & anon key Supabase (aman untuk klien; akses diatur RLS)
├─ apps/pelanggan/app/    # rute aplikasi Pelanggan (stub → src/screens)
├─ apps/mitra/app/        # rute aplikasi Mitra (driver, merchant, travel)
├─ apps/admin/app/        # rute aplikasi Admin (+ portal eksekutif)
├─ apps/*/assets/         # ikon/splash per aplikasi (logo C29 "Dua Tetes Bersatu")
├─ src/screens/           # implementasi layar (customer/, driver/, merchant/, admin/, travel/, shop/, market/, …)
├─ src/lib/app.ts         # identitas aplikasi (APP), tautan silang antar aplikasi
├─ src/lib/theme.ts       # design system "Solid Motion" (Plus Jakarta Sans, warna dari logo)
├─ src/components/map/    # peta lintas platform (Leaflet: WebView di native, react-leaflet di web)
├─ src/lib/geo.ts         # pencarian tempat (Photon/Nominatim), rute (OSRM), fallback Google
├─ supabase/migrations/   # skema, fungsi bisnis (RPC), RLS, hardening
├─ supabase/seed.sql      # data demo
└─ .github/workflows/     # CI: web → GitHub Pages, APK Android → GitHub Release
```

## Menjalankan di komputer (Mac)

```bash
cd antar-aja
npm install            # otomatis menyalin Leaflet ke src/components/map/leaflet-bundle.ts
npm run web            # buka http://localhost:8081 di browser
npm start              # tampilkan QR code → scan dengan Expo Go (iOS/Android)
```

Expo Go: pasang dari App Store / Play Store, pastikan HP dan Mac satu Wi-Fi, scan QR dari terminal. Semua fitur (peta, GPS, kamera) jalan di Expo Go tanpa build native.

## Deploy web + APK otomatis (GitHub)

1. Buat repositori GitHub bernama `antarkita` (public atau private).
2. Push kode ini ke branch `main`.
3. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
4. Setiap push ke `main`:
   * workflow **Web → GitHub Pages** menerbitkan aplikasi web ke `https://<username>.github.io/antar-aja/`
   * workflow **Android APK** membangun APK dan menaruhnya di **Releases** (`https://github.com/<username>/antar-aja/releases/latest`).
5. Unduh APK di HP Android → izinkan instal dari sumber tidak dikenal → pasang.

APK dari workflow ditandatangani keystore debug (cocok untuk uji/distribusi langsung). Untuk Play Store gunakan EAS (bawah).

## Build resmi dengan EAS (Play Store / App Store / TestFlight)

```bash
npm install -g eas-cli
eas login                               # akun Expo gratis
eas init                                # mengisi extra.eas.projectId
eas build -p android --profile preview  # APK uji
eas build -p android --profile production   # AAB untuk Play Console
eas build -p ios --profile production       # butuh Apple Developer Program (US$99/th)
eas submit -p ios                            # kirim ke TestFlight / App Store
```

Play Console (US$25 sekali) dan Apple Developer (US$99/tahun) memakai akun Anda sendiri.

## Backend Supabase

Project: `antar-aja` (ref `qwltshvzrsykxdvhbxcv`, region Singapore). Semua migrasi ada di `supabase/migrations/` dan sudah diterapkan.

Prinsip keamanan:
* **RLS aktif di semua tabel**; klien hanya membaca data miliknya (pesanan, wallet, transaksi). Pesanan `searching` hanya terlihat driver yang disetujui.
* **Semua mutasi uang & status lewat fungsi RPC `SECURITY DEFINER`** (`create_order`, `driver_accept_order`, `driver_update_order_status`, `cancel_order`, `admin_review_topup`, …) — saldo tidak bisa diubah langsung dari klien.
* Tarif dihitung ulang di server; jarak rute dari klien dibatasi maksimal 2,5× jarak garis lurus (anti manipulasi).
* Terima order atomik (`update … where status='searching'`) → tidak ada rebutan ganda.
* Fungsi admin memeriksa `is_admin()`; kolom `role`, `status` dilindungi trigger.
* Grant EXECUTE dicabut dari `anon`/PUBLIC untuk semua fungsi aplikasi (kecuali estimasi tarif & daftar merchant).

Pengaturan dashboard yang disarankan:
* **Authentication → Providers → Email → Confirm email: OFF** (saat ini email dikonfirmasi otomatis oleh trigger `auto_confirm_email`; matikan trigger itu bila ingin verifikasi email sungguhan + SMTP kustom).
* **Authentication → Rate limits** sesuaikan saat trafik naik.
* Aktifkan **Leaked password protection** (paket Pro).

## Peta & integrasi berbayar (opsional)

Tanpa API key: tile OpenStreetMap, pencarian Photon → Nominatim, rute OSRM publik (rate limit ringan; cocok untuk MVP/uji).

Untuk produksi:
* **Google Maps**: isi `EXPO_PUBLIC_GOOGLE_MAPS_KEY` di `.env` → pencarian tempat, reverse geocode, dan rute otomatis memakai Google (Places, Geocoding, Directions). Tile peta tetap Leaflet; bila ingin Google Maps SDK native, ganti `src/components/map/MapView.tsx` dengan `react-native-maps` (butuh build native).
* **Pembayaran otomatis** (Midtrans/Xendit): lihat `docs/INTEGRASI.md`.
* **Push notification**: lihat `docs/INTEGRASI.md` (Expo Notifications + trigger Supabase → Edge Function).

## Skrip

| Perintah | Fungsi |
|---|---|
| `npm run web` / `npm start` | dev server web / Expo Go |
| `npm run typecheck` | pemeriksaan TypeScript |
| `npm run build:web` | export web statis ke `dist/` |
| `node scripts/gen-leaflet.mjs` | regenerasi bundel Leaflet untuk WebView |

## Lisensi

Hak cipta © 2026 Erza Pradipta Madana. Seluruh hak dilindungi.


## Tahap 3 (Sep 2026)
- Ikon layanan kartun (SVG) + logo baru (5 konsep di `assets/logo/`, aktif: `LOGO_VARIANT` di `src/components/Logo.tsx`).
- AntarShop (belanja titip), tip & biaya tambahan (parkir/tol/tunggu), telepon in-app WebRTC (nomor HP tersembunyi — UU PDP),
  payment gateway Midtrans Snap (+ mode simulasi), sesi harga high/middle/low & intelijen harga kompetitor (admin), multi-bahasa ID/EN/ZH/AR.
- Migrasi: `supabase/migrations/0005_shop_enum.sql`, `0006_features.sql`; edge functions: `supabase/functions/midtrans-*`.

## Tahap 4 (Sep 2026)

- **Merchant — sertifikasi & pengajuan**: form pendaftaran memuat NPWP/NPWPD (wajib), KTP pemilik (wajib), foto tempat usaha (wajib), Izin usaha/NIB (opsional), Sertifikat halal (opsional), rekening pencairan. Data dokumen di tabel privat `merchant_documents` (hanya pemilik & admin). Merchant bisa memperbarui/mengajukan ulang di `Toko Saya → Sertifikasi & dokumen`. Admin meninjau di `Panel Admin → Merchant → Tinjau pengajuan` (lihat dokumen, catatan, setujui/tolak/tangguhkan, verifikasi halal).
- **Label halal untuk pelanggan**: filter *Semua / Halal / Non-halal* di AntarFood, badge “Halal” (klaim) atau “Halal ✓” (terverifikasi admin) di kartu & detail merchant.
- **Tiket aduan + CS online**: `Pusat Bantuan` (menu Akun → Bantuan) untuk pelanggan, driver, merchant: buat tiket (kategori, lampiran, terkait pesanan), chat realtime dengan CS, tutup & nilai. Admin: `Panel Admin → CS & Tiket` (antrean, prioritas, ambil tiket, catatan internal, statistik respons).
- **Log aktivitas**: `Panel Admin → Log Aktivitas` — semua kejadian (pesanan, driver, merchant, saldo, gateway, tarif/promo/pengaturan, tiket, SOS) dicatat trigger DB ke `audit_logs`, realtime, filter & ekspor CSV.
- **Keamanan ala Gojek/Grab**: tombol SOS (tahan 2 detik → tiket darurat + alarm admin), bagikan perjalanan (halaman publik `/share/<token>` tanpa login), PIN penjemputan 4 digit untuk ride (driver wajib memasukkan PIN pelanggan), verifikasi wajah driver (selfie) sebelum online tiap 20 jam (`app_settings.driver_selfie_hours`), kontak darurat, Pusat Keamanan (`/safety`), laporan insiden.
- **Beranda pelanggan**: promo bergambar (thumbnail, admin bisa unggah gambar di Tarif & Promo), “Sering dipesan” (pesan ulang sekali ketuk), tujuan terakhir.
- **Logo**: varian 6 “Helm + Mobil” (mobil tersenyum memakai helm) — `assets/logo/concept-6.svg`, ikon aplikasi diregenerasi.

## Tahap 5 (Sep 2026)

- **Pelanggan Ride/Car**: alur "form dulu" — layanan terkunci sesuai tile yang dipilih, peta disembunyikan (tombol **Peta** per baris untuk titik presisi gedung/patokan + detail lokasi), tujuan terakhir & sering dikunjungi, **kelas kendaraan** (Hemat/Standar/Premium/Listrik) dengan harga per kelas & jumlah driver terdekat, **booking terjadwal** (tanggal+jam, driver dicari otomatis ±20 menit sebelum jadwal via pg_cron), iklan merchant terdekat dari titik antar, tombol "Lihat peta rute" opsional.
- **Kelas & tarif driver**: tahun, kondisi, mesin listrik, jenis (motor/mobil/pick up/box) → `derive_vehicle_class` (`vehicle_classes` + pengali tarif); driver kelas tinggi bisa mengambil order kelas di bawahnya; admin bisa override kelas.
- **AntarSend**: dalam kota / **antar kota** (driver mengantar ke gudang asal → drop point kota tujuan; tarif `intercity_rates` base + per kg). Admin: *Logistik & Travel* — kota, gudang besar/kecil (mitra warehouse), tarif antar kota.
- **AntarBox**: mobil box / pick up untuk barang besar, jemput dari rumah, pindahan rumah/kost + pembantu angkat (Rp50rb/orang). Akun driver pick up/box.
- **AntarTravel**: rute antar kota (harga per kursi, carter private Innova/Hi-Ace), jadwal keberangkatan mitra travel, booking tanggal, jemput di rumah, minimum 4 penumpang (asumsi praktik umum; ubah per rute), private 1 keluarga. Halaman mitra travel (`/driver/travel`): buat jadwal, manifest & alamat jemput, berangkat/tiba → pencairan. Admin: rute & persetujuan mitra.
- **Pembayaran**: tab AntarPay → **Pembayaran** (metode utama: tunai / AntarPay / e-wallet pilihan via Midtrans; e-money NFC dicek kompatibilitas perangkat, aktif setelah lisensi bank).
- **Admin**: **Blast Promo** satu arah ke kotak masuk pelanggan (target semua/pelanggan/aktif 30 hari/per kota; lonceng notifikasi di beranda), **tren trafik per kota bulanan + layanan menonjol** di dashboard, **suspend/aktifkan dengan alasan** (driver, merchant, pengguna, mitra travel — tersimpan di log & terlihat mitra), Tarif & Promo dalam **baris**, **20 promo** bergambar.
- **Portal Eksekutif** (`/exec`): login kedua dengan PIN 6 digit untuk level VP/CEO/CFO/pemegang saham (diberikan admin di Pengguna → Eksekutif); laporan GMV, take rate, tren bulanan, per layanan/kota, merchant teratas, pasokan & likuiditas, kualitas layanan, ekspor CSV. Sesi 30 menit, tiap login dicatat.
- **Tipografi & motion**: ukuran huruf standar dinaikkan sedikit (body 15,5 / small 13,5 / tiny 12), durasi transisi dipercepat ±30% (base 180 ms), thumbnail layanan/promo diperkecil.

## Tahap 6 (Sep 2026) — AntarKita
- **Rebrand** AntarKita → **AntarKita**; logo C29 "Dua Tetes Bersatu"; tema **Solid Motion** (Arah A): kartu padat, kaca hanya di bar mengambang, font Plus Jakarta Sans skala 28/24/20/17/15/13/12, warna dari logo, tema selalu terang (dark mode OS diabaikan), menu ganda dihapus (AntarPay di akun, tile Pay, mode switch).
- **3 aplikasi terpisah** (Pelanggan / Mitra / Admin) dari satu basis kode: `APP=…`, CI web 3 sub-path + 2 APK, `404.html` pengarah SPA.
- **AntarShop katalog**: `shop_stores`/`shop_products` (toko: Indomaret, Alfamart, apotek, supermarket), `nearby_stores`, `store_products`, `shopping_estimate`; pilihan **motor / mobil** (belanja besar, faktor ongkir 1,8×); jasa belanja 5% (min Rp5.000) dibagi driver 70%; admin: tambah toko/produk, tandai habis, **impor CSV** harga toko.
- **AntarMarket** (pasar tradisional): `markets`, `market_items` (57 bahan, harga acuan), `nearby_markets`, `market_catalog` (acuan per pasar → median nota driver 7 hari → acuan umum); dana ditahan acuan + 10%, driver isi **harga riil per item + foto nota** (`set_shopping_actual`) → selisih dikembalikan/ditagih, harga riil jadi acuan; jasa belanja 10% (min Rp8.000), driver 70%; admin: pasar, bahan, harga per pasar, statistik acuan vs nota.
- **AntarTravel v2**: mitra = agen travel ATAU pemilik mobil pribadi; 3 mode: kursi bersama, **carter privat**, **sopir harian** (12 jam/hari, overtime/jam); permintaan → penawaran mitra → terima & bayar (AntarPay/tunai) → berjalan → selesai (payout, komisi 10%) → rating; **akomodasi sopir** saat menginap: ditanggung pelanggan atau mandiri (kompensasi ±Rp150.000/malam); BBM/tol/parkir ditanggung pelanggan atau termasuk; direktori mitra; refund penuh ≥12 jam sebelum berangkat, 70% jika kurang.
- **Payment gateway plug-and-play** (Midtrans Snap): kunci diisi dari Panel Admin → Payment Gateway (tabel `gateway_secrets`, hanya Edge Function yang bisa baca) atau secret; uji koneksi; metode aktif; Snap.js popup di web; webhook + notifikasi; lihat `docs/PAYMENT-GATEWAY.md`.
- Migrasi `0012`–`0016`; edge functions `midtrans-create` (v2) & `midtrans-webhook` (v2).

## Tahap 7 (5 Sep 2026) — data pengguna, mitra pasar, otomasi & keamanan
- Pelanggan: usulkan/perbarui toko & pasar dari lokasi (aktif otomatis setelah 3 laporan konsisten); pedagang pasar terverifikasi (grade A/B/C) di AntarMarket; menu kemitraan dihapus.
- Mitra: jenis mitra baru **Pedagang pasar tradisional** (lapak, barang, skor kualitas); aplikasi Mitra tanpa fitur pelanggan.
- Admin: Usulan Data, Mitra Pasar, Otomasi (verifikasi bertingkat, pencairan otomatis, retensi, harga dinamis, anti-fraud & koefisien harga, laporan terjadwal), Pusat Keamanan (PIN panel, flag fraud, log), sidebar scroll.
- Portal Eksekutif: keuangan (take rate, net revenue, margin, P&L bulanan) + rekomendasi otomatis + laporan terjadwal.
- Dokumentasi: `docs/TAHAP7-OTOMASI-KEAMANAN.md`. Migrasi `supabase/migrations/0018–0020`.
