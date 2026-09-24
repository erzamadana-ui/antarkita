# KONTRAK API v3 — Finpay, Ledger, Iklan, RBAC (branch `finpay-v3`)

Dokumen ini adalah **satu-satunya sumber kebenaran** nama RPC/tabel/kolom untuk semua agen
(DB, edge function, app Pelanggan, app Mitra, Panel Admin). Basis: branch `skema-bisnis-v2`
(migrasi 0098–0104) — semua yang ada di sana tetap berlaku. Yang di bawah ini **ditambahkan**.
Semua RPC dipanggil `supabase.rpc('<nama>', {...})`. Bahasa UI: Indonesia.

Aturan umum:
- Nilai uang = `bigint` rupiah. Persen = `numeric` (8 = 8 %).
- Setiap RPC admin yang mengubah uang/aturan: `is_admin()` + `admin_require_unlock()` (PIN) + `log_activity`.
- Tulis tabel finansial/aturan HANYA lewat RPC (grant `update/insert/delete` ke `authenticated` DICABUT).
- Label sumber angka di seed: `[FAKTA-PUBLIK]`, `[KONTRAK]`, `[ASUMSI]`.

---

## 0. Prinsip bisnis (dikunci; sumber: dokumen vault Erza Sep 2026 + prompt 24 Sep 2026)
1. Ongkir = hak driver 100 % untuk food/send/shop/market; ride roda dua komisi ≤ 8 % (Perpres 27/2026); ride mobil ≤ 15 %; box ≤ 10 % [ASUMSI v2, kargo].
2. Pendapatan platform = fee merchant + biaya platform pelanggan + iklan + langganan/B2B.
3. 25 % = **target net take rate portofolio** tahap matang — bukan laba, bukan potongan driver.
4. Checkout WAJIB menampilkan baris terpisah: harga barang, ongkir, biaya platform AntarKita, biaya metode pembayaran (nama provider aktif), biaya tambahan, diskon/subsidi (+ penanggung), pajak (bila ada), total.
5. Biaya PG dibebankan ke pelanggan HANYA bila `payment_channel_fees.pass_to_customer=true` **dan** `pass_to_customer_legal_ok=true` (diisi admin setelah kajian legal/kontrak). QRIS: `pass_to_customer` DIKUNCI false (larangan surcharge BI). Default semua kanal: ditanggung platform (`funded_by='platform'`).
6. Tidak ada klaim laba 25 % di UI/dokumen.

## 1. Provider pembayaran & feature flag

### app_settings (kunci baru; ubah lewat `admin_set_settings` — masuk `business_setting_specs`)
| kunci | tipe | default | arti |
|---|---|---|---|
| `payment_provider_active` | text | `'midtrans'` | provider untuk **transaksi baru**: `midtrans` \| `finpay` |
| `payment_provider_env` | text | `'sandbox'` | `sandbox` \| `production` (Finpay: devo.finnet.co.id / live.finnet.co.id) |
| `payments_simulation_enabled` | bool | `false` | simulasi hanya bila true DAN env≠production DAN provider payment='simulated' |
| `refund_dual_approval_min` | bigint | `200000` | refund ≥ nilai ini butuh 2 admin berbeda |
| `wallet_adjust_dual_approval_min` | bigint | `100000` | penyesuaian saldo ≥ nilai ini butuh 2 admin |
| `disbursement_provider` | text | `'manual'` | `manual` \| `finpay` |
| `ads_frequency_cap_per_day` | int | `5` | maks impresi iklan yang sama per pengguna per hari |
| `ads_click_dedupe_minutes` | int | `30` | klik pengguna sama pada iklan sama dalam N menit tidak ditagih |

RPC publik (anon): `payment_provider_public()` → `{provider, env, simulation, channels:[{key,label,fee_label,fee_pct,fee_fixed,pass_to_customer,enabled}]}`.

### gateway_secrets — dikunci `(provider, env)`
Kolom: `provider text`, `env text default 'sandbox'`, `merchant_id text`, `server_key text` (Finpay: Merchant Key), `client_key text`, `callback_token text`, `extra jsonb`, `updated_at`, `updated_by`. PK `(provider, env)`.
Admin RPC: `admin_set_gateway_secret(p_provider, p_env, p_patch jsonb)` (PIN, nilai kunci TIDAK ke log — hanya 6 karakter awal/4 akhir), `admin_gateway_secrets()` → daftar tersamar.

