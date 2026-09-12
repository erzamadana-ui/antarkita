// Komponen bersama alur pemesanan tahap 5:
//  - DestinationSuggestions: tujuan terakhir / sering dikunjungi / alamat tersimpan (sekali ketuk)
//  - VehicleClassPicker: kelas kendaraan (hemat/standar/premium/listrik) dengan harga per kelas
//  - SchedulePicker: pesan sekarang vs booking terjadwal (tanggal + jam)
//  - MerchantAds: iklan merchant terdekat dari titik jemput/antar
//  - RoutePreview: peta rute yang disembunyikan (tampil hanya bila diminta)
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Image, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { FadeInDown, FadeOut, LinearTransition } from 'react-native-reanimated';
import { Row, Badge, Chip } from '@/components/ui';
import { PressableScale, Skeleton } from '@/components/motion';
import { HalalBadge } from '@/components/MerchantStatus';
import { MapView } from '@/components/map';
import type { MapMarker } from '@/components/map';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/store/auth';
import { colors, font, radius, glass, motion, shadow } from '@/lib/theme';
import { rupiah } from '@/lib/format';
import type { FareOption, FrequentData, Merchant, Place, SavedPlace, ServiceType } from '@/lib/types';

// ---------- Tujuan terakhir & sering dikunjungi ----------
export function DestinationSuggestions({ onPick, service, title = 'Tujuan terakhir & sering dikunjungi' }: { onPick: (p: Place) => void; service?: ServiceType; title?: string }) {
  const uid = useAuth((s) => s.session?.user.id);
  const [freq, setFreq] = useState<FrequentData | null>(null);
  const [saved, setSaved] = useState<SavedPlace[]>([]);
  useEffect(() => {
    if (!uid) return;
    supabase.rpc('customer_frequent', { p_limit: 6 }).then(({ data }) => setFreq((data as FrequentData) ?? null));
    supabase.from('saved_places').select('*').eq('user_id', uid).then(({ data }) => setSaved((data as SavedPlace[]) ?? []));
  }, [uid]);
  const items = useMemo(() => {
    const out: { key: string; icon: string; color: string; title: string; subtitle: string; place: Place; count?: number }[] = [];
    saved.forEach((p) => out.push({ key: `s-${p.id}`, icon: /rumah|home/i.test(p.label) ? 'home' : /kantor|office|work/i.test(p.label) ? 'briefcase' : 'bookmark', color: colors.primary, title: p.label, subtitle: p.address, place: { lat: p.lat, lng: p.lng, address: p.address, name: p.label } }));
    (freq?.routes ?? []).filter((r) => !service || r.service === service || true).forEach((r, i) => {
      if (out.some((x) => x.place.address === r.dropoff_address)) return;
      out.push({ key: `r-${i}`, icon: 'repeat', color: colors.accent, title: r.dropoff_address.split(',')[0], subtitle: `${r.count}× dipesan · ${r.dropoff_address.split(',').slice(1, 3).join(',').trim()}`, place: { lat: r.dropoff_lat, lng: r.dropoff_lng, address: r.dropoff_address, name: r.dropoff_address.split(',')[0] }, count: r.count });
    });
    (freq?.recent ?? []).forEach((r, i) => {
      if (out.some((x) => x.place.address === r.address)) return;
      out.push({ key: `h-${i}`, icon: 'time-outline', color: colors.textSecondary, title: r.address.split(',')[0], subtitle: r.address.split(',').slice(1, 3).join(',').trim() || 'Riwayat tujuan', place: { lat: r.lat, lng: r.lng, address: r.address, name: r.address.split(',')[0] } });
    });
    return out.slice(0, 8);
  }, [saved, freq, service]);
  if (!freq && saved.length === 0) return <View style={{ gap: 8 }}><Skeleton height={56} radius={radius.lg} /><Skeleton height={56} radius={radius.lg} /></View>;
  if (items.length === 0) return null;
  return (
    <Animated.View entering={FadeInDown.duration(motion.base)} exiting={FadeOut.duration(motion.fast)} style={{ gap: 6 }}>
      <Text style={[font.label, { marginBottom: 2 }]}>{title}</Text>
      {items.map((it) => (
        <PressableScale key={it.key} onPress={() => onPick(it.place)} scaleTo={0.985} haptic={false} style={s.sugg}>
          <View style={[s.suggIcon, { backgroundColor: it.color + '1A' }]}><Ionicons name={it.icon as never} size={20} color={it.color} /></View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontWeight: '700', color: colors.text, fontSize: 14 }} numberOfLines={1}>{it.title}</Text>
            <Text style={font.tiny} numberOfLines={1}>{it.subtitle}</Text>
          </View>
          <Ionicons name="arrow-forward-circle" size={24} color={colors.primary} />
        </PressableScale>
      ))}
    </Animated.View>
  );
}

