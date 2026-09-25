// Pita "INTERNAL TESTING" — hanya muncul bila build disetel EXPO_PUBLIC_BUILD_CHANNEL=internal
// (workflow android.yml untuk branch selain main). pointerEvents="none": tidak pernah menghalangi sentuhan.
import React from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export const BUILD_CHANNEL = process.env.EXPO_PUBLIC_BUILD_CHANNEL ?? '';
export const BUILD_COMMIT = process.env.EXPO_PUBLIC_BUILD_COMMIT ?? '';

export function InternalBuildRibbon() {
  const insets = useSafeAreaInsets();
  if (BUILD_CHANNEL !== 'internal') return null;
  return (
    <View pointerEvents="none" style={[s.wrap, { top: Math.max(insets.top - 14, 0) }]}>
      <Text style={s.text} numberOfLines={1}>INTERNAL TESTING — BUKAN VERSI PRODUKSI{BUILD_COMMIT ? ` · ${BUILD_COMMIT.slice(0, 7)}` : ''}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { position: 'absolute', alignSelf: 'center', backgroundColor: 'rgba(185,28,28,0.88)', paddingHorizontal: 8, paddingVertical: 1, borderRadius: 6, zIndex: 9999 },
  text: { color: '#fff', fontSize: 10, fontWeight: '700', letterSpacing: 0.3 },
});
