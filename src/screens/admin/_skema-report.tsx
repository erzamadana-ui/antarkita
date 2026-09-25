// Tampilan bersama Laporan Skema Bisnis (Skema Bisnis v2, migrasi 0103) — dipakai Panel Admin
// (rpc('admin_exec_report_v2')) dan Portal Eksekutif tab "Skema Bisnis" (rpc('exec_report_v2', { p_token, … })).
// Satu sumber kebenaran: order_ledger.
// Filter §7: service[], city_id[], merchant_cohort, payment_method, cash_digital, promo_owner.
// Menampilkan GMV bersih, pendapatan platform per sumber, take rate bersih vs target (berlabel),
// contribution/order, EBITDA, tabel per kota/layanan/saluran/bulan, gerbang scale-up, dan legenda label angka.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Panel, DataTable, Toolbar, FilterBar, StatCard, Pill, SoftChip, AdminSelect, Grid, Col, adminFont as font, adminTone, adminSpace, adminRadius, adminIcon, TONE, type ToneKey } from '@/components/admin';
import { DateField, FootNote, LineItem, StackedBars, DefinitionList, RANGE_PRESETS, presetRange, rangeError, rangeLabel, rupiahShort, pctId, type DateRange, type RangePreset } from '@/components/reports';
import { Row, Button } from '@/components/ui';
import { rpc, supabase } from '@/lib/supabase';
import { rupiah, serviceLabel, shortMonth } from '@/lib/format';
import { channelLabel } from '@/store/payprefs';
import type { GateStatus, NumberLabelKind, ServiceType, SkemaGate, SkemaReport } from '@/lib/types';
import { ErrorNote, LabelPill, SERVICE_KEYS, moneyCol, countCol, pctCol, Trunc, WideTableHint } from './_shared';

/** Pemanggil laporan: admin (admin_exec_report_v2) atau eksekutif (exec_report_v2 dengan token sesi). */
export type SkemaReportFetcher = (from: string, to: string, filters: Record<string, unknown>) => Promise<SkemaReport>;

const COHORTS = [{ key: 'all', label: 'Semua merchant' }, { key: 'new_30d', label: 'Merchant baru (30 hari)' }, { key: 'active', label: 'Merchant lama' }];
const CASH_DIGITAL = [{ key: 'all', label: 'Tunai + digital' }, { key: 'cash', label: 'Tunai' }, { key: 'digital', label: 'Digital' }];
const PROMO_OWNERS = [{ value: 'platform', label: 'Promo platform' }, { value: 'merchant', label: 'Promo merchant' }, { value: 'sponsor', label: 'Promo sponsor' }, { value: 'none', label: 'Tanpa promo' }];

const GATE_META: { key: string; title: string; detail: (g: SkemaGate) => string }[] = [
  { key: 'contribution_positive_8w', title: 'Contribution > 0 selama 8 minggu', detail: (g) => `${g.weeks_positive ?? 0} dari ${g.weeks_required ?? 8} minggu positif` },
  { key: 'reconciliation_diff_zero', title: 'Selisih rekonsiliasi = 0', detail: (g) => `Σ|selisih| ${rupiah(Number(g.abs_diff ?? 0))} · ${g.days_with_diff ?? 0} dari ${g.days ?? 0} hari ada selisih` },
  { key: 'payout_on_time', title: 'Payout tepat waktu', detail: (g) => `${g.pct == null ? '—' : pctId(Number(g.pct))} (${g.on_time ?? 0}/${g.due ?? 0}) · target ≥ ${g.target_pct ?? '—'}% · SLA ${g.sla_hours ?? '—'} jam` },
  { key: 'retention_30d_driver', title: 'Retensi 30 hari driver', detail: (g) => `${g.pct == null ? '—' : pctId(Number(g.pct))} (${g.retained ?? 0}/${g.base ?? 0}) · target ≥ ${g.target_pct ?? '—'}%` },
  { key: 'retention_30d_merchant', title: 'Retensi 30 hari merchant', detail: (g) => `${g.pct == null ? '—' : pctId(Number(g.pct))} (${g.retained ?? 0}/${g.base ?? 0}) · target ≥ ${g.target_pct ?? '—'}%` },
  { key: 'fraud_refund', title: 'Refund & fraud terkendali', detail: (g) => `refund ${g.refund_pct == null ? '—' : pctId(Number(g.refund_pct), 2)} (${g.refunded_orders ?? 0}/${g.orders ?? 0}) · maks ${g.max_refund_pct ?? '—'}% · flag fraud ${g.fraud_flags ?? 0} (tinggi terbuka ${g.fraud_high_open ?? 0})` },
];
const GATE_TONE: Record<GateStatus, ToneKey> = { pass: 'ok', fail: 'bad', no_data: 'off' };
const GATE_TEXT: Record<GateStatus, string> = { pass: 'Lolos', fail: 'Belum lolos', no_data: 'Belum ada data' };

