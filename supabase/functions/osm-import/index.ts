// Edge Function: osm-import — mengisi basis data tempat se-Indonesia dari OpenStreetMap (Overpass API).
//
// KENAPA DI EDGE FUNCTION, BUKAN DI KLIEN/CI:
//   Jaringan tempat kerja pengembang memblokir overpass-api.de (403 dari proxy).
//   Edge Function punya jalur internet sendiri, dan di sini impor juga bisa
//   dijadwalkan sendiri oleh pg_cron (lihat migrasi 0075).
//
// CARA DIPANGGIL
//   • Admin (panel):   POST { action: "enqueue", target, scope, province?, city_id?, max_per_task? }
//                      POST { action: "run", job_id?, budget_ms? }   ← kerjakan satu potong
//                      POST { action: "status" }
//   • pg_cron:         public.osm_import_tick() → pg_net POST { action: "run", job_id } (Authorization service_role)
//
// TAHAN TIMEOUT: satu panggilan hanya mengerjakan tugas selama anggaran waktu
// (default 55 detik) lalu berhenti dan melapor. Kemajuan tersimpan di tabel
// osm_import_tasks, jadi panggilan berikutnya melanjutkan, bukan mengulang.
//
// ETIKA OVERPASS: satu permintaan pada satu waktu (serial), jeda antar permintaan,
// User-Agent berisi kontak, timeout wajar, dan endpoint cadangan.
//
// TIDAK PERNAH MELEMPAR: bila Overpass tak terjangkau atau konfigurasi belum ada,
// balasannya { skipped: true, reason } dan tugas dibiarkan kembali ke antrean.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

// Kontak wajib ada di User-Agent sesuai etika pemakaian Overpass.
const UA = "AntarKita/1.0 (erzamadana@gmail.com)";
const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
// Batas satu permintaan Overpass. Kueri se-provinsi sering butuh > 45 dtk di sisi Overpass
// (kueri memakai [timeout:120]); memutus lebih awal hanya membuang pekerjaan server Overpass
// dan menyisakan tugas 'running'. Dinaikkan, tetapi tetap dipotong oleh sisa anggaran panggilan.
const REQ_TIMEOUT_MS = 100_000;
const DEFAULT_BUDGET_MS = 55_000; // anggaran satu panggilan Edge Function
const PAUSE_MS = 1_500;           // jeda antar permintaan Overpass
const CHUNK = 200;                // baris per panggilan RPC penyimpanan

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Tags = Record<string, string>;
type OsmElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number; lon?: number;
  center?: { lat: number; lon: number };
  tags?: Tags;
};
type Task = {
  id: number; job_id: string; seq: number;
  kind: "provinsi_discover" | "kota" | "tempat";
  target: string; province: string | null; city_id: string | null; city_name: string | null;
  area_osm_id: string | null; lat: number | null; lng: number | null; radius_km: number | null;
};
type Place = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Pemetaan tag OSM → kategori aplikasi
// Mengikuti src/lib/osm.ts (brandOf / categoryOf) agar data dari klien dan dari
// Edge Function konsisten. Disalin (bukan diimpor) karena berjalan di Deno.
// ---------------------------------------------------------------------------
function brandOf(tags: Tags): string {
  const t = `${tags.brand ?? ""} ${tags.name ?? ""} ${tags.operator ?? ""}`.toLowerCase();
  if (t.includes("indomaret")) return "indomaret";
  if (t.includes("alfamart") || t.includes("alfamidi")) return "alfamart";
  if (tags.amenity === "pharmacy" || tags.shop === "chemist" ||
      t.includes("apotek") || t.includes("apotik") || t.includes("farma") || t.includes("kimia farma")) return "apotek";
  if (tags.shop === "supermarket" || t.includes("supermarket") || t.includes("swalayan") || t.includes("hypermart")) return "supermarket";
  return "lainnya";
}
function categoryOf(tags: Tags, brand: string): string {
  if (brand === "apotek") return "apotek";
  if (brand === "indomaret" || brand === "alfamart" || tags.shop === "convenience") return "minimarket";
  if (brand === "supermarket" || ["supermarket", "department_store", "general", "wholesale"].includes(tags.shop ?? "")) return "supermarket";
  return "minimarket";
}
/** Jenis faskes — masuk poi_places (titik tujuan), BUKAN toko belanja. */
function faskesKindOf(tags: Tags): string | null {
  const name = `${tags.name ?? ""}`.toLowerCase();
  const a = tags.amenity ?? ""; const h = tags.healthcare ?? "";
  if (a === "hospital" || h === "hospital" || name.includes("rumah sakit") || /\brs[aud]?\b/.test(name)) return "rumah_sakit";
  if (name.includes("puskesmas") || name.includes("pustu")) return "puskesmas";
  if (a === "clinic" || h === "clinic" || h === "centre" || name.includes("klinik")) return "klinik";
  if (a === "doctors" || h === "doctor") return "dokter";
  return null;
}
function addressOf(tags: Tags): string | undefined {
  const parts = [tags["addr:street"], tags["addr:housenumber"]].filter(Boolean);
  if (parts.length === 0) return tags["addr:full"] || tags["addr:place"] || undefined;
  return parts.join(" ");
}

