# Riset Infrastruktur Peta & Biaya — AntarKita
### Basis operasi: Pekanbaru (Riau) & Padang (Sumatera Barat) · Target listing Google Play + App Store

| | |
|---|---|
| **Versi dokumen** | 1.0 |
| **Tanggal penyusunan / tanggal akses semua sumber daring** | **9 September 2026** |
| **Penyusun** | Agen Riset Infrastruktur Peta |
| **Basis kode yang diperiksa** | `/home/claude/antar-aja` cabang `main` (tidak diubah) |
| **Berkas pendamping** | `docs/riset/AntarKita-Biaya-Peta.xlsx` (model hidup, berformula) |
| **Kurs acuan** | Kurs Tengah Transaksi BI 9 Sep 2026: **USD 1 = Rp17.618,00**, EUR 1 = Rp20.459,79, CNY 1 = Rp2.625,30 `[S-30]` |
| **Pajak** | PPN PMSE **11% efektif** untuk penyedia luar negeri (tarif 12% × DPP nilai lain 11/12, PER-12/2025) `[S-31]` |

> **Aturan baca dokumen ini**
> 1. Angka dari pihak ketiga diberi penanda `[S-xx]` yang merujuk **Daftar Pustaka** di bagian akhir; setiap sumber mencantumkan URL dan tanggal akses.
> 2. Angka yang **bukan** kutipan diberi label **`[ASUMSI]`** beserta metode penurunannya. Angka `[ASUMSI]` tidak boleh dipakai sebagai klaim faktual ke investor atau regulator.
> 3. Temuan dari basis kode diberi penanda `[INT]` dengan jalur berkas dan nomor baris.
> 4. Bila harga tidak dapat diverifikasi dari sumber resmi, ditulis apa adanya sebagai `[ASUMSI]` — **tidak** disamarkan sebagai fakta.

---

## RINGKASAN EKSEKUTIF (baca ini bila hanya punya 3 menit)

1. **AMap / Gaode tidak bisa dipakai.** Bukan soal harga — harganya justru murah — melainkan karena Perjanjian Layanan Platform Terbuka AMap Pasal 14.1 menyatakan layanan **"pada prinsipnya hanya disediakan bagi pengembang di wilayah daratan RRT yang servernya berada di daratan RRT, dan hanya untuk pengguna akhir di daratan RRT"**, dan pemakaian di luar daratan Tiongkok tanpa izin tertulis **sepenuhnya menjadi risiko dan tanggung jawab pengembang** `[S-06]`. Ditambah sertifikasi pengembang menuntut **nomor KTP RRT** (perorangan) atau **izin usaha RRT** (badan usaha) `[S-06]`, hukum yang berlaku adalah hukum daratan Tiongkok dengan yurisdiksi pengadilan RRT `[S-06]`, dan pengiriman data lokasi pengguna Indonesia ke server di Tiongkok memicu kewajiban Pasal 56 UU 27/2022 yang belum punya peraturan pelaksana `[S-32]`. **Rekomendasi: coret AMap dari daftar.**

2. **Pemakaian server gratis hari ini melanggar syarat pakai — dan itu bloker peluncuran, bukan risiko teoretis.** Empat pelanggaran terverifikasi (rincian di §3), yang paling fatal: `TILE_URL` di-*hardcode* ke dalam aplikasi terkompilasi `[INT]`, padahal OSMF mewajibkan sebaliknya dan memblokir **tanpa pemberitahuan** `[S-01]`. Bila diblokir, peta mati di semua perangkat dan **tidak bisa diperbaiki dari server** — harus rilis ulang + tinjauan toko + adopsi pembaruan pengguna, berhari-hari sampai berminggu-minggu dengan peta abu-abu.

3. **Yang paling murah dan layak dipakai sekarang: Stadia Maps** — Rp1,56 juta/bulan pada 600 pesanan/hari (**Rp87/pesanan**), turun ke **Rp58/pesanan** pada 8.000 pesanan/hari. Bandingkan Google Maps Platform: **Rp924–1.094/pesanan**, yaitu **56–67% dari pendapatan platform per pesanan** (Rp1.640 `[INT]` catatan deck) — mustahil di bawah pagu komisi 8% Perpres 27/2026.

4. **Dengan strategi hemat (caching + debounce + tunda routing + kurangi gambar-ulang), biaya turun 33–68%** tanpa mengubah pengalaman pengguna. Pada 8.000 pesanan/hari, Stadia turun dari $717 → $250/bulan (**hemat Rp109,6 juta/tahun**).

---

# BAGIAN 1 — PEMETAAN PEMAKAIAN NYATA DI KODE

## 1.1 Inventaris layanan geo yang benar-benar dipanggil

Seluruh lalu lintas geo berasal dari **tiga berkas**:

| Layanan | Penyedia yang dipakai hari ini | Berkas & baris | Punya kunci API? |
|---|---|---|---|
| Ubin peta (tile) | `https://tile.openstreetmap.org/{z}/{x}/{y}.png` | `src/components/map/shared.ts:22` (konstanta `TILE_URL`), dipakai di `MapView.web.tsx:113` dan disuntik ke HTML WebView di `shared.ts:73–75` | **Tidak** |
| Autocomplete / pencarian tempat | `https://photon.komoot.io/api/` (utama) | `src/lib/geo.ts:53` | Tidak |
| Autocomplete cadangan | `https://nominatim.openstreetmap.org/search` | `src/lib/geo.ts:69` | Tidak |
| Reverse geocoding | `https://nominatim.openstreetmap.org/reverse` | `src/lib/geo.ts:89` | Tidak |
| Rute & jarak tempuh | `https://router.project-osrm.org/route/v1/driving/…` | `src/lib/geo.ts:105` | Tidak |
| (opsional, mati) Pencarian/geocode/rute Google | `maps.googleapis.com` Text Search, Geocoding, Directions | `src/lib/geo.ts:76, 85, 122` | Aktif hanya bila `EXPO_PUBLIC_GOOGLE_MAPS_KEY` diisi |
| Jarak garis lurus | **PostGIS `st_distance` / `st_dwithin` di Supabase — bukan penyedia luar** | `supabase/migrations/0001_schema.sql:4` (`create extension postgis`), `0002_functions_rls.sql:135,299,499`, `0007_phase4.sql:135–140`, `0019_…:337`, `0021_…:53`, `0050_…:362` | n/a — **gratis** |

**Temuan penting yang menguntungkan AntarKita:** jarak garis lurus, pencarian driver terdekat (`st_dwithin` radius km), pencarian merchant terdekat, dan validasi batas jarak **sudah dikerjakan PostGIS di dalam basis data**, bukan lewat API berbayar. Ini menghapus seluruh kategori "Distance Matrix" yang biasanya jadi pos biaya terbesar aplikasi ride-hailing. Yang tersisa untuk penyedia peta hanyalah: ubin, autocomplete, reverse geocode, dan satu panggilan rute per pesanan.

**Temuan kedua:** `orders.route_geometry` disimpan permanen di basis data (`0001_schema.sql:189`, ditulis di `0002_functions_rls.sql:208`, dibaca di `order/detail.tsx:129`, `driver/order.tsx:117`, `share.tsx:81`). Artinya **rute tidak pernah dihitung ulang saat pelacakan** — hanya sekali saat pemesanan. Ini sudah benar dan menekan biaya routing drastis.

**Temuan ketiga:** ada cache dalam-memori di `src/lib/geo.ts:8–22` — `Map` bertaraf modul, kunci = URL penuh, **tanpa kedaluwarsa dan tanpa batas ukuran**, hilang saat aplikasi ditutup. Berguna dalam satu sesi, tapi tidak lintas-sesi dan tidak lintas-pengguna. Peluang hemat terbesar ada di sini (§5).

## 1.2 Alur nyata satu pesanan (dilacak dari kode, bukan tebakan)

Contoh AntarRide (`src/screens/ride/index.tsx`); pola identik di `food/checkout.tsx`, `send/`, `box/`, `shop/`, `market/`, `travel/`.

| # | Kejadian di aplikasi | Kode | Panggilan yang dipicu |
|---|---|---|---|
| 1 | Layar layanan dibuka, GPS dapat *fix*, `pickup` masih kosong | `ride/index.tsx:55` | **1× reverse geocode** (Nominatim) |
| 2 | Pengguna menekan "Lokasi saya" | `ride/index.tsx:125` | 1× reverse geocode (opsional) |
| 3 | Pengguna membuka Pilih Lokasi, mengetik tujuan | `place-picker.tsx:44–53` — *debounce* **400 ms**, minimum **3 karakter** | **1 permintaan autocomplete per jeda ketik ≥400 ms** |
| 4 | Pengguna beralih ke mode peta dan menggeser peta | `place-picker.tsx:55–60`, dipicu tiap `moveend` (`shared.ts:115`) | **1× reverse geocode per gerakan peta** |
| 5 | `pickup` + `dropoff` lengkap → hitung ongkos | `ride/index.tsx:59–63` | **1× rute OSRM**, lalu 1× RPC `fare_options` (PostGIS, gratis) |
| 6 | Pengguna mengubah pickup/dropoff | `useEffect` deps `[pickup.lat, pickup.lng, dropoff.lat, dropoff.lng, service]` | rute dihitung ulang (di-cache per URL dalam sesi) |
| 7 | Pesanan dibuat; layar pelacakan terbuka | `order/detail.tsx:128` | 1 pemuatan peta; **0 panggilan rute** (memakai `route_geometry` tersimpan) |
| 8 | Posisi driver diperbarui | `useOrder.ts:59–62` polling **tiap 6 detik** + Realtime | `markers` & `fitTo` dihitung ulang → `map.fitBounds()` dipanggil ulang → **permintaan ubin baru saat zoom/area berubah** |
| 9 | Driver menyiarkan lokasi | `useDriver.ts:24–30`, dibatasi **maks. 1 kirim / 4 detik**; `useLocation.ts:45` `distanceInterval: 15 m` | RPC Supabase saja — **bukan** panggilan penyedia peta |
| 10 | Layar driver menampilkan peta + `fitTo` | `driver/order.tsx:117`, `useWatchLocation(true, …)` `driver/order.tsx:38` | 1 pemuatan peta + gambar ulang mengikuti pergerakan |

### Titik kritis: frekuensi gambar-ulang peta

`fitTo` di `order/detail.tsx:80–86` dan `driver/order.tsx:46` memakai `useMemo` dengan dependensi `driver.lat`/`driver.lng`. Karena `useOrder` mem-*poll* tabel `drivers` **tiap 6 detik** dan juga berlangganan Realtime `postgres_changes`, `fitTo` berubah **hingga ~10×/menit per layar pelacakan** — dan tiap perubahan memanggil `map.fitBounds(...)` di dalam WebView (`shared.ts:108–111`). Setiap `fitBounds` yang mengubah tingkat zoom memaksa Leaflet mengambil **satu set ubin baru**. Inilah sumber lalu lintas ubin terbesar aplikasi, dan yang paling mudah ditekan (§5.5).

## 1.3 Asumsi perilaku (semua `[ASUMSI]`, dasar penurunan ditulis)

| Kode | Asumsi | Nilai | Dasar |
|---|---|---|---|
| `[ASUMSI A1]` | Satu pesanan = satu sesi pelanggan: buka layar → pilih tujuan → lihat ongkos → pesan → lacak hingga selesai | — | Alur di `src/screens/*/index.tsx` |
| `[ASUMSI A2]` | Panjang query rata-rata 12 karakter; *debounce* 400 ms menghasilkan ~3 jeda ≥400 ms; +1 permintaan untuk perbaikan query | **4,0 autocomplete/pesanan** | Turunan dari `place-picker.tsx:47–51` |
| `[ASUMSI A3]` | 50% pesanan memakai mode peta di Pilih Lokasi; tiap kali menghasilkan 3 `moveend` | 1,5 reverse/pesanan (mode peta) + 1,0 (default pickup) = **2,5 reverse/pesanan** | `place-picker.tsx:55–60` |
| `[ASUMSI A4]` | 30% pesanan mengubah titik sekali setelah rute pertama dihitung | **1,3 rute/pesanan** | `ride/index.tsx:59` deps |
| `[ASUMSI A5]` | Instans peta per pesanan: pemilih-peta 0,5 + pratinjau rute 0,4 (tombol "Lihat peta rute" `BookingExtras.tsx:174`, tertutup secara bawaan) + pelacakan pelanggan 1,0 + layar driver 1,0 | **2,9 pemuatan peta/pesanan** | Hitung instans `<MapView>` di `place-picker.tsx:106`, `BookingExtras.tsx:15`, `order/detail.tsx:129`, `driver/order.tsx:117` |
| `[ASUMSI A6]` | Layar ponsel 390×844 px CSS, ubin 256 px, `keepBuffer` bawaan Leaflet → ~24 ubin per tampilan baru; faktor churn ×4 untuk dua layar pelacakan (driver bergerak, `fitBounds` berulang), ×1,5 untuk pemilih | 220 ubin kotor/pesanan; setelah cache HTTP peramban/WebView (`Cache-Control` OSM ≥7 hari `[S-01]`) tersisa **≈100 permintaan ubin jaringan/pesanan** | Turunan; `shared.ts:75` `maxZoom:19` |
| `[ASUMSI A7]` | Sesi menjelajah tanpa memesan menambah 35% beban ubin, autocomplete, dan reverse geocode | **faktor 1,35** | Rasio jelajah:pesan 1,35:1 |
| `[ASUMSI A8]` | Volume tiga tingkat. **Tidak ada angka pesanan/hari di `docs/organisasi/AntarKita-Model-Biaya-SDM.xlsx` maupun `docs/investor/CATATAN-SUMBER-DECK.md`** — keduanya sudah diperiksa; deck bahkan menyatakan SOM sengaja dikosongkan. Angka berikut **ditetapkan penyusun riset ini**. | A=600, B=2.400, C=8.000 pesanan/hari | Dipetakan ke Fase 0–1 / Fase 2 / skala 2 kota matang di `DESAIN-ORGANISASI.md` §3 |
| `[ASUMSI A9]` | Pengguna aktif bulanan (MAU): tiap pelanggan memesan 4×/bulan, ditambah 4× lipat penjelajah non-pemesan, ditambah driver aktif | A=18.000, B=73.000, C=244.000 MAU | Turunan dari A8 |
| `[ASUMSI A10]` | Distribusi jam sibuk: 15% volume harian terjadi dalam 1 jam puncak | dipakai untuk uji batas 1 req/dtk | Pola umum ride-hailing; tidak ditemukan sumber untuk Pekanbaru/Padang |

