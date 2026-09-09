# Teks & Konten Listing Google Play — AntarKita

Dua aplikasi Android terpisah dari satu basis kode:

| | Pelanggan | Mitra |
|---|---|---|
| Nama paket (`applicationId`) | `id.antarkita.app` | `id.antarkita.mitra` |
| Workflow AAB | `Play Store AAB` → `antarkita-pelanggan-*.aab` | `Play Store AAB` → `antarkita-mitra-*.aab` |
| Ikon / splash | `apps/pelanggan/assets/` | `apps/mitra/assets/` |
| Panel Admin | **web saja** (`/admin/`), tidak dipublikasikan ke Play | |

URL wajib (dari deploy GitHub Pages, lihat `scripts/build-web.mjs`):

- Kebijakan Privasi: `https://erzamadana-ui.github.io/antarkita/privacy/` — **terverifikasi hidup (HTTP 200) 9 Sep 2026**
- Syarat & Ketentuan: `https://erzamadana-ui.github.io/antarkita/terms/` — **terverifikasi hidup (HTTP 200) 9 Sep 2026**
- **Permintaan hapus akun (URL wajib Play): `https://erzamadana-ui.github.io/antarkita/hapus-akun/`** — halaman berdiri sendiri (`docs/rilis/hapus-akun.html`), diterbitkan oleh `.github/workflows/web.yml`. **Baru; belum hidup sampai push berikutnya ke `main`.**
- Situs web aplikasi: `https://erzamadana-ui.github.io/antarkita/` (Mitra: `/mitra/`)
- Email kontak developer: `erzamadana@gmail.com`

> **Kenapa bukan `.../privacy/#hapus`?** Kebijakan Play menuntut halaman web tempat penghapusan akun dapat *diminta*, dengan jalur permintaan yang **menonjol dan mudah ditemukan di halaman itu**, serta menyebut nama aplikasi/pengembang. Sebuah *anchor* di tengah kebijakan privasi sering dinilai tidak memenuhi "prominently featured". Halaman `/hapus-akun/` dibuat khusus untuk itu.

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
| Konten buatan pengguna | Ya (chat pesanan, panggilan suara, ulasan, foto produk merchant) — ada pelaporan & blokir dalam aplikasi, dimoderasi admin (§4.11) |
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
| **App activity → Other user-generated content** | Ya | Tidak | Opsional | App functionality, Fraud prevention & security | Ulasan/rating; **laporan moderasi** yang ditulis pengguna (kategori + keterangan bebas, tabel `content_reports`) dan **daftar blokir** (`user_blocks`) — keduanya dari migrasi `0050`. Hanya dibaca admin moderasi; pihak yang dilaporkan/diblokir tidak diberi tahu siapa pelapornya |
| **App info and performance → Crash logs / Diagnostics** | Ya | Tidak | Wajib | Analytics | Log kesalahan server |
| **Device or other IDs** | Ya | Tidak | Wajib | App functionality | Token notifikasi push |
| Contacts, Calendar, Health, Web browsing, SMS, Installed apps | **Tidak** | — | — | — | |

Pertanyaan lain di form:
- *Is all of the user data collected by your app encrypted in transit?* → **Ya**.
- *Do you provide a way for users to request that their data is deleted?* → **Ya** (Akun → Lainnya → Hapus akun, atau email erzamadana@gmail.com).
- *Data collected is processed ephemerally?* → Tidak (kecuali audio panggilan yang tidak dikumpulkan).
- *Account deletion URL* (di bagian Data safety → "Account deletion"): **`https://erzamadana-ui.github.io/antarkita/hapus-akun/`**
  *(jangan pakai `.../privacy/#hapus` — lihat catatan di bagian "URL wajib" di atas)*

### 4.8 Government apps / Financial features declaration
Bagian **Financial features**:
- Pilih **"My app provides financial features"** → jenis: **Digital wallet / stored value** (dan **Payment facilitation** bila tersedia). Jangan pilih *Personal loans*, *Crypto*, *Banking*, *Securities*.
- Penjelasan (teks bebas, ≤ 500 karakter):

  > AntarPay adalah saldo tertutup (closed-loop stored value) yang hanya dapat digunakan untuk membayar layanan di dalam platform AntarKita dan menampung pendapatan mitra; tidak dapat ditransfer antar pengguna dan bukan uang elektronik berizin. Seluruh top-up/pembayaran nontunai diproses oleh PT Midtrans, penyelenggara payment gateway berizin Bank Indonesia. AntarKita tidak memberikan pinjaman, tidak menyimpan data kartu, dan tidak menawarkan produk investasi.

