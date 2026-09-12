// Tip (pelanggan) & biaya tambahan parkir/tol/tunggu (driver mengajukan → pelanggan menyetujui)
import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import { Row, Button, Chip, Badge, toast } from '@/components/ui';
import { PressableScale, useShake } from '@/components/motion';
import { rpc } from '@/lib/supabase';
import { useAuth } from '@/store/auth';
import { colors, font, radius, glass, motion } from '@/lib/theme';
import { rupiah, extraKindLabel } from '@/lib/format';
import type { Order, OrderExtra } from '@/lib/types';

const TIPS = [2000, 5000, 10000, 20000];

/** Kartu tip untuk pelanggan (selama & setelah order). */
export function TipCard({ order, onDone }: { order: Order; onDone: () => void }) {
  const wallet = useAuth((s) => s.wallet);
  const refreshWallet = useAuth((s) => s.refreshWallet);
  const [amount, setAmount] = useState<number>(0);
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  const { style, shake } = useShake();
  const val = amount || Number(custom.replace(/\D/g, '')) || 0;
  const give = async () => {
    if (val < 1000) { shake(); return; }
    if ((wallet?.balance ?? 0) < val) { shake(); toast.error('Saldo AntarPay tidak cukup untuk tip'); return; }
    setBusy(true);
    try { await rpc('add_tip', { p_order_id: order.id, p_amount: val }); await refreshWallet(); toast.success(`Tip ${rupiah(val)} dikirim ke driver 🙏`); setAmount(0); setCustom(''); onDone(); }
    catch (e) { toast.error((e as Error).message); }
    setBusy(false);
  };
  return (
    <Animated.View style={[s.card, style]} layout={LinearTransition.springify().stiffness(280).damping(20)}>
      <Row gap={8}><Ionicons name="heart" size={20} color={colors.food} /><Text style={font.h3}>Beri tip driver</Text>{(order.tip ?? 0) > 0 && <Badge text={`Sudah ${rupiah(order.tip ?? 0)}`} color={colors.success} />}</Row>
      <Text style={font.tiny}>100% tip diterima driver. Dipotong dari saldo AntarPay ({rupiah(wallet?.balance ?? 0)}).</Text>
      <Row gap={8} style={{ flexWrap: 'wrap' }}>{TIPS.map((v) => <Chip key={v} label={rupiah(v)} active={amount === v} onPress={() => { setAmount(v); setCustom(''); }} color={colors.food} />)}</Row>
      <Row gap={8}>
        <TextInput placeholder="Nominal lain" placeholderTextColor={colors.textMuted} keyboardType="number-pad" value={custom} onChangeText={(v) => { setCustom(v.replace(/\D/g, '')); setAmount(0); }} style={s.input} />
        <Button title={val ? `Kirim ${rupiah(val)}` : 'Kirim tip'} size="md" color={colors.food} loading={busy} disabled={!val} onPress={give} />
      </Row>
    </Animated.View>
  );
}

/** Persetujuan biaya tambahan (pelanggan) — tampil saat ada yang pending. */
export function ExtrasApproval({ order, onDone }: { order: Order; onDone: () => void }) {
  const pending = (order.extras ?? []).filter((e) => e.status === 'pending');
  const refreshWallet = useAuth((s) => s.refreshWallet);
  const [busy, setBusy] = useState<string | null>(null);
  if (pending.length === 0) return null;
  const respond = async (e: OrderExtra, ok: boolean) => {
    setBusy(e.id);
    try { await rpc('respond_extra', { p_order_id: order.id, p_extra_id: e.id, p_approve: ok }); await refreshWallet(); toast.show(ok ? 'Biaya tambahan disetujui' : 'Biaya tambahan ditolak'); onDone(); }
    catch (err) { toast.error((err as Error).message); }
    setBusy(null);
  };
  return (
    <Animated.View entering={FadeInDown.springify().stiffness(280).damping(16)} style={[s.card, { borderColor: colors.warning + '66', backgroundColor: 'rgba(245,158,11,0.10)' }]}>
      <Row gap={8}><Ionicons name="alert-circle" size={20} color={colors.warning} /><Text style={font.h3}>Driver mengajukan biaya tambahan</Text></Row>
      {pending.map((e) => (
        <View key={e.id} style={{ gap: 8 }}>
          <Row between>
            <View style={{ flex: 1 }}><Text style={{ fontWeight: '700', color: colors.text }}>{extraKindLabel[e.kind]}{e.note ? ` · ${e.note}` : ''}</Text><Text style={font.tiny}>{order.payment_method === 'wallet' ? 'Dipotong dari saldo AntarPay' : 'Dibayar tunai ke driver'}</Text></View>
            <Text style={{ fontWeight: '700', fontSize: 18, color: colors.text }}>{rupiah(e.amount)}</Text>
          </Row>
          <Row gap={8}>
            <Button title="Tolak" size="sm" variant="outline" color={colors.danger} loading={busy === e.id} onPress={() => respond(e, false)} />
            <Button title="Setujui" size="sm" color={colors.success} style={{ flex: 1 }} loading={busy === e.id} onPress={() => respond(e, true)} />
          </Row>
        </View>
      ))}
    </Animated.View>
  );
}

