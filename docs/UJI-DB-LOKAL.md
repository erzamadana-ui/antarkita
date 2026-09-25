# Uji basis data LOKAL (PostgreSQL 16, tanpa Supabase)

Harness untuk menjalankan `supabase/migrations`, `supabase/seed.sql`, dan
`supabase/tests/*.sql` pada PostgreSQL 16 + PostGIS 3 lokal — reproducible,
idempoten, dan tidak pernah menyentuh produksi. Lapisan platform Supabase
(GoTrue, Storage, pg_cron, pg_net, realtime) ditiru oleh stub SQL.

```
scripts/db-lokal.sh                     # skrip utama (bash)
scripts/db-lokal/00_supabase_stub.sql   # tiruan objek Supabase (idempoten)
scripts/db-lokal/pra/<berkas>.sql       # fixture yang dijalankan TEPAT SEBELUM migrasi/seed itu (transaksi sama)
scripts/db-lokal/pasca/<berkas>.sql     # fixture yang dijalankan TEPAT SESUDAHNYA (transaksi sama)
scripts/db-lokal/bug-dikenal.txt        # skenario uji yang diketahui gagal & bukan salah harness
```

Prasyarat: `postgresql-16`, `postgresql-16-postgis-3`, `postgresql-client-16`
terpasang; akses root/sudo (hanya untuk menyalakan cluster dan menulis
`pg_hba.conf`). Tidak perlu Supabase CLI, Docker, maupun jaringan.

## Cara pakai

```bash
scripts/db-lokal.sh reset            # drop+create db → stub → 69 migrasi → seed → simulasi_e2e + uji_idempotensi → ringkasan
scripts/db-lokal.sh migrate          # idempoten: stub + hanya migrasi yang belum tercatat di _lokal.migrasi
scripts/db-lokal.sh seed             # seed.sql (menolak bila sudah pernah; `seed --force` untuk memaksa)
scripts/db-lokal.sh test             # = test supabase/tests/simulasi_e2e.sql
scripts/db-lokal.sh test supabase/tests/uji_idempotensi.sql
scripts/db-lokal.sh psql             # psql interaktif (atau: psql -c "select ...")
scripts/db-lokal.sh status
```

Variabel lingkungan (opsional): `DB_NAME=antarkita` `DB_USER=postgres`
`DB_HOST=127.0.0.1` `DB_PORT=5432` `SEED_PASSWORD=UjiLokal123` `PG_VERSION=16`
`PG_CLUSTER=main` `DB_LOKAL_NO_SUDO=1` (server sudah jalan, jangan sentuh cluster).
Log setiap langkah ada di `/tmp/antarkita-db-lokal/` (`DB_LOKAL_LOG_DIR`).

Ringkasan `reset` yang diharapkan (23 Sep 2026, HEAD `81e040c`):

```
migrasi     : 69 diterapkan sekarang, 0 sudah ada, total tercatat 69 dari 69 berkas
seed        : ok (6 akun uji @antaraja.id, sandi: UjiLokal123)
e2e         : simulasi_e2e.sql: LULUS — 228 OK, 0 BUG, 0 GAGAL, 0 LEWAT, 2 BUG DIKENAL (bug-dikenal.txt) (penanda: SIMULASI_SELESAI)
idempotensi : uji_idempotensi.sql: LULUS — 4 OK, 0 BUG, 0 GAGAL, 1 LEWAT
```

Exit code `reset`/`test` = 0 hanya bila tidak ada `BUG`/`[GAGAL]` di luar daftar
`bug-dikenal.txt`. Waktu `reset` penuh ± 20 detik.

## Apa yang dilakukan skrip

1. **Cluster** — `pg_ctlcluster 16 main start`. Bila `main` rusak/tidak ada,
   dibuat cluster segar `16/antarkita` di `/var/lib/postgresql/16/antarkita`
   pada `DB_PORT` (`pg_createcluster … --data-checksums`). Cluster yang
   melayani `DB_PORT` dideteksi ulang lewat `pg_lsclusters` di tiap pemanggilan.
2. **Trust auth** — blok bertanda `# antarkita-lokal` disisipkan di atas
   `pg_hba.conf` (`host all all 127.0.0.1/32 trust`, `::1/128 trust`), lalu
   `reload`. Cadangan: `pg_hba.conf.bak-antarkita`. Hanya untuk mesin uji.
3. **Peran & db** — peran `antarkita` (login, superuser lokal, sandi
   `antarkita`) dan database `antarkita` (owner antarkita, UTF8). Migrasi
   dijalankan sebagai **`postgres`** (bukan antarkita) agar sama dengan
   Supabase: 0003 memakai `alter default privileges FOR ROLE postgres`, dan
   pemilik fungsi/tabel memengaruhi hak `anon`/`authenticated`.
