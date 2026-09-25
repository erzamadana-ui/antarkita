// Admin · Refund (finpay-v3, kontrak §4). Antrean `refund_requests` dengan maker-checker:
//   • Daftar: rpc('admin_refunds', { p_status }) — cadangan: select tabel refund_requests (RLS admin select).
//   • Pratinjau komponen yang bisa/tidak bisa dikembalikan: rpc('refund_policy_calc', { p_order }).
//   • Maker: rpc('admin_refund_approve', { p_id }) · Checker (admin lain): rpc('admin_refund_confirm', { p_id })
//     — wajib bila amount ≥ app_settings.refund_dual_approval_min · Tolak: rpc('admin_refund_reject', { p_id, p_note }).
//   • Eksekusi ke provider: edge function `pay-refund` { refund_id } (status approved → executing → done/failed lewat webhook).
// Semua aksi butuh PIN panel; server memeriksa izin (admin_require) & checker ≠ maker.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AdminPage, Panel, DataTable, FilterBar, StatCard, Pill, AdminDialog, ReasonPrompt, RequirePerm, RowActions, adminFont as font, adminTone, adminSpace, adminIcon, adminTable, TONE, type RowAction } from '@/components/admin';
import { FootNote } from '@/components/reports';
import { Row, Button, toast } from '@/components/ui';
import { rpc, supabase } from '@/lib/supabase';
import { colors } from '@/lib/theme';
import { rupiah } from '@/lib/format';
import { useAuth } from '@/store/auth';
import { handleAdminError, useAdminSecurity } from '@/store/adminSecurity';
import {
  REFUND_STATUS_LABEL, refundTone, rpcOr, invokeEdge, asList, shortId, useAdminCan,
  type RefundPolicyCalc, type RefundRequest,
} from '@/lib/admin';
import { ErrorNote, fmtDate, fmtAgo, Trunc, WideTableHint, usePager, Pager } from './_shared';

const FILTERS = [
  { key: 'requested', label: 'Diajukan' }, { key: 'approved', label: 'Siap dieksekusi' }, { key: 'executing', label: 'Dieksekusi' },
  { key: 'done', label: 'Selesai' }, { key: 'failed', label: 'Gagal' }, { key: 'rejected', label: 'Ditolak' }, { key: 'all', label: 'Semua' },
];
const DEST_LABEL: Record<string, string> = { gateway: 'Ke metode bayar asal', wallet: 'Ke saldo AntarPay' };

