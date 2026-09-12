// AntarNow (Tahap 11 / migrasi 0030) — pelanggan yang sudah bertemu driver secara tatap muka
// memasukkan KODE DRIVER 6 karakter agar ordernya langsung ditawarkan ke driver itu.
//
// Berkas ini dipakai KEDUA aplikasi:
//   Pelanggan : AntarNowSection (masukan kode + pratinjau driver) & DirectHoldNotice (hitung mundur di layar menunggu)
//   Mitra     : DriverCodeCard (kartu kode di beranda driver) & DirectOrderBadge (badge order langsung di feed)
//
// Kontrak RPC (lihat docs/TAHAP11-KONTRAK-API.md):
//   driver_by_code({ p_code }) → pratinjau driver, atau error berbahasa Indonesia
//   create_order({ p: { …, driver_code } }) → mengisi orders.preferred_driver_id
//   driver_available_orders() → kolom direct_for_me & direct_hold_left_s
//   driver_my_code() / driver_direct_stats() → kartu & statistik di aplikasi Mitra
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { FadeIn, FadeInDown, FadeOut, LinearTransition } from 'react-native-reanimated';
import { create } from 'zustand';
import { Row, Badge, Button, Input, Avatar, Stars, toast } from '@/components/ui';
import { PressableScale } from '@/components/motion';
import { rpc, supabase } from '@/lib/supabase';
import { colors, font, radius, shadow, motion } from '@/lib/theme';
import { serviceLabel, vehicleTypeLabel } from '@/lib/format';
import type { DriverByCode, DriverMyCode, ServiceType } from '@/lib/types';

// ------------------------------------------------------------------ kode driver
/** Panjang kode driver (harus sama dengan gen_driver_code di migrasi 0030). */
export const CODE_LENGTH = 6;
/**
 * Karakter yang SENGAJA tidak dipakai server karena mudah tertukar saat dibacakan/diketik:
 * angka nol vs huruf O, angka satu vs huruf I. Ditolak di sisi aplikasi dengan pesan jelas.
 */
export const AMBIGUOUS_CHARS = ['0', 'O', '1', 'I'] as const;
const AMBIGUOUS_RE = /[0O1I]/g;

/** Bersihkan ketikan pengguna: huruf besar, hanya huruf/angka, maksimal 6 karakter. */
export function sanitizeDriverCode(raw: string): string {
  return (raw ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, CODE_LENGTH);
}

/**
 * Pesan kesalahan untuk kode yang diketik, atau null bila kode layak dikirim ke server.
 * Dipisah dari sanitizeDriverCode agar karakter rancu tetap terlihat pengguna
 * (kalau langsung dibuang diam-diam, pengguna tidak sadar salah ketik).
 */
export function driverCodeIssue(code: string): string | null {
  if (!code) return null;
  const bad = Array.from(new Set(code.match(AMBIGUOUS_RE) ?? []));
  if (bad.length) {
    return `Kode driver tidak memakai angka 0, huruf O, angka 1, dan huruf I. Anda mengetik ${bad.join(', ')} — periksa lagi (mungkin maksudnya huruf D, Q, J, atau angka 7).`;
  }
  return null;
}

