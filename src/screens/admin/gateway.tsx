// Admin · Payment Gateway (Midtrans): status, konfigurasi kunci, metode aktif, webhook & checklist pengajuan
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { AdminPage, Table, StatCard, adminFont as font, adminTone, adminSpace, adminRadius, AdminCard as Card } from '@/components/admin';
import { Row, Input, Button, Chip, Badge, toast } from '@/components/ui';
import { rpc, supabase } from '@/lib/supabase';
import { colors } from '@/lib/theme';
import { rupiah, formatDate } from '@/lib/format';
import { handleAdminError, useAdminSecurity } from '@/store/adminSecurity';
import type { GatewayStatus } from '@/lib/types';

const WEBHOOK_URL = 'https://qwltshvzrsykxdvhbxcv.supabase.co/functions/v1/midtrans-webhook';
const METHODS: { key: string; label: string }[] = [
  { key: 'gopay', label: 'GoPay' }, { key: 'shopeepay', label: 'ShopeePay' }, { key: 'qris', label: 'QRIS' }, { key: 'ovo', label: 'OVO' },
  { key: 'dana', label: 'DANA' }, { key: 'bank_transfer', label: 'Transfer bank (VA)' }, { key: 'card', label: 'Kartu kredit/debit' },
];
const CHECKLIST = [
  'Daftar akun di dashboard.midtrans.com (email bisnis, nomor HP aktif).',
  'Verifikasi bisnis. Perorangan: KTP + NPWP pemilik. Badan usaha: akta pendirian + SK Kemenkumham, KTP & NPWP direktur, NPWP perusahaan, NIB.',
  'Aktivasi metode pembayaran di menu Settings > Payment Methods: GoPay, ShopeePay, QRIS, Virtual Account bank, kartu. OVO & DANA dilayani lewat QRIS.',
  'Salin Server Key & Client Key dari Settings > Access Keys: pakai Sandbox dulu untuk uji, lalu Production setelah bisnis disetujui.',
  'Isi kunci di form konfigurasi halaman ini, pilih mode Sandbox/Production, lalu Simpan.',
  'Set Payment Notification URL di Settings > Configuration dengan URL webhook di bawah (Sandbox dan Production terpisah).',
  'Uji top up dari aplikasi pelanggan: transaksi harus tampil di tabel pembayaran & webhook terakhir terisi.',
];
const STATUS_COLOR: Record<string, string> = { settlement: colors.success, pending: colors.warning, expire: colors.textMuted, cancel: colors.danger, deny: colors.danger, failure: colors.danger };
const STATUS_LABEL: Record<string, string> = { settlement: 'Berhasil', pending: 'Menunggu', expire: 'Kedaluwarsa', cancel: 'Dibatalkan', deny: 'Ditolak', failure: 'Gagal' };
type TestResp = { configured?: boolean; source?: string; is_production?: boolean; reachable?: boolean; http?: number; message?: string; error?: string };

