// AntarSend — dalam kota (kurir langsung) atau antar kota:
//   • lewat gudang AntarSend (driver antar ke gudang asal → drop point kota tujuan)
//   • atau dititipkan ke mitra AntarTravel (door to door, batas berat/ukuran lebih kecil)
// Berat (kg) & sisi terpanjang (cm) wajib diisi: menentukan kendaraan yang dibutuhkan (batas dari app_public_settings().send_limits).
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import { Screen, Button, Row, Badge, Input, Chip, toast } from '@/components/ui';
import { PressableScale } from '@/components/motion';
import { Dropdown, type DropdownOption } from '@/components/Dropdown';
import { LocationFields } from '@/components/LocationField';
import { DestinationSuggestions, SchedulePicker, RoutePreview } from '@/components/BookingExtras';
import { PaymentSection, PriceSummary, paidViaOf, handleShortfall, type PayChoice } from '@/components/BookingSheet';
import { ServiceArt } from '@/components/ServiceArt';
import { LimitNotice, LimitInfo, ServiceDisabledEmpty, limitBlocked } from '@/components/ServiceLimit';
import { useAppSettings, requiredSendVehicle, fitsTravel } from '@/hooks/useAppSettings';
import { usePayPrefs } from '@/store/payprefs';
import { useBooking } from '@/store/booking';
import { useAuth } from '@/store/auth';
import { useCurrentLocation } from '@/hooks/useLocation';
import { getRoute, reverseGeocode, haversineKm, type RouteResult } from '@/lib/geo';
import { rpc, supabase } from '@/lib/supabase';
import { colors, font, radius, motion, glass } from '@/lib/theme';
import { rupiah, km, minutes } from '@/lib/format';
import type { FareEstimate, Order, City, Warehouse, IntercityEstimate, SendVehicle } from '@/lib/types';

const TYPES = ['Dokumen', 'Makanan', 'Pakaian', 'Elektronik', 'Lainnya'];
const QUICK_KG = [1, 3, 5, 10, 20];
const QUICK_CM = [30, 60, 100, 150];
const NEED_LABEL: Record<SendVehicle, string> = { motor: 'Motor cukup', car: 'Perlu mobil', box: 'Perlu AntarBox', travel: 'Muat mitra travel' };
const NEED_ICON: Record<SendVehicle, string> = { motor: 'bicycle', car: 'car-sport', box: 'bus', travel: 'bus-outline' };
const NEED_COLOR: Record<SendVehicle, string> = { motor: colors.success, car: colors.info, box: colors.box, travel: colors.travel };
const num = (v: string) => { const n = Number(String(v).replace(',', '.')); return Number.isFinite(n) && n > 0 ? n : 0; };