/** Driver: ajukan biaya parkir/tol/tunggu. */
export function ExtraRequest({ order, onDone }: { order: Order; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<'parking' | 'toll' | 'waiting' | 'other'>('parking');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = (order.extras ?? []).filter((e) => e.status === 'pending');
  const submit = async () => {
    const v = Number(amount.replace(/\D/g, ''));
    if (v < 1000) { toast.error('Minimal Rp1.000'); return; }
    setBusy(true);
    try { await rpc('request_extra', { p_order_id: order.id, p_kind: kind, p_amount: v, p_note: note || null }); toast.success('Diajukan, menunggu persetujuan pelanggan'); setAmount(''); setNote(''); setOpen(false); onDone(); }
    catch (e) { toast.error((e as Error).message); }
    setBusy(false);
  };
  return (
    <Animated.View layout={LinearTransition.springify().stiffness(280).damping(20)} style={s.card}>
      <Row between>
        <Row gap={8}><Ionicons name="receipt-outline" size={20} color={colors.warning} /><Text style={font.h3}>Biaya tambahan</Text>{pending.length > 0 && <Badge text={`${pending.length} menunggu`} color={colors.warning} />}</Row>
        <PressableScale onPress={() => setOpen(!open)} scaleTo={0.9} style={s.plus}><Ionicons name={open ? 'remove' : 'add'} size={20} color={colors.primary} /></PressableScale>
      </Row>
      {open && (
        <Animated.View entering={FadeInDown.duration(motion.base)} style={{ gap: 10 }}>
          <Row gap={8} style={{ flexWrap: 'wrap' }}>{(['parking', 'toll', 'waiting', 'other'] as const).map((k) => <Chip key={k} label={extraKindLabel[k]} active={kind === k} onPress={() => setKind(k)} color={colors.warning} />)}</Row>
          <Row gap={8}>
            <TextInput placeholder="Nominal (Rp)" placeholderTextColor={colors.textMuted} keyboardType="number-pad" value={amount} onChangeText={(v) => setAmount(v.replace(/\D/g, ''))} style={s.input} />
            <TextInput placeholder="Catatan" placeholderTextColor={colors.textMuted} value={note} onChangeText={setNote} style={[s.input, { flex: 1.4 }]} />
          </Row>
          <Button title="Ajukan ke pelanggan" size="sm" color={colors.warning} loading={busy} onPress={submit} />
          <Text style={font.tiny}>Pelanggan harus menyetujui. Biaya masuk 100% ke pendapatan Anda.</Text>
        </Animated.View>
      )}
    </Animated.View>
  );
}

const s = StyleSheet.create({
  card: { gap: 10, backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: radius.lg, padding: 14, borderWidth: 1, borderColor: glass.border },
  input: { flex: 1, height: 44, borderRadius: radius.md, borderWidth: 1, borderColor: glass.border, backgroundColor: 'rgba(255,255,255,0.85)', paddingHorizontal: 12, color: colors.text },
  plus: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.primary + '14', alignItems: 'center', justifyContent: 'center' },
});