export default function AdminGateway() {
  const [st, setSt] = useState<GatewayStatus | null>(null);
  const [f, setF] = useState({ server_key: '', client_key: '', merchant_id: '', is_production: false, methods: [] as string[], topup_min: '10000', topup_max: '10000000' });
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);

  const apply = useCallback((g: GatewayStatus) => {
    setSt(g);
    setF((p) => ({ ...p, server_key: '', client_key: g.client_key ?? '', merchant_id: g.merchant_id ?? '', is_production: g.is_production, methods: g.methods ?? [], topup_min: String(g.topup_min), topup_max: String(g.topup_max) }));
  }, []);
  const load = useCallback(async () => { try { apply(await rpc<GatewayStatus>('admin_gateway_status')); } catch (e) { toast.error((e as Error).message); } }, [apply]);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    const min = Number(f.topup_min), max = Number(f.topup_max);
    if (!min || !max || min >= max) return toast.error('Batas top up tidak valid (min < max)');
    if (!f.methods.length) return toast.error('Pilih minimal satu metode pembayaran');
    if (!(await useAdminSecurity.getState().ensureUnlocked())) return;
    setBusy(true);
    try {
      const p: Record<string, unknown> = { client_key: f.client_key.trim(), merchant_id: f.merchant_id.trim(), is_production: f.is_production, methods: f.methods, topup_min: min, topup_max: max };
      if (f.server_key.trim()) p.server_key = f.server_key.trim();
      apply(await rpc<GatewayStatus>('admin_set_gateway', { p })); toast.success('Konfigurasi gateway disimpan'); setTest(null);
    } catch (e) { handleAdminError(e); } finally { setBusy(false); }
  };
  const clearKey = async () => {
    if (!(await useAdminSecurity.getState().ensureUnlocked())) return;
    setBusy(true);
    try { apply(await rpc<GatewayStatus>('admin_set_gateway', { p: { clear_server_key: true } })); toast.success('Server key dihapus — top up kembali ke mode simulasi'); setTest(null); }
    catch (e) { handleAdminError(e); } finally { setBusy(false); }
  };
  const testConn = async () => {
    setTesting(true); setTest(null);
    try {
      const { data, error } = await supabase.functions.invoke<TestResp>('midtrans-create', { body: { action: 'status' } });
      if (error || !data) setTest({ ok: false, text: error?.message ?? 'Edge function tidak merespons' });
      else if (data.error) setTest({ ok: false, text: data.error });
      else setTest({ ok: !!data.reachable, text: `${data.message ?? '-'}${data.http ? ` (HTTP ${data.http})` : ''} · sumber kunci: ${data.source ?? '-'} · mode ${data.is_production ? 'production' : 'sandbox'}` });
    } catch (e) { setTest({ ok: false, text: (e as Error).message }); } finally { setTesting(false); }
  };
  const copyWebhook = async () => { await Clipboard.setStringAsync(WEBHOOK_URL); toast.success('URL webhook disalin'); };
  const toggleMethod = (k: string) => setF((p) => ({ ...p, methods: p.methods.includes(k) ? p.methods.filter((m) => m !== k) : [...p.methods, k] }));

  const stats = st?.stats;
  return (
    <AdminPage title="Payment Gateway · Midtrans" subtitle="Top up AntarPay lewat GoPay, ShopeePay, QRIS, VA bank & kartu. Tanpa server key, top up berjalan dalam mode simulasi." onRefresh={load}>
      <Row gap={adminSpace.lg} style={{ flexWrap: 'wrap' }}>
        <StatCard index={0} icon="card-outline" label="Total transaksi" value={stats?.total ?? 0} hint={`${stats?.last_7d ?? 0} dalam 7 hari · ${stats?.simulated ?? 0} simulasi`} color={adminTone.blue} />
        <StatCard index={1} icon="checkmark-circle-outline" label="Berhasil (settlement)" value={stats?.settlement ?? 0} color={adminTone.green} />
        <StatCard index={2} icon="hourglass-outline" label="Menunggu" value={stats?.pending ?? 0} color={adminTone.amber} />
        <StatCard index={3} icon="close-circle-outline" label="Gagal / batal" value={stats?.failed ?? 0} color={adminTone.red} />
        <StatCard index={4} icon="cash-outline" label="Nominal berhasil" value={rupiah(stats?.amount_settled ?? 0)} color={adminTone.teal} />
      </Row>

      <Row gap={16} style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <Card style={{ flex: 1, minWidth: 320, gap: 10 }}>
          <Row between style={{ flexWrap: 'wrap', gap: 8 }}>
            <Text style={font.label}>Status gateway</Text>
            {st ? <Badge text={st.configured ? (st.is_production ? 'Terkonfigurasi · Production' : 'Terkonfigurasi · Sandbox') : 'Belum dikonfigurasi · simulasi'} color={st.configured ? (st.is_production ? colors.success : colors.info) : colors.warning} /> : null}
          </Row>
          {[
            ['Server key', st?.server_key_masked ?? 'Belum diisi'], ['Client key', st?.client_key ?? '-'], ['Merchant ID', st?.merchant_id ?? '-'],
            ['Metode aktif', (st?.methods ?? []).map((m) => METHODS.find((x) => x.key === m)?.label ?? m).join(', ') || '-'],
            ['Batas top up', st ? `${rupiah(st.topup_min)} - ${rupiah(st.topup_max)}` : '-'],
            ['Diperbarui', st?.updated_at ? `${formatDate(st.updated_at)}${st.updated_by ? ` oleh ${st.updated_by}` : ''}` : '-'],
            ['Webhook terakhir', st?.last_webhook_at ? formatDate(String(st.last_webhook_at).replace(/"/g, '')) : 'Belum pernah diterima'],
          ].map(([k, v]) => <Row key={k} between style={{ gap: 12 }}><Text style={font.tiny}>{k}</Text><Text style={[font.small, { color: adminTone.ink, flex: 1, textAlign: 'right' }]} numberOfLines={2}>{v}</Text></Row>)}
          <Button title="Uji koneksi ke Midtrans" variant="outline" icon="pulse-outline" loading={testing} onPress={testConn} />
          {test ? <View style={[s.note, { backgroundColor: (test.ok ? colors.success : colors.danger) + '14', borderColor: (test.ok ? colors.success : colors.danger) + '50' }]}><Text style={[font.small, { color: test.ok ? colors.success : colors.danger }]}>{test.text}</Text></View> : null}
          <View style={{ gap: 6 }}>
            <Text style={font.label}>URL webhook (Payment Notification URL)</Text>
            <View style={s.code}><Text selectable style={s.codeText}>{WEBHOOK_URL}</Text></View>
            <Button size="sm" title="Salin URL webhook" icon="copy-outline" variant="secondary" onPress={copyWebhook} />
          </View>
        </Card>

        <Card style={{ flex: 1.2, minWidth: 340, gap: 10 }}>
          <Text style={font.label}>Konfigurasi</Text>
          <Input label="Server Key" placeholder={st?.configured ? 'Kosongkan bila tidak diganti' : 'SB-Mid-server-xxxx / Mid-server-xxxx'} value={f.server_key} onChangeText={(v) => setF({ ...f, server_key: v })} secureTextEntry autoCapitalize="none" />
          <Input label="Client Key" placeholder="SB-Mid-client-xxxx / Mid-client-xxxx" value={f.client_key} onChangeText={(v) => setF({ ...f, client_key: v })} autoCapitalize="none" />
          <Input label="Merchant ID" placeholder="G123456789" value={f.merchant_id} onChangeText={(v) => setF({ ...f, merchant_id: v })} autoCapitalize="none" />
          <Text style={font.label}>Mode</Text>
          <Row gap={6}><Chip label="Sandbox (uji)" active={!f.is_production} onPress={() => setF({ ...f, is_production: false })} color={colors.info} /><Chip label="Production" active={f.is_production} onPress={() => setF({ ...f, is_production: true })} color={colors.success} /></Row>
          <Text style={font.label}>Metode aktif</Text>
          <Row gap={6} style={{ flexWrap: 'wrap' }}>{METHODS.map((m) => <Chip key={m.key} label={m.label} active={f.methods.includes(m.key)} onPress={() => toggleMethod(m.key)} />)}</Row>
          <Row gap={8}><Input label="Top up minimum" value={f.topup_min} onChangeText={(v) => setF({ ...f, topup_min: v })} keyboardType="number-pad" containerStyle={{ flex: 1 }} /><Input label="Top up maksimum" value={f.topup_max} onChangeText={(v) => setF({ ...f, topup_max: v })} keyboardType="number-pad" containerStyle={{ flex: 1 }} /></Row>
          <Button title="Simpan konfigurasi" loading={busy} onPress={save} />
          {st?.configured ? <Button title="Hapus server key (kembali ke simulasi)" variant="outline" color={colors.danger} loading={busy} onPress={clearKey} /> : null}
          <Text style={font.tiny}>Server key disimpan di tabel rahasia (hanya dibaca edge function). Kunci Sandbox diawali SB-Mid-; pastikan mode sesuai dengan kunci yang dipakai.</Text>
        </Card>
      </Row>

      <Card style={{ gap: 8 }}>
        <Text style={font.label}>Checklist pengajuan Midtrans</Text>
        {CHECKLIST.map((c, i) => (
          <Row key={i} gap={10} style={{ alignItems: 'flex-start' }}>
            <View style={s.step}><Text style={s.stepText}>{i + 1}</Text></View>
            <Text style={[font.body, { flex: 1 }]}>{c}</Text>
          </Row>
        ))}
      </Card>

      <Card padded={false}>
        <View style={{ padding: 14 }}><Text style={font.label}>Pembayaran terbaru</Text></View>
        <Table rows={(st?.recent ?? []) as unknown as Record<string, unknown>[]} emptyText="Belum ada transaksi" columns={[
          { key: 'created_at', label: 'Waktu', width: 130, render: (r) => <Text style={font.tiny}>{formatDate(String(r.created_at))}</Text> },
          { key: 'external_id', label: 'ID transaksi', width: 200, render: (r) => <Text style={font.tiny} numberOfLines={1}>{String(r.external_id ?? r.id)}</Text> },
          { key: 'user', label: 'Pengguna', width: 150, render: (r) => <Text style={font.small}>{String(r.user ?? '-')}</Text> },
          { key: 'purpose', label: 'Tujuan', width: 90, render: (r) => <Text style={font.small}>{r.purpose === 'topup' ? 'Top up' : 'Pesanan'}</Text> },
          { key: 'method', label: 'Metode', width: 130, render: (r) => <Text style={font.small}>{String(r.method)} · {String(r.provider)}</Text> },
          { key: 'amount', label: 'Nominal', width: 120, align: 'right', mono: true, render: (r) => <Text style={font.mono}>{rupiah(Number(r.amount))}</Text> },
          { key: 'status', label: 'Status', width: 110, render: (r) => <Badge text={STATUS_LABEL[String(r.status)] ?? String(r.status)} color={STATUS_COLOR[String(r.status)] ?? colors.textMuted} /> },
        ]} />
      </Card>
    </AdminPage>
  );
}

const s = StyleSheet.create({
  note: { borderWidth: 1, borderRadius: adminRadius.card, padding: adminSpace.md },
  code: { backgroundColor: adminTone.surfaceAlt, borderRadius: adminRadius.card, padding: adminSpace.md, borderWidth: 1, borderColor: adminTone.border },
  codeText: { fontSize: 12, lineHeight: 17, color: adminTone.ink, fontFamily: 'monospace' },
  step: { width: 24, height: 24, borderRadius: adminRadius.chip, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  stepText: { color: '#fff', fontWeight: '700', fontSize: 12, lineHeight: 16 },
});
