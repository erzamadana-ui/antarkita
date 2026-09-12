// Komponen laporan bersama — dipakai halaman "Laporan Keuangan" (panel admin) & Portal Eksekutif.
// Mengikuti sistem desain panel admin (`@/components/admin`): latar #F6F8FA, kartu putih radius 14–16,
// tipografi berjenjang, angka tabular-nums. Tidak mengubah komponen milik tim desain — hanya memakainya.
import React from 'react';
import { View, Text, Pressable, Platform, TextInput, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { adminFont as font, adminTone, adminRadius, adminSpace, adminIcon } from '@/components/admin';
import { Row } from '@/components/ui';
import { fam } from '@/lib/theme';
import { formatDate } from '@/lib/format';

/* ───────────────────────── Angka & tanggal ───────────────────────── */

/** Persen gaya Indonesia: 12,3% */
export const pctId = (n: number | null | undefined, digits = 1) =>
  `${(Number(n) || 0).toLocaleString('id-ID', { maximumFractionDigits: digits })}%`;

/** Bagi aman (hindari bagi nol) lalu jadikan persen. */
export const share = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);

/** Rupiah ringkas untuk label grafik: Rp1,2 jt · Rp3,4 M. */
export const rupiahShort = (n: number | null | undefined) => {
  const v = Math.round(Number(n) || 0);
  const a = Math.abs(v), sign = v < 0 ? '-' : '';
  const one = (x: number) => x.toLocaleString('id-ID', { maximumFractionDigits: 1 });
  if (a >= 1e9) return `${sign}Rp${one(a / 1e9)} M`;
  if (a >= 1e6) return `${sign}Rp${one(a / 1e6)} jt`;
  if (a >= 1e3) return `${sign}Rp${one(a / 1e3)} rb`;
  return `${sign}Rp${a}`;
};

const JKT_OFFSET = 7 * 60 * 60 * 1000;                     // WIB tetap UTC+7 (tanpa DST)
const pad = (n: number) => String(n).padStart(2, '0');
const ymdOf = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
/** Tanggal "hari ini" menurut waktu Jakarta (server memfilter pakai Asia/Jakarta). */
export const todayJkt = () => ymdOf(new Date(Date.now() + JKT_OFFSET));

export type DateRange = { from: string; to: string };
export type RangePreset = 'today' | 'd7' | 'month' | 'prev' | 'custom';
export const RANGE_PRESETS: { key: RangePreset; label: string }[] = [
  { key: 'today', label: 'Hari ini' },
  { key: 'd7', label: '7 hari' },
  { key: 'month', label: 'Bulan ini' },
  { key: 'prev', label: 'Bulan lalu' },
  { key: 'custom', label: 'Kustom' },
];

/** Rentang tanggal untuk sebuah preset (dihitung pada zona waktu Jakarta). */
export function presetRange(key: RangePreset): DateRange {
  const t = new Date(Date.now() + JKT_OFFSET);
  const y = t.getUTCFullYear(), m = t.getUTCMonth(), d = t.getUTCDate();
  const mk = (yy: number, mm: number, dd: number) => ymdOf(new Date(Date.UTC(yy, mm, dd)));
  switch (key) {
    case 'today': return { from: mk(y, m, d), to: mk(y, m, d) };
    case 'd7': return { from: mk(y, m, d - 6), to: mk(y, m, d) };
    case 'prev': return { from: mk(y, m - 1, 1), to: mk(y, m, 0) };
    case 'month':
    default: return { from: mk(y, m, 1), to: mk(y, m, d) };
  }
}

/** "1 Sep 2026 – 6 Sep 2026" (satu tanggal bila sama). */
export const rangeLabel = (r: DateRange) => {
  const a = formatDate(`${r.from}T00:00:00`, false);
  const b = formatDate(`${r.to}T00:00:00`, false);
  return a === b ? a : `${a} – ${b}`;
};

/** Rentang valid? (format YYYY-MM-DD, awal ≤ akhir, maks 400 hari seperti aturan server) */
export function rangeError(r: DateRange): string | null {
  const ok = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
  if (!ok(r.from) || !ok(r.to)) return 'Format tanggal harus TTTT-BB-HH (mis. 2026-09-01).';
  const days = (Date.parse(`${r.to}T00:00:00Z`) - Date.parse(`${r.from}T00:00:00Z`)) / 86400000;
  if (days < 0) return 'Tanggal akhir tidak boleh lebih awal dari tanggal mulai.';
  if (days > 400) return 'Rentang maksimal 400 hari.';
  return null;
}

