// Admin · Buku Besar Order (Skema Bisnis v2, migrasi 0099).
// Cari order dari kodenya (tabel `orders`), tampilkan semua baris `order_ledger` (RLS: admin boleh baca
// semua) per fase, dan periksa keseimbangannya dengan rpc('ledger_check', { p_order }).
// Bagian "Order tidak seimbang" memanggil ledger_check untuk 50 order selesai terakhir.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AdminPage, Panel, DataTable, Pill, StatusPill, adminFont as font, adminTone, adminSpace, adminRadius } from '@/components/admin';
import { LineItem, FootNote } from '@/components/reports';
import { Row, Input, Button } from '@/components/ui';
import { rpc, supabase } from '@/lib/supabase';
import { rupiah, serviceLabel, statusLabel, paidViaLabel } from '@/lib/format';
import type { LedgerCheck, LedgerPhase, OrderLedgerRow, OrderStatus, ServiceType } from '@/lib/types';
import { ErrorNote, entryLabel, partyLabel, fmtDate, FUNDER_LABEL, WideTableHint } from './_shared';

type OrderHit = {
  id: string; code: string; service: ServiceType; status: OrderStatus; total: number; payment_method: string; paid_via: string | null;
  pg_channel: string | null; created_at: string; completed_at: string | null; ledger_version: number | null; city: string | null;
};
const ORDER_COLS = 'id,code,service,status,total,payment_method,paid_via,pg_channel,created_at,completed_at,ledger_version,city';
const PHASES: LedgerPhase[] = ['created', 'adjusted', 'completed', 'cancelled', 'refunded', 'settled'];
const PHASE_LABEL: Record<LedgerPhase, string> = {
  created: 'Dibuat (created)', adjusted: 'Disesuaikan (adjusted)', completed: 'Selesai (completed)',
  cancelled: 'Dibatalkan (cancelled)', refunded: 'Direfund (refunded)', settled: 'Settled',
};
const VERDICT_LABEL: Record<LedgerCheck['verdict'], string> = {
  balanced: 'Seimbang', unbalanced: 'TIDAK seimbang', refund_ok: 'Refund lengkap', refund_short: 'Refund kurang', no_ledger: 'Belum ada buku besar', not_found: 'Order tidak ditemukan',
};
const SCAN_SIZE = 50;

