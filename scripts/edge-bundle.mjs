#!/usr/bin/env node
// =====================================================================
// scripts/edge-bundle.mjs — paket deploy Edge Function untuk MCP Supabase `deploy_edge_function`
//
// MCP butuh daftar { name, content } per berkas dan SEMUA berkas harus berada di bawah folder fungsi.
// Fungsi di repo ini mengimpor relatif ke luar folder (../_shared/x.ts, ../pay-webhook/handler.ts), jadi skrip ini:
//   1. menelusuri import relatif secara rekursif mulai dari <fn>/index.ts;
//   2. berkas di dalam folder fungsi → path relatif terhadap folder fungsi (apa adanya);
//      berkas di luar folder fungsi (masih di bawah supabase/functions) → path relatif terhadap supabase/functions
//      (../_shared/http.ts → _shared/http.ts, ../pay-webhook/handler.ts → pay-webhook/handler.ts);
//   3. menulis ulang setiap specifier import relatif menjadi path relatif baru antar-berkas bundle
//      (dari index.ts: "../_shared/http.ts" → "./_shared/http.ts"; dari pay-webhook/handler.ts: "../_shared/http.ts" tetap);
//   4. (opsional --check) menulis salinan bundle ke folder sementara dan menjalankan `deno check` di sana —
//      pada SALINAN itu baris `import "jsr:@supabase/functions-js/edge-runtime.d.ts"` (tipe runtime edge; jsr.io sering
//      diblokir proxy) diganti komentar; bundle yang dikeluarkan TIDAK diubah.
// Keluaran JSON: { name, entrypoint_path, verify_jwt, env, files: [{ name, content }], ... }
//
//   node scripts/edge-bundle.mjs <nama-fungsi> [--out <berkas.json>] [--check] [--verify-jwt true|false]
//   node scripts/edge-bundle.mjs --all --out-dir /home/claude/edge-bundles --check
// =====================================================================
import { promises as fs } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FUNCTIONS_DIR = path.join(ROOT, "supabase", "functions");

// verify_jwt per fungsi: webhook dipanggil provider tanpa JWT → false. Selebihnya true (gateway memverifikasi JWT;
// push-send menerima anon key dari pg_net + x-push-secret di dalam).
const VERIFY_JWT = {
  "midtrans-webhook": false,
  "pay-webhook": false,
  "osm-import": true,
  "push-send": true,
  "pay-create": true,
  "midtrans-create": true,
  "pay-refund": true,
  "pay-reconcile": true,
  "pay-disburse": true,
  "turn-credentials": true,
};
const DEFAULT_SET = ["midtrans-create", "pay-create", "midtrans-webhook", "push-send"];

