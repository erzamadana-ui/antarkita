# Catatan Sumber Deck Investor AntarKita

| | |
|---|---|
| **Berkas deck** | `docs/investor/AntarKita-Deck-Investor.pptx` (21 slide) |
| **Aset infografis** | `docs/investor/aset/*.png` (19 gambar, dibuat sendiri dengan matplotlib) |
| **Skrip pembangun** | `docs/investor/aset/gen_a.py`, `gen_b.py`, `gen_c.py`, `gen_d.py`, `_brand.py`, `docs/investor/build_deck.js` |
| **Tanggal penyusunan** | 7 September 2026 |
| **Tanggal akses seluruh sumber luar** | 7 September 2026 |

## Aturan penandaan

1. **`[S-xx]`** — angka/klaim yang dikutip dari daftar pustaka `docs/riset/RISET-KOMPENSASI-REGULASI.md` (61 sumber).
2. **`[E-xx]`** — sumber eksternal tambahan yang dicari khusus untuk deck ini (pasar & kompetisi), didaftar di bagian C.
3. **`[INT]`** — angka yang berasal dari artefak internal AntarKita (kode, migrasi, laporan uji, model biaya) — dapat diaudit langsung ke berkas yang disebut.
4. **`[ASUMSI]`** — perkiraan penyusun. **Bukan klaim faktual** dan tidak boleh dipakai sebagai dasar keputusan investasi tanpa validasi.

---

# A. Angka per slide dan sumbernya

## Slide 1 — Sampul
| Angka | Nilai | Sumber |
|---|---|---|
| Jumlah layanan | 8 | [INT] `docs/rilis/PLAY-STORE-LISTING.md`; `src/screens/**` |
| Jumlah aplikasi | 3 (Pelanggan, Mitra, Admin+Portal Eksekutif) | [INT] `apps/{pelanggan,mitra,admin}`; `docs/LAPORAN-UJI-SIMULASI.md` |
| Skenario uji LOLOS | 34 (S0–S33) | [INT] `docs/LAPORAN-UJI-SIMULASI.md` §8 |
| Kota operasi | 2 (Pekanbaru, Padang) | [INT] `docs/organisasi/DESAIN-ORGANISASI.md` §1 |

## Slide 2 — Masalah
| Angka | Nilai | Sumber |
|---|---|---|
| Penduduk Kota Pekanbaru | 1,14 juta jiwa (data per 2024) | [E-01] Databoks/Katadata mengutip BPS, data Juni 2024 |
| Penduduk Kota Padang | 939,85 ribu jiwa (2024) | [E-02] Databoks/Katadata mengutip BPS |
| Total pasar dua kota | ≈2,08 juta jiwa | Turunan dari [E-01]+[E-02] — penjumlahan, bukan kutipan |
| Tarif ojek daring Zona I | Rp1.850–Rp2.300/km; biaya jasa minimal Rp9.250–Rp11.500 | [S-24] Kepmenhub KP 564/2022 melalui ANTARA News |
| Rasio mitra aktif | ±20% (700–800 ribu aktif dari 3,7 juta terdaftar, Des 2025) | [S-58] Akurat.co 28 Feb 2026 mengutip CEO Grab Indonesia |

> Butir masalah 01, 02, dan 04 adalah **karakterisasi kualitatif** oleh penyusun berdasarkan portofolio layanan yang tersedia di pasar; tidak ada survei pelanggan yang mendasarinya. Perlakukan sebagai hipotesis kerja, bukan temuan riset.

## Slide 3 — Delapan layanan
| Butir | Sumber |
|---|---|
| Nama & cakupan 8 layanan | [INT] `docs/rilis/PLAY-STORE-LISTING.md`; `src/screens/{ride,food,send,box,shop,market,travel,pay}` |
| 86 layar / 1 basis kode / 3 aplikasi | [INT] hitungan berkas `src/screens/**/*.tsx` |

