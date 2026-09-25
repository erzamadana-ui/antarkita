import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, RefreshControl, ScrollView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { LinearTransition } from 'react-native-reanimated';
import { Card, Empty, Row, IconCircle, Badge } from '@/components/ui';
import { BrandGradient } from '@/components/glass';
import { AnimatedNumber, Entrance, PressableScale, Skeleton } from '@/components/motion';
import { useAuth } from '@/store/auth';
import { useAntarVoucher } from '@/hooks/useAppSettings';
import { AntarVoucherOffBanner } from '@/components/AntarVoucherNotice';
import { supabase } from '@/lib/supabase';
import { colors, font, radius, shadow } from '@/lib/theme';
import { rupiah, formatDate } from '@/lib/format';
import { loadMyWithdrawals, payoutOf, payoutMeta, type MyWithdrawal } from '@/lib/mitra';
import { fetchWalletStatement, type WalletStatement } from '@/lib/voucher';
import type { WalletTx, TopupRequest } from '@/lib/types';

const txMeta: Record<WalletTx['type'], { label: string; icon: string; color: string }> = {
  topup: { label: 'Top up', icon: 'arrow-down-circle', color: colors.success },
  payment: { label: 'Pembayaran', icon: 'cart', color: colors.danger },
  earning: { label: 'Pendapatan', icon: 'cash', color: colors.success },
  refund: { label: 'Refund', icon: 'refresh-circle', color: colors.info },
  withdrawal: { label: 'Penarikan', icon: 'arrow-up-circle', color: colors.warning },
  fee: { label: 'Potongan platform', icon: 'remove-circle', color: colors.danger },
  adjustment: { label: 'Penyesuaian', icon: 'construct', color: colors.textSecondary },
};

