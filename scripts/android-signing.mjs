#!/usr/bin/env node
// Tambahkan signingConfig "release" (upload keystore) ke proyek Android hasil `expo prebuild`.
// Dipakai oleh .github/workflows/release-aab.yml sebelum `./gradlew bundleRelease`.
//
//   node scripts/android-signing.mjs [--dir android]
//
// Yang dilakukan (idempoten, defensif terhadap variasi template Expo/RN):
//   1. android/app/build.gradle
//      - menambah `signingConfigs.release` yang membaca properti Gradle
//        ANTARKITA_UPLOAD_STORE_FILE / _KEY_ALIAS / _STORE_PASSWORD / _KEY_PASSWORD
//        (hanya aktif bila properti ada → build lokal tanpa keystore tetap jalan dengan debug key)
//      - mengarahkan `buildTypes.release.signingConfig` ke release bila properti tersedia
//   2. android/gradle.properties
//      - menulis 4 properti di atas dari env dengan nama yang sama (jika env di-set), dengan escaping
//        format Java Properties, supaya kata sandi dengan karakter khusus tidak rusak lewat shell.
// Tidak ada rahasia yang di-hardcode di sini; nilai datang dari GitHub Secrets → env → gradle.properties.
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const dirIdx = args.indexOf('--dir');
const androidDir = path.resolve(dirIdx >= 0 ? args[dirIdx + 1] : 'android');
const gradleFile = path.join(androidDir, 'app', 'build.gradle');
const propsFile = path.join(androidDir, 'gradle.properties');

if (!fs.existsSync(gradleFile)) {
  console.error(`✖ ${gradleFile} tidak ditemukan. Jalankan \`npx expo prebuild --platform android\` dulu.`);
  process.exit(1);
}

const PROP = 'ANTARKITA_UPLOAD_STORE_FILE';
const RELEASE_SIGNING = `        release {
            // Upload keystore Play Store — nilai dari gradle.properties (diisi CI dari GitHub Secrets).
            if (project.hasProperty('${PROP}')) {
                storeFile file(${PROP})
                storePassword ANTARKITA_UPLOAD_STORE_PASSWORD
                keyAlias ANTARKITA_UPLOAD_KEY_ALIAS
                keyPassword ANTARKITA_UPLOAD_KEY_PASSWORD
            }
        }
`;
const RELEASE_SIGNING_EXPR = `project.hasProperty('${PROP}') ? signingConfigs.release : signingConfigs.debug`;

/** Cari indeks kurung tutup yang seimbang untuk blok yang dibuka di `openIdx` (indeks karakter '{'). */
function blockEnd(src, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return i; }
  }
  return -1;
}
/** Temukan blok bernama `name {` di dalam rentang [from, to) — kembalikan {start, open, end} atau null. */
function findBlock(src, name, from = 0, to = src.length) {
  const re = new RegExp(`(^|\\n)([ \\t]*)${name}\\s*\\{`, 'g');
  re.lastIndex = from;
  const mm = re.exec(src);
  if (!mm || mm.index >= to) return null;
  const open = src.indexOf('{', mm.index);
  const end = blockEnd(src, open);
  if (end < 0 || end > to) return null;
  return { start: mm.index + mm[1].length, indent: mm[2], open, end };
}

let gradle = fs.readFileSync(gradleFile, 'utf8');
const original = gradle;

// --- 1. blok android { ... }
const androidBlock = findBlock(gradle, 'android');
if (!androidBlock) { console.error('✖ Blok `android { }` tidak ditemukan di app/build.gradle'); process.exit(1); }

// --- 2. signingConfigs.release
let sc = findBlock(gradle, 'signingConfigs', androidBlock.open, androidBlock.end);
if (sc && findBlock(gradle, 'release', sc.open, sc.end)) {
  console.log('• signingConfigs.release sudah ada — dilewati');
} else if (sc) {
  // sisipkan sebelum baris kurung tutup signingConfigs
  const lineStart = gradle.lastIndexOf('\n', sc.end) + 1;
  gradle = gradle.slice(0, lineStart) + RELEASE_SIGNING + gradle.slice(lineStart);
  console.log('• signingConfigs.release ditambahkan');
} else {
  // tidak ada signingConfigs sama sekali → buat blok baru sebelum buildTypes (atau di akhir blok android)
  const bt = findBlock(gradle, 'buildTypes', androidBlock.open, androidBlock.end);
  const insertAt = bt ? bt.start : androidBlock.end;
  const block = `    signingConfigs {\n${RELEASE_SIGNING}    }\n    `;
  gradle = gradle.slice(0, insertAt) + block + gradle.slice(insertAt);
  console.log('• blok signingConfigs (dengan release) dibuat');
}

