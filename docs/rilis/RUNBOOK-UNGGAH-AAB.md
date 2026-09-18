# Runbook: Unggah AAB ke Play Console

**AntarKita · diperbarui 18 September 2026** · menggantikan runbook 16–17 Sep (AAB 109/110 sudah usang, jangan dipakai).

Workflow sumber: `.github/workflows/release-aab.yml` ("Play Store AAB (rilis bertanda tangan)").
Rumus versi: `versionCode = nomor run + 100` (offset di `app.config.ts`), `versionName = "version"` di `package.json` (saat ini `3.0.0`).

## 1. Status hari ini (18 Sep 2026)

| Butir | Status |
|---|---|
| Build | Run **#11** → versionCode **111**, sukses, dari commit `32faba4` (perbaikan tombol pesan; sudah memuat 506 kabupaten/kota dan peta cadangan Stadia) |
| Rilis GitHub | `aab-11`: `antarkita-pelanggan-v3.0.0-111.aab`, `antarkita-mitra-v3.0.0-111.aab` (masing-masing ± 101 MB) + `SHA256SUMS.txt` |
| Berkas di Mac Erza | `~/Downloads/AntarKita-AAB-111/` — SHA256 **cocok** dengan `SHA256SUMS.txt` |
| Play Console (Pelanggan) | Rilis draf **"111 (3.0.0)"** di track **Closed testing – Alpha** sudah dibuat dan **tersimpan**; catatan rilis bahasa Indonesia sudah terisi |
| Belum | (a) daftar penguji / email list untuk track Alpha, (b) **Send for review** |
| App Mitra | Belum ada rilis draf; AAB-nya sudah tersedia di `aab-11` |

## 2. Sisa langkah untuk Erza (± 10 menit)

1. Play Console → **AntarKita: Ojek Kirim & Travel** → **Test and release → Testing → Closed testing → Alpha**.
2. Tab **Testers** → **Create email list** (atau pilih yang sudah ada) → tempel alamat email penguji (minimal 12 orang untuk syarat 14 hari) → **Save changes**.
3. Kembali ke tab **Releases** → buka draf **111 (3.0.0)** → **Edit release** → pastikan versionCode `111` tampil → **Next** → periksa peringatan → **Save** → **Send for review** (atau **Start rollout to Alpha** — tergantung label yang muncul).
4. Ulangi untuk app **AntarKita Mitra** (`id.antarkita.mitra`) dengan `antarkita-mitra-v3.0.0-111.aab`: Closed testing → Create new release → seret berkas → isi catatan rilis → Save.
5. Kabari Claude setelah "Send for review" ditekan — pemantauan status review dan kuesioner App content dilanjutkan dari sana.

> Verifikasi sebelum unggah (opsional, di Terminal Mac):
> `cd ~/Downloads/AntarKita-AAB-111 && shasum -a 256 -c SHA256SUMS.txt`

## 3. Membangun AAB baru (untuk rilis berikutnya)

1. GitHub → repo `erzamadana-ui/antarkita` → **Actions** → workflow **"Play Store AAB (rilis bertanda tangan)"** → **Run workflow**.
2. Input: `app` = `both` (atau `pelanggan` / `mitra`), `note` = catatan singkat (mis. `build 112: ...`).
3. Tunggu 15–25 menit. Hasil: artifact 30 hari + GitHub Release **`aab-<nomor run>`** (prerelease) berisi kedua `.aab` dan `SHA256SUMS.txt`.
4. Nomor run berikutnya = 12 → versionCode **112**. Nomor run tidak pernah turun, jadi versionCode selalu naik.
5. Alternatif pemicu: push tag `v*` (mis. `v3.0.1`) — jangan lupa naikkan `"version"` di `package.json` lebih dulu.

Workflow juga memeriksa: keystore terdecode + sandi/alias cocok, `applicationId` sesuai app, `targetSdk >= 36`, izin berisiko tinggi tidak aktif, tanda tangan bukan debug key. Bila salah satu gagal, log langkahnya menyebut secret/berkas mana yang perlu dibetulkan.

## 4. Kenapa unggah otomatis dari sesi AI gagal

Lima jalur dicoba pada sesi 16–18 Sep 2026. Semuanya gagal karena batas teknis/keamanan, bukan karena kesalahan Play Console.

