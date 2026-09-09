// Lupa kata sandi — kirim tautan pemulihan ke email (Supabase Auth). Berlaku untuk aplikasi Pelanggan, Mitra, dan Admin.
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Screen, Input, Button, Icon, IconCircle } from '@/components/ui';
import { Entrance } from '@/components/motion';
import { supabase, friendlyError } from '@/lib/supabase';
import { useT } from '@/lib/i18n';
import { useAuth } from '@/store/auth';
import { APP, APP_URL } from '@/lib/app';
import { colors, font, radius, shadow } from '@/lib/theme';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const COOLDOWN = 60;

/** URL tujuan setelah pengguna mengeklik tautan di email: beranda web aplikasi ini (file index ada, tanpa lompatan 404). */
export const recoveryRedirectUrl = () => APP_URL[APP];

export default function ForgotPassword() {
  const router = useRouter();
  const t = useT();
  const { email: prefill } = useLocalSearchParams<{ email?: string }>();
  const [email, setEmail] = useState(prefill ?? '');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [left, setLeft] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const setPendingRoute = useAuth((s) => s.setPendingRoute);
  useEffect(() => { setPendingRoute(null); }, [setPendingRoute]);

  useEffect(() => { if (left <= 0) return; const id = setTimeout(() => setLeft((x) => x - 1), 1000); return () => clearTimeout(id); }, [left]);

  const submit = async () => {
    const e = email.trim().toLowerCase();
    setErr(null);
    if (!EMAIL_RE.test(e)) { setErr('Masukkan alamat email yang valid'); return; }
    setBusy(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(e, { redirectTo: recoveryRedirectUrl() });
      if (error) throw new Error(friendlyError(error.message));
      setSent(e); setLeft(COOLDOWN);
    } catch (ex) { setErr((ex as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <Screen title={t('forgot_title')} back maxWidth={480} ambient={false}>
      <Entrance index={0} from="zoom" style={{ alignItems: 'center', marginTop: 8 }}>
        <View style={s.ring}><Icon name={sent ? 'mail-open-outline' : 'key-outline'} size={44} color={colors.primary} /></View>
      </Entrance>
      {sent ? (
        <Entrance index={1}><View style={s.card}>
          <Text style={[font.h2, { textAlign: 'center' }]}>Cek email Anda</Text>
          <Text style={[font.small, { textAlign: 'center' }]}>Jika <Text style={{ fontWeight: '800', color: colors.text }}>{sent}</Text> terdaftar, kami sudah mengirim tautan pemulihan. Buka email itu dan ketuk <Text style={{ fontWeight: '800', color: colors.text }}>Reset Password</Text> — tautan berlaku 1 jam.</Text>
          <View style={s.tips}>
            <Tip icon="time-outline" text="Belum masuk dalam 1–2 menit? Periksa folder Spam/Promosi." />
            <Tip icon="phone-portrait-outline" text="Tautan membuka halaman web AntarKita untuk membuat kata sandi baru. Setelah tersimpan, masuk lagi di aplikasi dengan kata sandi baru." />
            <Tip icon="shield-checkmark-outline" text="Demi keamanan, kami tidak memberi tahu apakah email terdaftar atau tidak." />
          </View>
          {/* Jalur kedua: sebagian email pemulihan memuat kode 6 digit, bukan tautan yang bisa diketuk.
              Tanpa tombol ini layar /(auth)/reset tidak bisa dijangkau sama sekali dari dalam aplikasi. */}
          <Button title="Saya punya kode dari email" size="lg" icon="keypad-outline" onPress={() => router.push({ pathname: '/(auth)/reset', params: { email: sent } } as never)} />
          <Button title={left > 0 ? `Kirim ulang (${left} dtk)` : 'Kirim ulang tautan'} variant="outline" disabled={left > 0} loading={busy} onPress={submit} />
          <Button title={t('back_to_login')} variant="ghost" icon="log-in-outline" onPress={() => router.replace('/(auth)/login' as never)} />
        </View></Entrance>
      ) : (
        <Entrance index={1}><View style={s.card}>
          <Text style={[font.h2, { textAlign: 'center' }]}>{t('forgot_title')}</Text>
          <Text style={[font.small, { textAlign: 'center' }]}>{t('forgot_sub')}</Text>
          <Input label={t('email')} icon="mail-outline" value={email} onChangeText={(v) => { setEmail(v); setErr(null); }} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" placeholder="nama@email.com" textContentType="emailAddress" autoFocus onSubmitEditing={submit} error={err ?? undefined} />
          <Button title={t('send_link')} size="lg" icon="send-outline" loading={busy} onPress={submit} />
          <Pressable onPress={() => router.back()} style={{ alignItems: 'center', padding: 6 }} accessibilityRole="button">
            <Text style={[font.small, { color: colors.primary, fontWeight: '800' }]}>{t('back_to_login')}</Text>
          </Pressable>
        </View></Entrance>
      )}
    </Screen>
  );
}

function Tip({ icon, text }: { icon: React.ComponentProps<typeof Icon>['name']; text: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
      <IconCircle name={icon} size={30} bg={colors.tint} color={colors.primary} />
      <Text style={[font.small, { flex: 1 }]}>{text}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  ring: { width: 108, height: 108, borderRadius: 54, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.primaryLight },
  card: { gap: 14, marginTop: 18, padding: 16, borderRadius: radius.lg, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, ...shadow.soft },
  tips: { gap: 10, padding: 12, borderRadius: radius.md, backgroundColor: colors.tint },
});
