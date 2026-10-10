// Admin · Biaya Tetap Kota (Skema Bisnis v2, migrasi 0102/0103).
// Per bulan: rpc('admin_city_fixed_costs', { p_month }) → baris biaya per kota/kategori, total per kota,
// dan ringkasan EBITDA kota bulan itu (contribution dari order_ledger − biaya tetap).
// Tambah/ubah satu sel (kota, bulan, kategori) lewat rpc('admin_set_city_fixed_cost') (PIN + log city_cost.updated).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AdminPage, Panel, DataTable, StatCard, AdminSelect, Pill, RequirePerm, adminFont as font, adminTone, adminSpace, adminRadius, adminIcon } from '@/components/admin';
import { FootNote } from '@/components/reports';
import { Row, Input, Button, toast } from '@/components/ui';
import { rpc, supabase } from '@/lib/supabase';
import { rupiah } from '@/lib/format';
import { handleAdminError, useAdminSecurity } from '@/store/adminSecurity';
import type { AdminCityFixedCosts, CityCostCategory } from '@/lib/types';
import { ErrorNote, fmtDate, moneyCol, countCol, pctCol, parseNum, Trunc, WideTableHint } from './_shared';
import { confirmAsync } from '@/lib/mitra';
import { adminSetCityTargets, cityTargetsProgress, type CityTargetProgress } from '@/lib/voucherV5';

const CATEGORY_LABEL: Record<CityCostCategory, string> = {
  tim: 'Tim', akuisisi: 'Akuisisi', kantor: 'Kantor', legal: 'Legal', teknologi: 'Teknologi', lainnya: 'Lainnya',
  variable_ops: 'Biaya variabel ops (dialokasikan per order)',
};
const CATEGORIES = Object.keys(CATEGORY_LABEL) as CityCostCategory[];
const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

type CityOpt = { id: string; name: string; province: string | null; service_status: string | null };

const pad = (n: number) => String(n).padStart(2, '0');
/** Bulan berjalan menurut WIB → "YYYY-MM-01". */
const thisMonth = () => { const t = new Date(Date.now() + 7 * 3600000); return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-01`; };
const shiftMonth = (m: string, delta: number) => {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-01`;
};
const monthLabel = (m: string) => { const [y, mo] = m.split('-').map(Number); return `${BULAN[mo - 1] ?? mo} ${y}`; };
const MIN_MONTH = '2024-01-01';

