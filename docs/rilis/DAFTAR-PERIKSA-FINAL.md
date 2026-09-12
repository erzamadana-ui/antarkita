# Daftar Periksa Final — Kesiapan Android AntarKita

> Verifikasi ulang menyeluruh, **9 September 2026**. Setiap baris di bawah **dibuktikan dari berkas/kode
> nyata**, bukan dari dokumen lain. Kolom bukti menyebut berkas dan cara mengecek ulangnya sendiri.
>
> Legenda: **✅ selesai** · **⏳ menunggu pemilik** (butuh akun/kunci yang hanya boleh dipegang Erza) ·
> **❌ belum, perlu perubahan kode/aset**
>
> Diurutkan menurut **apa yang memblokir rilis lebih dulu**. Kerjakan dari atas.

---

## Blok 1 — Tanpa ini tidak ada yang bisa diunggah sama sekali

| # | Butir | Status | Bukti / cara verifikasi |
|---|---|---|---|
| 1.1 | Akun Google Play Console (US$25) + verifikasi identitas | ⏳ | Hanya pemilik. `CHECKLIST-GO-LIVE.md` §A1 |
| 1.2 | Upload keystore dibuat & 4 GitHub Secret terisi (`ANDROID_KEYSTORE_BASE64`, `..._PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`) | ⏳ | `release-aab.yml` langkah "Pastikan rahasia keystore tersedia" **menggagalkan build** bila kosong |
| 1.3 | Migrasi `0023_hapus_akun.sql` **dan** `0050_moderasi_ugc_lapor_blokir.sql` diterapkan di Supabase **produksi** | ⏳ | `select proname from pg_proc where proname in ('request_account_deletion','report_content','block_user');` → harus 3 baris. **Google selalu menguji tombol hapus akun dan jalur lapor/blokir.** Dokumen internal masih bertentangan soal ini (`RENCANA-LISTING-LIVE.md` vs `CHECKLIST-GO-LIVE.md` §E) — percayai hasil kueri, bukan dokumen |

## Blok 2 — Membuat aplikasi ditolak reviewer, atau fitur mati diam-diam

| # | Butir | Status | Bukti / cara verifikasi |
|---|---|---|---|
| 2.1 | **Tautan "Bagikan perjalanan" rusak di build Android** | ❌ | `src/lib/app.ts:20` memakai fallback `…/antarkita` (benar), tetapi `src/components/Safety.tsx:18` memakai fallback lama **`https://erzamadana-ui.github.io/antar-aja`**. `release-aab.yml` mengisi `EXPO_PUBLIC_SITE_ROOT` tetapi **tidak** `EXPO_PUBLIC_SITE_URL`, jadi di AAB fallback itulah yang dipakai → tautan berbagi perjalanan **404**. Nama repo yang benar adalah `antarkita` (`git remote -v`). **Perbaikan (di `src/`, di luar wewenang agen ini): ganti fallback ke `…/antarkita`, atau tambahkan `EXPO_PUBLIC_SITE_URL` ke env di `release-aab.yml`.** Fitur keselamatan yang dipromosikan di listing tidak boleh menghasilkan 404 |
| 2.2 | Secret `GOOGLE_SERVICES_JSON_BASE64` (Firebase) | ⏳ | Tanpa ini AAB **tetap sukses dibangun** tetapi tidak ada token FCM → **seluruh notifikasi push mati** di rilis Play. `release-aab.yml` hanya memberi `::warning::`, bukan error — kegagalannya senyap. Berkas harus memuat `id.antarkita.app` **dan** `id.antarkita.mitra` (workflow memeriksa ini) |
| 2.3 | Secret Supabase `FCM_SERVICE_ACCOUNT` + `admin_set_push_config(url, service_role_key)` | ⏳ | `docs/PUSH-NOTIFICATION.md` §3. Tanpa keduanya `push-send` menandai antrean `skipped` — push tetap mati walau 2.2 sudah diisi |
| 2.4 | **Server TURN untuk panggilan suara** | ❌ | `src/lib/call.ts:44-45`: `ICE` hanya berisi dua STUN Google; blok TURN hanya masuk bila `EXPO_PUBLIC_TURN_URL` terisi — dan variabel itu **tidak diset di mana pun** (bukan di `.env`, bukan di `release-aab.yml`). Akibatnya di jaringan seluler Indonesia (CGNAT ≈ symmetric NAT) `connectionState` menjadi `failed` → `src/lib/call.ts:176` menutup panggilan dengan "Koneksi gagal. Periksa jaringan." Rincian & biaya penyedia: §Lampiran A |
| 2.5 | Kunci produksi Midtrans + URL webhook produksi | ⏳ | `CHECKLIST-GO-LIVE.md` §D4. Play menanyakan bukti pada deklarasi *Financial features* |
| 2.6 | Akun uji untuk reviewer (App access) — pelanggan bersaldo & driver berstatus *approved* | ⏳ | `PLAY-STORE-LISTING.md` §4.3. Reviewer menolak aplikasi yang tidak bisa dimasuki |
| 2.7 | Pengerasan Supabase produksi (RLS advisors 0 temuan, confirm-email, SMTP kustom, PITR, hapus akun demo dari seed) | ⏳ | `CHECKLIST-GO-LIVE.md` §D1–D3 |

