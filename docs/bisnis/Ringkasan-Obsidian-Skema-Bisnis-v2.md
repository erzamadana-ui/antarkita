---
title: Ringkasan Skema Bisnis AntarKita v2 (implementasi)
tags: [antarkita, skema-bisnis, unit-economics, take-rate, midtrans, pilot]
kategori: bisnis
created: 2026-09-23
updated: 2026-09-23
sumber: "[[rekomendasi perhitungan_bisnis_model_antarkita_versiSeptember2026]] · PKS Midtrans M568767786_825925 Ver.Aug-26 · repo antar-aja cabang skema-bisnis-v2 (0098–0104)"
status: selesai di kode, lolos uji lokal, BELUM di produksi
---

# Skema Bisnis v2: ringkasan implementasi

Turunan dari [[rekomendasi perhitungan_bisnis_model_antarkita_versiSeptember2026]]. Dokumen lengkap ada di repo: `docs/bisnis/SKEMA-BISNIS-V2.md`, `docs/rilis/VALIDASI-SKEMA-BISNIS-V2.md`, dan `docs/bisnis/Simulator-Unit-Economics-AntarKita-v2.xlsx`.

## Inti keputusan (FAKTA SUMBER)
- **Pilot:** 1 kota, 1–2 zona; Antar Barang instan + Antar Makan dari merchant terpilih.
- **Ongkir = hak driver:** komisi food/send/shop/market **0 %** (sebelumnya 20 %). **Ride roda dua:** driver ≥ 92 %, komisi ≤ 8 % (dikunci trigger DB).
- **Pendapatan platform** = fee merchant + biaya platform pelanggan + iklan/boost. **Promo** selalu punya pemilik biaya (platform/merchant/sponsor).
- **Take rate 25 %** = north-star portofolio matang, bukan target per order dan bukan laba.
- **Status uang:** tidak ada yang "settled" sebelum webhook valid + order selesai + ledger teralokasi. `approved` ≠ uang sampai.

## Angka per layanan (awal; ASUMSI kecuali ditandai)
| Layanan | Komisi ongkir | Fee merchant | Biaya platform |
|---|---|---|---|
| ride_motor | 8 % (FAKTA) | – | Rp1.000 |
| ride_car / box | 15 % / 10 % | – | Rp4.000 / Rp2.000 |
| food | 0 % (FAKTA) | 15 % (kode lama) | Rp2.000 |
| send | 0 % (FAKTA) | – | Rp3.000 |
| shop / market | 0 % | jasa belanja 5 % / 10 %, driver 70 % | Rp1.000 |
| travel | – | fee mitra 10 % | Rp5.000 |

## Rumus (semua laporan membaca `order_ledger`)
- **Take rate bersih** = (fee merchant + biaya platform + komisi + jasa platform + iklan − promo platform) ÷ GMV bersih.
- **Contribution** = revenue_net − insentif − PG platform − PG hangus − variable_ops − payout.
- **EBITDA kota** = Σ contribution − biaya tetap kota.

## Contoh nyata (uji lokal)
**send tunai:** driver 8.000, platform 3.000 · **send VA BSI:** PG 4.440 → contribution **−1.440** · **food QRIS:** merchant 51.000, driver 8.000, platform 11.000, PG 490 → contribution 10.510.

## Biaya PG (PKS Pasal 6, SOP B.6)
- **QRIS** 0,7 % termasuk PPN, H+1 · **GoPay/ShopeePay** 2 % termasuk PPN, H+1/H+2.
- **VA** Rp4.000 + PPN, H+1 (BSI/SeaBank H+2) · **Kartu** 2,9 % + Rp2.000 + PPN, H+3 · **DANA/OVO** 1,5 % + PPN · pencairan otomatis ≥ Rp50.000 · PPN 11 % = ASUMSI.

## Gerbang scale-up
8 minggu contribution > 0 · rekonsiliasi diff 0 · payout ≥ 95 % dalam SLA 24 jam · retensi driver ≥ 60 % / merchant ≥ 70 % · refund ≤ 2 %. Semua ambang selain 8 minggu & diff 0 = ASUMSI.

## Validasi
e2e 228 OK · uji v2 124 OK / 0 BUG · tsc bersih · web export Pelanggan 3,7 MB / Mitra 3,6 MB / Admin 3,9 MB · simulator 6 uji silang selisih 0.

## Risiko utama → tindakan
- **AntarPay di produksi = AKTIF** → matikan sekarang (PKS Pasal 7.4b: dompet tanpa izin BI → Midtrans bisa menghentikan layanan).
- **Gateway per order** default OFF, belum ada layar admin → sampai sakelar dinyalakan hanya tunai.
- **Definisi pendapatan berubah** → dasbor lama bergeser; bulan transisi campuran v1/v2.
- **Belum ada di Panel Admin:** pemilik promo, ambang bisnis, sakelar gateway. **Piutang sponsor** belum dicatat.
- **Set-off tunai** butuh klausul kontrak mitra. **Play Console** perlu akun organisasi.

## Keputusan komisaris yang ditunggu
AntarPay OFF + jalur legal · saluran gateway pertama · penanggung biaya PG · angka ASUMSI · GMV termasuk ongkir atau tidak · target take rate tunggal (18 % lama vs 25 %) · kontrak merchant / mitra / sponsor · akun Play organisasi · status PKP.

> Batasan data: FAKTA dari keputusan 23 Sep 2026 & PKS; ASUMSI belum disetujui; angka uji dari DB lokal, bukan produksi; belum ada HASIL PILOT.
