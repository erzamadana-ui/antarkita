// Dasbor pedagang pasar: status pengajuan, skor kualitas + cara menaikkan, ringkasan barang, tips
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Screen, Row, Badge, Button, CircleButton, Empty } from '@/components/ui';
import { Entrance, PressableScale, ProgressBar, AnimatedNumber } from '@/components/motion';
import { TAB_BAR_SPACE } from '@/components/GlassTabBar';
import { ServiceIllustration } from '@/components/ServiceArt';
import { useAuth } from '@/store/auth';
import { supabase } from '@/lib/supabase';
import { colors, font, radius, shadow } from '@/lib/theme';
import { marketCategoryLabel } from '@/lib/format';
import type { MarketVendorItem } from '@/lib/types';
import { loadVendorItems, scoreBreakdown, qualityColor, QUALITY_MIN, FRESH_DAYS, COEF_MAX, isFresh, inBand } from '../shared';

const STATUS: Record<string, { label: string; color: string; text: string }> = {
  pending: { label: 'Menunggu verifikasi', color: colors.warning, text: 'Admin memeriksa dokumen Anda (biasanya 1×24 jam). Sambil menunggu, lengkapi daftar barang & foto agar skor kualitas langsung tinggi saat disetujui.' },
  approved: { label: 'Lapak aktif', color: colors.success, text: 'Lapak Anda tampil di AntarMarket selama skor kualitas di atas minimum.' },
  rejected: { label: 'Ditolak', color: colors.danger, text: 'Perbaiki data sesuai catatan admin lalu kirim ulang dari menu Akun.' },
  suspended: { label: 'Ditangguhkan', color: colors.danger, text: 'Lapak sementara disembunyikan. Hubungi CS untuk peninjauan.' },
};
const TIPS = [
  ['camera-outline', 'Foto barang asli dari lapak Anda, terang, tanpa teks tempelan.'],
  ['pricetag-outline', `Harga wajar ≤${COEF_MAX}× acuan; barang Grade A boleh lebih mahal asal masih dalam batas.`],
  ['refresh-outline', `Perbarui harga tiap ${FRESH_DAYS} hari — cukup buka barang lalu simpan ulang.`],
  ['checkmark-done-outline', 'Tandai "habis" saat stok kosong agar driver tidak salah beli dan rating tetap aman.'],
];

