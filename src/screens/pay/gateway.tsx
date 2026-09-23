// Payment gateway — Midtrans Snap (GoPay, ShopeePay, QRIS/OVO/DANA, VA bank):
//  • top up AntarPay (alur lama), dan
//  • bayar SATU pesanan (purpose='order', migrasi 0100): create_order dengan saluran gateway membuat pesanan
//    berstatus awaiting_payment; layar ini memanggil midtrans-create {purpose:'order', order_id} → Snap, menampilkan
//    rincian & hitung mundur dari order_payment_prepare.expires_at, lalu memantau orders.payment_status sampai lunas
//    dan meneruskan ke layar pelacakan.
// Tanpa MIDTRANS_SERVER_KEY → mode simulasi (tombol "Bayar (simulasi)") agar alur tetap bisa diuji.
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Platform, Linking } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { FadeInDown, LinearTransition, ZoomIn } from 'react-native-reanimated';
import { Screen, Card, Row, Button, Chip, Badge, Input, toast } from '@/components/ui';
import { Entrance, PressableScale, Radar, AnimatedNumber } from '@/components/motion';
import { BrandGradient } from '@/components/glass';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/store/auth';
import { useAntarPay, ANTARPAY_OFF_TEXT } from '@/hooks/useAppSettings';
import { AntarPayOffBanner } from '@/components/AntarPayNotice';
import { useT } from '@/lib/i18n';
import { colors, font, radius, glass, shadow, motion } from '@/lib/theme';
import { rupiah, promoFunderLabel } from '@/lib/format';
import { PriceSummary } from '@/components/BookingSheet';
import type { Payment, GatewayPublicConfig, Order, OrderPaymentQuote } from '@/lib/types';
import { rpc } from '@/lib/supabase';

const METHODS = [
  { key: 'gopay', label: 'GoPay', icon: 'wallet', color: '#00AA13' },
  { key: 'ovo', label: 'OVO', icon: 'wallet', color: '#4C2A86' },
  { key: 'dana', label: 'DANA', icon: 'wallet', color: '#118EEA' },
  { key: 'shopeepay', label: 'ShopeePay', icon: 'wallet', color: '#EE4D2D' },
  { key: 'qris', label: 'QRIS', icon: 'qr-code', color: '#0B1F2A' },
  { key: 'bank_transfer', label: 'VA Bank', icon: 'business', color: colors.info },
  { key: 'card', label: 'Kartu kredit', icon: 'card', color: '#7B61FF' },
];
const PRESETS = [20000, 50000, 100000, 200000, 500000];
type CreateResp = { payment: Payment; simulated: boolean; snap_token?: string; redirect_url?: string; client_key?: string | null; is_production?: boolean; error?: string; message?: string; order?: OrderPaymentQuote; reused?: boolean };
type Params = { amount?: string; purpose?: string; order_id?: string; next?: string; method?: string; reason?: string };

export default function Gateway() {
  const params = useLocalSearchParams<Params>();
  if (params.purpose === 'order' && params.order_id) return <OrderPayment orderId={params.order_id} initialMethod={params.method} />;
  return <TopupGateway params={params} />;
}

