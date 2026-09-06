import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Switch, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeIn, FadeInDown, FadeOut, LinearTransition, ZoomIn } from 'react-native-reanimated';
import { MapView } from '@/components/map';
import type { MapMarker } from '@/components/map';
import { Row, Badge, Button, Empty, toast, Avatar } from '@/components/ui';
import { MapScreen, FloatingButton } from '@/components/MapScreen';
import { Entrance, LiveDot, PressableScale, Radar, AnimatedNumber } from '@/components/motion';
import { ServiceIllustration } from '@/components/ServiceArt';
import { TAB_BAR_SPACE } from '@/components/GlassTabBar';
import { useDriverSession, useDriverPriority } from '@/hooks/useDriver';
import { PriorityCard, RejectOrderSheet, OrderLoadInfo, usePickupRadiusText } from '@/components/driver';
import { useCurrentLocation } from '@/hooks/useLocation';
import { useAuth } from '@/store/auth';
import { colors, font, radius, shadow, motion } from '@/lib/theme';
import { rupiah, km, timeAgo, serviceLabel, statusLabel, vehicleClassLabel, formatSchedule } from '@/lib/format';
import { serviceDef } from '@/lib/services';
import type { AvailableOrder } from '@/lib/types';
import { SelfieGate } from '@/components/Safety';

