// Komponen kecil khusus aplikasi Mitra (Tahap 9):
// - RejectOrderSheet : bottom-sheet alasan singkat saat driver menolak order (driver_reject_order)
// - PriorityCard     : kartu antrean prioritas berdasarkan rating (driver_priority_info)
// - OrderLoadInfo    : baris info muatan (berat / ukuran) & lama order menunggu pada kartu order
// - VehicleServiceMatrix : ringkasan layanan yang bisa diambil kendaraan driver (matriks kontrak bagian B)
// - usePickupRadiusText  : teks radius jemput dinamis dari app_public_settings().pickup_radius_km
import React, { useState } from 'react';
import { View, Text, StyleSheet, Modal, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeIn, FadeInDown, FadeOut } from 'react-native-reanimated';
import { Row, Badge, Button, Chip, Input } from '@/components/ui';
import { PressableScale, ProgressBar } from '@/components/motion';
import { useAppSettings } from '@/hooks/useAppSettings';
import { colors, font, radius, shadow, motion } from '@/lib/theme';
import type { AvailableOrder, DriverPriorityInfo, SendLimits, ServiceType, VehicleType } from '@/lib/types';

/** Angka ramah Indonesia: 5 → "5", 7.5 → "7,5". */
const numId = (v: number) => (Math.round(v * 10) / 10).toString().replace('.', ',');

// ---------------------------------------------------------------- Tolak order
const REASONS = ['Terlalu jauh', 'Muatan berat/besar', 'Arah berlawanan', 'Sedang istirahat', 'Lainnya'] as const;

/** Bottom-sheet alasan menolak order. Alasan opsional — driver boleh langsung melewati order. */
export function RejectOrderSheet({ visible, order, onClose, onConfirm }: {
  visible: boolean; order: AvailableOrder | null; onClose: () => void; onConfirm: (reason: string | null) => Promise<void> | void;
}) {
  const [pick, setPick] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const close = () => { if (busy) return; setPick(null); setNote(''); onClose(); };
  const submit = async () => {
    const reason = [pick, note.trim() || null].filter(Boolean).join(' — ') || null;
    setBusy(true);
    try { await onConfirm(reason); setPick(null); setNote(''); } finally { setBusy(false); }
  };
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <Pressable onPress={close} style={s.backdrop}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ width: '100%', maxWidth: 520 }}>
        <Pressable onPress={() => {}}>
          <Animated.View entering={FadeInDown.duration(motion.base)} style={s.sheet}>
            <View style={s.handle} />
            <Text style={font.h3}>Lewati order ini?</Text>
            <Text style={[font.small, { marginTop: 2 }]}>
              {order ? `${order.code} · ` : ''}Order tidak akan muncul lagi untuk Anda. Tidak ada penalti — alasan membantu kami memperbaiki penyaluran order.
            </Text>
            <Row gap={8} style={{ flexWrap: 'wrap', marginTop: 12 }}>
              {REASONS.map((r) => <Chip key={r} label={r} active={pick === r} onPress={() => setPick(pick === r ? null : r)} />)}
            </Row>
            <Input placeholder="Catatan tambahan (opsional)" value={note} onChangeText={setNote} containerStyle={{ marginTop: 12 }} />
            <Row gap={8} style={{ marginTop: 14 }}>
              <Button title="Batal" variant="ghost" onPress={close} style={{ flex: 1 }} />
              <Button title="Tolak" variant="danger" icon="close-circle-outline" loading={busy} onPress={submit} style={{ flex: 1 }} />
            </Row>
          </Animated.View>
        </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

// ------------------------------------------------------------ Kartu prioritas
const TIPS = [
  'Terima order yang sesuai kendaraan Anda & datang tepat waktu.',
  'Sapa pelanggan, konfirmasi alamat, jaga kebersihan kendaraan.',
  'Kabari bila terlambat; jangan minta pelanggan membatalkan order.',
];