### payment_channel_fees — versi per provider & effective date
Tambah kolom: `provider text not null default 'midtrans'`, `effective_from date not null default '2026-01-01'`, `pass_to_customer boolean default false`, `pass_to_customer_legal_ok boolean default false`, `source_label text` (`[FAKTA-PUBLIK]`/`[KONTRAK]`/`[ASUMSI]`), `note text`. PK baru `(provider, channel, effective_from)`.
Seed Finpay (`[FAKTA-PUBLIK]` finpay.id/biaya-transaksi, 9 Jul 2026; PPN belum jelas → `ppn_included=false` `[ASUMSI]`): `bank_transfer`=Rp3.500; `qris`=0,7 % (catatan: BI 0 % ≤Rp100.000 mulai 1 Okt 2026 → baris kedua `effective_from='2026-10-01'` dengan `fee_pct_under_100k=0` `[PERLU-KONFIRMASI-KONTRAK]`); `card`=2,3 %+Rp1.000; `gopay/shopeepay/ovo/dana/linkaja/finpay_money`=2 % `[ASUMSI: rentang publik 1,5–2 %]`; `retail_alfamart/retail_indomaret`=Rp5.000 `[ASUMSI]`; `paylater_kredivo/paylater_indodana`=2,3 % `[ASUMSI: batas atas rentang publik]`; `instant_payment`=Rp4.000.
`pg_fee_calc(p_channel, p_amount, p_provider default null, p_at default now())` — memilih baris `effective_from <= p_at` terbaru untuk provider aktif.
Admin: `admin_set_payment_channel_fee(p_provider, p_channel, p_effective_from, p_patch)`; `admin_payment_channel_fees(p_provider default null)`.

## 2. Tabel `payments` — kolom kanonik (kolom lama tetap, disinkronkan)
Tambah: `provider_ref text` (Finpay `order.id`/Midtrans order_id = `external_id`), `provider_txn_id text`, `checkout_url text`, `checkout_token text`, `qr_string text`, `payment_code text`, `expires_at timestamptz`, `paid_at timestamptz`,
`pay_status text not null default 'PENDING' check in ('PENDING','PAID','FAILED','EXPIRED','REFUND_REQUESTED','PARTIALLY_REFUNDED','REFUNDED','DISPUTED','RECONCILED')`,
`refunded_amount bigint default 0`, `reconciled_at timestamptz`, `support_ref text` (format `AK-<6 hex>` unik, ditampilkan ke pelanggan untuk CS).
Kolom lama `status` (`pending/settlement/expire/cancel/deny/failure`) tetap diisi lewat trigger dari `pay_status` (PAID→settlement, EXPIRED→expire, FAILED→failure, sisanya pending) supaya kode lama tidak rusak.

Tabel `orders` tambah: `settlement_status text default null check in ('ORDER_COMPLETED','PAYOUT_PENDING','PAYOUT_SETTLED','RECONCILED')`, `payment_support_ref text`.

### `payment_events` — inbox webhook, append-only
`id bigserial, provider text, event_id text, external_id text, payment_id uuid, event_type text, provider_status text, amount bigint, signature_ok boolean, raw jsonb, received_at timestamptz, processed_at timestamptz, result text, unique(provider, event_id)`. Trigger menolak UPDATE selain `processed_at/result`, menolak DELETE. Admin baca: `admin_payment_events(p_external_id)`.

### RPC pembayaran (service_role — dipanggil edge function; `revoke from authenticated`)
- `payment_intent_create(p_user uuid, p_purpose text, p_order uuid, p_amount bigint, p_channel text, p_provider text) → payments row` — idempoten per `(order_id, pay_status='PENDING')`: bila sudah ada intent PENDING yang belum kedaluwarsa, kembalikan yang sama (unique partial index `payments_one_pending_per_order`). Cek kepemilikan order = p_user, status order `awaiting_payment`, `payment_channel_require_order`.
- `payment_event_ingest(p_provider, p_event_id, p_external_id, p_provider_status, p_amount, p_signature_ok, p_raw) → {duplicate bool, applied bool, pay_status, note}` — satu transaksi: insert inbox (duplikat → `duplicate=true`, tidak diproses), `select … for update` payment, terapkan mesin status (lihat §3), panggil `payment_settle` internal, tulis ledger. Out-of-order: status terminal (PAID/REFUNDED/EXPIRED/FAILED) tidak boleh mundur ke PENDING; PAID setelah EXPIRED → terapkan PAID + tandai `note='late_paid'` (uang masuk tetap dicatat; order sudah kadaluarsa → otomatis `refund_requests` full dengan alasan `late_payment`).
- `payment_mark_reconciled(p_payment uuid, p_run uuid)`.

