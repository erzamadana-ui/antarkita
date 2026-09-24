export type UserRole = 'customer' | 'driver' | 'merchant' | 'admin';
export type VehicleType = 'motor' | 'car' | 'box' | 'pickup';
export type ApprovalStatus = 'pending' | 'approved' | 'suspended' | 'rejected';
export type ServiceType = 'ride_motor' | 'ride_car' | 'food' | 'send' | 'shop' | 'box' | 'travel' | 'market';
export type Locale = 'id' | 'en' | 'zh' | 'ar';
export interface OrderExtra { id: string; kind: 'parking' | 'toll' | 'waiting' | 'other'; amount: number; note?: string | null; status: 'pending' | 'approved' | 'rejected'; created_at: string; responded_at?: string }
export interface ShoppingItem { name: string; qty: number; note?: string; product_id?: string; item_id?: string; unit?: string; price?: number; ref_price?: number }
export type OrderStatus = 'awaiting_payment' | 'scheduled' | 'searching' | 'accepted' | 'arrived' | 'in_progress' | 'completed' | 'cancelled';
export type MerchantOrderStatus = 'pending' | 'accepted' | 'ready' | 'rejected';
export type PaymentMethod = 'cash' | 'wallet';

export interface LatLng { lat: number; lng: number }
export interface Place extends LatLng { address: string; name?: string }

export interface Profile {
  id: string; full_name: string; phone: string | null; email: string | null; avatar_url: string | null;
  role: UserRole; is_active: boolean; created_at: string; locale?: Locale;
  emergency_contact_name?: string | null; emergency_contact_phone?: string | null; status_reason?: string | null; deletion_requested_at?: string | null;
}
export interface Wallet { user_id: string; balance: number; updated_at: string }
export interface WalletTx {
  id: string; user_id: string; type: 'topup' | 'payment' | 'earning' | 'refund' | 'withdrawal' | 'fee' | 'adjustment';
  amount: number; balance_after: number; order_id: string | null; note: string | null; created_at: string;
}
export interface TopupRequest {
  id: string; user_id: string; amount: number; method: string; proof_url: string | null; sender_note: string | null;
  status: 'pending' | 'approved' | 'rejected'; review_note: string | null; created_at: string; reviewed_at: string | null;
}
export interface WithdrawalRequest {
  id: string; user_id: string; amount: number; bank_name: string; bank_account: string; account_name: string;
  status: 'pending' | 'approved' | 'rejected'; review_note: string | null; created_at: string;
}
export interface Driver { vehicle_model?: string | null; fuel_type?: 'bensin' | 'diesel' | 'listrik' | 'hybrid' | null;
  id: string; vehicle_type: VehicleType; vehicle_brand: string | null; vehicle_plate: string; vehicle_color: string | null;
  status: ApprovalStatus; is_online: boolean; lat: number | null; lng: number | null;
  heading: number | null; last_seen_at: string | null; rating_avg: number; rating_count: number; total_trips: number;
  created_at: string; last_selfie_at?: string | null; last_selfie_url?: string | null;
  vehicle_year?: number | null; vehicle_condition?: 'standar' | 'baik' | 'sangat_baik'; is_electric?: boolean; vehicle_class?: string | null; vehicle_capacity?: string | null; status_reason?: string | null;
  profile?: Profile | null;
}
export interface DriverDocuments { driver_id: string; license_number: string | null; id_card_number: string | null; photo_id_url: string | null; photo_vehicle_url: string | null }
export interface Merchant {
  id: string; owner_id: string | null; name: string; description: string | null; category: string; address: string | null;
  lat: number | null; lng: number | null; image_url: string | null; is_open: boolean; status: ApprovalStatus;
  rating_avg: number; rating_count: number; prep_minutes: number; opening_hours: string | null; created_at: string;
  distance_km?: number; delivery_fee?: number; is_halal?: boolean; halal_verified?: boolean;
  /** nearby_merchants_v2 (0101/v3): iklan berbayar yang sedang tayang — ditampilkan di blok "Sponsored" terpisah, bukan di ranking organik. */
  boosted?: boolean; featured?: boolean; ad_label?: string | null;
  /** v3 (§7): kampanye berbayar yang membuat merchant ini berlabel 'Sponsored' (null = organik). */
  campaign_id?: string | null;
}
export interface MerchantDocuments {
  merchant_id: string; owner_phone: string | null; npwp_no: string | null; npwp_url: string | null; license_no: string | null; license_url: string | null;
  halal_cert_no: string | null; halal_cert_url: string | null; owner_id_card_url: string | null; place_photo_url: string | null;
  bank_name: string | null; bank_account: string | null; bank_holder: string | null;
  submitted_at: string; reviewed_at: string | null; reviewed_by: string | null; review_note: string | null;
}
export interface MenuItem {
  id: string; merchant_id: string; name: string; description: string | null; price: number; image_url: string | null;
  category: string | null; is_available: boolean; sort_order: number;
}
export interface OrderItem { id: string; order_id: string; menu_item_id: string | null; name: string; price: number; qty: number; notes: string | null }
export interface OrderEvent { id: number; order_id: string; status: string; actor_id: string | null; note: string | null; created_at: string }
export interface OrderMessage { id: number; order_id: string; sender_id: string; body: string; created_at: string }

export interface Order {
  id: string; code: string; service: ServiceType; customer_id: string; driver_id: string | null; merchant_id: string | null;
  status: OrderStatus; merchant_status: MerchantOrderStatus | null;
  pickup_address: string; pickup_lat: number; pickup_lng: number; dropoff_address: string; dropoff_lat: number; dropoff_lng: number;
  distance_km: number; duration_min: number; route_geometry: [number, number][] | null;
  fare_delivery: number; items_subtotal: number; platform_fee: number; discount: number; promo_code: string | null; total: number;
  driver_earning: number; merchant_earning: number; payment_method: PaymentMethod; payment_status: 'unpaid' | 'paid' | 'refunded';
  notes: string | null; recipient_name: string | null; recipient_phone: string | null;
  package_details: { type?: string; weight?: string; description?: string; dest_address?: string; size_cm?: string | number; via?: string } | null;
  shopping_list?: ShoppingItem[] | null; est_budget?: number; shop_store?: string | null; receipt_url?: string | null;
  tip?: number; extras?: OrderExtra[]; extras_total?: number; share_token?: string | null;
  city?: string | null; send_scope?: 'in_city' | 'intercity'; dest_city_id?: string | null; warehouse_id?: string | null; origin_warehouse_id?: string | null;
  weight_kg?: number | null; intercity_fare?: number; scheduled_at?: string | null; vehicle_class?: string | null; helpers?: number; purpose?: string | null; paid_via?: string | null;
  // tahap 6: belanja katalog / pasar
  shop_store_id?: string | null; market_id?: string | null; shop_vehicle?: 'motor' | 'car'; service_fee?: number; driver_service_share?: number; actual_items?: ShoppingItem[] | null;
  // tahap 9: titipan AntarSend antar kota yang dibawa mitra travel
  travel_partner_id?: string | null;
  // Skema Bisnis v2 (0099/0100): snapshot aturan, pemilik promo, biaya payment gateway, pendapatan akhir driver
  driver_earning_final?: number | null; ledger_version?: number | null; promo_funded_by?: PromoFunder | null;
  driver_commission_pct_snap?: number | null; merchant_fee_pct_snap?: number | null;
  pg_channel?: string | null; pg_fee?: number | null; pg_fee_ppn?: number | null; pg_fee_borne_by?: PgFeePolicy | null;
  // Finpay v3 (§2, §7): kode bantuan CS pembayaran, status penyelesaian dana, kampanye iklan yang menghasilkan pesanan
  payment_support_ref?: string | null; settlement_status?: 'ORDER_COMPLETED' | 'PAYOUT_PENDING' | 'PAYOUT_SETTLED' | 'RECONCILED' | null; ad_campaign_id?: string | null;
  // tahap 11 (0030): AntarNow — driver tujuan langsung dari kode driver (null = pencarian normal)
  preferred_driver_id?: string | null;
  cancel_reason: string | null; created_at: string; accepted_at: string | null; arrived_at: string | null; started_at: string | null;
  completed_at: string | null; cancelled_at: string | null;
  // relasi opsional
  driver?: Driver | null; customer?: Profile | null; merchant?: Merchant | null; order_items?: OrderItem[];
}

