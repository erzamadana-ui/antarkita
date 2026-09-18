# Lembar Jawaban "App content" — Google Play Console
## Aplikasi Mitra · AntarKita Mitra · `id.antarkita.mitra`

Padanan dari `PLAY-APP-CONTENT-JAWABAN-PELANGGAN.md` untuk aplikasi Mitra (driver, merchant, mitra travel,
pedagang pasar, mobil box — `app.config.ts:19`). Disusun dari pembacaan kode (baca-saja). Setiap jawaban
menunjuk `file:baris`. Yang tidak bisa dibuktikan dari kode ditandai **[ASUMSI]** atau **[BUTUH ERZA]**.
Bagian yang **sama persis** dengan Pelanggan (Ads, News, Government, Health, definisi *sharing* Midtrans/peta)
tidak diulang panjang — lihat dokumen Pelanggan; di sini yang ditekankan adalah **perbedaan Mitra**.

---

## STATUS AKTUAL DI PLAY CONSOLE — per 18 Sep 2026

| Deklarasi | Status | Keterangan |
|---|---|---|
| Ads | ✅ **No** | selesai |
| Advertising ID | ✅ **No** | selesai |
| Government apps | ✅ **No** | selesai |
| Health apps | ✅ tidak ada fitur kesehatan | selesai |
| Financial features | ✅ dompet digital (*Digital wallet / stored value*) | selesai |
| Content rating (IARC) | ✅ selesai, hasil semua umur | selesai |
| Data safety | 📝 **draf lengkap** — impor CSV dari Pelanggan, lalu **Photos** dan **Files and docs** diubah jadi *wajib* | **belum di-submit** |
| App access → Sign in details | 🔒 **TERKUNCI** | butuh **kata sandi akun uji** dari Erza (lihat [BUTUH ERZA] #1) |
| Target audience | 🔒 terkunci di belakang Sign in details | jawab **18+** begitu terbuka |
| Submit Data safety | 🔒 terkunci | urutan: Sign in details → Target audience → submit Data safety |

Jadi satu-satunya penghalang hari ini adalah **kredensial akun uji Mitra**. Semua jawaban lain sudah ada di bawah.

---

## RINGKASAN 9 DEKLARASI

1. **Ads** → **Tidak.** Sama dengan Pelanggan: nol SDK iklan; `AD_ID` diblokir (`app.config.ts:193`).
2. **App access** → **Restricted (login wajib)** — `src/screens/Entry.tsx:35`; akun tanpa peran mitra dilempar ke `/onboarding` (`Entry.tsx:61-69`). Reviewer butuh akun driver **yang sudah `approved`** + akun merchant, karena persetujuan hanya bisa dilakukan admin (`0007_phase4.sql:469` menolak online bila `status <> 'approved'`).
3. **Content rating** → kategori *Utility/Productivity/Communication/Other*; chat & panggilan **Ya**; laporkan/blokir/moderasi **Ya**; lokasi dibagikan ke pengguna lain **Ya**; sisanya **Tidak**. Sama dengan Pelanggan.
4. **Target audience** → **18+ saja** (`docs/rilis/PLAY-STORE-LISTING.md:141` "usia minimal 18 tahun, KTP").
5. **News app** → **Tidak.**
6. **Data safety** → beda dari Pelanggan di 4 titik: **(a)** *Personal info → Other info* (NIK, nomor SIM) **DIKUMPULKAN, wajib**; **(b)** *Photos* **wajib** (KTP, kendaraan+STNK, selfie); **(c)** *Files and docs* **wajib** (NPWP/izin usaha/sertifikat halal, boleh PDF); **(d)** *Financial info → Other financial info* (nomor rekening bank pencairan) **wajib**. Lokasi tetap **foreground-only**.
7. **Government apps** → **Tidak.**
8. **Financial features** → **Ya — Mobile payments and digital wallets** (saldo AntarPay mitra + pencairan ke bank).
9. **Health apps** → **Tidak.**

---

# 1. ADS — sama dengan Pelanggan

| Pertanyaan | Jawaban | Bukti |
|---|---|---|
| Contains ads? | **No** | `package.json` tidak memuat SDK iklan (satu basis kode dengan Pelanggan, `app.config.ts:4-7`) |
| Advertising ID | **No** | `com.google.android.gms.permission.AD_ID` di `blockedPermissions` (`app.config.ts:193`) |

---

# 2. APP ACCESS — beda: butuh akun mitra yang sudah disetujui admin

| Pertanyaan | Jawaban | Bukti |
|---|---|---|
| Is any part restricted? | **All or some functionality is restricted** — login wajib | `src/screens/Entry.tsx:35`; rute `apps/mitra/app/(auth)/login.tsx` |
| Jenis pembatasan | **Login required** + **verifikasi admin** (bukan berbayar) | `Entry.tsx:61-69`: tanpa baris `drivers`/`merchants`/`travel_partners`/`market_vendors` → `/onboarding` (`src/screens/mitra/onboarding.tsx:14-20`); `driver_set_online` menolak bila `status <> 'approved'` (`0007_phase4.sql:469`) |
| Gerbang tambahan sebelum online | **Verifikasi wajah (selfie) wajib**, kedaluwarsa tiap 20 jam | `0007_phase4.sql:473-475` (`SELFIE_REQUIRED`), setelan `driver_selfie_hours = 20` (`0007:432`); UI `src/screens/driver/tabs/index.tsx:49,137` + `src/components/Safety.tsx:122-140` |
| Gerbang kota? | Tidak untuk online driver; **ya** untuk pesanan (dibuat dari sisi Pelanggan) | `city_gate` hanya dipasang di `create_order` (`0080_penegakan_gerbang_kota.sql:30`); `driver_set_online` (`0007:462-476`) tidak memanggilnya |

## Teks instruksi akses untuk reviewer (salin ke kolom "Instructions")

> **Login is required. This is the PARTNER (driver/merchant) app of AntarKita; two pre-approved test accounts are provided.**
>
> 1. Open the app → tap **"Masuk"** (Sign in) → enter the **driver** test credentials below.
> 2. You land on the driver home (map + **"Online"** switch). Partner accounts are verified by our admin before they can go online; the test account is **already approved**, so no document upload is needed for review.
> 3. Toggle **Online**. The app asks for location (foreground only) and, once per 20 hours, a **face-verification selfie** (camera). Take any selfie and tap **"Kirim"** — this is an anti-fraud check that the registered partner is the one driving; the photo is stored privately and never shown to other users.
> 4. **Incoming orders** appear on the home list only when a customer in the same city places one. Use the **customer** test account in the AntarKita customer app (`id.antarkita.app`) with pickup in **`<NAMA KOTA AKTIF>`**, or watch the demo video linked below.
> 5. **Chat / call / report / block**: open an active order → customer card → **"Chat"**, phone icon, and the **"⋯"** button → **"Laporkan"** (Report) / **"Blokir"** (Block). Block list: **Akun → Pengguna diblokir**.
> 6. **Earnings & withdrawal**: tab **"Pendapatan"** → **"Tarik Saldo"** → enter bank details. In the review environment payouts are reviewed manually by admin; no real money moves.
> 7. **Merchant flow**: sign out, sign in with the **merchant** test credentials → tabs **Pesanan / Menu / Toko**. **Toko → Sertifikasi & dokumen** shows the KYC document form (tax ID, owner ID card, bank account).
> 8. **Partner registration flow (for reference)**: a fresh account is routed to **"Jadi Mitra"** → choose a partner type → the form asks for national ID number (NIK), driving-licence number, ID-card photo, vehicle photo with registration. Submissions wait for admin approval.
> 9. **Account deletion**: **Akun → Hapus akun** → type `HAPUS` → confirm. Web: `https://apps.antarkitaindonesia.com/hapus-akun/`
>
> Language: Indonesian only. *Masuk* = sign in, *Online* = go online, *Pendapatan* = earnings, *Tarik Saldo* = withdraw, *Akun* = account, *Laporkan* = report, *Blokir* = block, *Hapus akun* = delete account.

Jalur menu di atas dicek: driver `src/screens/driver/tabs/account.tsx:36,40`; merchant `src/screens/merchant/tabs/store.tsx:49,61`; earnings `src/screens/driver/tabs/earnings.tsx:52`; moderasi di kartu pelanggan `src/screens/driver/order.tsx:148` → `src/components/OrderDetails.tsx:37`; chat `src/screens/order/chat.tsx:60`; dokumen merchant `apps/mitra/app/merchant/documents.tsx`.

**[BUTUH ERZA]** — isi sendiri: dua akun uji (driver `approved` + merchant `approved`), `<NAMA KOTA AKTIF>`, tautan video demo. **[ASUMSI]** reviewer tidak punya pelanggan di kota aktif, jadi tanpa video demo mereka tidak akan pernah melihat pesanan masuk.

---

# 3. CONTENT RATING (IARC) — sama dengan Pelanggan, bukti sisi Mitra

Kategori: **Utility, Productivity, Communication, or Other**. Sudah selesai di Console (hasil semua umur); tabel ini untuk arsip bila kuesioner harus diulang.

| Pertanyaan IARC | Jawaban | Bukti sisi Mitra |
|---|---|---|
| Kekerasan / horor / seksual / bahasa kasar / narkoba / judi | **Tidak** semua | Kata `kekerasan`/`seksual` hanya kategori laporan (`src/components/moderation/index.tsx:29-30`) |
| Pengguna berinteraksi / berkomunikasi? | **Ya** | Chat `apps/mitra/app/order/[id]/chat.tsx`; panggilan WebRTC `apps/mitra/app/call/[id].tsx` |
| Interaksi dimoderasi? | **Ya** | `report_content()` (`0050_moderasi_ugc_lapor_blokir.sql:190`), `block_user()` (`0050:131`); UI `OrderDetails.tsx:37`, `chat.tsx:60` |
| Lokasi dibagikan ke pengguna lain? | **Ya** — posisi driver dikirim tiap ≤4 detik saat online dan dilihat pelanggan | `src/hooks/useDriver.ts:25-31` → RPC `driver_update_location` (`0002_functions_rls.sql:287-292`); dibaca pelanggan lewat `nearby_drivers` (`0002:295`) dan `shared_order` (`0007_phase4.sql:601`, grant `anon` `0007:682`) |
| Info pribadi dibagikan ke pengguna lain? | **Ya** — nama, foto, plat, rating driver tampil ke pelanggan; **NIK/SIM/KTP tidak pernah** | `shared_order` (`0007:591-608`); `driver_documents` RLS hanya pemilik & admin (`0004_review_fixes.sql:17-18`) |
| Pembelian barang/jasa digital? | **Tidak** | Tidak ada IAP; pendapatan dari jasa dunia nyata |
| UGC dibagikan ke pengguna lain? | **Ya** — foto & nama menu merchant tampil publik | bucket `merchant-images` **publik** (`src/lib/upload.ts:20-21`); `menu_items.image_url` (`0001_schema.sql:128`) |

---

# 4. TARGET AUDIENCE — 18+ saja (terkunci sampai Sign in details terisi)

| Pertanyaan | Jawaban | Bukti |
|---|---|---|
| Target age groups | **18 and over** saja | `docs/rilis/PLAY-STORE-LISTING.md:141`; `docs/rilis/privacy.html` §12 (sama untuk kedua aplikasi) |
| Menarik anak-anak? | **No** | Aset korporat `apps/mitra/assets/icon.png`; tidak ada karakter/gim |
| Designed for Families | **Tidak ikut** | konsekuensi 18+ |

---

# 5. NEWS APP → **No.** # 7. GOVERNMENT APPS → **No.** # 9. HEALTH APPS → **No.**

Bukti identik dengan Pelanggan (satu basis kode). Untuk Health: tidak ada tabel kesehatan; selfie verifikasi (`drivers.last_selfie_url`, `0007_phase4.sql:398`) adalah **foto wajah untuk anti-penipuan**, bukan data biometrik terukur dan bukan data kesehatan — jangan mendeklarasikan "Health" karenanya. **[ASUMSI]** Play menganggap selfie tanpa pemrosesan biometrik sebagai *Photos*, bukan kategori tersendiri; kode memang tidak menghitung embedding wajah (`driver_selfie_check` hanya menyimpan URL, `0007:450-456`).

---

# 6. DATA SAFETY — draf lengkap, tinggal submit

## 6.1 Jawaban bagian atas — sama dengan Pelanggan

Collect/share = **Yes**; encrypted in transit = **Yes** (`app.config.ts:162`); deletion = **Yes** (`request_account_deletion()` `0023_hapus_akun.sql:19` — **juga mengosongkan** `driver_documents` NIK/SIM/foto dan `market_vendors.id_card_url`, `0023:137-138`); URL hapus akun `https://apps.antarkitaindonesia.com/hapus-akun/` (`scripts/build-web.mjs:45`); MASA = **No**; ephemeral = **No**.

## 6.2 Yang BERBEDA dari CSV Pelanggan — ubah baris ini setelah impor

| Jenis data (nama Play) | Pelanggan | **Mitra** | Bukti |
|---|---|---|---|
| **Personal info → Other info** | Opsional (kontak darurat) | **DIKUMPULKAN, WAJIB** — NIK KTP + nomor SIM | Input wajib `src/screens/account/become-driver.tsx:93` ("Nomor SIM dan NIK wajib diisi"), field `:218-219`; disimpan `driver_documents.id_card_number/license_number` (`0004_review_fixes.sql:6-13`; kolom asal `0001_schema.sql:82-83`); merchant NPWP wajib `src/screens/merchant/documents.tsx:26` → `merchant_documents.npwp_no` (`0007_phase4.sql:20`) |
| **Photos and videos → Photos** | Opsional | **WAJIB** | Driver: foto KTP + foto kendaraan/STNK `required` (`become-driver.tsx:220-221`); selfie wajib sebelum online (`Safety.tsx:135`, `0007:454`); merchant KTP pemilik + foto tempat usaha `required` (`become-merchant.tsx:112,121`; `documents.tsx:46-47`); pedagang pasar KTP `required` (`become-vendor.tsx:173`); travel SIM `required` (`become-travel.tsx:164`) |
| **Files and docs** | Opsional (lampiran tiket) | **WAJIB** untuk merchant; opsional untuk peran lain | `DocUpload` menerima "foto/PDF" ke bucket privat `documents` (`src/components/DocUpload.tsx:1,32`; `upload.ts:5`); NPWP wajib (`documents.tsx:26,44-45`), izin usaha/halal opsional (`:48-49,61`), KIR/STNK travel opsional (`become-travel.tsx:165`) |
| **Financial info → Other financial info** | Wajib bila pakai AntarPay | **WAJIB** — nomor rekening bank untuk pencairan | `src/screens/pay/withdraw.tsx:16,25` (bank/rekening/nama wajib) → `request_withdrawal` (`0019_tahap7…sql:127-138`) → `withdrawal_requests` (`0002:18-30`) + `bank_accounts` (`0019:118-122`); merchant `merchant_documents.bank_*` (`0007:28`; UI `documents.tsx:67-72`); vendor `market_vendors.bank_*` (`0018_tahap7…sql:391`) |
| **Location → Precise** | Wajib untuk memesan | **WAJIB** untuk online; disiarkan berkala ke server | `useWatchLocation` `Accuracy.High` (`src/hooks/useLocation.ts:44-45`) → `drivers.location` (`0001:88`) via `driver_update_location`; `merchants.location` (`0001:108`). **Tetap foreground-only**: `ACCESS_BACKGROUND_LOCATION` diblokir (`app.config.ts:189`), `FOREGROUND_SERVICE*` diblokir (`:190`), plugin `isAndroidBackgroundLocationEnabled: false` (`:234`); hanya `requestForegroundPermissionsAsync` (`useLocation.ts:18,42`) |

Tujuan yang dicentang untuk empat baris pertama: **App functionality; Fraud prevention, security and compliance** (+ **Account management** untuk Other info). Jangan centang Advertising/Marketing/Analytics.

## 6.3 Baris yang SAMA dengan Pelanggan (tidak perlu diubah setelah impor CSV)

Name / Email / Phone (wajib, **dibagikan ke Midtrans** saat top up deposit — `src/screens/pay/topup.tsx:50` → `midtrans-create/index.ts:84`; form `src/screens/auth/register.tsx:23-25`); User IDs; Purchase history (`orders`, `wallet_transactions` `0001:47-57`); Approximate location; In-app messages; log panggilan; App interactions (`audit_logs`); UGC lain (rating/komentar); Crash logs & Diagnostics (sisi server, **[ASUMSI]**); Device IDs (`register_push_token` `0030_tahap11…sql:528`). Tidak dikumpulkan: Videos (`READ_MEDIA_VIDEO` diblokir `app.config.ts:192`), Audio rekaman, Health, Contacts, Calendar, SMS, Installed apps.

## 6.4 Definisi sharing — sama dengan Pelanggan
Supabase & FCM = pemroses (bukan sharing). Midtrans = **sharing** (nama/email/HP). Penyedia peta: **Shared = Yes** bila produksi masih `osm_free` (`src/lib/mapConfig.ts`) — lihat [BUTUH ERZA] #4. Dokumen KYC **tidak pernah** keluar ke pihak ketiga: hanya bucket privat + signed URL 1 jam (`upload.ts:20-26`), RLS pemilik/admin (`0004:18`, `0007:36-37`); `privacy.html:105-106` menyatakan hal yang sama.

## 6.5 Security practices
Sama dengan Pelanggan: transit terenkripsi **Ya**; hapus data **Ya**; Families **tidak berlaku**; MASA **Tidak**.

---

# 8. FINANCIAL FEATURES — sudah dipilih: Mobile payments and digital wallets

| Pertanyaan | Jawaban | Bukti |
|---|---|---|
| Provides financial features? | **Yes** | `wallets` (`0001:41-45`), `withdrawal_requests`, `bank_accounts` |
| Jenis | **Mobile payments and digital wallets** (= *Digital wallet / stored value*) | Saldo pendapatan mitra `wallets.balance`; deposit boleh minus s.d. −Rp500.000 (`0001:43`, dicek saat online `0007:470-471`) |
| Pencairan ke rekening bank | **Ya, hanya mitra** | Tombol "Tarik Saldo" tampil hanya dengan `allowWithdraw` (`WalletView.tsx:67`), dipasang di `earnings.tsx:52` & `store.tsx:61`; server membatasi ke `driver/merchant/admin` (`0090_tarik_saldo_hanya_mitra.sql:19-22,25-38`) |
| Lending / crypto / banking / insurance | **Jangan centang** | Deposit minus bukan pinjaman ke pengguna; 0 hasil crypto |
| Google Play Billing | **Tidak, tidak diwajibkan** | Tidak ada konten digital; tidak ada `react-native-iap` |

Teks deklarasi (≤500 karakter) — versi Mitra:

> AntarKita Mitra holds a stored-value balance for independent partners (drivers, merchants, market vendors, travel operators). Partners receive earnings from completed real-world services, may top up a security deposit via PT Midtrans (a Bank Indonesia-licensed payment gateway), and may withdraw earnings to their own Indonesian bank account after admin review. Balances cannot be transferred between users. AntarKita does not lend, does not store card data, and offers no investment products.

**[BUTUH ERZA]**: Midtrans harus **produksi**, bukan sandbox/simulasi (`src/screens/pay/gateway.tsx:83,94`) — sama dengan Pelanggan #3. Deposit minus (`0001:43`) **[ASUMSI]** tidak dianggap *lending* oleh Play karena tidak ada bunga/tenor; bila Play bertanya, jelaskan sebagai *security deposit*.

---

# [BUTUH ERZA] — tidak bisa dipastikan dari kode

| # | Hal | Kenapa | Yang harus dilakukan |
|---|---|---|---|
| 1 | **Kata sandi akun uji driver + merchant** (pemblokir utama hari ini) | Kredensial tidak ada di repo | Buat 2 akun di Supabase produksi; set `drivers.status='approved'` & `merchants.status='approved'` lewat Panel Admin; isi `driver_documents` seadanya agar admin tidak menolak; konfirmasi email; tulis di *Sign in details* |
| 2 | **Selfie gate saat review** | `driver_selfie_hours=20` (`0007:432`) berlaku global | Biarkan aktif dan jelaskan di instruksi (sudah ditulis langkah 3). **Jangan** set ke 0 di produksi hanya demi review |
| 3 | **Kota aktif + video demo pesanan masuk** | `cities` diisi runtime (`0079_admin_kota_dan_data_awal.sql`); reviewer tak punya pelanggan di kota itu | Rekam video 30–60 dtk: pelanggan memesan → driver Online → order muncul → terima → chat → selesai |
| 4 | **Penyedia peta produksi** | `map_config` runtime (`0061_peta_penyedia_dan_cache.sql`) | Pastikan bukan `osm_free`; menentukan jawaban *Shared* untuk Lokasi |
| 5 | **Midtrans produksi** | Kunci di `gateway_secrets` | Sama dengan Pelanggan |
| 6 | **Halaman `/hapus-akun/` live** | Hanya terbit lewat `.github/workflows/web.yml` | Buka di penyamaran sebelum submit |
| 7 | **Pedagang pasar & mitra travel tidak bisa tarik saldo** | `apply_market_vendor` (`0018:439-458`) **tidak** mengubah `profiles.role` → tetap `customer` → ditolak `0090:29-37`. Travel: `0011_travel.sql:151` set `driver` → aman | Bukan masalah Play, tapi fitur "cairkan pendapatan" di listing (`PLAY-STORE-LISTING.md:100`) tidak berfungsi untuk vendor pasar. Perbaiki di server sebelum ada vendor nyata |

---

# RISIKO PENOLAKAN — khusus Mitra

### 1. 🔴 Reviewer tidak bisa melihat fitur inti tanpa akun `approved` + pesanan dari kota aktif
`driver_set_online` menolak akun `pending` (`0007:469`); pesanan hanya muncul bila ada pelanggan memesan di radius (`driver_available_orders`, `0002:309`). Reviewer di luar Indonesia tidak akan melihat satu pun order → "app does not function". **Cegah:** akun uji sudah `approved` + video demo di kolom instruksi (#1, #3).

### 2. 🟠 Data safety Mitra harus LEBIH luas daripada Pelanggan — jangan copy-paste mentah
Setelah impor CSV, empat baris di §6.2 **wajib** diubah. Kalau *Other info* (NIK/SIM) dibiarkan "tidak dikumpulkan" padahal `become-driver.tsx:93` mewajibkannya, itu deklarasi palsu — alasan penolakan/penghapusan listing paling umum di 2025–2026. Draf Console saat ini sudah menaikkan Photos dan Files; **pastikan Other info dan Other financial info juga** sebelum submit.

### 3. 🟠 Selfie wajib sebelum online — reviewer bisa mengira ini pengumpulan biometrik
`SelfieGate` (`Safety.tsx:122-140`) memaksa foto wajah lewat kamera. Play tidak melarang, tapi reviewer bisa menandai *biometric data* bila tidak dijelaskan. **Cegah:** instruksi langkah 3 sudah menyatakan "stored privately, anti-fraud, never shown"; `privacy.html:85,106` sudah memuatnya. Deklarasikan sebagai **Photos**, bukan Health.

### 4. 🟡 Lokasi latar belakang — jawaban "No" benar hari ini, dan itu berarti pelacakan berhenti saat driver pindah aplikasi
`ACCESS_BACKGROUND_LOCATION` + `FOREGROUND_SERVICE*` diblokir (`app.config.ts:189-190`); `watchPositionAsync` berjalan hanya saat layar aplikasi hidup (`useLocation.ts:44`). Konsisten dengan `PLAY-STORE-LISTING.md:266`. **Cegah:** jangan menjanjikan "pelacakan real-time saat layar mati" di listing; teks justifikasi untuk masa depan sudah disiapkan di `PLAY-STORE-LISTING.md:267-269` — bila diaktifkan, deklarasi Data safety dan *Foreground service* harus diperbarui bersamaan.

### 5. 🟡 Kebijakan Privasi satu berkas — untuk Mitra justru cocok
`privacy.html:85` ("Dokumen KYC (hanya mitra)") dan §4 (`:105-106`) persis menggambarkan alur `become-driver`/`documents.tsx`. Retensi 30 hari setelah hapus akun (`privacy.html:164,201`) sesuai `0023_hapus_akun.sql:137-138`. Tidak ada tindakan.

### 6. 🟡 Bucket `merchant-images` publik = foto menu bisa diakses tanpa login
`upload.ts:20-21` menjadikan URL publik. Wajar untuk katalog, tetapi merchant bisa mengunggah foto yang bukan makanan. Sudah ada jalur laporan (`report_content`). **[ASUMSI]** tidak ada moderasi otomatis gambar — cukup untuk Play selama pelaporan berfungsi.

---

## Urutan menyelesaikan yang tersisa di Play Console

1. Terima kata sandi akun uji dari Erza → **App access → Sign in details** (tempel teks §2 + 2 kredensial + tautan video).
2. **Target audience** → 18 and over → tidak ada konten menarik anak.
3. **Data safety** → buka draf → cek 4 baris §6.2 sudah *wajib* → cek *Other info* tujuan berisi Account management → **Submit**.
4. Cek dasbor: semua tugas App content ✔ tanpa peringatan merah; pastikan halaman `/hapus-akun/` dan `/privacy/` mengembalikan 200.

---

## Catatan keterbatasan data

- Dokumen ini dibuat dari **kode sumber**, bukan dari basis data produksi. Isi tabel `cities`, `app_settings` (`driver_selfie_hours`, `customer_withdrawal_enabled`), `map_config`, dan `gateway_secrets` hanya bisa dipastikan lewat Panel Admin/Supabase — semuanya ditandai [BUTUH ERZA].
- Status Play Console "per 18 Sep 2026" disalin dari keterangan Erza, bukan dari pembacaan Console langsung; bila Console berubah, bagian *Status aktual* menjadi usang lebih dulu daripada bagian bukti kode.
- Nomor baris merujuk ke worktree saat penulisan; migrasi yang menimpa fungsi (mis. `register_driver` didefinisikan ulang di `0009`, `0021`, `0022`) dirujuk ke versi **pertama** yang memperkenalkan perilaku, kecuali disebut lain. Perilaku akhir mengikuti migrasi bernomor tertinggi.
- Aplikasi Mitra dan Pelanggan berbagi `app.config.ts`, `package.json`, dan `src/`; perbedaan hanya di rute `apps/mitra/app/*` dan percabangan `APP === 'mitra'`. Jawaban yang "sama dengan Pelanggan" bergantung pada asumsi bahwa build Mitra memakai `APP=mitra` (`app.config.ts:5-6`) tanpa penambahan dependensi terpisah — tidak ada mekanisme dependensi per-aplikasi di repo.
- Tidak ada akses ke AAB hasil build; klaim izin manifest (`blockedPermissions`) bertumpu pada komentar verifikasi 9 Sep 2026 di `app.config.ts:183-184` dan pemeriksaan di workflow `release-aab.yml`, bukan pada pembacaan manifest final oleh penulis dokumen ini.
