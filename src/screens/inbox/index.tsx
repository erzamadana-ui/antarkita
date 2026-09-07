// Kotak masuk pelanggan/mitra — promo dari admin (satu arah), info pesanan & sistem.
//
// Aturan penting: SETIAP notifikasi harus punya reaksi saat diketuk.
// • Bila `data` memuat pengenal (ticket_id, order_id, travel_request_id, booking_id, payment_id,
//   withdrawal_id, merchant_id) atau ada promo_code → buka halaman terkait.
// • Bila tidak ada tujuan (mis. pengumuman umum) → tampilkan detail lengkap di bottom-sheet.
// Jadi tidak pernah ada notifikasi yang "diketuk tapi tidak terjadi apa-apa".
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Image, Modal, Pressable, ScrollView, Linking } from 'react-native';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { Screen, Row, Badge, Button, Empty, IconCircle } from '@/components/ui';
import { Entrance, PressableScale, Skeleton } from '@/components/motion';
import { useNotifications, notificationData, notifTargetFor, type NotifTarget } from '@/hooks/useNotifications';
import { useAuth } from '@/store/auth';
import { colors, font, glass, motion, radius, shadow } from '@/lib/theme';
import { timeAgo, formatDateTimeShort } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { APP } from '@/lib/app';
import { pushAvailable, pushStatus, ensurePushPermission, initPush } from '@/lib/push';
import type { AppNotification } from '@/lib/types';

/**
 * Menentukan halaman tujuan dari `data` notifikasi. Null = tidak ada tujuan (buka detail).
 * Petanya sendiri ada di src/hooks/useNotifications.ts (notifTargetFor) supaya PUSH NOTIFICATION
 * yang diketuk dari luar aplikasi mendarat di halaman yang sama persis — lihat src/lib/push.ts.
 */
export function notifTarget(n: AppNotification): NotifTarget | null {
  return notifTargetFor(notificationData(n), n.promo_code);
}
export type { NotifTarget };

export default function Inbox() {
  const router = useRouter();
  const uid = useAuth((s) => s.session?.user.id);
  const { items, loading, unread, markRead } = useNotifications(uid);
  const [detail, setDetail] = useState<AppNotification | null>(null);
  const t = useT();
  useEffect(() => { if (unread > 0) { const tm = setTimeout(() => markRead(), 1500); return () => clearTimeout(tm); } }, [unread, markRead]);

  const open = (n: AppNotification) => {
    if (!n.read_at) markRead([n.id]);
    const target = notifTarget(n);
    if (target) router.push(target.route as never);
    else setDetail(n); // tidak ada tujuan → tampilkan isi lengkap, jangan diam saja
  };

  return (
    <Screen title={t('notifications')} back right={unread > 0 ? <Button size="sm" variant="ghost" title="Tandai dibaca" onPress={() => markRead()} /> : undefined}>
      <PushPermissionBanner />
      {loading ? <View style={{ gap: 10 }}>{[0, 1, 2].map((i) => <Skeleton key={i} height={84} radius={radius.lg} />)}</View> : items.length === 0 ? (
        <Empty icon="notifications-off-outline" title="Belum ada notifikasi" subtitle="Promo dan info pesanan akan muncul di sini." />
      ) : (
        <View style={{ gap: 10 }}>
          {items.map((n, i) => {
            const target = notifTarget(n);
            const d = notificationData(n);
            return (
              <Entrance key={n.id} index={Math.min(i, 6)} from="up">
                <PressableScale
                  onPress={() => open(n)}
                  scaleTo={0.985} haptic={false}
                  accessibilityRole="button"
                  accessibilityLabel={`${n.title}. ${target ? `Ketuk untuk membuka ${target.label}` : 'Ketuk untuk melihat detail'}`}
                  style={[s.card, !n.read_at && { borderColor: colors.primary }]}
                >
                  {n.image_url ? <Image source={{ uri: n.image_url }} style={s.img} /> : null}
                  <Row gap={12} style={{ padding: 12, alignItems: 'flex-start' }}>
                    <IconCircle name={n.kind === 'promo' ? 'pricetag-outline' : n.kind === 'order' ? 'receipt-outline' : 'information-circle-outline'} size={42} bg={n.kind === 'promo' ? colors.accentLight : colors.tint} color={n.kind === 'promo' ? colors.warning : colors.primary} />
                    <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                      <Row between>
                        <Text style={{ fontWeight: '800', color: colors.text, fontSize: 15, flex: 1 }} numberOfLines={2}>{n.title}</Text>
                        {!n.read_at && <View style={s.dot} />}
                      </Row>
                      {n.body ? <Text style={font.small} numberOfLines={3}>{n.body}</Text> : null}
                      <Row gap={8} style={{ flexWrap: 'wrap' }}>
                        {n.promo_code ? <Badge text={`Kode: ${n.promo_code}`} color={colors.accent} /> : null}
                        {d.code ? <Badge text={d.code} color={colors.textMuted} /> : null}
                        <Text style={font.tiny}>{timeAgo(n.created_at)}</Text>
                      </Row>
                      {/* Petunjuk kecil supaya jelas kartu ini bisa diketuk dan ke mana perginya */}
                      <View style={s.hint}>
                        <Ionicons name={target ? 'arrow-forward-circle-outline' : 'information-circle-outline'} size={13} color={colors.primary} />
                        <Text style={s.hintText} numberOfLines={1}>{target ? `Ketuk untuk membuka ${target.label}` : 'Ketuk untuk melihat detail'}</Text>
                      </View>
                    </View>
                  </Row>
                </PressableScale>
              </Entrance>
            );
          })}
        </View>
      )}

      <NotifDetailSheet notif={detail} onClose={() => setDetail(null)} />
    </Screen>
  );
}

