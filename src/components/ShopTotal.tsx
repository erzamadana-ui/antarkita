// Driver memasukkan belanja riil (AntarShop & AntarMarket): harga per item sesuai nota, total, foto nota → set_shopping_actual
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TextInput } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Row, Button, Badge, toast } from '@/components/ui';
import { PressableScale } from '@/components/motion';
import { DocUpload } from '@/components/DocUpload';
import { rpc } from '@/lib/supabase';
import { colors, font, radius } from '@/lib/theme';
import { rupiah } from '@/lib/format';
import type { Order, ShoppingItem } from '@/lib/types';

type RowState = { key: string; item_id?: string; product_id?: string; name: string; unit?: string; qty: string; ref: number; price: string; unavailable: boolean };
const num = (v: string) => Number(String(v).replace(',', '.').replace(/[^\d.]/g, '')) || 0;
const COEF_MIN = 0.6, COEF_MAX = 1.25, COEF_HARD = 1.6;
/** Peringatan koefisien harga riil vs acuan (AntarMarket). */
const coefWarn = (price: number, ref: number): [string, string] | null => {
  if (!ref || !price) return null;
  const k = price / ref;
  if (k > COEF_HARD) return [`${k.toFixed(2)}× acuan — melebihi ${COEF_HARD}×, akan ditolak`, colors.danger];
  if (k > COEF_MAX) return [`${k.toFixed(2)}× acuan — di luar koefisien (maks ${COEF_MAX}×), foto nota wajib`, colors.warning];
  if (k < COEF_MIN) return [`${k.toFixed(2)}× acuan — di luar koefisien (min ${COEF_MIN}×), foto nota wajib`, colors.warning];
  return null;
};
const fmtQty = (n: number) => String(Math.round(n * 100) / 100).replace('.', ',');

function initialRows(order: Order): RowState[] {
  const list = order.shopping_list ?? [];
  const actual = order.actual_items ?? null;
  return list.map((it, i) => {
    const key = it.item_id ?? it.product_id ?? `${i}`;
    const a = actual?.find((x, j) => (x.item_id && x.item_id === it.item_id) || (x.product_id && x.product_id === it.product_id) || (!x.item_id && !x.product_id && j === i));
    const ref = it.price ?? it.ref_price ?? 0;
    const price = a?.price ?? ref;
    return { key, item_id: it.item_id, product_id: it.product_id, name: it.name, unit: it.unit, qty: fmtQty(a?.qty ?? it.qty), ref, price: String(price), unavailable: !!a && (a.price ?? 0) === 0 };
  });
}

