// Peta untuk Android/iOS: Leaflet di dalam WebView.
// URL ubin & atribusi datang dari server (map_public_config) — bukan konstanta di bundel,
// sehingga penyedia bisa diganti dari Panel Admin tanpa rilis ulang aplikasi.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { buildMapHtml, shouldRefit, type MapProps } from './shared';
import { MapAttribution } from './Attribution';
import { LEAFLET_JS, LEAFLET_CSS } from './leaflet-bundle';
import { useMapConfig } from '@/lib/mapConfig';
import { colors } from '@/lib/theme';
import type { LatLng } from '@/lib/types';

export default function MapView(props: MapProps) {
  const { center, zoom = 15, markers = [], polyline, fitTo, onCenterChange, onPress, interactive = true, style, paddingBottom = 0, attributionBottom } = props;
  const cfg = useMapConfig();
  const ref = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  // HTML dibangun sekali dengan konfigurasi yang berlaku saat itu; perubahan berikutnya
  // dikirim lewat window.__setTile agar peta tidak perlu dimuat ulang.
  const html = useMemo(() => buildMapHtml(LEAFLET_JS, LEAFLET_CSS, center, zoom, { url: cfg.tile_url, attribution: cfg.tile_attribution, maxZoom: cfg.tile_max_zoom }, cfg.track_max_zoom), []); // eslint-disable-line react-hooks/exhaustive-deps
  const lastCenter = useRef(center);

  // Hemat §5.5: peta hanya di-fit ulang bila titik bergeser > refit_min_meters (bawaan 150 m).
  const lastFit = useRef<LatLng[] | null>(null);
  const effectiveFit = useMemo(() => {
    if (!fitTo || fitTo.length === 0) { lastFit.current = null; return null; }
    if (shouldRefit(lastFit.current, fitTo, cfg.refit_min_meters)) { lastFit.current = fitTo; return fitTo; }
    return null;
  }, [fitTo, cfg.refit_min_meters]);

  const state = useMemo(() => ({ markers, polyline, fitTo: effectiveFit, interactive, zoom, paddingBottom, center, moveCenter: false }), [markers, polyline, effectiveFit, interactive, zoom, paddingBottom, center]);

  // Kirim perubahan state ke WebView
  useEffect(() => {
    if (!ready) return;
    // Sengaja memakai `fitTo` (bukan `effectiveFit`): saat fit ulang ditahan penjaga 150 m,
    // peta TIDAK boleh diam-diam berpindah ke `center` — cukup markernya yang bergerak.
    const moveCenter = !fitTo && (center.lat !== lastCenter.current.lat || center.lng !== lastCenter.current.lng);
    lastCenter.current = center;
    ref.current?.injectJavaScript(`window.__update && window.__update(${JSON.stringify({ ...state, moveCenter })}); true;`);
  }, [ready, state, center, fitTo, effectiveFit]);

  // Penyedia ubin diganti dari Panel Admin → tukar lapisan tanpa memuat ulang WebView.
  useEffect(() => {
    if (!ready) return;
    ref.current?.injectJavaScript(`window.__setTile && window.__setTile(${JSON.stringify(cfg.tile_url)},${JSON.stringify(cfg.tile_attribution)},${cfg.tile_max_zoom},${cfg.track_max_zoom}); true;`);
  }, [ready, cfg.tile_url, cfg.tile_attribution, cfg.tile_max_zoom, cfg.track_max_zoom]);

  const onMessage = (e: WebViewMessageEvent) => {
    try {
      const m = JSON.parse(e.nativeEvent.data);
      if (m.type === 'ready') setReady(true);
      else if (m.type === 'moveend') onCenterChange?.({ lat: m.lat, lng: m.lng, zoom: m.zoom });
      else if (m.type === 'click') onPress?.({ lat: m.lat, lng: m.lng });
    } catch { /* abaikan */ }
  };

  return (
    <View style={[styles.wrap, style]}>
      <WebView
        ref={ref}
        source={{ html, baseUrl: 'https://antarkita.app/' }}
        originWhitelist={['*']}
        onMessage={onMessage}
        javaScriptEnabled
        domStorageEnabled
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
        setBuiltInZoomControls={false}
        androidLayerType="hardware"
        allowsInlineMediaPlayback
        style={{ backgroundColor: '#e8ecef', flex: 1 }}
        containerStyle={{ flex: 1 }}
      />
      <MapAttribution html={cfg.tile_attribution} bottom={attributionBottom ?? paddingBottom} />
    </View>
  );
}

const styles = StyleSheet.create({ wrap: { flex: 1, overflow: 'hidden', backgroundColor: colors.border } });
