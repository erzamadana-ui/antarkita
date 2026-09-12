// Hapus akun (kewajiban Google Play "Account deletion") — konfirmasi ketik HAPUS → rpc request_account_deletion → keluar.
// Layar bersama untuk aplikasi Pelanggan & Mitra (rute /account/delete).
import React, { useState } from 'react';
import { View, Text, StyleSheet, Alert, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Screen, Input, Button, toast, type IconName } from '@/components/ui';
import { Entrance } from '@/components/motion';
import { useAuth } from '@/store/auth';
import { rpc } from '@/lib/supabase';
import { colors, font, radius, shadow } from '@/lib/theme';
import { rupiah } from '@/lib/format';

const CONFIRM_WORD = 'HAPUS';
const SUPPORT_EMAIL = 'erzamadana@gmail.com';

const CONSEQUENCES: { icon: IconName; text: string }[] = [
  { icon: 'person-remove-outline', text: 'Nama, nomor HP, email, dan foto profil dianonimkan; akun langsung nonaktif dan tidak bisa dipakai masuk.' },
  { icon: 'car-outline', text: 'Status mitra (driver, merchant, lapak pasar, mitra travel) dinonaktifkan. Untuk kembali menjadi mitra harus mendaftar ulang.' },
  { icon: 'receipt-outline', text: 'Riwayat transaksi disimpan dalam bentuk anonim sesuai kewajiban pembukuan dan hukum yang berlaku.' },
  { icon: 'time-outline', text: 'Dokumen KYC dan data lain dihapus permanen setelah masa tenggang 30 hari. Dalam masa itu Anda bisa minta pemulihan ke CS.' },
];

export default function DeleteAccount() {
  const router = useRouter();
  const { profile, wallet, signOut } = useAuth();
  const [word, setWord] = useState('');
  const [busy, setBusy] = useState(false);
  const balance = wallet?.balance ?? 0;
  const ready = word.trim().toUpperCase() === CONFIRM_WORD && !busy;

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    try {
      await rpc('request_account_deletion');
      toast.success('Permintaan hapus akun tercatat. Sampai jumpa.');
      await signOut();
      router.replace('/(auth)/welcome');
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setBusy(false); }
  };
  const confirm = () => {
    if (!ready) return;
    if (Platform.OS === 'web') { if (window.confirm('Hapus akun AntarKita secara permanen?')) submit(); return; }
    Alert.alert('Hapus akun?', 'Tindakan ini tidak bisa dibatalkan setelah masa tenggang berakhir.', [
      { text: 'Batal', style: 'cancel' },
      { text: 'Hapus akun', style: 'destructive', onPress: submit },
    ]);
  };

  return (
    <Screen title="Hapus akun" back footer={<Button title="Hapus akun saya" size="lg" variant="danger" icon="trash-outline" loading={busy} disabled={!ready} onPress={confirm} />}>
      <Entrance index={0} from="zoom">
        <View style={s.hero}>
          <View style={s.heroIcon}><Ionicons name="warning-outline" size={32} color={colors.danger} /></View>
          <Text style={[font.h2, { textAlign: 'center' }]}>Kami sedih melihat Anda pergi</Text>
          <Text style={[font.small, { textAlign: 'center' }]}>
            {profile?.email ? `Akun ${profile.email} ` : 'Akun Anda '}akan dihapus. Bacalah dulu apa yang terjadi setelahnya.
          </Text>
        </View>
      </Entrance>

      <Entrance index={1}>
        <View style={s.card}>
          {CONSEQUENCES.map((c, i) => (
            <View key={c.icon} style={[s.row, i < CONSEQUENCES.length - 1 && s.rowBorder]}>
              <View style={s.rowIcon}><Ionicons name={c.icon} size={20} color={colors.danger} /></View>
              <Text style={[font.body, { flex: 1 }]}>{c.text}</Text>
            </View>
          ))}
        </View>
      </Entrance>

      <Entrance index={2}>
        <View style={[s.card, { marginTop: 14, gap: 8 }]}>
          <Text style={font.label}>Sebelum menghapus, pastikan:</Text>
          <Check ok={balance === 0} text={balance === 0 ? 'Saldo AntarPay sudah Rp0' : balance > 0 ? `Saldo AntarPay ${rupiah(balance)} — tarik atau habiskan dulu` : `Saldo AntarPay minus ${rupiah(Math.abs(balance))} — lunasi dulu`} />
          <Check ok text="Tidak ada pesanan, booking travel, atau penarikan yang masih berjalan (dicek otomatis saat menghapus)" />
          <Text style={[font.tiny, { marginTop: 4 }]}>Butuh bantuan atau ingin membatalkan permintaan dalam masa tenggang? Hubungi {SUPPORT_EMAIL}.</Text>
        </View>
      </Entrance>

      <Entrance index={3}>
        <View style={[s.card, { marginTop: 14, gap: 10 }]}>
          <Input
            label={`Ketik ${CONFIRM_WORD} untuk konfirmasi`}
            value={word}
            onChangeText={setWord}
            placeholder={CONFIRM_WORD}
            autoCapitalize="characters"
            autoCorrect={false}
            icon="trash-outline"
            returnKeyType="done"
            onSubmitEditing={confirm}
          />
          <Text style={font.tiny}>Dengan menekan tombol di bawah, Anda menyatakan telah membaca konsekuensi di atas.</Text>
        </View>
      </Entrance>
    </Screen>
  );
}

function Check({ ok, text }: { ok: boolean; text: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
      <Ionicons name={ok ? 'checkmark-circle' : 'close-circle'} size={20} color={ok ? colors.success : colors.danger} style={{ marginTop: 1 }} />
      <Text style={[font.small, { flex: 1 }, !ok && { color: colors.danger }]}>{text}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  hero: { alignItems: 'center', gap: 8, marginTop: 8, marginBottom: 18, paddingHorizontal: 8 },
  heroIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.dangerLight, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  card: { backgroundColor: '#fff', borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: 14, ...shadow.soft },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 10 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  rowIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.dangerLight, alignItems: 'center', justifyContent: 'center' },
});
