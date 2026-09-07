#!/usr/bin/env python3
"""Infografis 02-08 deck investor AntarKita."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _brand import *

OUT = os.path.dirname(os.path.abspath(__file__))
P = lambda n: os.path.join(OUT, n)

# ---------------------------------------------------------------- 02 MASALAH
W, H = 13.0, 5.9
R = W / H
fig, ax = canvas(W, H)

# panel kiri: dua kota
card(ax, 1.5, 6, 27, 88, fc=TEAL_DARK, ec="none", r=2.2)
txt(ax, 5, 86, "PASAR DUA KOTA", 12.5, MINT, "bold", z=7)
txt(ax, 5, 74, "2,08", 54, "#FFFFFF", "bold", z=7)
txt(ax, 5, 63, "juta jiwa", 17, MINT, "bold", z=7)
txt(ax, 5, 54.5, "Pekanbaru 1,14 juta (2024)\nPadang 939,85 ribu (2024)", 11.5, "#CFE6E8", z=7, lspace=1.55)
ax.plot([5, 24.5], [46, 46], color="#2E6E73", lw=1.4, zorder=7)
txt(ax, 5, 39, "Zona I tarif ojek daring", 11.5, MINT, "bold", z=7)
txt(ax, 5, 31, "Rp1.850 – Rp2.300", 20, "#FFFFFF", "bold", z=7)
txt(ax, 5, 24.5, "per km  ·  biaya jasa minimal\nRp9.250 – Rp11.500", 11, "#CFE6E8", z=7, lspace=1.5)
txt(ax, 5, 12, "Sumber: BPS via Databoks (2024);\nKepmenhub KP 564/2022 [S-24]", 9, "#8FBFC4", z=7, lspace=1.45)

items = [
    ("01", "Pasar tradisional tidak\nterlayani aplikasi nasional",
     "Sayur, ikan, bumbu, sembako di pasar kota\nmasih tunai dan tatap muka. Tidak ada\nkatalog harga harian per pedagang.", DANGER, DANGER_LIGHT),
    ("02", "Titipan antar kota jatuh ke\njalur informal",
     "Pekanbaru–Padang–Bukittinggi dilayani travel\ntanpa jejak digital, tanpa bukti serah terima,\ntanpa jaminan bila paket hilang.", ACCENT, ACCENT_LIGHT),
    ("03", "Likuiditas mitra tipis di\nkota tier-2",
     "Hanya ±20% mitra terdaftar yang aktif\n(700–800 rb dari 3,7 juta, Grab Des 2025).\nPelanggan menunggu, driver menganggur.", INFO, INFO_LIGHT),
    ("04", "Aturan main ditentukan\ndari pusat",
     "Tarif, promo, dan potongan diputuskan kantor\npusat nasional. Pedagang dan mitra lokal\nmenjadi penerima harga, bukan penentu.", TEAL, TEAL_LIGHT),
]
x0, y0, cw, ch, gx, gy = 31.5, 14, 33, 38.5, 2.5, 3.0
for i, (num, title, body, col, colbg) in enumerate(items):
    cx = x0 + (i % 2) * (cw + gx)
    cy = y0 + (1 - i // 2) * (ch + gy)
    card(ax, cx, cy, cw, ch, fc=BG, ec=BORDER, r=1.8)
    dot(ax, cx + 3.6, cy + ch - 8.5, 2.5, colbg, ratio=R, z=4)
    txt(ax, cx + 3.6, cy + ch - 8.6, num, 12, col, "bold", ha="center", z=6)
    txt(ax, cx + 8.4, cy + ch - 8.5, title, 14.5, INK, "bold", va="center", z=6, lspace=1.3)
    txt(ax, cx + 3.0, cy + ch - 15.5, body, 10.8, MUTED, z=6, lspace=1.6, va="top")
save(fig, P("02-masalah.png"))

# ---------------------------------------------------------------- 03 EKOSISTEM 8 LAYANAN
W, H = 13.0, 5.9
R = W / H
fig, ax = canvas(W, H)
import math
cx0, cy0 = 50, 50
dot(ax, cx0, cy0, 12.2, TEAL, ratio=R, z=5)
dot(ax, cx0, cy0, 13.6, TEAL_LIGHT, ratio=R, z=4)
txt(ax, cx0, cy0 + 4.5, "SATU AKUN", 9.5, MINT, "bold", ha="center", z=7)
txt(ax, cx0, cy0 - 1.5, "AntarKita", 22, "#FFFFFF", "bold", ha="center", z=7)
txt(ax, cx0, cy0 - 8, "satu dompet AntarPay", 9.5, MINT, ha="center", z=7)

svc = [
    ("AntarRide", "Ojek motor\ndalam kota", SERVICE["ride"]),
    ("AntarCar", "Mobil kelas\nHemat–Standar", SERVICE["car"]),
    ("AntarFood", "Warung, resto,\nUMKM", SERVICE["food"]),
    ("AntarSend", "Kirim dalam &\nantar kota", SERVICE["send"]),
    ("AntarShop", "Titip beli di\ntoko / minimarket", SERVICE["shop"]),
    ("AntarMart", "Pasar tradisional\n& pedagang", SERVICE["market"]),
    ("AntarBox", "Mobil box &\nhelper pindahan", SERVICE["box"]),
    ("AntarTravel", "Kursi, carter,\nsopir harian", SERVICE["travel"]),
]
rx, ry = 36.0, 34.0
bw, bh = 22.0, 15.5
for i, (name, desc, col) in enumerate(svc):
    a = math.radians(90 + i * 45)
    px = cx0 + rx * math.cos(a)
    py = cy0 + ry * math.sin(a)
    # garis dari tepi lingkaran ke tepi kartu
    dx, dy = px - cx0, py - cy0
    L = math.hypot(dx, dy)
    ux, uy = dx / L, dy / L
    sx, sy = cx0 + ux * 14.2, cy0 + uy * 14.2 * (13.6 / 12.2) * 0.92
    ax.plot([sx, px - ux * (bw / 2.4)], [sy, py - uy * (bh / 2.4)], color=BORDER, lw=1.6, zorder=1)
    card(ax, px - bw / 2, py - bh / 2, bw, bh, fc=BG, ec=BORDER, r=1.6, z=3)
    pill(ax, px - bw / 2 + 2.0, py + bh / 2 - 6.6, 3.0, 3.0, col, z=5)
    txt(ax, px - bw / 2 + 6.4, py + bh / 2 - 5.1, name, 13.5, INK, "bold", z=6)
    txt(ax, px - bw / 2 + 2.0, py - bh / 2 + 4.6, desc, 10.2, MUTED, z=6, lspace=1.5)
txt(ax, 50, 2.5, "8 layanan  ·  1 basis kode  ·  3 aplikasi  ·  1 backend  ·  1 dompet",
    9.5, FAINT, ha="center", z=7)
save(fig, P("03-layanan.png"))

# ---------------------------------------------------------------- 04 ANATOMI APLIKASI
W, H = 13.0, 6.35
R = W / H
fig, ax = canvas(W, H)

# LAPIS 1 — 3 aplikasi
txt(ax, 2.5, 96, "LAPIS 1 — APLIKASI", 10, TEAL, "bold", z=8)
apps = [
    ("Aplikasi Pelanggan", "id.antarkita.app", "26 rute UI · Android + web\nPesan 8 layanan, lacak peta,\nchat & telepon, AntarPay, SOS", TEAL),
    ("Aplikasi Mitra", "id.antarkita.mitra", "18 rute UI · Android + web\nDriver, merchant, pedagang pasar,\nmitra travel, mobil box", "#0EA5E9"),
    ("Admin + Portal Eksekutif", "web saja (/admin/)", "24 rute UI · tanpa rilis ulang\n24 panel operasi, keuangan cascade,\nP&L, PIN & pusat keamanan", "#7B61FF"),
]
aw, ah = 30.0, 21.5
for i, (name, pkg, body, col) in enumerate(apps):
    x = 2.5 + i * (aw + 2.75)
    card(ax, x, 71, aw, ah, fc=BG, ec=col, lw=1.8, r=1.8)
    pill(ax, x + 2.2, 71 + ah - 5.6, 2.6, 2.6, col, z=5)
    txt(ax, x + 6.0, 71 + ah - 4.3, name, 13.5, INK, "bold", z=6)
    txt(ax, x + 2.2, 71 + ah - 9.2, pkg, 9.5, col, "bold", z=6)
    txt(ax, x + 2.2, 71 + 5.6, body, 10.2, MUTED, z=6, lspace=1.55)

for i in range(3):
    x = 2.5 + i * (aw + 2.75) + aw / 2
    arrow(ax, (x, 70.4), (x, 64.0), TEAL, 2.0, ms=13)

# LAPIS 2 — backend
card(ax, 2.5, 20.0, 63, 43.0, fc=TINT, ec=TEAL, lw=1.8, r=2.0)
txt(ax, 5.0, 59.6, "LAPIS 2 — BACKEND SUPABASE (PostgreSQL terkelola)  ·  akses lewat HTTPS + JWT, Supabase JS v2, Realtime WebSocket", 11.0, TEAL_DARK, "bold", z=6)
be = [
    ("Postgres + RLS", "66 tabel · 98 kebijakan\nRow Level Security"),
    ("Fungsi bisnis", "207 fungsi SQL\n(create_order, calc_fare,\nadmin_finance_cascade)"),
    ("Auth & peran", "pelanggan · driver ·\nmerchant · vendor ·\ntravel · admin"),
    ("Realtime", "order, chat, notifikasi,\nsinyal panggilan,\napp_settings langsung"),
    ("Edge Functions", "midtrans-create\nmidtrans-webhook\npush-send"),
    ("pg_cron", "rilis order terjadwal,\nlaporan, retensi,\nantrean push"),
    ("Storage (5 bucket)", "avatars · documents ·\nmerchant-images ·\npromo-images · proofs"),
    ("Audit & keamanan", "audit_logs, security_events,\nfraud_flags, PIN admin"),
]
bw2, bh2 = 14.4, 14.2
for i, (t, b) in enumerate(be):
    x = 5.0 + (i % 4) * (bw2 + 1.6)
    y = 41.5 - (i // 4) * (bh2 + 1.5)
    card(ax, x, y, bw2, bh2, fc=BG, ec=BORDER, r=1.4, z=3)
    txt(ax, x + 1.3, y + bh2 - 3.4, t, 10.3, TEAL_DARK, "bold", z=6)
    txt(ax, x + 1.3, y + 4.6, b, 8.6, MUTED, z=6, lspace=1.6)

# LAPIS 3 — integrasi
card(ax, 68.5, 20.0, 29, 43.0, fc=BG, ec=ACCENT, lw=1.8, r=2.0)
txt(ax, 71.0, 59.6, "LAPIS 3 — INTEGRASI LUAR", 11.0, WARN, "bold", z=6)
integ = [
    ("Midtrans Snap", "top-up QRIS, GoPay,\nShopeePay, VA bank", ACCENT),
    ("Peta & rute", "OSM / OSRM /\nNominatim; siap Google", SERVICE["market"]),
    ("Push FCM v1", "push_tokens + antrean\npush_outbox", INFO),
    ("WebRTC + STUN/TURN", "telepon dalam aplikasi,\nnomor HP disembunyikan", SERVICE["send"]),
]
for i, (t, b, col) in enumerate(integ):
    y = 47.0 - i * 8.6
    card(ax, 71.0, y, 24, 7.0, fc=BGSOFT, ec="none", r=1.2, z=3)
    pill(ax, 72.2, y + 2.4, 2.2, 2.2, col, z=5)
    txt(ax, 75.6, y + 5.0, t, 10.3, INK, "bold", z=6)
    txt(ax, 75.6, y + 2.0, b, 8.6, MUTED, z=6, lspace=1.5)
arrow(ax, (65.9, 45), (68.1, 45), ACCENT, 2.0, ms=13)
arrow(ax, (68.1, 41), (65.9, 41), ACCENT, 2.0, ms=13)

# footer angka
stats = [("3", "aplikasi"), ("66", "tabel"), ("207", "fungsi SQL"), ("98", "kebijakan RLS"),
         ("30", "migrasi"), ("68", "rute UI teruji")]
for i, (n, l) in enumerate(stats):
    x = 4.0 + i * 15.8
    txt(ax, x, 12.5, n, 24, TEAL, "bold", z=6)
    txt(ax, x, 5.5, l, 10.2, MUTED, z=6)
save(fig, P("04-anatomi.png"))

# ---------------------------------------------------------------- 05 PERJALANAN PELANGGAN
W, H = 13.0, 5.3
R = W / H
fig, ax = canvas(W, H)
steps = [
    ("1", "PESAN", "Pilih layanan, titik jemput\ndari peta atau alamat\ntersimpan", "Tarif final tampil\nsebelum tombol pesan", TEAL),
    ("2", "TARIF", "calc_fare(): tarif dasar +\nper km × sesi harga +\nkelas kendaraan", "Harga dinamis 1,25×\nsaat 0 driver online", "#0EA5E9"),
    ("3", "DISPATCH", "Radius jemput per layanan\n(motor 5 km, box 15 km) +\nprioritas menurut rating", "Rating ≥4,8 lihat duluan;\n<4,0 tunggu 75 detik", SERVICE["market"]),
    ("4", "PERJALANAN", "Driver terima → jemput →\nPIN serah terima → antar;\nlacak di peta, chat & telepon", "Menunggu >5 menit:\nlayar permohonan maaf", ACCENT),
    ("5", "SELESAI", "Foto bukti / nota belanja,\nstatus completed,\nrating + tip", "Bukti bisa dibuka\npelanggan & admin", SERVICE["send"]),
    ("6", "BAYAR", "AntarPay dipotong otomatis\natau tunai; saldo driver\nbertambah seketika", "Contoh uji: total Rp9.000,\ndriver terima Rp6.400", TEAL_DARK),
]
bw, bh = 14.6, 50
gap = (96 - 6 * bw) / 5
for i, (n, ttl, body, note, col) in enumerate(steps):
    x = 2 + i * (bw + gap)
    card(ax, x, 27, bw, bh, fc=BG, ec=BORDER, r=1.6)
    card(ax, x, 27 + bh - 11, bw, 11, fc=col, ec="none", r=1.6, z=3)
    card(ax, x, 27 + bh - 13.5, bw, 4.0, fc=col, ec="none", r=0.0, z=3)
    txt(ax, x + bw / 2, 27 + bh - 5.5, ttl, 13.5, "#FFFFFF", "bold", ha="center", z=6)
    txt(ax, x + 1.6, 27 + bh - 17.5, body, 9.8, INK, z=6, lspace=1.65, va="top")
    card(ax, x + 1.2, 29.5, bw - 2.4, 12.5, fc=BGSOFT, ec="none", r=1.1, z=3)
    txt(ax, x + 2.4, 35.7, note, 8.8, col, "bold", z=6, lspace=1.65)
    dot(ax, x + bw / 2, 84.0, 3.6, col, ratio=R, z=6)
    dot(ax, x + bw / 2, 84.0, 4.6, BG, ec=col, lw=1.6, ratio=R, z=5)
    txt(ax, x + bw / 2, 83.9, n, 15, "#FFFFFF", "bold", ha="center", z=8)
    if i < 5:
        arrow(ax, (x + bw + 0.6, 52), (x + bw + gap - 0.6, 52), col, 2.2, ms=14)
ax.plot([2 + bw / 2, 96 - bw / 2], [84.0, 84.0], color=BORDER, lw=2.0, zorder=2)
txt(ax, 2, 17, "Setiap langkah dapat diaudit dari tabel  orders · order_events · order_pins · ratings · wallet_transactions",
    10.5, MUTED, z=6)
save(fig, P("05-perjalanan-pelanggan.png"))

# ---------------------------------------------------------------- 06 PERJALANAN MITRA
W, H = 13.0, 4.9
R = W / H
fig, ax = canvas(W, H)

def lane(y, h, title, sub, col, steps_):
    card(ax, 2, y, 96, h, fc=BGSOFT, ec="none", r=1.8, z=1)
    card(ax, 2, y, 21, h, fc=col, ec="none", r=1.8, z=2)
    card(ax, 20, y, 3, h, fc=col, ec="none", r=0.0, z=2)
    txt(ax, 4.2, y + h - 9, title, 13.5, "#FFFFFF", "bold", z=6, lspace=1.35)
    txt(ax, 4.2, y + h - 21, sub, 9.8, "#FFFFFF", z=6, lspace=1.6, va="top", alpha=0.9)
    n = len(steps_)
    bw = (73 - (n - 1) * 2.2) / n
    for i, (t, b) in enumerate(steps_):
        x = 24.5 + i * (bw + 2.2)
        card(ax, x, y + 3.5, bw, h - 7, fc=BG, ec=BORDER, r=1.4, z=3)
        txt(ax, x + 1.4, y + h - 8.5, f"{i+1}", 11, col, "bold", z=6)
        txt(ax, x + 4.6, y + h - 8.5, t, 10.8, INK, "bold", z=6)
        txt(ax, x + 1.4, y + h - 14.5, b, 8.9, MUTED, z=6, lspace=1.65, va="top")
        if i < n - 1:
            arrow(ax, (x + bw + 0.25, y + 8.0), (x + bw + 1.95, y + 8.0), col, 1.8, ms=11)

lane(57, 37, "MITRA DRIVER", "Motor · mobil · mobil box\n7 layanan dari satu\naplikasi", TEAL, [
    ("Daftar", "Pilih jenis mitra, isi\ntipe → merek → model →\nbahan bakar dari katalog"),
    ("Verifikasi", "Unggah SIM, STNK, KTP,\nfoto kendaraan; skor\nauto-verifikasi ≥80 → aktif"),
    ("Kelas kendaraan", "Sistem menetapkan\nmotor_standard /\nmotor_ev / kelas mobil"),
    ("Terima order", "Feed order dalam radius;\npendapatan bersih tampil\nsebelum menerima"),
    ("Antar & selesai", "Navigasi, PIN serah terima,\nfoto bukti, chat & telepon\ntanpa membuka nomor HP"),
    ("Cairkan", "Saldo naik seketika;\npenarikan otomatis bila\ntidak ada flag fraud"),
])
lane(14, 37, "MERCHANT &\nPEDAGANG PASAR", "Warung, resto, toko,\nlapak pasar tradisional", SERVICE["market"], [
    ("Daftar lapak", "Pilih peran merchant atau\npedagang pasar; pilih pasar\ndan kategori dagangan"),
    ("Dokumen usaha", "NPWP, izin usaha,\nsertifikat halal → badge\nkepercayaan di aplikasi"),
    ("Isi katalog", "Menu / barang, foto, stok,\njam buka; harga pasar\ndiperbarui harian"),
    ("Pagar harga", "Harga >2× acuan ditolak;\n1,35× wajib nota, bila\ntidak → flag anti-fraud"),
    ("Terima pesanan", "Terima/tolak, atur waktu\nsiap, pantau driver\npenjemput, chat pelanggan"),
    ("Settlement", "Komisi merchant 15%\ndipotong otomatis; saldo\ndicairkan ke rekening bank"),
])
save(fig, P("06-perjalanan-mitra.png"))

# ---------------------------------------------------------------- 07 ANTARPAY
W, H = 13.0, 6.1
R = W / H
fig, ax = canvas(W, H)

def node(x, y, w, h, title, body, col, fc=BG, tc=INK):
    card(ax, x, y, w, h, fc=fc, ec=col, lw=1.8, r=1.5, z=3)
    txt(ax, x + w / 2, y + h - 5.2, title, 11.8, tc, "bold", ha="center", z=6)
    txt(ax, x + w / 2, y + h / 2 - 4.0, body, 9.2, MUTED if fc == BG else "#D7EAEC",
        ha="center", z=6, lspace=1.6)

txt(ax, 2, 95, "MASUK", 10, TEAL, "bold", z=8)
node(2, 68, 20, 20, "Pelanggan", "Top-up saldo\nAntarPay", TEAL)
node(2, 42, 20, 20, "Midtrans Snap", "QRIS · GoPay ·\nShopeePay · VA bank\n(otomatis, webhook)", ACCENT)
node(2, 16, 20, 20, "Transfer manual", "Unggah bukti →\nadmin verifikasi →\nadmin_review_topup", "#0EA5E9")

node(30, 40, 22, 34, "DOMPET ANTARPAY", "Dompet tertutup\n(closed loop)\n\nwallets +\nwallet_transactions\n\nSetiap mutasi tercatat\ndan direkonsiliasi", TEAL, fc=TEAL_DARK, tc="#FFFFFF")

txt(ax, 60, 95, "KELUAR", 10, TEAL, "bold", z=8)
node(60, 68, 17.5, 20, "Bayar order", "Saldo dipotong\nsaat order dibuat", TEAL)
node(80.5, 68, 17.5, 20, "Refund", "Order batal →\nrefund penuh\n(uji S6: Rp172.000)", SERVICE["market"])
node(60, 42, 17.5, 20, "Saldo mitra", "Driver / merchant\nditambah bersih\nsetelah komisi", "#0EA5E9")
node(80.5, 42, 17.5, 20, "Penarikan", "Otomatis bila bersih;\nmanual + PIN admin\nbila ada flag fraud", SERVICE["send"])
node(60, 16, 38, 20, "Pendapatan platform", "platform_fee + komisi layanan + jasa belanja + bagi hasil travel 80/20\nMasuk laporan admin_finance_cascade per layanan / kota / order", TEAL)

for y in (78, 52, 26):
    arrow(ax, (22.6, y), (29.4, y), TEAL, 2.2, ms=13)
for y, yy in ((78, 78), (52, 52)):
    arrow(ax, (52.6, yy), (59.4, yy), TEAL, 2.2, ms=13)
arrow(ax, (52.6, 46), (59.4, 26), TEAL, 2.2, ms=13, rad=-0.15)

card(ax, 2, 2, 96, 11.5, fc=ACCENT_LIGHT, ec=ACCENT, lw=1.6, r=1.4, z=3)
txt(ax, 4, 9.6, "CATATAN KEPATUHAN BANK INDONESIA — diungkap di muka, bukan catatan kaki", 11.5, WARN, "bold", z=6)
txt(ax, 4, 4.8, "PBI 20/6/2018: penyelenggara uang elektronik — closed loop maupun open loop — dengan dana float ≥ Rp1 miliar WAJIB berizin Bank Indonesia [S-31].\n"
                "Selama AntarKita hanya menjadi merchant dari PJP berizin (Midtrans), kewajiban izin ada di PJP — ini [ASUMSI] hukum kerja yang wajib divalidasi konsultan sistem pembayaran.",
    9.4, INK, z=6, lspace=1.6, va="center")
save(fig, P("07-antarpay.png"))
