# Catatan Rilis — versionCode 111 / versionName 3.0.0

- Dibangun: 18 September 2026, dari commit `32faba4`
- Build sebelumnya: `800bbff` (16 Sep 2026 — kontak resmi di privacy/terms/hapus-akun + listing)
- Rentang perubahan: `git log --oneline 800bbff..32faba4` (33 commit, 2 PR: #6 antarpay-toggle, #7 patch-2)
- Jalur: uji tertutup (closed testing) Google Play

## A. Teks Play Console — Bahasa Indonesia (sudah dipakai di Play, jangan diubah)

<id>Rilis uji tertutup pertama AntarKita. • Pesan ojek, mobil, kirim paket, makanan, belanja, pasar, dan travel dari satu aplikasi. • Bayar tunai, saldo AntarPay, atau e-wallet (GoPay, OVO, DANA, ShopeePay, QRIS). • Tersedia 514 kabupaten/kota; kota yang belum dibuka menampilkan daftar tunggu. • Perbaikan: tombol pesan yang kadang tidak muncul di AntarRide/AntarCar.</id>

## B. Teks Play Console — English

<en-US>First closed-test release of AntarKita. • Book motorbike rides, cars, package delivery, food, shopping, market runs and travel from one app. • Pay with cash, AntarPay balance or e-wallets (GoPay, OVO, DANA, ShopeePay, QRIS). • Available in 514 regencies/cities; cities not yet open show a waitlist. • Fix: the order button that sometimes did not appear in AntarRide/AntarCar.</en-US>

## C. Catatan teknis internal (tim)

### Fitur

- **Sakelar AntarPay global (0088, PR #6).** Panel Admin dapat menonaktifkan seluruh dompet + gateway Midtrans. Default NONAKTIF. Saat mati: `request_topup`, `request_withdrawal`, `create_order`/`travel_book`/`travel_request_create` (selain `cash`) ditolak di server; edge function `midtrans-create` membalas 403. Komponen `AntarPayNotice`, hook `useAntarPayStatus`, layar dompet/top up/pencairan ikut menyesuaikan.
- **Sakelar saluran pembayaran per metode (0089, PR #7).** Setelan `app_settings.payment_channels` (jsonb): `cash` (default true) · `antarpay` · `emoney_nfc` · `gopay` · `shopeepay` · `qris` · `ovo` · `dana` · `bank_transfer` · `card` (default false, Midtrans belum produksi). Hierarki: 0088 induk, 0089 anak — bila AntarPay global mati, semua saluran non-tunai efektif mati. Panel Admin `src/screens/admin/gateway.tsx` mendapat kartu "Saluran Pembayaran" dengan sakelar per metode; klien memakai hook `usePaymentChannels` (`src/hooks/useAppSettings.ts`), daftar `PAYMENT_CHANNELS`/`GATEWAY_CHANNELS` (`src/store/payprefs.ts`), dan `BookingSheet`/`PaymentMethods` menyembunyikan metode yang mati. Tombol pesan carter/sopir harian (`travel/index.tsx`) ikut sakelar (KRITIS, `c287abc`).
- **midtrans-create v4** (`d13ceb7`, sudah deploy). Sebelum membuat Snap: cek RPC `payment_channel_enabled('antarpay')` lalu `payment_channel_enabled(method)`; tolak 403 dengan pesan berbahasa Indonesia, 503 bila status tidak dapat diperiksa. Sumber kebenaran = 0089, tidak bergantung `pg_methods`.
- **Tombol pesan selalu tampil di AntarRide/AntarCar dan AntarBox** (`f8dae58`, `1318207`). Begitu jemput dan tujuan terisi, tombol muncul; bila tarif gagal dimuat, tombol berubah "Coba lagi" dan galat asli ditampilkan (tidak lagi ditelan `.catch(() => null)`).

### Perbaikan

- AntarShop: `finalizeRoute` masuk `try`, `setOrdering(false)` dipindah ke `finally` agar tombol pesan tidak tersangkut (`dbd36d8`).
- AntarMarket: `setOrdering(false)` ke `finally`, alasan sama (`13f15d9`).
- AntarRide/AntarCar/AntarBox: akar masalah tombol pesan hilang di APK Android (laporan 17 Sep) — lihat 0095 di bawah. Jarak & rute tampil tetapi daftar kelas dan kotak tarif kosong karena `fare_options` ditolak 42501 saat panggilan sampai sebagai `anon` (mis. token sesi sedang disegarkan).
- Peta: `DEFAULT_MAP_CONFIG` di `src/lib/mapConfig.ts` diubah dari `osm_free` ke `stadia` untuk tile/geocode/route; `uses_free_osm` cadangan = false (`2bec8c3`). Produksi sudah Stadia sejak 12 Sep; cadangan kode kini tidak jatuh ke endpoint OSM yang melarang pemakaian komersial. Konsekuensi disengaja: tanpa `map_config` dan tanpa kunci Stadia, peta tidak tampil.

### Keamanan

- **Penarikan saldo hanya untuk mitra (0090, sudah di produksi).** `request_withdrawal` sebelumnya tidak memeriksa peran, sehingga pelanggan bisa top up via Midtrans lalu mencairkan ke rekening bank (jalur cash-in/cash-out, bukan dompet tertutup; deklarasi "Financial features" di Play menjadi tidak benar). Kini `withdrawal_allowed_roles()` = `driver`, `merchant`, `admin`; penegakan di server karena rute `/pay/withdraw` tetap dapat dicapai lewat deep link. Sakelar darurat `app_settings.customer_withdrawal_enabled` (default false) — JANGAN dinyalakan sebelum badan usaha + izin sesuai.
- Semua penjaga 0088/0089 ditegakkan di server (RPC + edge function), bukan hanya UI.
- **0095 grant `fare_options` ke `anon`**: aman karena fungsi hanya membaca tabel tarif dan menghitung driver online; tidak ada data pribadi, tidak menulis. `create_order` tetap butuh `auth.uid()`. Migrasi memverifikasi ACL `anon=` dan `authenticated=` sama-sama ada, batal bila tidak.

### Data / Infra

- **514 kabupaten/kota (0091–0094, sudah di produksi via Supabase MCP).** Impor Kepmendagri No 300.2.2-2138 Tahun 2025 (38 provinsi) dalam 3 batch (172 + ~170 + ~170 baris); koordinat & penduduk dari dataset publik `cahyadsn/wilayah` dengan 2 koreksi manual (Ogan Komering Ilir; bujur Wakatobi 23.5389 → 123.5389). Semua masuk `service_status = 'segera'` sehingga kota tanpa mitra menampilkan "sedang kami siapkan" + daftar tunggu. [ASUMSI] radius layanan 25 km kota / 50 km kabupaten, dapat diubah per kota di Panel Admin. 4 kota aktif (Batam, Dumai, Padang, Pekanbaru) tidak tersentuh.
- 0094 merapikan bentrokan nama: 5 baris arsip OSM nonaktif diarsipkan agar Bandung, Cirebon, Yogyakarta kembali muncul; 4 baris admin bernama singkat (Bukittinggi, Jambi, Medan, Palembang) dipertahankan namanya, statusnya disamakan. Tidak ada baris dihapus.
- Simulasi E2E (`supabase/tests/simulasi_e2e.sql`): skenario sakelar AntarPay (0088) dan sakelar saluran per metode (0089).
- Dokumentasi: `docs/ANTARPAY-TOGGLE.md` (0088 + 0089).

### Daftar migrasi baru sejak build sebelumnya

| Migrasi | Isi | Status produksi |
|---|---|---|
| `0088_antarpay_toggle.sql` | Sakelar AntarPay global dari Panel Admin, penjaga RPC | diterapkan |
| `0089_saluran_bayar_toggle.sql` | `payment_channels` per metode, `payment_channel_enabled()`, sinkron `pg_methods` | diterapkan |
| `0090_tarik_saldo_hanya_mitra.sql` | `request_withdrawal` hanya driver/merchant/admin | diterapkan |
| `0091_kota_indonesia_batch1.sql` | Kota Kepmendagri batch 1 (Aceh – Jawa Barat sebagian) | diterapkan |
| `0092_kota_indonesia_batch2.sql` | Kota Kepmendagri batch 2 | diterapkan |
| `0093_kota_indonesia_batch3.sql` | Kota Kepmendagri batch 3 | diterapkan |
| `0094_rapikan_kota_lama.sql` | Rapikan bentrokan nama kota lama vs Kepmendagri | diterapkan |
| `0095_fare_options_boleh_anon.sql` | Grant `fare_options` ke `anon` + verifikasi ACL | pastikan sudah diterapkan sebelum rilis |

Edge function: `midtrans-create` v4 (sudah deploy).

### Daftar commit (800bbff..32faba4, terbaru di atas)

```
32faba4 0095: fare_options boleh dipanggil anon (akar tombol pesan yang hilang)
1318207 AntarBox: tombol pesan selalu tampil + tombol coba lagi saat tarif gagal
f8dae58 AntarRide/AntarCar: tombol pesan selalu tampil + tombol coba lagi saat tarif gagal
7dc4fce Kota: impor 506 kabupaten/kota Kepmendagri sebagai 'segera' (0091-0094)
2bec8c3 Peta: cadangan kode ikut Stadia (jangan jatuh ke endpoint OSM non-komersial)
5a928e9 Keamanan: penarikan saldo hanya untuk mitra (0090, sudah diterapkan ke produksi)
47c3201 Merge pull request #7 from erzamadana-ui/erzamadana-ui-patch-2
83bfff5 Simulasi E2E: uji sakelar saluran pembayaran (0089)
d13ceb7 midtrans-create v4: tolak top up bila saluran antarpay/metode dimatikan (sudah deploy)
29d2ae3 Migrasi 0089: sakelar saluran pembayaran per metode (sudah diterapkan ke produksi)
0337005 payprefs: daftar PAYMENT_CHANNELS & GATEWAY_CHANNELS (0089)
13f15d9 AntarMarket: setOrdering(false) ke finally agar tombol tidak tersangkut
dbd36d8 AntarShop: finalizeRoute masuk try, setOrdering(false) ke finally
c287abc Tombol pesan carter/sopir harian ikut sakelar saluran bayar (KRITIS)
44fc745 Panel Admin: kartu Saluran Pembayaran (sakelar per metode, 0089)
bb11e96 Saluran pembayaran per metode (0089) — tipe AppPublicSettings
e71deba Saluran pembayaran per metode (0089) — hook usePaymentChannels + rail saldo
b76cbbf Saluran pembayaran per metode (0089) — komponen pembayaran
446ee73 Saluran pembayaran per metode (0089) — dokumentasi
9f44561 Merge pull request #6 from erzamadana-ui/antarpay-toggle
17ba3d5 AntarPay: dokumentasi sakelar (6d/6)
557b6ee AntarPay: skenario simulasi sakelar (6c/6)
c8ff475 AntarPay: guard Snap di edge function (6b/6)
74ab934 AntarPay: tipe status sakelar (6a/6)
375c014 AntarPay: hook status sakelar (5/6)
669ca83 AntarPay: sakelar di Panel Admin (4/6)
158763f AntarPay: layar dompet/top up/pencairan (3/6)
a9ab16d AntarPay: komponen pelanggan (2/6)
9c3df0a AntarPay: migrasi 0088 sakelar enable/disable (1/6)
```

### Catatan uji sebelum promosi ke produksi

- Verifikasi di APK: AntarRide/AntarCar/AntarBox menampilkan daftar kelas + tombol pesan tepat setelah token sesi disegarkan (skenario 0095).
- Verifikasi Panel Admin: mematikan satu saluran (mis. `ovo`) menyembunyikannya di `PaymentMethods` dan `midtrans-create` menolak 403.
- Verifikasi pelanggan biasa tidak dapat memanggil `request_withdrawal` (0090), termasuk lewat deep link `/pay/withdraw`.
