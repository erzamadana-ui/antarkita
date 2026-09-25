// Admin · Persetujuan maker-checker (finpay-v3, kontrak §4 `approval_requests`).
//   • Daftar: rpc('admin_approvals', { p_status })
//   • Putuskan: rpc('admin_approval_decide', { p_id, p_approve, p_note }) — PIN; checker ≠ maker (server menolak bila sama).
// Sumber permintaan: refund besar, penyesuaian saldo ≥ wallet_adjust_dual_approval_min, perubahan fee, batch payout.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Platform } from 'react-native';
import { AdminPage, Panel, DataTable, FilterBar, StatCard, Pill, AdminDialog, RequirePerm, adminFont as font, adminTone, adminSpace, adminRadius } from '@/components/admin';
import { FootNote } from '@/components/reports';
import { Row, Button, Input, toast } from '@/components/ui';
import { rpc } from '@/lib/supabase';
import { colors } from '@/lib/theme';
import { rupiah } from '@/lib/format';
import { useAuth } from '@/store/auth';
import { handleAdminError, useAdminSecurity } from '@/store/adminSecurity';
import { APPROVAL_KIND_LABEL, APPROVAL_STATUS_LABEL, asList, shortId, useAdminCan, type ApprovalRequest } from '@/lib/admin';
import { ErrorNote, fmtDate, fmtAgo, Trunc, WideTableHint } from './_shared';

const FILTERS = [{ key: 'pending', label: 'Menunggu' }, { key: 'approved', label: 'Disetujui' }, { key: 'rejected', label: 'Ditolak' }, { key: 'expired', label: 'Kedaluwarsa' }, { key: 'all', label: 'Semua' }];
const TONE_OF: Record<string, 'wait' | 'ok' | 'bad' | 'off'> = { pending: 'wait', approved: 'ok', rejected: 'bad', expired: 'off' };

/** Ringkasan payload yang mudah dibaca (kunci umum), sisanya JSON. */
function payloadSummary(a: ApprovalRequest): string {
  if (a.summary) return a.summary;
  const p = (a.payload ?? {}) as Record<string, unknown>;
  const parts: string[] = [];
  for (const k of ['user_name', 'user', 'order_code', 'channel', 'provider', 'note', 'reason']) if (p[k] != null && p[k] !== '') parts.push(`${k}: ${String(p[k])}`);
  return parts.join(' · ') || (a.ref_id ? `ref ${shortId(a.ref_id)}` : '—');
}

