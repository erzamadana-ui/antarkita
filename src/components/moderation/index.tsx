// Moderasi Konten Buatan Pengguna (UGC) — komponen "Laporkan" & "Blokir".
//
// Kebijakan Google Play UGC (support.google.com/googleplay/android-developer/answer/9876937)
// mewajibkan aplikasi dengan interaksi langsung antar pengguna menyediakan
// pelaporan konten/pengguna DAN fungsi memblokir pengguna DI DALAM APLIKASI.
// Peninjau Google benar-benar mencari tombolnya, jadi komponen ini sengaja
// dibuat mudah dipakai ulang supaya bisa ditempel di chat, kartu driver/
// pelanggan, ulasan, dan halaman merchant tanpa menyalin kode.
//
// Semua penulisan lewat RPC berbatas laju (`report_content`, `block_user`)
// — lihat supabase/migrations/0050_moderasi_ugc_lapor_blokir.sql.
import React, { useState } from 'react';
import { View, Text, Modal, Pressable, ScrollView, TextInput, StyleSheet, Platform, useWindowDimensions } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { Button, Row, toast, type IconName } from '@/components/ui';
import { PressableScale } from '@/components/motion';
import { rpc } from '@/lib/supabase';
import { colors, font, glass, motion, radius, shadow } from '@/lib/theme';

/** Jenis sasaran laporan — harus sama dengan CHECK di tabel `content_reports`. */
export type ReportKind = 'user' | 'chat' | 'call' | 'review' | 'merchant' | 'merchant_photo' | 'order' | 'other';
export type ReportCategory = 'pelecehan' | 'penipuan' | 'seksual' | 'kekerasan' | 'spam' | 'lainnya';

/** Kategori yang ditawarkan ke pengguna — bahasa sehari-hari, bukan istilah hukum. */
export const REPORT_CATEGORIES: { value: ReportCategory; label: string; desc: string; icon: IconName }[] = [
  { value: 'pelecehan', label: 'Pelecehan atau perundungan', desc: 'Kata-kata kasar, ancaman, menghina, meneror', icon: 'sad-outline' },
  { value: 'penipuan', label: 'Penipuan', desc: 'Minta transfer di luar aplikasi, order palsu, tarif liar', icon: 'alert-circle-outline' },
  { value: 'seksual', label: 'Konten seksual', desc: 'Ajakan, foto, atau ucapan bermuatan seksual', icon: 'eye-off-outline' },
  { value: 'kekerasan', label: 'Kekerasan atau ancaman', desc: 'Ancaman kekerasan, ujaran kebencian', icon: 'warning-outline' },
  { value: 'spam', label: 'Spam atau promosi', desc: 'Pesan berulang, iklan, tautan mencurigakan', icon: 'mail-unread-outline' },
  { value: 'lainnya', label: 'Lainnya', desc: 'Hal lain yang melanggar aturan AntarKita', icon: 'ellipsis-horizontal-circle-outline' },
];

const KIND_LABEL: Record<ReportKind, string> = {
  user: 'pengguna', chat: 'pesan chat', call: 'panggilan suara', review: 'ulasan',
  merchant: 'merchant', merchant_photo: 'foto merchant', order: 'pesanan', other: 'konten',
};

