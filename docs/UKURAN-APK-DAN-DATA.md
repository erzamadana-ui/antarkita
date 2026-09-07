# Ukuran APK & apa yang layak dipindah ke server

Dokumen ini menjawab permintaan pemilik: **APK jangan terlalu besar**, dan **apa yang bisa
dipindahkan ke database/server**. Semua angka di bawah **diukur**, bukan ditebak. Setiap
perkiraan diberi label `(perkiraan)`.

Tanggal ukur: 7 September 2026 · SDK Expo 57 · React Native 0.86.3
Cara ukur bundel: `APP=pelanggan npx expo export --platform web` (proksi ukuran bundel JS;
lihat catatan di §2 tentang perbedaan web vs Android).

---

## 1. Ukuran saat ini

### 1a. Aset di dalam repo — `assets/**` (total **170 KB**)

| Berkas | Ukuran | Masuk APK? |
|---|---:|---|
| `assets/fonts/PlusJakartaSans-500.ttf` | 28,9 KB | ya |
| `assets/fonts/PlusJakartaSans-600.ttf` | 28,8 KB | ya |
| `assets/fonts/PlusJakartaSans-700.ttf` | 28,8 KB | ya |
| `assets/fonts/PlusJakartaSans-800.ttf` | 28,8 KB | ya |
| `assets/fonts/LICENSE-OFL.txt` | 4,4 KB | ya (wajib lisensi) |
| `assets/sounds/data.ts` (data URI base64) | 28,5 KB | ya — dipakai juga di native lewat `SoundHost` |
| `assets/sounds/ring.wav` | 15,7 KB | ya |
| `assets/sounds/order.wav` | 3,6 KB | ya |
| `assets/sounds/message.wav` | 1,8 KB | ya |
| `assets/logo/antarkita-c29.svg` | 0,4 KB | ya |
| **Total** | **170 KB** | |

> **Tidak ada satu pun PNG/JPG di `assets/**`.** Karena itu tugas "optimasi gambar PNG/JPG di
> `assets/**`" **nihil pekerjaannya** — tidak ada yang bisa dikompres di sana. Font TTF sudah
> subset kecil (±29 KB per bobot) dan WAV sudah mono 8-bit 8 kHz (dibuat `scripts/gen-sounds.py`,
> total < 22 KB). Mengecilkan lagi hanya menurunkan kualitas tanpa hasil berarti.

### 1b. Ikon aplikasi — `apps/<app>/assets/` (46–47 KB per aplikasi)

| Berkas | Ukuran |
|---|---:|
| `icon.png` | 19,0 KB |
| `adaptive-icon.png` | 19,1 KB |
| `splash-icon.png` | 6,1 KB |
| `favicon.png` | 2,2 KB |
| `logo.svg` | 0,4 KB |

Hanya satu set yang masuk ke tiap APK (≈46 KB). Sudah kecil; potensi hemat < 20 KB. Berkas ini
di luar kepemilikan tugas ini (`apps/**`) dan **tidak** diubah.

### 1c. Font ikon `@expo/vector-icons` — **masalah terbesar yang terukur**

Ekspor menyertakan **23 berkas TTF, total 4,00 MB**, padahal aplikasi hanya memakai `Ionicons`.

| Keluarga ikon | Ukuran | Dipakai kode? |
|---|---:|---|
| MaterialCommunityIcons | 1.277 KB | ❌ |
| FontAwesome6_Solid | 414 KB | ❌ |
| **Ionicons** | **381 KB** | ✅ (88 berkas) |
| MaterialIcons | 348 KB | ❌ |
| Fontisto | 306 KB | ❌ |
| FontAwesome6_Brands | 204 KB | ❌ |
| FontAwesome5_Solid | 198 KB | ❌ |
| FontAwesome | 162 KB | ❌ |
| FontAwesome5_Brands | 131 KB | ❌ |
| AntDesign | 127 KB | ❌ |
| Octicons, FontAwesome6_Regular, Entypo, Foundation, Feather, SimpleLineIcons, FontAwesome5_Regular, Zocial, EvilIcons | 401 KB | ❌ |
| **PlusJakartaSans ×4** (font merek) | **115 KB** | ✅ |
| **Total** | **4,00 MB** | |
| **Terpakai** | **496 KB** | |
| **Mubazir** | **3,52 MB** | |

Penyebabnya: seluruh 88 berkas memakai impor *barrel*
`import { Ionicons } from '@expo/vector-icons'`. Metro tidak melakukan tree-shaking pada barrel
itu, jadi `require()` ke-23 font ikut masuk bundel — di web **dan** di APK.

