// Admin · Aset Merek (migrasi 0120).
// rpc('brand_assets_list') → logo, ikon, jaket & helm, dokumen (berkas fisik ada di repo `public/brand/`, terbit via GitHub Pages).
// URL = SITE_ROOT + '/' + file_path. Tandai terpilih / ubah judul-catatan lewat rpc('admin_brand_asset_set', { p_id, p_patch }).
// Bila RPC gagal (migrasi belum diterapkan / tanpa sesi), tampil katalog bawaan dari repo (baca saja) agar unduhan tetap bisa dipakai.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Image, Linking, Platform, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AdminPage, Panel, AdminDialog, Pill, RequirePerm, EmptyState, adminFont as font, adminTone, adminSpace, adminRadius } from '@/components/admin';
import { FootNote } from '@/components/reports';
import { Row, Input, Button, toast } from '@/components/ui';
import { rpc } from '@/lib/supabase';
import { SITE_ROOT } from '@/lib/app';
import { handleAdminError, useAdminSecurity } from '@/store/adminSecurity';
import { ErrorNote } from './_shared';

export type BrandAssetKind = 'logo' | 'ikon' | 'jaket_helm' | 'dokumen';
export interface BrandAsset {
  id: string;
  kind: BrandAssetKind;
  title: string;
  file_path: string;
  preview_path: string | null;
  bytes: number | null;
  format: string | null;
  selected: boolean;
  recommended: boolean;
  note: string | null;
  sort: number;
  /** 0120: URL penuh dari server (brand_asset_url: setelan site_url → default domain resmi). Bila kosong, dibentuk dari SITE_ROOT. */
  url?: string | null;
  preview_url?: string | null;
}

