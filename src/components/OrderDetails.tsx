import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Linking, TextInput } from 'react-native';
import { useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { signedUrl } from '@/lib/upload';
import { toast } from '@/components/ui';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Row, Avatar, Stars, Badge, Divider, Button, Chip } from '@/components/ui';
import { PressableScale } from '@/components/motion';
import { CallButton } from '@/components/call/IncomingCall';
import { ModerationMenu } from '@/components/moderation';
import type { CallPeer } from '@/lib/call';
import { PriceSummary } from '@/components/BookingSheet';
import { DriverEarningBreakdown } from '@/components/EarningBreakdown';
import { channelLabel } from '@/store/payprefs';
import { colors, font, radius, glass, shadow } from '@/lib/theme';
import { rupiah, km, formatTime, formatDate, merchantStatusLabel, phoneDisplay, phoneMasked, extraKindLabel, promoOwnerLabel, paidViaLabel, pctLabel, payStatusLabel, payStatusColor, disputeKindLabel } from '@/lib/format';
import { usePaymentStatus, useProviderPublic, providerLabel, fetchRefundPolicy, requestRefund, openDispute, REFUND_OPEN_TEXT, DISPUTE_OPEN_TEXT } from '@/lib/payments';
import { IS_CUSTOMER_APP } from '@/lib/app';
import { useT } from '@/lib/i18n';
import { useAuth } from '@/store/auth';
import type { DisputeKind, Driver, Order, OrderEvent, PayStatus, Profile, RefundPolicy, ShoppingItem } from '@/lib/types';

/** Kartu driver (untuk customer) atau kartu customer (untuk driver). */
/** phone tidak lagi ditampilkan/dipakai (UU PDP) — telepon lewat aplikasi via `callPeer`. */
/**
 * `moderationUserId` menampilkan tombol ⋯ berisi "Laporkan" & "Blokir" (wajib
 * kebijakan UGC Google Play). Bila tidak diisi, jalur moderasi tetap muncul
 * selama `callPeer` ada, sehingga kartu lama otomatis ikut terlindungi.
 */
export function PersonCard({ name, subtitle, avatar, rating, ratingCount, onChat, badge, callPeer, orderId, moderationUserId, moderation = true }: { name?: string | null; subtitle?: string; phone?: string | null; avatar?: string | null; rating?: number; ratingCount?: number; onChat?: () => void; badge?: string; callPeer?: CallPeer | null; orderId?: string | null; moderationUserId?: string | null; moderation?: boolean }) {
  const modId = moderationUserId ?? callPeer?.id ?? null;
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
        {onChat && <PressableScale onPress={onChat} scaleTo={0.9} accessibilityRole="button" accessibilityLabel="Buka chat" style={[s.circle, shadow.glow(colors.primary)]}><Ionicons name="chatbubble-ellipses" size={20} color="#fff" /></PressableScale>}
        {callPeer && <CallButton peer={callPeer} orderId={orderId} />}
        {moderation && modId ? <ModerationMenu userId={modId} name={name} kind="user" targetId={orderId} size={44} /> : null}
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
      <Row gap={8}><Badge text={km(order.distance_km)} color={colors.info} /><Badge text={`±${order.duration_min} mnt`} color={colors.info} /><Badge text={order.payment_method === 'cash' ? 'Tunai' : paidViaLabel(order.paid_via ?? 'wallet')} color={colors.textSecondary} /></Row>
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
          <Text style={font.small}>{[order.package_details?.type, order.package_details?.weight, order.package_details?.size_cm ? `sisi terpanjang ${order.package_details.size_cm} cm` : null, order.package_details?.description].filter(Boolean).join(' · ')}</Text>
          {order.send_scope === 'intercity' ? <Text style={font.tiny}>{order.package_details?.via === 'travel' ? 'Antar kota · titipan mitra AntarTravel (door to door)' : 'Antar kota · lewat gudang AntarSend'}{order.package_details?.dest_address ? ` · ${order.package_details.dest_address}` : ''}</Text> : null}
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
            <View style={[s.bullet, { backgroundColor: color }]}><Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>{fmtQty(it.qty)}</Text></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[font.body, unavailable && { color: colors.textMuted, textDecorationLine: 'line-through' }]}>{it.name}{it.note ? <Text style={font.tiny}>  ({it.note})</Text> : null}</Text>
              {ref > 0 && <Text style={font.tiny}>{it.unit ? `${it.unit} · ` : ''}{isMarket ? 'acuan' : 'katalog'} {rupiah(ref)}{a && !unavailable && a.qty != null && a.qty !== it.qty ? ` · dibeli ${fmtQty(aQty)} ${it.unit ?? ''}` : ''}{unavailable ? ' · tidak tersedia' : ''}</Text>}
            </View>
            {ref > 0 && <Text style={[font.small, { minWidth: 76, textAlign: 'right', fontWeight: '600', color: a ? colors.textMuted : colors.text }]}>{rupiah(ref * it.qty)}</Text>}
            {actual && hasPrice && <Text style={{ minWidth: 76, textAlign: 'right', fontWeight: '700', color: unavailable ? colors.textMuted : colors.text, fontSize: 14 }}>{aPrice == null ? '—' : rupiah(aPrice * aQty)}</Text>}
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

