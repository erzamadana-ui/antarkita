import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Switch, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AdminPage } from '@/components/admin';
import { Card, Input, Button, Row, Badge, toast } from '@/components/ui';
import { Entrance } from '@/components/motion';
import { rpc, supabase } from '@/lib/supabase';
import { useAppSettingsStore } from '@/hooks/useAppSettings';
import { colors, font, radius } from '@/lib/theme';
import type { AppPublicSettings } from '@/lib/types';

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

export default function AdminSettings() {
  const [bank, setBank] = useState({ bank: '', number: '', name: '' });
  const [support, setSupport] = useState('');
  const [radiusKm, setRadiusKm] = useState('5');
  const [ratio, setRatio] = useState('2.5');
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [maxKm, setMaxKm] = useState<Record<string, string>>({});
  const [osm, setOsm] = useState({ enabled: true, radius: '5' });
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
            <View><Text style={font.h3}>Layanan aktif</Text><Text style={font.small}>Layanan nonaktif disembunyikan dari beranda pelanggan dan pesanan baru ditolak server. Berlaku langsung saat sakelar digeser.</Text></View>
            <Badge text={`${activeCount}/${SERVICES.length} aktif`} color={activeCount === SERVICES.length ? colors.success : colors.warning} />
          </Row>
          <View style={st.grid}>
            {SERVICES.map((s) => {
              const on = enabled[s.key] !== false;
              return (
                <View key={s.key} style={[st.service, !on && { backgroundColor: colors.bgSoft, borderColor: colors.border }]}>
                  <View style={[st.dot, { backgroundColor: on ? s.color : colors.textMuted }]} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[font.body, { fontWeight: '700' }, !on && { color: colors.textSecondary }]}>{s.label}</Text>
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
          <Text style={font.h3}>Batas jarak dalam kota (km)</Text>
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
          <Row between style={{ flexWrap: 'wrap', gap: 8 }}>
            <View style={{ flex: 1, minWidth: 240 }}>
              <Text style={font.h3}>Impor tempat dari peta</Text>
              <Text style={font.small}>Saat pelanggan membuka AntarShop / AntarMarket dan data toko atau pasar di sekitarnya kosong, aplikasi mengambil tempat dari OpenStreetMap dalam radius ini lalu menyimpannya (sumber "Peta"). Tinjau hasilnya di menu Data Tempat.</Text>
            </View>
            <Switch value={osm.enabled} onValueChange={(v) => saveOsm({ enabled: v })} trackColor={{ true: colors.success, false: colors.border }} thumbColor="#fff" />
          </Row>
          <Row gap={10} style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Input label="Radius impor (km)" value={osm.radius} onChangeText={(v) => setOsm((o) => ({ ...o, radius: v.replace(/[^\d.,]/g, '') }))} keyboardType="decimal-pad" containerStyle={{ width: 180 }} right={<Text style={font.tiny}>km</Text>} />
            <Button title="Simpan radius" variant="secondary" icon="save-outline" onPress={() => saveOsm({})} />
            <Row gap={6}><Ionicons name={osm.enabled ? 'cloud-download-outline' : 'cloud-offline-outline'} size={16} color={osm.enabled ? colors.success : colors.textMuted} /><Text style={font.tiny}>{osm.enabled ? 'Impor aktif' : 'Impor nonaktif'}</Text></Row>
          </Row>
        </Card>
      </Entrance>

      <Entrance index={3}>
        <Card style={{ gap: 12, maxWidth: 560 }}>
          <Text style={font.label}>Rekening top up</Text>
          <Input label="Bank" value={bank.bank} onChangeText={(v) => setBank({ ...bank, bank: v })} />
          <Input label="Nomor rekening" value={bank.number} onChangeText={(v) => setBank({ ...bank, number: v })} keyboardType="number-pad" />
          <Input label="Atas nama" value={bank.name} onChangeText={(v) => setBank({ ...bank, name: v })} />
          <Text style={[font.h3, { marginTop: 8 }]}>Operasional</Text>
          <Input label="Nomor WhatsApp CS" value={support} onChangeText={setSupport} keyboardType="phone-pad" />
          <Input label="Radius pencarian driver (km)" value={radiusKm} onChangeText={setRadiusKm} keyboardType="decimal-pad" />
          <Input label="Batas rasio rute vs garis lurus (anti-manipulasi jarak)" value={ratio} onChangeText={setRatio} keyboardType="decimal-pad" />
          <Button title="Simpan pengaturan" onPress={save} />
        </Card>
      </Entrance>
      <Entrance index={4}>
        <Card style={{ maxWidth: 560 }}>
          <Text style={font.label}>Integrasi (opsional)</Text>
          <Text style={font.small}>Google Maps: isi EXPO_PUBLIC_GOOGLE_MAPS_KEY di .env lalu build ulang — pencarian & rute otomatis beralih ke Google.{'\n'}Pembayaran otomatis (Midtrans/Xendit): lihat docs/INTEGRASI.md di repositori.</Text>
        </Card>
      </Entrance>
    </AdminPage>
  );
}

const st = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  service: { flexDirection: 'row', alignItems: 'center', gap: 10, flexGrow: 1, flexBasis: '45%', minWidth: 240, padding: 12, borderRadius: radius.md, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border },
  dot: { width: 10, height: 10, borderRadius: 5 },
});