### RPC pelanggan
- `order_payment_prepare(p_order, p_channel)` (ada di v2) — v3: mengembalikan juga `pg_fee_customer` (0 bila ditanggung platform), `provider`, `support_ref`.
- `my_payment_status(p_order uuid) → {pay_status, provider, channel, checkout_url, qr_string, payment_code, expires_at, paid_at, amount, support_ref, refunded_amount}` (pemilik saja).
- `my_payment_history(p_limit int default 50)` → daftar pembayaran (order/topup) + `support_ref`.
- `my_receipt(p_order uuid)` → jsonb rincian lengkap (semua baris §0.4 + `refundable_note`: teks komponen yang bisa/tidak bisa dikembalikan).

## 3. Mesin status (kanonik)
`PENDING → PAID | FAILED | EXPIRED`; `PAID → REFUND_REQUESTED → PARTIALLY_REFUNDED | REFUNDED`; `PAID → DISPUTED → (REFUNDED|PAID)`; `PAID/… → RECONCILED` (flag terpisah `reconciled_at`, tidak menimpa). Pemetaan Finpay: `PAID/CAPTURED→PAID`, `PENDING/AUTHORIZED→PENDING`, `FAILURE→FAILED`, `EXPIRED→EXPIRED`, `CANCELLED→FAILED`, `REFUNDED→REFUNDED`, `PARTIALLY_REFUNDED→PARTIALLY_REFUNDED`. Midtrans: `settlement/capture(accept)→PAID`, `expire→EXPIRED`, `deny/cancel/failure→FAILED`, `refund→REFUNDED`, `partial_refund→PARTIALLY_REFUNDED`, `chargeback→DISPUTED`.
Order: `awaiting_payment` → (PAID) `pending` … `completed` → `settlement_status='ORDER_COMPLETED'` → saat `driver_payable/merchant_payable` masuk `withdrawal_requests` → `PAYOUT_PENDING` → `admin_mark_withdrawal_settled` → `PAYOUT_SETTLED` → job rekonsiliasi → `RECONCILED`.

## 4. Refund, dispute, dual approval
### `refund_requests`
`id uuid, order_id, payment_id, requested_by uuid, amount bigint, kind text ('full'|'partial'), reason text, destination text ('gateway'|'wallet'), status text ('requested','approved','executing','done','failed','rejected'), maker uuid, checker uuid, provider_ref text, created_at, decided_at, executed_at, note`.
- Pelanggan: `refund_request(p_order, p_amount default null, p_reason)` — hanya bila order dibatalkan/ditolak dan sudah PAID; `amount` null = full. Komponen yang tidak dikembalikan (ditentukan `refund_policy` per fase order: sebelum merchant terima = 100 %; setelah diproses = barang tidak kembali, ongkir dikembalikan bila driver belum ambil; biaya platform dikembalikan; biaya PG yang dibebankan ke pelanggan TIDAK dikembalikan bila provider tidak mengembalikan) → fungsi `refund_policy_calc(p_order) → {refundable, non_refundable, lines:[{label, amount, refundable}]}` (dipakai UI pelanggan & admin).
- Admin: `admin_refund_approve(p_id)` (maker), bila `amount >= refund_dual_approval_min` butuh `admin_refund_confirm(p_id)` oleh admin lain (checker ≠ maker) → status `approved`; edge function `pay-refund` mengeksekusi ke provider → `payment_event_ingest` menutup jadi `done`. `destination='wallet'` (fallback bila provider tidak mendukung) menulis `wallet_apply('refund')`.
- Ledger: baris `refund` negatif + pembalikan `platform_revenue/driver_payable/merchant_payable` pro-rata pada `phase='refunded'`.

### `disputes`
`id, order_id, payment_id, opened_by uuid, party_role ('customer'|'driver'|'merchant'), kind ('amount_mismatch','not_received','chargeback','payout_missing','other'), amount bigint, description text, status ('open','investigating','resolved_refund','resolved_no_refund','closed'), assigned_to uuid, resolution text, created_at, resolved_at`.
RPC: `dispute_open(p_order, p_kind, p_amount, p_description)` (semua peran yang terlibat di order), `my_disputes()`, `admin_disputes(p_status)`, `admin_dispute_resolve(p_id, p_status, p_resolution, p_refund_amount default null)` (PIN; bila refund → buat `refund_requests` maker=admin).
Ledger: baris `dispute` (entry baru) saat open (amount, phase 'adjusted'), dibalik saat resolved.

