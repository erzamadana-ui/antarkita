// Admin · Rekonsiliasi & Payout (Skema Bisnis v2, migrasi 0102).
// rpc('admin_reconciliation', { p_from, p_to }) → rekonsiliasi harian gateway (v_reconciliation_daily:
// diff = pembayaran settlement − (gross pesanan digital + dana dikreditkan ke saldo), harus 0) dan
// penarikan mitra berstatus approved yang BELUM settled (approved ≠ uang sampai, §0.4).
// "Tandai settled" → rpc('admin_mark_withdrawal_settled', { p_id, p_provider_ref }) (PIN + notifikasi ke mitra).
// v3 (finpay-v3, kontrak §2/§6): daftar reconciliation_runs + tombol admin_reconcile_run(p_date); selisih (entry unreconciled);
// transaksi menggantung (payments PENDING > 30 menit); inbox webhook admin_payment_events(p_external_id).
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, ScrollView, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AdminPage, Panel, DataTable, Toolbar, FilterBar, StatCard, Pill, AdminDialog, RequirePerm, adminFont as font, adminTone, adminSpace, adminIcon, adminRadius } from '@/components/admin';
import { DateField, FootNote, RANGE_PRESETS, presetRange, rangeError, rangeLabel, type DateRange, type RangePreset } from '@/components/reports';
import { Row, Input, Button, toast } from '@/components/ui';
import { rpc, supabase } from '@/lib/supabase';
import { PAY_STATUS_LABEL, PAYMENT_COLS_V3, addDaysYmd, asList, providerLabel, shortId, todayWib, type PaymentEvent, type PaymentRowV3, type ReconciliationRun } from '@/lib/admin';
import { rupiah } from '@/lib/format';
import { handleAdminError, useAdminSecurity } from '@/store/adminSecurity';
import type { AdminReconciliation, UnsettledPayout } from '@/lib/types';
import { ErrorNote, LabelPill, fmtDate, fmtAgo, labelTags, moneyCol, countCol, Trunc, WideTableHint } from './_shared';

