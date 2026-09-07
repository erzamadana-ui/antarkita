import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, Image, RefreshControl } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAuth } from '@/store/auth';
import { useMyOrders } from '@/hooks/useOrder';
import { useCurrentLocation } from '@/hooks/useLocation';
import { supabase } from '@/lib/supabase';
import { HOME_SERVICES } from '@/lib/services';
import { colors, font, radius, shadow, spacing } from '@/lib/theme';
import type { Merchant, Promo, FrequentData } from '@/lib/types';
import { useBooking } from '@/store/booking';
import { serviceDef } from '@/lib/services';
import { HalalBadge } from '@/components/MerchantStatus';
import { DestinationCard, PromoCard } from '@/components/PromoCard';
import { Row, Avatar, CircleButton, toast } from '@/components/ui';
import { useAppSettings } from '@/hooks/useAppSettings';
import { AmbientBackground } from '@/components/glass';
import { Entrance, PressableScale, Skeleton } from '@/components/motion';
import { ServiceIllustration } from '@/components/ServiceArt';
import { ActiveOrderBubbles } from '@/components/ActiveOrderBubbles';
import { useT } from '@/lib/i18n';
import { useNotifications } from '@/hooks/useNotifications';
import { TAB_BAR_SPACE } from '@/components/GlassTabBar';

