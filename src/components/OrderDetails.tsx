import React from 'react';
import { View, Text, StyleSheet, Linking } from 'react-native';
import { signedUrl } from '@/lib/upload';
import { toast } from '@/components/ui';
import { Ionicons } from '@expo/vector-icons';
import { Row, Avatar, Stars, Badge, Divider } from '@/components/ui';
import { PressableScale } from '@/components/motion';
import { CallButton } from '@/components/call/IncomingCall';
import type { CallPeer } from '@/lib/call';
import { PriceSummary } from '@/components/BookingSheet';
import { colors, font, radius, glass, shadow } from '@/lib/theme';
import { rupiah, km, formatTime, merchantStatusLabel, phoneDisplay, phoneMasked, extraKindLabel } from '@/lib/format';
import type { Driver, Order, OrderEvent, Profile, ShoppingItem } from '@/lib/types';

/** Kartu driver (untuk customer) atau kartu customer (untuk driver). */
/** phone tidak lagi ditampilkan/dipakai (UU PDP) — telepon lewat aplikasi via `callPeer`. */
export function PersonCard({ name, subtitle, avatar, rating, ratingCount, onChat, badge, callPeer, orderId }: { name?: string | null; subtitle?: string; phone?: string | null; avatar?: string | null; rating?: number; ratingCount?: number; onChat?: () => void; badge?: string; callPeer?: CallPeer | null; orderId?: string | null }) {
  return (
    <View style={s.person}>
      <Avatar name={name} url={avatar} size={50} />
      <View style={{ flex: 1 }}>
        <Text style={font.h3}>{name ?? '—'}</Text>
        {subtitle ? <Text style={font.small}>{subtitle}</Text> : null}
        {rating != null && <Row gap={4}><Stars value={rating} size={11} /><Text style={font.tiny}>{Number(rating).toFixed(1)} · {ratingCount ?? 0} ulasan</Text></Row>}
        {badge ? <Badge text={badge} style={{ marginTop: 4 }} /> : null}
      </View>
      <Row gap={8}>
        {onChat && <PressableScale onPress={onChat} scaleTo={0.9} style={[s.circle, shadow.glow(colors.primary)]}><Ionicons name="chatbubble-ellipses" size={20} color="#fff" /></PressableScale>}
        {callPeer && <CallButton peer={callPeer} orderId={orderId} />}
      </Row>
    </View>
  );
}

export function RouteBlock({ order }: { order: Order }) {
  return (
    <View style={{ gap: 8 }}>
      <Row gap={10} style={{ alignItems: 'flex-start' }}>
        <View style={[s.dot, { backgroundColor: colors.primary, marginTop: 4 }]} />
        <View style={{ flex: 1 }}><Text style={font.tiny}>{order.service === 'food' ? 'Merchant' : order.service === 'send' ? 'Ambil dari' : order.service === 'shop' ? 'Toko' : order.service === 'market' ? 'Pasar' : 'Jemput'}</Text><Text style={s.addr}>{order.merchant?.name ?? order.pickup_address}</Text>{order.merchant?.address ? <Text style={font.small}>{order.merchant.address}</Text> : null}</View>
      </Row>
      <Row gap={10} style={{ alignItems: 'flex-start' }}>
        <View style={[s.dot, { backgroundColor: colors.danger, borderRadius: 2, marginTop: 4 }]} />
        <View style={{ flex: 1 }}><Text style={font.tiny}>{order.service === 'send' ? 'Antar ke' : 'Tujuan'}</Text><Text style={s.addr}>{order.dropoff_address}</Text></View>
      </Row>
      <Row gap={8}><Badge text={km(order.distance_km)} color={colors.info} /><Badge text={`±${order.duration_min} mnt`} color={colors.info} /><Badge text={order.payment_method === 'wallet' ? 'AntarPay' : 'Tunai'} color={colors.textSecondary} /></Row>
    </View>
  );
}

