# Skema Bisnis AntarKita v2 — Dokumen Implementasi

| Atribut | Keterangan |
|---|---|
| Versi dokumen | 1.0 — 23 September 2026 |
| Cabang kode | `skema-bisnis-v2` (HEAD `3a5e064`, migrasi `0098`–`0104`) |
| Dasar keputusan | Keputusan Erza, 23 Sep 2026 — `rekomendasi perhitungan_bisnis_model_antarkita_versiSeptember2026` |
| Dasar kontrak PG | Kontrak Elektronik Midtrans `M568767786_825925_PKS-Pass_M_09_2026` (Ver.Aug-26, layanan Aggregator, registrasi perorangan) |
| Spesifikasi teknis | `docs/SKEMA-BISNIS-V2-SPEK.md` |
| Status | Selesai di kode dan lolos uji DB lokal; **belum diterapkan ke produksi** |
| Pendamping | `docs/rilis/VALIDASI-SKEMA-BISNIS-V2.md` · `docs/bisnis/Simulator-Unit-Economics-AntarKita-v2.xlsx` |

**Label angka.** Setiap angka di dokumen ini diberi salah satu label berikut:

- **[FAKTA SUMBER]**: berasal dari dokumen keputusan 23 Sep 2026 atau dari PKS Midtrans.
- **[FAKTA KODE]**: nilai yang sudah ada di kode/basis data sebelum v2, atau hasil rumus yang ditetapkan di migrasi.
- **[ASUMSI]**: usulan yang harus bisa diubah dari Panel Admin dan masih menunggu keputusan.
- **[HASIL PILOT]**: belum ada datanya.
- **[UJI LOKAL]**: angka hasil uji di DB lokal. Angka ini membuktikan rumus berjalan benar, tetapi bukan kinerja bisnis.

---

## 1. Ringkasan untuk pimpinan

1. **Fokus pilot** [FAKTA SUMBER]: satu kota, 1–2 zona. Layanan yang dijalankan hanya Antar Barang instan (`send`) dan Antar Makan dari merchant terpilih (`food`).
2. **Ongkir sepenuhnya hak driver** [FAKTA SUMBER]. Komisi platform atas ongkir untuk `food`, `send`, `shop`, dan `market` sekarang **0 %**. Sebelumnya komisi ini 20 % menurut `pricing.commission_pct` [FAKTA KODE].
3. **Sumber pendapatan platform** [FAKTA SUMBER] ada tiga: fee merchant (sesuai kontrak), biaya platform pelanggan (ditampilkan terpisah sebelum checkout), dan iklan/boost. Promo **bukan pendapatan** dan setiap promo punya pemilik biaya.
4. **Angka 25 %** adalah *north-star* take rate bersih untuk portofolio yang sudah matang [FAKTA SUMBER]. Angka ini bukan target per order dan bukan laba.
5. **Roda dua penumpang** (`ride_motor`): porsi driver ≥ 92 % dan komisi ≤ 8 % [FAKTA SUMBER, acuan regulasi Sep 2026]. Batas ini dijaga oleh trigger basis data dan tidak bisa dilewati dari Panel Admin (uji S1d, S1e).
6. **Satu sumber kebenaran uang** [FAKTA KODE]: buku besar per order `order_ledger`. Semua laporan (dasbor admin, Portal Eksekutif, laporan keuangan) sekarang membaca buku besar ini. Akibatnya **angka pendapatan di dasbor lama akan bergeser** (lihat §13).
7. **Paling mendesak:** sakelar AntarPay (dompet isi saldo) **di produksi saat ini AKTIF** (menurut informasi tim, 23 Sep 2026). Sakelar ini **harus dimatikan** sampai ada review legal, karena PKS Midtrans Pasal 7 ayat 4(b) memberi Midtrans hak menghentikan layanan (§13.1).

---

## 2. Prinsip yang mengikat

| No | Prinsip | Label | Penegakan di sistem |
|---|---|---|---|
| P1 | Ongkir adalah hak driver | FAKTA SUMBER | `service_economics.driver_commission_pct = 0` untuk food/send/shop/market (0098) |
| P2 | Roda dua: driver ≥ 92 %, komisi ≤ 8 % | FAKTA SUMBER | Trigger `t_guard_commission_cap` di `service_economics` dan `app_settings.commission_cap_two_wheel = 8`. Batas ini tidak boleh diturunkan di bawah komisi yang sedang berlaku (0104, uji S83d) |
| P3 | Promo selalu punya pemilik biaya (platform / merchant / sponsor) | FAKTA SUMBER | `promos.funded_by` dan snapshot `orders.promo_funded_by`, dicatat di ledger sebagai `promo_platform`, `promo_merchant`, atau `promo_sponsor` (0099) |
| P4 | Dana merchant/driver tidak "settled" sebelum webhook tervalidasi, order selesai, dan ledger teralokasi | FAKTA SUMBER | Pesanan gateway berstatus `awaiting_payment` sampai webhook settlement masuk. Driver, merchant, dan mitra travel tidak bisa mengambil pesanan yang belum lunas (0104, uji S80a–S80f). Kredit dompet mitra baru terjadi pada fase `completed` |
| P5 | Withdrawal `approved` ≠ uang sampai | FAKTA SUMBER | `withdrawal_requests.settled_at` + `provider_ref`, diisi lewat `admin_mark_withdrawal_settled` dengan PIN (0102, uji S68) |
| P6 | Pada order tunai, biaya platform/komisi menjadi piutang driver yang dipotong (set-off) atau disetor (DJO), **hanya bila ada dasar kontrak** | FAKTA SUMBER | Sistem mencatat `driver_receivable` dan mendebit dompet driver (`wallet_apply 'fee'`). **Dasar kontraknya belum ada di repo** (§14) |
| P7 | Semua angka dapat diubah dari Panel Admin, dengan PIN dan audit | FAKTA SUMBER | `admin_require_unlock()` + `log_activity` (nilai sebelum → sesudah) pada setiap RPC pengubah. **Ada celah UI**, lihat §12 |

