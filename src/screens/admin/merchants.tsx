// Admin · Merchant — daftar + tinjauan pengajuan (dokumen, halal, setujui/tolak + catatan)
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Linking, StyleSheet, Pressable } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { FadeInDown, FadeOut, LinearTransition } from 'react-native-reanimated';
import { AdminPage, DataTable, Toolbar, StatusPill, ContactActions, DeleteButton, DeletePartnerDialog, RowActions, Truncate, StatCard, Grid, adminFont as font, adminTone, adminSpace, adminRadius, adminIcon, adminTable } from '@/components/admin';
import { Row, Badge, Button, toast, Input, Chip } from '@/components/ui';
import { HalalBadge } from '@/components/MerchantStatus';
import { rpc, supabase } from '@/lib/supabase';
import { signedUrl } from '@/lib/upload';
import { colors, motion } from '@/lib/theme';
import { formatDate } from '@/lib/format';
import type { ApprovalStatus, Merchant, MerchantDocuments, Profile } from '@/lib/types';

type Row_ = Merchant & { owner: Profile | null; menu_count: number; docs: MerchantDocuments | null };
const statusColor: Record<ApprovalStatus, string> = { pending: colors.warning, approved: colors.success, suspended: colors.danger, rejected: colors.textMuted };
const statusLabel: Record<ApprovalStatus, string> = { pending: 'Menunggu', approved: 'Aktif', suspended: 'Ditangguhkan', rejected: 'Ditolak' };

