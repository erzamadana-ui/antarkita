// Rekening pencairan mitra wajib + auto-sweep (migrasi 0123) — aplikasi Mitra, rute /payout-account.
//  - PayoutAccountScreen (default) : lihat & ubah rekening, status verifikasi, sakelar auto-sweep
//  - PayoutAccountForm             : form kanal (bank / e-wallet) + nomor + nama + auto-sweep — dipakai juga di onboarding
//                                    driver & mitra travel (mode `embedded`: hanya mengembalikan nilai form, tidak menyimpan)
//  - PayoutRequiredBanner          : banner "Lengkapi rekening pencairan untuk bisa online" (beranda driver, toko merchant, travel)
//  - handlePayoutRequiredError     : galat PAYOUT_ACCOUNT_REQUIRED → pesan ramah + tombol ke /payout-account
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Switch, Platform, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Screen, Card, Row, Badge, Button, Chip, Input, toast } from '@/components/ui';
import { Entrance } from '@/components/motion';
import { Dropdown } from '@/components/Dropdown';
import { usePayoutAccount, usePayoutBanks } from '@/hooks/usePayoutAccount';
import { colors, font, radius, shadow } from '@/lib/theme';
import { formatDate } from '@/lib/format';
import {
  PAYOUT_CHANNELS, PAYOUT_ACCOUNT_ROUTE, PAYOUT_REQUIRED_TEXT, PAYOUT_SESSIONS, accountSummary, channelLabel, digitsOnly, formFromMine,
  isEwallet, isPayoutRequiredError, sweepExplanation, validatePayoutForm, verificationBadge, type PayoutAccountForm as FormValue, type PayoutAccountMine, type PayoutBank, type PayoutChannel,
} from '@/lib/payout';

/** Galat PAYOUT_ACCOUNT_REQUIRED → pesan ramah + tombol buka layar rekening. true bila galat memang itu. */
export function handlePayoutRequiredError(e: unknown, go: (href: string) => void): boolean {
  if (!isPayoutRequiredError(e)) return false;
  if (Platform.OS === 'web') {
    toast.error(PAYOUT_REQUIRED_TEXT);
    if (confirm(`${PAYOUT_REQUIRED_TEXT}\n\nBuka halaman Rekening pencairan sekarang?`)) go(PAYOUT_ACCOUNT_ROUTE);
    return true;
  }
  Alert.alert('Rekening pencairan diperlukan', PAYOUT_REQUIRED_TEXT, [{ text: 'Nanti' }, { text: 'Isi rekening', onPress: () => go(PAYOUT_ACCOUNT_ROUTE) }]);
  return true;
}

/** Banner wajib rekening — tampil hanya bila server menyatakan `required && !exists`. `error` → baris kecil agar galat tidak ditelan. */
export function PayoutRequiredBanner({ mine, error, onRetry, accent = colors.warning, context = 'online' }: {
  mine: PayoutAccountMine | null; error?: string | null; onRetry?: () => void; accent?: string; context?: 'online' | 'merchant' | 'travel';
}) {
  const router = useRouter();
  if (error && !mine) {
    return (
      <Row gap={8} style={s.errLine}>
        <Ionicons name="alert-circle-outline" size={14} color={colors.textMuted} />
        <Text style={[font.tiny, { flex: 1 }]}>Status rekening pencairan belum bisa dimuat: {error}</Text>
        {onRetry ? <Button title="Ulangi" size="sm" variant="ghost" onPress={onRetry} /> : null}
      </Row>
    );
  }
  if (!mine || !mine.required || mine.exists) return null;
  const what = context === 'merchant' ? 'untuk bisa membuka toko' : context === 'travel' ? 'untuk menerima titipan & penawaran' : 'untuk bisa online';
  return (
    <View style={[s.box, { borderColor: accent + '66', backgroundColor: accent + '14' }]}>
      <Row gap={10} style={{ alignItems: 'flex-start' }}>
        <View style={[s.icon, { backgroundColor: accent + '22' }]}><Ionicons name="card-outline" size={20} color={accent} /></View>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text style={[font.body, { fontWeight: '700', color: colors.text }]}>Lengkapi rekening pencairan {what}</Text>
          <Text style={font.small}>Pendapatan Anda dicairkan otomatis ke rekening bank atau e-wallet (DANA/OVO/LinkAja/GoPay/ShopeePay) pada {PAYOUT_SESSIONS.length} sesi per hari ({PAYOUT_SESSIONS.join(' / ')} WIB). Isi sekali saja.</Text>
        </View>
      </Row>
      <Button title="Isi rekening pencairan" icon="card-outline" size="sm" color={accent} onPress={() => router.push(PAYOUT_ACCOUNT_ROUTE as never)} style={{ marginTop: 10 }} />
    </View>
  );
}

