// Admin · Iklan & Kampanye — v3 (finpay-v3, kontrak §7), menggantikan layar iklan v2 (0101).
//   • Antrean review: rpc('admin_campaigns', { p_status: 'pending_review' }) + pratinjau materi + checklist brand safety
//     → rpc('admin_campaign_review', { p_id, p_approve, p_note })
//   • Semua kampanye: rpc('admin_campaigns', { p_status }) · jeda/lanjut/hentikan → rpc('admin_campaign_set', { p_id, p_action })
//   • Katalog produk: select ad_products (RLS admin) · ubah/buat → rpc('admin_set_ad_product', { p_code, p_patch }) (PIN)
//   • Laporan: rpc('admin_ads_report', { p_from, p_to }) — pendapatan iklan, per produk, per merchant, klik ter-dedupe (fraud).
// Iklan selalu berlabel "Sponsored" dan dipisahkan dari hasil organik (ranking organik tidak berubah).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Switch, Pressable, Image } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import {
  AdminPage, Panel, DataTable, FilterBar, Toolbar, Pill, AdminSelect, AdminDialog, StatCard, RequirePerm,
  adminFont as font, adminTone, adminSpace, adminRadius, adminIcon, TONE, type ToneKey,
} from '@/components/admin';
import { DateField, FootNote, RANGE_PRESETS, presetRange, rangeError, rangeLabel, type DateRange, type RangePreset } from '@/components/reports';
import { Row, Input, Button, toast } from '@/components/ui';
import { rpc, supabase } from '@/lib/supabase';
import { colors } from '@/lib/theme';
import { rupiah } from '@/lib/format';
import { handleAdminError, useAdminSecurity } from '@/store/adminSecurity';
import {
  BRAND_SAFETY, CAMPAIGN_STATUS_LABEL, PRICING_MODEL_LABEL, asList, campaignTone, idNum, useAdminCan,
  type AdCampaign, type AdProductV3, type PricingModel,
} from '@/lib/admin';
import { ErrorNote, LabelPill, fmtDate, labelTags, parseNum, Trunc, WideTableHint, moneyCol, countCol } from './_shared';

type Tab = 'review' | 'campaigns' | 'catalog' | 'report';
const TABS: { key: Tab; label: string }[] = [
  { key: 'review', label: 'Antrean review' }, { key: 'campaigns', label: 'Semua kampanye' }, { key: 'catalog', label: 'Katalog produk' }, { key: 'report', label: 'Laporan' },
];
const STATUS_FILTERS = [
  { key: 'active', label: 'Tayang' }, { key: 'paused', label: 'Dijeda' }, { key: 'approved', label: 'Disetujui' }, { key: 'budget_exhausted', label: 'Budget habis' },
  { key: 'rejected', label: 'Ditolak' }, { key: 'ended', label: 'Selesai' }, { key: 'all', label: 'Semua' },
];
const MODEL_OPTS = (Object.keys(PRICING_MODEL_LABEL) as PricingModel[]).map((k) => ({ value: k, label: PRICING_MODEL_LABEL[k] }));
const unitHint = (m?: string | null) => (m === 'cpc' ? 'per klik' : m === 'cpm' ? 'per 1.000 impresi' : m === 'cpa' ? 'per konversi (Rp atau % di catatan)' : 'per hari/periode');
const num = (o: Record<string, unknown> | null | undefined, ...keys: string[]) => { for (const k of keys) { const v = o?.[k]; if (v != null && v !== '' && Number.isFinite(Number(v))) return Number(v); } return 0; };

export default function AdminAds() {
  const [tab, setTab] = useState<Tab>('review');
  return (
    <AdminPage title="Iklan & Kampanye" subtitle="Review materi iklan merchant (brand safety), kendali kampanye, katalog produk iklan, dan laporan pendapatan. Iklan selalu berlabel “Sponsored”.">
      <RequirePerm perm={['ads_review', 'ads_product', 'view']} mode="notice">
        <FilterBar options={TABS} value={tab} onChange={(v) => setTab(v as Tab)} />
        {tab === 'review' ? <ReviewQueue /> : tab === 'campaigns' ? <CampaignList /> : tab === 'catalog' ? <Catalog /> : <AdsReport />}
      </RequirePerm>
    </AdminPage>
  );
}

/* ───────────────────────── Pratinjau materi ───────────────────────── */

