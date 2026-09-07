// Detail booking travel pelanggan — gaya "Tour Details": hero, kartu menumpuk, tab, bar bawah harga
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Alert, Platform, ScrollView, Image, useWindowDimensions } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { Screen, Row, Badge, Button, Avatar, Stars, Loading, CircleButton, IconCircle, toast, type IconName } from '@/components/ui';
import { Entrance, PressableScale } from '@/components/motion';
import { BrandGradient } from '@/components/glass';
import { ServiceIllustration } from '@/components/ServiceArt';
import { CallButton } from '@/components/call/IncomingCall';
import { SosButton } from '@/components/Safety';
import { useCities } from '@/hooks/useTravel';
import { supabase, rpc, realtimeChannel } from '@/lib/supabase';
import { colors, font, radius, shadow, motion } from '@/lib/theme';
import { rupiah, formatSchedule, paidViaLabel, travelStatusLabel, tripStatusLabel, cityName } from '@/lib/format';
import type { TravelBooking, TravelTrip, TravelRoute, TravelPartner, Profile } from '@/lib/types';

type Full = TravelBooking & { trip: TravelTrip & { route: TravelRoute; partner: TravelPartner & { profile: Profile } } };
type Tab = 'ringkasan' | 'penumpang' | 'kebijakan';
const TABS: { key: Tab; label: string }[] = [{ key: 'ringkasan', label: 'Ringkasan' }, { key: 'penumpang', label: 'Penumpang' }, { key: 'kebijakan', label: 'Kebijakan' }];