export default function AdminLedger() {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<OrderHit[]>([]);
  const [searchErr, setSearchErr] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [order, setOrder] = useState<OrderHit | null>(null);
  const [rows, setRows] = useState<OrderLedgerRow[]>([]);
  const [rowsErr, setRowsErr] = useState<string | null>(null);
  const [check, setCheck] = useState<LedgerCheck | null>(null);
  const [checkErr, setCheckErr] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const search = async () => {
    const term = q.trim().toUpperCase().replace(/[%,()*\\]/g, '');
    if (term.length < 3) { setSearchErr('Ketik minimal 3 karakter kode order (mis. AA260923…)'); return; }
    setSearching(true); setSearchErr(null);
    const { data, error } = await supabase.from('orders').select(ORDER_COLS).ilike('code', `%${term}%`).order('created_at', { ascending: false }).limit(20);
    setSearching(false);
    if (error) { setSearchErr(error.message); setHits([]); return; }
    const list = (data as OrderHit[]) ?? [];
    setHits(list);
    if (list.length === 0) setSearchErr(`Tidak ada order dengan kode mengandung “${term}”`);
    const exact = list.find((o) => o.code.toUpperCase() === term);
    if (exact || list.length === 1) openOrder(exact ?? list[0]);
  };

  const openOrder = useCallback(async (o: OrderHit) => {
    setOrder(o); setCheck(null); setCheckErr(null); setRows([]); setRowsErr(null);
    const { data, error } = await supabase.from('order_ledger').select('*').eq('order_id', o.id).order('id');
    if (error) { setRowsErr(error.message); return; }
    setRows((data as OrderLedgerRow[]) ?? []);
  }, []);

  /** Buka order dari id (dipakai daftar "tidak seimbang"). */
  const openById = useCallback(async (id: string) => {
    const { data, error } = await supabase.from('orders').select(ORDER_COLS).eq('id', id).maybeSingle();
    if (error) { setSearchErr(error.message); return; }
    if (!data) { setSearchErr('Order tidak ditemukan'); return; }
    await openOrder(data as OrderHit);
  }, [openOrder]);

  const runCheck = async () => {
    if (!order) return;
    setChecking(true); setCheckErr(null);
    try { setCheck(await rpc<LedgerCheck>('ledger_check', { p_order: order.id })); }
    catch (e) { setCheckErr((e as Error).message); setCheck(null); }
    finally { setChecking(false); }
  };

  const byPhase = useMemo(() => {
    const m = new Map<string, OrderLedgerRow[]>();
    rows.forEach((r) => { const k = r.phase; m.set(k, [...(m.get(k) ?? []), r]); });
    return [...m.entries()].sort((a, b) => PHASES.indexOf(a[0] as LedgerPhase) - PHASES.indexOf(b[0] as LedgerPhase));
  }, [rows]);

  return (
    <AdminPage title="Buku Besar Order" subtitle="Semua baris alokasi uang (order_ledger) satu order per fase, cek keseimbangan, dan daftar order selesai yang tidak seimbang.">
      <Panel title="Cari order" icon="search-outline">
        <Row gap={10} style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Input label="Kode order" placeholder="mis. AA26092300012" value={q} autoCapitalize="characters" onChangeText={setQ} onSubmitEditing={search} containerStyle={{ minWidth: 260, flex: 1, maxWidth: 420 }} icon="receipt-outline" />
          <Button title="Cari" icon="search" loading={searching} onPress={search} />
        </Row>
        <View style={{ marginTop: adminSpace.sm }}><ErrorNote text={searchErr} /></View>
        {hits.length > 1 ? (
          <View style={{ gap: 4, marginTop: adminSpace.sm }}>
            <Text style={font.tiny}>{hits.length} order cocok — pilih salah satu:</Text>
            <Row gap={6} style={{ flexWrap: 'wrap' }}>
              {hits.map((h) => (
                <Pressable key={h.id} onPress={() => openOrder(h)} style={[st.hit, order?.id === h.id && st.hitOn]}>
                  <Text style={font.bodyStrong}>{h.code}</Text>
                  <Text style={font.tiny}>{serviceLabel[h.service] ?? h.service} · {rupiah(h.total)}</Text>
                </Pressable>
              ))}
            </Row>
          </View>
        ) : null}
      </Panel>

      {order ? (
        <Panel title={`Order ${order.code}`} subtitle={`${serviceLabel[order.service] ?? order.service} · ${order.city ?? 'tanpa kota'} · dibuat ${fmtDate(order.created_at)}${order.completed_at ? ` · selesai ${fmtDate(order.completed_at)}` : ''}`}
          icon="receipt-outline" right={<Button size="sm" title="Cek keseimbangan" icon="scale-outline" loading={checking} onPress={runCheck} />}>
          <Row gap={8} style={{ flexWrap: 'wrap' }}>
            <StatusPill status={order.status} label={statusLabel(order.status, order.service) || order.status} />
            <Pill text={`Total ${rupiah(order.total)}`} tone="neutral" />
            <Pill text={paidViaLabel(order.paid_via ?? order.payment_method)} tone="neutral" />
            {order.pg_channel ? <Pill text={`Saluran ${order.pg_channel}`} tone="neutral" /> : null}
            <Pill text={`Ledger v${order.ledger_version ?? 1}`} tone={(order.ledger_version ?? 1) >= 2 ? 'brand' : 'off'} />
            <Pill text={`${rows.length} baris`} tone="info" />
          </Row>
          <View style={{ marginTop: adminSpace.md, gap: adminSpace.sm }}>
            <ErrorNote text={rowsErr} onRetry={() => openOrder(order)} />
            <ErrorNote text={checkErr} onRetry={runCheck} />
            {check ? <CheckResult c={check} /> : null}
            {!rowsErr && rows.length === 0 ? <Text style={font.small}>Order ini belum punya baris buku besar{(order.ledger_version ?? 1) < 2 ? ' (order lama sebelum migrasi 0099 — ledger v1)' : ''}.</Text> : null}
          </View>
        </Panel>
      ) : null}

      {byPhase.map(([phase, list]) => (
        <Panel key={phase} title={PHASE_LABEL[phase as LedgerPhase] ?? phase} subtitle={`${list.length} baris · ditulis ${fmtDate(list[0]?.created_at)}`} icon="layers-outline" padded={false}>
          <DataTable rows={list as unknown as Record<string, unknown>[]} emptyText="Tidak ada baris" columns={[
            { key: 'entry', label: 'Baris', width: 250, render: (r) => <View><Text style={font.bodyStrong} numberOfLines={1}>{entryLabel(String(r.entry))}</Text><Text style={font.tiny}>{String(r.entry)}</Text></View> },
            { key: 'amount', label: 'Nominal', width: 130, align: 'right', mono: true, render: (r) => <Text style={[font.mono, Number(r.amount) < 0 ? { color: adminTone.red } : null]}>{rupiah(Number(r.amount))}</Text> },
            { key: 'party_role', label: 'Pihak', width: 140, render: (r) => <Text style={font.body}>{partyLabel(r.party_role as string)}</Text> },
            { key: 'funded_by', label: 'Ditanggung', width: 100, render: (r) => <Text style={font.small}>{r.funded_by ? FUNDER_LABEL[String(r.funded_by)] ?? String(r.funded_by) : '—'}</Text> },
            { key: 'pg_channel', label: 'Saluran', width: 100, render: (r) => <Text style={font.small}>{r.pg_channel ? String(r.pg_channel) : '—'}</Text> },
            { key: 'note', label: 'Keterangan', width: 340, flex: 1, render: (r) => <Text style={font.small} numberOfLines={2}>{r.note ? String(r.note) : '—'}</Text> },
          ]} />
        </Panel>
      ))}

      <UnbalancedScan onOpen={openById} />
      <WideTableHint />

      <FootNote lines={[
        'Tanda: (+) uang masuk/hak platform, (−) keluar/kewajiban ke mitra (driver, merchant, vendor, mitra travel, gateway).',
        'Rumus fase created/adjusted/completed: dibayar pelanggan + promo sponsor = hak driver + merchant + vendor + mitra + pendapatan platform + biaya PG yang ditanggung pelanggan; dan dibayar pelanggan = jumlah komponen (barang + ongkir + biaya platform + jasa + antar kota + tip + extras − promo + PG pelanggan).',
        'Fase cancelled/refunded: refund + penggantian belanja + denda harus ≥ yang pernah dibayar bila order berstatus refunded.',
        'ledger_check menilai fase terakhir yang berlaku (urutan: completed → refunded → cancelled → adjusted → created). Buku besar travel (kursi/carter) dan iklan tidak memakai order_id sehingga tidak muncul di pencarian ini.',
      ]} />
    </AdminPage>
  );
}

