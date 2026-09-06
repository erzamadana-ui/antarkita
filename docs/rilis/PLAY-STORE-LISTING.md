# Teks & Konten Listing Google Play — AntarKita

Dua aplikasi Android terpisah dari satu basis kode:

| | Pelanggan | Mitra |
|---|---|---|
| Nama paket (`applicationId`) | `id.antarkita.app` | `id.antarkita.mitra` |
| Workflow AAB | `Play Store AAB` → `antarkita-pelanggan-*.aab` | `Play Store AAB` → `antarkita-mitra-*.aab` |
| Ikon / splash | `apps/pelanggan/assets/` | `apps/mitra/assets/` |
| Panel Admin | **web saja** (`/admin/`), tidak dipublikasikan ke Play | |

URL wajib (dari deploy GitHub Pages, lihat `scripts/build-web.mjs`):

- Kebijakan Privasi: `https://erzamadana-ui.github.io/antarkita/privacy/`
- Syarat & Ketentuan: `https://erzamadana-ui.github.io/antarkita/terms/`
- Situs web aplikasi: `https://erzamadana-ui.github.io/antarkita/` (Mitra: `/mitra/`)
- Email kontak developer: `erzamadana@gmail.com`

> Batas Play Console: nama aplikasi ≤ 30 karakter, deskripsi singkat ≤ 80, deskripsi lengkap ≤ 4000. Semua teks di bawah sudah dihitung.

---

## 1. Aplikasi Pelanggan — `id.antarkita.app`

**Nama aplikasi (≤30):** `AntarKita: Ojek, Makan, Kirim` *(29 karakter)*

Alternatif: `AntarKita - Ojek & Antar Semua` (30) atau cukup `AntarKita` (9).

**Deskripsi singkat (≤80):**
`Ojek, mobil, makanan, belanja pasar, kirim barang & travel antar kota. Satu app.` *(80 karakter)*

**Deskripsi lengkap (≤4000):**

```
AntarKita adalah aplikasi super lokal untuk kebutuhan harian Anda: pesan ojek dan mobil, antar makanan, kirim barang, belanja di toko dan pasar tradisional, sewa mobil box, sampai perjalanan antar kota — semuanya dalam satu aplikasi dengan satu dompet AntarPay.

LAYANAN DI DALAM ANTARKITA
• AntarRide — ojek motor cepat dan hemat untuk perjalanan dalam kota. Tarif jelas sebelum pesan.
• AntarCar — mobil untuk perjalanan nyaman bersama keluarga atau bawaan banyak.
• AntarFood — pesan makanan dari warung, restoran, dan UMKM favorit di sekitar Anda; lacak pesanan sampai tiba.
• AntarSend — kirim dokumen dan paket dalam kota, ada foto bukti pengiriman dan PIN serah terima.
• AntarBox — mobil box untuk pindahan, angkut barang besar, atau kirim stok usaha.
• AntarShop — titip beli di toko: tulis daftar belanja, mitra membelikan dan mengantar.
• AntarMarket — belanja sayur, buah, daging, ikan, dan sembako langsung dari pedagang pasar tradisional dengan harga pasar hari itu.
• AntarTravel — perjalanan antar kota dengan mitra travel terverifikasi: pilih jadwal, kursi, atau sewa privat satu mobil.
• AntarPay — dompet dalam aplikasi untuk membayar semua layanan tanpa uang tunai. Top-up mudah lewat transfer bank, e-wallet, dan QRIS (diproses Midtrans).

KENAPA ANTARKITA
• Tarif transparan: lihat estimasi total sebelum memesan, termasuk biaya layanan.
• Lacak langsung: posisi mitra dan status pesanan tampil di peta secara real-time.
• Chat dan panggilan di dalam aplikasi — nomor HP Anda tidak dibagikan ke siapa pun.
• Pusat Keamanan: tombol SOS, bagikan perjalanan ke keluarga, kontak darurat, mitra terverifikasi dengan foto dan plat nomor.
• Bayar tunai atau AntarPay — Anda yang pilih.
• Alamat tersimpan (rumah, kantor) dan riwayat pesanan untuk pesan ulang cepat.
• Bantuan cepat lewat tiket aduan dengan CS yang responsif.
• Promo dan voucher untuk pengguna setia.

CARA PAKAI
1. Daftar dengan email dan nomor HP.
2. Pilih layanan, tentukan titik jemput/antar atau pilih menu.
3. Cek estimasi tarif, pilih metode bayar, lalu pesan.
4. Pantau mitra di peta, chat bila perlu, dan beri penilaian setelah selesai.

IZIN YANG DIPAKAI
• Lokasi (hanya saat aplikasi dibuka) untuk titik jemput, mitra terdekat, dan pelacakan pesanan.
• Kamera dan galeri untuk foto profil dan bukti transfer.
• Mikrofon untuk panggilan suara di dalam aplikasi.

Tertarik jadi mitra? Unduh aplikasi AntarKita Mitra untuk driver, merchant, pedagang pasar, mitra travel, dan mobil box.

AntarKita — antar apa saja, ke mana saja.
Kebijakan Privasi: https://erzamadana-ui.github.io/antarkita/privacy/
Bantuan: erzamadana@gmail.com
```

