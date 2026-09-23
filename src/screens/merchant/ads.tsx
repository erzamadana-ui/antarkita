// Iklan & Boost merchant (Skema Bisnis v2 §4, migrasi 0101)
//  - rpc('merchant_my_ads')                 → produk iklan yang dijual, iklan saya, saldo pendapatan
//  - rpc('ad_price', { p_product, p_days }) → harga untuk durasi terpilih (dihitung server)
//  - rpc('merchant_ad_request', { p_product, p_days }) → beli dari saldo pendapatan (closed-loop), langsung tayang
// Merchant yang di-boost tampil di atas daftar merchant pelanggan dengan label "Iklan" (transparan).
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Platform, Alert } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Screen, Card, Row, Button, Badge, Chip, Empty, toast } from '@/components/ui';
import { Entrance, PressableScale, Skeleton } from '@/components/motion';
import { useAuth } from '@/store/auth';
import { rpc } from '@/lib/supabase';
import { colors, font, radius } from '@/lib/theme';
import { rupiah, formatDate } from '@/lib/format';
import type { AdPlacement, AdPriceQuote, AdUnit, MerchantAdRow, MerchantMyAds } from '@/lib/types';

const PLACEMENT: Record<AdPlacement, { label: string; icon: React.ComponentProps<typeof Ionicons>['name']; hint: string }> = {
  boost_nearby: { label: 'Boost terdekat', icon: 'rocket-outline', hint: 'Toko Anda diurutkan paling atas di daftar merchant sekitar pelanggan.' },
  featured_home: { label: 'Unggulan beranda', icon: 'star-outline', hint: 'Toko Anda ditandai sebagai unggulan di beranda pelanggan.' },
  banner_category: { label: 'Banner kategori', icon: 'image-outline', hint: 'Banner di halaman kategori makanan.' },
};
const UNIT: Record<AdUnit, string> = { per_day: '/hari', per_week: '/minggu', per_order: '/pesanan' };
const DAYS = [1, 3, 7, 14, 30];
const STATUS: Record<string, { label: string; color: string }> = {
  active: { label: 'Tayang', color: colors.success }, expired: { label: 'Selesai', color: colors.textMuted },
  cancelled: { label: 'Dibatalkan', color: colors.danger }, pending_payment: { label: 'Menunggu bayar', color: colors.warning }, draft: { label: 'Draf', color: colors.textMuted },
};

