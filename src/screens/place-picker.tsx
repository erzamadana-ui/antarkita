import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator, Platform } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { BlurView } from 'expo-blur';
import Animated, { FadeIn, FadeInDown, FadeOut, LinearTransition, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { MapView } from '@/components/map';
import { Input, Button, Row, IconCircle } from '@/components/ui';
import { AmbientBackground } from '@/components/glass';
import { Entrance, PressableScale, Skeleton } from '@/components/motion';
import { FloatingButton } from '@/components/MapScreen';
import { useBooking } from '@/store/booking';
import { useAuth } from '@/store/auth';
import { useCurrentLocation } from '@/hooks/useLocation';
import { searchPlaces, reverseGeocode } from '@/lib/geo';
import { supabase } from '@/lib/supabase';
import { colors, font, radius, shadow, glass, motion } from '@/lib/theme';
import type { LatLng, Place, SavedPlace } from '@/lib/types';

export default function PlacePicker() {
  const router = useRouter();
  const { title, target, mode: modeParam } = useLocalSearchParams<{ title?: string; target?: string; mode?: string }>();
  const booking = useBooking();
  const uid = useAuth((s) => s.session?.user.id);
  const { location, refresh } = useCurrentLocation();
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const [searching, setSearching] = useState(false);
  const [saved, setSaved] = useState<SavedPlace[]>([]);
  const [center, setCenter] = useState<LatLng>(location);
  const [address, setAddress] = useState<string>('');
  const [resolving, setResolving] = useState(false);
  const [mode, setMode] = useState<'search' | 'map'>(modeParam === 'map' ? 'map' : 'search');
  const [detail, setDetail] = useState('');
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initial = useRef<LatLng>((target === 'pickup' && booking.pickup) || (target === 'dropoff' && booking.dropoff) || location);
  const [mapCenter, setMapCenter] = useState<LatLng>(initial.current);

  useEffect(() => { if (target) booking.openPicker(target as never); }, [target]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (uid) supabase.from('saved_places').select('*').eq('user_id', uid).then(({ data }) => setSaved((data as SavedPlace[]) ?? [])); }, [uid]);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    if (q.trim().length < 3) { setResults([]); return; }
    debounce.current = setTimeout(async () => {
      setSearching(true);
      try { setResults(await searchPlaces(q, location)); } catch { setResults([]); }
      setSearching(false);
    }, 400);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [q, location]);

  const onCenterChange = async (c: LatLng) => {
    setCenter(c); setResolving(true);
    const a = await reverseGeocode(c);
    setAddress(a); setResolving(false);
  };
  useEffect(() => { if (mode === 'map' && !address) onCenterChange(initial.current); }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = (p: Place) => { booking.resolvePicker(p); router.back(); };
  const useMyLocation = async () => {
    const p = (await refresh()) ?? location;
    const a = await reverseGeocode(p);
    choose({ ...p, address: a, name: 'Lokasi saya' });
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {mode === 'search' && <AmbientBackground />}
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View style={s.header}>
          {Platform.OS !== 'android' && <BlurView intensity={glass.blur} tint="light" style={StyleSheet.absoluteFill} />}
          <View style={s.headerInner}>
            <PressableScale onPress={() => router.back()} hitSlop={12} scaleTo={0.9} style={s.backBtn}><Ionicons name="arrow-back" size={20} color={colors.text} /></PressableScale>
            <Text style={[font.h3, { flex: 1 }]} numberOfLines={1}>{title ?? 'Pilih lokasi'}</Text>
            <PressableScale onPress={() => setMode(mode === 'search' ? 'map' : 'search')} style={s.modeBtn} scaleTo={0.94}>
              <Ionicons name={mode === 'search' ? 'map-outline' : 'search-outline'} size={16} color={colors.primary} />
              <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 13 }}>{mode === 'search' ? 'Pilih di peta' : 'Cari alamat'}</Text>
            </PressableScale>
          </View>
        </View>

        {mode === 'search' ? (
          <Animated.View entering={FadeIn.duration(motion.base)} style={{ flex: 1 }}>
            <View style={{ padding: 16, paddingBottom: 8, width: '100%', maxWidth: 720, alignSelf: 'center' }}>
              <Input icon="search" placeholder="Cari nama jalan, tempat, gedung…" value={q} onChangeText={setQ} autoFocus={Platform.OS !== 'web'}
                right={searching ? <ActivityIndicator size="small" color={colors.primary} /> : q ? <Pressable onPress={() => setQ('')}><Ionicons name="close-circle" size={18} color={colors.textMuted} /></Pressable> : null} />
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingTop: 8, gap: 8, width: '100%', maxWidth: 720, alignSelf: 'center' }} showsVerticalScrollIndicator={false}>
              <Entrance index={0}><PlaceRow icon="locate" color={colors.info} title="Gunakan lokasi saya saat ini" subtitle="GPS perangkat" onPress={useMyLocation} /></Entrance>
              <Entrance index={1}><PlaceRow icon="map" color={colors.primary} title="Pilih titik di peta" subtitle="Geser peta ke lokasi yang tepat" onPress={() => setMode('map')} /></Entrance>
              {searching && results.length === 0 && [0, 1, 2].map((i) => <View key={i} style={[s.row, { gap: 12 }]}><Skeleton width={38} height={38} radius={19} /><View style={{ flex: 1, gap: 6 }}><Skeleton width="60%" height={14} /><Skeleton width="90%" height={11} /></View></View>)}
              {results.length > 0 && <Text style={[font.label, { marginTop: 8 }]}>Hasil pencarian</Text>}
              {results.map((r, i) => <Animated.View key={`${r.lat},${r.lng}`} entering={FadeInDown.delay(i * 40).duration(motion.base)} layout={LinearTransition}><PlaceRow icon="location-outline" color={colors.danger} title={r.name ?? r.address} subtitle={r.address} onPress={() => choose(r)} /></Animated.View>)}
              {q.length >= 3 && !searching && results.length === 0 && <Text style={[font.small, { padding: 8 }]}>Tidak ditemukan. Coba kata lain atau pilih di peta.</Text>}
              {saved.length > 0 && q.length < 3 && (<>
                <Text style={[font.label, { marginTop: 8 }]}>Alamat tersimpan</Text>
                {saved.map((sp, i) => <Entrance key={sp.id} index={2 + i}><PlaceRow icon={sp.label.toLowerCase().includes('rumah') ? 'home' : sp.label.toLowerCase().includes('kantor') ? 'business' : 'bookmark'} color={colors.accent} title={sp.label} subtitle={sp.address} onPress={() => choose({ lat: sp.lat, lng: sp.lng, address: sp.address, name: sp.label })} /></Entrance>)}
              </>)}
            </ScrollView>
          </Animated.View>
        ) : (
          <Animated.View entering={FadeIn.duration(motion.base)} exiting={FadeOut} style={{ flex: 1 }}>
            <MapView center={mapCenter} zoom={16} onCenterChange={onCenterChange} />
            <AnimatedPin lifted={resolving} />
            <View style={{ position: 'absolute', right: 16, top: 16 }}>
              <FloatingButton icon="locate" color={colors.info} onPress={async () => { const p = (await refresh()) ?? location; setMapCenter({ ...p }); onCenterChange(p); }} />
            </View>
            <Animated.View entering={FadeInDown.springify().stiffness(280).damping(18)} style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
              {Platform.OS !== 'android' && <BlurView intensity={glass.blurStrong} tint="light" style={StyleSheet.absoluteFill} />}
              <View style={{ width: '100%', maxWidth: 560, alignSelf: 'center' }}>
                <Row gap={10}>
                  <IconCircle name="location" color={colors.primary} size={40} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={font.tiny}>Lokasi terpilih</Text>
                    {resolving ? <Skeleton width="80%" height={14} style={{ marginTop: 4 }} /> : <Text style={{ fontWeight: '600', color: colors.text }} numberOfLines={2}>{address || 'Geser peta…'}</Text>}
                  </View>
                </Row>
                <Input placeholder="Detail: nama gedung, lantai, patokan (opsional)" value={detail} onChangeText={setDetail} icon="business-outline" containerStyle={{ marginTop: 10 }} />
                <Button title="Pilih lokasi ini" size="lg" style={{ marginTop: 10 }} disabled={resolving || !address} onPress={() => choose({ ...center, address: detail.trim() ? `${detail.trim()} · ${address}` : address, name: detail.trim() || undefined })} />
              </View>
            </Animated.View>
          </Animated.View>
        )}
      </SafeAreaView>
    </View>
  );
}

