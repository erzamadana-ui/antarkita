# Desain Organisasi AntarKita — keputusan Direktur Utama (7 September 2026)
Dokumen ini adalah **keputusan struktur** yang mengikat seluruh turunan (model biaya SDM, manual SOP, deck investor).
Semua angka biaya mengacu `docs/riset/RISET-KOMPENSASI-REGULASI.md`; angka yang tidak bersumber ditandai [ASUMSI].

## 1. Prinsip organisasi
1. **Dua kota dulu, satu playbook.** Pekanbaru (kota induk, kantor pusat operasional) dan Padang (kota kedua).
   Struktur dirancang agar kota ke-3 dst. cukup menambah 1 City Manager + 2 Ops, bukan menambah lapisan baru.
2. **Rasio produk : operasi : dukungan = 40 : 45 : 15** pada tahun pertama. Perusahaan ini menang di lapangan,
   bukan di jumlah fitur.
3. **Kepatuhan bukan fungsi tambahan.** Legal & Compliance dan DPO ada sejak Fase 1 — konsekuensi UU 27/2022 +
   Putusan MK 151/PUU-XXII/2024 (pengendali data skala besar & pemantauan sistematis).
4. **Rentang kendali maksimal 7 orang**; setiap posisi punya satu atasan tunggal dan satu ukuran keberhasilan utama.
5. **Tidak ada peran yang hanya mengawasi.** Setiap manajer memegang minimal satu KPI operasional yang dieksekusi sendiri.

## 2. Struktur (3 lapis + dewan)
```
Dewan Komisaris (Komisaris Utama)
└── Direktur Utama (CEO)
    ├── Direktur Teknologi (CTO)
    │   ├── Engineering Manager → Mobile Engineer, Backend Engineer, QA Engineer
    │   ├── Product Designer (UI/UX)
    │   └── Data Analyst
    ├── Direktur Operasi (COO)
    │   ├── City Manager Pekanbaru → Ops Supervisor, Partner Acquisition
    │   ├── City Manager Padang → Ops Supervisor, Partner Acquisition
    │   ├── Head of Customer Experience → CS Lead, CS Agent (shift)
    │   └── Trust & Safety Officer (anti-fraud, insiden, SOS)
    ├── Head of Finance (merangkap Direktur Keuangan pada Fase 1–2)
    │   ├── Finance & Accounting Staff
    │   └── Treasury/Settlement Officer (rekonsiliasi dompet & payout mitra)
    ├── Head of Legal & Compliance (merangkap DPO)
    └── Head of Growth & Partnership
        ├── Digital Marketing Staff
        └── Merchant Acquisition Officer
    └── HR & GA Generalist (garis putus ke seluruh direktorat)
```

## 3. Rencana tenaga kerja bertahap
| Fase | Periode | Fokus | Jumlah orang (kumulatif) |
|---|---|---|---|
| Fase 0 — Pra-peluncuran | Bulan 1–3 | Menyelesaikan produk, izin, uji tertutup Pekanbaru | **9** |
| Fase 1 — Peluncuran Pekanbaru | Bulan 4–12 | Likuiditas pasar 1 kota, unit economics positif per order | **24** |
| Fase 2 — Padang + skala | Bulan 13–24 | Replikasi playbook, dua kota profitabel di tingkat kota | **42** |
| Fase 3 — Ekspansi (indikatif) | Bulan 25–36 | 2 kota tambahan Sumatera | **60** [ASUMSI] |

Rincian posisi per fase ada di model biaya (lembar "Headcount") — model itu yang menjadi sumber angka resmi.

## 4. Kebijakan kompensasi
1. **Dua struktur payroll** karena selisih UMK 25,6%: Pekanbaru (UMK 2026 Rp3.998.179) dan Padang (Rp3.182.955).
2. Setiap posisi punya **pita gaji (band) P25–P75**; penawaran baru default di P50, di atas P75 wajib persetujuan Dirut.
3. **Biaya perusahaan = gaji pokok × 1,19** (BPJS TK+JKN pemberi kerja ≈9–11% + akrual THR 8,33%).
4. **Ekuitas menggantikan tunai di level direksi** pra-pendanaan: gaji tunai C-level ditahan di P25 band, selisihnya
   dikompensasi ESOP (kolam 10% [ASUMSI], vesting 4 tahun, cliff 1 tahun).
5. Insentif variabel hanya untuk peran yang hasilnya terukur harian: Partner Acquisition, Merchant Acquisition,
   CS (kualitas), City Manager (target kota). Maksimal 20% dari total kompensasi tahunan.

## 5. Kerangka target (dipakai untuk OKR & lampiran investor)
Target disusun 3 lapis: **Perusahaan → Direktorat → Posisi**, semuanya dapat diaudit dari data aplikasi
(tabel `orders`, `drivers`, `tickets`, `wallet_transactions`, laporan `admin_finance_cascade`).

| Lapis | Contoh ukuran | Sumber data |
|---|---|---|
| Perusahaan | GMV bulanan, order selesai/hari, marjin kotor, kas tersisa (runway) | Portal Eksekutif → P&L |
| Teknologi | Waktu tayang fitur, crash-free session, waktu balas API p95, insiden keamanan | CI + log Supabase |
| Operasi | Order per driver aktif per hari, tingkat penyelesaian order, waktu tunggu driver, tingkat pembatalan | `orders`, `driver_available_orders` |
| Pengalaman pelanggan | Waktu balas pertama tiket, rating rata-rata, tiket per 1.000 order | `tickets`, `ratings` |
| Keuangan | Take rate efektif, marjin per layanan, akurasi rekonsiliasi dompet, umur piutang | `admin_finance_cascade` |
| Kepatuhan | Status PSE, DPO aktif, insiden data, pemenuhan batas potongan | Registrasi & log audit |

**Catatan regulasi yang mengubah target 2026:** Perpres 27/2026 (berlaku 1 Juli 2026) menurunkan batas potongan
aplikasi ojek roda dua menjadi **maksimal 8%**. Semua proyeksi pendapatan segmen AntarRide motor WAJIB memakai
take rate ≤8%; kompensasinya dicari dari layanan non-roda-dua (AntarCar, AntarFood, AntarSend, AntarShop/Market,
AntarTravel) dan pendapatan non-komisi (iklan merchant, biaya layanan pelanggan, langganan mitra).

## 6. Tata kelola
- **RUPS → Dewan Komisaris → Direksi.** Komisaris menyetujui: rencana kerja & anggaran tahunan, belanja > Rp50 juta,
  perubahan struktur organisasi, kebijakan tarif & komisi, dan penunjukan pejabat setingkat Head.
- **Rapat rutin:** harian 15 menit operasi kota; mingguan direksi; bulanan komisaris (paket laporan dari Portal Eksekutif);
  kuartalan penetapan ulang OKR.
- **Pemisahan tugas keuangan:** yang menyetujui pencairan ≠ yang mengeksekusi ≠ yang merekonsiliasi
  (sudah didukung sistem: gerbang PIN admin, log aktivitas, laporan cascade).
