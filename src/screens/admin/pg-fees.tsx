// Admin · Biaya Payment Gateway — v3 (finpay-v3, kontrak §1): tarif per PROVIDER (midtrans/finpay) dan per
// tanggal berlaku (`effective_from`), dengan riwayat versi.
//   • Baca: rpc('admin_payment_channel_fees', { p_provider })
//   • Ubah / buat versi: rpc('admin_set_payment_channel_fee', { p_provider, p_channel, p_effective_from, p_patch }) (PIN + log)
// Server memilih versi dengan `effective_from <= tanggal transaksi` terbaru (pg_fee_calc). Mengubah versi lama tidak
// mengubah transaksi yang sudah tercatat di buku besar.
// Biaya PG hanya dibebankan ke pelanggan bila `pass_to_customer` DAN `pass_to_customer_legal_ok` (§0.5).
// QRIS: `pass_to_customer` dikunci false (larangan surcharge Bank Indonesia).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Switch, Platform } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { AdminPage, Panel, Pill, FilterBar, AdminSelect, AdminDialog, SourcePill, RequirePerm, adminFont as font, adminTone, adminSpace, adminRadius, adminIcon, TONE } from '@/components/admin';
import { DateField, FootNote } from '@/components/reports';
import { Row, Input, Button, toast } from '@/components/ui';
import { rpc } from '@/lib/supabase';
import { colors } from '@/lib/theme';
import { rupiah, serviceLabel } from '@/lib/format';
import { handleAdminError, useAdminSecurity } from '@/store/adminSecurity';
import type { ServiceEconomics } from '@/lib/types';
import {
  PROVIDERS, SOURCE_LABELS, QRIS_LOCK_NOTE, isQris, todayWib, asList, useAdminCan,
  type ChannelFeeV3, type PaymentProvider,
} from '@/lib/admin';
import { ErrorNote, SERVICE_KEYS, fmtDate, parseNum, WideTableHint, FUNDER_LABEL } from './_shared';

type NumKey = 'fee_pct' | 'fee_fixed' | 'fee_pct_under_100k' | 'ppn_pct' | 'hold_days' | 'min_auto_disburse';
type Draft = Record<NumKey, string> & { ppn_included: boolean; active: boolean; pass_to_customer: boolean; pass_to_customer_legal_ok: boolean; source_label: string; note: string };
const NUM_FIELDS: { key: NumKey; label: string; width: number; min: number; max: number; int: boolean; unit: string; optional?: boolean }[] = [
  { key: 'fee_pct', label: 'Fee %', width: 72, min: 0, max: 20, int: false, unit: '%' },
  { key: 'fee_fixed', label: 'Fee tetap (Rp)', width: 92, min: 0, max: 100000, int: true, unit: 'Rp' },
  { key: 'fee_pct_under_100k', label: 'Fee % ≤ Rp100rb', width: 84, min: 0, max: 20, int: false, unit: '%', optional: true },
  { key: 'ppn_pct', label: 'PPN %', width: 64, min: 0, max: 20, int: false, unit: '%' },
  { key: 'hold_days', label: 'Hold H+n', width: 64, min: 0, max: 30, int: true, unit: 'hari' },
  { key: 'min_auto_disburse', label: 'Min. cair (Rp)', width: 96, min: 0, max: Number.MAX_SAFE_INTEGER, int: true, unit: 'Rp' },
];
const SOURCE_OPTS = SOURCE_LABELS.map((l) => ({ value: l, label: l }));
const keyOf = (r: { channel: string; effective_from: string }) => `${r.channel}|${r.effective_from}`;
const numStr = (v: number | null | undefined) => (v == null ? '' : String(v));

const toDraft = (r: ChannelFeeV3): Draft => ({
  fee_pct: numStr(r.fee_pct ?? 0), fee_fixed: numStr(r.fee_fixed ?? 0), fee_pct_under_100k: numStr(r.fee_pct_under_100k),
  ppn_pct: numStr(r.ppn_pct ?? 11), hold_days: numStr(r.hold_days ?? 0), min_auto_disburse: numStr(r.min_auto_disburse ?? 0),
  ppn_included: !!r.ppn_included, active: !!r.active,
  pass_to_customer: isQris(r.channel) ? false : !!r.pass_to_customer, pass_to_customer_legal_ok: !!r.pass_to_customer_legal_ok,
  source_label: r.source_label ?? '', note: r.note ?? r.notes ?? '',
});

