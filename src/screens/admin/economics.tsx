// Admin · Aturan Bisnis (Skema Bisnis v2, migrasi 0098/0099).
// Satu sumber kebenaran aturan uang per layanan: `service_economics` — dibaca lewat
// rpc('admin_service_economics'), diubah per layanan lewat rpc('admin_set_service_economics')
// (PIN panel + log aktivitas economics.updated). Panel simulasi memanggil rpc('ledger_simulate')
// sehingga rincian alokasi yang tampil = rumus yang sama dengan buku besar order sungguhan.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AdminPage, Panel, DataTable, AdminSelect, Pill, StatCard, adminFont as font, adminTone, adminSpace, adminRadius, adminIcon, TONE } from '@/components/admin';
import { LineItem, FootNote } from '@/components/reports';
import { Row, Input, Button, toast } from '@/components/ui';
import { rpc, supabase } from '@/lib/supabase';
import { rupiah, serviceLabel } from '@/lib/format';
import { handleAdminError, useAdminSecurity } from '@/store/adminSecurity';
import { channelLabel } from '@/store/payprefs';
import type { LedgerSimulation, PgFeePolicy, PromoFunder, ServiceEconomics, ServiceType } from '@/lib/types';
import { ErrorNote, LabelPill, SERVICE_KEYS, entryLabel, fmtDate, labelTags, parseNum, partyLabel, FUNDER_LABEL, WideTableHint } from './_shared';

type NumKey = 'driver_commission_pct' | 'merchant_fee_pct' | 'customer_platform_fee' | 'service_fee_pct' | 'service_fee_min' | 'service_fee_driver_share_pct';
type Draft = Record<NumKey, string> & { pg_fee_policy: PgFeePolicy; promo_default_funded_by: PromoFunder; notes: string };

const NUM_FIELDS: { key: NumKey; label: string; kind: 'pct' | 'rp'; width: number }[] = [
  { key: 'driver_commission_pct', label: 'Komisi driver %', kind: 'pct', width: 92 },
  { key: 'merchant_fee_pct', label: 'Fee merchant %', kind: 'pct', width: 92 },
  { key: 'customer_platform_fee', label: 'Biaya platform (Rp)', kind: 'rp', width: 104 },
  { key: 'service_fee_pct', label: 'Jasa belanja %', kind: 'pct', width: 88 },
  { key: 'service_fee_min', label: 'Jasa min (Rp)', kind: 'rp', width: 96 },
  { key: 'service_fee_driver_share_pct', label: 'Porsi driver jasa %', kind: 'pct', width: 96 },
];
const PG_POLICY = [{ value: 'platform', label: 'Platform' }, { value: 'customer', label: 'Pelanggan' }];
const FUNDERS = [{ value: 'platform', label: 'Platform' }, { value: 'merchant', label: 'Merchant' }, { value: 'sponsor', label: 'Sponsor' }];
const TWO_WHEEL: ServiceType[] = ['ride_motor'];

const toDraft = (r: ServiceEconomics): Draft => ({
  driver_commission_pct: String(r.driver_commission_pct ?? 0), merchant_fee_pct: String(r.merchant_fee_pct ?? 0),
  customer_platform_fee: String(r.customer_platform_fee ?? 0), service_fee_pct: String(r.service_fee_pct ?? 0),
  service_fee_min: String(r.service_fee_min ?? 0), service_fee_driver_share_pct: String(r.service_fee_driver_share_pct ?? 0),
  pg_fee_policy: r.pg_fee_policy, promo_default_funded_by: r.promo_default_funded_by, notes: r.notes ?? '',
});

