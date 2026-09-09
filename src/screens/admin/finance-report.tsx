// Admin · Laporan Keuangan — laporan bertingkat (cascade): ringkasan per layanan/kota →
// dimensi lawan + daftar order → bagi hasil satu order. Sumber data: rpc('admin_finance_cascade')
// dan rpc('admin_order_split') (migrasi 0026, view `order_economics`).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import {
  AdminPage, Panel, DataTable, Toolbar, FilterBar, StatCard, Pill, AdminDialog, adminFont as font, adminTone, adminSpace, adminIcon,
} from '@/components/admin';
import {
  Breadcrumb, DateField, FootNote, LineItem, SplitBar, RANGE_PRESETS, presetRange, rangeError, rangeLabel, pctId, share,
  type DateRange, type RangePreset,
} from '@/components/reports';
import { Row, Button } from '@/components/ui';
import { rpc } from '@/lib/supabase';
import { adminExportCsv } from '@/lib/csv';
import { handleAdminError } from '@/store/adminSecurity';
import { rupiah, serviceLabel, statusLabel, statusColor, paidViaLabel } from '@/lib/format';
import type { OrderStatus, ServiceType } from '@/lib/types';
import { fmtDate, fmtAgo, Trunc, WideTableHint } from './_shared';

/* ───────────────────────── Bentuk data dari server ───────────────────────── */

type GroupKind = 'service' | 'city';
type CascadeRow = {
  key: string | null; label: string | null; orders: number; completed: number; gmv: number;
  revenue: number; revenue_billed: number; driver_payout: number; merchant_payout: number;
  promo: number; tip: number; refund: number; gateway_fee: number; cogs: number; net_margin: number; margin_pct: number;
};
type CascadeTotals = Omit<CascadeRow, 'key' | 'label'>;
type CascadeOrder = {
  id: string; code: string; created_at: string; service: string; city: string | null; status: string;
  total: number; platform_fee: number; service_fee: number; driver_earning: number; merchant_earning: number;
  discount: number; tip: number; payment_method: string; revenue: number; gateway_fee: number;
};
type Cascade = {
  from: string; to: string; group: GroupKind; key: string | null; level: 1 | 2; sub_group: GroupKind;
  rows: CascadeRow[]; totals: CascadeTotals; orders: CascadeOrder[];
};
type OrderSplit = {
  id: string; code: string; service: string; city: string | null; status: string; created_at: string;
  completed_at: string | null; payment_method: string; gross: number; revenue_billed: number;
  driver: { base: number; service_share: number; tip: number; extras: number; total: number };
  merchant: { earning: number; margin: number };
  platform: { platform_fee: number; commission: number; service_company: number; intercity_margin: number; revenue: number };
  items_subtotal: number; promo: number; gateway_fee: number; refund: number;
  cogs: number; net_margin: number; driver_payout: number; merchant_payout: number;
  pct: { driver: number; merchant: number; platform: number; promo: number; gateway: number; net_margin: number };
  margin_pct: number;
};

const GROUPS: { key: GroupKind; label: string }[] = [{ key: 'service', label: 'Per layanan' }, { key: 'city', label: 'Per kota' }];
const groupWord = (g: GroupKind) => (g === 'service' ? 'layanan' : 'kota');
const labelOf = (g: GroupKind, k: string | null | undefined) =>
  g === 'service' ? serviceLabel[k as ServiceType] ?? k ?? '—' : k || 'Tanpa kota';

const C = { gmv: adminTone.slate, revenue: adminTone.teal, driver: adminTone.blue, merchant: adminTone.orange, promo: adminTone.red, gateway: adminTone.violet, margin: adminTone.green };

/* ───────────────────────── Halaman ───────────────────────── */

