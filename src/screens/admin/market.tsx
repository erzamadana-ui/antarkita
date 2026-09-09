// Admin · AntarMarket: pasar tradisional, bahan/komoditas, harga acuan per pasar & statistik nota driver
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Switch } from 'react-native';
import { AdminPage, Table, StatCard, FilterBar, AdminSelect, adminFont as font, adminTone, adminSpace, AdminCard as Card } from '@/components/admin';
import { Row, Input, Button, Badge, toast } from '@/components/ui';
import { DocUpload } from '@/components/DocUpload';
import { rpc, supabase } from '@/lib/supabase';
import { colors } from '@/lib/theme';
import { rupiah, cityName, marketCategoryLabel } from '@/lib/format';
import type { Market, MarketItem, MarketPriceStat, City } from '@/lib/types';
import { fmtDate, fmtAgo, WideTableHint } from './_shared';

const CATS = Object.keys(marketCategoryLabel);
const SETTING_KEYS = ['market_service_pct', 'market_service_min', 'market_driver_share_pct', 'shop_budget_buffer_pct'];
const SOURCE_LABEL: Record<string, string> = { admin: 'Admin', survey: 'Survei pasar', pasar: 'Harga pasar', nota_driver: 'Nota driver', driver: 'Nota driver', pihps: 'PIHPS BI' };
const emptyMarket = { id: '', name: '', address: '', lat: '', lng: '', open_hours: '05:00-13:00', notes: '', image_url: '', active: true };
const emptyItem = { id: '', name: '', category: 'sayur', unit: 'kg', ref_price: '', sort: '100', active: true };
type Tab = 'markets' | 'items' | 'prices' | 'stats';

