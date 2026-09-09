// Admin · Data Tempat: toko & pasar terdaftar (admin / pengguna / peta OSM) + usulan pengguna (crowdsourcing) dengan moderasi otomatis
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Image, Linking, Pressable, StyleSheet, Switch } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AdminPage, FilterBar, StatCard, ReasonPrompt, Table, AdminSelect, adminFont as font, adminTone, adminSpace, adminRadius, adminIcon, AdminCard as Card, EmptyState as Empty } from '@/components/admin';
import { Row, Button, Badge, IconCircle, Input, toast } from '@/components/ui';
import { Entrance, Skeleton } from '@/components/motion';
import { rpc, supabase } from '@/lib/supabase';
import { colors } from '@/lib/theme';
import { cityName, storeBrandLabel, storeCategoryLabel } from '@/lib/format';
import type { City, Market, PlaceSuggestion, ShopStore } from '@/lib/types';
import { fmtDate, fmtAgo, WideTableHint } from './_shared';

const TABS = [{ key: 'pending', label: 'Menunggu' }, { key: 'approved', label: 'Aktif' }, { key: 'rejected', label: 'Ditolak' }, { key: 'all', label: 'Semua' }];
const STATUS_LABEL: Record<string, string> = { pending: 'Menunggu', approved: 'Aktif', rejected: 'Ditolak', merged: 'Digabung' };
const STATUS_COLOR: Record<string, string> = { pending: colors.warning, approved: colors.success, rejected: colors.danger, merged: colors.info };
const osm = (lat: number, lng: number) => `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}`;

type Source = 'admin' | 'crowd' | 'osm';
const SOURCE_LABEL: Record<Source, string> = { admin: 'Admin', crowd: 'Pengguna', osm: 'Peta (OSM)' };
const SOURCE_COLOR: Record<Source, string> = { admin: colors.textSecondary, crowd: colors.info, osm: colors.primary };
type PlaceRow = { id: string; kind: 'store' | 'market'; name: string; sub: string; address: string | null; lat: number; lng: number; city_id: string | null; open_hours: string | null; source: Source; osm_id: string | null; active: boolean; created_at?: string };

export default function AdminPlaces() {
  const [main, setMain] = useState<'places' | 'suggest'>('places');
  return (
    <AdminPage title="Data Tempat" subtitle="Toko & pasar yang dipakai AntarShop / AntarMarket: data admin, usulan pengguna, dan hasil impor peta (OpenStreetMap)">
      <FilterBar value={main} onChange={(v) => setMain(v as never)} options={[{ key: 'places', label: 'Toko & pasar terdaftar' }, { key: 'suggest', label: 'Usulan pengguna' }]} />
      {main === 'places' ? <RegisteredPlaces /> : <Suggestions />}
      <WideTableHint />
    </AdminPage>
  );
}

