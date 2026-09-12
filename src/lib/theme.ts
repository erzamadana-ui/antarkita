// Design system AntarKita — token terpusat sesuai ANTARKITA_DESIGN_SYSTEM.md v1.0 (12 Sep 2026):
// tipografi Inter skala 30/24/22/18/16/14/12 (bobot 400–700), spacing 4/8-point, radius kartu 16 / promo 20 /
// tombol-input 12–16, ikon 16/20/24/32, tombol utama 52. Warna dari logo C29; gerak singkat & bermakna;
// tema selalu terang (pengaturan dark mode OS diabaikan). Layar TIDAK boleh hardcode ukuran — pakai token ini.
import { Easing } from 'react-native-reanimated';
import { Platform } from 'react-native';

export const colors = {
  primary: '#187A85',
  primaryDark: '#1A5E66',
  primaryDeep: '#1B474C',
  primaryLight: '#E7F2F3',
  primarySoft: 'rgba(24,122,133,0.10)',
  tint: '#EEF6F7',
  mint: '#BFE9EA',
  ink: '#101F21',
  accent: '#F5A524',
  accentLight: '#FFF3DD',
  bg: '#FFFFFF',
  bgSoft: '#F5F8F8',
  surface: '#FFFFFF',
  text: '#101F21',
  textSecondary: '#5C6B6D',
  textMuted: '#8A9899',
  border: '#E6ECEC',
  danger: '#E5484D',
  dangerLight: '#FDECEC',
  success: '#1FA363',
  successLight: '#E4F6EC',
  warning: '#D97706',
  info: '#2F80ED',
  infoLight: '#E8F1FD',
  overlay: 'rgba(15,42,40,0.42)',
  // warna layanan
  ride: '#187A85',
  car: '#2F80ED',
  food: '#E5484D',
  send: '#7B61FF',
  pay: '#187A85',
  shop: '#0EA5E9',
  market: '#1FA363',
  box: '#D97706',
  travel: '#1D4ED8',
};

/** Permukaan kaca — transparansi terkendali: kartu ≈ padat, blur hanya untuk bar/panel mengambang. */
export const glass = {
  fill: 'rgba(255,255,255,0.96)',
  fillStrong: 'rgba(255,255,255,1)',
  fillSoft: 'rgba(255,255,255,0.86)',
  fillDark: 'rgba(15,42,40,0.82)',
  border: 'rgba(230,236,236,1)',
  borderDark: 'rgba(255,255,255,0.14)',
  highlight: 'rgba(255,255,255,0.9)',
  tintTeal: 'rgba(24,122,133,0.10)',
  tintAmber: 'rgba(245,165,36,0.14)',
  blur: 18,
  blurStrong: 28,
};

/**
 * Spacing 4/8-point (ANTARKITA_DESIGN_SYSTEM §4). Nama lama (xs…xxl) dipertahankan;
 * `space` memberi nama numerik yang sama dengan dokumen desain.
 */
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 };
export const space = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48 } as const;
/** Padding horizontal layar: 20 bawaan; 16 untuk halaman padat; 24 untuk layout lega. */
export const screenPadding = { compact: 16, default: 20, airy: 24 };
/** Radius (§5): sm = tombol/input 12, md = kartu standar 16, lg = kartu promo 20, xl = sheet 24, xxl = 32. */
export const radius = { sm: 12, md: 16, lg: 20, xl: 24, xxl: 32, full: 999 };
/** Ukuran ikon (§6). */
export const iconSize = { sm: 16, md: 20, lg: 24, service: 32, feature: 44, hero: 52 };
/** Ukuran komponen bersama (§4–§6). */
export const size = { buttonLg: 52, buttonMd: 48, buttonSm: 40, input: 52, touchMin: 44, navIcon: 24 };

