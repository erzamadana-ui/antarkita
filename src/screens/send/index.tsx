// AntarSend — dalam kota (kurir langsung) atau antar kota (driver antar ke gudang asal → drop point kota tujuan)
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import { Screen, Button, Row, Badge, Input, Chip, toast } from '@/components/ui';
import { PressableScale } from '@/components/motion';
import { LocationFields } from '@/components/LocationField';
import { DestinationSuggestions, SchedulePicker, RoutePreview } from '@/components/BookingExtras';
import { PaymentSection, PriceSummary, paidViaOf, handleShortfall, type PayChoice } from '@/components/BookingSheet';
import { ServiceArt } from '@/components/ServiceArt';
import { LimitNotice, LimitInfo, ServiceDisabledEmpty, limitBlocked } from '@/components/ServiceLimit';
import { useAppSettings } from '@/hooks/useAppSettings';
import { usePayPrefs } from '@/store/payprefs';
import { useBooking } from '@/store/booking';
import { useAuth } from '@/store/auth';
import { useCurrentLocation } from '@/hooks/useLocation';
import { getRoute, reverseGeocode, type RouteResult } from '@/lib/geo';
import { rpc, supabase } from '@/lib/supabase';
import { colors, font, radius, motion, glass } from '@/lib/theme';
import { rupiah, km, minutes } from '@/lib/format';
import type { FareEstimate, Order, City, Warehouse, IntercityEstimate } from '@/lib/types';

const TYPES = ['Dokumen', 'Makanan', 'Pakaian', 'Elektronik', 'Lainnya'];
const WEIGHTS: { label: string; kg: number }[] = [{ label: '< 1 kg', kg: 1 }, { label: '1–5 kg', kg: 5 }, { label: '5–10 kg', kg: 10 }, { label: '10–20 kg', kg: 20 }];

