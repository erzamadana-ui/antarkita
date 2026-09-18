# Audit Halaman Hukum vs Kode — 18 September 2026

Audit **baca-saja** atas `docs/rilis/privacy.html` (v1.1), `docs/rilis/terms.html` (v1.1), dan `docs/rilis/hapus-akun.html`
terhadap fitur yang benar-benar ada di kode per 18 Sep 2026. Tidak ada berkas lain yang diubah.
Nomor baris merujuk ke berkas HTML pada commit saat audit. Tanda **[ASUMSI]** = kesimpulan auditor, bukan fakta yang tertulis eksplisit di kode.

| # | Topik | privacy.html | terms.html | hapus-akun.html |
|---|-------|--------------|------------|-----------------|
| 1 | Saldo pelanggan tidak bisa ditarik (0090) | BELUM (bertentangan) | **BELUM (bertentangan)** | BELUM (bertentangan) |
| 2 | Sakelar saluran pembayaran per metode (0089) | — | BELUM | — |
| 3 | Lokasi presisi → Stadia Maps & pengguna lawan | SEBAGIAN | — | — |
| 4 | Nama/email/HP → Midtrans | SUDAH | SEBAGIAN | — |
| 5 | Daftar tunggu kota (`city_waitlist`) | BELUM | BELUM | BELUM |
| 6 | Laporan moderasi & blokir (0050) | SUDAH | SUDAH | SEBAGIAN |
| 7 | Masa simpan & jalur hapus sebagian data | SUDAH | — | SEBAGIAN |

---

## 1. Saldo AntarPay pelanggan TIDAK bisa ditarik — hanya mitra (migrasi 0090)

**Fakta kode.** `0090_tarik_saldo_hanya_mitra.sql` memasang `withdrawal_require_allowed()` di `request_withdrawal`: hanya peran `driver`, `merchant`, `admin` yang boleh menarik. Pelanggan ditolak dengan pesan *"Saldo AntarPay pelanggan dipakai untuk membayar layanan, bukan untuk dicairkan."* Sakelar `app_settings.customer_withdrawal_enabled` default `false`.

**Status: BELUM — ketiga halaman masih menyatakan sebaliknya.**

- `terms.html` baris 114: *"Saldo Pelanggan dapat ditarik kembali ke rekening bank atas nama sendiri"* — **bertentangan langsung** dengan 0090.
- `terms.html` baris 128: *"pengembalian ke rekening bank mengikuti proses penarikan"* — jalur ini tidak tersedia bagi pelanggan.
- `privacy.html` baris 112: *"pencairan dilakukan ke rekening bank atas nama Anda"* — tidak membedakan pelanggan/mitra.
- `privacy.html` baris 199 dan `hapus-akun.html` baris 81: *"tarik ke rekening bank atau habiskan dulu"* — pelanggan hanya bisa **menghabiskan**; instruksi "tarik" menyesatkan dan bisa membuat syarat hapus akun tak terpenuhi bagi pelanggan bersaldo.

**Usulan kalimat (terms.html, ganti kalimat kedua di baris 114):**
> Saldo AntarPay Pelanggan hanya dapat dipakai untuk membayar layanan di Platform dan **tidak dapat ditarik ke rekening bank**. Penarikan saldo ke rekening bank atas nama sendiri hanya tersedia bagi Mitra (driver, merchant, pedagang pasar, mitra travel) untuk pendapatan yang diperolehnya, sesuai jadwal dan batas minimum yang berlaku.

**Usulan kalimat (terms.html, baris 128):**
> Pengembalian dana untuk pembayaran AntarPay dikreditkan kembali ke saldo AntarPay maksimal 3 hari kerja setelah disetujui. Pengembalian ke rekening bank hanya dilakukan atas top-up yang terbukti salah atau atas kebijakan kami, lewat tiket aduan.

**Usulan kalimat (privacy.html baris 112, ganti kalimat terakhir):**
> Pencairan ke rekening bank hanya tersedia bagi Mitra atas pendapatannya; saldo Pelanggan tidak dapat dicairkan.

**Usulan kalimat (privacy.html baris 199 & hapus-akun.html baris 81):**
> Saldo AntarPay Rp0 — Pelanggan: habiskan saldo untuk pembayaran layanan; Mitra: tarik pendapatan ke rekening bank atau habiskan. Bila saldo Pelanggan tidak dapat dihabiskan, hubungi CS untuk penyelesaian manual.

[ASUMSI] Jalur "penyelesaian manual lewat CS" untuk saldo sisa pelanggan belum ada di kode; kalimat ini mengandaikan prosedur CS. Bila tidak ingin berjanji, hapus kalimat terakhir.

---

## 2. Sakelar saluran pembayaran per metode oleh admin (migrasi 0089)

