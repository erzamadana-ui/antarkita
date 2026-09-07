#!/usr/bin/env python3
"""Pembuat aset suara AntarKita (tanpa unduhan / tanpa lisensi pihak ketiga).

Menghasilkan WAV mono 8-bit 8 kHz yang kecil (total < 60 KB) di assets/sounds/
dan berkas TypeScript assets/sounds/data.ts berisi data URI base64-nya.
data.ts dipakai src/lib/sound.ts supaya suara bisa diputar di web (<audio>)
maupun di Android/iOS (WebView tersembunyi) tanpa pipeline aset tambahan.

Jalankan ulang bila nada ingin diubah:  python3 scripts/gen-sounds.py
"""
import base64
import math
import os
import struct

RATE = 8000  # Hz — cukup untuk nada dering/notifikasi, menjaga berkas tetap mungil
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "sounds")


def tone(freqs, dur, gain=0.55, attack=0.012, release=0.05):
    """Nada (satu atau beberapa frekuensi) dengan amplop lembut agar tidak 'klik'."""
    n = int(RATE * dur)
    out = []
    for i in range(n):
        t = i / RATE
        env = min(1.0, t / attack if attack > 0 else 1.0)
        left = (n - i) / RATE
        if release > 0:
            env = min(env, min(1.0, left / release))
        s = sum(math.sin(2 * math.pi * f * t) for f in freqs) / len(freqs)
        out.append(s * env * gain)
    return out


def silence(dur):
    return [0.0] * int(RATE * dur)


def sweep(f0, f1, dur, gain=0.5):
    n = int(RATE * dur)
    out = []
    phase = 0.0
    for i in range(n):
        t = i / RATE
        f = f0 + (f1 - f0) * (i / max(1, n - 1))
        phase += 2 * math.pi * f / RATE
        env = min(1.0, t / 0.01, (n - i) / RATE / 0.04)
        out.append(math.sin(phase) * env * gain)
    return out


def write_wav(name, samples):
    """WAV PCM mono 8-bit unsigned (1 byte/sampel)."""
    data = bytearray()
    for s in samples:
        v = int(round(max(-1.0, min(1.0, s)) * 127)) + 128
        data.append(max(0, min(255, v)))
    byte_rate = RATE  # 8-bit mono
    header = b"RIFF" + struct.pack("<I", 36 + len(data)) + b"WAVEfmt " + \
        struct.pack("<IHHIIHH", 16, 1, 1, RATE, byte_rate, 1, 8) + \
        b"data" + struct.pack("<I", len(data))
    blob = header + bytes(data)
    path = os.path.join(OUT, name)
    with open(path, "wb") as f:
        f.write(blob)
    return blob


os.makedirs(OUT, exist_ok=True)

# --- Nada dering panggilan masuk: 2 dentang + jeda, dirancang untuk diulang mulus (2,0 dtk)
ring = tone([784, 1046], 0.30) + silence(0.10) + tone([659, 880], 0.32) + silence(1.28)
# --- Notifikasi order baru (mitra): dua nada naik, tegas tapi tidak mengagetkan (0,45 dtk)
order = tone([880], 0.14, gain=0.6) + silence(0.03) + tone([1318], 0.22, gain=0.6) + silence(0.06)
# --- Pesan chat baru: satu 'blip' pendek (0,22 dtk)
message = sweep(1046, 1568, 0.13, gain=0.5) + silence(0.09)

files = {"ring.wav": ring, "order.wav": order, "message.wav": message}
entries = []
total = 0
for name, samples in files.items():
    blob = write_wav(name, samples)
    total += len(blob)
    key = name.replace(".wav", "").upper()
    b64 = base64.b64encode(blob).decode("ascii")
    entries.append((key, name, b64))
    print(f"{name}: {len(blob)} byte")
print(f"total: {total} byte")
assert total < 60 * 1024, "aset suara melebihi 60 KB"

lines = [
    "// DIHASILKAN OTOMATIS oleh scripts/gen-sounds.py — jangan disunting manual.",
    "// Data URI dari assets/sounds/*.wav (WAV mono 8-bit 8 kHz, dibuat sendiri, bebas lisensi).",
    "// Dipakai src/lib/sound.ts: <audio> di web, WebView tersembunyi di Android/iOS.",
    "",
]
for key, name, b64 in entries:
    lines.append(f"/** {name} */")
    lines.append(f"export const {key} = 'data:audio/wav;base64,{b64}';")
    lines.append("")
lines.append("export const SOUNDS = { ring: RING, order: ORDER, message: MESSAGE } as const;")
lines.append("export type SoundKind = keyof typeof SOUNDS;")
lines.append("")
with open(os.path.join(OUT, "data.ts"), "w") as f:
    f.write("\n".join(lines))
print("assets/sounds/data.ts ditulis")
