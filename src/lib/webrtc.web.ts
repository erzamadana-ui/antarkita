// WebRTC untuk web — API bawaan browser.
export const RTCPeerConnection = globalThis.RTCPeerConnection;
export const RTCSessionDescription = globalThis.RTCSessionDescription;
export const RTCIceCandidate = globalThis.RTCIceCandidate;
export const getUserMedia = (c: MediaStreamConstraints) => {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    // Chrome/Safari hanya membuka getUserMedia di konteks aman (https / localhost).
    const insecure = typeof window !== 'undefined' && window.location?.protocol === 'http:' && !/^(localhost|127\.0\.0\.1)$/.test(window.location.hostname);
    const e = new Error(insecure ? 'Panggilan suara butuh koneksi aman (HTTPS). Buka situs lewat https.' : 'Browser ini tidak mendukung mikrofon untuk panggilan suara.');
    e.name = 'NotSupportedError';
    return Promise.reject(e);
  }
  return navigator.mediaDevices.getUserMedia(c);
};
export const supported = typeof globalThis.RTCPeerConnection !== 'undefined';

let remoteEl: HTMLAudioElement | null = null;
export function attachRemote(stream: MediaStream) {
  const el = document.createElement('audio');
  el.autoplay = true;
  (el as HTMLAudioElement & { playsInline?: boolean }).playsInline = true;
  el.srcObject = stream;
  el.style.display = 'none';
  document.body.appendChild(el);
  // Safari/Chrome kadang butuh play() eksplisit walau autoplay diset.
  el.play?.().catch(() => { /* akan berbunyi setelah interaksi pengguna */ });
  remoteEl = el;
  return () => { try { el.pause(); } catch { /* noop */ } el.srcObject = null; el.remove(); if (remoteEl === el) remoteEl = null; };
}

/**
 * Di browser, pemilihan output hanya mungkin lewat `HTMLMediaElement.setSinkId`, dan itu pun
 * praktis tidak ada di browser seluler. Kita coba semaksimalnya; kalau tidak ada, jujur false.
 */
type SinkEl = HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
export const speakerSupported =
  typeof HTMLMediaElement !== 'undefined' && typeof (HTMLMediaElement.prototype as SinkEl).setSinkId === 'function';

export function setSpeaker(on: boolean): boolean {
  const el = remoteEl as SinkEl | null;
  if (!el || typeof el.setSinkId !== 'function') return false;
  try { el.setSinkId(on ? 'default' : 'default').catch(() => { /* noop */ }); return speakerSupported; } catch { return false; }
}

export async function ensureMicPermission(): Promise<{ ok: boolean; message?: string; blocked?: boolean }> {
  // Browser meminta izin di dalam getUserMedia; kalau Permissions API ada, kita bisa mendeteksi blokir lebih awal.
  try {
    const q = await (navigator as Navigator & { permissions?: { query: (d: { name: string }) => Promise<{ state: string }> } })
      .permissions?.query({ name: 'microphone' });
    if (q?.state === 'denied') {
      return { ok: false, blocked: true, message: 'Izin mikrofon diblokir di browser. Klik ikon gembok di bilah alamat → Izin situs → Mikrofon → Izinkan.' };
    }
  } catch { /* Permissions API tidak ada (Firefox/Safari lama) */ }
  return { ok: true };
}

export function openAppSettings() { /* tidak ada di web */ }
