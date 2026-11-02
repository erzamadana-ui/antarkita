# Kebijakan Harga AntarKita — keputusan GM 8 (31 Okt 2026), implementasi migrasi 0124

Prinsip GM: **kompetitif terhadap pasar, tetapi kesejahteraan driver/mitra dan keberlanjutan aplikasi didahulukan — tidak membakar promo.**
Dokumen ini menerjemahkan prinsip itu ke angka yang ditegakkan basis data (`pricing_policy_check()`, `admin_pricing_policy()`) dan menandai mana fakta kode, mana asumsi.

## 1. Aturan yang ditegakkan (setelan `app_settings`, Panel Admin › Pengaturan)

| Setelan | Nilai awal | Arti | Status |
|---|---|---|---|
| `driver_min_share_pct` | 80 | Porsi driver/mitra dari tarif layanan minimal 80 % (ride/send/food/shop/market/box: 100 − `driver_commission_pct`; travel: 100 − `merchant_fee_pct` dan tiap rate card) | keputusan GM |
| `promo_budget_pct_max` | 5 | Promo yang ditanggung platform (`promo_platform` di buku besar) maks 5 % pendapatan platform bulan berjalan | keputusan GM, angka [ASUMSI] |
| `promo_default_funded_by` | `platform` | Penanggung promo default; baris `service_economics` yang berbeda ditandai *info* | keputusan GM |
| `fare_floor_per_km_<layanan>` | motor 2.000 · mobil 3.500 · send/food/shop/market 2.000 · box 5.000 · travel 3.000 (Rp/km bersih untuk driver) | Tarif/km × porsi driver tidak boleh di bawah floor | [ASUMSI] — kalibrasi GM |
| `commission_cap_two_wheel` (lama, 0031) | 8 | Batas regulasi komisi roda dua | fakta sumber |

`pricing_policy_check()` mengembalikan satu baris JSON per pelanggaran `{service, rule, severity, value, limit, message}` dengan `rule` ∈ `driver_share_min` · `two_wheel_cap` · `fare_floor_per_km` · `promo_budget` · `promo_funded_by` (info). Kosong = patuh. `admin_set_travel_rate_card` menolak kartu dengan porsi mitra < `driver_min_share_pct`. `admin_set_service_economics` **tidak** diubah (milik 0126/agen lain) — pelanggaran komisi di sana terdeteksi lewat pemeriksaan, bukan ditolak; disarankan 0126 menambah guard yang sama.

## 2. Tarif ride saat ini vs acuan pasar Pekanbaru

Sumber angka internal: tabel `pricing` + `service_economics` (DB lokal 31 Okt 2026). Acuan pasar **[ASUMSI, belum diverifikasi lapangan]**: Gojek/Grab motor ±Rp2.500–3.000/km, minimum Rp10–12 rb; mobil ±Rp4.500–6.000/km, minimum Rp15–20 rb.

| Layanan | Tarif pelanggan | Minimum pelanggan (+biaya platform) | Komisi | Bersih driver/km | Floor | Posisi vs pasar |
|---|---|---|---|---|---|---|
| ride_motor | Rp2.300/km | Rp9.000 + Rp1.000 = Rp10.000 | 8 % (cap regulasi) | Rp2.116 | Rp2.000 ✓ | 8–23 % di bawah pasar; driver menerima ≈ setara driver Gojek (±Rp2.000–2.400/km setelah komisi 20 %) |
| ride_car | Rp4.500/km | Rp12.000 + Rp4.000 = Rp16.000 | 15 % | Rp3.825 | Rp3.500 ✓ | batas bawah pasar; margin platform mobil terbesar |
| send/food | Rp2.300/km | Rp9.000 + Rp3.000 / Rp2.000 | 0 % (ongkir hak driver) | Rp2.300 | Rp2.000 ✓ | pendapatan platform hanya biaya tetap + fee merchant 15 % |
| box | Rp6.000/km, dasar Rp30.000 | Rp50.000 + Rp2.000 | 10 % | Rp5.400 | Rp5.000 ✓ | — |
| travel (rate card) | Rp3.500–12.000/km per mobil | Rp150.000/mobil | 10 % | ≥ Rp3.150 | Rp3.000 ✓ | lihat §3 |

Kesimpulan jujur: **tidak ada pelanggaran pada konfigurasi awal** (`pricing_policy_check()` kosong), tetapi tarif motor kita di bawah pasar sementara komisi motor sudah di cap 8 % → ruang promo motor praktis nol. Yang akan rusak duluan bila promo dipaksa: margin motor (pendapatan platform motor = Rp1.000/order + 8 %), bukan driver. Jalan yang konsisten dengan prinsip GM: naikkan tarif motor ke Rp2.500/km (masih kompetitif) sebelum ada promo apa pun — **usulan AI, bukan keputusan GM**.

