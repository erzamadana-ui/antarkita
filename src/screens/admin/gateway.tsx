// Admin · Payment Gateway (Midtrans): sakelar AntarPay global (0088), sakelar per SALURAN pembayaran (0089),
// status, konfigurasi kunci, webhook & checklist pengajuan.
// Daftar saluran (0089) menggantikan Chip "Metode aktif" lama supaya tidak ada dua kontrol yang bertabrakan:
// admin_set_payment_channel ikut menulis pg_methods, dan Simpan konfigurasi mengirim metode hasil daftar ini.
// 0104: sakelar terpisah "Bayar per pesanan lewat gateway" (admin_set_gateway_order_payment) — saluran gateway boleh
// dipakai membayar SATU pesanan walau AntarPay/top up mati (PKS Midtrans Pasal 7.4b: stored value tetap mati).
// v3 (finpay-v3, kontrak §1/§9): kartu "Provider aktif" (midtrans/finpay × sandbox/production, simulasi) lewat
// admin_set_settings; kredensial per (provider, env) lewat admin_gateway_secrets()/admin_set_gateway_secret (tersamar,
// PIN); URL webhook pay-webhook/{provider}; "Uji koneksi" = payment_provider_public() (tanpa kontrak baru).
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Switch, Pressable } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Clipboard from 'expo-clipboard';
import { AdminPage, Table, StatCard, Pill, AdminDialog, RequirePerm, adminFont as font, adminTone, adminSpace, adminRadius, AdminCard as Card, TONE } from '@/components/admin';
import { Row, Input, Button, Chip, Badge, toast } from '@/components/ui';
import { rpc, supabase } from '@/lib/supabase';
import { colors } from '@/lib/theme';
import { rupiah } from '@/lib/format';
import { handleAdminError, useAdminSecurity } from '@/store/adminSecurity';
import { useAppSettingsStore } from '@/hooks/useAppSettings';
import { PAYMENT_CHANNELS, GATEWAY_CHANNELS, channelLabel } from '@/store/payprefs';
import type { AdminPaymentChannels, GatewayStatus, PaymentChannels } from '@/lib/types';
import { fmtDate, WideTableHint, ErrorNote } from './_shared';
import {
  PROVIDERS, SECRET_FIELDS, asList, maskSecret, providerLabel, webhookUrl, SUPABASE_BASE,
  type GatewaySecretRow, type PaymentEnv, type PaymentProvider, type PaymentProviderPublic,
  handleSettingsError,
} from '@/lib/admin';

