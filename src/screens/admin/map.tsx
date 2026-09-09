// Panel Admin → Peta.
//
// Layar ini adalah "tombol darurat" infrastruktur peta: penyedia ubin, geocoding, dan
// rute diganti dari sini dan langsung berlaku di aplikasi pelanggan & mitra TANPA
// membangun ulang aplikasi dan TANPA menunggu tinjauan toko.
//
// Latar: docs/riset/RISET-PETA-DAN-BIAYA.md §2 menemukan aplikasi memakai empat layanan
// gratis yang melarang pemakaian komersial dan dapat memblokir tanpa pemberitahuan.
// Karena `TILE_URL` dulu ter-hardcode ke dalam APK/IPA, pemblokiran berarti peta abu-abu
// di semua perangkat selama 3–21 hari. Sejak migrasi 0061 hal itu tidak mungkin lagi.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Switch, StyleSheet, Platform } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AdminPage, adminFont as font, adminTone, adminSpace, adminRadius, adminIcon, AdminCard as Card } from '@/components/admin';
import { Input, Button, Row, Badge, Chip, toast } from '@/components/ui';
import { Entrance } from '@/components/motion';
import { rpc } from '@/lib/supabase';
import { reloadMapConfig, type MapProvider } from '@/lib/mapConfig';
import { colors } from '@/lib/theme';

// --- Penyedia yang punya adaptor di src/lib/geo.ts -------------------------------------
interface ProviderDef {
  key: MapProvider;
  label: string;
  desc: string;
  tiles: boolean;              // punya endpoint ubin raster kompatibel Leaflet
  tile_url?: string;           // template; {key} diganti server dengan kunci publik
  attribution?: string;
  key_hint: string;
  console_url: string;
  warn?: string;
}

const PROVIDERS: ProviderDef[] = [
  {
    key: 'stadia', label: 'Stadia Maps', tiles: true,
    desc: 'Rekomendasi utama riset: ubin + autocomplete + geocoding + routing dari satu vendor, endpoint raster kompatibel Leaflet.',
    tile_url: 'https://tiles.stadiamaps.com/tiles/osm_bright/{z}/{x}/{y}.png?api_key={key}',
    attribution: '&copy; <a href="https://stadiamaps.com/">Stadia Maps</a> &copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    key_hint: 'Kunci "Property" dari dashboard Stadia. Batasi ke domain web & bundle id aplikasi.',
    console_url: 'https://client.stadiamaps.com/',
  },
  {
    key: 'mapbox', label: 'Mapbox', tiles: true,
    desc: 'Cadangan. Maps SDK ponsel ditagih per pengguna aktif bulanan, bukan per pemuatan peta.',
    tile_url: 'https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/256/{z}/{x}/{y}?access_token={key}',
    attribution: '&copy; <a href="https://www.mapbox.com/about/maps/">Mapbox</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> <a href="https://www.mapbox.com/map-feedback/">Improve this map</a>',
    key_hint: 'Public token (pk.…) dengan URL restriction. Jangan pernah memasang secret token (sk.…) sebagai kunci publik.',
    console_url: 'https://console.mapbox.com/account/access-tokens/',
    warn: 'Geocoding "temporary" Mapbox tidak boleh disimpan permanen — konfirmasikan tingkat "permanent" sebelum mengandalkan cache alamat.',
  },
  {
    key: 'google', label: 'Google Maps Platform', tiles: false,
    desc: 'Hanya untuk pencarian/geocoding/rute. Termahal: riset menghitung 12–16× biaya Stadia per pesanan.',
    key_hint: 'API key dengan pembatasan aplikasi (SHA-1 Android / bundle id iOS / HTTP referrer web) dan pembatasan API.',
    console_url: 'https://console.cloud.google.com/google/maps-apis/credentials',
    warn: 'Adaptor Google masih memakai Places Text Search ($32/1.000 — SKU Pro). Ganti ke Places Autocomplete + session token sebelum dipakai serius.',
  },
  {
    key: 'osm_free', label: 'OSM gratis (pengembangan)', tiles: true,
    desc: 'tile.openstreetmap.org · photon.komoot.io · nominatim.openstreetmap.org · router.project-osrm.org',
    tile_url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    key_hint: 'Tidak perlu kunci — dan memang tidak boleh dipakai untuk operasi komersial.',
    console_url: 'https://operations.osmfoundation.org/policies/tiles/',
    warn: 'MELANGGAR SYARAT PAKAI untuk pemakaian komersial. Nominatim melarang autocomplete secara eksplisit (sanksi: ban); Photon & OSRM adalah situs demo; ubin OSM dapat diblokir tanpa pemberitahuan. Pakai hanya saat pengembangan.',
  },
];

