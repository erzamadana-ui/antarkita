import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Switch, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AdminPage, adminFont as font, adminTone, adminSpace, adminRadius, adminIcon, AdminCard as Card } from '@/components/admin';
import { Input, Button, Row, Badge, toast } from '@/components/ui';
import { Entrance } from '@/components/motion';
import { rpc, supabase } from '@/lib/supabase';
import { useAppSettingsStore } from '@/hooks/useAppSettings';
import { colors } from '@/lib/theme';
import type { AppPublicSettings, SendVehicle } from '@/lib/types';

/** Layanan yang bisa dimatikan admin (kunci = nilai p_service di admin_set_service_enabled). */
const SERVICES: { key: string; label: string; desc: string; color: string }[] = [
  { key: 'ride_motor', label: 'AntarRide (motor)', desc: 'Ojek motor dalam kota', color: colors.ride },
  { key: 'ride_car', label: 'AntarCar', desc: 'Mobil penumpang dalam kota', color: colors.car },
  { key: 'food', label: 'AntarFood', desc: 'Pesan antar makanan', color: colors.food },
  { key: 'send', label: 'AntarSend', desc: 'Kirim paket dalam & antar kota', color: colors.send },
  { key: 'shop', label: 'AntarShop', desc: 'Belanja minimarket, apotek, supermarket', color: colors.shop },
  { key: 'market', label: 'AntarMarket', desc: 'Belanja pasar tradisional', color: colors.market },
  { key: 'box', label: 'AntarBox', desc: 'Mobil box / pick up, pindahan', color: colors.box },
  { key: 'travel', label: 'AntarTravel', desc: 'Travel antar kota, carter & sopir harian', color: colors.travel },
];
/** Layanan yang punya batas jarak dalam kota (kunci app_settings max_km_<layanan>). */
const LIMITED = SERVICES.filter((s) => s.key !== 'travel');
const DEFAULT_KM: Record<string, number> = { ride_motor: 25, ride_car: 60, food: 15, send: 35, shop: 15, market: 15, box: 80 };
/** Radius sebaran order ke mitra per layanan (app_settings.pickup_radius_km). */
const DEFAULT_PICKUP: Record<string, number> = { ride_motor: 5, ride_car: 8, food: 5, send: 6, shop: 5, market: 5, box: 15, default: 5 };
const PICKUP_KEYS = [...LIMITED.map((s) => s.key), 'default'];
const PICKUP_LABEL = (k: string) => (k === 'default' ? 'Bawaan (layanan lain)' : SERVICES.find((s) => s.key === k)?.label ?? k);
/** Batas berat & ukuran titipan per jenis kendaraan (app_settings.send_limits). */
const SEND_VEHICLES: { key: SendVehicle; label: string; desc: string }[] = [
  { key: 'motor', label: 'Motor', desc: 'AntarSend dalam kota dengan sepeda motor' },
  { key: 'car', label: 'Mobil', desc: 'Paket besar / banyak, mobil penumpang' },
  { key: 'box', label: 'Box / Pick up', desc: 'AntarBox, pindahan' },
  { key: 'travel', label: 'Titipan travel', desc: 'Paket antar kota dititipkan ke mitra travel' },
];
const DEFAULT_SEND: Record<SendVehicle, { max_kg: number; max_cm: number }> = {
  motor: { max_kg: 20, max_cm: 60 }, car: { max_kg: 150, max_cm: 160 }, box: { max_kg: 1000, max_cm: 300 }, travel: { max_kg: 30, max_cm: 120 },
};