export const shadow = {
  card: {
    shadowColor: '#101F21',
    shadowOpacity: 0.07,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  soft: {
    shadowColor: '#0F2A28',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  sheet: {
    shadowColor: '#0F2A28',
    shadowOpacity: 0.14,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: -6 },
    elevation: 14,
  },
  glow: (color: string) => ({
    shadowColor: color,
    shadowOpacity: 0.32,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  }),
};

/**
 * Keluarga font: Inter (ANTARKITA_DESIGN_SYSTEM §2) — Regular 400, Medium 500, SemiBold 600, Bold 700.
 * Bobot 800 sengaja dipetakan ke 700: dokumen desain melarang 800/900.
 * Fallback: Android → Roboto/sans-serif, iOS → SF Pro (lewat fontWeight bila berkas font belum termuat).
 */
export const FONT_FAMILY = {
  400: 'Inter-400',
  500: 'Inter-500',
  600: 'Inter-600',
  700: 'Inter-700',
  800: 'Inter-700',
} as const;
export const FONT_ASSETS = {
  'Inter-400': require('../../assets/fonts/Inter-400.ttf'),
  'Inter-500': require('../../assets/fonts/Inter-500.ttf'),
  'Inter-600': require('../../assets/fonts/Inter-600.ttf'),
  'Inter-700': require('../../assets/fonts/Inter-700.ttf'),
};
/** Style keluarga font untuk bobot tertentu (fontWeight tetap ikut agar fallback sistem benar). */
export const fam = (w: 400 | 500 | 600 | 700 | 800) => {
  const ww = (w === 800 ? 700 : w) as 400 | 500 | 600 | 700;
  return { fontFamily: FONT_FAMILY[ww], fontWeight: String(ww) as '400' | '500' | '600' | '700' };
};
const W = fam;

/**
 * Skala tipografi global (ANTARKITA_DESIGN_SYSTEM §2): 30 / 24 / 22 / 18 / 16 / 14 / 12.
 * Nama lama (small, tiny, label) dipertahankan sebagai alias supaya layar lama tetap benar.
 */
export const font = {
  display: { fontSize: 30, ...W(700), color: colors.text, letterSpacing: -0.4, lineHeight: 36 },   // judul halaman
  h1: { fontSize: 24, ...W(700), color: colors.text, letterSpacing: -0.3, lineHeight: 30 },        // heading besar, total penting
  h2: { fontSize: 22, ...W(700), color: colors.text, letterSpacing: -0.2, lineHeight: 28 },        // judul section
  h3: { fontSize: 18, ...W(600), color: colors.text, lineHeight: 24 },                            // judul kartu/merchant/harga
  body: { fontSize: 16, ...W(400), color: colors.text, lineHeight: 22 },                          // teks utama
  bodyMedium: { fontSize: 16, ...W(500), color: colors.text, lineHeight: 22 },                    // body dengan penekanan
  bodySmall: { fontSize: 14, ...W(400), color: colors.textSecondary, lineHeight: 20 },            // informasi sekunder
  caption: { fontSize: 12, ...W(400), color: colors.textMuted, lineHeight: 16 },                  // metadata
  captionMedium: { fontSize: 12, ...W(500), color: colors.textMuted, lineHeight: 16 },            // badge, label navigasi
  button: { fontSize: 16, ...W(600), lineHeight: 20 },
  navigation: { fontSize: 12, ...W(500), lineHeight: 16 },
  price: { fontSize: 18, ...W(600), color: colors.text, lineHeight: 24 },                         // harga normal
  total: { fontSize: 24, ...W(700), color: colors.text, lineHeight: 30 },                         // total / harga utama
  // ---- alias lama ----
  small: { fontSize: 14, ...W(400), color: colors.textSecondary, lineHeight: 20 },
  tiny: { fontSize: 12, ...W(400), color: colors.textMuted, lineHeight: 16 },
  label: { fontSize: 12, ...W(500), color: colors.textMuted, letterSpacing: 0.6, lineHeight: 16, textTransform: 'uppercase' as const },
};

/** Token gerak: singkat & bermakna — aplikasi harus terasa gesit. */
export const motion = {
  fast: 80,
  base: 130,
  slow: 200,
  stagger: 24,
  easeOut: Easing.out(Easing.cubic),
  easeInOut: Easing.inOut(Easing.cubic),
  spring: { damping: 20, stiffness: 380, mass: 0.6 },
  springSoft: { damping: 24, stiffness: 300, mass: 0.8 },
  springBouncy: { damping: 15, stiffness: 400, mass: 0.55 },
};

/** Blur hanya tersedia di iOS/web; Android memakai fill padat (lebih ringan). */
export const canBlur = Platform.OS !== 'android';
