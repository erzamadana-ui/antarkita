// Admin · Impor Data Tempat (OpenStreetMap): jalankan & pantau pengisian apotek, pasar, minimarket,
// supermarket, dan faskes se-Indonesia. Pekerjaan dipecah per kota lalu dikerjakan Edge Function
// `osm-import` potong demi potong (tahan timeout), jadi halaman ini hanya memicu & memantau.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { AdminPage, StatCard, Panel, Table, AdminSelect, adminFont as font, adminTone, adminSpace, adminRadius, AdminCard as Card } from '@/components/admin';
import { Row, Button, Badge, Input, toast } from '@/components/ui';
import { rpc, supabase } from '@/lib/supabase';
import { colors } from '@/lib/theme';
import { fmtDate, fmtAgo, WideTableHint } from './_shared';

type JobStatus = 'pending' | 'running' | 'done' | 'cancelled' | 'failed';
interface OsmJob {
  id: string; target: string; scope: string; province: string | null; city_id: string | null; city_name: string | null;
  status: JobStatus; tasks_total: number; tasks_done: number; tasks_failed: number; tasks_pending: number; tasks_running: number;
  fetched: number; inserted: number; updated: number; skipped: number; counts: Record<string, number> | null;
  note: string | null; created_at: string; started_at: string | null; finished_at: string | null;
}
interface OsmGagal { kota: string | null; provinsi: string | null; error: string | null; waktu: string | null }
interface OsmStatus {
  jobs: OsmJob[]; gagal: OsmGagal[];
  data: Record<string, number>;
  terakhir: { kota: string | null; toko: string | null; pasar: string | null; faskes: string | null };
  pengaturan: { osm_import_enabled: boolean; osm_city_assign_max_km: number; osm_import_max_per_task: number };
  provinsi: string[];
}
interface RunResp {
  ok?: boolean; skipped?: boolean; reason?: string; error?: string;
  processed?: number; sisa_tugas?: number | boolean; inserted?: number; updated?: number; skipped_rows?: number; durasi_ms?: number;
}

const TARGETS = [
  { value: 'kota', label: 'Daftar kota & kabupaten', sublabel: 'Wajib dijalankan pertama kali' },
  { value: 'semua', label: 'Semua tempat sekaligus', sublabel: 'Apotek, pasar, minimarket, supermarket, faskes' },
  { value: 'apotek', label: 'Apotek' },
  { value: 'pasar', label: 'Pasar tradisional' },
  { value: 'minimarket', label: 'Minimarket (Indomaret/Alfamart)' },
  { value: 'supermarket', label: 'Supermarket / swalayan' },
  { value: 'faskes', label: 'Rumah sakit & klinik (titik tujuan)' },
];
const SCOPES = [
  { value: 'nasional', label: 'Seluruh Indonesia' },
  { value: 'provinsi', label: 'Satu provinsi' },
  { value: 'kota', label: 'Satu kota / kabupaten' },
];
const TARGET_LABEL: Record<string, string> = {
  kota: 'Daftar kota', semua: 'Semua tempat', apotek: 'Apotek', pasar: 'Pasar', minimarket: 'Minimarket', supermarket: 'Supermarket', faskes: 'Faskes',
};
const SCOPE_LABEL: Record<string, string> = { nasional: 'Nasional', provinsi: 'Provinsi', kota: 'Kota' };
const JOB_COLOR: Record<JobStatus, string> = {
  pending: colors.warning, running: colors.info, done: colors.success, cancelled: colors.textMuted, failed: colors.danger,
};
const JOB_LABEL: Record<JobStatus, string> = {
  pending: 'Antre', running: 'Berjalan', done: 'Selesai', cancelled: 'Dibatalkan', failed: 'Gagal',
};
const COUNT_LABEL: Record<string, string> = {
  apotek: 'Apotek', minimarket: 'Minimarket', supermarket: 'Supermarket', pasar: 'Pasar',
  rumah_sakit: 'Rumah sakit', klinik: 'Klinik', puskesmas: 'Puskesmas', dokter: 'Praktik dokter',
  kota: 'Kota/kabupaten', provinsi: 'Provinsi', lainnya: 'Lainnya', apotek_rs: 'Apotek RS',
};