/** "1:47" — sisa masa tahan untuk badge & hitungan mundur. */
export function mmss(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** "2 menit" / "90 detik" — lama masa tahan untuk kalimat penjelasan. */
export function holdText(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return s >= 60 && s % 60 === 0 ? `${s / 60} menit` : `${s} detik`;
}

// -------------------------------------------------- setelan masa tahan (app_settings)
// `app_settings` boleh dibaca semua pengguna masuk (policy settings_select, migrasi 0002),
// jadi kedua aplikasi bisa menampilkan masa tahan & aturan fallback yang sedang berlaku.
export const DEFAULT_HOLD_SECONDS = 120;
const SETTINGS_STALE_MS = 5 * 60 * 1000;

interface DirectSettingsState {
  holdSeconds: number; fallback: boolean; loadedAt: number;
  load: (force?: boolean) => Promise<void>;
}
const useDirectSettingsStore = create<DirectSettingsState>((set, get) => ({
  holdSeconds: DEFAULT_HOLD_SECONDS,
  fallback: true,
  loadedAt: 0,
  load: async (force = false) => {
    const { loadedAt } = get();
    if (!force && loadedAt && Date.now() - loadedAt < SETTINGS_STALE_MS) return;
    try {
      const { data } = await supabase.from('app_settings').select('key,value').in('key', ['direct_order_hold_seconds', 'direct_order_fallback']);
      const rows = (data ?? []) as { key: string; value: unknown }[];
      const hold = Number(rows.find((r) => r.key === 'direct_order_hold_seconds')?.value);
      const fb = rows.find((r) => r.key === 'direct_order_fallback')?.value;
      set({
        holdSeconds: Number.isFinite(hold) && hold > 0 ? hold : DEFAULT_HOLD_SECONDS,
        fallback: fb == null ? true : fb === true || String(fb) === 'true',
        loadedAt: Date.now(),
      });
    } catch { /* gagal-aman: pakai default 120 detik + fallback aktif */ }
  },
}));

/** Masa tahan order langsung (detik) & apakah order dilempar ke driver lain sesudahnya. */
export function useDirectSettings() {
  const holdSeconds = useDirectSettingsStore((s) => s.holdSeconds);
  const fallback = useDirectSettingsStore((s) => s.fallback);
  const load = useDirectSettingsStore((s) => s.load);
  useEffect(() => { load(); }, [load]);
  return { holdSeconds, fallback };
}

// ------------------------------------------------- kode terpilih (dibagi antar layar)
// Disimpan di store agar layar pemesanan mana pun cukup merender <AntarNowSection />,
// dan layar menunggu (order/detail) tetap bisa menampilkan nama & foto driver tujuan —
// pelanggan belum boleh membaca profil driver itu sebelum driver menerima order (RLS profiles).
interface AntarNowState {
  code: string; driver: DriverByCode | null;
  setCode: (code: string) => void;
  setDriver: (d: DriverByCode | null) => void;
  clear: () => void;
}
export const useAntarNow = create<AntarNowState>((set) => ({
  code: '', driver: null,
  setCode: (code) => set({ code }),
  setDriver: (driver) => set({ driver }),
  clear: () => set({ code: '', driver: null }),
}));

/**
 * Kode yang siap dikirim ke `create_order` — hanya bila kode sudah divalidasi lewat
 * `driver_by_code` DAN driver melayani jenis layanan yang sedang dipesan.
 * Dipakai layar pemesanan: `driver_code: antarNowCode(service)`.
 */
export function useAntarNowCode(service: ServiceType): string | null {
  const code = useAntarNow((s) => s.code);
  const driver = useAntarNow((s) => s.driver);
  if (!driver || driver.code !== code) return null;
  if (!driver.services?.includes(service)) return null;
  return code;
}

// ------------------------------------------------------------- hitungan mundur
/**
 * Sisa masa tahan dalam detik, berdetak tiap 250 ms.
 * `serverLeft` (dari `driver_available_orders.direct_hold_left_s`) dipakai sebagai jangkar:
 * setiap kali server mengirim nilai baru, tenggat lokal disetel ulang — jadi jam perangkat
 * yang meleset tidak membuat hitungan mundur salah.
 */
export function useHoldCountdown(serverLeft: number | null | undefined): number {
  const deadline = useRef(Date.now() + Math.max(0, serverLeft ?? 0) * 1000);
  const [left, setLeft] = useState(() => Math.max(0, Math.round(serverLeft ?? 0)));
  useEffect(() => {
    if (serverLeft == null) return;
    deadline.current = Date.now() + Math.max(0, serverLeft) * 1000;
    setLeft(Math.max(0, Math.round(serverLeft)));
  }, [serverLeft]);
  useEffect(() => {
    const t = setInterval(() => setLeft(Math.max(0, Math.ceil((deadline.current - Date.now()) / 1000))), 250);
    return () => clearInterval(t);
  }, []);
  return left;
}

/** Sisa masa tahan dihitung dari waktu order dibuat (dipakai aplikasi Pelanggan — server tidak mengirim sisa). */
export function useHoldCountdownFrom(createdAt: string | null | undefined, holdSeconds: number): number {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!createdAt) { setLeft(0); return; }
    const start = Date.parse(createdAt);
    const tick = () => setLeft(Number.isFinite(start) ? Math.max(0, Math.ceil((start + holdSeconds * 1000 - Date.now()) / 1000)) : 0);
    tick();
    const t = setInterval(tick, 250);
    return () => clearInterval(t);
  }, [createdAt, holdSeconds]);
  return left;
}

