// Admin · Pesanan — pantau, buka detail (kontak pelanggan/driver), dan intervensi pesanan.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Platform, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import {
  AdminPage, DataTable, Toolbar, Panel, Pill, ContactActions, RowActions, Grid, Col, adminFont as font, adminTone, adminSpace, adminTable,
} from '@/components/admin';
import { Row, Button, toast } from '@/components/ui';
import { rpc, supabase } from '@/lib/supabase';
import { colors } from '@/lib/theme';
import { rupiah, serviceLabel, statusLabel, statusColor } from '@/lib/format';
import { usePager, Pager, fmtDate, fmtAgo, Trunc, WideTableHint } from './_shared';
import type { Order, Profile } from '@/lib/types';

type Row_ = Order & { customer_name?: string; driver_name?: string };

export default function AdminOrders() {
  const router = useRouter();
  const [rows, setRows] = useState<Row_[]>([]);
  const [filter, setFilter] = useState('active');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Row_ | null>(null);

  const load = useCallback(async () => {
    let query = supabase.from('orders').select('*, merchant:merchants(name)').order('created_at', { ascending: false }).limit(300);
    if (filter === 'active') query = query.in('status', ['searching', 'accepted', 'arrived', 'in_progress']);
    else if (filter !== 'all') query = query.eq('status', filter);
    const { data } = await query;
    const os = (data as unknown as Order[]) ?? [];
    const ids = Array.from(new Set(os.flatMap((o) => [o.customer_id, o.driver_id]).filter(Boolean))) as string[];
    const { data: profiles } = ids.length ? await supabase.from('profiles').select('id,full_name').in('id', ids) : { data: [] };
    const pm = new Map(((profiles as Pick<Profile, 'id' | 'full_name'>[]) ?? []).map((p) => [p.id, p.full_name]));
    const list = os.map((o) => ({ ...o, customer_name: pm.get(o.customer_id), driver_name: o.driver_id ? pm.get(o.driver_id) : undefined }));
    setRows(list);
    setOpen((cur) => (cur ? list.find((x) => x.id === cur.id) ?? null : null));
  }, [filter]);
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);

  const cancel = (o: Order) => {
    const run = async () => { try { await rpc('cancel_order', { p_order_id: o.id, p_reason: 'Dibatalkan admin' }); toast.success('Order dibatalkan'); load(); } catch (e) { toast.error((e as Error).message); } };
    if (Platform.OS === 'web') { if (confirm(`Batalkan order ${o.code}? Pembayaran AntarPay akan direfund.`)) run(); return; }
    Alert.alert('Batalkan order?', o.code, [{ text: 'Tidak' }, { text: 'Batalkan', style: 'destructive', onPress: run }]);
  };
  const shown = rows.filter((r) => !q || r.code.toLowerCase().includes(q.toLowerCase()) || (r.customer_name ?? '').toLowerCase().includes(q.toLowerCase()));
  const pg = usePager(shown);

  return (
    <AdminPage title="Pesanan" subtitle="Pantau, hubungi pihak terkait, dan intervensi pesanan berjalan" onRefresh={load}>
      <Toolbar q={q} onQ={setQ} placeholder="Cari kode order / pelanggan"
        filters={[{ key: 'active', label: 'Berjalan' }, { key: 'searching', label: 'Mencari driver' }, { key: 'completed', label: 'Selesai' }, { key: 'cancelled', label: 'Batal' }, { key: 'all', label: 'Semua' }]}
        filter={filter} onFilter={setFilter} />

      {open ? (
        <Panel title={`Detail pesanan ${open.code}`} subtitle={`${serviceLabel[open.service]} · ${fmtDate(open.created_at)}`} icon="receipt-outline"
          right={<Row gap={6} style={{ flexWrap: 'wrap' }}>
            <Button size="sm" variant="outline" title="Buka halaman order" icon="open-outline" onPress={() => router.push(`/order/${open.id}` as never)} />
            <Button size="sm" variant="ghost" title="Tutup" onPress={() => setOpen(null)} />
          </Row>}>
          <Grid gap={adminSpace.lg}>
            <Col span={4} min={240} style={{ gap: 6 }}>
              <Text style={font.label}>Pelanggan</Text>
              <Text style={font.bodyStrong} numberOfLines={1}>{open.customer_name ?? '—'}</Text>
              <ContactActions userId={open.customer_id} name={open.customer_name ?? 'Pelanggan'} role="customer" orderId={open.id} subject={`Pesanan ${open.code}`} />
              <Text style={[font.label, { marginTop: 10 }]}>Driver</Text>
              <Text style={font.bodyStrong} numberOfLines={1}>{open.driver_name ?? 'Belum ada driver'}</Text>
              {open.driver_id ? <ContactActions userId={open.driver_id} name={open.driver_name ?? 'Driver'} role="driver" orderId={open.id} subject={`Pesanan ${open.code}`} /> : null}
            </Col>
            <Col span={5} min={260} style={{ gap: 6 }}>
              <Text style={font.label}>Rute</Text>
              <Trunc style={font.body} title={open.merchant?.name ?? open.pickup_address} lines={2}>▲ {open.merchant?.name ?? open.pickup_address}</Trunc>
              <Trunc style={font.body} title={open.dropoff_address} lines={2}>▼ {open.dropoff_address}</Trunc>
              <Text style={[font.label, { marginTop: 10 }]}>Status</Text>
              <Pill text={statusLabel(open.status, open.service, open.merchant_status)} color={statusColor(open.status)} />
            </Col>
            <Col span={3} min={200} style={{ gap: 6 }}>
              <Text style={font.label}>Pembayaran</Text>
              <Text style={[font.num, { fontSize: 22, lineHeight: 28 }]} numberOfLines={1}>{rupiah(open.total)}</Text>
              <Text style={font.small}>{open.payment_method === 'wallet' ? 'AntarPay' : 'Tunai'} · {open.payment_status}</Text>
              {!['completed', 'cancelled'].includes(open.status)
                ? <Button size="sm" variant="outline" color={colors.danger} title="Batalkan pesanan" icon="close-circle-outline" onPress={() => cancel(open)} style={{ marginTop: 8 }} />
                : null}
            </Col>
          </Grid>
        </Panel>
      ) : null}

      <DataTable rows={pg.rows as unknown as Record<string, unknown>[]} emptyText="Tidak ada pesanan pada filter ini" emptyIcon="receipt-outline"
        onRowPress={(r) => setOpen(r as unknown as Row_)}
        columns={[
          { key: 'code', label: 'Order', width: 124, render: (r) => { const o = r as unknown as Row_; return <View style={{ minWidth: 0, alignSelf: 'stretch' }}><Trunc style={font.bodyStrong} title={o.code}>{o.code}</Trunc><Trunc style={font.tiny}>{fmtDate(o.created_at)}</Trunc></View>; } },
          { key: 'service', label: 'Layanan', width: 88, render: (r) => <Text style={font.body} numberOfLines={1}>{serviceLabel[(r as unknown as Row_).service]}</Text> },
          {
            key: 'people', label: 'Pelanggan / Driver', width: 156, render: (r) => {
              const o = r as unknown as Row_;
              return (
                <View style={{ gap: 2, minWidth: 0, alignSelf: 'stretch' }}>
                  <Trunc style={font.body} title={o.customer_name ?? ''}>{o.customer_name ?? '—'}</Trunc>
                  <Trunc style={font.tiny} title={o.driver_name ?? ''}>🛵 {o.driver_name ?? 'belum ada'}</Trunc>
                </View>
              );
            },
          },
          {
            key: 'route', label: 'Rute', width: 166, render: (r) => {
              const o = r as unknown as Row_;
              return (
                <View style={{ minWidth: 0, alignSelf: 'stretch' }}>
                  <Trunc style={font.tiny} title={o.merchant?.name ?? o.pickup_address}>▲ {o.merchant?.name ?? o.pickup_address}</Trunc>
                  <Trunc style={font.tiny} title={o.dropoff_address}>▼ {o.dropoff_address}</Trunc>
                </View>
              );
            },
          },
          {
            key: 'total', label: 'Total', width: 100, align: 'right', render: (r) => {
              const o = r as unknown as Row_;
              return <View style={{ alignItems: 'flex-end' }}><Text style={font.mono}>{rupiah(o.total)}</Text><Text style={font.tiny}>{o.payment_method === 'wallet' ? 'AntarPay' : 'Tunai'}</Text></View>;
            },
          },
          { key: 'status', label: 'Status', width: 120, render: (r) => { const o = r as unknown as Row_; return <Pill text={statusLabel(o.status, o.service, o.merchant_status)} color={statusColor(o.status)} />; } },
          {
            // Aksi utama layar ini = Detail; kontak pelanggan/driver & pembatalan ada di kebab.
            key: 'actions', label: 'Aksi', width: adminTable.actionsWideW, align: 'right', render: (r) => {
              const o = r as unknown as Row_;
              const live = !['completed', 'cancelled'].includes(o.status);
              return (
                <RowActions
                  contact={{ userId: o.customer_id, name: o.customer_name ?? 'Pelanggan', role: 'customer', orderId: o.id, subject: `Pesanan ${o.code}` }}
                  primary={[{ key: 'detail', label: 'Detail', icon: 'reader-outline', variant: 'solid' as const, onPress: () => setOpen(o) }]}
                  menu={[
                    { key: 'page', label: 'Buka halaman pesanan', icon: 'open-outline', onPress: () => router.push(`/order/${o.id}` as never) },
                    !!o.driver_id && { key: 'drv', label: 'Hubungi driver…', icon: 'bicycle-outline', hint: o.driver_name ?? undefined, onPress: () => setOpen(o) },
                    live && { key: 'cancel', label: 'Batalkan pesanan…', icon: 'close-circle-outline', danger: true, onPress: () => cancel(o) },
                  ]}
                />
              );
            },
          },
        ]} />
      <WideTableHint />
      <Pager p={pg} noun="pesanan" />

      <Text style={[font.tiny, { color: adminTone.faint }]}>Klik baris untuk membuka detail. Nomor telepon pribadi tidak pernah ditampilkan — panggilan berjalan lewat modul suara dalam aplikasi.</Text>
    </AdminPage>
  );
}
