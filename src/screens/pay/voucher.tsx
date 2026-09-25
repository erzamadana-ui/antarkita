// Beli AntarVoucher (`/pay/voucher`) — transfer ke rekening resmi PT Antar Kita Indonesia (migrasi 0112).
//  • Status fitur dari `voucher_status_public()`; rekening HANYA dari `voucher_bank_accounts_public()` (terverifikasi
//    Finance + Legal). Bila pembelian belum dibuka, TIDAK ada nomor rekening yang ditampilkan.
//  • `voucher_purchase_create` memakai kunci idempotensi yang sama selama isian formulir tidak berubah → ketuk ganda /
//    kirim ulang saat jaringan putus tidak membuat dua instruksi.
//  • "Saya sudah transfer" (`voucher_purchase_mark_sent`) hanya info bantu pencocokan — saldo bertambah setelah Finance
//    mencocokkan mutasi bank. Screenshot tidak diminta dan tidak menambah saldo.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Screen, Card, Row, Input, Button, Chip, Badge, Empty, toast } from '@/components/ui';
import { Entrance, PressableScale, Skeleton } from '@/components/motion';
import { useAuth } from '@/store/auth';
import { colors, font, radius } from '@/lib/theme';
import { rupiah, formatDate } from '@/lib/format';
import {
  VOUCHER_DEFAULTS, VOUCHER_PRESETS, voucherStatusMeta, voucherStatusLabel, voucherStatusColor, canMarkSent, canCancel, canDispute,
  showsInstructions, newIdempotencyKey, formatCountdown, splitTransferAmount, validateNominal, voucherError, isMissingRpc,
  fetchVoucherStatus, fetchVoucherBanks, fetchMyVoucherPurchases, createVoucherPurchase, markVoucherSent, cancelVoucherPurchase,
  disputeVoucherPurchase, type VoucherStatusPublic, type VoucherBankAccount, type VoucherPurchase,
} from '@/lib/voucher';

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

