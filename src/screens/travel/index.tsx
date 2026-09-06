// AntarTravel — 3 mode: kursi bersama (jadwal mitra), carter privat (sekali jalan 1 rombongan), sopir harian (mobil + sopir per hari)
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import { Screen, Button, Row, Badge, Input, Chip, Stepper, Avatar, Empty, Card, IconCircle, toast } from '@/components/ui';
import { PressableScale, Skeleton, Entrance, ProgressBar } from '@/components/motion';
import { LocationFields } from '@/components/LocationField';
import { PaymentSection, PriceSummary, paidViaOf, handleShortfall, type PayChoice } from '@/components/BookingSheet';
import { ServiceIllustration } from '@/components/ServiceArt';
import { useCities, useTravelSearch, useMyTravelBookings, useTravelRequests } from '@/hooks/useTravel';
import { usePayPrefs } from '@/store/payprefs';
import { useBooking } from '@/store/booking';
import { useAuth } from '@/store/auth';
import { useCurrentLocation } from '@/hooks/useLocation';
import { reverseGeocode } from '@/lib/geo';
import { rpc, supabase } from '@/lib/supabase';
import { colors, font, radius, motion, shadow } from '@/lib/theme';
import { rupiah, formatSchedule, formatDate, travelStatusLabel, tripStatusLabel, cityName, travelRequestStatusLabel, travelKindLabel } from '@/lib/format';
import type { TravelBooking, TravelSearchTrip, TravelPartnerCard, TravelRequest, TravelRequestKind, TravelAccommodation } from '@/lib/types';

const DAY_NAMES = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
type Mode = 'shared' | TravelRequestKind;
const MODES: { key: Mode; label: string; icon: React.ComponentProps<typeof Ionicons>['name'] }[] = [
  { key: 'shared', label: 'Kursi', icon: 'people-outline' },
  { key: 'charter', label: 'Carter', icon: 'car-outline' },
  { key: 'daily', label: 'Sopir', icon: 'calendar-outline' },
];
const MIN_LEAD_MS = 2 * 3600e3;
const requestStatusColor = (st: TravelRequest['status']) => st === 'completed' ? colors.success : st === 'cancelled' || st === 'expired' ? colors.danger : st === 'offered' ? colors.accent : colors.travel;

