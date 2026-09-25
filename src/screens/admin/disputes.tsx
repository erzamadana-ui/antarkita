// Admin · Sengketa / Dispute (finpay-v3, kontrak §4).
//   • Daftar: rpc('admin_disputes', { p_status })
//   • Putuskan: rpc('admin_dispute_resolve', { p_id, p_status, p_resolution, p_refund_amount }) — PIN; bila status
//     resolved_refund, server membuat refund_requests (maker = admin ini) yang lalu diproses di menu Refund.
// Buku besar: dispute dibuka → baris `dispute` (fase adjusted), dibalik saat diputuskan (§4).
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { AdminPage, Panel, DataTable, FilterBar, StatCard, Pill, AdminDialog, SoftChip, RequirePerm, adminFont as font, adminTone, adminSpace } from '@/components/admin';
import { FootNote } from '@/components/reports';
import { Row, Button, Input, toast } from '@/components/ui';
import { rpc, supabase } from '@/lib/supabase';
import { rupiah } from '@/lib/format';
import { handleAdminError, useAdminSecurity } from '@/store/adminSecurity';
import {
  DISPUTE_KIND_LABEL, DISPUTE_STATUS_LABEL, PARTY_ROLE_LABEL, asList, shortId, useAdminCan,
  type Dispute, type DisputeStatus,
} from '@/lib/admin';
import { ErrorNote, fmtDate, fmtAgo, Trunc, WideTableHint, parseNum } from './_shared';

const FILTERS = [
  { key: 'open', label: 'Terbuka' }, { key: 'investigating', label: 'Diinvestigasi' }, { key: 'resolved_refund', label: 'Selesai · refund' },
  { key: 'resolved_no_refund', label: 'Selesai · tanpa refund' }, { key: 'closed', label: 'Ditutup' }, { key: 'all', label: 'Semua' },
];
const TONE_OF: Record<DisputeStatus, 'wait' | 'info' | 'ok' | 'off'> = { open: 'wait', investigating: 'info', resolved_refund: 'ok', resolved_no_refund: 'ok', closed: 'off' };
const RESOLVE_OPTS: { value: DisputeStatus; label: string; perm: 'dispute' | 'dispute_resolve' }[] = [
  { value: 'investigating', label: 'Tandai diinvestigasi', perm: 'dispute' },
  { value: 'resolved_refund', label: 'Selesai — refund', perm: 'dispute_resolve' },
  { value: 'resolved_no_refund', label: 'Selesai — tanpa refund', perm: 'dispute_resolve' },
  { value: 'closed', label: 'Tutup', perm: 'dispute_resolve' },
];

