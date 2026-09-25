import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Switch, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AdminPage, AdminSelect, RequirePerm, adminFont as font, adminTone, adminSpace, adminRadius, adminIcon, AdminCard as Card } from '@/components/admin';
import { useAdminSecurity } from '@/store/adminSecurity';
import { handleSettingsError, useAdminCan } from '@/lib/admin';
import { ErrorNote } from './_shared';
import { Input, Button, Row, Badge, toast } from '@/components/ui';
import { Entrance } from '@/components/motion';
import { rpc, supabase } from '@/lib/supabase';
import { useAppSettingsStore } from '@/hooks/useAppSettings';
import { colors } from '@/lib/theme';
import type { AdminBusinessSettings, AppPublicSettings, SendVehicle } from '@/lib/types';

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
  const router = useRouter();
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
  const canSave = useAdminCan()('settings');

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
    // v3: tulis app_settings HANYA lewat admin_set_settings (validasi + log); grant tulis langsung dicabut.
    const p = { bank_account: bank, support_phone: support, search_radius_km: Number(radiusKm) || 5, max_route_ratio: Number(ratio) || 2.5 };
    if (!(await useAdminSecurity.getState().ensureUnlocked())) return;
    try { await rpc('admin_set_settings', { p }); toast.success('Pengaturan disimpan & tercatat di log'); refreshPublic(); }
    catch (e) { handleSettingsError(e); }
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
    if (!(await useAdminSecurity.getState().ensureUnlocked())) return;
    try { await rpc('admin_set_settings', { p }); toast.success('Batas jarak dalam kota disimpan'); refreshPublic(); load(); }
    catch (e) { handleSettingsError(e); }
  };
  const num = (v: string) => Number(String(v ?? '').replace(',', '.'));
  const savePickup = async () => {
    const p: Record<string, number> = {};
    for (const k of PICKUP_KEYS) {
      const n = num(pickup[k]);
      if (!Number.isFinite(n) || n <= 0 || n > 100) return toast.error(`Radius ${PICKUP_LABEL(k)} harus antara 0,1 dan 100 km`);
      p[k] = n;
    }
    if (!(await useAdminSecurity.getState().ensureUnlocked())) return;
    try { await rpc('admin_set_settings', { p: { pickup_radius_km: p } }); toast.success('Radius terima order disimpan — berlaku untuk order baru'); refreshPublic(); load(); }
    catch (e) { handleSettingsError(e); }
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
    if (!(await useAdminSecurity.getState().ensureUnlocked())) return;
    try { await rpc('admin_set_settings', { p: { send_limits: p } }); toast.success('Batas berat & ukuran disimpan'); refreshPublic(); load(); }
    catch (e) { handleSettingsError(e); }
  };
  const saveOsm = async (patch: Partial<typeof osm>) => {
    const next = { ...osm, ...patch };
    const r = Number(String(next.radius).replace(',', '.'));
    if (!Number.isFinite(r) || r <= 0 || r > 50) return toast.error('Radius impor 1-50 km');
    if (!(await useAdminSecurity.getState().ensureUnlocked())) return;
    setOsm(next);
    try { await rpc('admin_set_settings', { p: { osm_import_enabled: next.enabled, osm_import_radius_km: r } }); toast.success(next.enabled ? `Impor tempat dari peta aktif (radius ${r} km)` : 'Impor tempat dari peta dinonaktifkan'); refreshPublic(); }
    catch (e) { handleSettingsError(e); load(); }
  };
  const activeCount = SERVICES.filter((s) => enabled[s.key] !== false).length;

  return (
    <AdminPage title="Pengaturan" subtitle="Konfigurasi umum aplikasi, layanan aktif, batas jarak & impor data tempat · setiap simpan butuh PIN dan izin payment_config" onRefresh={load}>
      {!canSave ? (
        <View style={st.noperm}>
          <Ionicons name="lock-closed-outline" size={adminIcon.md} color={adminTone.muted} />
          <Text style={[font.small, { flex: 1 }]}>Anda bisa melihat pengaturan, tetapi menyimpan hanya untuk superadmin (izin payment_config). Server juga menolak kunci yang tidak terdaftar di spesifikasi pengaturan (SETTING_UNKNOWN).</Text>
        </View>
      ) : null}
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
        <PaymentV3Settings />
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
            <RequirePerm perm="settings" fallback={<Text style={font.tiny}>Simpan butuh izin payment_config (superadmin)</Text>}><Button title="Simpan batas jarak" icon="save-outline" onPress={saveLimits} /></RequirePerm>
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
            <RequirePerm perm="settings" fallback={<Text style={font.tiny}>Simpan butuh izin payment_config (superadmin)</Text>}><Button title="Simpan radius terima order" icon="save-outline" onPress={savePickup} /></RequirePerm>
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
            <RequirePerm perm="settings" fallback={<Text style={font.tiny}>Simpan butuh izin payment_config (superadmin)</Text>}><Button title="Simpan batas berat & ukuran" icon="save-outline" onPress={saveSendLimits} /></RequirePerm>
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
            <Switch value={osm.enabled} disabled={!canSave} onValueChange={(v) => saveOsm({ enabled: v })} trackColor={{ true: colors.success, false: colors.border }} thumbColor="#fff" />
          </Row>
          <Row gap={10} style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Input label="Radius impor (km)" value={osm.radius} onChangeText={(v) => setOsm((o) => ({ ...o, radius: v.replace(/[^\d.,]/g, '') }))} keyboardType="decimal-pad" containerStyle={{ width: 180 }} right={<Text style={font.tiny}>km</Text>} />
            <RequirePerm perm="settings" fallback={<Text style={font.tiny}>Simpan butuh izin payment_config (superadmin)</Text>}><Button title="Simpan radius" variant="secondary" icon="save-outline" onPress={() => saveOsm({})} /></RequirePerm>
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
          <RequirePerm perm="settings" fallback={<Text style={font.tiny}>Simpan butuh izin payment_config (superadmin)</Text>}><Button title="Simpan pengaturan" onPress={save} /></RequirePerm>
        </Card>
      </Entrance>
      <Entrance index={6}>
        <Card style={{ maxWidth: 560, gap: 8 }}>
          <Text style={font.label}>Integrasi (opsional)</Text>
          <Text style={font.small}>
            <Text style={{ fontWeight: '700' }}>Peta (ubin, pencarian alamat, rute)</Text>: pindah ke menu <Text style={{ fontWeight: '700' }}>Sistem → Peta</Text>. Penyedia dan kuncinya disimpan di server sejak migrasi 0061, jadi berpindah penyedia TIDAK lagi memerlukan build ulang — cukup beberapa menit dari panel ini.{'\n'}
            Pembayaran (Midtrans/Finpay): provider aktif, kredensial & webhook di menu Pembayaran → Payment Gateway.
          </Text>
          <Button title="Buka pengaturan Peta" variant="secondary" icon="globe-outline" onPress={() => router.push('/(admin)/map' as never)} />
        </Card>
      </Entrance>
      <Entrance index={7}>
        <TurnCard />
      </Entrance>
    </AdminPage>
  );
}