const LABEL_NAME: Record<string, string> = {
  take_rate_target_pct: 'Target take rate (north-star)', take_rate_net_pct: 'Take rate bersih', contribution_per_order: 'Contribution per order',
  ebitda_city: 'EBITDA kota', pg_fee: 'Biaya payment gateway', ppn_pct: 'PPN jasa gateway', payout_fee_per_withdrawal: 'Biaya transfer per pencairan',
  variable_ops: 'Biaya variabel ops', ads_prices: 'Harga produk iklan', gate_payout_on_time_pct: 'Gerbang: payout tepat waktu',
  gate_retention_driver_pct: 'Gerbang: retensi driver', gate_retention_merchant_pct: 'Gerbang: retensi merchant', gate_refund_max_pct: 'Gerbang: refund maksimum',
  gate_contribution_weeks: 'Gerbang: minggu contribution positif', gate_reconciliation_diff: 'Gerbang: selisih rekonsiliasi',
  order_payment_timeout_min: 'Batas waktu bayar order gateway', ride_motor_commission_cap_pct: 'Batas komisi roda dua',
};
const DEF_NAME: Record<string, string> = { gmv_net: 'GMV bersih', revenue_net: 'Pendapatan bersih', take_rate_net_pct: 'Take rate bersih', contribution_total: 'Contribution', ebitda_city: 'EBITDA kota' };
const KIND_ORDER: NumberLabelKind[] = ['FAKTA SUMBER', 'ASUMSI', 'HASIL PILOT'];
const fmtLabelValue = (k: string, v: number) =>
  k.endsWith('_pct') ? `${v.toLocaleString('id-ID')}%` : k === 'payout_fee_per_withdrawal' ? rupiah(v) : k.endsWith('_min') ? `${v} menit` : k === 'gate_contribution_weeks' ? `${v} minggu` : k === 'gate_reconciliation_diff' ? rupiah(v) : v.toLocaleString('id-ID');

type CityOpt = { id: string; name: string };

