// Detail & laporan satu kampanye iklan (Finpay v3 §7):
//  - rpc('merchant_campaigns') → kampanye ini (status, review_note, budget, spent, materi)
//  - rpc('merchant_campaign_report', { p_id, p_from, p_to }) → harian: impressions, clicks, ctr, conversions, conversion_value, spent, roas
//  - aksi via merchant_campaign_set (lihat campaign-parts)
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Screen, Card, Row, Badge, Button, Chip, Empty, toast } from '@/components/ui';
import { Entrance, Skeleton } from '@/components/motion';
import { useAuth } from '@/store/auth';
import { colors, font, radius } from '@/lib/theme';
import { rupiah, formatDate, km } from '@/lib/format';
import {
  loadCampaigns, loadCampaignReport, sumReport, campaignStatusOf, ctrText, roasText, numberId, ymd, exportMitraCsv, placementLabel,
  type Campaign, type CampaignReportRow,
} from '@/lib/mitra';
import { BudgetBar, CampaignActions, MetricTiles, SponsoredPreview } from './campaign-parts';

type Range = '7d' | '30d' | 'all';

export default function CampaignDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const merchant = useAuth((s) => s.merchant);
  const [c, setC] = useState<Campaign | null | undefined>(undefined);
  const [err, setErr] = useState<string | null>(null);
  const [range, setRange] = useState<Range>('7d');
  const [rows, setRows] = useState<CampaignReportRow[] | null>(null);
  const [repErr, setRepErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadCampaign = useCallback(async () => {
    try { const list = await loadCampaigns(); setC(list.find((x) => x.id === id) ?? null); setErr(null); }
    catch (e) { setErr((e as Error).message); setC((v) => v ?? null); }
  }, [id]);

  const bounds = useMemo(() => {
    const to = new Date();
    const end = c?.ends_at ? new Date(c.ends_at) : null;
    const until = end && end < to ? end : to;
    const from = new Date(until);
    if (range === '7d') from.setDate(from.getDate() - 6);
    else if (range === '30d') from.setDate(from.getDate() - 29);
    else { const start = new Date(c?.starts_at ?? c?.created_at ?? until); from.setTime(start.getTime()); }
    return { from: ymd(from), to: ymd(until) };
  }, [range, c?.starts_at, c?.created_at, c?.ends_at]);

  const loadReport = useCallback(async () => {
    if (!id || !c) return;
    setRows(null);
    try { setRows(await loadCampaignReport(id, bounds.from, bounds.to)); setRepErr(null); }
    catch (e) { setRepErr((e as Error).message); setRows([]); }
  }, [id, c, bounds.from, bounds.to]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadCampaign(); }, [loadCampaign]);
  useEffect(() => { loadReport(); }, [loadReport]);

  const total = useMemo(() => sumReport(rows ?? []), [rows]);

  const exportCsv = async () => {
    if (!c || !rows) return;
    try {
      await exportMitraCsv(`iklan-${(c.name ?? c.id).replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${bounds.from}_${bounds.to}.csv`,
        ['Tanggal', 'Impresi', 'Klik', 'CTR %', 'Transaksi', 'Nilai transaksi', 'Terpakai', 'ROAS'],
        rows.map((r) => [r.day, r.impressions, r.clicks, Number(r.ctr.toFixed(2)), r.conversions, r.conversion_value, r.spent, r.roas == null ? '' : Number(r.roas.toFixed(2))]));
      toast.success(`${rows.length} hari diekspor`);
    } catch (e) { toast.error((e as Error).message); }
  };

  if (c === undefined) return <Screen title="Kampanye" back><View style={{ gap: 10 }}><Skeleton height={140} radius={radius.lg} /><Skeleton height={200} radius={radius.lg} /></View></Screen>;
  if (!c) return <Screen title="Kampanye" back><Empty icon="megaphone-outline" title="Kampanye tidak ditemukan" subtitle={err ?? 'Kampanye mungkin milik toko lain atau sudah dihapus.'} /></Screen>;

  const st = campaignStatusOf(c.status);
  const left = Math.max(0, c.budget - c.spent);
  return (
    <Screen title={c.name || 'Kampanye'} subtitle={c.product_name ?? placementLabel[c.product_code] ?? c.product_code} back scroll={false} padded={false}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40, maxWidth: 720, width: '100%', alignSelf: 'center' }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await loadCampaign(); await loadReport(); setRefreshing(false); }} />}>
        <Entrance index={0}>
          <Card style={{ gap: 10 }}>
            <Row between style={{ alignItems: 'flex-start' }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={font.h3} numberOfLines={2}>{c.name || 'Tanpa nama'}</Text>
                <Text style={font.tiny}>{[c.starts_at && c.ends_at ? `${formatDate(c.starts_at, false)} – ${formatDate(c.ends_at, false)}` : `Dibuat ${formatDate(c.created_at)}`, c.radius_km ? `radius ${km(c.radius_km)}` : null].filter(Boolean).join(' · ')}</Text>
              </View>
              <Badge text={st.label} color={st.color} />
            </Row>
            {c.review_note ? (
              <Row gap={8} style={[s.note, c.status === 'rejected' && { backgroundColor: colors.dangerLight }]}>
                <Ionicons name={c.status === 'rejected' ? 'close-circle-outline' : 'chatbox-ellipses-outline'} size={16} color={c.status === 'rejected' ? colors.danger : colors.primary} />
                <Text style={[font.tiny, { flex: 1, color: colors.text }]}>Catatan peninjau: {c.review_note}</Text>
              </Row>
            ) : c.status === 'pending_review' ? <Text style={font.tiny}>Admin memeriksa materi iklan (keamanan merek & kebenaran klaim) sebelum tayang.</Text> : null}
            <BudgetBar budget={c.budget} spent={c.spent} />
            <Text style={font.tiny}>
              Budget {rupiah(c.budget)} ditahan dari saldo pendapatan. {['ended', 'cancelled', 'expired', 'rejected'].includes(c.status) ? 'Sisa budget sudah dikembalikan ke saldo.' : `Menghentikan kampanye mengembalikan sisa ${rupiah(left)} ke saldo.`}
            </Text>
            <CampaignActions c={c} onChanged={loadCampaign} size="md" />
          </Card>
        </Entrance>

        <Entrance index={1}>
          <Card style={{ gap: 12 }}>
            <Row between><Text style={font.h3}>Laporan</Text><Ionicons name="analytics-outline" size={20} color={colors.food} /></Row>
            <Row gap={8} style={{ flexWrap: 'wrap' }}>
              {([['7d', '7 hari'], ['30d', '30 hari'], ['all', 'Sejak mulai']] as const).map(([k, l]) => <Chip key={k} label={l} active={range === k} onPress={() => setRange(k)} color={colors.food} />)}
            </Row>
            <Text style={font.tiny}>{formatDate(`${bounds.from}T12:00:00`, false)} – {formatDate(`${bounds.to}T12:00:00`, false)}</Text>
            {repErr ? <Text style={[font.small, { color: colors.danger }]}>Laporan belum bisa dimuat: {repErr}</Text> : null}
            {!rows ? <Skeleton height={120} radius={radius.md} /> : (
              <>
                <MetricTiles items={[
                  { label: 'Impresi', value: numberId(total.impressions) }, { label: 'Klik', value: numberId(total.clicks) }, { label: 'CTR', value: ctrText(total.ctr) },
                  { label: 'Transaksi', value: numberId(total.conversions) }, { label: 'Nilai transaksi', value: rupiah(total.conversion_value) },
                  { label: 'Terpakai', value: rupiah(total.spent) }, { label: 'ROAS', value: roasText(total.roas) },
                ]} />
                <Text style={font.tiny}>CTR = klik ÷ impresi. ROAS = nilai transaksi ÷ biaya iklan terpakai (2× berarti tiap Rp1 iklan menghasilkan Rp2 penjualan).</Text>
                {rows.length === 0 ? <Text style={font.small}>Belum ada data pada periode ini.</Text> : (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View>
                      <View style={[s.tr, s.th]}>{COLS.map((h) => <Text key={h.k} style={[s.cell, { width: h.w, fontWeight: '700', color: colors.textSecondary }]}>{h.l}</Text>)}</View>
                      {rows.map((r) => (
                        <View key={r.day} style={s.tr}>
                          <Text style={[s.cell, { width: COLS[0].w }]}>{formatDate(`${r.day.slice(0, 10)}T12:00:00`, false)}</Text>
                          <Text style={[s.cell, { width: COLS[1].w }]}>{numberId(r.impressions)}</Text>
                          <Text style={[s.cell, { width: COLS[2].w }]}>{numberId(r.clicks)}</Text>
                          <Text style={[s.cell, { width: COLS[3].w }]}>{ctrText(r.ctr)}</Text>
                          <Text style={[s.cell, { width: COLS[4].w }]}>{numberId(r.conversions)}</Text>
                          <Text style={[s.cell, { width: COLS[5].w }]}>{rupiah(r.conversion_value)}</Text>
                          <Text style={[s.cell, { width: COLS[6].w }]}>{rupiah(r.spent)}</Text>
                          <Text style={[s.cell, { width: COLS[7].w }]}>{roasText(r.roas)}</Text>
                        </View>
                      ))}
                    </View>
                  </ScrollView>
                )}
                <Button title="Ekspor CSV" size="sm" variant="secondary" icon="download-outline" color={colors.food} disabled={!rows.length} onPress={exportCsv} />
              </>
            )}
          </Card>
        </Entrance>

        {merchant ? (
          <Entrance index={2}>
            <Card>
              <SponsoredPreview merchantName={merchant.name} fallbackImage={merchant.image_url} headline={c.creative?.headline} imageUrl={c.creative?.image_url} cta={c.creative?.cta} label={c.label} radiusKm={c.radius_km} />
            </Card>
          </Entrance>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const COLS = [
  { k: 'day', l: 'Tanggal', w: 104 }, { k: 'imp', l: 'Impresi', w: 76 }, { k: 'clk', l: 'Klik', w: 56 }, { k: 'ctr', l: 'CTR', w: 64 },
  { k: 'trx', l: 'Trx', w: 48 }, { k: 'val', l: 'Nilai trx', w: 96 }, { k: 'sp', l: 'Terpakai', w: 88 }, { k: 'roas', l: 'ROAS', w: 60 },
];

const s = StyleSheet.create({
  note: { padding: 10, borderRadius: radius.md, backgroundColor: colors.tint, alignItems: 'flex-start' },
  tr: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 8 },
  th: { backgroundColor: colors.bgSoft, borderTopLeftRadius: 8, borderTopRightRadius: 8 },
  cell: { fontSize: 12, color: colors.text, paddingHorizontal: 4 },
});
