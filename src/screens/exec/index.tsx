// Portal Eksekutif — login kedua (PIN) untuk level VP / CEO / CFO / pemegang saham; laporan manajemen & investor.
// Tata letak mengikuti sistem desain panel admin (kartu putih, tipografi berjenjang, angka tabular-nums)
// agar terbaca profesional di layar 1024 ke atas. Bagian `pnl` (laba rugi) bersifat opsional —
// halaman tetap berfungsi penuh bila server belum mengirimkannya.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TextInput, ScrollView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Screen, Row, Button, Chip, Empty, toast } from '@/components/ui';
import { Entrance, useShake } from '@/components/motion';
import { BrandGradient } from '@/components/glass';
import {
  AdminCard, Panel, DataTable, StatCard, TrendChart, Grid, Col, Pill, CITY_COLORS,
  adminFont as af, adminTone, adminSpace, adminRadius, adminIcon,
} from '@/components/admin';
import { LineItem, DefinitionList, FootNote, StackedBars, pctId, rupiahShort, share } from '@/components/reports';
import { BrandLogo } from '@/components/Logo';
import { useAuth } from '@/store/auth';
import { rpc, supabase } from '@/lib/supabase';
import { colors, font, shadow, glass, motion } from '@/lib/theme';
import { rupiah, serviceLabel, shortMonth, execLevelLabel, formatDate } from '@/lib/format';
import type { ExecAccess, ExecReport, ReportRun, Recommendation, ServiceType, SkemaReport } from '@/lib/types';
import { SkemaReportView } from '@/screens/admin/_skema-report';
import { ContributionView } from '@/screens/admin/_contribution-view';
import type { ContributionGroup } from '@/lib/admin';
import { FloatCard } from '@/screens/admin/voucher';
import { voucherFloatStatus, cityTargetsProgress, monthKey, type VoucherFloatStatus, type CityTargetProgress } from '@/lib/voucherV5';
import { execCityManagerKpi, rankKpi, KPI_COMPONENTS, KPI_LABEL, KPI_GRADE_RULE, GRADE_COLOR, type CityManagerKpiRow, type KpiGrade } from '@/lib/kpiKota';

/* ───────────────────── Bagian `pnl` (opsional, migrasi 0026) ───────────────────── */

type PnlBase = {
  orders: number; gmv: number; revenue: number; platform_take: number;
  driver_payout: number; merchant_payout: number; gateway_fee: number; promo: number;
  cogs: number; gross_margin: number; margin_pct: number;
};
type Pnl = {
  from: string; months: number;
  by_month: (PnlBase & { month: string })[];
  by_service: (PnlBase & { service: string })[];
  totals: PnlBase;
};
const getPnl = (r: ExecReport | null): Pnl | null => {
  const p = (r as (ExecReport & { pnl?: Pnl }) | null)?.pnl;
  return p && Array.isArray(p.by_month) && p.totals ? p : null;
};

const PRIO: Record<Recommendation['priority'], { color: string; label: string; icon: React.ComponentProps<typeof Ionicons>['name'] }> = {
  high: { color: adminTone.red, label: 'Prioritas tinggi', icon: 'alert-circle' },
  med: { color: adminTone.amber, label: 'Prioritas sedang', icon: 'warning' },
  low: { color: adminTone.blue, label: 'Prioritas rendah', icon: 'information-circle' },
};
const PNL_C = { revenue: adminTone.teal, cogs: adminTone.orange, margin: adminTone.green, take: adminTone.blue };
const svcName = (s: string) => serviceLabel[s as ServiceType] ?? s;
/** Tanggal aman: nilai kosong/rusak dari server tidak boleh tampil sebagai "Invalid Date". */
const fmtDate = (iso?: string | null, withTime = true, fallback = '—') => {
  if (iso == null || iso === '' || iso === 'null' || iso === 'undefined') return fallback;
  return Number.isNaN(new Date(iso).getTime()) ? fallback : formatDate(iso, withTime);
};
/** "Sep 26" aman: bulan kosong/tidak berformat YYYY-MM tidak boleh jadi "undefined". */
const fmtMonth = (m?: string | null) => (m && /^\d{4}-\d{2}$/.test(String(m)) ? shortMonth(String(m)) : '—');

let SESSION: { token: string; level: string; expires_at: string } | null = null;   // hanya di memori (tidak disimpan di perangkat)