## Blok 3 — Konten listing (semua sudah bisa diisi hari ini)

| # | Butir | Status | Bukti / cara verifikasi |
|---|---|---|---|
| 3.1 | `versionCode` naik otomatis tiap build | ✅ | `app.config.ts`: `versionCode = ANDROID_VERSION_CODE ?? GITHUB_RUN_NUMBER + 100 ?? 1`. `release-aab.yml` mengisi `ANDROID_VERSION_CODE = run_number + offset` dan **memverifikasi** hasilnya di `build.gradle`. Diuji: `APP=pelanggan ANDROID_VERSION_CODE=207 npx expo config` → `versionCode: 207` |
| 3.2 | `versionName` masuk akal untuk rilis pertama | ✅ | `3.0.0` dari `package.json`, satu sumber kebenaran; terbaca di `build.gradle` hasil prebuild. Angka 3.x mencerminkan 3 tahap pengembangan internal — sah dan tidak menimbulkan pertanyaan di Play |
| 3.3 | Izin manifest = persis yang dijanjikan dokumen | ✅ | Dijalankan ulang `npx expo prebuild --platform android --no-install` (pelanggan **dan** mitra), lalu manifest dibaca langsung. **13 izin aktif**: `ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION`, `CAMERA`, `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS`, `INTERNET`, `ACCESS_NETWORK_STATE`, `VIBRATE`, `WAKE_LOCK`, `POST_NOTIFICATIONS`, `BLUETOOTH`, `READ_EXTERNAL_STORAGE` (maxSdk 32), `WRITE_EXTERNAL_STORAGE` (maxSdk 32). **7 diblokir** dengan `tools:node="remove"`: `ACCESS_BACKGROUND_LOCATION`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION`, `SYSTEM_ALERT_WINDOW`, `READ_MEDIA_IMAGES`, `READ_MEDIA_VIDEO`, `AD_ID`. **Cocok 100%** dengan `PLAY-STORE-LISTING.md` §4.9. Folder `android/` sudah dihapus lagi dan `package.json` dikembalikan |
| 3.4 | `targetSdkVersion` ≥ 36 (syarat Play sejak 31 Agu 2026) | ✅ | `node_modules/react-native/gradle/libs.versions.toml`: `targetSdk = "36"`, `compileSdk = "36"`, `minSdk = "24"`. `release-aab.yml` menggagalkan build bila turun |
| 3.5 | Ikon adaptif & splash | ✅ | `adaptive-icon.png` 1024×1024 RGBA dan `splash-icon.png` 512×512 RGBA untuk ketiga aplikasi; hasil prebuild berisi `mipmap-anydpi-v26/ic_launcher.xml` + `drawable-*/splashscreen_logo.png` di 5 kerapatan |
| 3.6 | **Ikon notifikasi 96×96 putih transparan** | ✅ **dibuat hari ini** | `apps/{pelanggan,mitra,admin}/assets/notification-icon.png` — 96×96 RGBA, **satu warna non-transparan saja: putih murni**, 19% piksel tampak. Skrip: `docs/rilis/aset/buat-ikon-notifikasi.py`. Didaftarkan di `app.config.ts` plugin `expo-notifications` (`icon:`). Diverifikasi dari hasil prebuild: `res/drawable-{m,h,x,xx,xxx}dpi/notification_icon.png` (24/36/48/72/96 px) + `meta-data … default_notification_icon` untuk expo **dan** Firebase |
| 3.7 | Ikon 512×512 & feature graphic 1024×500 | ✅ | Diukur ulang dengan PIL: `ikon-512-{pelanggan,mitra}.png` = 512×512 **RGB tanpa alfa** (Play menolak alfa pada app icon), `feature-graphic-{pelanggan,mitra}.png` = 1024×500 RGB. Semua ≤ 70 KB. **Tidak ada yang perlu diperbaiki** |
| 3.8 | Screenshot ponsel ≥2 per aplikasi | ⚠️ **DRAF — dibuat hari ini** | 8 berkas 1080×1920 (tepat 9:16) di `docs/rilis/aset/screenshot/`: 5 Pelanggan + 3 Mitra. Semua lolos spek Play (sisi terpendek ≥320, terpanjang ≤3840, PNG ≤8 MB). **Bukan tangkapan HP asli** — lihat §Lampiran B untuk penilaian jujur dan apa yang harus diganti |
| 3.9 | Halaman `/privacy/`, `/terms/`, `/hapus-akun/` benar-benar dibangun | ✅ | `.github/workflows/web.yml`: `scripts/build-web.mjs` menyalin privacy & terms, langkah tersendiri menyalin `hapus-akun.html`, lalu langkah "Pastikan halaman hukum wajib benar-benar ada" **menggagalkan deploy** bila salah satu `dist/<p>/index.html` kosong. `dist/404.html` (SPA fallback) tidak menyentuh ketiga path itu karena berkasnya ada secara fisik |
| 3.10 | Isi halaman hukum konsisten dengan fitur terbaru | ✅ **diperbarui hari ini** | Celah yang ditemukan: migrasi `0050` (kemarin) menambah data pribadi baru — **laporan moderasi & daftar blokir** — yang **tidak disebut sama sekali** di kebijakan privasi. Kebijakan privasi yang tidak menyebut data yang benar-benar dikumpulkan adalah alasan penolakan. Diperbaiki: `privacy.html` → v1.1 (baris data moderasi di §2, tujuan pemrosesan di §6, pihak penerima di §7, masa simpan di §9); `terms.html` → v1.1 (konten seksual/spam/ujaran kebencian/ulasan palsu ditambahkan ke §8; sub-bagian baru "Melaporkan dan memblokir pengguna" di §9 + entri daftar isi); `hapus-akun.html` (baris daftar blokir & laporan moderasi di tabel penghapusan). Push notification, data lokasi, kontak darurat, KYC, dan panggilan **sudah** tercakup sebelumnya — sudah diperiksa ulang |
| 3.11 | Jawaban Data safety cocok dengan data yang dikumpulkan kode hari ini | ✅ **diperbarui hari ini** | Ditelusuri satu per satu: token push (`register_push_token` hanya mengirim `p_token`, `p_platform`, `p_app` — **tidak** ada model perangkat) → *Device or other IDs* ✔; lokasi presisi & perkiraan ✔; kontak darurat & NIK/SIM mitra → *Personal info → Other info* ✔; dokumen KYC → *Photos* + *Files and docs* ✔; audio panggilan **tidak** direkam ✔. **Yang kurang dan sudah ditambahkan:** rekaman laporan & blokir (`content_reports`, `user_blocks`) kini masuk baris *App activity → Other user-generated content* di `PLAY-STORE-LISTING.md` §4.7 |
| 3.12 | Kuesioner UGC (lapor & blokir) | ✅ | Fungsi blokir **sudah ada** — `CHECKLIST-GO-LIVE.md` §C3 sebelumnya masih menulis "belum ada" (usang sejak commit `d211ba6`) dan **sudah diperbaiki**. Objek nyata di `0050`: `report_content`, `block_user`, `unblock_user`, `my_blocks`, `admin_list_reports`, `admin_resolve_report`, `driver_can_take`, `is_blocked_pair`, `nearby_drivers`, 3 trigger penegak blokir, tabel `content_reports` & `user_blocks`. Bukti tangkapan layar untuk formulir: `aset/screenshot/bukti-ugc-blokir.png` |
| 3.13 | Teks listing, IARC, Financial features, Advertising ID, kategori, negara | ✅ | Siap salin di `PLAY-STORE-LISTING.md` §1–§4 |

## Blok 4 — Konsistensi nama & kebersihan (tidak memblokir, tetapi membingungkan reviewer)

| # | Butir | Status | Bukti / cara verifikasi |
|---|---|---|---|
| 4.1 | Tidak ada "Antar Aja" yang **terlihat pengguna** | ✅ | Blok akun demo di layar masuk **dihapus seluruhnya** (12 Sep 2026) dan akun uji `@antaraja.id` dinonaktifkan di produksi (migrasi 0085); kata sandi uji tidak lagi ada di repositori |
| 4.2 | URL gambar promo di `seed.sql` menunjuk repo lama | ❌ | `supabase/seed.sql` baris 113–131: `https://erzamadana-ui.github.io/antar-aja/promos/…` sedangkan Pages ada di `/antarkita/promos/` → semua gambar promo **404**. Hanya data seed (dev), tetapi bila seed pernah dijalankan di produksi, promo tampil tanpa gambar. Berkas di luar wewenang agen ini (`supabase/`) |
| 4.3 | User-Agent geocoding memakai identitas lama | ❌ ringan | `src/lib/geo.ts:6`: `AntarAja/1.0 (support@antaraja.id)` — alamat email itu tidak ada. Kebijakan pemakaian Nominatim/OSM menuntut kontak yang valid; alamat mati bisa berujung pemblokiran IP. Ganti ke `AntarKita/1.0 (erzamadana@gmail.com)` |
| 4.4 | Kunci penyimpanan internal `antaraja.mode` / `antaraja.locale` / GUC `antaraja.bypass` / `https://antaraja.local/` | ✅ **jangan diubah** | Tidak terlihat pengguna. Mengganti kunci `AsyncStorage` akan **mereset preferensi semua pengguna lama**, dan mengganti GUC merusak trigger di migrasi `0007`. Biarkan apa adanya |

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
| `EXPO_PUBLIC_SITE_ROOT` | **WAJIB (sudah diisi)** | `release-aab.yml` baris 72 | Fallback `src/lib/app.ts:20` sudah benar (`…/antarkita`), jadi aman |
| `EXPO_PUBLIC_SITE_URL` | **WAJIB — BELUM DIISI** | tidak diset di build Android | **Tautan "Bagikan perjalanan" jadi 404** karena fallback `Safety.tsx:18` menunjuk repo lama `antar-aja`. Lihat butir 2.1 |
| `EXPO_PUBLIC_APK_URL` | Opsional | `release-aab.yml` baris 73 | Fallback `src/lib/app.ts:22` sudah benar. Aman |
| `EXPO_PUBLIC_BASE_URL` | Opsional (web) | `.env` / workflow web | Kosong = benar untuk Android |
| `EXPO_PUBLIC_TURN_URL` | **WAJIB untuk panggilan suara** | belum ada | **Panggilan suara gagal di jaringan seluler** (Lampiran A) |
| `EXPO_PUBLIC_TURN_USER` | ikut TURN_URL | belum ada | TURN diabaikan bila `TURN_URL` kosong |
| `EXPO_PUBLIC_TURN_PASS` | ikut TURN_URL | belum ada | Sama |
| `EXPO_PUBLIC_GOOGLE_MAPS_KEY` | Opsional | `.env` (kosong) | Kosong = pakai Photon/Nominatim/OSRM gratis. **Berfungsi**, tetapi tanpa SLA dan dibatasi *usage policy* OSM — pertimbangkan mengisi bila trafik naik |
| `EXPO_PUBLIC_DEMO_LOGIN` | **HARUS kosong di rilis** | hanya diisi `web.yml` | Bila kelak terisi `1` di build Play, kredensial akun demo tampil di layar login — jangan sampai |

