// Detail permintaan carter privat / sopir harian — ringkasan, penawaran mitra, terima & bayar, batal, rating
import React, { useState } from 'react';
import { View, Text, StyleSheet, Alert, Platform, ScrollView, useWindowDimensions } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { Screen, Row, Badge, Button, Avatar, Stars, Input, Loading, Empty, CircleButton, IconCircle, toast, type IconName } from '@/components/ui';
import { Entrance, PressableScale } from '@/components/motion';
import { BrandGradient } from '@/components/glass';
import { ServiceIllustration } from '@/components/ServiceArt';
import { CallButton } from '@/components/call/IncomingCall';
import { handleShortfall } from '@/components/BookingSheet';
import { useTravelRequest } from '@/hooks/useTravel';
import { useAuth } from '@/store/auth';
import { usePayPrefs } from '@/store/payprefs';
import { rpc } from '@/lib/supabase';
import { colors, font, radius, shadow, motion } from '@/lib/theme';
import { rupiah, formatSchedule, travelRequestStatusLabel, travelKindLabel, accommodationLabel, paidViaLabel } from '@/lib/format';
import type { TravelOffer, TravelRequest } from '@/lib/types';

const statusColor = (st: TravelRequest['status']) => st === 'completed' ? colors.success : st === 'cancelled' || st === 'expired' ? colors.danger : st === 'offered' ? colors.accent : colors.travel;
type Tab = 'ringkasan' | 'penawaran' | 'kebijakan';
const TABS: { key: Tab; label: string }[] = [{ key: 'ringkasan', label: 'Ringkasan' }, { key: 'penawaran', label: 'Penawaran' }, { key: 'kebijakan', label: 'Kebijakan' }];
const confirmAsk = (title: string, msg: string, onYes: () => void, yes = 'Ya') => {
  if (Platform.OS === 'web') { if (confirm(`${title}\n${msg}`)) onYes(); return; }
  Alert.alert(title, msg, [{ text: 'Tidak' }, { text: yes, style: 'destructive', onPress: onYes }]);
};

