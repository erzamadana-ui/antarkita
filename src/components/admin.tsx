// Sistem desain PANEL ADMIN AntarKita — "Maincore" (dashboard SaaS modern, dipakai di desktop lewat web).
// Latar abu sangat muda, kartu putih radius 14–16 + border 1px, kepadatan tinggi tapi lapang,
// tipografi berjenjang (adminFont), angka memakai tabular-nums, aksen warna tipis.
// Palet merek tidak berubah: teal #187A85 tetap warna utama.
import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, RefreshControl, Platform, Modal, TextStyle, ViewStyle, StyleProp } from 'react-native';
import Svg, { Polyline, Circle, Line, Text as SvgText } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { shortMonth } from '@/lib/format';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, withSpring, useReducedMotion } from 'react-native-reanimated';
import { colors, fam, motion } from '@/lib/theme';
import { Row, Button, Input, toast } from '@/components/ui';
import { AnimatedNumber, Entrance } from '@/components/motion';
import { rpc } from '@/lib/supabase';
import { useCall, callSupported } from '@/lib/call';
import { useAdminSecurity, handleAdminError } from '@/store/adminSecurity';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

/* ───────────────────────── Token ───────────────────────── */

/** Warna khusus panel admin (netral abu-biru) — warna merek tetap dari `colors`. */
export const adminTone = {
  bg: '#F6F8FA',
  surface: '#FFFFFF',
  surfaceAlt: '#FBFCFD',
  border: '#EDF1F4',
  borderStrong: '#E1E8EC',
  zebra: '#FAFBFC',
  hover: 'rgba(24,122,133,0.055)',
  ink: '#0F1D20',
  ink2: '#3B4C50',
  muted: '#6B7C80',
  faint: '#94A4A8',
  // aksen kategori data
  teal: colors.primary,
  blue: '#2F6FED',
  orange: '#E07B39',
  green: '#17A673',
  amber: '#D9880B',
  red: '#DC4B50',
  violet: '#7B61FF',
  slate: '#8797A0',
};

/** Skala spasi panel admin (kelipatan 4). */
export const adminSpace = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24 };
/** Radius panel admin — kartu 14–16. */
export const adminRadius = { chip: 999, sm: 8, md: 10, card: 14, lg: 16 };
/** Bayangan sangat halus (kartu tidak boleh "melayang"). */
export const adminShadow = {
  card: { shadowColor: '#0F1D20', shadowOpacity: 0.045, shadowRadius: 10, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  pop: { shadowColor: '#0F1D20', shadowOpacity: 0.12, shadowRadius: 28, shadowOffset: { width: 0, height: 12 }, elevation: 8 },
};

const tnum = ['tabular-nums'] as TextStyle['fontVariant'];

/**
 * Skala tipografi panel admin. Nama kunci sengaja sama dengan `font` di theme
 * agar layar admin cukup mengimpor `adminFont as font`.
 */
export const adminFont = {
  display: { fontSize: 22, ...fam(600), color: adminTone.ink, letterSpacing: -0.4, lineHeight: 28 } as TextStyle,
  h1: { fontSize: 18, ...fam(700), color: adminTone.ink, letterSpacing: -0.2, lineHeight: 24 } as TextStyle,
  h2: { fontSize: 15, ...fam(700), color: adminTone.ink, lineHeight: 20 } as TextStyle,
  h3: { fontSize: 14, ...fam(700), color: adminTone.ink, lineHeight: 19 } as TextStyle,
  body: { fontSize: 13.5, ...fam(500), color: adminTone.ink2, lineHeight: 19 } as TextStyle,
  bodyStrong: { fontSize: 13.5, ...fam(700), color: adminTone.ink, lineHeight: 19 } as TextStyle,
  small: { fontSize: 12.5, ...fam(500), color: adminTone.muted, lineHeight: 17 } as TextStyle,
  tiny: { fontSize: 11.5, ...fam(500), color: adminTone.faint, lineHeight: 15 } as TextStyle,
  label: { fontSize: 11, ...fam(700), color: adminTone.faint, letterSpacing: 0.4, textTransform: 'uppercase' } as TextStyle,
  /** Angka dalam tabel / baris — rata & sejajar. */
  mono: { fontSize: 13, ...fam(600), color: adminTone.ink, fontVariant: tnum } as TextStyle,
  /** Angka besar kartu statistik. */
  num: { fontSize: 24, ...fam(700), color: adminTone.ink, letterSpacing: -0.6, lineHeight: 30, fontVariant: tnum } as TextStyle,
};

/** Warna semantik status: menunggu=amber, aktif=hijau, ditangguhkan=merah, nonaktif=abu. */
export type ToneKey = 'wait' | 'ok' | 'bad' | 'off' | 'info' | 'brand' | 'neutral';
export const TONE: Record<ToneKey, { fg: string; bg: string; border: string }> = {
  wait: { fg: '#9A6206', bg: '#FEF6E7', border: '#F6E2BC' },
  ok: { fg: '#0E7A55', bg: '#E8F7F0', border: '#C6EADB' },
  bad: { fg: '#B22D31', bg: '#FDECEC', border: '#F6CFD0' },
  off: { fg: '#5F7076', bg: '#F1F4F6', border: '#E1E8EC' },
  info: { fg: '#1F58C9', bg: '#EAF1FE', border: '#CFE0FB' },
  brand: { fg: colors.primaryDark, bg: '#E9F3F4', border: '#CCE4E6' },
  neutral: { fg: adminTone.ink2, bg: '#F4F7F8', border: adminTone.border },
};
/** Peta status umum (approval, aktif/nonaktif) → tone. */
export const statusTone = (s?: string | null): ToneKey => {
  const k = String(s ?? '').toLowerCase();
  if (['approved', 'aktif', 'active', 'open', 'resolved', 'completed', 'selesai', 'ya'].includes(k)) return 'ok';
  if (['pending', 'menunggu', 'waiting', 'waiting_user', 'in_progress', 'offered'].includes(k)) return 'wait';
  if (['suspended', 'ditangguhkan', 'rejected', 'ditolak', 'cancelled', 'urgent', 'failed'].includes(k)) return 'bad';
  if (['inactive', 'nonaktif', 'closed', 'expired', 'off'].includes(k)) return 'off';
  return 'neutral';
};

/* ─────────────────── Utilitas kecil ─────────────────── */

/** Teks 1 baris dengan tooltip `title` di web (RN Web tidak meneruskan prop `title` ke DOM). */
export function Truncate({ children, title, style, lines = 1 }: { children: React.ReactNode; title?: string; style?: StyleProp<TextStyle>; lines?: number }) {
  const t = <Text numberOfLines={lines} style={style}>{children}</Text>;
  if (Platform.OS === 'web' && title) return React.createElement('div', { title, style: { minWidth: 0, maxWidth: '100%' } }, t);
  return t;
}

const webStyle = (o: object) => (Platform.OS === 'web' ? (o as ViewStyle) : null);

/* ─────────────────── Kerangka halaman ─────────────────── */

/** Kerangka halaman admin: kepala (judul + aksi) lalu konten scroll, lebar maks 1360 (nyaman di 1280 & 1024). */
export function AdminPage({ title, subtitle, children, right, onRefresh, refreshing, maxWidth = 1360 }: { title: string; subtitle?: string; children: React.ReactNode; right?: React.ReactNode; onRefresh?: () => Promise<void> | void; refreshing?: boolean; maxWidth?: number }) {
  return (
    <View style={{ flex: 1, backgroundColor: adminTone.bg }}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: adminSpace.xxl, gap: adminSpace.lg, maxWidth, width: '100%', alignSelf: 'center', paddingBottom: 56 }} showsVerticalScrollIndicator={false}
        refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} /> : undefined}>
        <Row between style={{ flexWrap: 'wrap', gap: 10, minHeight: 40 }}>
          <View style={{ flexShrink: 1, minWidth: 220 }}>
            <Text style={adminFont.display}>{title}</Text>
            {subtitle ? <Text style={[adminFont.small, { marginTop: 2 }]}>{subtitle}</Text> : null}
          </View>
          {right ? <Row gap={8} style={{ flexWrap: 'wrap' }}>{right}</Row> : null}
        </Row>
        {children}
      </ScrollView>
    </View>
  );
}

