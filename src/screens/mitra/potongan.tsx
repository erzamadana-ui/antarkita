// Potongan per transaksi (migrasi 0126) — aplikasi Mitra, rute /potongan.
// Ringkasan `partner_fee_statement_summary(p_from, p_to)` + daftar `partner_fee_statement(p_from, p_to)` (filter bulan).
// Kolom: gross (nilai sebelum potongan), biaya platform, PPN (inklusif), bersih (hak mitra), via (tunai/saldo).
// Mitra yang login: driver / pemilik merchant / mitra travel — server yang memilih peran, UI hanya menampilkan.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Screen, Card, Row, Badge, Button, Chip } from '@/components/ui';
import { Entrance, Skeleton, AnimatedNumber } from '@/components/motion';
import { rpc } from '@/lib/supabase';
import { colors, font, radius, shadow } from '@/lib/theme';
import { rupiah, formatDate } from '@/lib/format';

export interface FeeStatementRow {
  order_id: string | null; source: 'orders' | 'travel_bookings' | 'travel_requests'; source_id: string; code: string;
  service: string; role: 'driver' | 'merchant' | 'travel'; completed_at: string | null;
  gross: number; platform_fee: number; ppn: number; fee_total: number; net_to_partner: number;
  paid_via: 'cash' | 'wallet' | string; wallet_delta: number; cash_held: number; note: string | null;
}
export interface FeeStatementSummary {
  from: string; to: string; count: number; gross: number; platform_fee: number; ppn: number; fee_total: number; net_to_partner: number;
  wallet_delta: number; cash_held: number; cash_count: number; wallet_count: number; by_service: Record<string, number>;
}