- Bila Play meminta dokumen lisensi: lampirkan bukti kemitraan/akun Midtrans (screenshot dashboard merchant produksi) dan tautan ke Kebijakan Privasi bagian 5. Untuk saldo closed-loop yang hanya berlaku di satu penyelenggara, BI tidak mewajibkan izin uang elektronik (PBI 23/6/2021 — pengecualian *closed loop* dengan floating fund < Rp1 miliar); jika saldo mengambang melampaui batas itu, konsultasikan perizinan.

### 4.9 Permissions declaration (Sensitive/High-risk)
**Terverifikasi 9 Sep 2026** dengan menjalankan `APP=pelanggan npx expo prebuild --platform android` lalu membaca `android/app/src/main/AndroidManifest.xml` yang dihasilkan. Ini daftar nyata, bukan perkiraan:

| Izin aktif (13) | Izin diblokir — ada di manifest dengan `tools:node="remove"` sehingga **hilang** setelah manifest merger (7) |
|---|---|
| `ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION`, `CAMERA`, `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS`, `INTERNET`, `ACCESS_NETWORK_STATE`, `VIBRATE`, `WAKE_LOCK`, `POST_NOTIFICATIONS`, `BLUETOOTH`, `READ_EXTERNAL_STORAGE` (maxSdk 32), `WRITE_EXTERNAL_STORAGE` (maxSdk 32) | `ACCESS_BACKGROUND_LOCATION`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION`, `SYSTEM_ALERT_WINDOW`, `READ_MEDIA_IMAGES`, `READ_MEDIA_VIDEO`, `com.google.android.gms.permission.AD_ID` |

> **Jangan panik bila melihat izin yang "diblokir" di log build.** Expo menuliskannya ke manifest sumber lengkap dengan atribut `tools:node="remove"`; Android manifest merger membuangnya saat menyusun APK/AAB. Langkah "Verifikasi package id & versi" di `release-aab.yml` sekarang memisahkan kedua daftar ini secara eksplisit dan **menggagalkan build** bila salah satu izin berisiko tinggi ternyata aktif tanpa penanda `remove`.

> **`targetSdkVersion` terverifikasi = 36** (Android 16), diambil dari `node_modules/react-native/gradle/libs.versions.toml` yang dipakai `expoAutolinking.useExpoVersionCatalog()`. Memenuhi syarat Play untuk aplikasi baru sejak 31 Agustus 2026. Workflow AAB sekarang menggagalkan build bila nilai ini turun di bawah 36.

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

### 4.11 User Generated Content (UGC) — **SUDAH LENGKAP, SIAP DIJAWAB DI PLAY CONSOLE**

AntarKita memuat UGC dan interaksi langsung antar pengguna: **chat dalam pesanan**, **panggilan suara WebRTC**, **ulasan & rating**, **foto produk merchant**, dan **foto bukti pengiriman**. Karena itu kebijakan *User Generated Content* Google Play berlaku penuh — termasuk kalimat kuncinya: *"providing an in-app system for reporting and blocking objectionable UGC and users, and taking action against UGC or users where appropriate"*.

Yang diwajibkan kebijakan vs keadaan kode saat ini:

| Kewajiban Play | Status AntarKita | Bukti |
|---|---|---|
| Pengguna menyetujui S&K sebelum membuat/mengunggah UGC | **Sudah** | Pendaftaran menautkan S&K (`/terms/`); S&K memuat larangan konten |
| Definisi konten terlarang di S&K / kebijakan pengguna | **Sudah** | `docs/rilis/terms.html` |
| Moderasi UGC yang wajar sesuai jenis konten | **Sudah** | Panel Admin → **Pengguna & Dukungan → Laporan Pengguna** (`src/screens/admin/reports.tsx`): antrean laporan berstatus `open` / `reviewed` / `actioned` / `rejected`, tenggat tinjauan 48 jam, aksi tandai-ditinjau / tangguhkan / tolak — semuanya tercatat di Log Aktivitas (`moderation.report`, `moderation.resolve_report`, `moderation.block`) |
| **Sistem PELAPORAN di dalam aplikasi** untuk konten & pengguna bermasalah | **Sudah** | RPC `report_content()` + tabel `content_reports` (migrasi `0050`), UI `src/components/moderation/` — enam kategori jelas + kolom keterangan + layar konfirmasi "Laporan Anda terkirim" |
| **Fungsi MEMBLOKIR pengguna di dalam aplikasi** (wajib untuk aplikasi dengan interaksi langsung antar pengguna) | **Sudah** | RPC `block_user()` / `unblock_user()` / `my_blocks()` + tabel `user_blocks` (migrasi `0050`), UI dialog konsekuensi + layar **Akun → Pengguna diblokir** |
| Tindakan nyata terhadap pengguna bermasalah | **Sudah** | Aksi "Tangguhkan pengguna" di halaman Laporan Pengguna menonaktifkan akun (`profiles.is_active = false`) dengan alasan wajib yang tersimpan di audit |

#### Di mana persis tombolnya (isi ini di formulir "Where can users report content?")

Google menguji jalur ini secara manual, jadi tuliskan apa adanya:

| Fitur | Jalur menu persis |
|---|---|
| Laporkan / blokir **mitra driver** (aplikasi Pelanggan) | Beranda → **Pesanan** → buka pesanan → kartu mitra di bawah peta → tombol **⋯** → **Laporkan** / **Blokir**. Kartu "Ada masalah dengan mitra ini?" di bagian bawah halaman pesanan menyediakan tombol ⋯ yang sama, juga setelah pesanan selesai |
| Laporkan / blokir **pelanggan** (aplikasi Mitra) | Beranda mitra → buka pesanan berjalan → kartu pelanggan → tombol **⋯** → **Laporkan** / **Blokir** |
| Laporkan / blokir dari **layar chat** (kedua aplikasi) | Halaman pesanan → ikon chat → tombol **⋯** di kanan atas judul chat → **Laporkan** / **Blokir** |
| Laporkan **satu pesan chat** tertentu | Di layar chat, **tekan lama** gelembung pesan lawan bicara → lembar pelaporan terbuka dengan pesan itu sebagai sasaran |
| Laporkan **ulasan / rating merchant** | Beranda → **AntarFood** → buka merchant → tab **Ulasan** → **Laporkan ulasan atau rating di halaman ini** |
| Laporkan **foto / keterangan merchant** | Beranda → **AntarFood** → buka merchant → tab **Info** → **Laporkan foto atau keterangan merchant** |
| Daftar & pengelolaan blokir | **Akun** → **Pengguna diblokir** (ada di aplikasi Pelanggan maupun Mitra) → tombol **Buka blokir** per baris |
| Antrean moderasi admin | Panel Admin → **Pengguna & Dukungan** → **Laporan Pengguna** |

Kategori pelaporan yang ditawarkan: **pelecehan atau perundungan · penipuan · konten seksual · kekerasan atau ancaman · spam atau promosi · lainnya**, masing-masing dengan kolom keterangan bebas.

#### Blokir bukan kosmetik — penegakannya di sisi basis data

Ini yang membedakan implementasi AntarKita dari sekadar "tabel blokir". Semua penegakan ada di migrasi `supabase/migrations/0050_moderasi_ugc_lapor_blokir.sql`:

- `driver_can_take(d, o)` — satu-satunya predikat kecocokan yang dipakai **`driver_available_orders()`** (daftar order yang dilihat driver) **dan** `driver_accept_order()` (saat driver menekan "Ambil") — menolak pasangan yang saling memblokir. Jadi order pelanggan yang memblokir tidak muncul, dan tidak bisa diambil walau id ordernya ditebak.
- Trigger `t_orders_blokir` pada `orders` — order AntarNow (pesan driver tertentu lewat kode) ke pihak terblokir ditolak saat dibuat.
- Trigger `t_order_messages_blokir` pada `order_messages` — pesan chat dari pihak terblokir **ditolak basis data**, bukan sekadar disembunyikan di aplikasi.
- Trigger `t_call_logs_blokir` pada `call_logs` — panggilan suara WebRTC antar pihak terblokir ditolak.
- `nearby_drivers()` — driver terblokir tidak lagi muncul sebagai titik di peta pelanggan.
- `report_content()` dibatasi **20 laporan/jam per pengguna** supaya pelaporan tidak jadi alat serangan; `block_user()` dibatasi 30/jam.

Bukti uji otomatis: `supabase/tests/uji_moderasi.sql` (uji bergaya ROLLBACK — data nyata tidak berubah) memverifikasi bahwa order pelanggan yang memblokir hilang dari pencocokan, penerimaan order ditolak, pesan chat ditolak, order AntarNow ditolak, panggilan ditolak, laporan tercatat lalu diselesaikan admin dengan jejak audit, dan RLS `user_blocks` tidak membocorkan siapa memblokir siapa.

#### Jawaban singkat untuk pertanyaan moderasi konten di Play Console

Salin-tempel jawaban berikut (bahasa Inggris di formulir; versi Indonesia disediakan untuk arsip internal).

**T: Does your app contain user-generated content?**
Ya. Chat teks 1:1 dan panggilan suara antara pelanggan dan mitra dalam satu pesanan, ulasan & rating pasca-pesanan, serta foto/keterangan yang diunggah merchant. Tidak ada umpan publik, tidak ada profil publik, tidak ada pesan antar pengguna yang tidak terhubung pesanan.

**T: How do users report inappropriate content or other users?**
Setiap layar yang memuat UGC punya tombol **⋯ → Laporkan**: kartu mitra/pelanggan di halaman pesanan, judul layar chat, tekan-lama pada gelembung pesan, tab Ulasan dan tab Info pada halaman merchant. Pelapor memilih satu dari enam kategori (pelecehan, penipuan, konten seksual, kekerasan, spam, lainnya), boleh menambahkan keterangan, lalu menerima konfirmasi bahwa laporan diterima. Laporan tersimpan di tabel `content_reports`. Jalur menu lengkap ada di tabel "Di mana persis tombolnya" di atas.

**T: How do users block other users?**
Tombol **⋯ → Blokir** pada layar yang sama. Dialog konfirmasi menjelaskan akibatnya sebelum blokir berlaku: tidak akan dipasangkan lagi pada pesanan berikutnya, tidak bisa saling berkirim pesan maupun menelepon, dan pihak yang diblokir tidak diberi tahu. Pengguna mengelola daftarnya di **Akun → Pengguna diblokir** dan bisa membuka blokir kapan saja. Blokir ditegakkan di sisi server (pencocokan driver, chat, panggilan), bukan hanya disembunyikan di aplikasi.

**T: How do you moderate UGC and act on reports?**
Laporan masuk ke antrean **Panel Admin → Laporan Pengguna** dan langsung memicu notifikasi ke seluruh admin aktif. Setiap laporan punya tenggat tinjauan **48 jam** yang ditandai otomatis bila terlampaui. Admin dapat menandai laporan **ditinjau**, **menangguhkan** akun yang dilaporkan (alasan wajib, akun langsung dinonaktifkan), atau **menolak** laporan. Pelapor menerima notifikasi hasil tinjauan. Semua tindakan tercatat permanen di log audit (`audit_logs`) sehingga riwayat penanganan dapat ditunjukkan kapan saja.

**T: What content is prohibited?**
Tercantum di Syarat & Ketentuan (`docs/rilis/terms.html`) yang wajib disetujui saat pendaftaran: pelecehan dan ujaran kebencian, ancaman kekerasan, konten seksual, penipuan dan permintaan transaksi di luar aplikasi, spam, serta konten ilegal menurut hukum Indonesia.

**Catatan pengisian Play Console:** jawab kuesioner UGC dengan **"Yes"** pada pertanyaan pelaporan dan pemblokiran dalam aplikasi, lalu tempel jalur menu di tabel atas pada kolom deskripsi. Sertakan tangkapan layar tombol ⋯ (kartu mitra + layar chat) dan layar **Akun → Pengguna diblokir** bila formulir meminta bukti.

---

## 5. Kata kunci & ASO (Play tidak punya kolom keyword; kata kunci ditanam di judul + deskripsi)

Play Store mengindeks **nama aplikasi**, **deskripsi singkat**, dan **deskripsi lengkap**. Tidak ada kolom "keywords" tersembunyi. Kata kunci prioritas — pastikan semuanya muncul minimal sekali di teks di atas (sudah dicek):

| Prioritas | Kata kunci | Muncul di |
|---|---|---|
| 1 | ojek, ojek online, ojol | judul + deskripsi lengkap |
| 1 | antar makanan, pesan makanan | deskripsi singkat + lengkap |
| 1 | kirim barang, kirim paket | deskripsi singkat + lengkap |
| 2 | belanja pasar, sayur, sembako | deskripsi lengkap (AntarMarket) |
| 2 | travel antar kota | deskripsi singkat + lengkap |
| 2 | mobil box, pindahan, angkut barang | deskripsi lengkap (AntarBox) |
| 3 | dompet digital, top up, QRIS | deskripsi lengkap (AntarPay) |
| 3 | driver, mitra, penghasilan tambahan | aplikasi Mitra |

Aturan yang **tidak boleh** dilanggar (Metadata policy): tanpa "terbaik/#1/nomor satu", tanpa emoji atau simbol dekoratif di judul, tanpa menyebut merek pesaing (Gojek/Grab/Maxim), tanpa "gratis" berulang, tanpa harga, tanpa klaim peringkat, tanpa kata "unduh sekarang" di judul.

---

## 6. Contact details (Store listing → Store settings → Contact details)

| Kolom | Isi |
|---|---|
| Email | `erzamadana@gmail.com` **(wajib; akan tampil publik di halaman Play Store)** |
| Telepon | Opsional — kosongkan bila tidak ingin nomor pribadi tampil publik |
| Situs web | Pelanggan: `https://erzamadana-ui.github.io/antarkita/` · Mitra: `https://erzamadana-ui.github.io/antarkita/mitra/` |
| Alamat eksternal (External marketing) | Tidak diisi |
| Nama developer publik | `AntarKita` |