/** Panel/kartu isi: judul kiri, aksi kanan, isi di bawah. `Section` = alias. */
export function Panel({ title, subtitle, right, children, style, padded = true, icon, iconColor = adminTone.teal, bodyStyle }: { title?: string; subtitle?: string; right?: React.ReactNode; children?: React.ReactNode; style?: StyleProp<ViewStyle>; padded?: boolean; icon?: IconName; iconColor?: string; bodyStyle?: StyleProp<ViewStyle> }) {
  return (
    <View style={[s.panel, style]}>
      {(title || right) ? (
        <View style={s.panelHead}>
          <Row gap={10} style={{ flex: 1, minWidth: 0 }}>
            {icon ? <View style={[s.iconBox, { backgroundColor: iconColor + '14', borderColor: iconColor + '2E' }]}><Ionicons name={icon} size={15} color={iconColor} /></View> : null}
            <View style={{ flex: 1, minWidth: 0 }}>
              {title ? <Text style={adminFont.h2} numberOfLines={1}>{title}</Text> : null}
              {subtitle ? <Text style={adminFont.tiny} numberOfLines={2}>{subtitle}</Text> : null}
            </View>
          </Row>
          {right ? <Row gap={6} style={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>{right}</Row> : null}
        </View>
      ) : null}
      <View style={[padded && { padding: adminSpace.lg }, bodyStyle]}>{children}</View>
    </View>
  );
}
export const Section = Panel;

/** Kartu isi tanpa kepala (pengganti `Card` kaca di layar admin). */
export function AdminCard({ children, style, onPress, padded = true }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; padded?: boolean }) {
  const content = <View style={[s.panel, padded && { padding: adminSpace.lg }, style]}>{children}</View>;
  if (!onPress) return content;
  return <Pressable onPress={onPress}>{content}</Pressable>;
}


/* ─────────────────── Kartu statistik ─────────────────── */

/**
 * Kartu statistik: ikon berbingkai lembut kiri-atas, label kecil, angka besar (tabular-nums),
 * delta ±% berwarna, hint di bawah. Tinggi seragam.
 */
