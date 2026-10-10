// AntarVoucher v5 (KONTRAK-V5 §3 driver_deposit_status / §4 Mitra): deposit komisi driver & mitra travel.
// Server menolak driver_accept_order / driver_set_online / travel_accept_send / travel_offer_create dengan
// `DEPOSIT_REQUIRED: saldo AntarVoucher minimal Rp…` bila saldo < driver_min_balance_accept. Komponen ini:
//  - DepositBanner      : banner "Saldo AntarVoucher Rp…, minimal Rp… — kekurangan Rp…" + tombol "Beli AntarVoucher"
//  - useDepositGate     : status deposit + muat ulang saat layar fokus (setelah beli voucher saldo berubah)
//  - isDepositError     : deteksi galat DEPOSIT_REQUIRED dari RPC
//  - depositErrorToast  : pesan ramah + tombol beli (web: confirm → buka /pay/voucher; native: Alert)
import React, { useCallback } from 'react';
import { View, Text, StyleSheet, Platform, Alert } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Row, Button, toast } from '@/components/ui';
import { useDriverDeposit } from '@/hooks/useVoucherV5';
import type { DriverDepositStatus } from '@/lib/voucherV5';
import { colors, font, radius } from '@/lib/theme';
import { rupiah } from '@/lib/format';

export const VOUCHER_ROUTE = '/pay/voucher';

/** Status deposit + muat ulang saat layar kembali fokus. `enabled` false → tidak memanggil RPC (mis. mitra belum approved). */
export function useDepositGate(enabled = true) {
  const { status, error, reload } = useDriverDeposit(enabled);
  useFocusEffect(useCallback(() => { if (enabled) void reload(); }, [enabled, reload]));
  // Terblokir hanya bila server MENYATAKAN deposit wajib dan saldo kurang. Bila RPC gagal/belum ada → tidak memblokir
  // (server tetap menjadi penjaga akhir lewat DEPOSIT_REQUIRED).
  const blocked = !!status && status.required && !status.can_accept;
  return { status, error, reload, blocked };
}

export const isDepositError = (e: unknown) => /DEPOSIT_REQUIRED/i.test((e as Error)?.message ?? String(e));

/** Pesan ramah untuk galat DEPOSIT_REQUIRED: angka minimal diambil dari pesan server bila ada. */
export function depositErrorText(e: unknown, status?: DriverDepositStatus | null) {
  const msg = (e as Error)?.message ?? '';
  const m = msg.match(/Rp\s?([\d.]+)/i);
  const min = status?.min_balance ?? (m ? Number(m[1].replace(/\./g, '')) : null);
  const short = status?.shortfall ?? null;
  return `Saldo AntarVoucher Anda belum cukup untuk menerima order${min != null ? ` (minimal ${rupiah(min)})` : ''}${short ? ` — kekurangan ${rupiah(short)}` : ''}. Beli AntarVoucher dulu, saldo masuk setelah transfer diverifikasi.`;
}

/** Tampilkan galat deposit dengan tombol beli. Mengembalikan true bila galat memang DEPOSIT_REQUIRED (sudah ditangani). */
export function handleDepositError(e: unknown, status: DriverDepositStatus | null | undefined, go: (href: string) => void): boolean {
  if (!isDepositError(e)) return false;
  const text = depositErrorText(e, status);
  if (Platform.OS === 'web') {
    toast.error(text);
    if (confirm(`${text}\n\nBuka halaman Beli AntarVoucher sekarang?`)) go(VOUCHER_ROUTE);
    return true;
  }
  Alert.alert('Deposit AntarVoucher diperlukan', text, [{ text: 'Nanti' }, { text: 'Beli AntarVoucher', onPress: () => go(VOUCHER_ROUTE) }]);
  return true;
}

/**
 * Banner deposit. Tampil hanya bila `required && !can_accept`; bila `error` (RPC gagal) tampil baris kecil agar galat tidak ditelan.
 * `compact` untuk header peta driver.
 */
export function DepositBanner({ status, error, onRetry, accent = colors.warning }: { status: DriverDepositStatus | null; error?: string | null; onRetry?: () => void; accent?: string }) {
  const router = useRouter();
  if (error && !status) {
    return (
      <Row gap={8} style={s.errLine}>
        <Ionicons name="alert-circle-outline" size={14} color={colors.textMuted} />
        <Text style={[font.tiny, { flex: 1 }]}>Status deposit AntarVoucher belum bisa dimuat: {error}</Text>
        {onRetry ? <Button title="Ulangi" size="sm" variant="ghost" onPress={onRetry} /> : null}
      </Row>
    );
  }
  if (!status || !status.required || status.can_accept) return null;
  return (
    <View style={[s.box, { borderColor: accent + '66', backgroundColor: accent + '14' }]}>
      <Row gap={10} style={{ alignItems: 'flex-start' }}>
        <View style={[s.icon, { backgroundColor: accent + '22' }]}><Ionicons name="wallet-outline" size={20} color={accent} /></View>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text style={[font.body, { fontWeight: '700', color: colors.text }]}>Deposit AntarVoucher belum cukup</Text>
          <Text style={font.small}>
            Saldo AntarVoucher {rupiah(status.balance)}, minimal {rupiah(status.min_balance)} untuk menerima order — kekurangan <Text style={{ fontWeight: '700', color: colors.text }}>{rupiah(status.shortfall)}</Text>.
          </Text>
          <Text style={font.tiny}>Komisi order tunai dipotong dari saldo ini. Beli voucher via transfer ke rekening AntarKita; saldo masuk setelah diverifikasi.</Text>
        </View>
      </Row>
      <Button title="Beli AntarVoucher" icon="cart-outline" size="sm" color={accent} onPress={() => router.push(VOUCHER_ROUTE as never)} style={{ marginTop: 10 }} />
    </View>
  );
}

const s = StyleSheet.create({
  box: { padding: 12, borderRadius: radius.lg, borderWidth: 1 },
  icon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  errLine: { padding: 8, borderRadius: radius.md, backgroundColor: colors.bgSoft, alignItems: 'center' },
});
