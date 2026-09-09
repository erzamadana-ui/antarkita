# Rencana Listing & Go-Live AntarKita — pembagian kerja (per 6 September 2026)

> ## ⚠️ KOREKSI 9 September 2026 — baca ini sebelum jadwal di bawah
>
> Jadwal "Selasa–Rabu listing & rilis" di bagian B **terlalu optimistis** dan perlu dibaca ulang. Audit kesiapan Play Store tanggal 9 Sep 2026 menemukan:
>
> 1. **Aplikasi tidak bisa diunduh publik dalam hitungan hari.** Akun developer **perorangan** wajib menjalankan uji tertutup dengan **12 penguji ter-*opt-in* terus-menerus selama 14 hari berturut-turut** sebelum boleh *mengajukan* akses produksi. Paling cepat publik bisa mengunduh **± 18 hari**, realistis **3–4 minggu**. Yang **bisa** dikejar dalam sehari adalah **listing + Internal testing**. Hitungan lengkap: **`docs/rilis/RUNBOOK-LISTING-BESOK.md`**.
> 2. **Klaim "Migrasi 0001–0024 diterapkan" bertentangan** dengan `docs/rilis/CHECKLIST-GO-LIVE.md` yang menandai `0023_hapus_akun.sql` belum diterapkan. **Wajib diverifikasi ke database produksi** (`select proname from pg_proc where proname = 'request_account_deletion';`) — bila kosong, tombol hapus akun error dan Google hampir pasti menolak.
> 3. **Baris "Kewajiban Google Play — Siap dari sisi produk" belum sepenuhnya benar.** Dua celah nyata: (a) tidak ada **fungsi memblokir pengguna** padahal aplikasi punya chat + panggilan suara antar pengguna (kebijakan UGC mewajibkannya); (b) URL hapus akun sebelumnya menunjuk *anchor* di dalam kebijakan privasi, bukan halaman tersendiri — sudah diperbaiki dengan `docs/rilis/hapus-akun.html` → `/hapus-akun/`.
> 4. **Build AAB tidak memuat `google-services.json`** sehingga notifikasi push mati di rilis Play. Sudah diperbaiki di `.github/workflows/release-aab.yml` lewat secret opsional `GOOGLE_SERVICES_JSON_BASE64`.
> 5. Yang **sudah terbukti benar**: `/privacy/` dan `/terms/` hidup (HTTP 200), `targetSdkVersion = 36` (memenuhi syarat Play sejak 31 Agustus 2026), izin sensitif benar-benar terblokir di manifest, dan skrip signing AAB berjalan sebagaimana mestinya.

Peran: Direktur (AI) mengeksekusi semua pekerjaan teknis; Komisaris (Erza) mengeksekusi hal yang **secara hukum/akun hanya bisa dilakukan pemilik**: akun Google Play, akun Midtrans, keystore, dan uji di HP nyata. Semua yang bisa dikerjakan tanpa akun pemilik **sudah selesai** di commit ini.

## A. Status kesiapan (ringkas)
| Area | Status | Bukti |
|---|---|---|
| Aplikasi Pelanggan, Mitra, Admin/Eksekutif | Siap 100% fitur | APK build-24, web live, sweep UI 3 aplikasi 0 error |
| Basis data & fungsi bisnis | Siap | Migrasi 0001–0024 diterapkan; simulasi 22 skenario S0–S21 LOLOS (rollback, tanpa mengubah data) |
| Uji unggah data (storage) | Siap | 5 bucket, batas ukuran & tipe file, kebijakan RLS per pemilik + akses bersama nota/lampiran (0024) |
| Kewajiban Google Play | Siap dari sisi produk | Kebijakan privasi & S&K online (`/privacy/`, `/terms/`), hapus akun in-app (0023), jawaban Data safety & IARC di `docs/rilis/PLAY-STORE-LISTING.md` |
| Build rilis (AAB bertanda tangan) | Siap otomatis, **menunggu keystore & secrets** | `.github/workflows/release-aab.yml` |
| Payment gateway (Midtrans) | Kode & Edge Function terpasang, **menunggu kunci** | `midtrans-create`, `midtrans-webhook` aktif; mode simulasi berjalan |

## B. Pembagian kerja sampai live

### Hari ini (Sabtu–Minggu) — Direktur, SELESAI
1. Perbaikan 7 poin (profil, batas jarak, Mitra Travel, impor tempat, toggle layanan, katalog kendaraan, input admin) — commit `3fb2ced`.
2. Uji menyeluruh tampilan (68 rute, 3 aplikasi), fitur, unggah, transaksi (22 skenario) — laporan di `docs/LAPORAN-UJI-SIMULASI.md`.
3. Bug nyata yang ditemukan uji & sudah diperbaiki: pendaftaran driver dengan dokumen lengkap gagal karena trigger auto-verifikasi (0022); pelanggan tidak bisa melihat foto nota driver (0024 + tombol "Lihat foto nota").
4. Kit rilis Play Store lengkap (`docs/rilis/`), workflow AAB, hapus akun, kebijakan privasi/S&K online.

