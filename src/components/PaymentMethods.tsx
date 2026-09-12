// Pusat metode pembayaran: tunai, AntarPay, e-wallet pilihan (via Midtrans), e-money NFC (cek perangkat)
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Card, Row, Badge, Button, toast } from '@/components/ui';
import { Entrance, PressableScale, AnimatedNumber } from '@/components/motion';
import { BrandGradient } from '@/components/glass';
import { useAuth } from '@/store/auth';
import { usePayPrefs, EWALLETS } from '@/store/payprefs';
import { colors, font, radius, glass, shadow } from '@/lib/theme';
import { rupiah } from '@/lib/format';

/** Deteksi dukungan NFC (untuk e-money BCA Flazz / Mandiri e-money / BRIZZI). Web: Web NFC hanya Chrome Android. */
export function useNfcSupport() {
  const [state, setState] = useState<'unknown' | 'supported' | 'unsupported'>('unknown');
  useEffect(() => {
    if (Platform.OS === 'web') setState(typeof window !== 'undefined' && 'NDEFReader' in window ? 'supported' : 'unsupported');
    else if (Platform.OS === 'android') setState('supported');   // mayoritas Android punya NFC; dicek lagi saat modul e-money diaktifkan
    else setState('unsupported');                                 // iOS: pembacaan e-money butuh Core NFC + lisensi bank
  }, []);
  return state;
}

export function PaymentMethodsPanel({ compact }: { compact?: boolean }) {
  const router = useRouter();
  const { session, wallet } = useAuth();
  const uid = session?.user.id;
  const { prefs, loaded, load, save } = usePayPrefs();
  const nfc = useNfcSupport();
  useEffect(() => { if (uid && !loaded) load(uid); }, [uid, loaded, load]);
  if (!uid) return null;
  const method = prefs?.default_method ?? 'cash';
  const ew = prefs?.ewallet ?? null;
  const pick = async (m: 'cash' | 'wallet' | 'ewallet', wallet?: string) => {
    await save(uid, { default_method: m, ewallet: (wallet ?? ew ?? (m === 'ewallet' ? 'gopay' : null)) as never });
    toast.success('Metode pembayaran utama disimpan');
  };

  return (
    <View style={{ gap: 14 }}>
      <Entrance index={0}>
        <BrandGradient colors={[colors.primary, '#13A29F', '#0E7C7B']} style={[s.hero, shadow.glow(colors.primary)]}>
          <Row between>
            <View>
              <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '700', letterSpacing: 0.5 }}>SALDO ANTARPAY</Text>
              <AnimatedNumber value={wallet?.balance ?? 0} format={rupiah} style={{ color: '#fff', fontSize: 30, fontWeight: '700', letterSpacing: -0.5 }} />
            </View>
            <Button title="Top up" size="sm" color="#0B1F2A" icon="add" onPress={() => router.push('/pay/gateway' as never)} />
          </Row>
        </BrandGradient>
      </Entrance>

      <Entrance index={1}><Card style={{ gap: 10 }}>
        <Text style={font.label}>Metode utama saat memesan</Text>
        <MethodRow active={method === 'cash'} onPress={() => pick('cash')} icon="cash-outline" color={colors.success} title="Tunai" subtitle="Bayar langsung ke driver" />
        <MethodRow active={method === 'wallet'} onPress={() => pick('wallet')} icon="wallet-outline" color={colors.primary} title="Saldo AntarPay" subtitle={`Saldo ${rupiah(wallet?.balance ?? 0)} · dipotong otomatis`} />
        <MethodRow active={method === 'ewallet'} onPress={() => pick('ewallet')} icon="phone-portrait-outline" color={colors.info} title={`E-wallet${ew ? ` · ${EWALLETS.find((e) => e.key === ew)?.label}` : ''}`} subtitle="GoPay/OVO/DANA/ShopeePay/QRIS/VA — via Midtrans, dana masuk AntarPay lalu dipotong" />
      </Card></Entrance>

      <Entrance index={2}><Card style={{ gap: 10 }}>
        <Row between><Text style={font.label}>E-wallet pilihan Anda</Text><Badge text="Midtrans · PCI-DSS" color={colors.info} /></Row>
        <View style={s.grid}>
          {EWALLETS.map((x) => (
            <View key={x.key} style={{ width: '31%', flexGrow: 1 }}>
              <PressableScale onPress={() => pick('ewallet', x.key)} scaleTo={0.95} style={[s.method, ew === x.key && method === 'ewallet' && { borderColor: x.color, backgroundColor: x.color + '14', ...shadow.glow(x.color) }]}>
                <View style={[s.mIcon, { backgroundColor: x.color }]}><Ionicons name={x.icon as never} size={20} color="#fff" /></View>
                <Text style={{ fontWeight: '700', color: colors.text, fontSize: 14 }} numberOfLines={1}>{x.label}</Text>
                {ew === x.key && method === 'ewallet' && <Ionicons name="checkmark-circle" size={16} color={x.color} style={{ position: 'absolute', top: 6, right: 6 }} />}
              </PressableScale>
            </View>
          ))}
        </View>
        <Text style={font.tiny}>Saat memesan, bila saldo kurang, halaman bayar {ew ? EWALLETS.find((e) => e.key === ew)?.label : 'e-wallet'} dibuka otomatis untuk kekurangannya. AntarKita tidak menyimpan data akun e-wallet Anda.</Text>
      </Card></Entrance>

      {!compact && (
        <Entrance index={3}><Card style={{ gap: 8 }}>
          <Row between>
            <Row gap={10}><View style={[s.mIcon, { backgroundColor: nfc === 'supported' ? colors.success : colors.textMuted }]}><Ionicons name="radio-outline" size={20} color="#fff" /></View><View><Text style={font.h3}>E-money (kartu NFC)</Text><Text style={font.tiny}>Flazz · e-money Mandiri · BRIZZI · TapCash</Text></View></Row>
            <Badge text={nfc === 'supported' ? 'Perangkat mendukung NFC' : nfc === 'unsupported' ? 'NFC tidak tersedia' : 'Memeriksa…'} color={nfc === 'supported' ? colors.success : colors.textMuted} />
          </Row>
          <Text style={font.tiny}>
            {Platform.OS === 'web' ? 'Di web, pembacaan kartu hanya didukung Chrome Android (Web NFC). ' : Platform.OS === 'ios' ? 'iPhone memerlukan Core NFC + lisensi bank penerbit. ' : 'Tempelkan kartu di punggung ponsel saat fitur aktif. '}
            Pembayaran e-money membutuhkan kerja sama resmi dengan bank penerbit (BCA/Mandiri/BRI/BNI) — fitur ini disiapkan dan akan aktif setelah lisensi tersedia. Sementara itu, gunakan e-wallet/QRIS.
          </Text>
          <Button title="Cek saldo kartu (segera)" variant="outline" size="sm" disabled={nfc !== 'supported'} icon="scan-outline" onPress={() => toast.show('Modul e-money menunggu lisensi bank penerbit')} />
        </Card></Entrance>
      )}
    </View>
  );
}

