// Dispatch penawaran bertahap (0122) + pelanggan tidak hadir (0121) — komponen aplikasi Mitra (driver):
//  - OfferCard         : kartu PENAWARAN menonjol di atas feed — hitung mundur detik, jarak, tarif, Terima / Tolak
//  - DeclineOfferSheet : pilihan alasan tolak → driver_decline_offer(p_offer, p_reason)
//  - NoMoveTimer       : timer "Menuju penjemputan" sejak accept; peringatan ≥ 4 mnt belum bergerak, server melepas di 5 mnt
//  - NoShowSheet       : laporan pelanggan tidak hadir (foto bukti wajib → bucket proofs + catatan) → driver_report_no_show
//  - useCountdown      : detik tersisa dari expires_at (jam klien), diperbarui tiap detik
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Modal, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { FadeIn, FadeInDown, FadeOut } from 'react-native-reanimated';
import { Row, Badge, Button, Chip, Input, toast } from '@/components/ui';
import { PressableScale, ProgressBar, AnimatedNumber } from '@/components/motion';
import { ServiceIllustration } from '@/components/ServiceArt';
import { DocUpload } from '@/components/DocUpload';
import { rpc, supabase } from '@/lib/supabase';
import { colors, font, radius, shadow, motion } from '@/lib/theme';
import { rupiah, km, serviceLabel, vehicleClassLabel } from '@/lib/format';
import { serviceDef } from '@/lib/services';
import { DECLINE_REASONS, DEFAULT_NO_MOVE_MINUTES, DEFAULT_OFFER_SECONDS, mmss, noMoveState, offerSecondsLeft } from '@/lib/dispatch';
import { noShowMinutesLeft, parseNoShowWait } from '@/lib/antifraud';
import type { AvailableOrder, Order } from '@/lib/types';

/** Detik tersisa sampai `expiresAt`, diperbarui tiap detik. */
export function useCountdown(expiresAt: string | null | undefined): number {
  const [left, setLeft] = useState(() => offerSecondsLeft(expiresAt));
  useEffect(() => {
    setLeft(offerSecondsLeft(expiresAt));
    if (!expiresAt) return;
    const t = setInterval(() => setLeft(offerSecondsLeft(expiresAt)), 1000);
    return () => clearInterval(t);
  }, [expiresAt]);
  return left;
}

// Setelan 0121/0122 dibaca langsung dari `app_settings` (policy settings_select, migrasi 0002 — pola yang sama dengan AntarNow).
// Gagal → default kontrak (25 dtk / 5 mnt / 5 mnt). Cache 5 menit, dibagi semua komponen di berkas ini.
const SETTING_KEYS = ['dispatch_offer_seconds', 'dispatch_accept_no_move_minutes', 'antifraud_noshow_wait_minutes'] as const;
type DispatchSettings = { offerSeconds: number; noMoveMinutes: number; noShowWaitMinutes: number };
const DEFAULTS: DispatchSettings = { offerSeconds: DEFAULT_OFFER_SECONDS, noMoveMinutes: DEFAULT_NO_MOVE_MINUTES, noShowWaitMinutes: 5 };
let settingsCache: { at: number; value: DispatchSettings } | null = null;
let settingsInflight: Promise<DispatchSettings> | null = null;
async function loadDispatchSettings(): Promise<DispatchSettings> {
  if (settingsCache && Date.now() - settingsCache.at < 5 * 60_000) return settingsCache.value;
  if (settingsInflight) return settingsInflight;
  settingsInflight = (async () => {
    try {
      const { data } = await supabase.from('app_settings').select('key,value').in('key', [...SETTING_KEYS]);
      const rows = (data ?? []) as { key: string; value: unknown }[];
      const num = (k: string, d: number) => { const v = Number(rows.find((r) => r.key === k)?.value); return Number.isFinite(v) && v >= 0 ? v : d; };
      const value = { offerSeconds: num('dispatch_offer_seconds', DEFAULTS.offerSeconds) || DEFAULTS.offerSeconds, noMoveMinutes: num('dispatch_accept_no_move_minutes', DEFAULTS.noMoveMinutes) || DEFAULTS.noMoveMinutes, noShowWaitMinutes: num('antifraud_noshow_wait_minutes', DEFAULTS.noShowWaitMinutes) };
      settingsCache = { at: Date.now(), value };
      return value;
    } catch { return settingsCache?.value ?? DEFAULTS; }
    finally { settingsInflight = null; }
  })();
  return settingsInflight;
}
export function useDispatchSettings(): DispatchSettings {
  const [v, setV] = useState<DispatchSettings>(settingsCache?.value ?? DEFAULTS);
  useEffect(() => { let alive = true; loadDispatchSettings().then((x) => { if (alive) setV(x); }); return () => { alive = false; }; }, []);
  return v;
}