/** Tampilan dompet yang dipakai customer & driver/merchant. */
export function WalletView({ allowWithdraw, bottomSpace = 40, header }: { allowWithdraw?: boolean; bottomSpace?: number; /** Konten di atas kartu saldo, ikut tergulir (mis. ringkasan & rincian pendapatan driver). */ header?: React.ReactNode }) {
  const router = useRouter();
  const { wallet, refreshWallet, session } = useAuth();
  const [txs, setTxs] = useState<WalletTx[]>([]);
  const [pending, setPending] = useState<TopupRequest[]>([]);
  // Mitra (allowWithdraw): penarikan dari my_withdrawals() (Finpay v3 §8) — status payout, referensi transfer, biaya, alasan gagal.
  const [withdrawals, setWithdrawals] = useState<MyWithdrawal[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [showAllWd, setShowAllWd] = useState(false);
  const uid = session?.user.id;
  // 0088: saat AntarVoucher nonaktif, saldo & riwayat tetap terlihat; tombol Top Up / Tarik Saldo disembunyikan (server pun menolak).
  const { enabled: antarpayOn } = useAntarVoucher();

  const load = useCallback(async () => {
    if (!uid) return;
    const [{ data: t }, { data: tp }, wd] = await Promise.all([
      supabase.from('wallet_transactions').select('*').eq('user_id', uid).order('created_at', { ascending: false }).limit(50),
      supabase.from('topup_requests').select('*').eq('user_id', uid).eq('status', 'pending'),
      allowWithdraw ? loadMyWithdrawals(uid) : Promise.resolve({ rows: [] as MyWithdrawal[], v3: false }),
    ]);
    setTxs((t as WalletTx[]) ?? []);
    setPending((tp as TopupRequest[]) ?? []);
    setWithdrawals(wd.rows);
    setLoaded(true);
    await refreshWallet();
  }, [uid, refreshWallet, allowWithdraw]);
  useEffect(() => { load(); }, [load]);

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: bottomSpace, maxWidth: 720, width: '100%', alignSelf: 'center' }} showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
      {header}
      <Entrance index={0} from="zoom">
        <BrandGradient colors={[colors.primary, colors.primaryDark]} style={[s.balance, shadow.glow(colors.primary)]}>
          <View style={s.orb} /><View style={[s.orb, { right: -60, top: 30, width: 160, height: 160, opacity: 0.12 }]} />
          <Row between>
            <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 14, fontWeight: '600' }}>Saldo AntarVoucher</Text>
            <Ionicons name="wallet" size={20} color="rgba(255,255,255,0.8)" />
          </Row>
          <AnimatedNumber value={wallet?.balance ?? 0} format={rupiah} style={{ color: '#fff', fontSize: 30, fontWeight: '700', marginVertical: 8, letterSpacing: -0.5 }} />
          {antarpayOn ? (
            <Row gap={10} style={{ marginTop: 8 }}>
              <WalletAction icon="add" label="Top Up" onPress={() => router.push('/pay/topup')} />
              {allowWithdraw && <WalletAction icon="arrow-up" label="Tarik Saldo" onPress={() => router.push('/pay/withdraw')} />}
            </Row>
          ) : null}
        </BrandGradient>
      </Entrance>

      {!antarpayOn && (
        <Entrance index={1}><AntarVoucherOffBanner style={{ marginTop: 16 }} text={allowWithdraw
          ? 'Top up dan pencairan saldo belum tersedia. Pendapatan dari order tetap masuk ke saldo Anda dan bisa dicairkan setelah AntarVoucher diaktifkan kembali.'
          : 'Top up dan bayar dengan AntarVoucher/e-wallet belum tersedia — silakan bayar tunai. Saldo yang sudah ada tetap tersimpan; refund otomatis tetap berjalan.'} /></Entrance>
      )}

      {pending.length > 0 && (
        <Entrance index={1}><Card style={{ marginTop: 16, backgroundColor: 'rgba(245,158,11,0.12)', borderColor: 'rgba(245,158,11,0.3)' }}>
          <Row gap={8}><Ionicons name="time" size={16} color={colors.warning} /><Text style={{ fontWeight: '700', color: colors.warning, flexShrink: 1 }}>Top up lama · menunggu verifikasi admin</Text></Row>
          <Text style={[font.tiny, { marginTop: 4 }]}>Permintaan dari alur transfer manual sebelumnya. Untuk isi saldo baru, gunakan top up instan atau transfer ke rekening resmi.</Text>
          {pending.map((p) => (
            <Row key={p.id} between style={{ marginTop: 6 }}>
              <Text style={[font.small, { flexShrink: 1 }]}>{'bank_name' in p ? 'Penarikan' : 'Top up lama'} · {formatDate(p.created_at)}</Text>
              <Text style={{ fontWeight: '700' }}>{rupiah(p.amount)}</Text>
            </Row>
          ))}
        </Card></Entrance>
      )}

      {uid ? <ReconcileCard uid={uid} reloadKey={txs.length ? txs[0].id : ''} /> : null}

      {allowWithdraw && withdrawals.length > 0 && (
        <Entrance index={2}>
          <Text style={[font.label, { marginTop: 20, marginBottom: 8 }]}>Penarikan ke rekening</Text>
          <Card padded={false}>
            {withdrawals.slice(0, showAllWd ? undefined : 5).map((w, i) => <WithdrawalRow key={w.id} w={w} first={i === 0} />)}
            {withdrawals.length > 5 ? <PressableScale onPress={() => setShowAllWd((v) => !v)} haptic={false} style={{ padding: 12, alignItems: 'center', borderTopWidth: 1, borderTopColor: 'rgba(11,31,42,0.07)' }}><Text style={{ color: colors.primary, fontWeight: '700' }}>{showAllWd ? 'Tampilkan lebih sedikit' : `Lihat semua (${withdrawals.length})`}</Text></PressableScale> : null}
          </Card>
        </Entrance>
      )}

      <Entrance index={2}><Text style={[font.label, { marginTop: 20, marginBottom: 8 }]}>Riwayat transaksi</Text></Entrance>
      {!loaded ? (
        <Card padded={false}>{[0, 1, 2].map((i) => <Row key={i} gap={12} style={{ padding: 14 }}><Skeleton width={38} height={38} radius={19} /><View style={{ flex: 1, gap: 6 }}><Skeleton width="60%" height={14} /><Skeleton width="35%" height={11} /></View><Skeleton width={70} height={14} /></Row>)}</Card>
      ) : txs.length === 0 ? <Empty icon="wallet-outline" title="Belum ada transaksi" /> : (
        <Entrance index={3}><Card padded={false}>
          {txs.map((t, i) => {
            // Cadangan wajib: satu nilai enum baru di database (mis. 'tip') tanpa ini akan melempar
            // TypeError dan membuat SELURUH layar AntarVoucher gagal dirender.
            const m = txMeta[t.type] ?? txMeta.adjustment;
            return (
              <Animated.View key={t.id} layout={LinearTransition}>
                <Row gap={12} style={{ padding: 14, borderTopWidth: i ? 1 : 0, borderTopColor: 'rgba(11,31,42,0.07)' }}>
                  <IconCircle name={m.icon as never} color={m.color} size={38} />
                  {/* Dua baris lebar penuh (keterangan ↔ nominal, tanggal ↔ saldo). Dulu kolom kanan "Saldo Rp…" memakan
                      lebar sehingga di 320 px keterangan terpotong jadi "AntarVouche…" dan tanggal patah 2 baris. */}
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <Row between style={{ gap: 8, alignItems: 'flex-start' }}>
                      <Text style={{ fontWeight: '600', color: colors.text, flexShrink: 1 }} numberOfLines={2}>{t.note ?? m.label}</Text>
                      <Text style={{ fontWeight: '700', color: t.amount >= 0 ? colors.success : colors.text, flexShrink: 0 }}>{t.amount >= 0 ? '+' : '-'}{rupiah(Math.abs(t.amount))}</Text>
                    </Row>
                    <Row between style={{ columnGap: 8, rowGap: 0, flexWrap: 'wrap' }}>
                      <Text style={font.tiny}>{formatDate(t.created_at)}</Text>
                      <Text style={font.tiny}>Saldo {rupiah(t.balance_after)}</Text>
                    </Row>
                  </View>
                </Row>
              </Animated.View>
            );
          })}
        </Card></Entrance>
      )}
      <View style={{ marginTop: 16 }}>
        <Badge text="Isi saldo lewat top up instan atau transfer ke rekening resmi PT Antar Kita Indonesia" color={colors.textSecondary} />
      </View>
    </ScrollView>
  );
}

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const signed = (n: number, sign: '+' | '−' | '±') => `${sign === '±' ? (n < 0 ? '−' : '+') : sign}${rupiah(Math.abs(n))}`;

