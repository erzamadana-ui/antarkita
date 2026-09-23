// Admin · Biaya Payment Gateway (Skema Bisnis v2, migrasi 0100).
// Tarif per saluran dari PKS Midtrans Ver.Aug-26 (Pasal 6, SOP B.6) di tabel `payment_channel_fees`:
// dibaca rpc('admin_payment_channel_fees'), diubah per saluran rpc('admin_set_payment_channel_fee')
// (PIN panel + log aktivitas pg_fee.updated). Rumus server (pg_fee_calc):
//   fee = round(nominal × fee_pct/100) + fee_fixed;  PPN = 0 bila ppn_included, selain itu round(fee × ppn_pct/100).
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Switch } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { AdminPage, Panel, Pill, adminFont as font, adminTone, adminSpace, adminRadius, adminIcon, TONE } from '@/components/admin';
import { FootNote } from '@/components/reports';
import { Row, Input, Button, toast } from '@/components/ui';
import { rpc } from '@/lib/supabase';
import { colors } from '@/lib/theme';
import { rupiah, serviceLabel } from '@/lib/format';
import { handleAdminError, useAdminSecurity } from '@/store/adminSecurity';
import { GATEWAY_CHANNELS } from '@/store/payprefs';
import type { PaymentChannelFee, ServiceEconomics } from '@/lib/types';
import { ErrorNote, LabelPill, SERVICE_KEYS, fmtDate, labelTags, parseNum, WideTableHint, FUNDER_LABEL } from './_shared';

type NumKey = 'fee_pct' | 'fee_fixed' | 'ppn_pct' | 'hold_days' | 'min_auto_disburse';
type Draft = Record<NumKey, string> & { ppn_included: boolean; active: boolean };
const NUM_FIELDS: { key: NumKey; label: string; width: number; min: number; max: number; int: boolean; unit: string }[] = [
  { key: 'fee_pct', label: 'Fee %', width: 76, min: 0, max: 20, int: false, unit: '%' },
  { key: 'fee_fixed', label: 'Fee tetap (Rp)', width: 96, min: 0, max: 100000, int: true, unit: 'Rp' },
  { key: 'ppn_pct', label: 'PPN %', width: 72, min: 0, max: 20, int: false, unit: '%' },
  { key: 'hold_days', label: 'Hold H+n', width: 76, min: 0, max: 30, int: true, unit: 'hari' },
  { key: 'min_auto_disburse', label: 'Min. cair otomatis (Rp)', width: 118, min: 0, max: Number.MAX_SAFE_INTEGER, int: true, unit: 'Rp' },
];
const toDraft = (r: PaymentChannelFee): Draft => ({
  fee_pct: String(r.fee_pct ?? 0), fee_fixed: String(r.fee_fixed ?? 0), ppn_pct: String(r.ppn_pct ?? 11),
  hold_days: String(r.hold_days ?? 0), min_auto_disburse: String(r.min_auto_disburse ?? 0),
  ppn_included: !!r.ppn_included, active: !!r.active,
});
/** Sama persis dengan pg_fee_calc di server. */
const calcFee = (amount: number, d: { fee_pct: number; fee_fixed: number; ppn_included: boolean; ppn_pct: number; active: boolean }) => {
  if (!d.active || !(amount > 0)) return { fee: 0, ppn: 0 };
  const fee = Math.round((amount * d.fee_pct) / 100) + d.fee_fixed;
  return { fee, ppn: d.ppn_included ? 0 : Math.round((fee * d.ppn_pct) / 100) };
};

