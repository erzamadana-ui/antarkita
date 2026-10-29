// Admin · KPI Manager Kota (migrasi 0118).
// Per bulan: rpc('admin_city_manager_kpi', { p_month, p_city }) → satu baris per kota (manager, target vs realisasi
// 5 komponen, skor, grade, bonus). Target & bobot disimpan lewat rpc('admin_set_city_manager_kpi', { p }) (PIN panel).
// Ringkasan atas dari rpc('city_manager_kpi_summary'). Penunjukan manager memakai admin_set_city_manager (0079).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AdminPage, Panel, DataTable, StatCard, AdminSelect, AdminDialog, Pill, RequirePerm, adminFont as font, adminTone, adminSpace, adminRadius, adminIcon } from '@/components/admin';
import { FootNote } from '@/components/reports';
import { Row, Input, Button, toast } from '@/components/ui';
import { rpc, supabase } from '@/lib/supabase';
import { rupiah } from '@/lib/format';
import { handleAdminError, useAdminSecurity } from '@/store/adminSecurity';
import type { AdminManagerOption } from '@/lib/types';
import { ErrorNote, parseNum, Trunc, WideTableHint } from './_shared';
import { confirmAsync } from '@/lib/mitra';
import {
  adminCityManagerKpi, adminSetCityManagerKpi, cityManagerKpiSummary, rankKpi,
  KPI_COMPONENTS, KPI_LABEL, KPI_DEFAULT_WEIGHTS, KPI_GRADE_RULE, GRADE_COLOR,
  type CityManagerKpiRow, type CityManagerKpiSummary, type KpiComponent, type KpiGrade,
} from '@/lib/kpiKota';

const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
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

type CityOpt = { id: string; name: string; province: string | null; service_status: string | null };
const n0 = (v: unknown) => Number(v ?? 0) || 0;
const pctTxt = (n: number | null | undefined) => `${Number(n ?? 0).toLocaleString('id-ID', { maximumFractionDigits: 0 })} %`;
const pctColor = (p: number) => (p >= 100 ? adminTone.green : p >= 80 ? adminTone.amber : adminTone.red);
const gradeOf = (g: string | null | undefined): KpiGrade | null => (g === 'A' || g === 'B' || g === 'C' || g === 'D' ? g : null);

/** Form target: semua angka disimpan sebagai string agar input tetap bebas diketik. */
type TargetForm = {
  city_id: string; target_merchant_new: string; target_driver_new: string; target_merchant_active: string; target_driver_active: string; target_orders: string;
  weight_merchant_new: string; weight_driver_new: string; weight_active: string; weight_orders: string; bonus_pool: string; note: string;
};
const emptyForm = (cityId = ''): TargetForm => ({
  city_id: cityId, target_merchant_new: '', target_driver_new: '', target_merchant_active: '', target_driver_active: '', target_orders: '',
  weight_merchant_new: String(KPI_DEFAULT_WEIGHTS.weight_merchant_new), weight_driver_new: String(KPI_DEFAULT_WEIGHTS.weight_driver_new),
  weight_active: String(KPI_DEFAULT_WEIGHTS.weight_active), weight_orders: String(KPI_DEFAULT_WEIGHTS.weight_orders), bonus_pool: '', note: '',
});
const formFromRow = (r: CityManagerKpiRow): TargetForm => ({
  city_id: r.city_id,
  target_merchant_new: r.has_target ? String(n0(r.targets?.merchant_new)) : '', target_driver_new: r.has_target ? String(n0(r.targets?.driver_new)) : '',
  target_merchant_active: r.has_target ? String(n0(r.targets?.merchant_active)) : '', target_driver_active: r.has_target ? String(n0(r.targets?.driver_active)) : '',
  target_orders: r.has_target ? String(n0(r.targets?.orders)) : '',
  weight_merchant_new: String(r.weights?.merchant_new ?? KPI_DEFAULT_WEIGHTS.weight_merchant_new), weight_driver_new: String(r.weights?.driver_new ?? KPI_DEFAULT_WEIGHTS.weight_driver_new),
  weight_active: String(r.weights?.active ?? KPI_DEFAULT_WEIGHTS.weight_active), weight_orders: String(r.weights?.orders ?? KPI_DEFAULT_WEIGHTS.weight_orders),
  bonus_pool: r.has_target ? String(n0(r.bonus_pool)) : '', note: '',
});