**Fakta kode.** `0089_saluran_bayar_toggle.sql`: `app_settings.payment_channels` (cash, antarpay, emoney_nfc, gopay, shopeepay, qris, ovo, dana, bank_transfer, card) bisa dinyalakan/dimatikan satu per satu dari Panel Admin; penegakan di `create_order`, `travel_book`, `travel_request_create`, `request_topup`, dan edge function `midtrans-create`. Sakelar global 0088 (`antarpay_enabled`) menjadi induk: bila mati, semua saluran non-tunai mati.

**Status: BELUM.** `terms.html` baris 113 hanya menyebut *"atau metode lain yang tersedia di aplikasi"* dan baris 97 *"Ketersediaan layanan bergantung pada kota, jam operasional"* — tidak ada penjelasan bahwa metode pembayaran (termasuk AntarPay sendiri) dapat dinonaktifkan sementara. privacy.html tidak perlu memuat ini (bukan soal data).

**Usulan kalimat (terms.html, tambah butir di bagian 5 setelah baris 113):**
> Ketersediaan setiap metode pembayaran nontunai (AntarPay, e-money, GoPay, ShopeePay, QRIS, OVO, DANA, transfer bank/VA, kartu) dapat kami **nonaktifkan sementara** tanpa pemberitahuan sebelumnya — misalnya karena gangguan penyedia, pemeliharaan, atau pertimbangan keamanan. Pembayaran **tunai kepada Mitra selalu tersedia**. Pesanan atau top-up dengan metode yang sedang nonaktif akan ditolak dan aplikasi menampilkan alasannya; saldo AntarPay Anda tetap tersimpan dan dapat dipakai kembali setelah metode diaktifkan.

---

## 3. Data lokasi presisi dibagikan ke penyedia peta Stadia Maps dan ke pengguna lawan

**Fakta kode.** `src/lib/mapConfig.ts` baris 66–74: penyedia bawaan `stadia` untuk ubin, geocode, dan rute (keputusan komisaris 16 Sep 2026). `src/lib/geo.ts` baris 154, 255, 399: koordinat presisi dikirim ke `api.stadiamaps.com` untuk autocomplete (dengan teks yang diketik pengguna), reverse geocode, dan rute. Penyedia dapat diganti ke Mapbox/Google dari Panel Admin tanpa rilis ulang. Alamat hasil reverse geocode disimpan di cache bersama (`cache_address`, geo.ts baris 241).

**Status: SEBAGIAN.**
- `privacy.html` baris 139: *"penyedia peta (OpenStreetMap/Leaflet untuk tampilan peta)"* — **usang**: produksi memakai Stadia Maps, dan yang dikirim bukan hanya "tampilan peta" tetapi koordinat presisi untuk pencarian alamat dan rute.
- `privacy.html` baris 137: *"mitra melihat nama depan, foto profil, titik jemput/antar"* — berbagi ke pengguna lawan **SUDAH**; posisi mitra ke pelanggan disebut di baris 98. Pelanggan yang melihat posisi driver secara langsung juga tercakup.
- English summary baris 233 *"map tiles"* — perlu diselaraskan.

**Usulan kalimat (privacy.html, ganti frasa di baris 139):**
> penyedia peta **Stadia Maps** (Stadia Maps, Inc., Amerika Serikat) — menerima koordinat titik jemput/antar dan posisi Anda saat aplikasi memuat ubin peta, mencari alamat (termasuk teks yang Anda ketik di kolom pencarian), menerjemahkan koordinat menjadi alamat, dan menghitung rute; tidak menerima nama, nomor HP, atau identitas akun Anda. Kami dapat mengganti penyedia peta (mis. Mapbox atau Google Maps Platform) dengan pemberitahuan di halaman ini.

**Usulan kalimat (privacy.html, tambah butir di bagian 3 setelah baris 99):**
> Alamat hasil penerjemahan koordinat disimpan dalam cache bersama tanpa dikaitkan dengan akun Anda, agar permintaan yang sama tidak dikirim ulang ke penyedia peta.

[ASUMSI] Lokasi Stadia Maps (AS) dan transfer lintas negara disimpulkan dari domain vendor; UU PDP Pasal 56 mewajibkan penyebutan transfer ke luar negeri — verifikasi dengan DPA Stadia sebelum ditempel.

---

## 4. Data nama/email/HP dikirim ke Midtrans

**Fakta kode.** `supabase/functions/midtrans-create/index.ts` baris 74–85: mengambil `full_name, email, phone` dari `profiles`, mengirim sebagai `customer_details` bersama `item_details` (nama item "Top up AntarPay" / "Pembayaran pesanan AntarKita"), jumlah, dan ID pesanan.

**Status: SUDAH (privacy.html) / SEBAGIAN (terms.html).**
- `privacy.html` baris 113: *"data yang diperlukan (jumlah, ID pesanan, nama, email, nomor HP) dikirim ke Midtrans"* — akurat dan lengkap.
- `terms.html` baris 113 menyebut Midtrans sebagai gateway tetapi tidak merujuk ke bagian privasi soal data yang dikirim.

