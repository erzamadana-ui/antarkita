// Bukti transaksi (`/orders/receipt?id=<order_id>`) — dari `my_receipt(p_order)` (KONTRAK-API-V3 §2, §0.4):
// semua baris rincian, provider & kanal, waktu bayar, kode bantuan CS (support_ref) + salin, bagian
// "Yang dapat / tidak dapat dikembalikan" (refundable_note), serta tombol bagikan/simpan (Share API; web: cetak/PDF).
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Share, Platform } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Clipboard from 'expo-clipboard';
import { Screen, Card, Row, Button, Badge, Empty, Loading, toast } from '@/components/ui';
import { Entrance } from '@/components/motion';
import { PriceSummary } from '@/components/BookingSheet';
import { SupportRef } from '@/components/OrderDetails';
import { fetchReceipt, receiptRows, providerLabel } from '@/lib/payments';
import { useT } from '@/lib/i18n';
import { colors, font, radius } from '@/lib/theme';
import { rupiah, formatDate, serviceLabel, statusLabel, payStatusLabel, payStatusColor, paidViaLabel } from '@/lib/format';
import { channelLabel } from '@/store/payprefs';
import type { Receipt } from '@/lib/types';

/** Pecah catatan refund server menjadi butir: kalimat yang menyebut "tidak dikembalikan" masuk kolom tidak dapat. */
function splitRefundNote(note?: string | null) {
  const parts = (note ?? '').split(/(?<=\.)\s+/).map((x) => x.trim()).filter(Boolean);
  return { yes: parts.filter((p) => !/tidak (dapat |bisa )?dikembalikan/i.test(p)), no: parts.filter((p) => /tidak (dapat |bisa )?dikembalikan/i.test(p)) };
}

function receiptText(r: Receipt, provider: string): string {
  const rows = receiptRows(r, provider);
  const lines = [
    `Bukti transaksi AntarKita — ${r.code ?? r.order_id}`,
    r.service ? serviceLabel[r.service] : null,
    r.created_at ? `Tanggal: ${formatDate(r.created_at)}` : null,
    `Pembayaran: ${r.channel_label ?? (r.channel ? channelLabel(r.channel) : paidViaLabel(r.payment_method ?? null))}${r.provider ? ` via ${provider}` : ''}`,
    r.paid_at ? `Dibayar: ${formatDate(r.paid_at)}` : null,
    '',
    ...rows.map((x) => `${x.label}: ${x.minus ? '-' : ''}${rupiah(x.value)}`),
    `Total: ${rupiah(r.total_paid ?? r.total)}`,
    r.refunded_amount ? `Dikembalikan: ${rupiah(r.refunded_amount)}` : null,
    '',
    r.support_ref ? `Kode bantuan CS: ${r.support_ref}` : null,
  ];
  return lines.filter((x) => x !== null).join('\n');
}