/* ───────────────── v3 · Pembayaran, refund & iklan (kontrak §1) ───────────────── */
// Form DINAMIS dari admin_business_settings().settings_v3 (= business_setting_specs_v3: tipe, opsi, rentang, satuan,
// label sumber, izin per kunci, can_edit). app_setting_specs() sendiri tidak dibuka ke klien. Simpan lewat
// admin_set_settings (izin payment_config + izin per kunci + PIN); kunci di luar spesifikasi → SETTING_UNKNOWN.

type SpecV3 = {
  key: string; type: 'int' | 'numeric' | 'bool' | 'text' | 'string' | 'json'; value: unknown; default: unknown;
  min: number | null; max: number | null; options: string[] | null; unit: string | null; label: string | null; note: string | null;
  perm: string | null; can_edit?: boolean; stored?: boolean;
};
/** Cadangan bila server belum mengirim settings_v3 (nilai default kontrak §1). */
const V3_FALLBACK: SpecV3[] = [
  { key: 'payment_provider_active', type: 'text', value: 'midtrans', default: 'midtrans', min: null, max: null, options: ['midtrans', 'finpay'], unit: '', label: 'KONTRAK', note: 'Provider pembayaran transaksi baru', perm: 'payment_config' },
  { key: 'payment_provider_env', type: 'text', value: 'sandbox', default: 'sandbox', min: null, max: null, options: ['sandbox', 'production'], unit: '', label: 'KONTRAK', note: 'Lingkungan provider', perm: 'payment_config' },
  { key: 'payments_simulation_enabled', type: 'bool', value: false, default: false, min: null, max: null, options: null, unit: '', label: 'KONTRAK', note: 'Simulasi pembayaran (hanya sandbox)', perm: 'payment_config' },
  { key: 'disbursement_provider', type: 'text', value: 'manual', default: 'manual', min: null, max: null, options: ['manual', 'finpay'], unit: '', label: 'KONTRAK', note: 'Pencairan mitra', perm: 'payment_config' },
  { key: 'refund_dual_approval_min', type: 'int', value: 200000, default: 200000, min: 0, max: 10000000000, options: null, unit: 'Rp', label: 'KONTRAK', note: 'Refund ≥ nilai ini butuh 2 admin', perm: 'refund' },
  { key: 'wallet_adjust_dual_approval_min', type: 'int', value: 100000, default: 100000, min: 0, max: 10000000000, options: null, unit: 'Rp', label: 'KONTRAK', note: 'Penyesuaian saldo ≥ nilai ini butuh 2 admin', perm: 'wallet_adjust' },
  { key: 'ads_frequency_cap_per_day', type: 'int', value: 5, default: 5, min: 1, max: 100, options: null, unit: 'impresi', label: 'KONTRAK', note: 'Maks impresi iklan sama per pengguna per hari', perm: 'ads' },
  { key: 'ads_click_dedupe_minutes', type: 'int', value: 30, default: 30, min: 1, max: 1440, options: null, unit: 'menit', label: 'KONTRAK', note: 'Klik berulang dalam N menit tidak ditagih', perm: 'ads' },
  { key: 'variable_cost_per_order', type: 'int', value: 300, default: 300, min: 0, max: 1000000, options: null, unit: 'Rp', label: 'ASUMSI', note: 'Biaya variabel per order untuk contribution margin', perm: 'report' },
];
const V3_NAME: Record<string, string> = {
  payment_provider_active: 'Provider transaksi baru', payment_provider_env: 'Lingkungan provider', payments_simulation_enabled: 'Simulasi pembayaran',
  disbursement_provider: 'Pencairan mitra', refund_dual_approval_min: 'Ambang refund butuh 2 admin', wallet_adjust_dual_approval_min: 'Ambang penyesuaian saldo butuh 2 admin',
  ads_frequency_cap_per_day: 'Frequency cap iklan per hari', ads_click_dedupe_minutes: 'Dedupe klik iklan', variable_cost_per_order: 'Biaya variabel per order',
  rate_limit_create_order_per_hour: 'Batas buat pesanan per jam', rate_limit_payment_prepare_per_hour: 'Batas siapkan pembayaran per jam',
  rate_limit_withdrawal_per_hour: 'Batas penarikan per jam', rate_limit_topup_intent_per_hour: 'Batas intent top up per jam', rate_limit_dispute_per_hour: 'Batas buka sengketa per jam',
  auto_payout_enabled: 'Pencairan otomatis', auto_payout_max: 'Maks satu pencairan otomatis', auto_payout_daily_max: 'Maks pencairan otomatis per hari',
};
const OPT_LABEL: Record<string, string> = { midtrans: 'Midtrans', finpay: 'Finpay', sandbox: 'Sandbox (uji)', production: 'Production', manual: 'Manual (transfer bank)' };
const unquote = (v: unknown) => (typeof v === 'string' ? v.replace(/^"+|"+$/g, '') : v);
const asStr = (v: unknown) => (v == null ? '' : String(unquote(v)));
const asBool = (v: unknown) => v === true || unquote(v) === 'true';

