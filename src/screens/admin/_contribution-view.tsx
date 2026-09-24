// Tampilan Contribution Margin (finpay-v3, kontrak §6) — dipakai Panel Admin (/contribution) dan Portal Eksekutif.
// Sumber: rpc('admin_contribution_margin', { p_from, p_to, p_group: 'service'|'city'|'merchant'|'month' }) →
//   key, orders, gross, platform_revenue, pg_fee_platform, promo_platform, refund_fraud, variable_cost, contribution_margin, take_rate_net_pct.
// Bar sederhana dengan View proporsional (tanpa pustaka grafik baru).
// Bukan route: expo-router hanya membaca apps/<app>/app.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Panel, DataTable, Toolbar, FilterBar, StatCard, Pill, adminFont as font, adminTone, adminSpace, adminRadius, adminIcon, TONE } from '@/components/admin';
import { DateField, FootNote, RANGE_PRESETS, presetRange, rangeError, rangeLabel, type DateRange, type RangePreset } from '@/components/reports';
import { Row } from '@/components/ui';
import { rupiah, serviceLabel, shortMonth } from '@/lib/format';
import type { ServiceType } from '@/lib/types';
import { asList, type ContributionGroup, type ContributionRow } from '@/lib/admin';
import { ErrorNote, moneyCol, countCol } from './_shared';

export type ContributionFetch = (from: string, to: string, group: ContributionGroup) => Promise<unknown>;

const GROUPS: { key: ContributionGroup; label: string }[] = [
  { key: 'service', label: 'Per layanan' }, { key: 'city', label: 'Per kota' }, { key: 'merchant', label: 'Per merchant' }, { key: 'month', label: 'Per bulan' },
];
const TARGET_NET_TAKE = 25;

const keyLabel = (g: ContributionGroup, r: ContributionRow) => {
  const k = r.key ?? '';
  if (r.label) return r.label;
  if (g === 'service') return serviceLabel[k as ServiceType] ?? (k || '—');
  if (g === 'month') return /^\d{4}-\d{2}/.test(k) ? shortMonth(k.slice(0, 7)) : k || '—';
  return k || '(tanpa kota/merchant)';
};

