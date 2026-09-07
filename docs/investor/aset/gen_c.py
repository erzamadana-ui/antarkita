#!/usr/bin/env python3
"""Infografis 14-19 deck investor AntarKita."""
import os, sys, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _brand import *

OUT = os.path.dirname(os.path.abspath(__file__))
P = lambda n: os.path.join(OUT, n)

# ---------------------------------------------------------------- 14 PETA JALAN
W, H = 13.0, 5.5
R = W / H
fig, ax = canvas(W, H)
phases = [
    ("FASE 0", "Bulan 1–3", "Pra-peluncuran", [
        "Kunci Midtrans sandbox → uji top-up nyata",
        "Keystore + AAB bertanda tangan",
        "Play Console: internal → closed testing",
        "NIB, KBLI 2025, TDPSE (PSE Komdigi)",
        "Uji tertutup Pekanbaru",
    ], "9 orang", TEAL_DARK),
    ("FASE 1", "Bulan 4–12", "Peluncuran Pekanbaru", [
        "Aktivasi produksi Midtrans",
        "Akuisisi mitra & merchant Pekanbaru",
        "Likuiditas pasar satu kota",
        "Unit economics positif per order",
        "DPO aktif sejak hari pertama komersial",
    ], "24 orang", TEAL),
    ("FASE 2", "Bulan 13–24", "Padang + skala", [
        "Replikasi playbook ke Padang",
        "Titipan antar kota lewat mitra travel",
        "Treasury/Settlement Officer masuk",
        "Pantau ambang dana float Rp1 miliar",
        "Dua kota profitabel di tingkat kota",
    ], "42 orang", "#0EA5E9"),
    ("FASE 3", "Bulan 25–36", "Ekspansi Sumatera", [
        "2 kota tambahan Sumatera",
        "Pola +1 City Manager + 2 Ops per kota",
        "Tanpa menambah lapisan organisasi",
        "Indikatif — [ASUMSI], bukan komitmen",
    ], "60 orang [ASUMSI]", ACCENT),
]
cw = 23.0
gap = (96 - 4 * cw) / 3
ax.plot([2 + cw / 2, 98 - cw / 2], [88, 88], color=BORDER, lw=2.4, zorder=1)
for i, (tag, per, name, items, hc, col) in enumerate(phases):
    x = 2 + i * (cw + gap)
    dot(ax, x + cw / 2, 88, 2.6, col, ratio=R, z=5)
    dot(ax, x + cw / 2, 88, 3.6, BG, ec=col, lw=1.8, ratio=R, z=4)
    card(ax, x, 16, cw, 65, fc=BG, ec=BORDER, r=1.8)
    card(ax, x, 69, cw, 12, fc=col, ec="none", r=1.8, z=3)
    card(ax, x, 69, cw, 4, fc=col, ec="none", r=0.0, z=3)
    txt(ax, x + 2.2, 77.0, tag, 12.5, "#FFFFFF", "bold", z=6)
    txt(ax, x + 2.2, 72.2, per, 9.5, "#FFFFFF", z=6, alpha=0.92)
    txt(ax, x + 2.2, 63.5, name, 12.5, INK, "bold", z=6)
    for j, it in enumerate(items):
        yy = 56.5 - j * 6.6
        dot(ax, x + 3.0, yy + 0.9, 0.62, col, ratio=R, z=5)
        txt(ax, x + 4.8, yy + 1.0, it, 9.0, MUTED, z=6, va="center")
    pill(ax, x + 2.2, 18.0, cw - 4.4, 5.4, BGSOFT, z=3)
    txt(ax, x + cw / 2, 20.7, hc, 9.8, col, "bold", ha="center", z=6)
txt(ax, 2, 8, "Fase 0–2 adalah keputusan mengikat Direktur Utama dan sudah dianggarkan baris-per-baris; Fase 3 bersifat indikatif dan ditandai [ASUMSI].",
    9.2, FAINT, z=6)
save(fig, P("14-peta-jalan.png"))

# ---------------------------------------------------------------- 15 ORGANISASI
W, H = 13.0, 5.8
R = W / H
fig, ax = canvas(W, H)

