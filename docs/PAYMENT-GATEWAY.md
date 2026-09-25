# Payment Gateway AntarKita — rekomendasi & panduan plug-and-play (Midtrans)

## Rekomendasi (riset Sep 2026)
| | Midtrans (GoTo) | Xendit | DOKU |
|---|---|---|---|
| QRIS | 0,7% | 0,7% | 0,7% |
| E-wallet (GoPay/ShopeePay/OVO/DANA) | 1,5–2% | 1,5–2% | custom |
| Virtual Account bank | Rp4.000/trx | Rp4.000/trx | Rp3.500–4.500 |
| Kartu kredit | 2,9% + Rp2.000 | 2,9% + Rp2.500 | negosiasi |
| Settlement | T+1 s.d. T+3 | T+1 s.d. T+2 | T+1 s.d. T+5 |
| Cocok untuk | startup/e-commerce, dokumentasi Indonesia lengkap, onboarding cepat | SaaS/langganan, API developer-friendly | enterprise/volume tinggi |

**Pilihan: Midtrans Snap** — biaya setara pesaing, GoPay native (pasar Gojek), dokumentasi Indonesia, akun perorangan bisa aktif cepat, dan integrasinya sudah selesai di AntarKita (Edge Function + webhook + panel admin). Xendit disiapkan sebagai alternatif kedua bila suatu hari perlu (struktur `payments`/`payment_settle` tidak bergantung provider).

Model pembayaran AntarKita: semua pesanan dibayar dari **saldo AntarVoucher** (wallet). Gateway dipakai untuk **top up** (atau "bayar kekurangan saldo" otomatis saat memesan). Ini menyederhanakan refund/selisih belanja (AntarMarket/AntarShop), tip, dan pembatalan — semuanya mutasi wallet di dalam sistem.

## Plug-and-play: 6 langkah agar transaksi asli aktif
1. **Daftar Midtrans** di dashboard.midtrans.com (email bisnis, nomor HP aktif).
2. **Verifikasi bisnis** (unggah lewat banner aktivasi di dashboard):
   - Perorangan: KTP pemilik + NPWP.
   - Badan usaha (PT/CV): akta pendirian & perubahan + SK Kemenkumham, KTP & NPWP direktur, NPWP perusahaan, NIB/izin usaha.
   - Rekening bank atas nama pemilik/perusahaan untuk settlement.
3. **Aktifkan metode** di dashboard: GoPay, ShopeePay, QRIS, VA bank (BCA/BNI/BRI/Mandiri/Permata/CIMB), kartu. OVO & DANA dilayani lewat QRIS (pelanggan memindai dari aplikasi masing-masing).
4. **Salin kunci**: Settings → Access Keys → *Server Key* & *Client Key* (Sandbox dulu: `SB-Mid-server-…` / `SB-Mid-client-…`).
5. **Isi di aplikasi**: Panel Admin → **Payment Gateway** → tempel Server Key & Client Key, pilih mode Sandbox, pilih metode aktif → Simpan → **Uji koneksi** (harus "Kunci valid"). Kunci disimpan di tabel `gateway_secrets` (RLS tanpa policy; hanya Edge Function/service role yang bisa membaca). Alternatif tanpa panel: `supabase secrets set MIDTRANS_SERVER_KEY=… MIDTRANS_CLIENT_KEY=… MIDTRANS_IS_PRODUCTION=false`.
6. **Set Payment Notification URL** di dashboard Midtrans → Settings → Configuration:
   `https://qwltshvzrsykxdvhbxcv.supabase.co/functions/v1/midtrans-webhook`
   Lalu uji top up Rp10.000 dari aplikasi pelanggan (Sandbox: gunakan simulator Midtrans). Setelah lancar, ganti kunci ke Production & mode Production.

## Alur teknis
- App → `midtrans-create` (Edge Function, JWT) → catat `payments` (pending) → Snap `POST /snap/v1/transactions` → `snap_token` + `redirect_url`.
  Web: popup **Snap.js** (client key) tanpa pindah tab; Android/iOS: buka `redirect_url` (browser), status dipantau otomatis (polling tabel `payments`).
- Midtrans → `midtrans-webhook` (tanpa JWT; verifikasi `signature_key` = SHA-512(order_id+status_code+gross_amount+server_key)) → `payment_settle()` → `wallet_apply(topup)` + notifikasi ke pengguna.
- Tanpa server key: **mode simulasi** (tombol "Bayar (simulasi berhasil)") agar alur tetap bisa diuji.
- Pengaturan publik (`gateway_public_config`): metode aktif, batas top up, client key, mode. Admin (`admin_gateway_status`/`admin_set_gateway`): status tersamar, statistik, 30 transaksi terakhir, uji koneksi.

## Yang belum otomatis
- Refund ke rekening/e-wallet asal (saat ini refund = kembali ke saldo AntarVoucher). Refund keluar via dashboard Midtrans manual.
- Pencairan (payout) ke driver/merchant masih lewat menu Tarik Saldo yang disetujui admin (transfer manual). Midtrans Payout/Iris bisa ditambahkan setelah volume cukup.
- Kartu kredit memerlukan aktivasi terpisah (3DS) oleh Midtrans; e-money NFC (Flazz/e-Money) tidak didukung gateway online.