export default function AdminMerchants() {
  const [rows, setRows] = useState<Row_[]>([]);
  const [filter, setFilter] = useState('pending');
  const [q, setQ] = useState('');
  const [review, setReview] = useState<Row_ | null>(null);
  const [del, setDel] = useState<{ kind: 'merchant'; id: string; name: string; meta?: string[] } | null>(null);
  const load = useCallback(async () => {
    const [{ data }, { data: docs }] = await Promise.all([
      supabase.from('merchants').select('*, menu_items(count)').order('created_at', { ascending: false }).limit(300),
      supabase.from('merchant_documents').select('*'),
    ]);
    const ms = ((data as (Merchant & { menu_items: { count: number }[] })[]) ?? []);
    const ownerIds = ms.map((m) => m.owner_id).filter(Boolean) as string[];
    const { data: profiles } = ownerIds.length ? await supabase.from('profiles').select('*').in('id', ownerIds) : { data: [] };
    const pm = new Map(((profiles as Profile[]) ?? []).map((p) => [p.id, p]));
    const dm = new Map(((docs as MerchantDocuments[]) ?? []).map((d) => [d.merchant_id, d]));
    const list = ms.map((m) => ({ ...m, owner: m.owner_id ? pm.get(m.owner_id) ?? null : null, menu_count: m.menu_items?.[0]?.count ?? 0, docs: dm.get(m.id) ?? null }));
    setRows(list);
    setReview((r) => (r ? list.find((x) => x.id === r.id) ?? null : null));
  }, []);
  useEffect(() => { load(); }, [load]);
  const shown = rows.filter((r) => (filter === 'all' || r.status === filter) && (!q || r.name.toLowerCase().includes(q.toLowerCase())));
  const pending = rows.filter((r) => r.status === 'pending').length;

  return (
    <AdminPage title="Merchant AntarFood" subtitle={`${rows.length} terdaftar · ${pending} pengajuan menunggu · ${rows.filter((r) => r.halal_verified).length} halal terverifikasi`} onRefresh={load}>
      {review && <ReviewPanel m={review} onClose={() => setReview(null)} onDone={load} onDelete={() => setDel({ kind: 'merchant', id: review.id, name: review.name, meta: [review.category, `${review.menu_count} menu`] })} />}
      <DeletePartnerDialog target={del} onClose={() => setDel(null)} onDeleted={load} />
      <Grid gap={adminSpace.lg}>
        <StatCard index={0} icon="hourglass-outline" label="Pengajuan menunggu" value={pending} color={adminTone.amber} />
        <StatCard index={1} icon="checkmark-circle-outline" label="Aktif" value={rows.filter((r) => r.status === 'approved').length} color={adminTone.green} />
        <StatCard index={2} icon="ribbon-outline" label="Halal terverifikasi" value={rows.filter((r) => r.halal_verified).length} color={adminTone.teal} />
        <StatCard index={3} icon="restaurant-outline" label="Total merchant" value={rows.length} color={adminTone.orange} />
      </Grid>
      <Toolbar q={q} onQ={setQ} placeholder="Cari nama merchant"
        filters={[{ key: 'pending', label: `Pengajuan (${pending})` }, { key: 'approved', label: 'Aktif' }, { key: 'rejected', label: 'Ditolak' }, { key: 'suspended', label: 'Ditangguhkan' }, { key: 'all', label: `Semua (${rows.length})` }]}
        filter={filter} onFilter={setFilter} />
      <DataTable rows={shown as unknown as Record<string, unknown>[]} emptyText="Tidak ada merchant pada filter ini" emptyIcon="restaurant-outline" columns={[
        { key: 'name', label: 'Merchant', width: 220, flex: 2, render: (r) => { const m = r as unknown as Row_; return <View style={{ minWidth: 0 }}><Truncate style={font.bodyStrong} title={m.name}>{m.name}</Truncate><Truncate style={font.tiny} title={`${m.category} · ${m.address}`}>{m.category} · {m.address}</Truncate></View>; } },
        { key: 'owner', label: 'Pemilik', width: 170, render: (r) => { const m = r as unknown as Row_; return <View style={{ minWidth: 0 }}><Truncate style={font.body} title={m.owner?.full_name ?? ''}>{m.owner?.full_name ?? '— (seed)'}</Truncate><Truncate style={font.tiny} title={m.owner?.email ?? ''}>{m.owner?.email ?? ''}</Truncate></View>; } },
        { key: 'docs', label: 'Dokumen', width: 150, render: (r) => { const m = r as unknown as Row_; const d = m.docs; const n = [d?.npwp_no, d?.owner_id_card_url, d?.place_photo_url].filter(Boolean).length; return <Row gap={6}><DocDots docs={d} /><Text style={font.tiny}>{n}/3 wajib</Text></Row>; } },
        { key: 'halal', label: 'Halal', width: 100, render: (r) => <HalalBadge merchant={r as unknown as Row_} /> },
        { key: 'menu', label: 'Menu', width: 70, mono: true, render: (r) => <Text style={font.mono}>{String((r as unknown as Row_).menu_count)}</Text> },
        { key: 'rating', label: 'Rating', width: 100, align: 'right', render: (r) => { const m = r as unknown as Row_; return <Text style={font.mono}>{Number(m.rating_avg).toFixed(1)} ({m.rating_count})</Text>; } },
        { key: 'status', label: 'Status', width: 130, render: (r) => <StatusPill status={String(r.status)} label={statusLabel[r.status as ApprovalStatus]} /> },
        { key: 'created_at', label: 'Diajukan', width: 120, render: (r) => { const m = r as unknown as Row_; return <Text style={font.tiny}>{formatDate(m.docs?.submitted_at ?? m.created_at, false)}</Text>; } },
        {
          // Aksi utama layar ini = Tinjau; kontak & hapus dipindah ke kebab.
          key: 'actions', label: 'Aksi', width: adminTable.actionsWideW, align: 'right', render: (r) => { const m = r as unknown as Row_; return (
            <RowActions
              contact={m.owner ? { userId: m.owner.id, name: m.owner.full_name, role: 'merchant', subject: `Panel admin · merchant ${m.name}` } : undefined}
              primary={[{ key: 'review', label: 'Tinjau', icon: 'document-text-outline', variant: 'solid' as const, color: m.status === 'pending' ? colors.warning : colors.primary, onPress: () => setReview(m) }]}
              menu={[
                { key: 'del', label: 'Hapus merchant…', icon: 'trash-outline', danger: true, hint: 'butuh PIN & alasan', onPress: () => setDel({ kind: 'merchant', id: m.id, name: m.name, meta: [m.category, `${m.menu_count} menu`] }) },
              ]}
            />
          ); } },
      ]} />
    </AdminPage>
  );
}