/** Satu elemen OSM → baris siap simpan, atau null bila tidak dipakai. */
function classify(el: OsmElement): { kind: "store" | "market" | "faskes"; place: Place } | null {
  const tags = el.tags ?? {};
  const name = (tags.name ?? tags["name:id"] ?? tags.brand ?? tags.operator ?? "").trim();
  if (name.length < 3) return null;
  const lat = el.lat ?? el.center?.lat;
  const lng = el.lon ?? el.center?.lon;
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  const base = {
    name, lat, lng,
    osm_id: `${el.type}/${el.id}`,
    address: addressOf(tags) ?? null,
    open_hours: tags.opening_hours || null,
    phone: tags.phone || tags["contact:phone"] || null,
  };
  const faskes = faskesKindOf(tags);
  if (faskes) {
    return { kind: "faskes", place: { ...base, kind: faskes,
      emergency: tags.emergency === "yes" ? true : tags.emergency === "no" ? false : null,
      operator: tags.operator || tags["operator:type"] || null } };
  }
  if (tags.amenity === "marketplace" || tags.shop === "market") {
    return { kind: "market", place: base };
  }
  if (tags.amenity === "pharmacy" || tags.shop) {
    const brand = brandOf(tags);
    return { kind: "store", place: { ...base, brand, category: categoryOf(tags, brand) } };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Kueri Overpass
// ---------------------------------------------------------------------------
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

const CLAUSES: Record<string, string[]> = {
  apotek:      ['nwr["amenity"="pharmacy"]', 'nwr["shop"="chemist"]'],
  pasar:       ['nwr["amenity"="marketplace"]', 'nwr["shop"="market"]'],
  minimarket:  ['nwr["shop"="convenience"]'],
  supermarket: ['nwr["shop"~"^(supermarket|department_store|general|wholesale)$"]'],
  faskes:      ['nwr["amenity"~"^(hospital|clinic|doctors)$"]', 'nwr["healthcare"~"^(hospital|clinic|centre)$"]'],
};
function clausesFor(target: string): string[] {
  if (target === "semua") return Object.values(CLAUSES).flat();
  return CLAUSES[target] ?? [];
}

function buildQuery(task: Task, maxOut: number): string {
  if (task.kind === "provinsi_discover") {
    // Daftar provinsi diambil dari OSM (tidak dikarang dari ingatan).
    return `[out:json][timeout:90];area["ISO3166-1"="ID"][admin_level=2]->.id;` +
           `relation["boundary"="administrative"]["admin_level"="4"](area.id);out tags center;`;
  }
  if (task.kind === "kota") {
    // Indonesia memakai admin_level 5 ATAU 6 untuk kabupaten/kota tergantung wilayah;
    // penyaring nama "Kota …"/"Kabupaten …" membuat kueri benar untuk keduanya.
    const prov = esc(task.province ?? "");
    return `[out:json][timeout:120];` +
      `area["boundary"="administrative"]["admin_level"="4"]["name"="${prov}"]->.a;` +
      `relation["boundary"="administrative"]["admin_level"~"^(5|6)$"]["name"~"^(Kota|Kabupaten) ",i](area.a);` +
      `out tags center;`;
  }
  // kind = 'tempat': pakai batas administratif kota bila ada osm_id-nya, kalau tidak pakai radius.
  const cl = clausesFor(task.target);
  if (cl.length === 0) return "";
  const rel = /^relation\/(\d+)$/.exec(task.area_osm_id ?? "");
  if (rel) {
    const areaId = 3_600_000_000 + Number(rel[1]);
    const body = cl.map((c) => `${c}(area.a);`).join("");
    return `[out:json][timeout:120];area(${areaId})->.a;(${body});out center tags ${maxOut};`;
  }
  const radius = Math.round(Math.max(3, Math.min(Number(task.radius_km ?? 25), 60)) * 1000);
  const around = `(around:${radius},${task.lat},${task.lng})`;
  const body = cl.map((c) => `${c}${around};`).join("");
  return `[out:json][timeout:120];(${body});out center tags ${maxOut};`;
}

class OverpassDown extends Error {}

/** Satu permintaan Overpass, serial, dengan endpoint cadangan. */
async function overpass(query: string, deadline: number = Date.now() + REQ_TIMEOUT_MS): Promise<{ elements: OsmElement[]; endpoint: string }> {
  let lastErr = "";
  for (const ep of ENDPOINTS) {
    const sisa = deadline - Date.now();
    if (sisa < 10_000) { lastErr = lastErr || "anggaran waktu panggilan habis"; break; }   // jangan mulai permintaan yang pasti diputus
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), Math.min(REQ_TIMEOUT_MS, sisa));
    try {
      const res = await fetch(ep, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": UA,
          "Accept": "application/json",
        },
        body: "data=" + encodeURIComponent(query),
        signal: ctrl.signal,
      });
      if (res.status === 400) {  // kueri salah — bukan masalah jaringan
        const txt = await res.text();
        throw new Error(`Overpass 400 (kueri ditolak): ${txt.slice(0, 200)}`);
      }
      if (!res.ok) { lastErr = `${ep} → HTTP ${res.status}`; await sleep(PAUSE_MS); continue; }
      const body = (await res.json()) as { elements?: OsmElement[] };
      return { elements: body.elements ?? [], endpoint: ep };
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      if (msg.includes("Overpass 400")) throw e;
      lastErr = `${ep} → ${msg}`;
      await sleep(PAUSE_MS);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new OverpassDown(`Overpass tidak terjangkau. ${lastErr}`);
}

