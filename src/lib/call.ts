// Panggilan suara dalam aplikasi (WebRTC) — nomor HP tidak pernah dibagikan (UU PDP).
// Sinyal lewat Supabase Realtime broadcast:
//   call:<userId>      → 'ring' (undangan), 'ringing' (ack: perangkat penerima hidup),
//                        'accept', 'decline', 'busy', 'end'
//   callsig:<callId>   → 'offer', 'answer', 'ice', 'end'
//
// Topik `callsig:<callId>` SENGAJA sama di kedua sisi (itu memang gunanya) — karena itu di sini
// TIDAK dipakai realtimeChannel() dari lib/supabase.ts yang menambah akhiran unik. Yang penting
// dijaga adalah aturan realtime-js: semua `.on()` dipasang SEBELUM `.subscribe()`, dan satu objek
// channel hanya di-subscribe sekali.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { create } from 'zustand';
import { AppState, Platform } from 'react-native';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { useAuth } from '@/store/auth';
import * as rtc from './webrtc';
import * as audioRoute from './audioRoute';
import { startRing, stopRing } from './sound';
import { isNetworkError, reportNetworkError, OFFLINE_MESSAGE } from '@/hooks/useOnline';

export type CallPhase = 'idle' | 'outgoing' | 'incoming' | 'connecting' | 'active' | 'ended';
export interface CallPeer { id: string; name: string; avatar?: string | null; role?: string }

interface CallState {
  phase: CallPhase; callId: string | null; orderId: string | null; peer: CallPeer | null; incomingFrom: CallPeer | null;
  muted: boolean; speaker: boolean; startedAt: number | null; error: string | null; endReason: string | null;
  /** Perangkat lawan sudah membalas 'ringing' → benar-benar berdering di sana. */
  remoteRinging: boolean;
  /** Izin mikrofon diblokir permanen → UI menawarkan buka Pengaturan. */
  micBlocked: boolean;
  listen: () => void;                 // dengarkan panggilan masuk (sekali, di root)
  stopListening: () => void;
  startCall: (peer: CallPeer, orderId?: string | null) => Promise<string | null>;
  accept: () => Promise<void>;
  decline: () => void;
  hangup: (reason?: string) => void;
  toggleMute: () => void;
  /** Pindah earpiece ↔ loudspeaker. Mengembalikan true bila rute BENAR-BENAR berpindah. */
  toggleSpeaker: () => Promise<boolean>;
  reset: () => void;
}

// ICE dasar: STUN publik saja. TURN statis dari env build DIHAPUS (0086): kredensial yang tertanam di APK
// bisa diekstrak siapa pun; TURN kini hanya lewat kredensial berumur pendek dari server (getIceServers).
const ICE_BASE = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];

/**
 * TURN berumur pendek dari server (Cloudflare Realtime lewat Edge Function `turn-credentials`,
 * migrasi 0082). Kredensial di-cache sampai ±10 menit sebelum kedaluwarsa. Kalau server belum
 * dikonfigurasi / jaringan lambat (>4 dtk), panggilan TETAP berjalan dengan ICE_BASE — jangan
 * pernah menggagalkan panggilan hanya karena TURN tidak tersedia.
 */
export type IceServer = { urls: string | string[]; username?: string; credential?: string };
let iceCache: { servers: IceServer[]; expiresAt: number } | null = null;
const ICE_FETCH_MS = 4_000;
export async function getIceServers(): Promise<IceServer[]> {
  if (iceCache && iceCache.expiresAt - Date.now() > 10 * 60_000) return [...ICE_BASE, ...iceCache.servers];
  try {
    const res = await Promise.race([
      supabase.functions.invoke<{ iceServers?: IceServer[]; expiresAt?: number; configured?: boolean }>('turn-credentials', { body: {} }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('turn timeout')), ICE_FETCH_MS)),
    ]);
    const servers = res?.data?.iceServers ?? [];
    if (!res?.error && servers.length) {
      iceCache = { servers, expiresAt: res.data?.expiresAt ?? Date.now() + 60 * 60_000 };
      return [...ICE_BASE, ...servers];
    }
  } catch { /* jatuh ke STUN */ }
  return ICE_BASE;
}
/** Hanya untuk uji: kosongkan cache TURN. */
export const resetIceCache = () => { iceCache = null; };

