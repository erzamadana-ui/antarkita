// Potongan bersama antar layar Panel Admin (bukan rute — expo-router hanya membaca apps/<app>/app).
//
// `usePager` + `Pager`: paginasi sisi klien untuk tabel panjang.
// Alasan: tabel admin merender SEMUA baris sekaligus. Pada 1.000+ baris, satu ketukan tombol
// di kolom pencarian memicu render ulang seluruh tabel — pengetikan jadi tersendat berdetik-detik
// ("tulisan tidak muncul"). Dengan memotong daftar jadi satu halaman, jumlah simpul DOM turun
// drastis dan input kembali responsif.
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Platform, useWindowDimensions } from 'react-native';
import type { StyleProp, TextStyle } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { adminFont, adminTone, adminSpace, adminRadius, adminIcon, Pill, TONE, type ToneKey } from '@/components/admin';
import { Row } from '@/components/ui';
import { formatDate, timeAgo, rupiah } from '@/lib/format';
import type { LedgerEntry, LedgerParty, ServiceType } from '@/lib/types';

/**
 * Tanggal aman untuk tabel admin. Kolom tanggal di basis data boleh NULL
 * (mis. `submitted_at`, `reviewed_at`, `closed_at`), dan `formatDate` mentah
 * menghasilkan teks "Invalid Date" untuk nilai kosong/rusak. Fungsi ini
 * mengembalikan tanda pisah "—" sehingga tabel tetap terbaca.
 */
export function fmtDate(iso?: string | null, withTime = true, fallback = '—'): string {
  if (iso == null || iso === '' || iso === 'null' || iso === 'undefined') return fallback;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? fallback : formatDate(iso, withTime);
}
/** "3 jam lalu" yang aman terhadap tanggal kosong/rusak. */
export function fmtAgo(iso?: string | null, fallback = '—'): string {
  if (iso == null || iso === '' || iso === 'null' || iso === 'undefined') return fallback;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? fallback : timeAgo(iso);
}

/**
 * Teks satu baris dengan tooltip — pengganti `Truncate` dari `@/components/admin`.
 *
 * BUG yang dihindari (src/components/admin.tsx baris 121-125): ketika prop `title` diisi,
 * `Truncate` membungkus <Text> dengan <div> biasa (display:block). React Native Web
 * merender <Text> sebagai `display:inline`, dan pada kotak inline properti
 * `overflow:hidden` serta `max-width` TIDAK berlaku — sehingga nama/alamat yang panjang
 * meluber menutupi kolom di sebelahnya (bahkan menutupi tombol aksi).
 * Membungkusnya dengan `display:flex` membuat <Text> ter-blockify sehingga
 * pemotongan dengan elipsis kembali bekerja, tooltip tetap ada.
 */
export function Trunc({ children, title, style, lines = 1 }: { children: React.ReactNode; title?: string; style?: StyleProp<TextStyle>; lines?: number }) {
  const t = <Text numberOfLines={lines} style={style}>{children}</Text>;
  if (Platform.OS === 'web' && title) {
    return React.createElement('div', { title, style: { display: 'flex', minWidth: 0, maxWidth: '100%' } }, t);
  }
  return t;
}

/**
 * Petunjuk geser untuk tabel lebar. Pada laptop 1024 px lebar isi halaman hanya ±732 px,
 * sedangkan tabel admin (6-7 kolom + kolom Aksi) butuh ±990 px. Tabel memang bisa digeser
 * ke samping DI DALAM wadahnya, tetapi tanpa penanda operator sering tidak sadar kolom
 * "Aksi" masih ada di sebelah kanan. Petunjuk ini hanya muncul saat layar sempit.
 */
export function WideTableHint({ minWidth = 1280, what = 'kolom Aksi' }: { minWidth?: number; what?: string }) {
  const { width } = useWindowDimensions();
  if (width >= minWidth) return null;
  return (
    <Row gap={6} style={{ flexWrap: 'wrap' }}>
      <Ionicons name="swap-horizontal-outline" size={adminIcon.sm} color={adminTone.faint} />
      <Text style={adminFont.tiny}>Layar sempit — geser tabel ke samping (Shift + gulir) untuk melihat {what}. Lebar layar yang disarankan: 1280 px.</Text>
    </Row>
  );
}

export const PAGE_SIZES = [25, 50, 100, 200] as const;

export interface Paged<T> {
  rows: T[];          // baris pada halaman aktif
  total: number;      // jumlah seluruh baris setelah filter
  page: number;       // halaman aktif (0-based)
  pages: number;      // jumlah halaman (minimal 1)
  size: number;
  from: number;       // nomor baris pertama (1-based) — 0 bila kosong
  to: number;
  setPage: (p: number) => void;
  setSize: (n: number) => void;
}

/**
 * Potong `all` menjadi satu halaman. Halaman otomatis kembali ke 0 saat jumlah baris
 * berubah (mis. filter/pencarian diubah) agar tidak terjebak di halaman kosong.
 */
