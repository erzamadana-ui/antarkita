// Admin · Anti Order Fiktif (migrasi 0121, keputusan GM 1) + ringkasan Dispatch penawaran bertahap (0122, keputusan 6).
// Kartu rpc('admin_antifraud_summary'); tabel rpc('admin_customer_strikes', { p_status }) per pelanggan dengan riwayat strike;
// "Pulihkan" → rpc('admin_customer_strike_clear', { p_customer, p_note }) (izin orders + PIN): menutup strike aktif,
// reset strike_count/cash_blocked_until, mengaktifkan kembali akun yang ditangguhkan antifraud.
// Setelan antifraud_* & dispatch_* ada di Pengaturan (app_setting_specs) — halaman ini hanya menautkan.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, Linking, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AdminPage, Panel, DataTable, StatCard, Pill, RequirePerm, Toolbar, ReasonPrompt, adminFont as font, adminTone, adminSpace, adminRadius, adminIcon } from '@/components/admin';
import { FootNote } from '@/components/reports';
import { Row, Button, toast } from '@/components/ui';
import { rupiah } from '@/lib/format';
import { handleAdminError, useAdminSecurity } from '@/store/adminSecurity';
import { ErrorNote, fmtDate, fmtAgo, Trunc, WideTableHint, usePager, Pager } from './_shared';
import {
  adminAntifraudSummary, adminCustomerStrikes, adminCustomerStrikeClear, adminDispatchSummary,
  STRIKE_KIND_LABEL, STRIKE_STATUS_FILTERS, STRIKE_STATUS_LABEL,
  type AntifraudSummary, type CustomerStrikeRow, type DispatchSummary, type StrikeStatusFilter,
} from '@/lib/admin31';

const n0 = (v: unknown) => Number(v ?? 0) || 0;

