// Admin · Dashboard — grid 12 kolom: baris KPI, kolom kiri tren, kolom kanan "Perlu tindakan" + aktivitas.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import {
  AdminPage, StatCard, MiniBars, TrendChart, CITY_COLORS, Panel, Grid, Col, Pill, EmptyState,
  adminFont as font, adminTone, adminSpace, adminRadius, adminIcon, FilterBar, Truncate,
} from '@/components/admin';
import { Row } from '@/components/ui';
import { rpc, supabase } from '@/lib/supabase';
import { colors, fam } from '@/lib/theme';
import { rupiah, timeAgo, serviceLabel, statusLabel, statusColor } from '@/lib/format';
import type { Order, TrafficStats, AuditLog } from '@/lib/types';

interface Stats {
  users: number; drivers_total: number; drivers_pending: number; drivers_online: number;
  merchants_total: number; merchants_pending: number; orders_today: number; orders_active: number;
  gmv_today: number; gmv_month: number; revenue_month: number; topups_pending: number; withdrawals_pending: number;
  orders_by_service: Record<string, number>; orders_last7: { day: string; count: number }[];
}
type CsStats = { open: number; in_progress: number; urgent: number };
type SecOverview = { fraud?: { open?: number; open_high?: number } };

const pct = (now: number, prev: number) => (prev > 0 ? ((now - prev) / prev) * 100 : null);

