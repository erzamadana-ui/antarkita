// Detail tiket — percakapan dengan CS online, tutup & nilai
import React, { useState } from 'react';
import { View, Text, StyleSheet, Alert, Platform } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Screen, Row, Badge, Button, Loading, Stars, toast } from '@/components/ui';
import { TicketChat } from '@/components/TicketChat';
import { useTicket } from '@/hooks/useTickets';
import { colors, font, radius, glass } from '@/lib/theme';
import { ticketStatusLabel, ticketStatusColor, ticketCategoryLabel, ticketPriorityLabel, ticketPriorityColor } from '@/lib/format';

export default function TicketDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { ticket, messages, loading, reply, close } = useTicket(id);
  const [rating, setRating] = useState(0);
  const [closing, setClosing] = useState(false);

  const doClose = async () => {
    setClosing(true);
    try { await close(rating || undefined); toast.success('Tiket ditutup. Terima kasih!'); } catch (e) { toast.error((e as Error).message); } finally { setClosing(false); }
  };
  const confirmClose = () => {
    if (Platform.OS === 'web') { if (confirm('Tutup tiket ini? Anda bisa membuat tiket baru bila masih ada kendala.')) doClose(); return; }
    Alert.alert('Tutup tiket?', 'Anda bisa membuat tiket baru bila masih ada kendala.', [{ text: 'Batal' }, { text: 'Tutup', onPress: doClose }]);
  };

  if (loading) return <Screen title="Tiket" back><Loading /></Screen>;
  if (!ticket) return <Screen title="Tiket" back><Text style={font.small}>Tiket tidak ditemukan.</Text></Screen>;
  const canClose = !['closed'].includes(ticket.status);

  const header = (
    <Row gap={6} style={{ marginRight: 8 }}>
      <Badge text={ticketStatusLabel[ticket.status]} color={ticketStatusColor(ticket.status)} />
      {ticket.priority !== 'normal' && <Badge text={ticketPriorityLabel[ticket.priority]} color={ticketPriorityColor(ticket.priority)} />}
    </Row>
  );
  // Pelanggan harus selalu bisa menutup tiketnya sendiri — termasuk tiket yang baru dibuat
  // (status 'open', CS belum membalas). Sebelumnya tombol hanya muncul setelah CS membalas,
  // sehingga tiket salah kirim tidak bisa ditutup pemiliknya.
  const footer = canClose ? (
    <View style={s.closeBox}>
      <Row between gap={10}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontWeight: '700', color: colors.text, fontSize: 13 }} numberOfLines={1}>{ticket.status === 'open' ? 'Tidak jadi bertanya?' : 'Sudah terbantu?'}</Text>
          {ticket.status === 'open'
            ? <Text style={font.tiny} numberOfLines={2}>Tiket bisa Anda tutup sendiri kapan saja.</Text>
            : <Row gap={6}><Stars value={rating} size={18} onChange={setRating} /><Text style={font.tiny}>{rating ? `${rating}/5` : 'beri nilai CS'}</Text></Row>}
        </View>
        <Button size="sm" title="Tutup tiket" variant="outline" color={colors.success} icon="checkmark-done" loading={closing} onPress={confirmClose} />
      </Row>
    </View>
  ) : null;

  return (
    <Screen title={`${ticket.subject} · ${ticket.code}`} back scroll={false} padded={false} keyboard={false} right={header}>
      <Text style={[font.tiny, { textAlign: 'center', paddingTop: 6 }]}>{ticketCategoryLabel[ticket.category]} · CS online 07.00–22.00 WIB</Text>
      <TicketChat ticket={ticket} messages={messages} onSend={(b, a) => reply(b, a)} footer={footer} />
      {!!ticket.order_id && <Button title="Lihat pesanan terkait" variant="ghost" size="sm" onPress={() => router.push(`/order/${ticket.order_id}` as never)} />}
    </Screen>
  );
}
const s = StyleSheet.create({ closeBox: { marginHorizontal: 12, marginBottom: 8, padding: 10, borderRadius: radius.lg, backgroundColor: 'rgba(255,255,255,0.92)', borderWidth: 1, borderColor: glass.border } });
