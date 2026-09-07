// WebRTC untuk Android/iOS — react-native-webrtc (perlu build native; tidak jalan di Expo Go).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Linking, PermissionsAndroid, Platform } from 'react-native';

let mod: any = null;
try { mod = require('react-native-webrtc'); } catch { mod = null; }
export const supported = !!mod;
export const RTCPeerConnection: any = mod?.RTCPeerConnection;
export const RTCSessionDescription: any = mod?.RTCSessionDescription;
export const RTCIceCandidate: any = mod?.RTCIceCandidate;
export const getUserMedia = (c: any) => mod.mediaDevices.getUserMedia(c);
export function attachRemote(_stream: any) { return () => {}; }   // audio remote diputar otomatis oleh react-native-webrtc

// Rute audio (earpiece ↔ loudspeaker) TIDAK diurus di sini: react-native-webrtc v124 memang tidak
// mengekspor API apa pun untuk itu. Yang mengurusnya sekarang adalah src/lib/audioRoute.native.ts
// dengan expo-audio `setAudioModeAsync({ shouldRouteThroughEarpiece })`.

/**
 * Izin mikrofon Android. react-native-webrtc memang meminta izin sendiri di dalam getUserMedia,
 * tetapi errornya generik ("Permission denied") sehingga pengguna tidak tahu harus berbuat apa.
 * Diminta lebih dulu di sini supaya bisa memberi pesan Indonesia yang jelas, termasuk kasus
 * "jangan tanya lagi" yang hanya bisa dipulihkan lewat Pengaturan.
 */
export async function ensureMicPermission(): Promise<{ ok: boolean; message?: string; blocked?: boolean }> {
  if (Platform.OS !== 'android') return { ok: true };
  try {
    const perm = PermissionsAndroid.PERMISSIONS.RECORD_AUDIO;
    if (await PermissionsAndroid.check(perm)) return { ok: true };
    const res = await PermissionsAndroid.request(perm, {
      title: 'Izin mikrofon',
      message: 'AntarKita memakai mikrofon hanya untuk panggilan suara di dalam aplikasi. Nomor HP Anda tetap tidak dibagikan.',
      buttonPositive: 'Izinkan',
      buttonNegative: 'Nanti',
    });
    if (res === PermissionsAndroid.RESULTS.GRANTED) return { ok: true };
    if (res === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
      return { ok: false, blocked: true, message: 'Izin mikrofon diblokir. Buka Pengaturan › Aplikasi › AntarKita › Izin › Mikrofon, lalu aktifkan untuk menelepon.' };
    }
    return { ok: false, message: 'Izin mikrofon ditolak. Panggilan suara tidak bisa dilakukan tanpa mikrofon.' };
  } catch {
    return { ok: true };   // biarkan getUserMedia yang memutuskan
  }
}

export function openAppSettings() { Linking.openSettings().catch(() => { /* noop */ }); }
