// Pembayaran lewat payment gateway v3 (KONTRAK-API-V3 §1–§3, §9) — provider aktif dari server (Midtrans/Finpay/…):
//  • bayar SATU pesanan (purpose='order'): create_order dengan kanal gateway membuat pesanan `awaiting_payment`;
//    layar ini menghitung rincian final (`order_payment_prepare`), membuat/mengambil ulang tagihan lewat edge
//    `pay-create` (idempoten per pesanan di server), lalu memantau `my_payment_status` (polling 5 dtk + realtime
//    `payments` + saat aplikasi kembali aktif) sampai PAID/FAILED/EXPIRED.
//  • top up AntarVoucher (alur lama, purpose='topup') lewat edge yang sama.
// Tampilan per kanal: QRIS → gambar QR bila provider memberi URL gambar, selain itu tombol ke halaman pembayaran
// (tidak ada pustaka QR di package.json); VA/gerai → kode bayar + salin; kartu/e-wallet → halaman pembayaran provider.
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Image, Platform } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Clipboard from 'expo-clipboard';
import Animated, { FadeInDown, LinearTransition, ZoomIn } from 'react-native-reanimated';
import { Screen, Card, Row, Button, Chip, Badge, Input, toast } from '@/components/ui';
import { Entrance, PressableScale, Radar, AnimatedNumber } from '@/components/motion';
import { BrandGradient } from '@/components/glass';
import { SupportRef } from '@/components/OrderDetails';
import { supabase, rpc } from '@/lib/supabase';
import { useAuth } from '@/store/auth';
import { useAntarVoucher, ANTARVOUCHER_OFF_TEXT } from '@/hooks/useAppSettings';
import { AntarVoucherOffBanner } from '@/components/AntarVoucherNotice';
import { useT } from '@/lib/i18n';
import { IS_CUSTOMER_APP } from '@/lib/app';
import { colors, font, radius, glass, shadow, motion } from '@/lib/theme';
import { rupiah, promoOwnerLabel, payStatusLabel, pctLabel } from '@/lib/format';
import { PAYMENT_CHANNELS, channelLabel } from '@/store/payprefs';
import { PriceSummary } from '@/components/BookingSheet';
import {
  useProviderPublic, providerLabel, channelFeeText, createPayment, prepareOrderPayment, usePaymentStatus, openCheckout,
  simulatePayment, isPaidLike, PaymentTimeoutError, type PriceRow,
} from '@/lib/payments';
import type { GatewayPublicConfig, Order, OrderPaymentPrepareV3, PayCreateResult, PayStatus, PayProvider, ProviderChannel } from '@/lib/types';

const PRESETS = [20000, 50000, 100000, 200000, 500000];
type Params = { amount?: string; purpose?: string; order_id?: string; next?: string; method?: string; reason?: string };

const metaOf = (key?: string | null) => {
  const m = PAYMENT_CHANNELS.find((c) => c.key === key);
  const icon = m?.icon ?? (key === 'card' ? 'card-outline' : key?.startsWith('retail_') ? 'storefront-outline' : key?.startsWith('paylater_') ? 'time-outline' : key === 'qris' ? 'qr-code-outline' : 'phone-portrait-outline');
  return { icon, color: m?.color ?? colors.info };
};
const mmss = (ms: number) => { const t = Math.max(0, Math.floor(ms / 1000)); return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };

export default function Gateway() {
  const params = useLocalSearchParams<Params>();
  if (params.purpose === 'order' && params.order_id) return <OrderPayment orderId={params.order_id} initialMethod={params.method} />;
  return <TopupGateway params={params} />;
}

/* ─────────────── Instruksi bayar per kanal ─────────────── */

type PayView = { provider: PayProvider | null; channel: string | null; checkout_url: string | null; qr_string: string | null; qr_image_url: string | null; payment_code: string | null; external_id: string | null; support_ref: string | null };