// --- 3. buildTypes.release.signingConfig
const androidBlock2 = findBlock(gradle, 'android');
const bt = findBlock(gradle, 'buildTypes', androidBlock2.open, androidBlock2.end);
if (!bt) { console.error('✖ Blok `buildTypes { }` tidak ditemukan'); process.exit(1); }
const rel = findBlock(gradle, 'release', bt.open, bt.end);
if (!rel) {
  const block = `        release {\n            signingConfig ${RELEASE_SIGNING_EXPR}\n        }\n    `;
  gradle = gradle.slice(0, bt.end) + block + gradle.slice(bt.end);
  console.log('• buildTypes.release dibuat dengan signingConfig release');
} else {
  const body = gradle.slice(rel.open + 1, rel.end);
  if (body.includes('signingConfigs.release')) {
    console.log('• buildTypes.release sudah memakai signingConfigs.release — dilewati');
  } else if (/^\s*signingConfig\s+.*$/m.test(body)) {
    const newBody = body.replace(/^(\s*)signingConfig\s+.*$/m, `$1signingConfig ${RELEASE_SIGNING_EXPR}`);
    gradle = gradle.slice(0, rel.open + 1) + newBody + gradle.slice(rel.end);
    console.log('• buildTypes.release.signingConfig diarahkan ke release');
  } else {
    gradle = gradle.slice(0, rel.open + 1) + `\n            signingConfig ${RELEASE_SIGNING_EXPR}` + gradle.slice(rel.open + 1);
    console.log('• buildTypes.release.signingConfig ditambahkan');
  }
}

if (gradle !== original) fs.writeFileSync(gradleFile, gradle);

// --- 4. gradle.properties dari env (opsional; hanya jika env di-set)
const KEYS = ['ANTARKITA_UPLOAD_STORE_FILE', 'ANTARKITA_UPLOAD_KEY_ALIAS', 'ANTARKITA_UPLOAD_STORE_PASSWORD', 'ANTARKITA_UPLOAD_KEY_PASSWORD'];
const present = KEYS.filter((k) => process.env[k]);
if (present.length) {
  const missing = KEYS.filter((k) => !process.env[k]);
  if (missing.length) { console.error(`✖ Env belum lengkap: ${missing.join(', ')}`); process.exit(1); }
  // Escape sesuai java.util.Properties: backslash, baris baru, dan karakter awal khusus.
  const esc = (v) => String(v).replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/^([ #!])/, '\\$1');
  let props = fs.existsSync(propsFile) ? fs.readFileSync(propsFile, 'utf8') : '';
  props = props.split('\n').filter((l) => !KEYS.some((k) => l.startsWith(k + '='))).join('\n');
  if (!props.endsWith('\n')) props += '\n';
  props += `\n# Upload keystore (ditulis oleh scripts/android-signing.mjs dari env CI — jangan commit)\n`;
  for (const k of KEYS) props += `${k}=${esc(process.env[k])}\n`;
  fs.writeFileSync(propsFile, props);
  const storeAbs = path.isAbsolute(process.env[PROP]) ? process.env[PROP] : path.join(androidDir, 'app', process.env[PROP]);
  if (!fs.existsSync(storeAbs)) console.warn(`⚠ Keystore ${storeAbs} belum ada (pastikan langkah decode keystore berjalan sebelum Gradle).`);
  console.log(`• gradle.properties: ${KEYS.length} properti signing ditulis (alias ${process.env.ANTARKITA_UPLOAD_KEY_ALIAS})`);
} else {
  console.log('• Env ANTARKITA_UPLOAD_* tidak di-set → gradle.properties tidak diubah (build akan memakai debug key)');
}

// --- 5. ringkasan
const appId = /applicationId\s+["']([^"']+)["']/.exec(gradle)?.[1];
const vCode = /versionCode\s+(\d+)/.exec(gradle)?.[1];
const vName = /versionName\s+["']([^"']+)["']/.exec(gradle)?.[1];
console.log(`✔ ${path.relative(process.cwd(), gradleFile)} → applicationId=${appId} versionCode=${vCode} versionName=${vName}`);
if (!appId || !vCode || !vName) { console.error('✖ applicationId/versionCode/versionName tidak terbaca — periksa hasil prebuild'); process.exit(1); }
