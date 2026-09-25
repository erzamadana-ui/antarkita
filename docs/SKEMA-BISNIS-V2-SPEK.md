# Skema Bisnis AntarKita v2 (September 2026) — Spesifikasi implementasi

Sumber keputusan: `rekomendasi perhitungan_bisnis_model_antarkita_versiSeptember2026.md` (keputusan Erza 23 Sep 2026, riset GoTo/Grab/Maxim) dan Kontrak Elektronik Midtrans `M568767786_825925_PKS-Pass_M_09_2026` (Ver.Aug-26, layanan Aggregator, registrasi perorangan).
Peta kode saat ini: lihat bagian "Kondisi awal" di bawah (hasil survei 23 Sep 2026). Branch: `skema-bisnis-v2`. Migrasi mulai `0098`.

Label angka: **[FAKTA SUMBER]** = dari dokumen keputusan/PKS/kode; **[ASUMSI]** = usulan direktur (AI), wajib bisa diubah dari Panel Admin; **[HASIL PILOT]** = belum ada.

## 0. Prinsip yang mengikat semua bagian

1. **Ongkir adalah hak driver** [FAKTA SUMBER]. Platform TIDAK memotong komisi dari ongkir layanan makanan/paket/belanja. Pendapatan platform pada layanan itu = fee merchant (tertulis di kontrak merchant) + biaya platform pelanggan (tampil terpisah sebelum checkout) + iklan/boost + layanan lain.
2. **Penumpang roda dua (`ride_motor`)**: porsi driver ≥ 92 %, komisi aplikator ≤ 8 % [FAKTA SUMBER: acuan regulasi per Sep 2026]; sudah ada pagar `commission_cap_two_wheel` = 8 (0031) — dipertahankan dan dipakai sebagai batas keras.
3. **Promo bukan pendapatan**; setiap promo punya pemilik biaya: `platform` | `merchant` | `sponsor` [FAKTA SUMBER].
4. **Tidak ada dana merchant/driver yang "settled"** sebelum pembayaran tervalidasi, order selesai, dan ledger teralokasi. Status withdrawal `approved` ≠ uang sampai; `settled` hanya setelah konfirmasi bank/provider [FAKTA SUMBER].
5. **Take rate bersih** = (fee merchant + biaya platform pelanggan + iklan/boost + layanan lain − promo yang ditanggung platform) ÷ **GMV bersih selesai** (nilai barang/jasa order selesai & tidak direfund; ongkir dan biaya platform dicatat terpisah). Target 25 % = north-star portofolio matang, BUKAN target per order dan BUKAN laba [FAKTA SUMBER].
6. **Contribution per order** = pendapatan platform bersih − biaya payment gateway & payout − insentif driver/merchant − subsidi/promo platform − biaya support/fraud/refund/asuransi/cloud variabel. **EBITDA kota** = Σ contribution − biaya tetap kota [FAKTA SUMBER].
7. Semua persentase, nominal, harga iklan, biaya PG, biaya tetap kota **dapat diatur dari Panel Admin** (PIN untuk yang menyentuh uang) dan **setiap perubahan diaudit** (`log_activity` dengan nilai lama→baru).
8. Klausul PKS Midtrans Pasal 7 ayat 4(b) [FAKTA SUMBER]: fitur uang elektronik / dompet elektronik di aplikasi yang butuh izin (Bank Indonesia) tanpa izin → Midtrans berhak menghentikan layanan. Konsekuensi: **AntarPay top-up (stored value) tetap NONAKTIF sampai ada review legal/izin**; pembayaran non-tunai lewat gateway dilakukan **per order (purpose=order)**, bukan isi saldo. Saldo AntarPay hanya boleh dipakai sebagai (a) dompet pendapatan mitra (earning/withdraw), (b) refund pelanggan (closed-loop, tidak bisa di-top-up).

## 1. Tabel aturan bisnis per layanan — `service_economics`

```sql
create table service_economics (
  service          service_type primary key,
  driver_commission_pct   numeric(5,2) not null default 0,   -- potongan platform dari ongkir/tarif jasa driver (ride_motor ≤ 8)
  merchant_fee_pct        numeric(5,2) not null default 0,   -- fee platform dari nilai barang merchant/vendor
  customer_platform_fee   bigint       not null default 0,   -- biaya platform pelanggan, nominal per order (tampil terpisah)
  service_fee_pct         numeric(5,2) not null default 0,   -- shop/market: % dari subtotal belanja
  service_fee_min         bigint       not null default 0,
  service_fee_driver_share_pct numeric(5,2) not null default 0, -- porsi driver dari service fee
  pg_fee_policy           text not null default 'platform' check (pg_fee_policy in ('platform','customer')), -- siapa menanggung biaya PG
  promo_default_funded_by text not null default 'platform' check (promo_default_funded_by in ('platform','merchant','sponsor')),
  notes text, updated_at timestamptz default now(), updated_by uuid
);
```