### Senin (7 Sep) — Payment gateway, dituntaskan bersama
| Langkah | Siapa | Estimasi |
|---|---|---|
| 1. Daftar/masuk dashboard Midtrans → ambil **Server Key & Client Key Sandbox** (Settings → Access Keys) | Komisaris | 15 menit |
| 2. Masukkan kunci di Panel Admin → **Payment Gateway** (tersimpan di tabel rahasia `gateway_secrets`, bukan di kode) — jangan kirim kunci lewat chat | Komisaris | 5 menit |
| 3. Di Midtrans → Settings → Configuration: **Payment Notification URL** = `https://qwltshvzrsykxdvhbxcv.supabase.co/functions/v1/midtrans-webhook`; Finish/Unfinish/Error redirect = `https://erzamadana-ui.github.io/antarkita/pay/gateway` | Komisaris | 5 menit |
| 4. Uji top-up sandbox dari APK Pelanggan (GoPay/QRIS simulator Midtrans) → saldo bertambah otomatis lewat webhook; cek di Admin → Keuangan & Log Aktivitas | Komisaris menjalankan di HP, Direktur memantau log Edge Function & tabel `payments` | 30 menit |
| 5. Bila ada kegagalan: Direktur memperbaiki hari itu juga (log fungsi + tabel `payments.raw`) | Direktur | — |
| 6. Ajukan **aktivasi produksi Midtrans** (dokumen legal usaha, rekening) — proses review Midtrans biasanya 1–3 hari kerja; sementara itu aplikasi tetap live dengan top-up manual + sandbox | Komisaris | 30 menit + menunggu |
| 7. Setelah disetujui: ganti kunci produksi di Panel Admin, geser sakelar **Produksi**, uji top-up nyata Rp10.000 | Komisaris + Direktur | 20 menit |

### Selasa–Rabu — Listing & rilis (paralel dengan review Midtrans)
| Langkah | Siapa |
|---|---|
| 1. Buat **upload keystore** di laptop (perintah `keytool` ada di `docs/rilis/CHECKLIST-GO-LIVE.md`), simpan aman (bukan di repo/MEGA yang tersinkron publik) | Komisaris |
| 2. Tambah GitHub Secrets: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` | Komisaris |
| 3. Jalankan workflow **Release AAB** (Actions → Release AAB → Run, app: both) → unduh `antarkita-pelanggan.aab` & `antarkita-mitra.aab` dari release `aab-N` | Komisaris (1 klik), Direktur memverifikasi log |
| 4. Play Console: buat 2 aplikasi (`id.antarkita.app` "AntarKita", `id.antarkita.mitra` "AntarKita Mitra"), unggah AAB ke **Internal testing**, isi listing dari `PLAY-STORE-LISTING.md` (teks siap salin), unggah ikon 512 & feature graphic 1024×500 & ≥2 screenshot per aplikasi (ambil dari HP) | Komisaris; Direktur menyiapkan feature graphic & screenshot dari build web bila diminta |
| 5. App content: Privacy policy URL `https://erzamadana-ui.github.io/antarkita/privacy/`, Data safety (tabel jawaban tersedia), IARC, Target audience 18+, Financial features (dompet closed-loop + Midtrans), Ads: tidak ada iklan pihak ketiga | Komisaris |
| 6. Internal testing → undang penguji (email) → uji di HP → **Closed testing** (syarat akun developer pribadi baru: 12 penguji × 14 hari) → ajukan **Production** | Komisaris |

### Sepanjang review Google (1–7 hari) — Direktur
- Pantau crash/log, siapkan respons bila Google meminta klarifikasi (izin lokasi, keuangan).
- Hardening produksi Supabase: RLS advisors, template email auth, custom SMTP, PITR/backup (daftar di `CHECKLIST-GO-LIVE.md`).

## C. Definisi "siap 100%"
- [x] Semua rute UI ketiga aplikasi dirender tanpa error (68 rute).
- [x] Semua alur transaksi lolos simulasi (22 skenario) tanpa sisa data.
- [x] Unggah berkas: bucket, batas ukuran/tipe, hak akses diuji.
- [x] Hapus akun, kebijakan privasi, S&K, jawaban Data safety.
- [x] Build APK otomatis (build-24) dan web live.
- [ ] Payment gateway Midtrans: kunci sandbox (Senin) → produksi (setelah review Midtrans).
- [ ] Keystore + secrets → AAB bertanda tangan (Selasa).
- [ ] Listing Play Console + review Google.

## D. Yang tidak bisa dikerjakan AI dan alasannya
- Membuat akun / login ke Google Play Console, Midtrans, atau memasukkan kata sandi & kunci API: kebijakan keamanan — pemilik yang melakukannya, kunci dimasukkan lewat Panel Admin/GitHub Secrets, bukan lewat chat.
- Menghasilkan keystore: harus dibuat dan disimpan oleh pemilik (kehilangan keystore = tidak bisa update aplikasi).
- Uji di HP nyata (kamera, GPS, notifikasi push): perlu perangkat fisik — gunakan APK build-24.
