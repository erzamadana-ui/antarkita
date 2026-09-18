# Daftar Periksa Final — Kesiapan Android AntarKita

> Verifikasi ulang menyeluruh, **9 September 2026**. Setiap baris di bawah **dibuktikan dari berkas/kode
> nyata**, bukan dari dokumen lain. Kolom bukti menyebut berkas dan cara mengecek ulangnya sendiri.
>
> Legenda: **✅ selesai** · **⏳ menunggu pemilik** (butuh akun/kunci yang hanya boleh dipegang Erza) ·
> **❌ belum, perlu perubahan kode/aset**
>
> Diurutkan menurut **apa yang memblokir rilis lebih dulu**. Kerjakan dari atas.
>
> **Pembaruan 15 Sep 2026 (domain kustom):** web pindah ke `https://apps.antarkitaindonesia.com/` (base path `/`). Butir 2.1 dan 4.2 di bawah **sudah selesai**: fallback `Safety.tsx`/`app.ts` kini `https://apps.antarkitaindonesia.com`, `EXPO_PUBLIC_SITE_URL` diisi di `release-aab.yml` & `android.yml`, `seed.sql` menunjuk `https://apps.antarkitaindonesia.com/promos/…`. URL lama `erzamadana-ui.github.io/antarkita/…` tetap hidup sebagai alias (pengalihan otomatis GitHub). Nomor baris yang dikutip di bawah adalah nomor pada 9 Sep 2026.
>
> **Pembaruan 17–18 Sep 2026 (Play Console & basis data):** Play Console **sudah aktif** untuk kedua aplikasi (`id.antarkita.app` & `id.antarkita.mitra`); AAB `111` (3.0.0) sudah dibangun, diunduh, dan tersimpan sebagai rilis draf *Closed testing – Alpha* app Pelanggan. Migrasi `0089`–`0095` **sudah diterapkan ke produksi**. Rincian per butir ada di **Blok 5** (baru) dan pada baris Blok 1–3 yang diberi tanggal. Yang masih menahan pengajuan review: akun uji + kata sandi (Sign in details), secret `PLAY_SERVICE_ACCOUNT_JSON`, secret `GOOGLE_SERVICES_JSON_BASE64`, dan daftar 12 penguji.

---

## Blok 1 — Tanpa ini tidak ada yang bisa diunggah sama sekali

| # | Butir | Status | Bukti / cara verifikasi |
|---|---|---|---|
| 1.1 | Akun Google Play Console (US$25) + verifikasi identitas | ✅ **(17 Sep 2026)** | Hanya pemilik. `CHECKLIST-GO-LIVE.md` §A1. **Sudah aktif**: kedua aplikasi (`id.antarkita.app`, `id.antarkita.mitra`) ada di Play Console dan dasbor deklarasinya bisa diisi (lihat Blok 5) |
| 1.2 | Upload keystore dibuat & 4 GitHub Secret terisi (`ANDROID_KEYSTORE_BASE64`, `..._PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`) | ✅ **(17 Sep 2026)** | `release-aab.yml` langkah "Pastikan rahasia keystore tersedia" **menggagalkan build** bila kosong — dan build **lolos**: AAB `111` dibangun di run **#11** (commit `32faba4`), rilis GitHub `aab-11`, sudah diunduh ke Mac Erza dan diterima Play Console sebagai rilis draf `111 (3.0.0)`. Keystore terbukti valid karena Play menerima berkasnya |
| 1.3 | Migrasi `0023_hapus_akun.sql` **dan** `0050_moderasi_ugc_lapor_blokir.sql` diterapkan di Supabase **produksi** | ⏳ | `select proname from pg_proc where proname in ('request_account_deletion','report_content','block_user');` → harus 3 baris. **Google selalu menguji tombol hapus akun dan jalur lapor/blokir.** Dokumen internal masih bertentangan soal ini (`RENCANA-LISTING-LIVE.md` vs `CHECKLIST-GO-LIVE.md` §E) — percayai hasil kueri, bukan dokumen |

## Blok 2 — Membuat aplikasi ditolak reviewer, atau fitur mati diam-diam