export default function ReceiptScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const t = useT();
  const [r, setR] = useState<Receipt | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    if (!id) { setErr('Pesanan tidak ditemukan.'); setLoading(false); return; }
    setLoading(true);
    try { setR(await fetchReceipt(id)); setErr(null); } catch (e) { setErr((e as Error).message); }
    finally { setLoading(false); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  if (loading) return <Screen title={t('receipt_title')} back><Loading text={t('loading')} /></Screen>;
  if (err || !r) return <Screen title={t('receipt_title')} back><Empty icon="receipt-outline" title={t('receipt_unavailable')} subtitle={err ?? undefined} action={<Button title={t('retry')} icon="refresh" onPress={load} />} /></Screen>;

  const provider = r.provider_label ?? providerLabel(r.provider);
  const refund = splitRefundNote(r.refundable_note);
  const share = async () => { try { await Share.share({ message: receiptText(r, provider), title: `Bukti ${r.code ?? ''}` }); } catch { /* dibatalkan */ } };
  const save = () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && typeof window.print === 'function') { window.print(); return; }
    share();
  };
  const copyAll = async () => { try { await Clipboard.setStringAsync(receiptText(r, provider)); toast.success('Bukti transaksi disalin'); } catch { toast.error('Gagal menyalin'); } };

  return (
    <Screen title={t('receipt_title')} subtitle={r.code ?? undefined} back maxWidth={560}>
      <View style={{ gap: 14 }}>
        <Entrance index={0}><Card>
          <Row between style={{ alignItems: 'flex-start' }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={font.h3}>{r.service ? serviceLabel[r.service] : 'Pesanan'} · {r.code ?? '—'}</Text>
              <Text style={font.tiny}>{r.created_at ? formatDate(r.created_at) : ''}{r.status && r.service ? ` · ${statusLabel(r.status, r.service)}` : ''}</Text>
            </View>
            {r.pay_status ? <Badge text={payStatusLabel[r.pay_status] ?? r.pay_status} color={payStatusColor(r.pay_status)} /> : r.payment_status === 'paid' ? <Badge text="Lunas" color={colors.success} /> : null}
          </Row>
          <View style={s.kv}>
            <KV label="Metode" value={r.channel_label ?? (r.channel ? channelLabel(r.channel) : paidViaLabel(r.payment_method ?? null))} />
            {r.provider ? <KV label="Diproses oleh" value={provider} /> : null}
            <KV label="Waktu bayar" value={r.paid_at ? formatDate(r.paid_at) : r.payment_method === 'cash' ? 'Tunai ke driver' : '—'} />
          </View>
          <View style={{ marginTop: 10 }}><SupportRef code={r.support_ref} /></View>
        </Card></Entrance>

        <Entrance index={1}><Card>
          <Text style={[font.label, { marginBottom: 10 }]}>Rincian</Text>
          <PriceSummary rows={receiptRows(r, provider)} total={r.total_paid ?? r.total} />
          {r.refunded_amount ? <Row between style={{ marginTop: 8 }}><Text style={font.small}>Dana dikembalikan</Text><Text style={{ fontWeight: '700', color: colors.info }}>{rupiah(r.refunded_amount)}</Text></Row> : null}
        </Card></Entrance>

        {r.refundable_note ? (
          <Entrance index={2}><Card>
            <Text style={[font.label, { marginBottom: 8 }]}>Yang dapat / tidak dapat dikembalikan</Text>
            {refund.yes.map((x, i) => <Row key={`y${i}`} gap={8} style={s.bullet}><Ionicons name="checkmark-circle" size={16} color={colors.success} /><Text style={[font.small, { flex: 1 }]}>{x}</Text></Row>)}
            {refund.no.map((x, i) => <Row key={`n${i}`} gap={8} style={s.bullet}><Ionicons name="close-circle" size={16} color={colors.danger} /><Text style={[font.small, { flex: 1 }]}>{x}</Text></Row>)}
          </Card></Entrance>
        ) : null}

        <Entrance index={3}>
          <Row gap={8}>
            <Button title={t('share')} icon="share-social-outline" variant="secondary" style={{ flex: 1 }} onPress={share} />
            <Button title={Platform.OS === 'web' ? t('save_pdf') : t('copy')} icon={Platform.OS === 'web' ? 'download-outline' : 'copy-outline'} variant="outline" style={{ flex: 1 }} onPress={Platform.OS === 'web' ? save : copyAll} />
          </Row>
        </Entrance>
        <Button title={t('report_payment_issue')} variant="ghost" color={colors.textSecondary} icon="alert-circle-outline" onPress={() => router.push(`/order/${r.order_id}` as never)} />
      </View>
    </Screen>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return <Row between style={{ gap: 12 }}><Text style={font.small}>{label}</Text><Text style={[font.small, { color: colors.text, fontWeight: '600', flexShrink: 1, textAlign: 'right' }]}>{value}</Text></Row>;
}

const s = StyleSheet.create({
  kv: { gap: 6, marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border },
  bullet: { alignItems: 'flex-start', paddingVertical: 4, borderRadius: radius.sm },
});
