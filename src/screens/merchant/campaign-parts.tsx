// Komponen bersama layar kampanye iklan merchant (Finpay v3 §7):
// pratinjau kartu "Sponsored", bilah budget, kartu kampanye, aksi pause/resume/stop/topup (merchant_campaign_set).
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Image, Modal, Pressable, ScrollView } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Row, Badge, Button, Input, CircleButton, Chip, toast } from '@/components/ui';
import { PressableScale, ProgressBar } from '@/components/motion';
import { useAuth } from '@/store/auth';
import { colors, font, radius, shadow } from '@/lib/theme';
import { rupiah, formatDate, km } from '@/lib/format';
import {
  campaignStatusOf, campaignActions, campaignActionLabel, campaignSet, confirmAsync, ctrText, roasText, numberId, parseAmount, placementLabel,
  type Campaign, type CampaignAction,
} from '@/lib/mitra';

/** Kartu seperti yang dilihat pelanggan: blok "Sponsored" terpisah dari hasil organik (§7). */
export function SponsoredPreview({ merchantName, fallbackImage, headline, imageUrl, cta, label, radiusKm }: {
  merchantName: string; fallbackImage?: string | null; headline?: string | null; imageUrl?: string | null; cta?: string | null; label?: string | null; radiusKm?: number | null;
}) {
  const img = imageUrl || fallbackImage || null;
  return (
    <View style={{ gap: 6 }}>
      <Text style={font.label}>Pratinjau di aplikasi pelanggan</Text>
      <View style={p.block}>
        <Text style={[font.tiny, { fontWeight: '700', color: colors.textSecondary }]}>{label || 'Sponsored'}</Text>
        <View style={p.card}>
          {img ? <Image source={{ uri: img }} style={p.img} /> : <View style={[p.img, { alignItems: 'center', justifyContent: 'center' }]}><Ionicons name="image-outline" size={28} color={colors.textMuted} /></View>}
          <View style={p.tag}><Text style={p.tagText}>{label || 'Sponsored'}</Text></View>
          <View style={{ padding: 12, gap: 4 }}>
            <Text style={[font.body, { fontWeight: '700' }]} numberOfLines={1}>{merchantName}</Text>
            <Text style={font.small} numberOfLines={2}>{headline?.trim() || 'Judul iklan Anda tampil di sini'}</Text>
            <Row between style={{ marginTop: 6 }}>
              <Text style={font.tiny}>{radiusKm ? `dalam ${km(radiusKm)}` : ''}</Text>
              <View style={p.cta}><Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>{cta?.trim() || 'Pesan sekarang'}</Text></View>
            </Row>
          </View>
        </View>
      </View>
      <Text style={font.tiny}>Iklan selalu berlabel “{label || 'Sponsored'}” dan ditaruh di blok tersendiri — urutan hasil organik tidak berubah.</Text>
    </View>
  );
}

export function BudgetBar({ budget, spent }: { budget: number; spent: number }) {
  const left = Math.max(0, budget - spent);
  return (
    <View style={{ gap: 4 }}>
      <ProgressBar progress={budget > 0 ? Math.min(1, spent / budget) : 0} color={spent >= budget && budget > 0 ? colors.danger : colors.food} />
      <Row between>
        <Text style={font.tiny}>Terpakai {rupiah(spent)} dari {rupiah(budget)}</Text>
        <Text style={[font.tiny, { fontWeight: '700', color: colors.text }]}>Sisa {rupiah(left)}</Text>
      </Row>
    </View>
  );
}

export const campaignCtr = (c: Campaign) => c.ctr ?? (c.impressions ? (c.clicks / c.impressions) * 100 : 0);
export const campaignRoas = (c: Campaign) => c.roas ?? (c.spent ? c.conversion_value / c.spent : null);

export function MetricTiles({ items }: { items: { label: string; value: string }[] }) {
  return (
    <View style={p.tiles}>
      {items.map((m) => (
        <View key={m.label} style={p.tile}>
          <Text style={font.tiny} numberOfLines={1}>{m.label}</Text>
          <Text style={[font.body, { fontWeight: '700' }]} numberOfLines={1}>{m.value}</Text>
        </View>
      ))}
    </View>
  );
}

