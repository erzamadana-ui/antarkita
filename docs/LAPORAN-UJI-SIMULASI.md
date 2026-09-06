# Laporan Uji & Simulasi AntarKita — diperbarui 6 September 2026

Ruang lingkup: 3 aplikasi (Pelanggan, Mitra, Admin/Portal Eksekutif) pada commit Tahap 8 (`3fb2ced` + perbaikan uji). Metode: (1) simulasi transaksi ujung-ke-ujung langsung di basis data produksi Supabase memakai akun demo, dijalankan dalam satu transaksi lalu **di-rollback** (data live tidak berubah); (2) sweep semua rute UI ketiga aplikasi dengan Playwright (mock API) + alur interaksi (keranjang, pesan, login PIN); (3) simulasi GitHub Pages kondisi logout; (4) pemeriksaan statis target navigasi vs rute tiap aplikasi.

## 1. Perbaikan bug yang dilaporkan
| # | Laporan | Akar masalah | Perbaikan |
|---|---|---|---|
| 1 | Tombol notifikasi force close di APK Pelanggan | Kotak masuk merender string kosong di luar `<Text>` (`{n.body && …}`, `{n.image_url && …}`) → di Android release ini melempar error render dan aplikasi tertutup | Semua kondisi render string/angka di seluruh aplikasi diubah ke boolean (`!!x && …` / ternary); ditambah **ErrorBoundary global** di RootLayout: bila ada layar gagal, tampil halaman "Ada yang tidak beres" + tombol kembali ke beranda, bukan force close |
| 2 | APK Mitra menampilkan tampilan Pelanggan | Workflow Android hanya mengatur `APP=mitra` di langkah `expo prebuild`; langkah Gradle (yang membundel JavaScript) tidak mendapat env → bundle JS memakai rute Pelanggan | Env `APP`/`EXPO_PUBLIC_APP` ditambahkan di langkah Gradle; `src/lib/app.ts` juga membaca `extra.app` dari app config hasil prebuild sebagai cadangan. APK build berikutnya (setelah `379b20b`) memuat bundle Mitra |