const KIND_LABEL: Record<BrandAssetKind, string> = { logo: 'Logo', ikon: 'Ikon aplikasi', jaket_helm: 'Jaket & helm', dokumen: 'Dokumen' };
const assetUrl = (path: string) => `${SITE_ROOT}/${path.replace(/^\/+/, '')}`;
const urlOf = (it: BrandAsset) => it.url || assetUrl(it.file_path);
const fmtBytes = (b: number | null | undefined) => {
  const n = Number(b ?? 0);
  if (!n) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toLocaleString('id-ID', { maximumFractionDigits: 0 })} KB`;
  return `${(n / 1024 / 1024).toLocaleString('id-ID', { maximumFractionDigits: 1 })} MB`;
};

/** Katalog bawaan (cermin `public/brand/`) — dipakai hanya bila RPC tidak tersedia. Ukuran byte dari repo saat ditulis. */
const FALLBACK: BrandAsset[] = [
  { id: 'fb-logo-putih', kind: 'logo', title: 'Logo AntarKita 1080 (putih)', file_path: 'brand/logo-antarkita-1080-putih.png', preview_path: 'brand/logo-antarkita-1080-putih.preview.webp', bytes: 16396, format: 'png', selected: true, recommended: true, note: 'Logo utama untuk latar gelap/teal.', sort: 1 },
  { id: 'fb-logo-svg', kind: 'logo', title: 'Logo AntarKita (vektor SVG)', file_path: 'brand/logo-antarkita-c29.svg', preview_path: 'brand/logo-antarkita-1080-putih.preview.webp', bytes: 384, format: 'svg', selected: true, recommended: true, note: 'Sumber vektor untuk cetak & produksi.', sort: 2 },
  { id: 'fb-ikon', kind: 'ikon', title: 'Ikon aplikasi 1024', file_path: 'brand/ikon-aplikasi-1024.png', preview_path: 'brand/ikon-aplikasi-1024.preview.webp', bytes: 18965, format: 'png', selected: true, recommended: true, note: 'Ikon Play Store / launcher.', sort: 3 },
  ...[
    ['00', 'konsep-utama', 'Konsep utama', 2161777, true, true], ['01', 'urban-teal', 'Urban Teal', 1636191, false, false], ['02', 'night-guard', 'Night Guard', 1818598, false, true],
    ['03', 'tropical-air', 'Tropical Air', 1952645, false, true], ['04', 'premium-minimal', 'Premium Minimal', 1446705, false, true], ['05', 'nusantara-flow', 'Nusantara Flow', 1518836, false, false],
    ['06', 'sport-dynamic', 'Sport Dynamic', 1752361, false, false], ['07', 'monsoon-shield', 'Monsoon Shield', 1725239, false, true], ['08', 'community-mint', 'Community Mint', 1440867, false, false],
    ['09', 'tech-grid', 'Tech Grid', 1764913, false, true], ['10', 'modular-two-season', 'Modular Two Season', 2029152, false, false],
  ].map(([no, slug, name, bytes, sel, rec], i) => ({
    id: `fb-jh-${no}`, kind: 'jaket_helm' as const, title: `${no} · ${name}`, file_path: `brand/jaket-helm-${no}-${slug}.png`, preview_path: `brand/jaket-helm-${no}-${slug}.preview.webp`,
    bytes: Number(bytes), format: 'png', selected: Boolean(sel), recommended: Boolean(rec), note: null, sort: 10 + i,
  })),
  { id: 'fb-doc-katalog', kind: 'dokumen', title: 'Katalog 10 alternatif jaket & helm', file_path: 'brand/katalog-alternatif-jaket-helm.md', preview_path: null, bytes: 2410, format: 'md', selected: false, recommended: false, note: 'Perbandingan konsep + rekomendasi advisor.', sort: 30 },
  { id: 'fb-doc-spek', kind: 'dokumen', title: 'Spesifikasi produksi jaket & helm', file_path: 'brand/spesifikasi-produksi-jaket-helm.md', preview_path: null, bytes: 3311, format: 'md', selected: false, recommended: false, note: 'Bahan, ukuran, reflektif, standar helm.', sort: 31 },
];

/** Unduh satu berkas: web → <a download> (origin sama di GitHub Pages); native → buka URL. */
function downloadUrl(url: string, filename?: string) {
  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    const a = document.createElement('a'); a.href = url; a.download = filename ?? url.split('/').pop() ?? 'berkas'; a.target = '_blank'; a.rel = 'noopener'; a.click();
    return;
  }
  Linking.openURL(url).catch(() => toast.error('Tidak bisa membuka tautan'));
}

export default function AdminAsetMerek() {
  const [items, setItems] = useState<BrandAsset[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [fallback, setFallback] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [edit, setEdit] = useState<BrandAsset | null>(null);
  const [f, setF] = useState({ title: '', note: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await rpc<BrandAsset[]>('brand_assets_list');
      const list = Array.isArray(r) ? r : [];
      setItems(list.length ? list : FALLBACK); setFallback(!list.length); setErr(null);
    } catch (e) { setErr(`Daftar aset: ${(e as Error).message} — menampilkan katalog bawaan repo (baca saja).`); setItems(FALLBACK); setFallback(true); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const byKind = useMemo(() => {
    const g: Record<BrandAssetKind, BrandAsset[]> = { logo: [], ikon: [], jaket_helm: [], dokumen: [] };
    for (const it of [...items].sort((a, b) => a.sort - b.sort || a.title.localeCompare(b.title))) (g[it.kind] ?? g.dokumen).push(it);
    return g;
  }, [items]);
  const selected = items.filter((x) => x.selected);

  const patch = async (it: BrandAsset, p: Partial<Pick<BrandAsset, 'selected' | 'title' | 'note'>>, okMsg: string) => {
    if (fallback) return toast.error('Katalog bawaan hanya baca — terapkan migrasi 0120 / masuk sebagai admin');
    if (!(await useAdminSecurity.getState().ensureUnlocked())) return;
    setBusy(it.id);
    try { await rpc('admin_brand_asset_set', { p_id: it.id, p_patch: p }); toast.success(okMsg); await load(); }
    catch (e) { handleAdminError(e); } finally { setBusy(null); }
  };
  const saveEdit = async () => {
    if (!edit) return;
    const title = f.title.trim();
    if (title.length < 3 || title.length > 120) return toast.error('Judul 3–120 karakter');
    await patch(edit, { title, note: f.note.trim() || null }, 'Judul & catatan disimpan');
    setEdit(null);
  };
  const downloadAll = () => {
    if (!selected.length) return toast.error('Belum ada aset bertanda Terpilih');
    selected.forEach((it, i) => setTimeout(() => downloadUrl(urlOf(it)), i * 350));
    toast.success(`${selected.length} berkas diunduh — izinkan unduhan ganda bila browser bertanya`);
  };

  const card = (it: BrandAsset) => {
    const previewPath = it.preview_path || (/\.(png|jpe?g|webp|svg)$/i.test(it.file_path) ? it.file_path : null);
    const preview = it.preview_url || (previewPath ? assetUrl(previewPath) : null);
    return (
      <View key={it.id} style={[st.card, it.selected && { borderColor: adminTone.teal, borderWidth: 2 }]}>
        <View style={st.previewBox}>
          {preview ? <Image source={{ uri: preview }} style={st.preview} resizeMode="contain" accessibilityLabel={it.title} /> : <Ionicons name="image-outline" size={28} color={adminTone.faint} />}
          <Row gap={4} style={st.badges}>
            {it.selected ? <Pill text="Terpilih" tone="ok" icon="checkmark-circle" /> : null}
            {it.recommended ? <Pill text="Rekomendasi" tone="info" icon="star" /> : null}
          </Row>
        </View>
        <View style={{ padding: adminSpace.md, gap: 6, flex: 1 }}>
          <Text style={font.bodyStrong} numberOfLines={2}>{it.title}</Text>
          <Text style={font.tiny} numberOfLines={1}>{(it.format ?? it.file_path.split('.').pop() ?? '').toUpperCase()} · {fmtBytes(it.bytes)} · {it.file_path.split('/').pop()}</Text>
          {it.note ? <Text style={font.small} numberOfLines={3}>{it.note}</Text> : null}
          <View style={{ flex: 1 }} />
          <Row gap={6} style={{ flexWrap: 'wrap' }}>
            <Button size="sm" title="Unduh" icon="download-outline" onPress={() => downloadUrl(urlOf(it))} />
            <RequirePerm perm={['city', 'ops', 'settings']} fallback={null}>
              <Button size="sm" variant={it.selected ? 'outline' : 'secondary'} title={it.selected ? 'Batal pilih' : 'Tandai terpilih'} icon={it.selected ? 'close-circle-outline' : 'checkmark-circle-outline'} loading={busy === it.id} disabled={busy !== null || fallback} onPress={() => patch(it, { selected: !it.selected }, it.selected ? `${it.title} dibatalkan` : `${it.title} ditandai terpilih`)} />
              <Button size="sm" variant="ghost" title="Catatan" icon="create-outline" disabled={busy !== null || fallback} onPress={() => { setF({ title: it.title, note: it.note ?? '' }); setEdit(it); }} />
            </RequirePerm>
          </Row>
        </View>
      </View>
    );
  };

  const grid = (kind: BrandAssetKind) => (byKind[kind].length
    ? <View style={st.grid}>{byKind[kind].map(card)}</View>
    : <EmptyState icon="image-outline" title={loading ? 'Memuat…' : `Belum ada aset ${KIND_LABEL[kind].toLowerCase()}`} />);

  return (
    <AdminPage title="Aset Merek" subtitle="Logo, ikon aplikasi, konsep jaket & helm, dan dokumen produksi. Berkas asli ada di situs resmi (public/brand) — unduh langsung atau tandai yang dipakai." onRefresh={load}
      right={<Row gap={8}>
        <Button size="sm" variant="outline" title="Segarkan" icon="refresh-outline" onPress={load} />
        <Button size="sm" title={`Unduh semua terpilih (${selected.length})`} icon="cloud-download-outline" disabled={!selected.length} onPress={downloadAll} />
      </Row>}>
      <ErrorNote text={err} onRetry={load} />
      {fallback && !err ? <Text style={font.tiny}>Server belum punya data aset — menampilkan katalog bawaan repo (baca saja).</Text> : null}

      <Panel title="Logo & Ikon" subtitle="Logo putih untuk latar teal/gelap, SVG untuk cetak; ikon 1024 untuk Play Store & launcher." icon="color-palette-outline">
        <View style={{ gap: adminSpace.md }}>
          {grid('logo')}
          {byKind.ikon.length ? <>
            <Text style={font.label}>Ikon aplikasi</Text>
            {grid('ikon')}
          </> : null}
        </View>
      </Panel>

      <Panel title="Jaket & Helm" subtitle={`${byKind.jaket_helm.length} konsep (mockup, bukan gambar teknik). Rekomendasi advisor: Tropical Air sebagai basis harian, reflektor Night Guard, Monsoon Shield untuk musim hujan, helm Premium Minimal / Tech Grid.`} icon="shirt-outline" iconColor={adminTone.orange}>
        {grid('jaket_helm')}
      </Panel>

      <Panel title="Dokumen" subtitle="Katalog & spesifikasi produksi (Markdown) — dibuka di tab baru / diunduh." icon="document-text-outline" iconColor={adminTone.blue}>
        {byKind.dokumen.length ? (
          <View style={{ gap: 8 }}>
            {byKind.dokumen.map((d) => (
              <Row key={d.id} between style={st.docRow}>
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <Text style={font.bodyStrong} numberOfLines={1}>{d.title}</Text>
                  <Text style={font.tiny} numberOfLines={1}>{d.file_path} · {fmtBytes(d.bytes)}{d.note ? ` · ${d.note}` : ''}</Text>
                </View>
                <Row gap={6}>
                  <Button size="sm" variant="outline" title="Buka" icon="open-outline" onPress={() => Linking.openURL(urlOf(d)).catch(() => toast.error('Tidak bisa membuka tautan'))} />
                  <Button size="sm" variant="secondary" title="Unduh" icon="download-outline" onPress={() => downloadUrl(urlOf(d))} />
                </Row>
              </Row>
            ))}
          </View>
        ) : <EmptyState icon="document-text-outline" title={loading ? 'Memuat…' : 'Belum ada dokumen'} />}
      </Panel>

      <AdminDialog visible={!!edit} onClose={() => (busy ? undefined : setEdit(null))} title={`Ubah judul & catatan`} subtitle={edit?.file_path}>
        <View style={{ gap: 10 }}>
          <Input label="Judul" value={f.title} onChangeText={(v) => setF({ ...f, title: v })} />
          <Input label="Catatan" value={f.note} onChangeText={(v) => setF({ ...f, note: v })} placeholder="mis. dipakai untuk batch produksi pertama" />
          <Row gap={8} style={{ justifyContent: 'flex-end' }}>
            <Button size="sm" variant="ghost" title="Batal" disabled={busy !== null} onPress={() => setEdit(null)} />
            <Button size="sm" title="Simpan" icon="save-outline" loading={!!edit && busy === edit.id} onPress={saveEdit} />
          </Row>
        </View>
      </AdminDialog>

      <FootNote lines={[
        `Berkas disajikan dari ${SITE_ROOT}/brand/… (GitHub Pages). Mengubah berkas = mengganti isi public/brand di repo, bukan lewat panel ini.`,
        'Tanda "Terpilih" / judul / catatan disimpan di tabel brand_assets (migrasi 0120, izin city) dan dicatat di log aktivitas (brand.asset_set); "Rekomendasi" berasal dari kajian advisor dan tidak diubah dari panel. Mitra (driver/merchant) boleh membaca daftar lewat brand_assets_list, tetapi app Mitra belum menampilkannya.',
        'Gambar jaket & helm adalah concept mockup — bukan gambar teknik produksi maupun bukti sertifikasi helm (SNI). Spesifikasi final mengikuti dokumen produksi dan vendor.',
      ]} />
    </AdminPage>
  );
}

const st = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: adminSpace.md },
  card: { width: 250, flexGrow: 1, maxWidth: 340, borderWidth: 1, borderColor: adminTone.border, borderRadius: adminRadius.card, backgroundColor: adminTone.surface, overflow: 'hidden' },
  previewBox: { height: 170, backgroundColor: adminTone.bg, alignItems: 'center', justifyContent: 'center' },
  preview: { width: '100%', height: '100%' },
  badges: { position: 'absolute', top: 8, left: 8, flexWrap: 'wrap' },
  docRow: { gap: 10, padding: adminSpace.md, borderWidth: 1, borderColor: adminTone.border, borderRadius: adminRadius.md, backgroundColor: adminTone.surfaceAlt, flexWrap: 'wrap' },
});
