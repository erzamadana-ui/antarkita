// Daftar Mitra AntarTravel — agen travel (kursi bersama, mobil ≥6 kursi) atau pemilik mobil pribadi (carter & sopir harian, ≥3 kursi)
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Screen, Card, Input, Button, Row, Chip, Badge, toast } from '@/components/ui';
import { Entrance, PressableScale } from '@/components/motion';
import { ServiceIllustration } from '@/components/ServiceArt';
import { DocUpload } from '@/components/DocUpload';
import { useAuth } from '@/store/auth';
import { useMode } from '@/store/mode';
import { useCurrentLocation } from '@/hooks/useLocation';
import { rpc, supabase } from '@/lib/supabase';
import { colors, font, radius, shadow } from '@/lib/theme';
import { rupiah } from '@/lib/format';
import type { TravelPartner, TravelPartnerType, TravelAccommodation } from '@/lib/types';

const MODELS = [['Toyota Innova Reborn', 6], ['Toyota Hi-Ace Commuter', 14], ['Isuzu Elf Long', 15], ['Hyundai H-1', 8], ['Mitsubishi Xpander', 6], ['Toyota Avanza', 6], ['Honda Brio', 4], ['BYD M6 (EV)', 6], ['Lainnya', 6]] as const;
const TYPES: { key: TravelPartnerType; title: string; sub: string; icon: React.ComponentProps<typeof Ionicons>['name'] }[] = [
  { key: 'agency', title: 'Agen travel', sub: 'Isi kursi bersama antar kota, mobil ≥6 kursi (Innova/Hi-Ace). Bisa juga carter & sopir harian.', icon: 'bus-outline' },
  { key: 'private', title: 'Pemilik mobil pribadi', sub: 'Carter privat & sopir harian saat mobil menganggur. Minimal 3 kursi penumpang.', icon: 'car-sport-outline' },
];
const digits = (v: string) => v.replace(/\D/g, '');