export function PriceBlock({ order, forDriver, providerName }: { order: Order; forDriver?: boolean; providerName?: string | null }) {
  // Driver: rincian dari buku besar (driver_order_breakdown, 0099) — bukan rekonstruksi dari driver_earning.
  if (forDriver) return <DriverEarningBreakdown orderId={order.id} status={order.status} title={null} />;
  // Pelanggan (§0.4): harga barang · ongkir · biaya platform · biaya metode pembayaran · biaya tambahan · diskon (+ penanggung) · total
  const shopping = order.service === 'shop' || order.service === 'market';
  const payFee = order.pg_fee_borne_by === 'customer' ? (order.pg_fee ?? 0) + (order.pg_fee_ppn ?? 0) : 0;
  const funder = order.discount > 0 ? order.promo_funded_by ?? null : null;
  const comm = order.driver_commission_pct_snap;
  const ride = order.service === 'ride_motor' || order.service === 'ride_car';
  const payLabel = order.pg_channel ? (providerName ?? channelLabel(order.pg_channel)) : order.payment_method === 'cash' ? 'Tunai' : 'AntarPay';
  return (
    <PriceSummary rows={[
      { label: order.service === 'food' ? 'Harga makanan' : 'Harga barang', value: order.items_subtotal },
      { label: ride ? 'Tarif perjalanan' : shopping ? `Ongkir${order.shop_vehicle === 'car' ? ' (mobil)' : ''}` : 'Ongkir', value: order.fare_delivery, keep: true,
        hint: comm == null ? null : Number(comm) === 0 ? '100 % untuk driver' : `Komisi platform ${pctLabel(comm)}` },
      { label: 'Ongkir antar kota', value: order.intercity_fare ?? 0 },
      { label: 'Jasa belanja', value: shopping ? (order.service_fee ?? 0) : 0 },
      { label: 'Biaya platform AntarKita', value: order.platform_fee, keep: true },
      { label: `Biaya metode pembayaran (${payLabel})`, value: payFee, keep: true,
        hint: order.pg_channel ? `${channelLabel(order.pg_channel)}${payFee ? '' : ' · ditanggung AntarKita'}` : 'Tanpa biaya metode pembayaran' },
      { label: 'Biaya tambahan (parkir/tol/tunggu)', value: order.extras_total ?? 0 },
      { label: 'Tip driver', value: order.tip ?? 0 },
      { label: `Diskon promo${order.promo_code ? ` (${order.promo_code})` : ''}`, value: order.discount, minus: true, hint: funder ? promoOwnerLabel[funder] : null },
    ]} total={order.total + (order.tip ?? 0)} />
  );
}

/** Baris "Kode bantuan CS: AK-xxxxxx" + tombol salin — ditampilkan di detail, bukti, gateway, riwayat (§2 support_ref). */
export function SupportRef({ code, compact }: { code?: string | null; compact?: boolean }) {
  if (!code) return null;
  const copy = async () => { try { await Clipboard.setStringAsync(code); toast.success('Kode bantuan disalin'); } catch { toast.error('Gagal menyalin'); } };
  return (
    <PressableScale onPress={copy} scaleTo={0.98} haptic={false} accessibilityRole="button" accessibilityLabel={`Salin kode bantuan ${code}`} style={[s.ref, compact && { paddingVertical: 4 }]}>
      <Ionicons name="headset-outline" size={16} color={colors.primary} />
      <Text style={[font.small, { flex: 1, color: colors.text }]} numberOfLines={1}>Kode bantuan CS: <Text style={{ fontWeight: '700', fontVariant: ['tabular-nums'] }}>{code}</Text></Text>
      <Ionicons name="copy-outline" size={16} color={colors.primary} />
    </PressableScale>
  );
}

