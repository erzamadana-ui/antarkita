# Pembayaran v3 — Edge Functions (Finpay + Midtrans)

Rujukan kontrak: `docs/finpay-v3/KONTRAK-API-V3.md` §1–§4, §8, §9. Semua status/uang ditulis DB lewat RPC
service_role (`payment_event_ingest`, `payout_event_ingest`, `refund_execute_result`, `reconcile_daily`).

## Isi

| Fungsi | Pemanggil | verify_jwt | Guna |
|---|---|---|---|
| `pay-create` | app pelanggan (JWT) | default (on) | buat intent + charge di provider aktif |
| `pay-webhook/finpay` | Finpay | **off** | callback pembayaran (HMAC-SHA512) → cek status → ingest |
| `pay-webhook/finpay-disbursement` | Finpay | **off** | callback disbursement → `payout_event_ingest` |
| `pay-webhook/midtrans` | Midtrans | **off** | notifikasi transaksi dari `pay-create` (via `X-Override-Notification`) |
| `pay-webhook/simulated` | app (JWT pemilik) | **off** (JWT dicek di dalam) | simulasi sandbox, syarat ketat |
| `pay-refund` | Panel Admin (JWT, `refund_execute`) | default | eksekusi `refund_requests` berstatus `approved` |
| `pay-reconcile` | pg_cron (`x-cron-secret`) / service_role | **off** | PENDING menggantung, konfirmasi PAID H-1, `reconcile_daily` |
| `pay-disburse` | Panel Admin (JWT, `payout` + PIN) | default | `payout_execute_allowed` → inquiry → transfer Finpay Disbursement |
| `midtrans-create` | lama | default | hanya bila provider aktif Midtrans (order); kunci sesuai `payment_provider_env` saja |
| `midtrans-webhook` | Midtrans (URL dashboard lama) | **off** | pembungkus tipis → handler `pay-webhook/midtrans` yang sama (tidak ada lagi `payment_settle` langsung) |

Kode bersama `_shared/`: `providers/{types,finpay,midtrans,simulated,index}.ts`, `db.ts` (satu-satunya yang
mengimpor supabase-js), `config.ts` (`getSetting`, `loadPaySettings`, `getSecrets`), `http.ts` (CORS, `json`,
`timingSafeEqual`, batas body 64 KiB), `log.ts` (log JSON + redaksi otomatis), `crypto.ts`, `jsonutil.ts`
(serialisasi ala PHP, penghapusan field tekstual), `ids.ts`, `auth.ts`, `ingest.ts`.
Setiap fungsi = `handler.ts` (logika, bisa dites dengan Deps tiruan) + `index.ts` (`Deno.serve`).

## Env (Supabase → Edge Functions → Secrets)

Wajib:
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` — otomatis tersedia di edge runtime.
- `CRON_SECRET` — ≥ 16 karakter acak; dipakai pg_cron memanggil `pay-reconcile` (header `x-cron-secret`).

Opsional (override; normalnya kunci diisi admin di Panel Admin → `gateway_secrets`):
- `FINPAY_MERCHANT_ID`, `FINPAY_MERCHANT_KEY` + **wajib** `FINPAY_ENV=sandbox|production` (tanpa `FINPAY_ENV` override diabaikan; hanya berlaku untuk env itu), `FINPAY_BASE_URL`.
- `MIDTRANS_SERVER_KEY` berlaku hanya untuk env `MIDTRANS_IS_PRODUCTION` (true = production).
- `FINPAY_DISB_MERCHANT_ID`, `FINPAY_DISB_MERCHANT_KEY` — bila kredensial Disbursement berbeda (atau baris `gateway_secrets.provider='finpay_disbursement'`).
- `MIDTRANS_SERVER_KEY`, `MIDTRANS_CLIENT_KEY`, `MIDTRANS_IS_PRODUCTION`.
- `PAY_WEBHOOK_BASE_URL` — default `<SUPABASE_URL>/functions/v1`.
- `PAY_RETURN_URL` — successUrl/failUrl/backUrl (mis. deep link `antarkita://pay/return`).
- `FINPAY_CALLBACK_IP_ALLOWLIST`, `MIDTRANS_CALLBACK_IP_ALLOWLIST` — IP resmi provider dipisah koma. Kosong = TIDAK memblokir
  (peringatan `webhook_ip_allowlist_empty` dicatat sekali per isolate). Terisi = IP lain → 403. IP di allowlist bebas rate limit.
- `WEBHOOK_RATE_LIMIT_PER_MIN` — default 60 permintaan/menit per IP per rute webhook (memori isolate).
- `PAYMENTS_SIMULATION_HARD_OFF=true` — mematikan simulasi apa pun isi setting (disarankan di project production).