> Untuk **akun perorangan**, Google mewajibkan **alamat fisik developer** ditampilkan di halaman Play Store (Developer contact). Alamat rumah akan terlihat publik. Bila itu masalah, pertimbangkan akun **organisasi** (butuh badan usaha + D‑U‑N‑S) sejak awal — memindahkan aplikasi dari akun perorangan ke organisasi setelah rilis merepotkan.

---

## 7. Aset grafis siap pakai

Sudah dibuat di `docs/rilis/aset/` (skrip pembuatnya: `docs/rilis/aset/buat-aset.py`, jalankan `python3 docs/rilis/aset/buat-aset.py` untuk membuat ulang):

| Berkas | Ukuran | Dipakai di Play Console |
|---|---|---|
| `ikon-512-pelanggan.png` | 512×512 RGB, tanpa alfa | App icon — AntarKita |
| `ikon-512-mitra.png` | 512×512 RGB, tanpa alfa | App icon — AntarKita Mitra |
| `feature-graphic-pelanggan.png` | 1024×500 RGB | Feature graphic — AntarKita |
| `feature-graphic-mitra.png` | 1024×500 RGB | Feature graphic — AntarKita Mitra |
| `notification-icon.png` (di `apps/<app>/assets/`) | 96×96 RGBA, putih penuh + transparan | Bukan aset Play Console — ikon kecil notifikasi Android; skrip `docs/rilis/aset/buat-ikon-notifikasi.py` |