export default function AdminCityCosts() {
  const [month, setMonth] = useState(thisMonth());
  const [data, setData] = useState<AdminCityFixedCosts | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [cities, setCities] = useState<CityOpt[]>([]);
  const [cityErr, setCityErr] = useState<string | null>(null);
  const [f, setF] = useState({ city_id: '', category: 'tim' as CityCostCategory, amount: '', note: '' });
  const [busy, setBusy] = useState(false);
  const maxMonth = shiftMonth(thisMonth(), 12);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await rpc<AdminCityFixedCosts>('admin_city_fixed_costs', { p_month: month })); setErr(null); }
    catch (e) { setErr((e as Error).message); setData(null); }
    finally { setLoading(false); }
  }, [month]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    (async () => {
      const { data: c, error } = await supabase.from('cities').select('id,name,province,service_status').order('name');
      if (error) setCityErr(`Daftar kota: ${error.message}`); else { setCityErr(null); setCities((c as CityOpt[]) ?? []); }
    })();
  }, []);

  const cityOpts = useMemo(() => {
    const rank = (s: string | null) => (s === 'aktif' ? 0 : s === 'segera' ? 1 : 2);
    return [...cities].sort((a, b) => rank(a.service_status) - rank(b.service_status) || a.name.localeCompare(b.name))
      .map((c) => ({ value: c.id, label: c.name, sublabel: `${c.province ?? '—'} · ${c.service_status ?? '—'}` }));
  }, [cities]);

  const save = async () => {
    const amount = parseNum(f.amount);
    if (!f.city_id) return toast.error('Pilih kota');
    if (!Number.isInteger(amount) || amount < 0 || amount > 100_000_000_000) return toast.error('Nominal harus bilangan bulat Rp0–Rp100 miliar');
    if (month < MIN_MONTH || month > maxMonth) return toast.error('Bulan di luar rentang (Jan 2024 s.d. 12 bulan ke depan)');
    if (!(await useAdminSecurity.getState().ensureUnlocked())) return;
    setBusy(true);
    try {
      await rpc('admin_set_city_fixed_cost', { p_city_id: f.city_id, p_month: month, p_category: f.category, p_amount: amount, p_note: f.note.trim() || null });
      toast.success(`Biaya ${CATEGORY_LABEL[f.category]} ${cities.find((c) => c.id === f.city_id)?.name ?? ''} ${monthLabel(month)} disimpan`);
      setF((x) => ({ ...x, amount: '', note: '' })); await load();
    } catch (e) { handleAdminError(e); } finally { setBusy(false); }
  };

  const sum = data?.summary;
  const ebitdaRows = data?.ebitda ?? [];
  const ebitdaColor = (n: number | null | undefined) => ((n ?? 0) >= 0 ? adminTone.green : adminTone.red);

  return (
    <AdminPage title="Biaya Tetap Kota" subtitle="Biaya tetap per kota per bulan untuk EBITDA kota = Σ contribution − biaya tetap. Menyimpan butuh PIN panel." onRefresh={load}
      right={<Button size="sm" variant="outline" title="Segarkan" icon="refresh-outline" onPress={load} />}>
      <Row gap={10} style={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <Pressable onPress={() => setMonth((m) => (shiftMonth(m, -1) < MIN_MONTH ? m : shiftMonth(m, -1)))} style={st.navBtn} accessibilityLabel="Bulan sebelumnya">
          <Ionicons name="chevron-back" size={adminIcon.md} color={adminTone.ink2} />
        </Pressable>
        <View style={st.month}><Ionicons name="calendar-outline" size={adminIcon.md} color={adminTone.teal} /><Text style={font.h3}>{monthLabel(month)}</Text></View>
        <Pressable onPress={() => setMonth((m) => (shiftMonth(m, 1) > maxMonth ? m : shiftMonth(m, 1)))} style={st.navBtn} accessibilityLabel="Bulan berikutnya">
          <Ionicons name="chevron-forward" size={adminIcon.md} color={adminTone.ink2} />
        </Pressable>
        {month !== thisMonth() ? <Button size="sm" variant="ghost" title="Bulan ini" onPress={() => setMonth(thisMonth())} /> : null}
        {loading ? <Text style={font.tiny}>Memuat…</Text> : null}
      </Row>

      <ErrorNote text={err} onRetry={load} />

      <Row gap={adminSpace.md} style={{ flexWrap: 'wrap' }}>
        <StatCard index={0} icon="business-outline" label="Biaya tetap (bulan ini)" value={rupiah(data?.total_fixed ?? 0)} color={adminTone.orange} hint="tanpa variable_ops" />
        <StatCard index={1} icon="git-branch-outline" label="Biaya variabel ops" value={rupiah(data?.total_variable_ops ?? 0)} color={adminTone.amber} hint="dialokasikan pro-rata per order selesai" />
        <StatCard index={2} icon="stats-chart-outline" label="Contribution (semua kota)" value={rupiah(sum?.contribution_total ?? 0)} color={ebitdaColor(sum?.contribution_total)} hint="dari order_ledger bulan ini" />
        <StatCard index={3} icon="trending-up-outline" label="EBITDA (semua kota)" value={rupiah(sum?.ebitda ?? 0)} color={ebitdaColor(sum?.ebitda)} hint={`contribution − biaya tetap ${rupiah(sum?.fixed_costs_total ?? 0)}`} />
      </Row>

      <Panel title={`EBITDA per kota · ${monthLabel(month)}`} subtitle="Contribution kota − biaya tetap kota (satu bulan penuh). Kota tanpa order tetap muncul bila punya biaya." icon="podium-outline" padded={false}>
        <DataTable keyField="city" rows={ebitdaRows as unknown as Record<string, unknown>[]} emptyText="Belum ada order selesai maupun biaya pada bulan ini" emptyIcon="podium-outline" columns={[
          { key: 'city', label: 'Kota', width: 170, render: (r) => <Trunc style={font.bodyStrong} title={String(r.city)}>{String(r.city ?? '—')}</Trunc> },
          countCol('orders', 'Order', 80),
          moneyCol('gmv_net', 'GMV bersih', 130),
          moneyCol('revenue', 'Pendapatan', 120, adminTone.teal),
          pctCol('take_rate_pct', 'Take rate', 90),
          moneyCol('contribution', 'Contribution', 130, (r) => ebitdaColor(Number(r.contribution))),
          moneyCol('fixed_costs', 'Biaya tetap', 120, adminTone.orange),
          moneyCol('ebitda_city', 'EBITDA kota', 130, (r) => ebitdaColor(Number(r.ebitda_city))),
        ]} />
      </Panel>

      <Row gap={adminSpace.lg} style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <Panel title="Tambah / ubah biaya" subtitle={`Bulan ${monthLabel(month)} · satu nilai per kota × kategori (menimpa nilai lama)`} icon="create-outline" style={{ flex: 1, minWidth: 320 }}>
          <View style={{ gap: 10 }}>
            <ErrorNote text={cityErr} />
            <AdminSelect label="Kota" width="100%" value={f.city_id} options={cityOpts} placeholder="Pilih kota…" searchable onChange={(v) => setF({ ...f, city_id: v })} helper="Kota berstatus aktif diurutkan paling atas" />
            <AdminSelect label="Kategori" width="100%" value={f.category} options={CATEGORIES.map((k) => ({ value: k, label: CATEGORY_LABEL[k], sublabel: k }))} onChange={(v) => setF({ ...f, category: v as CityCostCategory })} />
            <Input label="Nominal (Rp / bulan)" value={f.amount} keyboardType="number-pad" onChangeText={(v) => setF({ ...f, amount: v })} />
            <Input label="Catatan (opsional)" value={f.note} onChangeText={(v) => setF({ ...f, note: v })} placeholder="mis. gaji 2 staf operasional" />
            <Button title="Simpan biaya" icon="save-outline" loading={busy} onPress={save} />
            <Text style={font.tiny}>Nominal 0 tetap disimpan sebagai jejak “sudah diisi nol”. Catatan kosong mempertahankan catatan lama.</Text>
          </View>
        </Panel>

        <Panel title="Total per kota" icon="list-outline" padded={false} style={{ flex: 1, minWidth: 320 }}>
          <DataTable keyField="city_id" rows={(data?.by_city ?? []) as unknown as Record<string, unknown>[]} emptyText="Belum ada biaya bulan ini" columns={[
            { key: 'city', label: 'Kota', width: 150, render: (r) => <Trunc style={font.bodyStrong} title={String(r.city)}>{String(r.city)}</Trunc> },
            moneyCol('fixed', 'Tetap', 116, adminTone.orange),
            moneyCol('variable_ops', 'Variabel ops', 116, adminTone.amber),
            moneyCol('total', 'Total', 120),
          ]} />
        </Panel>
      </Row>

      <CityTargetsSection month={month} monthLabel={monthLabel(month)} cities={cityOpts} totalFixed={data?.total_fixed ?? 0} />

      <Panel title="Rincian biaya" subtitle="Klik baris untuk mengisi form dengan nilainya" icon="receipt-outline" padded={false}>
        <DataTable rows={(data?.rows ?? []) as unknown as Record<string, unknown>[]} emptyText={`Belum ada biaya untuk ${monthLabel(month)}`} emptyIcon="business-outline"
          onRowPress={(r) => setF({ city_id: String(r.city_id), category: r.category as CityCostCategory, amount: String(r.amount ?? ''), note: String(r.note ?? '') })}
          columns={[
            { key: 'city', label: 'Kota', width: 170, render: (r) => <Trunc style={font.bodyStrong} title={String(r.city)}>{String(r.city)}</Trunc> },
            { key: 'category', label: 'Kategori', width: 220, render: (r) => <Pill text={CATEGORY_LABEL[r.category as CityCostCategory] ?? String(r.category)} tone={r.category === 'variable_ops' ? 'wait' : 'neutral'} /> },
            moneyCol('amount', 'Nominal', 130),
            { key: 'note', label: 'Catatan', width: 260, flex: 1, render: (r) => <Text style={font.small} numberOfLines={2}>{r.note ? String(r.note) : '—'}</Text> },
            { key: 'updated_at', label: 'Diperbarui', width: 140, render: (r) => <Text style={font.tiny}>{fmtDate(r.updated_at as string)}</Text> },
          ]} />
      </Panel>
      <WideTableHint />

      <FootNote lines={[
        'Kategori tetap: tim, akuisisi, kantor, legal, teknologi, lainnya. EBITDA kota = Σ contribution order kota itu − Σ biaya tetap kota (§0.6).',
        'Kategori variable_ops [ASUMSI] = biaya variabel non-order (support, fraud, asuransi, cloud) — tidak dihitung sebagai biaya tetap, tetapi dialokasikan pro-rata ke contribution tiap order selesai bulan itu. Bila bulan itu tidak ada order, nilainya masuk biaya tetap.',
        'Ringkasan EBITDA di halaman ini memakai satu bulan kalender penuh (biaya tetap penuh, contribution dari order yang sudah selesai). Laporan Skema Bisnis dengan rentang tanggal parsial menghitung biaya tetap pro-rata hari.',
        'Setiap perubahan dicatat di Log Aktivitas (city_cost.updated) dengan nilai lama → baru.',
        'v5 Target & COGS: COGS/order = Σ biaya tetap kota bulan ÷ target order; status on_track ≥ 100 % pro-rata hari berjalan, at_risk 80–100 %, behind < 80 %. Rekomendasi biaya layanan = ceil(COGS/order × (1 + cogs_margin_target_pct) / 500) × 500 — usulan sistem, keputusan tetap di GM/Direksi.',
      ]} />
    </AdminPage>
  );
}