export default function AdminPgFees() {
  const router = useRouter();
  const [rows, setRows] = useState<PaymentChannelFee[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [policies, setPolicies] = useState<ServiceEconomics[]>([]);
  const [antarpay, setAntarpay] = useState<boolean | null>(null);
  const [errs, setErrs] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [sample, setSample] = useState('100000');

  const load = useCallback(async () => {
    setLoading(true);
    const e: string[] = [];
    try {
      const r = (await rpc<PaymentChannelFee[]>('admin_payment_channel_fees')) ?? [];
      setRows(r); setDrafts(Object.fromEntries(r.map((x) => [x.channel, toDraft(x)])));
    } catch (x) { e.push(`Tarif saluran: ${(x as Error).message}`); }
    try { setPolicies((await rpc<ServiceEconomics[]>('admin_service_economics')) ?? []); } catch (x) { e.push(`Kebijakan per layanan: ${(x as Error).message}`); }
    try { setAntarpay((await rpc<boolean>('antarpay_enabled')) === true); } catch (x) { setAntarpay(null); e.push(`Status AntarPay: ${(x as Error).message}`); }
    setErrs(e); setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const setField = (ch: string, k: keyof Draft, v: string | boolean) => setDrafts((d) => ({ ...d, [ch]: { ...d[ch], [k]: v } as Draft }));

  const buildPatch = (row: PaymentChannelFee, d: Draft): { patch: Record<string, unknown>; error?: string } => {
    const patch: Record<string, unknown> = {};
    for (const f of NUM_FIELDS) {
      const n = parseNum(d[f.key]);
      if (!Number.isFinite(n)) return { patch, error: `${f.label} harus berupa angka` };
      if (n < f.min || n > f.max) return { patch, error: f.max === Number.MAX_SAFE_INTEGER ? `${f.label} harus ≥ 0` : `${f.label} harus ${f.min}–${f.max.toLocaleString('id-ID')} ${f.unit}` };
      if (f.int && !Number.isInteger(n)) return { patch, error: `${f.label} harus bilangan bulat` };
      if (n !== Number(row[f.key])) patch[f.key] = n;
    }
    if (d.ppn_included !== !!row.ppn_included) patch.ppn_included = d.ppn_included;
    if (d.active !== !!row.active) patch.active = d.active;
    return { patch };
  };

  const save = async (row: PaymentChannelFee) => {
    const d = drafts[row.channel];
    if (!d) return;
    const { patch, error } = buildPatch(row, d);
    if (error) return toast.error(`${row.label ?? row.channel}: ${error}`);
    if (Object.keys(patch).length === 0) return toast.show('Tidak ada perubahan untuk disimpan');
    if (!(await useAdminSecurity.getState().ensureUnlocked())) return;
    setSaving(row.channel);
    try {
      const a = await rpc<PaymentChannelFee>('admin_set_payment_channel_fee', { p_channel: row.channel, p_patch: patch });
      setRows((rs) => rs.map((x) => (x.channel === a.channel ? a : x)));
      setDrafts((ds) => ({ ...ds, [a.channel]: toDraft(a) }));
      toast.success(`Tarif ${a.label ?? a.channel} disimpan`);
    } catch (e) { handleAdminError(e); }
    finally { setSaving(null); }
  };

  const amount = parseNum(sample);
  const policyRows = [...policies].sort((a, b) => SERVICE_KEYS.indexOf(a.service) - SERVICE_KEYS.indexOf(b.service));

  return (
    <AdminPage title="Biaya Payment Gateway" subtitle="Tarif Midtrans per saluran — dipakai buku besar order (pg_fee), laporan contribution, dan rekonsiliasi. Menyimpan butuh PIN panel." onRefresh={load}
      right={<Button size="sm" variant="outline" title="Segarkan" icon="refresh-outline" onPress={load} />}>
      {errs.map((t) => <ErrorNote key={t} text={t} onRetry={load} />)}

      <View style={[st.note, { backgroundColor: TONE.info.bg, borderColor: TONE.info.border }]}>
        <Row gap={8} style={{ alignItems: 'flex-start' }}>
          <Ionicons name="document-text-outline" size={adminIcon.md} color={TONE.info.fg} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[font.bodyStrong, { color: TONE.info.fg }]}>Sumber: PKS Midtrans Ver.Aug-26 (Pasal 6, SOP B.6) — layanan Aggregator</Text>
            <Text style={font.small}>
              Kontrak Elektronik M568767786_825925_PKS-Pass_M_09_2026. Pasal 6 = tarif per saluran; SOP B.6.a = dana ditahan H+n sejak settlement dan batas minimal pencairan otomatis Rp50.000.
              PPN 11 % atas jasa gateway adalah [ASUMSI] tarif efektif — ubah bila konsultan pajak menetapkan lain.
            </Text>
          </View>
        </Row>
      </View>

      <View style={[st.note, { backgroundColor: TONE.wait.bg, borderColor: TONE.wait.border }]}>
        <Row gap={8} style={{ alignItems: 'flex-start' }}>
          <Ionicons name="warning-outline" size={adminIcon.md} color={TONE.wait.fg} />
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={[font.bodyStrong, { color: TONE.wait.fg }]}>PKS Pasal 7 ayat 4(b): fitur uang elektronik / dompet elektronik wajib izin Bank Indonesia</Text>
            <Text style={font.small}>
              Menjalankan fitur dompet/uang elektronik yang butuh izin tanpa izin memberi Midtrans hak menghentikan layanan. Karena itu top-up AntarPay (stored value)
              HARUS tetap NONAKTIF sampai ada review legal/izin. Pembayaran non-tunai lewat gateway dilakukan per order (purpose=order), bukan isi saldo.
              Saldo AntarPay hanya untuk dompet pendapatan mitra (earning/penarikan) dan refund pelanggan (closed-loop, tidak bisa di-top-up).
            </Text>
            <Row gap={8} style={{ flexWrap: 'wrap', alignItems: 'center' }}>
              <Text style={font.small}>Status sakelar AntarPay saat ini:</Text>
              {antarpay === null ? <Pill text="tidak diketahui" tone="off" /> : antarpay
                ? <Pill text="AKTIF — tinjau segera" tone="bad" icon="alert-circle" />
                : <Pill text="NONAKTIF — sesuai Pasal 7.4(b)" tone="ok" icon="checkmark-circle" />}
              <Button size="sm" variant="ghost" title="Buka Payment Gateway" icon="open-outline" onPress={() => router.push('/(admin)/gateway' as never)} />
            </Row>
          </View>
        </Row>
      </View>

      <Panel title="Tarif per saluran" subtitle="Ubah lalu Simpan per baris. Saluran nonaktif → biaya dihitung 0 (tarif tidak berlaku)." icon="card-outline" padded={false}
        right={<Input label="Contoh nominal (Rp)" value={sample} keyboardType="number-pad" onChangeText={setSample} containerStyle={{ width: 150 }} style={{ paddingVertical: 4 }} />}>
        <ScrollView horizontal showsHorizontalScrollIndicator>
          <View style={{ minWidth: 1260 }}>
            <Row gap={8} style={st.th}>
              <Text style={[font.label, { width: 210 }]}>Saluran</Text>
              {NUM_FIELDS.slice(0, 2).map((f) => <Text key={f.key} style={[font.label, { width: f.width, textAlign: 'right' }]} numberOfLines={2}>{f.label}</Text>)}
              <Text style={[font.label, { width: 88 }]} numberOfLines={2}>PPN termasuk</Text>
              {NUM_FIELDS.slice(2).map((f) => <Text key={f.key} style={[font.label, { width: f.width, textAlign: 'right' }]} numberOfLines={2}>{f.label}</Text>)}
              <Text style={[font.label, { width: 64 }]}>Aktif</Text>
              <Text style={[font.label, { width: 150, textAlign: 'right' }]} numberOfLines={2}>Biaya contoh (+PPN)</Text>
              <Text style={[font.label, { width: 150 }]}>Catatan</Text>
              <Text style={[font.label, { width: 84 }]} />
            </Row>
            {loading && rows.length === 0 ? <Text style={[font.small, { padding: adminSpace.lg }]}>Memuat tarif…</Text> : null}
            {!loading && rows.length === 0 && errs.length === 0 ? <Text style={[font.small, { padding: adminSpace.lg }]}>Tabel payment_channel_fees kosong — migrasi 0100 belum diterapkan?</Text> : null}
            {rows.map((row, i) => {
              const d = drafts[row.channel];
              if (!d) return null;
              const isGw = GATEWAY_CHANNELS.includes(row.channel);
              const pv = calcFee(Number.isFinite(amount) ? amount : 0, {
                fee_pct: parseNum(d.fee_pct) || 0, fee_fixed: parseNum(d.fee_fixed) || 0, ppn_included: d.ppn_included, ppn_pct: parseNum(d.ppn_pct) || 0, active: d.active,
              });
              const dirty = Object.keys(buildPatch(row, d).patch).length > 0;
              const banks = Object.entries(row.hold_days_by_bank ?? {});
              const tags = labelTags(row.notes);
              return (
                <Row key={row.channel} gap={8} style={[st.tr, i % 2 ? st.trAlt : null, !d.active && { opacity: 0.6 }]}>
                  <View style={{ width: 210, gap: 3 }}>
                    <Text style={font.bodyStrong} numberOfLines={1}>{row.label ?? row.channel}</Text>
                    <Text style={font.tiny} numberOfLines={1}>{row.channel} · {row.provider}</Text>
                    <Row gap={4} style={{ flexWrap: 'wrap' }}>
                      <Pill text={isGw ? 'dipakai aplikasi' : row.provider === 'internal' ? 'bukan gateway' : 'belum dipakai'} tone={isGw ? 'brand' : 'off'} />
                      {tags.map((t) => <LabelPill key={t} text={t} />)}
                    </Row>
                  </View>
                  {NUM_FIELDS.slice(0, 2).map((f) => (
                    <Input key={f.key} value={d[f.key]} keyboardType="decimal-pad" onChangeText={(t) => setField(row.channel, f.key, t)} containerStyle={{ width: f.width }} style={{ textAlign: 'right', paddingVertical: 6 }} />
                  ))}
                  <View style={{ width: 88 }}><Switch value={d.ppn_included} onValueChange={(v) => setField(row.channel, 'ppn_included', v)} trackColor={{ true: colors.success, false: colors.border }} thumbColor="#fff" /></View>
                  {NUM_FIELDS.slice(2).map((f) => (
                    <Input key={f.key} value={d[f.key]} keyboardType="decimal-pad" onChangeText={(t) => setField(row.channel, f.key, t)} containerStyle={{ width: f.width }}
                      style={{ textAlign: 'right', paddingVertical: 6, opacity: f.key === 'ppn_pct' && d.ppn_included ? 0.45 : 1 }} />
                  ))}
                  <View style={{ width: 64 }}><Switch value={d.active} onValueChange={(v) => setField(row.channel, 'active', v)} trackColor={{ true: colors.success, false: colors.border }} thumbColor="#fff" /></View>
                  <View style={{ width: 150, alignItems: 'flex-end' }}>
                    <Text style={font.mono}>{rupiah(pv.fee + pv.ppn)}</Text>
                    <Text style={font.tiny}>fee {rupiah(pv.fee)} · PPN {rupiah(pv.ppn)}</Text>
                  </View>
                  <View style={{ width: 150 }}>
                    <Text style={font.tiny} numberOfLines={3}>{banks.length ? `Hold per bank: ${banks.map(([b, n]) => `${b.toUpperCase()} H+${n}`).join(', ')}. ` : ''}{row.notes ?? row.source ?? '—'}</Text>
                  </View>
                  <View style={{ width: 84, gap: 4 }}>
                    <Button title="Simpan" size="sm" variant={dirty ? 'primary' : 'outline'} loading={saving === row.channel} onPress={() => save(row)} />
                    <Text style={font.tiny} numberOfLines={2}>{fmtDate(row.updated_at)}</Text>
                  </View>
                </Row>
              );
            })}
          </View>
        </ScrollView>
      </Panel>
      <WideTableHint what="kolom Catatan & Simpan" />

      <Panel title="Siapa menanggung biaya gateway, per layanan" subtitle="pg_fee_policy di Aturan Bisnis: Platform = dipotong dari pendapatan platform; Pelanggan = ditambahkan ke total sebagai “Biaya pembayaran”" icon="people-outline"
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

      <FootNote lines={[
        'Rumus (pg_fee_calc): fee = round(nominal × fee % ÷ 100) + fee tetap; PPN = 0 bila “PPN termasuk”, selain itu round(fee × PPN % ÷ 100).',
        'Hold H+n: dana settlement ditahan Midtrans n hari kalender (payments.hold_until). Pengecualian per bank VA (mis. BSI/SeaBank H+2) disimpan di hold_days_by_bank dan tidak diubah dari layar ini.',
        'Tunai, AntarPay (saldo), dan e-money NFC bukan gateway — biayanya 0. Biaya top-up (bila kelak diizinkan) dicatat di wallet_transactions.pg_fee.',
        'Setiap perubahan dicatat di Log Aktivitas (pg_fee.updated) dengan nilai lama → baru.',
      ]} />
    </AdminPage>
  );
}

const st = StyleSheet.create({
  note: { borderWidth: 1, borderRadius: adminRadius.card, padding: adminSpace.md },
  th: { paddingHorizontal: adminSpace.lg, paddingVertical: adminSpace.sm, backgroundColor: adminTone.surfaceAlt },
  tr: { paddingHorizontal: adminSpace.lg, paddingVertical: 8, borderTopWidth: 1, borderTopColor: adminTone.border, alignItems: 'center', minHeight: 64 },
  trAlt: { backgroundColor: adminTone.zebra },
  pol: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 6, borderRadius: adminRadius.md, borderWidth: 1, borderColor: adminTone.border, backgroundColor: adminTone.surfaceAlt },
});