export default function AdminApprovals() {
  const me = useAuth((s) => s.session?.user.id ?? null);
  const can = useAdminCan();
  const [status, setStatus] = useState('pending');
  const [rows, setRows] = useState<ApprovalRequest[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState<{ a: ApprovalRequest; approve: boolean } | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<ApprovalRequest | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(asList<ApprovalRequest>(await rpc('admin_approvals', { p_status: status === 'all' ? null : status }))); setErr(null); }
    catch (e) { setErr((e as Error).message); setRows([]); }
    finally { setLoading(false); }
  }, [status]);
  useEffect(() => { load(); }, [load]);

  const decide = async () => {
    if (!sel) return;
    if (!sel.approve && note.trim().length < 5) return toast.error('Alasan penolakan minimal 5 huruf');
    if (!(await useAdminSecurity.getState().ensureUnlocked())) return;
    setBusy(true);
    try {
      await rpc('admin_approval_decide', { p_id: sel.a.id, p_approve: sel.approve, p_note: note.trim() || null });
      toast.success(sel.approve ? 'Disetujui — tindakan dieksekusi server' : 'Ditolak & tercatat di log');
      setSel(null); setNote(''); await load();
    } catch (e) { handleAdminError(e); } finally { setBusy(false); }
  };

  const pending = rows.filter((r) => r.status === 'pending');
  const mine = pending.filter((r) => r.maker === me).length;

  return (
    <AdminPage title="Persetujuan (Maker-Checker)" subtitle="Tindakan uang bernilai besar menunggu admin kedua. Admin yang membuat permintaan (maker) tidak bisa menyetujui permintaannya sendiri." onRefresh={load}
      right={<Button size="sm" variant="outline" title="Segarkan" icon="refresh-outline" onPress={load} />}>
      <RequirePerm perm={['approvals']} mode="notice">
        <Row gap={adminSpace.md} style={{ flexWrap: 'wrap' }}>
          <StatCard index={0} icon="git-pull-request-outline" label="Menunggu" value={pending.length} color={adminTone.amber} />
          <StatCard index={1} icon="person-outline" label="Dibuat oleh Anda" value={mine} hint="perlu admin lain" color={adminTone.slate} />
          <StatCard index={2} icon="cash-outline" label="Nilai menunggu" value={rupiah(pending.reduce((s, r) => s + Math.abs(Number(r.amount ?? 0)), 0))} color={adminTone.blue} />
        </Row>
        <FilterBar options={FILTERS} value={status} onChange={setStatus} />
        <ErrorNote text={err} onRetry={load} />

        <Panel title={`Permintaan (${rows.length})`} icon="git-pull-request-outline" padded={false}>
          <DataTable rows={rows as unknown as Record<string, unknown>[]} emptyText={loading ? 'Memuat…' : 'Tidak ada permintaan pada filter ini'} emptyIcon="checkmark-done-outline" onRowPress={(r) => setView(r as unknown as ApprovalRequest)}
            columns={[
              { key: 'created_at', label: 'Dibuat', width: 112, render: (r) => <View><Text style={font.small}>{fmtDate(String(r.created_at), false)}</Text><Text style={font.tiny}>{fmtAgo(String(r.created_at))}</Text></View> },
              { key: 'kind', label: 'Jenis', width: 140, render: (r) => <Pill text={APPROVAL_KIND_LABEL[String(r.kind)] ?? String(r.kind)} tone="info" /> },
              { key: 'amount', label: 'Nominal', width: 112, align: 'right', mono: true, render: (r) => <Text style={[font.mono, Number(r.amount) < 0 ? { color: adminTone.red } : null]}>{r.amount != null ? rupiah(Number(r.amount)) : '—'}</Text> },
              { key: 'payload', label: 'Rincian', width: 180, flex: 1, render: (r) => { const a = r as unknown as ApprovalRequest; const t = payloadSummary(a); return <Trunc style={font.small} title={t} lines={2}>{t}</Trunc>; } },
              { key: 'maker', label: 'Maker · checker', width: 160, render: (r) => { const a = r as unknown as ApprovalRequest; return <View><Text style={font.small} numberOfLines={1}>{a.maker_name ?? shortId(a.maker)}{a.maker === me ? ' (Anda)' : ''}</Text><Text style={font.tiny} numberOfLines={1}>{a.checker ? `checker ${a.checker_name ?? shortId(a.checker)}` : '—'}</Text></View>; } },
              { key: 'status', label: 'Status', width: 108, render: (r) => <Pill text={APPROVAL_STATUS_LABEL[r.status as keyof typeof APPROVAL_STATUS_LABEL] ?? String(r.status)} tone={TONE_OF[String(r.status)] ?? 'neutral'} /> },
              { key: 'actions', label: 'Aksi', width: 196, align: 'right', render: (r) => {
                const a = r as unknown as ApprovalRequest;
                if (a.status !== 'pending') return <Text style={font.tiny} numberOfLines={2}>{a.note ?? fmtDate(a.decided_at)}</Text>;
                const self = !!me && a.maker === me;
                const allowed = can('approvals');
                const tip = self ? 'Anda maker permintaan ini — harus diputuskan admin lain' : !allowed ? 'Peran Anda tidak punya izin approvals' : '';
                const btns = (
                  <Row gap={6}>
                    <Button size="sm" title="Setujui" color={colors.success} disabled={self || !allowed} onPress={() => { setNote(''); setSel({ a, approve: true }); }} />
                    <Button size="sm" variant="outline" color={colors.danger} title="Tolak" disabled={self || !allowed} onPress={() => { setNote(''); setSel({ a, approve: false }); }} />
                  </Row>
                );
                return tip && Platform.OS === 'web' ? React.createElement('div', { title: tip, style: { display: 'inline-flex' } }, btns) : btns;
              } },
            ]} />
          <View style={{ padding: adminSpace.md }}><WideTableHint /></View>
        </Panel>

        <FootNote lines={[
          'Checker ≠ maker ditegakkan server (admin_approval_decide) — tombol dinonaktifkan untuk maker hanya sebagai penanda.',
          'Menyetujui menjalankan tindakan aslinya (mis. penyesuaian saldo) di transaksi yang sama; menolak tidak mengubah uang.',
          'Setiap keputusan butuh PIN panel dan tercatat di Log Audit (append-only).',
        ]} />
      </RequirePerm>

      <AdminDialog visible={!!sel} onClose={() => setSel(null)} title={sel?.approve ? 'Setujui permintaan?' : 'Tolak permintaan?'} tone={sel?.approve ? adminTone.teal : colors.danger}
        subtitle={sel ? `${APPROVAL_KIND_LABEL[sel.a.kind] ?? sel.a.kind} · ${sel.a.amount != null ? rupiah(sel.a.amount) : ''} · maker ${sel.a.maker_name ?? shortId(sel.a.maker)}` : undefined}>
        {sel ? <Text style={font.small}>{payloadSummary(sel.a)}</Text> : null}
        <Input label={sel?.approve ? 'Catatan (opsional)' : 'Alasan penolakan (wajib)'} value={note} onChangeText={setNote} multiline style={{ minHeight: 64 }} />
        <Row gap={8} style={{ justifyContent: 'flex-end' }}>
          <Button size="sm" variant="ghost" title="Batal" onPress={() => setSel(null)} />
          <Button size="sm" title={sel?.approve ? 'Setujui' : 'Tolak'} color={sel?.approve ? colors.success : colors.danger} loading={busy} onPress={decide} />
        </Row>
      </AdminDialog>

      <AdminDialog visible={!!view} onClose={() => setView(null)} width={640} title={`Permintaan ${APPROVAL_KIND_LABEL[view?.kind ?? ''] ?? view?.kind ?? ''}`} subtitle={view ? `${shortId(view.id)} · ref ${shortId(view.ref_id)} · ${APPROVAL_STATUS_LABEL[view.status] ?? view.status}` : undefined}>
        <ScrollView style={{ maxHeight: 360 }}><Text selectable style={st.pre}>{JSON.stringify(view?.payload ?? {}, null, 1)}</Text></ScrollView>
      </AdminDialog>
    </AdminPage>
  );
}

const st = StyleSheet.create({
  pre: { fontFamily: 'monospace', fontSize: 12, lineHeight: 17, color: adminTone.ink2, backgroundColor: adminTone.surfaceAlt, padding: adminSpace.sm, borderRadius: adminRadius.sm },
});
