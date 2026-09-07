// Barang dagangan pedagang pasar: daftar (grade, harga vs acuan, stok), tambah/edit lewat sheet, tandai habis/tersedia massal
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, Switch, ScrollView, Modal, StyleSheet, Image, Platform } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Entrance, PressableScale, Skeleton } from '@/components/motion';
import { TAB_BAR_SPACE } from '@/components/GlassTabBar';
import { Screen, Row, Input, Button, Badge, Chip, Empty, CircleButton, toast } from '@/components/ui';
import { ServiceIllustration } from '@/components/ServiceArt';
import { useAuth } from '@/store/auth';
import { rpc, supabase } from '@/lib/supabase';
import { pickAndUpload } from '@/lib/upload';
import { colors, font, radius, shadow } from '@/lib/theme';
import { rupiah, marketCategoryLabel } from '@/lib/format';
import type { MarketItem, MarketVendorItem, VendorGrade } from '@/lib/types';
import { loadVendorItems, GRADE_INFO, COEF_MAX, COEF_MIN, COEF_HARD, isFresh } from '../shared';

const CATS = ['sayur', 'buah', 'bumbu', 'daging_ikan', 'sembako', 'lainnya'];
const UNITS = ['kg', 'ikat', 'buah', 'bks', 'liter', 'ekor', 'ons', 'sisir'];
const GRADES: VendorGrade[] = ['A', 'B', 'C'];
type Form = { id?: string; item_id: string | null; name: string; category: string; unit: string; price: string; grade: VendorGrade; origin: string; photo_url: string; ref_price: number | null };
const emptyForm: Form = { item_id: null, name: '', category: 'sayur', unit: 'kg', price: '', grade: 'B', origin: '', photo_url: '', ref_price: null };
const digits = (v: string) => v.replace(/\D/g, '');