4. **Stub Supabase** (`00_supabase_stub.sql`, satu transaksi, idempoten).
5. **Migrasi** — `supabase/migrations/*.sql` urut nama (`LC_ALL=C sort`), tiap
   berkas `psql -X -v ON_ERROR_STOP=1 -1 -f` (satu transaksi per berkas, seperti
   Supabase CLI). Yang berhasil dicatat di `_lokal.migrasi`; `migrate` berikutnya
   melewatinya. Gagal → berhenti, cuplikan ERROR + path log.
6. **Seed** — `psql -1 -c "set app.seed_password = '…'" [-f pra/seed.sql] -f seed.sql [-f pasca/seed.sql]`.
7. **Uji** — berkas dijalankan tanpa `ON_ERROR_STOP` (blok DO memang diakhiri
   `RAISE` agar rollback). Hasil dibaca dari log: baris `Sxx OK|BUG` (pesan
   `SIMULASI_SELESAI`) dan `[OK]|[GAGAL]|[LEWAT]` (NOTICE). Dicek: setelah e2e,
   `orders` tetap 0 baris — rollback bekerja.

## Stub yang dibutuhkan (hasil grep `auth\.|storage\.|extensions\.|net\.|cron\.|realtime`)

| Objek | Dipakai oleh | Isi stub |
|---|---|---|
| Peran `anon`, `authenticated`, `service_role`, `supabase_admin`, `authenticator`, `supabase_auth_admin`, `supabase_storage_admin` | grant/policy di hampir semua migrasi; 0003 grant ke `supabase_auth_admin` | NOLOGIN; `service_role`/`supabase_admin` BYPASSRLS; `authenticator` anggota peran API |
| Skema `auth` (owner supabase_auth_admin), `storage` (owner supabase_storage_admin), `extensions`, `graphql_public`, `cron`, `net` | — | Kepemilikan skema penting: pemeriksaan FK `auth.identities → auth.users` berjalan sebagai pemilik tabel; tanpa USAGE, seed gagal `permission denied for schema auth` |
| Hak bawaan proyek: `alter default privileges for role postgres in schema public grant all on tables/sequences/functions to anon, authenticated, service_role` | `set local role authenticated` di e2e S31 | Tanpa ini: `permission denied for table order_messages`. 0003 lalu mencabut bagian fungsi (tetap berlaku) |
| Ekstensi `pgcrypto`, `uuid-ossp` di `extensions`; `postgis`, `pg_trgm` di `public` | `extensions.crypt/gen_salt/gen_random_bytes` (0019, 0086, e2e), `crypt()` tanpa prefiks (seed, 0009); 0040 mengecek `public.spatial_ref_sys` | `alter database … set search_path = "$user", public, extensions` (seperti Supabase) |
| `auth.users`, `auth.identities` (kolom GoTrue) | 0001 FK + trigger `handle_new_user`; 0023/0026/0030/0085 `update auth.users set banned_until/email/phone/email_change*/phone_change*`; seed & e2e S35 insert | Termasuk `confirmed_at` generated, `email` generated di identities, unique `(provider_id, provider)` |
| `auth.uid()`, `auth.role()`, `auth.email()`, `auth.jwt()` | 428 pemakaian `auth.uid()`; tests memakai `set_config('request.jwt.claims', …, true)` | Membaca `request.jwt.claim.sub` lalu `request.jwt.claims::jsonb->>'sub'`; NULL bila tidak ada |
| `storage.buckets`, `storage.objects` (RLS) + `storage.foldername/filename/extension` | 0002, 0007 insert bucket + policy; 0024 policy `storage.objects.name` | Sama seperti skema Storage (path_tokens generated) |
| Publication `supabase_realtime` | `alter publication supabase_realtime add table …` (0002, 0006, 0007, 0009, 0011, 0015, 0028) | Dibuat kosong bila belum ada |
| Shim **pg_cron**: `cron.job`, `cron.job_run_details`, `cron.schedule(name,sched,cmd)`, `cron.schedule(sched,cmd)`, `cron.unschedule(bigint|text)` | 0009 (dalam DO+exception), **0019 baris 665–667 `select cron.schedule(...)` di luar DO → wajib ada**, 0019:640 membaca `cron.job`, 0030 | Hanya mencatat baris jadwal; tidak pernah mengeksekusi apa pun (8 job tercatat setelah migrasi) |
| Shim **pg_net**: `net.http_post(url, body, params, headers, timeout_milliseconds)`, `net.http_get` | 0030 `push_dispatch()` mengecek `to_regnamespace('net')` lalu `net.http_post(...)` | Mencatat ke `net._lokal_http_log`, tidak ada HTTP keluar; e2e S36f tetap OK |
| `public.qa_run_script(bigint, text)` (placeholder) | **0086 baris 158** `alter function public.qa_run_script(bigint, text) set search_path …` | Lihat "Workaround" di bawah |
| `_lokal.migrasi` | skrip | pencatat migrasi lokal |

Tidak dipakai (tidak distub): `vault.*`, `realtime.*` (selain publication),
`pgsodium`, `supabase_functions`, `unaccent`.

## Workaround migrasi (harness saja — migrasi tidak diubah)

