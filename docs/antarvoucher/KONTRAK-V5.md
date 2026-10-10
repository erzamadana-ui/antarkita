# KONTRAK AntarVoucher v5 — Model Closed-Loop Penuh (tanpa payment gateway)

Tanggal: 10 Okt 2026 · Branch `antarvoucher-v5` · Lead: CTO Agent · Status: SPESIFIKASI MENGIKAT untuk semua agen (DB, Pelanggan, Mitra, Admin, Landing/Docs, Finance). Nama RPC/kolom/setting di sini = sumber kebenaran; bila agen perlu mengubah nama, tulis di bagian "Perubahan kontrak" di akhir laporan agen.

## 0. Keputusan pemilik (10 Okt 2026, kata-kata Erza, diringkas)
1. Perusahaan **tidak memegang uang pelanggan** sebagai dompet terbuka (tidak ada izin PJP). Yang boleh: pelanggan **membeli voucher** dari AntarKita, dipakai untuk membayar layanan; **driver/mitra travel membeli voucher** untuk bisa mengambil order (deposit komisi).
2. **Kode voucher di-generate aplikasi**; uang masuk ke **rekening bank perusahaan** (transfer manual, bukan gateway).
3. **Pencairan (withdrawal) by request, otomatis, SLA 1×24 jam.**
4. Tujuan: menghapus beban persentase payment gateway & biaya tambahan. **Komposisi potongan per transaksi = pajak transaksi + fee AntarKita saja.**
5. **COGS pegawai & biaya lain dibebankan ke transaksi**; ada **target transaksi** untuk manajer/direktur operasional & keuangan.
6. Berlaku di **landing page, app pelanggan, app mitra, panel admin**; divalidasi awal → akhir.

Catatan regulasi (dari `RISET-MAXIM-DAN-REGULASI-VOUCHER.md`): regulator uang elektronik = **Bank Indonesia** (bukan OJK). Voucher prabayar yang hanya bisa dipakai di AntarKita = **UE closed loop**; **tidak perlu izin PJP selama total dana float (semua saldo voucher pelanggan + mitra) < Rp1 miliar** (PADG 32/2025 Ps. 21), wajib manajemen risiko + pelindungan konsumen, BI tetap bisa minta informasi. Karena itu v5 WAJIB punya pemantau float + batas saldo per pengguna + S&K closed loop. Opini hukum tertulis tetap disarankan (OWNER).