## Slide 4 — Anatomi aplikasi
| Angka | Nilai | Sumber |
|---|---|---|
| Tabel basis data | 66 | [INT] hitungan `create table` pada `supabase/migrations/0001–0030` |
| Fungsi SQL | 207 | [INT] hitungan `create or replace function` pada migrasi yang sama |
| Kebijakan RLS | 98 | [INT] hitungan `create policy` |
| Migrasi diterapkan | 30 | [INT] `supabase/migrations/` |
| Rute UI teruji | 68 (Pelanggan 26, Mitra 18, Admin 24) | [INT] `docs/LAPORAN-UJI-SIMULASI.md` §3 & `docs/RENCANA-LISTING-LIVE.md` §C |
| Edge Functions | `midtrans-create`, `midtrans-webhook`, `push-send` | [INT] `supabase/functions/` |
| Integrasi luar | Midtrans Snap, OSM/OSRM/Nominatim, FCM v1, WebRTC + STUN/TURN | [INT] `docs/INTEGRASI.md`, `docs/TAHAP11-KONTRAK-API.md` |

## Slide 5 — Perjalanan pelanggan
| Angka | Nilai | Sumber |
|---|---|---|
| Radius jemput per layanan | motor 5, mobil 8, food 5, send 6, shop/market 5, box 15 km | [INT] `app_settings.pickup_radius_km`, migrasi `0025` |
| Prioritas menurut rating | ≥4,8 → 0 dtk; ≥4,5 → 20 dtk; ≥4,0 → 45 dtk; sisanya 75 dtk | [INT] `app_settings.priority_tiers`, migrasi `0025` |
| Harga dinamis | 1,25× saat 0 driver online (Rp9.000 → Rp11.500) | [INT] skenario uji S16 |
| Ambang permohonan maaf menunggu | 5 menit | [INT] `app_settings.wait_apology_minutes` |
| Contoh order AntarRide | total Rp9.000, driver menerima Rp6.400 | [INT] skenario uji S1 |

## Slide 6 — Perjalanan mitra
| Butir | Sumber |
|---|---|
| Skor auto-verifikasi dokumen ≥80 | [INT] skenario uji S21 & migrasi `0022` |
| Pagar harga pasar: >2× acuan ditolak; 1,35× wajib nota | [INT] skenario uji S8 |
| Komisi merchant 15% | [INT] `pricing.merchant_commission_pct`; skenario uji S3 (subtotal Rp60.000 → merchant Rp51.000) |
| Penangguhan otomatis setelah 3 pembatalan / 24 jam | [INT] skenario uji S9 |
| Pencairan otomatis vs manual + PIN admin | [INT] skenario uji S12 |

## Slide 7 — AntarPay
| Butir | Nilai | Sumber |
|---|---|---|
| Ambang izin Bank Indonesia | dana float **≥ Rp1.000.000.000** wajib izin BI, closed loop maupun open loop | [S-31] PBI No. 20/6/PBI/2018 |
| Metode top-up otomatis | QRIS, GoPay, ShopeePay, VA bank (Midtrans Snap) | [INT] `docs/INTEGRASI.md` |
| Refund penuh saat order batal | Rp172.000 (AntarBox) | [INT] skenario uji S6 |
| Bagi hasil titipan antar kota | mitra travel 80% | [INT] `app_settings.travel_send_partner_pct` |
| **[ASUMSI]** | AntarKita tidak memerlukan izin PJP sendiri selama hanya menjadi merchant PJP berizin | Riset §B.6.3 — penilaian hukum yang **belum divalidasi** konsultan sistem pembayaran |

## Slide 8 — Diferensiasi
| Butir | Sumber |
|---|---|
| AntarNow: kode driver 6 karakter, order ditahan 120 detik | [INT] `docs/TAHAP11-KONTRAK-API.md` §A; migrasi `0030` (`orders.preferred_driver_id`, `direct_order_hold_seconds`) |
| Dispatch prioritas rating + radius dinamis | [INT] migrasi `0025` |
| Pasar Tradisional (pedagang, harga harian, pagar harga) | [INT] tabel `market_vendors`, `market_prices`; skenario uji S8 |
| Titipan antar kota lewat travel; batas 30 kg / 120 cm; bagi hasil 80% | [INT] migrasi `0025`, `travel_send_*`; skenario uji S5 |

