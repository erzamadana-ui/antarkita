// AntarMarket — belanja ke pasar tradisional: harga acuan hari ini, driver kirim foto nota & harga riil; pelanggan bayar harga riil + jasa belanja.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TextInput, ScrollView, Image, ActivityIndicator, Alert, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Screen, Card, Row, Button, Badge, Input, Chip, Empty, Stepper, toast } from '@/components/ui';
import { Entrance, PressableScale, Skeleton } from '@/components/motion';
import { PaymentSection, PriceSummary, paidViaOf, handleShortfall, type PayChoice } from '@/components/BookingSheet';
import { AntarNowSection, useAntarNowCode } from '@/components/antarnow';
import { usePayPrefs } from '@/store/payprefs';
import { useBooking } from '@/store/booking';
import { useAuth } from '@/store/auth';
import { useCurrentLocation } from '@/hooks/useLocation';
import { useAppSettings } from '@/hooks/useAppSettings';
import { LimitNotice, LimitInfo, ServiceDisabledEmpty, limitBlocked } from '@/components/ServiceLimit';
import { CityNotice, cityBlockedLabel } from '@/components/city';
import { useCityStatus } from '@/hooks/useCityStatus';
import { getRoute, reverseGeocode, finalizeRoute, type RouteResult } from '@/lib/geo';
import { importOsmPlaces } from '@/lib/osm';
import { rpc, friendlyError } from '@/lib/supabase';
import { colors, font, radius, shadow } from '@/lib/theme';
import { ServiceIllustration } from '@/components/ServiceArt';
import { rupiah, km, minutes, marketCategoryLabel } from '@/lib/format';
import type { Market, MarketItem, MarketVendorItem, Order, ShoppingEstimate, VendorCatalogEntry, VendorGrade } from '@/lib/types';

type Vehicle = 'motor' | 'car';
type Line = { qty: number; note: string };
type VendorLine = MarketVendorItem & { vendor_id: string; vendor_name: string; stall_no: string | null };

const GRADE: Record<VendorGrade, { label: string; color: string; desc: string }> = {
  A: { label: 'Grade A', color: colors.success, desc: 'kualitas terbaik' },
  B: { label: 'Grade B', color: colors.primary, desc: 'kualitas standar' },
  C: { label: 'Grade C', color: colors.textMuted, desc: 'ekonomis' },
};
const qualityColor = (n: number) => (n >= 85 ? colors.success : n >= 70 ? colors.primary : colors.warning);

const priceSourceLabel = (source: string, samples?: number) =>
  source === 'pasar' ? 'survei pasar' : source === 'nota_driver' ? `nota driver (${samples ?? 0})` : 'acuan admin';
const fmtQty = (n: number) => String(Math.round(n * 100) / 100).replace('.', ',');
const isFromMap = (m: Market) => (m.notes ?? '').startsWith('Sumber: OpenStreetMap');
// Impor otomatis dari peta: satu kali per sesi untuk tiap lokasi (dibulatkan ~100 m)
const autoImported = new Set<string>();
const locKey = (lat: number, lng: number) => `${lat.toFixed(3)},${lng.toFixed(3)}`;

