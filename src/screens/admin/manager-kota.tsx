// Admin · Manager Kota (migrasi 0125, keputusan GM 2 & 9).
// Tabel rpc('admin_city_managers') → profil manager per kota (nama, HP, email, akun tertaut, gaji dasar, mulai, status, tier,
// bulan ke-n, skor KPI bulan ini). Tambah/ubah lewat rpc('admin_set_city_manager_profile', { p }) (izin city + PIN),
// hapus lewat rpc('admin_city_manager_delete'), "Terapkan template target bulan ini" → rpc('admin_kpi_apply_template').
// Panel kedua: template target per tier × bulan ke-1..6 (admin_kpi_target_templates / admin_set_kpi_target_template).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { AdminPage, Panel, DataTable, StatCard, AdminSelect, AdminDialog, Pill, RequirePerm, FilterBar, adminFont as font, adminTone, adminSpace, adminRadius } from '@/components/admin';
import { FootNote } from '@/components/reports';
import { Row, Input, Button, toast } from '@/components/ui';
import { rpc, supabase } from '@/lib/supabase';
import { rupiah } from '@/lib/format';
import { handleAdminError, useAdminSecurity } from '@/store/adminSecurity';
import type { AdminManagerOption } from '@/lib/types';
import { confirmAsync } from '@/lib/mitra';
import { GRADE_COLOR, type KpiGrade } from '@/lib/kpiKota';
import { ErrorNote, fmtDate, parseNum, Trunc, WideTableHint } from './_shared';
import {
  adminCityManagers, adminSetCityManagerProfile, adminCityManagerDelete, adminKpiApplyTemplate, adminKpiTargetTemplates, adminSetKpiTargetTemplate,
  CITY_MANAGER_STATUS, CITY_TIERS, CITY_MANAGER_SALARY_DEFAULT, cityManagerStatusMeta, TEMPLATE_TARGET_KEYS, TEMPLATE_WEIGHT_KEYS, TEMPLATE_KEY_LABEL,
  type CityManagerRow, type CityManagerStatus, type KpiTargetTemplate, type TemplateNumKey,
} from '@/lib/admin31';

