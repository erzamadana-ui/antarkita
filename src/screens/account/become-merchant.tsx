import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Screen, Card, Input, Button, Row, Chip, toast } from '@/components/ui';
import { Entrance, PressableScale } from '@/components/motion';
import { ServiceIllustration } from '@/components/ServiceArt';
import { DocUpload } from '@/components/DocUpload';
import { MerchantStatusCard } from '@/components/MerchantStatus';
import { useAuth } from '@/store/auth';
import { useMode } from '@/store/mode';
import { useBooking } from '@/store/booking';
import { rpc } from '@/lib/supabase';
import { pickAndUpload } from '@/lib/upload';
import { colors, font, radius, shadow } from '@/lib/theme';

const CATS = ['Makanan', 'Minuman', 'Jajanan', 'Roti & Kue', 'Sehat'];
const BANKS = ['BCA', 'BRI', 'Mandiri', 'BNI', 'BSI', 'Bank Nagari', 'Bank Riau Kepri', 'Lainnya'];

export default function BecomeMerchant() {
  const router = useRouter();
  const { merchant, session, loadProfile } = useAuth();
  const setMode = useMode((s) => s.setMode);
  const booking = useBooking();
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    name: '', description: '', category: 'Makanan', address: '', lat: 0, lng: 0, image_url: '', prep_minutes: '15', opening_hours: '08:00-22:00',
    owner_phone: '', is_halal: true, halal_cert_no: '', halal_cert_url: '', npwp_no: '', npwp_url: '', license_no: '', license_url: '',
    owner_id_card_url: '', place_photo_url: '', bank_name: 'BCA', bank_account: '', bank_holder: '',
  });
  const set = (k: keyof typeof f) => (v: string | boolean) => setF((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    const r = booking.consumePickerResult();
    if (r && r.target === 'merchant') setF((p) => ({ ...p, address: r.place.address, lat: r.place.lat, lng: r.place.lng }));
  }, [booking.pickerResult]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    if (f.name.trim().length < 3) return toast.error('Nama usaha minimal 3 huruf');
    if (!f.lat) return toast.error('Pilih lokasi usaha di peta');
    if (f.npwp_no.replace(/\D/g, '').length < 8) return toast.error('Isi nomor NPWP / NPWPD yang valid');
    if (!f.owner_id_card_url) return toast.error('Unggah foto KTP pemilik');
    if (!f.place_photo_url) return toast.error('Unggah foto tempat usaha');
    if (f.is_halal && f.halal_cert_no && !f.halal_cert_url) return toast.error('Unggah scan sertifikat halal, atau kosongkan nomornya');
    setBusy(true);
    try {
      await rpc('register_merchant', { p: { ...f, prep_minutes: Number(f.prep_minutes) || 15 } });
      await loadProfile();
      toast.success('Pengajuan merchant terkirim, menunggu verifikasi admin');
      router.back();
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };

  if (merchant) {
    return (
      <Screen title="Merchant Saya" back>
        <Entrance index={0}><MerchantStatusCard merchant={merchant} /></Entrance>
        <Entrance index={1} style={{ marginTop: 14, gap: 10 }}>
          <Button title="Sertifikasi & dokumen usaha" variant="secondary" icon="document-text-outline" onPress={() => router.push('/merchant/documents' as never)} />
          {merchant.status === 'approved' && <Button title="Buka Mode Merchant" icon="storefront-outline" onPress={async () => { await setMode('merchant'); router.replace('/(merchant)'); }} />}
        </Entrance>
      </Screen>
    );
  }

  const halalOptions: { key: boolean; title: string; sub: string; icon: React.ComponentProps<typeof Ionicons>['name'] }[] = [
    { key: true, title: 'Halal', sub: 'Tampil sebagai "Halal"; sertifikat BPJPH/MUI opsional', icon: 'checkmark-circle-outline' },
    { key: false, title: 'Non-halal', sub: 'Pelanggan bisa memfilter di AntarFood', icon: 'ellipse-outline' },
  ];

  return (
    <Screen title="Daftar Merchant" back footer={<Button title="Kirim Pengajuan" size="lg" icon="paper-plane-outline" loading={busy} onPress={submit} />}>
      <View style={{ gap: 16 }}>
        {/* Ilustrasi dalam lingkaran tint + judul besar */}
        <Entrance index={0} from="zoom">
          <View style={{ alignItems: 'center', marginTop: 4 }}>
            <View style={s.artCircle}><ServiceIllustration kind="food" size={80} /></View>
            <Text style={[font.h1, { textAlign: 'center', marginTop: 14 }]}>Jualan lebih laris{'\n'}dengan AntarFood</Text>
            <Text style={[font.small, { textAlign: 'center', marginTop: 6 }]}>Komisi 15% per pesanan, pencairan ke saldo AntarPay otomatis. Tanpa biaya pendaftaran. Pengajuan ditinjau admin maks. 1×24 jam kerja.</Text>
          </View>
        </Entrance>
        <Entrance index={1}>
          <Card style={{ gap: 12 }}>
            <Text style={font.label}>1 · Profil usaha</Text>
            <Input label="Nama usaha" placeholder="Sate Padang Mak Syukur" value={f.name} onChangeText={set('name')} />
            <Input label="Deskripsi singkat" placeholder="Menu andalan, ciri khas" value={f.description} onChangeText={set('description')} />
            <Text style={s.fieldLabel}>Kategori</Text>
            <Row gap={8} style={{ flexWrap: 'wrap' }}>{CATS.map((c) => <Chip key={c} label={c} active={f.category === c} onPress={() => set('category')(c)} />)}</Row>
            <Row gap={10}>
              <Input label="Waktu siap (menit)" keyboardType="number-pad" value={f.prep_minutes} onChangeText={set('prep_minutes')} containerStyle={{ flex: 1 }} />
              <Input label="Jam buka" value={f.opening_hours} onChangeText={set('opening_hours')} containerStyle={{ flex: 1 }} />
            </Row>
            <Input label="No. HP pemilik (untuk verifikasi admin)" keyboardType="phone-pad" placeholder="08xxxxxxxxxx" value={f.owner_phone} onChangeText={set('owner_phone')} />
          </Card>
        </Entrance>
        <Entrance index={2}>
          <Card style={{ gap: 12 }}>
            <Text style={font.label}>2 · Lokasi & foto</Text>
            <PressableScale onPress={() => router.push({ pathname: '/place-picker', params: { target: 'merchant', title: 'Lokasi usaha' } } as never)} scaleTo={0.985} haptic={false} style={s.pick}>
              <View style={s.pickIcon}><Ionicons name="location-outline" size={20} color={colors.primary} /></View>
              <Text style={[font.body, { flex: 1 }, !f.address && { color: colors.textMuted }]} numberOfLines={2}>{f.address || 'Pilih lokasi usaha di peta'}</Text>
              <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
            </PressableScale>
            <PressableScale onPress={async () => { if (!session) return; try { const r = await pickAndUpload('merchant-images', session.user.id); if (r) set('image_url')(r.url); } catch (e) { toast.error((e as Error).message); } }} scaleTo={0.985} haptic={false} style={[s.coverBox, f.image_url && { borderColor: colors.success, borderStyle: 'solid' }]}>
              {f.image_url ? <Image source={{ uri: f.image_url }} style={s.coverImg} /> : <View style={s.pickIcon}><Ionicons name="image-outline" size={20} color={colors.primary} /></View>}
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontWeight: '700', color: colors.text, fontSize: 14 }}>{f.image_url ? 'Foto sampul terunggah' : 'Foto sampul toko'}</Text>
                <Text style={font.tiny}>{f.image_url ? 'Ketuk untuk ganti' : 'Tampil ke pelanggan di AntarFood'}</Text>
              </View>
            </PressableScale>
            <DocUpload label="Foto tempat usaha" hint="Tampak depan lapak/toko (bukti lokasi nyata)" required value={f.place_photo_url} onChange={set('place_photo_url')} />
          </Card>
        </Entrance>
        <Entrance index={3}>
          <Card style={{ gap: 12 }}>
            <Text style={font.label}>3 · Sertifikasi & legalitas usaha</Text>
            <Text style={font.tiny}>Minimal: NPWP/NPWPD dan KTP pemilik. Izin usaha (NIB) dan sertifikat halal opsional — merchant bersertifikat halal mendapat label "Halal terverifikasi" di aplikasi pelanggan.</Text>
            <Input label="NPWP / NPWPD" placeholder="00.000.000.0-000.000" value={f.npwp_no} onChangeText={set('npwp_no')} />
            <DocUpload label="Scan NPWP / NPWPD" hint="Foto atau PDF (opsional, mempercepat verifikasi)" value={f.npwp_url} onChange={set('npwp_url')} />
            <DocUpload label="KTP pemilik" hint="Foto KTP jelas & terbaca" required value={f.owner_id_card_url} onChange={set('owner_id_card_url')} />
            <Input label="Izin usaha / NIB (opsional)" placeholder="Nomor NIB / SIUP / IUMK" value={f.license_no} onChangeText={set('license_no')} />
            <DocUpload label="Scan izin usaha (opsional)" value={f.license_url} onChange={set('license_url')} />
          </Card>
        </Entrance>
        <Entrance index={4}>
          <Card style={{ gap: 12 }}>
            <Text style={font.label}>4 · Status halal</Text>
            {/* Kartu pilihan dengan radio bulat */}
            {halalOptions.map((o) => {
              const active = f.is_halal === o.key;
              return (
                <PressableScale key={String(o.key)} onPress={() => set('is_halal')(o.key)} scaleTo={0.985} haptic={false} style={[s.option, active && s.optionActive]}>
                  <View style={s.pickIcon}><Ionicons name={o.icon} size={20} color={colors.primary} /></View>
                  <View style={{ flex: 1, minWidth: 0 }}><Text style={[font.body, { fontWeight: '700' }]}>{o.title}</Text><Text style={font.tiny}>{o.sub}</Text></View>
                  <View style={[s.radio, active && { borderColor: colors.primary }]}>{active && <View style={s.radioDot} />}</View>
                </PressableScale>
              );
            })}
            {f.is_halal ? (
              <>
                <Text style={font.tiny}>Lampirkan sertifikat halal (BPJPH/MUI) agar admin bisa memberi tanda "Halal terverifikasi".</Text>
                <Input label="No. sertifikat halal (opsional)" placeholder="ID00110000123456789" value={f.halal_cert_no} onChangeText={set('halal_cert_no')} />
                <DocUpload label="Scan sertifikat halal (opsional)" value={f.halal_cert_url} onChange={set('halal_cert_url')} color={colors.success} />
              </>
            ) : <Text style={font.tiny}>Merchant non-halal tetap bisa berjualan; pelanggan dapat memfilter "Halal" / "Non-halal" di AntarFood.</Text>}
          </Card>
        </Entrance>
        <Entrance index={5}>
          <Card style={{ gap: 12 }}>
            <Text style={font.label}>5 · Rekening pencairan (opsional)</Text>
            <Row gap={8} style={{ flexWrap: 'wrap' }}>{BANKS.map((b) => <Chip key={b} label={b} active={f.bank_name === b} onPress={() => set('bank_name')(b)} />)}</Row>
            <Row gap={10}>
              <Input label="No. rekening" keyboardType="number-pad" value={f.bank_account} onChangeText={set('bank_account')} containerStyle={{ flex: 1 }} />
              <Input label="Atas nama" value={f.bank_holder} onChangeText={set('bank_holder')} containerStyle={{ flex: 1 }} />
            </Row>
            <Row gap={8} style={s.note}><Ionicons name="lock-closed-outline" size={16} color={colors.primary} /><Text style={[font.tiny, { flex: 1 }]}>Data dokumen tersimpan privat, hanya dilihat admin verifikator (UU PDP).</Text></Row>
          </Card>
        </Entrance>
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  artCircle: { width: 124, height: 124, borderRadius: 62, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.primaryLight },
  fieldLabel: { fontSize: 14, fontWeight: '600', color: colors.textSecondary },
  pick: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.bgSoft, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: colors.border },
  pickIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center' },
  coverBox: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.border, borderRadius: 14, padding: 12, backgroundColor: '#fff' },
  coverImg: { width: 56, height: 56, borderRadius: 14, backgroundColor: colors.bgSoft },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: radius.md, backgroundColor: '#fff', borderWidth: 1.5, borderColor: colors.border, ...shadow.soft },
  optionActive: { borderColor: colors.primary, backgroundColor: colors.tint },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  radioDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.primary },
  note: { padding: 10, borderRadius: 14, backgroundColor: colors.tint, alignItems: 'flex-start' },
});
