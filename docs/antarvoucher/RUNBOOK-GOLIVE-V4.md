# Runbook Go-Live v4 (Finpay v3 + AntarVoucher) & Kesiapan Google Play

Disetujui GM di chat, 25 Sep 2026: go-live penuh. Flag pembelian AntarVoucher dan Finpay tetap OFF, dan tidak ada transaksi uang nyata.

## 0. Prasyarat (status 25 Sep 2026)

| # | Syarat | Status |
|---|---|---|
| P1 | Branch `finpay-v3`, `antarvoucher-v4`, `landing-v4` ada di GitHub | ✅ dipush Erza 25 Sep 2026 (b92a376); commit kecil berikutnya lewat editor web GitHub |
| P2 | Uji kering migrasi 0098–0112 pada replika produksi | ✅ Replika dibuat dengan menyalin 52 fungsi produksi ke DB lokal pada status 0097. Skema aplikasi identik (selisih hanya ekstensi PostGIS dan `qa_sim_log`). Hasil: 15/15 migrasi ok; e2e 228, v2 124, v3 62, AntarVoucher 22, keamanan 5 — semua lulus |
| P3 | Temuan penting | Migrasi yang menambah nilai ENUM (0100, 0106) tidak boleh digabung dalam satu transaksi. Terapkan **satu transaksi per berkas**, berurutan |
| P4 | Produksi pra-migrasi | AntarPay OFF (audit_logs #14205), saldo semua Rp0, `topup_requests` 0, `wallet_transactions` 87 baris seimbang |

## 1. Jendela rilis (±30 menit, dikerjakan Claude) — DIJALANKAN 25 Sep 2026 23:10–23:40 WIB

Hasil: snapshot `backup_20260925` (wallets 21, wallet_transactions 87, orders 32, payments 12, app_settings 91); 0098–0112 diterapkan lewat `net.http_get` dari raw GitHub @b92a376 + verifikasi md5 → `execute` per berkas; pasca-cek: dompet≠Σmutasi 0, ledger order tak seimbang 0, flag pembelian OFF, provider midtrans, rekening publik 0; 0113 (cabut EXECUTE fungsi trigger) diterapkan. PR #9.

1. **Snapshot** tabel uang dan konfigurasi ke skema `backup_20260925`: `wallets`, `wallet_transactions`, `topup_requests`, `withdrawal_requests`, `payments`, `orders`, `app_settings`, `profiles(id, role, admin_role, is_active)`.
2. **Migrasi 0098 → 0112**, satu berkas per transaksi. Tiap berkas dicatat ke `supabase_migrations.schema_migrations` (version `20260925<nnnn>00`). Bila satu berkas gagal: **berhenti**. Berkas itu otomatis batal, dan berkas sebelumnya tetap sah karena kompatibel dengan web lama.
3. **Verifikasi DB:**
   - dompet = Σ mutasi (0 selisih);
   - `antarvoucher_purchase_enabled=false`;
   - `payment_provider_active=midtrans`;
   - rekening publik = 0;
   - Advisors Supabase (keamanan) ditinjau.
4. **PR** `antarvoucher-v4` → `main` di GitHub. Isinya juga membawa `finpay-v3`. Tunggu `ios.yml` (tsc) hijau, lalu **merge**. `web.yml` menerbitkan 3 aplikasi ke apps.antarkitaindonesia.com.
5. **Smoke test live:**
   - `/`, `/mitra/`, `/admin/`, `/privacy/`, `/terms/`, `/hapus-akun/` → 200, tanpa blank page, tanpa error konsol;
   - login admin, lalu menu AntarVoucher & Gateway terbuka;
   - pelanggan: beranda, estimasi tarif, order tunai **tidak dibuat** (tanpa uang/driver nyata);
   - hash commit di bundel web sama dengan `main`.
6. **Landing:** PR `landing-v4` → main (antarkitaindonesia.com). Placeholder hukum masih tampil `[PERLU KONFIRMASI]`, jadi merge **hanya** atas persetujuan GM.

## 2. APK internal & AAB Play

- **APK internal:**
  - Actions → "Android APK" → Run workflow → branch `main` (setelah merge) atau `antarvoucher-v4`.
  - Dari branch non-main, nama berkas berakhiran `-INTERNAL` dan aplikasi menampilkan pita "INTERNAL TESTING".
  - SHA-256 tercatat di ringkasan run dan di berkas `.sha256`.
- **AAB Play:**
  - Actions → "Play Store AAB" → `app=both`, `dompet=off`.
  - Hasilnya GitHub Release `aab-N` + `SHA256SUMS.txt`.
  - versionCode = run + offset; versionName = 3.1.0.
- **Kunci tanda tangan:**
  - APK dari CI kini memakai **upload keystore** yang sudah terdaftar di Play Console → Android developer verification (id.antarkita.app & id.antarkita.mitra: Registered, 3 kunci).
  - Mulai **30 Sep 2026**, APK di luar Play dengan kunci tak terdaftar (mis. kunci debug) **tidak bisa dipasang** di perangkat bersertifikat di negara terpilih.

## 3. Kirim ke Google Play (akun perorangan)

1. **Unggah AAB `aab-N`:**
   - Pelanggan: Closed testing – Alpha.
   - Mitra: track yang sama.
   - Batas unggah lewat otomasi Chrome 10 MB, jadi unggahan dilakukan **Erza**, atau otomatis bila secret `PLAY_SERVICE_ACCOUNT_JSON` diisi.
2. **App content → Financial features:** ubah menjadi *"My app doesn't provide any financial features"*. Ini benar **hanya** untuk AAB `dompet=off`.
   - Pembayaran per pesanan lewat payment gateway adalah checkout jasa, bukan dompet.
   - Pencairan pendapatan mitra tersembunyi di build ini.
3. **Data safety:** hapus jenis data "Financial info → Purchase history/other" yang terkait saldo bila tidak lagi dikumpulkan app. Pertahankan data pembayaran per pesanan.
4. Balas penolakan 19 Sep di Policy status bahwa fitur dompet dihapus dari build, lalu **Send for review**.
5. Dompet atau AntarVoucher baru boleh kembali ke Play setelah **akun organisasi** (badan usaha + D-U-N-S) dan kajian legal V2.

## 4. Rollback

- **Web:** revert merge PR di GitHub. Pages akan menerbitkan ulang versi sebelumnya.
- **DB fungsional:** flag tetap OFF. Bila ada fungsi bermasalah, `supabase/rollback/0112_down.sql` … `0105_down.sql` berurutan. Rollback 0098–0104 tidak tersedia; mitigasinya memulihkan tabel dari `backup_20260925`.
- **APK:** pasang build sebelumnya dari Releases (`main`).

---
*Keterbatasan: uji kering memakai replika (fungsi identik dengan produksi, data = seed uji), bukan salinan data produksi. Uji di HP fisik belum dilakukan.*