export default function VendorItems() {
  const router = useRouter();
  const { add } = useLocalSearchParams<{ add?: string }>();
  const { session, marketVendor: me, loadProfile } = useAuth();
  const [items, setItems] = useState<MarketVendorItem[] | null>(null);
  const [standard, setStandard] = useState<MarketItem[]>([]);
  const [filter, setFilter] = useState('all');
  const [editing, setEditing] = useState<Form | null>(null);
  const [q, setQ] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!session) return;
    try { setItems(await loadVendorItems(session.user.id)); } catch (e) { setItems([]); toast.error((e as Error).message); }
  }, [session]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { supabase.from('market_items').select('id, name, category, unit, ref_price').eq('active', true).order('name').then(({ data }) => setStandard((data as MarketItem[]) ?? [])); }, []);
  useEffect(() => { if (add === '1') { setEditing({ ...emptyForm }); router.setParams({ add: '' } as never); } }, [add]); // eslint-disable-line react-hooks/exhaustive-deps

  const list = items ?? [];
  const cats = useMemo(() => Array.from(new Set(list.map((i) => i.category))), [list]);
  const shown = list.filter((i) => filter === 'all' || i.category === filter);
  const outCount = list.filter((i) => !i.in_stock).length;
  const ql = q.trim().toLowerCase();
  const matches = ql.length >= 2 ? standard.filter((m) => m.name.toLowerCase().includes(ql)).slice(0, 8) : [];

  const openEdit = (it: MarketVendorItem) => setEditing({ id: it.id, item_id: it.item_id, name: it.name, category: it.category, unit: it.unit, price: String(it.price), grade: it.grade, origin: it.origin ?? '', photo_url: it.photo_url ?? '', ref_price: it.ref_price ?? null });
  const pickStandard = (m: MarketItem) => { setEditing((e) => e && { ...e, item_id: m.id, name: m.name, category: m.category, unit: m.unit, ref_price: m.ref_price }); setQ(''); };
  const patch = (p: Partial<Form>) => setEditing((e) => e && { ...e, ...p });

  const save = async () => {
    if (!editing) return;
    const price = Number(digits(editing.price));
    if (editing.name.trim().length < 2) return toast.error('Nama barang wajib diisi');
    if (!price) return toast.error('Harga wajib diisi');
    if (editing.ref_price && price > editing.ref_price * COEF_HARD) return toast.error(`Harga melebihi ${COEF_HARD}× acuan (${rupiah(editing.ref_price)}). Turunkan harga.`);
    setBusy(true);
    try {
      await rpc('vendor_upsert_item', { p: { id: editing.id ?? null, item_id: editing.item_id, name: editing.name.trim(), category: editing.category, unit: editing.unit, price, grade: editing.grade, origin: editing.origin.trim() || null, photo_url: editing.photo_url || null } });
      toast.success(editing.id ? 'Barang diperbarui' : 'Barang ditambahkan');
      setEditing(null); setQ(''); await load(); loadProfile();
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };
  const toggleStock = async (it: MarketVendorItem) => {
    setItems((l) => l && l.map((x) => (x.id === it.id ? { ...x, in_stock: !it.in_stock } : x)));
    try { await rpc('vendor_set_stock', { p_ids: [it.id], p_in_stock: !it.in_stock }); } catch (e) { toast.error((e as Error).message); load(); }
  };
  const bulkStock = async (inStock: boolean) => {
    const ids = Array.from(selected); if (ids.length === 0) return toast.error('Pilih barang dulu');
    try { await rpc('vendor_set_stock', { p_ids: ids, p_in_stock: inStock }); toast.success(`${ids.length} barang ditandai ${inStock ? 'tersedia' : 'habis'}`); setSelected(new Set()); setSelecting(false); load(); }
    catch (e) { toast.error((e as Error).message); }
  };
  const remove = async () => {
    if (!editing?.id) return;
    try { await rpc('vendor_upsert_item', { p: { id: editing.id, name: editing.name, price: Number(digits(editing.price)) || 1, active: false } }); toast.show('Barang dihapus dari lapak'); setEditing(null); load(); loadProfile(); }
    catch (e) { toast.error((e as Error).message); }
  };
  const upload = async () => { if (!session) return; try { const r = await pickAndUpload('merchant-images', session.user.id); if (r) patch({ photo_url: r.url }); } catch (e) { toast.error((e as Error).message); } };
  const toggleSelect = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const price = Number(digits(editing?.price ?? ''));
  const ref = editing?.ref_price ?? null;
  const priceWarn = ref && price ? (price > ref * COEF_HARD ? ['Ditolak: melebihi 1,6× acuan', colors.danger] : price > ref * COEF_MAX ? [`Di atas ${COEF_MAX}× acuan — menurunkan skor kualitas`, colors.warning] : price < ref * COEF_MIN ? ['Terlalu murah dari acuan — periksa lagi', colors.warning] : ['Harga wajar', colors.success]) : null;

  return (
    <Screen title="Barang Dagangan" subtitle={me?.stall_name} bottomSpace={TAB_BAR_SPACE + 16} right={<CircleButton icon={selecting ? 'close' : 'checkbox-outline'} onPress={() => { setSelecting((v) => !v); setSelected(new Set()); }} />}>
      {items === null ? <View style={{ gap: 10 }}>{[0, 1, 2].map((i) => <View key={i} style={s.item}><Skeleton width={56} height={56} radius={14} /><View style={{ flex: 1, gap: 6 }}><Skeleton width="60%" height={14} /><Skeleton width="40%" height={12} /></View></View>)}</View>
        : list.length === 0 ? <Empty icon="basket-outline" title="Belum ada barang" subtitle="Tambahkan barang dagangan dengan foto, harga, dan grade." action={<Button title="Tambah barang" icon="add-circle-outline" onPress={() => setEditing({ ...emptyForm })} />} /> : (
        <View style={{ gap: 12 }}>
          <Entrance index={0}>
            <Row between>
              <Text style={font.h3}>{list.length} barang</Text>
              <Text style={font.tiny}>{outCount} habis · {list.filter((i) => !isFresh(i.updated_at)).length} perlu update</Text>
            </Row>
          </Entrance>
          {selecting && (
            <View style={s.bulk}>
              <Text style={[font.small, { flex: 1, color: colors.text, fontWeight: '700' }]}>{selected.size} dipilih</Text>
              <Button title="Semua" size="sm" variant="ghost" onPress={() => setSelected(new Set(shown.map((i) => i.id)))} />
              <Button title="Tandai habis" size="sm" variant="outline" color={colors.danger} onPress={() => bulkStock(false)} />
              <Button title="Tersedia" size="sm" onPress={() => bulkStock(true)} />
            </View>
          )}
          {cats.length > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              <Chip label="Semua" active={filter === 'all'} onPress={() => setFilter('all')} />
              {cats.map((c) => <Chip key={c} label={marketCategoryLabel[c] ?? c} active={filter === c} onPress={() => setFilter(c)} />)}
            </ScrollView>
          )}
          {shown.map((it, i) => {
            const g = GRADE_INFO[it.grade] ?? GRADE_INFO.B;
            const diff = it.ref_price ? Math.round(((it.price - it.ref_price) / it.ref_price) * 100) : null;
            const stale = !isFresh(it.updated_at);
            const sel = selected.has(it.id);
            return (
              <Entrance key={it.id} index={Math.min(i + 1, 8)} from="up">
                <PressableScale onPress={() => (selecting ? toggleSelect(it.id) : openEdit(it))} scaleTo={0.985} haptic={false} style={[s.item, !it.in_stock && { opacity: 0.6 }, sel && { borderColor: colors.primary, backgroundColor: colors.tint }]}>
                  {selecting && <Ionicons name={sel ? 'checkbox' : 'square-outline'} size={22} color={sel ? colors.primary : colors.textMuted} />}
                  {it.photo_url ? <Image source={{ uri: it.photo_url }} style={s.thumb} /> : <View style={[s.thumb, { alignItems: 'center', justifyContent: 'center' }]}><ServiceIllustration kind="market" size={30} /></View>}
                  <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                    <Row gap={6}><Text style={[font.body, { fontWeight: '700', flexShrink: 1 }]} numberOfLines={1}>{it.name}</Text><Badge text={it.grade} color={g.color} /></Row>
                    <Text style={font.tiny} numberOfLines={1}>{marketCategoryLabel[it.category] ?? it.category} · per {it.unit}{it.origin ? ` · ${it.origin}` : ''}{!it.photo_url ? ' · tanpa foto' : ''}</Text>
                    <Row gap={6} style={{ flexWrap: 'wrap' }}>
                      <Text style={{ fontWeight: '800', color: colors.primary, fontSize: 15 }}>{rupiah(it.price)}</Text>
                      {it.ref_price ? <Text style={[font.tiny, { color: diff != null && (diff > 25 || diff < -40) ? colors.warning : colors.textMuted }]}>acuan {rupiah(it.ref_price)}{diff ? ` (${diff > 0 ? '+' : ''}${diff}%)` : ''}</Text> : <Text style={font.tiny}>tanpa acuan</Text>}
                      {stale && <Badge text="Perbarui harga" color={colors.warning} />}
                    </Row>
                  </View>
                  {!selecting && (
                    <View style={{ alignItems: 'center', gap: 2 }}>
                      <Switch value={it.in_stock} onValueChange={() => toggleStock(it)} trackColor={{ true: colors.primary, false: colors.border }} thumbColor="#fff" style={Platform.OS === 'ios' ? { transform: [{ scale: 0.75 }] } : undefined} />
                      <Text style={[font.tiny, { fontWeight: '700', color: it.in_stock ? colors.primary : colors.textMuted }]}>{it.in_stock ? 'Ada' : 'Habis'}</Text>
                    </View>
                  )}
                </PressableScale>
              </Entrance>
            );
          })}
          <Text style={font.tiny}>Ketuk barang untuk mengubah harga/foto. Menyimpan ulang memperbarui tanggal harga (kesegaran ≤3 hari).</Text>
        </View>
      )}

      <Modal visible={!!editing} animationType="fade" transparent onRequestClose={() => setEditing(null)}>
        <View style={s.modalBg}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setEditing(null)} />
          <Animated.View entering={FadeInDown.springify().stiffness(280).damping(18)} style={s.modal}>
            <View style={s.handle} />
            <ScrollView contentContainerStyle={{ gap: 12 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <Row between><Text style={font.h2}>{editing?.id ? 'Edit barang' : 'Tambah barang'}</Text><CircleButton icon="close" onPress={() => setEditing(null)} /></Row>

              {/* Bahan standar (tautan ke acuan) atau nama bebas */}
              <View style={{ gap: 6 }}>
                <Text style={font.label}>Bahan standar pasar</Text>
                <Text style={font.tiny}>Pilih dari daftar agar harga dibandingkan dengan acuan (skor lebih tinggi), atau ketik nama bebas.</Text>
                {editing?.item_id ? (
                  <Row gap={8} style={s.linked}>
                    <Ionicons name="link-outline" size={16} color={colors.primary} />
                    <Text style={[font.small, { flex: 1, color: colors.text, fontWeight: '600' }]} numberOfLines={1}>{editing.name} · acuan {editing.ref_price ? rupiah(editing.ref_price) : '-'}/{editing.unit}</Text>
                    <PressableScale haptic={false} onPress={() => patch({ item_id: null, ref_price: null })}><Text style={{ color: colors.danger, fontWeight: '700', fontSize: 12 }}>Lepas</Text></PressableScale>
                  </Row>
                ) : (
                  <>
                    <Input icon="search" placeholder="Cari bahan (mis. cabai merah)" value={q} onChangeText={setQ} />
                    {matches.length > 0 && (
                      <View style={s.suggest}>
                        {matches.map((m) => (
                          <PressableScale key={m.id} haptic={false} onPress={() => pickStandard(m)} style={s.suggestRow}>
                            <Text style={[font.small, { flex: 1, color: colors.text }]} numberOfLines={1}>{m.name}</Text>
                            <Text style={font.tiny}>{marketCategoryLabel[m.category] ?? m.category} · {rupiah(m.ref_price)}/{m.unit}</Text>
                          </PressableScale>
                        ))}
                      </View>
                    )}
                  </>
                )}
              </View>

              <Input label="Nama barang" placeholder="Cabai merah keriting" value={editing?.name ?? ''} onChangeText={(v) => patch({ name: v })} editable={!editing?.item_id} />
              <Text style={font.tiny}>Kategori</Text>
              <Row gap={8} style={{ flexWrap: 'wrap' }}>{CATS.map((c) => <Chip key={c} label={marketCategoryLabel[c] ?? c} active={editing?.category === c} onPress={() => patch({ category: c })} />)}</Row>
              <Text style={font.tiny}>Satuan</Text>
              <Row gap={8} style={{ flexWrap: 'wrap' }}>{UNITS.map((u) => <Chip key={u} label={u} active={editing?.unit === u} onPress={() => patch({ unit: u })} />)}</Row>
              <Input label={`Harga per ${editing?.unit ?? 'satuan'} (Rp)`} keyboardType="number-pad" icon="pricetag-outline" value={editing?.price ?? ''} onChangeText={(v) => patch({ price: digits(v) })} />
              {ref ? <Text style={font.tiny}>Acuan {rupiah(ref)} · wajar {rupiah(Math.round(ref * COEF_MIN))}–{rupiah(Math.round(ref * COEF_MAX))} · maksimal {rupiah(Math.round(ref * COEF_HARD))}</Text> : null}
              {priceWarn && <Row gap={6}><Ionicons name={priceWarn[1] === colors.success ? 'checkmark-circle' : 'alert-circle'} size={14} color={priceWarn[1]} /><Text style={[font.tiny, { color: priceWarn[1], fontWeight: '700' }]}>{priceWarn[0]}</Text></Row>}

              <Text style={font.tiny}>Grade kualitas</Text>
              <View style={{ gap: 8 }}>
                {GRADES.map((g) => {
                  const info = GRADE_INFO[g]; const active = editing?.grade === g;
                  return (
                    <PressableScale key={g} haptic={false} onPress={() => patch({ grade: g })} scaleTo={0.985} style={[s.grade, active && { borderColor: info.color, backgroundColor: info.color + '10' }]}>
                      <View style={[s.gradeDot, { backgroundColor: info.color }]}><Text style={{ color: '#fff', fontWeight: '800', fontSize: 14 }}>{g}</Text></View>
                      <View style={{ flex: 1 }}><Text style={[font.small, { color: colors.text, fontWeight: '700' }]}>{info.label}</Text><Text style={font.tiny}>{info.desc}</Text></View>
                      {active && <Ionicons name="checkmark-circle" size={20} color={info.color} />}
                    </PressableScale>
                  );
                })}
              </View>
              <Input label="Asal barang (opsional)" placeholder="Alahan Panjang / Brebes / lokal" icon="leaf-outline" value={editing?.origin ?? ''} onChangeText={(v) => patch({ origin: v })} />
              <Row gap={10}>
                {editing?.photo_url ? <Image source={{ uri: editing.photo_url }} style={s.preview} /> : null}
                <Button title={editing?.photo_url ? 'Ganti foto' : 'Unggah foto barang'} variant="secondary" icon="camera-outline" onPress={upload} style={{ flex: 1 }} />
              </Row>
              <Button title={editing?.id ? 'Simpan perubahan' : 'Tambah ke lapak'} size="lg" loading={busy} onPress={save} />
              {editing?.id ? <Button title="Hapus dari lapak" variant="ghost" color={colors.danger} icon="trash-outline" onPress={remove} /> : null}
            </ScrollView>
          </Animated.View>
        </View>
      </Modal>
    </Screen>
  );
}

const s = StyleSheet.create({
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 20, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, ...shadow.soft },
  thumb: { width: 56, height: 56, borderRadius: 14, backgroundColor: colors.tint },
  bulk: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8, paddingLeft: 12, borderRadius: radius.md, backgroundColor: colors.tint, borderWidth: 1, borderColor: colors.primaryLight, flexWrap: 'wrap' },
  linked: { padding: 10, borderRadius: radius.md, backgroundColor: colors.tint, borderWidth: 1, borderColor: colors.primaryLight, alignItems: 'center' },
  suggest: { borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: '#fff', overflow: 'hidden' },
  suggestRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  grade: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, backgroundColor: '#fff' },
  gradeDot: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  preview: { width: 64, height: 64, borderRadius: 14, backgroundColor: colors.bgSoft },
  modalBg: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  modal: { backgroundColor: '#fff', borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: 20, paddingBottom: 32, maxHeight: '92%', width: '100%', maxWidth: 640, alignSelf: 'center', overflow: 'hidden', ...shadow.sheet },
  handle: { width: 44, height: 5, borderRadius: 3, backgroundColor: colors.border, alignSelf: 'center', marginBottom: 12 },
});