## 2. Simulasi transaksi (22 skenario, semua LOLOS)
| Skenario | Peran | Hasil | Angka kunci (dari simulasi) |
|---|---|---|---|
| S0 Top up manual → admin setujui | Pelanggan, Admin | OK | Saldo uji +Rp2.000.000 |
| S1 AntarRide motor (AntarPay) | Pelanggan → Driver | OK | Total Rp9.000; PIN salah ditolak, PIN benar diterima; driver +Rp6.400; rating & tip Rp5.000 |
| S2 AntarCar tunai kelas Hemat | Pelanggan → Driver mobil | OK | Total Rp22.500; potongan platform dari saldo driver Rp7.700 |
| S3 AntarFood (AntarPay + promo ANTARBARU) | Pelanggan → Merchant → Driver | OK | Subtotal Rp60.000, diskon Rp10.000, merchant +Rp51.000 (komisi 15%) |
| S4 AntarSend dalam kota + biaya parkir | Pelanggan ↔ Driver | OK | Total Rp13.000 termasuk extra Rp3.000 yang disetujui pelanggan |
| S5 AntarSend antar kota Padang→Bukittinggi | Pelanggan | OK | Ongkir kota Rp15.500 + antar kota Rp27.000; drop ke Gudang Besar Padang |
| S6 AntarBox 2 helper → batal | Pelanggan | OK | Rp172.000 dipotong lalu **refund penuh** saat batal |
| S7 AntarShop Indomaret (AntarPay) | Pelanggan → Driver | OK | Anggaran Rp163.900 → nota riil Rp149.000; jasa belanja Rp7.450; pelanggan bayar Rp167.450; driver +Rp162.215 (penggantian belanja + jasa) |
| S8 AntarMarket + pedagang pasar + koefisien | Pelanggan, Pedagang, Admin, Driver | OK | Barang pedagang masuk daftar dengan harga pedagang; harga 2× acuan **ditolak**; harga 1,35× tanpa nota **ditolak**; dengan nota diterima + 1 flag anti-fraud; total Rp75.000 |
| S9 Driver batal 3× dalam 24 jam | Driver, Admin | OK | Driver **ditangguhkan otomatis** (flag high); admin "Abaikan & pulihkan" → aktif lagi |
| S10 AntarTravel kursi bersama | Mitra travel, Pelanggan | OK | Jadwal dibuat, 2 kursi dipesan (Rp305.000), manifest 1, berangkat → tiba, rating |
| S11 AntarTravel carter (permintaan → tawaran → terima → selesai) | Pelanggan, Mitra | OK | Tawaran Rp500.000 diterima, saldo dipotong, selesai, rating |
| S12 Dompet: pencairan otomatis & manual + PIN admin | Driver, Admin | OK | Saat ada flag fraud terbuka → manual; setelah flag ditutup → **otomatis**; review manual ditolak saat panel terkunci (`ADMIN_LOCKED`), diterima setelah PIN; rekening jadi terverifikasi |
| S13 Tiket CS & SOS | Pelanggan, Admin | OK | Tiket dibalas, diselesaikan, ditutup rating 5; SOS ditangani |
| S14 Pesanan terjadwal | Pelanggan | OK | Status `scheduled`, tidak dirilis sebelum waktunya |
| S15 Admin: dashboard, tren, blast promo, kelas driver, gateway, otomasi, eksekutif | Admin | OK | 3 rekomendasi eksekutif dihasilkan |
| S16 Harga dinamis permintaan | Sistem | OK | 2 order mencari, 0 driver online → tarif Rp9.000 → Rp11.500 (1,25×) |
| S17 Fallback kelas kendaraan | Driver | OK | Order kelas Standar berumur >3 menit bisa diambil driver Hemat |
| S18 Batas jarak layanan (Tahap 8) | Pelanggan | OK | Motor 2,8 km OK; motor Pekanbaru→Padang 262 km **ditolak** ("gunakan AntarTravel"); motor 27,7 km satu kota ditolak (>25 km); Food 20 km ditolak (>15 km); Send antar kota tetap lewat gudang |
| S19 Sakelar layanan admin | Admin, Pelanggan | OK | Shop dimatikan → `app_public_settings` false → order Shop ditolak "dinonaktifkan sementara" → dinyalakan → OK; non-admin ditolak |
| S20 Impor tempat dari peta (OSM) | Pelanggan | OK | 3 toko masuk (`catalog_source=osm`), impor ulang osm_id sama → 3 dilewati, toko 30 m dari toko lama bernama mirip → dilewati; 1 pasar masuk; jenis tak dikenal ditolak |
| S21 Pendaftaran driver v2 (katalog kendaraan) | Pelanggan→Driver | OK | Motor+diesel ditolak; merek kosong ditolak; "solar" ditolak; Honda BeAT bensin → `motor_standard`, is_electric=false; Gesits G1 listrik → `motor_ev`, is_electric=true |
| Hapus akun (0023) | Pelanggan, Admin | OK | Ditolak saat saldo Rp767.550; setelah saldo 0 & tanpa order aktif → profil dianonimkan, is_active=false, login diblokir, tercatat di security_events; admin melihat daftar & finalisasi (email auth diganti tombstone) |

**Bug nyata #2 (uji 6 Sep) & sudah diperbaiki (migrasi 0022)**: pendaftaran driver dengan dokumen lengkap (skor auto-verifikasi ≥ 80) **selalu gagal** dengan "Tidak boleh mengubah role/status akun" — trigger auto-verifikasi mematikan `antaraja.bypass` di tengah `register_driver`. Pendaftaran tanpa dokumen lengkap tidak terdampak, sehingga tidak terlihat sebelumnya. Perbaikan: trigger memulihkan nilai bypass; role diubah sebelum dokumen disimpan.

