# Laporan Audit UI/UX — Web Mobile AntarKita (Pelanggan · Mitra · Admin)

Tanggal: 25 September 2026 · Branch: `antarvoucher-v4` (473589d) dibandingkan dengan `origin/main` (81e040c)
Status perubahan kode: **belum di-commit** (4 berkas, lihat §4).

## 1. Ringkasan

- **Tidak ada temuan P0** (tidak ada crash, halaman kosong, overflow horizontal dokumen, atau console error di 75 kombinasi halaman × lebar pada build AFTER final).
- **5 temuan P1 diperbaiki** (F1–F4 dan R1), **5 temuan P2 diperbaiki** (F5–F9), dan **regresi label tab R2 diperbaiki sebagian** (360–430 px beres, 320 px masih terpotong seperti di main).
- **Masih ada: 2 P2 dan beberapa P3.** Rinciannya ada di §3.
- Jumlah teks yang terpotong "…" di halaman yang diaudit turun dari **190 menjadi 30**. Sisanya sebagian besar label tab bar di 320 px dan placeholder kolom pencarian.
- **Pembaruan akhir:** koordinator memperbaiki R1 (`earnings.tsx`: kartu statistik membungkus) dan R2 (`customer/_layout.tsx`: label tab "Voucher"). Build AFTER pelanggan dan mitra dibangun ulang dengan `--clear`, seluruh halaman AFTER diambil ulang di semua lebar, dan cek otomatis dijalankan ulang. Status R1 dan R2 di bawah didasarkan pada hasil itu.

## 2. Metode

1. **Build web.** Tiga build dibuat dengan `expo export --platform web --clear`, dengan `EXPO_PUBLIC_BASE_URL=''` dan cache Metro dibersihkan pada tiap build:
   - **BEFORE**: build `origin/main` lewat `git worktree`. Hanya pelanggan dan mitra.
   - **AFTER pra-fix**: branch apa adanya.
   - **AFTER**: branch dengan perbaikan audit ini.
   - Build tambahan dengan `EXPO_PUBLIC_BUILD_CHANNEL=internal` untuk menguji pita INTERNAL TESTING.
   - Semua build disajikan oleh server statis kecil dengan fallback SPA (`harness/serve.mjs`).
2. **Mock Supabase.** Mock dibuat dengan Playwright `page.route` (`harness/mock.mjs`), karena container tidak punya akses ke supabase.co. Isinya:
   - Sesi login disuntikkan ke `localStorage` (`sb-qwltshvzrsykxdvhbxcv-auth-token`, JWT palsu, `expires_at` tahun 2100).
   - Profil: customer, driver, atau admin superadmin (PIN sudah terbuka).
   - Saldo Rp125.000, 4 transaksi dompet, `app_public_settings` (AntarVoucher dan semua saluran aktif).
   - `voucher_status_public` dalam dua varian: pembelian ditutup dan dibuka.
   - **Rekening CONTOH**: BRI `0000000000` a.n. "PT Antar Kita Indonesia (CONTOH)".
   - 5 riwayat pembelian dengan berbagai status, `voucher_purchase_create`, `wallet_statement`.
   - Antrean, mutasi, dan rekening admin, serta `admin_wallet_reconcile`.
   - RPC atau tabel lain dijawab `[]` dengan status 200. Realtime (WebSocket) ditelan, dan host luar (tile peta dan sebagainya) diblokir.
3. **Tangkapan layar.** Lebar yang dipakai: 320, 360, 375, 390, 412, 430, dan 768 px. Tinggi 844 px, deviceScaleFactor 2, emulasi mobile dan sentuh, reduced-motion. Admin memakai 390, 768, dan 1366 px. Per halaman ada dua gambar: layar pertama (`-top.png`) dan seluruh panjang konten.
4. **Cek otomatis** per halaman × lebar (`harness/capture.mjs`), hasilnya di `hasil-cek-otomatis.json` dan `RINGKASAN-CEK-OTOMATIS.md`:
   - overflow horizontal dokumen, termasuk bila viewport layout melebar;
   - elemen yang keluar dari tepi kanan;
   - teks terpotong tanpa elipsis dan teks dengan elipsis;
   - teks di bawah 12 px;
   - target sentuh di bawah 44×44 (tautan di dalam paragraf diabaikan);
   - elemen interaktif yang tertutup bar bawah setelah digulir ke akhir;
   - console error.
5. **Skala font 130 %** pada layar voucher di lebar 360. Pendekatannya: `font-size` dan `line-height` setiap elemen teks dikali 1,3, sedangkan kotak layout tetap. Ini meniru `fontScale` Android yang menskalakan teks RN.
6. **Pemeriksaan visual.** Semua temuan di bawah dipastikan dengan melihat tangkapan layarnya langsung. Cek otomatis tidak menangkap angka yang patah per digit, karena teks itu membungkus, bukan terpotong.

