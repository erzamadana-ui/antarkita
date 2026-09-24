// Admin · Buku Besar Order — v3 (finpay-v3, kontrak §6).
//   • Cari: rpc('admin_ledger_lookup', { p_query }) → orders / travel_bookings / travel_requests / merchant_ads (kode atau ID)
//     beserta baris order_ledger per fase + putusan keseimbangan.
//   • Tidak seimbang: rpc('admin_ledger_unbalanced') → order selesai 30 hari terakhir yang tidak seimbang + order v2 tanpa buku besar.
// Ledger v3 append-only: koreksi = baris PEMBALIK (`reversal_of` → id baris yang dibalik) lalu baris baru; `payment_id`
// menghubungkan baris ke pembayaran gateway. Keduanya ditampilkan di tabel.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AdminPage, Panel, DataTable, Pill, StatusPill, adminFont as font, adminTone, adminSpace, adminRadius } from '@/components/admin';
import { LineItem, FootNote } from '@/components/reports';
import { Row, Input, Button } from '@/components/ui';
import { rpc } from '@/lib/supabase';
import { rupiah, serviceLabel, statusLabel, paidViaLabel } from '@/lib/format';
import type { LedgerCheck, LedgerPhase, OrderLedgerRow, OrderStatus, ServiceType } from '@/lib/types';
import { shortId } from '@/lib/admin';
import { ErrorNote, entryLabel, partyLabel, fmtDate, FUNDER_LABEL, WideTableHint } from './_shared';

type LedgerRowV3 = OrderLedgerRow & { payment_id?: string | null; reversal_of?: number | null };
type LookupHit = {
  source: 'orders' | 'travel_bookings' | 'travel_requests' | 'merchant_ads'; source_id: string; order_id: string | null; code: string | null;
  service: ServiceType | null; status: string | null; payment_status?: string | null; payment_method?: string | null; paid_via?: string | null;
  total: number | null; created_at: string | null; completed_at?: string | null; ledger_version?: number | null; merchant_name?: string | null;
  check: LedgerCheck | null; rows: LedgerRowV3[];
};
type Unbalanced = {
  from: string; to: string; checked: number; unbalanced: number; missing_ledger: number; limit: number; truncated: boolean;
  items: { order_id: string; code: string; service: ServiceType; city: string | null; completed_at: string | null; total: number; phase: string | null; verdict: LedgerCheck['verdict']; diff: number | null; diff_components: number | null }[];
  missing: { order_id: string; code: string; service: ServiceType; completed_at: string | null }[];
};

const PHASES: LedgerPhase[] = ['created', 'adjusted', 'completed', 'cancelled', 'refunded', 'settled'];
const PHASE_LABEL: Record<LedgerPhase, string> = {
  created: 'Dibuat (created)', adjusted: 'Disesuaikan (adjusted)', completed: 'Selesai (completed)',
  cancelled: 'Dibatalkan (cancelled)', refunded: 'Direfund (refunded)', settled: 'Settled',
};
const SOURCE_LABEL: Record<string, string> = { orders: 'Pesanan', travel_bookings: 'Travel · kursi', travel_requests: 'Travel · carter', merchant_ads: 'Iklan merchant' };
const VERDICT_LABEL: Record<LedgerCheck['verdict'], string> = {
  balanced: 'Seimbang', unbalanced: 'TIDAK seimbang', refund_ok: 'Refund lengkap', refund_short: 'Refund kurang', no_ledger: 'Belum ada buku besar', not_found: 'Order tidak ditemukan',
};