const SUBSCRIBE_MS = 8_000;    // batas menunggu channel realtime siap
const ACK_MS = 12_000;         // tanpa balasan 'ringing' sekian lama → penerima dianggap tidak aktif
const CALLER_RING_MS = 45_000; // batas berdering di sisi penelepon
const CALLEE_RING_MS = 40_000; // penerima menyerah lebih dulu supaya penelepon dapat pesan 'tidak terjawab'
const ENDED_AUTO_RESET_MS = 15_000;
const BG_GIVEUP_MS = 45_000;   // panggilan yang belum tersambung dan aplikasi di latar belakang → tutup

let inbox: RealtimeChannel | null = null;   // call:<me>
let inboxUid: string | null = null;
let inboxRetry: ReturnType<typeof setTimeout> | null = null;
let inboxAttempt = 0;
let sig: RealtimeChannel | null = null;     // callsig:<callId>
let pc: any = null; let local: any = null; let detachRemote: (() => void) | null = null;
let ringTimer: ReturnType<typeof setTimeout> | null = null;   // batas berdering (kedua sisi)
let ackTimer: ReturnType<typeof setTimeout> | null = null;    // menunggu ack 'ringing'
let endedTimer: ReturnType<typeof setTimeout> | null = null;  // auto-reset dari state 'ended'
let bgTimer: ReturnType<typeof setTimeout> | null = null;
let pendingIce: any[] = [];
let pendingOffer: any = null;
let starting = false;                                          // kunci anti dua startCall bersamaan
let inboxWatch: ReturnType<typeof setInterval> | null = null;  // penjaga: channel panggilan masuk harus tetap 'joined'

/**
 * Penjaga langganan panggilan masuk. Kalau socket realtime mati (ganti jaringan, tidur lama,
 * token disegarkan), channel bisa berakhir 'closed'/'errored' TANPA callback subscribe() dipanggil
 * lagi — akibatnya panggilan masuk hilang diam-diam. Ini gejala utama "telepon tidak berdering".
 */
function startInboxWatchdog() {
  if (inboxWatch) return;
  inboxWatch = setInterval(() => {
    if (!inboxUid) return;
    const st = (inbox as unknown as { state?: string } | null)?.state;
    if (!inbox || st === 'closed' || st === 'errored') {
      const uid = inboxUid;
      try { if (inbox) supabase.removeChannel(inbox); } catch { /* noop */ }
      inbox = null; inboxUid = null;
      if (useAuth.getState().session?.user.id === uid) useCall.getState().listen();
    }
  }, 20_000);
}

const me = () => { const a = useAuth.getState(); return { id: a.session?.user.id ?? '', name: a.profile?.full_name ?? 'Pengguna', avatar: a.profile?.avatar_url ?? null, role: a.profile?.role }; };
const clear = (t: ReturnType<typeof setTimeout> | null) => { if (t) clearTimeout(t); return null; };

// ---------------------------------------------------------------- channel realtime
/** subscribe() sekali dengan batas waktu — tanpa ini, perangkat offline menggantung selamanya. */
function subscribeOnce(ch: RealtimeChannel, ms = SUBSCRIBE_MS) {
  return new Promise<void>((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => { if (!done) { done = true; reject(new Error('Jaringan lambat: sinyal panggilan tidak siap')); } }, ms);
    try {
      ch.subscribe((st, err) => {
        if (done) return;
        if (st === 'SUBSCRIBED') { done = true; clearTimeout(timer); resolve(); }
        else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT' || st === 'CLOSED') { done = true; clearTimeout(timer); reject(err ?? new Error('Sinyal panggilan terputus')); }
      });
    } catch (e) { done = true; clearTimeout(timer); reject(e as Error); }
  });
}

/**
 * Channel keluar ke `call:<peer>`. Dipakai ulang selama panggilan berlangsung: memanggil
 * supabase.channel() dengan topik sama berkali-kali membuat beberapa join untuk satu topik pada
 * satu socket — itulah sumber "kirim sinyal menggantung" pada kode sebelumnya.
 */