export default function BuyVoucher() {
  const router = useRouter();
  const refreshWallet = useAuth((st) => st.refreshWallet);
  const [status, setStatus] = useState<VoucherStatusPublic | null>(null);
  const [statusErr, setStatusErr] = useState<string | null>(null);
  const [banks, setBanks] = useState<VoucherBankAccount[] | null>(null);
  const [banksErr, setBanksErr] = useState<string | null>(null);
  const [rows, setRows] = useState<VoucherPurchase[] | null>(null);
  const [rowsErr, setRowsErr] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const st = await fetchVoucherStatus();
      setStatus(st); setStatusErr(null);
      if (st?.purchase_enabled) {
        try { setBanks(await fetchVoucherBanks()); setBanksErr(null); } catch (e) { setBanksErr(voucherError(e)); setBanks((b) => b ?? []); }
      } else setBanks([]);
    } catch (e) {
      // Server lama (sebelum 0112): perlakukan sebagai "belum dibuka", bukan galat.
      if (isMissingRpc(e)) { setStatus({ brand: 'AntarVoucher', enabled: false, purchase_enabled: false, banks_ready: 0, ...VOUCHER_DEFAULTS }); setStatusErr(null); setBanks([]); }
      else setStatusErr(voucherError(e));
    }
  }, []);
  const loadRows = useCallback(async () => {
    try { setRows(await fetchMyVoucherPurchases()); setRowsErr(null); }
    catch (e) { if (isMissingRpc(e)) { setRows([]); setRowsErr(null); } else { setRowsErr(voucherError(e)); setRows((r) => r ?? []); } }
  }, []);
  const reload = useCallback(async () => { await Promise.all([loadStatus(), loadRows()]); }, [loadStatus, loadRows]);
  useFocusEffect(useCallback(() => { reload(); }, [reload]));

  const upsert = (p: VoucherPurchase) => setRows((r) => {
    const list = r ?? [];
    const i = list.findIndex((x) => x.id === p.id);
    if (i < 0) return [p, ...list];
    const next = list.slice(); next[i] = { ...list[i], ...p }; return next;
  });

  const opened = openId ? rows?.find((x) => x.id === openId) ?? null : null;
  useEffect(() => { if (opened?.status === 'issued') refreshWallet(); }, [opened?.status, refreshWallet]);

  if (opened) {
    return (
      <Screen title="Instruksi transfer" back maxWidth={560}>
        <PurchaseDetail p={opened} onChange={(p) => { upsert(p); loadRows(); }} onClose={() => setOpenId(null)} onReload={loadRows} />
      </Screen>
    );
  }

  const purchaseOpen = !!status?.enabled && !!status?.purchase_enabled;

  return (
    <Screen title="Beli AntarVoucher" back maxWidth={560}>
      <View style={{ gap: 16 }}>
        {status === null && !statusErr ? (
          <View style={{ gap: 12 }}><Skeleton height={120} radius={radius.lg} /><Skeleton height={180} radius={radius.lg} /></View>
        ) : statusErr ? (
          <Entrance index={0}><ErrorCard text={statusErr} onRetry={reload} /></Entrance>
        ) : !purchaseOpen ? (
          <Entrance index={0}><NotOpenCard antarVoucherOn={!!status?.enabled} onGateway={() => router.push('/pay/gateway' as never)} /></Entrance>
        ) : (
          <PurchaseForm
            status={status!}
            banks={banks}
            banksErr={banksErr}
            onRetryBanks={loadStatus}
            onCreated={(p) => { upsert(p); setOpenId(p.id); loadRows(); }}
          />
        )}

        <Entrance index={2}>
          <Row between style={{ marginTop: 4 }}>
            <Text style={[font.label, { flexShrink: 1 }]}>Pembelian saya</Text>
            <PressableScale onPress={loadRows} haptic={false} accessibilityRole="button" accessibilityLabel="Muat ulang daftar pembelian" style={s.iconBtn}>
              <Ionicons name="refresh" size={20} color={colors.primary} />
            </PressableScale>
          </Row>
        </Entrance>
        {rows === null ? (
          <View style={{ gap: 10 }}>{[0, 1].map((i) => <Skeleton key={i} height={84} radius={radius.lg} />)}</View>
        ) : (
          <View style={{ gap: 10 }}>
            {rowsErr ? <ErrorCard text={rowsErr} onRetry={loadRows} compact /> : null}
            {rows.length === 0 && !rowsErr ? (
              <Empty icon="receipt-outline" title="Belum ada pembelian" subtitle="Instruksi transfer yang Anda buat akan tampil di sini beserta statusnya." />
            ) : rows.map((p) => <PurchaseRow key={p.id} p={p} onPress={() => setOpenId(p.id)} />)}
          </View>
        )}
      </View>
    </Screen>
  );
}

/* ─────────────── Belum dibuka ─────────────── */

function NotOpenCard({ antarVoucherOn, onGateway }: { antarVoucherOn: boolean; onGateway: () => void }) {
  return (
    <Card>
      <View style={{ gap: 12 }}>
        <Row gap={12} style={{ alignItems: 'flex-start' }}>
          <View style={[s.bigIcon, { backgroundColor: colors.accentLight }]}><Ionicons name="business-outline" size={24} color={colors.warning} /></View>
          <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
            <Text style={font.h3}>Segera hadir</Text>
            <Text style={font.small}>Pembelian AntarVoucher lewat transfer rekening resmi PT Antar Kita Indonesia belum dibuka.</Text>
          </View>
        </Row>
        <View style={s.soft}>
          <Text style={[font.small, { color: colors.text, fontWeight: '600' }]}>Nantinya Anda bisa:</Text>
          <Bullet text="Transfer dari bank mana pun ke rekening resmi atas nama PT Antar Kita Indonesia." />
          <Bullet text="Mendapat nominal transfer dengan 3 digit kode unik agar dana mudah dicocokkan." />
          <Bullet text="Saldo AntarVoucher bertambah setelah tim Finance mencocokkan dana masuk — tanpa perlu mengunggah bukti transfer." />
        </View>
        <Row gap={8} style={{ alignItems: 'flex-start' }}>
          <Ionicons name="shield-checkmark-outline" size={16} color={colors.danger} style={{ marginTop: 2 }} />
          <Text style={[font.tiny, { flex: 1, color: colors.textSecondary }]}>Jangan transfer ke rekening mana pun yang dikirim lewat chat, telepon, atau media sosial. Rekening resmi hanya akan tampil di aplikasi ini.</Text>
        </Row>
        {antarVoucherOn ? (
          <Button title="Top up instan" icon="flash" onPress={onGateway} />
        ) : (
          <Text style={[font.tiny, { color: colors.textSecondary }]}>AntarVoucher sedang nonaktif. Saldo yang sudah ada tetap aman dan tersimpan.</Text>
        )}
      </View>
    </Card>
  );
}