## Slide 9 — Pasar (TAM / SAM / SOM)
| Angka | Nilai | Sumber |
|---|---|---|
| TAM — GMV ekonomi digital Indonesia | ≈US$100 miliar (2025), tumbuh +14% YoY | [S-53] Marketing-Interactive 17 Nov 2025; [S-54] ClickInsights 17 Des 2025 — keduanya meringkas e-Conomy SEA 2025 (Google–Temasek–Bain) |
| Proyeksi 2030 | ≈US$180 miliar (skenario menengah) | [E-03] business-indonesia.org mengutip e-Conomy SEA 2025, publikasi 27 Nov 2025 |
| SAM — GMV transportasi & antar makanan Indonesia | US$10 miliar (2025) | [S-53] |
| **SOM** | **belum dikuantifikasi** | **[ASUMSI] / tidak ada sumber.** Tidak ditemukan benchmark GMV on-demand untuk kota tier-2 Sumatera. Sengaja tidak diisi angka. |

## Slide 10 — Kompetisi
| Butir | Nilai | Sumber |
|---|---|---|
| Rencana merger Grab–GoTo; entitas gabungan diperkirakan menguasai hingga 91% pasar ride-hailing Indonesia | status: masih dinegosiasikan per 15 Jan 2026 | [E-04] Lowy Institute, "Indonesia's gamble on mega merger of ride-hailing firms", 15 Januari 2026 |
| Maxim hadir di Pekanbaru | — | [E-05] DataRiau, "Transportasi Online Maxim Sudah Hadir di 5 Kota Indonesia, Termasuk Pekanbaru" |
| Batas komisi 8% berlaku untuk seluruh pemain | — | [S-25] Hukumonline; [S-27] Kompas.id |
| **[ASUMSI]** | Penempatan setiap pemain pada matriks (sumbu luas ekosistem × kedalaman lokal) | Penilaian kualitatif penyusun. **Pangsa pasar per pemain di Indonesia tidak tersedia di sumber terbuka** — rinciannya di balik laporan berbayar Momentum Works. |

## Slide 11 — Model bisnis & batas komisi
| Angka | Nilai | Sumber |
|---|---|---|
| Batas potongan aplikasi ojek roda dua | **maksimal 8%** sejak 1 Juli 2026 (pengemudi menerima 92%) | [S-25] Hukumonline mengutip Perpres No. 27 Tahun 2026 (ditandatangani 1 Mei, diundangkan 4 Mei 2026); [S-26] Sekretariat Negara RI |
| Batas sebelumnya | maksimal 20% | [S-24] Kepmenhub KP 564/2022 |
| Cakupan 8% hanya roda dua | pemberitaan; asosiasi pengemudi mempertanyakan implementasinya untuk layanan lain | [S-27] Kompas.id |
| Aturan tarif tiga layanan (orang/barang/makanan) | **RENCANA, target terbit September 2026 — bukan hukum positif** | [S-28] CNN Indonesia 18 Ags 2026; [S-29] Kompas.com 19 Ags 2026; [S-30] Tempo.co |
| Komisi mobil / kirim / belanja / box | 20% (belum dibatasi regulasi) | [INT] tabel `pricing` |
| Komisi merchant AntarFood | 15% | [INT] `pricing.merchant_commission_pct` |
| Bagi hasil AntarTravel | 80% mitra / 20% platform | [INT] `app_settings.travel_send_partner_pct` |

