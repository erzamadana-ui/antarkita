# Sakelar AntarPay (enable/disable dari Panel Admin)

Migrasi: `supabase/migrations/0088_antarpay_toggle.sql`. Keputusan komisaris: AntarPay (dompet +
payment gateway Midtrans) belum siap 100%, jadi harus bisa dimatikan dari Panel Admin.
**Default: NONAKTIF** sampai pemilik menyalakannya sendiri.

## Cara menyalakan / mematikan

1. Buka **Panel Admin → Gateway / AntarPay** (`src/screens/admin/gateway.tsx`).
2. Kartu paling atas **"AntarPay & Payment Gateway"** memuat sakelar Aktif/Nonaktif.
3. Menggeser sakelar memanggil RPC `admin_set_antarpay_enabled(p_enabled)`:
   - wajib `is_admin()` **dan** panel sedang terbuka kunci PIN (`admin_require_unlock()`);
     bila terkunci, aplikasi menampilkan modal PIN (`ADMIN_LOCKED`) seperti tindakan sensitif lain;
   - dicatat ke log aktivitas (`audit_logs.action = 'antarpay.toggle'`).
4. Perubahan terasa di aplikasi pelanggan & mitra dalam hitungan detik: nilai ikut dikirim lewat
   `app_public_settings().antarpay_enabled` (dimuat saat mulai, disegarkan realtime dari tabel
   `app_settings`, saat aplikasi kembali aktif, dan cache 60 detik) serta `gateway_public_config().antarpay_enabled`.

Lewat SQL (darurat, sebagai postgres):

```sql
update app_settings set value = 'true'::jsonb,  updated_at = now() where key = 'antarpay_enabled';  -- nyalakan
update app_settings set value = 'false'::jsonb, updated_at = now() where key = 'antarpay_enabled';  -- matikan
select antarpay_enabled();  -- cek
```

## Apa yang DIBLOKIR saat nonaktif (jalur BARU uang masuk/keluar)

Semua ditolak server dengan pesan **"AntarPay sedang dinonaktifkan sementara. Gunakan pembayaran tunai."**

| Jalur | Fungsi / komponen | Migrasi asal definisi | Cara pasang penjaga di 0088 |
|---|---|---|---|
| Top up manual (transfer bank) | `request_topup` | 0002 | disalin utuh + `perform antarpay_require_enabled()` di awal |
| Pencairan saldo mitra | `request_withdrawal` | 0019 | disalin utuh + penjaga di awal |
| Order semua layanan dengan `paid_via` ≠ `cash` (wallet / gopay / ovo / dana / shopeepay / qris / …) | `create_order` | 0014 (+ tambalan 0021, 0030, 0080, 0083) | `pg_get_functiondef` + sisip di jangkar `Harus login` — tambalan lama tetap utuh |
| Booking kursi / carter jadwal mitra travel dengan dompet | `travel_book` | 0011 (+ tambalan 0080) | idem |
| Permintaan carter / sopir harian dengan dompet (perhatikan: default `payment_method` fungsi ini = `wallet`) | `travel_request_create` | 0015 (+ tambalan 0080) | idem |
| Transaksi Snap Midtrans baru (top up instan / bayar kekurangan) | edge function `midtrans-create` | — | `admin.rpc('antarpay_enabled')` sebelum insert `payments`; balasan **403 JSON** |

Fungsi pembantu: `antarpay_enabled()` (boolean, stable, security definer, `false` bila baris tidak ada;
grant ke anon & authenticated) dan `antarpay_require_enabled()` (raise pesan di atas).

Sisi klien (hanya mencegah pengguna menabrak tembok server; server tetap sumber kebenaran):

- `src/hooks/useAppSettings.ts` — `useAntarPay()` → `{ enabled, loaded }`. **Gagal-tertutup**: sebelum
  pengaturan termuat atau bila server tidak mengirim kunci, AntarPay dianggap nonaktif.
- `src/components/BookingSheet.tsx` (`PaymentSection`, dipakai ride/car/food/send/box/shop/market/travel):
  opsi AntarPay & e-wallet disembunyikan, metode dipaksa `cash`, catatan kecil "AntarPay sementara nonaktif".
- `src/components/PaymentMethods.tsx` (tab Metode): tombol Top up, baris Saldo AntarPay, E-wallet, dan kartu
  pilihan e-wallet disembunyikan; banner nonaktif.
- `src/components/WalletView.tsx` (tab Saldo pelanggan, Pendapatan driver, Dompet merchant): saldo & riwayat
  tetap terlihat, tombol Top Up / Tarik Saldo disembunyikan, banner nonaktif.
