---
title: Laporan Uji AntarKita — Standar Testing Listing Nasional v1.0
tanggal: 2026-09-12
release_candidate: commit 30e3ced + perbaikan QC (migrasi 0083, 0084; orders.ts; osm-import v2) · AAB v3.0.0 build 104 (Release aab-4) → build 105 setelah push
pelaksana: Claude sebagai QA Lead independen (atas kuasa Erza Pradipta Madana)
status: TEST SUMMARY — bukan pernyataan siap listing / patuh hukum / bebas bug
---

# Laporan Uji AntarKita terhadap Standar Testing Listing Nasional

## 0. Keputusan

| Status yang diajukan | Rekomendasi QA | Alasan singkat |
|---|---|---|
| `INTERNAL TEST` (Play Console, tester terbatas) | **GO WITH RISK** | 0 Blocker/Critical terbuka. 1 High (ketuk ganda order) DIPERBAIKI dan diuji ulang. 2 Medium terbuka dengan PIC. Jalur uang, state machine, akses data, lokasi, webhook idempotensi lulus pada basis data produksi. |
| `CLOSED BETA` | **GO WITH RISK** setelah AUTH-06, NOT-03, PAY-05, LOC-04, PERF-01 ditutup | Butuh uji perangkat fisik, push server hidup, Midtrans sandbox, proteksi kata sandi bocor. |
| `NATIONAL LISTING READY` | **NO-GO** | Gerbang §9 yang belum ada buktinya: pentest independen (SEC-05), latihan restore backup (SEC-04/E2E-10), uji beban & SLO (PERF-02), aksesibilitas (PERF-03), review legal PSE/PDP/pajak oleh counsel (bukan QA), Midtrans production, Play pre-launch report. |

Risiko yang diterima harus ditandatangani Founder secara tertulis (§9, butir 2 & 11).

## 1. Ruang lingkup dan lingkungan

* Artefak: repositori `erzamadana-ui/antarkita` @ `30e3ced` + perbaikan hari ini; basis data Supabase `qwltshvzrsykxdvhbxcv` (produksi — **semua uji server dijalankan dalam transaksi yang di-ROLLBACK**, data pemilik tidak berubah); web live `erzamadana-ui.github.io/antarkita` (pelanggan/mitra/admin); Edge Functions `midtrans-webhook`, `turn-credentials`, `osm-import`.
* Catatan ruang lingkup: standar §1 membatasi tahap awal pada *Antar Barang instan* dan *Antar Makan merchant terpilih*. Aplikasi saat ini mengaktifkan 8 layanan (ride, car, food, send, box, shop, market, travel) di 3 kota aktif. **Perbedaan ini adalah keputusan Founder** (perubahan ruang lingkup tertulis) — QA menguji semua layanan yang benar-benar aktif.
* Lapisan yang dijalankan hari ini (§5): unit (3 skrip Node, 20 pemeriksaan), integration/DB (7 skrip SQL, 250+ pemeriksaan), E2E otomatis (Playwright + server tiruan, 29 pemeriksaan; simulasi transaksi 53 skenario), uji langsung Edge Function dari browser. **Belum**: exploratory di perangkat fisik, field/UAT, beban, aksesibilitas, pentest.

## 2. Temuan dan perbaikan hari ini

| # | Temuan | Severity (§3) | Tindakan | Bukti |
|---|---|---|---|---|
| 1 | **Ketuk ganda / koneksi putus saat submit membuat 2 pesanan + 2 potongan dompet** (`create_order` tanpa kunci idempotensi) — melanggar §6.2 & E2E-07 | High | Migrasi **0083**: kolom `orders.client_request_id` + indeks unik per pelanggan; `create_order` mengembalikan pesanan yang sudah ada untuk kunci sama; penjaga ketuk ganda 15 detik untuk build lama. Klien: `src/lib/orders.ts` (`createOrder()`) dipakai 6 layar pesan. | `bukti/uji_idempotensi.log` 5/5; `scripts/test-order-request.mjs` 7/7 |
| 2 | Impor tempat OSM nasional macet: 2 tugas `running` tanpa pekerja, 30 pending; timeout 45 dtk terlalu pendek untuk kueri se-provinsi | Medium (data, bukan uang) | Edge Function `osm-import`: timeout dinamis ≤100 dtk dipotong sisa anggaran, mirror ketiga, dan migrasi **0084** `osm_release_task` (tugas kembali ke antrean seketika). Loop impor dijalankan dari sesi admin. | `bukti/uji_impor.log` |
| 3 | Uji `uji_kota.sql` 7a usang: menganggap semua kota harus `active`, padahal sejak 0071 kota gazetteer OSM sengaja `active=false` | Low (uji, bukan produk) | Uji direvisi: hanya kota layanan (`source<>'osm'`) yang dijaga | `bukti/uji_kota.log` |
| 4 | Proteksi kata sandi bocor (HIBP) belum aktif di Supabase Auth | Medium | Butuh login dashboard pemilik (Auth → Attack Protection) | advisor `auth_leaked_password_protection` |
| 5 | 2 advisori dependensi moderat (transitif): `decode-uri-component` via expo-router; `uuid` via xcode (hanya build) | Medium | Tidak ada perbaikan non-breaking; dijadwalkan bersama kenaikan Expo SDK berikutnya (risiko: DoS URL deep-link di perangkat sendiri) | `npm audit` 12 Sep |

