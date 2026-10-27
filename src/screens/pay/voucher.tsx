// Beli AntarVoucher v5 (`/pay/voucher`) — model closed-loop penuh (docs/antarvoucher/KONTRAK-V5.md §3–§4).
//  • Konfigurasi dari `voucher_public_config()` (useVoucherConfig): nominal, min/max, cap saldo per peran, TTL kode, rekening.
//  • Pembelian: `voucher_code_purchase_create` → {purchase, code}. Kode `AKV-XXXX-XXXX-XXXX` terbit dari server, status
//    `pending_payment` sampai Finance mencocokkan transfer (nominal + 3 digit kode unik) → `issued` → (auto) `redeemed`.
//  • "Saya sudah transfer" = `voucher_purchase_mark_sent` (0112) — hanya info bantu pencocokan, TIDAK menambah saldo.
//  • Tab "Kode saya" (`my_voucher_codes`), form "Tukar kode" (`voucher_code_redeem`) untuk kode hadiah / kode issued.
//  • Cap saldo: pelanggan `cap_customer`, mitra (driver/merchant/travel/vendor) `cap_partner`; ruang sisa = cap − saldo.
//  • Layar ini juga dipakai app Mitra (deposit driver) — tidak boleh bergantung pada komponen khusus pelanggan.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { WALLET_UI } from '@/lib/features';
import { FeatureUnavailable } from '@/components/FeatureUnavailable';
import { View, Text, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Screen, Card, Row, Input, Button, Chip, Badge, Empty, toast } from '@/components/ui';
import { Entrance, PressableScale, Skeleton } from '@/components/motion';
import { useAuth } from '@/store/auth';
import { colors, font, radius } from '@/lib/theme';
import { rupiah, formatDate } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { useVoucherConfig } from '@/hooks/useVoucherV5';
import {
  voucherCodePurchaseCreate, myVoucherCodes, voucherCodeRedeem, formatVoucherCode,
  type VoucherCode, type VoucherCodeStatus, type VoucherPurchaseWithCode,
} from '@/lib/voucherV5';
import {
  voucherStatusMeta, voucherStatusLabel, voucherStatusColor, canMarkSent, canCancel, canDispute, showsInstructions,
  newIdempotencyKey, formatCountdown, splitTransferAmount, validateNominal, voucherError, isMissingRpc,
  fetchMyVoucherPurchases, markVoucherSent, cancelVoucherPurchase, disputeVoucherPurchase, bankMeta,
  type VoucherBankAccount, type VoucherPurchase,
} from '@/lib/voucher';

/** "Logo" bank: kotak berwarna khas bank + singkatan (tanpa aset gambar; kode tak dikenal → generik). */
function BankLogo({ code, name, size = 36, active }: { code?: string | null; name?: string | null; size?: number; active?: boolean }) {
  const m = bankMeta(code, name);
  const generic = m.code === 'other';
  return (
    <View style={{ width: size, height: size, borderRadius: Math.round(size / 3), backgroundColor: active ? m.color : m.color + '1A', alignItems: 'center', justifyContent: 'center' }} accessibilityElementsHidden>
      {generic ? <Ionicons name="business" size={Math.round(size / 2)} color={active ? '#fff' : m.color} />
        : <Text style={{ fontSize: m.short.length > 3 ? Math.round(size * 0.26) : Math.round(size * 0.32), fontWeight: '800', letterSpacing: 0.3, color: active ? '#fff' : m.color }} numberOfLines={1}>{m.short}</Text>}
    </View>
  );
}

type Tab = 'buy' | 'codes' | 'redeem';

const copy = async (text: string, what: string) => {
  try { await Clipboard.setStringAsync(text); toast.success(`${what} disalin`); } catch { toast.error('Gagal menyalin'); }
};

function useNow(active: boolean, every = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(t);
  }, [active, every]);
  return now;
}

/** Peran untuk cap saldo: mitra (driver/merchant/travel/vendor) memakai cap_partner. */
function usePartnerRole(): boolean {
  const { profile, driver, merchant, travelPartner, marketVendor } = useAuth();
  const role = String(profile?.role ?? '');
  return !!(driver || merchant || travelPartner || marketVendor) || role === 'driver' || role === 'merchant';
}

const CODE_STATUS: Record<VoucherCodeStatus, { key: 'v5_status_pending_payment' | 'v5_status_issued' | 'v5_status_redeemed' | 'v5_status_expired' | 'v5_status_void'; color: string; icon: string }> = {
  pending_payment: { key: 'v5_status_pending_payment', color: colors.warning, icon: 'time-outline' },
  issued: { key: 'v5_status_issued', color: colors.info, icon: 'ticket-outline' },
  redeemed: { key: 'v5_status_redeemed', color: colors.success, icon: 'checkmark-circle' },
  expired: { key: 'v5_status_expired', color: colors.textSecondary, icon: 'hourglass-outline' },
  void: { key: 'v5_status_void', color: colors.danger, icon: 'close-circle-outline' },
};

