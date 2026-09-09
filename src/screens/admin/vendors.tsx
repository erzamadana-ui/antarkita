// Admin · Mitra Pasar: pedagang pasar tradisional (lapak) — verifikasi, kualitas katalog, tangguhkan/pulihkan
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Image, Linking, Pressable, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AdminPage, FilterBar, StatCard, ReasonPrompt, RowActions, DeletePartnerDialog, adminFont as font, adminTone, adminSpace, adminRadius, adminIcon, AdminCard as Card, EmptyState as Empty } from '@/components/admin';
import { Row, Badge, IconCircle, toast } from '@/components/ui';
import { Entrance, Skeleton, ProgressBar } from '@/components/motion';
import { rpc, supabase } from '@/lib/supabase';
import { signedUrl } from '@/lib/upload';
import { colors } from '@/lib/theme';
import { marketCategoryLabel, phoneDisplay } from '@/lib/format';
import type { MarketVendor, ApprovalStatus } from '@/lib/types';
import { fmtDate, fmtAgo, WideTableHint } from './_shared';

const TABS = [{ key: 'pending', label: 'Menunggu' }, { key: 'approved', label: 'Aktif' }, { key: 'suspended', label: 'Ditangguhkan' }, { key: 'rejected', label: 'Ditolak' }, { key: 'all', label: 'Semua' }];
const STATUS_LABEL: Record<string, string> = { pending: 'Menunggu', approved: 'Aktif', rejected: 'Ditolak', suspended: 'Ditangguhkan' };
const STATUS_COLOR: Record<string, string> = { pending: colors.warning, approved: colors.success, rejected: colors.danger, suspended: colors.textMuted };
const scoreColor = (n: number, min: number) => (n >= min ? colors.success : n >= min * 0.7 ? colors.warning : colors.danger);