---

## 3. Aturan alokasi per layanan (`service_economics`, migrasi 0098)

Nilai di bawah adalah nilai awal migrasi. Nilai ini sudah dicocokkan dengan DB lokal pada 23 Sep 2026 lewat `scripts/db-lokal.sh psql -c "select * from service_economics"`. Semua nilai dapat diubah di **Panel Admin › Keuangan › Aturan Bisnis** (PIN + audit `economics.updated`).

| Layanan | Komisi driver dari ongkir | Fee merchant / mitra | Biaya platform pelanggan / order | Jasa belanja (% / min / porsi driver) | Biaya PG ditanggung | Promo default | Nilai lama (pricing) | Label |
|---|---|---|---|---|---|---|---|---|
| `ride_motor` | **8 %** (batas keras ≤ 8) | 0 | Rp1.000 | – | platform | platform | komisi 8, fee Rp1.000 | komisi FAKTA SUMBER; biaya ASUMSI |
| `ride_car` | **15 %** | 0 | Rp4.000 | – | platform | platform | komisi 20, fee Rp4.000 | ASUMSI (roda empat tidak kena batas 8 %) |
| `food` | **0 %** | **15 %** | Rp2.000 | – | platform | platform | komisi 20, fee Rp1.000, merchant 15 | ongkir FAKTA SUMBER; fee 15 % FAKTA KODE; Rp2.000 ASUMSI |
| `send` | **0 %** | 0 | Rp3.000 | – | platform | platform | komisi 20, fee Rp1.000 | ongkir FAKTA SUMBER; Rp3.000 ASUMSI |
| `shop` | **0 %** | 0 | Rp1.000 | 5 % / Rp5.000 / 70 % | platform | platform | komisi 20, fee Rp1.000 | jasa FAKTA KODE (0013); fee ASUMSI |
| `market` | **0 %** | 0 | Rp1.000 | 10 % / Rp8.000 / 70 % | platform | platform | komisi 20, fee Rp1.000 | jasa FAKTA KODE (0013); fee ASUMSI |
| `box` | **10 %** | 0 | Rp2.000 | – | platform | platform | komisi 20, fee Rp2.000 | ASUMSI (kargo, bukan penumpang) |
| `travel` (kursi/carter/permintaan) | – | **10 %** (fee mitra travel) | Rp5.000 | – | platform | platform | `travel_commission_pct` 10, `travel_platform_fee` 5.000 | FAKTA KODE |

Catatan layanan:

- **Titipan antar kota via mitra travel:** porsi mitra tetap 80 % dari ongkir antar kota (`travel_send_partner_pct`) [FAKTA KODE].
- **Bonus sesi driver.** Seed `pricing_sessions` memberi +5 % pada jam sibuk pagi (06.30–09.00) dan sore (16.30–19.30) [FAKTA KODE]. Bonus dihitung dengan rumus `min(komisi, ongkir × bonus %)`, jadi dibiayai dari komisi. **Di v2, layanan berkomisi 0 (food/send/shop/market) otomatis tidak mendapat bonus sesi** karena ongkirnya sudah 100 % milik driver.
- **Snapshot aturan.** Aturan di-*snapshot* ke order saat order dibuat (`driver_commission_pct_snap`, `merchant_fee_pct_snap`). Perubahan aturan hanya berlaku untuk order baru; order lama tetap memakai aturan lamanya (uji S46, S46b).

---

## 4. Rumus buku besar per order (`ledger_calc`, migrasi 0099)

Notasi: F = ongkir, S = nilai barang, PF = biaya platform pelanggan, SF = jasa belanja, dshare = porsi driver dari jasa belanja, IC = ongkir antar kota, T = tip, X = extras, D = diskon.

```
gross_customer            = total + tip
driver_commission (C)     = floor(F × komisi % snapshot)
bonus sesi (B)            = min(C, floor(F × bonus sesi %))                     → entri 'adjustment' (−, driver)
merchant_fee (M)          = floor(S × fee merchant % snapshot)                   (hanya bila ada merchant)
promo_merchant (Dm)       = min(D, S − M)  bila pemilik = merchant
promo_sponsor (Ds)        = D              bila pemilik = sponsor
promo_platform (Dp)       = D − Dm − Ds
driver_payable            = (F − C + B) + T + X + dshare
merchant_payable          = S − M − Dm                                           (food)
vendor_payable            = S                                                    (shop/market: penggantian belanja yang ditalangi driver)
partner_payable           = round(IC × 80 %)                                     (titipan via mitra travel)
platform_revenue (R)      = PF + (C − B) + M + (SF − dshare) + (IC − partner) − Dp
pg_fee, pg_fee_ppn        = pg_fee_calc(saluran, total)                          (bila ditanggung pelanggan → ikut menambah total)
KESEIMBANGAN              : gross_customer + Ds = driver + merchant + vendor + partner + R + PG ditanggung pelanggan
contribution per order    = R − PG ditanggung platform
driver_receivable (tunai) = total − vendor − merchant − (driver_payable − tip)
```