const outbox = new Map<string, { ch: RealtimeChannel; ready: Promise<void> }>();
let outboxCloser: ReturnType<typeof setTimeout> | null = null;
async function peerChannel(topic: string) {
  outboxCloser = clear(outboxCloser);
  const hit = outbox.get(topic);
  if (hit) { await hit.ready; return hit.ch; }
  const ch = supabase.channel(topic);
  const ready = subscribeOnce(ch).catch((e) => {
    outbox.delete(topic);
    try { supabase.removeChannel(ch); } catch { /* noop */ }
    throw e;
  });
  outbox.set(topic, { ch, ready });
  await ready;
  return ch;
}
function closeOutbox() {
  outboxCloser = clear(outboxCloser);
  outbox.forEach(({ ch }) => { try { supabase.removeChannel(ch); } catch { /* noop */ } });
  outbox.clear();
}
/** Ditunda sebentar agar 'decline'/'end' yang baru saja dikirim sempat terkirim. */
const scheduleCloseOutbox = () => { outboxCloser = clear(outboxCloser); outboxCloser = setTimeout(closeOutbox, 1200); };

/** Kirim sinyal ke pengguna lain. Mengembalikan false bila gagal (offline / realtime mati). */
async function sendTo(userId: string, event: string, payload: Record<string, unknown>): Promise<boolean> {
  if (!userId) return false;
  try {
    const ch = await peerChannel(`call:${userId}`);
    await ch.send({ type: 'broadcast', event, payload });
    return true;
  } catch (e) { reportNetworkError(e); return false; }
}

async function openSignal(callId: string, onMsg: (ev: string, p: any) => void) {
  if (sig) { try { supabase.removeChannel(sig); } catch { /* noop */ } sig = null; }
  const ch = supabase.channel(`callsig:${callId}`);
  // SEMUA .on() dipasang sebelum subscribe() — realtime-js melarang sebaliknya.
  ['offer', 'answer', 'ice', 'end'].forEach((ev) => ch.on('broadcast', { event: ev }, ({ payload }) => onMsg(ev, payload)));
  await subscribeOnce(ch);
  sig = ch;
}
const sigSend = (event: string, payload: Record<string, unknown>) => { try { sig?.send({ type: 'broadcast', event, payload: { ...payload, from: me().id } }); } catch { /* noop */ } };

// ---------------------------------------------------------------- WebRTC
async function setupPeer(set: (p: Partial<CallState>) => void, get: () => CallState) {
  if (!rtc.supported) throw new Error(Platform.OS === 'web' ? 'Browser ini tidak mendukung panggilan suara' : 'Panggilan suara butuh APK build (tidak tersedia di Expo Go)');
  const perm = await rtc.ensureMicPermission();
  if (!perm.ok) { set({ micBlocked: !!perm.blocked }); throw new Error(perm.message ?? 'Izin mikrofon ditolak'); }
  try { local = await rtc.getUserMedia({ audio: true, video: false }); }
  catch (e) {
    const n = (e as Error).name;
    if (n === 'NotAllowedError' || n === 'SecurityError') { set({ micBlocked: true }); throw new Error('Izin mikrofon ditolak. Izinkan mikrofon lebih dulu untuk menelepon.'); }
    if (n === 'NotFoundError' || n === 'DevicesNotFoundError') throw new Error('Mikrofon tidak ditemukan di perangkat ini.');
    if (n === 'NotReadableError' || n === 'TrackStartError') throw new Error('Mikrofon sedang dipakai aplikasi lain. Tutup aplikasi itu lalu coba lagi.');
    throw new Error((e as Error).message || 'Mikrofon tidak tersedia');
  }
  // TURN diminta SEBELUM peer dibuat: ICE server tidak bisa ditambah setelah RTCPeerConnection ada.
  const iceServers = await getIceServers();
  pc = new rtc.RTCPeerConnection({ iceServers });
  local.getTracks().forEach((t: any) => pc.addTrack(t, local));
  pc.onicecandidate = (e: any) => { if (e?.candidate) sigSend('ice', { candidate: e.candidate }); };
  pc.ontrack = (e: any) => { const stream = e?.streams?.[0]; if (stream) { detachRemote?.(); detachRemote = rtc.attachRemote(stream); } };
  const onState = (st: string | undefined) => {
    if (!st) return;
    if (st === 'connected' || st === 'completed') set({ phase: 'active', startedAt: get().startedAt ?? Date.now(), error: null });
    else if (st === 'failed') { if (get().phase !== 'ended' && get().phase !== 'idle') get().hangup('Koneksi gagal. Periksa jaringan.'); }
    else if (st === 'closed') { if (get().phase !== 'ended' && get().phase !== 'idle') get().hangup('Panggilan berakhir'); }
    // 'disconnected' sengaja TIDAK langsung memutus: WebRTC sering pulih sendiri beberapa detik.
  };
  pc.onconnectionstatechange = () => onState(pc?.connectionState);
  // Sebagian build react-native-webrtc lebih andal melaporkan iceConnectionState.
  pc.oniceconnectionstatechange = () => onState(pc?.iceConnectionState);
  // Sesi audio panggilan: mode komunikasi + rute (earpiece/loudspeaker) sesuai pilihan pengguna.
  // Sengaja tidak menghentikan panggilan bila gagal — suara tetap keluar lewat rute bawaan.
  await audioRoute.startCallAudio();
  set({ speaker: audioRoute.getSpeaker() });
}

