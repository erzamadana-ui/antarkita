// Admin · Laporan Pengguna — antrean moderasi Konten Buatan Pengguna (UGC).
//
// Halaman ini adalah bukti "moderasi yang wajar" yang diminta kebijakan
// User Generated Content Google Play: setiap laporan dari dalam aplikasi
// masuk ke sini dengan status jelas (open → reviewed/actioned/rejected),
// punya tenggat tinjauan 48 jam, dan SETIAP aksi admin tercatat di log audit
// (lihat menu Sistem → Log Aktivitas, aksi `moderation.resolve_report`).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import {
  AdminPage, Panel, StatCard, Grid, Col, Toolbar, StatusPill, Pill, ReasonPrompt, AdminDialog,
  Table, RowActions, adminFont as font, adminTone, adminSpace, adminIcon, type Column,
} from '@/components/admin';
import { Row, Button, toast } from '@/components/ui';
import { rpc } from '@/lib/supabase';
import { colors } from '@/lib/theme';
import { usePager, Pager, fmtDate, fmtAgo, Trunc, WideTableHint } from './_shared';

type Report = {
  id: string; created_at: string; status: 'open' | 'reviewed' | 'actioned' | 'rejected';
  category: string; target_kind: string; target_id: string | null; detail: string | null;
  reporter_id: string; reporter_name: string | null;
  target_user_id: string | null; target_name: string | null; target_role: string | null; target_active: boolean | null;
  due_at: string; overdue: boolean;
  reviewed_by: string | null; reviewer_name: string | null; reviewed_at: string | null; action_taken: string | null;
};

const STATUS_LABEL: Record<string, string> = { open: 'Baru', reviewed: 'Ditinjau', actioned: 'Ditindak', rejected: 'Ditolak' };
const STATUS_COLOR: Record<string, string> = { open: colors.warning, reviewed: colors.info, actioned: colors.danger, rejected: adminTone.muted };
const KATEGORI: Record<string, string> = {
  pelecehan: 'Pelecehan', penipuan: 'Penipuan', seksual: 'Konten seksual',
  kekerasan: 'Kekerasan', spam: 'Spam', lainnya: 'Lainnya',
};
const JENIS: Record<string, string> = {
  user: 'Pengguna', chat: 'Chat pesanan', call: 'Panggilan suara', review: 'Ulasan',
  merchant: 'Merchant', merchant_photo: 'Foto merchant', order: 'Pesanan', other: 'Lainnya',
};