Fase buku besar: `created` → `adjusted` (belanja aktual) → `completed` | `cancelled` / `refunded`. Penulisan bersifat idempoten per fase (uji S49g). Klien tidak bisa menulis ke buku besar dan tidak bisa memanggil `ledger_post` (uji S49e, S49f, S51c).

### 4.1 Contoh angka nyata dari uji lokal [UJI LOKAL]

Sumber: `/tmp/antarkita-db-lokal/test-uji_skema_bisnis_v2.sql.log`.

| Skenario | Layanan / bayar / promo | Total pelanggan | Ongkir | Komisi | Driver | Merchant / vendor | Pendapatan platform | Setoran tunai |
|---|---|---|---|---|---|---|---|---|
| S11 | ride_motor · tunai · – | 8.000 | 7.000 | 560 (8 %) | 6.440 | – | 1.560 | 1.560 |
| S13 | ride_motor · tunai · promo platform 2.000 | 6.000 | 7.000 | 560 | 6.440 | – | **−440** | **−440** (platform membayar driver) |
| S16 | ride_car · saldo · – | 26.000 | 22.000 | 3.300 (15 %) | 18.700 | – | 7.300 | 0 |
| S18 | food · tunai · – | 70.000 | 8.000 | 0 | 8.000 | merchant 51.000 | 11.000 | 11.000 |
| S21 | food · saldo · promo merchant 5.000 | 65.000 | 8.000 | 0 | 8.000 | merchant 46.000 | 11.000 | 0 |
| S22 | food · saldo · promo platform 2.000 | 68.000 | 8.000 | 0 | 8.000 | merchant 51.000 | 9.000 | 0 |
| S23 | send · tunai · – | 11.000 | 8.000 | 0 | 8.000 | – | 3.000 | 3.000 |
| S26 | shop · tunai · – | 166.450 | 9.000 | 0 | 14.215 (termasuk jasa 5.215) | vendor 149.000 | 3.235 | 3.235 |
| S29 | market · tunai · – | 49.000 | 11.000 | 0 | 16.600 | vendor 29.000 | 3.400 | 3.400 |
| S31 | box · tunai · – | 115.000 | 113.000 | 11.300 (10 %) | 101.700 | – | 13.300 | 13.300 |
| S48a | travel kursi · saldo | 305.000 | – | fee mitra 30.000 | mitra 270.000 | – | 35.000 | – |
| S60f | food · QRIS | 70.000 | 8.000 | 0 | 8.000 | 51.000 | 11.000; PG 490; **contribution 10.510** | – |
| S61 | send · VA BSI | 11.000 | 8.000 | 0 | 8.000 | – | 3.000; PG 4.000 + PPN 440; **contribution −1.440** | – |

Uji S50 memeriksa invarian seluruh simulasi: 37 order v2 selesai, 37 seimbang, dan tidak ada dompet yang saldonya berbeda dari jumlah mutasinya [UJI LOKAL].

---

## 5. Alur tunai vs digital

| Aspek | Tunai (COD) | Saldo AntarPay | Gateway per order (`purpose=order`, 0100/0104) |
|---|---|---|---|
| Uang pelanggan | Dipegang driver (atau mitra travel) | Dipotong dari saldo saat order dibuat | Pelanggan membayar lewat Snap Midtrans; order menunggu (`awaiting_payment`) sampai webhook settlement masuk |
| Driver menerima order | Langsung | Langsung | **Setelah lunas saja.** Belum lunas → ditolak (S60b, S80a) |
| Hak driver/merchant | Driver sudah memegang uang; merchant dibayar driver di tempat | Kredit dompet saat fase `completed` | Kredit dompet saat fase `completed` |
| Pendapatan platform | Menjadi `driver_receivable`, didebit dari dompet driver (`wallet_apply 'fee'`) | Tercatat di buku besar | Tercatat di buku besar; biaya PG dicatat per order |
| Batas saldo minus driver | `app_settings.driver_debt_limit` = −Rp500.000 [ASUMSI] (sebelumnya hard-code); berlaku juga untuk mitra travel (0102, S47, S70) | – | – |
| Tidak dibayar | – | – | Dibatalkan otomatis setelah `order_payment_timeout_min` = 15 menit [ASUMSI] (pg_cron tiap menit, S63a) |
| Biaya PG | 0 | 0 per order. Biaya top up dicatat terpisah di `wallet_transactions.pg_fee` | Sesuai §6 |
| Sakelar | Saluran `cash` | `antarpay_enabled` (0088) | `gateway_order_payment_enabled` (0104), **default OFF**. Tidak bergantung pada AntarPay (S82a–S82f) |

Promo platform yang lebih besar dari pendapatan platform pada order tunai menghasilkan setoran negatif. Artinya platform yang membayar driver (S13: dompet driver +Rp440).

---

## 6. Biaya payment gateway (PKS Midtrans, migrasi 0100)

Rumus `pg_fee_calc`: `fee = round(nominal × fee %) + fee tetap`. Bila tarif PKS sudah termasuk PPN, `PPN = 0`. Bila belum, `PPN = round(fee × PPN %)`.

