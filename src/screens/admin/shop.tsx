// Admin · AntarShop: toko katalog (minimarket/apotek/supermarket) & produk — impor CSV / pembaruan manual
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Switch, Platform } from 'react-native';
import { AdminPage, Table, StatCard, adminFont as font, AdminCard as Card } from '@/components/admin';
import { Row, Input, Button, Chip, Badge, toast } from '@/components/ui';
import { DocUpload } from '@/components/DocUpload';
import { rpc, supabase } from '@/lib/supabase';
import { colors } from '@/lib/theme';
import { rupiah, formatDate, cityName, storeBrandLabel, storeCategoryLabel, productCategoryLabel } from '@/lib/format';
import type { ShopStore, ShopProduct, City } from '@/lib/types';

const BRANDS = Object.keys(storeBrandLabel);
const STORE_CATS = Object.keys(storeCategoryLabel);
const PRODUCT_CATS = Object.keys(productCategoryLabel);
const SETTING_KEYS = ['shop_service_pct', 'shop_service_min', 'shop_driver_share_pct', 'shop_car_factor', 'shop_car_min_budget', 'shop_budget_buffer_pct'];
const emptyStore = { id: '', name: '', brand: 'indomaret', category: 'minimarket', address: '', lat: '', lng: '', open_hours: '07:00-22:00', phone: '', image_url: '', active: true };
const emptyProduct = { sku: '', name: '', category: 'sembako', unit: 'pcs', price: '', stock: '', in_stock: true };
type CsvItem = { sku: string; name: string; category: string; unit: string; price: number; in_stock: boolean };

/** Parser CSV ringan: pemisah koma/titik koma, header opsional (sku,name,category,unit,price,in_stock). */
function parseCsv(text: string): CsvItem[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const delim = (lines[0].match(/;/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? ';' : ',';
  const split = (l: string) => { const out: string[] = []; let cur = ''; let q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === delim && !q) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out.map((c) => c.trim()); };
  const first = split(lines[0]).map((c) => c.toLowerCase());
  const hasHeader = first.includes('name') || first.includes('nama');
  const cols = hasHeader ? first : ['sku', 'name', 'category', 'unit', 'price', 'in_stock'];
  const idx = (names: string[]) => cols.findIndex((c) => names.includes(c));
  const iSku = idx(['sku', 'kode']), iName = idx(['name', 'nama']), iCat = idx(['category', 'kategori']), iUnit = idx(['unit', 'satuan']), iPrice = idx(['price', 'harga']), iStock = idx(['in_stock', 'stock', 'stok', 'tersedia']);
  const at = (c: string[], i: number) => (i >= 0 ? c[i] ?? '' : '');
  return (hasHeader ? lines.slice(1) : lines).map(split).map((c) => ({
    sku: at(c, iSku), name: at(c, iName), category: (at(c, iCat) || 'lainnya').toLowerCase(), unit: at(c, iUnit) || 'pcs',
    price: Number(at(c, iPrice).replace(/[^\d]/g, '')) || 0,
    in_stock: !['0', 'false', 'habis', 'no', 'tidak'].includes((at(c, iStock) || 'true').toLowerCase()),
  })).filter((r) => r.name && r.price > 0);
}

/** Sel angka: tersimpan otomatis 0,8 detik setelah berhenti mengetik (atau tekan Enter) bila berubah. */
function NumCell({ value, onSave, width = 110 }: { value: number | null; onSave: (n: number | null) => void; width?: number }) {
  const [v, setV] = useState(value == null ? '' : String(value));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { setV(value == null ? '' : String(value)); }, [value]);
  const commit = (raw: string) => { const n = raw.trim() === '' ? null : Number(raw); if (n === value || (n !== null && Number.isNaN(n))) return; onSave(n); };
  const change = (t: string) => { setV(t); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => commit(t), 800); };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return <Input value={v} onChangeText={change} onSubmitEditing={() => { if (timer.current) clearTimeout(timer.current); commit(v); }} keyboardType="number-pad" containerStyle={{ width }} />;
}

