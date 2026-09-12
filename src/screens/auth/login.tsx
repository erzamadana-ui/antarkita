import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Screen, Input, Button, Icon } from '@/components/ui';
import { Entrance } from '@/components/motion';
import { LogoLockup } from '@/components/Logo';
import { ServiceIllustration } from '@/components/ServiceArt';
import { useT } from '@/lib/i18n';
import { useAuth } from '@/store/auth';
import { colors, font, radius, shadow } from '@/lib/theme';
import { APP, APP_NAME, APP_URL } from '@/lib/app';

export default function Login() {
  const router = useRouter();
  const signIn = useAuth((s) => s.signIn);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const t = useT();
  const { denied } = useLocalSearchParams<{ denied?: string }>();
  const signOut = useAuth((s) => s.signOut);
  const session = useAuth((s) => s.session);
  const profile = useAuth((s) => s.profile);
  const showDenied = !!denied || (APP === 'admin' && !!session && !!profile && profile.role !== 'admin');

  const submit = async () => {
    setErr(null);
    if (!email || !password) { setErr('Isi email dan kata sandi'); return; }
    try { await signIn(email, password); router.replace('/'); }
    catch (e) { setErr((e as Error).message); }
  };

  return (
    <Screen title={t('login')} back maxWidth={480} ambient={false}>
      <Entrance index={0} from="zoom" style={{ alignItems: 'center', marginTop: 4 }}>
        <View style={s.artRing}><ServiceIllustration kind={APP === 'mitra' ? 'rider' : APP === 'admin' ? 'pay' : 'car'} size={84} /></View>
      </Entrance>
      <Entrance index={1} style={{ alignItems: 'center', marginTop: 16 }}>
        <LogoLockup size={28} />
        <Text style={[font.h1, { marginTop: 10, textAlign: 'center' }]}>{t('welcome_back')}</Text>
        <Text style={[font.small, { textAlign: 'center', marginTop: 4 }]}>{APP === 'admin' ? `Masuk ke ${APP_NAME.admin} dengan akun admin.` : APP === 'mitra' ? 'Masuk dengan akun AntarKita Anda untuk mengelola pesanan mitra.' : t('login_sub')}</Text>
      </Entrance>
      {showDenied ? (
        <Entrance index={1}><View style={{ backgroundColor: colors.dangerLight, padding: 12, borderRadius: 14, marginTop: 12, gap: 8 }}>
          <Text style={{ color: colors.danger, fontWeight: '700' }}>Akun ini bukan admin</Text>
          <Text style={font.small}>{APP_NAME.admin} hanya untuk akun berperan admin. Gunakan aplikasi Pelanggan atau Mitra untuk akun ini.</Text>
          <Button title="Keluar & masuk dengan akun lain" size="sm" variant="outline" onPress={async () => { await signOut(); router.replace('/(auth)/login' as never); }} />
          {session ? <Text style={[font.tiny]}>Aplikasi Pelanggan: {APP_URL.pelanggan}</Text> : null}
        </View></Entrance>
      ) : null}
      <Entrance index={2}><View style={s.card}>
        <Input label={t('email')} icon="mail-outline" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="nama@email.com" textContentType="emailAddress" />
        <Input label={t('password')} icon="lock-closed-outline" value={password} onChangeText={setPassword} secureTextEntry={!show} placeholder="Kata sandi" onSubmitEditing={submit}
          right={<Pressable onPress={() => setShow(!show)} hitSlop={8}><Icon name={show ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.textMuted} /></Pressable>} />
        {err ? <Text style={{ color: colors.danger, fontSize: 14 }}>{err}</Text> : null}
        <Pressable onPress={() => router.push({ pathname: '/(auth)/forgot', params: email ? { email } : {} } as never)} style={{ alignSelf: 'flex-end', marginTop: -6 }} accessibilityRole="button" hitSlop={8}>
          <Text style={[font.small, { color: colors.primary, fontWeight: '700' }]}>{t('forgot_password')}</Text>
        </Pressable>
        <Button title={t('login')} size="lg" onPress={submit} />
        {APP !== 'admin' ? (
          <Pressable onPress={() => router.push('/(auth)/register')} style={{ alignItems: 'center', padding: 6 }}>
            <Text style={font.small}>{t('no_account')} <Text style={{ color: colors.primary, fontWeight: '700' }}>{t('register')}</Text></Text>
          </Pressable>
        ) : <Text style={[font.tiny, { textAlign: 'center', padding: 6 }]}>Akun admin dibuat oleh admin lain lewat menu Pengguna.</Text>}
      </View></Entrance>
    </Screen>
  );
}

const s = StyleSheet.create({
  artRing: { width: 140, height: 140, borderRadius: 70, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.primaryLight },
  card: { gap: 14, marginTop: 18, padding: 16, borderRadius: radius.lg, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, ...shadow.soft },
});