## 3. Matriks temuan

Prioritas: **P0** = memblokir atau risiko uang/keamanan · **P1** = informasi penting tidak terbaca atau aksi utama tidak terlihat · **P2** = tampilan rusak atau terpotong tetapi masih bisa dipakai · **P3** = kosmetik atau pedoman.
Semua berkas bukti ada di bawah `shots/`.

| # | P | Halaman / lebar | Masalah | Bukti (sebelum → sesudah) | Status |
|---|---|---|---|---|---|
| F1 | P1 | Pelanggan · Instruksi transfer · 320, dan 360 dengan font ×1,3 | Kotak "Sisa waktu transfer" terjepit oleh kolom tanggal "s.d. …" sehingga hitung mundur pecah per kata ("23 / jam / 59 / mnt"), bahkan per huruf ("wakt u") saat font diperbesar | `after-prafix/pelanggan-voucher-instruksi-320-top.png`, `after-internal-prafix/pelanggan-voucher-instruksi-360-font130-top.png` → `after/pelanggan-voucher-instruksi-320-top.png`, `after/pelanggan-voucher-instruksi-360-font130-top.png` | **Diperbaiki** |
| F2 | P1 | Pelanggan · Instruksi transfer · 360 dengan font ×1,3 | Kode referensi terpotong "AKV-250925-0…" (`numberOfLines=1`; `adjustsFontSizeToFit` tidak berlaku di web). Nomor rekening BRI asli berisi 15 digit, jadi akan terpotong di 320 px atau saat font diperbesar. Nomor wajib terbaca utuh | `after-internal-prafix/pelanggan-voucher-instruksi-360-font130-top.png` → `after/pelanggan-voucher-instruksi-360-font130-top.png` | **Diperbaiki**: nilai tidak pernah dipotong, tombol "Salin" turun ke baris berikutnya bila tidak muat |
| F3 | P1 | Pelanggan dan Mitra · Beli AntarVoucher, "Pembelian saya" · 320 dan 360 | Judul baris terpotong jadi "Voucher …", sehingga nominal voucher tidak terlihat | `after-prafix/pelanggan-voucher-tutup-320.png`, `after-prafix/pelanggan-voucher-buka-360.png` → `after/pelanggan-voucher-buka-320.png` | **Diperbaiki**: nominal di baris sendiri, "Transfer Rp…" di bawahnya |
| F4 | P1 | Admin · AntarVoucher · 1366 | Tabel 8 kolom (±1.176 px) di area konten ±1.070 px. Kolom "Kedaluwarsa" terpotong dan kolom **Aksi (Terbitkan/Cocokkan) berada di luar layar**. Petunjuk "geser tabel" hanya muncul di bawah 1280 px | `after-prafix/admin-voucher-1366-top.png` → `after/admin-voucher-1366-top.png` (lebar gulir 1070 = lebar tampak) | **Diperbaiki**: Transfer dan Diterima digabung, Kedaluwarsa pindah ke bawah Status, kolom pelanggan diberi lebar tetap (kolom flex melebar ke nama terpanjang), label header dipendekkan |
| F5 | P2 | Pelanggan · Beli voucher (dibuka) · 320–390 | Nama bank terpotong "Bank Rakyat In…" | `after-prafix/pelanggan-voucher-buka-320.png` → `after/pelanggan-voucher-buka-320.png` | **Diperbaiki** (maksimal 2 baris) |
| F6 | P2 | Pelanggan · Beli voucher (ditutup) · 320, dan 360 dengan font ×1,3 | Tombol utama terpotong "Top up instan sekara…" | `after-prafix/pelanggan-voucher-tutup-320.png` → `after/pelanggan-voucher-tutup-320.png` | **Diperbaiki** (label "Top up instan", font tidak dikecilkan) |
| F7 | P2 | Pelanggan · Dompet (Saldo) dan Mitra · Pendapatan · 320–430 | Kolom kanan "Saldo Rp…" memakan lebar, sehingga keterangan transaksi terpotong ("AntarVouche…") dan tanggal patah dua baris di 320 | `after-prafix/pelanggan-dompet-320-top.png` → `after/pelanggan-dompet-320-top.png` | **Diperbaiki**: keterangan dan nominal di baris 1 (keterangan boleh 2 baris), tanggal dan saldo di baris 2 |
| F8 | P2 | Semua halaman, build INTERNAL · 320–360 dengan font ×1,3 | Pita "INTERNAL TESTING — BUKAN VERSI PRODUKSI · 473589d" melebar melewati layar sehingga kedua ujungnya terpotong dan hash commit hilang | `after-internal-prafix/pelanggan-voucher-instruksi-360-font130-top.png` → `after-internal/pelanggan-voucher-instruksi-360-font130-top.png` | **Diperbaiki**: dibatasi lebar layar, boleh 2 baris |
| F9 | P2 | Admin · AntarVoucher · 390 | Teks jumlah "2 dari 6 pembelian · maks 200 terbaru" di kanan toolbar menjepit filter sehingga hanya "Menunggu d…" terlihat | `after-prafix/admin-voucher-390-top.png` → `after/admin-voucher-390-top.png` | **Diperbaiki**: jumlah pindah ke judul panel |
| R1 | P1 | Mitra · Pendapatan · 320 (juga di main) | Angka ringkasan patah per digit: "Rp1.250.00 / 0", "Rp4.875.00 / 0" | `before/mitra-pendapatan-320-top.png`, `after-prafix/mitra-pendapatan-320-top.png` → `after/mitra-pendapatan-320-top.png`, `after/mitra-pendapatan-360-top.png` | **Diperbaiki** (oleh koordinator, `src/screens/driver/tabs/earnings.tsx`): di 320 kartu menjadi satu kolom dan angka utuh; di 360 ke atas tetap dua kolom dengan angka utuh. Dipastikan secara visual |
| R2 | P2 (regresi) | Pelanggan · tab bar | Label tab "AntarVoucher" terpotong di **semua** lebar ponsel 320–430. Di main, "AntarPay" hanya terpotong di 320 | `before/pelanggan-beranda-390-top.png`, `after-prafix/pelanggan-beranda-390-top.png` → `after/pelanggan-beranda-390-top.png`, `after/pelanggan-beranda-320-top.png` | **Diperbaiki sebagian** (koordinator, `src/screens/customer/_layout.tsx`: label "Voucher"). Cek otomatis: tidak ada elipsis label tab di 360–430. **Di 320 masih terpotong** "Bera…", "Pesa…", "Vouc…", sama seperti di main (lebar tab bar dari `GlassTabBar`). Tab mitra "Pendapatan" juga masih terpotong di 320–412 (sudah begitu sejak main) |
| R3 | P2 | Pelanggan · Beranda · 320 | Tombol notifikasi dan dompet di header menempel ±3 px dari tepi kanan layar | `after/pelanggan-beranda-320-top.png` | **Belum** (`src/screens/customer/index.tsx`) |
| R4 | P2 (risiko) | Pelanggan · Instruksi transfer · 320 dengan font ×1,3, nominal ≥ Rp1 jt | Kotak jumlah transfer memakai `adjustsFontSizeToFit`, yang tidak berlaku di web. Nominal 28 px × 1,3 bisa terpotong bila tujuh digit atau lebih. Tidak muncul pada data uji (Rp100.742) | — | **Belum diuji penuh**. Saran: uji di APK dengan nominal 2 jt dan font terbesar |
| R5 | P3 | Beranda / Akun · semua lebar | Target sentuh di bawah 44 px: tombol ikon header 40×40, "Alamat tersimpan" tinggi 34, "Lihat semua" 82×16 | `after/pelanggan-beranda-360-top.png` | Belum (di luar cakupan) |
| R6 | P3 | Admin · semua lebar | Target sentuh di bawah 44: menu sidebar tinggi 36, chip filter tinggi 34, tombol ikon baris 32×32. Wajar untuk panel desktop dengan mouse, tetapi sempit di tablet | `after/admin-voucher-1366-top.png` | Belum (komponen `admin.tsx`) |
| R7 | P3 | Admin · AntarVoucher · 390 | 6 kartu statistik bertumpuk selebar penuh (±1,5 layar sebelum tabel) | `after/admin-voucher-390.png` | Belum (`StatCard`) |
| R8 | P3 | Build INTERNAL · web | Pita memakai font 10 px (di bawah 12 px, sengaja kecil). Di web `insets.top = 0` sehingga pita menutupi bagian atas header dan tombol kembali. `pointerEvents="none"` membuat sentuhan tidak terhalang. Di APK pita berada di area status bar | `after-internal/pelanggan-voucher-instruksi-320-top.png` | Tidak diubah (font tidak dikecilkan atau diubah, sesuai batasan) |