/* ───────────────────────── Isian tanggal ───────────────────────── */

/** Isian tanggal: pemilih tanggal asli di web, ketik manual di aplikasi native. */
export function DateField({ value, onChange, label }: { value: string; onChange: (v: string) => void; label?: string }) {
  const inner = Platform.OS === 'web'
    ? React.createElement('input', {
      type: 'date',
      value,
      onChange: (e: { target: { value: string } }) => onChange(e.target.value),
      style: {
        height: 30, boxSizing: 'border-box', borderRadius: adminRadius.sm, border: `1px solid ${adminTone.borderStrong}`,
        background: adminTone.surface, color: adminTone.ink, fontSize: 14, fontFamily: 'inherit',
        padding: '0 8px', outline: 'none', minWidth: 138,
      },
    })
    : <TextInput value={value} onChangeText={onChange} placeholder="TTTT-BB-HH" placeholderTextColor={adminTone.faint} style={st.dateInput} />;
  return <View style={{ gap: 3 }}>{label ? <Text style={font.label}>{label}</Text> : null}{inner}</View>;
}

/* ───────────────────────── Remah roti ───────────────────────── */

/** Jejak navigasi drill-down: "Semua layanan › AntarRide". */
export function Breadcrumb({ items }: { items: { label: string; onPress?: () => void }[] }) {
  return (
    <Row gap={6} style={{ flexWrap: 'wrap' }}>
      {items.map((it, i) => (
        <Row key={`${it.label}-${i}`} gap={6}>
          {i > 0 ? <Ionicons name="chevron-forward" size={adminIcon.sm} color={adminTone.faint} /> : null}
          {it.onPress ? (
            <Pressable onPress={it.onPress} hitSlop={6}>
              <Text style={[font.small, { color: adminTone.teal, ...fam(700) }]}>{it.label}</Text>
            </Pressable>
          ) : <Text style={[font.small, { color: adminTone.ink, ...fam(700) }]}>{it.label}</Text>}
        </Row>
      ))}
    </Row>
  );
}

/* ───────────────────────── Baris rincian ───────────────────────── */

/**
 * Satu baris rincian angka (label kiri, angka kanan rata & tabular-nums).
 * `strong` untuk baris total, `indent` untuk sub-rincian, `top` untuk garis pemisah di atas.
 */