function DocDots({ docs }: { docs: MerchantDocuments | null }) {
  const items = [docs?.npwp_no, docs?.owner_id_card_url, docs?.place_photo_url, docs?.license_no || docs?.license_url, docs?.halal_cert_url || docs?.halal_cert_no];
  return <Row gap={3}>{items.map((v, i) => <View key={i} style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: v ? colors.success : i < 3 ? colors.danger + '66' : colors.border }} />)}</Row>;
}

function ReviewPanel({ m, onClose, onDone, onDelete }: { m: Row_; onClose: () => void; onDone: () => void; onDelete?: () => void }) {
  const d = m.docs;
  const [note, setNote] = useState(d?.review_note ?? '');
  const [halalOk, setHalalOk] = useState(m.halal_verified);
  const [busy, setBusy] = useState(false);
  const openDoc = async (path: string | null | undefined) => { if (!path) return toast.error('Belum diunggah'); const u = path.startsWith('http') ? path : await signedUrl('documents', path); if (u) Linking.openURL(u); };
  const act = async (status: ApprovalStatus) => {
    if ((status === 'rejected' || status === 'suspended') && note.trim().length < 5) return toast.error('Tulis alasan (min. 5 huruf) — tersimpan di log & terlihat merchant');
    setBusy(true);
    try { await rpc('admin_review_merchant', { p_merchant: m.id, p_status: status, p_note: note || null, p_halal_verified: m.is_halal ? halalOk : false }); toast.success(`Merchant ${statusLabel[status].toLowerCase()}`); await onDone(); if (status !== 'approved') onClose(); }
    catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };
  const Doc = ({ label, value, no, required }: { label: string; value?: string | null; no?: string | null; required?: boolean }) => (
    <Pressable onPress={() => openDoc(value)} style={[s.doc, !value && !no && { opacity: 0.6 }]}>
      <Ionicons name={value ? 'document-attach' : no ? 'text-outline' : 'remove-circle-outline'} size={adminIcon.lg} color={value ? colors.success : no ? colors.info : required ? colors.danger : adminTone.faint} />
      <View style={{ flex: 1 }}><Text style={font.h3}>{label}{required ? ' *' : ''}</Text><Text style={font.tiny}>{no ?? (value ? 'Ketuk untuk lihat' : 'Tidak diunggah')}</Text></View>
      {value && <Ionicons name="open-outline" size={adminIcon.md} color={adminTone.faint} />}
    </Pressable>
  );
  return (
    <Animated.View entering={FadeInDown.duration(motion.base)} exiting={FadeOut.duration(motion.fast)} layout={LinearTransition.springify().stiffness(280).damping(20)} style={s.panel}>
      <Row between>
        <View style={{ flex: 1 }}>
          <Row gap={8}><Text style={font.h2}>{m.name}</Text><Badge text={statusLabel[m.status]} color={statusColor[m.status]} /></Row>
          <Text style={font.small}>{m.category} · {m.address}</Text>
          <Text style={font.tiny}>Pemilik: {m.owner?.full_name ?? '—'} · {m.owner?.email ?? ''} · HP {d?.owner_phone ?? m.owner?.phone ?? '—'}</Text>
        </View>
        <Row gap={8}>
          {m.owner ? <ContactActions userId={m.owner.id} name={m.owner.full_name} role="merchant" subject={`Panel admin · merchant ${m.name}`} /> : null}
          {onDelete ? <DeleteButton onPress={onDelete} /> : null}
          <Pressable onPress={onClose} style={s.close}><Ionicons name="close" size={adminIcon.lg} color={adminTone.muted} /></Pressable>
        </Row>
      </Row>
      <View style={s.cols}>
        <View style={s.col}>
          <Text style={font.label}>Dokumen legalitas</Text>
          <Doc label="NPWP / NPWPD" no={d?.npwp_no} value={d?.npwp_url} required />
          <Doc label="KTP pemilik" value={d?.owner_id_card_url} required />
          <Doc label="Foto tempat usaha" value={d?.place_photo_url} required />
          <Doc label="Izin usaha / NIB" no={d?.license_no} value={d?.license_url} />
          <Doc label="Foto sampul toko" value={m.image_url} />
          <Text style={font.tiny}>Rekening: {d?.bank_name ?? '—'} {d?.bank_account ?? ''} {d?.bank_holder ? `a.n. ${d.bank_holder}` : ''}</Text>
        </View>
        <View style={s.col}>
          <Text style={font.label}>Halal</Text>
          <Row gap={8}><Text style={font.small}>Klaim merchant:</Text><HalalBadge merchant={{ is_halal: m.is_halal, halal_verified: false }} /></Row>
          {m.is_halal ? (
            <>
              <Doc label="Sertifikat halal (BPJPH/MUI)" no={d?.halal_cert_no} value={d?.halal_cert_url} />
              <Row gap={8}>
                <Chip label="✓ Verifikasi halal" active={halalOk} onPress={() => setHalalOk(true)} color={colors.success} />
                <Chip label="Belum diverifikasi" active={!halalOk} onPress={() => setHalalOk(false)} color={colors.textSecondary} />
              </Row>
              <Text style={font.tiny}>Verifikasi hanya bila nomor sertifikat cocok dengan data BPJPH (halal.go.id). Tanpa verifikasi, pelanggan melihat label “Halal” (klaim) tanpa centang.</Text>
            </>
          ) : <Text style={font.tiny}>Merchant menyatakan non-halal. Pelanggan melihat label “Non-halal”.</Text>}
          <Text style={[font.label, { marginTop: 8 }]}>Catatan untuk merchant</Text>
          <Input placeholder="Contoh: Foto KTP buram, mohon unggah ulang" value={note} onChangeText={setNote} multiline style={{ minHeight: 70 }} />
          {!!d?.reviewed_at && <Text style={font.tiny}>Tinjauan terakhir {formatDate(d.reviewed_at)}</Text>}
          <Row gap={8} style={{ flexWrap: 'wrap', marginTop: 4 }}>
            <Button size="sm" title={m.status === 'approved' ? 'Simpan (tetap aktif)' : 'Setujui'} color={colors.success} icon="checkmark" loading={busy} onPress={() => act('approved')} />
            {m.status !== 'rejected' && <Button size="sm" title="Tolak" variant="outline" color={colors.danger} icon="close" onPress={() => act('rejected')} />}
            {m.status === 'approved' && <Button size="sm" title="Tangguhkan" variant="outline" color={colors.warning} icon="pause" onPress={() => act('suspended')} />}
          </Row>
        </View>
      </View>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  panel: { backgroundColor: adminTone.surface, borderRadius: adminRadius.lg, padding: adminSpace.lg, borderWidth: 1, borderColor: colors.warning + '66', gap: adminSpace.md, marginBottom: 4 },
  close: { width: 30, height: 30, borderRadius: adminRadius.md, backgroundColor: adminTone.surfaceAlt, borderWidth: 1, borderColor: adminTone.border, alignItems: 'center', justifyContent: 'center' },
  cols: { flexDirection: 'row', flexWrap: 'wrap', gap: adminSpace.lg },
  col: { flexGrow: 1, flexBasis: 320, gap: adminSpace.sm },
  doc: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: adminRadius.md, borderWidth: 1, borderColor: adminTone.border, backgroundColor: adminTone.surface },
});
