// Admin · Log Aktivitas — jejak semua kejadian (pesanan, driver, merchant, saldo, tarif, tiket, SOS) realtime
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import { AdminPage, FilterBar, StatCard, adminFont as font, adminTone, EmptyState as Empty } from '@/components/admin';
import { Row, Badge, Input, Chip, Button } from '@/components/ui';
import { LiveDot, PressableScale } from '@/components/motion';
import { supabase, realtimeChannel } from '@/lib/supabase';
import { colors, radius, motion } from '@/lib/theme';
import { formatDate, timeAgo, roleLabelId } from '@/lib/format';
import type { AuditLog } from '@/lib/types';

const ENTITIES: { key: string; label: string; icon: string; color: string }[] = [
  { key: 'all', label: 'Semua', icon: 'list', color: colors.primary },
  { key: 'orders', label: 'Pesanan', icon: 'receipt', color: colors.ride },
  { key: 'drivers', label: 'Driver', icon: 'bicycle', color: colors.info },
  { key: 'merchants', label: 'Merchant', icon: 'storefront', color: colors.food },
  { key: 'wallet_transactions', label: 'Saldo', icon: 'wallet', color: colors.success },
  { key: 'payments', label: 'Gateway', icon: 'card', color: colors.pay },
  { key: 'tickets', label: 'Tiket', icon: 'chatbubbles', color: colors.accent },
  { key: 'sos_alerts', label: 'SOS', icon: 'warning', color: colors.danger },
  { key: 'pricing', label: 'Tarif & promo', icon: 'pricetags', color: colors.warning },
  { key: 'profiles', label: 'Pengguna', icon: 'people', color: colors.textSecondary },
];
const entityOf = (e: string) => ENTITIES.find((x) => x.key === e) ?? (['pricing_sessions', 'promos', 'app_settings', 'competitor_prices'].includes(e) ? ENTITIES.find((x) => x.key === 'pricing')! : e === 'merchant_documents' ? ENTITIES.find((x) => x.key === 'merchants')! : ['topup_requests', 'withdrawal_requests'].includes(e) ? ENTITIES.find((x) => x.key === 'wallet_transactions')! : ENTITIES[0]);
const RANGES = [{ key: '1h', label: '1 jam', ms: 3600e3 }, { key: '24h', label: '24 jam', ms: 86400e3 }, { key: '7d', label: '7 hari', ms: 7 * 86400e3 }, { key: '30d', label: '30 hari', ms: 30 * 86400e3 }];

