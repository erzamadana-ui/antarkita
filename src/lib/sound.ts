// Pembungkus TUNGGAL untuk suara & getar aplikasi.
//
// Kenapa pemutar sendiri: suara di sini adalah data URI kecil (assets/sounds/data.ts) yang harus
// bisa dibunyikan tanpa berkas aset terpisah dan tanpa izin apa pun. expo-audio MEMANG terpasang,
// tetapi dipakai khusus untuk RUTE audio panggilan (src/lib/audioRoute.native.ts), bukan pemutar
// notifikasi. Jadi modul ini tetap:
//   • Web            → elemen <audio> dengan data URI (assets/sounds/data.ts).
//   • Android / iOS  → WebView tersembunyi (react-native-webview SUDAH menjadi dependensi)
//                      yang dipasang oleh <SoundHost/> di src/components/call/SoundHost.tsx.
//   • Bila keduanya tidak tersedia → hanya getar (expo-haptics + Vibration), tanpa error.
//
// Aturan main:
//   • Bunyi notifikasi pendek (order baru / pesan chat) HANYA saat aplikasi di depan —
//     kalau aplikasi tertutup itu wilayah push notification (src/lib/push.ts).
//   • Nada dering panggilan masuk dikecualikan (lihat startRing).
//   • Bisa dimatikan pengguna (setSoundEnabled) dan pilihannya disimpan.
//   • Semua pemanggilan aman dipanggil dari mana saja; kegagalan ditelan (best-effort).
import { AppState, Platform, Vibration } from 'react-native';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SOUNDS, type SoundKind } from '../../assets/sounds/data';

export type { SoundKind };

/** Pemutar khusus platform native, didaftarkan oleh <SoundHost/>. */
export interface NativePlayer { play: (kind: SoundKind, loop: boolean) => void; stop: () => void }

const KEY = 'ak.sound.enabled';
let enabled = true;
let nativePlayer: NativePlayer | null = null;
let ringing = false;          // status yang DIINGINKAN, supaya host yang telat siap bisa menyusul

AsyncStorage.getItem(KEY).then((v) => { if (v === '0') enabled = false; }).catch(() => { /* noop */ });

export function isSoundEnabled() { return enabled; }
export async function setSoundEnabled(on: boolean) {
  enabled = on;
  if (!on) stopRing();
  try { await AsyncStorage.setItem(KEY, on ? '1' : '0'); } catch { /* noop */ }
}

/** Aplikasi sedang di depan mata pengguna? Suara dalam aplikasi hanya boleh saat aktif. */
function foreground() {
  if (Platform.OS === 'web') {
    try { return typeof document === 'undefined' || document.visibilityState !== 'hidden'; } catch { return true; }
  }
  return AppState.currentState === 'active';
}

// ---------------------------------------------------------------- web <audio>
const webEls: Partial<Record<SoundKind, HTMLAudioElement>> = {};
let webUnlocked = false;

function webAudio(kind: SoundKind): HTMLAudioElement | null {
  if (Platform.OS !== 'web' || typeof Audio === 'undefined') return null;
  try {
    let el = webEls[kind];
    if (!el) { el = new Audio(SOUNDS[kind]); el.preload = 'auto'; webEls[kind] = el; }
    return el;
  } catch { return null; }
}

/**
 * Browser memblokir autoplay sampai ada interaksi. Dipanggil sekali dari interaksi pertama
 * pengguna agar nada dering panggilan masuk nanti tidak diblokir.
 */
export function primeAudio() {
  if (Platform.OS !== 'web' || webUnlocked) return;
  webUnlocked = true;
  const el = webAudio('message');
  if (!el) return;
  try {
    const prev = el.volume; el.volume = 0;
    const p = el.play();
    if (p && typeof p.then === 'function') p.then(() => { el.pause(); el.currentTime = 0; el.volume = prev; }).catch(() => { el.volume = prev; });
    else { el.pause(); el.currentTime = 0; el.volume = prev; }
  } catch { /* noop */ }
}
if (Platform.OS === 'web' && typeof window !== 'undefined') {
  const once = () => { primeAudio(); window.removeEventListener('pointerdown', once); window.removeEventListener('keydown', once); };
  try { window.addEventListener('pointerdown', once, { once: true }); window.addEventListener('keydown', once, { once: true }); } catch { /* noop */ }
}