export default function AdminShop() {
  const [stores, setStores] = useState<ShopStore[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [counts, setCounts] = useState<Record<string, { total: number; out: number }>>({});
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [sf, setSf] = useState({ ...emptyStore });
  const [selected, setSelected] = useState<ShopStore | null>(null);
  const [products, setProducts] = useState<ShopProduct[]>([]);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [pf, setPf] = useState({ ...emptyProduct });
  const [csv, setCsv] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [{ data: s }, { data: c }, { data: p }, { data: st }] = await Promise.all([
      supabase.from('shop_stores').select('*').order('name'),
      supabase.from('cities').select('*').order('name'),
      supabase.from('shop_products').select('store_id,in_stock,active').range(0, 9999),
      supabase.from('app_settings').select('*').in('key', SETTING_KEYS),
    ]);
    setStores((s as ShopStore[]) ?? []); setCities((c as City[]) ?? []);
    const map: Record<string, { total: number; out: number }> = {};
    ((p as { store_id: string; in_stock: boolean; active: boolean }[]) ?? []).forEach((r) => { if (!r.active) return; const m = (map[r.store_id] ??= { total: 0, out: 0 }); m.total += 1; if (!r.in_stock) m.out += 1; });
    setCounts(map);
    setSettings(Object.fromEntries(((st as { key: string; value: unknown }[]) ?? []).map((r) => [r.key, String(r.value)])));
  }, []);
  const loadProducts = useCallback(async (storeId: string) => {
    const { data } = await supabase.from('shop_products').select('*').eq('store_id', storeId).order('category').order('name').range(0, 4999);
    setProducts((data as ShopProduct[]) ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (selected) loadProducts(selected.id); else setProducts([]); }, [selected, loadProducts]);

  const totals = useMemo(() => Object.values(counts).reduce((a, m) => ({ total: a.total + m.total, out: a.out + m.out }), { total: 0, out: 0 }), [counts]);
  const filtered = useMemo(() => products.filter((p) => (!cat || p.category === cat) && (!q || `${p.name} ${p.sku ?? ''}`.toLowerCase().includes(q.toLowerCase()))), [products, cat, q]);
  const preview = useMemo(() => parseCsv(csv), [csv]);

  const saveStore = async () => {
    if (sf.name.trim().length < 3) return toast.error('Nama toko minimal 3 huruf');
    const lat = Number(sf.lat), lng = Number(sf.lng);
    if (!lat || !lng) return toast.error('Isi koordinat lat/lng toko');
    setBusy(true);
    try {
      const r = await rpc<ShopStore>('admin_upsert_store', { p: { id: sf.id || null, name: sf.name.trim(), brand: sf.brand, category: sf.category, address: sf.address || null, lat, lng, open_hours: sf.open_hours || null, phone: sf.phone || null, image_url: sf.image_url || null, active: sf.active } });
      toast.success(sf.id ? 'Toko diperbarui' : 'Toko ditambahkan'); setSf({ ...emptyStore }); await load(); if (selected?.id === r.id) setSelected(r);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  const editStore = (s: ShopStore) => setSf({ id: s.id, name: s.name, brand: s.brand, category: s.category, address: s.address ?? '', lat: String(s.lat), lng: String(s.lng), open_hours: s.open_hours ?? '', phone: s.phone ?? '', image_url: s.image_url ?? '', active: s.active !== false });
  const toggleStore = async (s: ShopStore) => { try { await rpc('admin_upsert_store', { p: { id: s.id, active: !(s.active !== false) } }); load(); } catch (e) { toast.error((e as Error).message); } };

  const patchProduct = async (id: string, patch: Record<string, unknown>) => {
    try { await rpc('admin_upsert_product', { p: { id, ...patch } }); if (selected) loadProducts(selected.id); load(); } catch (e) { toast.error((e as Error).message); }
  };
  const setStock = async (ids: string[], inStock: boolean) => {
    try { await rpc('admin_set_product_stock', { p_ids: ids, p_in_stock: inStock }); toast.success(inStock ? 'Ditandai tersedia' : 'Ditandai habis'); if (selected) loadProducts(selected.id); load(); } catch (e) { toast.error((e as Error).message); }
  };
  const saveProduct = async () => {
    if (!selected) return;
    if (pf.name.trim().length < 2 || !Number(pf.price)) return toast.error('Isi nama & harga produk');
    setBusy(true);
    try {
      await rpc('admin_upsert_product', { p: { store_id: selected.id, sku: pf.sku || null, name: pf.name.trim(), category: pf.category, unit: pf.unit || 'pcs', price: Number(pf.price), stock: pf.stock === '' ? null : Number(pf.stock), in_stock: pf.in_stock, active: true } });
      toast.success('Produk disimpan'); setPf({ ...emptyProduct }); loadProducts(selected.id); load();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  const pickCsvFile = () => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return toast.show('Di perangkat ini, tempel isi CSV ke kotak teks');
    const input = document.createElement('input'); input.type = 'file'; input.accept = '.csv,text/csv,text/plain';
    input.onchange = () => { const f = input.files?.[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => setCsv(String(rd.result ?? '')); rd.readAsText(f); };
    input.click();
  };
  const importCsv = async () => {
    if (!selected) return;
    if (!preview.length) return toast.error('Tidak ada baris valid (butuh kolom name & price)');
    setBusy(true);
    try { const r = await rpc<{ imported: number }>('admin_import_products', { p_store: selected.id, p_items: preview, p_source: 'csv' }); toast.success(`${r.imported} produk diimpor`); setCsv(''); loadProducts(selected.id); load(); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <AdminPage title="AntarShop · Toko & Produk" subtitle="Toko katalog (minimarket, apotek, supermarket), produk, stok & impor CSV" onRefresh={load}>
      <Row gap={12} style={{ flexWrap: 'wrap' }}>
        <StatCard index={0} label="Toko aktif" value={stores.filter((s) => s.active !== false).length} hint={`${stores.length} toko terdaftar`} color={colors.shop} />
        <StatCard index={1} label="Produk aktif" value={totals.total} hint="Semua toko" color={colors.info} />
        <StatCard index={2} label="Produk habis" value={totals.out} hint="Ditandai tidak tersedia" color={colors.warning} />
      </Row>
      <Card style={{ backgroundColor: colors.shop + '12', borderColor: colors.shop + '40', gap: 4 }}>
        <Text style={font.small}>Katalog & harga diambil dari sumber toko (file harga supermarket/CSV). Integrasi API resmi Klik Indomaret/Alfagift belum tersedia publik — gunakan impor CSV/pembaruan manual.</Text>
        <Text style={font.tiny}>Margin (app_settings): jasa belanja {settings.shop_service_pct ?? '-'}% (min {rupiah(Number(settings.shop_service_min) || 0)}) · bagian driver {settings.shop_driver_share_pct ?? '-'}% · faktor mobil ×{settings.shop_car_factor ?? '-'} (min anggaran {rupiah(Number(settings.shop_car_min_budget) || 0)}) · buffer anggaran {settings.shop_budget_buffer_pct ?? '-'}%. Ubah di halaman Pengaturan.</Text>
      </Card>

      <Row gap={16} style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <Card style={{ flex: 1, minWidth: 320, gap: 10 }}>
          <Row between><Text style={font.label}>{sf.id ? 'Ubah toko' : 'Tambah toko'}</Text>{sf.id ? <Button size="sm" variant="ghost" title="Batal ubah" onPress={() => setSf({ ...emptyStore })} /> : null}</Row>
          <Input placeholder="Nama toko (mis. Indomaret Sudirman)" value={sf.name} onChangeText={(v) => setSf({ ...sf, name: v })} />
          <Row gap={6} style={{ flexWrap: 'wrap' }}>{BRANDS.map((b) => <Chip key={b} label={storeBrandLabel[b]} active={sf.brand === b} onPress={() => setSf({ ...sf, brand: b, category: b === 'apotek' ? 'apotek' : b === 'supermarket' ? 'supermarket' : sf.category })} color={colors.shop} />)}</Row>
          <Row gap={6} style={{ flexWrap: 'wrap' }}>{STORE_CATS.map((c) => <Chip key={c} label={storeCategoryLabel[c]} active={sf.category === c} onPress={() => setSf({ ...sf, category: c })} color={colors.shop} />)}</Row>
          <Input placeholder="Alamat" value={sf.address} onChangeText={(v) => setSf({ ...sf, address: v })} />
          <Row gap={8}><Input placeholder="Lat" value={sf.lat} onChangeText={(v) => setSf({ ...sf, lat: v })} containerStyle={{ flex: 1 }} /><Input placeholder="Lng" value={sf.lng} onChangeText={(v) => setSf({ ...sf, lng: v })} containerStyle={{ flex: 1 }} /><Input placeholder="Jam buka" value={sf.open_hours} onChangeText={(v) => setSf({ ...sf, open_hours: v })} containerStyle={{ flex: 1 }} /></Row>
          <Input placeholder="Telepon" value={sf.phone} onChangeText={(v) => setSf({ ...sf, phone: v })} />
          <DocUpload label="Gambar toko" hint="Opsional, tampil di daftar toko pelanggan" value={sf.image_url || null} onChange={(u) => setSf({ ...sf, image_url: u })} bucket="merchant-images" color={colors.shop} />
          <Row between><Text style={font.small}>Aktif (tampil untuk pelanggan)</Text><Switch value={sf.active} onValueChange={(v) => setSf({ ...sf, active: v })} trackColor={{ true: colors.success, false: colors.border }} thumbColor="#fff" /></Row>
          <Button title={sf.id ? 'Simpan perubahan' : 'Tambah toko'} color={colors.shop} loading={busy} onPress={saveStore} />
        </Card>
        <View style={{ flex: 1.4, minWidth: 360 }}>
          <Table rows={stores as unknown as Record<string, unknown>[]} emptyText="Belum ada toko katalog" columns={[
            { key: 'name', label: 'Toko', width: 220, render: (r) => { const s = r as unknown as ShopStore; return <View><Text style={{ fontWeight: '700', color: selected?.id === s.id ? colors.shop : colors.text }}>{s.name}</Text><Text style={font.tiny} numberOfLines={1}>{s.address ?? '-'}</Text></View>; } },
            { key: 'brand', label: 'Brand', width: 100, render: (r) => <Badge text={storeBrandLabel[String(r.brand)] ?? String(r.brand)} color={colors.shop} /> },
            { key: 'category', label: 'Kategori', width: 100, render: (r) => <Text style={font.small}>{storeCategoryLabel[String(r.category)] ?? String(r.category)}</Text> },
            { key: 'city', label: 'Kota', width: 100, render: (r) => <Text style={font.small}>{cityName(cities, String(r.city_id ?? ''))}</Text> },
            { key: 'open_hours', label: 'Jam', width: 100, render: (r) => <Text style={font.tiny}>{String(r.open_hours ?? '-')}</Text> },
            { key: 'catalog_source', label: 'Sumber katalog', width: 110, render: (r) => <Badge text={String(r.catalog_source ?? 'admin')} color={colors.info} /> },
            { key: 'products', label: 'Produk', width: 90, render: (r) => { const m = counts[String(r.id)]; return <Text style={font.small}>{m?.total ?? 0}{m?.out ? ` (${m.out} habis)` : ''}</Text>; } },
            { key: 'active', label: 'Aktif', width: 70, render: (r) => { const s = r as unknown as ShopStore; return <Switch value={s.active !== false} onValueChange={() => toggleStore(s)} trackColor={{ true: colors.success, false: colors.border }} thumbColor="#fff" />; } },
            { key: 'actions', label: 'Aksi', width: 170, render: (r) => { const s = r as unknown as ShopStore; return <Row gap={6}><Button size="sm" title="Produk" color={colors.shop} onPress={() => setSelected(s)} /><Button size="sm" variant="outline" title="Ubah" color={colors.shop} onPress={() => editStore(s)} /></Row>; } },
          ]} />
        </View>
      </Row>

      {selected && (<>
        <Card style={{ gap: 10 }}>
          <Row between style={{ flexWrap: 'wrap', gap: 8 }}>
            <View><Text style={font.h3}>Produk · {selected.name}</Text><Text style={font.tiny}>{products.length} produk · {products.filter((p) => !p.in_stock).length} habis · sumber {selected.catalog_source ?? 'admin'}</Text></View>
            <Row gap={6}>
              <Button size="sm" variant="outline" title="Tandai semua tersedia" color={colors.success} onPress={() => { const ids = products.filter((p) => !p.in_stock).map((p) => p.id); if (ids.length) setStock(ids, true); }} />
              <Button size="sm" variant="ghost" title="Tutup" onPress={() => setSelected(null)} />
            </Row>
          </Row>
          <Input placeholder="Cari nama / SKU" icon="search-outline" value={q} onChangeText={setQ} />
          <Row gap={6} style={{ flexWrap: 'wrap' }}>
            <Chip label="Semua" active={!cat} onPress={() => setCat('')} color={colors.shop} />
            {PRODUCT_CATS.map((c) => <Chip key={c} label={productCategoryLabel[c]} active={cat === c} onPress={() => setCat(c)} color={colors.shop} />)}
          </Row>
          <Table rows={filtered as unknown as Record<string, unknown>[]} emptyText="Belum ada produk — tambah manual atau impor CSV" columns={[
            { key: 'sku', label: 'SKU', width: 110, render: (r) => <Text style={font.tiny} numberOfLines={1}>{String(r.sku ?? '-')}</Text> },
            { key: 'name', label: 'Nama', width: 220, render: (r) => <Text style={{ fontWeight: '700', color: colors.text }} numberOfLines={2}>{String(r.name)}</Text> },
            { key: 'category', label: 'Kategori', width: 110, render: (r) => <Badge text={productCategoryLabel[String(r.category)] ?? String(r.category)} color={colors.shop} /> },
            { key: 'unit', label: 'Satuan', width: 70 },
            { key: 'price', label: 'Harga', width: 130, render: (r) => { const p = r as unknown as ShopProduct; return <NumCell value={p.price} width={120} onSave={(n) => { if (n && n > 0) patchProduct(p.id, { price: n }); }} />; } },
            { key: 'stock', label: 'Stok', width: 90, render: (r) => { const p = r as unknown as ShopProduct; return <NumCell value={p.stock} width={80} onSave={(n) => patchProduct(p.id, { stock: n })} />; } },
            { key: 'in_stock', label: 'Ketersediaan', width: 150, render: (r) => { const p = r as unknown as ShopProduct; return <Row gap={6}><Badge text={p.in_stock ? 'Tersedia' : 'Habis'} color={p.in_stock ? colors.success : colors.danger} /><Button size="sm" variant="outline" title={p.in_stock ? 'Tandai habis' : 'Tersedia'} color={p.in_stock ? colors.danger : colors.success} onPress={() => setStock([p.id], !p.in_stock)} /></Row>; } },
            { key: 'active', label: 'Aktif', width: 70, render: (r) => { const p = r as unknown as ShopProduct; return <Switch value={p.active} onValueChange={(v) => patchProduct(p.id, { active: v })} trackColor={{ true: colors.success, false: colors.border }} thumbColor="#fff" />; } },
            { key: 'updated_at', label: 'Diperbarui', width: 130, render: (r) => <Text style={font.tiny}>{formatDate(String(r.updated_at))}</Text> },
          ]} />
        </Card>

        <Row gap={16} style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <Card style={{ flex: 1, minWidth: 300, gap: 10 }}>
            <Text style={font.label}>Tambah produk</Text>
            <Row gap={8}><Input placeholder="SKU (opsional)" value={pf.sku} onChangeText={(v) => setPf({ ...pf, sku: v })} containerStyle={{ flex: 1 }} /><Input placeholder="Satuan (pcs/kg/botol)" value={pf.unit} onChangeText={(v) => setPf({ ...pf, unit: v })} containerStyle={{ flex: 1 }} /></Row>
            <Input placeholder="Nama produk" value={pf.name} onChangeText={(v) => setPf({ ...pf, name: v })} />
            <Row gap={6} style={{ flexWrap: 'wrap' }}>{PRODUCT_CATS.map((c) => <Chip key={c} label={productCategoryLabel[c]} active={pf.category === c} onPress={() => setPf({ ...pf, category: c })} color={colors.shop} />)}</Row>
            <Row gap={8}><Input placeholder="Harga (Rp)" value={pf.price} onChangeText={(v) => setPf({ ...pf, price: v })} keyboardType="number-pad" containerStyle={{ flex: 1 }} /><Input placeholder="Stok (opsional)" value={pf.stock} onChangeText={(v) => setPf({ ...pf, stock: v })} keyboardType="number-pad" containerStyle={{ flex: 1 }} /></Row>
            <Row between><Text style={font.small}>Tersedia</Text><Switch value={pf.in_stock} onValueChange={(v) => setPf({ ...pf, in_stock: v })} trackColor={{ true: colors.success, false: colors.border }} thumbColor="#fff" /></Row>
            <Button title="Simpan produk" color={colors.shop} loading={busy} onPress={saveProduct} />
          </Card>
          <Card style={{ flex: 1.2, minWidth: 320, gap: 10 }}>
            <Text style={font.label}>Impor CSV</Text>
            <Text style={font.tiny}>Format: sku,name,category,unit,price,in_stock (baris pertama boleh header; pemisah koma atau titik koma). Kategori: {PRODUCT_CATS.join(', ')}. SKU sama pada toko ini akan diperbarui (harga & stok).</Text>
            <Row gap={8}>
              <Button size="sm" variant="outline" title={Platform.OS === 'web' ? 'Unggah file .csv' : 'Tempel teks CSV'} color={colors.shop} icon="document-attach-outline" onPress={pickCsvFile} />
              {csv ? <Button size="sm" variant="ghost" title="Kosongkan" onPress={() => setCsv('')} /> : null}
            </Row>
            <Input placeholder={'sku,name,category,unit,price,in_stock\nIDM-001,Indomie Goreng 85g,sembako,pcs,3500,true'} value={csv} onChangeText={setCsv} multiline style={{ minHeight: 120, textAlignVertical: 'top' }} />
            {preview.length > 0 && (
              <View style={{ gap: 6 }}>
                <Text style={font.small}>Pratinjau {Math.min(5, preview.length)} dari {preview.length} baris valid</Text>
                <Table rows={preview.slice(0, 5).map((r, i) => ({ ...r, id: `${r.sku || r.name}-${i}` }))} columns={[
                  { key: 'sku', label: 'SKU', width: 100 }, { key: 'name', label: 'Nama', width: 180 }, { key: 'category', label: 'Kategori', width: 90 }, { key: 'unit', label: 'Satuan', width: 70 },
                  { key: 'price', label: 'Harga', width: 100, render: (r) => <Text style={font.small}>{rupiah(Number(r.price))}</Text> },
                  { key: 'in_stock', label: 'Stok', width: 80, render: (r) => <Badge text={r.in_stock ? 'Ada' : 'Habis'} color={r.in_stock ? colors.success : colors.danger} /> },
                ]} />
              </View>
            )}
            <Button title={`Impor ${preview.length} produk ke ${selected.name}`} color={colors.shop} loading={busy} disabled={!preview.length} onPress={importCsv} />
          </Card>
        </Row>
      </>)}
    </AdminPage>
  );
}