/**
 * Ajakan mengaktifkan notifikasi sistem — SATU-SATUNYA tempat izin notifikasi diminta ulang.
 * Hanya muncul bila platform memang mendukung push (Android build) TETAPI izin/token belum ada,
 * jadi pengguna web/iOS tidak melihat ajakan yang tidak bisa dipenuhi.
 */
function PushPermissionBanner() {
  const [state, setState] = useState(() => pushStatus());
  const [hidden, setHidden] = useState(false);
  const refresh = useCallback(async () => { setState(await initPush()); }, []);
  useEffect(() => { if (pushAvailable()) refresh(); }, [refresh]);

  if (!pushAvailable() || hidden) return null;
  if (state.permission === 'granted' && state.registered) return null;

  const blocked = state.permission === 'denied';
  const onPress = async () => {
    if (blocked) { Linking.openSettings().catch(() => { /* noop */ }); return; }
    const perm = await ensurePushPermission(true);
    if (perm === 'granted') { const st = await initPush(); setState(st); if (st.registered) setHidden(true); }
    else setState((p) => ({ ...p, permission: perm }));
  };

  return (
    <View style={s.pushCard}>
      <Row gap={10} style={{ alignItems: 'flex-start' }}>
        <IconCircle name="notifications-outline" size={38} bg={colors.tint} color={colors.primary} />
        <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
          <Text style={{ fontWeight: '800', color: colors.text, fontSize: 14 }}>Aktifkan notifikasi</Text>
          <Text style={font.small}>
            {blocked
              ? 'Notifikasi diblokir di Pengaturan. Ketuk untuk membukanya, lalu izinkan notifikasi AntarKita.'
              : 'Supaya pesanan, chat, dan panggilan tetap terdengar walau aplikasi ditutup.'}
          </Text>
        </View>
      </Row>
      <Row gap={8}>
        <Button size="sm" title={blocked ? 'Buka Pengaturan' : 'Izinkan'} onPress={onPress} style={{ flex: 1 }} />
        <Button size="sm" variant="ghost" title="Nanti" onPress={() => setHidden(true)} />
      </Row>
    </View>
  );
}