export interface ServiceLimit { ok: boolean; max_km: number | null; same_city_required: boolean; same_city: boolean; message?: string | null }
export interface FareEstimate { distance_km: number; straight_km: number; fare: number; platform_fee: number; /** 0099: biaya platform pelanggan dari service_economics (= platform_fee). */ customer_platform_fee?: number; total: number; duration_min: number; limit?: ServiceLimit | null; service_enabled?: boolean; demand?: { multiplier: number; demand: number; supply: number } | null; session?: { name: string; level: 'low' | 'middle' | 'high'; multiplier: number } | null }

export interface Pricing {
  service: ServiceType; base_fare: number; per_km: number; per_min: number; min_fare: number; platform_fee: number;
  commission_pct: number; merchant_commission_pct: number; surge_multiplier: number;
}
export interface Promo {
  code: string; description: string | null; discount_type: 'fixed' | 'percent'; value: number; max_discount: number | null;
  min_total: number; service: ServiceType | null; quota: number | null; used_count: number; valid_from: string | null;
  valid_to: string | null; is_active: boolean; title?: string | null; image_url?: string | null; sort_order?: number;
  /** 0099: pemilik biaya promo */ funded_by?: PromoFunder | null;
}
export interface SavedPlace { id: string; user_id: string; label: string; address: string; lat: number; lng: number }

export interface AvailableOrder {
  id: string; code: string; service: ServiceType; pickup_address: string; dropoff_address: string;
  pickup_lat: number; pickup_lng: number; dropoff_lat: number; dropoff_lng: number; distance_km: number;
  fare_delivery: number; items_subtotal: number; total: number; driver_earning: number; payment_method: PaymentMethod;
  merchant_status: MerchantOrderStatus | null; created_at: string; distance_to_pickup_km: number; merchant_name: string | null;
  vehicle_class?: string | null; helpers?: number; scheduled_at?: string | null; send_scope?: string | null;
  /** Tahap 9 (0025): info muatan & antrean — dipakai kartu order aplikasi Mitra. */
  shop_vehicle?: 'motor' | 'car' | null; driver_service_share?: number | null;
  weight_kg?: number | null; parcel_size_cm?: number | null; waiting_minutes?: number | null; priority_note?: string | null;
  /**
   * Tahap 11 (0030) — AntarNow.
   * `direct_for_me` true bila order dipesan lewat kode driver SAYA dan masih dalam masa tahan;
   * `direct_hold_left_s` sisa masa tahan dalam detik (null bila order bukan order langsung).
   */
  direct_for_me?: boolean | null; direct_hold_left_s?: number | null;
}

export interface PricingSession { id: string; name: string; level: 'low' | 'middle' | 'high'; days: number[]; start_time: string; end_time: string; multiplier: number; driver_bonus_pct: number; services: ServiceType[] | null; active: boolean; note: string | null }
export interface CompetitorPrice { id: string; competitor: string; service: ServiceType; base_fare: number; per_km: number; min_fare: number; level: 'low' | 'middle' | 'high'; city: string | null; source: string | null; captured_at: string; note: string | null }
export interface Payment { id: string; user_id: string; order_id: string | null; purpose: 'topup' | 'order'; amount: number; method: string; provider: string; status: 'pending' | 'settlement' | 'expire' | 'cancel' | 'deny' | 'failure'; external_id: string | null; snap_token: string | null; redirect_url: string | null; created_at: string }
export interface CallLog { id: string; order_id: string | null; caller_id: string; callee_id: string; status: 'ringing' | 'answered' | 'missed' | 'declined' | 'ended'; started_at: string; answered_at: string | null; ended_at: string | null }

// ---- Tahap 4 ----
export type TicketStatus = 'open' | 'in_progress' | 'waiting_user' | 'resolved' | 'closed';
export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent';
export type TicketCategory = 'order' | 'payment' | 'driver' | 'merchant' | 'account' | 'app' | 'safety' | 'other';
export interface Ticket {
  id: string; code: string; user_id: string; role: UserRole; order_id: string | null; category: TicketCategory; subject: string; description: string | null;
  priority: TicketPriority; status: TicketStatus; assigned_to: string | null; attachments: string[]; last_message_at: string; first_response_at: string | null;
  resolved_at: string | null; closed_at: string | null; rating: number | null; rating_comment: string | null; created_at: string; updated_at: string;
  user?: Profile | null; assignee?: Profile | null; order?: Pick<Order, 'code' | 'service' | 'status'> | null;
}
export interface TicketMessage { id: number; ticket_id: string; sender_id: string | null; sender_role: 'user' | 'cs' | 'system'; body: string; attachment_url: string | null; is_internal: boolean; created_at: string }
export interface AuditLog { id: number; actor_id: string | null; actor_name: string | null; actor_role: UserRole | null; action: string; entity: string; entity_id: string | null; summary: string | null; detail: Record<string, unknown> | null; created_at: string }
export interface SosAlert { id: string; user_id: string; role: UserRole; order_id: string | null; ticket_id: string | null; lat: number | null; lng: number | null; note: string | null; status: 'open' | 'handled' | 'false_alarm'; handled_by: string | null; handled_at: string | null; handle_note: string | null; created_at: string; user?: Profile | null }
export interface FrequentData {
  merchants: { merchant_id: string; name: string; image_url: string | null; category: string; rating_avg: number; is_halal: boolean; halal_verified: boolean; is_open: boolean; count: number; last_at: string }[];
  routes: { service: ServiceType; dropoff_address: string; dropoff_lat: number; dropoff_lng: number; pickup_address: string; pickup_lat: number; pickup_lng: number; shop_store: string | null; count: number; last_at: string }[];
  services: Partial<Record<ServiceType, number>>;
  recent: { address: string; lat: number; lng: number; service: ServiceType }[];
}
export interface SharedOrder {
  code: string; service: ServiceType; status: OrderStatus; created_at: string; started_at: string | null; completed_at: string | null;
  pickup_address: string; pickup_lat: number; pickup_lng: number; dropoff_address: string; dropoff_lat: number; dropoff_lng: number;
  route_geometry: [number, number][] | null; distance_km: number; duration_min: number; customer_name: string;
  driver: { name: string; avatar_url: string | null; plate: string; vehicle_type: VehicleType; vehicle_brand: string | null; vehicle_color: string | null; rating: number; lat: number | null; lng: number | null; heading: number | null } | null;
}