export default function AdminSettings() {
  const [bank, setBank] = useState({ bank: '', number: '', name: '' });
  const [support, setSupport] = useState('');
  const [radiusKm, setRadiusKm] = useState('5');
  const [ratio, setRatio] = useState('2.5');
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [maxKm, setMaxKm] = useState<Record<string, string>>({});
  const [osm, setOsm] = useState({ enabled: true, radius: '5' });
  const [pickup, setPickup] = useState<Record<string, string>>({});
  const [sendLim, setSendLim] = useState<Record<string, { kg: string; cm: string }>>({});
  const [busyService, setBusyService] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [{ data }, pub] = await Promise.all([
      supabase.from('app_settings').select('*'),
      rpc<AppPublicSettings | null>('app_public_settings').catch((e: Error) => { toast.error(e.message); return null; }),
    ]);
    (data as { key: string; value: unknown }[] | null)?.forEach((r) => {
      if (r.key === 'bank_account') setBank(r.value as typeof bank);
      if (r.key === 'support_phone') setSupport(String(r.value));
      if (r.key === 'search_radius_km') setRadiusKm(String(r.value));
      if (r.key === 'max_route_ratio') setRatio(String(r.value));
    });
    if (pub) {
      setEnabled(Object.fromEntries(SERVICES.map((s) => [s.key, pub.services_enabled?.[s.key] !== false])));
      setMaxKm(Object.fromEntries(LIMITED.map((s) => [s.key, String(pub.max_km?.[s.key] ?? DEFAULT_KM[s.key])])));
      setOsm({ enabled: pub.osm_import_enabled !== false, radius: String(pub.osm_import_radius_km ?? 5) });
      setPickup(Object.fromEntries(PICKUP_KEYS.map((k) => [k, String(pub.pickup_radius_km?.[k] ?? DEFAULT_PICKUP[k])])));
      setSendLim(Object.fromEntries(SEND_VEHICLES.map((v) => {
        const l = pub.send_limits?.[v.key] ?? DEFAULT_SEND[v.key];
        return [v.key, { kg: String(l?.max_kg ?? DEFAULT_SEND[v.key].max_kg), cm: String(l?.max_cm ?? DEFAULT_SEND[v.key].max_cm) }];
      })));
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  const refreshPublic = () => useAppSettingsStore.getState().load(true);

  const save = async () => {
    const rows = [
      { key: 'bank_account', value: bank }, { key: 'support_phone', value: support },
      { key: 'search_radius_km', value: Number(radiusKm) || 5 }, { key: 'max_route_ratio', value: Number(ratio) || 2.5 },
    ].map((r) => ({ ...r, updated_at: new Date().toISOString() }));
    const { error } = await supabase.from('app_settings').upsert(rows);
    if (error) return toast.error(error.message);
    toast.success('Pengaturan disimpan');
  };
  const toggleService = async (key: string, on: boolean) => {
    const label = SERVICES.find((s) => s.key === key)?.label ?? key;
    setBusyService(key); setEnabled((e) => ({ ...e, [key]: on }));
    try {
      const v = await rpc<Record<string, boolean>>('admin_set_service_enabled', { p_service: key, p_enabled: on });
      if (v) setEnabled(Object.fromEntries(SERVICES.map((s) => [s.key, v[s.key] !== false])));
      toast.success(on ? `${label} diaktifkan` : `${label} dinonaktifkan — disembunyikan dari beranda`); refreshPublic();
    } catch (e) { setEnabled((st) => ({ ...st, [key]: !on })); toast.error((e as Error).message); }
    finally { setBusyService(null); }
  };
  const saveLimits = async () => {
    const p: Record<string, number> = {};
    for (const s of LIMITED) {
      const n = Number(String(maxKm[s.key] ?? '').replace(',', '.'));
      if (!Number.isFinite(n) || n <= 0) return toast.error(`Batas jarak ${s.label} harus angka lebih dari 0`);
      p[`max_km_${s.key}`] = n;
    }
    try { await rpc('admin_set_settings', { p }); toast.success('Batas jarak dalam kota disimpan'); refreshPublic(); load(); }
    catch (e) { toast.error((e as Error).message); }
  };
  const num = (v: string) => Number(String(v ?? '').replace(',', '.'));
  const savePickup = async () => {
    const p: Record<string, number> = {};
    for (const k of PICKUP_KEYS) {
      const n = num(pickup[k]);
      if (!Number.isFinite(n) || n <= 0 || n > 100) return toast.error(`Radius ${PICKUP_LABEL(k)} harus antara 0,1 dan 100 km`);
      p[k] = n;
    }
    try { await rpc('admin_set_settings', { p: { pickup_radius_km: p } }); toast.success('Radius terima order disimpan — berlaku untuk order baru'); refreshPublic(); load(); }
    catch (e) { toast.error((e as Error).message); }
  };
  const saveSendLimits = async () => {
    const p: Partial<Record<SendVehicle, { max_kg: number; max_cm: number }>> = {};
    for (const v of SEND_VEHICLES) {
      const kg = num(sendLim[v.key]?.kg), cm = num(sendLim[v.key]?.cm);
      if (!Number.isFinite(kg) || kg <= 0) return toast.error(`Batas berat ${v.label} harus angka lebih dari 0`);
      if (!Number.isFinite(cm) || cm <= 0) return toast.error(`Batas ukuran ${v.label} harus angka lebih dari 0`);
      p[v.key] = { max_kg: kg, max_cm: cm };
    }
    const order = SEND_VEHICLES.map((v) => v.key);
    for (let i = 1; i < order.length - 1; i++) {
      if ((p[order[i]]?.max_kg ?? 0) < (p[order[i - 1]]?.max_kg ?? 0)) return toast.error(`Batas berat ${SEND_VEHICLES[i].label} tidak boleh lebih kecil dari ${SEND_VEHICLES[i - 1].label} — pemilihan kendaraan otomatis akan salah`);
    }
    try { await rpc('admin_set_settings', { p: { send_limits: p } }); toast.success('Batas berat & ukuran disimpan'); refreshPublic(); load(); }
    catch (e) { toast.error((e as Error).message); }
  };
  const saveOsm = async (patch: Partial<typeof osm>) => {
    const next = { ...osm, ...patch };
    const r = Number(String(next.radius).replace(',', '.'));
    if (!Number.isFinite(r) || r <= 0 || r > 50) return toast.error('Radius impor 1-50 km');
    setOsm(next);
    try { await rpc('admin_set_settings', { p: { osm_import_enabled: next.enabled, osm_import_radius_km: r } }); toast.success(next.enabled ? `Impor tempat dari peta aktif (radius ${r} km)` : 'Impor tempat dari peta dinonaktifkan'); refreshPublic(); }
    catch (e) { toast.error((e as Error).message); load(); }
  };
  const activeCount = SERVICES.filter((s) => enabled[s.key] !== false).length;

  return (
    <AdminPage title="Pengaturan" subtitle="Konfigurasi umum aplikasi, layanan aktif, batas jarak & impor data tempat" onRefresh={load}>
      <Entrance index={0}>
        <Card style={{ gap: 12 }}>
          <Row between style={{ flexWrap: 'wrap', gap: 8 }}>
            <View style={{ flex: 1, minWidth: 260 }}><Text style={font.h2}>Layanan aktif</Text><Text style={font.small}>Layanan nonaktif disembunyikan dari beranda pelanggan dan pesanan baru ditolak server. Berlaku langsung saat sakelar digeser.</Text></View>
            <Badge text={`${activeCount}/${SERVICES.length} aktif`} color={activeCount === SERVICES.length ? colors.success : colors.warning} />
          </Row>
          <View style={st.grid}>
            {SERVICES.map((s) => {
              const on = enabled[s.key] !== false;
              return (
                <View key={s.key} style={[st.service, !on && { backgroundColor: colors.bgSoft, borderColor: colors.border }]}>
                  <View style={[st.dot, { backgroundColor: on ? s.color : colors.textMuted }]} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[font.bodyStrong, !on && { color: adminTone.muted }]} numberOfLines={1}>{s.label}</Text>
                    <Text style={font.tiny} numberOfLines={1}>{on ? s.desc : 'Nonaktif — tersembunyi di beranda'}</Text>
                  </View>
                  <Switch value={on} disabled={busyService === s.key} onValueChange={(v) => toggleService(s.key, v)} trackColor={{ true: colors.success, false: colors.border }} thumbColor="#fff" />
                </View>
              );
            })}
          </View>
        </Card>
      </Entrance>

      <Entrance index={1}>
        <Card style={{ gap: 12 }}>
          <Text style={font.h2}>Batas jarak dalam kota (km)</Text>
          <Text style={font.small}>Pesanan dengan jarak di atas batas ditolak dan pelanggan diarahkan ke AntarTravel (penumpang) atau AntarSend antar kota (paket). AntarTravel tidak dibatasi.</Text>
          <View style={st.grid}>
            {LIMITED.map((s) => (
              <Input key={s.key} label={s.label} value={maxKm[s.key] ?? ''} onChangeText={(v) => setMaxKm((m) => ({ ...m, [s.key]: v.replace(/[^\d.,]/g, '') }))} keyboardType="decimal-pad" placeholder={String(DEFAULT_KM[s.key])} containerStyle={{ flexGrow: 1, minWidth: 150, flexBasis: '30%' }}
                right={<Text style={font.tiny}>km</Text>} />
            ))}
          </View>
          <Row between style={{ flexWrap: 'wrap', gap: 8 }}>
            <Text style={font.tiny}>Bawaan: motor 25 · mobil 60 · food 15 · send 35 · shop 15 · market 15 · box 80 km.</Text>
            <Button title="Simpan batas jarak" icon="save-outline" onPress={saveLimits} />
          </Row>
        </Card>
      </Entrance>

      <Entrance index={2}>
        <Card style={{ gap: 12 }}>
          <Text style={font.h2}>Radius terima order per layanan (km)</Text>
          <Text style={font.small}>Jarak maksimum antara mitra dan titik jemput agar order ikut disebar ke mitra tersebut. Terlalu kecil = order lama tidak dapat driver; terlalu besar = driver jauh ikut ditawari.</Text>
          <View style={st.grid}>
            {PICKUP_KEYS.map((k) => (
              <Input key={k} label={PICKUP_LABEL(k)} value={pickup[k] ?? ''} onChangeText={(v) => setPickup((m) => ({ ...m, [k]: v.replace(/[^\d.,]/g, '') }))} keyboardType="decimal-pad" placeholder={String(DEFAULT_PICKUP[k])} containerStyle={{ flexGrow: 1, minWidth: 150, flexBasis: '30%' }} right={<Text style={font.tiny}>km</Text>} />
            ))}
          </View>
          <Row between style={{ flexWrap: 'wrap', gap: 8 }}>
            <Text style={font.tiny}>Bawaan: motor 5 · mobil 8 · food 5 · send 6 · shop 5 · market 5 · box 15 km.</Text>
            <Button title="Simpan radius terima order" icon="save-outline" onPress={savePickup} />
          </Row>
        </Card>
      </Entrance>

      <Entrance index={3}>
        <Card style={{ gap: 12 }}>
          <Text style={font.h2}>Batas berat & ukuran titipan</Text>
          <Text style={font.small}>Dipakai server untuk memilih kendaraan AntarSend secara otomatis dan menolak paket yang terlalu besar. Urutkan menaik: motor ≤ mobil ≤ box.</Text>
          <View style={st.grid}>
            {SEND_VEHICLES.map((v) => (
              <View key={v.key} style={st.limitCard}>
                <Text style={font.bodyStrong} numberOfLines={1}>{v.label}</Text>
                <Text style={font.tiny} numberOfLines={2}>{v.desc}</Text>
                <Row gap={8} style={{ marginTop: 6 }}>
                  <Input label="Berat maks." value={sendLim[v.key]?.kg ?? ''} onChangeText={(x) => setSendLim((m) => ({ ...m, [v.key]: { kg: x.replace(/[^\d.,]/g, ''), cm: m[v.key]?.cm ?? '' } }))} keyboardType="decimal-pad" placeholder={String(DEFAULT_SEND[v.key].max_kg)} containerStyle={{ flex: 1 }} right={<Text style={font.tiny}>kg</Text>} />
                  <Input label="Sisi terpanjang" value={sendLim[v.key]?.cm ?? ''} onChangeText={(x) => setSendLim((m) => ({ ...m, [v.key]: { kg: m[v.key]?.kg ?? '', cm: x.replace(/[^\d.,]/g, '') } }))} keyboardType="decimal-pad" placeholder={String(DEFAULT_SEND[v.key].max_cm)} containerStyle={{ flex: 1 }} right={<Text style={font.tiny}>cm</Text>} />
                </Row>
              </View>
            ))}
          </View>
          <Row between style={{ flexWrap: 'wrap', gap: 8 }}>
            <Text style={font.tiny}>Bawaan: motor 20 kg/60 cm · mobil 150 kg/160 cm · box 1.000 kg/300 cm · travel 30 kg/120 cm.</Text>
            <Button title="Simpan batas berat & ukuran" icon="save-outline" onPress={saveSendLimits} />
          </Row>
        </Card>
      </Entrance>

      <Entrance index={4}>
        <Card style={{ gap: 12 }}>
          <Row between style={{ flexWrap: 'wrap', gap: 8 }}>
            <View style={{ flex: 1, minWidth: 240 }}>
              <Text style={font.h2}>Impor tempat dari peta</Text>
              <Text style={font.small}>Saat pelanggan membuka AntarShop / AntarMarket dan data toko atau pasar di sekitarnya kosong, aplikasi mengambil tempat dari OpenStreetMap dalam radius ini lalu menyimpannya (sumber "Peta"). Tinjau hasilnya di menu Data Tempat.</Text>
            </View>
            <Switch value={osm.enabled} onValueChange={(v) => saveOsm({ enabled: v })} trackColor={{ true: colors.success, false: colors.border }} thumbColor="#fff" />
          </Row>
          <Row gap={10} style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Input label="Radius impor (km)" value={osm.radius} onChangeText={(v) => setOsm((o) => ({ ...o, radius: v.replace(/[^\d.,]/g, '') }))} keyboardType="decimal-pad" containerStyle={{ width: 180 }} right={<Text style={font.tiny}>km</Text>} />
            <Button title="Simpan radius" variant="secondary" icon="save-outline" onPress={() => saveOsm({})} />
            <Row gap={6}><Ionicons name={osm.enabled ? 'cloud-download-outline' : 'cloud-offline-outline'} size={adminIcon.md} color={osm.enabled ? colors.success : adminTone.faint} /><Text style={font.tiny}>{osm.enabled ? 'Impor aktif' : 'Impor nonaktif'}</Text></Row>
          </Row>
        </Card>
      </Entrance>

      <Entrance index={5}>
        <Card style={{ gap: 12, maxWidth: 560 }}>
          <Text style={font.label}>Rekening top up</Text>
          <Input label="Bank" value={bank.bank} onChangeText={(v) => setBank({ ...bank, bank: v })} />
          <Input label="Nomor rekening" value={bank.number} onChangeText={(v) => setBank({ ...bank, number: v })} keyboardType="number-pad" />
          <Input label="Atas nama" value={bank.name} onChangeText={(v) => setBank({ ...bank, name: v })} />
          <Text style={[font.h2, { marginTop: 8 }]}>Operasional</Text>
          <Input label="Nomor WhatsApp CS" value={support} onChangeText={setSupport} keyboardType="phone-pad" />
          <Input label="Radius pencarian driver (km)" value={radiusKm} onChangeText={setRadiusKm} keyboardType="decimal-pad" />
          <Input label="Batas rasio rute vs garis lurus (anti-manipulasi jarak)" value={ratio} onChangeText={setRatio} keyboardType="decimal-pad" />
          <Button title="Simpan pengaturan" onPress={save} />
        </Card>
      </Entrance>
      <Entrance index={6}>
        <Card style={{ maxWidth: 560 }}>
          <Text style={font.label}>Integrasi (opsional)</Text>
          <Text style={font.small}>Google Maps: isi EXPO_PUBLIC_GOOGLE_MAPS_KEY di .env lalu build ulang — pencarian & rute otomatis beralih ke Google.{'\n'}Pembayaran otomatis (Midtrans/Xendit): lihat docs/INTEGRASI.md di repositori.</Text>
        </Card>
      </Entrance>
    </AdminPage>
  );
}

const st = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: adminSpace.md },
  service: { flexDirection: 'row', alignItems: 'center', gap: 10, flexGrow: 1, flexBasis: '45%', minWidth: 240, minHeight: 56, padding: adminSpace.md, borderRadius: adminRadius.card, backgroundColor: adminTone.surface, borderWidth: 1, borderColor: adminTone.border },
  dot: { width: 10, height: 10, borderRadius: 5 },
  limitCard: { flexGrow: 1, flexBasis: '45%', minWidth: 260, padding: adminSpace.md, borderRadius: adminRadius.card, backgroundColor: adminTone.surface, borderWidth: 1, borderColor: adminTone.border },
});
