// AntarRide / AntarCar — alur pemesanan "form dulu" (tahap 5):
//  layanan dikunci sesuai pilihan di beranda; peta disembunyikan (ikon peta per baris untuk titik presisi);
//  tujuan terakhir & sering dikunjungi; kelas kendaraan (hemat/standar/premium/listrik); booking terjadwal; iklan merchant.
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import { Screen, Button, Row, Badge, toast } from '@/components/ui';
import { PressableScale } from '@/components/motion';
import { LocationFields } from '@/components/LocationField';
import { DestinationSuggestions, VehicleClassPicker, SchedulePicker, MerchantAds, RoutePreview } from '@/components/BookingExtras';
import { PaymentSection, PriceSummary, paidViaOf, handleShortfall, type PayChoice } from '@/components/BookingSheet';
import { ServiceArt } from '@/components/ServiceArt';
import { LimitNotice, LimitInfo, ServiceDisabledEmpty, limitBlocked } from '@/components/ServiceLimit';
import { useAppSettings } from '@/hooks/useAppSettings';
import { usePayPrefs } from '@/store/payprefs';
import { useBooking } from '@/store/booking';
import { useAuth } from '@/store/auth';
import { useCurrentLocation } from '@/hooks/useLocation';
import { getRoute, reverseGeocode, type RouteResult } from '@/lib/geo';
import { rpc } from '@/lib/supabase';
import { colors, font, radius, motion, glass } from '@/lib/theme';
import { rupiah, minutes, km } from '@/lib/format';
import { serviceDef } from '@/lib/services';
import type { FareOptions, Order, ServiceType } from '@/lib/types';

