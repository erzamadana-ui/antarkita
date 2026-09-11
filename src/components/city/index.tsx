// Gerbang wilayah operasi — tampilan jujur untuk pelanggan di kota yang belum dilayani.
//
// PRINSIP (yang membedakan ini dari sekadar menyembunyikan tombol):
//   1. Pelanggan TETAP boleh menelusuri data tempat (apotek, pasar, minimarket).
//      Itu berguna dan tidak menipu.
//   2. Tombol pesan dinonaktifkan DENGAN ALASAN YANG TERLIHAT, bukan hilang diam-diam.
//   3. Pelanggan tidak pernah dibiarkan menyelesaikan alur pemesanan lalu gagal di akhir —
//      pemberitahuan muncul di awal layar, bukan sesudah semuanya diisi.
//   4. Bila hanya sebagian layanan dibuka, keduanya ditampilkan: mana yang bisa, mana yang belum.
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Modal, Pressable, ScrollView } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Button, Row, Chip, Input, toast } from '@/components/ui';
import { PressableScale } from '@/components/motion';
import { rpc } from '@/lib/supabase';
import { colors, font, motion, radius, shadow, spacing } from '@/lib/theme';
import { SERVICE_LABEL, cityBlockedLabel } from '@/hooks/useCityStatus';
import type { CityServiceStatus, CityWaitlistJoin, CityWaitlistMine, ServiceType } from '@/lib/types';

const ORDER: ServiceType[] = ['ride_motor', 'ride_car', 'food', 'send', 'box', 'shop', 'market', 'travel'];

/** Warna & ikon per status, supaya "segera" tidak terasa sekeras "belum dilayani". */
function tone(status?: string) {
  if (status === 'segera') return { fg: colors.info, bg: colors.infoLight, icon: 'time-outline' as const };
  if (status === 'luar_jangkauan') return { fg: colors.textSecondary, bg: colors.bgSoft, icon: 'navigate-circle-outline' as const };
  if (status === 'aktif') return { fg: colors.warning, bg: colors.accentLight, icon: 'information-circle-outline' as const };
  return { fg: colors.warning, bg: colors.accentLight, icon: 'map-outline' as const };
}

// ---------------------------------------------------------------------------
// Kartu utama: "AntarKita belum melayani <kota>" + penjelasan + daftar tunggu
// ---------------------------------------------------------------------------
export function CityNotice({ status, service, compact, onJoined }: {
  status: CityServiceStatus | null;
  /** Bila diisi, kartu hanya muncul untuk layanan ini (mis. di layar AntarRide). */
  service?: ServiceType;
  compact?: boolean;
  onJoined?: () => void;
}) {
  const [sheet, setSheet] = useState(false);
  if (!status) return null;
  const blocked = service ? status.services?.[service] === false : !status.ok;
  if (!blocked) return null;

  const t = tone(status.status);
  // Judul khusus per layanan bila hanya layanan ini yang tertutup di kota yang sudah aktif.
  const perService = service && status.status === 'aktif';
  const headline = perService
    ? `${SERVICE_LABEL[service] ?? service} belum dibuka di ${status.city_name ?? 'kota ini'}`
    : status.headline;
  const body = perService
    ? (status.open_services.length > 0
        ? `Kami sedang menambah driver untuk layanan ini. Yang sudah bisa dipakai di sini: ${status.open_services.join(', ')}.`
        : 'Kami sedang menambah driver untuk layanan ini di kota Anda.')
    : status.body;

  return (
    <>
      <Animated.View entering={FadeInDown.duration(motion.base)} style={[s.card, { backgroundColor: t.bg, borderColor: t.fg + '33' }]}>
        <Row gap={10} style={{ alignItems: 'flex-start' }}>
          <View style={s.icon}><Ionicons name={t.icon} size={20} color={t.fg} /></View>
          <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
            <Text style={[font.body, { fontWeight: '800', color: colors.text }]}>{headline}</Text>
            <Text style={[font.small, { color: colors.textSecondary }]}>{body}</Text>
          </View>
        </Row>

        {!compact && <ServiceAvailability status={status} />}

        {status.waitlist_open && (
          <Button title="Beri tahu saya kalau sudah ada" icon="notifications-outline" variant="secondary" size="sm"
            onPress={() => setSheet(true)} style={{ alignSelf: 'flex-start', marginTop: 10 }} />
        )}
      </Animated.View>

      <WaitlistSheet visible={sheet} status={status} preselect={service} onClose={() => setSheet(false)} onJoined={onJoined} />
    </>
  );
}

