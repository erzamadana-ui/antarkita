# Validasi Skema Bisnis v2 — Laporan Uji & Daftar Periksa Rilis Produksi

| Atribut | Keterangan |
|---|---|
| Tanggal | 23 September 2026 |
| Cabang / commit | `skema-bisnis-v2` @ `3a5e064` (migrasi `0098`–`0104`, edge function `midtrans-create` & `midtrans-webhook`, layar Admin/Pelanggan/Mitra/Eksekutif) |
| Lingkungan uji | PostgreSQL 16.13 lokal + PostGIS, stub Supabase (`scripts/db-lokal.sh`, `docs/UJI-DB-LOKAL.md`), Node v22.22.2, Expo CLI 57.0.21 |
| Rujukan | `docs/SKEMA-BISNIS-V2-SPEK.md` §10 (definisi selesai), `docs/bisnis/SKEMA-BISNIS-V2.md` |

Label angka: **[UJI LOKAL]** = hasil harness DB lokal (bukan produksi). **[DIUKUR]** = diukur pada sesi ini. **[FAKTA KODE]** = isi berkas di repo.

---

## 1. Ringkasan hasil

| Pemeriksaan | Hasil | Bukti |
|---|---|---|
| Migrasi 0001–0104 di DB lokal bersih | **Lulus.** 76 migrasi tercatat, terakhir diterapkan 2026-09-23 18:42:49 UTC | `scripts/db-lokal.sh status` |
| Simulasi E2E lama (regresi) | **Lulus: 228 OK, 0 BUG baru** | `/tmp/antarkita-db-lokal/test-simulasi_e2e.sql.log` |
| Uji Skema Bisnis v2 | **Lulus: 124 OK, 0 BUG, 0 GAGAL** | `/tmp/antarkita-db-lokal/test-uji_skema_bisnis_v2.sql.log` |
| Uji idempotensi create_order | **Lulus: 4 OK, 1 LEWAT** | `/tmp/antarkita-db-lokal/test-uji_idempotensi.sql.log` |
| `npx tsc --noEmit` (src, apps, app.config.ts) | **Bersih** (exit 0, tanpa keluaran) | [DIUKUR] |
| Web export Pelanggan / Mitra / Admin | **Berhasil semua** (exit 0) | §4 [DIUKUR] |
| Simulator xlsx (uji silang terhadap log) | **6/6 blok LULUS, selisih 0**, 1.081 rumus, 0 error | `docs/bisnis/Simulator-Unit-Economics-AntarKita-v2.xlsx` |

### 1.1 Baris ringkasan harness (dikutip persis)

Berkas log berisi baris `Sxx OK|BUG`. Baris ringkasan di bawah dicetak oleh `run_test()` di `scripts/db-lokal.sh`. Untuk laporan ini, baris tersebut dibangkitkan ulang dari log dengan regex yang sama (`(^|\s)S[0-9]+[a-z]*\s+OK\b|\[OK\]`) dan daftar `scripts/db-lokal/bug-dikenal.txt`:

```
simulasi_e2e.sql: LULUS — 228 OK, 0 BUG, 0 GAGAL, 0 LEWAT, 2 BUG DIKENAL (bug-dikenal.txt) (penanda: SIMULASI_SELESAI)
uji_skema_bisnis_v2.sql: LULUS — 124 OK, 0 BUG, 0 GAGAL, 0 LEWAT (penanda: SIMULASI_SELESAI)
uji_idempotensi.sql: LULUS — 4 OK, 0 BUG, 0 GAGAL, 1 LEWAT
```

Catatan atas hasil tersebut:

- **2 BUG DIKENAL (S55g, S55h)** berasal dari perbedaan teks pesan antara tes lama (commit `83bfff5`) dan migrasi 0089 yang sudah di produksi. Keduanya bukan akibat Skema v2 (lihat `scripts/db-lokal/bug-dikenal.txt`).
- **1 LEWAT (idempotensi #4)**: harness tidak menyediakan pelanggan kedua.
- **Penanda `SIMULASI_SELESAI`** adalah `RAISE` yang disengaja di akhir blok `DO`, sehingga seluruh perubahan di-*rollback*.

---

## 2. Daftar skenario uji v2 (`supabase/tests/uji_skema_bisnis_v2.sql`)

Semua skenario berstatus **OK** [UJI LOKAL]. Angka dalam Rupiah. "Driver", "Merchant", dan "Pendapatan" = `driver_payable`, `merchant_payable`/`vendor_payable`, dan `platform_revenue`. "Setor" = `driver_receivable` pada order tunai.

### 2.1 Persiapan, aturan per layanan, estimasi harga

| ID | Makna |
|---|---|
| S0 | Persiapan: AntarPay & GoPay dinyalakan dalam transaksi, promo uji V2PLATFORM/V2MERCHANT dibuat |
| S1a | `service_economics` berisi 8 layanan; ride_motor komisi 8 % (= batas), food komisi 0 % dan fee merchant 15 % |
| S1b | `service_economics_public(send)` tanpa login mengembalikan biaya platform Rp3.000 tanpa membuka fee merchant |
| S1c | Ubah aturan tanpa PIN ditolak (ADMIN_LOCKED) |
| S1d | Komisi ride_motor 9 % lewat RPC ditolak (batas 8 %) |
| S1e | UPDATE langsung ke tabel juga ditolak trigger batas roda dua |
| S1f | Nominal negatif ditolak |
| S1g | Kolom tidak dikenal ditolak |
| S1h | ride_car 15 → 20 % tersimpan dan diaudit `economics.updated` (sebelum/sesudah) |
| S1i | Non-admin ditolak |
| S1j | ride_car dikembalikan ke 15 %; `driver_debt_limit` = −500.000 |
| S2a | `fare_options(ride_car)` anonim: biaya platform 4.000, total kelas = tarif + biaya platform (26.000) |
| S2b | `shopping_estimate(market)` anonim: biaya platform 1.000, jasa belanja 10.000 = max(minimum, 10 %) |
| S2c | `estimate_fare(send)`: biaya platform 3.000 diambil dari `service_economics`, bukan `pricing` lama (1.000) |

### 2.2 Matriks layanan × cara bayar × promo (fase completed, semua seimbang)

| ID | Layanan · bayar · promo | Total | Ongkir (komisi) | Driver | Merchant / vendor | Pendapatan | Setor |
|---|---|---|---|---|---|---|---|
| S11 | ride_motor · tunai · – | 8.000 | 7.000 (560) | 6.440 | – | 1.560 | 1.560 |
| S12 | ride_motor · saldo · – | 8.000 | 7.000 (560) | 6.440 | – | 1.560 | 0 |
| S13 | ride_motor · tunai · promo platform 2.000 | 6.000 | 7.000 (560) | 6.440 | – | −440 | −440 |
| S14 | ride_motor · saldo · promo platform | 6.000 | 7.000 (560) | 6.440 | – | −440 | 0 |
| S15 | ride_car · tunai · – | 26.000 | 22.000 (3.300) | 18.700 | – | 7.300 | 7.300 |
| S16 | ride_car · saldo · – | 26.000 | 22.000 (3.300) | 18.700 | – | 7.300 | 0 |
| S17 | ride_car · saldo · promo platform | 24.000 | 22.000 (3.300) | 18.700 | – | 5.300 | 0 |
| S18 | food · tunai · – | 70.000 | 8.000 (0) | 8.000 | 51.000 | 11.000 | 11.000 |
| S19 | food · saldo · – | 70.000 | 8.000 (0) | 8.000 | 51.000 | 11.000 | 0 |
| S20 | food · tunai · promo merchant 5.000 | 65.000 | 8.000 (0) | 8.000 | 46.000 | 11.000 | 11.000 |
| S21 | food · saldo · promo merchant 5.000 | 65.000 | 8.000 (0) | 8.000 | 46.000 | 11.000 | 0 |
| S22 | food · saldo · promo platform 2.000 | 68.000 | 8.000 (0) | 8.000 | 51.000 | 9.000 | 0 |
| S23 | send · tunai · – | 11.000 | 8.000 (0) | 8.000 | – | 3.000 | 3.000 |
| S24 | send · saldo · – | 11.000 | 8.000 (0) | 8.000 | – | 3.000 | 0 |
| S25 | send · tunai · promo platform | 9.000 | 8.000 (0) | 8.000 | – | 1.000 | 1.000 |
| S26 | shop · tunai · – | 166.450 | 9.000 (0) | 14.215 | vendor 149.000 | 3.235 | 3.235 |
| S27 | shop · saldo · – | 166.450 | 9.000 (0) | 14.215 | vendor 149.000 | 3.235 | 0 |
| S28 | shop · saldo · promo platform | 164.450 | 9.000 (0) | 14.215 | vendor 149.000 | 1.235 | 0 |
| S29 | market · tunai · – | 49.000 | 11.000 (0) | 16.600 | vendor 29.000 | 3.400 | 3.400 |
| S30 | market · saldo · – | 49.000 | 11.000 (0) | 16.600 | vendor 29.000 | 3.400 | 0 |
| S31 | box · tunai · – | 115.000 | 113.000 (11.300) | 101.700 | – | 13.300 | 13.300 |
| S32 | box · saldo · – | 115.000 | 113.000 (11.300) | 101.700 | – | 13.300 | 0 |
| S33 | box · saldo · promo platform | 113.000 | 113.000 (11.300) | 101.700 | – | 11.300 | 0 |

### 2.3 Aturan khusus, pembatalan, biaya PG, travel, akses

| ID | Makna |
|---|---|
| S40 | ride_motor: snapshot komisi 8 %, komisi ledger 560 ≤ 8 % dari ongkir, porsi driver ≥ 92 % |
| S41 | send tunai dengan tip 5.000 dan extras 3.000: driver 16.000, setor 3.000, dompet driver +2.000 |
| S42 | Tip 4.000 setelah selesai: `driver_earning` dasar tidak ditimpa; `driver_earning_final` +4.000; ledger ditulis ulang tetap seimbang |
| S43a | box saldo dibatalkan: 113.000 kembali utuh; ledger fase `refunded` |
| S43b | ride_motor tunai dibatalkan: fase `cancelled`, refund 0 |
| S43c | food ditolak merchant: refund 65.000 = total |
| S43d | shop batal setelah belanja: driver diganti 149.000, pelanggan mendapat refund 17.450; fase `adjusted` tercatat |
| S44a | ride_motor via QRIS: biaya PG 56 (0,7 %), PPN 0, contribution 1.504 |
| S44b | Order tunai: saluran `cash`, biaya PG 0 |
| S44c | Order saldo AntarPay: biaya PG 0 per order (biaya top up dicatat terpisah) |
| S45 | ride_car via kartu, biaya PG ditanggung pelanggan: total 29.057 = 26.000 + fee 2.754 + PPN 303; pendapatan platform tetap 7.300 |
| S46 | Komisi ride_car diubah 15 → 20 %: order baru memakai snapshot 20 % (komisi 4.400) |
| S46b | Order lama tetap memakai komisi 15 % (3.300) di ledger dan tetap seimbang |
| S47 | Batas saldo minus driver dibaca dari `app_settings`: −150.000 boleh online pada batas −500.000, ditolak pada batas −100.000 |
| S48a | Travel kursi saldo: 305.000 = mitra 270.000 + pendapatan 35.000 (fee 10 % + biaya platform 5.000) |
| S48b | Travel kursi tunai: mitra memegang 155.000 dan menyetor 20.000 |
| S48c | Carter dibatalkan < 12 jam: denda 30 % = 120.000 menjadi pendapatan, refund 280.000 |
| S48d | Carter selesai: mitra 450.000 (90 %), pendapatan 50.000 |
| S49a | `driver_order_breakdown`: rincian bersih 8.000 = perubahan dompet driver |
| S49b | `merchant_order_breakdown`: 60.000 − fee 9.000 − promo merchant 5.000 = diterima 46.000 |
| S49c | Driver lain tidak bisa membaca rincian order orang lain |
| S49d | RLS `order_ledger`: driver hanya melihat barisnya sendiri; admin melihat semua |
| S49e | Klien tidak bisa menulis `order_ledger` |
| S49f | Klien tidak bisa memanggil `ledger_post` |
| S49g | `ledger_post` idempoten (9 → 9 baris) |
| S51a | Anonim ditolak membaca rincian driver |
| S51b | `ledger_simulate` hanya untuk admin |
| S51c | TRUNCATE `order_ledger` dari klien ditolak |
| S51d | `pg_fee_calc(qris, 100.000)` = 700 / PPN 0 |

### 2.4 Bayar per order via gateway, iklan, tarif PG, laporan, rekonsiliasi, pagar

| ID | Makna |
|---|---|
| S60a | Order QRIS dibuat berstatus `awaiting_payment` / `unpaid`, saldo pelanggan tidak dipotong |
| S60b | Driver tidak bisa menerima order yang belum dibayar |
| S60c | Webhook settlement: order menjadi `searching` / `paid`, biaya PG 56 dan hold H+1 tercatat |
| S60d | Webhook settlement ganda tidak menggandakan apa pun |
| S60e | Batal setelah bayar QRIS: refund 8.000 *closed-loop*, fase `refunded` |
| S60f | food QRIS selesai: biaya PG 490, driver 8.000, merchant 51.000, contribution 10.510 |
| S61 | send via VA BSI: biaya PG 4.000 + PPN 440, hold H+2, contribution −1.440 |
| S62 | Biaya PG ditanggung pelanggan: QRIS menambah 77; VA menambah 4.440 (total 15.440); pendapatan platform tidak berkurang |
| S63a | `expire_unpaid_orders`: order tak dibayar 16 menit dibatalkan otomatis dan kuota promo dikembalikan |
| S63b | `expire_unpaid_orders` tidak bisa dipanggil klien |
| S63c | Pembayaran terlambat untuk order yang sudah batal masuk ke saldo sebagai refund *closed-loop*; biaya PG GoPay 120 tercatat |
| S63d | Pelanggan membatalkan order `awaiting_payment`: tidak ada refund |
| S64a | Boost Terdekat 3 hari = 45.000 dari saldo merchant; `ads_revenue` tercatat; merchant tampil teratas berlabel "Iklan" |
| S64b | Iklan 90 hari ditolak karena saldo tidak cukup |
| S64c | Non-merchant tidak bisa memasang iklan |
| S64d | Admin membatalkan iklan + refund 25.000; `ads_revenue` bersih 0 |
| S64e | Ubah harga iklan wajib PIN; tercatat di audit |
| S65a | Fee PG di luar rentang 0–20 % ditolak |
| S65b | Tarif QRIS 0,7 → 0,8 %: `pg_fee_calc` berubah, audit `pg_fee.updated`, 14 saluran |
| S65c | Non-admin ditolak mengubah tarif PG |
| S66a | `exec_report_v2` (send + ride_car) cocok dengan hitungan tangan: 14 order, GMV 196.000, revenue_net 64.900, take rate 33,11 % |
| S66b | Identitas laporan: Σ sumber − promo platform = revenue_net (469.225); rumus contribution; iklan 45.000; 12 bulan; status gerbang tersedia |
| S66c | Satu definisi pendapatan: dasbor admin, Portal Eksekutif, dan ledger sama-sama 469.225 |
| S66d | `admin_finance_cascade` lewat `order_economics_v2`: margin bersih 194.239 = Σ contribution ledger |
| S66e | Token eksekutif palsu ditolak |
| S66f | Filter `cash_digital` tidak valid ditolak |
| S66g | Filter `payment_method=qris` cocok; tunai 13 + digital 26 = 39 order |
| S67a | EBITDA kota Pekanbaru: contribution 244.673 (setelah `variable_ops` 100.000) − biaya tetap 3.000.000 = −2.755.327 |
| S67b | `admin_city_fixed_costs`: total biaya tetap dan `variable_ops` benar, diaudit |
| S67c | Kategori biaya tidak dikenal ditolak |
| S68 | Penarikan `approved` tampil di rekonsiliasi → ditandai `settled` dengan ref bank; settle ulang ditolak |
| S69 | Rekonsiliasi harian: settlement 347.497 = pesanan digital 141.497 + top up 200.000 + refund terlambat 6.000; biaya PG 14.158; **diff 0** |
| S70 | Batas saldo minus berlaku juga untuk mitra travel (membuat jadwal ditolak pada −100.000) |
| S80a | Order `awaiting_payment` tidak bisa diterima driver dan tidak muncul di daftar order tersedia |
| S80b | Status tidak konsisten (`searching` + `unpaid` QRIS) tetap tertahan, termasuk untuk titipan travel |
| S80c | Order terjadwal yang belum lunas tidak dirilis |
| S80d | Batal sebelum bayar: tidak ada refund, tagihan dibatalkan, fase `cancelled` |
| S80e | Kedaluwarsa: tagihan pending ikut kedaluwarsa, saldo tidak berubah |
| S80f | Merchant tidak bisa menerima/menolak pesanan yang belum dibayar |
| S81a | Estimasi biaya pembayaran untuk anonim: QRIS 700, VA 4.000 + 440, tunai 0 |
| S81b | Estimasi saat biaya ditanggung pelanggan sama dengan total order nyata (15.440) |
| S81c | Nominal estimasi negatif ditolak |
| S82a | AntarPay mati + sakelar bayar per order mati: order GoPay ditolak |
| S82b | Sakelar `gateway_order_payment_enabled` wajib PIN dan admin; saat menyala, per order GoPay terbuka tetapi top up tetap tertutup; diaudit |
| S82c | AntarPay mati, bayar per order GoPay: menunggu → bayar → selesai; biaya PG 160; seimbang |
| S82d | Saldo dan top up AntarPay tetap tertutup |
| S82e | Sakelar per order menyala tetapi saluran GoPay mati: ditolak |
| S82f | Sakelar dikembalikan ke keadaan awal |
| S83a | Ambang bisnis wajib PIN; kunci pengaturan umum tidak terpengaruh |
| S83b | Ambang disimpan sebagai angka dan diaudit (payout SLA 24 → 48) |
| S83c | 6 masukan salah ditolak secara atomik; sakelar ber-RPC khusus tidak bisa diubah lewat jalur ini |
| S83d | Batas komisi roda dua tidak boleh di bawah komisi yang berlaku (5 ditolak) |
| S83e | `driver_debt_limit` terbuka ke aplikasi; laporan membaca `gate_contribution_weeks`; 11 kunci ambang bisnis |
| S84a | `admin_ledger_unbalanced` mendeteksi order yang ledger-nya dirusak dan kembali 0 setelah dipulihkan |
| S84b | `admin_ledger_lookup` menemukan order, booking travel, dan iklan beserta putusan keseimbangannya |
| S85 | Menghapus sel biaya kota: aturan catatan kosong/null, hapus hanya dengan nominal 0, diaudit |
| S86 | Rincian merchant untuk order ditolak/batal: diterima 0 |
| S50 | Invarian akhir: 37 order v2 selesai, 37 seimbang; tidak ada dompet yang saldonya berbeda dari jumlah mutasinya |

Total: **124 skenario OK**. Spesifikasi §10.1 menuntut ≥ 40 skenario.

---

## 3. Uji silang simulator

Simulator `docs/bisnis/Simulator-Unit-Economics-AntarKita-v2.xlsx` (sheet *Per Layanan*) menghitung ulang enam skenario log dengan rumus yang meniru `ledger_calc` dan `pg_fee_calc`: S13, S21, S26, S45, S61, S48a. Hasilnya: **Σ |selisih| = 0** dan cek keseimbangan = 0 untuk keenam blok.

Hasil `recalc.py` (LibreOffice): `status: success`, `total_formulas: 1081`, `total_errors: 0` [DIUKUR].

---

## 4. Pemeriksaan aplikasi

| Pemeriksaan | Perintah | Hasil [DIUKUR] |
|---|---|---|
| Typecheck | `npx tsc --noEmit` (tsconfig mencakup `src/**`, `apps/**`, `app.config.ts`; **tidak** mencakup `supabase/functions`) | exit 0, tanpa error |
| Web Pelanggan | `APP=pelanggan npx expo export --platform web --clear --output-dir <scratchpad>/web/pelanggan` | exit 0 · 1.585 modul · bundel `entry-fa3aba0b….js` **3.684.364 B (3,7 MB)**, gzip −9 930.283 B · total folder 6.050.484 B, 48 berkas |
| Web Mitra | `APP=mitra …` | exit 0 · 1.587 modul · `entry-4cd84878….js` **3.647.950 B (3,6 MB)**, gzip 912.659 B · total 6.014.050 B, 48 berkas |
| Web Admin | `APP=admin …` | exit 0 · 1.586 modul · `entry-7c13a2ab….js` **3.876.344 B (3,9 MB)**, gzip 982.235 B · total 6.242.443 B, 48 berkas |

Konvensi `APP` berasal dari `app.config.ts` baris 9: `APP=pelanggan|mitra|admin`, default `pelanggan`. Router root-nya `./apps/${APP}/app`. Script resmi ada di `package.json`: `build:web:pelanggan|mitra|admin` dan `build:web` (`scripts/build-web.mjs`). Export dijalankan ke direktori sementara sesi, bukan `dist/`, sehingga repo tidak berubah.

---

## 5. Yang BELUM divalidasi

1. **Tidak ada uji terhadap backend hidup.** Belum ada panggilan ke Supabase produksi atau branch, Midtrans sandbox/produksi, maupun webhook nyata. Webhook hanya diuji lewat pemanggilan `payment_settle` di SQL.
2. **Edge function** `midtrans-create` dan `midtrans-webhook` **belum diuji dijalankan**. Keduanya tidak masuk `tsc` (dikecualikan di tsconfig) dan Deno tidak tersedia di lingkungan ini.
3. **Tidak ada screenshot perangkat atau browser** untuk checkout Pelanggan, rincian pendapatan Mitra, rincian merchant, maupun layar Admin baru. Spesifikasi §10.3 mewajibkannya; butir ini **terbuka**.
4. **Migrasi 0098–0104 belum diterapkan ke produksi.** Kecocokan jangkar tambalan (`pg_get_functiondef` + jangkar teks) terhadap definisi fungsi di produksi belum dibuktikan.
5. **Build Android/iOS** (AAB/IPA) belum dibuat. Aplikasi yang sudah terpasang tidak menampilkan rincian baru sampai diperbarui (server tetap menghitung benar).
6. **Tidak ada uji beban**, dan tidak ada uji `pg_cron` `expire_unpaid_orders` di Supabase sungguhan (stub cron lokal).
7. **Layar admin untuk kontrol baru sudah ada** (belum diklik di backend hidup): sakelar `gateway_order_payment_enabled` (Payment Gateway), ambang bisnis 0104 (Aturan Bisnis → "Ambang & parameter"), pemilik biaya promo `promos.funded_by` (Tarif & Promo → "Ditanggung oleh"). Yang belum punya layar: `admin_ledger_lookup` (travel/iklan) — Buku Besar Order baru mencari kode order.

---

## 6. Daftar periksa rilis produksi

Urutan wajib. Setiap langkah punya pemilik dan bukti.

| # | Langkah | Cara | Bukti selesai |
|---|---|---|---|
| 0 | **Matikan AntarPay top up sekarang** (tidak menunggu rilis) | Panel Admin › Payment Gateway › sakelar AntarPay = Nonaktif (PIN) | `select antarpay_enabled()` = false; audit `antarpay.toggle` |
| 1 | Cadangkan / pastikan PITR aktif; catat migrasi terakhir di produksi (harus `0097`) | Supabase MCP `list_migrations` | Tangkapan daftar migrasi |
| 2 | (Disarankan) uji di **branch Supabase** dulu: terapkan 0098–0104 dan jalankan uji v2 | `create_branch` → `apply_migration` ×7 → `execute_sql` isi `uji_skema_bisnis_v2.sql` | 124 OK di branch |
| 3 | Terapkan ke produksi **berurutan**: `0098_aturan_bisnis_per_layanan` → `0099_buku_besar_order` → `0100_biaya_payment_gateway` → `0101_iklan_boost_merchant` → `0102_biaya_tetap_kota_dan_payout` → `0103_laporan_eksekutif_v2` → `0104_penutup_celah_skema_v2` | Supabase MCP `apply_migration`, satu per berkas. Berhenti bila ada `NNNN batal:` (penjaga migrasi) | NOTICE `0098 ok` … `0104 ok`; tidak ada ERROR |
| 4 | Jalankan `supabase/tests/uji_skema_bisnis_v2.sql` sebagai blok `DO` yang di-*rollback* | `execute_sql`; hasil ada di pesan `SIMULASI_SELESAI`. Jalankan saat trafik rendah: sekuens kode order tetap maju walau di-rollback | 124 baris OK, 0 BUG |
| 5 | Jalankan juga `simulasi_e2e.sql` (regresi) | idem | 228 OK + 2 bug dikenal (S55g/S55h) |
| 6 | **Deploy ulang edge function** `midtrans-create` lalu `midtrans-webhook`, **setelah** 0100 (webhook memanggil `payment_settle` dengan parameter baru; `midtrans-create` memanggil `order_payment_prepare`) | Supabase MCP `deploy_edge_function` | Versi baru aktif; log fungsi tanpa error |
| 7 | Deploy web (Pelanggan/Mitra/Admin) | `npm run build:web` → GitHub Pages | Situs memuat menu Keuangan baru |
| 8 | **Verifikasi layar Admin**: Aturan Bisnis (8 layanan, ride_motor 8 %), Biaya Payment Gateway (14 saluran), Iklan & Boost (3 produk), Biaya Tetap Kota, Buku Besar Order (cek keseimbangan satu order), Rekonsiliasi & Payout, Laporan Skema Bisnis; Portal Eksekutif tab Skema Bisnis | Manual, akun admin + PIN | Screenshot tiap layar ke dokumen ini |
| 9 | Isi data wajib | Biaya tetap kota pilot + `variable_ops`; `payout_fee_per_withdrawal` dari tagihan bank; tinjau ambang lewat `admin_set_settings` | Audit `city_cost.updated`, `settings.business_updated` |
| 10 | Umumkan **perubahan definisi pendapatan** (dasbor bergeser) dan tanggal potong v1/v2 | Memo ke eksekutif | Memo terkirim |
| 11 | **Nyalakan sakelar** hanya setelah langkah 1–10 selesai dan legal menyetujui: `gateway_order_payment_enabled = true` untuk saluran terpilih (usulan QRIS). AntarPay tetap OFF | Panel Admin → Payment Gateway → kartu "Bayar per pesanan lewat gateway" (PIN) + toggle saluran | 1 transaksi nyata per saluran: webhook, `pg_fee`, `hold_until`, ledger seimbang, rekonsiliasi diff 0 |
| 12 | Pemantauan harian selama pilot | Laporan Skema Bisnis: `admin_ledger_unbalanced` = 0, diff rekonsiliasi = 0, approved-belum-settled < SLA | Catatan harian |
| 13 | Build & rilis aplikasi Android/iOS dengan rincian transparan | `RUNBOOK-UNGGAH-AAB.md` | Versi baru di toko aplikasi |

Rollback: migrasi v2 bersifat aditif. Rollback cepat dilakukan dengan mematikan `gateway_order_payment_enabled` dan membiarkan tunai tetap berjalan. Membatalkan tambalan fungsi (0099/0100/0104) memerlukan restorasi definisi lama dari PITR atau migrasi balik yang belum ditulis. Karena itu langkah 2 (branch) sangat disarankan.

---

*Catatan batasan data.*

- **Sumber log.** Semua hasil uji berasal dari DB lokal dengan stub Supabase (GoTrue, Storage, pg_cron, pg_net ditiru), bukan dari Supabase sungguhan.
- **Baris ringkasan harness** dibangkitkan ulang dari berkas log dengan logika `scripts/db-lokal.sh`, karena log sendiri tidak memuat baris ringkasan. Uji v2 dijalankan terpisah dari `reset`, dengan cap waktu log 23 Sep 2026 18:43.
- **Ukuran bundel** diukur pada commit `3a5e064` dengan `--clear` dan bisa berubah pada build CI.
- **Kode order** (mis. `AA26092300075`) berasal dari DB lokal.
- Tidak ada screenshot maupun data produksi dalam laporan ini.
