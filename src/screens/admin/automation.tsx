// Admin · Otomasi: verifikasi bertingkat, pencairan otomatis, retensi, harga dinamis, anti-fraud & koefisien, moderasi data, laporan terjadwal
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Switch, Modal, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { AdminPage, StatCard, Table } from '@/components/admin';
import { Card, Row, Button, Badge, Input, Chip, IconCircle, toast, type IconName } from '@/components/ui';
import { Entrance, Skeleton } from '@/components/motion';
import { rpc } from '@/lib/supabase';
import { colors, font, radius } from '@/lib/theme';
import { formatDate, rupiah } from '@/lib/format';
import type { AutomationRun, ScheduledReport } from '@/lib/types';

type FieldKind = 'bool' | 'int' | 'num' | 'pct' | 'rp';
type Field = { key: string; label: string; kind: FieldKind; hint?: string; min?: number; max?: number };
type Section = { id: string; title: string; icon: IconName; color: string; how: string; toggle: string; fields: Field[]; run?: { kind: 'retention' | 'verify_backlog' | 'reports'; label: string; hint: string } };
type Status = { settings: Record<string, unknown> | null; last_runs: Record<string, AutomationRun>; recent_runs: AutomationRun[]; reports: ScheduledReport[]; cron: { name: string; schedule: string; active: boolean }[]; pending: Record<string, number>; retention_month: { touches: number; spent: number } };