Nilai awal (semua boleh diubah admin):

| service | driver_commission_pct | merchant_fee_pct | customer_platform_fee | service_fee_pct / min / driver share | Label |
|---|---|---|---|---|---|
| ride_motor | **8** (pagar keras ≤ 8) | 0 | 1.000 | – | [FAKTA SUMBER] komisi; fee [ASUMSI, = pricing.platform_fee lama] |
| ride_car | **15** | 0 | 4.000 | – | [ASUMSI] (roda empat tidak diatur cap 8 %) |
| food | **0** | **15** | 2.000 | – | ongkir hak driver [FAKTA]; 15 % = nilai lama `merchant_commission_pct` [FAKTA kode]; fee [ASUMSI] |
| send | **0** | 0 | 3.000 | – | [ASUMSI] pendapatan = biaya platform saja |
| shop | **0** | 0 | 1.000 | 5 % / 5.000 / 70 % | nilai lama 0013 [FAKTA kode] |
| market | **0** | 0 | 1.000 | 10 % / 8.000 / 70 % | nilai lama 0013 [FAKTA kode] |
| box | **10** | 0 | 2.000 | – | [ASUMSI] kargo bukan penumpang |
| travel (booking/charter/request/intercity send) | – | **10** (partner fee, = `travel_commission_pct` lama) | 5.000 (= `travel_platform_fee` lama) | – | [FAKTA kode]; intercity send partner share 80 % tetap (`travel_send_partner_pct`) |

`pricing.commission_pct` / `pricing.merchant_commission_pct` / `pricing.platform_fee` **berhenti dipakai** sebagai sumber kebenaran: `create_order` membaca `service_economics`. Migrasi menyalin nilai lama ke kolom `notes` untuk jejak. Trigger `t_guard_commission_cap` diperluas ke `service_economics` (ride_motor.driver_commission_pct ≤ commission_cap_two_wheel).

RPC admin: `admin_set_service_economics(p_service, p_patch jsonb)` — `is_admin()` + `admin_require_unlock()`; validasi rentang (0–100, nominal ≥ 0, ride_motor ≤ cap); `log_activity('economics.updated', 'service_economics', service, ringkasan, {before, after})`.
RPC baca: `service_economics_public(service)` → hanya `customer_platform_fee`, `service_fee_pct/min`, `driver_commission_pct` (dipakai klien untuk menampilkan rincian transparan; grant `anon, authenticated`).

## 2. Snapshot di `orders` + buku besar per order `order_ledger`

Kolom baru di `orders` (isi saat `create_order`, tidak diubah lagi kecuali oleh koreksi tercatat):
`driver_commission_pct_snap numeric(5,2)`, `merchant_fee_pct_snap numeric(5,2)`, `promo_funded_by text` ('platform'|'merchant'|'sponsor'), `pg_channel text` (kunci 0089 atau 'cash'), `pg_fee bigint default 0`, `pg_fee_borne_by text` ('platform'|'customer'), `ledger_version int default 2`.
Kolom `driver_earning` **tidak lagi ditimpa** saat selesai: tambah `driver_earning_final bigint` (ongkir bersih + tip + extras + share + bonus), `merchant_earning` tetap = nilai barang − fee merchant − promo yang ditanggung merchant.