export function StatCard({ label, value, hint, color = adminTone.teal, index = 0, icon, delta, deltaLabel, onPress }: {
  label: string; value: string | number; hint?: string; color?: string; index?: number; icon?: IconName;
  /** Perubahan dalam persen (positif = naik). */
  delta?: number | null; deltaLabel?: string; onPress?: () => void;
}) {
  const lift = useSharedValue(0);
  const reduce = useReducedMotion();
  const a = useAnimatedStyle(() => ({ transform: [{ translateY: -lift.value * 2 }] }));
  const numeric = typeof value === 'number' && Number.isFinite(value);
  const str = String(value);
  const up = (delta ?? 0) >= 0;
  const deltaColor = delta == null ? adminTone.muted : up ? TONE.ok.fg : TONE.bad.fg;
  return (
    <Entrance index={index} from="up" style={{ flexGrow: 1, flexBasis: 190, minWidth: 170 }}>
      <Pressable onPress={onPress} disabled={!onPress} onHoverIn={() => { if (!reduce) lift.value = withSpring(1, motion.spring); }} onHoverOut={() => { lift.value = withSpring(0, motion.springSoft); }}>
        <Animated.View style={[s.stat, a]}>
          <Row gap={8} style={{ minHeight: 28, alignItems: 'flex-start' }}>
            {icon ? <View style={[s.iconBox, { backgroundColor: color + '14', borderColor: color + '2E' }]}><Ionicons name={icon} size={15} color={color} /></View> : <View style={[s.dot, { backgroundColor: color }]} />}
            <Truncate style={adminFont.label} title={label} lines={2}>{label}</Truncate>
          </Row>
          <View style={{ marginTop: 6, minHeight: 32, justifyContent: 'center' }}>
            {numeric
              ? <AnimatedNumber value={value as number} format={(n) => Math.round(n).toLocaleString('id-ID')} style={adminFont.num} />
              : <Text style={[adminFont.num, str.length > 10 && { fontSize: 19, lineHeight: 25 }, str.length > 15 && { fontSize: 16, lineHeight: 22 }]} numberOfLines={1}>{str}</Text>}
          </View>
          <Row gap={6} style={{ marginTop: 4, minHeight: 18, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            {delta != null ? (
              <Row gap={2}>
                <Ionicons name={up ? 'trending-up' : 'trending-down'} size={12} color={deltaColor} />
                <Text style={[adminFont.tiny, { color: deltaColor, ...fam(700) }]}>{up ? '+' : ''}{Number(delta).toFixed(1)}%</Text>
              </Row>
            ) : null}
            {hint || deltaLabel ? <Truncate style={adminFont.tiny} title={hint ?? deltaLabel} lines={2}>{hint ?? deltaLabel}</Truncate> : null}
          </Row>
        </Animated.View>
      </Pressable>
    </Entrance>
  );
}

/* ─────────────────── Pill / status ─────────────────── */

export function Pill({ text, tone = 'neutral', color, icon, style }: { text: string; tone?: ToneKey; color?: string; icon?: IconName; style?: StyleProp<ViewStyle> }) {
  const t = TONE[tone];
  const fg = color ?? t.fg;
  return (
    <View style={[s.pill, { backgroundColor: color ? color + '12' : t.bg, borderColor: color ? color + '33' : t.border }, style]}>
      {icon ? <Ionicons name={icon} size={11} color={fg} /> : null}
      <Text style={{ color: fg, fontSize: 11.5, ...fam(700) }} numberOfLines={1}>{text}</Text>
    </View>
  );
}
const STATUS_ID: Record<string, string> = { pending: 'Menunggu', approved: 'Aktif', suspended: 'Ditangguhkan', rejected: 'Ditolak', active: 'Aktif', inactive: 'Nonaktif' };
/** Badge status dengan warna semantik konsisten di seluruh panel. */
export function StatusPill({ status, label, style }: { status?: string | null; label?: string; style?: StyleProp<ViewStyle> }) {
  const k = String(status ?? '').toLowerCase();
  return <Pill text={label ?? STATUS_ID[k] ?? String(status ?? '—')} tone={statusTone(k)} style={style} />;
}

/* ─────────────────── Toolbar & filter ─────────────────── */

/** Baris alat: pencarian + chip filter + tombol aksi kanan. */
export function Toolbar({ q, onQ, placeholder = 'Cari…', filters, filter, onFilter, right, children }: {
  q?: string; onQ?: (v: string) => void; placeholder?: string;
  filters?: { key: string; label: string }[]; filter?: string; onFilter?: (v: string) => void;
  right?: React.ReactNode; children?: React.ReactNode;
}) {
  return (
    <View style={s.toolbar}>
      <Row gap={10} style={{ flexWrap: 'wrap', flex: 1, minWidth: 0 }}>
        {onQ ? <Input placeholder={placeholder} value={q ?? ''} onChangeText={onQ} icon="search" containerStyle={{ minWidth: 220, flexGrow: 1, maxWidth: 340 }} style={{ paddingVertical: 6 }} /> : null}
        {filters?.length ? <FilterBar options={filters} value={filter ?? filters[0].key} onChange={onFilter ?? (() => {})} /> : null}
        {children}
      </Row>
      {right ? <Row gap={8} style={{ flexWrap: 'wrap' }}>{right}</Row> : null}
    </View>
  );
}

export function FilterBar({ options, value, onChange }: { options: { key: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, alignItems: 'center' }} style={{ flexGrow: 0 }}>
      {options.map((o) => {
        const active = value === o.key;
        return (
          <Pressable key={o.key} onPress={() => onChange(o.key)} style={(st) => [s.filter, (st as { hovered?: boolean }).hovered && !active && { backgroundColor: adminTone.surfaceAlt, borderColor: adminTone.borderStrong }, active && s.filterOn]}>
            <Text style={{ color: active ? '#fff' : adminTone.ink2, fontSize: 12.5, ...fam(active ? 700 : 600) }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/* ─────────────────── Keadaan kosong ─────────────────── */

export function EmptyState({ icon = 'file-tray-outline', title, subtitle, action }: { icon?: IconName; title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: 40, paddingHorizontal: 20, gap: 6 }}>
      <View style={s.emptyIcon}><Ionicons name={icon} size={22} color={adminTone.faint} /></View>
      <Text style={[adminFont.h2, { marginTop: 6 }]}>{title}</Text>
      {subtitle ? <Text style={[adminFont.small, { textAlign: 'center', maxWidth: 420 }]}>{subtitle}</Text> : null}
      {action ? <View style={{ marginTop: 10 }}>{action}</View> : null}
    </View>
  );
}

/* ─────────────────── Tabel data ─────────────────── */

export interface Column {
  key: string; label: string; width?: number; flex?: number;
  align?: 'left' | 'right' | 'center';
  /** Angka: rata kanan + tabular-nums. */
  mono?: boolean;
  render?: (row: Record<string, unknown>) => React.ReactNode;
}

/**
 * Tabel data: header menempel di atas, baris zebra sangat halus, hover, kolom angka rata kanan,
 * teks 1 baris dengan tooltip di web. Scroll horizontal terjadi DI DALAM wadah (halaman tidak ikut geser).
 */
export function DataTable({ columns, rows, keyField = 'id', emptyText = 'Tidak ada data', emptyIcon, maxHeight, onRowPress }: {
  columns: Column[]; rows: Record<string, unknown>[]; keyField?: string; emptyText?: string; emptyIcon?: IconName;
  /** Bila diisi, badan tabel punya scroll vertikal sendiri dan header benar-benar sticky. */
  maxHeight?: number;
  onRowPress?: (row: Record<string, unknown>) => void;
}) {
  const cellStyle = (c: Column): ViewStyle => ({
    width: c.flex ? undefined : c.width ?? 140,
    flexGrow: c.flex ?? 0, flexBasis: c.flex ? (c.width ?? 140) : undefined, flexShrink: 0,
    minWidth: 0, justifyContent: 'center', paddingRight: 12,
    alignItems: c.align === 'right' || c.mono ? 'flex-end' : c.align === 'center' ? 'center' : 'flex-start',
  });
  const body = (
    <View style={{ minWidth: '100%' }}>
      <View style={[s.tr, s.th, webStyle({ position: 'sticky', top: 0, zIndex: 2 })]}>
        {columns.map((c) => (
          <View key={c.key} style={cellStyle(c)}>
            <Text style={[adminFont.label, { color: adminTone.muted }]} numberOfLines={1}>{c.label}</Text>
          </View>
        ))}
      </View>
      {rows.length === 0
        ? <EmptyState icon={emptyIcon} title={emptyText} />
        : rows.map((r, i) => (
          <TableRow key={String(r[keyField] ?? i)} zebra={i % 2 === 1} index={i} onPress={onRowPress ? () => onRowPress(r) : undefined}>
            {columns.map((c) => {
              const raw = r[c.key];
              return (
                <View key={c.key} style={cellStyle(c)}>
                  {c.render ? c.render(r) : <Truncate style={c.mono ? adminFont.mono : adminFont.body} title={raw == null ? undefined : String(raw)}>{raw == null || raw === '' ? '—' : String(raw)}</Truncate>}
                </View>
              );
            })}
          </TableRow>
        ))}
    </View>
  );
  return (
    <View style={s.table}>
      <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ minWidth: '100%' }} style={maxHeight ? { maxHeight } : undefined}>
        {maxHeight ? <ScrollView style={{ maxHeight }} showsVerticalScrollIndicator>{body}</ScrollView> : body}
      </ScrollView>
    </View>
  );
}
/** Alias lama (dipakai banyak layar admin). */
export const Table = DataTable;

function TableRow({ children, zebra, index, onPress }: { children: React.ReactNode; zebra: boolean; index: number; onPress?: () => void }) {
  const o = useSharedValue(0);
  const reduce = useReducedMotion();
  useEffect(() => { o.value = reduce || index > 24 ? 1 : withTiming(1, { duration: motion.base }); }, [o, reduce, index]);
  const hov = useSharedValue(0);
  const a = useAnimatedStyle(() => ({ opacity: o.value, backgroundColor: hov.value ? adminTone.hover : zebra ? adminTone.zebra : adminTone.surface }));
  return (
    <Pressable onPress={onPress} disabled={!onPress} onHoverIn={() => { hov.value = 1; }} onHoverOut={() => { hov.value = 0; }}>
      <Animated.View style={[s.tr, s.td, a]}>{children}</Animated.View>
    </Pressable>
  );
}

/* ─────────────────── Grafik ─────────────────── */

export function MiniBars({ data, color = adminTone.teal }: { data: { label: string; value: number }[]; color?: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <Row gap={8} style={{ alignItems: 'flex-end', height: 132 }}>
      {data.map((d, i) => (
        <View key={d.label + i} style={{ flex: 1, alignItems: 'center', gap: 4 }}>
          <Text style={[adminFont.tiny, { fontVariant: tnum }]}>{d.value}</Text>
          <Bar height={Math.max(4, (d.value / max) * 84)} color={color} delay={i * 50} />
          <Text style={adminFont.tiny} numberOfLines={1}>{d.label}</Text>
        </View>
      ))}
      {data.length === 0 ? <Text style={adminFont.small}>Belum ada data.</Text> : null}
    </Row>
  );
}
function Bar({ height, color, delay }: { height: number; color: string; delay: number }) {
  const h = useSharedValue(4);
  const reduce = useReducedMotion();
  useEffect(() => { const t = setTimeout(() => { h.value = reduce ? height : withSpring(height, motion.springSoft); }, delay); return () => clearTimeout(t); }, [height, delay, h, reduce]);
  const a = useAnimatedStyle(() => ({ height: h.value }));
  return <Animated.View style={[{ width: '100%', maxWidth: 34, backgroundColor: color, borderRadius: 6, opacity: 0.9 }, a]} />;
}

/** Grafik garis multi-seri sederhana (tren bulanan per kota). */
export function TrendChart({ months, series, height = 200 }: { months: string[]; series: { label: string; values: number[]; color: string }[]; height?: number }) {
  const [w, setW] = useState(0);
  const max = Math.max(1, ...series.flatMap((sr) => sr.values));
  const padL = 34, padB = 22, padT = 10;
  const innerW = Math.max(0, w - padL - 10), innerH = height - padB - padT;
  const x = (i: number) => padL + (months.length <= 1 ? innerW / 2 : (i / (months.length - 1)) * innerW);
  const y = (v: number) => padT + innerH - (v / max) * innerH;
  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ width: '100%' }}>
      {w > 0 && (
        <Svg width={w} height={height}>
          {[0, 0.25, 0.5, 0.75, 1].map((f) => <Line key={f} x1={padL} x2={w - 10} y1={y(max * f)} y2={y(max * f)} stroke={adminTone.border} strokeWidth={1} />)}
          {[0, 0.5, 1].map((f) => <SvgText key={`t${f}`} x={padL - 6} y={y(max * f) + 4} fontSize={9} fill={adminTone.faint} textAnchor="end">{Math.round(max * f)}</SvgText>)}
          {months.map((m, i) => <SvgText key={m} x={x(i)} y={height - 6} fontSize={9} fill={adminTone.faint} textAnchor="middle">{shortMonth(m)}</SvgText>)}
          {series.map((sr) => (
            <React.Fragment key={sr.label}>
              <Polyline points={sr.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')} fill="none" stroke={sr.color} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />
              {sr.values.map((v, i) => <Circle key={i} cx={x(i)} cy={y(v)} r={2.8} fill="#fff" stroke={sr.color} strokeWidth={2} />)}
            </React.Fragment>
          ))}
        </Svg>
      )}
      <Row gap={12} style={{ flexWrap: 'wrap', marginTop: 6 }}>
        {series.map((sr) => <Row key={sr.label} gap={5}><View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: sr.color }} /><Text style={adminFont.tiny}>{sr.label}</Text></Row>)}
      </Row>
    </View>
  );
}
export const CITY_COLORS = ['#187A85', '#E07B39', '#2F6FED', '#DC4B50', '#7B61FF', '#0EA5E9', '#17A673', '#D9880B', '#8B5CF6', '#8797A0'];

