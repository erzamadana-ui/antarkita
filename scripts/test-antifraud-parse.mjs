// Uji helper MURNI 31 Okt TANPA server — memakai KODE ASLI src/lib/{antifraud,dispatch,payout,travelQuote}.ts
// (kontrak: docs/KONTRAK-31OKT.md). Pasangan uji sisi basis data: supabase/tests/uji_*_012x.sql.
//
// Jalankan:  node scripts/test-antifraud-parse.mjs
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function compile(file, stubs = {}) {
  const js = ts.transpileModule(readFileSync(path.join(ROOT, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  const req = (name) => { if (!(name in stubs)) throw new Error(`modul tak terduga: ${name}`); return stubs[name]; };
  // eslint-disable-next-line no-new-func
  new Function('exports', 'require', 'module', js)(module.exports, req, module);
  return module.exports;
}

let n = 0;
const ok = (msg) => { n++; console.log(`[OK] ${n}. ${msg}`); };
const af = compile('src/lib/antifraud.ts');
const dp = compile('src/lib/dispatch.ts');
const po = compile('src/lib/payout.ts');
const tq = compile('src/lib/travelQuote.ts');

// ------------------------------------------------------------------ 0121 antifraud
{
  const e = af.parseOrderError(new Error('PHONE_REQUIRED: lengkapi nomor telepon di profil sebelum memesan.'));
  assert.equal(e.code, 'PHONE_REQUIRED'); assert.equal(e.cta, 'phone'); assert.equal(e.route, '/account/edit'); ok('PHONE_REQUIRED → CTA Isi nomor HP (/account/edit)');
  const c = af.parseOrderError('CASH_BLOCKED: pembayaran tunai dinonaktifkan sampai 30 Nov 2026 karena 2 laporan tidak hadir.');
  assert.equal(c.code, 'CASH_BLOCKED'); assert.equal(c.route, '/pay/voucher'); assert.match(c.until, /30/); ok('CASH_BLOCKED → CTA Beli AntarVoucher, tanggal terbaca');
  const r = af.parseOrderError('ORDER_RATE: maksimal 3 pesanan per jam. Coba lagi beberapa saat.');
  assert.equal(r.cta, 'wait'); assert.equal(r.ctaLabel, null); ok('ORDER_RATE → tunggu tanpa CTA');
  const cap = af.parseOrderError('NEW_ACCOUNT_CASH_CAP: akun baru (< 24 jam) hanya bisa bayar tunai maksimal Rp100.000 — gunakan saldo.');
  assert.equal(cap.cta, 'wallet'); assert.equal(cap.cashMax, 100000); ok('NEW_ACCOUNT_CASH_CAP → batas tunai Rp100.000 terbaca');
  assert.equal(af.parseOrderError(new Error('Saldo tidak cukup')), null); ok('galat lain → null (tidak dipetakan)');
  assert.equal(af.parseOrderError('SALDO_KURANG:15000'), null); ok('SALDO_KURANG bukan galat antifraud');

  const w = af.parseNoShowWait('NOSHOW_WAIT: tunggu minimal 5 menit sejak tiba sebelum melapor', new Date(Date.now() - 2 * 60000).toISOString());
  assert.equal(w.waitMinutes, 5); assert.equal(w.leftMinutes, 3); ok('NOSHOW_WAIT 5 menit, tiba 2 menit lalu → sisa 3 menit');
  assert.equal(af.noShowMinutesLeft(new Date(Date.now() - 6 * 60000).toISOString(), 5), 0); ok('sudah ≥ 5 menit → boleh melapor (sisa 0)');

  const st = { strike_count: 0, cash_blocked_until: null, cash_blocked: false, phone_verified: true, account_age_hours: 2, is_new_account: true, cash_max_now: 100000, orders_last_hour: 0, active_orders: 0, strikes: [], limits: {} };
  assert.equal(af.antifraudBanner(st, 50000), null); ok('akun baru, total ≤ batas → tanpa banner');
  assert.equal(af.antifraudBanner(st, 150000).tone, 'info'); ok('akun baru, total > batas → banner info AntarVoucher');
  assert.equal(af.antifraudBanner({ ...st, strike_count: 1, is_new_account: false, cash_max_now: null }).tone, 'warning'); ok('1 strike → banner peringatan');
  assert.equal(af.antifraudBanner({ ...st, cash_blocked: true, strike_count: 2 }).tone, 'danger'); ok('tunai diblokir → banner bahaya');
  assert.equal(af.friendlyNotifText({ kind: 'accept_no_move' }).tone, 'warning'); ok('notifikasi accept_no_move → teks ramah peringatan');
  assert.equal(af.friendlyNotifText({ event: 'driver_released' }).title, 'Driver diganti'); ok('notifikasi driver_released → "Driver diganti"');
  assert.equal(af.friendlyNotifText({ kind: 'order' }), null); ok('notifikasi biasa → null');
}

// ------------------------------------------------------------------ 0122 dispatch
{
  const now = Date.now();
  const exp = new Date(now + 20_000).toISOString();
  const rows = [
    { id: 'a', dispatch_mode: 'broadcast', offer_id: null, offer_expires_at: null },
    { id: 'b', dispatch_mode: 'offer', offer_id: 'f1', offer_expires_at: exp },
    { id: 'c', dispatch_mode: 'offer', offer_id: 'f2', offer_expires_at: new Date(now - 1000).toISOString() },
  ];
  const { offers, rest } = dp.splitOffers(rows, now);
  assert.deepEqual(offers.map((o) => o.id), ['b']); assert.deepEqual(rest.map((o) => o.id), ['a', 'c']); ok('splitOffers: penawaran aktif dipisah, yang kedaluwarsa kembali ke siaran');
  assert.equal(dp.offerSecondsLeft(exp, now), 20); ok('offerSecondsLeft dari expires_at = 20 dtk');
  const held = dp.parseOfferHeld(new Error('OFFER_HELD: order sedang ditawarkan ke driver lain (17 dtk) — coba lagi setelah itu'));
  assert.equal(held.secondsLeft, 17); assert.match(held.text, /17 dtk/); ok('OFFER_HELD → sisa 17 dtk terbaca');
  assert.equal(dp.parseOfferHeld('DEPOSIT_REQUIRED: x'), null); ok('galat lain bukan OFFER_HELD');
  const st4 = dp.noMoveState(new Date(now - 4.5 * 60000).toISOString(), 5, now);
  assert.equal(st4.warn, true); assert.equal(st4.critical, false); assert.equal(st4.leftSec, 30); ok('4,5 menit sejak accept → peringatan, sisa 30 dtk');
  assert.equal(dp.noMoveState(new Date(now - 6 * 60000).toISOString(), 5, now).critical, true); ok('6 menit → kritis (server boleh melepas)');
  assert.equal(dp.mmss(47), '0:47'); assert.equal(dp.mmss(125), '2:05'); ok('mmss');
  assert.equal(dp.isOrderOfferPush({ kind: 'order_offer' }), true); ok('push kind order_offer dikenali');
  const f = { offer_id: 'f9', order_id: 'o9', code: 'AK1', round: 2, offered_at: '', expires_at: exp, seconds_left: 20, service: 'ride_motor', service_label: 'AntarRide', pickup_address: 'A', dropoff_address: 'B', pickup_lat: 0, pickup_lng: 0, dropoff_lat: 0, dropoff_lng: 0, distance_km: '3.2', distance_to_pickup_km: '0.8', fare_delivery: 10000, items_subtotal: 0, total: 12000, driver_earning: 9000, driver_service_share: null, payment_method: 'cash', merchant_name: null, vehicle_class: null, helpers: null, weight_kg: null, notes: null, created_at: '' };
  const row = dp.offerToAvailable(f, now);
  assert.equal(row.dispatch_mode, 'offer'); assert.equal(row.distance_km, 3.2); assert.equal(row.offer_seconds_left, 20); assert.match(row.priority_note, /ronde 2/); ok('driver_offer_mine → baris AvailableOrder (angka string dikonversi)');
  let got = null; const off = dp.onDispatchEvent((ev) => { got = ev; }); dp.emitDispatchEvent('offer'); off(); dp.emitDispatchEvent('released');
  assert.equal(got, 'offer'); ok('bus kejadian: berlangganan menerima, setelah dilepas tidak lagi');
}

// ------------------------------------------------------------------ 0123 payout
{
  assert.equal(po.validatePayoutForm({ channel: 'bank', bank_code: null, account_no: '1234567', account_name: 'BUDI', auto_sweep: true }), 'Pilih bank tujuan'); ok('bank tanpa kode → tolak');
  assert.equal(po.validatePayoutForm({ channel: 'bank', bank_code: 'bca', account_no: '12345', account_name: 'BUDI', auto_sweep: true }), 'Nomor rekening harus 6–20 digit'); ok('rekening 5 digit → tolak');
  assert.equal(po.validatePayoutForm({ channel: 'dana', bank_code: null, account_no: '0712345678', account_name: 'BUDI', auto_sweep: true }), 'Nomor e-wallet harus nomor HP 08xx (9–15 digit)'); ok('e-wallet bukan 08xx → tolak');
  assert.equal(po.validatePayoutForm({ channel: 'dana', bank_code: null, account_no: '0812-3456-789', account_name: 'Budi Santoso', auto_sweep: true }), null); ok('DANA 0812… (dengan strip) → layak');
  const pl = po.payoutPayload({ channel: 'dana', bank_code: null, account_no: '0812-3456-789', account_name: ' Budi ', auto_sweep: false });
  assert.deepEqual(pl, { channel: 'dana', bank_code: 'dana', account_no: '0812345678' + '9', account_name: 'Budi', auto_sweep: false }); ok('payload e-wallet: bank_code = channel, digit saja, nama di-trim');
  assert.equal(po.payoutPayload({ channel: 'bank', bank_code: 'bca', account_no: '123 456 7', account_name: 'X Y', auto_sweep: true }).bank_code, 'bca'); ok('payload bank: bank_code dari pilihan');
  const mine = { exists: true, required: true, min_sweep: 20000, sweep_enabled: true, channel: 'bank', bank_code: 'bca', bank_name: 'BCA', account_no: '1234567890', account_no_masked: '•••• 7890', account_name: 'BUDI', verified: false, auto_sweep: true };
  assert.equal(po.accountSummary(mine), 'BCA •••• 7890 a.n. BUDI'); ok('ringkasan rekening satu baris');
  assert.equal(po.verificationBadge(mine).tone, 'warning'); assert.equal(po.verificationBadge({ exists: false, required: true }).tone, 'muted'); ok('badge verifikasi');
  assert.equal(po.isPayoutRequiredError(new Error('PAYOUT_ACCOUNT_REQUIRED: rekening pencairan wajib')), true); assert.equal(po.isPayoutRequiredError('DEPOSIT_REQUIRED'), false); ok('deteksi PAYOUT_ACCOUNT_REQUIRED');
  assert.equal(po.formFromMine(mine).bank_code, 'bca'); assert.equal(po.formFromMine(null).channel, 'bank'); ok('form dari rekening tersimpan / kosong');
}

// ------------------------------------------------------------------ 0124 travel
{
  const pr = tq.parseTravelPriceError(new Error('TRAVEL_PRICE_OUT_OF_RANGE: harga kursi Rp250.000 di luar ±10 % acuan Rp192.000 (Hiace Commuter) — rentang Rp172.800–Rp211.200'));
  assert.equal(pr.code, 'TRAVEL_PRICE_OUT_OF_RANGE'); assert.equal(pr.min, 172800); assert.equal(pr.max, 211200); assert.equal(pr.reference, 192000); ok('TRAVEL_PRICE_OUT_OF_RANGE → rentang & acuan terbaca');
  const lo = tq.parseTravelPriceError('TRAVEL_OFFER_TOO_LOW: tawaran Rp800.000 di bawah 90 % acuan carter Avanza Rp1.100.000 (minimal Rp990.000)');
  assert.equal(lo.code, 'TRAVEL_OFFER_TOO_LOW'); assert.equal(lo.min, 990000); assert.equal(lo.reference, 1100000); ok('TRAVEL_OFFER_TOO_LOW → minimum & acuan terbaca');
  assert.equal(tq.parseTravelPriceError('Rute belum tersedia'), null); ok('galat lain → null');
  assert.deepEqual(tq.priceRange(192000, 10), { min: 172800, max: 211200 }); ok('priceRange ±10 %');
  assert.equal(tq.priceInRange(172800, 192000, 10), true); assert.equal(tq.priceInRange(172799, 192000, 10), false); ok('priceInRange batas bawah inklusif');
  assert.equal(tq.offerMinPrice(1100000, 90), 990000); ok('offerMinPrice 90 %');
  const cards = [{ id: '1', vehicle_model: 'Avanza/Xenia', seats: 7 }, { id: '2', vehicle_model: 'Hiace Commuter', seats: 14 }, { id: '3', vehicle_model: 'Innova Reborn', seats: 7 }];
  assert.equal(tq.matchRateCard(cards, 'Toyota Hi-Ace Commuter 2022').id, '2'); assert.equal(tq.matchRateCard(cards, 'Toyota Innova Reborn').id, '3'); assert.equal(tq.matchRateCard(cards, ''), null); ok('matchRateCard dari nama model mitra');
}

console.log(`\nSemua ${n} pemeriksaan lulus.`);
