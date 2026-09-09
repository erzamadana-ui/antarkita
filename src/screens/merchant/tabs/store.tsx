import React, { useState } from 'react';
import { View, Text, Switch, Image, StyleSheet, Platform, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Entrance, PressableScale } from '@/components/motion';
import { TAB_BAR_SPACE } from '@/components/GlassTabBar';
import { Screen, Card, Row, Input, Button, Badge, Stars, Chip, toast, type IconName } from '@/components/ui';
import { WalletView } from '@/components/WalletView';
import { useAuth } from '@/store/auth';
import { useMode } from '@/store/mode';
import { supabase } from '@/lib/supabase';
import { pickAndUpload } from '@/lib/upload';
import { colors, font, radius, shadow } from '@/lib/theme';
import { HalalBadge } from '@/components/MerchantStatus';

type Item = { icon: IconName; color?: string; title: string; subtitle?: string; onPress: () => void; danger?: boolean };

export default function MerchantStore() {
  const router = useRouter();
  const { merchant, driver, session, loadProfile, signOut } = useAuth();
  const setMode = useMode((s) => s.setMode);
  const [f, setF] = useState({ name: merchant?.name ?? '', description: merchant?.description ?? '', prep_minutes: String(merchant?.prep_minutes ?? 15), opening_hours: merchant?.opening_hours ?? '' });
  const [tab, setTab] = useState<'profile' | 'wallet'>('profile');

  const save = async (patch?: Record<string, unknown>) => {
    if (!merchant) return;
    const { error } = await supabase.from('merchants').update(patch ?? { ...f, prep_minutes: Number(f.prep_minutes) || 15 }).eq('id', merchant.id);
    if (error) return toast.error(error.message);
    await loadProfile(); if (!patch) toast.success('Profil toko disimpan');
  };

  const confirmSignOut = () => {
    const doIt = async () => { await signOut(); router.replace('/(auth)/welcome'); };
    if (Platform.OS === 'web') { if (confirm('Keluar dari akun toko?')) doIt(); return; }
    Alert.alert('Keluar', 'Keluar dari akun toko?', [{ text: 'Batal' }, { text: 'Keluar', style: 'destructive', onPress: doIt }]);
  };

  if (!merchant) return null;
  const items: Item[] = [
    { icon: 'document-text-outline', title: 'Sertifikasi & dokumen usaha', subtitle: 'NPWP, izin usaha, sertifikat halal, rekening', onPress: () => router.push('/merchant/documents' as never) },
    { icon: 'chatbubbles-outline', color: colors.info, title: 'Bantuan & tiket aduan', subtitle: 'Hubungi CS online', onPress: () => router.push('/support' as never) },
    { icon: 'person-outline', title: 'Edit profil pemilik', onPress: () => router.push('/account/edit') },
    { icon: 'language-outline', title: 'Bahasa / Language', onPress: () => router.push('/account/language') },
    { icon: 'key-outline', title: 'Ganti kata sandi', subtitle: 'Perbarui kata sandi akun Anda', onPress: () => router.push('/account/password' as never) },
    ...(driver ? [{ icon: 'bicycle-outline' as IconName, title: 'Beralih ke Mode Driver', onPress: async () => { await setMode('driver'); router.replace('/(driver)'); } }] : []),
    // "Keluar" & "Hapus akun" selalu di paling bawah — sebelumnya "Keluar" terselip di tengah daftar,
    // tepat di atas item lain, sehingga mudah tertekan tanpa sengaja.
    { icon: 'log-out-outline', title: 'Keluar', danger: true, onPress: confirmSignOut },
    { icon: 'trash-outline', title: 'Hapus akun', subtitle: 'Hapus data pribadi secara permanen', danger: true, onPress: () => router.push('/account/delete' as never) },
  ];
  const tabs = (
    <Row gap={8} style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 }}>
      <Chip label="Profil toko" active={tab === 'profile'} onPress={() => setTab('profile')} />
      <Chip label="Saldo & penarikan" active={tab === 'wallet'} onPress={() => setTab('wallet')} />
    </Row>
  );

  return (
    <Screen title="Toko Saya" scroll={tab === 'profile'} padded={false} bottomSpace={TAB_BAR_SPACE + 16}>
      {tabs}
      {tab === 'wallet' ? <WalletView allowWithdraw bottomSpace={TAB_BAR_SPACE + 16} /> : (
        <View style={{ gap: 16, paddingHorizontal: 16 }}>
          {/* Kartu toko: gambar atas radius 18, nama, rating, status */}
          <Entrance index={0}><View style={s.storeCard}>
            <Image source={{ uri: merchant.image_url ?? undefined }} style={s.cover} />
            <View style={{ padding: 16, gap: 10 }}>
              <Row between style={{ alignItems: 'flex-start' }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={font.h2} numberOfLines={2}>{merchant.name}</Text>
                  <Row gap={6}><Stars value={merchant.rating_avg} size={12} /><Text style={font.tiny}>{Number(merchant.rating_avg).toFixed(1)} ({merchant.rating_count} ulasan)</Text></Row>
                  {merchant.address ? <Row gap={4} style={{ marginTop: 2 }}><Ionicons name="location-outline" size={12} color={colors.textMuted} /><Text style={[font.tiny, { flex: 1 }]} numberOfLines={1}>{merchant.address}</Text></Row> : null}
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <Badge text={merchant.status === 'approved' ? 'Terverifikasi' : merchant.status === 'pending' ? 'Menunggu admin' : merchant.status === 'rejected' ? 'Ditolak' : 'Ditangguhkan'} color={merchant.status === 'approved' ? colors.success : merchant.status === 'pending' ? colors.warning : colors.danger} />
                  <HalalBadge merchant={merchant} />
                </View>
              </Row>
              <Row between style={[s.openRow, merchant.is_open && { backgroundColor: colors.tint }]}>
                <Row gap={10}>
                  <View style={[s.openIcon, merchant.is_open && { backgroundColor: colors.primary }]}><Ionicons name="storefront-outline" size={18} color={merchant.is_open ? '#fff' : colors.textMuted} /></View>
                  <View><Text style={[font.body, { fontWeight: '700' }]}>{merchant.is_open ? 'Toko buka' : 'Toko tutup'}</Text><Text style={font.tiny}>Matikan saat libur/stok habis</Text></View>
                </Row>
                <Switch value={merchant.is_open} onValueChange={(v) => save({ is_open: v })} trackColor={{ true: colors.primary, false: colors.border }} thumbColor="#fff" />
              </Row>
              <Button title="Ganti foto sampul" variant="secondary" icon="image-outline" size="sm" onPress={async () => { if (!session) return; try { const r = await pickAndUpload('merchant-images', session.user.id); if (r) save({ image_url: r.url }); } catch (e) { toast.error((e as Error).message); } }} />
            </View>
          </View></Entrance>
          <Entrance index={1}><Card style={{ gap: 12 }}>
            <Text style={font.label}>Profil toko</Text>
            <Input label="Nama" value={f.name} onChangeText={(v) => setF({ ...f, name: v })} />
            <Input label="Deskripsi" value={f.description} onChangeText={(v) => setF({ ...f, description: v })} />
            <Row gap={10}>
              <Input label="Waktu siap (mnt)" keyboardType="number-pad" value={f.prep_minutes} onChangeText={(v) => setF({ ...f, prep_minutes: v })} containerStyle={{ flex: 1 }} />
              <Input label="Jam buka" value={f.opening_hours} onChangeText={(v) => setF({ ...f, opening_hours: v })} containerStyle={{ flex: 1 }} />
            </Row>
            <Button title="Simpan" onPress={() => save()} />
          </Card></Entrance>
          <Entrance index={2}>
            <Text style={[font.label, { marginBottom: 8 }]}>Pengaturan</Text>
            <View style={s.menuCard}>
              {items.map((it, i) => (
                <PressableScale key={it.title} onPress={it.onPress} scaleTo={0.985} haptic={false} style={[s.item, i < items.length - 1 && s.itemBorder]}>
                  <View style={[s.itemIcon, it.danger && { backgroundColor: colors.dangerLight }, it.color && !it.danger && { backgroundColor: it.color + '14' }]}>
                    <Ionicons name={it.icon} size={20} color={it.danger ? colors.danger : it.color ?? colors.primary} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[font.body, { fontWeight: '700' }, it.danger && { color: colors.danger }]} numberOfLines={1}>{it.title}</Text>
                    {it.subtitle ? <Text style={font.tiny} numberOfLines={2}>{it.subtitle}</Text> : null}
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                </PressableScale>
              ))}
            </View>
          </Entrance>
        </View>
      )}
    </Screen>
  );
}
const s = StyleSheet.create({
  storeCard: { backgroundColor: '#fff', borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', ...shadow.card },
  cover: { width: '100%', height: 150, backgroundColor: colors.bgSoft },
  openRow: { padding: 12, borderRadius: radius.md, backgroundColor: colors.bgSoft, borderWidth: 1, borderColor: colors.border },
  openIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  menuCard: { backgroundColor: '#fff', borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, ...shadow.soft },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  itemBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  itemIcon: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center' },
});