function CheckResult({ c }: { c: LedgerCheck }) {
  const ok = c.balanced === true;
  const bad = c.balanced === false;
  const tone = ok ? 'ok' : bad ? 'bad' : 'off';
  const n = (v?: number) => rupiah(Number(v ?? 0));
  const isRefund = c.verdict === 'refund_ok' || c.verdict === 'refund_short';
  return (
    <View style={[st.check, ok ? { borderColor: adminTone.green + '55' } : bad ? { borderColor: adminTone.red + '66' } : null]}>
      <Row gap={8} style={{ flexWrap: 'wrap', alignItems: 'center' }}>
        <Ionicons name={ok ? 'checkmark-circle' : bad ? 'alert-circle' : 'help-circle'} size={20} color={ok ? adminTone.green : bad ? adminTone.red : adminTone.muted} />
        <Text style={font.h3}>{VERDICT_LABEL[c.verdict] ?? c.verdict}</Text>
        {c.phase ? <Pill text={`fase ${c.phase}`} tone="neutral" /> : null}
        {c.diff != null ? <Pill text={`selisih ${n(c.diff)}`} tone={tone} /> : null}
        {c.diff_components != null ? <Pill text={`selisih komponen ${n(c.diff_components)}`} tone={c.diff_components === 0 ? 'ok' : 'bad'} /> : null}
        {c.rows != null ? <Pill text={`${c.rows} baris`} tone="neutral" /> : null}
      </Row>
      {c.formula ? <Text style={[font.tiny, { marginTop: 6 }]}>Rumus: {c.formula}</Text> : null}
      {c.verdict === 'no_ledger' ? <Text style={[font.small, { marginTop: 6 }]}>Order ini belum pernah diposting ke buku besar (ledger v{c.ledger_version ?? 1}).</Text> : null}
      {isRefund ? (
        <View style={{ marginTop: 6 }}>
          <LineItem label="Pernah dibayar (bila direfund)" value={n(c.paid)} />
          <LineItem label="Refund" value={n(c.refund)} />
          <LineItem label="Penggantian belanja ke driver" value={n(c.reimburse)} />
          <LineItem label="Denda batal (pendapatan)" value={n(c.penalty)} />
        </View>
      ) : c.gross_customer != null ? (
        <Row gap={24} style={{ flexWrap: 'wrap', marginTop: 6 }}>
          <View style={{ flex: 1, minWidth: 260 }}>
            <LineItem strong label="Dibayar pelanggan" value={n(c.gross_customer)} />
            <LineItem label="Jumlah komponen" value={n(c.components_total)} />
            <LineItem label="Teralokasi" value={n(c.allocated)} />
            <LineItem label="Promo platform / merchant / sponsor" value={`${n(c.promo_platform)} / ${n(c.promo_merchant)} / ${n(c.promo_sponsor)}`} />
          </View>
          <View style={{ flex: 1, minWidth: 260 }}>
            <LineItem label="Hak driver" value={n(c.driver_payable)} color={adminTone.blue} />
            <LineItem label="Hak merchant" value={n(c.merchant_payable)} color={adminTone.orange} />
            {c.vendor_payable ? <LineItem label="Penggantian vendor" value={n(c.vendor_payable)} /> : null}
            {c.partner_payable ? <LineItem label="Hak mitra travel" value={n(c.partner_payable)} /> : null}
            <LineItem label="Pendapatan platform" value={n(c.platform_revenue)} color={adminTone.teal} hint={`komisi ${n(c.driver_commission)} · fee merchant ${n(c.merchant_fee)}${c.bonus ? ` · bonus sesi ${n(c.bonus)}` : ''}`} />
            <LineItem label="Biaya PG (platform / pelanggan)" value={`${n(c.pg_fee_platform)} / ${n(c.pg_fee_customer)}`} />
            <LineItem strong label="Contribution" value={n(c.contribution)} color={(c.contribution ?? 0) >= 0 ? adminTone.green : adminTone.red} />
            {c.driver_receivable ? <LineItem label="Setoran tunai driver ke platform" value={n(c.driver_receivable)} /> : null}
          </View>
        </Row>
      ) : null}
    </View>
  );
}

