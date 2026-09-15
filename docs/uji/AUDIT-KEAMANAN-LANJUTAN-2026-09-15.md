# Audit Keamanan Lanjutan AntarKita — 15 September 2026

Pemesan: Dewan Komisaris — pertanyaan: *"Apakah cukup hanya dengan Supabase, dan apakah database sudah aman?"*
Penyusun: Direktur IT (Keamanan). Proyek: Supabase produksi `qwltshvzrsykxdvhbxcv` (plan Free).
Sifat: **HANYA BACA** — tidak ada perubahan yang diterapkan pada produksi. Semua uji tembus dijalankan
dalam blok `do $$ … $$` yang diakhiri `raise exception` sehingga seluruhnya **ROLLBACK**.
Lanjutan dari `UJI-KEAMANAN-2026-09-12.md` (migrasi pengerasan 0086 sudah aktif).

---

## 1. Ringkasan eksekutif

Basis data **aman terhadap serangan aplikasi** (IDOR, kebocoran data antar-pengguna, eskalasi peran,
akses storage): 12 aksi tembus baru → **0 lolos**. Lapisan yang **belum** tertutup bukan soal RLS/RPC,
melainkan soal **arsitektur di luar database** (WAF/DDoS, rate-limit anon, backup PITR, 2FA dashboard,
pentest independen) dan **kepatuhan UU PDP** (minimalisasi data kontak). Karena itu jawabannya: Supabase
sudah menutup mayoritas risiko database, **tetapi belum cukup sendirian** untuk skala nasional.

| Tingkat | Temuan baru | Bisa ditutup SQL (draf 0087) | Butuh dashboard/Pro | Butuh Dirut/pihak ketiga |
|---|---:|---:|---:|---:|
| Sedang | 2 (L1, L2) | 1 sebagian (L2) | 1 (L2-anon) | 1 (L1 PDP) |
| Rendah | 2 (L3, L4) | 1 (L3) | 1 (L4) | — |
| Info/Perf | 3 (L5, L6, L7) | 1 (L7 indeks) | — | L5 diterima |

---

## 2. Advisor Supabase (15 Sep 2026)

### Security Advisor
| Lint | Level | Jumlah | Status vs 12 Sep | Bisa diperbaiki? |
|---|---|---:|---|---|
| `authenticated_security_definer_function_executable` | WARN | 199 | Tetap (by design) | Tidak — ini memang API RPC; tiap fungsi punya cek `auth.uid()`/`is_admin()` di dalam |
| `anon_security_definer_function_executable` | WARN | 19 | Tetap (by design) | Sebagian — fungsi lookup publik (calc_fare, city_gate, estimate_fare, resolve_address, app_public_settings). Lihat L2 |
| `rls_enabled_no_policy` | INFO | 11 | Tetap | Tidak perlu — tabel rahasia/sistem (gateway_secrets, map_secrets, turn_secrets, push_config, lookup_rate, exec_sessions, dst.) sengaja tanpa policy = 0 baris untuk anon/authenticated |
| `extension_in_public` (postgis, pg_trgm) | WARN | 2 | Tetap (T15) | **Tidak** — grant milik `supabase_admin`; memindah skema berisiko merusak geo |
| `rls_disabled_in_public` (spatial_ref_sys) | ERROR | 1 | Tetap (T15) | **Tidak** — tabel referensi PostGIS milik `supabase_admin`; sudah dicabut baca anon di 0086 (K8); data publik, tanpa PII |
| `auth_leaked_password_protection` | WARN | 1 | Tetap (T14) | **Tidak di Free** — fitur plan Pro (L4) |

**Catatan penting (e):** kueri `pg_proc.proconfig` membuktikan **seluruh fungsi aplikasi SECURITY DEFINER
sudah mengunci `search_path='public'`**. Satu-satunya yang tidak terkunci adalah 3 varian
`st_estimatedextent` bawaan PostGIS (milik supabase_admin) — tidak bisa dan tidak perlu diubah.