**Usulan kalimat (terms.html, tambah di akhir baris 113):**
> Saat Anda memilih pembayaran lewat Midtrans, nama, email, dan nomor HP Anda diteruskan ke Midtrans untuk memproses transaksi (lihat Kebijakan Privasi bagian 5).

---

## 5. Daftar tunggu kota (`city_waitlist`) — data apa yang disimpan

**Fakta kode.** `0078_daftar_tunggu_kota.sql` baris 14–29: tabel menyimpan `user_id`, `city_id`, `city_name`, `province`, `services[]` (layanan yang diinginkan), `contact` (kontak opsional yang diketik pengguna), **`lat`/`lng` presisi**, `note`, `notified_at`, waktu. RLS: hanya pendaftar dan admin yang bisa membaca. `0079` baris 172–180: admin melihat nama + `coalesce(w.contact, pr.phone)`. `0077`/`0080`: koordinat pelanggan dipakai `city_at_point()`/`city_gate()` untuk menentukan kota — hanya perhitungan, tidak disimpan di tabel kota.

**Status: BELUM di ketiga halaman.** Tidak ada satu pun kata "daftar tunggu" / "kota belum dilayani" di privacy.html, terms.html, maupun hapus-akun.html. Tabel data (privacy.html baris 79–90) tidak memuat kategori ini.

**Usulan baris tabel (privacy.html, sisipkan setelah baris 82):**
> `<tr><td>Daftar tunggu kota</td><td>Bila Anda menekan "Beri tahu saya" di kota yang belum dilayani: kota dan provinsi, koordinat lokasi Anda saat itu, layanan yang Anda inginkan, kontak dan catatan yang Anda isi (opsional), serta waktu pendaftaran. Dipakai hanya untuk memutuskan kota berikutnya yang dibuka dan mengabari Anda.</td><td>Anda, saat mendaftar minat</td></tr>`

**Usulan baris retensi (privacy.html, sisipkan setelah baris 172):**
> `<tr><td>Daftar tunggu kota</td><td>Sampai layanan di kota tersebut dibuka dan Anda dikabari, atau sampai Anda menghapusnya sendiri; maksimal 24 bulan.</td></tr>`

**Usulan kalimat (terms.html, tambah di bagian 3 setelah baris 97):**
> Di kota yang belum dilayani, Anda dapat mendaftar di daftar tunggu. Pendaftaran tidak menjamin layanan akan dibuka di kota tersebut dan dibatasi maksimal 5 pendaftaran per jam.

[ASUMSI] Angka "maksimal 24 bulan" adalah usulan kebijakan, bukan implementasi — kode tidak punya pembersihan otomatis untuk `city_waitlist`. Lihat juga poin 7: baris daftar tunggu **tidak dihapus** saat akun dihapus karena `request_account_deletion` hanya menganonimkan profil (bukan `DELETE`), sehingga `on delete cascade` tidak pernah terpicu.

---

## 6. Laporan moderasi & blokir (migrasi 0050)

**Fakta kode.** `0050`: tabel `user_blocks` (blocker, blocked, reason, waktu) dan `content_reports` (reporter, target user, jenis target user/chat/call/review/merchant/merchant_photo/order/other, kategori pelecehan/penipuan/seksual/kekerasan/spam/lainnya, detail, status open/reviewed/actioned/rejected, SLA 48 jam, reviewer, tindakan). Penegakan: pencocokan driver, `nearby_drivers`, trigger pesanan AntarNow, trigger chat. Batas laju `report_content` 20/jam.

**Status: SUDAH (privacy & terms), SEBAGIAN (hapus-akun).**
- `privacy.html` baris 87 (kategori data), 127 (dasar hukum), 141 (siapa yang membaca), 169–170 (retensi) — lengkap dan sesuai kode.
- `terms.html` baris 171–175 — kategori, SLA 48 jam, efek blokir, batas laju: sesuai.
- `hapus-akun.html` baris 98: *"Daftar pengguna yang Anda blokir — Dihapus — Seketika"* — **tidak didukung kode**: `request_account_deletion` (0023) dan `admin_finalize_account_deletion` tidak menyentuh `user_blocks`; cascade tidak terpicu karena baris profil dipertahankan. Blokir yang Anda pasang tetap berlaku secara teknis (akun nonaktif), tetapi klaim "dihapus seketika" tidak benar.

**Usulan kalimat (hapus-akun.html, ganti baris 98):**
> `<tr><td>Daftar pengguna yang Anda blokir dan daftar tunggu kota</td><td>Dihapus permanen bersama identitas login</td><td><strong>Dalam 30 hari</strong></td></tr>`