export default function AdminDisputes() {
  const router = useRouter();
  const can = useAdminCan();
  const [status, setStatus] = useState('open');
  const [rows, setRows] = useState<Dispute[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState<Dispute | null>(null);
  const [f, setF] = useState<{ status: DisputeStatus; resolution: string; amount: string }>({ status: 'investigating', resolution: '', amount: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      let list = asList<Dispute>(await rpc('admin_disputes', { p_status: status === 'all' ? null : status }));
      const need = Array.from(new Set(list.filter((x) => !x.order_code && x.order_id).map((x) => x.order_id as string)));
      if (need.length) {
        const { data } = await supabase.from('orders').select('id,code').in('id', need);
        const m = new Map(((data as { id: string; code: string }[]) ?? []).map((o) => [o.id, o.code]));
        list = list.map((x) => ({ ...x, order_code: x.order_code ?? (x.order_id ? m.get(x.order_id) ?? null : null) }));
      }
      setRows(list); setErr(null);
    } catch (e) { setErr((e as Error).message); setRows([]); }
    finally { setLoading(false); }
  }, [status]);
  useEffect(() => { load(); }, [load]);

  const open = (d: Dispute) => { setSel(d); setF({ status: d.status === 'open' ? 'investigating' : 'resolved_no_refund', resolution: d.resolution ?? '', amount: d.amount ? String(d.amount) : '' }); };

  const submit = async () => {
    if (!sel) return;
    const res = f.resolution.trim();
    if (res.length < 5) return toast.error('Tulis catatan/resolusi minimal 5 huruf');
    let amt: number | null = null;
    if (f.status === 'resolved_refund') {
      amt = parseNum(f.amount);
      if (!Number.isInteger(amt) || amt <= 0) return toast.error('Nominal refund harus bilangan bulat > 0');
    }
    if (!(await useAdminSecurity.getState().ensureUnlocked())) return;
    setBusy(true);
    try {
      await rpc('admin_dispute_resolve', { p_id: sel.id, p_status: f.status, p_resolution: res, p_refund_amount: amt });
      toast.success(f.status === 'resolved_refund' ? `Dispute diputuskan — refund ${rupiah(amt ?? 0)} masuk antrean Refund` : `Dispute: ${DISPUTE_STATUS_LABEL[f.status]}`);
      setSel(null); await load();
    } catch (e) { handleAdminError(e); } finally { setBusy(false); }
  };

  const openCount = rows.filter((r) => r.status === 'open').length;
  const sumAmt = rows.reduce((s, r) => s + Number(r.amount ?? 0), 0);
  const chargeback = rows.filter((r) => r.kind === 'chargeback').length;

  return (
    <AdminPage title="Sengketa (Dispute)" subtitle="Keluhan uang dari pelanggan, driver, dan merchant: nominal tidak sesuai, tidak diterima, chargeback, pencairan belum masuk." onRefresh={load}
      right={<Button size="sm" variant="outline" title="Segarkan" icon="refresh-outline" onPress={load} />}>
      <RequirePerm perm={['dispute', 'dispute_resolve']} mode="notice">
        <Row gap={adminSpace.md} style={{ flexWrap: 'wrap' }}>
          <StatCard index={0} icon="alert-circle-outline" label="Pada filter ini" value={rows.length} color={adminTone.blue} />
          <StatCard index={1} icon="hourglass-outline" label="Terbuka" value={openCount} color={adminTone.amber} />
          <StatCard index={2} icon="cash-outline" label="Nominal disengketakan" value={rupiah(sumAmt)} color={adminTone.red} />
          <StatCard index={3} icon="card-outline" label="Chargeback" value={chargeback} color={adminTone.violet} hint="dari provider pembayaran" />
        </Row>
        <FilterBar options={FILTERS} value={status} onChange={setStatus} />
        <ErrorNote text={err} onRetry={load} />

        <Panel title={`Dispute (${rows.length})`} icon="alert-circle-outline" padded={false}>
          <DataTable rows={rows as unknown as Record<string, unknown>[]} emptyText={loading ? 'Memuat…' : 'Tidak ada dispute pada filter ini'} emptyIcon="checkmark-done-outline" onRowPress={(r) => open(r as unknown as Dispute)}
            columns={[
              { key: 'created_at', label: 'Dibuka', width: 110, render: (r) => <View><Text style={font.small}>{fmtDate(String(r.created_at), false)}</Text><Text style={font.tiny}>{fmtAgo(String(r.created_at))}</Text></View> },
              { key: 'order_code', label: 'Order', width: 130, render: (r) => { const x = r as unknown as Dispute; return <Text style={font.bodyStrong} selectable>{x.order_code ?? shortId(x.order_id)}</Text>; } },
              { key: 'party_role', label: 'Pelapor', width: 120, render: (r) => { const x = r as unknown as Dispute; return <View><Text style={font.body}>{PARTY_ROLE_LABEL[x.party_role] ?? x.party_role}</Text><Text style={font.tiny} numberOfLines={1}>{x.opened_by_name ?? shortId(x.opened_by)}</Text></View>; } },
              { key: 'kind', label: 'Jenis', width: 150, render: (r) => <Pill text={DISPUTE_KIND_LABEL[String(r.kind)] ?? String(r.kind)} tone={r.kind === 'chargeback' ? 'bad' : 'neutral'} /> },
              { key: 'amount', label: 'Nominal', width: 104, align: 'right', mono: true, render: (r) => <Text style={font.mono}>{r.amount != null ? rupiah(Number(r.amount)) : '—'}</Text> },
              { key: 'description', label: 'Keterangan', width: 160, flex: 1, render: (r) => <Trunc style={font.small} title={String(r.description ?? '')} lines={2}>{String(r.description ?? '—')}</Trunc> },
              { key: 'status', label: 'Status', width: 150, render: (r) => { const x = r as unknown as Dispute; return <View style={{ gap: 3 }}><Pill text={DISPUTE_STATUS_LABEL[x.status] ?? x.status} tone={TONE_OF[x.status] ?? 'neutral'} />{x.resolved_at ? <Text style={font.tiny}>{fmtDate(x.resolved_at)}</Text> : null}</View>; } },
              { key: 'actions', label: 'Aksi', width: 100, align: 'right', render: (r) => { const x = r as unknown as Dispute; return x.status === 'resolved_refund' || x.status === 'resolved_no_refund' || x.status === 'closed' ? <Button size="sm" variant="ghost" title="Lihat" onPress={() => open(x)} /> : <Button size="sm" title="Tangani" onPress={() => open(x)} />; } },
            ]} />
          <View style={{ padding: adminSpace.md }}><WideTableHint /></View>
        </Panel>

        <FootNote lines={[
          'CS boleh menandai “diinvestigasi”; keputusan akhir (refund / tanpa refund / tutup) butuh izin keuangan dan PIN panel.',
          'Keputusan “Selesai — refund” membuat permintaan refund baru (maker = admin yang memutuskan). Eksekusi dana tetap lewat menu Refund (checker ≠ maker bila di atas ambang).',
          'Buku besar: saat dibuka dicatat baris dispute (fase adjusted); saat diputuskan baris itu dibalik (reversal_of) — tidak ada baris yang dihapus.',
        ]} />
      </RequirePerm>

      <AdminDialog visible={!!sel} onClose={() => setSel(null)} width={620} title={`Dispute ${sel?.order_code ?? shortId(sel?.order_id)}`}
        subtitle={sel ? `${PARTY_ROLE_LABEL[sel.party_role] ?? sel.party_role} · ${DISPUTE_KIND_LABEL[sel.kind] ?? sel.kind} · ${sel.amount != null ? rupiah(sel.amount) : 'tanpa nominal'} · ${DISPUTE_STATUS_LABEL[sel.status]}` : undefined}>
        {sel ? (
          <View style={{ gap: 10 }}>
            <Text style={font.body}>{sel.description ?? '—'}</Text>
            {sel.resolution ? <Text style={font.small}>Resolusi sebelumnya: {sel.resolution}</Text> : null}
            <Row gap={8} style={{ flexWrap: 'wrap' }}>
              {sel.order_id ? <Button size="sm" variant="ghost" title="Buka buku besar order" icon="book-outline" onPress={() => { setSel(null); router.push('/(admin)/ledger' as never); }} /> : null}
              <Button size="sm" variant="ghost" title="Antrean refund" icon="return-down-back-outline" onPress={() => { setSel(null); router.push('/(admin)/refunds' as never); }} />
            </Row>
            {sel.status !== 'closed' && sel.status !== 'resolved_refund' && sel.status !== 'resolved_no_refund' ? (
              <>
                <Text style={font.label}>Keputusan</Text>
                <Row gap={6} style={{ flexWrap: 'wrap' }}>
                  {RESOLVE_OPTS.filter((o) => can(o.perm)).map((o) => <SoftChip key={o.value} label={o.label} active={f.status === o.value} onPress={() => setF({ ...f, status: o.value })} />)}
                </Row>
                {f.status === 'resolved_refund' ? <Input label="Nominal refund (Rp)" keyboardType="number-pad" value={f.amount} onChangeText={(v) => setF({ ...f, amount: v.replace(/\D/g, '') })} /> : null}
                <Input label="Catatan / resolusi (tersimpan di log & terlihat pelapor)" value={f.resolution} multiline onChangeText={(v) => setF({ ...f, resolution: v })} style={{ minHeight: 72 }} />
                <Row gap={8} style={{ justifyContent: 'flex-end' }}>
                  <Button size="sm" variant="ghost" title="Batal" onPress={() => setSel(null)} />
                  <Button size="sm" title="Simpan keputusan" icon="save-outline" loading={busy} onPress={submit} />
                </Row>
              </>
            ) : <Text style={font.tiny}>Dispute sudah diputuskan {fmtDate(sel.resolved_at)}.</Text>}
          </View>
        ) : null}
      </AdminDialog>
    </AdminPage>
  );
}