## Slide 12 — Unit economics
| Angka | Nilai | Sumber |
|---|---|---|
| Order AntarRide contoh: total | Rp9.000 | [INT] skenario uji S1 |
| Biaya jasa aplikasi | Rp1.000 | [INT] `pricing.platform_fee` untuk `ride_motor` |
| Komisi pada konfigurasi terpasang (20%) | Rp1.600 → driver Rp6.400 | [INT] skenario uji S1 (cocok dengan `pricing.commission_pct = 20`) |
| Komisi pada konfigurasi patuh (8%) | Rp640 → driver Rp7.360 | Turunan aritmetik dari batas [S-25] atas basis biaya jasa Rp8.000 |
| Perubahan pendapatan komisi | −60% | Turunan (1.600 → 640) |
| Perubahan pendapatan platform per order | −37% (Rp2.600 → Rp1.640) | Turunan |
| **Temuan yang diungkap** | Nilai seed `pricing.commission_pct` untuk `ride_motor` di basis kode **masih 20** | [INT] `supabase/migrations/0001_schema.sql`. Dapat diubah dari Panel Admin tanpa rilis ulang; **wajib diturunkan ke ≤8% sebelum order roda dua pertama berjalan komersial.** |
| **[ASUMSI]** | Apakah "biaya jasa aplikasi Rp1.000" termasuk dalam batas 8% | Belum ada penegasan hukum. Wajib dikonfirmasi konsultan sebelum tarif final ditetapkan. |

## Slide 13 — Traksi & status produk
| Angka | Nilai | Sumber |
|---|---|---|
| Skenario transaksi LOLOS | 34 (S0–S33), 116 baris pemeriksaan, rollback penuh | [INT] `docs/LAPORAN-UJI-SIMULASI.md` §8 |
| Rute UI 0 error | 68 (Pelanggan 26 / Mitra 18 / Admin 24) | [INT] idem §3 |
| Migrasi basis data | 30 | [INT] `supabase/migrations/` |
| Bug nyata ditemukan uji & diperbaiki | 7 (0022, 0024, 0027, 0028, 0029 + perbaikan aplikasi) | [INT] idem §1, §2, §6–§8 |
| Alur lupa kata sandi | 19/19 pemeriksaan lolos | [INT] idem §4 |
| **Pernyataan negatif yang wajib dipertahankan** | **BELUM LIVE KOMERSIAL — nol order berbayar.** Notifikasi saat aplikasi tertutup, pemindahan earpiece↔loudspeaker, dan email laporan terjadwal **belum ada**. | [INT] idem §8 & `docs/RENCANA-LISTING-LIVE.md` |

## Slide 14 — Peta jalan
| Angka | Nilai | Sumber |
|---|---|---|
| Fase 0 (bulan 1–3) | 9 orang | [INT] `DESAIN-ORGANISASI.md` §3 (keputusan mengikat) + lembar `Headcount` |
| Fase 1 (bulan 4–12) | 24 orang | idem |
| Fase 2 (bulan 13–24) | 42 orang | idem |
| Fase 3 (bulan 25–36) | **60 orang [ASUMSI]** — indikatif, bukan komitmen | `DESAIN-ORGANISASI.md` §3 menandainya [ASUMSI] |
| Langkah pra-peluncuran | Midtrans → keystore/AAB → Play Console → NIB/KBLI/TDPSE | [INT] `docs/RENCANA-LISTING-LIVE.md` §B |

## Slide 15 — Organisasi
| Angka | Nilai | Sumber |
|---|---|---|
| Struktur 3 lapis + Dewan Komisaris | — | [INT] `DESAIN-ORGANISASI.md` §2 |
| Rekap Fase 2: Teknologi 16, Operasi 16, Growth 3, Keuangan 4, Legal 1, Direksi & Tata Kelola 2 | total 42 | [INT] lembar `Headcount` (uji kecocokan terhadap target = 0) |
| Rentang kendali maksimal | 7 orang | [INT] `DESAIN-ORGANISASI.md` §1.4 |
| Kewajiban DPO sejak Fase 1 | — | [S-37] UU 27/2022 Pasal 53; [S-39] Putusan MK No. 151/PUU-XXII/2024 |