// ---- Tahap 5 ----
export interface VehicleClass { code: string; vehicle: VehicleType; service: ServiceType; label: string; description: string | null; multiplier: number; rank: number; is_ev: boolean; seats: number | null; sort: number; active: boolean }
export interface FareOption { code: string; label: string; description: string | null; is_ev: boolean; seats: number | null; rank: number; multiplier: number; fare: number; total: number; drivers_nearby: number }
export interface FareOptions extends FareEstimate { helpers_fee: number; classes: FareOption[] }
export interface City { id: string; name: string; province: string | null; lat: number | null; lng: number | null; active: boolean }
export interface Warehouse { id: string; city_id: string; name: string; type: 'big' | 'small'; partner_name: string | null; address: string | null; lat: number | null; lng: number | null; phone: string | null; open_hours: string | null; capacity_note: string | null; active: boolean }
export interface IntercityRate { id: string; from_city: string; to_city: string; base_fare: number; per_kg: number; eta_days: number; active: boolean }
export interface IntercityEstimate { base_fare: number; per_kg: number; eta_days: number; weight_kg: number; fare: number }
export interface AppNotification { id: number; user_id: string; kind: 'promo' | 'system' | 'order'; title: string; body: string | null; image_url: string | null; promo_code: string | null; merchant_id: string | null; data: Record<string, unknown> | null; read_at: string | null; created_at: string }
export interface Blast { id: string; admin_id: string | null; title: string; body: string | null; image_url: string | null; promo_code: string | null; merchant_id: string | null; target: 'all' | 'city' | 'active30' | 'customers'; city_id: string | null; sent_count: number; created_at: string }
export interface PaymentPrefs { user_id: string; default_method: 'cash' | 'wallet' | 'ewallet'; ewallet: 'gopay' | 'ovo' | 'dana' | 'shopeepay' | 'qris' | 'bank_transfer' | null }
export interface ExecAccess { user_id: string; level: 'vp' | 'ceo' | 'cfo' | 'shareholder'; active: boolean; last_login_at: string | null }
export interface TrafficStats { months: string[]; cities: { city: string; total: number; series: number[] }[]; services: { service: ServiceType; orders: number; gmv: number; share: number }[]; this_month: { orders: number; gmv: number }; last_month: { orders: number; gmv: number } }
export interface ExecReport {
  level: string; generated_at: string; from: string;
  summary: { gmv: number; orders: number; completed: number; cancelled: number; revenue: number; driver_payout: number; merchant_payout: number; avg_ticket: number; customers: number; cities: number };
  prev_gmv: number;
  monthly: { month: string; gmv: number; orders: number; completed: number; revenue: number; new_users: number; new_drivers: number; promo?: number; driver_payout?: number; topups?: number; withdrawals?: number }[];
  by_service: { service: ServiceType; orders: number; gmv: number; revenue?: number }[];
  by_city: { city: string; orders: number; gmv: number; customers: number }[];
  top_merchants: { name: string; orders: number; gmv: number }[];
  supply: { drivers_total: number; drivers_online: number; drivers_pending: number; merchants_total: number; merchants_pending: number; users_total: number; wallet_float: number; wallet_negative: number; vendors_total?: number; vendors_pending?: number; travel_partners?: number };
  quality: { cancel_rate: number; avg_driver_rating: number | null; tickets: number; tickets_open: number; avg_first_response_min: number | null; cs_rating: number | null; sos: number };
  // Tahap 7: keuangan, anti-fraud, otomasi & rekomendasi
  finance?: ExecFinance;
  fraud?: { open: number; open_high: number; auto_suspended: number };
  automation?: { auto_verified: number; auto_payouts: number; place_suggestions: number; place_auto_approved: number };
  gmv_growth_pct?: number | null;
  recommendations?: Recommendation[];
}
export interface ExecFinance { gmv: number; revenue: number; take_rate_pct: number; promo_discount: number; promo_pct_gmv: number; tips: number; refunds: number; topups: number; topups_gateway: number; withdrawals: number; withdrawals_pending: number; topups_pending: number; wallet_liability: number; receivable_negative: number; gateway_fee_pct: number; gateway_fee_est: number; cash_orders_pct: number; net_revenue: number; contribution_margin_pct: number }
// ---- AntarTravel ----
export interface TravelRoute { id: string; from_city: string; to_city: string; distance_km: number; duration_h: number; seat_price: number; private_price: number; private_price_large: number | null; min_pax: number; active: boolean }
export type TravelPartnerType = 'agency' | 'private';
export type TravelAccommodation = 'customer' | 'self';
export interface TravelPartner { id: string; company_name: string | null; vehicle_model: string; vehicle_plate: string; vehicle_year: number | null; seats: number; is_electric: boolean; photo_url: string | null; license_url: string | null; permit_url: string | null; status: ApprovalStatus; status_reason: string | null; rating_avg: number; rating_count: number; total_trips: number; created_at: string; profile?: Profile | null;
  partner_type?: TravelPartnerType; offers_shared?: boolean; offers_charter?: boolean; offers_daily?: boolean; daily_rate?: number | null; overtime_rate?: number | null; charter_rate_km?: number | null; accommodation?: TravelAccommodation[]; accommodation_fee?: number; fuel_included?: boolean; base_city_id?: string | null; bio?: string | null; driver_name?: string | null }
export type TravelTripStatus = 'open' | 'confirmed' | 'full' | 'departed' | 'arrived' | 'cancelled';
export interface TravelTrip { id: string; partner_id: string; route_id: string; depart_at: string; seats_total: number; seats_booked: number; min_pax: number; seat_price: number; private_price: number; allow_private: boolean; is_private: boolean; status: TravelTripStatus; notes: string | null; created_at: string; route?: TravelRoute | null }
export interface TravelSearchTrip { id: string; depart_at: string; seats_total: number; seats_booked: number; seats_left: number; min_pax: number; seat_price: number; private_price: number; allow_private: boolean; status: TravelTripStatus; notes: string | null; partner: { id: string; company: string | null; model: string; plate: string; seats: number; is_electric: boolean; photo_url: string | null; rating: number; rating_count: number; total_trips: number; name: string; avatar_url: string | null } }
export interface TravelSearch { route: TravelRoute | null; trips: TravelSearchTrip[] }
export type TravelBookingStatus = 'booked' | 'confirmed' | 'picked_up' | 'completed' | 'cancelled';
export interface TravelBooking { id: string; code: string; trip_id: string; customer_id: string; pax: number; is_private: boolean; pickup_address: string; pickup_lat: number | null; pickup_lng: number | null; dropoff_address: string | null; passengers: { name: string; phone?: string }[]; price: number; platform_fee: number; partner_earning: number; payment_method: PaymentMethod; paid_via: string | null; payment_status: 'unpaid' | 'paid' | 'refunded'; status: TravelBookingStatus; notes: string | null; rating: number | null; created_at: string; trip?: TravelTrip | null }
export interface TravelManifestRow { id: string; code: string; pax: number; is_private: boolean; pickup_address: string; pickup_lat: number | null; pickup_lng: number | null; dropoff_address: string | null; passengers: { name: string }[]; price: number; payment_method: PaymentMethod; payment_status: string; status: TravelBookingStatus; notes: string | null; customer: { id: string; name: string; avatar_url: string | null } }