type CityOpt = { id: string; name: string; province: string | null; service_status: string | null };
const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const pad = (n: number) => String(n).padStart(2, '0');
const thisMonth = () => { const t = new Date(Date.now() + 7 * 3600000); return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-01`; };
const monthLabel = (m: string) => { const [y, mo] = m.split('-').map(Number); return `${BULAN[mo - 1] ?? mo} ${y}`; };
const n0 = (v: unknown) => Number(v ?? 0) || 0;
const gradeOf = (g: string | null | undefined): KpiGrade | null => (g === 'A' || g === 'B' || g === 'C' || g === 'D' ? g : null);
const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

type ManagerForm = {
  id: string | null; city_id: string; full_name: string; phone: string; email: string; profile_id: string;
  salary_base: string; start_date: string; status: CityManagerStatus; tier: string; note: string;
};
const emptyForm = (): ManagerForm => ({ id: null, city_id: '', full_name: '', phone: '', email: '', profile_id: '', salary_base: String(CITY_MANAGER_SALARY_DEFAULT), start_date: '', status: 'kandidat', tier: '2', note: '' });
const formFromRow = (r: CityManagerRow): ManagerForm => ({
  id: r.id, city_id: r.city_id, full_name: r.full_name ?? '', phone: r.phone ?? '', email: r.email ?? '', profile_id: r.profile_id ?? '',
  salary_base: String(n0(r.salary_base)), start_date: r.start_date ? String(r.start_date).slice(0, 10) : '', status: r.status, tier: String(r.tier ?? 2), note: r.note ?? '',
});

export default function AdminManagerKota() {
  const router = useRouter();
  const [rows, setRows] = useState<CityManagerRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [cities, setCities] = useState<CityOpt[]>([]);
  const [admins, setAdmins] = useState<AdminManagerOption[]>([]);
  const [filter, setFilter] = useState('all');
  const [form, setForm] = useState<ManagerForm | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const month = thisMonth();

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await adminCityManagers()); setErr(null); }
    catch (e) { setRows([]); setErr(`Manager Kota: ${(e as Error).message}`); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    (async () => {
      const { data: c } = await supabase.from('cities').select('id,name,province,service_status').order('name');
      setCities((c as CityOpt[]) ?? []);
      try { const m = await rpc<AdminManagerOption[]>('admin_city_manager_options'); setAdmins(Array.isArray(m) ? m : []); } catch { setAdmins([]); }
    })();
  }, []);

  const cityOpts = useMemo(() => {
    const rank = (s: string | null) => (s === 'aktif' ? 0 : s === 'segera' ? 1 : 2);
    return [...cities].sort((a, b) => rank(a.service_status) - rank(b.service_status) || a.name.localeCompare(b.name))
      .map((c) => ({ value: c.id, label: c.name, sublabel: `${c.province ?? '—'} · ${c.service_status ?? '—'}${rows.some((r) => r.city_id === c.id) ? ' · sudah ada manager' : ''}` }));
  }, [cities, rows]);
  const cityName = (id: string) => cityOpts.find((c) => c.value === id)?.label ?? rows.find((r) => r.city_id === id)?.city_name ?? id;
  const adminOpts = useMemo(() => admins.map((m) => ({ value: m.id, label: m.name ?? '(tanpa nama)', sublabel: m.phone ?? m.id })), [admins]);

  const visible = useMemo(() => rows.filter((r) => filter === 'all' || r.status === filter), [rows, filter]);
  const nAktif = rows.filter((r) => r.status === 'aktif').length, nKandidat = rows.filter((r) => r.status === 'kandidat').length;
  const gajiAktif = rows.filter((r) => r.status === 'aktif').reduce((a, r) => a + n0(r.salary_base), 0);
  const tanpaTarget = rows.filter((r) => r.status === 'aktif' && !r.has_target_this_month).length;
  const unsynced = rows.filter((r) => r.status === 'aktif' && r.profile_id && !r.city_manager_id_synced).length;

  const save = async () => {
    if (!form) return;
    if (!form.city_id) return toast.error('Pilih kota');
    if (form.full_name.trim().length < 3) return toast.error('Nama manager minimal 3 huruf');
    if (form.phone.trim() && !/^(\+62|0)8[0-9]{7,13}$/.test(form.phone.trim())) return toast.error('Nomor HP tidak valid (08xx / +628xx)');
    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return toast.error('Format email tidak valid');
    const salary = parseNum(form.salary_base);
    if (!Number.isInteger(salary) || salary < 0 || salary > 1_000_000_000) return toast.error('Gaji dasar harus bilangan bulat Rp0–Rp1 miliar');
    if (form.start_date && !/^\d{4}-\d{2}-\d{2}$/.test(form.start_date)) return toast.error('Tanggal mulai harus YYYY-MM-DD');
    const profile = form.profile_id.trim();
    if (profile && !isUuid(profile)) return toast.error('Akun tertaut harus dipilih dari daftar atau berupa UUID profil');
    if (form.status === 'aktif' && !profile) return toast.error('Manager aktif wajib punya akun aplikasi (akun tertaut)');
    const tier = Number(form.tier);
    if (![1, 2, 3].includes(tier)) return toast.error('Tier harus 1–3');
    if (!(await useAdminSecurity.getState().ensureUnlocked())) return;
    setBusy('save');
    try {
      await adminSetCityManagerProfile({
        id: form.id, city_id: form.city_id, full_name: form.full_name.trim(), phone: form.phone.trim() || null, email: form.email.trim() || null,
        profile_id: profile || null, salary_base: salary, start_date: form.start_date || null, status: form.status, tier, note: form.note.trim() || null,
      });
      toast.success(`Manager Kota ${cityName(form.city_id)} disimpan`); setForm(null); await load();
    } catch (e) { handleAdminError(e); } finally { setBusy(null); }
  };
  const remove = async (r: CityManagerRow) => {
    if (!(await confirmAsync(`Hapus data manager ${r.city_name}?`, `${r.full_name} (${cityManagerStatusMeta(r.status).label}) dihapus dari daftar Manager Kota. Bila akunnya tertaut, cities.manager_id ikut dikosongkan. Target KPI yang sudah ada tidak dihapus.`, 'Ya, hapus'))) return;
    if (!(await useAdminSecurity.getState().ensureUnlocked())) return;
    setBusy(`del:${r.id}`);
    try { await adminCityManagerDelete(r.id); toast.success(`Manager ${r.city_name} dihapus`); await load(); }
    catch (e) { handleAdminError(e); } finally { setBusy(null); }
  };
  const applyTemplate = async (r: CityManagerRow) => {
    const mn = r.month_no == null ? 1 : Math.min(6, r.month_no);
    if (!(await confirmAsync(`Terapkan template target ${r.city_name} · ${monthLabel(month)}?`, `Template tier ${r.tier} bulan ke-${mn} akan ditulis sebagai target KPI kota ini${r.has_target_this_month ? ' — MENIMPA target bulan ini yang sudah ada' : ''}. Butuh PIN panel; tercatat di log.`, 'Ya, terapkan'))) return;
    if (!(await useAdminSecurity.getState().ensureUnlocked())) return;
    setBusy(`tpl:${r.id}`);
    try {
      const res = await adminKpiApplyTemplate(r.city_id, month);
      toast.success(`Target ${r.city_name} ${monthLabel(month)} diisi dari template tier ${res?.template?.tier ?? r.tier} bulan ke-${res?.template?.month_no ?? mn}`); await load();
    } catch (e) {
      const m = String((e as Error).message ?? '');
      if (/KPI_TEMPLATE_BEFORE_START/.test(m)) toast.error('Bulan ini sebelum tanggal mulai manager — ubah tanggal mulai dulu');
      else if (/KPI_TEMPLATE_MISSING/.test(m)) toast.error('Template tier/bulan itu belum ada — isi di panel Template target');
      else handleAdminError(e);
    } finally { setBusy(null); }
  };

  const statusFilters = [{ key: 'all', label: `Semua (${rows.length})` }, ...CITY_MANAGER_STATUS.map((s) => ({ key: s.value, label: `${s.label} (${rows.filter((r) => r.status === s.value).length})` }))];

  return (
    <AdminPage title="Manager Kota" subtitle="Profil Manager Kota per kota: kandidat → aktif, gaji dasar (default Rp15 jt, keputusan GM), tier kota, dan bulan ke-n program. Akun aktif yang tertaut otomatis menjadi penanggung jawab KPI kota. Menyimpan butuh PIN panel." onRefresh={load}
      right={<Row gap={8} style={{ flexWrap: 'wrap' }}>
        <Button size="sm" variant="outline" title="KPI Manager Kota" icon="podium-outline" onPress={() => router.push('/(admin)/kpi-kota' as never)} />
        <Button size="sm" variant="outline" title="Segarkan" icon="refresh-outline" onPress={load} />
      </Row>}>
      <ErrorNote text={err} onRetry={load} />

      <Row gap={adminSpace.md} style={{ flexWrap: 'wrap' }}>
        <StatCard index={0} icon="people-outline" label="Manager aktif" value={nAktif} hint={`${nKandidat} kandidat · ${rows.filter((r) => r.status === 'nonaktif').length} nonaktif`} color={adminTone.green} />
        <StatCard index={1} icon="cash-outline" label="Gaji dasar / bulan (aktif)" value={rupiah(gajiAktif)} hint={nAktif ? `rata-rata ${rupiah(Math.round(gajiAktif / nAktif))} · setelan city_manager_salary_default` : 'belum ada manager aktif'} color={adminTone.teal} />
        <StatCard index={2} icon="flag-outline" label={`Tanpa target · ${monthLabel(month)}`} value={tanpaTarget} hint={tanpaTarget ? 'manager aktif belum punya target KPI bulan ini — terapkan template' : 'semua manager aktif sudah bertarget'} color={tanpaTarget ? adminTone.amber : adminTone.green} />
        <StatCard index={3} icon="link-outline" label="Akun belum tersinkron" value={unsynced} hint={unsynced ? 'cities.manager_id ≠ profile_id — simpan ulang baris untuk memicu trigger' : 'cities.manager_id selaras (trigger 0125)'} color={unsynced ? adminTone.red : adminTone.slate} />
      </Row>

      <Panel title={`Daftar Manager Kota (${visible.length})`} subtitle="Urutan: aktif → kandidat → nonaktif. Skor KPI = bulan berjalan (city_manager_kpi_calc). Klik Ubah untuk mengedit; Terapkan template mengisi target KPI bulan ini sesuai tier & bulan ke-n." icon="people-outline" padded={false}
        right={<Row gap={6} style={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <FilterBar options={statusFilters} value={filter} onChange={setFilter} />
          <RequirePerm perm={['city', 'ops']} fallback={<Text style={font.tiny}>Tambah: izin city (ops) + PIN</Text>}><Button size="sm" title="Tambah manager" icon="person-add-outline" onPress={() => setForm(emptyForm())} /></RequirePerm>
        </Row>}>
        <DataTable keyField="id" rows={visible as unknown as Record<string, unknown>[]} emptyText={loading ? 'Memuat…' : err ? 'Tidak bisa membaca daftar — periksa koneksi/izin (view)' : 'Belum ada Manager Kota — tambah dari tombol di kanan atas'} emptyIcon="people-outline"
          columns={[
            { key: 'city_name', label: 'Kota', width: 150, render: (r) => { const x = r as unknown as CityManagerRow; return <View style={{ minWidth: 0, alignSelf: 'stretch' }}><Trunc style={font.bodyStrong} title={x.city_name}>{x.city_name}</Trunc><Text style={font.tiny} numberOfLines={1}>{x.province ?? '—'} · {x.service_status ?? '—'}</Text></View>; } },
            { key: 'full_name', label: 'Manager', width: 200, render: (r) => { const x = r as unknown as CityManagerRow; return <View style={{ minWidth: 0, alignSelf: 'stretch' }}><Trunc style={font.bodyStrong} title={x.full_name}>{x.full_name}</Trunc><Trunc style={font.tiny} title={`${x.phone ?? ''} ${x.email ?? ''}`}>{x.phone || '—'}{x.email ? ` · ${x.email}` : ''}</Trunc></View>; } },
            { key: 'profile_id', label: 'Akun tertaut', width: 170, render: (r) => { const x = r as unknown as CityManagerRow; if (!x.profile_id) return <Pill text="belum tertaut" tone="off" />; return <View style={{ minWidth: 0, alignSelf: 'stretch', gap: 2 }}><Trunc style={font.small} title={x.profile_id}>{x.profile_name || x.profile_id.slice(0, 8)}{x.profile_role ? ` · ${x.profile_role}` : ''}</Trunc>{x.status === 'aktif' ? <Pill text={x.city_manager_id_synced ? 'sinkron ke kota' : 'belum sinkron'} tone={x.city_manager_id_synced ? 'ok' : 'bad'} /> : null}</View>; } },
            { key: 'status', label: 'Status', width: 110, render: (r) => { const m = cityManagerStatusMeta((r as unknown as CityManagerRow).status); return <Pill text={m.label} tone={m.tone} />; } },
            { key: 'tier', label: 'Tier', width: 70, align: 'center', render: (r) => <Pill text={`T${(r as unknown as CityManagerRow).tier}`} tone="info" /> },
            { key: 'salary_base', label: 'Gaji dasar', width: 130, align: 'right', mono: true, render: (r) => <Text style={font.mono}>{rupiah(n0(r.salary_base))}</Text> },
            { key: 'start_date', label: 'Mulai · bulan ke-', width: 150, render: (r) => { const x = r as unknown as CityManagerRow; return <View style={{ minWidth: 0 }}><Text style={font.small}>{x.start_date ? fmtDate(x.start_date, false) : '—'}</Text><Text style={font.tiny}>{x.month_no == null ? 'bulan ke-1 (tanpa tanggal mulai)' : `bulan ke-${x.month_no}${x.month_no > 6 ? ' (template bulan 6)' : ''}`}</Text></View>; } },
            { key: 'kpi', label: `KPI ${monthLabel(month).split(' ')[0]}`, width: 120, align: 'right', render: (r) => { const x = r as unknown as CityManagerRow; const g = gradeOf(x.kpi_grade); if (!x.has_target_this_month) return <Pill text="tanpa target" tone="wait" />; return <Row gap={6} style={{ justifyContent: 'flex-end' }}>{g ? <View style={[st.grade, { backgroundColor: GRADE_COLOR[g] }]}><Text style={st.gradeTxt}>{g}</Text></View> : null}<Text style={[font.mono, { fontWeight: '700' }]}>{x.kpi == null ? '—' : Number(x.kpi).toLocaleString('id-ID', { maximumFractionDigits: 1 })}</Text></Row>; } },
            { key: 'actions', label: 'Aksi', width: 330, align: 'right', render: (r) => { const x = r as unknown as CityManagerRow; return (
              <RequirePerm perm={['city', 'ops']} fallback={<Text style={font.tiny}>izin city (ops)</Text>}>
                <Row gap={6} style={{ justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                  <Button size="sm" variant="secondary" title="Ubah" icon="create-outline" disabled={busy !== null} onPress={() => setForm(formFromRow(x))} />
                  <Button size="sm" variant="outline" title="Terapkan template" icon="flag-outline" loading={busy === `tpl:${x.id}`} disabled={busy !== null} onPress={() => applyTemplate(x)} />
                  <Button size="sm" variant="danger" title="Hapus" icon="trash-outline" loading={busy === `del:${x.id}`} disabled={busy !== null} onPress={() => remove(x)} />
                </Row>
              </RequirePerm>
            ); } },
          ]} />
        <View style={{ padding: adminSpace.md, gap: 6 }}><WideTableHint what="kolom KPI & Aksi" /></View>
      </Panel>

      <TemplatePanel />

      <AdminDialog visible={!!form} onClose={() => (busy ? undefined : setForm(null))} title={form?.id ? `Ubah Manager Kota · ${cityName(form.city_id)}` : 'Tambah Manager Kota'} width={680}
        subtitle="Satu kota satu manager. Status aktif wajib punya akun aplikasi (akun tertaut) — trigger server menyalin akun itu ke cities.manager_id agar KPI 0118 terbaca di aplikasi manager. Butuh PIN panel.">
        {form ? (
          <View style={{ gap: 10 }}>
            <AdminSelect label="Kota" width="100%" value={form.city_id} options={cityOpts} placeholder="Pilih kota…" searchable disabled={!!form.id} onChange={(v) => { const ex = rows.find((r) => r.city_id === v); setForm(ex ? formFromRow(ex) : { ...form, city_id: v }); }} helper={form.id ? 'Kota tidak bisa diganti — hapus lalu tambah baru bila manager pindah kota' : 'Memilih kota yang sudah punya manager akan mengubah baris yang ada'} />
            <Row gap={8} style={{ flexWrap: 'wrap' }}>
              <Input label="Nama lengkap" value={form.full_name} onChangeText={(v) => setForm({ ...form, full_name: v })} placeholder="mis. Rina Marlina" containerStyle={{ flex: 2, minWidth: 200 }} />
              <Input label="Nomor HP" value={form.phone} keyboardType="phone-pad" onChangeText={(v) => setForm({ ...form, phone: v.replace(/[^\d+]/g, '') })} placeholder="08xx" containerStyle={{ flex: 1, minWidth: 140 }} />
            </Row>
            <Row gap={8} style={{ flexWrap: 'wrap' }}>
              <Input label="Email" value={form.email} keyboardType="email-address" autoCapitalize="none" onChangeText={(v) => setForm({ ...form, email: v })} placeholder="nama@domain.id" containerStyle={{ flex: 2, minWidth: 200 }} />
              <Input label="Gaji dasar (Rp / bulan)" value={form.salary_base} keyboardType="number-pad" onChangeText={(v) => setForm({ ...form, salary_base: v.replace(/\D/g, '') })} containerStyle={{ flex: 1, minWidth: 160 }} />
            </Row>
            <AdminSelect label="Akun tertaut (pengguna aplikasi)" icon="person-outline" width="100%" value={adminOpts.some((o) => o.value === form.profile_id) ? form.profile_id : ''} options={adminOpts} placeholder={form.profile_id && !adminOpts.some((o) => o.value === form.profile_id) ? `UUID ${form.profile_id.slice(0, 8)}… (di luar daftar admin)` : 'Pilih akun admin…'} searchable clearable clearLabel="Lepaskan akun" onChange={(v) => setForm({ ...form, profile_id: v })} helper="Daftar = admin aktif (admin_city_manager_options). Akun non-admin boleh: tempel UUID profilnya di bawah." />
            <Input label="UUID profil (opsional, bila bukan admin)" value={form.profile_id} autoCapitalize="none" onChangeText={(v) => setForm({ ...form, profile_id: v.trim() })} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
            <Row gap={8} style={{ flexWrap: 'wrap' }}>
              <AdminSelect label="Status" width={200} value={form.status} options={CITY_MANAGER_STATUS.map((s) => ({ value: s.value, label: s.label }))} onChange={(v) => setForm({ ...form, status: v as CityManagerStatus })} />
              <AdminSelect label="Tier kota" width={240} value={form.tier} options={CITY_TIERS.map((t) => ({ value: String(t.value), label: t.label, sublabel: t.desc }))} onChange={(v) => setForm({ ...form, tier: v })} />
              <Input label="Tanggal mulai (YYYY-MM-DD)" value={form.start_date} onChangeText={(v) => setForm({ ...form, start_date: v.replace(/[^\d-]/g, '') })} placeholder={month.slice(0, 7) + '-01'} containerStyle={{ flex: 1, minWidth: 170 }} />
            </Row>
            <Input label="Catatan (opsional)" value={form.note} onChangeText={(v) => setForm({ ...form, note: v })} placeholder="mis. eks-ASM kompetitor, mulai probation 1 Nov" />
            <Row gap={8} style={{ justifyContent: 'flex-end' }}>
              <Button size="sm" variant="ghost" title="Batal" disabled={busy !== null} onPress={() => setForm(null)} />
              <Button size="sm" title={form.id ? 'Simpan perubahan' : 'Tambah manager'} icon="save-outline" loading={busy === 'save'} onPress={save} />
            </Row>
          </View>
        ) : null}
      </AdminDialog>

      <FootNote lines={[
        'Sumber: admin_city_managers() (0125). Bulan ke-n = selisih bulan kalender antara bulan berjalan dan start_date + 1; tanpa start_date dianggap bulan ke-1; di atas 6 memakai template bulan ke-6.',
        'Skor KPI bulan ini dari city_manager_kpi_calc (0118) — hanya ada bila target bulan ini sudah diisi (manual di KPI Manager Kota, atau lewat Terapkan template).',
        `Gaji dasar default ${rupiah(CITY_MANAGER_SALARY_DEFAULT)} (keputusan GM; setelan city_manager_salary_default). Pembayaran gaji & bonus tidak otomatis — tetap lewat payroll.`,
        'Tier kota [ASUMSI kontrak 0125]: 1 = Pekanbaru/Padang/Batam, 2 = Dumai/Bukittinggi, 3 = kabupaten. Akun tertaut tidak wajib ber-role admin [ASUMSI 0125]; satu akun tidak boleh aktif di dua kota.',
      ]} />
    </AdminPage>
  );
}

/* ───────────────────── Template target per tier × bulan ke-n (kpi_target_templates) ───────────────────── */

type Cell = Record<TemplateNumKey, string> & { note: string };
const cellFrom = (t: KpiTargetTemplate | undefined): Cell => ({
  target_merchant_new: String(t?.target_merchant_new ?? 0), target_driver_new: String(t?.target_driver_new ?? 0), target_merchant_active: String(t?.target_merchant_active ?? 0),
  target_driver_active: String(t?.target_driver_active ?? 0), target_orders: String(t?.target_orders ?? 0),
  weight_merchant_new: String(t?.weight_merchant_new ?? 30), weight_driver_new: String(t?.weight_driver_new ?? 30), weight_active: String(t?.weight_active ?? 20), weight_orders: String(t?.weight_orders ?? 20),
  bonus_pool: String(t?.bonus_pool ?? 0), note: t?.note ?? '',
});

function TemplatePanel() {
  const [rows, setRows] = useState<KpiTargetTemplate[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tier, setTier] = useState<1 | 2 | 3>(1);
  const [edit, setEdit] = useState<{ tier: number; month_no: number; cell: Cell } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await adminKpiTargetTemplates()); setErr(null); }
    catch (e) { setRows([]); setErr(`Template target: ${(e as Error).message}`); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const byTier = useMemo(() => [1, 2, 3, 4, 5, 6].map((m) => rows.find((r) => Number(r.tier) === tier && Number(r.month_no) === m) ?? null), [rows, tier]);
  const openEdit = (m: number) => setEdit({ tier, month_no: m, cell: cellFrom(byTier[m - 1] ?? undefined) });
  const save = async () => {
    if (!edit) return;
    const c = edit.cell;
    const p: Record<string, number | string | null> = { tier: edit.tier, month_no: edit.month_no };
    for (const k of TEMPLATE_TARGET_KEYS) { const v = parseNum(c[k]); if (!Number.isInteger(v) || v < 0 || v > 10_000_000) return toast.error(`${TEMPLATE_KEY_LABEL[k]} harus bilangan bulat 0–10 juta`); p[k] = v; }
    let wsum = 0;
    for (const k of TEMPLATE_WEIGHT_KEYS) { const v = parseNum(c[k]); if (!Number.isInteger(v) || v < 0 || v > 100) return toast.error(`${TEMPLATE_KEY_LABEL[k]} harus bilangan bulat 0–100`); p[k] = v; wsum += v; }
    if (wsum !== 100) return toast.error(`Jumlah bobot harus 100 (sekarang ${wsum})`);
    const pool = parseNum(c.bonus_pool);
    if (!Number.isInteger(pool) || pool < 0 || pool > 1_000_000_000) return toast.error('Bonus pool harus bilangan bulat Rp0–Rp1 miliar');
    p.bonus_pool = pool; p.note = c.note.trim() || null;
    if (!(await useAdminSecurity.getState().ensureUnlocked())) return;
    setBusy(true);
    try { await adminSetKpiTargetTemplate(p as unknown as Partial<KpiTargetTemplate> & { tier: number; month_no: number }); toast.success(`Template tier ${edit.tier} bulan ke-${edit.month_no} disimpan`); setEdit(null); await load(); }
    catch (e) { handleAdminError(e); } finally { setBusy(false); }
  };

  const cellTxt = (v: number | null | undefined) => (v == null ? '—' : Number(v).toLocaleString('id-ID'));
  const tierMeta = CITY_TIERS.find((t) => t.value === tier)!;

  return (
    <Panel title="Template target per tier (3 tier × 6 bulan)" subtitle="Target KPI bulan ke-1..6 untuk tiap tier kota. Dipakai tombol “Terapkan template” di tabel atas. Klik kolom bulan untuk mengubah; bobot harus berjumlah 100. Butuh izin city + PIN." icon="grid-outline" padded={false}
      right={<Row gap={6}>{CITY_TIERS.map((t) => <Pressable key={t.value} onPress={() => setTier(t.value)} style={[st.tierBtn, tier === t.value && st.tierOn]}><Text style={[font.small, tier === t.value && { color: '#fff', fontWeight: '700' }]}>{`Tier ${t.value}`}</Text></Pressable>)}</Row>}>
      <View style={{ padding: adminSpace.md, paddingBottom: 0, gap: 6 }}>
        <ErrorNote text={err} onRetry={load} />
        <Text style={font.tiny}>{tierMeta.label} — {tierMeta.desc}. {loading ? 'Memuat…' : `${byTier.filter(Boolean).length}/6 bulan terisi.`}</Text>
      </View>
      <DataTable keyField="key" rows={([...TEMPLATE_TARGET_KEYS, ...TEMPLATE_WEIGHT_KEYS, 'bonus_pool'] as TemplateNumKey[]).map((k) => ({ key: k, label: TEMPLATE_KEY_LABEL[k], ...Object.fromEntries(byTier.map((t, i) => [`m${i + 1}`, t ? t[k] : null])) }))}
        emptyText="—"
        columns={[
          { key: 'label', label: 'Komponen', width: 190, render: (r) => <Text style={String(r.key).startsWith('weight') ? font.small : font.bodyStrong}>{String(r.label)}</Text> },
          ...[1, 2, 3, 4, 5, 6].map((m) => ({
            key: `m${m}`, label: `Bulan ke-${m}`, width: 120, align: 'right' as const, mono: true,
            render: (r: Record<string, unknown>) => {
              const v = r[`m${m}`] as number | null; const isMoney = r.key === 'bonus_pool'; const isW = String(r.key).startsWith('weight');
              return <Pressable onPress={() => openEdit(m)} style={(state) => [st.cell, (state as { hovered?: boolean }).hovered ? { backgroundColor: adminTone.hover } : null]}><Text style={[font.mono, isW && { color: adminTone.muted }]}>{v == null ? '—' : isMoney ? rupiah(Number(v)) : isW ? `${v} %` : cellTxt(v)}</Text></Pressable>;
            },
          })),
        ]} />
      <View style={{ padding: adminSpace.md, gap: 6 }}>
        <Row gap={6} style={{ flexWrap: 'wrap' }}>
          {[1, 2, 3, 4, 5, 6].map((m) => <RequirePerm key={m} perm={['city', 'ops']}><Button size="sm" variant="outline" title={`Ubah bulan ${m}`} icon="create-outline" onPress={() => openEdit(m)} /></RequirePerm>)}
        </Row>
        <Text style={font.tiny}>Catatan per sel: {byTier.map((t, i) => (t?.note ? `B${i + 1}: ${t.note}` : null)).filter(Boolean).join(' · ') || '—'}</Text>
        <WideTableHint what="kolom bulan ke-5/6" />
      </View>

      <AdminDialog visible={!!edit} onClose={() => (busy ? undefined : setEdit(null))} title={`Template tier ${edit?.tier ?? ''} · bulan ke-${edit?.month_no ?? ''}`} width={640}
        subtitle="Lima target + empat bobot (jumlah 100) + bonus pool. Tersimpan lewat admin_set_kpi_target_template (log city_kpi.template).">
        {edit ? (
          <View style={{ gap: 10 }}>
            <Text style={font.label}>Target</Text>
            <Row gap={8} style={{ flexWrap: 'wrap' }}>
              {TEMPLATE_TARGET_KEYS.map((k) => <Input key={k} label={TEMPLATE_KEY_LABEL[k]} value={edit.cell[k]} keyboardType="number-pad" onChangeText={(v) => setEdit({ ...edit, cell: { ...edit.cell, [k]: v.replace(/\D/g, '') } })} containerStyle={{ flex: 1, minWidth: 110 }} />)}
            </Row>
            <Text style={font.label}>Bobot skor (jumlah harus 100)</Text>
            <Row gap={8} style={{ flexWrap: 'wrap' }}>
              {TEMPLATE_WEIGHT_KEYS.map((k) => <Input key={k} label={TEMPLATE_KEY_LABEL[k].replace('Bobot ', '')} value={edit.cell[k]} keyboardType="number-pad" onChangeText={(v) => setEdit({ ...edit, cell: { ...edit.cell, [k]: v.replace(/\D/g, '') } })} containerStyle={{ flex: 1, minWidth: 110 }} />)}
            </Row>
            <Row gap={8} style={{ flexWrap: 'wrap' }}>
              <Input label="Bonus pool (Rp / bulan)" value={edit.cell.bonus_pool} keyboardType="number-pad" onChangeText={(v) => setEdit({ ...edit, cell: { ...edit.cell, bonus_pool: v.replace(/\D/g, '') } })} containerStyle={{ flex: 1, minWidth: 160 }} />
              <Input label="Catatan" value={edit.cell.note} onChangeText={(v) => setEdit({ ...edit, cell: { ...edit.cell, note: v } })} placeholder="mis. dihitung ulang SDM 1 Nov" containerStyle={{ flex: 2, minWidth: 200 }} />
            </Row>
            <Row gap={8} style={{ justifyContent: 'flex-end' }}>
              <Button size="sm" variant="ghost" title="Batal" disabled={busy} onPress={() => setEdit(null)} />
              <Button size="sm" title="Simpan template" icon="save-outline" loading={busy} onPress={save} />
            </Row>
          </View>
        ) : null}
      </AdminDialog>
    </Panel>
  );
}

const st = StyleSheet.create({
  grade: { width: 26, height: 26, borderRadius: adminRadius.sm, alignItems: 'center', justifyContent: 'center' },
  gradeTxt: { color: '#fff', fontSize: 13, fontWeight: '800', lineHeight: 18 },
  tierBtn: { paddingHorizontal: 12, height: 30, borderRadius: adminRadius.chip, borderWidth: 1, borderColor: adminTone.border, backgroundColor: adminTone.surface, alignItems: 'center', justifyContent: 'center' },
  tierOn: { backgroundColor: adminTone.teal, borderColor: adminTone.teal },
  cell: { paddingHorizontal: 6, paddingVertical: 4, borderRadius: adminRadius.sm, alignSelf: 'stretch', alignItems: 'flex-end' },
});