// ------------------------------------------------------------------------------- Form
export function PayoutAccountForm({ value, onChange, banks, accent = colors.primary, compact }: {
  value: FormValue; onChange: (v: FormValue) => void; banks: PayoutBank[]; accent?: string; compact?: boolean;
}) {
  const set = <K extends keyof FormValue>(k: K, v: FormValue[K]) => onChange({ ...value, [k]: v });
  const ew = isEwallet(value.channel);
  const bankOptions = useMemo(() => banks.map((b) => ({ value: b.code, label: b.name, sublabel: b.code.toUpperCase(), icon: 'business-outline' as const })), [banks]);
  return (
    <View style={{ gap: 12 }}>
      <Text style={font.label}>Saluran pencairan</Text>
      <Row gap={8} style={{ flexWrap: 'wrap' }}>
        {PAYOUT_CHANNELS.map((c) => <Chip key={c.key} label={c.label} active={value.channel === c.key} color={accent} onPress={() => onChange({ ...value, channel: c.key as PayoutChannel, bank_code: c.key === 'bank' ? value.bank_code : null, account_no: '' })} />)}
      </Row>
      {value.channel === 'bank' ? (
        <Dropdown label="Bank tujuan" title="Pilih bank" value={value.bank_code} options={bankOptions} onChange={(v) => set('bank_code', String(v))} placeholder="Pilih bank" emptyText="Daftar bank belum termuat — coba lagi nanti." icon="business-outline" accent={accent}
          helper={banks.length === 0 ? 'Daftar bank diambil dari server (bank_codes).' : undefined} />
      ) : (
        <Text style={font.tiny}>E-wallet {channelLabel(value.channel)}: masukkan nomor HP yang terdaftar (08xx).</Text>
      )}
      <Input label={ew ? `Nomor HP ${channelLabel(value.channel)}` : 'Nomor rekening'} keyboardType="number-pad" placeholder={ew ? '08xxxxxxxxxx' : '1234567890'} value={value.account_no} onChangeText={(v) => set('account_no', digitsOnly(v))} icon={ew ? 'phone-portrait-outline' : 'card-outline'} />
      <Input label="Nama pemilik (sesuai rekening / e-wallet)" placeholder="NAMA SESUAI BUKU TABUNGAN" value={value.account_name} onChangeText={(v) => set('account_name', v)} icon="person-outline" autoCapitalize="characters" />
      <Row between style={s.sweepRow}>
        <View style={{ flex: 1, minWidth: 0, paddingRight: 8 }}>
          <Text style={[font.body, { fontWeight: '700' }]}>Pencairan otomatis (auto-sweep)</Text>
          <Text style={font.tiny}>{compact ? `Saldo dicairkan otomatis ${PAYOUT_SESSIONS.length}× sehari (${PAYOUT_SESSIONS.join(' / ')} WIB).` : `Saldo di atas cadangan dicairkan otomatis ke rekening ini pada ${PAYOUT_SESSIONS.join(' / ')} WIB tanpa perlu mengajukan. Matikan bila ingin menarik manual.`}</Text>
        </View>
        <Switch value={value.auto_sweep} onValueChange={(v) => set('auto_sweep', v)} trackColor={{ true: accent, false: colors.border }} thumbColor="#fff" />
      </Row>
    </View>
  );
}