/**
 * Rekonsiliasi saldo bulan berjalan (0112 `wallet_statement`): saldo awal + pembelian + pendapatan + refund masuk
 * − penggunaan − refund keluar − payout ± koreksi = saldo akhir. Disembunyikan bila RPC belum ada (backend lama) / gagal.
 */
function ReconcileCard({ uid, reloadKey }: { uid: string; reloadKey: string }) {
  const [st, setSt] = useState<WalletStatement | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    const now = new Date();
    fetchWalletStatement(uid, ymd(new Date(now.getFullYear(), now.getMonth(), 1)), ymd(now))
      .then((r) => { if (alive) setSt(r && typeof r === 'object' && 'selisih' in r ? r : null); }, () => { if (alive) setSt(null); });
    return () => { alive = false; };
  }, [uid, reloadKey]);
  if (!st) return null;
  const n = (v: unknown) => Number(v ?? 0) || 0;
  const diff = n(st.selisih);
  const ok = diff === 0;
  const lines: [string, string][] = [
    ['Saldo awal bulan', rupiah(n(st.saldo_awal))],
    ['Pembelian / top up', signed(n(st.pembelian), '+')],
    ['Pendapatan', signed(n(st.pendapatan), '+')],
    ['Refund masuk', signed(n(st.refund_masuk), '+')],
    ['Penggunaan', signed(n(st.penggunaan), '−')],
    ['Refund keluar', signed(n(st.refund_keluar), '−')],
    ['Pencairan (payout)', signed(n(st.payout), '−')],
    ['Koreksi & potongan', signed(n(st.koreksi), '±')],
    ...(n(st.lain) ? [['Lainnya', signed(n(st.lain), '±')] as [string, string]] : []),
  ];
  return (
    <Entrance index={1}>
      <Card style={{ marginTop: 16 }} padded={false}>
        <PressableScale onPress={() => setOpen((v) => !v)} haptic={false} scaleTo={0.99} accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel="Rekonsiliasi saldo bulan ini"
          style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, paddingHorizontal: 14, paddingVertical: 10 }}>
          <Ionicons name={ok ? 'shield-checkmark' : 'warning'} size={20} color={ok ? colors.success : colors.warning} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontWeight: '700', color: colors.text, fontSize: 14 }}>Rekonsiliasi saldo bulan ini</Text>
            <Text style={[font.tiny, { color: ok ? colors.success : colors.warning }]}>{ok ? 'Selisih Rp0 ✓ — saldo sesuai catatan' : `Selisih ${rupiah(diff)} — perlu dicek`}</Text>
          </View>
          <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={20} color={colors.textMuted} />
        </PressableScale>
        {open ? (
          <View style={{ paddingHorizontal: 14, paddingBottom: 14, gap: 6, borderTopWidth: 1, borderTopColor: 'rgba(11,31,42,0.07)', paddingTop: 10 }}>
            {lines.map(([k, v]) => (
              <Row key={k} between style={{ gap: 8 }}>
                <Text style={[font.small, { flexShrink: 1 }]}>{k}</Text>
                <Text style={{ fontWeight: '600', color: colors.text, fontSize: 14 }}>{v}</Text>
              </Row>
            ))}
            <View style={{ height: 1, backgroundColor: 'rgba(11,31,42,0.1)', marginVertical: 4 }} />
            <Row between style={{ gap: 8 }}>
              <Text style={[font.small, { flexShrink: 1, color: colors.text, fontWeight: '600' }]}>Saldo akhir (hitungan)</Text>
              <Text style={{ fontWeight: '700', color: colors.text, fontSize: 14 }}>{rupiah(n(st.saldo_akhir_hitung))}</Text>
            </Row>
            <Row between style={{ gap: 8 }}>
              <Text style={[font.small, { flexShrink: 1 }]}>Saldo akhir (catatan)</Text>
              <Text style={{ fontWeight: '700', color: colors.text, fontSize: 14 }}>{rupiah(n(st.saldo_akhir_ledger))}</Text>
            </Row>
            <Row between style={{ gap: 8 }}>
              <Text style={[font.small, { flexShrink: 1 }]}>Selisih</Text>
              <Text style={{ fontWeight: '700', color: ok ? colors.success : colors.danger, fontSize: 14 }}>{ok ? 'Rp0 ✓' : rupiah(diff)}</Text>
            </Row>
            {st.rumus ? <Text style={[font.tiny, { marginTop: 4 }]}>Rumus: {st.rumus}</Text> : null}
            {!ok ? <Text style={[font.tiny, { color: colors.danger, marginTop: 2 }]}>Ada selisih antara catatan saldo dan hitungan. Hubungi CS AntarKita (menu Bantuan) agar tim Finance memeriksanya — saldo Anda tetap aman.</Text> : null}
          </View>
        ) : null}
      </Card>
    </Entrance>
  );
}

