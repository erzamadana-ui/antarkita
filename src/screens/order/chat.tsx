import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, StyleSheet, ScrollView, KeyboardAvoidingView, Platform, Pressable } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { FadeInDown, FadeInUp, LinearTransition } from 'react-native-reanimated';
import { Screen, Row, Chip, toast, Avatar } from '@/components/ui';
import { PressableScale } from '@/components/motion';
import { BrandGradient } from '@/components/glass';
import { OfflineNotice } from '@/components/call/OfflineNotice';
import { ModerationMenu, ReportSheet } from '@/components/moderation';
import { notify } from '@/lib/push';
import { useOrderChat, useOrder } from '@/hooks/useOrder';
import { useAuth } from '@/store/auth';
import { colors, font, radius, glass, shadow, motion } from '@/lib/theme';
import { formatTime } from '@/lib/format';

const QUICK = ['Saya sudah di lokasi', 'Tunggu sebentar ya', 'Posisi di mana?', 'Terima kasih 🙏'];

export default function OrderChat() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const uid = useAuth((s) => s.session?.user.id);
  const { messages, send } = useOrderChat(id);
  const { order, driver, customer } = useOrder(id);
  const [text, setText] = useState('');
  const [reportMsg, setReportMsg] = useState<number | null>(null);
  const scroll = useRef<ScrollView>(null);
  const isCustomer = order?.customer_id === uid;
  const other = isCustomer ? driver?.profile : customer;
  const closed = order ? ['completed', 'cancelled', 'searching'].includes(order.status) : false;

  useEffect(() => { setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 50); }, [messages.length]);

  // Bunyi pendek + getar untuk pesan masuk dari lawan bicara (bukan pesan sendiri, bukan saat memuat riwayat).
  const lastSeen = useRef<number | null>(null);
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (!last) return;
    if (lastSeen.current === null) { lastSeen.current = last.id; return; }
    if (last.id === lastSeen.current) return;
    lastSeen.current = last.id;
    if (last.sender_id !== uid) notify('message');
  }, [messages, uid]);

  const submit = async (t: string) => {
    if (!uid || !t.trim()) return;
    try { await send(uid, t); setText(''); } catch (e) { toast.error((e as Error).message); }
  };

  // Lawan bicara: driver (bila saya pelanggan) atau pelanggan (bila saya driver/mitra).
  const otherId = isCustomer ? order?.driver_id ?? null : order?.customer_id ?? null;

  const title = (
    <Row gap={10} style={{ flex: 1 }}>
      <Avatar name={other?.full_name} url={other?.avatar_url} size={34} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[font.h3, { fontSize: 15 }]} numberOfLines={1}>{other?.full_name ?? 'Chat'}</Text>
        <Text style={font.tiny} numberOfLines={1}>{closed ? 'Chat ditutup' : 'Pesanan berlangsung'}</Text>
      </View>
      {/* Wajib kebijakan UGC Google Play: lapor & blokir harus mudah ditemukan di layar chat. */}
      {otherId && otherId !== uid ? <ModerationMenu userId={otherId} name={other?.full_name} kind="chat" targetId={id} size={34} /> : null}
    </Row>
  );

  return (
    <Screen back scroll={false} padded={false} keyboard={false} right={title}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }} keyboardVerticalOffset={60}>
        <OfflineNotice />
        <ScrollView ref={scroll} contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
          <Text style={[font.tiny, { textAlign: 'center', marginBottom: 8 }]}>
            Chat hanya tersedia selama pesanan berlangsung. Jaga sopan santun ya.{'\n'}
            Tekan lama sebuah pesan untuk melaporkannya, atau ketuk tombol ⋯ di atas untuk melaporkan/memblokir.
          </Text>
          {messages.map((m, i) => {
            const mine = m.sender_id === uid;
            const last = i >= messages.length - 1;
            const bubble = (
              <Animated.View entering={last ? (mine ? FadeInUp : FadeInDown).springify().stiffness(280).damping(18) : undefined} layout={LinearTransition.springify().stiffness(280).damping(20)} style={[s.bubble, mine ? s.mine : s.theirs]}>
                {mine && <BrandGradient style={StyleSheet.absoluteFill} />}
                <Text style={{ color: mine ? '#fff' : colors.text, fontSize: 15, lineHeight: 21 }}>{m.body}</Text>
                <Text style={{ fontSize: 12, color: mine ? 'rgba(255,255,255,0.92)' : colors.textMuted, marginTop: 2, alignSelf: 'flex-end' }}>{formatTime(m.created_at)}</Text>
              </Animated.View>
            );
            // Pesan lawan bicara bisa dilaporkan langsung (tekan lama) — jalur pelaporan konten UGC.
            return mine ? <View key={m.id}>{bubble}</View> : (
              <Pressable key={m.id} onLongPress={() => setReportMsg(m.id)} delayLongPress={350} accessibilityHint="Tekan lama untuk melaporkan pesan ini">{bubble}</Pressable>
            );
          })}
        </ScrollView>
        {!closed && (
          <Animated.View entering={FadeInUp.duration(motion.base)} style={s.composer}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 10 }}>
              {QUICK.map((q) => <Chip key={q} label={q} onPress={() => submit(q)} />)}
            </ScrollView>
            <Row gap={8}>
              <TextInput value={text} onChangeText={setText} placeholder="Tulis pesan…" placeholderTextColor={colors.textMuted} style={s.input} onSubmitEditing={() => submit(text)} blurOnSubmit={false} />
              <PressableScale onPress={() => submit(text)} scaleTo={0.88} style={[s.send, shadow.glow(colors.primary)]} disabled={!text.trim()}>
                <BrandGradient style={StyleSheet.absoluteFill} />
                <Ionicons name="send" size={18} color="#fff" />
              </PressableScale>
            </Row>
          </Animated.View>
        )}
        {closed && <Text style={[font.small, { textAlign: 'center', padding: 16 }]}>Chat ditutup.</Text>}
      </KeyboardAvoidingView>
      <ReportSheet visible={reportMsg != null} onClose={() => setReportMsg(null)} kind="chat" targetId={reportMsg == null ? null : String(reportMsg)} targetUserId={otherId} targetName={other?.full_name} />
    </Screen>
  );
}

const s = StyleSheet.create({
  bubble: { maxWidth: '80%', padding: 12, borderRadius: radius.lg, overflow: 'hidden' },
  mine: { alignSelf: 'flex-end', borderBottomRightRadius: 6, ...shadow.soft },
  theirs: { alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.8)', borderBottomLeftRadius: 6, borderWidth: 1, borderColor: glass.border },
  composer: { padding: 12, backgroundColor: 'rgba(255,255,255,0.92)', borderTopWidth: 1, borderTopColor: glass.border },
  input: { flex: 1, backgroundColor: 'rgba(255,255,255,0.85)', borderRadius: radius.full, paddingHorizontal: 16, height: 46, color: colors.text, borderWidth: 1, borderColor: glass.border, fontSize: 15 },
  send: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
});