## 3. Matriks kasus uji (ringkas — versi lengkap dengan prasyarat/data/langkah di `Matriks-Uji-AntarKita-2026-09-12.xlsx`)

| ID | Bagian | Skenario | Actual | Severity | Bukti | Status | PIC / target |
|---|---|---|---|---|---|---|---|
| AUTH-01 | 6.1 / E2E-09 | Pengguna A tidak bisa membaca dompet/order pengguna B (IDOR) | 0 baris | - | bukti/uji_keamanan.log | **PASS** |  |
| AUTH-02 | 6.1 | Eskalasi hak: customer mengubah role sendiri jadi admin | Diblokir | - | bukti/uji_keamanan.log | **PASS** |  |
| AUTH-03 | 6.1 | Fungsi admin dipanggil non-admin / anon | Ditolak | - | bukti/uji_keamanan.log, uji_kota.log 6a–6f, uji_turn.log 2a–3c | **PASS** |  |
| AUTH-04 | 6.1 | Hapus akun → e-mail bebas dipakai daftar ulang, sesi lama mati | Sesuai (S35a–e) | - | bukti/simulasi_e2e.log | **PASS** |  |
| AUTH-05 | 6.1 | Lupa/reset kata sandi lewat e-mail, tautan kedaluwarsa | Bukti sesi 6 Sep (19 pemeriksaan) — TIDAK diulang pada RC ini | - | docs/LUPA-KATA-SANDI.md | **BLOCKED** | QA: ulang pada RC final |
| AUTH-06 | 6.1 / 6.7 | Proteksi kata sandi bocor (HIBP) & pembatasan percobaan login | Advisor Supabase: auth_leaked_password_protection = WARN (OFF) | Medium | get_advisors security 12 Sep | **FAIL** | Erza (login dashboard) — sebelum closed beta |
| ORD-01 | 6.2 / E2E-01 | Golden path pesanan: searching → accepted → arrived → in_progress → completed, PIN serah-terima | Sesuai | - | bukti/simulasi_e2e.log S1, S38 | **PASS** |  |
| ORD-02 | 6.2 | Satu order tidak dapat diterima dua mitra (balapan) | Sesuai | - | bukti/simulasi_e2e.log S48a–b | **PASS** |  |
| ORD-03 | 6.2 / E2E-07 | Ketuk ganda / koneksi putus saat submit → tidak ada order & tagihan ganda | SEBELUM: 2 order + 2 potongan (S48c). SESUDAH migrasi 0083 + orders.ts: 1 order, 1 potongan | High (diperbaiki) | bukti/uji_idempotensi.log; scripts/test-order-request.mjs 7/7 | **PASS (setelah perbaikan)** | Build 105 memuat kunci klien; server sudah aktif |
| ORD-04 | 6.2 / E2E-06 | Tidak ada mitra / mitra menolak / kelas kendaraan tidak tersedia | Sesuai | - | bukti/simulasi_e2e.log S17, S22–S24, S34 | **PASS** |  |
| ORD-05 | 6.2 / E2E-05 | Pembatalan pada tiap status yang diizinkan, konsekuensi biaya/refund | Sesuai | - | bukti/simulasi_e2e.log S44, S45, S50, S51 | **PASS** |  |
| ORD-06 | 6.2 / E2E-08 | Intervensi admin: batal/refund dengan alasan, pelaku, jejak audit, PIN | Sesuai | - | bukti/simulasi_e2e.log S27, S45 | **PASS** |  |
| ORD-07 | 6.2 | Mitra tidak bisa menyelesaikan/mengambil order di luar assignment | Sesuai | - | bukti/simulasi_e2e.log S23c, S48a | **PASS** |  |
| PAY-01 | 6.3 | Quote harga dapat dilacak: jarak, tarif, biaya jasa, promo, total; bagian driver/merchant/platform | Sesuai (0 pelanggaran) | - | bukti/simulasi_e2e.log S29, S30 | **PASS** |  |
| PAY-02 | 6.3 | Klien tidak bisa memanipulasi nominal: server menghitung ulang dari route_km; tagihan = yang ditampilkan | Sesuai 7/7 layanan | - | tests/peta/uji-ongkos.mjs (12 Sep) | **PASS** |  |
| PAY-03 | 6.3 / E2E-03 | Webhook settlement dikirim 2×, status expire, external_id tak dikenal | Sesuai (kredit ke-2 = 0, 1 baris mutasi) | - | bukti/simulasi_e2e.log S46 | **PASS** |  |
| PAY-04 | 6.3 | Webhook Midtrans dengan signature palsu / payload kosong | 400 'Server key belum diatur' (gagal-tertutup) | - | uji langsung 12 Sep (Chrome) | **PASS** | Ulangi dengan kunci sandbox terpasang |
| PAY-05 | 6.3 | Snap sandbox: sukses, gagal, pending, kedaluwarsa, dibayar terlambat | gateway_secrets kosong — belum bisa diuji | - | - | **BLOCKED** | Erza: login dashboard Midtrans (sandbox + production) |
| PAY-06 | 6.3 | Refund/penyesuaian saldo manual admin, top up manual ditolak | Sesuai | - | bukti/simulasi_e2e.log S45c, S46a–b | **PASS** |  |
| PAY-07 | 6.3 (rekonsiliasi) | Invarian buku besar: saldo = Σ mutasi; 0 order selesai tanpa pembagian; 0 dompet minus non-driver; platform tidak membayar > diskon | 0 pelanggaran (5/5) | - | bukti/simulasi_e2e.log S53 | **PASS** |  |
| PAY-08 | 6.3 | Tidak ada kunci gateway/API di repo, log, aplikasi | 0 temuan (hanya placeholder dokumentasi) | - | git grep 12 Sep | **PASS** |  |
| PAY-09 | 6.3 | Penarikan: minimum, negatif, melebihi saldo, ganda, ditolak admin, otomatis vs manual saat flag fraud | Sesuai | - | bukti/simulasi_e2e.log S12, S47 | **PASS** |  |
| PAY-10 | 6.3 / hukum | Komisi roda dua ≤ 8% (Perpres 27/2026) dijaga server | Ditolak; 7% diterima; non-roda-dua tak terpengaruh | - | bukti/simulasi_e2e.log S37 | **PASS** | Food/send: menunggu opini hukum |
| PAY-11 | 6.3 | Order tunai: potongan platform dari dompet driver, deposit minus dibatasi −500.000 | Sesuai | - | bukti/simulasi_e2e.log S39–S42, S52 | **PASS** |  |
| LOC-01 | 6.4 | Gerbang kota di SERVER (bukan hanya UI): kota belum dilayani / di luar radius ditolak dengan alasan | 29 lulus (Playwright) + 12/12 blok SQL | - | bukti/uji_kota.log; tests/kota/uji-kota.mjs | **PASS** |  |
| LOC-02 | 6.4 | Batas jarak per layanan & antar kota | Sesuai | - | bukti/simulasi_e2e.log S18 | **PASS** |  |
| LOC-03 | 6.4 / 6.7 | Kunci peta: rahasia tidak pernah keluar ke klien; kunci publik disisipkan server; Stadia aktif | Sesuai; uses_free_osm=false | - | bukti/uji_peta.log; uji langsung 12 Sep | **PASS** | Kunci Stadia tidak bisa dibatasi per package Android — pantau kuota |
| LOC-04 | 6.4 | Izin lokasi ditolak → aplikasi tetap memberi jalur aman (pilih titik manual) | Belum diuji pada perangkat fisik pada RC ini | - | - | **BLOCKED** | QA manual di HP (Erza/tester) — sebelum closed beta |
| LOC-05 | 6.4 | Tombol bantuan/SOS & tiket eskalasi | Sesuai | - | bukti/simulasi_e2e.log S13, S28 | **PASS** | SOP respons SOS manusia belum diuji lapangan |
| MER-01 | 6.5 | Merchant tutup/belum disetujui tidak menerima order; keranjang kosong ditolak | Ditolak (aturan create_order; S3 jalur sukses) | - | supabase/migrations/0014 + S3 | **PASS** |  |
| MER-02 | 6.5 | Merchant menolak order berbayar → refund & kuota promo kembali | Sesuai | - | bukti/simulasi_e2e.log S44g | **PASS** |  |
| MER-03 | 6.5 | Pendapatan, insentif, potongan mitra normal & pembatalan | Sesuai | - | bukti/simulasi_e2e.log S38, S44, S50 | **PASS** |  |
| MER-04 | 6.5 | Dokumen mitra: akses minimum & retensi | RLS ada; kebijakan retensi belum ditinjau legal | - | - | **BLOCKED** | Review privacy/legal (bukan QA) |
| NOT-01 | 6.6 | Notifikasi membawa kunci tujuan; tidak mengungkap data sensitif | Sesuai; 5 jenis informatif tanpa tujuan (dicatat) | - | bukti/simulasi_e2e.log S33 | **PASS** |  |
| NOT-02 | 6.6 | Token push idempoten & RLS; pengiriman ulang tidak mengubah status | Sesuai | - | bukti/simulasi_e2e.log S36 | **PASS** |  |
| NOT-03 | 6.6 | Push benar-benar sampai ke perangkat (FCM v1) dari server | Secret belum diisi → push_dispatch skipped | - | S36f | **BLOCKED** | Erza: unggah service account Firebase ke Supabase secrets + admin_set_push_config |
| NOT-04 | 6.6 | Moderasi UGC: blokir pengguna, laporan konten, batas laju, jejak audit | 18/18 | - | bukti/uji_moderasi.log | **PASS** |  |
| SEC-01 | 6.7 | TLS, CORS, error handling Edge Function | Supabase TLS; CORS '*' + JWT; error pesan ringkas | - | kode Edge Functions | **PASS** | CORS '*' dapat diterima untuk API publik ber-JWT |
| SEC-02 | 6.7 | Dependency scan (npm audit) | 0 high/critical; 15 moderate transitif dari 2 advisori (decode-uri-component via expo-router; uuid via xcode build-time) | Medium | npm audit 12 Sep | **PASS (GO WITH RISK)** | Eng: naikkan saat Expo SDK berikutnya; tidak ada perbaikan non-breaking |
| SEC-03 | 6.7 | Secret scan repo | 0 rahasia | - | git grep 12 Sep | **PASS** |  |
| SEC-04 | 6.7 / E2E-10 | Backup/restore diuji (bukti restore DB & pemulihan order/payment) | Belum pernah dilakukan; paket Supabase saat ini belum diverifikasi punya PITR | - | - | **BLOCKED** | Eng+Erza: aktifkan backup harian/PITR, latihan restore sebelum rilis nasional |
| SEC-05 | 6.7 | SAST/DAST/penetration test independen jalur kritis | Belum dilakukan pihak independen (baru advisor Supabase + uji internal) | - | get_advisors 12 Sep | **BLOCKED** | Erza: vendor pentest sebelum rilis nasional |
| SEC-06 | 6.7 | Runbook insiden, rollback, on-call, status page | Runbook rilis ada; latihan insiden & status page belum | - | docs/rilis/RUNBOOK-LISTING-BESOK.md | **PASS (GO WITH RISK)** | Ops: latihan insiden 1× sebelum closed beta |
| SEC-07 | 6.7 | Advisor keamanan Supabase (RLS, security definer, extension in public) | 1 ERROR: spatial_ref_sys (tabel sistem PostGIS, tidak berisi data pengguna); 23 fungsi anon = jalur publik pra-login yang disengaja (estimasi, status kota, shared_order) | Low | get_advisors 12 Sep | **PASS (dengan catatan)** | Eng: dokumentasikan daftar fungsi anon yang disengaja |
| PERF-01 | 6.8 | Uji perangkat/versi Android target, layar kecil, memori rendah, jaringan putus-sambung | Belum dilakukan pada RC ini | - | - | **BLOCKED** | QA manual (Erza + 2 tester) sebelum closed beta; Play pre-launch report |
| PERF-02 | 6.8 | SLO & uji beban (lonjakan order, notifikasi serentak, webhook ulang) | Belum dilakukan | - | - | **BLOCKED** | Eng: k6/ artillery terhadap RPC create_order & webhook — sebelum rilis nasional |
| PERF-03 | 6.8 | Aksesibilitas: TalkBack, teks besar, kontras, label kontrol | Belum dilakukan | - | - | **BLOCKED** | QA manual + Play pre-launch accessibility |
| CALL-01 | 6.6 / 6.8 | Panggilan suara di jaringan seluler: kredensial TURN berumur pendek, api_token tidak bocor | Sesuai | - | bukti/uji_turn.log | **PASS** | Uji panggilan nyata 2 HP di jaringan seluler: BLOCKED (manual) |
| DATA-01 | 6.4 (data tempat) | Impor tempat OSM: gazetteer, dedupe, faskes ke poi, kota layanan tidak tergandakan | Sesuai; S9 terhalang pekerjaan impor yang sedang berjalan (efek data) | Low | bukti/uji_impor.log | **PASS (dengan catatan)** | Pekerjaan impor nasional: 7/39 tugas; Overpass publik lambat — 0084 + mirror ketiga dipasang |

