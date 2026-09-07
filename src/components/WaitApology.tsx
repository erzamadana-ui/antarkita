// Blok "permohonan maaf" saat pesanan menunggu driver lebih lama dari ambang admin
// (`app_public_settings().wait_apology_minutes`). Muncul otomatis di layar pelacakan saat status `searching`.
// Isi: animasi ringan, permintaan maaf + jaminan pencarian diperluas, hitungan waktu tunggu (mm:ss),
// tips, rotasi "tahukah kamu" tiap 8 detik, dan 3 tombol (tetap tunggu / ubah layanan / batalkan).
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { FadeIn, FadeInDown, FadeOut, LinearTransition } from 'react-native-reanimated';
import { Button, Row } from '@/components/ui';
import { Radar } from '@/components/motion';
import { useBooking } from '@/store/booking';
import { serviceDef } from '@/lib/services';
import { colors, font, motion, radius, shadow } from '@/lib/theme';
import type { Order } from '@/lib/types';

/** Rotasi hiburan ringan — fakta singkat tentang layanan AntarKita. */
const FACTS: string[] = [
  'AntarSend antar kota bisa dititipkan ke mitra AntarTravel — paket ikut mobil travel, sampai lebih cepat.',
  'AntarBox menyediakan mobil box & pick up plus pembantu angkat untuk pindahan kost dan rumah.',
  'AntarMarket membelikan bahan masak dari pasar tradisional terdekat, harganya mengikuti acuan pasar.',
  'AntarShop bisa memesan dari Indomaret, Alfamart, apotek, sampai supermarket langganan Anda.',
  'Saldo AntarPay bisa diisi lewat QRIS, e-wallet, atau transfer manual dengan bukti bayar.',
  'Perjalanan Anda bisa dibagikan ke keluarga lewat tombol Bagikan di pusat keamanan.',
  'AntarRide & AntarCar bisa dipesan terjadwal — atur jam jemput dari sekarang.',
  'Nomor HP Anda disamarkan; panggilan ke driver berjalan lewat aplikasi.',
];
const FACT_MS = 8000;

const mmss = (ms: number) => {
  const t = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};

/** Waktu mulai pencarian: booking terjadwal baru mulai dicari pada jam jadwalnya. */
function searchStartedAt(order: Order): number {
  const created = new Date(order.created_at).getTime();
  const sched = order.scheduled_at ? new Date(order.scheduled_at).getTime() : 0;
  return Math.max(created, Math.min(sched || created, Date.now()));
}

