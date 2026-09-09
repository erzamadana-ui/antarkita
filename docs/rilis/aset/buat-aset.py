#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Pembuat aset grafis listing Google Play untuk AntarKita.

    python3 docs/rilis/aset/buat-aset.py

Menghasilkan (di folder yang sama):
    ikon-512-pelanggan.png        512x512  RGB (tanpa alfa)   -> Play Console "App icon"
    ikon-512-mitra.png            512x512  RGB (tanpa alfa)
    feature-graphic-pelanggan.png 1024x500 RGB                -> Play Console "Feature graphic"
    feature-graphic-mitra.png     1024x500 RGB

Palet & gaya mengikuti design system "Solid Motion" (src/lib/theme.ts):
    primary #187A85 · primaryDark #1A5E66 · primaryDeep #1B474C · mint #BFE9EA · accent #F5A524
Tipografi: Poppins (pengganti terdekat Plus Jakarta Sans yang tersedia di runner).

Catatan kepatuhan Play: tidak ada klaim superlatif ("terbaik", "#1"), tidak ada harga,
tidak ada merek pihak ketiga, tidak ada teks di 5% tepi (Play memotong/menimpa tepi).
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont

DIR = Path(__file__).resolve().parent
ROOT = DIR.parents[2]

PRIMARY = (0x18, 0x7A, 0x85)
PRIMARY_DARK = (0x1A, 0x5E, 0x66)
PRIMARY_DEEP = (0x1B, 0x47, 0x4C)
MITRA_BG = (0x0F, 0x2A, 0x28)
MINT = (0xBF, 0xE9, 0xEA)
ACCENT = (0xF5, 0xA5, 0x24)
WHITE = (0xFF, 0xFF, 0xFF)

FONT_DIR = Path("/usr/share/fonts/truetype/google-fonts")
F_BOLD = FONT_DIR / "Poppins-Bold.ttf"
F_MED = FONT_DIR / "Poppins-Medium.ttf"
F_REG = FONT_DIR / "Poppins-Regular.ttf"


def font(path: Path, size: int):
    try:
        return ImageFont.truetype(str(path), size)
    except OSError:
        return ImageFont.load_default(size)


def lerp(a, b, t):
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def gradient(size, top, bottom, diagonal=0.35):
    """Gradien linear lembut (vertikal + sedikit miring)."""
    w, h = size
    base = Image.new("RGB", (1, h))
    px = base.load()
    for y in range(h):
        px[0, y] = lerp(top, bottom, y / max(h - 1, 1))
    img = base.resize((w, h))
    if diagonal:
        side = Image.new("RGB", (w, 1))
        sp = side.load()
        for x in range(w):
            sp[x, 0] = lerp(top, bottom, x / max(w - 1, 1))
        img = Image.blend(img, side.resize((w, h)), diagonal)
    return img


def blob(img, center, radius, color, alpha=40, blur=90):
    """Gumpalan warna diam ala 'Solid Motion' (latar ambien statis, tanpa animasi)."""
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    cx, cy = center
    d.ellipse([cx - radius, cy - radius, cx + radius, cy + radius], fill=color + (alpha,))
    layer = layer.filter(ImageFilter.GaussianBlur(blur))
    img.alpha_composite(layer) if img.mode == "RGBA" else img.paste(
        Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB"), (0, 0)
    )


def rounded(img: Image.Image, radius: int) -> Image.Image:
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, img.size[0] - 1, img.size[1] - 1], radius, fill=255)
    out = img.convert("RGBA")
    out.putalpha(mask)
    return out