## 1.4 Hasil: panggilan per pesanan dan per pengguna aktif per hari

**Per satu pesanan (angka inti model):**

| Layanan | Panggilan/pesanan | Unit penagihan penyedia |
|---|---|---|
| Autocomplete / pencarian tempat | **4,0** | permintaan (Google/Geoapify/Stadia) atau **sesi** (Mapbox Search Box, MapTiler) |
| Reverse geocoding | **2,5** | permintaan |
| Rute (routing) | **1,3** | permintaan |
| Pemuatan peta (map load / sesi peta) | **2,9** | *map load* (Google Dynamic Maps), *map session* (MapTiler), termasuk MAU (Mapbox mobile) |
| Permintaan ubin ke jaringan | **≈100** | ubin (Stadia, HERE, Google Map Tiles API, Class-B op di R2) |

**Per pengguna aktif harian (DAU), memakai `[ASUMSI A7]` rasio jelajah 1,35:1:**

Pada Skenario A (600 pesanan/hari, ≈810 sesi aktif/hari): **0,74 pesanan/DAU**, sehingga per DAU: 3,0 autocomplete · 1,9 reverse geocode · 0,96 rute · 2,1 pemuatan peta · 74 permintaan ubin.

**Volume bulanan (30 hari), sudah termasuk faktor jelajah 1,35:**

| Unit | A (600/hari) | B (2.400/hari) | C (8.000/hari) |
|---|---:|---:|---:|
| Pesanan/bulan | 18.000 | 72.000 | 240.000 |
| Autocomplete | 97.200 | 388.800 | 1.296.000 |
| Reverse geocode | 60.750 | 243.000 | 810.000 |
| Rute | 23.400 | 93.600 | 312.000 |
| Pemuatan peta | 70.470 | 281.880 | 939.600 |
| Permintaan ubin | 2.430.000 | 9.720.000 | 32.400.000 |
| MAU `[ASUMSI A9]` | 18.000 | 73.000 | 244.000 |

---

# BAGIAN 2 — TEMUAN KEPATUHAN (BLOKER PELUNCURAN)

Seluruh kebijakan di bawah dibaca langsung dari sumber resminya pada 9 September 2026, bukan dari ingatan.

## 2.1 OSMF Tile Usage Policy — `tile.openstreetmap.org` `[S-01]`

**Apa yang diwajibkan** (kutipan langsung `[S-01]`):
- URL harus persis `https://tile.openstreetmap.org/{z}/{x}/{y}.png` — ✅ patuh (`shared.ts:22`).
- *"Send a clear, unique User-Agent string that names your app"* dengan informasi kontak — ❌ **tidak patuh** (lihat analisis di bawah).
- *"Show OpenStreetMap licence attribution clearly on the map"* — ✅ patuh (`shared.ts:23`, `TILE_ATTR`).
- *"Cache tiles locally according to HTTP caching headers (or at least 7 days)"* — ✅ patuh secara pasif (cache HTTP WebView/peramban).
- **"Avoid hard-coding the tile URL; allow switching without needing a software update"** — ❌ **tidak patuh, dan inilah bloker terbesar.**

**Apa yang dilarang** (kutipan `[S-01]`): *"Bulk downloading is any pre-emptive fetching of tiles other than those a user is actively viewing"* — ✅ AntarKita tidak melakukan prefetch.

**Sanksi** (kutipan `[S-01]`): *"Access may be blocked without prior notice"*; *"Repeated violations may lead to longer-term or network-level blocks"*.

**Tentang pemakaian komersial** — kebijakan tidak melarang komersial secara eksplisit, tetapi memberi peringatan khusus `[S-01]`:
> *"Commercial services, or those that seek donations, should be especially aware that access may be withdrawn at any point: you may no longer be able to serve your paying customers if access is withdrawn."*

dan di pembukaan: *"heavy or inappropriate use harms others' ability to edit and view the map. We may block access, without notice, if your usage degrades the service."*

### Analisis pelanggaran konkret AntarKita

**(a) User-Agent.** `src/lib/geo.ts:6` mendefinisikan `UA = 'AntarAja/1.0 (support@antaraja.id)'` dan menyetelnya sebagai header di `geo.ts:14`. **Header ini tidak pernah sampai ke server ubin.** Alasannya dua:
1. Permintaan ubin **tidak melewati `geo.ts` sama sekali** — ubin diambil oleh Leaflet di dalam WebView (`shared.ts:75`) dan oleh `react-leaflet` di web (`MapView.web.tsx:113`), yang memakai elemen `<img>`. Header kustom mustahil disetel di sana.
2. Pada bangunan web, `User-Agent` adalah *forbidden header name* — peramban membuang penyetelan itu secara diam-diam.

Akibatnya lalu lintas ubin AntarKita tiba di OSM dengan **User-Agent bawaan Chrome/Safari mobile** dan `Referer: https://antaraja.local/` (`MapView.tsx:41`, `baseUrl`), yaitu domain yang tidak dapat di-resolve. Kebijakan `[S-01]` menyatakan lalu lintas dengan identifikasi bawaan *"will be blocked"*.

**(b) URL ter-*hardcode*.** `TILE_URL` adalah konstanta yang (i) di-*bundle* ke dalam APK/IPA dan (ii) ditanam sebagai string literal ke dalam HTML WebView di `shared.ts:73` (`var TILE='${TILE_URL}'`). Tidak ada mekanisme *remote config*. **Bila OSM memblokir, tidak ada satu pun tombol di server yang bisa memperbaikinya.** Pemulihan menuntut: bangun ulang → EAS build → unggah → tinjauan App Store & Play Store → menunggu pengguna memperbarui. Realistis **3–21 hari peta mati total di kedua aplikasi (pelanggan dan mitra)**, di tengah operasi komersial.

**(c) Beban.** Skenario A menghasilkan 2.430.000 permintaan ubin/bulan = 81.000/hari ≈ **3,4 permintaan ubin/detik pada jam sibuk** `[ASUMSI A10]`. Skenario C: **45 permintaan ubin/detik**. Itu beban nyata pada infrastruktur donasi.

**Simpulan 2.1: MELANGGAR.** Dua persyaratan teknis wajib (identifikasi & URL tidak ter-*hardcode*) dilanggar sejak sekarang, pada volume berapa pun.

## 2.2 Nominatim Usage Policy `[S-02]`

Kutipan langsung `[S-02]`:
- *"No heavy uses (an absolute **maximum of 1 request per second**)."*
- *"Provide a valid HTTP Referer or User-Agent identifying the application (stock User-Agents as set by http libraries will not do)."*
- Daftar terlarang, diawali kalimat *"The following uses are strictly forbidden and will get you **banned**"*:
  - **"Auto-complete search — This is not yet supported by Nominatim and you must not implement such a service"**
  - *"Systematic queries"* (termasuk reverse queries dalam grid)
  - *"Reselling of geocoding results"*

### Analisis pelanggaran konkret

**(a) Autocomplete — pelanggaran mutlak.** `src/lib/geo.ts:47` memanggil `nominatimSearch()` sebagai *fallback* dari `photonSearch()`, dan `nominatimSearch` (`geo.ts:67–72`) memukul `nominatim.openstreetmap.org/search`. Fungsi ini dipanggil dari `place-picker.tsx:49` di dalam `setTimeout` *debounce* — **secara definisi adalah layanan autocomplete**, tepat yang dilarang. Karena Photon sendiri berhak melempar (`geo.ts:63` `throw new Error('empty')` saat hasil kosong), jalur terlarang ini **aktif dalam pemakaian normal**, bukan hanya saat Photon mati.

**(b) User-Agent.** Sama seperti §2.1(a): pada bangunan web header dibuang peramban. Pada native (React Native `fetch`) header memang terkirim, jadi bangunan Android/iOS lebih baik — tetapi bangunan web (`dist/`, `apps/`) tidak.

**(c) Batas 1 permintaan/detik.** Reverse geocode pada jam sibuk:

| Skenario | Reverse/bulan | Reverse/hari | Puncak (15%/jam) | req/detik |
|---|---:|---:|---:|---:|
| A (600/hari) | 60.750 | 2.025 | 304/jam | **0,08** |
| B (2.400/hari) | 243.000 | 8.100 | 1.215/jam | **0,34** |
| C (8.000/hari) | 810.000 | 27.000 | 4.050/jam | **1,13 — MELEWATI BATAS** |

**Titik silang batas 1 req/detik: ≈7.100 pesanan/hari** (turunan: 1 req/dtk × 3.600 dtk = 3.600/jam puncak ÷ 0,15 = 24.000/hari ÷ (2,5 × 1,35) = 7.111 pesanan/hari). Bila Photon sedang di-*throttle*, seluruh autocomplete jatuh ke Nominatim dan ambang ini tercapai jauh lebih awal: **≈2.700 pesanan/hari**.

**Simpulan 2.2: MELANGGAR SEKARANG JUGA** — bukan karena laju, melainkan karena pola autocomplete yang dilarang secara eksplisit dan berkonsekuensi *ban*.

## 2.3 Server demo OSRM — `router.project-osrm.org` `[S-03]`

Dokumentasi API OSRM resmi **tidak memuat kebijakan pemakaian** untuk server demo (diperiksa; hanya contoh permintaan). Pernyataan resmi datang dari pengelola (Sarah Hoffmann/lonvia) di forum komunitas OpenStreetMap `[S-03]`:
- kebijakan pemakaian layanan demo **"does forbid heavy usage"**;
- layanan itu **"only a demo service meant to showcase the capabilities of the router"**, bukan untuk produksi;
- pemakaian berupa panggilan tiap 3–5 detik dari aplikasi ponsel disebut **"very heavy usage"**;
- solusinya: *"You can run your own OSRM server"* atau memakai *"various commercial providers"*.

**Simpulan 2.3: MELANGGAR SEMANGAT DAN HURUF KEBIJAKAN.** AntarKita adalah aplikasi komersial berbayar yang memakai layanan demo sebagai tulang punggung penetapan tarif. Tidak ada ambang numerik yang dipublikasikan, sehingga pemblokiran bersifat diskresioner dan dapat terjadi kapan saja. Untungnya volume rute AntarKita rendah (1,3/pesanan, karena `route_geometry` disimpan) — 23.400/bulan pada Skenario A. Risiko utamanya bukan volume melainkan **status komersial + ketiadaan SLA**: bila OSRM tumbang, `getRoute` jatuh ke *fallback* haversine × 1,3 (`geo.ts:116`), sehingga **tarif yang ditagih ke pelanggan meleset** tanpa peringatan.

## 2.4 Photon Komoot — `photon.komoot.io` `[S-04]` `[S-05]`

Kutipan README resmi `[S-04]`:
> *"You are welcome to use the API for your project as long as the number of requests stay in a reasonable limit. **Extensive usage will be throttled or completely banned.**"*
> *"If you have a larger number of requests to make, please consider setting up your own private instance."*
> *"We do not give guarantees for availability and reserve the right to implement changes without notice."*

Jawaban pengelola atas pertanyaan pemakaian bisnis `[S-05]`:
> *"The site at https://photon.komoot.io is a demo site for the Photon software. We don't give any uptime guarantees"*
> *"There is no hard definition on 'extensive usage'. We throttle usage as required to protect the availability of the service for all."*
> *"**if you have to ask about the usage limits, you are likely better off running your own instance.**"*
> *"Neither Komoot nor the maintainers of Photon provide a commercial API for Photon"*

**Simpulan 2.4: TIDAK DIIZINKAN UNTUK PEMAKAIAN BISNIS.** 97.200 permintaan/bulan (Skenario A) hingga 1.296.000/bulan (Skenario C) dari satu aplikasi komersial jelas masuk kategori *extensive usage*.

## 2.5 SIMPULAN KEPATUHAN — JAWABAN TEGAS