// ---------------------------------------------------------------------------
// Lembar bawah sederhana (Modal) — dipakai bersama oleh lembar lapor & blokir.
// ---------------------------------------------------------------------------
function BottomSheet({ visible, onClose, title, subtitle, children }: {
  visible: boolean; onClose: () => void; title: string; subtitle?: string; children: React.ReactNode;
}) {
  const { height } = useWindowDimensions();
  return (
    <Modal visible={visible} transparent animationType={Platform.OS === 'web' ? 'fade' : 'slide'} onRequestClose={onClose}>
      <Animated.View entering={FadeIn.duration(motion.fast)} style={s.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Tutup" />
        <Animated.View entering={FadeInDown.duration(motion.base)} style={[s.sheet, { maxHeight: Math.min(height * 0.86, 720) }]}>
          <View style={s.grabber} />
          <Row between style={{ paddingHorizontal: 20, paddingTop: 4 }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={font.h2} numberOfLines={2}>{title}</Text>
              {subtitle ? <Text style={[font.small, { marginTop: 2 }]} numberOfLines={3}>{subtitle}</Text> : null}
            </View>
            <PressableScale onPress={onClose} scaleTo={0.9} hitSlop={10} style={s.closeBtn}>
              <Ionicons name="close" size={20} color={colors.textSecondary} />
            </PressableScale>
          </Row>
          <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 14, gap: 12 }} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// LEMBAR PELAPORAN
// ---------------------------------------------------------------------------
export function ReportSheet({ visible, onClose, targetUserId, targetName, kind = 'user', targetId, onDone }: {
  visible: boolean;
  onClose: () => void;
  /** Pengguna yang dilaporkan (boleh null untuk konten tanpa pemilik, mis. foto merchant). */
  targetUserId?: string | null;
  targetName?: string | null;
  kind?: ReportKind;
  /** Id konten yang dilaporkan (id pesanan, id merchant, id ulasan, …). */
  targetId?: string | null;
  onDone?: () => void;
}) {
  const [category, setCategory] = useState<ReportCategory | null>(null);
  const [detail, setDetail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const close = () => { setCategory(null); setDetail(''); setSent(false); onClose(); };

  const submit = async () => {
    if (!category) return toast.error('Pilih dulu jenis masalahnya');
    setBusy(true);
    try {
      await rpc('report_content', {
        p_target_user: targetUserId ?? null,
        p_kind: kind,
        p_id: targetId ?? null,
        p_category: category,
        p_detail: detail.trim() || null,
      });
      setSent(true);
      onDone?.();
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };

  // Konfirmasi bahwa laporan diterima — Google meminta pengguna tahu laporannya masuk.
  if (sent) {
    return (
      <BottomSheet visible={visible} onClose={close} title="Laporan Anda terkirim">
        <View style={{ alignItems: 'center', gap: 10, paddingVertical: 8 }}>
          <View style={s.okCircle}><Ionicons name="checkmark" size={34} color="#fff" /></View>
          <Text style={[font.body, { textAlign: 'center' }]}>Terima kasih sudah melapor.</Text>
          <Text style={[font.small, { textAlign: 'center' }]}>
            Tim moderasi AntarKita meninjau setiap laporan paling lambat 2×24 jam. Anda akan mendapat pemberitahuan
            di aplikasi begitu laporan ini selesai ditinjau.{'\n\n'}
            Bila Anda merasa tidak nyaman, Anda juga bisa memblokir pengguna ini agar tidak dipasangkan lagi.
          </Text>
        </View>
        <Button title="Selesai" onPress={close} />
      </BottomSheet>
    );
  }

  return (
    <BottomSheet
      visible={visible}
      onClose={close}
      title={`Laporkan ${KIND_LABEL[kind]}`}
      subtitle={targetName ? `Laporan tentang ${targetName}. Identitas pelapor tidak diberitahukan kepada pihak yang dilaporkan.` : 'Identitas pelapor tidak diberitahukan kepada pihak yang dilaporkan.'}
    >
      <Text style={font.label}>Jenis masalah</Text>
      {REPORT_CATEGORIES.map((c) => {
        const on = category === c.value;
        return (
          <PressableScale key={c.value} onPress={() => setCategory(c.value)} scaleTo={0.99} haptic={false} style={[s.option, on && s.optionOn]}>
            <View style={[s.optionIcon, on && { backgroundColor: colors.primary }]}>
              <Ionicons name={c.icon} size={19} color={on ? '#fff' : colors.primary} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[font.body, { fontWeight: '700' }]} numberOfLines={2}>{c.label}</Text>
              <Text style={font.tiny} numberOfLines={2}>{c.desc}</Text>
            </View>
            <Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={20} color={on ? colors.primary : colors.border} />
          </PressableScale>
        );
      })}

      <Text style={[font.label, { marginTop: 6 }]}>Keterangan (opsional)</Text>
      <TextInput
        value={detail}
        onChangeText={setDetail}
        placeholder="Ceritakan singkat apa yang terjadi — kapan, di pesanan mana, apa yang dikatakan…"
        placeholderTextColor={colors.textMuted}
        multiline
        maxLength={1000}
        style={s.textarea}
      />
      <Text style={font.tiny}>
        Laporan palsu berulang dapat menyebabkan akun Anda ditinjau. Untuk keadaan darurat, gunakan tombol SOS di Pusat Keamanan.
      </Text>
      <Button title="Kirim laporan" icon="flag-outline" loading={busy} disabled={!category} onPress={submit} />
    </BottomSheet>
  );
}

// ---------------------------------------------------------------------------
// LEMBAR BLOKIR — konfirmasi yang menjelaskan akibatnya
// ---------------------------------------------------------------------------
export function BlockSheet({ visible, onClose, targetUserId, targetName, onDone }: {
  visible: boolean; onClose: () => void; targetUserId: string; targetName?: string | null; onDone?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const nama = targetName || 'pengguna ini';

  const submit = async () => {
    setBusy(true);
    try {
      await rpc('block_user', { p_user: targetUserId, p_reason: reason.trim() || null });
      toast.success(`${nama} diblokir`);
      onDone?.();
      onClose();
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title={`Blokir ${nama}?`}>
      <View style={s.warnBox}>
        <Ionicons name="information-circle-outline" size={20} color={colors.info} />
        <Text style={[font.small, { flex: 1, color: colors.text }]}>Setelah diblokir:</Text>
      </View>
      {[
        ['git-compare-outline', `Anda tidak akan dipasangkan lagi dengan ${nama} pada pesanan berikutnya.`],
        ['chatbubbles-outline', 'Kalian tidak bisa saling berkirim pesan maupun menelepon lewat aplikasi.'],
        ['eye-off-outline', `${nama} tidak diberi tahu bahwa Anda memblokirnya.`],
        ['lock-open-outline', 'Anda bisa membuka blokir kapan saja lewat Akun → Pengguna diblokir.'],
      ].map(([icon, text]) => (
        <Row key={text} gap={10} style={{ alignItems: 'flex-start' }}>
          <Ionicons name={icon as IconName} size={18} color={colors.primary} style={{ marginTop: 1 }} />
          <Text style={[font.small, { flex: 1, color: colors.text }]}>{text}</Text>
        </Row>
      ))}
      <Text style={[font.tiny, { marginTop: 2 }]}>Pesanan yang sedang berjalan tidak dibatalkan oleh blokir ini.</Text>

      <Text style={[font.label, { marginTop: 8 }]}>Alasan (opsional, hanya untuk Anda)</Text>
      <TextInput value={reason} onChangeText={setReason} placeholder="mis. bicara kasar saat menjemput" placeholderTextColor={colors.textMuted} maxLength={200} style={s.input} />

      <Button title={`Blokir ${nama}`} variant="danger" icon="ban-outline" loading={busy} onPress={submit} />
      <Button title="Batal" variant="ghost" color={colors.textSecondary} onPress={onClose} />
    </BottomSheet>
  );
}

// ---------------------------------------------------------------------------
// MENU MODERASI — tombol "⋯" berisi Laporkan & Blokir
// ---------------------------------------------------------------------------
export function ModerationMenu({ userId, name, kind = 'user', targetId, size = 40, style, onBlocked }: {
  /** Pengguna sasaran. Bila kosong, hanya "Laporkan konten" yang muncul. */
  userId?: string | null;
  name?: string | null;
  kind?: ReportKind;
  targetId?: string | null;
  size?: number;
  style?: React.ComponentProps<typeof View>['style'];
  onBlocked?: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const [report, setReport] = useState(false);
  const [block, setBlock] = useState(false);
  const nama = name || 'pengguna ini';

  return (
    <>
      <PressableScale
        onPress={() => setMenu(true)}
        scaleTo={0.9}
        style={[s.circleGhost, { width: size, height: size, borderRadius: size / 2 }, style]}
        accessibilityLabel="Lapor atau blokir pengguna"
      >
        <Ionicons name="ellipsis-horizontal" size={20} color={colors.textSecondary} />
      </PressableScale>

      <BottomSheet visible={menu} onClose={() => setMenu(false)} title={nama} subtitle="Keamanan & moderasi">
        <PressableScale onPress={() => { setMenu(false); setTimeout(() => setReport(true), 180); }} scaleTo={0.99} haptic={false} style={s.option}>
          <View style={[s.optionIcon, { backgroundColor: colors.dangerLight }]}><Ionicons name="flag-outline" size={19} color={colors.danger} /></View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[font.body, { fontWeight: '700' }]}>Laporkan</Text>
            <Text style={font.tiny} numberOfLines={2}>Kirim laporan ke tim moderasi AntarKita</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </PressableScale>
        {userId ? (
          <PressableScale onPress={() => { setMenu(false); setTimeout(() => setBlock(true), 180); }} scaleTo={0.99} haptic={false} style={s.option}>
            <View style={[s.optionIcon, { backgroundColor: colors.dangerLight }]}><Ionicons name="ban-outline" size={19} color={colors.danger} /></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[font.body, { fontWeight: '700' }]}>Blokir</Text>
              <Text style={font.tiny} numberOfLines={2}>Tidak dipasangkan lagi dan tidak bisa saling berkirim pesan</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </PressableScale>
        ) : null}
        <Button title="Batal" variant="ghost" color={colors.textSecondary} onPress={() => setMenu(false)} />
      </BottomSheet>

      <ReportSheet visible={report} onClose={() => setReport(false)} targetUserId={userId} targetName={name} kind={kind} targetId={targetId} />
      {userId ? <BlockSheet visible={block} onClose={() => setBlock(false)} targetUserId={userId} targetName={name} onDone={onBlocked} /> : null}
    </>
  );
}

/**
 * Tombol teks "Laporkan …" untuk konten yang bukan orang (ulasan, foto merchant,
 * halaman merchant). Dipakai di layar merchant & kartu ulasan.
 */
export function ReportContentButton({ kind, targetId, targetUserId, title, name }: {
  kind: ReportKind; targetId?: string | null; targetUserId?: string | null; title?: string; name?: string | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button title={title ?? 'Laporkan konten ini'} variant="ghost" color={colors.textSecondary} icon="flag-outline" onPress={() => setOpen(true)} />
      <ReportSheet visible={open} onClose={() => setOpen(false)} kind={kind} targetId={targetId} targetUserId={targetUserId} targetName={name} />
    </>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(11,31,42,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingTop: 8, width: '100%', maxWidth: 720, alignSelf: 'center', ...shadow.card },
  grabber: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginBottom: 10 },
  closeBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.bgSoft, alignItems: 'center', justifyContent: 'center' },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: '#fff' },
  optionOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  optionIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center' },
  textarea: { minHeight: 96, textAlignVertical: 'top', backgroundColor: colors.bgSoft, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: 12, color: colors.text, fontSize: 15 },
  input: { backgroundColor: colors.bgSoft, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, height: 46, color: colors.text, fontSize: 15 },
  warnBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.infoLight, padding: 10, borderRadius: radius.md, borderWidth: 1, borderColor: glass.border },
  okCircle: { width: 62, height: 62, borderRadius: 31, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', ...shadow.glow(colors.primary) },
  circleGhost: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bgSoft, borderWidth: 1, borderColor: colors.border },
});
