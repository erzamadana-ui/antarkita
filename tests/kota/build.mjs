// Menyiapkan modul NYATA aplikasi agar bisa dijalankan langsung di peramban uji.
//
// Yang dikompilasi APA ADANYA (isinya tidak diubah sedikit pun):
//   • src/hooks/useCityStatus.ts — keputusan "layanan ini boleh dipesan dari titik ini?",
//     sifat gagal-aman, cache per petak, dan kalimat tombol `cityBlockedLabel()`.
//
// Jadi yang diuji peramban BUKAN tiruan logika, melainkan kode yang benar-benar dipakai
// layar Ride/Car/Send/Box/Shop/Market/Food/Travel. Komponen tampilannya (React Native)
// diganti kerangka HTML tipis di harness.html yang memakai keputusan itu apa adanya.
//
// Ketergantungan berat (react, zustand, klien Supabase) diganti stub tipis; `rpc()`
// diarahkan ke server tiruan sehingga alurnya benar-benar lewat jaringan.
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const out = join(here, 'build');

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'lib'), { recursive: true });

const REWRITE = {
  '@/lib/supabase': './lib/supabase.js',
  '@/lib/types': './lib/types.js',
  react: './lib/react.js',
  zustand: './lib/zustand.js',
};

function compile(srcRel, outRel) {
  const code = readFileSync(join(root, srcRel), 'utf8');
  const js = ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.ES2020, target: ts.ScriptTarget.ES2020, isolatedModules: true },
    fileName: srcRel,
  }).outputText;
  const fixed = js.replace(/(from\s+|import\s*\()\s*(['"])([^'"]+)\2/g, (m, pre, q, spec) =>
    `${pre}${q}${REWRITE[spec] ?? spec}${q}`);
  writeFileSync(join(out, outRel), fixed);
}

compile('src/hooks/useCityStatus.ts', 'useCityStatus.js');

writeFileSync(join(out, 'lib/types.js'), 'export {};\n');

// rpc() nyata diganti pemanggil server tiruan — bentuk galatnya ditiru persis
// (Error dengan pesan dari server) supaya cabang try/catch di hook ikut teruji.
writeFileSync(join(out, 'lib/supabase.js'), `
export async function rpc(fn, params) {
  const r = await fetch('/mock/rpc/' + fn, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params ?? {}),
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error(data?.message ?? 'Terjadi kesalahan');
  return data;
}
`);

// React tiruan seperlunya: useEffect/useCallback/useState dipanggil lewat "render" manual
// di harness (satu komponen, tanpa rekonsiliasi) — cukup untuk menguji keputusan hook.
writeFileSync(join(out, 'lib/react.js'), `
let cell = [], idx = 0, rerender = () => {};
export function __beginRender(fn) { idx = 0; rerender = fn; }
export function useState(init) {
  const i = idx++;
  if (!(i in cell)) cell[i] = typeof init === 'function' ? init() : init;
  return [cell[i], (v) => { cell[i] = typeof v === 'function' ? v(cell[i]) : v; rerender(); }];
}
export function useCallback(fn) { return fn; }
export function useMemo(fn) { return fn(); }
const seen = new Map();
export function useEffect(fn, deps) {
  const i = idx++;
  const prev = seen.get(i);
  const same = prev && deps && prev.length === deps.length && prev.every((v, n) => v === deps[n]);
  if (!same) { seen.set(i, deps); fn(); }
}
export default { useState, useCallback, useMemo, useEffect };
`);

// zustand minimal dengan langganan — hook memakai selector + getState.
writeFileSync(join(out, 'lib/zustand.js'), `
export function create(init) {
  let state; const subs = new Set();
  const set = (patch) => { state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }; subs.forEach((f) => f(state)); };
  const get = () => state;
  state = init(set, get);
  const useStore = (sel) => (sel ? sel(state) : state);
  useStore.getState = get;
  useStore.setState = set;
  useStore.subscribe = (f) => { subs.add(f); return () => subs.delete(f); };
  return useStore;
}
`);

console.log('build kota siap');