// ---------------------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    if (!url || !serviceKey) {
      return json({ skipped: true, reason: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY tidak tersedia di lingkungan fungsi" });
    }
    const admin = createClient(url, serviceKey);

    // ---- Perizinan: service_role (pg_cron) atau admin AntarKita ----
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    let role = "";
    let uid: string | null = null;
    try {
      const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      role = String(payload.role ?? "");
      uid = payload.sub ?? null;
    } catch { /* token tidak bisa dibaca → diperlakukan sebagai pengguna biasa */ }

    if (role !== "service_role") {
      const asUser = createClient(url, anonKey || serviceKey, { global: { headers: { Authorization: `Bearer ${token}` } } });
      const { data: isAdmin, error } = await asUser.rpc("is_admin");
      if (error || isAdmin !== true) return json({ error: "Hanya admin" }, 403);
    }

    const payload = await req.json().catch(() => ({} as Record<string, unknown>));
    const action = String(payload.action ?? "run");

    // ---- Buat pekerjaan baru ----
    if (action === "enqueue") {
      const { data, error } = await admin.rpc("osm_enqueue_core", {
        p_target: String(payload.target ?? "semua"),
        p_scope: String(payload.scope ?? "nasional"),
        p_province: payload.province ?? null,
        p_city_id: payload.city_id ?? null,
        p_max_per_task: payload.max_per_task ?? null,
        p_by: uid,
        p_note: payload.note ?? null,
      });
      if (error) return json({ error: error.message }, 400);
      return json(data);
    }

    // ---- Status ringkas ----
    if (action === "status") {
      const { data: jobs } = await admin.from("osm_import_jobs").select("*").order("created_at", { ascending: false }).limit(5);
      return json({ ok: true, jobs: jobs ?? [] });
    }

    if (action !== "run") return json({ error: `Aksi tidak dikenal: ${action}` }, 400);

    // ---- Kerjakan potongan pekerjaan dalam anggaran waktu ----
    const started = Date.now();
    const budget = Math.max(5_000, Math.min(Number(payload.budget_ms ?? DEFAULT_BUDGET_MS), 120_000));
    const jobId = (payload.job_id as string | undefined) ?? null;
    const hasil: Record<string, unknown>[] = [];
    let processed = 0, fetchedAll = 0, insertedAll = 0, updatedAll = 0, skippedAll = 0;

    while (Date.now() - started < budget) {
      const { data: claimed, error: claimErr } = await admin.rpc("osm_claim_tasks", { p_job: jobId, p_limit: 1 });
      if (claimErr) return json({ error: claimErr.message }, 500);
      const tasks = (claimed ?? []) as Task[];
      if (tasks.length === 0) break;
      const task = tasks[0];

      // Anggaran maksimum baris per tugas (dari pekerjaan)
      const { data: job } = await admin.from("osm_import_jobs").select("max_per_task").eq("id", task.job_id).maybeSingle();
      const maxOut = Number(job?.max_per_task ?? 600);

      const query = buildQuery(task, maxOut);
      if (!query) {
        await admin.rpc("osm_finish_task", { p_task: task.id, p_status: "skipped", p_stats: {}, p_error: "kueri kosong (target tidak dikenal)", p_endpoint: null });
        continue;
      }

      let elements: OsmElement[] = []; let endpoint = "";
      try {
        // sisa anggaran panggilan dikurangi jeda untuk menyimpan hasil
        const r = await overpass(query, started + budget - 8_000);
        elements = r.elements; endpoint = r.endpoint;
      } catch (e) {
        if (e instanceof OverpassDown) {
          // Jaringan Overpass sedang tidak bisa dipakai: tugas dikembalikan ke antrean
          // SEKETIKA (0084, osm_release_task) — bukan menunggu 10 menit — supaya
          // panggilan berikutnya bisa langsung mencoba lagi. Tidak dianggap error fatal.
          await admin.rpc("osm_release_task", { p_task: task.id, p_reason: (e as Error).message });
          return json({ skipped: true, reason: (e as Error).message, processed, sisa_tugas: true });
        }
        await admin.rpc("osm_finish_task", { p_task: task.id, p_status: "failed", p_stats: {}, p_error: (e as Error).message, p_endpoint: null });
        await sleep(PAUSE_MS);
        continue;
      }

      let stats: Record<string, unknown> = { fetched: elements.length, inserted: 0, updated: 0, skipped: 0, counts: {} };

      if (task.kind === "provinsi_discover") {
        const provinces = elements
          .map((el) => ({ name: (el.tags?.name ?? "").trim() }))
          .filter((p) => p.name.length > 2);
        const { data: added } = await admin.rpc("osm_add_city_tasks", { p_job: task.job_id, p_provinces: provinces });
        stats = { fetched: provinces.length, inserted: 0, updated: 0, skipped: 0, counts: { provinsi: provinces.length } };
        hasil.push({ tugas: "provinsi", provinsi: provinces.length, tugas_baru: added });
      } else if (task.kind === "kota") {
        const kota = elements.map((el) => ({
          osm_id: `${el.type}/${el.id}`,
          name: (el.tags?.name ?? "").trim(),
          province: task.province,
          population: el.tags?.population ?? null,
          lat: el.lat ?? el.center?.lat ?? null,
          lng: el.lon ?? el.center?.lon ?? null,
        })).filter((k) => k.name.length > 2 && k.lat != null && k.lng != null);
        const { data: r, error } = await admin.rpc("osm_upsert_cities", { p_places: kota, p_province: task.province });
        if (error) {
          await admin.rpc("osm_finish_task", { p_task: task.id, p_status: "failed", p_stats: {}, p_error: error.message, p_endpoint: endpoint });
          await sleep(PAUSE_MS); continue;
        }
        const rr = (r ?? {}) as Record<string, number>;
        stats = { fetched: kota.length, inserted: rr.inserted ?? 0, updated: rr.updated ?? 0, skipped: rr.skipped ?? 0, counts: { kota: kota.length } };
        hasil.push({ provinsi: task.province, kota: kota.length, baru: rr.inserted ?? 0, diperbarui: rr.updated ?? 0 });
      } else {
        // tempat: kelompokkan per tabel tujuan lalu simpan bertahap
        const groups: Record<string, Place[]> = { store: [], market: [], faskes: [] };
        const seen = new Set<string>();
        for (const el of elements) {
          const c = classify(el);
          if (!c) continue;
          const key = String(c.place.osm_id);
          if (seen.has(key)) continue;
          seen.add(key);
          groups[c.kind].push(c.place);
        }
        let ins = 0, upd = 0, skp = elements.length - seen.size;
        const counts: Record<string, number> = {};
        for (const [kind, list] of Object.entries(groups)) {
          for (let i = 0; i < list.length; i += CHUNK) {
            const { data: r, error } = await admin.rpc("osm_upsert_places", {
              p_kind: kind, p_places: list.slice(i, i + CHUNK), p_city_id: task.city_id,
            });
            if (error) { skp += Math.min(CHUNK, list.length - i); continue; }
            const rr = (r ?? {}) as { inserted?: number; updated?: number; skipped?: number; counts?: Record<string, number> };
            ins += rr.inserted ?? 0; upd += rr.updated ?? 0; skp += rr.skipped ?? 0;
            for (const [k, v] of Object.entries(rr.counts ?? {})) counts[k] = (counts[k] ?? 0) + v;
          }
        }
        stats = { fetched: elements.length, inserted: ins, updated: upd, skipped: skp, counts };
        hasil.push({ kota: task.city_name, ditemukan: elements.length, baru: ins, diperbarui: upd, per_kategori: counts });
      }

      await admin.rpc("osm_finish_task", { p_task: task.id, p_status: "done", p_stats: stats, p_error: null, p_endpoint: endpoint });
      processed++;
      fetchedAll += Number(stats.fetched ?? 0);
      insertedAll += Number(stats.inserted ?? 0);
      updatedAll += Number(stats.updated ?? 0);
      skippedAll += Number(stats.skipped ?? 0);
      await sleep(PAUSE_MS);  // etika Overpass: beri jeda sebelum permintaan berikutnya
    }

    // Sisa tugas untuk dilaporkan ke pemanggil
    const { count: sisa } = await admin.from("osm_import_tasks")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending");

    return json({
      ok: true, processed, sisa_tugas: sisa ?? 0,
      fetched: fetchedAll, inserted: insertedAll, updated: updatedAll, skipped: skippedAll,
      durasi_ms: Date.now() - started, hasil,
    });
  } catch (e) {
    // Tidak pernah melempar ke pemanggil: laporkan apa adanya.
    console.error("osm-import gagal:", e);
    return json({ skipped: true, reason: (e as Error).message ?? String(e) });
  }
});
