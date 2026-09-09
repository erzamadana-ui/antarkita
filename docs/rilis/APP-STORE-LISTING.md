# Teks & Konten Listing App Store (iOS) — AntarKita

Padanan iOS dari `docs/rilis/PLAY-STORE-LISTING.md`. **Isinya tidak bisa disalin mentah-mentah:**
format metadata Apple berbeda dari Google, dan beberapa jawaban kebijakan pun berbeda.

| Beda yang penting | Google Play | App Store |
|---|---|---|
| Nama aplikasi | ≤ 30 karakter | ≤ **30** karakter (sama) |
| Ringkasan pendek | "Deskripsi singkat" ≤ 80 | **Subtitle** ≤ **30** — jauh lebih pendek, harus dirombak |
| Teks yang bisa diubah tanpa rilis baru | (tidak ada) | **Promotional text** ≤ **170** — bisa diganti kapan saja tanpa submit versi baru |
| Deskripsi | ≤ 4000 | ≤ **4000** (sama) |
| Kata kunci | tidak ada kolom; diindeks dari judul + deskripsi | **Keywords** ≤ **100 karakter total**, dipisah koma. Deskripsi TIDAK diindeks — kolom ini yang menentukan pencarian |
| Deklarasi data | Data safety | **App Privacy** (nutrition label) — kategori & istilah berbeda |
| Akun reviewer | App access | **App Review Information** — wajib, plus catatan & lampiran |
| Hapus akun | wajib in-app **dan** URL web | wajib **in-app**; URL web saja TIDAK cukup |
| Berkas manifest | — | **`PrivacyInfo.xcprivacy`** wajib sejak 1 Mei 2024 (sudah dibuat otomatis, lihat §9) |

Tiga aplikasi, dua yang dirilis ke App Store:

| | Pelanggan | Mitra | Admin |
|---|---|---|---|
| Bundle ID | `id.antarkita.app` | `id.antarkita.mitra` | `id.antarkita.admin` |
| Rilis App Store | ya | ya | **tidak** — web saja (`/admin/`) |
| Profil EAS | `production-pelanggan` | `production-mitra` | — |
| Ikon/splash | `apps/pelanggan/assets/` | `apps/mitra/assets/` | |
| Perangkat | iPhone saja | iPhone saja | — |

> **iPhone saja itu keputusan sadar, bukan kelalaian.** `app.config.ts` menyetel
> `ios.supportsTablet: APP === 'admin'`, dan hasil prebuild memberi `TARGETED_DEVICE_FAMILY = "1"`
> (diverifikasi 9 Sep 2026). Begitu aplikasi menyatakan mendukung iPad, App Store Connect
> **mewajibkan** screenshot iPad 13" — pekerjaan tambahan untuk perangkat yang tidak jadi sasaran.

URL wajib (sama dengan Play, sudah hidup):

- Kebijakan Privasi (**wajib** di App Store Connect): `https://erzamadana-ui.github.io/antarkita/privacy/`
- Syarat & Ketentuan / EULA: `https://erzamadana-ui.github.io/antarkita/terms/`
- Dukungan (**Support URL — wajib**): `https://erzamadana-ui.github.io/antarkita/`
- Marketing URL (opsional): `https://erzamadana-ui.github.io/antarkita/` (Mitra: `/mitra/`)
- Halaman permintaan hapus akun: `https://erzamadana-ui.github.io/antarkita/hapus-akun/`
  — di App Store ini **pelengkap**, bukan pengganti tombol hapus akun di dalam aplikasi (§8).
- Email kontak: `erzamadana@gmail.com`

---

## 1. Aplikasi Pelanggan — `id.antarkita.app`

**App Name (≤30):**

```
AntarKita: Ojek, Makan, Kirim
```
*29 karakter.* Alternatif: `AntarKita - Ojek & Antar Semua` (30) atau `AntarKita` (9).

**Subtitle (≤30):**

```
Ojek, antar makanan & barang
```
*28 karakter.* Alternatif: `Ojek, makanan, pasar, travel` (28) · `Semua antaran dalam satu app` (28).

> Subtitle **ikut diindeks pencarian** seperti judul. Jangan mengulang kata yang sudah ada di
> judul (mengulang tidak menambah peringkat, hanya membuang jatah 30 karakter) — karena itu
> subtitle di atas memakai "makanan" dan "barang", bukan mengulang "Ojek/Kirim" saja.

**Promotional text (≤170)** — bisa diganti kapan saja **tanpa** mengajukan versi baru. Pakai untuk promo musiman:

```
Pesan ojek, mobil, makanan, dan belanja pasar, lalu bayar dengan satu dompet AntarPay. Lacak mitra di peta, chat tanpa membagikan nomor HP Anda.
```
*144 karakter.*

**Description (≤4000):**

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
• AntarPay — dompet dalam aplikasi untuk membayar semua layanan tanpa uang tunai. Top up lewat transfer bank, e-wallet, dan QRIS (diproses Midtrans).

KENAPA ANTARKITA
• Tarif transparan: lihat estimasi total sebelum memesan, termasuk biaya layanan.
• Lacak langsung: posisi mitra dan status pesanan tampil di peta secara real-time.
• Chat dan panggilan di dalam aplikasi — nomor HP Anda tidak dibagikan ke siapa pun.
• Pusat Keamanan: tombol SOS, bagikan perjalanan ke keluarga, kontak darurat, mitra terverifikasi dengan foto dan plat nomor.
• Laporkan dan blokir pengguna langsung dari halaman pesanan atau layar chat.
• Bayar tunai atau AntarPay — Anda yang pilih.
• Alamat tersimpan (rumah, kantor) dan riwayat pesanan untuk pesan ulang cepat.
• Bantuan cepat lewat tiket aduan dengan CS yang responsif.

CARA PAKAI
1. Daftar dengan email dan nomor HP.
2. Pilih layanan, tentukan titik jemput/antar atau pilih menu.
3. Cek estimasi tarif, pilih metode bayar, lalu pesan.
4. Pantau mitra di peta, chat bila perlu, dan beri penilaian setelah selesai.

