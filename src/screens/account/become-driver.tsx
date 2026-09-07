import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Screen, Card, Input, Button, Row, Chip, Badge, toast } from '@/components/ui';
import { Entrance, PressableScale } from '@/components/motion';
import { ServiceIllustration, type ArtKind } from '@/components/ServiceArt';
import { DocUpload } from '@/components/DocUpload';
import { useAuth } from '@/store/auth';
import { useMode } from '@/store/mode';
import { rpc, supabase } from '@/lib/supabase';
import { colors, font, radius, shadow } from '@/lib/theme';
import { brandsFor, modelsFor, fuelsFor, validateVehicle, isElectricFuel, FUEL_LABEL, type FuelType, type VehicleKind } from '@/lib/vehicles';
import type { DriverDocuments, VehicleType } from '@/lib/types';

const VEHICLES: { key: VehicleType; label: string; sub: string; art: ArtKind; color: string }[] = [
  { key: 'motor', label: 'Motor', sub: 'AntarRide, Food, Send, Shop', art: 'rider', color: colors.ride },
  { key: 'car', label: 'Mobil', sub: 'AntarCar & belanja besar', art: 'car', color: colors.car },
  { key: 'pickup', label: 'Pick Up', sub: 'AntarBox barang besar', art: 'box', color: colors.box },
  { key: 'box', label: 'Mobil Box', sub: 'AntarBox pindahan', art: 'box', color: colors.box },
];
const OTHER = 'Lainnya';

/** Pecah nilai tersimpan menjadi pilihan katalog + teks bebas ("Lainnya"). */
function splitBrand(kind: VehicleKind, brand?: string | null) {
  if (!brand) return { pick: '', other: '' };
  return brandsFor(kind).includes(brand) ? { pick: brand, other: '' } : { pick: OTHER, other: brand };
}
function splitModel(kind: VehicleKind, brand: string, model?: string | null) {
  if (!model) return { pick: '', other: '' };
  const list = modelsFor(kind, brand);
  return list.includes(model) ? { pick: model, other: '' } : { pick: OTHER, other: model };
}

