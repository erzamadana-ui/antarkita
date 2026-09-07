// Rute audio panggilan untuk web — perilaku yang sudah ada dipertahankan.
//
// BATASAN NYATA browser: tidak ada konsep "earpiece" di web. Satu-satunya pengaturan keluaran
// adalah HTMLMediaElement.setSinkId (memilih PERANGKAT keluaran, bukan earpiece↔speaker), dan itu
// pun praktis tidak ada di browser seluler. Jadi di web tombol speaker hanya aktif kalau setSinkId
// benar-benar tersedia; kalau tidak, UI menampilkannya nonaktif (bukan pesan error merah).
type SinkEl = HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };

let remoteEl: SinkEl | null = null;
let speakerOn = false;

/** Dipanggil webrtc.web.ts saat elemen <audio> lawan bicara dipasang/dilepas. */
export function registerRemoteAudio(el: HTMLAudioElement | null) { remoteEl = el as SinkEl | null; }

export const speakerSupported =
  typeof HTMLMediaElement !== 'undefined' && typeof (HTMLMediaElement.prototype as SinkEl).setSinkId === 'function';

export function getSpeaker(): boolean { return speakerOn; }

export async function setSpeaker(on: boolean): Promise<boolean> {
  if (!speakerSupported || !remoteEl || typeof remoteEl.setSinkId !== 'function') return false;
  try {
    // 'default' = perangkat keluaran bawaan sistem. Browser tidak mengizinkan memilih earpiece,
    // jadi ini sekadar memastikan audio memakai perangkat bawaan dan volume elemen penuh.
    await remoteEl.setSinkId('default');
    remoteEl.volume = 1;
    speakerOn = on;
    return true;
  } catch { return false; }
}

export async function startCallAudio(): Promise<void> { /* browser mengurus sesi audio sendiri */ }
export async function stopCallAudio(): Promise<void> { speakerOn = false; }

export const routeBackend = speakerSupported ? 'setSinkId (web)' : 'tidak tersedia (web)';
