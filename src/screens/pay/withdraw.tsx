import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { WALLET_UI } from '@/lib/features';
import { FeatureUnavailable } from '@/components/FeatureUnavailable';
import { useRouter } from 'expo-router';
import { Screen, Card, Input, Button, Row, Badge, toast } from '@/components/ui';
import { Entrance } from '@/components/motion';
import { useAuth } from '@/store/auth';
import { useAntarVoucher, ANTARVOUCHER_OFF_TEXT } from '@/hooks/useAppSettings';
import { AntarVoucherOffBanner } from '@/components/AntarVoucherNotice';
import { rpc, supabase } from '@/lib/supabase';
import { colors, font, radius } from '@/lib/theme';
import { rupiah, formatDate } from '@/lib/format';

// v5-mitra (KONTRAK-V5 §3 request_withdrawal / §4): SLA pencairan ≤ 24 jam, status antrean & batch.
// Dibaca dari tabel `withdrawal_requests` milik sendiri (RLS SELECT); kolom `sla_due_at`/`batch_id` baru di 0114 → bisa null/tidak ada.
type MyWithdrawalRow = {
  id: string; amount: number; status: string; created_at: string; review_note?: string | null;
  sla_due_at?: string | null; batch_id?: string | null; settled_at?: string | null;
};
const WD_STATUS: Record<string, { label: string; color: string }> = {
  pending: { label: 'Menunggu persetujuan', color: colors.warning },
  approved: { label: 'Disetujui · menunggu batch transfer', color: colors.info },
  batch: { label: 'Dalam batch transfer', color: colors.info },
  settled: { label: 'Sudah ditransfer', color: colors.success },
  rejected: { label: 'Ditolak · saldo dikembalikan', color: colors.danger },
};
// status kolom = enum topup_status (pending/approved/rejected); 'settled' = approved + settled_at (0102), 'batch' = approved + batch_id (0114).
const wdStatusOf = (w: MyWithdrawalRow) => (w.status === 'settled' || (w.status === 'approved' && w.settled_at) ? 'settled' : w.status === 'approved' && w.batch_id ? 'batch' : w.status);
const slaText = (w: MyWithdrawalRow) => {
  if (!w.sla_due_at) return 'diproses ≤ 24 jam';
  const left = new Date(w.sla_due_at).getTime() - Date.now();
  if (left <= 0) return `batas SLA ${formatDate(w.sla_due_at)} terlewat — hubungi CS bila belum masuk`;
  const h = Math.floor(left / 3600000), m = Math.floor((left % 3600000) / 60000);
  return `batas SLA ${formatDate(w.sla_due_at)} (${h > 0 ? `${h} jam ` : ''}${m} mnt lagi)`;
};

/** v5-mitra: daftar permintaan pencairan milik sendiri + SLA & status batch. */
function MyWithdrawalsCard({ uid, refreshKey }: { uid?: string; refreshKey: number }) {
  const [rows, setRows] = useState<MyWithdrawalRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!uid) return;
    const { data, error } = await supabase.from('withdrawal_requests').select('*').eq('user_id', uid).order('created_at', { ascending: false }).limit(10);
    if (error) { setErr(error.message); setRows([]); return; }
    setErr(null); setRows((data as MyWithdrawalRow[]) ?? []);
  }, [uid]);
  useEffect(() => { void load(); }, [load, refreshKey]);
  return (
    <Card style={{ gap: 8 }}>
      <Row between><Text style={font.h3}>Permintaan pencairan</Text><Button title="Muat ulang" size="sm" variant="ghost" icon="refresh" onPress={load} /></Row>
      <Text style={font.tiny}>Pencairan by request, diproses ≤ 24 jam (SLA). Transfer dilakukan per batch pada jam cutoff; bila gagal, saldo dikembalikan otomatis.</Text>
      {err ? <Text style={[font.tiny, { color: colors.danger }]}>Daftar belum bisa dimuat: {err}</Text> : null}
      {rows == null ? <Text style={font.tiny}>Memuat…</Text> : rows.length === 0 ? <Text style={font.small}>Belum ada permintaan pencairan.</Text> : rows.map((w) => {
        const key = wdStatusOf(w);
        const open = key === 'pending' || key === 'approved' || key === 'batch';
        const st = WD_STATUS[key] ?? { label: w.status, color: colors.textMuted };
        return (
          <View key={w.id} style={wd.row}>
            <Row between style={{ alignItems: 'flex-start' }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontWeight: '700', color: colors.text }}>{rupiah(w.amount)}</Text>
                <Text style={font.tiny}>{formatDate(w.created_at)}{w.batch_id ? ` · batch ${w.batch_id.slice(0, 8)}` : ''}</Text>
              </View>
              <Badge text={st.label} color={st.color} />
            </Row>
            {open ? <Text style={[font.tiny, { marginTop: 4 }]}>{slaText(w)}</Text> : null}
            {key === 'settled' && w.settled_at ? <Text style={[font.tiny, { marginTop: 4 }]}>Ditransfer {formatDate(w.settled_at)}</Text> : null}
            {w.status === 'rejected' && w.review_note ? <Text style={[font.tiny, { marginTop: 4, color: colors.text }]}>Alasan: {w.review_note}</Text> : null}
          </View>
        );
      })}
    </Card>
  );
}
const wd = StyleSheet.create({
  row: { padding: 10, borderRadius: radius.md, backgroundColor: colors.bgSoft, borderWidth: 1, borderColor: colors.border },
  ok: { padding: 12, borderRadius: radius.md, backgroundColor: colors.success + '14', borderWidth: 1, borderColor: colors.success + '55', gap: 4 },
});
// akhir v5-mitra (deklarasi)

