import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Screen, Input, Button } from '@/components/ui';
import { Entrance } from '@/components/motion';
import { LogoLockup } from '@/components/Logo';
import { ServiceIllustration } from '@/components/ServiceArt';
import { useT } from '@/lib/i18n';
import { useAuth } from '@/store/auth';
import { colors, font, radius, shadow } from '@/lib/theme';
import { APP, BRAND } from '@/lib/app';

export default function Register() {
  const router = useRouter();
  const signUp = useAuth((s) => s.signUp);
  const [f, setF] = useState({ full_name: '', phone: '', email: '', password: '', confirm: '' });
  const [err, setErr] = useState<string | null>(null);
  const t = useT();
  const set = (k: keyof typeof f) => (v: string) => setF((p) => ({ ...p, [k]: v }));

  const submit = async () => {
    setErr(null);
    if (f.full_name.trim().length < 3) return setErr('Nama lengkap minimal 3 huruf');
    if (!/^(\+62|0)8\d{7,12}$/.test(f.phone.replace(/\s|-/g, ''))) return setErr('Nomor HP tidak valid (contoh: 08123456789)');
    if (!/^\S+@\S+\.\S+$/.test(f.email)) return setErr('Email tidak valid');
    if (f.password.length < 6) return setErr('Kata sandi minimal 6 karakter');
    if (f.password !== f.confirm) return setErr('Konfirmasi kata sandi tidak sama');
    try { await signUp(f); router.replace('/'); } catch (e) { setErr((e as Error).message); }
  };

  return (
    <Screen title={t('create_account')} back maxWidth={480} ambient={false}>
      <Entrance index={0} from="zoom" style={{ alignItems: 'center', marginTop: 4 }}>
        <View style={s.artRing}><ServiceIllustration kind={APP === 'mitra' ? 'rider' : 'send'} size={84} /></View>
      </Entrance>
      <Entrance index={1} style={{ alignItems: 'center', marginTop: 16 }}>
        <LogoLockup size={28} />
        <Text style={[font.h1, { marginTop: 10, textAlign: 'center' }]}>{t('register')} {BRAND}</Text>
        <Text style={[font.small, { textAlign: 'center', marginTop: 4 }]}>{APP === 'mitra' ? 'Buat akun mitra, lalu pilih jenis kemitraan: driver, mobil box, travel, atau merchant.' : t('start_sub')}</Text>
      </Entrance>
      <Entrance index={2}><View style={s.card}>
        <Input label={t('full_name')} icon="person-outline" value={f.full_name} onChangeText={set('full_name')} placeholder="Nama sesuai KTP" />
        <Input label={t('phone')} icon="call-outline" value={f.phone} onChangeText={set('phone')} keyboardType="phone-pad" placeholder="08123456789" />
        <Input label={t('email')} icon="mail-outline" value={f.email} onChangeText={set('email')} autoCapitalize="none" keyboardType="email-address" placeholder="nama@email.com" />
        <Input label={t('password')} icon="lock-closed-outline" value={f.password} onChangeText={set('password')} secureTextEntry placeholder="Minimal 6 karakter" />
        <Input label="Ulangi kata sandi" icon="lock-closed-outline" value={f.confirm} onChangeText={set('confirm')} secureTextEntry placeholder="Ulangi kata sandi" onSubmitEditing={submit} />
        {err ? <Text style={{ color: colors.danger, fontSize: 14 }}>{err}</Text> : null}
        <Button title={t('register')} size="lg" onPress={submit} />
        <Text style={{ fontSize: 12, color: colors.textMuted, textAlign: 'center', lineHeight: 17 }}>Dengan mendaftar Anda menyetujui Syarat & Ketentuan serta Kebijakan Privasi AntarKita.</Text>
        <Pressable onPress={() => router.replace('/(auth)/login')} style={{ alignItems: 'center', padding: 6 }}>
          <Text style={font.small}>{t('have_account')} <Text style={{ color: colors.primary, fontWeight: '700' }}>{t('login')}</Text></Text>
        </Pressable>
      </View></Entrance>
    </Screen>
  );
}

const s = StyleSheet.create({
  artRing: { width: 140, height: 140, borderRadius: 70, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.primaryLight },
  card: { gap: 14, marginTop: 18, padding: 16, borderRadius: radius.lg, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, ...shadow.soft },
});