/** Dua baris ringkas: layanan yang SUDAH bisa vs yang BELUM dibuka di kota ini. */
export function ServiceAvailability({ status }: { status: CityServiceStatus | null }) {
  if (!status || !status.in_range) return null;
  const open = status.open_services ?? [];
  const closed = status.closed_services ?? [];
  if (open.length === 0 && closed.length === 0) return null;
  return (
    <View style={{ gap: 6, marginTop: 10 }}>
      {open.length > 0 && (
        <Row gap={6} style={{ alignItems: 'flex-start' }}>
          <Ionicons name="checkmark-circle" size={14} color={colors.success} style={{ marginTop: 1 }} />
          <Text style={[font.tiny, { flex: 1, color: colors.textSecondary }]}>Sudah bisa: {open.join(', ')}</Text>
        </Row>
      )}
      {closed.length > 0 && (
        <Row gap={6} style={{ alignItems: 'flex-start' }}>
          <Ionicons name="ellipse-outline" size={14} color={colors.textMuted} style={{ marginTop: 1 }} />
          <Text style={[font.tiny, { flex: 1, color: colors.textMuted }]}>Belum dibuka: {closed.join(', ')}</Text>
        </Row>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Spanduk beranda — ringkas, tidak menutupi isi, tetap bisa ditelusuri
// ---------------------------------------------------------------------------
export function CityBanner({ status, onPress }: { status: CityServiceStatus | null; onPress?: () => void }) {
  const [sheet, setSheet] = useState(false);
  if (!status || status.ok) return null;
  const t = tone(status.status);
  return (
    <>
      <PressableScale onPress={() => (onPress ? onPress() : setSheet(true))} scaleTo={0.99} haptic={false}
        style={[s.banner, { backgroundColor: t.bg, borderColor: t.fg + '33' }]}
        accessibilityRole="button" accessibilityLabel={status.headline}>
        <View style={s.icon}><Ionicons name={t.icon} size={20} color={t.fg} /></View>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text style={[font.body, { fontWeight: '800' }]} numberOfLines={1}>{status.headline}</Text>
          <Text style={[font.tiny, { color: colors.textSecondary }]} numberOfLines={2}>{status.body}</Text>
        </View>
        {status.waitlist_open ? <Ionicons name="chevron-forward" size={18} color={t.fg} /> : null}
      </PressableScale>
      <WaitlistSheet visible={sheet} status={status} onClose={() => setSheet(false)} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Daftar tunggu — data nyata untuk memutuskan kota mana dibuka berikutnya
// ---------------------------------------------------------------------------
export function WaitlistSheet({ visible, status, preselect, onClose, onJoined }: {
  visible: boolean; status: CityServiceStatus | null; preselect?: ServiceType;
  onClose: () => void; onJoined?: () => void;
}) {
  const [picked, setPicked] = useState<ServiceType[]>(preselect ? [preselect] : []);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [mine, setMine] = useState<CityWaitlistMine | null>(null);

  useEffect(() => {
    if (!visible || !status?.city_id) { setMine(null); return; }
    rpc<CityWaitlistMine>('city_waitlist_mine', { p_city_id: status.city_id })
      .then((m) => { setMine(m); if (m?.joined && m.services?.length) setPicked(m.services as ServiceType[]); })
      .catch(() => setMine(null));
  }, [visible, status?.city_id]);

  useEffect(() => { if (visible && preselect) setPicked((p) => (p.includes(preselect) ? p : [...p, preselect])); }, [visible, preselect]);

  if (!status) return null;
  const toggle = (sv: ServiceType) => setPicked((p) => (p.includes(sv) ? p.filter((x) => x !== sv) : [...p, sv]));
  const kota = status.city_name ?? 'daerah Anda';

  const submit = async () => {
    setBusy(true);
    try {
      const r = await rpc<CityWaitlistJoin>('city_waitlist_join', {
        p_lat: null, p_lng: null, p_city_id: status.city_id,
        p_services: picked, p_contact: null, p_note: note.trim() || null,
      });
      toast.success(r?.message ?? `Terima kasih! Kami akan mengabari Anda begitu AntarKita membuka layanan di ${kota}.`);
      onJoined?.();
      onClose();
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose}>
        <Pressable style={s.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={s.grab} />
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 14, paddingBottom: 8 }}>
            <View style={{ gap: 4 }}>
              <Text style={font.h3}>Beri tahu saya kalau sudah ada</Text>
              <Text style={font.small}>
                {mine?.joined
                  ? `Anda sudah terdaftar untuk ${kota}. Ubah layanan yang Anda butuhkan kapan saja.`
                  : `Kami membuka kota baru berdasarkan jumlah peminat. Daftar untuk ${kota} supaya kota Anda naik prioritas.`}
              </Text>
              {typeof mine?.total === 'number' && mine.total > 0 && (
                <Row gap={5} style={{ marginTop: 2 }}>
                  <Ionicons name="people-outline" size={13} color={colors.primary} />
                  <Text style={[font.tiny, { color: colors.primary, fontWeight: '700' }]}>{mine.total} orang sudah mendaftar di {kota}</Text>
                </Row>
              )}
            </View>

            <View style={{ gap: 8 }}>
              <Text style={font.label}>Layanan yang paling Anda butuhkan</Text>
              <View style={s.chips}>
                {ORDER.map((sv) => <Chip key={sv} label={SERVICE_LABEL[sv]} active={picked.includes(sv)} onPress={() => toggle(sv)} />)}
              </View>
            </View>

            <Input label="Catatan (opsional)" placeholder="Mis. butuh antar obat dari apotek tiap minggu"
              value={note} onChangeText={setNote} multiline numberOfLines={3} />

            <Button title={mine?.joined ? 'Perbarui pendaftaran' : 'Daftar sekarang'} icon="notifications-outline"
              size="lg" loading={busy} onPress={submit} />
            <Button title="Nanti saja" variant="ghost" size="sm" onPress={onClose} />
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Pembantu untuk layar pemesanan — definisinya ada di useCityStatus (logika murni,
// supaya bisa diuji langsung di peramban oleh tests/kota/uji-kota.mjs).
// ---------------------------------------------------------------------------
export { cityBlockedLabel };

const s = StyleSheet.create({
  card: { borderRadius: radius.lg, padding: 14, borderWidth: 1 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: radius.lg, padding: 12, borderWidth: 1, marginTop: 16 },
  icon: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: spacing.lg, paddingTop: 10, paddingBottom: 28, maxHeight: '88%',
    width: '100%', maxWidth: 560, alignSelf: 'center', ...shadow.soft,
  },
  grab: { width: 42, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginBottom: 12 },
});