### Performance Advisor (ringkas)
| Lint | Level | Jumlah | Catatan |
|---|---|---:|---|
| `auth_rls_initplan` | WARN | 55 | `auth.uid()`/`current_setting()` dievaluasi per baris di policy — bungkus `(select auth.uid())`. Perf, bukan keamanan |
| `unused_index` | INFO | 63 | Indeks belum terpakai (basis data masih muda) — jangan buru-buru drop |
| `multiple_permissive_policies` | WARN | 14 | Policy admin + policy umum tumpang tindih untuk SELECT — kosmetik/perf |
| `unindexed_foreign_keys` | INFO | 7 | FK tanpa indeks penutup (L7) — aman ditambah lewat SQL |

---

## 3. Uji tembus baru (belum ada di laporan 12 Sep) — semua ROLLBACK

### Temuan
| # | Area | Temuan | Tingkat | Bukti (uji live, rollback) | Rekomendasi | PIC |
|---|---|---|---|---|---|---|
| **L1** | Privasi / UU PDP | `profiles_select` mengizinkan lawan transaksi membaca **seluruh baris** profil termasuk **phone & email**. Bukan bug teknis, tetapi pelanggaran prinsip minimalisasi data UU PDP No.27/2022 | **Sedang** | Sbg pelanggan `…0002`: `phone` driver lawan transaksi **TERLIHAT** (`+628117201026`). Non-lawan-transaksi = 0 baris (benar) | Samarkan kontak; sediakan panggilan/pesan **dalam aplikasi** (masking) via RPC; batasi kolom phone/email pada policy. **Mengubah alur CS/driver → perlu keputusan produk** | Dirut + Produk |
| **L2** | Rate limiting | `resolve_address` & `estimate_fare` **anon-callable tanpa** `rate_take`; fungsi `rate_take()` **mengembalikan TRUE saat `auth.uid()` null** → anon tidak dibatasi sama sekali | **Sedang** | Sbg `anon`: `resolve_address` **BISA** dipanggil; `0 dari 4` fungsi lookup (resolve_address, estimate_fare, calc_fare, city_gate) memakai `rate_take` | (SQL) tambah `rate_take` untuk pengguna login pada kedua fungsi; (Edge/WAF) rate-limit anon per-IP — tidak bisa murni di DB | Claude (SQL) + Dashboard/Cloudflare |
| **L3** | Hardening view | View `public.order_economics` (finansial seluruh order: revenue, komisi, payout) tidak menyetel `security_invoker` → berjalan dgn hak pemilik (bypass RLS) | **Rendah** (laten) | `reloptions=null`; SELECT anon=false, authenticated=false → **belum terekspos**, tetapi grant tak sengaja di masa depan akan membocorkan semua | (SQL) `set (security_invoker=on)` sebagai pertahanan berlapis | Claude (SQL) |
| **L4** | Auth | Leaked Password Protection (HaveIBeenPwned) nonaktif | Rendah | Advisor `auth_leaked_password_protection` | Upgrade plan Pro lalu aktifkan | Dirut |
| **L5** | PostGIS/Ekstensi | postgis & pg_trgm di skema public; `spatial_ref_sys` RLS off; `st_estimatedextent` search_path tak terkunci | Rendah/Info | Advisor + `pg_proc` | **Diterima** — milik `supabase_admin`, tanpa PII | — (diterima) |
| **L6** | Pemantauan | 24 jam terakhir: 6 login gagal "Invalid login credentials" — **semua dari 1 IP** `125.165.111.220` (di antara 6 login sukses) | Info | `query_logs source=auth_logs` | Pola salah-ketik satu pengguna, **bukan brute-force**. Pantau; ambang alarm bila >20/jam/IP | IT |
| **L7** | Performa (bukan keamanan) | 7 FK tanpa indeks; 55 policy `auth_rls_initplan`; 63 indeks tak terpakai; 14 policy permisif ganda | Info | Performance Advisor | (SQL) tambah 7 indeks FK; rewrite `(select auth.uid())` opsional (besar) | Claude (SQL) |

