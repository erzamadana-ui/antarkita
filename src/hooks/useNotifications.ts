import { useCallback, useEffect, useState } from 'react';
import { supabase, rpc, realtimeChannel } from '@/lib/supabase';
import type { AppNotification } from '@/lib/types';

export function useNotifications(uid?: string | null) {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    if (!uid) return;
    const { data } = await supabase.from('notifications').select('*').eq('user_id', uid).order('created_at', { ascending: false }).limit(60);
    setItems((data as AppNotification[]) ?? []); setLoading(false);
  }, [uid]);
  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    if (!uid) return;
    const ch = realtimeChannel(`notif:${uid}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${uid}` }, ({ new: row }) => setItems((p) => [row as AppNotification, ...p])).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [uid]);
  const unread = items.filter((n) => !n.read_at).length;
  const markRead = useCallback(async (ids?: number[]) => { await rpc('notifications_mark_read', { p_ids: ids ?? null }); setItems((p) => p.map((n) => (!ids || ids.includes(n.id) ? { ...n, read_at: n.read_at ?? new Date().toISOString() } : n))); }, []);
  return { items, loading, unread, reload, markRead };
}