IZIN YANG DIPAKAI
• Lokasi (hanya saat aplikasi dibuka) untuk titik jemput, mitra terdekat, dan pelacakan pesanan. AntarKita tidak melacak posisi Anda saat aplikasi ditutup.
• Kamera dan galeri untuk foto profil dan bukti transfer.
• Mikrofon untuk panggilan suara di dalam aplikasi. Panggilan tidak direkam.

AKUN DAN DATA
Anda dapat menghapus akun beserta datanya kapan saja langsung dari aplikasi: Akun → Lainnya → Hapus akun. AntarKita tidak menampilkan iklan pihak ketiga dan tidak melacak aktivitas Anda di aplikasi atau situs perusahaan lain.

Tertarik jadi mitra? Unduh aplikasi AntarKita Mitra untuk driver, merchant, pedagang pasar, mitra travel, dan mobil box.

AntarKita — antar apa saja, ke mana saja.
Kebijakan Privasi: https://erzamadana-ui.github.io/antarkita/privacy/
Syarat & Ketentuan: https://erzamadana-ui.github.io/antarkita/terms/
Bantuan: erzamadana@gmail.com
```

*Panjang deskripsi Pelanggan terverifikasi: **3042 karakter** (batas 4000).*

**Keywords (≤100 karakter termasuk koma):**

```
ojol,taksi,antar,kurir,paket,motor,mobil,travel,pasar,sembako,belanja,dompet,qris,ongkir
```
*88 karakter.*

Aturan kolom keywords Apple yang gampang dilanggar:

- **Jangan pakai spasi setelah koma** — spasi ikut dihitung dan membuang jatah karakter.
- **Jangan mengulang kata yang sudah ada di App Name atau Subtitle** (`ojek`, `makanan`, `barang`, `kirim`, `antarkita`) — Apple sudah mengindeksnya; mengulang hanya membuang karakter. Karena itu daftar di atas memakai `ojol` (bukan `ojek`) dan `ongkir`.
- **Jangan pakai nama merek pesaing** (Gojek, Grab, Maxim, Shopee). Ini pelanggaran merek dagang dan alasan penolakan langsung.
- **Jangan bentuk jamak/varian** (`paket` sudah mencakup `paket-paket`); Apple mencocokkan sebagian kata.
- **Jangan pakai kata "app", "gratis", "terbaik"** — mubazir atau melanggar aturan metadata.

**Category:** Primary **Travel** · Secondary **Food & Drink**
*(App Store tidak punya kategori "Maps & Navigation" untuk aplikasi seperti Play; Travel adalah kategori tempat aplikasi ride-hailing berada. Secondary boleh dikosongkan.)*
**Age Rating:** 4+ dari kuesioner, tapi lihat §6 — jawaban jujur kemungkinan menaikkannya ke **17+** karena akses lokasi tak terbatas dan konten buatan pengguna.
**Copyright:** `2026 AntarKita`
**Price:** Free · **Availability:** Indonesia saja
**In-App Purchases:** **Tidak ada** — lihat §7 (analisis Guideline 3.1.3(e)).

---

## 2. Aplikasi Mitra — `id.antarkita.mitra`

**App Name (≤30):**

```
AntarKita Mitra: Driver & Toko
```
*30 karakter — pas di batas.*

**Subtitle (≤30):**

```
Terima order, cairkan hasilnya
```
*30 karakter.* Alternatif: `Aplikasi resmi mitra AntarKita` (30).

**Promotional text (≤170):**

```
Nyalakan Online, terima pesanan di sekitar Anda, dan lihat pendapatan bersih sebelum menerima. Pencairan ke rekening bank kapan saja lewat dompet AntarPay.
```
*155 karakter.*

**Description (≤4000):**

```
AntarKita Mitra adalah aplikasi resmi untuk mitra AntarKita — driver ojek/mobil, pemilik warung dan toko, pedagang pasar tradisional, operator travel antar kota, dan pemilik mobil box. Terima pesanan, kelola usaha, dan cairkan pendapatan dari satu aplikasi.

UNTUK MITRA DRIVER (AntarRide, AntarCar, AntarFood, AntarSend, AntarShop, AntarMarket, AntarBox)
• Nyalakan status Online dan terima pesanan di sekitar Anda dengan rincian tarif dan pendapatan bersih sebelum menerima.
• Navigasi ke titik jemput/antar, chat dan panggilan ke pelanggan tanpa membagikan nomor HP.
• PIN serah terima dan foto bukti pengiriman untuk melindungi Anda dari sengketa.
• Ringkasan pendapatan harian/mingguan, riwayat perjalanan, dan rating.
• Pendaftaran cepat: unggah SIM, STNK, KTP, dan foto kendaraan.

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
• Top up saldo deposit untuk menerima pesanan tunai (diproses Midtrans).

KEAMANAN & DUKUNGAN
• Pusat Keamanan: SOS, verifikasi wajah, kontak darurat, laporan insiden.
• Laporkan dan blokir pelanggan bermasalah langsung dari halaman pesanan atau layar chat.
• Tiket aduan langsung ke CS AntarKita.
• Mode ganda: satu akun bisa menjadi driver sekaligus merchant/pedagang — beralih mode dengan satu ketukan.

IZIN YANG DIPAKAI
• Lokasi saat aplikasi dibuka: agar pesanan di sekitar Anda dapat dicocokkan dan pelanggan bisa melacak posisi Anda saat Online. Pelacakan berhenti saat aplikasi ditutup.
• Kamera dan galeri: dokumen pendaftaran, foto produk, selfie verifikasi, dan bukti pengiriman.
• Mikrofon: panggilan suara di dalam aplikasi. Panggilan tidak direkam.

