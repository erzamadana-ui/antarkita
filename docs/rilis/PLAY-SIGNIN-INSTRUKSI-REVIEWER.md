# Play Console → App content → Sign in details → kolom "Instructions"
## Teks siap-tempel untuk reviewer Google (Bahasa Inggris) — Pelanggan & Mitra

Turunan dari bagian "Teks instruksi akses untuk reviewer" di `PLAY-APP-CONTENT-JAWABAN-PELANGGAN.md` §2,
diperbarui ke keadaan kode saat ini (kota aktif Batam/Dumai/Padang/Pekanbaru, 514 kota "segera", AntarPay/Midtrans).
Setiap klaim alur menunjuk `file:baris`. Bagian **[BUTUH ERZA]** di bawah wajib dikerjakan sebelum submit.
Kata sandi TIDAK ditulis di berkas ini — ketik langsung di kolom "Password" Play Console.

---

## A. Aplikasi PELANGGAN — `id.antarkita.app` (salin blok di bawah apa adanya)

> **Login is required for all features. Use the test account in the credentials fields.**
>
> 1. Open the app → on the welcome screen tap **"Masuk"** (Sign in) → enter the e-mail and password provided.
> 2. You land on the customer home with all services (AntarRide, AntarFood, AntarSend, AntarShop, AntarMarket, AntarTravel).
> 3. **Service-area gate (intended behaviour, not a bug).** AntarKita currently operates in **4 Indonesian cities: Batam, Dumai, Padang and Pekanbaru** (35 km radius each). 514 other cities are listed as **"segera" (coming soon)**: choosing a pickup there shows a *"AntarKita belum melayani <city>"* notice with a **waiting-list** button instead of an order form, and the server rejects orders from outside a served city. This is by design.
>    To place a test order, do **not** rely on the device GPS:
>    a. Tap the pickup field **"Titik jemput"** → in the place picker type **"Batam"** (or a street name in Batam) and pick a result.
>    b. Set the destination **"Tujuan"** the same way (also in Batam) → tap **"Pesan"** (Order).
> 4. **Chat / voice call** exist only inside an active order: open the order → **"Chat"** or the phone icon next to the driver's name.
> 5. **Report / Block (UGC controls):** on the order detail screen and in the chat header, the **"⋯" button** next to the partner's name → **"Laporkan"** (Report) / **"Blokir"** (Block). Block list: **Akun → Pengguna diblokir**.
> 6. **Account deletion:** **Akun → Hapus akun** → type `HAPUS` → confirm. Web form: https://apps.antarkitaindonesia.com/hapus-akun/
> 7. **Wallet (AntarPay):** tab **"AntarPay"** → **"Top Up"**. Non-cash payments are processed by Midtrans; in the review environment the gateway may run in **simulation mode** — a **"Bayar (simulasi berhasil)"** button completes the payment without real money. Customer balance can only be spent on services; it cannot be withdrawn.
> 8. **Language:** **Akun → Bahasa / Language → English** switches core labels to English (some screens remain Indonesian). Key words: *Masuk* = sign in, *Pesan* = order, *Akun* = account, *Laporkan* = report, *Blokir* = block, *Hapus akun* = delete account.

Bukti alur Pelanggan: login wajib `src/screens/Entry.tsx:35`; tombol "Masuk" `src/screens/auth/welcome.tsx:87` + `src/lib/i18n.ts:21`;
label "Titik jemput"/"Tujuan" `src/components/LocationField.tsx:9`; gerbang kota di server `supabase/migrations/0080_penegakan_gerbang_kota.sql:30-32`
(radius dari `cities.radius_km`, cek `0077_kota_rpc_status.sql:136`); 514 kota Kepmendagri & 4 kota aktif `0094_rapikan_kota_lama.sql:4-6`;
kartu "belum melayani" + daftar tunggu `src/components/city/index.tsx:32-34,133`, dipasang di `src/screens/ride/index.tsx:141` dan `src/screens/customer/index.tsx:133`;
RPC daftar tunggu `0078_daftar_tunggu_kota.sql:55`; tombol simulasi `src/screens/pay/gateway.tsx:2,153-156` (memanggil `midtrans-webhook` `gateway.tsx:94`);
saldo pelanggan tidak bisa ditarik `0090_tarik_saldo_hanya_mitra.sql:37`; menu bahasa `src/screens/customer/account.tsx:39`, locale `en` `src/lib/i18n.ts:11,43`.

---

## B. Aplikasi MITRA — `id.antarkita.mitra` (salin blok di bawah apa adanya)