**Bug nyata #3 (uji unggah data) & sudah diperbaiki (0024)**: pelanggan tidak bisa membuka foto nota belanja yang diunggah driver (bucket privat `proofs` hanya bisa dibaca pengunggah/admin) dan pemilik tiket tidak bisa membuka lampiran balasan admin. Ditambah kebijakan baca bersama + tombol "Lihat foto nota dari driver" di detail pesanan.

**Bug nyata #1**: order AntarRide/AntarCar dengan kelas **Standar** (default di UI) tidak pernah bisa diambil driver kelas **Hemat** → pelanggan bisa menunggu selamanya bila hanya driver Hemat yang online. Perbaikan: (a) setelah 3 menit mencari (pengaturan `class_fallback_minutes`), driver kelas di bawahnya boleh mengambil; (b) UI memilih kelas default yang **ada drivernya** di sekitar.

## 3. Sweep UI per aplikasi (mock API)
Sweep diulang 6 Sep setelah Tahap 8: Pelanggan 25 rute (usulan tempat dihapus, edit profil ditambah) 0 error; Mitra 18 rute 0 error (formulir driver bertahap: tipe → merek → model → bahan bakar); Admin 25 rute (+ Mitra Travel, Data Tempat, Pengaturan sakelar layanan/batas jarak) — 2 error tetap artefak mock.
### Pelanggan (26 rute, 0 error)
Beranda, Sambutan/Login/Daftar, AntarFood (daftar, detail merchant, checkout), AntarRide/AntarCar, AntarSend, AntarBox, AntarShop (toko, katalog, keranjang, usulan toko), AntarMarket (pasar, bahan, pedagang terverifikasi, usulan pasar), AntarTravel (kursi/carter/sopir harian, detail booking, detail permintaan), Pesanan & detail & chat & telepon, AntarPay (metode, top up, gateway, tarik), Akun (edit, alamat, bahasa), Kotak masuk, Bantuan (tiket), Pusat keamanan/SOS, bagikan perjalanan, pilih titik peta, usulan tempat. Alur keranjang Shop (2×Rp74.500 = Rp170.200) dan Market (Rp101.200 → layar pelacakan) lolos.
### Mitra (18 rute, 0 error)
Onboarding jenis mitra (driver, box, travel, merchant, **pedagang pasar**), daftar driver/merchant/travel/pedagang, Driver (beranda order, riwayat, pendapatan, akun, detail order, travel mitra), Merchant (pesanan, menu, toko, dokumen), Pedagang (lapak, barang, akun), kotak masuk, dompet, bantuan, keamanan. Tidak ada lagi tautan/fitur pelanggan.
### Admin (24 rute; 2 error = artefak mock, bukan bug)
Dashboard, Pesanan, Driver, Merchant, Pengguna (masking data pribadi, ekspor), Keuangan (top up/penarikan, rekening terverifikasi), Tarif & Promo, Intelijen Harga, Blast Promo, Logistik & Travel, AntarShop Toko, AntarMarket Pasar, **Usulan Data**, **Mitra Pasar**, Payment Gateway, CS & Tiket, Log Aktivitas, Pengaturan, **Otomasi**, **Pusat Keamanan** (PIN, flag fraud, log), Portal Eksekutif (KPI, keuangan, P&L, rekomendasi, laporan otomatis). Gerbang PIN & penolakan akun non-admin diuji.
### Kondisi logout (simulasi GitHub Pages)
6 URL langsung (`/admin/`, `/admin/users`, `/mitra/`, `/mitra/earnings`, `/`, `/food`) semuanya diarahkan ke layar sambutan aplikasi yang tepat — tidak ada lagi "Unmatched Route".

