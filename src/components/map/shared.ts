import type { LatLng } from '@/lib/types';
import type { ViewStyle } from 'react-native';
import { distanceMeters } from '@/lib/geo';

export type MarkerKind = 'pickup' | 'dropoff' | 'me' | 'motor' | 'car' | 'merchant' | 'driver';

export interface MapMarker { id: string; lat: number; lng: number; kind: MarkerKind; label?: string; heading?: number | null }

export interface MapProps {
  center: LatLng;
  zoom?: number;
  markers?: MapMarker[];
  polyline?: [number, number][] | null;
  fitTo?: LatLng[] | null;           // jika diisi, peta menyesuaikan agar semua titik terlihat
  onCenterChange?: (c: LatLng & { zoom: number }) => void;
  onPress?: (p: LatLng) => void;
  interactive?: boolean;
  style?: ViewStyle;
  paddingBottom?: number;            // ruang untuk sheet di bawah agar fitBounds & atribusi tidak tertutup
  /** Ruang bawah KHUSUS badge atribusi (bila sheet menutup peta tapi fitBounds tidak perlu diubah). */
  attributionBottom?: number;
}

/**
 * ⚠️ NILAI BAWAAN DARURAT — BUKAN LAGI SUMBER KEBENARAN.
 *
 * URL ubin yang sesungguhnya datang dari server lewat `map_public_config()`
 * (src/lib/mapConfig.ts, migrasi 0061). Konstanta di bawah hanya dipakai bila
 * konfigurasi server belum/tidak bisa dimuat, supaya peta tidak pernah kosong.
 *
 * Kebijakan OSMF melarang meng-hardcode URL ubin justru karena kasus ini:
 * "Avoid hard-coding the tile URL; allow switching without needing a software update".
 * Sejak migrasi 0061 pemilik bisa mengganti penyedia dari Panel Admin → Peta
 * tanpa membangun ulang aplikasi.
 */
export const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/** Konfigurasi ubin yang dipakai satu instans peta. */
export interface TileConfig { url: string; attribution: string; maxZoom: number }

/**
 * Penjaga gambar-ulang peta (hemat §5.5, perkiraan −70% panggilan fitBounds → −55% permintaan ubin).
 *
 * `fitTo` dihitung ulang tiap kali posisi driver berubah — dengan polling 6 detik plus
 * Realtime, itu sampai ~10×/menit per layar pelacakan, dan setiap `fitBounds` yang
 * mengubah tingkat zoom memaksa Leaflet mengambil satu set ubin baru.
 * Sekarang peta hanya di-fit ulang bila ada titik yang bergeser lebih dari
 * `minMeters` (bawaan 150 m dari `map_config.refit_min_meters`) atau jumlah titiknya berubah.
 * Marker tetap bergerak halus setiap saat lewat `glide()` — yang berhenti melompat
 * hanyalah bingkai petanya, dan itu justru perbaikan pengalaman.
 */
export function shouldRefit(prev: LatLng[] | null | undefined, next: LatLng[] | null | undefined, minMeters: number): boolean {
  if (!next || next.length === 0) return false;
  if (!prev || prev.length !== next.length) return true;
  if (minMeters <= 0) return true;
  return next.some((p, i) => distanceMeters(prev[i], p) > minMeters);
}

export const MARKER_COLORS: Record<MarkerKind, string> = {
  pickup: '#0E7C7B', dropoff: '#E5484D', me: '#2F80ED', motor: '#00A86B', car: '#2F80ED', merchant: '#EB5757', driver: '#00A86B',
};

/** Sumber JS pembuat ikon marker. Disimpan sebagai STRING karena Hermes (native) tidak
 *  menyimpan source function (toString() -> "[bytecode]"), sementara kode ini harus
 *  disuntikkan apa adanya ke WebView. Di web dievaluasi sekali lewat new Function. */