function PaymentInstructions({ v }: { v: PayView }) {
  const copy = async (text: string, what: string) => { try { await Clipboard.setStringAsync(text); toast.success(`${what} disalin`); } catch { toast.error('Gagal menyalin'); } };
  const name = providerLabel(v.provider);
  if (v.qr_string) {
    return (
      <View style={s.instr}>
        <Row gap={8}><Ionicons name="qr-code-outline" size={20} color={colors.text} /><Text style={font.h3}>Bayar dengan QRIS</Text></Row>
        {v.qr_image_url ? <Image source={{ uri: v.qr_image_url }} style={s.qr} resizeMode="contain" accessibilityLabel="Kode QRIS" />
          : <Text style={[font.small, { textAlign: 'center' }]}>Kode QR ditampilkan di halaman pembayaran {name}. Buka halaman itu, lalu pindai dengan aplikasi bank/e-wallet apa pun yang mendukung QRIS.</Text>}
        {v.checkout_url ? <Button title={v.qr_image_url ? 'Buka halaman pembayaran' : 'Tampilkan kode QR'} variant="secondary" icon="open-outline" onPress={() => openCheckout(v.checkout_url!)} /> : null}
        {!v.qr_image_url && !v.checkout_url ? <Text style={[font.tiny, { textAlign: 'center' }]}>Kode QR belum bisa ditampilkan di aplikasi ini. Hubungi CS dengan kode bantuan di bawah.</Text> : null}
      </View>
    );
  }
  if (v.payment_code) {
    const retail = !!v.channel && v.channel.startsWith('retail_');
    return (
      <View style={s.instr}>
        <Text style={font.label}>{retail ? `Kode bayar di kasir ${channelLabel(v.channel!)}` : `Nomor virtual account${v.channel ? ` · ${channelLabel(v.channel)}` : ''}`}</Text>
        <PressableScale onPress={() => copy(v.payment_code!, retail ? 'Kode bayar' : 'Nomor VA')} scaleTo={0.98} haptic={false} accessibilityRole="button" accessibilityLabel="Salin kode pembayaran" style={s.code}>
          <Text style={s.codeText} selectable>{v.payment_code}</Text>
          <Ionicons name="copy-outline" size={20} color={colors.primary} />
        </PressableScale>
        <Text style={[font.tiny, { textAlign: 'center' }]}>{retail ? 'Tunjukkan kode ini ke kasir dan bayar sesuai total.' : 'Transfer tepat sesuai total lewat m-banking/ATM ke nomor di atas.'} Status diperbarui otomatis.</Text>
        {v.checkout_url ? <Button title="Lihat cara bayar" variant="ghost" icon="open-outline" onPress={() => openCheckout(v.checkout_url!)} /> : null}
      </View>
    );
  }
  if (v.checkout_url) {
    return (
      <View style={s.instr}>
        <Text style={[font.small, { textAlign: 'center' }]}>Selesaikan pembayaran di halaman {name} (tab/aplikasi terpisah), lalu kembali ke sini — status diperbarui otomatis.</Text>
        <Button title="Buka halaman pembayaran" variant="secondary" icon="open-outline" onPress={() => openCheckout(v.checkout_url!)} />
      </View>
    );
  }
  return null;
}