| Saluran (kunci) | Fee | Termasuk PPN? | Dana ditahan (H+n kalender) | Rujukan PKS | Label |
|---|---|---|---|---|---|
| `bank_transfer` (VA Mandiri/BNI/BRI/CIMB/Permata/Danamon/BCA/BSI/SeaBank) | Rp4.000 | Tidak | H+1; **BSI & SeaBank H+2** | Pasal 6 ayat 2; SOP B.6.a.i | FAKTA SUMBER |
| `card` (Visa/MasterCard/JCB) | 2,9 % + Rp2.000 | Tidak | H+3 | Pasal 6 ayat 2; SOP B.6.a.i | FAKTA SUMBER |
| `gopay` | 2 % (non-digital; kategori digital 5 %) | **Ya** | H+1 | Pasal 6 ayat 2, tabel E-Money GoPay | FAKTA SUMBER |
| `shopeepay` | 2 % (non-digital; kategori digital 4 %) | **Ya** | H+2 | Pasal 6 ayat 2, tabel E-Money ShopeePay | FAKTA SUMBER |
| `qris` | 0,7 % (Reguler Umum) | **Ya** | H+1 | Pasal 6 ayat 2, tabel QRIS | FAKTA SUMBER |
| `dana` | 1,5 % | Tidak | H+2 | Pasal 6 ayat 2 | FAKTA SUMBER |
| `ovo` | 1,5 % (non-digital domestik; digital 2,73 %) | Tidak | H+5 ("metode lainnya") | Pasal 6 ayat 2, tabel OVO; SOP B.6.a.i | FAKTA SUMBER |
| `akulaku` · `kredivo` (belum dipakai) | 1,7 % · 2 % | Tidak | H+5 · H+2 | Pasal 6 ayat 2 | FAKTA SUMBER |
| `alfamart` · `indomaret` (belum dipakai) | Rp5.000 · *partner fee* + Rp1.000 | Tidak | H+5 | Pasal 6 ayat 2 | FAKTA SUMBER; *partner fee* Indomaret **tidak tercantum** → ASUMSI Rp1.000 |
| `cash`, `antarpay`, `emoney_nfc` | 0 | – | 0 | bukan gateway | FAKTA KODE |

Ketentuan lain dari PKS:

- **Pencairan otomatis** [FAKTA SUMBER, SOP B.6.a.iii]: setelah masa tahan lewat, Midtrans mencairkan otomatis bila dana tertampung ≥ **Rp50.000** (bila fitur otomatis diaktifkan di MAP). Permintaan pencairan sebelum pukul 11.00 diproses pada hari kerja yang sama (B.6.a.iv). Nilai ini disimpan di kolom `payment_channel_fees.min_auto_disburse` sebagai data rujukan dan tidak mengubah alur kode.
- **PPN** [ASUMSI]: tarif efektif **11 %** atas fee yang belum termasuk PPN, disimpan di `payment_channel_fees.ppn_pct` dan bisa diubah admin. Konsultan pajak perlu mengonfirmasinya. Pasal 6 ayat 3 menyatakan biaya belum termasuk biaya administrasi bank dan pajak yang berlaku.
- **Siapa menanggung biaya PG** diatur per layanan lewat `service_economics.pg_fee_policy` (default `platform`). Bila diset `customer`, checkout menampilkan baris **"Biaya pembayaran"** dan biayanya tidak mengurangi pendapatan platform (uji S45, S62).
- **Contoh angka** [UJI LOKAL]:
  - QRIS Rp100.000 → biaya Rp700.
  - VA Rp11.000 → biaya Rp4.000 + PPN Rp440. Pada order `send` senilai itu, contribution-nya **−Rp1.440** (S61). **VA tidak layak untuk order kecil** bila biaya PG ditanggung platform.
  - Kartu Rp26.000 → fee Rp2.754 + PPN Rp303 (S45).

---

## 7. Iklan & boost merchant (migrasi 0101)

| Produk (`ad_products`) | Harga awal | Unit | Penempatan | Label |
|---|---|---|---|---|
| `featured_home`: Unggulan Beranda | Rp25.000 | per hari | deretan "Unggulan" beranda pelanggan | ASUMSI |
| `boost_nearby`: Boost Terdekat | Rp15.000 | per hari | urutan teratas daftar merchant terdekat | ASUMSI |
| `banner_category`: Banner Kategori | Rp50.000 | per minggu (dibulatkan ke atas per 7 hari) | halaman kategori | ASUMSI |

Aturan yang berlaku:

- Durasi iklan 1–90 hari [FAKTA KODE].
- Merchant membeli sendiri dari **saldo pendapatannya** (`merchant_ad_request`). Pembelian ini bersifat *closed-loop*, tidak lewat top up, dan aman terhadap Pasal 7.4b.
- Admin dapat membuat, mengaktifkan, atau membatalkan iklan atas nama merchant dengan PIN. Pembatalan disertai refund.
- Pendapatan iklan dicatat di buku besar (`source='merchant_ads'`, entri `ads_revenue`) saat iklan aktif. Refund iklan dicatat sebagai `ads_revenue` negatif.
- Merchant yang di-boost tampil di atas dengan label **"Iklan"** (`nearby_merchants_v2`) demi transparansi.

Uji terkait: boost 3 hari = Rp45.000 (S64a); saldo tidak cukup ditolak (S64b); refund bersih 0 (S64d).

---

## 8. Kepemilikan promo

| Pemilik | Perlakuan buku besar | Dampak ke pendapatan platform | Dampak ke mitra |
|---|---|---|---|
| `platform` | `promo_platform` (−) | Mengurangi `platform_revenue` | Driver dan merchant tetap menerima penuh (S13, S22) |
| `merchant` | `promo_merchant` (−), maksimal nilai barang − fee merchant | Tidak berubah | `merchant_payable` berkurang (S21: 60.000 − 9.000 − 5.000 = **46.000**) |
| `sponsor` | `promo_sponsor` (−). Keseimbangan: `gross + promo_sponsor = alokasi` | Tidak berubah | Tidak berubah. **Platform menalangi dan memiliki tagihan ke sponsor** (lihat risiko §13.7) |