**Kategori:** Maps & Navigation *(alternatif: Food & Drink — pilih Maps & Navigation karena ride-hailing adalah layanan utama)*
**Tag (maks 5):** Ride hailing, Food delivery, Package delivery, Grocery delivery, Travel
**Email kontak:** erzamadana@gmail.com · **Situs:** https://erzamadana-ui.github.io/antarkita/
**Nama developer:** AntarKita

---

## 2. Aplikasi Mitra — `id.antarkita.mitra`

**Nama aplikasi (≤30):** `AntarKita Mitra: Driver & Toko` *(30 karakter)*

**Deskripsi singkat (≤80):**
`Aplikasi mitra AntarKita: driver, merchant, pedagang pasar, travel & mobil box.` *(79 karakter)*

**Deskripsi lengkap (≤4000):**

```
AntarKita Mitra adalah aplikasi resmi untuk mitra AntarKita — driver ojek/mobil, pemilik warung dan toko, pedagang pasar tradisional, operator travel antar kota, dan pemilik mobil box. Terima pesanan, kelola usaha, dan cairkan pendapatan dari satu aplikasi.

UNTUK MITRA DRIVER (AntarRide, AntarCar, AntarFood, AntarSend, AntarShop, AntarMarket, AntarBox)
• Nyalakan status Online dan terima pesanan di sekitar Anda dengan rincian tarif dan pendapatan bersih sebelum menerima.
• Navigasi ke titik jemput/antar, chat dan panggilan ke pelanggan tanpa membagikan nomor HP.
• PIN serah terima dan foto bukti pengiriman untuk melindungi Anda dari sengketa.
• Ringkasan pendapatan harian/mingguan, riwayat perjalanan, dan rating.
• Pendaftaran cepat: unggah SIM, STNK, KTP, dan foto kendaraan; verifikasi otomatis untuk dokumen lengkap.

UNTUK MERCHANT (AntarFood, AntarShop)
• Kelola menu dan stok, jam buka, foto produk, dan status toko buka/tutup.
• Terima atau tolak pesanan, atur waktu persiapan, dan pantau driver penjemput.
• Laporan penjualan dan saldo pendapatan dengan pencairan ke rekening bank.
• Unggah dokumen usaha (NPWP, izin usaha, sertifikat halal) untuk badge kepercayaan.

UNTUK PEDAGANG PASAR (AntarMarket)
• Daftarkan lapak Anda di pasar, isi kategori dagangan (sayur, buah, daging, ikan, bumbu, sembako) dan jam buka.
• Perbarui harga hari ini dengan mudah; pesanan belanja dari pelanggan kota masuk ke lapak Anda.
• Penilaian kualitas dan rekening pencairan tersendiri.

UNTUK MITRA TRAVEL (AntarTravel)
• Buat jadwal keberangkatan antar kota, tentukan kursi dan tarif, terima booking kursi maupun sewa privat.
• Manifest penumpang, titik jemput, dan status perjalanan dari berangkat sampai tiba.

UNTUK MOBIL BOX (AntarBox)
• Terima pesanan angkut barang besar dan pindahan dengan tarif berdasarkan jarak dan kelas kendaraan.

DOMPET MITRA (AntarPay)
• Pendapatan masuk otomatis ke saldo setelah pesanan selesai. Cairkan ke rekening bank kapan saja sesuai batas minimum.
• Top-up saldo deposit untuk menerima pesanan tunai (diproses Midtrans).

KEAMANAN & DUKUNGAN
• Pusat Keamanan: SOS, verifikasi wajah, kontak darurat, laporan insiden.
• Tiket aduan langsung ke CS AntarKita.
• Mode ganda: satu akun bisa menjadi driver sekaligus merchant/pedagang — beralih mode dengan satu ketukan.

IZIN YANG DIPAKAI
• Lokasi saat aplikasi dibuka: agar pesanan di sekitar Anda dapat dicocokkan dan pelanggan bisa melacak posisi Anda saat Online.
• Kamera dan galeri: dokumen pendaftaran, foto produk, selfie verifikasi, dan bukti pengiriman.
• Mikrofon: panggilan suara di dalam aplikasi.

Syarat menjadi mitra: usia minimal 18 tahun, KTP dan dokumen kendaraan/usaha yang berlaku. Mitra adalah mitra usaha independen; komisi platform tercantum transparan di setiap pesanan.

AntarKita Mitra — penghasilan tambahan, satu aplikasi.
Kebijakan Privasi: https://erzamadana-ui.github.io/antarkita/privacy/
Bantuan: erzamadana@gmail.com
```