// ------------------------------------------------------------------ Kartu penawaran
export function OfferCard({ order, accepting, disabled, disabledLabel, onAccept, onDecline, onOpen }: {
  order: AvailableOrder; accepting?: boolean; disabled?: boolean; disabledLabel?: string;
  onAccept: () => void; onDecline: () => void; onOpen?: () => void;
}) {
  const left = useCountdown(order.offer_expires_at);
  const { offerSeconds } = useDispatchSettings();
  const total = Math.max(offerSeconds, left);
  const def = serviceDef(order.service);
  const urgent = left <= 8;
  const color = urgent ? colors.danger : colors.primary;
  return (
    <Animated.View entering={FadeInDown.duration(motion.base)} exiting={FadeOut.duration(motion.fast)} style={[s.card, { borderColor: color }, shadow.glow(color)]}>
      <Row between>
        <Row gap={6}>
          <Ionicons name="flash" size={14} color={color} />
          <Text style={[font.tiny, { fontWeight: '700', color }]}>PENAWARAN UNTUK ANDA{order.offer_round ? ` · ronde ${order.offer_round}` : ''}</Text>
        </Row>
        <View style={[s.timer, { backgroundColor: color }]}>
          <Ionicons name="time-outline" size={14} color="#fff" />
          <Text style={s.timerText}>{left} dtk</Text>
        </View>
      </Row>
      <View style={{ marginTop: 8 }}><ProgressBar progress={total > 0 ? left / total : 0} color={color} height={6} /></View>
      <PressableScale onPress={onOpen} scaleTo={0.99} haptic={false} disabled={!onOpen} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12 }}>
        <View style={[s.thumb, { backgroundColor: def.color + '14' }]}><ServiceIllustration kind={def.art} size={40} /></View>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text style={[font.body, { fontWeight: '700' }]} numberOfLines={1}>{serviceLabel[order.service]}{order.vehicle_class ? ` · ${vehicleClassLabel[order.vehicle_class] ?? ''}` : ''}</Text>
          <Row gap={4}><Ionicons name="navigate-outline" size={12} color={colors.textMuted} /><Text style={font.tiny} numberOfLines={1}>Jemput {km(order.distance_to_pickup_km)} · {order.merchant_name ?? order.pickup_address}</Text></Row>
          <Row gap={4}><Ionicons name="location-outline" size={12} color={colors.textMuted} /><Text style={font.tiny} numberOfLines={1}>Antar {km(order.distance_km)} · {order.dropoff_address}</Text></Row>
          <Row gap={4}><Ionicons name={order.payment_method === 'cash' ? 'cash-outline' : 'wallet-outline'} size={12} color={order.payment_method === 'cash' ? colors.warning : colors.primary} /><Text style={[font.tiny, { fontWeight: '700', color: order.payment_method === 'cash' ? colors.warning : colors.primary }]}>{order.payment_method === 'cash' ? `Tunai · tagih ${rupiah(order.total)}` : 'Dibayar AntarVoucher'}</Text></Row>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={font.tiny}>Pendapatan</Text>
          <AnimatedNumber value={order.driver_earning} format={rupiah} style={{ fontSize: 20, fontWeight: '700', color: colors.primary, letterSpacing: -0.3 }} duration={400} />
        </View>
      </PressableScale>
      <Row gap={8} style={{ marginTop: 12 }}>
        <Button title="Tolak" size="md" variant="outline" color={colors.danger} icon="close" onPress={onDecline} disabled={accepting} style={{ flex: 1 }} />
        <Button title={disabled ? (disabledLabel ?? 'Tidak bisa menerima') : 'Terima'} size="md" icon="checkmark" loading={accepting} disabled={accepting || disabled || left <= 0} onPress={onAccept} style={{ flex: 1.6 }} />
      </Row>
      <Text style={[font.tiny, { marginTop: 8 }]}>Hanya Anda yang melihat order ini selama {total} detik. Tidak dijawab → ditawarkan ke driver berikutnya. Setelah menerima, segera bergerak ke titik jemput.</Text>
    </Animated.View>
  );
}