export default function AdminFinanceReport() {
  const [preset, setPreset] = useState<RangePreset>('month');
  const [range, setRange] = useState<DateRange>(() => presetRange('month'));
  const [group, setGroup] = useState<GroupKind>('service');
  const [key, setKey] = useState<string | null>(null);
  const [data, setData] = useState<Cascade | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [split, setSplit] = useState<OrderSplit | null>(null);
  const [splitBusy, setSplitBusy] = useState(false);

  const invalid = rangeError(range);

  const load = useCallback(async () => {
    if (rangeError(range)) { setLoading(false); return; }
    setLoading(true);
    try {
      const r = await rpc<Cascade>('admin_finance_cascade', { p_from: range.from, p_to: range.to, p_group: group, p_key: key });
      setData(r); setErr(null);
    } catch (e) {
      setErr((e as Error).message || 'Gagal memuat laporan'); setData(null); handleAdminError(e);
    } finally { setLoading(false); }
  }, [range, group, key]);

  // Dijeda sesaat supaya mengetik tanggal kustom tidak memicu banyak permintaan.
  useEffect(() => { const t = setTimeout(load, 350); return () => clearTimeout(t); }, [load]);

  const pickPreset = (p: RangePreset) => { setPreset(p); if (p !== 'custom') setRange(presetRange(p)); };
  const pickGroup = (g: GroupKind) => { setGroup(g); setKey(null); };

  const rows = data?.rows ?? [];
  const totals = data?.totals;
  const orders = data?.orders ?? [];
  const level2 = !!key && data?.level === 2;
  const subGroup: GroupKind = data?.sub_group ?? (group === 'service' ? 'city' : 'service');

  const exportCsv = () => {
    const stamp = `${range.from}_${range.to}`;
    if (level2) {
      return adminExportCsv('finance-report', `laporan-keuangan-order-${labelOf(group, key)}-${stamp}.csv`,
        ['Kode', 'Tanggal', 'Layanan', 'Kota', 'Status', 'Total', 'Biaya platform', 'Jasa', 'Payout driver', 'Payout merchant', 'Diskon', 'Tip', 'Biaya gateway', 'Pendapatan platform', 'Metode bayar'],
        orders.map((o) => [o.code, o.created_at, serviceLabel[o.service as ServiceType] ?? o.service, o.city ?? '', o.status, o.total, o.platform_fee, o.service_fee, o.driver_earning, o.merchant_earning, o.discount, o.tip, o.gateway_fee, o.revenue, o.payment_method]));
    }
    return adminExportCsv('finance-report', `laporan-keuangan-${group}-${stamp}.csv`,
      [group === 'service' ? 'Layanan' : 'Kota', 'Order', 'Selesai', 'GMV', 'Pendapatan', 'Payout driver', 'Payout merchant', 'Promo', 'Biaya gateway', 'COGS', 'Marjin bersih', '% marjin'],
      rows.map((r) => [labelOf(group, r.key), r.orders, r.completed, r.gmv, r.revenue, r.driver_payout, r.merchant_payout, r.promo, r.gateway_fee, r.cogs, r.net_margin, r.margin_pct]));
  };

  const openSplit = async (id: string) => {
    setSplitBusy(true);
    try { setSplit(await rpc<OrderSplit>('admin_order_split', { p_order: id })); }
    catch (e) { handleAdminError(e); }
    finally { setSplitBusy(false); }
  };

  const groupColumns = useMemo(() => moneyColumns(level2 ? subGroup : group), [level2, subGroup, group]);

  return (
    <AdminPage
      title="Laporan Keuangan"
      subtitle="Rincian pendapatan, bagi hasil mitra, dan marjin per layanan/kota — klik baris untuk menelusuri sampai satu pesanan"
      onRefresh={load}
      right={<Row gap={8}>
        <Button size="sm" variant="outline" title="Segarkan" icon="refresh-outline" onPress={load} />
        <Button size="sm" variant="secondary" title="Ekspor CSV" icon="download-outline" onPress={exportCsv} />
      </Row>}
    >
      <Toolbar right={<FilterBar options={GROUPS as unknown as { key: string; label: string }[]} value={group} onChange={(v) => pickGroup(v as GroupKind)} />}>
        <FilterBar options={RANGE_PRESETS as unknown as { key: string; label: string }[]} value={preset} onChange={(v) => pickPreset(v as RangePreset)} />
        {preset === 'custom' ? (
          <Row gap={8} style={{ flexWrap: 'wrap' }}>
            <DateField label="Dari" value={range.from} onChange={(v) => setRange((r) => ({ ...r, from: v }))} />
            <DateField label="Sampai" value={range.to} onChange={(v) => setRange((r) => ({ ...r, to: v }))} />
          </Row>
        ) : <Text style={font.small}>{rangeLabel(range)}</Text>}
      </Toolbar>

      {invalid ? <Panel><Row gap={8}><Ionicons name="alert-circle-outline" size={adminIcon.md} color={adminTone.red} /><Text style={[font.small, { color: adminTone.red, flex: 1 }]}>{invalid}</Text></Row></Panel> : null}
      {err && !invalid ? <Panel><Row gap={8}><Ionicons name="close-circle-outline" size={adminIcon.md} color={adminTone.red} /><Text style={[font.small, { color: adminTone.red, flex: 1 }]} selectable>{err}</Text></Row></Panel> : null}

      {level2 ? (
        <Breadcrumb items={[
          { label: `Semua ${groupWord(group)}`, onPress: () => setKey(null) },
          { label: labelOf(group, key) },
        ]} />
      ) : null}

      {/* Baris KPI — selalu untuk cakupan yang sedang dilihat */}
      <Row gap={adminSpace.md} style={{ flexWrap: 'wrap' }}>
        <StatCard index={0} icon="cart-outline" color={C.gmv} label="GMV (pesanan selesai)" value={rupiah(totals?.gmv ?? 0)}
          hint={`${(totals?.completed ?? 0).toLocaleString('id-ID')} selesai dari ${(totals?.orders ?? 0).toLocaleString('id-ID')} pesanan`} />
        <StatCard index={1} icon="trending-up-outline" color={C.revenue} label="Pendapatan platform" value={rupiah(totals?.revenue ?? 0)}
          hint={`take rate ${pctId(share(totals?.revenue ?? 0, totals?.gmv ?? 0))} dari GMV`} />
        <StatCard index={2} icon="swap-horizontal-outline" color={C.driver} label="COGS (biaya langsung)" value={rupiah(totals?.cogs ?? 0)}
          hint="payout driver + merchant + promo + gateway" />
        <StatCard index={3} icon="wallet-outline" color={(totals?.net_margin ?? 0) >= 0 ? C.margin : adminTone.red} label="Marjin bersih" value={rupiah(totals?.net_margin ?? 0)}
          hint={`${pctId(totals?.margin_pct ?? 0)} dari GMV · pendapatan − promo − gateway`} />
      </Row>

      {loading && !data ? (
        <Panel><Row gap={10}><ActivityIndicator color={adminTone.teal} /><Text style={font.small}>Menyusun laporan…</Text></Row></Panel>
      ) : (
        <>
          <Panel
            title={level2 ? `Rincian per ${groupWord(subGroup)} — ${labelOf(group, key)}` : `Ringkasan per ${groupWord(group)}`}
            subtitle={`${level2 ? 'Sebaran nilai pada dimensi lawan untuk kelompok yang dipilih' : 'Klik satu baris untuk membuka rincian & daftar pesanannya'} · 11 kolom nilai — geser tabel ke samping untuk melihat COGS & marjin`}
            icon={level2 ? 'git-branch-outline' : 'bar-chart-outline'} padded={false}
          >
            <DataTable keyField="key" rows={rows as unknown as Record<string, unknown>[]} columns={groupColumns}
              emptyText="Belum ada transaksi pada rentang ini" emptyIcon="cash-outline"
              onRowPress={level2 ? undefined : (r) => setKey(String((r as unknown as CascadeRow).key ?? ''))} />
          </Panel>

          {level2 ? (
            <Panel title="Rincian per pesanan" subtitle={`Maksimal 200 pesanan terbaru · ${rangeLabel(range)} · klik baris untuk melihat bagi hasil · geser tabel ke samping untuk kolom lainnya`} icon="receipt-outline" padded={false}>
              <DataTable rows={orders as unknown as Record<string, unknown>[]} onRowPress={(r) => openSplit(String((r as unknown as CascadeOrder).id))}
                emptyText="Tidak ada pesanan pada kelompok ini" emptyIcon="receipt-outline"
                columns={[
                  { key: 'code', label: 'Kode', width: 130, render: (r) => { const o = r as unknown as CascadeOrder; return <View style={{ minWidth: 0, alignSelf: 'stretch' }}><Trunc style={font.bodyStrong} title={o.code}>{o.code}</Trunc><Trunc style={font.tiny}>{fmtDate(o.created_at)}</Trunc></View>; } },
                  { key: 'service', label: 'Layanan', width: 100, render: (r) => <Text style={font.body} numberOfLines={1}>{serviceLabel[(r as unknown as CascadeOrder).service as ServiceType] ?? (r as unknown as CascadeOrder).service}</Text> },
                  { key: 'city', label: 'Kota', width: 96, render: (r) => <Trunc style={font.body} title={(r as unknown as CascadeOrder).city ?? ''}>{(r as unknown as CascadeOrder).city || '—'}</Trunc> },
                  num('total', 'Total', 100, (o: CascadeOrder) => o.total),
                  num('platform_fee', 'Biaya platform', 104, (o: CascadeOrder) => o.platform_fee),
                  num('service_fee', 'Jasa', 92, (o: CascadeOrder) => o.service_fee),
                  num('driver_earning', 'Payout driver', 104, (o: CascadeOrder) => o.driver_earning, C.driver),
                  num('merchant_earning', 'Payout merchant', 110, (o: CascadeOrder) => o.merchant_earning, C.merchant),
                  num('discount', 'Diskon', 92, (o: CascadeOrder) => o.discount, C.promo),
                  num('tip', 'Tip', 80, (o: CascadeOrder) => o.tip),
                  { key: 'payment_method', label: 'Metode bayar', width: 110, render: (r) => <Text style={font.small} numberOfLines={1}>{paidViaLabel((r as unknown as CascadeOrder).payment_method)}</Text> },
                  { key: 'status', label: 'Status', width: 128, render: (r) => { const o = r as unknown as CascadeOrder; return <Pill text={statusLabel(o.status as OrderStatus, o.service as ServiceType) || o.status} color={statusColor(o.status as OrderStatus)} />; } },
                ]} />
            </Panel>
          ) : null}
        </>
      )}

      {!level2 && rows.length > 0 ? (
        <Text style={font.tiny}>Klik salah satu baris {groupWord(group)} untuk menelusuri sebaran {groupWord(group === 'service' ? 'city' : 'service')} dan daftar pesanannya.</Text>
      ) : null}

      <FootNote lines={[
        `Periode ${rangeLabel(range)} (waktu Jakarta). Nilai uang hanya menghitung pesanan berstatus selesai; kolom "Order" menghitung seluruh pesanan pada rentang, termasuk yang batal.`,
        'GMV = total nilai pesanan selesai. Pendapatan platform = biaya platform + komisi + jasa perusahaan + marjin merchant/antar kota.',
        'COGS = payout driver + payout merchant + promo/diskon + biaya gateway. Marjin bersih = pendapatan − promo − biaya gateway.',
        'Biaya gateway bernilai 0 bila pesanan belum melewati transaksi payment gateway (mis. pembayaran tunai atau saldo AntarPay).',
        'Daftar rincian per pesanan dibatasi 200 baris terbaru per kelompok; gunakan Ekspor CSV untuk arsip lengkap tiap kelompok.',
      ]} />

      <SplitDialog split={split} busy={splitBusy} onClose={() => setSplit(null)} />
      {splitBusy && !split ? <Text style={font.tiny}>Memuat bagi hasil pesanan…</Text> : null}
      <WideTableHint />
    </AdminPage>
  );
}

