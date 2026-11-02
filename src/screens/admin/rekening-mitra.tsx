// Admin · Rekening Pencairan Mitra (migrasi 0123, keputusan GM 3 & 4).
// Tabel rpc('admin_partner_payout_accounts', { p_q }) → rekening/e-wallet tiap mitra (bank_accounts diperluas: channel, bank_code,
// auto_sweep) + saldo & penarikan terbuka. Verifikasi/Tolak → rpc('admin_partner_payout_verify', { p_id, p_ok, p_note }) (izin payout + PIN).
// Panel bawah: antrean provider pembayaran rpc('admin_payout_provider_jobs', { p_status }) — wiring 'api' (Edge pay-disburse), belum diaktifkan.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { AdminPage, Panel, DataTable, StatCard, Pill, RequirePerm, Toolbar, ReasonPrompt, FilterBar, adminFont as font, adminTone, adminSpace } from '@/components/admin';
import { FootNote } from '@/components/reports';
import { Row, Button, toast } from '@/components/ui';
import { rupiah } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { handleAdminError, useAdminSecurity } from '@/store/adminSecurity';
import { ErrorNote, fmtDate, fmtAgo, Trunc, WideTableHint, usePager, Pager } from './_shared';
import {
  adminPartnerPayoutAccounts, adminPartnerPayoutVerify, adminPayoutProviderJobs,
  PAYOUT_CHANNEL_LABEL, PARTNER_TYPE_LABEL, PROVIDER_JOB_STATUS, isEwallet, maskAccountNo,
  type PartnerPayoutAccount, type PayoutProviderJob,
} from '@/lib/admin31';

const n0 = (v: unknown) => Number(v ?? 0) || 0;
type VerifFilter = 'all' | 'unverified' | 'verified' | 'ewallet' | 'nosweep';
const VERIF_FILTERS: { key: VerifFilter; label: string }[] = [
  { key: 'all', label: 'Semua' }, { key: 'unverified', label: 'Belum diverifikasi' }, { key: 'verified', label: 'Terverifikasi' }, { key: 'ewallet', label: 'E-wallet' }, { key: 'nosweep', label: 'Auto-sweep mati' },
];

