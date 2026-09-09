# Runbook iOS: dari nol sampai AntarKita ada di App Store

Ditulis 9 September 2026 untuk **Erza Pradipta Madana**. Padanan iOS dari
`docs/rilis/RUNBOOK-LISTING-BESOK.md` (Android). Teks listing yang harus ditempel ada di
`docs/rilis/APP-STORE-LISTING.md`.

Semua langkah di bawah **hanya bisa dilakukan pemilik** kecuali disebut sebaliknya: semuanya
butuh akun, kartu kredit, identitas, atau kunci rahasia yang tidak boleh dipegang siapa pun lain.

---

## 0. Jawaban jujur di depan

| Pertanyaan | Jawaban |
|---|---|
| Apakah kode & konfigurasi iOS sudah siap? | **Ya.** `app.config.ts`, `eas.json`, privacy manifest, dan teks izin sudah dibuat dan **diverifikasi lewat `expo prebuild` yang sungguhan** (§9). |
| Bisakah dimulai hari ini tanpa Mac? | **Ya**, lewat EAS Build. Mac hanya diperlukan bila Anda ingin membangun sendiri di Xcode. |
| Berapa biayanya? | **99 USD/tahun** keanggotaan Apple Developer Program (± Rp1,6 juta), untuk perorangan **maupun** organisasi. EAS Build paket gratis cukup untuk memulai (15 build iOS/bulan). |
| Berapa lama sampai bisa diunduh publik? | **Perorangan: ± 4–8 hari.** **Organisasi: ± 2–3 minggu**, karena harus menunggu D-U-N-S Number lebih dulu. |
| Lebih cepat dari Android? | **Ya, jauh** — untuk akun perorangan. Android tersandera aturan 12 penguji × 14 hari; iOS tidak punya aturan seperti itu. Perbandingan lengkap di §10. |
| Apa yang paling mungkin gagal? | Push notification (belum jalan di iOS sama sekali — §8), dan reviewer yang tidak menemukan satu pun driver online (§7). |

### Keputusan pertama yang menentukan jadwal: perorangan atau organisasi?

Ini padanan iOS dari "aturan 12 penguji" Google — satu keputusan di awal yang menggeser jadwal
berminggu-minggu.

| | **Individual (perorangan)** | **Organization (badan usaha)** |
|---|---|---|
| Biaya | 99 USD/tahun | 99 USD/tahun (**sama**) |
| D-U-N-S Number | **Tidak perlu** | **WAJIB** |
| Syarat badan hukum | Tidak ada | Harus badan hukum yang diakui (PT/CV berbadan hukum). Apple menolak **DBA, nama dagang, usaha fiktif, dan cabang** |
| Nama penjual di App Store | **Nama pribadi Anda** tampil publik | Nama badan usaha |
| Situs & email | Tidak disyaratkan | Wajib punya **situs publik yang berfungsi** dan **email di domain organisasi** (`nama@antarkita.id`, bukan Gmail) |
| Waktu sampai bisa mulai | Beberapa jam – 2 hari | **+5 hari kerja** (D&B) **+2 hari kerja** (Apple menerima datanya) ≈ **7 hari kerja**, sebelum pendaftaran Apple bahkan dimulai |
| Cocok untuk AntarKita? | Bisa, dengan risiko (§6.4) | **Lebih aman** — lihat di bawah |

**Tentang D-U-N-S Number** (sumber Apple, diakses 9 Sep 2026):

- **Gratis** di hampir semua yurisdiksi.
- Apple: pemrosesan D&B **sampai 5 hari kerja**, ditambah **sampai 2 hari kerja** bagi Apple untuk
  menerima datanya → **± 7 hari kerja total** sebelum pendaftaran organisasi bisa diselesaikan.
- Cek dulu apakah badan usaha Anda sudah punya, lewat alat resmi Apple:
  https://developer.apple.com/enroll/duns-lookup/ — banyak PT di Indonesia sudah terdaftar di
  D&B tanpa pernah mendaftar sendiri. Kalau sudah ada, **tunggunya hilang sama sekali**.
- Galat "not listed as a legal entity" biasanya berarti badan usaha terdaftar sebagai usaha
  perorangan. Kalau begitu, Apple sendiri menyarankan mendaftar sebagai **individual**.

