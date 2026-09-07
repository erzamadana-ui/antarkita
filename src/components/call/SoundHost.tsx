// Pemutar suara untuk Android/iOS.
//
// package.json tidak memuat expo-av / expo-audio, jadi tidak ada pemutar audio native.
// Daripada menambah dependensi berat, kita memakai react-native-webview (SUDAH ada, dipakai peta):
// satu WebView 1x1 piksel yang tak terlihat memuat tiga elemen <audio> berisi data URI WAV kecil,
// lalu dikendalikan lewat injectJavaScript. `mediaPlaybackRequiresUserAction={false}` membuat
// WebView Android/iOS boleh memutar tanpa gestur pengguna.
//
// BATASAN JUJUR: audio WebView memakai stream MEDIA, bukan stream RINGTONE. Artinya volumenya
// mengikuti volume media perangkat dan TIDAK otomatis bisu saat ponsel di mode senyap. Karena itu
// getar selalu ikut dinyalakan dan pengguna bisa mematikan suara lewat sound.setSoundEnabled(false).
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { View } from 'react-native';
import { WebView } from 'react-native-webview';
import { SOUNDS, type SoundKind } from '../../../assets/sounds/data';
import { registerNativePlayer } from '@/lib/sound';

const HTML = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:transparent">
${(Object.keys(SOUNDS) as SoundKind[]).map((k) => `<audio id="s-${k}" preload="auto" src="${SOUNDS[k]}"></audio>`).join('')}
<script>
(function(){
  function el(k){ return document.getElementById('s-'+k); }
  window.__stop = function(){ ['${(Object.keys(SOUNDS) as SoundKind[]).join("','")}'].forEach(function(k){ var a=el(k); if(!a) return; try{ a.pause(); a.loop=false; a.currentTime=0; }catch(e){} }); };
  window.__play = function(k, loop){
    try {
      window.__stop();
      var a = el(k); if (!a) return;
      a.loop = !!loop; a.currentTime = 0;
      var p = a.play(); if (p && p.catch) p.catch(function(){});
    } catch (e) {}
  };
  if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage('ready');
})();
</script></body></html>`;

/**
 * Dipasang sekali di root (lewat IncomingCallOverlay). Tidak menampilkan apa pun.
 */
export function SoundHost() {
  const ref = useRef<WebView>(null);
  const readyRef = useRef(false);

  const play = useCallback((kind: SoundKind, loop: boolean) => {
    if (!readyRef.current) return;
    ref.current?.injectJavaScript(`window.__play && window.__play(${JSON.stringify(kind)}, ${loop ? 'true' : 'false'}); true;`);
  }, []);
  const stop = useCallback(() => {
    if (!readyRef.current) return;
    ref.current?.injectJavaScript('window.__stop && window.__stop(); true;');
  }, []);

  const player = useMemo(() => ({ play, stop }), [play, stop]);
  useEffect(() => () => registerNativePlayer(null), []);

  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width: 1, height: 1, opacity: 0 }}>
      <WebView
        ref={ref}
        source={{ html: HTML, baseUrl: 'https://antarkita.local/' }}
        originWhitelist={['*']}
        javaScriptEnabled
        mediaPlaybackRequiresUserAction={false}
        allowsInlineMediaPlayback
        allowsAirPlayForMediaPlayback={false}
        scrollEnabled={false}
        androidLayerType="software"
        onMessage={() => { readyRef.current = true; registerNativePlayer(player); }}
        onError={() => { readyRef.current = false; registerNativePlayer(null); }}
        style={{ width: 1, height: 1, backgroundColor: 'transparent' }}
      />
    </View>
  );
}

export default SoundHost;