const WEBHOOK_URL = 'https://qwltshvzrsykxdvhbxcv.supabase.co/functions/v1/midtrans-webhook';
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
  // 0088: sakelar AntarPay. null = belum termuat.
  const [payOn, setPayOn] = useState<boolean | null>(null);
  const [payBusy, setPayBusy] = useState(false);
  // 0089: sakelar per saluran pembayaran (nilai MENTAH yang disetel admin, bukan status efektif).
  const [chan, setChan] = useState<PaymentChannels | null>(null);
  const [chanBusy, setChanBusy] = useState<string | null>(null);
  // 0104: sakelar bayar per pesanan lewat gateway. null = belum termuat.
  const [gwOrderOn, setGwOrderOn] = useState<boolean | null>(null);
  const [gwOrderBusy, setGwOrderBusy] = useState(false);

  const apply = useCallback((g: GatewayStatus) => {
    setSt(g);
    setF((p) => ({ ...p, server_key: '', client_key: g.client_key ?? '', merchant_id: g.merchant_id ?? '', is_production: g.is_production, methods: g.methods ?? [], topup_min: String(g.topup_min), topup_max: String(g.topup_max) }));
  }, []);
  const load = useCallback(async () => {
    try { apply(await rpc<GatewayStatus>('admin_gateway_status')); } catch (e) { toast.error((e as Error).message); }
    try { setPayOn((await rpc<boolean>('antarpay_enabled')) === true); } catch { setPayOn(false); }
    try {
      const pc = await rpc<AdminPaymentChannels>('admin_payment_channels');
      setChan(pc?.payment_channels ?? null);
      setGwOrderOn(pc?.gateway_order_payment_enabled === true);
    } catch (e) { handleAdminError(e); }
  }, [apply]);
  useEffect(() => { load(); }, [load]);

  /** Sakelar AntarPay: butuh panel terbuka kunci PIN (admin_require_unlock) — ADMIN_LOCKED ditangani handleAdminError. */
  const toggleAntarPay = async (on: boolean) => {
    if (!(await useAdminSecurity.getState().ensureUnlocked())) return;
    const prev = payOn;
    setPayBusy(true); setPayOn(on);
    try {
      const r = await rpc<{ antarpay_enabled: boolean }>('admin_set_antarpay_enabled', { p_enabled: on });
      const v = r?.antarpay_enabled === true;
      setPayOn(v);
      toast.success(v ? 'AntarPay DIAKTIFKAN — top up, pencairan, dan bayar dompet/e-wallet dibuka' : 'AntarPay DINONAKTIFKAN — pelanggan hanya bisa bayar tunai');
      useAppSettingsStore.getState().load(true);
    } catch (e) { setPayOn(prev); handleAdminError(e); }
    finally { setPayBusy(false); }
  };

  /** 0089: sakelar satu saluran pembayaran — butuh PIN panel (admin_require_unlock); ikut menyinkronkan pg_methods. */
  const toggleChannel = async (key: string, on: boolean) => {
    if (!(await useAdminSecurity.getState().ensureUnlocked())) return;
    const prev = chan;
    setChanBusy(key); setChan((c) => ({ ...(c ?? {}), [key]: on }));
    try {
      const r = await rpc<AdminPaymentChannels>('admin_set_payment_channel', { p_key: key, p_enabled: on });
      setChan(r?.payment_channels ?? { ...(prev ?? {}), [key]: on });
      if (Array.isArray(r?.pg_methods)) setF((p) => ({ ...p, methods: r.pg_methods }));
      const label = PAYMENT_CHANNELS.find((c) => c.key === key)?.label ?? key;
      toast.success(`${label} ${on ? 'diaktifkan' : 'dinonaktifkan'}`);
      useAppSettingsStore.getState().load(true);
    } catch (e) { setChan(prev); handleAdminError(e); }
    finally { setChanBusy(null); }
  };

  /** 0104: sakelar bayar per pesanan lewat gateway — PIN panel (admin_require_unlock) + audit gateway_order_payment.toggle. */
  const toggleGatewayOrder = async (on: boolean) => {
    if (!(await useAdminSecurity.getState().ensureUnlocked())) return;
    const prev = gwOrderOn;
    setGwOrderBusy(true); setGwOrderOn(on);
    try {
      const r = await rpc<{ gateway_order_payment_enabled: boolean; antarpay_enabled: boolean }>('admin_set_gateway_order_payment', { p_enabled: on });
      const v = r?.gateway_order_payment_enabled === true;
      setGwOrderOn(v);
      if (typeof r?.antarpay_enabled === 'boolean') setPayOn(r.antarpay_enabled);
      toast.success(v ? 'Bayar per pesanan lewat gateway DIAKTIFKAN — top up AntarPay tidak ikut menyala' : 'Bayar per pesanan lewat gateway DINONAKTIFKAN');
      useAppSettingsStore.getState().load(true);
    } catch (e) { setGwOrderOn(prev); handleAdminError(e); }
    finally { setGwOrderBusy(false); }
  };

  const save = async () => {
    const min = Number(f.topup_min), max = Number(f.topup_max);
    if (!min || !max || min >= max) return toast.error('Batas top up tidak valid (min < max)');
    if (!(await useAdminSecurity.getState().ensureUnlocked())) return;
    setBusy(true);
    try {
      // Metode gateway = hasil daftar Saluran Pembayaran (0089) supaya pg_methods tidak bertabrakan dengan sakelar saluran.
      const methods = chan ? GATEWAY_CHANNELS.filter((k) => chan[k] === true) : f.methods;
      const p: Record<string, unknown> = { client_key: f.client_key.trim(), merchant_id: f.merchant_id.trim(), is_production: f.is_production, methods, topup_min: min, topup_max: max };
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

  const stats = st?.stats;
  return (
    <AdminPage title="Payment Gateway" subtitle="Provider aktif (Midtrans / Finpay), kredensial per lingkungan, webhook, saluran pembayaran, dan konfigurasi Midtrans lama." onRefresh={load}>
      <ProviderActiveCard />
      <RequirePerm perm="gateway_secret"><SecretsCard /></RequirePerm>

      <Card style={{ gap: 10, borderColor: payOn ? colors.success + '55' : colors.warning + '66', borderWidth: 1 }}>
        <Row between style={{ flexWrap: 'wrap', gap: 10 }}>
          <View style={{ flex: 1, minWidth: 220 }}>
            <Row gap={8} style={{ alignItems: 'center' }}>
              <Text style={font.h3}>AntarPay & Payment Gateway</Text>
              {payOn === null ? <Badge text="Memuat…" color={colors.textMuted} /> : <Badge text={payOn ? 'AKTIF' : 'NONAKTIF'} color={payOn ? colors.success : colors.warning} />}
            </Row>
            <Text style={[font.small, { marginTop: 4 }]}>
              {payOn ? 'AntarPay aktif: pelanggan bisa top up, membayar dengan saldo/e-wallet, dan mitra bisa mencairkan saldo.'
                : 'AntarPay nonaktif (bawaan sampai pemilik menyalakannya): pelanggan hanya bisa membayar tunai.'}
            </Text>
          </View>
          <Row gap={8} style={{ alignItems: 'center' }}>
            <Text style={[font.small, { color: adminTone.ink, fontWeight: '700' }]}>{payOn ? 'Aktif' : 'Nonaktif'}</Text>
            <Switch value={!!payOn} disabled={payBusy || payOn === null} onValueChange={toggleAntarPay} trackColor={{ true: colors.success, false: colors.border }} thumbColor="#fff" />
          </Row>
        </Row>
        <View style={[s.note, { backgroundColor: colors.warning + '14', borderColor: colors.warning + '50' }]}>
          <Text style={font.small}>
            Saat nonaktif: top-up, pencairan, dan bayar dengan AntarPay/e-wallet ditolak server; pelanggan hanya bisa bayar tunai. Refund otomatis tetap berjalan.
          </Text>
          <Text style={[font.tiny, { marginTop: 4 }]}>Mengubah sakelar memerlukan PIN panel admin dan dicatat di log aktivitas. Perubahan terasa di aplikasi pelanggan & mitra dalam hitungan detik (realtime app_settings).</Text>
        </View>
      </Card>

      {/* 0104: bayar per pesanan lewat gateway — terpisah dari AntarPay (top up / saldo). */}
      <Card style={{ gap: 10, borderColor: gwOrderOn ? colors.success + '55' : adminTone.border, borderWidth: 1 }}>
        <Row between style={{ flexWrap: 'wrap', gap: 10 }}>
          <View style={{ flex: 1, minWidth: 220 }}>
            <Row gap={8} style={{ alignItems: 'center', flexWrap: 'wrap' }}>
              <Text style={font.h3}>Bayar per pesanan lewat gateway</Text>
              {gwOrderOn === null ? <Badge text="Memuat…" color={colors.textMuted} /> : <Badge text={gwOrderOn ? 'AKTIF' : 'NONAKTIF'} color={gwOrderOn ? colors.success : colors.textMuted} />}
            </Row>
            <Text style={[font.small, { marginTop: 4 }]}>
              {gwOrderOn
                ? `Pelanggan bisa membayar satu pesanan langsung lewat saluran gateway yang menyala (GoPay/ShopeePay/QRIS/VA/kartu)${payOn === false ? ' walau AntarPay nonaktif' : ''}. Pesanan baru dicarikan driver setelah pembayaran masuk.`
                : 'Nonaktif: saluran gateway hanya bisa dipakai bila AntarPay aktif (perilaku lama).'}
            </Text>
          </View>
          <Row gap={8} style={{ alignItems: 'center' }}>
            <Text style={[font.small, { color: adminTone.ink, fontWeight: '700' }]}>{gwOrderOn ? 'Aktif' : 'Nonaktif'}</Text>
            <Switch value={!!gwOrderOn} disabled={gwOrderBusy || gwOrderOn === null} onValueChange={toggleGatewayOrder} trackColor={{ true: colors.success, false: colors.border }} thumbColor="#fff" />
          </Row>
        </Row>
        <View style={[s.note, { backgroundColor: adminTone.blue + '12', borderColor: adminTone.blue + '40' }]}>
          <Text style={font.small}>
            Bayar per pesanan lewat gateway tetap berfungsi walau <Text style={{ fontWeight: '700' }}>AntarPay/top up NONAKTIF</Text>: dana langsung untuk transaksi itu (purpose=order) dan tidak disimpan sebagai saldo. Sakelar ini tidak menyalakan AntarPay, top up, maupun pencairan.
          </Text>
          <Text style={[font.tiny, { marginTop: 4 }]}>
            Sesuai PKS Midtrans Pasal 7 ayat 4(b), fitur uang elektronik/dompet (stored value, isi saldo) tanpa izin Bank Indonesia dapat membuat layanan dihentikan — top up AntarPay tetap mati sampai ada izin BI/review legal. Mengubah sakelar memerlukan PIN panel admin dan dicatat di log aktivitas (gateway_order_payment.toggle).
          </Text>
        </View>
      </Card>

      {/* 0089: sakelar aktif/nonaktif SETIAP saluran pembayaran (gaya daftar halaman bayar Alfagift). */}
      <Card style={{ gap: 4 }}>
        <Row between style={{ flexWrap: 'wrap', gap: 8 }}>
          <View style={{ flex: 1, minWidth: 220 }}>
            <Text style={font.h3}>Saluran Pembayaran</Text>
            <Text style={[font.small, { marginTop: 2 }]}>Nyalakan/matikan tiap saluran satu per satu. Pelanggan hanya melihat saluran yang menyala; server menolak pesanan dengan saluran yang mati.</Text>
          </View>
          {chan === null ? <Badge text="Memuat…" color={colors.textMuted} /> : <Badge text={`${PAYMENT_CHANNELS.filter((c) => (c.key === 'cash' ? chan[c.key] !== false : chan[c.key] === true) && (c.key === 'cash' || payOn || (gwOrderOn === true && GATEWAY_CHANNELS.includes(c.key)))).length}/${PAYMENT_CHANNELS.length} aktif`} color={adminTone.blue} />}
        </Row>
        {payOn === false ? (
          <View style={[s.note, { backgroundColor: colors.warning + '14', borderColor: colors.warning + '50', marginVertical: 6 }]}>
            <Text style={font.small}>
              {gwOrderOn
                ? 'Sakelar AntarPay global sedang nonaktif — saldo AntarPay & e-money nonaktif; saluran gateway tetap bisa dipakai untuk bayar per pesanan.'
                : 'Sakelar AntarPay global sedang nonaktif — semua saluran non-tunai ikut nonaktif.'}
            </Text>
          </View>
        ) : null}
        <View style={{ marginTop: 6 }}>
          {PAYMENT_CHANNELS.map((c) => {
            const isCash = c.key === 'cash';
            const stored = chan === null ? false : isCash ? chan[c.key] !== false : chan[c.key] === true;
            // Dua induk: (1) sakelar global AntarPay 0088, (2) saluran 'antarpay' itu sendiri —
            // di server SETIAP pembayaran non-tunai diselesaikan lewat saldo AntarPay.
            const railOn = chan !== null && chan.antarpay === true && payOn === true;
            // 0104: saluran gateway + sakelar bayar per pesanan → tidak bergantung pada AntarPay (per pesanan saja).
            const perOrder = gwOrderOn === true && GATEWAY_CHANNELS.includes(c.key);
            const dimGlobal = !isCash && !perOrder && payOn === false;
            const dimRail = !isCash && !perOrder && c.key !== 'antarpay' && payOn === true && chan !== null && chan.antarpay !== true;
            const dim = dimGlobal || dimRail;
            const effective = stored && (isCash || perOrder || (c.key === 'antarpay' ? payOn === true : railOn));
            return (
              <Row key={c.key} between style={[s.chRow, dim && { opacity: 0.45 }]}>
                <Row gap={10} style={{ flex: 1, minWidth: 0, alignItems: 'center' }}>
                  <View style={[s.chIcon, { backgroundColor: effective ? c.color : adminTone.surfaceAlt }]}>
                    <Ionicons name={c.icon as never} size={18} color={effective ? '#fff' : colors.textMuted} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[font.body, { color: adminTone.ink, fontWeight: '700' }]} numberOfLines={1}>{c.label}</Text>
                    <Text style={font.tiny} numberOfLines={2}>{dimGlobal ? 'Nonaktif karena sakelar AntarPay global mati' : dimRail ? 'Nonaktif karena saluran AntarPay (saldo) dimatikan' : perOrder && payOn === false ? `${c.hint} · bayar per pesanan` : c.hint}</Text>
                  </View>
                </Row>
                <Switch
                  value={stored}
                  disabled={chan === null || chanBusy !== null || dim}
                  onValueChange={(v) => toggleChannel(c.key, v)}
                  trackColor={{ true: colors.success, false: colors.border }} thumbColor="#fff" />
              </Row>
            );
          })}
        </View>
        <Text style={[font.tiny, { marginTop: 6 }]}>
          Mengubah sakelar memerlukan PIN panel admin dan dicatat di log aktivitas (payment_channel.toggle). Saluran gateway (GoPay/ShopeePay/QRIS/OVO/DANA/VA/kartu) ikut memperbarui daftar metode Snap Midtrans. Tunai/COD tidak tunduk pada sakelar global.
        </Text>
        <View style={[s.note, { backgroundColor: adminTone.blue + '12', borderColor: adminTone.blue + '40', marginTop: 8 }]}>
          <Text style={font.tiny}>
            <Text style={{ fontWeight: '700' }}>Catatan teknis: </Text>
            semua pembayaran non-tunai saat ini diselesaikan lewat saldo AntarPay (GoPay/QRIS/VA/e-money sekalipun). Karena itu mematikan saluran <Text style={{ fontWeight: '700' }}>AntarPay (saldo)</Text> otomatis menutup seluruh saluran non-tunai dan menutup top up. Untuk mematikan satu metode saja, matikan barisnya sendiri — jangan baris AntarPay.
          </Text>
        </View>
      </Card>

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
            ['Metode aktif', (st?.methods ?? []).map(channelLabel).join(', ') || '-'],
            ['Batas top up', st ? `${rupiah(st.topup_min)} - ${rupiah(st.topup_max)}` : '-'],
            ['Diperbarui', st?.updated_at ? `${fmtDate(st.updated_at)}${st.updated_by ? ` oleh ${st.updated_by}` : ''}` : '-'],
            ['Webhook terakhir', st?.last_webhook_at ? fmtDate(String(st.last_webhook_at).replace(/"/g, '')) : 'Belum pernah diterima'],
          ].map(([k, v]) => <Row key={k} between style={{ gap: 12 }}><Text style={font.tiny}>{k}</Text><Text style={[font.small, { color: adminTone.ink, flex: 1, textAlign: 'right' }]} numberOfLines={2}>{v}</Text></Row>)}
          <Button title="Uji koneksi ke Midtrans" variant="outline" icon="pulse-outline" loading={testing} onPress={testConn} />
          {test ? <View style={[s.note, { backgroundColor: (test.ok ? colors.success : colors.danger) + '14', borderColor: (test.ok ? colors.success : colors.danger) + '50' }]}><Text style={[font.small, { color: test.ok ? colors.success : colors.danger }]}>{test.text}</Text></View> : null}
          <View style={{ gap: 6 }}>
            <Text style={font.label}>URL webhook Midtrans lama (midtrans-webhook)</Text>
            <View style={s.code}><Text selectable style={s.codeText}>{WEBHOOK_URL}</Text></View>
            <Button size="sm" title="Salin URL webhook" icon="copy-outline" variant="secondary" onPress={copyWebhook} />
          </View>
        </Card>

        <Card style={{ flex: 1.2, minWidth: 340, gap: 10 }}>
          <Text style={font.label}>Konfigurasi Midtrans (lama · admin_set_gateway)</Text>
          <Text style={font.tiny}>Dipakai edge midtrans-create/midtrans-webhook untuk transaksi lama & top up. Kredensial per provider/lingkungan untuk transaksi baru diatur di kartu “Kredensial provider” di atas.</Text>
          <Input label="Server Key" placeholder={st?.configured ? 'Kosongkan bila tidak diganti' : 'SB-Mid-server-xxxx / Mid-server-xxxx'} value={f.server_key} onChangeText={(v) => setF({ ...f, server_key: v })} secureTextEntry autoCapitalize="none" />
          <Input label="Client Key" placeholder="SB-Mid-client-xxxx / Mid-client-xxxx" value={f.client_key} onChangeText={(v) => setF({ ...f, client_key: v })} autoCapitalize="none" />
          <Input label="Merchant ID" placeholder="G123456789" value={f.merchant_id} onChangeText={(v) => setF({ ...f, merchant_id: v })} autoCapitalize="none" />
          <Text style={font.label}>Mode</Text>
          <Row gap={6}><Chip label="Sandbox (uji)" active={!f.is_production} onPress={() => setF({ ...f, is_production: false })} color={colors.info} /><Chip label="Production" active={f.is_production} onPress={() => setF({ ...f, is_production: true })} color={colors.success} /></Row>
          <Text style={font.tiny}>Metode aktif diatur di kartu <Text style={{ fontWeight: '700' }}>Saluran Pembayaran</Text> di atas (ikut memperbarui daftar metode Snap).</Text>
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
          { key: 'created_at', label: 'Waktu', width: 130, render: (r) => <Text style={font.tiny}>{fmtDate(String(r.created_at))}</Text> },
          { key: 'external_id', label: 'ID transaksi', width: 200, render: (r) => <Text style={font.tiny} numberOfLines={1}>{String(r.external_id ?? r.id)}</Text> },
          { key: 'user', label: 'Pengguna', width: 150, render: (r) => <Text style={font.small}>{String(r.user ?? '-')}</Text> },
          { key: 'purpose', label: 'Tujuan', width: 90, render: (r) => <Text style={font.small}>{r.purpose === 'topup' ? 'Top up' : 'Pesanan'}</Text> },
          { key: 'method', label: 'Metode', width: 130, render: (r) => <Text style={font.small}>{String(r.method)} · {String(r.provider)}</Text> },
          { key: 'amount', label: 'Nominal', width: 120, align: 'right', mono: true, render: (r) => <Text style={font.mono}>{rupiah(Number(r.amount))}</Text> },
          { key: 'status', label: 'Status', width: 110, render: (r) => <Badge text={STATUS_LABEL[String(r.status)] ?? String(r.status)} color={STATUS_COLOR[String(r.status)] ?? colors.textMuted} /> },
        ]} />
      </Card>
      <WideTableHint />
    </AdminPage>
  );
}