function BuyVoucherScreen() {
  const t = useT();
  const { wallet, refreshWallet } = useAuth();
  const partner = usePartnerRole();
  const { config, loading: cfgLoading, error: cfgErr, reload: reloadCfg } = useVoucherConfig();
  const [tab, setTab] = useState<Tab>('buy');
  const [rows, setRows] = useState<VoucherPurchase[] | null>(null);
  const [rowsErr, setRowsErr] = useState<string | null>(null);
  const [codes, setCodes] = useState<VoucherCode[] | null>(null);
  const [codesErr, setCodesErr] = useState<string | null>(null);
  const [opened, setOpened] = useState<{ purchase: VoucherPurchase; code: VoucherCode | null } | null>(null);

  const balance = Number(wallet?.balance ?? 0) || 0;
  const cap = partner ? Number(config.cap_partner) : Number(config.cap_customer);
  const room = Math.max(0, cap - balance);

  const loadRows = useCallback(async () => {
    try { setRows(await fetchMyVoucherPurchases()); setRowsErr(null); }
    catch (e) { if (isMissingRpc(e)) { setRows([]); setRowsErr(null); } else { setRowsErr(voucherError(e)); setRows((r) => r ?? []); } }
  }, []);
  const loadCodes = useCallback(async () => {
    try { setCodes((await myVoucherCodes()) ?? []); setCodesErr(null); }
    catch (e) { if (isMissingRpc(e)) { setCodes([]); setCodesErr(null); } else { setCodesErr(voucherError(e)); setCodes((c) => c ?? []); } }
  }, []);
  const reload = useCallback(async () => { await Promise.all([reloadCfg(), loadRows(), loadCodes(), refreshWallet()]); }, [reloadCfg, loadRows, loadCodes, refreshWallet]);
  useFocusEffect(useCallback(() => { void reload(); }, [reload]));

  const upsertPurchase = (p: VoucherPurchase) => setRows((r) => {
    const list = r ?? [];
    const i = list.findIndex((x) => x.id === p.id);
    if (i < 0) return [p, ...list];
    const next = list.slice(); next[i] = { ...list[i], ...p }; return next;
  });
  const codeOfPurchase = (purchaseId: string) => codes?.find((c) => c.purchase_id === purchaseId) ?? null;
  const openPurchase = (p: VoucherPurchase) => setOpened({ purchase: p, code: codeOfPurchase(p.id) });

  useEffect(() => { if (opened?.purchase.status === 'issued') void refreshWallet(); }, [opened?.purchase.status, refreshWallet]);

  if (opened) {
    const live = rows?.find((x) => x.id === opened.purchase.id) ?? opened.purchase;
    return (
      <Screen title={t('v5_your_code')} back maxWidth={560}>
        <PurchaseDetail
          p={live}
          code={codeOfPurchase(live.id) ?? opened.code}
          onChange={(p) => { upsertPurchase(p); void loadRows(); void loadCodes(); }}
          onClose={() => { setOpened(null); setTab('codes'); }}
          onReload={async () => { await Promise.all([loadRows(), loadCodes()]); }}
        />
      </Screen>
    );
  }

  return (
    <Screen title={t('v5_buy_voucher')} back maxWidth={560}>
      <View style={{ gap: 16 }}>
        <Entrance index={0}>
          <CapCard balance={balance} cap={cap} room={room} partner={partner} />
        </Entrance>

        <Entrance index={0}>
          <View style={s.tabs} accessibilityRole="tablist">
            {([['buy', t('v5_buy_tab')], ['codes', t('v5_my_codes')], ['redeem', t('v5_redeem_code')]] as [Tab, string][]).map(([k, label]) => (
              <PressableScale key={k} onPress={() => setTab(k)} haptic={false} scaleTo={0.98} accessibilityRole="tab" accessibilityState={{ selected: tab === k }}
                style={[s.tab, tab === k && s.tabOn]}>
                <Text style={[s.tabText, tab === k && { color: colors.primary }]} numberOfLines={1}>{label}</Text>
              </PressableScale>
            ))}
          </View>
        </Entrance>

        {tab === 'buy' ? (
          cfgLoading && !config.banks.length ? (
            <View style={{ gap: 12 }}><Skeleton height={120} radius={radius.lg} /><Skeleton height={180} radius={radius.lg} /></View>
          ) : cfgErr && !config.banks.length ? (
            <Entrance index={1}><ErrorCard text={cfgErr} onRetry={reloadCfg} /></Entrance>
          ) : !config.purchase_enabled ? (
            <Entrance index={1}><NotOpenCard /></Entrance>
          ) : (
            <PurchaseForm
              denominations={config.denominations}
              min={Number(config.min)}
              max={Number(config.max)}
              ttlHours={Number(config.code_ttl_hours)}
              room={room}
              banks={config.banks}
              onRetryBanks={reloadCfg}
              onCreated={(r) => { upsertPurchase(r.purchase); setCodes((c) => [r.code, ...(c ?? []).filter((x) => x.id !== r.code.id)]); setOpened({ purchase: r.purchase, code: r.code }); void loadRows(); void loadCodes(); }}
            />
          )
        ) : tab === 'codes' ? (
          <CodesTab codes={codes} err={codesErr} rows={rows} onReload={() => { void loadCodes(); void loadRows(); }} onOpen={openPurchase}
            onRedeemed={() => { void refreshWallet(); void loadCodes(); }} />
        ) : (
          <RedeemTab room={room} onRedeemed={() => { void refreshWallet(); void loadCodes(); setTab('codes'); }} />
        )}

        <Entrance index={3}>
          <Text style={[font.tiny, { color: colors.textSecondary }]}>{t('v5_closed_loop_note', { days: Math.max(1, Math.round(Number(config.code_ttl_hours || 720) / 24)) })}</Text>
        </Entrance>
      </View>
    </Screen>
  );
}

/* ─────────────── Kartu saldo & cap ─────────────── */

function CapCard({ balance, cap, room, partner }: { balance: number; cap: number; room: number; partner: boolean }) {
  const t = useT();
  const pct = cap > 0 ? Math.min(100, Math.round((balance / cap) * 100)) : 0;
  return (
    <Card>
      <Row between style={{ alignItems: 'flex-start', gap: 8 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={font.label}>Saldo AntarVoucher{partner ? ' (mitra)' : ''}</Text>
          <Text style={{ fontSize: 24, fontWeight: '700', color: colors.text, marginTop: 2 }}>{rupiah(balance)}</Text>
        </View>
        <Badge text={t('v5_balance_cap', { cap: rupiah(cap) })} color={colors.textSecondary} />
      </Row>
      <View style={s.barBg} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: pct }}>
        <View style={[s.barFg, { width: `${pct}%` as never, backgroundColor: pct >= 90 ? colors.danger : pct >= 70 ? colors.warning : colors.primary }]} />
      </View>
      <Text style={[font.tiny, { marginTop: 6, color: room > 0 ? colors.textSecondary : colors.danger }]}>
        {room > 0 ? t('v5_room_left', { room: rupiah(room) }) : t('v5_cap_reached')}
      </Text>
    </Card>
  );
}