/** Pin tengah peta: terangkat dengan pegas saat peta digeser. */
function AnimatedPin({ lifted, color = colors.primary }: { lifted: boolean; color?: string }) {
  const y = useSharedValue(0);
  useEffect(() => { y.value = withSpring(lifted ? -12 : 0, motion.springBouncy); }, [lifted, y]);
  const a = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  const sh = useAnimatedStyle(() => ({ transform: [{ scale: 1 + y.value / -24 }], opacity: 0.35 + y.value / 60 }));
  return (
    <View pointerEvents="none" style={s.pinWrap}>
      <Animated.View style={[{ alignItems: 'center' }, a]}>
        <View style={[s.pinHead, { backgroundColor: color }]}><View style={s.pinDot} /></View>
        <View style={[s.pinStem, { backgroundColor: color }]} />
      </Animated.View>
      <Animated.View style={[s.pinShadow, sh]} />
    </View>
  );
}

function PlaceRow({ icon, color, title, subtitle, onPress }: { icon: React.ComponentProps<typeof Ionicons>['name']; color: string; title: string; subtitle?: string; onPress: () => void }) {
  return (
    <PressableScale onPress={onPress} scaleTo={0.98} haptic={false} style={s.row}>
      <IconCircle name={icon} color={color} size={38} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontWeight: '600', color: colors.text }} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={font.small} numberOfLines={2}>{subtitle}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
    </PressableScale>
  );
}

const s = StyleSheet.create({
  header: { overflow: 'hidden', backgroundColor: Platform.OS === 'android' ? 'rgba(255,255,255,0.96)' : 'rgba(255,255,255,0.92)', borderBottomWidth: 1, borderBottomColor: glass.border, zIndex: 5 },
  headerInner: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, height: 54, width: '100%', maxWidth: 720, alignSelf: 'center' },
  backBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(11,31,42,0.05)' },
  modeBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.primary + '14', borderWidth: 1, borderColor: colors.primary + '33', paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.full },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'rgba(255,255,255,0.92)', padding: 12, borderRadius: radius.lg, borderWidth: 1, borderColor: glass.border },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: Platform.OS === 'android' ? 'rgba(255,255,255,0.97)' : 'rgba(255,255,255,0.92)', borderTopLeftRadius: radius.xxl, borderTopRightRadius: radius.xxl, padding: 20, overflow: 'hidden', borderTopWidth: 1, borderColor: glass.border, ...shadow.sheet },
  pinWrap: { position: 'absolute', left: '50%', top: '50%', marginLeft: -16, marginTop: -44, alignItems: 'center', zIndex: 5 },
  pinHead: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: '#fff', ...shadow.card },
  pinDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#fff' },
  pinStem: { width: 3, height: 12 },
  pinShadow: { width: 14, height: 6, borderRadius: 7, backgroundColor: 'rgba(0,0,0,0.35)', marginTop: 1 },
});