// ------------------------------------------------------------- Sheet tolak penawaran
export function DeclineOfferSheet({ visible, order, onClose, onConfirm }: {
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
              <Text style={font.h3}>Tolak penawaran ini?</Text>
              <Text style={[font.small, { marginTop: 2 }]}>{order ? `${order.code} · ` : ''}Order langsung ditawarkan ke driver berikutnya dan tidak muncul lagi untuk Anda. Alasan membantu kami memperbaiki penyaluran.</Text>
              <Row gap={8} style={{ flexWrap: 'wrap', marginTop: 12 }}>
                {DECLINE_REASONS.map((r) => <Chip key={r} label={r} active={pick === r} onPress={() => setPick(pick === r ? null : r)} />)}
              </Row>
              <Input placeholder="Catatan tambahan (opsional)" value={note} onChangeText={setNote} containerStyle={{ marginTop: 12 }} />
              <Row gap={8} style={{ marginTop: 14 }}>
                <Button title="Batal" variant="ghost" onPress={close} style={{ flex: 1 }} />
                <Button title="Tolak penawaran" variant="danger" icon="close-circle-outline" loading={busy} onPress={submit} style={{ flex: 1.3 }} />
              </Row>
            </Animated.View>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

// ------------------------------------------------------- Timer menuju penjemputan
/**
 * Tampil pada status `accepted`. Server (dispatch_release_stale) melepas order bila ≥ N menit (5) belum `arrived`
 * dan driver belum mendekat ≥ 300 m. Peringatan lokal di menit ke-4; `moved` (sudah bergerak ≥ 300 m) meredakan nada.
 */
export function NoMoveTimer({ acceptedAt, moved, onNavigate }: { acceptedAt: string | null | undefined; moved?: boolean; onNavigate?: () => void }) {
  const { noMoveMinutes } = useDispatchSettings();
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const st = useMemo(() => noMoveState(acceptedAt, noMoveMinutes, now), [acceptedAt, noMoveMinutes, now]);
  if (!acceptedAt) return null;
  const tone = st.critical ? colors.danger : st.warn ? colors.warning : colors.primary;
  const title = st.critical
    ? (moved ? 'Batas waktu bergerak terlewati' : 'Order dapat dilepas kapan saja')
    : st.warn ? (moved ? 'Terus menuju titik jemput' : 'Anda belum bergerak — berangkat sekarang') : 'Menuju penjemputan';
  const body = st.critical
    ? (moved ? 'Anda sudah bergerak, jadi order tetap milik Anda. Tandai "Sudah tiba" begitu sampai.' : `Server melepas order yang tidak bergerak ≥ 300 m dalam ${noMoveMinutes} menit setelah diterima dan mencatatnya sebagai strike.`)
    : st.warn ? (moved ? 'Tandai "Sudah tiba" begitu sampai di titik jemput.' : `Sisa ${mmss(st.leftSec)} sebelum server melepas order ini ke driver lain (aturan ${noMoveMinutes} menit tanpa bergerak).`)
    : `Bergerak ke titik jemput dalam ${noMoveMinutes} menit setelah menerima — bila tidak, order dilepas otomatis dan tercatat sebagai pelanggaran.`;
  return (
    <Animated.View entering={FadeIn.duration(motion.base)} style={[s.timerCard, { borderColor: tone + '66', backgroundColor: tone + '12' }]}>
      <Row gap={10} style={{ alignItems: 'flex-start' }}>
        <View style={[s.timerIcon, { backgroundColor: tone + '22' }]}><Ionicons name={st.critical ? 'alert-circle' : st.warn ? 'warning-outline' : 'walk-outline'} size={20} color={tone} /></View>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Row between>
            <Text style={[font.body, { fontWeight: '700', color: colors.text, flex: 1 }]} numberOfLines={2}>{title}</Text>
            <Text style={{ fontWeight: '700', color: tone, fontSize: 16 }}>{mmss(st.elapsedSec)}</Text>
          </Row>
          <Text style={font.tiny}>{body}</Text>
        </View>
      </Row>
      {(st.warn || st.critical) && !moved && onNavigate ? <Button title="Buka navigasi ke titik jemput" size="sm" color={tone} icon="navigate" onPress={onNavigate} style={{ marginTop: 10 }} /> : null}
    </Animated.View>
  );
}

// ------------------------------------------------------- Pelanggan tidak hadir (no-show)
export interface NoShowResult { ok: boolean; order_id: string; code: string; status: string; refund: number; noshow_fee: number; strikes: number; action: 'strike' | 'cash_blocked' | 'suspended'; cash_blocked_until: string | null }

/** Menit tunggu minimal (antifraud_noshow_wait_minutes) — fallback kontrak 5 menit. */
function useNoShowWaitMinutes() { return useDispatchSettings().noShowWaitMinutes; }

/** Tombol + sheet laporan tidak hadir. Tampil hanya pada status `arrived`. */
export function NoShowButton({ order, onDone }: { order: Order; onDone: (r: NoShowResult) => void }) {
  const [open, setOpen] = useState(false);
  const wait = useNoShowWaitMinutes();
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!open && order.status !== 'arrived') return; const t = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(t); }, [open, order.status]);
  if (order.status !== 'arrived') return null;
  const arrivedAt = (order as Order & { arrived_at?: string | null }).arrived_at ?? null;
  const leftMin = noShowMinutesLeft(arrivedAt, wait, now);
  return (
    <>
      <Button title={leftMin > 0 ? `Pelanggan tidak hadir (tunggu ${leftMin} mnt lagi)` : 'Pelanggan tidak hadir'} variant="outline" color={colors.warning} icon="person-remove-outline" onPress={() => setOpen(true)} />
      <NoShowSheet visible={open} order={order} waitMinutes={wait} onClose={() => setOpen(false)} onDone={(r) => { setOpen(false); onDone(r); }} />
    </>
  );
}