Pemilik default per layanan diatur di `service_economics.promo_default_funded_by`, dan pemilik per kode promo di `promos.funded_by`. Promo merchant pada layanan tanpa merchant otomatis dianggap promo platform. Kuota promo dikembalikan bila order tak dibayar kedaluwarsa (S63a).

---

## 9. Payout: settled vs approved (migrasi 0102)

- Status penarikan `approved` artinya permintaan disetujui. **Uang belum tentu sampai.**
- Status `settled` baru tercapai setelah admin mencatat referensi transfer bank/provider (`admin_mark_withdrawal_settled(id, provider_ref)`, dengan PIN, audit, dan notifikasi ke mitra). Settle ulang ditolak (S68).
- Panel **Rekonsiliasi & Payout** mencantumkan penarikan yang sudah approved tetapi belum settled.
- SLA `payout_sla_hours` = 24 jam [ASUMSI] dipakai sebagai gerbang "payout tepat waktu" ≥ 95 % [ASUMSI].
- Biaya transfer per pencairan (`payout_fee_per_withdrawal`) saat ini **Rp0** [ASUMSI]. Nilai ini belum diisi dari tagihan bank/provider dan mengurangi contribution begitu diisi.

## 10. Rekonsiliasi harian (migrasi 0102)

- `v_reconciliation_daily` dihitung per tanggal settlement (WIB): **Σ settlement gateway** dibandingkan dengan **Σ gross pesanan digital + top up + refund terlambat**, dengan kolom `diff`. Total biaya PG dicocokkan dengan Σ `payments.pg_fee`.
- Contoh [UJI LOKAL, S69]: settlement 347.497 = pesanan digital 141.497 + top up 200.000 + refund terlambat 6.000; biaya PG 14.158; **diff = 0**.
- Gerbang scale-up mensyaratkan **Σ |diff| = 0** [FAKTA SUMBER].
- Pemeriksaan keseimbangan per order dilakukan lewat `ledger_check` (Panel Admin › Buku Besar Order). RPC `admin_ledger_unbalanced` (0104) juga tersedia untuk mendaftar order tidak seimbang dalam 30 hari terakhir (S84a).

---

## 11. Laporan: take rate bersih, contribution, EBITDA kota (migrasi 0103)

Satu definisi berlaku untuk semua laporan (`exec_report_v2`, `admin_exec_report_v2`, `admin_dashboard_stats.revenue_month`, `exec_report_data.summary.revenue`), dibuktikan oleh uji S66c.

| Besaran | Rumus (sesuai kode) | Label |
|---|---|---|
| GMV bersih | Σ nilai barang + ongkir + ongkir antar kota, dari order selesai yang tidak direfund | FAKTA KODE |
| Sumber pendapatan | fee merchant + biaya platform pelanggan + komisi driver (kotor) + jasa belanja bagian platform + iklan + lainnya (margin antar kota, denda batal) | FAKTA SUMBER / KODE |
| revenue_net | Σ sumber − promo platform | FAKTA SUMBER |
| **Take rate bersih** | revenue_net ÷ GMV bersih. Target 25 % berlaku untuk portofolio | FAKTA SUMBER |
| **Contribution** | revenue_net − insentif driver (bonus sesi) − biaya PG ditanggung platform − biaya PG hangus pada refund − `variable_ops` (pro-rata) − biaya payout | FAKTA SUMBER |
| **EBITDA kota** | contribution kota − biaya tetap kota (`city_fixed_costs`, pro-rata hari untuk rentang parsial) | FAKTA SUMBER |

Catatan:

- **Perbedaan dengan dokumen keputusan.** Dokumen keputusan (§0.5 spesifikasi) menyebut ongkir dicatat terpisah dari GMV. Kode (§7 spesifikasi, 0103) **memasukkan ongkir** ke GMV bersih. Konsekuensinya, take rate kode lebih rendah daripada bila GMV hanya berisi nilai barang. **Perlu keputusan** (§14).
- **Input EBITDA kota** diisi per kota per bulan di **Panel Admin › Biaya Tetap Kota**. Kategorinya `tim`, `akuisisi`, `kantor`, `legal`, `teknologi`, `lainnya` (semuanya biaya tetap), ditambah `variable_ops` [ASUMSI] untuk support/fraud/asuransi/cloud variabel yang dialokasikan pro-rata per order selesai. Contoh [UJI LOKAL, S67a]: Pekanbaru, contribution 244.673 − biaya tetap 3.000.000 = EBITDA **−2.755.327**.
- **Filter dasbor** (0103): layanan, kota/zona (`city_id`), kohort merchant (`new_30d` / `active` / `all`), metode pembayaran (kunci saluran), tunai/digital, dan pemilik promo. Ada di **Panel Admin › Laporan Skema Bisnis** dan tab **Skema Bisnis** di Portal Eksekutif. Uji S66a–S66g membuktikan laporan cocok dengan hitungan tangan (contoh: send + ride_car, 14 order, take rate 33,11 %).
- **Satuan zona.** Filter wilayah bekerja per **kota** (`city_id`). Belum ada dimensi **zona di dalam kota** di buku besar. Dengan pilot 1–2 zona, pelaporan per zona belum tersedia.

### 11.1 Gerbang keputusan & gerbang scale-up

