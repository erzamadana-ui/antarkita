#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Pembuat ikon App Store (iOS) untuk AntarKita.

    python3 docs/rilis/aset/ios/buat-ikon-ios.py

Menghasilkan (di folder yang sama):
    ikon-1024-pelanggan.png   1024x1024 RGB   -> App Store Connect "App Icon" — AntarKita
    ikon-1024-mitra.png       1024x1024 RGB   -> App Store Connect "App Icon" — AntarKita Mitra

--------------------------------------------------------------------------------------------
KENAPA BERKAS INI ADA — tiga cara ikon App Store ditolak, dan bagaimana skrip ini mencegahnya
--------------------------------------------------------------------------------------------
1. KANAL ALFA / TRANSPARANSI.
   App Store Connect menolak ikon yang punya kanal alfa. Ikon sumber di apps/*/assets/icon.png
   kebetulan sudah RGB, tapi itu bisa berubah kapan saja saat desain diperbarui. Skrip ini
   SELALU meratakan gambar ke latar warna merek lebih dulu, lalu menyimpan sebagai RGB murni.

2. SUDUT MEMBULAT / BAYANGAN YANG DIGAMBAR SENDIRI.
   iOS yang memotong sudut ikon (mask "squircle"), bukan pembuat ikon. Ikon yang sudah
   dibulatkan sendiri akan terlihat memiliki sudut ganda, dan Apple menolaknya. Skrip ini
   tidak pernah menambahkan radius, dan MEMERIKSA keempat sudut hasil akhir: bila sudut
   berbeda jauh dari warna merek (indikasi ikon sumber sudah dibulatkan/transparan), skrip
   berhenti dengan pesan galat, bukan diam-diam menghasilkan berkas yang akan ditolak.

3. UKURAN SALAH.
   Apple hanya menerima 1024x1024 piksel persis untuk ikon App Store.

Skrip ini SENGAJA tidak menggambar ulang logo: sumbernya adalah aset produk yang sama persis
dengan yang dipakai aplikasi (apps/<app>/assets/icon.png), supaya ikon di App Store, ikon di
layar utama iPhone, dan ikon di Play Store tidak pernah berbeda.

Padanan untuk Android ada di docs/rilis/aset/buat-aset.py (ikon 512 + feature graphic).
"""
from pathlib import Path
import sys

from PIL import Image

DIR = Path(__file__).resolve().parent
ROOT = DIR.parents[3]

UKURAN = 1024

# Warna latar per aplikasi — sama dengan META[...].bg di app.config.ts.
# Dipakai HANYA sebagai alas saat meratakan kanal alfa (kalau ikon sumber kelak punya alfa).
LATAR = {
    'pelanggan': (0x0E, 0x94, 0x88),
    'mitra': (0x0F, 0x2A, 0x28),
}

# Seberapa jauh warna sudut boleh menyimpang dari warna piksel tepi tengah sebelum dianggap
# "ikon sumber sudah dibulatkan". Nilai longgar: yang dicari adalah sudut yang JELAS berbeda
# (mis. hitam pekat atau putih) akibat masking, bukan gradien halus.
TOLERANSI_SUDUT = 60


def jarak(a, b) -> int:
    return max(abs(int(x) - int(y)) for x, y in zip(a, b))


def buat_ikon(app: str) -> Path:
    src = ROOT / 'apps' / app / 'assets' / 'icon.png'
    if not src.exists():
        sys.exit(f'GAGAL: ikon sumber tidak ditemukan: {src}')

    im = Image.open(src)
    asal_mode, asal_size = im.mode, im.size

    # 1. Ratakan alfa ke latar warna merek → tidak akan pernah ada kanal alfa di hasil.
    if im.mode in ('RGBA', 'LA', 'P'):
        im = im.convert('RGBA')
        alas = Image.new('RGBA', im.size, LATAR[app] + (255,))
        im = Image.alpha_composite(alas, im)
    im = im.convert('RGB')

    # 2. Pastikan tepat 1024x1024.
    if im.size != (UKURAN, UKURAN):
        im = im.resize((UKURAN, UKURAN), Image.LANCZOS)

    out = DIR / f'ikon-1024-{app}.png'
    im.save(out, 'PNG', optimize=True)

    # 3. Verifikasi hasil — bukan asumsi. Kalau salah satu gagal, berkas dihapus lagi
    #    supaya tidak ada ikon cacat yang tanpa sadar diunggah ke App Store Connect.
    cek = Image.open(out)
    masalah = []
    if cek.mode != 'RGB':
        masalah.append(f'mode {cek.mode}, seharusnya RGB (tanpa kanal alfa)')
    if 'transparency' in cek.info:
        masalah.append('masih memuat metadata transparansi')
    if cek.size != (UKURAN, UKURAN):
        masalah.append(f'ukuran {cek.size}, seharusnya {UKURAN}x{UKURAN}')

    px = cek.load()
    sudut = [px[0, 0], px[UKURAN - 1, 0], px[0, UKURAN - 1], px[UKURAN - 1, UKURAN - 1]]
    tepi = px[UKURAN // 2, 0]  # tengah tepi atas: pasti di luar area logo, tidak kena mask sudut
    menyimpang = [s for s in sudut if jarak(s, tepi) > TOLERANSI_SUDUT]
    if menyimpang:
        masalah.append(
            f'sudut {menyimpang} berbeda jauh dari tepi {tepi} — ikon sumber tampaknya sudah '
            f'dibulatkan/transparan. Apple menolak ikon dengan sudut membulat bawaan; perbaiki '
            f'{src.relative_to(ROOT)} agar persegi penuh.'
        )

    if masalah:
        out.unlink(missing_ok=True)
        for m in masalah:
            print(f'  ✗ {m}', file=sys.stderr)
        sys.exit(f'GAGAL membuat ikon {app}.')

    kb = out.stat().st_size // 1024
    print(f'✔ {out.relative_to(ROOT)}  {cek.size[0]}x{cek.size[1]} {cek.mode}  {kb} KB'
          f'   (sumber: {asal_size[0]}x{asal_size[1]} {asal_mode})')
    print(f'    sudut {sudut[0]} · tanpa alfa · tanpa sudut membulat → siap unggah')
    return out


if __name__ == '__main__':
    for app in ('pelanggan', 'mitra'):
        buat_ikon(app)
    print()
    print('Unggah di App Store Connect → Aplikasi → Distribusi → App Information? BUKAN:')
    print('ikon App Store diambil OTOMATIS dari berkas .ipa (AppIcon 1024pt) yang dibangun Expo')
    print('dari apps/<app>/assets/icon.png. Berkas di folder ini adalah salinan yang sudah')
    print('diverifikasi — pakai bila App Store Connect meminta unggahan manual, dan sebagai')
    print('bukti bahwa aset sumbernya memang memenuhi syarat Apple.')