function Bullet({ text }: { text: string }) {
  return (
    <Row gap={8} style={{ alignItems: 'flex-start' }}>
      <Ionicons name="checkmark-circle" size={16} color={colors.primary} style={{ marginTop: 2 }} />
      <Text style={[font.small, { flex: 1 }]}>{text}</Text>
    </Row>
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

function PurchaseForm({ status, banks, banksErr, onRetryBanks, onCreated }: {
  status: VoucherStatusPublic; banks: VoucherBankAccount[] | null; banksErr: string | null; onRetryBanks: () => void; onCreated: (p: VoucherPurchase) => void;
}) {
  const min = Number(status.min) || VOUCHER_DEFAULTS.min;
  const max = Number(status.max) || VOUCHER_DEFAULTS.max;
  const ttl = Number(status.ttl_hours) || VOUCHER_DEFAULTS.ttl_hours;
  const [amount, setAmount] = useState('100000');
  const [bankCode, setBankCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  // Kunci idempotensi dipakai ulang selama (nominal, bank) sama → ketuk ganda / kirim ulang aman.
  const idem = useRef<{ sig: string; key: string } | null>(null);
  const n = Number(amount.replace(/\D/g, '')) || 0;
  const err = validateNominal(n, min, max, rupiah);
  const presets = VOUCHER_PRESETS.filter((p) => p >= min && p <= max);

  useEffect(() => {
    if (banks && banks.length && !banks.some((b) => b.bank_code === bankCode)) setBankCode(banks[0].bank_code);
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
      const p = await createVoucherPurchase(n, bankCode, idem.current.key);
      idem.current = null;   // instruksi terbentuk → pembelian berikutnya memakai kunci baru
      if (p.idempotent) toast.show('Instruksi transfer yang sama ditampilkan kembali');
      onCreated(p);
    } catch (e) { toast.error(voucherError(e)); }
    finally { setBusy(false); }
  };

  return (
    <>
      <Entrance index={0}>
        <Card>
          <Text style={font.label}>Nominal voucher</Text>
          <Row gap={8} style={{ flexWrap: 'wrap', marginTop: 10 }}>
            {presets.map((p) => <Chip key={p} label={p >= 1000000 ? `${p / 1000000} jt` : `${p / 1000} rb`} active={n === p} onPress={() => setAmount(String(p))} />)}
          </Row>
          <Input
            value={amount}
            onChangeText={(v) => setAmount(v.replace(/\D/g, '').slice(0, 10))}
            onBlur={() => setTouched(true)}
            keyboardType="number-pad"
            icon="cash-outline"
            placeholder="Nominal lain"
            accessibilityLabel="Nominal voucher"
            error={touched && err ? err : null}
            containerStyle={{ marginTop: 12 }}
          />
          <Text style={[font.tiny, { marginTop: 6 }]}>{rupiah(min)} – {rupiah(max)}, kelipatan Rp1.000. {n > 0 && !err ? `Anda mendapat saldo ${rupiah(n)} + kode unik.` : ''}</Text>
        </Card>
      </Entrance>

      <Entrance index={1}>
        <Card>
          <Text style={font.label}>Transfer ke rekening resmi</Text>
          {banks === null ? (
            <View style={{ gap: 8, marginTop: 10 }}><Skeleton height={56} radius={radius.md} /><Skeleton height={56} radius={radius.md} /></View>
          ) : banksErr && banks.length === 0 ? (
            <View style={{ marginTop: 10 }}><ErrorCard text={banksErr} onRetry={onRetryBanks} compact /></View>
          ) : banks.length === 0 ? (
            <Text style={[font.small, { marginTop: 10 }]}>Rekening resmi belum tersedia. Coba lagi nanti atau gunakan top up instan.</Text>
          ) : (
            <View style={{ gap: 8, marginTop: 10 }}>
              {banks.map((b) => {
                const on = b.bank_code === bankCode;
                return (
                  <PressableScale key={b.bank_code} onPress={() => setBankCode(b.bank_code)} scaleTo={0.98} haptic={false}
                    accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={`Bank ${b.bank_name}`}
                    style={[s.bank, on && { borderColor: colors.primary, backgroundColor: colors.primaryLight }]}>
                    <View style={[s.bankLogo, on && { backgroundColor: colors.primary }]}><Ionicons name="business" size={18} color={on ? '#fff' : colors.primary} /></View>
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
          <Text style={[font.tiny, { marginTop: 10 }]}>Nomor rekening lengkap muncul setelah instruksi dibuat. Batas waktu transfer {ttl} jam.</Text>
        </Card>
      </Entrance>

      <Entrance index={2}>
        <View style={{ gap: 10 }}>
          <Notice />
          <Button title="Buat instruksi transfer" icon="document-text-outline" size="lg" loading={busy} disabled={!!err || !bankCode || !banks?.length} onPress={submit} />
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

/* ─────────────── Daftar pembelian ─────────────── */

function PurchaseRow({ p, onPress }: { p: VoucherPurchase; onPress: () => void }) {
  const color = voucherStatusColor(p.status);
  const meta = voucherStatusMeta[p.status];
  return (
    <PressableScale onPress={onPress} scaleTo={0.98} haptic={false} accessibilityRole="button" accessibilityLabel={`Pembelian ${p.reference}, ${voucherStatusLabel(p.status)}`} style={s.item}>
      <Row gap={12} style={{ alignItems: 'flex-start' }}>
        <View style={[s.rowIcon, { backgroundColor: color + '1A' }]}><Ionicons name={(meta?.icon ?? 'receipt-outline') as never} size={20} color={color} /></View>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          {/* Nominal & jumlah transfer bertumpuk (bukan satu baris): di 320 px / skala font 130 % judul dulu terpotong jadi "Voucher …". */}
          <Text style={{ fontWeight: '700', color: colors.text, fontSize: 16 }} numberOfLines={2}>Voucher {rupiah(p.nominal)}</Text>
          <Text style={[font.small, { color: colors.text }]}>Transfer <Text style={{ fontWeight: '700' }}>{rupiah(p.transfer_amount)}</Text></Text>
          <Text style={font.tiny} numberOfLines={2}>{p.reference}{p.bank_name ? ` · ${p.bank_name}` : ''}</Text>
          {p.created_at ? <Text style={font.tiny} numberOfLines={1}>{formatDate(p.created_at)}</Text> : null}
          <View style={{ flexDirection: 'row', marginTop: 4 }}><Badge text={voucherStatusLabel(p.status)} color={color} /></View>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.textMuted} style={{ marginTop: 10 }} />
      </Row>
    </PressableScale>
  );
}

/* ─────────────── Detail / instruksi ─────────────── */

function PurchaseDetail({ p, onChange, onClose, onReload }: { p: VoucherPurchase; onChange: (p: VoucherPurchase) => void; onClose: () => void; onReload: () => Promise<void> }) {
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

  const run = async (kind: 'sent' | 'cancel' | 'dispute', fn: () => Promise<VoucherPurchase>, ok: string) => {
    if (busy) return;
    setBusy(kind);
    try { const r = await fn(); onChange({ ...p, ...r }); setMode('none'); toast.success(ok); }
    catch (e) { toast.error(voucherError(e)); if (String((e as Error).message).includes('VOUCHER_STATE')) onReload(); }
    finally { setBusy(null); }
  };

  const steps = useMemo(() => [
    `Buka m-banking / ATM / internet banking Anda.`,
    `Transfer ke ${p.bank_name ?? 'bank tujuan'}${p.account_no ? ` ${p.account_no}` : ''} a.n. ${p.account_name ?? 'PT Antar Kita Indonesia'}.`,
    `Masukkan nominal PERSIS ${rupiah(p.transfer_amount)} — jangan dibulatkan.`,
    `Tulis kode referensi ${p.reference} di berita/catatan transfer (bila tersedia).`,
    `Tekan "Saya sudah transfer" agar pencocokan lebih cepat. Saldo masuk setelah dana dicocokkan.`,
  ], [p.bank_name, p.account_no, p.account_name, p.transfer_amount, p.reference]);

  return (
    <View style={{ gap: 16 }}>
      <Entrance index={0}>
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
                {/* Satu kolom (label → sisa waktu → batas): tiga kolom sejajar dulu menjepit sisa waktu jadi per kata di 320 px. */}
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

      <Entrance index={1}>
        <Card>
          <View style={{ gap: 14 }}>
            <CopyField label="Kode referensi (berita transfer)" value={p.reference} what="Kode referensi" />

            {instr ? (
              <>
                <View style={{ gap: 6 }}>
                  <Text style={font.label}>Bank tujuan</Text>
                  <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text }}>{p.bank_name ?? '—'}</Text>
                </View>
                {hasAccount ? (
                  <CopyField label="Nomor rekening" value={p.account_no!} what="Nomor rekening" big />
                ) : (
                  <Text style={[font.small, { color: colors.danger }]}>Rekening ini sedang tidak tersedia. Jangan transfer dulu — batalkan dan buat instruksi baru, atau hubungi CS.</Text>
                )}
                {p.account_name ? (
                  <View style={{ gap: 6 }}>
                    <Text style={font.label}>Atas nama</Text>
                    <Text style={{ fontSize: 16, fontWeight: '600', color: colors.text }}>{p.account_name}</Text>
                  </View>
                ) : null}
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
                  3 digit terakhir adalah kode unik — ikut masuk ke saldo Anda. Voucher {rupiah(p.nominal)} + kode unik {p.unique_code} = {rupiah(p.transfer_amount)}.
                </Text>
              </Row>
            </View>
          </View>
        </Card>
      </Entrance>

      {instr ? (
        <Entrance index={2}>
          <Card>
            <Text style={font.label}>Langkah transfer</Text>
            <View style={{ gap: 8, marginTop: 10 }}>
              {steps.map((t, i) => (
                <Row key={i} gap={10} style={{ alignItems: 'flex-start' }}>
                  <View style={s.step}><Text style={{ color: colors.primary, fontWeight: '700', fontSize: 12 }}>{i + 1}</Text></View>
                  <Text style={[font.small, { flex: 1, minWidth: 0, color: colors.text }]}>{t}</Text>
                </Row>
              ))}
            </View>
          </Card>
        </Entrance>
      ) : null}

      {(live || p.status === 'amount_mismatch') ? <Entrance index={3}><Notice /></Entrance> : null}

      <Entrance index={4}>
        <View style={{ gap: 10 }}>
          {mode === 'sent' ? (
            <Card>
              <View style={{ gap: 10 }}>
                <Text style={font.h3}>Konfirmasi transfer</Text>
                <Text style={font.small}>Opsional: isi nama & bank pengirim agar tim Finance lebih cepat mencocokkan. Ini tidak langsung menambah saldo.</Text>
                <Input label="Nama pemilik rekening pengirim" value={senderName} onChangeText={setSenderName} maxLength={80} autoCapitalize="words" icon="person-outline" />
                <Input label="Bank pengirim" value={senderBank} onChangeText={setSenderBank} maxLength={40} placeholder="mis. BCA, Mandiri, BRI" icon="business-outline" />
                <Button title="Kirim konfirmasi" icon="checkmark" loading={busy === 'sent'} onPress={() => run('sent', () => markVoucherSent(p.id, senderName, senderBank), 'Terima kasih — kami akan mencocokkan dana Anda')} />
                <Button title="Batal" variant="ghost" onPress={() => setMode('none')} />
              </View>
            </Card>
          ) : mode === 'dispute' ? (
            <Card>
              <View style={{ gap: 10 }}>
                <Text style={font.h3}>Laporkan masalah</Text>
                <Text style={font.small}>Ceritakan apa yang terjadi, mis. sudah transfer tapi saldo belum masuk, nominal salah, atau transfer ke rekening lain. Sertakan waktu transfer & bank pengirim.</Text>
                <Input value={reason} onChangeText={setReason} multiline maxLength={500} placeholder="Minimal 10 karakter" accessibilityLabel="Uraian masalah" error={reason.length > 0 && reason.trim().length < 10 ? 'Jelaskan minimal 10 karakter' : null} />
                <Button title="Kirim laporan" icon="send" color={colors.warning} disabled={reason.trim().length < 10} loading={busy === 'dispute'} onPress={() => run('dispute', () => disputeVoucherPurchase(p.id, reason), 'Laporan terkirim. Tim kami akan menghubungi Anda.')} />
                <Button title="Batal" variant="ghost" onPress={() => setMode('none')} />
              </View>
            </Card>
          ) : (
            <>
              {canMarkSent(p, now) ? <Button title={p.status === 'submitted' ? 'Perbarui info pengirim' : 'Saya sudah transfer'} icon="checkmark-done" size="lg" onPress={() => setMode('sent')} /> : null}
              {canCancel(p) && !expiredLocally ? <Button title="Batalkan" variant="outline" color={colors.danger} icon="close" loading={busy === 'cancel'} onPress={() => run('cancel', () => cancelVoucherPurchase(p.id), 'Pembelian dibatalkan')} /> : null}
              {canDispute(p) ? <Button title="Laporkan masalah" variant="ghost" icon="flag-outline" color={colors.warning} onPress={() => setMode('dispute')} /> : null}
            </>
          )}
          <Button title="Lihat semua pembelian" variant="secondary" icon="list-outline" onPress={onClose} />
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
        {/* Tanpa numberOfLines: nomor rekening/kode referensi TIDAK boleh terpotong "…". Bila tidak muat (rekening 15 digit,
            skala font besar), tombol "Salin" turun ke baris berikutnya (copyBox flexWrap). */}
        <Text style={[{ flexGrow: 1, flexShrink: 0, maxWidth: '100%', color: colors.text, fontWeight: '700', letterSpacing: 0.5 }, { fontSize: big ? 20 : 16 }]} selectable>{value}</Text>
        <Row gap={4} style={{ marginLeft: 'auto' }}><Ionicons name="copy-outline" size={20} color={colors.primary} /><Text style={{ color: colors.primary, fontWeight: '700', fontSize: 14 }}>Salin</Text></Row>
      </PressableScale>
    </View>
  );
}

const s = StyleSheet.create({
  iconBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  bigIcon: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  soft: { gap: 8, padding: 12, borderRadius: radius.md, backgroundColor: colors.bgSoft },
  err: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, padding: 12, borderRadius: radius.md, backgroundColor: colors.dangerLight },
  bank: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, padding: 12, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, backgroundColor: '#fff' },
  bankLogo: { width: 36, height: 36, borderRadius: 12, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  notice: { gap: 10, padding: 12, borderRadius: radius.md, backgroundColor: colors.infoLight, borderWidth: 1, borderColor: colors.info + '33' },
  item: { padding: 12, borderRadius: radius.lg, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border },
  rowIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  countdown: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: radius.md, backgroundColor: colors.accentLight },
  copyBox: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, minHeight: 52, paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.sm, backgroundColor: colors.primaryLight },
  amountBox: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 60, paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.sm, backgroundColor: colors.primaryLight, borderWidth: 1.5, borderColor: colors.primary + '44' },
  amount: { flex: 1, minWidth: 0, fontSize: 28, fontWeight: '700', color: colors.text, letterSpacing: 0.3 },
  amountTail: { color: colors.danger, backgroundColor: colors.accentLight, textDecorationLine: 'underline' },
  codeDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.danger, marginTop: 3 },
  step: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
});
