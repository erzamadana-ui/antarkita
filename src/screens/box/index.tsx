// AntarBox — mobil box / pick up untuk kirim barang besar, jemput dari rumah, pindahan rumah/kost (+ pembantu angkat)
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import { Screen, Button, Row, Badge, Input, Chip, Stepper, toast } from '@/components/ui';
import { PressableScale } from '@/components/motion';
import { LocationFields } from '@/components/LocationField';
import { DestinationSuggestions, VehicleClassPicker, SchedulePicker, RoutePreview } from '@/components/BookingExtras';
import { PaymentSection, PriceSummary, paidViaOf, handleShortfall, goAfterOrder, useCheckoutFees, checkoutRows, checkoutNote, type PayChoice } from '@/components/BookingSheet';
import { AntarNowSection, useAntarNowCode } from '@/components/antarnow';
import { ServiceArt } from '@/components/ServiceArt';
import { LimitNotice, LimitInfo, ServiceDisabledEmpty, limitBlocked } from '@/components/ServiceLimit';
import { CityNotice, cityBlockedLabel } from '@/components/city';
import { useAppSettings } from '@/hooks/useAppSettings';
import { useCityStatus } from '@/hooks/useCityStatus';
import { usePayPrefs } from '@/store/payprefs';
import { useBooking } from '@/store/booking';
import { useAuth } from '@/store/auth';
import { useCurrentLocation } from '@/hooks/useLocation';
import { getRoute, reverseGeocode, finalizeRoute, type RouteResult } from '@/lib/geo';
import { rpc } from '@/lib/supabase';
import { createOrder } from '@/lib/orders';
import { colors, font, radius, motion, glass } from '@/lib/theme';
import { rupiah, km, minutes } from '@/lib/format';
import type { FareOptions, PromoFunder } from '@/lib/types';

const PURPOSES = [
  { key: 'barang', label: 'Kirim barang besar', icon: 'cube', desc: 'Lemari, kasur, kulkas, motor, dsb.' },
  { key: 'pindahan_kost', label: 'Pindahan kost', icon: 'bed', desc: '1 kamar · biasanya cukup pick up' },
  { key: 'pindahan_rumah', label: 'Pindahan rumah', icon: 'home', desc: 'Seisi rumah · mobil box + pembantu' },
  { key: 'jemput', label: 'Jemput barang dari rumah', icon: 'arrow-undo', desc: 'Ambil dari alamat, antar ke toko/gudang' },
];