const st = StyleSheet.create({
  navBtn: { width: 34, height: 34, borderRadius: adminRadius.sm, borderWidth: 1, borderColor: adminTone.border, backgroundColor: adminTone.surface, alignItems: 'center', justifyContent: 'center' },
  month: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, height: 34, borderRadius: adminRadius.sm, borderWidth: 1, borderColor: adminTone.border, backgroundColor: adminTone.surface, minWidth: 180, justifyContent: 'center' },
});

/* ───────────────── v5 · Target & COGS per kota (KONTRAK-V5 §3 admin_set_city_targets / city_targets_progress) ───────────────── */

const T_STATUS: Record<CityTargetProgress['status'], { label: string; tone: 'ok' | 'wait' | 'bad' | 'off' }> = {
  on_track: { label: 'On track', tone: 'ok' }, at_risk: { label: 'At risk', tone: 'wait' }, behind: { label: 'Behind', tone: 'bad' }, no_target: { label: 'Tanpa target', tone: 'off' },
};
const pctTxt = (n: number | null | undefined) => `${Number(n ?? 0).toLocaleString('id-ID', { maximumFractionDigits: 0 })} %`;

function CityTargetsSection({ month, monthLabel: mLabel, cities, totalFixed }: { month: string; monthLabel: string; cities: { value: string; label: string; sublabel?: string }[]; totalFixed: number }) {
  const [rows, setRows] = useState<CityTargetProgress[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ city_id: '', target_orders: '', target_npr: '', target_active_drivers: '', target_active_merchants: '', pic_ops: '', pic_finance: '', note: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await cityTargetsProgress(month); setRows(Array.isArray(r) ? r : []); setErr(null); }
    catch (e) { setErr(`Progres target kota: ${(e as Error).message}`); setRows([]); }
    finally { setLoading(false); }
  }, [month]);
  useEffect(() => { load(); }, [load]);

  const fill = (r: CityTargetProgress) => setF({
    city_id: r.city_id, target_orders: String(r.target_orders ?? ''), target_npr: String(r.target_npr ?? ''), target_active_drivers: String(r.target_active_drivers ?? ''),
    target_active_merchants: String(r.target_active_merchants ?? ''), pic_ops: r.pic_ops ?? '', pic_finance: r.pic_finance ?? '', note: '',
  });
  const save = async () => {
    const to = parseNum(f.target_orders), tn = parseNum(f.target_npr), td = parseNum(f.target_active_drivers), tm = parseNum(f.target_active_merchants);
    if (!f.city_id) return toast.error('Pilih kota');
    if (!Number.isInteger(to) || to < 0 || to > 10_000_000) return toast.error('Target order harus bilangan bulat 0–10 juta');
    if (!Number.isInteger(tn) || tn < 0) return toast.error('Target NPR (pendapatan platform bersih) harus bilangan bulat ≥ 0');
    if (!Number.isInteger(td) || td < 0 || !Number.isInteger(tm) || tm < 0) return toast.error('Target driver/merchant aktif harus bilangan bulat ≥ 0');
    const cityName = cities.find((c) => c.value === f.city_id)?.label ?? f.city_id;
    if (!(await confirmAsync(`Simpan target ${cityName} ${mLabel}?`, `${to.toLocaleString('id-ID')} order · NPR ${rupiah(tn)} · ${td} driver aktif · ${tm} merchant aktif · PIC ops ${f.pic_ops || '—'} · PIC finance ${f.pic_finance || '—'}. Menimpa target bulan yang sama.`, 'Ya, simpan'))) return;
    if (!(await useAdminSecurity.getState().ensureUnlocked())) return;
    setBusy(true);
    try {
      await adminSetCityTargets({ city_id: f.city_id, month, target_orders: to, target_npr: tn, target_active_drivers: td, target_active_merchants: tm, pic_ops: f.pic_ops.trim() || null, pic_finance: f.pic_finance.trim() || null, note: f.note.trim() || null });
      toast.success(`Target ${cityName} ${mLabel} disimpan & tercatat di log`); await load();
    } catch (e) { handleAdminError(e); } finally { setBusy(false); }
  };

  const tot = rows.reduce((a, r) => ({ t: a.t + Number(r.target_orders || 0), o: a.o + Number(r.actual_orders || 0), n: a.n + Number(r.actual_npr || 0), tn: a.tn + Number(r.target_npr || 0) }), { t: 0, o: 0, n: 0, tn: 0 });
  const nBehind = rows.filter((r) => r.status === 'behind').length;
  const fee = (r: Record<string, unknown>) => <Text style={[font.mono, { color: adminTone.teal, fontWeight: '700' }]}>{rupiah(Number(r.platform_fee_recommended ?? 0))}</Text>;

  return (
    <>
      <Row gap={adminSpace.md} style={{ flexWrap: 'wrap' }}>
        <StatCard index={0} icon="flag-outline" label={`Order vs target · ${mLabel}`} value={`${tot.o.toLocaleString('id-ID')} / ${tot.t.toLocaleString('id-ID')}`} hint={tot.t ? `${pctTxt((tot.o / tot.t) * 100)} dari target semua kota` : 'belum ada target'} color={adminTone.blue} />
        <StatCard index={1} icon="cash-outline" label="NPR vs target" value={rupiah(tot.n)} hint={tot.tn ? `target ${rupiah(tot.tn)} (${pctTxt((tot.n / tot.tn) * 100)})` : 'NPR = platform_revenue − PPN − promo platform'} color={adminTone.teal} />
        <StatCard index={2} icon="business-outline" label="COGS bulan ini (biaya tetap)" value={rupiah(totalFixed)} hint="dibebankan ke transaksi lewat biaya layanan" color={adminTone.orange} />
        <StatCard index={3} icon="warning-outline" label="Kota behind" value={nBehind} hint={nBehind ? 'eskalasi ke PIC ops & finance' : 'tidak ada kota tertinggal'} color={nBehind ? adminTone.red : adminTone.green} />
      </Row>

      <Row gap={adminSpace.lg} style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <Panel title="Target bulan per kota" subtitle={`Bulan ${mLabel} · target order, NPR, mitra aktif & PIC (manajer ops / keuangan). Klik baris tabel untuk mengisi.`} icon="flag-outline" style={{ flex: 1, minWidth: 320 }}>
          <View style={{ gap: 10 }}>
            <AdminSelect label="Kota" width="100%" value={f.city_id} options={cities} placeholder="Pilih kota…" searchable onChange={(v) => setF({ ...f, city_id: v })} />
            <Row gap={8} style={{ flexWrap: 'wrap' }}>
              <Input label="Target order selesai" value={f.target_orders} keyboardType="number-pad" onChangeText={(v) => setF({ ...f, target_orders: v.replace(/\D/g, '') })} containerStyle={{ flex: 1, minWidth: 140 }} />
              <Input label="Target NPR (Rp)" value={f.target_npr} keyboardType="number-pad" onChangeText={(v) => setF({ ...f, target_npr: v.replace(/\D/g, '') })} containerStyle={{ flex: 1, minWidth: 140 }} />
            </Row>
            <Row gap={8} style={{ flexWrap: 'wrap' }}>
              <Input label="Driver aktif (≥10 order)" value={f.target_active_drivers} keyboardType="number-pad" onChangeText={(v) => setF({ ...f, target_active_drivers: v.replace(/\D/g, '') })} containerStyle={{ flex: 1, minWidth: 140 }} />
              <Input label="Merchant aktif (≥5 order)" value={f.target_active_merchants} keyboardType="number-pad" onChangeText={(v) => setF({ ...f, target_active_merchants: v.replace(/\D/g, '') })} containerStyle={{ flex: 1, minWidth: 140 }} />
            </Row>
            <Row gap={8} style={{ flexWrap: 'wrap' }}>
              <Input label="PIC operasional" value={f.pic_ops} onChangeText={(v) => setF({ ...f, pic_ops: v })} placeholder="nama manajer ops" containerStyle={{ flex: 1, minWidth: 140 }} />
              <Input label="PIC keuangan" value={f.pic_finance} onChangeText={(v) => setF({ ...f, pic_finance: v })} placeholder="nama manajer keuangan" containerStyle={{ flex: 1, minWidth: 140 }} />
            </Row>
            <Input label="Catatan (opsional)" value={f.note} onChangeText={(v) => setF({ ...f, note: v })} />
            <RequirePerm perm={['ops', 'finance', 'settings']} fallback={<Text style={font.tiny}>Simpan target: izin ops/keuangan + PIN</Text>}>
              <Button title="Simpan target" icon="save-outline" loading={busy} onPress={save} />
            </RequirePerm>
          </View>
        </Panel>

        <Panel title={`Progres target & COGS per kota · ${mLabel}`} subtitle="Realisasi bulan berjalan vs target (pro-rata hari). COGS/order = Σ biaya tetap ÷ target order; rekomendasi biaya layanan = COGS/order × (1 + margin target), dibulatkan ke Rp500." icon="speedometer-outline" padded={false} style={{ flex: 2, minWidth: 360 }}>
          <View style={{ padding: adminSpace.md, paddingBottom: 0 }}><ErrorNote text={err} onRetry={load} /></View>
          <DataTable keyField="city_id" rows={rows as unknown as Record<string, unknown>[]} emptyText={loading ? 'Memuat…' : 'Belum ada target bulan ini — isi form di samping'} emptyIcon="flag-outline"
            onRowPress={(r) => fill(r as unknown as CityTargetProgress)}
            columns={[
              { key: 'city_name', label: 'Kota', width: 140, render: (r) => { const x = r as unknown as CityTargetProgress; return <View style={{ minWidth: 0, alignSelf: 'stretch' }}><Trunc style={font.bodyStrong} title={x.city_name}>{x.city_name || '—'}</Trunc><Text style={font.tiny} numberOfLines={1}>ops {x.pic_ops || '—'} · fin {x.pic_finance || '—'}</Text></View>; } },
              { key: 'status', label: 'Status', width: 110, render: (r) => { const st = T_STATUS[(r.status as CityTargetProgress['status'])] ?? T_STATUS.no_target; return <Pill text={st.label} tone={st.tone} />; } },
              { key: 'orders', label: 'Order real / target', width: 150, align: 'right', mono: true, render: (r) => <Text style={font.mono}>{Number(r.actual_orders ?? 0).toLocaleString('id-ID')} / {Number(r.target_orders ?? 0).toLocaleString('id-ID')}</Text> },
              { key: 'pct_orders', label: '% order', width: 90, align: 'right', mono: true, render: (r) => <Text style={[font.mono, { color: Number(r.pct_orders) >= Number(r.prorata_pct ?? 100) ? adminTone.green : adminTone.red }]}>{pctTxt(Number(r.pct_orders))}</Text> },
              { key: 'npr', label: 'NPR real / target', width: 210, align: 'right', mono: true, render: (r) => <Text style={font.mono} numberOfLines={1}>{rupiah(Number(r.actual_npr ?? 0))} / {rupiah(Number(r.target_npr ?? 0))}</Text> },
              pctCol('pct_npr', '% NPR', 84),
              { key: 'mitra', label: 'Driver · merchant aktif', width: 150, align: 'right', mono: true, render: (r) => <Text style={font.mono}>{Number(r.actual_active_drivers ?? 0)}/{Number(r.target_active_drivers ?? 0)} · {Number(r.actual_active_merchants ?? 0)}/{Number(r.target_active_merchants ?? 0)}</Text> },
              moneyCol('cogs_per_order', 'COGS/order (target)', 150, adminTone.orange),
              moneyCol('cogs_per_order_actual', 'COGS/order (real)', 150, (r) => (Number(r.cogs_per_order_actual) > Number(r.cogs_per_order) ? adminTone.red : adminTone.orange)),
              { key: 'platform_fee_recommended', label: 'Rekomendasi biaya layanan', width: 180, align: 'right', mono: true, render: fee },
            ]} />
          <View style={{ padding: adminSpace.md, gap: 6 }}><WideTableHint what="kolom COGS & rekomendasi" /><Text style={font.tiny}>Pro-rata hari: {rows[0]?.prorata_pct != null ? pctTxt(rows[0].prorata_pct) : '—'} dari bulan sudah berjalan. Sumber: city_targets_progress(p_month).</Text></View>
        </Panel>
      </Row>
    </>
  );
}