export default function TravelRequestDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [tab, setTab] = useState<Tab>('ringkasan');
  const { refreshWallet } = useAuth();
  const payPrefs = usePayPrefs((st) => st.prefs);
  const { request: r, reload } = useTravelRequest(id);
  const [busyOffer, setBusyOffer] = useState<string | null>(null);
  const [cancelNote, setCancelNote] = useState('');
  const [showCancel, setShowCancel] = useState(false);
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const [rating, setRating] = useState(false);

  if (r === undefined) return <Screen title="Permintaan travel" back><Loading /></Screen>;
  if (!r) return <Screen title="Permintaan travel" back><Empty icon="alert-circle-outline" title="Permintaan tidak ditemukan" subtitle="Mungkin sudah dihapus atau Anda tidak memiliki akses." /></Screen>;

  const offers = (r.offers ?? []).filter((o) => o.status !== 'withdrawn');
  const accepted = offers.find((o) => o.id === r.accepted_offer_id) ?? offers.find((o) => o.status === 'accepted') ?? null;
  const canAccept = r.status === 'open' || r.status === 'offered';
  const canCancel = ['open', 'offered', 'accepted', 'paid'].includes(r.status);
  const isActive = ['accepted', 'paid', 'ongoing'].includes(r.status);
  const hoursLeft = (new Date(r.depart_at).getTime() - Date.now()) / 3600e3;
  const fullRefund = hoursLeft >= 12;

  const accept = (o: TravelOffer) => {
    const doIt = async () => {
      setBusyOffer(o.id);
      try {
        await rpc('travel_offer_accept', { p_offer: o.id });
        await refreshWallet();
        toast.success(r.payment_method === 'cash' ? 'Penawaran diterima — bayar tunai ke sopir' : `Penawaran diterima, ${rupiah(o.price)} dipotong dari AntarPay`);
        reload();
      } catch (e) { if (!handleShortfall(e, router, payPrefs?.ewallet)) toast.error((e as Error).message); }
      finally { setBusyOffer(null); }
    };
    confirmAsk('Terima penawaran?', `${rupiah(o.price)} dari ${o.partner?.company_name ?? o.partner?.name ?? 'mitra'}. ${r.payment_method === 'cash' ? 'Anda membayar tunai ke sopir saat berangkat.' : 'Saldo AntarPay dipotong sekarang dan diteruskan ke mitra setelah perjalanan selesai.'}`, doIt, 'Terima');
  };
  const cancel = async () => {
    try {
      await rpc('travel_request_set_status', { p_request: r.id, p_status: 'cancelled', p_note: cancelNote || 'Dibatalkan pelanggan' });
      await refreshWallet(); toast.show('Permintaan dibatalkan'); setShowCancel(false); reload();
    } catch (e) { toast.error((e as Error).message); }
  };
  const rate = async () => {
    if (!stars) return toast.error('Pilih jumlah bintang');
    setRating(true);
    try { await rpc('travel_request_rate', { p_request: r.id, p_rating: stars, p_comment: comment || null }); toast.success('Terima kasih atas penilaian Anda'); reload(); }
    catch (e) { toast.error((e as Error).message); } finally { setRating(false); }
  };

  const partnerPeer = accepted?.partner ? { id: accepted.partner.id, name: accepted.partner.company_name ?? accepted.partner.name, role: 'driver' as const } : null;
  const heroH = Math.round(height * 0.4);
  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/travel' as never));
  const contactCs = () => router.push({ pathname: '/support/new', params: { category: 'order', subject: `Permintaan ${r.code}` } } as never);
  const lowest = offers.filter((o) => o.status === 'offered').reduce<number | null>((m, o) => (m === null || o.price < m ? o.price : m), null);
  const infoRow = (icon: IconName, label: string, value: string, color = colors.primary) => (
    <Row gap={12} style={{ paddingVertical: 8, alignItems: 'flex-start' }}>
      <IconCircle name={icon} size={40} bg={colors.tint} color={color} />
      <View style={{ flex: 1 }}><Text style={font.tiny}>{label}</Text><Text style={[font.body, { fontWeight: '600' }]}>{value}</Text></View>
    </Row>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 140 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Animated.View entering={FadeIn.duration(motion.slow)} style={{ height: heroH }}>
          <BrandGradient colors={[colors.travel, colors.primaryDeep]} style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
            <ServiceIllustration kind="car" size={140} />
          </BrandGradient>
          <BrandGradient colors={['rgba(0,0,0,0.25)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0.35)']} angle="vertical" style={StyleSheet.absoluteFill} />
          <View style={[s.statusPill, { top: insets.top + 60, backgroundColor: statusColor(r.status) }]}><Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>{travelRequestStatusLabel[r.status]}</Text></View>
        </Animated.View>

        <View style={s.wrap}>
          <Animated.View entering={FadeInDown.duration(motion.slow)} style={s.sheet}>
            <View style={s.handle} />
            <Text style={font.h1} numberOfLines={2}>{r.kind === 'daily' ? `Sopir harian · ${r.days} hari` : 'Carter privat'}</Text>
            <Row gap={4} style={{ marginTop: 4 }}><Ionicons name="location-outline" size={16} color={colors.textMuted} /><Text style={font.small} numberOfLines={1}>{r.dropoff_address ?? r.pickup_address}</Text></Row>
            <Row gap={8} style={{ marginTop: 12, flexWrap: 'wrap' }}>
              <Badge text={`Berangkat ${formatSchedule(r.depart_at)}`} color={colors.primary} />
              <Badge text={`${travelKindLabel[r.kind]} · ${r.pax} penumpang`} color={colors.textSecondary} />
              <Badge text={r.code} color={colors.textMuted} />
            </Row>
            <Row gap={8} style={{ marginTop: 16 }}>
              {TABS.map((x) => (
                <PressableScale key={x.key} onPress={() => setTab(x.key)} scaleTo={0.94} style={[s.tab, tab === x.key && s.tabOn]}>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: tab === x.key ? '#fff' : colors.text }}>{x.label}{x.key === 'penawaran' && offers.length ? ` (${offers.length})` : ''}</Text>
                </PressableScale>
              ))}
            </Row>
          </Animated.View>

          <View style={{ paddingHorizontal: 16, gap: 12, marginTop: 14 }}>
            {tab === 'ringkasan' && (
              <>
                {accepted && (
                  <Entrance index={0}><View style={[s.card, { borderColor: colors.primary, borderWidth: 1.5 }]}>
                    <Text style={[font.label, { marginBottom: 8 }]}>Mitra Anda</Text>
                    <Row gap={12}>
                      <Avatar name={accepted.partner?.company_name ?? accepted.partner?.name} url={accepted.partner?.photo_url ?? accepted.partner?.avatar_url} size={52} />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={font.h3} numberOfLines={1}>{accepted.partner?.company_name ?? accepted.partner?.name}</Text>
                        <Text style={font.small} numberOfLines={2}>{accepted.partner?.driver_name ? `Sopir ${accepted.partner.driver_name} · ` : ''}{accepted.partner?.vehicle_model}{accepted.partner?.vehicle_plate ? ` · ${accepted.partner.vehicle_plate}` : ''}</Text>
                        <Text style={font.tiny}>Rating {Number(accepted.partner?.rating_avg ?? 0).toFixed(1)} · {accepted.partner?.total_trips ?? 0} trip · {rupiah(accepted.price)}</Text>
                      </View>
                      {isActive && partnerPeer && <CallButton peer={partnerPeer} size={40} color={colors.primary} />}
                    </Row>
                    {isActive && partnerPeer && <Row gap={8} style={{ marginTop: 10 }}><CallButton peer={partnerPeer} size={36} color={colors.primary} label="Telepon sopir" /><Text style={[font.tiny, { flex: 1 }]}>Nomor tersamar, telepon lewat aplikasi. Sopir menghubungi Anda ±1 jam sebelum jemput.</Text></Row>}
                    {r.status === 'accepted' && r.payment_method === 'cash' && <Text style={[font.tiny, { marginTop: 6 }]}>Bayar tunai {rupiah(r.price)} ke sopir saat berangkat.</Text>}
                  </View></Entrance>
                )}
                <Entrance index={1}><View style={s.card}>
                  {infoRow('home-outline', 'Jemput', `${r.pickup_address}${r.from_city_name ? ` (${r.from_city_name})` : ''}`)}
                  {infoRow('flag-outline', r.kind === 'daily' ? 'Rute' : 'Tujuan', `${r.dropoff_address ?? 'Keliling / ditentukan bersama sopir'}${r.to_city_name ? ` (${r.to_city_name})` : ''}`, colors.danger)}
                  {infoRow('calendar-outline', 'Jadwal', `Berangkat ${formatSchedule(r.depart_at)}${r.return_at ? ` · kembali ${formatSchedule(r.return_at)}` : ''}`)}
                  {infoRow('people-outline', 'Rombongan', `${r.pax} penumpang${r.luggage ? ` · bagasi ${r.luggage}` : ''}${r.vehicle_pref ? ` · ${r.vehicle_pref}` : ''}`)}
                  {infoRow('bed-outline', 'Akomodasi sopir', accommodationLabel[r.accommodation], r.accommodation === 'self' ? colors.accent : colors.primary)}
                  {infoRow('speedometer-outline', 'BBM, tol & parkir', r.fuel === 'partner' ? 'Termasuk harga penawaran' : 'Ditanggung pelanggan')}
                  {r.budget ? infoRow('cash-outline', 'Anggaran', rupiah(r.budget)) : null}
                  {r.price > 0 ? infoRow('card-outline', 'Pembayaran', `${rupiah(r.price)} · ${paidViaLabel(r.paid_via)}`) : null}
                  {r.notes ? <Text style={[font.tiny, { marginTop: 6 }]}>Catatan: {r.notes}</Text> : null}
                </View></Entrance>
                {r.status === 'completed' && (
                  <Entrance index={2}><View style={[s.card, { gap: 10 }]}>
                    {r.rating ? (
                      <>
                        <Text style={font.label}>Penilaian Anda</Text>
                        <Stars value={r.rating} size={22} />
                        {r.rating_comment ? <Text style={font.small}>{r.rating_comment}</Text> : null}
                      </>
                    ) : (
                      <>
                        <Text style={font.label}>Bagaimana perjalanan Anda?</Text>
                        <Stars value={stars} size={30} onChange={setStars} />
                        <Input placeholder="Komentar untuk mitra (opsional)" value={comment} onChangeText={setComment} multiline />
                        <Button title="Kirim penilaian" icon="star-outline" loading={rating} onPress={rate} />
                      </>
                    )}
                  </View></Entrance>
                )}
              </>
            )}

            {tab === 'penawaran' && (
              <>
                {offers.length === 0 && <Entrance index={0}><View style={s.card}><Text style={font.small}>{canAccept ? 'Belum ada penawaran. Mitra yang cocok akan mengirim harga; Anda akan diberi tahu lewat notifikasi.' : 'Tidak ada penawaran.'}</Text></View></Entrance>}
                {offers.map((o, i) => {
                  const b = o.breakdown ?? {}; const p = o.partner; const isAcc = accepted?.id === o.id;
                  return (
                    <Entrance key={o.id} index={Math.min(i, 6)}><View style={[s.card, { gap: 10 }, isAcc && { borderColor: colors.primary, borderWidth: 1.5 }]}>
                      <Row gap={12} style={{ alignItems: 'flex-start' }}>
                        {p?.photo_url || p?.avatar_url ? <Avatar name={p?.company_name ?? p?.name} url={p?.photo_url ?? p?.avatar_url} size={64} /> : <View style={s.thumb}><ServiceIllustration kind="car" size={40} /></View>}
                        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                          <Text style={[font.body, { fontWeight: '700' }]} numberOfLines={1}>{p?.company_name ?? p?.name ?? 'Mitra travel'}</Text>
                          <Row gap={4}><Ionicons name="car-outline" size={12} color={colors.textMuted} /><Text style={font.tiny} numberOfLines={1}>{p?.partner_type === 'agency' ? 'Agen travel' : 'Mobil pribadi'} · {p?.vehicle_model}{p?.vehicle_year ? ` ${p.vehicle_year}` : ''} · {p?.seats} kursi{p?.is_electric ? ' · listrik' : ''}</Text></Row>
                          <Row gap={4}><Ionicons name="star" size={12} color={colors.accent} /><Text style={font.tiny}>{Number(p?.rating_avg ?? 0).toFixed(1)} ({p?.rating_count ?? 0}) · {p?.total_trips ?? 0} trip</Text></Row>
                        </View>
                        <View style={{ alignItems: 'flex-end', gap: 4 }}><Text style={{ fontWeight: '700', color: colors.primary, fontSize: 18 }}>{rupiah(o.price)}</Text><Badge text={isAcc ? 'Diterima' : o.status === 'rejected' ? 'Ditolak' : 'Penawaran'} color={isAcc ? colors.success : o.status === 'rejected' ? colors.danger : colors.accent} /></View>
                      </Row>
                      {(b.daily_rate || b.accommodation_fee || b.fuel_est) ? (
                        <View style={s.breakdown}>
                          {b.daily_rate ? <Row between><Text style={font.tiny}>{rupiah(b.daily_rate)}/hari × {b.days ?? r.days} hari</Text><Text style={font.tiny}>{rupiah(b.daily_rate * (b.days ?? r.days))}</Text></Row> : null}
                          {b.accommodation_fee && b.accommodation_nights ? <Row between><Text style={font.tiny}>Akomodasi mandiri {rupiah(b.accommodation_fee)} × {b.accommodation_nights} malam</Text><Text style={font.tiny}>{rupiah(b.accommodation_fee * b.accommodation_nights)}</Text></Row> : null}
                          {b.fuel_est ? <Row between><Text style={font.tiny}>Estimasi BBM/tol/parkir</Text><Text style={font.tiny}>{rupiah(b.fuel_est)}</Text></Row> : null}
                          {b.overtime_rate ? <Row between><Text style={font.tiny}>Overtime di luar 12 jam</Text><Text style={font.tiny}>{rupiah(b.overtime_rate)}/jam</Text></Row> : null}
                          {b.notes ? <Text style={font.tiny}>{b.notes}</Text> : null}
                        </View>
                      ) : null}
                      {o.message ? <Text style={font.small}>“{o.message}”</Text> : null}
                      {canAccept && o.status === 'offered' && <Button title={`Terima & bayar ${rupiah(o.price)}`} icon="checkmark-circle-outline" loading={busyOffer === o.id} onPress={() => accept(o)} />}
                    </View></Entrance>
                  );
                })}
              </>
            )}

            {tab === 'kebijakan' && (
              <>
                <Entrance index={0}><View style={s.card}>
                  {infoRow('time-outline', 'Pembatalan', 'Refund penuh bila dibatalkan 12 jam atau lebih sebelum berangkat; 70% jika kurang dari itu (setelah pembayaran).')}
                  {infoRow('wallet-outline', 'Dana AntarPay', 'Ditahan platform dan diteruskan ke mitra setelah perjalanan selesai.')}
                  {infoRow('timer-outline', 'Overtime', 'Di luar 12 jam/hari dibayar langsung ke sopir sesuai tarif penawaran.')}
                  {infoRow('hourglass-outline', 'Masa berlaku', 'Permintaan berlaku hingga jadwal berangkat, maksimal 3 permintaan aktif.')}
                  <Button title="Ada kendala? Hubungi CS" variant="ghost" color={colors.textSecondary} icon="help-circle-outline" onPress={contactCs} style={{ marginTop: 6 }} />
                </View></Entrance>
                {canCancel && (
                  <Entrance index={1}><View style={[s.card, { gap: 10 }]}>
                    {!showCancel ? (
                      <Button title="Batalkan permintaan" variant="outline" color={colors.danger} icon="close-circle-outline" onPress={() => setShowCancel(true)} />
                    ) : (
                      <>
                        <Text style={font.label}>Batalkan permintaan?</Text>
                        <Text style={font.small}>{r.payment_status === 'paid' ? (fullRefund ? `Dana ${rupiah(r.price)} dikembalikan penuh ke AntarPay karena masih ≥12 jam sebelum berangkat.` : `Kurang dari 12 jam sebelum berangkat: dikembalikan 70% (${rupiah(Math.round(r.price * 0.7))}), sisanya kompensasi mitra.`) : 'Belum ada dana ditahan. Refund penuh bila dibatalkan ≥12 jam sebelum berangkat, 70% jika kurang dari itu (setelah pembayaran).'}</Text>
                        <Input placeholder="Alasan pembatalan (opsional)" value={cancelNote} onChangeText={setCancelNote} />
                        <Row gap={8}><Button title="Kembali" variant="secondary" style={{ flex: 1 }} onPress={() => setShowCancel(false)} /><Button title="Ya, batalkan" variant="danger" style={{ flex: 1 }} onPress={() => confirmAsk('Konfirmasi', 'Permintaan akan dibatalkan.', cancel, 'Batalkan')} /></Row>
                      </>
                    )}
                  </View></Entrance>
                )}
              </>
            )}
          </View>
        </View>
      </ScrollView>

      <CircleButton icon="chevron-back" onPress={goBack} style={[s.overlay, { top: insets.top + 8, left: 16 }]} />
      <CircleButton icon="help-circle-outline" onPress={contactCs} style={[s.overlay, { top: insets.top + 8, right: 16 }]} />

      <View style={[s.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <Row between gap={12}>
          <View style={{ flex: 1 }}>
            <Text style={font.tiny}>{r.price > 0 ? 'Harga disepakati' : lowest ? 'Penawaran terendah' : 'Menunggu penawaran'}</Text>
            <Text style={[font.h1, { color: colors.primary }]}>{r.price > 0 ? rupiah(r.price) : lowest ? rupiah(lowest) : r.budget ? `≤ ${rupiah(r.budget)}` : '-'}</Text>
          </View>
          {canAccept && offers.some((o) => o.status === 'offered') && tab !== 'penawaran'
            ? <Button title="Lihat penawaran" size="lg" icon="pricetags-outline" onPress={() => setTab('penawaran')} style={{ minWidth: 150 }} />
            : canCancel && tab !== 'kebijakan' && !accepted
              ? <Button title="Batalkan" variant="danger" size="lg" onPress={() => { setTab('kebijakan'); setShowCancel(true); }} style={{ minWidth: 150 }} />
              : <Button title="Hubungi CS" size="lg" icon="chatbubble-ellipses-outline" onPress={contactCs} style={{ minWidth: 150 }} />}
        </Row>
      </View>
    </View>
  );
}
const s = StyleSheet.create({
  wrap: { width: '100%', maxWidth: 640, alignSelf: 'center' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, marginTop: -28, padding: 20, paddingTop: 12, borderWidth: 1, borderBottomWidth: 0, borderColor: colors.border, ...shadow.card },
  handle: { width: 44, height: 5, borderRadius: 3, backgroundColor: colors.border, alignSelf: 'center', marginBottom: 14 },
  statusPill: { position: 'absolute', left: 16, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.full },
  tab: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, backgroundColor: '#fff' },
  tabOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  card: { backgroundColor: '#fff', borderRadius: radius.lg, padding: 16, borderWidth: 1, borderColor: colors.border, ...shadow.soft },
  thumb: { width: 64, height: 64, borderRadius: 16, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center' },
  breakdown: { gap: 4, padding: 10, borderRadius: radius.md, backgroundColor: colors.bgSoft },
  overlay: { position: 'absolute' },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 12, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: colors.border, ...shadow.sheet },
});