// ------------------------------------------------------------------------------ Layar
export default function PayoutAccountScreen() {
  const router = useRouter();
  const { mine, error, loading, reload, save } = usePayoutAccount(true);
  const [f, setF] = useState<FormValue>(() => formFromMine(mine));
  const [editing, setEditing] = useState(!mine?.exists);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (mine) { setF(formFromMine(mine)); setEditing(!mine.exists); } }, [mine?.updated_at, mine?.exists]); // eslint-disable-line react-hooks/exhaustive-deps
  const banks = usePayoutBanks(mine?.banks);
  const badge = verificationBadge(mine);
  const badgeColor = badge.tone === 'success' ? colors.success : badge.tone === 'warning' ? colors.warning : colors.textMuted;

  const submit = async () => {
    const err = validatePayoutForm(f);
    if (err) return toast.error(err);
    if (busy) return;
    setBusy(true);
    try {
      const res = await save(f);
      toast.success(res.verified ? 'Rekening pencairan disimpan' : 'Rekening disimpan — menunggu verifikasi admin (sweep pertama disetujui manual)');
      setEditing(false);
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };
  const toggleSweep = async (v: boolean) => {
    if (!mine?.exists || busy) return;
    setBusy(true);
    try { await save({ ...formFromMine(mine), auto_sweep: v }); toast.show(v ? 'Auto-sweep diaktifkan' : 'Auto-sweep dimatikan — tarik saldo manual'); }
    catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <Screen title="Rekening Pencairan" subtitle="Bank / e-wallet tujuan pendapatan" back
      footer={editing ? <Button title={mine?.exists ? 'Simpan perubahan' : 'Simpan rekening'} size="lg" icon="save-outline" loading={busy} onPress={submit} /> : <Button title="Ubah rekening" size="lg" variant="secondary" icon="create-outline" onPress={() => setEditing(true)} />}>
      <View style={{ gap: 16 }}>
        {error && !mine ? (
          <Entrance index={0}><Row gap={8} style={s.errLine}><Ionicons name="alert-circle-outline" size={14} color={colors.textMuted} /><Text style={[font.tiny, { flex: 1 }]}>Data rekening belum bisa dimuat: {error}</Text><Button title="Ulangi" size="sm" variant="ghost" onPress={reload} /></Row></Entrance>
        ) : null}
        {mine?.required && !mine.exists ? (
          <Entrance index={0}><View style={[s.box, { borderColor: colors.warning + '66', backgroundColor: colors.warning + '14' }]}>
            <Text style={[font.body, { fontWeight: '700', color: colors.text }]}>Wajib diisi sebelum online / membuka toko</Text>
            <Text style={font.small}>Tanpa rekening, server menolak online (driver), buka toko (merchant), penawaran travel, dan penarikan saldo.</Text>
          </View></Entrance>
        ) : null}

        {mine?.exists && (
          <Entrance index={1}><Card style={{ gap: 10 }}>
            <Row between>
              <Text style={font.label}>Rekening tersimpan</Text>
              <Badge text={badge.text} color={badgeColor} />
            </Row>
            <Row gap={12}>
              <View style={s.icon}><Ionicons name={isEwallet(mine.channel) ? 'phone-portrait-outline' : 'business-outline'} size={20} color={colors.primary} /></View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[font.body, { fontWeight: '700' }]} numberOfLines={1}>{mine.channel === 'bank' ? (mine.bank_name ?? mine.bank_code) : channelLabel(mine.channel)}</Text>
                <Text style={font.small}>{mine.account_no_masked ?? mine.account_no} · a.n. {mine.account_name}</Text>
                <Text style={font.tiny}>{mine.verified && mine.verified_at ? `Diverifikasi ${formatDate(mine.verified_at)}` : 'Verifikasi admin terjadi saat pencairan pertama disetujui. Mengubah nomor/bank mereset status ini.'}</Text>
              </View>
            </Row>
            <Row between style={s.sweepRow}>
              <View style={{ flex: 1, minWidth: 0, paddingRight: 8 }}>
                <Text style={[font.body, { fontWeight: '700' }]}>Auto-sweep {mine.auto_sweep !== false ? 'aktif' : 'nonaktif'}</Text>
                <Text style={font.tiny}>{sweepExplanation(mine)}</Text>
              </View>
              <Switch value={mine.auto_sweep !== false} onValueChange={toggleSweep} disabled={busy || mine.sweep_enabled === false} trackColor={{ true: colors.primary, false: colors.border }} thumbColor="#fff" />
            </Row>
          </Card></Entrance>
        )}

        {editing && (
          <Entrance index={2}><Card style={{ gap: 12 }}>
            <Text style={font.label}>{mine?.exists ? 'Ubah rekening' : 'Isi rekening pencairan'}</Text>
            <PayoutAccountForm value={f} onChange={setF} banks={banks} />
            {mine?.exists && accountSummary(mine) ? <Text style={font.tiny}>Sebelumnya: {accountSummary(mine)}. Mengganti nomor/bank mereset status verifikasi — pencairan berikutnya menunggu persetujuan admin sekali.</Text> : null}
            {mine?.exists ? <Button title="Batal" variant="ghost" onPress={() => { setF(formFromMine(mine)); setEditing(false); }} /> : null}
          </Card></Entrance>
        )}

        <Entrance index={3}><View style={s.note}>
          <Text style={font.label}>Cara kerja pencairan</Text>
          <Text style={font.tiny}>• Tiga sesi per hari: {PAYOUT_SESSIONS.join(', ')} WIB. Saldo di atas cadangan (minimal {loading ? '…' : `Rp${(mine?.min_sweep ?? 20000).toLocaleString('id-ID')}`}) ikut sesi berikutnya bila auto-sweep aktif.</Text>
          <Text style={font.tiny}>• Rekening terverifikasi cair otomatis; belum terverifikasi menunggu persetujuan admin sekali, lalu otomatis seterusnya.</Text>
          <Text style={font.tiny}>• Tidak ikut sweep bila ada penarikan yang belum masuk batch atau ada penanda keamanan terbuka pada akun.</Text>
          <Text style={font.tiny}>• Ingin menarik manual? Matikan auto-sweep lalu ajukan dari menu Tarik Saldo (memakai rekening ini).</Text>
          <Button title="Buka Tarik Saldo" size="sm" variant="ghost" icon="cash-outline" onPress={() => router.push('/pay/withdraw' as never)} />
        </View></Entrance>
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  box: { padding: 12, borderRadius: radius.lg, borderWidth: 1, gap: 4 },
  icon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center' },
  errLine: { padding: 8, borderRadius: radius.md, backgroundColor: colors.bgSoft, alignItems: 'center' },
  sweepRow: { padding: 10, borderRadius: radius.md, backgroundColor: colors.bgSoft, borderWidth: 1, borderColor: colors.border },
  note: { gap: 6, padding: 14, borderRadius: radius.lg, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, ...shadow.soft },
});
