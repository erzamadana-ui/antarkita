import type { OrderStatus, ServiceType, MerchantOrderStatus } from './types';

// Nilai negatif ditulis "-Rp420.000", bukan "Rp-420.000" — bentuk kedua sulit dibaca sekilas
// dan pernah membuat driver tidak sadar saldonya minus.
export const rupiah = (n: number | null | undefined) => {
  const v = Math.round(n ?? 0);
  return (v < 0 ? '-Rp' : 'Rp') + Math.abs(v).toLocaleString('id-ID');
};

export const km = (n: number | null | undefined) => `${(Number(n) || 0).toFixed(1).replace('.', ',')} km`;

export const minutes = (n: number | null | undefined) => `${Math.max(1, Math.round(n ?? 0))} mnt`;

export function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'baru saja';
  if (diff < 3600) return `${Math.floor(diff / 60)} mnt lalu`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} jam lalu`;
  return `${Math.floor(diff / 86400)} hari lalu`;
}

export function formatDate(iso: string, withTime = true): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  if (!withTime) return date;
  return `${date}, ${d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}`;
}

export const formatTime = (iso: string) => new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

export const serviceLabel: Record<ServiceType, string> = {
  market: 'AntarMarket',
  ride_motor: 'AntarRide',
  ride_car: 'AntarCar',
  food: 'AntarFood',
  send: 'AntarSend',
  shop: 'AntarShop',
  box: 'AntarBox',
  travel: 'AntarTravel',
};

export function statusLabel(status: OrderStatus, service: ServiceType, merchantStatus?: MerchantOrderStatus | null): string {
  switch (status) {
    case 'scheduled': return 'Terjadwal';
    case 'searching': return service === 'food' && merchantStatus === 'pending' ? 'Menunggu merchant & driver' : 'Mencari driver';
    case 'accepted': return service === 'food' ? 'Driver menuju merchant' : service === 'shop' ? 'Driver menuju toko' : 'Driver menuju lokasi jemput';
    case 'arrived': return service === 'food' ? 'Driver di merchant' : service === 'shop' ? 'Driver sedang belanja' : service === 'box' ? 'Driver tiba, memuat barang' : 'Driver sudah tiba';
    case 'in_progress': return service === 'ride_motor' || service === 'ride_car' ? 'Dalam perjalanan' : 'Sedang diantar';
    case 'completed': return 'Selesai';
    case 'cancelled': return 'Dibatalkan';
  }
}

export const merchantStatusLabel: Record<MerchantOrderStatus, string> = {
  pending: 'Menunggu konfirmasi', accepted: 'Sedang disiapkan', ready: 'Siap diambil', rejected: 'Ditolak',
};

export const statusColor = (status: OrderStatus) =>
  status === 'completed' ? '#1FA363' : status === 'cancelled' ? '#E5484D' : status === 'searching' ? '#D97706' : status === 'scheduled' ? '#8B5CF6' : '#2F80ED';

export const initials = (name?: string | null) =>
  (name ?? '?').split(' ').filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join('') || '?';

export const phoneDisplay = (p?: string | null) => (p ? p.replace(/^\+62/, '0') : '-');
/** Nomor disamarkan (PDP): 0812••••789 — pihak lain tidak melihat nomor lengkap. */
export const phoneMasked = (p?: string | null) => { if (!p) return '—'; const d = p.replace(/^\+62/, '0'); return d.length > 7 ? d.slice(0, 4) + '••••' + d.slice(-3) : '••••'; };
export const extraKindLabel: Record<string, string> = { parking: 'Parkir', toll: 'Tol', waiting: 'Waktu tunggu', other: 'Lainnya' };

// ---- Tahap 4: tiket & keamanan ----
export const ticketStatusLabel: Record<string, string> = { open: 'Terbuka', in_progress: 'Ditangani CS', waiting_user: 'Menunggu Anda', resolved: 'Selesai', closed: 'Ditutup' };
export const ticketStatusColor = (s: string) => s === 'open' ? '#F59E0B' : s === 'in_progress' ? '#3B82F6' : s === 'waiting_user' ? '#8B5CF6' : s === 'resolved' ? '#10B981' : '#94A3B8';
export const ticketPriorityLabel: Record<string, string> = { low: 'Rendah', normal: 'Normal', high: 'Tinggi', urgent: 'Darurat' };
export const ticketPriorityColor = (p: string) => p === 'urgent' ? '#EF4444' : p === 'high' ? '#F97316' : p === 'normal' ? '#3B82F6' : '#94A3B8';
export const ticketCategoryLabel: Record<string, string> = { order: 'Pesanan', payment: 'Pembayaran / Saldo', driver: 'Driver', merchant: 'Merchant', account: 'Akun', app: 'Aplikasi', safety: 'Keamanan', other: 'Lainnya' };
export const roleLabelId: Record<string, string> = { customer: 'Pelanggan', driver: 'Driver', merchant: 'Merchant', admin: 'Admin' };

// ---- Tahap 5 ----
export const vehicleTypeLabel: Record<string, string> = { motor: 'Motor', car: 'Mobil', box: 'Mobil box', pickup: 'Pick up' };
export const vehicleConditionLabel: Record<string, string> = { standar: 'Standar', baik: 'Baik', sangat_baik: 'Sangat baik' };
export const classShort = (code?: string | null) => code ? ({ motor_economy: 'Hemat', motor_standard: 'Standar', motor_ev: 'Listrik', car_economy: 'Hemat', car_standard: 'Standar', car_premium: 'Premium', car_ev: 'Listrik', car_ev_premium: 'Listrik Premium', box_pickup: 'Pick Up', box_van: 'Mobil Box' } as Record<string, string>)[code] ?? code : '';
export const ewalletLabel: Record<string, string> = { gopay: 'GoPay', ovo: 'OVO', dana: 'DANA', shopeepay: 'ShopeePay', qris: 'QRIS', bank_transfer: 'VA Bank' };
export const paidViaLabel = (v?: string | null) => v === 'cash' || !v ? 'Tunai' : v === 'wallet' ? 'AntarPay' : `${ewalletLabel[v] ?? v} (via AntarPay)`;
export const formatSchedule = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('id-ID', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) + ' WIB' : '');
export const shortMonth = (ym: string) => { const [y, m] = ym.split('-'); return ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'][Number(m) - 1] + ' ' + y.slice(2); };
export const execLevelLabel: Record<string, string> = { vp: 'Vice President', ceo: 'CEO', cfo: 'CFO', shareholder: 'Pemegang Saham' };
export const vehicleClassLabel: Record<string, string> = { motor_economy: 'Ride Hemat', motor_standard: 'Ride Standar', motor_ev: 'Ride Listrik', car_economy: 'Car Hemat', car_standard: 'Car Standar', car_premium: 'Car Premium', car_ev: 'Car Listrik', car_ev_premium: 'Car Listrik Premium', box_pickup: 'Pick Up', box_van: 'Mobil Box' };
export const travelStatusLabel: Record<string, string> = { booked: 'Dipesan', confirmed: 'Terkonfirmasi', picked_up: 'Dalam perjalanan', completed: 'Selesai', cancelled: 'Dibatalkan' };
export const tripStatusLabel: Record<string, string> = { open: 'Menunggu penumpang', confirmed: 'Pasti berangkat', full: 'Penuh', departed: 'Berangkat', arrived: 'Tiba', cancelled: 'Dibatalkan' };
export const cityName = (cities: { id: string; name: string }[], id: string) => cities.find((c) => c.id === id)?.name ?? '—';

// ---------- Tahap 6 ----------
export const travelRequestStatusLabel: Record<string, string> = { open: 'Menunggu penawaran', offered: 'Ada penawaran', accepted: 'Diterima (bayar tunai)', paid: 'Dibayar · menunggu jadwal', ongoing: 'Sedang berjalan', completed: 'Selesai', cancelled: 'Dibatalkan', expired: 'Kedaluwarsa' };
export const travelKindLabel: Record<string, string> = { shared: 'Kursi bersama', charter: 'Carter privat', daily: 'Sopir harian' };
export const marketCategoryLabel: Record<string, string> = { sayur: 'Sayur', bumbu: 'Bumbu', daging_ikan: 'Daging & ikan', buah: 'Buah', sembako: 'Sembako', lainnya: 'Lainnya' };
export const storeBrandLabel: Record<string, string> = { indomaret: 'Indomaret', alfamart: 'Alfamart', alfamidi: 'Alfamidi', apotek: 'Apotek', supermarket: 'Supermarket', lainnya: 'Toko lain' };
export const storeCategoryLabel: Record<string, string> = { minimarket: 'Minimarket', apotek: 'Apotek', supermarket: 'Supermarket' };
export const productCategoryLabel: Record<string, string> = { sembako: 'Sembako', minuman: 'Minuman', snack: 'Camilan', obat: 'Obat & kesehatan', kebersihan: 'Kebersihan', bayi: 'Ibu & bayi', dapur: 'Dapur', lainnya: 'Lainnya' };
export const accommodationLabel: Record<string, string> = { customer: 'Akomodasi ditanggung pelanggan', self: 'Akomodasi sopir mandiri' };
/** Format tanggal + jam singkat: "Sab, 6 Sep 08.00" */
export const formatDateTimeShort = (iso?: string | null) => iso ? new Date(iso).toLocaleString('id-ID', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