function CreativePreview({ c, big }: { c: AdCampaign; big?: boolean }) {
  const cr = c.creative ?? {};
  return (
    <View style={[st.creative, big && { padding: adminSpace.md }]}>
      <View style={st.sponsored}><Text style={st.sponsoredText}>{c.label ?? 'Sponsored'}</Text></View>
      {cr.image_url ? <Image source={{ uri: cr.image_url }} style={[st.img, big && { height: 180 }]} resizeMode="cover" /> : <View style={[st.img, st.noImg, big && { height: 180 }]}><Ionicons name="image-outline" size={24} color={adminTone.faint} /><Text style={font.tiny}>tanpa gambar</Text></View>}
      <Text style={[font.bodyStrong, { marginTop: 6 }]} numberOfLines={big ? 3 : 2}>{cr.headline ?? c.name ?? '(tanpa judul)'}</Text>
      <Text style={font.tiny} numberOfLines={1}>{c.merchant_name ?? '—'}</Text>
      {cr.cta ? <View style={st.cta}><Text style={st.ctaText}>{cr.cta}</Text></View> : null}
    </View>
  );
}

/* ───────────────────────── Antrean review ───────────────────────── */

function ReviewQueue() {
  const can = useAdminCan();
  const [rows, setRows] = useState<AdCampaign[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState<AdCampaign | null>(null);
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'ok' | 'no' | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(asList<AdCampaign>(await rpc('admin_campaigns', { p_status: 'pending_review' }))); setErr(null); }
    catch (e) { setErr((e as Error).message); setRows([]); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const open = (c: AdCampaign) => { setSel(c); setChecks({}); setNote(''); };
  const allOk = BRAND_SAFETY.every((b) => checks[b.key]);
  const decide = async (approve: boolean) => {
    if (!sel) return;
    if (approve && !allOk) return toast.error('Centang semua butir brand safety sebelum menyetujui');
    if (!approve && note.trim().length < 5) return toast.error('Tulis alasan penolakan (min. 5 huruf) — dikirim ke merchant');
    if (!(await useAdminSecurity.getState().ensureUnlocked())) return;
    const failed = BRAND_SAFETY.filter((b) => !checks[b.key]).map((b) => b.label);
    const p_note = approve
      ? [`Brand safety ${BRAND_SAFETY.length}/${BRAND_SAFETY.length} OK`, note.trim()].filter(Boolean).join(' · ')
      : [note.trim(), failed.length ? `Tidak lolos: ${failed.join('; ')}` : ''].filter(Boolean).join(' · ');
    setBusy(approve ? 'ok' : 'no');
    try {
      await rpc('admin_campaign_review', { p_id: sel.id, p_approve: approve, p_note });
      toast.success(approve ? `Kampanye ${sel.name ?? ''} disetujui` : 'Kampanye ditolak — merchant menerima alasan');
      setSel(null); await load();
    } catch (e) { handleAdminError(e); } finally { setBusy(null); }
  };

  return (
    <>
      <Row between style={{ flexWrap: 'wrap', gap: 8 }}>
        <Text style={font.small}>{loading ? 'Memuat…' : `${rows.length} kampanye menunggu review`}</Text>
        <Button size="sm" variant="outline" title="Segarkan" icon="refresh-outline" onPress={load} />
      </Row>
      <ErrorNote text={err} onRetry={load} />
      {!loading && rows.length === 0 && !err ? <Panel><Text style={font.small}>Tidak ada kampanye yang menunggu review.</Text></Panel> : null}
      <View style={st.grid}>
        {rows.map((c) => (
          <View key={c.id} style={st.card}>
            <CreativePreview c={c} />
            <View style={{ gap: 3, marginTop: 8 }}>
              <Text style={font.bodyStrong} numberOfLines={1}>{c.name ?? '(tanpa nama)'}</Text>
              <Text style={font.tiny} numberOfLines={1}>{c.product_name ?? c.product_code}{c.pricing_model ? ` · ${c.pricing_model.toUpperCase()}` : ''}</Text>
              <Text style={font.tiny}>Budget {rupiah(c.budget)}{c.radius_km ? ` · radius ${c.radius_km} km` : ''}{c.category ? ` · ${c.category}` : ''}</Text>
              <Text style={font.tiny}>Diajukan {fmtDate(c.created_at)}</Text>
            </View>
            <RequirePerm perm="ads_review" fallback={<Text style={[font.tiny, { marginTop: 8 }]}>Butuh izin review iklan.</Text>}>
              <Button size="sm" title="Review" icon="eye-outline" style={{ marginTop: 8 }} onPress={() => open(c)} disabled={!can('ads_review')} />
            </RequirePerm>
          </View>
        ))}
      </View>

      <AdminDialog visible={!!sel} onClose={() => setSel(null)} width={720} title={`Review kampanye · ${sel?.name ?? ''}`}
        subtitle={sel ? `${sel.merchant_name ?? '—'} · ${sel.product_name ?? sel.product_code} · budget ${rupiah(sel.budget)}` : undefined}>
        {sel ? (
          <Row gap={16} style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <View style={{ width: 260 }}><CreativePreview c={sel} big /></View>
            <View style={{ flex: 1, minWidth: 280, gap: 8 }}>
              <Text style={font.label}>Checklist brand safety</Text>
              {BRAND_SAFETY.map((b) => {
                const on = !!checks[b.key];
                return (
                  <Pressable key={b.key} onPress={() => setChecks((x) => ({ ...x, [b.key]: !on }))} style={[st.check, on && { borderColor: TONE.ok.border, backgroundColor: TONE.ok.bg }]}>
                    <Ionicons name={on ? 'checkbox' : 'square-outline'} size={18} color={on ? TONE.ok.fg : adminTone.muted} />
                    <Text style={[font.small, { flex: 1, color: adminTone.ink }]}>{b.label}</Text>
                  </Pressable>
                );
              })}
              <Input label="Catatan untuk merchant (wajib bila menolak)" value={note} onChangeText={setNote} multiline style={{ minHeight: 64 }} />
              <Row gap={8} style={{ justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                <Button size="sm" variant="outline" color={colors.danger} title="Tolak" loading={busy === 'no'} onPress={() => decide(false)} />
                <Button size="sm" title="Setujui" icon="checkmark" color={colors.success} disabled={!allOk} loading={busy === 'ok'} onPress={() => decide(true)} />
              </Row>
            </View>
          </Row>
        ) : null}
      </AdminDialog>
    </>
  );
}

/* ───────────────────────── Semua kampanye ───────────────────────── */

function CampaignList() {
  const can = useAdminCan();
  const [status, setStatus] = useState('active');
  const [rows, setRows] = useState<AdCampaign[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [stop, setStop] = useState<AdCampaign | null>(null);

  const load = useCallback(async () => {
    try { setRows(asList<AdCampaign>(await rpc('admin_campaigns', { p_status: status === 'all' ? null : status }))); setErr(null); }
    catch (e) { setErr((e as Error).message); setRows([]); }
  }, [status]);
  useEffect(() => { load(); }, [load]);

  const act = async (c: AdCampaign, action: 'pause' | 'resume' | 'stop') => {
    if (!(await useAdminSecurity.getState().ensureUnlocked())) return false;
    setBusy(`${action}:${c.id}`);
    try { await rpc('admin_campaign_set', { p_id: c.id, p_action: action }); toast.success(`Kampanye ${c.name ?? ''}: ${action === 'pause' ? 'dijeda' : action === 'resume' ? 'dilanjutkan' : 'dihentikan — sisa budget kembali ke saldo merchant'}`); await load(); return true; }
    catch (e) { handleAdminError(e); return false; } finally { setBusy(null); }
  };

  const tot = useMemo(() => ({
    spent: rows.reduce((s, c) => s + Number(c.spent ?? 0), 0), impr: rows.reduce((s, c) => s + Number(c.impressions ?? 0), 0),
    clicks: rows.reduce((s, c) => s + Number(c.clicks ?? 0), 0), conv: rows.reduce((s, c) => s + Number(c.conversion_value ?? 0), 0),
  }), [rows]);

  return (
    <>
      <Toolbar right={<Button size="sm" variant="outline" title="Segarkan" icon="refresh-outline" onPress={load} />}>
        <FilterBar options={STATUS_FILTERS} value={status} onChange={setStatus} />
      </Toolbar>
      <ErrorNote text={err} onRetry={load} />
      <Row gap={adminSpace.md} style={{ flexWrap: 'wrap' }}>
        <StatCard index={0} icon="megaphone-outline" label="Kampanye" value={rows.length} color={adminTone.blue} />
        <StatCard index={1} icon="cash-outline" label="Terpakai (spent)" value={rupiah(tot.spent)} color={adminTone.teal} hint="= pendapatan iklan diakui" />
        <StatCard index={2} icon="eye-outline" label="Impresi · klik" value={`${idNum(tot.impr)} · ${idNum(tot.clicks)}`} color={adminTone.violet} hint={tot.impr ? `CTR ${((tot.clicks / tot.impr) * 100).toFixed(2)}%` : undefined} />
        <StatCard index={3} icon="trending-up-outline" label="ROAS" value={tot.spent ? `${(tot.conv / tot.spent).toFixed(2)}×` : '—'} color={adminTone.green} hint="nilai konversi ÷ spent" />
      </Row>
      <Panel title={`Kampanye (${rows.length})`} icon="megaphone-outline" padded={false}>
        <DataTable rows={rows as unknown as Record<string, unknown>[]} emptyText="Tidak ada kampanye pada filter ini" emptyIcon="megaphone-outline" columns={[
          { key: 'name', label: 'Kampanye', width: 220, render: (r) => { const c = r as unknown as AdCampaign; return <View style={{ minWidth: 0, alignSelf: 'stretch' }}><Trunc style={font.bodyStrong} title={c.name ?? ''}>{c.name ?? c.creative?.headline ?? '—'}</Trunc><Trunc style={font.tiny} title={c.merchant_name ?? ''}>{c.merchant_name ?? '—'}</Trunc></View>; } },
          { key: 'product_code', label: 'Produk', width: 150, render: (r) => { const c = r as unknown as AdCampaign; return <View><Text style={font.small} numberOfLines={1}>{c.product_name ?? c.product_code}</Text><Text style={font.tiny}>{c.pricing_model?.toUpperCase() ?? ''}{c.radius_km ? ` · ${c.radius_km} km` : ''}</Text></View>; } },
          { key: 'status', label: 'Status', width: 150, render: (r) => { const c = r as unknown as AdCampaign; return <View style={{ gap: 3 }}><Pill text={CAMPAIGN_STATUS_LABEL[c.status] ?? c.status} tone={campaignTone(c.status) as ToneKey} />{c.paused_by ? <Text style={font.tiny}>dijeda oleh {c.paused_by}</Text> : null}</View>; } },
          { key: 'budget', label: 'Budget · terpakai', width: 170, render: (r) => { const c = r as unknown as AdCampaign; const pct = c.budget ? Math.min(100, (Number(c.spent) / Number(c.budget)) * 100) : 0; return (
            <View style={{ gap: 3, alignSelf: 'stretch' }}>
              <Text style={font.mono}>{rupiah(c.spent)} / {rupiah(c.budget)}</Text>
              <View style={st.track}><View style={[st.fill, { width: `${Math.max(2, pct)}%`, backgroundColor: pct >= 90 ? adminTone.red : adminTone.teal }]} /></View>
            </View>
          ); } },
          countCol('impressions', 'Impresi', 90),
          { key: 'clicks', label: 'Klik · CTR', width: 110, align: 'right', mono: true, render: (r) => <View style={{ alignItems: 'flex-end' }}><Text style={font.mono}>{idNum(Number(r.clicks))}</Text><Text style={font.tiny}>{Number(r.impressions) ? `${((Number(r.clicks) / Number(r.impressions)) * 100).toFixed(2)}%` : '—'}</Text></View> },
          { key: 'conversions', label: 'Konversi · ROAS', width: 130, align: 'right', mono: true, render: (r) => <View style={{ alignItems: 'flex-end' }}><Text style={font.mono}>{idNum(Number(r.conversions))}</Text><Text style={font.tiny}>{Number(r.spent) ? `${(Number(r.conversion_value) / Number(r.spent)).toFixed(2)}×` : '—'}</Text></View> },
          { key: 'actions', label: 'Aksi', width: 220, align: 'right', render: (r) => {
            const c = r as unknown as AdCampaign;
            if (!can('ads_review')) return <Text style={font.tiny}>—</Text>;
            return (
              <Row gap={6} style={{ justifyContent: 'flex-end' }}>
                {c.status === 'active' ? <Button size="sm" variant="outline" title="Jeda" icon="pause" loading={busy === `pause:${c.id}`} onPress={() => { act(c, 'pause'); }} /> : null}
                {c.status === 'paused' ? <Button size="sm" variant="outline" title="Lanjutkan" icon="play" loading={busy === `resume:${c.id}`} onPress={() => { act(c, 'resume'); }} /> : null}
                {['active', 'paused', 'approved', 'budget_exhausted'].includes(c.status) ? <Button size="sm" variant="outline" color={colors.danger} title="Hentikan" onPress={() => setStop(c)} /> : null}
              </Row>
            );
          } },
        ]} />
        <View style={{ padding: adminSpace.md }}><WideTableHint /></View>
      </Panel>
      <AdminDialog visible={!!stop} onClose={() => setStop(null)} title="Hentikan kampanye?" tone={adminTone.red} subtitle={stop ? `${stop.name ?? ''} · ${stop.merchant_name ?? ''} · sisa ${rupiah(Math.max(0, Number(stop.budget) - Number(stop.spent)))}` : undefined}>
        <Text style={font.body}>Kampanye berhenti tayang permanen. Sisa budget dikembalikan ke saldo merchant dan pendapatan iklan dikoreksi di buku besar (ads_revenue negatif untuk porsi refund).</Text>
        <Row gap={8} style={{ justifyContent: 'flex-end' }}>
          <Button size="sm" variant="ghost" title="Batal" onPress={() => setStop(null)} />
          <Button size="sm" color={colors.danger} title="Hentikan" loading={!!stop && busy === `stop:${stop.id}`} onPress={async () => { if (stop && (await act(stop, 'stop'))) setStop(null); }} />
        </Row>
      </AdminDialog>
    </>
  );
}

/* ───────────────────────── Katalog produk ───────────────────────── */

type PD = { name: string; description: string; pricing_model: string; unit_price: string; min_budget: string; min_days: string; max_days: string; requires_approval: boolean; label: string; active: boolean };
const toPD = (p: AdProductV3): PD => ({
  name: p.name ?? '', description: p.description ?? '', pricing_model: p.pricing_model ?? 'flat', unit_price: String(p.unit_price ?? p.price ?? 0),
  min_budget: String(p.min_budget ?? 50000), min_days: String(p.min_days ?? 1), max_days: String(p.max_days ?? 30),
  requires_approval: p.requires_approval !== false, label: p.label ?? 'Sponsored', active: !!p.active,
});
const INT_FIELDS: { key: 'unit_price' | 'min_budget' | 'min_days' | 'max_days'; label: string; width: number; min: number; max: number }[] = [
  { key: 'unit_price', label: 'Harga unit (Rp)', width: 104, min: 0, max: 100000000 },
  { key: 'min_budget', label: 'Min. budget (Rp)', width: 110, min: 0, max: 100000000 },
  { key: 'min_days', label: 'Min hari', width: 70, min: 1, max: 366 },
  { key: 'max_days', label: 'Maks hari', width: 70, min: 1, max: 366 },
];
function diffPatch(p: AdProductV3 | null, d: PD): { patch: Record<string, unknown>; error?: string } {
  const patch: Record<string, unknown> = {};
  if (!d.name.trim()) return { patch, error: 'Nama produk wajib diisi' };
  for (const f of INT_FIELDS) {
    const n = parseNum(d[f.key]);
    if (!Number.isInteger(n) || n < f.min || n > f.max) return { patch, error: `${f.label} harus bilangan bulat ${f.min.toLocaleString('id-ID')}–${f.max.toLocaleString('id-ID')}` };
    const cur = p ? Number((p as unknown as Record<string, unknown>)[f.key] ?? (f.key === 'unit_price' ? p.price : NaN)) : NaN;
    if (!p || n !== cur) patch[f.key] = n;
  }
  if (parseNum(d.min_days) > parseNum(d.max_days)) return { patch, error: 'Min hari tidak boleh lebih dari maks hari' };
  if (!p || d.name.trim() !== p.name) patch.name = d.name.trim();
  if (!p || (d.description ?? '') !== (p.description ?? '')) patch.description = d.description || null;
  if (!p || d.pricing_model !== (p.pricing_model ?? 'flat')) patch.pricing_model = d.pricing_model;
  if (!p || d.requires_approval !== (p.requires_approval !== false)) patch.requires_approval = d.requires_approval;
  if (!p || (d.label || 'Sponsored') !== (p.label ?? 'Sponsored')) patch.label = d.label || 'Sponsored';
  if (!p || d.active !== !!p.active) patch.active = d.active;
  return { patch };
}

function Catalog() {
  const can = useAdminCan();
  const [rows, setRows] = useState<AdProductV3[]>([]);
  const [drafts, setDrafts] = useState<Record<string, PD>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [nw, setNw] = useState<PD & { code: string }>({ code: '', ...toPD({ code: '', name: '', description: null, placement: null, active: true, pricing_model: 'cpc', unit_price: 500, min_budget: 50000, min_days: 1, max_days: 30, requires_approval: true, label: 'Sponsored' }) });

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('ad_products').select('*').order('code');
    if (error) { setErr(error.message); return; }
    const list = (data as AdProductV3[]) ?? [];
    setErr(null); setRows(list); setDrafts(Object.fromEntries(list.map((p) => [p.code, toPD(p)])));
  }, []);
  useEffect(() => { load(); }, [load]);

  const send = async (code: string, patch: Record<string, unknown>, ok: string) => {
    if (!(await useAdminSecurity.getState().ensureUnlocked())) return false;
    setBusy(code);
    try { await rpc('admin_set_ad_product', { p_code: code, p_patch: patch }); toast.success(ok); await load(); return true; }
    catch (e) { handleAdminError(e); return false; } finally { setBusy(null); }
  };
  const save = async (p: AdProductV3) => {
    const d = drafts[p.code]; if (!d) return;
    const { patch, error } = diffPatch(p, d);
    if (error) return toast.error(`${p.code}: ${error}`);
    if (!Object.keys(patch).length) return toast.show('Tidak ada perubahan');
    await send(p.code, patch, `Produk ${d.name} disimpan`);
  };
  const create = async () => {
    const code = nw.code.trim().toLowerCase();
    if (!/^[a-z0-9_]{2,40}$/.test(code)) return toast.error('Kode produk: huruf kecil/angka/_ 2–40 karakter');
    if (rows.some((p) => p.code === code)) return toast.error('Kode sudah dipakai — ubah barisnya di tabel');
    const { patch, error } = diffPatch(null, nw);
    if (error) return toast.error(error);
    patch.placement = code;
    if (await send(code, patch, `Produk ${nw.name} dibuat`)) setNw({ ...nw, code: '', name: '', description: '' });
  };
  const setD = (code: string, k: keyof PD, v: string | boolean) => setDrafts((d) => ({ ...d, [code]: { ...d[code], [k]: v } as PD }));
  const editable = can('ads_product');

  return (
    <>
      <ErrorNote text={err} onRetry={load} />
      <Panel title="Katalog produk iklan" subtitle="Model harga & batas budget per produk. Semua harga awal [ASUMSI] — ubah sesuai hasil pilot. Menyimpan butuh PIN." icon="pricetag-outline" padded={false}
        right={<Button size="sm" variant="outline" title="Segarkan" icon="refresh-outline" onPress={load} />}>
        <ScrollView horizontal showsHorizontalScrollIndicator>
          <View style={{ minWidth: 1400 }}>
            <Row gap={8} style={st.th}>
              <Text style={[font.label, { width: 150 }]}>Kode</Text>
              <Text style={[font.label, { width: 170 }]}>Nama</Text>
              <Text style={[font.label, { width: 180 }]}>Model harga</Text>
              {INT_FIELDS.map((f) => <Text key={f.key} style={[font.label, { width: f.width, textAlign: 'right' }]} numberOfLines={2}>{f.label}</Text>)}
              <Text style={[font.label, { width: 80 }]} numberOfLines={2}>Wajib review</Text>
              <Text style={[font.label, { width: 110 }]}>Label</Text>
              <Text style={[font.label, { width: 54 }]}>Aktif</Text>
              <Text style={[font.label, { width: 220 }]}>Deskripsi</Text>
              <Text style={[font.label, { width: 84 }]} />
            </Row>
            {rows.length === 0 && !err ? <Text style={[font.small, { padding: adminSpace.lg }]}>Belum ada produk iklan.</Text> : null}
            {rows.map((p, i) => {
              const d = drafts[p.code]; if (!d) return null;
              const dirty = Object.keys(diffPatch(p, d).patch).length > 0;
              return (
                <Row key={p.code} gap={8} style={[st.tr, i % 2 ? st.trAlt : null, !d.active && { opacity: 0.6 }]}>
                  <View style={{ width: 150, gap: 3 }}>
                    <Text style={font.bodyStrong} numberOfLines={1}>{p.code}</Text>
                    <Row gap={4} style={{ flexWrap: 'wrap' }}>{labelTags(d.description).map((t) => <LabelPill key={t} text={t} />)}</Row>
                  </View>
                  <Input value={d.name} editable={editable} onChangeText={(t) => setD(p.code, 'name', t)} containerStyle={{ width: 170 }} style={{ paddingVertical: 6 }} />
                  <View style={{ width: 180, gap: 2 }}>
                    <AdminSelect size="sm" width={180} value={d.pricing_model} options={MODEL_OPTS} disabled={!editable} onChange={(v) => setD(p.code, 'pricing_model', v)} />
                    <Text style={font.tiny}>{unitHint(d.pricing_model)}</Text>
                  </View>
                  {INT_FIELDS.map((f) => <Input key={f.key} value={d[f.key]} editable={editable} keyboardType="number-pad" onChangeText={(t) => setD(p.code, f.key, t)} containerStyle={{ width: f.width }} style={{ textAlign: 'right', paddingVertical: 6 }} />)}
                  <View style={{ width: 80 }}><Switch value={d.requires_approval} disabled={!editable} onValueChange={(v) => setD(p.code, 'requires_approval', v)} trackColor={{ true: colors.success, false: colors.border }} thumbColor="#fff" /></View>
                  <Input value={d.label} editable={editable} onChangeText={(t) => setD(p.code, 'label', t)} containerStyle={{ width: 110 }} style={{ paddingVertical: 6 }} />
                  <View style={{ width: 54 }}><Switch value={d.active} disabled={!editable} onValueChange={(v) => setD(p.code, 'active', v)} trackColor={{ true: colors.success, false: colors.border }} thumbColor="#fff" /></View>
                  <Input value={d.description} editable={editable} multiline onChangeText={(t) => setD(p.code, 'description', t)} containerStyle={{ width: 220 }} style={{ paddingVertical: 6, fontSize: 12, minHeight: 44 }} />
                  <Button title="Simpan" size="sm" variant={dirty ? 'primary' : 'outline'} disabled={!editable} loading={busy === p.code} onPress={() => save(p)} style={{ width: 84 }} />
                </Row>
              );
            })}
          </View>
        </ScrollView>
        <RequirePerm perm="ads_product">
          <View style={{ padding: adminSpace.lg, gap: 8, borderTopWidth: 1, borderTopColor: adminTone.border }}>
            <Text style={font.h3}>Produk baru</Text>
            <Row gap={10} style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <Input label="Kode" placeholder="mis. search_top" value={nw.code} autoCapitalize="none" onChangeText={(v) => setNw({ ...nw, code: v.toLowerCase() })} containerStyle={{ width: 150 }} />
              <Input label="Nama" value={nw.name} onChangeText={(v) => setNw({ ...nw, name: v })} containerStyle={{ width: 190 }} />
              <AdminSelect label="Model harga" width={190} value={nw.pricing_model} options={MODEL_OPTS} onChange={(v) => setNw({ ...nw, pricing_model: v })} />
              {INT_FIELDS.map((f) => <Input key={f.key} label={f.label} value={nw[f.key]} keyboardType="number-pad" onChangeText={(v) => setNw({ ...nw, [f.key]: v })} containerStyle={{ width: f.width + 20 }} />)}
              <Input label="Deskripsi" placeholder="[ASUMSI] …" value={nw.description} onChangeText={(v) => setNw({ ...nw, description: v })} containerStyle={{ minWidth: 220, flex: 1 }} />
              <Button title="Buat produk" icon="add" loading={busy === nw.code.trim().toLowerCase() && !!nw.code} onPress={create} />
            </Row>
          </View>
        </RequirePerm>
      </Panel>
      <WideTableHint what="kolom Deskripsi & Simpan" />
      <FootNote lines={[
        'Model harga: flat = per hari/periode; CPC = per klik (klik berulang dalam ads_click_dedupe_minutes tidak ditagih); CPM = per 1.000 impresi (frequency cap ads_frequency_cap_per_day); CPA = per konversi (pesanan yang membawa ad_campaign_id).',
        'Dana kampanye ditahan dari saldo merchant (closed loop, bukan uang masuk dari luar). Setiap charge masuk ad_budget_ledger dan buku besar (ads_revenue).',
        '“Wajib review” menyala = kampanye baru berstatus Menunggu review sampai disetujui admin.',
      ]} />
    </>
  );
}

/* ───────────────────────── Laporan ───────────────────────── */

function AdsReport() {
  const [preset, setPreset] = useState<RangePreset>('month');
  const [range, setRange] = useState<DateRange>(() => presetRange('month'));
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const invalid = rangeError(range);

  const load = useCallback(async () => {
    if (rangeError(range)) { setLoading(false); return; }
    setLoading(true);
    try {
      const r = await rpc<unknown>('admin_ads_report', { p_from: range.from, p_to: range.to });
      setData((Array.isArray(r) ? r[0] : r) as Record<string, unknown>); setErr(null);
    } catch (e) { setErr((e as Error).message); setData(null); }
    finally { setLoading(false); }
  }, [range]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  const sum = (data?.summary ?? data?.totals ?? data) as Record<string, unknown> | null;
  const revenue = num(sum, 'revenue', 'ads_revenue', 'revenue_total', 'total_revenue', 'spent');
  const impr = num(sum, 'impressions'); const clicks = num(sum, 'clicks'); const conv = num(sum, 'conversions'); const convVal = num(sum, 'conversion_value');
  const fraud = num(sum, 'fraud_dedupe_count', 'deduped_clicks', 'dedupe_count', 'non_billable_clicks');
  const byProduct = asList<Record<string, unknown>>(data?.by_product);
  const byMerchant = asList<Record<string, unknown>>(data?.by_merchant);

  return (
    <>
      <Toolbar right={<Button size="sm" variant="outline" title="Segarkan" icon="refresh-outline" onPress={load} />}>
        <FilterBar options={RANGE_PRESETS as unknown as { key: string; label: string }[]} value={preset} onChange={(v) => { setPreset(v as RangePreset); if (v !== 'custom') setRange(presetRange(v as RangePreset)); }} />
        {preset === 'custom' ? (
          <Row gap={8} style={{ flexWrap: 'wrap' }}>
            <DateField label="Dari" value={range.from} onChange={(v) => setRange((r) => ({ ...r, from: v }))} />
            <DateField label="Sampai" value={range.to} onChange={(v) => setRange((r) => ({ ...r, to: v }))} />
          </Row>
        ) : <Text style={font.small}>{rangeLabel(range)}</Text>}
      </Toolbar>
      <ErrorNote text={invalid} />
      {!invalid ? <ErrorNote text={err} onRetry={load} /> : null}
      {loading && !data ? <Text style={font.small}>Memuat laporan…</Text> : null}
      <Row gap={adminSpace.md} style={{ flexWrap: 'wrap' }}>
        <StatCard index={0} icon="cash-outline" label="Pendapatan iklan" value={rupiah(revenue)} color={adminTone.teal} hint="charge billable (spent)" />
        <StatCard index={1} icon="eye-outline" label="Impresi" value={impr} color={adminTone.blue} />
        <StatCard index={2} icon="hand-left-outline" label="Klik" value={clicks} color={adminTone.violet} hint={impr ? `CTR ${((clicks / impr) * 100).toFixed(2)}%` : undefined} />
        <StatCard index={3} icon="bag-check-outline" label="Konversi" value={conv} color={adminTone.green} hint={revenue ? `ROAS ${(convVal / revenue).toFixed(2)}×` : undefined} />
        <StatCard index={4} icon="shield-outline" label="Klik/impresi ter-dedupe" value={fraud} color={fraud ? adminTone.amber : adminTone.slate} hint="tidak ditagih (anti-fraud)" />
      </Row>
      <Panel title="Per produk" icon="pricetag-outline" padded={false}>
        <DataTable keyField="_k" rows={byProduct.map((r, i) => ({ _k: String(r.code ?? r.product_code ?? i), ...r }))} emptyText="Belum ada data" columns={[
          { key: 'code', label: 'Produk', width: 200, render: (r) => <View><Text style={font.bodyStrong}>{String(r.name ?? r.product_name ?? r.code ?? r.product_code ?? '—')}</Text><Text style={font.tiny}>{String(r.pricing_model ?? '')}</Text></View> },
          moneyCol(byProduct[0] && 'revenue' in byProduct[0] ? 'revenue' : 'spent', 'Pendapatan', 130, adminTone.teal),
          countCol('campaigns', 'Kampanye', 90), countCol('impressions', 'Impresi', 100), countCol('clicks', 'Klik', 90), countCol('conversions', 'Konversi', 90),
        ]} />
      </Panel>
      <Panel title="Per merchant" icon="storefront-outline" padded={false}>
        <DataTable keyField="_k" rows={byMerchant.map((r, i) => ({ _k: String(r.merchant_id ?? i), ...r }))} emptyText="Belum ada data" maxHeight={480} columns={[
          { key: 'merchant_name', label: 'Merchant', width: 220, render: (r) => <Trunc style={font.bodyStrong} title={String(r.merchant_name ?? r.merchant ?? '')}>{String(r.merchant_name ?? r.merchant ?? r.merchant_id ?? '—')}</Trunc> },
          moneyCol(byMerchant[0] && 'revenue' in byMerchant[0] ? 'revenue' : 'spent', 'Spent', 130, adminTone.teal),
          countCol('impressions', 'Impresi', 100), countCol('clicks', 'Klik', 90), countCol('conversions', 'Konversi', 90),
          moneyCol('conversion_value', 'Nilai konversi', 130),
        ]} />
      </Panel>
      <FootNote lines={[
        'Pendapatan iklan = Σ charge billable di ad_budget_ledger (juga diposting ke buku besar sebagai ads_revenue). Refund saat kampanye dihentikan mengurangi pendapatan.',
        'Klik/impresi ter-dedupe: kejadian yang tercatat tetapi tidak ditagih (klik berulang dalam jendela dedupe atau melewati frequency cap).',
      ]} />
    </>
  );
}

const st = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: adminSpace.md },
  card: { width: 260, padding: adminSpace.md, borderRadius: adminRadius.card, borderWidth: 1, borderColor: adminTone.border, backgroundColor: adminTone.surface },
  creative: { borderRadius: adminRadius.md, borderWidth: 1, borderColor: adminTone.border, backgroundColor: adminTone.surfaceAlt, padding: adminSpace.sm, overflow: 'hidden' },
  img: { width: '100%', height: 120, borderRadius: adminRadius.sm, backgroundColor: adminTone.border },
  noImg: { alignItems: 'center', justifyContent: 'center', gap: 4 },
  sponsored: { position: 'absolute', top: 12, left: 12, zIndex: 2, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: 'rgba(15,29,32,0.72)' },
  sponsoredText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  cta: { alignSelf: 'flex-start', marginTop: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: colors.primary },
  ctaText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  check: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: adminSpace.sm, borderRadius: adminRadius.md, borderWidth: 1, borderColor: adminTone.border },
  track: { height: 6, borderRadius: 3, backgroundColor: adminTone.surfaceAlt, borderWidth: 1, borderColor: adminTone.border, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 3 },
  th: { paddingHorizontal: adminSpace.lg, paddingVertical: adminSpace.sm, backgroundColor: adminTone.surfaceAlt },
  tr: { paddingHorizontal: adminSpace.lg, paddingVertical: 8, borderTopWidth: 1, borderTopColor: adminTone.border, alignItems: 'center', minHeight: 64 },
  trAlt: { backgroundColor: adminTone.zebra },
});