**Bisakah mendaftar perorangan dulu, pindah ke organisasi nanti?** Ya. Apple menyediakan **App
Transfer** untuk memindahkan aplikasi antar akun setelah rilis, dan riwayat/ulasan ikut pindah.
Tapi ada syaratnya (aplikasi sudah rilis, tidak sedang dalam review, tidak memakai fitur
tertentu), dan **butuh persiapan sertifikat baru**. Praktisnya: **kalau PT/CV sudah ada hari
ini, langsung daftar sebagai organisasi** dan mulai proses D-U-N-S **hari ini juga** sambil
mengerjakan yang lain — tunggunya berjalan paralel, bukan menambah.

> **Kenapa organisasi lebih aman khusus untuk AntarKita.** Guideline 5.1.1(ix):
> *"Apps that provide services in highly regulated fields (such as banking and financial services,
> healthcare, gambling, legal cannabis use, air travel and crypto exchanges) **or that require
> sensitive user information** should be submitted by a legal entity that provides the services,
> and not by an individual developer."*
> AntarKita mengumpulkan KTP/NIK, SIM, dan STNK dari mitra, dan punya dompet saldo. Itu bukan
> perbankan, tapi **memang "sensitive user information"**. Akun perorangan tetap bisa lolos —
> banyak aplikasi kecil melakukannya — tetapi ini titik penolakan yang nyata, dan jawabannya
> harus sudah disiapkan (teks siap pakai di `APP-STORE-LISTING.md` §10 & §11).
> Tambahan: nama pribadi Anda akan **tampil publik** sebagai penjual di halaman App Store.

---

## 1. Daftar Apple Developer Program — **1 jam kerja + tunggu**

1. Aktifkan **two-factor authentication** pada Apple ID `erzamadana@gmail.com`
   (atau buat Apple ID khusus perusahaan). Tanpa 2FA pendaftaran tidak bisa jalan.