export function usePager<T>(all: T[], initialSize = 50): Paged<T> {
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(initialSize);
  const total = all.length;
  const pages = Math.max(1, Math.ceil(total / size));
  useEffect(() => { setPage((p) => (p > pages - 1 ? 0 : p)); }, [pages]);
  useEffect(() => { setPage(0); }, [total, size]);
  const safe = Math.min(page, pages - 1);
  const rows = useMemo(() => all.slice(safe * size, safe * size + size), [all, safe, size]);
  return {
    rows, total, page: safe, pages, size,
    from: total === 0 ? 0 : safe * size + 1,
    to: Math.min(total, safe * size + size),
    setPage, setSize,
  };
}

function NavBtn({ icon, disabled, onPress, label }: { icon: React.ComponentProps<typeof Ionicons>['name']; disabled?: boolean; onPress: () => void; label: string }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress}
      style={(st) => [s.nav, (st as { hovered?: boolean }).hovered && !disabled && { backgroundColor: adminTone.hover }, disabled && { opacity: 0.35 }]}>
      <Ionicons name={icon} size={adminIcon.md} color={adminTone.ink2} />
    </Pressable>
  );
}

/**
 * Baris navigasi halaman di bawah tabel. Sengaja ringkas: keterangan "x–y dari z",
 * pilihan jumlah baris, lalu tombol maju/mundur. Tidak tampil bila hanya satu halaman
 * dan jumlah baris masih di bawah ukuran halaman terkecil.
 */
export function Pager<T>({ p, noun = 'baris', hint }: { p: Paged<T>; noun?: string; hint?: string }) {
  if (p.total <= PAGE_SIZES[0] && p.pages <= 1) return null;
  return (
    <View style={s.bar}>
      <Text style={adminFont.tiny} numberOfLines={1}>
        {p.total === 0 ? `Tidak ada ${noun}` : `${p.from.toLocaleString('id-ID')}–${p.to.toLocaleString('id-ID')} dari ${p.total.toLocaleString('id-ID')} ${noun}`}
        {hint ? ` · ${hint}` : ''}
      </Text>
      <Row gap={6}>
        <Text style={adminFont.tiny}>Baris</Text>
        {PAGE_SIZES.map((n) => (
          <Pressable key={n} accessibilityRole="button" onPress={() => p.setSize(n)}
            style={(st) => [s.size, p.size === n && s.sizeOn, (st as { hovered?: boolean }).hovered && p.size !== n && { backgroundColor: adminTone.hover }]}>
            <Text style={[adminFont.tiny, p.size === n && { color: adminTone.ink, fontWeight: '700' }]}>{n}</Text>
          </Pressable>
        ))}
        <View style={{ width: 6 }} />
        <NavBtn icon="chevron-back" label="Halaman sebelumnya" disabled={p.page <= 0} onPress={() => p.setPage(p.page - 1)} />
        <Text style={[adminFont.tiny, { minWidth: 74, textAlign: 'center' }]}>Hal. {p.page + 1} / {p.pages}</Text>
        <NavBtn icon="chevron-forward" label="Halaman berikutnya" disabled={p.page >= p.pages - 1} onPress={() => p.setPage(p.page + 1)} />
      </Row>
    </View>
  );
}

/* ───────────────────── Skema Bisnis v2 (0098–0103): potongan bersama ───────────────────── */

/** Urutan layanan baku di layar Skema Bisnis. */
export const SERVICE_KEYS: ServiceType[] = ['ride_motor', 'ride_car', 'food', 'send', 'shop', 'market', 'box', 'travel'];

/** Label Indonesia untuk enum `ledger_entry` (0099). */
export const ENTRY_LABEL: Record<LedgerEntry, string> = {
  gross_customer: 'Dibayar pelanggan', items_subtotal: 'Nilai barang', delivery_fee: 'Ongkir / tarif jasa',
  customer_platform_fee: 'Biaya platform pelanggan', service_fee: 'Jasa belanja', intercity_fare: 'Tarif antar kota',
  tip: 'Tip', extras: 'Biaya tambahan (parkir/tol/tunggu)',
  promo_platform: 'Promo · ditanggung platform', promo_merchant: 'Promo · ditanggung merchant', promo_sponsor: 'Promo · ditanggung sponsor',
  driver_commission: 'Komisi dari ongkir', merchant_fee: 'Fee merchant',
  driver_payable: 'Hak driver', merchant_payable: 'Hak merchant', vendor_payable: 'Penggantian belanja (ditalangi driver)', partner_payable: 'Hak mitra travel',
  platform_revenue: 'Pendapatan platform bersih', pg_fee: 'Biaya payment gateway', pg_fee_ppn: 'PPN biaya gateway',
  driver_receivable: 'Setoran tunai ke platform', refund: 'Refund', adjustment: 'Penyesuaian / bonus sesi', ads_revenue: 'Pendapatan iklan',
};
export const entryLabel = (e: string) => ENTRY_LABEL[e as LedgerEntry] ?? e;
/** Label Indonesia pihak (`party_role`) di buku besar. */
export const PARTY_LABEL: Record<LedgerParty, string> = {
  customer: 'Pelanggan', driver: 'Driver', merchant: 'Merchant', vendor: 'Vendor (via driver)', partner: 'Mitra travel',
  platform: 'Platform', gateway: 'Payment gateway', sponsor: 'Sponsor',
};
export const partyLabel = (p?: string | null) => (p ? PARTY_LABEL[p as LedgerParty] ?? p : '—');
export const FUNDER_LABEL: Record<string, string> = { platform: 'Platform', merchant: 'Merchant', sponsor: 'Sponsor', customer: 'Pelanggan' };

