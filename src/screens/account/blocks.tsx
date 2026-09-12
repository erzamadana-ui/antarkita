// Akun → "Pengguna diblokir": daftar orang yang Anda blokir + tombol buka blokir.
//
// Wajib ada demi kebijakan UGC Google Play: pengguna harus bisa memblokir DAN
// melihat/mengelola blokirnya sendiri dari dalam aplikasi. Dipakai bersama oleh
// aplikasi Pelanggan dan Mitra (rute: /account/blocks).
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Alert, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Screen, Card, Avatar, Row, Button, Empty, Loading, toast } from '@/components/ui';
import { Entrance, PressableScale } from '@/components/motion';
import { rpc } from '@/lib/supabase';
import { colors, font, radius } from '@/lib/theme';
import { formatDate } from '@/lib/format';

type Blocked = {
  blocked_id: string;
  full_name: string | null;
  avatar_url: string | null;
  role: 'customer' | 'driver' | 'merchant' | 'admin' | null;
  reason: string | null;
  created_at: string;
};

const ROLE_LABEL: Record<string, string> = { customer: 'Pelanggan', driver: 'Mitra driver', merchant: 'Merchant', admin: 'Admin' };

export default function BlockedUsers() {
  const router = useRouter();
  const [list, setList] = useState<Blocked[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setList(await rpc<Blocked[]>('my_blocks')); }
    catch (e) { toast.error((e as Error).message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const unblock = (b: Blocked) => {
    const nama = b.full_name || 'pengguna ini';
    const doIt = async () => {
      setBusy(b.blocked_id);
      try { await rpc('unblock_user', { p_user: b.blocked_id }); toast.success(`Blokir ${nama} dibuka`); await load(); }
      catch (e) { toast.error((e as Error).message); }
      finally { setBusy(null); }
    };
    const pesan = `${nama} bisa dipasangkan lagi dengan Anda dan kalian dapat saling berkirim pesan pada pesanan berikutnya.`;
    if (Platform.OS === 'web') { if (confirm(`Buka blokir ${nama}?\n\n${pesan}`)) doIt(); return; }
    Alert.alert(`Buka blokir ${nama}?`, pesan, [{ text: 'Batal' }, { text: 'Buka blokir', onPress: doIt }]);
  };

  return (
    <Screen title="Pengguna diblokir" back>
      <Entrance index={0}>
        <Card style={{ gap: 8 }}>
          <Row gap={10} style={{ alignItems: 'flex-start' }}>
            <Ionicons name="shield-checkmark-outline" size={20} color={colors.primary} style={{ marginTop: 1 }} />
            <Text style={[font.small, { flex: 1, color: colors.text }]}>
              Pengguna yang Anda blokir tidak akan dipasangkan lagi dengan Anda pada pesanan berikutnya, dan kalian tidak
              bisa saling berkirim pesan maupun menelepon lewat aplikasi. Mereka tidak diberi tahu tentang blokir ini.
            </Text>
          </Row>
          <Text style={font.tiny}>
            Untuk memblokir seseorang: buka pesanan atau layar chat, ketuk tombol ⋯ di kartu mitra/pelanggan, lalu pilih “Blokir”.
          </Text>
        </Card>
      </Entrance>

      <View style={{ height: 16 }} />

      {loading ? <Loading text="Memuat daftar blokir…" /> : list.length === 0 ? (
        <Empty
          icon="ban-outline"
          title="Belum ada pengguna yang diblokir"
          subtitle="Anda bisa memblokir seseorang lewat menu ⋯ pada kartu mitra atau pelanggan di halaman pesanan dan chat."
          action={<Button title="Lihat pesanan saya" variant="secondary" onPress={() => router.push('/' as never)} />}
        />
      ) : (
        <Entrance index={1}>
          <Card padded={false} style={{ paddingHorizontal: 12, paddingVertical: 4 }}>
            {list.map((b, i) => (
              <View key={b.blocked_id} style={[{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 }, i < list.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border }]}>
                <Avatar name={b.full_name} url={b.avatar_url} size={44} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[font.body, { fontWeight: '700' }]} numberOfLines={1}>{b.full_name || 'Pengguna'}</Text>
                  <Text style={font.tiny} numberOfLines={2}>
                    {[b.role ? ROLE_LABEL[b.role] ?? b.role : null, `diblokir ${formatDate(b.created_at, false)}`].filter(Boolean).join(' · ')}
                    {b.reason ? ` · ${b.reason}` : ''}
                  </Text>
                </View>
                <PressableScale onPress={() => unblock(b)} scaleTo={0.94} haptic={false} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.full, borderWidth: 1, borderColor: colors.primary }} disabled={busy === b.blocked_id}>
                  <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 14 }}>{busy === b.blocked_id ? 'Memproses…' : 'Buka blokir'}</Text>
                </PressableScale>
              </View>
            ))}
          </Card>
        </Entrance>
      )}
    </Screen>
  );
}