**Kategori:** Business *(alternatif: Maps & Navigation)*
**Tag:** Driver app, Delivery partner, Merchant, Ride hailing, Business tools
**Email kontak:** erzamadana@gmail.com · **Situs:** https://erzamadana-ui.github.io/antarkita/mitra/

---

## 3. Aset grafis (kedua aplikasi)

| Aset | Spesifikasi | Catatan |
|---|---|---|
| Ikon aplikasi | 512×512 px, PNG 32-bit, tanpa transparansi, ≤1 MB | Ekspor dari `apps/<app>/assets/icon.png` (pastikan tanpa sudut membulat — Play yang memotong) |
| Feature graphic | 1024×500 px, PNG/JPG, ≤15 MB | Wajib. Logo + tagline: Pelanggan "Antar apa saja, ke mana saja"; Mitra "Penghasilan tambahan, satu aplikasi". Hindari teks kecil di tepi. |
| Screenshot ponsel | Min **2**, maks 8 per aplikasi. Rasio 16:9 atau 9:16, sisi terpendek ≥320 px, terpanjang ≤3840 px, PNG/JPG ≤8 MB | Ambil dari emulator Pixel (1080×2400 → potret 9:16). Saran urutan Pelanggan: Beranda layanan → Pesan AntarRide (peta + estimasi) → Lacak pesanan → AntarFood → AntarMarket → AntarPay. Mitra: Beranda Online + pesanan masuk → Rincian pendapatan → Menu merchant → Lapak pasar → Jadwal travel. |
| Screenshot tablet 7"/10" | Opsional | Tidak wajib bila tidak mendeklarasikan dukungan tablet. |
| Video promo | Opsional (link YouTube) | |

Desain harus bebas dari klaim "terbaik/#1", tidak menampilkan merek pesaing, tidak memuat harga yang bisa kedaluwarsa.

---

## 4. Checklist Play Console → *App content* (isi untuk KEDUA aplikasi)

### 4.1 Privacy policy
- URL: `https://erzamadana-ui.github.io/antarkita/privacy/` (harus bisa dibuka publik tanpa login; sudah dipublikasikan oleh workflow Web).

### 4.2 Ads
- **Apakah aplikasi berisi iklan?** → **Tidak**. Promo merchant/voucher yang tampil di aplikasi adalah konten internal platform (bukan SDK iklan pihak ketiga). Tidak ada iklan pihak ketiga.