```sql
create type ledger_entry as enum (
  'gross_customer',      -- total yang dibayar pelanggan (+)
  'items_subtotal',      -- nilai barang/jasa merchant (komponen GMV bersih)
  'delivery_fee',        -- ongkir/tarif jasa (komponen, hak driver)
  'customer_platform_fee','service_fee','intercity_fare','tip','extras',
  'promo_platform','promo_merchant','promo_sponsor',   -- (−) diskon menurut pemilik biaya
  'driver_commission',   -- (+ platform) potongan dari ongkir
  'merchant_fee',        -- (+ platform)
  'driver_payable','merchant_payable','vendor_payable','partner_payable', -- kewajiban ke mitra
  'platform_revenue',    -- pendapatan platform bersih (fee + komisi + service fee bagian platform − promo platform)
  'pg_fee','pg_fee_ppn', -- biaya gateway sesuai payment_channel_fees (−)
  'driver_receivable',   -- order tunai: piutang platform ke driver (fee+komisi yang dipegang driver)
  'refund','adjustment','ads_revenue'
);
create table order_ledger (
  id bigserial primary key,
  order_id uuid references orders(id) on delete cascade,
  source text not null default 'orders' check (source in ('orders','travel_bookings','travel_requests','merchant_ads')),
  source_id uuid,                      -- untuk travel/ads bila order_id null
  service service_type,
  city_id uuid, city text,
  entry ledger_entry not null,
  amount bigint not null,              -- tanda: (+) uang masuk/hak platform, (−) keluar/kewajiban; lihat aturan keseimbangan
  party_role text check (party_role in ('customer','driver','merchant','vendor','partner','platform','gateway','sponsor')),
  party_id uuid,
  funded_by text,                      -- untuk promo
  phase text not null check (phase in ('created','completed','cancelled','refunded','settled','adjusted')),
  pg_channel text,
  note text,
  created_at timestamptz not null default now()
);
create index on order_ledger(order_id); create index on order_ledger(created_at); create index on order_ledger(service, phase);
```
Keseimbangan (dicek fungsi `ledger_check(order_id)` dan dipakai uji): untuk fase `completed`,
`gross_customer = driver_payable + merchant_payable(+vendor/partner) + platform_revenue + pg_fee + pg_fee_ppn + promo yang ditanggung merchant/sponsor (tercermin di payable) …` — tulis rumus eksplisit di migrasi dan uji dengan angka nyata tiap layanan.

Fungsi inti (SECURITY DEFINER, bypass RLS): `ledger_post(order_id, phase)` — menghitung dari snapshot kolom `orders` + `service_economics` (snap) + `payment_channel_fees`, menghapus baris fase yang sama lalu menulis ulang (idempoten). Dipanggil dari `create_order` (phase created), `driver_update_order_status` completed (phase completed; menggantikan perhitungan v_comm inline), `cancel_order` / `merchant_update_order` reject (phase cancelled/refunded), `set_shopping_actual` (adjusted), travel: `travel_book`, `travel_offer_accept`, `travel_trip_set_status arrived`, `travel_request_set_status completed/cancelled` (source travel_*; simpan denda 30 % pembatalan sebagai `platform_revenue` note 'denda batal').
Penambalan fungsi lama memakai pola 0089/0096: `pg_get_functiondef` + `replace` pada jangkar unik + guard DO yang gagal keras bila jangkar tidak ada. Perhitungan lama `driver_earning = v_fare − floor(v_fare×pricing.commission_pct)` diganti membaca `service_economics`.

Aturan dana per order (fase completed):
- `delivery_fee` (ongkir) → driver 100 % dikurangi `driver_commission_pct_snap` (ride_motor/ride_car/box saja; food/send/shop/market = 0).
- `items_subtotal` → merchant_payable = subtotal − merchant_fee − promo_merchant; vendor pasar/toko (shop/market) tetap dibayar tunai oleh driver → `vendor_payable` dicatat sebagai reimburse driver (perilaku lama dipertahankan, tapi kini tercatat).
- `customer_platform_fee`, `merchant_fee`, `driver_commission`, `service_fee × (1 − driver share)`, `intercity_margin` → `platform_revenue`; dikurangi `promo_platform`.
- `pg_fee`: bila `paid_via` adalah saluran gateway (purpose=order) → dari `payment_channel_fees`; bila `pg_fee_policy='customer'` → ditambahkan ke total pelanggan sebagai baris "Biaya pembayaran" (tampil sebelum bayar) dan tidak mengurangi platform_revenue. Order via saldo AntarPay/tunai: pg_fee = 0 (biaya top-up dicatat di `wallet_transactions.pg_fee`, dilaporkan terpisah).
- Tunai: `driver_receivable` = customer_platform_fee + driver_commission + merchant_fee (bila driver menyetor ke merchant hanya merchant_earning) → tetap didebit `wallet_apply(driver,'fee')` seperti sekarang, tapi kini tercatat dan batas minus dibaca dari `app_settings.driver_debt_limit` (default −500000, bukan hard-code) dan berlaku juga untuk partner travel.

## 3. Biaya payment gateway — `payment_channel_fees` (PKS Midtrans Ver.Aug-26, Aggregator)

