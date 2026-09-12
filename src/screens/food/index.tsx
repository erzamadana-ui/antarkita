import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { LinearTransition } from 'react-native-reanimated';
import { Screen, Chip, Row, Empty, Button, type IconName } from '@/components/ui';
import { CartBar } from '@/components/CartBar';
import { DestinationCard } from '@/components/PromoCard';
import { Entrance, PressableScale, Skeleton } from '@/components/motion';
import { ServiceIllustration } from '@/components/ServiceArt';
import { useCurrentLocation } from '@/hooks/useLocation';
import { useCityStatus } from '@/hooks/useCityStatus';
import { CityNotice } from '@/components/city';
import { supabase, friendlyError } from '@/lib/supabase';
import { colors, font, radius, shadow } from '@/lib/theme';
import { rupiah } from '@/lib/format';
import type { Merchant } from '@/lib/types';

const CATS: { label: string; icon: IconName }[] = [
  { label: 'Semua', icon: 'grid-outline' },
  { label: 'Makanan', icon: 'restaurant-outline' },
  { label: 'Minuman', icon: 'cafe-outline' },
  { label: 'Jajanan', icon: 'ice-cream-outline' },
];
type Sort = 'all' | 'halal' | 'near' | 'rating';
const FILTERS: { key: Sort; label: string }[] = [{ key: 'all', label: 'Semua' }, { key: 'halal', label: 'Halal' }, { key: 'near', label: 'Terdekat' }, { key: 'rating', label: 'Rating' }];

