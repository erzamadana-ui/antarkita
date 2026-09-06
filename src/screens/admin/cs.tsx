// Admin · CS & Tiket — antrean aduan pelanggan/driver/merchant, chat CS online, SOS
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, useWindowDimensions, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeInDown, FadeOut, LinearTransition } from 'react-native-reanimated';
import { AdminPage, StatCard, FilterBar, adminFont as font, adminTone, EmptyState as Empty } from '@/components/admin';
import { Row, Badge, Button, toast, Input, Chip, Avatar } from '@/components/ui';
import { LiveDot, PressableScale } from '@/components/motion';
import { TicketChat } from '@/components/TicketChat';
import { useTicket } from '@/hooks/useTickets';
import { useLocalSearchParams } from 'expo-router';
import { rpc, supabase, realtimeChannel } from '@/lib/supabase';
import { useAuth } from '@/store/auth';
import { colors, radius, glass, motion, shadow } from '@/lib/theme';
import { timeAgo, formatDate, ticketStatusLabel, ticketStatusColor, ticketCategoryLabel, ticketPriorityLabel, ticketPriorityColor, roleLabelId } from '@/lib/format';
import type { Ticket, Profile, SosAlert, TicketStatus, TicketPriority } from '@/lib/types';

type Stats = { open: number; in_progress: number; resolved: number; urgent: number; avg_first_response_min: number | null; avg_rating: number | null; sos_open: number };