AKUN DAN DATA
Hapus akun beserta datanya kapan saja dari aplikasi: Akun → Lainnya → Hapus akun. Dokumen yang wajib disimpan untuk kepatuhan hukum dijelaskan di Kebijakan Privasi.

Syarat menjadi mitra: usia minimal 18 tahun, KTP dan dokumen kendaraan/usaha yang berlaku. Mitra adalah mitra usaha independen; komisi platform tercantum transparan di setiap pesanan.

AntarKita Mitra — penghasilan tambahan, satu aplikasi.
Kebijakan Privasi: https://erzamadana-ui.github.io/antarkita/privacy/
Syarat & Ketentuan: https://erzamadana-ui.github.io/antarkita/terms/
Bantuan: erzamadana@gmail.com
```

*Panjang deskripsi Mitra terverifikasi: **3300 karakter** (batas 4000).*

**Keywords (≤100):**

```
ojol,kurir,merchant,warung,pasar,travel,order,penghasilan,mitra,antar,box,lapak,pesanan
```
*87 karakter.* (`driver` dan `toko` sengaja **tidak** diulang — sudah ada di App Name.)

**Category:** Primary **Business** · Secondary **Travel**
**Age Rating:** 17+ (lihat §6) · **Price:** Free · **Availability:** Indonesia saja

---

## 3. Aset grafis App Store

| Aset | Spesifikasi Apple | Status AntarKita |
|---|---|---|
| **App Icon** | **1024×1024 px**, PNG/JPG, **tanpa kanal alfa**, **tanpa sudut membulat** (iOS yang memotong) | **SUDAH** — `docs/rilis/aset/ios/ikon-1024-pelanggan.png` & `…-mitra.png`, dibuat & diverifikasi oleh `docs/rilis/aset/ios/buat-ikon-ios.py` (1024×1024 RGB, tanpa alfa, sudut persegi). Ikon di dalam `.ipa` juga dihasilkan Expo dari sumber yang sama. |
| **Screenshot iPhone** | **Wajib** minimal 1, maks 10 per set. Cukup **satu** dari dua ukuran ini: **6,9" = 1320×2868** (iPhone 17/16/15 Pro Max) **atau 6,5" = 1284×2778** (iPhone 14 Plus / 13 Pro Max / XS Max). Ukuran lain diskalakan otomatis. PNG/JPG, **tanpa alfa** | **BELUM** — hanya pemilik yang bisa membuat (butuh iPhone atau Simulator di Mac). Lihat catatan di bawah. |
| **Screenshot iPad** | Wajib **hanya bila** aplikasi mendukung iPad (13" = 2064×2752) | **TIDAK PERLU** — kedua aplikasi iPhone-only (`TARGETED_DEVICE_FAMILY = "1"`, terverifikasi) |
| **App Preview (video)** | Opsional, 15–30 detik | Tidak dibuat |

Beda penting dari Play: **tidak ada "feature graphic"** di App Store, jadi
`docs/rilis/aset/feature-graphic-*.png` tidak dipakai di sini.

**Cara membuat screenshot 6,9" tanpa iPhone Pro Max:** jalankan
`eas build --profile preview-simulator-pelanggan --platform ios`, pasang hasilnya di Simulator
macOS dengan perangkat **iPhone 17 Pro Max**, lalu `Cmd+S` — Simulator menyimpan PNG tepat
1320×2868. Tanpa Mac sama sekali, screenshot harus diambil dari iPhone fisik model 6,9"/6,5".
Screenshot dari Android atau dari peramban desktop **tidak** memenuhi rasio yang diminta.

Urutan yang disarankan (sama dengan Play): Pelanggan — Beranda layanan → Pesan AntarRide
(peta + estimasi) → Lacak pesanan → AntarFood → AntarMarket → AntarPay. Mitra — Beranda
Online + pesanan masuk → Rincian pendapatan → Menu merchant → Lapak pasar → Jadwal travel.

---

## 4. App Privacy ("nutrition label") — jawaban per kategori

Diisi di App Store Connect → aplikasi → **App Privacy**. Tiga kolom yang harus dijawab untuk
setiap jenis data: **dikumpulkan?**, **ditautkan ke identitas pengguna?**, **dipakai untuk
tracking?**, plus **tujuan**.

**Jawaban global lebih dulu:**

- *Do you or your third-party partners collect data from this app?* → **Yes**
- *Is any data used to track you?* (bagian "Data Used to Track You") → **TIDAK ADA satu pun.**
  Tidak ada SDK iklan/analitik pihak ketiga, tidak memakai IDFA, tidak ada data yang dijual ke
  data broker, tidak ada penggabungan dengan data perusahaan lain. Lihat §5.
- Midtrans adalah **pemroses pembayaran**, Supabase adalah **penyedia layanan** — keduanya
  bukan "tracking" menurut definisi Apple.

| Kategori Apple | Jenis data | Dikumpulkan | Linked to user | Tracking | Tujuan (pilih di form) |
|---|---|---|---|---|---|
| **Contact Info** | Name | Ya | Ya | Tidak | App Functionality |
| | Email Address | Ya | Ya | Tidak | App Functionality |
| | Phone Number | Ya | Ya | Tidak | App Functionality |
| | Physical Address | Ya | Ya | Tidak | App Functionality *(alamat jemput/antar & alamat tersimpan)* |
| | Other User Contact Info | Ya | Ya | Tidak | App Functionality *(kontak darurat)* |
| **Financial Info** | Payment Info | **Tidak** | — | — | Nomor kartu/e-wallet ditangani penuh Midtrans; aplikasi tidak pernah melihatnya |
| | Other Financial Info | Ya | Ya | Tidak | App Functionality *(saldo AntarPay, rekening pencairan mitra)* |
| **Location** | Precise Location | Ya | Ya | Tidak | App Functionality |
| | Coarse Location | Ya | Ya | Tidak | App Functionality |
| **Sensitive Info** | Sensitive Info | **Tidak** | — | — | Tidak ada data ras/agama/orientasi/biometrik. Selfie verifikasi disimpan sebagai **foto** untuk ditinjau admin, bukan template biometrik |
| **Contacts** | Contacts | **Tidak** | — | — | Buku telepon tidak pernah dibaca |
| **User Content** | Photos or Videos | Ya | Ya | Tidak | App Functionality |
| | Audio Data | **Tidak** | — | — | Panggilan WebRTC real-time, **tidak direkam & tidak disimpan** |
| | Emails or Text Messages | Ya | Ya | Tidak | App Functionality *(chat dalam pesanan)* |
| | Customer Support | Ya | Ya | Tidak | App Functionality *(tiket aduan)* |
| | Other User Content | Ya | Ya | Tidak | App Functionality *(ulasan, rating, foto produk)* |
| **Browsing History** | — | **Tidak** | — | — | |
| **Search History** | Search History | Ya | Ya | Tidak | App Functionality *(pencarian alamat & merchant)* |
| **Identifiers** | User ID | Ya | Ya | Tidak | App Functionality |
| | Device ID | Ya | Ya | Tidak | App Functionality *(token push notification — **bukan** IDFA)* |
| **Purchases** | Purchase History | Ya | Ya | Tidak | App Functionality, Analytics *(riwayat pesanan & mutasi AntarPay)* |
| **Usage Data** | Product Interaction | Ya | Ya | Tidak | Analytics, App Functionality *(log aktivitas & audit)* |
| | Advertising Data | **Tidak** | — | — | Tidak ada iklan |
| **Diagnostics** | Crash Data | Ya | **Tidak** | Tidak | App Functionality *(log kesalahan server, tanpa identitas)* |
| | Performance Data | **Tidak** | — | — | |
| **Health & Fitness**, **Surroundings**, **Body**, **Other Data** | — | **Tidak** | — | — | |

**Untuk aplikasi Mitra, tambahkan:**

| Kategori | Jenis data | Catatan |
|---|---|---|
| Contact Info → Other | NIK, nomor SIM, plat & data kendaraan | Linked · App Functionality + (bila tersedia) *Other Purposes: kepatuhan hukum & pencegahan penipuan* |
| User Content → Photos | KTP, SIM, STNK, NPWP, izin usaha, selfie verifikasi | Linked · App Functionality |

**Privacy Policy URL** (wajib diisi di halaman yang sama):
`https://erzamadana-ui.github.io/antarkita/privacy/`

