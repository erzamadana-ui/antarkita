import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase, realtimeChannel } from '@/lib/supabase';
import type { Driver, Order, OrderEvent, OrderMessage, Profile } from '@/lib/types';

const ORDER_SELECT = '*, order_items(*), merchant:merchants(id,name,address,image_url,lat,lng,rating_avg,prep_minutes,owner_id)';

/** Ambil satu order + relasi, dan ikuti perubahannya secara realtime (fallback polling 8 dtk). */
export function useOrder(orderId: string | undefined) {
  const [order, setOrder] = useState<Order | null>(null);
  const [driver, setDriver] = useState<Driver | null>(null);
  const [customer, setCustomer] = useState<Profile | null>(null);
  const [events, setEvents] = useState<OrderEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!orderId) return;
    const { data, error } = await supabase.from('orders').select(ORDER_SELECT).eq('id', orderId).maybeSingle();
    if (error) { setError(error.message); setLoading(false); return; }
    const o = data as unknown as Order | null;
    setOrder(o);
    setLoading(false);
    if (o?.driver_id) {
      const [{ data: d }, { data: p }] = await Promise.all([
        supabase.from('drivers').select('*').eq('id', o.driver_id).maybeSingle(),
        supabase.from('profiles').select('*').eq('id', o.driver_id).maybeSingle(),
      ]);
      if (d) setDriver({ ...(d as Driver), profile: (p as Profile) ?? undefined });
    } else setDriver(null);
    if (o) {
      const { data: c } = await supabase.from('profiles').select('*').eq('id', o.customer_id).maybeSingle();
      setCustomer((c as Profile) ?? null);
      const { data: ev } = await supabase.from('order_events').select('*').eq('order_id', o.id).order('id');
      setEvents((ev as OrderEvent[]) ?? []);
    }
  }, [orderId]);

  useEffect(() => { load(); }, [load]);

  // realtime order + lokasi driver
  useEffect(() => {
    if (!orderId) return;
    const ch = realtimeChannel(`order-${orderId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${orderId}` }, () => load())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'order_events', filter: `order_id=eq.${orderId}` }, () => load())
      .subscribe();
    const t = setInterval(load, 8000);
    return () => { supabase.removeChannel(ch); clearInterval(t); };
  }, [orderId, load]);

  const driverId = order?.driver_id;
  useEffect(() => {
    if (!driverId) return;
    const ch = realtimeChannel(`driver-${driverId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'drivers', filter: `id=eq.${driverId}` }, (payload) => {
        setDriver((d) => (d ? { ...d, ...(payload.new as Partial<Driver>) } : d));
      })
      .subscribe();
    const t = setInterval(async () => {
      const { data } = await supabase.from('drivers').select('lat,lng,heading,last_seen_at').eq('id', driverId).maybeSingle();
      if (data) setDriver((d) => (d ? { ...d, ...(data as Partial<Driver>) } : d));
    }, 6000);
    return () => { supabase.removeChannel(ch); clearInterval(t); };
  }, [driverId]);

  return { order, driver, customer, events, loading, error, reload: load };
}

/** Chat dalam order (realtime). */
export function useOrderChat(orderId: string | undefined) {
  const [messages, setMessages] = useState<OrderMessage[]>([]);
  const load = useCallback(async () => {
    if (!orderId) return;
    const { data } = await supabase.from('order_messages').select('*').eq('order_id', orderId).order('id');
    setMessages((data as OrderMessage[]) ?? []);
  }, [orderId]);
  useEffect(() => {
    load();
    if (!orderId) return;
    const ch = realtimeChannel(`chat-${orderId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'order_messages', filter: `order_id=eq.${orderId}` }, (p) => {
        setMessages((m) => (m.some((x) => x.id === (p.new as OrderMessage).id) ? m : [...m, p.new as OrderMessage]));
      })
      .subscribe();
    const t = setInterval(load, 10000);
    return () => { supabase.removeChannel(ch); clearInterval(t); };
  }, [orderId, load]);
  const send = useCallback(async (senderId: string, body: string) => {
    if (!orderId || !body.trim()) return;
    const { error } = await supabase.from('order_messages').insert({ order_id: orderId, sender_id: senderId, body: body.trim() });
    if (error) throw new Error(error.message);
  }, [orderId]);
  return { messages, send, reload: load };
}

/** Daftar order milik pengguna (customer/driver/merchant) — realtime ringan via polling + channel. */
export function useMyOrders(kind: 'customer' | 'driver' | 'merchant', id: string | null | undefined, activeOnly = false) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    if (!id) return;
    let q = supabase.from('orders').select(ORDER_SELECT).order('created_at', { ascending: false }).limit(50);
    if (kind === 'customer') q = q.eq('customer_id', id);
    if (kind === 'driver') q = q.eq('driver_id', id);
    if (kind === 'merchant') q = q.eq('merchant_id', id);
    if (activeOnly) q = q.in('status', ['searching', 'accepted', 'arrived', 'in_progress']);
    const { data } = await q;
    setOrders((data as unknown as Order[]) ?? []);
    setLoading(false);
  }, [id, kind, activeOnly]);
  const loadRef = useRef(load); loadRef.current = load;
  useEffect(() => {
    load();
    if (!id) return;
    const ch = realtimeChannel(`orders-${kind}-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => loadRef.current())
      .subscribe();
    const t = setInterval(() => loadRef.current(), 10000);
    return () => { supabase.removeChannel(ch); clearInterval(t); };
  }, [id, kind, load]);
  return { orders, loading, reload: load };
}
