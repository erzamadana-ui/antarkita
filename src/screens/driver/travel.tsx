// Dasbor Mitra AntarTravel — buat jadwal, lihat manifest penumpang & alamat jemput, berangkat/tiba, pendapatan,
// serta titipan barang AntarSend antar kota (Tahap 9: travel_send_available / accept / pickup / complete)
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Linking, Alert, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import { Screen, Card, Row, Badge, Button, Chip, Input, Avatar, Empty, toast } from '@/components/ui';
import { Entrance, PressableScale, ProgressBar } from '@/components/motion';
import { ServiceIllustration } from '@/components/ServiceArt';
import { CallButton } from '@/components/call/IncomingCall';
import { useCities, usePartnerTrips } from '@/hooks/useTravel';
import { useAppSettings } from '@/hooks/useAppSettings';
import { useAuth } from '@/store/auth';
import { supabase, rpc, realtimeChannel } from '@/lib/supabase';
import { colors, font, radius, shadow, motion } from '@/lib/theme';
import { rupiah, formatSchedule, cityName, tripStatusLabel, travelStatusLabel, travelKindLabel, travelRequestStatusLabel, accommodationLabel } from '@/lib/format';
import type { TravelPartner, TravelRoute, TravelManifestRow, TravelTrip, TravelOpenRequest, TravelSendOrder, Order } from '@/lib/types';

const DAY_NAMES = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
const TIMES = ['05:00', '06:00', '07:00', '08:00', '09:00', '10:00', '13:00', '15:00', '17:00', '19:00', '21:00', '23:00'];