Catatan BEFORE: `/pay/voucher` belum ada di main dan menampilkan "Unmatched Route" bawaan Expo. Layar 404 itu bahkan melebarkan viewport layout (320 → 334 px). Top up di main masih memakai alur lama "transfer manual + unggah bukti" (`before/pelanggan-topup-360.png`). Di branch, alur itu diganti dua pilihan resmi (`after/pelanggan-topup-360.png`) tanpa masalah tata letak.

## 4. Perubahan kode (hanya tata letak, tidak ada font yang dikecilkan)

| Berkas | Perubahan |
|---|---|
| `src/screens/pay/voucher.tsx` | F1: hitung mundur satu kolom (label, sisa waktu, batas). F2: `CopyField` tanpa `numberOfLines`, `copyBox` dengan `flexWrap`, tombol "Salin" boleh turun baris. F3: baris pembelian menumpuk nominal dan jumlah transfer, referensi · bank maksimal 2 baris. F5: nama bank maksimal 2 baris. F6: label CTA "Top up instan" |
| `src/components/WalletView.tsx` | F7: baris transaksi dua tingkat (keterangan ↔ nominal, tanggal ↔ saldo), keterangan maksimal 2 baris, nominal tidak menyusut, `rowGap 0` saat membungkus |
| `src/screens/admin/voucher.tsx` | F4: kolom tabel antrean ±1.176 → ±950 px (Transfer+Diterima digabung, Kedaluwarsa di bawah Status, kolom pelanggan dan referensi mutasi lebar tetap, header dipendekkan). F9: jumlah baris pindah dari toolbar ke judul panel (antrean dan mutasi) |
| `src/screens/driver/tabs/earnings.tsx` (koordinator) | R1: kartu statistik `flexBasis`/`minWidth` 150 dan `Row` dengan `flexWrap` |
| `src/screens/customer/_layout.tsx` (koordinator) | R2: label tab pembayaran "Voucher" |
| `src/components/InternalBuildRibbon.tsx` | F8: bingkai `left/right: 8` dengan pita `maxWidth: 100%`, teks rata tengah, maksimal 2 baris |