> **Ya. AntarKita hari ini melanggar syarat pakai empat layanan sekaligus:**
>
> | Layanan | Status | Pelanggaran spesifik | Sanksi menurut kebijakan |
> |---|---|---|---|
> | `tile.openstreetmap.org` | **Melanggar** | User-Agent bawaan peramban; URL ter-*hardcode* tanpa jalur ganti | Blokir **tanpa pemberitahuan** `[S-01]` |
> | `nominatim.openstreetmap.org` | **Melanggar** | Dipakai sebagai autocomplete (dilarang eksplisit); UA bawaan di bangunan web | **Ban** `[S-02]` |
> | `router.project-osrm.org` | **Melanggar** | Pemakaian produksi komersial pada layanan demo | Diskresioner, tanpa pemberitahuan `[S-03]` |
> | `photon.komoot.io` | **Melanggar** | *Extensive usage* komersial pada situs demo | *Throttle* lalu **ban** `[S-04]`, `[S-05]` |
>
> **Kapan akan diblokir?** Tidak ada satu pun dari keempat penyedia yang menerbitkan ambang numerik yang mengikat; ketiganya menyatakan pemblokiran bersifat diskresioner dan tanpa pemberitahuan. Yang bisa dinyatakan pasti:
> - **Hari-1 komersial:** ubin OSM dan autocomplete Nominatim sudah dalam kondisi dapat diblokir sah kapan saja, terlepas dari volume.
> - **≈2.700 pesanan/hari:** batas keras 1 req/detik Nominatim terlampaui bila Photon di-*throttle* lebih dulu (skenario paling mungkin, karena Photon yang pertama kena).
> - **≈7.100 pesanan/hari:** batas keras 1 req/detik Nominatim terlampaui oleh reverse geocode saja.
> - **Konsekuensi terburuk sudah pasti bentuknya:** karena `TILE_URL` ter-*hardcode*, blokir ubin = peta abu-abu di seluruh perangkat pelanggan **dan** mitra, tidak dapat dipulihkan tanpa rilis toko baru.
>
> **Rekomendasi tanpa syarat: pindah dari keempat layanan ini sebelum listing. Ini bukan optimasi biaya — ini prasyarat kelayakan operasional dan kelayakan uji tuntas investor.**

---

# BAGIAN 3 — PERBANDINGAN PENYEDIA

## 3.1 AMap / Gaode (高德开放平台) — pertanyaan khusus pemilik

Bagian ini menjawab lima pertanyaan pemilik satu per satu, dengan bukti.

### (a) Apakah AMap punya data peta di luar Tiongkok daratan, khususnya Indonesia?

**Ya, ada — sejak 2025 — tetapi tidak dapat dipastikan mutunya untuk Pekanbaru dan Padang.**

AMap meluncurkan **世界地图 (Peta Dunia)** di platform terbukanya `[S-09]`. Menurut liputan Securities Times (证券时报) 11 Agustus 2025 `[S-10]`, layanan itu mencakup **"lebih dari 200 negara dan wilayah"**, mendukung 56 bahasa, dan memuat **1,2 juta titik POI luar negeri**. Pengumuman resmi `[S-09]` merinci isinya: *"世界地图服务内容包括：地图服务、定位服务、搜索服务、路线服务"* (layanan peta, penentuan posisi, pencarian, dan rute).

**Namun:**
- **Indonesia tidak disebut secara eksplisit** di pengumuman resmi `[S-09]`, halaman solusi luar negeri `[S-08]`, maupun liputan `[S-10]`. Tidak ada daftar negara yang dipublikasikan.
- **1,2 juta POI untuk 200+ negara** adalah angka yang sangat kecil untuk ride-hailing. Sebagai pembanding kasar, ekstrak OSM Indonesia saja berukuran 1,6 GB `[S-20]`. Kepadatan POI sebesar itu tidak memadai untuk *pickup point* tingkat gang di Pekanbaru dan Padang.
- Positioning produknya eksplisit: *"针对中国企业出海需求"* — "untuk kebutuhan perusahaan Tiongkok yang berekspansi ke luar negeri" `[S-10]`. Ini bukan produk untuk operator lokal Indonesia.
- **Tidak ditemukan sumber yang dapat dikutip** mengenai kelengkapan jaringan jalan atau POI AMap di Riau/Sumatera Barat. Ditulis apa adanya: **tidak dapat diverifikasi**.

### (b) Apakah pendaftaran developer-nya menuntut badan usaha Tiongkok / nomor telepon Tiongkok?

**Ya.** Perjanjian Layanan Platform Terbuka AMap `[S-06]`:
- Sertifikasi pengembang perorangan mengumpulkan **nama dan nomor KTP RRT**: *"在您进行个人开发者认证或年审时，我们会根据您的授权收集和使用您的实名认证相关信息（包含姓名、身份证号）"* (Pasal 8.4).
- Pengembang badan usaha diwajibkan mendaftar dengan **nomor telepon perusahaan**: *"请您务必使用企业公用手机号进行注册"* (Pasal 4.8.2) — dalam praktik nomor seluler daratan RRT.
- Perjanjian lisensi layanan teknis `[S-07]` Pasal 3 mensyaratkan **开发者认证 (sertifikasi pengembang)** sebelum pembelian, dengan penyerahan materi sertifikasi sesuai persyaratan platform.
- Pasal 4.10.6 `[S-06]` menuntut kepatuhan pada **《中华人民共和国测绘法》 (UU Survei & Pemetaan RRT)** dan pencantuman **审图号** (nomor persetujuan peta) — rezim perizinan yang hanya berlaku dan hanya dapat dipenuhi entitas RRT.
- Pasal 14.2 `[S-06]` bahkan **melarang** pemohon yang memiliki kualifikasi survei peta navigasi/peta internet untuk memakai layanan ini.

Kewajiban **ICP备案** tidak disebut di dalam perjanjian yang diperiksa; namun karena Pasal 14.1 mensyaratkan server pengembang berada di daratan RRT, ICP备案 menjadi konsekuensi praktis dari hosting di RRT. Ditandai `[ASUMSI]` karena tidak tertulis eksplisit di perjanjian.

### (c) Berapa kuota gratis dan harga berbayarnya?

Dari halaman定价 resmi `[S-08]` (diakses 9 Sep 2026) — **berlaku untuk layanan domestik RRT; harga Peta Dunia tidak dipublikasikan**:

| Kategori kuota | Pengembang perorangan | Badan usaha (1 tahun gratis setelah sertifikasi) | Badan usaha + lisensi layanan teknis |
|---|---:|---:|---:|
| LBS Dasar (基础LBS服务) | 150.000/bulan | 3.000.000/bulan | 9.000.000/bulan |
| Pencarian Dasar (基础搜索服务) | 5.000/bulan | 50.000/bulan | 500.000/bulan |
| Peta & Posisi Dasar (基础地图定位服务) | 1.500.000/bulan | 30.000.000/bulan | 90.000.000/bulan |

Harga berbayar `[S-08]`: **¥30 per 10.000 panggilan** untuk LBS Dasar & Pencarian Dasar (= ¥0,003/panggilan = **Rp7,88/panggilan** pada kurs BI 9 Sep 2026 `[S-30]`), dan **¥3 per 10.000** untuk layanan peta/posisi (= **Rp0,79/panggilan**). Diskon volume 20% (0–300 ribu/bulan) dan 40% (300 ribu–1 juta/bulan); di atas 1 juta hubungi penjualan. Peningkatan QPS ¥400–1.500/bulan per 10 QPS.

**Biaya hipotetis AntarKita bila AMap boleh dipakai** (Skenario A): (97.200 autocomplete + 60.750 reverse + 23.400 rute) × Rp7,88 = **Rp1.429.038**; ditambah 2.430.000 ubin × Rp0,79 = **Rp1.919.700**. Total **≈ Rp3,35 juta/bulan** atau **Rp186/pesanan**. Secara harga, AMap memang murah — kira-kira sebanding dengan swasembada dan lebih mahal dari Stadia. **Tetapi angka ini akademis** karena alasan (d) dan (e).

Halaman定价 **tidak menyebut** apakah pembelian menuntut izin usaha RRT atau metode pembayaran RRT; ditandai `[ASUMSI]` bahwa pembayaran dilakukan lewat Alipay/transfer domestik RRT, konsisten dengan struktur akun 实名认证.

### (d) Apakah SDK-nya bisa dipakai di aplikasi yang didistribusikan lewat Google Play & App Store di luar Tiongkok?

**Tidak, tanpa izin tertulis dari AMap.** Ini jawaban paling tegas dalam riset ini. Perjanjian Layanan Platform Terbuka AMap Pasal 14.1 `[S-06]`:

> **原文:** 本服务原则上仅面向中华人民共和国大陆地区且服务器在中国大陆地区的开发者提供，且仅面向中华人民共和国大陆地区的最终用户。
>
> **Terjemahan:** *"Layanan ini pada prinsipnya hanya disediakan bagi pengembang yang berada di wilayah daratan Republik Rakyat Tiongkok dan yang servernya berada di wilayah daratan RRT, serta hanya ditujukan bagi pengguna akhir di wilayah daratan RRT."*

> **原文:** 如果您或您的服务器位于中华人民共和国大陆地区之外…请您以书面方式通知我们。
>
> **Terjemahan:** *"Apabila Anda atau server Anda berada di luar wilayah daratan RRT… harap memberitahukan kami secara tertulis."*

> **原文:** 未经我们事先书面许可，您擅自在中国大陆地区之外使用本服务的，由您自行承担全部风险、后果和责任。
>
> **Terjemahan:** *"Tanpa izin tertulis kami sebelumnya, apabila Anda menggunakan layanan ini di luar wilayah daratan RRT atas kehendak sendiri, Anda menanggung seluruh risiko, akibat, dan tanggung jawabnya sendiri."*

AntarKita adalah: pengembang Indonesia, server di Indonesia/Supabase, pengguna akhir di Pekanbaru dan Padang. **Ketiga syarat Pasal 14.1 tidak terpenuhi.** Distribusi lewat Google Play dan App Store ke pengguna Indonesia berada tepat di dalam larangan tersebut.

Tambahan: hukum yang berlaku adalah **hukum daratan Tiongkok** dengan pengesampingan aturan konflik hukum (Pasal 13.1: *"均适用中国大陆法律，且不考虑任何冲突法"*), dan sengketa diselesaikan di **pengadilan rakyat RRT** (Pasal 13.2) `[S-06]`. Bagi PT Indonesia yang akan menghadapi uji tuntas investor dan pengawasan Komdigi, klausul ini sendiri adalah temuan merah.

Catatan teknis tambahan (`[ASUMSI]`, tidak diuji): SDK AMap memanggil titik akhir di daratan RRT (`restapi.amap.com` dsb.). Latensi dari Pekanbaru/Padang ke daratan RRT dan risiko pemfilteran lintas-batas belum diukur, tetapi berpotensi merusak pengalaman pemilihan lokasi yang menuntut respons di bawah 300 ms. Selain itu peta RRT memakai sistem koordinat **GCJ-02**, sementara seluruh basis data AntarKita memakai **WGS-84/EPSG:4326** (`supabase/migrations/0001_schema.sql:88,108,184` — `geography(point, 4326)`); mencampur keduanya menimbulkan pergeseran ratusan meter kecuali dikonversi konsisten.

### (e) Implikasi hukum data pribadi Indonesia (UU PDP 27/2022)

**Ini bagian yang harus dibahas jujur, dan jawabannya negatif.**

Data yang akan dikirim ke server AMap bila SDK dipakai: koordinat GPS presisi tinggi pelanggan dan mitra, titik jemput dan tujuan (yang mengungkap rumah dan tempat kerja), riwayat perjalanan, dan pengenal perangkat. Dalam UU 27/2022 ini adalah **data pribadi**; kombinasi lokasi rumah + pola perjalanan adalah profil perilaku yang sensitif secara praktis.

**Pasal 56 UU 27/2022** mengatur transfer data pribadi ke luar wilayah hukum Indonesia dengan tiga syarat berjenjang `[S-32]`:
1. **Ayat (2)** — negara penerima harus memiliki *"tingkat pelindungan data pribadi setidaknya setara atau lebih tinggi"* daripada UU PDP; **atau bila tidak terpenuhi,**
2. **Ayat (3)** — pengendali harus memastikan adanya *"pelindungan data pribadi yang memadai dan bersifat mengikat"*; **atau bila tidak terpenuhi,**
3. **Ayat (4)** — harus ada **persetujuan eksplisit subjek data pribadi**.

Persoalan nyata untuk AntarKita:
- **Tidak ada penetapan kesetaraan (adequacy) Indonesia atas RRT.** Peraturan pelaksana UU PDP — yang seharusnya mengatur mekanisme penilaian ini — **hingga 4 November 2025 belum disahkan** `[S-32]`. Artinya jalur (1) tidak bisa ditempuh secara sah; tidak ada dasar formal untuk menyatakan RRT setara.
- **Jalur (2) sangat sulit dipenuhi.** "Pelindungan yang memadai dan bersifat mengikat" biasanya berbentuk klausul kontraktual yang mengikat penerima. Perjanjian AMap `[S-06]` justru bergerak ke arah sebaliknya: hukum RRT yang berlaku, pengadilan RRT yang berwenang, dan kewajiban pengembang tunduk pada UU Survei & Pemetaan RRT. AntarKita tidak berada dalam posisi tawar untuk menegosiasikan klausul transfer data yang mengikat AMap.
- **Jalur (3) memindahkan risiko ke pengguna dan merusak produk.** Meminta persetujuan eksplisit setiap pelanggan untuk "mengirim lokasi Anda ke server di Tiongkok" adalah gesekan onboarding yang berat, harus dapat ditarik kembali kapan saja, dan bila ditarik aplikasi kehilangan fungsi peta bagi pengguna itu. Secara operasional tidak dapat dijalankan.
- **Beririsan dengan kewajiban PSE.** Deck AntarKita sudah mencatat kewajiban pendaftaran PSE Lingkup Privat ke Komdigi sebelum sistem dipakai pengguna, dengan sanksi pemutusan akses (`docs/investor/CATATAN-SUMBER-DECK.md`, sumber [S-34]/[S-35] di dokumen tersebut). Menambahkan aliran data lokasi lintas batas ke yurisdiksi tanpa penetapan kesetaraan memperbesar permukaan pemeriksaan pada saat pendaftaran dan audit.
- **Sanksi.** UU PDP mengenal sanksi administratif (Pasal 57) dan ketentuan pidana (Pasal 65–67) `[S-32]`. Besaran denda administratif spesifik **tidak dapat diverifikasi dari sumber resmi yang diakses**; ditulis apa adanya alih-alih dikutip dari ingatan.

