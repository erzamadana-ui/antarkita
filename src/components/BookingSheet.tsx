import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Row, Input, Button, toast } from '@/components/ui';
import { PressableScale } from '@/components/motion';
import { useAuth } from '@/store/auth';
import { useRouter } from 'expo-router';
import { supabase, rpc, friendlyError } from '@/lib/supabase';
import { colors, font, radius, glass, shadow } from '@/lib/theme';
import { rupiah, promoOwnerLabel } from '@/lib/format';
import type { Order, PaymentMethod, PromoFunder, ProviderChannel, ServiceEconomicsPublic, ServiceType } from '@/lib/types';
import { usePayPrefs, EWALLETS, GATEWAY_CHANNELS, PAYMENT_CHANNELS, channelLabel } from '@/store/payprefs';
import { buildCheckoutRows, checkoutNoteText, channelFeeText, estimatePgFee, useProviderPublic, type PriceRow, type PayFeeEstimate } from '@/lib/payments';
import { useAdAttribution } from '@/lib/ads';
import { useAntarVoucher, usePaymentChannels, CHANNELS_OFF_TEXT } from '@/hooks/useAppSettings';
import { AntarVoucherOffNote } from '@/components/AntarVoucherNotice';
import { useEffect } from 'react';


/** Pilihan metode bayar + promo + catatan — dipakai ride, food, send. */
export type PayChoice = PaymentMethod | 'ewallet';
/** Nilai `paid_via` untuk create_order: 'cash' | 'wallet' | kode e-wallet (gopay/ovo/…). */
export const paidViaOf = (m: PayChoice, ewallet?: string | null) => (m === 'ewallet' ? (ewallet ?? 'gopay') : m);
/** Tangani error SALDO_KURANG:<nominal> → buka gateway e-wallet untuk kekurangannya. Mengembalikan true bila ditangani. */
export function handleShortfall(e: unknown, router: ReturnType<typeof useRouter>, ewallet?: string | null) {
  const m = /SALDO_KURANG:(\d+)/.exec((e as Error).message ?? '');
  if (!m) return false;
  const amount = Math.max(10000, Math.ceil(Number(m[1]) / 1000) * 1000);
  toast.show(`Saldo kurang ${rupiah(Number(m[1]))} — lengkapi lewat ${ewallet ? (EWALLETS.find((x) => x.key === ewallet)?.label ?? 'e-wallet') : 'e-wallet'}`);
  router.push({ pathname: '/pay/gateway', params: { amount: String(amount), method: ewallet ?? 'gopay', reason: 'order' } } as never);
  return true;
}

/**
 * Setelah `create_order` berhasil. Sejak 0100, paid_via saluran gateway (GoPay/QRIS/VA/…) membuat pesanan
 * berstatus `awaiting_payment` — saldo TIDAK dipotong; pelanggan membayar pesanan itu lewat provider aktif
 * (edge `pay-create`, purpose='order'). Pesanan lain langsung ke layar pelacakan.
 * Atribusi iklan untuk merchant pesanan ini dilepas (konversi sudah tercatat server lewat create_order).
 */
export function goAfterOrder(router: ReturnType<typeof useRouter>, o: Order, successText?: string) {
  if (o.merchant_id) useAdAttribution.getState().clear(o.merchant_id);
  if (o.status === 'awaiting_payment') {
    const ch = o.pg_channel ?? o.paid_via ?? '';
    toast.show(`Pesanan ${o.code} dibuat — selesaikan pembayaran ${channelLabel(ch)}`);
    router.replace({ pathname: '/pay/gateway', params: { purpose: 'order', order_id: o.id, method: ch } } as never);
    return;
  }
  if (successText) toast.success(successText);
  router.replace(`/order/${o.id}` as never);
}

/* ───────────── Rincian harga transparan (§0.4 v3) — logika di src/lib/payments.ts ───────────── */

// Satu permintaan per layanan per sesi aplikasi: aturan bisnis jarang berubah dan dipakai di banyak layar.
const econCache = new Map<ServiceType, Promise<ServiceEconomicsPublic>>();
/** `service_economics_public(service)` — biaya platform pelanggan, jasa belanja, komisi driver (sumber angka, bukan konstanta klien). */
export function useServiceEconomics(service: ServiceType) {
  const [econ, setEcon] = useState<ServiceEconomicsPublic | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    let p = econCache.get(service);
    if (!p) { p = rpc<ServiceEconomicsPublic>('service_economics_public', { p_service: service }); econCache.set(service, p); }
    p.then(
      (d) => { if (live) { setEcon(d); setError(null); } },
      (e: Error) => { econCache.delete(service); if (live) setError(e.message); },
    );
    return () => { live = false; };
  }, [service]);
  return { econ, error };
}