export default function AdminActivity() {
  const [rows, setRows] = useState<AuditLog[]>([]);
  const [entity, setEntity] = useState('all');
  const [range, setRange] = useState('24h');
  const [role, setRole] = useState('all');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const [live, setLive] = useState(true);

  const load = useCallback(async () => {
    const since = new Date(Date.now() - (RANGES.find((r) => r.key === range)?.ms ?? 86400e3)).toISOString();
    let qq = supabase.from('audit_logs').select('*').gte('created_at', since).order('id', { ascending: false }).limit(500);
    if (entity !== 'all') {
      const group = entity === 'pricing' ? ['pricing', 'pricing_sessions', 'promos', 'app_settings', 'competitor_prices'] : entity === 'merchants' ? ['merchants', 'merchant_documents'] : entity === 'wallet_transactions' ? ['wallet_transactions', 'topup_requests', 'withdrawal_requests'] : [entity];
      qq = qq.in('entity', group);
    }
    if (role !== 'all') qq = role === 'system' ? qq.is('actor_id', null) : qq.eq('actor_role', role);
    const { data } = await qq;
    setRows((data as AuditLog[]) ?? []);
  }, [entity, range, role]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!live) return;
    const ch = realtimeChannel('admin-audit').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'audit_logs' }, ({ new: row }) => {
      const r = row as AuditLog;
      setRows((p) => (p.some((x) => x.id === r.id) ? p : [r, ...p].slice(0, 600)));
    }).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [live]);

  const shown = useMemo(() => rows.filter((r) => !q || (r.summary ?? '').toLowerCase().includes(q.toLowerCase()) || r.action.includes(q.toLowerCase()) || (r.actor_name ?? '').toLowerCase().includes(q.toLowerCase()) || (r.entity_id ?? '').includes(q)), [rows, q]);
  const counts = useMemo(() => ({
    orders: rows.filter((r) => r.entity === 'orders').length,
    admin: rows.filter((r) => r.actor_role === 'admin').length,
    money: rows.filter((r) => r.entity === 'wallet_transactions').length,
    alerts: rows.filter((r) => r.entity === 'sos_alerts' || (r.entity === 'tickets' && r.action === 'ticket.created')).length,
  }), [rows]);

  const exportCsv = () => {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = ['waktu,aktor,peran,aksi,entitas,id,ringkasan', ...shown.map((r) => [r.created_at, r.actor_name, r.actor_role, r.action, r.entity, r.entity_id, r.summary].map(esc).join(','))].join('\n');
    if (typeof document !== 'undefined') { const a = document.createElement('a'); a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv); a.download = `log-aktivitas-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); }
  };

  return (
    <AdminPage title="Log Aktivitas" subtitle={`${rows.length} kejadian · ${RANGES.find((r) => r.key === range)?.label} terakhir`} onRefresh={load}
      right={<Row gap={8}><Pressable onPress={() => setLive(!live)}><Row gap={6}><LiveDot color={live ? colors.success : colors.textMuted} size={8} /><Text style={font.tiny}>{live ? 'Realtime' : 'Jeda'}</Text></Row></Pressable><Button size="sm" variant="outline" title="CSV" icon="download-outline" onPress={exportCsv} /></Row>}>
      <Row gap={12} style={{ flexWrap: 'wrap' }}>
        <StatCard label="Aktivitas pesanan" value={counts.orders} color={colors.ride} index={0} />
        <StatCard label="Aksi admin" value={counts.admin} color={colors.primary} index={1} />
        <StatCard label="Mutasi saldo" value={counts.money} color={colors.success} index={2} />
        <StatCard label="Tiket & SOS baru" value={counts.alerts} color={colors.danger} index={3} />
      </Row>
      <Row gap={8} style={{ flexWrap: 'wrap' }}>{ENTITIES.map((e) => <Chip key={e.key} label={e.label} active={entity === e.key} color={e.color} onPress={() => setEntity(e.key)} />)}</Row>
      <Row gap={10} style={{ flexWrap: 'wrap' }}>
        <FilterBar value={range} onChange={setRange} options={RANGES.map((r) => ({ key: r.key, label: r.label }))} />
        <FilterBar value={role} onChange={setRole} options={[{ key: 'all', label: 'Semua aktor' }, { key: 'admin', label: 'Admin' }, { key: 'customer', label: 'Pelanggan' }, { key: 'driver', label: 'Driver' }, { key: 'merchant', label: 'Merchant' }, { key: 'system', label: 'Sistem' }]} />
        <Input placeholder="Cari ringkasan / aksi / nama / ID" value={q} onChangeText={setQ} icon="search" containerStyle={{ minWidth: 240, flex: 1 }} />
      </Row>
      {shown.length === 0 && <Empty icon="time-outline" title="Belum ada aktivitas" subtitle="Ubah rentang waktu atau filter." />}
      <View style={{ gap: 6 }}>
        {shown.map((r, i) => {
          const e = entityOf(r.entity);
          const danger = r.entity === 'sos_alerts' || r.action.endsWith('.rejected') || r.action.endsWith('.suspended') || r.action.endsWith('.cancelled') || r.action.endsWith('.deactivated');
          return (
            <Animated.View key={r.id} entering={i < 3 ? FadeInDown.duration(motion.base) : undefined} layout={LinearTransition.springify().stiffness(280).damping(20)}>
              <PressableScale onPress={() => setOpen(open === r.id ? null : r.id)} scaleTo={0.995} haptic={false} style={[s.row, danger && { borderLeftWidth: 3, borderLeftColor: colors.danger }]}>
                <View style={[s.icon, { backgroundColor: e.color + '1A' }]}><Ionicons name={e.icon as never} size={16} color={e.color} /></View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ color: colors.text, fontSize: 14, fontWeight: '600' }} numberOfLines={open === r.id ? undefined : 1}>{r.summary ?? r.action}</Text>
                  <Row gap={6} style={{ flexWrap: 'wrap' }}>
                    <Text style={font.tiny}>{timeAgo(r.created_at)} · {formatDate(r.created_at)}</Text>
                    <Badge text={r.action} color={e.color} />
                    <Text style={font.tiny}>{r.actor_name ?? 'Sistem'}{r.actor_role ? ` (${roleLabelId[r.actor_role]})` : ''}</Text>
                  </Row>
                  {open === r.id && r.detail && <Text selectable style={s.detail}>{JSON.stringify(r.detail, null, 1)}</Text>}
                  {open === r.id && r.entity_id && <Text selectable style={font.tiny}>ID: {r.entity_id}</Text>}
                </View>
                <Ionicons name={open === r.id ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />
              </PressableScale>
            </Animated.View>
          );
        })}
      </View>
    </AdminPage>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', gap: 10, alignItems: 'center', padding: 10, borderRadius: radius.md, backgroundColor: adminTone.surface, borderWidth: 1, borderColor: adminTone.border },
  icon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  detail: { fontFamily: 'monospace', fontSize: 12, color: colors.textSecondary, backgroundColor: 'rgba(11,31,42,0.05)', padding: 8, borderRadius: 8, marginTop: 6 },
});