`gateway_secrets.extra` (jsonb, per provider+env) yang dikenali:
`channel_map` (override saluran → `sourceOfFunds.type`, nilai `null` = matikan), `base_url`, `paths`
(`initiate`, `check`, `refund`, `cancel`, `cancelMethod`), `disbursement_paths` (`inquiry`, `inquiryMethod`,
`transfer`, `check`), `amount_as_string` (bool), `refund_shape` (`"order_amount"`), `bank_map` (nama bank → kode).

## URL yang didaftarkan

- Finpay dashboard → Callback URL pembayaran: `https://qwltshvzrsykxdvhbxcv.supabase.co/functions/v1/pay-webhook/finpay`
  (juga dikirim per transaksi di `url.callbackUrl`).
- Finpay Disbursement → Callback: `https://qwltshvzrsykxdvhbxcv.supabase.co/functions/v1/pay-webhook/finpay-disbursement`
- Midtrans: transaksi dari `pay-create` mengirim header `X-Override-Notification` ke
  `https://qwltshvzrsykxdvhbxcv.supabase.co/functions/v1/pay-webhook/midtrans`. URL notifikasi di dashboard Midtrans boleh
  tetap `…/midtrans-webhook` — sejak v3 ia hanya pembungkus handler yang sama (verifikasi + `payment_event_ingest`).

### IP whitelist & rate limit
- IP klien (R6): `cf-connecting-ip` → `x-real-ip` → entri TERAKHIR `x-forwarded-for` (entri awal bisa dipalsukan).
- **Masuk (callback):** isi `FINPAY_CALLBACK_IP_ALLOWLIST` (dan opsional `MIDTRANS_CALLBACK_IP_ALLOWLIST`) dengan IP callback
  resmi (minta ke provider). Lapisan tambahan saja; keamanan utama = HMAC/SHA512 dengan kunci env transaksi + `checkStatus`.
- **Rate limit:** 60/menit per IP per rute (`finpay`, `finpay-disbursement`, `midtrans`, `simulated`), lewat → 429
  (Finpay: `responseCode 4290000`). Risiko: bila semua callback provider datang dari sedikit IP dan volume > 60/menit,
  callback sah ikut terkena 429 (provider mengirim ulang) → WAJIB isi allowlist IP provider di production (IP allowlist dikecualikan)
  atau naikkan `WEBHOOK_RATE_LIMIT_PER_MIN`. Batas di memori per isolate (bukan global).
- **Keluar (API call ke Finpay):** bila Finpay mewajibkan whitelist IP server merchant, Supabase Edge Functions **tidak
  punya IP egress statis**. Perlu konfirmasi ke Finpay; bila wajib → pakai proxy egress statis (`FINPAY_BASE_URL`
  menunjuk proxy) atau minta pengecualian. **PERLU VERIFIKASI.**

## Deploy

```bash
supabase functions deploy pay-create
supabase functions deploy pay-webhook   --no-verify-jwt
supabase functions deploy pay-refund
supabase functions deploy pay-reconcile --no-verify-jwt
supabase functions deploy pay-disburse
supabase functions deploy midtrans-create
supabase functions deploy midtrans-webhook --no-verify-jwt
supabase secrets set CRON_SECRET="$(openssl rand -hex 24)"
```

Cron (dijalankan Agen A/lead di migrasi; contoh — secret disimpan di Vault, bukan di SQL):
```sql
select cron.schedule('pay-reconcile-daily', '0 19 * * *',  -- 02:00 WIB
  $$select net.http_post(
      url := 'https://qwltshvzrsykxdvhbxcv.supabase.co/functions/v1/pay-reconcile',
      headers := jsonb_build_object('Content-Type','application/json',
                 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name='cron_secret')),
      body := '{}'::jsonb)$$);
select cron.schedule('pay-reconcile-pending', '*/15 * * * *',
  $$select net.http_post(url := 'https://qwltshvzrsykxdvhbxcv.supabase.co/functions/v1/pay-reconcile',
      headers := jsonb_build_object('Content-Type','application/json',
                 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name='cron_secret')),
      body := '{"skip_daily":true}'::jsonb)$$);
```

## Uji lokal

```bash
deno test supabase/functions/tests      # tanpa jaringan; fixture callback dibuat dari merchantKey uji
deno check supabase/functions/pay-*/index.ts
```

