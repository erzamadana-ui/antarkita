// Tiket aduan & CS online — daftar tiket, detail + pesan realtime
import { useCallback, useEffect, useState } from 'react';
import { supabase, rpc, realtimeChannel } from '@/lib/supabase';
import type { Ticket, TicketMessage } from '@/lib/types';

export function useMyTickets(userId?: string | null) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase.from('tickets').select('*').eq('user_id', userId).order('last_message_at', { ascending: false }).limit(50);
    setTickets((data as Ticket[]) ?? []); setLoading(false);
  }, [userId]);
  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    if (!userId) return;
    const ch = realtimeChannel(`tickets:${userId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'tickets', filter: `user_id=eq.${userId}` }, reload).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId, reload]);
  const openCount = tickets.filter((t) => !['resolved', 'closed'].includes(t.status)).length;
  const waiting = tickets.filter((t) => t.status === 'waiting_user').length;
  return { tickets, loading, reload, openCount, waiting };
}

export function useTicket(id?: string | null) {
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [messages, setMessages] = useState<TicketMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    if (!id) return;
    const [{ data: t }, { data: m }] = await Promise.all([
      supabase.from('tickets').select('*').eq('id', id).maybeSingle(),
      supabase.from('ticket_messages').select('*').eq('ticket_id', id).order('created_at'),
    ]);
    setTicket((t as Ticket) ?? null); setMessages((m as TicketMessage[]) ?? []); setLoading(false);
  }, [id]);
  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    if (!id) return;
    const ch = realtimeChannel(`ticket:${id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ticket_messages', filter: `ticket_id=eq.${id}` }, ({ new: row }) => setMessages((p) => (p.some((x) => x.id === (row as TicketMessage).id) ? p : [...p, row as TicketMessage])))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tickets', filter: `id=eq.${id}` }, ({ new: row }) => setTicket((p) => ({ ...(p ?? {}), ...(row as Ticket) })))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [id]);
  const reply = useCallback(async (body: string, attachment?: string | null, internal?: boolean) => {
    if (!id) return;
    const m = await rpc<TicketMessage>('ticket_reply', { p_ticket: id, p_body: body, p_attachment: attachment ?? null, p_internal: !!internal });
    setMessages((p) => (p.some((x) => x.id === m.id) ? p : [...p, m]));
    reload();
  }, [id, reload]);
  const close = useCallback(async (rating?: number, comment?: string) => {
    if (!id) return;
    const t = await rpc<Ticket>('close_ticket', { p_ticket: id, p_rating: rating ?? null, p_comment: comment ?? null });
    setTicket(t); reload();
  }, [id, reload]);
  return { ticket, messages, loading, reload, reply, close };
}
