import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Image } from 'react-native';
import { useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Screen, Card, Row, Input, Button, toast, Chip } from '@/components/ui';
import { Entrance } from '@/components/motion';
import { useAuth } from '@/store/auth';
import { rpc, supabase } from '@/lib/supabase';
import { pickAndUpload } from '@/lib/upload';
import { colors, font, radius } from '@/lib/theme';
import { rupiah } from '@/lib/format';

const PRESETS = [20000, 50000, 100000, 200000, 500000];

export default function TopUp() {
  const router = useRouter();
  const uid = useAuth((s) => s.session?.user.id);
  const [amount, setAmount] = useState('50000');
  const [bank, setBank] = useState<{ bank: string; number: string; name: string } | null>(null);
  const [proof, setProof] = useState<{ path: string; uri?: string } | null>(null);
  const [note, setNote] = useState('');

  useEffect(() => { supabase.from('app_settings').select('value').eq('key', 'bank_account').maybeSingle().then(({ data }) => setBank((data?.value as typeof bank) ?? null)); }, []);

  const upload = async () => {
    if (!uid) return;
    try { const r = await pickAndUpload('proofs', uid); if (r) { setProof({ path: r.path }); toast.success('Bukti transfer terunggah'); } }
    catch (e) { toast.error((e as Error).message); }
  };
  const submit = async () => {
    const n = Number(amount.replace(/\D/g, ''));
    if (n < 10000) return toast.error('Minimal top up Rp10.000');
    try {
      await rpc('request_topup', { p_amount: n, p_method: 'bank_transfer', p_proof_url: proof?.path ?? null, p_note: note || null });
      toast.success('Permintaan top up dikirim, tunggu verifikasi admin');
      router.back();
    } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <Screen title="Top Up AntarPay" back footer={<Button title={`Kirim Permintaan Top Up ${rupiah(Number(amount.replace(/\D/g, '')) || 0)}`} size="lg" onPress={submit} />}>
      <View style={{ gap: 16 }}>
        <Entrance index={0}>
          <Pressable onPress={() => router.push({ pathname: '/pay/gateway', params: { amount: amount || '50000' } } as never)} style={s.gw}>
            <View style={s.gwIcon}><Ionicons name="flash" size={20} color="#fff" /></View>
            <View style={{ flex: 1 }}><Text style={{ fontWeight: '800', color: colors.text }}>Top up instan — GoPay, OVO, DANA, ShopeePay, QRIS, VA</Text><Text style={font.tiny}>Saldo langsung masuk otomatis lewat payment gateway.</Text></View>
            <Ionicons name="chevron-forward" size={18} color={colors.primary} />
          </Pressable>
          <Text style={[font.tiny, { textAlign: 'center', marginTop: 10 }]}>— atau transfer bank manual (verifikasi admin) —</Text>
        </Entrance>
        <Entrance index={1}>
          <Card>
            <Text style={font.label}>Nominal</Text>
            <Input value={amount} onChangeText={(v) => setAmount(v.replace(/\D/g, ''))} keyboardType="number-pad" icon="cash-outline" containerStyle={{ marginTop: 8 }} />
            <Row gap={8} style={{ flexWrap: 'wrap', marginTop: 10 }}>
              {PRESETS.map((p) => <Chip key={p} label={rupiah(p)} active={amount === String(p)} onPress={() => setAmount(String(p))} />)}
            </Row>
          </Card>
        </Entrance>
        <Entrance index={1}>
          <Card>
            <Text style={font.label}>1. Transfer ke rekening AntarKita</Text>
            {bank ? (
              <View style={s.bank}>
                <Text style={font.tiny}>{bank.bank} a.n. {bank.name}</Text>
                <Row between>
                  <Text style={{ fontSize: 22, fontWeight: '800', color: colors.text, letterSpacing: 1 }}>{bank.number}</Text>
                  <Pressable onPress={async () => { await Clipboard.setStringAsync(bank.number); toast.show('Nomor rekening disalin'); }} style={s.copy}><Ionicons name="copy-outline" size={18} color={colors.primary} /></Pressable>
                </Row>
              </View>
            ) : <Text style={font.small}>Memuat rekening…</Text>}
            <Text style={[font.small, { marginTop: 8 }]}>Transfer tepat sesuai nominal. Saldo masuk setelah admin memverifikasi (maks. 1×24 jam).</Text>
          </Card>
        </Entrance>
        <Entrance index={2}>
          <Card>
            <Text style={font.label}>2. Unggah bukti transfer</Text>
            <Pressable onPress={upload} style={s.upload}>
              <Ionicons name={proof ? 'checkmark-circle' : 'cloud-upload-outline'} size={28} color={proof ? colors.success : colors.primary} />
              <Text style={{ color: proof ? colors.success : colors.primary, fontWeight: '700' }}>{proof ? 'Bukti terunggah · ganti' : 'Pilih foto bukti transfer'}</Text>
            </Pressable>
            <Input placeholder="Catatan (nama pengirim / bank asal)" value={note} onChangeText={setNote} containerStyle={{ marginTop: 10 }} />
          </Card>
        </Entrance>
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  gw: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: radius.lg, backgroundColor: colors.primary + '14', borderWidth: 1.5, borderColor: colors.primary + '44' },
  gwIcon: { width: 40, height: 40, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  bank: { backgroundColor: colors.primaryLight, borderRadius: radius.md, padding: 12, marginTop: 8 },
  copy: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  upload: { alignItems: 'center', gap: 6, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.primary, borderRadius: radius.md, padding: 18, marginTop: 8 },
});