> **Peringatan konsistensi.** Label ini harus cocok dengan: (a) isi Kebijakan Privasi,
> (b) jawaban Data safety di Play Console (`PLAY-STORE-LISTING.md` §4.7), dan (c) izin yang
> benar-benar ada di `Info.plist`. Reviewer Apple sering membandingkan ketiganya. Kalau
> Kebijakan Privasi menyebut data yang tidak dideklarasikan di sini (atau sebaliknya), itu
> penolakan Guideline 5.1.1.

---

## 5. App Tracking Transparency (ATT) — **TIDAK diperlukan**, ini buktinya

Apple mendefinisikan *tracking* sebagai **menautkan data dari aplikasi ini dengan data dari
aplikasi/situs/properti offline PERUSAHAAN LAIN** untuk iklan bertarget atau pengukuran iklan,
atau **membagikannya ke data broker**.

| Uji "apakah ini tracking?" | AntarKita |
|---|---|
| Menampilkan iklan berdasarkan data dari aplikasi/situs perusahaan lain | Tidak ada iklan sama sekali |
| Membagikan pengenal iklan / daftar email ke jaringan iklan untuk retargeting | Tidak dilakukan |
| Membagikan data ke data broker | Tidak dilakukan |
| Memakai SDK analitik yang menggabungkan data dengan data pengembang lain | **Tidak ada SDK analitik/iklan pihak ketiga sama sekali** — periksa `package.json`: tidak ada Firebase Analytics, Facebook SDK, AppsFlyer, Adjust, Branch, Sentry, atau sejenisnya |
| Mengakses IDFA (`ASIdentifierManager`) | Tidak. `AppTrackingTransparency` bahkan tidak ditautkan; `NSUserTrackingUsageDescription` sengaja **tidak** ada di `Info.plist` |
| Tracking di dalam webview | Webview hanya memuat peta Leaflet lokal (`src/components/map/`) dan halaman pembayaran Midtrans — bukan iklan |

**Kesimpulan:** jangan tampilkan prompt ATT, jangan tambahkan
`NSUserTrackingUsageDescription`. Di App Privacy, bagian **"Data Used to Track You" harus
kosong**, dan `PrivacyInfo.xcprivacy` menyatakan `NSPrivacyTracking = false` (terverifikasi
pada hasil prebuild, §9).

> **Jebakan:** menambahkan `NSUserTrackingUsageDescription` "untuk berjaga-jaga" bukan langkah
> aman — Apple akan menanyakan mana fitur yang memakai tracking, dan tidak ada jawabannya.

---

## 6. Age Rating — kuesioner App Store Connect

Apple memakai kuesioner sendiri (bukan IARC seperti Play). Jawaban jujur:

| Pertanyaan | Jawaban |
|---|---|
| Cartoon/Fantasy Violence, Realistic Violence, Sexual Content, Nudity, Profanity, Horror, Alcohol/Tobacco/Drugs, Simulated Gambling, Contests | **None** untuk semuanya |
| **Unrestricted Web Access** | **No** — webview hanya untuk peta dan halaman pembayaran, bukan peramban bebas |
| **Gambling** | No |
| **User-Generated Content / Messaging** ("app includes… user-generated content or messaging") | **Yes** — chat & panggilan dalam pesanan, ulasan, foto merchant. Ada pelaporan, blokir, dan moderasi (§8) |
| **Frequent/Intense Contests** | None |
| **Medical/Treatment Information** | No |
| **App provides access to location that could be used to determine the user's location** *(pertanyaan lokasi tak terbatas)* | **Yes** — posisi mitra & pelanggan dibagikan selama pesanan berjalan |