## Slide 16 — Biaya SDM
| Angka | Nilai | Sumber |
|---|---|---|
| Biaya SDM Fase 0 | Rp230,3 juta/bulan (9 orang) | [INT] lembar `Ringkasan` model biaya SDM (Rp230.332.093) |
| Biaya SDM Fase 1 | Rp435,6 juta/bulan (24 orang) | idem (Rp435.555.486,5) |
| Biaya SDM Fase 2 | Rp636,3 juta/bulan (42 orang) | idem (Rp636.272.061,75) |
| Biaya SDM kumulatif bulan 1–24 | Rp11,689 miliar | idem, lembar `Proyeksi 24 Bulan` |
| Biaya non-gaji SDM kumulatif 24 bulan | Rp1,927 miliar — **[ASUMSI] seluruhnya** | idem, lembar `Biaya Non-Gaji` |
| Total biaya terkait SDM 24 bulan | Rp13,616 miliar | idem |
| Skenario Hemat / Dasar / Agresif | Rp8,02 M / Rp11,69 M / Rp16,00 M (36 / 42 / 48 orang) | idem, lembar `Ringkasan` bagian C |
| UMK Pekanbaru 2026 | Rp3.998.179,46 | [S-01], [S-05], [S-06] |
| UMK Padang 2026 (= UMP Sumbar) | Rp3.182.955 | [S-03], [S-04] |
| Iuran BPJS pemberi kerja | ≈9–11% di atas gaji pokok | [S-07], [S-08], [S-12] — kalkulasi turunan |
| Batas upah dasar Jaminan Pensiun | Rp11.086.300/bulan sejak Maret 2026 | [S-09], [S-10] |
| Akrual THR | 1/12 ≈ 8,33% | [S-14], [S-15], [S-16] |
| Kebijakan biaya perusahaan | gaji pokok × 1,19 | [INT] `DESAIN-ORGANISASI.md` §4.3 — **catatan: rasio terealisasi pada model 1,28×**, selisih dijelaskan di lembar `Sumber & Catatan` model |

## Slide 17 — Kepatuhan
| Kewajiban | Isi | Sumber |
|---|---|---|
| PSE Lingkup Privat (Komdigi) | wajib daftar **sebelum** sistem dipakai pengguna; sanksi pemutusan akses | [S-34] Permenkominfo 5/2020 jo. 10/2021 Pasal 2 & 7; [S-35] siaran pers Komdigi |
| DPO | wajib pasca Putusan MK 151/PUU-XXII/2024 ("dan" → "dan/atau"); denda administratif hingga **2% pendapatan tahunan** | [S-37] UU 27/2022; [S-38] YAPLegal; [S-39] Hukumku.id |
| KBLI 53200 Aktivitas Kurir | risiko **tinggi**, modal minimum **Rp500.000.000** + proposal usaha 5 tahun + izin sektor pos; batas konversi KBLI 2020→2025 di OSS 18 Juni 2026 | [S-41] Klinik Hukumonline 20 Apr 2026; [S-42] Hukumonline Pro 26 Jun 2026 |
| Izin Bank Indonesia | wajib bila dana float ≥ Rp1 miliar | [S-31] PBI 20/6/PBI/2018 |

> **Peringatan yang diwarisi dari riset:** teks lengkap Perpres 27/2026, PM 12/2019, PM 118/2018, dan Permenkominfo 5/2020 **tidak berhasil dibaca langsung**. Seluruh kutipan pasal berasal dari sumber sekunder dan **wajib dicek silang ke JDIH resmi** sebelum deck diajukan kepada regulator.

## Slide 18 — Risiko
| Risiko | Sumber |
|---|---|
| R1 — status kemitraan mitra pengemudi | [S-21] Hukumonline 28 Mei 2025; [S-48] CNBC Indonesia 30 Jul 2026; [S-49] Kompas.com 23 Jul 2026 |
| R2 — perluasan batas 8% ke layanan lain | [S-28], [S-29], [S-30] — berstatus **rencana** |
| R3 — konsolidasi Grab–GoTo | [E-04] Lowy Institute 15 Jan 2026 |
| R4 — ambang dana float Rp1 miliar | [S-31] |
| R5 — insiden data pribadi | [S-37], [S-38], [S-39] |
| R6 — kegagalan rekrutmen engineer senior | Riset §A.4.2–A.4.3 (tidak ada benchmark gaji Pekanbaru/Padang) |
| **[ASUMSI]** | Penempatan setiap risiko pada matriks dampak × kemungkinan | Penilaian kualitatif penyusun |