**Gerbang scale-up**, seperti yang diterapkan di `exec_report_v2.gates` (hanya `pass` bila semua gerbang lolos):

| Gerbang | Ambang | Label | Kunci pengaturan |
|---|---|---|---|
| Contribution > 0 berturut-turut | **8 minggu** | FAKTA SUMBER | `gate_contribution_weeks` |
| Selisih rekonsiliasi | **0** | FAKTA SUMBER | (tetap) |
| Payout settled dalam SLA | ≥ 95 % dalam 24 jam | ASUMSI | `gate_payout_on_time_pct`, `payout_sla_hours` |
| Retensi driver 30 hari | ≥ 60 % | ASUMSI | `gate_retention_driver_pct` |
| Retensi merchant 30 hari | ≥ 70 % | ASUMSI | `gate_retention_merchant_pct` |
| Refund | ≤ 2 % pesanan, dan tidak ada fraud flag *high* yang masih terbuka | ASUMSI | `gate_refund_max_pct` |
| Take rate vs north-star | 25 % (informasi, **bukan gerbang**) | FAKTA SUMBER | `take_rate_north_star_pct` |

**Gerbang keputusan** (siapa menyetujui apa, dengan bukti apa). Tabel ini **usulan** [ASUMSI] dan wajib dikonfirmasi komisaris:

| Keputusan | Pemutus | Bukti minimal | Jejak di sistem |
|---|---|---|---|
| Mengubah komisi/fee/biaya platform (`service_economics`) | Direktur; komisaris bila menaikkan beban mitra | Simulasi `ledger_simulate`/xlsx, dampak ke pendapatan driver | `economics.updated` (sebelum → sesudah) |
| Mengubah tarif PG atau kebijakan penanggung PG | Direktur keuangan | Tagihan/PKS Midtrans terbaru | `pg_fee.updated` |
| Menyalakan bayar per order via gateway | Direktur + legal | Uji Midtrans produksi (1 transaksi per saluran), rekonsiliasi diff 0 | `gateway_order_payment.toggle` |
| Menyalakan AntarPay top up | **Komisaris** | Opini legal / izin BI (Pasal 7.4b) | `antarpay.toggle` |
| Menerbitkan promo merchant/sponsor | Pemilik biaya (merchant/sponsor) | Persetujuan tertulis / perjanjian sponsor | `promos.funded_by` (belum ada di UI) |
| Menandai payout settled | Staf keuangan | Referensi transfer bank/provider | `withdrawal.settled` + `provider_ref` |
| Membuka zona/kota berikutnya | **Komisaris** | `gates.scale_up_ready = true`: 8 minggu contribution positif, diff 0, payout tepat waktu, retensi, refund/fraud | Laporan Skema Bisnis |
| Membuka ride-hailing roda dua | Komisaris | Porsi driver ≥ 92 % (terkunci sistem), kesiapan perizinan | `commission_cap_two_wheel` |

---

## 12. Tempat mengubah setiap angka di Panel Admin

| Angka | Menu (rute) | RPC | PIN |
|---|---|---|---|
| Komisi driver, fee merchant, biaya platform, jasa belanja, penanggung PG, promo default | Keuangan › **Aturan Bisnis** (`/(admin)/economics`), dengan simulasi 1 order | `admin_set_service_economics`, `ledger_simulate` | Ya |
| Tarif PG, PPN, hold H+n, aktif/nonaktif tarif | Keuangan › **Biaya Payment Gateway** (`/(admin)/pg-fees`) | `admin_set_payment_channel_fee` | Ya |
| Sakelar AntarPay & saluran pembayaran | Keuangan › **Payment Gateway** (`/(admin)/gateway`) | `admin_set_antarpay_enabled`, toggle saluran (0089) | Ya |
| **Bayar per order via gateway** (`gateway_order_payment_enabled`) | **Belum ada layar.** Hanya RPC `admin_set_gateway_order_payment` atau SQL | – | Ya |
| Harga iklan, iklan atas nama merchant | Katalog & Harga › **Iklan & Boost** (`/(admin)/ads`) | `admin_set_ad_product`, `admin_set_merchant_ad` | Ya |
| Biaya tetap kota, `variable_ops` | Keuangan › **Biaya Tetap Kota** (`/(admin)/city-costs`) | `admin_set_city_fixed_cost` | Ya |
| Payout settled | Keuangan › **Rekonsiliasi & Payout** (`/(admin)/reconciliation`) | `admin_mark_withdrawal_settled` | Ya |
| Buku besar & cek keseimbangan | Keuangan › **Buku Besar Order** (`/(admin)/ledger`) | `ledger_check` (layar belum memakai `admin_ledger_lookup`/`admin_ledger_unbalanced` dari 0104) | – |
| Laporan, filter, gerbang | Keuangan › **Laporan Skema Bisnis** (`/(admin)/economics-report`) dan Portal Eksekutif › tab Skema Bisnis | `admin_exec_report_v2`, `exec_report_v2` | – |
| **Ambang bisnis**: north-star, gerbang, SLA, biaya payout, batas waktu bayar, batas saldo minus, batas komisi roda dua | **Belum ada layar.** RPC `admin_set_settings` sudah divalidasi dan diaudit (0104, S83a–S83e), tetapi layar Otomasi hanya memuat `target_take_rate_pct` (lama, 18 %) | `admin_set_settings` | Ya |
| **Pemilik biaya promo** (`promos.funded_by`) | **Belum ada di formulir** Tarif & Promo (`/(admin)/pricing`). Promo baru selalu `platform` | – | – |