const SECTIONS: Section[] = [
  { id: 'verify', title: 'Verifikasi bertingkat', icon: 'shield-checkmark-outline', color: colors.success, toggle: 'auto_verify_enabled',
    how: 'Setiap pengajuan driver/merchant diberi skor kelengkapan dokumen (0–100). Skor di atas ambang disetujui otomatis dengan masa percobaan (batas order harian); di bawah ambang masuk antrean admin.',
    fields: [{ key: 'auto_verify_min_score', label: 'Skor minimum otomatis', kind: 'int', hint: '0–100', min: 0, max: 100 }, { key: 'probation_days', label: 'Masa percobaan', kind: 'int', hint: 'hari' }, { key: 'probation_daily_orders', label: 'Batas order/hari saat percobaan', kind: 'int' }],
    run: { kind: 'verify_backlog', label: 'Proses antrean sekarang', hint: 'Hitung ulang skor & setujui yang memenuhi ambang (otomatis tiap 30 menit).' } },
  { id: 'payout', title: 'Pencairan otomatis', icon: 'cash-outline', color: colors.primary, toggle: 'auto_payout_enabled',
    how: 'Penarikan saldo mitra disetujui otomatis bila rekening sudah terverifikasi (pernah disetujui manual), nominal ≤ batas per transaksi dan total harian, tidak ada flag anti-fraud terbuka, dan akun aktif.',
    fields: [{ key: 'auto_payout_max', label: 'Maks per penarikan', kind: 'rp' }, { key: 'auto_payout_daily_max', label: 'Maks per hari per mitra', kind: 'rp' }] },
  { id: 'retention', title: 'Retensi pelanggan', icon: 'heart-outline', color: colors.food, toggle: 'retention_enabled',
    how: 'Pelanggan yang tidak memesan selama N hari dikirimi promo "KEMBALI" otomatis (satu kali per masa jeda) sampai anggaran bulanan habis. Merchant yang sepi mendapat tips promosi tanpa biaya.',
    fields: [{ key: 'retention_days', label: 'Tidak aktif selama', kind: 'int', hint: 'hari' }, { key: 'retention_cooldown_days', label: 'Jeda antar promo', kind: 'int', hint: 'hari' }, { key: 'retention_budget_month', label: 'Anggaran promo / bulan', kind: 'rp' }, { key: 'retention_promo_value', label: 'Diskon', kind: 'pct' }, { key: 'retention_promo_max', label: 'Maks diskon', kind: 'rp' }],
    run: { kind: 'retention', label: 'Jalankan sekarang', hint: 'Kirim promo ke pelanggan tidak aktif yang memenuhi syarat (otomatis tiap hari 10.00 WIB).' } },
  { id: 'dynamic', title: 'Harga dinamis', icon: 'trending-up-outline', color: colors.accent, toggle: 'dynamic_pricing_enabled',
    how: 'Saat permintaan (order mencari driver) melebihi pasokan driver online di radius tertentu dalam jendela waktu, tarif dikali pengganda bertahap sampai batas maksimum. Bekerja di atas sesi tarif terjadwal.',
    fields: [{ key: 'dynamic_max_multiplier', label: 'Pengganda maksimum', kind: 'num', hint: 'mis. 1.5' }, { key: 'dynamic_step', label: 'Langkah kenaikan', kind: 'num', hint: 'mis. 0.25' }, { key: 'dynamic_radius_km', label: 'Radius', kind: 'num', hint: 'km' }, { key: 'dynamic_window_min', label: 'Jendela waktu', kind: 'int', hint: 'menit' }] },
  { id: 'fraud', title: 'Anti-fraud & koefisien', icon: 'alert-circle-outline', color: colors.danger, toggle: 'fraud_auto_suspend',
    how: 'Toggle mengatur penangguhan otomatis driver yang membatalkan order berulang. Koefisien harga membandingkan nota belanja driver dengan harga acuan: di luar rentang ditandai (wajib foto nota), di atas batas keras ditolak. Total belanja dibatasi anggaran × koefisien.',
    fields: [{ key: 'fraud_cancel_limit', label: 'Pembatalan driver / 24 jam', kind: 'int' }, { key: 'fraud_gps_speed_kmh', label: 'Lompatan GPS ditandai di atas', kind: 'int', hint: 'km/jam' }, { key: 'price_coef_min', label: 'Koef. harga minimum', kind: 'num', hint: '× acuan' }, { key: 'price_coef_max', label: 'Koef. harga maksimum', kind: 'num', hint: '× acuan' }, { key: 'price_coef_hard', label: 'Koef. tolak (batas keras)', kind: 'num', hint: '× acuan' }, { key: 'shop_budget_coef', label: 'Koef. batas total belanja', kind: 'num', hint: '× anggaran' }] },
  { id: 'places', title: 'Moderasi data pengguna', icon: 'map-outline', color: colors.shop, toggle: '',
    how: 'Usulan toko/pasar dari pelanggan digabung bila berada dalam radius dedup dan aktif otomatis setelah N laporan konsisten. Barang pedagang pasar hanya tampil bila skor kualitas lapak mencapai ambang.',
    fields: [{ key: 'place_auto_approve_reports', label: 'Laporan untuk aktif otomatis', kind: 'int' }, { key: 'place_dedup_radius_m', label: 'Radius dedup usulan', kind: 'int', hint: 'meter' }, { key: 'vendor_quality_min', label: 'Skor kualitas minimum pedagang', kind: 'int', hint: '0–100', min: 0, max: 100 }] },
  { id: 'reports', title: 'Laporan terjadwal & keuangan', icon: 'document-text-outline', color: colors.info, toggle: 'reports_enabled',
    how: 'Laporan eksekutif dibuat otomatis sesuai jadwal di bawah dan dikirim sebagai notifikasi ke admin & pemegang akses eksekutif. Parameter keuangan dipakai untuk estimasi biaya gateway dan rekomendasi take rate.',
    fields: [{ key: 'gateway_fee_pct', label: 'Biaya payment gateway', kind: 'pct' }, { key: 'target_take_rate_pct', label: 'Target take rate', kind: 'pct' }, { key: 'admin_session_minutes', label: 'Durasi sesi PIN admin', kind: 'int', hint: 'menit' }],
    run: { kind: 'reports', label: 'Kirim laporan jatuh tempo', hint: 'Jalankan laporan yang sudah melewati jadwalnya (otomatis tiap jam).' } },
];
const RUN_LABEL: Record<string, string> = { retention: 'Retensi pelanggan', reports: 'Laporan terjadwal', verify_backlog: 'Antrean verifikasi' };
const CADENCE_LABEL: Record<string, string> = { daily: 'Harian', weekly: 'Mingguan', monthly: 'Bulanan' };
const CRON_LABEL: Record<string, string> = { antarkita_reports: 'Laporan terjadwal', antarkita_retention: 'Retensi pelanggan', antarkita_verify_backlog: 'Antrean verifikasi' };

