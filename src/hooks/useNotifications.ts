import { useCallback, useEffect, useState } from 'react';
import { supabase, rpc, realtimeChannel } from '@/lib/supabase';
import { APP } from '@/lib/app';
import type { AppNotification } from '@/lib/types';

/**
 * Isi kolom `notifications.data` yang benar-benar dikirim server (lihat migrasi 0009/0011/0015/0016/0018/0026).
 * Dipakai kotak masuk untuk menentukan tujuan saat notifikasi diketuk.
 */
export interface NotificationData {
  ticket_id?: string;
  order_id?: string;
  travel_request_id?: string;
  booking_id?: string;
  trip_id?: string;
  offer_id?: string;
  payment_id?: string;
  withdrawal_id?: string;
  merchant_id?: string;
  blast_id?: string;
  suggestion_id?: string;
  /** Kode tiket / kode order / kode permintaan travel — hanya untuk ditampilkan. */
  code?: string;
  kind?: string;
  amount?: number;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : typeof v === 'number' ? String(v) : undefined);

/** Baca `data` notifikasi menjadi bentuk bertipe (nilai non-string diabaikan supaya rute tidak pernah "undefined"). */
export function notificationData(n: Pick<AppNotification, 'data' | 'merchant_id'>): NotificationData {
  const d = (n.data ?? {}) as Record<string, unknown>;
  return {
    ticket_id: str(d.ticket_id),
    order_id: str(d.order_id),
    travel_request_id: str(d.travel_request_id),
    booking_id: str(d.booking_id) ?? str(d.travel_booking_id),
    trip_id: str(d.trip_id),
    offer_id: str(d.offer_id),
    payment_id: str(d.payment_id),
    withdrawal_id: str(d.withdrawal_id),
    merchant_id: str(d.merchant_id) ?? n.merchant_id ?? undefined,
    blast_id: str(d.blast_id),
    suggestion_id: str(d.suggestion_id),
    code: str(d.code),
    kind: str(d.kind),
    amount: typeof d.amount === 'number' ? d.amount : undefined,
  };
}

/** Tujuan sebuah notifikasi bila diketuk. `label` dipakai untuk badge "Ketuk untuk membuka …". */
export interface NotifTarget { route: string; label: string }

/**
 * PETA TUJUAN NOTIFIKASI — satu-satunya sumber kebenaran.
 *
 * Dipakai dua tempat sekaligus supaya perilakunya persis sama:
 *   • Kotak masuk (src/screens/inbox) saat kartu notifikasi diketuk.
 *   • Push notification (src/lib/push.ts) saat notifikasi sistem diketuk — payload push memuat
 *     kolom `data` yang sama persis (lihat trigger trg_push_notification di migrasi 0030).
 *
 * Mengembalikan null bila notifikasi tidak punya halaman tujuan (mis. pengumuman umum).
 */
export function notifTargetFor(d: NotificationData, promoCode?: string | null): NotifTarget | null {
  const customer = APP === 'pelanggan';
  // 1. Tiket / percakapan dengan Admin & CS (mis. notifikasi "Pesan dari Admin AntarKita")
  if (d.ticket_id) return { route: `/support/${d.ticket_id}`, label: 'tiket bantuan' };
  // 2. Pesanan
  if (d.order_id) return { route: `/order/${d.order_id}`, label: 'detail pesanan' };
  // 3. AntarTravel — permintaan carter/sopir harian & booking kursi
  if (d.travel_request_id) return customer
    ? { route: `/travel/request/${d.travel_request_id}`, label: 'permintaan travel' }
    : { route: '/driver/travel', label: 'permintaan travel' };
  if (d.booking_id && customer) return { route: `/travel/${d.booking_id}`, label: 'booking travel' };
  // 4. AntarPay (top up, pembayaran gateway, penarikan saldo)
  if (d.payment_id || d.withdrawal_id) return customer
    ? { route: '/(customer)/pay', label: 'AntarPay' }
    : { route: '/(driver)/earnings', label: 'saldo & penghasilan' };
  // 5. Merchant / promo (hanya ada di aplikasi pelanggan)
  if (d.merchant_id && customer) return { route: `/food/${d.merchant_id}`, label: 'merchant' };
  if (promoCode && customer) return { route: '/food', label: 'promo AntarFood' };
  return null;
}

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