export default function TravelBookingDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const cities = useCities();
  const [b, setB] = useState<Full | null | undefined>(undefined);
  const [tab, setTab] = useState<Tab>('ringkasan');
  const heroH = Math.round(height * 0.4);
  const load = async () => { const { data } = await supabase.from('travel_bookings').select('*, trip:travel_trips(*, route:travel_routes(*), partner:travel_partners(*, profile:profiles(*)))').eq('id', id).maybeSingle(); setB((data as Full) ?? null); };
  useEffect(() => { load(); const ch = realtimeChannel(`tbk:${id}`).on('postgres_changes', { event: '*', schema: 'public', table: 'travel_bookings', filter: `id=eq.${id}` }, load).on('postgres_changes', { event: '*', schema: 'public', table: 'travel_trips' }, load).subscribe(); return () => { supabase.removeChannel(ch); }; }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (b === undefined) return <Screen title="Booking travel" back><Loading /></Screen>;
  if (!b) return <Screen title="Booking travel" back><Text style={font.small}>Booking tidak ditemukan.</Text></Screen>;
  const t = b.trip; const p = t.partner;
  const canCancel = ['booked', 'confirmed'].includes(b.status) && new Date(t.depart_at).getTime() - Date.now() > 3 * 3600e3;
  const cancel = () => {
    const doIt = async () => { try { await rpc('travel_booking_cancel', { p_id: b.id, p_reason: 'Dibatalkan pelanggan' }); toast.show('Booking dibatalkan'); load(); } catch (e) { toast.error((e as Error).message); } };
    if (Platform.OS === 'web') { if (confirm('Batalkan booking travel ini?')) doIt(); return; }
    Alert.alert('Batalkan booking?', 'Dana dikembalikan ke AntarPay bila sudah dibayar.', [{ text: 'Tidak' }, { text: 'Ya, batalkan', style: 'destructive', onPress: doIt }]);
  };
  const rate = async (v: number) => { try { await rpc('travel_rate', { p_booking: b.id, p_stars: v }); toast.success('Terima kasih atas penilaian Anda'); load(); } catch (e) { toast.error((e as Error).message); } };
  const contactCs = () => router.push({ pathname: '/support/new', params: { category: 'order', subject: `Travel ${b.code}` } } as never);
  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/travel' as never));
  const sc = b.status === 'completed' ? colors.success : b.status === 'cancelled' ? colors.danger : colors.primary;
  const active = ['booked', 'confirmed', 'picked_up'].includes(b.status);
  const filled = t.seats_total > 0 ? Math.round((t.seats_booked / t.seats_total) * 100) : 0;
  const partnerName = p.company_name ?? p.profile?.full_name;

  const infoRow = (icon: IconName, label: string, value: string, color = colors.primary) => (
    <Row gap={12} style={{ paddingVertical: 8 }}>
      <IconCircle name={icon} size={40} bg={colors.tint} color={color} />
      <View style={{ flex: 1 }}><Text style={font.tiny}>{label}</Text><Text style={[font.body, { fontWeight: '600' }]}>{value}</Text></View>
    </Row>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 140 }} showsVerticalScrollIndicator={false}>
        <Animated.View entering={FadeIn.duration(motion.slow)} style={{ height: heroH }}>
          <BrandGradient colors={[colors.travel, colors.primaryDeep]} style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
            {p.photo_url ? <Image source={{ uri: p.photo_url }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : <ServiceIllustration kind="travel" size={140} />}
          </BrandGradient>
          <BrandGradient colors={['rgba(0,0,0,0.25)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0.35)']} angle="vertical" style={StyleSheet.absoluteFill} />
          <View style={[s.statusPill, { top: insets.top + 60 }]}><Text style={{ color: '#fff', fontSize: 12, fontWeight: '800' }}>{travelStatusLabel[b.status]}</Text></View>
        </Animated.View>

        <View style={s.wrap}>
          <Animated.View entering={FadeInDown.duration(motion.slow)} style={s.sheet}>
            <View style={s.handle} />
            <Row between style={{ alignItems: 'flex-start' }}>
              <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                <Text style={font.h1}>{cityName(cities, t.route.from_city)} → {cityName(cities, t.route.to_city)}</Text>
                <Row gap={4}><Ionicons name="location-outline" size={14} color={colors.textMuted} /><Text style={font.small} numberOfLines={1}>Berangkat {formatSchedule(t.depart_at)}</Text></Row>
              </View>
              <View style={s.ratingPill}><Ionicons name="star" size={13} color={colors.accent} /><Text style={{ fontWeight: '800', fontSize: 13, color: colors.text }}>{Number(p.rating_avg).toFixed(1)}</Text></View>
            </Row>
            <Row gap={8} style={{ marginTop: 12, flexWrap: 'wrap' }}>
              <Badge text={`${b.pax} penumpang${b.is_private ? ' · private' : ''}`} color={colors.primary} />
              <Badge text={`${tripStatusLabel[t.status]} · ${filled}% terisi`} color={t.status === 'confirmed' ? colors.success : colors.textSecondary} />
              <Badge text={b.code} color={colors.textMuted} />
            </Row>
            <Row gap={8} style={{ marginTop: 16 }}>
              {TABS.map((x) => (
                <PressableScale key={x.key} onPress={() => setTab(x.key)} scaleTo={0.94} style={[s.tab, tab === x.key && s.tabOn]}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: tab === x.key ? '#fff' : colors.text }}>{x.label}</Text>
                </PressableScale>
              ))}
            </Row>
          </Animated.View>

          <View style={{ paddingHorizontal: 16, gap: 12, marginTop: 14 }}>
            {tab === 'ringkasan' && (
              <>
                <Entrance index={0}><View style={s.card}>
                  <Row gap={12}>
                    <Avatar name={partnerName} url={p.photo_url ?? p.profile?.avatar_url} size={52} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={font.h3} numberOfLines={1}>{partnerName}</Text>
                      <Text style={font.small} numberOfLines={1}>{p.vehicle_model} · {p.vehicle_plate}{p.is_electric ? ' · listrik' : ''}</Text>
                      <Text style={font.tiny}>{p.total_trips} trip · {p.rating_count} ulasan</Text>
                    </View>
                    {active && p.profile && <CallButton peer={{ id: p.id, name: partnerName, role: 'driver' }} size={40} color={colors.primary} />}
                  </Row>
                </View></Entrance>
                <Entrance index={1}><View style={s.card}>
                  {infoRow('home-outline', 'Jemput di', b.pickup_address)}
                  {b.dropoff_address ? infoRow('flag-outline', 'Diantar sampai', b.dropoff_address, colors.danger) : null}
                  {infoRow('people-outline', 'Kursi mobil', `${t.seats_booked}/${t.seats_total} terisi${t.status === 'open' ? ` · min. ${t.min_pax} agar berangkat` : ''}`)}
                  {infoRow('card-outline', 'Pembayaran', `${paidViaLabel(b.paid_via)} · ${b.payment_status === 'paid' ? 'Lunas' : b.payment_status === 'refunded' ? 'Dikembalikan' : 'Bayar tunai saat dijemput'}`)}
                </View></Entrance>
                <Entrance index={2}><View style={s.card}>
                  <Row between><Text style={font.small}>{b.is_private ? 'Carter private' : `${b.pax} kursi`}</Text><Text style={font.body}>{rupiah(b.price - b.platform_fee)}</Text></Row>
                  <Row between style={{ marginTop: 6 }}><Text style={font.small}>Biaya layanan</Text><Text style={font.body}>{rupiah(b.platform_fee)}</Text></Row>
                  <View style={s.divider} />
                  <Row between><Text style={font.h3}>Total</Text><Text style={[font.h3, { color: sc }]}>{rupiah(b.price)}</Text></Row>
                </View></Entrance>
                {active && <Entrance index={3}><View style={[s.card, { backgroundColor: colors.tint, borderColor: colors.primaryLight }]}><Row gap={10}><SosButton compact /><Text style={[font.tiny, { flex: 1 }]}>Tombol SOS & nomor tersamar aktif selama perjalanan. Mitra akan menghubungi Anda ±1 jam sebelum jemput.</Text></Row></View></Entrance>}
                {b.status === 'completed' && <Entrance index={3}><View style={s.card}><Row between><Text style={font.h3}>Nilai perjalanan</Text><Stars value={b.rating ?? 0} size={24} onChange={b.rating ? undefined : rate} /></Row></View></Entrance>}
              </>
            )}

            {tab === 'penumpang' && (
              <Entrance index={0}><View style={s.card}>
                {(b.passengers?.length ? b.passengers : [{ name: 'Penumpang' }]).map((x, i) => (
                  <Row key={i} gap={12} style={{ paddingVertical: 8 }}>
                    <IconCircle name="person-outline" size={40} bg={colors.tint} />
                    <View style={{ flex: 1 }}><Text style={[font.body, { fontWeight: '600' }]}>{x.name}</Text>{x.phone ? <Text style={font.tiny}>{x.phone}</Text> : null}</View>
                    <Badge text={`Kursi ${i + 1}`} color={colors.textMuted} />
                  </Row>
                ))}
                <Text style={[font.tiny, { marginTop: 6 }]}>{b.is_private ? `Carter private untuk ${b.pax} orang, seluruh mobil untuk rombongan Anda.` : `${b.pax} kursi dipesan atas nama Anda.`}</Text>
              </View></Entrance>
            )}

            {tab === 'kebijakan' && (
              <Entrance index={0}><View style={s.card}>
                {infoRow('time-outline', 'Pembatalan', 'Gratis hingga 3 jam sebelum berangkat. Dana dikembalikan ke AntarPay bila sudah dibayar.')}
                {infoRow('people-outline', 'Keberangkatan', `Mobil berangkat bila minimal ${t.min_pax} penumpang terkumpul (kecuali private).`)}
                {infoRow('car-outline', 'Penjemputan', 'Penumpang dijemput di alamat masing-masing sekitar 1 jam sebelum jadwal.')}
                {infoRow('shield-checkmark-outline', 'Keamanan', 'Nomor tersamar dan tombol SOS aktif selama perjalanan.')}
                <Button title="Ada kendala? Hubungi CS" variant="ghost" color={colors.textSecondary} icon="help-circle-outline" onPress={contactCs} style={{ marginTop: 6 }} />
              </View></Entrance>
            )}
          </View>
        </View>
      </ScrollView>

      <CircleButton icon="chevron-back" onPress={goBack} style={[s.overlay, { top: insets.top + 8, left: 16 }]} />
      <CircleButton icon="help-circle-outline" onPress={contactCs} style={[s.overlay, { top: insets.top + 8, right: 16 }]} />

      <View style={[s.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <Row between gap={12}>
          <View style={{ flex: 1 }}>
            <Text style={font.tiny}>Total {b.is_private ? 'carter' : `${b.pax} kursi`}</Text>
            <Text style={[font.h1, { color: colors.primary }]}>{rupiah(b.price)}</Text>
          </View>
          {canCancel ? <Button title="Batalkan" variant="danger" size="lg" onPress={cancel} style={{ minWidth: 150 }} /> : <Button title="Hubungi CS" size="lg" icon="chatbubble-ellipses-outline" onPress={contactCs} style={{ minWidth: 150 }} />}
        </Row>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { width: '100%', maxWidth: 640, alignSelf: 'center' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, marginTop: -28, padding: 20, paddingTop: 12, borderWidth: 1, borderBottomWidth: 0, borderColor: colors.border, ...shadow.card },
  handle: { width: 44, height: 5, borderRadius: 3, backgroundColor: colors.border, alignSelf: 'center', marginBottom: 14 },
  ratingPill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.accentLight, borderRadius: radius.full, paddingHorizontal: 10, paddingVertical: 6, marginLeft: 8 },
  statusPill: { position: 'absolute', left: 16, backgroundColor: 'rgba(16,31,33,0.72)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.full },
  tab: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, backgroundColor: '#fff' },
  tabOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  card: { backgroundColor: '#fff', borderRadius: radius.lg, padding: 16, borderWidth: 1, borderColor: colors.border, ...shadow.soft },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 10 },
  overlay: { position: 'absolute' },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 12, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: colors.border, ...shadow.sheet },
});