/* ───────────────────────── Kolom tabel ───────────────────────── */

const num = (key: string, label: string, width: number, get: (o: never) => number, color?: string) => ({
  key, label, width, align: 'right' as const, mono: true,
  render: (r: Record<string, unknown>) => <Text style={[font.mono, color ? { color } : null]} numberOfLines={1}>{rupiah(get(r as never))}</Text>,
});

function moneyColumns(g: GroupKind) {
  return [
    {
      key: 'label', label: g === 'service' ? 'Layanan' : 'Kota', width: 146, render: (r: Record<string, unknown>) => {
        const x = r as unknown as CascadeRow;
        return <View style={{ minWidth: 0, alignSelf: 'stretch' }}><Trunc style={font.bodyStrong} title={labelOf(g, x.key)}>{labelOf(g, x.key)}</Trunc><Text style={font.tiny}>{x.completed.toLocaleString('id-ID')} selesai</Text></View>;
      },
    },
    { key: 'orders', label: 'Order', width: 70, align: 'right' as const, mono: true, render: (r: Record<string, unknown>) => <Text style={font.mono}>{(r as unknown as CascadeRow).orders.toLocaleString('id-ID')}</Text> },
    num('gmv', 'GMV', 106, (x: CascadeRow) => x.gmv),
    num('revenue', 'Pendapatan', 106, (x: CascadeRow) => x.revenue, C.revenue),
    num('driver_payout', 'Payout driver', 106, (x: CascadeRow) => x.driver_payout, C.driver),
    num('merchant_payout', 'Payout merchant', 112, (x: CascadeRow) => x.merchant_payout, C.merchant),
    num('promo', 'Promo', 92, (x: CascadeRow) => x.promo, C.promo),
    num('gateway_fee', 'Gateway', 96, (x: CascadeRow) => x.gateway_fee, C.gateway),
    num('cogs', 'COGS', 106, (x: CascadeRow) => x.cogs),
    num('net_margin', 'Marjin bersih', 106, (x: CascadeRow) => x.net_margin, C.margin),
    {
      key: 'margin_pct', label: '% marjin', width: 84, align: 'right' as const, mono: true,
      render: (r: Record<string, unknown>) => { const x = r as unknown as CascadeRow; return <Text style={[font.mono, { color: x.margin_pct >= 0 ? C.margin : adminTone.red }]}>{pctId(x.margin_pct)}</Text>; },
    },
  ];
}