export default function AdminSupport() {
  const { width } = useWindowDimensions();
  const wide = width >= 1000;
  const me = useAuth((s) => s.session?.user.id);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [sos, setSos] = useState<SosAlert[]>([]);
  const [filter, setFilter] = useState('active');
  const [q, setQ] = useState('');
  const params = useLocalSearchParams<{ ticket?: string }>();
  const [selected, setSelected] = useState<string | null>(typeof params.ticket === 'string' ? params.ticket : null);
  // Deep link dari tombol "Chat" di halaman lain: /(admin)/cs?ticket=<id>
  useEffect(() => { const t = typeof params.ticket === 'string' ? params.ticket : null; if (t) setSelected(t); }, [params.ticket]);

  const load = useCallback(async () => {
    const [{ data: t }, st, { data: so }] = await Promise.all([
      supabase.from('tickets').select('*').order('last_message_at', { ascending: false }).limit(300),
      rpc<Stats>('cs_stats'),
      supabase.from('sos_alerts').select('*').order('created_at', { ascending: false }).limit(20),
    ]);
    const list = (t as Ticket[]) ?? [];
    const ids = Array.from(new Set([...list.map((x) => x.user_id), ...list.map((x) => x.assigned_to).filter(Boolean), ...((so as SosAlert[]) ?? []).map((x) => x.user_id)])) as string[];
    const { data: profiles } = ids.length ? await supabase.from('profiles').select('*').in('id', ids) : { data: [] };
    const pm = new Map(((profiles as Profile[]) ?? []).map((p) => [p.id, p]));
    setTickets(list.map((x) => ({ ...x, user: pm.get(x.user_id) ?? null, assignee: x.assigned_to ? pm.get(x.assigned_to) ?? null : null })));
    setSos(((so as SosAlert[]) ?? []).map((a) => ({ ...a, user: pm.get(a.user_id) ?? null })));
    setStats(st);
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const ch = realtimeChannel('admin-cs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sos_alerts' }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  const shown = useMemo(() => tickets.filter((t) => {
    const f = filter === 'active' ? !['resolved', 'closed'].includes(t.status) : filter === 'mine' ? t.assigned_to === me && !['closed'].includes(t.status) : filter === 'urgent' ? ['urgent', 'high'].includes(t.priority) && !['closed', 'resolved'].includes(t.status) : filter === 'done' ? ['resolved', 'closed'].includes(t.status) : true;
    const s = !q || t.subject.toLowerCase().includes(q.toLowerCase()) || t.code.toLowerCase().includes(q.toLowerCase()) || (t.user?.full_name ?? '').toLowerCase().includes(q.toLowerCase());
    return f && s;
  }).sort((a, b) => (PRIO[b.priority] - PRIO[a.priority]) || (b.last_message_at > a.last_message_at ? 1 : -1)), [tickets, filter, q, me]);
  const openSos = sos.filter((a) => a.status === 'open');

  const handleSos = async (a: SosAlert, status: 'handled' | 'false_alarm') => {
    try { await rpc('admin_handle_sos', { p_id: a.id, p_status: status, p_note: status === 'handled' ? 'Ditangani CS' : 'Alarm palsu' }); toast.success('SOS diperbarui'); load(); if (a.ticket_id) setSelected(a.ticket_id); } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <AdminPage title="CS & Tiket Aduan" subtitle="Pelanggan · Driver · Merchant — tindak lanjut CS online" onRefresh={load}
      right={<Row gap={6}><LiveDot color={colors.success} size={8} /><Text style={font.tiny}>Realtime</Text></Row>}>
      {openSos.length > 0 && (
        <Animated.View entering={FadeInDown.duration(motion.base)} style={[s.sos, shadow.glow(colors.danger)]}>
          <Row gap={10}><Ionicons name="warning" size={22} color="#fff" /><Text style={{ color: '#fff', fontWeight: '800', fontSize: 15, flex: 1 }}>🚨 {openSos.length} SOS AKTIF — segera hubungi & tangani</Text></Row>
          {openSos.map((a) => (
            <Row key={a.id} between style={s.sosRow}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: '#fff', fontWeight: '800' }}>{a.user?.full_name ?? 'Pengguna'} · {roleLabelId[a.role]}</Text>
                <Text style={{ color: 'rgba(255,255,255,0.9)', fontSize: 12 }}>{timeAgo(a.created_at)}{a.note ? ` · ${a.note}` : ''}{a.lat ? ` · ${a.lat.toFixed(4)},${a.lng?.toFixed(4)}` : ''}</Text>
              </View>
              <Row gap={6}>
                {!!a.lat && <Button size="sm" title="Peta" variant="glass" color="#fff" icon="map" onPress={() => Linking.openURL(`https://www.google.com/maps?q=${a.lat},${a.lng}`)} />}
                {!!a.ticket_id && <Button size="sm" title="Chat" color="#0B1F2A" icon="chatbubbles" onPress={() => setSelected(a.ticket_id)} />}
                <Button size="sm" title="Ditangani" color={colors.success} onPress={() => handleSos(a, 'handled')} />
                <Button size="sm" title="Palsu" variant="glass" color="#fff" onPress={() => handleSos(a, 'false_alarm')} />
              </Row>
            </Row>
          ))}
        </Animated.View>
      )}
      <Row gap={12} style={{ flexWrap: 'wrap' }}>
        <StatCard label="Terbuka" value={stats?.open ?? 0} color={colors.warning} index={0} />
        <StatCard label="Ditangani" value={stats?.in_progress ?? 0} color={colors.info} index={1} />
        <StatCard label="Darurat" value={stats?.urgent ?? 0} color={colors.danger} index={2} />
        <StatCard label="Selesai 7 hari" value={stats?.resolved ?? 0} color={colors.success} index={3} />
        <StatCard label="Respons pertama" value={stats?.avg_first_response_min != null ? `${stats.avg_first_response_min} mnt` : '—'} hint="rata-rata 30 hari" color={colors.primary} index={4} />
        <StatCard label="Kepuasan" value={stats?.avg_rating != null ? `${stats.avg_rating}/5` : '—'} color={colors.accent} index={5} />
      </Row>
      <View style={{ flexDirection: wide ? 'row' : 'column', gap: 16, alignItems: 'flex-start' }}>
        <View style={{ flex: wide ? 1 : undefined, width: wide ? undefined : '100%', gap: 10 }}>
          <Row gap={10} style={{ flexWrap: 'wrap' }}>
            <FilterBar value={filter} onChange={setFilter} options={[{ key: 'active', label: 'Aktif' }, { key: 'mine', label: 'Saya tangani' }, { key: 'urgent', label: 'Prioritas' }, { key: 'done', label: 'Selesai' }, { key: 'all', label: 'Semua' }]} />
            <Input placeholder="Cari kode / judul / nama" value={q} onChangeText={setQ} icon="search" containerStyle={{ minWidth: 220, flex: 1 }} />
          </Row>
          {shown.length === 0 && <Empty icon="checkmark-done-outline" title="Antrean kosong" subtitle="Tidak ada tiket pada filter ini." />}
          {shown.map((t) => (
            <PressableScale key={t.id} onPress={() => setSelected(t.id)} scaleTo={0.99} style={[s.row, selected === t.id && { borderColor: colors.primary, backgroundColor: colors.primary + '0D' }, t.priority === 'urgent' && { borderLeftWidth: 4, borderLeftColor: colors.danger }]}>
              <Avatar name={t.user?.full_name} url={t.user?.avatar_url} size={38} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Row between>
                  <Text style={{ fontWeight: '800', color: colors.text, flex: 1 }} numberOfLines={1}>{t.subject}</Text>
                  <Text style={font.tiny}>{timeAgo(t.last_message_at)}</Text>
                </Row>
                <Text style={font.tiny} numberOfLines={1}>{t.code} · {t.user?.full_name ?? '—'} ({roleLabelId[t.role]}) · {ticketCategoryLabel[t.category]}</Text>
                <Row gap={6} style={{ marginTop: 4, flexWrap: 'wrap' }}>
                  <Badge text={ticketStatusLabel[t.status]} color={ticketStatusColor(t.status)} />
                  <Badge text={ticketPriorityLabel[t.priority]} color={ticketPriorityColor(t.priority)} />
                  {!!t.assignee && <Text style={font.tiny}>👤 {t.assignee.full_name.split(' ')[0]}</Text>}
                  {!t.first_response_at && !['closed'].includes(t.status) && <Text style={[font.tiny, { color: colors.danger, fontWeight: '700' }]}>belum dibalas</Text>}
                </Row>
              </View>
            </PressableScale>
          ))}
        </View>
        <View style={{ flex: wide ? 1.2 : undefined, width: wide ? undefined : '100%', minHeight: 520 }}>
          {selected ? <TicketPanel key={selected} id={selected} onClose={() => setSelected(null)} onChanged={load} /> : (
            <View style={[s.panel, { alignItems: 'center', justifyContent: 'center', minHeight: 320 }]}><Empty icon="chatbubbles-outline" title="Pilih tiket" subtitle="Balasan Anda langsung tampil di aplikasi pengguna (realtime)." /></View>
          )}
        </View>
      </View>
    </AdminPage>
  );
}
const PRIO: Record<string, number> = { urgent: 3, high: 2, normal: 1, low: 0 };

