// Utilitas JSON murni: serialisasi ala PHP json_encode, penghapusan field tingkat atas secara tekstual,
// dan pencarian field adaptif (respons provider yang strukturnya belum terverifikasi).

function phpEscapeString(s: string): string {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const ch = s[i];
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (ch === "/") out += "\\/"; // PHP default: JSON_UNESCAPED_SLASHES TIDAK aktif
    else if (c === 0x08) out += "\\b";
    else if (c === 0x0c) out += "\\f";
    else if (c === 0x0a) out += "\\n";
    else if (c === 0x0d) out += "\\r";
    else if (c === 0x09) out += "\\t";
    else if (c < 0x20 || c > 0x7e && c !== 0x7f) out += "\\u" + c.toString(16).padStart(4, "0"); // unicode di-escape per unit UTF-16 (huruf kecil)
    else out += ch;
  }
  return out + '"';
}

export interface PhpJsonOptions {
  /** json_decode($x, true) lalu json_encode → objek kosong menjadi `[]`. */
  emptyObjectAsArray?: boolean;
}

/** Setara PHP `json_encode($value)` tanpa flag (escape '/' → '\/', non-ASCII → \uXXXX). */
export function phpJsonEncode(value: unknown, opts: PhpJsonOptions = {}): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "0";
    return String(value);
  }
  if (typeof value === "string") return phpEscapeString(value);
  if (Array.isArray(value)) return "[" + value.map((v) => phpJsonEncode(v, opts)).join(",") + "]";
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return opts.emptyObjectAsArray ? "[]" : "{}";
    return "{" + entries.map(([k, v]) => phpEscapeString(k) + ":" + phpJsonEncode(v, opts)).join(",") + "}";
  }
  return "null";
}

/**
 * Hapus satu field tingkat atas dari teks JSON objek TANPA mengubah byte lain (spasi, urutan, escape asli).
 * Mengembalikan null bila teks bukan objek atau field tidak ditemukan.
 */
export function removeTopLevelField(raw: string, field: string): string | null {
  let i = 0;
  const n = raw.length;
  const ws = () => { while (i < n && /\s/.test(raw[i])) i++; };
  const skipString = () => { // i di '"'
    i++;
    while (i < n) {
      if (raw[i] === "\\") { i += 2; continue; }
      if (raw[i] === '"') { i++; return; }
      i++;
    }
    throw new Error("string tidak tertutup");
  };
  const skipValue = () => {
    ws();
    if (raw[i] === '"') return skipString();
    if (raw[i] === "{" || raw[i] === "[") {
      let depth = 0;
      while (i < n) {
        const c = raw[i];
        if (c === '"') { skipString(); continue; }
        if (c === "{" || c === "[") depth++;
        else if (c === "}" || c === "]") { depth--; if (depth === 0) { i++; return; } }
        i++;
      }
      throw new Error("struktur tidak tertutup");
    }
    while (i < n && !/[,}\]\s]/.test(raw[i])) i++;
  };
  try {
    ws();
    if (raw[i] !== "{") return null;
    i++;
    type Member = { start: number; end: number; key: string; commaBefore: number | null };
    const members: Member[] = [];
    let commaBefore: number | null = null;
    while (i < n) {
      ws();
      if (raw[i] === "}") break;
      const start = i;
      if (raw[i] !== '"') return null;
      const ks = i;
      skipString();
      const key = JSON.parse(raw.slice(ks, i)) as string;
      ws();
      if (raw[i] !== ":") return null;
      i++;
      skipValue();
      const end = i;
      members.push({ start, end, key, commaBefore });
      ws();
      if (raw[i] === ",") { commaBefore = i; i++; continue; }
      if (raw[i] === "}") break;
      return null;
    }
    const idx = members.findIndex((m) => m.key === field);
    if (idx < 0) return null;
    const m = members[idx];
    if (idx > 0 && m.commaBefore !== null) return raw.slice(0, m.commaBefore) + raw.slice(m.end);
    const next = members[idx + 1];
    if (next && next.commaBefore !== null) return raw.slice(0, m.start) + raw.slice(next.commaBefore + 1).replace(/^\s*/, "");
    return raw.slice(0, m.start) + raw.slice(m.end);
  } catch {
    return null;
  }
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** Ambil nilai lewat path "a.b.c" (nama kunci tidak peka huruf besar/kecil). */
export function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (!isObj(cur)) return undefined;
    const k = Object.keys(cur).find((x) => x.toLowerCase() === part.toLowerCase());
    if (k === undefined) return undefined;
    cur = cur[k];
  }
  return cur;
}

/** Nilai pertama yang tidak kosong dari daftar path. */
export function firstPath(obj: unknown, paths: string[]): unknown {
  for (const p of paths) {
    const v = getPath(obj, p);
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

/** Cari kunci (tidak peka huruf) secara BFS sampai kedalaman tertentu; opsional filter nilai. */
export function deepFind(obj: unknown, keys: string[], accept: (v: unknown) => boolean = (v) => v !== null && v !== undefined && v !== "", maxDepth = 5): unknown {
  const wanted = keys.map((k) => k.toLowerCase());
  let level: unknown[] = [obj];
  for (let d = 0; d <= maxDepth && level.length; d++) {
    const next: unknown[] = [];
    for (const node of level) {
      if (Array.isArray(node)) { next.push(...node.slice(0, 20)); continue; }
      if (!isObj(node)) continue;
      for (const w of wanted) {
        const k = Object.keys(node).find((x) => x.toLowerCase() === w);
        if (k !== undefined && accept(node[k])) return node[k];
      }
      for (const v of Object.values(node)) if (typeof v === "object" && v !== null) next.push(v);
    }
    level = next;
  }
  return undefined;
}

export function toAmount(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? Math.round(n) : null;
}

export function safeParse(raw: string): unknown {
  try { return JSON.parse(raw); } catch { return null; }
}