Tiga celah di atas (sakelar gateway per order, ambang bisnis, pemilik promo) berarti prinsip P7 ("semua angka dapat diubah dari Panel Admin") **belum terpenuhi sepenuhnya**. Perlu tambahan layar sebelum pilot memakai promo merchant/sponsor.

---

## 13. Risiko & apa yang rusak duluan

| # | Risiko | Pemicu / apa yang rusak duluan | Keparahan | Mitigasi |
|---|---|---|---|---|
| 13.1 | **PKS Midtrans Pasal 7 ayat 4(b)**: fitur uang/dompet elektronik tanpa izin BI | Midtrans menghentikan layanan tanpa batas waktu. **Seluruh pembayaran non-tunai mati sekaligus**, termasuk bayar per order | Kritis | Matikan AntarPay top up. Saldo hanya dipakai sebagai dompet pendapatan mitra dan refund *closed-loop*. Pembayaran pelanggan memakai gateway per order |
| 13.2 | **Sakelar AntarPay di produksi = AKTIF** (informasi tim 23 Sep 2026; belum diverifikasi dari sesi ini) | Selama aktif, top up saldo pelanggan terbuka dan risiko 13.1 berjalan | Kritis | **Matikan segera** lewat Panel Admin › Payment Gateway (PIN), sampai review legal selesai. Cara & dampaknya: `docs/ANTARPAY-TOGGLE.md` |
| 13.3 | **Play Console, akun organisasi.** Aplikasi Mitra dideklarasikan "Mobile payments and digital wallets" (`docs/rilis/PLAY-APP-CONTENT-JAWABAN-MITRA.md`). Registrasi PKS dan akun developer saat ini perorangan | Google dapat menolak atau menurunkan aplikasi berfitur keuangan dari akun perorangan (menurut pemilik; kebijakan Google terkini belum diverifikasi di dokumen ini) | Tinggi | Badan usaha + D-U-N-S → akun organisasi (App Transfer), atau cabut deklarasi dompet bila saldo hanya berfungsi sebagai dompet pendapatan. Keputusan komisaris |
| 13.4 | **Sakelar gateway per order default OFF** (layar: Panel Admin → Payment Gateway → kartu "Bayar per pesanan lewat gateway") | Setelah migrasi, pelanggan hanya bisa bayar tunai bila AntarPay dimatikan. Pesanan digital tertolak ("AntarPay sedang dinonaktifkan") | Tinggi (pendapatan) | Nyalakan dari kartu tersebut (PIN) setelah uji Midtrans produksi |
| 13.5 | **Definisi pendapatan berubah** (0103) | Dasbor admin, Portal Eksekutif, dan laporan keuangan lama **bergeser** begitu 0103 diterapkan. Pendapatan kini = revenue_net dari ledger (komisi 20 % ongkir hilang; biaya platform dan promo platform dihitung bersih). Order lama (`ledger_version 1`) tetap memakai rumus lama, sehingga **bulan transisi berisi campuran** | Sedang | Umumkan tanggal potong. Bandingkan periode sebelum/sesudah dengan label "v1/v2". Selaraskan `target_take_rate_pct` 18 % (lama, masih dipakai rekomendasi otomatis 0019) dengan north-star 25 % |
| 13.6 | **Dampak ke pendapatan driver dan platform** | Lihat tabel 13.A. Driver food/send naik **+25 %** dari ongkir. Pendapatan platform per order turun untuk ride_car, food, shop, market, box, dan naik untuk send. Pelanggan membayar lebih mahal: send **+Rp2.000**, food **+Rp1.000** | Sedang | Pantau konversi checkout send/food. Uji harga biaya platform. Biaya platform adalah ASUMSI dan bisa diubah admin |
| 13.7 | **Akuntansi promo sponsor** | Platform menalangi diskon (`gross + promo_sponsor = alokasi`), tetapi **tidak ada piutang sponsor atau alur penagihan** di sistem, dan sponsor tidak masuk contribution. Bila sponsor tidak membayar, biaya ini tidak terlihat | Sedang | Belum dipakai: formulir promo belum bisa menyetel `sponsor`. Sebelum dipakai, siapkan perjanjian sponsor, laporan piutang sponsor, dan penagihan |
| 13.8 | **Set-off piutang tunai tanpa dasar kontrak** | Sistem mendebit dompet driver otomatis (`driver_receivable`). Tanpa klausul di perjanjian kemitraan, potongan ini rawan sengketa | Sedang | Tambahkan klausul set-off/DJO di perjanjian mitra (driver, mitra travel) |
| 13.9 | **VA untuk order kecil** | Biaya VA Rp4.000 + PPN melebihi pendapatan order send (contribution −Rp1.440, S61) | Sedang | Set `pg_fee_policy = customer` untuk VA, atau batasi VA di atas nominal tertentu (belum ada fitur batas nominal per saluran) |
| 13.10 | **Hold dana gateway H+1..H+5** | Dana baru masuk rekening AntarKita beberapa hari setelah order, padahal driver/merchant sudah dikredit dan bisa menarik dana. Kebutuhan kas meningkat | Sedang | Sediakan modal kerja ≥ nilai order digital beberapa hari (lihat simulator). Atur jadwal payout |
| 13.11 | **Tambalan fungsi lama berbasis jangkar teks** (0099/0100/0104) | Bila definisi fungsi di produksi berbeda dari lokal, migrasi **gagal keras**. Sifat ini disengaja agar tidak ada tambalan setengah jadi, tetapi tetap bisa menunda rilis | Rendah | Uji dulu di branch Supabase |
| 13.12 | **PPN atas biaya platform/fee merchant** | Kode tidak memodelkan PPN keluaran atas pendapatan platform. Bila AntarKita berstatus PKP, pendapatan bersih lebih kecil daripada angka laporan | Tidak diketahui | Minta opini konsultan pajak |