export default function TravelScreen() {
  const router = useRouter();
  const cities = useCities();
  const { session, profile, refreshWallet } = useAuth();
  const { pickup, setPickup } = useBooking();
  const { location, hasFix } = useCurrentLocation();
  const [mode, setMode] = useState<Mode>('shared');
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const days = useMemo(() => Array.from({ length: 10 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() + i); d.setHours(0, 0, 0, 0); return d; }), []);
  const [day, setDay] = useState<Date | null>(null);
  const { result, loading } = useTravelSearch(from, to, day ? ymd(day) : null);
  const [trip, setTrip] = useState<TravelSearchTrip | null>(null);
  const [pax, setPax] = useState(1);
  const [priv, setPriv] = useState(false);
  const [dropAddr, setDropAddr] = useState('');
  const [names, setNames] = useState('');
  const [method, setMethod] = useState<PayChoice>('cash');
  const payPrefs = usePayPrefs((st) => st.prefs);
  const [promo, setPromo] = useState(''); const [discount, setDiscount] = useState(0); const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const { bookings } = useMyTravelBookings(session?.user.id);

  useEffect(() => {
    if (!pickup && hasFix) reverseGeocode(location).then((address) => { if (!useBooking.getState().pickup) setPickup({ ...location, address, name: 'Lokasi saya' }); });
  }, [hasFix]); // eslint-disable-line react-hooks/exhaustive-deps
  // kota asal default = kota terdekat
  useEffect(() => {
    if (from || cities.length === 0) return;
    supabase.rpc('nearest_city', { p_lat: location.lat, p_lng: location.lng, p_max_km: 80 }).then(({ data }) => { if (data) setFrom(data as string); });
  }, [cities, location.lat, location.lng]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setTrip(null); setPriv(false); }, [from, to, day]);

  const route = result?.route ?? null;
  const price = trip ? (priv ? trip.private_price : trip.seat_price * pax) : 0;
  const fee = 5000;
  const total = trip ? Math.max(0, price + fee - discount) : 0;
  const fromCity = cities.find((c) => c.id === from), toCity = cities.find((c) => c.id === to);

  const book = async () => {
    if (!trip || !pickup) return toast.error('Isi alamat jemput');
    setBusy(true);
    try {
      const passengers = names.split(/[,\n]/).map((n) => n.trim()).filter(Boolean).map((name) => ({ name }));
      const b = await rpc<TravelBooking>('travel_book', { p: { trip_id: trip.id, pax: priv ? pax : pax, is_private: priv, pickup_address: pickup.address, pickup_lat: pickup.lat, pickup_lng: pickup.lng, dropoff_address: dropAddr || null, passengers: passengers.length ? passengers : [{ name: profile?.full_name ?? 'Penumpang' }], paid_via: paidViaOf(method, payPrefs?.ewallet), notes: notes || null } });
      await refreshWallet(); useBooking.getState().reset();
      toast.success(`Booking ${b.code} berhasil`);
      router.replace(`/travel/${b.id}` as never);
    } catch (e) { if (!handleShortfall(e, router, payPrefs?.ewallet)) toast.error((e as Error).message); }
    finally { setBusy(false); }
  };

  const sharedFooter = mode === 'shared' && trip ? <Button title={`${priv ? 'Carter private' : `Pesan ${pax} kursi`} · ${rupiah(total)}`} size="lg" loading={busy} onPress={book} /> : undefined;

  return (
    <Screen title="AntarTravel" subtitle="Antar kota · jemput di rumah" band={colors.travel} back maxWidth={640} footer={sharedFooter}>
      <View style={{ gap: 14 }}>
        <Entrance index={0}>
          <View style={s.modeRow}>
            {MODES.map((m) => {
              const active = mode === m.key;
              return (
                <PressableScale key={m.key} onPress={() => setMode(m.key)} scaleTo={0.96} style={[s.modeChip, active && { backgroundColor: colors.primary, borderColor: colors.primary }]}>
                  <Ionicons name={m.icon} size={16} color={active ? '#fff' : colors.primary} />
                  <Text style={{ fontSize: 12, fontWeight: '700', color: active ? '#fff' : colors.text }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>{m.label}</Text>
                </PressableScale>
              );
            })}
          </View>
        </Entrance>

        {mode !== 'shared' ? (
          <RequestMode key={mode} kind={mode} uid={session?.user.id} />
        ) : (
          <>
        <Entrance index={1}><Row gap={12} style={s.hero}>
          <View style={s.heroArt}><ServiceIllustration kind="travel" size={44} /></View>
          <View style={{ flex: 1 }}><Text style={font.h3}>Travel antar kota</Text><Text style={font.tiny}>Innova / Hi-Ace mitra resmi · jemput di rumah · bisa private 1 keluarga · booking tanggal</Text></View>
        </Row></Entrance>

        <View style={s.group}>
          <Text style={font.label}>Dari kota</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>{cities.map((c) => <Chip key={c.id} label={c.name} active={from === c.id} onPress={() => setFrom(c.id)} />)}</ScrollView>
          <Text style={font.label}>Ke kota</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>{cities.filter((c) => c.id !== from).map((c) => <Chip key={c.id} label={c.name} active={to === c.id} onPress={() => setTo(c.id)} />)}</ScrollView>
          <Text style={font.label}>Tanggal berangkat</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            <Pressable onPress={() => setDay(null)} style={[s.day, !day && { backgroundColor: colors.primary, borderColor: colors.primary }]}><Text style={{ fontSize: 12, fontWeight: '700', color: !day ? '#fff' : colors.textMuted }}>Semua</Text><Text style={{ fontSize: 15, fontWeight: '800', color: !day ? '#fff' : colors.text }} numberOfLines={1}>10 hr</Text></Pressable>
            {days.map((d, i) => { const active = day && d.getTime() === day.getTime(); return (
              <Pressable key={i} onPress={() => setDay(d)} style={[s.day, active && { backgroundColor: colors.primary, borderColor: colors.primary }]}>
                <Text style={{ fontSize: 12, fontWeight: '700', color: active ? '#fff' : colors.textMuted }}>{i === 0 ? 'Hari ini' : i === 1 ? 'Besok' : DAY_NAMES[d.getDay()]}</Text>
                <Text style={{ fontSize: 18, fontWeight: '800', color: active ? '#fff' : colors.text }}>{d.getDate()}</Text>
              </Pressable>); })}
          </ScrollView>
          {route && <Row gap={6} style={{ flexWrap: 'wrap' }}><Badge text={`${route.distance_km} km · ±${route.duration_h} jam`} color={colors.info} /><Badge text={`Kursi ${rupiah(route.seat_price)}/orang`} /><Badge text={`Private mulai ${rupiah(route.private_price)}`} color={colors.accent} /><Badge text={`Min. ${route.min_pax} penumpang berangkat`} color={colors.textMuted} /></Row>}
        </View>

        {from && !to && <Text style={[font.small, { textAlign: 'center', paddingVertical: 6 }]}>Pilih kota tujuan untuk melihat jadwal keberangkatan.</Text>}
        {from && to && (loading ? <Skeleton height={90} radius={radius.lg} /> : !result?.route ? <Empty icon="bus-outline" title="Rute belum tersedia" subtitle="Belum ada mitra travel untuk rute ini. Coba rute lain atau ajukan carter privat." /> : result.trips.length === 0 ? (
          <Empty icon="calendar-outline" title="Belum ada jadwal" subtitle={`Belum ada keberangkatan ${fromCity?.name} → ${toCity?.name}${day ? ' pada tanggal ini' : ''}. Coba tanggal lain.`} />
        ) : (
          <View style={{ gap: 8 }}>
            <Text style={font.label}>Jadwal keberangkatan {fromCity?.name} → {toCity?.name}</Text>
            {result.trips.map((t) => {
              const active = trip?.id === t.id; const p = t.partner;
              const filled = t.seats_total > 0 ? Math.min(1, t.seats_booked / t.seats_total) : 0;
              const time = new Date(t.depart_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
              return (
                <PressableScale key={t.id} onPress={() => { setTrip(t); if (t.seats_left < pax) setPax(Math.max(1, t.seats_left)); }} scaleTo={0.985} haptic={false} style={[s.trip, active && { borderColor: colors.primary, backgroundColor: colors.tint }]}>
                  <Row gap={12} style={{ alignItems: 'flex-start' }}>
                    {p.photo_url ? <Avatar name={p.company ?? p.name} url={p.photo_url} size={64} /> : <View style={s.thumb}><ServiceIllustration kind="travel" size={40} /></View>}
                    <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                      <Row between>
                        <Text style={[font.body, { fontWeight: '800', flex: 1 }]} numberOfLines={1}>{p.company ?? p.name}</Text>
                        {!!p.is_electric && <Badge text="Listrik" color={colors.success} />}
                      </Row>
                      <Row gap={4}><Ionicons name="location-outline" size={13} color={colors.textMuted} /><Text style={font.tiny} numberOfLines={1}>{fromCity?.name} → {toCity?.name} · {time} WIB · {new Date(t.depart_at).toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' })}</Text></Row>
                      <Text style={font.tiny} numberOfLines={1}>{p.model} · {p.plate} · {Number(p.rating).toFixed(1)} ({p.rating_count}) · {tripStatusLabel[t.status]}</Text>
                      <Row gap={8} style={{ marginTop: 2 }}>
                        <View style={{ flex: 1 }}><ProgressBar progress={filled} color={t.seats_left <= 2 ? colors.warning : colors.primary} /></View>
                        <Text style={[font.tiny, { fontWeight: '700', color: colors.text }]}>{Math.round(filled * 100)}% · {t.seats_left} sisa</Text>
                      </Row>
                      <Row between style={{ marginTop: 2 }}>
                        <Text style={{ fontWeight: '800', color: colors.primary, fontSize: 16 }}>{rupiah(t.seat_price)}<Text style={font.tiny}> /kursi</Text></Text>
                        <View style={[s.rowArrow, active && { backgroundColor: colors.primary, borderColor: colors.primary }]}><Ionicons name={active ? 'checkmark' : 'arrow-forward'} size={16} color={active ? '#fff' : colors.primary} /></View>
                      </Row>
                      {t.allow_private ? <Text style={font.tiny}>Private 1 keluarga {rupiah(t.private_price)}</Text> : null}
                    </View>
                  </Row>
                </PressableScale>
              );
            })}
          </View>
        ))}

        {trip && (
          <Animated.View entering={FadeInDown.duration(motion.base)} layout={LinearTransition.springify().stiffness(300).damping(22)} style={{ gap: 14 }}>
            <View style={s.group}>
              <Row gap={8}>
                <Chip label="Bersama (per kursi)" active={!priv} onPress={() => setPriv(false)} />
                {!!trip.allow_private && <Chip label={`Private 1 keluarga · ${rupiah(trip.private_price)}`} active={priv} onPress={() => setPriv(true)} color={colors.accent} />}
              </Row>
              <Row between>
                <View><Text style={{ fontWeight: '800', color: colors.text }}>Jumlah penumpang</Text><Text style={font.tiny}>{priv ? `Maks. ${trip.seats_total} orang (sekeluarga)` : `Kursi tersisa ${trip.seats_left}`}</Text></View>
                <Stepper value={pax} onChange={setPax} min={1} max={priv ? trip.seats_total : trip.seats_left} />
              </Row>
              <Input placeholder="Nama penumpang (pisahkan koma)" icon="people-outline" value={names} onChangeText={setNames} />
            </View>
            <LocationFields pickup={pickup} dropoff={null} pickupLabel="Jemput di (rumah/kantor)" dropoffLabel="—" lockDropoff accent={colors.travel} />
            <Input placeholder={`Alamat tujuan di ${toCity?.name ?? 'kota tujuan'} (diantar sampai alamat)`} icon="flag-outline" value={dropAddr} onChangeText={setDropAddr} />
            <View style={s.group}><PriceSummary rows={[{ label: priv ? `Carter private (${trip.partner.model})` : `${pax} kursi × ${rupiah(trip.seat_price)}`, value: price }, { label: 'Biaya layanan', value: fee }, { label: 'Diskon promo', value: discount, minus: true }]} total={total} /></View>
            <PaymentSection method={method} onMethod={setMethod} promo={promo} onPromo={setPromo} notes={notes} onNotes={setNotes} subtotal={price} service="ride_car" onDiscount={setDiscount} notesPlaceholder="Catatan untuk mitra travel (bawaan, jam jemput)" />
            <Text style={font.tiny}>Mobil berangkat bila minimal {trip.min_pax} penumpang terkumpul (kecuali private). Pembatalan gratis s.d. 3 jam sebelum berangkat. Penumpang dijemput di alamat masing-masing ±1 jam sebelum jadwal.</Text>
          </Animated.View>
        )}

        {bookings.length > 0 && !trip && (
          <View style={{ gap: 8 }}>
            <Text style={font.label}>Booking travel saya</Text>
            {bookings.slice(0, 5).map((b) => (
              <PressableScale key={b.id} onPress={() => router.push(`/travel/${b.id}` as never)} scaleTo={0.985} haptic={false} style={s.trip}>
                <Row gap={12}>
                  <IconCircle name="bus-outline" size={44} bg={colors.tint} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ fontWeight: '800', color: colors.text }} numberOfLines={1}>{cityName(cities, b.trip.route.from_city)} → {cityName(cities, b.trip.route.to_city)}</Text>
                    <Text style={font.tiny} numberOfLines={1}>{formatSchedule(b.trip.depart_at)} · {b.pax} pax{b.is_private ? ' · private' : ''} · {b.code}</Text>
                    <Badge text={travelStatusLabel[b.status]} color={b.status === 'completed' ? colors.success : b.status === 'cancelled' ? colors.danger : colors.primary} style={{ marginTop: 4 }} />
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                </Row>
              </PressableScale>
            ))}
          </View>
        )}
        <Text style={[font.tiny, { textAlign: 'center' }]}>Dibuat {formatDate(new Date().toISOString(), false)} · harga acuan operator travel Sumatra 2026</Text>
          </>
        )}
      </View>
    </Screen>
  );
}