/* ───────────────────────── Dialog bagi hasil order ───────────────────────── */

function SplitDialog({ split, busy, onClose }: { split: OrderSplit | null; busy: boolean; onClose: () => void }) {
  if (!split) return null;
  const s = split;
  const money = (n: number) => rupiah(n);
  const neg = adminTone.red;
  return (
    <AdminDialog visible onClose={onClose} width={640} title={`Bagi hasil order ${s.code}`}
      subtitle={`${serviceLabel[s.service as ServiceType] ?? s.service} · ${s.city || 'tanpa kota'} · ${fmtDate(s.created_at)} · ${paidViaLabel(s.payment_method)}`}>
      {busy ? <ActivityIndicator color={adminTone.teal} /> : null}
      <Row gap={8} style={{ flexWrap: 'wrap' }}>
        <Pill text={statusLabel(s.status as OrderStatus, s.service as ServiceType) || s.status} color={statusColor(s.status as OrderStatus)} />
        <Pill text={`Marjin ${pctId(s.margin_pct)}`} tone={s.net_margin >= 0 ? 'ok' : 'bad'} />
        {s.refund > 0 ? <Pill text={`Refund ${rupiah(s.refund)}`} tone="bad" /> : null}
      </Row>

      <SplitBar format={money} segments={[
        { label: 'Driver', value: s.driver_payout, color: C.driver },
        { label: 'Merchant', value: s.merchant_payout, color: C.merchant },
        { label: 'Platform', value: s.platform.revenue, color: C.revenue },
      ]} />

      <View style={{ marginTop: 2 }}>
        <LineItem strong label="Pendapatan kotor (nilai order)" value={money(s.gross)} hint="yang dibayar pelanggan sebelum bagi hasil" />
        <LineItem label="Ditagih ke pelanggan (jasa + barang)" value={money(s.revenue_billed)} hint={s.items_subtotal > 0 ? `termasuk barang ${money(s.items_subtotal)}` : undefined} />

        <LineItem top dot={C.driver} strong label="Bagian driver" value={money(s.driver_payout)} hint={`${pctId(s.pct.driver)} dari nilai order`} color={C.driver} />
        <LineItem indent label="Tarif dasar driver" value={money(s.driver.base)} />
        <LineItem indent label="Porsi jasa untuk driver" value={money(s.driver.service_share)} />
        {s.driver.extras ? <LineItem indent label="Biaya tambahan (parkir/tol/tunggu)" value={money(s.driver.extras)} /> : null}
        {s.driver.tip ? <LineItem indent label="Tip pelanggan" value={money(s.driver.tip)} /> : null}

        <LineItem top dot={C.merchant} strong label="Bagian merchant" value={money(s.merchant_payout)} hint={`${pctId(s.pct.merchant)} dari nilai order`} color={C.merchant} />
        {s.merchant.margin ? <LineItem indent label="Marjin merchant untuk perusahaan" value={money(s.merchant.margin)} /> : null}

        <LineItem top dot={C.revenue} strong label="Biaya platform (pendapatan perusahaan)" value={money(s.platform.revenue)} hint={`${pctId(s.pct.platform)} dari nilai order`} color={C.revenue} />
        <LineItem indent label="Biaya platform" value={money(s.platform.platform_fee)} />
        <LineItem indent label="Komisi mitra" value={money(s.platform.commission)} />
        {s.platform.service_company ? <LineItem indent label="Jasa untuk perusahaan" value={money(s.platform.service_company)} /> : null}
        {s.platform.intercity_margin ? <LineItem indent label="Marjin antar kota" value={money(s.platform.intercity_margin)} /> : null}

        <LineItem top dot={C.promo} label="Promo / diskon" value={`− ${money(s.promo)}`} color={s.promo ? neg : undefined} hint={`${pctId(s.pct.promo)} dari nilai order`} />
        <LineItem dot={C.gateway} label="Biaya gateway" value={`− ${money(s.gateway_fee)}`} color={s.gateway_fee ? neg : undefined} hint={s.gateway_fee ? `${pctId(s.pct.gateway)} dari nilai order` : 'nol bila tanpa transaksi gateway (tunai / saldo)'} />
        <LineItem label="COGS (biaya langsung)" value={money(s.cogs)} hint="driver + merchant + promo + gateway" />
        <LineItem top strong label="Marjin bersih perusahaan" value={money(s.net_margin)} color={s.net_margin >= 0 ? C.margin : neg} hint={`${pctId(s.pct.net_margin)} dari nilai order`} />
      </View>

      <Row gap={8} style={{ justifyContent: 'flex-end' }}>
        <Button size="sm" variant="ghost" title="Tutup" onPress={onClose} />
      </Row>
    </AdminDialog>
  );
}