| channel (kunci 0089) | fee_pct | fee_fixed | ppn_included | hold_days | Sumber |
|---|---|---|---|---|---|
| bank_transfer (VA: Mandiri/BNI/BRI/CIMB/Permata/Danamon/BCA/BSI/SeaBank) | 0 | 4.000 | false | 1 (BSI/SeaBank 2) | Pasal 6 ayat 2; SOP B.6.a |
| card (Visa/MC/JCB) | 2,9 | 2.000 | false | 3 | idem |
| gopay | 2,0 (non-digital) | 0 | true | 1 | Lampiran GoPay |
| shopeepay | 2,0 (non-digital) | 0 | true | 2 | Lampiran ShopeePay |
| qris | 0,7 (reguler umum) | 0 | true | 1 | Lampiran QRIS |
| dana | 1,5 | 0 | false | 2 | Pasal 6 |
| ovo | 1,5 (non-digital domestik) | 0 | false | 5 (tidak disebut → "lainnya") | Pasal 6 |
| akulaku / kredivo (belum dipakai) | 1,7 / 2,0 | 0 | false | 5 / 2 | Pasal 6 |
| alfamart / indomaret (belum dipakai) | 0 | 5.000 / partner+1.000 | false | 5 | Pasal 6 |
| cash, antarpay, emoney_nfc | 0 | 0 | – | 0 | bukan gateway |

Kolom: `channel text pk, provider text default 'midtrans', fee_pct numeric(5,2), fee_fixed bigint, ppn_included bool, ppn_pct numeric(4,2) default 11 [ASUMSI tarif efektif PPN jasa 11 %; ubah di admin], hold_days int, min_auto_disburse bigint default 50000 [FAKTA SOP B.6.a.iii], source text, active bool, updated_at, updated_by`.
Fungsi `pg_fee_calc(channel, amount) returns table(fee bigint, ppn bigint)`: `fee = round(amount×fee_pct/100) + fee_fixed`; bila `ppn_included` → ppn = 0 (sudah termasuk), else `ppn = round(fee×ppn_pct/100)`.
RPC admin `admin_set_payment_channel_fee(channel, patch jsonb)` (PIN, audit).
Edge function `midtrans-webhook`: ekstrak `payment_type` (+ `bank`/`va_numbers[0].bank`/`acquirer`) → petakan ke kunci saluran; simpan `payments.pg_channel`, `payments.pg_fee`, `payments.pg_fee_ppn`, `payments.settlement_time`, `payments.hold_until = settlement + hold_days`; `payment_settle` menerima kolom baru dan — bila `purpose='order'` — memanggil `ledger_post(order_id,'completed'|'created')` agar `pg_fee` order terisi (BUKAN top-up ke wallet). `midtrans-create`: dukung `purpose='order'` dengan `order_id` (bayar per order) — flow: order dibuat `payment_status='unpaid'`, Snap dibayar, webhook settlement → `payment_status='paid'` dan pencarian driver dimulai (`orders.status` tetap `searching`; sebelum paid: `awaiting_payment`, kedaluwarsa 15 menit [ASUMSI] → batal otomatis).

## 4. Iklan & boost merchant — `ad_products`, `merchant_ads`

`ad_products(code pk, name, description, unit text check in ('per_day','per_week','per_order'), price bigint, placement text check in ('featured_home','boost_nearby','banner_category'), active bool, updated_*)`. Nilai awal [ASUMSI, admin mengubah]: `featured_home` Rp25.000/hari; `boost_nearby` Rp15.000/hari; `banner_category` Rp50.000/minggu.
`merchant_ads(id, merchant_id, product_code, starts_at, ends_at, price_paid, status check in ('draft','pending_payment','active','expired','cancelled'), paid_via, payment_id, created_by, created_at)`; `ads_revenue` diposting ke `order_ledger(source='merchant_ads', entry='ads_revenue')` saat status `active`. `nearby_merchants` mengurutkan merchant `boosted=true` (ada `merchant_ads` aktif) di atas, dengan label "Iklan" di UI pelanggan (transparan). RPC: `admin_set_ad_product`, `admin_set_merchant_ad(merchant_id, product, start, end, status)` (PIN), `merchant_ad_request(product, days)` (merchant sendiri, bayar dari saldo pendapatan bila cukup — closed-loop, aman Pasal 7.4b).

## 5. Biaya tetap kota & EBITDA — `city_fixed_costs`

