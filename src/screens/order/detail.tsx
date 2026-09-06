import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Alert, Platform, TextInput } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeIn, FadeInDown, FadeOut, LinearTransition, ZoomIn } from 'react-native-reanimated';
import { MapView } from '@/components/map';
import type { MapMarker } from '@/components/map';
import { Button, Row, Badge, Loading, Divider, Stars, toast, Empty } from '@/components/ui';
import { MapScreen } from '@/components/MapScreen';
import { Radar, ProgressBar, LiveDot, PressableScale } from '@/components/motion';
import { AmbientBackground } from '@/components/glass';
import { PersonCard, RouteBlock, OrderExtras, PriceBlock, Timeline, driverSubtitle } from '@/components/OrderDetails';
import { TipCard, ExtrasApproval } from '@/components/TipExtras';
import { PinCard, SafetyRow, DriverVerifyCard } from '@/components/Safety';
import { MerchantAds } from '@/components/BookingExtras';
import { WaitApology } from '@/components/WaitApology';
import { useOrder } from '@/hooks/useOrder';
import { useAppSettings } from '@/hooks/useAppSettings';
import { useAuth } from '@/store/auth';
import { useBooking } from '@/store/booking';
import { rpc, supabase } from '@/lib/supabase';
import { colors, font, radius, motion, shadow } from '@/lib/theme';
import { statusLabel, statusColor, rupiah, serviceLabel } from '@/lib/format';
import { serviceDef } from '@/lib/services';
import type { Order, OrderStatus } from '@/lib/types';

const STEPS: { key: OrderStatus; label: string; icon: string }[] = [
  { key: 'searching', label: 'Mencari', icon: 'search' },
  { key: 'accepted', label: 'Menuju', icon: 'navigate' },
  { key: 'arrived', label: 'Tiba', icon: 'location' },
  { key: 'in_progress', label: 'Jalan', icon: 'flag' },
  { key: 'completed', label: 'Selesai', icon: 'checkmark' },
];
const stepIndex = (s: OrderStatus) => Math.max(0, STEPS.findIndex((x) => x.key === s));