function WithdrawScreen() {
  const router = useRouter();
  const { wallet, refreshWallet, session } = useAuth();
  const [f, setF] = useState({ amount: '', bank: '', account: '', name: '' });
  // v5-mitra: busy-state tombol (temuan G-15) + hasil permintaan terakhir (sla_due_at) + pemicu muat ulang daftar
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<MyWithdrawalRow | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const set = (k: keyof typeof f) => (v: string) => setF((p) => ({ ...p, [k]: v }));
  const { enabled: antarpayOn } = useAntarVoucher();   // 0088: pencairan ditolak server saat nonaktif

  const submit = async () => {
    if (!antarpayOn) return toast.error(ANTARVOUCHER_OFF_TEXT);
    const n = Number(f.amount.replace(/\D/g, ''));
    if (n < 20000) return toast.error('Minimal penarikan Rp20.000');
    if (n > (wallet?.balance ?? 0)) return toast.error('Saldo tidak cukup');
    if (!f.bank || !f.account || !f.name) return toast.error('Lengkapi data rekening');
    // v5-mitra: kunci tombol selama RPC berjalan; setelah sukses tampilkan sla_due_at (bukan langsung kembali)
    if (busy) return;
    setBusy(true);
    try {
      const res = await rpc<MyWithdrawalRow | MyWithdrawalRow[] | null>('request_withdrawal', { p_amount: n, p_bank: f.bank, p_account: f.account, p_name: f.name });
      await refreshWallet();
      let row: MyWithdrawalRow | null = Array.isArray(res) ? res[0] ?? null : (res && typeof res === 'object' && 'id' in res ? res : null);
      if (!row?.sla_due_at && session?.user.id) {
        const { data } = await supabase.from('withdrawal_requests').select('*').eq('user_id', session.user.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
        if (data) row = data as MyWithdrawalRow;
      }
      setLast(row ?? { id: '', amount: n, status: 'pending', created_at: new Date().toISOString() });
      setRefreshKey((k) => k + 1);
      setF((p) => ({ ...p, amount: '' }));
      toast.success('Permintaan penarikan dikirim — diproses ≤ 24 jam (SLA)');
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <Screen title="Tarik Saldo" back footer={<Button title={antarpayOn ? 'Ajukan Penarikan' : 'Pencairan sementara nonaktif'} size="lg" loading={busy} disabled={!antarpayOn || busy} onPress={submit} />}>
      <View style={{ gap: 16 }}>
        {/* v5-mitra: hasil permintaan terakhir + SLA */}
        {last ? (
          <Entrance index={0}>
            <View style={wd.ok}>
              <Text style={[font.body, { fontWeight: '700', color: colors.text }]}>Permintaan {rupiah(last.amount)} diterima</Text>
              <Text style={font.small}>Pencairan diproses ≤ 24 jam (SLA){last.sla_due_at ? ` — paling lambat ${formatDate(last.sla_due_at)}` : ''}. Status bisa dipantau di daftar bawah.</Text>
              <Button title="Kembali" size="sm" variant="ghost" onPress={() => router.back()} />
            </View>
          </Entrance>
        ) : null}
        {!antarpayOn && <Entrance index={0}><AntarVoucherOffBanner text="Pencairan saldo belum tersedia sampai AntarVoucher diaktifkan admin. Saldo Anda tetap tersimpan dan pendapatan order tetap masuk." /></Entrance>}
        <Entrance index={0}>
          <Card>
            <Text style={font.tiny}>Saldo tersedia</Text>
            <Text style={font.h1}>{rupiah(wallet?.balance ?? 0)}</Text>
          </Card>
        </Entrance>
        <Entrance index={1}>
          <Card style={{ gap: 12 }}>
            <Input label="Nominal (min. Rp20.000)" keyboardType="number-pad" value={f.amount} onChangeText={(v) => set('amount')(v.replace(/\D/g, ''))} icon="cash-outline" />
            <Input label="Bank" placeholder="BCA / BRI / Mandiri / BNI" value={f.bank} onChangeText={set('bank')} icon="business-outline" />
            <Input label="Nomor rekening" keyboardType="number-pad" value={f.account} onChangeText={set('account')} icon="card-outline" />
            <Input label="Nama pemilik rekening" value={f.name} onChangeText={set('name')} icon="person-outline" />
            <Text style={font.tiny}>Saldo langsung ditahan saat pengajuan. Jika ditolak, saldo dikembalikan otomatis. Diproses ≤ 24 jam (SLA), tanpa biaya payment gateway.</Text>
          </Card>
        </Entrance>
        {/* v5-mitra: daftar permintaan + status pending/approved/batch/settled/rejected */}
        <Entrance index={2}><MyWithdrawalsCard uid={session?.user.id} refreshKey={refreshKey} /></Entrance>
      </View>
    </Screen>
  );
}

/** Build Google Play tanpa dompet (EXPO_PUBLIC_WALLET_UI=off) → rute ini diganti layar informasi. */
export default function Withdraw() {
  if (!WALLET_UI) return <FeatureUnavailable title="Tarik Saldo" text="Fitur saldo belum tersedia di aplikasi versi Play Store. Pembayaran tunai dan pembayaran langsung per pesanan tetap bisa dipakai." />;
  return <WithdrawScreen />;
}