export default function AdminReports() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const [rows, setRows] = useState<Report[]>([]);
  const [filter, setFilter] = useState('open');
  const [q, setQ] = useState('');
  const [detail, setDetail] = useState<Report | null>(null);
  const [suspend, setSuspend] = useState<Report | null>(null);
  const [reject, setReject] = useState<Report | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setRows(await rpc<Report[]>('admin_list_reports', { p_status: null })); }
    catch (e) { toast.error((e as Error).message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const stats = useMemo(() => ({
    open: rows.filter((r) => r.status === 'open').length,
    overdue: rows.filter((r) => r.overdue).length,
    actioned: rows.filter((r) => r.status === 'actioned').length,
    total30: rows.filter((r) => Date.now() - new Date(r.created_at).getTime() < 30 * 864e5).length,
  }), [rows]);

  const shown = useMemo(() => rows.filter((r) => {
    const f = filter === 'all' ? true : filter === 'overdue' ? r.overdue : r.status === filter;
    const t = q.trim().toLowerCase();
    const s = !t || [r.reporter_name, r.target_name, r.detail, KATEGORI[r.category], JENIS[r.target_kind]]
      .some((x) => (x ?? '').toLowerCase().includes(t));
    return f && s;
  }), [rows, filter, q]);
  const pg = usePager(shown, 25);

  const resolve = async (r: Report, action: 'reviewed' | 'suspend' | 'rejected', note?: string) => {
    setBusy(r.id);
    try {
      await rpc('admin_resolve_report', { p_id: r.id, p_action: action, p_note: note ?? null });
      toast.success(action === 'suspend' ? 'Pengguna ditangguhkan & laporan ditutup' : 'Laporan diperbarui');
      setDetail(null); setSuspend(null); setReject(null);
      await load();
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(null); }
  };

  const columns: Column[] = [
    { key: 'created_at', label: 'Masuk', width: 132, render: (r) => (
      <View>
        <Text style={font.body} numberOfLines={1}>{fmtAgo((r as Report).created_at)}</Text>
        <Text style={font.tiny} numberOfLines={1}>{fmtDate((r as Report).created_at)}</Text>
      </View>
    ) },
    { key: 'status', label: 'Status', width: 120, render: (r) => {
      const x = r as Report;
      return <Row gap={4}>
        <Pill text={STATUS_LABEL[x.status] ?? x.status} color={STATUS_COLOR[x.status]} />
        {x.overdue ? <Pill text="Lewat tenggat" color={colors.danger} icon="alarm-outline" /> : null}
      </Row>;
    } },
    { key: 'category', label: 'Kategori', width: 140, render: (r) => <Trunc style={font.body} title={KATEGORI[(r as Report).category]}>{KATEGORI[(r as Report).category] ?? (r as Report).category}</Trunc> },
    { key: 'target_kind', label: 'Jenis konten', width: 130, render: (r) => <Trunc style={font.body}>{JENIS[(r as Report).target_kind] ?? (r as Report).target_kind}</Trunc> },
    { key: 'target_name', label: 'Dilaporkan', flex: 1, width: 170, render: (r) => {
      const x = r as Report;
      return (
        <View style={{ minWidth: 0 }}>
          <Trunc style={font.body} title={x.target_name ?? undefined}>{x.target_name ?? '— (konten tanpa pemilik)'}</Trunc>
          {x.target_user_id ? <Text style={font.tiny} numberOfLines={1}>{x.target_active === false ? 'Akun ditangguhkan' : 'Akun aktif'}</Text> : null}
        </View>
      );
    } },
    { key: 'reporter_name', label: 'Pelapor', flex: 1, width: 150, render: (r) => <Trunc style={font.body} title={(r as Report).reporter_name ?? undefined}>{(r as Report).reporter_name ?? 'Pengguna'}</Trunc> },
    { key: 'detail', label: 'Keterangan', flex: 1.4, width: 200, render: (r) => <Trunc style={font.body} lines={2} title={(r as Report).detail ?? undefined}>{(r as Report).detail ?? '—'}</Trunc> },
    { key: 'aksi', label: 'Aksi', width: 200, align: 'right', render: (r) => {
      const x = r as Report;
      const done = x.status !== 'open';
      return (
        <RowActions
          disabled={busy === x.id}
          primary={[{ key: 'detail', icon: 'reader-outline', label: 'Detail', onPress: () => setDetail(x) }]}
          menu={[
            { key: 'reviewed', icon: 'checkmark-done-outline', label: 'Tandai ditinjau', onPress: () => resolve(x, 'reviewed', 'Ditinjau tanpa temuan pelanggaran'), disabled: done },
            { key: 'suspend', icon: 'ban-outline', label: 'Tangguhkan pengguna', danger: true, onPress: () => setSuspend(x), disabled: done || !x.target_user_id },
            { key: 'reject', icon: 'close-circle-outline', label: 'Tolak laporan', onPress: () => setReject(x), disabled: done },
            { key: 'profil', icon: 'person-outline', label: 'Buka profil pengguna', onPress: () => router.push('/(admin)/users' as never), disabled: !x.target_user_id },
          ]}
        />
      );
    } },
  ];

  return (
    <AdminPage
      title="Laporan Pengguna"
      subtitle="Moderasi konten buatan pengguna (UGC) — chat, panggilan, ulasan, foto merchant"
      onRefresh={load}
      right={<Row gap={6}><Ionicons name="shield-checkmark-outline" size={adminIcon.md} color={adminTone.teal} /><Text style={font.tiny}>Tenggat tinjauan 48 jam</Text></Row>}
    >
      <Grid>
        <Col span={3}><StatCard index={0} icon="flag-outline" label="Laporan baru" value={stats.open} hint="Belum ditinjau" color={colors.warning} /></Col>
        <Col span={3}><StatCard index={1} icon="alarm-outline" label="Lewat tenggat" value={stats.overdue} hint="Lebih dari 48 jam" color={colors.danger} /></Col>
        <Col span={3}><StatCard index={2} icon="ban-outline" label="Ditindak" value={stats.actioned} hint="Pengguna ditangguhkan" color={colors.danger} /></Col>
        <Col span={3}><StatCard index={3} icon="time-outline" label="30 hari terakhir" value={stats.total30} hint="Total laporan masuk" /></Col>
      </Grid>

      <Panel
        title="Antrean laporan"
        subtitle="Setiap tindakan tercatat di Log Aktivitas (moderation.resolve_report) sebagai bukti penanganan"
        icon="flag-outline"
        padded={false}
      >
        <View style={{ padding: adminSpace.lg, gap: adminSpace.md }}>
          <Toolbar
            q={q} onQ={setQ} placeholder="Cari nama pelapor, terlapor, atau keterangan…"
            filter={filter} onFilter={setFilter}
            filters={[
              { key: 'open', label: `Baru (${stats.open})` },
              { key: 'overdue', label: `Lewat tenggat (${stats.overdue})` },
              { key: 'reviewed', label: 'Ditinjau' },
              { key: 'actioned', label: 'Ditindak' },
              { key: 'rejected', label: 'Ditolak' },
              { key: 'all', label: 'Semua' },
            ]}
          />
          <WideTableHint />
          <Table columns={columns} rows={pg.rows as unknown as Record<string, unknown>[]} emptyIcon="shield-checkmark-outline"
            emptyText={filter === 'open' ? 'Tidak ada laporan yang menunggu tinjauan' : 'Tidak ada laporan pada filter ini'} />
          <Pager p={pg} noun="laporan" />
        </View>
      </Panel>

      {/* Detail laporan */}
      <AdminDialog visible={!!detail} onClose={() => setDetail(null)} title="Detail laporan" subtitle={detail ? `${KATEGORI[detail.category] ?? detail.category} · ${JENIS[detail.target_kind] ?? detail.target_kind}` : undefined} width={620}>
        {detail ? (
          <View style={{ gap: adminSpace.md }}>
            <Row gap={8} style={{ flexWrap: 'wrap' }}>
              <StatusPill status={detail.status} label={STATUS_LABEL[detail.status]} />
              {detail.overdue ? <Pill text="Lewat tenggat tinjauan" color={colors.danger} icon="alarm-outline" /> : null}
              <Pill text={`Tenggat ${fmtDate(detail.due_at)}`} />
            </Row>
            {[
              ['Pelapor', detail.reporter_name ?? 'Pengguna'],
              ['Dilaporkan', detail.target_name ?? '— (konten tanpa pemilik akun)'],
              ['Status akun terlapor', detail.target_user_id ? (detail.target_active === false ? 'Ditangguhkan' : 'Aktif') : '—'],
              ['Jenis konten', JENIS[detail.target_kind] ?? detail.target_kind],
              ['Id konten', detail.target_id ?? '—'],
              ['Masuk', fmtDate(detail.created_at)],
              ['Ditinjau oleh', detail.reviewer_name ? `${detail.reviewer_name} · ${fmtDate(detail.reviewed_at)}` : '—'],
              ['Tindakan', detail.action_taken ?? '—'],
            ].map(([k, v]) => (
              <Row key={k} gap={10} style={{ alignItems: 'flex-start' }}>
                <Text style={[font.tiny, { width: 150 }]}>{k}</Text>
                <Trunc style={font.body} lines={3} title={String(v)}>{String(v)}</Trunc>
              </Row>
            ))}
            <View style={{ backgroundColor: adminTone.surfaceAlt, borderRadius: 10, padding: adminSpace.md }}>
              <Text style={font.tiny}>Keterangan pelapor</Text>
              <Text style={font.body}>{detail.detail || '— tidak diisi —'}</Text>
            </View>
            {detail.status === 'open' ? (
              <Row gap={8} style={{ justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                <Button size="sm" title="Tandai ditinjau" variant="secondary" loading={busy === detail.id} onPress={() => resolve(detail, 'reviewed', 'Ditinjau tanpa temuan pelanggaran')} />
                <Button size="sm" title="Tolak laporan" variant="outline" color={adminTone.muted} onPress={() => setReject(detail)} />
                <Button size="sm" title="Tangguhkan pengguna" color={colors.danger} disabled={!detail.target_user_id} onPress={() => setSuspend(detail)} />
              </Row>
            ) : (
              <Text style={font.tiny}>Laporan ini sudah diselesaikan. Riwayat lengkapnya ada di Log Aktivitas.</Text>
            )}
          </View>
        ) : null}
      </AdminDialog>

      {/* Tangguhkan pengguna yang dilaporkan — alasan wajib (masuk log audit & profil) */}
      <ReasonPrompt
        visible={!!suspend}
        title={`Tangguhkan ${suspend?.target_name ?? 'pengguna'}?`}
        subtitle="Akun langsung dinonaktifkan. Alasan tersimpan di log audit sebagai bukti penanganan laporan."
        confirmLabel="Tangguhkan akun"
        quick={[
          'Pelecehan terhadap pengguna lain',
          'Penipuan / meminta transfer di luar aplikasi',
          'Mengirim konten seksual',
          'Ancaman kekerasan',
          'Spam berulang',
        ]}
        onCancel={() => setSuspend(null)}
        onSubmit={async (reason) => { if (suspend) await resolve(suspend, 'suspend', reason); }}
      />

      {/* Tolak laporan */}
      <ReasonPrompt
        visible={!!reject}
        title="Tolak laporan ini?"
        subtitle="Dipakai bila laporan tidak terbukti, salah sasaran, atau di luar aturan komunitas."
        confirmLabel="Tolak laporan"
        color={adminTone.muted}
        optional
        quick={['Tidak terbukti setelah pemeriksaan chat', 'Salah sasaran', 'Duplikat laporan lain', 'Bukan pelanggaran aturan komunitas']}
        onCancel={() => setReject(null)}
        onSubmit={async (reason) => { if (reject) await resolve(reject, 'rejected', reason || 'Tidak terbukti'); }}
      />
    </AdminPage>
  );
}
