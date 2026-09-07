// Penunjuk tipe; Metro memilih webrtc.web.ts / webrtc.native.ts saat bundling.
/* eslint-disable @typescript-eslint/no-explicit-any */
export const RTCPeerConnection: any = undefined;
export const RTCSessionDescription: any = undefined;
export const RTCIceCandidate: any = undefined;
export const getUserMedia: (c: any) => Promise<any> = async () => { throw new Error('unsupported'); };
export const supported = false;
export function attachRemote(_s: any): () => void { return () => {}; }
/** Rute audio ke loudspeaker. Mengembalikan true bila platform benar-benar bisa mengaturnya. */
export function setSpeaker(_on: boolean): boolean { return false; }
/** Apakah aplikasi bisa memindah rute earpiece ↔ loudspeaker sendiri? */
export const speakerSupported = false;
/** Pastikan izin mikrofon sudah diberikan (Android). */
export async function ensureMicPermission(): Promise<{ ok: boolean; message?: string; blocked?: boolean }> { return { ok: true }; }
/** Buka halaman pengaturan izin aplikasi. */
export function openAppSettings(): void {}