### Screenshot — **SUDAH ADA, berstatus DRAF**

Delapan screenshot 1080×1920 (tepat 9:16) tersedia di `docs/rilis/aset/screenshot/`. Dibuat dengan
`docs/rilis/aset/bingkai-screenshot.py` dari tangkapan mentah di `screenshot/mentah/`.

| Berkas | Layar | Aplikasi |
|---|---|---|
| `pelanggan-1-beranda.png` | Beranda — 8 layanan, promo AntarTravel, pesanan berjalan | AntarKita |
| `pelanggan-2-ride.png` | AntarRide — kelas kendaraan, titik jemput, tujuan sering dikunjungi | AntarKita |
| `pelanggan-3-ride-peta.png` | Pilih titik jemput di peta | AntarKita |
| `pelanggan-4-lacak.png` | Pelacakan driver — peta, kartu mitra, cocokkan plat, tip, bagikan perjalanan | AntarKita |
| `pelanggan-5-pay.png` | AntarPay — saldo, tunai/saldo/e-wallet lewat Midtrans | AntarKita |
| `mitra-1-beranda.png` | Beranda mitra — sakelar Online, peta, order tersedia | AntarKita Mitra |
| `mitra-2-order.png` | Rincian order — pendapatan per trip, rute, potongan platform | AntarKita Mitra |
| `mitra-3-account.png` | Akun mitra — rating, layanan yang bisa diambil, kode AntarNow | AntarKita Mitra |

