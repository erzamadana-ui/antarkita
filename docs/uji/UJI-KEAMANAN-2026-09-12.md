# Uji Keamanan AntarKita — 12 September 2026
Cakupan: aplikasi mobile (Pelanggan/Mitra), Panel Admin & Portal Eksekutif (web), database Supabase (RLS, fungsi RPC, storage, Edge Function, konfigurasi Auth).
Metode: (1) Supabase Security Advisor; (2) uji tembus langsung di database dengan peran `anon` dan `authenticated` (JWT pelanggan/driver/merchant uji) mencoba 40 aksi eskalasi/kebocoran; (3) audit statis kode klien, workflow CI, dan Edge Function; (4) verifikasi ulang setelah perbaikan + simulasi E2E penuh.

## Ringkasan
| Tingkat | Ditemukan | Ditutup hari ini | Sisa (butuh pemilik/plan) |
|---|---:|---:|---:|
| Tinggi | 3 | 3 | 0 |
| Sedang | 6 | 6 | 0 |
| Rendah | 6 | 4 | 2 |

Hasil verifikasi akhir: 40 aksi tembus → 0 yang lolos; simulasi E2E **201 OK / 0 BUG** dengan pengerasan aktif.

## Temuan & tindakan
| # | Area | Temuan | Tingkat | Tindakan | Status |
|---|---|---|---|---|---|
| T1 | Auth | Site URL Supabase = `http://localhost:3000`, allow-list redirect KOSONG → tautan reset kata sandi mengarah ke localhost (penyebab "email masuk tapi tidak bisa reset") | Tinggi | Site URL → `https://erzamadana-ui.github.io/antarkita/`; redirect `…/antarkita/**` + `…/antarkita/`; diverifikasi lewat `/auth/v1/verify` mengarah ke situs | Selesai |
| T2 | DB | Driver bisa mengubah sendiri `vehicle_class`/`vehicle_capacity`/`verify_score`/`probation_until`/`code`/`vehicle_type` lewat UPDATE langsung (policy `drivers_update_own`) → naik kelas tarif tanpa persetujuan admin | Tinggi | Guard trigger `guard_driver_update` diperluas (0086); uji ulang: ditolak | Selesai |
| T3 | Edge | `push-send` hanya `verify_jwt` → JWT pengguna biasa bisa mengirim notifikasi ke pengguna mana pun (spam/phishing) | Tinggi | Cek peran di dalam fungsi: hanya `service_role` (pg_net) atau admin; deploy v2 | Selesai |
| T4 | DB | Merchant bisa mengubah `verify_score`/`probation_until`/`status_reason` sendiri | Sedang | Guard `guard_merchant_update` diperluas (0086) | Selesai |
| T5 | DB | Pekerjaan latar (`osm_import_tick`, `push_dispatch`, `release_scheduled_orders`, `push_requeue_stuck`, `osm_auto_refresh`, `run_*`) bisa dipanggil setiap pengguna login → pemicu HTTP/DoS | Sedang | `assert_background_or_admin()` disisipkan; hanya cron/service_role/admin | Selesai |
| T6 | DB | `admin_city_drivers` tanpa cek admin | Sedang | Dibuat ulang dengan `is_admin()` | Selesai |
| T7 | Portal Eksekutif | `exec_login` tanpa kunci percobaan PIN (brute force 6 digit) | Sedang | 5 gagal → kunci 15 menit; token sesi 32 byte acak (bukan md5) | Selesai |
| T8 | Mobile | Kredensial TURN statis (`EXPO_PUBLIC_TURN_USER/PASS`) masih bisa tertanam di APK lewat workflow | Sedang | Fallback dihapus dari `src/lib/call.ts` & workflow; TURN hanya kredensial berumur pendek (0082) | Selesai |
| T9 | Auth | Kebijakan kata sandi server: minimal 6, tanpa syarat karakter (klien sudah 8 + huruf&angka, tapi bisa dilewati via API) | Sedang | Dashboard: minimal 8, wajib huruf & angka | Selesai |
| T10 | DB | Fungsi trigger & fungsi internal (osm_*, push_enqueue, exec_*_data, qa_run_script) bisa di-EXECUTE anon/authenticated | Rendah | Dicabut (0086) | Selesai |
| T11 | DB | `app_settings` terbaca `anon` (87 kunci konfigurasi bisnis) | Rendah | Hanya `authenticated`; anon memakai `app_public_settings()` | Selesai |
| T12 | DB | `search_path` tidak dikunci pada 2 fungsi | Rendah | Dikunci (0086) | Selesai |
| T13 | Mobile | `allowBackup` bawaan Expo = true → sesi bisa disalin via `adb backup` | Rendah | `android.allowBackup: false` di app.config.ts (berlaku di build berikutnya) | Selesai |
| T14 | Auth | Leaked Password Protection (HaveIBeenPwned) nonaktif | Rendah | Fitur plan Pro — dashboard menolak di plan Free | **Pemilik: upgrade plan bila diinginkan** |
| T15 | DB | `spatial_ref_sys` (tabel referensi PostGIS, data publik) terbaca anon; ekstensi postgis/pg_trgm di skema public | Rendah | Tidak bisa dicabut (grant milik supabase_admin); memindahkan ekstensi berisiko merusak fungsi geo | Diterima (tanpa data sensitif) |

