# OPS-PUSH — mengaktifkan notifikasi push di produksi (migrasi 0116)

Status sebelum 0116 (audit 28 Sep, G-05/G-26): `push_dispatch()` jalan tiap menit (pg_cron) tetapi `push_config` kosong →
diam-diam `{skipped}` → **tidak ada push yang pernah terkirim**. Desain lama juga menuntut kunci **service_role** disimpan
di tabel biasa. 0116 menggantinya:

```
push_outbox (pending)
   │  pg_cron tiap menit: public.push_dispatch(100)
   ▼
pg_net POST  <function_url>                      ← push_config.function_url
   headers: apikey / Authorization: Bearer <anon key>   ← push_config.anon_key (publik; hanya untuk lolos verify_jwt gateway)
            x-push-secret: <rahasia>                     ← Vault 'push_dispatch_secret' (cadangan: push_config.dispatch_secret)
   ▼
Edge Function push-send  → cocokkan x-push-secret dengan secret PUSH_DISPATCH_SECRET (waktu-konstan)
                         → FCM HTTP v1 memakai secret FCM_SERVICE_ACCOUNT → push_outbox.status sent/failed/skipped
```

Konfigurasi kosong tidak lagi diam: `push_dispatch()` mengembalikan `{ok:false, error:'PUSH_CONFIG_KOSONG', missing:[…]}` dan
menulis `security_events` kind `push.config_missing` (maks. 1 baris/jam) — terlihat di Panel Admin → Pusat Keamanan.

## Prasyarat

* Migrasi `0116_push_secret.sql` sudah diterapkan (`supabase db push` / MCP `apply_migration`).
* Edge Function `push-send` versi 0116 sudah di-deploy (`verify_jwt = true`; bundle: `node scripts/edge-bundle.mjs push-send --check`).
* Ekstensi `pg_net` dan `pg_cron` aktif (sudah dipakai proyek). Ekstensi `supabase_vault` aktif (bawaan proyek Supabase;
  bila tidak ada, rahasia jatuh ke kolom `push_config.dispatch_secret` — tetap berfungsi, hanya tidak terenkripsi).

## (a) Buat secret di Supabase

Dashboard → **Project Settings → Edge Functions → Secrets** (atau MCP `create_edge_function_secret`):

| Secret | Nilai | Catatan |
|---|---|---|
| `PUSH_DISPATCH_SECRET` | string acak ≥ 32 karakter, mis. `openssl rand -hex 32` | harus **sama persis** dengan rahasia yang disimpan lewat `admin_set_push_dispatch` (langkah b). Edge menolak bila < 16 karakter. |
| `FCM_SERVICE_ACCOUNT` | **isi penuh** berkas JSON service account Firebase (satu baris, apa adanya) | tanpa ini push-send menandai antrean `skipped` + `last_error = 'FCM_SERVICE_ACCOUNT belum diisi'` (bukan error). |

Cara mengambil JSON service account (Firebase project **antarkita-b04b7**):
1. Firebase Console → pilih project `antarkita-b04b7` → ikon roda gigi → **Project settings**.
2. Tab **Service accounts** → pastikan "Firebase Admin SDK" dipilih → **Generate new private key** → **Generate key**.
3. Berkas `antarkita-b04b7-firebase-adminsdk-xxxxx.json` terunduh. Isinya (`project_id`, `client_email`, `private_key`, …)
   ditempel utuh ke secret `FCM_SERVICE_ACCOUNT`. Pastikan Cloud Messaging API (V1) aktif di tab **Cloud Messaging**.
4. Simpan berkasnya di tempat aman (1Password/Vault), **jangan** commit ke repo dan jangan tempel di chat/Obsidian.
   Bila pernah bocor → Service accounts → Manage service account permissions → hapus kunci lama, generate ulang, perbarui secret.

Secret baru berlaku pada pemanggilan Edge Function berikutnya (tidak perlu deploy ulang).

## (b) Daftarkan URL + anon key + rahasia ke database

Dari Panel Admin (peran dengan izin `gateway_secret`, PIN terbuka) atau SQL Editor **sebagai admin yang login** (RPC memeriksa
`admin_require('gateway_secret')` + `admin_require_unlock()`, jadi lewat SQL Editor biasa akan ditolak — gunakan Panel Admin, atau
sementara jalankan `set_config('request.jwt.claims', …)` seperti di uji):

```sql
select admin_set_push_dispatch(
  'https://<ref-proyek>.supabase.co/functions/v1/push-send',   -- URL Edge Function
  '<ANON KEY (JWT eyJ…)>',                                      -- Project Settings → API → anon public (legacy JWT)
  '<PUSH_DISPATCH_SECRET yang sama dengan langkah a>');
```