/* ─────────────── Belum dibuka ─────────────── */

function NotOpenCard() {
  const t = useT();
  return (
    <Card>
      <View style={{ gap: 12 }}>
        <Row gap={12} style={{ alignItems: 'flex-start' }}>
          <View style={[s.bigIcon, { backgroundColor: colors.accentLight }]}><Ionicons name="business-outline" size={24} color={colors.warning} /></View>
          <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
            <Text style={font.h3}>{t('v5_purchase_closed')}</Text>
            <Text style={font.small}>{t('v5_purchase_closed_text')}</Text>
          </View>
        </Row>
        <Row gap={8} style={{ alignItems: 'flex-start' }}>
          <Ionicons name="shield-checkmark-outline" size={16} color={colors.danger} style={{ marginTop: 2 }} />
          <Text style={[font.tiny, { flex: 1, color: colors.textSecondary }]}>Jangan transfer ke rekening mana pun yang dikirim lewat chat, telepon, atau media sosial. Rekening resmi hanya akan tampil di aplikasi ini.</Text>
        </Row>
      </View>
    </Card>
  );
}

function ErrorCard({ text, onRetry, compact }: { text: string; onRetry: () => void; compact?: boolean }) {
  return (
    <View style={[s.err, compact && { padding: 10 }]}>
      <Ionicons name="cloud-offline-outline" size={20} color={colors.danger} />
      <Text style={[font.small, { color: colors.danger, flex: 1, minWidth: 0 }]}>{text}</Text>
      <Button title="Coba lagi" size="sm" variant="ghost" icon="refresh" onPress={onRetry} />
    </View>
  );
}

/* ─────────────── Formulir pembelian ─────────────── */