/** Satu penarikan: nominal, biaya, rekening, status payout, referensi transfer, waktu cair / alasan gagal. */
function WithdrawalRow({ w, first }: { w: MyWithdrawal; first: boolean }) {
  const st = payoutOf(w);
  const meta = payoutMeta[st];
  const fee = Number(w.fee ?? 0);
  const failed = st === 'PAYOUT_FAILED';
  return (
    <View style={{ padding: 14, gap: 4, borderTopWidth: first ? 0 : 1, borderTopColor: 'rgba(11,31,42,0.07)' }}>
      <Row between style={{ alignItems: 'flex-start' }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontWeight: '700', color: colors.text }}>{rupiah(w.amount)}</Text>
          <Text style={font.tiny} numberOfLines={1}>{[w.bank_name, w.bank_account ? `••${String(w.bank_account).slice(-4)}` : null, w.account_name].filter(Boolean).join(' · ')}</Text>
        </View>
        <Badge text={meta.label} color={meta.color} />
      </Row>
      {fee > 0 ? <Text style={font.tiny}>Biaya transfer {rupiah(fee)} · diterima {rupiah(Math.max(0, w.amount - fee))}</Text> : null}
      <Text style={font.tiny}>Diajukan {formatDate(w.created_at)}{w.settled_at ? ` · cair ${formatDate(w.settled_at)}` : ''}{w.provider ? ` · via ${w.provider === 'finpay' ? 'Finpay' : w.provider === 'manual' ? 'transfer manual' : w.provider}` : ''}</Text>
      {w.provider_ref ? <Text style={font.tiny} selectable>Ref. transfer: {w.provider_ref}</Text> : null}
      {failed && (w.failed_reason || w.review_note) ? <Text style={[font.tiny, { color: colors.danger }]}>Alasan: {w.failed_reason ?? w.review_note}</Text> : null}
      {failed ? <Text style={font.tiny}>Nominal penarikan sudah dikembalikan ke saldo AntarVoucher Anda.</Text> : null}
    </View>
  );
}

function WalletAction({ icon, label, onPress }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; onPress: () => void }) {
  return (
    <PressableScale onPress={onPress} scaleTo={0.95} style={s.action}>
      <Ionicons name={icon} size={20} color="#fff" />
      <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>{label}</Text>
    </PressableScale>
  );
}

const s = StyleSheet.create({
  balance: { borderRadius: radius.xxl, padding: 20, overflow: 'hidden' },
  orb: { position: 'absolute', right: -30, top: -50, width: 200, height: 200, borderRadius: 100, backgroundColor: '#fff', opacity: 0.08 },
  action: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.18)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)', borderRadius: radius.md, paddingVertical: 12 },
});