export default function ExecPortal() {
  const router = useRouter();
  const { session, profile } = useAuth();
  const [access, setAccess] = useState<ExecAccess | null | undefined>(undefined);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [sess, setSess] = useState(SESSION);
  const [months, setMonths] = useState(6);
  const [report, setReport] = useState<ExecReport | null>(null);
  const [runs, setRuns] = useState<ReportRun[] | null>(null);
  const [runsErr, setRunsErr] = useState<string | null>(null);
  // Tab "Skema Bisnis" (0103): unit economics dari buku besar order lewat exec_report_v2 (token sesi eksekutif).
  // Tab "KPI Manager Kota" (0118): exec_city_manager_kpi(p_exec_token, p_month) — top 5 & bottom 5 kota.
  const [tab, setTab] = useState<'ringkasan' | 'skema' | 'kontribusi' | 'kpi'>('ringkasan');
  // Tab "Contribution margin" (finpay-v3 §6): RPC yang sama dengan Panel Admin (admin_contribution_margin).
  const fetchContribution = useCallback(async (from: string, to: string, group: ContributionGroup) => {
    if (!sess) throw new Error('Sesi eksekutif berakhir, masuk lagi');
    try { return await rpc('admin_contribution_margin', { p_from: from, p_to: to, p_group: group }); }
    catch (e) {
      const m = String((e as Error).message);
      if (/Hanya admin|tidak punya akses|not authorized|permission/i.test(m)) throw new Error('Laporan contribution margin memakai RPC panel admin (admin_contribution_margin) — akun eksekutif ini belum punya peran admin/viewer. Minta superadmin memberi peran "Pemantau".');
      throw e;
    }
  }, [sess]);
  const { style: shake, shake: doShake } = useShake();
  const fetchSkema = useCallback(async (from: string, to: string, filters: Record<string, unknown>) => {
    if (!sess) throw new Error('Sesi eksekutif berakhir, masuk lagi');
    try { return await rpc<SkemaReport>('exec_report_v2', { p_token: sess.token, p_from: from, p_to: to, p_filters: filters }); }
    catch (e) {
      if (String((e as Error).message).includes('EXEC_SESSION')) { SESSION = null; setSess(null); toast.error('Sesi eksekutif berakhir, masuk lagi'); }
      throw e;
    }
  }, [sess]);

  useEffect(() => { if (session) supabase.from('exec_access').select('user_id, level, active, last_login_at').eq('user_id', session.user.id).maybeSingle().then(({ data }) => setAccess((data as ExecAccess) ?? null)); }, [session]);
  useEffect(() => {
    if (!sess) return;
    rpc<ExecReport>('exec_report', { p_token: sess.token, p_months: months }).then(setReport).catch((e) => { if (String((e as Error).message).includes('EXEC_SESSION')) { SESSION = null; setSess(null); toast.error('Sesi eksekutif berakhir, masuk lagi'); } else toast.error((e as Error).message); });
  }, [sess, months]);
  useEffect(() => { if (sess) rpc<ReportRun[]>('report_runs_list', { p_limit: 10 }).then((r) => { setRuns(r ?? []); setRunsErr(null); }, (e: Error) => { setRuns([]); setRunsErr(e.message); }); }, [sess]);

  const login = async () => {
    if (pin.length < 6) return doShake();
    setBusy(true);
    try {
      // 0115 G-06: PIN salah tidak lagi RAISE (supaya counter & lockout tersimpan) — RPC mengembalikan {ok:false, error, failed, locked_until}
      const r = await rpc<{ ok?: boolean; error?: string; token: string; level: string; expires_at: string }>('exec_login', { p_pin: pin });
      if (!r || r.ok === false || !r.token) throw new Error(r?.error || 'PIN eksekutif salah');
      SESSION = r; setSess(r); setPin(''); toast.success(`Selamat datang, ${execLevelLabel[r.level] ?? r.level}`);
    }
    catch (e) { doShake(); toast.error((e as Error).message); setPin(''); } finally { setBusy(false); }
  };
  const logout = () => { SESSION = null; setSess(null); setReport(null); };
  const exportCsv = () => {
    if (!report || typeof document === 'undefined') return;
    const rows = [['Bulan', 'GMV', 'Pesanan', 'Selesai', 'Pendapatan platform', 'Promo', 'Payout driver', 'Top up', 'Penarikan', 'Pengguna baru', 'Driver baru'], ...report.monthly.map((m) => [m.month, m.gmv, m.orders, m.completed, m.revenue, m.promo ?? 0, m.driver_payout ?? 0, m.topups ?? 0, m.withdrawals ?? 0, m.new_users, m.new_drivers])];
    const csv = rows.map((r) => r.join(',')).join('\n');
    const a = document.createElement('a'); a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv); a.download = `laporan-eksekutif-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  };

  if (!session) return <Screen title="Portal Eksekutif" back><Empty icon="lock-closed-outline" title="Masuk dulu" subtitle="Portal eksekutif memerlukan akun AntarKita + PIN eksekutif." action={<Button title="Masuk" onPress={() => router.replace('/login' as never)} />} /></Screen>;
  if (access === undefined) return <Screen title="Portal Eksekutif" back><Text style={font.small}>Memeriksa akses…</Text></Screen>;
  if (!access || !access.active) return <Screen title="Portal Eksekutif" back><Empty icon="shield-outline" title="Akses terbatas" subtitle="Halaman ini hanya untuk level Vice President ke atas dan pemegang saham. Minta admin memberi akses eksekutif pada akun Anda." action={<Button title="Kembali" variant="secondary" onPress={() => router.back()} />} /></Screen>;

  if (!sess) return (
    <Screen title="Portal Eksekutif" back>
      <Entrance index={0}>
        <Animated.View style={[s.login, shake]}>
          <BrandLogo size={64} />
          <Text style={[font.h2, { marginTop: 10 }]}>Verifikasi kedua</Text>
          <Text style={[font.small, { textAlign: 'center' }]}>{profile?.full_name} · {execLevelLabel[access.level]}. Masukkan PIN eksekutif (6 digit) — bukan kata sandi akun.</Text>
          <TextInput value={pin} onChangeText={(v) => setPin(v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" secureTextEntry maxLength={6} autoFocus style={s.pin} placeholder="••••••" placeholderTextColor={colors.textMuted} onSubmitEditing={login} />
          <Button title="Masuk portal" size="lg" color="#0B1F2A" loading={busy} disabled={pin.length < 6} onPress={login} style={{ alignSelf: 'stretch' }} />
          <Text style={font.tiny}>Sesi berlaku 30 menit. Setiap percobaan login dicatat di log keamanan.{access.last_login_at ? ` Login terakhir ${fmtDate(access.last_login_at)}.` : ''}</Text>
        </Animated.View>
      </Entrance>
    </Screen>
  );

  const r = report;
  const pnl = getPnl(r);
  const growth = r && r.prev_gmv > 0 ? Math.round(((r.summary.gmv - r.prev_gmv) / r.prev_gmv) * 100) : null;
  const takeRate = r ? share(r.summary.revenue, r.summary.gmv) : 0;
  const pnlServices = pnl
    ? [...pnl.by_service].sort((a, b) => b.gross_margin - a.gross_margin).map((x, i) => ({ ...x, _color: CITY_COLORS[i % CITY_COLORS.length] }))
    : [];

  return (
    <Screen title="Laporan Eksekutif" back maxWidth={1180} bg={adminTone.bg} ambient={false}
      right={<Row gap={6} style={{ marginRight: 8 }}><Button size="sm" variant="ghost" title="Keluar portal" icon="lock-closed-outline" onPress={logout} /></Row>}>
      <View style={{ gap: adminSpace.lg }}>
        <BrandGradient colors={['#0B1F2A', '#1F3A4A']} style={[s.hero, shadow.card]}>
          <Row between style={{ flexWrap: 'wrap', gap: 12 }}>
            <View style={{ flexShrink: 1, minWidth: 260, gap: 3 }}>
              <Text style={s.heroKicker} numberOfLines={2}>LAPORAN MANAJEMEN & PEMEGANG SAHAM · {execLevelLabel[sess.level].toUpperCase()}</Text>
              <Text style={s.heroTitle} numberOfLines={2}>{tab === 'skema' ? 'AntarKita — Skema Bisnis (unit economics)' : tab === 'kontribusi' ? 'AntarKita — Contribution Margin' : tab === 'kpi' ? 'AntarKita — KPI Manager Kota' : `AntarKita — ${months} bulan terakhir`}</Text>
              <Text style={s.heroSub} numberOfLines={2}>Dibuat {r ? fmtDate(r.generated_at) : '…'} · sesi berlaku s.d. {new Date(sess.expires_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</Text>
            </View>
            {tab === 'ringkasan' && <Row gap={6} style={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {[3, 6, 12].map((m) => <Chip key={m} label={`${m} bln`} active={months === m} onPress={() => setMonths(m)} color={colors.accent} />)}
              {Platform.OS === 'web' && <Button size="sm" title="CSV" icon="download-outline" color="#fff" variant="glass" onPress={exportCsv} />}
            </Row>}
          </Row>
        </BrandGradient>

        <Row gap={8} style={{ flexWrap: 'wrap' }}>
          <Chip label="Ringkasan manajemen" active={tab === 'ringkasan'} onPress={() => setTab('ringkasan')} color="#0B1F2A" />
          <Chip label="Skema Bisnis" active={tab === 'skema'} onPress={() => setTab('skema')} color="#0B1F2A" />
          <Chip label="Contribution margin" active={tab === 'kontribusi'} onPress={() => setTab('kontribusi')} color="#0B1F2A" />
          <Chip label="KPI Manager Kota" active={tab === 'kpi'} onPress={() => setTab('kpi')} color="#0B1F2A" />
        </Row>

        {tab === 'kpi' ? (
          <Animated.View entering={FadeInDown.duration(motion.base)} style={{ gap: adminSpace.lg }}>
            <SectionHead title="KPI Manager Kota" hint="Skor bulanan per kota dari lima komponen (merchant & driver baru, merchant & driver aktif, order) → grade A–D dan bonus manager. Lima kota teratas dan terbawah." />
            <CityKpiExecSection token={sess.token} onSessionLost={() => { SESSION = null; setSess(null); toast.error('Sesi eksekutif berakhir, masuk lagi'); }} />
          </Animated.View>
        ) : tab === 'kontribusi' ? (
          <Animated.View entering={FadeInDown.duration(motion.base)} style={{ gap: adminSpace.lg }}>
            <SectionHead title="Contribution margin" hint="Per layanan / kota / merchant / bulan dari buku besar order. Target 25 % = take rate bersih tahap matang, bukan laba." />
            <ContributionView fetch={fetchContribution} />
          </Animated.View>
        ) : tab === 'skema' ? (
          <Animated.View entering={FadeInDown.duration(motion.base)} style={{ gap: adminSpace.lg }}>
            <SectionHead title="Skema Bisnis" hint="GMV bersih, pendapatan platform per sumber, take rate bersih vs target, contribution per order, EBITDA kota, dan gerbang scale-up — dari buku besar order (exec_report_v2)" />
            <SkemaReportView fetchReport={fetchSkema} />
          </Animated.View>
        ) : !r ? <Text style={af.small}>Menyusun laporan…</Text> : (
          <Animated.View entering={FadeInDown.duration(motion.base)} style={{ gap: adminSpace.lg }}>

            {/* ── Ringkasan kinerja ── */}
            <SectionHead title="Ringkasan kinerja" hint={`Periode ${months} bulan terakhir · sumber: pesanan berstatus selesai`} />
            <Row gap={adminSpace.md} style={{ flexWrap: 'wrap' }}>
              <StatCard index={0} icon="cart-outline" label="GMV (transaksi selesai)" value={rupiah(r.summary.gmv)} delta={growth} deltaLabel="vs periode sebelumnya"
                hint={growth == null ? 'periode sebelumnya belum ada' : undefined} color={growth != null && growth < 0 ? adminTone.red : adminTone.green} />
              <StatCard index={1} icon="trending-up-outline" label="Pendapatan platform" value={rupiah(r.summary.revenue)} hint={`take rate ${pctId(takeRate)}`} color={adminTone.teal} />
              <StatCard index={2} icon="receipt-outline" label="Pesanan" value={r.summary.orders} hint={`${r.summary.completed} selesai · ${r.summary.cancelled} batal (${pctId(r.quality.cancel_rate)})`} color={adminTone.blue} />
              <StatCard index={3} icon="pricetag-outline" label="Rata-rata nilai pesanan" value={rupiah(r.summary.avg_ticket)} hint="GMV ÷ pesanan selesai" color={adminTone.violet} />
              <StatCard index={4} icon="people-outline" label="Pelanggan bertransaksi" value={r.summary.customers} hint={`${r.summary.cities} kota aktif`} color={adminTone.slate} />
              <StatCard index={5} icon="wallet-outline" label="Payout mitra" value={rupiah(r.summary.driver_payout + r.summary.merchant_payout)} hint={`driver ${rupiah(r.summary.driver_payout)} · merchant ${rupiah(r.summary.merchant_payout)}`} color={adminTone.orange} />
            </Row>

            {/* ── v5 · Dana float AntarVoucher + progres target kota (KONTRAK-V5 §4 exec) ── */}
            <SectionHead title="AntarVoucher & target kota" hint="Σ saldo beredar vs ambang BI Rp1 miliar (izin PJP) · realisasi bulan berjalan vs target order/NPR per kota" />
            <VoucherExecSection />

            {/* ── Laba Rugi (P&L) — hanya bila server mengirim `pnl` ── */}
            {pnl ? (
              <>
                <SectionHead title="Laba Rugi (P&L)" hint="Pendapatan yang ditagih ke pelanggan dikurangi biaya langsung — dihitung dari pesanan selesai" />
                <Row gap={adminSpace.md} style={{ flexWrap: 'wrap' }}>
                  <StatCard index={0} icon="cash-outline" label="Pendapatan (revenue)" value={rupiah(pnl.totals.revenue)} hint={`${pnl.totals.orders.toLocaleString('id-ID')} pesanan selesai`} color={PNL_C.revenue} />
                  <StatCard index={1} icon="swap-horizontal-outline" label="COGS (biaya langsung)" value={rupiah(pnl.totals.cogs)} hint={`${pctId(share(pnl.totals.cogs, pnl.totals.revenue))} dari pendapatan`} color={PNL_C.cogs} />
                  <StatCard index={2} icon="stats-chart-outline" label="Marjin kotor" value={rupiah(pnl.totals.gross_margin)} hint="pendapatan − COGS" color={pnl.totals.gross_margin >= 0 ? PNL_C.margin : adminTone.red} />
                  <StatCard index={3} icon="pie-chart-outline" label="% Marjin" value={pctId(pnl.totals.margin_pct)} hint="marjin kotor ÷ pendapatan" color={pnl.totals.margin_pct >= 0 ? PNL_C.margin : adminTone.red} />
                  <StatCard index={4} icon="business-outline" label="Bagian platform" value={rupiah(pnl.totals.platform_take)} hint={`${pctId(share(pnl.totals.platform_take, pnl.totals.gmv))} dari GMV ${rupiah(pnl.totals.gmv)}`} color={PNL_C.take} />
                </Row>

                <Panel title="Laba rugi per bulan" subtitle="Batang bertumpuk: COGS + marjin kotor = pendapatan" icon="calendar-outline" iconColor={PNL_C.revenue}>
                  <StackedBars height={140} format={rupiahShort}
                    legend={[{ label: 'COGS (payout, promo, gateway)', color: PNL_C.cogs }, { label: 'Marjin kotor', color: PNL_C.margin }]}
                    data={pnl.by_month.map((m) => ({ label: fmtMonth(m.month), segments: [{ value: m.gross_margin, color: PNL_C.margin }, { value: m.cogs, color: PNL_C.cogs }] }))} />
                </Panel>

                <Panel title="Rincian bulanan (P&L)" icon="grid-outline" iconColor={PNL_C.revenue} padded={false}
                  right={<Pill text={`Total marjin ${pctId(pnl.totals.margin_pct)}`} tone={pnl.totals.gross_margin >= 0 ? 'ok' : 'bad'} />}>
                  <DataTable keyField="month" rows={pnl.by_month as unknown as Record<string, unknown>[]}
                    emptyText="Belum ada pesanan selesai pada periode ini" emptyIcon="calendar-outline"
                    columns={[
                      { key: 'month', label: 'Bulan', width: 96, render: (x) => <Text style={af.bodyStrong}>{fmtMonth(String(x.month))}</Text> },
                      count('orders', 'Pesanan', 92),
                      money('gmv', 'GMV', 128),
                      money('revenue', 'Pendapatan', 132, PNL_C.revenue),
                      money('cogs', 'COGS', 128, PNL_C.cogs),
                      money('gross_margin', 'Marjin kotor', 132, PNL_C.margin),
                      pctCol('margin_pct', '% marjin', 100),
                      money('platform_take', 'Bagian platform', 140, PNL_C.take),
                    ]} />
                  <TotalStrip cols={[
                    ['Total pendapatan', rupiah(pnl.totals.revenue)],
                    ['Total COGS', rupiah(pnl.totals.cogs)],
                    ['Marjin kotor', rupiah(pnl.totals.gross_margin)],
                    ['% marjin', pctId(pnl.totals.margin_pct)],
                  ]} />
                </Panel>

                <Panel title="Laba rugi per layanan" subtitle="Diurutkan dari marjin kotor terbesar" icon="layers-outline" iconColor={PNL_C.margin} padded={false}>
                  <DataTable keyField="service" rows={pnlServices as unknown as Record<string, unknown>[]}
                    emptyText="Belum ada pesanan selesai pada periode ini" emptyIcon="layers-outline"
                    columns={[
                      {
                        key: 'service', label: 'Layanan', width: 170, render: (x) => (
                          <Row gap={7}>
                            <View style={{ width: 9, height: 9, borderRadius: 3, backgroundColor: String(x._color) }} />
                            <Text style={af.bodyStrong} numberOfLines={1}>{svcName(String(x.service))}</Text>
                          </Row>
                        ),
                      },
                      count('orders', 'Pesanan', 92),
                      money('gmv', 'GMV', 128),
                      money('revenue', 'Pendapatan', 132, PNL_C.revenue),
                      money('cogs', 'COGS', 128, PNL_C.cogs),
                      money('gross_margin', 'Marjin kotor', 132, PNL_C.margin),
                      pctCol('margin_pct', '% marjin', 100),
                    ]} />
                </Panel>

                <AdminCard>
                  <Text style={af.label}>Cara membaca tabel di atas</Text>
                  <View style={{ height: 6 }} />
                  <DefinitionList items={[
                    { term: 'Revenue (pendapatan)', desc: 'seluruh uang yang ditagih ke pelanggan atas jasa dan barang — ongkos perjalanan, biaya platform, biaya jasa, tambahan antar kota, serta nilai barang merchant.' },
                    { term: 'COGS (biaya langsung)', desc: 'biaya yang langsung menempel pada pesanan itu, yaitu payout driver, payout merchant, biaya payment gateway, dan potongan promo/diskon.' },
                    { term: 'Margin (marjin kotor)', desc: 'sisa pendapatan setelah dikurangi COGS — yakni laba sebelum biaya operasional perusahaan seperti gaji, server, dan pemasaran; "% marjin" adalah marjin kotor dibagi pendapatan.' },
                  ]} />
                </AdminCard>
              </>
            ) : null}

            {/* ── Keuangan (arus kas dompet & promo) ── */}
            {r.finance ? (<>
              <SectionHead title="Keuangan & likuiditas" hint="Take rate, promo, serta arus kas dompet AntarVoucher" />
              <Row gap={adminSpace.md} style={{ flexWrap: 'wrap' }}>
                <StatCard index={0} icon="trending-up-outline" label="Take rate" value={pctId(r.finance.take_rate_pct)} hint="pendapatan platform ÷ GMV" color={adminTone.teal} />
                <StatCard index={1} icon="cash-outline" label="Pendapatan bersih" value={rupiah(r.finance.net_revenue)} hint="setelah promo & biaya gateway" color={r.finance.net_revenue >= 0 ? adminTone.green : adminTone.red} />
                <StatCard index={2} icon="stats-chart-outline" label="Margin kontribusi" value={pctId(r.finance.contribution_margin_pct)} hint="pendapatan bersih ÷ GMV" color={r.finance.contribution_margin_pct >= 10 ? adminTone.green : adminTone.amber} />
                <StatCard index={3} icon="pricetags-outline" label="Promo" value={pctId(r.finance.promo_pct_gmv)} hint={`${rupiah(r.finance.promo_discount)} dari GMV`} color={r.finance.promo_pct_gmv > 5 ? adminTone.red : adminTone.blue} />
                <StatCard index={4} icon="cash-outline" label="Pesanan tunai" value={pctId(r.finance.cash_orders_pct)} hint="dari pesanan selesai" color={adminTone.slate} />
                <StatCard index={5} icon="wallet-outline" label="Liabilitas saldo" value={rupiah(r.finance.wallet_liability)} hint="saldo AntarVoucher pengguna (utang ke pengguna)" color={adminTone.violet} />
                <StatCard index={6} icon="alert-circle-outline" label="Piutang saldo minus" value={rupiah(r.finance.receivable_negative)} hint="saldo minus mitra (order tunai)" color={r.finance.receivable_negative > 1000000 ? adminTone.red : adminTone.amber} />
                <StatCard index={7} icon="card-outline" label="Top up via gateway" value={rupiah(r.finance.topups_gateway)} hint={`estimasi biaya gateway ${rupiah(r.finance.gateway_fee_est)} (${pctId(r.finance.gateway_fee_pct)})`} color={adminTone.orange} />
                <StatCard index={8} icon="time-outline" label="Penarikan tertunda" value={rupiah(r.finance.withdrawals_pending)} hint={`top up tertunda ${rupiah(r.finance.topups_pending)}`} color={adminTone.blue} />
              </Row>

              <Panel title="Arus kas dompet & promo per bulan" subtitle="Pendapatan = biaya layanan + komisi · top up & penarikan = arus kas dompet AntarVoucher" icon="swap-vertical-outline" iconColor={adminTone.blue} padded={false}>
                <DataTable keyField="month" rows={r.monthly as unknown as Record<string, unknown>[]} emptyText="Belum ada data bulanan"
                  columns={[
                    { key: 'month', label: 'Bulan', width: 96, render: (x) => <Text style={af.bodyStrong}>{fmtMonth(String(x.month))}</Text> },
                    money('gmv', 'GMV', 128),
                    money('revenue', 'Pendapatan', 132, adminTone.green),
                    money('promo', 'Promo', 118, adminTone.red),
                    money('driver_payout', 'Payout driver', 132),
                    money('topups', 'Top up', 124),
                    money('withdrawals', 'Penarikan', 124),
                  ]} />
                <TotalStrip cols={[
                  ['GMV', rupiah(r.finance.gmv)],
                  ['Pendapatan', rupiah(r.finance.revenue)],
                  ['Promo', rupiah(r.finance.promo_discount)],
                  ['Payout driver', rupiah(r.summary.driver_payout)],
                  ['Top up', rupiah(r.finance.topups)],
                  ['Penarikan', rupiah(r.finance.withdrawals)],
                ]} />
              </Panel>
            </>) : null}

            {/* ── Tren ── */}
            <SectionHead title="Tren pertumbuhan" hint="Perbandingan bulanan GMV, pendapatan, pesanan, dan pertumbuhan pengguna" />
            <Grid gap={adminSpace.lg}>
              <Col span={6} min={340}>
                <Panel title="GMV vs pendapatan platform" icon="trending-up-outline" iconColor={adminTone.green}>
                  <TrendChart months={r.monthly.map((m) => m.month)} height={190} series={[
                    { label: 'GMV (ribu Rp)', values: r.monthly.map((m) => Math.round(m.gmv / 1000)), color: adminTone.green },
                    { label: 'Pendapatan (ribu Rp)', values: r.monthly.map((m) => Math.round(m.revenue / 1000)), color: adminTone.teal },
                  ]} />
                </Panel>
              </Col>
              <Col span={6} min={340}>
                <Panel title="Pesanan & pertumbuhan pengguna" icon="people-outline" iconColor={adminTone.blue}>
                  <TrendChart months={r.monthly.map((m) => m.month)} height={190} series={[
                    { label: 'Pesanan', values: r.monthly.map((m) => m.orders), color: adminTone.blue },
                    { label: 'Pengguna baru', values: r.monthly.map((m) => m.new_users), color: adminTone.violet },
                    { label: 'Driver baru', values: r.monthly.map((m) => m.new_drivers), color: adminTone.orange },
                  ]} />
                </Panel>
              </Col>
            </Grid>

            {/* ── Rekomendasi ── */}
            {r.recommendations && r.recommendations.length > 0 ? (<>
              <SectionHead title="Rekomendasi" hint="Disusun otomatis dari indikator periode berjalan" />
              <Grid gap={adminSpace.lg}>
                {r.recommendations.map((rc, i) => <Col key={i} span={4} min={300}><RecoCard rc={rc} index={i} /></Col>)}
              </Grid>
            </>) : null}

            {/* ── Segmen ── */}
            <SectionHead title="Segmen bisnis" hint="Kontribusi per layanan, per kota, dan merchant teratas" />
            <Grid gap={adminSpace.lg}>
              <Col span={4} min={300}>
                <Panel title="Per layanan" icon="layers-outline" iconColor={adminTone.teal}>
                  <View style={{ gap: 2 }}>
                    {r.by_service.length === 0 ? <Text style={af.small}>Belum ada data.</Text> : null}
                    {r.by_service.map((x, i) => (
                      <LineItem key={x.service} dot={CITY_COLORS[i % CITY_COLORS.length]} label={svcName(x.service)} value={rupiah(x.gmv)}
                        hint={`${x.orders} pesanan${x.revenue != null ? ` · pendapatan ${rupiah(x.revenue)}` : ''}`} />
                    ))}
                  </View>
                </Panel>
              </Col>
              <Col span={4} min={300}>
                <Panel title="Per kota" icon="map-outline" iconColor={adminTone.blue}>
                  <View style={{ gap: 2 }}>
                    {r.by_city.length === 0 ? <Text style={af.small}>Belum ada data.</Text> : null}
                    {r.by_city.map((x) => <LineItem key={x.city} label={x.city} value={rupiah(x.gmv)} hint={`${x.orders} pesanan · ${x.customers} pelanggan`} />)}
                  </View>
                </Panel>
              </Col>
              <Col span={4} min={300}>
                <Panel title="Merchant teratas" icon="storefront-outline" iconColor={adminTone.orange}>
                  <View style={{ gap: 2 }}>
                    {r.top_merchants.length === 0 ? <Text style={af.small}>Belum ada.</Text> : null}
                    {r.top_merchants.map((x, i) => <LineItem key={x.name} label={`${i + 1}. ${x.name}`} value={rupiah(x.gmv)} hint={`${x.orders} pesanan`} />)}
                  </View>
                </Panel>
              </Col>
            </Grid>

            {/* ── Operasional ── */}
            <SectionHead title="Operasional" hint="Pasokan mitra, likuiditas dompet, dan kualitas layanan" />
            <Grid gap={adminSpace.lg}>
              <Col span={6} min={330}>
                <Panel title="Pasokan & likuiditas" icon="git-network-outline" iconColor={adminTone.teal}>
                  <View style={{ gap: 2 }}>
                    <LineItem label="Driver aktif / online" value={`${r.supply.drivers_total} / ${r.supply.drivers_online}`} />
                    <LineItem label="Driver menunggu verifikasi" value={String(r.supply.drivers_pending)} />
                    <LineItem label="Merchant aktif / menunggu" value={`${r.supply.merchants_total} / ${r.supply.merchants_pending}`} />
                    <LineItem label="Pengguna aktif" value={String(r.supply.users_total)} />
                    {r.supply.vendors_total != null ? <LineItem label="Pedagang pasar aktif / menunggu" value={`${r.supply.vendors_total} / ${r.supply.vendors_pending ?? 0}`} /> : null}
                    {r.supply.travel_partners != null ? <LineItem label="Mitra travel aktif" value={String(r.supply.travel_partners)} /> : null}
                    <LineItem top label="Saldo AntarVoucher pengguna (float)" value={rupiah(r.supply.wallet_float)} />
                    <LineItem label="Saldo minus driver (piutang)" value={rupiah(r.supply.wallet_negative)} color={r.supply.wallet_negative < 0 ? adminTone.red : undefined} />
                  </View>
                </Panel>
              </Col>
              <Col span={6} min={330}>
                <Panel title="Kualitas layanan" icon="ribbon-outline" iconColor={adminTone.violet}>
                  <View style={{ gap: 2 }}>
                    <LineItem label="Tingkat pembatalan" value={pctId(r.quality.cancel_rate)} color={r.quality.cancel_rate > 15 ? adminTone.red : undefined} />
                    <LineItem label="Rating driver rata-rata" value={r.quality.avg_driver_rating != null ? `${r.quality.avg_driver_rating} / 5` : '—'} />
                    <LineItem label="Tiket CS (periode) / terbuka" value={`${r.quality.tickets} / ${r.quality.tickets_open}`} />
                    <LineItem label="Respons pertama CS" value={r.quality.avg_first_response_min != null ? `${r.quality.avg_first_response_min} menit` : '—'} />
                    <LineItem label="Kepuasan CS" value={r.quality.cs_rating != null ? `${r.quality.cs_rating} / 5` : '—'} />
                    <LineItem label="Insiden SOS" value={String(r.quality.sos)} color={r.quality.sos > 0 ? adminTone.red : undefined} />
                  </View>
                </Panel>
              </Col>
            </Grid>

            {/* ── Otomasi & keamanan ── */}
            {r.automation || r.fraud ? (<>
              <SectionHead title="Otomasi & keamanan" hint="Proses yang berjalan tanpa admin, serta status anti-fraud terkini" />
              <Grid gap={adminSpace.lg}>
                {r.automation ? (
                  <Col span={6} min={330}>
                    <Panel title="Otomasi (periode)" icon="flash-outline" iconColor={adminTone.amber}>
                      <View style={{ gap: 2 }}>
                        <LineItem label="Mitra diverifikasi otomatis" value={String(r.automation.auto_verified)} />
                        <LineItem label="Pencairan otomatis" value={String(r.automation.auto_payouts)} />
                        <LineItem label="Usulan tempat dari pelanggan" value={String(r.automation.place_suggestions)} />
                        <LineItem label="Tempat aktif otomatis" value={String(r.automation.place_auto_approved)} />
                      </View>
                    </Panel>
                  </Col>
                ) : null}
                {r.fraud ? (
                  <Col span={6} min={330}>
                    <Panel title="Anti-fraud (saat ini)" icon="shield-checkmark-outline" iconColor={adminTone.red}>
                      <View style={{ gap: 2 }}>
                        <LineItem label="Flag terbuka" value={String(r.fraud.open)} color={r.fraud.open > 0 ? adminTone.red : undefined} />
                        <LineItem label="Prioritas tinggi" value={String(r.fraud.open_high)} color={r.fraud.open_high > 0 ? adminTone.red : undefined} />
                        <LineItem label="Akun ditangguhkan otomatis" value={String(r.fraud.auto_suspended)} color={r.fraud.auto_suspended > 0 ? adminTone.red : undefined} />
                      </View>
                      <Text style={[af.tiny, { marginTop: 8 }]}>Peninjauan flag dilakukan admin di Panel Admin → Pusat Keamanan.</Text>
                    </Panel>
                  </Col>
                ) : null}
              </Grid>
            </>) : null}

            {/* ── Arsip laporan otomatis ── */}
            <SectionHead title="Laporan otomatis" hint="Arsip laporan terjadwal yang dibuat sistem" />
            {runsErr ? <Text style={[af.small, { color: adminTone.red }]}>Arsip laporan belum bisa dimuat: {runsErr}</Text> : null}
            {runs === null ? <Text style={af.small}>Memuat arsip laporan…</Text> : runs.length === 0 ? (
              runsErr ? null : <AdminCard><Empty icon="document-text-outline" title="Belum ada laporan terjadwal" subtitle="Admin dapat menambah jadwal laporan di Panel Admin → Otomasi." /></AdminCard>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: adminSpace.md, paddingBottom: 4 }}>
                {runs.map((x) => {
                  const top = x.recommendations?.[0];
                  const pc = top ? PRIO[top.priority] ?? PRIO.low : null;
                  return (
                    <AdminCard key={x.id} style={{ width: 300 }}>
                      <Row between style={{ gap: 8 }}>
                        <Pill text={x.period} tone="info" />
                        <Text style={af.tiny}>{fmtDate(x.created_at, false)}</Text>
                      </Row>
                      <Text style={[af.h3, { marginTop: 8 }]} numberOfLines={1}>{x.name}</Text>
                      <View style={{ marginTop: 4 }}>
                        <LineItem label="GMV" value={rupiah(Number(x.summary?.gmv) || 0)} />
                        <LineItem label="Pendapatan" value={rupiah(Number(x.finance?.revenue ?? x.summary?.revenue) || 0)} />
                        <LineItem label="Take rate" value={pctId(x.finance?.take_rate_pct)} />
                      </View>
                      {top && pc ? (
                        <Row gap={6} style={{ alignItems: 'flex-start', marginTop: 6 }}>
                          <Ionicons name={pc.icon} size={adminIcon.sm} color={pc.color} style={{ marginTop: 1 }} />
                          <Text style={[af.tiny, { flex: 1, color: pc.color, fontWeight: '700' }]} numberOfLines={2}>{top.title}</Text>
                        </Row>
                      ) : null}
                    </AdminCard>
                  );
                })}
              </ScrollView>
            )}

            {/* ── Rincian bulanan operasional ── */}
            <Panel title="Rincian bulanan" subtitle="Angka operasional dasar per bulan" icon="calendar-outline" iconColor={adminTone.slate} padded={false}>
              <DataTable keyField="month" rows={r.monthly as unknown as Record<string, unknown>[]} emptyText="Belum ada data bulanan"
                columns={[
                  { key: 'month', label: 'Bulan', width: 96, render: (x) => <Text style={af.bodyStrong}>{fmtMonth(String(x.month))}</Text> },
                  money('gmv', 'GMV', 132),
                  count('orders', 'Pesanan', 100),
                  count('completed', 'Selesai', 100),
                  money('revenue', 'Pendapatan', 132),
                  count('new_users', 'Pengguna baru', 130),
                  count('new_drivers', 'Driver baru', 122),
                ]} />
            </Panel>

            <FootNote lines={[
              'GMV = total nilai pesanan berstatus selesai. Pendapatan platform = biaya layanan + komisi driver + komisi merchant; promo/diskon dicatat sebagai pengurang.',
              pnl
                ? 'Laba rugi (P&L) memakai pendapatan yang ditagih ke pelanggan dikurangi biaya langsung (payout mitra, promo, biaya gateway). Belum termasuk biaya operasional perusahaan: gaji, server, pemasaran, dan pajak.'
                : 'Bagian Laba Rugi (P&L) belum tersedia dari server pada versi ini; angka keuangan di atas tetap valid.',
              'Biaya gateway bernilai nol untuk pesanan tanpa transaksi payment gateway (tunai atau saldo AntarVoucher).',
              'Data AntarTravel dan tiket CS dihitung terpisah dari pesanan reguler.',
            ]} />
          </Animated.View>
        )}
      </View>
    </Screen>
  );
}

/* ───────────────────── Potongan tampilan ───────────────────── */

function SectionHead({ title, hint }: { title: string; hint?: string }) {
  return (
    <View style={{ gap: 2, marginTop: adminSpace.sm }}>
      <Text style={af.h1}>{title}</Text>
      {hint ? <Text style={af.small}>{hint}</Text> : null}
    </View>
  );
}

/** Ringkasan total di bawah tabel (menggantikan baris "Total" agar tetap terbaca di layar sempit). */
function TotalStrip({ cols }: { cols: [string, string][] }) {
  return (
    <View style={s.totalStrip}>
      {cols.map(([k, v]) => (
        <View key={k} style={{ minWidth: 140, gap: 2 }}>
          <Text style={af.label}>{k}</Text>
          <Text style={af.mono}>{v}</Text>
        </View>
      ))}
    </View>
  );
}

const money = (key: string, label: string, width: number, color?: string) => ({
  key, label, width, align: 'right' as const, mono: true,
  render: (x: Record<string, unknown>) => <Text style={[af.mono, color ? { color } : null]} numberOfLines={1}>{rupiah(Number(x[key] ?? 0))}</Text>,
});
const count = (key: string, label: string, width: number) => ({
  key, label, width, align: 'right' as const, mono: true,
  render: (x: Record<string, unknown>) => <Text style={af.mono}>{Number(x[key] ?? 0).toLocaleString('id-ID')}</Text>,
});
const pctCol = (key: string, label: string, width: number) => ({
  key, label, width, align: 'right' as const, mono: true,
  render: (x: Record<string, unknown>) => { const v = Number(x[key] ?? 0); return <Text style={[af.mono, { color: v >= 0 ? adminTone.green : adminTone.red }]}>{pctId(v)}</Text>; },
});

function RecoCard({ rc, index }: { rc: Recommendation; index: number }) {
  const p = PRIO[rc.priority] ?? PRIO.low;
  return (
    <Entrance index={index} style={{ flex: 1 }}>
      <View style={[s.reco, { borderColor: p.color + '44', backgroundColor: p.color + '0D' }]}>
        <Row gap={10} style={{ alignItems: 'flex-start' }}>
          <View style={[s.recoIcon, { backgroundColor: p.color + '1A', borderColor: p.color + '33' }]}><Ionicons name={p.icon} size={adminIcon.md} color={p.color} /></View>
          <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
            <Row gap={6} style={{ flexWrap: 'wrap' }}><Pill text={p.label} color={p.color} /><Pill text={rc.area} tone="neutral" /></Row>
            <Text style={af.h3} numberOfLines={2}>{rc.title}</Text>
            <Text style={af.small}>{rc.detail}</Text>
            <Row gap={6} style={{ alignItems: 'flex-start', marginTop: 2 }}>
              <Ionicons name="arrow-forward-circle" size={adminIcon.md} color={p.color} style={{ marginTop: 1 }} />
              <Text style={[af.small, { flex: 1, color: adminTone.ink, fontWeight: '700' }]}>{rc.action}</Text>
            </Row>
          </View>
        </Row>
      </View>
    </Entrance>
  );
}

const s = StyleSheet.create({
  login: { alignItems: 'center', gap: adminSpace.md, padding: adminSpace.xxl, borderRadius: adminRadius.lg, backgroundColor: 'rgba(255,255,255,0.8)', borderWidth: 1, borderColor: glass.border, maxWidth: 420, alignSelf: 'center', width: '100%' },
  pin: { fontSize: 30, fontWeight: '700', letterSpacing: 14, textAlign: 'center', color: colors.text, borderBottomWidth: 2, borderBottomColor: '#0B1F2A', paddingVertical: 8, width: 220 },
  hero: { borderRadius: adminRadius.lg, padding: adminSpace.xl, overflow: 'hidden' },
  // Kepala portal memakai skala tipografi yang sama dengan panel admin, hanya warnanya dibalik.
  heroKicker: { ...af.label, color: 'rgba(255,255,255,0.78)', lineHeight: 16 },
  heroTitle: { ...af.display, color: '#fff' },
  heroSub: { ...af.tiny, color: 'rgba(255,255,255,0.78)' },
  totalStrip: { flexDirection: 'row', flexWrap: 'wrap', gap: adminSpace.xl, paddingHorizontal: adminSpace.lg, paddingVertical: adminSpace.md, borderTopWidth: 1, borderTopColor: adminTone.border, backgroundColor: adminTone.surfaceAlt },
  reco: { flex: 1, padding: adminSpace.lg, borderRadius: adminRadius.lg, borderWidth: 1 },
  recoIcon: { width: 32, height: 32, borderRadius: adminRadius.md, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});

/* ───────────────── v5 · Float + progres target kota untuk eksekutif ───────────────── */
const T_STATUS_X: Record<CityTargetProgress['status'], { label: string; tone: 'ok' | 'wait' | 'bad' | 'off' }> = {
  on_track: { label: 'On track', tone: 'ok' }, at_risk: { label: 'At risk', tone: 'wait' }, behind: { label: 'Behind', tone: 'bad' }, no_target: { label: 'Tanpa target', tone: 'off' },
};
function VoucherExecSection() {
  const [fl, setFl] = useState<VoucherFloatStatus | null>(null);
  const [flErr, setFlErr] = useState<string | null>(null);
  const [rows, setRows] = useState<CityTargetProgress[]>([]);
  const [tErr, setTErr] = useState<string | null>(null);
  const load = useCallback(() => {
    voucherFloatStatus().then((f) => { setFl(f); setFlErr(null); }).catch((e: Error) => setFlErr(`Dana float: ${e.message}`));
    cityTargetsProgress(monthKey()).then((r) => { setRows(Array.isArray(r) ? r : []); setTErr(null); }).catch((e: Error) => setTErr(`Progres target kota: ${e.message}`));
  }, []);
  useEffect(() => { load(); }, [load]);
  const tot = rows.reduce((a, r) => ({ t: a.t + Number(r.target_orders || 0), o: a.o + Number(r.actual_orders || 0), n: a.n + Number(r.actual_npr || 0), tn: a.tn + Number(r.target_npr || 0) }), { t: 0, o: 0, n: 0, tn: 0 });
  const nBehind = rows.filter((r) => r.status === 'behind').length, nRisk = rows.filter((r) => r.status === 'at_risk').length;
  return (
    <View style={{ gap: adminSpace.lg }}>
      <FloatCard fl={fl} err={flErr} onRetry={load} compact />
      <Row gap={adminSpace.md} style={{ flexWrap: 'wrap' }}>
        <StatCard index={0} icon="flag-outline" label="Order vs target (bulan ini)" value={`${tot.o.toLocaleString('id-ID')} / ${tot.t.toLocaleString('id-ID')}`} hint={tot.t ? pctId((tot.o / tot.t) * 100) + ' dari target semua kota' : 'belum ada target — minta ops mengisi'} color={adminTone.blue} />
        <StatCard index={1} icon="cash-outline" label="NPR vs target" value={rupiah(tot.n)} hint={tot.tn ? `target ${rupiah(tot.tn)} (${pctId((tot.n / tot.tn) * 100)})` : 'NPR = pendapatan platform − PPN − promo'} color={adminTone.teal} />
        <StatCard index={2} icon="warning-outline" label="Kota behind / at risk" value={`${nBehind} / ${nRisk}`} hint={`${rows.length} kota bertarget · pro-rata ${rows[0]?.prorata_pct != null ? pctId(rows[0].prorata_pct) : '—'} bulan berjalan`} color={nBehind ? adminTone.red : nRisk ? adminTone.amber : adminTone.green} />
      </Row>
      <Panel title="Progres target per kota" subtitle="Status: on_track ≥ 100 % pro-rata hari, at_risk 80–100 %, behind < 80 %. COGS/order = biaya tetap kota ÷ target order; rekomendasi biaya layanan = COGS × (1 + margin target), pembulatan Rp500." icon="speedometer-outline" padded={false}>
        {tErr ? <Text style={[af.small, { color: adminTone.red, padding: adminSpace.md }]} selectable>{tErr}</Text> : null}
        <DataTable keyField="city_id" rows={rows as unknown as Record<string, unknown>[]} emptyText={tErr ? 'Tidak bisa membaca progres target' : 'Belum ada target kota bulan ini'} emptyIcon="flag-outline" columns={[
          { key: 'city_name', label: 'Kota', width: 150, render: (r) => { const x = r as unknown as CityTargetProgress; return <View style={{ minWidth: 0 }}><Text style={af.bodyStrong} numberOfLines={1}>{x.city_name || '—'}</Text><Text style={af.tiny} numberOfLines={1}>ops {x.pic_ops || '—'} · fin {x.pic_finance || '—'}</Text></View>; } },
          { key: 'status', label: 'Status', width: 110, render: (r) => { const st = T_STATUS_X[(r.status as CityTargetProgress['status'])] ?? T_STATUS_X.no_target; return <Pill text={st.label} tone={st.tone} />; } },
          { key: 'orders', label: 'Order real / target', width: 150, align: 'right', mono: true, render: (r) => <Text style={af.mono}>{Number(r.actual_orders ?? 0).toLocaleString('id-ID')} / {Number(r.target_orders ?? 0).toLocaleString('id-ID')} ({pctId(Number(r.pct_orders ?? 0))})</Text> },
          { key: 'npr', label: 'NPR real / target', width: 230, align: 'right', mono: true, render: (r) => <Text style={af.mono} numberOfLines={1}>{rupiah(Number(r.actual_npr ?? 0))} / {rupiah(Number(r.target_npr ?? 0))} ({pctId(Number(r.pct_npr ?? 0))})</Text> },
          { key: 'cogs_per_order', label: 'COGS/order', width: 120, align: 'right', mono: true, render: (r) => <Text style={af.mono}>{rupiah(Number(r.cogs_per_order ?? 0))}</Text> },
          { key: 'platform_fee_recommended', label: 'Rek. biaya layanan', width: 150, align: 'right', mono: true, render: (r) => <Text style={[af.mono, { color: adminTone.teal, fontWeight: '700' }]}>{rupiah(Number(r.platform_fee_recommended ?? 0))}</Text> },
        ]} />
      </Panel>
    </View>
  );
}

/* ───────────────── 0118 · KPI Manager Kota untuk eksekutif (exec_city_manager_kpi) ───────────────── */
const BULAN_ID = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const kpiMonthLabel = (m: string) => { const [y, mo] = m.split('-').map(Number); return `${BULAN_ID[mo - 1] ?? mo} ${y}`; };
const kpiShiftMonth = (m: string, delta: number) => { const [y, mo] = m.split('-').map(Number); const d = new Date(Date.UTC(y, mo - 1 + delta, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`; };
const kpiN = (v: unknown) => Number(v ?? 0) || 0;

