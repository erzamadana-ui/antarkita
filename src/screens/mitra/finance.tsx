// Kartu keuangan bersama aplikasi Mitra (driver · merchant · pedagang pasar) — Finpay v3:
//  - EarningsReportCard : laporan pendapatan per periode (hari ini / 7 hari / bulan ini) + ekspor CSV
//  - MyDisputesCard     : ringkasan `my_disputes()` + tautan ke /mitra/disputes
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Row, Badge, Button, Chip, toast } from '@/components/ui';
import { PressableScale, Skeleton } from '@/components/motion';
import { supabase } from '@/lib/supabase';
import { colors, font, radius, shadow } from '@/lib/theme';
import { rupiah, formatDate, serviceLabel, driverEarningOf, paidViaLabel } from '@/lib/format';
import {
  PERIODS, periodRange, ymd, exportMitraCsv, settlementLabel, loadMyDisputes, disputeKindLabel, disputeStatusMeta,
  type PeriodKey, type MyDispute, type DisputeStatus, type SettlementStatus,
} from '@/lib/mitra';
import type { Order } from '@/lib/types';

type ReportOrder = Order & { settlement_status?: SettlementStatus | null };

/**
 * Laporan pendapatan per periode dari pesanan selesai milik mitra (RLS: driver_id / merchant_id).
 * Angka per pesanan yang final tetap di rincian buku besar (driver_order_breakdown / merchant_order_breakdown).
 */
export function EarningsReportCard({ role, ownerId, accent = colors.primary }: { role: 'driver' | 'merchant'; ownerId?: string | null; accent?: string }) {
  const [period, setPeriod] = useState<PeriodKey>('7d');
  const [rows, setRows] = useState<ReportOrder[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    if (!ownerId) return;
    const { from } = periodRange(period);
    setRows(null);
    const { data, error } = await supabase.from('orders').select('*')
      .eq(role === 'driver' ? 'driver_id' : 'merchant_id', ownerId).eq('status', 'completed')
      .gte('completed_at', from.toISOString()).order('completed_at', { ascending: false }).limit(500);
    if (error) { setErr(error.message); setRows([]); return; }
    setErr(null); setRows((data as ReportOrder[]) ?? []);
  }, [ownerId, role, period]);
  useEffect(() => { load(); }, [load]);

  const net = (o: ReportOrder) => (role === 'driver' ? driverEarningOf(o) : o.merchant_earning ?? 0);
  const sum = useMemo(() => {
    const list = rows ?? [];
    const total = list.reduce((a, o) => a + net(o), 0);
    const base = list.reduce((a, o) => a + (role === 'driver' ? o.fare_delivery ?? 0 : o.items_subtotal ?? 0), 0);
    const tip = list.reduce((a, o) => a + (o.tip ?? 0), 0);
    const byDay = new Map<string, { n: number; total: number }>();
    for (const o of list) {
      const d = ymd(new Date(o.completed_at ?? o.created_at));
      const cur = byDay.get(d) ?? { n: 0, total: 0 };
      byDay.set(d, { n: cur.n + 1, total: cur.total + net(o) });
    }
    return { count: list.length, total, base, tip, days: Array.from(byDay.entries()).sort((a, b) => b[0].localeCompare(a[0])) };
  }, [rows, role]); // eslint-disable-line react-hooks/exhaustive-deps

  const exportCsv = async () => {
    const list = rows ?? [];
    const label = PERIODS.find((p) => p.key === period)?.label ?? period;
    const { from, to } = periodRange(period);
    const headers = role === 'driver'
      ? ['Kode', 'Selesai', 'Layanan', 'Pembayaran', 'Nilai transaksi pelanggan', 'Ongkir', 'Komisi %', 'Tip', 'Extras', 'Pendapatan bersih', 'Status settlement']
      : ['Kode', 'Selesai', 'Pembayaran', 'Nilai transaksi pelanggan', 'Nilai barang', 'Fee %', 'Diterima', 'Status settlement'];
    const data = list.map((o) => role === 'driver'
      ? [o.code, formatDate(o.completed_at ?? o.created_at), serviceLabel[o.service] ?? o.service, paidViaLabel(o.paid_via ?? (o.payment_method === 'cash' ? 'cash' : 'wallet')), o.total, o.fare_delivery, o.driver_commission_pct_snap ?? '', o.tip ?? 0, o.extras_total ?? 0, net(o), settlementLabel(o.settlement_status)]
      : [o.code, formatDate(o.completed_at ?? o.created_at), paidViaLabel(o.paid_via ?? (o.payment_method === 'cash' ? 'cash' : 'wallet')), o.total, o.items_subtotal, o.merchant_fee_pct_snap ?? '', net(o), settlementLabel(o.settlement_status)]);
    try {
      await exportMitraCsv(`pendapatan-${role}-${ymd(from)}_${ymd(to)}.csv`, headers, data);
      toast.success(`${data.length} pesanan (${label}) diekspor`);
    } catch (e) { toast.error((e as Error).message); }
  };

  const days = showAll ? sum.days : sum.days.slice(0, 7);
  return (
    <View style={s.card}>
      <Row between><Text style={font.h3}>Laporan pendapatan</Text><Ionicons name="bar-chart-outline" size={20} color={accent} /></Row>
      <Row gap={8} style={{ flexWrap: 'wrap' }}>{PERIODS.map((p) => <Chip key={p.key} label={p.label} active={period === p.key} onPress={() => { setPeriod(p.key); setShowAll(false); }} color={accent} />)}</Row>
      {err ? <Text style={[font.tiny, { color: colors.danger }]}>Laporan belum bisa dimuat: {err}</Text> : null}
      {!rows ? <View style={{ gap: 8 }}><Skeleton height={48} radius={radius.md} /><Skeleton width="60%" height={14} /></View> : (
        <>
          <Row gap={10}>
            <View style={s.tile}><Text style={font.tiny}>{role === 'driver' ? 'Pendapatan bersih' : 'Diterima'}</Text><Text style={[font.h3, { color: accent }]}>{rupiah(sum.total)}</Text></View>
            <View style={s.tile}><Text style={font.tiny}>Pesanan selesai</Text><Text style={font.h3}>{sum.count}</Text></View>
          </Row>
          <Row gap={10}>
            <View style={s.tile}><Text style={font.tiny}>{role === 'driver' ? 'Total ongkir/tarif' : 'Total nilai barang'}</Text><Text style={[font.body, { fontWeight: '700' }]}>{rupiah(sum.base)}</Text></View>
            {role === 'driver'
              ? <View style={s.tile}><Text style={font.tiny}>Total tip</Text><Text style={[font.body, { fontWeight: '700' }]}>{rupiah(sum.tip)}</Text></View>
              : <View style={s.tile}><Text style={font.tiny}>Fee & promo merchant</Text><Text style={[font.body, { fontWeight: '700' }]}>{rupiah(Math.max(0, sum.base - sum.total))}</Text></View>}
          </Row>
          {days.length ? (
            <View style={{ gap: 2 }}>
              {days.map(([d, v]) => (
                <Row key={d} between style={s.dayRow}>
                  <Text style={font.small}>{formatDate(`${d}T12:00:00`, false)}</Text>
                  <Text style={font.tiny}>{v.n} pesanan</Text>
                  <Text style={{ fontWeight: '700', color: colors.text, minWidth: 96, textAlign: 'right' }}>{rupiah(v.total)}</Text>
                </Row>
              ))}
              {sum.days.length > 7 ? <PressableScale onPress={() => setShowAll((v) => !v)} haptic={false} style={{ paddingVertical: 8, alignItems: 'center' }}><Text style={{ color: accent, fontWeight: '700' }}>{showAll ? 'Ringkas' : `Semua ${sum.days.length} hari`}</Text></PressableScale> : null}
            </View>
          ) : <Text style={font.small}>Belum ada pesanan selesai pada periode ini.</Text>}
          <Button title="Ekspor CSV" size="sm" variant="secondary" icon="download-outline" color={accent} onPress={exportCsv} disabled={!sum.count} />
          <Text style={font.tiny}>Ringkasan dari pesanan selesai. Rincian final per pesanan (komisi/fee, promo, biaya pembayaran & penanggungnya) ada di buku besar tiap pesanan.</Text>
        </>
      )}
    </View>
  );
}