// ---------- Mode carter privat & sopir harian: form permintaan + direktori mitra + permintaan saya ----------
const LUGGAGE = [['ringan', 'Ringan (tas)'], ['sedang', 'Sedang (1–2 koper)'], ['banyak', 'Banyak (bagasi penuh)']] as const;
const VEHICLE_PREF: [string | null, string][] = [[null, 'Bebas'], ['MPV 6 kursi', 'MPV 6 kursi'], ['Hi-Ace', 'Hi-Ace'], ['Listrik', 'Listrik (EV)']];
const roundUp30 = (d: Date) => { const t = new Date(d); t.setSeconds(0, 0); t.setMinutes(t.getMinutes() % 30 === 0 ? t.getMinutes() : t.getMinutes() + (30 - (t.getMinutes() % 30))); return t; };

function RequestMode({ kind, uid }: { kind: TravelRequestKind; uid?: string }) {
  const router = useRouter();
  const { wallet, refreshWallet } = useAuth();
  const { pickup, dropoff, setPickup, setDropoff } = useBooking();
  const { location, hasFix } = useCurrentLocation();
  const payPrefs = usePayPrefs((st) => st.prefs);
  const daily = kind === 'daily';
  const [departAt, setDepartAt] = useState<Date>(() => roundUp30(new Date(Date.now() + 3 * 3600e3)));
  const [days, setDays] = useState(1);
  const [returnDay, setReturnDay] = useState<Date | null>(null);
  const [pax, setPax] = useState(daily ? 4 : 6);
  const [luggage, setLuggage] = useState<string>('sedang');
  const [vehiclePref, setVehiclePref] = useState<string | null>(null);
  const [accommodation, setAccommodation] = useState<TravelAccommodation>('customer');
  const [fuel, setFuel] = useState<'customer' | 'partner'>('customer');
  const [notes, setNotes] = useState('');
  const [budget, setBudget] = useState('');
  const [method, setMethod] = useState<'wallet' | 'cash'>('wallet');
  const [partner, setPartner] = useState<TravelPartnerCard | null>(null);
  const [partners, setPartners] = useState<TravelPartnerCard[] | null>(null);
  const [busy, setBusy] = useState(false);
  const { requests } = useTravelRequests(uid);

  useEffect(() => {
    if (!pickup && hasFix) reverseGeocode(location).then((address) => { if (!useBooking.getState().pickup) setPickup({ ...location, address, name: 'Lokasi saya' }); });
  }, [hasFix]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let alive = true;
    setPartners(null);
    rpc<TravelPartnerCard[]>('travel_partners_directory', { p_kind: kind, p_city: null }).then((d) => { if (alive) setPartners(d ?? []); }).catch(() => { if (alive) setPartners([]); });
    return () => { alive = false; };
  }, [kind]);
  useEffect(() => { if (!daily) setDays(1); }, [daily]);

  // pilihan tanggal (14 hari) & jam (tiap 30 menit, minimal 2 jam ke depan)
  const dayOptions = useMemo(() => Array.from({ length: 14 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() + i); d.setHours(0, 0, 0, 0); return d; }), []);
  const departDay = useMemo(() => { const d = new Date(departAt); d.setHours(0, 0, 0, 0); return d; }, [departAt]);
  const timeOptions = useMemo(() => {
    const out: Date[] = [];
    for (let h = 0; h < 24; h++) for (const m of [0, 30]) { const d = new Date(departDay); d.setHours(h, m, 0, 0); if (d.getTime() >= Date.now() + MIN_LEAD_MS) out.push(d); }
    return out;
  }, [departDay]);
  const pickDay = (d: Date) => {
    const t = new Date(d); t.setHours(departAt.getHours(), departAt.getMinutes(), 0, 0);
    if (t.getTime() < Date.now() + MIN_LEAD_MS) t.setTime(roundUp30(new Date(Date.now() + MIN_LEAD_MS + 30 * 60000)).getTime());
    setDepartAt(t);
    if (returnDay && returnDay.getTime() < d.getTime()) setReturnDay(null);
  };
  const returnOptions = useMemo(() => Array.from({ length: 31 }, (_, i) => { const d = new Date(departDay); d.setDate(d.getDate() + i); return d; }).filter((d) => d.getTime() >= departDay.getTime() + (days - 1) * 86400e3), [departDay, days]);

  const submit = async () => {
    if (!uid) return toast.error('Masuk dulu untuk mengirim permintaan');
    if (!pickup) return toast.error('Isi alamat jemput');
    if (!daily && !dropoff) return toast.error('Isi tujuan carter');
    if (departAt.getTime() < Date.now() + MIN_LEAD_MS) return toast.error('Jadwal berangkat minimal 2 jam dari sekarang');
    setBusy(true);
    try {
      const ret = returnDay ? (() => { const r = new Date(returnDay); r.setHours(18, 0, 0, 0); return r.toISOString(); })() : null;
      const r = await rpc<TravelRequest>('travel_request_create', { p: {
        kind, partner_id: partner?.id ?? null,
        pickup_address: pickup.address, pickup_lat: pickup.lat, pickup_lng: pickup.lng,
        dropoff_address: dropoff?.address ?? null, dropoff_lat: dropoff?.lat ?? null, dropoff_lng: dropoff?.lng ?? null,
        depart_at: departAt.toISOString(), return_at: ret, days: daily ? days : 1, pax, luggage, accommodation, fuel,
        vehicle_pref: vehiclePref, notes: notes || null, budget: Number(budget.replace(/\D/g, '')) || null,
        payment_method: method, paid_via: paidViaOf(method, payPrefs?.ewallet),
      } });
      await refreshWallet(); useBooking.getState().reset();
      toast.success(`Permintaan ${r.code} terkirim — mitra akan mengirim penawaran`);
      router.push(`/travel/request/${r.id}` as never);
    } catch (e) { if (!handleShortfall(e, router, payPrefs?.ewallet)) toast.error((e as Error).message); }
    finally { setBusy(false); }
  };

  const nights = Math.max(0, days - 1);
  return (
    <View style={{ gap: 14 }}>
      <Entrance index={0}><Row gap={12} style={s.hero}>
        <View style={s.heroArt}><ServiceIllustration kind="car" size={44} /></View>
        <View style={{ flex: 1 }}>
          <Text style={font.h3}>{daily ? 'Mobil + sopir per hari' : 'Carter privat sekali jalan'}</Text>
          <Text style={font.tiny}>{daily ? 'Keliling kota atau luar kota, 12 jam/hari. Mitra mengirim penawaran, Anda pilih yang cocok.' : 'Satu mobil untuk keluarga/rombongan Anda, jemput di rumah, antar sampai alamat tujuan. Mitra mengirim penawaran harga.'}</Text>
        </View>
      </Row></Entrance>

      {partner && (
        <Row gap={8} style={[s.group, { borderColor: colors.primary, backgroundColor: colors.tint }]}>
          <Avatar name={partner.company_name ?? partner.name} url={partner.photo_url ?? partner.avatar_url} size={36} />
          <View style={{ flex: 1 }}><Text style={{ fontWeight: '800', color: colors.text }}>Diajukan ke {partner.company_name ?? partner.name}</Text><Text style={font.tiny}>Hanya mitra ini yang menerima permintaan Anda.</Text></View>
          <Button size="sm" variant="ghost" title="Lepas" onPress={() => setPartner(null)} />
        </Row>
      )}

      <Entrance index={1}><LocationFields pickup={pickup} dropoff={dropoff} pickupLabel="Alamat jemput" dropoffLabel={daily ? 'Rute / kota yang dikunjungi (opsional)' : 'Tujuan'} accent={colors.travel} /></Entrance>

      <Entrance index={2}><View style={s.group}>
        <Text style={font.label}>Tanggal & jam berangkat</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {dayOptions.map((d, i) => { const active = d.getTime() === departDay.getTime(); return (
            <Pressable key={i} onPress={() => pickDay(d)} style={[s.day, active && { backgroundColor: colors.primary, borderColor: colors.primary }]}>
              <Text style={{ fontSize: 12, fontWeight: '700', color: active ? '#fff' : colors.textMuted }}>{i === 0 ? 'Hari ini' : i === 1 ? 'Besok' : DAY_NAMES[d.getDay()]}</Text>
              <Text style={{ fontSize: 18, fontWeight: '800', color: active ? '#fff' : colors.text }}>{d.getDate()}</Text>
            </Pressable>); })}
        </ScrollView>
        {timeOptions.length === 0 ? <Text style={font.tiny}>Tidak ada jam tersisa hari ini (minimal 2 jam ke depan). Pilih tanggal lain.</Text> : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            {timeOptions.map((t) => <Chip key={t.getTime()} label={t.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} active={Math.abs(t.getTime() - departAt.getTime()) < 60000} onPress={() => setDepartAt(t)} />)}
          </ScrollView>
        )}
        <Badge text={`Berangkat ${formatSchedule(departAt.toISOString())}`} />
        {daily && (
          <>
            <Row between>
              <View style={{ flex: 1, minWidth: 0, paddingRight: 8 }}><Text style={{ fontWeight: '800', color: colors.text }}>Jumlah hari</Text><Text style={font.tiny}>12 jam per hari, lebih dari itu dihitung overtime per jam{nights > 0 ? ` · ${nights} malam menginap` : ''}</Text></View>
              <Stepper value={days} onChange={setDays} min={1} max={30} />
            </Row>
            <Text style={font.label}>Tanggal kembali (opsional)</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              <Pressable onPress={() => setReturnDay(null)} style={[s.day, !returnDay && { backgroundColor: colors.primary, borderColor: colors.primary }]}><Text style={{ fontSize: 12, fontWeight: '700', color: !returnDay ? '#fff' : colors.textMuted }}>Belum</Text><Text style={{ fontSize: 16, fontWeight: '800', color: !returnDay ? '#fff' : colors.text }}>pasti</Text></Pressable>
              {returnOptions.map((d) => { const active = returnDay?.getTime() === d.getTime(); return (
                <Pressable key={d.getTime()} onPress={() => setReturnDay(d)} style={[s.day, active && { backgroundColor: colors.primary, borderColor: colors.primary }]}>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: active ? '#fff' : colors.textMuted }}>{DAY_NAMES[d.getDay()]}</Text>
                  <Text style={{ fontSize: 18, fontWeight: '800', color: active ? '#fff' : colors.text }}>{d.getDate()}</Text>
                </Pressable>); })}
            </ScrollView>
          </>
        )}
      </View></Entrance>

      <Entrance index={3}><View style={s.group}>
        <Row between>
          <View><Text style={{ fontWeight: '800', color: colors.text }}>Jumlah penumpang</Text><Text style={font.tiny}>Termasuk anak-anak, maks. 16 orang</Text></View>
          <Stepper value={pax} onChange={setPax} min={1} max={16} />
        </Row>
        <Text style={font.label}>Bagasi</Text>
        <Row gap={8} style={{ flexWrap: 'wrap' }}>{LUGGAGE.map(([k, l]) => <Chip key={k} label={l} active={luggage === k} onPress={() => setLuggage(k)} />)}</Row>
        <Text style={font.label}>Preferensi mobil</Text>
        <Row gap={8} style={{ flexWrap: 'wrap' }}>{VEHICLE_PREF.map(([k, l]) => <Chip key={l} label={l} active={vehiclePref === k} onPress={() => setVehiclePref(k)} />)}</Row>
      </View></Entrance>

      <Entrance index={4}><View style={s.group}>
        <Text style={font.label}>Akomodasi sopir saat menginap</Text>
        <Text style={font.tiny}>Berlaku bila perjalanan lebih dari 1 hari atau sopir harus bermalam di kota tujuan.</Text>
        {([
          ['customer', 'Ditanggung pelanggan', 'Makan & penginapan sopir disediakan Anda selama perjalanan.', 'bed-outline'],
          ['self', 'Mandiri', 'Sopir mengurus sendiri; kompensasi ±Rp150.000/malam masuk ke penawaran mitra.', 'wallet-outline'],
        ] as [TravelAccommodation, string, string, React.ComponentProps<typeof Ionicons>['name']][]).map(([k, title, sub, icon]) => {
          const active = accommodation === k;
          return (
            <PressableScale key={k} onPress={() => setAccommodation(k)} scaleTo={0.985} style={[s.option, active && { borderColor: colors.primary, backgroundColor: colors.tint }]}>
              <Row gap={10}>
                <Ionicons name={icon} size={20} color={active ? colors.primary : colors.textMuted} />
                <View style={{ flex: 1 }}><Text style={{ fontWeight: '800', color: colors.text }}>{title}</Text><Text style={font.tiny}>{sub}</Text></View>
                <Ionicons name={active ? 'radio-button-on' : 'radio-button-off'} size={18} color={active ? colors.primary : colors.textMuted} />
              </Row>
            </PressableScale>
          );
        })}
        <Text style={font.label}>BBM, tol & parkir</Text>
        <Row gap={8} style={{ flexWrap: 'wrap' }}>
          <Chip label="Ditanggung pelanggan (umum)" active={fuel === 'customer'} onPress={() => setFuel('customer')} />
          <Chip label="Termasuk harga" active={fuel === 'partner'} onPress={() => setFuel('partner')} />
        </Row>
        <Text style={font.tiny}>{fuel === 'customer' ? 'Anda membayar BBM/tol/parkir langsung selama perjalanan (praktik umum rental sopir).' : 'Mitra memasukkan estimasi BBM/tol/parkir ke harga penawaran (paket all-in).'}</Text>
      </View></Entrance>

      <Entrance index={5}><View style={s.group}>
        <Input label="Catatan untuk mitra" placeholder={daily ? 'Rencana rute, jam mulai tiap hari, kebutuhan khusus' : 'Titik kumpul, jumlah koper, kursi bayi, dsb.'} value={notes} onChangeText={setNotes} multiline />
        <Input label="Anggaran (opsional)" placeholder="Contoh 1500000" keyboardType="number-pad" icon="cash-outline" value={budget} onChangeText={(v) => setBudget(v.replace(/\D/g, ''))} right={budget ? <Text style={font.tiny}>{rupiah(Number(budget))}</Text> : undefined} />
        <Text style={font.label}>Pembayaran</Text>
        <Row gap={8}>
          <Chip label={`AntarPay · ${rupiah(wallet?.balance ?? 0)}`} active={method === 'wallet'} onPress={() => setMethod('wallet')} />
          <Chip label="Tunai ke sopir" active={method === 'cash'} onPress={() => setMethod('cash')} />
        </Row>
        <Text style={font.tiny}>{method === 'wallet' ? 'Saldo dipotong saat Anda menerima penawaran; dana diteruskan ke mitra setelah perjalanan selesai.' : 'Bayar langsung ke sopir saat berangkat. Mitra dapat menolak permintaan tunai untuk perjalanan panjang.'}</Text>
        <Button title="Kirim permintaan" size="lg" icon="paper-plane-outline" loading={busy} onPress={submit} />
        <Text style={font.tiny}>Permintaan berlaku hingga jadwal berangkat, maksimal 3 permintaan aktif. Anda bebas memilih penawaran atau membatalkan sebelum menerima.</Text>
      </View></Entrance>

      <View style={{ gap: 8 }}>
        <Text style={font.label}>Mitra {daily ? 'sopir harian' : 'carter privat'} tersedia</Text>
        {partners === null ? <Skeleton height={100} radius={radius.lg} /> : partners.length === 0 ? <Text style={font.small}>Belum ada mitra di sekitar. Kirim permintaan terbuka, mitra yang cocok akan menawar.</Text> : partners.map((p, i) => (
          <Entrance key={p.id} index={Math.min(i, 5)}><PartnerCard p={p} daily={daily} active={partner?.id === p.id} onPick={() => setPartner(partner?.id === p.id ? null : p)} /></Entrance>
        ))}
      </View>

      {requests.length > 0 && (
        <View style={{ gap: 8 }}>
          <Text style={font.label}>Permintaan saya</Text>
          {requests.slice(0, 8).map((r) => (
            <PressableScale key={r.id} onPress={() => router.push(`/travel/request/${r.id}` as never)} scaleTo={0.985} haptic={false} style={s.trip}>
              <Row gap={12}>
                <IconCircle name={r.kind === 'daily' ? 'calendar-outline' : 'car-outline'} size={44} bg={colors.tint} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontWeight: '800', color: colors.text }} numberOfLines={1}>{travelKindLabel[r.kind]} · {r.dropoff_address ?? r.pickup_address}</Text>
                  <Text style={font.tiny} numberOfLines={1}>{formatSchedule(r.depart_at)} · {r.days} hari · {r.pax} pax · {r.code}{r.price > 0 ? ` · ${rupiah(r.price)}` : ''}</Text>
                  <Badge text={travelRequestStatusLabel[r.status]} color={requestStatusColor(r.status)} style={{ marginTop: 4 }} />
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
              </Row>
            </PressableScale>
          ))}
        </View>
      )}
    </View>
  );
}