### KESIMPULAN — "Mengapa AMap tidak bisa dipakai"

**AMap tidak bisa dipakai AntarKita. Tiga alasan, semuanya berdasar dokumen resmi, dan alasan pertama saja sudah cukup untuk menutup pembahasan:**

1. **Terlarang menurut perjanjiannya sendiri.** Pasal 14.1 `[S-06]` membatasi layanan pada pengembang daratan RRT, server daratan RRT, dan pengguna akhir daratan RRT. Pemakaian di luar itu tanpa izin tertulis menjadi risiko penuh pengembang. AntarKita gagal ketiga syaratnya.
2. **Tidak bisa mendaftar.** Sertifikasi pengembang menuntut nomor KTP RRT (perorangan) atau identitas badan usaha RRT dengan nomor telepon perusahaan RRT `[S-06]`, ditambah kepatuhan pada UU Survei & Pemetaan RRT dan 审图号 `[S-06]` yang hanya dapat dipenuhi entitas RRT.
3. **Bertabrakan dengan UU PDP 27/2022.** Transfer data lokasi pengguna Indonesia ke RRT tidak punya jalur kesetaraan (belum ada peraturan pelaksana `[S-32]`), tidak punya jalur pelindungan mengikat (perjanjian AMap tunduk hukum & pengadilan RRT), dan jalur persetujuan eksplisit tidak dapat dijalankan secara operasional.

**Sebagai tambahan yang jujur:** seandainya ketiga hambatan itu hilang, data Peta Dunia AMap pun **belum terbukti memadai untuk Pekanbaru dan Padang** — 1,2 juta POI untuk 200+ negara `[S-10]`, tanpa Indonesia disebut di dokumen resmi mana pun, dan tanpa harga Peta Dunia yang dipublikasikan `[S-08]` `[S-09]`. Harganya murah (≈Rp186/pesanan), tetapi itu satu-satunya nilai plusnya, dan tidak dapat diakses.

## 3.2 Google Maps Platform

Harga dari daftar harga resmi `[S-11]`, struktur tingkat dari `[S-12]`. **Kredit bulanan US$200 telah dihapus sejak 1 Maret 2025** dan diganti dengan **panggilan gratis per SKU per bulan** `[S-12]`: Essentials 10.000/SKU, Pro 5.000/SKU, Enterprise 1.000/SKU. Pelanggan baru mendapat kredit percobaan US$300 `[S-12]`.

| SKU | Tingkat | Gratis/bulan | 0–100k | 100k–500k | 500k–1jt | 1jt–5jt | >5jt |
|---|---|---:|---:|---:|---:|---:|---:|
| **Dynamic Maps** (per *map load*) | Essentials | 10.000 | $7,00 | $5,60 | $4,20 | $2,10 | $0,53 |
| **Map Tiles API — 2D** (per ubin) | Essentials | 100.000 | $0,60 (0–1jt) | $0,48 (1–5jt) | $0,36 (5–10jt) | $0,18 (10–50jt) | $0,045 |
| **Places Autocomplete Requests** | Essentials | 10.000 | $2,83 | $2,27 | $1,70 | $0,85 | $0,21 |
| **Places Autocomplete Session Usage** | Essentials | tak terbatas | **$0** | — | — | — | — |
| **Places Text Search** | **Pro** | 5.000 | $32,00 | $25,60 | — | — | $2,40 |
| **Place Details (Essentials)** | Essentials | 10.000 | $5,00 | $4,00 | — | — | $0,38 |
| **Geocoding** (termasuk reverse) | Essentials | 10.000 | $5,00 | $4,00 | $3,00 | $1,50 | $0,38 |
| **Routes: Compute Routes** (Essentials) | Essentials | 10.000 | $5,00 | $4,00 | $3,00 | $1,50 | $0,38 |
| **Routes: Compute Routes** (Pro) | Pro | 5.000 | $10,00 | $8,00 | — | — | $0,75 |
| **Directions API** (warisan) | Essentials | 10.000 | $5,00 | $4,00 | $4,00 | — | — |
| **Route Matrix (Essentials)** | Essentials | 10.000 | $5,00 | $4,00 | $3,00 | $1,50 | $0,38 |

**Apakah skema Essentials/Pro/Enterprise mengubah hitungan? Ya, dan tidak menguntungkan AntarKita.** Penghapusan kredit US$200 berarti tagihan mulai berjalan jauh lebih awal. Namun ada satu perbaikan penting: **Autocomplete Session Usage bernilai $0** — bila permintaan autocomplete dibungkus *session token* dan ditutup dengan panggilan Place Details/Text Search yang tertagih, biaya per-permintaan hilang. Model biaya di bawah memakai skenario konservatif (per permintaan, $2,83) dan menghitung dampak sesi di §5.2.

**Kode saat ini `[INT]`:** `geo.ts:76` memakai **Places Text Search** (Pro, **$32/1.000**), bukan Autocomplete. Bila kunci Google diaktifkan apa adanya, biaya pencarian akan **11× lebih mahal** daripada memakai Autocomplete. Ini bug biaya yang harus diperbaiki tim aplikasi sebelum kunci Google pernah diaktifkan.

**Cakupan Pekanbaru & Padang:** Google adalah tolok ukur de facto untuk POI dan nama tempat di kota tier-2 Indonesia. **Tidak ditemukan sumber pihak ketiga yang dapat dikutip** yang mengukur kelengkapan Google di Riau/Sumbar secara kuantitatif; pernyataan "Google paling lengkap" ditandai `[ASUMSI]` berbasis penalaran umum, dan harus diuji lapangan (§6.3).

## 3.3 Mapbox

Harga resmi `[S-13]`:

| Produk | Gratis/bulan | Harga per 1.000 |
|---|---:|---|
| **Maps SDK for Mobile** (per **MAU**) | 25.000 MAU | 25k–125k: $4,00 · 125k–250k: $3,20 · 250k+: $2,40 |
| Map Loads for Web (GL JS) | 50.000 | 50k–100k $5,00 · 100k–200k $4,00 · 200k–1jt $3,00 · 1jt–5jt $2,50 |
| Vector Tiles API | 200.000 | $0,25 · $0,20 · $0,15 |
| Raster Tiles API | 750.000 | $0,25 · $0,20 · $0,15 |
| Static Tiles API | 200.000 | $0,50 · $0,40 · $0,30 |
| **Search Box API** (per **sesi**) | 500 sesi | 501–100k $3,00 · 100k–500k $2,75 · 500k+ $2,50 |
| Geocoding (temporary) | 100.000 | 100k–500k $0,75 · 500k–1jt $0,60 · 1jt+ $0,45 |
| Geocoding (permanent) | — | $5,00 · $4,00 |
| **Directions API** | 100.000 | 100k–500k $2,00 · 500k–1jt $1,60 · 1jt+ $1,20 |
| Matrix API | 100.000 elemen | $2,00 · $1,60 · $1,20 |
| Navigation SDK (metered trips) | 1.000 trip | 1k–50k $0,08 · 50k–100k $0,064 · 100k+ $0,048 |

**Keunggulan struktural untuk AntarKita:** Maps SDK for Mobile ditagih **per MAU, bukan per pemuatan peta atau per ubin**. Artinya seluruh perilaku gambar-ulang boros di §1.2 langkah 8 **tidak menambah biaya sama sekali** pada Mapbox. Ini membuat Mapbox jauh lebih toleran terhadap arsitektur aplikasi saat ini daripada Google.

**Kelemahan:** Geocoding "temporary" tidak boleh disimpan permanen — strategi caching di §5.1 harus memakai tingkat "permanent" ($5/1.000) atau penyedia lain untuk hasil yang di-cache. Ini memangkas sebagian keunggulan biaya. Ditandai sebagai risiko lisensi yang harus dibaca tim hukum.

**Cakupan:** basis peta Mapbox adalah OpenStreetMap ditambah data mitra. Untuk Indonesia di luar Jawa, kualitasnya **secara efektif = kualitas OSM** (lihat §3.8).

## 3.4 MapTiler

Harga resmi `[S-14]`:

| Paket | Harga/bulan | Sesi peta | Permintaan API | Sesi pencarian | Komersial? |
|---|---:|---:|---:|---:|---|
| Free | $0 | 5.000 | 100.000 | 1.000 | **Tidak** — *"Suitable for testing, personal or non-commercial use"* |
| **Flex** | **$30** | 25.000 | 500.000 | 3.000 | Ya |
| Custom | kontrak prabayar | kustom | kustom | kustom | Ya, + SLA 99,9% |

Kelebihan pemakaian (hanya paket Flex) `[S-14]`: Sesi peta **$2,50/1.000**, Permintaan API **$0,15/1.000**, Sesi pencarian **$2,50/1.000**.

**Batasan penting: MapTiler tidak menyediakan routing.** Rute harus diambil dari penyedia lain (OSRM swasembada, Mapbox Directions, atau Geoapify). Ini menjadikan MapTiler solusi separuh, bukan penuh — dan menambah satu vendor lagi ke bauran.

## 3.5 HERE

Halaman harga resmi HERE dirender oleh JavaScript sehingga isinya tidak dapat diekstraksi; angka berikut berasal dari ringkasan pihak ketiga bertanggal Agustus 2026 `[S-15]` dan **harus dikonfirmasi ulang ke HERE sebelum dipakai sebagai dasar kontrak.**

| Item | Nilai | Status |
|---|---|---|
| Gratis Geocoding & Search | 30.000 transaksi/bulan | `[S-15]` |
| Gratis Routing | 5.000 transaksi/bulan | `[S-15]` |
| Gratis Matrix Routing | 2.500 transaksi/bulan | `[S-15]` |
| Geocoding berbayar | **$0,88/1.000** (≤5 juta); $0,70 (5–10 juta) | `[S-15]` |
| Maps (vector, volume tinggi) | **$0,088/1.000** | `[S-15]` |
| Routing berbayar | bertingkat volume, **tarif tidak dipublikasikan** | `[S-15]` |

**`[ASUMSI]`** Model biaya memakai **$0,50/1.000** untuk routing HERE karena tarif resminya tidak dapat diverifikasi. Angka ini konstruksi penyusun, bukan kutipan.

**Keunggulan HERE:** ubin sangat murah ($0,088/1.000 — 7× lebih murah dari Google Map Tiles), dan HERE punya data peta milik sendiri (bukan turunan OSM), sehingga memberi *hedge* independen bila OSM lemah di Riau/Sumbar.

## 3.6 Alternatif murah: Geoapify, LocationIQ, Stadia Maps, Radar

**Geoapify** `[S-16]` — model kredit; 1 permintaan = 1 kredit untuk Geocoding/Places/Routing. Permintaan ubin disebut *"significantly lighter"* namun **bobot kreditnya tidak dipublikasikan** (`[ASUMSI]` model ini menghitung 1 ubin = 1 kredit, konservatif).

| Paket | Kredit/hari | Harga/bulan |
|---|---:|---:|
| Free | 3.000 (≈90.000/bulan) | $0 — **komersial diizinkan** dengan atribusi `[S-16]` |
| API 10 | 10.000 | $59 |
| API 25 | 25.000 | $109 |
| API 50 | 50.000 | $179 |
| API 100 | 100.000 | $299 |
| API 250 | 250.000 | $609 |
| Custom | tak berbatas | mulai $860 |

**LocationIQ** `[S-17]` — Free 5.000 permintaan/hari, 2 req/dtk, wajib atribusi *"Search by LocationIQ.com"*. Berbayar: Maps Lite $45 (10k/hari, peta saja) · **Developer $100** (25k/hari, semua API) · **Startup $200** (60k/hari, *"unlimited map API requests"*) · Growth Plus $500 (7,5 juta/bulan) · Business Plus $950 (30 juta/bulan). Klaim "unlimited map API requests" pada paket Startup **perlu konfirmasi tertulis** sebelum diandalkan `[ASUMSI]`.

**Stadia Maps** `[S-18]` — model kredit, harga paling agresif dari seluruh penyedia terkelola:

| Paket | Harga/bulan | Kredit/bulan | Kelebihan pemakaian | Komersial? |
|---|---:|---:|---:|---|
| Free | $0 | 200.000 | — | **Tidak** — *"Commercial use not allowed"* |
| Starter | $20 | 1.000.000 | +$0,03/1.000 | Ya |
| **Standard** | **$80** | **7.500.000** | +$0,02/1.000 | Ya |
| **Professional** | **$250** | **25.000.000** | +$0,015/1.000 | Ya |

