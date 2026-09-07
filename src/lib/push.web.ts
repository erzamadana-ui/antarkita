// Notifikasi versi WEB.
//
// Push notification web (FCM) butuh Firebase JS SDK + service worker + kunci VAPID, sedangkan
// server AntarKita mengirim lewat FCM HTTP v1 dengan token PERANGKAT (Android). Karena itu web
// SENGAJA tidak mendaftarkan token apa pun: tidak ada izin yang diminta, tidak ada paket
// expo-notifications yang ikut ke bundel web (bundel tetap ramping, tanpa peringatan di konsol).
//
// Yang tetap bekerja di web: bunyi + getar DALAM aplikasi lewat src/lib/sound.ts, persis seperti
// sebelumnya. Semua fungsi di bawah punya nama & bentuk yang sama dengan src/lib/push.ts supaya
// pemanggilnya (RootLayout, kotak masuk, useDriver, layar chat) tidak perlu tahu bedanya.
import { play as playSound, startRing, stopRing } from './sound';
import { APP } from './app';
import { notificationData, notifTargetFor } from '@/hooks/useNotifications';

export type NotifyKind = 'order' | 'message' | 'call';

export interface PushStatus {
  registered: boolean;
  permission: 'granted' | 'denied' | 'undetermined' | 'unsupported';
  reason?: string;
}

export const PUSH_UNAVAILABLE_REASON =
  'Push notification belum tersedia di versi web. Buka aplikasi Android agar tetap menerima pemberitahuan saat aplikasi ditutup.';

export const ANDROID_CHANNELS: { id: string; name: string }[] = [];
export const channelFor = (kind: NotifyKind) => (kind === 'call' ? 'panggilan' : 'antarkita');

export function pushAvailable(): boolean { return false; }

const status: PushStatus = { registered: false, permission: 'unsupported', reason: PUSH_UNAVAILABLE_REASON };
export const pushStatus = (): PushStatus => status;

/** Peta tujuan tetap diekspor supaya perilaku & pengujiannya sama di semua platform. */
export function routeForPushData(raw: Record<string, unknown> | null | undefined): string | null {
  const d = (raw ?? {}) as Record<string, unknown>;
  const orderId = typeof d.order_id === 'string' ? d.order_id : undefined;
  if (d.route === 'chat' && orderId) return `/order/${orderId}/chat`;
  if (d.route === 'call') return orderId ? `/order/${orderId}` : null;
  const target = notifTargetFor(notificationData({ data: d, merchant_id: null }));
  if (target) return target.route;
  return APP === 'admin' ? null : '/inbox';
}

export async function ensurePushPermission(_ask = true): Promise<PushStatus['permission']> { return 'unsupported'; }
export async function initPush(): Promise<PushStatus> { return status; }
export async function disposePush(): Promise<void> { /* tidak ada token web */ }
export function attachSignOutHook() { /* tidak ada token yang perlu dilepas di web */ }
export function markNavigationReady() { /* tidak ada ketukan notifikasi sistem di web */ }
export function flushPendingRoute() { /* idem */ }
export function stopPushListeners() { /* idem */ }

export function notify(kind: NotifyKind) {
  if (kind === 'call') { startRing(); return; }
  playSound(kind === 'order' ? 'order' : 'message');
}
export function notifyStopRing() { stopRing(); }

export function pushCapabilities() {
  return {
    platform: 'web' as const,
    app: APP,
    systemNotifications: false,
    inAppSound: true,
    channels: [] as string[],
    registered: false,
    permission: status.permission,
    reason: PUSH_UNAVAILABLE_REASON,
  };
}

export default {
  initPush, disposePush, ensurePushPermission, attachSignOutHook, markNavigationReady,
  notify, notifyStopRing, pushAvailable, pushCapabilities, pushStatus, routeForPushData,
  ANDROID_CHANNELS, channelFor,
};