function PartnerCard({ p, daily, active, onPick }: { p: TravelPartnerCard; daily: boolean; active: boolean; onPick: () => void }) {
  const photo = p.photo_url ?? p.avatar_url;
  return (
    <Card solid style={[{ gap: 10, padding: 12 }, active && { borderColor: colors.primary, borderWidth: 1.5 }]}>
      <Row gap={12} style={{ alignItems: 'flex-start' }}>
        {photo ? <Avatar name={p.company_name ?? p.name} url={photo} size={64} /> : <View style={s.thumb}><ServiceIllustration kind="car" size={40} /></View>}
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text style={[font.body, { fontWeight: '800' }]} numberOfLines={1}>{p.company_name ?? p.name}</Text>
          <Row gap={4}><Ionicons name="car-outline" size={13} color={colors.textMuted} /><Text style={font.tiny} numberOfLines={1}>{p.partner_type === 'agency' ? 'Agen travel' : 'Mobil pribadi'} · {p.vehicle_model}{p.vehicle_year ? ` ${p.vehicle_year}` : ''} · {p.seats} kursi</Text></Row>
          <Row gap={4}><Ionicons name="location-outline" size={13} color={colors.textMuted} /><Text style={font.tiny} numberOfLines={1}>{p.base_city ?? 'Kota mana saja'}</Text></Row>
          <Row gap={4}><Ionicons name="star" size={13} color={colors.accent} /><Text style={font.tiny}>{Number(p.rating_avg).toFixed(1)} ({p.rating_count}) · {p.total_trips} trip</Text></Row>
        </View>
        {daily && p.daily_rate ? <View style={{ alignItems: 'flex-end' }}><Text style={{ fontWeight: '800', color: colors.primary, fontSize: 15 }}>{rupiah(p.daily_rate)}</Text><Text style={font.tiny}>/hari (12 jam)</Text></View> : null}
      </Row>
      <Row gap={6} style={{ flexWrap: 'wrap' }}>
        {!!p.is_electric && <Badge text="Listrik" color={colors.success} />}
        {p.accommodation?.includes('customer') && <Badge text="Akomodasi ditanggung pelanggan" color={colors.info} />}
        {p.accommodation?.includes('self') && <Badge text={`Mandiri ${rupiah(p.accommodation_fee || 150000)}/malam`} color={colors.accent} />}
        {!!p.fuel_included && <Badge text="BBM termasuk" color={colors.primary} />}
        {daily && p.overtime_rate ? <Badge text={`Overtime ${rupiah(p.overtime_rate)}/jam`} color={colors.textMuted} /> : null}
      </Row>
      {p.bio ? <Text style={font.tiny} numberOfLines={2}>{p.bio}</Text> : null}
      <Button size="sm" variant={active ? 'primary' : 'secondary'} icon={active ? 'checkmark' : 'send-outline'} title={active ? 'Dipilih — isi form di atas' : 'Ajukan ke mitra ini'} onPress={onPick} />
    </Card>
  );
}

const s = StyleSheet.create({
  modeRow: { flexDirection: 'row', gap: 8 },
  modeChip: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 10, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, backgroundColor: '#fff', ...shadow.soft },
  hero: { backgroundColor: '#fff', borderRadius: radius.lg, padding: 12, borderWidth: 1, borderColor: colors.border, ...shadow.soft },
  heroArt: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center' },
  group: { gap: 10, backgroundColor: '#fff', borderRadius: radius.lg, padding: 14, borderWidth: 1, borderColor: colors.border, ...shadow.soft },
  day: { width: 62, paddingVertical: 8, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: colors.border, backgroundColor: '#fff' },
  trip: { padding: 12, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: '#fff', ...shadow.soft },
  thumb: { width: 64, height: 64, borderRadius: 16, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center' },
  rowArrow: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.tint },
  option: { padding: 12, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, backgroundColor: '#fff' },
});