- `src/screens/pay/topup.tsx`, `src/screens/pay/gateway.tsx`, `src/screens/pay/withdraw.tsx`: banner + tombol
  kirim/bayar/cairkan dinonaktifkan (bila layar dibuka lewat tautan lama).
- Beranda: shortcut AntarPay tetap ada dan mengarah ke tab AntarPay yang menampilkan banner.

## Apa yang TETAP BERJALAN saat nonaktif (sengaja — saldo yang sudah ada tidak boleh macet)

- `wallet_apply` internal: **refund** order/travel yang dibatalkan atau ditolak merchant, **earning** driver /
  merchant / mitra travel / vendor, **potongan platform** (fee), penyesuaian admin (`admin_adjust_wallet`).
- Penyelesaian **webhook Midtrans** (`payment_settle`) untuk transaksi yang sudah terlanjur dibuat sebelum
  sakelar dimatikan (uang yang sudah dibayar pelanggan tetap masuk saldo).
- **Persetujuan admin** atas permintaan top up / penarikan yang sudah masuk sebelumnya
  (`admin_review_topup`, `admin_review_withdrawal`) — admin bisa menyelesaikan antrean lama.
- Order berbayar dompet yang sudah ada sebelum sakelar dimatikan tetap bisa diselesaikan/dibatalkan normal.

### Jalur yang menyentuh dompet tetapi TIDAK diblokir (catatan risiko, keputusan sadar)

Semuanya hanya menggerakkan saldo yang **sudah ada di dalam** AntarPay (tidak ada uang baru masuk/keluar
platform) dan hanya mungkin terjadi pada order yang dibuat saat AntarPay aktif:

- `add_tip` — tip pelanggan dari saldo AntarPay (dipanggil dari layar order aktif/selesai).
- `respond_extra` — persetujuan biaya tambahan pada order berbayar dompet.
- `set_shopping_actual` — selisih belanja (shop/market) dipotong/dikembalikan pada order dompet.
- `travel_offer_accept` — pembayaran penawaran untuk permintaan travel yang **sudah dibuat** dengan dompet
  sebelum sakelar dimatikan (permintaan baru dengan dompet sudah ditolak di `travel_request_create`).

Bila komisaris ingin ini ikut diblokir, cukup tambahkan `perform antarpay_require_enabled();` di awal
fungsi-fungsi tersebut dengan pola yang sama (salin definisi terakhir → 0089).

## Saluran pembayaran per metode (migrasi 0089)

Migrasi: `supabase/migrations/0089_saluran_bayar_toggle.sql`. Keputusan komisaris (mencontoh daftar
metode bayar Alfagift): **setiap saluran pembayaran harus bisa dinyalakan/dimatikan satu per satu** —
termasuk AntarPay sendiri dan e-money kartu NFC — bukan hanya sakelar global.

### Hierarki sakelar: global → per-saluran

```
antarpay_enabled() = false  →  SEMUA saluran selain `cash` EFEKTIF NONAKTIF (apa pun setelan per-saluran)
antarpay_enabled() = true   →  tiap saluran mengikuti app_settings.payment_channels
`cash` (tunai/COD) TIDAK tunduk pada sakelar global — hanya pada sakelar salurannya sendiri.
```

Setelan disimpan di `app_settings` kunci **`payment_channels`** (objek jsonb `{"<kunci>": true/false}`):

| Kunci | Tampil sebagai | Default |
|---|---|---|
| `cash` | Tunai / COD | **true** |
| `antarpay` | AntarPay (saldo) | false |
| `emoney_nfc` | E-money (kartu NFC) | false |
| `gopay` `shopeepay` `qris` `ovo` `dana` `bank_transfer` `card` | GoPay · ShopeePay · QRIS · OVO · DANA · Transfer bank (VA) · Kartu kredit/debit | false (Midtrans belum produksi) |

### Cara pakai

1. Buka **Panel Admin → Gateway / AntarPay** (`src/screens/admin/gateway.tsx`).
2. Kartu **"Saluran Pembayaran"** (di bawah kartu sakelar global) memuat satu baris + `Switch` per saluran.
3. Menggeser sakelar memanggil RPC `admin_set_payment_channel(p_key, p_enabled)`:
   - wajib `is_admin()` **dan** panel terbuka kunci PIN (`admin_require_unlock()`); `ADMIN_LOCKED` memunculkan modal PIN;
   - kunci di luar daftar ditolak (`Saluran pembayaran tidak dikenal: …`);
   - dicatat ke log aktivitas (`audit_logs.action = 'payment_channel.toggle'`);
   - untuk saluran gateway, **`pg_methods` ikut diperbarui** (ditambah/dikeluarkan) supaya Snap Midtrans konsisten.