// ---------- Tahap 6: AntarShop katalog & AntarMarket ----------
export interface ShopStore { osm_id?: string | null; id: string; name: string; brand: 'indomaret' | 'alfamart' | 'alfamidi' | 'apotek' | 'supermarket' | 'lainnya' | string; category: 'minimarket' | 'apotek' | 'supermarket' | string; address: string | null; lat: number; lng: number; city_id?: string | null; open_hours: string | null; phone?: string | null; image_url: string | null; catalog_source?: string; active?: boolean; distance_km?: number; product_count?: number; is_open_now?: boolean; created_at?: string }
export interface ShopProduct { id: string; store_id: string; sku: string | null; name: string; category: string; unit: string; price: number; image_url: string | null; in_stock: boolean; stock: number | null; active: boolean; updated_at: string }
export interface Market { osm_id?: string | null; id: string; name: string; address: string | null; lat: number; lng: number; city_id?: string | null; open_hours: string | null; image_url: string | null; notes: string | null; active?: boolean; distance_km?: number; is_open_now?: boolean; created_at?: string }
export type MarketCategory = 'sayur' | 'bumbu' | 'daging_ikan' | 'buah' | 'sembako' | 'lainnya';
export interface MarketItem { id: string; name: string; category: MarketCategory | string; unit: string; image_url: string | null; sort: number; ref_price: number; price: number; price_source: string; price_updated_at: string; samples: number; active?: boolean }
export interface MarketPriceStat { item_id: string; name: string; unit: string; ref_price: number; driver_median: number | null; driver_samples: number; last_seen: string | null }
export interface ShoppingEstimate extends FareEstimate { service_fee: number; subtotal: number; fare_motor: number; fare_car: number; car_min_budget: number }
export interface CartLine { key: string; name: string; qty: number; unit: string; price: number; product_id?: string; item_id?: string; note?: string }

// ---------- Tahap 6: AntarTravel v2 (carter privat & sopir harian) ----------
export type TravelRequestKind = 'charter' | 'daily';
export type TravelRequestStatus = 'open' | 'offered' | 'accepted' | 'paid' | 'ongoing' | 'completed' | 'cancelled' | 'expired';
export interface TravelPartnerCard { id: string; name: string; company_name: string | null; partner_type: TravelPartnerType; vehicle_model: string; vehicle_year: number | null; seats: number; is_electric: boolean; photo_url: string | null; avatar_url: string | null; rating_avg: number; rating_count: number; total_trips: number; daily_rate: number | null; overtime_rate: number | null; accommodation: TravelAccommodation[]; accommodation_fee: number; fuel_included: boolean; base_city: string | null; bio: string | null }
export interface TravelOffer { id: string; request_id?: string; partner_id?: string; price: number; breakdown: { daily_rate?: number; days?: number; accommodation_nights?: number; accommodation_fee?: number; fuel_est?: number; overtime_rate?: number; notes?: string } | null; message: string | null; status: 'offered' | 'accepted' | 'rejected' | 'withdrawn'; created_at: string; partner?: TravelPartnerCard & { driver_name?: string | null; vehicle_plate?: string } }
export interface TravelRequest { id: string; code: string; customer_id: string; kind: TravelRequestKind; partner_id: string | null; from_city: string | null; to_city: string | null; pickup_address: string; pickup_lat: number | null; pickup_lng: number | null; dropoff_address: string | null; dropoff_lat: number | null; dropoff_lng: number | null; depart_at: string; return_at: string | null; days: number; pax: number; luggage: string | null; accommodation: TravelAccommodation; fuel: 'customer' | 'partner'; vehicle_pref: string | null; notes: string | null; budget: number | null; status: TravelRequestStatus; accepted_offer_id: string | null; price: number; platform_fee: number; partner_earning: number; payment_method: PaymentMethod; paid_via: string; payment_status: 'unpaid' | 'paid' | 'refunded'; rating: number | null; rating_comment: string | null; created_at: string; updated_at?: string;
  from_city_name?: string | null; to_city_name?: string | null; customer?: { id: string; name: string; avatar_url: string | null } | null; offers?: TravelOffer[] }
export interface TravelOpenRequest { id: string; code: string; kind: TravelRequestKind; pickup_address: string; dropoff_address: string | null; depart_at: string; return_at: string | null; days: number; pax: number; luggage: string | null; accommodation: TravelAccommodation; fuel: 'customer' | 'partner'; vehicle_pref: string | null; notes: string | null; budget: number | null; status: TravelRequestStatus; from_city: string | null; to_city: string | null; customer_name: string; my_offer: TravelOffer | null; offers_count: number; created_at: string }
export interface AdminTravelRequestRow { id: string; code: string; kind: TravelRequestKind; status: TravelRequestStatus; customer_name: string; partner_name: string | null; pickup_address: string; dropoff_address: string | null; depart_at: string; days: number; pax: number; price: number; platform_fee: number; payment_status: string; offers_count: number; created_at: string }

// ---------- Tahap 6: payment gateway ----------
export interface GatewayPublicConfig { provider: string; methods: string[]; topup_min: number; topup_max: number; configured: boolean; is_production: boolean; client_key: string | null; /** 0088 */ antarpay_enabled?: boolean; /** 0089: status EFEKTIF tiap saluran */ payment_channels?: PaymentChannels }
export interface GatewayStatus extends GatewayPublicConfig { server_key_masked: string | null; merchant_id: string | null; updated_at: string | null; updated_by: string | null; last_webhook_at: string | null; stats: { total: number; settlement: number; pending: number; failed: number; amount_settled: number; simulated: number; last_7d: number }; recent: (Payment & { user: string | null })[] }

// ---------- Tahap 7 ----------
export type VendorGrade = 'A' | 'B' | 'C';
export interface MarketVendor { id: string; market_id: string; stall_name: string; stall_no: string | null; categories: string[]; description: string | null; photo_url: string | null; id_card_url: string | null; market_card_url: string | null; phone: string | null; bank_name: string | null; bank_account: string | null; bank_holder: string | null; status: ApprovalStatus; status_reason: string | null; quality_score: number; rating_avg: number; rating_count: number; total_orders: number; open_hours: string | null; created_at: string; updated_at: string; market_name?: string; owner_name?: string; owner_phone?: string; items?: number; items_photo?: number }
export interface MarketVendorItem { id: string; vendor_id: string; item_id: string | null; name: string; category: string; unit: string; price: number; grade: VendorGrade; origin: string | null; photo_url: string | null; in_stock: boolean; active: boolean; updated_at: string; ref_price?: number | null }
export interface VendorCatalogEntry { id: string; stall_name: string; stall_no: string | null; categories: string[]; photo_url: string | null; quality_score: number; rating_avg: number; rating_count: number; open_hours: string | null; items: MarketVendorItem[] }
export type PlaceSuggestionStatus = 'pending' | 'approved' | 'rejected' | 'merged';
export interface PlaceSuggestion { id: string; kind: 'store' | 'market'; target_id: string | null; name: string; brand: string | null; category: string | null; address: string | null; lat: number; lng: number; open_hours: string | null; phone: string | null; notes: string | null; photo_url: string | null; submitted_by: string; reports: number; status: PlaceSuggestionStatus; auto: boolean; reviewed_by: string | null; reviewed_at: string | null; review_note: string | null; created_at: string; updated_at: string; submitter?: string; existing_name?: string | null; nearby_conflicts?: number }
export interface FraudFlag { id: string; kind: string; severity: 'low' | 'med' | 'high'; subject_id: string | null; order_id: string | null; detail: Record<string, unknown>; auto_action: string | null; status: 'open' | 'confirmed' | 'dismissed'; reviewed_by: string | null; reviewed_at: string | null; review_note: string | null; created_at: string; subject_name?: string | null; subject_role?: string | null; order_code?: string | null; driver_status?: string | null }
export interface SecurityEvent { id: number; kind: string; user_id: string | null; detail: Record<string, unknown>; created_at: string; user_name?: string | null }
export interface ScheduledReport { id: string; name: string; cadence: 'daily' | 'weekly' | 'monthly'; hour: number; months: number; recipients: string[]; active: boolean; last_run_at: string | null; next_run_at: string | null; created_at: string }
export interface ReportRun { id: number; name: string; period: string; created_at: string; summary: Record<string, number>; finance: Record<string, number>; recommendations: Recommendation[] }
export interface Recommendation { priority: 'high' | 'med' | 'low'; area: string; title: string; detail: string; action: string }
export interface AutomationRun { id: number; kind: string; started_at: string; finished_at: string | null; ok: boolean; count: number; detail: Record<string, unknown>; triggered_by: string | null }