function TopupGateway({ params }: { params: Params }) {
  const router = useRouter();
  const t = useT();
  const refreshWallet = useAuth((s) => s.refreshWallet);
  const wallet = useAuth((s) => s.wallet);
  const [amount, setAmount] = useState(params.amount ?? '50000');
  const [method, setMethod] = useState(params.method && METHODS.some((m) => m.key === params.method) ? params.method : 'gopay');
  const [busy, setBusy] = useState(false);
  const [resp, setResp] = useState<CreateResp | null>(null);
  const [status, setStatus] = useState<Payment['status'] | null>(null);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);
  const n = Number(String(amount).replace(/\D/g, '')) || 0;
  const [cfg, setCfg] = useState<GatewayPublicConfig | null>(null);
  // Konfigurasi gagal dimuat → tetap tampilkan saluran bawaan (server tetap menolak saluran yang dimatikan); galat dicatat.
  useEffect(() => { rpc<GatewayPublicConfig>('gateway_public_config').then(setCfg, (e: Error) => { console.warn('gateway_public_config:', e.message); setCfg(null); }); }, []);
  const enabled = cfg?.methods?.length ? METHODS.filter((x) => cfg.methods.includes(x.key)) : METHODS.filter((x) => x.key !== 'card');
  useEffect(() => { if (enabled.length && !enabled.some((x) => x.key === method)) setMethod(enabled[0].key); }, [cfg]); // eslint-disable-line react-hooks/exhaustive-deps
  const minTopup = cfg?.topup_min ?? 10000;
  // 0088: sakelar AntarPay — gabungan pengaturan publik (realtime) & gateway_public_config (dibaca layar ini).
  const { enabled: settingsOn } = useAntarPay();
  const antarpayOn = settingsOn && cfg?.antarpay_enabled !== false;

  useEffect(() => () => { if (poll.current) clearInterval(poll.current); }, []);

  const watch = (paymentId: string) => {
    if (poll.current) clearInterval(poll.current);
    poll.current = setInterval(async () => {
      const { data } = await supabase.from('payments').select('status').eq('id', paymentId).maybeSingle();
      const st = (data as { status: Payment['status'] } | null)?.status;
      if (st && st !== 'pending') { setStatus(st); if (poll.current) clearInterval(poll.current); if (st === 'settlement') { await refreshWallet(); toast.success(t('payment_success')); } }
    }, 3000);
  };

  const create = async () => {
    if (!antarpayOn) return toast.error(ANTARPAY_OFF_TEXT);
    if (n < minTopup) return toast.error(`Minimal ${rupiah(minTopup)}`);
    setBusy(true);
    const { data, error } = await supabase.functions.invoke<CreateResp>('midtrans-create', { body: { amount: n, method, purpose: 'topup' } });
    setBusy(false);
    if (error || !data || data.error) { toast.error(data?.error ?? error?.message ?? 'Gagal membuat transaksi'); return; }
    setResp(data); setStatus('pending'); watch(data.payment.id);
    if (!data.simulated && data.redirect_url) openSnap(data);
  };
  /** Web: Snap.js popup (tanpa pindah tab) bila client key tersedia; selain itu buka redirect_url. */
  const openSnap = (data: CreateResp) => {
    if (Platform.OS === 'web' && data.snap_token && data.client_key && typeof document !== 'undefined') {
      const w = window as unknown as { snap?: { pay: (t: string, o: Record<string, unknown>) => void } };
      const run = () => w.snap?.pay(data.snap_token!, { onSuccess: () => refreshWallet(), onPending: () => {}, onError: () => toast.error('Pembayaran gagal'), onClose: () => {} });
      if (w.snap) return run();
      const sc = document.createElement('script');
      sc.src = data.is_production ? 'https://app.midtrans.com/snap/snap.js' : 'https://app.sandbox.midtrans.com/snap/snap.js';
      sc.setAttribute('data-client-key', data.client_key);
      sc.onload = run; sc.onerror = () => window.open(data.redirect_url, '_blank');
      document.body.appendChild(sc);
      return;
    }
    if (Platform.OS === 'web') window.open(data.redirect_url, '_blank'); else Linking.openURL(data.redirect_url!);
  };
  const simulate = async (ok: boolean) => {
    if (!resp) return;
    setBusy(true);
    const { data, error } = await supabase.functions.invoke<{ ok: boolean; error?: string }>('midtrans-webhook', { body: { simulate: resp.payment.external_id, status: ok ? 'settlement' : 'cancel' } });
    setBusy(false);
    if (error || data?.error) { toast.error(data?.error ?? error?.message ?? 'Simulasi gagal'); return; }
    setStatus(ok ? 'settlement' : 'cancel');
    if (ok) { await refreshWallet(); toast.success(t('payment_success')); }
  };
  const finish = () => { if (params.reason === 'order') toast.success('Saldo sudah cukup — tekan Pesan sekali lagi untuk melanjutkan'); if (params.next) router.replace(params.next as never); else router.back(); };
  const m = METHODS.find((x) => x.key === method) ?? METHODS[0];

  return (
    <Screen title={t('ewallet')} back maxWidth={560}>
      {!resp ? (
        <View style={{ gap: 16 }}>
          {!antarpayOn && <Entrance index={0}><AntarPayOffBanner /></Entrance>}
          <Entrance index={0}>
            <BrandGradient colors={[colors.primary, colors.primaryDark]} style={[s.hero, shadow.glow(colors.primary)]}>
              <Text style={{ color: 'rgba(255,255,255,0.85)', fontWeight: '600', fontSize: 12 }}>{t('balance')}</Text>
              <AnimatedNumber value={wallet?.balance ?? 0} format={rupiah} style={{ color: '#fff', fontSize: 30, fontWeight: '700' }} />
              <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12, marginTop: 4 }}>{params.reason === 'order' ? 'Lengkapi kekurangan saldo untuk pesanan ini — setelah berhasil, kembali dan tekan Pesan.' : 'Top up instan lewat e-wallet, QRIS, atau virtual account bank.'}</Text>
            </BrandGradient>
          </Entrance>
          <Entrance index={1}><Card>
            <Text style={font.label}>Nominal</Text>
            <Input value={String(amount)} onChangeText={(v) => setAmount(v.replace(/\D/g, ''))} keyboardType="number-pad" icon="cash-outline" containerStyle={{ marginTop: 8 }} />
            <Row gap={8} style={{ flexWrap: 'wrap', marginTop: 10 }}>{PRESETS.map((p) => <Chip key={p} label={rupiah(p)} active={n === p} onPress={() => setAmount(String(p))} />)}</Row>
          </Card></Entrance>
          <Entrance index={2}><Card>
            <Text style={font.label}>{t('pay_with')}</Text>
            <View style={s.grid}>
              {enabled.map((x) => (
                <View key={x.key} style={{ width: '31%', flexGrow: 1 }}>
                  <PressableScale onPress={() => setMethod(x.key)} scaleTo={0.95} style={[s.method, method === x.key && { borderColor: x.color, backgroundColor: x.color + '14', ...shadow.glow(x.color) }]}>
                    <View style={[s.mIcon, { backgroundColor: x.color }]}><Ionicons name={x.icon as never} size={20} color="#fff" /></View>
                    <Text style={{ fontWeight: '700', color: colors.text, fontSize: 14 }} numberOfLines={1}>{x.label}</Text>
                    {method === x.key && <Ionicons name="checkmark-circle" size={16} color={x.color} style={{ position: 'absolute', top: 6, right: 6 }} />}
                  </PressableScale>
                </View>
              ))}
            </View>
            <Text style={[font.tiny, { marginTop: 8 }]}>Diproses oleh Midtrans (PCI-DSS). AntarKita tidak menyimpan data kartu/akun e-wallet Anda.</Text>
          </Card></Entrance>
          <Entrance index={3}><Button title={antarpayOn ? `${t('pay_now')} · ${rupiah(n)} via ${m?.label ?? ''}` : 'AntarPay sementara nonaktif'} size="lg" loading={busy} disabled={!antarpayOn || n < minTopup} onPress={create} /></Entrance>
        </View>
      ) : (
        <Animated.View entering={ZoomIn.duration(motion.base)} layout={LinearTransition.springify().stiffness(280).damping(20)} style={{ gap: 16 }}>
          <Card><View style={{ alignItems: 'center', gap: 10 }}>
            {status === 'settlement' ? <View style={[s.big, { backgroundColor: colors.success }]}><Ionicons name="checkmark" size={44} color="#fff" /></View>
              : status === 'pending' ? <Radar color={m.color} size={130}><Ionicons name={m.icon as never} size={32} color={m.color} /></Radar>
              : <View style={[s.big, { backgroundColor: colors.danger }]}><Ionicons name="close" size={44} color="#fff" /></View>}
            <Text style={font.h2}>{status === 'settlement' ? t('payment_success') : status === 'pending' ? t('payment_pending') : 'Pembayaran dibatalkan'}</Text>
            <Text style={{ fontSize: 24, fontWeight: '700', color: colors.text }}>{rupiah(resp.payment.amount)}</Text>
            <Row gap={8}><Badge text={m.label} color={m.color} /><Badge text={resp.simulated ? t('simulation') : resp.is_production ? 'Midtrans' : 'Midtrans Sandbox'} color={resp.simulated ? colors.warning : colors.info} /></Row>
            <Text style={[font.tiny, { textAlign: 'center' }]}>ID: {resp.payment.external_id}</Text>
            {status === 'pending' && !resp.simulated && (
              <Animated.View entering={FadeInDown.duration(motion.base)} style={{ gap: 8, width: '100%' }}>
                <Text style={[font.small, { textAlign: 'center' }]}>Halaman pembayaran Midtrans dibuka di tab/aplikasi terpisah. Selesaikan pembayaran, lalu kembali — status diperbarui otomatis.</Text>
                <Button title="Buka halaman pembayaran" variant="secondary" icon="open-outline" onPress={() => openSnap(resp)} />
              </Animated.View>
            )}
            {status === 'pending' && resp.simulated && (
              <Animated.View entering={FadeInDown.duration(motion.base)} style={{ gap: 8, width: '100%' }}>
                <View style={s.simBox}><Ionicons name="flask-outline" size={16} color={colors.warning} /><Text style={[font.tiny, { flex: 1 }]}>{resp.message}</Text></View>
                <Button title="Bayar (simulasi berhasil)" color={colors.success} loading={busy} onPress={() => simulate(true)} />
                <Button title="Batalkan pembayaran" variant="ghost" color={colors.danger} onPress={() => simulate(false)} />
              </Animated.View>
            )}
            {status !== 'pending' && <Button title={status === 'settlement' ? t('done') : 'Coba lagi'} size="lg" style={{ alignSelf: 'stretch' }} onPress={() => (status === 'settlement' ? finish() : (setResp(null), setStatus(null)))} />}
          </View></Card>
          {!!resp.simulated && <Text style={[font.tiny, { textAlign: 'center' }]}>Gateway asli aktif setelah admin mengisi Server Key Midtrans di Panel Admin → Payment Gateway (lihat docs/PAYMENT-GATEWAY.md).</Text>}
        </Animated.View>
      )}
    </Screen>
  );
}