| # | Jalur yang dicoba | Kenapa gagal |
|---|---|---|
| 1 | Alat unggah berkas ekstensi Chrome (Claude in Chrome) | Batas unggahan alat **10 MB**; berkas AAB **± 101 MB** |
| 2 | `fetch()` berkas AAB dari `objects.githubusercontent.com` langsung di halaman Play Console (lalu disuntik ke input file) | Ditolak **CORS** — GitHub tidak mengirim header `Access-Control-Allow-Origin` untuk origin `play.google.com` |
| 3 | Unggah lewat VM laptop (Cowork) ke penyimpanan perantara Supabase | Proxy VM **memblokir `supabase.co`**; berkas tidak pernah sampai |
| 4 | Menyimpan AAB ke repo (commit/push biner 101 MB) agar bisa ditarik dari tempat lain | **Pengaman sesi menolak** push biner sebesar itu — dan memang praktik buruk: repo membengkak permanen, dan GitHub sendiri membatasi 100 MB per berkas |
| 5 | Mengendalikan dialog **pilih berkas macOS** (Finder picker) dari browser | Akses browser di Mac hanya **tier baca**; dialog sistem tidak bisa diklik/diketik oleh sesi AI |

**Kesimpulan:** unggah manual tetap dibutuhkan *sampai* jalur permanen di bawah terpasang. Setelah itu berkas 101 MB tidak perlu disentuh siapa pun lagi.

## 5. Jalur permanen: secret `PLAY_SERVICE_ACCOUNT_JSON` (HARUS Erza, sekali seumur proyek)

Workflow sudah punya langkah `r0adkll/upload-google-play@v1` yang otomatis mengunggah ke track **internal** bila secret ini ada. Yang kurang hanya secret-nya.

### 5a. Buat service account di Google Cloud
1. Buka <https://console.cloud.google.com> → pilih proyek **`antarkita-b04b7`** (proyek Firebase yang sama; boleh proyek baru, tapi satu proyek lebih rapi).
2. **APIs & Services → Library** → cari **Google Play Android Developer API** → **Enable**.
3. **IAM & Admin → Service Accounts → Create service account**
   - Name: `play-publisher` → **Create and continue** → lewati pemberian role (tidak perlu role Cloud) → **Done**.
4. Klik `play-publisher@antarkita-b04b7.iam.gserviceaccount.com` → tab **Keys → Add key → Create new key → JSON → Create**. Berkas `.json` terunduh ke `~/Downloads`.

### 5b. Beri akses di Play Console
5. Play Console → **Users and permissions → Invite new user**.
6. Email: alamat service account dari langkah 4 (`play-publisher@...iam.gserviceaccount.com`).
7. **Account permissions**: kosongkan. **App permissions → Add app** → pilih **AntarKita: Ojek Kirim & Travel** *dan* **AntarKita Mitra**.
8. Pilih peran **Release manager** (preset yang mencakup *Release to testing tracks*, *Release apps to testing tracks*, *View app information*). Jangan beri peran Admin.
9. **Invite user** → pastikan statusnya aktif (bukan "Pending" lama — undangan service account biasanya langsung aktif).
10. Bila menu **Settings → Developer account → API access** meminta *Link a Google Cloud project*, tautkan ke `antarkita-b04b7` di sana.

### 5c. Taruh secret di GitHub
11. GitHub → repo `erzamadana-ui/antarkita` → **Settings → Secrets and variables → Actions → New repository secret**.
12. Name: `PLAY_SERVICE_ACCOUNT_JSON`. Secret: buka berkas `.json` di TextEdit → Cmd+A, Cmd+C → tempel **seluruh isi** (JSON mentah, bukan base64) → **Add secret**.
13. Hapus berkas `.json` dari `~/Downloads` (Finder → pindah ke Trash → kosongkan Trash).
14. Jalankan ulang workflow (Bagian 3). Langkah "Unggah ke Play Console (internal testing)" kini aktif; rilis muncul di **Internal testing** sebagai `v3.0.0 (<versionCode>)`. Dari sana promosikan ke Alpha lewat **Promote release**.

> **PERINGATAN — JANGAN mengirim isi berkas JSON ke Claude, ke chat, ke email, atau ke siapa pun.**
> Berkas itu setara kata sandi akun developer Play. Claude tidak bisa dan tidak boleh menulis GitHub Secret;
> tempel langsung dari TextEdit ke GitHub. Bila isinya sempat terkirim ke mana pun, hapus key di Google Cloud
> (Keys → ⋮ → Delete) dan buat key baru.

## 6. Pemecahan masalah

**"Version code 111 has already been used"** saat unggah ke Play
- Berarti AAB dengan versionCode itu sudah pernah diunggah (mungkin di track lain atau draf yang terhapus). Jalankan workflow lagi → run berikutnya memberi versionCode baru (nomor run + 100). Jangan mengedit `ANDROID_VERSION_CODE_OFFSET` untuk "melompati" angka kecuali nomor run GitHub di-reset (repo dipindah/dibuat ulang) — kalau itu terjadi, naikkan offset ke ≥ versionCode terakhir di Play.
- Kedua app (Pelanggan & Mitra) punya ruang versionCode masing-masing di Play, jadi 111 di keduanya tidak bentrok.