def box(x, y, w, h, t, sub, fc, ec, tc="#FFFFFF", sc=None, ts=11.5):
    card(ax, x, y, w, h, fc=fc, ec=ec, lw=1.6, r=1.3, z=3)
    if sub:
        txt(ax, x + w / 2, y + h * 0.62, t, ts, tc, "bold", ha="center", z=6)
        txt(ax, x + w / 2, y + h * 0.26, sub, 8.6, sc or tc, ha="center", z=6, lspace=1.4)
    else:
        txt(ax, x + w / 2, y + h / 2, t, ts, tc, "bold", ha="center", va="center", z=6, lspace=1.35)

box(38, 88, 24, 9, "DEWAN KOMISARIS", "menyetujui RKAP, belanja >Rp50 juta,\nkebijakan tarif & komisi", TEAL_DARK, "none", "#FFFFFF", "#BFE9EA")
box(38, 74, 24, 9, "DIREKTUR UTAMA", "pemegang KPI kas & runway", TEAL, "none", "#FFFFFF", "#CFE6E8")
arrow(ax, (50, 87.6), (50, 83.4), MUTED, 1.6, ms=10, z=4)

units = [
    ("DIREKTORAT\nTEKNOLOGI", "CTO", ["Engineering Manager", "Mobile Engineer ×3", "Backend Engineer ×4",
                                      "QA Engineer ×2", "Junior SWE ×2", "Product Designer ×2", "Data Analyst"], "#0EA5E9", 16),
    ("DIREKTORAT\nOPERASI", "COO", ["City Manager Pekanbaru", "City Manager Padang", "Ops Supervisor ×2",
                                    "Partner Acquisition ×4", "Head of Customer Exp.", "CS Agent ×5",
                                    "Trust & Safety Officer"], TEAL, 16),
    ("KEUANGAN", "Head of Finance\n(merangkap Dir. Keuangan)", ["Finance & Accounting ×2",
                                                                "Treasury/Settlement Officer"], SERVICE["market"], 4),
    ("LEGAL &\nKEPATUHAN", "Head of Legal\n(merangkap DPO)", ["Wajib sejak Fase 1:", "UU 27/2022 Ps.53 +",
                                                              "Putusan MK 151/PUU-XXII/2024"], SERVICE["send"], 1),
    ("GROWTH &\nPARTNERSHIP", "Head of Growth", ["Digital Marketing Staff", "Merchant Acquisition Officer",
                                                 "KPI: pendapatan non-komisi"], ACCENT, 3),
]
uw = 18.0
ugap = (96 - 5 * uw) / 4
for i, (name, lead, team, col, n2) in enumerate(units):
    x = 2 + i * (uw + ugap)
    box(x, 55, uw, 11, name, None, col, "none", "#FFFFFF", ts=10.5)
    arrow(ax, (50, 73.6), (x + uw / 2, 66.4), MUTED, 1.4, ms=9, z=2, rad=0.0)
    card(ax, x, 46.5, uw, 7.5, fc=BG, ec=col, lw=1.4, r=1.2, z=3)
    txt(ax, x + uw / 2, 50.2, lead, 8.8, INK, "bold", ha="center", va="center", z=6, lspace=1.35)
    card(ax, x, 16, uw, 29, fc=BGSOFT, ec="none", r=1.2, z=2)
    for j, m in enumerate(team):
        txt(ax, x + 1.6, 42.8 - j * 3.3, "· " + m, 8.4, MUTED, z=6)
    pill(ax, x + 1.6, 16.8, uw - 3.2, 4.6, "#FFFFFF", z=3)
    txt(ax, x + uw / 2, 19.1, f"{n2} orang di Fase 2", 8.4, col, "bold", ha="center", z=6)

card(ax, 2, 3.5, 96, 9.5, fc=TINT, ec="none", r=1.3, z=2)
txt(ax, 4, 10.0, "HR & GA Generalist — garis fungsional putus ke seluruh direktorat (rekrutmen, payroll dua struktur, BPJS, kantor dua kota).", 9.6, TEAL_DARK, "bold", z=6)
txt(ax, 4, 5.4, "Prinsip: rentang kendali maksimal 7 orang · satu atasan tunggal · tidak ada peran yang hanya mengawasi · pemisahan tugas keuangan (penyetuju ≠ pelaksana ≠ perekonsiliasi).",
    9.0, MUTED, z=6, va="center")