def shadow_paste(bg: Image.Image, tile: Image.Image, xy, spread=26, alpha=90):
    sh = Image.new("RGBA", (tile.width + spread * 2, tile.height + spread * 2), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle(
        [spread, spread + 8, spread + tile.width, spread + tile.height + 8],
        radius=tile.width // 5, fill=(4, 26, 28, alpha),
    )
    sh = sh.filter(ImageFilter.GaussianBlur(spread / 1.7))
    bg.alpha_composite(sh, (xy[0] - spread, xy[1] - spread))
    bg.alpha_composite(tile, xy)


# --------------------------------------------------------------------- ikon 512
def buat_ikon(app: str) -> Path:
    src = ROOT / "apps" / app / "assets" / "icon.png"
    im = Image.open(src).convert("RGB").resize((512, 512), Image.LANCZOS)
    out = DIR / f"ikon-512-{app}.png"
    # Play menolak alfa pada app icon → simpan RGB murni.
    im.save(out, "PNG", optimize=True)
    return out


# ---------------------------------------------------------- feature graphic 1024x500
CHIPS = {
    "pelanggan": ["AntarRide", "AntarFood", "AntarSend", "AntarMarket", "AntarPay"],
    "mitra": ["Driver", "Merchant", "Pasar", "Travel", "Mobil Box"],
}
TAGLINE = {
    "pelanggan": "Antar apa saja, ke mana saja",
    "mitra": "Penghasilan tambahan, satu aplikasi",
}
JUDUL = {"pelanggan": "AntarKita", "mitra": "AntarKita Mitra"}


def buat_feature(app: str) -> Path:
    W, H = 1024, 500
    if app == "mitra":
        bg = gradient((W, H), (0x14, 0x3B, 0x3A), MITRA_BG).convert("RGBA")
    else:
        bg = gradient((W, H), PRIMARY, PRIMARY_DEEP).convert("RGBA")

    blob(bg, (150, 90), 230, MINT, alpha=34, blur=110)
    blob(bg, (900, 430), 260, ACCENT, alpha=22, blur=120)
    blob(bg, (700, 60), 180, WHITE, alpha=14, blur=100)

    # Kartu ikon aplikasi (tile membulat + bayangan)
    tile_px = 216
    tile = Image.open(ROOT / "apps" / app / "assets" / "icon.png").convert("RGB")
    tile = rounded(tile.resize((tile_px, tile_px), Image.LANCZOS), tile_px // 4)
    shadow_paste(bg, tile, (78, (H - tile_px) // 2))

    d = ImageDraw.Draw(bg)
    x = 78 + tile_px + 56
    f_title = font(F_BOLD, 78 if app == "pelanggan" else 62)
    f_tag = font(F_MED, 30)
    f_chip = font(F_MED, 20)

    # Blok teks dipusatkan vertikal, minimal 60 px dari tepi (aman dari pemotongan Play).
    title_h = f_title.getbbox("Ag")[3]
    y = 138
    d.text((x, y), JUDUL[app], font=f_title, fill=WHITE)
    y += title_h + 34
    d.text((x, y), TAGLINE[app], font=f_tag, fill=MINT)
    y += 62

    # Baris chip layanan — digambar di lapisan transparan lalu dikomposit,
    # supaya isian semi-transparan benar-benar menyatu dengan latar (bukan putih pekat).
    chips = Image.new("RGBA", bg.size, (0, 0, 0, 0))
    dc = ImageDraw.Draw(chips)
    cx = x
    for label in CHIPS[app]:
        tw = dc.textlength(label, font=f_chip)
        w_chip, h_chip = int(tw) + 30, 42
        if cx + w_chip > W - 62:
            break
        dc.rounded_rectangle([cx, y, cx + w_chip, y + h_chip], radius=h_chip // 2,
                             fill=(255, 255, 255, 46), outline=(255, 255, 255, 120), width=2)
        cx += w_chip + 12
    bg.alpha_composite(chips)

    d = ImageDraw.Draw(bg)
    cx = x
    for label in CHIPS[app]:
        tw = d.textlength(label, font=f_chip)
        w_chip, h_chip = int(tw) + 30, 42
        if cx + w_chip > W - 62:
            break
        d.text((cx + 15, y + 8), label, font=f_chip, fill=WHITE)
        cx += w_chip + 12

    out = DIR / f"feature-graphic-{app}.png"
    bg.convert("RGB").save(out, "PNG", optimize=True)
    return out


if __name__ == "__main__":
    for app in ("pelanggan", "mitra"):
        for p in (buat_ikon(app), buat_feature(app)):
            im = Image.open(p)
            print(f"✔ {p.relative_to(ROOT)}  {im.size[0]}x{im.size[1]} {im.mode}  {p.stat().st_size // 1024} KB")
