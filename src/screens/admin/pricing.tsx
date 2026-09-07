import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Switch } from 'react-native';
import { AdminPage, adminFont as font, adminTone, adminSpace, AdminSelect, AdminCard as Card } from '@/components/admin';
import { Row, Input, Button, Badge, toast } from '@/components/ui';
import { PromoCard } from '@/components/PromoCard';
import { Image, Pressable, StyleSheet } from 'react-native';
import { pickAndUpload } from '@/lib/upload';
import { useAuth } from '@/store/auth';
import { ScrollView } from 'react-native';
import { Entrance } from '@/components/motion';
import { supabase } from '@/lib/supabase';
import { colors } from '@/lib/theme';
import { serviceLabel } from '@/lib/format';
import type { Pricing, Promo, ServiceType } from '@/lib/types';

const numFields: (keyof Pricing)[] = ['base_fare', 'per_km', 'min_fare', 'platform_fee', 'commission_pct', 'merchant_commission_pct', 'surge_multiplier'];
const labels: Record<string, string> = { base_fare: 'Tarif dasar', per_km: 'Per km', min_fare: 'Tarif minimal', platform_fee: 'Biaya layanan', commission_pct: 'Komisi driver %', merchant_commission_pct: 'Komisi merchant %', surge_multiplier: 'Pengali surge' };
const emptyPromo = { code: '', title: '', description: '', discount_type: 'fixed', value: '', max_discount: '', min_total: '0', service: '', quota: '', image_url: '' };