export default function AdminKpiKota() {
  const [month, setMonth] = useState(thisMonth());
  const [rows, setRows] = useState<CityManagerKpiRow[]>([]);
  const [summary, setSummary] = useState<CityManagerKpiSummary | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [cities, setCities] = useState<CityOpt[]>([]);
  const [managers, setManagers] = useState<AdminManagerOption[]>([]);
  const [filterCity, setFilterCity] = useState('');
  const [target, setTarget] = useState<TargetForm | null>(null);
  const [assign, setAssign] = useState<{ city_id: string; manager_id: string; note: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const maxMonth = shiftMonth(thisMonth(), 12);

  const load = useCallback(async () => {
    setLoading(true);
    const [list, sum] = await Promise.allSettled([adminCityManagerKpi(month, null), cityManagerKpiSummary(month)]);
    if (list.status === 'fulfilled') { setRows(list.value); setErr(null); } else { setRows([]); setErr(`KPI Manager Kota: ${(list.reason as Error).message}`); }
    setSummary(sum.status === 'fulfilled' ? sum.value : null);
    setLoading(false);
  }, [month]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    (async () => {
      const { data: c } = await supabase.from('cities').select('id,name,province,service_status').order('name');
      setCities((c as CityOpt[]) ?? []);
      try { const m = await rpc<AdminManagerOption[]>('admin_city_manager_options'); setManagers(Array.isArray(m) ? m : []); } catch { setManagers([]); }
    })();
  }, []);

  const cityOpts = useMemo(() => {
    const rank = (s: string | null) => (s === 'aktif' ? 0 : s === 'segera' ? 1 : 2);
    const base = cities.length ? cities : rows.map((r) => ({ id: r.city_id, name: r.city_name, province: null, service_status: null }));
    return [...base].sort((a, b) => rank(a.service_status) - rank(b.service_status) || a.name.localeCompare(b.name))
      .map((c) => ({ value: c.id, label: c.name, sublabel: c.province ? `${c.province} · ${c.service_status ?? '—'}` : undefined }));
  }, [cities, rows]);
  const cityName = (id: string) => cityOpts.find((c) => c.value === id)?.label ?? rows.find((r) => r.city_id === id)?.city_name ?? id;
  const managerOpts = useMemo(() => managers.map((m) => ({ value: m.id, label: m.name ?? '(tanpa nama)', sublabel: m.phone ?? undefined })), [managers]);

  const ranked = useMemo(() => rankKpi(rows).filter((r) => !filterCity || r.city_id === filterCity), [rows, filterCity]);
  // Ringkasan dari city_manager_kpi_summary; bila RPC itu gagal, dihitung dari baris (nilai sama karena sumber sama).
  const scored = rows.filter((r) => r.has_target && r.score != null);
  const grades = summary?.grades ?? rows.reduce((a, r) => { const g = gradeOf(r.grade); if (g) a[g] = (a[g] ?? 0) + 1; return a; }, {} as Partial<Record<KpiGrade, number>>);
  const withTarget = summary?.cities_with_target ?? rows.filter((r) => r.has_target).length;
  const withManager = summary?.cities_with_manager ?? rows.filter((r) => !!r.manager_id).length;
  const avgScore = summary?.avg_score ?? (scored.length ? scored.reduce((a, r) => a + n0(r.score), 0) / scored.length : null);
  const totalBonus = summary?.total_bonus_earned ?? rows.reduce((a, r) => a + n0(r.bonus_earned), 0);
  const totalPool = summary?.total_bonus_pool ?? rows.reduce((a, r) => a + n0(r.bonus_pool), 0);

  const saveTarget = async () => {
    if (!target) return;
    if (!target.city_id) return toast.error('Pilih kota');
    const t = {
      target_merchant_new: parseNum(target.target_merchant_new), target_driver_new: parseNum(target.target_driver_new), target_merchant_active: parseNum(target.target_merchant_active),
      target_driver_active: parseNum(target.target_driver_active), target_orders: parseNum(target.target_orders),
    };
    for (const [k, v] of Object.entries(t)) if (!Number.isInteger(v) || v < 0 || v > 10_000_000) return toast.error(`${k.replace('target_', 'Target ')} harus bilangan bulat 0–10 juta`);
    const w = { weight_merchant_new: parseNum(target.weight_merchant_new), weight_driver_new: parseNum(target.weight_driver_new), weight_active: parseNum(target.weight_active), weight_orders: parseNum(target.weight_orders) };
    for (const v of Object.values(w)) if (!Number.isFinite(v) || v < 0 || v > 100) return toast.error('Bobot harus angka 0–100');
    const wsum = Object.values(w).reduce((a, b) => a + b, 0);
    if (Math.round(wsum) !== 100) return toast.error(`Jumlah bobot harus 100 (sekarang ${wsum})`);
    const bonus = parseNum(target.bonus_pool);
    if (!Number.isInteger(bonus) || bonus < 0 || bonus > 1_000_000_000) return toast.error('Bonus pool harus bilangan bulat Rp0–Rp1 miliar');
    if (month < MIN_MONTH || month > maxMonth) return toast.error('Bulan di luar rentang (Jan 2024 s.d. 12 bulan ke depan)');
    const name = cityName(target.city_id);
    if (!(await confirmAsync(`Simpan target KPI ${name} ${monthLabel(month)}?`, `${t.target_merchant_new} merchant baru · ${t.target_driver_new} driver baru · ${t.target_merchant_active} merchant aktif · ${t.target_driver_active} driver aktif · ${t.target_orders} order · bonus pool ${rupiah(bonus)}. Menimpa target bulan yang sama.`, 'Ya, simpan'))) return;
    if (!(await useAdminSecurity.getState().ensureUnlocked())) return;
    setBusy(true);
    try {
      await adminSetCityManagerKpi({ city_id: target.city_id, month, ...t, ...w, bonus_pool: bonus, note: target.note.trim() || null });
      toast.success(`Target KPI ${name} ${monthLabel(month)} disimpan`); setTarget(null); await load();
    } catch (e) { handleAdminError(e); } finally { setBusy(false); }
  };

  const saveManager = async (clear = false) => {
    if (!assign) return;
    if (!clear && !assign.manager_id) return toast.error('Pilih admin yang ditunjuk');
    if (!(await useAdminSecurity.getState().ensureUnlocked())) return;
    setBusy(true);
    try {
      await rpc('admin_set_city_manager', { p_city_id: assign.city_id, p_manager_id: clear ? null : assign.manager_id, p_note: assign.note.trim() || null });
      toast.success(clear ? `Manager ${cityName(assign.city_id)} dicabut` : `Manager ${cityName(assign.city_id)} ditunjuk`); setAssign(null); await load();
    } catch (e) { handleAdminError(e); } finally { setBusy(false); }
  };

  const compCol = (k: KpiComponent) => ({
    key: k, label: KPI_LABEL[k], width: 150, align: 'right' as const, mono: true,
    render: (r: Record<string, unknown>) => {
      const x = r as unknown as CityManagerKpiRow;
      if (!x.has_target) return <Text style={[font.mono, { color: adminTone.faint }]}>{n0(x.actual?.[k]).toLocaleString('id-ID')} / —</Text>;
      const p = x.pct?.[k];   // null = target komponen 0 → dilewati dari skor
      return (
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={font.mono}>{n0(x.actual?.[k]).toLocaleString('id-ID')} / {n0(x.targets?.[k]).toLocaleString('id-ID')}</Text>
          {p == null ? <Text style={font.tiny}>tanpa target</Text> : <Text style={[font.tiny, { color: pctColor(Number(p)), fontWeight: '700' }]}>{pctTxt(Number(p))}</Text>}
        </View>
      );
    },
  });

  return (
    <AdminPage title="KPI Manager Kota" subtitle="Target bulanan per kota (merchant & driver baru, merchant & driver aktif, order) vs realisasi → skor, grade A–D, dan bonus manager. Menyimpan butuh PIN panel." onRefresh={load}
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
        <AdminSelect size="sm" value={filterCity} options={cityOpts} placeholder="Semua kota" clearable clearLabel="Semua kota" searchable onChange={setFilterCity} width={220} />
        {loading ? <Text style={font.tiny}>Memuat…</Text> : null}
      </Row>

      <ErrorNote text={err} onRetry={load} />

      <Row gap={adminSpace.md} style={{ flexWrap: 'wrap' }}>
        <StatCard index={0} icon="flag-outline" label="Kota bertarget" value={withTarget} hint={`dari ${summary?.cities_total ?? rows.length} kota dinilai · ${withManager} punya manager`} color={adminTone.blue} />
        <StatCard index={1} icon="speedometer-outline" label="Rata-rata skor" value={avgScore == null ? '—' : `${Number(avgScore).toLocaleString('id-ID', { maximumFractionDigits: 1 })}`} hint="skor 0–120 berbobot dari 5 komponen (capaian dibatasi 120 %)" color={avgScore == null ? adminTone.slate : avgScore >= 80 ? adminTone.green : avgScore >= 60 ? adminTone.amber : adminTone.red} />
        <StatCard index={2} icon="cash-outline" label="Total bonus diraih" value={rupiah(totalBonus)} hint={`pool ${rupiah(totalPool)} · pool × skor/100 bila skor ≥ 60`} color={adminTone.teal} />
        <StatCard index={3} icon="ribbon-outline" label="Sebaran grade" value={(['A', 'B', 'C', 'D'] as KpiGrade[]).map((g) => `${g}${grades?.[g] ?? 0}`).join(' · ')} hint={`${KPI_GRADE_RULE} (migrasi 0118)`} color={adminTone.violet} />
      </Row>

      <Panel title={`KPI per kota · ${monthLabel(month)}`} subtitle="Realisasi / target per komponen dengan persen capaian. Skor = Σ bobot × min(capaian, 120 %) ÷ Σ bobot (komponen bertarget 0 dilewati). Klik Atur target untuk mengisi; Tunjuk manager mengubah penanggung jawab kota (admin aktif)." icon="podium-outline" padded={false}
        right={<RequirePerm perm={['city', 'ops', 'settings']} fallback={<Text style={font.tiny}>Atur target: izin city (ops) + PIN</Text>}><Button size="sm" title="Atur target" icon="create-outline" onPress={() => setTarget(emptyForm(filterCity))} /></RequirePerm>}>
        <DataTable keyField="city_id" rows={ranked as unknown as Record<string, unknown>[]} emptyText={loading ? 'Memuat…' : err ? 'Tidak bisa membaca KPI — periksa koneksi/izin' : 'Belum ada kota pada bulan ini'} emptyIcon="podium-outline"
          columns={[
            { key: 'city_name', label: 'Kota · manager', width: 190, render: (r) => { const x = r as unknown as CityManagerKpiRow; return <View style={{ minWidth: 0, alignSelf: 'stretch' }}><Trunc style={font.bodyStrong} title={x.city_name}>{x.city_name || '—'}</Trunc><Trunc style={font.tiny} title={x.manager_name ?? ''}>{x.manager_name ? x.manager_name : 'belum ada manager'}</Trunc></View>; } },
            { key: 'grade', label: 'Grade', width: 80, align: 'center', render: (r) => { const g = gradeOf((r as unknown as CityManagerKpiRow).grade); return g ? <View style={[st.grade, { backgroundColor: GRADE_COLOR[g] }]}><Text style={st.gradeTxt}>{g}</Text></View> : <Pill text="—" tone="off" />; } },
            { key: 'score', label: 'Skor', width: 80, align: 'right', mono: true, render: (r) => { const x = r as unknown as CityManagerKpiRow; return <Text style={[font.mono, { fontWeight: '700', color: x.has_target ? adminTone.ink : adminTone.faint }]}>{x.has_target ? Number(x.score ?? 0).toLocaleString('id-ID', { maximumFractionDigits: 1 }) : '—'}</Text>; } },
            ...KPI_COMPONENTS.map(compCol),
            { key: 'bonus', label: 'Bonus diraih / pool', width: 190, align: 'right', mono: true, render: (r) => { const x = r as unknown as CityManagerKpiRow; return x.has_target ? <View style={{ alignItems: 'flex-end' }}><Text style={[font.mono, { color: adminTone.teal, fontWeight: '700' }]}>{rupiah(n0(x.bonus_earned))}</Text><Text style={font.tiny}>pool {rupiah(n0(x.bonus_pool))}</Text></View> : <Pill text="Tanpa target" tone="off" />; } },
            { key: 'actions', label: 'Aksi', width: 250, align: 'right', render: (r) => { const x = r as unknown as CityManagerKpiRow; return (
              <RequirePerm perm={['city', 'ops', 'settings']} fallback={<Text style={font.tiny}>izin city (ops)</Text>}>
                <Row gap={6} style={{ justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                  <Button size="sm" variant="secondary" title="Atur target" icon="create-outline" onPress={() => setTarget(formFromRow(x))} />
                  <Button size="sm" variant="outline" title="Tunjuk manager" icon="person-outline" onPress={() => setAssign({ city_id: x.city_id, manager_id: x.manager_id ?? '', note: '' })} />
                </Row>
              </RequirePerm>
            ); } },
          ]} />
        <View style={{ padding: adminSpace.md, gap: 6 }}><WideTableHint what="kolom bonus & Aksi" /></View>
      </Panel>

      <AdminDialog visible={!!target} onClose={() => (busy ? undefined : setTarget(null))} title={`Atur target KPI · ${monthLabel(month)}`} width={640}
        subtitle="Lima komponen target bulanan + bobot (jumlah 100) + bonus pool. Bonus diraih = pool × faktor grade (server). Butuh PIN panel; tercatat di log aktivitas.">
        {target ? (
          <View style={{ gap: 10 }}>
            <AdminSelect label="Kota" width="100%" value={target.city_id} options={cityOpts} placeholder="Pilih kota…" searchable onChange={(v) => { const row = rows.find((r) => r.city_id === v); setTarget(row ? formFromRow(row) : { ...target, city_id: v }); }} />
            <Row gap={8} style={{ flexWrap: 'wrap' }}>
              <Input label="Target merchant baru" value={target.target_merchant_new} keyboardType="number-pad" onChangeText={(v) => setTarget({ ...target, target_merchant_new: v.replace(/\D/g, '') })} containerStyle={{ flex: 1, minWidth: 140 }} />
              <Input label="Target driver baru" value={target.target_driver_new} keyboardType="number-pad" onChangeText={(v) => setTarget({ ...target, target_driver_new: v.replace(/\D/g, '') })} containerStyle={{ flex: 1, minWidth: 140 }} />
            </Row>
            <Row gap={8} style={{ flexWrap: 'wrap' }}>
              <Input label="Target merchant aktif" value={target.target_merchant_active} keyboardType="number-pad" onChangeText={(v) => setTarget({ ...target, target_merchant_active: v.replace(/\D/g, '') })} containerStyle={{ flex: 1, minWidth: 140 }} />
              <Input label="Target driver aktif" value={target.target_driver_active} keyboardType="number-pad" onChangeText={(v) => setTarget({ ...target, target_driver_active: v.replace(/\D/g, '') })} containerStyle={{ flex: 1, minWidth: 140 }} />
              <Input label="Target order selesai" value={target.target_orders} keyboardType="number-pad" onChangeText={(v) => setTarget({ ...target, target_orders: v.replace(/\D/g, '') })} containerStyle={{ flex: 1, minWidth: 140 }} />
            </Row>
            <Text style={font.label}>Bobot skor (jumlah harus 100)</Text>
            <Row gap={8} style={{ flexWrap: 'wrap' }}>
              <Input label="Merchant baru %" value={target.weight_merchant_new} keyboardType="number-pad" onChangeText={(v) => setTarget({ ...target, weight_merchant_new: v.replace(/\D/g, '') })} containerStyle={{ flex: 1, minWidth: 110 }} />
              <Input label="Driver baru %" value={target.weight_driver_new} keyboardType="number-pad" onChangeText={(v) => setTarget({ ...target, weight_driver_new: v.replace(/\D/g, '') })} containerStyle={{ flex: 1, minWidth: 110 }} />
              <Input label="Mitra aktif %" value={target.weight_active} keyboardType="number-pad" onChangeText={(v) => setTarget({ ...target, weight_active: v.replace(/\D/g, '') })} containerStyle={{ flex: 1, minWidth: 110 }} />
              <Input label="Order %" value={target.weight_orders} keyboardType="number-pad" onChangeText={(v) => setTarget({ ...target, weight_orders: v.replace(/\D/g, '') })} containerStyle={{ flex: 1, minWidth: 110 }} />
            </Row>
            <Row gap={8} style={{ flexWrap: 'wrap' }}>
              <Input label="Bonus pool (Rp / bulan)" value={target.bonus_pool} keyboardType="number-pad" onChangeText={(v) => setTarget({ ...target, bonus_pool: v.replace(/\D/g, '') })} containerStyle={{ flex: 1, minWidth: 160 }} />
              <Input label="Catatan (opsional)" value={target.note} onChangeText={(v) => setTarget({ ...target, note: v })} placeholder="mis. fokus akuisisi merchant kuliner" containerStyle={{ flex: 2, minWidth: 200 }} />
            </Row>
            <Row gap={8} style={{ justifyContent: 'flex-end' }}>
              <Button size="sm" variant="ghost" title="Batal" disabled={busy} onPress={() => setTarget(null)} />
              <Button size="sm" title="Simpan target" icon="save-outline" loading={busy} onPress={saveTarget} />
            </Row>
          </View>
        ) : null}
      </AdminDialog>

      <AdminDialog visible={!!assign} onClose={() => (busy ? undefined : setAssign(null))} title={`Tunjuk manager · ${assign ? cityName(assign.city_id) : ''}`} width={520}
        subtitle="Manager kota = admin aktif penanggung jawab rekrutmen mitra dan mutu layanan setempat. Disimpan lewat admin_set_city_manager (tercatat di log city.manager).">
        {assign ? (
          <View style={{ gap: 10 }}>
            <AdminSelect label="Pengguna admin" icon="person-outline" width="100%" placeholder="Pilih admin" value={assign.manager_id} options={managerOpts} searchable onChange={(v) => setAssign({ ...assign, manager_id: v })} helper={managerOpts.length ? undefined : 'Daftar admin kosong — periksa izin admin_city_manager_options'} />
            <Input label="Catatan (opsional)" value={assign.note} onChangeText={(v) => setAssign({ ...assign, note: v })} placeholder="mis. mulai 1 November" />
            <Row gap={8} style={{ justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <Button size="sm" variant="ghost" title="Batal" disabled={busy} onPress={() => setAssign(null)} />
              <Button size="sm" variant="danger" title="Cabut manager" icon="person-remove-outline" disabled={busy} onPress={() => saveManager(true)} />
              <Button size="sm" title="Simpan" icon="checkmark-outline" loading={busy} onPress={() => saveManager(false)} />
            </Row>
          </View>
        ) : null}
      </AdminDialog>

      <FootNote lines={[
        'Komponen KPI (0118): merchant baru & driver baru = status approved dengan created_at di bulan itu, kota dari lokasi terdekat (entity_city) [ASUMSI server: created_at = tanggal bergabung]; merchant aktif & driver aktif = ≥1 order selesai bulan itu di kota; order = order selesai di kota (orders.city_id).',
        `Skor = Σ bobot × min(capaian, 120 %) ÷ Σ bobot komponen bertarget; komponen "mitra aktif" = rata-rata capaian merchant & driver aktif. Grade ${KPI_GRADE_RULE}. Bonus diraih = bonus_pool × min(skor,120)/100 bila skor ≥ 60, selain itu 0 [ASUMSI skema bonus di 0118 — menunggu keputusan GM].`,
        'Kota yang dinilai: aktif dan (service_status aktif, atau punya manager, atau punya target bulan itu). Pembayaran bonus tidak otomatis — tetap lewat keputusan GM/Direksi dan payroll.',
        'Penunjukan manager dicatat di Log Aktivitas (city.manager); perubahan target dicatat oleh admin_set_city_manager_kpi.',
      ]} />
    </AdminPage>
  );
}

const st = StyleSheet.create({
  navBtn: { width: 34, height: 34, borderRadius: adminRadius.sm, borderWidth: 1, borderColor: adminTone.border, backgroundColor: adminTone.surface, alignItems: 'center', justifyContent: 'center' },
  month: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, height: 34, borderRadius: adminRadius.sm, borderWidth: 1, borderColor: adminTone.border, backgroundColor: adminTone.surface, minWidth: 180, justifyContent: 'center' },
  grade: { width: 32, height: 32, borderRadius: adminRadius.sm, alignItems: 'center', justifyContent: 'center' },
  gradeTxt: { color: '#fff', fontSize: 15, fontWeight: '800', lineHeight: 20 },
});
