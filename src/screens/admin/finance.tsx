// Admin · Keuangan — verifikasi top up & penarikan saldo, serta verifikasi rekening mitra.
// Tampilan mengikuti sistem desain panel admin; logika persetujuan tidak berubah.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, Linking, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import {
  AdminPage, Panel, DataTable, Toolbar, FilterBar, StatCard, Pill, IconAction, Truncate,
  statusTone, adminFont as font, adminTone, adminSpace,
} from '@/components/admin';
import { Row, Button, toast } from '@/components/ui';
import { rpc, supabase } from '@/lib/supabase';
import { signedUrl } from '@/lib/upload';
import { adminExportCsv } from '@/lib/csv';
import { handleAdminError, useAdminSecurity } from '@/store/adminSecurity';
import { colors } from '@/lib/theme';
import { formatDate, rupiah } from '@/lib/format';
import type { Profile, TopupRequest, WithdrawalRequest } from '@/lib/types';

type T = TopupRequest & { user?: Profile | null };
type W = WithdrawalRequest & { user?: Profile | null; auto?: boolean; bank_verified?: boolean };
const sl: Record<string, string> = { pending: 'Menunggu', approved: 'Disetujui', rejected: 'Ditolak' };
const sum = (xs: { amount: number }[]) => xs.reduce((a, b) => a + Number(b.amount || 0), 0);

