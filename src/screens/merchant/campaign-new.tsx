// Buat kampanye iklan merchant (Finpay v3 §7):
//  - produk dari tabel `ad_products` (select, RLS: aktif) — model harga flat/CPC/CPM/CPA, min budget, min/maks hari, label
//  - rpc('merchant_campaign_create', { p_product, p_name, p_budget, p_days, p_radius_km, p_creative: { headline, image_url, cta } })
//    → id; status pending_review (atau langsung aktif bila produk tidak butuh tinjauan). Budget ditahan dari saldo pendapatan.
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Screen, Card, Row, Button, Badge, Chip, Input, Stepper, Empty, toast } from '@/components/ui';
import { Entrance, PressableScale, Skeleton } from '@/components/motion';
import { useAuth } from '@/store/auth';
import { rpc, supabase } from '@/lib/supabase';
import { pickAndUpload } from '@/lib/upload';
import { colors, font, radius } from '@/lib/theme';
import { rupiah, km } from '@/lib/format';
import {
  productModel, productUnitPrice, productPriceText, pricingModelLabel, placementLabel, confirmAsync, parseAmount, numberId,
  type AdProductV3,
} from '@/lib/mitra';
import { SponsoredPreview } from './campaign-parts';

const HEADLINE_MAX = 60;
const RADII = [1, 2, 3, 5, 10];
const DAY_CHIPS = [1, 3, 7, 14, 30];
const CTAS = ['Pesan sekarang', 'Lihat menu', 'Pakai promo', 'Kunjungi toko'];