/** Batas berat & sisi terpanjang AntarSend per kendaraan (app_settings.send_limits). */
export interface SendLimit { max_kg: number; max_cm: number }
export type SendVehicle = 'motor' | 'car' | 'box' | 'travel';
export type SendLimits = Record<SendVehicle, SendLimit>;
export interface PriorityTier { min_rating: number; delay_s: number }
export interface AppPublicSettings {
  services_enabled: Record<string, boolean>; max_km: Record<string, number>; osm_import_enabled: boolean; osm_import_radius_km: number;
  /** Tahap 9 */
  pickup_radius_km: Record<string, number>; send_limits: SendLimits; priority_tiers: PriorityTier[]; wait_apology_minutes: number;
  /** 0088: sakelar AntarPay dari Panel Admin. false/tidak ada = nonaktif (top up, pencairan, bayar dompet/e-wallet ditolak server). */
  antarpay_enabled: boolean;
  /** 0089: status EFEKTIF tiap saluran pembayaran (sudah memperhitungkan sakelar global AntarPay). */
  payment_channels: PaymentChannels;
}

/** 0089: peta saluran pembayaran → aktif/tidak (`payment_channels_public()`). */
export type PaymentChannels = Record<string, boolean>;
/** 0089: balasan `admin_set_payment_channel()` / `admin_payment_channels()`. */
export interface AdminPaymentChannels { payment_channels: PaymentChannels; effective: PaymentChannels; antarpay_enabled: boolean; pg_methods: string[];
  /** 0104: sakelar bayar PER PESANAN lewat gateway (terpisah dari AntarPay/top up) */ gateway_order_payment_enabled?: boolean;
  /** 0104: saluran yang boleh dipakai membayar satu pesanan */ order_payment_channels?: PaymentChannels }
/** Satu baris `admin_business_settings().settings` (0104) — ambang bisnis yang bisa diubah lewat admin_set_settings (PIN). */
export interface BusinessSetting {
  key: string; value: number; default: number; min: number; max: number; integer: boolean;
  unit: string; label: string; note: string | null; stored: boolean;
}
export interface AdminBusinessSettings { settings: BusinessSetting[] | null; requires_pin: boolean; gateway_order_payment_enabled: boolean; antarpay_enabled: boolean }

// ---------- Tahap 9: dispatch driver (prioritas rating, tolak order, titipan travel) ----------
/** Hasil `rpc('driver_priority_info')` — antrean prioritas driver berdasarkan rating. */
export interface DriverPriorityInfo {
  rating: number; rating_count: number; tier_delay_s: number; next_tier_rating: number | null;
  is_new_driver: boolean; drivers_ahead: number; tiers: PriorityTier[];
}
/** Alasan singkat saat driver menolak order (chip di aplikasi Mitra). */
export type DriverRejectReason = 'Terlalu jauh' | 'Muatan berat/besar' | 'Arah berlawanan' | 'Sedang istirahat' | 'Lainnya';
/** Satu baris `rpc('travel_send_available')` — titipan AntarSend antar kota yang menunggu mitra travel. */
export interface TravelSendOrder {
  id: string; code: string; pickup_address: string; dropoff_address: string;
  city: string | null; dest_city: string | null;
  weight_kg: number | null; size_cm: number | null; package_details: Order['package_details'];
  recipient_name: string | null; total: number; intercity_fare: number; partner_earning: number;
  payment_method: PaymentMethod; payment_status: 'unpaid' | 'paid' | 'refunded'; created_at: string;
}

// ---------- Tahap 11 (0030): AntarNow — pesan driver tertentu lewat kode 6 karakter ----------
/** Hasil `rpc('driver_my_code')` — kartu "Kode AntarNow saya" di aplikasi Mitra. */
export interface DriverMyCode { code: string; orders_direct_today: number; share_text: string }
/** Hasil `rpc('driver_by_code', { p_code })` — pratinjau driver di aplikasi Pelanggan sebelum memesan. */
export interface DriverByCode {
  id: string; code: string; name: string | null; avatar_url: string | null;
  vehicle_type: VehicleType; vehicle_class: string | null;
  vehicle_brand: string | null; vehicle_model: string | null; vehicle_plate: string | null;
  rating_avg: number; rating_count: number; total_trips: number;
  is_online: boolean; last_seen_minutes: number | null;
  /** Kode layanan yang bisa diambil kendaraan driver ini (ride_motor, food, send, …). */
  services: ServiceType[];
}
/** Hasil `rpc('driver_direct_stats')` — statistik order langsung + setelan masa tahan. */
export interface DriverDirectStats {
  code: string | null; today: number; this_week: number; total: number; completed: number;
  /** Lama order hanya ditawarkan ke driver tujuan (detik). */
  hold_seconds: number;
  /** true = order dilempar ke driver lain setelah masa tahan habis. */
  fallback: boolean;
}

// ---------- 0076–0080: gerbang wilayah operasi (status kota & layanan per kota) ----------
/** Status operasi sebuah kota. `luar_jangkauan`/`tidak_diketahui` hanya muncul dari hasil RPC, bukan kolom tabel. */
export type CityStatusKind = 'aktif' | 'segera' | 'belum_dilayani' | 'luar_jangkauan' | 'tidak_diketahui';

/** Hasil `rpc('city_service_status', { p_lat, p_lng })` — semua teksnya sudah Bahasa Indonesia dari server. */
export interface CityServiceStatus {
  /** true bila ada minimal satu layanan yang bisa dipesan dari titik ini. */
  ok: boolean;
  /** true bila titik berada di dalam radius sebuah kota (walau kotanya belum dilayani). */
  in_range: boolean;
  status: CityStatusKind;
  city_id: string | null;
  city_name: string | null;
  province: string | null;
  distance_km: number | null;
  /** Peta layanan → boleh dipesan di sini (sudah memperhitungkan sakelar global admin). */
  services: Record<string, boolean>;
  /** Nama layanan yang sudah/belum dibuka, siap ditampilkan (mis. "AntarShop"). */
  open_services: string[];
  closed_services: string[];
  waitlist_open: boolean;
  headline: string;
  body: string;
}

/** Hasil `rpc('city_gate', …)` — dipakai UI untuk menampilkan alasan yang sama persis dengan create_order. */
export interface CityGateResult {
  ok: boolean;
  reason?: 'aktif' | 'kota_tertutup' | 'layanan_tertutup' | 'luar_jangkauan' | 'tanpa_lokasi';
  city_id?: string | null; city_name?: string | null; status?: CityStatusKind; distance_km?: number | null;
  message?: string | null;
}