## 3. AntarTravel — rate card per km (keputusan GM 7)

Rumus (`travel_quote`): `fare_mobil = max(min_fare, base_fare + ceil(km) × per_km)` dibulatkan ke atas Rp1.000 · carter = fare_mobil × `charter_multiplier` · per kursi = fare_mobil ÷ kursi × (1 + `travel_shared_markup_pct` 15 %) · komisi = `platform_fee_pct` × tarif (dibatasi agar porsi mitra ≥ `driver_share_pct`) · biaya platform pelanggan `platform_fee_flat` Rp5.000 · PPN 11 % inklusif di dalam (komisi + biaya platform) · **diterima mitra = tarif − komisi (90 %)**.

Jarak: `travel_routes.distance_km` bila rute aktif ada (`travel_distance_source = route_first`), selain itu haversine pusat kota × `travel_road_factor` 1,25. Alasan [ASUMSI]: Pekanbaru–Padang haversine 202 km × 1,25 = 253 km, padahal jalan 355 km (koridor Bukit Barisan) — faktor 1,25 memangkas pendapatan mitra 29 % di koridor utama kita.

Seed rate card **[ASUMSI — wajib kalibrasi GM lewat `admin_set_travel_rate_card`]**:

| Model | Kursi | Rp/km | PKU→PDG 355 km: carter | per kursi | Seed rute lama (acuan pasar) |
|---|---|---|---|---|---|
| Avanza/Xenia | 7 | 3.500 | Rp1.268.000 | Rp209.000 | kursi Rp150.000 · carter Rp950.000 |
| Innova Reborn | 7 | 4.500 | Rp1.623.000 | Rp267.000 | " |
| Hiace Commuter | 14 | 6.500 | Rp2.333.000 | Rp192.000 | carter besar Rp2.300.000 |
| Hiace Premio | 11 | 8.000 | Rp2.865.000 | Rp300.000 | — |
| Alphard | 6 | 12.000 | Rp4.285.000 | Rp822.000 | — |

Pembacaan realistis: quote Hiace per kursi (Rp192 rb) 28 % di atas harga rute seed (Rp150 rb) dan carter Innova (Rp1,62 jt) 71 % di atas seed (Rp950 rb). Harga rute seed sendiri belum tentu pasar; survei cepat agen travel Pekanbaru–Padang biasanya Rp170–220 rb/kursi dan carter Innova Rp1,5–2 jt [ASUMSI]. Bila GM memilih kompetitif-agresif: turunkan `per_km` Avanza 3.000 / Innova 3.800 / Hiace 5.500 — mitra tetap 90 %. Mitra boleh menyimpang ±10 % dari quote saat membuka jadwal; tawaran carter di bawah 90 % quote ditolak agar tidak terjadi perang harga ke bawah yang memakan mitra.

## 4. Promo tanpa bakar uang — mekanisme
- Semua promo default ditanggung platform (`promo_default_funded_by`), dicatat di buku besar sebagai `promo_platform`; `pricing_policy_check` menyalakan `promo_budget` saat realisasi bulan berjalan > 5 % pendapatan platform. Pemeriksaan ini **pasif** (panel admin), belum menolak pembuatan promo baru — usulan: 0126/agen promo menambah guard di `admin_set_promo`.
- Promo tidak boleh menurunkan porsi driver: diskon dipotong dari pendapatan platform (pola `ledger_calc` 0099/0114), bukan dari `driver_payable`.

## 5. Cara pakai (admin)
1. `select * from admin_pricing_policy();` → ringkasan setelan, tabel per layanan (porsi driver, bersih/km, floor), rate card travel, realisasi promo bulan ini, daftar pelanggaran, `ok`.
2. `select * from pricing_policy_check();` → hanya pelanggaran.
3. Ubah ambang: `admin_set_settings('{"driver_min_share_pct": 85}')` (izin `pricing`/`promo` + PIN).
4. Rate card: `admin_set_travel_rate_card('{"vehicle_model":"Innova Reborn","per_km":3800}')`; kartu baru wajib `vehicle_model, seats, per_km` (+ `match_regex` agar `travel_partners.vehicle_model` terpetakan; atau patok per mitra lewat `travel_partners.rate_card_id`).

---
*Keterbatasan data: angka pasar Pekanbaru (Gojek/Grab, agen travel) adalah asumsi 31 Okt 2026 tanpa survei; realisasi promo & pendapatan dibaca dari `order_ledger` yang di DB lokal masih kosong; rate card travel belum dikalibrasi GM. Semua angka Rp dari DB lokal (seed) per 31 Okt 2026, migrasi 0124.*