### 1d. Bundel JS

| | Ukuran |
|---|---:|
| `dist/_expo/static/js/web/entry-*.js` (pelanggan) | **3.984.740 B = 3,80 MB** |
| idem, setelah gzip (yang benar-benar diunduh di web) | 1.028.746 B = 0,98 MB |
| Total hasil `expo export` satu aplikasi | 8,7 MB (4,0 MB di antaranya font ikon) |
| `dist/` lengkap (pelanggan + mitra + admin + halaman statis) | 26 MB |

Komposisi bundel dari *source map* (ukuran sumber sebelum minify, total 6,90 MB / 1.632 modul):

| Paket | Ukuran sumber | % |
|---|---:|---:|
| expo-router | 1.171 KB | 16,6 % |
| react-native-reanimated | 741 KB | 10,5 % |
| react-native-web *(web saja)* | 720 KB | 10,2 % |
| @expo/vector-icons | 562 KB | 7,9 % |
| react-dom *(web saja)* | 533 KB | 7,5 % |
| leaflet | 454 KB | 6,4 % |
| @supabase/auth-js | 415 KB | 5,9 % |
| **kode aplikasi `src/screens`** | 402 KB | 5,7 % |
| react-native-gesture-handler | 365 KB | 5,2 % |
| **kode aplikasi `src/components`** | 232 KB | 3,3 % |
| react-native-svg | 114 KB | 1,6 % |
| @supabase/storage-js + postgrest-js + realtime-js + phoenix | 368 KB | 5,2 % |
| sisanya (± 45 paket) | ±820 KB | 11,5 % |

> **Catatan penting:** ini bundel **web**. Di Android, `react-native-web` + `react-dom`
> (1,2 MB sumber) diganti React Native asli, dan `leaflet` hanya dipakai sebagai string yang
> disuntik ke WebView. Jadi angka di atas dipakai sebagai **peringkat**, bukan ukuran APK.

### 1e. Kode native — penyumbang APK terbesar (perkiraan)

APK Android tidak bisa dibangun di lingkungan ini (tanpa Android SDK), jadi bagian ini
**perkiraan** berdasarkan artefak yang ditarik build:

| Sumber | Catatan |
|---|---|
| `react-native-webrtc` → `org.jitsi:webrtc:124.+` | AAR WebRTC membawa `.so` untuk **4 ABI**; tipikal 8–12 MB **per ABI** → 30–45 MB bila semua ABI ikut *(perkiraan)* |
| React Native + Hermes | ±6–8 MB per ABI *(perkiraan)* |
| Modul Expo native (image, location, image-picker, secure-store, blur, dll.) | ±3–5 MB total *(perkiraan)* |

Sebelum perubahan hari ini, APK dibangun untuk **4 ABI** (`armeabi-v7a`, `arm64-v8a`, `x86`,
`x86_64`). `x86`/`x86_64` **hanya berguna untuk emulator** — nol gunanya di HP pengguna.

### 1f. Dependensi

`expo-image` menempati 135 MB di `node_modules` (folder `prebuilds/`) — itu **artefak
pengembangan**, tidak masuk APK. Yang benar-benar berpengaruh ke APK adalah pustaka native
di §1e.

Hasil pemeriksaan seluruh 39 dependensi terhadap `src/`, `apps/`, `scripts/`, `app.config.ts`:

| Dependensi | Rujukan kode | Putusan |
|---|---:|---|
| `expo-device` | 0 | **dihapus** (tidak ada paket lain yang membutuhkannya) |
| `expo-web-browser` | 0 | **dihapus** (tidak ada paket lain yang membutuhkannya) |
| `expo-linking` | 0 | dipertahankan — dependensi `expo-router` |
| `expo-system-ui` | 0 | dipertahankan — dipakai Expo untuk `userInterfaceStyle`/`backgroundColor` di `app.config.ts` |
| `react-dom` | 0 (langsung) | dipertahankan — wajib untuk `react-native-web` |
| `react-native-worklets` | 0 (langsung) | dipertahankan — wajib untuk `react-native-reanimated` 4.x |
| 33 lainnya | ≥1 | dipakai |

---

## 2. Yang sudah diterapkan (dan penghematannya)

### ✅ A. `.github/workflows/android.yml` — APK hanya untuk ABI ARM