## 1. Setting baru/diubah (`app_settings`, semua lewat `admin_set_settings` PIN; nilai = [ASUMSI] kecuali ditandai)
| key | default | arti |
|---|---|---|
| `payment_mode` | `'voucher_only'` | `voucher_only` = hanya `cash` & `wallet` (AntarVoucher); `gateway` = perilaku lama. Guard di `create_order`, `travel_book`, `travel_request_create`, `request_topup`, `payment_channels_public`, edge pay-*/midtrans-create (tolak 409 `PAYMENT_MODE_VOUCHER_ONLY`). |
| `antarvoucher_purchase_enabled` | `true` di v5 (prod masih false → diubah hanya setelah APPROVED) | pembelian voucher via transfer |
| `voucher_denominations` | `[20000,50000,100000,200000,500000,1000000]` | nominal yang ditawarkan UI; server tetap menerima nominal bebas dalam batas min/max |
| `voucher_min_nominal` / `voucher_max_nominal` | `20000` / `2000000` | batas satu pembelian |
| `voucher_balance_cap_customer` / `voucher_balance_cap_partner` | `2000000` / `5000000` | batas saldo per pengguna (pelindungan konsumen; meniru KasPro reguler) |
| `voucher_float_limit` | `1000000000` | ambang BI PADG 32/2025 Ps. 21 [FAKTA SUMBER] |
| `voucher_float_alert_pct` | `65` | alarm ke admin bila Σ saldo beredar ≥ 65 % ambang |
| `voucher_code_ttl_hours` | `720` (30 hari) | kode terbit tapi belum di-redeem kedaluwarsa |
| `voucher_auto_redeem` | `true` | setelah pembayaran diverifikasi, kode langsung di-redeem ke saldo pembeli (kode tetap ditampilkan sebagai bukti) |
| `driver_deposit_required` | `true` | driver/mitra travel wajib saldo ≥ `driver_min_balance_accept` untuk `driver_accept_order`/`driver_set_online`/`travel_*` |
| `driver_min_balance_accept` | `0` | saldo minimum menerima order (deposit); komisi order tunai dipotong dari saldo (0033) sehingga saldo turun → beli voucher lagi |
| `driver_debt_limit` | `0` bila deposit_required (sebelumnya −50.000) | saldo tidak boleh minus |
| `ppn_pct` | `11` | PPN atas pendapatan platform [ASUMSI tarif, konfirmasi konsultan] |
| `ppn_inclusive` | `true` | PPN sudah termasuk dalam biaya layanan yang ditampilkan (pelanggan tidak melihat tambahan) |
| `pph_partner_pct` | `0` | pemotongan PPh atas pembayaran ke mitra — default 0, aktifkan hanya setelah keputusan pajak |
| `payout_sla_hours` | `24` (sudah ada 0102) | SLA pencairan sejak request |
| `payout_batch_cutoffs` | `["10:00","15:00"]` WIB | jam pembuatan batch transfer |
| `auto_payout_enabled`/`auto_payout_max`/`auto_payout_daily_max` | `true`/`1000000`/`5000000` | auto-approve request ≤ batas (sudah ada 0019; nilai dinaikkan) |
| `payout_fee_per_withdrawal` | `0` | biaya transfer (bila bank mengenakan, isi) |
| `cogs_margin_target_pct` | `30` | margin di atas COGS/order untuk rekomendasi biaya layanan |

## 2. Skema DB (migrasi `0114_antarvoucher_v5_closed_loop.sql`, idempoten; rollback `0114_down.sql`)
- `voucher_codes(id, code text unique, nominal bigint, status text check in ('pending_payment','issued','redeemed','expired','void'), purchase_id → voucher_purchases, buyer_id, redeemed_by, issued_at, redeemed_at, expires_at, created_at)`. Kode format `AKV-XXXX-XXXX-XXXX` (alfabet Crockford tanpa 0/O/1/I, `gen_random_bytes`). RLS: pemilik (buyer/redeemed_by) SELECT; admin via RPC.
- `voucher_purchases` + kolom `code_id`, `buyer_role` ('customer'|'partner').
- `city_targets(city_id, month date (hari 1), target_orders int, target_npr bigint, target_active_drivers int, target_active_merchants int, pic_ops text, pic_finance text, note, updated_by, updated_at)` PK (city_id, month). RLS admin.
- `withdrawal_requests` + `sla_due_at timestamptz`, `batch_id uuid`. Tabel `payout_batches(id, created_at, created_by, cutoff, status 'open'|'exported'|'settled', total bigint, count int, exported_at, settled_at)`.
- `wallet_transactions.kind` baru bila belum ada: `'voucher_redeem'`. Ledger: `tax_output` diposting di `ledger_calc` = round(R × ppn/(100+ppn)) bila `ppn_inclusive` (R = platform_revenue sebelum pajak); `platform_revenue` tetap kotor, laporan menampilkan `platform_revenue_net = R − tax_output`.

