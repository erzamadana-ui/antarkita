// Menyiapkan modul NYATA aplikasi agar bisa dijalankan langsung di peramban uji.
//
// Yang dikompilasi apa adanya (tanpa diubah isinya):
//   • src/lib/mapConfig.ts        — pembacaan konfigurasi peta dari server + nilai bawaan aman
//   • src/lib/geo.ts              — adaptor penyedia (autocomplete, reverse geocode, rute)
//   • src/components/map/shared.ts— pembangun HTML peta Leaflet + penjaga fit ulang
//
// Ketergantungan berat (react, react-native, zustand, AsyncStorage, klien Supabase)
// diganti stub tipis; `rpc()` diarahkan ke server tiruan sehingga alur cache alamat
// dan pembacaan map_public_config benar-benar dijalankan lewat jaringan.
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const out = join(here, 'build');

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'lib'), { recursive: true });
mkdirSync(join(out, 'map'), { recursive: true });

const REWRITE = {
  './supabase': './supabase.js',
  './mapConfig': './mapConfig.js',
  './types': './types.js',
  '@/lib/types': '../lib/types.js',
  '@/lib/geo': '../lib/geo.js',
  '@/lib/mapConfig': '../lib/mapConfig.js',
  react: './react.js',
  'react-native': './react-native.js',
  '@react-native-async-storage/async-storage': './async-storage.js',
  zustand: './zustand.js',
};

function compile(srcRel, outRel) {
  const code = readFileSync(join(root, srcRel), 'utf8');
  const js = ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.ES2020, target: ts.ScriptTarget.ES2020, isolatedModules: true },
    fileName: srcRel,
  }).outputText;
  const fixed = js.replace(/(from\s+|import\s*\()\s*(['"])([^'"]+)\2/g, (m, pre, q, spec) => {
    const to = REWRITE[spec] ?? spec;
    return `${pre}${q}${to}${q}`;
  });
  writeFileSync(join(out, outRel), fixed);
  return outRel;
}

compile('src/lib/mapConfig.ts', 'lib/mapConfig.js');
compile('src/lib/geo.ts', 'lib/geo.js');
compile('src/components/map/shared.ts', 'map/shared.js');

// --- stub tipis -----------------------------------------------------------------------
writeFileSync(join(out, 'lib/types.js'), 'export {};\n');
writeFileSync(join(out, 'lib/react.js'), 'export function useEffect() {}\nexport default { useEffect };\n');
writeFileSync(join(out, 'lib/react-native.js'), `
export const AppState = { addEventListener() { return { remove() {} }; } };
export const Platform = { OS: 'web' };
`);
writeFileSync(join(out, 'lib/async-storage.js'), `
export default {
  async getItem(k) { try { return globalThis.localStorage?.getItem(k) ?? null; } catch { return null; } },
  async setItem(k, v) { try { globalThis.localStorage?.setItem(k, v); } catch {} },
};
`);
// zustand versi minimal: cukup untuk create()/getState()/setState() yang dipakai mapConfig.ts
writeFileSync(join(out, 'lib/zustand.js'), `
export function create(init) {
  let state;
  const set = (patch) => { state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }; };
  const get = () => state;
  state = init(set, get);
  const useStore = (sel) => (sel ? sel(state) : state);
  useStore.getState = get;
  useStore.setState = set;
  return useStore;
}
`);
// rpc() diarahkan ke server tiruan — jadi map_public_config / resolve_address / cache_address
// benar-benar melewati jaringan, persis seperti di aplikasi.
writeFileSync(join(out, 'lib/supabase.js'), `
export async function rpc(fn, params) {
  const res = await fetch('/mock/rpc/' + fn, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params ?? {}),
  });
  if (!res.ok) throw new Error('rpc ' + fn + ' HTTP ' + res.status);
  return res.json();
}
export function realtimeChannel() { return { on() { return this; }, subscribe() { return this; } }; }
export const supabase = {};
`);

// Leaflet dari node_modules — dipakai apa adanya oleh buildMapHtml()
const leafletJs = readFileSync(join(root, 'node_modules/leaflet/dist/leaflet.js'), 'utf8');
const leafletCss = readFileSync(join(root, 'node_modules/leaflet/dist/leaflet.css'), 'utf8');
writeFileSync(join(out, 'leaflet.js.txt'), leafletJs);
writeFileSync(join(out, 'leaflet.css.txt'), leafletCss);

console.log('harness siap:', out);