export default function BoxScreen() {
  const router = useRouter();
  const { pickup, dropoff, setPickup, setDropoff } = useBooking();
  const { location, hasFix } = useCurrentLocation();
  // Gerbang wilayah: dinilai dari titik jemput (sama seperti yang diperiksa create_order).
  const { status: city, blocked: cityBlockedFor } = useCityStatus(pickup ?? (hasFix ? location : null));
  const cityBlocked = cityBlockedFor('box');
  const refreshWallet = useAuth((s) => s.refreshWallet);
  const { isEnabled } = useAppSettings();
  const [purpose, setPurpose] = useState(PURPOSES[0].key);
  const [helpers, setHelpers] = useState(0);
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [opts, setOpts] = useState<FareOptions | null>(null);
  const [loading, setLoading] = useState(false);
  const [cls, setCls] = useState<string | null>(null);
  const [when, setWhen] = useState<Date | null>(null);
  const [method, setMethod] = useState<PayChoice>('cash');
  const payPrefs = usePayPrefs((st) => st.prefs);
  const [promo, setPromo] = useState('');
  const [discount, setDiscount] = useState(0);
  const [promoFunder, setPromoFunder] = useState<PromoFunder | null>(null);
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState('');
  const [ordering, setOrdering] = useState(false);
  // Sama seperti AntarRide: fare_options yang gagal tidak boleh membuat layar tanpa tombol.
  const [fareErr, setFareErr] = useState<string | null>(null);
  const [fareTry, setFareTry] = useState(0);

  useEffect(() => {
    if (!pickup && hasFix) reverseGeocode(location).then((address) => { if (!useBooking.getState().pickup) setPickup({ ...location, address, name: 'Lokasi saya' }); });
  }, [hasFix]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (purpose === 'pindahan_rumah' && helpers === 0) setHelpers(2); if (purpose === 'pindahan_kost' && helpers === 0) setHelpers(1); }, [purpose]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!pickup || !dropoff) { setRoute(null); setOpts(null); setFareErr(null); setLoading(false); return; }
    let cancelled = false;
    (async () => {
      setLoading(true); setFareErr(null);
      try {
        const r = route && route.distance_km > 0 ? route : await getRoute(pickup, dropoff);
        if (cancelled) return;
        setRoute(r);
        let o: FareOptions | null = null;
        try { o = await rpc<FareOptions>('fare_options', { p_service: 'box', p_pickup_lat: pickup.lat, p_pickup_lng: pickup.lng, p_drop_lat: dropoff.lat, p_drop_lng: dropoff.lng, p_route_km: r.distance_km, p_helpers: helpers }); }
        catch (e) { if (!cancelled) setFareErr((e as Error)?.message || 'Tarif tidak dapat dimuat'); }
        if (cancelled) return;
        setOpts(o);
        const classes = o?.classes ?? [];
        if (o && classes.length === 0) setFareErr('Server tidak mengirim satu pun kelas kendaraan untuk layanan ini.');
        if (o && !classes.some((c) => c.code === cls)) setCls((purpose === 'pindahan_rumah' ? classes.find((c) => c.code === 'box_van') : classes[0])?.code ?? null);
      } finally {
        // Selalu lepaskan status memuat (juga saat ada galat tak terduga) agar tombol "Coba lagi" tidak macet.
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [pickup?.lat, pickup?.lng, dropoff?.lat, dropoff?.lng, helpers, fareTry]); // eslint-disable-line react-hooks/exhaustive-deps

  const chosen = useMemo(() => opts?.classes.find((c) => c.code === cls) ?? null, [opts, cls]);
  // §9: biaya platform dari fare_options (customer_platform_fee, 0099) — bukan konstanta klien
  const platformFee = opts?.customer_platform_fee ?? opts?.platform_fee ?? 0;
  const baseTotal = chosen ? Math.max(0, chosen.fare + platformFee - discount) : 0;
  const fees = useCheckoutFees({ service: 'box', method, ewallet: payPrefs?.ewallet, amount: baseTotal });
  const total = chosen ? baseTotal + fees.payFee : 0;
  const ready = !!(pickup && dropoff);
  const blocked = limitBlocked(opts?.limit);
  const serviceOff = opts?.service_enabled === false || !isEnabled('box');
  // Tarif "sedang dalam proses" juga mencakup frame pertama sebelum efek sempat menyalakan `loading`,
  // supaya panel/tombol galat tidak berkedip saat layar dibuka dengan kedua titik sudah terisi.
  const farePending = loading || (ready && !opts && !fareErr);

  // AntarNow (Tahap 11): kode driver yang sudah divalidasi & cocok dengan layanan ini (null bila tidak dipakai)
  const driverCode = useAntarNowCode('box');
  const order = async () => {
    if (!pickup || !dropoff || !chosen || blocked || serviceOff || cityBlocked) return;
    setOrdering(true);
    try {
      // Hemat §5.3: rute sungguhan (GEOMETRI saja) baru diambil DI SINI. Jarak/durasi
      // tetap angka pratinjau yang menjadi dasar harga yang ditampilkan.
      const fin = await finalizeRoute(pickup, dropoff, route);
      const o = await createOrder({
        service: 'box', pickup: { lat: pickup.lat, lng: pickup.lng, address: pickup.address }, dropoff: { lat: dropoff.lat, lng: dropoff.lng, address: dropoff.address },
        route_km: fin.route_km, duration_min: fin.duration_min, route_geometry: fin.coords, payment_method: method === 'ewallet' ? 'wallet' : method, paid_via: paidViaOf(method, payPrefs?.ewallet), promo_code: promo || null,
        notes: [items ? `Barang: ${items}` : '', notes].filter(Boolean).join(' · ') || null, vehicle_class: chosen.code, helpers, purpose, scheduled_at: when ? when.toISOString() : null,
        package_details: { type: PURPOSES.find((p) => p.key === purpose)?.label, description: items },
        driver_code: driverCode,
      });
      await refreshWallet(); useBooking.getState().reset();
      goAfterOrder(router, o);
    } catch (e) { if (!handleShortfall(e, router, payPrefs?.ewallet)) toast.error((e as Error).message); }
    finally { setOrdering(false); }
  };

  return (
    <Screen title="AntarBox" subtitle="Mobil box & pick up" band={colors.box} back maxWidth={640} footer={ready && !serviceOff ? (
      <View style={{ gap: 10 }}>
        <LimitNotice limit={opts?.limit} />
        {cityBlocked ? (
          // Kota diblokir: keterangan wilayah menang atas tombol pesan maupun tombol coba-ulang.
          <Button title={cityBlockedLabel(city, 'box')} size="lg" color={colors.box} disabled />
        ) : chosen ? (
          <Button title={blocked ? 'Di luar jangkauan layanan' : `${when ? 'Booking' : 'Pesan'} ${chosen.label}${helpers ? ` + ${helpers} pembantu` : ''} · ${rupiah(total)}`} size="lg" color={colors.box} loading={ordering} disabled={farePending || blocked} onPress={order} />
        ) : (
          // Tarif belum ada: tombol TETAP tampil dan menjadi tombol coba-ulang.
          <Button title={farePending ? 'Menghitung tarif…' : 'Tarif gagal dimuat · Coba lagi'} size="lg" color={colors.box} loading={farePending} disabled={farePending} onPress={() => setFareTry((n) => n + 1)} />
        )}
      </View>
    ) : undefined}>
      <View style={{ gap: 14 }}>
        {serviceOff && <ServiceDisabledEmpty onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))} />}
        {/* Penjelasan muncul di awal layar, bukan sesudah semua kolom diisi. */}
        {!serviceOff && <CityNotice status={city} service="box" />}
        {!serviceOff && <>
        <Row gap={12} style={s.hero}>
          <ServiceArt kind="box" color={colors.box} size={54} glow={false} />
          <View style={{ flex: 1 }}><Text style={font.h3}>Mobil box & pick up</Text><Text style={font.tiny}>Kirim barang besar, jemput dari rumah, pindahan rumah/kost · pembantu angkat opsional</Text></View>
        </Row>
        <View style={s.group}>
          <Text style={font.label}>Keperluan</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {PURPOSES.map((p) => (
              <PressableScale key={p.key} onPress={() => setPurpose(p.key)} scaleTo={0.97} style={[s.purpose, purpose === p.key && { borderColor: colors.box, backgroundColor: colors.box + '12' }]}>
                <Ionicons name={p.icon as never} size={20} color={purpose === p.key ? colors.box : colors.textSecondary} />
                <Text style={{ fontWeight: '700', color: colors.text, fontSize: 14 }}>{p.label}</Text>
                <Text style={font.tiny} numberOfLines={2}>{p.desc}</Text>
              </PressableScale>
            ))}
          </View>
        </View>
        <LocationFields pickup={pickup} dropoff={dropoff} pickupLabel="Ambil / muat dari" dropoffLabel="Antar / bongkar ke" accent={colors.box} />
        {!dropoff && <DestinationSuggestions onPick={(p) => setDropoff(p)} service="box" title="Alamat terakhir" />}
        {ready && (
          <Animated.View entering={FadeInDown.duration(motion.base)} layout={LinearTransition.springify().stiffness(300).damping(22)} style={{ gap: 14 }}>
            <Row gap={8} style={{ flexWrap: 'wrap' }}><Badge text={loading || !route ? 'Menghitung rute…' : `${km(route.distance_km)} · ${minutes(route.duration_min)}`} color={colors.info} /></Row>
            <RoutePreview pickup={pickup} dropoff={dropoff} polyline={route?.coords} accent={colors.box} />
            <VehicleClassPicker options={opts?.classes ?? []} value={cls} onChange={setCls} accent={colors.box} loading={loading} />
            {!farePending && !chosen && (
              <View style={s.fareErr}>
                <Row gap={8}><Ionicons name="alert-circle" size={18} color={colors.warning} /><Text style={{ fontWeight: '700', color: colors.text }}>Tarif belum bisa ditampilkan</Text></Row>
                <Text style={font.tiny}>{fareErr ?? 'Daftar kelas kendaraan tidak diterima dari server.'}</Text>
                <Text style={font.tiny}>Tekan “Coba lagi” di tombol bawah. Kalau tetap gagal, keluar lalu masuk kembali ke akun Anda — sesi login yang kedaluwarsa juga memunculkan pesan ini.</Text>
              </View>
            )}
            <View style={s.group}>
              <Row between>
                <View style={{ flex: 1 }}><Text style={{ fontWeight: '700', color: colors.text }}>Pembantu angkat</Text><Text style={font.tiny}>{opts?.helpers_fee && helpers ? `${rupiah(opts.helpers_fee / helpers)}/orang · ` : ''}bantu muat & bongkar (maks. 3){!helpers ? ' · tarif tampil di rincian' : ''}</Text></View>
                <Stepper value={helpers} onChange={setHelpers} min={0} max={3} />
              </Row>
              <Input placeholder="Daftar barang: mis. kasur 1, lemari 2, kardus 10" icon="list-outline" value={items} onChangeText={setItems} />
            </View>
            <SchedulePicker value={when} onChange={setWhen} accent={colors.box} />
            {chosen && <View style={s.group}><PriceSummary total={total} note={checkoutNote(fees.pay, fees.econError)} rows={checkoutRows({
              service: 'box', econ: fees.econ, ongkir: chosen.fare - (opts?.helpers_fee ?? 0), ongkirLabel: `Ongkir · ${chosen.label} (${km(opts?.distance_km ?? 0)})`,
              extra: opts?.helpers_fee ? [{ label: `Biaya tambahan · pembantu angkat ×${helpers}`, value: opts.helpers_fee, hint: 'Untuk pembantu angkat (muat & bongkar)' }] : undefined,
              platformFee, pay: fees.pay, discount, promoCode: promo || null, promoFunder,
            })} /><LimitInfo limit={opts?.limit} service="box" /></View>}
            <AntarNowSection service="box" accent={colors.box} />
            <PaymentSection method={method} onMethod={setMethod} promo={promo} onPromo={setPromo} notes={notes} onNotes={setNotes} subtotal={chosen?.fare ?? 0} service="box" feeBase={baseTotal} onDiscount={(d, f) => { setDiscount(d); setPromoFunder(f ?? null); }} notesPlaceholder="Catatan: lantai berapa, ada lift, jam bongkar" />
            <Text style={font.tiny}>Driver membantu muat/bongkar ringan. Barang pecah belah harap dikemas. Pick up ±1 ton, mobil box ±2 ton.</Text>
          </Animated.View>
        )}
        </>}
      </View>
    </Screen>
  );
}
const s = StyleSheet.create({
  hero: { backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: radius.lg, padding: 12, borderWidth: 1, borderColor: glass.border },
  group: { gap: 10, backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: radius.lg, padding: 12, borderWidth: 1, borderColor: glass.border },
  purpose: { flexBasis: '46%', flexGrow: 1, minWidth: 150, gap: 3, padding: 10, borderRadius: radius.md, borderWidth: 1.5, borderColor: glass.border, backgroundColor: 'rgba(255,255,255,0.92)' },
  fareErr: { gap: 6, backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: radius.lg, padding: 14, borderWidth: 1, borderColor: colors.warning + '55' },
});