Tambahan (**bukan** untuk halaman listing): `bukti-ugc-blokir.png` — layar **Akun → Pengguna diblokir**,
untuk dilampirkan bila formulir UGC/moderasi Play Console meminta bukti tangkapan layar (lihat §4.11).

> ⚠️ **JUJUR SOAL KUALITASNYA — ini DRAF, bukan tangkapan perangkat asli.** Tangkapan mentahnya diambil
> dari **build web** (`dist/`) di Chromium headless pada viewport ponsel dengan data tiruan, bukan dari HP
> Android. Perbedaan yang tetap ada dan bisa dilihat orang yang teliti:
> 1. **Tidak ada status bar Android** (jam, sinyal, baterai) — screenshot HP asli selalu punya.
> 2. **Peta memakai basemap prosedural**, bukan peta Padang yang sebenarnya — tile OpenStreetMap
>    diblokir di lingkungan build. Jalannya terlihat terlalu teratur bila diperhatikan.
> 3. **Data tiruan**: nama "Budi Santoso"/"Ahmad Fauzi", saldo Rp250.000, plat BA 1234 AB.
> 4. Rendering React Native Web berbeda tipis dari React Native di Android (jarak huruf, bayangan).
>
> **Cukup untuk Internal testing dan untuk mengisi listing hari ini** — Google tidak mewajibkan
> screenshot berasal dari perangkat. Tetapi **ganti dengan tangkapan HP asli sebelum rilis produksi**:
> pasang APK dari workflow "Android APK", jalankan alur yang sama, tekan Power + Volume Bawah, lalu
> bingkai ulang dengan `bingkai-screenshot.py` (ganti isi `screenshot/mentah/`, jalankan skripnya).

