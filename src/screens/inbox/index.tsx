// Kotak masuk pelanggan/mitra — promo dari admin (satu arah), info pesanan & sistem.
//
// Aturan penting: SETIAP notifikasi harus punya reaksi saat diketuk.
// • Bila `data` memuat pengenal (ticket_id, order_id, travel_request_id, booking_id, payment_id,
//   withdrawal_id, merchant_id) atau ada promo_code → buka halaman terkait.
// • Bila tidak ada tujuan (mis. pengumuman umum) → tampilkan detail lengkap di bottom-sheet.
// Jadi tidak pernah ada notifikasi yang "diketuk tapi tidak terjadi apa-apa".
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Image, Modal, Pressable, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { Screen, Row, Badge, Button, Empty, IconCircle } from '@/components/ui';
import { Entrance, PressableScale, Skeleton } from '@/components/motion';
import { useNotifications, notificationData } from '@/hooks/useNotifications';
import { useAuth } from '@/store/auth';
import { colors, font, glass, motion, radius, shadow } from '@/lib/theme';
import { timeAgo, formatDateTimeShort } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { APP } from '@/lib/app';
import type { AppNotification } from '@/lib/types';

/** Tujuan sebuah notifikasi bila diketuk. `label` dipakai untuk badge "Ketuk untuk membuka …". */
interface NotifTarget { route: string; label: string }

/** Menentukan halaman tujuan dari `kind` + `data` notifikasi. Null = tidak ada tujuan (buka detail). */
export function notifTarget(n: AppNotification): NotifTarget | null {
  const d = notificationData(n);
  const customer = APP === 'pelanggan';
  // 1. Tiket / percakapan dengan Admin & CS (mis. notifikasi "Pesan dari Admin AntarKita")
  if (d.ticket_id) return { route: `/support/${d.ticket_id}`, label: 'tiket bantuan' };
  // 2. Pesanan
  if (d.order_id) return { route: `/order/${d.order_id}`, label: 'detail pesanan' };
  // 3. AntarTravel — permintaan carter/sopir harian & booking kursi
  if (d.travel_request_id) return customer
    ? { route: `/travel/request/${d.travel_request_id}`, label: 'permintaan travel' }
    : { route: '/driver/travel', label: 'permintaan travel' };
  if (d.booking_id && customer) return { route: `/travel/${d.booking_id}`, label: 'booking travel' };
  // 4. AntarPay (top up, pembayaran gateway, penarikan saldo)
  if (d.payment_id || d.withdrawal_id) return customer
    ? { route: '/(customer)/pay', label: 'AntarPay' }
    : { route: '/(driver)/earnings', label: 'saldo & penghasilan' };
  // 5. Merchant / promo (hanya ada di aplikasi pelanggan)
  if (d.merchant_id && customer) return { route: `/food/${d.merchant_id}`, label: 'merchant' };
  if (n.promo_code && customer) return { route: '/food', label: 'promo AntarFood' };
  return null;
}

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