export default function AdminVendors() {
  const [tab, setTab] = useState('pending');
  const [rows, setRows] = useState<MarketVendor[] | null>(null);
  const [qualityMin, setQualityMin] = useState(60);
  const [ask, setAsk] = useState<{ v: MarketVendor; status: ApprovalStatus } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [del, setDel] = useState<{ kind: 'vendor'; id: string; name: string; meta?: string[] } | null>(null);

  const load = useCallback(async () => {
    try {
      const [list, { data: st }] = await Promise.all([
        rpc<MarketVendor[]>('admin_market_vendors', { p_status: tab }),
        supabase.from('app_settings').select('value').eq('key', 'vendor_quality_min').maybeSingle(),
      ]);
      setRows(list ?? []);
      if (st && (st as { value: unknown }).value != null) setQualityMin(Number((st as { value: unknown }).value) || 60);
    } catch (e) { toast.error((e as Error).message); setRows([]); }
  }, [tab]);
  useEffect(() => { setRows(null); load(); }, [load]);

  const review = async (v: MarketVendor, status: ApprovalStatus, reason?: string) => {
    if ((status === 'rejected' || status === 'suspended') && !reason) { setAsk({ v, status }); return; }
    setBusyId(v.id);
    try {
      await rpc('admin_review_market_vendor', { p_id: v.id, p_status: status, p_reason: reason ?? null });
      toast.success(`Lapak "${v.stall_name}" → ${STATUS_LABEL[status]}`); setAsk(null); load();
    } catch (e) { toast.error((e as Error).message); } finally { setBusyId(null); }
  };
  const openDoc = async (path: string | null) => { if (!path) return toast.error('Dokumen belum diunggah'); const u = await signedUrl('documents', path); if (u) Linking.openURL(u); else toast.error('Dokumen tidak bisa dibuka'); };

  const n = (s: string) => rows?.filter((r) => r.status === s).length ?? 0;
  return (
    <AdminPage title="Mitra Pasar" subtitle="Pedagang pasar tradisional yang menjual lewat AntarMarket" onRefresh={load}>
      <ReasonPrompt visible={!!ask} title={`${ask?.status === 'rejected' ? 'Tolak' : 'Tangguhkan'} lapak "${ask?.v.stall_name}"?`} subtitle="Alasan wajib (min. 5 huruf) — dikirim ke pedagang sebagai notifikasi & tersimpan di log." confirmLabel={ask?.status === 'rejected' ? 'Tolak' : 'Tangguhkan'}
        quick={['Foto lapak / KTP tidak jelas', 'Data rekening tidak sesuai KTP', 'Harga jauh di luar acuan pasar', 'Barang tidak sesuai foto / keluhan pelanggan', 'Lapak tidak ditemukan di pasar', 'Permintaan pedagang sendiri']}
        onCancel={() => setAsk(null)} onSubmit={(r) => review(ask!.v, ask!.status, r)} />
      <DeletePartnerDialog target={del} onClose={() => setDel(null)} onDeleted={load} />
      <Row gap={adminSpace.lg} style={{ flexWrap: 'wrap' }}>
        <StatCard index={0} icon="hourglass-outline" label="Menunggu" value={n('pending')} color={adminTone.amber} />
        <StatCard index={1} icon="checkmark-circle-outline" label="Aktif" value={n('approved')} color={adminTone.green} />
        <StatCard index={2} icon="pause-circle-outline" label="Ditangguhkan" value={n('suspended')} color={adminTone.slate} />
        <StatCard index={3} icon="ribbon-outline" label="Ambang skor kualitas" value={`${qualityMin}`} hint="barang tampil ke pelanggan bila skor ≥ ambang" color={adminTone.teal} />
      </Row>
      <Entrance index={1}>
        <Card style={{ backgroundColor: colors.market + '12', borderColor: colors.market + '40', gap: 4 }}>
          <Text style={font.small}>Skor kualitas (0–100) dihitung otomatis: foto lapak 15, KTP 10, kartu pedagang 5, telepon 5, foto barang 20, harga diperbarui ≤3 hari 20, harga dalam koefisien acuan 15, rating 10. Barang pedagang hanya tampil untuk pelanggan bila lapak aktif dan skor ≥ {qualityMin}. Ambang diubah di halaman Otomasi.</Text>
        </Card>
      </Entrance>
      <FilterBar value={tab} onChange={setTab} options={TABS} />
      {rows === null ? <View style={{ gap: 12 }}><Skeleton height={160} radius={20} /><Skeleton height={160} radius={20} /></View>
        : rows.length === 0 ? <Card><Empty icon="basket-outline" title="Tidak ada pedagang" subtitle={tab === 'pending' ? 'Semua pengajuan sudah ditinjau.' : 'Belum ada data pada filter ini.'} /></Card>
        : rows.map((v, i) => {
          const score = Number(v.quality_score) || 0;
          return (
            <Entrance key={v.id} index={Math.min(i, 8) + 2}>
              <Card style={{ gap: 12 }}>
                <Row gap={12} style={{ alignItems: 'flex-start' }}>
                  {v.photo_url ? <Pressable onPress={() => Linking.openURL(v.photo_url!)}><Image source={{ uri: v.photo_url }} style={st.photo} /></Pressable> : <IconCircle name="storefront-outline" size={64} color={colors.market} />}
                  <View style={{ flex: 1, gap: 6, minWidth: 0 }}>
                    <Row gap={6} style={{ flexWrap: 'wrap' }}>
                      <Badge text={STATUS_LABEL[v.status] ?? v.status} color={STATUS_COLOR[v.status] ?? colors.textMuted} />
                      {(v.categories ?? []).map((c) => <Badge key={c} text={marketCategoryLabel[c] ?? c} color={colors.market} />)}
                    </Row>
                    <Text style={font.h2}>{v.stall_name}{v.stall_no ? <Text style={font.small}>  · lapak {v.stall_no}</Text> : null}</Text>
                    <Row gap={6}><Ionicons name="location-outline" size={adminIcon.sm} color={adminTone.faint} /><Text style={font.small}>{v.market_name ?? 'Pasar tidak diketahui'}{v.open_hours ? ` · ${v.open_hours}` : ''}</Text></Row>
                    <Row gap={6}><Ionicons name="person-outline" size={adminIcon.sm} color={adminTone.faint} /><Text style={font.small}>{v.owner_name ?? '-'} · {phoneDisplay(v.phone ?? v.owner_phone)}</Text></Row>
                    {v.description ? <Text style={[font.tiny, { fontStyle: 'italic' }]}>"{v.description}"</Text> : null}
                    <Row gap={12} style={{ marginTop: 4 }}>
                      <View style={{ flex: 1, gap: 4 }}>
                        <Row between><Text style={font.tiny}>Skor kualitas</Text><Text style={[font.tiny, { color: scoreColor(score, qualityMin), fontWeight: '700' }]}>{score.toFixed(0)} / 100{score < qualityMin ? ' · di bawah ambang' : ''}</Text></Row>
                        <ProgressBar progress={score / 100} color={scoreColor(score, qualityMin)} />
                      </View>
                    </Row>
                    <Row gap={14} style={{ flexWrap: 'wrap' }}>
                      <Text style={font.tiny}>{v.items ?? 0} barang · {v.items_photo ?? 0} berfoto</Text>
                      <Text style={font.tiny}>{v.total_orders} pesanan · rating {v.rating_count > 0 ? `${Number(v.rating_avg).toFixed(1)} (${v.rating_count})` : '-'}</Text>
                      <Text style={font.tiny}>Daftar {fmtDate(v.created_at, false)}</Text>
                    </Row>
                    <Row gap={8} style={{ flexWrap: 'wrap' }}>
                      <DocLink label="Foto lapak" ok={!!v.photo_url} onPress={() => v.photo_url && Linking.openURL(v.photo_url)} />
                      <DocLink label="KTP" ok={!!v.id_card_url} onPress={() => openDoc(v.id_card_url)} />
                      <DocLink label="Kartu pedagang" ok={!!v.market_card_url} onPress={() => openDoc(v.market_card_url)} />
                    </Row>
                    <Row gap={6}><Ionicons name="card-outline" size={adminIcon.sm} color={adminTone.faint} /><Text style={font.small}>{v.bank_name ? `${v.bank_name} ${v.bank_account ?? ''} a.n. ${v.bank_holder ?? '-'}` : 'Rekening belum diisi'}</Text></Row>
                    {v.status_reason ? <Text style={[font.tiny, { color: colors.danger }]}>Catatan: {v.status_reason}</Text> : null}
                  </View>
                </Row>
                {/* Aksi ringkas: satu tombol utama + Chat, sisanya di menu kebab. */}
                <RowActions
                  contact={{ userId: v.id, name: v.owner_name ?? v.stall_name, role: 'merchant', subject: `Panel admin · lapak ${v.stall_name}` }}
                  primary={[
                    v.status === 'pending' && { key: 'ok', label: 'Setujui & aktifkan', icon: 'checkmark' as const, variant: 'solid' as const, color: colors.success, busy: busyId === v.id, onPress: () => review(v, 'approved') },
                    (v.status === 'suspended' || v.status === 'rejected') && { key: 'restore', label: 'Pulihkan', icon: 'refresh' as const, variant: 'solid' as const, color: colors.success, busy: busyId === v.id, onPress: () => review(v, 'approved', 'Dipulihkan admin setelah peninjauan') },
                  ]}
                  menu={[
                    v.status === 'pending' && { key: 'reject', label: 'Tolak lapak…', icon: 'close-circle-outline', danger: true, onPress: () => review(v, 'rejected') },
                    v.status === 'approved' && { key: 'susp', label: 'Tangguhkan…', icon: 'pause-circle-outline', danger: true, onPress: () => review(v, 'suspended') },
                    { key: 'del', label: 'Hapus lapak…', icon: 'trash-outline', danger: true, hint: 'butuh PIN & alasan', onPress: () => setDel({ kind: 'vendor', id: v.id, name: v.stall_name, meta: [v.market_name ?? 'pasar', `${v.items ?? 0} barang`] }) },
                  ]}
                />
              </Card>
            </Entrance>
          );
        })}
      <WideTableHint />
    </AdminPage>
  );
}

function DocLink({ label, ok, onPress }: { label: string; ok: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} disabled={!ok} style={[st.doc, ok ? { borderColor: colors.success + '55', backgroundColor: colors.successLight } : null]}>
      <Ionicons name={ok ? 'document-attach-outline' : 'close-circle-outline'} size={adminIcon.sm} color={ok ? colors.success : adminTone.faint} />
      <Text style={[font.tiny, { color: ok ? colors.success : adminTone.faint, fontWeight: '700' }]}>{label}{ok ? '' : ' (kosong)'}</Text>
    </Pressable>
  );
}

const st = StyleSheet.create({
  photo: { width: 96, height: 96, borderRadius: adminRadius.card, backgroundColor: adminTone.surfaceAlt },
  doc: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: adminRadius.chip, borderWidth: 1, borderColor: adminTone.border, backgroundColor: adminTone.surface },
});