`assembleRelease` sekarang dijalankan dengan `-PreactNativeArchitectures=armeabi-v7a,arm64-v8a`.
Plugin Gradle React Native menerjemahkan properti ini menjadi
`android.defaultConfig.ndk.abiFilters` (lihat
`node_modules/@react-native/gradle-plugin/.../NdkConfiguratorUtils.kt` baris 57–63), sehingga
**semua** `.so` — termasuk yang berasal dari AAR WebRTC pihak ketiga — ikut tersaring saat
pengemasan.

* **Hemat: perkiraan 40–50 % dari total pustaka native, kira-kira 15–20 MB.**
* Alur build tidak berubah bentuknya: tetap **satu APK per aplikasi**, nama berkas sama
  (`antarkita-<app>-<run>.apk`), langkah `upload-artifact` dan `release` tidak diubah.
* Bila build gagal menerima properti itu, build **tetap sukses** — hanya tidak mengecil. Jadi
  perubahan ini tidak bisa merusak alur yang sudah jalan.
* Emulator x86 tidak lagi bisa memakai APK otomatis → sediakan jalan keluar (di bawah).

### ✅ B. Tiga tombol opsional lewat `workflow_dispatch`

| Input | Pilihan | Guna |
|---|---|---|
| `arsitektur` | `arm` (default) / `arm64` / `semua` | `arm64` = paling kecil (HP 64-bit, 2016 ke atas). `semua` = kembali ke perilaku lama termasuk x86 untuk **emulator**. |
| `minify` | `false` (default) | Menambahkan `android.enableProguardInReleaseBuilds=true` dan `android.enableShrinkResourcesInReleaseBuilds=true` ke `android/gradle.properties` hasil prebuild. |

`minify` sengaja **mati secara default**: R8/ProGuard bisa membuang kelas yang dipanggil lewat
refleksi (risiko nyata pada WebRTC dan modul native lain), dan efeknya baru terlihat sebagai
*crash saat dijalankan*, bukan sebagai kegagalan build. Perkiraan hemat bila diaktifkan dan lolos
uji: **15–25 % dari sisa APK**. Uji dulu di HP sungguhan sebelum dipakai untuk rilis.

Karena `android/` dibuat ulang tiap prebuild dan tidak masuk git, `app.config.ts` **tidak perlu
disentuh** untuk ini.

### ✅ C. Ukuran APK dilaporkan otomatis

Setiap build menuliskan ukuran APK ke ringkasan job GitHub Actions, dan catatan rilis kini
memuat daftar ukuran tiap berkas. Jadi perubahan ukuran ketahuan tanpa harus mengunduh dulu.

### ✅ D. `package.json` — dua dependensi tak terpakai dihapus

`expo-device` dan `expo-web-browser` dihapus. Bukti aman:

* nol rujukan di `src/`, `apps/`, `scripts/`, `app.config.ts`;
* nol paket di `node_modules` yang mencantumkannya sebagai `dependencies`/`peerDependencies`;
* `package-lock.json` diperbarui (`npm install --package-lock-only`) supaya `npm ci` di CI tetap sinkron;
* diverifikasi setelah kedua modul benar-benar dihapus dari `node_modules`:
  `npx tsc --noEmit` → bersih; `node scripts/build-web.mjs` (pelanggan + mitra + admin) → sukses;
  `npx expo config --type prebuild` untuk ketiga aplikasi → sukses, keduanya hilang dari daftar autolink.

**Penghematan bundel JS yang terukur: 0 byte** (memang tidak pernah di-import). Manfaatnya ada di
sisi native: dua modul Expo beserta kode Java/Kotlin-nya tidak lagi ikut autolink —
**perkiraan 50–150 KB**, plus permukaan izin yang lebih kecil.

### ✅ E. Aset gambar

Tidak ada tindakan: `assets/**` tidak memuat PNG/JPG sama sekali (§1a). Tidak ada berkas yang
diubah nama atau dihapus.

---

## 3. Rekomendasi bertingkat untuk pemilik — dampak besar → kecil

### 🥇 1. Ganti impor ikon menjadi per-keluarga — hemat **3,52 MB aset + 0,41 MB JS** (TERUKUR)

Dampak terbesar yang bisa dicapai dengan perubahan paling kecil. **Sudah diukur nyata**, bukan
perkiraan: saya menyalin repo ke folder kerja terpisah, mengubah impornya, lalu mengekspor ulang.

| | Sekarang | Sesudah | Selisih |
|---|---:|---:|---:|
| Aset TTF | 4,00 MB (23 berkas) | 0,48 MB (5 berkas) | **−3,52 MB** |
| `entry-*.js` | 3.984.740 B | 3.557.501 B | **−427.239 B (−0,41 MB)** |
| `entry-*.js` gzip | 1.028.746 B | 894.640 B | −134.106 B |
| Total ekspor | 8,7 MB | 4,7 MB | **−4,0 MB** |

