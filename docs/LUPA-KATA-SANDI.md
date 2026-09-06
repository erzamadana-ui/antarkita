# Lupa kata sandi & ganti kata sandi (verifikasi email) — AntarKita

Berlaku untuk aplikasi Pelanggan, Mitra, dan Admin (kode yang sama, `src/screens/auth/forgot.tsx` & `reset.tsx`).

## Alur pengguna
1. Layar **Masuk** → tautan **Lupa kata sandi?** → halaman *Lupa kata sandi* (email terisi otomatis bila sudah diketik).
2. Kirim → Supabase Auth mengirim email pemulihan (`resetPasswordForEmail`, `redirect_to` = beranda web aplikasi yang sama: `…/antarkita/`, `…/antarkita/mitra/`, `…/antarkita/admin/`). Layar "Cek email Anda" + tombol kirim ulang (jeda 60 detik). Pesan tidak membocorkan apakah email terdaftar.
3. Pengguna mengetuk **Reset Password** di email → Supabase memverifikasi token → mengarahkan ke beranda web dengan `#access_token=…&type=recovery`.
4. `RootLayout` (web) membaca token dari URL (langsung di hash, atau lewat `?r=` bila melewati 404 GitHub Pages), membuat sesi pemulihan, menghapus token dari URL, dan **memaksa** ke layar *Buat kata sandi baru* (semua rute lain diblokir selama `recovery`).
5. Kata sandi baru (min. 8 karakter, huruf + angka, indikator kekuatan, ulangi) → `updateUser({ password })` → "Kata sandi diperbarui" → Lanjut ke aplikasi (sesi tetap). Tautan kedaluwarsa/sudah dipakai → pesan + langsung ke halaman Lupa kata sandi.
6. Alternatif tanpa tautan: layar *Buat kata sandi baru* saat belum masuk menerima **kode 6 digit** dari email (`verifyOtp type=recovery`) — hanya bekerja bila template email Supabase menyertakan `{{ .Token }}` (lihat bawah).
7. Pengguna yang sudah masuk: **Akun → Ganti kata sandi** (`/account/password`, layar yang sama tanpa mode pemulihan).

## Di APK Android
Tautan email membuka halaman **web** AntarKita (bukan aplikasi) — di sana kata sandi baru dibuat, lalu pengguna masuk lagi di APK dengan kata sandi baru. Ini disengaja: tidak butuh App Links/assetlinks (butuh SHA-256 keystore rilis) dan bekerja di semua perangkat. Bila kelak diinginkan buka langsung di aplikasi, tambahkan intent-filter `https://erzamadana-ui.github.io/antarkita/*` + `assetlinks.json` setelah keystore rilis ada.

## Konfigurasi Supabase yang WAJIB dicek pemilik (Dashboard → Authentication)
| Pengaturan | Nilai |
|---|---|
| URL Configuration → **Site URL** | `https://erzamadana-ui.github.io/antarkita/` |
| URL Configuration → **Redirect URLs** | `https://erzamadana-ui.github.io/antarkita/`, `https://erzamadana-ui.github.io/antarkita/mitra/`, `https://erzamadana-ui.github.io/antarkita/admin/`, `https://erzamadana-ui.github.io/antarkita/**` |
| Email Templates → **Reset Password** | Disarankan Bahasa Indonesia + kode: lihat template di bawah |
| Rate limits → Email | Bawaan Supabase (SMTP internal) sangat terbatas (≈ 2–4 email/jam) dan **hanya untuk pengujian** — untuk produksi wajib **Custom SMTP** (mis. Resend/Brevo/SES) di Project Settings → Auth → SMTP |

Bila `redirect_to` tidak ada di daftar Redirect URLs, Supabase memakai Site URL — alur tetap bekerja selama Site URL adalah beranda web AntarKita.

### Template email "Reset Password" yang disarankan
```html
<h2>Atur ulang kata sandi AntarKita</h2>
<p>Ketuk tombol di bawah untuk membuat kata sandi baru (berlaku 1 jam):</p>
<p><a href="{{ .ConfirmationURL }}">Reset Password</a></p>
<p>Atau masukkan kode ini di aplikasi: <b>{{ .Token }}</b></p>
<p>Abaikan email ini bila Anda tidak meminta pengaturan ulang kata sandi.</p>
```

## Validasi yang sudah dilakukan (6 Sep 2026)
- Simulasi UI (Playwright, API Supabase di-mock): 19 pemeriksaan LOLOS — tautan Lupa kata sandi, validasi email, `POST /auth/v1/recover` (email huruf kecil + redirect_to), layar "Cek email", hitung mundur kirim ulang, tautan email dengan hash → layar Buat kata sandi baru, hash dibersihkan dari URL, varian `?r=` (404 GitHub Pages), validasi kekuatan & kecocokan, `PUT /auth/v1/user`, layar sukses → beranda, tautan kedaluwarsa → halaman Lupa kata sandi, mode kode (`POST /auth/v1/verify type=recovery`), halaman Ganti kata sandi untuk pengguna masuk.
- Uji langsung ke Supabase produksi: permintaan pemulihan untuk akun pemilik → email diterima → tautan membuka layar Buat kata sandi baru di web live (kata sandi tidak diubah oleh AI).