| Migrasi | Error asli | Penyebab | Workaround |
|---|---|---|---|
| `0086_pengerasan_keamanan.sql:158` | `ERROR:  function public.qa_run_script(bigint, text) does not exist` | Fungsi ada di produksi (dibuat lewat SQL editor, lihat `docs/uji/UJI-KEAMANAN-2026-09-12.md` T10) tapi tidak pernah ditulis di migrasi mana pun | Stub §10 membuat placeholder yang `raise exception` bila dipanggil, hanya agar `ALTER FUNCTION` punya sasaran |
| `0094_rapikan_kota_lama.sql:57` | `ERROR:  0094 batal: kota aktif 2 (harus tetap 4)` `CONTEXT: PL/pgSQL function inline_code_block line 9 at RAISE` | Penjaga 0094 memverifikasi DATA produksi: 4 kota `aktif` (Batam, Dumai, Padang, Pekanbaru). Padang & Pekanbaru dibuka 0079; Batam & Dumai dibuka admin lewat panel (`admin_set_city_status`), bukan migrasi | `pra/0094_rapikan_kota_lama.sql`: membuka Batam & Dumai (`aktif`, semua layanan — [ASUMSI], daftar layanan produksi tidak tercatat di repo) dalam transaksi migrasi 0094 |
| `supabase/seed.sql:50` | `ERROR:  column "license_number" of relation "drivers" does not exist` | Seed masih menulis `drivers.license_number`; `0004_review_fixes.sql` memindahkannya ke `driver_documents` dan menghapus kolomnya. Seed di repo tertinggal dari skema | `pra/seed.sql` menambah kolom sementara; `pasca/seed.sql` memindahkan nilainya ke `driver_documents` lalu menghapus kolom → skema akhir identik dengan migrasi. **Sebaiknya seed.sql diperbaiki** (di luar lingkup harness) |

## Data uji tambahan (pasca/seed.sql) — yang diasumsikan simulasi_e2e tapi tidak dibuat seed

`simulasi_e2e.sql` ditulis untuk basis data produksi yang sudah pernah diuji
manual lewat aplikasi, sehingga mengandaikan (S0 hanya "memulihkan", tidak membuat):

* **drv2 (Rina Kartika, `a0…04`) = mitra travel disetujui** — S10/S11/S26/S27/S33/S50.
  Dibuat lewat RPC `travel_partner_register` sebagai drv2 + `admin_set_travel_partner(…, 'approved')`.
* **Satu driver berkendaraan box/pickup** (`dbox`) — S25 matriks kendaraan.
  Akun `driverbox@antaraja.id` (`a0…06`, sandi = `SEED_PASSWORD`), `drivers.vehicle_type='box'`, approved, di Pekanbaru.
* **AntarPay (0088) + semua saluran pembayaran (0089) dinyalakan, PIN admin uji `123456`** —
  default migrasi = semuanya mati (produksi memutuskan di panel). `uji_idempotensi.sql`
  memesan `paid_via='wallet'` tanpa menyalakannya sendiri (`AntarPay sedang dinonaktifkan sementara`),
  e2e S0 menyalakannya sendiri lalu memulihkan di S54/S55.

Tanpa fixture ini hasil e2e: 198 OK / 17 BUG; dengan fixture: 228 OK / 2 BUG dikenal.

## Bug yang diketahui (bukan harness) — `scripts/db-lokal/bug-dikenal.txt`

* **simulasi_e2e S55g/S55h** — tes (commit `83bfff5`) mengharapkan
  `'Metode pembayaran AntarPay …'` / `'Metode pembayaran Transfer bank …'`, tetapi
  `payment_channel_require()` di **0089** (commit `29d2ae3`, sudah di produksi) menolak lebih
  dulu di langkah 2 dengan `'Saluran AntarPay (saldo) sedang dinonaktifkan. …'` begitu saluran
  `antarpay` dimatikan (S55 langkah d mematikannya sebelum langkah e). Tidak mungkin lulus di
  lingkungan mana pun terhadap 0089 apa adanya. Perbaiki tesnya atau pesan 0089, lalu hapus
  barisnya dari `bug-dikenal.txt`.

Berkas uji lain (`uji_keamanan` 5 OK, `uji_peta` 23 OK, `uji_turn` 9 OK **lulus**;
`uji_kota`, `uji_kota_dan_tarif`, `uji_moderasi`, `uji_impor` **belum dikalibrasi untuk
lokal**: mengandaikan data produksi — ≥ 520 kota termasuk arsip OSM, order yang sudah ada,
dua pelanggan, kota OSM tiruan yang kini bentrok dengan impor Kepmendagri 0091–0093).

## Batasan

* `cron.*` dan `net.*` hanya mencatat; tidak ada job yang berjalan dan tidak ada HTTP keluar.
* Tidak ada GoTrue/PostgREST: RLS diuji lewat `set_config('request.jwt.claims', …)` +
  `set local role authenticated`, persis seperti tests di repo.
* Trust auth di `pg_hba.conf` hanya untuk localhost mesin uji; jangan tiru di server bersama.
* `reset` menghapus database `antarkita` lokal tanpa tanya.
