// Sakelar fitur saat BUILD (bukan server). EXPO_PUBLIC_WALLET_UI=off dipakai untuk AAB Google Play selama akun
// developer masih perorangan: Play menolak fitur "Mobile payments & digital wallets" (19 Sep 2026), jadi saldo/
// AntarVoucher (top up, beli voucher, bayar pakai saldo, tarik saldo) disembunyikan di build itu. Server tetap
// menjadi penjaga utama (antarpay_enabled). Build APK internal & web: default ON.
export const WALLET_UI = (process.env.EXPO_PUBLIC_WALLET_UI ?? 'on').toLowerCase() !== 'off';