## 4. Temuan lain & status
| Temuan | Status |
|---|---|
| Sidebar admin tidak bisa scroll | Diperbaiki (ScrollView) |
| Text/angka kosong dirender di luar `<Text>` (29 lokasi) | Diperbaiki global |
| `Unmatched Route` panel admin saat logout | Diperbaiki (rute welcome + penjaga global) |
| Email laporan terjadwal | Belum (hanya in-app; perlu Edge Function + SMTP/Resend) |
| Midtrans Snap | Belum diuji nyata (belum ada kunci; mode simulasi berjalan) — dijadwalkan Senin, lihat `docs/RENCANA-LISTING-LIVE.md` |
| Unggah berkas (5 bucket: avatars, documents, merchant-images, promo-images, proofs) | Diuji: batas 5–10 MB, hanya JPEG/PNG/WebP(/PDF), tulis hanya ke folder uid sendiri, baca privat pemilik/admin + akses bersama (0024) |
| Lupa kata sandi / ganti kata sandi (verifikasi email) | Dibuat 6 Sep: 19 pemeriksaan UI lolos + uji email nyata — rincian `docs/LUPA-KATA-SANDI.md` |
| Uji login nyata di browser oleh AI | Tidak dilakukan (kebijakan kredensial) — mohon uji dari HP |

## 5. Cara mengulang simulasi
Jalankan `supabase/tests/simulasi_e2e.sql` di SQL Editor Supabase (sebagai postgres). Skrip berakhir dengan `RAISE EXCEPTION 'SIMULASI_SELESAI …'` yang berisi log 22 skenario dan otomatis membatalkan semua perubahan.

*Keterbatasan data: angka tarif/komisi mengikuti pengaturan saat ini di `app_settings`/`pricing`; harga pasar adalah acuan perkiraan; uji UI memakai data mock, bukan akun nyata.*

## 6. Perbaikan 6 September (sesi lanjutan)
| Temuan | Akar masalah | Perbaikan | Bukti |
|---|---|---|---|
| Halaman **Notifikasi** force close: "cannot add `postgres_changes` callbacks for realtime:notif:… after `subscribe()`" | Dua tempat memakai topik realtime yang **sama** (`notif:<uid>` — lonceng di beranda & layar kotak masuk). supabase-js memakai ulang objek channel bertopik sama, sehingga `.on()` kedua dipanggil setelah channel ter-`subscribe()` → melempar error saat render | Helper `realtimeChannel()` membuat topik unik per pemanggil; dipakai di semua langganan `postgres_changes` (notifikasi, pesanan, chat, travel, tiket, admin). Broadcast panggilan (`lib/call.ts`) sengaja tetap memakai topik sama | Reproduksi & verifikasi dengan supabase-js v2.114: topik sama → error yang sama persis; topik unik → 2 channel, tanpa error |
| Kartu "Anda dilindungi" (Pusat Keamanan) — judul & teks terjepit oleh tombol SOS di layar 360 px | Ikon + teks + tombol SOS dipaksa satu baris | Tombol SOS dipindah ke bawah selebar kartu | Tangkapan layar 360×760 |
| Tombol "Chat CS online" membungkus 2 baris di dalam pil | Judul tombol boleh membungkus | Judul tombol selalu 1 baris (`numberOfLines`), label diringkas jadi "Chat CS" | idem |
| Pil AntarTravel ("Kursi ber…", "Carter pr…", "Sopir har…") terpotong | Label terlalu panjang; `adjustsFontSizeToFit` tidak bekerja di web | Label diringkas: Kursi / Carter / Sopir | idem |
| Label tab "Pendap…" di aplikasi Mitra terpotong | Ukuran huruf tetap | Ukuran huruf label tab mengikuti lebar tab & panjang teks | idem |
| Sub-judul menu Akun terpotong ("…pemegang sa…") | `numberOfLines={1}` | Menjadi 2 baris | idem |
| Sisa merek lama "Antar Aja" di data (nama aplikasi, rekening bank, gudang) | Data awal sebelum rebrand | Diperbarui ke "AntarKita" / "PT AntarKita Indonesia" di `app_settings` & `warehouses` | Query verifikasi 0 baris tersisa |

Sweep ulang setelah perbaikan: Pelanggan 25 rute, Mitra 18 rute, Admin 21 rute — 0 error; uji alur lupa kata sandi 19/19 lolos.