---

## Ringkasan — apa yang MASIH memblokir rilis

1. **Akun & kunci pemilik** (Blok 1) — Play Console, keystore + 4 secret. Tidak ada AAB tanpa ini.
2. **Migrasi `0023` + `0050` di database produksi** — bila belum, tombol hapus akun dan lapor/blokir
   error saat diuji Google; keduanya **pasti** diuji.
3. **`Safety.tsx:18` menunjuk repo lama `antar-aja`** — tautan "Bagikan perjalanan" 404 di build Android.
   Perubahan satu baris di `src/`, di luar wewenang agen ini.
4. **`GOOGLE_SERVICES_JSON_BASE64` + `FCM_SERVICE_ACCOUNT` + `admin_set_push_config`** — tanpa ketiganya
   push mati total sementara build tetap "hijau".
5. **Server TURN** — tanpa itu panggilan suara gagal di jaringan seluler. Cloudflare gratis sampai 1 TB/bulan.
6. **Kunci produksi Midtrans** + akun uji reviewer.
7. **Screenshot masih draf** — boleh untuk Internal testing, ganti dengan tangkapan HP asli sebelum produksi.
8. **Waktu**: akun perorangan baru wajib 12 penguji × 14 hari sebelum boleh *mengajukan* produksi —
   paling cepat publik bisa mengunduh **± 18 hari**, realistis 3–4 minggu (`RUNBOOK-LISTING-BESOK.md`).

Yang **tidak** lagi memblokir dan sudah tuntas hari ini: ikon notifikasi, seluruh aset grafis, screenshot
draf, kebijakan privasi & S&K yang kini menyebut data moderasi, jawaban Data safety, verifikasi izin
manifest, dan koreksi klaim "fungsi blokir belum ada" yang sudah usang.
