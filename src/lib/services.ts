import type { ServiceType } from './types';
import { colors } from './theme';

export interface ServiceDef {
  id: ServiceType | 'pay';
  art: 'rider' | 'car' | 'food' | 'send' | 'shop' | 'pay' | 'box' | 'travel' | 'market';
  label: string;
  tagline: string;
  icon: string; // nama ikon Ionicons
  color: string;
  route: string;
}

export const SERVICES: ServiceDef[] = [
  { id: 'ride_motor', label: 'AntarRide', tagline: 'Ojek motor cepat & hemat', icon: 'bicycle', art: 'rider', color: colors.ride, route: '/ride?service=ride_motor' },
  { id: 'ride_car', label: 'AntarCar', tagline: 'Mobil nyaman untuk keluarga', icon: 'car-sport', art: 'car', color: colors.car, route: '/ride?service=ride_car' },
  { id: 'food', label: 'AntarFood', tagline: 'Makanan favorit diantar', icon: 'restaurant', art: 'food', color: colors.food, route: '/food' },
  { id: 'send', label: 'AntarSend', tagline: 'Kirim paket dalam & antar kota', icon: 'cube', art: 'send', color: colors.send, route: '/send' },
  { id: 'box', label: 'AntarBox', tagline: 'Mobil box / pick up, pindahan rumah & kost', icon: 'bus', art: 'box', color: colors.box, route: '/box' },
  { id: 'travel', label: 'AntarTravel', tagline: 'Travel antar kota, jemput di rumah', icon: 'bus-outline', art: 'travel', color: colors.travel, route: '/travel' },
  { id: 'shop', label: 'AntarShop', tagline: 'Belanja Indomaret, Alfamart, apotek & supermarket', icon: 'basket', art: 'shop', color: colors.shop, route: '/shop' },
  { id: 'market', label: 'AntarMarket', tagline: 'Bahan masak dari pasar tradisional terdekat', icon: 'storefront', art: 'market', color: colors.market, route: '/market' },
  { id: 'pay', label: 'AntarVoucher', tagline: 'Saldo, e-wallet & metode bayar', icon: 'wallet', art: 'pay', color: colors.pay, route: '/(customer)/pay' },
];

export const serviceDef = (id: ServiceType) => SERVICES.find((s) => s.id === id)!;
/** Urutan tile beranda (AntarVoucher tidak di grid — sudah ada tab Pembayaran). */
export const HOME_SERVICES = SERVICES.filter((s) => s.id !== 'pay');

// Pusat kota default saat GPS belum tersedia (Padang, Sumatera Barat)
export const DEFAULT_CENTER = { lat: -0.9471, lng: 100.4172 };