// ---------- Tab 1: toko & pasar terdaftar ----------
function RegisteredPlaces() {
  const [rows, setRows] = useState<PlaceRow[] | null>(null);
  const [cities, setCities] = useState<City[]>([]);
  const [kind, setKind] = useState<'all' | 'store' | 'market'>('all');
  const [source, setSource] = useState<'all' | Source>('all');
  const [city, setCity] = useState('');
  const [q, setQ] = useState('');
  const load = useCallback(async () => {
    try {
      const [{ data: st, error: e1 }, { data: mk, error: e2 }, { data: ct }, { data: sg }] = await Promise.all([
        supabase.from('shop_stores').select('*').order('name'),
        supabase.from('markets').select('*').order('name'),
        supabase.from('cities').select('*').order('name'),
        supabase.from('place_suggestions').select('target_id,kind').eq('kind', 'market').not('target_id', 'is', null),
      ]);
      if (e1) throw new Error(e1.message); if (e2) throw new Error(e2.message);
      const crowdMarkets = new Set(((sg as { target_id: string }[] | null) ?? []).map((x) => x.target_id));
      const stores: PlaceRow[] = ((st as ShopStore[]) ?? []).map((s) => ({ id: s.id, kind: 'store', name: s.name, sub: [storeBrandLabel[s.brand] ?? s.brand, storeCategoryLabel[s.category] ?? s.category].filter(Boolean).join(' · '), address: s.address, lat: s.lat, lng: s.lng, city_id: s.city_id ?? null, open_hours: s.open_hours, source: (s.catalog_source === 'crowd' || s.catalog_source === 'osm' ? s.catalog_source : s.osm_id ? 'osm' : 'admin') as Source, osm_id: s.osm_id ?? null, active: s.active !== false, created_at: s.created_at }));
      const markets: PlaceRow[] = ((mk as Market[]) ?? []).map((m) => ({ id: m.id, kind: 'market', name: m.name, sub: 'Pasar tradisional', address: m.address, lat: m.lat, lng: m.lng, city_id: m.city_id ?? null, open_hours: m.open_hours, source: m.osm_id || (m.notes ?? '').includes('OpenStreetMap') ? 'osm' : crowdMarkets.has(m.id) ? 'crowd' : 'admin', osm_id: m.osm_id ?? null, active: m.active !== false, created_at: m.created_at }));
      setRows([...stores, ...markets].sort((a, b) => a.name.localeCompare(b.name)));
      setCities((ct as City[]) ?? []);
    } catch (e) { toast.error((e as Error).message); setRows([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const toggleActive = async (r: PlaceRow) => {
    const next = !r.active;
    setRows((rs) => rs?.map((x) => (x.id === r.id && x.kind === r.kind ? { ...x, active: next } : x)) ?? rs);
    const { error } = await supabase.from(r.kind === 'store' ? 'shop_stores' : 'markets').update({ active: next }).eq('id', r.id);
    if (error) { toast.error(error.message); setRows((rs) => rs?.map((x) => (x.id === r.id && x.kind === r.kind ? { ...x, active: !next } : x)) ?? rs); }
    else toast.success(`${r.name} ${next ? 'diaktifkan' : 'dinonaktifkan'}${next ? '' : ' — tidak tampil ke pelanggan'}`);
  };

  const all = rows ?? [];
  const shown = useMemo(() => all.filter((r) => (kind === 'all' || r.kind === kind) && (source === 'all' || r.source === source) && (!city || r.city_id === city)
    && (!q || r.name.toLowerCase().includes(q.toLowerCase()) || (r.address ?? '').toLowerCase().includes(q.toLowerCase()))), [all, kind, source, city, q]);
  const n = (f: (r: PlaceRow) => boolean) => all.filter(f).length;

  return (<>
    <Row gap={adminSpace.lg} style={{ flexWrap: 'wrap' }}>
      <StatCard index={0} icon="storefront-outline" label="Toko" value={n((r) => r.kind === 'store')} hint={`${n((r) => r.kind === 'store' && r.active)} aktif`} color={adminTone.teal} />
      <StatCard index={1} icon="basket-outline" label="Pasar" value={n((r) => r.kind === 'market')} hint={`${n((r) => r.kind === 'market' && r.active)} aktif`} color={adminTone.orange} />
      <StatCard index={2} icon="people-outline" label="Dari pengguna" value={n((r) => r.source === 'crowd')} hint="usulan disetujui" color={adminTone.blue} />
      <StatCard index={3} icon="map-outline" label="Dari peta (OSM)" value={n((r) => r.source === 'osm')} hint="impor otomatis" color={adminTone.violet} />
    </Row>
    <Row gap={adminSpace.md} style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
      <FilterBar value={kind} onChange={(v) => setKind(v as never)} options={[{ key: 'all', label: `Semua (${all.length})` }, { key: 'store', label: 'Toko' }, { key: 'market', label: 'Pasar' }]} />
      <AdminSelect icon="git-branch-outline" width={180} value={source === 'all' ? '' : source} clearable clearLabel="Semua sumber" placeholder="Semua sumber"
        options={(['admin', 'crowd', 'osm'] as const).map((k) => ({ value: k, label: SOURCE_LABEL[k], color: SOURCE_COLOR[k] }))}
        onChange={(v) => setSource((v || 'all') as 'all' | Source)} />
      <AdminSelect icon="location-outline" width={180} value={city} clearable clearLabel="Semua kota" placeholder="Semua kota"
        options={cities.map((c) => ({ value: c.id, label: c.name, sublabel: c.province ?? undefined }))} onChange={setCity} />
      <Input placeholder="Cari nama / alamat" value={q} onChangeText={setQ} icon="search" containerStyle={{ minWidth: 220, flex: 1 }} />
    </Row>
    <Entrance index={1}>
      <Card style={{ backgroundColor: colors.tint, borderColor: colors.primary + '30', gap: 4 }}>
        <Row gap={8}><Ionicons name="information-circle-outline" size={adminIcon.md} color={colors.primary} /><Text style={font.h3}>Sumber data</Text></Row>
        <Text style={font.small}>Admin: dibuat lewat menu AntarShop / AntarMarket. Pengguna: usulan pelanggan yang disetujui (tab Usulan pengguna). Peta (OSM): diimpor otomatis dari OpenStreetMap saat area pelanggan belum punya data — periksa nama & jam buka, nonaktifkan bila tidak sesuai. Sakelar Aktif langsung menyembunyikan tempat dari pelanggan.</Text>
      </Card>
    </Entrance>
    {rows === null ? <Skeleton height={240} radius={20} /> : (
      <Table rows={shown as unknown as Record<string, unknown>[]} keyField="id" emptyText="Tidak ada tempat pada filter ini" columns={[
        { key: 'name', label: 'Tempat', width: 250, render: (r) => { const p = r as unknown as PlaceRow; return <View style={{ minWidth: 0, alignSelf: 'stretch' }}><Text style={font.bodyStrong} numberOfLines={1}>{p.name}</Text><Text style={font.tiny} numberOfLines={2}>{p.address ?? '—'}</Text></View>; } },
        { key: 'kind', label: 'Jenis', width: 130, render: (r) => { const p = r as unknown as PlaceRow; return <View style={{ gap: 2 }}><Badge text={p.kind === 'store' ? 'Toko' : 'Pasar'} color={p.kind === 'store' ? colors.shop : colors.market} /><Text style={font.tiny} numberOfLines={1}>{p.sub}</Text></View>; } },
        { key: 'source', label: 'Sumber', width: 108, render: (r) => { const p = r as unknown as PlaceRow; return <Badge text={SOURCE_LABEL[p.source]} color={SOURCE_COLOR[p.source]} />; } },
        { key: 'city', label: 'Kota', width: 108, render: (r) => { const p = r as unknown as PlaceRow; return <Text style={font.small}>{p.city_id ? cityName(cities, p.city_id) : '—'}</Text>; } },
        { key: 'open_hours', label: 'Jam buka', width: 96, render: (r) => <Text style={font.tiny}>{String(r.open_hours ?? '—')}</Text> },
        { key: 'map', label: 'Peta', width: 130, render: (r) => { const p = r as unknown as PlaceRow; return <Pressable onPress={() => Linking.openURL(p.osm_id && /^(node|way|relation)\//.test(p.osm_id) ? `https://www.openstreetmap.org/${p.osm_id}` : osm(p.lat, p.lng))} hitSlop={4}><Row gap={4}><Ionicons name="navigate-outline" size={adminIcon.sm} color={colors.primary} /><Text style={[font.tiny, { color: colors.primary, fontWeight: '700' }]}>{p.osm_id ? 'Buka di OSM' : `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`}</Text></Row></Pressable>; } },
        { key: 'active', label: 'Aktif', width: 66, render: (r) => { const p = r as unknown as PlaceRow; return <Switch value={p.active} onValueChange={() => toggleActive(p)} trackColor={{ true: colors.success, false: colors.border }} thumbColor="#fff" />; } },
      ]} />
    )}
  </>);
}

// ---------- Tab 2: usulan pengguna (crowdsourcing) ----------
function Suggestions() {
  const [tab, setTab] = useState('pending');
  const [rows, setRows] = useState<PlaceSuggestion[] | null>(null);
  const [rule, setRule] = useState({ reports: 3, radius: 50 });
  const [reject, setReject] = useState<PlaceSuggestion | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [list, { data: st }] = await Promise.all([
        rpc<PlaceSuggestion[]>('admin_place_suggestions', { p_status: tab }),
        supabase.from('app_settings').select('key,value').in('key', ['place_auto_approve_reports', 'place_dedup_radius_m']),
      ]);
      setRows(list ?? []);
      const m = Object.fromEntries(((st as { key: string; value: unknown }[]) ?? []).map((r) => [r.key, Number(r.value)]));
      setRule({ reports: m.place_auto_approve_reports || 3, radius: m.place_dedup_radius_m || 50 });
    } catch (e) { toast.error((e as Error).message); setRows([]); }
  }, [tab]);
  useEffect(() => { setRows(null); load(); }, [load]);

  const review = async (s: PlaceSuggestion, approve: boolean, note?: string) => {
    setBusyId(s.id);
    try {
      await rpc('admin_review_place_suggestion', { p_id: s.id, p_approve: approve, p_note: note ?? null });
      toast.success(approve ? `"${s.name}" disetujui & aktif untuk pelanggan` : `Usulan "${s.name}" ditolak`);
      setReject(null); load();
    } catch (e) { toast.error((e as Error).message); } finally { setBusyId(null); }
  };

  const pending = rows?.filter((r) => r.status === 'pending').length ?? 0;
  const conflicts = rows?.filter((r) => (r.nearby_conflicts ?? 0) > 0 && r.status === 'pending').length ?? 0;
  const autoN = rows?.filter((r) => r.auto).length ?? 0;

  return (<>
    <ReasonPrompt visible={!!reject} title={`Tolak usulan "${reject?.name}"?`} subtitle="Alasan dikirim ke pengusul sebagai notifikasi." confirmLabel="Tolak usulan" optional quick={['Tempat tidak ditemukan di lokasi', 'Duplikat data yang sudah ada', 'Informasi tidak lengkap / tidak jelas', 'Sudah tutup permanen']} onCancel={() => setReject(null)} onSubmit={(r) => review(reject!, false, r || undefined)} />
    <Row gap={adminSpace.lg} style={{ flexWrap: 'wrap' }}>
      <StatCard index={0} icon="hourglass-outline" label="Menunggu (tab ini)" value={pending} color={adminTone.amber} />
      <StatCard index={1} icon="copy-outline" label="Berpotensi duplikat" value={conflicts} hint={`usulan lain dalam ${rule.radius} m`} color={adminTone.red} />
      <StatCard index={2} icon="sparkles-outline" label="Disetujui otomatis" value={autoN} hint={`ambang ${rule.reports} laporan konsisten`} color={adminTone.green} />
    </Row>
    <Entrance index={1}>
      <Card style={{ backgroundColor: colors.tint, borderColor: colors.primary + '30', gap: 4 }}>
        <Row gap={8}><Ionicons name="sparkles-outline" size={adminIcon.md} color={colors.primary} /><Text style={font.h3}>Moderasi otomatis</Text></Row>
        <Text style={font.small}>Usulan yang sama (nama mirip dalam radius {rule.radius} m) digabung menjadi satu dan menambah hitungan laporan. Saat mencapai {rule.reports} laporan dari pengguna berbeda, tempat aktif otomatis tanpa tinjauan admin (ditandai "Otomatis"). Usulan pembaruan data toko/pasar yang sudah ada memperbarui kolom yang diisi saja. Ambang & radius diubah di halaman Otomasi.</Text>
      </Card>
    </Entrance>
    <FilterBar value={tab} onChange={setTab} options={TABS} />
    {rows === null ? <View style={{ gap: 12 }}><Skeleton height={140} radius={20} /><Skeleton height={140} radius={20} /></View>
      : rows.length === 0 ? <Card><Empty icon="map-outline" title="Tidak ada usulan" subtitle={tab === 'pending' ? 'Semua usulan sudah ditinjau.' : 'Belum ada data pada filter ini.'} /></Card>
      : rows.map((s, i) => (
        <Entrance key={s.id} index={Math.min(i, 8) + 2}>
          <Card style={{ gap: 12 }}>
            <Row gap={12} style={{ alignItems: 'flex-start' }}>
              {s.photo_url ? <Pressable onPress={() => Linking.openURL(s.photo_url!)}><Image source={{ uri: s.photo_url }} style={st.photo} /></Pressable> : <IconCircle name={s.kind === 'store' ? 'storefront-outline' : 'basket-outline'} size={64} color={s.kind === 'store' ? colors.shop : colors.market} />}
              <View style={{ flex: 1, gap: 6, minWidth: 0 }}>
                <Row gap={6} style={{ flexWrap: 'wrap' }}>
                  <Badge text={s.kind === 'store' ? 'Toko' : 'Pasar'} color={s.kind === 'store' ? colors.shop : colors.market} />
                  <Badge text={STATUS_LABEL[s.status] ?? s.status} color={STATUS_COLOR[s.status] ?? colors.textMuted} />
                  <Badge text={`${s.reports}/${rule.reports} laporan`} color={s.reports >= rule.reports ? colors.success : colors.info} />
                  {s.auto ? <Badge text="Otomatis" color={colors.success} /> : null}
                  {s.target_id && s.existing_name ? <Badge text={`memperbarui: ${s.existing_name}`} color={colors.info} /> : null}
                </Row>
                <Text style={font.h2}>{s.name}</Text>
                <Text style={font.small}>{[s.brand ? (storeBrandLabel[s.brand] ?? s.brand) : null, s.category ? (storeCategoryLabel[s.category] ?? s.category) : null].filter(Boolean).join(' · ') || 'Tanpa brand/kategori'}</Text>
                {s.address ? <Row gap={6} style={{ alignItems: 'flex-start' }}><Ionicons name="location-outline" size={adminIcon.sm} color={adminTone.faint} style={{ marginTop: 2 }} /><Text style={[font.small, { flex: 1 }]}>{s.address}</Text></Row> : null}
                <Row gap={14} style={{ flexWrap: 'wrap' }}>
                  {s.open_hours ? <Row gap={4}><Ionicons name="time-outline" size={adminIcon.sm} color={adminTone.faint} /><Text style={font.tiny}>{s.open_hours}</Text></Row> : null}
                  {s.phone ? <Row gap={4}><Ionicons name="call-outline" size={adminIcon.sm} color={adminTone.faint} /><Text style={font.tiny}>{s.phone}</Text></Row> : null}
                  <Pressable onPress={() => Linking.openURL(osm(s.lat, s.lng))}><Row gap={4}><Ionicons name="navigate-outline" size={adminIcon.sm} color={colors.primary} /><Text style={[font.tiny, { color: colors.primary, fontWeight: '700' }]}>{s.lat.toFixed(5)}, {s.lng.toFixed(5)} · buka peta</Text></Row></Pressable>
                </Row>
                {s.notes ? <Text style={[font.tiny, { fontStyle: 'italic' }]}>"{s.notes}"</Text> : null}
                <Text style={font.tiny}>Pengusul {s.submitter ?? '-'} · {fmtDate(s.created_at)}{s.reviewed_at ? ` · ditinjau ${fmtDate(s.reviewed_at)}` : ''}{s.review_note ? ` · ${s.review_note}` : ''}</Text>
                {(s.nearby_conflicts ?? 0) > 0 ? (
                  <View style={st.warn}><Ionicons name="warning-outline" size={adminIcon.md} color={colors.warning} /><Text style={[font.small, { color: colors.warning, fontWeight: '700', flex: 1 }]}>{s.nearby_conflicts} usulan lain dengan nama berbeda dalam radius {rule.radius} m — periksa duplikat sebelum menyetujui.</Text></View>
                ) : null}
              </View>
            </Row>
            {s.status === 'pending' ? (
              <Row gap={8} style={{ justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                <Button size="sm" title="Tolak" variant="outline" color={colors.danger} onPress={() => setReject(s)} />
                <Button size="sm" title={s.target_id ? 'Setujui pembaruan' : 'Setujui & aktifkan'} color={colors.success} icon="checkmark" loading={busyId === s.id} onPress={() => review(s, true)} />
              </Row>
            ) : null}
          </Card>
        </Entrance>
      ))}
  </>);
}

const st = StyleSheet.create({
  photo: { width: 96, height: 96, borderRadius: adminRadius.card, backgroundColor: adminTone.surfaceAlt },
  warn: { flexDirection: 'row', alignItems: 'center', gap: adminSpace.sm, padding: 10, borderRadius: adminRadius.card, backgroundColor: colors.accentLight, borderWidth: 1, borderColor: colors.warning + '44' },
});
