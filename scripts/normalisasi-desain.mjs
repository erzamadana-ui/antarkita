// Codemod normalisasi UI ke ANTARKITA_DESIGN_SYSTEM.md (12 Sep 2026).
// Dipakai sekali untuk memindahkan nilai hardcode lama ke skala token; dijalankan ulang
// aman (idempoten). Tidak menyentuh business logic — hanya literal gaya.
//
//   node scripts/normalisasi-desain.mjs            → ubah berkas + ringkasan
//   node scripts/normalisasi-desain.mjs --check    → hanya laporkan sisa pelanggaran (untuk CI)
//
// Aturan:
//   1. fontSize literal → skala 12 / 14 / 16 / 18 / 22 / 24 / 30 (tidak ada teks < 12).
//   2. fontWeight '800'/'900' → '700'  (desain melarang 800/900).
//   3. Spasi/padding/margin/gap bernilai GANJIL ≥ 5 → kelipatan 4 terdekat (13→12, 17→16, 21→20, 27→28).
//   4. lineHeight yang lebih kecil dari tinggi baris token ukuran barunya (dalam objek gaya yang sama) dinaikkan.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const CHECK = process.argv.includes('--check');
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const LH = { 12: 16, 14: 20, 16: 22, 18: 24, 22: 28, 24: 30, 30: 36 };

function mapSize(n) {
  if (n <= 12) return 12;
  if (n <= 14) return 14;
  if (n <= 16) return 16;
  if (n <= 18) return 18;
  if (n <= 22) return 22;
  if (n <= 26) return 24;
  return 30;
}
const round4 = (n) => Math.max(4, Math.round(n / 4) * 4);

function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx|ts)$/.test(f) && !/\.d\.ts$/.test(f)) out.push(p);
  }
  return out;
}

const SKIP = new Set(['src/lib/theme.ts', 'src/components/admin.tsx']);   // token pusat: diatur manual
const SPACE_KEYS = 'padding|paddingHorizontal|paddingVertical|paddingTop|paddingBottom|paddingLeft|paddingRight|margin|marginHorizontal|marginVertical|marginTop|marginBottom|marginLeft|marginRight|gap|rowGap|columnGap';

let stat = { files: 0, fontSize: 0, weight: 0, space: 0, lineHeight: 0, sisa: [] };
for (const file of walk(path.join(ROOT, 'src'))) {
  const rel = path.relative(ROOT, file);
  if (SKIP.has(rel)) continue;
  let s = readFileSync(file, 'utf8'); const before = s;

  // 2. bobot
  s = s.replace(/fontWeight:\s*'(800|900)'/g, () => { stat.weight++; return "fontWeight: '700'"; });
  s = s.replace(/\bfam\((800|900)\)/g, () => { stat.weight++; return 'fam(700)'; });

  // 1. ukuran huruf (hanya literal angka)
  s = s.replace(/fontSize:\s*(\d+(?:\.\d+)?)(?![\d.])/g, (m, n) => {
    const v = Number(n); const t = mapSize(v);
    if (t !== v) stat.fontSize++;
    return `fontSize: ${t}`;
  });

  // 4. lineHeight dalam objek gaya yang sama dengan fontSize (tanpa kurung kurawal bersarang)
  s = s.replace(/\{[^{}]*\}/g, (obj) => {
    const fs = /fontSize:\s*(\d+)/.exec(obj); const lh = /lineHeight:\s*(\d+(?:\.\d+)?)/.exec(obj);
    if (!fs || !lh) return obj;
    const want = LH[Number(fs[1])]; const have = Number(lh[1]);
    if (want && have < want) { stat.lineHeight++; return obj.replace(/lineHeight:\s*\d+(?:\.\d+)?/, `lineHeight: ${want}`); }
    return obj;
  });

  // 3. spasi ganjil
  s = s.replace(new RegExp(`\\b(${SPACE_KEYS}):\\s*(-?)(\\d+)(?![\\d.%])`, 'g'), (m, k, neg, n) => {
    const v = Number(n);
    if (v < 5 || v % 2 === 0) return m;
    stat.space++;
    return `${k}: ${neg}${round4(v)}`;
  });

  // sisa pelanggaran untuk laporan
  for (const m of s.matchAll(/fontSize:\s*(\d+)/g)) if (![12, 14, 16, 18, 22, 24, 30].includes(Number(m[1]))) stat.sisa.push(`${rel}: fontSize ${m[1]}`);
  for (const m of s.matchAll(/fontWeight:\s*'(800|900)'/g)) stat.sisa.push(`${rel}: fontWeight ${m[1]}`);

  if (s !== before) { stat.files++; if (!CHECK) writeFileSync(file, s); }
}
console.log(JSON.stringify({ mode: CHECK ? 'check' : 'write', ...stat, sisa: stat.sisa.length }, null, 0));
if (stat.sisa.length) console.log(stat.sisa.slice(0, 20).join('\n'));
if (CHECK && (stat.files > 0 || stat.sisa.length > 0)) process.exit(1);