## 3. RPC (SECURITY DEFINER, `set search_path`, grant eksplisit, revoke dari PUBLIC/anon kecuali ditandai)
| RPC | Pemanggil | Perilaku |
|---|---|---|
| `voucher_code_purchase_create(p_nominal bigint, p_bank_code text, p_idempotency_key text)` → jsonb `{purchase, code}` | authenticated | pengganti `voucher_purchase_create` (yang lama tetap ada, memanggil ini). Validasi mode, flag, nominal, cap saldo (saldo + nominal ≤ cap peran), float (Σ beredar + nominal ≤ limit). Membuat `voucher_purchases` (awaiting_transfer) + `voucher_codes` (pending_payment). |
| `my_voucher_codes()` | authenticated | daftar kode milik pemanggil + status |
| `voucher_code_redeem(p_code text)` → wallet_transactions | authenticated | kode `issued` & belum kedaluwarsa → `wallet_apply(auth.uid(),'voucher_redeem', nominal)`; cek cap saldo; set `redeemed`. Rate-limit `rate_take('voucher_redeem', 10/jam)`. |
| `admin_voucher_approve(p_purchase, p_note)` (UBAH, 0112) | admin finance (checker ≠ maker) | selain `issued` pembelian: set kode `issued`, `issued_at`, `expires_at = now()+ttl`; bila `voucher_auto_redeem` → langsung `voucher_code_redeem` atas nama pembeli (kind `voucher_redeem`, bukan `topup`). |
| `voucher_expire_due()` (UBAH) | cron | + kode `issued` lewat `expires_at` → `expired` (saldo tidak terpengaruh; hanya kode yang belum di-redeem). |
| `voucher_float_status()` → jsonb `{total_outstanding, customers, partners, limit, pct, alert, cap_customer, cap_partner, updated_at}` | admin, exec | Σ `wallets.balance` > 0 (pelanggan & mitra) |
| `voucher_public_config()` → jsonb | anon, authenticated | `{payment_mode, purchase_enabled, denominations, min, max, cap_customer, cap_partner, code_ttl_hours, banks: voucher_bank_accounts_public()}` — dipakai 3 app & landing |
| `admin_set_payment_mode(p_mode text)` | admin superadmin + PIN | set `payment_mode`; bila `voucher_only` → `payment_channels` gopay/shopeepay/qris/ovo/dana/bank_transfer/card = false, `gateway_order_payment_enabled=false`, `antarpay_enabled=true`, `antarvoucher_enabled=true`; log_activity + security_events. |
| `admin_set_tax_settings(p jsonb)` | admin finance + PIN | `ppn_pct`, `ppn_inclusive`, `pph_partner_pct` dengan validasi 0–30 |
| `tax_settings_public()` | anon | `{ppn_pct, ppn_inclusive}` untuk label "termasuk PPN" |
| `driver_deposit_status()` → jsonb `{required, min_balance, balance, can_accept, shortfall}` | authenticated (driver/travel) | dipakai app Mitra untuk banner "Beli AntarVoucher" |
| `driver_accept_order`, `driver_set_online`, `travel_accept_send`, `travel_offer_create` (UBAH, splice) | — | guard: bila `driver_deposit_required` dan saldo < `driver_min_balance_accept` → `raise exception 'DEPOSIT_REQUIRED: saldo AntarVoucher minimal Rp%'`. |
| `admin_set_city_fixed_cost` (ADA 0102) | — | tidak berubah |
| `admin_set_city_targets(p jsonb)` | admin ops/finance + PIN | upsert `city_targets` (city_id, month, target_orders, target_npr, target_active_drivers, target_active_merchants, pic_ops, pic_finance) |
| `city_targets_progress(p_month date)` → setof jsonb per kota | admin, exec | realisasi bulan berjalan (orders completed, NPR = platform_revenue − tax − promo platform, driver aktif ≥10 order, merchant aktif ≥5) vs target; `pct_orders`, `pct_npr`, `status` ('on_track' ≥ 100 % pro-rata hari, 'at_risk' 80–100, 'behind' < 80); `cogs_per_order = Σ city_fixed_costs(month) / greatest(target_orders,1)`; `cogs_per_order_actual = Σ / greatest(realisasi,1)`; `platform_fee_recommended = ceil((cogs_per_order × (1+margin)) / 500) × 500`. |
| `request_withdrawal` (UBAH, splice) | mitra | set `sla_due_at = now() + payout_sla_hours`; bila auto-approve lolos → status approved tetap menunggu batch. |
| `admin_payout_batch_create()` → payout_batches | admin finance + PIN | kumpulkan semua `withdrawal_requests` status approved tanpa batch → batch `open`, hitung total |
| `admin_payout_batch_export(p_batch uuid)` → setof (withdrawal_id, user_id, nama, bank_code, account_no, amount, note) | admin finance | baris untuk CSV transfer massal bank (klien yang membentuk CSV: `src/lib/csv.ts`); set `exported` |
| `admin_payout_batch_settle(p_batch uuid, p_refs jsonb)` | admin finance + PIN | `p_refs = [{withdrawal_id, bank_ref, status:'ok'|'failed', reason}]` → `admin_mark_withdrawal_settled` per baris; gagal → `rejected` + refund saldo; batch `settled` |
| `payout_sla_check()` | cron tiap 15 mnt | request `pending/approved` dengan `sla_due_at < now()` → `security_events('payout.sla_breach')` + `notifications` ke admin finance (sekali per request) |
| `admin_payout_queue()` → setof jsonb | admin finance | antrean dengan `sla_remaining_min`, `overdue` |
| `v_city_target_progress` (view) | admin/exec | wrapper `city_targets_progress(date_trunc('month', now()))` |

