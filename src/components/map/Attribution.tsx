// Atribusi peta — WAJIB tampil menurut lisensi setiap penyedia.
//
// Kebijakan ubin OSMF menuntut "Show OpenStreetMap licence attribution clearly on the
// map"; Stadia dan Mapbox punya kewajiban atribusi masing-masing. Teksnya datang dari
// `map_config.tile_attribution` (Panel Admin), jadi saat penyedia diganti, atribusinya
// ikut berganti tanpa rilis ulang.
//
// Kontrol atribusi bawaan Leaflet sengaja DIMATIKAN dan diganti badge ini karena
// kontrol Leaflet berada di dalam peta (pojok kanan bawah) dan tertutup sheet
// "Lokasi terpilih" di layar Pilih Lokasi maupun kartu ringkasan di layar pelacakan.
// Badge ini dirender SESUDAH peta di dalam wadah yang sama, sehingga selalu di atasnya,
// dan digeser ke atas sebanyak `paddingBottom` agar tidak pernah tertutup sheet.
import React from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { attributionText } from '@/lib/mapConfig';

const firstLink = (html: string): string | null => /href="([^"]+)"/i.exec(html)?.[1] ?? null;

export function MapAttribution({ html, bottom = 0 }: { html: string; bottom?: number }) {
  const text = attributionText(html);
  if (!text) return null;
  const link = firstLink(html);
  const open = () => { if (link) Linking.openURL(link).catch(() => {}); };
  return (
    <View pointerEvents="box-none" style={[s.wrap, { bottom: bottom + 4 }]}>
      <Pressable onPress={open} disabled={!link} accessibilityRole={link ? 'link' : 'text'} accessibilityLabel={`Atribusi peta: ${text}`}>
        <Text
          numberOfLines={2}
          style={s.text}
          // Penanda untuk uji otomatis (harness Playwright) — atribusi harus selalu terlihat.
          {...(Platform.OS === 'web' ? ({ dataSet: { testid: 'map-attribution' } } as object) : {})}
        >
          {text}
        </Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { position: 'absolute', left: 6, right: 6, zIndex: 400, alignItems: 'flex-start' },
  text: {
    fontSize: 12,
    lineHeight: 16,
    color: '#0B1F2A',
    backgroundColor: 'rgba(255,255,255,0.82)',
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
    maxWidth: '100%',
  },
});

export default MapAttribution;
