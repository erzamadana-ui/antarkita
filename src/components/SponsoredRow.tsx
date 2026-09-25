// Blok "Sponsored" (Iklan v3, KONTRAK-API-V3 §7).
// Konten berbayar SELALU tampil di blok terpisah dengan label pil "Sponsored" yang jelas — tidak pernah disisipkan
// ke daftar/ranking organik. Sumber: `ads_serve(placement, lat, lng, category?, q?, limit)` (server mencatat impresi)
// + (opsional) hasil organik `nearby_merchants_v2` yang ber-`ad_label` & `campaign_id`.
// Klik → `ads_click(campaign_id, placement)` → buka merchant dengan param `ad=<campaign_id>` sehingga
// create_order membawa kampanye itu (atribusi konversi, lihat src/lib/ads.ts).
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Image } from 'react-native';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Row } from '@/components/ui';
import { PressableScale } from '@/components/motion';
import { serveAds, clickAd, isSponsoredMerchant, useAdAttribution, SPONSORED_LABEL } from '@/lib/ads';
import { colors, font, radius, glass, motion, shadow } from '@/lib/theme';
import { km } from '@/lib/format';
import type { AdPlacementV3, AdServed, Merchant } from '@/lib/types';

/** Pil label transparansi — dipakai semua kartu berbayar. */
export function SponsoredPill({ onDark }: { onDark?: boolean }) {
  return (
    <View style={[s.pill, onDark && { backgroundColor: 'rgba(255,255,255,0.94)' }]} accessibilityLabel="Konten bersponsor">
      <Text style={s.pillText}>{SPONSORED_LABEL}</Text>
    </View>
  );
}

type Props = {
  placement: AdPlacementV3;
  near: { lat: number; lng: number } | null;
  category?: string | null;
  q?: string | null;
  limit?: number;
  title?: string;
  /** Merchant organik yang berbayar (nearby_merchants_v2 ad_label + campaign_id) — ikut ditampilkan di blok ini. */
  organic?: Merchant[];
  /** 'row' = kartu geser; 'banner' = kartu lebar bertumpuk (banner_home / banner_category). */
  variant?: 'row' | 'banner';
};

export function SponsoredRow({ placement, near, category, q, limit = 3, title, organic, variant = 'row' }: Props) {
  const router = useRouter();
  const [ads, setAds] = useState<AdServed[] | null>(null);
  const lat = near?.lat, lng = near?.lng;
  useEffect(() => {
    if (lat == null || lng == null) { setAds(null); return; }
    let live = true;
    const t = setTimeout(() => { serveAds(placement, lat, lng, { category, q, limit }).then((a) => { if (live) setAds(a); }); }, q ? 400 : 0);
    return () => { live = false; clearTimeout(t); };
  }, [placement, lat, lng, category, q, limit]);

  const items = useMemo<AdServed[]>(() => {
    const out = [...(ads ?? [])];
    (organic ?? []).filter(isSponsoredMerchant).forEach((m) => {
      if (out.some((a) => a.merchant_id === m.id)) return;
      out.push({ campaign_id: m.campaign_id!, merchant_id: m.id, merchant: m.name, headline: m.description, image_url: m.image_url, cta: null, label: SPONSORED_LABEL, distance_km: m.distance_km ?? null });
    });
    return out;
  }, [ads, organic]);

  if (!near || items.length === 0) return null;
  const open = (a: AdServed) => {
    clickAd(a.campaign_id, placement);            // tidak ditunggu: navigasi tidak boleh tertahan jaringan
    useAdAttribution.getState().set(a.merchant_id, a.campaign_id);
    router.push({ pathname: '/food/[id]', params: { id: a.merchant_id, ad: a.campaign_id } } as never);
  };

  return (
    <Animated.View entering={FadeInDown.duration(motion.base)} style={s.wrap} accessibilityRole="summary">
      <Row between style={{ marginBottom: 8 }}>
        {/* Header tanpa pil (tidak redundan dengan judul); SETIAP kartu di bawah tetap berpil "Sponsored". */}
        <Text style={[font.h3, { flex: 1 }]} numberOfLines={1}>{title ?? 'Rekomendasi bersponsor'}</Text>
      </Row>
      <Text style={[font.tiny, { marginTop: -4, marginBottom: 8 }]}>Iklan berbayar dari merchant — terpisah dari hasil biasa.</Text>
      {variant === 'banner' ? (
        <View style={{ gap: 10 }}>
          {items.map((a) => (
            <PressableScale key={a.campaign_id} onPress={() => open(a)} scaleTo={0.98} haptic={false} accessibilityRole="button" accessibilityLabel={`${SPONSORED_LABEL}: ${a.merchant}`} style={s.banner}>
              {a.image_url ? <Image source={{ uri: a.image_url }} style={s.bannerImg} /> : <View style={[s.bannerImg, s.ph]}><Ionicons name="restaurant" size={28} color={colors.food} /></View>}
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <SponsoredPill />
                <Text style={[font.body, { fontWeight: '700' }]} numberOfLines={2}>{a.headline || a.merchant}</Text>
                <Text style={font.tiny} numberOfLines={1}>{a.merchant}{a.distance_km != null ? ` · ${km(a.distance_km)}` : ''}</Text>
              </View>
              <Text style={s.cta} numberOfLines={1}>{a.cta || 'Lihat'} →</Text>
            </PressableScale>
          ))}
        </View>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingVertical: 2, paddingRight: 8 }}>
          {items.map((a) => (
            <PressableScale key={a.campaign_id} onPress={() => open(a)} scaleTo={0.97} accessibilityRole="button" accessibilityLabel={`${SPONSORED_LABEL}: ${a.merchant}`} style={s.card}>
              {a.image_url ? <Image source={{ uri: a.image_url }} style={s.img} /> : <View style={[s.img, s.ph]}><Ionicons name="restaurant" size={24} color={colors.food} /></View>}
              <View style={s.tag}><SponsoredPill onDark /></View>
              <View style={{ padding: 8, gap: 2 }}>
                <Text style={{ fontWeight: '700', color: colors.text, fontSize: 14 }} numberOfLines={1}>{a.merchant}</Text>
                {a.headline ? <Text style={font.tiny} numberOfLines={2}>{a.headline}</Text> : null}
                <Text style={s.cta} numberOfLines={1}>{a.cta || 'Lihat menu'}{a.distance_km != null ? ` · ${km(a.distance_km)}` : ''} →</Text>
              </View>
            </PressableScale>
          ))}
        </ScrollView>
      )}
    </Animated.View>
  );
}

const s = StyleSheet.create({
  wrap: { padding: 12, borderRadius: radius.lg, backgroundColor: colors.bgSoft, borderWidth: 1, borderColor: colors.border },
  pill: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.full, backgroundColor: colors.accentLight, borderWidth: 1, borderColor: colors.accent },
  pillText: { color: '#7A4B00', fontSize: 12, fontWeight: '700', letterSpacing: 0.2 },
  card: { width: 176, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: '#fff', borderWidth: 1, borderColor: glass.border, ...shadow.soft },
  img: { width: '100%', height: 84, backgroundColor: colors.bgSoft },
  ph: { alignItems: 'center', justifyContent: 'center' },
  tag: { position: 'absolute', top: 6, left: 6 },
  cta: { fontSize: 12, fontWeight: '700', color: colors.food },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: radius.lg, backgroundColor: '#fff', borderWidth: 1, borderColor: glass.border, ...shadow.soft },
  bannerImg: { width: 72, height: 72, borderRadius: radius.md, backgroundColor: colors.bgSoft },
});
