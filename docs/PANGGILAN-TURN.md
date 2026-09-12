# Panggilan suara di jaringan seluler — TURN (Cloudflare Realtime)

**Masalah yang diselesaikan.** WebRTC hanya memakai STUN → dua ponsel di balik CGNAT operator
seluler (Telkomsel/XL/Indosat) sering gagal saling terhubung; telepon dalam aplikasi hanya andal di Wi‑Fi.
TURN merelai media lewat server Cloudflare sehingga panggilan tersambung di jaringan apa pun.

**Mengapa bukan `EXPO_PUBLIC_TURN_URL/USER/PASS` di build.** Kredensial statis tertanam di APK bisa
dibongkar siapa pun dan dipakai menghabiskan kuota. Cloudflare memang tidak menyediakan kredensial
statis: kredensial dibuat **berumur pendek** oleh server memakai API token. Variabel build lama tetap
dihormati sebagai cadangan (opsional), tetapi tidak lagi diperlukan.

## Arsitektur (migrasi 0082)

```
aplikasi (call.ts)                     Supabase                             Cloudflare
getIceServers()  ─invoke─▶  Edge Function turn-credentials  ─POST─▶  /v1/turn/keys/<token_id>/credentials/generate-ice-servers
  ▲ cache ≤ ttl-10 mnt          │ 1. auth.getUser() wajib login              │ { ttl: 7200 }
  │                             │ 2. baca turn_secrets (service_role)         ▼
  └── iceServers (STUN+TURN) ◀──┘ 3. catat turn_issue_log            { iceServers: [ …username/credential sementara… ] }
```

| Komponen | Berkas | Catatan |
| --- | --- | --- |
| Tabel rahasia | `turn_secrets` (RLS tanpa policy, revoke anon/authenticated) | `api_token` tidak pernah keluar ke klien |
| Log | `turn_issue_log` | dipakai badge "7 hari: n berhasil · n gagal" di Panel Admin |
| RPC admin | `admin_turn_status()`, `admin_set_turn_config(jsonb)` | hanya `is_admin()`; status hanya versi tersamar |
| Edge Function | `supabase/functions/turn-credentials/index.ts` | verify_jwt **+** `auth.getUser()` (kunci anon saja → 401) |
| Klien | `src/lib/call.ts` → `getIceServers()` | cache; timeout 4 dtk; gagal → STUN saja (panggilan tidak pernah digagalkan karena TURN) |
| Panel Admin | Pengaturan → kartu **"Panggilan suara — server TURN"** | Simpan / Uji / Nonaktifkan / Hapus tanpa build ulang |

Kredensial diminta lebih awal (saat login → `listen()`, saat `startCall`, saat `accept`) agar saat
`RTCPeerConnection` dibuat tidak ada jeda menunggu server.

## Operasional

* **Sumber kredensial:** Cloudflare Dashboard → Realtime → TURN Server → app `antarkita-panggilan`
  (Token ID + API Token; API Token hanya tampil sekali saat dibuat — kalau hilang, buat app baru lalu
  tempel ulang di Panel Admin, tidak perlu build ulang).
* **Uji:** Panel Admin → Pengaturan → Uji. Hasil "OK — Cloudflare mengeluarkan kredensial" berarti
  jalur lengkap (login → Edge Function → Cloudflare) bekerja. Diverifikasi 12 Sep 2026 dari sesi admin web.
* **Biaya:** gratis 1.000 GB/bulan, di atas itu per GB (lihat harga Cloudflare Realtime saat ini).
  Panggilan suara ±0,05 MB/detik per arah → 1.000 GB ≈ 2,7 juta menit relai/bulan [ASUMSI codec Opus 40 kbps;
  hanya panggilan yang gagal jalur langsung yang direlai].
* **Uji basis data:** `supabase/tests/uji_turn.sql` (9 pemeriksaan, rollback; terakhir 9/9 lulus 12 Sep 2026).
* **Rotasi:** buat app TURN baru di Cloudflare → tempel Token ID + API Token baru di Panel Admin → hapus app lama.

## Keterbatasan
* Kredensial TURN berlaku `ttl_seconds` (bawaan 2 jam). Panggilan yang sedang berjalan tidak terpengaruh
  saat kredensial kedaluwarsa; panggilan berikutnya otomatis meminta yang baru.
* Bila Edge Function tidak terjangkau >4 detik, panggilan tetap dicoba dengan STUN (perilaku lama).