Bobot kredit `[S-18]`: ubin peta **1 kredit** (satelit 4) · Autocomplete v2 **1 kredit** · geocoding standar **20 kredit** · routing standar **20 kredit** (optimized 40; matrix 10/elemen).

**Radar** `[S-19]` — **tidak punya paket gratis**; *"All Radar agreements are structured annually"*. Harga: MTU $0,02–0,04/pengguna terlacak, atau API $0,50/1.000 (Core Maps) dan $2,00/1.000 (Premium Maps). Karena mensyaratkan komitmen tahunan dan kuota terkunci, Radar **tidak cocok untuk perusahaan pra-pendapatan** yang volumenya belum diketahui. Dikeluarkan dari daftar pendek.

## 3.7 Swasembada (self-hosted) — perhitungan nyata untuk Indonesia saja

### Ukuran data

Ekstrak Geofabrik per 8 September 2026 `[S-20]`:

| Ekstrak | Ukuran `.osm.pbf` |
|---|---:|
| **Indonesia (seluruhnya)** | **1,6 GB** |
| Jawa | 854 MB |
| **Sumatra** | **269 MB** |
| Nusa Tenggara | 167 MB |
| Sulawesi | 150 MB |
| Kalimantan | 140 MB |

**Ini temuan besar.** AntarKita hanya beroperasi di Pekanbaru (Riau) dan Padang (Sumbar). **Ekstrak Sumatra hanya 269 MB** — 17% dari Indonesia, 0,4% dari planet. Seluruh perhitungan sumber daya di bawah menjadi sepele.

### Kebutuhan OSRM (routing)

Aturan praktis yang dikutip `[S-23]`: *"the RAM needed to run OSRM is about 5x the file size of the map you are using."*

| Ekstrak | pbf | RAM OSRM (5×) | Disk kerja `[ASUMSI]` ≈ 8× pbf |
|---|---:|---:|---:|
| Sumatra | 269 MB | **≈1,4 GB** | ≈2,2 GB |
| Indonesia | 1,6 GB | **≈8 GB** | ≈13 GB |

Waktu impor (`osrm-extract` + `osrm-partition` + `osrm-customize`, algoritma MLD) `[ASUMSI]`: **20–40 menit untuk Sumatra**, 2–4 jam untuk Indonesia pada 8 vCPU + NVMe. Tidak ditemukan tolok ukur resmi untuk ekstrak sebesar ini; angka ini konstruksi penyusun.

### Kebutuhan Nominatim (geocoding + reverse geocoding)

Dokumentasi resmi `[S-21]`: minimum 2 GB RAM (*"A minimum of 2GB of RAM is required or installation will fail"*); 128 GB RAM dan 1 TB disk untuk planet penuh; PostgreSQL 13+ dan PostGIS 3.2+ direkomendasikan; **NVMe sangat dianjurkan**. Dokumentasi impor `[S-22]` menyarankan mencoba ekstrak kecil terlebih dahulu, menyalakan *flatnode* hanya untuk dataset besar (Eropa/Amerika Utara/planet — **tidak diperlukan untuk Indonesia**), dan menyetel `--osm2pgsql-cache` kira-kira sebesar berkas pbf.

**Dokumentasi resmi tidak memberikan angka spesifik untuk ekstrak seukuran negara.** Estimasi penyusun `[ASUMSI]`, diturunkan dari rasio planet (1,6 GB / 80 GB pbf planet ≈ 2%):

| Ekstrak | RAM disarankan | Disk basis data | Waktu impor |
|---|---:|---:|---:|
| Sumatra (269 MB) | 4–8 GB | ≈10–15 GB | ≈45–90 menit |
| **Indonesia (1,6 GB)** | **8–16 GB** | **≈50–80 GB** | **≈3–6 jam** |

### Ubin: Protomaps / PMTiles — opsi tanpa server ubin sama sekali

`pmtiles` adalah format arsip satu-berkas yang dilayani langsung dari penyimpanan objek memakai **HTTP Range Request** — **tidak butuh server ubin** `[S-25]`. Basemap planet Protomaps z0–z15 berukuran **≈120 GB** `[S-24]`, dan perintah `pmtiles extract` memotong wilayah tertentu, dengan opsi `--maxzoom`; dokumentasi mencatat *"each additional zoom level roughly doubles the size of the file"* `[S-24]`.

**`[ASUMSI]` ukuran ekstrak untuk kebutuhan AntarKita:**
- Indonesia z0–14: **≈3–5 GB** (turunan proporsi luas daratan Indonesia ≈1,3% daratan dunia, dinaikkan karena kepadatan fitur Indonesia di atas rata-rata; belum diverifikasi dengan membangun berkasnya)
- **Kotak-batas Riau + Sumatera Barat saja, z0–16: ≈0,5–1 GB** — inilah yang sebenarnya dibutuhkan.

Persyaratan penyajian `[S-25]`: penyimpanan harus mendukung Range Request dan CORS (`GET, HEAD`; header `range,if-match`; ekspos `etag`). Dokumentasi merekomendasikan **Cloudflare R2** karena *"does not have bandwidth fees, only per-request fees"*.

**Biaya Cloudflare R2** `[S-26]`: penyimpanan **$0,015/GB-bulan**, Class A **$4,50/juta**, **Class B $0,36/juta**, **egress GRATIS**. Kuota gratis: **10 GB penyimpanan, 1 juta Class A, 10 juta Class B per bulan**.

Konsekuensinya luar biasa murah:

| Skenario | Permintaan ubin/bulan | Class B tertagih (setelah 10 juta gratis) | Biaya ubin/bulan |
|---|---:|---:|---:|
| A (600/hari) | 2.430.000 | 0 | **$0,00** |
| B (2.400/hari) | 9.720.000 | 0 | **$0,00** |
| C (8.000/hari) | 32.400.000 | 22.400.000 | **$8,06** |

Penyimpanan 1 GB ekstrak Riau+Sumbar → di bawah kuota gratis 10 GB → **$0**.

**Konsekuensi arsitektur:** PMTiles adalah ubin **vektor**, sehingga aplikasi harus beralih dari Leaflet raster ke **MapLibre GL** (web) dan **MapLibre Native / `@maplibre/maplibre-react-native`** (ponsel). Ini pekerjaan aplikasi yang nyata — sekitar 2–3 minggu-orang `[ASUMSI]` — dan itulah alasan opsi ini masuk peta jalan Fase 2, bukan peluncuran (§6).

### Harga VPS nyata

| Penyedia | Spesifikasi | Harga/bulan | Lokasi | Sumber |
|---|---|---:|---|---|
| **Biznet Gio NEO Lite LL 16.16** | 16 vCPU, 16 GB RAM, NVMe | **Rp499.000** | **Jakarta, Indonesia** | `[S-29]` |
| Biznet Gio NEO Lite LL 16.8 | 16 vCPU, 8 GB RAM | Rp459.000 | Jakarta | `[S-29]` |
| Biznet Gio NEO Lite MM 8.8 | 8 vCPU, 8 GB RAM | Rp289.000 | Jakarta | `[S-29]` |
| Hetzner CPX42 | 8 vCPU, 16 GB, 320 GB NVMe, 20 TB | €69,49 ≈ Rp1.421.750 | Jerman/Finlandia | `[S-27]` |
| Hetzner CX43 | 4 vCPU, 8 GB (est.), NVMe | €15,99 ≈ Rp327.152 | Jerman/Finlandia | `[S-27]` |
| Hetzner CCX23 (vCPU dedikasi) | 4 vCPU, 16 GB | €85,99 ≈ Rp1.759.336 | Jerman/Finlandia | `[S-27]` |
| DigitalOcean Basic | 8 vCPU, 16 GB, 320 GB SSD | $96 ≈ Rp1.691.328 | termasuk Singapura | `[S-28]` |
| DigitalOcean Basic | 4 vCPU, 8 GB, 160 GB SSD | $48 ≈ Rp845.664 | termasuk Singapura | `[S-28]` |

Hetzner tersedia di **Singapura sejak 2024** `[S-34]`; surcharge lokasi Singapura **≈10–20%** dengan kuota trafik jauh lebih kecil `[S-27]` `[S-35]` — ditandai `[ASUMSI]` karena angka pastinya berasal dari agregator pihak ketiga, bukan halaman Hetzner sendiri.

**Rekomendasi lokasi: Biznet Gio (Jakarta).** Alasannya bukan harga semata (walau Rp499.000 vs Rp1,42 juta Hetzner sudah menentukan), melainkan tiga hal sekaligus: (i) **latensi** dari Pekanbaru/Padang ke Jakarta jauh lebih rendah daripada ke Frankfurt (~180 ms) atau Singapura (~30 ms), (ii) **penagihan Rupiah** menghapus paparan kurs dan PPN PMSE (diganti PPN dalam negeri 11% yang dapat dikreditkan bila PT sudah PKP), dan (iii) **residensi data di Indonesia** memperkuat posisi PSE dan menghapus seluruh persoalan Pasal 56 UU PDP untuk komponen ini.

### Topologi & biaya swasembada yang direkomendasikan

```
Aplikasi ──► Cloudflare R2  (PMTiles Riau+Sumbar, ±1 GB)         → ubin, $0
        ├──► VPS-1 Biznet 16 vCPU/16 GB  → Nominatim (Indonesia) → geocode + reverse
        └──► VPS-2 Biznet 16 vCPU/16 GB  → OSRM MLD (Indonesia)  → rute
             (VPS-3 ditambahkan pada Skenario C sebagai replika baca + cadangan)
```

| Pos | Skenario A | Skenario B | Skenario C |
|---|---:|---:|---:|
| VPS Biznet (Rp499.000 × n, + PPN 11%) | 2 × = Rp1.107.780 | 2 × = Rp1.107.780 | 3 × = Rp1.661.670 |
| Cloudflare R2 `[S-26]` (incl. PPN PMSE) | Rp0 | Rp0 | Rp157.699 |
| Pemeliharaan 0,2 FTE Mid Engineer `[ASUMSI]` | Rp2.856.000 | Rp2.856.000 | Rp2.856.000 |
| **Total/bulan** | **Rp3.963.780** | **Rp3.963.780** | **Rp4.675.369** |
| **Per pesanan** | **Rp220** | **Rp55** | **Rp19** |

`[ASUMSI]` biaya SDM: pita Mid Software Engineer P50 = Rp12.000.000 (`docs/organisasi/AntarKita-Model-Biaya-SDM.xlsx`, lembar *Pita Gaji*, seluruhnya berlabel `[ASUMSI]` di sumbernya), dikalikan rasio *total cost to company* ≈1,19 (`DESAIN-ORGANISASI` §4.3) = Rp14.280.000, dikali 0,2 FTE. Biaya penyiapan sekali jalan `[ASUMSI]` ≈80 jam-orang ≈ **Rp6,6 juta**, ditambah 2–3 minggu-orang untuk migrasi renderer ke MapLibre bila memakai PMTiles.

## 3.8 Cakupan data untuk Pekanbaru & Padang — pembahasan jujur

Ini pertanyaan yang paling penting dan paling sulit dijawab dari jarak jauh. Yang dapat dinyatakan:

**(a) Sebagian besar penyedia berbagi satu sumber data yang sama.** Mapbox, MapTiler, Stadia Maps, Geoapify, LocationIQ, Protomaps, Nominatim, OSRM, dan Photon **semuanya berbasis OpenStreetMap**. Artinya pertanyaan "apakah cakupannya bagus di Pekanbaru dan Padang" **bukan** pertanyaan tentang delapan vendor, melainkan **satu pertanyaan tunggal: seberapa baik OSM di Riau dan Sumatera Barat?** Hanya Google, HERE, dan AMap yang punya basis data independen.

**(b) Konsekuensi strategis dari (a) sangat menguntungkan.** Karena Stadia, Mapbox, Geoapify, dan swasembada memakai data yang identik, **berpindah di antara keempatnya tidak mengubah kualitas peta sama sekali** — hanya mengubah tagihan dan beban operasi. Ini menghapus risiko terbesar dari strategi "beli dulu, swasembada kemudian".

**(c) Ada program pemetaan OSM Indonesia yang aktif.** Perkumpulan OpenStreetMap Indonesia bekerja sama dengan HOT dan Meta memakai deteksi jalan berbasis AI dari citra satelit, yang divalidasi pemeta terlatih dan komunitas lokal `[S-36]`. **Namun** artikelnya tidak menyebut provinsi mana yang dicakup, berapa kilometer jalan ditambahkan, maupun persentase kelengkapan — sehingga **tidak dapat dipakai sebagai bukti kualitas untuk Riau dan Sumbar**. Ukuran ekstrak Sumatra 269 MB `[S-20]` menunjukkan data yang substansial, tetapi ukuran berkas bukan ukuran kelengkapan alamat.

**(d) Kesimpulan jujur: tidak ditemukan sumber kredibel yang mengukur kelengkapan OSM, Google, atau HERE di Pekanbaru dan Padang.** Klaim apa pun ke arah mana pun akan menjadi karangan. **Ini harus diselesaikan dengan uji lapangan, bukan riset meja** — prosedurnya di §6.3, dan biayanya nol.

---

# BAGIAN 4 — MODEL BIAYA BULANAN