## Keamanan (ringkas)
- **Env terikat ke transaksi (T1).** Webhook mencari transaksi dulu (`payments` by `external_id`/`provider_ref`, service_role),
  mengambil `payments.env`, lalu memverifikasi signature HANYA dengan kunci `(provider, env)` itu, `checkStatus` ke host env itu
  (devo/live, api.sandbox/api), dan mengirim `p_env` ke `payment_event_ingest` (DB menolak `env_mismatch`). Tidak ada lagi
  "coba semua kunci/semua env". `pay-create` membuat charge dengan env intent (`payments.env`), `pay-refund`/`pay-reconcile`
  juga memakai env transaksi. Disbursement: env dari prefiks `external_id` buatan `pay-disburse` (`AKD-` production,
  `AKDS-` sandbox) yang dicari di `withdrawal_requests.provider_ref` (kolom env belum ada — lihat catatan Agen A).
- Transaksi tidak ditemukan / milik provider lain → **200 + log bersampel**, tanpa menulis apa pun (tidak membocorkan keberadaan order).
- Webhook Finpay: HMAC-SHA512 dicoba atas (a) raw body dengan field `signature` dihapus secara tekstual, (b) re-serialisasi
  ala PHP `json_encode` (escape `/` dan unicode; juga varian objek kosong → `[]`), (c) `JSON.stringify` ringkas — semuanya
  dengan kunci env transaksi. Perbandingan waktu-konstan. Setelah lolos, status **selalu** ditanyakan ulang (`checkStatus`) dan
  status + amount dari provider yang di-ingest. Provider tidak mengenal order → `UNCONFIRMED` (tidak pernah PAID).
- **Signature salah (S5)** → 401; TIDAK ditulis ke `payment_events` (append-only → cegah DoS). Hanya log bersampel
  (5 pertama lalu tiap ke-50) + penghitung di memori.
- `p_raw` = payload notifikasi di tingkat atas (dibaca `payment_settle`: `gross_amount`, `va_numbers`, `payment_type`,
  `settlement_time`) + `check` + `_antarkita{env, verified_via, channel, pay_status, note}`; sudah melewati redaksi
  (signature/kunci/token → `[REDACTED]`, PAN → 4 digit akhir, email/telepon/rekening disamarkan).
- Midtrans refund/partial_refund/chargeback diterima → REFUNDED/PARTIALLY_REFUNDED/DISPUTED; `p_raw.refund_amount` =
  total kumulatif (jumlah `refunds[].refund_amount`, atau `refund_amount`), diambil dari respons cek status lalu callback.
- `pay-create` purpose `order`: nominal dari `order_payment_prepare` (JWT pengguna), bukan dari body. Intent PENDING aktif
  yang dikembalikan DB (order & topup) → `reused`, tanpa charge baru; intent yang pernah di-charge tetapi instruksi bayarnya
  tidak tersimpan → 409 (tidak charge ulang `order.id` yang sama). Klaim atomik `checkout_token` mencegah charge ganda.
- Admin (`pay-refund`, `pay-disburse`): `admin_has(perm)` **dan** `admin_require_unlock()` wajib (PIN). `pay-disburse` juga
  memanggil `payout_execute_allowed(p_withdrawal)` sebelum inquiry/klaim (dual approval ≥ ambang).
- Simulasi: `payments_simulation_enabled=true` **dan** `payment_provider_env≠'production'` **dan** `payments.provider='simulated'`
  **dan** `payments.env≠'production'` **dan** pemilik JWT; DB mengecek ulang (`payments_simulation_active()`).

### Semantik retry (jawaban webhook)
| Kondisi | Finpay | Midtrans | Provider mengirim ulang? |
|---|---|---|---|
| Diproses / duplikat (`duplicate=true`) / terminal diabaikan (`ignored_terminal`, `no_change`, `env_mismatch` …) | 200 `2000000` | 200 | tidak |
| Transaksi tidak ditemukan / provider lain | 200 | 200 | tidak |
| Body rusak / tanpa order id | 400 | 400 | — |
| Signature salah | 401 | 401 | — |
| IP di luar allowlist | 403 | 403 | — |
| Rate limit | 429 | 429 | ya |
| Error DB (lookup/RPC melempar) atau RPC mengembalikan `note='error: …'` | 500 `5000000` | 500 | ya |
| `checkStatus` gagal dihubungi / kunci env belum diisi | 503 | 503 | ya |

Catatan untuk Agen A: `payment_event_ingest` saat ini menangkap error internal menjadi `note='error: …'` SETELAH baris
`payment_events` tersimpan — kiriman ulang provider akan terdeteksi duplikat dan tidak diproses ulang. Edge menjawab 500,
tetapi agar retry efektif RPC sebaiknya `raise` (rollback insert inbox) untuk error non-bisnis.

