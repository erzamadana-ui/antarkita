import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, font, radius, glass } from '@/lib/theme';
import type { Place } from '@/lib/types';

/** Dua baris lokasi (jemput/tujuan) ala Gojek. Ketuk baris → cari alamat; ketuk ikon peta → pilih titik presisi di peta (gedung/patokan). */
export function LocationFields({ pickup, dropoff, pickupLabel = 'Titik jemput', dropoffLabel = 'Tujuan', lockPickup, lockDropoff, accent = colors.primary }: { pickup: Place | null; dropoff: Place | null; pickupLabel?: string; dropoffLabel?: string; lockPickup?: boolean; lockDropoff?: boolean; accent?: string }) {
  const router = useRouter();
  const open = (target: 'pickup' | 'dropoff', title: string, mode?: 'map') => router.push({ pathname: '/place-picker', params: { target, title, ...(mode ? { mode } : {}) } } as never);
  const locked = (target: 'pickup' | 'dropoff') => (lockPickup && target === 'pickup') || (lockDropoff && target === 'dropoff');
  const Line = ({ target, label, place, placeholder, dotStyle }: { target: 'pickup' | 'dropoff'; label: string; place: Place | null; placeholder: string; dotStyle: object }) => (
    <View style={s.row}>
      <Pressable disabled={locked(target)} onPress={() => open(target, label)} style={{ flex: 1, minWidth: 0 }}>
        <Text style={font.tiny}>{label}</Text>
        <Text style={[s.value, !place && { color: colors.textMuted }]} numberOfLines={1}>{place?.name ?? place?.address ?? placeholder}</Text>
        {place?.name && place.address && place.address !== place.name && <Text style={font.tiny} numberOfLines={1}>{place.address}</Text>}
      </Pressable>
      {!locked(target) && (
        <Pressable onPress={() => open(target, label, 'map')} hitSlop={8} style={[s.mapBtn, { borderColor: accent + '55' }]} accessibilityLabel={`Pilih ${label.toLowerCase()} di peta`}>
          <Ionicons name="map" size={16} color={accent} />
          <Text style={{ fontSize: 12, fontWeight: '800', color: accent }}>Peta</Text>
        </Pressable>
      )}
      <View style={dotStyle} />
    </View>
  );
  return (
    <View style={s.wrap}>
      <View style={s.rail}>
        <View style={[s.dot, { backgroundColor: accent }]} />
        <View style={s.line} />
        <View style={[s.dot, { backgroundColor: colors.danger, borderRadius: 2 }]} />
      </View>
      <View style={{ flex: 1 }}>
        <Line target="pickup" label={pickupLabel} place={pickup} placeholder="Pilih titik jemput" dotStyle={{}} />
        <View style={{ height: 1, backgroundColor: 'rgba(11,31,42,0.07)' }} />
        <Line target="dropoff" label={dropoffLabel} place={dropoff} placeholder="Mau ke mana?" dotStyle={{}} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: radius.lg, borderWidth: 1, borderColor: glass.border, paddingLeft: 12 },
  rail: { width: 14, alignItems: 'center', paddingVertical: 24 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  line: { flex: 1, width: 2, backgroundColor: colors.border, marginVertical: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingLeft: 12, paddingRight: 10, minHeight: 60 },
  value: { fontWeight: '600', color: colors.text, fontSize: 14.5, marginTop: 2 },
  mapBtn: { alignItems: 'center', justifyContent: 'center', width: 42, height: 42, borderRadius: 12, borderWidth: 1, backgroundColor: 'rgba(255,255,255,0.8)', gap: 1 },
});