export function OrderExtras({ order }: { order: Order }) {
  return (
    <View style={{ gap: 10 }}>
      {order.service === 'food' && order.order_items && (
        <View style={{ gap: 6 }}>
          <Row between><Text style={font.h3}>Pesanan</Text>{!!order.merchant_status && <Badge text={merchantStatusLabel[order.merchant_status]} color={order.merchant_status === 'ready' ? colors.success : order.merchant_status === 'rejected' ? colors.danger : colors.warning} />}</Row>
          {order.order_items.map((it) => (
            <Row key={it.id} between>
              <Text style={font.body}>{it.qty}× {it.name}{it.notes ? <Text style={font.tiny}>  ({it.notes})</Text> : null}</Text>
              <Text style={{ fontWeight: '600' }}>{rupiah(it.price * it.qty)}</Text>
            </Row>
          ))}
        </View>
      )}
      {(order.service === 'shop' || order.service === 'market') && <ShoppingListBlock order={order} />}
      {(order.extras ?? []).length > 0 && (
        <View style={{ gap: 4 }}>
          <Text style={font.h3}>Biaya tambahan</Text>
          {(order.extras ?? []).map((e) => (
            <Row key={e.id} between>
              <Text style={font.small}>{extraKindLabel[e.kind] ?? e.kind}{e.note ? ` · ${e.note}` : ''}</Text>
              <Row gap={6}><Text style={{ fontWeight: '600', color: e.status === 'rejected' ? colors.textMuted : colors.text, textDecorationLine: e.status === 'rejected' ? 'line-through' : 'none' }}>{rupiah(e.amount)}</Text><Badge text={e.status === 'approved' ? 'Disetujui' : e.status === 'rejected' ? 'Ditolak' : 'Menunggu'} color={e.status === 'approved' ? colors.success : e.status === 'rejected' ? colors.danger : colors.warning} /></Row>
            </Row>
          ))}
        </View>
      )}
      {order.service === 'send' && (
        <View style={{ gap: 4 }}>
          <Text style={font.h3}>Detail paket</Text>
          <Text style={font.body}>Penerima: <Text style={{ fontWeight: '700' }}>{order.recipient_name}</Text> · {phoneDisplay(order.recipient_phone)}</Text>
          <Text style={font.small}>{order.package_details?.type} · {order.package_details?.weight}{order.package_details?.description ? ` · ${order.package_details.description}` : ''}</Text>
        </View>
      )}
      {order.notes ? <View style={s.note}><Ionicons name="chatbox-ellipses-outline" size={16} color={colors.warning} /><Text style={[font.small, { flex: 1, color: colors.text }]}>{order.notes}</Text></View> : null}
    </View>
  );
}