## RPC yang dipanggil (harus cocok dengan migrasi Agen A)

| RPC | Klien | Parameter | Diharapkan |
|---|---|---|---|
| `order_payment_prepare` | JWT pengguna | `p_order uuid, p_channel text` | jsonb `{order_id, code, channel, gross, expires_at, …}` (v2) |
| `payment_intent_create` | service_role | `p_user, p_purpose, p_order, p_amount, p_channel, p_provider` | baris `payments` (kolom §2; `support_ref`) |
| `payment_event_ingest` | service_role | `p_provider, p_event_id, p_external_id, p_provider_status, p_amount, p_signature_ok, p_raw, p_env` | `{duplicate, applied, pay_status, note}`; `note` `error: …` → edge 500 |
| `payout_event_ingest` | service_role | `p_external_id, p_status, p_raw` | `p_status` ∈ `PAYOUT_SETTLED/PAYOUT_PROCESSING/PAYOUT_FAILED` |
| `payout_execute_allowed` | service_role | `p_withdrawal uuid` | `{allowed, needs_approval, reason, pending_approval_id}` — `allowed≠true` → 409 |
| `refund_execute_result` | service_role | `p_id uuid, p_status text, p_provider_ref text, p_raw jsonb, p_note text` | `executing` = klaim atomik dari `approved`; `done`/`failed` final; `destination='wallet'` → `wallet_apply('refund')` di DB |
| `reconcile_daily` | service_role | `p_date date` (`p_kind`, `p_by` default) | ringkasan run |
| `admin_has` | JWT admin | `p_perm text` | `bool` (`refund_execute`, `payout`) |
| `admin_require_unlock` | JWT admin | — | WAJIB; error apa pun → 403 `need_unlock` |
| `antarpay_enabled`, `gateway_public_config`, `payment_channel_enabled(p_key)` | service_role | — | sudah ada (v2), untuk topup |

Nilai `p_provider_status` yang dikirim (DB memetakan per provider, KONTRAK §3):
- Finpay: status mentah huruf besar (`PAID`, `CAPTURED`, `PENDING`, `FAILURE`, `EXPIRED`, `CANCELLED`, `REFUNDED`, `PARTIALLY_REFUNDED`),
  plus `UNCONFIRMED` (diabaikan mesin status: `unknown_status`).
- Midtrans: `transaction_status` dengan `fraud_status` sudah dilipat (`capture`=accept, challenge→`pending`, deny→`deny`),
  `settlement`, `expire`, `cancel`, `failure`, `refund`, `partial_refund`, `chargeback`.
- Simulated: `PAID`/`FAILED`/`EXPIRED`. Rekonsiliasi: status provider seperti di atas; kedaluwarsa lokal → `EXPIRED` / `expire`.
- `raw._antarkita.pay_status` berisi status kanonik hasil normalisasi edge (untuk audit).
- Refund sukses: `p_event_id='refund-<refund_requests.id>'`, `p_amount` = nominal refund ini, `p_raw.refund_amount` =
  total refund KUMULATIF pembayaran (0105 mengisi `payments.refunded_amount` dari field ini), `p_raw.event_type='refund'`.

Tulisan langsung (service_role, di luar RPC — mohon disetujui atau diganti RPC oleh Agen A):
- `payments`: klaim `checkout_token='claim:<ts>:<n>'` + `external_id`/`provider_ref` (WHERE `checkout_token IS NULL`), lalu
  `checkout_url, checkout_token, qr_string, payment_code, expires_at, provider_txn_id, raw`.
- `withdrawal_requests`: klaim `provider='finpay', provider_ref, inquiry_ref, fee, payout_status='PAYOUT_PROCESSING'`
  (WHERE `status='approved' AND provider_ref IS NULL AND settled_at IS NULL`).
- Baca: `app_settings`, `gateway_secrets`, `payments`, `refund_requests`, `withdrawal_requests`, `profiles`.

## PERLU VERIFIKASI SANDBOX (belum bisa dibuktikan tanpa kredensial)

1. Kode `sourceOfFunds.type` persis (`qris`, `va_bca`…`va_bsi`, `ovo`, `dana`, `shopeepay`, `linkaja`, `finpaymoney`, `cc`,
   `indomaret`, `alfamart`, `kredivo`, `indodana`) — cocokkan dengan appendix source-of-funds-list. GoPay dianggap tidak
   didukung (tidak ada di daftar publik).
