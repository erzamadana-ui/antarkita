// Rute audio panggilan (earpiece ↔ loudspeaker) — SATU abstraksi untuk semua platform.
//
// Berkas ini hanyalah penunjuk tipe. Metro memilih implementasi nyata saat bundling:
//   • audioRoute.native.ts → Android/iOS, memakai expo-audio `setAudioModeAsync`
//   • audioRoute.web.ts    → browser, memakai HTMLMediaElement.setSinkId (bila ada)
//
// Kontrak yang dipakai src/lib/call.ts:
//   startCallAudio()  dipanggil saat panggilan mulai memakai mikrofon (setupPeer)
//   stopCallAudio()   dipanggil saat panggilan dibersihkan (teardown)
//   setSpeaker(on)    memindah rute; true bila BENAR-BENAR berpindah
//   getSpeaker()      status rute yang sedang berlaku

/** Apakah platform ini benar-benar bisa memindah rute earpiece ↔ loudspeaker sendiri? */
export const speakerSupported = false;

/** Pindahkan rute audio. Mengembalikan true hanya bila perpindahan benar-benar diterapkan. */
export async function setSpeaker(_on: boolean): Promise<boolean> { return false; }

/** Rute yang sedang berlaku (true = loudspeaker). */
export function getSpeaker(): boolean { return false; }

/** Siapkan sesi audio untuk panggilan suara (mode komunikasi + terapkan rute terpilih). */
export async function startCallAudio(): Promise<void> { /* diisi implementasi per platform */ }

/** Kembalikan sesi audio ke keadaan normal setelah panggilan selesai. */
export async function stopCallAudio(): Promise<void> { /* diisi implementasi per platform */ }

/** Nama mekanisme yang dipakai (untuk log & layar diagnostik). */
export const routeBackend = 'tidak tersedia';