export default function SendScreen() {
  const router = useRouter();
  const { pickup, dropoff, setPickup, setDropoff } = useBooking();
  const { location, hasFix } = useCurrentLocation();
  const refreshWallet = useAuth((s) => s.refreshWallet);
  const { isEnabled } = useAppSettings();
  const [scope, setScope] = useState<'in_city' | 'intercity'>('in_city');
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [fare, setFare] = useState<FareEstimate | null>(null);
  const [loadingEst, setLoadingEst] = useState(false);
  const [method, setMethod] = useState<PayChoice>('cash');
  const payPrefs = usePayPrefs((st) => st.prefs);
  const [promo, setPromo] = useState('');
  const [discount, setDiscount] = useState(0);
  const [notes, setNotes] = useState('');
  const [recipient, setRecipient] = useState({ name: '', phone: '' });
  const [type, setType] = useState('Dokumen');
  const [weight, setWeight] = useState(WEIGHTS[0]);
  const [desc, setDesc] = useState('');
  const [when, setWhen] = useState<Date | null>(null);
  // antar kota
  const [cities, setCities] = useState<City[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [originCity, setOriginCity] = useState<City | null>(null);
  const [destCity, setDestCity] = useState<City | null>(null);
  const [destWh, setDestWh] = useState<Warehouse | null>(null);
  const [ic, setIc] = useState<IntercityEstimate | null>(null);
  const [ordering, setOrdering] = useState(false);

  useEffect(() => {
    if (!pickup && hasFix) reverseGeocode(location).then((address) => { if (!useBooking.getState().pickup) setPickup({ ...location, address, name: 'Lokasi saya' }); });
  }, [hasFix]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    supabase.from('cities').select('*').eq('active', true).order('name').then(({ data }) => setCities((data as City[]) ?? []));
    supabase.from('warehouses').select('*').eq('active', true).order('type').then(({ data }) => setWarehouses((data as Warehouse[]) ?? []));
  }, []);
  // kota asal dari titik jemput
  useEffect(() => {
    if (!pickup || cities.length === 0) return;
    supabase.rpc('nearest_city', { p_lat: pickup.lat, p_lng: pickup.lng, p_max_km: 60 }).then(({ data }) => setOriginCity(cities.find((c) => c.id === data) ?? null));
  }, [pickup?.lat, pickup?.lng, cities]); // eslint-disable-line react-hooks/exhaustive-deps
  // gudang asal terdekat (untuk estimasi ongkir leg pertama)
  const originWh = useMemo(() => {
    if (!originCity || !pickup) return null;
    const list = warehouses.filter((w) => w.city_id === originCity.id && w.lat && w.lng);
    return list.sort((a, b) => (a.type === 'big' ? -1 : 1) - (b.type === 'big' ? -1 : 1) || dist(pickup, a) - dist(pickup, b))[0] ?? null;
  }, [originCity, warehouses, pickup?.lat, pickup?.lng]); // eslint-disable-line react-hooks/exhaustive-deps
  const legDrop = scope === 'intercity' ? (originWh ? { lat: originWh.lat!, lng: originWh.lng!, address: originWh.name } : null) : dropoff;

  useEffect(() => {
    if (!pickup || !legDrop) { setRoute(null); setFare(null); return; }
    let cancelled = false;
    (async () => {
      setLoadingEst(true);
      const r = await getRoute(pickup, legDrop);
      if (cancelled) return;
      setRoute(r);
      const f = await rpc<FareEstimate>('estimate_fare', { p_service: 'send', p_pickup_lat: pickup.lat, p_pickup_lng: pickup.lng, p_drop_lat: legDrop.lat, p_drop_lng: legDrop.lng, p_route_km: r.distance_km }).catch(() => null);
      if (!cancelled) { setFare(f); setLoadingEst(false); }
    })();
    return () => { cancelled = true; };
  }, [pickup?.lat, pickup?.lng, legDrop?.lat, legDrop?.lng]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (scope !== 'intercity' || !originCity || !destCity) { setIc(null); return; }
    rpc<IntercityEstimate | null>('estimate_intercity', { p_from_city: originCity.id, p_to_city: destCity.id, p_weight_kg: weight.kg }).then(setIc).catch(() => setIc(null));
  }, [scope, originCity?.id, destCity?.id, weight.kg]); // eslint-disable-line react-hooks/exhaustive-deps

  const icFare = ic?.fare ?? 0;
  const total = fare ? Math.max(0, fare.fare + fare.platform_fee + icFare - discount) : 0;
  const phoneOk = /^(\+62|0)8\d{7,12}$/.test(recipient.phone.replace(/\s|-/g, ''));
  // Batas jarak hanya berlaku untuk pengiriman dalam kota; antar kota lewat gudang tidak dibatasi
  const blocked = scope === 'in_city' && limitBlocked(fare?.limit);
  const serviceOff = fare?.service_enabled === false || !isEnabled('send');
  const valid = !!(pickup && fare && recipient.name.trim().length >= 2 && phoneOk && (scope === 'in_city' ? dropoff : destCity && destWh && ic)) && !blocked && !serviceOff;
  const destWhs = warehouses.filter((w) => w.city_id === destCity?.id);

  const order = async () => {
    if (!valid || !pickup) return;
    setOrdering(true);
    try {
      const o = await rpc<Order>('create_order', { p: {
        service: 'send', pickup: { lat: pickup.lat, lng: pickup.lng, address: pickup.address },
        dropoff: scope === 'in_city' ? { lat: dropoff!.lat, lng: dropoff!.lng, address: dropoff!.address } : { lat: legDrop!.lat, lng: legDrop!.lng, address: legDrop!.address },
        route_km: route?.distance_km, duration_min: route?.duration_min, route_geometry: route?.coords, payment_method: method === 'ewallet' ? 'wallet' : method, paid_via: paidViaOf(method, payPrefs?.ewallet), promo_code: promo || null, notes: notes || null,
        recipient_name: recipient.name.trim(), recipient_phone: recipient.phone.trim(), package_details: { type, weight: weight.label, description: desc, dest_address: scope === 'intercity' ? `${destWh?.name} · ${destCity?.name}` : undefined },
        send_scope: scope, dest_city_id: destCity?.id ?? null, warehouse_id: destWh?.id ?? null, weight_kg: weight.kg, scheduled_at: when ? when.toISOString() : null,
      } });
      await refreshWallet();
      useBooking.getState().reset();
      router.replace(`/order/${o.id}` as never);
    } catch (e) { if (!handleShortfall(e, router, payPrefs?.ewallet)) toast.error((e as Error).message); }
    finally { setOrdering(false); }
  };

  return (
    <Screen title="AntarSend" subtitle="Kirim paket dalam kota & antar kota" band={colors.send} back maxWidth={640} footer={(valid || blocked) && !serviceOff ? (
      <View style={{ gap: 10 }}>
        <LimitNotice limit={fare?.limit} actionTitle="Pakai AntarSend Antar Kota" actionIcon="airplane-outline" onAction={() => setScope('intercity')} />
        <Button title={blocked ? 'Di luar jangkauan dalam kota' : `${when ? 'Booking' : 'Kirim'} ${scope === 'intercity' ? 'antar kota' : 'sekarang'} · ${rupiah(total)}`} size="lg" color={colors.send} loading={ordering} disabled={blocked} onPress={order} />
      </View>
    ) : undefined}>
      <View style={{ gap: 14 }}>
        {serviceOff && <ServiceDisabledEmpty onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))} />}
        {!serviceOff && <>
        <Row gap={12} style={s.hero}>
          <ServiceArt kind="send" color={colors.send} size={54} glow={false} />
          <View style={{ flex: 1 }}><Text style={font.h3}>Kirim paket</Text><Text style={font.tiny}>Dalam kota sampai hari ini · antar kota lewat gudang mitra</Text></View>
        </Row>
        <Row gap={8}>
          <ScopeBtn active={scope === 'in_city'} onPress={() => setScope('in_city')} icon="bicycle" title="Dalam kota" sub="Kurir langsung, ±1 jam" />
          <ScopeBtn active={scope === 'intercity'} onPress={() => setScope('intercity')} icon="airplane-outline" title="Antar kota" sub="Via gudang mitra, 1–3 hari" />
        </Row>

        {scope === 'in_city' ? (
          <>
            <LocationFields pickup={pickup} dropoff={dropoff} pickupLabel="Ambil dari" dropoffLabel="Antar ke" accent={colors.send} />
            {!dropoff && <DestinationSuggestions onPick={(p) => setDropoff(p)} service="send" title="Alamat antar terakhir" />}
          </>
        ) : (
          <View style={{ gap: 10 }}>
            <LocationFields pickup={pickup} dropoff={legDrop} pickupLabel="Ambil dari" dropoffLabel="Diantar ke gudang asal" lockDropoff accent={colors.send} />
            <View style={s.group}>
              <Row between><Text style={font.label}>Kota asal</Text><Badge text={originCity ? `${originCity.name} · ${originWh?.type === 'big' ? 'Gudang besar' : 'Drop point'}` : 'Di luar jangkauan'} color={originCity ? colors.send : colors.danger} /></Row>
              <Text style={font.label}>Kota tujuan</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                {cities.filter((c) => c.id !== originCity?.id).map((c) => <Chip key={c.id} label={c.name} active={destCity?.id === c.id} onPress={() => { setDestCity(c); setDestWh(null); }} color={colors.send} />)}
              </ScrollView>
              {destCity && (
                <Animated.View entering={FadeInDown.duration(motion.base)} style={{ gap: 8 }}>
                  <Text style={font.label}>Drop point di {destCity.name} (penerima ambil / diantar kurir lokal)</Text>
                  {destWhs.length === 0 && <Text style={font.tiny}>Belum ada gudang mitra di kota ini.</Text>}
                  {destWhs.map((w) => (
                    <PressableScale key={w.id} onPress={() => setDestWh(w)} scaleTo={0.985} style={[s.wh, destWh?.id === w.id && { borderColor: colors.send, backgroundColor: colors.send + '10' }]}>
                      <Ionicons name={w.type === 'big' ? 'business' : 'storefront'} size={20} color={colors.send} />
                      <View style={{ flex: 1 }}><Text style={{ fontWeight: '700', color: colors.text, fontSize: 13.5 }}>{w.name}</Text><Text style={font.tiny} numberOfLines={2}>{w.type === 'big' ? 'Gudang besar' : 'Gudang kecil / mitra'} · {w.partner_name} · {w.address} · {w.open_hours}</Text></View>
                      {destWh?.id === w.id && <Ionicons name="checkmark-circle" size={20} color={colors.send} />}
                    </PressableScale>
                  ))}
                  {ic && <Badge text={`Tarif antar kota ${rupiah(ic.fare)} · ±${ic.eta_days} hari · ${ic.weight_kg} kg`} color={colors.info} />}
                </Animated.View>
              )}
            </View>
          </View>
        )}

        {pickup && legDrop && (scope === 'in_city' || destWh) && (
          <Animated.View entering={FadeInDown.duration(motion.base)} layout={LinearTransition.springify().stiffness(300).damping(22)} style={{ gap: 14 }}>
            <Row gap={8} style={{ flexWrap: 'wrap' }}>
              <Badge text={!route ? 'Menghitung rute…' : `${km(route.distance_km)} · ${minutes(route.duration_min)}${scope === 'intercity' ? ' ke gudang' : ''}`} color={colors.info} />
              {fare && <Badge text={`Ongkir ${rupiah(fare.fare + fare.platform_fee + icFare)}`} color={colors.send} />}
            </Row>
            <RoutePreview pickup={pickup} dropoff={legDrop} polyline={route?.coords} accent={colors.send} />
            <View style={s.group}>
              <Text style={font.label}>Penerima</Text>
              <Input placeholder="Nama penerima" icon="person-outline" value={recipient.name} onChangeText={(v) => setRecipient({ ...recipient, name: v })} />
              <Input placeholder="Nomor HP penerima" icon="call-outline" keyboardType="phone-pad" value={recipient.phone} onChangeText={(v) => setRecipient({ ...recipient, phone: v })} />
            </View>
            <View style={s.group}>
              <Text style={font.label}>Detail paket</Text>
              <Row gap={8} style={{ flexWrap: 'wrap' }}>{TYPES.map((t) => <Chip key={t} label={t} active={type === t} onPress={() => setType(t)} color={colors.send} />)}</Row>
              <Row gap={8} style={{ flexWrap: 'wrap' }}>{WEIGHTS.map((w) => <Chip key={w.label} label={w.label} active={weight.label === w.label} onPress={() => setWeight(w)} color={colors.send} />)}</Row>
              <Input placeholder="Deskripsi isi paket (opsional)" icon="document-text-outline" value={desc} onChangeText={setDesc} />
            </View>
            <SchedulePicker value={when} onChange={setWhen} accent={colors.send} />
            {fare && <View style={s.group}><PriceSummary rows={[{ label: `Ongkos kurir (${km(fare.distance_km)})`, value: fare.fare }, ...(icFare ? [{ label: `Antar kota ${originCity?.name} → ${destCity?.name}`, value: icFare }] : []), { label: 'Biaya layanan', value: fare.platform_fee }, { label: 'Diskon promo', value: discount, minus: true }]} total={total} />{scope === 'in_city' && <LimitInfo limit={fare.limit} />}</View>}
            <PaymentSection method={method} onMethod={setMethod} promo={promo} onPromo={setPromo} notes={notes} onNotes={setNotes} subtotal={fare?.fare ?? 0} service="send" onDiscount={setDiscount} notesPlaceholder="Catatan (mis. titip di satpam)" />
            <Text style={font.tiny}>Barang terlarang: narkoba, senjata, hewan hidup, barang mudah terbakar. Maks. nilai barang Rp2.000.000.{scope === 'intercity' ? ' Paket antar kota diasuransikan s.d. Rp1.000.000.' : ''}</Text>
          </Animated.View>
        )}
        </>}
      </View>
    </Screen>
  );
}

