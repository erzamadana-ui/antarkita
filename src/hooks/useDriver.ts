import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase, rpc, realtimeChannel } from '@/lib/supabase';
import { useAuth } from '@/store/auth';
import { notify } from '@/lib/push';
import { useWatchLocation } from './useLocation';
import { offerToAvailable, onDispatchEvent, splitOffers, type DriverOffer } from '@/lib/dispatch';
import type { AvailableOrder, Driver, DriverPriorityInfo, LatLng, Order } from '@/lib/types';

/** 0122: polling feed saat online — penawaran eksklusif hanya 25 dtk, jadi 5 dtk (sebelumnya 7). */
const FEED_POLL_MS = 5000;

/** Status online driver + siaran lokasi + daftar order tersedia + order aktif. */
export function useDriverSession() {
  const { driver, loadProfile, session } = useAuth();
  const uid = session?.user.id;
  const [available, setAvailable] = useState<AvailableOrder[]>([]);
  const [active, setActive] = useState<Order | null>(null);
  const [busy, setBusy] = useState(false);
  const [myPos, setMyPos] = useState<(LatLng & { heading: number | null }) | null>(driver?.lat && driver.lng ? { lat: driver.lat, lng: driver.lng, heading: driver.heading } : null);
  const lastSent = useRef(0);
  // order yang baru saja ditolak: disaring lokal agar tidak sempat muncul lagi dari fetch yang masih berjalan
  const rejected = useRef<Set<string>>(new Set());
  // id order yang sudah pernah terlihat — dipakai agar bunyi "order baru" hanya sekali per order,
  // dan tidak berbunyi pada pemuatan pertama setelah layar dibuka.
  const seen = useRef<Set<string> | null>(null);
  // 0122: id penawaran yang sudah dibunyikan (bunyi khusus sekali per penawaran, walau order sudah pernah terlihat sebagai siaran)
  const seenOffers = useRef<Set<string>>(new Set());
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
    if (!online) { setAvailable([]); seen.current = null; return; }
    const { data } = await supabase.rpc('driver_available_orders');
    const list = ((data as AvailableOrder[]) ?? []).filter((o) => !rejected.current.has(o.id));
    // 0122: penawaran eksklusif baru → bunyi + getar walau pemuatan pertama (driver harus sadar dalam 25 dtk)
    const { offers } = splitOffers(list);
    const freshOffers = offers.filter((o) => o.offer_id && !seenOffers.current.has(o.offer_id));
    freshOffers.forEach((o) => seenOffers.current.add(o.offer_id!));
    // Bunyi + getar "order baru" (hanya saat aplikasi terbuka — lihat catatan di src/lib/push.ts)
    if (seen.current === null) { seen.current = new Set(list.map((o) => o.id)); if (freshOffers.length) notify('order'); }
    else {
      const fresh = list.filter((o) => !seen.current!.has(o.id));
      fresh.forEach((o) => seen.current!.add(o.id));
      if (fresh.length || freshOffers.length) notify('order');
    }
    setAvailable(list);
  }, [online]);

  /** 0122: tarik penawaran aktif saya seketika (dipanggil saat push `order_offer` tiba) dan sisipkan ke feed. */
  const refreshOffer = useCallback(async () => {
    if (!online) return;
    try {
      const f = await rpc<DriverOffer | null>('driver_offer_mine');
      if (!f?.offer_id) return;
      const row = offerToAvailable(f);
      if (!seenOffers.current.has(f.offer_id)) { seenOffers.current.add(f.offer_id); notify('order'); }
      setAvailable((list) => (list.some((o) => o.offer_id === f.offer_id) ? list : [row, ...list.filter((o) => o.id !== row.id)]));
    } catch { /* abaikan: polling 5 dtk menyusul */ }
  }, [online]);

  useEffect(() => { loadActive(); loadAvailable(); }, [loadActive, loadAvailable]);
  useEffect(() => {
    if (!uid) return;
    const ch = realtimeChannel(`driver-feed-${uid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => { loadAvailable(); loadActive(); })
      .subscribe();
    const t = setInterval(() => { loadAvailable(); loadActive(); }, FEED_POLL_MS);
    // push order_offer (src/lib/push.ts) → driver_offer_mine() tanpa menunggu polling
    const off = onDispatchEvent((ev) => { if (ev === 'offer') { void refreshOffer(); } else { loadActive(); loadAvailable(); } });
    return () => { supabase.removeChannel(ch); clearInterval(t); off(); };
  }, [uid, loadAvailable, loadActive, refreshOffer]);

  const setOnline = async (on: boolean, pos?: { lat: number; lng: number }) => {
    setBusy(true);
    try { await rpc<Driver>('driver_set_online', { p_online: on, p_lat: pos?.lat ?? null, p_lng: pos?.lng ?? null }); await loadProfile(); }
    finally { setBusy(false); }
  };
  const accept = async (orderId: string) => { const o = await rpc<Order>('driver_accept_order', { p_order_id: orderId }); await loadActive(); await loadAvailable(); return o; };
  /** 0122: tolak penawaran eksklusif → server langsung menawarkan ke driver berikutnya; baris hilang dari feed. */
  const declineOffer = async (offerId: string, orderId: string, reason?: string | null) => {
    const res = await rpc<{ ok: boolean; next?: { mode?: string } }>('driver_decline_offer', { p_offer: offerId, p_reason: reason?.trim() || null });
    rejected.current.add(orderId);
    setAvailable((list) => list.filter((o) => o.id !== orderId));
    return res;
  };
  /** Tolak/lewati order: server menyembunyikannya permanen untuk driver ini, daftar lokal langsung diperbarui. */
  const reject = async (orderId: string, reason?: string | null) => {
    await rpc('driver_reject_order', { p_order: orderId, p_reason: reason?.trim() || null });
    rejected.current.add(orderId);
    setAvailable((list) => list.filter((o) => o.id !== orderId));
  };

  return { driver, online, busy, setOnline, available, active, accept, reject, declineOffer, refreshOffer, myPos, setMyPos, reloadActive: loadActive, reloadAvailable: loadAvailable };
}

/** Info antrean prioritas driver (rating → jeda melihat order). Dimuat saat online & disegarkan berkala. */
export function useDriverPriority(enabled = true) {
  const [info, setInfo] = useState<DriverPriorityInfo | null>(null);
  const load = useCallback(async () => {
    if (!enabled) return;
    try { setInfo(await rpc<DriverPriorityInfo>('driver_priority_info')); } catch { /* abaikan: kartu prioritas disembunyikan */ }
  }, [enabled]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [enabled, load]);
  return { info, reload: load };
}
