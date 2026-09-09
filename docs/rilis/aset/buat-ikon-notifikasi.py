#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Pembuat ikon notifikasi Android untuk AntarKita (ketiga aplikasi).

    python3 docs/rilis/aset/buat-ikon-notifikasi.py

Menghasilkan:
    apps/pelanggan/assets/notification-icon.png   96x96 RGBA, putih penuh + latar transparan
    apps/mitra/assets/notification-icon.png
    apps/admin/assets/notification-icon.png

MENGAPA HARUS MONOKROM PUTIH TRANSPARAN
---------------------------------------
Sejak Android 5 (Lollipop) sistem MEMBUANG seluruh informasi warna ikon kecil notifikasi dan
hanya memakai KANAL ALFA-nya sebagai stensil, lalu mewarnainya dengan warna aksen notifikasi
(di sini: `color` pada plugin expo-notifications = warna merek tiap aplikasi). Ikon berwarna
karena itu tampil sebagai KOTAK PUTIH PENUH di status bar. Tanpa aset ini Android memakai ikon
aplikasi (yang punya latar solid) sehingga hasilnya persegi buram — jelek dan sering dikira bug.

Sumber bentuk: `apps/<app>/assets/logo.svg` — dua kelopak spiral yang saling mengunci (satu putih,
satu mint). Karena dalam monokrom keduanya menjadi satu warna, kelopak kedua diberi "alur"
(gap transparan) sepanjang tepinya agar bentuk spiralnya tetap terbaca pada 24dp.
"""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[3]
APPS = ("pelanggan", "mitra", "admin")

UKURAN = 96          # ukuran akhir (px) — sesuai anjuran expo-notifications
SS = 12              # faktor supersampling (96*12 = 1152 px kerja) → tepi halus setelah diperkecil
VIEWBOX = 96.0       # sistem koordinat logo.svg
ISI = 0.82           # bagian kanvas yang ditempati mark (sisanya margin aman status bar)
ALUR = 2.3           # lebar alur pemisah antar kelopak, dalam satuan viewBox

# Dua kelopak dari logo.svg (identik, saling berputar 180° terhadap titik 48,48).
KELOPAK_1 = "M48 18C48 18 66 26 66 44C66 53 59 60 50 60C43 60 38 55 38 48C38 43 41 40 46 40C49 40 51 42 51 45"
KELOPAK_2 = "M48 78C48 78 30 70 30 52C30 43 37 36 46 36C53 36 58 41 58 48C58 53 55 56 50 56C47 56 45 54 45 51"


def urai_path(d: str, langkah: int = 96):
    """Parser minimal untuk path SVG absolut 'M x y C ...' (satu-satunya bentuk yang dipakai logo)."""
    token = d.replace("M", " M ").replace("C", " C ").replace("-", " -").split()
    titik, i, kursor = [], 0, (0.0, 0.0)
    while i < len(token):
        perintah = token[i]
        if perintah == "M":
            kursor = (float(token[i + 1]), float(token[i + 2]))
            titik.append(kursor)
            i += 3
        elif perintah == "C":
            p0 = kursor
            p1 = (float(token[i + 1]), float(token[i + 2]))
            p2 = (float(token[i + 3]), float(token[i + 4]))
            p3 = (float(token[i + 5]), float(token[i + 6]))
            for s in range(1, langkah + 1):
                t = s / langkah
                u = 1 - t
                titik.append((
                    u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
                    u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
                ))
            kursor = p3
            i += 7
        else:                                    # angka lepas / perintah tak dipakai
            i += 1
    return titik


def buat_ikon() -> Image.Image:
    besar = UKURAN * SS
    img = Image.new("RGBA", (besar, besar), (255, 255, 255, 0))
    d = ImageDraw.Draw(img)

    k1 = urai_path(KELOPAK_1)
    k2 = urai_path(KELOPAK_2)

    # Skala + geser: mark dipusatkan dan diperbesar sampai memenuhi `ISI` dari kanvas.
    semua = k1 + k2
    x0, x1 = min(p[0] for p in semua), max(p[0] for p in semua)
    y0, y1 = min(p[1] for p in semua), max(p[1] for p in semua)
    skala = (VIEWBOX * ISI) / max(x1 - x0, y1 - y0) * (besar / VIEWBOX)
    dx = besar / 2 - (x0 + x1) / 2 * skala
    dy = besar / 2 - (y0 + y1) / 2 * skala
    peta = lambda pts: [(p[0] * skala + dx, p[1] * skala + dy) for p in pts]

    d.polygon(peta(k1), fill=(255, 255, 255, 255))
    d.polygon(peta(k2), fill=(255, 255, 255, 255))

    # Alur pemisah: tepi kelopak kedua dihapus (alfa 0) supaya perpotongan dua kelopak
    # tidak melebur jadi satu gumpalan saat keduanya menjadi putih polos.
    tepi = peta(k2) + [peta(k2)[0]]
    ImageDraw.Draw(img).line(tepi, fill=(255, 255, 255, 0), width=max(1, int(ALUR * skala)), joint="curve")

    kecil = img.resize((UKURAN, UKURAN), Image.LANCZOS)
    # Android hanya membaca kanal alfa; RGB dipaksa putih murni agar aman di semua peluncur
    # dan pada pratinjau yang (keliru) memakai warna aslinya.
    alfa = kecil.getchannel("A")
    hasil = Image.new("RGBA", (UKURAN, UKURAN), (255, 255, 255, 0))
    hasil.putalpha(alfa)
    hasil.paste((255, 255, 255), (0, 0, UKURAN, UKURAN), alfa)
    hasil.putalpha(alfa)
    return hasil


if __name__ == "__main__":
    ikon = buat_ikon()
    for app in APPS:
        out = ROOT / "apps" / app / "assets" / "notification-icon.png"
        ikon.save(out, "PNG", optimize=True)
        im = Image.open(out)
        opak = sum(1 for a in im.getchannel("A").getdata() if a > 8)
        warna = {p[:3] for p in im.convert("RGBA").getdata() if p[3] > 8}
        print(f"✔ {out.relative_to(ROOT)}  {im.size[0]}x{im.size[1]} {im.mode}  "
              f"{out.stat().st_size} B  piksel tampak {opak} ({opak / (UKURAN * UKURAN):.0%})  "
              f"warna unik non-transparan: {len(warna)} → {sorted(warna)[:3]}")
