import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Row, Input, Button, toast } from '@/components/ui';
import { PressableScale } from '@/components/motion';
import { useAuth } from '@/store/auth';
import { useRouter } from 'expo-router';
import { supabase, rpc, friendlyError } from '@/lib/supabase';
import { colors, font, radius, glass, shadow } from '@/lib/theme';
import { rupiah, promoFunderLabel, pctLabel, ONGKIR_FULL_DRIVER } from '@/lib/format';
import type { Order, PaymentMethod, PromoFunder, ServiceEconomicsPublic, ServiceType } from '@/lib/types';
import { usePayPrefs, EWALLETS, GATEWAY_CHANNELS, channelLabel } from '@/store/payprefs';
import { useAntarPay, usePaymentChannels, CHANNELS_OFF_TEXT } from '@/hooks/useAppSettings';
import { AntarPayOffNote } from '@/components/AntarPayNotice';
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
 * berstatus `awaiting_payment` — saldo TIDAK dipotong; pelanggan membayar pesanan itu lewat Midtrans Snap
 * (purpose='order'). Pesanan lain langsung ke layar pelacakan.
 */
export function goAfterOrder(router: ReturnType<typeof useRouter>, o: Order, successText?: string) {
  if (o.status === 'awaiting_payment') {
    const ch = o.pg_channel ?? o.paid_via ?? '';
    toast.show(`Pesanan ${o.code} dibuat — selesaikan pembayaran ${channelLabel(ch)}`);
    router.replace({ pathname: '/pay/gateway', params: { purpose: 'order', order_id: o.id, method: ch } } as never);
    return;
  }
  if (successText) toast.success(successText);
  router.replace(`/order/${o.id}` as never);
}

/* ───────────── Rincian harga transparan (Skema Bisnis v2 §9) ───────────── */

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

/** Estimasi biaya pembayaran gateway sebelum pesanan dibuat. `policy` 'unknown' = server belum memberi tahu siapa penanggungnya. */
export type PayFeeEstimate = { channel: string; label: string; policy: 'customer' | 'platform' | 'unknown'; fee: number; error: string | null };

/**
 * Rincian biaya checkout yang datang dari server: aturan layanan + estimasi biaya pembayaran untuk saluran gateway
 * yang dipilih (`pg_fee_calc(channel, amount)`) — hanya bila kebijakan layanan membebankannya ke pelanggan.
 * `amount` = total sebelum biaya pembayaran (dasar yang sama dengan create_order).
 */