const fmtLeft = (ms: number) => { const t = Math.max(0, Math.floor(ms / 1000)); return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };
const REFUND_STATES: PayStatus[] = ['REFUND_REQUESTED', 'PARTIALLY_REFUNDED', 'REFUNDED'];

/**
 * Panel pembayaran di detail pesanan (pelanggan saja): status real-time, kode bantuan CS, lanjutkan pembayaran
 * (bila masih PENDING — mis. pelanggan menutup aplikasi), bukti transaksi, pengembalian dana & laporan masalah.
 */
export function PaymentPanel({ order, onChanged }: { order: Order; onChanged?: () => void }) {
  const router = useRouter();
  const t = useT();
  const uid = useAuth((st) => st.session?.user.id);
  const mine = IS_CUSTOMER_APP && !!uid && uid === order.customer_id;
  const awaiting = order.status === 'awaiting_payment';
  const nonCash = order.payment_method !== 'cash' || !!order.pg_channel;
  const { status, refresh } = usePaymentStatus(mine && nonCash ? order.id : null, { stopOnFinal: !awaiting, intervalMs: awaiting ? 5000 : 30000 });
  const { providerName } = useProviderPublic();
  const [now, setNow] = useState(Date.now());
  const [box, setBox] = useState<'refund' | 'dispute' | null>(null);
  useEffect(() => { if (!awaiting) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [awaiting]);
  if (!mine) return null;
  const ps = status?.pay_status ?? null;
  const supportRef = status?.support_ref ?? order.payment_support_ref ?? null;
  const left = status?.expires_at ? new Date(status.expires_at).getTime() - now : null;
  const pending = ps === 'PENDING' && (left == null || left > 0);
  const rejected = order.status === 'cancelled' || order.merchant_status === 'rejected';
  const canRefund = rejected && ps === 'PAID';
  const refundState = ps && REFUND_STATES.includes(ps);
  const pgName = status?.provider_label ?? (status?.provider ? providerLabel(status.provider) : providerName);
  const goPay = () => router.push({ pathname: '/pay/gateway', params: { purpose: 'order', order_id: order.id, method: status?.channel ?? order.pg_channel ?? order.paid_via ?? '' } } as never);
  const done = () => { refresh(); onChanged?.(); setBox(null); };
  if (!awaiting && !status && !supportRef && order.payment_method === 'cash' && !order.pg_channel) {
    return <Button title="Lihat bukti transaksi" variant="ghost" icon="receipt-outline" color={colors.textSecondary} onPress={() => router.push({ pathname: '/orders/receipt', params: { id: order.id } } as never)} />;
  }
  return (
    <View style={[s.payBox, awaiting && { borderColor: colors.warning + '66' }]}>
      <Row between style={{ alignItems: 'flex-start' }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={font.h3}>{awaiting ? 'Menunggu pembayaran' : 'Pembayaran'}</Text>
          <Text style={font.tiny} numberOfLines={2}>{status ? `${pgName ?? 'Payment gateway'} · ${status.channel_label ?? (status.channel ? channelLabel(status.channel) : '—')}${status.paid_at ? ` · dibayar ${formatDate(status.paid_at)}` : ''}` : order.payment_method === 'cash' ? 'Tunai ke driver' : paidViaLabel(order.paid_via ?? 'wallet')}</Text>
        </View>
        {ps ? <Badge text={payStatusLabel[ps] ?? ps} color={payStatusColor(ps)} /> : awaiting ? <Badge text="Belum ada tagihan" color={colors.warning} /> : null}
      </Row>
      <SupportRef code={supportRef} />
      {awaiting && pending && left != null && (
        <Row gap={6}><Ionicons name="time-outline" size={16} color={left < 120000 ? colors.danger : colors.warning} /><Text style={{ fontWeight: '700', color: left < 120000 ? colors.danger : colors.text, fontVariant: ['tabular-nums'] }}>Bayar dalam {fmtLeft(left)}</Text></Row>
      )}
      {awaiting && (
        <>
          <Text style={font.small}>{pending ? `Tagihan ${rupiah(status?.amount ?? order.total)} masih aktif. Driver dicarikan otomatis setelah pembayaran diterima.` : ps === 'EXPIRED' ? 'Tagihan sebelumnya kedaluwarsa. Buat tagihan baru selama pesanan belum dibatalkan.' : ps === 'FAILED' ? 'Pembayaran sebelumnya gagal. Coba lagi atau ganti metode.' : `Selesaikan pembayaran ${rupiah(order.total)} agar driver dicarikan. Pesanan batal otomatis bila tidak dibayar dalam batas waktu.`}</Text>
          <Button title={pending ? t('continue_payment') : ps === 'EXPIRED' ? t('new_invoice') : t('pay_now')} icon="card-outline" onPress={goPay} />
        </>
      )}
      {refundState && (
        <Text style={font.small}>{ps === 'REFUND_REQUESTED' ? 'Pengembalian dana sedang diproses. Status diperbarui otomatis.' : `Dana dikembalikan ${rupiah(status?.refunded_amount ?? 0)}${ps === 'PARTIALLY_REFUNDED' ? ' (sebagian)' : ''}.`}</Text>
      )}
      {ps === 'DISPUTED' && <Text style={font.small}>Laporan masalah pembayaran sedang ditangani CS. Pantau di Pusat Bantuan.</Text>}
      <Row gap={8} style={{ flexWrap: 'wrap' }}>
        {!awaiting && <Button title={t('receipt_title')} size="sm" variant="secondary" icon="receipt-outline" onPress={() => router.push({ pathname: '/orders/receipt', params: { id: order.id } } as never)} />}
        {canRefund && box !== 'refund' && <Button title={t('request_refund')} size="sm" variant="outline" icon="return-down-back-outline" onPress={() => setBox('refund')} />}
        {status && box !== 'dispute' && <Button title={t('report_payment_issue')} size="sm" variant="ghost" color={colors.textSecondary} icon="alert-circle-outline" onPress={() => setBox('dispute')} />}
      </Row>
      {box === 'refund' && <RefundBox orderId={order.id} onDone={done} onCancel={() => setBox(null)} />}
      {box === 'dispute' && <DisputeBox orderId={order.id} amount={status?.amount ?? order.total} onDone={done} onCancel={() => setBox(null)} />}
    </View>
  );
}

/** Pratinjau `refund_policy_calc` (komponen yang bisa / tidak bisa dikembalikan) lalu `refund_request`. */
function RefundBox({ orderId, onDone, onCancel }: { orderId: string; onDone: () => void; onCancel: () => void }) {
  const [pol, setPol] = useState<RefundPolicy | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { fetchRefundPolicy(orderId).then(setPol, (e: Error) => setErr(e.message)); }, [orderId]);
  const submit = async () => {
    setBusy(true);
    try { await requestRefund(orderId, reason.trim() || 'Pesanan dibatalkan/ditolak'); toast.success('Pengajuan pengembalian dana dikirim'); onDone(); }
    catch (e) { const m = (e as Error).message; if (m === REFUND_OPEN_TEXT) { toast.show(m); onDone(); } else toast.error(m); }
    finally { setBusy(false); }
  };
  return (
    <View style={s.subBox}>
      <Text style={font.label}>Pratinjau pengembalian dana</Text>
      {err ? <Text style={[font.small, { color: colors.danger }]}>{err}</Text> : !pol ? <Text style={font.small}>Menghitung…</Text> : (
        <View style={{ gap: 4 }}>
          {pol.lines.map((l, i) => (
            <Row key={`${l.label}-${i}`} between style={{ gap: 8 }}>
              <Row gap={6} style={{ flex: 1 }}><Ionicons name={l.refundable ? 'checkmark-circle' : 'close-circle'} size={16} color={l.refundable ? colors.success : colors.textMuted} /><Text style={[font.small, { flex: 1 }]}>{l.label}</Text></Row>
              <Text style={{ fontWeight: '600', color: l.refundable ? colors.text : colors.textMuted, textDecorationLine: l.refundable ? 'none' : 'line-through' }}>{rupiah(l.amount)}</Text>
            </Row>
          ))}
          <Row between style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 6, marginTop: 2 }}><Text style={font.h3}>Dikembalikan</Text><Text style={[font.h3, { color: colors.success }]}>{rupiah(pol.refundable)}</Text></Row>
          {pol.non_refundable > 0 && <Text style={font.tiny}>Tidak dapat dikembalikan: {rupiah(pol.non_refundable)}{pol.note ? ` — ${pol.note}` : ''}</Text>}
        </View>
      )}
      <TextInput placeholder="Alasan (opsional)" placeholderTextColor={colors.textMuted} value={reason} onChangeText={setReason} style={s.input} />
      <Row gap={8}>
        <Button title="Batal" variant="ghost" size="sm" onPress={onCancel} />
        <Button title="Ajukan pengembalian" size="sm" icon="checkmark" loading={busy} disabled={!pol || pol.refundable <= 0} onPress={submit} style={{ flex: 1 }} />
      </Row>
    </View>
  );
}

