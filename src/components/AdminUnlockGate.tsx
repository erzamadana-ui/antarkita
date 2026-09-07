// Gerbang PIN panel admin: banner "atur PIN" bila belum ada PIN, overlay PIN 6 digit bila sesi terkunci
import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Modal, StyleSheet, Pressable } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated from 'react-native-reanimated';
import { Button, Row, toast } from '@/components/ui';
import { useShake } from '@/components/motion';
import { BrandLogo } from '@/components/Logo';
import { useAdminSecurity } from '@/store/adminSecurity';
import { colors, font, radius, shadow } from '@/lib/theme';

function useCountdown(until: string | null | undefined) {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!until) { setLeft(0); return; }
    const tick = () => setLeft(Math.max(0, Math.round((new Date(until).getTime() - Date.now()) / 1000)));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [until]);
  return left;
}
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export function AdminUnlockGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { status, loaded, modal, refresh, unlock, closeModal } = useAdminSecurity();
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const { style: shake, shake: doShake } = useShake();
  const lockedLeft = useCountdown(status?.locked_until);

  useEffect(() => { refresh(); }, [refresh]);
  // Segarkan status saat sesi kedaluwarsa agar overlay muncul otomatis
  useEffect(() => {
    if (!status?.unlocked || !status.unlocked_until) return;
    const ms = new Date(status.unlocked_until).getTime() - Date.now() + 500;
    const t = setTimeout(() => refresh(), Math.max(1000, ms));
    return () => clearTimeout(t);
  }, [status?.unlocked, status?.unlocked_until, refresh]);

  const onSecurity = pathname.startsWith('/security');
  const needPin = !!status && status.has_pin && !status.unlocked;
  const showModal = loaded && (needPin || modal) && !!status?.has_pin;
  const showBanner = loaded && !!status && !status.has_pin && !onSecurity;

  const submit = async () => {
    if (pin.length < 6) return doShake();
    setBusy(true);
    try { await unlock(pin); setPin(''); toast.success('Panel terbuka'); }
    catch (e) { doShake(); setPin(''); toast.error((e as Error).message); await refresh(); }
    finally { setBusy(false); }
  };

  return (
    <View style={{ flex: 1 }}>
      {showBanner ? (
        <View style={{ paddingHorizontal: 20, paddingTop: 12 }}>
          <View style={s.banner}>
            <Ionicons name="shield-outline" size={18} color={colors.warning} />
            <Text style={[font.small, { flex: 1, color: colors.text }]}>Amankan panel: atur PIN 6 digit. Tindakan sensitif (saldo, pencairan, gateway, peran admin) butuh PIN.</Text>
            <Button size="sm" title="Atur PIN" color={colors.warning} onPress={() => router.push('/(admin)/security' as never)} />
          </View>
        </View>
      ) : null}
      {children}
      <Modal visible={showModal} transparent animationType="fade" onRequestClose={() => { if (!needPin) closeModal(); }}>
        <View style={s.backdrop}>
          <Animated.View style={[s.box, shadow.card, shake]}>
            <BrandLogo size={52} />
            <Text style={[font.h2, { marginTop: 6 }]}>Buka kunci panel</Text>
            <Text style={[font.small, { textAlign: 'center' }]}>Masukkan PIN 6 digit panel admin. Sesi terbuka selama {status?.session_minutes ?? 60} menit; setiap percobaan dicatat di log keamanan.</Text>
            {lockedLeft > 0 ? (
              <View style={s.locked}><Ionicons name="lock-closed" size={16} color={colors.danger} /><Text style={[font.small, { color: colors.danger, fontWeight: '700' }]}>Terkunci setelah 5 kali salah. Coba lagi dalam {mmss(lockedLeft)}.</Text></View>
            ) : (
              <TextInput value={pin} onChangeText={(v) => setPin(v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" secureTextEntry maxLength={6} autoFocus style={s.pin} placeholder="••••••" placeholderTextColor={colors.textMuted} onSubmitEditing={submit} editable={!busy} />
            )}
            <Button title="Buka kunci" size="lg" loading={busy} disabled={pin.length < 6 || lockedLeft > 0} onPress={submit} style={{ alignSelf: 'stretch' }} />
            <Text style={[font.tiny, { textAlign: 'center' }]}>Lupa PIN? PIN hanya bisa diganti dengan PIN lama — hubungi operator basis data untuk mengatur ulang.</Text>
            {!needPin ? <Pressable onPress={closeModal}><Text style={s.link}>Tutup</Text></Pressable> : null}
          </Animated.View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  banner: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.lg, backgroundColor: colors.accentLight, borderWidth: 1, borderColor: colors.warning + '55', maxWidth: 1100, width: '100%', alignSelf: 'center' },
  backdrop: { flex: 1, backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center', padding: 20 },
  box: { alignItems: 'center', gap: 12, padding: 24, borderRadius: radius.xl, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, maxWidth: 400, width: '100%' },
  pin: { fontSize: 30, fontWeight: '800', letterSpacing: 14, textAlign: 'center', color: colors.text, borderBottomWidth: 2, borderBottomColor: colors.primary, paddingVertical: 8, width: 220 },
  locked: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: radius.md, backgroundColor: colors.dangerLight },
  link: { color: colors.primary, fontWeight: '700', fontSize: 13 },
});