/** Hasil `rpc('city_waitlist_mine', { p_city_id })`. */
export interface CityWaitlistMine { joined: boolean; services?: string[] | null; total: number }
/** Hasil `rpc('city_waitlist_join', …)`. */
export interface CityWaitlistJoin { ok: boolean; city_id: string; city_name: string | null; total: number; message: string }

/** Satu baris `rpc('admin_list_cities')` — Panel Admin · Kota & Wilayah. */
export interface AdminCityRow {
  id: string; name: string; province: string | null; lat: number | null; lng: number | null;
  /** Arti LAMA: kota terdaftar di sistem (nearest_city, impor tempat, rute travel). */
  active: boolean;
  /** Arti BARU: status operasi. */
  service_status: Exclude<CityStatusKind, 'luar_jangkauan' | 'tidak_diketahui'>;
  status_note: string | null; status_changed_at: string | null; radius_km: number;
  manager_id: string | null; manager_name: string | null; manager_note: string | null;
  services: Record<string, boolean>;
  waitlist: number; waitlist_30d: number;
  drivers: { approved: number; online: number; recent: number; pending: number };
  orders_30d: number;
}
/** Satu baris `rpc('admin_city_waitlist', { p_city_id })`. */
export interface AdminWaitlistRow { id: string; name: string | null; phone: string | null; services: string[] | null; note: string | null; created_at: string }
/** Pilihan Perwakilan Kota dari `rpc('admin_city_manager_options')`. */
export interface AdminManagerOption { id: string; name: string | null; phone: string | null }

/* ───────────────── Skema Bisnis v2 (migrasi 0098–0103) — bentuk data RPC Panel Admin ───────────────── */

export type PgFeePolicy = 'platform' | 'customer';
export type PromoFunder = 'platform' | 'merchant' | 'sponsor';

/** Satu baris `service_economics` (0098) — `rpc('admin_service_economics')` / hasil `admin_set_service_economics`. */
export interface ServiceEconomics {
  service: ServiceType;
  driver_commission_pct: number; merchant_fee_pct: number; customer_platform_fee: number;
  service_fee_pct: number; service_fee_min: number; service_fee_driver_share_pct: number;
  pg_fee_policy: PgFeePolicy; promo_default_funded_by: PromoFunder;
  notes: string | null; updated_at: string | null; updated_by: string | null;
}

/** Enum `ledger_entry` (0099). */
export type LedgerEntry =
  | 'gross_customer' | 'items_subtotal' | 'delivery_fee' | 'customer_platform_fee' | 'service_fee' | 'intercity_fare' | 'tip' | 'extras'
  | 'promo_platform' | 'promo_merchant' | 'promo_sponsor' | 'driver_commission' | 'merchant_fee'
  | 'driver_payable' | 'merchant_payable' | 'vendor_payable' | 'partner_payable'
  | 'platform_revenue' | 'pg_fee' | 'pg_fee_ppn' | 'driver_receivable' | 'refund' | 'adjustment' | 'ads_revenue';
export type LedgerParty = 'customer' | 'driver' | 'merchant' | 'vendor' | 'partner' | 'platform' | 'gateway' | 'sponsor';
export type LedgerPhase = 'created' | 'completed' | 'cancelled' | 'refunded' | 'settled' | 'adjusted';

/** Satu baris `entries` dari `ledger_calc` / `ledger_simulate` (0099). */
export interface LedgerCalcEntry { entry: LedgerEntry; amount: number; party_role: LedgerParty; party_id?: string | null; funded_by?: string | null; note?: string | null }

/** `rpc('ledger_simulate', …)` (0099) = keluaran `ledger_calc` + penanda simulasi. */
export interface LedgerSimulation {
  gross_customer: number; components_total: number; total: number;
  delivery_fee: number; customer_platform_fee: number; items_subtotal: number; service_fee: number; driver_service_share: number;
  intercity_fare: number; tip: number; extras: number; discount: number;
  driver_commission_pct: number; driver_commission: number; bonus: number; merchant_fee_pct: number; merchant_fee: number;
  promo_funded_by: PromoFunder; promo_platform: number; promo_merchant: number; promo_sponsor: number;
  driver_payable: number; merchant_payable: number; vendor_payable: number; partner_payable: number;
  platform_revenue: number; pg_fee: number; pg_fee_ppn: number; pg_fee_borne_by: PgFeePolicy; pg_channel: string | null;
  contribution: number; driver_receivable: number; payment_method: PaymentMethod; has_driver: boolean;
  balanced: boolean; diff: number; diff_components: number;
  entries: LedgerCalcEntry[];
  simulated: true; service: ServiceType; channel: string; rules: ServiceEconomics | null;
}

/** Satu baris tabel `order_ledger` (0099). */
export interface OrderLedgerRow {
  id: number; order_id: string | null; source: 'orders' | 'travel_bookings' | 'travel_requests' | 'merchant_ads'; source_id: string | null;
  service: ServiceType | null; city_id: string | null; city: string | null; entry: LedgerEntry; amount: number;
  party_role: LedgerParty | null; party_id: string | null; funded_by: string | null; phase: LedgerPhase;
  pg_channel: string | null; note: string | null; created_at: string;
}

/** `rpc('ledger_check', { p_order })` (0099). Kolom yang ada bergantung pada `verdict`/fase. */
export interface LedgerCheck {
  order_id: string; code?: string; service?: ServiceType; phase?: LedgerPhase; status?: OrderStatus;
  verdict: 'balanced' | 'unbalanced' | 'refund_ok' | 'refund_short' | 'no_ledger' | 'not_found';
  balanced: boolean | null; ledger_version?: number;
  diff?: number; diff_components?: number; gross_customer?: number; allocated?: number; components_total?: number; formula?: string;
  driver_payable?: number; merchant_payable?: number; vendor_payable?: number; partner_payable?: number;
  platform_revenue?: number; pg_fee_platform?: number; pg_fee_customer?: number; contribution?: number;
  driver_commission?: number; bonus?: number; merchant_fee?: number;
  promo_platform?: number; promo_merchant?: number; promo_sponsor?: number; driver_receivable?: number;
  refund?: number; reimburse?: number; penalty?: number; paid?: number; rows?: number;
}

/** Satu baris `payment_channel_fees` (0100) — `rpc('admin_payment_channel_fees')`. */
export interface PaymentChannelFee {
  channel: string; provider: string; label: string | null;
  fee_pct: number; fee_fixed: number; ppn_included: boolean; ppn_pct: number;
  hold_days: number; hold_days_by_bank: Record<string, number>; min_auto_disburse: number;
  source: string | null; notes: string | null; active: boolean; updated_at: string; updated_by: string | null;
}

export type AdUnit = 'per_day' | 'per_week' | 'per_order';
export type AdPlacement = 'featured_home' | 'boost_nearby' | 'banner_category';
export type MerchantAdStatus = 'draft' | 'pending_payment' | 'active' | 'expired' | 'cancelled';
/** Satu baris `ad_products` (0101). */
export interface AdProduct { code: string; name: string; description: string | null; unit: AdUnit; price: number; placement: AdPlacement; active: boolean; updated_at: string; updated_by: string | null }
/** Satu butir `rpc('admin_merchant_ads', { p_status })` (0101). */
export interface AdminMerchantAd {
  id: string; merchant_id: string; merchant_name: string; owner_id: string | null;
  product_code: string; product_name: string; placement: AdPlacement; unit: AdUnit;
  starts_at: string; ends_at: string; price_paid: number; refunded: number;
  status: MerchantAdStatus; paid_via: string | null; created_at: string; note: string | null; is_live: boolean;
}