export function ShopTotalCard({ order, onDone }: { order: Order; onDone: () => void }) {
  const isMarket = order.service === 'market';
  const list = order.shopping_list ?? [];
  const fromCatalog = list.length > 0 && (isMarket ? list.every((i) => !!i.item_id) : list.every((i) => !!i.product_id));
  const color = isMarket ? colors.market : colors.shop;
  const [rows, setRows] = useState<RowState[]>(() => initialRows(order));
  const [amount, setAmount] = useState(String(order.receipt_url ? order.items_subtotal : ''));
  const [manual, setManual] = useState(!!order.receipt_url);
  const [receipt, setReceipt] = useState<string | null>(order.receipt_url ?? null);
  const [busy, setBusy] = useState(false);
  const budget = order.est_budget ?? 0;
  const limit = Math.max(Math.floor(budget * 1.3), budget + 50000);

  const autoTotal = useMemo(() => rows.reduce((a, r) => a + (r.unavailable ? 0 : Math.round(num(r.price) * num(r.qty))), 0), [rows]);
  useEffect(() => { if (fromCatalog && !manual) setAmount(autoTotal ? String(autoTotal) : ''); }, [autoTotal, fromCatalog, manual]);
  const patch = (key: string, p: Partial<RowState>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));

  const save = async () => {
    const v = Number(amount.replace(/\D/g, ''));
    if (!v && !(fromCatalog && rows.every((r) => r.unavailable))) { toast.error('Masukkan total belanja sesuai nota'); return; }
    if (v > limit) { toast.error(`Total melebihi batas ${rupiah(limit)}. Konfirmasi ke pelanggan.`); return; }
    if (isMarket && !receipt) { toast.error('Unggah foto nota pasar dulu'); return; }
    const items: ShoppingItem[] | null = fromCatalog ? rows.map((r) => ({ ...(r.item_id ? { item_id: r.item_id } : {}), ...(r.product_id ? { product_id: r.product_id } : {}), name: r.name, qty: num(r.qty), price: r.unavailable ? 0 : Math.round(num(r.price)) })) : null;
    setBusy(true);
    try { await rpc('set_shopping_actual', { p_order_id: order.id, p_amount: v, p_receipt_url: receipt, p_items: items }); toast.success('Belanja riil disimpan'); onDone(); }
    catch (e) { toast.error((e as Error).message); }
    setBusy(false);
  };

  return (
    <View style={[s.card, { borderColor: color + '55' }]}>
      <Row gap={8}><Ionicons name="basket" size={20} color={color} /><Text style={[font.h3, { flex: 1 }]}>{isMarket ? 'Harga riil dari pasar' : 'Total belanja aktual'}</Text><Badge text={`Anggaran ${rupiah(budget)}`} color={color} /></Row>
      <Text style={font.tiny}>
        {isMarket ? 'Isi harga riil per bahan sesuai nota; harga ini jadi acuan pelanggan berikutnya. ' : 'Sesuai nota. '}
        Batas maksimal {rupiah(limit)}. Jika lebih, konfirmasi ke pelanggan lewat chat/telepon.
        {order.payment_method === 'wallet' ? ' Selisih otomatis disesuaikan dari AntarPay pelanggan; penggantian belanja + jasa belanja masuk ke saldo Anda saat order selesai.' : ' Pesanan tunai: tagih total ke pelanggan saat serah terima.'}
      </Text>

      {isMarket && (
        <View style={s.rule}>
          <Ionicons name="shield-checkmark-outline" size={16} color={colors.market} style={{ marginTop: 1 }} />
          <Text style={[font.tiny, { flex: 1, color: colors.text }]}>Aturan koefisien: harga riil wajar {COEF_MIN}×–{COEF_MAX}× harga acuan. Di luar rentang itu foto nota wajib & ditandai untuk peninjauan; di atas {COEF_HARD}× otomatis ditolak.</Text>
        </View>
      )}
      {fromCatalog && (
        <View style={{ gap: 6 }}>
          {rows.map((r) => {
            const warn = isMarket && !r.unavailable ? coefWarn(num(r.price), r.ref) : null;
            return (
            <View key={r.key} style={[s.item, r.unavailable && { opacity: 0.55 }, warn && { borderColor: warn[1] }]}>
              <Row between>
                <Text style={[font.body, { fontWeight: '600', flex: 1 }]} numberOfLines={1}>{r.name}</Text>
                <Text style={font.tiny}>{r.ref ? `acuan ${rupiah(r.ref)}${r.unit ? `/${r.unit}` : ''}` : 'tanpa acuan'}</Text>
              </Row>
              {isMarket ? (
                <Row gap={8}>
                  <View style={{ flex: 1 }}>
                    <Text style={font.tiny}>Harga riil{r.unit ? ` per ${r.unit}` : ''}</Text>
                    <TextInput placeholder={String(r.ref)} placeholderTextColor={colors.textMuted} keyboardType="number-pad" value={r.unavailable ? '' : r.price} editable={!r.unavailable} onChangeText={(v) => patch(r.key, { price: v.replace(/\D/g, '') })} style={s.small} />
                  </View>
                  <View style={{ width: 84 }}>
                    <Text style={font.tiny}>Jumlah{r.unit ? ` (${r.unit})` : ''}</Text>
                    <TextInput placeholderTextColor={colors.textMuted} keyboardType="decimal-pad" value={r.qty} editable={!r.unavailable} onChangeText={(v) => patch(r.key, { qty: v.replace(/[^\d.,]/g, '') })} style={s.small} />
                  </View>
                  <View style={{ alignItems: 'flex-end', minWidth: 80 }}>
                    <Text style={font.tiny}>Subtotal</Text>
                    <Text style={{ fontWeight: '700', color: colors.text, marginTop: 8 }}>{rupiah(r.unavailable ? 0 : num(r.price) * num(r.qty))}</Text>
                  </View>
                </Row>
              ) : (
                <Row between>
                  <Text style={font.small}>{fmtQty(num(r.qty))} × {rupiah(r.ref)}</Text>
                  <Text style={{ fontWeight: '700', color: colors.text, textDecorationLine: r.unavailable ? 'line-through' : 'none' }}>{rupiah(r.ref * num(r.qty))}</Text>
                </Row>
              )}
              {warn && <Row gap={6}><Ionicons name="alert-circle" size={16} color={warn[1]} /><Text style={[font.tiny, { flex: 1, color: warn[1], fontWeight: '700' }]}>{warn[0]}</Text></Row>}
              <PressableScale haptic={false} onPress={() => patch(r.key, { unavailable: !r.unavailable })} style={s.check}>
                <Ionicons name={r.unavailable ? 'checkbox' : 'square-outline'} size={20} color={r.unavailable ? colors.danger : colors.textMuted} />
                <Text style={[font.tiny, { color: r.unavailable ? colors.danger : colors.textSecondary }]}>Tidak tersedia / tidak dibeli</Text>
              </PressableScale>
            </View>
            );
          })}
        </View>
      )}

      <View style={{ gap: 6 }}>
        <Row between>
          <Text style={font.label}>Total sesuai nota</Text>
          {fromCatalog && manual && <PressableScale haptic={false} onPress={() => { setManual(false); setAmount(autoTotal ? String(autoTotal) : ''); }}><Text style={{ color, fontWeight: '700', fontSize: 12 }}>Hitung otomatis ({rupiah(autoTotal)})</Text></PressableScale>}
        </Row>
        <TextInput placeholder="Total belanja (Rp)" placeholderTextColor={colors.textMuted} keyboardType="number-pad" value={amount} onChangeText={(v) => { setManual(true); setAmount(v.replace(/\D/g, '')); }} style={s.input} />
        {Number(amount) > limit && <Text style={[font.tiny, { color: colors.danger }]}>Melebihi batas {rupiah(limit)} — minta pelanggan menambah anggaran atau kurangi belanja.</Text>}
      </View>
      <DocUpload label={isMarket ? 'Foto nota pasar' : 'Foto nota / struk'} hint="Ketuk untuk unggah foto nota" value={receipt} onChange={setReceipt} bucket="proofs" color={color} required={isMarket} />
      <Button title={isMarket ? 'Simpan harga riil & nota' : 'Simpan total belanja'} size="md" color={color} loading={busy} onPress={save} />
    </View>
  );
}
const s = StyleSheet.create({
  card: { gap: 10, backgroundColor: colors.surface, borderRadius: radius.lg, padding: 14, borderWidth: 1 },
  item: { gap: 6, padding: 10, borderRadius: radius.sm, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border },
  input: { height: 46, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: 12, color: colors.text, fontSize: 16, fontWeight: '700' },
  small: { height: 38, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: 10, color: colors.text, fontSize: 14, marginTop: 2 },
  check: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 2 },
  rule: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 10, borderRadius: radius.sm, backgroundColor: colors.successLight, borderWidth: 1, borderColor: colors.market + '33' },
});
