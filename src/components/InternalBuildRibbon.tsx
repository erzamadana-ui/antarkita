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
    // Bingkai selebar layar (left/right 8) + pita di tengahnya: pita tidak pernah melebar melewati tepi layar.
    // Dulu pita absolut tanpa left/right melebar sesuai teks — di 320 px dengan skala font besar kedua ujungnya
    // terpotong ("TERNAL TESTING … 473589") sehingga hash commit hilang. Kini teks boleh 2 baris.
    <View pointerEvents="none" style={[s.frame, { top: Math.max(insets.top - 14, 0) }]}>
      <View style={s.wrap}>
        <Text style={s.text} numberOfLines={2}>INTERNAL TESTING — BUKAN VERSI PRODUKSI{BUILD_COMMIT ? ` · ${BUILD_COMMIT.slice(0, 7)}` : ''}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  frame: { position: 'absolute', left: 8, right: 8, alignItems: 'center', zIndex: 9999 },
  wrap: { maxWidth: '100%', backgroundColor: 'rgba(185,28,28,0.88)', paddingHorizontal: 8, paddingVertical: 1, borderRadius: 6 },
  text: { color: '#fff', fontSize: 10, fontWeight: '700', letterSpacing: 0.3, textAlign: 'center' },
});
