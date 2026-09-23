// Admin · Iklan & Boost (Skema Bisnis v2, migrasi 0101).
// • Produk iklan: tabel `ad_products` (RLS: admin melihat semua, termasuk nonaktif) — ubah/buat lewat
//   rpc('admin_set_ad_product') (PIN + log ads.product_*).
// • Iklan merchant: rpc('admin_merchant_ads', { p_status }) — sekaligus menandai iklan kedaluwarsa.
//   Buat/aktifkan/batalkan atas nama merchant lewat rpc('admin_set_merchant_ad') (PIN + log ads.*);
//   pendapatan iklan diposting server ke order_ledger (entry ads_revenue).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Switch, Pressable } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AdminPage, Panel, DataTable, FilterBar, Pill, AdminSelect, AdminDialog, StatCard, adminFont as font, adminTone, adminSpace, adminRadius, adminIcon, type ToneKey } from '@/components/admin';
import { DateField, FootNote, todayJkt } from '@/components/reports';
import { Row, Input, Button, toast } from '@/components/ui';
import { rpc, supabase } from '@/lib/supabase';
import { colors } from '@/lib/theme';
import { rupiah } from '@/lib/format';
import { handleAdminError, useAdminSecurity } from '@/store/adminSecurity';
import type { AdPlacement, AdProduct, AdUnit, AdminMerchantAd, MerchantAdStatus } from '@/lib/types';
import { ErrorNote, LabelPill, fmtDate, labelTags, parseNum, Trunc, WideTableHint } from './_shared';

const UNIT_LABEL: Record<AdUnit, string> = { per_day: 'per hari', per_week: 'per minggu', per_order: 'per pesanan' };
const PLACEMENT_LABEL: Record<AdPlacement, string> = { featured_home: 'Unggulan beranda', boost_nearby: 'Boost merchant terdekat', banner_category: 'Banner kategori' };
const STATUS_LABEL: Record<MerchantAdStatus, string> = { draft: 'Draf', pending_payment: 'Menunggu bayar', active: 'Aktif', expired: 'Kedaluwarsa', cancelled: 'Dibatalkan' };
const STATUS_TONE: Record<MerchantAdStatus, ToneKey> = { draft: 'off', pending_payment: 'wait', active: 'ok', expired: 'off', cancelled: 'bad' };
const PAID_VIA_LABEL: Record<string, string> = { wallet: 'Saldo merchant', admin: 'Ditagih admin', gratis: 'Gratis' };
const FILTERS = [{ key: 'all', label: 'Semua' }, { key: 'active', label: 'Aktif' }, { key: 'pending_payment', label: 'Menunggu bayar' }, { key: 'draft', label: 'Draf' }, { key: 'expired', label: 'Kedaluwarsa' }, { key: 'cancelled', label: 'Dibatalkan' }];
const UNIT_OPTS = (Object.keys(UNIT_LABEL) as AdUnit[]).map((k) => ({ value: k, label: UNIT_LABEL[k] }));
const PLACEMENT_OPTS = (Object.keys(PLACEMENT_LABEL) as AdPlacement[]).map((k) => ({ value: k, label: PLACEMENT_LABEL[k], sublabel: k }));

type ProductDraft = { name: string; description: string; unit: AdUnit; price: string; placement: AdPlacement; active: boolean };
const toDraft = (p: AdProduct): ProductDraft => ({ name: p.name, description: p.description ?? '', unit: p.unit, price: String(p.price), placement: p.placement, active: p.active });
const emptyNew = { code: '', name: '', description: '', unit: 'per_day' as AdUnit, price: '', placement: 'boost_nearby' as AdPlacement };

type MerchantHit = { id: string; name: string; status: string; address: string | null };

/** Harga katalog × durasi — sama dengan admin_set_merchant_ad (per_week dibulatkan ke atas per 7 hari, per_order = 1 unit). */
const catalogPrice = (p: AdProduct | undefined, days: number) => {
  if (!p || !(days > 0)) return 0;
  return p.price * (p.unit === 'per_week' ? Math.ceil(days / 7) : p.unit === 'per_day' ? days : 1);
};
/** "YYYY-MM-DD" (WIB) → ISO dengan zona +07:00 pukul 00.00. */
const wibStart = (ymd: string) => `${ymd}T00:00:00+07:00`;
const addDaysIso = (ymd: string, days: number) => new Date(new Date(wibStart(ymd)).getTime() + days * 86400000).toISOString();

