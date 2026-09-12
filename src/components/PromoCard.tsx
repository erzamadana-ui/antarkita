// Kartu promo bergambar (thumbnail 16:9). Bila promo punya image_url, gambar tampil penuh (teks sudah ada di gambar);
// bila belum, tampil ilustrasi layanan + gradien + judul otomatis.
import React from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { PressableScale } from '@/components/motion';
import { BrandGradient } from '@/components/glass';
import { ServiceIllustration } from '@/components/ServiceArt';
import { serviceDef } from '@/lib/services';
import { colors, radius, shadow } from '@/lib/theme';
import { rupiah } from '@/lib/format';
import type { Promo } from '@/lib/types';

const PALETTES: [string, string][] = [[colors.primary, '#0E7C7B'], ['#F5A524', '#F97316'], ['#8B5CF6', '#6D28D9'], ['#0EA5E9', '#0369A1'], ['#EC4899', '#BE185D']];

export function promoHeadline(p: Promo) {
  return p.title ?? (p.discount_type === 'percent' ? `Diskon ${p.value}%${p.max_discount ? ` s.d. ${rupiah(p.max_discount)}` : ''}` : `Potongan ${rupiah(p.value)}`);
}

export function PromoCard({ promo, index = 0, onPress, width = 260, height = Math.round(width * 9 / 16) }: { promo: Promo; index?: number; onPress?: () => void; width?: number; height?: number }) {
  const def = promo.service ? serviceDef(promo.service) : null;
  const pal = PALETTES[index % PALETTES.length];
  return (
    <PressableScale onPress={onPress} scaleTo={0.97} style={[s.card, { width, height }, shadow.card]}>
      {promo.image_url ? (
        <Image source={{ uri: promo.image_url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : (
        <BrandGradient colors={def ? [def.color, pal[1]] : pal} style={StyleSheet.absoluteFill} />
      )}
      {!promo.image_url && <View style={s.orb} />}
      {!promo.image_url && <View style={s.art}><ServiceIllustration kind={def?.art ?? 'pay'} size={66} /></View>}
      {!promo.image_url && <BrandGradient colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.55)']} angle="vertical" style={s.shade} />}
      {!promo.image_url && <View style={s.body}>
        <View style={s.code}><Ionicons name="pricetag" size={12} color="#fff" /><Text style={{ color: '#fff', fontWeight: '700', fontSize: 12, letterSpacing: 0.5 }}>{promo.code}</Text></View>
        <Text style={s.title} numberOfLines={2}>{promoHeadline(promo)}</Text>
        <Text style={s.desc} numberOfLines={1}>{promo.min_total > 0 ? `Min. ${rupiah(promo.min_total)} · ` : ''}{def ? def.label : 'Semua layanan'}</Text>
      </View>}
    </PressableScale>
  );
}

const s = StyleSheet.create({
  card: { height: 126, borderRadius: 24, overflow: 'hidden', backgroundColor: colors.primary },
  orb: { position: 'absolute', right: -30, top: -40, width: 140, height: 140, borderRadius: 70, backgroundColor: 'rgba(255,255,255,0.16)' },
  art: { position: 'absolute', right: 10, top: 8 },
  shade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 90 },
  body: { position: 'absolute', left: 14, right: 14, bottom: 12, gap: 3 },
  code: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.22)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.45)', borderRadius: radius.full, paddingHorizontal: 8, paddingVertical: 2 },
  title: { color: '#fff', fontWeight: '700', fontSize: 18, letterSpacing: -0.3, lineHeight: 24, textShadowColor: 'rgba(0,0,0,0.35)', textShadowRadius: 6 },
  desc: { color: 'rgba(255,255,255,0.92)', fontSize: 12, fontWeight: '600' },
});

/** Kartu destinasi gaya kit: gambar tinggi, badge rating kiri-atas, tombol panah kanan-atas, lokasi + judul di atas gradien. */
export function DestinationCard({ image, title, subtitle, rating, badge, onPress, width = 210, height = 270, accent = colors.primary, art }: {
  image?: string | null; title: string; subtitle?: string | null; rating?: number | null; badge?: string | null; onPress?: () => void; width?: number; height?: number; accent?: string; art?: React.ReactNode;
}) {
  return (
    <PressableScale onPress={onPress} scaleTo={0.97} style={[d.card, { width, height }, shadow.card]}>
      {image ? <Image source={{ uri: image }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : <BrandGradient colors={[accent, '#1B474C']} style={StyleSheet.absoluteFill} />}
      {!image && art ? <View style={d.art}>{art}</View> : null}
      <BrandGradient colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.05)', 'rgba(0,0,0,0.72)']} angle="vertical" style={d.shade} />
      {rating != null && (
        <View style={d.rating}><Ionicons name="star" size={12} color="#F5A524" /><Text style={d.ratingText}>{Number(rating).toFixed(1)}</Text></View>
      )}
      <View style={d.arrow}><Ionicons name="arrow-up-outline" size={16} color="#fff" style={{ transform: [{ rotate: '45deg' }] }} /></View>
      <View style={d.body}>
        {badge || subtitle ? <View style={d.loc}>{badge ? <View style={d.dot} /> : <Ionicons name="location-outline" size={12} color="#fff" />}<Text style={d.locText} numberOfLines={1}>{badge ?? subtitle}</Text></View> : null}
        <Text style={d.title} numberOfLines={2}>{title}</Text>
      </View>
    </PressableScale>
  );
}
const d = StyleSheet.create({
  card: { borderRadius: 24, overflow: 'hidden', backgroundColor: colors.primaryDark },
  art: { position: 'absolute', right: 12, top: 44 },
  shade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '65%' },
  rating: { position: 'absolute', top: 12, left: 12, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(16,31,33,0.72)', borderRadius: radius.full, paddingHorizontal: 8, paddingVertical: 4 },
  ratingText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  arrow: { position: 'absolute', top: 12, right: 12, width: 34, height: 34, borderRadius: 17, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.85)', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.14)' },
  body: { position: 'absolute', left: 14, right: 14, bottom: 14, gap: 6 },
  loc: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.18)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)', borderRadius: radius.full, paddingHorizontal: 8, paddingVertical: 3 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#F5A524' },
  locText: { color: '#fff', fontSize: 12, fontWeight: '700', maxWidth: 150 },
  title: { color: '#fff', fontWeight: '700', fontSize: 18, letterSpacing: -0.3, lineHeight: 24 },
});