function PurchaseForm({ denominations, min, max, ttlHours, room, banks, onRetryBanks, onCreated }: {
  denominations: number[]; min: number; max: number; ttlHours: number; room: number; banks: VoucherBankAccount[];
  onRetryBanks: () => void; onCreated: (r: VoucherPurchaseWithCode) => void;
}) {
  const t = useT();
  const presets = useMemo(() => (denominations ?? []).map(Number).filter((p) => Number.isFinite(p) && p >= min && p <= max), [denominations, min, max]);
  const [amount, setAmount] = useState(String(presets.find((p) => p >= 100000) ?? presets[0] ?? min));
  const [bankCode, setBankCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  // Kunci idempotensi dipakai ulang selama (nominal, bank) sama → ketuk ganda / kirim ulang aman.
  const idem = useRef<{ sig: string; key: string } | null>(null);
  const n = Number(amount.replace(/\D/g, '')) || 0;
  const baseErr = validateNominal(n, min, max, rupiah);
  const err = baseErr ?? (n > room ? `Melebihi sisa ruang saldo (${rupiah(room)}). Gunakan saldo dulu atau pilih nominal lebih kecil.` : null);

  useEffect(() => {
    if (banks.length && !banks.some((b) => b.bank_code === bankCode)) setBankCode(banks[0].bank_code);
  }, [banks]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    setTouched(true);
    if (busy) return;
    if (err) return toast.error(err);
    if (!bankCode) return toast.error('Pilih bank tujuan');
    const sig = `${n}|${bankCode}`;
    if (!idem.current || idem.current.sig !== sig) idem.current = { sig, key: newIdempotencyKey() };
    setBusy(true);
    try {
      const r = await voucherCodePurchaseCreate(n, bankCode, idem.current.key);
      if (!r?.purchase || !r?.code) throw new Error('Balasan server tidak lengkap (purchase/code). Muat ulang dan coba lagi.');
      idem.current = null;   // instruksi terbentuk → pembelian berikutnya memakai kunci baru
      if (r.purchase.idempotent) toast.show('Instruksi transfer yang sama ditampilkan kembali');
      onCreated(r);
    } catch (e) { toast.error(voucherError(e)); }
    finally { setBusy(false); }
  };

  return (
    <>
      <Entrance index={1}>
        <Card>
          <Text style={font.label}>{t('v5_pick_nominal')}</Text>
          <Row gap={8} style={{ flexWrap: 'wrap', marginTop: 10 }}>
            {presets.map((p) => <Chip key={p} label={p >= 1000000 ? `${p / 1000000} jt` : `${p / 1000} rb`} active={n === p} onPress={() => { setAmount(String(p)); setTouched(true); }} />)}
          </Row>
          <Input
            value={amount}
            onChangeText={(v) => setAmount(v.replace(/\D/g, '').slice(0, 10))}
            onBlur={() => setTouched(true)}
            keyboardType="number-pad"
            icon="cash-outline"
            placeholder={t('v5_custom_nominal')}
            accessibilityLabel="Nominal voucher"
            error={touched && err ? err : null}
            containerStyle={{ marginTop: 12 }}
          />
          <Text style={[font.tiny, { marginTop: 6 }]}>{rupiah(min)} – {rupiah(max)}, kelipatan Rp1.000. {n > 0 && !err ? `Saldo bertambah ${rupiah(n)} setelah transfer dicocokkan — tanpa biaya tambahan.` : ''}</Text>
        </Card>
      </Entrance>

      <Entrance index={2}>
        <Card>
          <Text style={font.label}>{t('v5_pick_bank')}</Text>
          {banks.length === 0 ? (
            <View style={{ marginTop: 10 }}><ErrorCard text="Rekening resmi belum tersedia. Coba lagi nanti." onRetry={onRetryBanks} compact /></View>
          ) : (
            <View style={{ gap: 8, marginTop: 10 }}>
              {banks.map((b) => {
                const on = b.bank_code === bankCode;
                return (
                  <PressableScale key={b.bank_code} onPress={() => setBankCode(b.bank_code)} scaleTo={0.98} haptic={false}
                    accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={`Bank ${b.bank_name}`}
                    style={[s.bank, on && { borderColor: colors.primary, backgroundColor: colors.primaryLight }]}>
                    <BankLogo code={b.bank_code} name={b.bank_name} active={on} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={{ fontWeight: '700', color: colors.text, fontSize: 16 }} numberOfLines={2}>{b.bank_name}</Text>
                      <Text style={font.tiny} numberOfLines={2}>a.n. {b.account_name}</Text>
                    </View>
                    <Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={20} color={on ? colors.primary : colors.textMuted} />
                  </PressableScale>
                );
              })}
            </View>
          )}
          <Text style={[font.tiny, { marginTop: 10 }]}>Nomor rekening lengkap & kode voucher muncul setelah instruksi dibuat. Kode berlaku {Math.max(1, Math.round(ttlHours / 24))} hari.</Text>
        </Card>
      </Entrance>

      <Entrance index={3}>
        <View style={{ gap: 10 }}>
          <Notice />
          <Button title={t('v5_create_code')} icon="ticket-outline" size="lg" loading={busy} disabled={!!err || !bankCode || !banks.length} onPress={submit} />
        </View>
      </Entrance>
    </>
  );
}

function Notice() {
  return (
    <View style={s.notice}>
      <Row gap={8} style={{ alignItems: 'flex-start' }}>
        <Ionicons name="information-circle" size={20} color={colors.info} />
        <Text style={[font.small, { flex: 1, minWidth: 0, color: colors.text }]}>Saldo bertambah setelah tim Finance mencocokkan dana masuk di rekening resmi. Screenshot bukti transfer tidak diperlukan dan tidak menambah saldo.</Text>
      </Row>
      <Row gap={8} style={{ alignItems: 'flex-start' }}>
        <Ionicons name="warning" size={20} color={colors.danger} />
        <Text style={[font.small, { flex: 1, minWidth: 0, color: colors.text, fontWeight: '600' }]}>Jangan transfer ke rekening selain yang tertera di aplikasi.</Text>
      </Row>
    </View>
  );
}

/* ─────────────── Tab: Kode saya ─────────────── */

function CodesTab({ codes, err, rows, onReload, onOpen, onRedeemed }: {
  codes: VoucherCode[] | null; err: string | null; rows: VoucherPurchase[] | null; onReload: () => void;
  onOpen: (p: VoucherPurchase) => void; onRedeemed: () => void;
}) {
  const t = useT();
  const [busyId, setBusyId] = useState<string | null>(null);
  const redeem = async (c: VoucherCode) => {
    if (busyId) return;
    setBusyId(c.id);
    try { await voucherCodeRedeem(c.code); toast.success(t('v5_redeem_ok', { amount: rupiah(c.nominal) })); onRedeemed(); }
    catch (e) { toast.error(voucherError(e)); onReload(); }
    finally { setBusyId(null); }
  };
  // Pembelian lama (0112) yang belum punya kode (dibuat sebelum v5) tetap bisa dibuka instruksinya.
  const legacy = (rows ?? []).filter((p) => !(codes ?? []).some((c) => c.purchase_id === p.id) && ['awaiting_transfer', 'submitted', 'matched', 'amount_mismatch'].includes(p.status));
  return (
    <View style={{ gap: 10 }}>
      <Row between>
        <Text style={[font.label, { flexShrink: 1 }]}>{t('v5_my_codes')}</Text>
        <PressableScale onPress={onReload} haptic={false} accessibilityRole="button" accessibilityLabel="Muat ulang daftar kode" style={s.iconBtn}>
          <Ionicons name="refresh" size={20} color={colors.primary} />
        </PressableScale>
      </Row>
      {codes === null ? (
        <View style={{ gap: 10 }}>{[0, 1].map((i) => <Skeleton key={i} height={84} radius={radius.lg} />)}</View>
      ) : (
        <>
          {err ? <ErrorCard text={err} onRetry={onReload} compact /> : null}
          {codes.length === 0 && legacy.length === 0 && !err ? (
            <Empty icon="ticket-outline" title={t('v5_no_codes')} subtitle={t('v5_no_codes_sub')} />
          ) : null}
          {codes.map((c) => {
            const meta = CODE_STATUS[c.status] ?? CODE_STATUS.void;
            const purchase = c.purchase_id ? rows?.find((p) => p.id === c.purchase_id) ?? null : null;
            const openable = c.status === 'pending_payment' && !!purchase;
            return (
              <PressableScale key={c.id} disabled={!openable} onPress={() => purchase && onOpen(purchase)} scaleTo={0.98} haptic={false}
                accessibilityRole={openable ? 'button' : undefined} accessibilityLabel={`Kode ${c.code}, ${t(meta.key)}`} style={s.item}>
                <Row gap={12} style={{ alignItems: 'flex-start' }}>
                  <View style={[s.rowIcon, { backgroundColor: meta.color + '1A' }]}><Ionicons name={meta.icon as never} size={20} color={meta.color} /></View>
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <Text style={{ fontWeight: '700', color: colors.text, fontSize: 16, letterSpacing: 0.5 }} selectable>{formatVoucherCode(c.code)}</Text>
                    <Text style={[font.small, { color: colors.text }]}>Voucher <Text style={{ fontWeight: '700' }}>{rupiah(c.nominal)}</Text>{purchase ? ` · transfer ${rupiah(purchase.transfer_amount)}` : ''}</Text>
                    <Text style={font.tiny} numberOfLines={2}>
                      {c.status === 'redeemed' && c.redeemed_at ? `${t('v5_redeemed_at')} ${formatDate(c.redeemed_at)}`
                        : c.status === 'issued' && c.expires_at ? `${t('v5_expires')} ${formatDate(c.expires_at)}`
                        : formatDate(c.created_at)}
                    </Text>
                    <Row gap={6} style={{ marginTop: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                      <Badge text={t(meta.key)} color={meta.color} />
                      {c.status === 'issued' ? <Button title={t('v5_redeem_btn')} size="sm" loading={busyId === c.id} disabled={!!busyId && busyId !== c.id} onPress={() => redeem(c)} /> : null}
                    </Row>
                  </View>
                  <Row gap={4} style={{ marginTop: 10 }}>
                    <PressableScale onPress={() => copy(formatVoucherCode(c.code), 'Kode voucher')} haptic={false} accessibilityRole="button" accessibilityLabel={`Salin kode ${c.code}`} style={s.iconBtn}>
                      <Ionicons name="copy-outline" size={20} color={colors.primary} />
                    </PressableScale>
                    {openable ? <Ionicons name="chevron-forward" size={20} color={colors.textMuted} style={{ marginTop: 12 }} /> : null}
                  </Row>
                </Row>
              </PressableScale>
            );
          })}
          {legacy.map((p) => (
            <PressableScale key={p.id} onPress={() => onOpen(p)} scaleTo={0.98} haptic={false} accessibilityRole="button" accessibilityLabel={`Pembelian ${p.reference}, ${voucherStatusLabel(p.status)}`} style={s.item}>
              <Row gap={12} style={{ alignItems: 'flex-start' }}>
                <View style={[s.rowIcon, { backgroundColor: voucherStatusColor(p.status) + '1A' }]}><Ionicons name={(voucherStatusMeta[p.status]?.icon ?? 'receipt-outline') as never} size={20} color={voucherStatusColor(p.status)} /></View>
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <Text style={{ fontWeight: '700', color: colors.text, fontSize: 16 }} numberOfLines={2}>Voucher {rupiah(p.nominal)}</Text>
                  <Text style={[font.small, { color: colors.text }]}>Transfer <Text style={{ fontWeight: '700' }}>{rupiah(p.transfer_amount)}</Text></Text>
                  <Text style={font.tiny} numberOfLines={2}>{p.reference}{p.bank_name ? ` · ${p.bank_name}` : ''}</Text>
                  <View style={{ flexDirection: 'row', marginTop: 4 }}><Badge text={voucherStatusLabel(p.status)} color={voucherStatusColor(p.status)} /></View>
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.textMuted} style={{ marginTop: 10 }} />
              </Row>
            </PressableScale>
          ))}
        </>
      )}
    </View>
  );
}

/* ─────────────── Tab: Tukar kode ─────────────── */

function RedeemTab({ room, onRedeemed }: { room: number; onRedeemed: () => void }) {
  const t = useT();
  const [raw, setRaw] = useState('');
  const [busy, setBusy] = useState(false);
  const code = formatVoucherCode(raw);
  const complete = /^AKV-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code);
  const submit = async () => {
    if (busy) return;
    if (!complete) return toast.error('Kode belum lengkap (AKV-XXXX-XXXX-XXXX)');
    setBusy(true);
    try {
      await voucherCodeRedeem(code);
      toast.success('Kode ditukar — saldo bertambah');
      setRaw('');
      onRedeemed();
    } catch (e) { toast.error(voucherError(e)); }
    finally { setBusy(false); }
  };
  return (
    <Entrance index={1}>
      <Card>
        <View style={{ gap: 10 }}>
          <Text style={font.label}>{t('v5_redeem_code')}</Text>
          <Text style={font.small}>{t('v5_redeem_hint')}</Text>
          <Input
            value={raw}
            onChangeText={(v) => setRaw(v.toUpperCase().slice(0, 19))}
            autoCapitalize="characters"
            autoCorrect={false}
            icon="ticket-outline"
            placeholder="AKV-XXXX-XXXX-XXXX"
            accessibilityLabel="Kode voucher"
            onSubmitEditing={submit}
          />
          {raw ? <Text style={[font.tiny, { letterSpacing: 0.5 }]}>Dibaca sebagai: <Text style={{ fontWeight: '700', color: colors.text }}>{code}</Text></Text> : null}
          {room <= 0 ? <Text style={[font.tiny, { color: colors.danger }]}>{t('v5_cap_reached')}</Text> : null}
          <Button title={t('v5_redeem_btn')} icon="checkmark" loading={busy} disabled={!complete || room <= 0} onPress={submit} />
          <Text style={font.tiny}>Kode hanya bisa ditukar sekali, maksimal 10 percobaan per jam. Nominal masuk ke saldo AntarVoucher Anda.</Text>
        </View>
      </Card>
    </Entrance>
  );
}

/* ─────────────── Detail / instruksi transfer + kode ─────────────── */

function PurchaseDetail({ p, code, onChange, onClose, onReload }: {
  p: VoucherPurchase; code: VoucherCode | null; onChange: (p: VoucherPurchase) => void; onClose: () => void; onReload: () => Promise<void>;
}) {
  const t = useT();
  const live = p.status === 'awaiting_transfer' || p.status === 'submitted';
  const now = useNow(live);
  const left = new Date(p.expires_at).getTime() - now;
  const instr = showsInstructions(p, now);
  const meta = voucherStatusMeta[p.status];
  const color = voucherStatusColor(p.status);
  const amt = splitTransferAmount(p.transfer_amount);
  const [mode, setMode] = useState<'none' | 'sent' | 'dispute'>('none');
  const [senderName, setSenderName] = useState(p.sender_name ?? '');
  const [senderBank, setSenderBank] = useState(p.sender_bank ?? '');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<null | 'sent' | 'cancel' | 'dispute'>(null);

  const expiredLocally = live && left <= 0;
  const hasAccount = !!p.account_no;
  const codeMeta = code ? (CODE_STATUS[code.status] ?? CODE_STATUS.void) : null;
  const codeText = code ? formatVoucherCode(code.code) : null;

  const run = async (kind: 'sent' | 'cancel' | 'dispute', fn: () => Promise<VoucherPurchase>, ok: string) => {
    if (busy) return;
    setBusy(kind);
    try { const r = await fn(); onChange({ ...p, ...r }); setMode('none'); toast.success(ok); }
    catch (e) { toast.error(voucherError(e)); if (String((e as Error).message).includes('VOUCHER_STATE')) void onReload(); }
    finally { setBusy(null); }
  };

  const steps = useMemo(() => [
    'Buka m-banking / ATM / internet banking Anda.',
    `Transfer ke ${p.bank_name ?? 'bank tujuan'}${p.account_no ? ` ${p.account_no}` : ''} a.n. ${p.account_name ?? 'PT Antar Kita Indonesia'}.`,
    `Masukkan nominal PERSIS ${rupiah(p.transfer_amount)} — jangan dibulatkan.`,
    `Tulis kode ${codeText ?? p.reference} di berita/catatan transfer (bila tersedia).`,
    'Tekan "Saya sudah transfer" agar pencocokan lebih cepat. Saldo masuk setelah dana dicocokkan.',
  ], [p.bank_name, p.account_no, p.account_name, p.transfer_amount, p.reference, codeText]);

  return (
    <View style={{ gap: 16 }}>
      {code && codeText && codeMeta ? (
        <Entrance index={0}>
          <Card style={{ borderColor: colors.primary + '55', borderWidth: 1.5 }}>
            <View style={{ gap: 8 }}>
              <Row between style={{ gap: 8 }}>
                <Text style={font.label}>{t('v5_your_code')}</Text>
                <Badge text={t(codeMeta.key)} color={codeMeta.color} />
              </Row>
              <PressableScale onPress={() => copy(codeText, 'Kode voucher')} scaleTo={0.98} haptic={false} accessibilityRole="button" accessibilityLabel={`Salin kode voucher ${codeText}`} style={s.codeBox}>
                <Text style={s.codeText} selectable numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{codeText}</Text>
                <Row gap={4}><Ionicons name="copy-outline" size={20} color={colors.primary} /><Text style={{ color: colors.primary, fontWeight: '700', fontSize: 14 }}>{t('copy')}</Text></Row>
              </PressableScale>
              <Text style={font.tiny}>
                {code.status === 'pending_payment' ? `Voucher ${rupiah(code.nominal)} aktif setelah transfer dicocokkan Finance; saldo masuk otomatis.`
                  : code.status === 'issued' ? `Voucher ${rupiah(code.nominal)} sudah terbit${code.expires_at ? ` — berlaku s.d. ${formatDate(code.expires_at)}` : ''}. Tukarkan di tab "${t('v5_my_codes')}".`
                  : code.status === 'redeemed' ? `Voucher ${rupiah(code.nominal)} sudah masuk ke saldo${code.redeemed_at ? ` (${formatDate(code.redeemed_at)})` : ''}.`
                  : `Kode ${t(codeMeta.key).toLowerCase()}.`}
              </Text>
            </View>
          </Card>
        </Entrance>
      ) : null}

      <Entrance index={1}>
        <Card>
          <View style={{ gap: 10 }}>
            <Row gap={10} style={{ alignItems: 'flex-start' }}>
              <View style={[s.rowIcon, { backgroundColor: color + '1A' }]}><Ionicons name={(meta?.icon ?? 'receipt-outline') as never} size={20} color={color} /></View>
              <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                <View style={{ flexDirection: 'row' }}><Badge text={expiredLocally ? 'Waktu transfer habis' : voucherStatusLabel(p.status)} color={expiredLocally ? colors.textSecondary : color} /></View>
                <Text style={font.small}>{expiredLocally ? 'Batas waktu transfer sudah lewat. Bila Anda sudah transfer, laporkan masalah agar dana ditelusuri.' : meta?.hint}</Text>
              </View>
            </Row>
            {live && !expiredLocally ? (
              <View style={s.countdown}>
                <Ionicons name="time-outline" size={20} color={left < 3600000 ? colors.danger : colors.warning} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={font.tiny}>Sisa waktu transfer</Text>
                  <Text style={{ fontSize: 18, fontWeight: '700', color: left < 3600000 ? colors.danger : colors.text }} accessibilityLiveRegion="polite">{formatCountdown(left)}</Text>
                  <Text style={font.tiny}>s.d. {formatDate(p.expires_at)}</Text>
                </View>
              </View>
            ) : null}
            {p.status === 'issued' && p.issued_amount ? <Text style={[font.small, { color: colors.success, fontWeight: '700' }]}>+{rupiah(p.issued_amount)} masuk ke saldo AntarVoucher</Text> : null}
            {p.status === 'amount_mismatch' && p.received_amount ? <Text style={font.small}>Dana diterima {rupiah(p.received_amount)} (seharusnya {rupiah(p.transfer_amount)}).</Text> : null}
            {p.refund_amount && ['refund_requested', 'refund_pending', 'refunded'].includes(p.status) ? <Text style={font.small}>Nominal pengembalian {rupiah(p.refund_amount)}.</Text> : null}
            {p.reason && ['rejected', 'disputed', 'cancelled'].includes(p.status) ? <Text style={font.tiny}>Catatan: {p.reason}</Text> : null}
          </View>
        </Card>
      </Entrance>

      <Entrance index={2}>
        <Card>
          <View style={{ gap: 14 }}>
            {/* Berita/catatan transfer: kode voucher (v5) atau kode referensi (pembelian lama 0112) — membantu Finance mencocokkan */}
            {!code ? <CopyField label="Kode referensi (berita transfer)" value={p.reference} what="Kode referensi" />
              : instr ? <CopyField label="Berita / catatan transfer (bila tersedia)" value={codeText ?? p.reference} what="Berita transfer" /> : null}

            {instr ? (
              <>
                <View style={{ gap: 6 }}>
                  <Text style={font.label}>Bank tujuan</Text>
                  <Row gap={10}>
                    <BankLogo code={p.bank_code} name={p.bank_name} size={40} />
                    <Text style={{ flex: 1, minWidth: 0, fontSize: 16, fontWeight: '700', color: colors.text }} numberOfLines={2}>{p.bank_name ?? '—'}</Text>
                  </Row>
                </View>
                {hasAccount ? (
                  <CopyField label="Nomor rekening" value={p.account_no!} what="Nomor rekening" big />
                ) : (
                  <Text style={[font.small, { color: colors.danger }]}>Rekening ini sedang tidak tersedia. Jangan transfer dulu — batalkan dan buat instruksi baru, atau hubungi CS.</Text>
                )}
                {p.account_name ? (
                  <View style={{ gap: 6 }}>
                    <Text style={font.label}>Atas nama</Text>
                    <Text style={{ fontSize: 16, fontWeight: '600', color: colors.text }} selectable>{p.account_name}</Text>
                  </View>
                ) : null}
                <Row gap={8} style={{ alignItems: 'flex-start' }}>
                  <Ionicons name="shield-checkmark" size={16} color={colors.danger} style={{ marginTop: 2 }} />
                  <Text style={[font.tiny, { flex: 1, minWidth: 0, color: colors.danger, fontWeight: '600' }]}>Hanya transfer ke rekening yang tampil di aplikasi ini. Pastikan nama bank, nomor rekening, dan atas nama sama persis sebelum mengirim.</Text>
                </Row>
              </>
            ) : p.bank_name ? (
              <View style={{ gap: 6 }}>
                <Text style={font.label}>Bank tujuan</Text>
                <Text style={{ fontSize: 16, fontWeight: '600', color: colors.text }}>{p.bank_name}{p.account_name ? ` · a.n. ${p.account_name}` : ''}</Text>
              </View>
            ) : null}

            <View style={{ gap: 6 }}>
              <Text style={font.label}>{instr ? 'Jumlah yang harus ditransfer' : 'Jumlah transfer'}</Text>
              <PressableScale onPress={() => copy(String(p.transfer_amount), 'Nominal transfer')} scaleTo={0.98} haptic={false}
                accessibilityRole="button" accessibilityLabel={`Salin nominal transfer ${rupiah(p.transfer_amount)}`} style={s.amountBox}>
                <Text style={s.amount} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
                  {amt.head}<Text style={s.amountTail}>{amt.tail}</Text>
                </Text>
                <Ionicons name="copy-outline" size={20} color={colors.primary} />
              </PressableScale>
              <Row gap={6} style={{ alignItems: 'flex-start' }}>
                <View style={s.codeDot} />
                <Text style={[font.tiny, { flex: 1, color: colors.textSecondary }]}>
                  {t('v5_transfer_exact')}. Voucher {rupiah(p.nominal)} + kode unik {p.unique_code} = {rupiah(p.transfer_amount)}; kode unik ikut masuk ke saldo Anda.
                </Text>
              </Row>
            </View>
          </View>
        </Card>
      </Entrance>

      {instr ? (
        <Entrance index={3}>
          <Card>
            <Text style={font.label}>Langkah transfer</Text>
            <View style={{ gap: 8, marginTop: 10 }}>
              {steps.map((txt, i) => (
                <Row key={i} gap={10} style={{ alignItems: 'flex-start' }}>
                  <View style={s.step}><Text style={{ color: colors.primary, fontWeight: '700', fontSize: 12 }}>{i + 1}</Text></View>
                  <Text style={[font.small, { flex: 1, minWidth: 0, color: colors.text }]}>{txt}</Text>
                </Row>
              ))}
            </View>
          </Card>
        </Entrance>
      ) : null}

      {(live || p.status === 'amount_mismatch') ? <Entrance index={4}><Notice /></Entrance> : null}

      <Entrance index={5}>
        <View style={{ gap: 10 }}>
          {mode === 'sent' ? (
            <Card>
              <View style={{ gap: 10 }}>
                <Text style={font.h3}>Konfirmasi transfer</Text>
                <Text style={font.small}>Opsional: isi nama & bank pengirim agar tim Finance lebih cepat mencocokkan. Ini tidak langsung menambah saldo.</Text>
                <Input label="Nama pemilik rekening pengirim" value={senderName} onChangeText={setSenderName} maxLength={80} autoCapitalize="words" icon="person-outline" />
                <Input label="Bank pengirim" value={senderBank} onChangeText={setSenderBank} maxLength={40} placeholder="mis. BCA, Mandiri, BRI" icon="business-outline" />
                <Button title="Kirim konfirmasi" icon="checkmark" loading={busy === 'sent'} disabled={!!busy && busy !== 'sent'} onPress={() => run('sent', () => markVoucherSent(p.id, senderName, senderBank), 'Terima kasih — kami akan mencocokkan dana Anda')} />
                <Button title="Batal" variant="ghost" disabled={!!busy} onPress={() => setMode('none')} />
              </View>
            </Card>
          ) : mode === 'dispute' ? (
            <Card>
              <View style={{ gap: 10 }}>
                <Text style={font.h3}>Laporkan masalah</Text>
                <Text style={font.small}>Ceritakan apa yang terjadi, mis. sudah transfer tapi saldo belum masuk, nominal salah, atau transfer ke rekening lain. Sertakan waktu transfer & bank pengirim.</Text>
                <Input value={reason} onChangeText={setReason} multiline maxLength={500} placeholder="Minimal 10 karakter" accessibilityLabel="Uraian masalah" error={reason.length > 0 && reason.trim().length < 10 ? 'Jelaskan minimal 10 karakter' : null} />
                <Button title="Kirim laporan" icon="send" color={colors.warning} disabled={reason.trim().length < 10 || (!!busy && busy !== 'dispute')} loading={busy === 'dispute'} onPress={() => run('dispute', () => disputeVoucherPurchase(p.id, reason), 'Laporan terkirim. Tim kami akan menghubungi Anda.')} />
                <Button title="Batal" variant="ghost" disabled={!!busy} onPress={() => setMode('none')} />
              </View>
            </Card>
          ) : (
            <>
              {canMarkSent(p, now) ? <Button title={p.status === 'submitted' ? 'Perbarui info pengirim' : t('v5_i_transferred')} icon="checkmark-done" size="lg" disabled={!!busy} onPress={() => setMode('sent')} /> : null}
              {canCancel(p) && !expiredLocally ? <Button title="Batalkan" variant="outline" color={colors.danger} icon="close" loading={busy === 'cancel'} disabled={!!busy && busy !== 'cancel'} onPress={() => run('cancel', () => cancelVoucherPurchase(p.id), 'Pembelian dibatalkan')} /> : null}
              {canDispute(p) ? <Button title="Laporkan masalah" variant="ghost" icon="flag-outline" color={colors.warning} disabled={!!busy} onPress={() => setMode('dispute')} /> : null}
            </>
          )}
          <Button title={t('v5_my_codes')} variant="secondary" icon="list-outline" disabled={!!busy} onPress={onClose} />
        </View>
      </Entrance>
    </View>
  );
}

function CopyField({ label, value, what, big }: { label: string; value: string; what: string; big?: boolean }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={font.label}>{label}</Text>
      <PressableScale onPress={() => copy(value, what)} scaleTo={0.98} haptic={false} accessibilityRole="button" accessibilityLabel={`Salin ${what.toLowerCase()} ${value}`} style={s.copyBox}>
        {/* Tanpa numberOfLines: nomor rekening TIDAK boleh terpotong "…". Bila tidak muat, tombol "Salin" turun ke baris berikutnya. */}
        <Text style={[{ flexGrow: 1, flexShrink: 0, maxWidth: '100%', color: colors.text, fontWeight: '700', letterSpacing: 0.5 }, { fontSize: big ? 20 : 16 }]} selectable>{value}</Text>
        <Row gap={4} style={{ marginLeft: 'auto' }}><Ionicons name="copy-outline" size={20} color={colors.primary} /><Text style={{ color: colors.primary, fontWeight: '700', fontSize: 14 }}>Salin</Text></Row>
      </PressableScale>
    </View>
  );
}

