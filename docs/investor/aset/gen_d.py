#!/usr/bin/env python3
"""Infografis 20 — tim & tata kelola."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _brand import *

OUT = os.path.dirname(os.path.abspath(__file__))
P = lambda n: os.path.join(OUT, n)

W, H = 13.0, 5.6
R = W / H
fig, ax = canvas(W, H)

# --- kiri: rantai kewenangan
txt(ax, 2, 95, "RANTAI KEWENANGAN", 11.5, TEAL_DARK, "bold", z=6)
chain = [
    ("RUPS", "Pemegang saham", TEAL_DARK),
    ("DEWAN KOMISARIS", "Menyetujui RKAP, belanja >Rp50 juta, perubahan\nstruktur, kebijakan tarif & komisi, penunjukan Head", TEAL),
    ("DIREKSI", "Menjalankan operasi harian; setiap direktur\nmemegang minimal satu KPI yang dieksekusi sendiri", "#0EA5E9"),
]
for i, (t, b, col) in enumerate(chain):
    y = 76 - i * 17.5
    card(ax, 2, y, 44, 13.5, fc=col, ec="none", r=1.4, z=3)
    txt(ax, 4.5, y + 9.4, t, 12.5, "#FFFFFF", "bold", z=6)
    txt(ax, 4.5, y + 5.4, b, 8.8, "#D7EAEC", z=6, lspace=1.55, va="top")
    if i < 2:
        arrow(ax, (24, y - 0.5), (24, y - 3.6), MUTED, 2.0, ms=12)

txt(ax, 2, 36, "PEMISAHAN TUGAS KEUANGAN — sudah didukung sistem", 11.5, TEAL_DARK, "bold", z=6)
sod = [("MENYETUJUI", "Head of Finance", SERVICE["market"]),
       ("MENGEKSEKUSI", "Finance & Accounting Staff", "#0EA5E9"),
       ("MEREKONSILIASI", "Treasury/Settlement Officer", ACCENT)]
for i, (t, who, col) in enumerate(sod):
    x = 2 + i * 15.0
    card(ax, x, 20, 13.5, 12.5, fc=BG, ec=col, lw=1.6, r=1.3, z=3)
    txt(ax, x + 6.75, 28.5, t, 9.2, col, "bold", ha="center", z=6)
    txt(ax, x + 6.75, 23.5, who, 8.6, MUTED, ha="center", z=6, lspace=1.5)
    if i < 2:
        arrow(ax, (x + 13.7, 26.2), (x + 14.8, 26.2), MUTED, 1.6, ms=10)
txt(ax, 2, 14, "Ditegakkan sistem: gerbang PIN admin, log aktivitas (audit_logs), laporan cascade\n(admin_finance_cascade), dan pusat keamanan dengan flag anti-fraud.",
    8.8, MUTED, z=6, lspace=1.6, va="top")

# --- kanan: tim & irama rapat
txt(ax, 52, 95, "TIM SAAT INI — dinyatakan apa adanya", 11.5, TEAL_DARK, "bold", z=6)
card(ax, 52, 66, 46, 25, fc=TINT, ec=TEAL, lw=1.6, r=1.5, z=3)
dot(ax, 57.5, 80, 4.0, TEAL, ratio=R, z=5)
txt(ax, 57.5, 80, "EPM", 12, "#FFFFFF", "bold", ha="center", va="center", z=7)
txt(ax, 64, 86, "Erza Pradipta Madana", 14, INK, "bold", z=6)
txt(ax, 64, 81.5, "Pemilik · Komisaris Utama · pendiri", 10, TEAL, "bold", z=6)
txt(ax, 64, 77.5, "Memegang seluruh keputusan yang menurut hukum hanya\ndapat dilakukan pemilik: akun Play Console, akun Midtrans,\nkeystore penandatanganan, dan penetapan kebijakan tarif.",
    8.8, MUTED, z=6, lspace=1.55, va="top")

card(ax, 52, 41, 46, 22, fc=ACCENT_LIGHT, ec=ACCENT, lw=1.5, r=1.4, z=3)
txt(ax, 54.5, 59.5, "POSISI DIREKSI BELUM DIISI  —  [ASUMSI] rencana rekrutmen", 10.5, WARN, "bold", z=6)
txt(ax, 54.5, 55.5, "Direktur Utama, CTO, COO, Head of Finance, dan Head of Legal &\nCompliance (merangkap DPO) direkrut pada Fase 0–1 sesuai model biaya.\nGaji tunai C-level ditahan di P25; selisihnya dikompensasi ESOP\n(kolam 10% [ASUMSI], vesting 4 tahun, cliff 1 tahun).",
    8.5, INK, z=6, lspace=1.6, va="top")

txt(ax, 52, 35, "IRAMA TATA KELOLA", 11.5, TEAL_DARK, "bold", z=6)
rit = [("HARIAN", "15 menit operasi kota", TEAL),
       ("MINGGUAN", "Rapat direksi", "#0EA5E9"),
       ("BULANAN", "Komisaris — paket laporan\ndari Portal Eksekutif", SERVICE["market"]),
       ("KUARTALAN", "Penetapan ulang OKR", ACCENT)]
for i, (t, b, col) in enumerate(rit):
    x = 52 + (i % 2) * 23.5
    y = 20 - (i // 2) * 13.0
    card(ax, x, y, 22, 11.5, fc=BG, ec=BORDER, r=1.3, z=3)
    txt(ax, x + 1.8, y + 8.0, t, 9.5, col, "bold", z=6)
    txt(ax, x + 1.8, y + 4.6, b, 8.4, MUTED, z=6, lspace=1.55, va="top")

save(fig, P("20-tata-kelola.png"))
