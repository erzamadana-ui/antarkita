// Admin · Kota, Gudang Mitra (AntarSend antar kota), Rute & Permintaan AntarTravel (mitra travel: halaman Mitra Travel)
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Switch, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AdminPage, Table, FilterBar, AdminSelect, adminFont as font, adminTone, adminSpace, adminIcon, AdminCard as Card } from '@/components/admin';
import { Row, Input, Button, Badge, toast } from '@/components/ui';
import { rpc, supabase } from '@/lib/supabase';
import { colors } from '@/lib/theme';
import { rupiah, formatDate, formatSchedule, cityName, travelRequestStatusLabel, travelKindLabel } from '@/lib/format';
import type { City, Warehouse, IntercityRate, TravelRoute, AdminTravelRequestRow, TravelRequestStatus } from '@/lib/types';

const REQ_STATUSES: TravelRequestStatus[] = ['open', 'offered', 'accepted', 'paid', 'ongoing', 'completed', 'cancelled', 'expired'];
const REQ_COLOR: Record<string, string> = { open: colors.warning, offered: colors.info, accepted: colors.travel, paid: colors.travel, ongoing: colors.primary, completed: colors.success, cancelled: colors.danger, expired: colors.textMuted };

const emptyWh = { name: '', type: 'small', partner_name: '', address: '', lat: '', lng: '', phone: '', open_hours: '08:00-20:00', city_id: '' };
const emptyRoute = { from_city: '', to_city: '', distance_km: '', duration_h: '', seat_price: '', private_price: '', private_price_large: '', min_pax: '4' };