save(fig, P("15-organisasi.png"))

# ---------------------------------------------------------------- 16 BIAYA SDM
W, H = 13.0, 5.7
R = W / H
fig, ax = canvas(W, H)
txt(ax, 2, 95, "BIAYA SDM PER FASE — dari model biaya SDM (skenario Dasar, penawaran di P50)", 13, INK, "bold", z=6)

data = [("Fase 0", 9, 230.3, TEAL_DARK), ("Fase 1", 24, 435.6, TEAL), ("Fase 2", 42, 636.3, "#0EA5E9")]
bx, by, bmaxh = 6.0, 24.0, 46.0
bw = 11.0
for i, (name, hc, cost, col) in enumerate(data):
    x = bx + i * 15.5
    h = bmaxh * cost / 700.0
    card(ax, x, by, bw, h, fc=col, ec="none", r=1.0, z=3)
    txt(ax, x + bw / 2, by + h + 6.0, f"Rp{cost:.1f}".replace(".", ",") + " jt", 13.5, col, "bold", ha="center", z=6)
    txt(ax, x + bw / 2, by + h + 2.2, "per bulan", 8.8, MUTED, ha="center", z=6)
    txt(ax, x + bw / 2, by - 4.5, name, 11.5, INK, "bold", ha="center", z=6)
    txt(ax, x + bw / 2, by - 9.0, f"{hc} orang", 9.6, MUTED, ha="center", z=6)
    txt(ax, x + bw / 2, by + h / 2, f"Rp{cost/hc:.1f}".replace(".", ",") + " jt\nper orang", 9.2, "#FFFFFF",
        "bold", ha="center", va="center", z=7, lspace=1.45)
ax.plot([4, 51], [by, by], color=BORDER, lw=1.6, zorder=2)