export default function OrderTracking() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { order, driver, events, loading, reload } = useOrder(id);
  const refreshWallet = useAuth((s) => s.refreshWallet);
  const { waitApologyMinutes } = useAppSettings();
  const [rated, setRated] = useState<{ driver?: number; merchant?: number }>({});
  const [comment, setComment] = useState('');

  useEffect(() => {
    if (order?.status === 'completed' || order?.status === 'cancelled') refreshWallet();
    if (order?.status === 'completed' && id) supabase.from('ratings').select('ratee_kind,stars').eq('order_id', id).then(({ data }) => {
      const r: { driver?: number; merchant?: number } = {};
      (data as { ratee_kind: 'driver' | 'merchant'; stars: number }[] | null)?.forEach((x) => { r[x.ratee_kind] = x.stars; });
      setRated(r);
    });
  }, [order?.status, id, refreshWallet]);

  const markers = useMemo<MapMarker[]>(() => {
    if (!order) return [];
    const m: MapMarker[] = [
      { id: 'pickup', lat: order.pickup_lat, lng: order.pickup_lng, kind: order.service === 'food' || order.service === 'shop' ? 'merchant' : 'pickup' },
      { id: 'dropoff', lat: order.dropoff_lat, lng: order.dropoff_lng, kind: 'dropoff' },
    ];
    if (driver?.lat && driver.lng && ['accepted', 'arrived', 'in_progress'].includes(order.status)) m.push({ id: 'driver', lat: driver.lat, lng: driver.lng, kind: driver.vehicle_type === 'car' ? 'car' : 'motor', heading: driver.heading });
    return m;
  }, [order, driver]);
  const fitTo = useMemo(() => {
    if (!order) return null;
    const pk = { lat: order.pickup_lat, lng: order.pickup_lng }, dp = { lat: order.dropoff_lat, lng: order.dropoff_lng };
    const dr = driver?.lat && driver.lng ? { lat: driver.lat, lng: driver.lng } : null;
    if ((order.status === 'accepted' || order.status === 'arrived') && dr) return [dr, pk];
    if (order.status === 'in_progress' && dr) return [dr, dp];
    return [pk, dp];
  }, [order, driver?.lat, driver?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  const cancel = () => {
    const doIt = async (reason: string) => { try { await rpc('cancel_order', { p_order_id: id, p_reason: reason }); toast.show('Pesanan dibatalkan'); reload(); } catch (e) { toast.error((e as Error).message); } };
    if (Platform.OS === 'web') { const r = prompt('Alasan pembatalan (opsional):'); if (r !== null) doIt(r || 'Dibatalkan pelanggan'); return; }
    Alert.alert('Batalkan pesanan?', 'Pesanan yang sudah dibayar AntarPay akan dikembalikan ke saldo.', [{ text: 'Tidak' }, { text: 'Ya, batalkan', style: 'destructive', onPress: () => doIt('Dibatalkan pelanggan') }]);
  };
  const rate = async (kind: 'driver' | 'merchant', stars: number) => {
    try { await rpc('rate_order', { p_order_id: id, p_kind: kind, p_stars: stars, p_comment: comment || null }); setRated((r) => ({ ...r, [kind]: stars })); toast.success('Terima kasih atas penilaian Anda'); }
    catch (e) { toast.error((e as Error).message); }
  };

  if (loading) return <View style={{ flex: 1 }}><AmbientBackground /><SafeAreaView style={{ flex: 1 }}><Loading text="Memuat pesanan…" /></SafeAreaView></View>;
  if (!order) return <View style={{ flex: 1 }}><AmbientBackground /><SafeAreaView style={{ flex: 1 }}><Empty icon="alert-circle-outline" title="Pesanan tidak ditemukan" subtitle="Pesanan tidak ada atau Anda tidak memiliki akses." action={<Button title="Kembali" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />} /></SafeAreaView></View>;
  const def = serviceDef(order.service);
  const active = !['completed', 'cancelled'].includes(order.status);
  const canCancel = ['scheduled', 'searching', 'accepted', 'arrived'].includes(order.status);
  const scheduled = order.status === 'scheduled';
  const sc = statusColor(order.status);
  const searching = order.status === 'searching';

  const header = (
    <View style={{ gap: 12 }}>
      <Row gap={12}>
        <Animated.View key={order.status} entering={ZoomIn.duration(motion.base)} style={[s.statusIcon, { backgroundColor: sc + '1A' }]}>
          {searching ? <LiveDot color={colors.warning} size={12} /> : <Ionicons name={(order.status === 'completed' ? 'checkmark-circle' : order.status === 'cancelled' ? 'close-circle' : def.icon) as never} size={24} color={sc} />}
        </Animated.View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Animated.Text key={`t-${order.status}-${order.merchant_status ?? ''}`} entering={FadeIn.duration(motion.base)} style={font.h3} numberOfLines={1}>{statusLabel(order.status, order.service, order.merchant_status)}</Animated.Text>
          <Text style={font.tiny} numberOfLines={1}>{serviceLabel[order.service]} · {subtitle(order)}</Text>
        </View>
        <Text style={{ fontWeight: '800', fontSize: 16, color: colors.primary }}>{rupiah(order.total)}</Text>
      </Row>
      {order.status !== 'cancelled' && <StatusStepper status={order.status} color={sc} />}
    </View>
  );

  return (
    <MapScreen
      map={<MapView center={{ lat: order.pickup_lat, lng: order.pickup_lng }} markers={markers} polyline={order.route_geometry} fitTo={fitTo} paddingBottom={20} />}
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/' as never))}
      floatingTag={<Text style={{ fontWeight: '800', fontSize: 12, color: colors.text, letterSpacing: 0.5 }}>{order.code}</Text>}
      header={header}
      minHeight={searching ? 250 : 210}
      maxRatio={0.66}
      initiallyExpanded={!active}
    >
      <Animated.View layout={LinearTransition.springify().stiffness(280).damping(18)} style={{ gap: 14 }}>
        {scheduled && (
          <Animated.View entering={FadeIn.duration(motion.slow)} exiting={FadeOut.duration(motion.fast)} style={s.radarBox}>
            <View style={s.iconTint}><Ionicons name="calendar-outline" size={30} color={colors.primary} /></View>
            <Text style={[font.h3, { marginTop: 6 }]}>Booking terjadwal</Text>
            <Text style={[font.small, { textAlign: 'center' }]}>{order.scheduled_at ? new Date(order.scheduled_at).toLocaleString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) + ' WIB' : ''}{'\n'}Driver dicarikan otomatis ±20 menit sebelum jadwal. Anda akan diberi tahu saat driver ditugaskan.</Text>
          </Animated.View>
        )}
        {searching && (
          <Animated.View entering={FadeIn.duration(motion.slow)} exiting={FadeOut.duration(motion.fast)} style={s.radarBox}>
            <Radar color={colors.primary} size={140}><Ionicons name={def.icon as never} size={26} color={colors.primary} /></Radar>
            <Text style={[font.h3, { marginTop: 6 }]}>Mencari driver terdekat…</Text>
            <Text style={[font.small, { textAlign: 'center' }]}>Biasanya kurang dari 2 menit. Anda akan diberi tahu saat driver menerima.</Text>
          </Animated.View>
        )}
        {searching && <WaitApology order={order} thresholdMinutes={waitApologyMinutes} onCancel={cancel} />}

        {driver && active && (
          <Animated.View entering={FadeInDown.springify().stiffness(280).damping(16)} exiting={FadeOut}>
            <PersonCard name={driver.profile?.full_name} subtitle={driverSubtitle(driver)} avatar={driver.profile?.avatar_url} rating={driver.rating_avg} ratingCount={driver.rating_count}
              onChat={() => router.push(`/order/${id}/chat` as never)}
              callPeer={driver.profile ? { id: driver.id, name: driver.profile.full_name, avatar: driver.profile.avatar_url, role: 'driver' } : null} orderId={order.id} />
          </Animated.View>
        )}
        {driver && active && <DriverVerifyCard plate={driver.vehicle_plate} vehicle={`${driver.vehicle_type === 'car' ? 'Mobil' : 'Motor'} ${driver.vehicle_brand ?? ''}${driver.vehicle_color ? ' ' + driver.vehicle_color : ''}`} name={driver.profile?.full_name ?? 'Driver'} selfieAt={driver.last_selfie_at} />}
        <PinCard orderId={order.id} status={order.status} />
        <SafetyRow order={order} />
        {active && <ExtrasApproval order={order} onDone={reload} />}
        {order.status === 'completed' && driver && (
          <Animated.View entering={FadeInDown.delay(120).duration(motion.slow)} style={s.rateBox}>
            <Text style={font.h3}>Beri penilaian</Text>
            <Row between style={{ marginTop: 8 }}><Text style={font.small}>Driver {driver.profile?.full_name}</Text><Stars value={rated.driver ?? 0} size={24} onChange={(v) => rate('driver', v)} /></Row>
            {!!order.merchant && <Row between style={{ marginTop: 8 }}><Text style={font.small}>{order.merchant.name}</Text><Stars value={rated.merchant ?? 0} size={24} onChange={(v) => rate('merchant', v)} /></Row>}
            <TextInput placeholder="Tulis ulasan (opsional)" placeholderTextColor={colors.textMuted} value={comment} onChangeText={setComment} style={s.comment} />
          </Animated.View>
        )}
        {driver && order.status !== 'cancelled' && order.status !== 'searching' && <TipCard order={order} onDone={reload} />}

        <View style={s.block}>
          <RouteBlock order={order} />
          <OrderExtras order={order} />
        </View>
        <View style={s.block}>
          <PriceBlock order={order} />
          {order.payment_status === 'refunded' && <Badge text="Dana dikembalikan ke AntarPay" color={colors.info} style={{ marginTop: 8 }} />}
        </View>
        {['ride_motor', 'ride_car', 'send', 'box'].includes(order.service) && <MerchantAds near={{ lat: order.dropoff_lat, lng: order.dropoff_lng }} title={active ? 'Lapar sesampainya? Merchant dekat tujuan' : 'Merchant dekat tujuan'} max={5} />}
        <View style={s.block}><Timeline events={events} /></View>
        {active && <Button title="Laporkan masalah pesanan" variant="ghost" color={colors.textSecondary} icon="flag-outline" onPress={() => router.push({ pathname: '/support/new', params: { order_id: order.id, category: 'order' } } as never)} />}
        {canCancel && <Button title="Batalkan pesanan" variant="outline" color={colors.danger} onPress={cancel} />}
        {!active && <Button title="Ada kendala dengan pesanan ini?" variant="ghost" color={colors.textSecondary} icon="help-circle-outline" onPress={() => router.push({ pathname: '/support/new', params: { order_id: order.id, category: 'order' } } as never)} />}
        {!active && <Button title={order.service === 'food' && order.merchant ? `Pesan lagi dari ${order.merchant.name}` : 'Pesan lagi rute ini'} icon="refresh" variant="secondary" onPress={() => {
          if (order.service === 'food' && order.merchant_id) { router.replace(`/food/${order.merchant_id}` as never); return; }
          const b = useBooking.getState();
          b.setDropoff({ lat: order.dropoff_lat, lng: order.dropoff_lng, address: order.dropoff_address, name: order.dropoff_address.split(',')[0] });
          if (order.service !== 'shop') b.setPickup({ lat: order.pickup_lat, lng: order.pickup_lng, address: order.pickup_address, name: order.pickup_address.split(',')[0] });
          router.replace(def.route as never);
        }} />}
      </Animated.View>
    </MapScreen>
  );
}