`npx tsc --noEmit -p .` → **0 galat** (dijalankan ulang setelah perubahan koordinator). Hasil setelah perbaikan diukur pada build AFTER final: pelanggan dan mitra dibangun ulang setelah perubahan koordinator, admin tidak terpengaruh oleh kedua berkas itu, dan seluruh `shots/after/` diambil ulang dari build final. Lebar gulir tabel admin di 1366 px sama dengan lebar tampaknya (1070 = 1070), baik untuk antrean maupun mutasi.

## 5. Keterbatasan

- **Data mock**, bukan data produksi. Nama, rekening, dan nominal fiktif (rekening ditandai CONTOH). Teks panjang dari server (nama pelanggan, catatan transfer, alasan) bisa lebih panjang dari data uji.
- **Build web ≠ APK native.** RN-web berbeda dari Android/iOS pada: `adjustsFontSizeToFit` (tidak ada di web), safe-area insets (0 di web), font sistem, keyboard, gestur, dan status bar. Temuan R4 dan R8 khusus dipengaruhi perbedaan ini.
- **Tanpa perangkat nyata.** Emulasi Chromium (mobile/sentuh, DPR 2) dengan tinggi tetap 844 px. Tidak diuji pada layar sangat pendek, lanskap, atau notch.
- **Skala font diaproksimasi** dengan mengalikan `font-size`/`line-height` elemen teks sebesar 1,3 setelah render. Ini tidak sama persis dengan `fontScale` Android, yang juga memengaruhi ukuran yang dihitung komponen. Uji skala font hanya dijalankan pada layar voucher di 360 px.
- Cek otomatis bersifat heuristik. Teks yang **membungkus dengan buruk** (mis. R1) tidak terdeteksi, sehingga semua temuan dipastikan secara visual. Sebaliknya, "target < 44" di admin mencakup kontrol desktop yang wajar.
- Halaman diaudit dalam keadaan terang (tema selalu terang), bahasa Indonesia, dan tanpa alur modal atau dialog (dialog admin, formulir "Saya sudah transfer" dan "Laporkan masalah" tidak ditangkap).
- Admin BEFORE tidak dibangun, dan `/voucher` admin belum ada di main.

## 6. Berkas keluaran

- `shots/INDEX.md`: daftar pasangan BEFORE / AFTER pra-fix / AFTER.
- `shots/{before,after-prafix,after,after-internal-prafix,after-internal}/<app>-<halaman>-<lebar>[-font130][-top].png`
- `RINGKASAN-CEK-OTOMATIS.md`: tabel cek otomatis per fase. `hasil-cek-otomatis.json`: data mentah, termasuk daftar request yang dimock.
- `harness/`: `serve.mjs`, `mock.mjs`, `capture.mjs` (`node capture.mjs <fase> [regex]`), `summarize.mjs`, `index.mjs`, `probe.mjs`. `build.sh` ada di akar folder.