// ------------------------------------------------------------- native (WebView)
/** Dipanggil <SoundHost/> saat WebView siap. Bila ada dering tertunda, langsung disusulkan. */
export function registerNativePlayer(p: NativePlayer | null) {
  nativePlayer = p;
  if (p && ringing && enabled) p.play('ring', true);
}
/** True bila suara (bukan cuma getar) benar-benar bisa diputar di platform ini. */
export function soundOutputAvailable() { return Platform.OS === 'web' ? typeof Audio !== 'undefined' : !!nativePlayer; }

// ------------------------------------------------------------------- getar
async function haptic(kind: SoundKind) {
  try {
    if (kind === 'message') await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    else await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } catch { /* perangkat tanpa haptic / web */ }
}

// -------------------------------------------------------------------- API
/** Bunyi pendek + getar (order baru, pesan chat baru). Aman dipanggil kapan saja. */
export function play(kind: Exclude<SoundKind, 'ring'>) {
  if (!enabled || !foreground()) return;
  haptic(kind);
  if (Platform.OS === 'web') {
    const el = webAudio(kind);
    if (!el) return;
    try { el.loop = false; el.currentTime = 0; const p = el.play(); if (p && typeof p.catch === 'function') p.catch(() => { /* diblokir autoplay */ }); } catch { /* noop */ }
    return;
  }
  try { nativePlayer?.play(kind, false); } catch { /* noop */ }
}

/**
 * Nada dering panggilan masuk: berulang + getar berulang sampai stopRing().
 *
 * SENGAJA tidak memeriksa foreground(). Bunyi notifikasi pendek (play()) dibungkam saat aplikasi
 * di latar belakang karena itu wilayah push notification, tetapi dering panggilan tidak boleh
 * ikut dibungkam: push panggilan bisa telat (antrean push_outbox dikirim pg_cron tiap menit),
 * sedangkan sinyal realtime tiba seketika. Kalau dering ikut dibungkam, panggilan masuk saat
 * pengguna sedang membuka aplikasi lain menjadi senyap dan mustahil dijawab. Dering tetap berhenti
 * sendiri lewat batas waktu panggilan di src/lib/call.ts (dan penjaga 12 detik di push.ts).
 */
export function startRing() {
  if (ringing) return;
  ringing = true;
  // Getar selalu jalan walau suara dimatikan/tidak didukung — panggilan tidak boleh terlewat.
  // Pola [tunda, getar, jeda] dengan repeat=true → berdenyut sampai stopRing().
  try { Vibration.vibrate([0, 600, 900], true); } catch { /* noop */ }
  haptic('ring');
  if (!enabled) return;
  if (Platform.OS === 'web') {
    const el = webAudio('ring');
    if (!el) return;
    try { el.loop = true; el.currentTime = 0; const p = el.play(); if (p && typeof p.catch === 'function') p.catch(() => { /* autoplay diblokir: getar tetap jalan */ }); } catch { /* noop */ }
    return;
  }
  try { nativePlayer?.play('ring', true); } catch { /* noop */ }
}

/** Hentikan nada dering + getar. Idempotent. */
export function stopRing() {
  ringing = false;
  try { Vibration.cancel(); } catch { /* noop */ }
  if (Platform.OS === 'web') {
    const el = webEls.ring;
    if (el) { try { el.pause(); el.loop = false; el.currentTime = 0; } catch { /* noop */ } }
    return;
  }
  try { nativePlayer?.stop(); } catch { /* noop */ }
}

/** Getar singkat tanpa suara (mis. tombol penting saat panggilan). */
export function tap() { try { Haptics.selectionAsync(); } catch { /* noop */ } }


export const sound = { play, startRing, stopRing, tap, primeAudio, isSoundEnabled, setSoundEnabled, soundOutputAvailable, registerNativePlayer };
export default sound;
