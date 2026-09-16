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

## Uji

- `npx tsc --noEmit` = 0 error.
- `supabase/tests/simulasi_e2e.sql`: S0 menyalakan AntarPay untuk simulasi (dengan PIN admin), S54 menguji
  off → `request_topup` / `create_order` wallet & gopay / `request_withdrawal` / `travel_request_create`
  ditolak dengan pesan, order tunai + pembatalannya tetap sukses, saldo tidak tersentuh; on → top up sukses;
  lalu dikembalikan ke nonaktif. Seluruh simulasi berjalan dalam satu transaksi yang di-ROLLBACK.
- Migrasi 0088 punya penjaga akhir: gagal keras bila ada satu pun dari 5 fungsi yang belum bergerbang.