| # | Butir | Status | Bukti / cara verifikasi |
|---|---|---|---|
| 2.1 | **Tautan "Bagikan perjalanan" rusak di build Android** | ❌ | `src/lib/app.ts:20` memakai fallback `…/antarkita` (benar), tetapi `src/components/Safety.tsx:18` memakai fallback lama **`https://erzamadana-ui.github.io/antar-aja`**. `release-aab.yml` mengisi `EXPO_PUBLIC_SITE_ROOT` tetapi **tidak** `EXPO_PUBLIC_SITE_URL`, jadi di AAB fallback itulah yang dipakai → tautan berbagi perjalanan **404**. Nama repo yang benar adalah `antarkita` (`git remote -v`). **Perbaikan (di `src/`, di luar wewenang agen ini): ganti fallback ke `…/antarkita`, atau tambahkan `EXPO_PUBLIC_SITE_URL` ke env di `release-aab.yml`.** Fitur keselamatan yang dipromosikan di listing tidak boleh menghasilkan 404 |
| 2.2 | Secret `GOOGLE_SERVICES_JSON_BASE64` (Firebase) | ⏳ **masih kosong (18 Sep 2026)** | Tanpa ini AAB **tetap sukses dibangun** tetapi tidak ada token FCM → **seluruh notifikasi push mati** di rilis Play. `release-aab.yml` hanya memberi `::warning::`, bukan error — kegagalannya senyap. Berkas harus memuat `id.antarkita.app` **dan** `id.antarkita.mitra` (workflow memeriksa ini). **Status 18 Sep:** AAB `111` (run #11) dibangun **tanpa** secret ini → push notification **mati** di build tersebut. Menunggu Erza mengisi secret, lalu bangun ulang AAB sebelum dikirim ke penguji |
| 2.3 | Secret Supabase `FCM_SERVICE_ACCOUNT` + `admin_set_push_config(url, service_role_key)` | ⏳ | `docs/PUSH-NOTIFICATION.md` §3. Tanpa keduanya `push-send` menandai antrean `skipped` — push tetap mati walau 2.2 sudah diisi |
| 2.4 | **Server TURN untuk panggilan suara** | ❌ | `src/lib/call.ts:44-45`: `ICE` hanya berisi dua STUN Google; blok TURN hanya masuk bila `EXPO_PUBLIC_TURN_URL` terisi — dan variabel itu **tidak diset di mana pun** (bukan di `.env`, bukan di `release-aab.yml`). Akibatnya di jaringan seluler Indonesia (CGNAT ≈ symmetric NAT) `connectionState` menjadi `failed` → `src/lib/call.ts:176` menutup panggilan dengan "Koneksi gagal. Periksa jaringan." Rincian & biaya penyedia: §Lampiran A |
| 2.5 | Kunci produksi Midtrans + URL webhook produksi | ⏳ | `CHECKLIST-GO-LIVE.md` §D4. Play menanyakan bukti pada deklarasi *Financial features*. **(18 Sep 2026)** Sisi server sudah siap menyusul: migrasi `0089_saluran_bayar_toggle.sql` menambah sakelar per metode bayar dan edge function `midtrans-create` **v4** memanggil `payment_channel_enabled` (`supabase/functions/midtrans-create/index.ts:64,69`) sebelum membuat transaksi — saluran yang belum siap bisa dimatikan tanpa build ulang |
| 2.6 | Akun uji untuk reviewer (App access) — pelanggan bersaldo & driver berstatus *approved* | ⏳ **menunggu Erza (18 Sep 2026)** | `PLAY-STORE-LISTING.md` §4.3. Reviewer menolak aplikasi yang tidak bisa dimasuki. **Status 18 Sep:** belum ada akun uji khusus + kata sandi untuk diisi ke *App access → Sign in details* di **kedua** app. Untuk app Mitra ini **pemblokir berantai**: Sign in details → Target audience → submit Data safety (lihat 5.8) |
| 2.7 | Pengerasan Supabase produksi (RLS advisors 0 temuan, confirm-email, SMTP kustom, PITR, hapus akun demo dari seed) | ⏳ | `CHECKLIST-GO-LIVE.md` §D1–D3 |

## Blok 3 — Konten listing (semua sudah bisa diisi hari ini)

| # | Butir | Status | Bukti / cara verifikasi |
|---|---|---|---|
| 3.1 | `versionCode` naik otomatis tiap build | ✅ | `app.config.ts`: `versionCode = ANDROID_VERSION_CODE ?? GITHUB_RUN_NUMBER + 100 ?? 1`. `release-aab.yml` mengisi `ANDROID_VERSION_CODE = run_number + offset` dan **memverifikasi** hasilnya di `build.gradle`. Diuji: `APP=pelanggan ANDROID_VERSION_CODE=207 npx expo config` → `versionCode: 207`. **(18 Sep 2026)** Terbukti nyata: run #11 → `versionCode 111`, diterima Play Console sebagai `111 (3.0.0)` |
| 3.2 | `versionName` masuk akal untuk rilis pertama | ✅ | `3.0.0` dari `package.json`, satu sumber kebenaran; terbaca di `build.gradle` hasil prebuild. Angka 3.x mencerminkan 3 tahap pengembangan internal — sah dan tidak menimbulkan pertanyaan di Play |
| 3.3 | Izin manifest = persis yang dijanjikan dokumen | ✅ | Dijalankan ulang `npx expo prebuild --platform android --no-install` (pelanggan **dan** mitra), lalu manifest dibaca langsung. **13 izin aktif**: `ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION`, `CAMERA`, `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS`, `INTERNET`, `ACCESS_NETWORK_STATE`, `VIBRATE`, `WAKE_LOCK`, `POST_NOTIFICATIONS`, `BLUETOOTH`, `READ_EXTERNAL_STORAGE` (maxSdk 32), `WRITE_EXTERNAL_STORAGE` (maxSdk 32). **7 diblokir** dengan `tools:node="remove"`: `ACCESS_BACKGROUND_LOCATION`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION`, `SYSTEM_ALERT_WINDOW`, `READ_MEDIA_IMAGES`, `READ_MEDIA_VIDEO`, `AD_ID`. **Cocok 100%** dengan `PLAY-STORE-LISTING.md` §4.9. Folder `android/` sudah dihapus lagi dan `package.json` dikembalikan |
| 3.4 | `targetSdkVersion` ≥ 36 (syarat Play sejak 31 Agu 2026) | ✅ | `node_modules/react-native/gradle/libs.versions.toml`: `targetSdk = "36"`, `compileSdk = "36"`, `minSdk = "24"`. `release-aab.yml` menggagalkan build bila turun |
| 3.5 | Ikon adaptif & splash | ✅ | `adaptive-icon.png` 1024×1024 RGBA dan `splash-icon.png` 512×512 RGBA untuk ketiga aplikasi; hasil prebuild berisi `mipmap-anydpi-v26/ic_launcher.xml` + `drawable-*/splashscreen_logo.png` di 5 kerapatan |
| 3.6 | **Ikon notifikasi 96×96 putih transparan** | ✅ **dibuat hari ini** | `apps/{pelanggan,mitra,admin}/assets/notification-icon.png` — 96×96 RGBA, **satu warna non-transparan saja: putih murni**, 19% piksel tampak. Skrip: `docs/rilis/aset/buat-ikon-notifikasi.py`. Didaftarkan di `app.config.ts` plugin `expo-notifications` (`icon:`). Diverifikasi dari hasil prebuild: `res/drawable-{m,h,x,xx,xxx}dpi/notification_icon.png` (24/36/48/72/96 px) + `meta-data … default_notification_icon` untuk expo **dan** Firebase |
| 3.7 | Ikon 512×512 & feature graphic 1024×500 | ✅ | Diukur ulang dengan PIL: `ikon-512-{pelanggan,mitra}.png` = 512×512 **RGB tanpa alfa** (Play menolak alfa pada app icon), `feature-graphic-{pelanggan,mitra}.png` = 1024×500 RGB. Semua ≤ 70 KB. **Tidak ada yang perlu diperbaiki** |
| 3.8 | Screenshot ponsel ≥2 per aplikasi | ⚠️ **DRAF — dibuat hari ini** | 8 berkas 1080×1920 (tepat 9:16) di `docs/rilis/aset/screenshot/`: 5 Pelanggan + 3 Mitra. Semua lolos spek Play (sisi terpendek ≥320, terpanjang ≤3840, PNG ≤8 MB). **Bukan tangkapan HP asli** — lihat §Lampiran B untuk penilaian jujur dan apa yang harus diganti |
| 3.9 | Halaman `/privacy/`, `/terms/`, `/hapus-akun/` benar-benar dibangun | ✅ | `.github/workflows/web.yml`: `scripts/build-web.mjs` menyalin privacy & terms, langkah tersendiri menyalin `hapus-akun.html`, lalu langkah "Pastikan halaman hukum wajib benar-benar ada" **menggagalkan deploy** bila salah satu `dist/<p>/index.html` kosong. `dist/404.html` (SPA fallback) tidak menyentuh ketiga path itu karena berkasnya ada secara fisik |
| 3.10 | Isi halaman hukum konsisten dengan fitur terbaru | ✅ **diperbarui hari ini** | Celah yang ditemukan: migrasi `0050` (kemarin) menambah data pribadi baru — **laporan moderasi & daftar blokir** — yang **tidak disebut sama sekali** di kebijakan privasi. Kebijakan privasi yang tidak menyebut data yang benar-benar dikumpulkan adalah alasan penolakan. Diperbaiki: `privacy.html` → v1.1 (baris data moderasi di §2, tujuan pemrosesan di §6, pihak penerima di §7, masa simpan di §9); `terms.html` → v1.1 (konten seksual/spam/ujaran kebencian/ulasan palsu ditambahkan ke §8; sub-bagian baru "Melaporkan dan memblokir pengguna" di §9 + entri daftar isi); `hapus-akun.html` (baris daftar blokir & laporan moderasi di tabel penghapusan). Push notification, data lokasi, kontak darurat, KYC, dan panggilan **sudah** tercakup sebelumnya — sudah diperiksa ulang |
| 3.11 | Jawaban Data safety cocok dengan data yang dikumpulkan kode hari ini | ✅ **diperbarui hari ini** | Ditelusuri satu per satu: token push (`register_push_token` hanya mengirim `p_token`, `p_platform`, `p_app` — **tidak** ada model perangkat) → *Device or other IDs* ✔; lokasi presisi & perkiraan ✔; kontak darurat & NIK/SIM mitra → *Personal info → Other info* ✔; dokumen KYC → *Photos* + *Files and docs* ✔; audio panggilan **tidak** direkam ✔. **Yang kurang dan sudah ditambahkan:** rekaman laporan & blokir (`content_reports`, `user_blocks`) kini masuk baris *App activity → Other user-generated content* di `PLAY-STORE-LISTING.md` §4.7. **(18 Sep 2026)** Formulir Data safety app **Pelanggan sudah tersimpan** di Play Console; app **Mitra belum bisa disubmit** karena terkunci berantai di Sign in details (5.8) |
| 3.12 | Kuesioner UGC (lapor & blokir) | ✅ | Fungsi blokir **sudah ada** — `CHECKLIST-GO-LIVE.md` §C3 sebelumnya masih menulis "belum ada" (usang sejak commit `d211ba6`) dan **sudah diperbaiki**. Objek nyata di `0050`: `report_content`, `block_user`, `unblock_user`, `my_blocks`, `admin_list_reports`, `admin_resolve_report`, `driver_can_take`, `is_blocked_pair`, `nearby_drivers`, 3 trigger penegak blokir, tabel `content_reports` & `user_blocks`. Bukti tangkapan layar untuk formulir: `aset/screenshot/bukti-ugc-blokir.png` |
| 3.13 | Teks listing, IARC, Financial features, Advertising ID, kategori, negara | ✅ **diisi ke Play Console (18 Sep 2026)** | Siap salin di `PLAY-STORE-LISTING.md` §1–§4. **Status 18 Sep:** app Pelanggan — **semua 11 deklarasi selesai** ("You're all caught up"), Content rating IARC = **semua umur**, Target audience = **18+**, Data safety tersimpan. App Mitra — **6/9 selesai**, sisanya terkunci berantai (lihat 5.7–5.8) |

## Blok 4 — Konsistensi nama & kebersihan (tidak memblokir, tetapi membingungkan reviewer)

| # | Butir | Status | Bukti / cara verifikasi |
|---|---|---|---|
| 4.1 | Tidak ada "Antar Aja" yang **terlihat pengguna** | ✅ | Blok akun demo di layar masuk **dihapus seluruhnya** (12 Sep 2026) dan akun uji `@antaraja.id` dinonaktifkan di produksi (migrasi 0085); kata sandi uji tidak lagi ada di repositori |
| 4.2 | URL gambar promo di `seed.sql` menunjuk repo lama | ❌ | `supabase/seed.sql` baris 113–131: `https://erzamadana-ui.github.io/antar-aja/promos/…` sedangkan Pages ada di `/antarkita/promos/` → semua gambar promo **404**. Hanya data seed (dev), tetapi bila seed pernah dijalankan di produksi, promo tampil tanpa gambar. Berkas di luar wewenang agen ini (`supabase/`) |
| 4.3 | User-Agent geocoding memakai identitas lama | ❌ ringan | `src/lib/geo.ts:6`: `AntarAja/1.0 (support@antaraja.id)` — alamat email itu tidak ada. Kebijakan pemakaian Nominatim/OSM menuntut kontak yang valid; alamat mati bisa berujung pemblokiran IP. Ganti ke `AntarKita/1.0 (erzamadana@gmail.com)` |
| 4.4 | Kunci penyimpanan internal `antaraja.mode` / `antaraja.locale` / GUC `antaraja.bypass` / `https://antaraja.local/` | ✅ **jangan diubah** | Tidak terlihat pengguna. Mengganti kunci `AsyncStorage` akan **mereset preferensi semua pengguna lama**, dan mengganti GUC merusak trigger di migrasi `0007`. Biarkan apa adanya |

## Blok 5 — Pembaruan 17–18 Sep 2026: basis data, klien, dan Play Console

> Semua baris di blok ini ditambahkan **17–18 Sep 2026**. Migrasi `0089`–`0095` **sudah diterapkan ke produksi** dan
> berkasnya ada di `supabase/migrations/`. Hash commit bisa dicek dengan `git log --oneline -1 <hash>`.

| # | Butir | Status | Bukti / cara verifikasi |
|---|---|---|---|
| 5.1 | Migrasi `0089` — sakelar saluran bayar per metode | ✅ **produksi (17 Sep 2026)** | `supabase/migrations/0089_saluran_bayar_toggle.sql`. Dipakai edge function `midtrans-create` **v4** lewat RPC `payment_channel_enabled` (`supabase/functions/midtrans-create/index.ts:64` untuk `antarpay`, `:69` untuk metode yang dipilih) — saluran yang dimatikan admin ditolak di server, bukan hanya disembunyikan di klien |
| 5.2 | Migrasi `0090` — penarikan saldo hanya untuk mitra | ✅ **produksi (17 Sep 2026)** | `supabase/migrations/0090_tarik_saldo_hanya_mitra.sql`. Pelanggan tidak lagi bisa memanggil penarikan saldo; relevan untuk jawaban *Financial features* (saldo pelanggan = alat bayar, bukan dompet yang bisa dicairkan) |
| 5.3 | Migrasi `0091`–`0094` — impor 514 kabupaten/kota Kepmendagri | ✅ **produksi (17 Sep 2026)** | `0091_kota_indonesia_batch1.sql`, `0092_kota_indonesia_batch2.sql`, `0093_kota_indonesia_batch3.sql`, `0094_rapikan_kota_lama.sql`. Semua kota baru berstatus **`segera`**; **4 kota tetap aktif**: Batam, Dumai, Padang, Pekanbaru. Total `cities` = **526**. Cek: `select status, count(*) from cities group by status;` → aktif harus 4 |
| 5.4 | Migrasi `0095` — grant `fare_options` ke `anon` (**akar tombol pesan hilang**) | ✅ **produksi (18 Sep 2026)** | `supabase/migrations/0095_fare_options_boleh_anon.sql`, commit `32faba4`. Sebelumnya `fare_options` hanya boleh dipanggil peran terautentikasi; sesi anon/kedaluwarsa → tarif gagal → tombol pesan tidak dirender. Cek: `select has_function_privilege('anon','fare_options(…)','execute');` |
| 5.5 | Klien: tombol pesan **selalu tampil** + tombol **"Coba lagi"** saat tarif gagal (AntarRide/AntarCar/AntarBox) | ✅ **(18 Sep 2026)** | Commit `f8dae58` (`src/screens/ride/index.tsx:133` — `'Tarif gagal dimuat · Coba lagi'`, `onPress` menaikkan `fareTry`; petunjuk di `:172`) dan `1318207` (`src/screens/box/index.tsx:123`). Pengguna tidak lagi terjebak di layar tanpa tombol; bersama 5.4 menutup kasus "tombol pesan hilang" dari dua sisi |
| 5.6 | Klien: peta cadangan memakai **Stadia**, bukan endpoint OSM non-komersial | ✅ **(18 Sep 2026)** | Commit `2bec8c3`, `src/lib/mapConfig.ts` (`MapProvider` di `:20`, fallback `'stadia'` dijelaskan `:59-61`). Menutup risiko pelanggaran *usage policy* tile OSM yang disinggung di 4.3 & Lampiran C |
| 5.7 | Play Console app **Pelanggan** (`id.antarkita.app`) — deklarasi & rilis draf | ✅ **sebagian (18 Sep 2026)** | **Selesai:** 11/11 deklarasi ("You're all caught up"); Content rating IARC = **semua umur**; Target audience = **18+**; Data safety **tersimpan**; rilis draf **`111 (3.0.0)`** di *Closed testing – Alpha* **tersimpan**. **Belum:** daftar email penguji, syarat **12 penguji × 14 hari**, dan tombol **Send for review** belum ditekan |
| 5.8 | Play Console app **Mitra** (`id.antarkita.mitra`) — deklarasi | ⏳ **6/9 (18 Sep 2026)** | Tiga yang tersisa **terkunci berantai**: *App access → Sign in details* (butuh akun uji + kata sandi dari Erza, lihat 2.6) → *Target audience* → submit *Data safety*. Tidak ada yang bisa dikerjakan agen sampai akun uji tersedia |
| 5.9 | AAB `111` (3.0.0) dibangun & diunduh | ✅ **(18 Sep 2026)** | Workflow `release-aab.yml` run **#11**, commit `32faba4`, rilis GitHub **`aab-11`**; berkas sudah diunduh ke Mac Erza dan diunggah sebagai rilis draf app Pelanggan (5.7). **Catatan:** dibangun **tanpa** `GOOGLE_SERVICES_JSON_BASE64` → push mati di build ini (2.2) |
| 5.10 | Secret `PLAY_SERVICE_ACCOUNT_JSON` (unggah otomatis ke Play dari CI) | ⏳ **menunggu Erza (18 Sep 2026)** | Tanpa ini AAB harus diunggah manual lewat browser (seperti 5.9). Bukan pemblokir review, tetapi tiap build berikutnya butuh langkah manual |
| 5.11 | Daftar **12 penguji** untuk Closed testing | ⏳ **menunggu Erza (18 Sep 2026)** | Syarat akun perorangan baru: 12 penguji ikut serta **14 hari berturut-turut** sebelum boleh mengajukan produksi. Belum ada daftar email; belum ada *email list* dibuat di Play Console. Jam mulai hitung 14 hari = saat rilis Alpha **dipublikasikan** (bukan saat draf disimpan) |

---

## Lampiran A — TURN: klaim terverifikasi, dan berapa biayanya

**Klaim "panggilan suara gagal di jaringan seluler Indonesia tanpa TURN" — BENAR, terbukti dari kode:**

```ts
// src/lib/call.ts:44-45
const ICE = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' },
  ...(process.env.EXPO_PUBLIC_TURN_URL ? [{ urls: …TURN_URL, username: …TURN_USER, credential: …TURN_PASS }] : [])];
```

`EXPO_PUBLIC_TURN_URL` kosong → array ICE hanya berisi STUN. STUN hanya **memberi tahu** alamat publik;
ia tidak bisa merelai media. Pada NAT simetris — perilaku baku *carrier-grade NAT* operator seluler —
port publik berbeda untuk setiap tujuan, sehingga alamat hasil STUN tidak berguna bagi lawan bicara dan
UDP masuk umumnya diblokir. Hasilnya `pc.connectionState = 'failed'`, dan `src/lib/call.ts:176` menutup
panggilan dengan pesan "Koneksi gagal. Periksa jaringan." Sumber rujukan menyebut ini eksplisit:
*"Carrier-grade NAT on mobile operators behaves like a symmetric NAT and often blocks inbound UDP. Users
on cellular data are a common reason connections end up relayed"*, dengan proporsi sesi yang harus direlai
**"anything between 0 and 50 percent"** tergantung basis pengguna.

Panggilan sesama Wi-Fi rumah biasanya tetap tersambung — itulah sebabnya kegagalannya mudah terlewat saat
uji internal, lalu muncul massal setelah rilis.

**Pilihan penyedia (harga per September 2026):**

| Penyedia | Harga relai | Kuota gratis | Catatan untuk Indonesia |
|---|---|---|---|
| **Cloudflare Realtime TURN** | **US$0,05/GB** | **1.000 GB/bulan gratis** | Termurah jauh; STUN gratis tanpa batas; anycast global (PoP Jakarta & Singapura). **Rekomendasi utama** |
| **Metered (Open Relay)** | paket berbayar, harga per paket | **20 GB/bulan gratis** | Cukup untuk uji tertutup; rute otomatis ke server terdekat |
| **Twilio Network Traversal** | **US$0,60/GB** (Asia Pasifik: Singapura/Mumbai/Tokyo) | STUN gratis | 12× lebih mahal dari Cloudflare; dipakai bila sudah berlangganan Twilio |
| **coturn di VPS sendiri** | ~US$5–10/bulan VPS Singapura + biaya bandwidth | — | Kendali penuh, tetapi menambah beban operasional (TLS, kredensial berputar, pemantauan) |

**Perkiraan volume:** panggilan suara Opus ≈ 30–40 kbps dua arah ≈ **~0,3 MB per menit** yang direlai.
Bila 20% panggilan perlu relai dan ada 1.000 menit panggilan/hari → ~60 MB/hari ≈ **1,8 GB/bulan** —
masih **di dalam kuota gratis Cloudflare**. Biaya baru terasa di skala ratusan ribu menit per bulan.

**Cara memasang setelah kredensial ada** (tidak butuh perubahan kode — variabelnya sudah dibaca):
tambahkan `EXPO_PUBLIC_TURN_URL`, `EXPO_PUBLIC_TURN_USER`, `EXPO_PUBLIC_TURN_PASS` ke blok `env:` di
`.github/workflows/release-aab.yml` (nilainya dari GitHub Secrets) dan ke `.env` untuk build lokal.
⚠️ Kredensial TURN yang ditanam di aplikasi klien **bisa dibaca siapa pun** yang membongkar APK — pakai
kredensial berumur pendek (Cloudflare & Twilio sama-sama menyediakan API kredensial sementara) dan
pasang batas kuota, jangan kredensial statis permanen.

Sumber: [Cloudflare Realtime TURN FAQ](https://developers.cloudflare.com/realtime/turn/faq/) ·
[Twilio Network Traversal Pricing](https://www.twilio.com/en-us/stun-turn/pricing) ·
[Metered Open Relay](https://www.metered.ca/tools/openrelay/) ·
[bloggeek.me — TURN glossary](https://bloggeek.me/webrtcglossary/turn/)

---

## Lampiran B — Screenshot: apa yang dihasilkan dan seberapa layak dipakai

**Cara pembuatannya:** build web `dist/` disajikan di localhost, dibuka Chromium (Playwright) pada
viewport Pixel 7 (412×892 @3×) dengan seluruh panggilan `supabase.co` (REST + RPC + Auth) dilayani
harness data tiruan, lalu dibingkai jadi 1080×1920 dengan PIL (latar gradien merek + judul singkat).
Skrip pembingkai ikut disimpan: `docs/rilis/aset/bingkai-screenshot.py`; tangkapan mentahnya di
`docs/rilis/aset/screenshot/mentah/`.

**Yang berhasil (8 berkas, semua 1080×1920 = tepat 9:16):**

| Berkas | Isi | Penilaian |
|---|---|---|
| `pelanggan-1-beranda.png` | 8 layanan, promo AntarTravel, pesanan berjalan | **Kuat** — layar penjual terbaik |
| `pelanggan-2-ride.png` | AntarRide: kelas kendaraan, titik jemput, tujuan sering | Kuat |
| `pelanggan-3-ride-peta.png` | Pilih titik jemput di peta | Cukup — petanya paling terlihat "buatan" |
| `pelanggan-4-lacak.png` | Pelacakan: peta, kartu mitra, cocokkan plat, tip, bagikan perjalanan | **Kuat** — paling meyakinkan |
| `pelanggan-5-pay.png` | AntarPay: saldo, tunai/saldo/e-wallet Midtrans | **Kuat** |
| `mitra-1-beranda.png` | Sakelar Online, peta, "2 order tersedia" | **Kuat** |
| `mitra-2-order.png` | Pendapatan per trip, rute, potongan platform | Cukup — area peta agak kosong |
| `mitra-3-account.png` | Rating, layanan yang bisa diambil, kode AntarNow | Cukup |

**Yang sengaja TIDAK dipakai:** layar AntarFood — gambar merchant pada data tiruan memakai berkas promo
sehingga teksnya bertumpuk dan terlihat cacat. `bukti-ugc-blokir.png` (Akun → Pengguna diblokir) disimpan
terpisah sebagai lampiran formulir UGC, bukan untuk halaman listing (isinya *empty state*).

**Kejujuran soal kelayakan — ini DRAF:**

1. **Tidak ada status bar Android** (jam, sinyal, baterai). Tangkapan HP asli selalu punya; ketiadaannya
   adalah petunjuk paling kentara bahwa ini bukan dari perangkat.
2. **Peta bukan peta Padang yang sebenarnya.** Tile OpenStreetMap diblokir oleh egress proxy lingkungan
   build, jadi dibuat *basemap prosedural* (jalan/blok/sungai yang menyambung antar tile). Bila
   diperhatikan, kisi jalannya terlalu teratur untuk kota sungguhan.
3. **Data tiruan**: "Budi Santoso", "Ahmad Fauzi", saldo Rp250.000, plat BA 1234 AB, Rp21.000.
4. **Rendering React Native Web** berbeda tipis dari React Native di Android (jarak huruf, bayangan,
   perilaku *safe area*).

**Kesimpulan:** Google **tidak mewajibkan** screenshot berasal dari perangkat, dan berkas ini memenuhi
seluruh spesifikasi teknis Play. **Layak dipakai untuk mengisi listing dan Internal testing hari ini.**
**Ganti dengan tangkapan HP asli sebelum rilis produksi** — pasang APK dari workflow "Android APK",
jalankan alur yang sama, tekan Power + Volume Bawah, taruh hasilnya di `screenshot/mentah/` dengan nama
berkas yang sama, lalu jalankan `python3 docs/rilis/aset/bingkai-screenshot.py`. Judul dan bingkainya
otomatis mengikuti.

---

## Lampiran C — `EXPO_PUBLIC_*` yang dipakai kode: wajib, opsional, dan akibat bila kosong

| Variabel | Wajib? | Diisi dari | Akibat bila kosong |
|---|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | **WAJIB** | `.env` (ikut repo) | Aplikasi tidak bisa masuk sama sekali — layar putih/gagal login |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | **WAJIB** | `.env` | Sama seperti di atas |
| `EXPO_PUBLIC_APP` | **WAJIB** | diisi otomatis `app.config.ts` + `release-aab.yml` | Salah aplikasi yang dibangun (rute & package id tertukar) |
| `EXPO_PUBLIC_SITE_ROOT` | **WAJIB (sudah diisi)** | `release-aab.yml` & `android.yml` = `https://apps.antarkitaindonesia.com` | Fallback `src/lib/app.ts` sudah domain baru, jadi aman |
| `EXPO_PUBLIC_SITE_URL` | **WAJIB (sudah diisi, 15 Sep 2026)** | `release-aab.yml` & `android.yml` = `https://apps.antarkitaindonesia.com` | Fallback `Safety.tsx` juga sudah domain baru → tautan "Bagikan perjalanan" aman. Build ≤ 107 masih memakai github.io (tetap hidup lewat pengalihan) |
| `EXPO_PUBLIC_APK_URL` | Opsional | `release-aab.yml` baris 73 | Fallback `src/lib/app.ts:22` sudah benar. Aman |
| `EXPO_PUBLIC_BASE_URL` | Opsional (web) | `.env` / workflow web | Kosong = benar untuk Android |
| `EXPO_PUBLIC_TURN_URL` | **WAJIB untuk panggilan suara** | belum ada | **Panggilan suara gagal di jaringan seluler** (Lampiran A) |
| `EXPO_PUBLIC_TURN_USER` | ikut TURN_URL | belum ada | TURN diabaikan bila `TURN_URL` kosong |
| `EXPO_PUBLIC_TURN_PASS` | ikut TURN_URL | belum ada | Sama |
| `EXPO_PUBLIC_GOOGLE_MAPS_KEY` | Opsional | `.env` (kosong) | Kosong = pakai Photon/Nominatim/OSRM gratis. **Berfungsi**, tetapi tanpa SLA dan dibatasi *usage policy* OSM — pertimbangkan mengisi bila trafik naik |
| `EXPO_PUBLIC_DEMO_LOGIN` | **HARUS kosong di rilis** | hanya diisi `web.yml` | Bila kelak terisi `1` di build Play, kredensial akun demo tampil di layar login — jangan sampai |

---

## Ringkasan — apa yang MASIH memblokir rilis

> **Pembaruan 18 Sep 2026 — urutan pemblokir sekarang.** Butir 1 dan 3 di daftar lama di bawah **sudah selesai**
> (Play Console aktif, keystore terbukti dengan AAB `111`; `Safety.tsx` sudah domain baru sejak 15 Sep). Yang
> **masih menahan pengajuan review**, semuanya menunggu Erza:
>
> 1. **Akun uji khusus + kata sandi** untuk *App access → Sign in details* di **kedua** app (2.6, 5.8) — untuk Mitra
>    ini membuka rantai Target audience → Data safety.
> 2. **Secret `GOOGLE_SERVICES_JSON_BASE64`** (2.2) — AAB `111` dibangun tanpa ini, push mati; **bangun ulang**
>    setelah diisi, sebelum dikirim ke penguji.
> 3. **12 penguji** (email list di Play Console) lalu **publikasikan** rilis Alpha agar hitungan 14 hari mulai (5.11).
> 4. **Secret `PLAY_SERVICE_ACCOUNT_JSON`** (5.10) — bukan pemblokir review, tetapi tanpa ini tiap AAB diunggah manual.
> 5. Sisa dari daftar lama yang belum berubah: `FCM_SERVICE_ACCOUNT` + `admin_set_push_config` (2.3), TURN (2.4),
>    kunci produksi Midtrans (2.5), screenshot HP asli (3.8).

Daftar lama (9 Sep 2026), dipertahankan sebagai jejak:

1. **Akun & kunci pemilik** (Blok 1) — Play Console, keystore + 4 secret. Tidak ada AAB tanpa ini. **→ Selesai 17 Sep 2026** (1.1, 1.2, 5.9).
2. **Migrasi `0023` + `0050` di database produksi** — bila belum, tombol hapus akun dan lapor/blokir
   error saat diuji Google; keduanya **pasti** diuji.
3. **`Safety.tsx:18` menunjuk repo lama `antar-aja`** — tautan "Bagikan perjalanan" 404 di build Android.
   Perubahan satu baris di `src/`, di luar wewenang agen ini. **→ Selesai 15 Sep 2026** (2.1).
4. **`GOOGLE_SERVICES_JSON_BASE64` + `FCM_SERVICE_ACCOUNT` + `admin_set_push_config`** — tanpa ketiganya
   push mati total sementara build tetap "hijau". **→ Masih menunggu Erza (18 Sep 2026)**; AAB `111` terbukti dibangun tanpa yang pertama.
5. **Server TURN** — tanpa itu panggilan suara gagal di jaringan seluler. Cloudflare gratis sampai 1 TB/bulan.
6. **Kunci produksi Midtrans** + akun uji reviewer.
7. **Screenshot masih draf** — boleh untuk Internal testing, ganti dengan tangkapan HP asli sebelum produksi.
8. **Waktu**: akun perorangan baru wajib 12 penguji × 14 hari sebelum boleh *mengajukan* produksi —
   paling cepat publik bisa mengunduh **± 18 hari**, realistis 3–4 minggu (`RUNBOOK-LISTING-BESOK.md`).
   **→ 18 Sep 2026: hitungan belum mulai** — rilis Alpha `111` masih draf, penguji belum ada (5.7, 5.11).

Yang **tidak** lagi memblokir dan sudah tuntas hari ini: ikon notifikasi, seluruh aset grafis, screenshot
draf, kebijakan privasi & S&K yang kini menyebut data moderasi, jawaban Data safety, verifikasi izin
manifest, dan koreksi klaim "fungsi blokir belum ada" yang sudah usang.