export function useCheckoutFees({ service, method, ewallet, amount }: { service: ServiceType; method: PayChoice; ewallet?: string | null; amount: number }) {
  const { econ, error: econError } = useServiceEconomics(service);
  const channel = method === 'ewallet' ? paidViaOf(method, ewallet) : null;
  const gateway = !!channel && GATEWAY_CHANNELS.includes(channel);
  const policy: PayFeeEstimate['policy'] = econ?.pg_fee_policy === 'customer' ? 'customer' : econ?.pg_fee_policy === 'platform' ? 'platform' : 'unknown';
  const base = Math.max(0, Math.round(amount || 0));
  const [fee, setFee] = useState(0);
  const [feeErr, setFeeErr] = useState<string | null>(null);
  useEffect(() => {
    if (!gateway || policy !== 'customer' || base <= 0) { setFee(0); setFeeErr(null); return; }
    let live = true;
    const t = setTimeout(async () => {
      const { data, error } = await supabase.rpc('pg_fee_calc', { p_channel: channel, p_amount: base });
      if (!live) return;
      if (error) { setFee(0); setFeeErr(`Biaya pembayaran belum bisa dihitung: ${friendlyError(error.message)}`); return; }
      const row = (Array.isArray(data) ? data[0] : data) as { fee?: number; ppn?: number } | null;
      setFee(Number(row?.fee ?? 0) + Number(row?.ppn ?? 0)); setFeeErr(null);
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [gateway, policy, channel, base]);
  const pay: PayFeeEstimate | null = gateway && channel ? { channel, label: channelLabel(channel), policy, fee: policy === 'customer' ? fee : 0, error: feeErr } : null;
  /** Biaya pembayaran yang menambah total (0 bila ditanggung platform / belum diketahui). */
  const payFee = pay?.policy === 'customer' ? pay.fee : 0;
  return { econ, econError, pay, payFee };
}

export type PriceRow = { label: string; value: number; minus?: boolean; hint?: string | null; estimate?: boolean; keep?: boolean };

/**
 * Baris rincian checkout yang seragam untuk semua layanan (§9):
 * Ongkir · Nilai barang · Biaya platform · Biaya layanan (shop/market) · Biaya pembayaran (estimasi) · Promo (−, pemilik biaya).
 */
export function checkoutRows(p: {
  service: ServiceType; econ?: ServiceEconomicsPublic | null;
  ongkir: number; ongkirLabel?: string; ongkirHint?: string | null;
  extra?: PriceRow[];
  items?: number | null; itemsLabel?: string; itemsHint?: string | null;
  platformFee: number; serviceFee?: number;
  pay?: PayFeeEstimate | null;
  discount: number; promoCode?: string | null; promoFunder?: PromoFunder | null; hasMerchant?: boolean;
}): PriceRow[] {
  const full = ONGKIR_FULL_DRIVER.includes(p.service);
  const comm = p.econ?.driver_commission_pct;
  const rows: PriceRow[] = [{
    label: p.ongkirLabel ?? 'Ongkir', value: p.ongkir, keep: true,
    hint: p.ongkirHint !== undefined ? p.ongkirHint : full ? '100 % untuk driver — platform tidak memotong ongkir'
      : comm != null ? `Driver menerima ongkir dikurangi komisi platform ${pctLabel(comm)}` : null,
  }];
  if (p.extra) rows.push(...p.extra);
  if (p.items != null) rows.push({ label: p.itemsLabel ?? 'Nilai barang', value: p.items, hint: p.itemsHint ?? null });
  rows.push({ label: 'Biaya platform', value: p.platformFee, keep: true, hint: 'Biaya aplikasi AntarKita, terpisah dari ongkir' });
  if (p.serviceFee) rows.push({ label: 'Biaya layanan', value: p.serviceFee, hint: 'Jasa belanja oleh driver (dibagi driver & platform)' });
  if (p.pay?.policy === 'customer') rows.push({ label: `Biaya pembayaran ${p.pay.label}`, value: p.pay.fee, estimate: true, keep: true, hint: 'Biaya Midtrans untuk saluran ini — nilai final tampil di halaman bayar' });
  if (p.discount > 0) {
    // create_order: promo "merchant" tanpa merchant (ride/send/…) otomatis ditanggung platform
    const funder: PromoFunder | null = p.promoFunder === 'merchant' && !p.hasMerchant ? 'platform' : p.promoFunder ?? null;
    rows.push({ label: `Promo${p.promoCode ? ` (${p.promoCode})` : ''}`, value: p.discount, minus: true, hint: funder ? promoFunderLabel[funder] : null });
  }
  return rows;
}

/** Keterangan di bawah rincian untuk saluran gateway (bayar per pesanan lewat Midtrans). */
export function checkoutNote(pay: PayFeeEstimate | null | undefined, econError?: string | null): string | null {
  if (econError) return `Aturan biaya layanan belum termuat (${econError}). Total final dihitung server saat memesan.`;
  if (!pay) return null;
  if (pay.error) return pay.error;
  if (pay.policy === 'customer') return `Dibayar per pesanan lewat Midtrans (${pay.label}). Halaman bayar terbuka setelah Anda menekan Pesan.`;
  if (pay.policy === 'platform') return `Dibayar per pesanan lewat Midtrans (${pay.label}). Biaya pembayaran ditanggung AntarKita.`;
  return `Dibayar per pesanan lewat Midtrans (${pay.label}). Bila ada biaya pembayaran, nilainya ditampilkan di halaman bayar sebelum Anda membayar.`;
}

export function PaymentSection({ method, onMethod, promo, onPromo, notes, onNotes, subtotal, service, onDiscount, notesPlaceholder, hidePromo }: {
  method: PayChoice; onMethod: (m: PayChoice) => void; promo: string; onPromo: (v: string) => void;
  notes: string; onNotes: (v: string) => void; subtotal: number; service: ServiceType;
  /** `funder` = pemilik biaya promo (promos.funded_by) untuk keterangan "ditanggung …" di rincian. */
  onDiscount: (d: number, funder?: PromoFunder | null) => void; notesPlaceholder?: string;
  /** Sembunyikan kode promo bila RPC pemesanannya tidak menerima promo (mis. travel_book). */
  hidePromo?: boolean;
}) {
  const { wallet, session } = useAuth();
  const router = useRouter();
  const { prefs, loaded, load, save } = usePayPrefs();
  const { enabled: antarpayOn } = useAntarPay();
  const { isChannelOn, nonCashOn } = usePaymentChannels();
  // 0089: saluran yang dimatikan admin tidak ditawarkan (server menolaknya lewat payment_channel_require).
  const cashOn = isChannelOn('cash');
  const walletOn = isChannelOn('antarpay');
  const wallets = EWALLETS.filter((x) => isChannelOn(x.key));
  const ewalletOn = wallets.length > 0;
  const allowed = (m: PayChoice) => (m === 'cash' ? cashOn : m === 'wallet' ? walletOn : ewalletOn);
  const firstAllowed: PayChoice = cashOn ? 'cash' : walletOn ? 'wallet' : 'ewallet';
  useEffect(() => { if (session && !loaded) load(session.user.id); }, [session, loaded, load]);
  useEffect(() => { if (loaded && prefs && !appliedRef.current) { appliedRef.current = true; onMethod(antarpayOn && allowed(prefs.default_method) ? prefs.default_method : firstAllowed); } }, [loaded]); // eslint-disable-line react-hooks/exhaustive-deps
  // 0088/0089: saluran terpilih dimatikan admin → pindah ke saluran pertama yang masih dibuka.
  useEffect(() => { if (!allowed(method)) onMethod(firstAllowed); }, [antarpayOn, cashOn, walletOn, ewalletOn, method]); // eslint-disable-line react-hooks/exhaustive-deps
  // e-wallet pilihan lama dimatikan admin → geser ke e-wallet pertama yang aktif supaya paid_via tetap sah.
  useEffect(() => {
    if (!session || !loaded || !ewalletOn) return;
    if (prefs?.ewallet && !wallets.some((x) => x.key === prefs.ewallet)) save(session.user.id, { ewallet: wallets[0].key as never });
  }, [loaded, ewalletOn, prefs?.ewallet]); // eslint-disable-line react-hooks/exhaustive-deps
  const appliedRef = React.useRef(false);
  const ew = wallets.find((x) => x.key === prefs?.ewallet) ?? wallets[0] ?? EWALLETS[0];
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
    setPromoMsg({ ok: true, text: `Hemat ${rupiah(d)}${funder ? ` · ${promoFunderLabel[funder]}` : prErr ? ' · pemilik biaya promo belum termuat' : ''}` });
    toast.success('Promo diterapkan');
  };

  return (
    <View style={{ gap: 12 }}>
      <Text style={font.label}>Pembayaran</Text>
      <Row gap={8}>
        {cashOn && <PayOption active={method === 'cash'} onPress={() => onMethod('cash')} icon="cash-outline" title="Tunai" subtitle="Ke driver" />}
        {walletOn && <PayOption active={method === 'wallet'} onPress={() => onMethod('wallet')} icon="wallet-outline" title="AntarPay" subtitle={rupiah(wallet?.balance ?? 0)} />}
        {ewalletOn && <PayOption active={method === 'ewallet'} onPress={() => onMethod('ewallet')} icon="phone-portrait-outline" title={ew.label} subtitle="e-wallet" color={ew.color} />}
      </Row>
      {antarpayOn && nonCashOn ? (
        <PressableScale onPress={() => router.push('/(customer)/pay' as never)} scaleTo={0.98} haptic={false} style={s.gwRow}>
          <View style={s.gwIcons}>{['#00AA13', '#4C2A86', '#118EEA', '#EE4D2D'].map((c) => <View key={c} style={[s.gwDot, { backgroundColor: c }]} />)}</View>
          <View style={{ flex: 1 }}><Text style={{ fontWeight: '700', color: colors.text, fontSize: 14 }}>{method === 'ewallet' ? `Bayar dengan ${ew.label} (via Midtrans)` : 'Ganti e-wallet / metode utama'}</Text><Text style={font.tiny}>{method === 'ewallet' ? 'Dibayar langsung per pesanan (tidak lewat saldo) — halaman bayar terbuka setelah Anda menekan Pesan.' : [walletOn ? 'Saldo AntarPay' : null, ...wallets.map((w) => w.label)].filter(Boolean).join(' · ')}</Text></View>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </PressableScale>
      ) : <AntarPayOffNote text={!cashOn && !walletOn && !ewalletOn ? 'Semua metode pembayaran sedang dinonaktifkan admin — coba lagi nanti.' : antarpayOn ? CHANNELS_OFF_TEXT : undefined} />}
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

function PayOption({ active, onPress, icon, title, subtitle, color = colors.primary }: { active: boolean; onPress: () => void; icon: React.ComponentProps<typeof Ionicons>['name']; title: string; subtitle: string; color?: string }) {
  return (
    <PressableScale onPress={onPress} scaleTo={0.97} style={[s.pay, active && { borderColor: color, backgroundColor: color + '14', ...shadow.glow(color) }]}>
      <View style={[s.payIcon, active && { backgroundColor: color }]}><Ionicons name={icon} size={20} color={active ? '#fff' : colors.textSecondary} /></View>
      {/* Tata letak menurun (ikon di atas teks): pada layar 390px, tata letak mendatar hanya menyisakan ~45px
          untuk teks sehingga "AntarPay" terpotong jadi "Anta…" dan nominal saldo tidak terbaca. */}
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
});