/** Sama dengan pg_fee_calc di server (termasuk tarif khusus ≤ Rp100.000 bila diisi). */
const calcFee = (amount: number, d: Draft) => {
  if (!d.active || !(amount > 0)) return { fee: 0, ppn: 0 };
  const under = parseNum(d.fee_pct_under_100k);
  const pct = Number.isFinite(under) && amount <= 100000 ? under : parseNum(d.fee_pct) || 0;
  const fee = Math.round((amount * pct) / 100) + (parseNum(d.fee_fixed) || 0);
  return { fee, ppn: d.ppn_included ? 0 : Math.round((fee * (parseNum(d.ppn_pct) || 0)) / 100) };
};

/** Validasi draf → patch (semua kolom bila `full`, selain itu hanya yang berubah). */
function buildPatch(row: ChannelFeeV3 | null, d: Draft, full = false): { patch: Record<string, unknown>; error?: string } {
  const patch: Record<string, unknown> = {};
  for (const f of NUM_FIELDS) {
    const raw = d[f.key].trim();
    if (f.optional && raw === '') {
      if (full || (row && row[f.key] != null)) patch[f.key] = null;
      continue;
    }
    const n = parseNum(raw);
    if (!Number.isFinite(n)) return { patch, error: `${f.label} harus berupa angka` };
    if (n < f.min || n > f.max) return { patch, error: f.max === Number.MAX_SAFE_INTEGER ? `${f.label} harus ≥ 0` : `${f.label} harus ${f.min}–${f.max.toLocaleString('id-ID')} ${f.unit}` };
    if (f.int && !Number.isInteger(n)) return { patch, error: `${f.label} harus bilangan bulat` };
    if (full || !row || n !== Number(row[f.key] ?? NaN)) patch[f.key] = n;
  }
  const bools = ['ppn_included', 'active', 'pass_to_customer', 'pass_to_customer_legal_ok'] as const;
  for (const k of bools) if (full || !row || d[k] !== !!row[k]) patch[k] = d[k];
  if (row && isQris(row.channel)) patch.pass_to_customer = false;
  if (full || !row || (d.source_label || null) !== (row.source_label ?? null)) patch.source_label = d.source_label || null;
  if (full || !row || (d.note ?? '') !== (row.note ?? row.notes ?? '')) patch.note = d.note;
  // tidak ada perubahan nyata pada QRIS yang memang false
  if (row && isQris(row.channel) && !full && !row.pass_to_customer) delete patch.pass_to_customer;
  return { patch };
}

/** Tooltip web untuk kontrol yang dikunci. */
function Tip({ title, children }: { title: string; children: React.ReactNode }) {
  if (Platform.OS === 'web') return React.createElement('div', { title, style: { display: 'inline-flex' } }, children);
  return <>{children}</>;
}