function SimulationBox({ externalId, onDone }: { externalId: string | null; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  if (!externalId) return null;
  const run = async (ok: boolean) => {
    setBusy(true);
    try { await simulatePayment(externalId, ok); onDone(); }
    catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <View style={{ gap: 8, width: '100%' }}>
      <View style={s.simBox}><Ionicons name="flask-outline" size={16} color={colors.warning} /><Text style={[font.tiny, { flex: 1 }]}>Mode simulasi (sandbox): tidak ada uang yang berpindah.</Text></View>
      <Button title="Bayar (simulasi berhasil)" color={colors.success} loading={busy} onPress={() => run(true)} />
      <Button title="Simulasikan gagal" variant="ghost" color={colors.danger} onPress={() => run(false)} />
    </View>
  );
}

/** Kisi kanal dari payment_provider_public (hanya enabled) + label biaya "+Rp…" / "gratis". */
function ChannelGrid({ channels, value, onPick, base, disabled }: { channels: ProviderChannel[]; value: string | null; onPick: (k: string) => void; base: number; disabled?: boolean }) {
  return (
    <View style={s.grid}>
      {channels.map((x) => {
        const on = x.key === value; const m = metaOf(x.key); const fee = channelFeeText(x, base);
        return (
          <View key={x.key} style={{ width: '31%', flexGrow: 1 }}>
            <PressableScale onPress={() => { if (!disabled && !on) onPick(x.key); }} scaleTo={0.95} disabled={disabled} style={[s.method, on && { borderColor: m.color, backgroundColor: m.color + '14', ...shadow.glow(m.color) }, disabled && !on && { opacity: 0.5 }]}>
              <View style={[s.mIcon, { backgroundColor: m.color }]}><Ionicons name={m.icon as never} size={20} color="#fff" /></View>
              <Text style={{ fontWeight: '700', color: colors.text, fontSize: 14, textAlign: 'center' }} numberOfLines={2}>{x.label}</Text>
              <Text style={[font.tiny, { color: fee === 'gratis' ? colors.success : colors.textSecondary, fontWeight: '700' }]} numberOfLines={1}>{fee}</Text>
              {on && <Ionicons name="checkmark-circle" size={16} color={m.color} style={{ position: 'absolute', top: 6, right: 6 }} />}
            </PressableScale>
          </View>
        );
      })}
    </View>
  );
}

/* ─────────────── Top up AntarVoucher (purpose='topup') ─────────────── */

function TopupGateway({ params }: { params: Params }) {
  const router = useRouter();
  const t = useT();
  const refreshWallet = useAuth((st) => st.refreshWallet);
  const wallet = useAuth((st) => st.wallet);
  const { provider, channels, providerName, error: provErr, reload: reloadProvider } = useProviderPublic();
  const [amount, setAmount] = useState(params.amount ?? '50000');
  const [method, setMethod] = useState<string | null>(params.method ?? null);
  const [busy, setBusy] = useState(false);
  const [resp, setResp] = useState<PayCreateResult | null>(null);
  const [status, setStatus] = useState<PayStatus | null>(null);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);
  const n = Number(String(amount).replace(/\D/g, '')) || 0;
  const [cfg, setCfg] = useState<GatewayPublicConfig | null>(null);
  useEffect(() => { rpc<GatewayPublicConfig>('gateway_public_config').then(setCfg, (e: Error) => { console.warn('gateway_public_config:', e.message); setCfg(null); }); }, []);
  useEffect(() => { if (channels.length && !channels.some((x) => x.key === method)) setMethod(channels[0].key); }, [provider]); // eslint-disable-line react-hooks/exhaustive-deps
  const minTopup = cfg?.topup_min ?? 10000;
  const { enabled: settingsOn } = useAntarVoucher();
  const antarpayOn = settingsOn && cfg?.antarpay_enabled !== false;

  useEffect(() => () => { if (poll.current) clearInterval(poll.current); }, []);
  const check = async (paymentId: string) => {
    const { data } = await supabase.from('payments').select('*').eq('id', paymentId).maybeSingle();
    const row = data as { pay_status?: PayStatus | null; status?: string } | null;
    const st: PayStatus | null = row?.pay_status ?? (row?.status === 'settlement' ? 'PAID' : row?.status === 'expire' ? 'EXPIRED' : row?.status && row.status !== 'pending' ? 'FAILED' : row ? 'PENDING' : null);
    if (st && st !== 'PENDING') {
      setStatus(st); if (poll.current) clearInterval(poll.current);
      if (st === 'PAID') { await refreshWallet(); toast.success(t('payment_success')); }
    }
  };
  const watch = (paymentId: string) => { if (poll.current) clearInterval(poll.current); poll.current = setInterval(() => check(paymentId), 5000); };

  const create = async () => {
    if (!antarpayOn) return toast.error(ANTARVOUCHER_OFF_TEXT);
    if (n < minTopup) return toast.error(`Minimal ${rupiah(minTopup)}`);
    if (!method) return toast.error('Pilih metode pembayaran');
    setBusy(true);
    try {
      const r = await createPayment({ purpose: 'topup', amount: n, channel: method });
      setResp(r); setStatus('PENDING'); watch(r.payment_id);
      if (r.checkout_url && !r.qr_string && !r.payment_code && !r.reused) openCheckout(r.checkout_url);
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };
  const finish = () => { if (params.reason === 'order') toast.success('Saldo sudah cukup — tekan Pesan sekali lagi untuk melanjutkan'); if (params.next) router.replace(params.next as never); else router.back(); };
  const m = metaOf(method);
  const chosen = channels.find((c) => c.key === method) ?? null;

  return (
    <Screen title={t('ewallet')} back maxWidth={560}>
      {!resp ? (
        <View style={{ gap: 16 }}>
          {!antarpayOn && <Entrance index={0}><AntarVoucherOffBanner /></Entrance>}
          <Entrance index={0}>
            <BrandGradient colors={[colors.primary, colors.primaryDark]} style={[s.hero, shadow.glow(colors.primary)]}>
              <Text style={{ color: 'rgba(255,255,255,0.85)', fontWeight: '600', fontSize: 12 }}>{t('balance')}</Text>
              <AnimatedNumber value={wallet?.balance ?? 0} format={rupiah} style={{ color: '#fff', fontSize: 30, fontWeight: '700' }} />
              <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12, marginTop: 4 }}>{params.reason === 'order' ? 'Lengkapi kekurangan saldo untuk pesanan ini — setelah berhasil, kembali dan tekan Pesan.' : 'Top up lewat e-wallet, QRIS, atau virtual account bank.'}</Text>
            </BrandGradient>
          </Entrance>
          <Entrance index={1}><Card>
            <Text style={font.label}>Nominal</Text>
            <Input value={String(amount)} onChangeText={(v) => setAmount(v.replace(/\D/g, ''))} keyboardType="number-pad" icon="cash-outline" containerStyle={{ marginTop: 8 }} />
            <Row gap={8} style={{ flexWrap: 'wrap', marginTop: 10 }}>{PRESETS.map((p) => <Chip key={p} label={rupiah(p)} active={n === p} onPress={() => setAmount(String(p))} />)}</Row>
          </Card></Entrance>
          <Entrance index={2}><Card>
            <Text style={font.label}>{t('pay_with')}</Text>
            {provErr ? (
              <View style={{ gap: 8, marginTop: 8 }}><Text style={[font.small, { color: colors.danger }]}>Metode pembayaran belum termuat: {provErr}</Text><Button title="Muat ulang" variant="ghost" icon="refresh" onPress={reloadProvider} /></View>
            ) : channels.length === 0 ? (
              <Text style={[font.small, { marginTop: 8 }]}>{provider ? 'Belum ada metode pembayaran yang dibuka admin.' : 'Memuat metode pembayaran…'}</Text>
            ) : <ChannelGrid channels={channels} value={method} onPick={setMethod} base={n} />}
            <Text style={[font.tiny, { marginTop: 8 }]}>Diproses oleh {providerName ?? 'payment gateway'}. AntarKita tidak menyimpan data kartu/akun e-wallet Anda.{chosen?.pass_to_customer ? ` Biaya metode ${chosen.label} dibebankan ke Anda (${chosen.fee_label ?? (chosen.fee_pct ? pctLabel(chosen.fee_pct) : rupiah(chosen.fee_fixed))}).` : ''}</Text>
          </Card></Entrance>
          <Entrance index={3}><Button title={antarpayOn ? `${t('pay_now')} · ${rupiah(n)}${chosen ? ` via ${chosen.label}` : ''}` : 'AntarVoucher sementara nonaktif'} size="lg" loading={busy} disabled={!antarpayOn || n < minTopup || !method} onPress={create} /></Entrance>
        </View>
      ) : (
        <Animated.View entering={ZoomIn.duration(motion.base)} layout={LinearTransition.springify().stiffness(280).damping(20)} style={{ gap: 16 }}>
          <Card><View style={{ alignItems: 'center', gap: 10 }}>
            {status === 'PAID' ? <View style={[s.big, { backgroundColor: colors.success }]}><Ionicons name="checkmark" size={44} color="#fff" /></View>
              : status === 'PENDING' ? <Radar color={m.color} size={130}><Ionicons name={m.icon as never} size={32} color={m.color} /></Radar>
              : <View style={[s.big, { backgroundColor: colors.danger }]}><Ionicons name="close" size={44} color="#fff" /></View>}
            <Text style={font.h2}>{status === 'PAID' ? t('payment_success') : status === 'PENDING' ? t('payment_pending') : payStatusLabel[status ?? ''] ?? 'Pembayaran tidak selesai'}</Text>
            <Text style={{ fontSize: 24, fontWeight: '700', color: colors.text }}>{rupiah(resp.amount ?? n)}</Text>
            <Row gap={8}><Badge text={chosen?.label ?? channelLabel(method ?? '')} color={m.color} /><Badge text={resp.provider === 'simulated' ? t('simulation') : providerLabel(resp.provider)} color={resp.provider === 'simulated' ? colors.warning : colors.info} /></Row>
            <SupportRef code={resp.support_ref} />
            {status === 'PENDING' && <PaymentInstructions v={{ provider: resp.provider, channel: method, checkout_url: resp.checkout_url ?? null, qr_string: resp.qr_string ?? null, qr_image_url: resp.qr_image_url ?? null, payment_code: resp.payment_code ?? null, external_id: resp.external_id, support_ref: resp.support_ref }} />}
            {status === 'PENDING' && resp.provider === 'simulated' && <SimulationBox externalId={resp.external_id} onDone={() => check(resp.payment_id)} />}
            {status === 'PENDING' && <Button title="Periksa status" variant="ghost" icon="refresh" onPress={() => check(resp.payment_id)} />}
            {status !== 'PENDING' && <Button title={status === 'PAID' ? t('done') : 'Coba lagi'} size="lg" style={{ alignSelf: 'stretch' }} onPress={() => (status === 'PAID' ? finish() : (setResp(null), setStatus(null)))} />}
          </View></Card>
        </Animated.View>
      )}
    </Screen>
  );
}