---

## 8. Sumber kebijakan Google Play + tanggal akses

Semua diverifikasi ulang lewat dokumen resmi Google, **diakses 9 September 2026**:

| Syarat | Ketentuan terverifikasi | Sumber |
|---|---|---|
| Target API level | Aplikasi **baru** dan pembaruan wajib **API 36 (Android 16)** sejak **31 Agustus 2026**; perpanjangan bisa diminta sampai **1 November 2026** | https://developer.android.com/google/play/requirements/target-sdk |
| Produksi untuk akun perorangan baru | **≥12 penguji ter-*opt-in* terus-menerus selama 14 hari berturut-turut** sebelum boleh mengajukan akses produksi; berlaku untuk akun perorangan yang dibuat **setelah 13 November 2023** | https://support.google.com/googleplay/android-developer/answer/14151465 |
| Hapus akun | Wajib **dua-duanya**: jalur hapus akun **di dalam aplikasi** **dan** **tautan web** untuk meminta penghapusan; tautan harus dapat dibuka tanpa error, menonjol, dan menyebut nama aplikasi/pengembang | https://support.google.com/googleplay/android-developer/answer/13327111 |
| Ukuran aplikasi | Batas dihitung dari **ukuran unduhan terkompresi**: modul dasar **500 MB**, aset pack 1,5 GB, total keseluruhan 34 GB | https://support.google.com/googleplay/android-developer/answer/9859372 |
| User Generated Content | Wajib: persetujuan S&K sebelum unggah, definisi konten terlarang, moderasi wajar, **sistem pelaporan di dalam aplikasi**, dan **fungsi memblokir pengguna** bagi aplikasi dengan interaksi langsung antar pengguna — **semuanya sudah ada**, lihat §4.11 | https://support.google.com/googleplay/android-developer/answer/9876937 |
| Financial features | Deklarasi *Financial features* wajib diisi untuk aplikasi berfitur keuangan (termasuk dompet) | https://support.google.com/googleplay/android-developer/answer/13849271 |
| Foto & video | Aplikasi wajib memakai **Android Photo Picker** kecuali punya alasan inti; `READ_MEDIA_IMAGES`/`READ_MEDIA_VIDEO` termasuk izin dengan alternatif berlingkup minimal | https://support.google.com/googleplay/android-developer/answer/15800983 |
| Lokasi latar belakang | Butuh deklarasi + video demo; **tidak berlaku** untuk AntarKita karena `ACCESS_BACKGROUND_LOCATION` diblokir | https://support.google.com/googleplay/android-developer/answer/9799150 |