const SERVICE_LABEL: Record<string, string> = {
  ride_motor: 'AntarRide', ride_car: 'AntarCar', food: 'AntarFood', send: 'AntarSend', shop: 'AntarShop', market: 'AntarMarket', box: 'AntarBox',
  travel_shared: 'Travel kursi', travel_charter: 'Travel carter', travel_send: 'Titipan antar kota',
};
const ROLE_LABEL: Record<string, string> = { driver: 'Driver', merchant: 'Merchant', travel: 'Mitra travel' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

/** Rentang tanggal bulan ke-i mundur dari bulan ini (0 = bulan ini) dalam zona lokal perangkat (WIB untuk mitra). */
export function monthRange(back: number, now: Date = new Date()): { from: string; to: string; label: string } {
  const d = new Date(now.getFullYear(), now.getMonth() - back, 1);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  const ymd = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  return { from: ymd(d), to: ymd(end), label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}` };
}

export default function PotonganScreen() {
  const [back, setBack] = useState(0);
  const months = useMemo(() => Array.from({ length: 6 }, (_, i) => ({ back: i, ...monthRange(i) })), []);
  const range = months[back];
  const [sum, setSum] = useState<FeeStatementSummary | null>(null);
  const [rows, setRows] = useState<FeeStatementRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null); setRows(null); setSum(null);
    try {
      const [s, r] = await Promise.all([
        rpc<FeeStatementSummary>('partner_fee_statement_summary', { p_from: range.from, p_to: range.to }),
        rpc<FeeStatementRow[]>('partner_fee_statement', { p_from: range.from, p_to: range.to }),
      ]);
      setSum(s); setRows(r ?? []);
    } catch (e) { setErr((e as Error).message); setRows([]); }
  }, [range.from, range.to]);
  useEffect(() => { void load(); }, [load]);

  const list = rows ?? [];
  const visible = showAll ? list : list.slice(0, 25);
  const pct = sum && sum.gross > 0 ? Math.round((sum.fee_total / sum.gross) * 1000) / 10 : null;

  return (
    <Screen title="Potongan per Transaksi" subtitle="Biaya platform & PPN tiap order" back maxWidth={720}>
      <View style={{ gap: 14 }}>
        <Entrance index={0}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {months.map((m) => <Chip key={m.back} label={m.label} active={back === m.back} onPress={() => { setBack(m.back); setShowAll(false); }} />)}
          </ScrollView>
        </Entrance>

        {err ? (
          <Entrance index={1}><Row gap={8} style={s.err}><Ionicons name="alert-circle" size={16} color={colors.warning} /><Text style={[font.tiny, { flex: 1, color: colors.text }]}>Laporan belum bisa dimuat: {err}</Text><Button title="Coba lagi" size="sm" variant="ghost" onPress={load} /></Row></Entrance>
        ) : null}

        <Entrance index={1}>
          <View style={s.hero}>
            <Text style={s.heroLbl}>Diterima bersih · {range.label}</Text>
            {sum ? <AnimatedNumber value={sum.net_to_partner} format={rupiah} style={{ color: '#fff', fontSize: 30, fontWeight: '700', letterSpacing: -0.5, marginTop: 6 }} /> : <Skeleton height={36} radius={radius.md} />}
            <Text style={s.heroLbl}>{sum ? `${sum.count} transaksi · ${sum.cash_count} tunai · ${sum.wallet_count} saldo` : 'Memuat…'}</Text>
          </View>
        </Entrance>

        <Entrance index={2}>
          <Row gap={10} style={{ flexWrap: 'wrap' }}>
            <Stat icon="cash-outline" label="Nilai sebelum potongan" value={sum?.gross} />
            <Stat icon="pie-chart-outline" label={`Biaya platform${pct != null ? ` (${pct.toString().replace('.', ',')} %)` : ''}`} value={sum ? sum.platform_fee : undefined} color={colors.warning} />
            <Stat icon="receipt-outline" label="PPN (termasuk dalam biaya)" value={sum?.ppn} color={colors.textSecondary} />
            <Stat icon="wallet-outline" label="Mutasi saldo AntarVoucher" value={sum?.wallet_delta} signed />
          </Row>
        </Entrance>

        <Entrance index={3}>
          <Row gap={8} style={s.note}>
            <Ionicons name="information-circle-outline" size={16} color={colors.primary} />
            <Text style={[font.tiny, { flex: 1 }]}>
              Potongan = biaya platform + PPN (inklusif, sudah termasuk — tidak ada pajak tambahan). Order <Text style={{ fontWeight: '700' }}>tunai</Text>: Anda memegang uang pelanggan, lalu setoran (biaya platform/komisi) dipotong dari saldo — tampil sebagai mutasi saldo negatif. Order <Text style={{ fontWeight: '700' }}>saldo</Text>: hak bersih dikredit ke saldo. Angka diambil dari buku besar order (fase terakhir), bukan estimasi.
              {sum && sum.cash_held > 0 ? ` Tunai yang Anda pegang bulan ini: ${rupiah(sum.cash_held)}.` : ''}
            </Text>
          </Row>
        </Entrance>

        <Entrance index={4}>
          <Card style={{ gap: 8 }}>
            <Row between><Text style={font.h3}>Rincian transaksi</Text><Badge text={`${list.length}`} color={colors.textMuted} /></Row>
            {rows == null ? <View style={{ gap: 8 }}><Skeleton height={56} radius={radius.md} /><Skeleton height={56} radius={radius.md} /><Skeleton height={56} radius={radius.md} /></View>
              : list.length === 0 ? <Text style={font.small}>Belum ada transaksi selesai pada {range.label}.</Text>
              : (
                <>
                  <Row gap={8} style={s.head}>
                    <Text style={[s.th, { flex: 2.2 }]}>Transaksi</Text>
                    <Text style={[s.th, s.right, { flex: 1.3 }]}>Nilai</Text>
                    <Text style={[s.th, s.right, { flex: 1.2 }]}>Potongan</Text>
                    <Text style={[s.th, s.right, { flex: 1.3 }]}>Bersih</Text>
                  </Row>
                  {visible.map((r) => {
                    const key = `${r.source}-${r.source_id}`;
                    const isOpen = open === key;
                    return (
                      <View key={key} style={s.row}>
                        <Row gap={8} style={{ alignItems: 'flex-start' }}>
                          <View style={{ flex: 2.2, minWidth: 0 }}>
                            <Text style={[font.body, { fontWeight: '700', fontSize: 14 }]} numberOfLines={1} onPress={() => setOpen(isOpen ? null : key)}>{SERVICE_LABEL[r.service] ?? r.service}</Text>
                            <Text style={font.tiny} numberOfLines={1}>{r.code}{r.completed_at ? ` · ${formatDate(r.completed_at)}` : ''}</Text>
                            <Row gap={4} style={{ marginTop: 2 }}>
                              <Ionicons name={r.paid_via === 'cash' ? 'cash-outline' : 'wallet-outline'} size={12} color={r.paid_via === 'cash' ? colors.warning : colors.primary} />
                              <Text style={[font.tiny, { fontWeight: '700', color: r.paid_via === 'cash' ? colors.warning : colors.primary }]}>{r.paid_via === 'cash' ? 'Tunai' : 'Saldo'}</Text>
                              {r.role !== 'driver' ? <Text style={font.tiny}> · {ROLE_LABEL[r.role] ?? r.role}</Text> : null}
                            </Row>
                          </View>
                          <Text style={[s.td, { flex: 1.3 }]}>{rupiah(r.gross)}</Text>
                          <Text style={[s.td, { flex: 1.2, color: colors.warning }]}>-{rupiah(r.fee_total)}</Text>
                          <Text style={[s.td, { flex: 1.3, color: colors.primary, fontWeight: '700' }]}>{rupiah(r.net_to_partner)}</Text>
                        </Row>
                        <Button title={isOpen ? 'Tutup rincian' : 'Rincian'} size="sm" variant="ghost" icon={isOpen ? 'chevron-up' : 'chevron-down'} onPress={() => setOpen(isOpen ? null : key)} style={{ alignSelf: 'flex-start', marginTop: 2 }} />
                        {isOpen && (
                          <View style={s.detail}>
                            <Row between><Text style={font.tiny}>Biaya platform</Text><Text style={font.tiny}>{rupiah(r.platform_fee)}</Text></Row>
                            <Row between><Text style={font.tiny}>PPN (termasuk)</Text><Text style={font.tiny}>{rupiah(r.ppn)}</Text></Row>
                            <Row between><Text style={font.tiny}>Mutasi saldo AntarVoucher</Text><Text style={[font.tiny, { fontWeight: '700', color: r.wallet_delta < 0 ? colors.danger : colors.success }]}>{r.wallet_delta < 0 ? '-' : '+'}{rupiah(Math.abs(r.wallet_delta))}</Text></Row>
                            {r.cash_held > 0 ? <Row between><Text style={font.tiny}>Tunai dipegang</Text><Text style={font.tiny}>{rupiah(r.cash_held)}</Text></Row> : null}
                            {r.note ? <Text style={[font.tiny, { marginTop: 2 }]}>{r.note}</Text> : null}
                          </View>
                        )}
                      </View>
                    );
                  })}
                  {list.length > visible.length && <Button title={`Tampilkan semua (${list.length})`} variant="ghost" size="sm" onPress={() => setShowAll(true)} />}
                </>
              )}
          </Card>
        </Entrance>
        <Text style={[font.tiny, { textAlign: 'center' }]}>Sumber: partner_fee_statement (buku besar order fase selesai/penyesuaian terakhir). Komisi merchant AntarFood tunai terkumpul lewat pembayaran driver ke merchant, bukan potongan saldo.</Text>
      </View>
    </Screen>
  );
}

function Stat({ icon, label, value, color = colors.primary, signed }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; value: number | undefined; color?: string; signed?: boolean }) {
  return (
    <View style={s.stat}>
      <View style={[s.statIcon, { backgroundColor: color + '1A' }]}><Ionicons name={icon} size={18} color={color} /></View>
      {value === undefined ? <Skeleton height={22} radius={6} /> : <Text style={[font.h3, { color, marginTop: 8 }]} numberOfLines={1} adjustsFontSizeToFit>{signed && value > 0 ? '+' : ''}{signed && value < 0 ? '-' : ''}{rupiah(Math.abs(value))}</Text>}
      <Text style={font.tiny} numberOfLines={2}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  hero: { borderRadius: radius.lg, padding: 18, backgroundColor: colors.primary, gap: 2, ...shadow.glow(colors.primary) },
  heroLbl: { color: 'rgba(255,255,255,0.88)', fontSize: 12, fontWeight: '600' },
  stat: { flexGrow: 1, flexBasis: 150, minWidth: 150, flexShrink: 1, padding: 12, borderRadius: radius.lg, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, ...shadow.soft },
  statIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  note: { padding: 12, borderRadius: radius.md, backgroundColor: colors.tint, alignItems: 'flex-start' },
  err: { padding: 10, borderRadius: radius.md, backgroundColor: colors.warning + '14', alignItems: 'center' },
  head: { paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: colors.border },
  th: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
  right: { textAlign: 'right' },
  td: { fontSize: 13, color: colors.text, textAlign: 'right', fontWeight: '600' },
  row: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  detail: { gap: 4, padding: 10, borderRadius: radius.md, backgroundColor: colors.bgSoft, marginTop: 4 },
});
