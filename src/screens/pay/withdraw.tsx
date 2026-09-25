import React, { useState } from 'react';
import { View, Text } from 'react-native';
import { WALLET_UI } from '@/lib/features';
import { FeatureUnavailable } from '@/components/FeatureUnavailable';
import { useRouter } from 'expo-router';
import { Screen, Card, Input, Button, toast } from '@/components/ui';
import { Entrance } from '@/components/motion';
import { useAuth } from '@/store/auth';
import { useAntarVoucher, ANTARVOUCHER_OFF_TEXT } from '@/hooks/useAppSettings';
import { AntarVoucherOffBanner } from '@/components/AntarVoucherNotice';
import { rpc } from '@/lib/supabase';
import { font } from '@/lib/theme';
import { rupiah } from '@/lib/format';

function WithdrawScreen() {
  const router = useRouter();
  const { wallet, refreshWallet } = useAuth();
  const [f, setF] = useState({ amount: '', bank: '', account: '', name: '' });
  const set = (k: keyof typeof f) => (v: string) => setF((p) => ({ ...p, [k]: v }));
  const { enabled: antarpayOn } = useAntarVoucher();   // 0088: pencairan ditolak server saat nonaktif

  const submit = async () => {
    if (!antarpayOn) return toast.error(ANTARVOUCHER_OFF_TEXT);
    const n = Number(f.amount.replace(/\D/g, ''));
    if (n < 20000) return toast.error('Minimal penarikan Rp20.000');
    if (n > (wallet?.balance ?? 0)) return toast.error('Saldo tidak cukup');
    if (!f.bank || !f.account || !f.name) return toast.error('Lengkapi data rekening');
    try {
      await rpc('request_withdrawal', { p_amount: n, p_bank: f.bank, p_account: f.account, p_name: f.name });
      await refreshWallet();
      toast.success('Permintaan penarikan dikirim, diproses admin 1×24 jam');
      router.back();
    } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <Screen title="Tarik Saldo" back footer={<Button title={antarpayOn ? 'Ajukan Penarikan' : 'Pencairan sementara nonaktif'} size="lg" disabled={!antarpayOn} onPress={submit} />}>
      <View style={{ gap: 16 }}>
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
            <Text style={font.tiny}>Saldo langsung ditahan saat pengajuan. Jika ditolak, saldo dikembalikan otomatis.</Text>
          </Card>
        </Entrance>
      </View>
    </Screen>
  );
}

/** Build Google Play tanpa dompet (EXPO_PUBLIC_WALLET_UI=off) → rute ini diganti layar informasi. */
export default function Withdraw() {
  if (!WALLET_UI) return <FeatureUnavailable title="Tarik Saldo" text="Fitur saldo belum tersedia di aplikasi versi Play Store. Pembayaran tunai dan pembayaran langsung per pesanan tetap bisa dipakai." />;
  return <WithdrawScreen />;
}