## 4. Skenario E2E wajib (§7)

| ID | Skenario | Hasil |
|---|---|---|
| E2E-01 | Antar barang bayar dompet → mitra → pickup → antar → selesai (QRIS diganti dompet karena Midtrans belum terpasang) | PASS (server) — ORD-01, PAY-07; jalur QRIS BLOCKED (PAY-05) |
| E2E-02 | Antar makan: merchant terima, mitra pickup, antar, selesai; harga sama di semua peran | PASS — S3, S38c, S42, PAY-01 |
| E2E-03 | Webhook pembayaran sama dikirim 2× → satu pembayaran | PASS — S46c (DB) + PAY-04 (HTTP gagal-tertutup); ulang dengan kunci sandbox |
| E2E-04 | Pembayaran sukses tetapi mitra tak tersedia → refund/batal, saldo tidak menggantung | PASS — S44a (batal saat SEARCHING refund utuh), S51e |
| E2E-05 | Batal pada tiap titik status | PASS — ORD-05 |
| E2E-06 | Mitra offline saat ditugaskan/mengantar → timeout/redispatch | PASS sebagian — S17/S23/S24/S34 (fallback & masa tahan); skenario 'offline saat mengantar' hanya lewat admin batal (S45a): perlu uji lapangan |
| E2E-07 | Koneksi putus saat submit → tidak ada order/tagihan ganda | PASS setelah perbaikan 0083 — ORD-03 |
| E2E-08 | Admin menyelesaikan dispute/refund dengan otorisasi & jejak | PASS — ORD-06, PAY-06 |
| E2E-09 | Pengguna A akses order pengguna B | PASS — AUTH-01, S31c–f |
| E2E-10 | Restore dari backup di lingkungan latihan | BLOCKED — SEC-04 |


