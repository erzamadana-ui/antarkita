// Layar pengganti untuk rute yang dimatikan saat build (mis. dompet di AAB Google Play — src/lib/features.ts).
import React from 'react';
import { View, Text } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { Screen, Button } from '@/components/ui';
import { colors, font } from '@/lib/theme';

export function FeatureUnavailable({ title, text }: { title: string; text: string }) {
  const router = useRouter();
  return (
    <Screen title={title} back>
      <View style={{ alignItems: 'center', gap: 12, paddingTop: 40, paddingHorizontal: 8 }}>
        <Ionicons name="information-circle-outline" size={48} color={colors.primary} />
        <Text style={[font.h3, { textAlign: 'center' }]}>Belum tersedia di versi ini</Text>
        <Text style={[font.body, { textAlign: 'center', color: colors.textSecondary }]}>{text}</Text>
        <Button title="Kembali" onPress={() => (router.canGoBack() ? router.back() : router.replace('/' as never))} />
      </View>
    </Screen>
  );
}