Dihapus/diblokir di mode voucher_only (bukan di-drop): `request_topup` via gateway → `raise 'PAYMENT_MODE_VOUCHER_ONLY'`; `order_payment_prepare` → sama; edge `midtrans-create`/`pay-create` → 409.

## 4. Klien (nama layar & komponen)
Pelanggan (`src/screens/...`): `pay/voucher.tsx` (beli: pilih nominal → kode + instruksi transfer + tombol "Sudah transfer" + daftar kode saya + redeem kode hadiah), `pay/topup.tsx` (redirect ke voucher), `pay/gateway.tsx` (tampil "tidak tersedia" di voucher_only), `components/PaymentMethods.tsx` (hanya Tunai & AntarVoucher saat voucher_only; label saldo), checkout semua layanan (rincian: ongkir, barang, **"Biaya layanan AntarKita (termasuk PPN 11 %)"** — tidak ada baris biaya pembayaran), `pay/history.tsx` (kind `voucher_redeem` → "Voucher"), `hooks/useAppSettings.ts` (+`paymentMode`, `voucherConfig` dari `voucher_public_config`), i18n 4 bahasa untuk kunci baru.
Mitra: `driver/tabs/index.tsx` (banner deposit dari `driver_deposit_status`, tombol "Beli AntarVoucher" → `pay/voucher`), `driver/tabs/earnings.tsx` & `mitra/finance.tsx` (rincian: fee AntarKita, PPN, bersih; SLA pencairan), `pay/withdraw.tsx` (tampil "diproses ≤ 24 jam", `sla_due_at`, status batch), `driver/travel.tsx` & vendor/merchant earnings sama.
Admin: `admin/settings.tsx` (kartu "Mode pembayaran", "Pajak", "AntarVoucher: nominal, cap, float"), `admin/voucher.tsx` (+ tab Kode, + kartu Float dengan alarm), `admin/finance.tsx` (antrean pencairan + SLA + "Buat batch" + "Unduh CSV" + "Tandai selesai"), `admin/city-costs.tsx` (+ target per kota, PIC, progres, COGS/order, rekomendasi biaya layanan), `admin/economics.tsx` (tampilkan rekomendasi), `exec/*` (kartu float + progres target), `admin/gateway.tsx` (banner mode voucher_only).
Landing (`antarkita-landing`): bagian "Cara bayar": Tunai atau AntarVoucher (beli via transfer ke rekening PT Antar Kita Indonesia, kode terbit otomatis, saldo tidak berbunga, closed loop, bisa refund sisa saldo sesuai S&K); hapus klaim GoPay/QRIS/e-wallet; untuk mitra: "Deposit AntarVoucher untuk menerima order, pencairan ≤ 24 jam".
S&K (`docs/rilis/terms.html`): pasal AntarVoucher closed loop (sifat, batas saldo, kedaluwarsa kode, refund sisa saldo, dormant, salah transfer, bukan simpanan/bukan uang elektronik berizin, float dipantau), pasal pencairan 24 jam, hapus klausul biaya pembatalan ATAU tandai "belum berlaku" (keputusan D15 masih terbuka → tandai belum berlaku).

