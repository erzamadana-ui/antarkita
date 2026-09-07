// Percakapan tiket (pengguna ↔ CS) — dipakai di layar tiket pengguna & panel CS admin
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, StyleSheet, ScrollView, Pressable, Linking, KeyboardAvoidingView, Platform } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { FadeInDown, FadeInUp, LinearTransition } from 'react-native-reanimated';
import { Row, Chip, Badge, toast } from '@/components/ui';
import { PressableScale } from '@/components/motion';
import { BrandGradient } from '@/components/glass';
import { pickAndUpload, signedUrl } from '@/lib/upload';
import { useAuth } from '@/store/auth';
import { colors, font, radius, glass, shadow, motion } from '@/lib/theme';
import { formatTime, formatDate, ticketStatusLabel, ticketStatusColor } from '@/lib/format';
import type { Ticket, TicketMessage } from '@/lib/types';

const QUICK_USER = ['Masih belum selesai', 'Sudah beres, terima kasih 🙏', 'Mohon dicek lagi'];
const QUICK_CS = ['Halo, saya CS AntarKita. Bisa dibantu?', 'Sedang kami cek, mohon tunggu ±10 menit.', 'Sudah kami selesaikan ya. Ada lagi yang bisa dibantu?', 'Mohon kirim tangkapan layar / bukti transaksi.'];