export default function AdminReconciliation() {
  const [preset, setPreset] = useState<RangePreset>('month');
  const [range, setRange] = useState<DateRange>(() => presetRange('month'));
  const [data, setData] = useState<AdminReconciliation | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [settle, setSettle] = useState<UnsettledPayout | null>(null);
  const [ref, setRef] = useState('');
  const [busy, setBusy] = useState(false);
  const invalid = rangeError(range);

  const load = useCallback(async () => {
    if (rangeError(range)) { setLoading(false); return; }
    setLoading(true);
    try { setData(await rpc<AdminReconciliation>('admin_reconciliation', { p_from: range.from, p_to: range.to })); setErr(null); }
    catch (e) { setErr((e as Error).message); setData(null); }
    finally { setLoading(false); }
  }, [range]);
  useEffect(() => { const t = setTimeout(load, 300); return () => clearTimeout(t); }, [load]);

  const pickPreset = (p: RangePreset) => { setPreset(p); if (p !== 'custom') setRange(presetRange(p)); };

  const submitSettle = async () => {
    if (!settle) return;
    const v = ref.trim();
    if (v.length < 3 || v.length > 120) return toast.error('Nomor referensi bank/provider wajib 3–120 karakter');
    if (!(await useAdminSecurity.getState().ensureUnlocked())) return;
    setBusy(true);
    try {
      await rpc('admin_mark_withdrawal_settled', { p_id: settle.id, p_provider_ref: v });
      toast.success(`Penarikan ${rupiah(settle.amount)} ${settle.name ?? ''} ditandai settled (ref ${v})`);
      setSettle(null); setRef(''); await load();
    } catch (e) { handleAdminError(e); } finally { setBusy(false); }
  };

  const t = data?.totals;
  const p = data?.payouts;
  const sla = Number(p?.sla_hours ?? 24);
  const overdue = (iso: string) => Date.now() - new Date(iso).getTime() > sla * 3600000;
  const diffColor = (n: number) => (n === 0 ? adminTone.green : adminTone.red);

  return (
    <AdminPage title="Rekonsiliasi" subtitle="Job rekonsiliasi harian, transaksi menggantung, inbox webhook, selisih gateway ↔ buku besar ↔ saldo, dan penarikan mitra yang belum settled." onRefresh={load}
      right={<Button size="sm" variant="outline" title="Segarkan" icon="refresh-outline" onPress={load} />}>
      <Toolbar>
        <FilterBar options={RANGE_PRESETS as unknown as { key: string; label: string }[]} value={preset} onChange={(v) => pickPreset(v as RangePreset)} />
        {preset === 'custom' ? (
          <Row gap={8} style={{ flexWrap: 'wrap' }}>
            <DateField label="Dari" value={range.from} onChange={(v) => setRange((r) => ({ ...r, from: v }))} />
            <DateField label="Sampai" value={range.to} onChange={(v) => setRange((r) => ({ ...r, to: v }))} />
          </Row>
        ) : <Text style={font.small}>{rangeLabel(range)}</Text>}
      </Toolbar>
      <ErrorNote text={invalid} />
      {!invalid ? <ErrorNote text={err} onRetry={load} /> : null}

      <RunsPanel />
      <HangingAndInbox />

      <Text style={[font.h2, { marginTop: adminSpace.sm }]}>Rekonsiliasi gateway per tanggal & payout</Text>

      <Row gap={adminSpace.md} style={{ flexWrap: 'wrap' }}>
        <StatCard index={0} icon="card-outline" label="Pembayaran settlement" value={rupiah(t?.payments_settled ?? 0)} color={adminTone.blue} hint={`${data?.days.reduce((s, d) => s + Number(d.payments_count), 0) ?? 0} transaksi`} />
        <StatCard index={1} icon="receipt-outline" label="Gross pesanan digital" value={rupiah(t?.gross_customer_digital ?? 0)} color={adminTone.teal} hint="buku besar fase created (tanpa tip)" />
        <StatCard index={2} icon="wallet-outline" label="Dikreditkan ke saldo" value={rupiah(t?.topups_credited ?? 0)} color={adminTone.violet} hint={`top up · refund bayar telat ${rupiah(t?.late_payment_refunds ?? 0)}`} />
        <StatCard index={3} icon="pricetag-outline" label="Biaya gateway (+PPN)" value={rupiah(t?.pg_fee_total ?? 0)} color={adminTone.orange} hint={`bersih dicairkan ${rupiah(t?.net_settlement ?? 0)} · ditahan ${rupiah(t?.held_amount ?? 0)}`} />
        <StatCard index={4} icon={(t?.abs_diff ?? 0) === 0 ? 'checkmark-circle-outline' : 'alert-circle-outline'} label="Selisih (harus 0)" value={rupiah(t?.diff ?? 0)} color={diffColor(t?.abs_diff ?? 0)}
          hint={`${t?.days_with_diff ?? 0} hari ada selisih · Σ|selisih| ${rupiah(t?.abs_diff ?? 0)}`} />
      </Row>

      <Panel title="Rekonsiliasi harian" subtitle="Per tanggal settlement (WIB). Selisih ≠ 0 = ada pembayaran yang tidak tercatat di buku besar/saldo, atau sebaliknya." icon="git-compare-outline" padded={false}
        right={data?.labels?.diff ? <Row gap={4}>{labelTags(data.labels.diff).map((x) => <LabelPill key={x} text={x} />)}</Row> : undefined}>
        {loading && !data ? <Row gap={8} style={{ padding: adminSpace.lg }}><ActivityIndicator color={adminTone.teal} /><Text style={font.small}>Memuat…</Text></Row> : (
          <DataTable keyField="day" rows={(data?.days ?? []) as unknown as Record<string, unknown>[]} emptyText="Tidak ada pembayaran gateway settlement pada rentang ini" emptyIcon="git-compare-outline" columns={[
            { key: 'day', label: 'Tanggal', width: 120, render: (r) => <Text style={font.bodyStrong}>{fmtDate(`${String(r.day)}T00:00:00`, false)}</Text> },
            countCol('payments_count', 'Transaksi', 90),
            countCol('order_payments', 'Pesanan', 80),
            moneyCol('payments_settled', 'Settlement', 124),
            moneyCol('gross_customer_digital', 'Gross pesanan', 124, adminTone.teal),
            moneyCol('topups_credited', 'Top up', 110, adminTone.violet),
            moneyCol('late_payment_refunds', 'Refund telat', 110),
            moneyCol('pg_fee_total', 'Biaya PG', 104, adminTone.orange),
            moneyCol('net_settlement', 'Bersih', 124),
            moneyCol('held_amount', 'Ditahan', 110),
            moneyCol('diff', 'Selisih', 110, (r) => diffColor(Number(r.diff))),
          ]} />
        )}
      </Panel>

      <Row gap={adminSpace.md} style={{ flexWrap: 'wrap' }}>
        <StatCard index={0} icon="hourglass-outline" label="Approved belum settled" value={p?.approved_unsettled.count ?? 0} color={adminTone.amber} hint={`${rupiah(p?.approved_unsettled.amount ?? 0)} · semua tanggal`} />
        <StatCard index={1} icon="alarm-outline" label={`Lewat SLA ${sla} jam`} value={p?.approved_unsettled.overdue ?? 0} color={(p?.approved_unsettled.overdue ?? 0) > 0 ? adminTone.red : adminTone.green} hint="sejak disetujui" />
        <StatCard index={2} icon="checkmark-done-outline" label="Settled di rentang" value={p?.settled.count ?? 0} color={adminTone.green}
          hint={`${rupiah(p?.settled.amount ?? 0)} · tepat waktu ${p?.settled.on_time ?? 0}/${p?.settled.count ?? 0}`} />
        <StatCard index={3} icon="document-outline" label="Diajukan & approved di rentang" value={p?.approved_in_range ?? 0} color={adminTone.slate} />
      </Row>

      <Panel title="Penarikan approved — belum settled" subtitle="Tandai settled HANYA setelah ada konfirmasi transfer dari bank/provider. Mitra menerima notifikasi berisi nomor referensi." icon="cash-outline" padded={false}
        right={data?.labels?.payout_sla_hours ? <Row gap={4}>{labelTags(data.labels.payout_sla_hours).map((x) => <LabelPill key={x} text={x} />)}</Row> : undefined}>
        <DataTable rows={(p?.approved_unsettled.items ?? []) as unknown as Record<string, unknown>[]} emptyText="Tidak ada penarikan yang menunggu settled" emptyIcon="checkmark-done-outline" columns={[
          { key: 'name', label: 'Mitra', width: 190, render: (r) => { const w = r as unknown as UnsettledPayout; return <View style={{ minWidth: 0, alignSelf: 'stretch' }}><Trunc style={font.bodyStrong} title={w.name ?? ''}>{w.name ?? '—'}</Trunc><Text style={font.tiny}>diajukan {fmtDate(w.created_at)}</Text></View>; } },
          moneyCol('amount', 'Nominal', 120),
          { key: 'bank', label: 'Rekening', width: 230, render: (r) => { const w = r as unknown as UnsettledPayout; return <View style={{ minWidth: 0, alignSelf: 'stretch' }}><Trunc style={font.body} title={`${w.bank_name} ${w.bank_account}`}>{w.bank_name} · {w.bank_account}</Trunc><Trunc style={font.tiny} title={w.account_name}>a.n. {w.account_name}</Trunc></View>; } },
          { key: 'approved_at', label: 'Disetujui', width: 150, render: (r) => { const w = r as unknown as UnsettledPayout; return <View><Text style={font.small}>{fmtDate(w.approved_at)}</Text><Text style={[font.tiny, overdue(w.approved_at) ? { color: adminTone.red } : null]}>{fmtAgo(w.approved_at)}</Text></View>; } },
          { key: 'auto', label: 'Jalur', width: 110, render: (r) => <Pill text={r.auto ? 'Otomatis' : 'Manual'} tone={r.auto ? 'info' : 'neutral'} /> },
          { key: 'sla', label: 'SLA', width: 110, render: (r) => overdue(String(r.approved_at)) ? <Pill text="Terlambat" tone="bad" icon="alarm" /> : <Pill text="Dalam SLA" tone="ok" /> },
          { key: 'actions', label: 'Aksi', width: 150, render: (r) => <Button size="sm" title="Tandai settled" icon="checkmark" onPress={() => { setSettle(r as unknown as UnsettledPayout); setRef(''); }} /> },
        ]} />
      </Panel>
      <WideTableHint />

      <AdminDialog visible={!!settle} onClose={() => setSettle(null)} title="Tandai penarikan settled"
        subtitle={settle ? `${settle.name ?? '—'} · ${rupiah(settle.amount)} · ${settle.bank_name} ${settle.bank_account} a.n. ${settle.account_name}` : undefined}>
        <View style={{ gap: 10 }}>
          <Row gap={8} style={{ alignItems: 'flex-start' }}>
            <Ionicons name="information-circle-outline" size={adminIcon.md} color={adminTone.muted} />
            <Text style={[font.small, { flex: 1 }]}>Masukkan nomor referensi transfer dari bank/provider (3–120 karakter, tidak boleh sama dengan penarikan lain). Tindakan ini butuh PIN panel, tercatat di log aktivitas, dan mengirim notifikasi ke mitra.</Text>
          </Row>
          <Input label="Nomor referensi bank/provider" placeholder="mis. IRIS-20260923-000123" value={ref} onChangeText={setRef} autoCapitalize="characters" onSubmitEditing={submitSettle} />
          <Row gap={8} style={{ justifyContent: 'flex-end' }}>
            <Button size="sm" variant="ghost" title="Batal" onPress={() => setSettle(null)} />
            <Button size="sm" title="Tandai settled" icon="checkmark-done" loading={busy} disabled={ref.trim().length < 3} onPress={submitSettle} />
          </Row>
        </View>
      </AdminDialog>

      <FootNote lines={[
        'Selisih harian = pembayaran gateway berstatus settlement − (gross pesanan digital di buku besar fase created + dana yang dikreditkan ke saldo pada ref yang sama). Harus 0 sebelum scale-up [FAKTA SUMBER §6].',
        'Bersih = settlement − biaya gateway (+PPN) = yang seharusnya dicairkan Midtrans; Ditahan = bagian yang masih dalam masa hold H+n (payments.hold_until > sekarang).',
        `Penarikan “approved” belum berarti uang sampai. Status settled hanya setelah konfirmasi bank/provider. SLA pencairan ${sla} jam sejak disetujui [ASUMSI, app_settings.payout_sla_hours].`,
        `Rentang ${rangeLabel(range)} (WIB). Daftar approved-belum-settled mencakup semua tanggal, bukan hanya rentang ini.`,
      ]} />
    </AdminPage>
  );
}

