// Admin · Keuangan — verifikasi top up & penarikan saldo, serta verifikasi rekening mitra.
// Tampilan mengikuti sistem desain panel admin; logika persetujuan tidak berubah.
// v3 (finpay-v3, kontrak §8): kolom payout_status / provider / fee / failed_reason; setelah disetujui, dana dicairkan
//   • manual  → rpc('admin_mark_withdrawal_settled', { p_id, p_provider_ref }) (PIN, nomor referensi bank)
//   • Finpay  → edge function `pay-disburse` { withdrawal_id } (hanya bila app_settings.disbursement_provider = 'finpay').
// admin_review_withdrawal butuh PIN (gerbang ensureUnlocked).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, Linking, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import {
  AdminPage, Panel, DataTable, Toolbar, FilterBar, StatCard, Pill, RowActions, AdminDialog, statusTone, adminFont as font, adminTone, adminSpace, adminTable,
} from '@/components/admin';
import { Row, Button, Input, toast } from '@/components/ui';
import { PAYOUT_STATUS_LABEL, payoutTone, invokeEdge, useAdminCan, type WithdrawalV3Extra } from '@/lib/admin';
import { rpc, supabase } from '@/lib/supabase';
import { signedUrl } from '@/lib/upload';
import { adminExportCsv } from '@/lib/csv';
import { handleAdminError, useAdminSecurity } from '@/store/adminSecurity';
import { colors } from '@/lib/theme';
import { rupiah } from '@/lib/format';
import type { Profile, TopupRequest, WithdrawalRequest } from '@/lib/types';
import { usePager, Pager, fmtDate, fmtAgo, Trunc, WideTableHint } from './_shared';

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