export const MARKER_JS_BODY = `
  var C = { pickup: '#0E7C7B', dropoff: '#E5484D', me: '#2F80ED', motor: '#00A86B', car: '#2F80ED', merchant: '#EB5757', driver: '#00A86B' };
  var c = C[kind] || '#0E7C7B';
  var esc = function (t) { return String(t).replace(/[&<>"']/g, function (ch) { return ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch === '"' ? '&quot;' : '&#39;'; }); };
  var lbl = label ? '<div style="position:absolute;left:50%;top:100%;transform:translateX(-50%);margin-top:2px;background:#fff;color:#0B1F2A;font:600 11px system-ui,sans-serif;padding:2px 6px;border-radius:6px;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.25)">' + esc(label) + '</div>' : '';
  if (kind === 'pickup') {
    return { html: '<div style="position:relative;width:22px;height:22px"><div style="width:22px;height:22px;border-radius:50%;background:' + c + ';border:4px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35)"></div>' + lbl + '</div>', size: [22, 22], anchor: [11, 11] };
  }
  if (kind === 'me') {
    return { html: '<div style="position:relative;width:20px;height:20px"><div style="position:absolute;left:-8px;top:-8px;right:-8px;bottom:-8px;border-radius:50%;background:' + c + ';opacity:.2"></div><div style="width:20px;height:20px;border-radius:50%;background:' + c + ';border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35)"></div></div>', size: [20, 20], anchor: [10, 10] };
  }
  if (kind === 'dropoff' || kind === 'merchant') {
    var glyph = kind === 'merchant'
      ? '<path d="M11 9H9V2H7v7H5V2H3v7c0 2.12 1.66 3.84 3.75 3.97V22h2.5v-9.03C11.34 12.84 13 11.12 13 9V2h-2v7zm5-3v8h2.5v8H21V2c-2.76 0-5 2.24-5 4z" fill="#fff"/>'
      : '<circle cx="12" cy="12" r="4" fill="#fff"/>';
    return { html: '<div style="position:relative;width:34px;height:44px"><svg width="34" height="44" viewBox="0 0 34 44"><path d="M17 0C7.6 0 0 7.6 0 17c0 12 17 27 17 27s17-15 17-27C34 7.6 26.4 0 17 0z" fill="' + c + '"/><g transform="translate(5,5)">' + glyph + '</g></svg>' + lbl + '</div>', size: [34, 44], anchor: [17, 44] };
  }
  var rot = typeof heading === 'number' && !isNaN(heading) ? heading : 0;
  var vehicle = kind === 'car'
    ? '<path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z" fill="#fff"/>'
    : '<path d="M19.44 9.03L15.41 5H11v2h3.59l2 2H5c-2.8 0-5 2.2-5 5s2.2 5 5 5c2.46 0 4.45-1.69 4.9-4h1.65l2.77-2.77c-.21.54-.32 1.14-.32 1.77 0 2.8 2.2 5 5 5s5-2.2 5-5c0-2.65-1.97-4.77-4.56-4.97zM7.82 15C7.4 16.15 6.28 17 5 17c-1.63 0-3-1.37-3-3s1.37-3 3-3c1.28 0 2.4.85 2.82 2H5v2h2.82zM19 17c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3z" fill="#fff"/>';
  return {
    html: '<div style="position:relative;width:36px;height:36px"><div style="width:36px;height:36px;border-radius:50%;background:' + c + ';border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;transform:rotate(' + rot + 'deg)"><svg width="22" height="22" viewBox="0 0 24 24">' + vehicle + '</svg></div>' + lbl + '</div>',
    size: [36, 36], anchor: [18, 18]
  };
`;

export type MarkerSpec = { html: string; size: [number, number]; anchor: [number, number] };
export type MarkerHtmlFn = (kind: MarkerKind, heading?: number | null, label?: string) => MarkerSpec;

const jsStr = (s: string) => JSON.stringify(String(s));

/**
 * HTML lengkap untuk WebView (native).
 *
 * URL ubin TIDAK lagi ditanam sebagai konstanta modul: ia datang dari `tile`
 * (hasil `map_public_config()`), dan lapisan ubin dapat DIGANTI SAAT BERJALAN lewat
 * `window.__setTile(url, attribution, maxZoom)` — jadi peralihan penyedia dari Panel
 * Admin terasa tanpa memuat ulang WebView, apalagi merilis ulang aplikasi.
 *
 * Kontrol atribusi bawaan Leaflet dimatikan; atribusi ditampilkan oleh komponen
 * React di atas peta (lihat MapAttribution) agar tidak pernah tertutup sheet/kartu.
 */
