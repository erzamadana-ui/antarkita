// Layar panggilan suara (keluar/masuk) — WebRTC, nomor HP tidak pernah tampil.
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { Avatar, Button } from '@/components/ui';
import { AmbientBackground } from '@/components/glass';
import { PressableScale, Radar, LiveDot } from '@/components/motion';
import { roleLabel } from '@/components/call/IncomingCall';
import { OfflineNotice } from '@/components/call/OfflineNotice';
import { useCall, speakerRoutingSupported, openMicSettings } from '@/lib/call';
import { tap } from '@/lib/sound';
import { useT } from '@/lib/i18n';
import { colors, font, radius, shadow, motion } from '@/lib/theme';

export default function CallScreen() {
  const router = useRouter();
  const t = useT();
  const { phase, peer, muted, speaker, startedAt, endReason, remoteRinging, micBlocked, hangup, toggleMute, toggleSpeaker, reset } = useCall();
  const [tick, setTick] = useState(0);
  useEffect(() => { const i = setInterval(() => setTick((x) => x + 1), 1000); return () => clearInterval(i); }, []);
  useEffect(() => { if (phase === 'idle') { router.canGoBack() ? router.back() : router.replace('/'); } }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps
  const dur = startedAt ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000)) : 0;
  const mm = String(Math.floor(dur / 60)).padStart(2, '0'), ss = String(dur % 60).padStart(2, '0');
  const status = phase === 'outgoing' ? (remoteRinging ? 'Berdering…' : t('calling'))
    : phase === 'connecting' ? t('connecting')
    : phase === 'active' ? `${mm}:${ss}`
    : phase === 'ended' ? (endReason ?? t('call_ended')) : t('incoming_call');
  const close = () => { reset(); };
  void tick;

  // Tombol speaker: bila platform tidak mendukung, tombol NONAKTIF (bukan toast error merah).
  // Bila didukung, statusnya selalu mengikuti rute yang benar-benar berlaku (lihat src/lib/audioRoute.*).
  const [speakerBusy, setSpeakerBusy] = useState(false);
  const onSpeaker = async () => {
    if (!speakerRoutingSupported || speakerBusy) return;
    tap();
    setSpeakerBusy(true);
    try { await toggleSpeaker(); } finally { setSpeakerBusy(false); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <AmbientBackground tint={phase === 'active' ? 'teal' : 'mixed'} />
      <SafeAreaView style={{ flex: 1 }}>
        <OfflineNotice />
        <Animated.View entering={FadeIn.duration(motion.slow)} style={s.wrap}>
          <View style={{ alignItems: 'center', gap: 12 }}>
            {phase === 'active' ? (
              <View style={{ width: 150, height: 150, alignItems: 'center', justifyContent: 'center' }}><Avatar name={peer?.name} url={peer?.avatar} size={110} /><View style={s.live}><LiveDot color={colors.success} size={8} /></View></View>
            ) : (
              <Radar color={phase === 'ended' ? colors.textMuted : colors.primary} size={170}><Avatar name={peer?.name} url={peer?.avatar} size={66} /></Radar>
            )}
            <Text style={font.display}>{peer?.name ?? '—'}</Text>
            <Text style={font.small}>{roleLabel(peer?.role)}</Text>
            <Animated.Text key={status} entering={FadeIn.duration(motion.base)} style={[font.h2, { color: phase === 'active' ? colors.success : phase === 'ended' ? colors.textSecondary : colors.textSecondary, textAlign: 'center' }]}>{status}</Animated.Text>
            <Text style={[font.tiny, { textAlign: 'center', maxWidth: 300 }]}>{t('call_privacy')}</Text>
            {micBlocked && (
              <PressableScale onPress={openMicSettings} scaleTo={0.96} style={s.micWarn}>
                <Ionicons name="mic-off" size={16} color={colors.danger} />
                <Text style={{ color: colors.danger, fontSize: 14, fontWeight: '700', flex: 1 }}>Izin mikrofon diblokir. Ketuk untuk membuka Pengaturan aplikasi.</Text>
              </PressableScale>
            )}
          </View>

          <Animated.View entering={FadeInDown.delay(150).duration(motion.slow)} style={{ alignItems: 'center', gap: 18 }}>
            {phase !== 'ended' ? (
              <>
                <View style={{ flexDirection: 'row', gap: 22 }}>
                  <Ctrl icon={muted ? 'mic-off' : 'mic'} label={muted ? 'Bisu' : t('mute')} active={muted} onPress={() => { tap(); toggleMute(); }} />
                  <Ctrl
                    icon={speakerRoutingSupported && speaker ? 'volume-high' : 'volume-low'}
                    label={t('speaker')}
                    active={speakerRoutingSupported && speaker}
                    disabled={!speakerRoutingSupported || speakerBusy}
                    onPress={onSpeaker}
                  />
                </View>
                {!speakerRoutingSupported && (
                  // Keterangan netral (abu-abu kecil), bukan pesan kesalahan.
                  <Text style={[font.tiny, { textAlign: 'center', maxWidth: 320 }]}>
                    Rute pengeras suara tidak bisa diatur dari sini di perangkat/browser ini. Suara panggilan memakai keluaran bawaan perangkat.
                  </Text>
                )}
                <PressableScale onPress={() => { tap(); hangup(); }} scaleTo={0.88} accessibilityLabel="Akhiri panggilan" style={[s.end, shadow.glow(colors.danger)]}>
                  <Ionicons name="call" size={32} color="#fff" style={{ transform: [{ rotate: '135deg' }] }} />
                </PressableScale>
                <Text style={font.tiny}>{t('end_call')}</Text>
              </>
            ) : (
              <Button title={t('close')} size="lg" variant="secondary" style={{ minWidth: 200 }} onPress={close} />
            )}
          </Animated.View>
        </Animated.View>
      </SafeAreaView>
    </View>
  );
}