function TicketPanel({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { ticket, messages, reply, reload } = useTicket(id);
  const me = useAuth((s) => s.session?.user.id);
  const [user, setUser] = useState<Profile | null>(null);
  const [orderCode, setOrderCode] = useState<string | null>(null);
  useEffect(() => {
    if (!ticket) return;
    supabase.from('profiles').select('*').eq('id', ticket.user_id).maybeSingle().then(({ data }) => setUser((data as Profile) ?? null));
    if (ticket.order_id) supabase.from('orders').select('code').eq('id', ticket.order_id).maybeSingle().then(({ data }) => setOrderCode((data as { code: string } | null)?.code ?? null));
  }, [ticket?.user_id, ticket?.order_id]); // eslint-disable-line react-hooks/exhaustive-deps
  const update = async (patch: { status?: TicketStatus; priority?: TicketPriority; assign?: boolean }) => {
    try { await rpc('admin_update_ticket', { p_ticket: id, p_status: patch.status ?? null, p_priority: patch.priority ?? null, p_assign_to: patch.assign ? me : null }); await reload(); onChanged(); }
    catch (e) { toast.error((e as Error).message); }
  };
  if (!ticket) return <View style={s.panel}><Text style={font.small}>Memuat…</Text></View>;
  return (
    <Animated.View entering={FadeInDown.duration(motion.base)} exiting={FadeOut.duration(motion.fast)} layout={LinearTransition.springify().stiffness(280).damping(20)} style={s.panel}>
      <View style={s.panelHead}>
        <Row between>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={font.h3} numberOfLines={2}>{ticket.subject}</Text>
            <Text style={font.tiny}>{ticket.code} · {ticketCategoryLabel[ticket.category]} · dibuat {formatDate(ticket.created_at)}{orderCode ? ` · pesanan ${orderCode}` : ''}</Text>
          </View>
          <Pressable onPress={onClose} style={s.close}><Ionicons name="close" size={20} color={colors.textSecondary} /></Pressable>
        </Row>
        <Row gap={10} style={{ marginTop: 8 }}>
          <Avatar name={user?.full_name} url={user?.avatar_url} size={34} />
          <View style={{ flex: 1 }}><Text style={{ fontWeight: '700', color: colors.text, fontSize: 13 }}>{user?.full_name ?? '—'} · {roleLabelId[ticket.role]}</Text><Text style={font.tiny}>{user?.email ?? ''} {user?.phone ? `· ${user.phone}` : ''}</Text></View>
          {!!ticket.rating && <Badge text={`Nilai ${ticket.rating}/5`} color={colors.accent} />}
        </Row>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, marginTop: 10 }}>
          {ticket.assigned_to !== me && <Chip label="Ambil tiket ini" color={colors.info} onPress={() => update({ assign: true })} />}
          {(['open', 'in_progress', 'waiting_user', 'resolved', 'closed'] as TicketStatus[]).map((st) => <Chip key={st} label={ticketStatusLabel[st]} active={ticket.status === st} color={ticketStatusColor(st)} onPress={() => update({ status: st })} />)}
          <View style={{ width: 10 }} />
          {(['low', 'normal', 'high', 'urgent'] as TicketPriority[]).map((p) => <Chip key={p} label={ticketPriorityLabel[p]} active={ticket.priority === p} color={ticketPriorityColor(p)} onPress={() => update({ priority: p })} />)}
        </ScrollView>
      </View>
      <TicketChat ticket={ticket} messages={messages} asCs onSend={async (b, a, internal) => { await reply(b, a, internal); onChanged(); }} style={{ minHeight: 380 }} />
    </Animated.View>
  );
}

const s = StyleSheet.create({
  sos: { backgroundColor: colors.danger, borderRadius: radius.xl, padding: 14, gap: 8 },
  sosRow: { backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: radius.md, padding: 10, flexWrap: 'wrap', gap: 8 },
  row: { flexDirection: 'row', gap: 10, alignItems: 'center', padding: 10, borderRadius: radius.lg, backgroundColor: adminTone.surface, borderWidth: 1, borderColor: adminTone.border },
  panel: { backgroundColor: adminTone.surface, borderRadius: radius.xl, borderWidth: 1, borderColor: adminTone.border, overflow: 'hidden', minHeight: 520 },
  panelHead: { padding: 14, borderBottomWidth: 1, borderBottomColor: adminTone.border, backgroundColor: adminTone.surface },
  close: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(11,31,42,0.06)', alignItems: 'center', justifyContent: 'center' },
});