const asBool = (v: unknown, d = true) => (v == null ? d : v === true || v === 'true' || v === 1 || v === '1');
const asStr = (v: unknown) => (v == null ? '' : typeof v === 'string' ? v.replace(/^"|"$/g, '') : String(v));
const toValue = (f: Field, s: string): number | null => { const n = Number(String(s).replace(',', '.')); if (!Number.isFinite(n)) return null; return f.kind === 'int' || f.kind === 'rp' ? Math.round(n) : n; };
const cronText = (s: string) => {
  const [m, h, , , dow] = s.split(' ');
  if (h === '*' && m.startsWith('*/')) return `setiap ${m.slice(2)} menit`;
  if (h === '*') return `setiap jam (menit ${m})`;
  if (/^\d+$/.test(h)) { const wib = (Number(h) + 7) % 24; return `${dow === '*' ? 'setiap hari' : 'hari ' + dow} pukul ${String(wib).padStart(2, '0')}.${m.padStart(2, '0')} WIB`; }
  return s;
};

export default function AdminAutomation() {
  const router = useRouter();
  const [st, setSt] = useState<Status | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [toggles, setToggles] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [edit, setEdit] = useState<Partial<ScheduledReport> | null>(null);

  const load = useCallback(async () => {
    try {
      const s = await rpc<Status>('admin_automation_status');
      setSt(s);
      const set = s.settings ?? {};
      const d: Record<string, string> = {}; const t: Record<string, boolean> = {};
      SECTIONS.forEach((sec) => { sec.fields.forEach((f) => { d[f.key] = asStr(set[f.key]); }); if (sec.toggle) t[sec.toggle] = asBool(set[sec.toggle]); });
      setDraft(d); setToggles(t);
    } catch (e) { toast.error((e as Error).message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const original = st?.settings ?? {};
  const changedKeys = (sec: Section) => sec.fields.filter((f) => draft[f.key] !== asStr(original[f.key]));
  const saveSection = async (sec: Section) => {
    const p: Record<string, unknown> = {};
    for (const f of changedKeys(sec)) {
      const v = toValue(f, draft[f.key]);
      if (v == null) return toast.error(`${f.label}: isi angka`);
      if (f.min != null && v < f.min) return toast.error(`${f.label}: minimal ${f.min}`);
      if (f.max != null && v > f.max) return toast.error(`${f.label}: maksimal ${f.max}`);
      p[f.key] = v;
    }
    if (!Object.keys(p).length) return toast.show('Tidak ada perubahan');
    setSaving(sec.id);
    try { await rpc('admin_set_settings', { p }); toast.success(`${sec.title}: ${Object.keys(p).length} pengaturan disimpan`); load(); }
    catch (e) { toast.error((e as Error).message); } finally { setSaving(null); }
  };
  const setToggle = async (key: string, v: boolean) => {
    setToggles((t) => ({ ...t, [key]: v }));
    try { await rpc('admin_set_settings', { p: { [key]: v } }); toast.success(v ? 'Otomasi diaktifkan' : 'Otomasi dinonaktifkan'); load(); }
    catch (e) { toast.error((e as Error).message); setToggles((t) => ({ ...t, [key]: !v })); }
  };
  const run = async (kind: string, arg?: string) => {
    setRunning(arg ?? kind);
    try { const r = await rpc<{ count: number }>('admin_run_automation', { p_kind: kind, p_arg: arg ?? null }); toast.success(`${RUN_LABEL[kind] ?? kind}: ${r?.count ?? 0} diproses`); load(); }
    catch (e) { toast.error((e as Error).message); } finally { setRunning(null); }
  };
  const saveReport = async () => {
    if (!edit) return;
    if (!edit.name || edit.name.trim().length < 3) return toast.error('Nama laporan minimal 3 huruf');
    try {
      await rpc('admin_upsert_scheduled_report', { p: { id: edit.id ?? null, name: edit.name.trim(), cadence: edit.cadence ?? 'weekly', hour: edit.hour ?? 7, months: edit.months ?? 3, recipients: edit.recipients ?? [], active: edit.active ?? true } });
      toast.success(edit.id ? 'Jadwal laporan diperbarui' : 'Jadwal laporan ditambahkan'); setEdit(null); load();
    } catch (e) { toast.error((e as Error).message); }
  };
  const toggleReport = async (r: ScheduledReport) => { try { await rpc('admin_upsert_scheduled_report', { p: { id: r.id, active: !r.active } }); load(); } catch (e) { toast.error((e as Error).message); } };

  const pending = st?.pending ?? {};
  const pendingTotal = useMemo(() => Object.values(pending).reduce((a, b) => a + (Number(b) || 0), 0), [pending]);
  const fmtRun = (r?: AutomationRun) => r ? `${formatDate(r.finished_at ?? r.started_at)} · ${r.count} diproses${r.triggered_by ? ' · manual' : ''}${r.ok ? '' : ' · gagal'}` : 'Belum pernah berjalan';

  return (
    <AdminPage title="Otomasi" subtitle="Aturan yang berjalan sendiri: verifikasi, pencairan, retensi, harga dinamis, anti-fraud, moderasi data, laporan" onRefresh={load}>
      <Row gap={12} style={{ flexWrap: 'wrap' }}>
        <StatCard index={0} label="Antrean manual" value={pendingTotal} hint="butuh keputusan admin" color={pendingTotal > 0 ? colors.warning : colors.success} />
        <StatCard index={1} label="Driver · Merchant" value={`${pending.drivers ?? 0} · ${pending.merchants ?? 0}`} hint="verifikasi di bawah ambang" color={colors.ride} />
        <StatCard index={2} label="Pedagang pasar" value={pending.vendors ?? 0} hint="pengajuan lapak" color={colors.market} />
        <StatCard index={3} label="Penarikan" value={pending.withdrawals ?? 0} hint="di luar syarat otomatis" color={colors.primary} />
        <StatCard index={4} label="Usulan tempat" value={pending.places ?? 0} hint="belum mencapai ambang" color={colors.shop} />
        <StatCard index={5} label="Flag anti-fraud" value={pending.fraud ?? 0} hint="terbuka" color={colors.danger} />
      </Row>
      {!st ? <View style={{ gap: 12 }}><Skeleton height={200} radius={20} /><Skeleton height={200} radius={20} /></View> : (
        <Row gap={16} style={{ flexWrap: 'wrap', alignItems: 'stretch' }}>
          {SECTIONS.map((sec, i) => {
            const on = sec.toggle ? toggles[sec.toggle] : true;
            const last = sec.run ? st.last_runs?.[sec.run.kind] : undefined;
            const dirty = changedKeys(sec).length;
            return (
              <Entrance key={sec.id} index={i + 1} style={{ flex: 1, minWidth: 340 }}>
                <Card style={{ gap: 10, flex: 1, opacity: on ? 1 : 0.85 }}>
                  <Row between style={{ gap: 8 }}>
                    <Row gap={10} style={{ flex: 1 }}>
                      <IconCircle name={sec.icon} color={sec.color} size={40} />
                      <View style={{ flex: 1 }}><Text style={[font.h3, { fontSize: 16 }]}>{sec.title}</Text><Text style={font.tiny}>{sec.toggle ? (on ? 'Aktif' : 'Nonaktif') : 'Selalu aktif'}</Text></View>
                    </Row>
                    {sec.toggle ? <Switch value={on} onValueChange={(v) => setToggle(sec.toggle, v)} trackColor={{ true: sec.color, false: colors.border }} thumbColor="#fff" /> : null}
                  </Row>
                  <Text style={font.small}>{sec.how}</Text>
                  {sec.id === 'retention' && st.retention_month ? <Badge text={`Bulan ini: ${st.retention_month.touches} pelanggan disapa · ${rupiah(st.retention_month.spent)} dari ${rupiah(Number(draft.retention_budget_month) || 0)}`} color={colors.food} /> : null}
                  <View style={s.grid}>
                    {sec.fields.map((f) => (
                      <Input key={f.key} label={f.label} value={draft[f.key] ?? ''} onChangeText={(v) => setDraft((d) => ({ ...d, [f.key]: v.replace(/[^\d.,-]/g, '') }))} keyboardType={f.kind === 'int' || f.kind === 'rp' ? 'number-pad' : 'decimal-pad'} placeholder="0"
                        containerStyle={{ width: '48%', flexGrow: 1 }} right={<Text style={font.tiny}>{f.kind === 'rp' ? 'Rp' : f.kind === 'pct' ? '%' : f.hint ?? ''}</Text>} />
                    ))}
                  </View>
                  <Row gap={8} style={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    {sec.run ? <Button size="sm" title={sec.run.label} variant="outline" color={sec.color} icon="play-outline" loading={running === sec.run.kind} onPress={() => run(sec.run!.kind)} /> : null}
                    <Button size="sm" title={dirty ? `Simpan (${dirty})` : 'Simpan'} color={sec.color} disabled={!dirty} loading={saving === sec.id} onPress={() => saveSection(sec)} />
                  </Row>
                  {sec.run ? <Row gap={6}><Ionicons name="time-outline" size={13} color={colors.textMuted} /><Text style={font.tiny}>Terakhir: {fmtRun(last)}. {sec.run.hint}</Text></Row> : null}
                  {sec.id === 'fraud' ? <Pressable onPress={() => router.push('/(admin)/security' as never)}><Text style={s.link}>Tinjau flag di Pusat Keamanan</Text></Pressable> : null}
                  {sec.id === 'places' ? <Row gap={12}><Pressable onPress={() => router.push('/(admin)/places' as never)}><Text style={s.link}>Data Tempat</Text></Pressable><Pressable onPress={() => router.push('/(admin)/vendors' as never)}><Text style={s.link}>Mitra Pasar</Text></Pressable></Row> : null}
                </Card>
              </Entrance>
            );
          })}
        </Row>
      )}

      <Entrance index={9}>
        <Card padded={false}>
          <Row between style={{ padding: 14, flexWrap: 'wrap', gap: 8 }}>
            <View><Text style={font.label}>Laporan terjadwal</Text><Text style={font.tiny}>Dikirim sebagai notifikasi ke admin & pemegang akses eksekutif; arsip tampil di Portal Eksekutif.</Text></View>
            <Button size="sm" title="Tambah jadwal" icon="add" onPress={() => setEdit({ name: '', cadence: 'weekly', hour: 7, months: 3, recipients: [], active: true })} />
          </Row>
          <Table rows={(st?.reports ?? []) as unknown as Record<string, unknown>[]} emptyText="Belum ada jadwal laporan" columns={[
            { key: 'name', label: 'Nama', width: 200, render: (r) => <Text style={{ fontWeight: '700', color: colors.text }}>{String(r.name)}</Text> },
            { key: 'cadence', label: 'Kadens', width: 110, render: (r) => <Badge text={CADENCE_LABEL[String(r.cadence)] ?? String(r.cadence)} color={colors.info} /> },
            { key: 'hour', label: 'Jam WIB', width: 80, render: (r) => <Text style={font.small}>{String(r.hour).padStart(2, '0')}.00</Text> },
            { key: 'months', label: 'Data', width: 80, render: (r) => <Text style={font.small}>{String(r.months)} bln</Text> },
            { key: 'active', label: 'Aktif', width: 70, render: (r) => <Switch value={!!r.active} onValueChange={() => toggleReport(r as unknown as ScheduledReport)} trackColor={{ true: colors.success, false: colors.border }} thumbColor="#fff" /> },
            { key: 'last_run_at', label: 'Terakhir / berikutnya', width: 220, render: (r) => <Text style={font.tiny}>{r.last_run_at ? formatDate(String(r.last_run_at)) : 'belum'} / {r.next_run_at ? formatDate(String(r.next_run_at)) : '-'}</Text> },
            { key: 'actions', label: 'Aksi', width: 220, render: (r) => { const x = r as unknown as ScheduledReport; return <Row gap={6}><Button size="sm" title="Kirim sekarang" variant="secondary" loading={running === x.id} onPress={() => run('reports', x.id)} /><Button size="sm" title="Ubah" variant="ghost" onPress={() => setEdit({ ...x })} /></Row>; } },
          ]} />
        </Card>
      </Entrance>

      <Row gap={16} style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <Entrance index={10} style={{ flex: 1, minWidth: 300 }}>
          <Card style={{ gap: 8 }}>
            <Text style={font.label}>Jadwal server (pg_cron, hanya baca)</Text>
            {(st?.cron ?? []).length === 0 ? <Text style={font.tiny}>pg_cron belum aktif di proyek ini — otomasi hanya berjalan lewat tombol "Jalankan sekarang" atau saat kejadian (trigger).</Text> : null}
            {(st?.cron ?? []).map((c) => <Row key={c.name} between style={{ gap: 8 }}><View style={{ flex: 1 }}><Text style={[font.small, { color: colors.text, fontWeight: '700' }]}>{CRON_LABEL[c.name] ?? c.name}</Text><Text style={font.tiny}>{cronText(c.schedule)} · {c.schedule}</Text></View><Badge text={c.active ? 'Aktif' : 'Nonaktif'} color={c.active ? colors.success : colors.textMuted} /></Row>)}
          </Card>
        </Entrance>
        <Entrance index={11} style={{ flex: 2, minWidth: 360 }}>
          <Card padded={false}>
            <View style={{ padding: 14 }}><Text style={font.label}>Riwayat 30 run terakhir</Text></View>
            <Table rows={(st?.recent_runs ?? []) as unknown as Record<string, unknown>[]} emptyText="Belum ada run" columns={[
              { key: 'started_at', label: 'Waktu', width: 140, render: (r) => <Text style={font.tiny}>{formatDate(String(r.started_at))}</Text> },
              { key: 'kind', label: 'Otomasi', width: 160, render: (r) => <Text style={font.small}>{RUN_LABEL[String(r.kind)] ?? String(r.kind)}</Text> },
              { key: 'count', label: 'Diproses', width: 80, render: (r) => <Text style={{ fontWeight: '700', color: colors.text }}>{String(r.count)}</Text> },
              { key: 'ok', label: 'Status', width: 100, render: (r) => <Badge text={r.ok ? 'OK' : 'Gagal'} color={r.ok ? colors.success : colors.danger} /> },
              { key: 'triggered_by', label: 'Pemicu', width: 90, render: (r) => <Text style={font.tiny}>{r.triggered_by ? 'Manual' : 'Jadwal'}</Text> },
              { key: 'detail', label: 'Detail', width: 220, render: (r) => <Text style={font.tiny} numberOfLines={2}>{Object.entries((r.detail as Record<string, unknown>) ?? {}).map(([k, v]) => `${k}: ${String(v)}`).join(' · ')}</Text> },
            ]} />
          </Card>
        </Entrance>
      </Row>

      <Modal visible={!!edit} transparent animationType="fade" onRequestClose={() => setEdit(null)}>
        <Pressable onPress={() => setEdit(null)} style={s.backdrop}>
          <Pressable onPress={() => {}} style={{ width: '100%', maxWidth: 480 }}>
            <View style={s.dialog}>
              <Text style={font.h3}>{edit?.id ? 'Ubah jadwal laporan' : 'Jadwal laporan baru'}</Text>
              <Input label="Nama laporan" value={edit?.name ?? ''} onChangeText={(v) => setEdit((e) => ({ ...e, name: v }))} placeholder="Laporan mingguan manajemen" />
              <Text style={font.label}>Kadens</Text>
              <Row gap={6}>{(['daily', 'weekly', 'monthly'] as const).map((c) => <Chip key={c} label={CADENCE_LABEL[c]} active={edit?.cadence === c} onPress={() => setEdit((e) => ({ ...e, cadence: c }))} />)}</Row>
              <Row gap={8}>
                <Input label="Jam kirim (WIB)" value={String(edit?.hour ?? 7)} onChangeText={(v) => setEdit((e) => ({ ...e, hour: Math.min(23, Math.max(0, Number(v.replace(/\D/g, '')) || 0)) }))} keyboardType="number-pad" containerStyle={{ flex: 1 }} right={<Text style={font.tiny}>0–23</Text>} />
                <Input label="Bulan data" value={String(edit?.months ?? 3)} onChangeText={(v) => setEdit((e) => ({ ...e, months: Math.min(24, Math.max(1, Number(v.replace(/\D/g, '')) || 1)) }))} keyboardType="number-pad" containerStyle={{ flex: 1 }} right={<Text style={font.tiny}>1–24</Text>} />
              </Row>
              <Input label="Penerima tambahan (email, pisahkan koma)" value={(edit?.recipients ?? []).join(', ')} onChangeText={(v) => setEdit((e) => ({ ...e, recipients: v.split(',').map((x) => x.trim()).filter(Boolean) }))} autoCapitalize="none" placeholder="opsional — notifikasi tetap ke admin & eksekutif" />
              <Row between><Text style={font.small}>Aktif</Text><Switch value={edit?.active ?? true} onValueChange={(v) => setEdit((e) => ({ ...e, active: v }))} trackColor={{ true: colors.success, false: colors.border }} thumbColor="#fff" /></Row>
              <Row gap={8} style={{ justifyContent: 'flex-end' }}>
                <Button title="Batal" variant="ghost" onPress={() => setEdit(null)} />
                <Button title="Simpan jadwal" onPress={saveReport} />
              </Row>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </AdminPage>
  );
}

const s = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  link: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  backdrop: { flex: 1, backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center', padding: 20 },
  dialog: { backgroundColor: '#fff', borderRadius: radius.xl, padding: 20, gap: 12, borderWidth: 1, borderColor: colors.border },
});