## 5. Bukti

Folder `docs/uji/bukti/`: `simulasi_e2e.log` (199 OK / 0 BUG), `uji_keamanan.log` (5/5), `uji_moderasi.log` (18/18), `uji_peta.log` (7/7 blok), `uji_kota.log` (12/12 blok + Playwright 29/29), `uji_turn.log` (9/9), `uji_idempotensi.log` (5/5), `uji_impor.log` (12 skenario, catatan S9/S10). Skrip Node: `npm test` (audio 6, push 7, order 7) dan `node tests/peta/uji-ongkos.mjs` (7 layanan). Semua dapat direproduksi dari repositori; uji SQL tidak mengubah data (ROLLBACK).

Tidak ada kunci, sandi, token, OTP, KTP, atau rekening di dalam bukti.

## 6. Yang masih harus dibuat sebelum `NATIONAL LISTING READY` (pemilik & tim)

1. **Erza** — login dashboard Supabase: Leaked Password Protection ON; unggah service account Firebase (`FCM_SERVICE_ACCOUNT`) + `admin_set_push_config`; verifikasi paket backup/PITR.
2. **Erza** — login Midtrans (sandbox & production): pasang kunci di Panel Admin → Payment Gateway, set Notification URL, lalu QA menjalankan PAY-05 & E2E-03 lewat HTTP nyata; verifikasi bisnis Midtrans untuk production.
3. **Erza + 2 tester** — sesi eksplorasi di HP (LOC-04, PERF-01, CALL-01 panggilan nyata di jaringan seluler), lalu Play *pre-launch report* setelah AAB masuk Internal Testing.
4. **Engineering** — uji beban RPC `create_order` & webhook (PERF-02), aksesibilitas dasar (PERF-03), latihan restore backup (SEC-04), latihan insiden + status page (SEC-06), dokumentasi daftar fungsi anon yang disengaja (SEC-07).
5. **Counsel** — PSE Komdigi, UU PDP, pajak, kontrak mitra, keselamatan (§9 butir 8) — di luar QA.
6. **Vendor pentest** — jalur kritis (SEC-05).

---
*Keterbatasan data: uji dijalankan pada snapshot 12 Sep 2026 08:50–10:10 UTC; hasil uji server berlaku untuk skema/migrasi hingga 0084; belum ada pengukuran SLO nyata karena belum ada lalu lintas produksi; skenario "mitra offline saat mengantar" (E2E-06) baru tercakup lewat pembatalan admin, belum lewat simulasi kehilangan sinyal di lapangan.*