/** Angka dari isian teks: koma desimal diterima, kosong → NaN. */
export const parseNum = (v: string | number | null | undefined) => {
  const t = String(v ?? '').trim().replace(/\s/g, '').replace(',', '.');
  return t === '' ? NaN : Number(t);
};

/** Tag label angka di teks catatan: "[FAKTA SUMBER] … [ASUMSI] …" → ['FAKTA SUMBER', 'ASUMSI']. */
export function labelTags(text?: string | null): string[] {
  const out: string[] = [];
  for (const m of String(text ?? '').matchAll(/\[(FAKTA[^\]]*|ASUMSI[^\]]*|HASIL PILOT[^\]]*)\]/gi)) {
    const t = m[1].trim().toUpperCase().replace(/\s+/g, ' ');
    if (!out.includes(t)) out.push(t);
  }
  return out;
}
/** Warna label angka: FAKTA = hijau, ASUMSI = kuning, HASIL PILOT = biru. */
export const labelTone = (t: string): ToneKey => (/^FAKTA/i.test(t) ? 'ok' : /^ASUMSI/i.test(t) ? 'wait' : /^HASIL/i.test(t) ? 'info' : 'neutral');
export function LabelPill({ text }: { text: string }) {
  return <Pill text={text} tone={labelTone(text)} />;
}

/** Kotak galat di dalam halaman (bukan hanya toast) — dipakai saat memuat data gagal. */
export function ErrorNote({ text, onRetry }: { text: string | null | undefined; onRetry?: () => void }) {
  if (!text) return null;
  return (
    <View style={[s.err]}>
      <Row gap={8} style={{ alignItems: 'flex-start' }}>
        <Ionicons name="close-circle-outline" size={adminIcon.md} color={adminTone.red} />
        <Text selectable style={[adminFont.small, { color: adminTone.red, flex: 1 }]}>{text}</Text>
        {onRetry ? <Pressable onPress={onRetry} hitSlop={6}><Text style={[adminFont.small, { color: adminTone.teal, fontWeight: '700' }]}>Coba lagi</Text></Pressable> : null}
      </Row>
    </View>
  );
}

/** Kolom uang untuk DataTable (rata kanan, tabular). */
export const moneyCol = (key: string, label: string, width = 116, color?: string | ((r: Record<string, unknown>) => string | undefined)) => ({
  key, label, width, align: 'right' as const, mono: true,
  render: (r: Record<string, unknown>) => {
    const v = Number(r[key] ?? 0);
    const c = typeof color === 'function' ? color(r) : color;
    return <Text style={[adminFont.mono, c ? { color: c } : null]} numberOfLines={1}>{rupiah(v)}</Text>;
  },
});
/** Kolom hitungan (bilangan bulat). */
export const countCol = (key: string, label: string, width = 80) => ({
  key, label, width, align: 'right' as const, mono: true,
  render: (r: Record<string, unknown>) => <Text style={adminFont.mono}>{Number(r[key] ?? 0).toLocaleString('id-ID')}</Text>,
});
/** Kolom persen. */
export const pctCol = (key: string, label: string, width = 88) => ({
  key, label, width, align: 'right' as const, mono: true,
  render: (r: Record<string, unknown>) => <Text style={adminFont.mono}>{`${Number(r[key] ?? 0).toLocaleString('id-ID', { maximumFractionDigits: 2 })}%`}</Text>,
});

const s = StyleSheet.create({
  err: { borderWidth: 1, borderColor: TONE.bad.border, backgroundColor: TONE.bad.bg, borderRadius: adminRadius.card, padding: adminSpace.md },
  bar: {
    flexDirection: 'row', flexWrap: 'wrap', gap: adminSpace.md, alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: adminSpace.md, paddingVertical: adminSpace.sm,
    borderWidth: 1, borderColor: adminTone.border, borderRadius: adminRadius.md, backgroundColor: adminTone.surfaceAlt,
  },
  nav: { width: 30, height: 30, borderRadius: adminRadius.sm, borderWidth: 1, borderColor: adminTone.border, backgroundColor: adminTone.surface, alignItems: 'center', justifyContent: 'center' },
  size: { minWidth: 30, height: 26, paddingHorizontal: 6, borderRadius: adminRadius.sm, borderWidth: 1, borderColor: adminTone.border, backgroundColor: adminTone.surface, alignItems: 'center', justifyContent: 'center' },
  sizeOn: { backgroundColor: adminTone.surfaceAlt, borderColor: adminTone.ink2 },
});
