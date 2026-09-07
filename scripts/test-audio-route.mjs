// Uji logika rute audio panggilan TANPA perangkat: src/lib/audioRoute.native.ts dijalankan
// dengan modul native `expo-audio` dan `react-native` yang dipalsukan, lalu setiap panggilan
// setAudioModeAsync dicatat dan diperiksa.
//
// Jalankan:  node scripts/test-audio-route.mjs
//
// Yang dibuktikan:
//   1. startCallAudio() menyalakan sesi rekam + rute bawaan = loudspeaker.
//   2. setSpeaker(false) → shouldRouteThroughEarpiece TRUE  (earpiece).
//   3. setSpeaker(true)  → shouldRouteThroughEarpiece FALSE (loudspeaker).
//   4. getSpeaker() selalu mengikuti rute yang BENAR-BENAR diterapkan.
//   5. Bila modul native menolak (melempar), setSpeaker mengembalikan false dan status TIDAK berubah.
//   6. Tanpa modul native sama sekali → speakerSupported false & setSpeaker selalu false (UI menonaktifkan tombol).
//   7. stopCallAudio() melepas sesi panggilan (allowsRecording false).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src/lib/audioRoute.native.ts');

/** Muat audioRoute.native.ts sebagai modul CommonJS dengan dependensi palsu. */
function loadAudioRoute({ withExpoAudio = true, failOnce = false } = {}) {
  const calls = [];
  let fail = failOnce;
  const fakeExpoAudio = {
    async setAudioModeAsync(mode) {
      if (fail) { fail = false; throw new Error('perangkat menolak mode audio'); }
      calls.push(mode);
    },
  };
  const stubs = {
    'react-native': { Platform: { OS: 'android' } },
    'expo-audio': withExpoAudio ? fakeExpoAudio : null,   // null = paket tidak terpasang
  };
  const js = ts.transpileModule(readFileSync(SRC, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const module = { exports: {} };
  const req = (name) => {
    if (!(name in stubs)) throw new Error(`modul tak terduga: ${name}`);
    const v = stubs[name];
    if (v === null) throw new Error(`Cannot find module '${name}'`);   // meniru paket yang belum dipasang
    return v;
  };
  // eslint-disable-next-line no-new-func
  new Function('exports', 'require', 'module', js)(module.exports, req, module);
  return { api: module.exports, calls, setFail: (v) => { fail = v; } };
}

const last = (calls) => calls[calls.length - 1];
let ok = 0;
const check = (label, fn) => { fn(); ok++; console.log('  ✓ ' + label); };

console.log('audioRoute.native.ts — uji logika rute audio');

// ---------------------------------------------------------------- kasus normal
{
  const { api, calls, setFail } = loadAudioRoute();

  check('modul native terdeteksi → speakerSupported true', () => {
    assert.equal(api.speakerSupported, true);
    assert.equal(api.getSpeaker(), true, 'bawaan panggilan = loudspeaker');
  });

  await api.startCallAudio();
  check('startCallAudio() menyiapkan sesi panggilan (loudspeaker)', () => {
    assert.equal(calls.length, 1);
    assert.equal(last(calls).allowsRecording, true, 'iOS butuh playAndRecord agar rute bisa dipindah');
    assert.equal(last(calls).playsInSilentMode, true, 'iOS melempar bila false saat allowsRecording true');
    assert.equal(last(calls).shouldRouteThroughEarpiece, false);
  });

  const toEarpiece = await api.setSpeaker(false);
  check('setSpeaker(false) → earpiece', () => {
    assert.equal(toEarpiece, true);
    assert.equal(last(calls).shouldRouteThroughEarpiece, true);
    assert.equal(api.getSpeaker(), false);
  });

  const toSpeaker = await api.setSpeaker(true);
  check('setSpeaker(true) → loudspeaker', () => {
    assert.equal(toSpeaker, true);
    assert.equal(last(calls).shouldRouteThroughEarpiece, false);
    assert.equal(api.getSpeaker(), true);
  });

  // Perangkat menolak sekali (mis. sesi audio dipakai aplikasi lain).
  setFail(true);
  const before = api.getSpeaker();
  const applied = await api.setSpeaker(false);
  check('gagal menerapkan → false & status tidak berbohong', () => {
    assert.equal(applied, false, 'UI harus tahu perpindahan TIDAK terjadi');
    assert.equal(api.getSpeaker(), before, 'status harus kembali ke rute yang benar-benar berlaku');
  });

  await api.stopCallAudio();
  check('stopCallAudio() melepas sesi panggilan & reset ke loudspeaker', () => {
    assert.equal(last(calls).allowsRecording, false);
    assert.equal(last(calls).shouldRouteThroughEarpiece, false);
    assert.equal(api.getSpeaker(), true);
  });
}

// ------------------------------------------------- kasus modul native tidak ada
{
  const { api, calls } = loadAudioRoute({ withExpoAudio: false });
  check('tanpa expo-audio → tombol speaker dinonaktifkan, bukan error', async () => {
    assert.equal(api.speakerSupported, false);
    assert.equal(calls.length, 0);
  });
  assert.equal(await api.setSpeaker(true), false);
  await api.startCallAudio();
  await api.stopCallAudio();
  check('tanpa expo-audio → semua fungsi aman dipanggil (tidak melempar)', () => {
    assert.equal(calls.length, 0);
  });
}

console.log(`\n${ok} pemeriksaan lulus.`);
