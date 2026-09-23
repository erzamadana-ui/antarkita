// AntarRide / AntarCar — alur pemesanan "form dulu" (tahap 5):
//  layanan dikunci sesuai pilihan di beranda; peta disembunyikan (ikon peta per baris untuk titik presisi);
//  tujuan terakhir & sering dikunjungi; kelas kendaraan (hemat/standar/premium/listrik); booking terjadwal; iklan merchant.
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import { Screen, Button, Row, Badge, toast } from '@/components/ui';
import { PressableScale } from '@/components/motion';
import { LocationFields } from '@/components/LocationField';
import { DestinationSuggestions, VehicleClassPicker, SchedulePicker, MerchantAds, RoutePreview } from '@/components/BookingExtras';
import { PaymentSection, PriceSummary, paidViaOf, handleShortfall, goAfterOrder, useCheckoutFees, checkoutRows, checkoutNote, type PayChoice } from '@/components/BookingSheet';
import { ServiceArt } from '@/components/ServiceArt';
import { AntarNowSection, useAntarNowCode } from '@/components/antarnow';
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
import { rupiah, minutes, km } from '@/lib/format';
import { serviceDef } from '@/lib/services';
import type { FareOptions, PromoFunder, ServiceType } from '@/lib/types';

export default function RideScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ service?: string }>();
  const service: ServiceType = params.service === 'ride_car' ? 'ride_car' : 'ride_motor';
  const def = serviceDef(service);
  const accent = def.color;
  const { pickup, dropoff, setPickup, setDropoff } = useBooking();
  const { location, hasFix, refresh } = useCurrentLocation();
  // Gerbang wilayah: dinilai dari TITIK JEMPUT (sama seperti yang diperiksa create_order),
  // jatuh ke lokasi GPS selama titik jemput belum dipilih.
  const { status: city, blocked: cityBlockedFor } = useCityStatus(pickup ?? (hasFix ? location : null));
  const cityBlocked = cityBlockedFor(service);
  const refreshWallet = useAuth((s) => s.refreshWallet);
  const { isEnabled } = useAppSettings();
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
  const [showDetails, setShowDetails] = useState(false);
  const [ordering, setOrdering] = useState(false);
  // Kenapa ada: fare_options pernah gagal diam-diam (.catch(() => null)) sehingga layar
  // berakhir tanpa daftar kelas DAN tanpa tombol pesan — pelanggan buntu tanpa penjelasan.
  // Sekarang galatnya disimpan, ditampilkan, dan bisa dicoba ulang.
  const [fareErr, setFareErr] = useState<string | null>(null);
  const [fareTry, setFareTry] = useState(0);
  // AntarNow (Tahap 11): kode driver yang sudah divalidasi & cocok dengan layanan ini (null bila tidak dipakai)
  const driverCode = useAntarNowCode(service);

  useEffect(() => {
    if (!pickup && hasFix) reverseGeocode(location).then((address) => { if (!useBooking.getState().pickup) setPickup({ ...location, address, name: 'Lokasi saya' }); });
  }, [hasFix]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!pickup || !dropoff) { setRoute(null); setOpts(null); setFareErr(null); setLoading(false); return; }
    let cancelled = false;
    (async () => {
      setLoading(true); setFareErr(null);
      try {
        const r = await getRoute(pickup, dropoff);
        if (cancelled) return;
        setRoute(r);
        let o: FareOptions | null = null;
        try { o = await rpc<FareOptions>('fare_options', { p_service: service, p_pickup_lat: pickup.lat, p_pickup_lng: pickup.lng, p_drop_lat: dropoff.lat, p_drop_lng: dropoff.lng, p_route_km: r.distance_km, p_helpers: 0 }); }
        catch (e) { if (!cancelled) setFareErr((e as Error)?.message || 'Tarif tidak dapat dimuat'); }
        if (cancelled) return;
        setOpts(o);
        const classes = o?.classes ?? [];
        if (o && classes.length === 0) setFareErr('Server tidak mengirim satu pun kelas kendaraan untuk layanan ini.');
        if (o && !classes.some((c) => c.code === cls)) {
          // Default: kelas Standar bila ada driver di sekitar; jika tidak, kelas pertama yang punya driver; terakhir kelas Standar
          const std = classes.find((c) => c.rank === 2 && !c.is_ev);
          const withDriver = (std && (std.drivers_nearby ?? 0) > 0) ? std : classes.find((c) => (c.drivers_nearby ?? 0) > 0 && !c.is_ev);
          setCls((withDriver ?? std ?? classes[0])?.code ?? null);
        }
      } finally {
        // Selalu lepaskan status memuat (juga saat ada galat tak terduga) agar tombol "Coba lagi" tidak macet.
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [pickup?.lat, pickup?.lng, dropoff?.lat, dropoff?.lng, service, fareTry]); // eslint-disable-line react-hooks/exhaustive-deps

  const chosen = useMemo(() => opts?.classes.find((c) => c.code === cls) ?? null, [opts, cls]);
  // §9: biaya platform dari fare_options (customer_platform_fee, 0099) — bukan konstanta klien
  const platformFee = opts?.customer_platform_fee ?? opts?.platform_fee ?? 0;
  const baseTotal = chosen ? Math.max(0, chosen.fare + platformFee - discount) : 0;
  const fees = useCheckoutFees({ service, method, ewallet: payPrefs?.ewallet, amount: baseTotal });
  const total = chosen ? baseTotal + fees.payFee : 0;
  // Batas jarak dalam kota & status layanan dari server (create_order juga menolak, ini agar pelanggan tahu lebih awal)
  const blocked = limitBlocked(opts?.limit);
  const serviceOff = opts?.service_enabled === false || !isEnabled(service);

  const order = async () => {
    if (!pickup || !dropoff || !chosen || blocked || serviceOff || cityBlocked) return;
    setOrdering(true);
    try {
      // Hemat §5.3: rute sungguhan (GEOMETRI saja) baru diambil DI SINI — saat pengguna
      // benar-benar memesan. Jarak/durasi yang dikirim tetap angka pratinjau yang menjadi
      // dasar harga yang sudah dilihat pengguna, supaya tagihan == yang ditampilkan.
      const fin = await finalizeRoute(pickup, dropoff, route);
      const o = await createOrder({
        service, pickup: { lat: pickup.lat, lng: pickup.lng, address: pickup.address }, dropoff: { lat: dropoff.lat, lng: dropoff.lng, address: dropoff.address },
        route_km: fin.route_km, duration_min: fin.duration_min, route_geometry: fin.coords,
        payment_method: method === 'ewallet' ? 'wallet' : method, paid_via: paidViaOf(method, payPrefs?.ewallet), promo_code: promo || null, notes: notes || null,
        vehicle_class: chosen.code, scheduled_at: when ? when.toISOString() : null, driver_code: driverCode,
      });
      await refreshWallet();
      useBooking.getState().reset();
      goAfterOrder(router, o, when ? 'Booking terjadwal tersimpan' : 'Pesanan dibuat, mencari driver…');
    } catch (e) { if (!handleShortfall(e, router, payPrefs?.ewallet)) toast.error((e as Error).message); }
    finally { setOrdering(false); }
  };

  const ready = !!(pickup && dropoff);
  // Tarif "sedang dalam proses" juga mencakup frame pertama sebelum efek sempat menyalakan `loading`,
  // supaya panel/tombol galat tidak berkedip saat layar dibuka dengan kedua titik sudah terisi.
  const farePending = loading || (ready && !opts && !fareErr);
  return (
    <Screen title={def.label} subtitle={def.id === 'ride_car' ? 'Mobil · 1–4 penumpang' : 'Ojek motor · cepat & hemat'} band={def.color} back maxWidth={640} footer={ready && !serviceOff ? (
      <View style={{ gap: 10 }}>
        <LimitNotice limit={opts?.limit} actionTitle="Buka AntarTravel" actionIcon="bus-outline" onAction={() => router.push('/travel' as never)} />
        {cityBlocked ? (
          // Kota diblokir: keterangan wilayah menang atas tombol pesan maupun tombol coba-ulang.
          <Button title={cityBlockedLabel(city, service)} size="lg" color={accent} disabled />
        ) : chosen ? (
          <Button title={blocked ? 'Di luar jangkauan layanan' : `${when ? 'Booking' : 'Pesan'} ${chosen.label} · ${rupiah(total)}`} size="lg" color={accent} loading={ordering} disabled={farePending || blocked} onPress={order} />
        ) : (
          // Tarif belum ada: tombol TETAP tampil supaya layar tidak terlihat buntu, dan
          // menjadi tombol coba-ulang, bukan tombol mati tanpa keterangan.
          <Button title={farePending ? 'Menghitung tarif…' : 'Tarif gagal dimuat · Coba lagi'} size="lg" color={accent} loading={farePending} disabled={farePending} onPress={() => setFareTry((n) => n + 1)} />
        )}
      </View>
    ) : undefined}>
      <View style={{ gap: 14 }}>
        {serviceOff && <ServiceDisabledEmpty onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))} />}
        {/* Muncul PALING AWAL agar pelanggan tidak mengisi seluruh alur lalu gagal di akhir.
            Menelusuri tarif & tujuan tetap boleh — hanya tombol pesan yang dikunci. */}
        {!serviceOff && <CityNotice status={city} service={service} />}
        {!serviceOff && <>
        <Row gap={12} style={s.hero}>
          <ServiceArt kind={def.art} color={accent} size={54} glow={false} />
          <View style={{ flex: 1 }}>
            <Text style={font.h3}>{service === 'ride_car' ? 'Mobil nyaman, pilih kelas sesuai kebutuhan' : 'Ojek motor cepat & hemat'}</Text>
            <Text style={font.tiny}>{service === 'ride_car' ? 'Hemat · Standar · Premium · Listrik' : 'Hemat · Standar · Listrik'} · bisa booking terjadwal</Text>
          </View>
        </Row>

        <LocationFields pickup={pickup} dropoff={dropoff} accent={accent} />
        <Row gap={8}>
          <PressableScale onPress={async () => { const p = await refresh(); if (p) { const a = await reverseGeocode(p); setPickup({ ...p, address: a, name: 'Lokasi saya' }); } }} scaleTo={0.96} style={s.smallBtn}><Ionicons name="locate" size={16} color={colors.info} /><Text style={s.smallBtnText}>Lokasi saya</Text></PressableScale>
          {pickup && dropoff && <PressableScale onPress={() => { const p = pickup; setPickup(dropoff); setDropoff(p); }} scaleTo={0.96} style={s.smallBtn}><Ionicons name="swap-vertical" size={16} color={colors.info} /><Text style={s.smallBtnText}>Tukar</Text></PressableScale>}
        </Row>

        {!dropoff && <DestinationSuggestions onPick={(p) => setDropoff(p)} service={service} />}
        </>}

        {ready && !serviceOff && (
          <Animated.View entering={FadeInDown.duration(motion.base)} layout={LinearTransition.springify().stiffness(300).damping(22)} style={{ gap: 14 }}>
            <Row gap={8} style={{ flexWrap: 'wrap' }}>
              <Badge text={loading || !route ? 'Menghitung rute…' : `${km(route.distance_km)} · ${minutes(route.duration_min)}${route.estimated ? ' (perkiraan)' : ''}`} color={colors.info} />
              {opts?.session && opts.session.multiplier !== 1 && <Badge text={`${opts.session.level === 'high' ? 'Jam sibuk' : 'Jam sepi'} ${opts.session.multiplier}×`} color={opts.session.level === 'high' ? colors.danger : colors.success} />}
            </Row>
            <RoutePreview pickup={pickup} dropoff={dropoff} polyline={route?.coords} accent={accent} />
            <VehicleClassPicker options={opts?.classes ?? []} value={cls} onChange={setCls} accent={accent} loading={loading} />
            {!farePending && !chosen && (
              <View style={s.fareErr}>
                <Row gap={8}><Ionicons name="alert-circle" size={18} color={colors.warning} /><Text style={{ fontWeight: '700', color: colors.text }}>Tarif belum bisa ditampilkan</Text></Row>
                <Text style={font.tiny}>{fareErr ?? 'Daftar kelas kendaraan tidak diterima dari server.'}</Text>
                <Text style={font.tiny}>Tekan “Coba lagi” di tombol bawah. Kalau tetap gagal, keluar lalu masuk kembali ke akun Anda — sesi login yang kedaluwarsa juga memunculkan pesan ini.</Text>
              </View>
            )}
            <SchedulePicker value={when} onChange={setWhen} accent={accent} />
            {chosen && (
              <PressableScale onPress={() => setShowDetails(!showDetails)} scaleTo={0.99} haptic={false}>
                <Animated.View layout={LinearTransition.springify().stiffness(300).damping(22)} style={s.fareBox}>
                  <Row between>
                    <View><Text style={font.label}>Total {when ? 'booking' : 'estimasi'}</Text><Text style={{ fontSize: 24, fontWeight: '700', color: accent, letterSpacing: -0.5 }}>{rupiah(total)}</Text></View>
                    <View style={s.chev}><Ionicons name={showDetails ? 'chevron-up' : 'chevron-down'} size={20} color={colors.textSecondary} /></View>
                  </Row>
                  {showDetails && (
                    <Animated.View entering={FadeInDown.duration(motion.fast)} style={{ marginTop: 10 }}>
                      <PriceSummary total={total} note={checkoutNote(fees.pay, fees.econError)} rows={checkoutRows({
                        service, econ: fees.econ, ongkir: chosen.fare, ongkirLabel: `Ongkir · ${chosen.label} (${km(opts?.distance_km ?? 0)})`,
                        platformFee, pay: fees.pay, discount, promoCode: promo || null, promoFunder,
                      })} />
                    </Animated.View>
                  )}
                  <LimitInfo limit={opts?.limit} service={service} style={{ marginTop: 8 }} />
                </Animated.View>
              </PressableScale>
            )}
            <AntarNowSection service={service} accent={accent} />
            <PaymentSection method={method} onMethod={setMethod} promo={promo} onPromo={setPromo} notes={notes} onNotes={setNotes} subtotal={chosen?.fare ?? 0} service={service} onDiscount={(d, f) => { setDiscount(d); setPromoFunder(f ?? null); }} />
            <MerchantAds near={dropoff} title="Lapar sesampainya? Merchant dekat tujuan" />
          </Animated.View>
        )}
        {!ready && <MerchantAds near={pickup} title="Promo merchant di sekitar Anda" max={4} />}
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  hero: { backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: radius.lg, padding: 12, borderWidth: 1, borderColor: glass.border },
  smallBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.full, backgroundColor: 'rgba(255,255,255,0.92)', borderWidth: 1, borderColor: glass.border },
  smallBtnText: { fontSize: 12, fontWeight: '700', color: colors.info },
  fareBox: { backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: radius.lg, padding: 14, borderWidth: 1, borderColor: glass.border },
  fareErr: { gap: 6, backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: radius.lg, padding: 14, borderWidth: 1, borderColor: colors.warning + '55' },
  chev: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(11,31,42,0.06)', alignItems: 'center', justifyContent: 'center' },
});