export function SkemaReportView({ fetchReport, refreshKey = 0, onLoaded }: { fetchReport: SkemaReportFetcher; refreshKey?: number; onLoaded?: (r: SkemaReport) => void }) {
  const [preset, setPreset] = useState<RangePreset>('month');
  const [range, setRange] = useState<DateRange>(() => presetRange('month'));
  const [services, setServices] = useState<ServiceType[]>([]);
  const [cityIds, setCityIds] = useState<string[]>([]);
  const [payment, setPayment] = useState('');
  const [cashDigital, setCashDigital] = useState('all');
  const [promoOwner, setPromoOwner] = useState('');
  const [cohort, setCohort] = useState('all');
  const [cities, setCities] = useState<CityOpt[]>([]);
  const [channels, setChannels] = useState<string[]>([]);
  const [optErr, setOptErr] = useState<string[]>([]);
  const [data, setData] = useState<SkemaReport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const invalid = rangeError(range);

  useEffect(() => {
    (async () => {
      const e: string[] = [];
      const { data: c, error } = await supabase.from('cities').select('id,name').eq('service_status', 'aktif').order('name');
      if (error) e.push(`Daftar kota aktif: ${error.message}`); else setCities((c as CityOpt[]) ?? []);
      try { setChannels((await rpc<string[]>('payment_channel_keys')) ?? []); } catch (x) { e.push(`Daftar saluran: ${(x as Error).message}`); }
      setOptErr(e);
    })();
  }, []);

  const filters = useMemo(() => {
    const f: Record<string, unknown> = {};
    if (services.length) f.service = services;
    if (cityIds.length) f.city_id = cityIds;
    if (cohort !== 'all') f.merchant_cohort = cohort;
    if (payment) f.payment_method = payment;
    if (cashDigital !== 'all') f.cash_digital = cashDigital;
    if (promoOwner) f.promo_owner = promoOwner;
    return f;
  }, [services, cityIds, cohort, payment, cashDigital, promoOwner]);

  const load = useCallback(async () => {
    if (rangeError(range)) { setLoading(false); return; }
    setLoading(true);
    try { const r = await fetchReport(range.from, range.to, filters); setData(r); setErr(null); onLoaded?.(r); }
    catch (e) { setErr((e as Error).message); setData(null); }
    finally { setLoading(false); }
  }, [range, filters, fetchReport]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const t = setTimeout(load, 350); return () => clearTimeout(t); }, [load, refreshKey]);

  const pickPreset = (p: RangePreset) => { setPreset(p); if (p !== 'custom') setRange(presetRange(p)); };
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const activeFilters = Object.keys(filters).length;
  const reset = () => { setServices([]); setCityIds([]); setPayment(''); setCashDigital('all'); setPromoOwner(''); setCohort('all'); };

  const sm = data?.summary;
  const labels = data?.labels ?? {};
  const lbl = (k: string) => labels[k]?.label;
  const pos = (n: number | undefined) => ((n ?? 0) >= 0 ? adminTone.green : adminTone.red);
  const target = Number(sm?.take_rate_target_pct ?? labels.take_rate_target_pct?.value ?? 25);
  const tr = Number(sm?.take_rate_net_pct ?? 0);
  const gates = data?.gates ?? {};
  const ready = gates.scale_up_ready === true;

  return (
    <>
      <Toolbar right={activeFilters ? <Button size="sm" variant="ghost" title={`Hapus ${activeFilters} filter`} icon="close-circle-outline" onPress={reset} /> : undefined}>
        <FilterBar options={RANGE_PRESETS as unknown as { key: string; label: string }[]} value={preset} onChange={(v) => pickPreset(v as RangePreset)} />
        {preset === 'custom' ? (
          <Row gap={8} style={{ flexWrap: 'wrap' }}>
            <DateField label="Dari" value={range.from} onChange={(v) => setRange((r) => ({ ...r, from: v }))} />
            <DateField label="Sampai" value={range.to} onChange={(v) => setRange((r) => ({ ...r, to: v }))} />
          </Row>
        ) : <Text style={font.small}>{rangeLabel(range)}</Text>}
      </Toolbar>

      <Panel title="Filter" icon="funnel-outline" subtitle="Kosong = semua. Laporan dimuat ulang otomatis setiap filter berubah.">
        <View style={{ gap: 12 }}>
          {optErr.map((t) => <ErrorNote key={t} text={t} />)}
          <View style={{ gap: 6 }}>
            <Text style={font.label}>Layanan</Text>
            <Row gap={6} style={{ flexWrap: 'wrap' }}>{SERVICE_KEYS.map((k) => <SoftChip key={k} label={serviceLabel[k] ?? k} active={services.includes(k)} onPress={() => setServices((s) => toggle(s, k))} />)}</Row>
          </View>
          <View style={{ gap: 6 }}>
            <Text style={font.label}>Kota (status aktif)</Text>
            <Row gap={6} style={{ flexWrap: 'wrap' }}>
              {cities.length === 0 ? <Text style={font.tiny}>Belum ada kota berstatus aktif.</Text> : cities.map((c) => <SoftChip key={c.id} label={c.name} active={cityIds.includes(c.id)} onPress={() => setCityIds((s) => toggle(s, c.id))} />)}
            </Row>
          </View>
          <Row gap={12} style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <AdminSelect label="Saluran bayar" width={200} value={payment} clearable clearLabel="Semua saluran" onChange={setPayment}
              options={channels.map((k) => ({ value: k, label: channelLabel(k), sublabel: k }))} />
            <AdminSelect label="Pemilik promo" width={190} value={promoOwner} clearable clearLabel="Semua" onChange={setPromoOwner} options={PROMO_OWNERS} />
            <View style={{ gap: 4 }}><Text style={font.label}>Tunai / digital</Text><FilterBar options={CASH_DIGITAL} value={cashDigital} onChange={setCashDigital} /></View>
            <View style={{ gap: 4 }}><Text style={font.label}>Kohort merchant</Text><FilterBar options={COHORTS} value={cohort} onChange={setCohort} /></View>
          </Row>
        </View>
      </Panel>

      <ErrorNote text={invalid} />
      {!invalid ? <ErrorNote text={err} onRetry={load} /> : null}
      {loading && !data ? <Panel><Row gap={10}><ActivityIndicator color={adminTone.teal} /><Text style={font.small}>Menyusun laporan…</Text></Row></Panel> : null}

      {data && sm ? (
        <>
          <Row gap={adminSpace.md} style={{ flexWrap: 'wrap' }}>
            <StatCard index={0} icon="cart-outline" label="GMV bersih" value={rupiah(sm.gmv_net)} color={adminTone.slate} hint={`${sm.orders.toLocaleString('id-ID')} order/perjalanan selesai, tidak direfund`} />
            <StatCard index={1} icon="business-outline" label="Pendapatan platform bersih" value={rupiah(sm.revenue_net)} color={adminTone.teal} hint={`kotor ${rupiah(sm.platform_revenue.total)} − promo platform ${rupiah(sm.promo.platform)}`} />
            <StatCard index={2} icon="pie-chart-outline" label="Take rate bersih" value={pctId(tr, 2)} color={tr >= target ? adminTone.green : adminTone.amber} hint={`target ${pctId(target)} [${lbl('take_rate_target_pct') ?? 'FAKTA SUMBER'}] · ${lbl('take_rate_net_pct') ?? 'HASIL PILOT'}`} />
            <StatCard index={3} icon="stats-chart-outline" label="Contribution / order" value={rupiah(sm.contribution_per_order)} color={pos(sm.contribution_per_order)} hint={`total ${rupiah(sm.contribution_total)} · ${lbl('contribution_per_order') ?? 'HASIL PILOT'}`} />
            <StatCard index={4} icon="trending-up-outline" label="EBITDA" value={rupiah(sm.ebitda)} color={pos(sm.ebitda)} hint={`contribution − biaya tetap ${rupiah(sm.fixed_costs_total)}`} />
          </Row>
          {sm.legacy_units > 0 ? (
            <View style={[st.note, { backgroundColor: TONE.wait.bg, borderColor: TONE.wait.border }]}>
              <Text style={font.small}>{sm.legacy_units.toLocaleString('id-ID')} unit berasal dari order lama (ledger v1, sebelum migrasi 0099) — angkanya direkonstruksi dari kolom orders, bukan dari buku besar.</Text>
            </View>
          ) : null}

          <Grid>
            <Col span={6} min={340}>
              <Panel title="Take rate bersih vs target" icon="speedometer-outline" right={<Row gap={4}>{lbl('take_rate_net_pct') ? <LabelPill text={lbl('take_rate_net_pct') as string} /> : null}</Row>}>
                <View style={{ gap: 10 }}>
                  <View style={st.track}>
                    <View style={[st.fill, { width: `${Math.max(0, Math.min(100, (tr / Math.max(target, 0.01)) * 100))}%`, backgroundColor: tr >= target ? adminTone.green : adminTone.amber }]} />
                  </View>
                  <Row between><Text style={font.bodyStrong}>{pctId(tr, 2)} dari GMV bersih</Text><Row gap={6}><Text style={font.small}>target {pctId(target)}</Text>{lbl('take_rate_target_pct') ? <LabelPill text={lbl('take_rate_target_pct') as string} /> : null}</Row></Row>
                  <Text style={font.tiny}>{labels.take_rate_target_pct?.note ?? 'North-star portofolio matang — bukan target per order dan bukan laba.'}</Text>
                </View>
              </Panel>
            </Col>
            <Col span={6} min={340}>
              <Panel title="Gerbang scale-up" icon="flag-outline" right={<Pill text={ready ? 'SIAP scale-up' : 'Belum siap'} tone={ready ? 'ok' : 'wait'} icon={ready ? 'checkmark-circle' : 'time'} />}>
                <View style={{ gap: 8 }}>
                  {GATE_META.map((m) => {
                    const g = gates[m.key];
                    if (!g || typeof g === 'boolean') return null;
                    const stt = g.status;
                    return (
                      <Row key={m.key} gap={8} style={{ alignItems: 'flex-start' }}>
                        <Ionicons name={stt === 'pass' ? 'checkmark-circle' : stt === 'fail' ? 'close-circle' : 'remove-circle-outline'} size={adminIcon.lg} color={stt === 'pass' ? adminTone.green : stt === 'fail' ? adminTone.red : adminTone.faint} />
                        <View style={{ flex: 1 }}>
                          <Row gap={6} style={{ flexWrap: 'wrap' }}><Text style={font.bodyStrong}>{m.title}</Text><Pill text={GATE_TEXT[stt] ?? stt} tone={GATE_TONE[stt] ?? 'neutral'} /></Row>
                          <Text style={font.tiny}>{m.detail(g)}</Text>
                        </View>
                      </Row>
                    );
                  })}
                  <Row gap={4} style={{ flexWrap: 'wrap', marginTop: 4 }}>
                    {(data.weeks ?? []).map((w) => <Pill key={w.week} text={`${w.week}: ${rupiahShort(w.contribution)}`} tone={w.contribution > 0 ? 'ok' : w.orders > 0 ? 'bad' : 'off'} />)}
                  </Row>
                  <Text style={font.tiny}>Contribution per minggu (8 minggu terakhir s.d. tanggal akhir, mengikuti filter).</Text>
                </View>
              </Panel>
            </Col>
          </Grid>

          <Grid>
            <Col span={6} min={340}>
              <Panel title="Pendapatan platform per sumber" icon="layers-outline">
                <LineItem label="Fee merchant" value={rupiah(sm.platform_revenue.merchant_fee)} />
                <LineItem label="Biaya platform pelanggan" value={rupiah(sm.platform_revenue.customer_platform_fee)} />
                <LineItem label="Komisi dari ongkir (ride/box)" value={rupiah(sm.platform_revenue.driver_commission)} />
                <LineItem label="Jasa belanja bagian platform" value={rupiah(sm.platform_revenue.service_fee_platform)} />
                <LineItem label="Iklan & boost" value={rupiah(sm.platform_revenue.ads)} />
                <LineItem label="Lainnya (antar kota, denda batal)" value={rupiah(sm.platform_revenue.other)} />
                <LineItem top strong label="Pendapatan kotor" value={rupiah(sm.platform_revenue.total)} />
                <LineItem label="− Promo ditanggung platform" value={`− ${rupiah(sm.promo.platform)}`} color={sm.promo.platform ? adminTone.red : undefined} hint={`promo merchant ${rupiah(sm.promo.merchant)} · sponsor ${rupiah(sm.promo.sponsor)} (bukan biaya platform)`} />
                <LineItem top strong label="Pendapatan bersih" value={rupiah(sm.revenue_net)} color={adminTone.teal} />
              </Panel>
            </Col>
            <Col span={6} min={340}>
              <Panel title="Dari pendapatan bersih ke EBITDA" icon="git-merge-outline">
                <LineItem strong label="Pendapatan bersih" value={rupiah(sm.revenue_net)} />
                <LineItem label="− Insentif driver/merchant" value={`− ${rupiah(sm.incentives_total)}`} />
                <LineItem label="− Biaya PG ditanggung platform" value={`− ${rupiah(sm.pg_fee_platform)}`} hint={`total PG ${rupiah(sm.pg_fee_total)} · ditanggung pelanggan ${rupiah(sm.pg_fee_customer)} · top up ${rupiah(sm.pg_fee_topup)}`} />
                <LineItem label="− Biaya PG hangus karena refund" value={`− ${rupiah(sm.refund_pg_cost)}`} hint={`total refund ke pelanggan ${rupiah(sm.refund_total)}`} />
                <LineItem label="− Biaya variabel ops (alokasi)" value={`− ${rupiah(sm.variable_ops_total)}`} />
                <LineItem label="− Biaya transfer pencairan" value={`− ${rupiah(sm.payout_fee_total)}`} hint={`${sm.payouts_settled} pencairan settled`} />
                <LineItem top strong label="Contribution" value={rupiah(sm.contribution_total)} color={pos(sm.contribution_total)} hint={`${rupiah(sm.contribution_per_order)} per order`} />
                <LineItem label="− Biaya tetap kota" value={`− ${rupiah(sm.fixed_costs_total)}`} />
                <LineItem top strong label="EBITDA" value={rupiah(sm.ebitda)} color={pos(sm.ebitda)} />
              </Panel>
            </Col>
          </Grid>

          <Panel title="Pendapatan bersih per bulan" subtitle="12 bulan s.d. tanggal akhir, mengikuti filter" icon="bar-chart-outline">
            <StackedBars height={130} format={rupiahShort} legend={[{ label: 'Pendapatan bersih', color: adminTone.teal }]}
              data={(data.by_month ?? []).map((m) => ({ label: shortMonth(m.month), segments: [{ value: m.revenue, color: adminTone.teal }] }))} />
          </Panel>

          <Panel title="Per kota" subtitle="EBITDA kota = contribution − biaya tetap kota (pro-rata hari pada rentang)" icon="business-outline" padded={false}>
            <DataTable keyField="city" rows={(data.by_city ?? []) as unknown as Record<string, unknown>[]} emptyText="Tidak ada data kota" columns={[
              { key: 'city', label: 'Kota', width: 170, render: (r) => <Trunc style={font.bodyStrong} title={String(r.city)}>{String(r.city ?? '—')}</Trunc> },
              countCol('orders', 'Order', 80), moneyCol('gmv_net', 'GMV bersih', 130), moneyCol('revenue', 'Pendapatan', 124, adminTone.teal), pctCol('take_rate_pct', 'Take rate', 90),
              moneyCol('contribution', 'Contribution', 130, (r) => pos(Number(r.contribution))), moneyCol('fixed_costs', 'Biaya tetap', 120, adminTone.orange),
              moneyCol('ebitda_city', 'EBITDA kota', 130, (r) => pos(Number(r.ebitda_city))),
            ]} />
          </Panel>

          <Grid>
            <Col span={6} min={420}>
              <Panel title="Per layanan" icon="apps-outline" padded={false}>
                <DataTable keyField="service" rows={(data.by_service ?? []) as unknown as Record<string, unknown>[]} emptyText="Tidak ada data" columns={[
                  { key: 'service', label: 'Layanan', width: 120, render: (r) => <Text style={font.bodyStrong}>{serviceLabel[r.service as ServiceType] ?? String(r.service)}</Text> },
                  countCol('orders', 'Order', 70), moneyCol('gmv_net', 'GMV bersih', 120), moneyCol('revenue', 'Pendapatan', 116, adminTone.teal),
                  pctCol('take_rate_pct', 'Take rate', 84), moneyCol('contribution', 'Contribution', 120, (r) => pos(Number(r.contribution))), moneyCol('pg_fee', 'Biaya PG', 100, adminTone.orange),
                ]} />
              </Panel>
            </Col>
            <Col span={6} min={420}>
              <Panel title="Per saluran bayar" icon="card-outline" padded={false}>
                <DataTable keyField="channel" rows={(data.by_payment ?? []) as unknown as Record<string, unknown>[]} emptyText="Tidak ada data" columns={[
                  { key: 'label', label: 'Saluran', width: 140, render: (r) => <Text style={font.bodyStrong}>{String(r.label ?? r.channel)}</Text> },
                  countCol('orders', 'Order', 70), moneyCol('gmv_net', 'GMV bersih', 120), moneyCol('revenue', 'Pendapatan', 116, adminTone.teal),
                  moneyCol('pg_fee', 'Biaya PG', 100, adminTone.orange), moneyCol('pg_fee_platform', 'PG platform', 104), moneyCol('contribution', 'Contribution', 120, (r) => pos(Number(r.contribution))),
                ]} />
              </Panel>
            </Col>
          </Grid>

          <Panel title="Per bulan" icon="calendar-outline" padded={false}>
            <DataTable keyField="month" rows={(data.by_month ?? []) as unknown as Record<string, unknown>[]} emptyText="Tidak ada data" columns={[
              { key: 'month', label: 'Bulan', width: 100, render: (r) => <Text style={font.bodyStrong}>{shortMonth(String(r.month))}</Text> },
              countCol('orders', 'Order', 80), moneyCol('gmv_net', 'GMV bersih', 130), moneyCol('revenue', 'Pendapatan', 124, adminTone.teal), pctCol('take_rate_pct', 'Take rate', 90),
              moneyCol('contribution', 'Contribution', 130, (r) => pos(Number(r.contribution))), moneyCol('fixed_costs', 'Biaya tetap', 120, adminTone.orange), moneyCol('ebitda', 'EBITDA', 130, (r) => pos(Number(r.ebitda))),
            ]} />
          </Panel>

          {(data.cohort ?? []).length ? (
            <Panel title="Kohort merchant (bulan order pertama)" icon="people-outline" padded={false}>
              <DataTable keyField="cohort" rows={data.cohort as unknown as Record<string, unknown>[]} columns={[
                { key: 'cohort', label: 'Kohort', width: 100, render: (r) => <Text style={font.bodyStrong}>{shortMonth(String(r.cohort))}</Text> },
                countCol('merchants', 'Merchant', 90), countCol('orders', 'Order', 80), moneyCol('gmv_net', 'GMV bersih', 130), moneyCol('revenue', 'Pendapatan', 124, adminTone.teal),
              ]} />
            </Panel>
          ) : null}
          <WideTableHint />

          <Panel title="Label angka" subtitle="Setiap angka target/asumsi diberi label supaya jelas mana fakta, mana asumsi yang masih bisa diubah, dan mana hasil pilot" icon="pricetags-outline">
            <View style={{ gap: 14 }}>
              <Row gap={10} style={{ flexWrap: 'wrap' }}>
                <Row gap={6}><LabelPill text="FAKTA SUMBER" /><Text style={font.tiny}>dari dokumen keputusan, PKS, regulasi, atau kode</Text></Row>
                <Row gap={6}><LabelPill text="ASUMSI" /><Text style={font.tiny}>usulan — wajib bisa diubah dari Panel Admin</Text></Row>
                <Row gap={6}><LabelPill text="HASIL PILOT" /><Text style={font.tiny}>dihitung dari data nyata periode ini</Text></Row>
              </Row>
              {KIND_ORDER.map((kind) => {
                const items = Object.entries(labels).filter(([, v]) => v?.label === kind);
                if (!items.length) return null;
                return (
                  <View key={kind} style={{ gap: 6 }}>
                    <Text style={font.label}>{kind}</Text>
                    {items.map(([k, v]) => (
                      <Row key={k} gap={8} style={{ alignItems: 'flex-start' }}>
                        <View style={{ width: 8, height: 8, borderRadius: 4, marginTop: 6, backgroundColor: TONE[kind === 'FAKTA SUMBER' ? 'ok' : kind === 'ASUMSI' ? 'wait' : 'info'].fg }} />
                        <Text style={[font.small, { flex: 1 }]}>
                          <Text style={{ color: adminTone.ink, fontWeight: '700' }}>{LABEL_NAME[k] ?? k}</Text>
                          {v.value != null ? <Text style={{ color: adminTone.ink }}> · {fmtLabelValue(k, Number(v.value))}</Text> : null}
                          {v.note ? <Text> — {v.note}</Text> : null}
                        </Text>
                      </Row>
                    ))}
                  </View>
                );
              })}
            </View>
          </Panel>

          {data.definitions ? (
            <Panel title="Definisi" icon="book-outline">
              <DefinitionList items={Object.entries(data.definitions).map(([k, v]) => ({ term: DEF_NAME[k] ?? k, desc: v }))} />
            </Panel>
          ) : null}
        </>
      ) : null}

      <FootNote lines={[
        `Periode ${rangeLabel(range)} (WIB). Semua angka dihitung dari order_ledger (satu sumber kebenaran) — order selesai & tidak direfund, perjalanan travel selesai, denda batal, iklan, dan refund.`,
        'Take rate bersih = pendapatan bersih ÷ GMV bersih. Target 25 % adalah north-star portofolio matang, bukan target per order dan bukan laba.',
        'Contribution = pendapatan bersih − insentif − biaya PG yang ditanggung platform − biaya PG hangus karena refund − biaya variabel ops − biaya transfer pencairan. EBITDA = contribution − biaya tetap kota.',
        'Filter kohort merchant, saluran bayar, dan pemilik promo hanya berlaku untuk unit yang punya atribut tersebut (mis. kohort merchant mengecualikan order tanpa merchant).',
      ]} />
    </>
  );
}

const st = StyleSheet.create({
  note: { borderWidth: 1, borderRadius: adminRadius.card, padding: adminSpace.md },
  track: { height: 14, borderRadius: 999, backgroundColor: adminTone.border, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 999 },
});