### `approval_requests` (maker-checker generik)
`id, kind ('refund','wallet_adjust','fee_change','payout_batch'), ref_id uuid, payload jsonb, amount bigint, maker uuid, checker uuid, status ('pending','approved','rejected','expired'), created_at, decided_at, note`. RPC: `admin_approvals(p_status)`, `admin_approval_decide(p_id, p_approve bool, p_note)` (checker ≠ maker, PIN). `admin_adjust_wallet` v3: bila `abs(amount) >= wallet_adjust_dual_approval_min` → buat approval, eksekusi saat disetujui.

## 5. RBAC admin
`profiles.admin_role text check in ('superadmin','finance','ops','cs','viewer')` (null = bukan admin; `role='admin'` tetap syarat). Fungsi `admin_has(p_perm text) → bool` dengan matriks:
- `superadmin`: semua.
- `finance`: refund/approve, payout, rekonsiliasi, fee (maker), ledger, laporan.
- `ops`: driver/merchant/kota/order/iklan approve, tarif (maker).
- `cs`: tiket, dispute (open/investigate), lihat order/payment, TIDAK bisa uang.
- `viewer`: baca saja.
Setiap RPC admin v3 memanggil `admin_require(p_perm)`; RPC lama tetap `is_admin()` (backward compat) — daftar yang diketatkan di v3: refund, payout settle, adjust wallet, fee, gateway secret, approvals. `admin_set_admin_role(p_user, p_role)` hanya superadmin + PIN. Migrasi: admin yang ada → `superadmin`.
RPC `my_admin_role()` → `{role, perms:[...]}` untuk menyembunyikan menu di Panel Admin.

`audit_logs` dan `order_ledger` dan `payment_events` → trigger **append-only** (tolak UPDATE/DELETE, termasuk untuk admin; hanya service_role migrasi).

## 6. Ledger v3
- `ledger_entry` tambah nilai: `customer_receivable` (dana pelanggan yang masih di PG/hold), `wallet_liability`, `tax_output`, `dispute`, `unreconciled`, `payout_fee`, `ads_impression_cost`, `ads_click_cost`.
- `order_ledger` tambah kolom `payment_id uuid`, `reversal_of bigint` (id baris yang dibalik). **`ledger_post` tidak lagi menghapus baris**: bila fase sudah ada, tulis baris pembalik (`reversal_of`) lalu baris baru. Append-only trigger.
- `ledger_check` diperluas: `gross + promo_sponsor = driver + merchant + vendor + partner + platform_revenue + pg_fee(customer) + tax_output`.
- `reconciliation_runs`: `id uuid, run_date date, provider, kind ('daily'|'manual'), payments_checked int, mismatches int, unreconciled_amount bigint, status ('running','done','failed'), report jsonb, created_by, created_at`. Job `reconcile_daily(p_date)` (service_role; dipanggil cron 02:00 WIB + tombol admin `admin_reconcile_run(p_date)`): bandingkan `payments PAID` vs `payment_events` vs ledger `gross_customer` vs `wallet_transactions`; tulis `unreconciled` untuk selisih; set `reconciled_at`/`settlement_status='RECONCILED'` yang cocok. Edge `pay-reconcile` melengkapi dengan cek status ke provider untuk PENDING > 30 menit (transaksi menggantung) dan menulis `payment_events` (event_id = `recon-<ts>-<external_id>`).
- `admin_contribution_margin(p_from date, p_to date, p_group text ('service'|'city'|'merchant'|'month'))` → baris: `key, orders, gross, platform_revenue, pg_fee_platform, promo_platform, refund_fraud, variable_cost, contribution_margin, take_rate_net_pct` (variable_cost dari setting `variable_cost_per_order` `[ASUMSI]`).

## 7. Iklan v3 (menyempurnakan 0101)
### `ad_products` tambah kolom
`pricing_model text ('flat'|'cpc'|'cpm'|'cpa') default 'flat'`, `unit_price bigint` (harga per klik/1000 impresi/konversi), `min_budget bigint default 50000`, `min_days int default 1`, `max_days int default 30`, `requires_approval boolean default true`, `label text default 'Sponsored'`.
Seed produk (semua `[ASUMSI]`, admin ubah): `featured_home` flat Rp25.000/hari; `boost_nearby` cpc Rp500/klik min Rp50.000; `search_top` cpc Rp700/klik min Rp50.000; `banner_home` cpm Rp15.000/1000 impresi min Rp100.000; `banner_category` flat Rp50.000/minggu; `radius_promo` cpm Rp10.000 min Rp50.000; `sponsored_voucher` cpa 5 % dari nilai order min Rp100.000; `post_checkout_cross` cpc Rp400.