**Hasil yang harus diperkirakan: 17+.** Dua jawaban "Yes" terakhir (UGC/messaging + berbagi
lokasi) memang menaikkan rating. **Jangan menjawab "No" demi rating 4+** — jawaban yang tidak
sesuai kenyataan adalah pelanggaran Guideline 2.3 (Accurate Metadata) dan pembanding paling
mudah bagi reviewer, karena fiturnya kelihatan di layar pertama.

Di bagian **Age Rating → "Made for Kids"**: **No**.

---

## 7. In-App Purchase — apakah top up AntarPay kena potongan 30% Apple?

**Jawaban: TIDAK. Bahkan sebaliknya — Apple MELARANG memakai In-App Purchase untuk ini.**

Dasarnya Guideline **3.1.3(e) Goods and Services Outside of the App**, dikutip utuh
(diakses 9 September 2026):

> *"If your app enables people to purchase physical goods or services that will be consumed
> outside of the app, you must use purchase methods other than in-app purchase to collect those
> payments, such as Apple Pay or traditional credit card entry."*

Perhatikan kata **"must"**: ini kewajiban memakai metode **selain** IAP, bukan sekadar izin.
Semua yang dibeli dengan AntarPay — perjalanan ojek/mobil, makanan yang diantar, pengiriman
paket, belanja pasar, sewa mobil box, tiket travel — adalah **barang dan jasa fisik yang
dikonsumsi di dunia nyata**, bukan konten digital di dalam aplikasi.

**Kenapa "isi saldo dompet" tidak berubah menjadi barang digital.** Guideline **3.1.1**
menyebut satu-satunya bentuk voucher yang wajib IAP:

> *"Digital gift cards, certificates, vouchers, and coupons which can be redeemed for digital
> goods or services can only be sold in your app using in-app purchase."*

Kuncinya **"redeemed for digital goods or services"**. Saldo AntarPay hanya bisa ditukar dengan
jasa fisik dunia nyata di dalam platform AntarKita. Selama itu benar, top up berada di luar
kewajiban IAP — dan justru masuk 3.1.3(e).

**Tiga syarat yang HARUS terus dipenuhi agar jawaban ini tetap benar:**

1. **Saldo AntarPay tidak boleh pernah bisa membeli barang/jasa digital di dalam aplikasi.**
   Begitu saldo dipakai untuk membuka fitur premium, langganan, stiker, tema, atau konten
   digital apa pun, bagian itu WAJIB memakai IAP dan Apple memotong komisinya. Hari ini tidak
   ada fitur seperti itu (`src/screens/pay/`, `src/components/WalletView.tsx`) — jaga tetap begitu.
2. **Jangan ada "tip untuk driver" berbasis mata uang dalam aplikasi yang dijual sebagai
   kredit digital.** Tip kepada mitra atas jasa fisik yang sudah diberikan aman; menjual
   "koin" untuk tip tidak.
3. **Di dalam aplikasi, jangan mengajak pengguna membayar di luar aplikasi.** Guideline 3.1.3
   (pembuka) menyatakan aplikasi di bagian ini *"cannot, within the app, encourage users to use
   a purchasing method other than in-app purchase"* kecuali di storefront Amerika Serikat.
   Membuka halaman pembayaran Midtrans **untuk jasa fisik** bukan pelanggaran — yang dilarang
   adalah mengarahkan pengguna keluar untuk membeli **barang digital**.

**Yang harus diisi di App Store Connect:** bagian *In-App Purchases* **dikosongkan**, dan di
*App Review Information → Notes* tulis penjelasan berikut (bahasa Inggris) agar reviewer tidak
salah menandai:

> AntarKita is a ride-hailing and delivery marketplace. All payments in the app are for physical
> goods and real-world services delivered offline (rides, food delivery, courier, groceries,
> intercity travel). AntarPay is a closed-loop stored-value balance that can only be spent on
> those real-world services within AntarKita; it cannot be used to buy any digital content,
> features, or subscriptions, and it cannot be transferred between users. Per Guideline 3.1.3(e),
> these payments are collected using methods other than in-app purchase (Midtrans, a licensed
> Indonesian payment gateway). The app contains no digital goods and no in-app purchases.

**Guideline 4.7 (mini apps) tidak berlaku.** 4.7 mengatur aplikasi yang **menjadi wadah**
perangkat lunak pihak ketiga yang tidak tertanam di biner — mini app/mini game HTML5, chatbot,
plug-in, emulator. AntarKita tidak memuat perangkat lunak pihak ketiga apa pun: webview-nya
hanya memuat peta Leaflet yang dibundel sendiri (`src/components/map/leaflet-bundle.ts`) dan
halaman pembayaran Midtrans. Merchant di AntarKita menjual **makanan dan barang**, bukan
perangkat lunak.

**Guideline 3.1.5 (Cryptocurrencies) tidak berlaku.** AntarPay adalah saldo Rupiah tertutup,
bukan mata uang virtual/kripto. (Tetap catat: aturan 3.1.5(i) mewajibkan pengembang berbentuk
**organisasi** untuk dompet mata uang virtual — pengingat bahwa apa pun yang berbau keuangan
lebih aman di akun organisasi; lihat §11 dan RUNBOOK-LISTING-IOS.md.)

---

## 8. Kewajiban kebijakan lain — status AntarKita

### 8.1 Guideline 5.1.1(v) — Account Deletion: **SUDAH**

Apple mewajibkan **penghapusan akun dimulai DI DALAM aplikasi** sejak 30 Juni 2022. Tautan web
saja **tidak cukup** (berbeda dari Play yang justru mewajibkan tautan web).

- Layar in-app: `src/screens/account/delete.tsx` → menu **Akun → Lainnya → Hapus akun**
- Sisi server: `supabase/migrations/0023_hapus_akun.sql`
- Halaman web pendamping (dipakai Play, boleh disebut juga di sini):
  `https://erzamadana-ui.github.io/antarkita/hapus-akun/`