export default function BecomeTravel() {
  const router = useRouter();
  const { session, loadProfile } = useAuth();
  const setMode = useMode((s) => s.setMode);
  const { location, hasFix } = useCurrentLocation();
  const [me, setMe] = useState<TravelPartner | null | undefined>(undefined);
  const [f, setF] = useState({
    partner_type: 'agency' as TravelPartnerType, offers_shared: true, offers_charter: true, offers_daily: false,
    company_name: '', driver_name: '', bio: '', vehicle_model: 'Toyota Innova Reborn', vehicle_plate: '', vehicle_year: '', seats: '6', is_electric: false,
    daily_rate: '', overtime_rate: '', accommodation: ['customer', 'self'] as TravelAccommodation[], accommodation_fee: '150000', fuel_included: false,
    photo_url: '', license_url: '', permit_url: '',
  });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!session) return;
    supabase.from('travel_partners').select('*').eq('id', session.user.id).maybeSingle().then(({ data }) => {
      const p = data as TravelPartner | null; setMe(p);
      if (p) setF({
        partner_type: p.partner_type ?? 'agency', offers_shared: p.offers_shared ?? true, offers_charter: p.offers_charter ?? true, offers_daily: p.offers_daily ?? false,
        company_name: p.company_name ?? '', driver_name: p.driver_name ?? '', bio: p.bio ?? '', vehicle_model: p.vehicle_model, vehicle_plate: p.vehicle_plate, vehicle_year: p.vehicle_year ? String(p.vehicle_year) : '', seats: String(p.seats), is_electric: p.is_electric,
        daily_rate: p.daily_rate ? String(p.daily_rate) : '', overtime_rate: p.overtime_rate ? String(p.overtime_rate) : '', accommodation: p.accommodation?.length ? p.accommodation : ['customer', 'self'], accommodation_fee: String(p.accommodation_fee || 150000), fuel_included: !!p.fuel_included,
        photo_url: p.photo_url ?? '', license_url: p.license_url ?? '', permit_url: p.permit_url ?? '',
      });
    });
  }, [session]);
  const set = (k: keyof typeof f) => (v: string | boolean) => setF((p) => ({ ...p, [k]: v }));
  const setType = (t: TravelPartnerType) => setF((p) => ({ ...p, partner_type: t, offers_shared: t === 'agency' ? p.offers_shared : false, offers_charter: t === 'private' ? true : p.offers_charter, offers_daily: t === 'private' ? true : p.offers_daily }));
  const toggleAcc = (a: TravelAccommodation) => setF((p) => ({ ...p, accommodation: p.accommodation.includes(a) ? p.accommodation.filter((x) => x !== a) : [...p.accommodation, a] }));
  const agency = f.partner_type === 'agency';
  const minSeats = agency ? 6 : 3;

  const submit = async () => {
    if (!/^[A-Z]{1,2}\s?\d{1,4}\s?[A-Z]{0,3}$/i.test(f.vehicle_plate.trim())) return toast.error('Format plat nomor tidak valid');
    if (Number(f.seats) < minSeats) return toast.error(agency ? 'Agen travel minimal 6 kursi penumpang (Innova/Hi-Ace)' : 'Mobil pribadi minimal 3 kursi penumpang');
    if (!f.offers_shared && !f.offers_charter && !f.offers_daily) return toast.error('Pilih minimal satu layanan');
    if (f.offers_daily && !Number(f.daily_rate)) return toast.error('Isi harga sopir harian per hari');
    if (f.accommodation.length === 0) return toast.error('Pilih minimal satu opsi akomodasi sopir');
    if (!f.license_url) return toast.error('Unggah foto SIM A/B1');
    setBusy(true);
    try {
      await rpc('travel_partner_register', { p: {
        ...f, seats: Number(f.seats), vehicle_year: Number(f.vehicle_year) || null,
        company_name: f.company_name || null, driver_name: f.driver_name || null, bio: f.bio || null,
        daily_rate: Number(f.daily_rate) || null, overtime_rate: Number(f.overtime_rate) || null, accommodation_fee: Number(f.accommodation_fee) || 0,
        base_lat: hasFix ? location.lat : null, base_lng: hasFix ? location.lng : null,
      } });
      await loadProfile(); toast.success(me ? 'Data mitra travel diperbarui' : 'Pendaftaran mitra travel terkirim, menunggu verifikasi admin'); router.back();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  const st = me ? ({ pending: ['Menunggu verifikasi admin', colors.warning], approved: ['Mitra travel aktif', colors.success], suspended: ['Ditangguhkan', colors.danger], rejected: ['Ditolak', colors.danger] } as Record<string, [string, string]>)[me.status] : null;
  const dailyRate = Number(f.daily_rate) || 0;
  return (
    <Screen title="Mitra AntarTravel" band={colors.travel} back footer={me?.status === 'approved' ? <Button title="Buka Dasbor Mitra Travel" size="lg" icon="bus-outline" onPress={async () => { await setMode('driver'); router.replace('/driver/travel' as never); }} /> : <Button title={me ? 'Kirim ulang data' : 'Daftar Mitra Travel'} size="lg" icon="paper-plane-outline" loading={busy} onPress={submit} />}>
      <View style={{ gap: 16 }}>
        {/* Ilustrasi dalam lingkaran tint + judul besar */}
        <Entrance index={0} from="zoom">
          <View style={{ alignItems: 'center', marginTop: 4 }}>
            <View style={s.artCircle}><ServiceIllustration kind="travel" size={80} /></View>
            <Text style={[font.h1, { textAlign: 'center', marginTop: 14 }]}>Hasilkan dari{'\n'}mobil Anda</Text>
            <Text style={[font.small, { textAlign: 'center', marginTop: 6 }]}>Agen travel mengisi kursi antar kota; pemilik mobil pribadi menerima carter privat & sopir harian saat mobil menganggur. Komisi 10% + biaya layanan; pencairan ke AntarPay setelah perjalanan selesai.</Text>
            {st && <Badge text={st[0]} color={st[1]} style={{ marginTop: 10 }} />}
            {me?.status_reason && me.status !== 'approved' && <Text style={[font.small, { color: colors.danger, textAlign: 'center', marginTop: 6 }]}>Alasan admin: {me.status_reason}</Text>}
          </View>
        </Entrance>

        {/* Kartu pilihan jenis mitra (radio bulat) */}
        <Entrance index={1}>
          <Text style={[font.label, { marginBottom: 8 }]}>Jenis mitra</Text>
          <View style={{ gap: 10 }}>
            {TYPES.map((t) => {
              const active = f.partner_type === t.key;
              return (
                <PressableScale key={t.key} onPress={() => setType(t.key)} scaleTo={0.985} haptic={false} style={[s.option, active && s.optionActive]}>
                  <View style={s.optionIcon}><Ionicons name={t.icon} size={22} color={colors.primary} /></View>
                  <View style={{ flex: 1, minWidth: 0 }}><Text style={[font.body, { fontWeight: '700' }]}>{t.title}</Text><Text style={font.tiny}>{t.sub}</Text></View>
                  <View style={[s.radio, active && { borderColor: colors.primary }]}>{active && <View style={s.radioDot} />}</View>
                </PressableScale>
              );
            })}
          </View>
        </Entrance>

        <Entrance index={2}><Card style={{ gap: 12 }}>
          <Text style={font.label}>Layanan yang ditawarkan</Text>
          <Row gap={8} style={{ flexWrap: 'wrap' }}>
            {agency && <Chip label="Kursi bersama" active={f.offers_shared} onPress={() => set('offers_shared')(!f.offers_shared)} />}
            <Chip label="Carter privat" active={f.offers_charter} onPress={() => set('offers_charter')(!f.offers_charter)} />
            <Chip label="Sopir harian" active={f.offers_daily} onPress={() => set('offers_daily')(!f.offers_daily)} />
          </Row>
          <Text style={font.tiny}>{agency ? 'Kursi bersama: Anda membuat jadwal keberangkatan, penumpang membeli per kursi. Carter & harian: pelanggan mengirim permintaan, Anda menawar harga.' : 'Pelanggan mengirim permintaan carter/harian, Anda mengirim penawaran harga. Kursi bersama hanya untuk agen travel.'}</Text>
        </Card></Entrance>

        <Entrance index={3}><Card style={{ gap: 12 }}>
          <Text style={font.label}>Armada</Text>
          <Row gap={8} style={{ flexWrap: 'wrap' }}>{MODELS.map(([m, seats]) => <Chip key={m} label={m} active={f.vehicle_model === m} onPress={() => setF({ ...f, vehicle_model: m, seats: String(seats), is_electric: m.includes('EV') || f.is_electric })} />)}</Row>
          {f.vehicle_model === 'Lainnya' && <Input label="Tipe mobil" placeholder="Merek & tipe" value="" onChangeText={(v) => set('vehicle_model')(v || 'Lainnya')} />}
          <Input label={agency ? 'Nama usaha travel' : 'Nama usaha (opsional)'} placeholder={agency ? 'Minang Jaya Travel' : 'Kosongkan bila perorangan'} value={f.company_name} onChangeText={set('company_name')} />
          <Input label="Nama sopir" placeholder="Nama yang tampil ke pelanggan" icon="person-outline" value={f.driver_name} onChangeText={set('driver_name')} />
          <Row gap={10}>
            <Input label="Plat nomor" placeholder="BA 7777 TV" value={f.vehicle_plate} onChangeText={(v) => set('vehicle_plate')(v.toUpperCase())} containerStyle={{ flex: 1 }} autoCapitalize="characters" />
            <Input label="Tahun" placeholder="2023" keyboardType="number-pad" value={f.vehicle_year} onChangeText={(v) => set('vehicle_year')(digits(v).slice(0, 4))} containerStyle={{ width: 100 }} />
            <Input label="Kursi" keyboardType="number-pad" value={f.seats} onChangeText={(v) => set('seats')(digits(v).slice(0, 2))} containerStyle={{ width: 80 }} error={Number(f.seats) < minSeats ? `min. ${minSeats}` : undefined} />
          </Row>
          <Row gap={8} style={{ flexWrap: 'wrap' }}>
            <Chip label="Bensin / diesel" active={!f.is_electric} onPress={() => set('is_electric')(false)} />
            <Chip label="Listrik (EV)" active={f.is_electric} onPress={() => set('is_electric')(true)} />
          </Row>
          <Input label="Bio singkat" placeholder="Contoh: berpengalaman rute Padang–Bukittinggi, mobil bersih, sopir ramah" value={f.bio} onChangeText={set('bio')} multiline />
          <Row gap={8} style={s.note}><Ionicons name={hasFix ? 'location' : 'location-outline'} size={16} color={colors.primary} /><Text style={[font.tiny, { flex: 1 }]}>{hasFix ? 'Kota basis diambil dari lokasi Anda saat ini; permintaan di sekitar kota ini akan tampil di dasbor.' : 'Aktifkan lokasi agar kota basis terisi otomatis.'}</Text></Row>
        </Card></Entrance>

        {(f.offers_daily || f.offers_charter) && (
          <Entrance index={4}><Card style={{ gap: 12 }}>
            <Text style={font.label}>Tarif & ketentuan sopir</Text>
            {f.offers_daily && (
              <Row gap={10}>
                <Input label="Harga sopir harian / hari (12 jam)" placeholder="450000" keyboardType="number-pad" value={f.daily_rate} onChangeText={(v) => set('daily_rate')(digits(v))} containerStyle={{ flex: 1 }} />
                <Input label="Overtime / jam" placeholder={dailyRate ? String(Math.round(dailyRate * 0.1)) : '45000'} keyboardType="number-pad" value={f.overtime_rate} onChangeText={(v) => set('overtime_rate')(digits(v))} containerStyle={{ width: 130 }} />
              </Row>
            )}
            {f.offers_daily && dailyRate > 0 && <Text style={font.tiny}>Tampil ke pelanggan: {rupiah(dailyRate)}/hari, overtime {rupiah(Number(f.overtime_rate) || Math.round(dailyRate * 0.1))}/jam (umumnya 10% dari tarif harian).</Text>}
            <Text style={font.label}>Akomodasi sopir saat menginap</Text>
            <Row gap={8} style={{ flexWrap: 'wrap' }}>
              <Chip label="Ditanggung pelanggan" active={f.accommodation.includes('customer')} onPress={() => toggleAcc('customer')} />
              <Chip label="Mandiri + kompensasi/malam" active={f.accommodation.includes('self')} onPress={() => toggleAcc('self')} />
            </Row>
            {f.accommodation.includes('self') && <Input label="Kompensasi akomodasi mandiri per malam" placeholder="150000" keyboardType="number-pad" value={f.accommodation_fee} onChangeText={(v) => set('accommodation_fee')(digits(v))} />}
            <Text style={font.tiny}>Pilih yang Anda terima. Pelanggan memilih salah satu saat mengirim permintaan; kompensasi mandiri dihitung otomatis di kalkulator penawaran.</Text>
            <Text style={font.label}>BBM, tol & parkir</Text>
            <Row gap={8} style={{ flexWrap: 'wrap' }}>
              <Chip label="Ditanggung pelanggan (umum)" active={!f.fuel_included} onPress={() => set('fuel_included')(false)} />
              <Chip label="Termasuk harga (all-in)" active={f.fuel_included} onPress={() => set('fuel_included')(true)} />
            </Row>
          </Card></Entrance>
        )}

        <Entrance index={5}><Card style={{ gap: 12 }}>
          <Text style={font.label}>Dokumen</Text>
          <DocUpload label="Foto mobil (tampak samping)" value={f.photo_url} onChange={set('photo_url')} bucket="merchant-images" />
          <DocUpload label="SIM A / B1 pengemudi" required value={f.license_url} onChange={set('license_url')} />
          <DocUpload label={agency ? 'Izin angkutan / KIR (opsional)' : 'STNK (opsional)'} value={f.permit_url} onChange={set('permit_url')} />
        </Card></Entrance>
      </View>
    </Screen>
  );
}
const s = StyleSheet.create({
  artCircle: { width: 124, height: 124, borderRadius: 62, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.primaryLight },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 20, backgroundColor: '#fff', borderWidth: 1.5, borderColor: colors.border, ...shadow.soft },
  optionActive: { borderColor: colors.primary, backgroundColor: colors.tint },
  optionIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center' },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  radioDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.primary },
  note: { padding: 10, borderRadius: radius.md, backgroundColor: colors.tint, alignItems: 'flex-start' },
});