// ==========================================================================
// APLIKASI PELANGGAN
// ==========================================================================

/**
 * Bagian "Punya kode driver? (AntarNow)" pada alur pemesanan.
 * Tertutup secara bawaan; dibuka pengguna, lalu:
 *   ketik kode → tombol "Cek kode" → `driver_by_code` → kartu pratinjau driver.
 * Bila kode tidak ditemukan / driver tidak melayani `service`, kode TIDAK dipakai
 * (useAntarNowCode mengembalikan null) dan pesan kesalahan ditampilkan.
 */
export function AntarNowSection({ service, accent = colors.primary }: { service: ServiceType; accent?: string }) {
  const { code, driver, setCode, setDriver, clear } = useAntarNow();
  const { holdSeconds, fallback } = useDirectSettings();
  const [open, setOpen] = useState(!!code);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const issue = driverCodeIssue(code);
  const canCheck = code.length === CODE_LENGTH && !issue && !checking;
  // Driver ditemukan tetapi kendaraannya tidak melayani jenis layanan yang sedang dipesan
  const wrongService = !!driver && driver.code === code && !driver.services?.includes(service);

  const check = useCallback(async (value: string) => {
    setChecking(true); setError(null);
    try {
      const d = await rpc<DriverByCode>('driver_by_code', { p_code: value });
      setDriver(d);
      if (!d.services?.includes(service)) toast.error(`${d.name ?? 'Driver'} tidak melayani ${serviceLabel[service]}`);
      else toast.success(`Kode ${d.code} cocok — ${d.name ?? 'driver'}`);
    } catch (e) {
      setDriver(null);
      setError((e as Error).message);
    } finally { setChecking(false); }
  }, [service, setDriver]);

  const onChange = (raw: string) => {
    const next = sanitizeDriverCode(raw);
    setCode(next);
    setError(null);
    if (driver && driver.code !== next) setDriver(null);
    if (next.length === CODE_LENGTH && !driverCodeIssue(next)) check(next);   // otomatis cek saat 6 karakter
  };

  const release = () => { clear(); setError(null); };

  if (!open) {
    return (
      <PressableScale onPress={() => setOpen(true)} scaleTo={0.99} haptic={false} style={s.teaser}>
        <View style={[s.teaserIcon, { backgroundColor: accent + '1A' }]}><Ionicons name="qr-code-outline" size={20} color={accent} /></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontWeight: '700', color: colors.text, fontSize: 14 }}>Punya kode driver? (AntarNow)</Text>
          <Text style={font.tiny}>Sudah bertemu driver langsung? Masukkan kodenya agar order langsung ke dia.</Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
      </PressableScale>
    );
  }

  return (
    <Animated.View entering={FadeInDown.duration(motion.base)} layout={LinearTransition.springify().stiffness(300).damping(22)} style={s.box}>
      <Row between>
        <Row gap={8} style={{ flex: 1, minWidth: 0 }}>
          <View style={[s.teaserIcon, { backgroundColor: accent + '1A' }]}><Ionicons name="qr-code-outline" size={20} color={accent} /></View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontWeight: '700', color: colors.text, fontSize: 14 }}>AntarNow · kode driver</Text>
            <Text style={font.tiny}>Kode {CODE_LENGTH} karakter di aplikasi Mitra driver.</Text>
          </View>
        </Row>
        <PressableScale onPress={() => { release(); setOpen(false); }} scaleTo={0.9} style={s.closeBtn}><Ionicons name="close" size={16} color={colors.textSecondary} /></PressableScale>
      </Row>

      <Row gap={8} style={{ marginTop: 12, alignItems: 'flex-start' }}>
        <View style={{ flex: 1 }}>
          <Input
            placeholder="mis. K7XQ4M"
            value={code}
            onChangeText={onChange}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={CODE_LENGTH}
            icon="key-outline"
            style={s.codeInput}
            error={issue ?? error}
          />
        </View>
        <Button title="Cek kode" size="md" variant="secondary" loading={checking} disabled={!canCheck} onPress={() => check(code)} />
      </Row>

      {!!driver && driver.code === code && (
        <Animated.View entering={FadeIn.duration(motion.base)} exiting={FadeOut.duration(motion.fast)} style={{ marginTop: 12 }}>
          <DriverPreviewCard driver={driver} service={service} />
          {wrongService ? (
            <Row gap={6} style={s.warnRow}>
              <Ionicons name="alert-circle" size={16} color={colors.danger} />
              <Text style={[font.tiny, { flex: 1, color: colors.danger }]}>
                {driver.name ?? 'Driver'} memakai {vehicleTypeLabel[driver.vehicle_type] ?? driver.vehicle_type} sehingga tidak bisa mengambil {serviceLabel[service]}.
                Lepas kode ini untuk lanjut memesan seperti biasa.
              </Text>
            </Row>
          ) : (
            <Row gap={6} style={s.infoRow}>
              <Ionicons name="information-circle-outline" size={16} color={colors.textMuted} />
              <Text style={[font.tiny, { flex: 1 }]}>
                Order ditahan {holdText(holdSeconds)} khusus untuk {driver.name ?? 'driver ini'}.
                {fallback ? ' Bila belum diambil, order otomatis dicarikan driver lain.' : ' Bila belum diambil, order tetap menunggu driver ini.'}
              </Text>
            </Row>
          )}
          <Button title="Lepas kode driver" variant="ghost" size="sm" color={colors.danger} icon="close-circle-outline" onPress={release} style={{ marginTop: 8 }} />
        </Animated.View>
      )}
      {!driver && !error && !issue && (
        <Row gap={6} style={s.infoRow}>
          <Ionicons name="information-circle-outline" size={16} color={colors.textMuted} />
          <Text style={[font.tiny, { flex: 1 }]}>Minta driver membuka menu "Kode AntarNow" di aplikasi Mitra. Kode tidak memakai angka 0, huruf O, angka 1, dan huruf I.</Text>
        </Row>
      )}
    </Animated.View>
  );
}