function subtitle(order: Order) {
  switch (order.status) {
    case 'scheduled': return order.scheduled_at ? `Jemput ${new Date(order.scheduled_at).toLocaleString('id-ID', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} WIB` : 'Booking terjadwal';
    case 'searching': return 'Kami sedang mencarikan driver terdekat';
    case 'accepted': return 'Driver sedang menuju lokasi';
    case 'arrived': return 'Driver sudah tiba';
    case 'in_progress': return `Perkiraan ${order.duration_min} menit`;
    case 'completed': return 'Terima kasih sudah memakai AntarKita';
    default: return order.cancel_reason ?? '';
  }
}

/** Stepper status: titik-titik yang terisi berurutan + bar progres animasi. */
function StatusStepper({ status, color }: { status: OrderStatus; color: string }) {
  const idx = stepIndex(status);
  return (
    <View style={{ gap: 8 }}>
      <ProgressBar progress={(idx + (status === 'completed' ? 1 : 0.5)) / STEPS.length} color={color} height={5} />
      <Row between>
        {STEPS.map((st, i) => {
          const done = i < idx || status === 'completed';
          const cur = i === idx && status !== 'completed';
          return (
            <View key={st.key} style={{ alignItems: 'center', gap: 4, flex: 1 }}>
              <Animated.View layout={LinearTransition.springify().stiffness(280).damping(20)} style={[s.step, done && { backgroundColor: color, borderColor: color }, cur && { borderColor: color, backgroundColor: color + '22' }]}>
                <Ionicons name={st.icon as never} size={12} color={done ? '#fff' : cur ? color : colors.textMuted} />
              </Animated.View>
              <Text style={[font.tiny, { fontSize: 12, fontWeight: cur || done ? '700' : '500', color: cur ? color : done ? colors.text : colors.textMuted }]} numberOfLines={1}>{st.label}</Text>
            </View>
          );
        })}
      </Row>
    </View>
  );
}

export { PressableScale };
const s = StyleSheet.create({
  statusIcon: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  iconTint: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  step: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: colors.border, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  radarBox: { alignItems: 'center', gap: 4, padding: 16, backgroundColor: '#fff', borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, ...shadow.soft },
  rateBox: { backgroundColor: '#fff', borderRadius: radius.lg, padding: 16, borderWidth: 1, borderColor: colors.border, ...shadow.soft },
  block: { backgroundColor: '#fff', borderRadius: radius.lg, padding: 16, borderWidth: 1, borderColor: colors.border, gap: 12, ...shadow.soft },
  comment: { marginTop: 10, backgroundColor: colors.bgSoft, borderRadius: 14, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, height: 46, color: colors.text },
});