export function buildMapHtml(leafletJs: string, leafletCss: string, center: LatLng, zoom: number, tile: TileConfig, trackMaxZoom = 17): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>${leafletCss}
html,body,#map{margin:0;padding:0;height:100%;width:100%;background:#e8ecef;overflow:hidden}
.leaflet-div-icon{background:transparent;border:0}
</style></head><body><div id="map"></div>
<script>${leafletJs}</script>
<script>
(function(){
  var TILE=${jsStr(tile.url)}, ATTR=${jsStr(tile.attribution)}, MAXZ=${Math.round(tile.maxZoom)}, TRACKZ=${Math.round(trackMaxZoom)};
  var map=L.map('map',{zoomControl:false,attributionControl:false,tap:false}).setView([${center.lat},${center.lng}],${zoom});
  /* keepBuffer 4 (bawaan 2): geseran kecil memakai ubin yang sudah ada — hemat §5.5 */
  var layer=L.tileLayer(TILE,{maxZoom:MAXZ,keepBuffer:4,attribution:ATTR}).addTo(map);
  /* Ganti penyedia ubin tanpa memuat ulang WebView (konfigurasi dari Panel Admin). */
  window.__setTile=function(url,attr,maxZoom,trackZoom){
    try{
      if(typeof trackZoom==='number'&&trackZoom>0){TRACKZ=trackZoom;}
      if(!url||url===TILE){return;}
      TILE=url;ATTR=attr||ATTR;MAXZ=maxZoom||MAXZ;
      if(layer){map.removeLayer(layer);}
      layer=L.tileLayer(TILE,{maxZoom:MAXZ,keepBuffer:4,attribution:ATTR}).addTo(map);
    }catch(e){post({type:'error',message:String(e)});}
  };
  var markers={},line=null,programmatic=false;
  var markerHtml=function(kind,heading,label){${MARKER_JS_BODY}};
  /* Geser marker halus (≈900ms, ease-out) agar posisi driver tidak melompat. */
  function glide(mk,from,to){
    if(mk._raf){cancelAnimationFrame(mk._raf);}
    var t0=null,dur=900;
    function step(ts){
      if(t0===null)t0=ts; var k=Math.min(1,(ts-t0)/dur); var e=1-Math.pow(1-k,3);
      mk.setLatLng([from.lat+(to.lat-from.lat)*e,from.lng+(to.lng-from.lng)*e]);
      if(k<1){mk._raf=requestAnimationFrame(step);}else{mk._raf=null;}
    }
    mk._raf=requestAnimationFrame(step);
  }
  function post(m){ if(window.ReactNativeWebView){window.ReactNativeWebView.postMessage(JSON.stringify(m));} }
  window.__update=function(st){
    try{
      if(st.interactive===false){map.dragging.disable();map.touchZoom.disable();map.doubleClickZoom.disable();map.scrollWheelZoom.disable();}else{map.dragging.enable();map.touchZoom.enable();map.doubleClickZoom.enable();map.scrollWheelZoom.enable();}
      var seen={};
      (st.markers||[]).forEach(function(m){
        seen[m.id]=true;
        var key=m.kind+'|'+(Math.round((m.heading||0)/5)*5)+'|'+(m.label||'');
        if(markers[m.id]){
          var mk=markers[m.id],cur=mk.getLatLng(),anim=(m.kind==='motor'||m.kind==='car'||m.kind==='driver'||m.kind==='me');
          if(mk._key!==key){var sp=markerHtml(m.kind,m.heading,m.label);mk.setIcon(L.divIcon({html:sp.html,className:'',iconSize:sp.size,iconAnchor:sp.anchor}));mk._key=key;}
          if(anim&&(cur.lat!==m.lat||cur.lng!==m.lng)){ glide(mk,cur,{lat:m.lat,lng:m.lng}); } else if(!anim){ mk.setLatLng([m.lat,m.lng]); }
        }
        else{var spec=markerHtml(m.kind,m.heading,m.label);var icon=L.divIcon({html:spec.html,className:'',iconSize:spec.size,iconAnchor:spec.anchor});markers[m.id]=L.marker([m.lat,m.lng],{icon:icon,interactive:false}).addTo(map);markers[m.id]._key=key;}
      });
      Object.keys(markers).forEach(function(k){ if(!seen[k]){map.removeLayer(markers[k]);delete markers[k];} });
      if(line){map.removeLayer(line);line=null;}
      if(st.polyline&&st.polyline.length>1){line=L.polyline(st.polyline,{color:'#0E7C7B',weight:5,opacity:.9,lineJoin:'round'}).addTo(map);}
      programmatic=true;
      /* fitTo hanya dikirim ulang oleh React bila memang perlu (penjaga jarak 150 m, §5.5) */
      if(st.fitTo&&st.fitTo.length>0){
        var b=L.latLngBounds(st.fitTo.map(function(p){return [p.lat,p.lng];}));
        if(st.fitTo.length===1){map.setView(b.getCenter(),st.zoom||16);} else {map.fitBounds(b,{paddingTopLeft:[40,80],paddingBottomRight:[40,(st.paddingBottom||0)+40],maxZoom:TRACKZ});}
      } else if(st.center&&st.moveCenter){ map.setView([st.center.lat,st.center.lng],st.zoom||map.getZoom()); }
      setTimeout(function(){programmatic=false;},300);
    }catch(e){post({type:'error',message:String(e)});}
  };
  map.on('moveend',function(){ if(programmatic)return; var c=map.getCenter(); post({type:'moveend',lat:c.lat,lng:c.lng,zoom:map.getZoom()}); });
  map.on('click',function(e){ post({type:'click',lat:e.latlng.lat,lng:e.latlng.lng}); });
  setTimeout(function(){ map.invalidateSize(); post({type:'ready'}); },50);
})();
</script></body></html>`;
}