/* ─────────────────── Prompt alasan (tetap dipakai) ─────────────────── */

/** Prompt alasan (suspend/tolak/nonaktif) — alasan tersimpan di log aktivitas & terlihat oleh mitra. */
export function ReasonPrompt({ visible, title, subtitle, onCancel, onSubmit, confirmLabel = 'Simpan', color = colors.danger, optional, quick }: { visible: boolean; title: string; subtitle?: string; onCancel: () => void; onSubmit: (reason: string) => Promise<void> | void; confirmLabel?: string; color?: string; optional?: boolean; quick?: string[] }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (visible) setReason(''); }, [visible]);
  const QUICK = quick ?? ['Rating rendah & banyak keluhan pelanggan', 'Dokumen tidak valid / kedaluwarsa', 'Pelanggaran SOP keselamatan', 'Penipuan / manipulasi order', 'Permintaan mitra sendiri', 'Sudah diperbaiki, diaktifkan kembali'];
  return (
    <AdminDialog visible={visible} onClose={onCancel} title={title} subtitle={subtitle} width={520}>
      <Row gap={6} style={{ flexWrap: 'wrap' }}>{QUICK.map((qq) => <SoftChip key={qq} label={qq} active={reason === qq} color={color} onPress={() => setReason(qq)} />)}</Row>
      <Input placeholder={optional ? 'Alasan (opsional)' : 'Tulis alasan (min. 5 huruf) — tersimpan di log & terlihat oleh mitra'} value={reason} onChangeText={setReason} multiline style={{ minHeight: 72 }} />
      <Row gap={8} style={{ justifyContent: 'flex-end' }}>
        <Button size="sm" title="Batal" variant="ghost" onPress={onCancel} />
        <Button size="sm" title={confirmLabel} color={color} loading={busy} disabled={!optional && reason.trim().length < 5} onPress={async () => { setBusy(true); try { await onSubmit(reason.trim()); } finally { setBusy(false); } }} />
      </Row>
    </AdminDialog>
  );
}

