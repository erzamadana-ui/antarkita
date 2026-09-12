import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, Switch, ScrollView, Modal, StyleSheet, Image, Platform, Alert } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import { Entrance, PressableScale } from '@/components/motion';
import { TAB_BAR_SPACE } from '@/components/GlassTabBar';
import { Screen, Row, Input, Button, Empty, CircleButton, toast } from '@/components/ui';
import { useAuth } from '@/store/auth';
import { supabase } from '@/lib/supabase';
import { pickAndUpload } from '@/lib/upload';
import { colors, font, radius, shadow } from '@/lib/theme';
import { rupiah } from '@/lib/format';
import type { MenuItem } from '@/lib/types';

const empty = { name: '', description: '', price: '', category: 'Menu', image_url: '' };

export default function MerchantMenu() {
  const { merchant, session } = useAuth();
  const [items, setItems] = useState<MenuItem[]>([]);
  const [editing, setEditing] = useState<(typeof empty & { id?: string }) | null>(null);

  const load = useCallback(async () => { if (!merchant) return; const { data } = await supabase.from('menu_items').select('*').eq('merchant_id', merchant.id).order('sort_order').order('created_at'); setItems((data as MenuItem[]) ?? []); }, [merchant]);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!merchant || !editing) return;
    const price = Number(editing.price.replace(/\D/g, ''));
    if (editing.name.trim().length < 2) return toast.error('Nama menu wajib diisi');
    if (!price) return toast.error('Harga wajib diisi');
    const payload = { merchant_id: merchant.id, name: editing.name.trim(), description: editing.description || null, price, category: editing.category || 'Menu', image_url: editing.image_url || null };
    const { error } = editing.id ? await supabase.from('menu_items').update(payload).eq('id', editing.id) : await supabase.from('menu_items').insert(payload);
    if (error) return toast.error(error.message);
    setEditing(null); toast.success('Menu disimpan'); load();
  };
  const toggle = async (it: MenuItem) => { await supabase.from('menu_items').update({ is_available: !it.is_available }).eq('id', it.id); load(); };
  // Hapus permanen: WAJIB dikonfirmasi. Sebelumnya satu ketukan tak sengaja pada ikon tong sampah
  // langsung menghapus menu tanpa pertanyaan apa pun dan tanpa cara membatalkan.
  const doRemove = async (it: MenuItem) => { const { error } = await supabase.from('menu_items').delete().eq('id', it.id); if (error) toast.error('Menu pernah dipesan, nonaktifkan saja'); else { toast.show(`"${it.name}" dihapus dari menu`); load(); } };
  const remove = (it: MenuItem) => {
    const msg = `Hapus "${it.name}" dari menu? Tindakan ini tidak bisa dibatalkan. Bila menu hanya sedang habis, matikan saklar "Tersedia" saja.`;
    if (Platform.OS === 'web') { if (confirm(msg)) doRemove(it); return; }
    Alert.alert('Hapus menu?', msg, [{ text: 'Batal' }, { text: 'Hapus', style: 'destructive', onPress: () => doRemove(it) }]);
  };
  const upload = async () => { if (!session) return; try { const r = await pickAndUpload('merchant-images', session.user.id); if (r && editing) setEditing({ ...editing, image_url: r.url }); } catch (e) { toast.error((e as Error).message); } };
  const available = items.filter((it) => it.is_available).length;

  return (
    <Screen title="Kelola Menu" bottomSpace={TAB_BAR_SPACE + 16} right={<CircleButton icon="add" filled onPress={() => setEditing({ ...empty })} />}>
      {items.length === 0 ? <Empty icon="restaurant-outline" title="Belum ada menu" subtitle="Tambahkan menu andalan Anda." action={<Button title="Tambah menu" icon="add-circle-outline" onPress={() => setEditing({ ...empty })} />} /> : (
        <>
          <Entrance index={0}>
            <Row between style={{ marginBottom: 12 }}>
              <Text style={font.h3}>{items.length} menu</Text>
              <Text style={font.tiny}>{available} tersedia · {items.length - available} nonaktif</Text>
            </Row>
          </Entrance>
          {/* Grid 2 kolom ala "Hotel": gambar atas radius 18, nama, harga teal, toggle tersedia */}
          <View style={s.grid}>
            {items.map((it, i) => (
              <Entrance key={it.id} index={Math.min(i + 1, 8)} from="up" style={s.cell}>
                <Animated.View layout={LinearTransition.springify().stiffness(280).damping(20)} style={[s.tile, !it.is_available && { opacity: 0.6 }]}>
                  <PressableScale onPress={() => setEditing({ id: it.id, name: it.name, description: it.description ?? '', price: String(it.price), category: it.category ?? 'Menu', image_url: it.image_url ?? '' })} scaleTo={0.98} haptic={false}>
                    {it.image_url ? <Image source={{ uri: it.image_url }} style={s.img} /> : <View style={[s.img, { alignItems: 'center', justifyContent: 'center' }]}><Ionicons name="fast-food-outline" size={32} color={colors.textMuted} /></View>}
                    <View style={{ padding: 10, gap: 2 }}>
                      <Text style={[font.body, { fontWeight: '700' }]} numberOfLines={1}>{it.name}</Text>
                      <Text style={font.tiny} numberOfLines={1}>{it.category ?? 'Menu'}</Text>
                      <Text style={{ fontWeight: '700', color: colors.primary, fontSize: 16 }}>{rupiah(it.price)}</Text>
                    </View>
                  </PressableScale>
                  <Row between style={s.tileFoot}>
                    <Row gap={6}>
                      <Switch value={it.is_available} onValueChange={() => toggle(it)} trackColor={{ true: colors.primary, false: colors.border }} thumbColor="#fff" style={Platform.OS === 'ios' ? { transform: [{ scale: 0.75 }] } : undefined} />
                      <Text style={[font.tiny, { fontWeight: '700', color: it.is_available ? colors.primary : colors.textMuted }]}>{it.is_available ? 'Tersedia' : 'Habis'}</Text>
                    </Row>
                    <Pressable onPress={() => remove(it)} hitSlop={8} style={s.trash}><Ionicons name="trash-outline" size={16} color={colors.danger} /></Pressable>
                  </Row>
                </Animated.View>
              </Entrance>
            ))}
          </View>
        </>
      )}
      <Modal visible={!!editing} animationType="fade" transparent onRequestClose={() => setEditing(null)}>
        <View style={s.modalBg}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setEditing(null)} />
          <Animated.View entering={FadeInDown.springify().stiffness(280).damping(18)} style={s.modal}>
            <View style={s.handle} />
            <ScrollView contentContainerStyle={{ gap: 12 }} keyboardShouldPersistTaps="handled">
              <Row between><Text style={font.h2}>{editing?.id ? 'Edit menu' : 'Tambah menu'}</Text><CircleButton icon="close" onPress={() => setEditing(null)} /></Row>
              {editing?.image_url ? <Image source={{ uri: editing.image_url }} style={s.preview} /> : null}
              <Input label="Nama menu" value={editing?.name ?? ''} onChangeText={(v) => setEditing((e) => e && { ...e, name: v })} />
              <Input label="Deskripsi" value={editing?.description ?? ''} onChangeText={(v) => setEditing((e) => e && { ...e, description: v })} />
              <Row gap={10}>
                <Input label="Harga (Rp)" keyboardType="number-pad" value={editing?.price ?? ''} onChangeText={(v) => setEditing((e) => e && { ...e, price: v.replace(/\D/g, '') })} containerStyle={{ flex: 1 }} />
                <Input label="Kategori" value={editing?.category ?? ''} onChangeText={(v) => setEditing((e) => e && { ...e, category: v })} containerStyle={{ flex: 1 }} placeholder="Nasi / Minuman" />
              </Row>
              <Button title={editing?.image_url ? 'Ganti foto menu' : 'Unggah foto menu'} variant="secondary" icon="image-outline" onPress={upload} />
              <Button title="Simpan" size="lg" onPress={save} />
            </ScrollView>
          </Animated.View>
        </View>
      </Modal>
    </Screen>
  );
}

const s = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -6 },
  cell: { width: '50%', paddingHorizontal: 6, marginBottom: 12 },
  tile: { backgroundColor: '#fff', borderRadius: 18, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', ...shadow.soft },
  img: { width: '100%', height: 120, backgroundColor: colors.bgSoft },
  tileFoot: { paddingHorizontal: 10, paddingBottom: 8, paddingTop: 2 },
  trash: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.dangerLight, alignItems: 'center', justifyContent: 'center' },
  preview: { width: '100%', height: 140, borderRadius: 18, backgroundColor: colors.bgSoft },
  modalBg: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  modal: { backgroundColor: '#fff', borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: 20, paddingBottom: 32, maxHeight: '90%', width: '100%', maxWidth: 640, alignSelf: 'center', overflow: 'hidden', ...shadow.sheet },
  handle: { width: 44, height: 5, borderRadius: 3, backgroundColor: colors.border, alignSelf: 'center', marginBottom: 12 },
});