/** Nilai `app_settings.value` (jsonb) → angka; string "8" dan angka 8 sama-sama diterima. */
const settingNum = (v: unknown): number | null => {
  const n = Number(typeof v === 'string' ? v.replace(/"/g, '') : v);
  return Number.isFinite(n) ? n : null;
};

export default function AdminEconomics() {
  const [rows, setRows] = useState<ServiceEconomics[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [cap, setCap] = useState<number | null>(null);
  const [channels, setChannels] = useState<string[]>([]);
  const [errs, setErrs] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const e: string[] = [];
    try {
      const r = await rpc<ServiceEconomics[]>('admin_service_economics');
      const list = [...(r ?? [])].sort((a, b) => SERVICE_KEYS.indexOf(a.service) - SERVICE_KEYS.indexOf(b.service));
      setRows(list);
      setDrafts(Object.fromEntries(list.map((x) => [x.service, toDraft(x)])));
    } catch (x) { e.push(`Aturan bisnis: ${(x as Error).message}`); }
    const { data: capRow, error: capErr } = await supabase.from('app_settings').select('value').eq('key', 'commission_cap_two_wheel').maybeSingle();
    if (capErr) e.push(`Batas komisi roda dua: ${capErr.message}`);
    setCap(capRow ? settingNum((capRow as { value: unknown }).value) : null);
    try { setChannels((await rpc<string[]>('payment_channel_keys')) ?? []); } catch (x) { e.push(`Daftar saluran pembayaran: ${(x as Error).message}`); }
    setErrs(e); setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const setField = (svc: string, k: keyof Draft, v: string) => setDrafts((d) => ({ ...d, [svc]: { ...d[svc], [k]: v } as Draft }));

  /** Kolom yang berubah terhadap nilai tersimpan → patch jsonb. */
  const buildPatch = (row: ServiceEconomics, d: Draft): { patch: Record<string, unknown>; error?: string } => {
    const patch: Record<string, unknown> = {};
    for (const f of NUM_FIELDS) {
      const n = parseNum(d[f.key]);
      if (!Number.isFinite(n)) return { patch, error: `${f.label} harus berupa angka` };
      if (n < 0) return { patch, error: `${f.label} tidak boleh negatif` };
      if (f.kind === 'pct' && n > 100) return { patch, error: `${f.label} harus 0–100` };
      if (f.kind === 'rp' && !Number.isInteger(n)) return { patch, error: `${f.label} harus bilangan bulat rupiah` };
      if (n !== Number(row[f.key])) patch[f.key] = n;
    }
    if (TWO_WHEEL.includes(row.service) && cap != null && parseNum(d.driver_commission_pct) > cap) {
      return { patch, error: `Komisi ${serviceLabel[row.service]} maksimal ${cap}% (commission_cap_two_wheel). Server akan menolak nilai di atasnya.` };
    }
    if (d.pg_fee_policy !== row.pg_fee_policy) patch.pg_fee_policy = d.pg_fee_policy;
    if (d.promo_default_funded_by !== row.promo_default_funded_by) patch.promo_default_funded_by = d.promo_default_funded_by;
    if ((d.notes ?? '') !== (row.notes ?? '')) patch.notes = d.notes;
    return { patch };
  };

  const save = async (row: ServiceEconomics) => {
    const d = drafts[row.service];
    if (!d) return;
    const { patch, error } = buildPatch(row, d);
    if (error) return toast.error(error);
    if (Object.keys(patch).length === 0) return toast.show('Tidak ada perubahan untuk disimpan');
    if (!(await useAdminSecurity.getState().ensureUnlocked())) return;
    setSaving(row.service);
    try {
      const a = await rpc<ServiceEconomics>('admin_set_service_economics', { p_service: row.service, p_patch: patch });
      setRows((rs) => rs.map((x) => (x.service === a.service ? a : x)));
      setDrafts((ds) => ({ ...ds, [a.service]: toDraft(a) }));
      toast.success(`Aturan ${serviceLabel[a.service] ?? a.service} disimpan (${Object.keys(patch).length} kolom)`);
    } catch (e) { handleAdminError(e); }
    finally { setSaving(null); }
  };

  const motor = rows.find((r) => r.service === 'ride_motor');
  const motorDraftPct = parseNum(drafts.ride_motor?.driver_commission_pct);
  const motorOver = cap != null && ((motor && Number(motor.driver_commission_pct) > cap) || (Number.isFinite(motorDraftPct) && motorDraftPct > cap));

  return (
    <AdminPage title="Aturan Bisnis" subtitle="Aturan uang per layanan (service_economics) — sumber tunggal create_order & buku besar. Menyimpan butuh PIN panel dan tercatat di log aktivitas." onRefresh={load}
      right={<Button size="sm" variant="outline" title="Segarkan" icon="refresh-outline" onPress={load} />}>
      {errs.map((t) => <ErrorNote key={t} text={t} onRetry={load} />)}

      <View style={[st.note, motorOver ? { backgroundColor: TONE.bad.bg, borderColor: TONE.bad.border } : { backgroundColor: TONE.info.bg, borderColor: TONE.info.border }]}>
        <Row gap={8} style={{ alignItems: 'flex-start' }}>
          <Ionicons name={motorOver ? 'warning-outline' : 'shield-checkmark-outline'} size={adminIcon.md} color={motorOver ? TONE.bad.fg : TONE.info.fg} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[font.bodyStrong, { color: motorOver ? TONE.bad.fg : TONE.info.fg }]}>
              Pagar komisi roda dua: maksimal {cap == null ? '—' : `${cap}%`} (app_settings.commission_cap_two_wheel) — porsi driver ≥ {cap == null ? '—' : `${100 - cap}%`}
            </Text>
            <Text style={font.small}>
              {motorOver
                ? `Komisi ${serviceLabel.ride_motor} saat ini/draf melebihi batas (${motor?.driver_commission_pct ?? '—'}% tersimpan, ${Number.isFinite(motorDraftPct) ? motorDraftPct : '—'}% di isian). Server menolak nilai di atas batas.`
                : `Berlaku untuk ${serviceLabel.ride_motor} [FAKTA SUMBER, acuan regulasi Sep 2026]. Trigger server t_guard_commission_cap menolak nilai di atas batas.`}
              {' '}Prinsip: ongkir adalah hak driver — komisi AntarFood/Send/Shop/Market = 0; pendapatan platform dari fee merchant + biaya platform pelanggan + iklan.
            </Text>
          </View>
        </Row>
      </View>

      <Panel title="Aturan per layanan" subtitle="Ubah angka lalu tekan Simpan pada barisnya. Hanya kolom yang berubah yang dikirim." icon="options-outline" padded={false}>
        <ScrollView horizontal showsHorizontalScrollIndicator>
          <View style={{ minWidth: 1320 }}>
            <Row gap={8} style={st.th}>
              <Text style={[font.label, { width: 150 }]}>Layanan</Text>
              {NUM_FIELDS.map((f) => <Text key={f.key} style={[font.label, { width: f.width, textAlign: 'right' }]} numberOfLines={2}>{f.label}</Text>)}
              <Text style={[font.label, { width: 124 }]}>Biaya PG ditanggung</Text>
              <Text style={[font.label, { width: 124 }]}>Promo default</Text>
              <Text style={[font.label, { width: 260 }]}>Catatan (label FAKTA/ASUMSI)</Text>
              <Text style={[font.label, { width: 84 }]} />
            </Row>
            {loading && rows.length === 0 ? <Text style={[font.small, { padding: adminSpace.lg }]}>Memuat aturan…</Text> : null}
            {!loading && rows.length === 0 && errs.length === 0 ? <Text style={[font.small, { padding: adminSpace.lg }]}>Tabel service_economics kosong — migrasi 0098 belum diterapkan?</Text> : null}
            {rows.map((row, i) => {
              const d = drafts[row.service];
              if (!d) return null;
              const tags = labelTags(d.notes);
              const dirty = Object.keys(buildPatch(row, d).patch).length > 0;
              return (
                <Row key={row.service} gap={8} style={[st.tr, i % 2 ? st.trAlt : null]}>
                  <View style={{ width: 150, gap: 4 }}>
                    <Text style={font.bodyStrong} numberOfLines={1}>{serviceLabel[row.service] ?? row.service}</Text>
                    <Text style={font.tiny} numberOfLines={1}>{row.service}{TWO_WHEEL.includes(row.service) && cap != null ? ` · maks ${cap}%` : ''}</Text>
                    <Row gap={4} style={{ flexWrap: 'wrap' }}>{tags.length ? tags.map((t) => <LabelPill key={t} text={t} />) : <Pill text="tanpa label" tone="off" />}</Row>
                  </View>
                  {NUM_FIELDS.map((f) => {
                    const over = f.key === 'driver_commission_pct' && TWO_WHEEL.includes(row.service) && cap != null && parseNum(d[f.key]) > cap;
                    return (
                      <Input key={f.key} value={d[f.key]} keyboardType="decimal-pad" error={over ? ' ' : undefined}
                        onChangeText={(t) => setField(row.service, f.key, t)} containerStyle={{ width: f.width }}
                        style={{ textAlign: 'right', paddingVertical: 6, color: over ? adminTone.red : undefined }} />
                    );
                  })}
                  <AdminSelect size="sm" width={124} value={d.pg_fee_policy} options={PG_POLICY} onChange={(v) => setField(row.service, 'pg_fee_policy', v)} />
                  <AdminSelect size="sm" width={124} value={d.promo_default_funded_by} options={FUNDERS} onChange={(v) => setField(row.service, 'promo_default_funded_by', v)} />
                  <Input value={d.notes} multiline onChangeText={(t) => setField(row.service, 'notes', t)} containerStyle={{ width: 260 }} style={{ paddingVertical: 6, fontSize: 12, minHeight: 56 }} />
                  <View style={{ width: 84, gap: 4 }}>
                    <Button title="Simpan" size="sm" variant={dirty ? 'primary' : 'outline'} loading={saving === row.service} onPress={() => save(row)} />
                    <Text style={font.tiny} numberOfLines={2}>{row.updated_at ? fmtDate(row.updated_at) : '—'}</Text>
                  </View>
                </Row>
              );
            })}
          </View>
        </ScrollView>
      </Panel>
      <WideTableHint what="kolom Catatan & Simpan" />

      <Simulator rules={rows} channels={channels} />

      <FootNote lines={[
        'Label angka di kolom Catatan: [FAKTA SUMBER] = dari dokumen keputusan/PKS/regulasi; [FAKTA kode] = nilai lama di kode; [ASUMSI] = usulan yang wajib bisa diubah dari panel; [HASIL PILOT] = belum ada data.',
        'Biaya PG ditanggung "Pelanggan": biaya gateway ditambahkan ke total sebagai baris "Biaya pembayaran" dan tidak mengurangi pendapatan platform.',
        'Promo default: pemilik biaya promo bila kode promo tidak menyebut funded_by. Promo bukan pendapatan.',
        'Perubahan berlaku untuk pesanan BARU; pesanan lama memakai snapshot persentase saat dibuat (orders.driver_commission_pct_snap / merchant_fee_pct_snap).',
      ]} />
    </AdminPage>
  );
}

/* ───────────────────────── Simulasi 1 order ───────────────────────── */

function Simulator({ rules, channels }: { rules: ServiceEconomics[]; channels: string[] }) {
  const [f, setF] = useState({ service: 'food' as ServiceType, fare: '15000', subtotal: '50000', promo: '0', funded: '', channel: 'cash', helpers: '0' });
  const [res, setRes] = useState<LedgerSimulation | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const rule = rules.find((r) => r.service === f.service);
  const usesSubtotal = ['food', 'shop', 'market'].includes(f.service);

  const run = async () => {
    const nums = { fare: parseNum(f.fare), subtotal: parseNum(f.subtotal || '0'), promo: parseNum(f.promo || '0'), helpers: parseNum(f.helpers || '0') };
    const bad = Object.entries(nums).find(([, v]) => !Number.isFinite(v) || v < 0);
    if (bad) return setErr(`Isian ${bad[0]} harus angka ≥ 0`);
    setBusy(true); setErr(null);
    try {
      const r = await rpc<LedgerSimulation>('ledger_simulate', {
        p_service: f.service, p_fare: Math.round(nums.fare), p_subtotal: Math.round(nums.subtotal), p_promo: Math.round(nums.promo),
        p_promo_funded_by: f.funded || null, p_channel: f.channel, p_helpers: Math.round(nums.helpers),
      });
      setRes(r);
    } catch (e) { setErr((e as Error).message); setRes(null); }
    finally { setBusy(false); }
  };

  const channelOpts = useMemo(() => (channels.length ? channels : ['cash']).map((k) => ({ value: k, label: channelLabel(k), sublabel: k })), [channels]);
  const pg = res ? res.pg_fee + res.pg_fee_ppn : 0;

  return (
    <Panel title="Simulasi 1 order" subtitle="rpc ledger_simulate — rumus yang sama dengan buku besar order, memakai aturan TERSIMPAN (bukan draf yang belum disimpan)" icon="calculator-outline">
      <Row gap={10} style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <AdminSelect label="Layanan" width={170} value={f.service} options={SERVICE_KEYS.map((k) => ({ value: k, label: serviceLabel[k] ?? k, sublabel: k }))} onChange={(v) => setF({ ...f, service: v as ServiceType })} />
        <Input label="Ongkir / tarif jasa (Rp)" value={f.fare} keyboardType="number-pad" onChangeText={(v) => setF({ ...f, fare: v })} containerStyle={{ width: 150 }} />
        <Input label="Subtotal barang (Rp)" value={f.subtotal} keyboardType="number-pad" onChangeText={(v) => setF({ ...f, subtotal: v })} containerStyle={{ width: 150, opacity: usesSubtotal ? 1 : 0.5 }} />
        <Input label="Promo nominal (Rp)" value={f.promo} keyboardType="number-pad" onChangeText={(v) => setF({ ...f, promo: v })} containerStyle={{ width: 140 }} />
        <AdminSelect label="Promo ditanggung" width={170} value={f.funded} clearable clearLabel={`Default layanan (${FUNDER_LABEL[rule?.promo_default_funded_by ?? 'platform']})`} options={FUNDERS} onChange={(v) => setF({ ...f, funded: v })} />
        <AdminSelect label="Saluran bayar" width={180} value={f.channel} options={channelOpts} onChange={(v) => setF({ ...f, channel: v })} />
        <Input label="Helper (AntarBox)" value={f.helpers} keyboardType="number-pad" onChangeText={(v) => setF({ ...f, helpers: v })} containerStyle={{ width: 120, opacity: f.service === 'box' ? 1 : 0.5 }} />
        <Button title="Hitung" icon="play-outline" loading={busy} onPress={run} />
      </Row>
      <Text style={[font.tiny, { marginTop: 6 }]}>
        Subtotal hanya dipakai AntarFood/Shop/Market; helper hanya AntarBox. Promo dibatasi server ≤ ongkir (+ subtotal untuk AntarFood).
        {rule ? ` Aturan tersimpan ${serviceLabel[rule.service]}: komisi ${rule.driver_commission_pct}% · fee merchant ${rule.merchant_fee_pct}% · biaya platform ${rupiah(rule.customer_platform_fee)} · PG ditanggung ${FUNDER_LABEL[rule.pg_fee_policy]}.` : ''}
      </Text>
      <View style={{ marginTop: adminSpace.md }}><ErrorNote text={err} /></View>

      {res ? (
        <View style={{ gap: adminSpace.md, marginTop: adminSpace.sm }}>
          <Row gap={8} style={{ flexWrap: 'wrap' }}>
            <Pill text={res.balanced ? 'Seimbang' : `Tidak seimbang · selisih ${rupiah(res.diff)} / komponen ${rupiah(res.diff_components)}`} tone={res.balanced ? 'ok' : 'bad'} icon={res.balanced ? 'checkmark-circle' : 'alert-circle'} />
            <Pill text={`Saluran ${channelLabel(res.channel)}`} tone="neutral" />
            <Pill text={`Promo ditanggung ${FUNDER_LABEL[res.promo_funded_by] ?? res.promo_funded_by}`} tone="neutral" />
            <Pill text={`PG ditanggung ${FUNDER_LABEL[res.pg_fee_borne_by] ?? res.pg_fee_borne_by}`} tone="neutral" />
          </Row>
          <Row gap={adminSpace.md} style={{ flexWrap: 'wrap' }}>
            <StatCard index={0} icon="person-outline" label="Dibayar pelanggan" value={rupiah(res.gross_customer)} hint={`total ${rupiah(res.total)}${res.discount ? ` · diskon ${rupiah(res.discount)}` : ''}`} color={adminTone.slate} />
            <StatCard index={1} icon="bicycle-outline" label="Hak driver" value={rupiah(res.driver_payable)} hint={`komisi ${res.driver_commission_pct}% = ${rupiah(res.driver_commission)}`} color={adminTone.blue} />
            <StatCard index={2} icon="restaurant-outline" label="Hak merchant" value={rupiah(res.merchant_payable)} hint={`fee ${res.merchant_fee_pct}% = ${rupiah(res.merchant_fee)}${res.vendor_payable ? ` · vendor ${rupiah(res.vendor_payable)}` : ''}${res.partner_payable ? ` · mitra ${rupiah(res.partner_payable)}` : ''}`} color={adminTone.orange} />
            <StatCard index={3} icon="business-outline" label="Pendapatan platform" value={rupiah(res.platform_revenue)} hint="biaya platform + komisi + fee − promo platform" color={adminTone.teal} />
            <StatCard index={4} icon="card-outline" label="Biaya PG (+PPN)" value={rupiah(pg)} hint={`fee ${rupiah(res.pg_fee)} · PPN ${rupiah(res.pg_fee_ppn)}`} color={adminTone.violet} />
            <StatCard index={5} icon="stats-chart-outline" label="Contribution" value={rupiah(res.contribution)} hint="pendapatan platform − biaya PG yang ditanggung platform" color={res.contribution >= 0 ? adminTone.green : adminTone.red} />
          </Row>
          {res.payment_method === 'cash' && res.driver_receivable ? (
            <LineItem label="Order tunai: setoran driver ke platform" value={rupiah(res.driver_receivable)} hint="driver memegang uang tunai; bagian platform ditagih lewat saldo driver" />
          ) : null}
          <DataTable keyField="_i" rows={res.entries.map((e, i) => ({ ...e, _i: i })) as unknown as Record<string, unknown>[]} emptyText="Tidak ada baris alokasi"
            columns={[
              { key: 'entry', label: 'Baris buku besar', width: 250, render: (r) => <View><Text style={font.bodyStrong} numberOfLines={1}>{entryLabel(String(r.entry))}</Text><Text style={font.tiny}>{String(r.entry)}</Text></View> },
              { key: 'amount', label: 'Nominal', width: 130, align: 'right', mono: true, render: (r) => <Text style={[font.mono, Number(r.amount) < 0 ? { color: adminTone.red } : null]}>{rupiah(Number(r.amount))}</Text> },
              { key: 'party_role', label: 'Pihak', width: 140, render: (r) => <Text style={font.body}>{partyLabel(r.party_role as string)}</Text> },
              { key: 'funded_by', label: 'Ditanggung', width: 100, render: (r) => <Text style={font.small}>{r.funded_by ? FUNDER_LABEL[String(r.funded_by)] ?? String(r.funded_by) : '—'}</Text> },
              { key: 'note', label: 'Keterangan', flex: 1, width: 320, render: (r) => <Text style={font.small} numberOfLines={2}>{r.note ? String(r.note) : '—'}</Text> },
            ]} />
          <Text style={font.tiny}>Tanda: (+) uang masuk/hak platform, (−) keluar/kewajiban ke mitra. Keseimbangan: dibayar pelanggan + promo sponsor = hak driver + merchant + vendor + mitra + pendapatan platform + biaya PG yang ditanggung pelanggan.</Text>
        </View>
      ) : null}
    </Panel>
  );
}

const st = StyleSheet.create({
  note: { borderWidth: 1, borderRadius: adminRadius.card, padding: adminSpace.md },
  th: { paddingHorizontal: adminSpace.lg, paddingVertical: adminSpace.sm, backgroundColor: adminTone.surfaceAlt },
  tr: { paddingHorizontal: adminSpace.lg, paddingVertical: 8, borderTopWidth: 1, borderTopColor: adminTone.border, alignItems: 'center', minHeight: 72 },
  trAlt: { backgroundColor: adminTone.zebra },
});