/** Aksi kampanye + lembar tambah budget. `onChanged` dipanggil setelah server menerima perubahan. */
export function CampaignActions({ c, onChanged, size = 'sm' }: { c: Campaign; onChanged: () => void; size?: 'sm' | 'md' }) {
  const [topup, setTopup] = useState(false);
  const refreshWallet = useAuth((s) => s.refreshWallet);
  const actions = campaignActions(c.status, c.paused_by);
  if (!actions.length) return null;
  const left = Math.max(0, c.budget - c.spent);
  const run = async (a: CampaignAction) => {
    if (a === 'topup') { setTopup(true); return; }
    const msg = a === 'stop'
      ? `Kampanye “${c.name ?? 'tanpa nama'}” dihentikan permanen. Sisa budget ${rupiah(left)} dikembalikan ke saldo pendapatan Anda.`
      : a === 'pause' ? 'Iklan berhenti tayang sementara. Sisa budget tetap tertahan di kampanye dan bisa dilanjutkan kapan saja.'
        : 'Iklan tayang kembali selama periode kampanye masih berlaku dan budget tersisa.';
    if (!(await confirmAsync(`${campaignActionLabel[a]} kampanye?`, msg, campaignActionLabel[a]))) return;
    try {
      await campaignSet(c.id, a);
      toast.success(a === 'stop' ? `Kampanye dihentikan · ${rupiah(left)} kembali ke saldo` : a === 'pause' ? 'Kampanye dijeda' : 'Kampanye dilanjutkan');
      await refreshWallet(); onChanged();
    } catch (e) { toast.error((e as Error).message); }
  };
  return (
    <>
      <Row gap={8} style={{ flexWrap: 'wrap' }}>
        {actions.map((a) => (
          <Button key={a} title={campaignActionLabel[a]} size={size} icon={a === 'pause' ? 'pause' : a === 'resume' ? 'play' : a === 'stop' ? 'stop-circle-outline' : 'add-circle-outline'}
            variant={a === 'stop' ? 'outline' : 'secondary'} color={a === 'stop' ? colors.danger : colors.food} onPress={() => run(a)} />
        ))}
      </Row>
      {c.status === 'paused' && c.paused_by && c.paused_by !== 'merchant' ? <Text style={[font.tiny, { color: colors.warning }]}>Dijeda oleh {c.paused_by === 'admin' ? 'admin' : 'sistem'} — hubungi CS untuk melanjutkan.</Text> : null}
      <TopupSheet visible={topup} campaign={c} onClose={() => setTopup(false)} onDone={async () => { await refreshWallet(); onChanged(); }} />
    </>
  );
}