/* ───────────────────── v3 · Provider aktif (kontrak §1) ───────────────────── */

type ProviderSettings = { provider: PaymentProvider; env: PaymentEnv; simulation: boolean; disbursement: 'manual' | 'finpay' };
const PROVIDER_KEYS = ['payment_provider_active', 'payment_provider_env', 'payments_simulation_enabled', 'disbursement_provider'];
const unq = (v: unknown) => (typeof v === 'string' ? v.replace(/^"+|"+$/g, '') : v);

function ProviderActiveCard() {
  const [saved, setSaved] = useState<ProviderSettings | null>(null);
  const [f, setF] = useState<ProviderSettings>({ provider: 'midtrans', env: 'sandbox', simulation: false, disbursement: 'manual' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [test, setTest] = useState<{ ok: boolean; pub?: PaymentProviderPublic; text?: string } | null>(null);
  const [testing, setTesting] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('app_settings').select('key,value').in('key', PROVIDER_KEYS);
    if (error) { setErr(error.message); return; }
    const m = new Map(((data as { key: string; value: unknown }[]) ?? []).map((r) => [r.key, unq(r.value)]));
    const v: ProviderSettings = {
      provider: (m.get('payment_provider_active') as PaymentProvider) || 'midtrans',
      env: (m.get('payment_provider_env') as PaymentEnv) || 'sandbox',
      simulation: m.get('payments_simulation_enabled') === true || m.get('payments_simulation_enabled') === 'true',
      disbursement: (m.get('disbursement_provider') as 'manual' | 'finpay') || 'manual',
    };
    setSaved(v); setF(v); setErr(null);
  }, []);
  useEffect(() => { load(); }, [load]);

  const dirty = !!saved && (saved.provider !== f.provider || saved.env !== f.env || saved.simulation !== f.simulation || saved.disbursement !== f.disbursement);
  const toProd = !!saved && f.env === 'production' && saved.env !== 'production';
  const willSim = f.env === 'production' ? false : f.simulation;

  const doSave = async () => {
    if (!saved) return;
    if (!(await useAdminSecurity.getState().ensureUnlocked())) return;
    const p: Record<string, unknown> = {};
    if (saved.provider !== f.provider) p.payment_provider_active = f.provider;
    if (saved.env !== f.env) p.payment_provider_env = f.env;
    if (saved.simulation !== willSim) p.payments_simulation_enabled = willSim;
    if (saved.disbursement !== f.disbursement) p.disbursement_provider = f.disbursement;
    if (!Object.keys(p).length) return toast.show('Tidak ada perubahan');
    setBusy(true);
    try {
      await rpc('admin_set_settings', { p });
      toast.success(`Provider ${providerLabel(f.provider)} · ${f.env === 'production' ? 'PRODUCTION' : 'sandbox'} disimpan — berlaku untuk transaksi BARU`);
      setConfirm(false); setConfirmText(''); setTest(null);
      useAppSettingsStore.getState().load(true);
      await load();
    } catch (e) { handleSettingsError(e); } finally { setBusy(false); }
  };
  const save = () => { if (toProd || (dirty && saved?.provider !== f.provider)) { setConfirmText(''); setConfirm(true); } else doSave(); };

  /** "Uji koneksi" tanpa kontrak baru: baca konfigurasi publik yang dipakai aplikasi pelanggan. */
  const runTest = async () => {
    setTesting(true); setTest(null);
    try {
      const pub = await rpc<PaymentProviderPublic>('payment_provider_public');
      const ok = !!pub?.provider;
      setTest({ ok, pub, text: ok ? undefined : 'payment_provider_public() tidak mengembalikan provider' });
    } catch (e) { setTest({ ok: false, text: (e as Error).message }); } finally { setTesting(false); }
  };

  const prod = (saved?.env ?? f.env) === 'production';
  return (
    <Card style={{ gap: 12, borderWidth: prod ? 2 : 1, borderColor: prod ? colors.danger : adminTone.border }}>
      {prod ? (
        <View style={[s.note, { backgroundColor: TONE.bad.bg, borderColor: TONE.bad.border }]}>
          <Row gap={10} style={{ alignItems: 'flex-start' }}>
            <Ionicons name="warning" size={26} color={TONE.bad.fg} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[font.h2, { color: TONE.bad.fg }]}>MODE PRODUCTION — UANG SUNGGUHAN</Text>
              <Text style={[font.small, { color: TONE.bad.fg }]}>Setiap transaksi baru ditagih nyata ke pelanggan lewat {providerLabel(saved?.provider)}. Simulasi otomatis mati. Pastikan kredensial production, URL webhook, dan saluran sudah diuji di sandbox.</Text>
            </View>
          </Row>
        </View>
      ) : null}
      <Row between style={{ flexWrap: 'wrap', gap: 10 }}>
        <View style={{ flex: 1, minWidth: 240 }}>
          <Row gap={8} style={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <Text style={font.h3}>Provider aktif</Text>
            {saved ? <Badge text={`${providerLabel(saved.provider)} · ${saved.env === 'production' ? 'PRODUCTION' : 'Sandbox'}`} color={saved.env === 'production' ? colors.danger : colors.info} /> : <Badge text="Memuat…" color={colors.textMuted} />}
            {saved?.simulation && saved.env !== 'production' ? <Badge text="Simulasi ON" color={colors.warning} /> : null}
          </Row>
          <Text style={[font.small, { marginTop: 4 }]}>Berlaku untuk transaksi BARU (edge pay-create). Transaksi yang sudah dibuat tetap diselesaikan oleh provider asalnya.</Text>
        </View>
        <Button size="sm" variant="outline" title="Uji koneksi" icon="pulse-outline" loading={testing} onPress={runTest} />
      </Row>
      <ErrorNote text={err} onRetry={load} />
      <Row gap={16} style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <View style={{ gap: 6 }}>
          <Text style={font.label}>Provider transaksi baru</Text>
          <Row gap={6}>{PROVIDERS.map((p) => <Chip key={p.value} label={p.label} active={f.provider === p.value} onPress={() => setF({ ...f, provider: p.value })} color={colors.primary} />)}</Row>
        </View>
        <View style={{ gap: 6 }}>
          <Text style={font.label}>Lingkungan</Text>
          <Row gap={6}>
            <Chip label="Sandbox (uji)" active={f.env === 'sandbox'} onPress={() => setF({ ...f, env: 'sandbox' })} color={colors.info} />
            <Chip label="Production" active={f.env === 'production'} onPress={() => setF({ ...f, env: 'production', simulation: false })} color={colors.danger} />
          </Row>
          {f.provider === 'finpay' ? <Text style={font.tiny}>Finpay: sandbox = devo.finnet.co.id · production = live.finnet.co.id</Text> : null}
        </View>
        <View style={{ gap: 6 }}>
          <Text style={font.label}>Simulasi pembayaran</Text>
          <Row gap={8} style={{ alignItems: 'center' }}>
            <Switch value={willSim} disabled={f.env === 'production'} onValueChange={(v) => setF({ ...f, simulation: v })} trackColor={{ true: colors.warning, false: colors.border }} thumbColor="#fff" />
            <Text style={font.small}>{f.env === 'production' ? 'Tidak tersedia di production' : willSim ? 'Aktif (hanya sandbox)' : 'Nonaktif'}</Text>
          </Row>
        </View>
        <View style={{ gap: 6 }}>
          <Text style={font.label}>Pencairan mitra</Text>
          <Row gap={6}>
            <Chip label="Manual (transfer bank)" active={f.disbursement === 'manual'} onPress={() => setF({ ...f, disbursement: 'manual' })} />
            <Chip label="Finpay disbursement" active={f.disbursement === 'finpay'} onPress={() => setF({ ...f, disbursement: 'finpay' })} />
          </Row>
        </View>
      </Row>
      <RequirePerm perm="settings" fallback={<Text style={font.tiny}>Mengganti provider/lingkungan butuh izin payment_config (superadmin).</Text>}>
        <Row gap={8} style={{ justifyContent: 'flex-end' }}>
          {dirty ? <Button size="sm" variant="ghost" title="Batalkan" onPress={() => saved && setF(saved)} /> : null}
          <Button size="sm" title="Simpan provider" icon="save-outline" disabled={!dirty} loading={busy} color={f.env === 'production' ? colors.danger : undefined} onPress={save} />
        </Row>
      </RequirePerm>
      {test ? (
        <View style={[s.note, { backgroundColor: (test.ok ? colors.success : colors.danger) + '14', borderColor: (test.ok ? colors.success : colors.danger) + '50', gap: 4 }]}>
          {test.pub ? (
            <>
              <Text style={[font.small, { color: adminTone.ink, fontWeight: '700' }]}>payment_provider_public(): {providerLabel(test.pub.provider)} · {test.pub.env} · simulasi {test.pub.simulation ? 'ON' : 'OFF'}</Text>
              <Text style={font.tiny}>
                {(test.pub.channels ?? []).length} saluran · aktif: {(test.pub.channels ?? []).filter((c) => c.enabled !== false).map((c) => `${c.label ?? c.key}${c.fee_label ? ` (${c.fee_label})` : ''}${c.pass_to_customer ? ' · dibebankan' : ''}`).join(', ') || '—'}
              </Text>
              {saved && (test.pub.provider !== saved.provider || test.pub.env !== saved.env) ? <Text style={[font.tiny, { color: TONE.bad.fg }]}>Tidak sama dengan pengaturan tersimpan ({saved.provider}/{saved.env}) — periksa cache/konfigurasi server.</Text> : null}
              <Text style={font.tiny}>Uji ini memeriksa konfigurasi yang dilihat aplikasi pelanggan (tanpa memanggil provider). Uji transaksi nyata: buat pesanan sandbox dari aplikasi Pelanggan.</Text>
            </>
          ) : <Text style={[font.small, { color: colors.danger }]}>{test.text}</Text>}
        </View>
      ) : null}

      <AdminDialog visible={confirm} onClose={() => setConfirm(false)} title={toProd ? 'Aktifkan PRODUCTION?' : 'Ganti provider pembayaran?'} tone={toProd ? colors.danger : adminTone.teal}
        subtitle={`${providerLabel(saved?.provider)} · ${saved?.env} → ${providerLabel(f.provider)} · ${f.env}`}>
        <Text style={font.body}>
          {toProd
            ? 'Semua transaksi BARU akan menagih uang sungguhan. Pastikan kredensial production sudah diisi, URL webhook production sudah didaftarkan, dan uji sandbox lulus.'
            : 'Transaksi BARU akan dibuat lewat provider baru. Transaksi yang sedang menunggu pembayaran tetap diselesaikan lewat provider lama.'}
        </Text>
        {toProd ? <Input label='Ketik "PRODUCTION" untuk konfirmasi' value={confirmText} onChangeText={setConfirmText} autoCapitalize="characters" /> : null}
        <Row gap={8} style={{ justifyContent: 'flex-end' }}>
          <Button size="sm" variant="ghost" title="Batal" onPress={() => setConfirm(false)} />
          <Button size="sm" title="Ya, simpan" color={toProd ? colors.danger : undefined} loading={busy} disabled={toProd && confirmText.trim().toUpperCase() !== 'PRODUCTION'} onPress={doSave} />
        </Row>
      </AdminDialog>
    </Card>
  );
}