4. Saat sakelar global mati, baris non-tunai tampil redup + keterangan
   *"Sakelar AntarPay global sedang nonaktif — semua saluran non-tunai ikut nonaktif."*
5. Chip "Metode aktif" lama **digantikan** daftar ini (hanya satu kontrol; tombol *Simpan konfigurasi*
   tetap menulis `pg_methods` dari saluran gateway yang menyala).

Lewat SQL (darurat, sebagai postgres):

```sql
select payment_channels_stored();                      -- setelan mentah yang disimpan admin
select payment_channels_public();                      -- status EFEKTIF (sudah memperhitungkan sakelar global)
select payment_channel_enabled('gopay');               -- satu saluran
update app_settings set value = value || '{"gopay": true}'::jsonb, updated_at = now() where key = 'payment_channels';
```

### Penegakan di server

| Jalur | Fungsi | Migrasi asal definisi | Cara pasang penjaga di 0089 |
|---|---|---|---|
| Order semua layanan | `create_order` | 0014 (+ tambalan 0021, 0030, 0080, 0083, 0088) | `pg_get_functiondef` + sisip **sesudah** penjaga 0088 → `perform payment_channel_require(v_paid_via);` |
| Booking kursi/carter jadwal mitra | `travel_book` | 0011 (+ 0080, 0088) | idem |
| Permintaan carter / sopir harian | `travel_request_create` | 0015 (+ 0080, 0088) | idem (default `payment_method` = `wallet`) |
| Top up manual | `request_topup` | 0002 (+ 0088) | sisip sesudah `antarpay_require_enabled()` → saluran `p_method` harus aktif |
| Snap Midtrans baru | edge function `midtrans-create` | — | `admin.rpc('payment_channel_enabled', { p_key: method })` → **403 JSON** |

Pemetaan `paid_via` → saluran (`payment_channel_of`): `''`/`null`/`cash` → `cash`; `wallet` → `antarpay`;
`emoney`/`nfc` → `emoney_nfc`; kode e-wallet/gateway yang dikenal → saluran bernama sama; kode tak dikenal
→ `antarpay` (karena `create_order` memperlakukan semua non-`cash` sebagai pembayaran dompet).

Pesan penolakan (Bahasa Indonesia, menyebut nama salurannya):

```
Metode pembayaran GoPay sedang dinonaktifkan. Pilih metode lain.
```

Bila penyebabnya sakelar **global**, pesannya tetap yang lama:
*"AntarPay sedang dinonaktifkan sementara. Gunakan pembayaran tunai."*

Fungsi baru: `payment_channel_keys()`, `payment_gateway_channel_keys()`, `payment_channel_label(text)`,
`payment_channel_of(text)`, `payment_channel_enabled(text)`, `payment_channels_stored()`,
`payment_channels_public()` (anon+authenticated), `payment_channel_require(text)`,
`admin_set_payment_channel(text, boolean)` & `admin_payment_channels()` (admin saja).
`payment_channels` juga ikut dikirim di `app_public_settings()` dan `gateway_public_config()`
(ditambahkan lewat `pg_get_functiondef` supaya tambalan 0088 tidak tertimpa).

### Sisi klien

- `src/hooks/useAppSettings.ts` — `usePaymentChannels()` → `{ channels, isChannelOn, antarpayOn, nonCashOn, cashOn, loaded }`.
  **Gagal-tertutup** seperti `useAntarPay()`: saluran non-tunai hanya aktif bila server tegas mengirim `true`.
- `src/components/BookingSheet.tsx` (`PaymentSection`): hanya saluran aktif yang ditawarkan; metode terpilih
  otomatis pindah ke saluran pertama yang masih dibuka; e-wallet pilihan yang dimatikan digeser ke yang aktif;
  bila semua non-tunai mati → hanya Tunai + catatan kecil.
- `src/components/PaymentMethods.tsx` (tab Metode): baris Tunai/AntarPay/E-wallet dan kartu e-wallet mengikuti
  saluran aktif; **kartu e-money NFC hanya muncul bila saluran `emoney_nfc` aktif**.
- `src/store/payprefs.ts` — `PAYMENT_CHANNELS` (kunci, label, ikon, warna), `GATEWAY_CHANNELS`, `channelLabel()`.