export function NoShowSheet({ visible, order, waitMinutes, onClose, onDone }: { visible: boolean; order: Order; waitMinutes: number; onClose: () => void; onDone: (r: NoShowResult) => void }) {
  const [evidence, setEvidence] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const arrivedAt = (order as Order & { arrived_at?: string | null }).arrived_at ?? null;
  const leftMin = noShowMinutesLeft(arrivedAt, waitMinutes);
  const close = () => { if (busy) return; onClose(); };
  const submit = async () => {
    if (!evidence) return toast.error('Foto bukti wajib diunggah (lokasi jemput / kondisi di tempat).');
    if (busy) return;
    setBusy(true);
    try {
      const r = await rpc<NoShowResult>('driver_report_no_show', { p_order: order.id, p_evidence_url: evidence, p_note: note.trim() || null });
      toast.success(`Laporan tidak hadir tercatat (${r.code}). ${r.refund > 0 ? `Refund pelanggan ${rupiah(r.refund)}. ` : ''}${r.noshow_fee > 0 ? `Kompensasi ${rupiah(r.noshow_fee)} masuk saldo Anda.` : 'Anda kembali bisa menerima order.'}`);
      setEvidence(''); setNote(''); onDone(r);
    } catch (e) {
      const w = parseNoShowWait(e, arrivedAt);
      toast.error(w ? w.text : (e as Error).message);
    } finally { setBusy(false); }
  };
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <Pressable onPress={close} style={s.backdrop}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ width: '100%', maxWidth: 520 }}>
          <Pressable onPress={() => {}}>
            <Animated.View entering={FadeInDown.duration(motion.base)} style={s.sheet}>
              <View style={s.handle} />
              <Text style={font.h3}>Laporkan pelanggan tidak hadir</Text>
              <Text style={[font.small, { marginTop: 2 }]}>{order.code} · Pesanan dibatalkan tanpa penalti untuk Anda; pelanggan dicatat strike (strike ke-2 menonaktifkan tunai, ke-3 menangguhkan akun). Laporan palsu ditinjau admin dari foto bukti.</Text>
              {leftMin > 0 ? (
                <Row gap={8} style={[s.waitBox, { marginTop: 12 }]}>
                  <Ionicons name="hourglass-outline" size={16} color={colors.warning} />
                  <Text style={[font.tiny, { flex: 1, color: colors.text }]}>Server mewajibkan menunggu minimal {waitMinutes} menit sejak Anda tiba. Sisa <Text style={{ fontWeight: '700' }}>{leftMin} menit</Text>. Hubungi pelanggan dulu lewat telepon/chat.</Text>
                </Row>
              ) : <Badge text="Waktu tunggu terpenuhi" color={colors.success} style={{ marginTop: 12, alignSelf: 'flex-start' }} />}
              <View style={{ marginTop: 12, gap: 10 }}>
                <DocUpload label="Foto bukti di titik jemput" hint="Wajib: foto lokasi jemput / kondisi di tempat (kamera)" required camera value={evidence} onChange={setEvidence} bucket="proofs" color={colors.warning} />
                <Input label="Catatan" placeholder="Mis. sudah telepon 3×, tidak diangkat; alamat kosong" value={note} onChangeText={setNote} multiline />
              </View>
              <Row gap={8} style={{ marginTop: 14 }}>
                <Button title="Batal" variant="ghost" onPress={close} style={{ flex: 1 }} />
                <Button title={leftMin > 0 ? `Lapor (tunggu ${leftMin} mnt)` : 'Kirim laporan'} variant="danger" icon="person-remove-outline" loading={busy} disabled={leftMin > 0 || !evidence} onPress={submit} style={{ flex: 1.4 }} />
              </Row>
            </Animated.View>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  card: { padding: 14, borderRadius: 20, backgroundColor: '#fff', borderWidth: 2 },
  timer: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.full },
  timerText: { color: '#fff', fontWeight: '800', fontSize: 14, fontVariant: ['tabular-nums'] },
  thumb: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center' },
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end', alignItems: 'center', padding: 12 },
  sheet: { width: '100%', backgroundColor: '#fff', borderRadius: radius.xl, padding: 16, borderWidth: 1, borderColor: colors.border, ...shadow.sheet },
  handle: { width: 44, height: 5, borderRadius: 3, backgroundColor: 'rgba(11,31,42,0.18)', alignSelf: 'center', marginBottom: 12 },
  timerCard: { padding: 12, borderRadius: radius.lg, borderWidth: 1 },
  timerIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  waitBox: { padding: 10, borderRadius: radius.md, backgroundColor: colors.accentLight, alignItems: 'flex-start' },
});