/** Kartu ringkas antrean prioritas: rating, jeda melihat order, target naik tingkat, tips & skema tingkatan. */
export function PriorityCard({ info }: { info: DriverPriorityInfo | null }) {
  const [open, setOpen] = useState(false);
  if (!info) return null;
  const delay = Math.max(0, Math.round(Number(info.tier_delay_s) || 0));
  const rating = Number(info.rating) || 0;
  const next = info.next_tier_rating == null ? null : Number(info.next_tier_rating);
  const gap = next == null ? null : Math.max(0, Math.round((next - rating) * 100) / 100);
  const tiers = [...(info.tiers ?? [])].sort((a, b) => Number(b.min_rating) - Number(a.min_rating));
  return (
    <Animated.View entering={FadeIn.duration(motion.base)} style={s.card}>
      <PressableScale onPress={() => setOpen(!open)} scaleTo={0.99} haptic={false}>
        <Row gap={12}>
          <View style={[s.icon, { backgroundColor: (delay === 0 ? colors.success : colors.accent) + '1A' }]}>
            <Ionicons name={delay === 0 ? 'flash' : 'time-outline'} size={20} color={delay === 0 ? colors.success : colors.accent} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Row gap={4}>
              <Ionicons name="star" size={13} color={colors.accent} />
              <Text style={[font.body, { fontWeight: '800' }]}>{rating.toFixed(1).replace('.', ',')}</Text>
              <Text style={font.tiny}>· {info.rating_count} ulasan</Text>
            </Row>
            <Text style={[font.small, { color: colors.text }]} numberOfLines={2}>
              {delay === 0 ? 'Anda dapat order paling awal.' : `Anda melihat order ${delay} detik setelah driver rating tertinggi.`}
            </Text>
          </View>
          <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} />
        </Row>
      </PressableScale>
      <Row gap={6} style={{ flexWrap: 'wrap', marginTop: 10 }}>
        <Badge text={delay === 0 ? 'Prioritas tertinggi' : `Antre ${delay} dtk`} color={delay === 0 ? colors.success : colors.accent} />
        {info.drivers_ahead > 0 && <Badge text={`${info.drivers_ahead} driver di depan Anda`} color={colors.info} />}
        {info.is_new_driver && <Badge text="Mitra baru" color={colors.primary} />}
      </Row>
      {next != null && (
        <View style={{ marginTop: 10, gap: 6 }}>
          <Row between>
            <Text style={font.tiny}>{gap && gap > 0 ? `Kurang ${numId(gap)} poin lagi menuju rating ${numId(next)}` : `Target tingkat berikutnya: rating ${numId(next)}`}</Text>
            <Text style={[font.tiny, { fontWeight: '700', color: colors.primary }]}>{rating.toFixed(1).replace('.', ',')} / {numId(next)}</Text>
          </Row>
          <ProgressBar progress={Math.min(1, next > 0 ? rating / next : 0)} color={colors.primary} height={6} />
        </View>
      )}
      {open && (
        <Animated.View entering={FadeInDown.duration(motion.base)} exiting={FadeOut.duration(motion.fast)} style={{ gap: 8, marginTop: 12 }}>
          <Text style={font.label}>Skema tingkatan</Text>
          <View style={s.tierBox}>
            {tiers.length === 0 && <Text style={font.tiny}>Skema tingkatan belum diatur admin.</Text>}
            {tiers.map((t, i) => {
              const d = Math.max(0, Math.round(Number(t.delay_s) || 0));
              const mine = d === delay;
              return (
                <Row key={i} between style={{ paddingVertical: 3 }}>
                  <Row gap={6} style={{ flex: 1, minWidth: 0 }}>
                    <Ionicons name={mine ? 'ellipse' : 'ellipse-outline'} size={9} color={mine ? colors.primary : colors.textMuted} />
                    <Text style={[font.small, mine && { color: colors.text, fontWeight: '700' }]} numberOfLines={1}>
                      Rating {Number(t.min_rating) > 0 ? `≥ ${numId(Number(t.min_rating))}` : 'di bawah itu'}
                    </Text>
                  </Row>
                  <Text style={[font.tiny, mine && { color: colors.primary, fontWeight: '700' }]}>{d === 0 ? 'langsung' : `+${d} dtk`}</Text>
                </Row>
              );
            })}
          </View>
          <Text style={font.label}>Tips menaikkan rating</Text>
          {TIPS.map((t) => (
            <Row key={t} gap={8} style={{ alignItems: 'flex-start' }}>
              <Ionicons name="checkmark-circle" size={14} color={colors.success} style={{ marginTop: 2 }} />
              <Text style={[font.small, { flex: 1 }]}>{t}</Text>
            </Row>
          ))}
          {info.is_new_driver && <Text style={font.tiny}>Mitra baru dianggap rating menengah sampai terkumpul 5 ulasan.</Text>}
        </Animated.View>
      )}
    </Animated.View>
  );
}