* Parameter kosong/NULL = nilai itu **tidak diubah** (bisa hanya memperbarui rahasia).
* Rahasia disimpan ke Vault (`vault.secrets` name `push_dispatch_secret`); `push_config.dispatch_secret` dikosongkan.
  Balasan & `audit_logs` tidak pernah memuat rahasia/anon key.
* `admin_set_push_config(url, key)` lama masih ada → sama dengan `admin_set_push_dispatch(url, key, null)`; `key` kini
  dianggap **anon key**, bukan service_role.
* Anon key harus format **JWT** (`eyJ…`) karena `verify_jwt = true` di gateway. Bila proyek hanya punya kunci
  `sb_publishable_…` (bukan JWT), deploy `push-send` dengan `verify_jwt = false` — otorisasi tetap dijamin `x-push-secret`
  (header salah/tanpa secret → 403).

Cek: `select admin_push_dispatch_status();` → `configured: true`, `has_secret: true`, `secret_store: 'vault'`, `cron_active: true`.

## (c) Uji kirim

1. Di ponsel: login ke aplikasi dengan akun uji, izinkan notifikasi (ini mendaftarkan token ke `push_tokens`).
2. Panel Admin / SQL sebagai admin:
   ```sql
   select admin_push_test('<uuid pengguna uji>');   -- tanpa argumen = ke admin pemanggil sendiri
   ```
   Balasan: `{ok:true, outbox_id, tokens:1, dispatch:{ok:true, queued:N, request_id}}`. `tokens: 0` + `warning` berarti pengguna
   belum punya token (buka aplikasi dulu).
3. Tunggu ≤ 1 menit, lalu `select admin_push_dispatch_status();` dan
   ```sql
   select id, status, attempts, last_error, sent_at from push_outbox order by id desc limit 5;
   ```

## (d) Tanda sukses / gagal

| Gejala | Arti | Tindakan |
|---|---|---|
| Ponsel menerima "Uji notifikasi AntarKita"; `push_outbox.status = 'sent'`; `outbox_sent_24h` naik | **Sukses** | selesai |
| `push_dispatch` → `{ok:false, error:'PUSH_CONFIG_KOSONG', missing:[…]}`; `security_events` `push.config_missing` | langkah (b) belum lengkap | isi yang ada di `missing` |
| `status = 'skipped'`, `last_error = 'FCM_SERVICE_ACCOUNT belum diisi'` | otorisasi lolos (rantai DB → edge sudah benar), secret FCM belum ada | isi `FCM_SERVICE_ACCOUNT` (a), lalu kirim uji baru (baris `skipped` tidak dikirim ulang) |
| `status = 'failed'`, `last_error = 'FCM_SERVICE_ACCOUNT bukan JSON sah'` | JSON terpotong / `\n` rusak | tempel ulang isi berkas utuh |
| `status = 'failed'`, `last_error` berawalan `401`/`403 …` dari FCM | service account bukan milik project `antarkita-b04b7` atau API FCM v1 belum aktif | cek project_id & aktifkan Cloud Messaging API |
| `status = 'failed'`, `last_error = '404 … UNREGISTERED'` | token perangkat kedaluwarsa (token otomatis dihapus) | login ulang di ponsel |
| `status = 'failed'`, `last_error = 'pengguna tidak punya token perangkat'` | belum pernah izinkan notifikasi | buka aplikasi, izinkan notifikasi |
| Baris tetap `sending` > 1 menit, `last_error` kosong | pg_net tidak sampai ke edge: URL salah, atau push-send membalas 403 (secret beda / anon key bukan JWT) | `select * from net._http_response order by id desc limit 5;` → lihat status_code/body; samakan `PUSH_DISPATCH_SECRET`; `push_requeue_stuck()` mengembalikan ke pending setelah 10 menit |
| Edge log `push-send: Hanya admin` (403) | `x-push-secret` tidak cocok / secret edge < 16 karakter | samakan nilai di (a) dan (b) |

Rollback: `supabase/rollback/0116_down.sql` (mengembalikan `push_dispatch` lama — yang berarti push mati lagi sampai
`admin_set_push_config(url, service_role_key)` diisi).

Uji lokal: `scripts/db-lokal.sh test supabase/tests/uji_push_0116.sql` dan `cd supabase/functions && deno test tests`.

---
*Keterbatasan: dokumen ini ditulis tanpa akses ke proyek Supabase/Firebase produksi — nama menu dashboard mengikuti
Supabase/Firebase per Okt 2026; nilai `net._http_response` hanya ada bila pg_net menyimpan respons (bawaan: 6 jam).*
