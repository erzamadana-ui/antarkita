# Push Notification & Rute Suara Panggilan (Tahap 11 — sisi aplikasi)

Dokumen ini menjelaskan apa yang **sudah jalan di kode** dan apa yang **masih harus dikerjakan pemilik**
(kunci Firebase, secret Supabase). Tidak ada kunci apa pun yang disimpan di repositori.

---

## 1. Loudspeaker saat panggilan

| Bagian | Berkas |
| --- | --- |
| Abstraksi tunggal | `src/lib/audioRoute.ts` (penunjuk tipe) |
| Android & iOS | `src/lib/audioRoute.native.ts` — `expo-audio` `setAudioModeAsync({ shouldRouteThroughEarpiece })` |
| Web | `src/lib/audioRoute.web.ts` — `HTMLMediaElement.setSinkId` (perilaku lama dipertahankan) |
| Dipakai oleh | `src/lib/call.ts` (`startCallAudio` / `stopCallAudio` / `toggleSpeaker`) dan `src/screens/call.tsx` |

**Mekanismenya nyata**, bukan klaim — lihat sumber paket yang terpasang:

* Android — `node_modules/expo-audio/android/.../AudioModule.kt` baris 917‑921:
  `audioManager.mode = MODE_IN_COMMUNICATION / MODE_NORMAL` + `audioManager.setSpeakerphoneOn(...)`
* iOS — `node_modules/expo-audio/ios/AudioModule.swift` baris 801‑804:
  kategori `.playAndRecord` + opsi `.defaultToSpeaker` saat `shouldRouteThroughEarpiece = false`

`react-native-incall-manager` **tidak dipakai**: `expo-audio` adalah paket resmi SDK 57 (autolinking &
prebuild jalan tanpa konfigurasi tambahan), sedangkan modul pihak ketiga itu belum tentu kompatibel
dengan React Native 0.86.

Bila modul native tidak ikut ter-build (mis. Expo Go), tombol speaker **dinonaktifkan** dengan
keterangan netral — **bukan** pesan kesalahan merah.

Uji: `npm run test:audio`

---

## 2. Push notification

### Alur

```
initPush()                       → izin + token FCM perangkat
  └─ rpc register_push_token({ p_token, p_platform, p_app })   → tabel push_tokens

server: trigger notifications / order_messages / call_logs
  └─ push_outbox  →  pg_cron: push_dispatch()  →  Edge Function push-send  →  FCM HTTP v1
                                                   android.notification.channel_id = 'antarkita'

perangkat:
  • aplikasi TERBUKA  → setNotificationHandler (notifikasi tetap tampil) + listener
                        kind/route 'call' → nada dering + layar panggilan
  • aplikasi TERTUTUP → notifikasi sistem; ketukan masuk lewat
                        addNotificationResponseReceivedListener
  • COLD START        → getLastNotificationResponseAsync() saat initPush()

logout                            → disposePush() → rpc unregister_push_token
```

`disposePush()` dipasang otomatis **sebelum** `signOut` lewat `attachSignOutHook()`
(`src/lib/push.ts`, dipanggil dari `src/screens/RootLayout.tsx`) — tidak ada layar logout yang perlu diubah.

### Peta tujuan saat notifikasi diketuk

Satu sumber kebenaran: `notifTargetFor()` di `src/hooks/useNotifications.ts`, dipakai bersama oleh
kotak masuk **dan** push. Dua jalur tambahan khusus push: `route: 'chat'` → `/order/<id>/chat`,
`route: 'call'` → `/call/<id>` (hanya bila panggilannya memang masih berlangsung).

Uji: `npm run test:push`

### Channel Android

| id | Dipakai | Suara | Prioritas |
| --- | --- | --- | --- |
| `antarkita` | semua push dari server (id ini dikunci di `push-send/index.ts` dan `app.config.ts → defaultChannel`) | default | MAX |
| `panggilan` | notifikasi panggilan yang dibuat aplikasi sendiri | `ring.wav` | MAX |

> Android 8+ mengunci suara & prioritas di level channel. Kalau channel terlanjur dibuat dengan
> setelan salah, **ganti id channel** — mengubah nilainya saja tidak berpengaruh pada perangkat lama.

---

## 3. YANG HARUS DILAKUKAN PEMILIK

1. **Firebase → `google-services.json`** (JANGAN di-commit; sudah masuk `.gitignore`)
   * Firebase Console → tambahkan Android app untuk **ketiga** applicationId:
     `id.antarkita.app`, `id.antarkita.mitra`, `id.antarkita.admin` (boleh satu berkas untuk ketiganya).
   * Lokal: salin ke `./google-services.json`, lalu isi di `.env`:
     `GOOGLE_SERVICES_JSON=./google-services.json`
   * CI/EAS: simpan sebagai **secret berkas** bernama `GOOGLE_SERVICES_JSON`
     (EAS menulisnya ke disk dan mengisi variabel lingkungan dengan path-nya).
   * Tanpa berkas ini `expo prebuild` & gradle **tetap jalan**, hanya push-nya belum aktif.

2. **Secret `FCM_SERVICE_ACCOUNT` di Supabase** — isi JSON service account Firebase
   (Project settings → Service accounts → Generate new private key). Tanpa ini `push-send`
   menandai antrean `skipped`, bukan error.

3. **`admin_set_push_config(url, service_role_key)`** — sekali saja, supaya `push_dispatch()`
   tahu URL Edge Function `push-send` dan kunci pemanggilnya.

4. **Ikon notifikasi (opsional, disarankan)** — buat `apps/<app>/assets/notification-icon.png`
   (96×96, putih penuh + transparan), lalu tambahkan `icon` pada plugin `expo-notifications`
   di `app.config.ts`. Tanpa itu Android memakai ikon aplikasi (siluetnya bisa kurang rapi).

5. **iOS (bila kelak dirilis)** — push iOS **belum berfungsi**: `getDevicePushTokenAsync()` di iOS
   mengembalikan token APNs sedangkan `push-send` mengirim lewat FCM v1 yang menuntut token
   registrasi FCM. Pilih salah satu: tambahkan SDK Firebase iOS
   (`@react-native-firebase/messaging`) agar dapat token FCM, **atau** tambahkan jalur APNs di
   Edge Function. Sampai itu ada, token APNs sengaja tidak didaftarkan supaya `push_tokens` tidak
   terisi token yang pasti gagal.

6. **Web** — push web butuh Firebase JS SDK + service worker + kunci VAPID. Belum dikerjakan;
   web tetap memakai bunyi dalam aplikasi (`src/lib/sound.ts`).