/** Kartu pratinjau driver dari `driver_by_code`: foto, nama, rating, kendaraan, status online, layanan. */
export function DriverPreviewCard({ driver, service }: { driver: DriverByCode; service?: ServiceType }) {
  const vehicle = [driver.vehicle_brand, driver.vehicle_model].filter(Boolean).join(' ') || (vehicleTypeLabel[driver.vehicle_type] ?? driver.vehicle_type);
  const seen = driver.is_online ? 'Online sekarang'
    : driver.last_seen_minutes == null ? 'Status tidak diketahui'
    : driver.last_seen_minutes < 1 ? 'Baru saja aktif'
    : driver.last_seen_minutes < 60 ? `Terakhir terlihat ${Math.round(driver.last_seen_minutes)} menit lalu`
    : driver.last_seen_minutes < 60 * 24 ? `Terakhir terlihat ${Math.round(driver.last_seen_minutes / 60)} jam lalu`
    : `Terakhir terlihat ${Math.round(driver.last_seen_minutes / 1440)} hari lalu`;
  return (
    <View style={s.preview}>
      <Row gap={12}>
        <Avatar name={driver.name} url={driver.avatar_url} size={52} />
        <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
          <Text style={[font.body, { fontWeight: '700' }]} numberOfLines={1}>{driver.name ?? 'Driver AntarKita'}</Text>
          {/* flexWrap: pada layar 390px sisa ruang di samping bintang hanya ±78px, sehingga tanpa ini
              teks rating pecah menjadi 3 baris sempit (atau terpotong bila dipaksa 1 baris).
              Dengan wrap, teks turun ke barisnya sendiri selebar kolom dan tampil utuh. */}
          <Row gap={6} style={{ flexWrap: 'wrap' }}>
            <Stars value={Number(driver.rating_avg) || 0} size={12} />
            <Text style={font.tiny} numberOfLines={1}>{(Number(driver.rating_avg) || 0).toFixed(1).replace('.', ',')} · {driver.rating_count} ulasan · {driver.total_trips} trip</Text>
          </Row>
          <Text style={font.tiny} numberOfLines={1}>{vehicle}{driver.vehicle_plate ? ` · ${driver.vehicle_plate}` : ''}</Text>
        </View>
        <Badge text={driver.code} color={colors.primary} />
      </Row>
      <Row gap={6} style={{ marginTop: 10 }}>
        <View style={[s.dot, { backgroundColor: driver.is_online ? colors.success : colors.textMuted }]} />
        <Text style={[font.tiny, { color: driver.is_online ? colors.success : colors.textMuted, fontWeight: '700' }]}>{seen}</Text>
      </Row>
      <Text style={[font.tiny, { marginTop: 10 }]}>Layanan yang bisa dia ambil</Text>
      <Row gap={6} style={{ flexWrap: 'wrap', marginTop: 6 }}>
        {(driver.services ?? []).length === 0
          ? <Text style={font.tiny}>Belum ada layanan aktif untuk kendaraan ini.</Text>
          : (driver.services ?? []).map((sv) => (
              <Badge key={sv} text={serviceLabel[sv] ?? sv} color={service && sv === service ? colors.success : colors.textSecondary} />
            ))}
      </Row>
    </View>
  );
}