`city_fixed_costs(id, city_id, month date (tanggal 1), category text check in ('tim','akuisisi','kantor','legal','teknologi','lainnya'), amount bigint, note, created_by, created_at)`; RPC `admin_set_city_fixed_cost` (PIN, audit). Biaya variabel non-order (support, fraud, asuransi, cloud) per bulan per kota masuk kategori `lainnya` + `variable_ops` [ASUMSI] agar contribution memuat "biaya support, fraud, refund, asuransi, cloud variabel" — dialokasikan pro-rata per order selesai bulan itu.

## 6. Payout tersettle

`withdrawal_requests` + kolom `settled_at timestamptz`, `provider_ref text`, `settled_by uuid`; RPC `admin_mark_withdrawal_settled(id, provider_ref)` (PIN). Laporan membedakan `approved` vs `settled`. Rekonsiliasi harian: view `v_reconciliation_daily(date)` = Σ gross_customer digital − Σ payments settlement − Σ pg_fee vs saldo; kolom `diff`.

## 7. Laporan eksekutif v2 & filter

RPC `exec_report_v2(p_token, p_from date, p_to date, p_filters jsonb)` — filter: `service[]`, `city_id[]`, `merchant_cohort` ('new_30d'|'active'|'all' berdasarkan bulan pertama order), `payment_method` (kunci saluran), `cash_digital` ('cash'|'digital'|'all'), `promo_owner`. Keluaran JSON:
- `summary`: gmv_net (Σ items_subtotal+delivery_fee order selesai tidak refund), platform_revenue (per sumber: merchant_fee, customer_platform_fee, driver_commission, service_fee_platform, ads, other), promo (per pemilik), **take_rate_net_pct**, orders, **contribution_per_order**, contribution_total, pg_fee_total, payout_fee_total, incentives_total, refund_total.
- `by_city[]`: gmv_net, revenue, contribution, fixed_costs, **ebitda_city**, orders.
- `by_service[]`, `by_payment[]`, `by_month[]` (12 bulan), `cohort[]`.
- `gates`: status gerbang scale-up (≥ 8 minggu contribution>0, diff rekonsiliasi = 0, payout tepat waktu %, retensi 30 hari driver/merchant, fraud/refund %) — `pass`/`fail` + angka.
- `labels`: setiap angka target/assumsi diberi label FAKTA/ASUMSI/HASIL PILOT.
Semua dihitung dari `order_ledger` (bukan dari `driver_earning` pasca-selesai) — satu sumber kebenaran; `order_economics` lama diganti view `order_economics_v2` berbasis ledger (kolom kompatibel untuk `admin_finance_cascade`).
`admin_dashboard_stats.revenue_month` dan `exec_report_data.summary.revenue` **diselaraskan** ke ledger (tidak boleh ada dua definisi pendapatan).

## 8. Panel Admin — menu baru (grup "Keuangan" & "Katalog & Harga")

| Route | Layar | Isi |
|---|---|---|
| `/(admin)/economics` | **Aturan Bisnis** | tabel `service_economics` per layanan, edit inline + simpan (PIN), badge FAKTA/ASUMSI, pagar ride_motor ≤ 8 % tampil, simulasi 1 order (input ongkir/subtotal/promo/saluran → rincian alokasi via RPC `ledger_simulate(service, fare, subtotal, promo, channel, cash)`) |
| `/(admin)/pg-fees` | **Biaya Payment Gateway** | tabel `payment_channel_fees` (PKS) editable (PIN), kolom hold H+n, PPN, kebijakan siapa menanggung per layanan; peringatan Pasal 7.4b |
| `/(admin)/ads` | **Iklan & Boost** | produk iklan (harga, unit, placement) + daftar iklan merchant aktif/pending; buat iklan atas nama merchant (PIN) |
| `/(admin)/city-costs` | **Biaya Tetap Kota** | input per kota/bulan/kategori; ringkasan EBITDA kota bulan berjalan |
| `/(admin)/ledger` | **Buku Besar Order** | cari order → semua baris `order_ledger` per fase; tombol "Cek keseimbangan"; daftar order dengan `ledger_check` gagal |
| `/(admin)/reconciliation` | **Rekonsiliasi & Payout** | `v_reconciliation_daily`, withdrawal approved-belum-settled, tombol "Tandai settled + ref" (PIN) |
| `/exec` (tab baru) | **Skema Bisnis** | take rate bersih vs target (label), contribution/order, EBITDA kota, gerbang scale-up, filter §7 |

Semua layar mengikuti `src/screens/admin/_shared.tsx` + gaya `adminTone`; pola PIN via `AdminUnlockGate`; error ditampilkan (jangan `.catch(()=>null)`).