export function ContributionView({ fetch, defaultPreset = 'month' }: { fetch: ContributionFetch; defaultPreset?: RangePreset }) {
  const [preset, setPreset] = useState<RangePreset>(defaultPreset);
  const [range, setRange] = useState<DateRange>(() => presetRange(defaultPreset === 'custom' ? 'month' : defaultPreset));
  const [group, setGroup] = useState<ContributionGroup>('service');
  const [rows, setRows] = useState<ContributionRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const invalid = rangeError(range);

  const load = useCallback(async () => {
    if (rangeError(range)) { setLoading(false); return; }
    setLoading(true);
    try {
      const list = asList<ContributionRow>(await fetch(range.from, range.to, group)).map((r) => ({
        ...r, orders: Number(r.orders ?? 0), gross: Number(r.gross ?? 0), platform_revenue: Number(r.platform_revenue ?? 0),
        pg_fee_platform: Number(r.pg_fee_platform ?? 0), promo_platform: Number(r.promo_platform ?? 0), refund_fraud: Number(r.refund_fraud ?? 0),
        variable_cost: Number(r.variable_cost ?? 0), contribution_margin: Number(r.contribution_margin ?? 0), take_rate_net_pct: Number(r.take_rate_net_pct ?? 0),
      }));
      setRows(group === 'month' ? list.sort((a, b) => String(a.key).localeCompare(String(b.key))) : list.sort((a, b) => b.contribution_margin - a.contribution_margin));
      setErr(null);
    } catch (e) { setErr((e as Error).message); setRows([]); }
    finally { setLoading(false); }
  }, [fetch, range, group]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  const tot = useMemo(() => {
    const s = (k: keyof ContributionRow) => rows.reduce((a, r) => a + Number(r[k] ?? 0), 0);
    const gross = s('gross');
    // take rate bersih total = rata-rata tertimbang GMV (konsisten dengan rumus server per baris)
    const take = gross > 0 ? rows.reduce((a, r) => a + r.take_rate_net_pct * r.gross, 0) / gross : 0;
    return { orders: s('orders'), gross, rev: s('platform_revenue'), pg: s('pg_fee_platform'), promo: s('promo_platform'), refund: s('refund_fraud'), vc: s('variable_cost'), cm: s('contribution_margin'), take };
  }, [rows]);
  const maxAbs = Math.max(1, ...rows.map((r) => Math.abs(r.contribution_margin)));
  const shown = rows.slice(0, group === 'merchant' ? 30 : 60);

  return (
    <View style={{ gap: adminSpace.lg }}>
      <Toolbar>
        <FilterBar options={GROUPS} value={group} onChange={(v) => setGroup(v as ContributionGroup)} />
        <FilterBar options={RANGE_PRESETS as unknown as { key: string; label: string }[]} value={preset} onChange={(v) => { setPreset(v as RangePreset); if (v !== 'custom') setRange(presetRange(v as RangePreset)); }} />
        {preset === 'custom' ? (
          <Row gap={8} style={{ flexWrap: 'wrap' }}>
            <DateField label="Dari" value={range.from} onChange={(v) => setRange((r) => ({ ...r, from: v }))} />
            <DateField label="Sampai" value={range.to} onChange={(v) => setRange((r) => ({ ...r, to: v }))} />
          </Row>
        ) : <Text style={font.small}>{rangeLabel(range)}</Text>}
      </Toolbar>
      <ErrorNote text={invalid} />
      {!invalid ? <ErrorNote text={err} onRetry={load} /> : null}

      <Row gap={adminSpace.md} style={{ flexWrap: 'wrap' }}>
        <StatCard index={0} icon="receipt-outline" label="Pesanan" value={tot.orders} color={adminTone.blue} />
        <StatCard index={1} icon="cart-outline" label="GMV (gross)" value={rupiah(tot.gross)} color={adminTone.slate} />
        <StatCard index={2} icon="business-outline" label="Pendapatan platform" value={rupiah(tot.rev)} color={adminTone.teal} hint="fee merchant + biaya platform + iklan" />
        <StatCard index={3} icon="stats-chart-outline" label="Contribution margin" value={rupiah(tot.cm)} color={tot.cm >= 0 ? adminTone.green : adminTone.red}
          hint={tot.orders ? `${rupiah(Math.round(tot.cm / tot.orders))} per pesanan` : undefined} />
        <StatCard index={4} icon="speedometer-outline" label="Take rate bersih" value={`${tot.take.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`}
          color={tot.take >= TARGET_NET_TAKE ? adminTone.green : adminTone.amber} hint={`target tahap matang ${TARGET_NET_TAKE} % (bukan laba)`} />
      </Row>

      <View style={[st.note, { backgroundColor: TONE.info.bg, borderColor: TONE.info.border }]}>
        <Row gap={8} style={{ alignItems: 'flex-start' }}>
          <Ionicons name="information-circle-outline" size={adminIcon.md} color={TONE.info.fg} />
          <Text style={[font.small, { flex: 1 }]}>
            <Text style={{ fontWeight: '700', color: TONE.info.fg }}>Target 25 % = take rate bersih tahap matang, bukan laba. </Text>
            Take rate bersih = pendapatan platform setelah promo platform ÷ GMV. Contribution margin = pendapatan platform − biaya PG yang ditanggung platform − promo platform − refund/fraud − biaya variabel per order [ASUMSI, app_settings.variable_cost_per_order]. Belum termasuk biaya tetap kota (gaji, kantor, akuisisi).
          </Text>
        </Row>
      </View>

      <Panel title="Contribution margin" subtitle={`${GROUPS.find((g) => g.key === group)?.label} · batang hijau = positif, merah = negatif (proporsional terhadap nilai terbesar)`} icon="bar-chart-outline">
        {loading && rows.length === 0 ? <Text style={font.small}>Memuat…</Text> : null}
        {!loading && rows.length === 0 && !err ? <Text style={font.small}>Belum ada pesanan pada rentang ini.</Text> : null}
        <View style={{ gap: 6 }}>
          {shown.map((r, i) => {
            const w = `${Math.max(1, (Math.abs(r.contribution_margin) / maxAbs) * 100)}%` as const;
            const pos = r.contribution_margin >= 0;
            return (
              <Row key={`${r.key ?? i}`} gap={10} style={{ alignItems: 'center' }}>
                <Text style={[font.small, { width: 170, color: adminTone.ink }]} numberOfLines={1}>{keyLabel(group, r)}</Text>
                <View style={st.track}>
                  <View style={[st.bar, { width: w, backgroundColor: pos ? adminTone.green : adminTone.red }]} />
                </View>
                <Text style={[font.mono, { width: 124, textAlign: 'right', color: pos ? adminTone.ink : adminTone.red }]}>{rupiah(r.contribution_margin)}</Text>
                <View style={{ width: 88, alignItems: 'flex-end' }}>
                  <Pill text={`${r.take_rate_net_pct.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`} tone={r.take_rate_net_pct >= TARGET_NET_TAKE ? 'ok' : r.take_rate_net_pct > 0 ? 'wait' : 'bad'} />
                </View>
              </Row>
            );
          })}
          {rows.length > shown.length ? <Text style={font.tiny}>Menampilkan {shown.length} dari {rows.length} baris di grafik; tabel di bawah memuat semuanya.</Text> : null}
        </View>
      </Panel>

      <Panel title="Rincian" icon="grid-outline" padded={false}>
        <DataTable keyField="key" rows={rows.map((r, i) => ({ ...r, key: r.key ?? `__${i}` })) as unknown as Record<string, unknown>[]} emptyText="Tidak ada data" columns={[
          { key: 'key', label: GROUPS.find((g) => g.key === group)?.label.replace('Per ', '') ?? 'Kunci', width: 170, render: (r) => <Text style={font.bodyStrong} numberOfLines={1}>{keyLabel(group, r as unknown as ContributionRow)}</Text> },
          countCol('orders', 'Pesanan', 84),
          moneyCol('gross', 'GMV', 126),
          moneyCol('platform_revenue', 'Pendapatan', 124, adminTone.teal),
          moneyCol('pg_fee_platform', 'Biaya PG (platform)', 132, adminTone.orange),
          moneyCol('promo_platform', 'Promo platform', 120, adminTone.orange),
          moneyCol('refund_fraud', 'Refund/fraud', 112, adminTone.orange),
          moneyCol('variable_cost', 'Biaya variabel', 116),
          moneyCol('contribution_margin', 'Contribution', 128, (r) => (Number(r.contribution_margin) >= 0 ? adminTone.green : adminTone.red)),
          { key: 'take_rate_net_pct', label: 'Take rate bersih', width: 120, align: 'right', mono: true, render: (r) => <Text style={[font.mono, { color: Number(r.take_rate_net_pct) >= TARGET_NET_TAKE ? adminTone.green : adminTone.ink }]}>{`${Number(r.take_rate_net_pct ?? 0).toLocaleString('id-ID', { maximumFractionDigits: 2 })}%`}</Text> },
        ]} />
        <View style={st.total}>
          {[['Pendapatan', rupiah(tot.rev)], ['Biaya PG platform', rupiah(tot.pg)], ['Promo platform', rupiah(tot.promo)], ['Refund/fraud', rupiah(tot.refund)], ['Biaya variabel', rupiah(tot.vc)], ['Contribution', rupiah(tot.cm)]].map(([k, v]) => (
            <View key={k} style={{ minWidth: 130, gap: 2 }}><Text style={font.label}>{k}</Text><Text style={font.mono}>{v}</Text></View>
          ))}
        </View>
      </Panel>

      <FootNote lines={[
        'Sumber: buku besar order (order_ledger) lewat admin_contribution_margin. Ongkir food/send/shop/market/box adalah hak driver 100 % dan tidak dihitung sebagai pendapatan platform.',
        'Take rate bersih kolom per baris dihitung server; total di kartu = rata-rata tertimbang GMV.',
        'Target 25 % adalah target take rate bersih portofolio pada tahap matang — bukan target laba, bukan potongan driver. Tidak ada klaim laba 25 % di laporan ini.',
      ]} />
    </View>
  );
}

const st = StyleSheet.create({
  note: { borderWidth: 1, borderRadius: adminRadius.card, padding: adminSpace.md },
  track: { flex: 1, height: 14, borderRadius: 7, backgroundColor: adminTone.surfaceAlt, borderWidth: 1, borderColor: adminTone.border, overflow: 'hidden' },
  bar: { height: '100%', borderRadius: 7, opacity: 0.85 },
  total: { flexDirection: 'row', flexWrap: 'wrap', gap: adminSpace.xl, paddingHorizontal: adminSpace.lg, paddingVertical: adminSpace.md, borderTopWidth: 1, borderTopColor: adminTone.border, backgroundColor: adminTone.surfaceAlt },
});
