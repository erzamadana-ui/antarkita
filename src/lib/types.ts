export type UserRole = 'customer' | 'driver' | 'merchant' | 'admin';
export type VehicleType = 'motor' | 'car' | 'box' | 'pickup';
export type ApprovalStatus = 'pending' | 'approved' | 'suspended' | 'rejected';
export type ServiceType = 'ride_motor' | 'ride_car' | 'food' | 'send' | 'shop' | 'box' | 'travel' | 'market';
export type Locale = 'id' | 'en' | 'zh' | 'ar';
export interface OrderExtra { id: string; kind: 'parking' | 'toll' | 'waiting' | 'other'; amount: number; note?: string | null; status: 'pending' | 'approved' | 'rejected'; created_at: string; responded_at?: string }
export interface ShoppingItem { name: string; qty: number; note?: string; product_id?: string; item_id?: string; unit?: string; price?: number; ref_price?: number }
export type OrderStatus = 'scheduled' | 'searching' | 'accepted' | 'arrived' | 'in_progress' | 'completed' | 'cancelled';
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
  // tahap 11 (0030): AntarNow — driver tujuan langsung dari kode driver (null = pencarian normal)
  preferred_driver_id?: string | null;
  cancel_reason: string | null; created_at: string; accepted_at: string | null; arrived_at: string | null; started_at: string | null;
  completed_at: string | null; cancelled_at: string | null;
  // relasi opsional
  driver?: Driver | null; customer?: Profile | null; merchant?: Merchant | null; order_items?: OrderItem[];
}

export interface ServiceLimit { ok: boolean; max_km: number | null; same_city_required: boolean; same_city: boolean; message?: string | null }
export interface FareEstimate { distance_km: number; straight_km: number; fare: number; platform_fee: number; total: number; duration_min: number; limit?: ServiceLimit | null; service_enabled?: boolean; demand?: { multiplier: number; demand: number; supply: number } | null; session?: { name: string; level: 'low' | 'middle' | 'high'; multiplier: number } | null }

export interface Pricing {
  service: ServiceType; base_fare: number; per_km: number; per_min: number; min_fare: number; platform_fee: number;
  commission_pct: number; merchant_commission_pct: number; surge_multiplier: number;
}
export interface Promo {
  code: string; description: string | null; discount_type: 'fixed' | 'percent'; value: number; max_discount: number | null;
  min_total: number; service: ServiceType | null; quota: number | null; used_count: number; valid_from: string | null;
  valid_to: string | null; is_active: boolean; title?: string | null; image_url?: string | null; sort_order?: number;
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
export interface GatewayPublicConfig { provider: string; methods: string[]; topup_min: number; topup_max: number; configured: boolean; is_production: boolean; client_key: string | null }
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
}

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
