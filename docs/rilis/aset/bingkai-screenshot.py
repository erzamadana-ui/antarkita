#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Bingkai tangkapan layar mentah menjadi screenshot Play Store 1080x1920 (rasio 9:16).

    python3 docs/rilis/aset/bingkai-screenshot.py

Masukan : docs/rilis/aset/screenshot/mentah/<nama>.png   (tangkapan viewport ponsel 412x892 @3x)
Keluaran: docs/rilis/aset/screenshot/pelanggan-N-<nama>.png
          docs/rilis/aset/screenshot/mitra-N-<nama>.png

⚠️  STATUS: DRAF. Tangkapan mentah diambil dari BUILD WEB (Chromium, viewport ponsel) memakai
    harness data tiruan — BUKAN tangkapan dari perangkat Android sungguhan. Perbedaan yang tetap
    ada: tidak ada status bar Android, font/rendering web berbeda tipis dari React Native, dan
    peta memakai basemap prosedural (tile OpenStreetMap diblokir di lingkungan build). Layak
    dipakai untuk Internal testing; SEBAIKNYA DIGANTI tangkapan HP asli sebelum rilis produksi.

Kepatuhan Play: tidak ada klaim superlatif, tidak ada harga yang bisa kedaluwarsa, tidak ada
merek pihak ketiga di judul, teks utama jauh dari 5% tepi kanvas.
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

DIR = Path(__file__).resolve().parent
ROOT = DIR.parents[2]
MENTAH = DIR / "screenshot" / "mentah"
OUT = DIR / "screenshot"

W, H = 1080, 1920                      # 9:16 — diterima Play (sisi terpendek ≥320, terpanjang ≤3840)
HEAD_H = 300                           # tinggi area judul
MARGIN_BAWAH = 108

PRIMARY = (0x18, 0x7A, 0x85)
PRIMARY_DEEP = (0x1B, 0x47, 0x4C)
MITRA_TOP = (0x14, 0x3B, 0x3A)
MITRA_BG = (0x0F, 0x2A, 0x28)
MINT = (0xBF, 0xE9, 0xEA)
ACCENT = (0xF5, 0xA5, 0x24)
WHITE = (0xFF, 0xFF, 0xFF)
BEZEL = (0x10, 0x22, 0x24)

FONT_DIR = Path("/usr/share/fonts/truetype/google-fonts")


def font(name: str, size: int):
    try:
        return ImageFont.truetype(str(FONT_DIR / name), size)
    except OSError:
        return ImageFont.load_default(size)


def lerp(a, b, t):
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def gradient(size, top, bottom, diagonal=0.3):
    w, h = size
    col = Image.new("RGB", (1, h))
    px = col.load()
    for y in range(h):
        px[0, y] = lerp(top, bottom, y / max(h - 1, 1))
    img = col.resize((w, h))
    if diagonal:
        row = Image.new("RGB", (w, 1))
        rp = row.load()
        for x in range(w):
            rp[x, 0] = lerp(top, bottom, x / max(w - 1, 1))
        img = Image.blend(img, row.resize((w, h)), diagonal)
    return img.convert("RGBA")


def blob(img, center, radius, color, alpha=36, blur=140):
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    cx, cy = center
    ImageDraw.Draw(layer).ellipse([cx - radius, cy - radius, cx + radius, cy + radius], fill=color + (alpha,))
    img.alpha_composite(layer.filter(ImageFilter.GaussianBlur(blur)))


def rounded_mask(size, radius):
    m = Image.new("L", size, 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size[0] - 1, size[1] - 1], radius, fill=255)
    return m


def bungkus(teks: str, f, maks_px: int, d: ImageDraw.ImageDraw):
    baris, kini = [], ""
    for kata in teks.split():
        coba = f"{kini} {kata}".strip()
        if d.textlength(coba, font=f) <= maks_px:
            kini = coba
        else:
            if kini:
                baris.append(kini)
            kini = kata
    if kini:
        baris.append(kini)
    return baris