export default function AdminRekeningMitra() {
  const router = useRouter();
  const [rows, setRows] = useState<PartnerPayoutAccount[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [sentQ, setSentQ] = useState('');
  const [filter, setFilter] = useState<VerifFilter>('all');
  const [ask, setAsk] = useState<{ row: PartnerPayoutAccount; ok: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [provider, setProvider] = useState<string>('manual');
  const [sweepOn, setSweepOn] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await adminPartnerPayoutAccounts(sentQ.trim() || null)); setErr(null); }
    catch (e) { setRows([]); setErr(`Rekening mitra: ${(e as Error).message}`); }
    finally { setLoading(false); }
  }, [sentQ]);
  useEffect(() => { load(); }, [load]);
  // Pencarian dikirim ke server setelah jeda ketik (ilike nama / nomor / pemilik / bank).
  useEffect(() => { const t = setTimeout(() => setSentQ(q), 350); return () => clearTimeout(t); }, [q]);
  useEffect(() => {
    supabase.from('app_settings').select('key,value').in('key', ['payout_provider', 'payout_auto_sweep_enabled']).then(({ data }) => {
      for (const r of (data as { key: string; value: unknown }[]) ?? []) {
        const v = String(r.value ?? '').replace(/"/g, '');
        if (r.key === 'payout_provider') setProvider(v || 'manual');
        if (r.key === 'payout_auto_sweep_enabled') setSweepOn(v !== 'false');
      }
    });
  }, []);

  const filtered = useMemo(() => rows.filter((r) => filter === 'all' || (filter === 'unverified' && !r.verified) || (filter === 'verified' && r.verified) || (filter === 'ewallet' && isEwallet(r.channel)) || (filter === 'nosweep' && !r.auto_sweep)), [rows, filter]);
  const pg = usePager(filtered, 25);
  const nUnverified = rows.filter((r) => !r.verified).length;
  const nEwallet = rows.filter((r) => isEwallet(r.channel)).length;
  const nSweep = rows.filter((r) => r.auto_sweep).length;
  const balUnverified = rows.filter((r) => !r.verified).reduce((a, r) => a + n0(r.balance), 0);

  const submitVerify = async (note: string) => {
    if (!ask) return;
    if (!(await useAdminSecurity.getState().ensureUnlocked())) return;
    setBusy(ask.row.id);
    try {
      await adminPartnerPayoutVerify(ask.row.id, ask.ok, note || null);
      toast.success(`${ask.row.full_name || 'Mitra'} · ${PAYOUT_CHANNEL_LABEL[ask.row.channel] ?? ask.row.channel} ${maskAccountNo(ask.row.account_no)} ${ask.ok ? 'diverifikasi — auto-sweep berikutnya otomatis disetujui' : 'ditolak — mitra diminta memperbaiki data'}`);
      setAsk(null); await load();
    } catch (e) { handleAdminError(e); } finally { setBusy(null); }
  };

  return (
    <AdminPage title="Rekening Pencairan Mitra" subtitle="Rekening bank / e-wallet wajib sebelum driver online, mitra travel mendaftar, dan merchant buka (0123). Rekening terverifikasi → auto-sweep saldo (3 sesi/hari) disetujui otomatis; belum terverifikasi → masuk antrean pending Keuangan. Verifikasi butuh izin payout + PIN." onRefresh={load}
      right={<Row gap={8} style={{ flexWrap: 'wrap' }}>
        <Button size="sm" variant="outline" title="Top up & Payout" icon="cash-outline" onPress={() => router.push('/(admin)/finance' as never)} />
        <Button size="sm" variant="outline" title="Segarkan" icon="refresh-outline" onPress={load} />
      </Row>}>
      <Row gap={adminSpace.md} style={{ flexWrap: 'wrap' }}>
        <StatCard index={0} icon="card-outline" label="Rekening tersimpan" value={rows.length} hint={`${rows.length - nEwallet} bank · ${nEwallet} e-wallet${sentQ ? ' · hasil pencarian' : ''}`} color={adminTone.blue} />
        <StatCard index={1} icon="alert-circle-outline" label="Belum diverifikasi" value={nUnverified} hint={nUnverified ? `saldo tertahan ${rupiah(balUnverified)} — sweep-nya masuk antrean pending` : 'semua rekening terverifikasi'} color={nUnverified ? adminTone.amber : adminTone.green} />
        <StatCard index={2} icon="sync-outline" label="Auto-sweep aktif" value={`${nSweep}/${rows.length}`} hint={sweepOn === false ? 'GLOBAL NONAKTIF (payout_auto_sweep_enabled=false)' : 'cadangan driver = payout_sweep_driver_reserve · min payout_min_amount'} color={sweepOn === false ? adminTone.red : adminTone.teal} />
        <StatCard index={3} icon="cloud-upload-outline" label="Provider pembayaran" value={provider === 'api' ? 'API (Edge)' : 'Manual (CSV)'} hint={provider === 'api' ? 'payout_provider_dispatch → pay-disburse tiap 5 menit' : 'setelan payout_provider=manual — batch via CSV BCA'} color={provider === 'api' ? adminTone.violet : adminTone.slate} />
      </Row>

      <Panel title={`Rekening mitra (${filtered.length})`} subtitle="Urutan: belum terverifikasi dulu, lalu terbaru diperbarui. Nomor rekening/HP dimasker — nomor penuh ada di CSV batch & detail penarikan. Verifikasi = admin sudah mencocokkan nama pemilik dengan KTP/akun mitra." icon="card-outline" padded={false}>
        <View style={{ padding: adminSpace.md, paddingBottom: 0, gap: 8 }}>
          <Toolbar q={q} onQ={setQ} placeholder="Cari nama mitra / nomor / pemilik / bank…">
            <FilterBar options={VERIF_FILTERS} value={filter} onChange={(v) => setFilter(v as VerifFilter)} />
          </Toolbar>
          <ErrorNote text={err} onRetry={load} />
        </View>
        <DataTable keyField="id" rows={pg.rows as unknown as Record<string, unknown>[]} emptyText={loading ? 'Memuat…' : err ? 'Tidak bisa membaca rekening — periksa koneksi/izin (payments_view)' : sentQ ? `Tidak ada rekening cocok “${sentQ}”` : 'Belum ada rekening mitra tersimpan'} emptyIcon="card-outline"
          columns={[
            { key: 'full_name', label: 'Mitra', width: 200, render: (r) => { const x = r as unknown as PartnerPayoutAccount; return <View style={{ minWidth: 0, alignSelf: 'stretch' }}><Trunc style={font.bodyStrong} title={x.full_name ?? ''}>{x.full_name || '(tanpa nama)'}</Trunc><Trunc style={font.tiny} title={x.user_id}>{x.phone || '—'} · {x.user_id.slice(0, 8)}</Trunc></View>; } },
            { key: 'partner_type', label: 'Peran', width: 110, render: (r) => { const x = r as unknown as PartnerPayoutAccount; return <Pill text={PARTNER_TYPE_LABEL[x.partner_type] ?? x.partner_type} tone={x.partner_type === 'lainnya' ? 'off' : 'neutral'} />; } },
            { key: 'channel', label: 'Kanal', width: 100, render: (r) => { const x = r as unknown as PartnerPayoutAccount; return <Pill text={PAYOUT_CHANNEL_LABEL[x.channel] ?? x.channel} tone={isEwallet(x.channel) ? 'info' : 'brand'} icon={isEwallet(x.channel) ? 'phone-portrait-outline' : 'business-outline'} />; } },
            { key: 'bank_name', label: 'Bank / e-wallet · nomor', width: 220, render: (r) => { const x = r as unknown as PartnerPayoutAccount; return <View style={{ minWidth: 0, alignSelf: 'stretch' }}><Trunc style={font.small} title={`${x.bank_name ?? ''} (${x.bank_code ?? '—'})`}>{x.bank_name || PAYOUT_CHANNEL_LABEL[x.channel] || '—'}{x.bank_code ? ` · ${x.bank_code}` : ''}</Trunc><Text style={font.mono}>{maskAccountNo(x.account_no)}</Text></View>; } },
            { key: 'account_name', label: 'Nama pemilik', width: 170, render: (r) => { const x = r as unknown as PartnerPayoutAccount; const mismatch = x.full_name && x.account_name && x.account_name.trim().toLowerCase() !== x.full_name.trim().toLowerCase(); return <View style={{ minWidth: 0, alignSelf: 'stretch' }}><Trunc style={font.small} title={x.account_name}>{x.account_name || '—'}</Trunc>{mismatch ? <Pill text="≠ nama profil" tone="wait" /> : null}</View>; } },
            { key: 'verified', label: 'Verifikasi', width: 160, render: (r) => { const x = r as unknown as PartnerPayoutAccount; return <View style={{ gap: 3, alignItems: 'flex-start' }}><Pill text={x.verified ? 'Terverifikasi' : 'Belum'} tone={x.verified ? 'ok' : 'wait'} icon={x.verified ? 'checkmark-circle-outline' : 'time-outline'} />{x.verified_at ? <Text style={font.tiny}>{fmtDate(x.verified_at, false)}</Text> : null}</View>; } },
            { key: 'auto_sweep', label: 'Auto-sweep', width: 110, render: (r) => { const x = r as unknown as PartnerPayoutAccount; return <Pill text={x.auto_sweep ? 'Aktif' : 'Mati'} tone={x.auto_sweep ? 'ok' : 'off'} />; } },
            { key: 'balance', label: 'Saldo · tarik terbuka', width: 150, align: 'right', mono: true, render: (r) => { const x = r as unknown as PartnerPayoutAccount; return <View style={{ alignItems: 'flex-end' }}><Text style={font.mono}>{rupiah(n0(x.balance))}</Text><Text style={font.tiny}>{n0(x.open_withdrawals) ? `${n0(x.open_withdrawals)} penarikan terbuka` : 'tidak ada antrean'}</Text></View>; } },
            { key: 'updated_at', label: 'Diperbarui', width: 130, render: (r) => <Text style={font.tiny}>{fmtDate(String(r.updated_at))} · {fmtAgo(String(r.updated_at))}</Text> },
            { key: 'actions', label: 'Aksi', width: 190, align: 'right', render: (r) => { const x = r as unknown as PartnerPayoutAccount; return (
              <RequirePerm perm={['payout', 'finance']} fallback={<Text style={font.tiny}>izin payout</Text>}>
                <Row gap={6} style={{ justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                  {!x.verified ? <Button size="sm" title="Verifikasi" icon="checkmark-outline" loading={busy === x.id} disabled={busy !== null} onPress={() => setAsk({ row: x, ok: true })} /> : null}
                  <Button size="sm" variant={x.verified ? 'danger' : 'outline'} title={x.verified ? 'Cabut' : 'Tolak'} icon="close-outline" loading={busy === x.id} disabled={busy !== null} onPress={() => setAsk({ row: x, ok: false })} />
                </Row>
              </RequirePerm>
            ); } },
          ]} />
        <View style={{ padding: adminSpace.md, gap: 6 }}><WideTableHint /><Pager p={pg} noun="rekening" /></View>
      </Panel>

      <ProviderJobsPanel />

      <ReasonPrompt visible={!!ask} title={ask ? `${ask.ok ? 'Verifikasi' : ask.row.verified ? 'Cabut verifikasi' : 'Tolak'} rekening ${ask.row.full_name || 'mitra'}?` : ''} color={ask?.ok ? adminTone.teal : adminTone.red} confirmLabel={ask?.ok ? 'Verifikasi' : 'Tolak / cabut'} optional={!!ask?.ok}
        subtitle={ask ? `${PAYOUT_CHANNEL_LABEL[ask.row.channel] ?? ask.row.channel} ${ask.row.bank_name ?? ''} ${ask.row.account_no} a.n. ${ask.row.account_name}. ${ask.ok ? 'Mitra diberi tahu; pencairan auto-sweep berikutnya disetujui otomatis (≤ auto_payout_max).' : 'Catatan dikirim ke mitra sebagai petunjuk perbaikan; pencairan otomatis berhenti sampai diverifikasi ulang.'} Butuh PIN.` : undefined}
        quick={ask?.ok ? ['Nama pemilik cocok dengan KTP', 'Sudah dicek lewat inquiry bank', 'Transfer uji berhasil'] : ['Nama pemilik tidak cocok dengan KTP', 'Nomor rekening tidak ditemukan (inquiry gagal)', 'Nomor e-wallet bukan milik mitra', 'Rekening milik orang lain']}
        onCancel={() => (busy ? undefined : setAsk(null))} onSubmit={submitVerify} />

      <FootNote lines={[
        'Sumber: admin_partner_payout_accounts(p_q), admin_partner_payout_verify(p_id, p_ok, p_note), admin_payout_provider_jobs(p_status) — migrasi 0123. Tabel dasar = bank_accounts (0019) diperluas; nama kontrak partner_payout_accounts = view.',
        'Kanal e-wallet (dana/ovo/linkaja/gopay/shopeepay) memakai kode bank virtual DANA/OVO/LINKAJA/GOPAY/SHOPEEPAY di CSV BCA [ASUMSI format kolom Kode Bank]; nomor = HP 08xx.',
        'Auto-sweep (payout_auto_sweep di tiap cutoff 09:00/13:00/17:00): saldo − cadangan ≥ payout_min_amount, tanpa penarikan belum ter-batch, tanpa fraud_flag med/high. Rekening belum terverifikasi → penarikan pending (disetujui lewat tabel Penarikan di Top up & Payout → rekening otomatis jadi terverifikasi).',
        'Mengganti nomor/bank/kanal oleh mitra mereset verifikasi ke "Belum"; ganti nama pemilik saja tidak. Setelan terkait: payout_account_required, payout_auto_sweep_enabled, payout_sweep_driver_reserve, payout_provider (Pengaturan).',
      ]} />
    </AdminPage>
  );
}

/* ───────────────────── Antrean provider pembayaran (payout_provider_jobs) ───────────────────── */

function ProviderJobsPanel() {
  const [rows, setRows] = useState<PayoutProviderJob[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string>('all');
  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await adminPayoutProviderJobs(status === 'all' ? null : status)); setErr(null); }
    catch (e) { setRows([]); setErr(`Antrean provider: ${(e as Error).message}`); }
    finally { setLoading(false); }
  }, [status]);
  useEffect(() => { load(); }, [load]);
  const nFailed = rows.filter((r) => r.status === 'failed').length;
  return (
    <Panel title={`Antrean provider pembayaran (${rows.length})`} subtitle="payout_provider_jobs: satu job per batch saat payout_provider='api' — cron payout_provider_dispatch (*/5 menit) mengirim ke Edge pay-disburse dengan x-cron-secret. Mode manual tidak membuat job (batch tetap lewat CSV)." icon="cloud-upload-outline" iconColor={adminTone.violet} padded={false}
      right={<Row gap={6}><FilterBar options={[{ key: 'all', label: 'Semua' }, ...Object.entries(PROVIDER_JOB_STATUS).map(([k, v]) => ({ key: k, label: v.label }))]} value={status} onChange={setStatus} /><Button size="sm" variant="ghost" title="Segarkan" icon="refresh-outline" onPress={load} /></Row>}>
      <View style={{ padding: adminSpace.md, paddingBottom: 0 }}><ErrorNote text={err} onRetry={load} />{nFailed ? <Text style={[font.small, { color: adminTone.red }]}>{nFailed} job gagal — periksa kolom galat; batch tetap bisa diselesaikan manual lewat CSV di Top up & Payout.</Text> : null}</View>
      <DataTable keyField="id" rows={rows as unknown as Record<string, unknown>[]} emptyText={loading ? 'Memuat…' : err ? 'Tidak bisa membaca antrean' : 'Belum ada job provider — normal selama payout_provider = manual'} emptyIcon="cloud-upload-outline"
        columns={[
          { key: 'id', label: 'Job', width: 110, render: (r) => <Text style={font.mono} selectable>{String(r.id).slice(0, 8)}</Text> },
          { key: 'batch_id', label: 'Batch', width: 160, render: (r) => { const x = r as unknown as PayoutProviderJob; return <View style={{ minWidth: 0 }}><Text style={font.mono} selectable>{x.batch_id.slice(0, 8)}</Text><Text style={font.tiny}>{x.batch_label ? `cutoff ${x.batch_label}` : ''}{x.batch_status ? ` · ${x.batch_status}` : ''}</Text></View>; } },
          { key: 'provider', label: 'Provider', width: 100, render: (r) => <Pill text={String(r.provider ?? '—')} tone={r.provider === 'api' ? 'info' : 'neutral'} /> },
          { key: 'status', label: 'Status', width: 120, render: (r) => { const m = PROVIDER_JOB_STATUS[String(r.status)] ?? { label: String(r.status), tone: 'off' as const }; return <Pill text={m.label} tone={m.tone} />; } },
          { key: 'items', label: 'Baris · total', width: 170, align: 'right', mono: true, render: (r) => { const x = r as unknown as PayoutProviderJob; const n = x.request?.items?.length ?? n0(x.batch_count); return <View style={{ alignItems: 'flex-end' }}><Text style={font.mono}>{n.toLocaleString('id-ID')} baris</Text><Text style={font.tiny}>{rupiah(n0(x.batch_total))}</Text></View>; } },
          { key: 'error', label: 'Galat / respons', width: 280, flex: 1, render: (r) => { const x = r as unknown as PayoutProviderJob; const txt = x.error || (x.response ? JSON.stringify(x.response).slice(0, 160) : '—'); return <Text style={[font.small, x.error ? { color: adminTone.red } : null]} numberOfLines={2} selectable>{txt}</Text>; } },
          { key: 'updated_at', label: 'Diperbarui', width: 150, render: (r) => <Text style={font.tiny}>{fmtDate(String(r.updated_at))} · {fmtAgo(String(r.updated_at))}</Text> },
        ]} />
      <View style={{ padding: adminSpace.md }}><WideTableHint what="kolom galat" /></View>
    </Panel>
  );
}