export default function AdminPricing() {
  const [pricing, setPricing] = useState<Record<string, Record<string, string>>>({});
  const [promos, setPromos] = useState<Promo[]>([]);
  const [np, setNp] = useState({ ...emptyPromo });
  const session = useAuth((s) => s.session);
  const load = useCallback(async () => {
    const [{ data: p }, { data: pr }] = await Promise.all([supabase.from('pricing').select('*'), supabase.from('promos').select('*').order('code')]);
    const map: Record<string, Record<string, string>> = {};
    ((p as Pricing[]) ?? []).forEach((row) => { map[row.service] = Object.fromEntries(numFields.map((k) => [k, String(row[k])])); });
    setPricing(map); setPromos((pr as Promo[]) ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const savePricing = async (service: string) => {
    const v = pricing[service];
    const payload = Object.fromEntries(numFields.map((k) => [k, Number(v[k])]));
    const { error } = await supabase.from('pricing').update({ ...payload, updated_at: new Date().toISOString() }).eq('service', service);
    if (error) return toast.error(error.message);
    toast.success(`Tarif ${serviceLabel[service as ServiceType]} disimpan`);
  };
  const savePromo = async () => {
    if (!np.code || !np.value) return toast.error('Kode dan nilai wajib diisi');
    const { error } = await supabase.from('promos').upsert({ code: np.code.toUpperCase(), title: np.title || null, image_url: np.image_url || null, description: np.description || null, discount_type: np.discount_type, value: Number(np.value), max_discount: np.max_discount ? Number(np.max_discount) : null, min_total: Number(np.min_total) || 0, service: np.service || null, quota: np.quota ? Number(np.quota) : null, is_active: true });
    if (error) return toast.error(error.message);
    setNp({ ...emptyPromo }); toast.success('Promo disimpan'); load();
  };
  const togglePromo = async (p: Promo) => { await supabase.from('promos').update({ is_active: !p.is_active }).eq('code', p.code); load(); };

  return (
    <AdminPage title="Tarif & Promo" subtitle="Perubahan langsung berlaku untuk pesanan baru" onRefresh={load}>
      <Card padded={false}>
        <View style={{ padding: 14 }}><Text style={font.label}>Tarif per layanan (baris) · kelas kendaraan memakai pengali: Hemat ×0,9 · Standar ×1 · Premium ×1,35 · Listrik ×1,1 · Listrik Premium ×1,45 · Pick Up ×1 · Box ×1,4</Text></View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={{ minWidth: 1060 }}>
            <Row gap={8} style={s.th}>
              <Text style={[font.label, { width: 120 }]}>Layanan</Text>
              {numFields.map((k) => <Text key={k} style={[font.label, { width: 104, textAlign: 'right' }]}>{labels[k]}</Text>)}
              <Text style={[font.label, { width: 90 }]} />
            </Row>
            {Object.entries(pricing).map(([service, v], i) => (
              <Row key={service} gap={8} style={[s.tr, i % 2 ? s.trAlt : null]}>
                <Text style={[font.bodyStrong, { width: 120 }]} numberOfLines={1}>{serviceLabel[service as ServiceType] ?? service}</Text>
                {numFields.map((k) => <Input key={k} value={v[k]} keyboardType="decimal-pad" onChangeText={(t) => setPricing((p) => ({ ...p, [service]: { ...p[service], [k]: t } }))} containerStyle={{ width: 104 }} style={{ textAlign: 'right', paddingVertical: 6 }} />)}
                <Button title="Simpan" size="sm" onPress={() => savePricing(service)} style={{ width: 90 }} />
              </Row>
            ))}
          </View>
        </ScrollView>
      </Card>
      <Entrance index={0}>
        <Card style={{ gap: 10 }}>
          <Row between><Text style={font.label}>Promo ({promos.filter((p) => p.is_active).length} aktif · thumbnail tampil di beranda pelanggan, maks. 20)</Text><Text style={font.tiny}>ketuk baris untuk mengubah</Text></Row>
          {promos.map((p) => (
            <Row key={p.code} between style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8 }}>
              <PressableThumb promo={p} onPress={() => setNp({ code: p.code, title: p.title ?? '', description: p.description ?? '', discount_type: p.discount_type, value: String(p.value), max_discount: p.max_discount ? String(p.max_discount) : '', min_total: String(p.min_total), service: p.service ?? '', quota: p.quota ? String(p.quota) : '', image_url: p.image_url ?? '' })} />
              <View style={{ flex: 1 }}>
                <Row gap={8}><Text style={font.h3}>{p.code}</Text><Badge text={p.discount_type === 'percent' ? `${p.value}%${p.max_discount ? ` maks ${p.max_discount}` : ''}` : `Rp${p.value}`} />{!!p.service && <Badge text={serviceLabel[p.service]} color={colors.info} />}</Row>
                <Text style={font.tiny}>{p.description} · min Rp{p.min_total} · dipakai {p.used_count}{p.quota ? `/${p.quota}` : ''}</Text>
              </View>
              <Switch value={p.is_active} onValueChange={() => togglePromo(p)} trackColor={{ true: colors.success, false: colors.border }} thumbColor="#fff" />
            </Row>
          ))}
          <Text style={[font.h3, { marginTop: 8 }]}>Tambah / ubah promo</Text>
          <Row gap={10} style={{ flexWrap: 'wrap' }}>
            <Input placeholder="KODE" value={np.code} onChangeText={(v) => setNp({ ...np, code: v.toUpperCase() })} containerStyle={{ minWidth: 140, flex: 1 }} autoCapitalize="characters" />
            <Input placeholder="Judul di kartu (mis. Diskon 50% Pengguna Baru)" value={np.title} onChangeText={(v) => setNp({ ...np, title: v })} containerStyle={{ minWidth: 220, flex: 2 }} />
          </Row>
          <Row gap={10} style={{ flexWrap: 'wrap' }}>
            <Input placeholder="Deskripsi syarat" value={np.description} onChangeText={(v) => setNp({ ...np, description: v })} containerStyle={{ minWidth: 220, flex: 2 }} />
            <Button size="sm" variant="outline" icon="image-outline" title={np.image_url ? 'Ganti gambar' : 'Unggah gambar (16:9)'} onPress={async () => { if (!session) return; try { const r = await pickAndUpload('promo-images', session.user.id); if (r) setNp({ ...np, image_url: r.url }); } catch (e) { toast.error((e as Error).message); } }} />
            {np.image_url ? <Button size="sm" variant="ghost" color={colors.danger} title="Hapus gambar" onPress={() => setNp({ ...np, image_url: '' })} /> : null}
          </Row>
          <Row gap={10} style={{ flexWrap: 'wrap' }}>
            <Row gap={6}><Button size="sm" title="Nominal" variant={np.discount_type === 'fixed' ? 'primary' : 'outline'} onPress={() => setNp({ ...np, discount_type: 'fixed' })} /><Button size="sm" title="Persen" variant={np.discount_type === 'percent' ? 'primary' : 'outline'} onPress={() => setNp({ ...np, discount_type: 'percent' })} /></Row>
            <Input placeholder={np.discount_type === 'percent' ? 'Nilai %' : 'Nilai Rp'} keyboardType="number-pad" value={np.value} onChangeText={(v) => setNp({ ...np, value: v })} containerStyle={{ width: 110 }} />
            <Input placeholder="Maks diskon" keyboardType="number-pad" value={np.max_discount} onChangeText={(v) => setNp({ ...np, max_discount: v })} containerStyle={{ width: 120 }} />
            <Input placeholder="Min transaksi" keyboardType="number-pad" value={np.min_total} onChangeText={(v) => setNp({ ...np, min_total: v })} containerStyle={{ width: 120 }} />
            <Input placeholder="Kuota" keyboardType="number-pad" value={np.quota} onChangeText={(v) => setNp({ ...np, quota: v })} containerStyle={{ width: 90 }} />
          </Row>
          <AdminSelect label="Berlaku untuk layanan" icon="layers-outline" width={240} value={np.service} clearable clearLabel="Semua layanan"
            options={[['ride_motor', 'AntarRide'], ['ride_car', 'AntarCar'], ['food', 'AntarFood'], ['send', 'AntarSend'], ['shop', 'AntarShop']].map(([k, l]) => ({ value: k, label: l }))}
            onChange={(v) => setNp({ ...np, service: v })} />
          <Button title="Simpan promo" onPress={savePromo} />
        </Card>
      </Entrance>
    </AdminPage>
  );
}

function PressableThumb({ promo, onPress }: { promo: Promo; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ marginRight: 10 }}>
      {promo.image_url ? <Image source={{ uri: promo.image_url }} style={{ width: 96, height: 54, borderRadius: 8, backgroundColor: colors.border }} /> : <PromoCard promo={promo} width={96} height={54} />}
    </Pressable>
  );
}
const s = StyleSheet.create({
  th: { paddingHorizontal: adminSpace.lg, paddingVertical: adminSpace.sm, borderTopWidth: 1, borderTopColor: adminTone.border, backgroundColor: adminTone.surfaceAlt },
  tr: { paddingHorizontal: adminSpace.lg, paddingVertical: 6, borderTopWidth: 1, borderTopColor: adminTone.border, alignItems: 'center', minHeight: 56 },
  trAlt: { backgroundColor: adminTone.zebra },
});