export default function SendScreen() {
  const router = useRouter();
  const { pickup, dropoff, setPickup, setDropoff } = useBooking();
  const { location, hasFix } = useCurrentLocation();
  const refreshWallet = useAuth((s) => s.refreshWallet);
  const { isEnabled, sendLimits } = useAppSettings();
  const [scope, setScope] = useState<'in_city' | 'intercity'>('in_city');
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [fare, setFare] = useState<FareEstimate | null>(null);
  const [loadingEst, setLoadingEst] = useState(false);
  const [method, setMethod] = useState<PayChoice>('cash');
  const payPrefs = usePayPrefs((st) => st.prefs);
  const [promo, setPromo] = useState('');
  const [discount, setDiscount] = useState(0);
  const [notes, setNotes] = useState('');
  const [recipient, setRecipient] = useState({ name: '', phone: '' });
  const [type, setType] = useState('Dokumen');
  const [weightKg, setWeightKg] = useState('');
  const [sizeCm, setSizeCm] = useState('');
  const [desc, setDesc] = useState('');
  const [when, setWhen] = useState<Date | null>(null);
  // antar kota
  const [cities, setCities] = useState<City[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [originCity, setOriginCity] = useState<City | null>(null);
  const [destCity, setDestCity] = useState<City | null>(null);
  const [destWhId, setDestWhId] = useState<string | null>(null);
  const [originWhId, setOriginWhId] = useState<string | null>(null);
  const [via, setVia] = useState<'warehouse' | 'travel'>('warehouse');
  const [destAddress, setDestAddress] = useState('');
  const [ic, setIc] = useState<IntercityEstimate | null>(null);
  const [ordering, setOrdering] = useState(false);

  const wKg = num(weightKg);
  const sCm = num(sizeCm);
  const sized = wKg > 0 && sCm > 0;
  const need = sized ? requiredSendVehicle(wKg, sCm, sendLimits) : null;
  const overLimit = sized && need === null;
  const travelOk = sized && fitsTravel(wKg, sCm, sendLimits);

  useEffect(() => {
    if (!pickup && hasFix) reverseGeocode(location).then((address) => { if (!useBooking.getState().pickup) setPickup({ ...location, address, name: 'Lokasi saya' }); });
  }, [hasFix]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    supabase.from('cities').select('*').eq('active', true).order('name').then(({ data }) => setCities((data as City[]) ?? []));
    supabase.from('warehouses').select('*').eq('active', true).order('type').then(({ data }) => setWarehouses((data as Warehouse[]) ?? []));
  }, []);
  // kota asal dari titik jemput
  useEffect(() => {
    if (!pickup || cities.length === 0) return;
    supabase.rpc('nearest_city', { p_lat: pickup.lat, p_lng: pickup.lng, p_max_km: 60 }).then(({ data }) => setOriginCity(cities.find((c) => c.id === data) ?? null));
  }, [pickup?.lat, pickup?.lng, cities]); // eslint-disable-line react-hooks/exhaustive-deps
  // jalur titipan travel otomatis kembali ke gudang bila paket melebihi batas mitra travel
  useEffect(() => { if (via === 'travel' && sized && !travelOk) setVia('warehouse'); }, [via, sized, travelOk]);

  // gudang asal: daftar di kota asal, terdekat lebih dulu (gudang besar diprioritaskan seperti server)
  const originWhs = useMemo(() => {
    if (!originCity || !pickup) return [];
    return warehouses
      .filter((w) => w.city_id === originCity.id && w.lat != null && w.lng != null)
      .sort((a, b) => (a.type === 'big' ? -1 : 1) - (b.type === 'big' ? -1 : 1) || dist(pickup, a) - dist(pickup, b));
  }, [originCity, warehouses, pickup?.lat, pickup?.lng]); // eslint-disable-line react-hooks/exhaustive-deps
  const originWh = useMemo(() => originWhs.find((w) => w.id === originWhId) ?? originWhs[0] ?? null, [originWhs, originWhId]);
  const destWhs = useMemo(() => warehouses.filter((w) => w.city_id === destCity?.id), [warehouses, destCity?.id]);
  const destWh = useMemo(() => destWhs.find((w) => w.id === destWhId) ?? null, [destWhs, destWhId]);
  const legDrop = scope === 'intercity' ? (originWh?.lat != null && originWh.lng != null ? { lat: originWh.lat, lng: originWh.lng, address: originWh.name } : null) : dropoff;

  useEffect(() => {
    if (!pickup || !legDrop) { setRoute(null); setFare(null); return; }
    let cancelled = false;
    (async () => {
      setLoadingEst(true);
      const r = await getRoute(pickup, legDrop);
      if (cancelled) return;
      setRoute(r);
      const f = await rpc<FareEstimate>('estimate_fare', { p_service: 'send', p_pickup_lat: pickup.lat, p_pickup_lng: pickup.lng, p_drop_lat: legDrop.lat, p_drop_lng: legDrop.lng, p_route_km: r.distance_km }).catch(() => null);
      if (!cancelled) { setFare(f); setLoadingEst(false); }
    })();
    return () => { cancelled = true; };
  }, [pickup?.lat, pickup?.lng, legDrop?.lat, legDrop?.lng]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (scope !== 'intercity' || !originCity || !destCity) { setIc(null); return; }
    rpc<IntercityEstimate | null>('estimate_intercity', { p_from_city: originCity.id, p_to_city: destCity.id, p_weight_kg: wKg || 1 }).then(setIc).catch(() => setIc(null));
  }, [scope, originCity?.id, destCity?.id, wKg]); // eslint-disable-line react-hooks/exhaustive-deps

  const icFare = ic?.fare ?? 0;
  const total = fare ? Math.max(0, fare.fare + fare.platform_fee + icFare - discount) : 0;
  const phoneOk = /^(\+62|0)8\d{7,12}$/.test(recipient.phone.replace(/\s|-/g, ''));
  // Batas jarak hanya berlaku untuk pengiriman dalam kota; antar kota lewat gudang tidak dibatasi
  const blocked = scope === 'in_city' && limitBlocked(fare?.limit);
  const serviceOff = fare?.service_enabled === false || !isEnabled('send');
  const travelPicked = scope === 'intercity' && via === 'travel';
  const valid = !!(pickup && fare && sized && !overLimit && recipient.name.trim().length >= 2 && phoneOk
    && (scope === 'in_city' ? dropoff : destCity && destWh && ic)
    && (!travelPicked || (travelOk && destAddress.trim().length >= 6))) && !blocked && !serviceOff;

  // Alasan tombol pesan belum aktif (ditulis di judul tombol agar jelas, tetap satu baris)
  const hint = overLimit ? 'Paket melebihi batas AntarSend'
    : blocked ? 'Di luar jangkauan dalam kota'
    : !sized ? 'Isi berat & ukuran paket'
    : scope === 'in_city' && !dropoff ? 'Pilih alamat tujuan'
    : scope === 'intercity' && !destCity ? 'Pilih kota tujuan'
    : scope === 'intercity' && !destWh ? 'Pilih drop point tujuan'
    : travelPicked && destAddress.trim().length < 6 ? 'Isi alamat penerima'
    : recipient.name.trim().length < 2 ? 'Isi nama penerima'
    : !phoneOk ? 'Isi nomor HP penerima'
    : !fare ? 'Menghitung ongkir…'
    : null;

  const order = async () => {
    if (!valid || !pickup) return;
    setOrdering(true);
    try {
      const o = await rpc<Order>('create_order', { p: {
        service: 'send', pickup: { lat: pickup.lat, lng: pickup.lng, address: pickup.address },
        dropoff: scope === 'in_city' ? { lat: dropoff!.lat, lng: dropoff!.lng, address: dropoff!.address } : { lat: legDrop!.lat, lng: legDrop!.lng, address: legDrop!.address },
        route_km: route?.distance_km, duration_min: route?.duration_min, route_geometry: route?.coords, payment_method: method === 'ewallet' ? 'wallet' : method, paid_via: paidViaOf(method, payPrefs?.ewallet), promo_code: promo || null, notes: notes || null,
        recipient_name: recipient.name.trim(), recipient_phone: recipient.phone.trim(),
        package_details: { type, weight: `${fmtNum(wKg)} kg`, description: desc, dest_address: scope === 'intercity' ? (travelPicked ? destAddress.trim() : `${destWh?.name} · ${destCity?.name}`) : undefined },
        send_scope: scope, dest_city_id: destCity?.id ?? null, warehouse_id: destWh?.id ?? null,
        weight_kg: wKg, size_cm: sCm, via: travelPicked ? 'travel' : null,
        scheduled_at: when ? when.toISOString() : null,
      } });
      await refreshWallet();
      useBooking.getState().reset();
      router.replace(`/order/${o.id}` as never);
    } catch (e) { if (!handleShortfall(e, router, payPrefs?.ewallet)) toast.error((e as Error).message); }
    finally { setOrdering(false); }
  };

  const whOption = (w: Warehouse, from?: { lat: number; lng: number } | null): DropdownOption<string> => ({
    value: w.id,
    label: w.name,
    sublabel: w.address ?? undefined,
    meta: [w.type === 'big' ? 'Gudang besar' : 'Gudang kecil / mitra', w.partner_name, w.open_hours ? `Buka ${w.open_hours}` : null,
      from && w.lat != null && w.lng != null ? km(haversineKm(from, { lat: w.lat, lng: w.lng })) : null].filter(Boolean).join(' · '),
    icon: w.type === 'big' ? 'business' : 'storefront',
  });

  return (
    <Screen title="AntarSend" subtitle="Kirim paket dalam kota & antar kota" band={colors.send} back maxWidth={640} footer={pickup && !serviceOff && (fare || overLimit) ? (
      <View style={{ gap: 10 }}>
        <LimitNotice limit={fare?.limit} actionTitle="Pakai AntarSend Antar Kota" actionIcon="airplane-outline" onAction={() => setScope('intercity')} />
        <Button title={hint ?? `${when ? 'Booking' : 'Kirim'} ${scope === 'intercity' ? 'antar kota' : 'sekarang'} · ${rupiah(total)}`} size="lg" color={colors.send} loading={ordering} disabled={!valid} onPress={order} />
      </View>
    ) : undefined}>
      <View style={{ gap: 14 }}>
        {serviceOff && <ServiceDisabledEmpty onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))} />}
        {!serviceOff && <>
        <Row gap={12} style={s.hero}>
          <ServiceArt kind="send" color={colors.send} size={54} glow={false} />
          <View style={{ flex: 1 }}><Text style={font.h3}>Kirim paket</Text><Text style={font.tiny}>Dalam kota sampai hari ini · antar kota lewat gudang atau mitra travel</Text></View>
        </Row>
        <Row gap={8}>
          <ScopeBtn active={scope === 'in_city'} onPress={() => setScope('in_city')} icon="bicycle" title="Dalam kota" sub="Kurir langsung, ±1 jam" />
          <ScopeBtn active={scope === 'intercity'} onPress={() => setScope('intercity')} icon="airplane-outline" title="Antar kota" sub="Gudang / mitra travel" />
        </Row>
        <View style={s.group}>
          <Text style={font.label}>Detail paket</Text>
          <Row gap={8} style={{ flexWrap: 'wrap' }}>{TYPES.map((t) => <Chip key={t} label={t} active={type === t} onPress={() => setType(t)} color={colors.send} />)}</Row>

          <Row gap={8} style={{ alignItems: 'flex-end' }}>
            <Input containerStyle={{ flex: 1 }} label="Berat (kg)" placeholder="mis. 3" icon="barbell-outline" keyboardType="decimal-pad" value={weightKg} onChangeText={(v) => setWeightKg(v.replace(/[^0-9.,]/g, ''))} />
            <Input containerStyle={{ flex: 1 }} label="Sisi terpanjang (cm)" placeholder="mis. 40" icon="resize-outline" keyboardType="number-pad" value={sizeCm} onChangeText={(v) => setSizeCm(v.replace(/[^0-9.,]/g, ''))} />
          </Row>
          <Text style={font.tiny}>Ukur sisi terpanjang paket (panjang, lebar, atau tinggi yang paling besar).</Text>
          <Row gap={6} style={{ flexWrap: 'wrap' }}>{QUICK_KG.map((k) => <Chip key={k} label={`${k} kg`} active={wKg === k} onPress={() => setWeightKg(String(k))} color={colors.send} />)}</Row>
          <Row gap={6} style={{ flexWrap: 'wrap' }}>{QUICK_CM.map((c) => <Chip key={c} label={`${c} cm`} active={sCm === c} onPress={() => setSizeCm(String(c))} color={colors.send} />)}</Row>

          {!sized && <Text style={font.tiny}>Isi berat & sisi terpanjang paket — kami tentukan kendaraan yang dibutuhkan (motor, mobil, atau AntarBox).</Text>}
          {sized && need && (
            <Row gap={8} style={[s.needBox, { borderColor: NEED_COLOR[need] + '55', backgroundColor: NEED_COLOR[need] + '12' }]}>
              <Ionicons name={NEED_ICON[need] as never} size={18} color={NEED_COLOR[need]} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontWeight: '800', color: colors.text, fontSize: 13.5 }} numberOfLines={1}>{NEED_LABEL[need]} · {fmtNum(wKg)} kg / {fmtNum(sCm)} cm</Text>
                <Text style={font.tiny} numberOfLines={2}>Batas {need === 'motor' ? 'motor' : need === 'car' ? 'mobil' : 'AntarBox'}: {fmtNum(sendLimits[need].max_kg)} kg · sisi terpanjang {fmtNum(sendLimits[need].max_cm)} cm{need !== 'motor' ? ` · di atas batas motor (${fmtNum(sendLimits.motor.max_kg)} kg / ${fmtNum(sendLimits.motor.max_cm)} cm)` : ''}</Text>
              </View>
            </Row>
          )}
          {overLimit && (
            <View style={s.overBox}>
              <Row gap={10} style={{ alignItems: 'flex-start' }}>
                <Ionicons name="alert-circle" size={20} color={colors.danger} />
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <Text style={[font.body, { fontWeight: '800', color: colors.danger }]}>Paket melebihi batas AntarSend</Text>
                  <Text style={[font.small, { color: colors.text }]}>{fmtNum(wKg)} kg / {fmtNum(sCm)} cm melebihi batas terbesar ({fmtNum(sendLimits.box.max_kg)} kg · sisi terpanjang {fmtNum(sendLimits.box.max_cm)} cm). Untuk barang sebesar ini gunakan AntarBox (mobil box / pick up).</Text>
                </View>
              </Row>
              <Button title="Buka AntarBox" icon="bus" variant="secondary" size="sm" color={colors.box} onPress={() => router.push('/box' as never)} style={{ alignSelf: 'flex-start', marginTop: 10 }} />
            </View>
          )}
          <Input placeholder="Deskripsi isi paket (opsional)" icon="document-text-outline" value={desc} onChangeText={setDesc} />
        </View>

        {scope === 'in_city' ? (
          <>
            <LocationFields pickup={pickup} dropoff={dropoff} pickupLabel="Ambil dari" dropoffLabel="Antar ke" accent={colors.send} />
            {!dropoff && <DestinationSuggestions onPick={(p) => setDropoff(p)} service="send" title="Alamat antar terakhir" />}
          </>
        ) : (
          <View style={{ gap: 10 }}>
            <LocationFields pickup={pickup} dropoff={legDrop} pickupLabel="Ambil dari" dropoffLabel={via === 'travel' ? 'Titik kumpul mitra travel' : 'Diantar ke gudang asal'} lockDropoff accent={colors.send} />

            <View style={s.group}>
              <Text style={font.label}>Jalur pengiriman</Text>
              <RouteCard
                active={via === 'warehouse'} onPress={() => setVia('warehouse')} icon="business"
                title="Lewat gudang AntarSend"
                sub="Kurir mengantar paket ke gudang asal, dikirim ke drop point kota tujuan, penerima ambil atau diantar kurir lokal."
                meta={`Estimasi ${ic?.eta_days ? `${ic.eta_days} hari` : '1–3 hari'} · sampai ${fmtNum(sendLimits.box.max_kg)} kg · diasuransikan s.d. Rp1.000.000`}
              />
              <RouteCard
                active={via === 'travel'} onPress={() => setVia('travel')} icon="bus-outline" color={colors.travel}
                title="Titip mitra AntarTravel"
                sub="Paket ikut mobil mitra travel yang berangkat ke kota tujuan — dijemput di alamat Anda dan diantar sampai alamat penerima (door to door)."
                meta={`Estimasi 1 hari (mengikuti jadwal keberangkatan) · maks ${fmtNum(sendLimits.travel.max_kg)} kg & sisi terpanjang ${fmtNum(sendLimits.travel.max_cm)} cm`}
                disabled={sized ? !travelOk : false}
                note={!sized ? 'Isi berat & ukuran dulu untuk memastikan paket muat.' : !travelOk ? `Paket ${fmtNum(wKg)} kg / ${fmtNum(sCm)} cm melebihi batas titipan travel — pakai jalur gudang.` : undefined}
              />
            </View>

            <View style={s.group}>
              <Row between><Text style={font.label}>Kota asal</Text><Badge text={originCity ? originCity.name : 'Di luar jangkauan'} color={originCity ? colors.send : colors.danger} /></Row>
              <Dropdown
                label={via === 'travel' ? 'Titik kumpul mitra di kota asal' : 'Gudang asal (paket diantar ke sini)'}
                title="Pilih gudang asal"
                value={originWh?.id ?? null}
                options={originWhs.map((w) => whOption(w, pickup))}
                onChange={(v) => setOriginWhId(v)}
                placeholder={originCity ? 'Pilih gudang asal' : 'Kota asal belum terlayani'}
                emptyText="Belum ada gudang mitra di kota asal Anda."
                helper="Diurutkan dari yang terdekat dengan titik jemput. Ongkos kurir dihitung sampai titik ini."
                accent={colors.send} icon="business"
                disabled={originWhs.length === 0}
              />
              {/* Kota tujuan memakai dropdown (bukan deretan chip) supaya hemat ruang. */}
              <Dropdown
                label="Kota tujuan"
                title="Pilih kota tujuan"
                value={destCity?.id ?? null}
                options={cities.filter((c) => c.id !== originCity?.id).map((c) => ({ value: c.id, label: c.name, icon: 'flag-outline' as const }))}
                onChange={(v) => { const c = cities.find((x) => x.id === v); if (c) { setDestCity(c); setDestWhId(null); } }}
                placeholder="Pilih kota tujuan"
                emptyText="Belum ada kota tujuan lain."
                accent={colors.send} icon="flag-outline"
              />
              {destCity && (
                <Animated.View entering={FadeInDown.duration(motion.base)} style={{ gap: 10 }}>
                  <Dropdown
                    label={via === 'travel' ? `Titik serah terima cadangan di ${destCity.name}` : `Drop point di ${destCity.name}`}
                    title={`Gudang & drop point di ${destCity.name}`}
                    value={destWh?.id ?? null}
                    options={destWhs.map((w) => whOption(w, destCity.lat != null && destCity.lng != null ? { lat: destCity.lat, lng: destCity.lng } : null))}
                    onChange={(v) => setDestWhId(v)}
                    placeholder="Pilih drop point tujuan"
                    emptyText="Belum ada gudang mitra di kota ini."
                    helper={via === 'travel' ? 'Dipakai bila penerima tidak dapat ditemui — paket dititipkan di sini.' : 'Penerima mengambil di sini atau diantar kurir lokal.'}
                    accent={colors.send} icon="storefront"
                  />
                  {via === 'travel' && (
                    <Input label="Alamat lengkap penerima (door to door)" placeholder={`Jalan, nomor, kelurahan di ${destCity.name}`} icon="home-outline" multiline value={destAddress} onChangeText={setDestAddress} />
                  )}
                  {ic && <Badge text={`Tarif antar kota ${rupiah(ic.fare)} · ±${ic.eta_days} hari · ${fmtNum(ic.weight_kg)} kg`} color={colors.info} />}
                </Animated.View>
              )}
            </View>
          </View>
        )}

        {pickup && legDrop && (scope === 'in_city' || destWh) && (
          <Animated.View entering={FadeInDown.duration(motion.base)} layout={LinearTransition.springify().stiffness(300).damping(22)} style={{ gap: 14 }}>
            <Row gap={8} style={{ flexWrap: 'wrap' }}>
              <Badge text={!route ? 'Menghitung rute…' : `${km(route.distance_km)} · ${minutes(route.duration_min)}${scope === 'intercity' ? ' ke gudang' : ''}`} color={colors.info} />
              {fare && <Badge text={`Ongkir ${rupiah(fare.fare + fare.platform_fee + icFare)}`} color={colors.send} />}
            </Row>
            <RoutePreview pickup={pickup} dropoff={legDrop} polyline={route?.coords} accent={colors.send} />
            <View style={s.group}>
              <Text style={font.label}>Penerima</Text>
              <Input placeholder="Nama penerima" icon="person-outline" value={recipient.name} onChangeText={(v) => setRecipient({ ...recipient, name: v })} />
              <Input placeholder="Nomor HP penerima" icon="call-outline" keyboardType="phone-pad" value={recipient.phone} onChangeText={(v) => setRecipient({ ...recipient, phone: v })} />
            </View>
            <SchedulePicker value={when} onChange={setWhen} accent={colors.send} />
            {fare && <View style={s.group}><PriceSummary rows={[{ label: travelPicked ? `Penjemputan paket (${km(fare.distance_km)})` : `Ongkos kurir (${km(fare.distance_km)})`, value: fare.fare }, ...(icFare ? [{ label: `Antar kota ${originCity?.name} → ${destCity?.name}`, value: icFare }] : []), { label: 'Biaya layanan', value: fare.platform_fee }, { label: 'Diskon promo', value: discount, minus: true }]} total={total} />{scope === 'in_city' && <LimitInfo limit={fare.limit} service="send" />}</View>}
            <PaymentSection method={method} onMethod={setMethod} promo={promo} onPromo={setPromo} notes={notes} onNotes={setNotes} subtotal={fare?.fare ?? 0} service="send" onDiscount={setDiscount} notesPlaceholder="Catatan (mis. titip di satpam)" />
            <Text style={font.tiny}>Barang terlarang: narkoba, senjata, hewan hidup, barang mudah terbakar. Maks. nilai barang Rp2.000.000.{scope === 'intercity' ? (travelPicked ? ' Titipan mitra travel: paket wajib bisa dibuka saat serah terima, tanpa barang bernilai tinggi.' : ' Paket antar kota diasuransikan s.d. Rp1.000.000.') : ''}</Text>
          </Animated.View>
        )}
        </>}
      </View>
    </Screen>
  );
}