/* ───────────────────────── Pemindaian order tidak seimbang ───────────────────────── */

type ScanItem = { order: { id: string; code: string; service: ServiceType; total: number; completed_at: string | null }; check?: LedgerCheck; error?: string };

function UnbalancedScan({ onOpen }: { onOpen: (id: string) => void }) {
  const [items, setItems] = useState<ScanItem[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [scannedAt, setScannedAt] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const scan = useCallback(async () => {
    setRunning(true); setErr(null); setDone(0); setItems([]);
    const { data, error } = await supabase.from('orders').select('id,code,service,total,completed_at')
      .eq('status', 'completed').order('completed_at', { ascending: false, nullsFirst: false }).limit(SCAN_SIZE);
    if (error) { setErr(error.message); setRunning(false); return; }
    const orders = (data as ScanItem['order'][]) ?? [];
    const out: ScanItem[] = orders.map((o) => ({ order: o }));
    // 5 permintaan sekaligus supaya tidak membanjiri server
    let next = 0;
    const worker = async () => {
      while (next < out.length && alive.current) {
        const i = next++;
        try { out[i].check = await rpc<LedgerCheck>('ledger_check', { p_order: out[i].order.id }); }
        catch (e) { out[i].error = (e as Error).message; }
        if (alive.current) setDone((d) => d + 1);
      }
    };
    await Promise.all(Array.from({ length: 5 }, worker));
    if (!alive.current) return;
    setItems(out); setRunning(false); setScannedAt(new Date().toISOString());
  }, []);
  useEffect(() => { scan(); }, [scan]);

  const unbalanced = items.filter((x) => x.check?.balanced === false);
  const failed = items.filter((x) => x.error);
  const noLedger = items.filter((x) => x.check && x.check.balanced == null);
  const balanced = items.filter((x) => x.check?.balanced === true);
  const shown = [...unbalanced, ...failed];

  return (
    <Panel title="Order tidak seimbang" subtitle={`ledger_check untuk ${SCAN_SIZE} order selesai terakhir${scannedAt ? ` · diperiksa ${fmtDate(scannedAt)}` : ''}`} icon="alert-circle-outline" iconColor={adminTone.red}
      right={<Button size="sm" variant="outline" title={running ? `Memeriksa ${done}/${items.length || SCAN_SIZE}` : 'Periksa ulang'} icon="refresh-outline" disabled={running} onPress={scan} />}>
      <ErrorNote text={err} onRetry={scan} />
      {running ? <Row gap={8}><ActivityIndicator color={adminTone.teal} /><Text style={font.small}>Memeriksa {done} order…</Text></Row> : (
        <View style={{ gap: adminSpace.sm }}>
          <Row gap={8} style={{ flexWrap: 'wrap' }}>
            <Pill text={`${balanced.length} seimbang`} tone="ok" />
            <Pill text={`${unbalanced.length} tidak seimbang`} tone={unbalanced.length ? 'bad' : 'ok'} />
            <Pill text={`${noLedger.length} tanpa buku besar (ledger v1)`} tone="off" />
            {failed.length ? <Pill text={`${failed.length} gagal diperiksa`} tone="bad" /> : null}
          </Row>
          {shown.length === 0 && items.length > 0 ? <Text style={font.small}>Semua order selesai yang punya buku besar seimbang.</Text> : null}
          {items.length === 0 && !err ? <Text style={font.small}>Belum ada order selesai.</Text> : null}
          {shown.length > 0 ? (
            <DataTable rows={shown.map((x) => ({ ...x.order, verdict: x.check?.verdict, phase: x.check?.phase, diff: x.check?.diff, diff_components: x.check?.diff_components, error: x.error })) as unknown as Record<string, unknown>[]}
              onRowPress={(r) => onOpen(String(r.id))}
              columns={[
                { key: 'code', label: 'Kode', width: 160, render: (r) => <View><Text style={font.bodyStrong}>{String(r.code)}</Text><Text style={font.tiny}>{fmtDate(r.completed_at as string)}</Text></View> },
                { key: 'service', label: 'Layanan', width: 110, render: (r) => <Text style={font.body}>{serviceLabel[r.service as ServiceType] ?? String(r.service)}</Text> },
                { key: 'total', label: 'Total', width: 110, align: 'right', mono: true, render: (r) => <Text style={font.mono}>{rupiah(Number(r.total))}</Text> },
                { key: 'verdict', label: 'Putusan', width: 160, render: (r) => r.error ? <Pill text="gagal diperiksa" tone="bad" /> : <Pill text={VERDICT_LABEL[r.verdict as LedgerCheck['verdict']] ?? String(r.verdict)} tone="bad" /> },
                { key: 'diff', label: 'Selisih', width: 110, align: 'right', mono: true, render: (r) => <Text style={[font.mono, { color: adminTone.red }]}>{r.diff != null ? rupiah(Number(r.diff)) : '—'}</Text> },
                { key: 'diff_components', label: 'Selisih komponen', width: 130, align: 'right', mono: true, render: (r) => <Text style={font.mono}>{r.diff_components != null ? rupiah(Number(r.diff_components)) : '—'}</Text> },
                { key: 'error', label: 'Keterangan', width: 260, flex: 1, render: (r) => <Text style={font.small} numberOfLines={2}>{r.error ? String(r.error) : `fase ${String(r.phase ?? '—')} · klik untuk membuka`}</Text> },
              ]} />
          ) : null}
        </View>
      )}
    </Panel>
  );
}

const st = StyleSheet.create({
  hit: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: adminRadius.md, borderWidth: 1, borderColor: adminTone.border, backgroundColor: adminTone.surface },
  hitOn: { borderColor: adminTone.teal, backgroundColor: adminTone.teal + '10' },
  check: { borderWidth: 1, borderColor: adminTone.border, borderRadius: adminRadius.card, padding: adminSpace.md, backgroundColor: adminTone.surfaceAlt },
});