function TopupSheet({ visible, campaign, onClose, onDone }: { visible: boolean; campaign: Campaign; onClose: () => void; onDone: () => void }) {
  const balance = useAuth((s) => s.wallet?.balance ?? 0);
  const [v, setV] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (visible) setV(''); }, [visible]);
  const amt = parseAmount(v);
  const err = amt <= 0 ? null : amt > balance ? `Saldo pendapatan hanya ${rupiah(balance)}` : null;
  const submit = async () => {
    if (amt <= 0) return toast.error('Isi nominal tambahan budget');
    if (err) return toast.error(err);
    setBusy(true);
    try { await campaignSet(campaign.id, 'topup', amt); toast.success(`Budget ditambah ${rupiah(amt)}`); onDone(); onClose(); }
    catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={p.modalBg}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <Animated.View entering={FadeInDown.springify().stiffness(280).damping(18)} style={p.modal}>
          <View style={p.handle} />
          <ScrollView contentContainerStyle={{ gap: 12 }} keyboardShouldPersistTaps="handled">
            <Row between><Text style={font.h2}>Tambah budget</Text><CircleButton icon="close" onPress={onClose} /></Row>
            <Text style={font.small}>{campaign.name} · sisa {rupiah(Math.max(0, campaign.budget - campaign.spent))}</Text>
            <Input label="Tambahan budget (Rp)" keyboardType="number-pad" value={v} onChangeText={(t) => setV(t.replace(/\D/g, ''))} error={err} />
            <Row gap={8} style={{ flexWrap: 'wrap' }}>{[25000, 50000, 100000].filter((n) => n <= balance).map((n) => <Chip key={n} label={rupiah(n)} active={amt === n} onPress={() => setV(String(n))} color={colors.food} />)}</Row>
            <Text style={font.tiny}>Dipotong dari saldo pendapatan (saldo {rupiah(balance)}). Sisa yang tidak terpakai dikembalikan saat kampanye dihentikan.</Text>
            <Button title={amt > 0 ? `Tambah ${rupiah(amt)}` : 'Tambah budget'} loading={busy} disabled={!!err || amt <= 0} color={colors.food} onPress={submit} />
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

/** Kartu ringkas satu kampanye di daftar. */
export function CampaignCard({ c, onPress, onChanged }: { c: Campaign; onPress: () => void; onChanged: () => void }) {
  const st = campaignStatusOf(c.status);
  return (
    <View style={p.campaign}>
      <PressableScale onPress={onPress} scaleTo={0.99} haptic={false} style={{ gap: 8 }}>
        <Row between style={{ alignItems: 'flex-start' }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[font.body, { fontWeight: '700' }]} numberOfLines={1}>{c.name || c.product_name || c.product_code}</Text>
            <Text style={font.tiny} numberOfLines={1}>{[c.product_name ?? placementLabel[c.product_code] ?? c.product_code, c.starts_at && c.ends_at ? `${formatDate(c.starts_at, false)} – ${formatDate(c.ends_at, false)}` : `dibuat ${formatDate(c.created_at, false)}`].filter(Boolean).join(' · ')}</Text>
          </View>
          <Badge text={st.label} color={st.color} />
        </Row>
        {c.review_note ? <Text style={[font.tiny, { color: c.status === 'rejected' ? colors.danger : colors.textSecondary }]}>Catatan peninjau: {c.review_note}</Text> : null}
        <BudgetBar budget={c.budget} spent={c.spent} />
        <MetricTiles items={[
          { label: 'Impresi', value: numberId(c.impressions) }, { label: 'Klik', value: numberId(c.clicks) }, { label: 'CTR', value: ctrText(campaignCtr(c)) },
          { label: 'Transaksi', value: numberId(c.conversions) }, { label: 'ROAS', value: roasText(campaignRoas(c)) },
        ]} />
        <Row gap={4}><Text style={[font.tiny, { color: colors.food, fontWeight: '700' }]}>Lihat laporan harian</Text><Ionicons name="chevron-forward" size={14} color={colors.food} /></Row>
      </PressableScale>
      <CampaignActions c={c} onChanged={onChanged} />
    </View>
  );
}

const p = StyleSheet.create({
  block: { gap: 6, padding: 12, borderRadius: radius.lg, backgroundColor: colors.bgSoft, borderWidth: 1, borderColor: colors.border },
  card: { borderRadius: radius.md, backgroundColor: '#fff', overflow: 'hidden', borderWidth: 1, borderColor: colors.border, ...shadow.soft },
  img: { width: '100%', height: 140, backgroundColor: colors.bgSoft },
  tag: { position: 'absolute', top: 8, left: 8, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.full, backgroundColor: 'rgba(16,31,33,0.72)' },
  tagText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  cta: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.full, backgroundColor: colors.food },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tile: { flexGrow: 1, minWidth: 88, padding: 8, borderRadius: radius.sm, backgroundColor: colors.bgSoft },
  campaign: { gap: 10, padding: 14, borderRadius: radius.lg, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, ...shadow.soft },
  modalBg: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  modal: { backgroundColor: '#fff', borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: 20, paddingBottom: 32, maxHeight: '92%', width: '100%', maxWidth: 640, alignSelf: 'center', overflow: 'hidden', ...shadow.sheet },
  handle: { width: 44, height: 5, borderRadius: 3, backgroundColor: colors.border, alignSelf: 'center', marginBottom: 12 },
});
