// Admin · Mitra Driver — verifikasi dokumen, status, kontak (chat/telepon), hapus permanen (PIN + alasan).
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, Linking } from 'react-native';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import {
  AdminPage, DataTable, Toolbar, ReasonPrompt, StatCard, Grid, Pill, StatusPill,
  RowActions, DeletePartnerDialog, IconAction, Truncate,
  adminFont as font, adminTone, adminSpace, adminTable, adminIcon,
} from '@/components/admin';
import { Row, Button, toast } from '@/components/ui';
import { rpc, supabase } from '@/lib/supabase';
import { signedUrl } from '@/lib/upload';
import { colors } from '@/lib/theme';
import { formatDate, phoneMasked, vehicleClassLabel, vehicleTypeLabel } from '@/lib/format';
import { FUEL_LABEL } from '@/lib/vehicles';
import type { ApprovalStatus, Driver, DriverDocuments, Profile } from '@/lib/types';

type Row_ = Driver & { profile: Profile | null; docs: DriverDocuments | null };

export default function AdminDrivers() {
  const router = useRouter();
  const [rows, setRows] = useState<Row_[]>([]);
  const [filter, setFilter] = useState('pending');
  const [q, setQ] = useState('');
  const [del, setDel] = useState<{ kind: 'driver'; id: string; name: string; meta?: string[] } | null>(null);

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
    try { await rpc('admin_set_driver_status', { p_driver: id, p_status: status, p_reason: reason ?? null }); toast.success('Status driver diperbarui & tercatat di log'); setAsk(null); load(); }
    catch (e) { toast.error((e as Error).message); }
  };
  const openDoc = async (path: string | null | undefined) => { if (!path) return toast.error('Dokumen belum diunggah'); const u = await signedUrl('documents', path); if (u) Linking.openURL(u); };

  const count = (s: ApprovalStatus) => rows.filter((r) => r.status === s).length;
  const shown = rows.filter((r) => (filter === 'all' || r.status === filter)
    && (!q || (r.profile?.full_name ?? '').toLowerCase().includes(q.toLowerCase()) || r.vehicle_plate.toLowerCase().includes(q.toLowerCase())));

  return (
    <AdminPage title="Mitra Driver" subtitle={`${rows.length} terdaftar · ${count('pending')} menunggu verifikasi · nomor pribadi tersamar`} onRefresh={load}>
      <ReasonPrompt visible={!!ask} title={ask?.status === 'suspended' ? `Tangguhkan ${ask?.name}?` : `Tolak ${ask?.name}?`} subtitle="Alasan wajib — tersimpan di Log Aktivitas dan ditampilkan ke driver." onCancel={() => setAsk(null)} onSubmit={(r) => setStatus(ask!.id, ask!.status, r)} confirmLabel={ask?.status === 'suspended' ? 'Tangguhkan' : 'Tolak'} />
      <DeletePartnerDialog target={del} onClose={() => setDel(null)} onDeleted={load} />

      <Grid gap={adminSpace.lg}>
        <StatCard index={0} icon="hourglass-outline" label="Menunggu" value={count('pending')} color={adminTone.amber} />
        <StatCard index={1} icon="checkmark-circle-outline" label="Aktif" value={count('approved')} color={adminTone.green} />
        <StatCard index={2} icon="pause-circle-outline" label="Ditangguhkan" value={count('suspended')} color={adminTone.red} />
        <StatCard index={3} icon="radio-outline" label="Sedang online" value={rows.filter((r) => r.is_online).length} hint={`dari ${rows.length} driver`} color={adminTone.blue} />
      </Grid>

      <Toolbar q={q} onQ={setQ} placeholder="Cari nama atau plat nomor"
        filters={[{ key: 'pending', label: `Menunggu (${count('pending')})` }, { key: 'approved', label: 'Aktif' }, { key: 'suspended', label: 'Ditangguhkan' }, { key: 'rejected', label: 'Ditolak' }, { key: 'all', label: `Semua (${rows.length})` }]}
        filter={filter} onFilter={setFilter}
        right={<Button size="sm" variant="outline" title="Mitra Travel" icon="bus-outline" onPress={() => router.push('/(admin)/travel' as never)} />} />

      <DataTable rows={shown as unknown as Record<string, unknown>[]} emptyText="Tidak ada driver pada filter ini" emptyIcon="bicycle-outline" columns={[
        {
          key: 'name', label: 'Driver', width: 210, flex: 2, render: (r) => {
            const d = r as unknown as Row_;
            return (
              <View style={{ minWidth: 0 }}>
                <Truncate style={font.bodyStrong} title={d.profile?.full_name ?? ''}>{d.profile?.full_name ?? '—'}</Truncate>
                <Truncate style={font.tiny}>{phoneMasked(d.profile?.phone)} · bergabung {formatDate(d.created_at, false)}</Truncate>
              </View>
            );
          },
        },
        {
          key: 'vehicle', label: 'Kendaraan', width: 220, flex: 2, render: (r) => {
            const d = r as unknown as Row_;
            const fuel = d.fuel_type ? FUEL_LABEL[d.fuel_type] : d.is_electric ? 'Listrik (EV)' : null;
            const head = [d.vehicle_brand, d.vehicle_model].filter(Boolean).join(' ') || '—';
            return (
              <View style={{ minWidth: 0 }}>
                <Truncate style={font.bodyStrong} title={head}>{head}{fuel ? ` · ${fuel}` : ''}</Truncate>
                <Truncate style={font.tiny}>{vehicleTypeLabel[d.vehicle_type]} · {d.vehicle_plate}{d.vehicle_year ? ` · ${d.vehicle_year}` : ''} · {d.vehicle_class ? vehicleClassLabel[d.vehicle_class] ?? d.vehicle_class : '—'}</Truncate>
              </View>
            );
          },
        },
        {
          key: 'docs', label: 'Dokumen', width: 170, render: (r) => {
            const d = r as unknown as Row_;
            return (
              <View style={{ gap: 4, minWidth: 0 }}>
                <Truncate style={font.tiny} title={`SIM ${d.docs?.license_number ?? '-'} · NIK ${d.docs?.id_card_number ?? '-'}`}>SIM {d.docs?.license_number ?? '-'}</Truncate>
                <Row gap={6}>
                  <IconAction icon="card-outline" label="KTP" color={adminTone.blue} compact onPress={() => openDoc(d.docs?.photo_id_url)} />
                  <IconAction icon="image-outline" label="Unit" color={adminTone.blue} compact onPress={() => openDoc(d.docs?.photo_vehicle_url)} />
                </Row>
              </View>
            );
          },
        },
        {
          key: 'rating_avg', label: 'Performa', width: 130, render: (r) => {
            const d = r as unknown as Row_;
            return (
              <View style={{ alignItems: 'flex-start', gap: 3 }}>
                <Row gap={4}><Ionicons name="star" size={adminIcon.sm} color={colors.accent} /><Text style={font.mono}>{Number(d.rating_avg).toFixed(1)}</Text><Text style={font.tiny}>· {d.total_trips} trip</Text></Row>
                {d.is_online ? <Pill text="Online" tone="ok" /> : null}
              </View>
            );
          },
        },
        {
          key: 'status', label: 'Status', width: 150, render: (r) => {
            const d = r as unknown as Row_;
            return (
              <View style={{ gap: 3, minWidth: 0 }}>
                <StatusPill status={d.status} />
                {d.status_reason && d.status !== 'approved' ? <Truncate style={font.tiny} title={d.status_reason} lines={2}>{d.status_reason}</Truncate> : null}
              </View>
            );
          },
        },
        {
          // Aksi utama layar ini = keputusan verifikasi; Chat mengisi slot kedua, sisanya di kebab.
          key: 'actions', label: 'Aksi', width: adminTable.actionsWideW, align: 'right', render: (r) => {
            const d = r as unknown as Row_;
            const name = d.profile?.full_name ?? 'Driver';
            return (
              <RowActions
                contact={{ userId: d.id, name, role: 'driver', subject: `Panel admin · driver ${name}`.trim() }}
                primary={[
                  d.status !== 'approved' && {
                    key: 'ok', label: d.status === 'suspended' ? 'Aktifkan' : 'Setujui', variant: 'solid' as const, color: colors.success,
                    onPress: () => setStatus(d.id, 'approved', d.status === 'suspended' ? 'Diaktifkan kembali oleh admin' : undefined),
                  },
                ]}
                menu={[
                  d.status === 'pending' && { key: 'reject', label: 'Tolak pengajuan…', icon: 'close-circle-outline', danger: true, onPress: () => setStatus(d.id, 'rejected') },
                  d.status === 'approved' && { key: 'susp', label: 'Tangguhkan…', icon: 'pause-circle-outline', danger: true, onPress: () => setStatus(d.id, 'suspended') },
                  { key: 'del', label: 'Hapus mitra…', icon: 'trash-outline', danger: true, hint: 'butuh PIN & alasan', onPress: () => setDel({ kind: 'driver', id: d.id, name, meta: [d.vehicle_plate, `${d.total_trips} trip`] }) },
                ]}
              />
            );
          },
        },
      ]} />

      <Row gap={8} style={{ flexWrap: 'wrap' }}>
        <Ionicons name="information-circle-outline" size={adminIcon.md} color={adminTone.faint} />
        <Text style={font.tiny}>Driver travel antar kota (agen & sopir pribadi) dikelola di menu</Text>
        <Pressable onPress={() => router.push('/(admin)/travel' as never)} hitSlop={6}><Text style={[font.tiny, { color: colors.primary, fontWeight: '700' }]}>Mitra Travel →</Text></Pressable>
      </Row>
    </AdminPage>
  );
}