## 7. Tahap 9 (6–7 September 2026) — dispatch dinamis, panel admin baru, laporan keuangan
Pembagian kerja: Backend #1 (dispatch, migrasi 0025), Backend #2 (analitik & admin, 0026), Front-End Pelanggan, Front-End Mitra, Designer (panel admin + eksekutif), QC (simulasi 0027 + sweep UI).

| Permintaan komisaris | Hasil |
|---|---|
| 1. Batas jarak terima order dinamis dari panel admin | `app_settings.pickup_radius_km` per layanan (motor 5, mobil 8, food 5, send 6, shop/market 5, box 15 km) + fallback `default`; dipakai `driver_available_orders`; diubah dari Admin → Pengaturan tanpa rilis ulang |
| 2. Layar hiburan & permohonan maaf bila menunggu > 5 menit | Komponen `WaitApology` (ambang `wait_apology_minutes`, timer mm:ss, "tahukah kamu" berotasi, tombol Tetap tunggu / Ubah layanan / Batalkan) |
| 3. Tombol Tolak di aplikasi Mitra | `driver_reject_order` + tabel `order_rejections`; order yang ditolak hilang dari feed driver itu saja |
| 4. Prioritas order menurut rating | `priority_tiers` (4,8 → 0 dtk; 4,5 → 20 dtk; 4,0 → 45 dtk; sisanya 75 dtk; mitra baru dianggap 4,6) + kartu "Prioritas Anda" di beranda driver |
| 5. Matriks layanan per kendaraan + batas berat/dimensi | `driver_can_take` v4 & `send_required_vehicle`; motor: ride/food/send ≤ 20 kg & 60 cm; mobil: car/food/send ≤ 150 kg & 160 cm; box/pickup: AntarBox & paket besar |
| 6. AntarSend mobil: driver mobil boleh angkut barang & penumpang dalam kota | Termasuk dalam matriks di atas (mobil mengambil `send` dalam kota dan `ride_car`) |
| 7. AntarSend luar kota lewat mitra travel | Kolom `orders.travel_partner_id` + `travel_send_available/accept/pickup/complete`, batas travel 30 kg & 120 cm, bagi hasil `travel_send_partner_pct` 80% |
| 8. Menu gudang jadi dropdown | Komponen `Dropdown` baru; gudang asal & tujuan memakai dropdown (nama, alamat, jam buka, jarak) |
| Admin 1–2. Tampilan & pengelompokan menu | Sistem desain admin baru (`adminTone/adminFont/adminSpace`, StatCard, DataTable, Panel, Toolbar) + sidebar 6 kelompok |
| Admin 3. Hapus mitra dengan PIN + alasan | `admin_delete_partner` (PIN wajib, alasan ≥ 10 huruf, tolak bila ada order aktif/saldo ≠ 0) + dialog di 5 halaman |
| Admin 4. Telepon & chat ke pelanggan/mitra | `admin_contact_thread` (chat lewat tiket CS) + panggilan WebRTC lewat modul yang ada; bilah status panggilan di layout admin |
| Admin 5. Laporan keuangan cascade | Halaman "Laporan Keuangan": `admin_finance_cascade` (per layanan/kota → drill-down → daftar order) + `admin_order_split` per order, ekspor CSV |
| Eksekutif: font, Revenue/COGS/Margin | Portal Eksekutif ditata ulang + bagian Laba Rugi (P&L) per bulan & per layanan dari `exec_report().pnl` |

**Uji**: simulasi transaksi diperluas jadi **31 skenario (S0–S30)**, semuanya LOLOS di dalam transaksi yang di-rollback (data live tidak berubah — dibuktikan dengan hitungan sesudah uji). Sweep UI: Pelanggan 25 rute, Mitra 18 rute, Admin 23 rute, 0 error; alur lupa kata sandi 19/19 lolos; sapuan lebar 360 px untuk proporsi teks/bentuk.

**Bug nyata yang ditemukan uji & diperbaiki**: `admin_delete_partner` belum menghitung titipan AntarSend antar kota sebagai pekerjaan aktif → mitra travel yang sedang membawa paket bisa dihapus (migrasi `0027_perbaikan_uji_tahap9.sql`).