## 5. Rumus uang v5 (per order, dari `ledger_calc` + pajak)
```
Gross pelanggan G = ongkir + barang + biaya layanan (PF) + tambahan − promo
Driver   = ongkir − komisi ongkir (ride/box saja) + tip + tambahan
Merchant = barang − fee merchant
Platform kotor R = PF + komisi + fee merchant + jasa belanja(porsi platform) + margin antar kota − promo platform
PPN (inclusive) T = round(R × ppn / (100 + ppn))            ← entry ledger tax_output
Platform bersih = R − T
Biaya PG = 0 (voucher_only)                                  ← tidak ada entry pg_fee
COGS/order (laporan, bukan ledger) = Σ biaya tetap kota bulan ÷ target order bulan
Contribution kota = Σ Platform bersih − Σ COGS realisasi
```
Contoh Ride motor Rp50.000 (PF 1.000, komisi 8 %): driver 46.000; R = 5.000; T = 495; bersih 4.505; pelanggan bayar 51.000 — tidak ada biaya pembayaran. Pencairan driver Rp46.000 → batch ≤ 24 jam, biaya 0.

## 6. Uji wajib (DB Agent menulis `supabase/tests/uji_antarvoucher_v5.sql`, dijalankan di harness lokal)
V5-01 mode voucher_only menolak paid_via gateway/gopay; menerima cash & wallet. V5-02 beli voucher → kode `pending_payment`, purchase awaiting_transfer. V5-03 approve (checker ≠ maker) → kode issued + auto-redeem → saldo naik, kind voucher_redeem, kode `redeemed`. V5-04 redeem ulang kode → ditolak. V5-05 cap saldo pelanggan → pembelian ke-n ditolak. V5-06 float limit → ditolak + `voucher_float_status.alert`. V5-07 kode kedaluwarsa (ttl) → expired, saldo tetap. V5-08 driver saldo 0 & deposit_required → accept ditolak DEPOSIT_REQUIRED; setelah redeem voucher → diterima. V5-09 order tunai selesai → komisi dipotong saldo driver (0033) → saldo turun; ledger punya `tax_output` = round(R×11/111) dan tidak ada `pg_fee`; balance check lulus. V5-10 request_withdrawal → `sla_due_at` = +24 jam; auto-approve ≤ batas; batch create → export → settle(ok) → settled; settle(failed) → rejected + saldo kembali. V5-11 payout_sla_check → event sla_breach saat due lewat. V5-12 city_targets upsert + progress: cogs_per_order, pct, status, platform_fee_recommended. V5-13 request_topup gateway → PAYMENT_MODE_VOUCHER_ONLY. V5-14 admin_set_payment_mode('gateway') mengembalikan saluran (reversibel). V5-15 PPh 0 → tidak ada entry; set 2 → entry `tax_output` kedua berlabel pph (meta) [opsional].
Simulasi lama (`simulasi_e2e.sql` S0–S55, `uji_skema_bisnis_v2`, `uji_antarvoucher`) wajib tetap lulus (harness `scripts/db-lokal.sh`).

## 7. Perubahan kontrak
(agen menulis di sini bila terpaksa menyimpang — Lead menyetujui saat integrasi)

