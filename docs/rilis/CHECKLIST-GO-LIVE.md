# Checklist Go-Live Play Store — AntarKita (Pelanggan & Mitra)

Panduan langkah demi langkah untuk pemilik (Erza). Kerjakan berurutan; tandai `[x]` yang selesai.
Referensi: `docs/rilis/PLAY-STORE-LISTING.md` (teks listing & jawaban form), `.github/workflows/release-aab.yml` (build AAB), `supabase/migrations/0023_hapus_akun.sql` (hapus akun).

> **Mau mengejar listing besok?** Baca **`docs/rilis/RUNBOOK-LISTING-BESOK.md`** lebih dulu — di sana ada urutan langkah dengan estimasi waktu, titik-titik tunggu yang tidak bisa dipercepat, dan hitungan jujur berapa hari sampai aplikasi bisa diunduh publik (**± 18–30 hari**, bukan besok). Berkas ini tetap menjadi checklist lengkapnya.

> **Jangan pernah** menyimpan keystore, kata sandi, atau file JSON service account di dalam repo. Semua lewat GitHub Secrets.

---

## A. Persiapan sekali (± 1 jam)

### A1. Akun & biaya
- [ ] Buat akun **Google Play Console** (https://play.google.com/console) — biaya pendaftaran sekali US$25. Untuk akun *organisasi* siapkan D-U-N-S number (gratis, proses 1–2 minggu) — bila belum ada, daftar sebagai perorangan dulu (bisa dipindah nanti).
- [ ] Verifikasi identitas developer (KTP + selfie) dan alamat email `erzamadana@gmail.com`; nomor HP aktif.
- [ ] Akun developer perorangan baru wajib **uji tertutup 12 penguji selama 14 hari** sebelum boleh rilis produksi — siapkan 12 email penguji (teman/keluarga/mitra awal) sejak sekarang.

### A2. Upload keystore (buat di laptop, sekali seumur hidup aplikasi)
Jalankan di terminal (butuh JDK 17 — `brew install temurin@17` / `sudo apt install openjdk-17-jdk`):

```bash
keytool -genkeypair -v \
  -keystore antarkita-upload.jks \
  -alias antarkita-upload \
  -keyalg RSA -keysize 4096 -validity 10000 \
  -dname "CN=AntarKita, OU=Mobile, O=AntarKita, L=Jakarta, ST=DKI Jakarta, C=ID"
```
- Diminta **kata sandi keystore** dan **kata sandi key** → boleh sama; pakai ≥16 karakter, simpan di password manager.
- Satu keystore ini dipakai untuk **kedua** aplikasi (Pelanggan & Mitra) — Play mengelola signing key produksi masing-masing lewat *Play App Signing*.
- [ ] Simpan `antarkita-upload.jks` + kata sandi di **dua** tempat aman (password manager + drive terenkripsi). Hilang = tidak bisa update aplikasi (bisa reset lewat Play tapi butuh proses verifikasi).

Konversi ke base64 untuk GitHub Secret:
```bash
# macOS / Linux
base64 -i antarkita-upload.jks | tr -d '\n' > antarkita-upload.b64      # macOS
base64 -w0 antarkita-upload.jks > antarkita-upload.b64                   # Linux
# Windows PowerShell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("antarkita-upload.jks")) | Set-Content antarkita-upload.b64
```

### A3. GitHub Secrets
Repo → **Settings → Secrets and variables → Actions → New repository secret**:

| Nama secret | Isi |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | isi file `antarkita-upload.b64` (satu baris panjang) |
| `ANDROID_KEYSTORE_PASSWORD` | kata sandi keystore |
| `ANDROID_KEY_ALIAS` | `antarkita-upload` |
| `ANDROID_KEY_PASSWORD` | kata sandi key |
| `GOOGLE_SERVICES_JSON_BASE64` | *(opsional secara teknis — **tanpa ini push notification MATI TOTAL di build Play**)* isi `google-services.json` dari Firebase Console, di-base64. Satu berkas harus memuat **kedua** package; workflow menggagalkan build bila tidak. |
| `PLAY_SERVICE_ACCOUNT_JSON` | *(opsional, nanti di langkah C4)* isi file JSON service account |

- [ ] Empat secret pertama terisi. Hapus file `.b64` dari laptop setelahnya.
- [ ] `GOOGLE_SERVICES_JSON_BASE64` terisi — kalau dilewati, sadari bahwa pesanan masuk, chat, dan panggilan **tidak akan memunculkan notifikasi** saat aplikasi tertutup, dan build tetap sukses tanpa pesan error (hanya `::warning::` di log).

### A4. Versi & konfigurasi kode (sudah disiapkan — cukup dicek)
- [ ] `package.json` → `"version": "3.0.0"` = versionName yang tampil di Play. Naikkan (mis. 3.0.1) setiap rilis ke produksi.
- [ ] `app.config.ts` → `ANDROID_VERSION_CODE_OFFSET = 100`; versionCode = nomor run workflow + 100, otomatis naik. **Jangan diturunkan** setelah pernah diunggah ke Play.
- [ ] Package id berbeda: `id.antarkita.app` (Pelanggan) dan `id.antarkita.mitra` (Mitra) — jangan diubah setelah rilis pertama.
- [ ] Ikon 1024×1024 di `apps/pelanggan/assets/icon.png` dan `apps/mitra/assets/icon.png` sudah final (Play menolak ikon placeholder).

---

## B. Bangun AAB lewat GitHub Actions (± 25 menit per aplikasi)

- [ ] Commit & push semua perubahan rilis ke `main` (workflow Web menerbitkan `/privacy/`, `/terms/`, dan **`/hapus-akun/`** — buka ketiganya dan pastikan bukan 404).
  - `/privacy/` dan `/terms/` **sudah terverifikasi hidup 9 Sep 2026**.
  - **`/hapus-akun/` baru dibuat dan belum pernah hidup** — halaman ini wajib ada sebelum mengisi Data safety.
- [ ] GitHub → **Actions → "Play Store AAB (rilis bertanda tangan)" → Run workflow** → `app: both`, `note: internal testing 1` → Run.
  - Atau buat tag: `git tag v3.0.0 && git push origin v3.0.0` (memicu build kedua aplikasi otomatis).
- [ ] Tunggu hijau. Periksa log langkah **"Verifikasi package id & versi"** (applicationId, versionCode, daftar izin) dan **"Verifikasi tanda tangan AAB"** (bukan `CN=Android Debug`).
- [ ] Unduh AAB dari **Releases → `aab-<nomor>`** (`antarkita-pelanggan-v3.0.0-<code>.aab`, `antarkita-mitra-v3.0.0-<code>.aab`). Cocokkan `SHA256SUMS.txt`.

Jika gagal:
- *"Secret belum di-set"* → ulangi A3.
- *"Kata sandi/alias keystore tidak cocok"* → periksa `ANDROID_KEY_ALIAS` / kata sandi.
- Gradle out-of-memory → jalankan ulang (sudah `-Xmx4g`); bila berulang, build satu aplikasi per run (`app: pelanggan`).
- *"applicationId ≠ ..."* → `META` di `app.config.ts` berubah; kembalikan.

---

## C. Play Console — buat dua aplikasi

Ulangi C1–C3 untuk **AntarKita** (Pelanggan) dan **AntarKita Mitra**.

### C1. Create app
- [ ] **Create app** → Nama sesuai `PLAY-STORE-LISTING.md`, bahasa default **Indonesian (id-ID)**, App, Free. Centang deklarasi kebijakan.

### C2. Internal testing (unggah AAB pertama)
- [ ] **Testing → Internal testing → Create new release**.
- [ ] Saat diminta: **Play App Signing → "Use Google-generated key"** (default) → lanjut. (Play membuat kunci produksi; AAB kita ditandatangani upload key.)
- [ ] Unggah AAB, *Release name* otomatis, *Release notes* (id-ID): `Rilis awal AntarKita: AntarRide, AntarCar, AntarFood, AntarSend, AntarBox, AntarShop, AntarMarket, AntarTravel, AntarPay.`
- [ ] **Testers** → buat daftar email penguji (≥12 untuk akun baru) → simpan → **Review release → Start rollout to Internal testing**.
- [ ] Bagikan tautan *"Copy link"* ke penguji; instal dan uji alur inti (daftar → pesan → bayar → selesai; mitra: online → terima → selesai; hapus akun dengan akun uji).
- [ ] **Target API level — sudah diverifikasi, tidak perlu khawatir.** `targetSdkVersion = 36` (Android 16), dibaca dari katalog versi React Native 0.86 yang dipakai Expo SDK 57 (`node_modules/react-native/gradle/libs.versions.toml`), diverifikasi 9 Sep 2026 dari hasil `expo prebuild` yang sebenarnya. Sejak **31 Agustus 2026** Google mewajibkan **API 36** untuk aplikasi baru — syarat ini **terpenuhi**. Workflow AAB sekarang menggagalkan build bila nilainya turun di bawah 36.

### C3. Isi Store listing & App content (sebelum bisa ke produksi)
Semua jawaban ada di `PLAY-STORE-LISTING.md`:
- [ ] **Main store listing**: nama, deskripsi singkat, deskripsi lengkap, ikon 512×512, feature graphic 1024×500, ≥2 screenshot ponsel, kategori, tag, email kontak, situs web.
- [ ] **App content → Privacy policy**: `https://erzamadana-ui.github.io/antarkita/privacy/`.
- [ ] **App content → App access**: akun uji reviewer (buat khusus di Supabase produksi; untuk Mitra pakai driver yang sudah *approved*).
- [ ] **App content → Ads**: Tidak ada iklan.
- [ ] **App content → Content rating**: kuesioner IARC (jawaban di listing §4.4) → sertifikat terbit otomatis.
- [ ] **App content → Target audience**: 18+.
- [ ] **App content → News / COVID / Government**: Tidak.
- [ ] **App content → Data safety**: isi tabel §4.7, sertakan URL hapus akun **`https://erzamadana-ui.github.io/antarkita/hapus-akun/`** (halaman khusus; **jangan** pakai `.../privacy/#hapus` — Google menuntut jalur permintaan yang menonjol di halamannya sendiri).
- [ ] **App content → Financial features**: Digital wallet (closed-loop) + teks §4.8; unggah bukti akun Midtrans bila diminta.
- [ ] **App content → Advertising ID**: tidak dipakai.
- [ ] **App content → Health / Government**: tidak berlaku.
- [ ] **Store settings**: kategori & tag; **Countries**: Indonesia.
- [ ] **App content → User generated content / Safety**: AntarKita punya chat, panggilan suara, ulasan, dan foto merchant → kebijakan UGC berlaku penuh. Kebijakan mewajibkan **pelaporan di dalam aplikasi** *dan* **fungsi memblokir pengguna**; **fungsi blokir belum ada** di kode. Baca `PLAY-STORE-LISTING.md` §4.11 sebelum menjawab. Aman untuk Internal testing; **perbaiki sebelum mengajukan akses produksi**.
- [ ] Dasbor menunjukkan semua tugas "App content" ✔ tanpa peringatan merah.

### C4. (Opsional) Unggah otomatis dari GitHub ke track internal
- [ ] Google Cloud Console → proyek baru → **APIs & Services → Enable "Google Play Android Developer API"**.
- [ ] **IAM → Service accounts → Create** (`play-publisher`) → **Keys → Add key → JSON** → unduh.
- [ ] Play Console → **Users and permissions → Invite new users** → email service account → izin **"Release to testing tracks"** + akses ke kedua aplikasi (App permissions).
- [ ] GitHub Secret `PLAY_SERVICE_ACCOUNT_JSON` = isi file JSON. Hapus file dari laptop.
- [ ] Jalankan workflow lagi → langkah "Unggah ke Play Console (internal testing)" aktif otomatis. (Aplikasi harus sudah pernah dibuat di Play Console dan minimal satu AAB diunggah manual sebelumnya — syarat API.)

### C5. Closed testing → Production
- [ ] **Testing → Closed testing → Create track/rilis** (promosi dari internal). Akun perorangan baru: ≥12 penguji opt-in, **14 hari** berturut-turut, lalu ajukan **"Apply for production access"** (jawab kuesioner tentang hasil uji).
- [ ] Setelah akses produksi disetujui: **Production → Create new release** → promosikan AAB yang sama (atau build baru dengan `version` dinaikkan) → **Release notes** → **Review → Start rollout** (mulai *staged rollout* 20% → 50% → 100%).
- [ ] Review Google 1–7 hari. Balas cepat bila ada pertanyaan (biasanya soal Financial features / akun uji).
- [ ] Setelah live: pasang badge "Get it on Google Play" di landing web, perbarui `EXPO_PUBLIC_APK_URL` bila ingin mengarahkan ke Play, dan pertimbangkan menonaktifkan workflow APK debug-key untuk publik.

---

## D. Pengerasan Supabase produksi (kerjakan sebelum C5)

### D1. Basis data & RLS
- [ ] Terapkan migrasi terbaru: `supabase db push` (termasuk `0023_hapus_akun.sql` — **belum diterapkan**, lihat catatan di bawah).
- [ ] Jalankan **Database → Advisors → Security** (atau MCP `get_advisors`): pastikan **0** tabel `public` tanpa RLS, tidak ada policy `using (true)` untuk `anon` pada tabel sensitif (`profiles`, `wallets`, `driver_documents`, `gateway_secrets`, `bank_accounts`).
- [ ] Uji cepat sebagai `anon` (tanpa login) lewat REST: `GET /rest/v1/profiles` harus kosong/403.
- [ ] Pastikan `gateway_secrets` **tidak** punya policy (hanya service role) dan Edge Function Midtrans memakai `SUPABASE_SERVICE_ROLE_KEY` dari secrets, bukan hardcode.
- [ ] Matikan trigger `on_auth_user_autoconfirm` (`0001_schema.sql`) di produksi bila verifikasi email diaktifkan: `drop trigger if exists on_auth_user_autoconfirm on auth.users;`.
- [ ] Bucket Storage: `avatars` publik-baca, bucket dokumen KYC (`documents`/`kyc`) **privat** dengan policy hanya pemilik + admin; batasi ukuran unggah (≤5 MB) dan tipe MIME gambar/PDF.

### D2. Auth
- [ ] **Authentication → Providers → Email**: aktifkan *Confirm email*; *Secure email change* on; minimal panjang kata sandi 8; aktifkan *Leaked password protection*.
- [ ] **Authentication → Email Templates**: ganti teks ke Bahasa Indonesia dengan nama AntarKita (Confirm signup, Magic link, Reset password, Change email). Sertakan tautan Kebijakan Privasi.
- [ ] **Authentication → URL Configuration**: Site URL `https://erzamadana-ui.github.io/antarkita/`; Redirect URLs: `https://erzamadana-ui.github.io/antarkita/**`, `antarkita://**`, `antarkitamitra://**`, `antarkitaadmin://**`.
- [ ] **Custom SMTP** (Project Settings → Auth → SMTP): pakai Resend/Brevo/Mailgun/SES dengan domain sendiri (`noreply@antarkita.id`) — SMTP bawaan Supabase dibatasi ±3 email/jam dan tidak cocok untuk produksi. Set SPF/DKIM/DMARC di DNS.
- [ ] **Rate limits** (Auth → Rate Limits): sign-up & OTP per IP ≤ 30/jam, token refresh default, aktifkan **CAPTCHA (Turnstile/hCaptcha)** untuk sign-up/login web.
- [ ] Hapus semua akun uji/dummy dari seed (`supabase/seed.sql`) di proyek produksi; pastikan tidak ada admin dengan kata sandi default.
- [ ] Pastikan minimal **dua** akun admin (`profiles.role = 'admin'`) dengan email berbeda + MFA (Auth → MFA aktifkan TOTP; panel admin sudah mendukung `admin_security`).

### D3. Ketersediaan & cadangan
- [ ] Paket **Pro** minimal untuk produksi (backup harian 7 hari, tanpa auto-pause).
- [ ] Aktifkan **Point-in-Time Recovery (PITR)** (add-on) → pemulihan ke detik tertentu; uji restore sekali ke proyek staging.
- [ ] Compute add-on sesuai beban (Small cukup untuk ≤ 1.000 pesanan/hari); aktifkan **connection pooler** (Supavisor, mode transaction) untuk Edge Functions.
- [ ] Region: `ap-southeast-1` (Singapura) — terdekat dengan Indonesia. Catat di Kebijakan Privasi bila berubah.
- [ ] **Log & alert**: Project Settings → Integrations → kirim log ke Logflare/Datadog atau minimal aktifkan email alert *Resource exhaustion*; pantau `security_events` dan `fraud_flags` dari panel admin.
- [ ] Jadwalkan `pg_cron` yang sudah ada (otomasi tahap 7: retention/pricing/payout) — verifikasi jalan di produksi (`select * from cron.job;`).

### D4. Edge Functions & Midtrans
- [ ] `supabase secrets set MIDTRANS_SERVER_KEY=… MIDTRANS_CLIENT_KEY=… MIDTRANS_IS_PRODUCTION=true` (kunci **produksi**, bukan sandbox) atau isi lewat panel Admin → Payment Gateway.
- [ ] Daftarkan URL webhook produksi di dashboard Midtrans (Settings → Configuration → Payment Notification URL) → `https://<project-ref>.supabase.co/functions/v1/midtrans-webhook`; uji satu transaksi Rp10.000 nyata lalu refund.
- [ ] Verifikasi tanda tangan webhook (signature key SHA-512) aktif di fungsi; tolak request tanpa signature.
- [ ] Batasi CORS Edge Functions ke origin GitHub Pages + skema aplikasi.

### D5. Domain & URL hukum
- [ ] (Direkomendasikan) Beli domain `antarkita.id` / `antarkita.co.id` → GitHub Pages **Custom domain** (`www.antarkita.id`, CNAME ke `erzamadana-ui.github.io`, aktifkan *Enforce HTTPS*). Setelah itu:
  - [ ] Set `EXPO_PUBLIC_SITE_ROOT=https://www.antarkita.id` dan `EXPO_PUBLIC_BASE_URL=` (kosong) di workflow Web & AAB, lalu build ulang.
  - [ ] Perbarui URL privasi di Play Console → `https://www.antarkita.id/privacy/` (URL lama tetap hidup selama repo Pages ada; jangan hapus).
  - [ ] Pakai domain yang sama untuk email transaksional (SMTP) dan kontak dukungan (`halo@antarkita.id` diteruskan ke Gmail).
- [ ] Sampai domain ada, URL resmi: `https://erzamadana-ui.github.io/antarkita/privacy/` dan `/terms/` — pastikan keduanya terbuka **tanpa** redirect ke aplikasi (dicek: file statis ada di `dist/privacy/index.html`, 404.html tidak menyentuhnya).

---

## E. Migrasi hapus akun (0023) — **status BERTENTANGAN, verifikasi sebelum apa pun**

> ⚠️ **Konflik dokumen (ditemukan 9 Sep 2026).** Berkas ini menandai `0023_hapus_akun.sql` **belum diterapkan**, sementara `docs/RENCANA-LISTING-LIVE.md` menyatakan "Migrasi 0001–0024 diterapkan". Keduanya tidak bisa benar sekaligus. Ini bukan detail administratif: Google **selalu** menguji tombol hapus akun, dan bila RPC-nya tidak ada di database produksi, tombol itu error dan aplikasi **hampir pasti ditolak**.
>
> Jalankan di SQL Editor Supabase **produksi** sebelum mengisi App access:
> ```sql
> select proname from pg_proc where proname = 'request_account_deletion';
> ```
> Kosong → terapkan migrasi di bawah, lalu uji sungguhan dengan akun dummy.

```bash
supabase db push            # atau: supabase migration up
# atau tempel isi supabase/migrations/0023_hapus_akun.sql di SQL Editor dashboard
```
Setelah diterapkan, uji dengan akun dummy:
1. Akun dengan saldo AntarPay > 0 → harus ditolak dengan pesan "Saldo AntarPay Anda masih Rp…".
2. Akun dengan pesanan aktif → ditolak "Masih ada N pesanan aktif".
3. Akun bersih → sukses, otomatis keluar, login ulang gagal (banned), baris `profiles` berubah jadi "Pengguna Terhapus", muncul di `audit_logs` (`profile.deletion_requested`) dan `security_events` (`account.delete_request`).
4. Admin: `select * from admin_list_deletion_requests();` → setelah 30 hari jalankan `select admin_finalize_account_deletion('<uuid>');` (bisa dijadwalkan lewat `pg_cron` bila ingin otomatis).

---

## F. Setelah live — rutin
- [ ] Setiap rilis: naikkan `version` di `package.json` → tag `vX.Y.Z` → workflow AAB → promosikan internal → produksi (staged).
- [ ] Pantau **Play Console → Policy status** & email dari Google Play (deadline target API tiap Agustus).
- [ ] Perbarui **Data safety** setiap kali menambah jenis data/SDK baru.
- [ ] Tinjau ulang Kebijakan Privasi & S&K setidaknya setahun sekali; ubah tanggal versi di `docs/rilis/privacy.html` & `terms.html`.
- [ ] Simpan cadangan keystore dan rotasi kata sandi service account setahun sekali.


## Lupa kata sandi (verifikasi email)
- [ ] Authentication → URL Configuration: Site URL `https://erzamadana-ui.github.io/antarkita/`; Redirect URLs berisi `…/antarkita/`, `…/antarkita/mitra/`, `…/antarkita/admin/`, `…/antarkita/**`.
- [ ] Email Templates → Reset Password: pakai template Bahasa Indonesia + `{{ .Token }}` (lihat `docs/LUPA-KATA-SANDI.md`).
- [ ] Custom SMTP aktif sebelum produksi (SMTP bawaan Supabase hanya untuk uji, kuota beberapa email/jam).