> **Verifikasi sebelum submit.** `CHECKLIST-GO-LIVE.md` §E menandai status migrasi 0023 sebagai
> "BERTENTANGAN, verifikasi sebelum apa pun". Tombol hapus akun yang menampilkan galat adalah
> penolakan 5.1.1(v) yang langsung dan pasti. Uji dengan akun sungguhan sebelum submit.

### 8.2 Guideline 1.2 — User-Generated Content: **SUDAH**

Apple menuntut empat hal; keempatnya sudah ada (implementasi lengkap didokumentasikan di
`PLAY-STORE-LISTING.md` §4.11 — migrasi `0050_moderasi_ugc_lapor_blokir.sql`):

| Tuntutan Guideline 1.2 (kutipan) | Status |
|---|---|
| *"A method for filtering objectionable material from being posted to the app"* | Ada — S&K melarang konten tertentu, chat hanya dalam konteks pesanan (tidak ada umpan publik), trigger basis data menolak pesan dari pihak terblokir |
| *"A mechanism to report offensive content and timely responses to concerns"* | Ada — tombol **⋯ → Laporkan** (enam kategori) di kartu mitra/pelanggan, layar chat, tekan-lama gelembung pesan, tab Ulasan & Info merchant. Antrean admin dengan tenggat **48 jam** |
| *"The ability to block abusive users from the service"* | Ada — **⋯ → Blokir**, dikelola di **Akun → Pengguna diblokir**, ditegakkan di sisi basis data (pencocokan driver, chat, panggilan) |
| *"Published contact information so users can easily reach you"* | Ada — `erzamadana@gmail.com` di halaman App Store, di dalam aplikasi, dan di Kebijakan Privasi |

Salin jalur menu persis dari `PLAY-STORE-LISTING.md` §4.11 ke kolom **App Review Information →
Notes**; reviewer Apple menguji jalur ini secara manual (lihat §10).

### 8.3 Guideline 4.8 — Sign in with Apple: **TIDAK dipicu**

Aturannya berlaku bila aplikasi memakai **layanan login pihak ketiga/sosial** (Google, Facebook,
X, LinkedIn, Amazon, WeChat) untuk akun utama. Pengecualian pertama yang disebut Apple:

> *"Another login service is not required if: Your app exclusively uses your company's own
> account setup and sign-in systems."*

AntarKita persis di situ: login hanya email + kata sandi lewat Supabase Auth milik sendiri.
Diverifikasi dengan menyisir `src/` — **tidak ada** `signInWithOAuth`, `signInWithIdToken`,
maupun SDK login sosial mana pun. **Sign in with Apple tidak wajib.**

> **Konsekuensi ke depan:** menambahkan tombol "Masuk dengan Google" suatu hari akan **langsung**
> mewajibkan Sign in with Apple di aplikasi iOS. Pertimbangkan itu sebelum menambah login sosial.

### 8.4 Guideline 5.1.1(ix) — bidang yang diatur ketat

> *"Apps that provide services in highly regulated fields (such as banking and financial services,
> healthcare, gambling, legal cannabis use, air travel and crypto exchanges) or that require
> sensitive user information should be submitted by a legal entity that provides the services,
> and not by an individual developer."*

AntarKita **bukan** bank dan bukan bursa kripto: AntarPay adalah saldo tertutup, dan seluruh
pembayaran diproses PT Midtrans (penyelenggara berizin Bank Indonesia). Tetapi aplikasi ini
**meminta informasi pengguna yang sensitif** (KTP/NIK, SIM, STNK untuk mitra) dan memuat fitur
dompet. Itu cukup membuat reviewer mempertanyakan akun perorangan.

**Rekomendasi jujur: daftar sebagai organisasi bila badan usaha sudah ada.** Bila belum,
mendaftar sebagai perorangan tetap mungkin — tetapi siapkan jawaban di App Review Notes bahwa
AntarKita bukan lembaga keuangan dan uang diproses oleh gateway berizin (teks siap pakai ada di
§10), dan sadari bahwa ini titik risiko penolakan yang nyata. Pemindahan aplikasi dari akun
perorangan ke akun organisasi setelah rilis bisa dilakukan lewat App Transfer, tetapi merepotkan.

### 8.5 Guideline 5.1.2 — data lokasi

> *"Your app may not require users to enable system functionalities (e.g. push notifications,
> location services, tracking) in order to access functionality, content, use the app…"*

Artinya: **aplikasi harus tetap bisa dibuka dan dipakai walau izin lokasi ditolak.** Uji ini
sebelum submit — tolak izin lokasi di iPhone, lalu pastikan pengguna masih bisa masuk, melihat
daftar layanan, dan memasukkan alamat manual. Aplikasi yang layar putih/menutup sendiri saat
lokasi ditolak adalah penolakan Guideline 5.1.2 sekaligus 2.1 (crash).

---

## 9. Privacy Manifest — `PrivacyInfo.xcprivacy`

Wajib: App Store Connect **menolak unggahan** aplikasi yang memakai *required reason API* tanpa
mendeklarasikannya, sejak **1 Mei 2024**. Kutipan Apple:

> *"Starting May 1, 2024, apps that don't describe their use of required reason API in their
> privacy manifest file aren't accepted by App Store Connect."*

**Sudah dikonfigurasi** di `app.config.ts` → `ios.privacyManifests`, dan Expo menulisnya ke
`ios/<Proyek>/PrivacyInfo.xcprivacy` saat prebuild. Isi yang benar-benar dihasilkan
(diverifikasi 9 Sep 2026 dengan `npx expo prebuild --platform ios --no-install`):