export function LineItem({ label, value, hint, color, strong, indent, top, dot }: {
  label: string; value: string; hint?: string; color?: string; strong?: boolean; indent?: boolean; top?: boolean; dot?: string;
}) {
  return (
    <View style={[st.line, top && { borderTopWidth: 1, borderTopColor: adminTone.borderStrong, marginTop: 4, paddingTop: 10 }, indent && { paddingLeft: 14 }]}>
      <Row gap={7} style={{ flex: 1, minWidth: 0, paddingRight: 12 }}>
        {dot ? <View style={{ width: 8, height: 8, borderRadius: 3, backgroundColor: dot }} /> : null}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={indent ? font.small : strong ? font.bodyStrong : font.body} numberOfLines={2}>{label}</Text>
          {hint ? <Text style={font.tiny} numberOfLines={2}>{hint}</Text> : null}
        </View>
      </Row>
      <Text style={[font.mono, strong && { fontSize: 14, ...fam(700) }, color ? { color } : null]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

/* ───────────────────────── Bar proporsi ───────────────────────── */

/** Bar horisontal proporsional + keterangan — untuk bagi hasil satu order. */
export function SplitBar({ segments, height = 14, format, legend = true }: {
  segments: { label: string; value: number; color: string }[];
  height?: number; format?: (n: number) => string; legend?: boolean;
}) {
  const fmt = format ?? ((n: number) => n.toLocaleString('id-ID'));
  const total = segments.reduce((a, b) => a + Math.max(0, b.value), 0) || 1;
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', height, borderRadius: adminRadius.chip, overflow: 'hidden', backgroundColor: adminTone.border }}>
        {segments.map((sg, i) => (
          <View key={`${sg.label}-${i}`} style={{ flexGrow: Math.max(0, sg.value) / total, flexBasis: 0, backgroundColor: sg.color }} />
        ))}
      </View>
      {legend ? (
        <Row gap={14} style={{ flexWrap: 'wrap' }}>
          {segments.map((sg, i) => (
            <Row key={`lg-${sg.label}-${i}`} gap={5}>
              <View style={{ width: 9, height: 9, borderRadius: 3, backgroundColor: sg.color }} />
              <Text style={font.tiny}>{sg.label} · {fmt(sg.value)} ({pctId(share(Math.max(0, sg.value), total))})</Text>
            </Row>
          ))}
        </Row>
      ) : null}
    </View>
  );
}

/* ───────────────────────── Batang bertumpuk ───────────────────────── */

/**
 * Grafik batang bertumpuk sederhana (mis. COGS + marjin = pendapatan per bulan).
 * Nilai negatif diperlakukan nol pada batang, tetapi tetap terbaca pada tabel di sampingnya.
 */
export function StackedBars({ data, legend, height = 150, format }: {
  data: { label: string; segments: { value: number; color: string }[]; note?: string }[];
  legend?: { label: string; color: string }[]; height?: number; format?: (n: number) => string;
}) {
  const fmt = format ?? ((n: number) => n.toLocaleString('id-ID'));
  const totals = data.map((d) => d.segments.reduce((a, b) => a + Math.max(0, b.value), 0));
  const max = Math.max(1, ...totals);
  if (data.length === 0) return <Text style={font.small}>Belum ada data pada periode ini.</Text>;
  return (
    <View style={{ gap: 10 }}>
      <Row gap={8} style={{ alignItems: 'flex-end', height: height + 34 }}>
        {data.map((d, i) => (
          <View key={`${d.label}-${i}`} style={{ flex: 1, alignItems: 'center', gap: 4, minWidth: 0 }}>
            <Text style={[font.tiny, { fontVariant: ['tabular-nums'] }]} numberOfLines={1}>{fmt(totals[i])}</Text>
            <View style={{ height, width: '100%', maxWidth: 46, justifyContent: 'flex-end', gap: 2 }}>
              {d.segments.map((sg, j) => (
                <View key={j} style={{ height: Math.max(sg.value > 0 ? 3 : 0, (Math.max(0, sg.value) / max) * (height - 4)), backgroundColor: sg.color, borderRadius: 4, opacity: 0.92 }} />
              ))}
            </View>
            <Text style={font.tiny} numberOfLines={1}>{d.label}</Text>
          </View>
        ))}
      </Row>
      {legend?.length ? (
        <Row gap={14} style={{ flexWrap: 'wrap' }}>
          {legend.map((l) => (
            <Row key={l.label} gap={5}><View style={{ width: 9, height: 9, borderRadius: 3, backgroundColor: l.color }} /><Text style={font.tiny}>{l.label}</Text></Row>
          ))}
        </Row>
      ) : null}
    </View>
  );
}

/* ───────────────────────── Catatan & definisi ───────────────────────── */

/** Catatan kaki: sumber data & keterbatasan laporan. */
export function FootNote({ title = 'Sumber data & keterbatasan', lines, style }: { title?: string; lines: string[]; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[st.note, style]}>
      <Row gap={7}>
        <Ionicons name="information-circle-outline" size={adminIcon.sm} color={adminTone.muted} />
        <Text style={font.label}>{title}</Text>
      </Row>
      {lines.map((l, i) => (
        <Row key={i} gap={7} style={{ alignItems: 'flex-start' }}>
          <Text style={[font.tiny, { marginTop: 1 }]}>•</Text>
          <Text style={[font.tiny, { flex: 1 }]}>{l}</Text>
        </Row>
      ))}
    </View>
  );
}

/** Definisi istilah (satu kalimat per istilah) supaya pembaca non-teknis paham. */
export function DefinitionList({ items }: { items: { term: string; desc: string }[] }) {
  return (
    <View style={{ gap: 6 }}>
      {items.map((it) => (
        <Text key={it.term} style={[font.tiny, { flex: 1 }]}>
          <Text style={{ color: adminTone.ink2, ...fam(700) }}>{it.term}</Text>
          <Text> — {it.desc}</Text>
        </Text>
      ))}
    </View>
  );
}

const st = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, minHeight: 34 },
  dateInput: { height: 30, minWidth: 138, borderRadius: adminRadius.sm, borderWidth: 1, borderColor: adminTone.borderStrong, backgroundColor: adminTone.surface, paddingHorizontal: 8, fontSize: 14, color: adminTone.ink },
  note: { gap: 4, backgroundColor: adminTone.surfaceAlt, borderRadius: adminRadius.card, borderWidth: 1, borderColor: adminTone.border, padding: adminSpace.md },
});
