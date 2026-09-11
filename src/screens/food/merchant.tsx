import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Image, Alert, Platform, Share, useWindowDimensions } from 'react-native';
import Animated, { FadeIn, FadeInDown, LinearTransition } from 'react-native-reanimated';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Row, Stars, Stepper, Badge, CircleButton, IconCircle, toast, Screen, Empty, Button, type IconName } from '@/components/ui';
import { CartBar } from '@/components/CartBar';
import { Entrance, PressableScale, Skeleton } from '@/components/motion';
import { BrandGradient } from '@/components/glass';
import { ServiceIllustration } from '@/components/ServiceArt';
import { useCart } from '@/store/cart';
import { supabase } from '@/lib/supabase';
import { colors, font, radius, shadow, motion } from '@/lib/theme';
import { rupiah } from '@/lib/format';
import type { Merchant, MenuItem } from '@/lib/types';
import { HalalBadge } from '@/components/MerchantStatus';
import { ReportContentButton } from '@/components/moderation';

type Tab = 'menu' | 'info' | 'ulasan';
const TABS: { key: Tab; label: string }[] = [{ key: 'menu', label: 'Menu' }, { key: 'info', label: 'Info' }, { key: 'ulasan', label: 'Ulasan' }];

export default function MerchantScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const cart = useCart();
  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('menu');
  const [fav, setFav] = useState(false);
  const heroH = Math.round(height * 0.46);

  useEffect(() => {
    (async () => {
      const [{ data: m }, { data: it }] = await Promise.all([
        supabase.from('merchants').select('*').eq('id', id).maybeSingle(),
        supabase.from('menu_items').select('*').eq('merchant_id', id).order('sort_order'),
      ]);
      setMerchant(m as Merchant); setItems((it as MenuItem[]) ?? []); setLoading(false);
    })();
  }, [id]);

  const groups = useMemo(() => {
    const g = new Map<string, MenuItem[]>();
    items.forEach((i) => { const k = i.category || 'Menu'; g.set(k, [...(g.get(k) ?? []), i]); });
    return Array.from(g.entries());
  }, [items]);

  const qtyOf = (itemId: string) => cart.lines.find((l) => l.item.id === itemId)?.qty ?? 0;
  const add = (item: MenuItem) => {
    if (!merchant) return;
    if (!merchant.is_open) { toast.error('Merchant sedang tutup'); return; }
    if (!cart.add(merchant, item)) {
      const replace = () => { cart.replaceWith(merchant, item); toast.show('Keranjang diganti'); };
      if (Platform.OS === 'web') { if (confirm(`Keranjang berisi pesanan dari ${cart.merchant?.name}. Ganti dengan ${merchant.name}?`)) replace(); return; }
      Alert.alert('Ganti keranjang?', `Keranjang berisi pesanan dari ${cart.merchant?.name}. Ganti dengan ${merchant.name}?`, [{ text: 'Batal' }, { text: 'Ganti', onPress: replace }]);
    }
  };
  const share = async () => {
    if (!merchant) return;
    try { await Share.share({ message: `${merchant.name} di AntarFood${merchant.address ? ` — ${merchant.address}` : ''}` }); } catch { /* dibatalkan */ }
  };
  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/food' as never));

  const infoRow = (icon: IconName, label: string, value: string | null | undefined) => (
    <Row gap={12} style={{ paddingVertical: 10 }}>
      <IconCircle name={icon} size={40} bg={colors.tint} />
      <View style={{ flex: 1 }}>
        <Text style={font.tiny}>{label}</Text>
        <Text style={[font.body, { fontWeight: '600' }]}>{value || '-'}</Text>
      </View>
    </Row>
  );

  if (loading) return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Skeleton width="100%" height={heroH} radius={0} />
      <View style={[s.sheet, { padding: 20, gap: 10 }]}><Skeleton width="60%" height={22} /><Skeleton width="90%" height={14} /><Skeleton width="40%" height={14} /></View>
      <CircleButton icon="chevron-back" onPress={goBack} style={[s.overlayBtn, { top: insets.top + 8, left: 16 }]} />
    </View>
  );

  // Merchant tidak ada (tautan lama/dibagikan, merchant dihapus atau ditolak admin):
  // JANGAN biarkan layar diam berisi kerangka + pemutar tanpa akhir — pelanggan tidak
  // tahu apa yang terjadi dan tidak punya jalan keluar selain tombol kembali kecil.
  if (!merchant) return (
    <Screen title="Merchant" back>
      <Empty
        icon="storefront-outline"
        title="Merchant tidak ditemukan"
        subtitle="Tautan ini mungkin sudah lama, atau merchantnya tidak lagi tersedia di AntarKita."
        action={<Button title="Lihat merchant lain" onPress={() => router.replace('/food' as never)} />}
      />
    </Screen>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 120 }} showsVerticalScrollIndicator={false}>
        {/* Hero gambar penuh */}
        <Animated.View entering={FadeIn.duration(motion.slow)} style={{ height: heroH, backgroundColor: colors.primaryDeep }}>
          {merchant.image_url ? <Image source={{ uri: merchant.image_url }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : (
            <BrandGradient colors={[colors.food, colors.primaryDeep]} style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}><ServiceIllustration kind="food" size={120} /></BrandGradient>
          )}
          <BrandGradient colors={['rgba(0,0,0,0.25)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0.35)']} angle="vertical" style={StyleSheet.absoluteFill} />
          {!merchant.is_open && <View style={[s.closed, { top: insets.top + 60 }]}><Text style={{ color: '#fff', fontSize: 12, fontWeight: '800' }}>SEDANG TUTUP</Text></View>}
        </Animated.View>

        {/* Kartu putih menumpuk */}
        <View style={s.sheetWrap}>
          <Animated.View entering={FadeInDown.duration(motion.slow)} style={s.sheet}>
            <View style={s.handle} />
            <Row between style={{ alignItems: 'flex-start' }}>
              <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                <Text style={font.h1} numberOfLines={2}>{merchant.name}</Text>
                <Row gap={4}><Ionicons name="location-outline" size={14} color={colors.textMuted} /><Text style={font.small} numberOfLines={1}>{merchant.category}{merchant.address ? ` · ${merchant.address}` : ''}</Text></Row>
              </View>
              <View style={s.ratingPill}><Ionicons name="star" size={13} color={colors.accent} /><Text style={{ fontWeight: '800', fontSize: 13, color: colors.text }}>{Number(merchant.rating_avg).toFixed(1)}</Text></View>
            </Row>
            <Row gap={8} style={{ marginTop: 12, flexWrap: 'wrap' }}>
              <HalalBadge merchant={merchant} size="md" />
              <Badge text={merchant.is_open ? `Buka · ${merchant.opening_hours ?? 'hari ini'}` : 'Tutup'} color={merchant.is_open ? colors.success : colors.danger} />
              <Badge text={`Siap ±${merchant.prep_minutes} mnt`} color={colors.primary} />
              {merchant.distance_km != null && <Badge text={`${merchant.distance_km} km`} color={colors.textSecondary} />}
            </Row>

            {/* Tab pil */}
            <Row gap={8} style={{ marginTop: 16 }}>
              {TABS.map((t) => (
                <PressableScale key={t.key} onPress={() => setTab(t.key)} scaleTo={0.94} style={[s.tab, tab === t.key && s.tabOn]}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: tab === t.key ? '#fff' : colors.text }}>{t.label}</Text>
                </PressableScale>
              ))}
            </Row>
          </Animated.View>

          {tab === 'menu' && (
            <View style={{ paddingHorizontal: 16 }}>
              {groups.map(([cat, list], gi) => (
                <View key={cat} style={{ marginTop: 18 }}>
                  <Entrance index={gi}><Text style={[font.h3, { marginBottom: 10 }]}>{cat}</Text></Entrance>
                  {list.map((item, ii) => {
                    const q = qtyOf(item.id);
                    return (
                      <Entrance key={item.id} index={Math.min(gi + ii + 1, 8)} from="up">
                        <Animated.View layout={LinearTransition.springify().stiffness(280).damping(20)} style={[s.item, !item.is_available && { opacity: 0.5 }, q > 0 && { borderColor: colors.primary }]}>
                          {item.image_url ? <Image source={{ uri: item.image_url }} style={s.thumb} /> : <View style={[s.thumb, { alignItems: 'center', justifyContent: 'center' }]}><Ionicons name="fast-food-outline" size={24} color={colors.primary} /></View>}
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text style={[font.body, { fontWeight: '700' }]} numberOfLines={2}>{item.name}</Text>
                            {item.description ? <Text style={font.tiny} numberOfLines={2}>{item.description}</Text> : null}
                            <Text style={{ fontWeight: '800', color: colors.primary, marginTop: 4, fontSize: 15 }}>{rupiah(item.price)}</Text>
                          </View>
                          <View style={{ justifyContent: 'center' }}>
                            {!item.is_available ? <Badge text="Habis" color={colors.textMuted} /> : q === 0 ? (
                              <PressableScale onPress={() => add(item)} scaleTo={0.88} style={s.addBtn} accessibilityRole="button" accessibilityLabel={`Tambah ${item.name} ke keranjang`}><Ionicons name="add" size={22} color="#fff" /></PressableScale>
                            ) : <Stepper value={q} onChange={(v) => (v > q ? add(item) : cart.setQty(item.id, v))} />}
                          </View>
                        </Animated.View>
                      </Entrance>
                    );
                  })}
                </View>
              ))}
              {items.length === 0 && <Text style={[font.small, { padding: 24, textAlign: 'center' }]}>Merchant belum menambahkan menu.</Text>}
            </View>
          )}

          {tab === 'info' && (
            <Entrance index={0} style={{ paddingHorizontal: 16, marginTop: 16 }}>
              <View style={s.infoCard}>
                {merchant.description ? <Text style={[font.body, { marginBottom: 6 }]}>{merchant.description}</Text> : null}
                {infoRow('location-outline', 'Alamat', merchant.address)}
                {infoRow('time-outline', 'Jam buka', merchant.opening_hours)}
                {infoRow('timer-outline', 'Waktu persiapan', `±${merchant.prep_minutes} menit`)}
                {infoRow('bicycle-outline', 'Ongkir', merchant.delivery_fee == null ? null : merchant.delivery_fee === 0 ? 'Gratis' : rupiah(merchant.delivery_fee))}
                {infoRow('shield-checkmark-outline', 'Status halal', merchant.is_halal ? (merchant.halal_verified ? 'Halal, sertifikat terverifikasi' : 'Halal (pernyataan merchant)') : 'Non-halal')}
              </View>
              {/* Foto & keterangan merchant adalah konten buatan pengguna — sediakan jalur pelaporan. */}
              <ReportContentButton kind="merchant_photo" targetId={String(id)} targetUserId={merchant.owner_id ?? null} name={merchant.name} title="Laporkan foto atau keterangan merchant" />
            </Entrance>
          )}

          {tab === 'ulasan' && (
            <Entrance index={0} style={{ paddingHorizontal: 16, marginTop: 16 }}>
              <View style={[s.infoCard, { alignItems: 'center', gap: 6 }]}>
                <Text style={[font.display, { fontSize: 40, lineHeight: 46 }]}>{Number(merchant.rating_avg).toFixed(1)}</Text>
                <Stars value={merchant.rating_avg} size={18} />
                <Text style={font.small}>{merchant.rating_count} ulasan pelanggan</Text>
                <Text style={[font.tiny, { textAlign: 'center', marginTop: 6 }]}>Ulasan diberikan pelanggan setelah pesanan selesai. Rating merchant diperbarui otomatis.</Text>
              </View>
              {/* Moderasi UGC (wajib Google Play): ulasan & foto merchant harus bisa dilaporkan. */}
              <ReportContentButton kind="review" targetId={String(id)} targetUserId={merchant.owner_id ?? null} name={merchant.name} title="Laporkan ulasan atau rating di halaman ini" />
            </Entrance>
          )}
        </View>
      </ScrollView>

      {/* Tombol bulat di atas hero */}
      <CircleButton icon="chevron-back" onPress={goBack} style={[s.overlayBtn, { top: insets.top + 8, left: 16 }]} />
      <Row gap={8} style={[s.overlayBtn, { top: insets.top + 8, right: 16 }]}>
        <CircleButton icon="share-social-outline" onPress={share} />
        <CircleButton icon={fav ? 'heart' : 'heart-outline'} color={fav ? colors.danger : colors.text} onPress={() => { setFav((v) => !v); toast.show(fav ? 'Dihapus dari favorit' : 'Disimpan ke favorit'); }} />
      </Row>

      {/* Bar bawah: keranjang */}
      <View style={[s.footer, { paddingBottom: Math.max(insets.bottom, 12) }]} pointerEvents="box-none">
        <CartBar />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  sheetWrap: { width: '100%', maxWidth: 720, alignSelf: 'center' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, marginTop: -28, padding: 20, paddingTop: 12, borderWidth: 1, borderBottomWidth: 0, borderColor: colors.border, ...shadow.card },
  handle: { width: 44, height: 5, borderRadius: 3, backgroundColor: colors.border, alignSelf: 'center', marginBottom: 14 },
  ratingPill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.accentLight, borderRadius: radius.full, paddingHorizontal: 10, paddingVertical: 6, marginLeft: 8 },
  tab: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 11, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, backgroundColor: '#fff' },
  tabOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: radius.lg, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: colors.border, ...shadow.soft },
  thumb: { width: 72, height: 72, borderRadius: radius.md, backgroundColor: colors.tint },
  addBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', ...shadow.soft },
  infoCard: { backgroundColor: '#fff', borderRadius: radius.lg, padding: 16, borderWidth: 1, borderColor: colors.border, ...shadow.soft },
  closed: { position: 'absolute', left: 16, backgroundColor: 'rgba(16,31,33,0.72)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.full },
  overlayBtn: { position: 'absolute' },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16 },
});