## 9. Transparansi di aplikasi Pelanggan & Mitra (wajib divalidasi)

- **Pelanggan** (checkout semua layanan): baris terpisah: Ongkir · Nilai barang · Biaya platform · Biaya layanan (shop/market) · Biaya pembayaran (bila policy=customer) · Promo (−, dengan keterangan "ditanggung X") · Total. Sumber angka: `fare_options`/`shopping_estimate` (tambah `customer_platform_fee`, `pg_fee_estimate` per saluran) — bukan konstanta klien.
- **Mitra/driver** (`src/screens/driver/tabs/earnings.tsx`, detail order): rincian per order: Ongkir · Komisi platform x % (0 untuk food/send/shop/market) · Tip · Extras · Bagian service fee · Bonus sesi · **Pendapatan bersih**; order tunai: "Anda memegang Rp X, setoran ke platform Rp Y" (dari `driver_receivable`). RPC `driver_order_breakdown(order_id)` membaca `order_ledger`.
- **Merchant** (`src/screens/merchant/*`): per order: Nilai pesanan · Fee platform x % · Promo ditanggung merchant · **Diterima**; halaman ringkasan bulanan.
- Label "Iklan" pada merchant yang di-boost di beranda pelanggan.

## 10. Validasi (definisi selesai)

1. `supabase/tests/uji_skema_bisnis_v2.sql`: untuk tiap layanan (ride_motor, ride_car, food, send, shop, market, box, travel booking) × (tunai, saldo, gateway qris) × (tanpa promo, promo platform, promo merchant) → buat order, selesaikan, cek `ledger_check` = balance, cek driver/merchant wallet delta = payable, cek pg_fee sesuai tabel, cek ride_motor komisi ≤ 8 %, cek pembatalan → refund & ledger fase refunded; ≥ 40 skenario, semua lolos di branch Supabase / DB lokal (psql).
2. `npx tsc --noEmit` untuk 3 aplikasi; `npx expo export --platform web` untuk pelanggan & mitra & admin (script yang ada di `package.json`).
3. Screenshot/teks layar checkout Pelanggan & pendapatan Mitra (web export) dicantumkan di `docs/rilis/VALIDASI-SKEMA-BISNIS-V2.md`.
4. Migrasi 0098–010x idempoten dan diterapkan ke produksi lewat Supabase MCP **hanya setelah** uji lolos; catatan rilis + xlsx simulasi unit economics (skill xlsx, rumus hidup) di `docs/bisnis/`.

## Kondisi awal (ringkasan survei kode, 23 Sep 2026)
- Uang bergerak lewat `wallet_apply` (0002:101) → `wallets`/`wallet_transactions` (type: topup, payment, earning, refund, withdrawal, fee, adjustment); **tidak ada ledger per order**; `order_economics` (0026:34) merekonstruksi dari kolom `orders`.
- Tarif di `pricing` per layanan (base_fare, per_km, min_fare, platform_fee, commission_pct 20, merchant_commission_pct 15, surge); `calc_fare` 0006:71; `estimate_fare` 0087:66; `fare_options` 0009:258; `shopping_estimate` 0013:358; `commission_cap_two_wheel` 0031.
- `create_order` 0014:9 (ditambal 0021, 0030, 0080, 0083, 0088, 0089): `driver_earning = fare − floor(fare×commission_pct)`; `merchant_earning = sub − floor(sub×15%)`; promo 100 % platform implisit; komisi tidak di-snapshot.
- `driver_update_order_status` 0033:22: menimpa `driver_earning` (+tip+extras+share+bonus); tunai → `wallet_apply(driver,'fee',−v_fee)`; batas minus −500.000 hard-code (0007:471, 0009:504).
- Gateway: `payments` (0006:162), `payment_settle` 0016:84 selalu top-up wallet; webhook tidak mencatat fee; `gateway_fee_pct` 1.5 hanya estimasi; `antarpay_enabled` 0088; `payment_channels` 0089.
- Admin: `NAV_GROUPS` di `src/screens/admin/_layout.tsx:21`; pola layar `apps/admin/app/(admin)/<x>.tsx` re-export `src/screens/admin/<x>`; guard `is_admin()` + `admin_require_unlock()`; exec: `src/screens/exec/index.tsx`, `exec_report` 0026:467, `exec_login` 0086:117.
- Iklan: hanya `blasts` (0009:536) tanpa harga; `MerchantAds` komponen = merchant terdekat (bukan berbayar).
