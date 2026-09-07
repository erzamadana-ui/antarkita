// Admin · Mitra Travel: verifikasi & pengelolaan agen travel / sopir pribadi AntarTravel
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, Linking, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { AdminPage, FilterBar, StatCard, ReasonPrompt, RowActions, DeletePartnerDialog, adminFont as font, adminTone, adminSpace, adminRadius, adminIcon, AdminCard as Card, EmptyState as Empty } from '@/components/admin';
import { Row, Button, Badge, Input, IconCircle, Stars, toast } from '@/components/ui';
import { Entrance, Skeleton } from '@/components/motion';
import { rpc } from '@/lib/supabase';
import { signedUrl } from '@/lib/upload';
import { handleAdminError } from '@/store/adminSecurity';
import { colors } from '@/lib/theme';
import { formatDate, phoneDisplay, phoneMasked, rupiah } from '@/lib/format';
import type { ApprovalStatus, TravelPartner } from '@/lib/types';

type PartnerRow = TravelPartner & { full_name: string | null; phone: string | null; email: string | null; base_city_name: string | null; trips: number; bookings: number; requests_done: number; offers: number; wallet: number | null };

const STATUS_LABEL: Record<ApprovalStatus, string> = { pending: 'Menunggu', approved: 'Aktif', suspended: 'Ditangguhkan', rejected: 'Ditolak' };
const STATUS_COLOR: Record<ApprovalStatus, string> = { pending: colors.warning, approved: colors.success, suspended: colors.danger, rejected: colors.textMuted };
const FILTERS = [{ key: 'pending', label: 'Menunggu' }, { key: 'approved', label: 'Aktif' }, { key: 'suspended', label: 'Ditangguhkan' }, { key: 'rejected', label: 'Ditolak' }, { key: 'all', label: 'Semua' }];
const emailMasked = (e?: string | null) => { if (!e) return '-'; const [u, d] = e.split('@'); return `${(u ?? '').slice(0, 2)}••@${d ?? ''}`; };
const ACCOM_LABEL: Record<string, string> = { customer: 'ditanggung penyewa', self: 'mandiri' };