### Catatan & risiko

- Setelah 0089 diterapkan, `request_topup` dengan metode `bank_transfer` (transfer manual + bukti) **ditolak**
  sampai admin menyalakan saluran `bank_transfer`, karena semua saluran gateway default nonaktif.
- Pada pemasangan pertama, `pg_methods` dikosongkan agar tidak bertabrakan dengan daftar saluran
  (tidak ada saluran gateway yang aktif → tidak ada metode Snap yang aktif). Nyalakan lagi dari Panel Admin.
- Order berbayar e-wallet tetap memotong saldo AntarPay (gateway hanya menutup kekurangan); 0089 hanya
  memeriksa saluran e-wallet yang dipakai, **bukan** saluran `antarpay` sekaligus — sesuai pemetaan di atas.

## Bayar per pesanan lewat gateway, terpisah dari AntarPay (migrasi 0104)

Sakelar `app_settings.gateway_order_payment_enabled` (default **false**), diubah hanya lewat
`admin_set_gateway_order_payment(p_enabled)` (is_admin + PIN, audit `gateway_order_payment.toggle`).

**Alasannya.** PKS Midtrans (M568767786_825925, Ver.Aug-26) **Pasal 7 ayat 4(b)**: fitur uang elektronik /
dompet elektronik (stored value, isi saldo) yang membutuhkan izin Bank Indonesia tanpa izin itu → Midtrans
berhak menghentikan layanan. Karena itu **top up AntarPay tetap nonaktif** sampai ada izin/review legal. Menagih
**satu pesanan** lewat gateway (`purpose='order'`, 0100) lain halnya: dana langsung untuk transaksi itu, tidak
disimpan sebagai saldo → bukan stored value. Sakelar ini membuka jalur itu **tanpa** menyalakan AntarPay.

| | sakelar mati (default) | sakelar menyala |
|---|---|---|
| order `paid_via` = gopay/qris/VA/… saat AntarPay mati | ditolak "AntarPay sedang dinonaktifkan…" (perilaku 0088, e2e S54) | diterima → `awaiting_payment` → Snap per order → webhook → `searching` |
| syarat saluran | `payment_channel_require` (0089: global → `antarpay` → saluran) | `payment_channel_require_order`: cukup sakelar saluran itu sendiri |
| order saldo (`wallet`), top up, pencairan, travel | diatur sakelar AntarPay | **tetap** diatur sakelar AntarPay |

Klien membaca `app_public_settings()` / `gateway_public_config()` → `gateway_order_payment_enabled` dan
`order_payment_channels` (saluran yang boleh untuk membayar pesanan), di samping `payment_channels` (saldo/top up).

Catatan risiko: pesanan gateway yang dibatalkan **setelah** dibayar direfund ke saldo AntarPay (closed-loop, 0100).
Saat AntarPay mati saldo itu tidak bisa dipakai pelanggan; refund ke sumber dana (API refund Midtrans) belum ada.

## Uji

- `npx tsc --noEmit` = 0 error.
- `supabase/tests/simulasi_e2e.sql`: S0 menyalakan AntarPay untuk simulasi (dengan PIN admin), S54 menguji
  off → `request_topup` / `create_order` wallet & gopay / `request_withdrawal` / `travel_request_create`
  ditolak dengan pesan, order tunai + pembatalannya tetap sukses, saldo tidak tersentuh; on → top up sukses;
  lalu dikembalikan ke nonaktif. Seluruh simulasi berjalan dalam satu transaksi yang di-ROLLBACK.
- Migrasi 0088 punya penjaga akhir: gagal keras bila ada satu pun dari 5 fungsi yang belum bergerbang.
- 0089: S0 menyalakan semua saluran untuk simulasi (setelan asli disimpan), **S55** menguji saluran `cash`
  aktif → order tunai sukses; global ON tetapi saluran `gopay` OFF → order `paid_via = gopay` ditolak dengan
  pesan menyebut **GoPay**; saluran `antarpay` OFF → order dompet ditolak; saluran `bank_transfer` OFF → top up
  ditolak; tanpa PIN / kunci asing / non-admin ditolak; lalu **seluruh setelan dikembalikan ke kondisi awal**.
- Migrasi 0089 punya dua penjaga akhir: gagal keras bila ada satu pun dari 4 jalur (`create_order`,
  `travel_book`, `travel_request_create`, `request_topup`) yang belum bergerbang, atau bila
  `app_public_settings` / `gateway_public_config` belum mengirim `payment_channels`.
