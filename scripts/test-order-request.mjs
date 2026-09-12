// Uji kunci idempotensi pesanan (src/lib/orders.ts) TANPA server — memakai KODE ASLI
// dengan rpc dipalsukan. Pasangannya di sisi basis data: supabase/tests/uji_idempotensi.sql.
//
// Jalankan:  node scripts/test-order-request.mjs
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function compile(file, stubs) {
  const js = ts.transpileModule(readFileSync(path.join(ROOT, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  const req = (name) => { if (!(name in stubs)) throw new Error(`modul tak terduga: ${name}`); return stubs[name]; };
  // eslint-disable-next-line no-new-func
  new Function('exports', 'require', 'module', js)(module.exports, req, module);
  return module.exports;
}

const calls = [];
let fail = false;
const orders = compile('src/lib/orders.ts', {
  './supabase': { rpc: async (fn, args) => { calls.push({ fn, p: args.p }); if (fail) throw new Error('jaringan putus'); return { id: 'o-' + calls.length, ...args.p }; } },
  './types': {},
});

const base = { service: 'ride_motor', pickup: { lat: 0.481, lng: 101.4349, address: 'A' }, dropoff: { lat: 0.5, lng: 101.44, address: 'B' }, paid_via: 'wallet', route_km: 3.1, route_geometry: [[0, 1]], duration_min: 9 };
let n = 0;
const ok = (msg) => { n++; console.log(`[OK] ${n}. ${msg}`); };

// 1. isi sama → kunci sama (geometri/jarak yang berubah tiap percobaan diabaikan)
const k1 = orders.orderRequestKey(base);
const k2 = orders.orderRequestKey({ ...base, route_km: 3.4, route_geometry: [[9, 9]], duration_min: 11 });
assert.equal(k1, k2); ok('kunci tidak berubah walau rute/jarak berubah antar percobaan');

// 2. isi beda → kunci beda
assert.notEqual(k1, orders.orderRequestKey({ ...base, dropoff: { lat: 0.52, lng: 101.46, address: 'C' } })); ok('tujuan berbeda → kunci berbeda');
assert.notEqual(k1, orders.orderRequestKey({ ...base, paid_via: 'cash' })); ok('metode bayar berbeda → kunci berbeda');

// 3. retry setelah gagal jaringan memakai kunci yang SAMA
fail = true; await assert.rejects(orders.createOrder(base)); fail = false;
await orders.createOrder(base);
assert.equal(calls.length, 2); assert.equal(calls[0].p.client_request_id, calls[1].p.client_request_id); ok('retry setelah gagal jaringan mengirim client_request_id yang sama');
assert.ok(calls[1].p.client_request_id.length <= 80); ok('panjang kunci ≤ 80 (batas server)');

// 4. sesudah BERHASIL, pesanan identik yang disengaja memakai kunci baru
await orders.createOrder(base);
assert.notEqual(calls[2].p.client_request_id, calls[1].p.client_request_id); ok('pesanan identik setelah sukses → kunci baru (nonce diputar)');

// 5. payload asli tidak diubah (tanpa efek samping)
assert.equal(base.client_request_id, undefined); ok('objek payload pemanggil tidak dimutasi');

console.log(`\nSemua ${n} pemeriksaan lulus.`);
