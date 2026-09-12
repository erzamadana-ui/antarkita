import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, TextInput } from 'react-native';
import Animated, { LinearTransition } from 'react-native-reanimated';
import { Entrance, PressableScale } from '@/components/motion';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Screen, Card, Row, Stepper, Button, Badge, Empty, toast } from '@/components/ui';
import { PaymentSection, PriceSummary, paidViaOf, handleShortfall, type PayChoice } from '@/components/BookingSheet';
import { AntarNowSection, useAntarNowCode } from '@/components/antarnow';
import { LimitNotice, LimitInfo, ServiceDisabledEmpty, limitBlocked } from '@/components/ServiceLimit';
import { CityNotice, cityBlockedLabel } from '@/components/city';
import { useAppSettings } from '@/hooks/useAppSettings';
import { useCityStatus } from '@/hooks/useCityStatus';
import { usePayPrefs } from '@/store/payprefs';
import { useCart } from '@/store/cart';
import { useBooking } from '@/store/booking';
import { useAuth } from '@/store/auth';
import { useCurrentLocation } from '@/hooks/useLocation';
import { getRoute, reverseGeocode, finalizeRoute, type RouteResult } from '@/lib/geo';
import { rpc } from '@/lib/supabase';
import { createOrder } from '@/lib/orders';
import { colors, font, radius, glass } from '@/lib/theme';
import { rupiah, km, minutes } from '@/lib/format';
import type { FareEstimate, PaymentMethod } from '@/lib/types';