/* ─────────────── Bayar satu pesanan (purpose='order', migrasi 0100) ─────────────── */

const ORDER_COLS = 'id,code,service,status,payment_status,total,fare_delivery,items_subtotal,platform_fee,service_fee,intercity_fare,discount,promo_code,promo_funded_by,pg_channel,pg_fee,pg_fee_ppn,pg_fee_borne_by,paid_via,created_at,cancel_reason';
type PayOrder = Pick<Order, 'id' | 'code' | 'service' | 'status' | 'payment_status' | 'total' | 'fare_delivery' | 'items_subtotal' | 'platform_fee' | 'service_fee' | 'intercity_fare' | 'discount' | 'promo_code' | 'promo_funded_by' | 'pg_channel' | 'pg_fee' | 'pg_fee_ppn' | 'pg_fee_borne_by' | 'paid_via' | 'created_at' | 'cancel_reason'>;
const FAILED: Payment['status'][] = ['cancel', 'deny', 'expire', 'failure'];
const mmss = (ms: number) => { const t = Math.max(0, Math.floor(ms / 1000)); return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };

/** Web: Snap.js popup bila client key tersedia; selain itu buka redirect_url (tab/aplikasi terpisah). */
function openSnapFor(data: CreateResp, onDone: () => void) {
  if (Platform.OS === 'web' && data.snap_token && data.client_key && typeof document !== 'undefined') {
    const w = window as unknown as { snap?: { pay: (t: string, o: Record<string, unknown>) => void } };
    const run = () => w.snap?.pay(data.snap_token!, { onSuccess: onDone, onPending: onDone, onError: () => toast.error('Pembayaran gagal — coba lagi atau ganti metode'), onClose: onDone });
    if (w.snap) return run();
    const sc = document.createElement('script');
    sc.src = data.is_production ? 'https://app.midtrans.com/snap/snap.js' : 'https://app.sandbox.midtrans.com/snap/snap.js';
    sc.setAttribute('data-client-key', data.client_key);
    sc.onload = run; sc.onerror = () => window.open(data.redirect_url, '_blank');
    document.body.appendChild(sc);
    return;
  }
  if (!data.redirect_url) return;
  if (Platform.OS === 'web') window.open(data.redirect_url, '_blank'); else Linking.openURL(data.redirect_url);
}