### Yang diuji dan terbukti AMAN (12 aksi → 0 lolos)
- **(a) IDOR RPC** — sbg pelanggan `…0002` terhadap **order/tiket milik orang lain**:
  `add_tip` → *Bukan pesanan Anda*; `rate_order` → *Bukan order Anda*; `respond_extra` → *Bukan pesanan Anda*;
  `request_extra` → *Bukan order Anda*; `ticket_reply` → *Tiket tidak ditemukan*; `cancel_order` → ditolak.
  Semua fungsi memverifikasi `customer_id/driver_id = auth.uid()` sebelum bertindak.
- **(b) Fungsi ber-parameter `p_user`/`p_driver`/`p_merchant`** — audit `pg_proc` + uji live:
  seluruh fungsi yang bisa dieksekusi `authenticated` memeriksa `is_admin()` atau `auth.uid()`.
  `admin_set_merchant_status` (yang di badannya tak memanggil `is_admin` langsung) **mendelegasikan**
  ke `admin_review_merchant` yang memanggil `is_admin()` → uji live sbg non-admin: **"Hanya admin"**.
  Fungsi internal (`wallet_apply`, `push_enqueue`, `auto_verify_*`, `verification_score_*`, `osm_enqueue_core`)
  = EXECUTE dicabut dari anon/authenticated (0086 K6).
- **(c) storage.objects `documents/`** — sbg pelanggan `…0002`, membaca objek `documents/` milik uid lain: **0 baris**
  (policy `documents own`: `foldername[1] = auth.uid() OR is_admin()`). `proofs`, `avatars`, `merchant-images`,
  `promo-images` juga ditinjau — sesuai desain.
- **(d) View/matview public** — hanya `order_economics` (tidak di-grant, lihat L3) + `geography_columns`/`geometry_columns`
  (view sistem PostGIS, tanpa PII). Tidak ada matview bocor.
- **(f) Kolom sensitif profiles** — profil hanya berisi `phone`, `email`, `full_name`, `avatar_url`, `role`
  (**tidak ada** kolom `emergency_contact`). Baca lintas-pengguna non-lawan-transaksi = 0. Risiko tersisa =
  phone/email ke lawan transaksi (L1).
- **(g) Rate limiting** — `create_ticket` **sudah** dibatasi (`rate_take('create_ticket', ticket_per_hour=10)`
  + catat `security_events`). Kelemahan hanya pada lookup anon (L2).
- **(h) Log auth 24 jam** — 6 sukses, 6 gagal (1 IP), 1 logout — tidak ada indikasi serangan (L6).

---

## 4. Penilaian arsitektur — "cukupkah hanya Supabase?"

### Sudah ditutupi Supabase (Postgres + RLS + Auth + Storage + Edge)
- Otorisasi data per-baris (RLS) + RPC SECURITY DEFINER ber-`auth.uid()`/`is_admin()` — terbukti tahan IDOR/eskalasi.
- Autentikasi terkelola (JWT, verifikasi email, kebijakan sandi min. 8 + huruf&angka), lockout PIN portal & admin.
- Storage berpolicy per-pemilik; rahasia gateway/map/TURN tak pernah sampai ke klien.
- Edge Function: `push-send` (service_role/admin), webhook Midtrans (verifikasi SHA-512), TURN kredensial pendek.
- TLS in-transit bawaan; backup harian otomatis (retensi Free terbatas).

### BELUM ditutupi Supabase Free (perlu lapisan/keputusan lain)
- **WAF & DDoS/L7** — tak ada; anon rate-limit lookup (L2) butuh Cloudflare/edge.
- **PITR (point-in-time recovery)** — hanya plan Pro; Free hanya backup harian → RPO buruk saat insiden.
- **2FA/MFA akun Dashboard Supabase** — kunci kerajaan (akses service_role); wajib diaktifkan manual.
- **SSL enforcement & Network/IP restrictions** ke Postgres — pengaturan dashboard (Pro untuk sebagian).
- **Rotasi kunci** (anon/service_role/JWT secret) — prosedur manual belum ada.
- **Pemantauan/alerting** keamanan (ambang login gagal, anomali) — belum otomatis.
- **Kepatuhan UU PDP/PSE Kominfo** — pendaftaran PSE, penunjukan DPO, minimalisasi data (L1), lokasi data.
- **Pentest independen + uji beban** sebelum listing nasional.