/**
 * Layar menunggu pelanggan: order sedang DITAHAN untuk driver pilihan.
 * Menampilkan hitungan mundur dan menjelaskan apa yang terjadi sesudahnya (fallback).
 */
export function DirectHoldNotice({ createdAt, driverName, avatarUrl }: { createdAt: string; driverName?: string | null; avatarUrl?: string | null }) {
  const { holdSeconds, fallback } = useDirectSettings();
  const left = useHoldCountdownFrom(createdAt, holdSeconds);
  const who = driverName || 'driver pilihan Anda';
  return (
    <Animated.View entering={FadeInDown.duration(motion.base)} exiting={FadeOut.duration(motion.fast)} style={[s.hold, left > 0 ? { borderColor: colors.primary } : null]}>
      <Row gap={12}>
        {avatarUrl || driverName ? <Avatar name={driverName} url={avatarUrl} size={40} /> : <View style={s.holdIcon}><Ionicons name="flash" size={20} color={colors.primary} /></View>}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontWeight: '700', color: colors.text, fontSize: 14 }} numberOfLines={1}>
            {left > 0 ? `Ditahan untuk ${who}` : `${who} belum merespons`}
          </Text>
          <Text style={font.tiny} numberOfLines={2}>
            {left > 0
              ? 'Order AntarNow — hanya driver ini yang melihatnya selama masa tahan.'
              : fallback ? 'Masa tahan habis — order kini dicarikan ke driver lain di sekitar Anda.'
                         : 'Masa tahan habis — order tetap menunggu driver ini menerima.'}
          </Text>
        </View>
        {left > 0 && (
          <View style={s.holdTimer}>
            <Text style={s.holdTimerText}>{mmss(left)}</Text>
          </View>
        )}
      </Row>
      {left > 0 && (
        <Text style={[font.tiny, { marginTop: 8 }]}>
          {fallback
            ? `Bila ${who} tidak menerima dalam ${mmss(left)}, order otomatis dicarikan driver lain — Anda tidak perlu memesan ulang.`
            : `Order ini tidak akan dilempar ke driver lain. Batalkan bila ${who} tidak merespons.`}
        </Text>
      )}
    </Animated.View>
  );
}

// ==========================================================================
// APLIKASI MITRA (driver)
// ==========================================================================

/**
 * Kode AntarNow milik driver yang sedang masuk (`driver_my_code`).
 * Gagal-aman: bila akun bukan mitra driver atau RPC gagal, `code` tetap null dan kartu disembunyikan.
 */
export function useDriverMyCode(enabled = true) {
  const [data, setData] = useState<DriverMyCode | null>(null);
  const load = useCallback(async () => {
    if (!enabled) return;
    try { setData(await rpc<DriverMyCode>('driver_my_code')); } catch { /* bukan driver / offline — kartu disembunyikan */ }
  }, [enabled]);
  useEffect(() => { load(); }, [load]);
  return { data, reload: load };
}

/**
 * Urutkan feed driver: order langsung untuk saya yang masih dalam masa tahan naik paling atas.
 * Server sudah mengurutkannya (`order by 30 desc`), ini jaring pengaman di sisi aplikasi
 * agar urutan tetap benar walau daftar disaring/digabung secara lokal.
 */
export function sortDirectFirst<T extends { direct_for_me?: boolean | null; direct_hold_left_s?: number | null }>(list: T[]): T[] {
  const rank = (o: T) => (o.direct_for_me && (o.direct_hold_left_s ?? 0) > 0 ? 0 : 1);
  return [...list].sort((a, b) => rank(a) - rank(b));
}