export default function DriverHome() {
  const router = useRouter();
  const { profile } = useAuth();
  const { driver, online, busy, setOnline, available, active, accept, reject, myPos, setMyPos } = useDriverSession();
  const { location, refresh } = useCurrentLocation();
  const { info: priority } = useDriverPriority(driver?.status === 'approved');
  const radiusText = usePickupRadiusText();
  const [selected, setSelected] = useState<AvailableOrder | null>(null);
  const [rejecting, setRejecting] = useState<AvailableOrder | null>(null);
  const [selfie, setSelfie] = useState<{ lat: number; lng: number } | null | false>(false);
  const pos = myPos ?? (driver?.lat && driver.lng ? { lat: driver.lat, lng: driver.lng } : location);

  const toggle = async (v: boolean) => {
    try {
      let p: { lat: number; lng: number } | undefined;
      if (v) { const fix = await refresh(); if (!fix) { toast.error('Lokasi tidak tersedia. Izinkan akses GPS lalu coba lagi.'); return; } p = fix; setMyPos({ ...fix, heading: null }); }
      await setOnline(v, p);
      toast.show(v ? 'Anda online — siap menerima order' : 'Anda offline');
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes('SELFIE_REQUIRED')) { setSelfie(myPos ?? location ?? null); toast.show('Verifikasi wajah dulu sebelum online'); return; }
      toast.error(msg);
    }
  };
  const afterSelfie = async () => {
    const p = selfie || undefined; setSelfie(false);
    try { await setOnline(true, p || undefined); toast.success('Anda online — siap menerima order'); } catch (e) { toast.error((e as Error).message); }
  };

  const markers = useMemo<MapMarker[]>(() => {
    const m: MapMarker[] = [{ id: 'me', lat: pos.lat, lng: pos.lng, kind: driver?.vehicle_type === 'car' ? 'car' : 'motor', heading: myPos?.heading ?? driver?.heading }];
    (selected ? [selected] : available).forEach((o) => m.push({ id: `p-${o.id}`, lat: o.pickup_lat, lng: o.pickup_lng, kind: o.service === 'food' ? 'merchant' : 'pickup', label: selected ? 'Jemput' : undefined }));
    if (selected) m.push({ id: 'd', lat: selected.dropoff_lat, lng: selected.dropoff_lng, kind: 'dropoff', label: 'Tujuan' });
    return m;
  }, [pos.lat, pos.lng, driver, available, selected, myPos?.heading]);
  const fitTo = useMemo(() => selected ? [pos, { lat: selected.pickup_lat, lng: selected.pickup_lng }, { lat: selected.dropoff_lat, lng: selected.dropoff_lng }] : [pos], [pos.lat, pos.lng, selected]); // eslint-disable-line react-hooks/exhaustive-deps

  const doAccept = async (o: AvailableOrder) => {
    try { const ord = await accept(o.id); setSelected(null); toast.success('Order diterima!'); router.push(`/driver/order/${ord.id}` as never); }
    catch (e) { toast.error((e as Error).message); }
  };
  // Tolak: order hilang dari daftar (animasi keluar) & tidak muncul lagi — server menyaringnya untuk driver ini
  const doReject = async (reason: string | null) => {
    const o = rejecting;
    if (!o) return;
    try {
      await reject(o.id, reason);
      setRejecting(null);
      setSelected((cur) => (cur?.id === o.id ? null : cur));
      toast.show('Order dilewati');
    } catch (e) { toast.error((e as Error).message); }
  };

  if (driver && driver.status !== 'approved') {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <SafeAreaView style={{ flex: 1 }}>
          <Empty icon="hourglass-outline" title={driver.status === 'pending' ? 'Menunggu verifikasi admin' : driver.status === 'suspended' ? 'Akun mitra ditangguhkan' : 'Pendaftaran ditolak'}
            subtitle={driver.status === 'pending' ? 'Data Anda sedang diperiksa. Biasanya kurang dari 1×24 jam.' : 'Hubungi CS AntarKita untuk informasi lebih lanjut.'}
            action={<Button title="Lihat akun & status pengajuan" variant="secondary" icon="person-outline" onPress={() => router.push('/(driver)/account' as never)} />} />
        </SafeAreaView>
      </View>
    );
  }

  // Kartu status atas: putih radius 22 mengambang di atas peta (avatar, nama, saklar online)
  const topLeft = (
    <View style={s.profileCard}>
      <Avatar name={profile?.full_name} url={profile?.avatar_url} size={38} />
      <View style={{ minWidth: 0, maxWidth: 150 }}>
        <Text style={{ fontWeight: '800', color: colors.text, fontSize: 13 }} numberOfLines={1}>{profile?.full_name}</Text>
        <Row gap={4}>
          <LiveDot color={online ? colors.success : colors.textMuted} size={6} />
          <Text style={{ fontSize: 12, fontWeight: '700', color: online ? colors.success : colors.textMuted }}>{online ? 'Online' : 'Offline'}</Text>
        </Row>
      </View>
      <Switch value={online} onValueChange={toggle} disabled={busy} trackColor={{ true: colors.primary, false: colors.border }} thumbColor="#fff" style={Platform.OS === 'ios' ? { transform: [{ scale: 0.8 }] } : undefined} />
    </View>
  );

  const header = (
    <Row between>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[font.h3, { fontSize: 16 }]}>{online ? (selected ? 'Detail order' : `${available.length} order tersedia`) : 'Anda offline'}</Text>
        <Row gap={4}>
          <Text style={font.tiny}>{driver?.vehicle_plate} · </Text>
          <Ionicons name="star" size={11} color={colors.accent} />
          <Text style={font.tiny}>{Number(driver?.rating_avg ?? 5).toFixed(1)} · {driver?.total_trips} trip</Text>
        </Row>
      </View>
      {online && !selected && available.length > 0 && <Badge text="Baru" color={colors.success} />}
    </Row>
  );

  return (
    <>
    <SelfieGate visible={selfie !== false} onDone={afterSelfie} onCancel={() => setSelfie(false)} />
    <RejectOrderSheet visible={!!rejecting} order={rejecting} onClose={() => setRejecting(null)} onConfirm={doReject} />
    <MapScreen
      map={<MapView center={pos} zoom={14} markers={markers} fitTo={fitTo} paddingBottom={20} />}
      back={false}
      topLeft={topLeft}
      floatingRight={<View style={{ gap: 8 }}><FloatingButton icon="shield-checkmark" color={colors.danger} onPress={() => router.push('/safety' as never)} /><FloatingButton icon="locate" color={colors.primary} onPress={async () => { const fix = await refresh(); if (fix) setMyPos({ ...fix, heading: null }); }} /></View>}
      header={header}
      minHeight={170 + TAB_BAR_SPACE}
      maxRatio={0.58}
      bottomSpace={TAB_BAR_SPACE - 24}
      initiallyExpanded={!!selected || !!active}
    >
      <Animated.View layout={LinearTransition.springify().stiffness(280).damping(18)} style={{ gap: 12 }}>
        {active && (
          <Entrance index={0}>
            <PressableScale onPress={() => router.push(`/driver/order/${active.id}` as never)} scaleTo={0.97} style={s.activeCard}>
              <View style={s.activeIcon}><Ionicons name={serviceDef(active.service).icon as never} size={22} color={colors.primary} /></View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: '#fff', fontWeight: '800' }} numberOfLines={1}>Order aktif · {serviceLabel[active.service]}</Text>
                <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '500' }} numberOfLines={1}>{statusLabel(active.status, active.service)} · {active.code}</Text>
              </View>
              <Ionicons name="arrow-forward" size={20} color="#fff" />
            </PressableScale>
          </Entrance>
        )}
        {online && !selected && <Entrance index={active ? 1 : 0}><PriorityCard info={priority} /></Entrance>}
        {!online ? (
          <Animated.View entering={FadeIn.duration(motion.base)} exiting={FadeOut.duration(motion.fast)}>
            <Empty icon="power-outline" title="Anda sedang offline" subtitle="Aktifkan saklar online di kiri atas untuk melihat order di sekitar Anda." />
          </Animated.View>
        ) : selected ? (
          <Animated.View key={selected.id} entering={ZoomIn.duration(motion.base)} exiting={FadeOut.duration(motion.fast)} style={s.offer}>
            <Row between style={{ alignItems: 'flex-start' }}>
              <Row gap={12} style={{ flex: 1, minWidth: 0 }}>
                <View style={[s.thumb, { backgroundColor: serviceDef(selected.service).color + '14' }]}><ServiceIllustration kind={serviceDef(selected.service).art} size={40} /></View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[font.h3, { fontSize: 16 }]} numberOfLines={1}>{serviceLabel[selected.service]}</Text>
                  <Text style={font.tiny}>{selected.code} · {selected.payment_method === 'cash' ? `Tunai, tagih ${rupiah(selected.total)}` : 'Dibayar AntarPay'}</Text>
                </View>
              </Row>
              <PressableScale onPress={() => setSelected(null)} scaleTo={0.9} style={s.closeBtn}><Ionicons name="close" size={18} color={colors.textSecondary} /></PressableScale>
            </Row>
            <Row gap={6} style={{ flexWrap: 'wrap', marginTop: 10 }}>
              {!!selected.vehicle_class && <Badge text={vehicleClassLabel[selected.vehicle_class] ?? selected.vehicle_class} color={colors.info} />}
              {!!selected.scheduled_at && <Badge text={`Jadwal ${formatSchedule(selected.scheduled_at)}`} color={colors.send} />}
              {!!selected.helpers && <Badge text={`+${selected.helpers} pembantu angkat`} color={colors.box} />}
              {selected.send_scope === 'intercity' && <Badge text="Antar kota → gudang" color={colors.send} />}
            </Row>
            <View style={s.earnBox}>
              <Text style={font.tiny}>Pendapatan bersih</Text>
              <AnimatedNumber value={selected.driver_earning} format={rupiah} style={{ fontSize: 28, fontWeight: '800', color: colors.primary, letterSpacing: -0.5 }} duration={500} />
            </View>
            <View style={{ marginTop: 12, gap: 8 }}>
              <Row gap={10}><View style={s.dotIcon}><Ionicons name="navigate-outline" size={16} color={colors.primary} /></View><Text style={[font.small, { flex: 1 }]}>{km(selected.distance_to_pickup_km)} ke titik jemput · {selected.merchant_name ?? selected.pickup_address}</Text></Row>
              <Row gap={10}><View style={s.dotIcon}><Ionicons name="location-outline" size={16} color={colors.primary} /></View><Text style={[font.small, { flex: 1 }]}>{km(selected.distance_km)} perjalanan · {selected.dropoff_address}</Text></Row>
              {selected.service === 'shop' && <Row gap={10}><View style={s.dotIcon}><Ionicons name="basket-outline" size={16} color={colors.primary} /></View><Text style={[font.small, { flex: 1 }]}>Belanjakan ±{rupiah(selected.items_subtotal)}{selected.payment_method === 'cash' ? ' (talangi tunai, tagih ke pelanggan)' : ' (diganti ke saldo Anda saat selesai)'}</Text></Row>}
              {selected.service === 'food' && <Row gap={10}><View style={s.dotIcon}><Ionicons name="restaurant-outline" size={16} color={colors.primary} /></View><Text style={[font.small, { flex: 1 }]}>Beli makanan {rupiah(selected.items_subtotal)}{selected.payment_method === 'cash' ? ' (talangi tunai)' : ' (dibayar AntarPay)'}</Text></Row>}
            </View>
            <OrderLoadInfo order={selected} style={{ marginTop: 10 }} />
            {!!selected.priority_note && <Row gap={6} style={{ marginTop: 8 }}><Ionicons name="information-circle-outline" size={13} color={colors.textMuted} /><Text style={[font.tiny, { flex: 1 }]}>{selected.priority_note}</Text></Row>}
            <Row gap={8} style={{ marginTop: 14 }}>
              <Button title="Tolak" size="lg" variant="outline" color={colors.danger} onPress={() => setRejecting(selected)} style={{ flex: 1 }} />
              <Button title="Terima Order" size="lg" onPress={() => doAccept(selected)} style={{ flex: 1.6 }} />
            </Row>
          </Animated.View>
        ) : available.length === 0 ? (
          <Animated.View entering={FadeIn.duration(motion.slow)} exiting={FadeOut.duration(motion.fast)} style={s.radarBox}>
            <Radar color={colors.primary} size={130}><Ionicons name="bicycle" size={24} color={colors.primary} /></Radar>
            <Text style={[font.h3, { marginTop: 4 }]}>Mencari order di sekitar…</Text>
            <Text style={[font.small, { textAlign: 'center' }]}>{radiusText ? `Order baru dalam ${radiusText} akan muncul otomatis di sini.` : 'Order baru di sekitar Anda akan muncul otomatis di sini.'}</Text>
          </Animated.View>
        ) : (
          available.map((o, i) => {
            const def = serviceDef(o.service);
            return (
              <Animated.View key={o.id} entering={FadeInDown.delay(i * motion.stagger).duration(motion.base)} exiting={FadeOut.duration(motion.fast)} layout={LinearTransition.springify().stiffness(280).damping(20)}>
                <View style={s.orderRow}>
                  <PressableScale onPress={() => setSelected(o)} scaleTo={0.99} haptic={false} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <View style={[s.thumb, { backgroundColor: def.color + '14' }]}><ServiceIllustration kind={def.art} size={40} /></View>
                    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                      <Text style={[font.body, { fontWeight: '700' }]} numberOfLines={1}>{serviceLabel[o.service]}{o.vehicle_class ? ` · ${vehicleClassLabel[o.vehicle_class] ?? ''}` : ''}</Text>
                      <Row gap={4}><Ionicons name="location-outline" size={12} color={colors.textMuted} /><Text style={font.tiny} numberOfLines={1}>{o.merchant_name ?? o.pickup_address}</Text></Row>
                      <Text style={font.tiny} numberOfLines={1}>{km(o.distance_to_pickup_km)} dari Anda · {km(o.distance_km)} · {o.scheduled_at ? `Jadwal ${formatSchedule(o.scheduled_at)}` : timeAgo(o.created_at)} · {o.payment_method === 'cash' ? 'Tunai' : 'AntarPay'}</Text>
                      <Text style={{ fontWeight: '800', color: colors.primary, fontSize: 15 }}>{rupiah(o.driver_earning)}</Text>
                    </View>
                    <View style={s.rowArrow}><Ionicons name="arrow-forward" size={16} color={colors.primary} /></View>
                  </PressableScale>
                  <OrderLoadInfo order={o} style={{ marginTop: 8 }} />
                  <Row gap={8} style={{ marginTop: 10 }}>
                    <Button title="Tolak" size="sm" variant="outline" color={colors.danger} icon="close" onPress={() => setRejecting(o)} style={{ flex: 1 }} />
                    <Button title="Terima" size="sm" icon="checkmark" onPress={() => doAccept(o)} style={{ flex: 1 }} />
                  </Row>
                </View>
              </Animated.View>
            );
          })
        )}
      </Animated.View>
    </MapScreen>
    </>
  );
}

const s = StyleSheet.create({
  profileCard: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 6, paddingRight: 8, paddingVertical: 6, borderRadius: 22, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, ...shadow.card },
  activeCard: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: radius.lg, padding: 14, backgroundColor: colors.primary, ...shadow.glow(colors.primary) },
  activeIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  offer: { backgroundColor: '#fff', borderRadius: radius.lg, padding: 16, borderWidth: 1, borderColor: colors.border, ...shadow.card },
  earnBox: { marginTop: 12, padding: 12, borderRadius: radius.md, backgroundColor: colors.tint },
  closeBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.bgSoft, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  dotIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center' },
  radarBox: { alignItems: 'center', gap: 4, padding: 14, backgroundColor: '#fff', borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, ...shadow.soft },
  orderRow: { padding: 12, borderRadius: 20, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, ...shadow.soft },
  thumb: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center' },
  rowArrow: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.tint },
});