### 4.3 App access
- Pilih **"All or some functionality is restricted"** dan berikan akun uji (email + kata sandi) untuk reviewer, untuk masing-masing aplikasi:
  - Pelanggan: akun pelanggan dengan saldo AntarPay uji.
  - Mitra: akun driver **yang sudah disetujui** (status approved) + akun merchant. Tulis instruksi singkat: "Masuk → tab Beranda → geser Online → pesanan uji muncul dalam 1–2 menit (buat dari akun pelanggan)".
- Buat akun ini di Supabase produksi khusus reviewer, jangan pakai akun nyata.

### 4.4 Content rating (kuesioner IARC)
Jawab untuk **kedua aplikasi**:

| Pertanyaan | Jawaban |
|---|---|
| Kategori aplikasi | Utility, Productivity, Communication, or Other |
| Kekerasan / darah | Tidak |
| Ketakutan / horor | Tidak |
| Konten seksual / ketelanjangan | Tidak |
| Bahasa kasar | Tidak (ulasan pengguna dimoderasi) |
| Narkoba, alkohol, tembakau | Tidak (AntarShop/AntarMarket tidak menjual alkohol/rokok — konsisten dengan S&K) |
| Perjudian | Tidak |
| Interaksi antar pengguna (chat) | **Ya** — chat & panggilan dalam pesanan, dimoderasi/dibatasi pada konteks pesanan |
| Berbagi lokasi pengguna dengan pengguna lain | **Ya** — lokasi dibagikan ke mitra/pelanggan selama pesanan berjalan |
| Pembelian barang/jasa digital | Tidak (pembelian barang/jasa fisik, bukan produk digital) |
| Konten buatan pengguna | Ya (ulasan, foto produk merchant) — dimoderasi |
| Apakah aplikasi memfasilitasi transaksi keuangan | Ya (dompet tertutup & pembayaran layanan) |

Hasil yang diharapkan: **Rated for 3+ / Everyone** (Play) — tetap set target usia 18+ di bagian Target audience.

### 4.5 Target audience & content
- Kelompok usia target: **18 ke atas** saja (jangan centang 13–17).
- "Apakah aplikasi bisa menarik anak-anak secara tidak sengaja?" → Tidak.
- Tidak ikut program Designed for Families.

### 4.6 News apps → Tidak. **COVID-19 contact tracing** → Tidak. **Government apps** → Tidak.

### 4.7 Data safety — jawaban form

**Ringkasan:** Aplikasi mengumpulkan dan membagikan data; semua data dienkripsi saat transit; pengguna dapat meminta penghapusan data (dalam aplikasi & email); aplikasi telah menjalani tinjauan keamanan independen → **Tidak** (belum MASA).

*Bagian "Data sharing":* data dibagikan ke pihak ketiga hanya kepada **pemroses pembayaran Midtrans** (nama, email, nomor HP, info transaksi — untuk memproses pembayaran). Supabase/Google adalah *service provider* (tidak dihitung sebagai "sharing" menurut definisi Play).