// import/export statis & dinamis dengan specifier string: import x from "…", import "…", export * from "…", import("…")
const IMPORT_RE = /(\bimport\s*(?:type\s+)?(?:[^'"]*?\s+from\s*)?|\bexport\s*(?:type\s+)?[^'"]*?\s+from\s*|\bimport\s*\(\s*)(['"])([^'"]+)\2/g;

function usage(msg) {
  if (msg) console.error(`edge-bundle: ${msg}`);
  console.error("pakai: node scripts/edge-bundle.mjs <fungsi> [--out f.json] [--check] [--verify-jwt true|false]\n       node scripts/edge-bundle.mjs --all [--out-dir dir] [--check]");
  process.exit(2);
}

function parseArgs(argv) {
  const a = { names: [], all: false, out: null, outDir: null, check: false, verifyJwt: null };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === "--all") a.all = true;
    else if (x === "--check") a.check = true;
    else if (x === "--out") a.out = argv[++i];
    else if (x === "--out-dir") a.outDir = argv[++i];
    else if (x === "--verify-jwt") a.verifyJwt = argv[++i] === "true";
    else if (x.startsWith("-")) usage(`opsi tak dikenal ${x}`);
    else a.names.push(x);
  }
  if (a.all) a.names = DEFAULT_SET;
  if (!a.names.length) usage("nama fungsi wajib");
  return a;
}

/** Path bundle untuk berkas absolut `abs` dalam konteks fungsi `fnDir`. */
function bundlePath(abs, fnDir) {
  const relFn = path.relative(fnDir, abs);
  if (!relFn.startsWith("..") && !path.isAbsolute(relFn)) return { name: relFn.split(path.sep).join("/"), external: false };
  const relRoot = path.relative(FUNCTIONS_DIR, abs);
  if (relRoot.startsWith("..") || path.isAbsolute(relRoot)) throw new Error(`import keluar dari supabase/functions: ${abs}`);
  return { name: relRoot.split(path.sep).join("/"), external: true };
}

function relSpecifier(fromBundle, toBundle) {
  let r = path.posix.relative(path.posix.dirname(fromBundle), toBundle);
  if (!r.startsWith(".")) r = "./" + r;
  return r;
}

export async function bundle(fnName) {
  const fnDir = path.join(FUNCTIONS_DIR, fnName);
  const entry = path.join(fnDir, "index.ts");
  await fs.access(entry).catch(() => { throw new Error(`fungsi tidak ditemukan: ${entry}`); });

  const files = new Map();   // bundle name → { abs, content, external }
  const byAbs = new Map();   // abs → bundle name
  const env = new Set();
  const remote = new Set();
  const queue = [entry];
  while (queue.length) {
    const abs = queue.shift();
    if (byAbs.has(abs)) continue;
    const { name, external } = bundlePath(abs, fnDir);
    if (files.has(name)) throw new Error(`tabrakan path bundle '${name}' (${abs} vs ${files.get(name).abs})`);
    const src = await fs.readFile(abs, "utf8");
    byAbs.set(abs, name);
    files.set(name, { abs, src, external });
    for (const m of src.matchAll(IMPORT_RE)) {
      const spec = m[3];
      if (spec.startsWith("./") || spec.startsWith("../")) {
        const target = path.resolve(path.dirname(abs), spec);
        await fs.access(target).catch(() => { throw new Error(`${abs}: import '${spec}' tidak ditemukan`); });
        queue.push(target);
      } else remote.add(spec);
    }
    for (const m of src.matchAll(/Deno\.env\.get\(\s*["']([A-Z0-9_]+)["']\s*\)/g)) env.add(m[1]);
    for (const m of src.matchAll(/\benv\(\s*["']([A-Z0-9_]+)["']\s*\)/g)) env.add(m[1]);
  }

  // tulis ulang import relatif
  const out = [];
  for (const [name, f] of files) {
    const content = f.src.replace(IMPORT_RE, (whole, pre, q, spec) => {
      if (!(spec.startsWith("./") || spec.startsWith("../"))) return whole;
      const target = path.resolve(path.dirname(f.abs), spec);
      const toName = byAbs.get(target);
      if (!toName) throw new Error(`${f.abs}: target import '${spec}' tidak dibundel`);
      return `${pre}${q}${relSpecifier(name, toName)}${q}`;
    });
    // verifikasi konsistensi: setiap import relatif hasil tulis ulang harus menunjuk berkas yang ada di bundle
    for (const m of content.matchAll(IMPORT_RE)) {
      const spec = m[3];
      if (!(spec.startsWith("./") || spec.startsWith("../"))) continue;
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(name), spec));
      if (resolved.startsWith("..")) throw new Error(`${name}: import '${spec}' keluar dari folder bundle`);
      if (!files.has(resolved)) throw new Error(`${name}: import '${spec}' → '${resolved}' tidak ada di bundle`);
    }
    out.push({ name, content, external: f.external, source: path.relative(ROOT, f.abs) });
  }
  out.sort((a, b) => (a.name === "index.ts" ? -1 : b.name === "index.ts" ? 1 : a.name.localeCompare(b.name)));

  // env: SUPABASE_* disediakan platform; sisanya secret yang harus diisi admin
  const platform = [...env].filter((e) => e.startsWith("SUPABASE_")).sort();
  const secrets = [...env].filter((e) => !e.startsWith("SUPABASE_")).sort();
  return {
    name: fnName,
    entrypoint_path: "index.ts",
    verify_jwt: VERIFY_JWT[fnName] ?? true,
    env: { platform, secrets },
    remote_imports: [...remote].sort(),
    files: out.map(({ name, content }) => ({ name, content })),
    sources: out.map(({ name, source, external }) => ({ name, source, external })),
  };
}

/** `deno check` pada salinan bundle di folder sementara. Mengembalikan { ok, output }. */
export async function checkBundle(b) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), `edge-bundle-${b.name}-`));
  try {
    for (const f of b.files) {
      const p = path.join(tmp, f.name);
      await fs.mkdir(path.dirname(p), { recursive: true });
      // hanya pada salinan uji: tipe runtime edge dari jsr.io (sering diblokir proxy) tidak dibutuhkan deno check lokal
      const content = f.content.replace(/^\s*import\s+["']jsr:@supabase\/functions-js\/edge-runtime\.d\.ts["'];?\s*$/m, "// (edge-runtime.d.ts dilewati saat deno check lokal)");
      await fs.writeFile(p, content);
    }
    const r = spawnSync("deno", ["check", path.join(tmp, b.entrypoint_path)], { encoding: "utf8", cwd: tmp, timeout: 180000 });
    const output = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
    return { ok: r.status === 0, output, dir: tmp };
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  let fail = 0;
  for (const name of a.names) {
    const b = await bundle(name);
    if (a.verifyJwt !== null) b.verify_jwt = a.verifyJwt;
    let check = null;
    if (a.check) {
      check = await checkBundle(b);
      if (!check.ok) fail++;
      b.deno_check = { ok: check.ok, output: check.output };
    }
    const outPath = a.out ?? (a.outDir ? path.join(a.outDir, `${name}.json`) : null);
    if (outPath) {
      await fs.mkdir(path.dirname(outPath), { recursive: true });
      await fs.writeFile(outPath, JSON.stringify(b, null, 2));
    }
    const summary = {
      name, verify_jwt: b.verify_jwt, files: b.files.length, bytes: b.files.reduce((n, f) => n + Buffer.byteLength(f.content), 0),
      secrets: b.env.secrets, platform_env: b.env.platform, remote_imports: b.remote_imports,
      deno_check: check ? (check.ok ? "OK" : "GAGAL") : "(tidak dijalankan)", out: outPath,
    };
    if (outPath || a.names.length > 1) console.error(JSON.stringify(summary));
    if (check && !check.ok) console.error(check.output);
    if (!outPath && a.names.length === 1) process.stdout.write(JSON.stringify(b, null, 2) + "\n");
  }
  process.exit(fail ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(`edge-bundle: ${e.message}`); process.exit(1); });
}
