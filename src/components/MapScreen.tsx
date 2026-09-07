// Kerangka layar peta: peta penuh + tombol kaca melayang + sheet yang bisa ditarik (mobile) / panel samping (layar lebar)
import React from 'react';
import { View, StyleSheet, useWindowDimensions, Platform } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { BlurView } from 'expo-blur';
import { DraggableSheet } from '@/components/Sheet';
import { PressableScale } from '@/components/motion';
import { colors, glass, radius, shadow } from '@/lib/theme';

interface Props {
  map: React.ReactNode;
  children: React.ReactNode;           // isi sheet
  header?: React.ReactNode;            // bagian sheet yang selalu tampak (pegangan)
  floatingRight?: React.ReactNode;     // tombol kanan atas
  floatingTag?: React.ReactNode;       // label kecil kanan atas (mis. kode order)
  onBack?: () => void;
  back?: boolean;                      // tampilkan tombol kembali (default true)
  topLeft?: React.ReactNode;           // pengganti tombol kembali di kiri atas
  bottomSpace?: number;                // ruang bawah isi sheet (tab bar mengambang)
  minHeight?: number;
  maxRatio?: number;                   // porsi tinggi layar untuk sheet penuh (0..1)
  initiallyExpanded?: boolean;
  expanded?: boolean;
  onExpandedChange?: (v: boolean) => void;
}

export function MapScreen({ map, children, header, floatingRight, floatingTag, onBack, back: showBack = true, topLeft, bottomSpace = 0, minHeight = 200, maxRatio = 0.62, initiallyExpanded = true, expanded, onExpandedChange }: Props) {
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const wide = width >= 900;
  const back = onBack ?? (() => (router.canGoBack() ? router.back() : router.replace('/')));
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={[{ flex: 1 }, wide && { flexDirection: 'row-reverse' }]}>
        <View style={[{ flex: 1 }, wide && { flex: 1.4 }]}>
          {map}
          <SafeAreaView edges={['top']} pointerEvents="box-none" style={StyleSheet.absoluteFill}>
            <View pointerEvents="box-none" style={s.topRow}>
              {topLeft ?? (showBack ? <FloatingButton icon="arrow-back" onPress={back} /> : null)}
              <View style={{ flex: 1 }} />
              {floatingTag ? <GlassPill>{floatingTag}</GlassPill> : null}
              {floatingRight}
            </View>
          </SafeAreaView>
        </View>
        {wide ? (
          <DraggableSheet staticPanel maxHeight={height} header={header} style={{ width: 440 }} bottomSpace={bottomSpace}>{children}</DraggableSheet>
        ) : (
          <DraggableSheet minHeight={minHeight + insets.bottom} maxHeight={Math.round(height * maxRatio)} header={header} initiallyExpanded={initiallyExpanded} expanded={expanded} onExpandedChange={onExpandedChange} bottomSpace={bottomSpace}>
            {children}
          </DraggableSheet>
        )}
      </View>
    </View>
  );
}

export function FloatingButton({ icon, onPress, color = colors.text, bg, style }: { icon: React.ComponentProps<typeof Ionicons>['name']; onPress: () => void; color?: string; bg?: string; style?: object }) {
  return (
    <PressableScale onPress={onPress} scaleTo={0.88} style={[s.fab, bg ? { backgroundColor: bg } : null, style]}>
      {!bg && Platform.OS !== 'android' && <BlurView intensity={glass.blur} tint="light" style={StyleSheet.absoluteFill} />}
      <Ionicons name={icon} size={22} color={color} />
    </PressableScale>
  );
}

export function GlassPill({ children }: { children: React.ReactNode }) {
  return (
    <View style={s.pill}>
      {Platform.OS !== 'android' && <BlurView intensity={glass.blur} tint="light" style={StyleSheet.absoluteFill} />}
      <View style={{ paddingHorizontal: 12, paddingVertical: 8 }}>{children}</View>
    </View>
  );
}

const s = StyleSheet.create({
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, paddingTop: 8 },
  fab: { width: 44, height: 44, borderRadius: 22, backgroundColor: Platform.OS === 'android' ? 'rgba(255,255,255,0.96)' : 'rgba(255,255,255,0.92)', borderWidth: 1, borderColor: glass.border, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', ...shadow.card },
  pill: { borderRadius: radius.full, backgroundColor: Platform.OS === 'android' ? 'rgba(255,255,255,0.96)' : 'rgba(255,255,255,0.92)', borderWidth: 1, borderColor: glass.border, overflow: 'hidden', ...shadow.soft },
});