function CityKpiExecSection({ token, onSessionLost }: { token: string; onSessionLost: () => void }) {
  const [month, setMonth] = useState(monthKey());
  const [rows, setRows] = useState<CityManagerKpiRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(() => {
    setLoading(true);
    execCityManagerKpi(token, month).then((r) => { setRows(r); setErr(null); }).catch((e: Error) => {
      if (String(e.message).includes('EXEC_SESSION')) onSessionLost();
      setRows([]); setErr(`KPI Manager Kota: ${e.message}`);
    }).finally(() => setLoading(false));
  }, [token, month, onSessionLost]);
  useEffect(() => { load(); }, [load]);

  const scored = rankKpi(rows).filter((r) => r.has_target);
  const top = scored.slice(0, 5);
  const bottom = scored.length > 5 ? scored.slice(-5).reverse() : [];
  const avg = scored.length ? scored.reduce((a, r) => a + kpiN(r.score), 0) / scored.length : null;
  const bonus = scored.reduce((a, r) => a + kpiN(r.bonus_earned), 0);
  const grades = scored.reduce((a, r) => { const g = r.grade as KpiGrade | null; if (g && GRADE_COLOR[g]) a[g] = (a[g] ?? 0) + 1; return a; }, {} as Partial<Record<KpiGrade, number>>);
  const noManager = rows.filter((r) => !r.manager_id).length;

  const cols = [
    { key: 'rank', label: '#', width: 44, align: 'right' as const, mono: true, render: (r: Record<string, unknown>) => <Text style={af.mono}>{String(r._rank)}</Text> },
    { key: 'city_name', label: 'Kota · manager', width: 190, render: (r: Record<string, unknown>) => { const x = r as unknown as CityManagerKpiRow; return <View style={{ minWidth: 0 }}><Text style={af.bodyStrong} numberOfLines={1}>{x.city_name}</Text><Text style={af.tiny} numberOfLines={1}>{x.manager_name || 'belum ada manager'}</Text></View>; } },
    { key: 'grade', label: 'Grade', width: 70, align: 'center' as const, render: (r: Record<string, unknown>) => { const g = r.grade as KpiGrade | null; return g && GRADE_COLOR[g] ? <View style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: GRADE_COLOR[g], alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#fff', fontWeight: '800', fontSize: 14 }}>{g}</Text></View> : <Pill text="—" tone="off" />; } },
    { key: 'score', label: 'Skor', width: 76, align: 'right' as const, mono: true, render: (r: Record<string, unknown>) => <Text style={[af.mono, { fontWeight: '700' }]}>{kpiN(r.score).toLocaleString('id-ID', { maximumFractionDigits: 1 })}</Text> },
    ...KPI_COMPONENTS.map((k) => ({
      key: k, label: KPI_LABEL[k], width: 130, align: 'right' as const, mono: true,
      render: (r: Record<string, unknown>) => { const x = r as unknown as CityManagerKpiRow; const p = x.pct?.[k]; return <View style={{ alignItems: 'flex-end' }}><Text style={af.mono}>{kpiN(x.actual?.[k]).toLocaleString('id-ID')} / {kpiN(x.targets?.[k]).toLocaleString('id-ID')}</Text>{p == null ? <Text style={af.tiny}>tanpa target</Text> : <Text style={[af.tiny, { color: Number(p) >= 100 ? adminTone.green : Number(p) >= 80 ? adminTone.amber : adminTone.red, fontWeight: '700' }]}>{pctId(Number(p))}</Text>}</View>; },
    })),
    { key: 'bonus_earned', label: 'Bonus diraih', width: 130, align: 'right' as const, mono: true, render: (r: Record<string, unknown>) => <Text style={[af.mono, { color: adminTone.teal, fontWeight: '700' }]}>{rupiah(kpiN(r.bonus_earned))}</Text> },
  ];
  const withRank = (xs: CityManagerKpiRow[]) => xs.map((x) => ({ ...x, _rank: scored.indexOf(x) + 1 })) as unknown as Record<string, unknown>[];

  return (
    <View style={{ gap: adminSpace.lg }}>
      <Row gap={8} style={{ flexWrap: 'wrap', alignItems: 'center' }}>
        <Button size="sm" variant="outline" icon="chevron-back" title="" onPress={() => setMonth((m) => kpiShiftMonth(m, -1))} />
        <Text style={af.h3}>{kpiMonthLabel(month)}</Text>
        <Button size="sm" variant="outline" icon="chevron-forward" title="" disabled={month >= monthKey()} onPress={() => setMonth((m) => (kpiShiftMonth(m, 1) > monthKey() ? m : kpiShiftMonth(m, 1)))} />
        {month !== monthKey() ? <Button size="sm" variant="ghost" title="Bulan ini" onPress={() => setMonth(monthKey())} /> : null}
        {loading ? <Text style={af.tiny}>Memuat…</Text> : null}
      </Row>
      {err ? <Text style={[af.small, { color: adminTone.red }]} selectable>{err}</Text> : null}
      <Row gap={adminSpace.md} style={{ flexWrap: 'wrap' }}>
        <StatCard index={0} icon="flag-outline" label="Kota bertarget" value={scored.length} hint={`dari ${rows.length} kota · ${noManager} tanpa manager`} color={adminTone.blue} />
        <StatCard index={1} icon="speedometer-outline" label="Rata-rata skor" value={avg == null ? '—' : avg.toLocaleString('id-ID', { maximumFractionDigits: 1 })} hint={`0–120 berbobot · grade ${KPI_GRADE_RULE}`} color={avg == null ? adminTone.slate : avg >= 80 ? adminTone.green : avg >= 60 ? adminTone.amber : adminTone.red} />
        <StatCard index={2} icon="cash-outline" label="Total bonus diraih" value={rupiah(bonus)} hint={`pool ${rupiah(scored.reduce((a, r) => a + kpiN(r.bonus_pool), 0))}`} color={adminTone.teal} />
        <StatCard index={3} icon="ribbon-outline" label="Sebaran grade" value={(['A', 'B', 'C', 'D'] as KpiGrade[]).map((g) => `${g}${grades[g] ?? 0}`).join(' · ')} hint="jumlah kota per grade" color={adminTone.violet} />
      </Row>
      <Panel title="5 kota teratas" subtitle="Skor tertinggi bulan ini — kandidat bonus penuh." icon="trophy-outline" iconColor={adminTone.green} padded={false}>
        <DataTable keyField="city_id" rows={withRank(top)} emptyText={loading ? 'Memuat…' : err ? 'Tidak bisa membaca KPI' : 'Belum ada kota bertarget bulan ini — minta ops mengisi target di Panel Admin › KPI Manager Kota'} emptyIcon="trophy-outline" columns={cols} />
      </Panel>
      <Panel title="5 kota terbawah" subtitle="Skor terendah — butuh tindak lanjut manager / Perwakilan Kota." icon="trending-down-outline" iconColor={adminTone.red} padded={false}>
        <DataTable keyField="city_id" rows={withRank(bottom)} emptyText={scored.length <= 5 ? 'Semua kota bertarget sudah tampil di tabel teratas' : 'Belum ada data'} emptyIcon="trending-down-outline" columns={cols} />
      </Panel>
      <FootNote lines={[
        `Sumber: exec_city_manager_kpi(p_exec_token, p_month), migrasi 0118. Capaian per komponen dibatasi 120 %; skor = Σ bobot × capaian ÷ Σ bobot komponen bertarget; grade ${KPI_GRADE_RULE}.`,
        'Bonus diraih = bonus pool × min(skor,120)/100 bila skor ≥ 60, selain itu 0 [ASUMSI skema bonus di 0118 — menunggu keputusan GM]; pembayaran tetap lewat GM/Direksi dan payroll, tidak otomatis.',
        'Kota tanpa target tidak diberi skor dan tidak masuk peringkat.',
      ]} />
    </View>
  );
}