### `merchant_ads` → **campaign** (kolom tambah)
`name text`, `budget bigint`, `spent bigint default 0`, `radius_km numeric`, `center geography(point)` (default lokasi merchant), `category text`, `creative jsonb` ({headline, image_url, cta}), `status` diperluas: `('draft','pending_review','approved','rejected','active','paused','ended','budget_exhausted','cancelled','expired')`, `review_note text`, `reviewed_by uuid`, `reviewed_at`, `paused_by text ('merchant'|'admin'|'system')`, `impressions int default 0`, `clicks int default 0`, `conversions int default 0`, `conversion_value bigint default 0`.
### `ad_events` (append-only)
`id bigserial, campaign_id uuid, user_id uuid, event ('impression'|'click'|'conversion'), placement text, order_id uuid, cost bigint, billable boolean, dedupe_key text, created_at`. Unique `(campaign_id, user_id, event, dedupe_key)` untuk klik (dedupe_key = bucket menit `ads_click_dedupe_minutes`) dan impresi (bucket hari + frequency cap).
### `ad_budget_ledger`
`campaign_id, amount (+ topup / − cost / + refund), kind ('fund','charge','refund','adjust'), ref bigint (ad_events.id), created_at`. Invarian: `spent = sum(charge)`; saldo = budget − spent. Setiap charge juga masuk `order_ledger` (`source='merchant_ads'`, entry `ads_revenue`, party merchant, phase 'completed').

### RPC merchant
- `merchant_campaign_create(p_product, p_name, p_budget, p_days, p_radius_km, p_creative jsonb, p_merchant_id default null) → id` — status `pending_review` (atau `approved`→`active` bila `requires_approval=false`); dana ditahan dari saldo merchant (`wallet_apply 'payment'`) — closed loop (tidak ada uang masuk dari luar).
- `merchant_campaign_set(p_id, p_action ('pause'|'resume'|'stop'|'topup'), p_amount default null)`; `stop` → refund saldo tersisa ke wallet merchant (ledger `ads_revenue` negatif utk porsi refund).
- `merchant_campaigns()` → daftar + metrik; `merchant_campaign_report(p_id, p_from, p_to)` → harian: impressions, clicks, ctr, conversions, conversion_value, spent, roas (= conversion_value / spent).
### RPC pelanggan (dipanggil UI saat render/klik)
- `ads_serve(p_placement, p_lat, p_lng, p_category default null, p_q default null, p_limit int default 3)` → `[{campaign_id, merchant_id, merchant, headline, image_url, cta, label:'Sponsored', distance_km}]` — hanya `active`, dalam radius, budget tersisa ≥ unit_price, frequency cap terpenuhi; **mencatat impresi** (billable untuk cpm) dalam panggilan yang sama.
- `ads_click(p_campaign_id, p_placement)` → `{charged bool}` — dedupe; bila budget habis → status `budget_exhausted`.
- `ads_conversion` dipanggil internal oleh `create_order` bila `p_ad_campaign_id` disertakan (kolom baru `orders.ad_campaign_id`) → cpa charge.
- `nearby_merchants_v2` tetap; kolom `ad_label` diisi `'Sponsored'` dan `campaign_id`. Ranking organik TIDAK berubah; hasil berbayar ditandai & dipisahkan (UI menaruh di blok "Sponsored" di atas, bukan menyisipkan tanpa label).
### RPC admin
`admin_campaigns(p_status)`, `admin_campaign_review(p_id, p_approve bool, p_note)` (brand safety checklist di UI), `admin_campaign_set(p_id, p_action)`, `admin_ads_report(p_from, p_to)` (pendapatan iklan, per produk, per merchant, fraud dedupe count), `admin_set_ad_product(p_code, p_patch)` (ada).