/** Ringkasan laporan selisih/dispute milik saya (my_disputes). */
export function MyDisputesCard({ limit = 3 }: { limit?: number }) {
  const router = useRouter();
  const [rows, setRows] = useState<MyDispute[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setRows(await loadMyDisputes()); setErr(null); } catch (e) { setErr((e as Error).message); setRows([]); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const open = (rows ?? []).filter((d) => d.status === 'open' || d.status === 'investigating').length;
  return (
    <View style={s.card}>
      <Row between>
        <Text style={font.h3}>Laporan selisih</Text>
        {open ? <Badge text={`${open} diproses`} color={colors.warning} /> : null}
      </Row>
      <Text style={font.tiny}>Nominal di rincian tidak sesuai atau pencairan belum masuk? Buka rincian pesanan lalu ketuk “Laporkan selisih”.</Text>
      {err ? <Text style={[font.tiny, { color: colors.danger }]}>Daftar laporan belum bisa dimuat: {err}</Text> : null}
      {!rows ? <Skeleton height={40} radius={radius.md} /> : rows.slice(0, limit).map((d) => <DisputeRow key={d.id} d={d} compact />)}
      {rows && rows.length > 0 ? <Button title={`Lihat semua (${rows.length})`} size="sm" variant="ghost" icon="list-outline" onPress={() => router.push('/mitra/disputes' as never)} /> : null}
    </View>
  );
}

export function DisputeRow({ d, compact }: { d: MyDispute; compact?: boolean }) {
  const st = disputeStatusMeta[d.status as DisputeStatus] ?? { label: d.status, color: colors.textMuted };
  return (
    <View style={s.dispute}>
      <Row between style={{ alignItems: 'flex-start' }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontWeight: '700', color: colors.text }} numberOfLines={1}>{disputeKindLabel[d.kind] ?? d.kind}{d.order_code ? ` · ${d.order_code}` : ''}</Text>
          <Text style={font.tiny}>{formatDate(d.created_at)}{d.amount ? ` · ${rupiah(d.amount)}` : ''}</Text>
        </View>
        <Badge text={st.label} color={st.color} />
      </Row>
      {!compact && d.description ? <Text style={[font.small, { marginTop: 6 }]}>{d.description}</Text> : null}
      {d.resolution ? <Text style={[font.tiny, { marginTop: 4, color: colors.text }]}>Hasil: {d.resolution}{d.resolved_at ? ` (${formatDate(d.resolved_at)})` : ''}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  card: { gap: 10, padding: 14, borderRadius: radius.lg, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, ...shadow.soft },
  tile: { flex: 1, gap: 2, padding: 12, borderRadius: radius.md, backgroundColor: colors.bgSoft },
  dayRow: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 8 },
  dispute: { padding: 10, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgSoft },
});