// ------------------------------------------------------- Info muatan & antrean
/** Baris kecil: berat & sisi terpanjang paket (AntarSend/AntarBox) + lama order menunggu. */
export function OrderLoadInfo({ order, style }: { order: Pick<AvailableOrder, 'service' | 'weight_kg' | 'parcel_size_cm' | 'waiting_minutes'>; style?: object }) {
  const parcel = order.service === 'send' || order.service === 'box';
  const kg = parcel && order.weight_kg != null ? Number(order.weight_kg) : null;
  const cm = parcel && order.parcel_size_cm != null ? Number(order.parcel_size_cm) : null;
  const wait = order.waiting_minutes != null ? Math.max(0, Math.round(Number(order.waiting_minutes))) : null;
  const bits: { icon: React.ComponentProps<typeof Ionicons>['name']; text: string; warn?: boolean }[] = [];
  if (kg != null && kg > 0) bits.push({ icon: 'barbell-outline', text: `${numId(kg)} kg` });
  if (cm != null && cm > 0) bits.push({ icon: 'resize-outline', text: `sisi ${numId(cm)} cm` });
  if (wait != null && wait >= 1) bits.push({ icon: 'hourglass-outline', text: `menunggu ${wait} mnt`, warn: wait >= 5 });
  if (bits.length === 0) return null;
  return (
    <Row gap={6} style={[{ flexWrap: 'wrap' }, style]}>
      {bits.map((b) => (
        <Row key={b.text} gap={4} style={[s.pill, b.warn && { backgroundColor: colors.accentLight, borderColor: colors.accent + '33' }]}>
          <Ionicons name={b.icon} size={11} color={b.warn ? colors.warning : colors.textSecondary} />
          <Text style={[font.tiny, b.warn && { color: colors.warning, fontWeight: '700' }]}>{b.text}</Text>
        </Row>
      ))}
    </Row>
  );
}

// ------------------------------------------- Matriks layanan ↔ kendaraan mitra
type Verdict = { ok: boolean; note?: string };
const BIG = (v: VehicleType) => v === 'box' || v === 'pickup';

/** Cerminan `driver_can_take` (kontrak Tahap 9 bagian B) untuk penjelasan di aplikasi. */
export function serviceVerdict(service: ServiceType, vehicle: VehicleType, limits: SendLimits): Verdict {
  switch (service) {
    case 'ride_motor': return { ok: vehicle === 'motor' };
    case 'ride_car': return { ok: vehicle === 'car' };
    case 'food': return { ok: vehicle === 'motor' || vehicle === 'car' };
    case 'box': return { ok: BIG(vehicle) };
    case 'send': {
      const lim = BIG(vehicle) ? limits.box : limits[vehicle === 'car' ? 'car' : 'motor'];
      return { ok: true, note: `maks. ${numId(lim.max_kg)} kg · sisi ${numId(lim.max_cm)} cm` };
    }
    case 'shop':
    case 'market': return vehicle === 'car' ? { ok: true } : vehicle === 'motor' ? { ok: true, note: 'kecuali pesanan yang minta mobil' } : { ok: false };
    default: return { ok: false };
  }
}

const MATRIX_ROWS: { service: ServiceType; label: string; icon: React.ComponentProps<typeof Ionicons>['name'] }[] = [
  { service: 'ride_motor', label: 'AntarRide (motor)', icon: 'bicycle' },
  { service: 'ride_car', label: 'AntarCar', icon: 'car-sport' },
  { service: 'food', label: 'AntarFood', icon: 'restaurant' },
  { service: 'send', label: 'AntarSend dalam kota', icon: 'cube' },
  { service: 'shop', label: 'AntarShop & AntarMarket', icon: 'basket' },
  { service: 'box', label: 'AntarBox / pindahan', icon: 'bus' },
];
const VEHICLE_LABEL: Record<VehicleType, string> = { motor: 'Motor', car: 'Mobil', box: 'Mobil box', pickup: 'Pick up' };