## 8. Payout & disbursement
- `withdrawal_requests` tambah `provider text ('manual'|'finpay')`, `provider_ref`, `inquiry_ref`, `fee bigint`, `payout_status ('PAYOUT_PENDING','PAYOUT_PROCESSING','PAYOUT_SETTLED','PAYOUT_FAILED')`, `failed_reason`.
- Edge `pay-disburse` (admin-only; `disbursement_provider='finpay'`): inquiry → transfer → `payout_event_ingest(p_external_id, p_status, p_raw)`; gagal → `PAYOUT_FAILED` + saldo dikembalikan (`wallet_apply 'refund'`) + notifikasi.
- Mitra: `my_withdrawals()` → daftar dengan `payout_status`, `provider_ref`, `settled_at`.
- `driver_order_breakdown` / `merchant_order_breakdown` (v2) tambah: `settlement_status`, `payout_status`, `promo_funded_by`, `pg_fee_funded_by`.

## 9. Edge functions (Deno, `supabase/functions`)
- `pay-create` body `{purpose:'order'|'topup', order_id?, amount?, channel}` → `{payment_id, external_id, provider, checkout_url?, checkout_token?, qr_string?, payment_code?, expires_at, support_ref}`. Membaca `payment_provider_active`; adapter `_shared/providers/{midtrans,finpay,simulated}.ts` dengan antarmuka `createCharge, verifyNotification, normalizeStatus, mapChannel, checkStatus, refund, cancel`.
- `pay-webhook/{provider}` — verifikasi signature (Finpay: HMAC-SHA512 atas raw body tanpa field `signature`, constant-time compare, lalu **selalu** `checkStatus` ke provider sebelum PAID); Midtrans: SHA512 lama. → `payment_event_ingest`. Respons Finpay `{"responseCode":"2000000","responseMessage":"Success"}`.
- `pay-refund` (admin JWT + `admin_has('refund_execute')`) — eksekusi `refund_requests.status='approved'`.
- `pay-reconcile` (service_role/cron) — cek status PENDING > 30 menit & PAID hari H-1.
- `pay-disburse` (admin).
- `midtrans-create` / `midtrans-webhook` **TIDAK dihapus** (transaksi lama). `midtrans-create` v3: tolak bila `payment_provider_active != 'midtrans'` (kecuali `purpose='topup'` lama yang pending). Simulasi: hanya lewat `pay-webhook/simulated` dan hanya bila `payments_simulation_enabled` & env sandbox.
- Klien memanggil `pay-create` (bukan `midtrans-create`) untuk transaksi baru; teks UI "Biaya metode pembayaran (<Provider>)".

## 10. Kepemilikan file (agen)
| Agen | Boleh mengedit | Tidak boleh |
|---|---|---|
| A DB | `supabase/migrations/0105–0110*.sql`, `supabase/rollback/*`, `supabase/tests/*`, `supabase/seed.sql`, `scripts/db-lokal*` | apa pun di `src/`, `supabase/functions/` |
| B Edge | `supabase/functions/pay-*`, `supabase/functions/_shared/**`, `supabase/functions/midtrans-*` (hanya guard provider), `supabase/functions/tests/**`, `deno.json` | migrasi, `src/` |
| C Pelanggan | `src/screens/{ride,food,send,box,shop,market,travel,customer,pay,orders,support}/**`, `src/components/{BookingSheet,OrderDetails,BookingExtras,PaymentMethods,PromoCard,ActiveOrderBubbles,OrderCard,ShopTotal,TipExtras}.tsx`, `src/lib/{payments.ts (baru), ads.ts (baru), format.ts, types.ts, orders.ts, i18n.ts}`, `apps/pelanggan/**` | `src/screens/{driver,merchant,vendor,admin,exec}/**` |
| D Mitra | `src/screens/{driver,merchant,vendor,mitra,account}/**`, `src/components/{EarningBreakdown,MerchantOrderBreakdown,WalletView}.tsx`, `src/lib/mitra.ts (baru)`, `apps/mitra/**` | file milik C/E; `types.ts` (tambahkan tipe di `src/lib/mitra.ts`) |
| E Admin | `src/screens/{admin,exec}/**`, `src/components/admin.tsx`, `src/components/AdminUnlockGate.tsx`, `src/lib/admin.ts (baru)`, `apps/admin/**` | file milik C/D |
| F Landing/legal | repo `antarkita-landing` (clone terpisah), `docs/rilis/{privacy,terms,hapus-akun}.html` | kode app |
| G Bisnis | `/home/claude/deliverables/**` (xlsx, md) | repo |
| Lead | `docs/finpay-v3/**`, `.github/workflows/**`, `README.md`, integrasi & konflik | — |