const DISPUTE_KINDS: DisputeKind[] = ['amount_mismatch', 'not_received', 'other'];
/** Form `dispute_open` (jenis, nominal, deskripsi). Daftar laporan ada di Pusat Bantuan (`my_disputes`). */
function DisputeBox({ orderId, amount, onDone, onCancel }: { orderId: string; amount: number; onDone: () => void; onCancel: () => void }) {
  const router = useRouter();
  const [kind, setKind] = useState<DisputeKind>('amount_mismatch');
  const [nominal, setNominal] = useState(String(amount || ''));
  const [desc, setDesc] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (desc.trim().length < 10) { toast.error('Jelaskan masalahnya minimal 10 karakter'); return; }
    setBusy(true);
    try {
      const n = Number(nominal.replace(/\D/g, ''));
      await openDispute(orderId, kind, n > 0 ? n : null, desc.trim());
      toast.success('Laporan masalah pembayaran dikirim — pantau di Pusat Bantuan');
      onDone();
      router.push('/support' as never);
    } catch (e) { const m = (e as Error).message; if (m === DISPUTE_OPEN_TEXT) { toast.show(m); onDone(); } else toast.error(m); }
    finally { setBusy(false); }
  };
  return (
    <View style={s.subBox}>
      <Text style={font.label}>Laporkan masalah pembayaran</Text>
      <Row gap={6} style={{ flexWrap: 'wrap' }}>{DISPUTE_KINDS.map((k) => <Chip key={k} label={disputeKindLabel[k]} active={kind === k} onPress={() => setKind(k)} />)}</Row>
      <TextInput placeholder="Nominal terkait (Rp)" placeholderTextColor={colors.textMuted} keyboardType="number-pad" value={nominal} onChangeText={(v) => setNominal(v.replace(/\D/g, ''))} style={s.input} />
      <TextInput placeholder="Ceritakan masalahnya (mis. saldo terpotong dua kali)" placeholderTextColor={colors.textMuted} value={desc} onChangeText={setDesc} multiline style={[s.input, { height: 80, paddingTop: 10, textAlignVertical: 'top' }]} />
      <Row gap={8}>
        <Button title="Batal" variant="ghost" size="sm" onPress={onCancel} />
        <Button title="Kirim laporan" size="sm" icon="send" loading={busy} onPress={submit} style={{ flex: 1 }} />
      </Row>
    </View>
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
  bullet: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 4, backgroundColor: colors.shop, alignItems: 'center', justifyContent: 'center' },
  addr: { fontWeight: '600', color: colors.text, fontSize: 14 },
  note: { flexDirection: 'row', gap: 8, backgroundColor: 'rgba(245,158,11,0.12)', padding: 10, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(245,158,11,0.25)' },
  tdot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.border, marginTop: 4 },
  tline: { width: 2, flex: 1, minHeight: 14, backgroundColor: colors.border, marginVertical: 2 },
  ref: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.md, backgroundColor: colors.tint, borderWidth: 1, borderColor: colors.primaryLight },
  payBox: { gap: 10, padding: 16, backgroundColor: '#fff', borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, ...shadow.soft },
  subBox: { gap: 8, padding: 12, borderRadius: radius.md, backgroundColor: colors.bgSoft, borderWidth: 1, borderColor: colors.border },
  input: { backgroundColor: '#fff', borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, height: 44, color: colors.text, fontSize: 14 },
});