function dist(a: { lat: number; lng: number }, b: { lat: number | null; lng: number | null }) { return Math.hypot(a.lat - (b.lat ?? 0), a.lng - (b.lng ?? 0)); }
function ScopeBtn({ active, onPress, icon, title, sub }: { active: boolean; onPress: () => void; icon: string; title: string; sub: string }) {
  return (
    <PressableScale onPress={onPress} scaleTo={0.97} style={[s.scope, active && { borderColor: colors.send, backgroundColor: colors.send + '12' }]}>
      <Ionicons name={icon as never} size={20} color={active ? colors.send : colors.textSecondary} />
      <View style={{ flex: 1, minWidth: 0 }}><Text style={{ fontWeight: '800', color: colors.text, fontSize: 14 }}>{title}</Text><Text style={font.tiny} numberOfLines={1}>{sub}</Text></View>
    </PressableScale>
  );
}

const s = StyleSheet.create({
  hero: { backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: radius.lg, padding: 12, borderWidth: 1, borderColor: glass.border },
  scope: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: radius.lg, borderWidth: 1.5, borderColor: glass.border, backgroundColor: 'rgba(255,255,255,0.92)' },
  group: { gap: 10, backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: radius.lg, padding: 12, borderWidth: 1, borderColor: glass.border },
  wh: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: radius.md, borderWidth: 1.5, borderColor: glass.border, backgroundColor: 'rgba(255,255,255,0.92)' },
});