## Slide 19 — Kebutuhan pendanaan
| Pos | Nilai | Status |
|---|---|---|
| Biaya SDM (gaji + iuran + THR) 24 bulan | Rp11,689 miliar | [INT] model biaya SDM, lembar `Proyeksi 24 Bulan` |
| Biaya non-gaji melekat SDM 24 bulan | Rp1,927 miliar | **[ASUMSI] seluruh biaya satuan** — tidak ditemukan sumber harga coworking, perangkat, lisensi, atau premi asuransi di Pekanbaru/Padang |
| Modal minimum sektoral KBLI 53200 | Rp0,500 miliar | [S-41] |
| Pos non-SDM lainnya | Rp12,000 miliar | **[ASUMSI] PLACEHOLDER — INPUT PENGGUNA.** Wajib diganti angka rencana bisnis pemilik |
| **Total kebutuhan pendanaan 24 bulan** | **Rp26,116 miliar** | Penjumlahan empat baris di atas |
| Porsi biaya terkait SDM | 52% | Turunan; sensitif terhadap pos placeholder di atas |

## Slide 20 — Tim & tata kelola
| Butir | Sumber |
|---|---|
| RUPS → Dewan Komisaris → Direksi; ambang persetujuan belanja >Rp50 juta | [INT] `DESAIN-ORGANISASI.md` §6 |
| Irama rapat harian/mingguan/bulanan/kuartalan | idem |
| Pemisahan tugas keuangan (penyetuju ≠ pelaksana ≠ perekonsiliasi) | idem; ditegakkan sistem lewat PIN admin, `audit_logs`, `admin_finance_cascade` |
| Peran pemilik (akun Play Console, Midtrans, keystore) | [INT] `docs/RENCANA-LISTING-LIVE.md` bagian D |
| ESOP: kolam 10%, vesting 4 tahun, cliff 1 tahun | **[ASUMSI]** — `DESAIN-ORGANISASI.md` §4.4 menandai kolam 10% sebagai asumsi |
| Posisi Direksi belum diisi | [INT] pernyataan status apa adanya; rencana rekrutmen mengikuti lembar `Headcount` |

---

# B. Daftar lengkap [ASUMSI] yang perlu keputusan atau validasi pemilik