export default function AdminLogistics() {
  const router = useRouter();
  const [tab, setTab] = useState<'warehouse' | 'rates' | 'travel'>('warehouse');
  const [cities, setCities] = useState<City[]>([]);
  const [whs, setWhs] = useState<Warehouse[]>([]);
  const [rates, setRates] = useState<IntercityRate[]>([]);
  const [routes, setRoutes] = useState<TravelRoute[]>([]);
  const [wh, setWh] = useState({ ...emptyWh });
  const [rt, setRt] = useState({ ...emptyRoute });
  const [newCity, setNewCity] = useState({ name: '', province: '', lat: '', lng: '' });
  const [reqs, setReqs] = useState<AdminTravelRequestRow[]>([]);
  const [reqStatus, setReqStatus] = useState<string>('all');
  const load = useCallback(async () => {
    const [{ data: c }, { data: w }, { data: r }, { data: tr }, rq] = await Promise.all([
      supabase.from('cities').select('*').order('name'), supabase.from('warehouses').select('*').order('name'),
      supabase.from('intercity_rates').select('*'), supabase.from('travel_routes').select('*'),
      rpc<AdminTravelRequestRow[]>('admin_travel_requests', { p_status: null }).catch(() => [] as AdminTravelRequestRow[]),
    ]);
    setCities((c as City[]) ?? []); setWhs((w as Warehouse[]) ?? []); setRates((r as IntercityRate[]) ?? []); setRoutes((tr as TravelRoute[]) ?? []); setReqs(rq ?? []);
  }, []);
  const filteredReqs = reqStatus === 'all' ? reqs : reqs.filter((q) => q.status === reqStatus);
  // Pilihan kota dipakai bersama oleh form gudang & rute travel (dropdown, bukan deret chip).
  const cityOptions = cities.map((c) => ({ value: c.id, label: c.name, sublabel: c.province ?? undefined }));
  useEffect(() => { load(); }, [load]);

  const saveWh = async () => {
    if (!wh.city_id || wh.name.length < 3) return toast.error('Pilih kota & isi nama gudang');
    const lat = Number(wh.lat), lng = Number(wh.lng);
    const { error } = await supabase.from('warehouses').insert({ city_id: wh.city_id, name: wh.name, type: wh.type, partner_name: wh.partner_name || null, address: wh.address || null, phone: wh.phone || null, open_hours: wh.open_hours || null, location: lat && lng ? `POINT(${lng} ${lat})` : null });
    if (error) return toast.error(error.message);
    toast.success('Gudang mitra ditambahkan'); setWh({ ...emptyWh }); load();
  };
  const toggleWh = async (w: Warehouse) => { await supabase.from('warehouses').update({ active: !w.active }).eq('id', w.id); load(); };
  const saveCity = async () => {
    if (newCity.name.length < 3) return toast.error('Nama kota minimal 3 huruf');
    const lat = Number(newCity.lat), lng = Number(newCity.lng);
    const { error } = await supabase.from('cities').insert({ name: newCity.name, province: newCity.province || null, location: lat && lng ? `POINT(${lng} ${lat})` : null });
    if (error) return toast.error(error.message);
    toast.success('Kota ditambahkan'); setNewCity({ name: '', province: '', lat: '', lng: '' }); load();
  };
  const saveRate = async (r: IntercityRate, patch: Partial<IntercityRate>) => { const { error } = await supabase.from('intercity_rates').update(patch).eq('id', r.id); if (error) toast.error(error.message); else load(); };
  const saveRoute = async () => {
    if (!rt.from_city || !rt.to_city || rt.from_city === rt.to_city) return toast.error('Pilih kota asal & tujuan berbeda');
    if (!Number(rt.seat_price) || !Number(rt.private_price)) return toast.error('Isi harga kursi & private');
    const { error } = await supabase.from('travel_routes').upsert({ from_city: rt.from_city, to_city: rt.to_city, distance_km: Number(rt.distance_km) || 0, duration_h: Number(rt.duration_h) || 0, seat_price: Number(rt.seat_price), private_price: Number(rt.private_price), private_price_large: Number(rt.private_price_large) || null, min_pax: Number(rt.min_pax) || 4, active: true }, { onConflict: 'from_city,to_city' });
    if (error) return toast.error(error.message);
    toast.success('Rute travel disimpan'); setRt({ ...emptyRoute }); load();
  };
  const toggleRoute = async (r: TravelRoute) => { await supabase.from('travel_routes').update({ active: !r.active }).eq('id', r.id); load(); };

  return (
    <AdminPage title="Logistik & Travel" subtitle="Kota layanan, gudang mitra AntarSend antar kota, tarif antar kota, rute & permintaan AntarTravel" onRefresh={load}>
      <FilterBar value={tab} onChange={(v) => setTab(v as never)} options={[{ key: 'warehouse', label: `Kota & Gudang (${whs.length})` }, { key: 'rates', label: 'Tarif antar kota' }, { key: 'travel', label: `AntarTravel (${routes.length} rute · ${reqs.length} permintaan)` }]} />

      {tab === 'warehouse' && (<>
        <Row gap={16} style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <Card style={{ flex: 1, minWidth: 320, gap: 10 }}>
            <Text style={font.label}>Tambah gudang mitra / drop point</Text>
            <Row gap={adminSpace.sm} style={{ flexWrap: 'wrap' }}>
              <AdminSelect label="Kota layanan" icon="location-outline" placeholder="Pilih kota" value={wh.city_id} options={cityOptions} onChange={(v) => setWh({ ...wh, city_id: v })} width={200} />
              <AdminSelect label="Jenis gudang" icon="cube-outline" value={wh.type} width={220}
                options={[{ value: 'big', label: 'Gudang besar' }, { value: 'small', label: 'Gudang kecil (mitra warehouse)' }]} onChange={(v) => setWh({ ...wh, type: v })} />
            </Row>
            <Input placeholder="Nama gudang / drop point" value={wh.name} onChangeText={(v) => setWh({ ...wh, name: v })} />
            <Input placeholder="Nama mitra / pemilik" value={wh.partner_name} onChangeText={(v) => setWh({ ...wh, partner_name: v })} />
            <Input placeholder="Alamat" value={wh.address} onChangeText={(v) => setWh({ ...wh, address: v })} />
            <Row gap={8}><Input placeholder="Lat" value={wh.lat} onChangeText={(v) => setWh({ ...wh, lat: v })} containerStyle={{ flex: 1 }} /><Input placeholder="Lng" value={wh.lng} onChangeText={(v) => setWh({ ...wh, lng: v })} containerStyle={{ flex: 1 }} /><Input placeholder="Jam buka" value={wh.open_hours} onChangeText={(v) => setWh({ ...wh, open_hours: v })} containerStyle={{ flex: 1 }} /></Row>
            <Input placeholder="Telepon" value={wh.phone} onChangeText={(v) => setWh({ ...wh, phone: v })} />
            <Button title="Simpan gudang" onPress={saveWh} />
          </Card>
          <Card style={{ flex: 1, minWidth: 280, gap: 10 }}>
            <Text style={font.label}>Tambah kota layanan</Text>
            <Input placeholder="Nama kota" value={newCity.name} onChangeText={(v) => setNewCity({ ...newCity, name: v })} />
            <Input placeholder="Provinsi" value={newCity.province} onChangeText={(v) => setNewCity({ ...newCity, province: v })} />
            <Row gap={8}><Input placeholder="Lat pusat kota" value={newCity.lat} onChangeText={(v) => setNewCity({ ...newCity, lat: v })} containerStyle={{ flex: 1 }} /><Input placeholder="Lng" value={newCity.lng} onChangeText={(v) => setNewCity({ ...newCity, lng: v })} containerStyle={{ flex: 1 }} /></Row>
            <Button title="Tambah kota" variant="secondary" onPress={saveCity} />
            <Text style={font.tiny}>Kota dipakai untuk kota asal pesanan (tren trafik), gudang antar kota, dan rute travel. Setelah menambah kota, tambahkan gudang dan tarif antar kota (tab Tarif) serta rute travel (tab AntarTravel).</Text>
          </Card>
        </Row>
        <Table rows={whs as unknown as Record<string, unknown>[]} columns={[
          { key: 'name', label: 'Gudang', width: 240, render: (r) => { const w = r as unknown as Warehouse; return <View style={{ minWidth: 0 }}><Text style={font.bodyStrong} numberOfLines={1}>{w.name}</Text><Text style={font.tiny} numberOfLines={2}>{w.address}</Text></View>; } },
          { key: 'city', label: 'Kota', width: 110, render: (r) => <Text style={font.small}>{cityName(cities, String(r.city_id))}</Text> },
          { key: 'type', label: 'Jenis', width: 120, render: (r) => <Badge text={r.type === 'big' ? 'Gudang besar' : 'Gudang kecil'} color={r.type === 'big' ? colors.send : colors.info} /> },
          { key: 'partner', label: 'Mitra', width: 170, render: (r) => { const w = r as unknown as Warehouse; return <Text style={font.small}>{w.partner_name ?? '—'}{'\n'}{w.phone ?? ''}</Text>; } },
          { key: 'open', label: 'Jam', width: 100, render: (r) => <Text style={font.tiny}>{String(r.open_hours ?? '')}</Text> },
          { key: 'active', label: 'Aktif', width: 80, render: (r) => { const w = r as unknown as Warehouse; return <Switch value={w.active} onValueChange={() => toggleWh(w)} trackColor={{ true: colors.success, false: colors.border }} thumbColor="#fff" />; } },
        ]} />
      </>)}

      {tab === 'rates' && (
        <Card padded={false}>
          <View style={{ padding: 14 }}><Text style={font.label}>Tarif antar kota (base + per kg, ETA hari)</Text><Text style={font.tiny}>Ketuk angka untuk mengubah, tersimpan otomatis.</Text></View>
          <Table rows={rates as unknown as Record<string, unknown>[]} columns={[
            { key: 'route', label: 'Rute', width: 220, render: (r) => <Text style={font.bodyStrong} numberOfLines={1}>{cityName(cities, String(r.from_city))} → {cityName(cities, String(r.to_city))}</Text> },
            { key: 'base_fare', label: 'Tarif dasar', width: 130, render: (r) => <Input value={String(r.base_fare)} keyboardType="number-pad" onChangeText={(v) => saveRate(r as unknown as IntercityRate, { base_fare: Number(v) || 0 })} containerStyle={{ width: 110 }} /> },
            { key: 'per_kg', label: 'Per kg', width: 120, render: (r) => <Input value={String(r.per_kg)} keyboardType="number-pad" onChangeText={(v) => saveRate(r as unknown as IntercityRate, { per_kg: Number(v) || 0 })} containerStyle={{ width: 100 }} /> },
            { key: 'eta_days', label: 'ETA (hari)', width: 100, render: (r) => <Input value={String(r.eta_days)} keyboardType="number-pad" onChangeText={(v) => saveRate(r as unknown as IntercityRate, { eta_days: Number(v) || 1 })} containerStyle={{ width: 70 }} /> },
            { key: 'active', label: 'Aktif', width: 80, render: (r) => <Switch value={!!r.active} onValueChange={(v) => saveRate(r as unknown as IntercityRate, { active: v })} trackColor={{ true: colors.success, false: colors.border }} thumbColor="#fff" /> },
          ]} />
        </Card>
      )}

      {tab === 'travel' && (<>
        <Card style={{ gap: 10 }}>
          <Text style={font.label}>Rute travel (harga per kursi · carter private Innova · carter Hi-Ace · minimum penumpang)</Text>
          <Row gap={adminSpace.sm} style={{ flexWrap: 'wrap' }}>
            <AdminSelect label="Kota asal" icon="navigate-outline" placeholder="Pilih kota" value={rt.from_city} options={cityOptions} onChange={(v) => setRt({ ...rt, from_city: v })} width={200} />
            <AdminSelect label="Kota tujuan" icon="flag-outline" placeholder="Pilih kota" value={rt.to_city} options={cityOptions} onChange={(v) => setRt({ ...rt, to_city: v })} width={200} />
          </Row>
          <Row gap={8} style={{ flexWrap: 'wrap' }}>
            <Input placeholder="Jarak km" value={rt.distance_km} onChangeText={(v) => setRt({ ...rt, distance_km: v })} containerStyle={{ width: 100 }} />
            <Input placeholder="Durasi jam" value={rt.duration_h} onChangeText={(v) => setRt({ ...rt, duration_h: v })} containerStyle={{ width: 100 }} />
            <Input placeholder="Harga/kursi" value={rt.seat_price} onChangeText={(v) => setRt({ ...rt, seat_price: v })} containerStyle={{ width: 120 }} keyboardType="number-pad" />
            <Input placeholder="Private Innova" value={rt.private_price} onChangeText={(v) => setRt({ ...rt, private_price: v })} containerStyle={{ width: 130 }} keyboardType="number-pad" />
            <Input placeholder="Private Hi-Ace" value={rt.private_price_large} onChangeText={(v) => setRt({ ...rt, private_price_large: v })} containerStyle={{ width: 130 }} keyboardType="number-pad" />
            <Input placeholder="Min pax" value={rt.min_pax} onChangeText={(v) => setRt({ ...rt, min_pax: v })} containerStyle={{ width: 80 }} keyboardType="number-pad" />
            <Button title="Simpan rute" onPress={saveRoute} />
          </Row>
          <Text style={font.tiny}>Acuan 2026: kursi Padang–Pekanbaru Rp120–250rb, carter Hi-Ace ±Rp2,5 jt (citratrans.com, rentalmobilterdekat.com, jasasewamobilpekanbaru.com). Minimum penumpang 4 = asumsi praktik umum; ubah per rute bila perlu.</Text>
        </Card>
        <Table rows={routes as unknown as Record<string, unknown>[]} columns={[
          { key: 'route', label: 'Rute', width: 220, render: (r) => <Text style={font.bodyStrong} numberOfLines={1}>{cityName(cities, String(r.from_city))} → {cityName(cities, String(r.to_city))}</Text> },
          { key: 'dist', label: 'Jarak / durasi', width: 130, render: (r) => <Text style={font.small}>{String(r.distance_km)} km · {String(r.duration_h)} jam</Text> },
          { key: 'seat_price', label: 'Per kursi', width: 110, render: (r) => <Text style={font.small}>{rupiah(Number(r.seat_price))}</Text> },
          { key: 'private', label: 'Private (Innova / Hi-Ace)', width: 200, render: (r) => <Text style={font.small}>{rupiah(Number(r.private_price))} / {r.private_price_large ? rupiah(Number(r.private_price_large)) : '—'}</Text> },
          { key: 'min_pax', label: 'Min pax', width: 80, render: (r) => <Badge text={String(r.min_pax)} /> },
          { key: 'active', label: 'Aktif', width: 80, render: (r) => <Switch value={!!r.active} onValueChange={() => toggleRoute(r as unknown as TravelRoute)} trackColor={{ true: colors.success, false: colors.border }} thumbColor="#fff" /> },
        ]} />
        <Card style={{ gap: 6 }}>
          <Row between style={{ flexWrap: 'wrap', gap: 8 }}>
            <Row gap={10} style={{ flex: 1, minWidth: 240 }}>
              <Ionicons name="bus-outline" size={adminIcon.lg} color={colors.travel} />
              <Text style={[font.small, { flex: 1, color: adminTone.ink }]}>Verifikasi, penangguhan, dokumen & statistik mitra travel (agen dan sopir pribadi) kini dikelola di halaman terpisah.</Text>
            </Row>
            <Pressable onPress={() => router.push('/(admin)/travel' as never)} hitSlop={6}><Text style={[font.h3, { color: colors.travel }]}>Kelola mitra travel →</Text></Pressable>
          </Row>
        </Card>
        <Card padded={false}>
          <View style={{ padding: 14, gap: 8 }}>
            <Text style={font.label}>Permintaan travel (carter & sopir harian) · {reqs.length}</Text>
            <AdminSelect label="Saring status" icon="filter-outline" value={reqStatus} width={240} onChange={setReqStatus}
              options={[{ value: 'all', label: `Semua (${reqs.length})` }, ...REQ_STATUSES.map((st) => ({ value: st, label: `${travelRequestStatusLabel[st] ?? st} (${reqs.filter((q) => q.status === st).length})` }))]} />
          </View>
          <Table rows={filteredReqs as unknown as Record<string, unknown>[]} emptyText="Belum ada permintaan travel" columns={[
            { key: 'code', label: 'Kode', width: 120, render: (r) => { const q = r as unknown as AdminTravelRequestRow; return <View style={{ minWidth: 0 }}><Text style={font.bodyStrong} numberOfLines={1}>{q.code}</Text><Text style={font.tiny}>{formatDate(q.created_at, false)}</Text></View>; } },
            { key: 'kind', label: 'Jenis', width: 110, render: (r) => <Badge text={travelKindLabel[String(r.kind)] ?? String(r.kind)} color={colors.travel} /> },
            { key: 'status', label: 'Status', width: 150, render: (r) => <Badge text={travelRequestStatusLabel[String(r.status)] ?? String(r.status)} color={REQ_COLOR[String(r.status)] ?? colors.textMuted} /> },
            { key: 'customer_name', label: 'Pelanggan', width: 140, render: (r) => <Text style={font.small}>{String(r.customer_name ?? '—')}</Text> },
            { key: 'partner_name', label: 'Mitra', width: 140, render: (r) => <Text style={font.small}>{String(r.partner_name ?? '—')}</Text> },
            { key: 'route', label: 'Jemput → tujuan', width: 240, render: (r) => { const q = r as unknown as AdminTravelRequestRow; return <Text style={font.tiny} numberOfLines={2}>{q.pickup_address} → {q.dropoff_address ?? 'sesuai kebutuhan'}</Text>; } },
            { key: 'depart_at', label: 'Jadwal', width: 150, render: (r) => <Text style={font.tiny}>{formatSchedule(String(r.depart_at))}</Text> },
            { key: 'days', label: 'Hari / pax', width: 90, render: (r) => <Text style={font.small}>{String(r.days)} hari · {String(r.pax)} org</Text> },
            { key: 'price', label: 'Harga', width: 110, render: (r) => <Text style={font.small}>{Number(r.price) ? rupiah(Number(r.price)) : '—'}</Text> },
            { key: 'platform_fee', label: 'Fee platform', width: 110, render: (r) => <Text style={font.small}>{Number(r.platform_fee) ? rupiah(Number(r.platform_fee)) : '—'}</Text> },
            { key: 'payment_status', label: 'Pembayaran', width: 110, render: (r) => <Badge text={r.payment_status === 'paid' ? 'Dibayar' : r.payment_status === 'refunded' ? 'Dikembalikan' : 'Belum bayar'} color={r.payment_status === 'paid' ? colors.success : r.payment_status === 'refunded' ? colors.info : colors.warning} /> },
            { key: 'offers_count', label: 'Penawaran', width: 90, render: (r) => <Badge text={String(r.offers_count ?? 0)} /> },
          ]} />
        </Card>
      </>)}
    </AdminPage>
  );
}