| Tipe data (Play) | Dikumpulkan? | Dibagikan? | Wajib/Opsional | Tujuan (pilih di form) | Catatan |
|---|---|---|---|---|---|
| **Personal info → Name** | Ya | Ya (Midtrans) | Wajib | App functionality, Account management, Fraud prevention & security | Ditampilkan ke lawan transaksi (nama depan) |
| **Personal info → Email address** | Ya | Ya (Midtrans) | Wajib | Account management, App functionality, Fraud prevention | Login |
| **Personal info → Phone number** | Ya | Ya (Midtrans) | Wajib | App functionality, Account management, Fraud prevention | Tidak ditampilkan ke pengguna lain |
| **Personal info → User IDs** | Ya | Tidak | Wajib | App functionality, Account management | ID akun internal |
| **Personal info → Address** | Ya | Tidak | Opsional | App functionality | Alamat tersimpan (rumah/kantor), alamat jemput/antar |
| **Personal info → Other info** (Mitra: NIK, no. SIM, plat, data kendaraan, kontak darurat) | Ya (Mitra) / kontak darurat (keduanya) | Tidak | Wajib untuk mitra; kontak darurat opsional | App functionality, Fraud prevention & security, Compliance | KYC mitra |
| **Financial info → User payment info** | Tidak | — | — | — | Kartu/e-wallet ditangani penuh oleh Midtrans (SDK/webview mereka); aplikasi tidak melihat nomor kartu |
| **Financial info → Purchase history** | Ya | Tidak | Wajib | App functionality, Account management, Analytics | Riwayat pesanan & mutasi AntarPay |
| **Financial info → Other financial info** (saldo AntarPay, rekening pencairan mitra) | Ya | Tidak | Wajib untuk pencairan | App functionality, Fraud prevention | Nomor rekening bank mitra |
| **Location → Approximate location** | Ya | Tidak | Wajib | App functionality, Fraud prevention | |
| **Location → Precise location** | Ya | Tidak | Wajib | App functionality, Fraud prevention & security | Dibagikan ke lawan transaksi selama pesanan (bukan ke pihak ketiga) |
| **Messages → In-app messages** | Ya | Tidak | Opsional | App functionality | Chat dalam pesanan; log panggilan (durasi) |
| **Photos and videos → Photos** | Ya | Tidak | Opsional (pelanggan) / Wajib (mitra KYC) | App functionality, Fraud prevention & security | Foto profil, bukti transfer, dokumen KYC, foto produk, bukti kirim |
| **Audio → Voice or sound recordings** | Tidak disimpan | — | — | — | Panggilan real-time WebRTC, tidak direkam — jawab **tidak dikumpulkan** |
| **Files and docs** | Ya (mitra) | Tidak | Wajib untuk mitra | App functionality, Compliance | Dokumen usaha (NPWP, izin, halal) |
| **App activity → App interactions** | Ya | Tidak | Wajib | Analytics, Fraud prevention | Log aktivitas & audit |
| **App activity → Other user-generated content** | Ya | Tidak | Opsional | App functionality | Ulasan/rating |
| **App info and performance → Crash logs / Diagnostics** | Ya | Tidak | Wajib | Analytics | Log kesalahan server |
| **Device or other IDs** | Ya | Tidak | Wajib | App functionality | Token notifikasi push |
| Contacts, Calendar, Health, Web browsing, SMS, Installed apps | **Tidak** | — | — | — | |

Pertanyaan lain di form:
- *Is all of the user data collected by your app encrypted in transit?* → **Ya**.
- *Do you provide a way for users to request that their data is deleted?* → **Ya** (Akun → Lainnya → Hapus akun, atau email erzamadana@gmail.com).
- *Data collected is processed ephemerally?* → Tidak (kecuali audio panggilan yang tidak dikumpulkan).
- *Account deletion URL* (di bagian Data safety → "Account deletion"): `https://erzamadana-ui.github.io/antarkita/privacy/#hapus`

### 4.8 Government apps / Financial features declaration
Bagian **Financial features**:
- Pilih **"My app provides financial features"** → jenis: **Digital wallet / stored value** (dan **Payment facilitation** bila tersedia). Jangan pilih *Personal loans*, *Crypto*, *Banking*, *Securities*.
- Penjelasan (teks bebas, ≤ 500 karakter):

  > AntarPay adalah saldo tertutup (closed-loop stored value) yang hanya dapat digunakan untuk membayar layanan di dalam platform AntarKita dan menampung pendapatan mitra; tidak dapat ditransfer antar pengguna dan bukan uang elektronik berizin. Seluruh top-up/pembayaran nontunai diproses oleh PT Midtrans, penyelenggara payment gateway berizin Bank Indonesia. AntarKita tidak memberikan pinjaman, tidak menyimpan data kartu, dan tidak menawarkan produk investasi.

- Bila Play meminta dokumen lisensi: lampirkan bukti kemitraan/akun Midtrans (screenshot dashboard merchant produksi) dan tautan ke Kebijakan Privasi bagian 5. Untuk saldo closed-loop yang hanya berlaku di satu penyelenggara, BI tidak mewajibkan izin uang elektronik (PBI 23/6/2021 — pengecualian *closed loop* dengan floating fund < Rp1 miliar); jika saldo mengambang melampaui batas itu, konsultasikan perizinan.

