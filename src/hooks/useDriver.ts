import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase, rpc, realtimeChannel } from '@/lib/supabase';
import { useAuth } from '@/store/auth';
import { useWatchLocation } from './useLocation';
import type { AvailableOrder, Driver, LatLng, Order } from '@/lib/types';

/** Status online driver + siaran lokasi + daftar order tersedia + order aktif. */
export function useDriverSession() {
  const { driver, loadProfile, session } = useAuth();
  const uid = session?.user.id;
  const [available, setAvailable] = useState<AvailableOrder[]>([]);
  const [active, setActive] = useState<Order | null>(null);
  const [busy, setBusy] = useState(false);
  const [myPos, setMyPos] = useState<(LatLng & { heading: number | null }) | null>(driver?.lat && driver.lng ? { lat: driver.lat, lng: driver.lng, heading: driver.heading } : null);
  const lastSent = useRef(0);
  const online = !!driver?.is_online;

  // Siarkan lokasi saat online (maks. tiap 4 dtk)
  useWatchLocation(online, async (p) => {
    setMyPos(p);
    const now = Date.now();
    if (now - lastSent.current < 4000) return;
    lastSent.current = now;
    try { await rpc('driver_update_location', { p_lat: p.lat, p_lng: p.lng, p_heading: p.heading }); } catch { /* abaikan */ }
  });

  const loadActive = useCallback(async () => {
    if (!uid) return;
    const { data } = await supabase.from('orders').select('*, order_items(*), merchant:merchants(id,name,address,image_url,lat,lng,rating_avg,prep_minutes)')
      .eq('driver_id', uid).in('status', ['accepted', 'arrived', 'in_progress']).order('created_at', { ascending: false }).limit(1).maybeSingle();
    setActive((data as unknown as Order) ?? null);
  }, [uid]);

  const loadAvailable = useCallback(async () => {
    if (!online) { setAvailable([]); return; }
    const { data } = await supabase.rpc('driver_available_orders');
    setAvailable((data as AvailableOrder[]) ?? []);
  }, [online]);

  useEffect(() => { loadActive(); loadAvailable(); }, [loadActive, loadAvailable]);
  useEffect(() => {
    if (!uid) return;
    const ch = realtimeChannel(`driver-feed-${uid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => { loadAvailable(); loadActive(); })
      .subscribe();
    const t = setInterval(() => { loadAvailable(); loadActive(); }, 7000);
    return () => { supabase.removeChannel(ch); clearInterval(t); };
  }, [uid, loadAvailable, loadActive]);

  const setOnline = async (on: boolean, pos?: { lat: number; lng: number }) => {
    setBusy(true);
    try { await rpc<Driver>('driver_set_online', { p_online: on, p_lat: pos?.lat ?? null, p_lng: pos?.lng ?? null }); await loadProfile(); }
    finally { setBusy(false); }
  };
  const accept = async (orderId: string) => { const o = await rpc<Order>('driver_accept_order', { p_order_id: orderId }); await loadActive(); await loadAvailable(); return o; };

  return { driver, online, busy, setOnline, available, active, accept, myPos, setMyPos, reloadActive: loadActive, reloadAvailable: loadAvailable };
}