/** Badge + hitungan mundur "Prioritas Anda 1:47" pada kartu order langsung di feed driver. */
export function DirectOrderBadge({ holdLeftSeconds, compact }: { holdLeftSeconds: number | null | undefined; compact?: boolean }) {
  const left = useHoldCountdown(holdLeftSeconds);
  if (left <= 0) return null;   // masa tahan habis → order jadi order biasa
  return (
    <Animated.View entering={FadeIn.duration(motion.fast)} exiting={FadeOut.duration(motion.fast)} style={[s.direct, compact && { paddingVertical: 4 }]}>
      <Ionicons name="flash" size={compact ? 12 : 14} color="#fff" />
      <Text style={[s.directText, compact && { fontSize: 12 }]} numberOfLines={1}>
        {compact ? 'Langsung untuk Anda' : 'Order langsung untuk Anda'}
      </Text>
      <View style={s.directTimer}><Text style={s.directTimerText}>Prioritas Anda {mmss(left)}</Text></View>
    </Animated.View>
  );
}

/**
 * Kartu ringkas "Kode AntarNow saya" di beranda driver.
 * Kode besar, mudah dibacakan ke pelanggan; ketuk untuk membuka halaman penuh (/driver/code).
 */
export function DriverCodeCard({ code, todayCount, onPress }: { code: string | null | undefined; todayCount?: number; onPress?: () => void }) {
  if (!code) return null;
  return (
    <PressableScale onPress={onPress} scaleTo={0.99} haptic={false} style={s.codeCard}>
      <Row gap={12}>
        <View style={s.codeIcon}><Ionicons name="flash" size={20} color={colors.primary} /></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={font.tiny}>Kode AntarNow saya</Text>
          <Text style={s.codeSmall} numberOfLines={1}>{code}</Text>
          {/* 2 baris: pada lebar 390px satu baris memotong kalimat di tengah ("…Bacakan ke pelan…") */}
          <Text style={font.tiny} numberOfLines={2}>
            {todayCount ? `${todayCount} order langsung hari ini · ` : ''}Bacakan ke pelanggan agar order langsung ke Anda
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
      </Row>
    </PressableScale>
  );
}

/** Kode besar per-karakter — dipakai halaman "Kode AntarNow" agar mudah dibaca dari jauh. */
export function BigCode({ code }: { code: string }) {
  return (
    <Row gap={6} style={{ justifyContent: 'center' }}>
      {code.split('').map((ch, i) => (
        <View key={`${ch}-${i}`} style={s.charBox}><Text style={s.charText}>{ch}</Text></View>
      ))}
    </Row>
  );
}

const s = StyleSheet.create({
  teaser: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: radius.lg, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, ...shadow.soft },
  teaserIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  box: { padding: 14, borderRadius: radius.lg, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, ...shadow.soft },
  closeBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.bgSoft, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  codeInput: { fontSize: 22, fontWeight: '700', letterSpacing: 6 },
  infoRow: { marginTop: 8, alignItems: 'flex-start' },
  warnRow: { marginTop: 8, alignItems: 'flex-start', padding: 10, borderRadius: radius.md, backgroundColor: colors.dangerLight },
  preview: { padding: 12, borderRadius: radius.md, backgroundColor: colors.tint, borderWidth: 1, borderColor: colors.border },
  dot: { width: 8, height: 8, borderRadius: 4 },
  hold: { padding: 14, borderRadius: radius.lg, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, ...shadow.soft },
  holdIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center' },
  holdTimer: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.full, backgroundColor: colors.primary },
  holdTimerText: { color: '#fff', fontWeight: '700', fontSize: 14, letterSpacing: 0.5 },
  direct: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 8, borderRadius: radius.full, backgroundColor: colors.primary, alignSelf: 'flex-start', maxWidth: '100%' },
  directText: { color: '#fff', fontWeight: '700', fontSize: 12, flexShrink: 1 },
  directTimer: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.full, backgroundColor: 'rgba(255,255,255,0.22)' },
  directTimerText: { color: '#fff', fontWeight: '700', fontSize: 12, letterSpacing: 0.3 },
  codeCard: { padding: 12, borderRadius: radius.lg, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, ...shadow.soft },
  codeIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center' },
  codeSmall: { fontSize: 24, fontWeight: '700', color: colors.primary, letterSpacing: 4 },
  charBox: { width: 44, height: 56, borderRadius: radius.md, backgroundColor: colors.tint, borderWidth: 1, borderColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  charText: { fontSize: 30, fontWeight: '700', color: colors.primary },
});