### 4.9 Permissions declaration (Sensitive/High-risk)
Manifest saat ini (hasil `app.config.ts`): `ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION`, `CAMERA`, `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS`, `INTERNET`, `ACCESS_NETWORK_STATE`, `VIBRATE`, `WAKE_LOCK`, `READ/WRITE_EXTERNAL_STORAGE (maxSdk 32)`, `BLUETOOTH` (WebRTC audio routing). **Tidak ada** `ACCESS_BACKGROUND_LOCATION`, `FOREGROUND_SERVICE*`, `SYSTEM_ALERT_WINDOW`, `READ_MEDIA_IMAGES` (diblokir eksplisit).

- **Aplikasi Pelanggan — lokasi latar belakang:** **TIDAK diperlukan dan tidak dideklarasikan.** Lokasi hanya saat aplikasi dibuka (foreground). Jawab "No" pada pertanyaan background location.
- **Aplikasi Mitra — lokasi latar belakang:** rilis ini juga **foreground-only** (`useLocation.ts` memakai `requestForegroundPermissionsAsync` + `watchPositionAsync`; pelacakan berhenti saat aplikasi ditutup/ke latar). Jawab "No". Sampaikan ke driver di onboarding: "Biarkan aplikasi terbuka saat Online".
- **Teks justifikasi siap pakai** bila kelak pelacakan latar untuk Mitra diaktifkan (tambahkan `ACCESS_BACKGROUND_LOCATION` + `FOREGROUND_SERVICE` + `FOREGROUND_SERVICE_LOCATION` khusus `APP === 'mitra'`, lengkapi *Foreground service permissions* declaration + video demo ≤30 detik yang menunjukkan prompt izin dan fitur):

  > AntarKita Mitra adalah aplikasi untuk mitra pengemudi layanan ride-hailing dan pengantaran. Lokasi di latar belakang diperlukan HANYA saat pengemudi secara sadar menyalakan status "Online" (fitur inti): posisi pengemudi harus terus dikirim ke server agar (1) pesanan baru dapat dicocokkan dengan pengemudi terdekat, (2) pelanggan dapat melacak kedatangan pengemudi dan barang secara real-time di peta, dan (3) fitur keselamatan (SOS, bagikan perjalanan, deteksi penyimpangan rute) tetap berjalan meski pengemudi membuka aplikasi navigasi lain atau layar mati. Tanpa akses latar belakang, pesanan terputus setiap kali pengemudi berpindah aplikasi, yang membahayakan pelanggan dan pengemudi. Pengumpulan berhenti otomatis saat pengemudi menekan "Offline" atau keluar. Pengguna diberi penjelasan dalam aplikasi sebelum prompt izin sistem (prominent disclosure) dan dapat mencabut izin kapan saja. Lokasi tidak digunakan untuk iklan dan tidak dijual.

- **Kamera / mikrofon:** tidak memerlukan deklarasi khusus; pastikan *prominent disclosure* — dialog izin sistem sudah dipicu hanya saat pengguna menekan fitur terkait (foto/panggilan).
- **Foto/galeri:** memakai *photo picker* sistem (expo-image-picker) → tidak butuh `READ_MEDIA_IMAGES`; bila Play menanyakan "Photo and Video Permissions", jawab bahwa aplikasi memakai Android Photo Picker.

### 4.10 Lain-lain
- **Advertising ID:** jawab **"No, my app does not use advertising ID"** (tidak ada SDK iklan/analitik). Pastikan manifest tidak berisi `com.google.android.gms.permission.AD_ID` — cek di log langkah "Verifikasi package id" workflow.
- **Health apps** → Tidak. **Data safety - security practices** → "Data is encrypted in transit" ✔, "You can request that data be deleted" ✔.
- **Store listing → Contact details:** email `erzamadana@gmail.com`, situs, (nomor telepon opsional).
- **Store settings → App category:** Pelanggan: Maps & Navigation; Mitra: Business.
- **Countries/regions:** Indonesia saja (harga & S&K berbasis IDR dan hukum Indonesia).
- **Pricing:** Gratis. **In-app purchases:** tidak ada (pembelian barang/jasa fisik — tidak lewat Google Play Billing; ini diperbolehkan karena bukan produk digital).
