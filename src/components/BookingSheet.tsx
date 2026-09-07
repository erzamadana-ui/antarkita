import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Row, Input, Button, toast } from '@/components/ui';
import { PressableScale } from '@/components/motion';
import { useAuth } from '@/store/auth';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { colors, font, radius, glass, shadow } from '@/lib/theme';
import { rupiah } from '@/lib/format';
import type { PaymentMethod, ServiceType } from '@/lib/types';
import { usePayPrefs, EWALLETS } from '@/store/payprefs';
import { useEffect } from 'react';


/** Pilihan metode bayar + promo + catatan — dipakai ride, food, send. */
export type PayChoice = PaymentMethod | 'ewallet';
/** Nilai `paid_via` untuk create_order: 'cash' | 'wallet' | kode e-wallet (gopay/ovo/…). */
export const paidViaOf = (m: PayChoice, ewallet?: string | null) => (m === 'ewallet' ? (ewallet ?? 'gopay') : m);
/** Tangani error SALDO_KURANG:<nominal> → buka gateway e-wallet untuk kekurangannya. Mengembalikan true bila ditangani. */
export function handleShortfall(e: unknown, router: ReturnType<typeof useRouter>, ewallet?: string | null) {
  const m = /SALDO_KURANG:(\d+)/.exec((e as Error).message ?? '');
  if (!m) return false;
  const amount = Math.max(10000, Math.ceil(Number(m[1]) / 1000) * 1000);
  toast.show(`Saldo kurang ${rupiah(Number(m[1]))} — lengkapi lewat ${ewallet ? (EWALLETS.find((x) => x.key === ewallet)?.label ?? 'e-wallet') : 'e-wallet'}`);
  router.push({ pathname: '/pay/gateway', params: { amount: String(amount), method: ewallet ?? 'gopay', reason: 'order' } } as never);
  return true;
}

