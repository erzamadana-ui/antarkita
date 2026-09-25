// Banner & catatan kecil saat AntarVoucher dinonaktifkan dari Panel Admin (migrasi 0088).
// Dipakai di tab AntarVoucher, top up, gateway, pencairan mitra, dan pilihan metode bayar.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ANTARVOUCHER_OFF_TEXT } from '@/hooks/useAppSettings';
import { colors, font, radius } from '@/lib/theme';

/** Banner penuh (kartu kuning) — untuk layar dompet/top up/pencairan. */
export function AntarVoucherOffBanner({ text = ANTARVOUCHER_OFF_TEXT, style }: { text?: string; style?: object }) {
  return (
    <View style={[s.banner, style]}>
      <View style={s.icon}><Ionicons name="pause-circle" size={20} color="#fff" /></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.title}>AntarVoucher sementara nonaktif</Text>
        <Text style={font.tiny}>{text}</Text>
      </View>
    </View>
  );
}

/** Catatan satu baris — untuk di bawah pilihan metode bayar. */
export function AntarVoucherOffNote({ text = 'AntarVoucher sementara nonaktif — pembayaran hanya tunai.' }: { text?: string }) {
  return (
    <View style={s.note}>
      <Ionicons name="information-circle-outline" size={14} color={colors.warning} />
      <Text style={[font.tiny, { flex: 1, color: colors.textSecondary }]}>{text}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  banner: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: radius.lg, borderWidth: 1, borderColor: 'rgba(245,158,11,0.35)', backgroundColor: 'rgba(245,158,11,0.12)' },
  icon: { width: 34, height: 34, borderRadius: 11, backgroundColor: colors.warning, alignItems: 'center', justifyContent: 'center' },
  title: { fontWeight: '700', color: colors.text, fontSize: 14 },
  note: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: -4 },
});