export default function AdminAntiFraud() {
  const router = useRouter();
  const [sum, setSum] = useState<AntifraudSummary | null>(null);
  const [sumErr, setSumErr] = useState<string | null>(null);
  const [rows, setRows] = useState<CustomerStrikeRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<StrikeStatusFilter>('all');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [clearing, setClearing] = useState<CustomerStrikeRow | null>(null);
  const [busy, setBusy] = useState(false);

  const loadSummary = useCallback(async () => {
    try { setSum(await adminAntifraudSummary()); setSumErr(null); }
    catch (e) { setSum(null); setSumErr(`Ringkasan antifraud: ${(e as Error).message}`); }
  }, []);
  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await adminCustomerStrikes(status)); setErr(null); }
    catch (e) { setRows([]); setErr(`Daftar strike: ${(e as Error).message}`); }
    finally { setLoading(false); }
  }, [status]);
  useEffect(() => { loadSummary(); }, [loadSummary]);
  useEffect(() => { load(); }, [load]);
  const reload = useCallback(async () => { await Promise.all([load(), loadSummary()]); }, [load, loadSummary]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return rows;
    return rows.filter((r) => [r.full_name, r.phone, r.customer_id, ...r.strikes.map((s) => s.order_code)].some((v) => String(v ?? '').toLowerCase().includes(t)));
  }, [rows, q]);
  const pg = usePager(filtered, 25);

  const doClear = async (note: string) => {
    if (!clearing) return;
    if (!(await useAdminSecurity.getState().ensureUnlocked())) return;
    setBusy(true);
    try {
      const r = await adminCustomerStrikeClear(clearing.customer_id, note || null);
      toast.success(`${clearing.full_name || 'Pelanggan'} dipulihkan · ${n0(r?.cleared)} strike ditutup${r?.reactivated ? ' · akun diaktifkan kembali' : ''}`);
      setClearing(null); await reload();
    } catch (e) { handleAdminError(e); } finally { setBusy(false); }
  };

  const lim = sum?.limits;
  const kinds = sum?.by_kind_30d ?? {};

  return (
    <AdminPage title="Anti Order Fiktif" subtitle="Penjaga create_order (0121): nomor HP wajib, batas pesanan/jam & pesanan aktif, batas tunai akun baru, strike no-show dari driver → blokir tunai → tangguhkan otomatis. Memulihkan pelanggan butuh izin orders + PIN panel." onRefresh={reload}
      right={<Row gap={8} style={{ flexWrap: 'wrap' }}>
        <Button size="sm" variant="outline" title="Setelan antifraud & dispatch" icon="settings-outline" onPress={() => router.push('/(admin)/settings' as never)} />
        <Button size="sm" variant="outline" title="Segarkan" icon="refresh-outline" onPress={reload} />
      </Row>}>
      <ErrorNote text={sumErr} onRetry={loadSummary} />

      <Row gap={adminSpace.md} style={{ flexWrap: 'wrap' }}>
        <StatCard index={0} icon="alert-circle-outline" label="Strike 7 hari / 30 hari" value={sum ? `${n0(sum.strikes_7d)} / ${n0(sum.strikes_30d)}` : '—'} hint={sum ? `${n0(sum.strikes_open)} strike masih aktif · ${Object.entries(kinds).map(([k, v]) => `${STRIKE_KIND_LABEL[k] ?? k} ${v}`).join(' · ') || 'tanpa rincian jenis'}` : 'memuat…'} color={adminTone.amber} />
        <StatCard index={1} icon="people-outline" label="Pelanggan ber-strike" value={sum ? n0(sum.customers_with_strikes) : '—'} hint="profiles.strike_count > 0" color={adminTone.blue} />
        <StatCard index={2} icon="cash-outline" label="Tunai diblokir" value={sum ? n0(sum.customers_cash_blocked) : '—'} hint={lim ? `strike ke-${lim.strike_cash_block} → blokir tunai ${lim.cash_block_days} hari · ${n0(sum?.rejections_24h?.cash_blocked)} pemblokiran 24 jam terakhir` : 'cash_blocked_until > now()'} color={adminTone.orange} />
        <StatCard index={3} icon="ban-outline" label="Ditangguhkan otomatis" value={sum ? n0(sum.customers_suspended) : '—'} hint={lim ? `strike ke-${lim.strike_suspend} → akun nonaktif · ${n0(sum?.rejections_24h?.auto_suspend)} dalam 24 jam` : 'is_active=false & strike ≥ ambang'} color={sum && n0(sum.customers_suspended) ? adminTone.red : adminTone.slate} />
      </Row>

      {lim ? (
        <Panel title="Batas yang berlaku (antifraud_limits)" subtitle="Nilai dari app_settings; ubah di Pengaturan → kunci antifraud_*. Pesan penolakan di aplikasi pelanggan diawali kode PHONE_REQUIRED / CASH_BLOCKED / ORDER_RATE / NEW_ACCOUNT_CASH_CAP." icon="shield-checkmark-outline">
          <Row gap={8} style={{ flexWrap: 'wrap' }}>
            <LimitChip icon="call-outline" label="Nomor HP wajib" value={lim.phone_required ? 'Ya' : 'Tidak'} tone={lim.phone_required ? 'ok' : 'wait'} />
            <LimitChip icon="timer-outline" label="Maks pesanan / jam" value={`${lim.orders_per_hour_max}`} />
            <LimitChip icon="layers-outline" label="Maks pesanan aktif" value={`${lim.active_orders_max}`} />
            <LimitChip icon="sparkles-outline" label={`Akun baru < ${lim.new_account_hours} jam · tunai maks`} value={rupiah(lim.new_account_cash_max)} />
            <LimitChip icon="hourglass-outline" label="Driver tunggu sebelum lapor no-show" value={`${lim.noshow_wait_minutes} mnt`} />
            <LimitChip icon="pricetag-outline" label="Biaya no-show ke pelanggan" value={lim.noshow_fee ? rupiah(lim.noshow_fee) : 'Tidak ada'} tone={lim.noshow_fee ? 'info' : 'off'} />
            <LimitChip icon="cash-outline" label="Blokir tunai pada strike ke-" value={`${lim.strike_cash_block} (${lim.cash_block_days} hari)`} tone="wait" />
            <LimitChip icon="ban-outline" label="Tangguhkan pada strike ke-" value={`${lim.strike_suspend}`} tone="bad" />
          </Row>
        </Panel>
      ) : null}

      <Panel title={`Pelanggan ber-strike (${filtered.length})`} subtitle="Satu baris per pelanggan (maks 500, terbaru dulu). Klik baris untuk melihat riwayat strike. Pulihkan = tutup semua strike aktif, buka blokir tunai, aktifkan kembali akun yang ditangguhkan antifraud (notifikasi ke pelanggan, log antifraud.strike_clear)." icon="people-outline" padded={false}>
        <View style={{ padding: adminSpace.md, paddingBottom: 0, gap: 8 }}>
          <Toolbar q={q} onQ={setQ} placeholder="Cari nama / HP / kode order…" filters={STRIKE_STATUS_FILTERS} filter={status} onFilter={(v) => setStatus(v as StrikeStatusFilter)} />
          <ErrorNote text={err} onRetry={load} />
        </View>
        <DataTable keyField="customer_id" rows={pg.rows as unknown as Record<string, unknown>[]} emptyText={loading ? 'Memuat…' : err ? 'Tidak bisa membaca daftar — periksa koneksi/izin (orders_view)' : 'Tidak ada pelanggan pada filter ini'} emptyIcon="shield-checkmark-outline"
          onRowPress={(r) => setOpen((o) => (o === String(r.customer_id) ? null : String(r.customer_id)))}
          columns={[
            { key: 'full_name', label: 'Pelanggan', width: 210, render: (r) => { const x = r as unknown as CustomerStrikeRow; return <View style={{ minWidth: 0, alignSelf: 'stretch' }}><Trunc style={font.bodyStrong} title={x.full_name ?? ''}>{x.full_name || '(tanpa nama)'}</Trunc><Trunc style={font.tiny} title={x.customer_id}>{x.phone || 'tanpa HP'} · {x.customer_id.slice(0, 8)}</Trunc></View>; } },
            { key: 'status', label: 'Status', width: 140, render: (r) => { const x = r as unknown as CustomerStrikeRow; const m = STRIKE_STATUS_LABEL[x.status] ?? { label: x.status, tone: 'off' as const }; return <View style={{ gap: 3, alignItems: 'flex-start' }}><Pill text={m.label} tone={m.tone} />{!x.is_active ? <Pill text="akun nonaktif" tone="bad" /> : null}</View>; } },
            { key: 'strike_count', label: 'Strike', width: 80, align: 'right', mono: true, render: (r) => { const x = r as unknown as CustomerStrikeRow; return <Text style={[font.mono, { fontWeight: '700', color: x.strike_count >= (lim?.strike_suspend ?? 3) ? adminTone.red : x.strike_count >= (lim?.strike_cash_block ?? 2) ? adminTone.orange : adminTone.ink }]}>{x.strike_count}</Text>; } },
            { key: 'cash_blocked_until', label: 'Blokir tunai s.d.', width: 150, render: (r) => { const x = r as unknown as CustomerStrikeRow; return x.cash_blocked ? <Text style={[font.small, { color: adminTone.orange }]}>{fmtDate(x.cash_blocked_until)}</Text> : <Text style={font.tiny}>—</Text>; } },
            { key: 'last_strike_at', label: 'Strike terakhir', width: 150, render: (r) => { const x = r as unknown as CustomerStrikeRow; return <View style={{ minWidth: 0 }}><Text style={font.small}>{fmtDate(x.last_strike_at)}</Text><Text style={font.tiny}>{fmtAgo(x.last_strike_at)}</Text></View>; } },
            { key: 'orders_30d', label: 'Order 30 hari', width: 100, align: 'right', mono: true, render: (r) => <Text style={font.mono}>{n0(r.orders_30d).toLocaleString('id-ID')}</Text> },
            { key: 'actions', label: 'Aksi', width: 200, align: 'right', render: (r) => { const x = r as unknown as CustomerStrikeRow; return (
              <Row gap={6} style={{ justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                <Button size="sm" variant="outline" title={open === x.customer_id ? 'Tutup' : `Riwayat (${x.strikes.length})`} icon={open === x.customer_id ? 'chevron-up-outline' : 'list-outline'} onPress={() => setOpen((o) => (o === x.customer_id ? null : x.customer_id))} />
                {x.status !== 'cleared' ? <RequirePerm perm={['orders', 'ops']} fallback={<Text style={font.tiny}>izin orders</Text>}><Button size="sm" title="Pulihkan" icon="refresh-circle-outline" disabled={busy} onPress={() => setClearing(x)} /></RequirePerm> : null}
              </Row>
            ); } },
          ]} />
        {open ? <StrikeHistory row={filtered.find((r) => r.customer_id === open) ?? null} /> : null}
        <View style={{ padding: adminSpace.md, gap: 6 }}><WideTableHint /><Pager p={pg} noun="pelanggan" /></View>
      </Panel>

      <DispatchPanel />

      <ReasonPrompt visible={!!clearing} title={`Pulihkan ${clearing?.full_name || 'pelanggan'}?`} color={adminTone.teal} confirmLabel="Pulihkan" optional
        subtitle={clearing ? `${clearing.strike_count} strike aktif ditutup · blokir tunai dibuka${!clearing.is_active ? ' · akun diaktifkan kembali' : ''}. Catatan tersimpan di strike & log; pelanggan menerima notifikasi "Strike dibersihkan". Butuh PIN.` : undefined}
        quick={['Verifikasi lewat telepon — alamat benar', 'Driver salah lapor no-show', 'Pelanggan sudah diberi peringatan', 'Keputusan CS/GM']}
        onCancel={() => (busy ? undefined : setClearing(null))} onSubmit={doClear} />

      <FootNote lines={[
        'Sumber: admin_antifraud_summary(), admin_customer_strikes(p_status), admin_customer_strike_clear(p_customer, p_note) — migrasi 0121. Status: suspended = akun nonaktif & strike ≥ ambang; cash_blocked = cash_blocked_until > sekarang; active = strike_count > 0; cleared = 0.',
        'Strike dibuat driver lewat driver_report_no_show (syarat: status arrived ≥ N menit). Verifikasi nomor HP = auth.users.phone_confirmed_at ATAU profiles.phone ≥ 9 digit — OTP SMS belum ada (celah tercatat di kontrak).',
        'Setelan (Pengaturan → kunci antifraud_* & dispatch_*): antifraud_active_orders_max 3 [kontrak awal 2 — GM boleh menurunkan], antifraud_noshow_fee 0 (tidak ada biaya no-show), dispatch_offer_seconds 25, dispatch_offer_rounds 6 [ASUMSI agen DB].',
        'Memulihkan tidak menghapus riwayat strike (cleared_at terisi) dan tidak mengembalikan biaya no-show yang sudah dibayarkan ke driver.',
      ]} />
    </AdminPage>
  );
}

function LimitChip({ icon, label, value, tone = 'neutral' }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; value: string; tone?: 'ok' | 'wait' | 'bad' | 'off' | 'info' | 'neutral' }) {
  return (
    <View style={st.limit}>
      <Ionicons name={icon} size={adminIcon.md} color={adminTone.teal} />
      <View style={{ minWidth: 0, flexShrink: 1 }}><Text style={font.tiny} numberOfLines={1}>{label}</Text><Row gap={6}><Text style={font.bodyStrong}>{value}</Text>{tone !== 'neutral' ? <Pill text={tone === 'ok' ? 'aktif' : tone === 'bad' ? 'keras' : tone === 'wait' ? 'eskalasi' : tone === 'off' ? 'nonaktif' : 'info'} tone={tone} /> : null}</Row></View>
    </View>
  );
}