export default function VendorHome() {
  const router = useRouter();
  const { marketVendor: me, session, loadProfile } = useAuth();
  const [items, setItems] = useState<MarketVendorItem[] | null>(null);
  const [marketName, setMarketName] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session) return;
    try { setItems(await loadVendorItems(session.user.id)); } catch { setItems([]); }
  }, [session]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!me?.market_id) return;
    supabase.from('markets').select('name').eq('id', me.market_id).maybeSingle().then(({ data }) => setMarketName((data as { name: string } | null)?.name ?? null));
  }, [me?.market_id]);
  const refresh = async () => { await Promise.all([loadProfile(), load()]); };

  if (!me) return <Screen title="Lapak"><Empty icon="storefront-outline" title="Belum terdaftar" subtitle="Daftarkan lapak Anda dulu." action={<Button title="Daftar pedagang" onPress={() => router.push('/account/become-vendor' as never)} />} /></Screen>;

  const st = STATUS[me.status] ?? STATUS.pending;
  const list = items ?? [];
  const parts = scoreBreakdown(me, list);
  const score = Math.round(Number(me.quality_score) || 0);
  const withPhoto = list.filter((i) => !!i.photo_url).length;
  const outStock = list.filter((i) => !i.in_stock).length;
  const stale = list.filter((i) => !isFresh(i.updated_at)).length;
  const offBand = list.filter((i) => !inBand(i)).length;
  const todo = parts.filter((p) => p.got < p.max).sort((a, b) => (b.max - b.got) - (a.max - a.got)).slice(0, 4);

  return (
    <Screen title={me.stall_name} subtitle={[marketName, me.stall_no ? `No. ${me.stall_no}` : null].filter(Boolean).join(' · ') || 'Pedagang pasar'} bottomSpace={TAB_BAR_SPACE + 16} right={<CircleButton icon="refresh" onPress={refresh} />}>
      <View style={{ gap: 14 }}>
        {/* Status */}
        <Entrance index={0}>
          <View style={[s.card, { borderColor: st.color + '55' }]}>
            <Row gap={12}>
              {me.photo_url ? <Image source={{ uri: me.photo_url }} style={s.photo} /> : <View style={[s.photo, { alignItems: 'center', justifyContent: 'center' }]}><ServiceIllustration kind="market" size={36} /></View>}
              <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                <Badge text={st.label} color={st.color} />
                <Text style={[font.small, { color: colors.text }]}>{st.text}</Text>
                {me.status_reason && me.status !== 'approved' ? <Text style={[font.tiny, { color: colors.danger }]}>Catatan admin: {me.status_reason}</Text> : null}
              </View>
            </Row>
            {me.categories?.length ? <Row gap={6} style={{ flexWrap: 'wrap', marginTop: 10 }}>{me.categories.map((c) => <Badge key={c} text={marketCategoryLabel[c] ?? c} color={colors.textSecondary} />)}</Row> : null}
            {(me.status === 'rejected') && <Button title="Perbaiki & kirim ulang" size="sm" variant="secondary" icon="create-outline" style={{ marginTop: 10 }} onPress={() => router.push('/account/become-vendor' as never)} />}
          </View>
        </Entrance>

        {/* Skor kualitas */}
        <Entrance index={1}>
          <View style={s.card}>
            <Row gap={14}>
              <View style={[s.scoreRing, { borderColor: qualityColor(score) }]}>
                <AnimatedNumber value={score} style={[font.display, { color: qualityColor(score), fontSize: 34 }]} />
                <Text style={font.tiny}>/100</Text>
              </View>
              <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                <Text style={font.h3}>Skor kualitas</Text>
                <Text style={font.small}>{score >= QUALITY_MIN ? `Di atas minimum ${QUALITY_MIN}. Lapak tampil ke pelanggan; skor lebih tinggi = urutan lebih atas.` : `Minimum ${QUALITY_MIN} agar lapak tampil ke pelanggan. Naikkan lewat daftar di bawah.`}</Text>
                <ProgressBar progress={score / 100} color={qualityColor(score)} />
              </View>
            </Row>
            <View style={{ gap: 8, marginTop: 14 }}>
              {parts.map((p) => (
                <Row key={p.key} gap={10}>
                  <Ionicons name={p.got >= p.max ? 'checkmark-circle' : 'ellipse-outline'} size={18} color={p.got >= p.max ? colors.success : colors.textMuted} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[font.small, { color: colors.text, fontWeight: '600' }]}>{p.label}</Text>
                    <Text style={font.tiny} numberOfLines={1}>{p.hint}</Text>
                  </View>
                  <Text style={[font.small, { fontWeight: '800', color: p.got >= p.max ? colors.success : colors.text }]}>{p.got}/{p.max}</Text>
                </Row>
              ))}
            </View>
            {todo.length > 0 && (
              <View style={s.todo}>
                <Text style={[font.label, { marginBottom: 4 }]}>Cara menaikkan skor</Text>
                {todo.map((p) => <Row key={p.key} gap={6}><Ionicons name="arrow-up-circle-outline" size={14} color={colors.primary} /><Text style={[font.tiny, { flex: 1, color: colors.text }]}>{p.label}: {p.hint} (+{Math.round((p.max - p.got) * 10) / 10})</Text></Row>)}
              </View>
            )}
          </View>
        </Entrance>

        {/* Ringkasan barang */}
        <Entrance index={2}>
          <View style={s.stats}>
            {[
              ['Barang', list.length, colors.primary],
              ['Berfoto', withPhoto, colors.success],
              ['Stok habis', outStock, colors.danger],
              ['Perlu update', stale + offBand, colors.warning],
            ].map(([label, n, c], i) => (
              <React.Fragment key={String(label)}>
                {i > 0 && <View style={s.vDivider} />}
                <PressableScale onPress={() => router.push('/(vendor)/items' as never)} scaleTo={0.97} haptic={false} style={s.stat}>
                  <Text style={[font.h2, { color: c as string }]}>{items === null ? '–' : (n as number)}</Text>
                  <Text style={font.tiny}>{label}</Text>
                </PressableScale>
              </React.Fragment>
            ))}
          </View>
          {items !== null && list.length === 0 && <Button title="Tambah barang pertama" icon="add-circle-outline" style={{ marginTop: 10 }} onPress={() => router.push('/(vendor)/items?add=1' as never)} />}
          {(stale > 0 || offBand > 0) && <Text style={[font.tiny, { marginTop: 8, color: colors.warning }]}>{stale > 0 ? `${stale} barang belum diperbarui >${FRESH_DAYS} hari. ` : ''}{offBand > 0 ? `${offBand} barang harganya di luar batas wajar.` : ''}</Text>}
        </Entrance>

        {/* Tips */}
        <Entrance index={3}>
          <View style={s.tips}>
            <Text style={[font.label, { marginBottom: 4 }]}>Tips lapak laris</Text>
            {TIPS.map(([icon, text]) => <Row key={text} gap={8} style={{ alignItems: 'flex-start' }}><Ionicons name={icon as never} size={16} color={colors.primary} style={{ marginTop: 1 }} /><Text style={[font.tiny, { flex: 1, color: colors.text }]}>{text}</Text></Row>)}
          </View>
        </Entrance>
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: '#fff', borderRadius: 20, padding: 14, borderWidth: 1, borderColor: colors.border, ...shadow.soft },
  photo: { width: 64, height: 64, borderRadius: 16, backgroundColor: colors.tint },
  scoreRing: { width: 96, height: 96, borderRadius: 48, borderWidth: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bgSoft },
  todo: { marginTop: 12, gap: 6, padding: 12, borderRadius: radius.md, backgroundColor: colors.tint, borderWidth: 1, borderColor: colors.primaryLight },
  stats: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: radius.lg, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, ...shadow.soft },
  stat: { flex: 1, alignItems: 'center', gap: 2 },
  vDivider: { width: 1, height: 36, backgroundColor: colors.border },
  tips: { gap: 8, padding: 12, borderRadius: radius.lg, backgroundColor: colors.bgSoft, borderWidth: 1, borderColor: colors.border },
});