export default function AdminAds() {
  const [products, setProducts] = useState<AdProduct[]>([]);
  const [pDrafts, setPDrafts] = useState<Record<string, ProductDraft>>({});
  const [nw, setNw] = useState({ ...emptyNew });
  const [ads, setAds] = useState<AdminMerchantAd[]>([]);
  const [filter, setFilter] = useState('all');
  const [errP, setErrP] = useState<string | null>(null);
  const [errA, setErrA] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [cancelAd, setCancelAd] = useState<AdminMerchantAd | null>(null);

  const loadProducts = useCallback(async () => {
    const { data, error } = await supabase.from('ad_products').select('*').order('price');
    if (error) { setErrP(error.message); return; }
    const list = (data as AdProduct[]) ?? [];
    setErrP(null); setProducts(list); setPDrafts(Object.fromEntries(list.map((p) => [p.code, toDraft(p)])));
  }, []);
  const loadAds = useCallback(async () => {
    try { setAds((await rpc<AdminMerchantAd[]>('admin_merchant_ads', { p_status: filter === 'all' ? null : filter })) ?? []); setErrA(null); }
    catch (e) { setErrA((e as Error).message); setAds([]); }
  }, [filter]);
  const loadAll = useCallback(async () => { await Promise.all([loadProducts(), loadAds()]); }, [loadProducts, loadAds]);
  useEffect(() => { loadProducts(); }, [loadProducts]);
  useEffect(() => { loadAds(); }, [loadAds]);

  const setPD = (code: string, k: keyof ProductDraft, v: string | boolean) => setPDrafts((d) => ({ ...d, [code]: { ...d[code], [k]: v } as ProductDraft }));

  const saveProduct = async (p: AdProduct) => {
    const d = pDrafts[p.code];
    if (!d) return;
    const price = parseNum(d.price);
    if (!Number.isInteger(price) || price < 0 || price > 100000000) return toast.error('Harga iklan harus bilangan bulat Rp0–Rp100.000.000');
    if (!d.name.trim()) return toast.error('Nama produk wajib diisi');
    const patch: Record<string, unknown> = {};
    if (d.name.trim() !== p.name) patch.name = d.name.trim();
    if ((d.description ?? '') !== (p.description ?? '')) patch.description = d.description;
    if (d.unit !== p.unit) patch.unit = d.unit;
    if (price !== Number(p.price)) patch.price = price;
    if (d.placement !== p.placement) patch.placement = d.placement;
    if (d.active !== p.active) patch.active = d.active;
    if (Object.keys(patch).length === 0) return toast.show('Tidak ada perubahan untuk disimpan');
    if (!(await useAdminSecurity.getState().ensureUnlocked())) return;
    setBusy(`p:${p.code}`);
    try {
      const a = await rpc<AdProduct>('admin_set_ad_product', { p_code: p.code, p_patch: patch });
      setProducts((ps) => ps.map((x) => (x.code === a.code ? a : x)));
      setPDrafts((ds) => ({ ...ds, [a.code]: toDraft(a) }));
      toast.success(`Produk ${a.name} disimpan`);
    } catch (e) { handleAdminError(e); } finally { setBusy(null); }
  };

  const createProduct = async () => {
    const code = nw.code.trim().toLowerCase();
    const price = parseNum(nw.price);
    if (!/^[a-z0-9_]{2,40}$/.test(code)) return toast.error('Kode produk: huruf kecil/angka/_ 2–40 karakter');
    if (products.some((p) => p.code === code)) return toast.error('Kode produk sudah dipakai — ubah barisnya di tabel');
    if (!nw.name.trim()) return toast.error('Nama produk wajib diisi');
    if (!Number.isInteger(price) || price < 0 || price > 100000000) return toast.error('Harga iklan harus bilangan bulat Rp0–Rp100.000.000');
    if (!(await useAdminSecurity.getState().ensureUnlocked())) return;
    setBusy('new-product');
    try {
      const a = await rpc<AdProduct>('admin_set_ad_product', { p_code: code, p_patch: { name: nw.name.trim(), description: nw.description.trim() || null, unit: nw.unit, price, placement: nw.placement } });
      toast.success(`Produk ${a.name} dibuat`); setNw({ ...emptyNew }); await loadProducts();
    } catch (e) { handleAdminError(e); } finally { setBusy(null); }
  };

  /** Ubah status iklan yang sudah ada (aktifkan / batalkan). */
  const setAdStatus = async (ad: AdminMerchantAd, status: MerchantAdStatus, refund = false) => {
    if (!(await useAdminSecurity.getState().ensureUnlocked())) return false;
    setBusy(`a:${ad.id}`);
    try {
      await rpc('admin_set_merchant_ad', { p_merchant_id: ad.merchant_id, p_product: ad.product_code, p_start: null, p_end: null, p_status: status, p_id: ad.id, p_price: null, p_refund: refund });
      toast.success(`Iklan ${ad.merchant_name}: ${STATUS_LABEL[status]}`); await loadAds(); return true;
    } catch (e) { handleAdminError(e); return false; } finally { setBusy(null); }
  };

  const liveCount = ads.filter((a) => a.is_live).length;
  const revenue = ads.reduce((s, a) => s + (a.status === 'active' || a.status === 'expired' ? Number(a.price_paid) - Number(a.refunded) : 0), 0);

  return (
    <AdminPage title="Iklan & Boost" subtitle="Produk iklan berbayar merchant dan daftar iklan aktif/pending. Merchant yang di-boost tampil dengan label “Iklan” di aplikasi pelanggan." onRefresh={loadAll}
      right={<Button size="sm" variant="outline" title="Segarkan" icon="refresh-outline" onPress={loadAll} />}>

      <Panel title="Produk iklan" subtitle="Harga awal [ASUMSI] — ubah sesuai hasil pilot. Menyimpan butuh PIN panel." icon="pricetag-outline" padded={false}>
        <View style={{ paddingHorizontal: adminSpace.lg, paddingTop: adminSpace.md }}><ErrorNote text={errP} onRetry={loadProducts} /></View>
        <ScrollView horizontal showsHorizontalScrollIndicator>
          <View style={{ minWidth: 1180 }}>
            <Row gap={8} style={st.th}>
              <Text style={[font.label, { width: 150 }]}>Kode</Text>
              <Text style={[font.label, { width: 180 }]}>Nama</Text>
              <Text style={[font.label, { width: 280 }]}>Deskripsi</Text>
              <Text style={[font.label, { width: 130 }]}>Unit</Text>
              <Text style={[font.label, { width: 110, textAlign: 'right' }]}>Harga (Rp)</Text>
              <Text style={[font.label, { width: 190 }]}>Penempatan</Text>
              <Text style={[font.label, { width: 60 }]}>Aktif</Text>
              <Text style={[font.label, { width: 84 }]} />
            </Row>
            {products.length === 0 && !errP ? <Text style={[font.small, { padding: adminSpace.lg }]}>Belum ada produk iklan (migrasi 0101 menambahkan 3 produk awal).</Text> : null}
            {products.map((p, i) => {
              const d = pDrafts[p.code];
              if (!d) return null;
              return (
                <Row key={p.code} gap={8} style={[st.tr, i % 2 ? st.trAlt : null]}>
                  <View style={{ width: 150, gap: 3 }}>
                    <Text style={font.bodyStrong} numberOfLines={1}>{p.code}</Text>
                    <Row gap={4} style={{ flexWrap: 'wrap' }}>{labelTags(d.description).map((t) => <LabelPill key={t} text={t} />)}</Row>
                  </View>
                  <Input value={d.name} onChangeText={(t) => setPD(p.code, 'name', t)} containerStyle={{ width: 180 }} style={{ paddingVertical: 6 }} />
                  <Input value={d.description} multiline onChangeText={(t) => setPD(p.code, 'description', t)} containerStyle={{ width: 280 }} style={{ paddingVertical: 6, fontSize: 12, minHeight: 48 }} />
                  <AdminSelect size="sm" width={130} value={d.unit} options={UNIT_OPTS} onChange={(v) => setPD(p.code, 'unit', v)} />
                  <Input value={d.price} keyboardType="number-pad" onChangeText={(t) => setPD(p.code, 'price', t)} containerStyle={{ width: 110 }} style={{ textAlign: 'right', paddingVertical: 6 }} />
                  <AdminSelect size="sm" width={190} value={d.placement} options={PLACEMENT_OPTS} onChange={(v) => setPD(p.code, 'placement', v)} />
                  <View style={{ width: 60 }}><Switch value={d.active} onValueChange={(v) => setPD(p.code, 'active', v)} trackColor={{ true: colors.success, false: colors.border }} thumbColor="#fff" /></View>
                  <Button title="Simpan" size="sm" loading={busy === `p:${p.code}`} onPress={() => saveProduct(p)} style={{ width: 84 }} />
                </Row>
              );
            })}
          </View>
        </ScrollView>
        <View style={{ padding: adminSpace.lg, gap: 8, borderTopWidth: 1, borderTopColor: adminTone.border }}>
          <Text style={font.h3}>Produk baru</Text>
          <Row gap={10} style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Input label="Kode" placeholder="mis. top_search" value={nw.code} autoCapitalize="none" onChangeText={(v) => setNw({ ...nw, code: v.toLowerCase() })} containerStyle={{ width: 160 }} />
            <Input label="Nama" value={nw.name} onChangeText={(v) => setNw({ ...nw, name: v })} containerStyle={{ width: 200 }} />
            <Input label="Deskripsi" placeholder="[ASUMSI] …" value={nw.description} onChangeText={(v) => setNw({ ...nw, description: v })} containerStyle={{ minWidth: 240, flex: 1 }} />
            <AdminSelect label="Unit" width={130} value={nw.unit} options={UNIT_OPTS} onChange={(v) => setNw({ ...nw, unit: v as AdUnit })} />
            <Input label="Harga (Rp)" value={nw.price} keyboardType="number-pad" onChangeText={(v) => setNw({ ...nw, price: v })} containerStyle={{ width: 120 }} />
            <AdminSelect label="Penempatan" width={200} value={nw.placement} options={PLACEMENT_OPTS} onChange={(v) => setNw({ ...nw, placement: v as AdPlacement })} />
            <Button title="Buat produk" icon="add" loading={busy === 'new-product'} onPress={createProduct} />
          </Row>
        </View>
      </Panel>

      <NewAdForm products={products} onCreated={loadAds} />

      <Row gap={adminSpace.md} style={{ flexWrap: 'wrap' }}>
        <StatCard index={0} icon="megaphone-outline" label="Iklan pada filter ini" value={ads.length} color={adminTone.blue} />
        <StatCard index={1} icon="radio-outline" label="Sedang tayang" value={liveCount} color={adminTone.green} hint="status aktif & dalam periode" />
        <StatCard index={2} icon="cash-outline" label="Nilai iklan (aktif + selesai)" value={rupiah(revenue)} color={adminTone.teal} hint="harga dibayar − refund, pada filter ini" />
      </Row>

      <Panel title="Iklan merchant" subtitle="Iklan aktif yang periodenya habis otomatis ditandai kedaluwarsa saat daftar dimuat" icon="megaphone-outline" padded={false}
        right={<FilterBar options={FILTERS} value={filter} onChange={setFilter} />}>
        <View style={{ paddingHorizontal: adminSpace.lg, paddingTop: errA ? adminSpace.md : 0 }}><ErrorNote text={errA} onRetry={loadAds} /></View>
        <DataTable rows={ads as unknown as Record<string, unknown>[]} emptyText="Belum ada iklan pada filter ini" emptyIcon="megaphone-outline" columns={[
          { key: 'merchant_name', label: 'Merchant', width: 190, render: (r) => { const a = r as unknown as AdminMerchantAd; return <View style={{ minWidth: 0, alignSelf: 'stretch' }}><Trunc style={font.bodyStrong} title={a.merchant_name}>{a.merchant_name}</Trunc><Text style={font.tiny}>dibuat {fmtDate(a.created_at)}</Text></View>; } },
          { key: 'product_name', label: 'Produk', width: 170, render: (r) => { const a = r as unknown as AdminMerchantAd; return <View><Text style={font.body} numberOfLines={1}>{a.product_name}</Text><Text style={font.tiny} numberOfLines={1}>{PLACEMENT_LABEL[a.placement] ?? a.placement}</Text></View>; } },
          { key: 'starts_at', label: 'Periode', width: 210, render: (r) => { const a = r as unknown as AdminMerchantAd; return <View><Text style={font.small}>{fmtDate(a.starts_at)}</Text><Text style={font.small}>s.d. {fmtDate(a.ends_at)}</Text></View>; } },
          { key: 'price_paid', label: 'Harga', width: 110, align: 'right', mono: true, render: (r) => { const a = r as unknown as AdminMerchantAd; return <View style={{ alignItems: 'flex-end' }}><Text style={font.mono}>{rupiah(a.price_paid)}</Text>{a.refunded ? <Text style={[font.tiny, { color: adminTone.red }]}>refund {rupiah(a.refunded)}</Text> : null}</View>; } },
          { key: 'paid_via', label: 'Bayar', width: 110, render: (r) => <Text style={font.small}>{PAID_VIA_LABEL[String(r.paid_via)] ?? String(r.paid_via ?? '—')}</Text> },
          { key: 'status', label: 'Status', width: 150, render: (r) => { const a = r as unknown as AdminMerchantAd; return <Row gap={4} style={{ flexWrap: 'wrap' }}><Pill text={STATUS_LABEL[a.status] ?? a.status} tone={STATUS_TONE[a.status] ?? 'neutral'} />{a.is_live ? <Pill text="Tayang" tone="ok" icon="radio" /> : null}</Row>; } },
          { key: 'actions', label: 'Aksi', width: 200, render: (r) => {
            const a = r as unknown as AdminMerchantAd;
            const canActivate = a.status === 'draft' || a.status === 'pending_payment';
            const canCancel = a.status !== 'cancelled' && a.status !== 'expired';
            return (
              <Row gap={6}>
                {canActivate ? <Button size="sm" title="Aktifkan" loading={busy === `a:${a.id}`} onPress={() => { setAdStatus(a, 'active'); }} /> : null}
                {canCancel ? <Button size="sm" variant="outline" color={colors.danger} title="Batalkan" onPress={() => setCancelAd(a)} /> : null}
                {!canActivate && !canCancel ? <Text style={font.tiny}>—</Text> : null}
              </Row>
            );
          } },
        ]} />
      </Panel>
      <WideTableHint />

      <AdminDialog visible={!!cancelAd} onClose={() => setCancelAd(null)} title="Batalkan iklan" tone={adminTone.red}
        subtitle={cancelAd ? `${cancelAd.merchant_name} · ${cancelAd.product_name} · ${rupiah(cancelAd.price_paid)}` : undefined}>
        {cancelAd ? (
          <View style={{ gap: 12 }}>
            <Text style={font.body}>
              Iklan berhenti tayang dan statusnya menjadi Dibatalkan.
              {cancelAd.paid_via === 'wallet'
                ? ' Iklan ini dibayar dari saldo merchant — pilih “Batalkan + refund” untuk mengembalikan sisa waktu tayang pro-rata ke saldo pemilik.'
                : ' Iklan ini tidak dibayar dari saldo aplikasi, jadi tidak ada refund otomatis.'}
            </Text>
            <Row gap={8} style={{ justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <Button size="sm" variant="ghost" title="Tutup" onPress={() => setCancelAd(null)} />
              <Button size="sm" variant="outline" color={colors.danger} title="Batalkan tanpa refund" loading={busy === `a:${cancelAd.id}`}
                onPress={async () => { if (await setAdStatus(cancelAd, 'cancelled', false)) setCancelAd(null); }} />
              {cancelAd.paid_via === 'wallet' ? (
                <Button size="sm" color={colors.danger} title="Batalkan + refund" loading={busy === `a:${cancelAd.id}`}
                  onPress={async () => { if (await setAdStatus(cancelAd, 'cancelled', true)) setCancelAd(null); }} />
              ) : null}
            </Row>
          </View>
        ) : null}
      </AdminDialog>

      <FootNote lines={[
        'Pendapatan iklan diakui saat iklan pertama kali aktif (order_ledger · ads_revenue) dan dikurangi refund bila dibatalkan.',
        'Merchant juga bisa membeli iklan sendiri dari saldo pendapatannya (closed-loop, aman terhadap PKS Midtrans Pasal 7.4b) — tampil dengan cara bayar “Saldo merchant”.',
        'Iklan yang dibuat admin berstatus “Ditagih admin” (ditagih di luar aplikasi) atau “Gratis” bila harga 0.',
      ]} />
    </AdminPage>
  );
}

/* ───────────────────────── Form: buat iklan atas nama merchant ───────────────────────── */

function NewAdForm({ products, onCreated }: { products: AdProduct[]; onCreated: () => void }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<MerchantHit[]>([]);
  const [searchErr, setSearchErr] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [merchant, setMerchant] = useState<MerchantHit | null>(null);
  const [product, setProduct] = useState('');
  const [start, setStart] = useState(todayJkt());
  const [days, setDays] = useState('7');
  const [status, setStatus] = useState<MerchantAdStatus>('active');
  const [price, setPrice] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const term = q.trim().replace(/[%,()*\\]/g, ' ').trim();
    if (term.length < 2) { setHits([]); setSearchErr(null); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      const { data, error } = await supabase.from('merchants').select('id,name,status,address').ilike('name', `%${term}%`).order('name').limit(20);
      setSearching(false);
      if (error) { setSearchErr(error.message); setHits([]); return; }
      setSearchErr(null); setHits((data as MerchantHit[]) ?? []);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const prod = products.find((p) => p.code === product);
  const nDays = parseNum(days);
  const estimate = catalogPrice(prod, Number.isFinite(nDays) ? nDays : 0);
  const productOpts = useMemo(() => products.map((p) => ({ value: p.code, label: p.name, sublabel: `${rupiah(p.price)} ${UNIT_LABEL[p.unit]}${p.active ? '' : ' · nonaktif'}` })), [products]);

  const submit = async () => {
    if (!merchant) return toast.error('Pilih merchant dulu');
    if (!prod) return toast.error('Pilih produk iklan');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return toast.error('Tanggal mulai tidak valid');
    if (!Number.isInteger(nDays) || nDays < 1 || nDays > 366) return toast.error('Durasi 1–366 hari');
    const p = price.trim() === '' ? null : parseNum(price);
    if (p !== null && (!Number.isInteger(p) || p < 0)) return toast.error('Harga khusus harus bilangan bulat ≥ 0 (kosongkan untuk harga katalog)');
    if (status === 'active' && merchant.status !== 'approved') return toast.error('Merchant belum disetujui — iklan tidak bisa langsung diaktifkan');
    if (!(await useAdminSecurity.getState().ensureUnlocked())) return;
    setBusy(true);
    try {
      await rpc('admin_set_merchant_ad', {
        p_merchant_id: merchant.id, p_product: prod.code, p_start: new Date(wibStart(start)).toISOString(), p_end: addDaysIso(start, nDays),
        p_status: status, p_id: null, p_price: p, p_refund: false,
      });
      toast.success(`Iklan ${prod.name} untuk ${merchant.name} dibuat (${STATUS_LABEL[status]})`);
      setMerchant(null); setQ(''); setPrice(''); onCreated();
    } catch (e) { handleAdminError(e); } finally { setBusy(false); }
  };

  return (
    <Panel title="Buat iklan atas nama merchant" subtitle="Untuk iklan yang ditagih di luar aplikasi / promosi gratis. Butuh PIN panel." icon="add-circle-outline">
      <Row gap={16} style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <View style={{ flex: 1, minWidth: 280, gap: 8 }}>
          <Text style={font.label}>Merchant</Text>
          {merchant ? (
            <Row gap={8} style={st.picked}>
              <Ionicons name="storefront-outline" size={adminIcon.md} color={adminTone.teal} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={font.bodyStrong} numberOfLines={1}>{merchant.name}</Text>
                <Text style={font.tiny} numberOfLines={1}>{merchant.address ?? '—'}</Text>
              </View>
              <Pill text={merchant.status} tone={merchant.status === 'approved' ? 'ok' : 'wait'} />
              <Button size="sm" variant="ghost" title="Ganti" onPress={() => setMerchant(null)} />
            </Row>
          ) : (
            <>
              <Input placeholder="Cari nama merchant (min. 2 huruf)" icon="search" value={q} onChangeText={setQ} />
              <ErrorNote text={searchErr} />
              {searching ? <Text style={font.tiny}>Mencari…</Text> : null}
              {!searching && q.trim().length >= 2 && hits.length === 0 && !searchErr ? <Text style={font.tiny}>Tidak ada merchant yang cocok.</Text> : null}
              <View style={{ gap: 4 }}>
                {hits.map((m) => (
                  <Pressable key={m.id} onPress={() => setMerchant(m)} style={(s) => [st.hit, (s as { hovered?: boolean }).hovered && { backgroundColor: adminTone.hover }]}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={font.bodyStrong} numberOfLines={1}>{m.name}</Text>
                      <Text style={font.tiny} numberOfLines={1}>{m.address ?? '—'}</Text>
                    </View>
                    <Pill text={m.status} tone={m.status === 'approved' ? 'ok' : 'wait'} />
                  </Pressable>
                ))}
              </View>
            </>
          )}
        </View>
        <View style={{ flex: 1.3, minWidth: 320, gap: 10 }}>
          <Row gap={10} style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <AdminSelect label="Produk" width={240} value={product} options={productOpts} placeholder="Pilih produk…" onChange={setProduct} />
            <DateField label="Mulai (WIB)" value={start} onChange={setStart} />
            <Input label="Durasi (hari)" value={days} keyboardType="number-pad" onChangeText={setDays} containerStyle={{ width: 110 }} />
          </Row>
          <Row gap={10} style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <AdminSelect label="Status awal" width={200} value={status} onChange={(v) => setStatus(v as MerchantAdStatus)}
              options={(['active', 'pending_payment', 'draft'] as MerchantAdStatus[]).map((k) => ({ value: k, label: STATUS_LABEL[k] }))} />
            <Input label="Harga khusus (Rp, opsional)" placeholder={prod ? String(estimate) : 'harga katalog'} value={price} keyboardType="number-pad" onChangeText={setPrice} containerStyle={{ width: 190 }} />
            <Button title="Buat iklan" icon="megaphone-outline" loading={busy} onPress={submit} />
          </Row>
          <Text style={font.tiny}>
            {prod ? `Harga katalog: ${rupiah(prod.price)} ${UNIT_LABEL[prod.unit]} × durasi = ${rupiah(estimate)}${prod.unit === 'per_week' ? ' (dibulatkan ke atas per 7 hari)' : ''}. ` : ''}
            Kosongkan harga khusus untuk memakai harga katalog; isi 0 untuk iklan gratis.
          </Text>
        </View>
      </Row>
    </Panel>
  );
}

const st = StyleSheet.create({
  th: { paddingHorizontal: adminSpace.lg, paddingVertical: adminSpace.sm, backgroundColor: adminTone.surfaceAlt, marginTop: adminSpace.sm },
  tr: { paddingHorizontal: adminSpace.lg, paddingVertical: 8, borderTopWidth: 1, borderTopColor: adminTone.border, alignItems: 'center', minHeight: 64 },
  trAlt: { backgroundColor: adminTone.zebra },
  picked: { alignItems: 'center', padding: adminSpace.sm, borderRadius: adminRadius.md, borderWidth: 1, borderColor: adminTone.border, backgroundColor: adminTone.surfaceAlt },
  hit: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: adminSpace.sm, borderRadius: adminRadius.md, borderWidth: 1, borderColor: adminTone.border },
});
