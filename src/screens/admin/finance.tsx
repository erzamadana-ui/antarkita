// Admin · Keuangan — verifikasi top up & penarikan saldo, serta verifikasi rekening mitra.
// Tampilan mengikuti sistem desain panel admin; logika persetujuan tidak berubah.
// v3 (finpay-v3, kontrak §8): kolom payout_status / provider / fee / failed_reason; setelah disetujui, dana dicairkan
//   • manual  → rpc('admin_mark_withdrawal_settled', { p_id, p_provider_ref }) (PIN, nomor referensi bank)
//   • Finpay  → edge function `pay-disburse` { withdrawal_id } (hanya bila app_settings.disbursement_provider = 'finpay').
// admin_review_withdrawal butuh PIN (gerbang ensureUnlocked).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, Linking, Platform, ScrollView, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import {
  AdminPage, Panel, DataTable, Toolbar, FilterBar, StatCard, Pill, RowActions, AdminDialog, RequirePerm, statusTone, adminFont as font, adminTone, adminSpace, adminRadius, adminIcon, adminTable,
} from '@/components/admin';
import { Row, Button, Input, toast } from '@/components/ui';
import { PAYOUT_STATUS_LABEL, payoutTone, invokeEdge, useAdminCan, type WithdrawalV3Extra } from '@/lib/admin';
import { rpc, supabase } from '@/lib/supabase';
import { signedUrl } from '@/lib/upload';
import { adminExportCsv, exportPayoutBatchCsv, exportPayoutBatchBcaCsv } from '@/lib/csv';
import { confirmAsync } from '@/lib/mitra';
import {
  adminPayoutQueue, adminPayoutBatchCreate, adminPayoutBatchExport, adminPayoutBatchSettle, adminPayoutSessions, adminPayoutBatchCreateNow, adminPayoutBatchExportBca,
  type PayoutQueueRow, type PayoutBatch, type PayoutExportRow, type PayoutSession, type PayoutSessionStatus,
} from '@/lib/voucherV5';
import { useVoucherConfig } from '@/hooks/useVoucherV5';
import { handleAdminError, useAdminSecurity } from '@/store/adminSecurity';
import { colors } from '@/lib/theme';
import { rupiah } from '@/lib/format';
import type { Profile, TopupRequest, WithdrawalRequest } from '@/lib/types';
import { usePager, Pager, fmtDate, fmtAgo, Trunc, WideTableHint, ErrorNote } from './_shared';

type T = TopupRequest & { user?: Profile | null };
type W = WithdrawalRequest & WithdrawalV3Extra & { user?: Profile | null; auto?: boolean; bank_verified?: boolean };
const sl: Record<string, string> = { pending: 'Menunggu', approved: 'Disetujui', rejected: 'Ditolak' };
const sum = (xs: { amount: number }[]) => xs.reduce((a, b) => a + Number(b.amount || 0), 0);

