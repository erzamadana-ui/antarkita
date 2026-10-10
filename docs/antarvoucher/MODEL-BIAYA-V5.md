# MODEL BIAYA AntarVoucher v5 — ringkasan model keuangan

Tanggal: 10 Okt 2026 · Agen FINANCE · Sumber lengkap & rumus hidup: `Model-Keuangan-AntarVoucher-v5.xlsx` (folder `Claude outputs/AntarVoucher-v5/`; 6 sheet, 1.113 formula, recalc 0 error). Dokumen ini = USULAN AI; setiap angka bertanda [ASUMSI] menunggu keputusan GM/pemilik (daftar di §6).

## 1. Rumus (KONTRAK-V5 §5, diverifikasi di sheet Komposisi)
```
Gross G = ongkir + barang + PF + jasa belanja           (tidak ada baris biaya pembayaran)
Driver  = ongkir − FLOOR(ongkir × komisi) + porsi driver jasa belanja
Merchant/mitra/vendor = barang − FLOOR(barang × fee)
R (platform kotor) = PF + komisi + fee merchant + jasa belanja porsi platform
T (PPN inklusif)   = ROUND(R × 11 / 111)                 [ASUMSI tarif 11 %]
Bersih = R − T ;  Biaya PG = 0 ;  cek: G = Driver + Merchant + R  (Σ selisih = 0)
COGS/order = Σ biaya tetap kota (termasuk alokasi pusat) ÷ order/bulan
PF minimum = CEILING(COGS/order × 1,30 / 500) × 500      (margin 30 % [ASUMSI], pembulatan 500 = KONTRAK §3)
```
Verifikasi KONTRAK §5: ride motor Rp50.000 → driver 46.000, R 5.000, T 495, bersih **4.505** ✓.

## 2. Komposisi potongan per layanan (contoh satu order; service_economics prod 28 Sep)
| Layanan | Gross | Ke driver | Ke merchant/mitra | R kotor | PPN T | **Bersih v5** | PG v4 bauran* | Bersih v4 | Hemat/order |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Ride motor (50.000) | 51.000 | 46.000 | 0 | 5.000 | 495 | **4.505** | 1.135 | 3.370 | 1.135 |
| Ride mobil (22.000) | 26.000 | 18.700 | 0 | 7.300 | 723 | **6.577** | 905 | 5.672 | 905 |
| Food (35.000 + 10.000) | 47.000 | 10.000 | 29.750 | 7.250 | 718 | **6.532** | 1.098 | 5.434 | 1.098 |
| Send (8.000) | 11.000 | 8.000 | 0 | 3.000 | 297 | **2.703** | 767 | 1.936 | 767 |
| Shop (149.000 + 9.000) | 166.450 | 14.215 | 149.000 | 3.235 | 321 | **2.914** | 2.197 | 717 | 2.197 |
| Market (29.000 + 11.000) | 49.000 | 16.600 | 29.000 | 3.400 | 337 | **3.063** | 1.117 | 1.946 | 1.117 |
| Box (113.000) | 115.000 | 101.700 | 0 | 13.300 | 1.318 | **11.982** | 1.724 | 10.258 | 1.724 |
| Travel (300.000) | 305.000 | 0 | 270.000 | 35.000 | 3.468 | **31.532** | 3.472 | 28.060 | 3.472 |
| **Bauran** [ASUMSI] | 52.408 | 24.945 | 21.445 | 6.018 | 596 | **5.422** | 1.148 | 4.275 | 1.148 |

\*PG v4 = Midtrans dihitung dari Gross, ditanggung platform (kebijakan efektif prod, BIZ.md K1); bauran saluran QRIS 60 % / GoPay 25 % / VA 15 % [ASUMSI]. Penghematan = **Rp1.148/order non-tunai ≈ 21 % dari bersih**; pada target 60.000 order/bln × 40 % non-tunai [ASUMSI] = **≈ Rp27,5 jt/bln ≈ 8 % NPR**. Catatan: AntarShop/Market di v4 nyaris tanpa margin (bersih 717) — v5 menyelamatkannya.

## 3. COGS per kota (per bulan, kondisi target)
| | Pekanbaru | Batam | Padang | Dumai | Pusat | Total |
|---|---:|---:|---:|---:|---:|---:|
| Tim tetap (1 CRL + 2 MAO; UMK 2026 × pengali SDM + BPJS 10,54 % + THR) | 20,8 jt | 27,0 jt | 17,1 jt | 22,8 jt | 31,7 jt (CS 2, Finance 2, admin 1) | |
| Variabel tim pada target (komisi MAO tier + bonus CRL 3 % NPR) | 18,2 jt | 18,2 jt | 12,4 jt | 12,4 jt | – | |
| Akuisisi + kantor lokal [ASUMSI] | 5,0 jt | 5,0 jt | 5,0 jt | 5,0 jt | – | |
| Infra (Supabase Pro + PITR + Stadia + Apple + domain @kurs 16.500) + legal/pajak + pemasaran + kantor pusat [ASUMSI] | | | | | 14,1 jt | |
| Alokasi pusat (∝ target order) | 15,3 jt | 15,3 jt | 7,6 jt | 7,6 jt | (−45,8 jt) | |
| **COGS total/bulan** | **58,7 jt** | **65,0 jt** | **41,9 jt** | **47,6 jt** | | **213,1 jt** |
| Volume break-even (order/bln) | 10.830 | 11.979 | 7.719 | 8.772 | | 39.300 |
| Volume target [ASUMSI SDM tier] | 20.000 | 20.000 | 10.000 | 10.000 | | 60.000 |
| COGS/order @target | 2.936 | 3.248 | 4.185 | 4.756 | | 3.551 |
| PF minimum @target (COGS + 30 %) | 4.000 | 4.500 | 5.500 | 6.500 | | 5.000 |
| Bersih aktual bauran − minimum | +1.422 | +922 | **−78** | **−1.078** | | +422 |
| Status | CUKUP | CUKUP | **KURANG** | **KURANG** | | CUKUP |