const s = StyleSheet.create({
  iconBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  bigIcon: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  tabs: { flexDirection: 'row', gap: 6, padding: 4, borderRadius: radius.lg, backgroundColor: colors.bgSoft },
  tab: { flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, paddingHorizontal: 6 },
  tabOn: { backgroundColor: '#fff', borderWidth: 1, borderColor: colors.primary + '44' },
  tabText: { fontWeight: '700', color: colors.textSecondary, fontSize: 13 },
  barBg: { height: 8, borderRadius: 4, backgroundColor: colors.bgSoft, overflow: 'hidden', marginTop: 10 },
  barFg: { height: 8, borderRadius: 4 },
  err: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, padding: 12, borderRadius: radius.md, backgroundColor: colors.dangerLight },
  bank: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, padding: 12, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, backgroundColor: '#fff' },
  notice: { gap: 10, padding: 12, borderRadius: radius.md, backgroundColor: colors.infoLight, borderWidth: 1, borderColor: colors.info + '33' },
  item: { padding: 12, borderRadius: radius.lg, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border },
  rowIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  countdown: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: radius.md, backgroundColor: colors.accentLight },
  copyBox: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, minHeight: 52, paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.sm, backgroundColor: colors.primaryLight },
  codeBox: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, minHeight: 64, paddingHorizontal: 14, paddingVertical: 12, borderRadius: radius.md, backgroundColor: colors.primaryLight, borderWidth: 1.5, borderColor: colors.primary + '44' },
  codeText: { flexGrow: 1, flexShrink: 1, minWidth: 0, fontSize: 26, fontWeight: '700', color: colors.text, letterSpacing: 1.5, fontVariant: ['tabular-nums'] },
  amountBox: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 60, paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.sm, backgroundColor: colors.primaryLight, borderWidth: 1.5, borderColor: colors.primary + '44' },
  amount: { flex: 1, minWidth: 0, fontSize: 28, fontWeight: '700', color: colors.text, letterSpacing: 0.3 },
  amountTail: { color: colors.danger, backgroundColor: colors.accentLight, textDecorationLine: 'underline' },
  codeDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.danger, marginTop: 3 },
  step: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
});

/** Build Google Play tanpa dompet (EXPO_PUBLIC_WALLET_UI=off) → rute ini diganti layar informasi. */
export default function BuyVoucher() {
  if (!WALLET_UI) return <FeatureUnavailable title="Beli AntarVoucher" text="Fitur saldo belum tersedia di aplikasi versi Play Store. Pembayaran tunai tetap bisa dipakai." />;
  return <BuyVoucherScreen />;
}