`npx tsc --noEmit` pada salinan itu **bersih**.

**Perubahannya satu baris, sama persis di 88 berkas**, semuanya di `src/` (tidak ada di `apps/`):

```
- import { Ionicons } from '@expo/vector-icons';
+ import Ionicons from '@expo/vector-icons/Ionicons';
```

Perintah persisnya:

```bash
grep -rl "from '@expo/vector-icons'" src/ \
  | xargs sed -i "s|import { Ionicons } from '@expo/vector-icons';|import Ionicons from '@expo/vector-icons/Ionicons';|g"
npx tsc --noEmit
```

Tidak ada varian impor lain di repo (`grep -rho "import {[^}]*} from '@expo/vector-icons'"`
hanya mengembalikan satu bentuk), jadi `sed` di atas menutup 100 % kasus.

> **Kenapa tidak saya kerjakan sendiri:** ke-88 berkas berada di `src/**`, yang di luar
> kepemilikan tugas ini (`src/components/**`, `src/screens/**`, `src/hooks/**`, dsb.). Serahkan
> ke pemilik `src/` — perubahannya mekanis dan tidak mengubah tampilan sama sekali (`Ionicons`
> hasil impor default identik dengan yang dari barrel).

### 🥈 2. Rilis lewat **AAB + Google Play** — hemat perkiraan **15–25 MB** untuk pengguna akhir

APK yang diunggah ke GitHub Release harus memuat semua ABI dan semua kerapatan layar yang
disertakan; Play Store tidak. Dengan Android App Bundle, Play menyusun berkas yang **spesifik
per perangkat**: hanya satu ABI, hanya kerapatan layar yang dipakai, hanya bahasa yang dipakai.

* Jalur: `eas build -p android --profile production` (sudah ada di `eas.json`) → unggah `.aab`.
* Efek tipikal untuk aplikasi berbasis WebRTC: unduhan pengguna **turun 50–65 %** dari ukuran
  APK universal *(perkiraan)*.
* **Play Asset Delivery** *belum* relevan untuk AntarKita: PAD berguna bila ada ratusan MB aset
  (game, peta offline, video). Aset AntarKita hanya 170 KB. **Rekomendasi: jangan pakai PAD**
  sekarang; baru pertimbangkan bila kelak menambahkan peta offline atau video onboarding.
* APK di GitHub Release tetap berguna untuk uji internal / distribusi langsung — biarkan.

### 🥉 3. Muat font ikon dari server, bukan dari APK — hemat **0,38 MB** (setelah langkah 1)

Setelah langkah 1, sisa font ikon tinggal `Ionicons` (381 KB). Bila ingin lebih kecil lagi,
`expo-font` bisa memuat font dari URL (`Font.loadAsync({ Ionicons: 'https://.../Ionicons.ttf' })`)
yang dilayani dari **Supabase Storage** bucket publik. Konsekuensi: ikon berupa kotak kosong
pada pembukaan pertama tanpa jaringan. **Saran: jangan** — hemat 381 KB tidak sebanding dengan
kualitas pengalaman pembukaan pertama.

### 4. Aktifkan R8/ProGuard setelah diuji — hemat perkiraan **15–25 % sisa APK**

Sudah tersedia sebagai tombol (`minify` di workflow_dispatch, §2B). Prosedur aman:
jalankan workflow manual dengan `minify = true` → pasang di HP sungguhan → uji **panggilan suara
(WebRTC), peta, unggah foto, dan chat pesanan** → baru pertimbangkan menjadikannya default.
Jangan langsung dipakai untuk rilis.

### 5. Bangun hanya `arm64-v8a` untuk rilis — hemat perkiraan **6–10 MB** lagi

Pilihan `arsitektur = arm64` di workflow. Semua HP Android yang dijual sejak ±2016 adalah 64-bit,
dan Google Play sendiri mewajibkan 64-bit sejak 2019. Risikonya hanya HP 32-bit lama. Bila
distribusi APK langsung menyasar pengguna daerah dengan HP lawas, tetap di `arm` (default).

### 6. Hermes & Arsitektur Baru — **sudah aktif, tidak ada pekerjaan**

Diperiksa lewat `npx expo config --type public`: `app.config.ts` tidak menyetel `jsEngine`
maupun `newArchEnabled`, artinya keduanya memakai default Expo SDK 57 = **Hermes menyala** dan
**New Architecture menyala**. Hermes sudah mengubah JS menjadi bytecode saat build (lebih kecil
dan lebih cepat dibuka daripada JSC). **Jangan** menyetel `jsEngine: 'jsc'` — itu akan
memperbesar APK dan memperlambat pembukaan.