// ---------- Kelas kendaraan ----------
const CLASS_ICON: Record<string, string> = { motor_economy: 'bicycle-outline', motor_standard: 'bicycle', motor_ev: 'flash', car_economy: 'car-outline', car_standard: 'car', car_premium: 'car-sport', car_ev: 'flash', car_ev_premium: 'flash', box_pickup: 'cube-outline', box_van: 'bus' };
export function VehicleClassPicker({ options, value, onChange, accent, loading }: { options: FareOption[]; value: string | null; onChange: (code: string) => void; accent: string; loading?: boolean }) {
  if (loading && options.length === 0) return <View style={{ gap: 8 }}>{[0, 1, 2].map((i) => <Skeleton key={i} height={64} radius={radius.lg} />)}</View>;
  return (
    <View style={{ gap: 8 }}>
      <Text style={font.label}>Pilih kelas kendaraan</Text>
      {options.map((o) => {
        const active = value === o.code;
        const none = o.drivers_nearby === 0;
        return (
          <PressableScale key={o.code} onPress={() => onChange(o.code)} scaleTo={0.985} style={[s.cls, active && { borderColor: accent, backgroundColor: accent + '10', ...shadow.glow(accent) }]}>
            <View style={[s.clsIcon, { backgroundColor: active ? accent : 'rgba(11,31,42,0.06)' }]}><Ionicons name={(CLASS_ICON[o.code] ?? 'car') as never} size={20} color={active ? '#fff' : colors.textSecondary} /></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Row gap={6}><Text style={{ fontWeight: '700', color: colors.text, fontSize: 16 }} numberOfLines={1}>{o.label}</Text>{!!o.is_ev && <Badge text="⚡ Listrik" color={colors.success} />}{o.rank === 3 && <Badge text="Premium" color={colors.accent} />}</Row>
              <Text style={font.tiny} numberOfLines={2}>{o.description}{o.seats && !/penumpang/i.test(o.description ?? '') ? ` · ${o.seats} penumpang` : ''}</Text>
              <Text style={[font.tiny, { color: none ? colors.warning : colors.success, fontWeight: '700' }]}>{none ? 'Belum ada driver online di dekat Anda' : `${o.drivers_nearby} driver di dekat Anda`}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={{ fontWeight: '700', color: active ? accent : colors.text, fontSize: 16 }}>{rupiah(o.total)}</Text>
              {o.multiplier !== 1 && <Text style={font.tiny}>{o.multiplier < 1 ? `hemat ${Math.round((1 - o.multiplier) * 100)}%` : `+${Math.round((o.multiplier - 1) * 100)}%`}</Text>}
            </View>
          </PressableScale>
        );
      })}
    </View>
  );
}

// ---------- Booking terjadwal ----------
const DAY_NAMES = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
export function SchedulePicker({ value, onChange, accent }: { value: Date | null; onChange: (d: Date | null) => void; accent: string }) {
  const now = new Date();
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => { const d = new Date(now); d.setDate(now.getDate() + i); d.setHours(0, 0, 0, 0); return d; }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [day, setDay] = useState<Date>(value ? new Date(new Date(value).setHours(0, 0, 0, 0)) : days[0]);
  const times = useMemo(() => {
    const out: Date[] = [];
    for (let h = 0; h < 24; h++) for (const m of [0, 30]) { const d = new Date(day); d.setHours(h, m, 0, 0); if (d.getTime() > Date.now() + 30 * 60000) out.push(d); }
    return out;
  }, [day]);
  const scheduled = !!value;
  return (
    <View style={{ gap: 10 }}>
      <Row gap={8}>
        <Chip label="Sekarang" active={!scheduled} onPress={() => onChange(null)} color={accent} />
        <Chip label="📅 Jadwalkan (booking)" active={scheduled} onPress={() => { if (!scheduled) { const first = times[0] ?? new Date(Date.now() + 3600e3); onChange(first); } }} color={accent} />
      </Row>
      {scheduled && (
        <Animated.View entering={FadeInDown.duration(motion.base)} layout={LinearTransition.springify().stiffness(300).damping(22)} style={s.schedBox}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {days.map((d, i) => {
              const active = d.getTime() === day.getTime();
              return (
                <Pressable key={i} onPress={() => { setDay(d); const t = new Date(d); t.setHours(value?.getHours() ?? 8, value?.getMinutes() ?? 0, 0, 0); if (t.getTime() < Date.now() + 30 * 60000) t.setTime(Date.now() + 60 * 60000); onChange(t); }} style={[s.day, active && { backgroundColor: accent, borderColor: accent }]}>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: active ? '#fff' : colors.textMuted }}>{i === 0 ? 'Hari ini' : i === 1 ? 'Besok' : DAY_NAMES[d.getDay()]}</Text>
                  <Text style={{ fontSize: 18, fontWeight: '700', color: active ? '#fff' : colors.text }}>{d.getDate()}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, marginTop: 8 }}>
            {times.map((t) => {
              const active = value && Math.abs(t.getTime() - value.getTime()) < 60000;
              return <Chip key={t.getTime()} label={t.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} active={!!active} onPress={() => onChange(t)} color={accent} />;
            })}
          </ScrollView>
          <Row gap={6} style={{ marginTop: 8 }}><Ionicons name="information-circle-outline" size={16} color={colors.textSecondary} /><Text style={[font.tiny, { flex: 1 }]}>Driver dicarikan otomatis ±20 menit sebelum jadwal. Bisa dibatalkan gratis sampai driver ditugaskan.</Text></Row>
          {value && <Badge text={`Jemput ${value.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'short' })} · ${value.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} WIB`} color={accent} />}
        </Animated.View>
      )}
    </View>
  );
}