export default function RideScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ service?: string }>();
  const service: ServiceType = params.service === 'ride_car' ? 'ride_car' : 'ride_motor';
  const def = serviceDef(service);
  const accent = def.color;
  const { pickup, dropoff, setPickup, setDropoff } = useBooking();
  const { location, hasFix, refresh } = useCurrentLocation();
  const refreshWallet = useAuth((s) => s.refreshWallet);
  const { isEnabled } = useAppSettings();
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [opts, setOpts] = useState<FareOptions | null>(null);
  const [loading, setLoading] = useState(false);
  const [cls, setCls] = useState<string | null>(null);
  const [when, setWhen] = useState<Date | null>(null);
  const [method, setMethod] = useState<PayChoice>('cash');
  const payPrefs = usePayPrefs((st) => st.prefs);
  const [promo, setPromo] = useState('');
  const [discount, setDiscount] = useState(0);
  const [notes, setNotes] = useState('');
  const [showDetails, setShowDetails] = useState(false);
  const [ordering, setOrdering] = useState(false);

  useEffect(() => {
    if (!pickup && hasFix) reverseGeocode(location).then((address) => { if (!useBooking.getState().pickup) setPickup({ ...location, address, name: 'Lokasi saya' }); });
  }, [hasFix]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!pickup || !dropoff) { setRoute(null); setOpts(null); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const r = await getRoute(pickup, dropoff);
      if (cancelled) return;
      setRoute(r);
      const o = await rpc<FareOptions>('fare_options', { p_service: service, p_pickup_lat: pickup.lat, p_pickup_lng: pickup.lng, p_drop_lat: dropoff.lat, p_drop_lng: dropoff.lng, p_route_km: r.distance_km, p_helpers: 0 }).catch(() => null);
      if (cancelled) return;
      setOpts(o);
      if (o && !o.classes.some((c) => c.code === cls)) {
        // Default: kelas Standar bila ada driver di sekitar; jika tidak, kelas pertama yang punya driver; terakhir kelas Standar
        const std = o.classes.find((c) => c.rank === 2 && !c.is_ev);
        const withDriver = (std && (std.drivers_nearby ?? 0) > 0) ? std : o.classes.find((c) => (c.drivers_nearby ?? 0) > 0 && !c.is_ev);
        setCls((withDriver ?? std ?? o.classes[0])?.code ?? null);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [pickup?.lat, pickup?.lng, dropoff?.lat, dropoff?.lng, service]); // eslint-disable-line react-hooks/exhaustive-deps

  const chosen = useMemo(() => opts?.classes.find((c) => c.code === cls) ?? null, [opts, cls]);
  const total = chosen ? Math.max(0, chosen.total - discount) : 0;
  // Batas jarak dalam kota & status layanan dari server (create_order juga menolak, ini agar pelanggan tahu lebih awal)
  const blocked = limitBlocked(opts?.limit);
  const serviceOff = opts?.service_enabled === false || !isEnabled(service);

  const order = async () => {
    if (!pickup || !dropoff || !chosen || blocked || serviceOff) return;
    setOrdering(true);
    try {
      const o = await rpc<Order>('create_order', { p: {
        service, pickup: { lat: pickup.lat, lng: pickup.lng, address: pickup.address }, dropoff: { lat: dropoff.lat, lng: dropoff.lng, address: dropoff.address },
        route_km: route?.distance_km, duration_min: route?.duration_min, route_geometry: route?.coords,
        payment_method: method === 'ewallet' ? 'wallet' : method, paid_via: paidViaOf(method, payPrefs?.ewallet), promo_code: promo || null, notes: notes || null,
        vehicle_class: chosen.code, scheduled_at: when ? when.toISOString() : null,
      } });
      await refreshWallet();
      useBooking.getState().reset();
      toast.success(when ? 'Booking terjadwal tersimpan' : 'Pesanan dibuat, mencari driver…');
      router.replace(`/order/${o.id}` as never);
    } catch (e) { if (!handleShortfall(e, router, payPrefs?.ewallet)) toast.error((e as Error).message); }
    finally { setOrdering(false); }
  };

  const ready = !!(pickup && dropoff);
  return (
    <Screen title={def.label} subtitle={def.id === 'ride_car' ? 'Mobil · 1–4 penumpang · Hemat, Standar, Premium, Listrik' : 'Ojek motor · cepat & hemat'} band={def.color} back maxWidth={640} footer={ready && chosen && !serviceOff ? (
      <View style={{ gap: 10 }}>
        <LimitNotice limit={opts?.limit} actionTitle="Buka AntarTravel" actionIcon="bus-outline" onAction={() => router.push('/travel' as never)} />
        <Button title={blocked ? 'Di luar jangkauan layanan' : `${when ? 'Booking' : 'Pesan'} ${chosen.label} · ${rupiah(total)}`} size="lg" color={accent} loading={ordering} disabled={loading || blocked} onPress={order} />
      </View>
    ) : undefined}>
      <View style={{ gap: 14 }}>
        {serviceOff && <ServiceDisabledEmpty onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))} />}
        {!serviceOff && <>
        <Row gap={12} style={s.hero}>
          <ServiceArt kind={def.art} color={accent} size={54} glow={false} />
          <View style={{ flex: 1 }}>
            <Text style={font.h3}>{service === 'ride_car' ? 'Mobil nyaman, pilih kelas sesuai kebutuhan' : 'Ojek motor cepat & hemat'}</Text>
            <Text style={font.tiny}>{service === 'ride_car' ? 'Hemat · Standar · Premium · Listrik' : 'Hemat · Standar · Listrik'} · bisa booking terjadwal</Text>
          </View>
        </Row>

        <LocationFields pickup={pickup} dropoff={dropoff} accent={accent} />
        <Row gap={8}>
          <PressableScale onPress={async () => { const p = await refresh(); if (p) { const a = await reverseGeocode(p); setPickup({ ...p, address: a, name: 'Lokasi saya' }); } }} scaleTo={0.96} style={s.smallBtn}><Ionicons name="locate" size={14} color={colors.info} /><Text style={s.smallBtnText}>Lokasi saya</Text></PressableScale>
          {pickup && dropoff && <PressableScale onPress={() => { const p = pickup; setPickup(dropoff); setDropoff(p); }} scaleTo={0.96} style={s.smallBtn}><Ionicons name="swap-vertical" size={14} color={colors.info} /><Text style={s.smallBtnText}>Tukar</Text></PressableScale>}
        </Row>

        {!dropoff && <DestinationSuggestions onPick={(p) => setDropoff(p)} service={service} />}
        </>}

        {ready && !serviceOff && (
          <Animated.View entering={FadeInDown.duration(motion.base)} layout={LinearTransition.springify().stiffness(300).damping(22)} style={{ gap: 14 }}>
            <Row gap={8} style={{ flexWrap: 'wrap' }}>
              <Badge text={loading || !route ? 'Menghitung rute…' : `${km(route.distance_km)} · ${minutes(route.duration_min)}${route.estimated ? ' (perkiraan)' : ''}`} color={colors.info} />
              {opts?.session && opts.session.multiplier !== 1 && <Badge text={`${opts.session.level === 'high' ? 'Jam sibuk' : 'Jam sepi'} ${opts.session.multiplier}×`} color={opts.session.level === 'high' ? colors.danger : colors.success} />}
            </Row>
            <RoutePreview pickup={pickup} dropoff={dropoff} polyline={route?.coords} accent={accent} />
            <VehicleClassPicker options={opts?.classes ?? []} value={cls} onChange={setCls} accent={accent} loading={loading} />
            <SchedulePicker value={when} onChange={setWhen} accent={accent} />
            {chosen && (
              <PressableScale onPress={() => setShowDetails(!showDetails)} scaleTo={0.99} haptic={false}>
                <Animated.View layout={LinearTransition.springify().stiffness(300).damping(22)} style={s.fareBox}>
                  <Row between>
                    <View><Text style={font.label}>Total {when ? 'booking' : 'estimasi'}</Text><Text style={{ fontSize: 26, fontWeight: '800', color: accent, letterSpacing: -0.5 }}>{rupiah(total)}</Text></View>
                    <View style={s.chev}><Ionicons name={showDetails ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textSecondary} /></View>
                  </Row>
                  {showDetails && (
                    <Animated.View entering={FadeInDown.duration(motion.fast)} style={{ marginTop: 10 }}>
                      <PriceSummary rows={[{ label: `${chosen.label} (${km(opts?.distance_km ?? 0)})`, value: chosen.fare }, { label: 'Biaya layanan', value: opts?.platform_fee ?? 0 }, { label: 'Diskon promo', value: discount, minus: true }]} total={total} />
                    </Animated.View>
                  )}
                  <LimitInfo limit={opts?.limit} service={service} style={{ marginTop: 8 }} />
                </Animated.View>
              </PressableScale>
            )}
            <PaymentSection method={method} onMethod={setMethod} promo={promo} onPromo={setPromo} notes={notes} onNotes={setNotes} subtotal={chosen?.fare ?? 0} service={service} onDiscount={setDiscount} />
            <MerchantAds near={dropoff} title="Lapar sesampainya? Merchant dekat tujuan" />
          </Animated.View>
        )}
        {!ready && <MerchantAds near={pickup} title="Promo merchant di sekitar Anda" max={4} />}
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  hero: { backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: radius.lg, padding: 12, borderWidth: 1, borderColor: glass.border },
  smallBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.full, backgroundColor: 'rgba(255,255,255,0.92)', borderWidth: 1, borderColor: glass.border },
  smallBtnText: { fontSize: 12, fontWeight: '700', color: colors.info },
  fareBox: { backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: radius.lg, padding: 14, borderWidth: 1, borderColor: glass.border },
  chev: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(11,31,42,0.06)', alignItems: 'center', justifyContent: 'center' },
});