function StrikeHistory({ row }: { row: CustomerStrikeRow | null }) {
  if (!row) return null;
  return (
    <View style={st.history}>
      <Row between style={{ flexWrap: 'wrap', gap: 6 }}>
        <Text style={font.h3}>Riwayat strike · {row.full_name || row.customer_id.slice(0, 8)}</Text>
        <Text style={font.tiny}>{row.strikes.length} strike · {row.strikes.filter((s) => !s.cleared_at).length} aktif</Text>
      </Row>
      {row.strikes.length === 0 ? <Text style={font.small}>Tidak ada rincian strike.</Text> : row.strikes.map((s) => (
        <View key={s.id} style={[st.strike, s.cleared_at && { opacity: 0.6 }]}>
          <Row gap={8} style={{ flexWrap: 'wrap', alignItems: 'center' }}>
            <Pill text={STRIKE_KIND_LABEL[s.kind] ?? s.kind} tone={s.cleared_at ? 'off' : 'bad'} />
            <Text style={font.bodyStrong}>{s.order_code ?? (s.order_id ? s.order_id.slice(0, 8) : 'tanpa order')}</Text>
            <Text style={font.tiny}>{fmtDate(s.created_at)} · oleh {s.created_by_name || (s.created_by ? s.created_by.slice(0, 8) : 'sistem')}</Text>
            {s.evidence_url ? <Pressable onPress={() => Linking.openURL(s.evidence_url!)} hitSlop={6}><Text style={[font.small, { color: adminTone.teal, fontWeight: '700' }]}>Lihat bukti</Text></Pressable> : null}
            {s.cleared_at ? <Pill text={`dipulihkan ${fmtDate(s.cleared_at, false)}`} tone="ok" /> : null}
          </Row>
          {s.note ? <Text style={font.small}>Catatan driver: {s.note}</Text> : null}
          {s.cleared_note ? <Text style={font.small}>Catatan pemulihan: {s.cleared_note}</Text> : null}
        </View>
      ))}
    </View>
  );
}