## 4.1 Dasar perhitungan

- Volume: `[ASUMSI A8]` A=600, B=2.400, C=8.000 pesanan/hari; 30 hari/bulan.
- Panggilan per pesanan: §1.4, faktor jelajah 1,35 `[ASUMSI A7]`.
- Kurs: **USD 1 = Rp17.618,00**, Kurs Tengah Transaksi BI 9 Sep 2026 `[S-30]`.
- **PPN PMSE 11%** ditambahkan pada seluruh penyedia luar negeri (Google, Mapbox, MapTiler, HERE, Stadia, Geoapify, LocationIQ) sesuai PER-12/2025 `[S-31]`. Bila PT AntarKita sudah PKP dan menyerahkan NPWP kepada pemungut, PPN ini **dapat dikreditkan** `[S-31]` — model ini konservatif dengan tetap membebankannya.
- Swasembada: PPN dalam negeri 11% atas VPS Biznet; R2 dari Cloudflare (luar negeri) juga dikenai 11%.

## 4.2 Tabel biaya bulanan — tiga skenario

### Skenario A — 600 pesanan/hari (18.000/bulan)

| Penyedia | USD/bulan | Rp/bulan (incl. PPN) | **Rp/pesanan** | % pendapatan platform/pesanan (Rp1.640) |
|---|---:|---:|---:|---:|
| **Google Maps Platform** | $990,82 | **Rp19.376.378** | **Rp1.076** | **66%** ❌ |
| HERE | $335,64 | Rp6.563.691 | Rp365 | 22% |
| MapTiler Flex + rute pihak lain | $215,15 | Rp4.207.469 | Rp234 | 14% |
| Swasembada (2 VPS Biznet + R2) | — | Rp3.963.780 | Rp220 | 13% |
| LocationIQ Startup | $200,00 | Rp3.911.196 | Rp217 | 13% |
| Mapbox | $93,27 | Rp1.823.986 | Rp101 | 6% |
| **Stadia Maps Standard** | **$80,00** | **Rp1.564.478** | **Rp87** | **5%** ✅ |
| Geoapify API 10 + PMTiles/R2 | $59,00 | **Rp1.153.803** | **Rp64** | 4% |

### Skenario B — 2.400 pesanan/hari (72.000/bulan)

| Penyedia | USD/bulan | Rp/bulan (incl. PPN) | **Rp/pesanan** | % Rp1.640 |
|---|---:|---:|---:|---:|
| **Google Maps Platform** | $4.028,40 | **Rp78.779.388** | **Rp1.094** | **67%** ❌ |
| HERE | $1.429,24 | Rp27.950.267 | Rp388 | 24% |
| MapTiler Flex + rute pihak lain | $980,60 | Rp19.176.594 | Rp266 | 16% |
| Mapbox | $562,99 | Rp11.009.821 | Rp153 | 9% |
| Stadia Maps Professional | $250,00 | Rp4.888.995 | Rp68 | 4% |
| Swasembada (2 VPS Biznet + R2) | — | **Rp3.963.780** | **Rp55** | 3% |
| Geoapify API 25 + PMTiles/R2 | $109,00 | **Rp2.131.602** | **Rp30** | 2% |

### Skenario C — 8.000 pesanan/hari (240.000/bulan)

| Penyedia | USD/bulan | Rp/bulan (incl. PPN) | **Rp/pesanan** | % Rp1.640 |
|---|---:|---:|---:|---:|
| **Google Maps Platform** | $11.336,42 | **Rp221.694.803** | **Rp924** | **56%** ❌ |
| HERE | $4.831,58 | Rp94.486.282 | Rp394 | 24% |
| MapTiler Flex + rute pihak lain | $3.362,00 | Rp65.747.205 | Rp274 | 17% |
| Mapbox | $2.386,60 | Rp46.672.302 | Rp194 | 12% |
| Stadia Maps Professional (+kelebihan) | $717,04 | Rp14.022.420 | Rp58 | 4% |
| Geoapify API 100 + PMTiles/R2 | $307,06 | Rp6.004.937 | Rp25 | 2% |
| **Swasembada (3 VPS Biznet + R2)** | — | **Rp4.675.369** | **Rp19** | **1%** ✅ |

*Radar dikeluarkan: tidak ada paket gratis, wajib komitmen tahunan `[S-19]` — tidak sesuai untuk perusahaan pra-pendapatan.*

## 4.3 Mengapa biaya per pesanan menentukan segalanya

`docs/investor/CATATAN-SUMBER-DECK.md` mencatat, dari skenario uji S1 `[INT]`:
- Contoh pesanan AntarRide: total **Rp9.000**, biaya jasa **Rp8.000**, driver menerima Rp6.400 pada konfigurasi 20%.
- Pada konfigurasi yang **patuh Perpres 27/2026** (potongan roda dua maksimum **8%**): komisi = **Rp640**, driver menerima Rp7.360.
- **Pendapatan platform per pesanan turun 37%: dari Rp2.600 menjadi Rp1.640.**

Dengan pendapatan platform **Rp1.640 per pesanan**, biaya peta per pesanan bukan pos kecil — ia adalah pos yang bisa memakan seluruh marjin:

| Penyedia | Rp/pesanan (Skenario B) | Sisa untuk gateway, dukungan, insentif, SDM, laba |
|---|---:|---|
| Google | Rp1.094 | Rp546 — **tidak layak** |
| HERE | Rp388 | Rp1.252 |
| Mapbox | Rp153 | Rp1.487 |
| Stadia | Rp68 | Rp1.572 |
| Swasembada | Rp55 | Rp1.585 |
| Geoapify + PMTiles | Rp30 | Rp1.610 |

**Google Maps Platform menghabiskan 56–67% pendapatan platform per pesanan pada seluruh skenario.** Pada model komisi 8%, memilih Google berarti unit economics tidak akan pernah positif tanpa pendapatan non-komisi yang besar. Ini kesimpulan kuantitatif, bukan preferensi.

## 4.4 Sensitivitas

Dampak menggandakan **satu** parameter panggilan/pesanan terhadap total **Skenario B**. Angka di bawah dihitung ulang penuh oleh lembar *Sensitivitas* pada berkas XLSX (bukan perkiraan linear), dan sudah diverifikasi dengan menghitung ulang seluruh buku kerja:

| Parameter digandakan | Google | Mapbox | Stadia | HERE | Geoapify+R2 | Swasembada |
|---|---:|---:|---:|---:|---:|---:|
| **Basis** | $4.028,40 | $562,99 | $250,00 | $1.429,24 | $109,00 | Rp3.963.780 |
| Ubin/pesanan 100 → 200 | **+$0** | **+$0** | +$23,41 | **+$855,36** | +$3,40 | +Rp66.459 |
| Autocomplete/pesanan 4,0 → 8,0 | **+$730,05** | **+$0** | **+$0** | +$342,15 | +$70,00 | +Rp0 |
| Reverse geocode/pesanan 2,5 → 5,0 | **+$972,00** | **+$0** | **+$0** | +$213,84 | +$70,00 | +Rp0 |
| Rute/pesanan 1,3 → 2,6 | +$390,80 | +$174,40 | **+$0** | +$46,80 | +$70,00 | +Rp0 |

Tiga hal yang terbaca langsung dari tabel ini:
- **Google adalah satu-satunya penyedia yang menagih tepat pada dimensi paling tidak pasti.** Salah menaksir jumlah ketikan atau geseran peta menaikkan tagihan Google ratusan dolar; penyedia lain nyaris tidak bergerak.
- **Stadia hampir datar** untuk autocomplete, reverse geocode, dan rute, karena pada Skenario B kreditnya (16,84 juta) masih jauh di bawah pagu Professional 25 juta. Hanya penggandaan ubin yang menembus pagu.
- **HERE adalah yang paling sensitif terhadap ubin** — meskipun tarif per-1.000-nya termurah, volumenya yang besar membuat pos ini mendominasi.

**Pelajaran utama: unit penagihan lebih menentukan daripada tarif.** Penyedia yang menagih **per MAU (Mapbox)** atau **per kredit murah dengan pagu besar (Stadia)** praktis kebal terhadap kesalahan estimasi perilaku pengguna. Karena seluruh angka perilaku di §1.3 berlabel `[ASUMSI]` dan belum tervalidasi data operasi nyata, ketahanan terhadap kesalahan estimasi adalah kriteria pemilihan yang setara pentingnya dengan harga itu sendiri.

Lembar *Sensitivitas* pada berkas XLSX juga memuat **titik pindah ke swasembada** yang dihitung otomatis, beserta sel keputusan yang berbunyi "Tetap Stadia" atau "Pindah swasembada" mengikuti volume yang dimasukkan pemilik: pada Skenario A selisihnya **−Rp2.399.302** (Stadia lebih murah), pada Skenario B **+Rp925.215** dan pada Skenario C **+Rp9.347.050** (swasembada mulai menang).

---

# BAGIAN 5 — STRATEGI HEMAT YANG NYATA

Semua angka penghematan di bawah `[ASUMSI]`; metode penurunannya ditulis. Tidak satu pun memerlukan penurunan kualitas yang terlihat pengguna.

## 5.1 Cache reverse geocoding di Supabase — hemat **70%** reverse geocode

**Masalah:** `place-picker.tsx:57` memanggil `reverseGeocode` pada **setiap** `moveend`. Di kota, ribuan pengguna menggeser peta melewati petak yang sama berulang kali.

**Solusi:** tabel `geocode_cache (geohash7 text primary key, address text, provider text, created_at timestamptz)` di Supabase, dengan RPC `resolve_address(lat, lng)` yang membulatkan koordinat ke geohash presisi 7 (**≈153 m × 153 m**) dan hanya memanggil penyedia bila petak belum ada. Hasilnya dibagi **seluruh pengguna**, bukan per sesi seperti cache dalam-memori sekarang (`geo.ts:8`).

`[ASUMSI]` **rasio hit 70%** setelah satu bulan operasi. Dasar: satu kota berukuran Pekanbaru ≈ 632 km² menghasilkan ≈27.000 petak geohash-7 di area terbangun; pada Skenario A, 60.750 reverse geocode/bulan jatuh ke ruang petak itu dengan konsentrasi tinggi di koridor utama. → **reverse geocode −70%**.

**Perhatian lisensi:** Mapbox membedakan geocoding *temporary* (tak boleh disimpan) dan *permanent* ($5/1.000) `[S-13]`. Nominatim melarang penjualan ulang hasil `[S-02]` tetapi mengizinkan (bahkan mewajibkan) caching. Stadia dan Geoapify perlu dikonfirmasi tertulis sebelum caching permanen diaktifkan.

## 5.2 Batasi autocomplete — hemat **65%**

Tiga perubahan pada `place-picker.tsx:44–53`:
1. **Naikkan *debounce* dari 400 ms → 700 ms** (`place-picker.tsx:51`). Query 12 karakter yang menghasilkan 3 permintaan turun menjadi ~1,5. `[ASUMSI]` **−45%**.
2. **Naikkan panjang minimum dari 3 → 4 karakter** (`place-picker.tsx:46` dan `geo.ts:42`). Query 3 karakter di Indonesia hampir selalu terlalu umum ("jal", "pas") dan hasilnya dibuang pengguna. `[ASUMSI]` **−10% tambahan**.
3. **Pakai *session token*** di penyedia yang mendukung (Google Autocomplete Session Usage = **$0** `[S-11]`; Mapbox Search Box menagih per **sesi**, bukan per ketikan `[S-13]`). Di Google ini menghapus biaya per-permintaan sepenuhnya; di Mapbox biaya sudah per sesi sehingga (1) dan (2) tidak menghemat apa pun di sana.
4. **Cache query populer** di Supabase (`search_cache (q_normalized, near_geohash5, results jsonb, created_at)`), TTL 7 hari. `[ASUMSI]` 200 query teratas menutup **40%** lalu lintas.

Gabungan: **−65% permintaan autocomplete.**

## 5.3 Pakai PostGIS untuk jarak garis lurus, panggil routing hanya bila perlu — hemat **40%** rute

**Kondisi sekarang** (`ride/index.tsx:59–63`): `getRoute()` dipanggil **sebelum** `fare_options`, pada **setiap** perubahan pickup/dropoff, termasuk perubahan yang segera dibatalkan pengguna.

**Yang sudah benar dan harus dipertahankan:** `calc_fare` dan `fare_options` di sisi server sudah memakai `st_distance` PostGIS dengan pengali 1,3 (`0002_functions_rls.sql:135–136`, `0007_phase4.sql:136`, `0019_…:337`). Perkiraan ongkos **tidak memerlukan routing** untuk ditampilkan.

**Perubahan yang diusulkan (untuk tim aplikasi, bukan dikerjakan riset ini):**
1. Tampilkan ongkos perkiraan langsung dari `fare_options` (PostGIS, gratis) dengan label "perkiraan".
2. Panggil `getRoute()` **hanya sekali**, setelah pengguna memilih kelas kendaraan dan menekan tombol pesan — saat itulah geometri rute benar-benar dibutuhkan untuk disimpan ke `route_geometry`.
3. Tambahkan *debounce* 800 ms pada `useEffect` rute agar perubahan titik beruntun tidak memicu panggilan berlapis.
4. `route_geometry` sudah disimpan permanen (`0001_schema.sql:189`) dan sudah dipakai ulang di seluruh layar pelacakan — **tidak perlu diubah, ini sudah benar.**

