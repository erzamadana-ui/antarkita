// Admin · Biaya Tetap Kota (Skema Bisnis v2, migrasi 0102/0103).
// Per bulan: rpc('admin_city_fixed_costs', { p_month }) → baris biaya per kota/kategori, total per kota,
// dan ringkasan EBITDA kota bulan itu (contribution dari order_ledger − biaya tetap).
// Tambah/ubah satu sel (kota, bulan, kategori) lewat rpc('admin_set_city_fixed_cost') (PIN + log city_cost.updated).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AdminPage, Panel, DataTable, StatCard, AdminSelect, Pill, adminFont as font, adminTone, adminSpace, adminRadius, adminIcon } from '@/components/admin';
import { FootNote } from '@/components/reports';
import { Row, Input, Button, toast } from '@/components/ui';
import { rpc, supabase } from '@/lib/supabase';
import { rupiah } from '@/lib/format';
import { handleAdminError, useAdminSecurity } from '@/store/adminSecurity';
import type { AdminCityFixedCosts, CityCostCategory } from '@/lib/types';
import { ErrorNote, fmtDate, moneyCol, countCol, pctCol, parseNum, Trunc, WideTableHint } from './_shared';

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
      ]} />
    </AdminPage>
  );
}

const st = StyleSheet.create({
  navBtn: { width: 34, height: 34, borderRadius: adminRadius.sm, borderWidth: 1, borderColor: adminTone.border, backgroundColor: adminTone.surface, alignItems: 'center', justifyContent: 'center' },
  month: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, height: 34, borderRadius: adminRadius.sm, borderWidth: 1, borderColor: adminTone.border, backgroundColor: adminTone.surface, minWidth: 180, justifyContent: 'center' },
});