2. Apakah `sourceOfFunds` boleh dikosongkan (bank_transfer tanpa bank → halaman Finpay memilih).
3. Tipe `order.amount` (angka vs string) — default angka, `extra.amount_as_string=true` bila perlu.
4. Format `customer.mobilePhone` (dikirim `+62…`), wajib/tidaknya `email`/`lastName`.
5. Bentuk respons initiate (lokasi `redirecturl`, `stringQr`, `imageurl`, `paymentCode`, `expiryLink` + format waktunya — diasumsikan WIB bila tanpa zona).
6. Bentuk respons `GET /pg/payment/card/check/{orderId}` (lokasi status & amount; parser adaptif mencoba beberapa path).
7. Bentuk payload callback (lokasi `result.payment.status`, `amount`, `sourceOfFunds`) dan cara Finpay men-serialisasi saat menandatangani (varian mana yang lolos tercatat di `raw._antarkita.verified_via`).
8. Refund: body (`{order:{id}, refund:{amount,reason}}` vs `{order:{id,amount}}`), respons, dukungan refund per kanal (VA/QRIS/retail kemungkinan tidak bisa → `provider_unsupported` → tujuan wallet).
9. Cancel: metode HTTP (asumsi POST) & respons.
10. Disbursement: prefix path (`/disbursement/inquiry/`, `/disbursement/transfer`), metode & parameter inquiry (asumsi GET query `bankCode, accountNumber, amount`), format kode bank (asumsi kode BI 3 digit), body transfer, lokasi kode status (`00/03/04/06/08`), endpoint cek status (belum diketahui → `disbursement_paths.check` null), payload callback.
11. Apakah Finpay mewajibkan whitelist IP egress untuk API (lihat bagian IP).
12. Apakah Finpay mengirim ulang callback dengan body identik (event_id = hash body tanpa signature).
13. Midtrans: `X-Override-Notification` pada Snap (didukung dokumentasi Midtrans; cek di sandbox).

## Rencana uji sandbox (langkah demi langkah)

1. Minta kredensial sandbox Finpay (Merchant Id/Key payment + disbursement) dan daftar IP callback.
2. Admin: `admin_set_gateway_secret('finpay','sandbox', {merchant_id, server_key})`; setting `payment_provider_env='sandbox'`,
   `payment_provider_active='finpay'`. Daftarkan callback URL di dashboard devo.
3. `pay-create` QRIS Rp10.000 untuk order `awaiting_payment` → cek respons (`checkout_url`/`qr_string`), cek `payments`
   (`provider_ref`, `expires_at`, `raw.create`). Catat bentuk respons → sesuaikan parser bila perlu.
4. Bayar dengan simulator Finpay → log `payment_event_ingested`, `raw._antarkita.verified_via` (a/b/c), order jadi PAID,
   ledger tertulis. Kirim ulang callback yang sama (replay) → `duplicate=true`, 200.
5. Ubah satu byte body callback lalu POST manual → 401, tidak ada baris baru di `payment_events`. Callback bertanda tangan
   kunci sandbox untuk transaksi production → 401. POST > 60/menit dari satu IP non-allowlist → 429.
6. Ulangi 3–4 untuk tiap saluran: `va_bca/bri/bni/mandiri/permata/bsi`, `ovo`, `dana`, `shopeepay`, `linkaja`,
   `finpaymoney`, `cc`, `alfamart`, `indomaret`, `kredivo`, `indodana`. Kode yang ditolak → perbaiki `extra.channel_map`.
7. Biarkan satu transaksi kedaluwarsa → callback EXPIRED / `pay-reconcile` menandai EXPIRED. Bayar setelah EXPIRED (bila
   simulator mengizinkan) → `late_paid` + refund otomatis dibuat DB.
8. Tekan tombol bayar dua kali cepat → satu charge saja (satu `order.id` di dashboard Finpay).
9. Refund: buat `refund_request` partial & full (≥ `refund_dual_approval_min` → 2 admin) → `pay-refund` → status
   PARTIALLY_REFUNDED/REFUNDED; saluran yang tidak mendukung → `provider_unsupported` → ubah ke wallet.
10. `pay-reconcile` manual dengan `x-cron-secret` → ringkasan; bandingkan `reconciliation_runs`.
11. Disbursement: `pay-disburse {dry_run:true}` (inquiry saja) → nama pemilik; lalu transfer Rp10.000 → `payout_status`
    PROCESSING → callback → SETTLED; uji rekening salah → FAILED + saldo kembali.
12. Pindah `payment_provider_env='production'` hanya setelah semua di atas lolos; set `PAYMENTS_SIMULATION_HARD_OFF=true`.