/* ─────────────── Bayar satu pesanan (purpose='order') ─────────────── */

const ORDER_COLS = 'id,code,service,status,payment_status,total,fare_delivery,items_subtotal,platform_fee,service_fee,intercity_fare,discount,promo_code,promo_funded_by,pg_channel,pg_fee,pg_fee_ppn,pg_fee_borne_by,paid_via,created_at,cancel_reason,tip,extras_total,driver_commission_pct_snap';
type PayOrder = Pick<Order, 'id' | 'code' | 'service' | 'status' | 'payment_status' | 'total' | 'fare_delivery' | 'items_subtotal' | 'platform_fee' | 'service_fee' | 'intercity_fare' | 'discount' | 'promo_code' | 'promo_funded_by' | 'pg_channel' | 'pg_fee' | 'pg_fee_ppn' | 'pg_fee_borne_by' | 'paid_via' | 'created_at' | 'cancel_reason' | 'tip' | 'extras_total' | 'driver_commission_pct_snap'>;
/** Toleransi setelah expires_at sebelum layar menganggap tagihan kedaluwarsa (server/webhook bisa sedikit terlambat). */
const EXPIRY_GRACE_MS = 15000;

function OrderPayment({ orderId, initialMethod }: { orderId: string; initialMethod?: string }) {
  const router = useRouter();
  const t = useT();
  const { provider, channels, providerName } = useProviderPublic();
  const [order, setOrder] = useState<PayOrder | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [quote, setQuote] = useState<OrderPaymentPrepareV3 | null>(null);
  const [intent, setIntent] = useState<PayCreateResult | null>(null);
  const [method, setMethod] = useState<string | null>(initialMethod || null);
  const [createErr, setCreateErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const { status, loaded: statusLoaded, failStreak, refresh } = usePaymentStatus(orderId, { intervalMs: 5000 });
  const done = useRef(false);
  const started = useRef(false);

  const loadOrder = async () => {
    const { data, error } = await supabase.from('orders').select(ORDER_COLS).eq('id', orderId).maybeSingle();
    if (error) { setLoadErr(error.message); return null; }
    if (!data) { setLoadErr('Pesanan tidak ditemukan atau bukan milik Anda.'); return null; }
    const o = data as unknown as PayOrder;
    setOrder(o); setLoadErr(null);
    return o;
  };

  /** Hitung ulang rincian untuk kanal `ch`, lalu buat/ambil ulang tagihan (server idempoten per pesanan). */
  const startPayment = async (ch: string | null) => {
    setBusy(true); setCreateErr(null); setNotice(null);
    const prevId = status?.payment_id ?? intent?.payment_id ?? null;
    const prevRef = status?.pay_status === 'PENDING' ? status.support_ref : null;
    try {
      const q = await prepareOrderPayment(orderId, ch);
      setQuote(q);
      const channel = q.channel ?? ch;
      if (channel) setMethod(channel);
      const r = await createPayment({ purpose: 'order', order_id: orderId, channel: channel ?? '' });
      setIntent(r);
      const same = !!r.reused || (!!prevId && r.payment_id === prevId) || (!!prevRef && r.support_ref === prevRef);
      if (same) setNotice(`Tagihan yang sama masih aktif${r.channel ? ` (${channelLabel(r.channel)})` : ''} — pembayaran ganda dicegah. Selesaikan tagihan ini.`);
      else if (r.channel && channel && r.channel !== channel) setNotice(`Server memakai tagihan aktif ${channelLabel(r.channel)}. Metode bisa diganti setelah tagihan ini selesai atau kedaluwarsa.`);
      await Promise.all([refresh(), loadOrder()]);
      // Native: buka halaman provider otomatis untuk kanal redirect (kartu/e-wallet). Web: tunggu ketukan (popup diblokir peramban).
      if (!same && r.checkout_url && !r.qr_string && !r.payment_code && !IS_WEB) openCheckout(r.checkout_url);
    } catch (e) {
      setCreateErr(e instanceof PaymentTimeoutError ? e.message : (e as Error).message);
      await Promise.all([refresh(), loadOrder()]);   // tagihan mungkin sudah terbuat walau balasan terputus
    } finally { setBusy(false); }
  };

  useEffect(() => { loadOrder(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const tick = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(tick); }, []);
  // Pesanan dimuat ulang tiap status pembayaran berubah (webhook → payment_settle → order `pending`/`scheduled`).
  useEffect(() => { if (status?.pay_status) loadOrder(); }, [status?.pay_status]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keputusan awal (sekali): tagihan PENDING yang masih berlaku → lanjutkan (TIDAK membuat tagihan baru); selain itu buat.
  useEffect(() => {
    if (started.current || !order || !statusLoaded) return;
    started.current = true;
    if (order.payment_status === 'paid' || isPaidLike(status?.pay_status)) return;
    if (order.status !== 'awaiting_payment') return;
    const live = status?.pay_status === 'PENDING' && (!status.expires_at || new Date(status.expires_at).getTime() > Date.now());
    if (live) {
      setNotice('Melanjutkan tagihan yang masih aktif — tidak ada tagihan baru yang dibuat.');
      if (status?.channel) setMethod(status.channel);
      prepareOrderPayment(orderId, status?.channel ?? null).then(setQuote, (e: Error) => console.warn('order_payment_prepare:', e.message));
      return;
    }
    startPayment(method ?? order.pg_channel ?? order.paid_via ?? null);
  }, [order, statusLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const ps = status?.pay_status ?? (intent ? 'PENDING' : null);
  const paid = order?.payment_status === 'paid' || isPaidLike(status?.pay_status);
  const navTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!paid || done.current || !order) return;
    done.current = true;
    toast.success(`${t('payment_success')} — ${order.status === 'scheduled' ? 'booking terjadwal tersimpan' : 'mencari driver…'}`);
    navTimer.current = setTimeout(() => router.replace(`/order/${orderId}` as never), 1500);
  }, [paid, order?.status]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (navTimer.current) clearTimeout(navTimer.current); }, []);

  const view: PayView = {
    provider: status?.provider ?? intent?.provider ?? quote?.provider ?? provider?.provider ?? null,
    channel: status?.channel ?? intent?.channel ?? quote?.channel ?? method,
    checkout_url: status?.checkout_url ?? intent?.checkout_url ?? null,
    qr_string: status?.qr_string ?? intent?.qr_string ?? null,
    qr_image_url: status?.qr_image_url ?? intent?.qr_image_url ?? null,
    payment_code: status?.payment_code ?? intent?.payment_code ?? null,
    external_id: status?.external_id ?? intent?.external_id ?? null,
    support_ref: status?.support_ref ?? intent?.support_ref ?? quote?.support_ref ?? null,
  };
  const expiresIso = status?.expires_at ?? intent?.expires_at ?? quote?.expires_at ?? null;
  const left = expiresIso ? new Date(expiresIso).getTime() - now : null;
  const cancelled = order?.status === 'cancelled';
  const overdue = !paid && ps === 'PENDING' && left != null && left <= 0;
  const expired = !paid && !cancelled && (ps === 'EXPIRED' || (overdue && left! <= -EXPIRY_GRACE_MS));
  const failed = !paid && !cancelled && ps === 'FAILED';
  const pendingLive = !paid && !cancelled && ps === 'PENDING' && !expired;
  const pgName = status?.provider_label ?? quote?.provider_label ?? (view.provider ? providerLabel(view.provider) : providerName);
  const m = metaOf(view.channel);
  const chLabel = channels.find((c) => c.key === view.channel)?.label ?? status?.channel_label ?? (view.channel ? channelLabel(view.channel) : '—');

  // Rincian (§0.4) — angka dari order_payment_prepare/pesanan, bukan dari klien.
  const payFee = quote ? Number(quote.pg_fee_customer ?? quote.customer_payment_fee ?? 0) : order?.pg_fee_borne_by === 'customer' ? (order.pg_fee ?? 0) + (order.pg_fee_ppn ?? 0) : 0;
  const shopping = order?.service === 'shop' || order?.service === 'market';
  const ride = order?.service === 'ride_motor' || order?.service === 'ride_car';
  const funder = order && order.discount > 0 ? order.promo_funded_by ?? null : null;
  const comm = order?.driver_commission_pct_snap;
  const rows: PriceRow[] = order ? [
    { label: order.service === 'food' ? 'Harga makanan' : 'Harga barang', value: order.items_subtotal },
    { label: ride ? 'Tarif perjalanan' : 'Ongkir', value: order.fare_delivery, keep: true, hint: comm == null ? null : Number(comm) === 0 ? '100 % untuk driver' : `Komisi platform ${pctLabel(comm)}` },
    { label: 'Ongkir antar kota', value: order.intercity_fare ?? 0 },
    { label: 'Jasa belanja', value: shopping ? order.service_fee ?? 0 : 0 },
    { label: 'Biaya platform AntarKita', value: order.platform_fee, keep: true },
    { label: `Biaya metode pembayaran (${pgName ?? 'payment gateway'})`, value: payFee, keep: true, hint: payFee ? `${chLabel} · dibebankan ke pelanggan` : `${chLabel} · ditanggung AntarKita` },
    { label: 'Biaya tambahan (parkir/tol/tunggu)', value: order.extras_total ?? 0 },
    { label: 'Tip driver', value: order.tip ?? 0 },
    { label: `Diskon promo${order.promo_code ? ` (${order.promo_code})` : ''}`, value: order.discount, minus: true, hint: funder ? promoOwnerLabel[funder] : null },
    { label: 'Pajak', value: Number(quote?.tax ?? 0) },   // baris muncul hanya bila > 0
  ] : [];
  const base = Math.max(0, (quote?.gross ?? order?.total ?? 0) - payFee);

  return (
    <Screen title="Bayar pesanan" subtitle={order ? `${order.code} · ${chLabel}` : undefined} back maxWidth={560}>
      <View style={{ gap: 16 }}>
        {loadErr ? <Card><Text style={[font.small, { color: colors.danger }]}>{loadErr}</Text><Button title="Muat ulang" variant="ghost" icon="refresh" onPress={() => { loadOrder(); }} /></Card> : null}

        <Animated.View entering={ZoomIn.duration(motion.base)} layout={LinearTransition.springify().stiffness(280).damping(20)}>
          <Card><View style={{ alignItems: 'center', gap: 10 }}>
            {paid ? <View style={[s.big, { backgroundColor: colors.success }]}><Ionicons name="checkmark" size={44} color="#fff" /></View>
              : cancelled || expired || failed ? <View style={[s.big, { backgroundColor: colors.danger }]}><Ionicons name={expired || cancelled ? 'time-outline' : 'close'} size={44} color="#fff" /></View>
              : <Radar color={m.color} size={130}><Ionicons name={m.icon as never} size={32} color={m.color} /></Radar>}
            <Text style={[font.h2, { textAlign: 'center' }]}>{paid ? t('payment_success') : cancelled ? 'Pesanan dibatalkan' : expired ? t('payment_expired') : failed ? t('payment_failed') : overdue ? 'Memastikan status pembayaran…' : t('payment_pending')}</Text>
            <Text style={{ fontSize: 24, fontWeight: '700', color: colors.text }}>{rupiah(status?.amount ?? quote?.gross ?? order?.total ?? 0)}</Text>
            {pendingLive && left != null && left > 0 && (
              <Row gap={6}><Ionicons name="time-outline" size={16} color={left < 120000 ? colors.danger : colors.warning} /><Text style={{ fontWeight: '700', color: left < 120000 ? colors.danger : colors.text, fontVariant: ['tabular-nums'] }}>Bayar dalam {mmss(left)}</Text></Row>
            )}
            <Row gap={8} style={{ flexWrap: 'wrap', justifyContent: 'center' }}>
              <Badge text={chLabel} color={m.color} />
              {view.provider ? <Badge text={view.provider === 'simulated' ? t('simulation') : pgName ?? ''} color={view.provider === 'simulated' ? colors.warning : colors.info} /> : null}
              {ps ? <Badge text={payStatusLabel[ps] ?? ps} color={paid ? colors.success : ps === 'PENDING' ? colors.warning : colors.danger} /> : null}
            </Row>
            <SupportRef code={view.support_ref} />
            {notice && !paid ? <View style={s.notice}><Ionicons name="information-circle-outline" size={16} color={colors.info} /><Text style={[font.tiny, { flex: 1, color: colors.text }]}>{notice}</Text></View> : null}
            {failStreak >= 3 && !paid ? <View style={s.notice}><Ionicons name="cloud-offline-outline" size={16} color={colors.warning} /><Text style={[font.tiny, { flex: 1, color: colors.text }]}>Koneksi bermasalah — status terakhir: {payStatusLabel[ps ?? ''] ?? 'belum diketahui'}. Kami terus mencoba otomatis.</Text></View> : null}
            {paid && <Text style={[font.small, { textAlign: 'center' }]}>Pesanan dibayar. Membuka layar pelacakan…</Text>}
            {cancelled && <Text style={[font.small, { textAlign: 'center' }]}>{order?.cancel_reason ?? 'Pesanan dibatalkan karena tidak dibayar dalam batas waktu.'} Bila dana terlanjur terpotong, pengembalian diproses otomatis — simpan kode bantuan di atas.</Text>}
            {expired && <Text style={[font.small, { textAlign: 'center' }]}>Tagihan ini sudah tidak berlaku. Buat tagihan baru selama pesanan belum dibatalkan.</Text>}
            {failed && <Text style={[font.small, { textAlign: 'center' }]}>Pembayaran ditolak atau dibatalkan oleh {pgName ?? 'penyedia pembayaran'}. Coba lagi atau ganti metode.</Text>}
            {overdue && !expired && <Text style={[font.small, { textAlign: 'center' }]}>Batas waktu tercapai. Bila Anda baru saja membayar, status akan diperbarui dalam beberapa detik.</Text>}
            {createErr && !paid && <Text style={[font.small, { textAlign: 'center', color: colors.danger }]}>{createErr}</Text>}

            {pendingLive && !overdue && (
              <Animated.View entering={FadeInDown.duration(motion.base)} style={{ gap: 8, width: '100%' }}>
                <PaymentInstructions v={view} />
                {view.provider === 'simulated' && <SimulationBox externalId={view.external_id} onDone={() => { refresh(); loadOrder(); }} />}
                <Button title={t('check_status')} variant="ghost" icon="refresh" onPress={() => { refresh(); loadOrder(); }} />
              </Animated.View>
            )}
            {!paid && !cancelled && (expired || failed || (!ps && !busy && statusLoaded && started.current)) && (
              <Button title={expired ? t('new_invoice') : failed ? t('retry') : 'Buat tagihan'} size="lg" style={{ alignSelf: 'stretch' }} loading={busy} onPress={() => startPayment(method)} />
            )}
            {busy && !ps && <Text style={font.tiny}>Membuat tagihan…</Text>}
            {(cancelled || paid) && (
              <Row gap={8} style={{ alignSelf: 'stretch' }}>
                <Button title={paid ? 'Lihat pesanan' : 'Kembali ke beranda'} size="lg" style={{ flex: 1 }} onPress={() => router.replace((paid ? `/order/${orderId}` : '/') as never)} />
                {IS_CUSTOMER_APP && <Button title="Bukti" size="lg" variant="secondary" icon="receipt-outline" onPress={() => router.push({ pathname: '/orders/receipt', params: { id: orderId } } as never)} />}
              </Row>
            )}
          </View></Card>
        </Animated.View>

        {order && (
          <Entrance index={1}><Card>
            <Text style={[font.label, { marginBottom: 10 }]}>Rincian pembayaran</Text>
            <PriceSummary total={quote?.gross ?? order.total} rows={rows} />
          </Card></Entrance>
        )}

        {!paid && !cancelled && channels.length > 1 && (
          <Entrance index={2}><Card>
            <Text style={font.label}>Ganti metode pembayaran</Text>
            <ChannelGrid channels={channels} value={view.channel} base={base} disabled={busy || pendingLive}
              onPick={(k) => { setMethod(k); startPayment(k); }} />
            <Text style={[font.tiny, { marginTop: 8 }]}>{pendingLive ? 'Metode bisa diganti setelah tagihan aktif selesai, gagal, atau kedaluwarsa — supaya tidak ada pembayaran ganda.' : 'Mengganti metode menghitung ulang biaya metode pembayaran.'} Diproses oleh {pgName ?? 'payment gateway'} — AntarKita tidak menyimpan data kartu/akun e-wallet Anda.</Text>
          </Card></Entrance>
        )}
      </View>
    </Screen>
  );
}

const IS_WEB = Platform.OS === 'web';

const s = StyleSheet.create({
  hero: { borderRadius: radius.xl, padding: 18, overflow: 'hidden' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 10 },
  method: { width: '100%', alignItems: 'center', gap: 4, padding: 12, borderRadius: radius.lg, borderWidth: 1.5, borderColor: glass.border, backgroundColor: 'rgba(255,255,255,0.92)' },
  mIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  big: { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center' },
  simBox: { flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: 'rgba(245,158,11,0.12)', borderRadius: radius.md, padding: 10 },
  notice: { flexDirection: 'row', gap: 8, alignItems: 'center', alignSelf: 'stretch', backgroundColor: colors.infoLight, borderRadius: radius.md, padding: 10 },
  instr: { gap: 10, alignSelf: 'stretch', alignItems: 'stretch', padding: 12, borderRadius: radius.lg, backgroundColor: colors.bgSoft, borderWidth: 1, borderColor: colors.border },
  qr: { width: 220, height: 220, alignSelf: 'center', backgroundColor: '#fff', borderRadius: radius.md },
  code: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 14, borderRadius: radius.md, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.primaryLight },
  codeText: { fontSize: 22, fontWeight: '700', color: colors.text, letterSpacing: 1, fontVariant: ['tabular-nums'] },
});