function MethodRow({ active, onPress, icon, color, title, subtitle }: { active: boolean; onPress: () => void; icon: string; color: string; title: string; subtitle: string }) {
  return (
    <PressableScale onPress={onPress} scaleTo={0.985} style={[s.row, active && { borderColor: color, backgroundColor: color + '0F' }]}>
      <View style={[s.mIcon, { backgroundColor: active ? color : 'rgba(11,31,42,0.08)' }]}><Ionicons name={icon as never} size={20} color={active ? '#fff' : colors.textSecondary} /></View>
      <View style={{ flex: 1, minWidth: 0 }}><Text style={{ fontWeight: '700', color: colors.text }}>{title}</Text><Text style={font.tiny} numberOfLines={2}>{subtitle}</Text></View>
      <Ionicons name={active ? 'radio-button-on' : 'radio-button-off'} size={20} color={active ? color : colors.textMuted} />
    </PressableScale>
  );
}

const s = StyleSheet.create({
  hero: { borderRadius: radius.xl, padding: 16, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: radius.lg, borderWidth: 1.5, borderColor: glass.border, backgroundColor: 'rgba(255,255,255,0.92)' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  method: { width: '100%', alignItems: 'center', gap: 6, padding: 10, borderRadius: radius.lg, borderWidth: 1.5, borderColor: glass.border, backgroundColor: 'rgba(255,255,255,0.92)' },
  mIcon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
});
