// Rute audio panggilan untuk Android & iOS — memakai expo-audio (paket resmi Expo SDK 57).
//
// KENAPA expo-audio, bukan react-native-incall-manager:
//   react-native-webrtc v124 tidak lagi menyertakan InCallManager dan tidak mengekspor API rute audio
//   apa pun. Yang dibutuhkan sebenarnya cuma AudioManager (Android) / AVAudioSession (iOS), dan
//   expo-audio `setAudioModeAsync` sudah membukanya lewat opsi `shouldRouteThroughEarpiece`.
//   Karena expo-audio adalah paket resmi SDK 57 (bundledNativeModules: ~57.0.4), autolinking dan
//   prebuild jalan tanpa konfigurasi tambahan — tidak perlu modul pihak ketiga yang belum tentu
//   kompatibel dengan React Native 0.86 / arsitektur baru.
//
// BUKTI mekanismenya nyata (dibaca langsung dari sumber paket yang terpasang):
//   node_modules/expo-audio/android/src/main/java/expo/modules/audio/AudioModule.kt:917-921
//     audioManager.mode = if (playThroughEarpiece) MODE_IN_COMMUNICATION else MODE_NORMAL
//     audioManager.setSpeakerphoneOn(!playThroughEarpiece)
//   node_modules/expo-audio/ios/AudioModule.swift:801-804
//     category .playAndRecord + (!shouldRouteThroughEarpiece → categoryOptions.insert(.defaultToSpeaker))
//   Jadi setSpeaker(true) → speakerphone menyala, setSpeaker(false) → earpiece. Nyata, bukan klaim.
//
// CATATAN JUJUR: di iOS `shouldRouteThroughEarpiece` hanya berlaku bila kategori sesi
// `.playAndRecord` (allowsRecording = true) — itulah sebabnya startCallAudio() selalu menyalakannya.
// react-native-webrtc juga menyentuh AVAudioSession saat panggilan berlangsung; bila kelak terlihat
// rute iOS "melawan balik", solusinya menyetel ulang rute setelah track remote tiba (setSpeaker
// memang aman dipanggil berkali-kali).
import { Platform } from 'react-native';

type AudioMode = {
  playsInSilentMode?: boolean;
  allowsRecording?: boolean;
  shouldRouteThroughEarpiece?: boolean;
  shouldPlayInBackground?: boolean;
  interruptionMode?: 'mixWithOthers' | 'doNotMix' | 'duckOthers';
};
type ExpoAudio = { setAudioModeAsync: (m: AudioMode) => Promise<void> };

let mod: ExpoAudio | null = null;
try { mod = require('expo-audio') as ExpoAudio; } catch { mod = null; }

/** Benar-benar didukung hanya bila modul native expo-audio ikut ter-build (bukan Expo Go lama). */
export const speakerSupported = typeof mod?.setAudioModeAsync === 'function';

// Loudspeaker adalah bawaan panggilan di aplikasi ini (sama seperti perilaku sebelumnya di Android).
let speakerOn = true;
let inCall = false;

/** Terapkan mode audio sesuai keadaan sekarang. Melempar bila expo-audio menolak. */
async function apply(): Promise<void> {
  if (!mod) throw new Error('expo-audio tidak tersedia');
  await mod.setAudioModeAsync({
    // playsInSilentMode WAJIB true saat allowsRecording true (iOS melempar bila tidak).
    playsInSilentMode: true,
    allowsRecording: inCall,
    // inti perpindahan rute: earpiece = kebalikan dari loudspeaker
    shouldRouteThroughEarpiece: inCall ? !speakerOn : false,
    shouldPlayInBackground: false,
    interruptionMode: 'doNotMix',
  });
}

export function getSpeaker(): boolean { return speakerOn; }

export async function setSpeaker(on: boolean): Promise<boolean> {
  if (!speakerSupported) return false;
  const prev = speakerOn;
  speakerOn = on;
  try { await apply(); return true; }
  catch { speakerOn = prev; return false; }   // gagal → status tidak boleh berbohong ke UI
}

export async function startCallAudio(): Promise<void> {
  if (!speakerSupported) return;
  inCall = true;
  try { await apply(); } catch { /* best-effort: panggilan tetap jalan dengan rute bawaan */ }
}

export async function stopCallAudio(): Promise<void> {
  if (!speakerSupported) return;
  inCall = false;
  speakerOn = true;                            // siap untuk panggilan berikutnya
  try { await apply(); } catch { /* noop */ }
}

// Hanya untuk log/diagnostik.
export const routeBackend = speakerSupported ? `expo-audio (${Platform.OS})` : 'tidak tersedia';
