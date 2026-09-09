# Runbook: dari nol sampai AntarKita masuk Internal Testing

Ditulis 9 September 2026 untuk **Erza Pradipta Madana**. Semua langkah di bawah **hanya bisa dilakukan pemilik** kecuali disebut sebaliknya — semuanya butuh akun, kartu kredit, KTP, atau kunci rahasia yang tidak boleh dipegang siapa pun selain Anda.

---

## 0. Jawaban jujur atas pertanyaan "besok bisa listing?"

| Pertanyaan | Jawaban |
|---|---|
| Besok bisa **membuat listing + mengunggah AAB ke Internal Testing**? | **Ya, realistis** — sekitar **5–7 jam kerja** dalam satu hari, dengan satu ketidakpastian besar: verifikasi identitas akun Play (lihat langkah 1). |
| Besok aplikasi bisa **diunduh publik dari Play Store**? | **Tidak. Tidak mungkin.** Bukan soal kesiapan kode — ini aturan Google yang tidak bisa dipercepat. |
| Kapan paling cepat publik bisa mengunduh? | **± 18–30 hari** setelah uji tertutup benar-benar dimulai dengan 12 penguji. Lihat hitungannya di bawah. |

### Kenapa tidak bisa besok — hitungannya

Akun developer **perorangan** yang dibuat setelah 13 November 2023 wajib menjalankan uji tertutup dengan **minimal 12 penguji yang ter-*opt-in* terus-menerus selama 14 hari berturut-turut** sebelum boleh *mengajukan* akses produksi.
*(Sumber: Play Console Help — "Production access requirements", diakses 9 Sep 2026: https://support.google.com/googleplay/android-developer/answer/14151465)*

```
Hari 0     Akun terverifikasi, AAB terunggah, Internal testing jalan
Hari 0–1   Closed testing dibuat, 12 penguji opt-in  ← jam mulai berdetak DI SINI
Hari 14    Syarat 14 hari terpenuhi → baru boleh klik "Apply for production access"
Hari 14–21 Google meninjau pengajuan akses produksi        (tidak ada SLA resmi)
Hari 16–28 Rilis Production dibuat → tinjauan aplikasi     (tidak ada SLA resmi)
────────────────────────────────────────────────────────────
Paling cepat publik bisa mengunduh: ± 18 hari; realistis 3–4 minggu
```

Tiga catatan yang membuat angka ini bisa **melar**, bukan mengecil:

1. **Jam 14 hari me-*reset* logikanya bila penguji keluar.** Yang dihitung adalah penguji yang *opt-in terus-menerus*. Kalau 3 dari 12 orang mencopot diri di hari ke-9, Anda kembali di bawah 12 dan harus menambah orang baru yang jamnya mulai dari nol. **Rekrut 16–18 orang, bukan pas 12.**
2. Google **tidak menerbitkan SLA** untuk lama tinjauan. Angka "1–7 hari" adalah pengamatan komunitas, bukan janji Google — **[tidak resmi]**.
3. Penolakan apa pun mengulang siklus tinjauan dari awal. Baca bagian "Tiga hal yang bisa membuat ditolak" di bawah **sebelum** submit.

---

## 1. Buat & verifikasi akun Google Play Console — **50 menit kerja + tunggu**

1. Buka https://play.google.com/console → daftar dengan `erzamadana@gmail.com`.
2. Setujui *Developer Distribution Agreement*.
3. Bayar biaya pendaftaran **US$25 sekali seumur hidup**. Kartu harus **kredit/debit atas nama Anda sendiri** — **kartu prabayar ditolak**.
4. Pilih tipe akun:
   - **Personal** → bisa jalan hari ini juga, **tetapi kena aturan 12 penguji × 14 hari**, dan **alamat fisik Anda akan tampil publik** di halaman Play Store.
   - **Organization** → butuh badan usaha + **nomor D‑U‑N‑S** (gratis, tapi terbit **1–2 minggu**) → tidak mungkin untuk besok.
   - **Keputusan:** untuk mengejar besok, pilih **Personal**. Pindah ke Organization nanti merepotkan, jadi sadari trade-off-nya.
5. Verifikasi identitas: **KTP/paspor** + kartu kredit atas nama yang sama.
6. **Khusus akun Personal:** Google mewajibkan Anda memverifikasi punya akses ke perangkat Android lewat **aplikasi Play Console di HP**. Pasang lebih dulu supaya tidak terhambat besok.

> ⏳ **TITIK TUNGGU #1 — di luar kendali Anda.** Verifikasi identitas bisa selesai dalam hitungan menit, bisa juga beberapa hari. Google tidak menjanjikan durasi. **Kerjakan langkah ini paling pertama, hari ini, jangan besok pagi** — kalau tersangkut, semua langkah setelahnya ikut mundur.
> *(Sumber: https://support.google.com/googleplay/android-developer/answer/6112435 · https://support.google.com/googleplay/android-developer/answer/10841920 — diakses 9 Sep 2026)*

---

## 2. Buat upload keystore — **15 menit**

Butuh JDK 17+ (`sudo apt install openjdk-17-jdk` / `brew install temurin@17`). Jalankan di laptop, **bukan** di folder repo:

```bash
keytool -genkeypair -v \
  -keystore antarkita-upload.jks \
  -alias antarkita-upload \
  -keyalg RSA -keysize 4096 -validity 10000 \
  -storetype PKCS12 \
  -dname "CN=AntarKita, OU=Mobile, O=AntarKita, L=Pekanbaru, ST=Riau, C=ID"
```

Anda akan diminta **kata sandi keystore**, lalu **kata sandi key**. Boleh sama; pakai ≥16 karakter dan **simpan di password manager sekarang juga**.

Verifikasi hasilnya (harus mencetak satu entri `antarkita-upload`):

```bash
keytool -list -v -keystore antarkita-upload.jks -alias antarkita-upload
```

Ubah ke base64 untuk GitHub Secret:

```bash
# Linux
base64 -w0 antarkita-upload.jks > antarkita-upload.b64
# macOS
base64 -i antarkita-upload.jks | tr -d '\n' > antarkita-upload.b64
# Windows PowerShell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("antarkita-upload.jks")) | Set-Content -NoNewline antarkita-upload.b64
```

> ⚠️ **Satu keystore ini dipakai untuk KEDUA aplikasi** (Pelanggan & Mitra). Kehilangannya = tidak bisa lagi memperbarui aplikasi yang sudah rilis. Simpan `.jks` + kata sandi di **dua** tempat terpisah. Jangan pernah masuk ke repo (`.gitignore` sudah memblokir `*.jks`, tapi jangan diuji).

---

## 3. Isi GitHub Secrets — **10 menit**

Repo → **Settings → Secrets and variables → Actions → New repository secret**. Nama harus **persis** seperti ini (huruf besar, garis bawah):

| # | Nama secret (persis) | Isi | Wajib? |
|---|---|---|---|
| 1 | `ANDROID_KEYSTORE_BASE64` | seluruh isi `antarkita-upload.b64` (satu baris panjang, tanpa spasi/enter) | **Wajib** |
| 2 | `ANDROID_KEYSTORE_PASSWORD` | kata sandi keystore | **Wajib** |
| 3 | `ANDROID_KEY_ALIAS` | `antarkita-upload` | **Wajib** |
| 4 | `ANDROID_KEY_PASSWORD` | kata sandi key | **Wajib** |
| 5 | `GOOGLE_SERVICES_JSON_BASE64` | isi `google-services.json` dari Firebase Console, di-base64 | Opsional secara teknis — **tanpa ini push notification MATI TOTAL** di build Play |
| 6 | `PLAY_SERVICE_ACCOUNT_JSON` | isi JSON service account Google Play Developer API | Opsional (unggah otomatis; bisa nanti) |

Setelah selesai: **hapus `antarkita-upload.b64` dari laptop** (file `.jks`-nya disimpan, yang `.b64` tidak perlu).

### Tentang secret #5 — baca ini

Aplikasi memakai FCM v1 langsung (Edge Function `push-send`). Tanpa `google-services.json` di dalam build, aplikasi **tidak bisa mendaftarkan token FCM** — jadi pesanan masuk, chat, dan panggilan **tidak memunculkan notifikasi** saat aplikasi tertutup. Build tetap **sukses** dan tidak ada pesan error, jadi kegagalan ini senyap. Workflow sekarang mencetak `::warning::` bila secret ini kosong.

Cara mendapatkannya: Firebase Console → buat/ pilih proyek → **Project settings → Your apps → Add app → Android** → daftarkan **kedua** package (`id.antarkita.app` dan `id.antarkita.mitra`) di proyek yang sama → unduh satu `google-services.json` yang memuat keduanya → `base64 -w0 google-services.json`.
Workflow akan **menggagalkan build** bila berkas itu tidak memuat package yang sedang dibangun — jadi salah unduh akan ketahuan, bukan lolos diam-diam.

---

## 4. Bangun AAB lewat GitHub Actions — **30–45 menit (mesin yang bekerja, bukan Anda)**

1. Push dulu semua perubahan rilis ke `main`. Ini **wajib** karena workflow Web yang menerbitkan halaman `/privacy/`, `/terms/`, dan `/hapus-akun/`.
2. Setelah workflow **"Web (3 aplikasi) → GitHub Pages"** hijau, **buka ketiga URL ini di peramban** dan pastikan terbuka (bukan 404):
   - https://erzamadana-ui.github.io/antarkita/privacy/
   - https://erzamadana-ui.github.io/antarkita/terms/
   - https://erzamadana-ui.github.io/antarkita/hapus-akun/  ← **baru, belum pernah hidup sebelum push ini**
3. GitHub → **Actions → "Play Store AAB (rilis bertanda tangan)" → Run workflow** → `app: both`, `note: internal testing 1` → **Run**.
4. Sambil menunggu, periksa log tiga langkah ini:
   - **"Tulis google-services.json"** — tidak boleh ada `::warning::` bila Anda ingin push hidup.
   - **"Verifikasi package id & versi hasil prebuild"** — harus mencetak `targetSdkVersion=36`, daftar **13 izin aktif**, dan **7 izin diblokir**. Bila ada izin berisiko tinggi yang aktif, workflow sengaja gagal.
   - **"Verifikasi tanda tangan & ukuran AAB"** — sertifikat **tidak boleh** `CN=Android Debug`.
5. Unduh dari **Releases → `aab-<nomor>`**: `antarkita-pelanggan-v3.0.0-<code>.aab` dan `antarkita-mitra-v3.0.0-<code>.aab`. Cocokkan `SHA256SUMS.txt`.

**Bila gagal:**

| Pesan | Penyebab & obat |
|---|---|
| `Secret belum di-set: …` | Ulangi langkah 3 — periksa ejaan nama secret |
| `Kata sandi/alias keystore tidak cocok` | `ANDROID_KEY_ALIAS` harus `antarkita-upload`; cek kedua kata sandi |
| `Decode keystore gagal` | `.b64` tersalin sebagian. Buat ulang dengan `base64 -w0` (tanpa baris baru) |
| `targetSdkVersion=… < 36` | Versi Expo/React Native turun. Jangan diakali — perbaiki versinya |
| `google-services.json tidak memuat id.antarkita.mitra` | Di Firebase, aplikasi Android untuk Mitra belum didaftarkan |
| `applicationId … ≠ …` | `META` di `app.config.ts` berubah — kembalikan |
| Gradle out-of-memory | Jalankan ulang; bila berulang, build satu per satu (`app: pelanggan`, lalu `app: mitra`) |

---

## 5. Play Console: buat dua aplikasi — **2,5–4 jam untuk keduanya**

Ulangi untuk **AntarKita** (`id.antarkita.app`) dan **AntarKita Mitra** (`id.antarkita.mitra`). Semua teks siap salin ada di **`docs/rilis/PLAY-STORE-LISTING.md`**.

| Sub-langkah | Estimasi (per aplikasi) |
|---|---|
| **Create app** (nama, bahasa default *Indonesian (id-ID)*, App, Free, centang deklarasi) | 10 menit |
| **Internal testing → Create new release** → pilih **Play App Signing: "Use Google-generated key"** → unggah AAB → *Release notes* | 20 menit |
| **Testers**: buat daftar email penguji, salin tautan opt-in | 15 menit |
| **Main store listing**: judul, deskripsi singkat & lengkap, ikon 512, feature graphic 1024×500, ≥2 screenshot | 30 menit |
| **App content** (Privacy policy, App access, Ads, Content rating/IARC, Target audience, Data safety, Financial features, Advertising ID, News/COVID/Government/Health) | 60–90 menit ← **paling lama, Data safety sendiri ±45 menit** |
| **Store settings** (kategori, tag) + **Countries**: Indonesia | 10 menit |

Aset grafis **sudah dibuat** dan tinggal diunggah:

```
docs/rilis/aset/ikon-512-pelanggan.png          512×512
docs/rilis/aset/ikon-512-mitra.png              512×512
docs/rilis/aset/feature-graphic-pelanggan.png   1024×500
docs/rilis/aset/feature-graphic-mitra.png       1024×500
```

**Screenshot belum ada dan wajib (min. 2 per aplikasi).** Cara tercepat: pasang APK dari workflow "Android APK" di HP, ambil screenshot bawaan (Power + Volume Bawah). Tanpa HP: buka web aplikasi di Chrome → `F12` → *device toolbar* → **Pixel 7** → ⋮ → **Capture screenshot**. Urutan layar yang disarankan ada di `PLAY-STORE-LISTING.md` §3.

> ⏳ **TITIK TUNGGU #2.** Rilis Internal testing tetap melewati pemeriksaan otomatis. Umumnya penguji bisa memasang dalam hitungan menit sampai beberapa jam; untuk **rilis pertama dari akun baru** bisa sampai sehari. Google tidak menjanjikan durasi. **[tidak resmi]**

---

## 6. Closed testing — **titik tunggu terbesar: 14 hari kalender**

1. **Testing → Closed testing → Create track** (promosikan build dari Internal).
2. Undang penguji. **Rekrut 16–18 orang, target 12 yang bertahan.** Setiap orang harus:
   - membuka tautan opt-in dengan akun Google yang sama dengan yang Anda daftarkan;
   - menekan **"Become a tester"**;
   - **memasang aplikasinya** dan **tidak keluar dari program** selama 14 hari.
3. Catat tanggal setiap orang opt-in di spreadsheet. Yang dihitung Google adalah **12 penguji yang opt-in terus-menerus selama 14 hari berturut-turut**.
4. Setelah hari ke-14: **Apply for production access** → isi kuesioner tentang apa yang diuji, umpan balik yang didapat, dan perubahan yang Anda buat. **Jawab dengan sungguh-sungguh** — kuesioner yang asal-asalan adalah alasan penolakan yang umum.

> ⏳ **TITIK TUNGGU #3 — 14 hari, tidak bisa dipercepat dengan cara apa pun.** Tidak ada jalur bayar, tidak ada pengecualian untuk aplikasi yang "sudah siap". Sumber: https://support.google.com/googleplay/android-developer/answer/14151465 (diakses 9 Sep 2026).

---

## 7. Production — **titik tunggu #4 dan #5**

1. Akses produksi disetujui → **Production → Create new release** → promosikan AAB → *Release notes* → **Review → Start rollout**.
2. Mulai dengan **staged rollout 20%**, naikkan ke 50% lalu 100% setelah melihat data crash.

> ⏳ **TITIK TUNGGU #4:** tinjauan pengajuan akses produksi. **TITIK TUNGGU #5:** tinjauan rilis produksi itu sendiri. Google **tidak menerbitkan SLA** untuk keduanya; Play Console menampilkan status per rilis. Rentang yang lazim dilaporkan komunitas 1–7 hari per tinjauan **[tidak resmi]**.

---

## 8. Jalur paralel yang harus dimulai HARI INI juga (bukan nanti)

Semua ini berjalan bersamaan dengan 14 hari uji tertutup, jadi tidak menambah waktu **asalkan dimulai sekarang**.

| Pekerjaan | Kenapa harus sebelum Production, bukan "nanti" | Lama |
|---|---|---|
| **Aktivasi produksi Midtrans** | Aplikasi produksi dengan tombol top-up yang gagal = fungsi rusak = alasan penolakan. Butuh dokumen legal usaha + rekening | Review Midtrans **1–3 hari kerja** |
| **Pendaftaran PSE Komdigi (TDPSE)** | Kewajiban hukum bagi PSE Lingkup Privat yang melayani pengguna Indonesia; Komdigi **sudah pernah memutus akses** PSE yang tidak terdaftar. Butuh **NIB dari OSS lebih dulu** | NIB beberapa hari; TDPSE mengikuti |
| **NIB + KBLI di OSS** | Prasyarat PSE **dan** prasyarat akun Midtrans produksi. **KBLI 53200 (Aktivitas Kurir) berisiko tinggi: modal minimum Rp500 juta + izin sektor pos** — ini bisa jadi penghalang keras, periksa lebih dulu | Beberapa hari–minggu |
| **Menunjuk DPO (UU PDP 27/2022)** | AntarKita memantau lokasi secara sistematis dalam skala besar. Pasca Putusan MK 151/PUU-XXII/2024, **satu kriteria saja sudah mewajibkan DPO**. UU PDP sudah berlaku penuh | 1 hari (tunjuk + catat di Kebijakan Privasi) |
| **Batas komisi 8% (Perpres 27/2026)** | Sudah berlaku sejak **1 Juli 2026** untuk ojek roda dua. Migrasi `0031_batas_komisi_perpres_27_2026.sql` sudah ada — **pastikan sudah diterapkan di database produksi** | Sudah dikodekan, tinggal verifikasi |
| **Pengerasan Supabase produksi** | RLS advisors, konfirmasi email, custom SMTP, PITR, hapus akun demo | Lihat `CHECKLIST-GO-LIVE.md` bagian D |

Rincian dan sumber tiap butir regulasi Indonesia ada di `docs/riset/RISET-KOMPENSASI-REGULASI.md` (B.5, B.7, B.8, B.9).

---

## 9. Tiga hal yang bisa membuat aplikasi DITOLAK — periksa sebelum submit

### 9.1 Fitur hapus akun yang tidak jalan — **PERIKSA HARI INI**

Google **selalu** menguji tombol hapus akun. Kode UI-nya ada dan bisa dicapai dari empat layar Akun (Pelanggan, Driver, Merchant, Vendor) dan memanggil RPC `request_account_deletion`. Tetapi `CHECKLIST-GO-LIVE.md` menandai **migrasi `0023_hapus_akun.sql` "belum diterapkan"**, sementara `RENCANA-LISTING-LIVE.md` menyebut migrasi 0001–0024 sudah diterapkan. **Keduanya tidak mungkin benar.** Kalau fungsi itu belum ada di database produksi, tombolnya error → **penolakan hampir pasti**.

Jalankan di SQL Editor Supabase **produksi**:

```sql
select proname from pg_proc where proname = 'request_account_deletion';
```

Kosong → terapkan dulu: `supabase db push` (atau tempel isi `supabase/migrations/0023_hapus_akun.sql`). Lalu **uji sungguhan dengan akun dummy** sebelum mengisi App access.

### 9.2 Tidak ada tombol "Blokir pengguna" — kebijakan UGC

AntarKita punya chat **dan** panggilan suara antar pengguna, plus ulasan dan foto merchant. Kebijakan *User Generated Content* Google mewajibkan **sistem pelaporan di dalam aplikasi** *dan* **fungsi memblokir pengguna**. Pelaporan ada sebagian (lewat tiket CS); **fungsi blokir tidak ada sama sekali** di `src/**`. Rincian dan usulan perbaikan minimal ada di `PLAY-STORE-LISTING.md` §4.11.
*(Sumber: https://support.google.com/googleplay/android-developer/answer/9876937, diakses 9 Sep 2026)*

**Saran:** tetap jalan ke Internal testing besok, tetapi **selesaikan fitur ini sebelum mengajukan akses produksi**. Anda punya 14 hari uji tertutup — waktunya cukup.

### 9.3 Akun uji reviewer yang tidak bisa dipakai

**App access** wajib diisi karena hampir seluruh aplikasi terkunci di balik login. Siapkan di Supabase produksi (bukan akun nyata, bukan akun demo dari seed):

- **Pelanggan:** email + kata sandi, saldo AntarPay uji terisi.
- **Mitra:** driver berstatus **approved** (bukan pending — reviewer tidak bisa melewati verifikasi dokumen) + akun merchant.
- Tulis instruksi singkat di kolom yang tersedia, contoh: *"Masuk → tab Beranda → geser Online → pesanan uji muncul dalam 1–2 menit."*

Pastikan `EXPO_PUBLIC_DEMO_LOGIN` **tidak** aktif di build AAB (sudah benar: variabel itu hanya ada di `android.yml` dan `web.yml`, tidak di `release-aab.yml`).

---

## 10. Ringkasan waktu — sekali lagi, jujur

| Tonggak | Paling cepat | Realistis |
|---|---|---|
| Akun Play terverifikasi | hari ini | hari ini–2 hari |
| AAB kedua aplikasi jadi | +45 menit | +2 jam |
| Internal testing hidup, penguji bisa memasang | besok | besok–lusa |
| Closed testing dimulai (12 penguji opt-in) | besok | +1–3 hari |
| Syarat 14 hari terpenuhi | +14 hari | +14–17 hari (ada yang keluar) |
| Akses produksi disetujui | +2 hari | +3–7 hari |
| **Aplikasi bisa diunduh publik** | **± 18 hari** | **± 25–30 hari (3–4 minggu)** |

**Yang bisa Anda kendalikan:** memulai verifikasi akun hari ini, merekrut 18 penguji hari ini, dan mengerjakan Midtrans/NIB/PSE secara paralel.
**Yang tidak bisa dipercepat siapa pun:** 14 hari uji tertutup dan lama tinjauan Google.