| Kategori | Kode alasan | Arti kode (dokumentasi Apple) | Kenapa proyek ini memakainya |
|---|---|---|---|
| `NSPrivacyAccessedAPICategoryFileTimestamp` | `C617.1` | *"access the timestamps, size, or other metadata of files inside the app container, app group container, or the app's CloudKit container"* | React Native core & AsyncStorage — keduanya mendeklarasikan `C617.1` di manifest bawaannya |
| `NSPrivacyAccessedAPICategoryUserDefaults` | `CA92.1` | *"access user defaults to read and write information that is only accessible to the app itself"* | React Native core & expo-notifications (preferensi aplikasi sendiri) |
| `NSPrivacyAccessedAPICategoryDiskSpace` | `E174.1` | *"check whether there is sufficient disk space to write files, or to check whether the disk space is low"* | expo-file-system saat mengunggah foto dokumen/bukti transfer |

Ditambah `NSPrivacyTracking = false` dan `NSPrivacyTrackingDomains = []`.

**Kenapa daftar ini bukan tebakan:** setiap kategori & kode disalin dari privacy manifest yang
benar-benar terpasang di `node_modules` — `react-native/React/Resources/PrivacyInfo.xcprivacy`,
`expo-file-system/ios/PrivacyInfo.xcprivacy`, `expo-notifications/ios/PrivacyInfo.xcprivacy`,
`@react-native-async-storage/async-storage/ios/PrivacyInfo.xcprivacy`.

**Kenapa `NSPrivacyCollectedDataTypes` sengaja dibiarkan kosong:** untuk *aplikasi* (berbeda dari
SDK pihak ketiga) Apple menyatakan hanya `NSPrivacyAccessedAPITypes` yang perlu diisi —
deklarasi data yang dikumpulkan adalah kuesioner **App Privacy** di App Store Connect (§4).
Mengisi keduanya menciptakan dua sumber kebenaran yang bisa saling bertentangan saat review.

**Satu risiko yang belum tertutup — `react-native-webrtc`.** Paket versi `124.0.8` yang
terpasang **tidak memuat `PrivacyInfo.xcprivacy` sama sekali** (diperiksa langsung di
`node_modules/react-native-webrtc/`). Dua hal yang meringankan:

1. `react-native-webrtc` **tidak** ada di daftar Apple "SDK yang wajib punya privacy manifest &
   tanda tangan" (daftar itu memuat Firebase, GoogleSignIn, Flutter, dll., bukan paket ini).
2. Podfile hasil prebuild mengaktifkan `:privacy_file_aggregation_enabled => true`, sehingga
   manifest pod digabungkan ke aplikasi.

Yang harus disiapkan: **bila App Store Connect mengirim email `ITMS-91053: Missing API
declaration`** setelah unggahan pertama, email itu menyebut kategori API yang kurang. Tambahkan
kategori tersebut ke `ios.privacyManifests` di `app.config.ts`, bangun ulang, unggah lagi.
`ITMS-91053` datang sebagai **email peringatan**, bukan penolakan seketika — tetapi jangan
diabaikan, karena unggahan berikutnya bisa ditolak.

---

## 10. App Review Information — isi persis di App Store Connect

Bagian ini tidak ada padanannya yang serapi ini di Play, dan **paling sering menjadi penyebab
penolakan aplikasi ride-hailing**: reviewer duduk di Cupertino, tidak punya nomor HP Indonesia,
dan tidak akan melihat satu pun mitra online kalau tidak disiapkan.

**Sign-In Required:** **Yes**

**Demo Account (buat khusus reviewer di Supabase produksi, jangan pakai akun nyata):**

| Aplikasi | Username | Password | Catatan |
|---|---|---|---|
| Pelanggan | `applereview@antarkita.id` | *(isi, simpan di pengelola kata sandi)* | Saldo AntarPay uji ≥ Rp500.000, alamat tersimpan sudah diisi |
| Mitra | `applereview.mitra@antarkita.id` | *(isi)* | Status **approved**, dokumen sudah terverifikasi, bisa langsung Online |

**Contact Information:** nama lengkap pemilik · `erzamadana@gmail.com` · nomor telepon yang
benar-benar bisa dihubungi (Apple memang kadang menelepon).

**Notes** (bahasa Inggris; ini yang dibaca reviewer — tulis lengkap):

```
AntarKita is a ride-hailing, food delivery and courier marketplace operating in Indonesia only.

HOW TO REVIEW WITHOUT REAL DRIVERS NEARBY
The app matches customers with nearby partners. In your location there are no live partners, so
please use the two demo accounts together:
1. Sign in to AntarKita (customer) with applereview@antarkita.id.
2. On a second device or after signing out, sign in to AntarKita Mitra (partner) with
   applereview.mitra@antarkita.id, open the Home tab and switch the toggle to "Online".
3. Back in the customer app, place an AntarRide order. The order appears in the partner app
   within 1-2 minutes and can be accepted, tracked, chatted about and completed end to end.
If you prefer, we can schedule a live walkthrough video call - please contact us at
erzamadana@gmail.com.

LOCATION
Location is used only while the app is in the foreground, for the pickup point, nearby partner
matching, and live order tracking. The app does NOT request or use background location; there is
no NSLocationAlwaysUsageDescription and no location background mode. The app remains fully
usable if location permission is denied - you can still sign in, browse services and type an
address manually.

PAYMENTS - NO IN-APP PURCHASE
All payments are for physical goods and real-world services consumed outside the app (rides,
food delivery, courier, market groceries, intercity travel). AntarPay is a closed-loop
stored-value balance that can only be spent on those real-world services inside AntarKita. It
cannot buy digital content, features or subscriptions, and cannot be transferred between users.
Per Guideline 3.1.3(e), these payments use methods other than in-app purchase. Payment
processing is handled by Midtrans (PT Midtrans), a payment gateway licensed by Bank Indonesia.
AntarKita is not a bank and does not issue electronic money; it does not store card data.

USER-GENERATED CONTENT (Guideline 1.2)
In-order 1:1 chat and voice calls, post-order reviews and merchant photos. There is no public
feed and no messaging between users who are not linked by an order.
- Report: the "..." button on the partner/customer card on the order screen, in the chat screen
  header, on long-press of a chat bubble, and on the merchant Reviews and Info tabs. Six
  categories plus a free-text field.
- Block: the "..." button in the same places. Managed under Account > Blocked users. Blocking is
  enforced server-side (order matching, chat and calls are refused at the database level).
- Moderation: reports enter an admin queue with a 48-hour review deadline; admins can mark
  reviewed, suspend the reported account, or reject. All actions are recorded in an audit log.
Contact for content concerns: erzamadana@gmail.com

ACCOUNT DELETION (Guideline 5.1.1(v))
In-app: Account > More > Delete account. It deletes the account and associated data, except
records we are legally required to retain, as explained in the privacy policy.

PRIVACY / TRACKING
No third-party advertising or analytics SDKs. The app does not access the IDFA and does not
present the App Tracking Transparency prompt because it performs no tracking as Apple defines
it. Voice calls are peer-to-peer WebRTC and are never recorded or stored.

PARTNER DOCUMENTS
The partner app collects driver documents (national ID, driving licence, vehicle registration)
because Indonesian transport regulation requires verified drivers. These are used for
verification and fraud prevention only, are never shown to other users, and are covered in the
privacy policy.
```

