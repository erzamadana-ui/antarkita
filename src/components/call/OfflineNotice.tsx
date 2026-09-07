// Pemberitahuan "tidak ada koneksi" + tombol coba lagi.
// Dipakai layar mana pun: <OfflineNotice /> (banner) atau <OfflineNotice full /> (layar penuh).
import React, { useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { PressableScale } from '@/components/motion';
import { useOnline, OFFLINE_MESSAGE } from '@/hooks/useOnline';
import { colors, font, radius } from '@/lib/theme';

export interface OfflineNoticeProps {
  /** Tampilkan sebagai blok besar di tengah layar (bukan banner tipis). */
  full?: boolean;
  /** Pesan pengganti (default: pesan standar Bahasa Indonesia). */
  message?: string;
  /** Aksi tambahan setelah koneksi pulih (mis. muat ulang data layar). */
  onRetry?: () => void | Promise<void>;
  /** Paksa tampil walau hook mengira online (mis. request barusan gagal). */
  visible?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function OfflineNotice({ full, message, onRetry, visible, style }: OfflineNoticeProps) {
  const { offline, retry } = useOnline();
  const [busy, setBusy] = useState(false);
  const show = visible ?? offline;
  if (!show) return null;

  const onPress = async () => {
    if (busy) return;
    setBusy(true);
    try { await retry(); await onRetry?.(); } catch { /* noop */ } finally { setBusy(false); }
  };

  const button = (
    <PressableScale onPress={onPress} scaleTo={0.94} style={[s.btn, full && { paddingHorizontal: 20, height: 44 }]}>
      {busy ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="refresh" size={15} color="#fff" />}
      <Text style={s.btnText}>{busy ? 'Memeriksa…' : 'Coba lagi'}</Text>
    </PressableScale>
  );

  if (full) {
    return (
      <View style={[s.full, style]}>
        <View style={s.icon}><Ionicons name="cloud-offline-outline" size={34} color={colors.danger} /></View>
        <Text style={[font.h3, { textAlign: 'center' }]}>Tidak ada koneksi</Text>
        <Text style={[font.small, { textAlign: 'center', maxWidth: 300 }]}>{message ?? OFFLINE_MESSAGE}</Text>
        {button}
      </View>
    );
  }
  return (
    <View style={[s.banner, style]}>
      <Ionicons name="cloud-offline-outline" size={18} color={colors.danger} />
      <Text style={[font.small, { flex: 1, color: colors.text }]} numberOfLines={2}>{message ?? OFFLINE_MESSAGE}</Text>
      {button}
    </View>
  );
}

export default OfflineNotice;

const s = StyleSheet.create({
  banner: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.dangerLight, borderWidth: 1, borderColor: 'rgba(229,72,77,0.22)', borderRadius: radius.lg, paddingHorizontal: 12, paddingVertical: 10, margin: 12 },
  full: { alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24 },
  icon: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.dangerLight, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.danger, borderRadius: radius.full, paddingHorizontal: 14, height: 36 },
  btnText: { color: '#fff', fontWeight: '800', fontSize: 13 },
});
