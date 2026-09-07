/* Deck investor AntarKita — pptxgenjs
   Sistem visual "Solid Motion": teal #187A85, putih, abu netral, aksen hangat #F5A524. */
const pptxgen = require("pptxgenjs");
const fs = require("fs");
const path = require("path");

const DIR = __dirname;
const ASET = path.join(DIR, "aset");
const OUT = path.join(DIR, "AntarKita-Deck-Investor.pptx");

const TEAL = "187A85", TEAL_DARK = "1B474C", TEAL_MID = "1A5E66";
const INK = "101F21", MUTED = "5C6B6D", FAINT = "8A9899";
const MINT = "BFE9EA", TINT = "EEF6F7", ACCENT = "F5A524", WHITE = "FFFFFF";
const BODY = "Calibri", HEAD = "Calibri";

const SW = 13.333, SH = 7.5;
const MX = 0.55, CW = SW - 2 * MX;      // lebar kolom konten
const IMG_TOP = 1.30, IMG_MAXH = 5.55;  // area gambar
const FOOT_Y = 6.98;

/* dimensi PNG dari header IHDR */
function pngSize(file) {
  const b = fs.readFileSync(file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE";
pres.author = "PT AntarKita Indonesia";
pres.company = "PT AntarKita Indonesia";
pres.title = "AntarKita — Deck Investor";

let pageNo = 0;

function baseSlide() {
  const s = pres.addSlide();
  s.background = { color: WHITE };
  return s;
}

function footerAndNumber(s, source) {
  pageNo += 1;
  if (source) {
    s.addText(source, {
      x: MX, y: FOOT_Y, w: CW - 1.0, h: 0.34, isTextBox: true, margin: 0,
      fontSize: 8, fontFace: BODY, color: FAINT, valign: "middle",
    });
  }
  s.addText(String(pageNo), {
    x: SW - MX - 0.8, y: FOOT_Y, w: 0.8, h: 0.34, isTextBox: true, margin: 0,
    fontSize: 9, fontFace: BODY, color: TEAL, bold: true, align: "right", valign: "middle",
  });
}

/* slide standar: judul + satu kalimat gagasan + infografis + sumber */
function figSlide(title, kicker, image, source) {
  const s = baseSlide();
  s.addText(title, {
    x: MX, y: 0.30, w: CW, h: 0.50, isTextBox: true, margin: 0,
    fontSize: 25, bold: true, fontFace: HEAD, color: INK, valign: "middle",
  });
  s.addText(kicker, {
    x: MX, y: 0.83, w: CW, h: 0.36, isTextBox: true, margin: 0,
    fontSize: 12, fontFace: BODY, color: MUTED, valign: "middle",
  });
  const p = path.join(ASET, image);
  const d = pngSize(p);
  const aspect = d.h / d.w;
  let w = CW, h = CW * aspect;
  if (h > IMG_MAXH) { h = IMG_MAXH; w = h / aspect; }
  const x = (SW - w) / 2;
  const y = IMG_TOP + (IMG_MAXH - h) / 2;
  s.addImage({ path: p, x, y, w, h });
  footerAndNumber(s, source);
  return s;
}

/* ---------------------------------------------------------------- 1. SAMPUL */
{
  const s = pres.addSlide();
  s.background = { color: TEAL_DARK };
  s.addShape(pres.ShapeType.rect, { x: 0, y: 0, w: SW, h: SH, fill: { color: TEAL_DARK } });
  s.addShape(pres.ShapeType.ellipse, {
    x: 9.1, y: -2.0, w: 7.4, h: 7.4, fill: { color: TEAL, transparency: 55 }, line: { type: "none" },
  });
  s.addShape(pres.ShapeType.ellipse, {
    x: 10.4, y: 3.6, w: 5.2, h: 5.2, fill: { color: TEAL_MID, transparency: 55 }, line: { type: "none" },
  });
  s.addText("PT ANTARKITA INDONESIA  ·  PEKANBARU & PADANG", {
    x: 0.9, y: 0.95, w: 9.0, h: 0.34, isTextBox: true, margin: 0,
    fontSize: 12, bold: true, fontFace: BODY, color: MINT, charSpacing: 1.4,
  });
  s.addText("AntarKita", {
    x: 0.9, y: 1.45, w: 9.4, h: 1.35, isTextBox: true, margin: 0,
    fontSize: 60, bold: true, fontFace: HEAD, color: WHITE, valign: "middle",
  });
  s.addText(
    "Satu aplikasi untuk seluruh kebutuhan antar dan mobilitas warga Pekanbaru dan Padang — ojek, mobil, makanan, belanja pasar tradisional, kirim barang, dan perjalanan antar kota, dibayar dengan satu dompet AntarPay.",
    {
      x: 0.9, y: 2.90, w: 8.3, h: 1.25, isTextBox: true, margin: 0,
      fontSize: 15, fontFace: BODY, color: "D7EAEC", lineSpacing: 24, valign: "top",
    }
  );
  const chips = [
    ["8", "layanan"], ["3", "aplikasi"], ["34", "skenario uji LOLOS"], ["2", "kota"],
  ];
  chips.forEach((c, i) => {
    const x = 0.9 + i * 2.28;
    s.addShape(pres.ShapeType.roundRect, {
      x, y: 4.42, w: 2.05, h: 1.15, rectRadius: 0.14,
      fill: { color: TEAL_MID }, line: { type: "none" },
    });
    s.addText(c[0], {
      x: x + 0.16, y: 4.52, w: 1.75, h: 0.52, isTextBox: true, margin: 0,
      fontSize: 26, bold: true, fontFace: HEAD, color: WHITE, valign: "middle",
    });
    s.addText(c[1], {
      x: x + 0.16, y: 5.02, w: 1.75, h: 0.42, isTextBox: true, margin: 0,
      fontSize: 10, fontFace: BODY, color: MINT, valign: "middle",
    });
  });
  s.addText("Proposal pendanaan · tahap pra-pendanaan · 7 September 2026", {
    x: 0.9, y: 6.05, w: 8.0, h: 0.34, isTextBox: true, margin: 0,
    fontSize: 11, fontFace: BODY, color: MINT,
  });
  s.addText("Erza Pradipta Madana · Pemilik & Komisaris Utama · erzamadana@gmail.com", {
    x: 0.9, y: 6.42, w: 9.0, h: 0.34, isTextBox: true, margin: 0,
    fontSize: 11, bold: true, fontFace: BODY, color: WHITE,
  });
  s.addText(
    "Dokumen ini memakai dua penanda: [S-xx] = angka bersumber pihak ketiga; [ASUMSI] = perkiraan penyusun, bukan klaim faktual.",
    {
      x: 0.9, y: 6.85, w: 11.0, h: 0.32, isTextBox: true, margin: 0,
      fontSize: 9, fontFace: BODY, color: "7FAEB3",
    }
  );
  s.addNotes(
    "Pembuka. Satu kalimat: AntarKita adalah super-app lokal untuk dua kota di Sumatera yang produknya sudah jadi dan teruji, tetapi belum diluncurkan komersial. " +
    "Tekankan sejak awal bahwa deck ini membedakan angka bersumber dan angka asumsi."
  );
  pageNo = 1;
}

/* ---------------------------------------------------------------- 2–20 */
const slides = [
  {
    t: "Masalah yang nyata di dua kota ini",
    k: "Aplikasi nasional melayani perjalanan, tetapi tidak melayani pasar tradisional, titipan antar kota, dan tipisnya likuiditas mitra di kota tier-2.",
    img: "02-masalah.png",
    src: "Sumber: BPS via Databoks — Pekanbaru 1,14 juta jiwa (2024) & Padang 939,85 ribu jiwa (2024); Kepmenhub KP 564/2022 [S-24]; mitra aktif ±20% dari 3,7 juta terdaftar (Grab Indonesia, Des 2025) [S-58]. Diakses 7 September 2026.",
    n: "Empat masalah dipilih karena spesifik dua kota ini, bukan keluhan generik ride-hailing. Angka penduduk dipakai hanya sebagai ukuran pasar dasar, bukan proyeksi permintaan.",
  },
  {
    t: "Solusi: delapan layanan dalam satu ekosistem",
    k: "Satu akun, satu dompet, satu pusat bantuan — pelanggan tidak perlu berpindah aplikasi untuk kebutuhan harian yang berbeda.",
    img: "03-layanan.png",
    src: "Sumber: docs/rilis/PLAY-STORE-LISTING.md dan struktur kode src/screens/** (86 layar). Seluruh layanan sudah terbangun dan lolos simulasi transaksi.",
    n: "Kuncinya bukan jumlah layanan, melainkan bahwa AntarMart (pasar tradisional) dan AntarTravel (titipan antar kota) tidak dilayani pemain nasional di dua kota ini.",
  },
  {
    t: "Anatomi aplikasi",
    k: "Tiga aplikasi di atas satu backend Supabase, dengan aturan operasional yang dapat diubah dari panel admin tanpa merilis ulang aplikasi.",
    img: "04-anatomi.png",
    src: "Sumber: supabase/migrations/0001–0030 (66 tabel, 207 fungsi, 98 kebijakan RLS), src/screens/**, docs/INTEGRASI.md, docs/TAHAP11-KONTRAK-API.md.",
    n: "Poin komersial dari arsitektur ini: tarif, radius jemput, sakelar layanan, dan prioritas dispatch adalah data di app_settings — bukan kode. Perubahan regulasi dapat dipenuhi dalam hitungan menit, bukan rilis.",
  },
  {
    t: "Perjalanan pelanggan, dari pesan sampai bayar",
    k: "Enam langkah, semuanya tercatat di basis data dan dapat diaudit satu per satu.",
    img: "05-perjalanan-pelanggan.png",
    src: "Sumber: supabase/migrations/0025 (radius jemput & prioritas rating), docs/LAPORAN-UJI-SIMULASI.md skenario S1 dan S16 — 34 skenario LOLOS dalam transaksi yang di-rollback penuh.",
    n: "Tunjukkan bahwa angka Rp9.000 dan Rp6.400 bukan ilustrasi, melainkan keluaran simulasi transaksi nyata di basis data.",
  },
  {
    t: "Perjalanan mitra: driver, merchant, dan pedagang pasar",
    k: "Sisi pasokan punya alur onboarding sendiri — termasuk pedagang pasar tradisional yang tidak ditangani aplikasi mana pun di dua kota ini.",
    img: "06-perjalanan-mitra.png",
    src: "Sumber: src/screens/{mitra,driver,merchant,vendor}; skenario uji S8 (pagar harga pasar), S9 (penangguhan otomatis), S12 (pencairan & PIN admin), S21 (katalog kendaraan) pada docs/LAPORAN-UJI-SIMULASI.md.",
    n: "Pagar harga pasar (>2x acuan ditolak; 1,35x wajib nota) adalah mekanisme kepercayaan yang membuat katalog pasar tradisional bisa dipercaya pelanggan kota.",
  },
  {
    t: "AntarPay dan alur uang",
    k: "Dompet tertutup dengan setiap mutasi tercatat — dan ambang izin Bank Indonesia dinyatakan di muka, bukan disembunyikan.",
    img: "07-antarpay.png",
    src: "Sumber: supabase/migrations (wallets, wallet_transactions, payments), Edge Function midtrans-create & midtrans-webhook, docs/INTEGRASI.md; PBI 20/6/PBI/2018 [S-31]; skenario uji S0, S6, S7, S12.",
    n: "Jangan lewati catatan BI. Investor yang serius akan menanyakannya; menyampaikannya lebih dulu membangun kredibilitas seluruh deck.",
  },
  {
    t: "Diferensiasi yang sudah terbangun, bukan rencana",
    k: "Empat hal yang membedakan AntarKita sudah ada di basis kode dan lolos uji — dapat didemokan hari ini.",
    img: "08-diferensiasi.png",
    src: "Sumber: supabase/migrations/0025 & 0030, docs/TAHAP11-KONTRAK-API.md, docs/LAPORAN-UJI-SIMULASI.md (S5, S8).",
    n: "AntarNow adalah jawaban atas kebiasaan lokal: banyak pelanggan sudah punya driver langganan. Fitur ini memindahkan hubungan itu ke dalam aplikasi, bukan melawannya.",
  },
  {
    t: "Pasar: TAM, SAM, dan SOM yang jujur",
    k: "TAM dan SAM dikutip dari sumber; SOM sengaja tidak diangkakan karena benchmark kota tier-2 tidak tersedia.",
    img: "09-pasar.png",
    src: "Sumber: e-Conomy SEA 2025 (Google–Temasek–Bain), 11–27 November 2025 — GMV ekonomi digital Indonesia ≈US$100 miliar (2025, +14% YoY), proyeksi ≈US$180 miliar (2030); transportasi & antar makanan US$10 miliar (2025) [S-53][S-54]. Diakses 7 September 2026.",
    n: "Bila ditanya berapa SOM: jawab bahwa angka itu akan dihitung dari data order 90 hari pertama, dan tunjukkan bahwa kami menolak mengarang angka. Kejujuran ini adalah argumen, bukan kelemahan.",
  },
  {
    t: "Kompetisi dan posisi",
    k: "Ruang yang kami ambil bukan yang diperebutkan pemain nasional, melainkan yang tidak mereka layani.",
    img: "10-kompetisi.png",
    src: "Sumber: Lowy Institute, 15 Januari 2026 (rencana merger Grab–GoTo; entitas gabungan diperkirakan menguasai hingga 91% pasar ride-hailing Indonesia); Hukumonline [S-25] & Kompas.id [S-27]; DataRiau (kehadiran Maxim di Pekanbaru). [ASUMSI] Penempatan matriks adalah penilaian kualitatif — pangsa pasar per pemain di Indonesia tidak tersedia terbuka. Diakses 7 September 2026.",
    n: "Konsolidasi nasional adalah peluang, bukan hanya ancaman: perhatian pemain besar akan tersedot ke integrasi, dan batas komisi 8% menyamakan alat perang harga.",
  },
  {
    t: "Model bisnis setelah Perpres 27/2026",
    k: "Batas potongan aplikasi ojek roda dua turun menjadi maksimal 8% sejak 1 Juli 2026 — kami sajikan dampaknya apa adanya.",
    img: "11-takerate.png",
    src: "Sumber: Perpres No. 27 Tahun 2026 melalui Hukumonline [S-25] (ditandatangani 1 Mei, diundangkan 4 Mei 2026); Kepmenhub KP 564/2022 [S-24]; cakupan roda dua saja menurut Kompas.id [S-27]; rencana aturan tarif tiga layanan [S-28][S-29] berstatus RENCANA, bukan hukum positif.",
    n: "Ini slide yang paling menentukan kredibilitas. Sampaikan sebelum ditanya. Proyeksi ride-hailing Indonesia yang masih memakai take rate 20% untuk roda dua sudah tidak sah sejak 1 Juli 2026.",
  },
  {
    t: "Unit economics satu order",
    k: "Angka dari simulasi transaksi nyata — termasuk satu setelan yang masih harus kami ubah sebelum peluncuran.",
    img: "12-unit-economics.png",
    src: "Sumber: docs/LAPORAN-UJI-SIMULASI.md skenario S1 (total Rp9.000, driver menerima Rp6.400); nilai seed pricing.commission_pct pada supabase/migrations/0001_schema.sql. Perlakuan biaya jasa aplikasi Rp1.000 terhadap batas 8% berstatus [ASUMSI].",
    n: "Mengakui bahwa setelan komisi terpasang masih 20% lebih kuat daripada menyembunyikannya — apalagi karena perubahannya hanya satu setelan di panel admin, bukan pekerjaan rekayasa.",
  },
  {
    t: "Traksi dan status produk",
    k: "Produk siap dan teruji; perusahaan belum beroperasi komersial — tidak ada satu pun klaim pengguna, GMV, atau pendapatan.",
    img: "13-traksi.png",
    src: "Sumber: docs/LAPORAN-UJI-SIMULASI.md (7 September 2026) dan docs/RENCANA-LISTING-LIVE.md. APK build-24, web live, 68 rute UI tiga aplikasi dirender tanpa error.",
    n: "Kalimat yang harus diucapkan persis: 'kami belum punya traksi pengguna, dan kami tidak akan berpura-pura punya.' Yang kami punya adalah produk lengkap dan bukti uji.",
  },
  {
    t: "Peta jalan 36 bulan",
    k: "Dari kunci pembayaran dan listing Play Store, ke satu kota, lalu dua kota, baru ekspansi.",
    img: "14-peta-jalan.png",
    src: "Sumber: docs/organisasi/DESAIN-ORGANISASI.md §3 (fase & headcount, keputusan mengikat) dan docs/RENCANA-LISTING-LIVE.md (langkah pra-peluncuran). Fase 3 bersifat indikatif dan ditandai [ASUMSI].",
    n: "Jarak dari hari ini ke order berbayar pertama diukur dalam minggu, bukan tahun — yang tersisa adalah langkah akun dan legal, bukan pembangunan produk.",
  },
  {
    t: "Organisasi dan rencana SDM",
    k: "Sembilan orang untuk menyiapkan, 24 untuk satu kota, 42 untuk dua kota — dengan kepatuhan sebagai fungsi tetap sejak Fase 1.",
    img: "15-organisasi.png",
    src: "Sumber: docs/organisasi/DESAIN-ORGANISASI.md §1–§3 & §6; lembar 'Headcount' pada docs/organisasi/AntarKita-Model-Biaya-SDM.xlsx (uji kecocokan terhadap target 9/24/42 bernilai nol).",
    n: "Struktur ini dirancang agar kota ketiga hanya menambah satu City Manager dan dua staf operasi — tidak menambah lapisan organisasi baru.",
  },
  {
    t: "Biaya SDM: yang bersumber dan yang diasumsikan",
    k: "Struktur biaya dihitung baris per baris; seluruh pita gaji ditandai [ASUMSI] karena tidak ada benchmark terbuka untuk Pekanbaru dan Padang.",
    img: "16-biaya-sdm.png",
    src: "Sumber: docs/organisasi/AntarKita-Model-Biaya-SDM.xlsx (lembar Ringkasan, Biaya Bulanan, Proyeksi 24 Bulan). UMK 2026 [S-01][S-03][S-05]; iuran BPJS pemberi kerja [S-07][S-08][S-12]; batas upah JP Rp11.086.300 [S-09]; akrual THR [S-16].",
    n: "Perhatikan: rasio biaya perusahaan terhadap gaji pokok pada model terealisasi 1,28x, sedikit di atas kebijakan indikatif 1,19x — selisih ini dicatat di lembar Sumber & Catatan model, tidak disembunyikan.",
  },
  {
    t: "Kepatuhan sebagai kekuatan",
    k: "Empat kewajiban menentukan boleh-tidaknya beroperasi — semuanya sudah dipetakan dengan penanggung jawab dan biayanya.",
    img: "17-kepatuhan.png",
    src: "Sumber: Permenkominfo 5/2020 jo. 10/2021 [S-34]; UU 27/2022 Pasal 53 [S-37] dan Putusan MK No. 151/PUU-XXII/2024 [S-39]; PerBPS 7/2025 & PP 28/2025 melalui Klinik Hukumonline 20 April 2026 [S-41][S-42]; PBI 20/6/PBI/2018 [S-31]. Kutipan pasal berasal dari sumber sekunder dan wajib dicek silang ke JDIH resmi sebelum diajukan ke regulator.",
    n: "Argumennya: perusahaan yang menganggarkan modal KBLI Rp500 juta dan menunjuk DPO sebelum order pertama adalah perusahaan yang bisa diaudit — dan itu menurunkan risiko investor.",
  },
  {
    t: "Risiko dan mitigasi",
    k: "Risiko terbesar bukan teknologi, melainkan status hukum kemitraan mitra pengemudi yang menopang seluruh struktur biaya.",
    img: "18-risiko.png",
    src: "Sumber: docs/riset/RISET-KOMPENSASI-REGULASI.md B.10.1 [S-21][S-48][S-49], B.5.4 [S-28][S-29], B.6.1 [S-31], B.8 [S-37][S-39], A.4.3; Lowy Institute 15 Januari 2026. Diakses 7 September 2026.",
    n: "Bila status kemitraan berubah menjadi hubungan kerja, model biaya berubah fundamental. Kami mencatatnya sebagai risiko nomor satu, bukan catatan kaki — dan itulah sebabnya bauran pendapatan non-komisi disiapkan sejak awal.",
  },
  {
    t: "Kebutuhan pendanaan dan penggunaan dana",
    k: "Rp26,12 miliar untuk 24 bulan — separuhnya biaya SDM yang terhitung, separuhnya pos yang masih menunggu keputusan pemilik.",
    img: "19-pendanaan.png",
    src: "Sumber: docs/organisasi/AntarKita-Model-Biaya-SDM.xlsx lembar Ringkasan bagian B. Modal minimum KBLI 53200 Rp500 juta [S-41]. Pos non-SDM lainnya Rp12 miliar berstatus [ASUMSI] PLACEHOLDER — wajib diganti angka rencana bisnis pemilik sebelum deck dipakai untuk penawaran.",
    n: "Sampaikan terus terang: pos Rp12 miliar adalah placeholder input pengguna pada model, bukan hasil perhitungan. Benchmark CAC dan CAD untuk Indonesia tidak ditemukan di sumber terbuka, dan kami menolak mengisinya dengan angka karangan.",
  },
  {
    t: "Tim dan tata kelola",
    k: "Kewenangan berjenjang, pemisahan tugas keuangan yang ditegakkan sistem, dan susunan direksi yang dinyatakan apa adanya.",
    img: "20-tata-kelola.png",
    src: "Sumber: docs/organisasi/DESAIN-ORGANISASI.md §4 & §6; Manual Organisasi & SOP Bab 7; peran pemilik dari docs/RENCANA-LISTING-LIVE.md bagian D. Kolam ESOP 10% berstatus [ASUMSI].",
    n: "Kejujuran tentang direksi yang belum diisi lebih baik daripada bagan berisi nama-nama yang belum berkomitmen. Yang kami tawarkan adalah struktur yang sudah diputuskan dan dianggarkan.",
  },
];

slides.forEach((s) => figSlide(s.t, s.k, s.img, s.src).addNotes(s.n));

/* ---------------------------------------------------------------- 21. AJAKAN */
{
  const s = pres.addSlide();
  s.background = { color: TEAL_DARK };
  s.addShape(pres.ShapeType.rect, { x: 0, y: 0, w: SW, h: SH, fill: { color: TEAL_DARK } });
  s.addShape(pres.ShapeType.ellipse, {
    x: 9.4, y: 3.1, w: 6.6, h: 6.6, fill: { color: TEAL, transparency: 60 }, line: { type: "none" },
  });
  s.addText("LANGKAH BERIKUTNYA", {
    x: 0.9, y: 0.85, w: 8.0, h: 0.34, isTextBox: true, margin: 0,
    fontSize: 12, bold: true, fontFace: BODY, color: MINT, charSpacing: 1.4,
  });
  s.addText("Produknya sudah ada.\nYang kami cari adalah mitra untuk menyalakannya.", {
    x: 0.9, y: 1.30, w: 9.4, h: 1.5, isTextBox: true, margin: 0,
    fontSize: 32, bold: true, fontFace: HEAD, color: WHITE, lineSpacing: 46, valign: "top",
  });
  const asks = [
    ["Pendanaan tahap awal", "Rp26,12 miliar untuk 24 bulan, dengan pos non-SDM\nyang masih terbuka untuk dibahas bersama."],
    ["Peluncuran Pekanbaru", "Membuka kota pertama dan mencapai likuiditas pasar\nsatu kota dalam 12 bulan."],
    ["Uji tuntas terbuka", "Basis kode, laporan uji 34 skenario, model biaya SDM,\ndan riset regulasi 61 sumber tersedia untuk diperiksa."],
  ];
  asks.forEach((a, i) => {
    const y = 3.02 + i * 1.10;
    s.addShape(pres.ShapeType.ellipse, {
      x: 0.9, y: y + 0.10, w: 0.30, h: 0.30, fill: { color: ACCENT }, line: { type: "none" },
    });
    s.addText(a[0], {
      x: 1.42, y: y, w: 8.6, h: 0.36, isTextBox: true, margin: 0,
      fontSize: 15, bold: true, fontFace: HEAD, color: WHITE, valign: "middle",
    });
    s.addText(a[1], {
      x: 1.42, y: y + 0.38, w: 8.6, h: 0.62, isTextBox: true, margin: 0,
      fontSize: 11, fontFace: BODY, color: "AFD3D7", lineSpacing: 16, valign: "top",
    });
  });
  s.addShape(pres.ShapeType.roundRect, {
    x: 0.9, y: 6.42, w: 11.5, h: 0.82, rectRadius: 0.14,
    fill: { color: TEAL_MID }, line: { type: "none" },
  });
  s.addText(
    [
      { text: "Erza Pradipta Madana", options: { bold: true, color: WHITE, fontSize: 13 } },
      { text: "   ·   Pemilik & Komisaris Utama, PT AntarKita Indonesia   ·   ", options: { color: MINT, fontSize: 11 } },
      { text: "erzamadana@gmail.com", options: { bold: true, color: WHITE, fontSize: 13 } },
    ],
    { x: 1.25, y: 6.42, w: 10.8, h: 0.82, isTextBox: true, margin: 0, fontFace: BODY, valign: "middle" }
  );
  pageNo += 1;
  s.addText(String(pageNo), {
    x: SW - MX - 0.8, y: 0.35, w: 0.8, h: 0.34, isTextBox: true, margin: 0,
    fontSize: 9, bold: true, fontFace: BODY, color: MINT, align: "right", valign: "middle",
  });
  s.addNotes(
    "Penutup. Ulangi tiga hal: produk lengkap dan teruji, kepatuhan sudah dipetakan, dan seluruh angka dipisahkan antara yang bersumber dan yang diasumsikan. " +
    "Ajakan konkretnya adalah membuka uji tuntas terhadap basis kode dan model biaya."
  );
}

pres.writeFile({ fileName: OUT }).then(() => console.log("tulis", OUT, "—", pageNo, "slide"));