export default function FoodHome() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { location, hasFix } = useCurrentLocation();
  // Daftar merchant tetap bisa ditelusuri di kota mana pun; yang dikunci hanya pemesanan (di checkout).
  const { status: city } = useCityStatus(hasFix ? location : null);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('Semua');
  const [filter, setFilter] = useState<Sort>('all');
  const [nonHalal, setNonHalal] = useState(false);
  const [list, setList] = useState<Merchant[]>([]);
  const [loading, setLoading] = useState(true);
  // null = permintaan terakhir sukses; string = pesan gagal (mis. tanpa internet).
  // Tanpa ini kegagalan jaringan tampil sebagai "Belum ada merchant" — pengguna dituduh
  // tinggal di daerah tanpa merchant padahal ponselnya sedang offline.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const halal: 'all' | 'halal' | 'non' = filter === 'halal' ? 'halal' : nonHalal ? 'non' : 'all';

  useEffect(() => {
    const t = setTimeout(async () => {
      setLoading(true);
      const { data, error } = await supabase.rpc('nearby_merchants', { p_lat: location.lat, p_lng: location.lng, p_radius_km: 30, p_q: q || null, p_halal: halal === 'all' ? null : halal === 'halal' });
      setLoadError(error ? friendlyError(error.message) : null);
      setList((data as Merchant[]) ?? []);
      setLoading(false);
    }, q ? 350 : 0);
    return () => clearTimeout(t);
  }, [q, halal, location.lat, location.lng, reloadTick]);

  const shown = list
    .filter((m) => cat === 'Semua' || m.category === cat)
    .sort((a, b) => (filter === 'near' ? (a.distance_km ?? 0) - (b.distance_km ?? 0) : filter === 'rating' ? b.rating_avg - a.rating_avg : 0));
  const colW = Math.floor((Math.min(width, 720) - 32 - 12) / 2);

  return (
    <Screen title="AntarFood" band={colors.food} back scroll={false} padded={false} footer={<CartBar />}>
      <ScrollView contentContainerStyle={{ paddingBottom: 100 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={s.inner}>
          <CityNotice status={city} service="food" compact />
          {/* Pencarian pil + tombol filter bulat */}
          <Entrance index={0}>
            <Row gap={10} style={{ marginTop: 6 }}>
              <View style={[s.search, { flex: 1 }]}>
                <Ionicons name="search-outline" size={20} color={colors.primary} />
                <TextInput value={q} onChangeText={setQ} placeholder="Cari resto atau menu" placeholderTextColor={colors.textMuted} style={s.searchInput} returnKeyType="search" />
                {q ? <PressableScale onPress={() => setQ('')} hitSlop={8} scaleTo={0.85}><Ionicons name="close-circle" size={20} color={colors.textMuted} /></PressableScale> : null}
              </View>
              <PressableScale onPress={() => setNonHalal((v) => !v)} scaleTo={0.9} style={[s.filterBtn, nonHalal && { backgroundColor: colors.primary, borderColor: colors.primary }]}>
                <Ionicons name="options-outline" size={20} color={nonHalal ? '#fff' : colors.primary} />
              </PressableScale>
            </Row>
            {nonHalal ? <Text style={[font.tiny, { marginTop: 6 }]}>Menampilkan merchant non-halal saja. Ketuk tombol filter untuk mematikan.</Text> : null}
          </Entrance>

          {/* Chip kategori: Semua / Halal / Terdekat / Rating */}
          <Entrance index={1}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginTop: 14, paddingRight: 16 }}>
              {FILTERS.map((f) => <Chip key={f.key} label={f.label} active={filter === f.key} onPress={() => { setFilter(f.key); if (f.key === 'halal') setNonHalal(false); }} />)}
            </ScrollView>
          </Entrance>

          {/* Ikon kategori bulat */}
          <Entrance index={2}>
            <Row gap={0} style={{ marginTop: 18, justifyContent: 'space-between' }}>
              {CATS.map((c) => {
                const on = cat === c.label;
                return (
                  <PressableScale key={c.label} onPress={() => setCat(c.label)} scaleTo={0.9} style={s.catTile}>
                    <View style={[s.catCircle, on && { backgroundColor: colors.primary, borderColor: colors.primary }]}>
                      {c.label === 'Semua' ? <ServiceIllustration kind="food" size={36} /> : <Ionicons name={c.icon} size={24} color={on ? '#fff' : colors.primary} />}
                    </View>
                    <Text style={[s.catLabel, on && { color: colors.primary }]} numberOfLines={1} adjustsFontSizeToFit>{c.label}</Text>
                  </PressableScale>
                );
              })}
            </Row>
          </Entrance>

          <Row between style={{ marginTop: 22, marginBottom: 12 }}>
            <Text style={font.h3}>{q ? `Hasil "${q}"` : 'Merchant di sekitar'}</Text>
            {!loading && <Text style={font.tiny}>{shown.length} tempat</Text>}
          </Row>

          {loading ? (
            <View style={s.grid}>
              {[0, 1, 2, 3].map((i) => <Skeleton key={i} width={colW} height={200} radius={24} />)}
            </View>
          ) : loadError ? (
            <Empty icon="cloud-offline-outline" title="Gagal memuat merchant" subtitle={loadError} action={<Button title="Coba lagi" icon="refresh" onPress={() => setReloadTick((n) => n + 1)} />} />
          ) : shown.length === 0 ? (
            <Empty icon="restaurant-outline" title="Belum ada merchant" subtitle="Coba kata kunci lain atau perluas lokasi." />
          ) : (
            <View style={s.grid}>
              {shown.map((m, i) => (
                <Entrance key={m.id} index={Math.min(i, 6)} from="up">
                  <Animated.View layout={LinearTransition.springify().stiffness(280).damping(20)}>
                    <DestinationCard
                      image={m.image_url}
                      title={m.name}
                      subtitle={`${m.distance_km} km · ${m.is_halal ? (m.halal_verified ? 'Halal terverifikasi' : 'Halal') : 'Non-halal'}`}
                      rating={m.rating_avg}
                      width={colW}
                      height={200}
                      accent={colors.food}
                      art={<ServiceIllustration kind="food" size={64} />}
                      onPress={() => router.push(`/food/${m.id}` as never)}
                    />
                    <Row between style={{ marginTop: 6, paddingHorizontal: 4 }}>
                      <Text style={[font.tiny, { fontWeight: '700', color: m.delivery_fee === 0 ? colors.success : colors.textSecondary }]} numberOfLines={1}>
                        {m.delivery_fee === 0 ? 'Ongkir gratis' : `Ongkir ${rupiah(m.delivery_fee ?? 0)}`}
                      </Text>
                      <Text style={[font.tiny, !m.is_open && { color: colors.danger, fontWeight: '700' }]}>{m.is_open ? `${m.prep_minutes + 15} mnt` : 'Tutup'}</Text>
                    </Row>
                  </Animated.View>
                </Entrance>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}

const s = StyleSheet.create({
  inner: { width: '100%', maxWidth: 720, alignSelf: 'center', paddingHorizontal: 16 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 52, borderRadius: radius.full, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, paddingHorizontal: 16, ...shadow.soft },
  searchInput: { flex: 1, fontSize: 14, fontWeight: '500', color: colors.text, paddingVertical: 0 },
  filterBtn: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.primaryLight },
  catTile: { alignItems: 'center', gap: 6, flex: 1 },
  catCircle: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, ...shadow.soft },
  catLabel: { fontSize: 12, fontWeight: '700', color: colors.text, textAlign: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
});