function teardown() {
  stopRing();
  audioRoute.stopCallAudio().catch(() => { /* noop */ });
  try { pc?.close(); } catch { /* noop */ }
  try { local?.getTracks?.().forEach((t: any) => t.stop()); } catch { /* noop */ }
  try { detachRemote?.(); } catch { /* noop */ }
  detachRemote = null; pc = null; local = null; pendingIce = []; pendingOffer = null;
  if (sig) { try { supabase.removeChannel(sig); } catch { /* noop */ } sig = null; }
  ringTimer = clear(ringTimer); ackTimer = clear(ackTimer); bgTimer = clear(bgTimer);
  scheduleCloseOutbox();
}

async function flushIce() {
  for (const c of pendingIce) { try { await pc?.addIceCandidate(new rtc.RTCIceCandidate(c)); } catch { /* kandidat basi: abaikan */ } }
  pendingIce = [];
}

const logStatus = (callId: string, patch: Record<string, unknown>) => {
  supabase.from('call_logs').update(patch).eq('id', callId).then(({ error }) => { if (error && isNetworkError(error.message)) reportNetworkError(error.message); });
};

export const useCall = create<CallState>((set, get) => {
  /** Satu-satunya jalan masuk ke state 'ended': selalu bersih + ada jaring pengaman auto-reset. */
  const finish = (reason: string) => {
    teardown();
    set({ phase: 'ended', endReason: reason, remoteRinging: false });
    endedTimer = clear(endedTimer);
    endedTimer = setTimeout(() => { if (useCall.getState().phase === 'ended') useCall.getState().reset(); }, ENDED_AUTO_RESET_MS);
  };

  const handleOffer = async (p: any) => {
    if (!pc) { pendingOffer = p; return; }
    await pc.setRemoteDescription(new rtc.RTCSessionDescription(p.sdp));
    await flushIce();
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    sigSend('answer', { sdp: pc.localDescription });
  };
  const handleIce = async (p: any) => {
    if (pc?.remoteDescription) { try { await pc.addIceCandidate(new rtc.RTCIceCandidate(p.candidate)); } catch { /* noop */ } }
    else pendingIce.push(p.candidate);
  };

  return {
    phase: 'idle', callId: null, orderId: null, peer: null, incomingFrom: null, muted: false,
    speaker: audioRoute.getSpeaker(), startedAt: null, error: null, endReason: null, remoteRinging: false, micBlocked: false,

    // ------------------------------------------------------------ panggilan masuk
    listen: () => {
      const uid = me().id;
      if (!uid) { get().stopListening(); return; }
      if (inbox && inboxUid === uid) return;
      if (inbox) get().stopListening();          // pengguna berganti → channel lama harus dilepas
      inboxUid = uid;
      // Hangatkan cache TURN saat pengguna masuk — supaya saat menelepon tidak menunggu server.
      getIceServers().catch(() => { /* noop */ });
      const ch = supabase.channel(`call:${uid}`);

      ch.on('broadcast', { event: 'ring' }, ({ payload }) => {
        const from = payload?.from as CallPeer | undefined;
        if (!from?.id || !payload?.callId || from.id === uid) return;
        // Sisa state 'ended' dari panggilan sebelumnya JANGAN membuat panggilan baru ditolak 'busy'.
        if (get().phase === 'ended') get().reset();
        if (get().phase !== 'idle') { sendTo(from.id, 'busy', { callId: payload.callId }); return; }
        set({ phase: 'incoming', callId: payload.callId, orderId: payload.orderId ?? null, incomingFrom: from, peer: from, error: null, endReason: null, remoteRinging: false, muted: false, startedAt: null });
        startRing();
        sendTo(from.id, 'ringing', { callId: payload.callId });   // beri tahu penelepon: perangkat hidup
        ringTimer = clear(ringTimer);
        ringTimer = setTimeout(() => {
          if (get().phase !== 'incoming' || get().callId !== payload.callId) return;
          sendTo(from.id, 'decline', { callId: payload.callId, missed: true });
          logStatus(payload.callId, { status: 'missed', ended_at: new Date().toISOString() });
          finish('Tidak terjawab');
        }, CALLEE_RING_MS);
      });

      ch.on('broadcast', { event: 'ringing' }, ({ payload }) => {
        if (get().phase !== 'outgoing' || payload?.callId !== get().callId) return;
        ackTimer = clear(ackTimer);
        set({ remoteRinging: true });
      });

      ch.on('broadcast', { event: 'accept' }, async ({ payload }) => {
        if (get().phase !== 'outgoing' || payload?.callId !== get().callId) return;
        ringTimer = clear(ringTimer); ackTimer = clear(ackTimer);
        set({ phase: 'connecting', remoteRinging: false });
        try {
          await setupPeer(set, get);
          const offer = await pc.createOffer({});
          await pc.setLocalDescription(offer);
          sigSend('offer', { sdp: pc.localDescription });
        } catch (e) { get().hangup((e as Error).message); }
      });

      ch.on('broadcast', { event: 'decline' }, ({ payload }) => {
        if (payload?.callId !== get().callId || get().phase === 'idle') return;
        finish(payload?.missed ? 'Tidak dijawab' : 'Panggilan ditolak');
      });
      ch.on('broadcast', { event: 'busy' }, ({ payload }) => {
        if (payload?.callId !== get().callId || get().phase === 'idle') return;
        if (payload?.callId) logStatus(payload.callId, { status: 'missed', ended_at: new Date().toISOString() });
        finish('Sedang sibuk, coba beberapa saat lagi');
      });
      ch.on('broadcast', { event: 'end' }, ({ payload }) => {
        if (payload?.callId !== get().callId || get().phase === 'idle') return;
        finish(get().phase === 'incoming' ? 'Panggilan dibatalkan' : 'Panggilan berakhir');
      });

      inbox = ch;
      startInboxWatchdog();
      subscribeOnce(ch, 15_000)
        .then(() => { inboxAttempt = 0; })
        .catch(() => {
          // Gagal berlangganan = TIDAK akan pernah ada panggilan masuk. Harus dicoba lagi.
          reportNetworkError();
          if (inbox === ch) { try { supabase.removeChannel(ch); } catch { /* noop */ } inbox = null; }
          const delay = Math.min(30_000, 3_000 * Math.pow(2, Math.min(inboxAttempt++, 4)));
          inboxRetry = clear(inboxRetry);
          inboxRetry = setTimeout(() => { if (me().id === inboxUid) { inboxUid = null; get().listen(); } }, delay);
        });
    },

    stopListening: () => {
      inboxRetry = clear(inboxRetry);
      if (inboxWatch) { clearInterval(inboxWatch); inboxWatch = null; }
      if (inbox) { try { supabase.removeChannel(inbox); } catch { /* noop */ } inbox = null; }
      inboxUid = null; inboxAttempt = 0;
    },

    // ------------------------------------------------------------ panggilan keluar
    startCall: async (peer, orderId = null) => {
      if (starting) return null;
      if (get().phase === 'ended') get().reset();
      if (get().phase !== 'idle') return null;
      const m = me();
      if (!m.id) return null;
      if (!peer?.id) { finish('Kontak tidak ditemukan'); return null; }
      if (peer.id === m.id) { finish('Tidak bisa menelepon diri sendiri'); return null; }
      starting = true;
      getIceServers().catch(() => { /* noop */ });   // paralel dengan sinyal 'ring'; hasilnya di-cache
      try {
        if (!rtc.supported) { finish(Platform.OS === 'web' ? 'Browser ini tidak mendukung panggilan suara' : 'Panggilan suara butuh APK build (tidak tersedia di Expo Go)'); return null; }
        // Minta izin mikrofon SEBELUM membuat log panggilan, supaya penolakan izin tidak
        // meninggalkan panggilan 'ringing' yang menggantung di database.
        const perm = await rtc.ensureMicPermission();
        if (!perm.ok) { set({ micBlocked: !!perm.blocked }); finish(perm.message ?? 'Izin mikrofon ditolak'); return null; }

        const { data, error } = await supabase.from('call_logs')
          .insert({ order_id: orderId, caller_id: m.id, callee_id: peer.id, status: 'ringing' }).select('id').single();
        if (error || !data) {
          const net = isNetworkError(error?.message ?? '');
          if (net) reportNetworkError(error?.message);
          finish(net ? OFFLINE_MESSAGE : (error?.message ?? 'Gagal memulai panggilan'));
          return null;
        }
        const callId = data.id as string;
        set({ phase: 'outgoing', callId, orderId, peer, incomingFrom: null, error: null, endReason: null, muted: false, startedAt: null, remoteRinging: false, micBlocked: false });

        try {
          await openSignal(callId, async (ev, p) => {
            if (!p || p.from === m.id) return;
            if (ev === 'answer' && pc) { await pc.setRemoteDescription(new rtc.RTCSessionDescription(p.sdp)); await flushIce(); }
            else if (ev === 'ice') await handleIce(p);
            else if (ev === 'end') finish('Panggilan berakhir');
          });
        } catch (e) {
          reportNetworkError(e);
          logStatus(callId, { status: 'missed', ended_at: new Date().toISOString() });
          finish(OFFLINE_MESSAGE);
          return null;
        }

        const sent = await sendTo(peer.id, 'ring', { callId, orderId, from: m });
        if (!sent) {
          logStatus(callId, { status: 'missed', ended_at: new Date().toISOString() });
          finish(OFFLINE_MESSAGE);
          return null;
        }

        // Penerima tidak membalas 'ringing' → aplikasinya tidak terbuka / tidak ada jaringan.
        ackTimer = clear(ackTimer);
        ackTimer = setTimeout(() => {
          if (get().phase !== 'outgoing' || get().callId !== callId || get().remoteRinging) return;
          logStatus(callId, { status: 'missed', ended_at: new Date().toISOString() });
          sendTo(peer.id, 'end', { callId });
          finish('Tidak dapat dihubungi — aplikasi penerima sedang tidak aktif');
        }, ACK_MS);

        ringTimer = clear(ringTimer);
        ringTimer = setTimeout(() => { if (get().phase === 'outgoing' && get().callId === callId) get().hangup('Tidak dijawab'); }, CALLER_RING_MS);
        return callId;
      } finally { starting = false; }
    },

    // ------------------------------------------------------------ jawab
    accept: async () => {
      const { callId, incomingFrom, phase } = get();
      if (phase !== 'incoming' || !callId || !incomingFrom) return;
      stopRing();
      ringTimer = clear(ringTimer); ackTimer = clear(ackTimer);
      set({ phase: 'connecting', startedAt: null, remoteRinging: false });
      getIceServers().catch(() => { /* noop */ });
      try {
        // Channel sinyal dibuka LEBIH DULU: kalau dibuka setelah 'accept' terkirim, 'offer' dari
        // penelepon bisa lewat sebelum kita mendengarkan (panggilan diam lalu mati).
        await openSignal(callId, async (ev, p) => {
          if (!p || p.from === me().id) return;
          if (ev === 'offer') await handleOffer(p);
          else if (ev === 'ice') await handleIce(p);
          else if (ev === 'end') finish('Panggilan berakhir');
        });
        await setupPeer(set, get);
        if (pendingOffer) { const p = pendingOffer; pendingOffer = null; await handleOffer(p); }
        const ok = await sendTo(incomingFrom.id, 'accept', { callId });
        if (!ok) throw new Error(OFFLINE_MESSAGE);
        logStatus(callId, { status: 'answered', answered_at: new Date().toISOString() });
      } catch (e) {
        const msg = (e as Error).message;
        set({ error: msg });
        // Beri tahu penelepon supaya tidak berdering sia-sia.
        sendTo(incomingFrom.id, 'decline', { callId });
        logStatus(callId, { status: 'declined', ended_at: new Date().toISOString() });
        finish(msg);
      }
    },

    decline: () => {
      const { callId, incomingFrom, phase } = get();
      if (phase === 'idle' || phase === 'ended') return;
      if (callId && incomingFrom) {
        sendTo(incomingFrom.id, 'decline', { callId });
        logStatus(callId, { status: 'declined', ended_at: new Date().toISOString() });
      }
      finish('Panggilan ditolak');
    },

    hangup: (reason) => {
      const { callId, peer, phase } = get();
      if (phase === 'idle' || phase === 'ended') return;   // idempotent: tombol tutup ganda tidak merusak state
      if (callId) {
        sigSend('end', {});
        if (peer) sendTo(peer.id, 'end', { callId });
        logStatus(callId, {
          status: phase === 'active' || phase === 'connecting' ? 'ended' : phase === 'incoming' ? 'declined' : 'missed',
          ended_at: new Date().toISOString(),
        });
      }
      finish(reason ?? 'Panggilan berakhir');
    },

    toggleMute: () => {
      const m = !get().muted;
      try { local?.getAudioTracks?.().forEach((t: any) => { t.enabled = !m; }); } catch { /* noop */ }
      set({ muted: m });
    },
    /** Mengembalikan true bila rute audio benar-benar berpindah (lihat src/lib/audioRoute.*). */
    toggleSpeaker: async () => {
      if (!audioRoute.speakerSupported) return false;
      const sp = !get().speaker;
      const applied = await audioRoute.setSpeaker(sp);
      // Status UI selalu diambil dari rute yang BENAR-BENAR berlaku, bukan dari niat pengguna.
      set({ speaker: audioRoute.getSpeaker() });
      return applied;
    },

    reset: () => {
      endedTimer = clear(endedTimer);
      teardown();
      set({ phase: 'idle', callId: null, orderId: null, peer: null, incomingFrom: null, muted: false, startedAt: null, error: null, endReason: null, remoteRinging: false, micBlocked: false });
    },
  };
});

// Aplikasi ke latar belakang: nada dering dimatikan (sound.ts), dan panggilan yang BELUM tersambung
// tidak dibiarkan menahan mikrofon/channel selamanya.
AppState.addEventListener('change', (st) => {
  const s = useCall.getState();
  if (st === 'active') { bgTimer = clear(bgTimer); if (inboxUid && !inbox) s.listen(); return; }
  if (s.phase === 'incoming' || s.phase === 'outgoing' || s.phase === 'connecting') {
    bgTimer = clear(bgTimer);
    bgTimer = setTimeout(() => {
      const cur = useCall.getState();
      if (cur.phase === 'incoming' || cur.phase === 'outgoing' || cur.phase === 'connecting') cur.hangup('Panggilan dibatalkan (aplikasi ditutup)');
    }, BG_GIVEUP_MS);
  }
});

export const callSupported = rtc.supported;
/** Apakah tombol speaker benar-benar bisa memindah rute audio di platform ini? */
export const speakerRoutingSupported = audioRoute.speakerSupported;
/** Nama mekanisme rute audio yang dipakai (untuk laporan QC / log). */
export const speakerRoutingBackend = audioRoute.routeBackend;
export const openMicSettings = rtc.openAppSettings;