export default function AdminRefunds() {
  const me = useAuth((s) => s.session?.user.id ?? null);
  const can = useAdminCan();
  const [status, setStatus] = useState('requested');
  const [rows, setRows] = useState<RefundRequest[]>([]);
  const [via, setVia] = useState<'rpc' | 'fallback'>('rpc');
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [dualMin, setDualMin] = useState(200000);
  const [busy, setBusy] = useState<string | null>(null);
  const [detail, setDetail] = useState<RefundRequest | null>(null);
  const [policy, setPolicy] = useState<RefundPolicyCalc | null>(null);
  const [policyErr, setPolicyErr] = useState<string | null>(null);
  const [reject, setReject] = useState<RefundRequest | null>(null);
  const [exec, setExec] = useState<RefundRequest | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = status === 'all' ? null : status;
      const r = await rpcOr<unknown>('admin_refunds', { p_status: p }, async () => {
        let qq = supabase.from('refund_requests').select('*').order('created_at', { ascending: false }).limit(300);
        if (p) qq = qq.eq('status', p);
        const { data, error } = await qq;
        if (error) throw new Error(error.message);
        return data;
      });
      let list = asList<RefundRequest>(r.data);
      // lengkapi kode order bila RPC/tabel tidak menyertakannya
      const need = Array.from(new Set(list.filter((x) => !x.order_code && x.order_id).map((x) => x.order_id as string)));
      if (need.length) {
        const { data } = await supabase.from('orders').select('id,code').in('id', need);
        const m = new Map(((data as { id: string; code: string }[]) ?? []).map((o) => [o.id, o.code]));
        list = list.map((x) => ({ ...x, order_code: x.order_code ?? (x.order_id ? m.get(x.order_id) ?? null : null) }));
      }
      setRows(list); setVia(r.via); setErr(null);
    } catch (e) { setErr((e as Error).message); setRows([]); }
    finally { setLoading(false); }
    const { data: s } = await supabase.from('app_settings').select('value').eq('key', 'refund_dual_approval_min').maybeSingle();
    const n = Number(String((s as { value?: unknown } | null)?.value ?? '').replace(/"/g, ''));
    if (Number.isFinite(n) && n > 0) setDualMin(n);
  }, [status]);
  useEffect(() => { load(); }, [load]);

  const openDetail = async (r: RefundRequest) => {
    setDetail(r); setPolicy(null); setPolicyErr(null);
    if (!r.order_id) return;
    try { setPolicy(await rpc<RefundPolicyCalc>('refund_policy_calc', { p_order: r.order_id })); }
    catch (e) { setPolicyErr((e as Error).message); }
  };

  const needsChecker = (r: RefundRequest) => r.needs_checker ?? Number(r.amount) >= dualMin;
  const awaitingMaker = (r: RefundRequest) => r.status === 'requested' && !r.maker;
  const awaitingChecker = (r: RefundRequest) => r.status === 'requested' && !!r.maker && !r.checker && needsChecker(r);

  const act = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    if (!(await useAdminSecurity.getState().ensureUnlocked())) return false;
    setBusy(key);
    try { await fn(); toast.success(ok); await load(); return true; }
    catch (e) { handleAdminError(e); return false; }
    finally { setBusy(null); }
  };
  const approve = (r: RefundRequest) => act(`a:${r.id}`, () => rpc('admin_refund_approve', { p_id: r.id }),
    needsChecker(r) ? `Refund ${rupiah(r.amount)} disetujui (maker) — menunggu konfirmasi admin lain` : `Refund ${rupiah(r.amount)} disetujui — siap dieksekusi`);
  const confirm = (r: RefundRequest) => act(`c:${r.id}`, () => rpc('admin_refund_confirm', { p_id: r.id }), `Refund ${rupiah(r.amount)} dikonfirmasi (checker) — siap dieksekusi`);
  const doReject = async (note: string) => {
    if (!reject) return;
    if (await act(`r:${reject.id}`, () => rpc('admin_refund_reject', { p_id: reject.id, p_note: note }), 'Refund ditolak & tercatat di log')) setReject(null);
  };
  const doExec = async () => {
    if (!exec) return;
    const ok = await act(`x:${exec.id}`, async () => {
      const res = await invokeEdge<{ status?: string; provider_ref?: string; message?: string }>('pay-refund', { refund_id: exec.id });
      if (res?.provider_ref) toast.show(`Ref provider: ${res.provider_ref}`);
    }, `Refund ${rupiah(exec.amount)} dikirim ke provider — status akhir menyusul lewat webhook`);
    if (ok) setExec(null);
  };

  const kpi = {
    total: rows.reduce((s, r) => s + Number(r.amount || 0), 0),
    maker: rows.filter(awaitingMaker).length,
    checker: rows.filter(awaitingChecker).length,
    ready: rows.filter((r) => r.status === 'approved').length,
  };
  const pg = usePager(rows, 50);

  const who = (id: string | null, name?: string | null) => (id ? `${name ?? shortId(id)}${id === me ? ' (Anda)' : ''}` : '—');

  return (
    <AdminPage title="Refund" subtitle={`Antrean refund pelanggan · maker-checker untuk refund ≥ ${rupiah(dualMin)} · semua aksi butuh PIN panel`} onRefresh={load}
      right={<Button size="sm" variant="outline" title="Segarkan" icon="refresh-outline" onPress={load} />}>
      <RequirePerm perm={['refund_approve', 'refund_execute', 'payments_view']} mode="notice">
        <Row gap={adminSpace.md} style={{ flexWrap: 'wrap' }}>
          <StatCard index={0} icon="return-down-back-outline" label="Nominal pada filter" value={rupiah(kpi.total)} hint={`${rows.length} permintaan`} color={adminTone.blue} />
          <StatCard index={1} icon="person-outline" label="Menunggu maker" value={kpi.maker} color={adminTone.amber} />
          <StatCard index={2} icon="people-outline" label="Menunggu checker" value={kpi.checker} hint="admin kedua (≠ maker)" color={adminTone.violet} />
          <StatCard index={3} icon="send-outline" label="Siap dieksekusi" value={kpi.ready} color={adminTone.green} />
        </Row>

        <FilterBar options={FILTERS} value={status} onChange={setStatus} />
        <ErrorNote text={err} onRetry={load} />
        {via === 'fallback' ? <Text style={font.tiny}>RPC admin_refunds belum tersedia — data dibaca langsung dari tabel refund_requests.</Text> : null}

        <Panel title={`Permintaan refund (${rows.length})`} icon="return-down-back-outline" padded={false}>
          <DataTable rows={pg.rows as unknown as Record<string, unknown>[]} emptyText={loading ? 'Memuat…' : 'Tidak ada refund pada filter ini'} emptyIcon="return-down-back-outline" onRowPress={(r) => openDetail(r as unknown as RefundRequest)}
            columns={[
              // Lebar total ±1.000 px → muat di layar 1366 (isi ±1.070 px) tanpa kolom Aksi terpotong.
              { key: 'created_at', label: 'Diajukan', width: 116, render: (r) => <View><Text style={font.small}>{fmtDate(String(r.created_at), false)}</Text><Text style={font.tiny}>{fmtAgo(String(r.created_at))}</Text></View> },
              { key: 'order_code', label: 'Order', width: 136, render: (r) => { const x = r as unknown as RefundRequest; return <View style={{ minWidth: 0, alignSelf: 'stretch' }}><Trunc style={font.bodyStrong} title={x.order_code ?? x.order_id ?? ''}>{x.order_code ?? shortId(x.order_id)}</Trunc>{x.support_ref ? <Text style={font.tiny}>CS {x.support_ref}</Text> : null}</View>; } },
              { key: 'amount', label: 'Nominal', width: 118, align: 'right', mono: true, render: (r) => { const x = r as unknown as RefundRequest; return <View style={{ alignItems: 'flex-end' }}><Text style={font.mono}>{rupiah(x.amount)}</Text><Text style={font.tiny}>{x.kind === 'full' ? 'penuh' : 'sebagian'}{needsChecker(x) ? ' · 2 admin' : ''}</Text></View>; } },
              { key: 'reason', label: 'Alasan · tujuan', width: 170, flex: 1, render: (r) => { const x = r as unknown as RefundRequest; return <View style={{ minWidth: 0, alignSelf: 'stretch' }}><Trunc style={font.small} title={x.reason ?? ''}>{x.reason ?? '—'}</Trunc><Text style={font.tiny} numberOfLines={1}>{DEST_LABEL[x.destination] ?? x.destination}</Text></View>; } },
              { key: 'status', label: 'Status · ref', width: 200, render: (r) => { const x = r as unknown as RefundRequest; return (
                <View style={{ gap: 3, minWidth: 0, alignSelf: 'stretch' }}>
                  <Pill text={awaitingChecker(x) ? 'Menunggu checker' : REFUND_STATUS_LABEL[x.status] ?? x.status} tone={awaitingChecker(x) ? 'wait' : refundTone(x.status)} />
                  <Trunc style={font.tiny} title={`maker ${who(x.maker, x.maker_name)}${x.checker ? ` · checker ${who(x.checker, x.checker_name)}` : ''}${x.provider_ref ? ` · ref ${x.provider_ref}` : ''}`}>
                    {x.provider_ref ? `ref ${x.provider_ref}` : `maker ${who(x.maker, x.maker_name)}${x.checker ? ` · checker ${who(x.checker, x.checker_name)}` : ''}`}
                  </Trunc>
                </View>
              ); } },
              { key: 'actions', label: 'Aksi', width: adminTable.actionsWideW, align: 'right', render: (r) => {
                const x = r as unknown as RefundRequest;
                const isMaker = !!me && x.maker === me;
                const main: RowAction | null =
                  awaitingMaker(x) && can('refund_approve') ? { key: 'ok', label: 'Setujui', icon: 'checkmark', variant: 'solid', color: colors.success, busy: busy === `a:${x.id}`, onPress: () => { approve(x); } }
                  : awaitingChecker(x) && can('refund_approve') ? { key: 'cf', label: 'Konfirmasi', icon: 'shield-checkmark-outline', variant: 'soft', disabled: isMaker, busy: busy === `c:${x.id}`, title: isMaker ? 'Anda maker refund ini — konfirmasi harus oleh admin lain' : 'Konfirmasi sebagai checker', onPress: () => { confirm(x); } }
                  : x.status === 'approved' && can('refund_execute') ? { key: 'ex', label: 'Eksekusi', icon: 'send-outline', variant: 'solid', color: adminTone.teal, onPress: () => setExec(x) }
                  : null;
                return (
                  <RowActions
                    primary={[main, { key: 'dt', label: 'Detail & pratinjau', icon: 'document-text-outline', onPress: () => openDetail(x) }]}
                    menu={[x.status === 'requested' && can('refund_approve') && { key: 'rj', label: 'Tolak refund…', icon: 'close-circle-outline', danger: true, onPress: () => setReject(x) }]}
                  />
                );
              } },
            ]} />
          <View style={{ padding: adminSpace.md, gap: 6 }}><WideTableHint /><Pager p={pg} noun="refund" /></View>
        </Panel>

        <FootNote lines={[
          `Refund ≥ ${rupiah(dualMin)} (app_settings.refund_dual_approval_min) butuh dua admin berbeda: maker menyetujui, checker mengonfirmasi. Tombol Konfirmasi nonaktif bagi maker.`,
          'Eksekusi memanggil edge function pay-refund ke provider asal; status menjadi Selesai setelah webhook provider masuk (payment_event_ingest). Bila provider tidak mendukung refund, server memakai tujuan saldo AntarPay (wallet_apply refund).',
          'Komponen yang tidak dikembalikan mengikuti refund_policy_calc: sebelum merchant menerima = 100 %; setelah diproses = barang tidak kembali, ongkir dikembalikan bila driver belum mengambil, biaya platform dikembalikan, biaya PG yang dibebankan ke pelanggan tidak dikembalikan bila provider tidak mengembalikannya.',
          'Setiap aksi tercatat di Log Audit (append-only).',
        ]} />
      </RequirePerm>

      <AdminDialog visible={!!detail} onClose={() => setDetail(null)} width={640} title={`Refund ${detail?.order_code ?? shortId(detail?.order_id)}`}
        subtitle={detail ? `${rupiah(detail.amount)} · ${detail.kind === 'full' ? 'penuh' : 'sebagian'} · ${DEST_LABEL[detail.destination] ?? detail.destination} · ${REFUND_STATUS_LABEL[detail.status] ?? detail.status}` : undefined}>
        {detail ? (
          <View style={{ gap: 10 }}>
            <Text style={font.small}>Alasan: {detail.reason ?? '—'}</Text>
            <Text style={font.tiny}>Maker {who(detail.maker, detail.maker_name)} · checker {who(detail.checker, detail.checker_name)} · diputuskan {fmtDate(detail.decided_at)} · dieksekusi {fmtDate(detail.executed_at)}{detail.provider_ref ? ` · ref ${detail.provider_ref}` : ''}</Text>
            {detail.note ? <Text style={font.tiny}>Catatan: {detail.note}</Text> : null}
            <Text style={font.label}>Pratinjau kebijakan refund (refund_policy_calc)</Text>
            <ErrorNote text={policyErr} />
            {!policy && !policyErr ? <Text style={font.small}>{detail.order_id ? 'Menghitung…' : 'Refund tanpa order (mis. top up) — tidak ada pratinjau.'}</Text> : null}
            {policy ? (
              <View style={{ gap: 4 }}>
                {policy.lines.map((l, i) => (
                  <Row key={`${l.label}-${i}`} between style={{ gap: 8 }}>
                    <Row gap={6} style={{ flex: 1 }}>
                      <Ionicons name={l.refundable ? 'checkmark-circle' : 'close-circle'} size={adminIcon.sm} color={l.refundable ? TONE.ok.fg : TONE.bad.fg} />
                      <Text style={font.small}>{l.label}</Text>
                    </Row>
                    <Text style={[font.mono, !l.refundable && { color: adminTone.faint }]}>{rupiah(l.amount)}</Text>
                  </Row>
                ))}
                <Row between style={{ borderTopWidth: 1, borderTopColor: adminTone.border, paddingTop: 6 }}>
                  <Text style={font.bodyStrong}>Bisa dikembalikan</Text><Text style={[font.mono, { color: TONE.ok.fg }]}>{rupiah(policy.refundable)}</Text>
                </Row>
                <Row between><Text style={font.small}>Tidak dikembalikan</Text><Text style={font.mono}>{rupiah(policy.non_refundable)}</Text></Row>
                {Number(detail.amount) > Number(policy.refundable) ? (
                  <Text style={[font.small, { color: TONE.bad.fg, fontWeight: '700' }]}>Nominal refund ({rupiah(detail.amount)}) melebihi yang bisa dikembalikan menurut kebijakan ({rupiah(policy.refundable)}). Periksa sebelum menyetujui.</Text>
                ) : null}
              </View>
            ) : null}
          </View>
        ) : null}
      </AdminDialog>

      <ReasonPrompt visible={!!reject} title={`Tolak refund ${reject ? rupiah(reject.amount) : ''}?`} subtitle="Alasan tersimpan di log dan dikirim ke pelanggan." onCancel={() => setReject(null)} onSubmit={doReject} confirmLabel="Tolak refund"
        quick={['Pesanan sudah selesai & diterima pelanggan', 'Bukti tidak cukup', 'Duplikat permintaan', 'Sudah direfund sebelumnya', 'Di luar kebijakan refund']} />

      <AdminDialog visible={!!exec} onClose={() => setExec(null)} title="Eksekusi refund ke provider?" tone={adminTone.teal}
        subtitle={exec ? `${rupiah(exec.amount)} · ${exec.order_code ?? shortId(exec.order_id)} · ${DEST_LABEL[exec.destination] ?? exec.destination}` : undefined}>
        <Text style={font.body}>Dana akan dikembalikan lewat provider pembayaran asal (edge pay-refund). Tindakan ini memindahkan uang dan tidak bisa dibatalkan dari panel.</Text>
        <Row gap={8} style={{ justifyContent: 'flex-end' }}>
          <Button size="sm" variant="ghost" title="Batal" onPress={() => setExec(null)} />
          <Button size="sm" title="Eksekusi sekarang" icon="send-outline" loading={!!exec && busy === `x:${exec.id}`} onPress={doExec} />
        </Row>
      </AdminDialog>
    </AdminPage>
  );
}
