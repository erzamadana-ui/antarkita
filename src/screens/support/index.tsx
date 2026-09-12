// Pusat Bantuan — CS online, tiket aduan saya, FAQ
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Linking } from 'react-native';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Screen, Card, Row, Badge, Button, Empty, ListItem, Divider, IconCircle } from '@/components/ui';
import { Entrance, PressableScale, LiveDot, Skeleton } from '@/components/motion';
import { useMyTickets } from '@/hooks/useTickets';
import { useAuth } from '@/store/auth';
import { useMode } from '@/store/mode';
import { supabase } from '@/lib/supabase';
import { colors, font, radius, shadow } from '@/lib/theme';
import { timeAgo, ticketStatusLabel, ticketStatusColor, ticketCategoryLabel, ticketPriorityColor } from '@/lib/format';

const FAQ = [
  ['Bagaimana cara top up AntarPay?', 'AntarPay > Top Up: instan lewat GoPay/OVO/DANA/QRIS/VA, atau transfer manual + bukti (verifikasi admin maks. 1×24 jam).'],
  ['Bagaimana tarif dihitung?', 'Tarif = tarif per km × jarak rute (minimal tarif berlaku) + biaya layanan, dikali pengali sesi (jam sibuk/sepi). Rincian tampil sebelum memesan.'],
  ['Bisakah membatalkan pesanan?', 'Bisa selama driver belum memulai perjalanan. Pembayaran AntarPay dikembalikan otomatis ke saldo.'],
  ['Apa itu PIN penjemputan?', 'Kode 4 digit di layar lacak pesanan. Sebutkan ke driver sebelum berangkat agar Anda naik kendaraan yang benar.'],
  ['Bagaimana menjadi mitra driver/merchant?', 'Menu Akun > Daftar jadi Mitra. Lengkapi dokumen (KTP, SIM/NPWP, foto), tunggu verifikasi admin.'],
];

export default function Support() {
  const router = useRouter();
  const uid = useAuth((s) => s.session?.user.id);
  const mode = useMode((s) => s.mode);
  const { tickets, loading, openCount, waiting } = useMyTickets(uid);
  const [phone, setPhone] = useState<string | null>(null);
  useEffect(() => { supabase.from('app_settings').select('value').eq('key', 'support_phone').maybeSingle().then(({ data }) => setPhone((data?.value as string) ?? null)); }, []);
  const hour = new Date().getHours();
  const csOnline = hour >= 7 && hour < 22;

  return (
    <Screen title="Pusat Bantuan" back>
      <View style={{ gap: 16 }}>
        <Entrance index={0}>
          <View style={s.hero}>
            <Row gap={12} style={{ alignItems: 'flex-start' }}>
              <IconCircle name="headset-outline" size={52} bg={colors.tint} />
              <View style={{ flex: 1 }}>
                <Row gap={6}><LiveDot color={csOnline ? colors.success : colors.accent} size={9} /><Text style={{ color: csOnline ? colors.success : colors.warning, fontWeight: '700', fontSize: 12, letterSpacing: 0.5 }}>{csOnline ? 'CS ONLINE · 07.00–22.00 WIB' : 'CS OFFLINE · buka 07.00 WIB'}</Text></Row>
                <Text style={[font.h2, { marginTop: 4 }]}>Ada kendala? Kami bantu.</Text>
                <Text style={[font.small, { marginTop: 2 }]}>Buat tiket aduan, CS online membalas langsung di aplikasi. Rata-rata balasan pertama &lt; 15 menit.</Text>
              </View>
            </Row>
            <Row gap={8} style={{ marginTop: 14 }}>
              <Button title="Chat CS" icon="chatbubbles-outline" style={{ flex: 1 }} onPress={() => router.push({ pathname: '/support/new', params: { category: 'other', subject: 'Chat dengan CS' } } as never)} />
              <Button title="Buat tiket" icon="create-outline" variant="secondary" style={{ flex: 1 }} onPress={() => router.push('/support/new' as never)} />
            </Row>
          </View>
        </Entrance>

        <Entrance index={1}>
          <Row between style={{ marginBottom: 8 }}>
            <Text style={font.label}>Tiket saya {openCount > 0 && <Text style={{ color: colors.warning }}>· {openCount} aktif</Text>}</Text>
            {waiting > 0 && <Badge text={`${waiting} menunggu balasan Anda`} color={colors.warning} />}
          </Row>
          {loading ? <Skeleton height={72} radius={radius.lg} /> : tickets.length === 0 ? (
            <Card solid><Empty icon="checkmark-done-outline" title="Belum ada tiket" subtitle="Semua lancar. Bila ada kendala pesanan, saldo, atau akun — buat tiket, kami tangani." /></Card>
          ) : tickets.map((t, i) => (
            <Entrance key={t.id} index={i} from="up">
              <PressableScale onPress={() => router.push(`/support/${t.id}` as never)} scaleTo={0.98} style={[s.ticket, t.status === 'waiting_user' && { borderColor: colors.warning + '88' }]}>
                <View style={[s.catIcon, { backgroundColor: ticketPriorityColor(t.priority) + '14' }]}><Ionicons name={t.category === 'safety' ? 'warning-outline' : t.category === 'payment' ? 'wallet-outline' : t.category === 'order' ? 'receipt-outline' : 'help-buoy-outline'} size={20} color={ticketPriorityColor(t.priority)} /></View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Row between><Text style={{ fontWeight: '700', color: colors.text, flex: 1 }} numberOfLines={1}>{t.subject}</Text><Badge text={ticketStatusLabel[t.status]} color={ticketStatusColor(t.status)} /></Row>
                  <Text style={font.tiny}>{t.code} · {ticketCategoryLabel[t.category]} · {timeAgo(t.last_message_at)}</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
              </PressableScale>
            </Entrance>
          ))}
        </Entrance>

        <Entrance index={3}>
          <Card solid padded={false}>
            <View style={{ paddingHorizontal: 12 }}>
              {mode === 'driver' && <><ListItem icon="shield-checkmark-outline" iconColor={colors.danger} title="Pusat Keamanan" subtitle="SOS, kontak darurat, laporan insiden" onPress={() => router.push('/safety' as never)} /><Divider style={{ marginVertical: 0 }} /></>}
              {!!phone && <><ListItem icon="logo-whatsapp" iconColor="#25D366" title={`WhatsApp CS ${phone}`} subtitle="Untuk kendala mendesak di luar aplikasi" onPress={() => Linking.openURL(`https://wa.me/${phone.replace(/\D/g, '')}`)} /><Divider style={{ marginVertical: 0 }} /></>}
              {FAQ.map(([q, a], i) => (
                <View key={q}>{i > 0 && <Divider style={{ marginVertical: 0 }} />}<ListItem icon="help-circle-outline" title={q} subtitle={a} /></View>
              ))}
            </View>
          </Card>
        </Entrance>
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  hero: { borderRadius: radius.lg, padding: 16, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, ...shadow.card },
  ticket: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: radius.lg, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, marginBottom: 8, ...shadow.soft },
  catIcon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
});