**Workflow gagal di langkah "Pastikan rahasia keystore tersedia"**
- `Secret belum di-set` → isi `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` (`antarkita-upload`), `ANDROID_KEY_PASSWORD`.
- `bukan base64 valid` → tempel ulang dari `antarkita-upload.b64` (TextEdit, Cmd+A, Cmd+C); workflow sudah menoleransi enter/spasi, jadi biasanya isinya terpotong.
- `Sandi/alias keystore tidak cocok` → cek di Mac: `keytool -list -keystore antarkita-upload.jks -alias antarkita-upload` lalu samakan secret; pastikan tidak ada spasi/enter di akhir sandi.

**Play menolak: "Your Android App Bundle is signed with the wrong key"**
- Play Console memakai **Play App Signing**: yang diunggah harus ditandatangani **upload key** yang terdaftar (SHA-1 di **Test and release → Setup → App signing → Upload key certificate**).
- Bandingkan: `keytool -printcert -jarfile antarkita-pelanggan-v3.0.0-111.aab` vs SHA-1 di halaman itu. Bila beda, keystore di secret bukan yang didaftarkan → ganti secret ke keystore yang benar, atau minta **reset upload key** di halaman App signing (butuh sertifikat `.pem` baru, proses ± 2 hari kerja).
- Workflow menolak build yang masih `CN=Android Debug`; kalau pesan itu muncul, `scripts/android-signing.mjs` tidak menulis konfigurasi signing — cek log langkah "Pasang upload keystore".

**Unggah otomatis (langkah upload-google-play) gagal setelah secret dipasang**
- `403 / The caller does not have permission` → service account belum diundang di Play Console (5b) atau belum diberi app yang benar; tunggu ± 5 menit setelah undangan.
- `Package not found` → app Mitra belum dibuat di Play Console, atau `packageName` salah; jalankan `app=pelanggan` saja sementara.
- `changesNotSentForReview` error → ada perubahan App content yang belum tersubmit; selesaikan kuesioner lalu ulangi.

**Push notification mati di build Play** (build tetap hijau)
- Secret `GOOGLE_SERVICES_JSON_BASE64` kosong → warning di log, bukan error. Isi dari Firebase Console (`google-services.json` yang memuat `id.antarkita.app` dan `id.antarkita.mitra`), base64, tempel ke secret, build ulang.

**SHA256 tidak cocok setelah unduh**
- Unduhan terpotong (Chrome sering menyimpan `.aab.crdownload`). Hapus, unduh ulang dari halaman rilis `aab-11`, cek lagi dengan `shasum -a 256 -c SHA256SUMS.txt`.

## 7. Yang masih menahan rilis (di luar urusan unggah)

| # | Butir | Milik |
|---|---|---|
| 1 | Daftar penguji Alpha (≥ 12 orang) + "Send for review" untuk app Pelanggan | Erza |
| 2 | Rilis draf + unggah `antarkita-mitra-v3.0.0-111.aab` untuk app Mitra | Erza |
| 3 | Secret `PLAY_SERVICE_ACCOUNT_JSON` (Bagian 5) dan `GOOGLE_SERVICES_JSON_BASE64` (push) | Erza |
| 4 | 2 akun uji reviewer (kata sandi di **App content → Sign in details**) + nama kota aktif | Erza |
| 5 | Centang IARC Terms of Use di Content rating; 3 deklarasi hukum app Mitra | Erza |
| 6 | Closed testing 12 penguji × 14 hari sebelum bisa mengajukan Production | Menunggu |

---

**Catatan keterbatasan data:** status Play Console (draf "111 (3.0.0)" tersimpan, catatan rilis terisi, penguji belum ada) dibaca dari layar Chrome sesi 18 Sep 2026, bukan dari Play Developer API. Kecocokan SHA256 diverifikasi terhadap `SHA256SUMS.txt` rilis `aab-11` pada berkas di `~/Downloads/AntarKita-AAB-111/`. Ukuran "± 101 MB" dibulatkan dari ringkasan workflow. Label tombol Play Console ("Send for review" vs "Start rollout") berubah tergantung status kuesioner App content dan bisa berbeda dari yang tertulis di sini. Nama peran "Release manager" mengikuti preset Play Console per Sep 2026; bila preset tidak muncul, pilih izin manual seperti di langkah 8.