const byKey = (k: string) => PROVIDERS.find((p) => p.key === k);
const TILE_CAPABLE = PROVIDERS.filter((p) => p.tiles);
const GEO_CAPABLE = PROVIDERS;

interface Status {
  tile_provider: MapProvider; tile_url: string; tile_attribution: string; tile_max_zoom: number;
  geocode_provider: MapProvider; route_provider: MapProvider;
  autocomplete_min_chars: number; autocomplete_debounce_ms: number; geocode_cache_ttl_days: number;
  defer_routing: boolean; refit_min_meters: number; driver_poll_ms: number; track_max_zoom: number;
  uses_free_osm: boolean; updated_at: string | null; updated_by: string | null;
  providers: Record<string, { has_secret: boolean; secret_masked: string | null; has_public: boolean; public_masked: string | null; updated_at: string }>;
  cache: { rows: number; hits: number; last_7d: number };
}

type ProbeState = { label: string; ok: boolean | null; detail: string };

export default function AdminMap() {
  const [st, setSt] = useState<Status | null>(null);
  const [tileUrl, setTileUrl] = useState('');
  const [attr, setAttr] = useState('');
  const [tune, setTune] = useState({ min: '4', debounce: '700', ttl: '90', refit: '150', poll: '10000', trackZoom: '16', maxZoom: '19' });
  const [defer, setDefer] = useState(true);
  const [keyProvider, setKeyProvider] = useState<MapProvider>('stadia');
  const [publicKey, setPublicKey] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [probe, setProbe] = useState<ProbeState[] | null>(null);

  const apply = useCallback((s: Status) => {
    setSt(s);
    setTileUrl(s.tile_url); setAttr(s.tile_attribution); setDefer(s.defer_routing);
    setTune({
      min: String(s.autocomplete_min_chars), debounce: String(s.autocomplete_debounce_ms), ttl: String(s.geocode_cache_ttl_days),
      refit: String(s.refit_min_meters), poll: String(s.driver_poll_ms), trackZoom: String(s.track_max_zoom), maxZoom: String(s.tile_max_zoom),
    });
  }, []);

  const load = useCallback(async () => {
    try { apply(await rpc<Status>('admin_map_status')); }
    catch (e) { toast.error((e as Error).message); }
  }, [apply]);
  useEffect(() => { load(); }, [load]);

  const save = async (patch: Record<string, unknown>) => {
    setSaving(true);
    try {
      const next = await rpc<Status>('admin_set_map_config', { p: patch });
      apply(next);
      reloadMapConfig();          // panel admin ikut memakai peta → segarkan segera
      toast.success('Konfigurasi peta disimpan — berlaku di aplikasi tanpa rilis ulang');
      setPublicKey(''); setSecretKey('');
    } catch (e) { toast.error((e as Error).message); }
    finally { setSaving(false); }
  };

  /** Ganti penyedia ubin: sekaligus isi template URL & atribusi bawaan penyedia itu. */
  const pickTile = (p: ProviderDef) => {
    setTileUrl(p.tile_url ?? tileUrl);
    setAttr(p.attribution ?? attr);
    save({ tile_provider: p.key, tile_url: p.tile_url ?? tileUrl, tile_attribution: p.attribution ?? attr });
  };

  const saveTuning = () => {
    const n = (v: string, d: number) => { const x = Number(String(v).replace(',', '.')); return Number.isFinite(x) ? x : d; };
    save({
      tile_url: tileUrl, tile_attribution: attr, tile_max_zoom: n(tune.maxZoom, 19),
      autocomplete_min_chars: n(tune.min, 4), autocomplete_debounce_ms: n(tune.debounce, 700),
      geocode_cache_ttl_days: n(tune.ttl, 90), defer_routing: defer,
      refit_min_meters: n(tune.refit, 150), driver_poll_ms: n(tune.poll, 10000), track_max_zoom: n(tune.trackZoom, 16),
    });
  };

  const saveKeys = () => {
    if (!publicKey.trim() && !secretKey.trim()) return toast.error('Isi minimal satu kunci');
    save({ key_provider: keyProvider, public_key: publicKey.trim(), secret_key: secretKey.trim() });
  };

  /**
   * Uji koneksi SUNGGUHAN: satu permintaan ubin + satu reverse geocode + satu rute,
   * memakai URL yang disusun server (kunci publik sudah disisipkan; secret_key tidak ikut).
   */
  const test = async () => {
    setTesting(true); setProbe(null);
    try {
      const u = await rpc<{ tile_url: string; geocode_url: string; route_url: string; route_method: string; tile_provider: string; geocode_provider: string; route_provider: string }>('admin_map_probe_urls');
      const out: ProbeState[] = [];

      // (1) satu ubin nyata (z14 di atas Pekanbaru)
      out.push(await probeTile(u.tile_url, u.tile_provider));
      // (2) satu reverse geocode
      out.push(await probeJson(`Geocode · ${u.geocode_provider}`, u.geocode_url, 'GET'));
      // (3) satu rute
      out.push(await probeJson(`Rute · ${u.route_provider}`, u.route_url, u.route_method === 'POST' ? 'POST' : 'GET'));

      setProbe(out);
      const bad = out.filter((r) => r.ok === false).length;
      if (bad === 0) toast.success('Semua uji berhasil');
      else toast.error(`${bad} dari ${out.length} uji gagal — periksa kunci & pembatasan domain`);
    } catch (e) { toast.error((e as Error).message); }
    finally { setTesting(false); }
  };

  const p = st?.providers ?? {};
  const kp = byKey(keyProvider);

  return (
    <AdminPage title="Peta" subtitle="Penyedia ubin, pencarian alamat & rute — dapat diganti tanpa rilis ulang aplikasi" onRefresh={load}>
      {st?.uses_free_osm && (
        <Entrance index={0}>
          <Card style={[stl.warn, { gap: 8 }]}>
            <Row gap={8}>
              <Ionicons name="warning" size={adminIcon.lg} color={colors.danger} />
              <Text style={[font.h2, { color: colors.danger, flex: 1 }]}>Masih memakai endpoint gratis yang melanggar syarat pakai</Text>
            </Row>
            <Text style={font.small}>
              Salah satu layanan peta masih menunjuk ke server gratis publik. Keempatnya melarang pemakaian komersial:{'\n'}
              • <Text style={{ fontWeight: '700' }}>tile.openstreetmap.org</Text> — dapat memblokir tanpa pemberitahuan; kebijakannya juga melarang URL ubin ter-hardcode.{'\n'}
              • <Text style={{ fontWeight: '700' }}>nominatim.openstreetmap.org</Text> — autocomplete DILARANG eksplisit, sanksinya ban.{'\n'}
              • <Text style={{ fontWeight: '700' }}>photon.komoot.io</Text> — situs demo; pemakaian ekstensif akan di-throttle lalu diblokir.{'\n'}
              • <Text style={{ fontWeight: '700' }}>router.project-osrm.org</Text> — server demo tanpa SLA, melarang pemakaian berat.{'\n'}
              Ganti ketiga penyedia di bawah ke akun berbayar sebelum aplikasi dirilis ke Play Store / App Store.
            </Text>
          </Card>
        </Entrance>
      )}

      <Entrance index={1}>
        <Card style={{ gap: 12 }}>
          <Row between style={{ flexWrap: 'wrap', gap: 8 }}>
            <View style={{ flex: 1, minWidth: 260 }}>
              <Text style={font.h2}>Penyedia ubin peta</Text>
              <Text style={font.small}>Mengganti penyedia di sini langsung mengubah URL ubin yang diminta semua aplikasi. Tidak perlu build ulang, tidak perlu tinjauan toko.</Text>
            </View>
            <Badge text={byKey(st?.tile_provider ?? '')?.label ?? '—'} color={st?.tile_provider === 'osm_free' ? colors.danger : colors.success} />
          </Row>
          <Row gap={8} style={{ flexWrap: 'wrap' }}>
            {TILE_CAPABLE.map((pr) => (
              <View key={pr.key} {...(Platform.OS === 'web' ? ({ dataSet: { testid: `tile-provider-${pr.key}` } } as object) : {})}>
                <Chip label={pr.label} active={st?.tile_provider === pr.key} onPress={() => pickTile(pr)} color={pr.key === 'osm_free' ? colors.danger : colors.primary} />
              </View>
            ))}
          </Row>
          <Input label="Template URL ubin" value={tileUrl} onChangeText={setTileUrl} autoCapitalize="none" placeholder="https://…/{z}/{x}/{y}.png?api_key={key}" />
          <Text style={font.tiny}>Gunakan {'{z}/{x}/{y}'} untuk koordinat ubin dan {'{key}'} untuk kunci publik — server menyisipkan kuncinya, sehingga kunci tidak perlu ditulis di sini.</Text>
          <Input label="Atribusi peta (HTML)" value={attr} onChangeText={setAttr} autoCapitalize="none" />
          <Text style={font.tiny}>Atribusi WAJIB tampil di peta menurut lisensi setiap penyedia. Teks ini ditampilkan aplikasi di atas peta dan tidak tertutup sheet.</Text>
        </Card>
      </Entrance>

      <Entrance index={2}>
        <Card style={{ gap: 12 }}>
          <Text style={font.h2}>Penyedia pencarian alamat & rute</Text>
          <Text style={font.small}>Pencarian tempat + reverse geocode memakai satu penyedia; rute bisa penyedia lain (misal Google hanya untuk pencarian, Stadia untuk sisanya).</Text>
          <Text style={font.label}>Pencarian & reverse geocode</Text>
          <Row gap={8} style={{ flexWrap: 'wrap' }}>
            {GEO_CAPABLE.map((pr) => (
              <View key={pr.key} {...(Platform.OS === 'web' ? ({ dataSet: { testid: `geocode-provider-${pr.key}` } } as object) : {})}>
                <Chip label={pr.label} active={st?.geocode_provider === pr.key} onPress={() => save({ geocode_provider: pr.key })} color={pr.key === 'osm_free' ? colors.danger : colors.primary} />
              </View>
            ))}
          </Row>
          <Text style={font.label}>Rute & jarak tempuh</Text>
          <Row gap={8} style={{ flexWrap: 'wrap' }}>
            {GEO_CAPABLE.map((pr) => (
              <View key={pr.key} {...(Platform.OS === 'web' ? ({ dataSet: { testid: `route-provider-${pr.key}` } } as object) : {})}>
                <Chip label={pr.label} active={st?.route_provider === pr.key} onPress={() => save({ route_provider: pr.key })} color={pr.key === 'osm_free' ? colors.danger : colors.primary} />
              </View>
            ))}
          </Row>
          {(['tile_provider', 'geocode_provider', 'route_provider'] as const).map((f) => {
            const w = byKey(String(st?.[f] ?? ''))?.warn;
            return w ? <Text key={f} style={[font.tiny, { color: colors.warning }]}>⚠ {w}</Text> : null;
          })}
        </Card>
      </Entrance>

      <Entrance index={3}>
        <Card style={{ gap: 12 }}>
          <Text style={font.h2}>Kunci API</Text>
          <Text style={font.small}>
            <Text style={{ fontWeight: '700' }}>Kunci rahasia</Text> disimpan seperti kunci payment gateway: hanya admin yang bisa menulis, tidak pernah dikirim mentah ke aplikasi, dan di layar ini pun hanya tampil tersamar.{'\n'}
            <Text style={{ fontWeight: '700' }}>Kunci publik</Text> memang harus ikut ke perangkat (ubin Leaflet & autocomplete dipanggil dari aplikasi). Karena itu kunci publik <Text style={{ fontWeight: '700' }}>WAJIB dibatasi per-domain (web) dan per bundle id / package name (iOS/Android)</Text> di dashboard penyedia — tanpa itu, siapa pun yang membongkar APK bisa memakainya.
          </Text>
          <Row gap={8} style={{ flexWrap: 'wrap' }}>
            {PROVIDERS.map((pr) => <Chip key={pr.key} label={pr.label} active={keyProvider === pr.key} onPress={() => { setKeyProvider(pr.key); setPublicKey(''); setSecretKey(''); }} />)}
          </Row>
          <Text style={font.tiny}>{kp?.key_hint}{kp?.console_url ? `  ·  Dashboard: ${kp.console_url}` : ''}</Text>
          <Row gap={10} style={{ flexWrap: 'wrap' }}>
            <Input label="Kunci publik (klien)" value={publicKey} onChangeText={setPublicKey} autoCapitalize="none" placeholder={p[keyProvider]?.public_masked ?? 'belum diisi'} containerStyle={{ flexGrow: 1, minWidth: 240 }} />
            <Input label="Kunci rahasia (server)" value={secretKey} onChangeText={setSecretKey} autoCapitalize="none" secureTextEntry placeholder={p[keyProvider]?.secret_masked ?? 'belum diisi'} containerStyle={{ flexGrow: 1, minWidth: 240 }} />
          </Row>
          <Row between style={{ flexWrap: 'wrap', gap: 8 }}>
            <Text style={font.tiny}>Biarkan kosong untuk tidak mengubah kunci yang sudah tersimpan.</Text>
            <Row gap={8}>
              <Button title="Hapus kunci penyedia ini" variant="secondary" icon="trash-outline" onPress={() => save({ key_provider: keyProvider, clear_secret: true, clear_public: true })} />
              <Button title="Simpan kunci" icon="key-outline" loading={saving} onPress={saveKeys} />
            </Row>
          </Row>
          <View style={stl.grid}>
            {PROVIDERS.map((pr) => {
              const s = p[pr.key];
              return (
                <View key={pr.key} style={stl.provCard}>
                  <Text style={font.bodyStrong}>{pr.label}</Text>
                  <Text style={font.tiny} numberOfLines={3}>{pr.desc}</Text>
                  <Row gap={6} style={{ marginTop: 6, flexWrap: 'wrap' }}>
                    <Badge text={s?.has_public ? `publik ${s.public_masked}` : 'publik: kosong'} color={s?.has_public ? colors.success : colors.textMuted} />
                    <Badge text={s?.has_secret ? `rahasia ${s.secret_masked}` : 'rahasia: kosong'} color={s?.has_secret ? colors.success : colors.textMuted} />
                  </Row>
                </View>
              );
            })}
          </View>
        </Card>
      </Entrance>

      <Entrance index={4}>
        <Card style={{ gap: 12 }}>
          <Row between style={{ flexWrap: 'wrap', gap: 8 }}>
            <View style={{ flex: 1, minWidth: 260 }}>
              <Text style={font.h2}>Uji koneksi</Text>
              <Text style={font.small}>Benar-benar memanggil satu ubin, satu reverse geocode, dan satu rute memakai konfigurasi yang tersimpan. Gagal biasanya berarti kunci salah atau pembatasan domain belum mengizinkan panel admin.</Text>
            </View>
            <Button title="Uji" icon="pulse-outline" loading={testing} onPress={test} />
          </Row>
          {probe?.map((r) => (
            <Row key={r.label} gap={8}>
              <Ionicons name={r.ok === null ? 'help-circle-outline' : r.ok ? 'checkmark-circle' : 'close-circle'} size={adminIcon.md} color={r.ok === null ? adminTone.faint : r.ok ? colors.success : colors.danger} />
              <Text style={[font.body, { flex: 1 }]} numberOfLines={3}>{r.label} — {r.detail}</Text>
            </Row>
          ))}
        </Card>
      </Entrance>

      <Entrance index={5}>
        <Card style={{ gap: 12 }}>
          <Text style={font.h2}>Penghematan</Text>
          <Text style={font.small}>Semua angka di bawah dibaca aplikasi saat mulai. Riset memperkirakan gabungan strategi ini memangkas biaya peta 46–68%.</Text>
          <View style={stl.grid}>
            <Input label="Minimal karakter autocomplete" value={tune.min} onChangeText={(v) => setTune((t) => ({ ...t, min: v.replace(/[^\d]/g, '') }))} keyboardType="number-pad" containerStyle={stl.field} />
            <Input label="Jeda ketik autocomplete (ms)" value={tune.debounce} onChangeText={(v) => setTune((t) => ({ ...t, debounce: v.replace(/[^\d]/g, '') }))} keyboardType="number-pad" containerStyle={stl.field} />
            <Input label="TTL cache alamat (hari)" value={tune.ttl} onChangeText={(v) => setTune((t) => ({ ...t, ttl: v.replace(/[^\d]/g, '') }))} keyboardType="number-pad" containerStyle={stl.field} />
            <Input label="Jarak minimum fit ulang peta (m)" value={tune.refit} onChangeText={(v) => setTune((t) => ({ ...t, refit: v.replace(/[^\d]/g, '') }))} keyboardType="number-pad" containerStyle={stl.field} />
            <Input label="Polling posisi driver (ms)" value={tune.poll} onChangeText={(v) => setTune((t) => ({ ...t, poll: v.replace(/[^\d]/g, '') }))} keyboardType="number-pad" containerStyle={stl.field} />
            <Input label="Zoom maksimum saat melacak" value={tune.trackZoom} onChangeText={(v) => setTune((t) => ({ ...t, trackZoom: v.replace(/[^\d]/g, '') }))} keyboardType="number-pad" containerStyle={stl.field} />
            <Input label="Zoom maksimum ubin" value={tune.maxZoom} onChangeText={(v) => setTune((t) => ({ ...t, maxZoom: v.replace(/[^\d]/g, '') }))} keyboardType="number-pad" containerStyle={stl.field} />
          </View>
          <Row between style={{ flexWrap: 'wrap', gap: 8 }}>
            <View style={{ flex: 1, minWidth: 260 }}>
              <Text style={font.bodyStrong}>Tunda panggilan rute</Text>
              <Text style={font.tiny}>Ongkos awal dihitung PostGIS di server (gratis, garis lurus × 1,3 — persis rumus estimate_fare). Rute sungguhan baru dipanggil saat pengguna menekan tombol pesan. Perkiraan hemat 40% panggilan routing; tarif tidak berubah.</Text>
            </View>
            <Switch value={defer} onValueChange={setDefer} trackColor={{ true: colors.success, false: colors.border }} thumbColor="#fff" />
          </Row>
          <Row between style={{ flexWrap: 'wrap', gap: 8 }}>
            <Text style={font.tiny}>Bawaan hemat: 4 huruf · 700 ms · TTL 90 hari · 150 m · 10.000 ms · zoom 16.</Text>
            <Button title="Simpan penghematan" icon="save-outline" loading={saving} onPress={saveTuning} />
          </Row>
        </Card>
      </Entrance>

      <Entrance index={6}>
        <Card style={{ gap: 8 }}>
          <Text style={font.h2}>Cache alamat (reverse geocode)</Text>
          <Text style={font.small}>Alamat hasil reverse geocode disimpan per petak geohash presisi 7 (±153 m) dan dipakai bersama seluruh pengguna. Riset memperkirakan rasio hit 70% setelah sebulan operasi.</Text>
          <Row gap={8} style={{ flexWrap: 'wrap' }}>
            <Badge text={`${st?.cache.rows ?? 0} petak tersimpan`} color={colors.info} />
            <Badge text={`${st?.cache.hits ?? 0} kali dipakai ulang`} color={colors.success} />
            <Badge text={`${st?.cache.last_7d ?? 0} petak baru 7 hari terakhir`} color={colors.primary} />
          </Row>
          {st?.updated_at ? <Text style={font.tiny}>Terakhir diubah {new Date(st.updated_at).toLocaleString('id-ID')}{st.updated_by ? ` oleh ${st.updated_by}` : ''}.</Text> : null}
        </Card>
      </Entrance>
    </AdminPage>
  );
}