/* ───────────────────── v3 · Job rekonsiliasi harian (reconciliation_runs) ───────────────────── */

const RUN_STATUS: Record<string, { label: string; tone: 'ok' | 'wait' | 'bad' }> = { running: { label: 'Berjalan', tone: 'wait' }, done: { label: 'Selesai', tone: 'ok' }, failed: { label: 'Gagal', tone: 'bad' } };
const jsonText = (v: unknown) => { try { return JSON.stringify(v, null, 1); } catch { return String(v); } };

function RunsPanel() {
  const [runs, setRuns] = useState<ReconciliationRun[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [date, setDate] = useState(() => addDaysYmd(todayWib(), -1));
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<ReconciliationRun | null>(null);
  const [unrec, setUnrec] = useState<Record<string, unknown>[]>([]);
  const [unrecErr, setUnrecErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('reconciliation_runs').select('*').order('created_at', { ascending: false }).limit(30);
    if (error) setErr(error.message); else { setErr(null); setRuns((data as ReconciliationRun[]) ?? []); }
    const u = await supabase.from('order_ledger').select('id,order_id,source,entry,amount,payment_id,phase,note,created_at').eq('entry', 'unreconciled').order('id', { ascending: false }).limit(50);
    if (u.error) setUnrecErr(u.error.message); else { setUnrecErr(null); setUnrec((u.data as Record<string, unknown>[]) ?? []); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const run = async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return toast.error('Tanggal tidak valid');
    if (date >= todayWib()) return toast.error('Rekonsiliasi hanya untuk tanggal yang sudah lewat (H-1 atau sebelumnya)');
    setBusy(true);
    try {
      await rpc('admin_reconcile_run', { p_date: date });
      toast.success(`Rekonsiliasi ${date} dijalankan`);
      await load();
    } catch (e) { handleAdminError(e); } finally { setBusy(false); }
  };

  const report = (open?.report ?? {}) as Record<string, unknown>;
  const mism = asList<Record<string, unknown>>(report.mismatches ?? report.items ?? report.diffs);
  return (
    <>
      <Panel title="Job rekonsiliasi harian" subtitle="reconcile_daily: payments PAID ↔ payment_events ↔ buku besar gross_customer ↔ wallet_transactions. Cron 02:00 WIB; tombol untuk menjalankan ulang tanggal tertentu." icon="git-merge-outline" padded={false}
        right={<RequirePerm perm="reconcile"><Row gap={8} style={{ alignItems: 'flex-end' }}><DateField value={date} onChange={setDate} /><Button size="sm" title="Jalankan" icon="play-outline" loading={busy} onPress={run} /></Row></RequirePerm>}>
        <View style={{ paddingHorizontal: adminSpace.lg, paddingTop: err ? adminSpace.md : 0 }}><ErrorNote text={err} onRetry={load} /></View>
        <DataTable rows={runs as unknown as Record<string, unknown>[]} emptyText="Belum ada run rekonsiliasi" emptyIcon="git-merge-outline" onRowPress={(r) => setOpen(r as unknown as ReconciliationRun)} columns={[
          { key: 'run_date', label: 'Tanggal', width: 116, render: (r) => <Text style={font.bodyStrong}>{fmtDate(`${String(r.run_date).slice(0, 10)}T00:00:00`, false)}</Text> },
          { key: 'provider', label: 'Provider', width: 100, render: (r) => <Text style={font.small}>{r.provider ? providerLabel(String(r.provider)) : 'Semua'}</Text> },
          { key: 'kind', label: 'Jenis', width: 90, render: (r) => <Pill text={r.kind === 'manual' ? 'Manual' : 'Harian'} tone={r.kind === 'manual' ? 'info' : 'neutral'} /> },
          countCol('payments_checked', 'Diperiksa', 96),
          { key: 'mismatches', label: 'Selisih', width: 90, align: 'right', mono: true, render: (r) => <Text style={[font.mono, { color: Number(r.mismatches) ? adminTone.red : adminTone.green }]}>{Number(r.mismatches ?? 0).toLocaleString('id-ID')}</Text> },
          moneyCol('unreconciled_amount', 'Nilai belum cocok', 140, (r) => (Number(r.unreconciled_amount) ? adminTone.red : undefined)),
          { key: 'status', label: 'Status', width: 100, render: (r) => { const x = RUN_STATUS[String(r.status)]; return <Pill text={x?.label ?? String(r.status)} tone={x?.tone ?? 'neutral'} />; } },
          { key: 'created_at', label: 'Dijalankan', width: 150, flex: 1, render: (r) => <Text style={font.tiny}>{fmtDate(String(r.created_at))} · klik untuk detail</Text> },
        ]} />
      </Panel>

      <Panel title="Selisih belum terekonsiliasi" subtitle="Baris order_ledger entry=unreconciled (ditulis job rekonsiliasi) — 50 terbaru. Telusuri lewat Buku Besar / inbox webhook." icon="alert-circle-outline" iconColor={adminTone.red} padded={false}>
        <View style={{ paddingHorizontal: adminSpace.lg, paddingTop: unrecErr ? adminSpace.md : 0 }}><ErrorNote text={unrecErr} onRetry={load} /></View>
        <DataTable rows={unrec} emptyText="Tidak ada selisih yang tercatat" emptyIcon="checkmark-done-outline" columns={[
          { key: 'id', label: '#', width: 70, mono: true },
          { key: 'created_at', label: 'Waktu', width: 140, render: (r) => <Text style={font.tiny}>{fmtDate(String(r.created_at))}</Text> },
          moneyCol('amount', 'Nominal', 120, adminTone.red),
          { key: 'order_id', label: 'Order / sumber', width: 160, render: (r) => <Text style={font.tiny} selectable>{r.order_id ? shortId(String(r.order_id)) : String(r.source ?? '—')}</Text> },
          { key: 'payment_id', label: 'Pembayaran', width: 120, render: (r) => <Text style={font.tiny} selectable>{r.payment_id ? shortId(String(r.payment_id)) : '—'}</Text> },
          { key: 'note', label: 'Keterangan', width: 300, flex: 1, render: (r) => <Text style={font.small} numberOfLines={2}>{String(r.note ?? '—')}</Text> },
        ]} />
      </Panel>

      <AdminDialog visible={!!open} onClose={() => setOpen(null)} width={760} title={`Detail rekonsiliasi ${open ? String(open.run_date).slice(0, 10) : ''}`}
        subtitle={open ? `${open.payments_checked} pembayaran diperiksa · ${open.mismatches} selisih · ${rupiah(open.unreconciled_amount)} belum cocok` : undefined}>
        {mism.length ? (
          <DataTable rows={mism.map((m, i) => ({ _i: i, ...m }))} keyField="_i" maxHeight={320} columns={[
            { key: 'external_id', label: 'External ID', width: 180, render: (r) => <Text style={font.tiny} selectable>{String(r.external_id ?? r.payment_id ?? '—')}</Text> },
            { key: 'reason', label: 'Alasan', width: 200, render: (r) => <Text style={font.small} numberOfLines={2}>{String(r.reason ?? r.kind ?? r.type ?? '—')}</Text> },
            { key: 'expected', label: 'Seharusnya', width: 110, align: 'right', mono: true, render: (r) => <Text style={font.mono}>{r.expected != null ? rupiah(Number(r.expected)) : '—'}</Text> },
            { key: 'actual', label: 'Tercatat', width: 110, align: 'right', mono: true, render: (r) => <Text style={font.mono}>{r.actual != null ? rupiah(Number(r.actual)) : '—'}</Text> },
            { key: 'diff', label: 'Selisih', width: 110, align: 'right', mono: true, render: (r) => <Text style={[font.mono, { color: adminTone.red }]}>{r.diff != null ? rupiah(Number(r.diff)) : '—'}</Text> },
          ]} />
        ) : null}
        <Text style={font.label}>Laporan mentah (report)</Text>
        <ScrollView style={{ maxHeight: 260 }}><Text selectable style={s.pre}>{jsonText(open?.report ?? {})}</Text></ScrollView>
      </AdminDialog>
    </>
  );
}

/* ───────────────────── v3 · Transaksi menggantung & inbox webhook ───────────────────── */

function HangingAndInbox() {
  const [hang, setHang] = useState<PaymentRowV3[]>([]);
  const [hangErr, setHangErr] = useState<string | null>(null);
  const [ext, setExt] = useState('');
  const [events, setEvents] = useState<PaymentEvent[]>([]);
  const [evErr, setEvErr] = useState<string | null>(null);
  const [evBusy, setEvBusy] = useState(false);
  const [raw, setRaw] = useState<PaymentEvent | null>(null);

  const loadHang = useCallback(async () => {
    const cutoff = new Date(Date.now() - 30 * 60000).toISOString();
    let res: { data: unknown; error: { message: string } | null } = await supabase.from('payments').select(PAYMENT_COLS_V3).eq('pay_status', 'PENDING').lt('created_at', cutoff).order('created_at', { ascending: true }).limit(100);
    if (res.error && /pay_status|column/i.test(res.error.message)) {
      // kolom v3 belum ada → kolom lama
      res = await supabase.from('payments').select('id,user_id,order_id,purpose,amount,method,provider,status,external_id,created_at').eq('status', 'pending').lt('created_at', cutoff).order('created_at', { ascending: true }).limit(100);
    }
    if (res.error) { setHangErr(res.error.message); return; }
    setHangErr(null); setHang((res.data as PaymentRowV3[]) ?? []);
  }, []);
  useEffect(() => { loadHang(); }, [loadHang]);

  const loadEvents = useCallback(async (id?: string) => {
    const v = (id ?? ext).trim();
    setEvBusy(true);
    try { setEvents(asList<PaymentEvent>(await rpc('admin_payment_events', { p_external_id: v || null }))); setEvErr(null); }
    catch (e) { setEvErr((e as Error).message); setEvents([]); }
    finally { setEvBusy(false); }
  }, [ext]);
  const pick = (id: string | null) => { if (!id) return; setExt(id); loadEvents(id); };

  return (
    <>
      <Panel title={`Transaksi menggantung (${hang.length})`} subtitle="payments PENDING > 30 menit. Edge pay-reconcile mengecek status ke provider secara berkala; klik “Event” untuk melihat webhook yang sudah masuk." icon="hourglass-outline" iconColor={adminTone.amber} padded={false}
        right={<Button size="sm" variant="outline" title="Segarkan" icon="refresh-outline" onPress={loadHang} />}>
        <View style={{ paddingHorizontal: adminSpace.lg, paddingTop: hangErr ? adminSpace.md : 0 }}><ErrorNote text={hangErr} onRetry={loadHang} /></View>
        <DataTable rows={hang as unknown as Record<string, unknown>[]} emptyText="Tidak ada transaksi menggantung" emptyIcon="checkmark-done-outline" maxHeight={420} columns={[
          { key: 'created_at', label: 'Dibuat', width: 140, render: (r) => <View><Text style={font.small}>{fmtDate(String(r.created_at))}</Text><Text style={[font.tiny, { color: adminTone.red }]}>{fmtAgo(String(r.created_at))}</Text></View> },
          { key: 'external_id', label: 'External ID / ref', width: 210, render: (r) => <View style={{ minWidth: 0, alignSelf: 'stretch' }}><Trunc style={font.small} title={String(r.external_id ?? '')}>{String(r.external_id ?? r.provider_ref ?? r.id)}</Trunc>{r.support_ref ? <Text style={font.tiny}>CS {String(r.support_ref)}</Text> : null}</View> },
          { key: 'provider', label: 'Provider · env', width: 110, render: (r) => <View><Text style={font.small}>{providerLabel(String(r.provider))}</Text>{r.env ? <Text style={[font.tiny, r.env === 'production' ? { color: adminTone.red } : null]}>{String(r.env)}</Text> : null}</View> },
          { key: 'purpose', label: 'Tujuan', width: 80, render: (r) => <Text style={font.small}>{r.purpose === 'topup' ? 'Top up' : 'Pesanan'}</Text> },
          moneyCol('amount', 'Nominal', 110),
          { key: 'expires_at', label: 'Kedaluwarsa', width: 130, render: (r) => <Text style={font.tiny}>{r.expires_at ? fmtDate(String(r.expires_at)) : '—'}</Text> },
          { key: 'pay_status', label: 'Status', width: 100, render: (r) => <Pill text={PAY_STATUS_LABEL[String(r.pay_status ?? 'PENDING')] ?? String(r.pay_status ?? r.status)} tone="wait" /> },
          { key: 'actions', label: 'Aksi', width: 90, render: (r) => <Button size="sm" variant="outline" title="Event" onPress={() => pick(String(r.external_id ?? r.provider_ref ?? ''))} /> },
        ]} />
      </Panel>

      <Panel title="Inbox webhook (payment_events)" subtitle="admin_payment_events — setiap notifikasi provider tercatat sekali (append-only). Duplikat ditolak oleh unique (provider, event_id)." icon="mail-unread-outline" padded={false}
        right={<Row gap={8} style={{ alignItems: 'flex-end' }}>
          <Input placeholder="external_id / order.id provider" value={ext} onChangeText={setExt} onSubmitEditing={() => loadEvents()} containerStyle={{ width: 260 }} style={{ paddingVertical: 4 }} autoCapitalize="none" />
          <Button size="sm" title="Cari" icon="search" loading={evBusy} onPress={() => loadEvents()} />
        </Row>}>
        <View style={{ paddingHorizontal: adminSpace.lg, paddingTop: evErr ? adminSpace.md : 0 }}><ErrorNote text={evErr} /></View>
        <DataTable rows={events as unknown as Record<string, unknown>[]} emptyText={ext ? 'Belum ada event untuk external_id ini' : 'Masukkan external_id (kosong = event terbaru bila server mendukung)'} emptyIcon="mail-outline" onRowPress={(r) => setRaw(r as unknown as PaymentEvent)} columns={[
          { key: 'received_at', label: 'Diterima', width: 140, render: (r) => <Text style={font.tiny}>{fmtDate(String(r.received_at))}</Text> },
          { key: 'provider', label: 'Provider', width: 90, render: (r) => <Text style={font.small}>{providerLabel(String(r.provider))}</Text> },
          { key: 'event_id', label: 'Event ID', width: 170, render: (r) => <Trunc style={font.tiny} title={String(r.event_id)}>{String(r.event_id)}</Trunc> },
          { key: 'provider_status', label: 'Status provider', width: 130, render: (r) => <Text style={font.small}>{String(r.provider_status ?? r.event_type ?? '—')}</Text> },
          moneyCol('amount', 'Nominal', 110),
          { key: 'signature_ok', label: 'Signature', width: 96, render: (r) => r.signature_ok == null ? <Text style={font.tiny}>—</Text> : <Pill text={r.signature_ok ? 'Valid' : 'TIDAK valid'} tone={r.signature_ok ? 'ok' : 'bad'} /> },
          { key: 'result', label: 'Hasil', width: 200, flex: 1, render: (r) => <Text style={font.small} numberOfLines={2}>{r.processed_at ? `${String(r.result ?? 'diproses')} · ${fmtDate(String(r.processed_at))}` : 'belum diproses'}</Text> },
        ]} />
      </Panel>

      <AdminDialog visible={!!raw} onClose={() => setRaw(null)} width={720} title={`Event ${raw?.event_id ?? ''}`} subtitle={raw ? `${providerLabel(raw.provider)} · ${raw.external_id ?? '—'} · ${fmtDate(raw.received_at)}` : undefined}>
        <ScrollView style={{ maxHeight: 420 }}><Text selectable style={s.pre}>{jsonText(raw?.raw ?? {})}</Text></ScrollView>
      </AdminDialog>
    </>
  );
}

const s = StyleSheet.create({
  pre: { fontFamily: 'monospace', fontSize: 12, lineHeight: 17, color: adminTone.ink2, backgroundColor: adminTone.surfaceAlt, padding: adminSpace.sm, borderRadius: adminRadius.sm },
});