export default function AdminDashboard() {
  const router = useRouter();
  const [st, setSt] = useState<Stats | null>(null);
  const [live, setLive] = useState<Order[]>([]);
  const [traffic, setTraffic] = useState<TrafficStats | null>(null);
  const [months, setMonths] = useState(6);
  const [refreshing, setRefreshing] = useState(false);
  const [cs, setCs] = useState<CsStats | null>(null);
  const [fraud, setFraud] = useState<number | null>(null);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [extra, setExtra] = useState<{ stores: number; markets: number; travelOpen: number } | null>(null);

  const load = useCallback(async () => {
    const [s, { data }, { count: stores }, { count: markets }, { count: travelOpen }, csStats, sec, { data: audit }] = await Promise.all([
      rpc<Stats>('admin_dashboard_stats').catch(() => null),
      supabase.from('orders').select('*').in('status', ['searching', 'accepted', 'arrived', 'in_progress']).order('created_at', { ascending: false }).limit(8),
      supabase.from('shop_stores').select('id', { count: 'exact', head: true }).eq('active', true),
      supabase.from('markets').select('id', { count: 'exact', head: true }).eq('active', true),
      supabase.from('travel_requests').select('id', { count: 'exact', head: true }).in('status', ['open', 'offered']),
      rpc<CsStats>('cs_stats').catch(() => null),
      rpc<SecOverview>('admin_security_overview').catch(() => null),
      supabase.from('audit_logs').select('*').order('id', { ascending: false }).limit(8),
    ]);
    if (s) setSt(s);
    setLive((data as Order[]) ?? []);
    setExtra({ stores: stores ?? 0, markets: markets ?? 0, travelOpen: travelOpen ?? 0 });
    setCs(csStats ?? null);
    setFraud(sec?.fraud?.open ?? null);
    setLogs((audit as AuditLog[]) ?? []);
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);
  useEffect(() => { rpc<TrafficStats>('admin_traffic_stats', { p_months: months }).then(setTraffic).catch(() => null); }, [months]);

  const todo = [
    { key: 'drv', n: st?.drivers_pending ?? 0, label: 'Driver menunggu verifikasi', icon: 'bicycle-outline' as const, color: adminTone.blue, to: '/(admin)/drivers' },
    { key: 'mch', n: st?.merchants_pending ?? 0, label: 'Merchant menunggu verifikasi', icon: 'restaurant-outline' as const, color: adminTone.orange, to: '/(admin)/merchants' },
    { key: 'tkt', n: cs?.open ?? 0, label: 'Tiket CS terbuka', icon: 'chatbubbles-outline' as const, color: adminTone.violet, to: '/(admin)/cs' },
    { key: 'frd', n: fraud ?? 0, label: 'Flag anti-fraud terbuka', icon: 'shield-half-outline' as const, color: colors.danger, to: '/(admin)/security' },
    { key: 'wd', n: st?.withdrawals_pending ?? 0, label: 'Penarikan menunggu', icon: 'arrow-down-circle-outline' as const, color: adminTone.green, to: '/(admin)/finance' },
    { key: 'tu', n: st?.topups_pending ?? 0, label: 'Top up menunggu', icon: 'arrow-up-circle-outline' as const, color: adminTone.amber, to: '/(admin)/finance' },
  ].filter((x) => x.n > 0);

  const dOrders = traffic ? pct(traffic.this_month.orders, traffic.last_month.orders) : null;
  const dGmv = traffic ? pct(traffic.this_month.gmv, traffic.last_month.gmv) : null;

  return (
    <AdminPage title="Dashboard" subtitle="Ringkasan operasional hari ini · diperbarui otomatis tiap 15 detik"
      onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} refreshing={refreshing}>

      {/* Baris KPI utama */}
      <Grid gap={adminSpace.lg}>
        <StatCard index={1} icon="receipt-outline" label="Pesanan hari ini" value={st?.orders_today ?? 0} hint={`${st?.orders_active ?? 0} sedang berjalan`} color={adminTone.teal} onPress={() => router.replace('/(admin)/orders')} />
        <StatCard index={2} icon="cash-outline" label="GMV hari ini" value={rupiah(st?.gmv_today ?? 0)} hint={`Bulan ini ${rupiah(st?.gmv_month ?? 0)}`} color={adminTone.green} />
        <StatCard index={3} icon="stats-chart-outline" label="Pendapatan platform (bulan)" value={rupiah(st?.revenue_month ?? 0)} hint="Komisi + biaya layanan" color={adminTone.orange} onPress={() => router.replace('/(admin)/finance')} />
        <StatCard index={4} icon="bicycle-outline" label="Driver online" value={`${st?.drivers_online ?? 0}/${st?.drivers_total ?? 0}`} hint={`${st?.drivers_pending ?? 0} menunggu verifikasi`} color={adminTone.blue} onPress={() => router.replace('/(admin)/drivers')} />
      </Grid>

      {/* Dua kolom: kiri tren & distribusi, kanan tindakan & aktivitas */}
      <Grid gap={adminSpace.lg} style={{ alignItems: 'flex-start' }}>
        <Col span={8} min={400} style={{ gap: adminSpace.lg }}>
          <Panel title="Tren trafik per kota" subtitle={traffic ? `Bulan ini ${traffic.this_month.orders} pesanan · ${rupiah(traffic.this_month.gmv)}` : 'Memuat…'} icon="trending-up-outline"
            right={<FilterBar value={String(months)} onChange={(v) => setMonths(Number(v))} options={[3, 6, 12].map((m) => ({ key: String(m), label: `${m} bln` }))} />}>
            <Grid gap={adminSpace.md} style={{ marginBottom: adminSpace.md }}>
              <StatCard index={0} label="Pesanan bulan ini" value={traffic?.this_month.orders ?? 0} delta={dOrders} hint="vs bulan lalu" color={adminTone.teal} icon="cart-outline" />
              <StatCard index={0} label="GMV bulan ini" value={rupiah(traffic?.this_month.gmv ?? 0)} delta={dGmv} hint="vs bulan lalu" color={adminTone.green} icon="wallet-outline" />
            </Grid>
            {traffic && traffic.cities.length > 0
              ? <TrendChart months={traffic.months} series={traffic.cities.slice(0, 6).map((c, i) => ({ label: `${c.city} (${c.total})`, values: c.series, color: CITY_COLORS[i % CITY_COLORS.length] }))} />
              : <Text style={font.small}>Belum ada data tren.</Text>}
            <Grid gap={adminSpace.xl} style={{ marginTop: adminSpace.lg }}>
              <Col span={6} min={240} style={{ gap: 6 }}>
                <Text style={font.label}>Layanan yang menonjol</Text>
                {(traffic?.services ?? []).map((sv, i) => (
                  <View key={sv.service} style={{ gap: 3, marginTop: 4 }}>
                    <Row between>
                      <Text style={font.body} numberOfLines={1}>{serviceLabel[sv.service] ?? sv.service}</Text>
                      <Text style={[font.tiny, { fontVariant: ['tabular-nums'] }]}>{sv.orders} · {sv.share}% · {rupiah(sv.gmv)}</Text>
                    </Row>
                    <View style={{ height: 5, borderRadius: 3, backgroundColor: adminTone.border }}>
                      <View style={{ width: `${Math.max(2, Math.min(100, sv.share))}%`, height: 5, borderRadius: 3, backgroundColor: CITY_COLORS[i % CITY_COLORS.length] }} />
                    </View>
                  </View>
                ))}
                {(traffic?.services ?? []).length === 0 ? <Text style={font.small}>Belum ada data.</Text> : null}
              </Col>
              <Col span={6} min={240} style={{ gap: 6 }}>
                <Text style={font.label}>Kota teratas</Text>
                {(traffic?.cities ?? []).slice(0, 8).map((c, i) => (
                  <Row key={c.city} between style={{ paddingVertical: 3 }}>
                    <Row gap={6}><View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: CITY_COLORS[i % CITY_COLORS.length] }} /><Text style={font.body} numberOfLines={1}>{c.city}</Text></Row>
                    <Text style={font.mono}>{c.total}</Text>
                  </Row>
                ))}
                {(traffic?.cities ?? []).length === 0 ? <Text style={font.small}>Belum ada data.</Text> : null}
              </Col>
            </Grid>
          </Panel>

          <Grid gap={adminSpace.lg}>
            <Col span={6} min={280}>
              <Panel title="Pesanan 7 hari terakhir" icon="calendar-outline" iconColor={adminTone.blue}>
                <MiniBars data={(st?.orders_last7 ?? []).map((d) => ({ label: new Date(d.day).toLocaleDateString('id-ID', { weekday: 'short' }), value: d.count }))} color={adminTone.blue} />
              </Panel>
            </Col>
            <Col span={6} min={280}>
              <Panel title="Komposisi layanan (30 hari)" icon="pie-chart-outline" iconColor={adminTone.orange}>
                <View style={{ gap: 7 }}>
                  {Object.entries(st?.orders_by_service ?? {}).map(([k, v]) => (
                    <Row key={k} between>
                      <Text style={font.body} numberOfLines={1}>{serviceLabel[k as keyof typeof serviceLabel] ?? k}</Text>
                      <Text style={font.mono}>{Number(v).toLocaleString('id-ID')}</Text>
                    </Row>
                  ))}
                  {!st || Object.keys(st.orders_by_service ?? {}).length === 0 ? <Text style={font.small}>Belum ada data.</Text> : null}
                </View>
              </Panel>
            </Col>
          </Grid>
        </Col>

        <Col span={4} min={286} style={{ gap: adminSpace.lg }}>
          <Panel title="Perlu tindakan" icon="alert-circle-outline" iconColor={adminTone.amber} padded={false}
            right={todo.length ? <Pill text={`${todo.reduce((a, b) => a + b.n, 0)} antre`} tone="wait" /> : <Pill text="Bersih" tone="ok" />}>
            {todo.length === 0
              ? <EmptyState icon="checkmark-done-outline" title="Tidak ada antrean" subtitle="Semua verifikasi, tiket, dan pencairan sudah tertangani." />
              : todo.map((t) => (
                <Pressable key={t.key} onPress={() => router.replace(t.to as never)} style={(stt) => [rowStyle, (stt as { hovered?: boolean }).hovered && { backgroundColor: adminTone.zebra }]}>
                  <View style={{ width: 28, height: 28, borderRadius: adminRadius.md, borderWidth: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.color + '14', borderColor: t.color + '2E' }}>
                    <Ionicons name={t.icon} size={adminIcon.md} color={t.color} />
                  </View>
                  <Text style={[font.body, { flex: 1 }]} numberOfLines={1}>{t.label}</Text>
                  <Text style={[font.mono, { color: t.color }]}>{t.n}</Text>
                  <Ionicons name="chevron-forward" size={adminIcon.md} color={adminTone.faint} />
                </Pressable>
              ))}
          </Panel>

          <Panel title="Pesanan berjalan" icon="pulse-outline" iconColor={adminTone.teal} padded={false}
            right={<Pressable onPress={() => router.replace('/(admin)/orders')}><Text style={[font.small, { color: colors.primary, ...fam(700) }]}>Lihat semua</Text></Pressable>}>
            {live.length === 0
              ? <EmptyState icon="moon-outline" title="Tidak ada pesanan berjalan" />
              : live.map((o) => (
                <View key={o.id} style={rowStyle}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Truncate style={font.bodyStrong} title={`${o.code} · ${serviceLabel[o.service]}`}>{o.code} · {serviceLabel[o.service]}</Truncate>
                    <Truncate style={font.tiny} title={o.dropoff_address}>{timeAgo(o.created_at)} · {o.dropoff_address}</Truncate>
                  </View>
                  <Pill text={statusLabel(o.status, o.service, o.merchant_status)} color={statusColor(o.status)} />
                </View>
              ))}
          </Panel>

          <Panel title="Aktivitas terbaru" icon="time-outline" iconColor={adminTone.violet} padded={false}
            right={<Pressable onPress={() => router.replace('/(admin)/activity')}><Text style={[font.small, { color: colors.primary, ...fam(700) }]}>Log lengkap</Text></Pressable>}>
            {logs.length === 0
              ? <EmptyState icon="time-outline" title="Belum ada aktivitas" />
              : logs.map((l) => (
                <View key={l.id} style={rowStyle}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Truncate style={font.body} title={l.summary ?? l.action}>{l.summary ?? l.action}</Truncate>
                    <Truncate style={font.tiny}>{timeAgo(l.created_at)} · {l.actor_name ?? 'Sistem'}</Truncate>
                  </View>
                </View>
              ))}
          </Panel>

          <Panel title="Ekosistem" icon="layers-outline" iconColor={adminTone.slate}>
            <View style={{ gap: 8 }}>
              {[
                { l: 'Pengguna terdaftar', v: (st?.users ?? 0).toLocaleString('id-ID') },
                { l: 'Merchant terdaftar', v: (st?.merchants_total ?? 0).toLocaleString('id-ID') },
                { l: 'Toko AntarShop aktif', v: (extra?.stores ?? 0).toLocaleString('id-ID') },
                { l: 'Pasar AntarMarket aktif', v: (extra?.markets ?? 0).toLocaleString('id-ID') },
                { l: 'Permintaan travel terbuka', v: (extra?.travelOpen ?? 0).toLocaleString('id-ID') },
              ].map((x) => (
                <Row key={x.l} between><Text style={font.body} numberOfLines={1}>{x.l}</Text><Text style={font.mono}>{x.v}</Text></Row>
              ))}
            </View>
          </Panel>
        </Col>
      </Grid>
    </AdminPage>
  );
}

/** Baris di dalam panel dashboard — tinggi seragam seperti baris tabel. */
const rowStyle = {
  flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10,
  paddingHorizontal: adminSpace.lg, paddingVertical: 10, minHeight: 52,
  borderBottomWidth: 1, borderBottomColor: adminTone.border,
};