function PaymentV3Settings() {
  const can = useAdminCan();
  const [specs, setSpecs] = useState<SpecV3[]>([]);
  const [draft, setDraft] = useState<Record<string, string | boolean>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fromServer, setFromServer] = useState(true);

  const load = useCallback(async () => {
    let list: SpecV3[] | null = null;
    try {
      const r = await rpc<AdminBusinessSettings & { settings_v3?: SpecV3[] | null }>('admin_business_settings');
      if (Array.isArray(r?.settings_v3) && r.settings_v3.length) list = r.settings_v3;
      setErr(null);
    } catch (e) { setErr(`Spesifikasi pengaturan: ${(e as Error).message}`); }
    if (!list) {
      // server lama: nilai tersimpan dibaca dari app_settings, spesifikasi dari cadangan kontrak
      const { data } = await supabase.from('app_settings').select('key,value').in('key', V3_FALLBACK.map((x) => x.key));
      const m = new Map(((data as { key: string; value: unknown }[]) ?? []).map((x) => [x.key, x.value]));
      list = V3_FALLBACK.map((x) => ({ ...x, value: m.has(x.key) ? m.get(x.key) : x.default, stored: m.has(x.key) }));
      setFromServer(false);
    } else setFromServer(true);
    const norm = list.filter((x) => x.type !== 'json').map((x) => ({ ...x, min: x.min == null ? null : Number(x.min), max: x.max == null ? null : Number(x.max) }));
    setSpecs(norm);
    setDraft(Object.fromEntries(norm.map((x) => [x.key, x.type === 'bool' ? asBool(x.value) : asStr(x.value)])));
  }, []);
  useEffect(() => { load(); }, [load]);

  const initial = (x: SpecV3) => (x.type === 'bool' ? asBool(x.value) : asStr(x.value));
  const changed = specs.filter((x) => draft[x.key] !== undefined && draft[x.key] !== initial(x));
  const editable = (x: SpecV3) => x.can_edit !== false && can('settings');
  const env = String(draft.payment_provider_env ?? 'sandbox');

  const save = async () => {
    const p: Record<string, unknown> = {};
    for (const x of changed) {
      const name = V3_NAME[x.key] ?? x.key;
      const v = draft[x.key];
      if (x.type === 'bool') { p[x.key] = !!v; continue; }
      if (x.type === 'text') { if (x.options && !x.options.includes(String(v))) return toast.error(`${name}: pilih salah satu ${x.options.join(' | ')}`); p[x.key] = String(v); continue; }
      if (x.type === 'string') { p[x.key] = String(v); continue; }
      const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
      if (!Number.isFinite(n)) return toast.error(`${name} harus angka`);
      if (x.type === 'int' && !Number.isInteger(n)) return toast.error(`${name} harus bilangan bulat`);
      if ((x.min != null && n < x.min) || (x.max != null && n > x.max)) return toast.error(`${name} harus ${(x.min ?? 0).toLocaleString('id-ID')}–${(x.max ?? 0).toLocaleString('id-ID')} ${x.unit ?? ''}`);
      p[x.key] = n;
    }
    if (env === 'production' && specs.some((x) => x.key === 'payments_simulation_enabled') && draft.payments_simulation_enabled) p.payments_simulation_enabled = false;
    if (!Object.keys(p).length) return toast.show('Tidak ada perubahan');
    if (!(await useAdminSecurity.getState().ensureUnlocked())) return;
    setBusy(true);
    try { await rpc('admin_set_settings', { p }); toast.success(`Pengaturan disimpan (${Object.keys(p).length} kunci) & tercatat di log`); useAppSettingsStore.getState().load(true); await load(); }
    catch (e) { handleSettingsError(e); } finally { setBusy(false); }
  };

  const n = changed.length;
  const prodSwitch = specs.some((x) => x.key === 'payment_provider_env' && initial(x) !== 'production') && env === 'production';
  return (
    <Card style={{ gap: 12 }}>
      <Row between style={{ flexWrap: 'wrap', gap: 8 }}>
        <View style={{ flex: 1, minWidth: 260 }}>
          <Text style={font.h2}>Pembayaran, refund, payout & iklan</Text>
          <Text style={font.small}>Dibangun dari spesifikasi server (business_setting_specs_v3){fromServer ? '' : ' — server belum mengirim spesifikasi, memakai cadangan kontrak'}. Setiap kunci punya izin sendiri; simpan butuh PIN.</Text>
        </View>
        <RequirePerm perm="settings" fallback={<Text style={font.tiny}>Simpan butuh izin payment_config (superadmin)</Text>}>
          <Button title={n ? `Simpan (${n})` : 'Simpan'} icon="save-outline" disabled={!n} loading={busy} onPress={save} />
        </RequirePerm>
      </Row>
      <ErrorNote text={err} onRetry={load} />
      {prodSwitch ? <Text style={[font.small, { color: colors.danger, fontWeight: '700' }]}>Anda akan mengaktifkan PRODUCTION — transaksi baru menagih uang sungguhan. Pastikan kredensial & webhook production sudah diuji (menu Payment Gateway).</Text> : null}
      <View style={st.grid}>
        {specs.map((x) => {
          const v = draft[x.key];
          const dirty = v !== initial(x);
          const ro = !editable(x);
          const simLocked = x.key === 'payments_simulation_enabled' && env === 'production';
          return (
            <View key={x.key} style={[st.limitCard, ro && { opacity: 0.7 }]}>
              <Row between style={{ gap: 6 }}>
                <Text style={[font.bodyStrong, { flex: 1 }]} numberOfLines={1}>{V3_NAME[x.key] ?? x.key}</Text>
                {x.label ? <Badge text={`[${x.label}]`} color={/FAKTA|KONTRAK/i.test(x.label) ? colors.success : colors.warning} /> : null}
              </Row>
              <Text style={font.tiny} numberOfLines={2}>{x.note ?? x.key}</Text>
              {x.type === 'bool' ? (
                <Row gap={8} style={{ alignItems: 'center', minHeight: 40 }}>
                  <Switch value={!!v && !simLocked} disabled={ro || simLocked} onValueChange={(b) => setDraft((d) => ({ ...d, [x.key]: b }))} trackColor={{ true: colors.success, false: colors.border }} thumbColor="#fff" />
                  <Text style={font.small}>{simLocked ? 'mati di production' : v ? 'Aktif' : 'Nonaktif'}</Text>
                </Row>
              ) : x.type === 'text' && x.options?.length ? (
                <AdminSelect width="100%" value={String(v ?? '')} disabled={ro} options={x.options.map((o) => ({ value: o, label: OPT_LABEL[o] ?? o, color: o === 'production' ? colors.danger : undefined }))}
                  onChange={(o) => setDraft((d) => ({ ...d, [x.key]: o, ...(x.key === 'payment_provider_env' && o === 'production' ? { payments_simulation_enabled: false } : {}) }))} />
              ) : (
                <Input value={String(v ?? '')} editable={!ro} keyboardType={x.type === 'string' ? 'default' : 'number-pad'} onChangeText={(t) => setDraft((d) => ({ ...d, [x.key]: x.type === 'string' ? t : t.replace(/[^\d.,-]/g, '') }))}
                  right={x.unit ? <Text style={font.tiny}>{x.unit}</Text> : undefined} style={{ fontWeight: dirty ? '700' : undefined, color: dirty ? adminTone.blue : undefined }} />
              )}
              <Text style={font.tiny} numberOfLines={2}>
                {x.key} · izin {x.perm ?? '—'}{ro ? ' (tidak ada izin)' : ''}{x.min != null && x.max != null ? ` · ${x.min.toLocaleString('id-ID')}–${x.max.toLocaleString('id-ID')}` : ''}{x.stored === false ? ' · belum disetel' : ''}
              </Text>
            </View>
          );
        })}
      </View>
    </Card>
  );
}