[ASUMSI] Usulan ini mengandaikan `admin_finalize_account_deletion` akan ditambah `delete from user_blocks` dan `delete from city_waitlist`. Tanpa perubahan kode itu, kalimat yang jujur adalah "Dinonaktifkan bersama akun; baris tersimpan tanpa identitas".

---

## 7. Masa simpan & jalur hapus sebagian data

**Fakta kode.** `0023_hapus_akun.sql`: saat permintaan — nama → "Pengguna Terhapus", HP/email/foto/push token/kontak darurat → null, `is_active=false`, `banned_until=infinity`, status mitra → suspended. Finalisasi admin (manual, tanpa penjadwal otomatis): hapus NIK/SIM/URL dokumen driver, data pedagang pasar termasuk rekening bank, `auth.identities`, email auth diganti tombstone.

**Status: SUDAH (privacy.html bagian 9 & 11), SEBAGIAN (hapus-akun.html).**
- `privacy.html` baris 163–172: tabel retensi menyeluruh; baris 201 urutan hapus sesuai 0023.
- `hapus-akun.html` baris 94–100: sesuai, **kecuali** baris 98 (lihat poin 6) dan ketiadaan daftar tunggu kota serta alamat tersimpan.
- `hapus-akun.html` baris 108: jalur hapus sebagian *"Akun → Ubah profil"* vs privacy.html baris 182 *"Akun → Edit profil"* — label menu tidak konsisten. [ASUMSI] salah satu keliru; cek label sebenarnya di aplikasi.
- `hapus-akun.html` baris 61 *"paling lambat 7 hari kerja"* vs privacy.html baris 188 *"3×24 jam untuk konfirmasi"* — tenggat tanggapan email tidak konsisten antar halaman.
- Kode tidak menghapus **alamat tersimpan** dan **daftar tunggu** saat finalisasi; hapus-akun.html tidak menyebutnya. [ASUMSI] alamat tersimpan berisi koordinat rumah/kantor sehingga layak disebut eksplisit.

**Usulan kalimat (hapus-akun.html, tambah baris tabel setelah baris 100):**
> `<tr><td>Alamat tersimpan (rumah, kantor) dan pendaftaran daftar tunggu kota</td><td>Dihapus permanen</td><td><strong>Dalam 30 hari</strong></td></tr>`

**Usulan kalimat (hapus-akun.html, tambah di baris 108):**
> Anda juga dapat membatalkan pendaftaran daftar tunggu kota dan membuka blokir pengguna kapan saja dari dalam aplikasi tanpa menghapus akun. Kami menanggapi permintaan email paling lambat 3×24 jam dan menyelesaikannya dalam 30 hari.

---

## Ringkasan prioritas

1. **Segera (bertentangan dengan kode & deklarasi toko):** poin 1 — terms.html baris 114/128, privacy.html 112/199, hapus-akun.html 81. Klaim "pelanggan dapat menarik saldo" bertolak belakang dengan alasan 0090 (closed-loop, deklarasi Financial features Google Play).
2. **Sebelum rilis:** poin 3 (Stadia Maps sebagai penerima koordinat presisi — pihak ketiga baru yang belum dinamai) dan poin 5 (kategori data `city_waitlist` yang belum diungkap sama sekali, memuat koordinat + kontak).
3. **Perbaikan konsistensi:** poin 2, 4 (terms), 6/7 (hapus-akun.html baris 98, label menu, tenggat tanggapan).
4. Setelah ditempel, naikkan versi ketiga halaman ke **1.2** dan sebutkan ringkasan perubahan di header (pola sama seperti v1.1 di privacy.html baris 45 dan terms.html baris 42).

---

### Catatan keterbatasan data

- Audit dilakukan hanya terhadap berkas di repo (migrasi SQL, `src/lib/mapConfig.ts`, `src/lib/geo.ts`, edge function `midtrans-create`, tiga halaman HTML). Nilai **aktual** `app_settings` di basis data produksi (mis. `payment_channels`, `customer_withdrawal_enabled`, `map_config.tile_provider`) tidak diperiksa; status di produksi bisa berbeda dari default migrasi.
- Migrasi 0023 hanya dibaca sebagian (baris 70–150); tambalan `request_account_deletion` di 0026/0030 tidak menunjukkan penanganan `user_blocks`/`city_waitlist` berdasarkan grep, tetapi tidak dibaca utuh.
- Label menu di aplikasi ("Edit profil" vs "Ubah profil") dan tenggat tanggapan CS tidak diverifikasi terhadap kode UI.
- Lokasi server Stadia Maps dan ketentuan DPA-nya tidak diverifikasi; usulan kalimat poin 3 perlu dicek terhadap dokumen vendor.
- Angka retensi yang diusulkan (24 bulan daftar tunggu) adalah usulan kebijakan, bukan cerminan implementasi.