export default function AdminFinance() {
  const router = useRouter();
  const [topups, setTopups] = useState<T[]>([]);
  const [wds, setWds] = useState<W[]>([]);
  const [filter, setFilter] = useState('pending');
  const can = useAdminCan();
  const [disbProvider, setDisbProvider] = useState<'manual' | 'finpay'>('manual');
  const [settle, setSettle] = useState<W | null>(null);
  const [ref, setRef] = useState('');
  const [disburse, setDisburse] = useState<W | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    supabase.from('app_settings').select('value').eq('key', 'disbursement_provider').maybeSingle()
      .then(({ data }) => setDisbProvider(String((data as { value?: unknown } | null)?.value ?? 'manual').replace(/"/g, '') === 'finpay' ? 'finpay' : 'manual'));
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

  // 0112 AntarVoucher: persetujuan top up lama berbasis bukti/screenshot DIBLOKIR server (TOPUP_REQUIRE_BANK_MATCH).
  // Top up lama dipindahkan ke antrean AntarVoucher → saldo terbit hanya setelah mutasi bank tercocok + disetujui admin lain.
  const convertTopup = async (id: string) => {
    if (!(await useAdminSecurity.getState().ensureUnlocked())) return;
    try { const v = await rpc<{ reference?: string }>('admin_topup_convert_to_voucher', { p_topup: id }); toast.success(`Dipindahkan ke AntarVoucher${v?.reference ? ` (${v.reference})` : ''} — saldo terbit setelah mutasi bank cocok`); load(); } catch (e) { handleAdminError(e); }
  };
  const rejectTopup = async (id: string) => {
    if (!(await useAdminSecurity.getState().ensureUnlocked())) return;
    try { await rpc('admin_review_topup', { p_id: id, p_approve: false, p_note: 'Bukti tidak valid' }); toast.success('Top up ditolak'); load(); } catch (e) { handleAdminError(e); }
  };
  const reviewWd = async (id: string, ok: boolean) => {
    if (!(await useAdminSecurity.getState().ensureUnlocked())) return;
    try { await rpc('admin_review_withdrawal', { p_id: id, p_approve: ok, p_note: ok ? 'Dana sudah ditransfer' : 'Data rekening tidak valid' }); toast.success(ok ? 'Penarikan disetujui (pastikan dana sudah ditransfer) · rekening ditandai terverifikasi' : 'Penarikan ditolak, saldo dikembalikan'); load(); } catch (e) { handleAdminError(e); }
  };
  /** Payout manual: tandai dana sudah sampai (butuh nomor referensi transfer bank/provider). */
  const submitSettle = async () => {
    if (!settle) return;
    const v = ref.trim();
    if (v.length < 3 || v.length > 120) return toast.error('Nomor referensi bank/provider wajib 3–120 karakter');
    if (!(await useAdminSecurity.getState().ensureUnlocked())) return;
    setBusy(`s:${settle.id}`);
    try { await rpc('admin_mark_withdrawal_settled', { p_id: settle.id, p_provider_ref: v }); toast.success(`Penarikan ${rupiah(settle.amount)} ditandai sampai (ref ${v})`); setSettle(null); setRef(''); load(); }
    catch (e) { handleAdminError(e); } finally { setBusy(null); }
  };
  /** Payout otomatis lewat Finpay disbursement (edge pay-disburse: inquiry → transfer → payout_event_ingest). */
  const submitDisburse = async () => {
    if (!disburse) return;
    if (!(await useAdminSecurity.getState().ensureUnlocked())) return;
    setBusy(`d:${disburse.id}`);
    try {
      const r = await invokeEdge<{ payout_status?: string; provider_ref?: string; message?: string }>('pay-disburse', { withdrawal_id: disburse.id });
      toast.success(`Pencairan ${rupiah(disburse.amount)} dikirim ke Finpay${r?.payout_status ? ` · ${PAYOUT_STATUS_LABEL[r.payout_status as keyof typeof PAYOUT_STATUS_LABEL] ?? r.payout_status}` : ''}${r?.provider_ref ? ` · ref ${r.provider_ref}` : ''}`);
      setDisburse(null); load();
    } catch (e) { handleAdminError(e); } finally { setBusy(null); }
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
  const f = <X extends { status: string }>(xs: X[]) => xs.filter((x) => filter === 'all' || x.status === filter
    || (filter === 'payout' && 'bank_account' in x && x.status === 'approved' && (x as unknown as W).payout_status !== 'PAYOUT_SETTLED' && !(x as unknown as W).settled_at));

  const shownTopups = f(topups), shownWds = f(wds);
  const pgT = usePager(shownTopups, 25), pgW = usePager(shownWds, 25);
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
    <View style={{ minWidth: 0, alignSelf: 'stretch' }}>
      <Trunc style={font.bodyStrong} title={x.user?.full_name ?? ''}>{x.user?.full_name ?? '—'}</Trunc>
      <Trunc style={font.tiny} title={x.user?.email ?? ''}>{x.user?.email ?? '—'}</Trunc>
    </View>
  );
  const money = (n: number) => <Text style={font.mono}>{rupiah(Number(n))}</Text>;
  const when = (iso: string) => <Text style={font.tiny}>{fmtDate(iso)}</Text>;
  const status = (s: string) => <Pill text={sl[s] ?? s} tone={statusTone(s)} />;

  return (
    <AdminPage title="Keuangan" subtitle="Top up lama (AntarVoucher) & penarikan saldo · semua persetujuan butuh PIN panel" onRefresh={load}
      right={<Row gap={8}>
        <Button size="sm" variant="outline" title="Lihat laporan lengkap" icon="document-text-outline" onPress={() => router.push('/(admin)/finance-report' as never)} />
        {Platform.OS === 'web' ? <Button size="sm" title="Ekspor CSV" icon="download-outline" variant="secondary" onPress={exportCsv} /> : null}
      </Row>}>

      <Row gap={adminSpace.md} style={{ flexWrap: 'wrap' }}>
        <StatCard index={0} icon="arrow-down-circle-outline" color={adminTone.blue} label="Top up lama (AntarVoucher) menunggu" value={rupiah(kpi.topupPending)} hint={`${kpi.topupPendingN} permintaan · pindahkan ke AntarVoucher`} />
        <StatCard index={1} icon="arrow-up-circle-outline" color={adminTone.amber} label="Penarikan menunggu" value={rupiah(kpi.wdPending)} hint={`${kpi.wdPendingN} permintaan · butuh PIN panel`} />
        <StatCard index={2} icon="shield-checkmark-outline" color={kpi.unverified > 0 ? adminTone.red : adminTone.green} label="Rekening belum terverifikasi" value={kpi.unverified} hint="pada permintaan penarikan yang menunggu" />
        <StatCard index={3} icon="swap-vertical-outline" color={adminTone.teal} label="Arus kas dompet (disetujui)" value={rupiah(kpi.approvedNet)} hint="top up disetujui − penarikan disetujui" />
      </Row>

      <PayoutQueueV5 onChanged={load} />

      <Toolbar right={<Text style={font.tiny}>{shownTopups.length + shownWds.length} baris ditampilkan · maks 200 terbaru per jenis</Text>}>
        <FilterBar value={filter} onChange={setFilter} options={[{ key: 'pending', label: 'Menunggu' }, { key: 'payout', label: 'Disetujui · dana belum sampai' }, { key: 'approved', label: 'Disetujui' }, { key: 'rejected', label: 'Ditolak' }, { key: 'all', label: 'Semua' }]} />
      </Toolbar>

      <Panel title={`Top up lama (AntarVoucher) (${shownTopups.length})`} subtitle="Bukti/screenshot tidak menambah saldo — pindahkan ke AntarVoucher; saldo terbit setelah mutasi bank tercocok & disetujui admin lain" icon="arrow-down-circle-outline" iconColor={adminTone.blue} padded={false}>
        <DataTable rows={pgT.rows as unknown as Record<string, unknown>[]} emptyText="Tidak ada permintaan top up pada filter ini" emptyIcon="arrow-down-circle-outline"
          columns={[
            { key: 'user', label: 'Pengguna', width: 196, render: (r) => user(r as unknown as T) },
            { key: 'amount', label: 'Nominal', width: 118, align: 'right', mono: true, render: (r) => money(Number(r.amount)) },
            {
              key: 'note', label: 'Catatan / bukti', width: 204, render: (r) => {
                const x = r as unknown as T;
                return (
                  <View style={{ minWidth: 0, gap: 2, alignSelf: 'stretch' }}>
                    <Trunc style={font.small} title={x.sender_note ?? ''}>{x.sender_note || 'Tanpa catatan'}</Trunc>
                    {x.proof_url
                      ? <Pressable onPress={() => openProof(x.proof_url)} hitSlop={4}><Text style={[font.tiny, { color: adminTone.teal, fontWeight: '700' }]}>Lihat bukti transfer</Text></Pressable>
                      : <Text style={[font.tiny, { color: adminTone.red }]}>Tanpa bukti</Text>}
                  </View>
                );
              },
            },
            { key: 'created_at', label: 'Waktu', width: 134, render: (r) => when(String(r.created_at)) },
            { key: 'status', label: 'Status', width: 102, render: (r) => status(String(r.status)) },
            {
              // Aksi utama = pindahkan ke AntarVoucher (0112); penolakan (berbahaya) ada di menu kebab.
              key: 'actions', label: 'Aksi', width: 244, align: 'right', render: (r) => r.status === 'pending'
                ? (
                  <RowActions
                    primary={[{ key: 'cv', label: 'Pindahkan ke AntarVoucher', icon: 'ticket-outline', variant: 'solid' as const, color: adminTone.teal, onPress: () => convertTopup(String(r.id)) }]}
                    menu={[
                      { key: 'proof', label: 'Lihat bukti transfer', icon: 'image-outline', disabled: !r.proof_url, onPress: () => openProof(String(r.proof_url ?? '')) },
                      { key: 'no', label: 'Tolak top up…', icon: 'close-circle-outline', danger: true, onPress: () => rejectTopup(String(r.id)) },
                    ]}
                  />
                )
                : <Trunc style={font.tiny} title={String(r.review_note ?? '')}>{String(r.review_note ?? '—')}</Trunc>,
            },
          ]} />
        <View style={{ padding: adminSpace.md, gap: 6 }}><WideTableHint /><Pager p={pgT} noun="top up lama" /></View>
      </Panel>

      <Panel title={`Penarikan saldo (${shownWds.length})`} subtitle={`Setujui dulu (PIN), lalu cairkan: ${disbProvider === 'finpay' ? 'Finpay disbursement aktif (pay-disburse)' : 'mode manual — transfer bank lalu isi nomor referensi'}. Disetujui ≠ dana sampai.`} icon="arrow-up-circle-outline" iconColor={adminTone.amber} padded={false}>
        <DataTable rows={pgW.rows as unknown as Record<string, unknown>[]} emptyText="Tidak ada permintaan penarikan pada filter ini" emptyIcon="arrow-up-circle-outline"
          columns={[
            { key: 'user', label: 'Pengguna', width: 180, render: (r) => user(r as unknown as W) },
            { key: 'amount', label: 'Nominal', width: 118, align: 'right', mono: true, render: (r) => money(Number(r.amount)) },
            {
              key: 'bank', label: 'Rekening tujuan', width: 214, render: (r) => {
                const x = r as unknown as W;
                return (
                  <View style={{ gap: 4, minWidth: 0, alignSelf: 'stretch' }}>
                    <Trunc style={font.small} title={`${x.bank_name} ${x.bank_account}`}>{x.bank_name} · {x.bank_account}</Trunc>
                    <Trunc style={font.tiny} title={x.account_name}>a.n. {x.account_name}</Trunc>
                    <Pill text={x.bank_verified ? 'Rekening terverifikasi' : 'Rekening belum terverifikasi'} tone={x.bank_verified ? 'ok' : 'off'} />
                  </View>
                );
              },
            },
            { key: 'created_at', label: 'Waktu', width: 118, render: (r) => when(String(r.created_at)) },
            {
              key: 'status', label: 'Status', width: 104, render: (r) => (
                <View style={{ gap: 4, alignItems: 'flex-start' }}>
                  {status(String(r.status))}
                  {r.auto ? <Pill text="Otomatis" tone="info" /> : null}
                </View>
              ),
            },
            {
              key: 'payout_status', label: 'Payout', width: 190, render: (r) => {
                const x = r as unknown as W;
                if (x.status !== 'approved' && !x.payout_status) return <Text style={font.tiny}>—</Text>;
                const ps = x.payout_status ?? (x.settled_at ? 'PAYOUT_SETTLED' : 'PAYOUT_PENDING');
                return (
                  <View style={{ gap: 3, minWidth: 0, alignSelf: 'stretch' }}>
                    <Pill text={PAYOUT_STATUS_LABEL[ps] ?? ps} tone={payoutTone(ps)} />
                    <Text style={font.tiny} numberOfLines={1}>{x.provider === 'finpay' ? 'Finpay' : 'Manual'}{x.fee ? ` · biaya ${rupiah(Number(x.fee))}` : ''}{x.provider_ref ? ` · ref ${x.provider_ref}` : ''}</Text>
                    {x.failed_reason ? <Trunc style={[font.tiny, { color: adminTone.red }]} title={x.failed_reason}>{x.failed_reason}</Trunc> : null}
                  </View>
                );
              },
            },
            {
              // Aksi utama = tandai sudah ditransfer (butuh PIN); verifikasi rekening & penolakan di kebab.
              key: 'actions', label: 'Aksi', width: 220, align: 'right', render: (r) => {
                const x = r as unknown as W;
                return x.status === 'pending'
                  ? (
                    <RowActions
                      primary={[{ key: 'ok', label: 'Sudah ditransfer', variant: 'solid' as const, color: colors.success, onPress: () => reviewWd(x.id, true) }]}
                      menu={[
                        { key: 'bank', label: x.bank_verified ? 'Cabut verifikasi rekening' : 'Tandai rekening terverifikasi', icon: x.bank_verified ? 'close-circle-outline' : 'checkmark-circle-outline', onPress: () => setBankVerified(x.user_id, !x.bank_verified) },
                        { key: 'no', label: 'Tolak penarikan…', icon: 'close-circle-outline', danger: true, hint: 'saldo dikembalikan', onPress: () => reviewWd(x.id, false) },
                      ]}
                    />
                  )
                  : x.status === 'approved' && x.payout_status !== 'PAYOUT_SETTLED' && x.payout_status !== 'PAYOUT_PROCESSING' && !x.settled_at && can('payout')
                    ? (
                      <RowActions
                        primary={[
                          disbProvider === 'finpay'
                            ? { key: 'fp', label: 'Cairkan via Finpay', icon: 'flash-outline', variant: 'solid' as const, color: adminTone.teal, busy: busy === `d:${x.id}`, onPress: () => setDisburse(x) }
                            : { key: 'st', label: 'Tandai sampai', icon: 'checkmark-done-outline', variant: 'solid' as const, color: colors.success, busy: busy === `s:${x.id}`, onPress: () => { setRef(''); setSettle(x); } },
                        ]}
                        menu={[
                          disbProvider === 'finpay' && { key: 'st', label: 'Tandai sampai (transfer manual)…', icon: 'checkmark-done-outline', onPress: () => { setRef(''); setSettle(x); } },
                        ]}
                      />
                    )
                    : <Trunc style={font.tiny} title={String(r.review_note ?? '')}>{String(r.review_note ?? '—')}</Trunc>;
              },
            },
          ]} />
        <View style={{ padding: adminSpace.md, gap: 6 }}><WideTableHint /><Pager p={pgW} noun="permintaan penarikan" /></View>
      </Panel>

      <AdminDialog visible={!!settle} onClose={() => setSettle(null)} title="Tandai dana sudah sampai"
        subtitle={settle ? `${settle.user?.full_name ?? '—'} · ${rupiah(settle.amount)} · ${settle.bank_name} ${settle.bank_account} a.n. ${settle.account_name}` : undefined}>
        <Text style={font.small}>Isi nomor referensi transfer dari bank/provider (3–120 karakter, unik). Butuh PIN panel; mitra menerima notifikasi berisi nomor referensi.</Text>
        <Input label="Nomor referensi bank/provider" placeholder="mis. BCA-20260924-000123" value={ref} onChangeText={setRef} autoCapitalize="characters" onSubmitEditing={submitSettle} />
        <Row gap={8} style={{ justifyContent: 'flex-end' }}>
          <Button size="sm" variant="ghost" title="Batal" onPress={() => setSettle(null)} />
          <Button size="sm" title="Tandai sampai" icon="checkmark-done" loading={!!settle && busy === `s:${settle.id}`} disabled={ref.trim().length < 3} onPress={submitSettle} />
        </Row>
      </AdminDialog>

      <AdminDialog visible={!!disburse} onClose={() => setDisburse(null)} title="Cairkan lewat Finpay?" tone={adminTone.teal}
        subtitle={disburse ? `${disburse.user?.full_name ?? '—'} · ${rupiah(disburse.amount)} → ${disburse.bank_name} ${disburse.bank_account} a.n. ${disburse.account_name}` : undefined}>
        <Text style={font.body}>Server melakukan inquiry rekening lalu transfer lewat Finpay disbursement. Bila gagal, status menjadi Gagal dan saldo mitra dikembalikan otomatis. Biaya transfer dicatat sebagai payout_fee.</Text>
        {disburse && !disburse.bank_verified ? <Text style={[font.small, { color: colors.danger }]}>Rekening belum terverifikasi — nama pemilik akan dicek lewat inquiry; periksa hasilnya sebelum mencoba ulang bila gagal.</Text> : null}
        <Row gap={8} style={{ justifyContent: 'flex-end' }}>
          <Button size="sm" variant="ghost" title="Batal" onPress={() => setDisburse(null)} />
          <Button size="sm" title="Cairkan sekarang" icon="flash-outline" loading={!!disburse && busy === `d:${disburse.id}`} onPress={submitDisburse} />
        </Row>
      </AdminDialog>

      <Text style={font.tiny}>Halaman ini hanya menangani arus kas dompet (top up lama (AntarVoucher) & penarikan). Pembelian voucher baru & pencocokan mutasi bank ada di <Text style={[font.tiny, { color: adminTone.teal, fontWeight: '700' }]} onPress={() => router.push('/(admin)/voucher' as never)}>AntarVoucher</Text>. Untuk GMV, pendapatan, bagi hasil mitra, dan marjin per layanan/kota, buka <Text style={[font.tiny, { color: adminTone.teal, fontWeight: '700' }]} onPress={() => router.push('/(admin)/finance-report' as never)}>Laporan Keuangan</Text>.</Text>
    </AdminPage>
  );
}

/* ───────────────────────── v5 · Antrean pencairan SLA 24 jam + batch transfer massal (KONTRAK-V5 §3) ───────────────────────── */
// admin_payout_queue → baris dengan sla_remaining_min/overdue; admin_payout_batch_create (PIN) mengumpulkan approved tanpa batch;
// admin_payout_batch_export → CSV transfer massal (src/lib/csv.ts); admin_payout_batch_settle (PIN) → ok/failed per baris.
// Daftar batch dibaca langsung dari tabel payout_batches (RLS admin, migrasi 0114 DB Agent).

const BATCH_LABEL: Record<PayoutBatch['status'], { label: string; tone: 'wait' | 'info' | 'ok' }> = {
  open: { label: 'Terbuka · belum diekspor', tone: 'wait' }, exported: { label: 'CSV diekspor · menunggu bukti transfer', tone: 'info' }, settled: { label: 'Selesai', tone: 'ok' },
};
const slaText = (m: number | null | undefined, overdue: boolean) => {
  if (m == null) return 'SLA belum disetel';
  const a = Math.abs(Math.round(m)); const h = Math.floor(a / 60), mm = a % 60;
  const t = h ? `${h} j ${mm} mnt` : `${mm} mnt`;
  return overdue ? `LEWAT ${t}` : `sisa ${t}`;
};
type SettleDraft = Record<string, { status: 'ok' | 'failed'; bank_ref: string; reason: string }>;

function PayoutQueueV5({ onChanged }: { onChanged: () => Promise<void> | void }) {
  const can = useAdminCan();
  const { config } = useVoucherConfig();
  const [queue, setQueue] = useState<PayoutQueueRow[]>([]);
  const [batches, setBatches] = useState<PayoutBatch[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [settleBatch, setSettleBatch] = useState<PayoutBatch | null>(null);
  const [settleRows, setSettleRows] = useState<PayoutExportRow[]>([]);
  const [draft, setDraft] = useState<SettleDraft>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [q, { data: b, error }] = await Promise.all([
        adminPayoutQueue(),
        supabase.from('payout_batches').select('*').order('created_at', { ascending: false }).limit(30),
      ]);
      setQueue(Array.isArray(q) ? q : []);
      if (error) toast.error(`Daftar batch: ${error.message}`); else setBatches((b as PayoutBatch[]) ?? []);
      setErr(null);
    } catch (e) { setErr(`Antrean pencairan: ${(e as Error).message}`); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const unbatched = queue.filter((r) => r.status === 'approved' && !r.batch_id);
  const overdue = queue.filter((r) => r.overdue && r.status !== 'settled');
  const sumQ = (xs: PayoutQueueRow[]) => xs.reduce((a, b) => a + Number(b.amount || 0), 0);
  const pg = usePager([...queue].sort((a, b) => (a.sla_remaining_min ?? 1e9) - (b.sla_remaining_min ?? 1e9)), 25);

  const createBatch = async () => {
    if (!unbatched.length) return toast.error('Tidak ada permintaan disetujui yang belum masuk batch');
    if (!(await confirmAsync('Buat batch transfer?', `${unbatched.length} permintaan disetujui · total ${rupiah(sumQ(unbatched))} akan dikumpulkan ke satu batch. Setelah itu unduh CSV transfer massal dan unggah ke internet banking.`, 'Ya, buat batch'))) return;
    if (!(await useAdminSecurity.getState().ensureUnlocked())) return;
    setBusy('create');
    try { const b = await adminPayoutBatchCreate(); toast.success(`Batch ${b?.id ? b.id.slice(0, 8) : ''} dibuat · ${b?.count ?? unbatched.length} baris · ${rupiah(Number(b?.total ?? sumQ(unbatched)))}`); await load(); }
    catch (e) { handleAdminError(e); } finally { setBusy(null); }
  };
  const exportBatch = async (b: PayoutBatch) => {
    setBusy(`x:${b.id}`);
    try { const rows = await adminPayoutBatchExport(b.id); await exportPayoutBatchCsv(b.id, Array.isArray(rows) ? rows : []); await load(); }
    catch (e) { handleAdminError(e); } finally { setBusy(null); }
  };
  const openSettle = async (b: PayoutBatch) => {
    setBusy(`o:${b.id}`);
    try {
      // Baris batch diambil dari export (idempoten di server; status batch tetap exported).
      const rows = await adminPayoutBatchExport(b.id);
      const list = Array.isArray(rows) ? rows : [];
      if (!list.length) return toast.error('Batch tidak punya baris');
      setSettleRows(list); setDraft(Object.fromEntries(list.map((r) => [r.withdrawal_id, { status: 'ok' as const, bank_ref: '', reason: '' }]))); setSettleBatch(b);
    } catch (e) { handleAdminError(e); } finally { setBusy(null); }
  };
  const submitSettle = async () => {
    if (!settleBatch) return;
    const refs = settleRows.map((r) => { const d = draft[r.withdrawal_id]; return { withdrawal_id: r.withdrawal_id, status: d?.status ?? 'ok', bank_ref: d?.bank_ref.trim() || undefined, reason: d?.reason.trim() || undefined }; });
    const badOk = refs.filter((x) => x.status === 'ok' && (!x.bank_ref || x.bank_ref.length < 3));
    if (badOk.length) return toast.error(`${badOk.length} baris "berhasil" belum punya nomor referensi bank (min 3 karakter)`);
    const badFail = refs.filter((x) => x.status === 'failed' && !x.reason);
    if (badFail.length) return toast.error(`${badFail.length} baris "gagal" belum punya alasan`);
    const nOk = refs.filter((x) => x.status === 'ok').length, nFail = refs.length - nOk;
    if (!(await confirmAsync('Tandai batch selesai?', `${nOk} transfer berhasil (status settled, mitra diberi tahu) · ${nFail} gagal (request ditolak, saldo mitra dikembalikan). Tindakan tidak bisa dibatalkan.`, 'Ya, tandai selesai'))) return;
    if (!(await useAdminSecurity.getState().ensureUnlocked())) return;
    setBusy(`s:${settleBatch.id}`);
    try { await adminPayoutBatchSettle(settleBatch.id, refs); toast.success(`Batch ${settleBatch.id.slice(0, 8)} selesai · ${nOk} berhasil · ${nFail} gagal`); setSettleBatch(null); await load(); await onChanged(); }
    catch (e) { handleAdminError(e); } finally { setBusy(null); }
  };
  const setD = (id: string, patch: Partial<SettleDraft[string]>) => setDraft((d) => ({ ...d, [id]: { ...(d[id] ?? { status: 'ok', bank_ref: '', reason: '' }), ...patch } }));

  return (
    <>
      <PayoutSessionsPanel batches={batches} busy={busy} setBusy={setBusy} onSettle={openSettle} onExportGeneral={exportBatch} onReload={async () => { await load(); await onChanged(); }} />

      <Row gap={adminSpace.md} style={{ flexWrap: 'wrap' }}>
        <StatCard index={0} icon="time-outline" label="Antrean pencairan (SLA 24 jam)" value={queue.length} hint={`${rupiah(sumQ(queue))} · pending + disetujui belum sampai`} color={adminTone.blue} />
        <StatCard index={1} icon="alert-circle-outline" label="Lewat SLA" value={overdue.length} hint={overdue.length ? `${rupiah(sumQ(overdue))} — prioritaskan!` : 'semua dalam SLA'} color={overdue.length ? adminTone.red : adminTone.green} />
        <StatCard index={2} icon="layers-outline" label="Siap masuk batch" value={unbatched.length} hint={`${rupiah(sumQ(unbatched))} disetujui tanpa batch`} color={adminTone.teal} />
        <StatCard index={3} icon="albums-outline" label="Batch belum selesai" value={batches.filter((b) => b.status !== 'settled').length} hint={`cutoff ${config.payment_mode === 'voucher_only' ? 'mode AntarVoucher' : 'mode gateway'} · lihat tabel batch`} color={adminTone.amber} />
      </Row>

      <Panel title={`Antrean pencairan (${queue.length})`} subtitle="Diurutkan dari sisa SLA terkecil. Merah = sudah lewat 24 jam sejak request (security_events payout.sla_breach). Alur: setujui (tabel Penarikan di bawah) → Buat batch → Unduh CSV → transfer di internet banking → Tandai selesai." icon="time-outline" iconColor={adminTone.blue} padded={false}
        right={<RequirePerm perm="finance" fallback={<Text style={font.tiny}>Batch: izin keuangan (payout)</Text>}><Button size="sm" title={`Buat batch (${unbatched.length})`} icon="layers-outline" loading={busy === 'create'} disabled={!unbatched.length || busy !== null} onPress={createBatch} /></RequirePerm>}>
        <View style={{ padding: adminSpace.md, paddingBottom: 0 }}><ErrorNote text={err} onRetry={load} /></View>
        <DataTable rows={pg.rows as unknown as Record<string, unknown>[]} emptyText={loading ? 'Memuat…' : 'Tidak ada permintaan pencairan dalam antrean'} emptyIcon="time-outline"
          columns={[
            { key: 'name', label: 'Mitra', width: 180, render: (r) => { const x = r as unknown as PayoutQueueRow; return <View style={{ minWidth: 0, alignSelf: 'stretch' }}><Trunc style={font.bodyStrong} title={x.name}>{x.name || '—'}</Trunc><Text style={font.tiny}>{x.role || '—'}</Text></View>; } },
            { key: 'amount', label: 'Nominal', width: 118, align: 'right', mono: true, render: (r) => <Text style={font.mono}>{rupiah(Number(r.amount))}</Text> },
            { key: 'bank', label: 'Rekening', width: 200, render: (r) => { const x = r as unknown as PayoutQueueRow; return <View style={{ minWidth: 0, alignSelf: 'stretch' }}><Trunc style={font.small} title={`${x.bank_code ?? ''} ${x.account_no ?? ''}`}>{x.bank_code ?? '—'} · {x.account_no ?? '—'}</Trunc><Trunc style={font.tiny} title={x.account_name ?? ''}>a.n. {x.account_name ?? '—'}</Trunc></View>; } },
            { key: 'sla', label: 'SLA', width: 150, render: (r) => { const x = r as unknown as PayoutQueueRow; return <View style={{ gap: 3, alignItems: 'flex-start' }}><Pill text={slaText(x.sla_remaining_min, x.overdue)} tone={x.overdue ? 'bad' : (x.sla_remaining_min ?? 1e9) < 240 ? 'wait' : 'ok'} /><Text style={font.tiny}>jatuh tempo {fmtDate(x.sla_due_at)}</Text></View>; } },
            { key: 'status', label: 'Status', width: 150, render: (r) => { const x = r as unknown as PayoutQueueRow; return <View style={{ gap: 3, alignItems: 'flex-start' }}><Pill text={sl[x.status] ?? x.status} tone={statusTone(x.status)} />{x.batch_id ? <Pill text={`batch ${x.batch_id.slice(0, 8)}`} tone="info" /> : x.status === 'approved' ? <Pill text="belum masuk batch" tone="wait" /> : null}</View>; } },
            { key: 'created_at', label: 'Request', width: 134, render: (r) => <Text style={font.tiny}>{fmtDate(String(r.created_at))} · {fmtAgo(String(r.created_at))}</Text> },
          ]} />
        <View style={{ padding: adminSpace.md, gap: 6 }}><WideTableHint /><Pager p={pg} noun="permintaan" /></View>
      </Panel>

      <Panel title={`Batch transfer massal (${batches.length})`} subtitle="Satu batch = satu berkas CSV untuk internet banking (kolom: nama, bank, no rekening, nominal, berita). Setelah transfer, isi nomor referensi per baris lalu tandai selesai." icon="albums-outline" iconColor={adminTone.amber} padded={false}>
        <DataTable rows={batches as unknown as Record<string, unknown>[]} emptyText={loading ? 'Memuat…' : 'Belum ada batch — buat dari antrean di atas'} emptyIcon="albums-outline"
          columns={[
            { key: 'id', label: 'Batch', width: 120, render: (r) => <Text style={font.mono} selectable>{String(r.id).slice(0, 8)}</Text> },
            { key: 'created_at', label: 'Dibuat', width: 140, render: (r) => <Text style={font.tiny}>{fmtDate(String(r.created_at))}</Text> },
            { key: 'count', label: 'Baris', width: 70, align: 'right', mono: true, render: (r) => <Text style={font.mono}>{Number(r.count ?? 0)}</Text> },
            { key: 'total', label: 'Total', width: 130, align: 'right', mono: true, render: (r) => <Text style={font.mono}>{rupiah(Number(r.total ?? 0))}</Text> },
            { key: 'status', label: 'Status', width: 230, render: (r) => { const b = r as unknown as PayoutBatch; const lb = BATCH_LABEL[b.status] ?? { label: b.status, tone: 'wait' as const }; return <View style={{ gap: 3, alignItems: 'flex-start' }}><Pill text={lb.label} tone={lb.tone} /><Text style={font.tiny}>{b.exported_at ? `ekspor ${fmtDate(b.exported_at)}` : ''}{b.settled_at ? ` · selesai ${fmtDate(b.settled_at)}` : ''}</Text></View>; } },
            { key: 'actions', label: 'Aksi', width: 300, align: 'right', render: (r) => {
              const b = r as unknown as PayoutBatch;
              if (b.status === 'settled' || !can('finance')) return <Text style={font.tiny}>{b.status === 'settled' ? 'selesai' : 'izin keuangan'}</Text>;
              return (
                <Row gap={6} style={{ justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                  <Button size="sm" variant="secondary" title={Platform.OS === 'web' ? 'Unduh CSV' : 'Bagikan CSV'} icon="download-outline" loading={busy === `x:${b.id}`} disabled={busy !== null} onPress={() => exportBatch(b)} />
                  <Button size="sm" title="Tandai selesai" icon="checkmark-done-outline" color={colors.success} loading={busy === `o:${b.id}`} disabled={busy !== null} onPress={() => openSettle(b)} />
                </Row>
              );
            } },
          ]} />
        <View style={{ padding: adminSpace.md, gap: 6 }}><WideTableHint /></View>
      </Panel>

      <AdminDialog visible={!!settleBatch} onClose={() => (busy ? undefined : setSettleBatch(null))} title={`Tandai batch ${settleBatch?.id.slice(0, 8) ?? ''} selesai`} width={760}
        subtitle={settleBatch ? `${settleRows.length} baris · ${rupiah(Number(settleBatch.total ?? 0))} · isi nomor referensi transfer per baris; baris gagal wajib beralasan (saldo mitra dikembalikan)` : undefined}>
        <View style={{ gap: 8, maxHeight: 440 }}>
          <Row gap={8} style={{ justifyContent: 'flex-end' }}>
            <Button size="sm" variant="ghost" title="Semua berhasil" onPress={() => setDraft((d) => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, { ...v, status: 'ok' as const }])))} />
          </Row>
          <ScrollView style={{ maxHeight: 340 }}>
            <View style={{ gap: 8 }}>
              {settleRows.map((r) => {
                const d = draft[r.withdrawal_id] ?? { status: 'ok' as const, bank_ref: '', reason: '' };
                return (
                  <View key={r.withdrawal_id} style={{ gap: 6, padding: adminSpace.sm, borderWidth: 1, borderColor: d.status === 'failed' ? adminTone.red : adminTone.border, borderRadius: 8 }}>
                    <Row between style={{ flexWrap: 'wrap', gap: 6 }}>
                      <View style={{ flex: 1, minWidth: 200 }}><Text style={font.bodyStrong} numberOfLines={1}>{r.account_name || r.name} · {rupiah(Number(r.amount))}</Text><Text style={font.tiny}>{r.bank_code} {r.account_no} · {r.withdrawal_id.slice(0, 8)}</Text></View>
                      <Row gap={6}>
                        <Button size="sm" variant={d.status === 'ok' ? 'primary' : 'outline'} title="Berhasil" onPress={() => setD(r.withdrawal_id, { status: 'ok' })} />
                        <Button size="sm" variant={d.status === 'failed' ? 'danger' : 'outline'} title="Gagal" onPress={() => setD(r.withdrawal_id, { status: 'failed' })} />
                      </Row>
                    </Row>
                    {d.status === 'ok'
                      ? <Input placeholder="Nomor referensi bank (mis. BCA-20261010-000123)" value={d.bank_ref} onChangeText={(v) => setD(r.withdrawal_id, { bank_ref: v })} autoCapitalize="characters" />
                      : <Input placeholder="Alasan gagal (rekening salah / ditolak bank) — saldo mitra dikembalikan" value={d.reason} onChangeText={(v) => setD(r.withdrawal_id, { reason: v })} />}
                  </View>
                );
              })}
            </View>
          </ScrollView>
          <Row gap={8} style={{ justifyContent: 'flex-end' }}>
            <Button size="sm" variant="ghost" title="Batal" disabled={busy !== null} onPress={() => setSettleBatch(null)} />
            <Button size="sm" title="Tandai selesai" icon="checkmark-done" loading={!!settleBatch && busy === `s:${settleBatch.id}`} disabled={busy !== null} onPress={submitSettle} />
          </Row>
        </View>
      </AdminDialog>
    </>
  );
}

/* ───────────────────── 0119 · Sesi transfer harian (09:00 · 13:00 · 17:00 WIB) ───────────────────── */
// admin_payout_sessions(p_date) → status per cutoff; admin_payout_batch_create_now(p_label) (PIN) = batch manual di luar jadwal;
// admin_payout_batch_export_bca(p_batch) → teks CSV KlikBCA Bisnis. Jadwal cutoff dibaca dari app_settings.payout_batch_cutoffs.

const SESSION_CUTOFFS = ['09:00', '13:00', '17:00'] as const;
const SESSION_STATUS: Record<PayoutSessionStatus, { label: string; tone: 'wait' | 'off' | 'info' | 'ok'; icon: React.ComponentProps<typeof Ionicons>['name'] }> = {
  menunggu: { label: 'Menunggu cutoff', tone: 'wait', icon: 'time-outline' },
  kosong: { label: 'Kosong — tidak ada permintaan', tone: 'off', icon: 'remove-circle-outline' },
  dibuat: { label: 'Batch dibuat · belum selesai', tone: 'info', icon: 'albums-outline' },
  selesai: { label: 'Selesai', tone: 'ok', icon: 'checkmark-done-outline' },
};
const pad2 = (n: number) => String(n).padStart(2, '0');
/** Tanggal hari ini menurut WIB → "YYYY-MM-DD". */
const todayWib = () => { const t = new Date(Date.now() + 7 * 3600000); return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`; };
const shiftDay = (d: string, delta: number) => { const [y, m, dd] = d.split('-').map(Number); const x = new Date(Date.UTC(y, m - 1, dd + delta)); return `${x.getUTCFullYear()}-${pad2(x.getUTCMonth() + 1)}-${pad2(x.getUTCDate())}`; };
const dayLabel = (d: string) => { const [y, m, dd] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1, dd)).toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }); };

function PayoutSessionsPanel({ batches, busy, setBusy, onSettle, onExportGeneral, onReload }: {
  batches: PayoutBatch[]; busy: string | null; setBusy: (v: string | null) => void;
  onSettle: (b: PayoutBatch) => Promise<void>; onExportGeneral: (b: PayoutBatch) => Promise<void>; onReload: () => Promise<void>;
}) {
  const can = useAdminCan();
  const [date, setDate] = useState(todayWib());
  const [sessions, setSessions] = useState<PayoutSession[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [cutoffs, setCutoffs] = useState<string[] | null>(null);
  const [label, setLabel] = useState('');
  const [manualOn, setManualOn] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setSessions(await adminPayoutSessions(date)); setErr(null); }
    catch (e) { setSessions([]); setErr(`Sesi transfer: ${(e as Error).message}`); }
    finally { setLoading(false); }
  }, [date]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    supabase.from('app_settings').select('value').eq('key', 'payout_batch_cutoffs').maybeSingle()
      .then(({ data }) => { const v = (data as { value?: unknown } | null)?.value; setCutoffs(Array.isArray(v) ? v.map(String) : null); });
  }, []);

  /** Server (0119) mengirim satu baris per cutoff dari setelan + sesi manual hari itu. Bila RPC gagal/kosong, tiga sesi baku tampil sebagai 'menunggu'. */
  const cards = useMemo<PayoutSession[]>(() => (sessions.length ? sessions : SESSION_CUTOFFS.map((c) => ({
    session_id: null, session_date: date, cutoff: c, status: 'menunggu' as const, is_past: false, batch_id: null, batch_status: null, items: 0, total: 0, settled_items: 0, failed_items: 0,
    pending_now_items: 0, pending_now_total: 0, note: null, created_at: null, closed_at: null,
  }))), [sessions, date]);
  const isManual = (c: PayoutSession) => String(c.cutoff) === 'manual' || !/^\d{2}:\d{2}$/.test(String(c.cutoff));
  const batchOf = (sx: PayoutSession): PayoutBatch | null => {
    if (!sx.batch_id) return null;
    return batches.find((b) => b.id === sx.batch_id) ?? { id: sx.batch_id, created_at: sx.created_at ?? new Date().toISOString(), cutoff: String(sx.cutoff), status: sx.batch_status ?? (sx.status === 'selesai' ? 'settled' : 'exported'), total: Number(sx.total || 0), count: Number(sx.items || 0), exported_at: null, settled_at: null };
  };

  const exportBca = async (sx: PayoutSession) => {
    if (!sx.batch_id) return;
    setBusy(`bca:${sx.batch_id}`);
    try { const csv = await adminPayoutBatchExportBca(sx.batch_id); await exportPayoutBatchBcaCsv(sx.batch_id, String(csv ?? '')); await onReload(); await load(); }
    catch (e) { handleAdminError(e); } finally { setBusy(null); }
  };
  const createNow = async () => {
    const pending = cards.reduce((a, c) => Math.max(a, Number(c.pending_now_items || 0)), 0);
    const pendingTotal = cards.reduce((a, c) => Math.max(a, Number(c.pending_now_total || 0)), 0);
    if (!(await confirmAsync('Buat batch transfer sekarang?', `${pending ? `${pending} permintaan disetujui (${rupiah(pendingTotal)}) yang belum masuk batch` : 'Semua permintaan disetujui yang belum masuk batch'} akan dikumpulkan ke satu batch manual (di luar jadwal cutoff). Setelah itu unduh CSV dan transfer di KlikBCA Bisnis.`, 'Ya, buat batch'))) return;
    if (!(await useAdminSecurity.getState().ensureUnlocked())) return;
    setBusy('create-now');
    try {
      const r = await adminPayoutBatchCreateNow(label.trim() || null);
      const b = r?.batch, sess = r?.session;
      toast.success(`Batch manual ${b?.id ? b.id.slice(0, 8) : ''} dibuat · ${Number(sess?.items ?? b?.count ?? 0)} baris · ${rupiah(Number(sess?.total ?? b?.total ?? 0))}`);
      setLabel(''); setManualOn(false); await onReload(); await load();
    } catch (e) {
      if (/PAYOUT_BATCH_EMPTY/.test(String((e as Error).message))) toast.show('Tidak ada pencairan disetujui yang menunggu batch');
      else handleAdminError(e);
    } finally { setBusy(null); }
  };

  const today = todayWib();
  const isToday = date === today;
  const totalDay = cards.reduce((a, c) => a + Number(c.total || 0), 0), itemsDay = cards.reduce((a, c) => a + Number(c.items || 0), 0);
  const cutoffText = cutoffs?.length ? cutoffs.join(' · ') : '09:00 · 13:00 · 17:00';
  const cutoffMismatch = !!cutoffs && (cutoffs.length !== 3 || cutoffs.some((c, i) => c !== SESSION_CUTOFFS[i]));

  return (
    <Panel title="Daftar transfer harian (3 sesi: 09:00 · 13:00 · 17:00 WIB)" subtitle="Setiap cutoff server mengumpulkan permintaan pencairan yang sudah disetujui menjadi satu batch. Unduh CSV (format KlikBCA Bisnis / umum), transfer di internet banking, lalu Tandai selesai dengan nomor referensi per baris." icon="calendar-outline" iconColor={adminTone.teal}
      right={<Row gap={6} style={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        <Pressable onPress={() => setDate((d) => shiftDay(d, -1))} style={sx.navBtn} accessibilityLabel="Hari sebelumnya"><Ionicons name="chevron-back" size={adminIcon.md} color={adminTone.ink2} /></Pressable>
        <View style={sx.day}><Ionicons name="calendar-outline" size={adminIcon.sm} color={adminTone.teal} /><Text style={font.bodyStrong}>{dayLabel(date)}</Text></View>
        <Pressable onPress={() => setDate((d) => (shiftDay(d, 1) > today ? d : shiftDay(d, 1)))} style={[sx.navBtn, isToday && { opacity: 0.35 }]} disabled={isToday} accessibilityLabel="Hari berikutnya"><Ionicons name="chevron-forward" size={adminIcon.md} color={adminTone.ink2} /></Pressable>
        {!isToday ? <Button size="sm" variant="ghost" title="Hari ini" onPress={() => setDate(today)} /> : null}
        <RequirePerm perm="finance" fallback={<Text style={font.tiny}>Batch manual: izin keuangan</Text>}>
          <Button size="sm" variant="secondary" title="Buat batch sekarang" icon="flash-outline" disabled={busy !== null || !isToday} onPress={() => setManualOn((v) => !v)} />
        </RequirePerm>
      </Row>}>
      <View style={{ gap: adminSpace.md }}>
        <ErrorNote text={err} onRetry={load} />
        {manualOn && isToday ? (
          <View style={sx.manualBox}>
            <Text style={font.small}>Batch manual mengumpulkan semua permintaan disetujui yang belum masuk batch, tanpa menunggu cutoff berikutnya. Butuh PIN panel; tercatat di log keuangan.</Text>
            <Row gap={8} style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <Input label="Label (opsional)" placeholder="mis. susulan 15:30 — driver lewat SLA" value={label} onChangeText={setLabel} containerStyle={{ flex: 1, minWidth: 220 }} />
              <Button size="sm" title="Buat batch manual" icon="flash-outline" loading={busy === 'create-now'} disabled={busy !== null} onPress={createNow} />
              <Button size="sm" variant="ghost" title="Batal" disabled={busy !== null} onPress={() => setManualOn(false)} />
            </Row>
          </View>
        ) : null}
        <Row gap={adminSpace.md} style={{ flexWrap: 'wrap', alignItems: 'stretch' }}>
          {cards.map((c, i) => {
            const m = SESSION_STATUS[c.status] ?? SESSION_STATUS.menunggu;
            const b = batchOf(c);
            const manual = isManual(c);
            const late = c.status === 'menunggu' && c.is_past;
            return (
              <View key={c.session_id ?? `${c.cutoff}-${i}`} style={[sx.card, c.status === 'dibuat' && { borderColor: adminTone.blue + '66' }, c.status === 'selesai' && { borderColor: adminTone.green + '66' }]}>
                <Row between style={{ gap: 8 }}>
                  <Row gap={8}>
                    <View style={[sx.clock, { backgroundColor: (c.status === 'selesai' ? adminTone.green : c.status === 'dibuat' ? adminTone.blue : adminTone.slate) + '14' }]}><Ionicons name={manual ? 'flash-outline' : 'time-outline'} size={adminIcon.md} color={c.status === 'selesai' ? adminTone.green : c.status === 'dibuat' ? adminTone.blue : adminTone.slate} /></View>
                    <View style={{ flexShrink: 1, minWidth: 0 }}><Text style={font.h3} numberOfLines={1}>{manual ? `Manual${c.note ? ` · ${c.note}` : ''}` : `Sesi ${c.cutoff} WIB`}</Text><Text style={font.tiny} numberOfLines={1}>{b ? `batch ${b.id.slice(0, 8)}${c.failed_items ? ` · ${c.failed_items} gagal` : ''}` : c.status === 'menunggu' ? `${Number(c.pending_now_items || 0)} disetujui (${rupiah(Number(c.pending_now_total || 0))}) menunggu cutoff` : c.note || '—'}</Text></View>
                  </Row>
                  <Pill text={late ? 'Lewat cutoff · belum dibuat' : m.label} tone={late ? 'bad' : m.tone} icon={m.icon} />
                </Row>
                <Row gap={adminSpace.lg} style={{ marginTop: adminSpace.md, flexWrap: 'wrap' }}>
                  <View><Text style={font.label}>Baris</Text><Text style={font.num}>{Number(c.items || 0).toLocaleString('id-ID')}</Text></View>
                  <View><Text style={font.label}>Total</Text><Text style={[font.num, { fontSize: 18, lineHeight: 24 }]}>{rupiah(Number(c.total || 0))}</Text></View>
                  <View><Text style={font.label}>Dana sampai</Text><Text style={font.mono}>{Number(c.settled_items || 0)} / {Number(c.items || 0)}</Text></View>
                </Row>
                {b && c.status !== 'kosong' ? (
                  <Row gap={6} style={{ marginTop: adminSpace.md, flexWrap: 'wrap' }}>
                    <Button size="sm" variant="secondary" title="Unduh CSV BCA" icon="download-outline" loading={busy === `bca:${b.id}`} disabled={busy !== null} onPress={() => exportBca(c)} />
                    <Button size="sm" variant="outline" title="Unduh CSV umum" icon="document-outline" loading={busy === `x:${b.id}`} disabled={busy !== null} onPress={() => onExportGeneral(b)} />
                    {c.status !== 'selesai' && can('finance') ? <Button size="sm" title="Tandai selesai" icon="checkmark-done-outline" color={colors.success} loading={busy === `o:${b.id}`} disabled={busy !== null} onPress={() => onSettle(b)} /> : null}
                  </Row>
                ) : <Text style={[font.tiny, { marginTop: adminSpace.md }]}>{c.status === 'menunggu' ? (late ? 'Cutoff sudah lewat tetapi sesi belum dibuat — cron payout_batch_auto belum jalan atau batch otomatis nonaktif; pakai "Buat batch sekarang".' : isToday ? 'Batch dibuat otomatis saat cutoff (cron tiap 5 menit); pakai "Buat batch sekarang" bila perlu lebih cepat.' : 'Tidak ada batch pada sesi ini.') : `Tidak ada permintaan disetujui pada sesi ini${c.note ? ` (${c.note})` : ''}.`}</Text>}
              </View>
            );
          })}
        </Row>
        <Row gap={10} style={{ flexWrap: 'wrap' }}>
          <Text style={font.tiny}>{loading ? 'Memuat sesi…' : `${itemsDay} baris · ${rupiah(totalDay)} pada ${dayLabel(date)}`}</Text>
          <Text style={font.tiny}>· Jadwal cutoff (setelan payout_batch_cutoffs): {cutoffText} WIB{cutoffMismatch ? ' — berbeda dari 3 sesi baku 09:00 · 13:00 · 17:00; selaraskan di Pengaturan' : ''}. Sesi 09:00 & 13:00 hanya mengambil pencairan ≥ payout_min_amount; sisanya ikut sesi terakhir. CSV BCA = format KlikBCA Bisnis [ASUMSI — verifikasi dengan template resmi sebelum unggah pertama].</Text>
        </Row>
      </View>
    </Panel>
  );
}

const sx = StyleSheet.create({
  navBtn: { width: 30, height: 30, borderRadius: adminRadius.sm, borderWidth: 1, borderColor: adminTone.border, backgroundColor: adminTone.surface, alignItems: 'center', justifyContent: 'center' },
  day: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, height: 30, borderRadius: adminRadius.sm, borderWidth: 1, borderColor: adminTone.border, backgroundColor: adminTone.surface },
  card: { flexGrow: 1, flexBasis: 300, minWidth: 280, padding: adminSpace.lg, borderWidth: 1, borderColor: adminTone.border, borderRadius: adminRadius.card, backgroundColor: adminTone.surfaceAlt },
  clock: { width: 32, height: 32, borderRadius: adminRadius.md, alignItems: 'center', justifyContent: 'center' },
  manualBox: { gap: 8, padding: adminSpace.md, borderWidth: 1, borderColor: adminTone.teal + '55', backgroundColor: adminTone.teal + '0D', borderRadius: adminRadius.md },
});