// --- Panggilan suara: TURN berumur pendek (Cloudflare Realtime, migrasi 0082) ----------------
type TurnStatus = {
  configured: boolean; enabled: boolean; provider: string; token_id_masked?: string | null; api_token_masked?: string | null;
  ttl_seconds: number; updated_at?: string | null; issued_7d?: number; failed_7d?: number;
  last_issue?: { ok: boolean; detail: string | null; at: string } | null;
};
function TurnCard() {
  const [status, setStatus] = useState<TurnStatus | null>(null);
  const [tokenId, setTokenId] = useState('');
  const [apiToken, setApiToken] = useState('');
  const [ttl, setTtl] = useState('7200');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { const s = await rpc<TurnStatus>('admin_turn_status'); setStatus(s); setTtl(String(s?.ttl_seconds ?? 7200)); }
    catch (e) { toast.error((e as Error).message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async (p: Record<string, unknown>) => {
    setSaving(true);
    try { const s = await rpc<TurnStatus>('admin_set_turn_config', { p }); setStatus(s); setTokenId(''); setApiToken(''); toast.success('Konfigurasi TURN disimpan'); }
    catch (e) { toast.error((e as Error).message); }
    finally { setSaving(false); }
  };
  /** Uji SUNGGUHAN: minta kredensial ke Edge Function persis seperti aplikasi saat menelepon. */
  const test = async () => {
    setTesting(true); setTestResult(null);
    try {
      const { data, error } = await supabase.functions.invoke<{ iceServers?: unknown[]; configured?: boolean; ok?: boolean; reason?: string; ttl?: number }>('turn-credentials', { body: {} });
      if (error) throw new Error(error.message);
      if (data?.ok && (data.iceServers?.length ?? 0) > 0) setTestResult(`OK — Cloudflare mengeluarkan kredensial (TTL ${data.ttl ?? '?'} dtk). Panggilan di jaringan seluler akan lewat TURN.`);
      else setTestResult(`GAGAL — ${data?.reason ?? 'tidak ada kredensial'}. Panggilan hanya andal di Wi-Fi.`);
      load();
    } catch (e) { setTestResult(`GAGAL — ${(e as Error).message}`); }
    finally { setTesting(false); }
  };

  const ok = !!status?.configured && !!status?.enabled;
  return (
    <Card style={{ gap: 12, maxWidth: 640 }}>
      <Row style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <Text style={font.label}>Panggilan suara — server TURN (jaringan seluler)</Text>
        <Badge text={ok ? 'aktif' : status?.configured ? 'nonaktif' : 'belum dikonfigurasi'} color={ok ? colors.success : colors.warning} />
      </Row>
      <Text style={font.small}>
        Tanpa TURN, telepon dalam aplikasi sering gagal tersambung di jaringan seluler (CGNAT) dan hanya andal di Wi‑Fi.
        Kredensial dibuat berumur pendek oleh server (Cloudflare Realtime → TURN Server) — API token TIDAK pernah dikirim ke aplikasi,
        jadi mengganti/mematikan TURN tidak perlu build ulang.
      </Text>
      <Row style={{ flexWrap: 'wrap', gap: 8 }}>
        <Badge text={status?.token_id_masked ? `Token ID ${status.token_id_masked}` : 'Token ID: kosong'} color={status?.token_id_masked ? colors.success : colors.textMuted} />
        <Badge text={status?.api_token_masked ? `API token ${status.api_token_masked}` : 'API token: kosong'} color={status?.api_token_masked ? colors.success : colors.textMuted} />
        <Badge text={`7 hari: ${status?.issued_7d ?? 0} berhasil · ${status?.failed_7d ?? 0} gagal`} color={colors.textMuted} />
      </Row>
      <Input label="Turn Token ID (Cloudflare → Realtime → TURN Server)" value={tokenId} onChangeText={setTokenId} autoCapitalize="none" placeholder={status?.token_id_masked ?? 'mis. 43c5…13ad'} />
      <Input label="API Token (hanya tampil sekali di Cloudflare)" value={apiToken} onChangeText={setApiToken} autoCapitalize="none" secureTextEntry placeholder={status?.api_token_masked ?? 'belum diisi'} />
      <Input label="Masa berlaku kredensial (detik, 300–86400)" value={ttl} onChangeText={setTtl} keyboardType="number-pad" />
      <Row style={{ flexWrap: 'wrap', gap: 8 }}>
        <Button title="Simpan" icon="key-outline" loading={saving} onPress={() => {
          if (!tokenId.trim() && !apiToken.trim() && String(status?.ttl_seconds ?? '') === ttl) return toast.error('Tidak ada yang diubah');
          save({ token_id: tokenId.trim(), api_token: apiToken.trim(), ttl_seconds: Number(ttl) || 7200 });
        }} />
        <Button title="Uji" icon="pulse-outline" variant="secondary" loading={testing} onPress={test} />
        <Button title={status?.enabled ? 'Nonaktifkan' : 'Aktifkan'} icon={status?.enabled ? 'pause-outline' : 'play-outline'} variant="secondary" loading={saving} onPress={() => save({ enabled: !status?.enabled })} />
        <Button title="Hapus kredensial" icon="trash-outline" variant="secondary" loading={saving} onPress={() => save({ clear: true })} />
      </Row>
      {testResult ? <Text style={[font.small, { color: testResult.startsWith('OK') ? colors.success : colors.danger }]}>{testResult}</Text> : null}
      {status?.last_issue ? <Text style={font.small}>Terakhir: {status.last_issue.ok ? 'berhasil' : 'gagal'} · {status.last_issue.detail ?? ''} · {new Date(status.last_issue.at).toLocaleString('id-ID')}</Text> : null}
    </Card>
  );
}

const st = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: adminSpace.md },
  noperm: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', padding: adminSpace.md, borderRadius: adminRadius.card, borderWidth: 1, borderColor: adminTone.border, backgroundColor: adminTone.surfaceAlt },
  service: { flexDirection: 'row', alignItems: 'center', gap: 10, flexGrow: 1, flexBasis: '45%', minWidth: 240, minHeight: 56, padding: adminSpace.md, borderRadius: adminRadius.card, backgroundColor: adminTone.surface, borderWidth: 1, borderColor: adminTone.border },
  dot: { width: 10, height: 10, borderRadius: 5 },
  limitCard: { flexGrow: 1, flexBasis: '45%', minWidth: 260, padding: adminSpace.md, borderRadius: adminRadius.card, backgroundColor: adminTone.surface, borderWidth: 1, borderColor: adminTone.border },
});