export function PaymentSection({ method, onMethod, promo, onPromo, notes, onNotes, subtotal, service, onDiscount, notesPlaceholder }: {
  method: PayChoice; onMethod: (m: PayChoice) => void; promo: string; onPromo: (v: string) => void;
  notes: string; onNotes: (v: string) => void; subtotal: number; service: ServiceType; onDiscount: (d: number) => void; notesPlaceholder?: string;
}) {
  const { wallet, session } = useAuth();
  const router = useRouter();
  const { prefs, loaded, load } = usePayPrefs();
  useEffect(() => { if (session && !loaded) load(session.user.id); }, [session, loaded, load]);
  useEffect(() => { if (loaded && prefs && !appliedRef.current) { appliedRef.current = true; onMethod(prefs.default_method); } }, [loaded]); // eslint-disable-line react-hooks/exhaustive-deps
  const appliedRef = React.useRef(false);
  const ew = EWALLETS.find((x) => x.key === prefs?.ewallet) ?? EWALLETS[0];
  const [checking, setChecking] = useState(false);
  const [promoMsg, setPromoMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const checkPromo = async () => {
    if (!promo.trim()) { onDiscount(0); setPromoMsg(null); return; }
    setChecking(true);
    const { data, error } = await supabase.rpc('apply_promo', { p_code: promo.trim(), p_service: service, p_subtotal: subtotal });
    setChecking(false);
    if (error) { onDiscount(0); setPromoMsg({ ok: false, text: error.message.replace(/^.*?:\s*/, '') }); return; }
    onDiscount(Number(data)); setPromoMsg({ ok: true, text: `Hemat ${rupiah(Number(data))}` }); toast.success('Promo diterapkan');
  };

  return (
    <View style={{ gap: 12 }}>
      <Text style={font.label}>Pembayaran</Text>
      <Row gap={8}>
        <PayOption active={method === 'cash'} onPress={() => onMethod('cash')} icon="cash-outline" title="Tunai" subtitle="Ke driver" />
        <PayOption active={method === 'wallet'} onPress={() => onMethod('wallet')} icon="wallet-outline" title="AntarPay" subtitle={rupiah(wallet?.balance ?? 0)} />
        <PayOption active={method === 'ewallet'} onPress={() => onMethod('ewallet')} icon="phone-portrait-outline" title={ew.label} subtitle="e-wallet" color={ew.color} />
      </Row>
      <PressableScale onPress={() => router.push('/(customer)/pay' as never)} scaleTo={0.98} haptic={false} style={s.gwRow}>
        <View style={s.gwIcons}>{['#00AA13', '#4C2A86', '#118EEA', '#EE4D2D'].map((c) => <View key={c} style={[s.gwDot, { backgroundColor: c }]} />)}</View>
        <View style={{ flex: 1 }}><Text style={{ fontWeight: '700', color: colors.text, fontSize: 13 }}>{method === 'ewallet' ? `Bayar dengan ${ew.label} (via Midtrans)` : 'Ganti e-wallet / metode utama'}</Text><Text style={font.tiny}>{method === 'ewallet' ? 'Bila saldo AntarPay kurang, halaman bayar dibuka otomatis untuk kekurangannya.' : 'GoPay · OVO · DANA · ShopeePay · QRIS · VA Bank'}</Text></View>
        <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
      </PressableScale>
      <Row gap={8}>
        <View style={{ flex: 1 }}>
          <Input placeholder="Kode promo" value={promo} onChangeText={(v) => { onPromo(v.toUpperCase()); setPromoMsg(null); }} autoCapitalize="characters" icon="pricetag-outline" />
        </View>
        <Button title="Pakai" size="md" variant="secondary" loading={checking} onPress={checkPromo} />
      </Row>
      {promoMsg && <Text style={{ color: promoMsg.ok ? colors.success : colors.danger, fontSize: 12, marginTop: -6 }}>{promoMsg.text}</Text>}
      <View style={s.notes}>
        <Ionicons name="chatbox-ellipses-outline" size={18} color={colors.textMuted} />
        <TextInput placeholder={notesPlaceholder ?? 'Catatan untuk driver (opsional)'} placeholderTextColor={colors.textMuted} value={notes} onChangeText={onNotes} style={s.notesInput} />
      </View>
    </View>
  );
}

function PayOption({ active, onPress, icon, title, subtitle, color = colors.primary }: { active: boolean; onPress: () => void; icon: React.ComponentProps<typeof Ionicons>['name']; title: string; subtitle: string; color?: string }) {
  return (
    <PressableScale onPress={onPress} scaleTo={0.97} style={[s.pay, active && { borderColor: color, backgroundColor: color + '14', ...shadow.glow(color) }]}>
      <View style={[s.payIcon, active && { backgroundColor: color }]}><Ionicons name={icon} size={18} color={active ? '#fff' : colors.textSecondary} /></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontWeight: '700', color: colors.text, fontSize: 13 }} numberOfLines={1}>{title}</Text>
        <Text style={font.tiny} numberOfLines={1}>{subtitle}</Text>
      </View>
    </PressableScale>
  );
}

export function PriceSummary({ rows, total }: { rows: { label: string; value: number; minus?: boolean }[]; total: number }) {
  return (
    <View style={{ gap: 6 }}>
      {rows.filter((r) => r.value !== 0).map((r) => (
        <Row key={r.label} between>
          <Text style={font.small}>{r.label}</Text>
          <Text style={{ color: r.minus ? colors.success : colors.text, fontWeight: '600' }}>{r.minus ? '-' : ''}{rupiah(r.value)}</Text>
        </Row>
      ))}
      <Row between style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8, marginTop: 2 }}>
        <Text style={font.h3}>Total</Text>
        <Text style={[font.h2, { color: colors.primary }]}>{rupiah(total)}</Text>
      </Row>
    </View>
  );
}

const s = StyleSheet.create({
  pay: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1.5, borderColor: 'rgba(11,31,42,0.08)', borderRadius: radius.lg, padding: 10, backgroundColor: 'rgba(255,255,255,0.92)' },
  payIcon: { width: 30, height: 30, borderRadius: 10, backgroundColor: 'rgba(11,31,42,0.06)', alignItems: 'center', justifyContent: 'center' },
  gwRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: radius.lg, backgroundColor: 'rgba(255,255,255,0.92)', borderWidth: 1, borderColor: glass.border },
  gwIcons: { flexDirection: 'row', flexWrap: 'wrap', width: 34, gap: 3 },
  gwDot: { width: 14, height: 14, borderRadius: 4 },
  notes: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(255,255,255,0.92)', borderWidth: 1, borderColor: glass.border, borderRadius: radius.md, paddingHorizontal: 12 },
  notesInput: { flex: 1, height: 44, color: colors.text, fontSize: 14 },
});