| # | [ASUMSI] | Muncul di slide | Apa yang dibutuhkan |
|---|---|---|---|
| 1 | **Pos non-SDM lainnya Rp12 miliar** (insentif mitra, pemasaran, infrastruktur, perizinan) | 19 | **Keputusan pemilik.** Ini adalah placeholder input pada model biaya, bukan hasil perhitungan. Benchmark CAC/CAD Indonesia tidak ditemukan di sumber terbuka. Deck **tidak boleh dipakai untuk penawaran** sebelum angka ini diganti. |
| 2 | **Seluruh pita gaji per posisi** (20 posisi, Pekanbaru & Padang) | 15, 16, 19 | Validasi dengan **minimal 5 penawaran gaji riil** per level. Tidak ada satu pun benchmark gaji terbuka untuk kedua kota. |
| 3 | **Seluruh biaya non-gaji SDM** (coworking Rp1,2 jt/kursi Pekanbaru & Rp0,9 jt Padang, perangkat Rp11 jt/orang, lisensi Rp450 rb, asuransi tambahan Rp350 rb, pelatihan Rp150 rb, rekrutmen Rp2,5 jt) | 16, 19 | Kutipan harga nyata dari vendor di kedua kota. |
| 4 | **Kelompok risiko JKK 0,54% (kantor) / 0,89% (lapangan)** | 16 (tidak ditampilkan eksplisit, memengaruhi total) | Konfirmasi ke kantor cabang BPJS Ketenagakerjaan saat pendaftaran perusahaan. |
| 5 | **Faktor penyesuaian geografis Jakarta → Pekanbaru/Padang (0,45–0,70)** | 16 | Validasi empiris; tidak ada dasar yang dapat dikutip. |
| 6 | **AntarKita bebas kewajiban izin PJP** selama hanya menjadi merchant PJP berizin | 7 | Opini konsultan hukum sistem pembayaran. |
| 7 | **Kewajiban menunjuk DPO** (penerapan Pasal 53 pada kasus konkret) | 15, 17 | Opini hukum. Risikonya asimetris — biaya menunjuk DPO jauh lebih kecil daripada denda 2% pendapatan tahunan. |
| 8 | **Perlakuan "biaya jasa aplikasi Rp1.000" terhadap batas 8%** | 11, 12 | Penegasan konsultan hukum sebelum tarif final ditetapkan. |
| 9 | **Headcount Fase 3 = 60 orang** | 14 | Indikatif; ditegaskan sebagai bukan komitmen di `DESAIN-ORGANISASI.md` §3. |
| 10 | **Kolam ESOP 10%, vesting 4 tahun, cliff 1 tahun** | 20 | Keputusan pemegang saham/RUPS. |
| 11 | **SOM (Pekanbaru + Padang, 3 tahun)** | 9 | Sengaja dikosongkan. Akan dihitung dari data order nyata 90 hari pertama peluncuran. |
| 12 | **Penempatan pemain pada matriks kompetisi** | 10 | Penilaian kualitatif; pangsa pasar per pemain di Indonesia tidak tersedia terbuka. |
| 13 | **Penempatan risiko pada matriks dampak × kemungkinan** | 18 | Penilaian kualitatif. |
| 14 | **Karakterisasi masalah 01, 02, 04** (pasar tradisional, titipan antar kota, aturan dari pusat) | 2 | Hipotesis kerja; belum ada survei pelanggan Pekanbaru/Padang yang mendasarinya. |
| 15 | **Beban Rp16.800/mitra/bulan untuk JKK+JKM BPU** | tidak dipakai di deck | Dicatat di sini agar tidak masuk proyeksi tanpa keputusan — bukan kewajiban hukum terverifikasi. |

## Tindakan teknis yang harus dikerjakan sebelum peluncuran komersial

| # | Tindakan | Bukti |
|---|---|---|
| 1 | **Turunkan `pricing.commission_pct` untuk `ride_motor` dari 20 menjadi ≤8** melalui Panel Admin → Tarif & Promo | Nilai seed `20` di `supabase/migrations/0001_schema.sql`. Tidak memerlukan rilis ulang aplikasi. |
| 2 | Tinjau ulang komisi layanan lain bila aturan tarif tiga layanan (rencana Sep 2026) benar terbit | [S-28], [S-29] |
| 3 | Pendaftaran PSE (TDPSE) **sebelum** sistem dipakai pengguna | [S-34] |
| 4 | Penunjukan DPO sebelum operasi komersial dimulai | [S-37], [S-39] |

---

# C. Sumber eksternal tambahan untuk deck ini

Seluruh URL diakses **7 September 2026**.

- **[E-01]** "Jumlah Penduduk Kota Pekanbaru 1,14 Juta Jiwa Data per 2024". Databoks / Katadata, mengutip Badan Pusat Statistik (data Juni 2024). https://databoks.katadata.co.id/demografi/statistik/ebd777762a603a8/jumlah-penduduk-kota-pekanbaru-1-14-juta-jiwa-data-per-2024
- **[E-02]** "Update 2024: Jumlah Penduduk Kota Padang 939,85 Ribu Jiwa". Databoks / Katadata, mengutip Badan Pusat Statistik. https://databoks.katadata.co.id/demografi/statistik/1e79f219c173248/update-2024-jumlah-penduduk-kota-padang-939-85-ribu-jiwa *(halaman mengembalikan 404 saat pengambilan ulang; angka dan tahun dikonfirmasi dari judul dan ringkasan hasil pencarian — **wajib diverifikasi ulang ke BPS Kota Padang** sebelum publikasi)*
- **[E-03]** "AI to Shape Indonesia's Digital Economy as It Moves Toward USD 180 Billion 2030". Business Indonesia, mengutip laporan e-Conomy SEA 2025 (Google–Temasek–Bain), publikasi 27 November 2025. https://business-indonesia.org/news/ai-to-shape-indonesia-s-digital-economy-as-it-moves-toward-usd-180-billion-2030
- **[E-04]** "Indonesia's gamble on mega merger of ride-hailing firms". Lowy Institute — The Interpreter, 15 Januari 2026. Memuat perkiraan pangsa gabungan hingga 91% pasar ride-hailing Indonesia dan status merger yang masih dinegosiasikan. https://www.lowyinstitute.org/the-interpreter/indonesia-s-gamble-mega-merger-ride-hailing-firms
- **[E-05]** "Transportasi Online Maxim Sudah Hadir di 5 Kota Indonesia, Termasuk Pekanbaru". DataRiau. https://www.datariau.com/detail/berita/Transportasi-Online-Maxim-Sudah-Hadir-di-5-Kota-Indonesia--Termasuk-Pekanbaru