// --- Uji koneksi -----------------------------------------------------------------------
/** Ambil satu ubin sungguhan. Di web dipakai <img> agar tidak bergantung pada header CORS penyedia. */
function probeTile(url: string, provider: string): Promise<ProbeState> {
  const label = `Ubin · ${provider}`;
  if (Platform.OS === 'web' && typeof Image !== 'undefined') {
    return new Promise<ProbeState>((resolve) => {
      const img = new Image();
      const t = setTimeout(() => resolve({ label, ok: false, detail: 'tidak ada jawaban dalam 10 detik' }), 10000);
      img.onload = () => { clearTimeout(t); resolve({ label, ok: true, detail: `ubin diterima (${img.naturalWidth}×${img.naturalHeight} px)` }); };
      img.onerror = () => { clearTimeout(t); resolve({ label, ok: false, detail: 'ubin ditolak — periksa kunci publik & pembatasan domain' }); };
      img.src = url;
    });
  }
  return fetch(url).then(
    (r) => ({ label, ok: r.ok, detail: r.ok ? `HTTP ${r.status}` : `HTTP ${r.status} — periksa kunci & pembatasan` }),
    (e: Error) => ({ label, ok: false, detail: e.message }),
  );
}

/** Satu permintaan JSON sungguhan (reverse geocode / rute). */
async function probeJson(label: string, url: string, method: 'GET' | 'POST'): Promise<ProbeState> {
  try {
    const body = method === 'POST'
      ? JSON.stringify({ locations: [{ lat: 0.5071, lon: 101.4478 }, { lat: 0.5171, lon: 101.4578 }], costing: 'auto', directions_options: { units: 'kilometers' } })
      : undefined;
    const res = await fetch(url, { method, headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body });
    if (!res.ok) return { label, ok: false, detail: `HTTP ${res.status} — periksa kunci & kuota` };
    const txt = (await res.text()).slice(0, 120);
    return { label, ok: true, detail: `HTTP ${res.status} · ${txt.replace(/\s+/g, ' ')}…` };
  } catch (e) {
    return { label, ok: false, detail: `gagal: ${(e as Error).message}` };
  }
}

const stl = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: adminSpace.md },
  field: { flexGrow: 1, minWidth: 180, flexBasis: '30%' },
  provCard: { flexGrow: 1, flexBasis: '45%', minWidth: 250, padding: adminSpace.md, borderRadius: adminRadius.card, backgroundColor: adminTone.surface, borderWidth: 1, borderColor: adminTone.border },
  warn: { borderWidth: 1, borderColor: colors.danger, backgroundColor: colors.danger + '10' },
});