export default function CampaignNew() {
  const router = useRouter();
  const merchant = useAuth((s) => s.merchant);
  const session = useAuth((s) => s.session);
  const balance = useAuth((s) => s.wallet?.balance ?? 0);
  const refreshWallet = useAuth((s) => s.refreshWallet);
  const [products, setProducts] = useState<AdProductV3[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [budget, setBudget] = useState('');
  const [days, setDays] = useState(7);
  const [radiusKm, setRadiusKm] = useState(3);
  const [headline, setHeadline] = useState('');
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [cta, setCta] = useState(CTAS[0]);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    refreshWallet();
    supabase.from('ad_products').select('*').eq('active', true).then(({ data, error }) => {
      if (error) { setLoadErr(error.message); setProducts([]); return; }
      const list = ((data as AdProductV3[]) ?? []).sort((a, b) => Number(a.min_budget ?? 0) - Number(b.min_budget ?? 0) || a.name.localeCompare(b.name));
      setProducts(list);
      setCode((c) => c ?? list[0]?.code ?? null);
    });
  }, [refreshWallet]);

  const product = products?.find((p) => p.code === code) ?? null;
  const minDays = Math.max(1, Number(product?.min_days ?? 1));
  const maxDays = Math.max(minDays, Number(product?.max_days ?? 30));
  const minBudget = Number(product?.min_budget ?? 0);
  const model = product ? productModel(product) : 'flat';
  const unit = product ? productUnitPrice(product) : 0;
  // Harga tetap: biaya periode = harga × hari (atau × minggu). Dipakai sebagai saran, server tetap penentu.
  const flatCost = product && model === 'flat' ? unit * (product.unit === 'per_week' ? Math.ceil(days / 7) : days) : 0;
  const amt = parseAmount(budget);

  // Jaga hari dalam rentang produk saat produk berganti
  useEffect(() => { setDays((d) => Math.min(maxDays, Math.max(minDays, d))); }, [minDays, maxDays]);
  // Isi budget awal: harga tetap × periode, atau minimal budget produk
  useEffect(() => { if (product) setBudget(String(Math.max(minBudget, flatCost) || '')); }, [code]); // eslint-disable-line react-hooks/exhaustive-deps

  const budgetErr = !product || !amt ? null
    : amt < minBudget ? `Minimal budget ${rupiah(minBudget)}`
      : amt > balance ? `Saldo pendapatan hanya ${rupiah(balance)}`
        : null;
  const estimate = !product || !amt || !unit ? null
    : model === 'cpc' ? `≈ ${numberId(Math.floor(amt / unit))} klik berbayar (klik berulang dari pengguna yang sama dalam waktu singkat tidak ditagih)`
      : model === 'cpm' ? `≈ ${numberId(Math.floor((amt / unit) * 1000))} tayangan (dibatasi frekuensi per pengguna per hari)`
        : model === 'cpa' ? 'Biaya dipotong hanya saat pelanggan menyelesaikan transaksi dari iklan ini.'
          : `${productPriceText(product)} × ${product.unit === 'per_week' ? `${Math.ceil(days / 7)} minggu` : `${days} hari`} = ${rupiah(flatCost)}`;
  const flatShort = model === 'flat' && amt > 0 && flatCost > amt;

  const pickImage = async () => {
    if (!session) return;
    setUploading(true);
    try { const r = await pickAndUpload('merchant-images', session.user.id); if (r) setImageUrl(r.url); }
    catch (e) { toast.error((e as Error).message); }
    finally { setUploading(false); }
  };

  const submit = async () => {
    if (!product) return toast.error('Pilih produk iklan');
    if (name.trim().length < 3) return toast.error('Nama kampanye minimal 3 huruf');
    if (!amt) return toast.error('Isi budget kampanye');
    if (budgetErr) return toast.error(budgetErr);
    if (days < minDays || days > maxDays) return toast.error(`Durasi ${minDays}–${maxDays} hari`);
    if (headline.trim().length < 3) return toast.error('Isi judul iklan (3–60 karakter)');
    if (headline.length > HEADLINE_MAX) return toast.error(`Judul maksimal ${HEADLINE_MAX} karakter`);
    if (!cta.trim()) return toast.error('Pilih tombol ajakan (CTA)');
    const review = product.requires_approval !== false;
    const ok = await confirmAsync('Kirim kampanye?',
      `${product.name} · ${days} hari · radius ${km(radiusKm)}.\nBudget ${rupiah(amt)} ditahan dari saldo pendapatan (saldo ${rupiah(balance)}).` +
      (review ? '\nKampanye ditinjau admin sebelum tayang; bila ditolak, budget dikembalikan.' : '\nKampanye langsung tayang.') +
      '\nSisa budget dikembalikan saat kampanye dihentikan.', 'Kirim & tahan budget');
    if (!ok) return;
    setBusy(true);
    try {
      const id = await rpc<string | { id: string }>('merchant_campaign_create', {
        p_product: product.code, p_name: name.trim(), p_budget: amt, p_days: days, p_radius_km: radiusKm,
        p_creative: { headline: headline.trim(), image_url: imageUrl ?? merchant?.image_url ?? null, cta: cta.trim() },
      });
      await refreshWallet();
      toast.success(review ? 'Kampanye terkirim — menunggu tinjauan admin' : 'Kampanye aktif');
      const cid = typeof id === 'string' ? id : id?.id;
      if (cid) router.replace({ pathname: '/merchant/campaign/[id]', params: { id: cid } } as never);
      else router.back();
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };

  if (!merchant) return <Screen title="Buat kampanye" back><Empty icon="storefront-outline" title="Belum terdaftar sebagai merchant" /></Screen>;

  return (
    <Screen title="Buat kampanye" subtitle={merchant.name} back footer={
      <Button title={busy ? 'Mengirim…' : amt ? `Kirim · tahan ${rupiah(amt)} dari saldo` : 'Kirim kampanye'} size="lg" color={colors.food} loading={busy}
        disabled={!product || !!budgetErr || !amt || merchant.status !== 'approved'} onPress={submit} />
    }>
      <View style={{ gap: 16 }}>
        <Entrance index={0}>
          <Card style={{ gap: 10 }}>
            <Text style={font.h3}>1 · Produk iklan</Text>
            {loadErr ? <Text style={[font.small, { color: colors.danger }]}>Produk iklan belum bisa dimuat: {loadErr}</Text> : null}
            {!products ? <View style={{ gap: 8 }}><Skeleton height={70} radius={radius.lg} /><Skeleton height={70} radius={radius.lg} /></View>
              : products.length === 0 ? <Text style={font.small}>Belum ada produk iklan yang dibuka admin.</Text>
              : products.map((p) => {
                const on = p.code === code;
                return (
                  <PressableScale key={p.code} onPress={() => setCode(p.code)} scaleTo={0.98} haptic={false} style={[s.product, on && { borderColor: colors.food, backgroundColor: colors.food + '10' }]}>
                    <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                      <Row between style={{ alignItems: 'flex-start' }}>
                        <Text style={{ fontWeight: '700', color: colors.text, flex: 1 }} numberOfLines={1}>{p.name}</Text>
                        <Badge text={p.label || 'Sponsored'} color={colors.textSecondary} />
                      </Row>
                      <Text style={font.tiny} numberOfLines={2}>{placementLabel[p.placement] ?? placementLabel[p.code] ?? p.placement}{p.description ? ` — ${p.description}` : ''}</Text>
                      <Text style={[font.small, { color: colors.text, fontWeight: '600' }]}>{pricingModelLabel[productModel(p)]}: {productPriceText(p)}</Text>
                      <Text style={font.tiny}>Min. budget {rupiah(Number(p.min_budget ?? 0))} · {Number(p.min_days ?? 1)}–{Number(p.max_days ?? 30)} hari{p.requires_approval === false ? ' · langsung tayang' : ' · ditinjau admin'}</Text>
                    </View>
                    <Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={20} color={on ? colors.food : colors.textMuted} />
                  </PressableScale>
                );
              })}
          </Card>
        </Entrance>

        {product ? (
          <>
            <Entrance index={1}>
              <Card style={{ gap: 12 }}>
                <Text style={font.h3}>2 · Budget, periode & jangkauan</Text>
                <Input label="Nama kampanye" placeholder="Contoh: Promo makan siang September" value={name} onChangeText={setName} maxLength={80} />
                <Input label="Budget (Rp)" keyboardType="number-pad" value={budget} onChangeText={(v) => setBudget(v.replace(/\D/g, ''))} error={budgetErr} />
                <Row gap={8} style={{ flexWrap: 'wrap' }}>
                  {Array.from(new Set([minBudget, flatCost, minBudget * 2, minBudget * 5].filter((n) => n > 0))).sort((a, b) => a - b).map((n) => (
                    <Chip key={n} label={rupiah(n)} active={amt === n} onPress={() => setBudget(String(n))} color={colors.food} />
                  ))}
                </Row>
                <Text style={font.tiny}>Saldo pendapatan {rupiah(balance)} · minimal {rupiah(minBudget)}</Text>
                {estimate ? <View style={s.quote}><Text style={font.small}>{estimate}</Text></View> : null}
                {flatShort ? <Text style={[font.tiny, { color: colors.warning }]}>Budget di bawah harga tetap periode ini ({rupiah(flatCost)}) — iklan bisa berhenti lebih awal karena budget habis.</Text> : null}

                <Row between>
                  <View style={{ flex: 1 }}><Text style={font.label}>Durasi</Text><Text style={font.tiny}>{minDays}–{maxDays} hari</Text></View>
                  <Stepper value={days} onChange={setDays} min={minDays} max={maxDays} />
                </Row>
                <Row gap={8} style={{ flexWrap: 'wrap' }}>{DAY_CHIPS.filter((d) => d >= minDays && d <= maxDays).map((d) => <Chip key={d} label={`${d} hari`} active={days === d} onPress={() => setDays(d)} color={colors.food} />)}</Row>

                <Text style={font.label}>Radius dari toko</Text>
                <Row gap={8} style={{ flexWrap: 'wrap' }}>{RADII.map((r) => <Chip key={r} label={km(r)} active={radiusKm === r} onPress={() => setRadiusKm(r)} color={colors.food} />)}</Row>
                <Text style={font.tiny}>Iklan hanya tampil ke pelanggan dalam radius ini dari lokasi toko.</Text>
              </Card>
            </Entrance>

            <Entrance index={2}>
              <Card style={{ gap: 12 }}>
                <Text style={font.h3}>3 · Materi iklan</Text>
                <Input label={`Judul (${headline.length}/${HEADLINE_MAX})`} placeholder="Contoh: Nasi Padang lengkap mulai Rp18.000" value={headline} onChangeText={(v) => setHeadline(v.slice(0, HEADLINE_MAX))} maxLength={HEADLINE_MAX} />
                <PressableScale onPress={pickImage} scaleTo={0.985} haptic={false} style={[s.cover, imageUrl && { borderColor: colors.success, borderStyle: 'solid' }]}>
                  {imageUrl ? <Image source={{ uri: imageUrl }} style={s.coverImg} /> : <View style={s.pickIcon}><Ionicons name={uploading ? 'cloud-upload-outline' : 'image-outline'} size={20} color={colors.food} /></View>}
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ fontWeight: '700', color: colors.text, fontSize: 14 }}>{uploading ? 'Mengunggah…' : imageUrl ? 'Gambar iklan terunggah' : 'Gambar iklan (opsional)'}</Text>
                    <Text style={font.tiny}>{imageUrl ? 'Ketuk untuk ganti' : 'Tanpa gambar, foto sampul toko dipakai. Hindari teks berlebihan & klaim menyesatkan.'}</Text>
                  </View>
                </PressableScale>
                <Text style={font.label}>Tombol ajakan (CTA)</Text>
                <Row gap={8} style={{ flexWrap: 'wrap' }}>{CTAS.map((c) => <Chip key={c} label={c} active={cta === c} onPress={() => setCta(c)} color={colors.food} />)}</Row>
              </Card>
            </Entrance>

            <Entrance index={3}>
              <Card>
                <SponsoredPreview merchantName={merchant.name} fallbackImage={merchant.image_url} headline={headline} imageUrl={imageUrl} cta={cta} label={product.label} radiusKm={radiusKm} />
              </Card>
            </Entrance>
          </>
        ) : null}
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  product: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.border, backgroundColor: '#fff' },
  quote: { gap: 4, padding: 12, borderRadius: radius.md, backgroundColor: colors.bgSoft },
  cover: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.border, borderRadius: 14, padding: 12, backgroundColor: '#fff' },
  coverImg: { width: 56, height: 56, borderRadius: 14, backgroundColor: colors.bgSoft },
  pickIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.food + '14', alignItems: 'center', justifyContent: 'center' },
});