Yang rusak duluan: **Dumai** (UMK tertinggi ke-2 tetapi volume tier 2) dan **Padang** — pada 10.000 order/bln tarif saat ini tidak menutup COGS + 30 %. Opsi: PF +Rp500 (Padang) / +Rp1.500 (Dumai) seragam, atau target volume Padang/Dumai ≥ 12.000–14.000, atau 1 MAO saja di tier 2. Stretch (×1,5) membuat semua kota CUKUP.

## 4. Target per kota & float (sheet Target)
| | Pekanbaru | Batam | Padang | Dumai | Total |
|---|---:|---:|---:|---:|---:|
| Order/bln | 20.000 | 20.000 | 10.000 | 10.000 | 60.000 |
| NPR/bln (model, bersih setelah PPN) | 108,4 jt | 108,4 jt | 54,2 jt | 54,2 jt | 325,3 jt (= 1,81× target SDM Rp180 jt; SDM memakai Rp3.000/order) |
| Driver aktif / merchant aktif / pelanggan aktif | 334 / 150 / 5.000 | 334 / 150 / 5.000 | 167 / 75 / 2.500 | 167 / 75 / 2.500 | 1.002 / 450 / 15.000 |
| Dana masuk: voucher pelanggan + deposit driver | 419 + 72 jt | 419 + 72 jt | 210 + 36 jt | 210 + 36 jt | 1.474 jt |
| Dana keluar: pencairan ≤ 24 jam | 371 jt | 371 jt | 186 jt | 186 jt | 1.113 jt |
| **Float Σ saldo beredar** | 357 jt | 357 jt | 179 jt | 179 jt | **1.072 jt = 107 % ambang Rp1 M** |

**Temuan terpenting:** dengan saldo mengendap [ASUMSI] Rp50.000/pelanggan, Rp150.000/driver, Rp300.000/merchant + dana pencairan 1 hari, float **melampaui Rp1 miliar pada target penuh** (alarm 65 % tercapai bulan ke-8 proyeksi, ambang terlampaui bulan ke-11). Batas aman ≈ **55.900 order/bln** pada rasio saldo yang sama. Pengungkit: turunkan `voucher_balance_cap_customer`/nominal (saldo pelanggan = 70 % float), pencairan otomatis tanpa request (float merchant), atau siapkan izin PJP BI sebelum bulan ke-8.

KPI direktur (gerbang 80 %, akselerator 120 %, pengali SDM 0,8/0,9/1,0/1,1/1,25): Ops = order, driver+merchant aktif, SLA accept ≥ 95 %, pembatalan ≤ 8 %; Keuangan = NPR, COGS/order ≤ 3.551, float < 65 %, pencairan ≤ 24 jam ≥ 95 %, rekonsiliasi = 0, PPN disetor 100 %. Pool bonus 2 % NPR gabungan dua direktur [USULAN AI].

## 5. Proyeksi 12 bulan (ILUSTRATIF; buka Pekanbaru M1, Batam M3, Padang M5, Dumai M7; ramp ke target pada bulan ke-8 kota)
Order 371 rb · NPR Rp2,01 M · PPN disetor Rp221 jt · COGS Rp1,87 M · EBITDA kumulatif **+Rp138 jt** · break-even bulanan **bulan 6**, kumulatif **bulan 11** · kebutuhan dana maksimum **Rp250 jt** (bulan 5) · penghematan PG vs v4 Rp170 jt.

## 6. KEPUTUSAN PEMILIK (GM) yang dibutuhkan
1. **Nilai PF per layanan**: tetap prod (1.000/4.000/2.000/3.000/1.000/1.000/2.000/5.000) atau naikkan +500 (Padang) / +1.500 (Dumai) — atau PF berbeda per kota.
2. **Margin target** di atas COGS: 30 % (`cogs_margin_target_pct`) atau lain.
3. **Headcount**: 1 Kepala Kota + 2 MAO per kota (SDM Anggaran Tim memakai 3 MAO tier 1); pusat CS 2 / Finance 2 / admin 1; gaji direktur belum ada → cap bonus belum bisa dihitung.
4. **Tarif pajak**: PPN 11 % inklusif, PPh mitra 0 % — konfirmasi konsultan pajak; status PKP perusahaan.
5. **Target order per kota** (20.000/20.000/10.000/10.000 dari SDM) — realisasi prod 28 Sep: 9 order selesai.
6. **Batas float**: tindakan saat alarm 65 % (stop penjualan voucher? turunkan cap?) dan apakah mengurus izin PJP BI.
7. **Biaya transfer pencairan** (`payout_fee_per_withdrawal`): tetap 0 ditanggung platform atau dibebankan ke mitra.
8. Kurs USD 16.500, paket Supabase Pro + PITR, Stadia Maps — konfirmasi tagihan aktual.

Keterbatasan data: belum ada hasil pilot; bauran layanan, % non-tunai 40 %, saldo mengendap, kurva ramp, biaya pusat = ASUMSI. Angka FAKTA: UMK 2026, BPJS, tarif PKS Midtrans, service_economics prod, ambang BI PADG 32/2025.