function OrderPayment({ orderId, initialMethod }: { orderId: string; initialMethod?: string }) {
  const router = useRouter();
  const t = useT();
  const [order, setOrder] = useState<PayOrder | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [cfg, setCfg] = useState<GatewayPublicConfig | null>(null);
  const [method, setMethod] = useState<string | null>(initialMethod && METHODS.some((m) => m.key === initialMethod) ? initialMethod : null);
  const [resp, setResp] = useState<CreateResp | null>(null);
  const [createErr, setCreateErr] = useState<string | null>(null);
  const [payStatus, setPayStatus] = useState<Payment['status'] | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const done = useRef(false);
  const started = useRef(false);

  const loadOrder = async () => {
    const { data, error } = await supabase.from('orders').select(ORDER_COLS).eq('id', orderId).maybeSingle();
    if (error) { setLoadErr(error.message); return null; }
    if (!data) { setLoadErr('Pesanan tidak ditemukan atau bukan milik Anda.'); return null; }
    const o = data as unknown as PayOrder;
    setOrder(o); setLoadErr(null);
    if (o.payment_status === 'paid' && !done.current) {
      done.current = true;
      toast.success(`${t('payment_success')} — ${o.status === 'scheduled' ? 'booking terjadwal tersimpan' : 'mencari driver…'}`);
      setTimeout(() => router.replace(`/order/${o.id}` as never), 900);
    }
    return o;
  };

  /** Buat/ambil ulang transaksi Snap untuk pesanan ini (order_payment_prepare di edge function menghitung ulang biaya PG). */
  const create = async (ch: string | null) => {
    setBusy(true); setCreateErr(null);
    const { data, error } = await supabase.functions.invoke<CreateResp>('midtrans-create', { body: { purpose: 'order', order_id: orderId, method: ch } });
    setBusy(false);
    if (error || !data || data.error) { setCreateErr(data?.error ?? error?.message ?? 'Transaksi pembayaran gagal dibuat'); await loadOrder(); return; }
    setResp(data); setPayStatus(data.payment.status ?? 'pending');
    if (data.order?.channel) setMethod(data.order.channel);
    await loadOrder();   // total/biaya PG bisa berubah bila saluran diganti
    if (!data.simulated && data.redirect_url && !data.reused) openSnapFor(data, () => { loadOrder(); });
  };

  useEffect(() => {
    rpc<GatewayPublicConfig>('gateway_public_config').then(setCfg, (e: Error) => { console.warn('gateway_public_config:', e.message); setCfg(null); });
    (async () => {
      const o = await loadOrder();
      if (!o || started.current) return;
      started.current = true;
      if (o.status === 'awaiting_payment' && o.payment_status === 'unpaid') await create(method ?? o.pg_channel ?? o.paid_via ?? null);
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Pantau pelunasan: status pesanan (webhook → payment_settle) + status transaksi Snap. Realtime tidak wajib — polling 3 dtk.
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(async () => {
      if (done.current) return;
      await loadOrder();
      if (resp?.payment.id) {
        const { data, error } = await supabase.from('payments').select('status').eq('id', resp.payment.id).maybeSingle();
        if (!error && data) setPayStatus((data as { status: Payment['status'] }).status);
      }
    }, 3000);
    return () => { clearInterval(tick); clearInterval(poll); };
  }, [resp?.payment.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const simulate = async (ok: boolean) => {
    if (!resp) return;
    setBusy(true);
    const { data, error } = await supabase.functions.invoke<{ ok: boolean; error?: string }>('midtrans-webhook', { body: { simulate: resp.payment.external_id, status: ok ? 'settlement' : 'cancel' } });
    setBusy(false);
    if (error || data?.error) { toast.error(data?.error ?? error?.message ?? 'Simulasi gagal'); return; }
    setPayStatus(ok ? 'settlement' : 'cancel');
    await loadOrder();
  };

  const q = resp?.order ?? null;
  const expiresAt = q?.expires_at ? new Date(q.expires_at).getTime() : null;
  const left = expiresAt != null ? expiresAt - now : null;
  const paid = order?.payment_status === 'paid';
  const cancelled = order?.status === 'cancelled';
  const expired = !paid && (cancelled || (left != null && left <= 0));
  const failed = !paid && !expired && !!payStatus && FAILED.includes(payStatus);
  const enabled = cfg?.methods?.length ? METHODS.filter((x) => cfg.methods.includes(x.key)) : METHODS.filter((x) => x.key !== 'card');
  const m = METHODS.find((x) => x.key === (method ?? q?.channel)) ?? METHODS[0];
  const payFee = q ? q.customer_payment_fee : order?.pg_fee_borne_by === 'customer' ? (order.pg_fee ?? 0) + (order.pg_fee_ppn ?? 0) : 0;
  const shopping = order?.service === 'shop' || order?.service === 'market';
  const funder = order && order.discount > 0 ? order.promo_funded_by ?? null : null;

  return (
    <Screen title="Bayar pesanan" subtitle={order ? `${order.code} · ${m.label}` : undefined} back maxWidth={560}>
      <View style={{ gap: 16 }}>
        {loadErr ? <Card><Text style={[font.small, { color: colors.danger }]}>{loadErr}</Text><Button title="Muat ulang" variant="ghost" icon="refresh" onPress={() => { loadOrder(); }} /></Card> : null}

        <Animated.View entering={ZoomIn.duration(motion.base)} layout={LinearTransition.springify().stiffness(280).damping(20)}>
          <Card><View style={{ alignItems: 'center', gap: 10 }}>
            {paid ? <View style={[s.big, { backgroundColor: colors.success }]}><Ionicons name="checkmark" size={44} color="#fff" /></View>
              : expired || failed ? <View style={[s.big, { backgroundColor: colors.danger }]}><Ionicons name={expired ? 'time-outline' : 'close'} size={44} color="#fff" /></View>
              : <Radar color={m.color} size={130}><Ionicons name={m.icon as never} size={32} color={m.color} /></Radar>}
            <Text style={font.h2}>{paid ? t('payment_success') : expired ? 'Batas waktu pembayaran habis' : failed ? 'Pembayaran tidak selesai' : t('payment_pending')}</Text>
            <Text style={{ fontSize: 24, fontWeight: '700', color: colors.text }}>{rupiah(q?.gross ?? order?.total ?? 0)}</Text>
            {!paid && !expired && left != null && (
              <Row gap={6}><Ionicons name="time-outline" size={16} color={left < 120000 ? colors.danger : colors.warning} /><Text style={{ fontWeight: '700', color: left < 120000 ? colors.danger : colors.text, fontVariant: ['tabular-nums'] }}>Bayar dalam {mmss(left)}</Text></Row>
            )}
            <Row gap={8} style={{ flexWrap: 'wrap', justifyContent: 'center' }}>
              <Badge text={q?.channel_label ?? m.label} color={m.color} />
              {resp ? <Badge text={resp.simulated ? t('simulation') : resp.is_production ? 'Midtrans' : 'Midtrans Sandbox'} color={resp.simulated ? colors.warning : colors.info} /> : null}
            </Row>
            {resp?.payment.external_id ? <Text style={[font.tiny, { textAlign: 'center' }]}>ID: {resp.payment.external_id}</Text> : null}
            {paid && <Text style={[font.small, { textAlign: 'center' }]}>Pesanan dibayar. Membuka layar pelacakan…</Text>}
            {expired && <Text style={[font.small, { textAlign: 'center' }]}>{cancelled ? order?.cancel_reason ?? 'Pesanan dibatalkan.' : 'Pesanan akan dibatalkan otomatis.'} Bila dana terlanjur terpotong, otomatis dikembalikan ke saldo AntarPay.</Text>}
            {createErr && !paid && <Text style={[font.small, { textAlign: 'center', color: colors.danger }]}>{createErr}</Text>}

            {!paid && !expired && resp && !resp.simulated && (
              <Animated.View entering={FadeInDown.duration(motion.base)} style={{ gap: 8, width: '100%' }}>
                <Text style={[font.small, { textAlign: 'center' }]}>Halaman pembayaran Midtrans dibuka di tab/aplikasi terpisah. Selesaikan pembayaran, lalu kembali — status diperbarui otomatis.</Text>
                <Button title="Buka halaman pembayaran" variant="secondary" icon="open-outline" onPress={() => openSnapFor(resp, () => { loadOrder(); })} />
              </Animated.View>
            )}
            {!paid && !expired && resp?.simulated && payStatus === 'pending' && (
              <Animated.View entering={FadeInDown.duration(motion.base)} style={{ gap: 8, width: '100%' }}>
                <View style={s.simBox}><Ionicons name="flask-outline" size={16} color={colors.warning} /><Text style={[font.tiny, { flex: 1 }]}>{resp.message ?? 'Mode simulasi: gateway asli belum dikonfigurasi.'}</Text></View>
                <Button title="Bayar (simulasi berhasil)" color={colors.success} loading={busy} onPress={() => simulate(true)} />
                <Button title="Batalkan pembayaran" variant="ghost" color={colors.danger} onPress={() => simulate(false)} />
              </Animated.View>
            )}
            {!paid && !expired && (failed || (!resp && !busy)) && (
              <Button title={failed ? 'Coba lagi' : 'Buat pembayaran'} size="lg" style={{ alignSelf: 'stretch' }} loading={busy} onPress={() => create(method)} />
            )}
            {(expired || paid) && <Button title={paid ? 'Lihat pesanan' : 'Kembali ke beranda'} size="lg" style={{ alignSelf: 'stretch' }} onPress={() => router.replace((paid ? `/order/${orderId}` : '/') as never)} />}
          </View></Card>
        </Animated.View>

        {order && (
          <Entrance index={1}><Card>
            <Text style={[font.label, { marginBottom: 10 }]}>Rincian pembayaran</Text>
            <PriceSummary total={q?.gross ?? order.total} rows={[
              { label: 'Ongkir', value: order.fare_delivery, keep: true },
              { label: 'Ongkir antar kota', value: order.intercity_fare ?? 0 },
              { label: order.service === 'food' ? 'Nilai barang (makanan)' : 'Nilai barang', value: order.items_subtotal },
              { label: 'Biaya platform', value: order.platform_fee, keep: true },
              { label: 'Biaya layanan', value: shopping ? order.service_fee ?? 0 : 0 },
              { label: `Biaya pembayaran ${q?.channel_label ?? m.label}`, value: payFee, hint: payFee ? 'Biaya Midtrans untuk saluran ini, ditanggung pelanggan sesuai kebijakan layanan' : null },
              { label: `Promo${order.promo_code ? ` (${order.promo_code})` : ''}`, value: order.discount, minus: true, hint: funder ? promoFunderLabel[funder] : null },
            ]} note={q && !payFee ? 'Biaya pembayaran untuk saluran ini ditanggung AntarKita.' : null} />
          </Card></Entrance>
        )}

        {!paid && !expired && enabled.length > 1 && (
          <Entrance index={2}><Card>
            <Text style={font.label}>Ganti metode pembayaran</Text>
            <View style={s.grid}>
              {enabled.map((x) => {
                const on = x.key === (method ?? q?.channel);
                return (
                  <View key={x.key} style={{ width: '31%', flexGrow: 1 }}>
                    <PressableScale onPress={() => { if (!on && !busy) { setMethod(x.key); create(x.key); } }} scaleTo={0.95} style={[s.method, on && { borderColor: x.color, backgroundColor: x.color + '14', ...shadow.glow(x.color) }]}>
                      <View style={[s.mIcon, { backgroundColor: x.color }]}><Ionicons name={x.icon as never} size={20} color="#fff" /></View>
                      <Text style={{ fontWeight: '700', color: colors.text, fontSize: 14 }} numberOfLines={1}>{x.label}</Text>
                      {on && <Ionicons name="checkmark-circle" size={16} color={x.color} style={{ position: 'absolute', top: 6, right: 6 }} />}
                    </PressableScale>
                  </View>
                );
              })}
            </View>
            <Text style={[font.tiny, { marginTop: 8 }]}>Mengganti metode membuat transaksi baru dan menghitung ulang biaya pembayaran. Diproses oleh Midtrans (PCI-DSS) — AntarKita tidak menyimpan data kartu/akun e-wallet Anda.</Text>
          </Card></Entrance>
        )}
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  hero: { borderRadius: radius.xl, padding: 18, overflow: 'hidden' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 10 },
  method: { width: '100%', alignItems: 'center', gap: 6, padding: 12, borderRadius: radius.lg, borderWidth: 1.5, borderColor: glass.border, backgroundColor: 'rgba(255,255,255,0.92)' },
  mIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  big: { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center' },
  simBox: { flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: 'rgba(245,158,11,0.12)', borderRadius: radius.md, padding: 10 },
});