export type { PriceRow, PayFeeEstimate };
/** Nama lama — sekarang `buildCheckoutRows` di lib/payments. */
export const checkoutRows = buildCheckoutRows;
/** Nama lama — sekarang `checkoutNoteText` di lib/payments. */
export const checkoutNote = checkoutNoteText;

/**
 * Rincian biaya checkout dari server: aturan layanan (`service_economics_public`), provider aktif
 * (`payment_provider_public`) dan estimasi biaya metode pembayaran (`pg_fee_estimate`) untuk kanal terpilih.
 * `amount` = total sebelum biaya pembayaran (dasar yang sama dengan create_order).
 * `pay` selalu terisi: tunai/AntarVoucher → Rp0; kanal gateway → biaya pelanggan (0 bila ditanggung AntarKita).
 */
export function useCheckoutFees({ service, method, ewallet, amount }: { service: ServiceType; method: PayChoice; ewallet?: string | null; amount: number }) {
  const { econ, error: econError } = useServiceEconomics(service);
  const { provider, providerName } = useProviderPublic();
  const channel = method === 'ewallet' ? paidViaOf(method, ewallet) : null;
  const provCh = channel ? provider?.channels.find((c) => c.key === channel) ?? null : null;
  const gateway = !!channel && (!!provCh || GATEWAY_CHANNELS.includes(channel));
  const base = Math.max(0, Math.round(amount || 0));
  const [est, setEst] = useState<{ fee: number; policy: PayFeeEstimate['policy']; error: string | null }>({ fee: 0, policy: 'unknown', error: null });
  useEffect(() => {
    if (!gateway || !channel || base <= 0) { setEst({ fee: 0, policy: provCh && !provCh.pass_to_customer ? 'platform' : 'unknown', error: null }); return; }
    let live = true;
    const t = setTimeout(async () => {
      try {
        const e = await estimatePgFee(service, channel, base);
        if (!live) return;
        const cust = Math.max(0, Number(e?.customer_fee) || 0);
        setEst({ fee: cust, policy: cust > 0 ? 'customer' : 'platform', error: null });
      } catch (e) {
        if (!live) return;
        // Tanpa estimasi server: kanal yang tidak dibebankan ke pelanggan tetap Rp0 (ditanggung AntarKita).
        if (provCh && !provCh.pass_to_customer) setEst({ fee: 0, policy: 'platform', error: null });
        else setEst({ fee: 0, policy: 'unknown', error: `Biaya metode pembayaran belum bisa dihitung: ${friendlyError((e as Error).message)}` });
      }
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [gateway, channel, base, service, provCh?.pass_to_customer]); // eslint-disable-line react-hooks/exhaustive-deps
  const pay: PayFeeEstimate = gateway && channel
    ? { kind: 'gateway', channel, label: provCh?.label ?? channelLabel(channel), provider: provider?.provider ?? null, providerName, policy: est.policy, fee: est.policy === 'customer' ? est.fee : 0, error: est.error }
    : { kind: method === 'wallet' ? 'wallet' : 'cash', channel: null, label: method === 'wallet' ? 'AntarVoucher' : 'Tunai', provider: null, providerName: null, policy: 'platform', fee: 0, error: null };
  /** Biaya pembayaran yang menambah total (0 bila ditanggung AntarKita / belum diketahui). */
  const payFee = pay.policy === 'customer' ? pay.fee : 0;
  return { econ, econError, pay, payFee };
}
export function PaymentSection({ method, onMethod, promo, onPromo, notes, onNotes, subtotal, service, onDiscount, notesPlaceholder, hidePromo, feeBase }: {
  method: PayChoice; onMethod: (m: PayChoice) => void; promo: string; onPromo: (v: string) => void;
  notes: string; onNotes: (v: string) => void; subtotal: number; service: ServiceType;
  /** `funder` = pemilik biaya promo (promos.funded_by) untuk keterangan "ditanggung …" di rincian. */
  onDiscount: (d: number, funder?: PromoFunder | null) => void; notesPlaceholder?: string;
  /** Sembunyikan kode promo bila RPC pemesanannya tidak menerima promo (mis. travel_book). */
  hidePromo?: boolean;
  /** Total sebelum biaya pembayaran — untuk label biaya per kanal ("+Rp3.500" / "gratis"). */
  feeBase?: number;
}) {
  const { wallet, session } = useAuth();
  const router = useRouter();
  const { prefs, loaded, load, save } = usePayPrefs();
  const { enabled: antarpayOn } = useAntarVoucher();
  const { isChannelOn, nonCashOn } = usePaymentChannels();
  // v3 §1: kanal gateway + biayanya dari payment_provider_public() (hanya `enabled`). Bila RPC gagal → daftar lama (0089).
  const { provider, channels: provChannels, providerName } = useProviderPublic();
  const cashOn = isChannelOn('cash');
  const walletOn = isChannelOn('antarpay');
  const wallets: { key: string; label: string; color: string; icon: string; ch: ProviderChannel | null }[] = provider
    ? provChannels.map((c) => { const meta = PAYMENT_CHANNELS.find((x) => x.key === c.key); return { key: c.key, label: c.label || channelLabel(c.key), color: meta?.color ?? colors.info, icon: meta?.icon ?? channelIcon(c.key), ch: c }; })
    : EWALLETS.filter((x) => isChannelOn(x.key)).map((x) => ({ key: x.key, label: x.label, color: x.color, icon: x.icon, ch: null }));
  const ewalletOn = wallets.length > 0;
  const allowed = (m: PayChoice) => (m === 'cash' ? cashOn : m === 'wallet' ? walletOn : ewalletOn);
  const firstAllowed: PayChoice = cashOn ? 'cash' : walletOn ? 'wallet' : 'ewallet';
  const appliedRef = React.useRef(false);
  useEffect(() => { if (session && !loaded) load(session.user.id); }, [session, loaded, load]);
  useEffect(() => { if (loaded && prefs && !appliedRef.current) { appliedRef.current = true; onMethod(allowed(prefs.default_method) ? prefs.default_method : firstAllowed); } }, [loaded]); // eslint-disable-line react-hooks/exhaustive-deps
  // 0088/0089: saluran terpilih dimatikan admin → pindah ke saluran pertama yang masih dibuka.
  useEffect(() => { if (!allowed(method)) onMethod(firstAllowed); }, [antarpayOn, cashOn, walletOn, ewalletOn, method]); // eslint-disable-line react-hooks/exhaustive-deps
  // Kanal pilihan lama tidak aktif lagi → geser ke kanal aktif pertama supaya paid_via tetap sah.
  useEffect(() => {
    if (!session || !loaded || !ewalletOn) return;
    if (!prefs?.ewallet || !wallets.some((x) => x.key === prefs.ewallet)) save(session.user.id, { ewallet: wallets[0].key as never });
  }, [loaded, ewalletOn, prefs?.ewallet, provider?.provider]); // eslint-disable-line react-hooks/exhaustive-deps
  const ew = wallets.find((x) => x.key === prefs?.ewallet) ?? wallets[0] ?? null;
  const feeText = (x: typeof wallets[number]) => (x.ch ? channelFeeText(x.ch, feeBase ?? 0) : 'biaya tampil saat bayar');
  const pickChannel = (key: string) => { if (session) save(session.user.id, { ewallet: key as never }); onMethod('ewallet'); };
  const [checking, setChecking] = useState(false);
  const [promoMsg, setPromoMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const checkPromo = async () => {
    if (!promo.trim()) { onDiscount(0, null); setPromoMsg(null); return; }
    setChecking(true);
    const { data, error } = await supabase.rpc('apply_promo', { p_code: promo.trim(), p_service: service, p_subtotal: subtotal });
    if (error) { setChecking(false); onDiscount(0, null); setPromoMsg({ ok: false, text: error.message.replace(/^.*?:\s*/, '') }); return; }
    // Penjaga NaN: bila server membalas bentuk tak terduga, jangan rusak seluruh perhitungan total.
    const d = Number(data);
    if (!Number.isFinite(d) || d < 0) { setChecking(false); onDiscount(0, null); setPromoMsg({ ok: false, text: 'Promo tidak bisa diterapkan saat ini' }); return; }
    // Pemilik biaya promo (0099 promos.funded_by) — promo bukan pendapatan; pelanggan berhak tahu siapa yang menanggung.
    // Gagal membaca pemiliknya tidak membatalkan promo (server tetap memakai funded_by saat create_order) — keterangannya saja yang kosong.
    const { data: pr, error: prErr } = await supabase.from('promos').select('funded_by').eq('code', promo.trim().toUpperCase()).maybeSingle();
    setChecking(false);
    const funder = prErr ? null : ((pr as { funded_by?: PromoFunder | null } | null)?.funded_by ?? null);
    onDiscount(d, funder);
    setPromoMsg({ ok: true, text: `Hemat ${rupiah(d)}${funder ? ` · ${promoOwnerLabel[funder]}` : prErr ? ' · penanggung promo belum termuat' : ''}` });
    toast.success('Promo diterapkan');
  };

  return (
    <View style={{ gap: 12 }}>
      <Text style={font.label}>Pembayaran</Text>
      <Row gap={8}>
        {cashOn && <PayOption active={method === 'cash'} onPress={() => onMethod('cash')} icon="cash-outline" title="Tunai" subtitle="Ke driver" />}
        {walletOn && <PayOption active={method === 'wallet'} onPress={() => onMethod('wallet')} icon="wallet-outline" title="AntarVoucher" subtitle={rupiah(wallet?.balance ?? 0)} />}
        {ewalletOn && ew && <PayOption active={method === 'ewallet'} onPress={() => onMethod('ewallet')} icon={ew.icon as never} title={ew.label} subtitle={feeText(ew)} color={ew.color} />}
      </Row>
      {method === 'ewallet' && ewalletOn && wallets.length > 1 ? (
        <View style={s.chGrid}>
          {wallets.map((x) => {
            const on = x.key === ew?.key;
            return (
              <PressableScale key={x.key} onPress={() => pickChannel(x.key)} scaleTo={0.96} haptic={false} style={[s.ch, on && { borderColor: x.color, backgroundColor: x.color + '12' }]}>
                <Ionicons name={x.icon as never} size={16} color={on ? x.color : colors.textSecondary} />
                <Text style={{ fontWeight: '700', color: colors.text, fontSize: 12, flexShrink: 1 }} numberOfLines={1}>{x.label}</Text>
                <Text style={[font.tiny, { color: x.ch?.pass_to_customer ? colors.textSecondary : colors.success, fontWeight: '700' }]} numberOfLines={1}>{feeText(x)}</Text>
              </PressableScale>
            );
          })}
        </View>
      ) : null}
      {method === 'ewallet' && ew ? (
        <Text style={font.tiny}>Dibayar langsung per pesanan lewat {providerName ?? 'payment gateway'} ({ew.label}) — tidak lewat saldo. Halaman bayar terbuka setelah Anda menekan Pesan; biaya metode pembayaran tampil di rincian.</Text>
      ) : (antarpayOn && nonCashOn) || ewalletOn ? (
        <PressableScale onPress={() => router.push('/(customer)/pay' as never)} scaleTo={0.98} haptic={false} style={s.gwRow}>
          <View style={s.gwIcons}>{wallets.slice(0, 4).map((w) => <View key={w.key} style={[s.gwDot, { backgroundColor: w.color }]} />)}</View>
          <View style={{ flex: 1 }}><Text style={{ fontWeight: '700', color: colors.text, fontSize: 14 }}>Ganti metode utama</Text><Text style={font.tiny} numberOfLines={2}>{[walletOn ? 'Saldo AntarVoucher' : null, ...wallets.map((w) => w.label)].filter(Boolean).join(' · ')}</Text></View>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </PressableScale>
      ) : <AntarVoucherOffNote text={!cashOn && !walletOn && !ewalletOn ? 'Semua metode pembayaran sedang dinonaktifkan admin — coba lagi nanti.' : antarpayOn ? CHANNELS_OFF_TEXT : undefined} />}
      {!hidePromo && (
        <Row gap={8}>
          <View style={{ flex: 1 }}>
            <Input placeholder="Kode promo" value={promo} onChangeText={(v) => { onPromo(v.toUpperCase()); setPromoMsg(null); }} autoCapitalize="characters" icon="pricetag-outline" />
          </View>
          <Button title="Pakai" size="md" variant="secondary" loading={checking} onPress={checkPromo} />
        </Row>
      )}
      {!hidePromo && promoMsg && <Text style={{ color: promoMsg.ok ? colors.success : colors.danger, fontSize: 12, marginTop: -6 }}>{promoMsg.text}</Text>}
      <View style={s.notes}>
        <Ionicons name="chatbox-ellipses-outline" size={20} color={colors.textMuted} />
        <TextInput placeholder={notesPlaceholder ?? 'Catatan untuk driver (opsional)'} placeholderTextColor={colors.textMuted} value={notes} onChangeText={onNotes} style={s.notesInput} />
      </View>
    </View>
  );
}

/** Ikon untuk kanal yang tidak ada di daftar lama (gerai ritel, paylater, dll.). */
function channelIcon(key: string): string {
  if (key === 'qris') return 'qr-code-outline';
  if (key === 'card') return 'card-outline';
  if (key === 'bank_transfer' || key.startsWith('va_') || key === 'instant_payment') return 'business-outline';
  if (key.startsWith('retail_')) return 'storefront-outline';
  if (key.startsWith('paylater_')) return 'time-outline';
  return 'phone-portrait-outline';
}

function PayOption({ active, onPress, icon, title, subtitle, color = colors.primary }: { active: boolean; onPress: () => void; icon: React.ComponentProps<typeof Ionicons>['name']; title: string; subtitle: string; color?: string }) {
  return (
    <PressableScale onPress={onPress} scaleTo={0.97} style={[s.pay, active && { borderColor: color, backgroundColor: color + '14', ...shadow.glow(color) }]}>
      <View style={[s.payIcon, active && { backgroundColor: color }]}><Ionicons name={icon} size={20} color={active ? '#fff' : colors.textSecondary} /></View>
      {/* Tata letak menurun (ikon di atas teks): pada layar 390px, tata letak mendatar hanya menyisakan ~45px
          untuk teks sehingga "AntarVoucher" terpotong jadi "Anta…" dan nominal saldo tidak terbaca. */}
      <Text style={s.payTitle} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>{title}</Text>
      <Text style={s.paySub} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{subtitle}</Text>
    </PressableScale>
  );
}

export function PriceSummary({ rows, total, totalLabel = 'Total', note }: { rows: PriceRow[]; total: number; totalLabel?: string; note?: string | null }) {
  return (
    <View style={{ gap: 6 }}>
      {rows.filter((r) => r.keep || r.value !== 0).map((r) => (
        <View key={r.label}>
          <Row between style={{ alignItems: 'flex-start', gap: 8 }}>
            <Text style={[font.small, { flex: 1 }]}>{r.label}{r.estimate ? ' (estimasi)' : ''}</Text>
            <Text style={{ color: r.minus ? colors.success : colors.text, fontWeight: '600' }}>{r.minus ? '-' : ''}{rupiah(r.value)}</Text>
          </Row>
          {r.hint ? <Text style={[font.tiny, { marginTop: 1 }]}>{r.hint}</Text> : null}
        </View>
      ))}
      <Row between style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8, marginTop: 2 }}>
        <Text style={font.h3}>{totalLabel}</Text>
        <Text style={[font.h2, { color: colors.primary }]}>{rupiah(total)}</Text>
      </Row>
      {note ? <Text style={font.tiny}>{note}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  pay: { flex: 1, minWidth: 0, alignItems: 'center', gap: 4, borderWidth: 1.5, borderColor: 'rgba(11,31,42,0.08)', borderRadius: radius.lg, paddingVertical: 10, paddingHorizontal: 6, backgroundColor: 'rgba(255,255,255,0.92)' },
  payTitle: { fontWeight: '700', color: colors.text, fontSize: 14, textAlign: 'center', alignSelf: 'stretch' },
  paySub: { ...font.tiny, textAlign: 'center', alignSelf: 'stretch' },
  payIcon: { width: 30, height: 30, borderRadius: 10, backgroundColor: 'rgba(11,31,42,0.06)', alignItems: 'center', justifyContent: 'center' },
  gwRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: radius.lg, backgroundColor: 'rgba(255,255,255,0.92)', borderWidth: 1, borderColor: glass.border },
  gwIcons: { flexDirection: 'row', flexWrap: 'wrap', width: 34, gap: 3 },
  gwDot: { width: 14, height: 14, borderRadius: 4 },
  notes: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(255,255,255,0.92)', borderWidth: 1, borderColor: glass.border, borderRadius: radius.md, paddingHorizontal: 12 },
  notesInput: { flex: 1, height: 44, color: colors.text, fontSize: 14 },
  chGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  ch: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.md, borderWidth: 1.5, borderColor: glass.border, backgroundColor: 'rgba(255,255,255,0.92)', maxWidth: '100%' },
});