`[ASUMSI]` **−40% panggilan routing** (menghilangkan panggilan pada pesanan yang ditinggalkan dan pada perubahan titik yang segera dibatalkan).

## 5.4 Simpan hasil rute — sudah dilakukan, jangan sampai hilang

`orders.route_geometry` (`0001_schema.sql:189`) diisi saat pembuatan pesanan dan dibaca oleh `order/detail.tsx:129`, `driver/order.tsx:117`, dan `share.tsx:81`. Karena itu **nol panggilan routing selama fase pelacakan**, yang biasanya merupakan pos terbesar aplikasi ride-hailing. Ini keputusan arsitektur yang sangat baik dan harus dicatat sebagai batasan yang tidak boleh diregresi.

## 5.5 Turunkan frekuensi gambar-ulang peta saat melacak driver — hemat **55%** ubin

**Masalah** (`order/detail.tsx:80–86`, `useOrder.ts:59–62`): `fitTo` dihitung ulang tiap kali `driver.lat/lng` berubah — hingga **10×/menit** dari polling 6 detik ditambah Realtime. Setiap perubahan memanggil `map.fitBounds()` (`shared.ts:108–111`) yang dapat mengubah tingkat zoom dan memaksa pengambilan set ubin baru.

**Perubahan yang diusulkan:**
1. **Refit hanya bila perlu.** Simpan posisi driver saat terakhir difit; panggil ulang `fitBounds` hanya bila driver telah bergerak **>150 m** atau bila markernya keluar dari 80% bagian tengah *viewport*. Selain itu, cukup pindahkan marker — animasi `glide()` (`shared.ts:79–88`) sudah menangani perpindahan halus tanpa menyentuh ubin.
2. **Kunci zoom maksimum pelacakan ke 16** (dari `maxZoom:17` di `shared.ts:110`). Satu tingkat zoom lebih rendah memangkas jumlah tingkat zoom berbeda yang harus diambil.
3. **Naikkan `keepBuffer`** Leaflet dari 2 ke 4 pada layar pelacakan agar geseran kecil memakai ubin yang sudah ada.
4. **Turunkan polling driver dari 6 detik → 10 detik** (`useOrder.ts:62`) dan andalkan Realtime untuk pembaruan cepat. Realtime `postgres_changes` sudah berlangganan (`useOrder.ts:54–58`), jadi polling hanyalah jaring pengaman.

`[ASUMSI]` **−70% panggilan `fitBounds` → −55% permintaan ubin jaringan**, tanpa perubahan yang terlihat pengguna (marker tetap bergerak halus setiap detik; hanya bingkai peta yang berhenti melompat — yang justru merupakan **perbaikan** pengalaman).

## 5.6 Perkiraan penghematan gabungan

Faktor yang dipakai: autocomplete ×0,35 · reverse geocode ×0,30 · rute ×0,60 · ubin ×0,45 · pemuatan peta ×1,00.

| Penyedia | Skenario A | Skenario B | **Skenario C** |
|---|---|---|---|
| Google | $990,82 → $552,59 (**−44%**) | $4.028,40 → $2.550,03 (**−37%**) | $11.336,42 → $7.648,09 (**−33%**) |
| Mapbox | $93,27 → $31,67 (**−66%**) | $562,99 → $323,18 (**−43%**) | $2.386,60 → $1.384,11 (**−42%**) |
| HERE | $335,64 → $120,32 (**−64%**) | $1.429,24 → $567,99 (**−60%**) | $4.831,58 → $1.960,75 (**−59%**) |
| **Stadia Maps** | $80 → $43,18 (**−46%**) | $250 → **$80** (**−68%**) | $717,04 → **$250** (**−65%**) |
| Geoapify + PMTiles | $59 → **$0** (masuk paket Free) | $109 → $59 (**−46%**) | $299 → $179 (**−40%**) |

**Angka yang paling relevan untuk keputusan:** pada Skenario C dengan Stadia Maps, penghematan adalah **$467,04/bulan**. Termasuk PPN dan pada kurs BI 9 Sep 2026: **Rp9.132.383/bulan = Rp109.588.600/tahun**. Pekerjaan rekayasa untuk mendapatkannya `[ASUMSI]` ≈ **3 minggu-orang sekali jalan** — pengembalian modal di bawah dua bulan.

Efek kedua yang sama pentingnya: penghematan ubin dan kredit membuat AntarKita **tetap berada di dalam paket Professional $250** hingga 8.000 pesanan/hari. Tanpa penghematan, kredit terpakai 56,1 juta (melampaui pagu 25 juta); dengan penghematan, 23,6 juta — **masih di dalam pagu**. Artinya biaya peta menjadi **datar** dari 2.400 hingga 8.000 pesanan/hari.

---

# BAGIAN 6 — REKOMENDASI

## 6.1 Pilihan utama: **Stadia Maps**

**Paket:** Standard **$80/bulan** untuk peluncuran (hingga ≈1.200 pesanan/hari), naik ke Professional **$250/bulan** untuk Fase 2 `[S-18]`.

**Alasan kuantitatif:**
1. **Termurah di antara penyedia terkelola satu-vendor.** Rp87/pesanan (A) → Rp68 (B) → Rp58 (C). Google **12–16× lebih mahal**; HERE 4–7× lebih mahal; Mapbox 1,2–3,3× lebih mahal.
2. **Hanya 4–5% dari pendapatan platform Rp1.640/pesanan.** Google memakan 56–67% — secara aritmetika tidak kompatibel dengan pagu komisi 8% Perpres 27/2026.
3. **Satu vendor menutup keempat kebutuhan**: ubin, autocomplete, geocoding, dan routing `[S-18]`. MapTiler tidak punya routing; Geoapify perlu solusi ubin terpisah.
4. **Perubahan kode paling kecil dari kondisi sekarang.** Stadia menyediakan titik akhir ubin raster yang kompatibel Leaflet. Migrasi minimum: ganti satu konstanta `TILE_URL` (`shared.ts:22`) dan tiga fungsi di `geo.ts` (`photonSearch`, `nominatimSearch`/reverse, `getRoute`). Renderer, WebView, marker, animasi `glide`, dan seluruh PostGIS **tidak tersentuh**.
5. **Jalur migrasi tanpa kehilangan kualitas.** Stadia berbasis OSM, sama seperti target swasembada. Berpindah ke Nominatim + OSRM + PMTiles sendiri nanti **tidak mengubah apa pun yang dilihat pengguna** — hanya memindahkan tagihan.
6. **Biaya menjadi datar dengan strategi §5.** Dengan penghematan, paket Professional $250 menampung hingga 8.000 pesanan/hari (23,6 juta dari 25 juta kredit).

**Yang harus diwaspadai:** Stadia adalah perusahaan yang jauh lebih kecil dari Google/Mapbox. Kewajiban sebelum kontrak: minta SLA tertulis (paket berbayar menyertakan komitmen ketersediaan `[S-18]`), konfirmasi tertulis bahwa **caching permanen hasil geocoding diizinkan** (prasyarat §5.1), dan pastikan penagihan menerima kartu korporat Indonesia.

## 6.2 Cadangan: **Mapbox**

**Alasan:** Rp101–194/pesanan — masih 5–11× lebih murah dari Google. Keunggulan unik untuk arsitektur AntarKita saat ini: **Maps SDK for Mobile ditagih per MAU** `[S-13]`, sehingga perilaku gambar-ulang boros di §5.5 **tidak menambah biaya sama sekali** — Mapbox adalah pilihan yang paling toleran bila tim aplikasi belum sempat mengerjakan optimasi. Kuota gratis (25.000 MAU, 100.000 Directions) menutup seluruh Skenario A dengan biaya hanya $93/bulan.

**Kapan cadangan ini diaktifkan:** bila Stadia menolak caching permanen, bila SLA-nya tidak memadai untuk uji tuntas investor, atau bila uji lapangan §6.3 menunjukkan pencarian tempat Stadia lebih lemah dari Mapbox Search Box di Pekanbaru/Padang.

**Peringatan lisensi:** Mapbox Geocoding *temporary* melarang penyimpanan permanen; strategi cache §5.1 harus memakai tingkat *permanent* ($5/1.000) yang akan menaikkan biaya sekitar $50–200/bulan tergantung skenario.

## 6.3 Uji lapangan wajib sebelum menandatangani apa pun (biaya: nol)

Riset meja **tidak dapat** memastikan kualitas data di Pekanbaru dan Padang (§3.8). Prosedur berikut menyelesaikannya dalam satu hari kerja:

1. Susun daftar **60 alamat nyata**: 20 rumah di gang di Pekanbaru, 20 di Padang, 10 warung/rumah makan lokal, 10 kantor/gedung publik. Ambil dari basis data merchant AntarKita yang sudah ada dan dari alamat mitra.
2. Untuk tiap alamat, jalankan **satu query autocomplete** ke: Stadia, Mapbox, Geoapify, Google (kredit percobaan $300 `[S-12]`), dan HERE (kuota gratis 30.000 `[S-15]`).
3. Catat: (a) apakah alamat muncul di 3 hasil teratas, (b) galat posisi dalam meter terhadap titik sebenarnya, (c) apakah nama lokal (bukan nama Inggris) dikenali.
4. Jalankan **20 permintaan rute** pada pasangan titik nyata dan bandingkan jarak dengan odometer motor mitra.
5. **Aturan keputusan:** bila selisih akurasi Stadia terhadap Google **<10 poin persentase** pada uji (a), pilih Stadia. Bila selisihnya **>20 poin**, pertimbangkan bauran: Google **hanya** untuk autocomplete (SKU Autocomplete Requests $2,83/1.000, atau $0 dengan session token) + Stadia untuk ubin/reverse/rute — bauran ini menambah `[ASUMSI]` ≈$250/bulan pada Skenario B, masih 1/16 biaya Google penuh.

## 6.4 Peta jalan biaya

| Fase | Volume | Arsitektur | Biaya/bulan | Rp/pesanan |
|---|---|---|---:|---:|
| **Sekarang → sebelum listing** | 0 | **Ganti keempat layanan gratis. Ini bloker.** | — | — |
| **Fase 0–1** | <1.200/hari | Stadia Standard $80, Leaflet raster dipertahankan | Rp1,56 juta | Rp87 |
| **Fase 1–2** | 1.200–4.000/hari | Stadia Professional $250 + strategi hemat §5 | Rp4,89 juta | Rp68 |
| **Fase 2+** | >4.000/hari | + migrasi ubin ke **Protomaps PMTiles di Cloudflare R2** (MapLibre GL) | Rp4,89 juta → Rp2,1 juta | Rp30 |
| **Fase 3** | >8.000/hari | **Swasembada penuh**: Nominatim + OSRM di 3 VPS Biznet Jakarta + PMTiles di R2 | Rp4,68 juta | **Rp19** |

Titik pindah ke swasembada `[ASUMSI]`: saat biaya penyedia terkelola melampaui **Rp5 juta/bulan**, yaitu sekitar **2.500 pesanan/hari** — di bawah itu, biaya 0,2 FTE pemeliharaan (Rp2,86 juta) membuat swasembada lebih mahal, bukan lebih murah. Ini alasan kuantitatif mengapa swasembada **bukan** pilihan peluncuran meskipun angka per-pesanannya terendah.

## 6.5 Tindakan yang harus dikerjakan tim aplikasi (bukan oleh riset ini)

Daftar ini diserahkan ke tim rekayasa; riset ini tidak mengubah satu baris pun kode aplikasi.

**Prioritas 1 — bloker listing:**
1. Jadikan `TILE_URL` (`shared.ts:22`) **dapat dikonfigurasi dari server** (kolom di tabel `settings` Supabase, dibaca saat aplikasi start, dengan nilai bawaan aman). Ini memutus risiko "peta mati permanen sampai rilis toko baru" — dan tetap wajib walau berpindah penyedia.
2. Ganti Photon/Nominatim/OSRM di `geo.ts` dengan penyedia berkontrak.
3. **Hapus jalur `nominatimSearch` sebagai fallback autocomplete** (`geo.ts:47`) — pola ini dilarang eksplisit `[S-02]`.
4. Bila kunci Google pernah diaktifkan: ganti `place/textsearch` (`geo.ts:76`, SKU Pro $32/1.000) dengan Places Autocomplete + session token — **11× lebih murah**.

**Prioritas 2 — penghematan (§5):** tabel `geocode_cache` + RPC `resolve_address`; debounce 700 ms dan minimum 4 karakter; tunda `getRoute` hingga konfirmasi kelas; guard 150 m pada `fitTo`; polling driver 6 → 10 detik.

---

# DAFTAR PUSTAKA

Seluruh sumber daring diakses **9 September 2026**.