2. **Bila mendaftar sebagai organisasi:** urus D-U-N-S **lebih dulu**
   (https://developer.apple.com/enroll/duns-lookup/) — ini yang paling lama, jadi mulai hari ini.
3. Buka https://developer.apple.com/programs/enroll/ → pilih Individual atau Organization.
   - Individual: bisa lewat aplikasi **Apple Developer** di iPhone (lebih cepat, verifikasi
     identitas memakai kamera) atau lewat web.
   - Organization: **web saja**, siapkan D-U-N-S, akta pendirian, dan bukti kewenangan
     menandatangani. Apple bisa meminta dokumen ternotarisasi dan/atau menelepon untuk verifikasi.
4. Bayar **99 USD/tahun** dengan kartu kredit/debit berlogo internasional.

**Titik tunggu #1:** verifikasi Apple. Perorangan biasanya **beberapa jam sampai 2 hari**.
Organisasi bisa **beberapa hari sampai 2 minggu** bila Apple meminta dokumen tambahan —
**[tidak resmi]**, Apple tidak menerbitkan SLA untuk ini.

**Sementara menunggu, kerjakan §2 dan §3** — keduanya tidak butuh akun Apple.

---

## 2. Siapkan akun Expo & token — **20 menit, TIDAK butuh akun Apple**

1. Daftar gratis di https://expo.dev.
2. Buat proyek, catat **Project ID**, lalu isi di GitHub Secrets sebagai `EAS_PROJECT_ID`
   (`app.config.ts` sudah membacanya lewat `extra.eas.projectId`).
3. Buat access token: **Account settings → Access tokens**. Simpan di GitHub →
   *Settings → Secrets and variables → Actions* sebagai **`EXPO_TOKEN`**.
4. Pasang CLI di laptop: `npm install -g eas-cli`, lalu `eas login`.

Setelah ini, workflow `.github/workflows/ios.yml` bisa menjalankan EAS Build secara manual.
Selama `EXPO_TOKEN` belum ada, job build **melewati diri sendiri dengan pesan jelas**, bukan gagal.

---

## 3. Siapkan akun demo reviewer — **30 menit, TIDAK butuh akun Apple, KERJAKAN SEKARANG**

Ini pekerjaan yang paling sering ditunda dan paling sering menyebabkan penolakan. Buat di
Supabase **produksi**:

| Akun | Email | Yang harus disiapkan |
|---|---|---|
| Pelanggan | `applereview@antarkita.id` | Saldo AntarPay uji ≥ Rp500.000, alamat rumah & kantor tersimpan, minimal 1 pesanan selesai di riwayat |
| Mitra | `applereview.mitra@antarkita.id` | Status **approved**, dokumen terverifikasi, bisa langsung digeser Online |

Lalu **uji sendiri seolah Anda reviewer di California**:

- [ ] Masuk dengan kedua akun **tanpa OTP nomor Indonesia**. Kalau pendaftaran/masuk menuntut
      verifikasi SMS ke nomor Indonesia, reviewer akan terhenti di situ — perbaiki dulu.
- [ ] Coba masuk lewat VPN luar negeri. Aplikasi harus tetap jalan.
- [ ] **Tolak izin lokasi**, lalu pastikan aplikasi tidak macet/crash dan alamat masih bisa
      diketik manual (Guideline 5.1.2 — §6.5).
- [ ] Buka **Akun → Lainnya → Hapus akun** dan pastikan benar-benar berhasil, bukan galat.
      (`CHECKLIST-GO-LIVE.md` §E menandai migrasi `0023_hapus_akun.sql` sebagai berstatus
      **BERTENTANGAN** — verifikasi sebelum submit. Ini penolakan 5.1.1(v) yang pasti.)
- [ ] Buka **⋯ → Laporkan** dan **⋯ → Blokir** pada kartu mitra dan di layar chat, pastikan
      keduanya berfungsi (Guideline 1.2).

---

## 4. Bangun .ipa lewat EAS — **20 menit kerja + 20–45 menit mesin**

Baru bisa dilakukan **setelah** akun Apple aktif (langkah 1).

```bash
# Aplikasi Pelanggan
eas build --platform ios --profile production-pelanggan

# Aplikasi Mitra
eas build --platform ios --profile production-mitra
```

Pada build **pertama**, EAS akan bertanya soal kredensial. **Jawab "yes" untuk membiarkan EAS
mengurusnya**: EAS akan masuk ke akun Apple Anda, membuat App ID, Distribution Certificate, dan
App Store provisioning profile, lalu menyimpannya di server Expo. Ini menghilangkan bagian
paling menyakitkan dari rilis iOS.

Yang perlu Anda tahu tentang kredensial itu:

- **Distribution Certificate** — maksimal **2 per akun**. Jangan menghapusnya sembarangan;
  kalau hilang, semua build lama tidak bisa diperbarui dengan mudah.
- Bundle ID yang dipakai: `id.antarkita.app` dan `id.antarkita.mitra` (sudah diatur di
  `app.config.ts`, terverifikasi di hasil prebuild).
- Alternatif tanpa EAS: `npx expo prebuild --platform ios` lalu `pod install` + Xcode di Mac.
  Butuh macOS. Konfigurasi di repositori ini sudah siap untuk jalur itu.

**Alternatif GitHub Actions macOS: TIDAK disarankan.** Runner macOS berharga **0,062 USD/menit**
(≈10× runner Linux) dan **tidak termasuk kuota gratis paket GitHub mana pun**. Satu build Expo
iOS 25–45 menit ≈ **1,5–2,8 USD per build per aplikasi**, ditambah pekerjaan mengimpor
sertifikat Apple ke runner. EAS Build paket gratis memberi **15 build iOS/bulan** dan mengurus
sertifikat sendiri. Karena itu `.github/workflows/ios.yml` **sengaja tidak memuat job macOS** —
yang ada hanya job verifikasi konfigurasi (gratis, di Linux) dan job EAS opsional.

---

## 5. App Store Connect: buat dua aplikasi — **2,5–4 jam untuk keduanya**

Di https://appstoreconnect.apple.com → **Apps → +**.

1. **Platform** iOS · **Name** (dari `APP-STORE-LISTING.md` §1/§2) · **Primary Language**
   Indonesian · **Bundle ID** pilih yang sudah dibuat EAS · **SKU** bebas
   (`antarkita-pelanggan`, `antarkita-mitra`).
2. Catat **Apple ID numerik** aplikasi (App Information → General Information). Nilai inilah yang
   diisi ke variabel `EXPO_ASC_APP_ID_PELANGGAN` / `EXPO_ASC_APP_ID_MITRA` untuk `eas submit`.
3. Isi berurutan, semuanya sudah disiapkan teksnya:

   | Bagian App Store Connect | Sumber teks |
   |---|---|
   | App Information (Subtitle, Category, Content Rights, Age Rating) | `APP-STORE-LISTING.md` §1/§2 & §6 |
   | Pricing and Availability (Free, **Indonesia saja**) | §1 |
   | **App Privacy** (nutrition label) | §4 — tabel per jenis data |
   | Version Information (Promotional text, Description, Keywords, Support URL, Marketing URL) | §1/§2 |
   | Screenshot iPhone 6,9" atau 6,5" | §3 — **belum ada, hanya Anda yang bisa membuat** |
   | **App Review Information** (akun demo + Notes + lampiran video) | §10 |

4. **Unggah build:** `eas submit --platform ios --profile production-pelanggan`
   (lalu `production-mitra`). Build muncul di App Store Connect setelah pemrosesan
   **15–60 menit**.

**Titik tunggu #2:** pemrosesan build oleh Apple, ± 15–60 menit per build.

> **Jangan lupa "Missing Compliance".** Biasanya setiap build tertahan menunggu jawaban ekspor
> enkripsi. Di proyek ini **sudah otomatis**: `ios.config.usesNonExemptEncryption: false`
> menulis `ITSAppUsesNonExemptEncryption = false` ke Info.plist (terverifikasi §9), jadi build
> langsung bisa dipakai.

---

## 6. TestFlight — **titik tunggu #3**

| | Internal testers | External testers |
|---|---|---|
| Jumlah | sampai **100** pengguna App Store Connect (tim Anda) | sampai **10.000** orang |
| Beta App Review | **Tidak perlu** — bisa mulai menguji begitu build selesai diproses | **Perlu**, untuk **build pertama** di sebuah grup; build berikutnya biasanya tidak |
| Waktu | menit | **± 24–48 jam** (**[tidak resmi]** — Apple tidak menerbitkan SLA Beta App Review) |
| Masa berlaku build | **90 hari** | **90 hari** |

**Perbedaan besar dari Android:** TestFlight **tidak** punya syarat "12 penguji selama 14 hari".
Anda bisa lewat dari build pertama langsung ke pengajuan App Store bila mau. Gunakan TestFlight
sekadar untuk memastikan aplikasi jalan di iPhone sungguhan — terutama untuk memastikan hal-hal
di §8 yang belum pernah diuji di iOS.

---

## 7. Ajukan ke App Store — **titik tunggu #4**

1. Pastikan **App Review Information** sudah terisi lengkap (§10 `APP-STORE-LISTING.md`) —
   akun demo, instruksi dua-perangkat, dan lampiran video.
2. **Version Release:** pilih *Manually release this version* agar Anda menentukan tanggal
   go-live setelah disetujui.
3. Klik **Add for Review** → **Submit**.

**Berapa lama?** Apple menyatakan: *"On average, 90% of submissions are reviewed in less than
24 hours."* Itu satu-satunya angka resmi. Realistis untuk aplikasi pertama dari akun baru dengan
fitur dompet + KYC: **1–3 hari**, dan siapkan diri untuk **satu putaran pertanyaan** dari
reviewer. Jawaban cepat memangkas hari.

Bila ditolak, Anda menjawab lewat **App Review → Resolution Center**. Menjawab dengan kutipan
pedoman yang tepat (semuanya sudah disiapkan di `APP-STORE-LISTING.md` §7 & §8) jauh lebih cepat
daripada mengubah aplikasi.

---

## 8. Lima hal yang bisa membuat DITOLAK — periksa sebelum submit

### 8.1 Push notification iOS **belum berfungsi sama sekali** — bukan penolakan, tapi jangan diiklankan

Ini masalah teknis nyata, bukan kekurangan konfigurasi. `docs/PUSH-NOTIFICATION.md` §3 poin 5
menyatakannya terus terang: di iOS `getDevicePushTokenAsync()` mengembalikan **token APNs**,
sedangkan Edge Function `push-send` mengirim lewat **FCM HTTP v1** yang menuntut token registrasi
FCM. Token APNs sengaja tidak didaftarkan supaya `push_tokens` tidak terisi token yang pasti gagal.

**Akibatnya untuk rilis iOS:** notifikasi pesanan masuk, chat, dan panggilan **tidak akan tiba**
saat aplikasi tertutup. Untuk aplikasi Mitra ini serius — driver tidak akan tahu ada pesanan.

Dua pilihan perbaikan (keduanya pekerjaan pengembangan, bukan pengaturan):

1. **Tambahkan Firebase iOS** (`@react-native-firebase/messaging` + `GoogleService-Info.plist`)
   supaya perangkat iOS mendapat token FCM. Server tidak perlu diubah sama sekali. Konsisten
   dengan Android, dan paling sedikit risikonya.
2. **Tambahkan jalur APNs langsung** di Edge Function `push-send` (butuh APNs Auth Key `.p8`
   dari Apple Developer → Keys). Menghindari Firebase, tapi menambah satu jalur kirim baru yang
   harus diuji sendiri.

**Sampai salah satunya selesai:** jangan menyebut notifikasi push di deskripsi App Store, dan
jangan meminta izin notifikasi ke pengguna iOS. Meminta izin untuk fitur yang tidak berfungsi
adalah bahan pertanyaan reviewer. Pertimbangkan **merilis aplikasi Pelanggan lebih dulu** dan
menahan aplikasi Mitra sampai push iOS jalan.

### 8.2 Hapus akun yang gagal → penolakan 5.1.1(v) yang pasti

Sudah dibahas di §3. Uji dengan akun sungguhan.

### 8.3 Reviewer tidak menemukan driver mana pun → penolakan "unable to locate feature"

Penyebab penolakan nomor satu untuk aplikasi ride-hailing. Cegah dengan akun mitra demo +
instruksi dua-perangkat + video lampiran (§10 `APP-STORE-LISTING.md`).

### 8.4 Reviewer mengira top up AntarPay wajib IAP

**Tidak wajib** — Guideline **3.1.3(e)** justru mewajibkan metode **selain** IAP untuk barang &
jasa fisik. Analisis lengkap dengan kutipan pedoman ada di `APP-STORE-LISTING.md` §7. Tempel
paragraf yang sudah disiapkan di App Review Notes **sebelum** submit, jangan menunggu ditanya.

Yang harus dijaga selamanya: **saldo AntarPay tidak boleh pernah bisa membeli barang atau jasa
digital di dalam aplikasi.** Begitu itu terjadi, bagian itu wajib IAP dan Apple memotong komisi.

### 8.5 `react-native-webrtc` tanpa privacy manifest → kemungkinan email `ITMS-91053`

Paket `react-native-webrtc@124.0.8` yang terpasang **tidak memuat `PrivacyInfo.xcprivacy`**
(diperiksa langsung di `node_modules/`). Paket ini **tidak** ada di daftar Apple "SDK yang wajib
punya privacy manifest & tanda tangan", dan Podfile hasil prebuild mengaktifkan
`:privacy_file_aggregation_enabled => true`, jadi kemungkinan besar aman.

Bila App Store Connect tetap mengirim email **`ITMS-91053: Missing API declaration`** setelah
unggahan pertama: email itu **menyebut kategori API mana yang kurang**. Tambahkan kategori
tersebut ke `ios.privacyManifests` di `app.config.ts`, bangun ulang, unggah lagi. Ini email
peringatan, bukan penolakan seketika — tetapi jangan diabaikan.

---

## 9. Yang SUDAH dikerjakan & dibuktikan di repositori

Dijalankan sungguhan pada 9 September 2026 dengan
`npx expo prebuild --platform ios --no-install` untuk `APP=pelanggan` **dan** `APP=mitra`,
lalu membaca berkas hasilnya. Folder `ios/` hasil uji sudah dihapus lagi (masuk `.gitignore`).

| Yang diverifikasi | Hasil nyata |
|---|---|
| `bundleIdentifier` per aplikasi | `id.antarkita.app` / `id.antarkita.mitra` di `project.pbxproj` |
| `buildNumber` bisa dinaikkan CI | `IOS_BUILD_NUMBER=42` → `CFBundleVersion = 42` di Info.plist |
| Versi aplikasi | `CFBundleShortVersionString = 3.0.0` (dari `package.json`) |
| iPhone-only | `TARGETED_DEVICE_FAMILY = "1"` → **tidak perlu screenshot iPad** |
| Export compliance | `ITSAppUsesNonExemptEncryption = false` → tidak ada "Missing Compliance" |
| Bahasa aplikasi | `CFBundleDevelopmentRegion = id` |
| Privacy manifest | `ios/<Proyek>/PrivacyInfo.xcprivacy` dibuat, terdaftar di `project.pbxproj` (ikut ke `.ipa`), berisi 3 kategori required-reason API + `NSPrivacyTracking = false` |
| Podfile | `:privacy_file_aggregation_enabled => true`, `platform :ios, '16.4'` |
| Teks izin | Hanya **4** kunci `NS*UsageDescription`, semuanya Bahasa Indonesia dan menyebut fitur konkret |

**Temuan terpenting dari prebuild — dan sudah diperbaiki.** Prebuild pertama menghasilkan
Info.plist yang berisi teks izin bawaan berbahasa Inggris untuk izin yang **tidak dipakai
aplikasi ini**:

```
NSLocationAlwaysAndWhenInUseUsageDescription = "Allow $(PRODUCT_NAME) to access your location"
NSLocationAlwaysUsageDescription             = "Allow $(PRODUCT_NAME) to access your location"
NSMotionUsageDescription                     = "Allow $(PRODUCT_NAME) to detect your current motion activity"
NSFaceIDUsageDescription                     = "Allow $(PRODUCT_NAME) to access your Face ID biometric data."
```

Tiga yang pertama disisipkan otomatis oleh plugin `expo-location`, yang terakhir oleh
`expo-secure-store` — keduanya menyisipkannya **walaupun fiturnya tidak dipakai**. Ini masalah
ganda: teks generik berbahasa Inggris yang memang ditolak App Review, **dan** deklarasi izin
lokasi latar belakang, sensor gerak, serta biometrik yang tidak ada di aplikasi
(`src/hooks/useLocation.ts` hanya memanggil `requestForegroundPermissionsAsync`).

Perbaikannya ada di `app.config.ts`: memberi nilai `false` pada opsi plugin
(`locationAlwaysAndWhenInUsePermission`, `locationAlwaysPermission`, `motionUsagePermission`,
`faceIDPermission`) **menghapus** kunci-kunci itu dari Info.plist. Prebuild ulang membuktikan
keempatnya hilang.

Supaya tidak kembali diam-diam saat SDK di-upgrade, `.github/workflows/ios.yml` menjalankan
prebuild dan **menggagalkan build** bila salah satu kunci itu muncul lagi, bila teks izin
berubah menjadi generik/terlalu pendek, atau bila `PrivacyInfo.xcprivacy` hilang. Job ini jalan
di **ubuntu-latest** dan **gratis**.

---

## 10. Ringkasan waktu — iOS vs Android, jujur

**iOS, akun perorangan:**

```
Hari 0     Daftar Apple Developer, bayar 99 USD          ← titik tunggu #1 (jam–2 hari)
Hari 0     PARALEL: akun Expo, akun demo reviewer, screenshot
Hari 1–2   Akun aktif → eas build → eas submit           (20–45 menit mesin)
Hari 1–2   Build diproses Apple                          ← titik tunggu #2 (15–60 menit)
Hari 2     TestFlight internal (tanpa review) → uji di iPhone sungguhan
Hari 2–3   Isi listing lengkap + App Review Information → Submit
Hari 3–5   App Review                                    ← titik tunggu #4 (90% < 24 jam)
────────────────────────────────────────────────────────────
Paling cepat publik bisa mengunduh: ± 4 hari; realistis ± 5–8 hari
```

**iOS, akun organisasi:** tambahkan **± 7 hari kerja** di depan untuk D-U-N-S (nol bila badan
usaha Anda sudah punya — **cek dulu**), plus kemungkinan verifikasi Apple yang lebih lama.
Realistis **± 2–3 minggu**.

**Perbandingan berdampingan:**

| Tonggak | Android (Play) | iOS (App Store) |
|---|---|---|
| Biaya | 25 USD sekali seumur hidup | **99 USD per tahun** |
| Verifikasi akun | hari ini–2 hari | jam–2 hari (perorangan) · hari–2 minggu (organisasi) |
| Butuh D-U-N-S? | Hanya untuk akun organisasi | Hanya untuk akun organisasi (**wajib**, ± 7 hari kerja) |
| Butuh komputer khusus? | Tidak (Linux/GitHub Actions cukup) | **Ya, macOS** — kecuali memakai EAS Build |
| Uji tertutup wajib | **12 penguji × 14 hari berturut-turut** (akun perorangan baru) | **Tidak ada syarat seperti ini** |
| Waktu tinjauan | tidak ada SLA; pengamatan 1–7 hari **[tidak resmi]** | **"90% < 24 jam"** (angka resmi Apple) |
| **Total sampai publik** | **± 18 hari tercepat, realistis 25–30 hari** | **± 4 hari tercepat, realistis 5–8 hari (perorangan)** |
| Yang paling mungkin menghambat | aturan 14 hari (tidak bisa dipercepat siapa pun) | verifikasi akun & satu putaran pertanyaan reviewer |

**Kesimpulan yang mungkin mengejutkan: iOS bisa lebih cepat sampai ke publik daripada Android**,
justru karena Google memasang syarat 14 hari untuk akun perorangan sedangkan Apple tidak.
Yang membuat iOS lebih **sulit** bukan jadwalnya, melainkan: biaya tahunan, butuh Mac atau EAS,
push notification yang belum jalan (§8.1), dan reviewer manusia yang benar-benar mencoba
aplikasinya.

**Saran urutan kerja bila ingin keduanya:** mulai **kedua-duanya hari ini**. Android tersandera
jam 14 hari yang harus mulai berdetak secepat mungkin; iOS bisa selesai duluan dan memberi
umpan balik pengguna nyata sementara jam Android berjalan.

---

## 11. Yang HANYA bisa dikerjakan pemilik — daftar periksa

- [ ] Aktifkan 2FA di Apple ID
- [ ] (Organisasi) Cek/urus D-U-N-S Number — **mulai hari ini, ini yang paling lama**
- [ ] Daftar Apple Developer Program, bayar 99 USD
- [ ] Daftar akun Expo, buat `EXPO_TOKEN` dan `EAS_PROJECT_ID` di GitHub Secrets
- [ ] Buat dua akun demo reviewer di Supabase produksi, uji dari VPN luar negeri
- [ ] Uji tombol **Hapus akun** sungguhan (verifikasi migrasi `0023`)
- [ ] Uji aplikasi saat izin lokasi **ditolak** (tidak boleh crash)
- [ ] Ambil screenshot iPhone 6,9" (1320×2868) atau 6,5" (1284×2778) — minimal 1, disarankan 5
- [ ] Rekam video alur pesan → terima → selesai untuk lampiran App Review
- [ ] `eas build` + `eas submit` untuk kedua aplikasi
- [ ] Isi App Privacy, Age Rating, App Review Information di App Store Connect
- [ ] **Putuskan:** perbaiki push iOS dulu (§8.1) atau rilis Pelanggan lebih dulu tanpa push

---

## 12. Sumber + tanggal akses

Semua diverifikasi lewat dokumen resmi, **diakses 9 September 2026**:

| Topik | Sumber |
|---|---|
| Syarat pendaftaran individual vs organisasi | https://developer.apple.com/help/account/membership/program-enrollment/ |
| D-U-N-S Number (gratis, sampai 5 hari kerja + 2 hari kerja Apple) | https://developer.apple.com/help/account/membership/D-U-N-S/ |
| Alat pencarian D-U-N-S | https://developer.apple.com/enroll/duns-lookup/ |
| Biaya keanggotaan 99 USD/tahun | https://developer.apple.com/programs/ |
| App Review Guidelines (1.2, 3.1.1, 3.1.3(e), 4.7, 4.8, 5.1.1, 5.1.2) | https://developer.apple.com/app-store/review/guidelines/ |
| Waktu review "90% < 24 jam" | https://developer.apple.com/distribute/app-review/ |
| TestFlight: 100 internal / 10.000 external, Beta App Review, build 90 hari | https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview |
| Account deletion wajib in-app | https://developer.apple.com/support/offering-account-deletion-in-your-app/ |
| Privacy manifest & tenggat 1 Mei 2024 | https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api |
| SDK yang wajib punya privacy manifest | https://developer.apple.com/support/third-party-SDK-requirements/ |
| Ukuran screenshot & ikon | https://developer.apple.com/help/app-store-connect/reference/screenshot-specifications/ |
| Harga runner macOS GitHub Actions (0,062 USD/menit) | https://docs.github.com/en/billing/managing-billing-for-your-products/about-billing-for-github-actions |
| Harga & kuota EAS Build (15 build iOS/bulan pada paket gratis) | https://expo.dev/pricing |

Dokumen internal yang dirujuk: `docs/rilis/APP-STORE-LISTING.md`,
`docs/rilis/PLAY-STORE-LISTING.md`, `docs/rilis/RUNBOOK-LISTING-BESOK.md`,
`docs/rilis/CHECKLIST-GO-LIVE.md`, `docs/PUSH-NOTIFICATION.md`.