export function TicketChat({ ticket, messages, onSend, asCs, footer, style }: {
  ticket: Ticket | null; messages: TicketMessage[];
  onSend: (body: string, attachment?: string | null, internal?: boolean) => Promise<void>;
  asCs?: boolean; footer?: React.ReactNode; style?: object;
}) {
  const session = useAuth((s) => s.session);
  const [text, setText] = useState('');
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState(false);
  const scroll = useRef<ScrollView>(null);
  useEffect(() => { setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 60); }, [messages.length]);
  const closed = ticket?.status === 'closed';

  const submit = async (t: string, attachment?: string | null) => {
    if (!t.trim() && !attachment) return;
    setBusy(true);
    try { await onSend(t, attachment, internal); setText(''); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  const attach = async () => {
    if (!session) return;
    try { const r = await pickAndUpload('proofs', session.user.id); if (r) await submit(text || '📎 Lampiran', r.path); } catch (e) { toast.error((e as Error).message); }
  };
  const openAttachment = async (path: string) => { const u = path.startsWith('http') ? path : await signedUrl('proofs', path); if (u) Linking.openURL(u); };

  let lastDay = '';
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[{ flex: 1 }, style]} keyboardVerticalOffset={70}>
      <ScrollView ref={scroll} contentContainerStyle={{ padding: 14, gap: 8, paddingBottom: 20 }} showsVerticalScrollIndicator={false}>
        {messages.map((m, i) => {
          const day = formatDate(m.created_at, false);
          const showDay = day !== lastDay; lastDay = day;
          const mine = asCs ? m.sender_role === 'cs' : m.sender_role === 'user';
          const system = m.sender_role === 'system';
          const last = i >= messages.length - 1;
          return (
            <View key={m.id}>
              {showDay && <Text style={[font.tiny, { textAlign: 'center', marginVertical: 6 }]}>{day}</Text>}
              {system ? (
                <Animated.View entering={last ? FadeInDown.duration(motion.base) : undefined} style={s.system}><Ionicons name="information-circle-outline" size={14} color={colors.textSecondary} /><Text style={[font.tiny, { flex: 1 }]}>{m.body}</Text></Animated.View>
              ) : (
                <Animated.View entering={last ? (mine ? FadeInUp : FadeInDown).springify().stiffness(280).damping(18) : undefined} layout={LinearTransition.springify().stiffness(280).damping(20)}
                  style={[s.bubble, mine ? s.mine : s.theirs, m.is_internal && s.internal]}>
                  {mine && !m.is_internal && <BrandGradient colors={asCs ? [colors.info, '#1D4ED8'] : undefined} style={StyleSheet.absoluteFill} />}
                  {!mine && <Text style={[font.tiny, { fontWeight: '800', color: m.sender_role === 'cs' ? colors.info : colors.textSecondary, marginBottom: 2 }]}>{m.sender_role === 'cs' ? 'CS AntarKita' : 'Pengguna'}</Text>}
                  {!!m.is_internal && <Text style={[font.tiny, { fontWeight: '800', color: colors.warning, marginBottom: 2 }]}>Catatan internal (tak terlihat pengguna)</Text>}
                  <Text style={{ color: mine && !m.is_internal ? '#fff' : colors.text, fontSize: 15, lineHeight: 21 }}>{m.body}</Text>
                  {m.attachment_url && (
                    <Pressable onPress={() => openAttachment(m.attachment_url!)} style={s.attach}><Ionicons name="image-outline" size={14} color={mine && !m.is_internal ? '#fff' : colors.info} /><Text style={{ fontSize: 12, fontWeight: '700', color: mine && !m.is_internal ? '#fff' : colors.info }}>Lihat lampiran</Text></Pressable>
                  )}
                  <Text style={{ fontSize: 12, color: mine && !m.is_internal ? 'rgba(255,255,255,0.92)' : colors.textMuted, marginTop: 2, alignSelf: 'flex-end' }}>{formatTime(m.created_at)}</Text>
                </Animated.View>
              )}
            </View>
          );
        })}
        {ticket && ['resolved', 'closed'].includes(ticket.status) && (
          <View style={[s.system, { alignSelf: 'center' }]}><Badge text={ticketStatusLabel[ticket.status]} color={ticketStatusColor(ticket.status)} /></View>
        )}
      </ScrollView>
      {footer}
      {!closed || asCs ? (
        <Animated.View entering={FadeInUp.duration(motion.base)} style={s.composer}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 10 }}>
            {asCs && <Chip label={internal ? '🔒 Catatan internal' : 'Balasan ke pengguna'} active={internal} onPress={() => setInternal(!internal)} color={colors.warning} />}
            {(asCs ? QUICK_CS : QUICK_USER).map((q) => <Chip key={q} label={q} onPress={() => submit(q)} color={asCs ? colors.info : colors.primary} />)}
          </ScrollView>
          <Row gap={8}>
            <PressableScale onPress={attach} scaleTo={0.9} style={s.attachBtn}><Ionicons name="attach" size={20} color={colors.textSecondary} /></PressableScale>
            <TextInput value={text} onChangeText={setText} placeholder={internal ? 'Catatan internal…' : 'Tulis pesan ke CS…'} placeholderTextColor={colors.textMuted} style={s.input} onSubmitEditing={() => submit(text)} blurOnSubmit={false} editable={!busy} />
            <PressableScale onPress={() => submit(text)} scaleTo={0.88} style={[s.send, shadow.glow(asCs ? colors.info : colors.primary)]} disabled={!text.trim() || busy}>
              <BrandGradient colors={asCs ? [colors.info, '#1D4ED8'] : undefined} style={StyleSheet.absoluteFill} />
              <Ionicons name="send" size={18} color="#fff" />
            </PressableScale>
          </Row>
        </Animated.View>
      ) : <Text style={[font.small, { textAlign: 'center', padding: 14 }]}>Tiket sudah ditutup. Buat tiket baru bila masih ada kendala.</Text>}
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  bubble: { maxWidth: '82%', padding: 12, borderRadius: radius.lg, overflow: 'hidden' },
  mine: { alignSelf: 'flex-end', borderBottomRightRadius: 6, ...shadow.soft },
  theirs: { alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.85)', borderBottomLeftRadius: 6, borderWidth: 1, borderColor: glass.border },
  internal: { backgroundColor: 'rgba(245,158,11,0.14)', borderWidth: 1, borderColor: colors.warning + '66' },
  system: { flexDirection: 'row', gap: 6, alignItems: 'center', alignSelf: 'center', maxWidth: '90%', backgroundColor: 'rgba(11,31,42,0.05)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.full },
  attach: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  composer: { padding: 12, backgroundColor: 'rgba(255,255,255,0.92)', borderTopWidth: 1, borderTopColor: glass.border },
  input: { flex: 1, backgroundColor: 'rgba(255,255,255,0.85)', borderRadius: radius.full, paddingHorizontal: 16, height: 46, color: colors.text, borderWidth: 1, borderColor: glass.border, fontSize: 15 },
  send: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  attachBtn: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(11,31,42,0.06)' },
});