/** Kartu kecil "layanan apa saja yang bisa saya ambil" untuk layar Akun / bantuan Mitra. */
export function VehicleServiceMatrix({ vehicle, defaultOpen = false }: { vehicle?: VehicleType | null; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const { sendLimits } = useAppSettings();
  const radiusText = usePickupRadiusText();
  const v: VehicleType = vehicle ?? 'motor';
  const rows = MATRIX_ROWS.map((r) => ({ ...r, verdict: serviceVerdict(r.service, v, sendLimits) }));
  const yes = rows.filter((r) => r.verdict.ok);
  return (
    <View style={s.card}>
      <PressableScale onPress={() => setOpen(!open)} scaleTo={0.99} haptic={false}>
        <Row gap={12}>
          <View style={[s.icon, { backgroundColor: colors.primary + '14' }]}><Ionicons name="options-outline" size={20} color={colors.primary} /></View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[font.body, { fontWeight: '700' }]} numberOfLines={1}>Layanan yang bisa Anda ambil</Text>
            <Text style={font.tiny} numberOfLines={1}>{VEHICLE_LABEL[v]} · {yes.length} dari {rows.length} layanan</Text>
          </View>
          <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} />
        </Row>
      </PressableScale>
      {!open && (
        <Row gap={6} style={{ flexWrap: 'wrap', marginTop: 10 }}>
          {yes.map((r) => <Badge key={r.service} text={r.label.split(' (')[0]} color={colors.primary} />)}
        </Row>
      )}
      {open && (
        <Animated.View entering={FadeInDown.duration(motion.base)} exiting={FadeOut.duration(motion.fast)} style={{ marginTop: 10, gap: 6 }}>
          {rows.map((r) => (
            <Row key={r.service} gap={10} style={{ alignItems: 'flex-start' }}>
              <Ionicons name={r.verdict.ok ? 'checkmark-circle' : 'close-circle'} size={16} color={r.verdict.ok ? colors.success : colors.textMuted} style={{ marginTop: 2 }} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Row gap={6}>
                  <Ionicons name={r.icon} size={13} color={r.verdict.ok ? colors.primary : colors.textMuted} />
                  <Text style={[font.small, r.verdict.ok ? { color: colors.text, fontWeight: '600' } : { color: colors.textMuted }]} numberOfLines={1}>{r.label}</Text>
                </Row>
                {r.verdict.ok && r.verdict.note ? <Text style={font.tiny}>{r.verdict.note}</Text> : null}
              </View>
            </Row>
          ))}
          <Text style={[font.tiny, { marginTop: 4 }]}>
            Order di luar daftar ini tidak akan muncul di beranda Anda{radiusText ? `; order yang muncul juga dibatasi ${radiusText} dari posisi Anda` : ''}. Perbarui data kendaraan bila Anda mengganti armada.
          </Text>
        </Animated.View>
      )}
    </View>
  );
}

// ------------------------------------------------------------- Radius dinamis
/** Teks radius jemput dari pengaturan server (bukan angka statis). `null` bila belum termuat. */
export function usePickupRadiusText(): string | null {
  const { settings } = useAppSettings();
  const map = settings?.pickup_radius_km ?? {};
  const vals = Object.values(map).map(Number).filter((v) => Number.isFinite(v) && v > 0);
  if (vals.length === 0) return null;
  const min = Math.min(...vals), max = Math.max(...vals);
  return min === max ? `radius ${numId(min)} km` : `radius ${numId(min)}–${numId(max)} km sesuai layanan`;
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end', alignItems: 'center', padding: 12 },
  sheet: { width: '100%', backgroundColor: '#fff', borderRadius: radius.xl, padding: 16, borderWidth: 1, borderColor: colors.border, ...shadow.sheet },
  handle: { width: 44, height: 5, borderRadius: 3, backgroundColor: 'rgba(11,31,42,0.18)', alignSelf: 'center', marginBottom: 12 },
  card: { backgroundColor: '#fff', borderRadius: radius.lg, padding: 14, borderWidth: 1, borderColor: colors.border, ...shadow.soft },
  icon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  tierBox: { padding: 10, borderRadius: radius.md, backgroundColor: colors.bgSoft, gap: 2 },
  pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.full, backgroundColor: colors.bgSoft, borderWidth: 1, borderColor: colors.border },
});
