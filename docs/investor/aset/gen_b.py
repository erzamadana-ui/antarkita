#!/usr/bin/env python3
"""Infografis 08-13 deck investor AntarKita."""
import os, sys, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _brand import *

OUT = os.path.dirname(os.path.abspath(__file__))
P = lambda n: os.path.join(OUT, n)

# ---------------------------------------------------------------- 08 DIFERENSIASI
W, H = 13.0, 5.6
R = W / H
fig, ax = canvas(W, H)
diff = [
    ("AntarNow — kode driver", "Pelanggan yang sudah bertemu driver langsung\n(mangkal, langganan) cukup mengetik kode 6 karakter.\nOrder ditahan 120 detik hanya untuk driver itu,\nlalu dilepas bila tak diambil.",
     "orders.preferred_driver_id · migrasi 0030", TEAL),
    ("Dispatch rating + radius dinamis", "Rating ≥4,8 melihat order lebih dulu; <4,0 menunggu\n75 detik. Radius jemput diatur per layanan dari panel\nadmin (motor 5 km … box 15 km) tanpa rilis ulang.",
     "priority_tiers & pickup_radius_km · migrasi 0025", "#0EA5E9"),
    ("Pasar Tradisional", "Pedagang pasar terdaftar sebagai mitra dengan lapak,\nkategori, dan harga hari ini. Pagar harga otomatis:\n>2× acuan ditolak, 1,35× wajib lampirkan nota.",
     "market_vendors · market_prices · uji S8", SERVICE["market"]),
    ("Titipan antar kota lewat travel", "Paket antar kota dititipkan ke mitra travel resmi\nlewat gudang, dengan batas 30 kg / 120 cm dan\nbagi hasil mitra 80%.",
     "travel_send_* · warehouses · uji S5", SERVICE["travel"]),
]
cw, ch = 47.0, 39.0
for i, (t, b, tag, col) in enumerate(diff):
    x = 2 + (i % 2) * (cw + 2.0)
    y = 55 - (i // 2) * (ch + 2.5)
    card(ax, x, y, cw, ch, fc=BG, ec=BORDER, r=1.8)
    card(ax, x, y, 1.1, ch, fc=col, ec="none", r=0.0, z=3)
    dot(ax, x + 5.0, y + ch - 8.5, 2.6, col, ratio=R, z=4)
    txt(ax, x + 5.0, y + ch - 8.6, str(i + 1), 12.5, "#FFFFFF", "bold", ha="center", z=6)
    txt(ax, x + 9.6, y + ch - 8.5, t, 15, INK, "bold", z=6)
    txt(ax, x + 3.4, y + ch - 15.0, b, 10.4, MUTED, z=6, lspace=1.65, va="top")
    pill(ax, x + 3.4, y + 3.2, cw - 7.0, 5.4, BGSOFT, z=3)
    txt(ax, x + 5.4, y + 5.9, tag, 9.0, col, "bold", z=6)
txt(ax, 2, 3, "Keempat fitur di atas SUDAH ADA di basis kode dan lolos simulasi transaksi — bukan rencana, dan dapat didemokan hari ini.",
    9.4, FAINT, z=6)
save(fig, P("08-diferensiasi.png"))

# ---------------------------------------------------------------- 09 PASAR TAM/SAM/SOM
W, H = 13.0, 5.9
R = W / H
fig, ax = canvas(W, H)
from matplotlib.patches import Polygon
levels = [
    ("TAM", "Ekonomi digital Indonesia", "US$ 100 miliar", "GMV 2025, tumbuh +14% YoY;\nproyeksi ≈US$180 miliar pada 2030",
     "e-Conomy SEA 2025 (Google–Temasek–Bain) [S-53][S-54][E-03]", TEAL_DARK, "#FFFFFF"),
    ("SAM", "Transportasi & antar makanan Indonesia", "US$ 10 miliar", "GMV 2025 — segmen yang benar-benar\ndilayani AntarKita secara kategori",
     "e-Conomy SEA 2025 [S-53]", TEAL, "#FFFFFF"),
    ("SOM", "Pekanbaru + Padang, 3 tahun", "belum dikuantifikasi", "Tidak ada sumber kredibel untuk GMV on-demand\nper kota tier-2 Sumatera. Angka SOM akan dihitung\ndari data order nyata 90 hari pertama peluncuran.",
     "[ASUMSI] menunggu data — tidak diisi angka karangan", ACCENT, INK),
]
top_w, bot_w, y_top, y_bot = 56.0, 20.0, 88.0, 12.0
n = len(levels)
for i, (tag, name, big, body, src, col, tc) in enumerate(levels):
    ya = y_top - i * (y_top - y_bot) / n
    yb = y_top - (i + 1) * (y_top - y_bot) / n
    wa = top_w - (top_w - bot_w) * (i / n)
    wbo = top_w - (top_w - bot_w) * ((i + 1) / n)
    cx = 30.0
    poly = Polygon([[cx - wa / 2, ya], [cx + wa / 2, ya], [cx + wbo / 2, yb + 1.2], [cx - wbo / 2, yb + 1.2]],
                   closed=True, facecolor=col, edgecolor="#FFFFFF", linewidth=3, zorder=3)
    ax.add_patch(poly)
    txt(ax, cx, (ya + yb) / 2 + 4.2, tag, 13, tc, "bold", ha="center", z=6, alpha=0.85)
    txt(ax, cx, (ya + yb) / 2 - 3.5, big, 19 if i < 2 else 13, tc, "bold", ha="center", z=6)
    # keterangan kanan
    ty = (ya + yb) / 2
    card(ax, 62, ty - 11.5, 36, 23, fc=BG, ec=BORDER, r=1.5, z=3)
    txt(ax, 64, ty + 8.0, name, 12.5, col if i == 2 else TEAL_DARK, "bold", z=6)
    txt(ax, 64, ty + 3.6, body, 9.8, MUTED, z=6, lspace=1.6, va="top")
    txt(ax, 64, ty - 9.2, src, 8.4, FAINT, z=6)
    ax.plot([cx + wbo / 2 + 1.5, 61.2], [ty, ty], color=BORDER, lw=1.4, zorder=1)
txt(ax, 2, 5.5, "Kejujuran metodologi: TAM dan SAM dikutip; SOM sengaja TIDAK diangkakan karena benchmark GMV on-demand kota tier-2 tidak tersedia di sumber terbuka\n"
                "(riset internal mencatat: CAC/CAD dan pangsa pasar per pemain Indonesia juga tidak ditemukan sumber kredibelnya).",
    9.4, MUTED, z=6, lspace=1.6, va="center")
save(fig, P("09-pasar.png"))

# ---------------------------------------------------------------- 10 KOMPETISI
W, H = 13.0, 5.9
R = W / H
fig, ax = canvas(W, H)
x0, y0, x1, y1 = 11, 30, 62, 92
card(ax, x0, y0, x1 - x0, y1 - y0, fc=BGSOFT, ec="none", r=1.2, z=1)
arrow(ax, (x0, y0), (x1 + 2, y0), MUTED, 1.6, ms=11, z=3)
arrow(ax, (x0, y0), (x0, y1 + 2), MUTED, 1.6, ms=11, z=3)
txt(ax, (x0 + x1) / 2, y0 - 4.0, "KEDALAMAN LOKAL  →  pasar tradisional · titipan antar kota · mitra lokal",
    9.8, MUTED, "bold", ha="center", z=6)
ax.text(x0 - 4.0, (y0 + y1) / 2, "LUAS EKOSISTEM  →  jumlah layanan dalam satu aplikasi",
        fontsize=9.8, color=MUTED, fontweight="bold", ha="center", va="center", rotation=90, zorder=6)
players = [
    ("Gojek / Grab", 22, 77, 6.6, "#9AA7A8", "Ekosistem terlengkap, skala nasional"),
    ("ShopeeFood", 17, 57, 4.6, "#9AA7A8", "Fokus makanan + e-commerce"),
    ("Maxim", 26, 45, 5.0, "#9AA7A8", "Tarif murah; sudah hadir di Pekanbaru"),
    ("InDrive", 15, 40, 3.8, "#9AA7A8", "Tawar-menawar tarif antara penumpang & driver"),
    ("Travel &\npasar informal", 49, 39, 5.2, "#C2CCCD", "Offline, tanpa jejak digital & tanpa jaminan"),
    ("AntarKita", 50, 73, 7.4, TEAL, "8 layanan + pasar tradisional + titipan antar kota"),
]
for name, px, py, r, col, sub in players:
    dot(ax, px, py, r, col, ratio=R, z=5)
    txt(ax, px, py, name, 10.5 if col == TEAL else 9.3, "#FFFFFF", "bold",
        ha="center", va="center", z=7, lspace=1.3)
txt(ax, 11, 96, "Posisi relatif — penilaian kualitatif, ukuran bulatan BUKAN pangsa pasar", 9.4, FAINT, z=6)

# legenda ringkas di bawah kanvas
for i, (name, px, py, r, col, sub) in enumerate(players):
    lx = 11 + (i % 2) * 27.0
    ly = 20.0 - (i // 2) * 7.2
    dot(ax, lx + 0.9, ly + 0.9, 0.9, col, ratio=R, z=5)
    txt(ax, lx + 3.0, ly + 1.0, name.replace("\n", " "), 9.2, INK, "bold", z=6, va="center")
    txt(ax, lx + 3.0, ly - 2.2, sub, 8.4, MUTED, z=6, va="center")

# panel kanan
card(ax, 68, 22, 30, 74, fc=BG, ec=BORDER, r=1.8)
txt(ax, 70.5, 91, "KONTEKS PERSAINGAN 2026", 11.5, TEAL_DARK, "bold", z=6)
notes = [
    ("Konsolidasi nasional", "Rencana merger Grab–GoTo dibahas KPPU;\nentitas gabungan diperkirakan menguasai\nhingga 91% pasar ride-hailing Indonesia.\nKonsentrasi ini membuka ruang bagi\npemain lokal yang fokus.", INFO),
    ("Batas komisi 8%", "Perpres 27/2026 menekan take rate ojek\nroda dua seluruh pemain — besar maupun\nkecil — ke angka yang sama. Keunggulan\nmodal untuk mensubsidi komisi berkurang.", ACCENT),
    ("Yang tidak dilayani", "Pasar tradisional per pedagang dan titipan\nantar kota lewat travel resmi tidak\ndikerjakan pemain nasional di dua kota ini.", SERVICE["market"]),
]
for i, (t, b, col) in enumerate(notes):
    y = 62 - i * 22.5
    txt(ax, 70.5, y + 21, t, 11.2, col, "bold", z=6)
    txt(ax, 70.5, y + 17.5, b, 9.0, MUTED, z=6, lspace=1.65, va="top")
save(fig, P("10-kompetisi.png"))

# ---------------------------------------------------------------- 11 TAKE RATE / PERPRES
W, H = 13.0, 5.7
R = W / H
fig, ax = canvas(W, H)
txt(ax, 2, 95, "BATAS POTONGAN APLIKASI PER LAYANAN — setelah Perpres 27/2026 (berlaku 1 Juli 2026)", 13, INK, "bold", z=6)

rows = [
    ("AntarRide (ojek roda dua)", 8, "maks 8% — DIATUR", DANGER, "Perpres 27/2026 [S-25]"),
    ("AntarCar (roda empat)", 20, "20% — belum dibatasi", TEAL, "Kepmenhub KP 564/2022 [S-24]"),
    ("AntarFood (komisi merchant)", 15, "15% ke merchant", SERVICE["food"], "pricing.merchant_commission_pct"),
    ("AntarSend / AntarShop / AntarBox", 20, "20% — belum dibatasi", SERVICE["send"], "tabel pricing"),
    ("AntarTravel (titipan antar kota)", 20, "80% mitra / 20% platform", SERVICE["travel"], "travel_send_partner_pct"),
]
bx, bw_max = 34.0, 46.0
for i, (name, pct, label, col, src) in enumerate(rows):
    y = 76 - i * 12.5
    txt(ax, 2, y + 3.2, name, 11.2, INK, "bold", z=6)
    txt(ax, 2, y - 1.0, src, 8.4, FAINT, z=6)
    card(ax, bx, y - 1.6, bw_max, 7.6, fc=BGSOFT, ec="none", r=1.0, z=2)
    card(ax, bx, y - 1.6, bw_max * pct / 25.0, 7.6, fc=col, ec="none", r=1.0, z=3)
    txt(ax, bx + bw_max * pct / 25.0 + 1.8, y + 2.2, label, 10.2, col, "bold", z=6)
for g in (8, 20):
    ax.plot([bx + bw_max * g / 25.0, bx + bw_max * g / 25.0], [12, 84], color=BORDER, lw=1.2, ls="--", zorder=1)
txt(ax, bx + bw_max * 8 / 25.0, 86, "8%", 10, DANGER, "bold", ha="center", z=6)
txt(ax, bx + bw_max * 20 / 25.0, 86, "20%", 10, MUTED, "bold", ha="center", z=6)

card(ax, 2, 2, 96, 14, fc=DANGER_LIGHT, ec=DANGER, lw=1.6, r=1.4, z=3)
txt(ax, 4, 12.2, "DAMPAK JUJUR: pendapatan komisi AntarRide turun 60% dibanding asumsi 20% yang lazim dipakai proyeksi ride-hailing Indonesia.", 11.5, DANGER, "bold", z=6)
txt(ax, 4, 6.0, "Kompensasinya BUKAN menaikkan komisi, melainkan: (1) bauran layanan non-roda-dua — AntarCar, AntarFood, AntarSend, AntarShop, AntarMart, AntarBox, AntarTravel; (2) pendapatan non-komisi —\n"
                "biaya layanan pelanggan, jasa belanja AntarShop, iklan & langganan merchant. Head of Growth & Partnership memikul target pendapatan non-komisi sebagai KPI utama, bukan sekadar jangkauan pemasaran.",
    9.4, INK, z=6, lspace=1.65, va="center")
txt(ax, 98, 18.5, "Cakupan 8% untuk food/kirim/mobil BELUM PASTI [S-27]; aturan tarif tiga layanan masih berstatus rencana [S-28][S-29] — bukan hukum positif.",
    8.8, FAINT, ha="right", z=6)
save(fig, P("11-takerate.png"))

# ---------------------------------------------------------------- 12 UNIT ECONOMICS
W, H = 13.0, 5.8
R = W / H
fig, ax = canvas(W, H)
txt(ax, 2, 95, "SATU ORDER ANTARRIDE — angka nyata dari simulasi transaksi S1 (bukan model)", 13, INK, "bold", z=6)

def waterfall(x, title, sub, komisi_pct, col, badge, badgecol):
    total, pf = 9000, 1000
    jasa = total - pf
    kom = round(jasa * komisi_pct / 100)
    driver = jasa - kom
    plat = pf + kom
    card(ax, x, 16, 44, 68, fc=BG, ec=col, lw=1.8, r=1.8)
    txt(ax, x + 3, 78, title, 13.5, INK, "bold", z=6)
    txt(ax, x + 3, 73, sub, 9.6, MUTED, z=6)
    pill(ax, x + 30, 76.2, 11.5, 5.0, badgecol, z=4)
    txt(ax, x + 35.75, 78.7, badge, 9.2, "#FFFFFF", "bold", ha="center", z=6)
    bars = [("Dibayar pelanggan", total, TEAL_DARK), ("Biaya jasa aplikasi", pf, ACCENT),
            ("Komisi platform " + f"{komisi_pct}%", kom, DANGER if komisi_pct == 20 else SERVICE["market"]),
            ("Diterima driver", driver, TEAL)]
    scale = 33.0 / 9000
    for i, (lab, val, c) in enumerate(bars):
        y = 63 - i * 11.5
        txt(ax, x + 3, y + 6.5, lab, 10.0, MUTED, z=6)
        card(ax, x + 3, y - 0.5, max(val * scale, 0.8), 6.0, fc=c, ec="none", r=0.8, z=3)
        txt(ax, x + 3 + max(val * scale, 0.8) + 1.6, y + 2.5, f"Rp{val:,}".replace(",", "."), 12, c, "bold", z=6)
    card(ax, x + 3, 18.0, 38, 8.5, fc=BGSOFT, ec="none", r=1.2, z=3)
    txt(ax, x + 5, 23.6, "Pendapatan platform per order", 9.4, MUTED, z=6)
    txt(ax, x + 5, 20.2, f"Rp{plat:,}".replace(",", ".") + f"  ({plat/total*100:.1f}% dari nilai order)", 12, INK, "bold", z=6)
    return plat

p20 = waterfall(2, "Konfigurasi terpasang saat ini", "pricing.commission_pct = 20 (seed awal basis kode)", 20, MUTED, "PERLU DIUBAH", DANGER)
p8 = waterfall(54, "Konfigurasi patuh Perpres 27/2026", "commission_pct = 8 untuk ride_motor", 8, TEAL, "TARGET", SERVICE["market"])

arrow(ax, (46.5, 50), (53.5, 50), DANGER, 2.6, ms=16)
txt(ax, 50, 57, "komisi\n−60%", 13, DANGER, "bold", ha="center", z=8, lspace=1.35)
txt(ax, 50, 43, f"pendapatan platform\n−{(1-p8/p20)*100:.0f}%", 9.4, DANGER, "bold", ha="center", z=8, lspace=1.5)

card(ax, 2, 1.5, 96, 12.5, fc=ACCENT_LIGHT, ec=ACCENT, lw=1.5, r=1.3, z=3)
txt(ax, 4, 10.5, "TINDAKAN YANG BELUM DIKERJAKAN — diungkap terbuka", 10.8, WARN, "bold", z=6)
txt(ax, 4, 5.2, "Nilai seed pricing.commission_pct untuk ride_motor di basis kode masih 20. Angka ini diubah dari Panel Admin → Tarif & Promo tanpa rilis ulang, dan WAJIB diturunkan ke ≤8% sebelum order roda dua\n"
                "pertama berjalan komersial. Perlakuan 'biaya jasa aplikasi Rp1.000' terhadap batas 8% adalah [ASUMSI] — perlu ditegaskan konsultan hukum sebelum tarif final ditetapkan.",
    9.3, INK, z=6, lspace=1.65, va="center")
save(fig, P("12-unit-economics.png"))

# ---------------------------------------------------------------- 13 TRAKSI
W, H = 13.0, 5.6
R = W / H
fig, ax = canvas(W, H)
big = [("34", "skenario transaksi\nujung-ke-ujung LOLOS", TEAL),
       ("68", "rute UI 3 aplikasi\ndirender 0 error", "#0EA5E9"),
       ("30", "migrasi basis data\nditerapkan", SERVICE["market"]),
       ("7", "bug nyata ditemukan\nuji & diperbaiki", ACCENT)]
for i, (n, l, col) in enumerate(big):
    x = 2 + i * 24.5
    card(ax, x, 62, 22.5, 32, fc=BG, ec=BORDER, r=1.8)
    txt(ax, x + 11.25, 80, n, 36, col, "bold", ha="center", z=6)
    txt(ax, x + 11.25, 69, l, 10.2, MUTED, ha="center", z=6, lspace=1.55)

status = [
    ("SIAP", SERVICE["market"], SUCCESS_LIGHT, [
        "3 aplikasi lengkap fitur — APK build-24, web live",
        "Basis data & 207 fungsi bisnis diterapkan",
        "Hapus akun in-app, kebijakan privasi & S&K online",
        "Uji unggah berkas 5 bucket + kebijakan akses",
        "Alur lupa kata sandi 19/19 pemeriksaan lolos",
        "Teks listing Play Store & jawaban Data Safety siap",
    ]),
    ("MENUNGGU PEMILIK", ACCENT, ACCENT_LIGHT, [
        "Kunci Midtrans (sandbox → produksi)",
        "Upload keystore + GitHub Secrets → AAB bertanda tangan",
        "Akun Google Play Console & pengisian listing",
        "Uji di HP nyata (kamera, GPS, notifikasi)",
    ]),
    ("BELUM ADA", MUTED, BGSOFT, [
        "BELUM LIVE KOMERSIAL — nol order berbayar",
        "Notifikasi saat aplikasi tertutup (perlu FCM aktif)",
        "Pemindahan earpiece ↔ loudspeaker (perlu modul native)",
        "Email laporan terjadwal (perlu SMTP/Resend)",
    ]),
]
cw = 31.0
for i, (t, col, bgc, lines) in enumerate(status):
    x = 2 + i * (cw + 1.5)
    card(ax, x, 8, cw, 50, fc=bgc, ec=col if col != MUTED else BORDER, lw=1.6, r=1.6)
    txt(ax, x + 2.5, 52, t, 12.5, col if col != MUTED else INK, "bold", z=6)
    for j, ln in enumerate(lines):
        yy = 45.5 - j * 6.4
        dot(ax, x + 3.4, yy + 0.9, 0.7, col, ratio=R, z=5)
        txt(ax, x + 5.4, yy + 1.0, ln, 9.4, INK if j or i != 2 else DANGER,
            "bold" if (i == 2 and j == 0) else "normal", z=6, lspace=1.5, va="center")
txt(ax, 2, 3.5, "Produk siap; perusahaan BELUM beroperasi komersial — tidak ada satu pun klaim traksi pengguna, GMV, atau pendapatan dalam deck ini.",
    9.4, FAINT, z=6)
save(fig, P("13-traksi.png"))