function Ctrl({ icon, label, active, disabled, onPress }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; active?: boolean; disabled?: boolean; onPress: () => void }) {
  return (
    <View style={{ alignItems: 'center', gap: 6 }}>
      <PressableScale
        onPress={disabled ? () => {} : onPress}
        // `disabled` diteruskan ke Pressable: hanya dari situ react-native-web menghasilkan
        // aria-disabled di DOM. accessibilityState saja tidak cukup, sehingga sebelumnya pembaca
        // layar mengira tombol speaker masih bisa ditekan padahal tampilannya sudah redup.
        disabled={disabled}
        scaleTo={disabled ? 1 : 0.9}
        accessibilityRole="button"
        accessibilityState={{ disabled: !!disabled, selected: !!active }}
        accessibilityLabel={label}
        style={[s.ctrl, active && { backgroundColor: colors.primary, borderColor: colors.primary }, disabled && s.ctrlOff]}
      >
        <Ionicons name={icon} size={24} color={active ? '#fff' : disabled ? colors.textMuted : colors.text} />
      </PressableScale>
      <Text style={[font.tiny, disabled && { color: colors.textMuted }]}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'space-evenly', padding: 24 },
  live: { position: 'absolute', bottom: 22, right: 22, backgroundColor: '#fff', borderRadius: 12, padding: 3 },
  ctrl: { width: 62, height: 62, borderRadius: 31, backgroundColor: 'rgba(255,255,255,0.92)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.8)', alignItems: 'center', justifyContent: 'center', ...shadow.soft },
  // Nonaktif = redup & datar (tanpa warna bahaya) — ini keterbatasan, bukan kesalahan pengguna.
  // Peredupan (opacity) datang dari PressableScale saat `disabled`; di sini cukup latar yang lebih datar
  // supaya keduanya tidak bertumpuk dan tombol jadi nyaris tak terlihat.
  ctrlOff: { backgroundColor: 'rgba(255,255,255,0.6)' },
  end: { width: 76, height: 76, borderRadius: 38, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center' },
  micWarn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.dangerLight, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, maxWidth: 340 },
});