export default function MarketScreen() {
  const router = useRouter();
  const { dropoff, setDropoff } = useBooking();
  const { location, hasFix } = useCurrentLocation();
  const { status: city, blocked: cityBlockedFor } = useCityStatus(hasFix ? location : null);
  const refreshWallet = useAuth((s) => s.refreshWallet);
  const payPrefs = usePayPrefs((st) => st.prefs);
  const { settings, isEnabled } = useAppSettings();

  const [markets, setMarkets] = useState<Market[]>([]);
  const [loadingMarkets, setLoadingMarkets] = useState(true);
  const [marketsTick, setMarketsTick] = useState(0);
  const [importing, setImporting] = useState(false);
  const [market, setMarket] = useState<Market | null>(null);
  // Kegagalan jaringan dulu tampil sebagai daftar pasar kosong tanpa penjelasan.
  const [marketsError, setMarketsError] = useState<string | null>(null);
  const [items, setItems] = useState<MarketItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [vendors, setVendors] = useState<VendorCatalogEntry[]>([]);
  const [loadingVendors, setLoadingVendors] = useState(false);
  const [vendorOpen, setVendorOpen] = useState<string | null>(null);
  const [cat, setCat] = useState('all');
  const [q, setQ] = useState('');
  const [gridW, setGridW] = useState(0);
  const [lines, setLines] = useState<Record<string, Line>>({});
  const [noteOpen, setNoteOpen] = useState<string | null>(null);
  const [vehicle, setVehicle] = useState<Vehicle>('motor');
  const vehicleManual = useRef(false);
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [est, setEst] = useState<ShoppingEstimate | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [method, setMethod] = useState<PayChoice>('wallet');
  const [promo, setPromo] = useState(''); const [discount, setDiscount] = useState(0); const [notes, setNotes] = useState('');
  const [ordering, setOrdering] = useState(false);

  useEffect(() => {
    if (!dropoff && hasFix) reverseGeocode(location).then((address) => { if (!useBooking.getState().dropoff) setDropoff({ ...location, address, name: 'Lokasi saya' }); });
  }, [hasFix]); // eslint-disable-line react-hooks/exhaustive-deps

  // Impor pasar dari OpenStreetMap (manual lewat tombol, atau otomatis saat daftar sepi)
  const importFromMap = async (silent = false) => {
    if (importing) return;
    setImporting(true);
    const r = await importOsmPlaces('market', location.lat, location.lng, settings?.osm_import_radius_km ?? 5);
    setImporting(false);
    if (r.inserted > 0) { toast.success(`${r.inserted} pasar baru ditemukan dari peta`); setMarketsTick((n) => n + 1); }
    else if (!silent) toast.show(r.fetched > 0 ? 'Semua pasar di peta sekitar Anda sudah ada di daftar' : 'Tidak ada pasar baru di peta sekitar Anda');
  };

  // pasar terdekat
  useEffect(() => {
    let cancelled = false;
    setLoadingMarkets(true);
    rpc<Market[]>('nearby_markets', { p_lat: location.lat, p_lng: location.lng, p_radius_km: 25 })
      .then((r) => {
        if (cancelled) return;
        const list = r ?? []; setMarkets(list); setMarketsError(null); setMarket((m) => m ?? list[0] ?? null);
        const key = locKey(location.lat, location.lng);
        if (list.length < 5 && settings?.osm_import_enabled !== false && !autoImported.has(key)) { autoImported.add(key); importFromMap(true); }
      })
      .catch((e: Error) => { if (!cancelled) { setMarkets([]); setMarketsError(friendlyError(e.message)); } })
      .finally(() => { if (!cancelled) setLoadingMarkets(false); });
    return () => { cancelled = true; };
  }, [location.lat, location.lng, marketsTick]); // eslint-disable-line react-hooks/exhaustive-deps

  // katalog bahan pasar terpilih
  useEffect(() => {
    if (!market) { setItems([]); return; }
    let cancelled = false;
    setLoadingItems(true);
    rpc<MarketItem[]>('market_catalog', { p_market: market.id })
      .then((r) => { if (!cancelled) setItems(r ?? []); })
      .catch((e: Error) => { if (!cancelled) { setItems([]); toast.error(e.message); } })
      .finally(() => { if (!cancelled) setLoadingItems(false); });
    return () => { cancelled = true; };
  }, [market?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // pedagang terverifikasi di pasar terpilih
  useEffect(() => {
    if (!market) { setVendors([]); setVendorOpen(null); return; }
    let cancelled = false;
    setLoadingVendors(true);
    rpc<VendorCatalogEntry[]>('market_vendor_catalog', { p_market: market.id })
      .then((r) => { if (!cancelled) { const list = r ?? []; setVendors(list); setVendorOpen(list[0]?.id ?? null); } })
      .catch(() => { if (!cancelled) setVendors([]); })
      .finally(() => { if (!cancelled) setLoadingVendors(false); });
    return () => { cancelled = true; };
  }, [market?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const vendorItems = useMemo<VendorLine[]>(() => vendors.flatMap((v) => v.items.map((it) => ({ ...it, vendor_id: v.id, vendor_name: v.stall_name, stall_no: v.stall_no }))), [vendors]);
  const categories = useMemo(() => Array.from(new Set(items.map((i) => i.category))), [items]);
  const ql = q.trim().toLowerCase();
  const shown = items.filter((i) => (cat === 'all' || i.category === cat) && (!ql || i.name.toLowerCase().includes(ql)));
  const chosen = items.filter((i) => (lines[i.id]?.qty ?? 0) > 0);
  const chosenVendor = vendorItems.filter((i) => (lines[i.id]?.qty ?? 0) > 0);
  const chosenCount = chosen.length + chosenVendor.length;
  const subtotal = chosen.reduce((a, i) => a + i.price * (lines[i.id]?.qty ?? 0), 0) + chosenVendor.reduce((a, i) => a + i.price * (lines[i.id]?.qty ?? 0), 0);
  /** Ganti pasar. Daftar belanja terikat pada katalog pasar, jadi harus dikosongkan —
   *  konfirmasi dulu bila pengguna sudah memilih bahan agar tidak hilang tanpa sengaja. */
  const changeMarket = () => {
    const reset = () => { setMarket(null); setLines({}); setCat('all'); setNoteOpen(null); };
    if (Object.keys(lines).length === 0) return reset();
    if (Platform.OS === 'web') { if (window.confirm('Ganti pasar? Daftar belanja yang sudah dipilih akan dikosongkan.')) reset(); return; }
    Alert.alert('Ganti pasar?', 'Daftar belanja yang sudah dipilih akan dikosongkan.', [{ text: 'Batal', style: 'cancel' }, { text: 'Ganti', style: 'destructive', onPress: reset }]);
  };

  const setQty = (id: string, qty: number) => setLines((l) => {
    const v = Math.max(0, Math.min(50, Math.round(qty * 2) / 2));
    if (v <= 0) { const { [id]: _drop, ...rest } = l; return rest; }
    return { ...l, [id]: { qty: v, note: l[id]?.note ?? '' } };
  });
  const setNote = (id: string, note: string) => setLines((l) => (l[id] ? { ...l, [id]: { ...l[id], note } } : l));

  useEffect(() => {
    if (!market || !dropoff) { setRoute(null); return; }
    let cancelled = false;
    getRoute(market, dropoff).then((r) => { if (!cancelled) setRoute(r); }).catch(() => { if (!cancelled) setRoute(null); });
    return () => { cancelled = true; };
  }, [market?.lat, market?.lng, dropoff?.lat, dropoff?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!market || !dropoff) { setEst(null); setEstimating(false); return; }
    let cancelled = false;
    setEstimating(true);
    const t = setTimeout(async () => {
      const r = await rpc<ShoppingEstimate>('shopping_estimate', { p_service: 'market', p_pickup_lat: market.lat, p_pickup_lng: market.lng, p_drop_lat: dropoff.lat, p_drop_lng: dropoff.lng, p_subtotal: Math.round(subtotal), p_vehicle: vehicle, p_route_km: route?.distance_km ?? null }).catch(() => null);
      if (cancelled) return;
      setEst(r); setEstimating(false);
      if (r && !vehicleManual.current) setVehicle(subtotal >= r.car_min_budget ? 'car' : 'motor');
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [market?.lat, market?.lng, dropoff?.lat, dropoff?.lng, subtotal, vehicle, route?.distance_km]); // eslint-disable-line react-hooks/exhaustive-deps

  const total = est ? Math.max(0, est.fare + est.platform_fee + est.service_fee - discount) + subtotal : 0;
  const blocked = limitBlocked(est?.limit);
  const serviceOff = est?.service_enabled === false || !isEnabled('market');
  // Gerbang wilayah — daftar pasar & harga acuan tetap bisa ditelusuri di kota mana pun.
  const cityBlocked = cityBlockedFor('market');
  const ready = !!market && !!dropoff && !!est && chosenCount > 0 && !blocked && !cityBlocked;
  const pickVehicle = (v: Vehicle) => { vehicleManual.current = true; setVehicle(v); };

  // AntarNow (Tahap 11): kode driver yang sudah divalidasi & cocok dengan layanan ini (null bila tidak dipakai)
  const driverCode = useAntarNowCode('market');
  const order = async () => {
    if (!market || !dropoff || !est || chosenCount === 0 || blocked || cityBlocked) return;
    setOrdering(true);
    try {
      // Hemat §5.3: rute sungguhan (GEOMETRI saja) baru diambil DI SINI. Jarak/durasi
      // tetap angka pratinjau yang menjadi dasar harga yang ditampilkan.
      const fin = await finalizeRoute({ lat: market.lat, lng: market.lng }, dropoff, route);
      const o = await rpc<Order>('create_order', { p: {
        service: 'market', market_id: market.id, dropoff: { lat: dropoff.lat, lng: dropoff.lng, address: dropoff.address },
        route_km: fin.route_km, duration_min: fin.duration_min, route_geometry: fin.coords,
        payment_method: method === 'ewallet' ? 'wallet' : method, paid_via: paidViaOf(method, payPrefs?.ewallet), promo_code: promo || null, notes: notes || null, shop_vehicle: vehicle,
        shopping_list: [
          ...chosen.map((i) => ({ item_id: i.id, name: i.name, qty: lines[i.id]?.qty ?? 1, note: lines[i.id]?.note?.trim() || null })),
          ...chosenVendor.map((i) => ({ item_id: i.item_id ?? null, vendor_item_id: i.id, vendor_id: i.vendor_id, vendor_name: i.vendor_name, grade: i.grade, name: i.name, unit: i.unit, price: i.price, qty: lines[i.id]?.qty ?? 1, note: [`Lapak ${i.vendor_name}${i.stall_no ? ` no. ${i.stall_no}` : ''} · grade ${i.grade}`, lines[i.id]?.note?.trim()].filter(Boolean).join(' · ') })),
        ],
        driver_code: driverCode,
      } });
      await refreshWallet(); useBooking.getState().reset();
      router.replace(`/order/${o.id}` as never);
    } catch (e) { if (!handleShortfall(e, router, payPrefs?.ewallet)) toast.error((e as Error).message); }
    setOrdering(false);
  };

  const colW = gridW ? Math.floor((gridW - 12) / 2) : 160;
  const footer = serviceOff ? undefined : (
    <View style={{ gap: 8 }}>
      <LimitNotice limit={est?.limit} />
      <Row between gap={10}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={font.tiny} numberOfLines={2}>Perkiraan total · disesuaikan nota</Text>
          <Text style={[font.h1, { color: colors.primary }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{ready && !estimating ? rupiah(total) : chosenCount ? 'Menghitung…' : rupiah(0)}</Text>
        </View>
        <Badge text="Dana ditahan · sisa kembali" color={colors.primary} style={{ flexShrink: 0 }} />
      </Row>
      <Button title={cityBlocked ? cityBlockedLabel(city, 'market') : blocked ? 'Pasar di luar jangkauan' : chosenCount === 0 ? 'Pilih bahan belanja dulu' : 'Pesan ke pasar'} size="lg" disabled={!ready || ordering} loading={ordering} onPress={order} />
    </View>
  );

  return (
    <Screen title="AntarMarket" subtitle="Pasar tradisional · harga riil saat dibeli" band={colors.market} back ambient={false} bottomSpace={24} footer={footer}>
      {serviceOff ? <ServiceDisabledEmpty onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))} /> : (
      <View style={{ gap: 14 }}>
        {/* Kota belum dilayani: pasar tetap boleh ditelusuri, hanya pesanan yang dikunci. */}
        <CityNotice status={city} service="market" />
        <Entrance index={0}>
          <View style={{ gap: 8 }}>
            <Row between>
              <Text style={font.h3}>{market ? 'Pasar dipilih' : 'Pasar terdekat'}</Text>
              {!market && (
                <Row gap={8}>
                  {!loadingMarkets && <Text style={font.tiny}>{markets.length} pasar</Text>}
                  <PressableScale haptic={false} hitSlop={6} disabled={importing} accessibilityRole="button" accessibilityLabel="Cari pasar dari peta" onPress={() => importFromMap(false)} style={s.mapBtn}>
                    {importing ? <ActivityIndicator size="small" color={colors.primary} /> : <Ionicons name="refresh" size={13} color={colors.primary} />}
                    <Text style={{ fontSize: 12, fontWeight: '700', color: colors.primary }}>{importing ? 'Mencari di peta…' : 'Cari dari peta'}</Text>
                  </PressableScale>
                </Row>
              )}
            </Row>
            {loadingMarkets ? [0, 1].map((i) => <View key={i} style={s.marketRow}><Skeleton width={64} height={64} radius={16} /><View style={{ flex: 1, gap: 6 }}><Skeleton width="60%" height={14} /><Skeleton width="40%" height={12} /></View></View>)
              : marketsError ? <Empty icon="cloud-offline-outline" title="Gagal memuat pasar" subtitle={marketsError} action={<Button title="Coba lagi" size="sm" icon="refresh" onPress={() => setMarketsTick((n) => n + 1)} />} />
              : markets.length === 0 ? <Text style={font.small}>{importing ? 'Mencari pasar dari peta di sekitar Anda…' : 'Belum ada pasar mitra di sekitar lokasi Anda.'}</Text>
              : (market ? [market] : markets).map((m, i) => {
                const active = market?.id === m.id;
                return (
                  <Entrance key={m.id} index={i}>
                    <PressableScale onPress={() => { if (!active) { setMarket(m); setLines({}); setCat('all'); } }} scaleTo={active ? 1 : 0.985} haptic={false} accessibilityRole="button" accessibilityLabel={active ? `Pasar terpilih: ${m.name}` : `Pilih ${m.name}`} style={[s.marketRow, active && { borderColor: colors.primary }]}>
                      {m.image_url ? <Image source={{ uri: m.image_url }} style={s.marketImg} /> : <View style={[s.marketImg, { alignItems: 'center', justifyContent: 'center' }]}><ServiceIllustration kind="market" size={40} /></View>}
                      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                        <Text style={[font.body, { fontWeight: '700' }]} numberOfLines={2}>{m.name}</Text>
                        <Row gap={4}><Badge text={m.is_open_now === false ? 'Tutup' : 'Buka'} color={m.is_open_now === false ? colors.danger : colors.success} /><Text style={[font.tiny, { flex: 1 }]} numberOfLines={1}>{km(m.distance_km)}{m.address ? ` · ${m.address}` : ''}</Text></Row>
                        {active ? <Text style={font.tiny} numberOfLines={1}>{m.open_hours ? `${m.open_hours}` : 'Jam buka menyesuaikan pasar'}{route ? ` · ${minutes(route.duration_min)} ke alamat` : ''}</Text> : null}
                        {isFromMap(m) && <Badge text="Dari peta" color={colors.primary} />}
                      </View>
                      {active ? <Button title="Ganti" size="sm" variant="secondary" onPress={changeMarket} /> : <View style={s.rowArrow}><Ionicons name="arrow-forward" size={16} color={colors.primary} /></View>}
                    </PressableScale>
                  </Entrance>
                );
              })}
            {!loadingMarkets && !market && importing && markets.length > 0 && <Row gap={8} style={{ paddingHorizontal: 4 }}><ActivityIndicator size="small" color={colors.primary} /><Text style={font.tiny}>Mencari pasar lain dari peta di sekitar Anda…</Text></Row>}
          </View>
        </Entrance>

        <Entrance index={1}>
          <View style={s.info}>
            <View style={s.infoIcon}><Ionicons name="information-circle-outline" size={20} color={colors.primary} /></View>
            <Text style={[font.small, { flex: 1, color: colors.text }]}>Harga di bawah adalah acuan hari ini. Driver mengirim foto nota & harga riil; kamu hanya bayar harga riil + jasa belanja.</Text>
          </View>
        </Entrance>

        <Entrance index={2}><Input icon="search" placeholder="Cari bahan (mis. cabai, ayam, bawang)" value={q} onChangeText={setQ} /></Entrance>
        {categories.length > 1 && (
          <Entrance index={3}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              <Chip label="Semua" active={cat === 'all'} onPress={() => setCat('all')} />
              {categories.map((c) => <Chip key={c} label={marketCategoryLabel[c] ?? c} active={cat === c} onPress={() => setCat(c)} />)}
            </ScrollView>
          </Entrance>
        )}

        {/* Daftar bahan — grid 2 kolom */}
        <View style={{ gap: 10 }}>
          <Row between><Text style={font.h3}>Bahan belanja</Text>{chosenCount > 0 && <Badge text={`${chosenCount} dipilih`} color={colors.primary} />}</Row>
          <View onLayout={(e) => setGridW(e.nativeEvent.layout.width)} style={s.grid}>
            {loadingItems ? [0, 1, 2, 3].map((i) => <View key={i} style={[s.tile, { width: colW }]}><Skeleton width="100%" height={100} radius={18} /><Skeleton width="70%" height={14} /><Skeleton width="50%" height={12} /></View>)
              : !market ? <View style={{ width: '100%' }}><Empty icon="basket-outline" title="Pilih pasar dulu" subtitle="Katalog bahan mengikuti pasar yang dipilih." /></View>
              : shown.length === 0 ? <View style={{ width: '100%' }}><Empty icon="leaf-outline" title="Bahan tidak ditemukan" subtitle={ql ? `Tidak ada "${q}" di katalog pasar ini.` : 'Katalog pasar ini masih kosong.'} /></View>
              : shown.map((it) => {
                const line = lines[it.id];
                const qty = line?.qty ?? 0;
                const isKg = it.unit.toLowerCase() === 'kg';
                return (
                  <View key={it.id} style={[s.tile, { width: colW }, qty > 0 && { borderColor: colors.primary }]}>
                    <View style={s.tileArt}>
                      {it.image_url ? <Image source={{ uri: it.image_url }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : <ServiceIllustration kind="market" size={52} />}
                      {qty > 0 && <View style={s.qtyPill}><Text style={{ color: '#fff', fontSize: 12, fontWeight: '800' }}>{fmtQty(qty)} {it.unit}</Text></View>}
                    </View>
                    <View style={{ paddingHorizontal: 4, gap: 2 }}>
                      <Text style={[font.small, { color: colors.text, fontWeight: '700', minHeight: 36 }]} numberOfLines={2}>{it.name}</Text>
                      <Text style={font.tiny} numberOfLines={1}>per {it.unit} · {priceSourceLabel(it.price_source, it.samples)}</Text>
                      <Row between style={{ marginTop: 4, flexWrap: 'wrap', rowGap: 6 }}>
                        <Text style={{ fontWeight: '800', color: colors.primary, fontSize: 15 }} numberOfLines={1}>±{rupiah(it.price)}</Text>
                        {qty === 0 && <PressableScale haptic={false} onPress={() => setQty(it.id, qty + 1)} scaleTo={0.88} hitSlop={8} style={s.addBtn} accessibilityRole="button" accessibilityLabel="Tambah"><Ionicons name="add" size={20} color="#fff" /></PressableScale>}
                      </Row>
                      {qty > 0 && (
                        <Row between style={{ marginTop: 6, flexWrap: 'wrap', rowGap: 6 }}>
                          <Row gap={6} style={{ flexShrink: 1 }}>
                            <PressableScale haptic={false} hitSlop={10} accessibilityRole="button" accessibilityLabel="Kurangi satu" onPress={() => setQty(it.id, qty - 1)} style={s.miniBtn}><Ionicons name="remove" size={14} color={colors.primary} /></PressableScale>
                            <Text style={{ fontWeight: '800', color: colors.text, minWidth: 24, textAlign: 'center', fontSize: 13 }}>{fmtQty(qty)}</Text>
                            <PressableScale haptic={false} hitSlop={10} onPress={() => setQty(it.id, qty + 1)} style={[s.miniBtn, { backgroundColor: colors.primary, borderColor: colors.primary }]} accessibilityRole="button" accessibilityLabel="Tambah satu"><Ionicons name="add" size={14} color="#fff" /></PressableScale>
                            {isKg && <PressableScale haptic={false} hitSlop={10} accessibilityRole="button" accessibilityLabel="Tambah setengah" onPress={() => setQty(it.id, qty + 0.5)} style={s.halfBtn}><Text style={{ fontWeight: '800', color: colors.primary, fontSize: 12 }}>+½</Text></PressableScale>}
                          </Row>
                          <PressableScale haptic={false} hitSlop={6} onPress={() => setNoteOpen((n) => (n === it.id ? null : it.id))}><Ionicons name={line?.note ? 'chatbox-ellipses' : 'chatbox-ellipses-outline'} size={18} color={line?.note ? colors.primary : colors.textMuted} /></PressableScale>
                        </Row>
                      )}
                      {qty > 0 && <Text style={[font.tiny, { color: colors.text, fontWeight: '700' }]}>Subtotal ±{rupiah(it.price * qty)}</Text>}
                      {qty > 0 && noteOpen === it.id && (
                        <TextInput placeholder="Catatan (mis. yang merah)" placeholderTextColor={colors.textMuted} value={line?.note ?? ''} onChangeText={(v) => setNote(it.id, v)} style={s.noteInput} />
                      )}
                    </View>
                  </View>
                );
              })}
          </View>
        </View>

        {/* Pedagang terverifikasi */}
        {market && (
          <View style={{ gap: 10 }}>
            <Row between><Text style={font.h3}>Pedagang terverifikasi</Text>{vendors.length > 0 && <Text style={font.tiny}>{vendors.length} lapak</Text>}</Row>
            {loadingVendors ? <View style={s.vendorCard}><Row gap={12}><Skeleton width={48} height={48} radius={24} /><View style={{ flex: 1, gap: 6 }}><Skeleton width="60%" height={14} /><Skeleton width="40%" height={12} /></View></Row></View>
              : vendors.length === 0 ? <Text style={font.tiny}>Belum ada pedagang terverifikasi di pasar ini.</Text>
              : vendors.map((v, vi) => {
                const open = vendorOpen === v.id;
                const picked = v.items.filter((it) => (lines[it.id]?.qty ?? 0) > 0).length;
                return (
                  <Entrance key={v.id} index={Math.min(vi, 5)}>
                    <View style={[s.vendorCard, picked > 0 && { borderColor: colors.primary }]}>
                      <PressableScale onPress={() => setVendorOpen(open ? null : v.id)} scaleTo={0.99} haptic={false} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                        {v.photo_url ? <Image source={{ uri: v.photo_url }} style={s.vendorImg} /> : <View style={[s.vendorImg, { alignItems: 'center', justifyContent: 'center' }]}><Ionicons name="storefront-outline" size={22} color={colors.primary} /></View>}
                        <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                          <Row gap={6}><Text style={[font.body, { fontWeight: '700', flexShrink: 1 }]} numberOfLines={1}>{v.stall_name}</Text>{v.stall_no ? <Text style={font.tiny}>No. {v.stall_no}</Text> : null}</Row>
                          <Row gap={6} style={{ flexWrap: 'wrap' }}>
                            <Badge text={`Kualitas ${Math.round(v.quality_score)}`} color={qualityColor(v.quality_score)} />
                            <Row gap={3}><Ionicons name="star" size={12} color={colors.accent} /><Text style={font.tiny}>{v.rating_count > 0 ? `${Number(v.rating_avg).toFixed(1)} (${v.rating_count})` : 'Belum ada ulasan'}</Text></Row>
                            <Text style={font.tiny}>{v.items.length} barang{picked ? ` · ${picked} dipilih` : ''}</Text>
                          </Row>
                        </View>
                        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} />
                      </PressableScale>
                      {open && (
                        <View style={{ gap: 8, marginTop: 10 }}>
                          {v.items.length === 0 && <Text style={font.tiny}>Lapak ini belum mengisi daftar barang.</Text>}
                          {v.items.map((it) => {
                            const qty = lines[it.id]?.qty ?? 0;
                            const g = GRADE[it.grade] ?? GRADE.B;
                            const ref = it.ref_price ?? null;
                            const diff = ref ? Math.round(((it.price - ref) / ref) * 100) : null;
                            const out = !it.in_stock;
                            return (
                              <View key={it.id} style={[s.vendorItem, out && { opacity: 0.55 }, qty > 0 && { borderColor: colors.primary }]}>
                                <Row gap={10} style={{ alignItems: 'flex-start' }}>
                                  {it.photo_url ? <Image source={{ uri: it.photo_url }} style={s.vendorThumb} /> : <View style={[s.vendorThumb, { alignItems: 'center', justifyContent: 'center' }]}><ServiceIllustration kind="market" size={26} /></View>}
                                  <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                                    <Row gap={6}><Text style={[font.small, { color: colors.text, fontWeight: '700', flexShrink: 1 }]} numberOfLines={1}>{it.name}</Text><Badge text={it.grade} color={g.color} /></Row>
                                    <Text style={font.tiny} numberOfLines={1}>{g.label} · {g.desc}{it.origin ? ` · asal ${it.origin}` : ''}{out ? ' · stok habis' : ''}</Text>
                                    <Row gap={6} style={{ flexWrap: 'wrap' }}>
                                      <Text style={{ fontWeight: '800', color: colors.primary, fontSize: 14 }}>{rupiah(it.price)}<Text style={font.tiny}> /{it.unit}</Text></Text>
                                      {ref ? <Text style={[font.tiny, { color: diff != null && diff > 0 ? colors.warning : diff != null && diff < 0 ? colors.success : colors.textMuted }]}>acuan {rupiah(ref)}{diff ? ` (${diff > 0 ? '+' : ''}${diff}%)` : ' (sama)'}</Text> : null}
                                    </Row>
                                  </View>
                                  {out ? null : qty > 0 ? <Stepper value={qty} onChange={(n) => setQty(it.id, n)} min={0} max={50} />
                                    : <PressableScale haptic={false} hitSlop={8} onPress={() => setQty(it.id, 1)} scaleTo={0.88} style={s.addBtn} accessibilityRole="button" accessibilityLabel="Tambah ke daftar belanja"><Ionicons name="add" size={20} color="#fff" /></PressableScale>}
                                </Row>
                                {qty > 0 && (
                                  <Row between style={{ marginTop: 6 }}>
                                    <Text style={[font.tiny, { color: colors.text, fontWeight: '700' }]}>Subtotal {rupiah(it.price * qty)}</Text>
                                    <PressableScale haptic={false} hitSlop={6} onPress={() => setNoteOpen((n) => (n === it.id ? null : it.id))}><Ionicons name={lines[it.id]?.note ? 'chatbox-ellipses' : 'chatbox-ellipses-outline'} size={18} color={lines[it.id]?.note ? colors.primary : colors.textMuted} /></PressableScale>
                                  </Row>
                                )}
                                {qty > 0 && noteOpen === it.id && <TextInput placeholder="Catatan untuk pedagang" placeholderTextColor={colors.textMuted} value={lines[it.id]?.note ?? ''} onChangeText={(val) => setNote(it.id, val)} style={s.noteInput} />}
                              </View>
                            );
                          })}
                        </View>
                      )}
                    </View>
                  </Entrance>
                );
              })}
            {vendors.length > 0 && <Text style={font.tiny}>Barang pedagang terverifikasi dibeli driver langsung di lapak tersebut; harga sudah ditetapkan pedagang (bukan acuan).</Text>}
          </View>
        )}

        {/* Alamat antar */}
        <Card solid style={{ gap: 10 }}>
          <Text style={font.label}>Antar ke</Text>
          <Row gap={10}>
            <View style={[s.infoIcon, { backgroundColor: colors.dangerLight }]}><Ionicons name="location-outline" size={20} color={colors.danger} /></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontWeight: '700', color: colors.text }} numberOfLines={1}>{dropoff?.name ?? 'Alamat pengantaran'}</Text>
              <Text style={font.tiny} numberOfLines={2}>{dropoff?.address ?? 'Menentukan lokasi Anda…'}</Text>
            </View>
            <Button title="Ganti" size="sm" variant="secondary" onPress={() => router.push({ pathname: '/place-picker', params: { target: 'dropoff', title: 'Alamat pengantaran' } } as never)} />
          </Row>
          {route && <Row gap={8}><Badge text={`${km(route.distance_km)} · ${minutes(route.duration_min)}`} color={colors.info} /></Row>}
        </Card>

        {/* Kendaraan */}
        <Card solid style={{ gap: 10 }}>
          <Text style={font.label}>Kendaraan driver</Text>
          <Row gap={8}>
            <Chip label={`Motor${est ? ` · ${rupiah(est.fare_motor)}` : ' · ≤10 kg'}`} active={vehicle === 'motor'} onPress={() => pickVehicle('motor')} />
            <Chip label={`Mobil${est ? ` · ${rupiah(est.fare_car)}` : ' · belanja besar'}`} active={vehicle === 'car'} onPress={() => pickVehicle('car')} />
          </Row>
          {est && subtotal >= est.car_min_budget && <Text style={[font.tiny, { color: vehicle === 'car' ? colors.textMuted : colors.warning }]}>Belanja di atas {rupiah(est.car_min_budget)} disarankan memakai mobil agar muat dan aman.</Text>}
        </Card>

        {/* Rincian & pembayaran */}
        {market && dropoff && (
          <Card solid style={{ gap: 8 }}>
            {est ? <PriceSummary rows={[{ label: 'Belanja (acuan)', value: subtotal }, { label: 'Jasa belanja driver', value: est.service_fee }, { label: `Ongkir ${vehicle === 'car' ? 'mobil' : 'motor'} (${km(est.distance_km)})`, value: est.fare }, { label: 'Biaya layanan', value: est.platform_fee }, { label: 'Diskon promo', value: discount, minus: true }]} total={total} />
              : <View style={{ gap: 8 }}><Skeleton width="60%" height={14} /><Skeleton width="40%" height={14} /><Skeleton width="70%" height={14} /></View>}
            {est ? <LimitInfo limit={est.limit} service="market" /> : null}
            <Text style={font.tiny}>Dana yang ditahan = acuan + cadangan 10%. Setelah driver mengirim nota, total disesuaikan dengan harga riil dan sisanya dikembalikan ke AntarPay.</Text>
          </Card>
        )}
        <Card solid>
          <AntarNowSection service="market" accent={colors.market} />
          <PaymentSection method={method} onMethod={setMethod} promo={promo} onPromo={setPromo} notes={notes} onNotes={setNotes} subtotal={est?.fare ?? 0} service="market" onDiscount={setDiscount} notesPlaceholder="Catatan untuk driver (mis. pilih yang segar, lapak langganan)" />
        </Card>
      </View>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  marketRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 20, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, ...shadow.soft },
  marketImg: { width: 64, height: 64, borderRadius: 16, backgroundColor: colors.tint },
  rowArrow: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.tint },
  info: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: radius.lg, backgroundColor: colors.tint, borderWidth: 1, borderColor: colors.primaryLight },
  infoIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tile: { gap: 8, padding: 8, borderRadius: 22, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, ...shadow.soft },
  tileArt: { height: 100, borderRadius: 18, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  qtyPill: { position: 'absolute', left: 8, top: 8, backgroundColor: colors.primary, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.full },
  addBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  miniBtn: { width: 28, height: 28, borderRadius: 14, borderWidth: 1.5, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  halfBtn: { height: 28, paddingHorizontal: 8, borderRadius: 14, borderWidth: 1.5, borderColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  noteInput: { height: 40, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgSoft, paddingHorizontal: 12, color: colors.text, fontSize: 13, marginTop: 6 },
  mapBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, height: 28, borderRadius: 14, backgroundColor: colors.tint, borderWidth: 1, borderColor: colors.primaryLight },
  vendorCard: { padding: 12, borderRadius: 20, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, ...shadow.soft },
  vendorImg: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.tint },
  vendorItem: { padding: 10, borderRadius: 16, backgroundColor: colors.bgSoft, borderWidth: 1, borderColor: colors.border },
  vendorThumb: { width: 44, height: 44, borderRadius: 12, backgroundColor: colors.tint },
});