export default function AdminDataTempat() {
  const [st, setSt] = useState<OsmStatus | null>(null);
  const [cities, setCities] = useState<{ id: string; name: string; province: string | null }[]>([]);
  const [target, setTarget] = useState('kota');
  const [scope, setScope] = useState('nasional');
  const [province, setProvince] = useState('');
  const [cityId, setCityId] = useState('');
  const [maxPerTask, setMaxPerTask] = useState('600');
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [last, setLast] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, { data: ct }] = await Promise.all([
        rpc<OsmStatus>('admin_osm_status', { p_limit: 8 }),
        supabase.from('cities').select('id,name,province').order('name'),
      ]);
      setSt(s);
      setCities((ct as { id: string; name: string; province: string | null }[]) ?? []);
    } catch (e) { toast.error((e as Error).message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const aktif = useMemo(() => st?.jobs.find((j) => j.status === 'running' || j.status === 'pending') ?? null, [st]);

  // Selama ada pekerjaan berjalan, segarkan status tiap 8 detik.
  useEffect(() => {
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
    if (aktif) timer.current = setInterval(load, 8000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [aktif, load]);

  const buat = async () => {
    setBusy(true);
    try {
      const r = await rpc<{ ok?: boolean; skipped?: boolean; reason?: string; tasks?: number }>('admin_osm_enqueue', {
        p_target: target,
        p_scope: scope,
        p_province: scope === 'provinsi' ? province : null,
        p_city_id: scope === 'kota' ? (cityId || null) : null,
        p_max_per_task: Number(maxPerTask) || null,
      });
      if (r?.skipped) toast.error(r.reason ?? 'Pekerjaan tidak dibuat');
      else toast.success(`Pekerjaan dibuat: ${r?.tasks ?? 0} tugas antre. Tekan "Jalankan sekarang" atau tunggu jadwal otomatis.`);
      await load();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  const jalankan = async () => {
    setRunning(true); setLast(null);
    try {
      const { data, error } = await supabase.functions.invoke<RunResp>('osm-import', { body: { action: 'run', job_id: aktif?.id ?? null } });
      if (error) { setLast(`Edge Function tidak merespons: ${error.message}`); toast.error('Edge Function tidak merespons'); }
      else if (data?.error) { setLast(data.error); toast.error(data.error); }
      else if (data?.skipped) { setLast(`Dilewati: ${data.reason ?? '-'}`); toast.error(data.reason ?? 'Impor dilewati'); }
      else {
        setLast(`${data?.processed ?? 0} tugas dikerjakan · ${data?.inserted ?? 0} baru · ${data?.updated ?? 0} diperbarui · sisa ${data?.sisa_tugas ?? 0} tugas (${Math.round((data?.durasi_ms ?? 0) / 1000)} detik)`);
        toast.success(`${data?.processed ?? 0} tugas selesai, ${data?.inserted ?? 0} tempat baru`);
      }
      await load();
    } catch (e) { setLast((e as Error).message); toast.error((e as Error).message); } finally { setRunning(false); }
  };

  const batal = async (id: string) => {
    try { await rpc('admin_osm_cancel', { p_job: id }); toast.success('Pekerjaan dibatalkan'); await load(); }
    catch (e) { toast.error((e as Error).message); }
  };
  const rapikan = async () => {
    setBusy(true);
    try {
      const r = await rpc<{ toko: number; pasar: number; faskes: number }>('admin_osm_rapikan_kota');
      toast.success(`Penetapan kota dirapikan: ${r.toko} toko, ${r.pasar} pasar, ${r.faskes} faskes`);
      await load();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  const d = st?.data ?? {};
  const persen = aktif && aktif.tasks_total > 0 ? Math.min(100, Math.round(((aktif.tasks_done + aktif.tasks_failed) / aktif.tasks_total) * 100)) : 0;
  const cityOptions = useMemo(() => cities.map((c) => ({ value: c.id, label: c.name, sublabel: c.province ?? undefined })), [cities]);
  const provOptions = useMemo(() => (st?.provinsi ?? []).map((p) => ({ value: p, label: p })), [st]);

  return (
    <AdminPage
      title="Impor Data Tempat (OpenStreetMap)"
      subtitle="Isi otomatis apotek, pasar tradisional, minimarket, supermarket, serta rumah sakit & klinik se-Indonesia. Faskes disimpan sebagai titik tujuan, bukan toko belanja."
      onRefresh={load}
    >
      <Row gap={adminSpace.lg} style={{ flexWrap: 'wrap' }}>
        <StatCard index={0} icon="map-outline" label="Kota & kabupaten" value={d.kota_total ?? 0} hint={`${d.kota_osm ?? 0} dari peta · ${d.kota_dilayani ?? 0} dilayani`} color={adminTone.violet} />
        <StatCard index={1} icon="medkit-outline" label="Apotek" value={d.apotek ?? 0} color={adminTone.teal} />
        <StatCard index={2} icon="storefront-outline" label="Minimarket" value={d.minimarket ?? 0} hint={`${d.supermarket ?? 0} supermarket`} color={adminTone.blue} />
        <StatCard index={3} icon="basket-outline" label="Pasar tradisional" value={d.pasar ?? 0} hint={`${d.pasar_osm ?? 0} dari peta`} color={adminTone.orange} />
        <StatCard index={4} icon="business-outline" label="Rumah sakit & klinik" value={d.faskes ?? 0} hint={`${d.rumah_sakit ?? 0} RS · ${d.klinik ?? 0} klinik`} color={adminTone.green} />
      </Row>

      <Row gap={16} style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {/* ---------- Jalankan impor ---------- */}
        <Card style={{ flex: 1.1, minWidth: 340, gap: 10 }}>
          <Text style={font.label}>Jalankan impor</Text>
          <Text style={font.tiny}>
            Urutan yang benar: impor "Daftar kota & kabupaten" dulu (sekali saja), baru impor tempat. Tanpa daftar kota,
            tempat tidak punya wilayah untuk ditempelkan.
          </Text>
          {target === 'kota' ? (
            <View style={s.warn}>
              <Text style={[font.small, { color: colors.warning }]}>
                Impor daftar kota menambah ±500 kota/kabupaten sebagai data rujukan. Semuanya masuk dengan status
                "belum dilayani" dan tidak mengubah kota yang sekarang dilayani: kota/kabupaten baru yang jatuh di dalam
                radius layanan kota yang Anda kurasi sendiri sengaja tidak disisipkan, supaya penentuan "kota mana yang
                melayani pengguna ini" tidak berubah.
              </Text>
            </View>
          ) : null}
          <AdminSelect label="Jenis data" value={target} options={TARGETS} onChange={setTarget} width="100%" />
          <AdminSelect label="Cakupan" value={scope} options={SCOPES} onChange={setScope} width="100%" />
          {scope === 'provinsi'
            ? <AdminSelect label="Provinsi" value={province} options={provOptions} onChange={setProvince} width="100%" placeholder="Pilih provinsi…" searchable />
            : null}
          {scope === 'kota'
            ? <AdminSelect label="Kota / kabupaten" value={cityId} options={cityOptions} onChange={setCityId} width="100%" placeholder="Pilih kota…" searchable />
            : null}
          <Input label="Batas baris per kota" value={maxPerTask} onChangeText={setMaxPerTask} keyboardType="number-pad" />
          <Button title="Buat pekerjaan impor" icon="cloud-download-outline" loading={busy} onPress={buat} />
          <Button title="Jalankan sekarang (satu potong)" variant="outline" icon="play-outline" loading={running} disabled={!aktif} onPress={jalankan} />
          <Text style={font.tiny}>
            Satu panggilan mengerjakan tugas selama ±55 detik lalu berhenti; sisanya dilanjutkan otomatis oleh penjadwal
            setiap 2 menit (perlu URL & kunci di admin_set_osm_config), atau tekan tombol ini lagi.
          </Text>
          {last ? <View style={s.note}><Text style={font.small}>{last}</Text></View> : null}
        </Card>

        {/* ---------- Kemajuan ---------- */}
        <Card style={{ flex: 1.2, minWidth: 340, gap: 10 }}>
          <Row between style={{ flexWrap: 'wrap', gap: 8 }}>
            <Text style={font.label}>Kemajuan pekerjaan</Text>
            {aktif ? <Badge text={JOB_LABEL[aktif.status]} color={JOB_COLOR[aktif.status]} /> : <Badge text="Tidak ada pekerjaan berjalan" color={colors.textMuted} />}
          </Row>
          {aktif ? (<>
            <Text style={[font.small, { color: adminTone.ink }]}>
              {TARGET_LABEL[aktif.target] ?? aktif.target} · {SCOPE_LABEL[aktif.scope] ?? aktif.scope}
              {aktif.province ? ` · ${aktif.province}` : ''}{aktif.city_name ? ` · ${aktif.city_name}` : ''}
            </Text>
            <View style={s.bar}><View style={[s.barFill, { width: `${persen}%` }]} /></View>
            <Row between>
              <Text style={font.tiny}>{aktif.tasks_done} selesai · {aktif.tasks_failed} gagal · {aktif.tasks_pending} antre dari {aktif.tasks_total} tugas</Text>
              <Text style={[font.small, { color: adminTone.ink }]}>{persen}%</Text>
            </Row>
            <Row gap={12} style={{ flexWrap: 'wrap' }}>
              <Text style={font.tiny}>Masuk: <Text style={{ color: colors.success }}>{aktif.inserted}</Text></Text>
              <Text style={font.tiny}>Diperbarui: {aktif.updated}</Text>
              <Text style={font.tiny}>Dilewati: {aktif.skipped}</Text>
              <Text style={font.tiny}>Dibaca dari peta: {aktif.fetched}</Text>
            </Row>
            {aktif.counts && Object.keys(aktif.counts).length > 0 ? (
              <Row gap={6} style={{ flexWrap: 'wrap' }}>
                {Object.entries(aktif.counts).map(([k, v]) => <Badge key={k} text={`${COUNT_LABEL[k] ?? k}: ${v}`} color={adminTone.teal} />)}
              </Row>
            ) : null}
            <Button size="sm" title="Batalkan pekerjaan" variant="outline" color={colors.danger} onPress={() => batal(aktif.id)} />
          </>) : (
            <Text style={font.tiny}>Belum ada pekerjaan yang antre atau berjalan. Buat pekerjaan baru di kolom kiri.</Text>
          )}

          <View style={{ height: 1, backgroundColor: 'rgba(11,31,42,0.07)', marginVertical: 4 }} />
          <Text style={font.label}>Terakhir disegarkan</Text>
          {([
            ['Daftar kota', st?.terakhir?.kota],
            ['Toko (apotek/minimarket/supermarket)', st?.terakhir?.toko],
            ['Pasar tradisional', st?.terakhir?.pasar],
            ['Rumah sakit & klinik', st?.terakhir?.faskes],
          ] as [string, string | null | undefined][]).map(([k, v]) => (
            <Row key={k} between style={{ gap: 12 }}>
              <Text style={font.tiny}>{k}</Text>
              <Text style={[font.small, { color: adminTone.ink }]}>{v ? `${fmtDate(v)} (${fmtAgo(v)})` : 'Belum pernah'}</Text>
            </Row>
          ))}
          <Row between style={{ gap: 12 }}>
            <Text style={font.tiny}>Tempat tanpa kota (di luar {st?.pengaturan?.osm_city_assign_max_km ?? 60} km dari kota mana pun)</Text>
            <Text style={[font.small, { color: (d.tanpa_kota ?? 0) > 0 ? colors.warning : adminTone.ink }]}>{d.tanpa_kota ?? 0}</Text>
          </Row>
          <Button size="sm" title="Rapikan penetapan kota" variant="secondary" icon="git-compare-outline" loading={busy} onPress={rapikan} />
        </Card>
      </Row>

      {/* ---------- Riwayat pekerjaan ---------- */}
      <Panel title="Riwayat pekerjaan impor" subtitle="Setiap pekerjaan dipecah menjadi satu tugas per kota agar tidak menembak satu kueri raksasa ke Overpass">
        <Table
          columns={[
            { key: 'waktu', label: 'Dibuat', width: 150 },
            { key: 'jenis', label: 'Jenis', width: 150 },
            { key: 'cakupan', label: 'Cakupan', width: 160 },
            { key: 'status', label: 'Status', width: 110, render: (r) => <Badge text={JOB_LABEL[r.statusRaw as JobStatus] ?? String(r.statusRaw)} color={JOB_COLOR[r.statusRaw as JobStatus] ?? colors.textMuted} /> },
            { key: 'tugas', label: 'Tugas', width: 130 },
            { key: 'masuk', label: 'Baru', width: 80, mono: true },
            { key: 'diperbarui', label: 'Diperbarui', width: 100, mono: true },
            { key: 'dilewati', label: 'Dilewati', width: 90, mono: true },
            { key: 'rincian', label: 'Per kategori', flex: 1, width: 240 },
          ]}
          rows={(st?.jobs ?? []).map((j) => ({
            id: j.id,
            waktu: fmtDate(j.created_at),
            jenis: TARGET_LABEL[j.target] ?? j.target,
            cakupan: `${SCOPE_LABEL[j.scope] ?? j.scope}${j.province ? ` · ${j.province}` : ''}${j.city_name ? ` · ${j.city_name}` : ''}`,
            statusRaw: j.status,
            status: JOB_LABEL[j.status],
            tugas: `${j.tasks_done}/${j.tasks_total}${j.tasks_failed ? ` (${j.tasks_failed} gagal)` : ''}`,
            masuk: j.inserted,
            diperbarui: j.updated,
            dilewati: j.skipped,
            rincian: Object.entries(j.counts ?? {}).map(([k, v]) => `${COUNT_LABEL[k] ?? k} ${v}`).join(' · ') || '-',
          }))}
          emptyText="Belum pernah ada impor dijalankan"
          emptyIcon="cloud-download-outline"
        />
      </Panel>

      {(st?.gagal ?? []).length > 0 ? (
        <Panel title="Tugas yang gagal" subtitle="Biasanya karena Overpass sedang sibuk — jalankan ulang pekerjaan untuk kota tersebut">
          <Table
            columns={[
              { key: 'kota', label: 'Kota', width: 180 },
              { key: 'provinsi', label: 'Provinsi', width: 160 },
              { key: 'waktu', label: 'Waktu', width: 160 },
              { key: 'error', label: 'Pesan', flex: 1, width: 300 },
            ]}
            rows={(st?.gagal ?? []).map((g, i) => ({
              id: String(i), kota: g.kota ?? '-', provinsi: g.provinsi ?? '-',
              waktu: g.waktu ? fmtDate(g.waktu) : '-', error: g.error ?? '-',
            }))}
            emptyText="Tidak ada tugas gagal"
          />
        </Panel>
      ) : null}

      <Panel title="Catatan sumber data">
        <Text style={font.small}>
          Sumber: OpenStreetMap (© kontributor OSM, lisensi ODbL) lewat Overpass API. Impor dijalankan dari Edge Function
          `osm-import` dengan identitas AntarKita/1.0 dan jeda antar permintaan sesuai etika pemakaian Overpass.
          Rumah sakit & klinik masuk tabel titik tujuan (poi_places) dan tidak pernah muncul di daftar belanja AntarShop.
          Kota hasil impor TIDAK otomatis dianggap dilayani — status layanan diatur terpisah di halaman kota.
        </Text>
      </Panel>
      <WideTableHint />
    </AdminPage>
  );
}

const s = StyleSheet.create({
  note: { backgroundColor: adminTone.teal + '12', borderColor: adminTone.teal + '40', borderWidth: 1, borderRadius: adminRadius.md, padding: 10 },
  warn: { backgroundColor: colors.warning + '12', borderColor: colors.warning + '40', borderWidth: 1, borderRadius: adminRadius.md, padding: 10 },
  bar: { height: 10, borderRadius: adminRadius.chip, backgroundColor: 'rgba(11,31,42,0.08)', overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: adminTone.teal, borderRadius: adminRadius.chip },
});