/** Chip lembut untuk pilihan cepat di dialog. */
export function SoftChip({ label, active, onPress, color = adminTone.teal }: { label: string; active?: boolean; onPress?: () => void; color?: string }) {
  return (
    <Pressable onPress={onPress} style={[s.softChip, active && { backgroundColor: color + '14', borderColor: color + '55' }]}>
      <Text style={{ fontSize: 12, ...fam(active ? 700 : 600), color: active ? color : adminTone.ink2 }}>{label}</Text>
    </Pressable>
  );
}

/** Dialog panel admin (putih, radius 16, bayangan pop). */
export function AdminDialog({ visible, onClose, title, subtitle, children, width = 520, tone = adminTone.teal }: { visible: boolean; onClose: () => void; title: string; subtitle?: string; children: React.ReactNode; width?: number; tone?: string }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={s.backdrop}>
        <Pressable onPress={() => {}} style={{ width: '100%', maxWidth: width }}>
          <View style={s.dialog}>
            <Row between style={{ gap: 12 }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[adminFont.h1, { color: tone === adminTone.teal ? adminTone.ink : tone }]}>{title}</Text>
                {subtitle ? <Text style={[adminFont.small, { marginTop: 2 }]}>{subtitle}</Text> : null}
              </View>
              <Pressable onPress={onClose} style={s.close}><Ionicons name="close" size={18} color={adminTone.muted} /></Pressable>
            </Row>
            {children}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/* ─────────────────── Tahap 9 · Hapus mitra/pengguna (PIN + alasan) ─────────────────── */

export type DeleteKind = 'driver' | 'merchant' | 'vendor' | 'travel' | 'user';
const KIND_LABEL: Record<DeleteKind, string> = { driver: 'mitra driver', merchant: 'merchant', vendor: 'mitra pasar', travel: 'mitra travel', user: 'pengguna' };
const KIND_WARN: Record<DeleteKind, string[]> = {
  driver: ['Akun driver dinonaktifkan permanen & data pribadi dianonimkan.', 'Riwayat pesanan tetap tersimpan untuk audit & keuangan.', 'Ditolak bila masih ada order berjalan atau saldo belum nol.'],
  merchant: ['Merchant dihapus dari pencarian pelanggan, menu ikut dinonaktifkan.', 'Riwayat pesanan & pembayaran tetap tersimpan untuk audit.', 'Ditolak bila masih ada order berjalan atau saldo belum nol.'],
  vendor: ['Lapak & seluruh barangnya berhenti tampil di AntarMarket.', 'Riwayat pesanan tetap tersimpan untuk audit.', 'Ditolak bila masih ada order berjalan atau saldo belum nol.'],
  travel: ['Mitra travel berhenti menerima jadwal, carter, dan titipan AntarSend.', 'Riwayat trip & booking tetap tersimpan untuk audit.', 'Ditolak bila masih ada perjalanan berjalan atau saldo belum nol.'],
  user: ['Akun tidak bisa login lagi; nama, telepon, dan email dianonimkan.', 'Riwayat pesanan tetap tersimpan (tanpa identitas) untuk audit.', 'Ditolak bila masih ada order berjalan atau saldo belum nol.'],
};

/**
 * Dialog hapus mitra/pengguna: ringkasan entitas + alasan wajib (≥10 huruf, ada penghitung)
 * + peringatan konsekuensi + gerbang PIN admin, lalu `admin_delete_partner`.
 * Pesan error server ditampilkan apa adanya.
 */
export function DeletePartnerDialog({ target, onClose, onDeleted }: {
  target: { kind: DeleteKind; id: string; name: string; meta?: string[] } | null;
  onClose: () => void;
  onDeleted?: (id: string) => void | Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (target) { setReason(''); setErr(null); } }, [target]);
  if (!target) return null;
  const n = reason.trim().length;
  const ok = n >= 10;
  const kindLabel = KIND_LABEL[target.kind];

  const run = async () => {
    if (!ok) { setErr('Alasan wajib diisi minimal 10 huruf.'); return; }
    setErr(null);
    setBusy(true);
    try {
      if (!(await useAdminSecurity.getState().ensureUnlocked())) { setBusy(false); return; }
      await rpc('admin_delete_partner', { p_kind: target.kind, p_id: target.id, p_reason: reason.trim() });
      toast.success(`${target.name} dihapus & tercatat di log`);
      await onDeleted?.(target.id);
      onClose();
    } catch (e) {
      const msg = String((e as Error)?.message ?? e ?? '');
      if (msg.includes('ADMIN_LOCKED') || msg.includes('ADMIN_PIN_REQUIRED')) { handleAdminError(e); onClose(); }
      else setErr(msg || 'Gagal menghapus');
    } finally { setBusy(false); }
  };

  return (
    <AdminDialog visible onClose={busy ? () => {} : onClose} title={`Hapus ${kindLabel}?`} subtitle="Tindakan permanen — butuh PIN panel admin dan alasan tertulis." width={560} tone={colors.danger}>
      <View style={s.deleteSummary}>
        <Row gap={10}>
          <View style={[s.iconBox, { backgroundColor: TONE.bad.bg, borderColor: TONE.bad.border }]}><Ionicons name="trash-outline" size={15} color={TONE.bad.fg} /></View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={adminFont.h2} numberOfLines={2}>{target.name}</Text>
            <Text style={adminFont.tiny} numberOfLines={3}>{[kindLabel, ...(target.meta ?? [])].filter(Boolean).join(' · ')}</Text>
            <Text style={[adminFont.tiny, { fontVariant: tnum }]} numberOfLines={1}>ID {target.id}</Text>
          </View>
        </Row>
      </View>
      <View style={s.warnBox}>
        {KIND_WARN[target.kind].map((w) => (
          <Row key={w} gap={8} style={{ alignItems: 'flex-start' }}>
            <Ionicons name="alert-circle-outline" size={14} color={TONE.wait.fg} style={{ marginTop: 2 }} />
            <Text style={[adminFont.small, { flex: 1, color: adminTone.ink2 }]}>{w}</Text>
          </Row>
        ))}
      </View>
      <View style={{ gap: 6 }}>
        <Row between>
          <Text style={adminFont.label}>Alasan penghapusan (wajib)</Text>
          <Text style={[adminFont.tiny, { color: ok ? TONE.ok.fg : TONE.bad.fg, fontVariant: tnum }]}>{n}/10 huruf</Text>
        </Row>
        <Input placeholder="Contoh: Permintaan mitra sendiri, akun ganda, dokumen palsu…" value={reason} onChangeText={(v) => { setReason(v); if (err) setErr(null); }} multiline style={{ minHeight: 74 }} />
      </View>
      {err ? (
        <View style={s.errBox}>
          <Ionicons name="close-circle" size={15} color={TONE.bad.fg} />
          <Text style={[adminFont.small, { flex: 1, color: TONE.bad.fg }]} selectable>{err}</Text>
        </View>
      ) : null}
      <Row gap={8} style={{ justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        <Button size="sm" title="Batal" variant="ghost" onPress={onClose} disabled={busy} />
        <Button size="sm" title="Hapus permanen" variant="danger" icon="trash-outline" loading={busy} disabled={!ok} onPress={run} />
      </Row>
    </AdminDialog>
  );
}

/** Tombol Hapus standar (merah, outline) untuk baris/detail. */
export function DeleteButton({ onPress, label = 'Hapus', disabled }: { onPress: () => void; label?: string; disabled?: boolean }) {
  return <Button size="sm" title={label} variant="outline" color={colors.danger} icon="trash-outline" onPress={onPress} disabled={disabled} />;
}

/* ─────────────────── Tahap 9 · Chat & Telepon dari admin ─────────────────── */

const CALL_PHASE_ID: Record<string, string> = { outgoing: 'Memanggil…', connecting: 'Menyambungkan…', active: 'Tersambung', incoming: 'Panggilan masuk', ended: 'Panggilan berakhir' };

/**
 * Tombol Chat + Telepon untuk menghubungi pelanggan/mitra.
 * Chat  → `admin_contact_thread` lalu buka tiket di /(admin)/cs.
 * Telepon → modul WebRTC `@/lib/call` (nomor pribadi tidak pernah dibuka).
 */
export function ContactActions({ userId, name, role, subject, orderId, compact, showLabel = true }: {
  userId?: string | null; name?: string | null; role?: string | null; subject?: string; orderId?: string | null;
  compact?: boolean; showLabel?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const phase = useCall((st) => st.phase);
  const peerId = useCall((st) => st.peer?.id);
  const onThisPeer = !!userId && peerId === userId && phase !== 'idle' && phase !== 'ended';

  const openChat = async () => {
    if (!userId) return toast.error('Pengguna tidak dikenal');
    setBusy(true);
    try {
      const r = await rpc<{ ticket_id: string } | { ticket_id: string }[]>('admin_contact_thread', { p_user: userId, p_subject: subject ?? `Pesan admin untuk ${name ?? 'pengguna'}` });
      const id = Array.isArray(r) ? r[0]?.ticket_id : r?.ticket_id;
      if (!id) throw new Error('Tiket tidak terbentuk');
      router.push(`/(admin)/cs?ticket=${id}` as never);
    } catch (e) { handleAdminError(e); } finally { setBusy(false); }
  };

  const startCall = async () => {
    if (!userId) return toast.error('Pengguna tidak dikenal');
    if (!callSupported) return toast.error(Platform.OS === 'web' ? 'Browser ini tidak mendukung panggilan suara (butuh HTTPS + izin mikrofon)' : 'Panggilan suara tersedia di APK build');
    const st = useCall.getState();
    if (st.phase !== 'idle' && st.phase !== 'ended') return toast.show('Sedang ada panggilan berjalan');
    useCall.getState().reset();
    try {
      const id = await useCall.getState().startCall({ id: userId, name: name ?? 'Pengguna', role: role ?? undefined }, orderId ?? null);
      if (!id) { toast.error(useCall.getState().endReason ?? 'Gagal memulai panggilan'); return; }
      router.push(`/call/${id}` as never);
    } catch (e) { toast.error((e as Error).message || 'Gagal memulai panggilan'); }
  };

  return (
    <Row gap={6} style={{ flexWrap: 'wrap' }}>
      <IconAction icon="chatbubble-ellipses-outline" label={showLabel ? 'Chat' : undefined} color={adminTone.blue} onPress={openChat} busy={busy} compact={compact} />
      <IconAction icon="call-outline" label={showLabel ? (onThisPeer ? CALL_PHASE_ID[phase] ?? 'Telepon' : 'Telepon') : undefined} color={onThisPeer ? TONE.ok.fg : adminTone.green} onPress={startCall} compact={compact} />
    </Row>
  );
}

/** Tombol kecil ikon+label (dipakai untuk aksi baris tabel). */
export function IconAction({ icon, label, color = adminTone.teal, onPress, busy, compact, disabled }: { icon: IconName; label?: string; color?: string; onPress: () => void; busy?: boolean; compact?: boolean; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={busy || disabled} style={(st) => [s.iconAction, { borderColor: color + '33', backgroundColor: color + '0F' }, (st as { hovered?: boolean }).hovered && { backgroundColor: color + '1F' }, compact && { paddingHorizontal: 7, height: 26 }, (busy || disabled) && { opacity: 0.5 }]}>
      <Ionicons name={icon} size={13} color={color} />
      {label ? <Text style={{ color, fontSize: 12, ...fam(700) }} numberOfLines={1}>{label}</Text> : null}
    </Pressable>
  );
}

/** Bilah status panggilan (global di panel admin). */
export function AdminCallBar() {
  const { phase, peer, endReason, hangup, reset, muted, toggleMute } = useCall();
  const visible = phase === 'outgoing' || phase === 'connecting' || phase === 'active' || phase === 'ended';
  useEffect(() => { if (phase !== 'ended') return; const t = setTimeout(() => reset(), 4000); return () => clearTimeout(t); }, [phase, reset]);
  if (!visible) return null;
  const ended = phase === 'ended';
  const tone = ended ? adminTone.slate : phase === 'active' ? TONE.ok.fg : adminTone.teal;
  return (
    <View style={s.callBar} pointerEvents="box-none">
      <View style={[s.callCard, adminShadow.pop]}>
        <View style={[s.dot, { backgroundColor: tone, width: 8, height: 8, borderRadius: 4 }]} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={adminFont.h3} numberOfLines={1}>{peer?.name ?? 'Panggilan'}</Text>
          <Text style={adminFont.tiny} numberOfLines={1}>{ended ? endReason ?? 'Panggilan berakhir' : CALL_PHASE_ID[phase] ?? '—'} · nomor pribadi tidak dibagikan</Text>
        </View>
        {!ended ? <IconAction icon={muted ? 'mic-off-outline' : 'mic-outline'} color={muted ? colors.danger : adminTone.muted} onPress={toggleMute} compact /> : null}
        {ended
          ? <IconAction icon="close" color={adminTone.muted} onPress={reset} compact />
          : <IconAction icon="call-outline" label="Akhiri" color={colors.danger} onPress={() => hangup()} compact />}
      </View>
    </View>
  );
}

/* ─────────────────── Style ─────────────────── */

const s = StyleSheet.create({
  panel: { backgroundColor: adminTone.surface, borderRadius: adminRadius.lg, borderWidth: 1, borderColor: adminTone.border, overflow: 'hidden', ...adminShadow.card },
  panelHead: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: adminSpace.lg, paddingVertical: adminSpace.md, borderBottomWidth: 1, borderBottomColor: adminTone.border, backgroundColor: adminTone.surface },
  iconBox: { width: 28, height: 28, borderRadius: adminRadius.md, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 10, height: 10, borderRadius: 3, opacity: 0.9 },

  stat: { backgroundColor: adminTone.surface, borderRadius: adminRadius.card, borderWidth: 1, borderColor: adminTone.border, padding: adminSpace.lg, minHeight: 118, justifyContent: 'flex-start', ...adminShadow.card },

  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: adminRadius.chip, borderWidth: 1 },

  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'space-between', backgroundColor: adminTone.surface, borderRadius: adminRadius.card, borderWidth: 1, borderColor: adminTone.border, paddingHorizontal: adminSpace.md, paddingVertical: adminSpace.sm, ...adminShadow.card },
  filter: { paddingHorizontal: 11, paddingVertical: 6, borderRadius: adminRadius.chip, borderWidth: 1, borderColor: adminTone.border, backgroundColor: adminTone.surface },
  filterOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  softChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: adminRadius.chip, borderWidth: 1, borderColor: adminTone.border, backgroundColor: adminTone.surfaceAlt },

  emptyIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: adminTone.surfaceAlt, borderWidth: 1, borderColor: adminTone.border, alignItems: 'center', justifyContent: 'center' },

  table: { backgroundColor: adminTone.surface, borderRadius: adminRadius.lg, overflow: 'hidden', borderWidth: 1, borderColor: adminTone.border, ...adminShadow.card },
  tr: { flexDirection: 'row', paddingHorizontal: adminSpace.lg, alignItems: 'center' },
  th: { backgroundColor: adminTone.surfaceAlt, borderBottomWidth: 1, borderBottomColor: adminTone.border, paddingVertical: 9, minHeight: 38 },
  td: { paddingVertical: 11, minHeight: 52, borderBottomWidth: 1, borderBottomColor: adminTone.border },

  backdrop: { flex: 1, backgroundColor: 'rgba(15,29,32,0.42)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  dialog: { backgroundColor: adminTone.surface, borderRadius: adminRadius.lg, borderWidth: 1, borderColor: adminTone.border, padding: adminSpace.xl, gap: adminSpace.md, ...adminShadow.pop },
  close: { width: 30, height: 30, borderRadius: 10, backgroundColor: adminTone.surfaceAlt, borderWidth: 1, borderColor: adminTone.border, alignItems: 'center', justifyContent: 'center' },

  deleteSummary: { backgroundColor: adminTone.surfaceAlt, borderRadius: adminRadius.card, borderWidth: 1, borderColor: adminTone.border, padding: adminSpace.md },
  warnBox: { backgroundColor: TONE.wait.bg, borderRadius: adminRadius.card, borderWidth: 1, borderColor: TONE.wait.border, padding: adminSpace.md, gap: 6 },
  errBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: TONE.bad.bg, borderRadius: adminRadius.md, borderWidth: 1, borderColor: TONE.bad.border, padding: adminSpace.md },

  iconAction: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 30, paddingHorizontal: 9, borderRadius: adminRadius.md, borderWidth: 1 },

  callBar: { position: 'absolute', right: 20, bottom: 20, zIndex: 900 },
  callCard: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: adminTone.surface, borderRadius: adminRadius.card, borderWidth: 1, borderColor: adminTone.border, paddingHorizontal: adminSpace.md, paddingVertical: adminSpace.md, minWidth: 280, maxWidth: 360 },
});

/** Grid 12 kolom sederhana: `span` = jumlah kolom pada layar lebar. */
export function Grid({ children, gap = adminSpace.lg, style }: { children: React.ReactNode; gap?: number; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flexDirection: 'row', flexWrap: 'wrap', gap }, style]}>{children}</View>;
}
export function Col({ span = 12, min = 280, children, style }: { span?: number; min?: number; children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flexGrow: span, flexShrink: 1, flexBasis: min, minWidth: min, maxWidth: '100%' }, style]}>{children}</View>;
}
