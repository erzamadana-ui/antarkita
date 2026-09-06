// Buat kata sandi baru — dibuka dari tautan email pemulihan (sesi pemulihan sudah dibuat oleh RootLayout)
// atau dengan kode 6 digit dari email (bila template email Supabase menyertakan {{ .Token }}).
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Screen, Input, Button, Icon, IconCircle, toast } from '@/components/ui';
import { Entrance } from '@/components/motion';
import { supabase, friendlyError } from '@/lib/supabase';
import { useAuth } from '@/store/auth';
import { useT } from '@/lib/i18n';
import { colors, font, radius, shadow } from '@/lib/theme';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function passwordIssue(p: string): string | null {
  if (p.length < 8) return 'Minimal 8 karakter';
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) return 'Gabungkan huruf dan angka';
  return null;
}

export default function ResetPassword() {
  const router = useRouter();
  const t = useT();
  const session = useAuth((s) => s.session);
  const recovery = useAuth((s) => s.recovery);
  const setRecovery = useAuth((s) => s.setRecovery);
  const loadProfile = useAuth((s) => s.loadProfile);
  const { email: prefill } = useLocalSearchParams<{ email?: string }>();
  const [email, setEmail] = useState(prefill ?? '');
  const [code, setCode] = useState('');
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<'password' | 'code'>(session ? 'password' : 'code');
  useEffect(() => { if (session) setMode('password'); }, [session]);

  const issue = p1 ? passwordIssue(p1) : null;
  const mismatch = p2.length > 0 && p1 !== p2;
  const strength = p1.length === 0 ? 0 : passwordIssue(p1) ? 1 : p1.length >= 12 && /[^A-Za-z0-9]/.test(p1) ? 3 : 2;

  const verifyCode = async () => {
    setErr(null);
    const e = email.trim().toLowerCase();
    if (!EMAIL_RE.test(e)) { setErr('Masukkan email yang valid'); return; }
    if (!/^\d{6,8}$/.test(code.trim())) { setErr('Masukkan kode 6 digit dari email'); return; }
    setBusy(true);
    try {
      const { error } = await supabase.auth.verifyOtp({ email: e, token: code.trim(), type: 'recovery' });
      if (error) throw new Error(friendlyError(error.message));
      setRecovery(true); setMode('password');
    } catch (ex) { setErr((ex as Error).message); }
    finally { setBusy(false); }
  };

  const save = async () => {
    setErr(null);
    const bad = passwordIssue(p1);
    if (bad) { setErr(`Kata sandi: ${bad.toLowerCase()}`); return; }
    if (p1 !== p2) { setErr('Ulangi kata sandi harus sama'); return; }
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: p1 });
      if (error) throw new Error(friendlyError(error.message));
      setDone(true);
      await loadProfile();
      toast.success('Kata sandi baru tersimpan');
    } catch (ex) { setErr((ex as Error).message); }
    finally { setBusy(false); }
  };

  const finish = async () => { if (recovery) { setRecovery(false); router.replace('/' as never); } else if (router.canGoBack()) router.back(); else router.replace('/' as never); };
  const restart = async () => { await supabase.auth.signOut().catch(() => {}); setRecovery(false); router.replace('/(auth)/forgot' as never); };

  return (
    <Screen title={session && !recovery ? 'Ganti kata sandi' : t('reset_title')} back={!recovery && !done} maxWidth={480} ambient={false}>
      <Entrance index={0} from="zoom" style={{ alignItems: 'center', marginTop: 8 }}>
        <View style={s.ring}><Icon name={done ? 'checkmark-circle' : 'lock-open-outline'} size={44} color={done ? colors.success : colors.primary} /></View>
      </Entrance>
      {done ? (
        <Entrance index={1}><View style={s.card}>
          <Text style={[font.h2, { textAlign: 'center' }]}>Kata sandi diperbarui</Text>
          <Text style={[font.small, { textAlign: 'center' }]}>Gunakan kata sandi baru saat masuk berikutnya di aplikasi AntarKita (Pelanggan atau Mitra). Anda sudah masuk di perangkat ini.</Text>
          <Button title="Lanjut ke aplikasi" size="lg" icon="arrow-forward" onPress={finish} />
        </View></Entrance>
      ) : mode === 'password' ? (
        <Entrance index={1}><View style={s.card}>
          <Text style={[font.h2, { textAlign: 'center' }]}>{session && !recovery ? 'Ganti kata sandi' : t('reset_title')}</Text>
          <Text style={[font.small, { textAlign: 'center' }]}>{session?.user.email ? `Untuk akun ${session.user.email}. ` : ''}Minimal 8 karakter, gabungan huruf dan angka.</Text>
          <Input label={t('new_password')} icon="lock-closed-outline" value={p1} onChangeText={(v) => { setP1(v); setErr(null); }} secureTextEntry={!show} placeholder="Kata sandi baru" textContentType="newPassword" autoFocus error={issue ?? undefined}
            right={<Pressable onPress={() => setShow(!show)} hitSlop={8} accessibilityRole="button" accessibilityLabel={show ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'}><Icon name={show ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.textMuted} /></Pressable>} />
          <View style={s.meter}>{[1, 2, 3].map((i) => <View key={i} style={[s.bar, strength >= i && { backgroundColor: strength === 1 ? colors.danger : strength === 2 ? colors.warning : colors.success }]} />)}<Text style={[font.tiny, { marginLeft: 6 }]}>{strength === 0 ? '' : strength === 1 ? 'Lemah' : strength === 2 ? 'Cukup kuat' : 'Kuat'}</Text></View>
          <Input label={t('confirm_password')} icon="lock-closed-outline" value={p2} onChangeText={(v) => { setP2(v); setErr(null); }} secureTextEntry={!show} placeholder="Ulangi kata sandi baru" textContentType="newPassword" onSubmitEditing={save} error={mismatch ? 'Belum sama' : undefined} />
          {err ? <Text style={{ color: colors.danger, fontSize: 13 }}>{err}</Text> : null}
          <Button title={t('save_password')} size="lg" icon="checkmark" loading={busy} onPress={save} />
          {recovery ? <Pressable onPress={restart} style={{ alignItems: 'center', padding: 6 }} accessibilityRole="button"><Text style={[font.small, { color: colors.textMuted }]}>Bukan Anda? Batalkan dan minta tautan baru</Text></Pressable> : null}
        </View></Entrance>
      ) : (
        <Entrance index={1}><View style={s.card}>
          <Text style={[font.h2, { textAlign: 'center' }]}>Masukkan kode pemulihan</Text>
          <Text style={[font.small, { textAlign: 'center' }]}>Buka tautan di email pemulihan, atau masukkan kode dari email tersebut di sini.</Text>
          <Input label={t('email')} icon="mail-outline" value={email} onChangeText={(v) => { setEmail(v); setErr(null); }} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" placeholder="nama@email.com" textContentType="emailAddress" />
          <Input label="Kode dari email" icon="keypad-outline" value={code} onChangeText={(v) => { setCode(v.replace(/\D/g, '').slice(0, 8)); setErr(null); }} keyboardType="number-pad" placeholder="6 digit" textContentType="oneTimeCode" onSubmitEditing={verifyCode} />
          {err ? <Text style={{ color: colors.danger, fontSize: 13 }}>{err}</Text> : null}
          <Button title="Verifikasi kode" size="lg" icon="shield-checkmark-outline" loading={busy} onPress={verifyCode} />
          <View style={s.note}>
            <IconCircle name="information-circle-outline" size={30} bg="#fff" color={colors.primary} />
            <Text style={[font.tiny, { flex: 1 }]}>Belum menerima email? <Text style={{ color: colors.primary, fontWeight: '800' }} onPress={() => router.replace({ pathname: '/(auth)/forgot', params: { email } } as never)}>Kirim tautan pemulihan</Text>.</Text>
          </View>
        </View></Entrance>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  ring: { width: 108, height: 108, borderRadius: 54, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.primaryLight },
  card: { gap: 14, marginTop: 18, padding: 16, borderRadius: radius.lg, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, ...shadow.soft },
  meter: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: -6 },
  bar: { width: 34, height: 5, borderRadius: 3, backgroundColor: colors.border },
  note: { flexDirection: 'row', gap: 10, alignItems: 'center', padding: 10, borderRadius: radius.md, backgroundColor: colors.tint },
});