export default function TravelPartnerHome() {
  const router = useRouter();
  const { session, wallet, travelPartner } = useAuth();
  const uid = session?.user.id;
  const [tab, setTab] = useState<'shared' | 'requests' | 'send'>('shared');
  const cities = useCities();
  const [me, setMe] = useState<TravelPartner | null | undefined>(undefined);
  const [routes, setRoutes] = useState<TravelRoute[]>([]);
  const { trips, reload } = usePartnerTrips(uid);
  const [creating, setCreating] = useState(false);
  const [routeId, setRouteId] = useState<string | null>(null);
  const [day, setDay] = useState(1); const [time, setTime] = useState('08:00');
  const [allowPrivate, setAllowPrivate] = useState(true);
  const [notes, setNotes] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [manifest, setManifest] = useState<Record<string, TravelManifestRow[]>>({});

  useEffect(() => { if (uid) supabase.from('travel_partners').select('*').eq('id', uid).maybeSingle().then(({ data }) => setMe((data as TravelPartner) ?? travelPartner ?? null)); }, [uid]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { supabase.from('travel_routes').select('*').eq('active', true).then(({ data }) => setRoutes((data as TravelRoute[]) ?? [])); }, []);
  const loadManifest = async (tripId: string) => { const m = await rpc<TravelManifestRow[]>('travel_trip_manifest', { p_trip: tripId }); setManifest((p) => ({ ...p, [tripId]: m })); };
  useEffect(() => { if (open) loadManifest(open); }, [open, trips]); // eslint-disable-line react-hooks/exhaustive-deps

  const days = useMemo(() => Array.from({ length: 10 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() + i); d.setHours(0, 0, 0, 0); return d; }), []);
  const create = async () => {
    if (!routeId) return toast.error('Pilih rute');
    const d = new Date(days[day]); const [h, m] = time.split(':').map(Number); d.setHours(h, m, 0, 0);
    setCreating(true);
    try { await rpc('travel_trip_create', { p: { route_id: routeId, depart_at: d.toISOString(), allow_private: allowPrivate, notes: notes || null } }); toast.success('Jadwal dibuat'); setNotes(''); reload(); }
    catch (e) { toast.error((e as Error).message); } finally { setCreating(false); }
  };
  const setStatus = (t: TravelTrip, st: 'departed' | 'arrived' | 'cancelled') => {
    const msg = st === 'departed' ? 'Tandai berangkat? Pastikan semua penumpang sudah dijemput.' : st === 'arrived' ? 'Tandai tiba? Pendapatan akan masuk ke AntarPay.' : 'Batalkan jadwal? Penumpang akan di-refund & diberi tahu.';
    const doIt = async () => { try { await rpc('travel_trip_set_status', { p_trip: t.id, p_status: st, p_note: st === 'cancelled' ? 'Dibatalkan mitra travel' : null }); toast.success('Status diperbarui'); reload(); } catch (e) { toast.error((e as Error).message); } };
    if (Platform.OS === 'web') { if (confirm(msg)) doIt(); return; }
    Alert.alert('Konfirmasi', msg, [{ text: 'Batal' }, { text: 'Ya', onPress: doIt }]);
  };

  if (me === undefined) return <Screen title="Mitra Travel" back><Text style={font.small}>Memuat…</Text></Screen>;
  if (!me) return <Screen title="Mitra Travel" back><Empty icon="bus-outline" title="Belum terdaftar" subtitle="Daftar sebagai mitra AntarTravel dengan mobil kapasitas besar." action={<Button title="Daftar Mitra Travel" onPress={() => router.push('/account/become-travel' as never)} />} /></Screen>;
  if (me.status !== 'approved') return <Screen title="Mitra Travel" back><Empty icon="hourglass-outline" title={me.status === 'pending' ? 'Menunggu verifikasi admin' : 'Akun mitra ' + me.status} subtitle={me.status_reason ?? 'Data Anda sedang diperiksa.'} action={<Button title="Lihat / ubah data" variant="secondary" onPress={() => router.push('/account/become-travel' as never)} />} /></Screen>;

  const upcoming = trips.filter((t) => ['open', 'confirmed', 'full', 'departed'].includes(t.status));
  const past = trips.filter((t) => ['arrived', 'cancelled'].includes(t.status));
  const earnings = past.filter((t) => t.status === 'arrived').length;

  return (
    <Screen title="Mitra AntarTravel" subtitle="Kursi bersama · carter · sopir · titipan" band={colors.travel} back maxWidth={720}>
      <View style={{ gap: 14 }}>
        {/* Kartu profil armada (putih) */}
        <Entrance index={0}><Card>
          <Row gap={12}>
            <View style={s.heroArt}><ServiceIllustration kind="travel" size={44} /></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={font.label}>{me.company_name ?? 'Mitra travel'}</Text>
              <Text style={[font.h3, { fontSize: 16 }]} numberOfLines={1}>{me.vehicle_model} · {me.vehicle_plate}</Text>
              <Row gap={4}>
                <Text style={font.tiny}>{me.seats} kursi{me.is_electric ? ' · listrik' : ''} · </Text>
                <Ionicons name="star" size={11} color={colors.accent} />
                <Text style={font.tiny}>{Number(me.rating_avg).toFixed(1)} · {me.total_trips} trip selesai</Text>
              </Row>
            </View>
          </Row>
          <Row between style={s.balance}>
            <Row gap={8}><Ionicons name="wallet-outline" size={18} color={colors.primary} /><Text style={font.small}>Saldo AntarPay</Text></Row>
            <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 17 }}>{rupiah(wallet?.balance ?? 0)}</Text>
          </Row>
        </Card></Entrance>

        {/* Chip pil mode */}
        <Row gap={8} style={{ flexWrap: 'wrap' }}>
          <Chip label="Kursi bersama" active={tab === 'shared'} onPress={() => setTab('shared')} />
          <Chip label="Carter & sopir harian" active={tab === 'requests'} onPress={() => setTab('requests')} />
          <Chip label="Titipan barang" active={tab === 'send'} onPress={() => setTab('send')} />
        </Row>

        {tab === 'send' ? <SendParcelTab uid={uid} /> : tab === 'requests' ? <RequestsTab me={travelPartner ?? me} /> : (
          <>
        <Entrance index={1}><Card style={{ gap: 10 }}>
          <Text style={font.label}>Buat jadwal keberangkatan</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {routes.map((r) => <Chip key={r.id} label={`${cityName(cities, r.from_city)} → ${cityName(cities, r.to_city)} · ${rupiah(r.seat_price)}`} active={routeId === r.id} onPress={() => setRouteId(r.id)} />)}
          </ScrollView>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {days.map((d, i) => <PressableScale key={i} onPress={() => setDay(i)} scaleTo={0.94} style={[s.day, day === i && { backgroundColor: colors.primary, borderColor: colors.primary }]}><Text style={{ fontSize: 12, fontWeight: '700', color: day === i ? 'rgba(255,255,255,0.85)' : colors.textMuted }}>{i === 0 ? 'Hari ini' : i === 1 ? 'Besok' : DAY_NAMES[d.getDay()]}</Text><Text style={{ fontSize: 18, fontWeight: '800', color: day === i ? '#fff' : colors.text }}>{d.getDate()}</Text></PressableScale>)}
          </ScrollView>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>{TIMES.map((t) => <Chip key={t} label={t} active={time === t} onPress={() => setTime(t)} />)}</ScrollView>
          <Row gap={8}><Chip label={allowPrivate ? 'Terima carter private' : 'Tanpa carter private'} active={allowPrivate} onPress={() => setAllowPrivate(!allowPrivate)} /></Row>
          <Input placeholder="Catatan (mis. berangkat dari pool, bagasi maks. 1 koper)" value={notes} onChangeText={setNotes} />
          <Button title="Buat jadwal" icon="add-circle-outline" loading={creating} onPress={create} />
        </Card></Entrance>

        <Text style={font.label}>Jadwal aktif ({upcoming.length})</Text>
        {upcoming.length === 0 && <Text style={font.small}>Belum ada jadwal. Buat jadwal di atas agar tampil di pencarian pelanggan.</Text>}
        {upcoming.map((t) => (
          <Animated.View key={t.id} layout={LinearTransition.springify().stiffness(300).damping(22)} style={s.trip}>
            <PressableScale onPress={() => setOpen(open === t.id ? null : t.id)} scaleTo={0.99} haptic={false}>
              <Row gap={12}>
                <View style={s.thumb}><Ionicons name="bus-outline" size={26} color={colors.primary} /></View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[font.h3, { fontSize: 16 }]} numberOfLines={1}>{cityName(cities, t.route.from_city)} → {cityName(cities, t.route.to_city)}</Text>
                  <Row gap={4}><Ionicons name="time-outline" size={12} color={colors.textMuted} /><Text style={font.tiny}>{formatSchedule(t.depart_at)}</Text></Row>
                  <Row gap={6} style={{ marginTop: 6, flexWrap: 'wrap' }}>
                    <Badge text={tripStatusLabel[t.status]} color={t.status === 'confirmed' || t.status === 'full' ? colors.success : t.status === 'departed' ? colors.info : colors.warning} />
                    {!!t.is_private && <Badge text="Private" color={colors.accent} />}
                  </Row>
                </View>
                <View style={s.rowArrow}><Ionicons name={open === t.id ? 'chevron-up' : 'chevron-down'} size={16} color={colors.primary} /></View>
              </Row>
              <Row gap={10} style={{ marginTop: 10 }}>
                <View style={{ flex: 1 }}><ProgressBar progress={t.seats_total ? t.seats_booked / t.seats_total : 0} color={colors.primary} height={6} /></View>
                <Text style={[font.tiny, { fontWeight: '700', color: colors.primary }]}>{t.seats_booked}/{t.seats_total} kursi</Text>
              </Row>
              {t.status === 'open' && t.seats_booked < t.min_pax && <Text style={[font.tiny, { marginTop: 4 }]}>Butuh {t.min_pax - t.seats_booked} penumpang lagi agar pasti berangkat</Text>}
            </PressableScale>
            {open === t.id && (
              <Animated.View entering={FadeInDown.duration(motion.base)} style={{ gap: 8, marginTop: 10 }}>
                <Text style={font.label}>Manifest penumpang & alamat jemput</Text>
                {(manifest[t.id] ?? []).length === 0 && <Text style={font.tiny}>Belum ada penumpang.</Text>}
                {(manifest[t.id] ?? []).map((b) => (
                  <View key={b.id} style={s.pax}>
                    <Row gap={10} style={{ alignItems: 'flex-start' }}>
                      <Avatar name={b.customer.name} url={b.customer.avatar_url} size={36} />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Row between><Text style={{ fontWeight: '800', color: colors.text, flex: 1 }} numberOfLines={1}>{b.customer.name} · {b.pax} pax{b.is_private ? ' (private)' : ''}</Text><Badge text={travelStatusLabel[b.status]} /></Row>
                        <Text style={font.tiny}>{b.code} · {b.payment_method === 'cash' ? `Tunai ${rupiah(b.price)} (tagih saat jemput)` : 'Dibayar AntarPay'}{b.passengers?.length ? ` · ${b.passengers.map((x) => x.name).join(', ')}` : ''}</Text>
                        <Row gap={4} style={{ marginTop: 2 }}><Ionicons name="location-outline" size={12} color={colors.primary} /><Text style={[font.small, { flex: 1 }]}>{b.pickup_address}</Text></Row>
                        {!!b.dropoff_address && <Row gap={4}><Ionicons name="flag-outline" size={12} color={colors.textMuted} /><Text style={[font.tiny, { flex: 1 }]}>{b.dropoff_address}</Text></Row>}
                      </View>
                    </Row>
                    <Row gap={6} style={{ marginTop: 8 }}>
                      {!!b.pickup_lat && <Button size="sm" variant="outline" icon="navigate" title="Navigasi" onPress={() => Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${b.pickup_lat},${b.pickup_lng}`)} />}
                      <CallButton peer={{ id: b.customer.id, name: b.customer.name, role: 'customer' }} size={36} color={colors.primary} label="Telepon" />
                    </Row>
                  </View>
                ))}
                <Row gap={8} style={{ flexWrap: 'wrap' }}>
                  {t.status !== 'departed' && <Button size="sm" title="Berangkat" icon="play" onPress={() => setStatus(t, 'departed')} />}
                  {t.status === 'departed' && <Button size="sm" title="Tiba di tujuan" icon="flag" onPress={() => setStatus(t, 'arrived')} />}
                  {t.status !== 'departed' && <Button size="sm" title="Batalkan jadwal" variant="outline" color={colors.danger} onPress={() => setStatus(t, 'cancelled')} />}
                </Row>
              </Animated.View>
            )}
          </Animated.View>
        ))}
        {past.length > 0 && <Text style={font.label}>Riwayat ({past.length}) · {earnings} trip selesai</Text>}
        {past.slice(0, 10).map((t) => (
          <View key={t.id} style={[s.trip, { opacity: 0.85 }]}>
            <Row between><Text style={[font.small, { flex: 1 }]} numberOfLines={1}>{cityName(cities, t.route.from_city)} → {cityName(cities, t.route.to_city)} · {formatSchedule(t.depart_at)}</Text><Badge text={tripStatusLabel[t.status]} color={t.status === 'arrived' ? colors.success : colors.textMuted} /></Row>
          </View>
        ))}
          </>
        )}
      </View>
    </Screen>
  );
}

// ---------- Permintaan carter privat & sopir harian (penawaran mitra) ----------
const reqStatusColor = (st: TravelOpenRequest['status']) => st === 'completed' ? colors.success : st === 'cancelled' || st === 'expired' ? colors.danger : st === 'ongoing' ? colors.info : st === 'offered' ? colors.accent : colors.primary;
const REQ_PROGRESS: Partial<Record<TravelOpenRequest['status'], number>> = { open: 0.15, offered: 0.35, accepted: 0.55, paid: 0.7, ongoing: 0.85, completed: 1 };
const num = (v: string) => Number(v.replace(/\D/g, '')) || 0;

function RequestsTab({ me }: { me: TravelPartner | null }) {
  const [rows, setRows] = useState<TravelOpenRequest[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const load = async () => { try { setRows(await rpc<TravelOpenRequest[]>('travel_partner_open_requests')); } catch (e) { setRows([]); toast.error((e as Error).message); } };
  useEffect(() => {
    load();
    const ch = realtimeChannel('tp-open-requests').on('postgres_changes', { event: '*', schema: 'public', table: 'travel_requests' }, load).on('postgres_changes', { event: '*', schema: 'public', table: 'travel_offers' }, load).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);
  if (rows === null) return <Text style={font.small}>Memuat permintaan…</Text>;
  const mine = rows.filter((r) => ['accepted', 'paid', 'ongoing'].includes(r.status));
  const openReqs = rows.filter((r) => ['open', 'offered'].includes(r.status));
  const done = rows.filter((r) => ['completed', 'cancelled', 'expired'].includes(r.status));
  // fungsi render biasa (bukan komponen) agar state form penawaran tidak hilang saat data di-refresh
  const section = (title: string, list: TravelOpenRequest[], hint?: string) => (
    <View style={{ gap: 8 }}>
      <Text style={font.label}>{title} ({list.length})</Text>
      {list.length === 0 && hint && <Text style={font.small}>{hint}</Text>}
      {list.map((r) => <RequestCard key={r.id} r={r} me={me} open={open === r.id} onToggle={() => setOpen(open === r.id ? null : r.id)} onDone={load} />)}
    </View>
  );
  return (
    <View style={{ gap: 14 }}>
      {!me?.offers_charter && !me?.offers_daily && <Card><Text style={font.small}>Anda belum menandai layanan carter privat / sopir harian di data mitra. Perbarui di menu Akun → Mitra AntarTravel agar permintaan yang cocok tampil di sini.</Text></Card>}
      {section('Perjalanan Anda', mine, 'Belum ada permintaan yang diterima pelanggan.')}
      {section('Permintaan terbuka', openReqs, 'Belum ada permintaan carter/harian di sekitar Anda. Permintaan baru muncul otomatis.')}
      {done.length > 0 && section('Riwayat', done.slice(0, 10))}
    </View>
  );
}

function RequestCard({ r, me, open, onToggle, onDone }: { r: TravelOpenRequest; me: TravelPartner | null; open: boolean; onToggle: () => void; onDone: () => void }) {
  const nights = Math.max(0, r.days - 1);
  const selfAcc = r.accommodation === 'self';
  const [rate, setRate] = useState(String(me?.daily_rate ?? ''));
  const [accFee, setAccFee] = useState(String(me?.accommodation_fee || 150000));
  const [fuelEst, setFuelEst] = useState('');
  const [overtime, setOvertime] = useState(String(me?.overtime_rate ?? ''));
  const [price, setPrice] = useState('');
  const [manual, setManual] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const calc = num(rate) * r.days + (selfAcc ? num(accFee) * nights : 0) + (r.fuel === 'partner' ? num(fuelEst) : 0);
  const total = manual ? num(price) : calc;
  const active = ['accepted', 'paid', 'ongoing'].includes(r.status);
  const canOffer = ['open', 'offered'].includes(r.status) && !r.my_offer;
  const progress = REQ_PROGRESS[r.status];

  const send = async () => {
    if (total <= 0) return toast.error('Isi harga penawaran');
    setBusy(true);
    try {
      const breakdown = { daily_rate: num(rate) || undefined, days: r.days, accommodation_nights: selfAcc ? nights : 0, accommodation_fee: selfAcc ? num(accFee) : 0, fuel_est: r.fuel === 'partner' ? num(fuelEst) : 0, overtime_rate: num(overtime) || undefined };
      await rpc('travel_offer_create', { p_request: r.id, p_price: total, p_breakdown: breakdown, p_message: message || null });
      toast.success('Penawaran terkirim'); onDone();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  const setSt = (st: 'ongoing' | 'completed') => {
    const msg = st === 'ongoing' ? 'Mulai perjalanan? Pastikan penumpang sudah dijemput.' : 'Tandai selesai? Pendapatan akan diteruskan ke AntarPay Anda.';
    const doIt = async () => { try { await rpc('travel_request_set_status', { p_request: r.id, p_status: st, p_note: null }); toast.success('Status diperbarui'); onDone(); } catch (e) { toast.error((e as Error).message); } };
    if (Platform.OS === 'web') { if (confirm(msg)) doIt(); return; }
    Alert.alert('Konfirmasi', msg, [{ text: 'Batal' }, { text: 'Ya', onPress: doIt }]);
  };

  return (
    <Animated.View layout={LinearTransition.springify().stiffness(300).damping(22)} style={[s.trip, active && { borderColor: colors.primary }]}>
      <PressableScale onPress={onToggle} scaleTo={0.99} haptic={false}>
        {/* Baris ala "Group Tour": thumbnail + judul + lokasi + progres */}
        <Row gap={12} style={{ alignItems: 'flex-start' }}>
          <View style={s.thumb}><Ionicons name={r.kind === 'daily' ? 'person-outline' : 'car-outline'} size={26} color={colors.primary} /></View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[font.h3, { fontSize: 16 }]} numberOfLines={1}>{travelKindLabel[r.kind]} · {r.customer_name}</Text>
            <Row gap={4}><Ionicons name="location-outline" size={12} color={colors.textMuted} /><Text style={[font.tiny, { flex: 1 }]} numberOfLines={1}>{r.pickup_address} → {r.dropoff_address ?? (r.kind === 'daily' ? 'keliling / rute bebas' : '—')}</Text></Row>
            <Text style={font.tiny}>{formatSchedule(r.depart_at)}{r.return_at ? ` · kembali ${formatSchedule(r.return_at)}` : ''} · {r.days} hari · {r.pax} pax</Text>
          </View>
          <View style={s.rowArrow}><Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={colors.primary} /></View>
        </Row>
        {progress !== undefined && (
          <Row gap={10} style={{ marginTop: 10 }}>
            <View style={{ flex: 1 }}><ProgressBar progress={progress} color={reqStatusColor(r.status)} height={6} /></View>
            <Text style={[font.tiny, { fontWeight: '700', color: reqStatusColor(r.status) }]}>{travelRequestStatusLabel[r.status]}</Text>
          </Row>
        )}
        <Row gap={6} style={{ marginTop: 8, flexWrap: 'wrap' }}>
          {progress === undefined && <Badge text={travelRequestStatusLabel[r.status]} color={reqStatusColor(r.status)} />}
          <Badge text={selfAcc ? 'Akomodasi mandiri' : 'Akomodasi ditanggung pelanggan'} color={selfAcc ? colors.accent : colors.info} />
          <Badge text={r.fuel === 'partner' ? 'BBM termasuk harga' : 'BBM ditanggung pelanggan'} color={colors.textSecondary} />
          {r.budget ? <Badge text={`Anggaran ${rupiah(r.budget)}`} color={colors.textMuted} /> : null}
          <Badge text={`${r.offers_count} penawaran`} />
          {!!r.my_offer && <Badge text={`Tawaran Anda ${rupiah(r.my_offer.price)}`} color={r.my_offer.status === 'accepted' ? colors.success : r.my_offer.status === 'rejected' ? colors.danger : colors.accent} />}
        </Row>
      </PressableScale>
      {open && (
        <Animated.View entering={FadeInDown.duration(motion.base)} style={{ gap: 10, marginTop: 10 }}>
          {r.luggage || r.vehicle_pref || r.notes ? <Text style={font.tiny}>{[r.luggage ? `Bagasi ${r.luggage}` : null, r.vehicle_pref ? `Mobil ${r.vehicle_pref}` : null, r.notes ? `Catatan: ${r.notes}` : null].filter(Boolean).join(' · ')}</Text> : null}
          <Text style={font.tiny}>{accommodationLabel[r.accommodation]}{selfAcc && nights > 0 ? ` — masukkan kompensasi ${nights} malam ke harga.` : ''}{r.fuel === 'customer' ? ' BBM/tol/parkir dibayar pelanggan langsung, jangan masukkan ke harga.' : ' Masukkan estimasi BBM/tol/parkir ke harga (all-in).'}</Text>

          {active && (
            <Row gap={8} style={{ flexWrap: 'wrap' }}>
              {r.status !== 'ongoing' && <Button size="sm" title="Mulai perjalanan" icon="play" onPress={() => setSt('ongoing')} />}
              {r.status === 'ongoing' && <Button size="sm" title="Selesai" icon="flag" onPress={() => setSt('completed')} />}
              {!!r.my_offer && <Text style={[font.tiny, { flex: 1 }]}>Harga disepakati {rupiah(r.my_offer.price)}{r.status === 'accepted' ? ' · tagih tunai saat berangkat' : ' · dibayar AntarPay'}</Text>}
            </Row>
          )}

          {canOffer && (
            <View style={{ gap: 8 }}>
              <Text style={font.label}>Kalkulator penawaran</Text>
              <Row gap={8}>
                <Input label="Harga/hari (12 jam)" keyboardType="number-pad" value={rate} onChangeText={(v) => setRate(v.replace(/\D/g, ''))} containerStyle={{ flex: 1 }} />
                <Input label="Overtime/jam" keyboardType="number-pad" value={overtime} onChangeText={(v) => setOvertime(v.replace(/\D/g, ''))} containerStyle={{ flex: 1 }} />
              </Row>
              {selfAcc && nights > 0 && <Input label={`Akomodasi mandiri per malam (× ${nights} malam)`} keyboardType="number-pad" value={accFee} onChangeText={(v) => setAccFee(v.replace(/\D/g, ''))} />}
              {r.fuel === 'partner' && <Input label="Estimasi BBM/tol/parkir" keyboardType="number-pad" value={fuelEst} onChangeText={(v) => setFuelEst(v.replace(/\D/g, ''))} />}
              <View style={s.calc}>
                <Row between><Text style={font.tiny}>{rupiah(num(rate))} × {r.days} hari</Text><Text style={font.tiny}>{rupiah(num(rate) * r.days)}</Text></Row>
                {selfAcc && nights > 0 && <Row between><Text style={font.tiny}>Akomodasi {rupiah(num(accFee))} × {nights} malam</Text><Text style={font.tiny}>{rupiah(num(accFee) * nights)}</Text></Row>}
                {r.fuel === 'partner' && <Row between><Text style={font.tiny}>Estimasi BBM/tol/parkir</Text><Text style={font.tiny}>{rupiah(num(fuelEst))}</Text></Row>}
                <Row between><Text style={{ fontWeight: '800', color: colors.text }}>Total penawaran</Text><Text style={{ fontWeight: '800', color: colors.primary, fontSize: 16 }}>{rupiah(total)}</Text></Row>
              </View>
              <Row gap={8}><Chip label="Pakai kalkulator" active={!manual} onPress={() => setManual(false)} /><Chip label="Harga total manual" active={manual} onPress={() => setManual(true)} /></Row>
              {manual && <Input label="Harga total" keyboardType="number-pad" value={price} onChangeText={(v) => setPrice(v.replace(/\D/g, ''))} />}
              <Input placeholder="Pesan untuk pelanggan (mobil, sopir, syarat)" value={message} onChangeText={setMessage} />
              <Button title={`Kirim penawaran ${rupiah(total)}`} icon="paper-plane-outline" loading={busy} onPress={send} />
              <Text style={font.tiny}>Komisi platform dipotong dari harga setelah perjalanan selesai. Pelanggan bebas memilih penawaran.</Text>
            </View>
          )}
          {r.my_offer && !active && <Text style={font.small}>Tawaran Anda {rupiah(r.my_offer.price)} · {r.my_offer.status === 'offered' ? 'menunggu keputusan pelanggan' : r.my_offer.status}</Text>}
        </Animated.View>
      )}
    </Animated.View>
  );
}
// ---------- Titipan barang AntarSend antar kota (mitra travel membawa paket) ----------
const numId = (v: number | null | undefined) => v == null ? '-' : (Math.round(Number(v) * 10) / 10).toString().replace('.', ',');
const confirmThen = (msg: string, doIt: () => void) => {
  if (Platform.OS === 'web') { if (confirm(msg)) doIt(); return; }
  Alert.alert('Konfirmasi', msg, [{ text: 'Batal' }, { text: 'Ya', onPress: doIt }]);
};
const parcelSize = (o: Order) => { const v = o.package_details?.size_cm; const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };

function SendParcelTab({ uid }: { uid?: string | null }) {
  const cities = useCities();
  const { sendLimits } = useAppSettings();
  const [rows, setRows] = useState<TravelSendOrder[] | null>(null);
  const [mine, setMine] = useState<Order[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const lim = sendLimits.travel;

  const load = useCallback(async () => {
    try { setRows(await rpc<TravelSendOrder[]>('travel_send_available')); } catch (e) { setRows([]); toast.error((e as Error).message); }
    if (!uid) return;
    const { data } = await supabase.from('orders').select('*').eq('travel_partner_id', uid).in('status', ['accepted', 'in_progress']).order('created_at', { ascending: false });
    setMine((data as Order[]) ?? []);
  }, [uid]);
  useEffect(() => {
    load();
    const ch = realtimeChannel('tp-titipan').on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, load).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  const act = async (id: string, fn: 'travel_accept_send' | 'travel_pickup_send' | 'travel_complete_send', ok: string) => {
    setBusy(id);
    try { await rpc(fn, { p_order: id }); toast.success(ok); await load(); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  };

  return (
    <View style={{ gap: 14 }}>
      <Card style={{ gap: 6 }}>
        <Row gap={10}>
          <View style={s.thumb}><Ionicons name="cube-outline" size={24} color={colors.send} /></View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[font.h3, { fontSize: 16 }]}>Titipan barang antar kota</Text>
            <Text style={font.tiny}>Bawa paket pelanggan sekalian jalan. Batas mitra travel: maks. {numId(lim.max_kg)} kg · sisi terpanjang {numId(lim.max_cm)} cm.</Text>
          </View>
        </Row>
        <Text style={font.tiny}>Ambil titipan → jemput ke alamat pengirim → antar ke alamat penerima di kota tujuan. Pendapatan masuk ke AntarPay setelah Anda menandai titipan sampai.</Text>
      </Card>

      <Text style={font.label}>Titipan aktif Anda ({mine.length})</Text>
      {mine.length === 0 && <Text style={font.small}>Belum ada titipan yang Anda bawa.</Text>}
      {mine.map((o) => (
        <Animated.View key={o.id} layout={LinearTransition.springify().stiffness(300).damping(22)} style={[s.trip, { borderColor: colors.primary }]}>
          <Row gap={12} style={{ alignItems: 'flex-start' }}>
            <View style={s.thumb}><Ionicons name={o.status === 'in_progress' ? 'navigate-outline' : 'cube-outline'} size={24} color={colors.primary} /></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[font.h3, { fontSize: 16 }]} numberOfLines={1}>{o.city ?? '—'} → {cityName(cities, o.dest_city_id ?? '')}</Text>
              <Text style={font.tiny} numberOfLines={1}>{o.code} · {o.recipient_name ?? 'Penerima'}{o.recipient_phone ? ` · ${o.recipient_phone}` : ''}</Text>
              <Row gap={6} style={{ marginTop: 6, flexWrap: 'wrap' }}>
                <Badge text={o.status === 'in_progress' ? 'Dalam perjalanan' : 'Menunggu dijemput'} color={o.status === 'in_progress' ? colors.info : colors.warning} />
                {o.weight_kg != null && <Badge text={`${numId(o.weight_kg)} kg`} color={colors.textSecondary} />}
                {parcelSize(o) != null && <Badge text={`sisi ${numId(parcelSize(o))} cm`} color={colors.textSecondary} />}
                <Badge text={o.payment_method === 'cash' ? `Tunai ${rupiah(o.total)}` : 'Dibayar AntarPay'} color={o.payment_method === 'cash' ? colors.accent : colors.success} />
              </Row>
            </View>
          </Row>
          <View style={{ gap: 6, marginTop: 10 }}>
            <Row gap={8}><Ionicons name="location-outline" size={13} color={colors.primary} /><Text style={[font.small, { flex: 1 }]} numberOfLines={2}>Jemput: {o.pickup_address}</Text></Row>
            <Row gap={8}><Ionicons name="flag-outline" size={13} color={colors.textMuted} /><Text style={[font.small, { flex: 1 }]} numberOfLines={2}>Antar: {o.dropoff_address}</Text></Row>
          </View>
          <Row gap={8} style={{ marginTop: 10, flexWrap: 'wrap' }}>
            {!!o.pickup_lat && <Button size="sm" variant="outline" icon="navigate" title="Navigasi" onPress={() => Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${o.status === 'in_progress' ? `${o.dropoff_lat},${o.dropoff_lng}` : `${o.pickup_lat},${o.pickup_lng}`}`)} />}
            {o.status === 'accepted' && <Button size="sm" icon="checkmark" title="Sudah dijemput" loading={busy === o.id} onPress={() => confirmThen('Tandai titipan sudah dijemput dari pengirim?', () => act(o.id, 'travel_pickup_send', 'Titipan dalam perjalanan'))} />}
            {o.status === 'in_progress' && <Button size="sm" icon="flag" title="Sudah sampai" loading={busy === o.id} onPress={() => confirmThen('Tandai titipan sudah sampai ke penerima? Pendapatan diteruskan ke AntarPay.', () => act(o.id, 'travel_complete_send', 'Titipan selesai'))} />}
          </Row>
        </Animated.View>
      ))}

      <Text style={font.label}>Titipan tersedia ({rows?.length ?? 0})</Text>
      {rows === null && <Text style={font.small}>Memuat titipan…</Text>}
      {rows?.length === 0 && <Text style={font.small}>Belum ada titipan antar kota yang menunggu. Titipan baru muncul otomatis di sini.</Text>}
      {(rows ?? []).map((r) => (
        <Animated.View key={r.id} entering={FadeInDown.duration(motion.base)} layout={LinearTransition.springify().stiffness(300).damping(22)} style={s.trip}>
          <Row gap={12} style={{ alignItems: 'flex-start' }}>
            <View style={s.thumb}><ServiceIllustration kind="send" size={30} /></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[font.h3, { fontSize: 16 }]} numberOfLines={1}>{r.city ?? '—'} → {r.dest_city ?? '—'}</Text>
              <Text style={font.tiny} numberOfLines={1}>{r.code} · penerima {r.recipient_name ?? '—'}</Text>
              <Row gap={6} style={{ marginTop: 6, flexWrap: 'wrap' }}>
                {r.weight_kg != null && <Badge text={`${numId(r.weight_kg)} kg`} color={colors.textSecondary} />}
                {r.size_cm != null && <Badge text={`sisi ${numId(r.size_cm)} cm`} color={colors.textSecondary} />}
                <Badge text={r.payment_method === 'cash' ? `Tunai ${rupiah(r.total)}` : 'Dibayar AntarPay'} color={r.payment_method === 'cash' ? colors.accent : colors.success} />
              </Row>
            </View>
          </Row>
          <View style={{ gap: 6, marginTop: 10 }}>
            <Row gap={8}><Ionicons name="location-outline" size={13} color={colors.primary} /><Text style={[font.small, { flex: 1 }]} numberOfLines={2}>Jemput: {r.pickup_address}</Text></Row>
            <Row gap={8}><Ionicons name="flag-outline" size={13} color={colors.textMuted} /><Text style={[font.small, { flex: 1 }]} numberOfLines={2}>Antar: {r.dropoff_address}</Text></Row>
          </View>
          <Row between style={s.calc}>
            <Text style={font.tiny}>Pendapatan Anda</Text>
            <Text style={{ fontWeight: '800', color: colors.primary, fontSize: 17 }}>{rupiah(r.partner_earning)}</Text>
          </Row>
          <Button title="Ambil titipan" icon="download-outline" style={{ marginTop: 10 }} loading={busy === r.id}
            onPress={() => confirmThen(`Ambil titipan ${r.code}? Anda bertanggung jawab mengantarnya sampai tujuan.`, () => act(r.id, 'travel_accept_send', 'Titipan diambil'))} />
        </Animated.View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  heroArt: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center' },
  balance: { marginTop: 12, padding: 12, borderRadius: radius.md, backgroundColor: colors.tint },
  day: { width: 58, paddingVertical: 8, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: colors.border, backgroundColor: '#fff' },
  trip: { padding: 12, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: '#fff', ...shadow.soft },
  thumb: { width: 56, height: 56, borderRadius: 16, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center' },
  rowArrow: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.tint },
  pax: { padding: 10, borderRadius: radius.md, backgroundColor: colors.bgSoft, borderWidth: 1, borderColor: colors.border },
  calc: { gap: 4, padding: 10, borderRadius: radius.md, backgroundColor: colors.bgSoft },
});