export default function AdminTravelPartners() {
  const router = useRouter();
  const [rows, setRows] = useState<PartnerRow[] | null>(null);
  const [filter, setFilter] = useState('pending');
  const [q, setQ] = useState('');
  const [ask, setAsk] = useState<{ id: string; status: ApprovalStatus; name: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [del, setDel] = useState<{ kind: 'travel'; id: string; name: string; meta?: string[] } | null>(null);

  const load = useCallback(async () => {
    try { setRows((await rpc<PartnerRow[]>('admin_travel_partners', { p_status: 'all' })) ?? []); }
    catch (e) { toast.error((e as Error).message); setRows([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const setStatus = async (p: PartnerRow, status: ApprovalStatus, reason?: string) => {
    if ((status === 'suspended' || status === 'rejected') && reason === undefined) { setAsk({ id: p.id, status, name: displayName(p) }); return; }
    setBusyId(p.id);
    try {
      await rpc('admin_set_travel_partner', { p_id: p.id, p_status: status, p_reason: reason ?? null });
      toast.success(`Mitra ${displayName(p)}: ${STATUS_LABEL[status].toLowerCase()}`); setAsk(null); load();
    } catch (e) { handleAdminError(e); } finally { setBusyId(null); }
  };
  // Data pribadi tersamar; "Tampilkan" mencatat admin.pii_reveal di log keamanan
  const reveal = async (p: PartnerRow) => {
    try { await rpc('admin_log_event', { p_kind: 'admin.pii_reveal', p_detail: { user_id: p.id, entity: 'travel_partner' } }); setRevealed((r) => ({ ...r, [p.id]: true })); }
    catch (e) { toast.error((e as Error).message); }
  };
  const openDoc = async (v: string | null | undefined, label: string) => {
    if (!v) return toast.error(`${label} belum diunggah`);
    const u = /^https?:\/\//i.test(v) ? v : await signedUrl('documents', v);
    if (u) Linking.openURL(u); else toast.error(`${label} tidak dapat dibuka`);
  };

  const all = rows ?? [];
  const shown = all.filter((r) => (filter === 'all' || r.status === filter) && (!q || displayName(r).toLowerCase().includes(q.toLowerCase()) || (r.vehicle_plate ?? '').toLowerCase().includes(q.toLowerCase()) || (r.vehicle_model ?? '').toLowerCase().includes(q.toLowerCase())));
  const count = (st: ApprovalStatus) => all.filter((r) => r.status === st).length;
  const askName = ask?.name ?? 'mitra';

  return (
    <AdminPage title="Mitra Travel" subtitle={`${all.length} mitra AntarTravel · ${count('pending')} menunggu verifikasi · data pribadi tersamar (tampilkan per mitra, tercatat di log)`} onRefresh={load}
      right={<Button size="sm" title="Rute & permintaan" variant="secondary" icon="map-outline" onPress={() => router.push('/(admin)/logistics' as never)} />}>
      <ReasonPrompt visible={!!ask} title={ask?.status === 'suspended' ? `Tangguhkan ${askName}?` : `Tolak ${askName}?`} subtitle="Alasan wajib — tersimpan di Log Aktivitas dan ditampilkan ke mitra." onCancel={() => setAsk(null)} onSubmit={(r) => { const p = all.find((x) => x.id === ask!.id); if (p) return setStatus(p, ask!.status, r); }} confirmLabel={ask?.status === 'suspended' ? 'Tangguhkan' : 'Tolak'} />
      <DeletePartnerDialog target={del} onClose={() => setDel(null)} onDeleted={load} />
      <Row gap={adminSpace.lg} style={{ flexWrap: 'wrap' }}>
        <StatCard index={0} icon="hourglass-outline" label="Menunggu" value={count('pending')} color={adminTone.amber} />
        <StatCard index={1} icon="checkmark-circle-outline" label="Aktif" value={count('approved')} color={adminTone.green} />
        <StatCard index={2} icon="pause-circle-outline" label="Ditangguhkan" value={count('suspended')} color={adminTone.red} />
        <StatCard index={3} icon="bus-outline" label="Total trip" value={all.reduce((s, r) => s + (Number(r.trips) || 0), 0)} hint="jadwal kursi bersama" color={adminTone.violet} />
      </Row>
      <Row gap={10} style={{ flexWrap: 'wrap' }}>
        <FilterBar value={filter} onChange={setFilter} options={FILTERS.map((f) => ({ ...f, label: f.key === 'all' ? `Semua (${all.length})` : `${f.label} (${count(f.key as ApprovalStatus)})` }))} />
        <Input placeholder="Cari nama / plat / kendaraan" value={q} onChangeText={setQ} icon="search" containerStyle={{ minWidth: 240 }} />
      </Row>

      {rows === null ? <View style={{ gap: 12 }}><Skeleton height={180} radius={20} /><Skeleton height={180} radius={20} /></View>
        : shown.length === 0 ? <Card><Empty icon="bus-outline" title="Tidak ada mitra travel" subtitle={filter === 'pending' ? 'Semua pengajuan sudah ditinjau.' : 'Belum ada data pada filter ini.'} /></Card>
        : shown.map((p, i) => {
          const open = !!revealed[p.id];
          const isPrivate = p.partner_type === 'private';
          const services = [p.offers_shared !== false && 'Kursi bersama', p.offers_charter && 'Carter privat', p.offers_daily && 'Sopir harian'].filter(Boolean) as string[];
          return (
            <Entrance key={p.id} index={Math.min(i, 8) + 2}>
              <Card style={{ gap: 12 }}>
                {/* Baris kepala: identitas + status */}
                <Row gap={12} style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <IconCircle name={isPrivate ? 'person-outline' : 'business-outline'} size={48} color={colors.travel} />
                  <View style={{ flex: 1, minWidth: 220, gap: 4 }}>
                    <Row gap={6} style={{ flexWrap: 'wrap' }}>
                      <Badge text={isPrivate ? 'Sopir pribadi' : 'Agen travel'} color={isPrivate ? colors.info : colors.travel} />
                      <Badge text={STATUS_LABEL[p.status]} color={STATUS_COLOR[p.status]} />
                      {p.is_electric ? <Badge text="Kendaraan listrik" color={colors.success} /> : null}
                    </Row>
                    <Text style={font.h2}>{displayName(p)}</Text>
                    {p.company_name && p.full_name && p.company_name !== p.full_name ? <Text style={font.small}>Penanggung jawab: {p.full_name}{p.driver_name && p.driver_name !== p.full_name ? ` · sopir: ${p.driver_name}` : ''}</Text> : p.driver_name && p.driver_name !== p.full_name ? <Text style={font.small}>Sopir: {p.driver_name}</Text> : null}
                    <Row gap={6} style={{ flexWrap: 'wrap' }}>
                      <Ionicons name="call-outline" size={adminIcon.sm} color={adminTone.faint} />
                      <Text style={font.tiny}>{open ? `${phoneDisplay(p.phone)} · ${p.email ?? '-'}` : `${phoneMasked(p.phone)} · ${emailMasked(p.email)}`}</Text>
                      {!open ? <Pressable onPress={() => reveal(p)} hitSlop={6}><Text style={st.link}>Tampilkan</Text></Pressable> : null}
                    </Row>
                    <Row gap={6}><Ionicons name="location-outline" size={adminIcon.sm} color={adminTone.faint} /><Text style={font.tiny}>Kota basis: {p.base_city_name ?? '—'} · daftar {formatDate(p.created_at, false)}</Text></Row>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    <Stars value={Number(p.rating_avg) || 0} />
                    <Text style={font.tiny}>{Number(p.rating_avg || 0).toFixed(1)} · {p.rating_count} ulasan</Text>
                  </View>
                </Row>

                {/* Kendaraan · layanan · dokumen */}
                <Row gap={12} style={{ flexWrap: 'wrap', alignItems: 'stretch' }}>
                  <View style={st.block}>
                    <Text style={st.blockTitle}>Kendaraan</Text>
                    <Text style={font.bodyStrong}>{p.vehicle_model}{p.vehicle_year ? ` (${p.vehicle_year})` : ''}</Text>
                    <Text style={font.small}>{p.vehicle_plate} · {p.seats} kursi{p.is_electric ? ' · listrik' : ''}</Text>
                  </View>
                  <View style={st.block}>
                    <Text style={st.blockTitle}>Layanan</Text>
                    <Text style={font.bodyStrong}>{services.join(' · ') || '—'}</Text>
                    <Text style={font.small} numberOfLines={3}>
                      {[p.daily_rate ? `Harian ${rupiah(p.daily_rate)}` : null, p.overtime_rate ? `lembur ${rupiah(p.overtime_rate)}/jam` : null, p.charter_rate_km ? `carter ${rupiah(p.charter_rate_km)}/km` : null, p.fuel_included ? 'BBM termasuk' : null,
                        p.accommodation?.length ? `menginap: ${p.accommodation.map((a) => ACCOM_LABEL[a] ?? a).join(' / ')}${p.accommodation_fee ? ` (${rupiah(p.accommodation_fee)}/malam)` : ''}` : null].filter(Boolean).join(' · ') || 'Tarif mengikuti rute'}
                    </Text>
                  </View>
                  <View style={st.block}>
                    <Text style={st.blockTitle}>Dokumen</Text>
                    <Row gap={10} style={{ flexWrap: 'wrap' }}>
                      {([['Foto kendaraan', p.photo_url], ['SIM', p.license_url], ['Izin usaha', p.permit_url]] as const).map(([label, v]) => (
                        <Pressable key={label} onPress={() => openDoc(v, label)} hitSlop={4}>
                          <Row gap={4}><Ionicons name={v ? 'document-attach-outline' : 'close-circle-outline'} size={adminIcon.sm} color={v ? colors.primary : adminTone.faint} /><Text style={[st.link, !v && { color: adminTone.faint }]}>{label}</Text></Row>
                        </Pressable>
                      ))}
                    </Row>
                    {p.bio ? <Text style={[font.tiny, { fontStyle: 'italic' }]} numberOfLines={2}>"{p.bio}"</Text> : null}
                  </View>
                </Row>

                {/* Statistik */}
                <Row gap={8} style={{ flexWrap: 'wrap' }}>
                  {([['Trip', p.trips], ['Booking', p.bookings], ['Permintaan selesai', p.requests_done], ['Tawaran', p.offers], ['Total perjalanan', p.total_trips]] as const).map(([l, v]) => (
                    <View key={l} style={st.stat}><Text style={[font.mono, { fontSize: 14, color: adminTone.teal }]}>{Number(v) || 0}</Text><Text style={font.tiny}>{l}</Text></View>
                  ))}
                  <View style={st.stat}><Text style={[font.mono, { fontSize: 14, color: (p.wallet ?? 0) < 0 ? adminTone.red : adminTone.ink }]}>{rupiah(Number(p.wallet) || 0)}</Text><Text style={font.tiny}>Saldo AntarPay</Text></View>
                </Row>

                {p.status_reason && p.status !== 'approved' ? (
                  <View style={st.reason}><Ionicons name="information-circle-outline" size={adminIcon.md} color={STATUS_COLOR[p.status]} /><Text style={[font.small, { flex: 1, color: adminTone.ink }]}>Alasan: {p.status_reason}</Text></View>
                ) : null}

                {/* Aksi */}
                {/* Aksi ringkas: satu tombol utama + Chat, sisanya di menu kebab. */}
                <RowActions
                  contact={{ userId: p.id, name: displayName(p), role: 'driver', subject: `Panel admin · mitra travel ${displayName(p)}` }}
                  primary={[
                    (p.status === 'pending' || p.status === 'rejected') && { key: 'ok', label: 'Setujui', icon: 'checkmark' as const, variant: 'solid' as const, color: colors.success, busy: busyId === p.id, onPress: () => setStatus(p, 'approved', 'Disetujui admin setelah verifikasi dokumen') },
                    p.status === 'suspended' && { key: 'restore', label: 'Pulihkan', icon: 'refresh' as const, variant: 'solid' as const, color: colors.success, busy: busyId === p.id, onPress: () => setStatus(p, 'approved', 'Dipulihkan oleh admin') },
                  ]}
                  menu={[
                    p.status === 'pending' && { key: 'reject', label: 'Tolak pengajuan…', icon: 'close-circle-outline', danger: true, onPress: () => setStatus(p, 'rejected') },
                    p.status === 'approved' && { key: 'susp', label: 'Tangguhkan…', icon: 'pause-circle-outline', danger: true, onPress: () => setStatus(p, 'suspended') },
                    { key: 'del', label: 'Hapus mitra…', icon: 'trash-outline', danger: true, hint: 'butuh PIN & alasan', onPress: () => setDel({ kind: 'travel', id: p.id, name: displayName(p), meta: [p.vehicle_plate ?? '', `${p.trips} trip`].filter(Boolean) }) },
                  ]}
                />
              </Card>
            </Entrance>
          );
        })}
    </AdminPage>
  );
}

function displayName(p: PartnerRow) { return p.company_name || p.full_name || p.driver_name || 'Mitra travel'; }

const st = StyleSheet.create({
  link: { color: colors.primary, fontWeight: '700', fontSize: 12, lineHeight: 16 },
  block: { flex: 1, minWidth: 200, gap: 4, padding: adminSpace.md, borderRadius: adminRadius.card, backgroundColor: adminTone.surfaceAlt, borderWidth: 1, borderColor: adminTone.border },
  blockTitle: { ...font.label },
  stat: { minWidth: 96, paddingHorizontal: adminSpace.md, paddingVertical: adminSpace.sm, borderRadius: adminRadius.card, backgroundColor: adminTone.surfaceAlt, borderWidth: 1, borderColor: adminTone.border, gap: 2 },
  reason: { flexDirection: 'row', alignItems: 'center', gap: adminSpace.sm, padding: 10, borderRadius: adminRadius.card, backgroundColor: adminTone.surfaceAlt, borderWidth: 1, borderColor: adminTone.border },
});
