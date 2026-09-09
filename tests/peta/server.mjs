// Server uji: melayani halaman harness + meniru RPC Supabase yang dipakai lapisan peta.
//
// Yang ditiru persis seperti migrasi 0061:
//   POST /mock/rpc/map_public_config → konfigurasi peta; {key} diganti kunci PUBLIK,
//                                      secret_key TIDAK PERNAH ikut.
//   POST /mock/rpc/resolve_address   → cache alamat berkunci "geohash" (di sini: petak 0,0015°)
//   POST /mock/rpc/cache_address     → simpan alamat ke cache
//   POST /mock/admin/set             → yang dilakukan Panel Admin saat pemilik mengganti penyedia
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4260);

// --- keadaan "basis data" -------------------------------------------------------------
const SECRETS = {
  // secret_key sengaja diberi nilai mencolok: uji memastikan ia TIDAK PERNAH sampai ke klien.
  stadia: { secret_key: 'RAHASIA-STADIA-TIDAK-BOLEH-BOCOR', public_key: 'PUBLIK-STADIA-UJI' },
  mapbox: { secret_key: 'sk.RAHASIA-MAPBOX-TIDAK-BOLEH-BOCOR', public_key: 'pk.PUBLIK-MAPBOX-UJI' },
  osm_free: { secret_key: null, public_key: null },
};
const PRESETS = {
  osm_free: {
    tile_url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    tile_attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
  stadia: {
    tile_url: 'https://tiles.stadiamaps.com/tiles/osm_bright/{z}/{x}/{y}.png?api_key={key}',
    tile_attribution: '&copy; <a href="https://stadiamaps.com/">Stadia Maps</a> &copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
  mapbox: {
    tile_url: 'https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/256/{z}/{x}/{y}?access_token={key}',
    tile_attribution: '&copy; <a href="https://www.mapbox.com/about/maps/">Mapbox</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
};

let config = {
  tile_provider: 'osm_free', geocode_provider: 'osm_free', route_provider: 'osm_free',
  ...PRESETS.osm_free,
  tile_max_zoom: 19, autocomplete_min_chars: 4, autocomplete_debounce_ms: 700,
  defer_routing: true, refit_min_meters: 150, driver_poll_ms: 10000, track_max_zoom: 16,
};
const geocodeCache = new Map();   // "geohash" → { address, provider }
export const counters = { geocode_provider_calls: 0 };

const cell = (lat, lng) => `${Math.round(lat / 0.0015)}:${Math.round(lng / 0.0015)}`;  // ±150 m, meniru geohash-7

function publicConfig() {
  const key = SECRETS[config.tile_provider]?.public_key ?? '';
  const geoKey = SECRETS[config.geocode_provider]?.public_key ?? null;
  const routeKey = SECRETS[config.route_provider]?.public_key ?? null;
  return {
    tile_provider: config.tile_provider,
    tile_url: config.tile_url.replace('{key}', key),          // {key} diganti DI SERVER
    tile_attribution: config.tile_attribution,
    tile_max_zoom: config.tile_max_zoom,
    geocode_provider: config.geocode_provider, geocode_key: geoKey,
    route_provider: config.route_provider, route_key: routeKey,
    autocomplete_min_chars: config.autocomplete_min_chars,
    autocomplete_debounce_ms: config.autocomplete_debounce_ms,
    defer_routing: config.defer_routing,
    refit_min_meters: config.refit_min_meters,
    driver_poll_ms: config.driver_poll_ms,
    track_max_zoom: config.track_max_zoom,
    uses_free_osm: [config.tile_provider, config.geocode_provider, config.route_provider].includes('osm_free'),
  };
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.css': 'text/css; charset=utf-8' };

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const send = (code, body, type = 'application/json') => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };

  if (req.method === 'POST') {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString() || '{}') : {};

    if (url.pathname === '/mock/rpc/map_public_config') return send(200, publicConfig());

    if (url.pathname === '/mock/rpc/resolve_address') {
      const k = cell(body.p_lat, body.p_lng);
      const hit = geocodeCache.get(k);
      return send(200, hit ? { hit: true, address: hit.address, provider: hit.provider, geohash: k } : { hit: false, address: null, geohash: k });
    }
    if (url.pathname === '/mock/rpc/cache_address') {
      const k = cell(body.p_lat, body.p_lng);
      if (!geocodeCache.has(k)) geocodeCache.set(k, { address: body.p_address, provider: body.p_provider });
      return send(200, true);
    }
    // Panel Admin menyimpan konfigurasi baru
    if (url.pathname === '/mock/admin/set') {
      const p = body.provider;
      if (PRESETS[p]) config = { ...config, tile_provider: p, geocode_provider: p, route_provider: p, ...PRESETS[p] };
      Object.assign(config, body.patch ?? {});
      return send(200, publicConfig());
    }
    if (url.pathname === '/mock/reset') {
      geocodeCache.clear();
      config = { ...config, tile_provider: 'osm_free', geocode_provider: 'osm_free', route_provider: 'osm_free', ...PRESETS.osm_free };
      return send(200, { ok: true });
    }
    return send(404, { error: 'not found' });
  }

  if (url.pathname === '/mock/state') return send(200, { config: publicConfig(), cache: [...geocodeCache.entries()] });

  const file = url.pathname === '/' ? '/harness.html' : url.pathname;
  try {
    const buf = await readFile(join(here, file.replace(/^\/+/, '')));
    return send(200, buf.toString(), MIME[extname(file)] ?? 'application/octet-stream');
  } catch {
    return send(404, 'tidak ditemukan', 'text/plain; charset=utf-8');
  }
});

server.listen(PORT, () => console.log(`harness peta: http://localhost:${PORT}`));
