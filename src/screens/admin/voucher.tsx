// Admin · AntarVoucher (migrasi 0112, branch antarvoucher-v4) — saldo tertutup yang dibeli lewat transfer ke rekening resmi PT.
//   • Antrean: rpc('admin_voucher_queue', { p_status }) → { purchases[], mutations[], summary }.
//   • Mutasi bank: admin_voucher_mutation_add (auto-match jumlah + kode unik) · admin_voucher_match (manual)
//     · admin_voucher_mutation_refund (mutasi tanpa pembelian) · admin_voucher_mutation_refund_done (ref transfer balik).
//   • Penerbitan: admin_voucher_approve (checker ≠ pencocok) · admin_voucher_reject.
//   • Refund voucher terbit: admin_voucher_refund_request (maker) → admin_voucher_refund_execute (checker ≠ maker).
//   • Rekening resmi: admin_voucher_bank_list / _upsert / _verify('finance'|'legal').
//   • Rekonsiliasi: admin_wallet_reconcile(p_from, p_to). Sakelar: admin_set_antarvoucher_purchase_enabled.
// Semua aksi yang mengubah data butuh PIN panel (admin_require_unlock) + izin RBAC; server penentu akhir.
// PRINSIP: saldo HANYA terbit dari mutasi bank yang tercocok — bukti/screenshot tidak pernah menambah saldo.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, Switch, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import {
  AdminPage, Panel, DataTable, Toolbar, FilterBar, StatCard, Pill, AdminDialog, ReasonPrompt, RequirePerm, RowActions, AdminSelect,
  adminFont as font, adminTone, adminSpace, adminIcon, adminRadius, adminTable, TONE, type RowAction, type ToneKey,
} from '@/components/admin';
import { DateField, FootNote, RANGE_PRESETS, presetRange, rangeError, rangeLabel, type DateRange, type RangePreset } from '@/components/reports';
import { Row, Button, Input, toast } from '@/components/ui';
import { rpc, supabase } from '@/lib/supabase';
import { colors } from '@/lib/theme';
import { rupiah } from '@/lib/format';
import { useAuth } from '@/store/auth';
import { handleAdminError, useAdminSecurity } from '@/store/adminSecurity';
import { asList, shortId, todayWib, useAdminCan } from '@/lib/admin';
import { ErrorNote, fmtDate, fmtAgo, moneyCol, Trunc, WideTableHint, usePager, Pager } from './_shared';

/* ───────────────────────────── Tipe (kontrak 0112) ───────────────────────────── */

type PurchaseStatus =
  | 'awaiting_transfer' | 'submitted' | 'matched' | 'amount_mismatch' | 'issued' | 'expired' | 'cancelled'
  | 'rejected' | 'refund_requested' | 'refund_pending' | 'refunded' | 'disputed';
type MutationStatus = 'unmatched' | 'matched' | 'refund_pending' | 'refunded' | 'ignored';

interface Purchase {
  id: string; reference: string; user_id: string; user_name?: string | null; bank_account_id: string; bank_name?: string | null;
  nominal: number; unique_code: number; transfer_amount: number; status: PurchaseStatus; expires_at: string;
  sender_name: string | null; sender_bank: string | null; submitted_at: string | null; mutation_id: string | null; received_amount: number | null;
  matched_by: string | null; matched_at: string | null; approved_by: string | null; approved_at: string | null; issued_amount: number | null;
  refund_requested_by: string | null; refund_amount: number | null; refund_bank_ref: string | null; reason: string | null; created_at: string;
}
interface Mutation {
  id: string; bank_account_id: string; bank_name?: string | null; bank_ref: string; amount: number; trx_at: string; sender_name: string | null;
  raw_note: string | null; status: MutationStatus; purchase_id: string | null; entered_by: string | null; refund_reason: string | null;
  refund_bank_ref: string | null; refunded_by: string | null; created_at: string;
}
interface Summary { awaiting: number; to_approve: number; unmatched_mutations: number; refund_pending: number; disputed: number; float_customer: number; float_cap: number }
interface Queue { purchases: Purchase[]; mutations: Mutation[]; summary: Summary }
interface BankAccount {
  id: string; bank_code: string; bank_name: string; account_no: string | null; account_name: string | null; is_placeholder: boolean; active: boolean;
  display_order: number; finance_verified_by: string | null; finance_verified_at: string | null; legal_verified_by: string | null; legal_verified_at: string | null;
  note: string | null; updated_at: string; public_ok: boolean;
}
interface Reconcile {
  from: string; to: string; ok: boolean; voucher_terbit: number; mutasi_bank_tercocok: number; selisih_voucher_vs_bank: number;
  mutasi_belum_tercocok: number; dana_wajib_dikembalikan: number; float_pelanggan: number; jumlah_dompet_tidak_seimbang: number;
  dompet_tidak_seimbang: { user_id: string; balance: number; sum_mutasi: number; selisih: number }[];
}
interface VoucherStatus { enabled: boolean; purchase_enabled: boolean; banks_ready: number; min: number; max: number; ttl_hours: number }

const P_STATUS: Record<PurchaseStatus, { label: string; tone: ToneKey }> = {
  awaiting_transfer: { label: 'Menunggu transfer', tone: 'wait' },
  submitted: { label: 'Pelanggan lapor transfer', tone: 'info' },
  matched: { label: 'Tercocok · siap terbit', tone: 'brand' },
  amount_mismatch: { label: 'Nominal tidak sama', tone: 'bad' },
  issued: { label: 'Voucher terbit', tone: 'ok' },
  expired: { label: 'Kedaluwarsa', tone: 'off' },
  cancelled: { label: 'Dibatalkan', tone: 'off' },
  rejected: { label: 'Ditolak', tone: 'bad' },
  refund_requested: { label: 'Refund diajukan', tone: 'wait' },
  refund_pending: { label: 'Refund diproses', tone: 'wait' },
  refunded: { label: 'Sudah direfund', tone: 'neutral' },
  disputed: { label: 'Sengketa', tone: 'bad' },
};
const M_STATUS: Record<MutationStatus, { label: string; tone: ToneKey }> = {
  unmatched: { label: 'Belum tercocok', tone: 'wait' },
  matched: { label: 'Tercocok', tone: 'ok' },
  refund_pending: { label: 'Wajib dikembalikan', tone: 'bad' },
  refunded: { label: 'Sudah dikembalikan', tone: 'off' },
  ignored: { label: 'Diabaikan', tone: 'off' },
};
const MATCHABLE: PurchaseStatus[] = ['awaiting_transfer', 'submitted', 'expired', 'disputed'];
const NOT_REJECTABLE: PurchaseStatus[] = ['issued', 'refunded', 'refund_pending', 'refund_requested'];

const P_FILTERS: { key: string; label: string; match: (s: PurchaseStatus) => boolean }[] = [
  { key: 'open', label: 'Menunggu dana', match: (s) => s === 'awaiting_transfer' || s === 'submitted' },
  { key: 'approve', label: 'Siap diterbitkan', match: (s) => s === 'matched' || s === 'amount_mismatch' },
  { key: 'disputed', label: 'Sengketa', match: (s) => s === 'disputed' },
  { key: 'refund', label: 'Refund', match: (s) => s === 'refund_requested' || s === 'refund_pending' || s === 'refunded' },
  { key: 'issued', label: 'Terbit', match: (s) => s === 'issued' },
  { key: 'closed', label: 'Selesai tanpa terbit', match: (s) => s === 'expired' || s === 'cancelled' || s === 'rejected' },
  { key: 'all', label: 'Semua', match: () => true },
];
const M_FILTERS: { key: string; label: string }[] = [
  { key: 'unmatched', label: 'Belum tercocok' }, { key: 'refund_pending', label: 'Wajib dikembalikan' },
  { key: 'matched', label: 'Tercocok' }, { key: 'refunded', label: 'Sudah dikembalikan' }, { key: 'all', label: 'Semua' },
];
const TABS = [
  { key: 'queue', label: 'Antrean pembelian' }, { key: 'mutations', label: 'Mutasi bank' }, { key: 'banks', label: 'Rekening resmi' },
  { key: 'reconcile', label: 'Rekonsiliasi' }, { key: 'switch', label: 'Sakelar pembelian' },
];

const nowHm = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(11, 16);
const digits = (v: string) => v.replace(/\D/g, '');
const settingText = (v: unknown) => String(v ?? '').replace(/^"|"$/g, '');

/** Jalankan aksi yang mengubah data: PIN dulu → RPC → toast sukses → muat ulang; galat lewat handleAdminError. */
async function runAction(fn: () => Promise<unknown>, ok: string | ((r: unknown) => string), reload: () => Promise<void> | void): Promise<boolean> {
  if (!(await useAdminSecurity.getState().ensureUnlocked())) return false;
  try {
    const r = await fn();
    toast.success(typeof ok === 'function' ? ok(r) : ok);
    await reload();
    return true;
  } catch (e) { handleAdminError(e); return false; }
}

