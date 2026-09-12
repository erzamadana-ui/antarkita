// Halaman publik "Bagikan perjalanan" — tanpa login; menampilkan posisi driver, plat, status (diperbarui tiap 10 dtk)
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { FadeIn } from 'react-native-reanimated';
import { MapView } from '@/components/map';
import type { MapMarker } from '@/components/map';
import { MapScreen } from '@/components/MapScreen';
import { Row, Badge, Avatar, Loading, Empty, Button } from '@/components/ui';
import { LiveDot, ProgressBar } from '@/components/motion';
import { AmbientBackground } from '@/components/glass';
import { LogoLockup } from '@/components/Logo';
import { supabase } from '@/lib/supabase';
import { colors, font, radius, glass, motion } from '@/lib/theme';
import { statusLabel, statusColor, serviceLabel, formatTime, km } from '@/lib/format';
import type { SharedOrder } from '@/lib/types';

const PROGRESS: Record<string, number> = { searching: 0.15, accepted: 0.4, arrived: 0.6, in_progress: 0.85, completed: 1, cancelled: 1 };

export default function SharedTrip() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const router = useRouter();
  const [data, setData] = useState<SharedOrder | null | undefined>(undefined);
  const [at, setAt] = useState<Date>(new Date());
  useEffect(() => {
    let alive = true;
    // Tahan bentuk balasan yang tak terduga: RPC bisa mengembalikan [] atau objek tanpa koordinat.
    // Tanpa penjaga ini, peta menerima lat/lng undefined dan seluruh halaman jatuh ke ErrorBoundary
    // (pengguna melihat layar galat, bukan pesan "Tautan tidak valid").
    const valid = (d: unknown): d is SharedOrder => {
      const o = Array.isArray(d) ? d[0] : d;
      return !!o && typeof o === 'object'
        && Number.isFinite((o as SharedOrder).pickup_lat) && Number.isFinite((o as SharedOrder).pickup_lng)
        && Number.isFinite((o as SharedOrder).dropoff_lat) && Number.isFinite((o as SharedOrder).dropoff_lng);
    };
    const load = async () => {
      const { data: d } = await supabase.rpc('shared_order', { p_token: token });
      if (!alive) return;
      setData(valid(d) ? (Array.isArray(d) ? d[0] : d) as SharedOrder : null);
      setAt(new Date());
    };
    load();
    const t = setInterval(load, 10000);
    return () => { alive = false; clearInterval(t); };
  }, [token]);

  const markers = useMemo<MapMarker[]>(() => {
    if (!data) return [];
    const m: MapMarker[] = [
      { id: 'pickup', lat: data.pickup_lat, lng: data.pickup_lng, kind: data.service === 'food' || data.service === 'shop' ? 'merchant' : 'pickup' },
      { id: 'dropoff', lat: data.dropoff_lat, lng: data.dropoff_lng, kind: 'dropoff' },
    ];
    if (data.driver?.lat && data.driver.lng) m.push({ id: 'driver', lat: data.driver.lat, lng: data.driver.lng, kind: data.driver.vehicle_type === 'car' ? 'car' : 'motor', heading: data.driver.heading });
    return m;
  }, [data]);
  const fitTo = useMemo(() => data ? (data.driver?.lat ? [{ lat: data.driver.lat, lng: data.driver.lng! }, { lat: data.dropoff_lat, lng: data.dropoff_lng }] : [{ lat: data.pickup_lat, lng: data.pickup_lng }, { lat: data.dropoff_lat, lng: data.dropoff_lng }]) : null, [data]);

  if (data === undefined) return <View style={{ flex: 1 }}><AmbientBackground /><SafeAreaView style={{ flex: 1 }}><Loading text="Memuat perjalanan…" /></SafeAreaView></View>;
  if (!data) return <View style={{ flex: 1 }}><AmbientBackground /><SafeAreaView style={{ flex: 1 }}><Empty icon="link-outline" title="Tautan tidak valid" subtitle="Tautan pantau perjalanan salah atau sudah tidak tersedia." action={<Button title="Buka AntarKita" onPress={() => router.replace('/')} />} /></SafeAreaView></View>;
  const live = ['accepted', 'arrived', 'in_progress'].includes(data.status);
  const sc = statusColor(data.status);
  const d = data.driver;

  const header = (
    <View style={{ gap: 10 }}>
      <Row between>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Row gap={6}>{live && <LiveDot color={sc} size={8} />}<Animated.Text key={data.status} entering={FadeIn.duration(motion.base)} style={font.h3} numberOfLines={1}>{statusLabel(data.status, data.service)}</Animated.Text></Row>
          <Text style={font.tiny}>{data.customer_name} · {serviceLabel[data.service]} · {data.code}</Text>
        </View>
        <Badge text={live ? `Live · ${formatTime(at.toISOString())}` : data.status === 'completed' ? 'Selesai' : 'Dibatalkan'} color={sc} />
      </Row>
      {data.status !== 'cancelled' && <ProgressBar progress={PROGRESS[data.status] ?? 0} color={sc} height={5} />}
    </View>
  );

  return (
    <MapScreen
      map={<MapView center={{ lat: data.pickup_lat, lng: data.pickup_lng }} markers={markers} polyline={data.route_geometry} fitTo={fitTo} paddingBottom={20} attributionBottom={196} />}
      back={false}
      topLeft={<View style={s.brand}><LogoLockup size={26} /></View>}
      header={header}
      minHeight={220}
      maxRatio={0.6}
      initiallyExpanded
    >
      <View style={{ gap: 12 }}>
        {d ? (
          <View style={s.card}>
            <Row gap={12}>
              <Avatar name={d.name} url={d.avatar_url} size={48} />
              <View style={{ flex: 1 }}>
                <Text style={font.h3}>{d.name}</Text>
                <Text style={font.small}>{d.vehicle_type === 'car' ? 'Mobil' : 'Motor'} {d.vehicle_brand ?? ''} {d.vehicle_color ? `· ${d.vehicle_color}` : ''} · ⭐ {Number(d.rating).toFixed(1)}</Text>
              </View>
              <View style={s.plate}><Text style={{ fontWeight: '700', color: '#fff', letterSpacing: 1 }}>{d.plate}</Text></View>
            </Row>
            <Row gap={8} style={{ marginTop: 8 }}><Ionicons name="shield-checkmark" size={16} color={colors.success} /><Text style={font.tiny}>Mitra terverifikasi AntarKita · posisi diperbarui otomatis</Text></Row>
          </View>
        ) : <View style={s.card}><Text style={font.small}>Driver belum ditugaskan.</Text></View>}
        <View style={s.card}>
          <Row gap={8}><View style={[s.dot, { backgroundColor: colors.primary }]} /><Text style={[font.small, { flex: 1 }]}>{data.pickup_address}</Text></Row>
          <View style={{ height: 8 }} />
          <Row gap={8}><View style={[s.dot, { backgroundColor: colors.danger, borderRadius: 2 }]} /><Text style={[font.small, { flex: 1 }]}>{data.dropoff_address}</Text></Row>
          <Text style={[font.tiny, { marginTop: 8 }]}>{km(data.distance_km)} · ±{data.duration_min} mnt</Text>
        </View>
        <Text style={[font.tiny, { textAlign: 'center' }]}>Halaman ini dibagikan oleh {data.customer_name}. Hanya status & posisi kendaraan yang ditampilkan — tanpa nomor HP (UU PDP).</Text>
        {Platform.OS === 'web' && <Button title="Unduh / buka AntarKita" variant="secondary" onPress={() => router.replace('/')} />}
      </View>
    </MapScreen>
  );
}
const s = StyleSheet.create({
  brand: { backgroundColor: 'rgba(255,255,255,0.85)', borderRadius: radius.full, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: glass.border },
  card: { backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: radius.lg, padding: 14, borderWidth: 1, borderColor: glass.border },
  plate: { backgroundColor: '#0B1F2A', paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.md },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