export default function AdminMarket() {
  const [tab, setTab] = useState<Tab>('markets');
  const [markets, setMarkets] = useState<Market[]>([]);
  const [items, setItems] = useState<MarketItem[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [mf, setMf] = useState({ ...emptyMarket });
  const [itf, setItf] = useState({ ...emptyItem });
  const [priceMarket, setPriceMarket] = useState<Market | null>(null);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [priceMeta, setPriceMeta] = useState<Record<string, string>>({});
  const [stats, setStats] = useState<MarketPriceStat[]>([]);
  const [cityFilter, setCityFilter] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [{ data: m }, { data: it }, { data: c }, { data: st }] = await Promise.all([
      supabase.from('markets').select('*').order('name'),
      supabase.from('market_items').select('*').order('sort').order('name'),
      supabase.from('cities').select('*').order('name'),
      supabase.from('app_settings').select('*').in('key', SETTING_KEYS),
    ]);
    setMarkets((m as Market[]) ?? []); setItems((it as MarketItem[]) ?? []); setCities((c as City[]) ?? []);
    setSettings(Object.fromEntries(((st as { key: string; value: unknown }[]) ?? []).map((r) => [r.key, String(r.value)])));
  }, []);
  const loadStats = useCallback(async () => { try { setStats(await rpc<MarketPriceStat[]>('admin_market_price_stats', { p_days: 30 })); } catch (e) { toast.error((e as Error).message); } }, []);
  const loadPrices = useCallback(async (marketId: string) => {
    const { data } = await supabase.from('market_prices').select('item_id,price,updated_at').eq('market_id', marketId);
    const rows = (data as { item_id: string; price: number; updated_at: string }[]) ?? [];
    setPrices(Object.fromEntries(rows.map((r) => [r.item_id, String(r.price)])));
    setPriceMeta(Object.fromEntries(rows.map((r) => [r.item_id, r.updated_at])));
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (tab === 'stats') loadStats(); }, [tab, loadStats]);
  useEffect(() => { if (priceMarket) loadPrices(priceMarket.id); else { setPrices({}); setPriceMeta({}); } }, [priceMarket, loadPrices]);

  const activeItems = useMemo(() => items.filter((i) => i.active !== false), [items]);
  // Pemilihan kota & pasar memakai dropdown ringkas (bukan deret chip yang menghabiskan ruang).
  const cityOptions = useMemo(() => cities.map((c) => ({ value: c.id, label: c.name, sublabel: c.province ?? undefined })), [cities]);
  const shownMarkets = useMemo(() => (cityFilter ? markets.filter((m) => m.city_id === cityFilter) : markets), [markets, cityFilter]);

  const saveMarket = async () => {
    if (mf.name.trim().length < 3) return toast.error('Nama pasar minimal 3 huruf');
    const lat = Number(mf.lat), lng = Number(mf.lng);
    if (!lat || !lng) return toast.error('Isi koordinat lat/lng pasar');
    setBusy(true);
    try {
      await rpc('admin_upsert_market', { p: { id: mf.id || null, name: mf.name.trim(), address: mf.address || null, lat, lng, open_hours: mf.open_hours || null, notes: mf.notes || null, image_url: mf.image_url || null, active: mf.active } });
      toast.success(mf.id ? 'Pasar diperbarui' : 'Pasar ditambahkan'); setMf({ ...emptyMarket }); load();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  const editMarket = (m: Market) => { setMf({ id: m.id, name: m.name, address: m.address ?? '', lat: String(m.lat), lng: String(m.lng), open_hours: m.open_hours ?? '', notes: m.notes ?? '', image_url: m.image_url ?? '', active: m.active !== false }); setTab('markets'); };
  const toggleMarket = async (m: Market) => { try { await rpc('admin_upsert_market', { p: { id: m.id, active: !(m.active !== false) } }); load(); } catch (e) { toast.error((e as Error).message); } };

  const saveItem = async () => {
    if (itf.name.trim().length < 2) return toast.error('Nama bahan minimal 2 huruf');
    if (!itf.id && !Number(itf.ref_price)) return toast.error('Isi harga acuan');
    setBusy(true);
    try {
      const p: Record<string, unknown> = { id: itf.id || null, name: itf.name.trim(), category: itf.category, unit: itf.unit || 'kg', sort: Number(itf.sort) || 100, active: itf.active };
      if (Number(itf.ref_price)) { p.ref_price = Number(itf.ref_price); p.price_source = 'admin'; }
      await rpc('admin_upsert_market_item', { p });
      toast.success(itf.id ? 'Bahan diperbarui' : 'Bahan ditambahkan'); setItf({ ...emptyItem }); load();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  const editItem = (i: MarketItem) => setItf({ id: i.id, name: i.name, category: String(i.category), unit: i.unit, ref_price: String(i.ref_price), sort: String(i.sort), active: i.active !== false });
  const toggleItem = async (i: MarketItem) => { try { await rpc('admin_upsert_market_item', { p: { id: i.id, active: !(i.active !== false) } }); load(); } catch (e) { toast.error((e as Error).message); } };

  const saveMarketPrices = async () => {
    if (!priceMarket) return;
    const list = activeItems.map((i) => ({ item_id: i.id, price: Number(prices[i.id]) || 0 })).filter((r) => r.price > 0);
    if (!list.length) return toast.error('Isi minimal satu harga');
    setBusy(true);
    try { const n = await rpc<number>('admin_set_market_prices', { p_market: priceMarket.id, p_prices: list, p_source: 'survey' }); toast.success(`${n} harga pasar disimpan (survei)`); loadPrices(priceMarket.id); load(); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  const applyMedian = async (s: MarketPriceStat) => {
    if (!s.driver_median) return;
    try { await rpc('admin_upsert_market_item', { p: { id: s.item_id, ref_price: s.driver_median, price_source: 'survey' } }); toast.success(`Acuan ${s.name} → ${rupiah(s.driver_median)}`); loadStats(); load(); }
    catch (e) { toast.error((e as Error).message); }
  };

  return (
    <AdminPage title="AntarMarket · Pasar & Harga" subtitle="Pasar tradisional, daftar bahan, harga acuan per pasar & statistik nota driver" onRefresh={async () => { await load(); if (tab === 'stats') loadStats(); }}>
      <Row gap={adminSpace.lg} style={{ flexWrap: 'wrap' }}>
        <StatCard index={0} icon="storefront-outline" label="Pasar aktif" value={markets.filter((m) => m.active !== false).length} hint={`${markets.length} pasar terdaftar`} color={adminTone.teal} />
        <StatCard index={1} icon="leaf-outline" label="Bahan aktif" value={activeItems.length} hint={`${items.length} total bahan`} color={adminTone.green} />
        <StatCard index={2} icon="cash-outline" label="Jasa belanja" value={`${settings.market_service_pct ?? '-'}%`} hint={`min ${rupiah(Number(settings.market_service_min) || 0)} · driver ${settings.market_driver_share_pct ?? '-'}%`} color={adminTone.orange} />
      </Row>
      <Card style={{ backgroundColor: colors.market + '12', borderColor: colors.market + '40', gap: 4 }}>
        <Text style={font.small}>Acuan awal adalah perkiraan; survei pasar wajib sebelum komersial. Sumber publik: PIHPS Bank Indonesia (hargapangan.id) 10 komoditas, update harian — tidak menyediakan API, isi manual.</Text>
        <Text style={font.tiny}>Dana pelanggan ditahan = acuan + buffer {settings.shop_budget_buffer_pct ?? '10'}%. Harga yang dilihat pelanggan: acuan per pasar → median nota driver 7 hari → acuan umum. Margin diubah di halaman Pengaturan.</Text>
      </Card>
      <FilterBar value={tab} onChange={(v) => setTab(v as Tab)} options={[{ key: 'markets', label: `Pasar (${markets.length})` }, { key: 'items', label: `Bahan (${items.length})` }, { key: 'prices', label: 'Harga per pasar' }, { key: 'stats', label: 'Statistik harga (30 hari)' }]} />

      {tab === 'markets' && (
        <Row gap={16} style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <Card style={{ flex: 1, minWidth: 320, gap: 10 }}>
            <Row between><Text style={font.label}>{mf.id ? 'Ubah pasar' : 'Tambah pasar'}</Text>{mf.id ? <Button size="sm" variant="ghost" title="Batal ubah" onPress={() => setMf({ ...emptyMarket })} /> : null}</Row>
            <Input placeholder="Nama pasar (mis. Pasar Bawah)" value={mf.name} onChangeText={(v) => setMf({ ...mf, name: v })} />
            <Input placeholder="Alamat" value={mf.address} onChangeText={(v) => setMf({ ...mf, address: v })} />
            <Row gap={8}><Input placeholder="Lat" value={mf.lat} onChangeText={(v) => setMf({ ...mf, lat: v })} containerStyle={{ flex: 1 }} /><Input placeholder="Lng" value={mf.lng} onChangeText={(v) => setMf({ ...mf, lng: v })} containerStyle={{ flex: 1 }} /><Input placeholder="Jam buka" value={mf.open_hours} onChangeText={(v) => setMf({ ...mf, open_hours: v })} containerStyle={{ flex: 1 }} /></Row>
            <Input placeholder="Catatan (mis. ramai pagi, parkir motor di sisi utara)" value={mf.notes} onChangeText={(v) => setMf({ ...mf, notes: v })} multiline style={{ minHeight: 60, textAlignVertical: 'top' }} />
            <DocUpload label="Gambar pasar" hint="Opsional" value={mf.image_url || null} onChange={(u) => setMf({ ...mf, image_url: u })} bucket="merchant-images" color={colors.market} />
            <Row between><Text style={font.small}>Aktif (tampil untuk pelanggan)</Text><Switch value={mf.active} onValueChange={(v) => setMf({ ...mf, active: v })} trackColor={{ true: colors.success, false: colors.border }} thumbColor="#fff" /></Row>
            <Button title={mf.id ? 'Simpan perubahan' : 'Tambah pasar'} loading={busy} onPress={saveMarket} />
          </Card>
          <View style={{ flexGrow: 1, flexBasis: '100%', minWidth: 320, gap: adminSpace.sm }}>
            <Row gap={adminSpace.sm} style={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <AdminSelect icon="location-outline" placeholder="Semua kota" width={200} value={cityFilter} options={cityOptions} onChange={setCityFilter} clearable clearLabel="Semua kota" />
            </Row>
            <Table rows={shownMarkets as unknown as Record<string, unknown>[]} emptyText="Belum ada pasar pada kota ini" columns={[
              { key: 'name', label: 'Pasar', width: 210, render: (r) => { const m = r as unknown as Market; return <View style={{ minWidth: 0, alignSelf: 'stretch' }}><Text style={font.bodyStrong} numberOfLines={1}>{m.name}</Text><Text style={font.tiny} numberOfLines={1}>{m.address ?? '-'}</Text></View>; } },
              { key: 'city', label: 'Kota', width: 100, render: (r) => <Text style={font.small}>{cityName(cities, String(r.city_id ?? ''))}</Text> },
              { key: 'open_hours', label: 'Jam', width: 100, render: (r) => <Text style={font.tiny}>{String(r.open_hours ?? '-')}</Text> },
              { key: 'notes', label: 'Catatan', width: 180, render: (r) => <Text style={font.tiny} numberOfLines={2}>{String(r.notes ?? '-')}</Text> },
              { key: 'active', label: 'Aktif', width: 70, render: (r) => { const m = r as unknown as Market; return <Switch value={m.active !== false} onValueChange={() => toggleMarket(m)} trackColor={{ true: colors.success, false: colors.border }} thumbColor="#fff" />; } },
              { key: 'actions', label: 'Aksi', width: 170, align: 'right', render: (r) => { const m = r as unknown as Market; return <Row gap={6} style={{ flexWrap: 'nowrap' }}><Button size="sm" title="Harga" onPress={() => { setPriceMarket(m); setTab('prices'); }} /><Button size="sm" variant="outline" title="Ubah" onPress={() => editMarket(m)} /></Row>; } },
            ]} />
          </View>
        </Row>
      )}

      {tab === 'items' && (
        <Row gap={16} style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <Card style={{ flex: 1, minWidth: 300, gap: 10 }}>
            <Row between><Text style={font.label}>{itf.id ? 'Ubah bahan' : 'Tambah bahan'}</Text>{itf.id ? <Button size="sm" variant="ghost" title="Batal ubah" onPress={() => setItf({ ...emptyItem })} /> : null}</Row>
            <Input placeholder="Nama bahan (mis. Cabai merah keriting)" value={itf.name} onChangeText={(v) => setItf({ ...itf, name: v })} />
            <AdminSelect label="Kategori" icon="pricetags-outline" width="100%" value={itf.category} options={CATS.map((c) => ({ value: c, label: marketCategoryLabel[c] }))} onChange={(v) => setItf({ ...itf, category: v })} />
            <Row gap={8}><Input placeholder="Satuan (kg/ikat/butir)" value={itf.unit} onChangeText={(v) => setItf({ ...itf, unit: v })} containerStyle={{ flex: 1 }} /><Input placeholder="Harga acuan (Rp)" value={itf.ref_price} onChangeText={(v) => setItf({ ...itf, ref_price: v })} keyboardType="number-pad" containerStyle={{ flex: 1 }} /><Input placeholder="Urutan" value={itf.sort} onChangeText={(v) => setItf({ ...itf, sort: v })} keyboardType="number-pad" containerStyle={{ width: 80 }} /></Row>
            <Row between><Text style={font.small}>Aktif</Text><Switch value={itf.active} onValueChange={(v) => setItf({ ...itf, active: v })} trackColor={{ true: colors.success, false: colors.border }} thumbColor="#fff" /></Row>
            <Button title={itf.id ? 'Simpan perubahan' : 'Tambah bahan'} loading={busy} onPress={saveItem} />
            <Text style={font.tiny}>Mengisi harga acuan saat ubah akan mencatat sumber "Admin" & memperbarui waktu. Kosongkan bila hanya mengubah nama/satuan.</Text>
          </Card>
          <View style={{ flex: 1.6, minWidth: 380 }}>
            <Table rows={items as unknown as Record<string, unknown>[]} emptyText="Belum ada bahan" columns={[
              { key: 'name', label: 'Bahan', width: 190, render: (r) => <Text style={font.bodyStrong} numberOfLines={1}>{String(r.name)}</Text> },
              { key: 'category', label: 'Kategori', width: 110, render: (r) => <Badge text={marketCategoryLabel[String(r.category)] ?? String(r.category)} color={colors.market} /> },
              { key: 'unit', label: 'Satuan', width: 70 },
              { key: 'ref_price', label: 'Harga acuan', width: 110, render: (r) => <Text style={font.small}>{rupiah(Number(r.ref_price))}</Text> },
              { key: 'price_source', label: 'Sumber', width: 100, render: (r) => <Badge text={SOURCE_LABEL[String(r.price_source)] ?? String(r.price_source)} color={colors.info} /> },
              { key: 'price_updated_at', label: 'Diperbarui', width: 112, render: (r) => <Text style={font.tiny}>{r.price_updated_at ? fmtDate(String(r.price_updated_at)) : '-'}</Text> },
              { key: 'active', label: 'Aktif', width: 70, render: (r) => { const i = r as unknown as MarketItem; return <Switch value={i.active !== false} onValueChange={() => toggleItem(i)} trackColor={{ true: colors.success, false: colors.border }} thumbColor="#fff" />; } },
              { key: 'actions', label: 'Aksi', width: 90, align: 'right', render: (r) => <Button size="sm" variant="outline" title="Ubah" onPress={() => editItem(r as unknown as MarketItem)} /> },
            ]} />
          </View>
        </Row>
      )}

      {tab === 'prices' && (
        <Card style={{ gap: 10 }}>
          <Text style={font.label}>Harga per pasar (survei)</Text>
          <Row gap={adminSpace.sm} style={{ flexWrap: 'wrap' }}>
            <AdminSelect label="Kota" icon="location-outline" placeholder="Semua kota" width={200} value={cityFilter} options={cityOptions} onChange={(v) => { setCityFilter(v); setPriceMarket(null); }} clearable clearLabel="Semua kota" />
            <AdminSelect label="Pasar" icon="storefront-outline" placeholder="Pilih pasar" width={260} value={priceMarket?.id ?? ''}
              options={shownMarkets.map((m) => ({ value: m.id, label: m.name, sublabel: m.address ?? undefined }))}
              onChange={(v) => setPriceMarket(shownMarkets.find((m) => m.id === v) ?? null)} />
          </Row>
          {!priceMarket ? <Text style={font.small}>Pilih pasar untuk mengisi harga hasil survei. Kosongkan baris untuk memakai acuan umum.</Text> : (<>
            <Text style={font.tiny}>{priceMarket.name} · {Object.keys(priceMeta).length} bahan sudah punya harga khusus pasar ini. Harga acuan umum ditampilkan sebagai pembanding.</Text>
            <Table rows={activeItems as unknown as Record<string, unknown>[]} emptyText="Belum ada bahan aktif" columns={[
              { key: 'name', label: 'Bahan', width: 200, render: (r) => <Text style={font.bodyStrong} numberOfLines={1}>{String(r.name)} <Text style={font.tiny}>/ {String(r.unit)}</Text></Text> },
              { key: 'ref_price', label: 'Acuan umum', width: 110, render: (r) => <Text style={font.small}>{rupiah(Number(r.ref_price))}</Text> },
              { key: 'market_price', label: 'Harga pasar ini', width: 140, render: (r) => <Input value={prices[String(r.id)] ?? ''} placeholder="Rp" keyboardType="number-pad" onChangeText={(v) => setPrices((p) => ({ ...p, [String(r.id)]: v }))} containerStyle={{ width: 120 }} /> },
              { key: 'updated', label: 'Terakhir', width: 130, render: (r) => <Text style={font.tiny}>{priceMeta[String(r.id)] ? fmtDate(priceMeta[String(r.id)]) : '-'}</Text> },
            ]} />
            <Row gap={8}>
              <Button title="Simpan harga survei" loading={busy} onPress={saveMarketPrices} />
              <Button title="Salin dari acuan umum" variant="outline" onPress={() => setPrices(Object.fromEntries(activeItems.map((i) => [i.id, prices[i.id] || String(i.ref_price)])))} />
            </Row>
          </>)}
        </Card>
      )}

      {tab === 'stats' && (
        <Card padded={false}>
          <View style={{ padding: 14, gap: 4 }}><Text style={font.label}>Acuan vs median nota driver (30 hari)</Text><Text style={font.tiny}>Median dihitung dari harga riil yang diinput driver saat menyelesaikan belanja. "Pakai median" mengganti acuan umum & mencatat sumber survei.</Text></View>
          <Table rows={stats as unknown as Record<string, unknown>[]} emptyText="Belum ada data statistik" columns={[
            { key: 'name', label: 'Bahan', width: 200, render: (r) => <Text style={font.bodyStrong} numberOfLines={1}>{String(r.name)} <Text style={font.tiny}>/ {String(r.unit)}</Text></Text> },
            { key: 'ref_price', label: 'Acuan', width: 110, render: (r) => <Text style={font.small}>{rupiah(Number(r.ref_price))}</Text> },
            { key: 'driver_median', label: 'Median nota', width: 130, render: (r) => { const s = r as unknown as MarketPriceStat; if (!s.driver_median) return <Text style={font.tiny}>-</Text>; const diff = s.ref_price ? Math.round(((s.driver_median - s.ref_price) / s.ref_price) * 100) : 0; return <View><Text style={font.small}>{rupiah(s.driver_median)}</Text><Text style={[font.tiny, { color: Math.abs(diff) >= 15 ? adminTone.red : adminTone.faint }]}>{diff > 0 ? '+' : ''}{diff}% vs acuan</Text></View>; } },
            { key: 'driver_samples', label: 'Sampel', width: 80, render: (r) => <Badge text={String(r.driver_samples ?? 0)} color={Number(r.driver_samples) >= 3 ? colors.success : colors.textMuted} /> },
            { key: 'last_seen', label: 'Terakhir', width: 130, render: (r) => <Text style={font.tiny}>{r.last_seen ? fmtDate(String(r.last_seen)) : '-'}</Text> },
            { key: 'actions', label: 'Aksi', width: 180, align: 'right', render: (r) => { const s = r as unknown as MarketPriceStat; return <Button size="sm" variant="outline" title="Pakai median sebagai acuan" disabled={!s.driver_median || s.driver_median === s.ref_price} onPress={() => applyMedian(s)} />; } },
          ]} keyField="item_id" />
        </Card>
      )}
      <WideTableHint />
    </AdminPage>
  );
}
