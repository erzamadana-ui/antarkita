// Gerbang PIN panel admin: banner "atur PIN" bila belum ada PIN, overlay PIN 6 digit bila sesi terkunci
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Modal, StyleSheet, Pressable, Platform } from 'react-native';
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

  // Gerbang PIN HARUS berada di atas dialog apa pun. Di web, setiap <Modal> RN-Web membuat <div>
  // portalnya sendiri lalu menempelkannya ke <body> SAAT KOMPONEN DIPASANG — bukan saat terlihat.
  // Modal gerbang ini dipasang sejak awal, sedangkan dialog seperti "Hapus mitra" dipasang belakangan,
  // sehingga div dialog berada SETELAHNYA di DOM dan — karena keduanya z-index auto — tergambar DI ATAS
  // gerbang PIN (terbukti: titik tengah tombol "Buka kunci" ternyata milik dialog hapus, PIN tak bisa
  // diketik). zIndex pada backdrop DI DALAM modal tidak menolong: ia tidak bisa mengangkat div portal
  // induknya. Jadi div portal itu sendiri yang dijadikan konteks penumpukan tertinggi.
  const boxRef = useRef<View>(null);
  useEffect(() => {
    if (Platform.OS !== 'web' || !showModal) return;
    const node = boxRef.current as unknown as HTMLElement | null;
    if (!node || typeof document === 'undefined') return;
    let el: HTMLElement | null = node;
    while (el && el.parentElement && el.parentElement !== document.body) el = el.parentElement;
    if (el && el.parentElement === document.body) { el.style.position = 'relative'; el.style.zIndex = '2147483000'; }
  }, [showModal]);

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
            <Ionicons name="shield-outline" size={20} color={colors.warning} />
            <Text style={[font.small, { flex: 1, color: colors.text }]}>Amankan panel: atur PIN 6 digit. Tindakan sensitif (saldo, pencairan, gateway, peran admin) butuh PIN.</Text>
            <Button size="sm" title="Atur PIN" color={colors.warning} onPress={() => router.push('/(admin)/security' as never)} />
          </View>
        </View>
      ) : null}
      {children}
      {/* Gerbang PIN harus selalu berada di atas dialog apa pun. Portal RN-Web menumpuk menurut urutan
          mount, jadi tanpa zIndex eksplisit modal ini bisa tertimbun dialog yang dibuka lebih dulu
          (mis. "Hapus mitra") dan tombol "Buka kunci" tidak bisa diklik. */}
      <Modal visible={showModal} transparent animationType="fade" statusBarTranslucent onRequestClose={() => { if (!needPin) closeModal(); }}>
        <View ref={boxRef} style={s.backdrop}>
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
  backdrop: { flex: 1, backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 9999, elevation: 9999 },
  box: { alignItems: 'center', gap: 12, padding: 24, borderRadius: radius.xl, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, maxWidth: 400, width: '100%' },
  pin: { fontSize: 30, fontWeight: '700', letterSpacing: 14, textAlign: 'center', color: colors.text, borderBottomWidth: 2, borderBottomColor: colors.primary, paddingVertical: 8, width: 220 },
  locked: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: radius.md, backgroundColor: colors.dangerLight },
  link: { color: colors.primary, fontWeight: '700', fontSize: 14 },
});