export default function BecomeDriver() {
  const router = useRouter();
  const { driver, loadProfile } = useAuth();
  const setMode = useMode((s) => s.setMode);
  const initKind = (driver?.vehicle_type ?? 'motor') as VehicleKind;
  const initBrand = splitBrand(initKind, driver?.vehicle_brand);
  const initModel = splitModel(initKind, initBrand.pick, driver?.vehicle_model);
  const [f, setF] = useState({
    vehicle_type: initKind as VehicleType,
    brand_pick: initBrand.pick, brand_other: initBrand.other, model_pick: initModel.pick, model_other: initModel.other,
    fuel_type: (driver?.fuel_type ?? (driver?.is_electric ? 'listrik' : null)) as FuelType | null,
    vehicle_plate: driver?.vehicle_plate ?? '', vehicle_color: driver?.vehicle_color ?? '', license_number: '', id_card_number: '', photo_id_url: '', photo_vehicle_url: '',
    vehicle_year: driver?.vehicle_year ? String(driver.vehicle_year) : '', vehicle_condition: (driver?.vehicle_condition ?? 'baik') as 'standar' | 'baik' | 'sangat_baik', vehicle_capacity: driver?.vehicle_capacity ?? '',
  });
  useEffect(() => {
    if (!driver) return;
    supabase.from('driver_documents').select('*').eq('driver_id', driver.id).maybeSingle().then(({ data }) => {
      const d = data as DriverDocuments | null;
      if (d) setF((p) => ({ ...p, license_number: d.license_number ?? '', id_card_number: d.id_card_number ?? '', photo_id_url: d.photo_id_url ?? '', photo_vehicle_url: d.photo_vehicle_url ?? '' }));
    });
  }, [driver]);
  const set = (k: keyof typeof f) => (v: string | boolean | null) => setF((p) => ({ ...p, [k]: v }));

  const kind = f.vehicle_type as VehicleKind;
  const brands = brandsFor(kind);
  const models = f.brand_pick && f.brand_pick !== OTHER ? modelsFor(kind, f.brand_pick) : [];
  const fuels = useMemo(() => fuelsFor(kind, f.brand_pick || null, f.model_pick && f.model_pick !== OTHER ? f.model_pick : null), [kind, f.brand_pick, f.model_pick]);
  // Nilai efektif yang dikirim ke server
  const brandName = f.brand_pick === OTHER ? f.brand_other.trim() : f.brand_pick;
  const modelName = f.brand_pick === OTHER || f.model_pick === OTHER ? f.model_other.trim() : f.model_pick;
  const isEv = isElectricFuel(f.fuel_type);
  const yr = Number(f.vehicle_year) || 0;

  // Jika opsi bahan bakar berubah (ganti merek/model), pastikan pilihan tetap valid; EV → otomatis Listrik
  useEffect(() => {
    if (fuels.length === 1 && f.fuel_type !== fuels[0]) setF((p) => ({ ...p, fuel_type: fuels[0] }));
    else if (f.fuel_type && !fuels.includes(f.fuel_type)) setF((p) => ({ ...p, fuel_type: null }));
  }, [fuels, f.fuel_type]);

  const pickKind = (k: VehicleType) => { if (k === f.vehicle_type) return; setF((p) => ({ ...p, vehicle_type: k, brand_pick: '', brand_other: '', model_pick: '', model_other: '', fuel_type: null, vehicle_capacity: '' })); };
  const pickBrand = (b: string) => { if (b === f.brand_pick) return; setF((p) => ({ ...p, brand_pick: b, brand_other: '', model_pick: '', model_other: '', fuel_type: null })); };
  const pickModel = (m: string) => { if (m === f.model_pick) return; setF((p) => ({ ...p, model_pick: m, model_other: '', fuel_type: null })); };

  const predictedClass = kind === 'pickup' ? 'Pick Up' : kind === 'box' ? 'Mobil Box' : kind === 'motor' ? (isEv ? 'Ride Listrik' : yr >= 2019 && f.vehicle_condition !== 'standar' ? 'Ride Standar' : 'Ride Hemat (tarif -10%)') : isEv ? (yr >= 2022 && f.vehicle_condition === 'sangat_baik' ? 'Car Listrik Premium (+45%)' : 'Car Listrik (+10%)') : yr >= 2022 && f.vehicle_condition === 'sangat_baik' ? 'Car Premium (+35%)' : yr >= 2016 && f.vehicle_condition !== 'standar' ? 'Car Standar' : 'Car Hemat (tarif -10%)';

  const vehicleError = (): string | null => {
    if (!f.brand_pick) return 'Pilih merek kendaraan';
    if (f.brand_pick === OTHER && brandName.length < 2) return 'Tulis merek kendaraan';
    if ((f.brand_pick === OTHER || f.model_pick === OTHER) && modelName.length < 1) return 'Tulis model / tipe kendaraan';
    if (f.brand_pick !== OTHER && models.length > 0 && !f.model_pick) return 'Pilih model kendaraan';
    return validateVehicle({ kind, brand: f.brand_pick, model: f.model_pick && f.model_pick !== OTHER ? f.model_pick : null, fuel: f.fuel_type, year: yr || null });
  };
  const summary = brandName ? [[brandName, modelName].filter(Boolean).join(' '), f.fuel_type ? FUEL_LABEL[f.fuel_type] : null, yr || null].filter(Boolean).join(' · ') : null;

  const submit = async () => {
    const ve = vehicleError();
    if (ve) return toast.error(ve);
    if (!/^[A-Z]{1,2}\s?\d{1,4}\s?[A-Z]{0,3}$/i.test(f.vehicle_plate.trim())) return toast.error('Format plat nomor tidak valid (contoh: BA 1234 AB)');
    if (!f.license_number || !f.id_card_number) return toast.error('Nomor SIM dan NIK wajib diisi');
    if (!yr || yr < 1990 || yr > new Date().getFullYear() + 1) return toast.error('Isi tahun kendaraan yang valid');
    try {
      await rpc('register_driver', { p: {
        vehicle_type: f.vehicle_type, vehicle_brand: brandName, vehicle_model: modelName || null, fuel_type: f.fuel_type, is_electric: isEv,
        vehicle_plate: f.vehicle_plate.trim(), vehicle_color: f.vehicle_color, vehicle_year: yr, vehicle_condition: f.vehicle_condition, vehicle_capacity: f.vehicle_capacity || null,
        license_number: f.license_number, id_card_number: f.id_card_number, photo_id_url: f.photo_id_url || null, photo_vehicle_url: f.photo_vehicle_url || null,
      } });
      await loadProfile();
      toast.success('Pendaftaran terkirim, menunggu verifikasi admin');
      router.back();
    } catch (e) { toast.error((e as Error).message); }
  };

  const statusInfo = driver ? { pending: ['Menunggu verifikasi', colors.warning], approved: ['Akun mitra aktif', colors.success], suspended: ['Akun ditangguhkan', colors.danger], rejected: ['Ditolak — perbaiki data lalu kirim ulang', colors.danger] }[driver.status] : null;
  const isCargo = kind === 'pickup' || kind === 'box';
  const current = VEHICLES.find((v) => v.key === f.vehicle_type) ?? VEHICLES[0];
  const showModelInput = f.brand_pick === OTHER || f.model_pick === OTHER || (!!f.brand_pick && f.brand_pick !== OTHER && models.length === 0);

  return (
    <Screen title="Daftar Mitra Driver" back footer={
      driver?.status === 'approved'
        ? <Button title="Buka Mode Driver" size="lg" icon="bicycle-outline" onPress={async () => { await setMode('driver'); router.replace('/(driver)'); }} />
        : <Button title={driver ? 'Kirim Ulang Data' : 'Kirim Pendaftaran'} size="lg" icon="paper-plane-outline" onPress={submit} />
    }>
      <View style={{ gap: 16 }}>
        <Entrance index={0} from="zoom">
          <View style={{ alignItems: 'center', marginTop: 4 }}>
            <View style={s.artCircle}><ServiceIllustration kind={current.art} size={80} /></View>
            <Text style={[font.h1, { textAlign: 'center', marginTop: 14 }]}>Penghasilan fleksibel,{'\n'}jam kerja bebas</Text>
            <Text style={[font.small, { textAlign: 'center', marginTop: 6 }]}>Terima 80% tarif perjalanan + tip. Potongan platform 20%. Bonus untuk mitra rajin.</Text>
            {statusInfo && <Badge text={statusInfo[0]} color={statusInfo[1]} style={{ marginTop: 10 }} />}
            {driver?.status_reason && (driver.status === 'suspended' || driver.status === 'rejected') && <Text style={[font.small, { color: colors.danger, textAlign: 'center', marginTop: 6 }]}>Alasan admin: {driver.status_reason}</Text>}
          </View>
        </Entrance>
        {!driver && (
          <Entrance index={1}>
            <PressableScale onPress={() => router.push('/account/become-travel' as never)} scaleTo={0.985} haptic={false} style={s.travelHint}>
              <View style={s.hintIcon}><Ionicons name="bus-outline" size={20} color={colors.primary} /></View>
              <Text style={[font.small, { flex: 1, color: colors.text, fontWeight: '600' }]}>Punya Innova / Hi-Ace? Daftar jadi Mitra AntarTravel (antar kota)</Text>
              <Ionicons name="arrow-forward" size={16} color={colors.primary} />
            </PressableScale>
          </Entrance>
        )}

        {/* Langkah 1: tipe kendaraan */}
        <Entrance index={2}>
          <Text style={[font.label, { marginBottom: 8 }]}>1. Tipe kendaraan</Text>
          <View style={s.grid}>
            {VEHICLES.map((v) => {
              const active = f.vehicle_type === v.key;
              return (
                <PressableScale key={v.key} onPress={() => pickKind(v.key)} scaleTo={0.97} haptic={false} style={[s.option, active && s.optionActive]}>
                  <Row between>
                    <View style={[s.optionArt, { backgroundColor: v.color + '14' }]}><ServiceIllustration kind={v.art} size={34} /></View>
                    <View style={[s.radio, active && { borderColor: colors.primary }]}>{active && <View style={s.radioDot} />}</View>
                  </Row>
                  <Text style={[font.body, { fontWeight: '700', marginTop: 10 }]}>{v.label}</Text>
                  <Text style={font.tiny} numberOfLines={1}>{v.sub}</Text>
                </PressableScale>
              );
            })}
          </View>
          {isCargo && <Text style={[font.tiny, { marginTop: 8 }]}>AntarBox: kirim barang besar, jemput dari rumah, pindahan rumah/kost. Tarif per km lebih tinggi + bonus pembantu angkat.</Text>}
        </Entrance>

        {/* Langkah 2-4: merek → model → bahan bakar */}
        <Entrance index={3}>
          <Card style={{ gap: 12 }}>
            <Text style={font.label}>2. Merek</Text>
            <Row gap={8} style={{ flexWrap: 'wrap' }}>
              {brands.map((b) => <Chip key={b} label={b} active={f.brand_pick === b} onPress={() => pickBrand(b)} />)}
            </Row>
            {f.brand_pick === OTHER && <Input label="Merek lainnya" placeholder="Tulis merek kendaraan" value={f.brand_other} onChangeText={set('brand_other')} autoCapitalize="words" />}

            {!!f.brand_pick && (<>
              <Text style={[font.label, { marginTop: 4 }]}>3. Model / tipe</Text>
              {models.length > 0 && (
                <Row gap={8} style={{ flexWrap: 'wrap' }}>
                  {models.map((m) => <Chip key={m} label={m} active={f.model_pick === m} onPress={() => pickModel(m)} />)}
                  <Chip label={OTHER} active={f.model_pick === OTHER} onPress={() => pickModel(OTHER)} />
                </Row>
              )}
              {showModelInput && <Input label={models.length > 0 ? 'Model lainnya' : 'Model / tipe'} placeholder={kind === 'motor' ? 'Contoh: Vario 160' : 'Contoh: Avanza 1.3 G'} value={f.model_other} onChangeText={set('model_other')} autoCapitalize="words" />}
            </>)}

            {!!f.brand_pick && (<>
              <Text style={[font.label, { marginTop: 4 }]}>4. Bahan bakar</Text>
              <Row gap={8} style={{ flexWrap: 'wrap' }}>
                {fuels.map((fu) => <Chip key={fu} label={FUEL_LABEL[fu]} active={f.fuel_type === fu} onPress={() => set('fuel_type')(fu)} />)}
              </Row>
              {fuels.length === 1 && <Text style={font.tiny}>Model ini kendaraan listrik, bahan bakar terisi otomatis.</Text>}
            </>)}
          </Card>
        </Entrance>

        {/* Langkah 5: detail kendaraan */}
        <Entrance index={4}>
          <Card style={{ gap: 12 }}>
            <Text style={font.label}>5. Detail kendaraan</Text>
            <Row gap={10}>
              <Input label="Tahun" placeholder="2021" keyboardType="number-pad" value={f.vehicle_year} onChangeText={(v) => set('vehicle_year')(v.replace(/\D/g, '').slice(0, 4))} containerStyle={{ flex: 1 }} />
              <Input label="Warna" placeholder="Hitam" value={f.vehicle_color} onChangeText={set('vehicle_color')} containerStyle={{ flex: 1 }} />
            </Row>
            <Row gap={10}>
              <Input label="Plat nomor" placeholder="BA 1234 AB" value={f.vehicle_plate} onChangeText={(v) => set('vehicle_plate')(v.toUpperCase())} containerStyle={{ flex: 1 }} autoCapitalize="characters" />
              {isCargo && <Input label="Kapasitas (kg / m³)" placeholder="1000 kg" value={f.vehicle_capacity} onChangeText={set('vehicle_capacity')} containerStyle={{ flex: 1 }} />}
            </Row>
            <Text style={s.fieldLabel}>Kondisi kendaraan</Text>
            <Row gap={8} style={{ flexWrap: 'wrap' }}>
              {([['standar', 'Standar'], ['baik', 'Baik'], ['sangat_baik', 'Sangat baik']] as const).map(([k, l]) => <Chip key={k} label={l} active={f.vehicle_condition === k} onPress={() => set('vehicle_condition')(k)} />)}
            </Row>
            <Row gap={10} style={s.classBox}>
              <View style={s.hintIcon}><Ionicons name="pricetag-outline" size={18} color={colors.primary} /></View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ fontWeight: '800', color: colors.primary, fontSize: 13 }}>Kelas & tarif Anda: {predictedClass}</Text>
                <Text style={font.tiny}>Kelas ditentukan dari tipe, tahun, kondisi, dan bahan bakar listrik; diverifikasi admin dari foto & STNK. Kelas lebih tinggi = tarif per km lebih tinggi. Driver kelas Premium juga bisa menerima order Standar/Hemat.</Text>
              </View>
            </Row>
          </Card>
        </Entrance>

        <Entrance index={5}>
          <Card style={{ gap: 12 }}>
            <Text style={font.label}>Dokumen</Text>
            <Input label="Nomor SIM" placeholder={kind === 'motor' ? 'SIM C' : kind === 'box' ? 'SIM B1' : 'SIM A'} value={f.license_number} onChangeText={set('license_number')} />
            <Input label="NIK (KTP)" keyboardType="number-pad" value={f.id_card_number} onChangeText={set('id_card_number')} />
            <DocUpload label="Foto KTP" hint="Foto KTP jelas & terbaca" required value={f.photo_id_url} onChange={set('photo_id_url')} />
            <DocUpload label="Foto kendaraan + STNK" hint="Kendaraan tampak samping beserta STNK" required value={f.photo_vehicle_url} onChange={set('photo_vehicle_url')} />
            <Text style={font.tiny}>Data pribadi disimpan terenkripsi dan hanya dapat dilihat admin verifikasi.</Text>
          </Card>
        </Entrance>

        {/* Ringkasan sebelum kirim */}
        <Entrance index={6}>
          <View style={s.summary}>
            <View style={[s.hintIcon, { backgroundColor: '#fff' }]}><Ionicons name={kind === 'motor' ? 'bicycle-outline' : 'car-outline'} size={18} color={colors.primary} /></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={font.tiny}>Ringkasan kendaraan</Text>
              <Text style={[font.body, { fontWeight: '800' }]} numberOfLines={2}>{summary ?? 'Lengkapi merek, model, bahan bakar & tahun'}</Text>
              {f.vehicle_plate ? <Text style={font.tiny}>{current.label} · {f.vehicle_plate}{f.vehicle_color ? ` · ${f.vehicle_color}` : ''}{isEv ? ' · Kendaraan listrik' : ''}</Text> : null}
            </View>
          </View>
        </Entrance>
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  artCircle: { width: 124, height: 124, borderRadius: 62, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.primaryLight },
  travelHint: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fff', borderRadius: radius.lg, padding: 12, borderWidth: 1, borderColor: colors.border, ...shadow.soft },
  hintIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  option: { width: '48%', flexGrow: 1, padding: 12, borderRadius: 20, backgroundColor: '#fff', borderWidth: 1.5, borderColor: colors.border, ...shadow.soft },
  optionActive: { borderColor: colors.primary, backgroundColor: colors.tint },
  optionArt: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  radioDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.primary },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  classBox: { backgroundColor: colors.tint, borderRadius: 14, padding: 12, alignItems: 'flex-start' },
  summary: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.tint, borderRadius: radius.lg, padding: 14, borderWidth: 1, borderColor: colors.primary + '30' },
});