**Attachment:** lampirkan satu video layar pendek (≤2 menit) yang menunjukkan alur pesan →
terima → selesai memakai kedua akun demo. Ini pemotong waktu review terbesar untuk aplikasi
ride-hailing: tanpa itu, hampir selalu ada satu putaran "we were unable to locate the feature".

**Version Release:** *Manually release this version* untuk rilis pertama, supaya Anda bisa
memilih tanggal go-live setelah disetujui.

---

## 11. Pertanyaan yang biasa ditanyakan reviewer aplikasi ride-hailing

Siapkan jawabannya sekarang; menjawab cepat memangkas hari, bukan jam.

| Pertanyaan reviewer | Jawaban siap pakai |
|---|---|
| "We were unable to find any drivers / the map is empty." | Sertakan akun mitra demo + instruksi dua-perangkat di Notes (§10) dan video lampiran. Ini penyebab penolakan nomor satu. |
| "Does your app use background location?" | Tidak. Foreground saja; tidak ada `NSLocationAlways*` dan tidak ada `UIBackgroundModes` (bisa diperiksa di Info.plist biner). |
| "Why does your app need the microphone?" | Panggilan suara dalam aplikasi antara pelanggan dan mitra agar nomor HP tidak dibagikan. Tidak direkam. |
| "Why does the app collect government ID documents?" | Hanya di aplikasi **Mitra**, untuk verifikasi pengemudi sesuai regulasi transportasi Indonesia. Tidak diminta dari pelanggan. |
| "Your app appears to sell digital content / should use IAP." | Balas dengan kutipan 3.1.3(e) dan penjelasan closed-loop di §7. |
| "Is your app a financial institution? Do you have a licence?" | Bukan. AntarPay adalah saldo tertutup di dalam platform; pembayaran diproses PT Midtrans (berizin Bank Indonesia). AntarKita tidak menerbitkan uang elektronik, tidak memberi pinjaman, tidak menyimpan data kartu. |
| "How do users report or block other users?" | Jalur menu persis di §8.2 dan di `PLAY-STORE-LISTING.md` §4.11. |
| "Your app requires a phone number / Indonesian bank account to sign up." | Akun demo yang sudah jadi menghindari ini sepenuhnya — pastikan reviewer tidak perlu OTP nomor Indonesia. **Uji sendiri**: masuk dengan akun demo dari jaringan luar negeri (VPN) sebelum submit. |
| "Does the app work outside Indonesia?" | Availability disetel **Indonesia saja**, sehingga pertanyaan ini jarang muncul; tetapi akun demo tetap harus bisa masuk dari mana pun. |

---

## 12. Sumber + tanggal akses

Semua diverifikasi lewat dokumen resmi Apple, **diakses 9 September 2026**:

| Topik | Sumber |
|---|---|
| App Review Guidelines (1.2 UGC, 3.1.1, 3.1.3, 3.1.5, 4.7, 4.8, 5.1.1, 5.1.2) | https://developer.apple.com/app-store/review/guidelines/ |
| Account deletion (wajib in-app sejak 30 Juni 2022) | https://developer.apple.com/support/offering-account-deletion-in-your-app/ |
| Privacy manifest & tenggat 1 Mei 2024 | https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api |
| Berkas privacy manifest (struktur) | https://developer.apple.com/documentation/bundleresources/privacy-manifest-files |
| SDK pihak ketiga yang wajib manifest + tanda tangan | https://developer.apple.com/support/third-party-SDK-requirements/ |
| Definisi tracking & ATT | https://developer.apple.com/app-store/user-privacy-and-data-use/ |
| Kategori & tujuan App Privacy (nutrition label) | https://developer.apple.com/app-store/app-privacy-details/ |
| Ukuran screenshot & ikon | https://developer.apple.com/help/app-store-connect/reference/screenshot-specifications/ |
| Waktu review ("90% of submissions are reviewed in less than 24 hours") | https://developer.apple.com/distribute/app-review/ |
| Konfigurasi privacy manifest di Expo | https://docs.expo.dev/guides/apple-privacy/ |

Verifikasi yang dilakukan langsung di repositori (bukan dari dokumentasi):

- `npx expo prebuild --platform ios --no-install` untuk `APP=pelanggan` dan `APP=mitra` →
  `Info.plist`, `PrivacyInfo.xcprivacy`, `project.pbxproj`, dan `Podfile` diperiksa isinya.
- `node_modules/**/PrivacyInfo.xcprivacy` (14 berkas) untuk menentukan kategori required-reason
  API yang benar-benar dipakai dependensi.
- `src/hooks/useLocation.ts` → hanya izin lokasi foreground.
- `src/` disisir untuk `signInWithOAuth`/`signInWithIdToken` → tidak ada login pihak ketiga.
- `eas.json` divalidasi dengan `npx eas-cli config` (lolos validasi skema).