> **Login is required. The test account below is a DRIVER account that has already been verified (approved) by our admin, so the full driver flow is available.**
>
> 1. Open the app → tap **"Masuk"** (Sign in) → enter the e-mail and password provided. You are routed straight to the driver home (tabs: **Beranda** / Riwayat / Pendapatan / Akun).
>    *(If you instead see "Menunggu verifikasi admin" the account is not approved — please contact us; this screen is what an unverified applicant sees.)*
> 2. **Go online / offline:** the switch in the top card. Going online requires location permission (allow it) and a one-time **face check (selfie)** — a camera sheet opens, take a photo, then the switch turns **"Online"**. Tap again to go **"Offline"**.
> 3. **Receive & accept orders:** while online, incoming orders in the service area appear as cards → **"Terima"** / **"Terima Order"**. The order screen then walks through **Diterima → Tiba → Mengantar → Selesai** ("Selesai" = complete; a customer PIN may be requested for ride orders).
>    Orders only exist if a customer in **Batam / Dumai / Padang / Pekanbaru** places one; you may need to create one from the customer app (`id.antarkita.app`) with the customer test account, pickup set in Batam.
> 4. **Chat / voice call:** on the active order screen, the customer card has **"Chat"** and a phone icon. Calls are in-app (WebRTC), no phone numbers are exchanged.
> 5. **KYC / documents upload:** tab **Akun → "Data kendaraan & dokumen"** → fields *Nomor SIM* (licence no.), *NIK (KTP)* (national ID no.), **"Foto KTP"** (ID photo) and **"Foto kendaraan + STNK"** (vehicle + registration photo) with upload buttons. Re-submitting sets the account back to "pending" for admin review — please do not press the final submit button on the test account.
> 6. **Earnings & withdrawal (simulated):** tab **Pendapatan** shows the AntarPay balance, **"Top Up"** and **"Tarik Saldo"** (Withdraw). Withdrawal creates a request that our admin reviews manually; **no real money is transferred in the review environment**. Payments run through Midtrans in simulation mode (button "Bayar (simulasi berhasil)").
> 7. **Report / Block, account deletion, language:** **Akun → Pengguna diblokir**, **Akun → Hapus akun** (type `HAPUS`), **Akun → Bahasa / Language → English**.
>
> Key words: *Masuk* = sign in, *Terima* = accept, *Selesai* = complete, *Pendapatan* = earnings, *Tarik Saldo* = withdraw, *Akun* = account.

Bukti alur Mitra: routing driver→beranda `src/screens/Entry.tsx:61-69` (akun tanpa peran → `/onboarding`, `Entry.tsx:67`);
tab `src/screens/driver/tabs/_layout.tsx:18-21`; layar "Menunggu verifikasi admin" bila `status !== 'approved'` `src/screens/driver/tabs/index.tsx:82-103`;
saklar online `index.tsx:116` → `toggle` `index.tsx:41-51` → RPC `driver_set_online` `src/hooks/useDriver.ts:66`;
server menolak online bila belum approved `supabase/migrations/0007_phase4.sql:469`, menolak bila saldo < −Rp500.000 `0007:470-471`, minta selfie tiap 20 jam
(`driver_selfie_hours` `0007:432,473-475`) → `SelfieGate` `index.tsx:49,137` / `src/components/Safety.tsx:122,129` (RPC `driver_selfie_check`);
terima order `index.tsx:202,238` → `driver_accept_order` `useDriver.ts:69`; langkah status & PIN `src/screens/driver/order.tsx:26,53` (`driver_update_order_status`);
Chat & panggilan di kartu pelanggan `order.tsx:148` (rute `apps/mitra/app/order/[id]/chat.tsx`, `CallButton` `src/components/call/IncomingCall.tsx`);
KYC `src/screens/account/become-driver.tsx:218-221` (RPC `register_driver` `:96`), menu masuknya `src/screens/driver/tabs/account.tsx:29`;
Pendapatan `src/screens/driver/tabs/earnings.tsx:52` (`WalletView allowWithdraw`), tombol Top Up/Tarik `src/components/WalletView.tsx:66-67`,
penarikan `src/screens/pay/withdraw.tsx:27` → `request_withdrawal` (hanya mitra, `0090_tarik_saldo_hanya_mitra.sql:25-37`) → antrean admin `src/screens/admin/finance.tsx:46` (`admin_review_withdrawal`);
sakelar AntarPay `0088_antarpay_toggle.sql:34` (default **false** → tombol Top Up/Tarik disembunyikan `WalletView.tsx:36`), dinyalakan admin di `src/screens/admin/gateway.tsx:64`.

---

## C. Langkah admin: menyetujui akun driver uji (WAJIB sebelum kredensial diserahkan)