export default function AdminPgFees() {
  const router = useRouter();
  const can = useAdminCan();
  const [provider, setProvider] = useState<PaymentProvider>('finpay');
  const [rows, setRows] = useState<ChannelFeeV3[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [policies, setPolicies] = useState<ServiceEconomics[]>([]);
  const [errs, setErrs] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [sample, setSample] = useState('100000');
  const [openHist, setOpenHist] = useState<Record<string, boolean>>({});
  const [version, setVersion] = useState<{ channel: string; label: string; base: ChannelFeeV3; date: string; locked: boolean; d: Draft } | null>(null);
  const today = todayWib();

  const load = useCallback(async () => {
    setLoading(true);
    const e: string[] = [];
    try {
      const r = asList<ChannelFeeV3>(await rpc('admin_payment_channel_fees', { p_provider: provider }))
        .filter((x) => !x.provider || x.provider === provider)
        .map((x) => ({ ...x, effective_from: String(x.effective_from ?? '2026-01-01').slice(0, 10) }));
      setRows(r); setDrafts(Object.fromEntries(r.map((x) => [keyOf(x), toDraft(x)])));
    } catch (x) { e.push(`Tarif saluran ${provider}: ${(x as Error).message}`); setRows([]); }
    try { setPolicies((await rpc<ServiceEconomics[]>('admin_service_economics')) ?? []); } catch (x) { e.push(`Kebijakan per layanan: ${(x as Error).message}`); }
    setErrs(e); setLoading(false);
  }, [provider]);
  useEffect(() => { load(); }, [load]);

  /** Kelompokkan per saluran: versi berlaku hari ini, versi terjadwal (masa depan), dan riwayat. */
  const channels = useMemo(() => {
    const m = new Map<string, ChannelFeeV3[]>();
    rows.forEach((r) => m.set(r.channel, [...(m.get(r.channel) ?? []), r]));
    return [...m.entries()].map(([channel, list]) => {
      const sorted = [...list].sort((a, b) => b.effective_from.localeCompare(a.effective_from));
      const current = sorted.find((x) => x.effective_from <= today) ?? sorted[sorted.length - 1];
      const scheduled = sorted.filter((x) => x.effective_from > today).reverse();
      const history = sorted.filter((x) => x !== current && x.effective_from <= today);
      return { channel, current, scheduled, history, count: sorted.length };
    }).sort((a, b) => (a.current.label ?? a.channel).localeCompare(b.current.label ?? b.channel));
  }, [rows, today]);

  const setField = (k: string, f: keyof Draft, v: string | boolean) => setDrafts((d) => ({ ...d, [k]: { ...d[k], [f]: v } as Draft }));

  const send = async (channel: string, effective_from: string, patch: Record<string, unknown>, label: string) => {
    if (!(await useAdminSecurity.getState().ensureUnlocked())) return false;
    setSaving(`${channel}|${effective_from}`);
    try {
      await rpc('admin_set_payment_channel_fee', { p_provider: provider, p_channel: channel, p_effective_from: effective_from, p_patch: patch });
      toast.success(`${label}: tarif berlaku ${fmtDate(`${effective_from}T00:00:00`, false)} disimpan`);
      await load();
      return true;
    } catch (e) { handleAdminError(e); return false; }
    finally { setSaving(null); }
  };

  const saveRow = async (row: ChannelFeeV3) => {
    const d = drafts[keyOf(row)];
    if (!d) return;
    const { patch, error } = buildPatch(row, d);
    if (error) return toast.error(`${row.label ?? row.channel}: ${error}`);
    if (Object.keys(patch).length === 0) return toast.show('Tidak ada perubahan untuk disimpan');
    await send(row.channel, row.effective_from, patch, row.label ?? row.channel);
  };

  const openVersion = (base: ChannelFeeV3, date?: string) => {
    const d = drafts[keyOf(base)] ?? toDraft(base);
    setVersion({ channel: base.channel, label: base.label ?? base.channel, base, date: date ?? (base.effective_from >= today ? base.effective_from : today), locked: !!date, d: { ...d } });
  };
  const submitVersion = async () => {
    if (!version) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(version.date)) return toast.error('Tanggal berlaku tidak valid');
    const exists = rows.find((r) => r.channel === version.channel && r.effective_from === version.date);
    if (exists && !version.locked) return toast.error('Sudah ada versi pada tanggal itu — ubah versi tersebut dari riwayat');
    const { patch, error } = buildPatch(null, version.d, true);
    if (error) return toast.error(error);
    if (isQris(version.channel)) patch.pass_to_customer = false;
    patch.label = version.label;
    if (await send(version.channel, version.date, patch, version.label)) setVersion(null);
  };

  const amount = parseNum(sample);
  const policyRows = [...policies].sort((a, b) => SERVICE_KEYS.indexOf(a.service) - SERVICE_KEYS.indexOf(b.service));
  const canEdit = can('fee');

  return (
    <AdminPage title="Biaya Payment Gateway" subtitle="Tarif per provider & tanggal berlaku — dipakai checkout (biaya metode pembayaran), buku besar (pg_fee), contribution margin, dan rekonsiliasi. Menyimpan butuh PIN panel." onRefresh={load}
      right={<Button size="sm" variant="outline" title="Segarkan" icon="refresh-outline" onPress={load} />}>
      <Row gap={10} style={{ flexWrap: 'wrap', alignItems: 'center' }}>
        <Text style={font.label}>Provider</Text>
        <FilterBar options={PROVIDERS.map((p) => ({ key: p.value, label: p.label }))} value={provider} onChange={(v) => setProvider(v as PaymentProvider)} />
        <Button size="sm" variant="ghost" title="Provider aktif & kredensial" icon="card-outline" onPress={() => router.push('/(admin)/gateway' as never)} />
      </Row>
      {errs.map((t) => <ErrorNote key={t} text={t} onRetry={load} />)}

      <View style={[st.note, { backgroundColor: TONE.info.bg, borderColor: TONE.info.border }]}>
        <Row gap={8} style={{ alignItems: 'flex-start' }}>
          <Ionicons name="document-text-outline" size={adminIcon.md} color={TONE.info.fg} />
          <View style={{ flex: 1, gap: 2 }}>
            {provider === 'finpay' ? (
              <>
                <Text style={[font.bodyStrong, { color: TONE.info.fg }]}>Sumber: finpay.id/biaya-transaksi (diakses 9 Jul 2026) [FAKTA-PUBLIK]</Text>
                <Text style={font.small}>
                  Tarif e-wallet/paylater/retail sebagian masih [ASUMSI] (rentang publik) sampai PKS Finpay ditandatangani — ganti label ke [KONTRAK] setelah ada angka kontrak.
                  PPN atas biaya belum jelas → ppn_included=false [ASUMSI]. QRIS: BI menetapkan MDR 0 % untuk transaksi ≤ Rp100.000 mulai 1 Okt 2026 — dicatat sebagai versi berlaku 2026-10-01 [PERLU-KONFIRMASI-KONTRAK].
                </Text>
              </>
            ) : (
              <>
                <Text style={[font.bodyStrong, { color: TONE.info.fg }]}>Sumber: PKS Midtrans Ver.Aug-26 (Pasal 6, SOP B.6) [KONTRAK]</Text>
                <Text style={font.small}>Tarif per saluran & hold H+n settlement. Transaksi lama Midtrans tetap memakai versi ini; provider untuk transaksi BARU diatur di Payment Gateway.</Text>
              </>
            )}
          </View>
        </Row>
      </View>

      <View style={[st.note, { backgroundColor: TONE.wait.bg, borderColor: TONE.wait.border }]}>
        <Row gap={8} style={{ alignItems: 'flex-start' }}>
          <Ionicons name="scale-outline" size={adminIcon.md} color={TONE.wait.fg} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[font.bodyStrong, { color: TONE.wait.fg }]}>Bawaan: biaya PG ditanggung platform</Text>
            <Text style={font.small}>
              Biaya metode pembayaran hanya ditambahkan ke tagihan pelanggan bila <Text style={{ fontWeight: '700' }}>Bebankan ke pelanggan</Text> DAN <Text style={{ fontWeight: '700' }}>Lolos kajian legal</Text> keduanya menyala.
              Nyalakan “Lolos kajian legal” hanya setelah ada kajian legal & klausul PKS yang mengizinkan. QRIS tidak boleh dibebankan (larangan surcharge BI) — kolomnya dikunci.
            </Text>
          </View>
        </Row>
      </View>

      <Panel title={`Tarif ${PROVIDERS.find((p) => p.value === provider)?.label} — versi yang berlaku hari ini`} subtitle="Ubah lalu Simpan untuk mengoreksi versi ini, atau “Versi baru” untuk tarif yang berlaku mulai tanggal tertentu." icon="card-outline" padded={false}
        right={<Input label="Contoh nominal (Rp)" value={sample} keyboardType="number-pad" onChangeText={setSample} containerStyle={{ width: 150 }} style={{ paddingVertical: 4 }} />}>
        <ScrollView horizontal showsHorizontalScrollIndicator>
          <View style={{ minWidth: 1660 }}>
            <Row gap={8} style={st.th}>
              <Text style={[font.label, { width: 220 }]}>Saluran · sumber</Text>
              {NUM_FIELDS.slice(0, 3).map((f) => <Text key={f.key} style={[font.label, { width: f.width, textAlign: 'right' }]} numberOfLines={2}>{f.label}</Text>)}
              <Text style={[font.label, { width: 70 }]} numberOfLines={2}>PPN termasuk</Text>
              {NUM_FIELDS.slice(3).map((f) => <Text key={f.key} style={[font.label, { width: f.width, textAlign: 'right' }]} numberOfLines={2}>{f.label}</Text>)}
              <Text style={[font.label, { width: 96 }]} numberOfLines={2}>Bebankan ke pelanggan</Text>
              <Text style={[font.label, { width: 84 }]} numberOfLines={2}>Lolos kajian legal</Text>
              <Text style={[font.label, { width: 54 }]}>Aktif</Text>
              <Text style={[font.label, { width: 130, textAlign: 'right' }]} numberOfLines={2}>Biaya contoh (+PPN)</Text>
              <Text style={[font.label, { width: 190 }]}>Label & catatan</Text>
              <Text style={[font.label, { width: 110 }]} />
            </Row>
            {loading && rows.length === 0 ? <Text style={[font.small, { padding: adminSpace.lg }]}>Memuat tarif…</Text> : null}
            {!loading && rows.length === 0 && errs.length === 0 ? <Text style={[font.small, { padding: adminSpace.lg }]}>Belum ada tarif untuk provider ini — migrasi v3 (payment_channel_fees per provider) belum diterapkan?</Text> : null}
            {channels.map(({ channel, current: row, scheduled, history, count }, i) => {
              const k = keyOf(row);
              const d = drafts[k];
              if (!d) return null;
              const pv = calcFee(Number.isFinite(amount) ? amount : 0, d);
              const dirty = Object.keys(buildPatch(row, d).patch).length > 0;
              const qris = isQris(channel);
              const charged = d.pass_to_customer && d.pass_to_customer_legal_ok && !qris;
              const hist = openHist[channel];
              return (
                <View key={channel} style={i % 2 ? st.trAlt : null}>
                  <Row gap={8} style={[st.tr, !d.active && { opacity: 0.6 }]}>
                    <View style={{ width: 220, gap: 3 }}>
                      <Text style={font.bodyStrong} numberOfLines={1}>{row.label ?? channel}</Text>
                      <Text style={font.tiny} numberOfLines={1}>{channel} · berlaku sejak {fmtDate(`${row.effective_from}T00:00:00`, false)}</Text>
                      <Row gap={4} style={{ flexWrap: 'wrap' }}>
                        <SourcePill label={d.source_label || row.source_label} />
                        <Pill text={charged ? 'Dibebankan ke pelanggan' : 'Ditanggung platform'} tone={charged ? 'wait' : 'brand'} />
                        {scheduled.length ? <Pill text={`terjadwal ${scheduled.map((x) => x.effective_from).join(', ')}`} tone="info" icon="calendar" /> : null}
                      </Row>
                    </View>
                    {NUM_FIELDS.slice(0, 3).map((f) => (
                      <Input key={f.key} value={d[f.key]} placeholder={f.optional ? '—' : undefined} keyboardType="decimal-pad" editable={canEdit} onChangeText={(t) => setField(k, f.key, t)} containerStyle={{ width: f.width }} style={{ textAlign: 'right', paddingVertical: 6 }} />
                    ))}
                    <View style={{ width: 70 }}><Switch value={d.ppn_included} disabled={!canEdit} onValueChange={(v) => setField(k, 'ppn_included', v)} trackColor={{ true: colors.success, false: colors.border }} thumbColor="#fff" /></View>
                    {NUM_FIELDS.slice(3).map((f) => (
                      <Input key={f.key} value={d[f.key]} keyboardType="decimal-pad" editable={canEdit} onChangeText={(t) => setField(k, f.key, t)} containerStyle={{ width: f.width }}
                        style={{ textAlign: 'right', paddingVertical: 6, opacity: f.key === 'ppn_pct' && d.ppn_included ? 0.45 : 1 }} />
                    ))}
                    <View style={{ width: 96, gap: 2 }}>
                      {qris ? (
                        <Tip title={QRIS_LOCK_NOTE}>
                          <Row gap={4}><Switch value={false} disabled trackColor={{ true: colors.success, false: colors.border }} thumbColor="#fff" /><Ionicons name="lock-closed" size={adminIcon.sm} color={TONE.bad.fg} /></Row>
                        </Tip>
                      ) : <Switch value={d.pass_to_customer} disabled={!canEdit} onValueChange={(v) => setField(k, 'pass_to_customer', v)} trackColor={{ true: colors.warning, false: colors.border }} thumbColor="#fff" />}
                      {qris ? <Text style={[font.tiny, { color: TONE.bad.fg }]} numberOfLines={2}>dikunci · larangan surcharge BI</Text> : null}
                    </View>
                    <View style={{ width: 84, gap: 2 }}>
                      <Switch value={d.pass_to_customer_legal_ok} disabled={!canEdit || qris} onValueChange={(v) => setField(k, 'pass_to_customer_legal_ok', v)} trackColor={{ true: colors.success, false: colors.border }} thumbColor="#fff" />
                      {d.pass_to_customer && !d.pass_to_customer_legal_ok && !qris ? <Text style={[font.tiny, { color: TONE.wait.fg }]} numberOfLines={2}>menunggu legal</Text> : null}
                    </View>
                    <View style={{ width: 54 }}><Switch value={d.active} disabled={!canEdit} onValueChange={(v) => setField(k, 'active', v)} trackColor={{ true: colors.success, false: colors.border }} thumbColor="#fff" /></View>
                    <View style={{ width: 130, alignItems: 'flex-end' }}>
                      <Text style={font.mono}>{rupiah(pv.fee + pv.ppn)}</Text>
                      <Text style={font.tiny}>fee {rupiah(pv.fee)} · PPN {rupiah(pv.ppn)}</Text>
                    </View>
                    <View style={{ width: 190, gap: 4 }}>
                      <AdminSelect size="sm" width={190} value={d.source_label} placeholder="Label sumber…" options={SOURCE_OPTS} disabled={!canEdit} onChange={(v) => setField(k, 'source_label', v)} />
                      <Input value={d.note} placeholder="Catatan" editable={canEdit} onChangeText={(t) => setField(k, 'note', t)} style={{ paddingVertical: 4, fontSize: 12 }} />
                    </View>
                    <View style={{ width: 110, gap: 4 }}>
                      <RequirePerm perm="fee">
                        <Button title="Simpan" size="sm" variant={dirty ? 'primary' : 'outline'} loading={saving === k} onPress={() => saveRow(row)} />
                        <Button title="Versi baru" size="sm" variant="ghost" icon="add" onPress={() => openVersion(row)} />
                      </RequirePerm>
                      <Button title={`${hist ? 'Tutup' : 'Riwayat'} (${count})`} size="sm" variant="ghost" icon={hist ? 'chevron-up' : 'time-outline'} onPress={() => setOpenHist((o) => ({ ...o, [channel]: !o[channel] }))} />
                    </View>
                  </Row>
                  {hist ? (
                    <View style={st.hist}>
                      <Text style={font.label}>Riwayat versi {row.label ?? channel}</Text>
                      {[...scheduled.map((x) => ({ x, tag: 'terjadwal' as const })), { x: row, tag: 'berlaku' as const }, ...history.map((x) => ({ x, tag: 'lama' as const }))].map(({ x, tag }) => (
                        <Row key={keyOf(x)} gap={10} style={st.histRow}>
                          <Text style={[font.mono, { width: 96 }]}>{x.effective_from}</Text>
                          <Pill text={tag === 'berlaku' ? 'berlaku' : tag === 'terjadwal' ? 'terjadwal' : 'lama'} tone={tag === 'berlaku' ? 'ok' : tag === 'terjadwal' ? 'info' : 'off'} />
                          <Text style={[font.small, { width: 260 }]} numberOfLines={1}>
                            {x.fee_pct}%{x.fee_fixed ? ` + ${rupiah(x.fee_fixed)}` : ''}{x.fee_pct_under_100k != null ? ` · ≤100rb ${x.fee_pct_under_100k}%` : ''}{x.ppn_included ? ' · PPN termasuk' : ` · PPN ${x.ppn_pct}%`}
                          </Text>
                          <Text style={[font.small, { width: 170 }]} numberOfLines={1}>{x.pass_to_customer && x.pass_to_customer_legal_ok ? 'dibebankan pelanggan' : 'ditanggung platform'}{x.active ? '' : ' · nonaktif'}</Text>
                          <SourcePill label={x.source_label} />
                          <Text style={[font.tiny, { flex: 1, minWidth: 160 }]} numberOfLines={2}>{x.note ?? x.notes ?? '—'} · diubah {fmtDate(x.updated_at)}</Text>
                          {tag === 'terjadwal' ? <RequirePerm perm="fee"><Button size="sm" variant="ghost" title="Ubah" icon="create-outline" onPress={() => openVersion(x, x.effective_from)} /></RequirePerm> : null}
                        </Row>
                      ))}
                      <Text style={font.tiny}>Versi lama tidak diubah dari sini agar transaksi yang sudah tercatat tetap bisa ditelusuri. Koreksi berlaku ke depan lewat “Versi baru”.</Text>
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        </ScrollView>
      </Panel>
      <WideTableHint what="kolom Label, Simpan & Riwayat" />

      <Panel title="Siapa menanggung biaya gateway, per layanan" subtitle="pg_fee_policy di Aturan Bisnis. Walau kebijakan layanan = Pelanggan, biaya hanya dibebankan bila saluran di atas lolos kajian legal." icon="people-outline"
        right={<Button size="sm" variant="outline" title="Ubah di Aturan Bisnis" icon="options-outline" onPress={() => router.push('/(admin)/economics' as never)} />}>
        {policyRows.length === 0 ? <Text style={font.small}>Belum ada data aturan per layanan.</Text> : (
          <Row gap={8} style={{ flexWrap: 'wrap' }}>
            {policyRows.map((p) => (
              <View key={p.service} style={st.pol}>
                <Text style={font.bodyStrong}>{serviceLabel[p.service] ?? p.service}</Text>
                <Pill text={`PG: ${FUNDER_LABEL[p.pg_fee_policy] ?? p.pg_fee_policy}`} tone={p.pg_fee_policy === 'customer' ? 'wait' : 'brand'} />
              </View>
            ))}
          </Row>
        )}
      </Panel>

      <AdminDialog visible={!!version} onClose={() => setVersion(null)} width={640}
        title={version?.locked ? `Ubah versi terjadwal · ${version?.label}` : `Versi tarif baru · ${version?.label ?? ''}`}
        subtitle={`${PROVIDERS.find((p) => p.value === provider)?.label} · ${version?.channel ?? ''} — transaksi dengan tanggal ≥ tanggal berlaku memakai versi ini.`}>
        {version ? (
          <View style={{ gap: 10 }}>
            <Row gap={10} style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
              {version.locked ? <Input label="Berlaku mulai" value={version.date} editable={false} containerStyle={{ width: 150 }} /> : <DateField label="Berlaku mulai (WIB)" value={version.date} onChange={(v) => setVersion({ ...version, date: v })} />}
              <AdminSelect label="Label sumber" width={220} value={version.d.source_label} options={SOURCE_OPTS} onChange={(v) => setVersion({ ...version, d: { ...version.d, source_label: v } })} />
            </Row>
            <Row gap={10} style={{ flexWrap: 'wrap' }}>
              {NUM_FIELDS.map((f) => (
                <Input key={f.key} label={f.label} value={version.d[f.key]} placeholder={f.optional ? 'kosong = sama dgn Fee %' : undefined} keyboardType="decimal-pad"
                  onChangeText={(t) => setVersion({ ...version, d: { ...version.d, [f.key]: t } })} containerStyle={{ width: 130 }} />
              ))}
            </Row>
            <Row gap={16} style={{ flexWrap: 'wrap', alignItems: 'center' }}>
              <Row gap={6}><Switch value={version.d.ppn_included} onValueChange={(v) => setVersion({ ...version, d: { ...version.d, ppn_included: v } })} /><Text style={font.small}>PPN termasuk</Text></Row>
              <Tip title={isQris(version.channel) ? QRIS_LOCK_NOTE : 'Tambahkan biaya metode pembayaran ke tagihan pelanggan'}>
                <Row gap={6}><Switch value={isQris(version.channel) ? false : version.d.pass_to_customer} disabled={isQris(version.channel)} onValueChange={(v) => setVersion({ ...version, d: { ...version.d, pass_to_customer: v } })} /><Text style={font.small}>Bebankan ke pelanggan{isQris(version.channel) ? ' (dikunci)' : ''}</Text></Row>
              </Tip>
              <Row gap={6}><Switch value={version.d.pass_to_customer_legal_ok} disabled={isQris(version.channel)} onValueChange={(v) => setVersion({ ...version, d: { ...version.d, pass_to_customer_legal_ok: v } })} /><Text style={font.small}>Lolos kajian legal</Text></Row>
              <Row gap={6}><Switch value={version.d.active} onValueChange={(v) => setVersion({ ...version, d: { ...version.d, active: v } })} /><Text style={font.small}>Aktif</Text></Row>
            </Row>
            <Input label="Catatan (sumber, nomor PKS/halaman, alasan perubahan)" value={version.d.note} multiline onChangeText={(t) => setVersion({ ...version, d: { ...version.d, note: t } })} style={{ minHeight: 56 }} />
            <Row gap={8} style={{ justifyContent: 'flex-end' }}>
              <Button size="sm" variant="ghost" title="Batal" onPress={() => setVersion(null)} />
              <Button size="sm" title={version.locked ? 'Simpan versi' : 'Buat versi'} icon="save-outline" loading={saving === `${version.channel}|${version.date}`} onPress={submitVersion} />
            </Row>
          </View>
        ) : null}
      </AdminDialog>

      <FootNote lines={[
        'Rumus (pg_fee_calc): fee = round(nominal × fee % ÷ 100) + fee tetap; bila “Fee % ≤ Rp100rb” diisi dan nominal ≤ Rp100.000, persentase itu yang dipakai. PPN = 0 bila “PPN termasuk”, selain itu round(fee × PPN % ÷ 100).',
        'Versi dipilih per transaksi: effective_from ≤ tanggal transaksi yang paling baru, untuk provider transaksi itu (bukan provider aktif hari ini).',
        'Label sumber: [FAKTA-PUBLIK] = halaman tarif resmi provider; [KONTRAK] = angka PKS yang ditandatangani; [ASUMSI] = perkiraan yang wajib dikonfirmasi; [PERLU-KONFIRMASI-KONTRAK] = aturan publik yang belum tertuang di PKS.',
        'Setiap perubahan dicatat di Log Audit (pg_fee.*) dengan nilai lama → baru; log bersifat append-only.',
      ]} />
    </AdminPage>
  );
}

const st = StyleSheet.create({
  note: { borderWidth: 1, borderRadius: adminRadius.card, padding: adminSpace.md },
  th: { paddingHorizontal: adminSpace.lg, paddingVertical: adminSpace.sm, backgroundColor: adminTone.surfaceAlt },
  tr: { paddingHorizontal: adminSpace.lg, paddingVertical: 8, borderTopWidth: 1, borderTopColor: adminTone.border, alignItems: 'center', minHeight: 72 },
  trAlt: { backgroundColor: adminTone.zebra },
  hist: { marginHorizontal: adminSpace.lg, marginBottom: adminSpace.md, padding: adminSpace.md, gap: 6, borderRadius: adminRadius.md, borderWidth: 1, borderColor: adminTone.border, backgroundColor: adminTone.surfaceAlt },
  histRow: { alignItems: 'center', flexWrap: 'wrap', paddingVertical: 4, borderTopWidth: 1, borderTopColor: adminTone.border },
  pol: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 6, borderRadius: adminRadius.md, borderWidth: 1, borderColor: adminTone.border, backgroundColor: adminTone.surfaceAlt },
});