/** Kotak catatan berwarna (peringatan / info) — tetap terbaca di layar sempit. */
function Note({ tone = 'info', icon = 'information-circle-outline', title, children }: { tone?: ToneKey; icon?: React.ComponentProps<typeof Ionicons>['name']; title?: string; children?: React.ReactNode }) {
  const t = TONE[tone];
  return (
    <View style={[s.note, { backgroundColor: t.bg, borderColor: t.border }]}>
      <Row gap={10} style={{ alignItems: 'flex-start' }}>
        <Ionicons name={icon} size={adminIcon.lg} color={t.fg} style={{ marginTop: 1 }} />
        <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
          {title ? <Text style={[font.bodyStrong, { color: t.fg }]}>{title}</Text> : null}
          {React.Children.toArray(children).every((c) => typeof c === 'string' || typeof c === 'number')
            ? <Text style={[font.body, { color: adminTone.ink2 }]}>{children}</Text>
            : children}
        </View>
      </Row>
    </View>
  );
}

/* ───────────────────────────── Halaman ───────────────────────────── */

export default function AdminVoucher() {
  const [tab, setTab] = useState('queue');
  const [q, setQ] = useState<Queue | null>(null);
  const [banks, setBanks] = useState<BankAccount[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [queue, bl] = await Promise.all([
        rpc<Queue>('admin_voucher_queue', { p_status: null }),
        rpc<unknown>('admin_voucher_bank_list'),
      ]);
      setQ({ purchases: asList<Purchase>(queue?.purchases), mutations: asList<Mutation>(queue?.mutations), summary: queue?.summary ?? ({} as Summary) });
      setBanks(asList<BankAccount>(bl));
      setErr(null);
    } catch (e) { setErr((e as Error).message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const sm = q?.summary;
  const floatCap = Number(sm?.float_cap ?? 0), floatNow = Number(sm?.float_customer ?? 0);
  const floatPct = floatCap > 0 ? (floatNow / floatCap) * 100 : 0;

  return (
    <AdminPage title="AntarVoucher" subtitle="Pembelian saldo tertutup lewat transfer ke rekening resmi PT · pencocokan mutasi bank · maker-checker · semua aksi butuh PIN panel" onRefresh={load}
      right={<Button size="sm" variant="outline" title="Segarkan" icon="refresh-outline" onPress={load} />}>
      <RequirePerm perm={['reconcile', 'wallet_adjust', 'payments_view']} mode="notice">
        <Note tone="brand" icon="shield-checkmark-outline" title="Saldo hanya terbit dari mutasi bank yang tercocok — bukti/screenshot tidak menambah saldo">
          <Text style={font.body}>
            Alur: Finance mencatat mutasi dari rekening koran → sistem mencocokkan jumlah + kode unik (atau dicocokkan manual) → admin LAIN menerbitkan voucher.
            Maker-checker: penerbit harus berbeda dari pencocok mutasi, dan eksekutor refund harus berbeda dari pengajunya. Tombol dinonaktifkan bila Anda pelaku langkah sebelumnya.
          </Text>
        </Note>

        <Row gap={adminSpace.md} style={{ flexWrap: 'wrap' }}>
          <StatCard index={0} icon="hourglass-outline" label="Menunggu dana" value={Number(sm?.awaiting ?? 0)} hint="menunggu transfer / dilaporkan pelanggan" color={adminTone.amber} onPress={() => setTab('queue')} />
          <StatCard index={1} icon="checkmark-done-outline" label="Siap diterbitkan" value={Number(sm?.to_approve ?? 0)} hint="mutasi sudah tercocok · butuh checker" color={adminTone.teal} onPress={() => setTab('queue')} />
          <StatCard index={2} icon="swap-vertical-outline" label="Mutasi belum tercocok" value={Number(sm?.unmatched_mutations ?? 0)} hint="cocokkan atau kembalikan dana" color={adminTone.blue} onPress={() => setTab('mutations')} />
          <StatCard index={3} icon="return-down-back-outline" label="Dana wajib dikembalikan" value={Number(sm?.refund_pending ?? 0)} hint="mutasi berstatus refund" color={Number(sm?.refund_pending ?? 0) > 0 ? adminTone.red : adminTone.green} onPress={() => setTab('mutations')} />
          <StatCard index={4} icon="alert-circle-outline" label="Sengketa" value={Number(sm?.disputed ?? 0)} hint="dilaporkan pelanggan" color={Number(sm?.disputed ?? 0) > 0 ? adminTone.red : adminTone.slate} onPress={() => setTab('queue')} />
          <StatCard index={5} icon="speedometer-outline" label="Float saldo pelanggan" value={rupiah(floatNow)}
            hint={`${floatPct.toLocaleString('id-ID', { maximumFractionDigits: 1 })}% dari batas ${rupiah(floatCap)} · batas kajian izin PJP`}
            color={floatPct >= 90 ? adminTone.red : floatPct >= 75 ? adminTone.amber : adminTone.violet} />
        </Row>

        <FilterBar options={TABS} value={tab} onChange={setTab} />
        <ErrorNote text={err} onRetry={load} />

        {tab === 'queue' ? <QueueTab q={q} loading={loading} reload={load} /> : null}
        {tab === 'mutations' ? <MutationsTab q={q} banks={banks} loading={loading} reload={load} /> : null}
        {tab === 'banks' ? <BanksTab banks={banks} loading={loading} reload={load} /> : null}
        {tab === 'reconcile' ? <ReconcileTab /> : null}
        {tab === 'switch' ? <SwitchTab banks={banks} /> : null}
      </RequirePerm>
    </AdminPage>
  );
}

/* ───────────────────────────── (a) Antrean pembelian ───────────────────────────── */

function QueueTab({ q, loading, reload }: { q: Queue | null; loading: boolean; reload: () => Promise<void> }) {
  const me = useAuth((st) => st.session?.user.id ?? null);
  const can = useAdminCan();
  const [filter, setFilter] = useState('approve');
  const [busy, setBusy] = useState<string | null>(null);
  const [approve, setApprove] = useState<Purchase | null>(null);
  const [note, setNote] = useState('');
  const [reject, setReject] = useState<Purchase | null>(null);
  const [refundReq, setRefundReq] = useState<Purchase | null>(null);
  const [exec, setExec] = useState<Purchase | null>(null);
  const [match, setMatch] = useState<Purchase | null>(null);
  const [detail, setDetail] = useState<Purchase | null>(null);

  const purchases = q?.purchases ?? [];
  const mutations = q?.mutations ?? [];
  const f = P_FILTERS.find((x) => x.key === filter) ?? P_FILTERS[0];
  const rows = useMemo(() => purchases.filter((p) => f.match(p.status)), [purchases, f]);
  const pg = usePager(rows, 50);
  const mutById = useMemo(() => new Map(mutations.map((m) => [m.id, m])), [mutations]);

  const who = (id: string | null) => (id ? `${shortId(id)}${id === me ? ' (Anda)' : ''}` : '—');
  const act = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try { return await runAction(fn, ok, reload); } finally { setBusy(null); }
  };

  const doApprove = async () => {
    if (!approve) return;
    const got = Number(approve.received_amount ?? 0);
    if (await act(`a:${approve.id}`, () => rpc('admin_voucher_approve', { p_purchase: approve.id, p_note: note.trim() || null }),
      `AntarVoucher ${approve.reference} terbit ${rupiah(got)} — saldo pelanggan bertambah`)) setApprove(null);
  };
  const doReject = async (reason: string) => {
    if (!reject) return;
    const hadMutation = !!reject.mutation_id;
    if (await act(`r:${reject.id}`, () => rpc('admin_voucher_reject', { p_purchase: reject.id, p_reason: reason }),
      hadMutation ? `Pembelian ${reject.reference} ditolak — mutasi bank terkait wajib dikembalikan (tab Mutasi bank)` : `Pembelian ${reject.reference} ditolak`)) setReject(null);
  };
  const doRefundReq = async (reason: string) => {
    if (!refundReq) return;
    if (await act(`q:${refundReq.id}`, () => rpc('admin_voucher_refund_request', { p_purchase: refundReq.id, p_reason: reason }),
      `Refund ${refundReq.reference} diajukan — eksekusi harus oleh admin lain`)) setRefundReq(null);
  };
  const doExec = async () => {
    if (!exec) return;
    if (await act(`x:${exec.id}`, () => rpc('admin_voucher_refund_execute', { p_purchase: exec.id }),
      `Refund ${exec.reference} dieksekusi — saldo dipotong; transfer balik lalu tandai di tab Mutasi bank`)) setExec(null);
  };

  const expiredSoon = (p: Purchase) => (p.status === 'awaiting_transfer' || p.status === 'submitted') && new Date(p.expires_at).getTime() - Date.now() < 3 * 3600e3;

  return (
    <>
      {/* Hitungan dipindah ke judul panel: sebagai `right` Toolbar ia menjepit FilterBar di layar ponsel (390 px → hanya "Menunggu d…" terlihat). */}
      <Toolbar>
        <FilterBar options={P_FILTERS.map(({ key, label }) => ({ key, label }))} value={filter} onChange={setFilter} />
      </Toolbar>

      <Panel title={`Pembelian voucher (${rows.length} dari ${purchases.length})`} subtitle="Maks 200 terbaru. Klik baris untuk detail. Terbitkan hanya setelah mutasi bank tercocok; nominal yang terbit = dana yang benar-benar diterima (termasuk kode unik)." icon="ticket-outline" padded={false}>
        <DataTable rows={pg.rows as unknown as Record<string, unknown>[]} emptyText={loading ? 'Memuat…' : 'Tidak ada pembelian pada filter ini'} emptyIcon="ticket-outline"
          onRowPress={(r) => setDetail(r as unknown as Purchase)}
          columns={[
            // Lebar total ±880 px. Diukur (audit UI 25/09): area konten di 1366 px (sidebar terbuka) hanya ±1.070 px, dan
            // susunan lama 8 kolom (±1.170 px) membuat kolom Kedaluwarsa terpotong & kolom Aksi ("Terbitkan") di luar layar
            // tanpa petunjuk geser. Transfer + Diterima digabung; Kedaluwarsa pindah ke bawah status.
            // Kolom pelanggan SENGAJA lebar tetap (bukan flex): di ScrollView horizontal, kolom flex melebar selebar nama
            // terpanjang (max-content) sehingga tabel kembali melampaui layar.
            { key: 'reference', label: 'Referensi', width: 144, render: (r) => { const x = r as unknown as Purchase; return <View style={{ minWidth: 0, alignSelf: 'stretch' }}><Trunc style={font.bodyStrong} title={x.reference}>{x.reference}</Trunc><Text style={font.tiny}>{fmtAgo(x.created_at)}</Text></View>; } },
            { key: 'user_name', label: 'Pelanggan · bank', width: 220, render: (r) => { const x = r as unknown as Purchase; return <View style={{ minWidth: 0, alignSelf: 'stretch' }}><Trunc style={font.body} title={x.user_name ?? ''}>{x.user_name ?? shortId(x.user_id)}</Trunc><Trunc style={font.tiny} title={x.bank_name ?? ''}>{x.bank_name ?? '—'}{x.sender_name ? ` · pengirim ${x.sender_name}` : ''}</Trunc></View>; } },
            { key: 'nominal', label: 'Nominal', width: 116, align: 'right', mono: true, render: (r) => { const x = r as unknown as Purchase; return <View style={{ alignItems: 'flex-end' }}><Text style={font.mono}>{rupiah(x.nominal)}</Text><Text style={font.tiny}>kode unik {String(x.unique_code).padStart(3, '0')}</Text></View>; } },
            { key: 'transfer_amount', label: 'Transfer', width: 132, align: 'right', mono: true, render: (r) => { const x = r as unknown as Purchase; const bad = x.received_amount != null && Number(x.received_amount) !== Number(x.transfer_amount); return <View style={{ alignItems: 'flex-end' }}><Text style={font.mono}>{rupiah(Number(x.transfer_amount))}</Text>{x.received_amount == null ? <Text style={font.tiny}>belum ada mutasi</Text> : <Text style={[font.tiny, { color: bad ? adminTone.red : adminTone.ink2 }]}>diterima {rupiah(Number(x.received_amount))}</Text>}</View>; } },
            { key: 'status', label: 'Status · batas', width: 160, render: (r) => { const x = r as unknown as Purchase; const st = P_STATUS[x.status] ?? { label: x.status, tone: 'neutral' as ToneKey }; return <View style={{ gap: 3, minWidth: 0, alignSelf: 'stretch' }}><Pill text={st.label} tone={st.tone} />{x.reason ? <Trunc style={font.tiny} title={x.reason}>{x.reason}</Trunc> : null}<Text style={[font.tiny, expiredSoon(x) && { color: adminTone.red }]}>s.d. {fmtDate(x.expires_at)}</Text></View>; } },
            { key: 'actions', label: 'Aksi', width: adminTable.actionsWideW, align: 'right', render: (r) => {
              const x = r as unknown as Purchase;
              const isMatcher = !!me && x.matched_by === me;
              const isRequester = !!me && x.refund_requested_by === me;
              const main: RowAction | null =
                (x.status === 'matched' || x.status === 'amount_mismatch') && can('wallet_adjust')
                  ? { key: 'ap', label: 'Terbitkan', icon: 'checkmark', variant: 'solid', color: colors.success, disabled: isMatcher, busy: busy === `a:${x.id}`,
                    title: isMatcher ? 'Anda yang mencocokkan mutasi ini — penerbitan harus oleh admin lain' : 'Terbitkan voucher', onPress: () => { setNote(''); setApprove(x); } }
                : x.status === 'refund_requested' && can('refund_execute')
                  ? { key: 'ex', label: 'Eksekusi refund', icon: 'send-outline', variant: 'solid', color: adminTone.teal, disabled: isRequester, busy: busy === `x:${x.id}`,
                    title: isRequester ? 'Anda pengaju refund ini — eksekusi harus oleh admin lain' : 'Eksekusi refund', onPress: () => setExec(x) }
                : x.status === 'issued' && can('refund')
                  ? { key: 'rq', label: 'Ajukan refund', icon: 'return-down-back-outline', variant: 'soft', busy: busy === `q:${x.id}`, onPress: () => setRefundReq(x) }
                : MATCHABLE.includes(x.status) && can('reconcile')
                  ? { key: 'mt', label: 'Cocokkan', icon: 'git-compare-outline', variant: 'soft', onPress: () => setMatch(x) }
                : null;
              return (
                <RowActions
                  primary={[main, { key: 'dt', label: 'Detail', icon: 'document-text-outline', onPress: () => setDetail(x) }]}
                  menu={[
                    MATCHABLE.includes(x.status) && can('reconcile') && main?.key !== 'mt' && { key: 'mt', label: 'Cocokkan dengan mutasi…', icon: 'git-compare-outline', onPress: () => setMatch(x) },
                    !NOT_REJECTABLE.includes(x.status) && x.status !== 'rejected' && x.status !== 'cancelled' && can('reconcile') && { key: 'rj', label: 'Tolak pembelian…', icon: 'close-circle-outline', danger: true, hint: x.mutation_id ? 'mutasi terkait wajib dikembalikan' : undefined, onPress: () => setReject(x) },
                  ]}
                />
              );
            } },
          ]} />
        <View style={{ padding: adminSpace.md, gap: 6 }}><WideTableHint /><Pager p={pg} noun="pembelian" /></View>
      </Panel>

      <FootNote lines={[
        'Kode unik (1–999) ditambahkan ke nominal supaya setiap transfer bisa dicocokkan otomatis per rekening. Voucher terbit sebesar dana yang benar-benar masuk (nominal + kode unik).',
        'Status "Pelanggan lapor transfer" hanya informasi dari pelanggan — BUKAN bukti dana masuk. Saldo baru bertambah setelah mutasi rekening koran dicatat, tercocok, dan disetujui admin lain.',
        'Penerbitan ditahan server (VOUCHER_FLOAT_CAP) bila total saldo pelanggan akan melampaui batas float — batas kajian izin PJP.',
        'Refund voucher terbit: maker mengajukan → checker (admin lain) mengeksekusi; hanya saldo yang belum terpakai yang dikembalikan. Setiap aksi tercatat di Log Audit.',
      ]} />

      <AdminDialog visible={!!approve} onClose={() => setApprove(null)} title="Terbitkan AntarVoucher?" tone={colors.success}
        subtitle={approve ? `${approve.reference} · ${approve.user_name ?? shortId(approve.user_id)} · ${approve.bank_name ?? '—'}` : undefined}>
        {approve ? (
          <View style={{ gap: 10 }}>
            <Row between><Text style={font.body}>Harus ditransfer</Text><Text style={font.mono}>{rupiah(approve.transfer_amount)}</Text></Row>
            <Row between><Text style={font.body}>Diterima (mutasi {approve.mutation_id ? mutById.get(approve.mutation_id)?.bank_ref ?? shortId(approve.mutation_id) : '—'})</Text><Text style={[font.mono, { color: TONE.ok.fg }]}>{rupiah(Number(approve.received_amount ?? 0))}</Text></Row>
            <Row between style={{ borderTopWidth: 1, borderTopColor: adminTone.border, paddingTop: 6 }}><Text style={font.bodyStrong}>Saldo yang terbit</Text><Text style={font.mono}>{rupiah(Number(approve.received_amount ?? 0))}</Text></Row>
            {approve.status === 'amount_mismatch' ? (
              <Note tone="bad" icon="warning-outline" title="Nominal diterima berbeda dari yang harus ditransfer">
                Voucher akan terbit sebesar dana yang diterima ({rupiah(Number(approve.received_amount ?? 0))}). Bila ragu, tolak pembelian — mutasi akan masuk daftar dana wajib dikembalikan.
              </Note>
            ) : null}
            <Text style={font.small}>Pencocok mutasi: {who(approve.matched_by)} · {fmtDate(approve.matched_at)}. Anda harus admin yang berbeda (maker-checker).</Text>
            <Input label="Catatan (opsional)" placeholder="mis. dicek dengan rekening koran BRI 25/09" value={note} onChangeText={setNote} />
            <Row gap={8} style={{ justifyContent: 'flex-end' }}>
              <Button size="sm" variant="ghost" title="Batal" onPress={() => setApprove(null)} />
              <Button size="sm" title="Terbitkan voucher" icon="checkmark" color={colors.success} loading={busy === `a:${approve.id}`} onPress={doApprove} />
            </Row>
          </View>
        ) : null}
      </AdminDialog>

      <AdminDialog visible={!!exec} onClose={() => setExec(null)} title="Eksekusi refund voucher?" tone={adminTone.teal}
        subtitle={exec ? `${exec.reference} · terbit ${rupiah(Number(exec.issued_amount ?? 0))} · diajukan oleh ${who(exec.refund_requested_by)}` : undefined}>
        {exec ? (
          <View style={{ gap: 10 }}>
            <Text style={font.body}>Saldo pelanggan dipotong sebesar sisa yang belum terpakai (maks {rupiah(Number(exec.issued_amount ?? 0))}). Setelah itu Finance mentransfer dana kembali ke rekening pengirim, lalu menandai mutasinya "sudah dikembalikan" di tab Mutasi bank.</Text>
            {exec.reason ? <Text style={font.small}>Alasan: {exec.reason}</Text> : null}
            <Row gap={8} style={{ justifyContent: 'flex-end' }}>
              <Button size="sm" variant="ghost" title="Batal" onPress={() => setExec(null)} />
              <Button size="sm" title="Eksekusi refund" icon="send-outline" loading={busy === `x:${exec.id}`} onPress={doExec} />
            </Row>
          </View>
        ) : null}
      </AdminDialog>

      <ReasonPrompt visible={!!reject} title={`Tolak pembelian ${reject?.reference ?? ''}?`}
        subtitle={reject?.mutation_id ? 'Mutasi bank yang sudah tercocok akan dilepas dan wajib dikembalikan ke pengirim.' : 'Alasan tersimpan di log dan terlihat oleh pelanggan.'}
        onCancel={() => setReject(null)} onSubmit={doReject} confirmLabel="Tolak pembelian"
        quick={['Dana tidak ditemukan di rekening koran', 'Nominal tidak sesuai', 'Nama pengirim tidak sesuai / indikasi penipuan', 'Pembelian ganda', 'Permintaan pelanggan']} />

      <ReasonPrompt visible={!!refundReq} title={`Ajukan refund ${refundReq?.reference ?? ''}?`} subtitle="Eksekusi harus oleh admin lain (maker-checker). Hanya saldo yang belum terpakai yang dikembalikan."
        onCancel={() => setRefundReq(null)} onSubmit={doRefundReq} confirmLabel="Ajukan refund" color={adminTone.amber}
        quick={['Permintaan pelanggan (saldo belum terpakai)', 'Salah penerbitan', 'Sengketa diselesaikan dengan pengembalian dana']} />

      <MatchDialog purchase={match} purchases={purchases} mutations={mutations} onClose={() => setMatch(null)} reload={reload} />

      <AdminDialog visible={!!detail} onClose={() => setDetail(null)} width={620} title={`Pembelian ${detail?.reference ?? ''}`}
        subtitle={detail ? `${P_STATUS[detail.status]?.label ?? detail.status} · ${detail.user_name ?? shortId(detail.user_id)} · ${detail.bank_name ?? '—'}` : undefined}>
        {detail ? (
          <ScrollView style={{ maxHeight: 460 }} contentContainerStyle={{ gap: 6 }}>
            {([
              ['Nominal', rupiah(detail.nominal)], ['Kode unik', String(detail.unique_code).padStart(3, '0')], ['Harus ditransfer', rupiah(detail.transfer_amount)],
              ['Diterima', detail.received_amount != null ? rupiah(Number(detail.received_amount)) : '—'], ['Terbit', detail.issued_amount != null ? rupiah(Number(detail.issued_amount)) : '—'],
              ['Dibuat', fmtDate(detail.created_at)], ['Kedaluwarsa', fmtDate(detail.expires_at)],
              ['Lapor transfer', detail.submitted_at ? `${fmtDate(detail.submitted_at)} · ${detail.sender_name ?? '—'} (${detail.sender_bank ?? '—'})` : '—'],
              ['Mutasi bank', detail.mutation_id ? mutById.get(detail.mutation_id)?.bank_ref ?? shortId(detail.mutation_id) : '—'],
              ['Dicocokkan', detail.matched_by ? `${who(detail.matched_by)} · ${fmtDate(detail.matched_at)}` : '—'],
              ['Diterbitkan', detail.approved_by ? `${who(detail.approved_by)} · ${fmtDate(detail.approved_at)}` : '—'],
              ['Refund', detail.refund_requested_by ? `diajukan ${who(detail.refund_requested_by)} · ${detail.refund_amount != null ? rupiah(Number(detail.refund_amount)) : '—'}${detail.refund_bank_ref ? ` · ref ${detail.refund_bank_ref}` : ''}` : '—'],
              ['Catatan / alasan', detail.reason ?? '—'],
            ] as [string, string][]).map(([k, v]) => (
              <Row key={k} between style={{ gap: 12, alignItems: 'flex-start' }}>
                <Text style={[font.small, { width: 140 }]}>{k}</Text>
                <Text selectable style={[font.body, { flex: 1, textAlign: 'right' }]}>{v}</Text>
              </Row>
            ))}
          </ScrollView>
        ) : null}
      </AdminDialog>
    </>
  );
}

/* ───────────────────────────── Dialog pencocokan (dua arah) ───────────────────────────── */

function MatchDialog({ purchase, mutation, purchases, mutations, onClose, reload }: {
  purchase?: Purchase | null; mutation?: Mutation | null; purchases: Purchase[]; mutations: Mutation[]; onClose: () => void; reload: () => Promise<void>;
}) {
  const visible = !!purchase || !!mutation;
  const [pick, setPick] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (visible) { setPick(null); setNote(''); } }, [visible, purchase?.id, mutation?.id]);

  // Dari mutasi → pilih pembelian; dari pembelian → pilih mutasi. Rekening harus sama (server: MUTATION_ACCOUNT).
  const amount = mutation ? Number(mutation.amount) : Number(purchase?.transfer_amount ?? 0);
  const bankId = mutation?.bank_account_id ?? purchase?.bank_account_id ?? '';
  const options = useMemo(() => {
    const list = mutation
      ? purchases.filter((p) => MATCHABLE.includes(p.status) && p.bank_account_id === bankId).map((p) => ({ id: p.id, amount: Number(p.transfer_amount), title: p.reference, sub: `${p.user_name ?? shortId(p.user_id)} · ${P_STATUS[p.status]?.label ?? p.status} · dibuat ${fmtAgo(p.created_at)}` }))
      : mutations.filter((m) => m.status === 'unmatched' && m.bank_account_id === bankId).map((m) => ({ id: m.id, amount: Number(m.amount), title: m.bank_ref, sub: `${m.sender_name ?? 'pengirim —'} · ${fmtDate(m.trx_at)}` }));
    return list.sort((a, b) => Number(b.amount === amount) - Number(a.amount === amount) || Math.abs(a.amount - amount) - Math.abs(b.amount - amount));
  }, [mutation, purchases, mutations, bankId, amount]);
  const chosen = options.find((o) => o.id === pick) ?? null;

  const submit = async () => {
    if (!chosen) return;
    const p_purchase = mutation ? chosen.id : purchase!.id;
    const p_mutation = mutation ? mutation.id : chosen.id;
    setBusy(true);
    try {
      const ok = await runAction(() => rpc('admin_voucher_match', { p_purchase, p_mutation, p_note: note.trim() || null }),
        chosen.amount === amount ? 'Mutasi tercocok — voucher siap diterbitkan oleh admin lain' : 'Mutasi dicocokkan dengan nominal BERBEDA — periksa sebelum menerbitkan', reload);
      if (ok) onClose();
    } finally { setBusy(false); }
  };

  const bankName = mutation?.bank_name ?? purchase?.bank_name ?? '—';
  return (
    <AdminDialog visible={visible} onClose={onClose} width={640}
      title={mutation ? `Cocokkan mutasi ${mutation.bank_ref}` : `Cocokkan pembelian ${purchase?.reference ?? ''}`}
      subtitle={`${rupiah(amount)} · rekening ${bankName} · ${mutation ? 'pilih pembelian (menunggu/kedaluwarsa/sengketa) di rekening yang sama' : 'pilih mutasi yang belum tercocok di rekening yang sama'}`}>
      <View style={{ gap: 10 }}>
        <ScrollView style={{ maxHeight: 320 }} contentContainerStyle={{ gap: 6 }}>
          {options.length === 0 ? <Text style={font.small}>{mutation ? 'Tidak ada pembelian terbuka di rekening ini. Bila dana tidak dikenal, gunakan "Kembalikan dana".' : 'Belum ada mutasi belum-tercocok di rekening ini. Catat mutasi dulu di tab Mutasi bank.'}</Text> : null}
          {options.map((o) => {
            const on = o.id === pick; const same = o.amount === amount;
            return (
              <Pressable key={o.id} onPress={() => setPick(o.id)} style={(st) => [s.option, on && s.optionOn, (st as { hovered?: boolean }).hovered && !on && { backgroundColor: adminTone.hover }]}>
                <Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={adminIcon.lg} color={on ? adminTone.teal : adminTone.faint} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={font.bodyStrong} numberOfLines={1}>{o.title}</Text>
                  <Text style={font.small} numberOfLines={1}>{o.sub}</Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 2 }}>
                  <Text style={font.mono}>{rupiah(o.amount)}</Text>
                  <Pill text={same ? 'Jumlah persis' : `selisih ${rupiah(o.amount - amount)}`} tone={same ? 'ok' : 'bad'} />
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
        {chosen && chosen.amount !== amount ? (
          <Note tone="bad" icon="warning-outline">Jumlah tidak sama — pembelian akan berstatus "Nominal tidak sama". Voucher yang terbit nanti = dana yang benar-benar diterima.</Note>
        ) : null}
        <Input label="Catatan (opsional)" placeholder="mis. berita transfer memuat referensi AKV-…" value={note} onChangeText={setNote} />
        <Text style={font.small}>Setelah dicocokkan, penerbitan voucher harus dilakukan admin lain (maker-checker).</Text>
        <Row gap={8} style={{ justifyContent: 'flex-end' }}>
          <Button size="sm" variant="ghost" title="Batal" onPress={onClose} />
          <Button size="sm" title="Cocokkan" icon="git-compare-outline" loading={busy} disabled={!chosen} onPress={submit} />
        </Row>
      </View>
    </AdminDialog>
  );
}

/* ───────────────────────────── (b) Mutasi bank ───────────────────────────── */

function MutationsTab({ q, banks, loading, reload }: { q: Queue | null; banks: BankAccount[]; loading: boolean; reload: () => Promise<void> }) {
  const can = useAdminCan();
  const [filter, setFilter] = useState('unmatched');
  const [busy, setBusy] = useState<string | null>(null);
  const [match, setMatch] = useState<Mutation | null>(null);
  const [refund, setRefund] = useState<Mutation | null>(null);
  const [done, setDone] = useState<Mutation | null>(null);
  const [doneRef, setDoneRef] = useState('');
  const [form, setForm] = useState({ bank: '', ref: '', amount: '', date: todayWib(), time: nowHm(), sender: '', note: '' });
  const set = (k: keyof typeof form, v: string) => setForm((p) => ({ ...p, [k]: v }));

  const purchases = q?.purchases ?? [];
  const mutations = q?.mutations ?? [];
  const rows = useMemo(() => mutations.filter((m) => filter === 'all' || m.status === filter), [mutations, filter]);
  const pg = usePager(rows, 50);
  const pById = useMemo(() => new Map(purchases.map((p) => [p.id, p])), [purchases]);
  const bankOptions = banks.map((b) => ({
    value: b.id, label: b.bank_name, disabled: b.is_placeholder || !b.account_no,
    sublabel: b.is_placeholder || !b.account_no ? 'PLACEHOLDER — belum ada rekening' : `${b.account_no} · ${b.account_name ?? '—'}`,
  }));

  const amountN = Number(digits(form.amount));
  const timeOk = /^([01]\d|2[0-3]):[0-5]\d$/.test(form.time);
  const formErr = !form.bank ? 'Pilih rekening' : form.ref.trim().length < 3 ? 'Referensi mutasi wajib (min. 3 karakter)' : !(amountN > 0) ? 'Nominal wajib diisi'
    : rangeError({ from: form.date, to: form.date }) ? 'Tanggal tidak valid' : !timeOk ? 'Jam harus JJ:MM (24 jam)' : null;

  const submit = async () => {
    if (formErr) return toast.error(formErr);
    setBusy('add');
    try {
      const ok = await runAction(
        () => rpc<Mutation & { auto_match_candidates?: number }>('admin_voucher_mutation_add', {
          p_bank_account: form.bank, p_bank_ref: form.ref.trim(), p_amount: amountN, p_trx_at: `${form.date}T${form.time}:00+07:00`,
          p_sender_name: form.sender.trim() || null, p_note: form.note.trim() || null,
        }),
        (r) => {
          const m = r as Mutation & { auto_match_candidates?: number };
          const n = Number(m?.auto_match_candidates ?? 0);
          if (m?.status === 'matched') return `Mutasi ${m.bank_ref} tercocok otomatis — voucher menunggu penerbitan oleh admin lain`;
          if (n > 1) return `Mutasi dicatat — ada ${n} pembelian dengan jumlah sama, cocokkan manual`;
          return 'Mutasi dicatat — belum ada pembelian yang cocok (cocokkan manual atau kembalikan dana)';
        },
        reload);
      if (ok) setForm((p) => ({ ...p, ref: '', amount: '', sender: '', note: '', time: nowHm() }));
    } finally { setBusy(null); }
  };
  const doRefund = async (reason: string) => {
    if (!refund) return;
    setBusy(`r:${refund.id}`);
    try {
      if (await runAction(() => rpc('admin_voucher_mutation_refund', { p_mutation: refund.id, p_reason: reason }), `Mutasi ${refund.bank_ref} dijadwalkan dikembalikan ke pengirim`, reload)) setRefund(null);
    } finally { setBusy(null); }
  };
  const doDone = async () => {
    if (!done) return;
    const v = doneRef.trim();
    if (v.length < 3 || v.length > 120) return toast.error('Referensi transfer pengembalian wajib 3–120 karakter');
    setBusy(`d:${done.id}`);
    try {
      if (await runAction(() => rpc('admin_voucher_mutation_refund_done', { p_mutation: done.id, p_refund_bank_ref: v }), `Pengembalian dana ${done.bank_ref} ditandai selesai (ref ${v})`, reload)) { setDone(null); setDoneRef(''); }
    } finally { setBusy(null); }
  };

  return (
    <>
      <RequirePerm perm="reconcile" fallback={<Note tone="off" icon="lock-closed-outline">Mencatat mutasi bank butuh izin reconcile (Keuangan).</Note>}>
        <Panel title="Catat mutasi masuk" subtitle="Salin dari rekening koran / internet banking rekening resmi PT. Satu referensi hanya bisa dicatat sekali per rekening (anti kredit ganda)." icon="add-circle-outline">
          <View style={s.formGrid}>
            <AdminSelect label="Rekening tujuan" value={form.bank} options={bankOptions} onChange={(v) => set('bank', v)} placeholder="Pilih rekening resmi" width="100%" icon="business-outline" />
            <View style={s.field}><Input label="Referensi mutasi bank" placeholder="mis. 2509BRI000123" value={form.ref} onChangeText={(v) => set('ref', v)} autoCapitalize="characters" /></View>
            <View style={s.field}><Input label="Nominal masuk (Rp)" placeholder="mis. 100123" value={form.amount} onChangeText={(v) => set('amount', digits(v))} keyboardType="number-pad" /></View>
            <View style={[s.field, { gap: 4 }]}>
              <Row gap={8} style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <DateField label="Tanggal (WIB)" value={form.date} onChange={(v) => set('date', v)} />
                <View style={{ width: 96 }}><Input label="Jam" placeholder="JJ:MM" value={form.time} onChangeText={(v) => set('time', v)} maxLength={5} /></View>
              </Row>
            </View>
            <View style={s.field}><Input label="Nama pengirim" placeholder="sesuai rekening koran" value={form.sender} onChangeText={(v) => set('sender', v)} /></View>
            <View style={s.fieldWide}><Input label="Catatan" placeholder="berita transfer, dsb. (opsional)" value={form.note} onChangeText={(v) => set('note', v)} /></View>
          </View>
          <Row between style={{ flexWrap: 'wrap', gap: 10, marginTop: adminSpace.sm }}>
            <Text style={[font.small, { flex: 1, minWidth: 240 }]}>
              {amountN > 0 ? `Akan dicatat ${rupiah(amountN)}. ` : ''}Sistem mencocokkan otomatis bila tepat satu pembelian terbuka di rekening ini memiliki jumlah transfer yang sama persis.
            </Text>
            <Button size="sm" title="Catat mutasi" icon="save-outline" loading={busy === 'add'} disabled={!!formErr} onPress={submit} />
          </Row>
          {formErr && (form.ref || form.amount) ? <Text style={[font.small, { color: adminTone.red }]}>{formErr}</Text> : null}
        </Panel>
      </RequirePerm>

      <Toolbar>
        <FilterBar options={M_FILTERS} value={filter} onChange={setFilter} />
      </Toolbar>

      <Panel title={`Mutasi bank (${rows.length} dari ${mutations.length})`} subtitle="Maks 200 terbaru. Mutasi tanpa pembelian yang cocok (transfer ganda / salah nominal / tidak dikenal) wajib dikembalikan ke pengirim — bukan dijadikan saldo." icon="swap-vertical-outline" iconColor={adminTone.blue} padded={false}>
        <DataTable rows={pg.rows as unknown as Record<string, unknown>[]} emptyText={loading ? 'Memuat…' : 'Tidak ada mutasi pada filter ini'} emptyIcon="swap-vertical-outline"
          columns={[
            { key: 'trx_at', label: 'Waktu transaksi', width: 130, render: (r) => { const x = r as unknown as Mutation; return <View><Text style={font.small}>{fmtDate(x.trx_at)}</Text><Text style={font.tiny}>dicatat {fmtAgo(x.created_at)}</Text></View>; } },
            { key: 'bank_ref', label: 'Rekening · referensi', width: 200, render: (r) => { const x = r as unknown as Mutation; return <View style={{ minWidth: 0, alignSelf: 'stretch' }}><Trunc style={font.bodyStrong} title={x.bank_ref}>{x.bank_ref}</Trunc><Trunc style={font.tiny} title={x.bank_name ?? ''}>{x.bank_name ?? '—'}</Trunc></View>; } },
            moneyCol('amount', 'Nominal', 116),
            { key: 'sender_name', label: 'Pengirim · catatan', width: 170, render: (r) => { const x = r as unknown as Mutation; return <View style={{ minWidth: 0, alignSelf: 'stretch' }}><Trunc style={font.body} title={x.sender_name ?? ''}>{x.sender_name ?? '—'}</Trunc>{x.raw_note ? <Trunc style={font.tiny} title={x.raw_note}>{x.raw_note}</Trunc> : null}</View>; } },
            { key: 'status', label: 'Status · pembelian', width: 190, render: (r) => {
              const x = r as unknown as Mutation; const st = M_STATUS[x.status] ?? { label: x.status, tone: 'neutral' as ToneKey };
              const p = x.purchase_id ? pById.get(x.purchase_id) : null;
              const sub = x.refund_bank_ref ? `ref balik ${x.refund_bank_ref}` : x.refund_reason ? x.refund_reason : x.purchase_id ? `→ ${p?.reference ?? shortId(x.purchase_id)}` : '';
              return <View style={{ gap: 3, minWidth: 0, alignSelf: 'stretch' }}><Pill text={st.label} tone={st.tone} />{sub ? <Trunc style={font.tiny} title={sub}>{sub}</Trunc> : null}</View>;
            } },
            { key: 'actions', label: 'Aksi', width: 220, align: 'right', render: (r) => {
              const x = r as unknown as Mutation;
              const main: RowAction | null =
                x.status === 'unmatched' && can('reconcile') ? { key: 'mt', label: 'Cocokkan', icon: 'git-compare-outline', variant: 'solid', color: adminTone.teal, onPress: () => setMatch(x) }
                : x.status === 'refund_pending' && can('refund_execute') ? { key: 'dn', label: 'Sudah dikembalikan', icon: 'checkmark-done-outline', variant: 'solid', color: colors.success, busy: busy === `d:${x.id}`, onPress: () => { setDoneRef(''); setDone(x); } }
                : null;
              if (!main && !(x.status === 'unmatched' && can('refund'))) return <Text style={font.tiny}>—</Text>;
              return (
                <RowActions primary={[main]}
                  menu={[x.status === 'unmatched' && can('refund') && { key: 'rf', label: 'Kembalikan dana ke pengirim…', icon: 'return-down-back-outline', danger: true, hint: 'mutasi tanpa pembelian', onPress: () => setRefund(x) }]} />
              );
            } },
          ]} />
        <View style={{ padding: adminSpace.md, gap: 6 }}><WideTableHint /><Pager p={pg} noun="mutasi" /></View>
      </Panel>

      <MatchDialog mutation={match} purchases={purchases} mutations={mutations} onClose={() => setMatch(null)} reload={reload} />

      <ReasonPrompt visible={!!refund} title={`Kembalikan dana mutasi ${refund?.bank_ref ?? ''}?`} subtitle={refund ? `${rupiah(refund.amount)} · ${refund.sender_name ?? 'pengirim —'} · ${refund.bank_name ?? '—'}. Mutasi masuk daftar "Wajib dikembalikan".` : undefined}
        onCancel={() => setRefund(null)} onSubmit={doRefund} confirmLabel="Jadwalkan pengembalian"
        quick={['Transfer ganda', 'Nominal tidak sesuai pembelian mana pun', 'Pengirim tidak dikenal', 'Pembelian sudah kedaluwarsa > 7 hari']} />

      <AdminDialog visible={!!done} onClose={() => setDone(null)} title="Tandai dana sudah dikembalikan"
        subtitle={done ? `${done.bank_ref} · ${rupiah(done.amount)} · ${done.sender_name ?? 'pengirim —'} · ${done.bank_name ?? '—'}` : undefined}>
        <View style={{ gap: 10 }}>
          <Text style={font.small}>Isi nomor referensi transfer balik dari internet banking rekening resmi (3–120 karakter). Pembelian terkait ikut berstatus "Sudah direfund". Butuh PIN panel & izin refund_execute.</Text>
          {done?.refund_reason ? <Text style={font.small}>Alasan: {done.refund_reason}</Text> : null}
          <Input label="Referensi transfer pengembalian" placeholder="mis. BRI-20260925-000456" value={doneRef} onChangeText={setDoneRef} autoCapitalize="characters" onSubmitEditing={doDone} />
          <Row gap={8} style={{ justifyContent: 'flex-end' }}>
            <Button size="sm" variant="ghost" title="Batal" onPress={() => setDone(null)} />
            <Button size="sm" title="Tandai dikembalikan" icon="checkmark-done" loading={!!done && busy === `d:${done.id}`} disabled={doneRef.trim().length < 3} onPress={doDone} />
          </Row>
        </View>
      </AdminDialog>
    </>
  );
}

/* ───────────────────────────── (c) Rekening resmi ───────────────────────────── */

function BanksTab({ banks, loading, reload }: { banks: BankAccount[]; loading: boolean; reload: () => Promise<void> }) {
  const me = useAuth((st) => st.session?.user.id ?? null);
  const can = useAdminCan();
  const [entity, setEntity] = useState<string>('');
  const [edit, setEdit] = useState<BankAccount | null>(null);
  const [f, setF] = useState({ account_no: '', account_name: '', active: false, display_order: '', note: '' });
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    supabase.from('app_settings').select('value').eq('key', 'voucher_legal_entity_name').maybeSingle()
      .then(({ data }) => setEntity(settingText((data as { value?: unknown } | null)?.value)));
  }, []);

  const nameOk = (b: BankAccount) => !!entity && (b.account_name ?? '').trim().toLowerCase() === entity.trim().toLowerCase();
  const openEdit = (b: BankAccount) => {
    setF({ account_no: b.account_no ?? '', account_name: b.account_name ?? '', active: b.active, display_order: String(b.display_order ?? ''), note: b.note ?? '' });
    setEdit(b);
  };
  const noDigits = digits(f.account_no);
  const editErr = noDigits && !/^\d{8,20}$/.test(noDigits) ? 'Nomor rekening harus 8–20 digit angka' : null;
  const changesIdentity = !!edit && (noDigits !== (edit.account_no ?? '') || f.account_name.trim() !== (edit.account_name ?? ''));

  const save = async () => {
    if (!edit || editErr) return;
    setBusy('save');
    try {
      const ok = await runAction(() => rpc<{ public_ok: boolean }>('admin_voucher_bank_upsert', { p: {
        id: edit.id, account_no: noDigits || null, account_name: f.account_name.trim() || null, active: f.active,
        display_order: f.display_order.trim() ? Number(digits(f.display_order)) : null, note: f.note.trim() || null,
      } }), (r) => ((r as { public_ok?: boolean })?.public_ok ? `Rekening ${edit.bank_name} disimpan — tampil ke pengguna` : `Rekening ${edit.bank_name} disimpan — belum tampil ke pengguna (butuh verifikasi Finance & Legal)`), reload);
      if (ok) setEdit(null);
    } finally { setBusy(null); }
  };
  const verify = async (b: BankAccount, as: 'finance' | 'legal') => {
    setBusy(`${as}:${b.id}`);
    try {
      await runAction(() => rpc('admin_voucher_bank_verify', { p_id: b.id, p_as: as }), `Rekening ${b.bank_name} diverifikasi ${as === 'finance' ? 'Finance' : 'Legal'}`, reload);
    } finally { setBusy(null); }
  };

  const badges = (b: BankAccount) => {
    const out: { text: string; tone: ToneKey; icon?: React.ComponentProps<typeof Ionicons>['name'] }[] = [];
    if (b.is_placeholder || !b.account_no) out.push({ text: 'PLACEHOLDER', tone: 'off', icon: 'construct-outline' });
    else if (b.public_ok) out.push({ text: 'Tampil ke pengguna', tone: 'ok', icon: 'eye-outline' });
    else {
      const miss = [!b.finance_verified_at && 'Finance', !b.legal_verified_at && 'Legal'].filter(Boolean).join('/');
      if (miss) out.push({ text: `Menunggu verifikasi ${miss}`, tone: 'wait', icon: 'hourglass-outline' });
      if (!b.active) out.push({ text: 'Nonaktif', tone: 'off' });
      if (entity && b.account_name && !nameOk(b)) out.push({ text: 'Nama ≠ badan usaha', tone: 'bad', icon: 'warning-outline' });
      if (!miss && b.active && nameOk(b)) out.push({ text: 'Belum lolos syarat tampil', tone: 'bad' });
    }
    return out;
  };

  return (
    <>
      <Note tone="bad" icon="warning" title="Jangan isi nomor rekening sebelum rekening atas nama PT benar-benar dibuka & disetujui Finance dan Legal">
        <Text style={font.body}>
          Rekening hanya tampil ke pengguna bila: bukan placeholder, nomor 8–20 digit, atas nama badan usaha persis "{entity || '…'}" (setelan voucher_legal_entity_name), aktif,
          diverifikasi Finance DAN Legal oleh dua admin berbeda. Mengubah nomor atau nama pemilik membatalkan verifikasi — harus diverifikasi ulang.
        </Text>
      </Note>

      <Panel title={`Rekening resmi PT · Himbara (${banks.length})`} subtitle="Tujuan transfer pembelian AntarVoucher. Mengubah data butuh izin payment_config; verifikasi butuh izin reconcile." icon="business-outline" padded={false}>
        <DataTable rows={banks as unknown as Record<string, unknown>[]} emptyText={loading ? 'Memuat…' : 'Belum ada rekening'} emptyIcon="business-outline"
          columns={[
            { key: 'bank_name', label: 'Bank', width: 200, render: (r) => { const b = r as unknown as BankAccount; return <View style={{ minWidth: 0, alignSelf: 'stretch' }}><Trunc style={font.bodyStrong} title={b.bank_name}>{b.bank_name}</Trunc><Text style={font.tiny}>kode {b.bank_code.toUpperCase()} · urutan {b.display_order}</Text></View>; } },
            { key: 'account_no', label: 'Nomor · pemilik', width: 220, flex: 1, render: (r) => { const b = r as unknown as BankAccount; return <View style={{ minWidth: 0, alignSelf: 'stretch' }}><Text style={font.mono} selectable>{b.account_no ?? '— belum diisi —'}</Text><Trunc style={[font.small, entity && b.account_name && !nameOk(b) ? { color: adminTone.red } : null]} title={b.account_name ?? ''}>{b.account_name ? `a.n. ${b.account_name}` : 'nama pemilik belum diisi'}</Trunc></View>; } },
            { key: 'status', label: 'Status', width: 210, render: (r) => { const b = r as unknown as BankAccount; return <View style={{ gap: 4, alignItems: 'flex-start' }}>{badges(b).map((x) => <Pill key={x.text} text={x.text} tone={x.tone} icon={x.icon} />)}</View>; } },
            { key: 'verif', label: 'Verifikasi', width: 190, render: (r) => { const b = r as unknown as BankAccount; const who = (id: string | null) => (id ? `${shortId(id)}${id === me ? ' (Anda)' : ''}` : ''); return (
              <View style={{ gap: 2, minWidth: 0, alignSelf: 'stretch' }}>
                <Trunc style={[font.small, { color: b.finance_verified_at ? TONE.ok.fg : adminTone.muted }]} title={who(b.finance_verified_by)}>Finance: {b.finance_verified_at ? `${fmtDate(b.finance_verified_at, false)} · ${who(b.finance_verified_by)}` : 'belum'}</Trunc>
                <Trunc style={[font.small, { color: b.legal_verified_at ? TONE.ok.fg : adminTone.muted }]} title={who(b.legal_verified_by)}>Legal: {b.legal_verified_at ? `${fmtDate(b.legal_verified_at, false)} · ${who(b.legal_verified_by)}` : 'belum'}</Trunc>
              </View>
            ); } },
            { key: 'actions', label: 'Aksi', width: adminTable.actionsWideW, align: 'right', render: (r) => {
              const b = r as unknown as BankAccount;
              const placeholder = b.is_placeholder || !b.account_no;
              const iAmFinance = !!me && b.finance_verified_by === me;
              return (
                <RowActions
                  primary={[can('payment_config') && { key: 'ed', label: 'Ubah', icon: 'create-outline', variant: 'soft', onPress: () => openEdit(b) }]}
                  menu={can('reconcile') ? [
                    { key: 'vf', label: b.finance_verified_at ? 'Verifikasi ulang Finance' : 'Verifikasi Finance', icon: 'shield-checkmark-outline', disabled: placeholder || busy === `finance:${b.id}`, hint: placeholder ? 'isi nomor rekening dulu' : undefined, onPress: () => { verify(b, 'finance'); } },
                    { key: 'vl', label: b.legal_verified_at ? 'Verifikasi ulang Legal' : 'Verifikasi Legal', icon: 'document-lock-outline', disabled: placeholder || iAmFinance || busy === `legal:${b.id}`, hint: placeholder ? 'isi nomor rekening dulu' : iAmFinance ? 'harus admin lain dari verifikator Finance' : undefined, onPress: () => { verify(b, 'legal'); } },
                  ] : []}
                />
              );
            } },
          ]} />
        <View style={{ padding: adminSpace.md, gap: 6 }}><WideTableHint /></View>
      </Panel>

      <AdminDialog visible={!!edit} onClose={() => setEdit(null)} width={560} title={`Ubah rekening ${edit?.bank_name ?? ''}`}
        subtitle="Butuh PIN panel & izin payment_config. Tercatat di log aktivitas (nomor disamarkan).">
        <View style={{ gap: 10 }}>
          <Note tone="wait" icon="warning-outline">Isi hanya bila rekening atas nama PT sudah dibuka dan disetujui Finance & Legal. Jangan mengarang atau memakai rekening pribadi.</Note>
          <Input label="Nomor rekening" placeholder="8–20 digit, tanpa spasi" value={f.account_no} onChangeText={(v) => setF((p) => ({ ...p, account_no: digits(v) }))} keyboardType="number-pad" maxLength={20} error={editErr} />
          <View style={{ gap: 4 }}>
            <Input label="Nama pemilik rekening" placeholder={entity || 'nama badan usaha'} value={f.account_name} onChangeText={(v) => setF((p) => ({ ...p, account_name: v }))} />
            <Text style={[font.small, f.account_name && entity && f.account_name.trim().toLowerCase() !== entity.trim().toLowerCase() ? { color: adminTone.red } : null]}>
              Harus sama persis dengan nama badan usaha di setelan voucher_legal_entity_name: "{entity || '—'}".
            </Text>
          </View>
          <Row gap={10} style={{ flexWrap: 'wrap' }}>
            <View style={{ width: 120 }}><Input label="Urutan tampil" value={f.display_order} onChangeText={(v) => setF((p) => ({ ...p, display_order: digits(v) }))} keyboardType="number-pad" /></View>
            <View style={{ flex: 1, minWidth: 200 }}><Input label="Catatan" value={f.note} onChangeText={(v) => setF((p) => ({ ...p, note: v }))} /></View>
          </Row>
          <Row between style={{ gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={font.bodyStrong}>Aktif</Text>
              <Text style={font.small}>Tetap tidak tampil ke pengguna sebelum diverifikasi Finance & Legal.</Text>
            </View>
            <Switch value={f.active} onValueChange={(v) => setF((p) => ({ ...p, active: v }))} trackColor={{ true: colors.success, false: colors.border }} thumbColor="#fff" />
          </Row>
          {changesIdentity && (edit?.finance_verified_at || edit?.legal_verified_at) ? <Note tone="bad" icon="refresh-outline">Nomor/nama berubah — verifikasi Finance & Legal akan DIBATALKAN dan harus diulang.</Note> : null}
          {edit?.account_no && !noDigits ? <Text style={font.small}>Mengosongkan nomor tidak menghapus nomor lama di server.</Text> : null}
          <Row gap={8} style={{ justifyContent: 'flex-end' }}>
            <Button size="sm" variant="ghost" title="Batal" onPress={() => setEdit(null)} />
            <Button size="sm" title="Simpan" icon="save-outline" loading={busy === 'save'} disabled={!!editErr} onPress={save} />
          </Row>
        </View>
      </AdminDialog>
    </>
  );
}

/* ───────────────────────────── (d) Rekonsiliasi ───────────────────────────── */

function ReconcileTab() {
  const [preset, setPreset] = useState<RangePreset>('month');
  const [range, setRange] = useState<DateRange>(() => presetRange('month'));
  const [data, setData] = useState<Reconcile | null>(null);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const invalid = rangeError(range);

  const load = useCallback(async () => {
    if (rangeError(range)) { setLoading(false); return; }
    setLoading(true);
    try {
      const r = await rpc<Reconcile>('admin_wallet_reconcile', { p_from: range.from, p_to: range.to });
      setData(r); setErr(null);
      const ids = asList<{ user_id: string }>(r?.dompet_tidak_seimbang).map((x) => x.user_id).slice(0, 200);
      if (ids.length) {
        const { data: ps } = await supabase.from('profiles').select('id,full_name').in('id', ids);
        setNames(new Map(((ps as { id: string; full_name: string | null }[]) ?? []).map((p) => [p.id, p.full_name ?? ''])));
      }
    } catch (e) { setErr((e as Error).message); setData(null); }
    finally { setLoading(false); }
  }, [range]);
  useEffect(() => { const t = setTimeout(load, 300); return () => clearTimeout(t); }, [load]);
  const pickPreset = (p: RangePreset) => { setPreset(p); if (p !== 'custom') setRange(presetRange(p)); };

  const bad = asList<Reconcile['dompet_tidak_seimbang'][number]>(data?.dompet_tidak_seimbang);
  const diff = Number(data?.selisih_voucher_vs_bank ?? 0);

  return (
    <>
      <Toolbar right={<Button size="sm" variant="outline" title="Hitung ulang" icon="refresh-outline" loading={loading} onPress={load} />}>
        <FilterBar options={RANGE_PRESETS as unknown as { key: string; label: string }[]} value={preset} onChange={(v) => pickPreset(v as RangePreset)} />
        {preset === 'custom' ? (
          <Row gap={8} style={{ flexWrap: 'wrap' }}>
            <DateField label="Dari" value={range.from} onChange={(v) => setRange((r) => ({ ...r, from: v }))} />
            <DateField label="Sampai" value={range.to} onChange={(v) => setRange((r) => ({ ...r, to: v }))} />
          </Row>
        ) : <Text style={font.small}>{rangeLabel(range)}</Text>}
      </Toolbar>
      <ErrorNote text={invalid} />
      {!invalid ? <ErrorNote text={err} onRetry={load} /> : null}

      {data ? (
        <Note tone={data.ok ? 'ok' : 'bad'} icon={data.ok ? 'checkmark-circle' : 'alert-circle'}
          title={data.ok ? 'Rekonsiliasi SEIMBANG' : 'Rekonsiliasi TIDAK seimbang — telusuri sebelum menerbitkan voucher baru'}>
          {`Rentang ${rangeLabel(range)} (WIB). ${data.ok ? 'Voucher terbit = mutasi bank tercocok, dan semua saldo dompet sama dengan jumlah mutasi ledger-nya.' : `Selisih voucher vs bank ${rupiah(diff)} · ${data.jumlah_dompet_tidak_seimbang} dompet tidak seimbang.`}`}
        </Note>
      ) : null}

      <Row gap={adminSpace.md} style={{ flexWrap: 'wrap' }}>
        <StatCard index={0} icon="ticket-outline" label="Voucher terbit" value={rupiah(Number(data?.voucher_terbit ?? 0))} hint="disetujui dalam rentang" color={adminTone.teal} />
        <StatCard index={1} icon="business-outline" label="Mutasi bank tercocok" value={rupiah(Number(data?.mutasi_bank_tercocok ?? 0))} hint="untuk pembelian yang sama" color={adminTone.blue} />
        <StatCard index={2} icon={diff === 0 ? 'checkmark-circle-outline' : 'alert-circle-outline'} label="Selisih (harus 0)" value={rupiah(diff)} hint="voucher terbit − mutasi tercocok" color={diff === 0 ? adminTone.green : adminTone.red} />
        <StatCard index={3} icon="swap-vertical-outline" label="Mutasi belum tercocok" value={rupiah(Number(data?.mutasi_belum_tercocok ?? 0))} hint="semua tanggal" color={adminTone.amber} />
        <StatCard index={4} icon="return-down-back-outline" label="Dana wajib dikembalikan" value={rupiah(Number(data?.dana_wajib_dikembalikan ?? 0))} hint="semua tanggal" color={Number(data?.dana_wajib_dikembalikan ?? 0) > 0 ? adminTone.red : adminTone.green} />
        <StatCard index={5} icon="speedometer-outline" label="Float saldo pelanggan" value={rupiah(Number(data?.float_pelanggan ?? 0))} hint="saat ini · batas kajian izin PJP" color={adminTone.violet} />
      </Row>

      <Panel title={`Dompet tidak seimbang (${bad.length})`} subtitle="Saldo dompet ≠ jumlah seluruh baris ledger (wallet_transactions). Harus kosong; bila ada, jangan koreksi manual tanpa baris adjustment beralasan." icon="alert-circle-outline" iconColor={bad.length ? adminTone.red : adminTone.green} padded={false}>
        <DataTable keyField="user_id" rows={bad as unknown as Record<string, unknown>[]} emptyText={loading ? 'Menghitung…' : 'Semua dompet seimbang'} emptyIcon="checkmark-done-outline" maxHeight={420}
          columns={[
            { key: 'user_id', label: 'Pemilik saldo', width: 240, flex: 1, render: (r) => { const id = String(r.user_id); return <View style={{ minWidth: 0, alignSelf: 'stretch' }}><Trunc style={font.bodyStrong} title={names.get(id) ?? ''}>{names.get(id) || '—'}</Trunc><Text style={font.tiny} selectable>{id}</Text></View>; } },
            moneyCol('balance', 'Saldo dompet', 140),
            moneyCol('sum_mutasi', 'Σ mutasi ledger', 150),
            moneyCol('selisih', 'Selisih', 130, adminTone.red),
          ]} />
      </Panel>

      <Panel title="Rumus rekonsiliasi" icon="calculator-outline">
        <View style={{ gap: 8 }}>
          <Text style={font.bodyStrong}>Per pemilik saldo (wallet_statement):</Text>
          <Text style={[font.body, s.formula]} selectable>saldo awal + pembelian + pendapatan + refund masuk − penggunaan − refund keluar − payout ± koreksi = saldo akhir</Text>
          <Text style={font.bodyStrong}>Voucher ↔ bank (rentang terpilih):</Text>
          <Text style={[font.body, s.formula]} selectable>Σ voucher terbit (issued_amount, disetujui dalam rentang) − Σ mutasi bank tercocok untuk pembelian yang sama = 0</Text>
          <Text style={font.bodyStrong}>Dompet:</Text>
          <Text style={[font.body, s.formula]} selectable>saldo dompet − Σ seluruh baris ledger dompet tsb = 0 (ledger append-only)</Text>
          <Text style={font.small}>Status "SEIMBANG" = tidak ada dompet tidak seimbang DAN voucher terbit = mutasi tercocok. Mutasi belum tercocok & dana wajib dikembalikan dihitung untuk semua tanggal (bukan hanya rentang).</Text>
        </View>
      </Panel>
    </>
  );
}

/* ───────────────────────────── (e) Sakelar pembelian ───────────────────────────── */

function SwitchTab({ banks }: { banks: BankAccount[] }) {
  const [flag, setFlag] = useState<boolean | null>(null);
  const [pub, setPub] = useState<VoucherStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmOn, setConfirmOn] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from('app_settings').select('value').eq('key', 'antarvoucher_purchase_enabled').maybeSingle();
    setFlag(settingText((data as { value?: unknown } | null)?.value).toLowerCase() === 'true');
    try { setPub(await rpc<VoucherStatus>('voucher_status_public')); } catch { setPub(null); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const ready = banks.filter((b) => b.public_ok).length;
  const toggle = async (on: boolean) => {
    setBusy(true);
    try {
      const ok = await runAction(() => rpc('admin_set_antarvoucher_purchase_enabled', { p_enabled: on }),
        on ? 'Pembelian AntarVoucher DIAKTIFKAN' : 'Pembelian AntarVoucher DINONAKTIFKAN', load);
      if (ok) setConfirmOn(false);
    } finally { setBusy(false); }
  };

  return (
    <>
      <Panel title="Pembelian AntarVoucher" icon="toggle-outline" subtitle="Feature flag antarvoucher_purchase_enabled — terpisah dari sakelar AntarVoucher (saldo) di Payment Gateway.">
        <View style={{ gap: 12 }}>
          <Row between style={{ flexWrap: 'wrap', gap: 10 }}>
            <View style={{ flex: 1, minWidth: 240, gap: 4 }}>
              <Row gap={8} style={{ flexWrap: 'wrap' }}>
                <Text style={font.h3}>Sakelar pembelian</Text>
                {flag === null ? <Pill text="Memuat…" tone="off" /> : <Pill text={flag ? 'AKTIF' : 'NONAKTIF'} tone={flag ? 'ok' : 'off'} />}
                {pub ? <Pill text={pub.purchase_enabled ? 'Terlihat pengguna' : 'Tidak terlihat pengguna'} tone={pub.purchase_enabled ? 'ok' : 'wait'} /> : null}
              </Row>
              <Text style={font.body}>Tetap NONAKTIF sampai Legal & Finance menyetujui (rekening PT resmi, nama badan usaha, batas float/kajian izin PJP, SOP pencocokan mutasi).</Text>
            </View>
            <RequirePerm perm="payment_config" fallback={<Text style={font.small}>Mengubah sakelar: superadmin (izin payment_config).</Text>}>
              <Row gap={8} style={{ alignItems: 'center' }}>
                <Text style={[font.bodyStrong]}>{flag ? 'Aktif' : 'Nonaktif'}</Text>
                <Switch value={!!flag} disabled={busy || flag === null} onValueChange={(v) => (v ? setConfirmOn(true) : toggle(false))} trackColor={{ true: colors.success, false: colors.border }} thumbColor="#fff" />
              </Row>
            </RequirePerm>
          </Row>
          <View style={{ gap: 4 }}>
            <Text style={font.small}>Rekening siap tampil: {ready} dari {banks.length}{ready === 0 ? ' — server menolak mengaktifkan (VOUCHER_BANK_NOT_READY).' : ''}</Text>
            {pub ? <Text style={font.small}>AntarVoucher (saldo): {pub.enabled ? 'aktif' : 'nonaktif'} · nominal {rupiah(pub.min)}–{rupiah(pub.max)} · batas transfer {pub.ttl_hours} jam.</Text> : null}
            <Text style={font.small}>Pembelian benar-benar terbuka bagi pengguna hanya bila: sakelar ini aktif, AntarVoucher (saldo) aktif, dan ada ≥ 1 rekening terverifikasi Finance & Legal.</Text>
          </View>
        </View>
      </Panel>

      <AdminDialog visible={confirmOn} onClose={() => setConfirmOn(false)} title="Aktifkan pembelian AntarVoucher?" tone={adminTone.amber}>
        <View style={{ gap: 10 }}>
          <Note tone="wait" icon="warning-outline">Pastikan Legal & Finance sudah menyetujui secara tertulis: rekening atas nama PT, nama badan usaha, batas float (kajian izin PJP), dan SOP pencocokan mutasi bank.</Note>
          <Text style={font.body}>Pengguna akan melihat instruksi transfer ke {ready} rekening terverifikasi. Tindakan butuh PIN panel dan tercatat di log aktivitas.</Text>
          <Row gap={8} style={{ justifyContent: 'flex-end' }}>
            <Button size="sm" variant="ghost" title="Batal" onPress={() => setConfirmOn(false)} />
            <Button size="sm" title="Aktifkan" icon="toggle" color={adminTone.amber} loading={busy} onPress={() => toggle(true)} />
          </Row>
        </View>
      </AdminDialog>
    </>
  );
}

const s = StyleSheet.create({
  note: { borderWidth: 1, borderRadius: adminRadius.card, padding: adminSpace.md },
  formGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: adminSpace.md, alignItems: 'flex-end' },
  field: { flexGrow: 1, flexBasis: 220, minWidth: 200, maxWidth: '100%' },
  fieldWide: { flexGrow: 2, flexBasis: 320, minWidth: 220, maxWidth: '100%' },
  option: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: adminSpace.sm, borderWidth: 1, borderColor: adminTone.border, borderRadius: adminRadius.md, backgroundColor: adminTone.surface },
  optionOn: { borderColor: adminTone.teal, backgroundColor: TONE.brand.bg },
  formula: { fontFamily: 'monospace', backgroundColor: adminTone.surfaceAlt, borderWidth: 1, borderColor: adminTone.border, borderRadius: adminRadius.sm, padding: adminSpace.sm, color: adminTone.ink },
});