| Kode | Sumber | URL |
|---|---|---|
| `[S-01]` | OpenStreetMap Foundation — **Tile Usage Policy** | https://operations.osmfoundation.org/policies/tiles/ |
| `[S-02]` | OpenStreetMap Foundation — **Nominatim Usage Policy** | https://operations.osmfoundation.org/policies/nominatim/ |
| `[S-03]` | OpenStreetMap Community Forum — "OSRM Route API rate limit" (jawaban pengelola: layanan demo, *forbids heavy usage*) | https://community.openstreetmap.org/t/osrm-route-api-rate-limit/114082 |
| `[S-04]` | komoot/photon — README, ketentuan API publik | https://github.com/komoot/photon |
| `[S-05]` | komoot/photon — Discussion #598, "Business usage of the komoot hosted photon API?" | https://github.com/komoot/photon/discussions/598 |
| `[S-06]` | 高德地图开放平台服务协议 (Perjanjian Layanan Platform Terbuka AMap) — Pasal 4.8, 4.10.6, 8.4, 13.1, 13.2, 14.1, 14.2 | https://lbs.amap.com/pages/terms/ |
| `[S-07]` | 高德地图开放平台技术服务使用许可协议 (Perjanjian Lisensi Layanan Teknis AMap) | https://lbs.amap.com/pages/authorization |
| `[S-08]` | 高德开放平台 — 服务升级 / 定价 (kuota gratis & harga) | https://lbs.amap.com/upgrade |
| `[S-09]` | 高德开放平台世界地图正式发布 (pengumuman resmi Peta Dunia AMap) | https://lbs.amap.com/news/work_map |
| `[S-10]` | 证券时报 (Securities Times), 11 Agustus 2025 — "高德开放平台推出全新世界地图服务" | https://www.stcn.com/article/detail/3042831.html |
| `[S-11]` | Google Maps Platform — daftar harga per SKU | https://developers.google.com/maps/billing-and-pricing/pricing |
| `[S-12]` | Google Maps Platform — halaman harga & struktur Essentials/Pro/Enterprise, penghapusan kredit $200 per 1 Maret 2025 | https://mapsplatform.google.com/pricing/ |
| `[S-13]` | Mapbox — Pricing | https://www.mapbox.com/pricing |
| `[S-14]` | MapTiler Cloud — Pricing | https://www.maptiler.com/cloud/pricing/ |
| `[S-15]` | Placematic — "HERE API Pricing 2026", diperbarui Agustus 2026 (**sumber pihak ketiga; wajib dikonfirmasi ke HERE**) | https://placematic.com/here-location-services/here-pricing/ |
| `[S-16]` | Geoapify — Pricing | https://www.geoapify.com/pricing/ |
| `[S-17]` | LocationIQ — Pricing | https://locationiq.com/pricing |
| `[S-18]` | Stadia Maps — Pricing | https://stadiamaps.com/pricing/ |
| `[S-19]` | Radar — Pricing | https://radar.com/pricing |
| `[S-20]` | Geofabrik — ekstrak OSM Indonesia (per 8 Sep 2026) | https://download.geofabrik.de/asia/indonesia.html |
| `[S-21]` | Nominatim — Installation / hardware requirements | https://nominatim.org/release-docs/latest/admin/Installation/ |
| `[S-22]` | Nominatim — Import (flatnode, osm2pgsql-cache, ekstrak kecil) | https://nominatim.org/release-docs/latest/admin/Import/ |
| `[S-23]` | afi.io — "Hosting the OSRM API on Amazon EC2" (aturan praktis RAM ≈ 5× ukuran pbf) | https://blog.afi.io/blog/hosting-the-osrm-api-on-amazon-ec2-running-osrm-backend-as-a-web-service/ |
| `[S-24]` | Protomaps — Basemap downloads (planet z0–15 ≈120 GB, `pmtiles extract`) | https://docs.protomaps.com/basemaps/downloads |
| `[S-25]` | Protomaps — PMTiles on cloud storage (HTTP Range, CORS, R2 tanpa biaya bandwidth) | https://docs.protomaps.com/pmtiles/cloud-storage |
| `[S-26]` | Cloudflare R2 — Pricing (egress gratis; kuota gratis 10 GB / 1 juta Class A / 10 juta Class B) | https://developers.cloudflare.com/r2/pricing/ |
| `[S-27]` | Hetzner Docs — Price Adjustment 15 Juni 2026 (harga CX/CAX/CPX/CCX) | https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/ |
| `[S-28]` | DigitalOcean — Droplet pricing | https://www.digitalocean.com/pricing/droplets |
| `[S-29]` | Biznet Gio — NEO Lite (harga Rupiah) | https://www.biznetgio.com/product/neo-lite |
| `[S-30]` | Bank Indonesia — Kurs Transaksi BI, 9 September 2026 (USD jual 17.706,09 / beli 17.529,91; EUR 20.563,85 / 20.355,73; CNY 2.638,56 / 2.612,04) | https://www.bi.go.id/id/statistik/informasi-kurs/transaksi-bi/default.aspx |
| `[S-31]` | Ortax — "Simak! Ketentuan Terbaru PPN PMSE" (PER-12/2025: 12% × DPP nilai lain 11/12 = **11% efektif**; kreditabilitas bagi ber-NPWP) | https://ortax.org/simak-ketentuan-terbaru-ppn-pmse |
| `[S-32]` | Hukumonline Klinik, 4 November 2025 — "Aturan dan Risiko Transfer Data Pribadi Antarnegara" (Pasal 56 ayat 2–4 UU 27/2022; peraturan pelaksana belum disahkan; Pasal 57, 65–67) | https://www.hukumonline.com/klinik/a/aturan-dan-risiko-transfer-data-pribadi-antarnegara-lt690aac9c5fd49/ |
| `[S-33]` | JDIH Komdigi — UU No. 27 Tahun 2022 tentang Pelindungan Data Pribadi (teks resmi) | https://jdih.komdigi.go.id/produk_hukum/view/id/832/t/undangundang+nomor+27+tahun+2022 |
| `[S-34]` | Hetzner Cloud — lokasi pusat data (Singapura tersedia sejak 2024) | https://www.hetzner.com/cloud/ |
| `[S-35]` | CostGoat — snapshot harga Hetzner Cloud 5 September 2026, termasuk surcharge lokasi Singapura (**agregator pihak ketiga**) | https://costgoat.com/pricing/hetzner |
| `[S-36]` | Perkumpulan OpenStreetMap Indonesia — "Komunitas OSM Lokal dan HOT-Meta Berkolaborasi Meningkatkan Cakupan Peta Jaringan Jalan di Indonesia" (**tidak memuat data provinsi maupun angka kelengkapan**) | https://openstreetmap.or.id/komunitas-osm-lokal-dan-facebook-berkolaborasi-meningkatkan-cakupan-peta-jaringan-jalan-di-indonesia/ |

**Rujukan internal `[INT]`:** `src/lib/geo.ts` · `src/components/map/shared.ts` · `src/components/map/MapView.tsx` · `src/components/map/MapView.web.tsx` · `src/screens/place-picker.tsx` · `src/screens/ride/index.tsx` · `src/screens/order/detail.tsx` · `src/screens/driver/order.tsx` · `src/components/BookingExtras.tsx` · `src/hooks/useOrder.ts` · `src/hooks/useDriver.ts` · `src/hooks/useLocation.ts` · `supabase/migrations/0001_schema.sql`, `0002_functions_rls.sql`, `0006_features.sql`, `0007_phase4.sql`, `0014_phase6_orders.sql`, `0019_tahap7_otomasi_keamanan_laporan.sql`, `0021_tahap8_batas_jarak_impor_tempat_toggle_layanan.sql`, `0050_moderasi_ugc_lapor_blokir.sql` · `docs/investor/CATATAN-SUMBER-DECK.md` · `docs/organisasi/AntarKita-Model-Biaya-SDM.xlsx` · `docs/organisasi/DESAIN-ORGANISASI.md`

---

## Pernyataan keterbatasan riset ini

1. **Kualitas data untuk Pekanbaru dan Padang tidak diverifikasi.** Tidak ditemukan sumber kredibel yang mengukur kelengkapan OSM, Google, HERE, atau AMap di Riau dan Sumatera Barat. Prosedur uji lapangan di §6.3 wajib dijalankan sebelum kontrak ditandatangani.
2. **Harga HERE bersumber dari agregator pihak ketiga** `[S-15]`, bukan halaman resmi HERE (yang dirender JavaScript dan tidak dapat diekstraksi). Tarif routing HERE `[ASUMSI]` $0,50/1.000 adalah konstruksi penyusun.
3. **Harga Peta Dunia AMap tidak dipublikasikan** `[S-08]` `[S-09]`; perhitungan Rp186/pesanan memakai tarif layanan domestik RRT dan bersifat hipotetis semata.
4. **Klaim "unlimited map API requests" pada LocationIQ Startup** `[S-17]` belum dikonfirmasi tertulis.
5. **Ukuran PMTiles untuk Indonesia dan Riau+Sumbar adalah `[ASUMSI]`** — belum diverifikasi dengan membangun berkasnya. Verifikasi memerlukan menjalankan `pmtiles extract` (gratis, ±1 jam).
6. **Seluruh volume pesanan adalah `[ASUMSI]` penyusun riset ini**, karena tidak ada angka pesanan/hari di dokumen bisnis AntarKita mana pun yang diperiksa. Model XLSX pendamping dibuat berformula supaya pemilik dapat mengganti angka ini dan melihat seluruh biaya berubah seketika.

---

## Status implementasi (ditambahkan tim rekayasa, 9 September 2026)

Bagian ini **hanya mencatat apa yang sudah dikerjakan di kode**; isi riset di atas tidak diubah.

**Bloker §6.5 Prioritas 1 — selesai.**

| Butir §6.5 | Status | Di mana |
|---|---|---|
| 1. `TILE_URL` dapat dikonfigurasi dari server | **Selesai** | Migrasi `0061_peta_penyedia_dan_cache.sql` (tabel `map_config`, `map_secrets`, RPC `map_public_config()`); klien di `src/lib/mapConfig.ts`; peta di `src/components/map/*` |
| 2. Ganti Photon/Nominatim/OSRM dengan penyedia berkontrak | **Jalur siap** — adaptor Stadia Maps & Mapbox terpasang; pemilik tinggal mengisi kunci di Panel Admin → Peta | `src/lib/geo.ts`, `src/screens/admin/map.tsx` |
| 3. Hapus `nominatimSearch` sebagai fallback autocomplete | **Selesai** — tidak ada lagi fallback lintas-penyedia; pola yang dilarang `[S-02]` hilang | `src/lib/geo.ts` |
| 4. Peringatan biaya Places Text Search | **Selesai** (dicatat di kode & Panel Admin; adaptor Google hanya aktif bila pemilik memilihnya) | `src/lib/geo.ts`, `src/screens/admin/map.tsx` |
| User-Agent kontak valid | **Selesai** — `AntarAja/1.0 (support@antaraja.id)` → `AntarKita/1.0 (erzamadana@gmail.com)` | `src/lib/geo.ts` |
| Atribusi wajib tampil | **Selesai** — badge atribusi dirender di atas peta (bukan kontrol Leaflet yang tertutup sheet), teksnya ikut berganti mengikuti penyedia | `src/components/map/Attribution.tsx` |

**§5 Penghematan — terpasang.**

| Strategi | Status | Nilai bawaan (dapat disetel admin) |
|---|---|---|
| §5.1 Cache reverse geocode di Supabase | Selesai — tabel `geocode_cache` berkunci geohash-7, RPC `resolve_address()`/`cache_address()` | TTL 90 hari |
| §5.2 Debounce & minimum karakter & session token | Selesai | 700 ms · 4 karakter · token sesi untuk penyedia berbasis sesi |
| §5.3 Tunda panggilan rute | Selesai — pratinjau memakai perkiraan garis lurus × 1,3 (identik rumus `estimate_fare`), rute sungguhan dipanggil di tombol pesan | `defer_routing` = nyala |
| §5.4 Simpan `route_geometry` | Dipertahankan, tidak diubah | — |
| §5.5 Kurangi gambar-ulang peta | Selesai — penjaga jarak sebelum `fitBounds`, `keepBuffer` 4, zoom pelacakan 16, polling driver 6 → 10 detik | 150 m · zoom 16 · 10.000 ms |

**Catatan penting soal tarif.** Penundaan rute (§5.3) tidak mengubah ongkos yang ditagih: `estimate_fare` (`0021_…:55`) menghitung `coalesce(p_route_km, v_straight * 1.3)` lalu menjepitnya ke `[v_straight, v_straight × max_route_ratio]`, sehingga perkiraan klien menghasilkan angka yang sama dengan perhitungan server.

**Bukti uji.**
- `npx tsc --noEmit` bersih.
- `supabase/tests/uji_peta.sql` — 23 pemeriksaan bergaya rollback: `map_public_config()` tidak membocorkan kunci rahasia, cache alamat miss→simpan→hit (termasuk TTL & anti-peracunan), non-admin tidak bisa membaca/menulis kunci.
- `tests/peta/uji-peta.mjs` (Playwright + Chromium + penyedia tiruan) — 29 pemeriksaan, semuanya lulus. Termasuk bukti dari **daftar permintaan jaringan** bahwa mengganti penyedia dari Panel Admin benar-benar mengubah URL ubin yang diminta: `tile.openstreetmap.org/...` → `tiles.stadiamaps.com/tiles/osm_bright/...?api_key=…` → `api.mapbox.com/styles/...?access_token=…`, tanpa membangun ulang aplikasi.

**Yang masih harus dikerjakan pemilik (bukan pekerjaan kode).** Buat akun Stadia Maps (utama) dan Mapbox (cadangan), isi kunci publik & rahasianya di Panel Admin → Peta, batasi kunci publik per-domain dan per bundle id/package name di dashboard masing-masing penyedia, lalu jalankan uji lapangan §6.3 sebelum menandatangani kontrak.