export function WaitApology({ order, thresholdMinutes, onCancel }: { order: Order; thresholdMinutes: number; onCancel: () => void }) {
  const router = useRouter();
  const startedAt = useMemo(() => searchStartedAt(order), [order.id, order.created_at, order.scheduled_at]); // eslint-disable-line react-hooks/exhaustive-deps
  const [now, setNow] = useState(() => Date.now());
  const [factIdx, setFactIdx] = useState(0);
  // "Tetap tunggu" hanya meringkas blok untuk satu periode ambang berikutnya (tanpa penyimpanan lokal).
  const [snoozeUntil, setSnoozeUntil] = useState(0);

  const searching = order.status === 'searching';
  useEffect(() => {
    if (!searching) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [searching]);
  useEffect(() => {
    if (!searching) return;
    const t = setInterval(() => setFactIdx((i) => (i + 1) % FACTS.length), FACT_MS);
    return () => clearInterval(t);
  }, [searching]);

  if (!searching) return null;
  const elapsed = now - startedAt;
  const thresholdMs = Math.max(1, thresholdMinutes) * 60_000;
  if (elapsed < thresholdMs) return null;

  const def = serviceDef(order.service);
  const isRide = order.service === 'ride_motor' || order.service === 'ride_car' || order.service === 'box';
  const changeTitle = isRide ? 'Naikkan kelas kendaraan' : 'Ubah layanan / pesan ulang';

  const rebook = () => {
    const b = useBooking.getState();
    b.setDropoff({ lat: order.dropoff_lat, lng: order.dropoff_lng, address: order.dropoff_address, name: order.dropoff_address.split(',')[0] });
    if (order.service !== 'shop' && order.service !== 'market') {
      b.setPickup({ lat: order.pickup_lat, lng: order.pickup_lng, address: order.pickup_address, name: order.pickup_address.split(',')[0] });
    }
    if (order.service === 'food' && order.merchant_id) { router.push(`/food/${order.merchant_id}` as never); return; }
    router.push(def.route as never);
  };

  if (now < snoozeUntil) {
    return (
      <Animated.View entering={FadeIn.duration(motion.base)} exiting={FadeOut.duration(motion.fast)} layout={LinearTransition} style={s.compact}>
        <Ionicons name="time-outline" size={18} color={colors.warning} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.compactTitle} numberOfLines={1}>Kami terus mencarikan driver · {mmss(elapsed)}</Text>
          <Text style={font.tiny} numberOfLines={2}>Pencarian sudah diperluas ke radius lebih jauh. Anda akan diberi tahu begitu ada yang menerima.</Text>
        </View>
      </Animated.View>
    );
  }

  return (
    <Animated.View entering={FadeInDown.duration(motion.slow)} exiting={FadeOut.duration(motion.fast)} layout={LinearTransition} style={s.card}>
      <Row gap={12} style={{ alignItems: 'flex-start' }}>
        <Radar color={colors.warning} size={62}><Ionicons name="hourglass-outline" size={18} color={colors.warning} /></Radar>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text style={[font.h3, { color: colors.text }]}>Maaf, pencarian agak lama</Text>
          <Text style={[font.small, { color: colors.text }]}>
            Kami minta maaf atas waktu tunggu Anda. Pencarian sudah kami perluas ke radius lebih jauh dan ke lebih banyak driver {def.label} — pesanan Anda tetap diprioritaskan.
          </Text>
        </View>
      </Row>

      <Row between style={s.timerRow}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={font.label}>Sudah menunggu</Text>
          <Text style={font.tiny} numberOfLines={1}>Ambang pemberitahuan {Math.max(1, Math.round(thresholdMinutes))} menit</Text>
        </View>
        <Text style={s.timer}>{mmss(elapsed)}</Text>
      </Row>

      <Row gap={8} style={s.tip}>
        <Ionicons name="bulb-outline" size={16} color={colors.warning} />
        <Text style={[font.tiny, { flex: 1, color: colors.text }]}>Tips: driver di jam sibuk biasanya butuh 3–8 menit. Menunggu sebentar lagi sering lebih cepat daripada memesan ulang.</Text>
      </Row>

      <View style={s.fact}>
        <Row gap={8} style={{ alignItems: 'flex-start' }}>
          <Ionicons name="sparkles-outline" size={16} color={colors.primary} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={font.label}>Tahukah kamu</Text>
            <Animated.Text key={factIdx} entering={FadeIn.duration(motion.slow)} style={[font.tiny, { color: colors.text }]}>{FACTS[factIdx]}</Animated.Text>
          </View>
        </Row>
      </View>

      <View style={{ gap: 8 }}>
        <Button title="Tetap tunggu" icon="checkmark-circle-outline" color={colors.warning} onPress={() => { setSnoozeUntil(Date.now() + thresholdMs); setNow(Date.now()); }} />
        <Button title={changeTitle} icon="swap-horizontal-outline" variant="secondary" onPress={rebook} />
        <Button title="Batalkan pesanan" icon="close-circle-outline" variant="outline" color={colors.danger} onPress={onCancel} />
      </View>
      <Text style={font.tiny}>Bila Anda memesan ulang lewat layanan lain, pesanan ini tetap dicarikan driver sampai Anda membatalkannya.</Text>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  card: { gap: 12, padding: 16, borderRadius: radius.lg, backgroundColor: colors.accentLight, borderWidth: 1, borderColor: colors.accent + '55', ...shadow.soft },
  timerRow: { backgroundColor: '#fff', borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: colors.accent + '33', gap: 10 },
  timer: { fontSize: 26, fontWeight: '800', color: colors.warning, letterSpacing: -0.5, fontVariant: ['tabular-nums'] },
  tip: { alignItems: 'flex-start' },
  fact: { backgroundColor: '#fff', borderRadius: radius.md, padding: 12, borderWidth: 1, borderColor: colors.border },
  compact: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: radius.lg, backgroundColor: colors.accentLight, borderWidth: 1, borderColor: colors.accent + '44' },
  compactTitle: { fontSize: 13.5, fontWeight: '800', color: colors.text },
});