## Yang diuji dan AMAN (tidak perlu perubahan)
- Eskalasi peran: pengguna tidak bisa mengubah `role`/`is_active` sendiri (trigger profil), tidak bisa menyetujui driver/merchant sendiri, tidak bisa mengambil alih merchant lain.
- Dompet: saldo & mutasi tidak bisa diubah/insert langsung (RLS 0 baris); semua lewat RPC dengan buku besar (S53 invarian global OK).
- Kebocoran data: `anon` tidak bisa membaca profiles/orders/drivers/promos/wallets; pengguna login hanya melihat profil lawan transaksinya sendiri; dokumen KTP/SIM (bucket `documents`) hanya pemilik + admin; bukti (`proofs`) hanya pihak order/tiket.
- Panel Admin: kunci PIN dengan 5 percobaan/15 menit, sesi buka kunci berbatas waktu, semua RPC `admin_*` memeriksa `is_admin()` (diperiksa 90+ fungsi).
- Webhook Midtrans: verifikasi `signature_key` SHA-512 sebelum memproses; idempoten (S46c).
- Edge Function `osm-import` & `turn-credentials`: memeriksa service_role/admin/JWT pengguna; rahasia (Cloudflare, Stadia, Midtrans) tidak pernah dikirim ke klien (tabel `*_secrets` tanpa policy).
- Klien: hanya `anon key` + URL yang tertanam; tidak ada service_role/API key di repo; HTTPS saja.

## Rekomendasi lanjutan (belum dikerjakan — keputusan pemilik)
1. Custom SMTP (Resend/Brevo/SES) untuk email Auth: template bisa diedit (tautan `token_hash`, kode OTP), batas kirim bawaan hanya beberapa email/jam — **wajib sebelum listing nasional**.
2. Upgrade plan Supabase (Pro) untuk Leaked Password Protection, PITR backup, dan batas rate limit yang lebih longgar.
3. Privasi nomor telepon: policy `profiles_select` mengizinkan lawan transaksi melihat `phone`/`email`; pertimbangkan menyamarkan nomor (hanya lewat telepon dalam aplikasi) sesuai UU PDP — perlu keputusan produk karena mengubah alur CS/driver.
4. Uji penetrasi independen + uji beban sebelum listing nasional (sesuai Standar Testing v1.0).

Keterbatasan: uji dilakukan dari dalam database (peran disimulasikan) dan audit statis; belum termasuk uji jaringan dari perangkat nyata (MITM/pinning) dan uji beban.