/* ───────────────────── v3 · Kredensial per (provider, env) ───────────────────── */

const ENVS: PaymentEnv[] = ['sandbox', 'production'];
const secretShown = (r: GatewaySecretRow | undefined, k: 'merchant_id' | 'server_key' | 'client_key' | 'callback_token') => {
  if (!r) return null;
  if (k === 'merchant_id') return r.merchant_id ?? null;
  const masked = (r as unknown as Record<string, string | null | undefined>)[`${k}_masked`] ?? (r as unknown as Record<string, string | null | undefined>)[k];
  return maskSecret(masked ?? null);   // server sudah menyamarkan; maskSecret mencegah nilai penuh tampil bila tidak
};

function SecretsCard() {
  const [rows, setRows] = useState<GatewaySecretRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ provider: PaymentProvider; env: PaymentEnv } | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [extraAck, setExtraAck] = useState(false);

  const load = useCallback(async () => {
    try { setRows(asList<GatewaySecretRow>(await rpc('admin_gateway_secrets'))); setErr(null); }
    catch (e) { setErr((e as Error).message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const find = (p: string, e: string) => rows.find((r) => r.provider === p && (r.env ?? 'sandbox') === e);
  const open = (provider: PaymentProvider, env: PaymentEnv) => { setForm({}); setExtraAck(false); setEdit({ provider, env }); };
  const close = () => { setForm({}); setExtraAck(false); setEdit(null); };   // isian rahasia langsung dibuang dari memori layar
  /** Kunci extra lain yang akan HILANG bila extra dikirim (server mengganti seluruh objek extra, bukan menggabung). */
  const otherExtra = (p?: string, e?: string) => (p && e ? (find(p, e)?.extra_keys ?? []).filter((k) => k !== 'cron_secret') : []);
  const cronSet = rows.some((r) => (r.extra_keys ?? []).includes('cron_secret'));

  const submit = async () => {
    if (!edit) return;
    const patch: Record<string, unknown> = {};
    for (const f of SECRET_FIELDS) { const v = (form[f.key] ?? '').trim(); if (v) patch[f.key] = v; }
    const cron = (form.cron_secret ?? '').trim();
    if (cron) {
      if (cron.length < 16) return toast.error('Cron secret minimal 16 karakter (samakan dengan env CRON_SECRET edge function)');
      if (otherExtra(edit.provider, edit.env).length && !extraAck) return toast.error('Centang konfirmasi: kunci extra lain akan terhapus');
      patch.extra = { cron_secret: cron };
    }
    if (!Object.keys(patch).length) return toast.error('Isi minimal satu kolom (kolom kosong = tidak diubah)');
    if (!(await useAdminSecurity.getState().ensureUnlocked())) return;
    setBusy(true);
    try {
      await rpc('admin_set_gateway_secret', { p_provider: edit.provider, p_env: edit.env, p_patch: patch });
      toast.success(`Kredensial ${providerLabel(edit.provider)} · ${edit.env} disimpan (${Object.keys(patch).join(', ')})`);
      close(); await load();
    } catch (e) { handleAdminError(e); } finally { setBusy(false); }
  };
  const copy = async (u: string) => { await Clipboard.setStringAsync(u); toast.success('URL disalin'); };

  return (
    <Card style={{ gap: 12 }}>
      <Row between style={{ flexWrap: 'wrap', gap: 8 }}>
        <View style={{ flex: 1, minWidth: 240 }}>
          <Text style={font.h3}>Kredensial provider</Text>
          <Text style={[font.small, { marginTop: 2 }]}>Disimpan di tabel rahasia gateway_secrets (hanya dibaca edge function). Nilai kunci tidak pernah ditampilkan penuh; log hanya mencatat 6 karakter awal/4 akhir.</Text>
        </View>
        <Button size="sm" variant="outline" title="Segarkan" icon="refresh-outline" onPress={load} />
      </Row>
      <ErrorNote text={err} onRetry={load} />
      <Row gap={12} style={{ flexWrap: 'wrap' }}>
        {PROVIDERS.flatMap((p) => ENVS.map((env) => {
          const r = find(p.value, env);
          const has = !!r && !!(secretShown(r, 'server_key') || r.has_server_key || r.configured);
          return (
            <View key={`${p.value}-${env}`} style={[s.secret, env === 'production' && { borderColor: colors.danger + '55' }]}>
              <Row between style={{ gap: 8 }}>
                <Text style={font.bodyStrong}>{p.label}</Text>
                <Pill text={env === 'production' ? 'Production' : 'Sandbox'} tone={env === 'production' ? 'bad' : 'info'} />
              </Row>
              {SECRET_FIELDS.map((f) => (
                <Row key={f.key} between style={{ gap: 8 }}>
                  <Text style={font.tiny}>{f.label}</Text>
                  <Text selectable={!f.secret} style={[font.small, { color: adminTone.ink, fontFamily: 'monospace' }]} numberOfLines={1}>{secretShown(r, f.key) ?? '—'}</Text>
                </Row>
              ))}
              {p.value === 'finpay' ? (
                <Row between style={{ gap: 8 }}>
                  <Text style={font.tiny}>Cron secret (extra)</Text>
                  <Text style={[font.small, { color: adminTone.ink }]}>{(r?.extra_keys ?? []).includes('cron_secret') ? 'terisi ••••' : '—'}</Text>
                </Row>
              ) : null}
              <Text style={font.tiny}>{r?.updated_at ? `Diubah ${fmtDate(r.updated_at)}${r.updated_by_name ?? r.updated_by ? ` oleh ${r.updated_by_name ?? r.updated_by}` : ''}` : 'Belum diisi'}{r?.active ? ' · AKTIF' : ''}</Text>
              <Row gap={6} style={{ flexWrap: 'wrap' }}>
                <Pill text={has ? 'Terkonfigurasi' : 'Belum lengkap'} tone={has ? 'ok' : 'wait'} />
                <Button size="sm" variant="secondary" title={has ? 'Ganti kunci' : 'Isi kredensial'} icon="key-outline" onPress={() => open(p.value, env)} />
              </Row>
            </View>
          );
        }))}
      </Row>
      <View style={[s.note, { backgroundColor: adminTone.blue + '10', borderColor: adminTone.blue + '40', gap: 6 }]}>
        <Row gap={8} style={{ alignItems: 'center' }}>
          <Ionicons name="link-outline" size={18} color={adminTone.blue} />
          <Text style={font.h3}>Pengikatan lingkungan (env)</Text>
        </Row>
        <Text style={font.small}>• Setiap intent pembayaran menyimpan <Text style={{ fontWeight: '700' }}>payments.env</Text> (sandbox/production) saat dibuat. Mengganti lingkungan aktif hanya berlaku untuk transaksi BARU.</Text>
        <Text style={font.small}>• Webhook & cek status hanya diverifikasi dengan kunci <Text style={{ fontWeight: '700' }}>(provider, env) milik transaksi itu</Text> — notifikasi sandbox tidak bisa menandai transaksi production (dan sebaliknya). Jangan hapus kunci sandbox selama masih ada transaksi sandbox yang menunggu.</Text>
        <Text style={font.small}>• <Text style={{ fontWeight: '700' }}>gateway_secrets.extra.cron_secret</Text> harus sama dengan env <Text style={{ fontWeight: '700' }}>CRON_SECRET</Text> edge function — pg_cron memanggil pay-reconcile dengan header x-cron-secret dari nilai ini; bila kosong, rekonsiliasi terjadwal dilewati.</Text>
        <Row gap={6} style={{ flexWrap: 'wrap' }}>
          <Pill text={cronSet ? 'cron_secret terisi' : 'cron_secret BELUM diisi'} tone={cronSet ? 'ok' : 'bad'} icon={cronSet ? 'checkmark-circle' : 'alert-circle'} />
          <Text style={font.tiny}>Isi lewat tombol kredensial Finpay (kolom “Cron secret”).</Text>
        </Row>
      </View>

      <View style={{ gap: 6 }}>
        <Text style={font.label}>URL webhook yang harus didaftarkan di dashboard provider</Text>
        {PROVIDERS.map((p) => (
          <Row key={p.value} gap={8} style={{ flexWrap: 'wrap', alignItems: 'center' }}>
            <Text style={[font.small, { width: 120 }]}>{p.label}</Text>
            <View style={[s.code, { flex: 1, minWidth: 260, paddingVertical: 8 }]}><Text selectable style={s.codeText}>{webhookUrl(p.value)}</Text></View>
            <Button size="sm" variant="ghost" title="Salin" icon="copy-outline" onPress={() => copy(webhookUrl(p.value))} />
          </Row>
        ))}
        <Text style={font.tiny}>Finpay: daftarkan URL di atas sebagai callback/notification URL untuk sandbox (devo) dan production (live) secara terpisah. Signature diverifikasi HMAC-SHA512 lalu status selalu dicek ulang ke provider sebelum ditandai dibayar. Basis: {SUPABASE_BASE}.</Text>
      </View>

      <AdminDialog visible={!!edit} onClose={close} title={`Kredensial ${providerLabel(edit?.provider)} · ${edit?.env === 'production' ? 'PRODUCTION' : 'Sandbox'}`}
        subtitle="Kolom kosong = tidak diubah. Butuh PIN panel; nilai tidak dicatat penuh di log." tone={edit?.env === 'production' ? colors.danger : adminTone.teal}>
        {SECRET_FIELDS.map((f) => (
          <Input key={f.key} label={f.label} placeholder={edit ? (secretShown(find(edit.provider, edit.env), f.key) ?? f.hint) : f.hint} value={form[f.key] ?? ''}
            onChangeText={(v) => setForm((x) => ({ ...x, [f.key]: v }))} secureTextEntry={f.secret} autoCapitalize="none" autoCorrect={false} />
        ))}
        {edit?.provider === 'finpay' ? (
          <View style={{ gap: 6 }}>
            <Input label="Cron secret (disimpan di extra.cron_secret)" placeholder={(find(edit.provider, edit.env)?.extra_keys ?? []).includes('cron_secret') ? 'terisi — kosongkan bila tidak diganti' : 'sama persis dengan env CRON_SECRET edge function'}
              value={form.cron_secret ?? ''} onChangeText={(v) => setForm((x) => ({ ...x, cron_secret: v }))} secureTextEntry autoCapitalize="none" autoCorrect={false} />
            <Text style={font.tiny}>Dipakai pg_cron → pay-reconcile (header x-cron-secret). Harus sama dengan secret CRON_SECRET di Edge Functions; tidak pernah ditulis ke log.</Text>
            {(form.cron_secret ?? '').trim() && otherExtra(edit.provider, edit.env).length ? (
              <Pressable onPress={() => setExtraAck((v) => !v)} style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
                <Ionicons name={extraAck ? 'checkbox' : 'square-outline'} size={18} color={extraAck ? colors.danger : adminTone.muted} />
                <Text style={[font.small, { flex: 1, color: colors.danger }]}>Server mengganti SELURUH objek extra. Kunci extra lain ({otherExtra(edit.provider, edit.env).join(', ')}) akan terhapus — saya mengerti.</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        <Row gap={8} style={{ justifyContent: 'flex-end' }}>
          <Button size="sm" variant="ghost" title="Batal" onPress={close} />
          <Button size="sm" title="Simpan kredensial" icon="lock-closed-outline" loading={busy} onPress={submit} />
        </Row>
      </AdminDialog>
    </Card>
  );
}

const s = StyleSheet.create({
  note: { borderWidth: 1, borderRadius: adminRadius.card, padding: adminSpace.md },
  chRow: { gap: 12, paddingVertical: 9, borderTopWidth: 1, borderTopColor: adminTone.border },
  chIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  code: { backgroundColor: adminTone.surfaceAlt, borderRadius: adminRadius.card, padding: adminSpace.md, borderWidth: 1, borderColor: adminTone.border },
  codeText: { fontSize: 12, lineHeight: 17, color: adminTone.ink, fontFamily: 'monospace' },
  step: { width: 24, height: 24, borderRadius: adminRadius.chip, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  stepText: { color: '#fff', fontWeight: '700', fontSize: 12, lineHeight: 16 },
  secret: { flexGrow: 1, flexBasis: 260, minWidth: 240, gap: 6, padding: adminSpace.md, borderRadius: adminRadius.card, borderWidth: 1, borderColor: adminTone.border, backgroundColor: adminTone.surfaceAlt },
});