export default function AdminFinance() {
  const router = useRouter();
  const [topups, setTopups] = useState<T[]>([]);
  const [wds, setWds] = useState<W[]>([]);
  const [filter, setFilter] = useState('pending');
  const load = useCallback(async () => {
    const [{ data: t }, { data: w }] = await Promise.all([
      supabase.from('topup_requests').select('*').order('created_at', { ascending: false }).limit(200),
      supabase.from('withdrawal_requests').select('*').order('created_at', { ascending: false }).limit(200),
    ]);
    const ts = (t as TopupRequest[]) ?? [], ws = (w as WithdrawalRequest[]) ?? [];
    const ids = Array.from(new Set([...ts, ...ws].map((x) => x.user_id)));
    const [{ data: profiles }, { data: banks }] = ids.length ? await Promise.all([supabase.from('profiles').select('*').in('id', ids), supabase.from('bank_accounts').select('user_id,verified').in('user_id', ids)]) : [{ data: [] }, { data: [] }];
    const pm = new Map(((profiles as Profile[]) ?? []).map((p) => [p.id, p]));
    const bv = new Map(((banks as { user_id: string; verified: boolean }[]) ?? []).map((b) => [b.user_id, b.verified]));
    setTopups(ts.map((x) => ({ ...x, user: pm.get(x.user_id) }))); setWds(ws.map((x) => ({ ...x, user: pm.get(x.user_id), bank_verified: bv.get(x.user_id) ?? false })));
  }, []);
  useEffect(() => { load(); }, [load]);

  const reviewTopup = async (id: string, ok: boolean) => { try { await rpc('admin_review_topup', { p_id: id, p_approve: ok, p_note: ok ? 'Transfer diverifikasi' : 'Bukti tidak valid' }); toast.success(ok ? 'Top up disetujui, saldo ditambahkan' : 'Top up ditolak'); load(); } catch (e) { toast.error((e as Error).message); } };
  const reviewWd = async (id: string, ok: boolean) => {
    if (!(await useAdminSecurity.getState().ensureUnlocked())) return;
    try { await rpc('admin_review_withdrawal', { p_id: id, p_approve: ok, p_note: ok ? 'Dana sudah ditransfer' : 'Data rekening tidak valid' }); toast.success(ok ? 'Penarikan disetujui (pastikan dana sudah ditransfer) · rekening ditandai terverifikasi' : 'Penarikan ditolak, saldo dikembalikan'); load(); } catch (e) { handleAdminError(e); }
  };
  const setBankVerified = async (userId: string, verified: boolean) => { try { await rpc('admin_set_bank_verified', { p_user: userId, p_verified: verified }); toast.success(verified ? 'Rekening ditandai terverifikasi (pencairan otomatis aktif)' : 'Verifikasi rekening dicabut'); load(); } catch (e) { toast.error((e as Error).message); } };
  const exportCsv = () => {
    const day = new Date().toISOString().slice(0, 10);
    const rows: unknown[][] = [
      ...f(topups).map((x) => ['topup', x.id, x.user?.full_name ?? '', x.user?.email ?? '', x.amount, x.status, '', x.created_at, x.review_note ?? '']),
      ...f(wds).map((x) => ['withdrawal', x.id, x.user?.full_name ?? '', x.user?.email ?? '', x.amount, x.status, `${x.bank_name} ${x.bank_account} a.n. ${x.account_name}`, x.created_at, x.review_note ?? '']),
    ];
    return adminExportCsv('finance', `keuangan-${filter}-${day}.csv`, ['Jenis', 'ID', 'Pengguna', 'Email', 'Nominal', 'Status', 'Rekening', 'Waktu', 'Catatan'], rows);
  };
  const openProof = async (path: string | null) => { if (!path) return toast.error('Tidak ada bukti'); const u = await signedUrl('proofs', path); if (u) Linking.openURL(u); };
  const f = <X extends { status: string }>(xs: X[]) => xs.filter((x) => filter === 'all' || x.status === filter);

  const shownTopups = f(topups), shownWds = f(wds);
  const kpi = useMemo(() => {
    const pt = topups.filter((x) => x.status === 'pending'), pw = wds.filter((x) => x.status === 'pending');
    return {
      topupPending: sum(pt), topupPendingN: pt.length,
      wdPending: sum(pw), wdPendingN: pw.length,
      unverified: new Set(wds.filter((x) => x.status === 'pending' && !x.bank_verified).map((x) => x.user_id)).size,
      approvedNet: sum(topups.filter((x) => x.status === 'approved')) - sum(wds.filter((x) => x.status === 'approved')),
    };
  }, [topups, wds]);

  const user = (x: T | W) => (
    <View style={{ minWidth: 0 }}>
      <Truncate style={font.bodyStrong} title={x.user?.full_name ?? ''}>{x.user?.full_name ?? '—'}</Truncate>
      <Truncate style={font.tiny} title={x.user?.email ?? ''}>{x.user?.email ?? '—'}</Truncate>
    </View>
  );
  const money = (n: number) => <Text style={font.mono}>{rupiah(Number(n))}</Text>;
  const when = (iso: string) => <Text style={font.tiny}>{formatDate(iso)}</Text>;
  const status = (s: string) => <Pill text={sl[s] ?? s} tone={statusTone(s)} />;

  return (
    <AdminPage title="Keuangan" subtitle="Verifikasi top up & penarikan saldo · persetujuan penarikan butuh PIN panel" onRefresh={load}
      right={<Row gap={8}>
        <Button size="sm" variant="outline" title="Lihat laporan lengkap" icon="document-text-outline" onPress={() => router.push('/(admin)/finance-report' as never)} />
        {Platform.OS === 'web' ? <Button size="sm" title="Ekspor CSV" icon="download-outline" variant="secondary" onPress={exportCsv} /> : null}
      </Row>}>

      <Row gap={adminSpace.md} style={{ flexWrap: 'wrap' }}>
        <StatCard index={0} icon="arrow-down-circle-outline" color={adminTone.blue} label="Top up menunggu" value={rupiah(kpi.topupPending)} hint={`${kpi.topupPendingN} permintaan perlu diverifikasi`} />
        <StatCard index={1} icon="arrow-up-circle-outline" color={adminTone.amber} label="Penarikan menunggu" value={rupiah(kpi.wdPending)} hint={`${kpi.wdPendingN} permintaan · butuh PIN panel`} />
        <StatCard index={2} icon="shield-checkmark-outline" color={kpi.unverified > 0 ? adminTone.red : adminTone.green} label="Rekening belum terverifikasi" value={kpi.unverified} hint="pada permintaan penarikan yang menunggu" />
        <StatCard index={3} icon="swap-vertical-outline" color={adminTone.teal} label="Arus kas dompet (disetujui)" value={rupiah(kpi.approvedNet)} hint="top up disetujui − penarikan disetujui" />
      </Row>

      <Toolbar right={<Text style={font.tiny}>{shownTopups.length + shownWds.length} baris ditampilkan · maks 200 terbaru per jenis</Text>}>
        <FilterBar value={filter} onChange={setFilter} options={[{ key: 'pending', label: 'Menunggu' }, { key: 'approved', label: 'Disetujui' }, { key: 'rejected', label: 'Ditolak' }, { key: 'all', label: 'Semua' }]} />
      </Toolbar>

      <Panel title={`Top up (${shownTopups.length})`} subtitle="Saldo ditambahkan setelah bukti transfer diverifikasi" icon="arrow-down-circle-outline" iconColor={adminTone.blue} padded={false}>
        <DataTable rows={shownTopups as unknown as Record<string, unknown>[]} emptyText="Tidak ada permintaan top up pada filter ini" emptyIcon="arrow-down-circle-outline"
          columns={[
            { key: 'user', label: 'Pengguna', width: 210, flex: 1, render: (r) => user(r as unknown as T) },
            { key: 'amount', label: 'Nominal', width: 130, align: 'right', mono: true, render: (r) => money(Number(r.amount)) },
            {
              key: 'note', label: 'Catatan / bukti', width: 240, flex: 1, render: (r) => {
                const x = r as unknown as T;
                return (
                  <View style={{ minWidth: 0, gap: 2 }}>
                    <Truncate style={font.small} title={x.sender_note ?? ''}>{x.sender_note || 'Tanpa catatan'}</Truncate>
                    {x.proof_url
                      ? <Pressable onPress={() => openProof(x.proof_url)} hitSlop={4}><Text style={[font.tiny, { color: adminTone.teal, fontWeight: '700' }]}>Lihat bukti transfer</Text></Pressable>
                      : <Text style={[font.tiny, { color: adminTone.red }]}>Tanpa bukti</Text>}
                  </View>
                );
              },
            },
            { key: 'created_at', label: 'Waktu', width: 150, render: (r) => when(String(r.created_at)) },
            { key: 'status', label: 'Status', width: 110, render: (r) => status(String(r.status)) },
            {
              key: 'actions', label: 'Aksi', width: 190, render: (r) => r.status === 'pending'
                ? <Row gap={6} style={{ flexWrap: 'wrap' }}>
                  <Button size="sm" title="Setujui" color={colors.success} onPress={() => reviewTopup(String(r.id), true)} />
                  <Button size="sm" title="Tolak" variant="outline" color={colors.danger} onPress={() => reviewTopup(String(r.id), false)} />
                </Row>
                : <Truncate style={font.tiny} title={String(r.review_note ?? '')}>{String(r.review_note ?? '—')}</Truncate>,
            },
          ]} />
      </Panel>

      <Panel title={`Penarikan saldo (${shownWds.length})`} subtitle="Transfer manual ke rekening mitra; rekening terverifikasi memungkinkan pencairan otomatis" icon="arrow-up-circle-outline" iconColor={adminTone.amber} padded={false}>
        <DataTable rows={shownWds as unknown as Record<string, unknown>[]} emptyText="Tidak ada permintaan penarikan pada filter ini" emptyIcon="arrow-up-circle-outline"
          columns={[
            { key: 'user', label: 'Pengguna', width: 210, flex: 1, render: (r) => user(r as unknown as W) },
            { key: 'amount', label: 'Nominal', width: 130, align: 'right', mono: true, render: (r) => money(Number(r.amount)) },
            {
              key: 'bank', label: 'Rekening tujuan', width: 290, flex: 1, render: (r) => {
                const x = r as unknown as W;
                return (
                  <View style={{ gap: 4, minWidth: 0 }}>
                    <Truncate style={font.small} title={`${x.bank_name} ${x.bank_account}`}>{x.bank_name} · {x.bank_account}</Truncate>
                    <Truncate style={font.tiny} title={x.account_name}>a.n. {x.account_name}</Truncate>
                    <Row gap={6} style={{ flexWrap: 'wrap' }}>
                      <Pill text={x.bank_verified ? 'Terverifikasi' : 'Belum terverifikasi'} tone={x.bank_verified ? 'ok' : 'off'} />
                      <IconAction compact icon={x.bank_verified ? 'close-circle-outline' : 'checkmark-circle-outline'} label={x.bank_verified ? 'Cabut' : 'Verifikasi'}
                        color={x.bank_verified ? colors.danger : adminTone.teal} onPress={() => setBankVerified(x.user_id, !x.bank_verified)} />
                    </Row>
                  </View>
                );
              },
            },
            { key: 'created_at', label: 'Waktu', width: 150, render: (r) => when(String(r.created_at)) },
            {
              key: 'status', label: 'Status', width: 130, render: (r) => (
                <View style={{ gap: 4, alignItems: 'flex-start' }}>
                  {status(String(r.status))}
                  {r.auto ? <Pill text="Otomatis" tone="info" /> : null}
                </View>
              ),
            },
            {
              key: 'actions', label: 'Aksi', width: 210, render: (r) => r.status === 'pending'
                ? <Row gap={6} style={{ flexWrap: 'wrap' }}>
                  <Button size="sm" title="Sudah ditransfer" color={colors.success} onPress={() => reviewWd(String(r.id), true)} />
                  <Button size="sm" title="Tolak" variant="outline" color={colors.danger} onPress={() => reviewWd(String(r.id), false)} />
                </Row>
                : <Truncate style={font.tiny} title={String(r.review_note ?? '')}>{String(r.review_note ?? '—')}</Truncate>,
            },
          ]} />
      </Panel>

      <Text style={font.tiny}>Halaman ini hanya menangani arus kas dompet (top up & penarikan). Untuk GMV, pendapatan, bagi hasil mitra, dan marjin per layanan/kota, buka <Text style={{ color: adminTone.teal, fontWeight: '700' }} onPress={() => router.push('/(admin)/finance-report' as never)}>Laporan Keuangan</Text>.</Text>
    </AdminPage>
  );
}