const fmtQty = (n: number) => String(Math.round(n * 100) / 100).replace('.', ',');
/** Daftar belanja AntarShop/AntarMarket: harga acuan per item, dan bila driver sudah mengisi nota, harga riil di sampingnya. */
export function ShoppingListBlock({ order }: { order: Order }) {
  const isMarket = order.service === 'market';
  const color = isMarket ? colors.market : colors.shop;
  const list = order.shopping_list ?? [];
  const actual = order.actual_items ?? null;
  const findActual = (it: ShoppingItem, i: number) => actual?.find((a, j) => (a.item_id && a.item_id === it.item_id) || (a.product_id && a.product_id === it.product_id) || (!a.item_id && !a.product_id && j === i)) ?? null;
  const totaled = !!actual || !!order.receipt_url || (order.status === 'completed' || order.status === 'in_progress');
  const hasPrice = list.some((it) => (it.price ?? it.ref_price ?? 0) > 0);
  return (
    <View style={{ gap: 6 }}>
      <Row between><Text style={font.h3}>Daftar belanja</Text><Badge text={order.shop_store ?? (isMarket ? 'Pasar' : 'Toko')} color={color} /></Row>
      {actual && hasPrice && (
        <Row gap={8}><View style={{ flex: 1 }} /><Text style={[font.tiny, { minWidth: 76, textAlign: 'right' }]}>Acuan</Text><Text style={[font.tiny, { minWidth: 76, textAlign: 'right', color }]}>Nota driver</Text></Row>
      )}
      {list.map((it, i) => {
        const ref = it.price ?? it.ref_price ?? 0;
        const a = findActual(it, i);
        const aQty = a?.qty ?? it.qty;
        const aPrice = a?.price ?? null;
        const unavailable = !!a && (a.price ?? 0) === 0;
        return (
          <Row key={i} gap={8} style={{ alignItems: 'flex-start' }}>
            <View style={[s.bullet, { backgroundColor: color }]}><Text style={{ color: '#fff', fontSize: 12, fontWeight: '800' }}>{fmtQty(it.qty)}</Text></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[font.body, unavailable && { color: colors.textMuted, textDecorationLine: 'line-through' }]}>{it.name}{it.note ? <Text style={font.tiny}>  ({it.note})</Text> : null}</Text>
              {ref > 0 && <Text style={font.tiny}>{it.unit ? `${it.unit} · ` : ''}{isMarket ? 'acuan' : 'katalog'} {rupiah(ref)}{a && !unavailable && a.qty != null && a.qty !== it.qty ? ` · dibeli ${fmtQty(aQty)} ${it.unit ?? ''}` : ''}{unavailable ? ' · tidak tersedia' : ''}</Text>}
            </View>
            {ref > 0 && <Text style={[font.small, { minWidth: 76, textAlign: 'right', fontWeight: '600', color: a ? colors.textMuted : colors.text }]}>{rupiah(ref * it.qty)}</Text>}
            {actual && hasPrice && <Text style={{ minWidth: 76, textAlign: 'right', fontWeight: '700', color: unavailable ? colors.textMuted : colors.text, fontSize: 13 }}>{aPrice == null ? '—' : rupiah(aPrice * aQty)}</Text>}
          </Row>
        );
      })}
      <Row between style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 6 }}>
        <Text style={font.small}>{totaled ? (isMarket ? 'Belanja riil (nota)' : 'Total belanja (nota)') : isMarket ? 'Belanja (acuan + cadangan 10%)' : order.shop_store_id ? 'Belanja (katalog + cadangan 10%)' : 'Perkiraan anggaran'}</Text>
        <Text style={{ fontWeight: '700' }}>{rupiah(order.items_subtotal)}</Text>
      </Row>
      {(order.service_fee ?? 0) > 0 && <Row between><Text style={font.small}>Jasa belanja</Text><Text style={{ fontWeight: '700' }}>{rupiah(order.service_fee ?? 0)}</Text></Row>}
      {actual && <Text style={font.tiny}>Sumber harga nota: driver{isMarket ? ' — dipakai sebagai acuan harga pasar untuk pesanan berikutnya' : ''}.</Text>}
      {!!order.receipt_url && (
        <PressableScale onPress={async () => { try { const u = /^https?:\/\//i.test(order.receipt_url!) ? order.receipt_url! : await signedUrl('proofs', order.receipt_url!); if (u) Linking.openURL(u); else toast.error('Foto nota tidak bisa dibuka'); } catch (e) { toast.error((e as Error).message); } }} style={[s.receiptBtn, { borderColor: color }]}>
          <Ionicons name="receipt-outline" size={16} color={color} /><Text style={[font.small, { color, fontWeight: '700' }]}>Lihat foto nota dari driver</Text>
        </PressableScale>
      )}
    </View>
  );
}

export function PriceBlock({ order, forDriver }: { order: Order; forDriver?: boolean }) {
  if (forDriver) {
    return (
      <PriceSummary rows={[{ label: 'Tarif perjalanan', value: order.fare_delivery }, { label: 'Biaya tambahan disetujui', value: order.extras_total ?? 0 }, { label: 'Tip pelanggan', value: order.tip ?? 0 }, { label: 'Potongan platform', value: Math.max(0, order.fare_delivery - (order.driver_earning - (order.status === 'completed' ? (order.tip ?? 0) + (order.extras_total ?? 0) : 0))), minus: true }]} total={order.status === 'completed' ? order.driver_earning : order.driver_earning + (order.tip ?? 0) + (order.extras_total ?? 0)} />
    );
  }
  return (
    <PriceSummary rows={[{ label: order.service === 'shop' || order.service === 'market' ? 'Belanja' : 'Harga makanan', value: order.items_subtotal }, { label: 'Jasa belanja', value: order.service === 'shop' || order.service === 'market' ? (order.service_fee ?? 0) : 0 }, { label: order.service === 'food' || order.service === 'send' ? 'Ongkos kirim' : order.service === 'shop' || order.service === 'market' ? `Ongkir${order.shop_vehicle === 'car' ? ' (mobil)' : ''}` : 'Tarif perjalanan', value: order.fare_delivery }, { label: 'Biaya layanan', value: order.platform_fee }, { label: 'Biaya tambahan', value: order.extras_total ?? 0 }, { label: 'Tip driver', value: order.tip ?? 0 }, { label: `Diskon${order.promo_code ? ` (${order.promo_code})` : ''}`, value: order.discount, minus: true }]} total={order.total + (order.tip ?? 0)} />
  );
}

const eventLabel: Record<string, string> = {
  searching: 'Pesanan dibuat, mencari driver', accepted: 'Driver menerima pesanan', arrived: 'Driver tiba di titik jemput', in_progress: 'Perjalanan dimulai',
  completed: 'Pesanan selesai', cancelled: 'Pesanan dibatalkan', driver_cancelled: 'Driver membatalkan, mencari driver lain',
  merchant_accepted: 'Merchant menyiapkan pesanan', merchant_ready: 'Pesanan siap diambil', merchant_rejected: 'Merchant menolak pesanan',
  shop_total: 'Driver memasukkan total belanja', tip: 'Pelanggan memberi tip', extra_requested: 'Driver mengajukan biaya tambahan', extra_approved: 'Biaya tambahan disetujui', extra_rejected: 'Biaya tambahan ditolak',
};
export function Timeline({ events }: { events: OrderEvent[] }) {
  if (!events.length) return null;
  return (
    <View>
      <Text style={[font.h3, { marginBottom: 8 }]}>Riwayat status</Text>
      {events.map((e, i) => (
        <Row key={e.id} gap={10} style={{ alignItems: 'flex-start', marginBottom: 8 }}>
          <View style={{ alignItems: 'center' }}>
            <View style={[s.tdot, i === events.length - 1 && { backgroundColor: colors.primary }]} />
            {i < events.length - 1 && <View style={s.tline} />}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[font.body, { fontSize: 14 }]}>{eventLabel[e.status] ?? e.status}</Text>
            <Text style={font.tiny}>{formatTime(e.created_at)}{e.note && e.status !== 'searching' ? ` · ${e.note}` : ''}</Text>
          </View>
        </Row>
      ))}
    </View>
  );
}

export function driverSubtitle(d: Driver | null) {
  if (!d) return '';
  return `${d.vehicle_brand ?? (d.vehicle_type === 'car' ? 'Mobil' : 'Motor')} · ${d.vehicle_plate}${d.vehicle_color ? ` · ${d.vehicle_color}` : ''}`;
}
export function customerSubtitle(p: Profile | null) { return p ? `Nomor tersembunyi · ${phoneMasked(p.phone)}` : ''; }

export { Divider };
const s = StyleSheet.create({
  receiptBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, marginTop: 4 },
  person: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: radius.xl, padding: 12, borderWidth: 1, borderColor: glass.border, ...shadow.soft },
  circle: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5 },
  bullet: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, backgroundColor: colors.shop, alignItems: 'center', justifyContent: 'center' },
  addr: { fontWeight: '600', color: colors.text, fontSize: 14 },
  note: { flexDirection: 'row', gap: 8, backgroundColor: 'rgba(245,158,11,0.12)', padding: 10, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(245,158,11,0.25)' },
  tdot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.border, marginTop: 4 },
  tline: { width: 2, flex: 1, minHeight: 14, backgroundColor: colors.border, marginVertical: 2 },
});