/** Bottom-sheet detail untuk notifikasi tanpa halaman tujuan (pengumuman, info sistem, dsb.). */
function NotifDetailSheet({ notif, onClose }: { notif: AppNotification | null; onClose: () => void }) {
  const router = useRouter();
  if (!notif) return null;
  const d = notificationData(notif);
  const kindLabel = notif.kind === 'promo' ? 'Promo' : notif.kind === 'order' ? 'Pesanan' : 'Informasi';
  // Tindakan cadangan: promo → daftar promo, sisanya → hubungi CS lewat tiket baru.
  const action = notif.promo_code && APP === 'pelanggan'
    ? { title: 'Lihat promo di AntarFood', route: '/food' }
    : { title: 'Hubungi CS tentang ini', route: '/support/new' };
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose} accessibilityLabel="Tutup detail notifikasi">
        <Pressable style={s.sheetWrap} onPress={() => {}}>
          <Animated.View entering={FadeInDown.duration(motion.base)} style={s.sheet}>
            <View style={s.handle} />
            <Row gap={10} style={{ alignItems: 'flex-start' }}>
              <IconCircle name={notif.kind === 'promo' ? 'pricetag-outline' : notif.kind === 'order' ? 'receipt-outline' : 'information-circle-outline'} size={42} bg={notif.kind === 'promo' ? colors.accentLight : colors.tint} color={notif.kind === 'promo' ? colors.warning : colors.primary} />
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <Text style={font.h3}>{notif.title}</Text>
                <Text style={font.tiny}>{kindLabel} · {formatDateTimeShort(notif.created_at)}</Text>
              </View>
              <PressableScale onPress={onClose} scaleTo={0.9} style={s.close}><Ionicons name="close" size={18} color={colors.textSecondary} /></PressableScale>
            </Row>
            <ScrollView style={{ maxHeight: 320 }} contentContainerStyle={{ gap: 10, paddingVertical: 4 }} showsVerticalScrollIndicator={false}>
              {notif.image_url ? <Animated.View entering={FadeIn.duration(motion.base)}><Image source={{ uri: notif.image_url }} style={s.sheetImg} /></Animated.View> : null}
              <Text style={[font.body, { color: colors.text }]}>{notif.body?.trim() || 'Tidak ada keterangan tambahan untuk notifikasi ini.'}</Text>
              <Row gap={8} style={{ flexWrap: 'wrap' }}>
                {notif.promo_code ? <Badge text={`Kode promo: ${notif.promo_code}`} color={colors.accent} /> : null}
                {d.code ? <Badge text={`Kode: ${d.code}`} color={colors.textMuted} /> : null}
                {typeof d.amount === 'number' ? <Badge text={`Nominal: Rp${Math.round(d.amount).toLocaleString('id-ID')}`} color={colors.info} /> : null}
              </Row>
            </ScrollView>
            <Button title={action.title} onPress={() => { onClose(); router.push(action.route as never); }} />
            <Button title="Tutup" variant="ghost" onPress={onClose} />
          </Animated.View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  card: { borderRadius: radius.lg, overflow: 'hidden', backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, ...shadow.soft },
  pushCard: { gap: 10, padding: 12, marginBottom: 12, borderRadius: radius.lg, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, ...shadow.soft },
  img: { width: '100%', height: 130, backgroundColor: colors.bgSoft },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.primary, marginTop: 4 },
  hint: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', marginTop: 2, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.full, backgroundColor: colors.tint },
  hintText: { fontSize: 11.5, fontWeight: '700', color: colors.primary },
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheetWrap: { width: '100%', maxWidth: 640, alignSelf: 'center' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: 16, paddingTop: 10, paddingBottom: 24, gap: 10, borderTopWidth: 1, borderColor: glass.border, ...shadow.sheet },
  handle: { width: 44, height: 5, borderRadius: 3, backgroundColor: 'rgba(11,31,42,0.18)', alignSelf: 'center', marginBottom: 6 },
  close: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(11,31,42,0.06)', alignItems: 'center', justifyContent: 'center' },
  sheetImg: { width: '100%', height: 150, borderRadius: radius.md, backgroundColor: colors.bgSoft },
});