Reviewer tidak boleh menerima akun driver berstatus `pending` — mereka hanya akan melihat layar "Menunggu verifikasi admin" (`index.tsx:82-103`)
dan tidak bisa online (`0007_phase4.sql:469`). Alur di panel Admin (`apps/admin`, akun `profiles.role = 'admin'`, `Entry.tsx:56-58`):

1. Buka menu **Driver** (`src/screens/admin/_layout.tsx:33` → `src/screens/admin/drivers.tsx`). Filter bawaan sudah **"Menunggu"** (`drivers.tsx:23,80`).
2. Cari nama akun uji → (opsional) tombol **KTP** / **Unit** untuk melihat dokumen (`drivers.tsx:116-117`).
3. Tekan **"Setujui"** (`drivers.tsx:154-156`) → memanggil RPC `admin_set_driver_status(p_driver, 'approved')`
   (`supabase/migrations/0009_phase5.sql:225-233`; cek `is_admin()` di `:228`, tercatat di `log_activity` `:232`). Enum `approval_status` = pending/approved/suspended/rejected (`0001_schema.sql:10`, kolom `drivers.status` `:86`).
4. Verifikasi: filter **"Aktif"** memuat akun itu; di aplikasi Mitra badge Akun berubah "Mitra aktif" (`src/screens/driver/tabs/account.tsx:24,52`).
5. Isi saldo uji: menu **Pengguna** (`_layout.tsx:64` → `src/screens/admin/users.tsx:69`, RPC `admin_adjust_wallet`, `0019_tahap7_otomasi_keamanan_laporan.sql:250`) — beri nominal positif agar reviewer bisa mencoba **Tarik Saldo** dan tidak tertahan batas saldo minus (`0007:470-471`).
6. Pastikan **AntarPay aktif** di menu **Payment Gateway** (`src/screens/admin/gateway.tsx:64`); bila `antarpay_enabled=false` (`0088:34`) tombol Top Up/Tarik Saldo tidak tampil dan reviewer akan menganggap fitur hilang.
7. Jangan tekan "Minta dokumen ulang…" atau "Tangguhkan…" pada akun uji (`drivers.tsx:160,162`) — keduanya menurunkan status dan mematikan online (`0009:231`).

---

## D. [BUTUH ERZA] — dikerjakan sendiri, tidak bisa dari kode

1. **Buat 1 akun PELANGGAN uji khusus** di aplikasi Pelanggan (Daftar → nama, HP, email, kata sandi; `src/screens/auth/register.tsx:23-28`). Pakai **email baru** milik Anda (mis. alias `+playreview`). **JANGAN** pakai akun orang asli — `suryadi0401` dan `sigitekoprayogo1804` adalah pelanggan nyata, dilarang dipakai. Pastikan email terkonfirmasi (kalau tidak, login gagal "Email not confirmed", `src/lib/supabase.ts`). Isi saldo AntarPay uji lewat Admin → Pengguna (langkah C.5).
2. **Buat 1 akun DRIVER uji** di aplikasi Mitra: "Daftar jadi mitra" (`welcome.tsx:85`) → onboarding (`Entry.tsx:67`) → **Jadi Driver** → isi SIM/NIK/plat + unggah foto dummy (`become-driver.tsx:218-221`; boleh foto placeholder, bukan KTP asli). Lalu **approve di Admin** (bagian C.1-C.4), **isi saldo uji** (C.5), nyalakan AntarPay (C.6). Uji sendiri sekali: masuk → online (selfie) → offline, sebelum menyerahkan.
3. **Ketik kata sandi kedua akun sendiri di Play Console** (App content → Sign in details → Username/Password, lalu tempel teks A atau B ke "Instructions"). Jangan menuliskan kata sandi di berkas ini, di chat, atau meminta AI mengetikkannya.
4. Cek di produksi bahwa hanya 4 kota berstatus `aktif`: `select name, service_status, radius_km from cities where service_status='aktif';` — teks A/B menyebut Batam, Dumai, Padang, Pekanbaru dan radius 35 km; sesuaikan bila berbeda.
5. Kalau Midtrans sudah **produksi** (`gateway_secrets.is_production=true`), tombol "Bayar (simulasi berhasil)" tidak akan muncul (`gateway.tsx:2,153`) — hapus kalimat simulasi dari teks A.7 dan B.6, dan sediakan saldo uji lebih besar agar reviewer tidak perlu bayar sungguhan.
6. Rekomendasi: unggah video demo 30-60 detik (login → pilih Batam → pesan → driver terima) di kolom instruksi; Play menerima tautan video dan ini mencegah laporan "app does not function".
