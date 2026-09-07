// Overlay panggilan masuk (global) + tombol panggil yang dipakai di kartu kontak.
// Komponen ini juga tempat <SoundHost/> dipasang (satu-satunya titik yang selalu hidup di root),
// sehingga nada dering & bunyi notifikasi punya pemutar bahkan sebelum ada panggilan.
import React, { useEffect } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { BlurView } from 'expo-blur';
import Animated, { FadeIn, FadeOut, ZoomIn } from 'react-native-reanimated';
import { Avatar, toast } from '@/components/ui';
import { PressableScale, Radar } from '@/components/motion';
import { useCall, callSupported, openMicSettings, type CallPeer } from '@/lib/call';
import { SoundHost } from '@/components/call/SoundHost';
import { primeAudio } from '@/lib/sound';
import { useAuth } from '@/store/auth';
import { isOnline, OFFLINE_MESSAGE } from '@/hooks/useOnline';
import { useT } from '@/lib/i18n';
import { colors, font, radius, shadow, glass, motion } from '@/lib/theme';

export function IncomingCallOverlay() {
  const router = useRouter();
  const t = useT();
  const { phase, incomingFrom, accept, decline, listen, stopListening, callId, orderId, micBlocked, error } = useCall();
  const uid = useAuth((s) => s.session?.user.id);

  // Dengarkan panggilan masuk; lepas channel saat keluar akun / berganti pengguna.
  useEffect(() => { if (uid) listen(); else stopListening(); }, [uid, listen, stopListening]);
  useEffect(() => { if (phase === 'connecting' && incomingFrom && callId) router.push(`/call/${callId}` as never); }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (phase === 'ended' && error) toast.error(error); }, [phase, error]);

  if (phase !== 'incoming' || !incomingFrom) return <SoundHost />;
  return (
    <Animated.View entering={FadeIn.duration(motion.base)} exiting={FadeOut.duration(motion.fast)} style={s.wrap} pointerEvents="box-none">
      <SoundHost />
      <Animated.View entering={ZoomIn.springify().stiffness(280).damping(16)} style={[s.card, shadow.sheet]}>
        {Platform.OS !== 'android' && <BlurView intensity={glass.blurStrong} tint="light" style={StyleSheet.absoluteFill} />}
        <View style={{ alignItems: 'center', gap: 10, padding: 20 }}>
          <Radar color={colors.success} size={130}><Avatar name={incomingFrom.name} url={incomingFrom.avatar} size={52} /></Radar>
          <Text style={font.label}>{t('incoming_call')}</Text>
          <Text style={font.h2}>{incomingFrom.name}</Text>
          <Text style={font.tiny}>{roleLabel(incomingFrom.role)}{orderId ? ' · pesanan aktif' : ''}</Text>
          <Text style={[font.tiny, { textAlign: 'center' }]}>{t('call_privacy')}</Text>
          {micBlocked && (
            <PressableScale onPress={openMicSettings} scaleTo={0.96} style={s.micWarn}>
              <Ionicons name="mic-off" size={14} color={colors.danger} />
              <Text style={{ color: colors.danger, fontSize: 12, fontWeight: '700', flex: 1 }}>Izin mikrofon diblokir. Ketuk untuk membuka Pengaturan.</Text>
            </PressableScale>
          )}
          <View style={{ flexDirection: 'row', gap: 24, marginTop: 8 }}>
            <PressableScale onPress={decline} scaleTo={0.88} accessibilityLabel="Tolak panggilan" style={[s.round, { backgroundColor: colors.danger }, shadow.glow(colors.danger)]}><Ionicons name="call" size={26} color="#fff" style={{ transform: [{ rotate: '135deg' }] }} /></PressableScale>
            <PressableScale onPress={() => { primeAudio(); accept(); }} scaleTo={0.88} accessibilityLabel="Angkat panggilan" style={[s.round, { backgroundColor: colors.success }, shadow.glow(colors.success)]}><Ionicons name="call" size={26} color="#fff" /></PressableScale>
          </View>
        </View>
      </Animated.View>
    </Animated.View>
  );
}

export function roleLabel(r?: string) { return r === 'driver' ? 'Mitra Driver' : r === 'merchant' ? 'Merchant' : r === 'admin' ? 'Admin AntarKita' : 'Pelanggan'; }

/** Tombol telepon dalam aplikasi (nomor tidak ditampilkan). */
export function CallButton({ peer, orderId, size = 44, color = colors.success, label }: { peer: CallPeer | null | undefined; orderId?: string | null; size?: number; color?: string; label?: string }) {
  const router = useRouter();
  const startCall = useCall((s) => s.startCall);
  const phase = useCall((s) => s.phase);
  const t = useT();
  const onPress = async () => {
    if (!peer) return;
    primeAudio();   // buka kunci autoplay browser dari gestur pengguna ini
    if (!callSupported) { toast.error(Platform.OS === 'web' ? 'Browser ini tidak mendukung panggilan' : 'Panggilan suara tersedia di APK build (bukan Expo Go)'); return; }
    if (!isOnline()) { toast.error(OFFLINE_MESSAGE); return; }
    if (phase !== 'idle' && phase !== 'ended') { toast.show('Sedang ada panggilan berlangsung'); return; }
    useCall.getState().reset();
    const id = await startCall(peer, orderId ?? null);
    if (id) router.push(`/call/${id}` as never);
    else { const r = useCall.getState().endReason; if (r) toast.error(r); }
  };
  if (label) return (
    <PressableScale onPress={onPress} scaleTo={0.95} style={[s.labelBtn, { backgroundColor: color + '14', borderColor: color + '44' }]}>
      <Ionicons name="call" size={16} color={color} /><Text style={{ color, fontWeight: '800', fontSize: 13 }}>{label ?? t('call')}</Text>
    </PressableScale>
  );
  return (
    <PressableScale onPress={onPress} scaleTo={0.9} style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }, shadow.glow(color)]}>
      <Ionicons name="call" size={size * 0.45} color="#fff" />
    </PressableScale>
  );
}

const s = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: 'rgba(11,31,42,0.35)', zIndex: 1000 },
  card: { width: '100%', maxWidth: 380, borderRadius: radius.xxl, overflow: 'hidden', backgroundColor: Platform.OS === 'android' ? 'rgba(255,255,255,0.98)' : 'rgba(255,255,255,0.8)', borderWidth: 1, borderColor: glass.border },
  round: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  labelBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.full, borderWidth: 1 },
  micWarn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.dangerLight, borderRadius: radius.md, paddingHorizontal: 10, paddingVertical: 8, marginTop: 4 },
});