### 7. Apa yang layak dipindah ke database / Supabase Storage

| Data | Status hari ini | Rekomendasi |
|---|---|---|
| **Gambar promo** (20 JPG, 584 KB) | ✅ **sudah dari server.** `PromoCard` (`src/components/PromoCard.tsx:26`) merender `<Image source={{ uri: promo.image_url }} />` dari kolom `promos.image_url`; berkas JPG ada di `public/promos/` yang **hanya dilayani situs web GitHub Pages** dan **tidak pernah masuk APK**. | Tidak ada pekerjaan. Bila kelak ingin promo bisa diganti tanpa deploy web, pindahkan 20 JPG itu ke bucket Storage publik `promo-images` dan isi `promos.image_url` dengan URL bucket. Ukuran APK tidak berubah. |
| **Ikon / foto merchant** | ✅ sudah dari server — bucket `merchant-images` sudah ada sejak `0002_functions_rls.sql:723`. | Tidak ada pekerjaan. |
| **Foto profil** | ✅ sudah dari server — bucket `avatars`. | Tidak ada pekerjaan. |
| **Katalog produk / harga pasar** | ✅ sudah di database (`shop_products`, `market_items`, `market_prices`). | Tidak ada pekerjaan. |
| **Data kota & gudang** | ✅ sudah di database (`cities`, `warehouses`), diambil saat jalan. | Tidak ada pekerjaan. |
| **Sakelar layanan (`app_settings`)** | ✅ di database, dan sejak migrasi `0028` **juga realtime** — perubahan admin langsung terasa di aplikasi pelanggan tanpa buka ulang. | Tidak ada pekerjaan. |

**Kesimpulan penting bagi pemilik: memindahkan data ke database TIDAK akan mengecilkan APK,
karena semua data dinamis AntarKita sudah ada di database.** Ukuran APK hari ini didominasi
**kode native** (WebRTC, React Native, Hermes) dan **font ikon**, bukan data.

### 8. Hal-hal kecil (dampak < 200 KB, kerjakan hanya kalau sempat)

| Langkah | Hemat |
|---|---:|
| `src/components/map/leaflet-bundle.ts` (162 KB) dimuat dari Storage alih-alih ditanam. **Tidak disarankan**: peta jadi butuh jaringan untuk render pertama, padahal sekarang jalan langsung. | ±162 KB |
| Minify `leaflet.css` di `scripts/gen-leaflet.mjs` sebelum diserialisasi | ±4 KB |
| Kompres ulang `apps/<app>/assets/*.png` (oxipng/pngquant) | ±15 KB per APK |
| Buang bobot font merek yang jarang dipakai (mis. `PlusJakartaSans-500`) bila desain tidak memerlukannya | 29 KB per bobot |

### 9. Yang **jangan** dilakukan

* Jangan hapus `expo-linking`, `react-dom`, `react-native-worklets`, `expo-system-ui` — walau
  tidak di-import langsung, keempatnya dibutuhkan `expo-router`, `react-native-web`,
  `react-native-reanimated`, dan `app.config.ts`.
* Jangan buang `react-native-webrtc` demi ukuran — itu inti fitur panggilan suara tanpa membuka
  nomor HP (UU PDP). Kalau ukurannya benar-benar tak tertahankan, alternatifnya adalah pindah ke
  panggilan berbasis SIP/PSTN pihak ketiga, dan itu keputusan produk, bukan optimasi.
* Jangan menyetel `jsEngine: 'jsc'`.
* Jangan pakai Play Asset Delivery sekarang (§2 poin 2).

---

## 4. Ringkasan angka

| | Terukur | Perkiraan |
|---|---:|---:|
| ABI ARM saja di workflow (**diterapkan**) | — | −15…20 MB |
| Impor ikon per-keluarga (**rekomendasi #1**) | **−3,52 MB aset −0,41 MB JS** | — |
| Rilis AAB lewat Play Store (**rekomendasi #2**) | — | −15…25 MB untuk pengguna |
| R8/ProGuard (**tombol tersedia, opt-in**) | — | −15…25 % sisa |
| `arm64-v8a` saja (**tombol tersedia**) | — | −6…10 MB lagi |
| Hapus `expo-device` + `expo-web-browser` (**diterapkan**) | 0 B pada bundel JS | −50…150 KB native |
| Optimasi gambar `assets/**` | **0 B — tidak ada gambar di sana** | — |