export default function CustomerHome() {
  const router = useRouter();
  const { profile, wallet, session, refreshWallet } = useAuth();
  const { orders: active, reload } = useMyOrders('customer', session?.user.id, true);
  const { location } = useCurrentLocation();
  const [merchants, setMerchants] = useState<Merchant[] | null>(null);
  const [promos, setPromos] = useState<Promo[]>([]);
  const [freq, setFreq] = useState<FrequentData | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const t = useT();
  const { unread } = useNotifications(session?.user.id);
  // Layanan yang dinonaktifkan admin (kunci services_enabled = id layanan: ride_motor, ride_car, food, send, shop, market, box, travel)
  const { isEnabled, reload: reloadSettings } = useAppSettings();
  // Sakelar layanan di panel admin harus terasa langsung: setiap kali beranda difokuskan,
  // pengaturan publik dimuat ulang (selain lewat AppState 'active' & realtime di useAppSettings).
  useFocusEffect(React.useCallback(() => { reloadSettings(); }, [reloadSettings]));

  const loadExtras = async () => {
    const [{ data: m }, { data: p }, { data: f }] = await Promise.all([
      supabase.rpc('nearby_merchants', { p_lat: location.lat, p_lng: location.lng, p_radius_km: 25 }),
      supabase.from('promos').select('*').eq('is_active', true).order('sort_order').limit(20),
      supabase.rpc('customer_frequent', { p_limit: 6 }),
    ]);
    setMerchants(((m as Merchant[]) ?? []).slice(0, 8));
    setPromos((p as Promo[]) ?? []);
    setFreq((f as FrequentData) ?? null);
  };
  useEffect(() => { loadExtras(); }, [location.lat, location.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  const goRoute = (r: FrequentData['routes'][number] | FrequentData['recent'][number]) => {
    const b = useBooking.getState();
    const addr = 'dropoff_address' in r ? r.dropoff_address : r.address;
    const lat = 'dropoff_lat' in r ? r.dropoff_lat : r.lat; const lng = 'dropoff_lng' in r ? r.dropoff_lng : r.lng;
    b.setDropoff({ lat, lng, address: addr, name: addr.split(',')[0] });
    if ('pickup_lat' in r && r.service !== 'shop') b.setPickup({ lat: r.pickup_lat, lng: r.pickup_lng, address: r.pickup_address, name: r.pickup_address.split(',')[0] });
    router.push(serviceDef(r.service).route as never);
  };
  const onRefresh = async () => { setRefreshing(true); await Promise.all([reload(), refreshWallet(), loadExtras()]); setRefreshing(false); };
  const hour = new Date().getHours();
  const greet = hour < 11 ? t('greeting_morning') : hour < 15 ? t('greeting_noon') : hour < 18 ? t('greeting_afternoon') : t('greeting_evening');

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <AmbientBackground tint="teal" />
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <ScrollView contentContainerStyle={{ paddingBottom: TAB_BAR_SPACE + 16 }} showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}>
          <View style={s.inner}>
            {/* Header: avatar + sapaan, tombol bulat lonceng & dompet */}
            <Entrance index={0}>
              <Row between style={{ marginTop: 10 }}>
                <PressableScale onPress={() => router.push('/(customer)/account')} scaleTo={0.96} haptic={false}>
                  <Row gap={10}>
                    <Avatar name={profile?.full_name} url={profile?.avatar_url} size={44} />
                    <View>
                      <Text style={[font.h3, { fontSize: 16 }]}>{greet}, {profile?.full_name?.split(' ')[0] ?? 'Kawan'}</Text>
                      <Text style={font.tiny}>{t('welcome_back_home')}</Text>
                    </View>
                  </Row>
                </PressableScale>
                <Row gap={8}>
                  <CircleButton icon={unread > 0 ? 'notifications' : 'notifications-outline'} badge={unread} onPress={() => router.push('/inbox' as never)} />
                  <CircleButton icon="wallet-outline" onPress={() => router.push('/(customer)/pay')} />
                </Row>
              </Row>
            </Entrance>

            {/* Judul besar + ikon kecil (kit: "Discover ⛰️") */}
            <Entrance index={1}>
              <Row gap={8} style={{ marginTop: 22, alignItems: 'flex-end' }}>
                <Text style={[font.display, { fontSize: 30, lineHeight: 36 }]}>{t('home_question')}</Text>
                <View style={{ marginBottom: 4 }}><ServiceIllustration kind="rider" size={34} /></View>
              </Row>
              <Text style={[font.small, { marginTop: 2 }]}>{t('home_sub')}</Text>
            </Entrance>

            {/* Pencarian + tombol filter bulat tint */}
            <Entrance index={2}>
              <Row gap={10} style={{ marginTop: 16 }}>
                <PressableScale onPress={() => router.push('/food')} scaleTo={0.985} haptic={false} style={[s.search, { flex: 1 }]}>
                  <Ionicons name="search-outline" size={20} color={colors.primary} />
                  <Text style={{ color: colors.textMuted, flex: 1, fontSize: 14, fontWeight: '500' }} numberOfLines={1}>{t('search_placeholder')}</Text>
                </PressableScale>
                <PressableScale onPress={() => router.push('/account/places')} scaleTo={0.9} style={s.filterBtn}><Ionicons name="options-outline" size={20} color={colors.primary} /></PressableScale>
              </Row>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginTop: 10, paddingRight: 16 }}>
                {(freq?.recent ?? []).slice(0, 4).map((r, i) => (
                  <PressableScale key={i} onPress={() => goRoute(r)} scaleTo={0.95} style={s.placeChip}>
                    <View style={s.placeDot}><Ionicons name="location" size={10} color="#fff" /></View>
                    <Text style={{ fontSize: 12, fontWeight: '700', color: colors.text }} numberOfLines={1}>{r.address.split(',')[0]}</Text>
                  </PressableScale>
                ))}
                <PressableScale onPress={() => router.push('/account/places')} scaleTo={0.95} style={s.placeChip}>
                  <Ionicons name="bookmark-outline" size={13} color={colors.primary} />
                  <Text style={{ fontSize: 12, fontWeight: '700', color: colors.text }}>{t('saved_places')}</Text>
                </PressableScale>
              </ScrollView>
            </Entrance>

            {/* Layanan — ikon bulat (kit: Beach / Park / Plane / Train) */}
            <View style={s.grid}>
              {HOME_SERVICES.map((sv, i) => {
                const off = sv.id !== 'pay' && !isEnabled(sv.id);
                return (
                  <Entrance key={sv.id} index={3 + i} from="zoom" style={{ width: '25%', alignItems: 'stretch' }}>
                    <PressableScale onPress={() => (off ? toast.show('Layanan ini sedang dinonaktifkan sementara') : router.push(sv.route as never))} scaleTo={off ? 0.98 : 0.9} haptic={!off} style={[s.serviceTile, off && { opacity: 0.45 }]} accessibilityState={{ disabled: off }}>
                      <View style={[s.serviceCircle, i === 0 && !off && { backgroundColor: colors.primary, borderColor: colors.primary }]}><ServiceIllustration kind={sv.art} size={40} /></View>
                      <Text style={s.serviceLabel} numberOfLines={1}>{sv.label.replace('Antar', '')}</Text>
                      {off && <View style={s.offPill}><Text style={s.offText}>Nonaktif</Text></View>}
                    </PressableScale>
                  </Entrance>
                );
              })}
            </View>

            {/* Banner teal berilustrasi (kit: "Let's Make Our Life so a Life · Find Trip") */}
            <Entrance index={11}>
              <PressableScale onPress={() => (isEnabled('travel') ? router.push('/travel' as never) : toast.show('Layanan ini sedang dinonaktifkan sementara'))} scaleTo={0.985} style={[s.banner, !isEnabled('travel') && { opacity: 0.45 }]}>
                <View style={{ flex: 1, gap: 6 }}>
                  <View style={s.bannerTag}><Ionicons name="bus-outline" size={11} color="#fff" /><Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>AntarTravel</Text></View>
                  <Text style={s.bannerTitle}>{t('banner_title')}</Text>
                  <Text style={s.bannerSub}>{t('banner_sub')}</Text>
                  <View style={s.bannerBtn}><Text style={{ color: colors.primaryDark, fontWeight: '800', fontSize: 13 }}>{t('banner_cta')}</Text></View>
                </View>
                <View style={s.bannerArt}><ServiceIllustration kind="travel" size={96} /></View>
              </PressableScale>
            </Entrance>

            {/* Order aktif → bubble */}
            {active.length > 0 && (
              <Entrance index={12}>
                <Row between style={{ marginTop: 22, marginBottom: 8 }}>
                  <Text style={font.h3}>{t('active_orders')}</Text>
                  <Text style={font.tiny}>{active.length} · {t('tap_detail')}</Text>
                </Row>
                <ActiveOrderBubbles orders={active} />
              </Entrance>
            )}

            {/* Promo — kartu destinasi tinggi */}
            {promos.length > 0 && (
              <Entrance index={13}>
                <Row between style={{ marginTop: 24, marginBottom: 12 }}>
                  <Text style={font.h3}>{t('promo_for_you')}</Text>
                  <Pressable onPress={() => router.push('/inbox' as never)}><Text style={s.seeAll}>{t('see_all')}</Text></Pressable>
                </Row>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingRight: 16, paddingBottom: 6 }}>
                  {promos.map((p, i) => <PromoCard key={p.code} promo={p} index={i} width={240} onPress={() => router.push((p.service ? serviceDef(p.service).route : '/food') as never)} />)}
                </ScrollView>
              </Entrance>
            )}

            {/* Sering dipesan — baris thumbnail (kit: daftar Group Tour) */}
            {freq && (freq.merchants.length > 0 || freq.routes.length > 0) && (
              <Entrance index={14}>
                <Row between style={{ marginTop: 20, marginBottom: 10 }}>
                  <Text style={font.h3}>{t('frequent')}</Text>
                  <Pressable onPress={() => router.push('/(customer)/orders')}><Text style={s.seeAll}>{t('history')}</Text></Pressable>
                </Row>
                <View style={{ gap: 10 }}>
                  {freq.merchants.slice(0, 3).map((m) => (
                    <PressableScale key={m.merchant_id} onPress={() => router.push(`/food/${m.merchant_id}` as never)} scaleTo={0.98} haptic={false} style={s.rowCard}>
                      <Image source={{ uri: m.image_url ?? undefined }} style={s.rowImg} />
                      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                        <Text style={[font.body, { fontWeight: '700' }]} numberOfLines={1}>{m.name}</Text>
                        <Row gap={6}><HalalBadge merchant={m} /><Text style={font.tiny}>AntarFood · {m.count}× dipesan</Text></Row>
                      </View>
                      <View style={s.rowArrow}><Ionicons name="arrow-forward" size={16} color={colors.primary} /></View>
                    </PressableScale>
                  ))}
                  {freq.routes.slice(0, 3).map((r, i) => {
                    const def = serviceDef(r.service);
                    return (
                      <PressableScale key={`${r.service}-${i}`} onPress={() => goRoute(r)} scaleTo={0.98} haptic={false} style={s.rowCard}>
                        <View style={[s.rowImg, { alignItems: 'center', justifyContent: 'center', backgroundColor: def.color + '14' }]}><ServiceIllustration kind={def.art} size={40} /></View>
                        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                          <Text style={[font.body, { fontWeight: '700' }]} numberOfLines={1}>{r.service === 'shop' && r.shop_store ? `${r.shop_store} → ` : ''}{r.dropoff_address.split(',')[0]}</Text>
                          <Row gap={4}><Ionicons name="location-outline" size={12} color={colors.textMuted} /><Text style={font.tiny} numberOfLines={1}>{def.label} · {r.count}× · {r.dropoff_address.split(',').slice(1, 3).join(',').trim() || 'ketuk untuk pesan lagi'}</Text></Row>
                        </View>
                        <View style={s.rowArrow}><Ionicons name="arrow-forward" size={16} color={colors.primary} /></View>
                      </PressableScale>
                    );
                  })}
                </View>
              </Entrance>
            )}

            {/* Merchant laris — kartu destinasi dengan rating */}
            <Entrance index={15}>
              <Row between style={{ marginTop: 24, marginBottom: 12 }}>
                <Text style={font.h3}>{t('trending_food')}</Text>
                <Pressable onPress={() => router.push('/food')}><Text style={s.seeAll}>{t('see_all')}</Text></Pressable>
              </Row>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingRight: 16, paddingBottom: 6 }}>
                {merchants === null ? [0, 1, 2].map((i) => <Skeleton key={i} width={170} height={230} radius={24} />) : merchants.map((m) => (
                  <DestinationCard key={m.id} image={m.image_url} title={m.name} subtitle={`${m.distance_km} km · ${m.is_halal ? 'Halal' : 'Non-halal'}`} rating={m.rating_avg} width={170} height={230} accent={colors.food} onPress={() => router.push(`/food/${m.id}` as never)} />
                ))}
                {merchants && merchants.length === 0 && <Text style={font.small}>Belum ada merchant di sekitar lokasi Anda.</Text>}
              </ScrollView>
            </Entrance>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const s = StyleSheet.create({
  inner: { width: '100%', maxWidth: 720, alignSelf: 'center', paddingHorizontal: spacing.lg },
  search: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 52, borderRadius: radius.full, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, paddingHorizontal: 16, ...shadow.soft },
  filterBtn: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.primaryLight },
  placeChip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, paddingHorizontal: 12, borderRadius: 17, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, maxWidth: 180 },
  placeDot: { width: 18, height: 18, borderRadius: 9, backgroundColor: colors.food, alignItems: 'center', justifyContent: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 22, rowGap: 14 },
  serviceTile: { alignItems: 'center', gap: 8, width: '100%', paddingHorizontal: 2 },
  serviceCircle: { width: 66, height: 66, borderRadius: 33, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, ...shadow.soft },
  serviceLabel: { fontSize: 12.5, fontWeight: '700', color: colors.text },
  offPill: { position: 'absolute', top: -4, right: 2, backgroundColor: colors.bgSoft, borderWidth: 1, borderColor: colors.border, borderRadius: radius.full, paddingHorizontal: 6, paddingVertical: 2 },
  offText: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },
  banner: { marginTop: 22, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.primary, borderRadius: 24, padding: 16, overflow: 'hidden', ...shadow.glow(colors.primary) },
  bannerTag: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: radius.full, paddingHorizontal: 9, paddingVertical: 4 },
  bannerTitle: { color: '#fff', fontSize: 18, fontWeight: '800', lineHeight: 23, letterSpacing: -0.3 },
  bannerSub: { color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '500' },
  bannerBtn: { alignSelf: 'flex-start', marginTop: 4, backgroundColor: '#fff', borderRadius: radius.full, paddingHorizontal: 16, paddingVertical: 9 },
  bannerArt: { width: 110, alignItems: 'center', justifyContent: 'center' },
  seeAll: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  rowCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 20, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, ...shadow.soft },
  rowImg: { width: 64, height: 64, borderRadius: 16, backgroundColor: colors.bgSoft },
  rowArrow: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.tint },
});