export type CityCostCategory = 'tim' | 'akuisisi' | 'kantor' | 'legal' | 'teknologi' | 'lainnya' | 'variable_ops';
/** Satu baris `by_city` dari laporan v2 (0103) — juga `admin_city_fixed_costs().ebitda`. */
export interface SkemaCityRow { city_id: string | null; city: string; orders: number; gmv_net: number; revenue: number; contribution: number; fixed_costs: number; ebitda_city: number; take_rate_pct: number }
/** `rpc('admin_city_fixed_costs', { p_month })` (0102, diperluas 0103). */
export interface AdminCityFixedCosts {
  month: string;
  rows: { id: string; city_id: string; city: string; category: CityCostCategory; amount: number; note: string | null; updated_at: string }[];
  by_city: { city_id: string; city: string; fixed: number; variable_ops: number; total: number }[];
  total_fixed: number; total_variable_ops: number;
  ebitda: SkemaCityRow[] | null;
  summary: { contribution_total: number | null; fixed_costs_total: number | null; ebitda: number | null } | null;
}

/** Satu hari `v_reconciliation_daily` (0102). */
export interface ReconciliationDay {
  day: string; payments_count: number; order_payments: number; payments_settled: number; gross_customer_digital: number;
  topups_credited: number; late_payment_refunds: number; pg_fee: number; pg_fee_ppn: number; pg_fee_total: number;
  net_settlement: number; held_amount: number; diff: number;
}
/** Satu butir penarikan approved yang belum settled (0102). */
export interface UnsettledPayout { id: string; user_id: string; name: string | null; amount: number; bank_name: string; bank_account: string; account_name: string; auto: boolean | null; approved_at: string; created_at: string }
/** `rpc('admin_reconciliation', { p_from, p_to })` (0102). */
export interface AdminReconciliation {
  from: string; to: string; days: ReconciliationDay[];
  totals: { payments_settled: number; gross_customer_digital: number; topups_credited: number; late_payment_refunds: number; pg_fee_total: number; net_settlement: number; held_amount: number; diff: number; abs_diff: number; days_with_diff: number };
  payouts: {
    sla_hours: number;
    approved_unsettled: { count: number; amount: number; overdue: number; items: UnsettledPayout[] };
    settled: { count: number; amount: number; on_time: number };
    approved_in_range: number;
  };
  labels: Record<string, string>;
}

export type GateStatus = 'pass' | 'fail' | 'no_data';
export type NumberLabelKind = 'FAKTA SUMBER' | 'ASUMSI' | 'HASIL PILOT';
export type SkemaGate = { status: GateStatus } & Record<string, unknown>;
/** `rpc('admin_exec_report_v2', { p_from, p_to, p_filters })` (0103). */
export interface SkemaReport {
  generated_at: string; from: string; to: string; level: string;
  filters: { service: string[] | null; city_id: string[] | null; merchant_cohort: string; payment_method: string | null; cash_digital: string; promo_owner: string | null };
  definitions: Record<string, string>;
  summary: {
    orders: number; gmv_net: number;
    platform_revenue: { merchant_fee: number; customer_platform_fee: number; driver_commission: number; service_fee_platform: number; ads: number; other: number; total: number };
    promo: { platform: number; merchant: number; sponsor: number; total: number };
    revenue_net: number; take_rate_net_pct: number; take_rate_target_pct: number; incentives_total: number;
    pg_fee_total: number; pg_fee_platform: number; pg_fee_customer: number; pg_fee_topup: number;
    payout_fee_total: number; payouts_settled: number; refund_total: number; refund_pg_cost: number; variable_ops_total: number;
    contribution_total: number; contribution_per_order: number; fixed_costs_total: number; ebitda: number; legacy_units: number;
  };
  by_city: SkemaCityRow[];
  by_service: { service: ServiceType; orders: number; gmv_net: number; revenue: number; contribution: number; pg_fee: number; take_rate_pct: number }[];
  by_payment: { channel: string; label: string; orders: number; gmv_net: number; revenue: number; pg_fee: number; pg_fee_platform: number; contribution: number }[];
  by_month: { month: string; orders: number; gmv_net: number; revenue: number; contribution: number; fixed_costs: number; ebitda: number; take_rate_pct: number }[];
  cohort: { cohort: string; merchants: number; orders: number; gmv_net: number; revenue: number }[];
  weeks: { week: string; from: string; orders: number; contribution: number }[];
  /** Tiap gerbang = objek {status, …angka}; ditambah `scale_up_ready` (boolean). */
  gates: Record<string, SkemaGate | boolean>;
  labels: Record<string, { value?: number; label: NumberLabelKind; note?: string }>;
}

/* ───────────────── Skema Bisnis v2 — bentuk data RPC aplikasi Pelanggan & Mitra ───────────────── */

/** `rpc('service_economics_public', { p_service })` (0098). `pg_fee_policy` belum dibuka server — opsional. */
export interface ServiceEconomicsPublic {
  service: ServiceType; customer_platform_fee: number; service_fee_pct: number; service_fee_min: number; driver_commission_pct: number;
  pg_fee_policy?: PgFeePolicy | null;
}

/** `order_payment_prepare` (0100) — juga `order` pada balasan edge function midtrans-create (purpose='order'). */
export interface OrderPaymentQuote {
  order_id: string; code: string; service: ServiceType; channel: string; channel_label: string; gross: number;
  pg_fee: number; pg_fee_ppn: number; pg_fee_borne_by: PgFeePolicy | null; customer_payment_fee: number; expires_at: string; timeout_min: number;
}

/** `rpc('driver_order_breakdown', { p_order })` (0099). `phase` null = order lama (sebelum buku besar). */
export interface DriverOrderBreakdown {
  order_id: string; code: string; service: ServiceType; status: OrderStatus; phase: LedgerPhase | null; ledger_version: number | null;
  payment_method: PaymentMethod; paid_via?: string | null;
  ongkir: number; komisi_pct: number | null; komisi: number | null; tip: number; extras: number; service_share: number | null; bonus: number | null;
  bersih: number; penggantian_belanja?: number; receivable: number | null; memegang_tunai: number; setor_merchant_tunai?: number; keterangan?: string;
}

/** `rpc('merchant_order_breakdown', { p_order })` (0099). */
export interface MerchantOrderBreakdown {
  order_id: string; code: string; status: OrderStatus; phase: LedgerPhase | null; ledger_version: number | null;
  nilai_pesanan: number; fee_pct: number | null; fee: number; promo_merchant: number; diterima: number; payment_method: PaymentMethod; keterangan?: string;
}

/** Satu butir `merchant_my_ads().ads` (0101). */
export interface MerchantAdRow {
  id: string; merchant_id: string; merchant_name: string; product_code: string; product_name: string; placement: AdPlacement;
  starts_at: string; ends_at: string; price_paid: number; refunded: number; status: MerchantAdStatus; paid_via: string | null; is_live: boolean;
}
/** `rpc('merchant_my_ads')` (0101). */
export interface MerchantMyAds {
  ads: MerchantAdRow[];
  products: { code: string; name: string; description: string | null; unit: AdUnit; price: number; placement: AdPlacement }[];
  balance: number;
}
/** `rpc('ad_price', { p_product, p_days })` (0101). */
export interface AdPriceQuote { product: string; name: string; unit: AdUnit; units: number; days: number; unit_price: number; price: number; placement: AdPlacement; active: boolean }