export default function Checkout() {
  const router = useRouter();
  const cart = useCart();
  const { dropoff, setDropoff } = useBooking();
  const { location, hasFix } = useCurrentLocation();
  // Gerbang wilayah: titik jemput AntarFood adalah LOKASI MERCHANT — sama seperti create_order.
  const { status: city, blocked: cityBlockedFor } = useCityStatus(hasFix ? location : null);
  const cityBlocked = cityBlockedFor('food');
  const refreshWallet = useAuth((s) => s.refreshWallet);
  const { isEnabled } = useAppSettings();
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [fare, setFare] = useState<FareEstimate | null>(null);
  const [method, setMethod] = useState<PayChoice>('cash');
  const payPrefs = usePayPrefs((st) => st.prefs);
  const [promo, setPromo] = useState('');
  const [discount, setDiscount] = useState(0);
  const [notes, setNotes] = useState('');
  const m = cart.merchant;
  const subtotal = cart.subtotal();

  useEffect(() => {
    if (!dropoff && hasFix) reverseGeocode(location).then((address) => { if (!useBooking.getState().dropoff) setDropoff({ ...location, address, name: 'Lokasi saya' }); });
  }, [hasFix]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!m || !dropoff || m.lat == null || m.lng == null) return;
    let cancelled = false;
    (async () => {
      const r = await getRoute({ lat: m.lat!, lng: m.lng! }, dropoff);
      if (cancelled) return;
      setRoute(r);
      const f = await rpc<FareEstimate>('estimate_fare', { p_service: 'food', p_pickup_lat: m.lat, p_pickup_lng: m.lng, p_drop_lat: dropoff.lat, p_drop_lng: dropoff.lng, p_route_km: r.distance_km }).catch(() => null);
      if (!cancelled) setFare(f);
    })();
    return () => { cancelled = true; };
  }, [m?.id, dropoff?.lat, dropoff?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  // AntarNow (Tahap 11): kode driver yang sudah divalidasi & cocok dengan layanan ini (null bila tidak dipakai)
  const driverCode = useAntarNowCode('food');
  if (!m || cart.lines.length === 0) {
    return <Screen title="Keranjang" back><Empty icon="cart-outline" title="Keranjang kosong" subtitle="Pilih menu dari merchant AntarFood." action={<Button title="Cari makanan" onPress={() => router.replace('/food')} />} /></Screen>;
  }
  const total = fare ? Math.max(0, subtotal + fare.fare + fare.platform_fee - discount) : subtotal;
  const blocked = limitBlocked(fare?.limit);
  const serviceOff = fare?.service_enabled === false || !isEnabled('food');
  if (serviceOff) {
    return <Screen title="Checkout" back ambient="amber"><ServiceDisabledEmpty onBack={() => router.replace('/food')} /></Screen>;
  }

  const order = async () => {
    if (!dropoff || !fare || blocked || cityBlocked) return;
    try {
      // Hemat §5.3: rute sungguhan (GEOMETRI saja) baru diambil DI SINI. Jarak/durasi
      // tetap angka pratinjau yang menjadi dasar harga yang ditampilkan.
      const fin = await finalizeRoute({ lat: m.lat!, lng: m.lng! }, dropoff, route);
      const o = await createOrder({
        service: 'food', merchant_id: m.id, dropoff: { lat: dropoff.lat, lng: dropoff.lng, address: dropoff.address },
        route_km: fin.route_km, duration_min: fin.duration_min, route_geometry: fin.coords, payment_method: method === 'ewallet' ? 'wallet' : method, paid_via: paidViaOf(method, payPrefs?.ewallet), promo_code: promo || null, notes: notes || null,
        items: cart.lines.map((l) => ({ menu_item_id: l.item.id, qty: l.qty, notes: l.notes || null })),
        driver_code: driverCode,
      });
      cart.clear(); await refreshWallet(); useBooking.getState().reset();
      router.replace(`/order/${o.id}` as never);
    } catch (e) { if (!handleShortfall(e, router, payPrefs?.ewallet)) toast.error((e as Error).message); }
  };

  return (
    <Screen title="Checkout" back ambient="amber" footer={(
      <View style={{ gap: 10 }}>
        <LimitNotice limit={fare?.limit} />
        <Button title={cityBlocked ? cityBlockedLabel(city, 'food') : blocked ? 'Merchant di luar jangkauan' : fare ? `Pesan Sekarang · ${rupiah(total)}` : 'Menghitung ongkir…'} size="lg" color={colors.food} disabled={!fare || !dropoff || blocked || cityBlocked} onPress={order} />
      </View>
    )}>
      <View style={{ gap: 16 }}>
        {/* Penjelasan di awal checkout supaya pelanggan tidak selesai mengisi lalu gagal. */}
        <CityNotice status={city} service="food" />
        <Entrance index={0}><Card>
          <Text style={font.label}>Antar ke</Text>
          <PressableScale scaleTo={0.98} haptic={false} onPress={() => router.push({ pathname: '/place-picker', params: { target: 'dropoff', title: 'Alamat pengantaran' } } as never)} style={s.addr}>
            <Ionicons name="location" size={24} color={colors.danger} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '700', color: colors.text }}>{dropoff?.name ?? 'Pilih alamat'}</Text>
              <Text style={font.small} numberOfLines={2}>{dropoff?.address ?? 'Ketuk untuk memilih alamat pengantaran'}</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
          </PressableScale>
          {route && <Row gap={8} style={{ marginTop: 10 }}><Badge text={`${km(route.distance_km)} dari ${m.name}`} color={colors.info} /><Badge text={`Tiba ±${minutes((route.duration_min ?? 0) + m.prep_minutes)}`} color={colors.success} /></Row>}
        </Card></Entrance>

        <Entrance index={1}><Card>
          <Row between style={{ marginBottom: 8 }}>
            <Text style={font.h3}>{m.name}</Text>
            <Pressable onPress={() => router.push(`/food/${m.id}` as never)}><Text style={{ color: colors.food, fontWeight: '700' }}>+ Tambah</Text></Pressable>
          </Row>
          {cart.lines.map((l) => (
            <Animated.View key={l.item.id} layout={LinearTransition.springify().stiffness(280).damping(20)} style={s.line}>
              <Row between>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '600', color: colors.text }}>{l.item.name}</Text>
                  <Text style={font.small}>{rupiah(l.item.price)} × {l.qty}</Text>
                </View>
                <Stepper value={l.qty} onChange={(v) => cart.setQty(l.item.id, v)} />
              </Row>
              <TextInput placeholder="Catatan untuk menu ini (mis. tidak pedas)" placeholderTextColor={colors.textMuted} value={l.notes ?? ''} onChangeText={(v) => cart.setNotes(l.item.id, v)} style={s.noteInput} />
            </Animated.View>
          ))}
        </Card></Entrance>

        <Entrance index={2}><Card>
          <Text style={[font.label, { marginBottom: 10 }]}>Rincian pembayaran</Text>
          <PriceSummary rows={[{ label: 'Harga makanan', value: subtotal }, { label: `Ongkos kirim (${fare ? km(fare.distance_km) : '…'})`, value: fare?.fare ?? 0 }, { label: 'Biaya layanan', value: fare?.platform_fee ?? 0 }, { label: 'Diskon promo', value: discount, minus: true }]} total={total} />
          <LimitInfo limit={fare?.limit} service="food" style={{ marginTop: 8 }} />
        </Card></Entrance>

        <Entrance index={3}><Card>
          <AntarNowSection service="food" accent={colors.food} />
          <PaymentSection method={method} onMethod={setMethod} promo={promo} onPromo={setPromo} notes={notes} onNotes={setNotes} subtotal={subtotal + (fare?.fare ?? 0)} service="food" onDiscount={setDiscount} notesPlaceholder="Catatan untuk driver (mis. patokan rumah)" />
        </Card></Entrance>
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  addr: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 6 },
  line: { borderTopWidth: 1, borderTopColor: 'rgba(11,31,42,0.07)', paddingVertical: 10, gap: 6 },
  noteInput: { backgroundColor: 'rgba(255,255,255,0.92)', borderWidth: 1, borderColor: glass.border, borderRadius: radius.sm, paddingHorizontal: 10, height: 36, fontSize: 14, color: colors.text },
});
