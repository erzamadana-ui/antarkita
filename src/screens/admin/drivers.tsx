import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, Linking } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { AdminPage, Table, FilterBar, ReasonPrompt } from '@/components/admin';
import { Row, Badge, Button, toast, Input } from '@/components/ui';
import { rpc, supabase } from '@/lib/supabase';
import { signedUrl } from '@/lib/upload';
import { colors, font } from '@/lib/theme';
import { formatDate, phoneDisplay, vehicleClassLabel, vehicleTypeLabel } from '@/lib/format';
import { FUEL_LABEL } from '@/lib/vehicles';
import type { ApprovalStatus, Driver, DriverDocuments, Profile } from '@/lib/types';

type Row_ = Driver & { profile: Profile | null; docs: DriverDocuments | null };
const statusColor: Record<ApprovalStatus, string> = { pending: colors.warning, approved: colors.success, suspended: colors.danger, rejected: colors.textMuted };

export default function AdminDrivers() {
  const router = useRouter();
  const [rows, setRows] = useState<Row_[]>([]);
  const [filter, setFilter] = useState('pending');
  const [q, setQ] = useState('');
  const load = useCallback(async () => {
    const { data } = await supabase.from('drivers').select('*').order('created_at', { ascending: false }).limit(300);
    const drivers = (data as Driver[]) ?? [];
    const ids = drivers.map((d) => d.id);
    const [{ data: profiles }, { data: docs }] = ids.length
      ? await Promise.all([supabase.from('profiles').select('*').in('id', ids), supabase.from('driver_documents').select('*').in('driver_id', ids)])
      : [{ data: [] }, { data: [] }];
    const pm = new Map(((profiles as Profile[]) ?? []).map((p) => [p.id, p]));
    const dm = new Map(((docs as DriverDocuments[]) ?? []).map((x) => [x.driver_id, x]));
    setRows(drivers.map((d) => ({ ...d, profile: pm.get(d.id) ?? null, docs: dm.get(d.id) ?? null })));
  }, []);
  useEffect(() => { load(); }, [load]);

  const [ask, setAsk] = useState<{ id: string; status: ApprovalStatus; name: string } | null>(null);
  const setStatus = async (id: string, status: ApprovalStatus, reason?: string) => {
    if ((status === 'suspended' || status === 'rejected') && reason === undefined) { setAsk({ id, status, name: rows.find((r) => r.id === id)?.profile?.full_name ?? 'driver' }); return; }
    try { await rpc('admin_set_driver_status', { p_driver: id, p_status: status, p_reason: reason ?? null }); toast.success('Status driver diperbarui & tercatat di log'); setAsk(null); load(); } catch (e) { toast.error((e as Error).message); }
  };
  const openDoc = async (path: string | null | undefined) => { if (!path) return toast.error('Dokumen belum diunggah'); const u = await signedUrl('documents', path); if (u) Linking.openURL(u); };
  const shown = rows.filter((r) => (filter === 'all' || r.status === filter) && (!q || (r.profile?.full_name ?? '').toLowerCase().includes(q.toLowerCase()) || r.vehicle_plate.toLowerCase().includes(q.toLowerCase())));

  return (
    <AdminPage title="Mitra Driver" subtitle={`${rows.length} terdaftar · ${rows.filter((r) => r.status === 'pending').length} menunggu`} onRefresh={load}>
      <ReasonPrompt visible={!!ask} title={ask?.status === 'suspended' ? `Tangguhkan ${ask?.name}?` : `Tolak ${ask?.name}?`} subtitle="Alasan wajib — tersimpan di Log Aktivitas dan ditampilkan ke driver." onCancel={() => setAsk(null)} onSubmit={(r) => setStatus(ask!.id, ask!.status, r)} confirmLabel={ask?.status === 'suspended' ? 'Tangguhkan' : 'Tolak'} />
      <Row gap={10} style={{ flexWrap: 'wrap' }}>
        <FilterBar value={filter} onChange={setFilter} options={[{ key: 'pending', label: 'Menunggu' }, { key: 'approved', label: 'Aktif' }, { key: 'suspended', label: 'Ditangguhkan' }, { key: 'rejected', label: 'Ditolak' }, { key: 'all', label: 'Semua' }]} />
        <Input placeholder="Cari nama / plat" value={q} onChangeText={setQ} icon="search" containerStyle={{ minWidth: 220 }} />
      </Row>
      <Row gap={8} style={{ flexWrap: 'wrap' }}>
        <Ionicons name="bus-outline" size={16} color={colors.travel} />
        <Text style={font.small}>Driver travel antar kota (agen & sopir pribadi) dikelola di menu</Text>
        <Pressable onPress={() => router.push('/(admin)/travel' as never)} hitSlop={6}><Text style={{ color: colors.travel, fontWeight: '800', fontSize: 13 }}>Mitra Travel →</Text></Pressable>
      </Row>
      <Table rows={shown as unknown as Record<string, unknown>[]} columns={[
        { key: 'name', label: 'Driver', width: 200, render: (r) => { const d = r as unknown as Row_; return <View><Text style={{ fontWeight: '700' }}>{d.profile?.full_name}</Text><Text style={font.tiny}>{phoneDisplay(d.profile?.phone)} · {d.profile?.email}</Text></View>; } },
        { key: 'vehicle', label: 'Kendaraan', width: 230, render: (r) => { const d = r as unknown as Row_; const fuel = d.fuel_type ? FUEL_LABEL[d.fuel_type] : d.is_electric ? 'Listrik (EV)' : null; return <View><Text style={{ fontWeight: '700' }} numberOfLines={1}>{[d.vehicle_brand, d.vehicle_model].filter(Boolean).join(' ') || '—'}{fuel ? ` · ${fuel}` : ''}</Text><Text style={font.small}>{vehicleTypeLabel[d.vehicle_type]} · {d.vehicle_plate}{d.vehicle_year ? ` · ${d.vehicle_year}` : ''}</Text><Text style={font.tiny}>{d.vehicle_class ? vehicleClassLabel[d.vehicle_class] ?? d.vehicle_class : '—'}{d.vehicle_condition ? ` · ${d.vehicle_condition}` : ''}</Text></View>; } },
        { key: 'docs', label: 'Dokumen', width: 190, render: (r) => { const d = r as unknown as Row_; return <View><Text style={font.tiny}>SIM {d.docs?.license_number ?? '-'} · NIK {d.docs?.id_card_number ?? '-'}</Text><Row gap={8}><Pressable onPress={() => openDoc(d.docs?.photo_id_url)}><Text style={{ color: colors.primary, fontSize: 12, fontWeight: '700' }}>KTP</Text></Pressable><Pressable onPress={() => openDoc(d.docs?.photo_vehicle_url)}><Text style={{ color: colors.primary, fontSize: 12, fontWeight: '700' }}>Kendaraan</Text></Pressable></Row></View>; } },
        { key: 'stats', label: 'Performa', width: 150, render: (r) => { const d = r as unknown as Row_; return <Row gap={4} style={{ flexWrap: 'wrap' }}><Ionicons name="star" size={12} color={colors.accent} /><Text style={font.small}>{Number(d.rating_avg).toFixed(1)} · {d.total_trips} trip</Text>{d.is_online ? <Badge text="online" color={colors.success} /> : null}</Row>; } },
        { key: 'status', label: 'Status', width: 160, render: (r) => { const d = r as unknown as Row_; return <View><Badge text={d.status} color={statusColor[d.status]} />{d.status_reason && d.status !== 'approved' ? <Text style={font.tiny} numberOfLines={2}>{d.status_reason}</Text> : null}</View>; } },
        { key: 'created_at', label: 'Daftar', width: 130, render: (r) => <Text style={font.tiny}>{formatDate(String(r.created_at), false)}</Text> },
        { key: 'actions', label: 'Aksi', width: 220, render: (r) => { const d = r as unknown as Row_; return (
          <Row gap={6}>
            {d.status !== 'approved' && <Button size="sm" title={d.status === 'suspended' ? 'Aktifkan' : 'Setujui'} color={colors.success} onPress={() => setStatus(d.id, 'approved', d.status === 'suspended' ? 'Diaktifkan kembali oleh admin' : undefined)} />}
            {d.status === 'pending' && <Button size="sm" title="Tolak" variant="outline" color={colors.danger} onPress={() => setStatus(d.id, 'rejected')} />}
            {d.status === 'approved' && <Button size="sm" title="Tangguhkan" variant="outline" color={colors.danger} onPress={() => setStatus(d.id, 'suspended')} />}
          </Row>); } },
      ]} />
    </AdminPage>
  );
}