def bingkai(src: Path, judul: str, app: str, out: Path) -> Path:
    if app == "mitra":
        bg = gradient((W, H), MITRA_TOP, MITRA_BG)
    else:
        bg = gradient((W, H), PRIMARY, PRIMARY_DEEP)
    blob(bg, (120, 160), 380, MINT, alpha=40)
    blob(bg, (980, 1720), 420, ACCENT, alpha=26)
    blob(bg, (860, 120), 300, WHITE, alpha=16)

    # ---- judul -------------------------------------------------------------
    d = ImageDraw.Draw(bg)
    f_judul = font("Poppins-Bold.ttf", 62)
    baris = bungkus(judul, f_judul, W - 220, d)
    while len(baris) > 2 and f_judul.size > 42:
        f_judul = font("Poppins-Bold.ttf", f_judul.size - 4)
        baris = bungkus(judul, f_judul, W - 220, d)
    lh = int(f_judul.size * 1.24)
    y = (HEAD_H - lh * len(baris)) // 2 + 26
    for b in baris:
        d.text((W // 2, y), b, font=f_judul, fill=WHITE, anchor="ma")
        y += lh

    # ---- perangkat ---------------------------------------------------------
    layar = Image.open(src).convert("RGB")
    tinggi = H - HEAD_H - MARGIN_BAWAH
    lebar = round(tinggi * layar.width / layar.height)
    if lebar > W - 200:                                   # jangan sampai menyentuh tepi
        lebar = W - 200
        tinggi = round(lebar * layar.height / layar.width)
    layar = layar.resize((lebar, tinggi), Image.LANCZOS)

    tepi = 9                                              # bezel gelap tipis
    radius = 46
    dev = Image.new("RGBA", (lebar + tepi * 2, tinggi + tepi * 2), BEZEL + (255,))
    dev.paste(layar, (tepi, tepi))
    dev.putalpha(rounded_mask(dev.size, radius))

    x = (W - dev.width) // 2
    y = HEAD_H + (H - HEAD_H - MARGIN_BAWAH - dev.height) // 2

    bayang = Image.new("RGBA", bg.size, (0, 0, 0, 0))
    ImageDraw.Draw(bayang).rounded_rectangle([x + 6, y + 22, x + dev.width + 6, y + dev.height + 22],
                                             radius=radius, fill=(3, 20, 22, 130))
    bg.alpha_composite(bayang.filter(ImageFilter.GaussianBlur(34)))
    bg.alpha_composite(dev, (x, y))

    out.parent.mkdir(parents=True, exist_ok=True)
    bg.convert("RGB").save(out, "PNG", optimize=True)
    return out


# nama berkas mentah → (judul, aplikasi, urutan tampil di Play Console)
RENCANA = [
    ("p-beranda",   "Semua layanan dalam satu aplikasi",        "pelanggan"),
    ("p-ride",      "Pesan AntarRide & AntarCar",               "pelanggan"),
    ("p-ride-peta", "Pilih titik jemput langsung di peta",      "pelanggan"),
    ("p-lacak",     "Lacak perjalanan Anda di peta",            "pelanggan"),
    ("p-pay",       "AntarPay untuk bayar tanpa tunai",         "pelanggan"),
    # p-food sengaja TIDAK dipakai: gambar merchant pada harness tiruan memakai berkas promo
    # sehingga teksnya bertumpuk dan terlihat cacat. Ganti dengan tangkapan HP asli bila ingin
    # menampilkan AntarFood di halaman listing.
    ("m-beranda",   "Nyalakan Online, terima order masuk",      "mitra"),
    ("m-order",     "Rincian order dan pendapatan tiap trip",   "mitra"),
    ("m-account",   "Satu akun untuk semua layanan mitra",      "mitra"),
]

if __name__ == "__main__":
    urut = {"pelanggan": 0, "mitra": 0}
    for nama, judul, app in RENCANA:
        src = MENTAH / f"{nama}.png"
        if not src.exists():
            print(f"⚠ lewati {nama} — {src.relative_to(ROOT)} tidak ada")
            continue
        urut[app] += 1
        out = bingkai(src, judul, app, OUT / f"{app}-{urut[app]}-{nama.split('-', 1)[1]}.png")
        im = Image.open(out)
        print(f"✔ {out.relative_to(ROOT)}  {im.size[0]}x{im.size[1]} {im.mode}  {out.stat().st_size // 1024} KB")