### DB Agent (0114) — 10 Okt 2026
1. **Arah pemanggilan pembelian dibalik**: `voucher_code_purchase_create` memanggil `voucher_purchase_create` (0112, ditambal: cap saldo + float + kunci `voucher_min/max_nominal`) lalu membuat `voucher_codes`. RPC lama tetap bekerja untuk APK lama (tanpa kode → saat disetujui tetap kredit `topup` seperti 0112; hanya pembelian ber-kode yang memakai kind `voucher_redeem`). Alasan: `uji_antarvoucher.sql` S10/S21 mengandaikan jalur 0112 utuh.
2. **Kunci `voucher_purchase_min/max` (0112) digantikan `voucher_min_nominal/max_nominal`** di `voucher_purchase_create` & `voucher_status_public` (tambalan, nilai default sama).
3. **`platform_revenue` tetap kotor** (sesuai §2) — supaya `ledger_check` (0106: alokasi = … + platform_revenue + tax_output) tetap seimbang, entry `tax_output` PPN inklusif diberi `funded_by='inclusive'` dan **tidak** ditambahkan ke alokasi (`ledger_check` ditambal: `+ tax − tax_incl − tax_pph`). `ledger_check` & `ledger_calc` mengembalikan `platform_revenue_net`, `tax_inclusive`.
4. **PPh mitra = MEMO** (`tax_output` `funded_by='pph'`, party driver), tidak mengurangi `driver_payable`/saldo mitra sampai keputusan pajak (OWNER). V5-15 lulus dalam bentuk memo.
5. **NPR** di `city_targets_progress` = Σ`platform_revenue` − Σ`tax_output`(inclusive); promo platform TIDAK dikurangkan lagi karena `platform_revenue` 0099 sudah dikurangi `promo_platform` (menghindari hitung ganda). Kolom `promo_platform` tetap dikembalikan.
6. **`ppn_inclusive=false` belum didukung** (butuh perubahan harga ke pelanggan): bila false, tidak ada entry `tax_output`.
7. **`voucher_float_status(p_exec_token text default null)` & `city_targets_progress(p_month, p_exec_token)`** — parameter token eksekutif (`exec_valid`) ditambahkan agar portal exec bisa memanggil; `null` = admin.
8. **`admin_set_payment_mode`** menyimpan snapshot saluran di `app_settings.payment_mode_snapshot` sebelum ke `voucher_only` dan memulihkannya saat kembali `gateway` (V5-14). `payment_mode`, `ppn_*`, `pph_partner_pct` masuk daftar *protected* `admin_set_settings`.
9. **Deposit**: dengan `driver_min_balance_accept=0` (default §1) saldo 0 TETAP boleh menerima order; V5-08 diuji dengan `driver_min_balance_accept=20000`. OWNER menentukan nilai produksi.
10. **Edge functions** (`pay-create`, `midtrans-create`): setting `payment_mode` **tidak ada** → perilaku lama (pra-v5), supaya tes edge yang ada tetap lulus; di DB `payment_mode()` default `voucher_only`. Tidak ada celah: `order_payment_prepare` (DB) tetap menolak.
11. **Migrasi** menulis `payment_mode='voucher_only'`, `driver_debt_limit=0`, `auto_payout_max=1jt`, `auto_payout_daily_max=5jt` HANYA bila `payment_mode` belum ada (pemasangan pertama; nilai lama dicadangkan di `_migration_backup_settings`). `antarvoucher_purchase_enabled` tidak disentuh (prod tetap false sampai APPROVED).
12. **Uji lama** (`simulasi_e2e`, `uji_skema_bisnis_v2`, `uji_antarvoucher`) diberi satu baris fixture `-- 0114 v5` di S0 (`payment_mode='gateway'`, `driver_deposit_required=false`, `driver_debt_limit=-500000`, dalam transaksi yang di-ROLLBACK) karena berkas itu memang menguji mode gateway & batas minus lama.
