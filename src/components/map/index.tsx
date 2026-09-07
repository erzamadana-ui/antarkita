import React from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import MapView from './MapView';
import { colors, shadow } from '@/lib/theme';

export { MapView };
export type { MapProps, MapMarker, MarkerKind } from './shared';

/** Pin di tengah peta untuk mode "geser peta untuk memilih lokasi". */
export function CenterPin({ color = colors.primary, lifted }: { color?: string; lifted?: boolean }) {
  return (
    <View pointerEvents="none" style={[styles.pinWrap, lifted && { transform: [{ translateY: -8 }] }]}>
      <View style={[styles.pinHead, { backgroundColor: color }]}>
        <View style={styles.pinDot} />
      </View>
      <View style={[styles.pinStem, { backgroundColor: color }]} />
      <View style={styles.pinShadow} />
    </View>
  );
}

/** Tombol bulat mengambang di atas peta (misal: lokasi saya). */
export function MapFab({ icon, onPress, style, color = colors.text }: { icon: React.ComponentProps<typeof Ionicons>['name']; onPress: () => void; style?: object; color?: string }) {
  return (
    <Pressable onPress={onPress} style={[styles.fab, style]}>
      <Ionicons name={icon} size={22} color={color} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pinWrap: { position: 'absolute', left: '50%', top: '50%', marginLeft: -16, marginTop: -44, alignItems: 'center', zIndex: 5 },
  pinHead: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: '#fff', ...shadow.card },
  pinDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#fff' },
  pinStem: { width: 3, height: 12 },
  pinShadow: { width: 10, height: 4, borderRadius: 5, backgroundColor: 'rgba(0,0,0,0.3)', marginTop: -1 },
  fab: { position: 'absolute', width: 44, height: 44, borderRadius: 22, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', ...shadow.card, zIndex: 6 },
});