**Tabel 13.A: Dampak per order v1 → v2** (angka contoh = ongkir/barang dari log uji; v1 dihitung dengan rumus lama `create_order` dan nilai `pricing` lama, jam normal tanpa bonus sesi) [FAKTA KODE + UJI LOKAL]

| Layanan | Ongkir | Driver dari ongkir v1 → v2 | Δ driver | Pendapatan platform v1 → v2 | Δ platform | Total pelanggan v1 → v2 |
|---|---|---|---|---|---|---|
| ride_motor | 7.000 | 6.440 → 6.440 | 0 | 1.560 → 1.560 | 0 | 8.000 → 8.000 |
| ride_car | 22.000 | 17.600 → 18.700 | +1.100 | 8.400 → 7.300 | −1.100 | 26.000 → 26.000 |
| food (barang 60.000) | 8.000 | 6.400 → 8.000 | +1.600 | 11.600 → 11.000 | −600 | 69.000 → 70.000 |
| send | 8.000 | 6.400 → 8.000 | +1.600 | 2.600 → 3.000 | +400 | 9.000 → 11.000 |
| shop (barang 149.000) | 9.000 | 7.200 → 9.000 | +1.800 | 5.035 → 3.235 | −1.800 | 166.450 → 166.450 |
| market (barang 29.000) | 11.000 | 8.800 → 11.000 | +2.200 | 5.600 → 3.400 | −2.200 | 49.000 → 49.000 |
| box | 113.000 | 90.400 → 101.700 | +11.300 | 24.600 → 13.300 | −11.300 | 115.000 → 115.000 |

Pada jam sibuk, driver v1 food/send juga mendapat bonus sesi 5 % dari ongkir (maksimal sebesar komisi). Driver v2 tidak mendapat bonus karena komisinya 0, tetapi tetap lebih tinggi: 8.000 vs 6.800.

---

## 14. Keputusan yang masih diperlukan dari komisaris

1. **Konfirmasi mematikan AntarPay top up di produksi hari ini**, lalu tetapkan jalur review legal (izin BI atau desain *closed-loop*) sebelum sakelar dinyalakan lagi.
2. **Kapan dan untuk saluran apa bayar per order via gateway dinyalakan** (usulan: QRIS dulu, biaya 0,7 % termasuk PPN, dana H+1).
3. **Penanggung biaya PG per layanan dan per saluran** (platform vs pelanggan), terutama VA dan kartu pada order kecil.
4. **Menetapkan angka ASUMSI:**
   - biaya platform pelanggan (send Rp3.000, food Rp2.000, ride_car Rp4.000, box Rp2.000, lainnya Rp1.000);
   - komisi ride_car 15 % dan box 10 %;
   - fee merchant per kategori dan paket promo (saat ini seragam 15 %);
   - harga iklan;
   - PPN 11 %;
   - ambang gerbang 95/60/70/2 %;
   - batas waktu bayar 15 menit, batas saldo minus −Rp500.000, biaya payout.
5. **Definisi GMV bersih:** ongkir masuk (seperti kode sekarang) atau terpisah (seperti dokumen keputusan). Keputusan ini mengubah take rate yang dilaporkan.
6. **Satu target take rate:** hapus `target_take_rate_pct` 18 % (lama) atau selaraskan dengan north-star 25 %.
7. **Kota pilot dan batas 1–2 zona.** Pelaporan per zona membutuhkan dimensi zona di buku besar (belum ada).
8. **Dokumen kontrak:**
   - kontrak merchant dengan fee dan paket promo;
   - klausul set-off/DJO piutang tunai di perjanjian driver dan mitra travel;
   - perjanjian sponsor promo beserta alur penagihannya.
9. **Akun Google Play organisasi** (badan usaha, D-U-N-S) atau pencabutan deklarasi dompet digital.
10. **Anggaran promo platform per bulan** dan batas per order.
11. **Status pajak (PKP)** dan perlakuan PPN atas biaya platform, fee merchant, dan iklan.
12. **Biaya *partner fee* Indomaret** bila saluran itu akan dipakai.
13. **Pembukaan ride-hailing roda dua** (di luar fokus pilot). Porsi driver ≥ 92 % sudah dikunci sistem.

---

*Catatan batasan data.*

- **Sumber angka.** Angka FAKTA SUMBER diambil dari ringkasan keputusan 23 Sep 2026 (dokumen asli tidak dibaca langsung pada penyusunan ini) dan dari teks PKS Midtrans Ver.Aug-26. Tabel PKS berasal dari hasil konversi PDF yang sebagian terpotong: sel gabungan tabel hold SOP B.6.a.i ditafsirkan, dan nama "Kredivo" terpotong menjadi "Kdi/revo".
- **Angka ASUMSI** belum disetujui.
- **Angka UJI LOKAL** berasal dari PostgreSQL 16 lokal dengan stub Supabase (23 Sep 2026). Angka ini bukan produksi dan bukan kinerja bisnis.
- **Belum ada HASIL PILOT.**
- **Status sakelar AntarPay di produksi** diambil dari informasi tim dan tidak diverifikasi langsung, karena tidak ada akses backend langsung pada penyusunan ini.
- **Dampak v1 → v2** dihitung dengan rumus, bukan dari data transaksi historis.