> Daftar pustaka `[S-01]`–`[S-61]` selengkapnya ada di `docs/riset/RISET-KOMPENSASI-REGULASI.md` bagian **Daftar Pustaka**, beserta bagian **Keterbatasan Data** yang mencantumkan angka-angka yang **tidak ditemukan sumber kredibelnya** (a.l. CAC/CAD Indonesia, take rate riil per layanan, pangsa pasar per pemain, benchmark gaji Pekanbaru/Padang).

---

# D. Daftar infografis

Seluruhnya dibuat sendiri dengan matplotlib (skrip disertakan), memakai warna design system aplikasi `src/lib/theme.ts` — teal `#187A85`, putih, abu netral, aksen hangat `#F5A524`.

| Berkas | Slide | Isi |
|---|---|---|
| `02-masalah.png` | 2 | Panel pasar dua kota + 4 kartu masalah |
| `03-layanan.png` | 3 | Diagram hub-and-spoke 8 layanan |
| `04-anatomi.png` | 4 | **Anatomi aplikasi** — 3 lapis: aplikasi, backend Supabase, integrasi luar |
| `05-perjalanan-pelanggan.png` | 5 | Alur 6 langkah pesan → dispatch → perjalanan → bayar |
| `06-perjalanan-mitra.png` | 6 | Dua jalur: mitra driver dan merchant/pedagang pasar |
| `07-antarpay.png` | 7 | Alur uang masuk → dompet → keluar + catatan kepatuhan BI |
| `08-diferensiasi.png` | 8 | Empat diferensiasi dengan rujukan tabel/migrasi |
| `09-pasar.png` | 9 | Corong TAM / SAM / SOM |
| `10-kompetisi.png` | 10 | Matriks posisi + konteks persaingan 2026 |
| `11-takerate.png` | 11 | Batas potongan per layanan + dampak Perpres 27/2026 |
| `12-unit-economics.png` | 12 | Dua corong unit economics: konfigurasi terpasang vs patuh |
| `13-traksi.png` | 13 | Angka besar + tiga kolom status (siap / menunggu pemilik / belum ada) |
| `14-peta-jalan.png` | 14 | Timeline 4 fase, 36 bulan |
| `15-organisasi.png` | 15 | Bagan organisasi Fase 2 (42 orang) |
| `16-biaya-sdm.png` | 16 | Grafik biaya SDM per fase + ringkasan kumulatif |
| `17-kepatuhan.png` | 17 | Empat kewajiban regulasi dengan sanksi dan dasar hukumnya |
| `18-risiko.png` | 18 | Matriks risiko + register 6 risiko dan mitigasinya |
| `19-pendanaan.png` | 19 | Komposisi kebutuhan pendanaan 24 bulan dengan penandaan status data |
| `20-tata-kelola.png` | 20 | Rantai kewenangan, pemisahan tugas keuangan, tim, irama rapat |

---

*Deck ini bukan nasihat hukum, pajak, atau keuangan. Sebelum dipakai dalam dokumen yang mengikat, seluruh kutipan pasal wajib diverifikasi ke teks resmi di JDIH masing-masing instansi.*