### Rekomendasi berjenjang
**(i) Bisa Claude lakukan sekarang lewat SQL — draf `0087_pengerasan_lanjutan.sql` (belum diterapkan):**
1. `order_economics` → `security_invoker=on` (L3).
2. `rate_take` untuk pengguna login pada `resolve_address` & `estimate_fare` (L2, bagian authenticated).
3. 7 indeks penutup FK (L7).
4. (Opsional, dikomentari) RPC kontak lawan-transaksi tersamar untuk L1 — **menunggu keputusan produk**.

**(ii) Butuh Dashboard / upgrade:** aktifkan 2FA akun dashboard (segera, gratis); Leaked Password Protection +
PITR + rate-limit longgar (Pro); SSL enforcement & Network Restrictions; Cloudflare/WAF di depan API & Edge
untuk rate-limit anon dan proteksi DDoS.

**(iii) Butuh pihak ketiga / Dirut:** pentest & uji beban independen; pendaftaran PSE Kominfo + kepatuhan UU PDP
(DPO, DPIA, kebijakan retensi, minimalisasi kontak L1); Custom SMTP untuk email Auth (rekomendasi 12 Sep #1);
prosedur rotasi kunci & respons insiden.

---

## 5. Jawaban untuk komisaris (5 kalimat)
1. Untuk lapisan **database**, ya — Supabase sudah aman: dari 12 upaya tembus baru (IDOR order/tiket/chat/panggilan/
   saldo/tip/rating, tebak path dokumen, fungsi ber-parameter user, akses admin), **tidak ada satu pun yang lolos**,
   melengkapi 40 upaya nihil pada 12 September.
2. Namun **Supabase saja belum cukup** untuk skala nasional: pelindung serangan volumetrik (WAF/DDoS), pembatas laju
   untuk pengunjung anonim, dan pemulihan bencana PITR **berada di luar** yang disediakan plan Free.
3. Ada dua temuan tingkat **Sedang** yang harus ditindaklanjuti: nomor telepon/email pengguna masih terlihat oleh
   lawan transaksinya (isu **UU PDP**, butuh keputusan produk), dan fungsi pencarian alamat/tarif bisa dipanggil
   anonim tanpa pembatas laju (butuh WAF/edge).
4. Perbaikan yang bisa dilakukan segera lewat SQL sudah kami siapkan dalam draf migrasi `0087` (belum diterapkan,
   menunggu persetujuan), sedangkan 2FA akun dashboard dapat diaktifkan hari ini tanpa biaya.
5. Sebelum peluncuran nasional kami merekomendasikan **upgrade plan Pro** (PITR + proteksi sandi bocor), **WAF
   Cloudflare**, **pendaftaran PSE/kepatuhan PDP**, dan **uji penetrasi independen** — keputusan anggaran ini
   berada di tangan Direktur Utama.

---

*Keterbatasan data:* audit dilakukan dari dalam database (peran `anon`/`authenticated` disimulasikan via JWT uji)
dan advisor Supabase; belum mencakup uji jaringan dari perangkat nyata (MITM/pinning), uji beban, maupun
pengujian sisi klien mobile/web. Analisis log auth terbatas jendela 24 jam terakhir yang tersedia di plan Free.
Tidak ada perubahan yang diterapkan; seluruh uji tembus di-ROLLBACK.


## Tindak lanjut direktur utama (15 Sep 2026, 12:10 WIB)
- Migrasi **0087 DITERAPKAN** ke produksi (order_economics security_invoker, rate limit resolve_address 600/jam & estimate_fare 1200/jam untuk pengguna login, 7 indeks FK). L1 (kontak tersamar) tetap menunggu keputusan produk.
- Dashboard Supabase: **Enforce SSL** diaktifkan (restart singkat) dan **Network restrictions = Restrict all access** (koneksi Postgres langsung dari luar diblokir; API/Auth/Storage/Edge tidak terpengaruh).
- Masih di tangan pemilik: 2FA akun dashboard Supabase & GitHub, plan Pro (PITR + HIBP), WAF/rate-limit anon (Cloudflare), SMTP kustom, PSE Kominfo, pentest independen.
