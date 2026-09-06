// Akun pedagang pasar: profil lapak (edit → apply_market_vendor), dokumen, rekening, bantuan, keluar
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Image, Platform, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Screen, Row, Avatar, Badge, Button, CircleButton, Card, Input, Chip, toast, type IconName } from '@/components/ui';
import { Entrance, PressableScale } from '@/components/motion';
import { TAB_BAR_SPACE } from '@/components/GlassTabBar';
import { DocUpload } from '@/components/DocUpload';
import { useAuth } from '@/store/auth';
import { useMode } from '@/store/mode';
import { rpc, supabase } from '@/lib/supabase';
import { colors, font, radius, shadow } from '@/lib/theme';
import { marketCategoryLabel } from '@/lib/format';
import { qualityColor } from '../shared';

const CATS = ['sayur', 'buah', 'bumbu', 'daging_ikan', 'sembako', 'lainnya'];
const digits = (v: string) => v.replace(/\D/g, '');
type Item = { icon: IconName; color?: string; title: string; subtitle?: string; onPress: () => void; danger?: boolean };

export default function VendorAccount() {
  const router = useRouter();
  const { profile, marketVendor: me, driver, merchant, loadProfile, signOut } = useAuth();
  const setMode = useMode((s) => s.setMode);
  const [marketName, setMarketName] = useState<string | null>(null);
  const [section, setSection] = useState<'profile' | 'docs' | 'bank' | null>(null);
  const [f, setF] = useState({ stall_name: '', stall_no: '', categories: [] as string[], open_hours: '', phone: '', description: '', photo_url: '', id_card_url: '', market_card_url: '', bank_name: '', bank_account: '', bank_holder: '' });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => setF((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    if (!me) return;
    setF({ stall_name: me.stall_name, stall_no: me.stall_no ?? '', categories: me.categories ?? [], open_hours: me.open_hours ?? '', phone: me.phone ?? '', description: me.description ?? '', photo_url: me.photo_url ?? '', id_card_url: me.id_card_url ?? '', market_card_url: me.market_card_url ?? '', bank_name: me.bank_name ?? '', bank_account: me.bank_account ?? '', bank_holder: me.bank_holder ?? '' });
    supabase.from('markets').select('name').eq('id', me.market_id).maybeSingle().then(({ data }) => setMarketName((data as { name: string } | null)?.name ?? null));
  }, [me]);

  const save = async () => {
    if (!me) return;
    if (f.stall_name.trim().length < 3) return toast.error('Nama lapak minimal 3 huruf');
    if (f.categories.length === 0) return toast.error('Pilih minimal satu kategori');
    setBusy(true);
    try {
      await rpc('apply_market_vendor', { p: {
        market_id: me.market_id, stall_name: f.stall_name.trim(), stall_no: f.stall_no.trim() || null, categories: f.categories, description: f.description.trim() || null,
        photo_url: f.photo_url || null, id_card_url: f.id_card_url || null, market_card_url: f.market_card_url || null, phone: digits(f.phone) || null,
        bank_name: f.bank_name.trim() || null, bank_account: digits(f.bank_account) || null, bank_holder: f.bank_holder.trim() || null, open_hours: f.open_hours.trim() || null,
      } });
      await loadProfile(); toast.success('Data lapak disimpan'); setSection(null);
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };
  const confirmSignOut = () => {
    const doIt = async () => { await signOut(); router.replace('/(auth)/welcome'); };
    if (Platform.OS === 'web') { if (confirm('Keluar dari akun?')) doIt(); return; }
    Alert.alert('Keluar', 'Keluar dari akun?', [{ text: 'Batal' }, { text: 'Keluar', style: 'destructive', onPress: doIt }]);
  };
  const approved = me?.status === 'approved';
  const score = Math.round(Number(me?.quality_score ?? 0));

  const groups: { title: string; items: Item[] }[] = [
    { title: 'Lapak', items: [
      { icon: 'storefront-outline', title: 'Profil lapak', subtitle: [me?.stall_name, me?.stall_no ? `No. ${me.stall_no}` : null].filter(Boolean).join(' · ') || 'Nama, kategori, jam buka', onPress: () => setSection(section === 'profile' ? null : 'profile') },
      { icon: 'document-text-outline', title: 'Dokumen', subtitle: `${[me?.photo_url, me?.id_card_url, me?.market_card_url].filter(Boolean).length}/3 terunggah`, onPress: () => setSection(section === 'docs' ? null : 'docs') },
      { icon: 'card-outline', title: 'Rekening pencairan', subtitle: me?.bank_name ? `${me.bank_name} · ${me.bank_account ?? ''}` : 'Belum diisi', onPress: () => setSection(section === 'bank' ? null : 'bank') },
      { icon: 'swap-horizontal-outline', title: 'Pindah pasar', subtitle: marketName ?? 'Ubah pasar lewat form pendaftaran', onPress: () => router.push('/account/become-vendor' as never) },
    ] },
    { title: 'Akun', items: [
      { icon: 'person-outline', title: 'Edit profil', subtitle: 'Nama, nomor HP, foto', onPress: () => router.push('/account/edit' as never) },
      { icon: 'chatbubbles-outline', color: colors.info, title: 'Bantuan & tiket aduan', subtitle: 'CS online', onPress: () => router.push('/support' as never) },
      { icon: 'language-outline', title: 'Bahasa / Language', onPress: () => router.push('/account/language' as never) },
      { icon: 'key-outline', title: 'Ganti kata sandi', subtitle: 'Perbarui kata sandi akun Anda', onPress: () => router.push('/account/password' as never) },
      { icon: 'trash-outline', color: colors.danger, title: 'Hapus akun', subtitle: 'Hapus data pribadi secara permanen', onPress: () => router.push('/account/delete' as never) },
    ] },
  ];

  const form = section && (
    <Entrance index={0}>
      <Card style={{ gap: 12, marginTop: 10 }}>
        {section === 'profile' && (
          <>
            <Text style={font.label}>Profil lapak</Text>
            <Row gap={10}>
              <Input label="Nama lapak" value={f.stall_name} onChangeText={set('stall_name')} containerStyle={{ flex: 1 }} />
              <Input label="No. lapak" value={f.stall_no} onChangeText={set('stall_no')} containerStyle={{ width: 100 }} />
            </Row>
            <Text style={font.tiny}>Kategori dagangan</Text>
            <Row gap={8} style={{ flexWrap: 'wrap' }}>{CATS.map((c) => <Chip key={c} label={marketCategoryLabel[c] ?? c} active={f.categories.includes(c)} onPress={() => setF((p) => ({ ...p, categories: p.categories.includes(c) ? p.categories.filter((x) => x !== c) : [...p.categories, c] }))} />)}</Row>
            <Row gap={10}>
              <Input label="Jam buka" placeholder="05.00–12.00" icon="time-outline" value={f.open_hours} onChangeText={set('open_hours')} containerStyle={{ flex: 1 }} />
              <Input label="Telepon" keyboardType="phone-pad" icon="call-outline" value={f.phone} onChangeText={(v) => set('phone')(digits(v))} containerStyle={{ flex: 1 }} />
            </Row>
            <Input label="Deskripsi" value={f.description} onChangeText={set('description')} multiline />
          </>
        )}
        {section === 'docs' && (
          <>
            <Text style={font.label}>Dokumen</Text>
            <DocUpload label="Foto lapak" required value={f.photo_url} onChange={set('photo_url')} bucket="merchant-images" color={colors.market} />
            <DocUpload label="KTP pemilik" required value={f.id_card_url} onChange={set('id_card_url')} color={colors.market} />
            <DocUpload label="Kartu pedagang (opsional)" value={f.market_card_url} onChange={set('market_card_url')} color={colors.market} />
          </>
        )}
        {section === 'bank' && (
          <>
            <Text style={font.label}>Rekening pencairan</Text>
            <Input label="Bank" placeholder="BRI / BCA / Mandiri" value={f.bank_name} onChangeText={set('bank_name')} />
            <Input label="Nomor rekening" keyboardType="number-pad" icon="card-outline" value={f.bank_account} onChangeText={(v) => set('bank_account')(digits(v))} />
            <Input label="Atas nama" icon="person-outline" value={f.bank_holder} onChangeText={set('bank_holder')} />
          </>
        )}
        <Row gap={8}>
          <Button title="Batal" variant="secondary" onPress={() => setSection(null)} />
          <Button title="Simpan" loading={busy} onPress={save} style={{ flex: 1 }} />
        </Row>
      </Card>
    </Entrance>
  );

  return (
    <Screen title="Akun Pedagang" bottomSpace={TAB_BAR_SPACE + 16} right={<CircleButton icon="create-outline" onPress={() => router.push('/account/edit' as never)} />}>
      <Entrance index={0} from="zoom">
        <View style={{ alignItems: 'center', marginTop: 8 }}>
          <View style={s.avatarRing}>{me?.photo_url ? <Image source={{ uri: me.photo_url }} style={{ width: 96, height: 96, borderRadius: 48 }} /> : <Avatar name={profile?.full_name} url={profile?.avatar_url} size={96} />}</View>
          <Text style={[font.h1, { marginTop: 12, textAlign: 'center' }]}>{me?.stall_name ?? profile?.full_name}</Text>
          <Text style={[font.small, { textAlign: 'center' }]}>{[profile?.full_name, marketName].filter(Boolean).join(' · ')}</Text>
          <Badge text={approved ? 'Pedagang aktif' : `Status: ${me?.status ?? '-'}`} color={approved ? colors.success : colors.warning} style={{ marginTop: 8 }} />
        </View>
      </Entrance>
      <Entrance index={1}>
        <View style={s.stats}>
          <View style={s.stat}><Text style={[font.h2, { color: qualityColor(score) }]}>{score}</Text><Text style={font.tiny}>Skor kualitas</Text></View>
          <View style={s.vDivider} />
          <View style={s.stat}><Row gap={4}><Ionicons name="star" size={16} color={colors.accent} /><Text style={[font.h2, { color: colors.primary }]}>{Number(me?.rating_avg ?? 0).toFixed(1)}</Text></Row><Text style={font.tiny}>{me?.rating_count ?? 0} ulasan</Text></View>
          <View style={s.vDivider} />
          <View style={s.stat}><Text style={[font.h2, { color: colors.primary }]}>{me?.total_orders ?? 0}</Text><Text style={font.tiny}>Pesanan</Text></View>
        </View>
      </Entrance>

      {groups.map((g, gi) => (
        <Entrance key={g.title} index={gi + 2}>
          <Text style={[font.label, { marginTop: 22, marginBottom: 8 }]}>{g.title}</Text>
          <View style={s.card}>
            {g.items.map((it, i) => (
              <PressableScale key={it.title} onPress={it.onPress} scaleTo={0.985} haptic={false} style={[s.item, i < g.items.length - 1 && s.itemBorder]}>
                <View style={[s.itemIcon, it.color && { backgroundColor: it.color + '14' }]}><Ionicons name={it.icon} size={20} color={it.color ?? colors.primary} /></View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[font.body, { fontWeight: '700' }]} numberOfLines={1}>{it.title}</Text>
                  {it.subtitle ? <Text style={font.tiny} numberOfLines={2}>{it.subtitle}</Text> : null}
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
              </PressableScale>
            ))}
          </View>
          {gi === 0 && form}
        </Entrance>
      ))}

      <Entrance index={4} style={{ marginTop: 22, gap: 10 }}>
        {driver ? <Button title="Beralih ke Mode Driver" variant="secondary" icon="bicycle-outline" onPress={async () => { await setMode('driver'); router.replace('/(driver)' as never); }} /> : null}
        {merchant ? <Button title="Beralih ke Mode Merchant" variant="secondary" icon="storefront-outline" onPress={async () => { await setMode('merchant'); router.replace('/(merchant)' as never); }} /> : null}
        <Button title="Keluar" variant="outline" color={colors.danger} icon="log-out-outline" onPress={confirmSignOut} />
      </Entrance>
      <Row style={{ justifyContent: 'center', marginTop: 24 }}><Text style={font.tiny}>AntarKita Mitra v3.0</Text></Row>
    </Screen>
  );
}

const s = StyleSheet.create({
  avatarRing: { padding: 4, borderRadius: 60, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, ...shadow.card },
  stats: { flexDirection: 'row', alignItems: 'center', marginTop: 16, padding: 14, borderRadius: radius.lg, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, ...shadow.soft },
  stat: { flex: 1, alignItems: 'center', gap: 2 },
  vDivider: { width: 1, height: 36, backgroundColor: colors.border },
  card: { backgroundColor: '#fff', borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, ...shadow.soft },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  itemBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  itemIcon: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center' },
});
