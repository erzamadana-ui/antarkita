// Admin · Rekonsiliasi & Payout (Skema Bisnis v2, migrasi 0102).
// rpc('admin_reconciliation', { p_from, p_to }) → rekonsiliasi harian gateway (v_reconciliation_daily:
// diff = pembayaran settlement − (gross pesanan digital + dana dikreditkan ke saldo), harus 0) dan
// penarikan mitra berstatus approved yang BELUM settled (approved ≠ uang sampai, §0.4).
// "Tandai settled" → rpc('admin_mark_withdrawal_settled', { p_id, p_provider_ref }) (PIN + notifikasi ke mitra).
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AdminPage, Panel, DataTable, Toolbar, FilterBar, StatCard, Pill, AdminDialog, adminFont as font, adminTone, adminSpace, adminIcon } from '@/components/admin';
import { DateField, FootNote, RANGE_PRESETS, presetRange, rangeError, rangeLabel, type DateRange, type RangePreset } from '@/components/reports';
import { Row, Input, Button, toast } from '@/components/ui';
import { rpc } from '@/lib/supabase';
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
    <AdminPage title="Rekonsiliasi & Payout" subtitle="Cocokkan dana gateway yang settlement dengan buku besar & saldo, dan pastikan penarikan mitra yang disetujui benar-benar sampai." onRefresh={load}
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
