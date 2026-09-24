// Iklan merchant v3 — KAMPANYE (Finpay v3 §7, menggantikan paket harian v2 `merchant_my_ads`/`merchant_ad_request`):
//  - rpc('merchant_campaigns')                               → daftar kampanye + metrik (impresi, klik, transaksi, terpakai)
//  - rpc('merchant_campaign_set', { p_id, p_action, p_amount }) → pause / resume / stop (refund sisa) / topup
//  - buat kampanye: /merchant/campaign-new · laporan harian: /merchant/campaign/[id]
// Closed-loop: budget ditahan dari saldo pendapatan merchant (wallet_apply 'payment'); sisa budget kembali saat dihentikan.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, RefreshControl, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Screen, Card, Row, Button, Badge, Chip, Empty } from '@/components/ui';
import { Entrance, Skeleton } from '@/components/motion';
import { useAuth } from '@/store/auth';
import { colors, font, radius } from '@/lib/theme';
import { rupiah } from '@/lib/format';
import { loadCampaigns, CAMPAIGN_RUNNING, type Campaign, type CampaignStatus } from '@/lib/mitra';
import { CampaignCard } from './campaign-parts';

export default function MerchantAds() {
  const router = useRouter();
  const merchant = useAuth((s) => s.merchant);
  const balance = useAuth((s) => s.wallet?.balance ?? 0);
  const refreshWallet = useAuth((s) => s.refreshWallet);
  const [rows, setRows] = useState<Campaign[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<'running' | 'history'>('running');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try { setRows(await loadCampaigns()); setErr(null); }
    catch (e) { setErr((e as Error).message); setRows((r) => r ?? []); }
    refreshWallet();
  }, [refreshWallet]);
  useEffect(() => { load(); }, [load]);

  const running = (c: Campaign) => CAMPAIGN_RUNNING.includes(c.status as CampaignStatus);
  const stats = useMemo(() => {
    const list = rows ?? [];
    return {
      held: list.filter(running).reduce((a, c) => a + Math.max(0, c.budget - c.spent), 0),
      spent: list.reduce((a, c) => a + c.spent, 0),
      value: list.reduce((a, c) => a + c.conversion_value, 0),
      nRunning: list.filter(running).length,
    };
  }, [rows]); // eslint-disable-line react-hooks/exhaustive-deps
  const list = (rows ?? []).filter((c) => (tab === 'running' ? running(c) : !running(c)));

  if (!merchant) return <Screen title="Iklan & kampanye" back><Empty icon="storefront-outline" title="Belum terdaftar sebagai merchant" subtitle="Daftarkan toko Anda dulu untuk memasang iklan." /></Screen>;
  const approved = merchant.status === 'approved';

  return (
    <Screen title="Iklan & kampanye" subtitle={merchant.name} back scroll={false} padded={false}
      footer={<Button title="Buat kampanye" size="lg" icon="add-circle-outline" color={colors.food} disabled={!approved} onPress={() => router.push('/merchant/campaign-new' as never)} />}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40, maxWidth: 720, width: '100%', alignSelf: 'center' }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
        <Entrance index={0}>
          <Card style={{ gap: 10 }}>
            <Row between><Text style={font.label}>Saldo pendapatan</Text><Badge text="Closed-loop" color={colors.info} /></Row>
            <Text style={{ fontSize: 24, fontWeight: '700', color: colors.primary }}>{rupiah(balance)}</Text>
            <Row gap={10}>
              <View style={s.tile}><Text style={font.tiny}>Budget tertahan ({stats.nRunning} kampanye)</Text><Text style={[font.body, { fontWeight: '700' }]}>{rupiah(stats.held)}</Text></View>
              <View style={s.tile}><Text style={font.tiny}>Tagihan iklan (terpakai)</Text><Text style={[font.body, { fontWeight: '700' }]}>{rupiah(stats.spent)}</Text></View>
            </Row>
            <Row gap={8} style={s.note}>
              <Ionicons name="information-circle-outline" size={16} color={colors.primary} />
              <Text style={[font.tiny, { flex: 1 }]}>
                Iklan dibayar dari saldo pendapatan penjualan Anda — bukan top up atau kartu. Saat kampanye dibuat/ditambah, budget ditahan dari saldo; biaya dipotong per tayangan/klik/transaksi sesuai model harga.
                {' '}Menghentikan kampanye mengembalikan sisa budget (budget − terpakai) ke saldo. Iklan selalu berlabel “Sponsored” dan ditinjau admin sebelum tayang.
              </Text>
            </Row>
            {!approved ? <Text style={[font.tiny, { color: colors.danger }]}>Toko belum disetujui admin — kampanye bisa dibuat setelah disetujui.</Text> : null}
          </Card>
        </Entrance>

        <Row gap={8}>
          <Chip label={`Berjalan${rows ? ` (${stats.nRunning})` : ''}`} active={tab === 'running'} onPress={() => setTab('running')} color={colors.food} />
          <Chip label="Riwayat" active={tab === 'history'} onPress={() => setTab('history')} color={colors.food} />
        </Row>

        {err ? (
          <Card><Row gap={8}><Ionicons name="alert-circle" size={18} color={colors.warning} /><Text style={[font.small, { flex: 1 }]}>Kampanye belum bisa dimuat: {err}</Text></Row><Button title="Coba lagi" variant="ghost" icon="refresh" onPress={load} /></Card>
        ) : null}

        {!rows ? <View style={{ gap: 10 }}><Skeleton height={150} radius={radius.lg} /><Skeleton height={150} radius={radius.lg} /></View>
          : list.length === 0 ? (
            <Empty icon="megaphone-outline" title={tab === 'running' ? 'Belum ada kampanye berjalan' : 'Belum ada riwayat kampanye'}
              subtitle={tab === 'running' ? 'Buat kampanye untuk tampil di blok “Sponsored” pelanggan sekitar toko Anda.' : 'Kampanye yang selesai, dihentikan, ditolak, atau kehabisan budget tampil di sini.'} />
          ) : list.map((c, i) => (
            <Entrance key={c.id} index={Math.min(i + 1, 6)}>
              <CampaignCard c={c} onPress={() => router.push({ pathname: '/merchant/campaign/[id]', params: { id: c.id } } as never)} onChanged={load} />
            </Entrance>
          ))}
        {tab === 'history' && rows && stats.value > 0 ? <Text style={font.tiny}>Total nilai transaksi dari iklan: {rupiah(stats.value)}</Text> : null}
      </ScrollView>
    </Screen>
  );
}

const s = StyleSheet.create({
  tile: { flex: 1, gap: 2, padding: 10, borderRadius: radius.md, backgroundColor: colors.bgSoft },
  note: { padding: 10, borderRadius: radius.md, backgroundColor: colors.tint, alignItems: 'flex-start' },
});