function dist(a: { lat: number; lng: number }, b: { lat: number | null; lng: number | null }) { return Math.hypot(a.lat - (b.lat ?? 0), a.lng - (b.lng ?? 0)); }
const fmtNum = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',');

function ScopeBtn({ active, onPress, icon, title, sub }: { active: boolean; onPress: () => void; icon: string; title: string; sub: string }) {
  return (
    <PressableScale onPress={onPress} scaleTo={0.97} style={[s.scope, active && { borderColor: colors.send, backgroundColor: colors.send + '12' }]}>
      <Ionicons name={icon as never} size={20} color={active ? colors.send : colors.textSecondary} />
      <View style={{ flex: 1, minWidth: 0 }}><Text style={{ fontWeight: '800', color: colors.text, fontSize: 14 }}>{title}</Text><Text style={font.tiny} numberOfLines={1}>{sub}</Text></View>
    </PressableScale>
  );
}

/** Kartu pilihan jalur pengiriman antar kota (gudang vs titipan mitra travel). */
function RouteCard({ active, onPress, icon, title, sub, meta, color = colors.send, disabled, note }: {
  active: boolean; onPress: () => void; icon: string; title: string; sub: string; meta: string; color?: string; disabled?: boolean; note?: string;
}) {
  return (
    <PressableScale onPress={() => { if (!disabled) onPress(); }} disabled={disabled} scaleTo={0.985} style={[s.routeCard, active && !disabled && { borderColor: color, backgroundColor: color + '10' }]}>
      <Row gap={10} style={{ alignItems: 'flex-start' }}>
        <View style={[s.routeIcon, { backgroundColor: (disabled ? colors.textMuted : color) + '1A' }]}>
          <Ionicons name={icon as never} size={18} color={disabled ? colors.textMuted : color} />
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Row between gap={8}>
            <Text style={{ fontWeight: '800', color: colors.text, fontSize: 14, flex: 1 }} numberOfLines={1}>{title}</Text>
            {active && !disabled ? <Ionicons name="checkmark-circle" size={18} color={color} /> : null}
          </Row>
          <Text style={font.tiny}>{sub}</Text>
          <Text style={[font.tiny, { color: colors.textSecondary, fontWeight: '700' }]}>{meta}</Text>
          {note ? <Text style={[font.tiny, { color: disabled ? colors.danger : colors.textMuted }]}>{note}</Text> : null}
        </View>
      </Row>
    </PressableScale>
  );
}

const s = StyleSheet.create({
  hero: { backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: radius.lg, padding: 12, borderWidth: 1, borderColor: glass.border },
  scope: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: radius.lg, borderWidth: 1.5, borderColor: glass.border, backgroundColor: 'rgba(255,255,255,0.92)' },
  group: { gap: 10, backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: radius.lg, padding: 12, borderWidth: 1, borderColor: glass.border },
  routeCard: { padding: 12, borderRadius: radius.md, borderWidth: 1.5, borderColor: glass.border, backgroundColor: '#FFFFFF' },
  routeIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  needBox: { alignItems: 'center', padding: 10, borderRadius: radius.md, borderWidth: 1 },
  overBox: { backgroundColor: colors.dangerLight, borderRadius: radius.md, padding: 12, borderWidth: 1, borderColor: colors.danger + '33' },
});