sums = [
    ("Rp 11,69 miliar", "Biaya SDM kumulatif\nbulan 1–24", TEAL),
    ("Rp 1,93 miliar", "Biaya non-gaji SDM\nkumulatif 24 bulan  [ASUMSI]", ACCENT),
    ("Rp 13,62 miliar", "TOTAL biaya terkait SDM\n24 bulan", TEAL_DARK),
    ("1,19×", "Kebijakan biaya perusahaan\n= gaji pokok × 1,19", "#0EA5E9"),
]
for i, (n, l, col) in enumerate(sums):
    x = 56 + (i % 2) * 21.5
    y = 52 - (i // 2) * 26
    card(ax, x, y, 20, 22, fc=BG, ec=BORDER, r=1.5)
    txt(ax, x + 10, y + 14.5, n, 14.5, col, "bold", ha="center", z=6)
    txt(ax, x + 10, y + 5.5, l, 9.0, MUTED, ha="center", z=6, lspace=1.6)

card(ax, 2, 2, 96, 12, fc=BGSOFT, ec="none", r=1.3, z=2)
txt(ax, 4, 10.2, "DASAR YANG BERSUMBER vs YANG DIASUMSIKAN", 10.5, TEAL_DARK, "bold", z=6)
txt(ax, 4, 4.8, "BERSUMBER: UMK Pekanbaru Rp3.998.179 & Padang Rp3.182.955 (2026) [S-01][S-03][S-05]; iuran BPJS TK+JKN pemberi kerja ≈9–11% [S-07][S-12]; akrual THR 8,33% [S-16]; batas upah JP Rp11.086.300 [S-09].\n"
                "[ASUMSI]: SELURUH pita gaji per posisi — tidak ditemukan satu pun benchmark gaji terbuka untuk Pekanbaru/Padang. Wajib divalidasi dengan minimal 5 penawaran gaji riil sebelum dipakai sebagai klaim.",
    9.0, INK, z=6, lspace=1.65, va="center")
txt(ax, 2, 88, "Skenario Hemat (P25, 36 orang) Rp8,02 miliar · Dasar (P50, 42 orang) Rp11,69 miliar · Agresif (P75, 48 orang) Rp16,00 miliar — kumulatif 24 bulan",
    9.4, MUTED, z=6)
save(fig, P("16-biaya-sdm.png"))

# ---------------------------------------------------------------- 17 KEPATUHAN
W, H = 13.0, 5.4
R = W / H
fig, ax = canvas(W, H)
txt(ax, 2, 95, "EMPAT KEWAJIBAN YANG MENENTUKAN BOLEH-TIDAKNYA BEROPERASI", 13.5, INK, "bold", z=6)
txt(ax, 2, 89, "Kepatuhan diperlakukan sebagai kekuatan struktural, bukan catatan kaki: Head of Legal & Compliance merangkap DPO ada sejak Fase 1, sebelum order komersial pertama.", 10, MUTED, z=6)

items = [
    ("PSE Lingkup Privat", "Komdigi (eks Kominfo)",
     "Wajib mendaftar SEBELUM sistem dipakai pengguna.\nAlur: NIB di OSS → data teknis → TDPSE terbit.",
     "Sanksi: pemutusan akses (pemblokiran)", "Permenkominfo 5/2020 jo. 10/2021 [S-34]", DANGER),
    ("Penunjukan DPO", "UU 27/2022 Pasal 53 — Pelindungan Data Pribadi",
     "Putusan MK 151/PUU-XXII/2024 mengubah “dan” menjadi\n“dan/atau” → satu kriteria saja sudah mewajibkan DPO.\nSuper-app memproses lokasi real-time skala besar.",
     "Sanksi: denda hingga 2% pendapatan tahunan", "UU 27/2022 [S-37]; Putusan MK [S-39]", SERVICE["send"]),
    ("KBLI 53200 — Aktivitas Kurir", "PerBPS 7/2025 · PP 28/2025",
     "Kegiatan BERISIKO TINGGI. Modal minimum Rp500 juta\n+ proposal usaha 5 tahun + izin sektor pos.\nBatas konversi KBLI 2020→2025 di OSS: 18 Juni 2026.",
     "Sudah masuk rencana permodalan", "Klinik Hukumonline 20 Apr 2026 [S-41][S-42]", ACCENT),
    ("Izin Bank Indonesia", "PBI 20/6/PBI/2018",
     "Dompet closed loop TIDAK bebas selamanya: begitu dana\nfloat agregat pengguna menembus Rp1 miliar, izin BI\nmenjadi wajib. Treasury Officer memantau ambang ini.",
     "Milestone regulasi + pos biaya, bukan kejutan", "Bank Indonesia [S-31]", TEAL),
]
cw, ch = 47.0, 37.0
for i, (t, law, body, impact, src, col) in enumerate(items):
    x = 2 + (i % 2) * (cw + 2.0)
    y = 45 - (i // 2) * (ch + 2.5)
    card(ax, x, y, cw, ch, fc=BG, ec=BORDER, r=1.7)
    card(ax, x, y, 1.1, ch, fc=col, ec="none", r=0.0, z=3)
    txt(ax, x + 3.4, y + ch - 6.5, t, 13.0, INK, "bold", z=6, lspace=1.3)
    txt(ax, x + 3.4, y + ch - 12.0, law, 9.2, col, "bold", z=6)
    txt(ax, x + 3.4, y + ch - 16.5, body, 9.4, MUTED, z=6, lspace=1.65, va="top")
    pill(ax, x + 3.4, y + 4.4, cw - 7.0, 5.2, BGSOFT, z=3)
    txt(ax, x + 5.4, y + 7.0, impact, 8.8, col, "bold", z=6)
    txt(ax, x + 3.4, y + 1.8, src, 8.2, FAINT, z=6)
save(fig, P("17-kepatuhan.png"))

# ---------------------------------------------------------------- 18 RISIKO
W, H = 13.0, 6.3
R = W / H
fig, ax = canvas(W, H)
gx0, gy0, gx1, gy1 = 6, 26, 42, 92
card(ax, gx0, gy0, gx1 - gx0, gy1 - gy0, fc=BGSOFT, ec="none", r=1.2, z=1)
for k in (1, 2):
    ax.plot([gx0 + k * (gx1 - gx0) / 3, gx0 + k * (gx1 - gx0) / 3], [gy0, gy1], color="#FFFFFF", lw=2.4, zorder=2)
    ax.plot([gx0, gx1], [gy0 + k * (gy1 - gy0) / 3, gy0 + k * (gy1 - gy0) / 3], color="#FFFFFF", lw=2.4, zorder=2)
txt(ax, (gx0 + gx1) / 2, gy0 - 5.0, "DAMPAK  →", 10, MUTED, "bold", ha="center", z=6)
ax.text(gx0 - 3.2, (gy0 + gy1) / 2, "KEMUNGKINAN  →", fontsize=10, color=MUTED, fontweight="bold",
        ha="center", va="center", rotation=90, zorder=6)
risks = [
    ("R1", 2.6, 2.5, DANGER), ("R2", 2.6, 1.5, ACCENT), ("R3", 1.5, 2.5, ACCENT),
    ("R4", 1.5, 1.5, TEAL), ("R5", 2.5, 0.5, TEAL), ("R6", 0.5, 1.5, TEAL),
]
for tag, cx, cy, col in risks:
    px = gx0 + (cx / 3) * (gx1 - gx0)
    py = gy0 + (cy / 3) * (gy1 - gy0)
    dot(ax, px, py, 3.0, col, ratio=R, z=5)
    txt(ax, px, py, tag, 11, "#FFFFFF", "bold", ha="center", va="center", z=7)

detail = [
    ("R1", "Status kemitraan mitra pengemudi berubah menjadi hubungan kerja",
     "Struktur biaya berubah fundamental — UMK, THR, JHT, JP untuk ribuan mitra.",
     "Bauran layanan non-roda-dua & pendapatan non-komisi sejak awal; model biaya diuji ulang tiap kuartal; isu dipantau Head of Legal.", DANGER),
    ("R2", "Aturan tarif lanjutan (rencana terbit Sep 2026) memperluas batas 8%",
     "Take rate food, kirim barang, dan mobil ikut dibatasi.",
     "Sumber pendapatan non-komisi disiapkan lebih dulu; tarif dapat diubah dari panel admin tanpa rilis ulang.", ACCENT),
    ("R3", "Konsolidasi Grab–GoTo menghasilkan pemain dominan",
     "Tekanan promo dan supply mitra di dua kota.",
     "Fokus pada segmen yang tidak dilayani (pasar tradisional, titipan antar kota); biaya operasi rendah, tim 24 orang.", ACCENT),
    ("R4", "Dana float dompet menembus Rp1 miliar tanpa izin BI",
     "Risiko sanksi & penghentian layanan dompet.",
     "Ambang dipantau Treasury/Settlement Officer; pengurusan izin dimulai jauh sebelum ambang tercapai.", TEAL),
    ("R5", "Insiden data pribadi (UU PDP)",
     "Denda hingga 2% pendapatan tahunan + kerusakan reputasi.",
     "DPO sejak Fase 1; RLS 98 kebijakan; audit_logs & security_events; masking data pribadi di panel admin.", TEAL),
    ("R6", "Gagal merekrut engineer senior di Pekanbaru/Padang",
     "Peta jalan produk melambat.",
     "Sebagian posisi dirancang remote dengan payroll Pekanbaru; jalur kaderisasi Junior SWE lokal; ESOP menggantikan tunai.", TEAL),
]
import textwrap
cur = 97.0
for i, (tag, t, dmp, mit, col) in enumerate(detail):
    tl = textwrap.wrap(t, 66)
    dl = textwrap.wrap("Dampak: " + dmp, 96)
    ml = textwrap.wrap("Mitigasi: " + mit, 96)
    dot(ax, 49.5, cur - 2.2, 2.0, col, ratio=R, z=5)
    txt(ax, 49.5, cur - 2.2, tag, 8.8, "#FFFFFF", "bold", ha="center", va="center", z=7)
    y = cur
    txt(ax, 53.5, y, "\n".join(tl), 10.0, INK, "bold", z=6, va="top", lspace=1.4)
    y -= 3.1 * len(tl) + 0.6
    txt(ax, 53.5, y, "\n".join(dl), 8.4, col, z=6, va="top", lspace=1.5)
    y -= 2.8 * len(dl) + 0.3
    txt(ax, 53.5, y, "\n".join(ml), 8.4, MUTED, z=6, va="top", lspace=1.5)
    y -= 2.8 * len(ml)
    cur = y - 2.8
txt(ax, 6, 16, "Risiko nomor satu (R1) adalah fondasi seluruh struktur\nbiaya dan sedang berada di bawah tekanan politik &\nregulasi aktif — dicatat sebagai risiko tingkat pertama,\nbukan catatan kaki.", 10.0, INK, "bold", z=6, va="top", lspace=1.6)
save(fig, P("18-risiko.png"))

# ---------------------------------------------------------------- 19 PENDANAAN
W, H = 13.0, 5.8
R = W / H
fig, ax = canvas(W, H)
txt(ax, 2, 95, "KEBUTUHAN PENDANAAN 24 BULAN — Rp 26,12 miliar", 15, INK, "bold", z=6)
txt(ax, 2, 89, "Angka SDM dihitung baris-per-baris dari model biaya. Pos non-SDM masih placeholder dan MENUNGGU KEPUTUSAN PEMILIK — ditandai [ASUMSI], tidak disamarkan.", 10, MUTED, z=6)

parts = [
    ("Biaya SDM (gaji + iuran + THR)", 11.689, TEAL, "BERSUMBER", "Model biaya SDM, lembar 'Proyeksi 24 Bulan'"),
    ("Biaya non-gaji melekat SDM", 1.927, "#0EA5E9", "[ASUMSI]", "Kantor, perangkat, lisensi, pelatihan — tidak ada sumber harga Pekanbaru/Padang"),
    ("Modal minimum KBLI 53200", 0.500, SERVICE["market"], "BERSUMBER", "Aktivitas Kurir, kegiatan berisiko tinggi [S-41]"),
    ("Pos non-SDM lainnya", 12.000, ACCENT, "[ASUMSI] PLACEHOLDER", "Insentif mitra, pemasaran, infrastruktur, perizinan — WAJIB diganti angka rencana bisnis pemilik"),
]
total = sum(p[1] for p in parts)
bx, bw = 4.0, 92.0
xacc = bx
for name, val, col, tag, note in parts:
    w = bw * val / total
    card(ax, xacc, 66, w - 0.5, 10.0, fc=col, ec="none", r=1.0, z=3)
    txt(ax, xacc + (w - 0.5) / 2, 71.0, f"{val/total*100:.0f}%", 13, "#FFFFFF", "bold", ha="center", va="center", z=6)
    xacc += w
for i, (name, val, col, tag, note) in enumerate(parts):
    y = 52 - i * 12.5
    dot(ax, 5.0, y + 4.0, 1.2, col, ratio=R, z=5)
    txt(ax, 7.5, y + 6.2, name, 11.5, INK, "bold", z=6)
    txt(ax, 7.5, y + 2.2, note, 8.8, MUTED, z=6)
    txt(ax, 62, y + 4.5, f"Rp {val:.2f}".replace(".", ",") + " miliar", 13.5, col, "bold", ha="right", z=6)
    tagcol = ACCENT if "ASUMSI" in tag else SERVICE["market"]
    pill(ax, 66, y + 1.6, 30, 5.4, ACCENT_LIGHT if "ASUMSI" in tag else SUCCESS_LIGHT, z=3)
    txt(ax, 81, y + 4.3, tag, 9.2, tagcol, "bold", ha="center", z=6)
ax.plot([4, 96], [8.5, 8.5], color=BORDER, lw=1.4, zorder=2)
txt(ax, 7.5, 4.5, "TOTAL KEBUTUHAN PENDANAAN 24 BULAN", 11.5, INK, "bold", z=6)
txt(ax, 62, 4.5, f"Rp {total:.2f}".replace(".", ",") + " miliar", 15, TEAL_DARK, "bold", ha="right", z=6)
txt(ax, 96, 4.5, "52% di antaranya biaya terkait SDM", 9.4, MUTED, ha="right", z=6)
save(fig, P("19-pendanaan.png"))