/* ───────────────────── 0122 · Dispatch penawaran bertahap — ringkasan admin ───────────────────── */

function DispatchPanel() {
  const router = useRouter();
  const [d, setD] = useState<DispatchSummary | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setD(await adminDispatchSummary()); setErr(null); } catch (e) { setD(null); setErr(`Ringkasan dispatch: ${(e as Error).message}`); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const cfg = d?.cfg;
  return (
    <Panel title="Dispatch penawaran bertahap (0122)" subtitle="Order ditawarkan eksklusif ke satu driver per ronde (radius bertambah tiap ronde); driver yang menerima tetapi tidak bergerak dilepas otomatis (accept_no_move). Setelan dispatch_* ada di Pengaturan." icon="radio-outline" iconColor={adminTone.blue}
      right={<Row gap={6}><Button size="sm" variant="ghost" title="Setelan" icon="settings-outline" onPress={() => router.push('/(admin)/settings' as never)} /><Button size="sm" variant="ghost" title="Segarkan" icon="refresh-outline" onPress={load} /></Row>}>
      <View style={{ gap: adminSpace.md }}>
        <ErrorNote text={err} onRetry={load} />
        {d ? (
          <>
            <Row gap={adminSpace.md} style={{ flexWrap: 'wrap' }}>
              <StatCard index={0} icon="radio-outline" label="Penawaran aktif sekarang" value={n0(d.active_offers)} hint={`${n0(d.searching_orders)} order masih mencari driver`} color={adminTone.blue} />
              <StatCard index={1} icon="hourglass-outline" label="Kedaluwarsa 24 jam" value={n0(d.expired_24h)} hint={`${n0(d.offers_24h)} ditawarkan · ${n0(d.accepted_24h)} diterima · ${n0(d.declined_24h)} ditolak`} color={n0(d.expired_24h) > n0(d.accepted_24h) ? adminTone.amber : adminTone.slate} />
              <StatCard index={2} icon="walk-outline" label="Dilepas (tidak bergerak) · 7 hari" value={n0(d.released_no_move_7d)} hint={cfg ? `accepted ≥ ${cfg.no_move_minutes} mnt tanpa mendekat ${cfg.min_progress_m} m · tangguhkan pada ke-${cfg.no_move_suspend}` : 'fraud_flags accept_no_move'} color={n0(d.released_no_move_7d) ? adminTone.red : adminTone.green} />
              <StatCard index={3} icon="repeat-outline" label="Rata-rata ronde diterima · 7 hari" value={d.avg_round_accepted_7d == null ? '—' : Number(d.avg_round_accepted_7d).toLocaleString('id-ID', { maximumFractionDigits: 2 })} hint={cfg ? `${cfg.rounds} ronde × ${cfg.offer_seconds} dtk · radius +${cfg.radius_step_km} km/ronde` : ''} color={adminTone.teal} />
            </Row>
            <Row gap={8} style={{ flexWrap: 'wrap' }}>
              <Pill text={cfg?.enabled ? 'Dispatch aktif' : 'Dispatch nonaktif — siaran lama'} tone={cfg?.enabled ? 'ok' : 'wait'} icon={cfg?.enabled ? 'checkmark-circle-outline' : 'alert-circle-outline'} />
              <Pill text={d.cron === null ? 'pg_cron tidak tersedia' : d.cron ? 'cron antarkita_dispatch terdaftar' : 'cron antarkita_dispatch BELUM terdaftar'} tone={d.cron === null ? 'off' : d.cron ? 'ok' : 'bad'} icon="time-outline" />
              <Pill text={cfg?.offer_on_create ? 'Ronde 1 seketika saat order dibuat' : 'Ronde 1 menunggu tick (≤10 dtk siaran)'} tone={cfg?.offer_on_create ? 'info' : 'neutral'} icon="flash-outline" />
              {cfg ? <Pill text={`penalti rating ${cfg.penalty_m_per_s} m/dtk`} tone="neutral" icon="speedometer-outline" /> : null}
            </Row>
            {d.cron === false ? <Text style={[font.small, { color: adminTone.red }]}>Cron dispatch belum terdaftar: penawaran tidak akan dibuat/kedaluwarsa otomatis — periksa pg_cron ≥ 1.5 (jadwal 10 detik) di server.</Text> : null}
          </>
        ) : !err ? <Text style={font.tiny}>Memuat ringkasan dispatch…</Text> : null}
      </View>
    </Panel>
  );
}

const st = StyleSheet.create({
  limit: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: adminTone.border, borderRadius: adminRadius.md, backgroundColor: adminTone.surfaceAlt, minWidth: 220, flexGrow: 1, flexBasis: 240 },
  history: { marginHorizontal: adminSpace.md, marginTop: adminSpace.md, padding: adminSpace.md, gap: 8, borderWidth: 1, borderColor: adminTone.border, borderRadius: adminRadius.md, backgroundColor: adminTone.surfaceAlt },
  strike: { gap: 4, padding: adminSpace.sm, borderWidth: 1, borderColor: adminTone.border, borderRadius: adminRadius.sm, backgroundColor: adminTone.surface },
});
