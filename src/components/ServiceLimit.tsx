// Kartu peringatan batas jarak layanan (dari estimate_fare.limit) + teks info batas dalam kota.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Button, Empty, Row } from '@/components/ui';
import { colors, font, motion, radius } from '@/lib/theme';
import type { ServiceLimit } from '@/lib/types';

export const limitBlocked = (limit?: ServiceLimit | null) => !!limit && limit.ok === false;

/** Kartu merah lembut: ikon alert + pesan dari server, opsi tombol sekunder (mis. "Buka AntarTravel"). */
export function LimitNotice({ limit, actionTitle, onAction, actionIcon }: { limit?: ServiceLimit | null; actionTitle?: string; onAction?: () => void; actionIcon?: React.ComponentProps<typeof Ionicons>['name'] }) {
  if (!limitBlocked(limit)) return null;
  return (
    <Animated.View entering={FadeInDown.duration(motion.base)} style={s.card}>
      <Row gap={10} style={{ alignItems: 'flex-start' }}>
        <View style={s.icon}><Ionicons name="alert-circle" size={20} color={colors.danger} /></View>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text style={[font.body, { fontWeight: '800', color: colors.danger }]}>Di luar jangkauan layanan</Text>
          <Text style={[font.small, { color: colors.text }]}>{limit?.message || 'Jarak perjalanan melebihi batas layanan dalam kota.'}</Text>
        </View>
      </Row>
      {actionTitle && onAction ? <Button title={actionTitle} icon={actionIcon} variant="secondary" size="sm" onPress={onAction} style={{ alignSelf: 'flex-start', marginTop: 10 }} /> : null}
    </Animated.View>
  );
}

/** Baris kecil "Batas dalam kota: N km" untuk ditaruh di ringkasan tarif. */
export function LimitInfo({ limit, style }: { limit?: ServiceLimit | null; style?: object }) {
  if (!limit || limit.max_km == null) return null;
  return (
    <Row gap={4} style={style}>
      <Ionicons name="navigate-circle-outline" size={12} color={colors.textMuted} />
      <Text style={font.tiny}>Batas dalam kota: {Math.round(Number(limit.max_km))} km</Text>
    </Row>
  );
}

/** Tampilan saat admin menonaktifkan layanan (estimate.service_enabled === false). */
export function ServiceDisabledEmpty({ onBack }: { onBack?: () => void }) {
  return <Empty icon="pause-circle-outline" title="Layanan sedang dinonaktifkan sementara" subtitle="Silakan coba lagi nanti atau gunakan layanan lain." action={onBack ? <Button title="Kembali ke beranda" variant="secondary" size="sm" onPress={onBack} /> : undefined} />;
}

const s = StyleSheet.create({
  card: { backgroundColor: colors.dangerLight, borderRadius: radius.lg, padding: 14, borderWidth: 1, borderColor: colors.danger + '33' },
  icon: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
});