/* ───────────────── Finpay v3 (KONTRAK-API-V3 §1–§4, §7, §9) — bentuk data RPC/edge untuk aplikasi Pelanggan ───────────────── */

/** Status kanonik pembayaran (`payments.pay_status`, §2–§3). */
export type PayStatus = 'PENDING' | 'PAID' | 'FAILED' | 'EXPIRED' | 'REFUND_REQUESTED' | 'PARTIALLY_REFUNDED' | 'REFUNDED' | 'DISPUTED' | 'RECONCILED';
/** Provider pembayaran. Label tampil TIDAK di-hard-code per provider di layar — lihat `providerLabel()` (lib/payments). */
export type PayProvider = 'midtrans' | 'finpay' | 'simulated' | (string & {});

/** Satu kanal dari `payment_provider_public().channels` (§1). */
export interface ProviderChannel {
  key: string; label: string; fee_label: string | null; fee_pct: number; fee_fixed: number;
  /** true HANYA bila `pass_to_customer` && `pass_to_customer_legal_ok` di server (QRIS selalu false). */
  pass_to_customer: boolean; enabled: boolean;
}
/** `rpc('payment_provider_public')` (§1, anon). */
export interface ProviderPublic { provider: PayProvider; env: 'sandbox' | 'production' | (string & {}); simulation: boolean; channels: ProviderChannel[]; /** Nama tampil dari server (0105). */ provider_label?: string | null }

/** `rpc('pg_fee_estimate', { p_service, p_channel, p_amount })` (0104; v3 memakai provider aktif). */
export interface PgFeeEstimate {
  service: ServiceType; channel: string; channel_label: string; is_gateway: boolean; amount: number;
  fee: number; ppn: number; total_fee: number; borne_by: PgFeePolicy | null; policy: PgFeePolicy;
  /** Bagian biaya PG yang DITAMBAHKAN ke total pelanggan (0 = ditanggung AntarKita). */
  customer_fee: number; total_with_fee: number; estimate: boolean; note?: string | null; provider?: PayProvider | null;
}

/** `order_payment_prepare(p_order, p_channel)` v3 — OrderPaymentQuote + kolom baru (§2). */
export interface OrderPaymentPrepareV3 extends OrderPaymentQuote {
  /** Biaya metode pembayaran yang dibebankan ke pelanggan (0 = ditanggung AntarKita). */
  pg_fee_customer?: number | null; provider?: PayProvider | null; support_ref?: string | null;
  /** Opsional: pajak yang dibebankan (baris tampil hanya bila > 0). */ tax?: number | null;
  /** 0105 */ provider_label?: string | null; pg_fee_label?: string | null;
}

/** Balasan edge function `pay-create` (§9). `reused` opsional: server mengembalikan intent PENDING yang sama. */
export interface PayCreateResult {
  payment_id: string; external_id: string; provider: PayProvider;
  checkout_url?: string | null; checkout_token?: string | null; qr_string?: string | null; payment_code?: string | null;
  expires_at: string | null; support_ref: string | null;
  /** Opsional (bukan kontrak): URL gambar QR bila provider menyediakannya. */
  qr_image_url?: string | null; reused?: boolean; channel?: string | null; amount?: number | null; pay_status?: PayStatus | null;
  error?: string; message?: string;
}

/** `rpc('my_payment_status', { p_order })` (§2, pemilik saja). null = belum ada tagihan untuk pesanan ini. */
export interface MyPaymentStatus {
  pay_status: PayStatus; provider: PayProvider; channel: string | null; checkout_url: string | null; qr_string: string | null;
  payment_code: string | null; expires_at: string | null; paid_at: string | null; amount: number; support_ref: string | null; refunded_amount: number;
  /** Opsional (bukan kontrak). */ payment_id?: string | null; external_id?: string | null; qr_image_url?: string | null; channel_label?: string | null;
  /** 0105: tambahan server. */ provider_label?: string | null; order_status?: OrderStatus | null; payment_status?: string | null; late_paid?: boolean | null;
}

/** Satu baris `rpc('my_payment_history', { p_limit })` (§2). Kolom selain yang dikontrakkan diperlakukan opsional. */
export interface PaymentHistoryRow {
  id: string; purpose: 'order' | 'topup' | (string & {}); order_id: string | null; amount: number; pay_status: PayStatus;
  provider: PayProvider; channel: string | null; support_ref: string | null; created_at: string;
  order_code?: string | null; service?: ServiceType | null; paid_at?: string | null; refunded_amount?: number | null; channel_label?: string | null;
  provider_label?: string | null; expires_at?: string | null;
}

/** Satu baris rincian bukti transaksi / pratinjau refund. */
export interface ReceiptLine { label: string; amount: number; key?: string | null; kind?: string | null; hint?: string | null; note?: string | null; minus?: boolean | null; funded_by?: string | null; borne_by?: string | null }
/** `rpc('my_receipt', { p_order })` (§2) — jsonb; hanya `lines`/`total`/`refundable_note` yang wajib dipakai UI. */
export interface Receipt {
  order_id: string; code?: string | null; service?: ServiceType | null; status?: OrderStatus | null; created_at?: string | null;
  merchant?: string | null; pay_status?: PayStatus | null; provider?: PayProvider | null; channel?: string | null; channel_label?: string | null;
  paid_at?: string | null; support_ref?: string | null; external_id?: string | null;
  lines?: ReceiptLine[] | null;
  // Bentuk datar (cadangan bila server tidak mengirim `lines`)
  items_subtotal?: number | null; delivery_fee?: number | null; driver_share_note?: string | null; platform_fee?: number | null; service_fee?: number | null;
  pg_fee_customer?: number | null; tip?: number | null; extras?: number | null; helpers_fee?: number | null; intercity_fare?: number | null;
  discount?: number | null; promo_code?: string | null; promo_funded_by?: PromoFunder | null; tax?: number | null;
  total: number; refunded_amount?: number | null; refundable_note?: string | null;
  /** 0105: total + tip; nama tampil provider; metode. */ total_paid?: number | null; provider_label?: string | null; payment_method?: PaymentMethod | null; completed_at?: string | null; payment_status?: string | null;
}

/** `rpc('refund_policy_calc', { p_order })` (§4). */
export interface RefundPolicy { refundable: number; non_refundable: number; lines: { label: string; amount: number; refundable: boolean }[]; note?: string | null; phase?: string | null }

export type DisputeKind = 'amount_mismatch' | 'not_received' | 'chargeback' | 'payout_missing' | 'other';
export type DisputeStatus = 'open' | 'investigating' | 'resolved_refund' | 'resolved_no_refund' | 'closed';
/** Satu baris `rpc('my_disputes')` (§4). */
export interface DisputeRow {
  id: string; order_id: string; payment_id?: string | null; kind: DisputeKind; amount: number | null; description: string | null;
  status: DisputeStatus; resolution?: string | null; created_at: string; resolved_at?: string | null;
  order_code?: string | null; support_ref?: string | null;
}

/** Placement iklan v3 (§7). */
export type AdPlacementV3 = 'featured_home' | 'boost_nearby' | 'search_top' | 'banner_home' | 'banner_category' | 'radius_promo' | 'sponsored_voucher' | 'post_checkout_cross';
/** Satu butir `rpc('ads_serve', …)` (§7). */
export interface AdServed {
  campaign_id: string; merchant_id: string; merchant: string; headline: string | null; image_url: string | null; cta: string | null;
  label: string; distance_km: number | null;
}