export default function MerchantAds() {
  const merchant = useAuth((s) => s.merchant);
  const refreshWallet = useAuth((s) => s.refreshWallet);
  const [data, setData] = useState<MerchantMyAds | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [product, setProduct] = useState<string | null>(null);
  const [days, setDays] = useState(7);
  const [quote, setQuote] = useState<AdPriceQuote | null>(null);
  const [quoteErr, setQuoteErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await rpc<MerchantMyAds>('merchant_my_ads');
      setData(d); setErr(null);
      setProduct((p) => p ?? d.products[0]?.code ?? null);
    } catch (e) { setErr((e as Error).message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!product) { setQuote(null); return; }
    let live = true;
    rpc<AdPriceQuote>('ad_price', { p_product: product, p_days: days }).then(
      (q) => { if (live) { setQuote(q); setQuoteErr(null); } },
      (e: Error) => { if (live) { setQuote(null); setQuoteErr(e.message); } },
    );
    return () => { live = false; };
  }, [product, days]);

  const selected = data?.products.find((p) => p.code === product) ?? null;
  const balance = data?.balance ?? 0;
  const enough = !!quote && balance >= quote.price;

  const buy = () => {
    if (!quote || !selected) return;
    const msg = `${selected.name} selama ${quote.days} hari seharga ${rupiah(quote.price)} dibayar dari saldo pendapatan (saldo ${rupiah(balance)}). Iklan langsung tayang.`;
    const doIt = async () => {
      setBusy(true);
      try {
        await rpc('merchant_ad_request', { p_product: selected.code, p_days: days });
        toast.success('Iklan aktif — toko Anda kini berlabel "Iklan" di daftar pelanggan');
        await Promise.all([load(), refreshWallet()]);
      } catch (e) { toast.error((e as Error).message); }
      finally { setBusy(false); }
    };
    if (Platform.OS === 'web') { if (confirm(msg)) doIt(); return; }
    Alert.alert('Pasang iklan?', msg, [{ text: 'Batal' }, { text: 'Bayar & tayangkan', onPress: doIt }]);
  };

  if (!merchant) return <Screen title="Iklan & Boost" back><Empty icon="storefront-outline" title="Belum terdaftar sebagai merchant" subtitle="Daftarkan toko Anda dulu untuk memasang iklan." /></Screen>;

  return (
    <Screen title="Iklan & Boost" subtitle={merchant.name} back footer={selected && quote ? (
      <Button title={busy ? 'Memproses…' : enough ? `Bayar ${rupiah(quote.price)} dari saldo` : `Saldo kurang ${rupiah(quote.price - balance)}`} size="lg" color={colors.food} loading={busy} disabled={!enough || merchant.status !== 'approved'} onPress={buy} />
    ) : undefined}>
      <View style={{ gap: 16 }}>
        {err ? (
          <Card><Row gap={8}><Ionicons name="alert-circle" size={18} color={colors.warning} /><Text style={[font.small, { flex: 1 }]}>Data iklan belum bisa dimuat: {err}</Text></Row><Button title="Coba lagi" variant="ghost" icon="refresh" onPress={load} /></Card>
        ) : null}
        <Entrance index={0}>
          <Card>
            <Row between><Text style={font.label}>Saldo pendapatan</Text><Badge text="Closed-loop" color={colors.info} /></Row>
            {data ? <Text style={{ fontSize: 24, fontWeight: '700', color: colors.primary, marginTop: 4 }}>{rupiah(balance)}</Text> : <Skeleton width="40%" height={24} />}
            <Text style={[font.tiny, { marginTop: 6 }]}>Iklan dibayar dari saldo pendapatan penjualan Anda (bukan top up). Merchant yang di-boost tampil lebih atas dan selalu diberi label "Iklan" agar pelanggan tahu.</Text>
            {merchant.status !== 'approved' ? <Text style={[font.tiny, { color: colors.danger, marginTop: 6 }]}>Toko belum disetujui admin — iklan bisa dipasang setelah disetujui.</Text> : null}
          </Card>
        </Entrance>

        <Entrance index={1}>
          <Card style={{ gap: 10 }}>
            <Text style={font.h3}>Pilih produk iklan</Text>
            {!data ? <View style={{ gap: 8 }}><Skeleton height={60} radius={radius.lg} /><Skeleton height={60} radius={radius.lg} /></View>
              : data.products.length === 0 ? <Text style={font.small}>Belum ada produk iklan yang dijual admin.</Text>
              : data.products.map((p) => {
                const meta = PLACEMENT[p.placement];
                const on = p.code === product;
                return (
                  <PressableScale key={p.code} onPress={() => setProduct(p.code)} scaleTo={0.98} haptic={false} style={[s.product, on && { borderColor: colors.food, backgroundColor: colors.food + '10' }]}>
                    <View style={[s.pIcon, on && { backgroundColor: colors.food }]}><Ionicons name={meta?.icon ?? 'megaphone-outline'} size={20} color={on ? '#fff' : colors.food} /></View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Row between><Text style={{ fontWeight: '700', color: colors.text, flex: 1 }} numberOfLines={1}>{p.name}</Text><Text style={{ fontWeight: '700', color: colors.text }}>{rupiah(p.price)}{UNIT[p.unit]}</Text></Row>
                      <Text style={font.tiny} numberOfLines={3}>{p.description ?? meta?.hint ?? ''}</Text>
                    </View>
                    <Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={20} color={on ? colors.food : colors.textMuted} />
                  </PressableScale>
                );
              })}
            {selected ? (
              <>
                <Text style={[font.label, { marginTop: 4 }]}>Durasi</Text>
                <Row gap={8} style={{ flexWrap: 'wrap' }}>{DAYS.map((d) => <Chip key={d} label={`${d} hari`} active={days === d} onPress={() => setDays(d)} color={colors.food} />)}</Row>
                {quote ? (
                  <View style={s.quote}>
                    <Row between><Text style={font.small}>{quote.units} × {rupiah(quote.unit_price)}{UNIT[quote.unit]}</Text><Text style={{ fontWeight: '700', color: colors.text }}>{rupiah(quote.price)}</Text></Row>
                    <Text style={font.tiny}>Tayang {quote.days} hari{quote.unit === 'per_week' && quote.days !== days ? ` (dibulatkan ke ${quote.units} minggu)` : ''}. Bila iklan yang sama masih tayang, iklan baru menyambung setelahnya.</Text>
                  </View>
                ) : quoteErr ? <Text style={[font.tiny, { color: colors.danger }]}>Harga belum bisa dihitung: {quoteErr}</Text> : <Skeleton width="60%" height={14} />}
              </>
            ) : null}
          </Card>
        </Entrance>

        <Entrance index={2}>
          <Card style={{ gap: 10 }}>
            <Text style={font.h3}>Iklan saya</Text>
            {!data ? <Skeleton height={56} radius={radius.lg} />
              : data.ads.length === 0 ? <Text style={font.small}>Belum ada iklan. Iklan yang Anda pasang akan tampil di sini.</Text>
              : data.ads.map((a) => <AdRow key={a.id} a={a} />)}
          </Card>
        </Entrance>
      </View>
    </Screen>
  );
}

function AdRow({ a }: { a: MerchantAdRow }) {
  const st = a.is_live ? { label: 'Sedang tayang', color: colors.success } : STATUS[a.status] ?? { label: a.status, color: colors.textMuted };
  return (
    <View style={s.ad}>
      <Row between style={{ alignItems: 'flex-start' }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontWeight: '700', color: colors.text }} numberOfLines={1}>{a.product_name}</Text>
          <Text style={font.tiny}>{formatDate(a.starts_at)} – {formatDate(a.ends_at)}</Text>
        </View>
        <Badge text={st.label} color={st.color} />
      </Row>
      <Row between style={{ marginTop: 6 }}>
        <Text style={font.tiny}>{PLACEMENT[a.placement]?.label ?? a.placement} · dibayar {a.paid_via === 'wallet' ? 'saldo' : a.paid_via ?? 'admin'}</Text>
        <Text style={{ fontWeight: '700', color: colors.text }}>{rupiah(a.price_paid)}{a.refunded ? ` (refund ${rupiah(a.refunded)})` : ''}</Text>
      </Row>
    </View>
  );
}

const s = StyleSheet.create({
  product: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.border, backgroundColor: '#fff' },
  pIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.food + '18', alignItems: 'center', justifyContent: 'center' },
  quote: { gap: 4, padding: 12, borderRadius: radius.md, backgroundColor: colors.bgSoft },
  ad: { padding: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: '#fff' },
});