export default function AdminLedger() {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<LookupHit[]>([]);
  const [searchErr, setSearchErr] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [sel, setSel] = useState<LookupHit | null>(null);

  const lookup = useCallback(async (term: string) => {
    const t = term.trim();
    if (t.length < 3) { setSearchErr('Ketik minimal 3 karakter kode (mis. AA260923…) atau tempel ID'); return; }
    setSearching(true); setSearchErr(null);
    try {
      const r = await rpc<{ results: LookupHit[]; count: number }>('admin_ledger_lookup', { p_query: t });
      const list = r?.results ?? [];
      setHits(list);
      if (list.length === 0) { setSearchErr(`Tidak ada transaksi dengan kode/ID “${t}”`); setSel(null); }
      else setSel(list.find((h) => (h.code ?? '').toUpperCase() === t.toUpperCase() || h.source_id === t) ?? list[0]);
    } catch (e) { setSearchErr((e as Error).message); setHits([]); setSel(null); }
    finally { setSearching(false); }
  }, []);

  const rows = useMemo(() => sel?.rows ?? [], [sel]);
  /** id baris → id baris pembaliknya (v3 append-only). */
  const reversedBy = useMemo(() => {
    const m = new Map<number, number>();
    rows.forEach((r) => { if (r.reversal_of != null) m.set(Number(r.reversal_of), r.id); });
    return m;
  }, [rows]);
  const byPhase = useMemo(() => {
    const m = new Map<string, LedgerRowV3[]>();
    rows.forEach((r) => { m.set(r.phase, [...(m.get(r.phase) ?? []), r]); });
    return [...m.entries()].sort((a, b) => PHASES.indexOf(a[0] as LedgerPhase) - PHASES.indexOf(b[0] as LedgerPhase));
  }, [rows]);
  const nReversal = rows.filter((r) => r.reversal_of != null).length;

  return (
    <AdminPage title="Buku Besar Order" subtitle="Baris alokasi uang (order_ledger) per fase, cek keseimbangan, dan daftar transaksi tidak seimbang. Buku besar append-only: koreksi = baris pembalik.">
      <Panel title="Cari transaksi" subtitle="admin_ledger_lookup — kode pesanan/travel (awalan ≥ 5 karakter) atau ID (UUID) termasuk iklan merchant" icon="search-outline">
        <Row gap={10} style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Input label="Kode atau ID" placeholder="mis. AA26092300012 / 3f2a…" value={q} autoCapitalize="characters" onChangeText={setQ} onSubmitEditing={() => lookup(q)} containerStyle={{ minWidth: 260, flex: 1, maxWidth: 460 }} icon="receipt-outline" />
          <Button title="Cari" icon="search" loading={searching} onPress={() => lookup(q)} />
        </Row>
        <View style={{ marginTop: adminSpace.sm }}><ErrorNote text={searchErr} /></View>
        {hits.length > 1 ? (
          <View style={{ gap: 4, marginTop: adminSpace.sm }}>
            <Text style={font.tiny}>{hits.length} transaksi cocok — pilih salah satu:</Text>
            <Row gap={6} style={{ flexWrap: 'wrap' }}>
              {hits.map((h) => (
                <Pressable key={`${h.source}:${h.source_id}`} onPress={() => setSel(h)} style={[st.hit, sel?.source_id === h.source_id && st.hitOn]}>
                  <Text style={font.bodyStrong}>{h.code ?? shortId(h.source_id)}</Text>
                  <Text style={font.tiny}>{SOURCE_LABEL[h.source] ?? h.source} · {h.service ? serviceLabel[h.service] ?? h.service : h.merchant_name ?? '—'} · {rupiah(Number(h.total ?? 0))}</Text>
                </Pressable>
              ))}
            </Row>
          </View>
        ) : null}
      </Panel>

      {sel ? (
        <Panel title={`${SOURCE_LABEL[sel.source] ?? sel.source} ${sel.code ?? shortId(sel.source_id)}`}
          subtitle={`${sel.service ? serviceLabel[sel.service] ?? sel.service : sel.merchant_name ?? '—'} · dibuat ${fmtDate(sel.created_at)}${sel.completed_at ? ` · selesai ${fmtDate(sel.completed_at)}` : ''}`}
          icon="receipt-outline" right={<Button size="sm" variant="outline" title="Muat ulang" icon="refresh-outline" loading={searching} onPress={() => lookup(sel.source_id)} />}>
          <Row gap={8} style={{ flexWrap: 'wrap' }}>
            {sel.status ? <StatusPill status={sel.status} label={sel.source === 'orders' && sel.service ? statusLabel(sel.status as OrderStatus, sel.service) || sel.status : sel.status} /> : null}
            <Pill text={`Total ${rupiah(Number(sel.total ?? 0))}`} tone="neutral" />
            {sel.paid_via || sel.payment_method ? <Pill text={paidViaLabel(String(sel.paid_via ?? sel.payment_method))} tone="neutral" /> : null}
            {sel.payment_status ? <Pill text={`Bayar: ${sel.payment_status}`} tone="neutral" /> : null}
            {sel.source === 'orders' ? <Pill text={`Ledger v${sel.ledger_version ?? 1}`} tone={(sel.ledger_version ?? 1) >= 2 ? 'brand' : 'off'} /> : null}
            <Pill text={`${rows.length} baris`} tone="info" />
            {nReversal ? <Pill text={`${nReversal} baris pembalik`} tone="wait" icon="swap-horizontal" /> : null}
          </Row>
          <View style={{ marginTop: adminSpace.md, gap: adminSpace.sm }}>
            {sel.check ? <CheckResult c={sel.check} /> : null}
            {rows.length === 0 ? <Text style={font.small}>Transaksi ini belum punya baris buku besar{sel.source === 'orders' && (sel.ledger_version ?? 1) < 2 ? ' (order lama sebelum migrasi 0099 — ledger v1)' : ''}.</Text> : null}
          </View>
        </Panel>
      ) : null}

      {byPhase.map(([phase, list]) => (
        <Panel key={phase} title={PHASE_LABEL[phase as LedgerPhase] ?? phase} subtitle={`${list.length} baris · ditulis ${fmtDate(list[0]?.created_at)}`} icon="layers-outline" padded={false}>
          <DataTable rows={list as unknown as Record<string, unknown>[]} emptyText="Tidak ada baris" columns={[
            { key: 'id', label: '#', width: 70, mono: true, render: (r) => <Text style={[font.mono, reversedBy.has(Number(r.id)) ? { textDecorationLine: 'line-through', color: adminTone.faint } : null]}>{String(r.id)}</Text> },
            { key: 'entry', label: 'Baris', width: 240, render: (r) => <View><Text style={font.bodyStrong} numberOfLines={1}>{entryLabel(String(r.entry))}</Text><Text style={font.tiny}>{String(r.entry)}</Text></View> },
            { key: 'amount', label: 'Nominal', width: 124, align: 'right', mono: true, render: (r) => <Text style={[font.mono, Number(r.amount) < 0 ? { color: adminTone.red } : null]}>{rupiah(Number(r.amount))}</Text> },
            { key: 'party_role', label: 'Pihak', width: 130, render: (r) => <Text style={font.body}>{partyLabel(r.party_role as string)}</Text> },
            { key: 'funded_by', label: 'Ditanggung', width: 96, render: (r) => <Text style={font.small}>{r.funded_by ? FUNDER_LABEL[String(r.funded_by)] ?? String(r.funded_by) : '—'}</Text> },
            {
              key: 'reversal_of', label: 'Pembalikan', width: 150, render: (r) => {
                const rev = r.reversal_of != null ? Number(r.reversal_of) : null;
                const by = reversedBy.get(Number(r.id));
                if (rev != null) return <Pill text={`membalik #${rev}`} tone="wait" icon="arrow-undo" />;
                if (by != null) return <Pill text={`dibalik oleh #${by}`} tone="off" />;
                return <Text style={font.tiny}>—</Text>;
              },
            },
            { key: 'payment_id', label: 'Pembayaran', width: 110, render: (r) => <Text style={font.tiny} selectable>{r.payment_id ? shortId(String(r.payment_id)) : '—'}</Text> },
            { key: 'pg_channel', label: 'Saluran', width: 90, render: (r) => <Text style={font.small}>{r.pg_channel ? String(r.pg_channel) : '—'}</Text> },
            { key: 'note', label: 'Keterangan', width: 300, flex: 1, render: (r) => <Text style={font.small} numberOfLines={2}>{r.note ? String(r.note) : '—'} · {fmtDate(String(r.created_at))}</Text> },
          ]} />
        </Panel>
      ))}

      <UnbalancedList onOpen={(id) => { setQ(id); lookup(id); }} />
      <WideTableHint />

      <FootNote lines={[
        'Tanda: (+) uang masuk/hak platform, (−) keluar/kewajiban ke mitra (driver, merchant, vendor, mitra travel, gateway).',
        'Rumus v3: dibayar pelanggan + promo sponsor = hak driver + merchant + vendor + mitra + pendapatan platform + biaya PG yang ditanggung pelanggan + pajak keluaran.',
        'Append-only (§6): baris tidak pernah dihapus/diubah. Bila fase ditulis ulang, server menulis baris pembalik (reversal_of = id baris lama, nominal berlawanan) lalu baris baru. Baris yang sudah dibalik dicoret.',
        'Baris “Belum terekonsiliasi (selisih)” ditulis job rekonsiliasi harian; lihat menu Rekonsiliasi untuk detailnya.',
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

/* ───────────────────────── Daftar tidak seimbang (server) ───────────────────────── */

function UnbalancedList({ onOpen }: { onOpen: (id: string) => void }) {
  const [data, setData] = useState<Unbalanced | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await rpc<Unbalanced>('admin_ledger_unbalanced')); setErr(null); }
    catch (e) { setErr((e as Error).message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const items = data?.items ?? [];
  const missing = data?.missing ?? [];
  return (
    <Panel title="Transaksi tidak seimbang" subtitle={`admin_ledger_unbalanced — order selesai ${data ? `${fmtDate(data.from, false)} – ${fmtDate(data.to, false)}` : '30 hari terakhir'}`} icon="alert-circle-outline" iconColor={adminTone.red}
      right={<Button size="sm" variant="outline" title="Periksa ulang" icon="refresh-outline" loading={loading} onPress={load} />}>
      <ErrorNote text={err} onRetry={load} />
      {loading && !data ? <Row gap={8}><ActivityIndicator color={adminTone.teal} /><Text style={font.small}>Memeriksa…</Text></Row> : data ? (
        <View style={{ gap: adminSpace.sm }}>
          <Row gap={8} style={{ flexWrap: 'wrap' }}>
            <Pill text={`${data.checked} diperiksa`} tone="neutral" />
            <Pill text={`${data.unbalanced} tidak seimbang`} tone={data.unbalanced ? 'bad' : 'ok'} />
            <Pill text={`${data.missing_ledger} order v2 tanpa buku besar`} tone={data.missing_ledger ? 'bad' : 'ok'} />
            {data.truncated ? <Pill text={`dipotong ${data.limit} teratas`} tone="wait" /> : null}
          </Row>
          {items.length === 0 && missing.length === 0 ? <Text style={font.small}>Semua order selesai yang punya buku besar seimbang.</Text> : null}
          {items.length > 0 ? (
            <DataTable keyField="order_id" rows={items as unknown as Record<string, unknown>[]} onRowPress={(r) => onOpen(String(r.order_id))}
              columns={[
                { key: 'code', label: 'Kode', width: 160, render: (r) => <View><Text style={font.bodyStrong}>{String(r.code)}</Text><Text style={font.tiny}>{fmtDate(r.completed_at as string)}</Text></View> },
                { key: 'service', label: 'Layanan', width: 110, render: (r) => <Text style={font.body}>{serviceLabel[r.service as ServiceType] ?? String(r.service)}</Text> },
                { key: 'total', label: 'Total', width: 110, align: 'right', mono: true, render: (r) => <Text style={font.mono}>{rupiah(Number(r.total))}</Text> },
                { key: 'verdict', label: 'Putusan', width: 150, render: (r) => <Pill text={VERDICT_LABEL[r.verdict as LedgerCheck['verdict']] ?? String(r.verdict)} tone="bad" /> },
                { key: 'diff', label: 'Selisih', width: 110, align: 'right', mono: true, render: (r) => <Text style={[font.mono, { color: adminTone.red }]}>{r.diff != null ? rupiah(Number(r.diff)) : '—'}</Text> },
                { key: 'diff_components', label: 'Selisih komponen', width: 130, align: 'right', mono: true, render: (r) => <Text style={font.mono}>{r.diff_components != null ? rupiah(Number(r.diff_components)) : '—'}</Text> },
                { key: 'phase', label: 'Keterangan', width: 200, flex: 1, render: (r) => <Text style={font.small}>fase {String(r.phase ?? '—')} · klik untuk membuka</Text> },
              ]} />
          ) : null}
          {missing.length > 0 ? (
            <View style={{ gap: 4 }}>
              <Text style={font.label}>Order v2 tanpa baris buku besar</Text>
              <Row gap={6} style={{ flexWrap: 'wrap' }}>
                {missing.map((m) => (
                  <Pressable key={m.order_id} onPress={() => onOpen(m.order_id)} style={st.hit}>
                    <Text style={font.bodyStrong}>{m.code}</Text>
                    <Text style={font.tiny}>{serviceLabel[m.service] ?? m.service} · {fmtDate(m.completed_at, false)}</Text>
                  </Pressable>
                ))}
              </Row>
            </View>
          ) : null}
        </View>
      ) : null}
    </Panel>
  );
}

const st = StyleSheet.create({
  hit: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: adminRadius.md, borderWidth: 1, borderColor: adminTone.border, backgroundColor: adminTone.surface },
  hitOn: { borderColor: adminTone.teal, backgroundColor: adminTone.teal + '10' },
  check: { borderWidth: 1, borderColor: adminTone.border, borderRadius: adminRadius.card, padding: adminSpace.md, backgroundColor: adminTone.surfaceAlt },
});