// ---------- Iklan merchant terdekat ----------
export function MerchantAds({ near, title, max = 6 }: { near: { lat: number; lng: number } | null; title?: string; max?: number }) {
  const router = useRouter();
  const [list, setList] = useState<Merchant[] | null>(null);
  useEffect(() => {
    if (!near) { setList(null); return; }
    supabase.rpc('nearby_merchants', { p_lat: near.lat, p_lng: near.lng, p_radius_km: 4 }).then(({ data }) => setList(((data as Merchant[]) ?? []).filter((m) => m.is_open && m.image_url).slice(0, max)));
  }, [near?.lat, near?.lng]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!near || !list || list.length === 0) return null;
  return (
    <Animated.View entering={FadeInDown.duration(motion.base)} style={{ gap: 6 }}>
      <Row between><Text style={font.label}>{title ?? 'Merchant dekat tujuan Anda'}</Text><Badge text="Iklan" color={colors.textMuted} /></Row>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingVertical: 2 }}>
        {list.map((m) => (
          <PressableScale key={m.id} onPress={() => router.push(`/food/${m.id}` as never)} scaleTo={0.97} style={s.ad}>
            <Image source={{ uri: m.image_url ?? undefined }} style={s.adImg} />
            <View style={{ padding: 8, gap: 2 }}>
              <Row between><Text style={{ fontWeight: '700', color: colors.text, fontSize: 14, flex: 1 }} numberOfLines={1}>{m.name}</Text><HalalBadge merchant={m} /></Row>
              <Text style={font.tiny} numberOfLines={1}>⭐ {Number(m.rating_avg).toFixed(1)} · {m.distance_km} km · ongkir {rupiah(m.delivery_fee ?? 0)}</Text>
              <Text style={{ fontSize: 12, fontWeight: '700', color: colors.food }}>Pesan makanan →</Text>
            </View>
          </PressableScale>
        ))}
      </ScrollView>
    </Animated.View>
  );
}

// ---------- Peta rute (disembunyikan, tampil bila diminta) ----------
export function RoutePreview({ pickup, dropoff, polyline, accent }: { pickup: Place | null; dropoff: Place | null; polyline?: [number, number][] | null; accent: string }) {
  const [open, setOpen] = useState(false);
  if (!pickup || !dropoff) return null;
  const markers: MapMarker[] = [{ id: 'p', lat: pickup.lat, lng: pickup.lng, kind: 'pickup' }, { id: 'd', lat: dropoff.lat, lng: dropoff.lng, kind: 'dropoff' }];
  return (
    <View style={{ gap: 8 }}>
      <Pressable onPress={() => setOpen(!open)} style={s.mapToggle}>
        <Ionicons name="map-outline" size={16} color={accent} /><Text style={{ fontWeight: '700', color: accent, fontSize: 14, flex: 1 }}>{open ? 'Sembunyikan peta rute' : 'Lihat peta rute'}</Text><Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={accent} />
      </Pressable>
      {open && (
        <Animated.View entering={FadeInDown.duration(motion.base)} exiting={FadeOut.duration(motion.fast)} style={s.mapBox}>
          <MapView center={pickup} zoom={13} markers={markers} polyline={polyline} fitTo={[pickup, dropoff]} paddingBottom={10} />
        </Animated.View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  sugg: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: radius.lg, backgroundColor: 'rgba(255,255,255,0.92)', borderWidth: 1, borderColor: glass.border },
  suggIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cls: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: radius.lg, borderWidth: 1.5, borderColor: glass.border, backgroundColor: 'rgba(255,255,255,0.92)' },
  clsIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  schedBox: { backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: radius.lg, padding: 10, borderWidth: 1, borderColor: glass.border },
  day: { width: 58, paddingVertical: 8, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: glass.border, backgroundColor: 'rgba(255,255,255,0.8)' },
  ad: { width: 170, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.8)', borderWidth: 1, borderColor: glass.border },
  adImg: { width: '100%', height: 72, backgroundColor: 'rgba(11,31,42,0.06)' },
  mapToggle: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderRadius: radius.md, backgroundColor: 'rgba(255,255,255,0.92)', borderWidth: 1, borderColor: glass.border },
  mapBox: { height: 220, borderRadius: radius.lg, overflow: 'hidden', borderWidth: 1, borderColor: glass.border },
});
