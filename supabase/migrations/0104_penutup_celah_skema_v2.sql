-- =====================================================================
-- 0104 — PENUTUP CELAH SKEMA BISNIS v2 (temuan tim UI setelah 0098–0103)
--
-- Sumber: docs/SKEMA-BISNIS-V2-SPEK.md §0.8, §1, §3, §5, §7, §8, §9; PKS Midtrans
-- M568767786_825925_PKS-Pass_M_09_2026 (Ver.Aug-26) Pasal 7 ayat 4(b).
--
--   1. Pagar server pesanan bayar-per-order yang BELUM LUNAS (status awaiting_payment, atau
--      payment_status='unpaid' dengan paid_via saluran gateway): tidak boleh diterima driver
--      (driver_accept_order), tidak tampil/tidak cocok di pencocokan (driver_can_take,
--      driver_available_orders), tidak dirilis jadwalnya (release_scheduled_orders), tidak boleh
--      diambil mitra travel (travel_accept_send / travel_send_available), dan merchant tidak boleh
--      memprosesnya (merchant_update_order). Pelanggan membatalkan pesanan yang belum lunas → TIDAK ada
--      refund (belum ada dana masuk) dan tagihan payments purpose='order' yang masih 'pending' → 'cancel'
--      (cancel_order; expire_unpaid_orders ikut). Pembantu tunggal: order_payment_pending(orders).
--   2. service_economics_public(service) + pg_fee_policy; pg_fee_estimate(service, channel, amount)
--      → {fee, ppn, borne_by, …} untuk baris "Biaya pembayaran (estimasi)" di checkout (anon/authenticated).
--   3. Sakelar baru `gateway_order_payment_enabled` (app_settings, default false) +
--      admin_set_gateway_order_payment(p_enabled) (PIN + audit). Bila true, create_order /
--      order_payment_prepare menerima saluran GATEWAY untuk pembayaran PER ORDER walau
--      antarpay_enabled() = false. Sakelar AntarPay tetap mengatur saluran 'antarpay' (saldo), top up,
--      pencairan, travel. Alasan (PKS Midtrans Pasal 7 ayat 4(b)): fitur uang elektronik/dompet
--      (stored value, isi saldo) TANPA izin Bank Indonesia → Midtrans berhak menghentikan layanan. Maka
--      AntarPay top up tetap mati sampai ada izin/review legal, tetapi menagih SATU pesanan lewat gateway
--      (purpose=order: dana langsung untuk transaksi itu, tidak disimpan sebagai saldo) bukan stored
--      value dan boleh dinyalakan terpisah. Dengan sakelar ini mati, perilaku 0088/0089 tidak berubah
--      sedikit pun (e2e S54/S55 menguji AntarPay mati + sakelar ini mati).
--   4. Ambang bisnis bisa diubah dari Panel Admin lewat admin_set_settings: take_rate_north_star_pct,
--      gate_contribution_weeks (baru; exec_report_v2 kini membacanya), gate_payout_on_time_pct,
--      gate_retention_driver_pct, gate_retention_merchant_pct, gate_refund_max_pct, payout_sla_hours,
--      payout_fee_per_withdrawal, order_payment_timeout_min, driver_debt_limit, commission_cap_two_wheel.
--      Kunci-kunci ini: PIN (admin_require_unlock), validasi tipe & rentang, disimpan sebagai angka JSON,
--      audit before/after (settings.business_updated). commission_cap_two_wheel yang lebih rendah dari
--      komisi roda dua yang berlaku (service_economics / pricing) DITOLAK. Kunci yang punya RPC khusus
--      (antarpay_enabled, payment_channels, pg_methods, gateway_order_payment_enabled) DITOLAK di sini.
--      admin_automation_status ikut membaca kunci baru; admin_business_settings() = spesifikasi + nilai.
--      app_public_settings() membuka driver_debt_limit (+ status bayar per order) ke aplikasi.
--   5. admin_ledger_unbalanced(p_limit) — order selesai 30 hari terakhir dengan ledger_check.balanced=false
--      (+ order v2 tanpa buku besar); admin_ledger_lookup(p_query) — cari orders.code/id,
--      travel_bookings/travel_requests id/kode, merchant_ads id → baris buku besar + putusan keseimbangan.
--   6. admin_set_city_fixed_cost(…, p_delete boolean default false): hapus sel; p_note = '' mengosongkan catatan.
--   7. merchant_order_breakdown: pesanan batal/refund → diterima = 0, phase = 'cancelled'.
--
-- Tambalan fungsi lama memakai skema_v2_splice (pg_get_functiondef + jangkar unik + penanda idempoten,
-- gagal keras bila jangkar hilang) — dibuat di awal, dihapus di akhir. Semua blok idempoten.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Pembantu tambalan (sementara)
-- ---------------------------------------------------------------------
create or replace function public.skema_v2_splice(p_fn text, p_anchor text, p_new text, p_marker text, p_all boolean default false)
returns void language plpgsql as $$
declare def text; n int;
begin
  if (select count(*) from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace where ns.nspname = 'public' and p.proname = p_fn) > 1 then
    raise exception '0104 batal: fungsi % punya lebih dari satu overload', p_fn;
  end if;
  select pg_get_functiondef(p.oid) into def from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace where ns.nspname = 'public' and p.proname = p_fn;
  if def is null then raise exception '0104 batal: fungsi % tidak ditemukan', p_fn; end if;
  if position(p_marker in def) > 0 then raise notice '0104: % sudah ditambal (%), dilewati', p_fn, p_marker; return; end if;
  n := (length(def) - length(replace(def, p_anchor, ''))) / greatest(1, length(p_anchor));
  if n = 0 then raise exception '0104 batal: jangkar tidak ditemukan di % — definisi berubah, tambalan TIDAK terpasang. Jangkar: %', p_fn, left(p_anchor, 120); end if;
  if n > 1 and not p_all then raise exception '0104 batal: jangkar tidak unik (% kali) di %. Jangkar: %', n, p_fn, left(p_anchor, 120); end if;
  execute replace(def, p_anchor, p_new);
end $$;

-- =====================================================================
-- 1. PAGAR PESANAN BAYAR-PER-ORDER YANG BELUM LUNAS
-- =====================================================================
-- Satu definisi "belum lunas": menunggu pembayaran gateway, ATAU tercatat unpaid padahal dibayar lewat
-- saluran gateway (keadaan tidak konsisten apa pun — mis. status diubah manual — tetap tertahan).
-- Tunai/COD (paid_via 'cash') dan saldo AntarPay tidak pernah dianggap "belum lunas" di sini.
create or replace function public.order_payment_pending(o orders)
returns boolean language sql stable set search_path = public, pg_temp as $$
  select coalesce(o.status::text = 'awaiting_payment', false)
      or coalesce(o.payment_status::text = 'unpaid' and payment_channel_of(o.paid_via) = any (payment_gateway_channel_keys()), false);
$$;
revoke all on function public.order_payment_pending(orders) from public, anon;
grant execute on function public.order_payment_pending(orders) to authenticated, service_role;
comment on function public.order_payment_pending(orders) is
  '0104: true bila pesanan bayar-per-order lewat gateway BELUM lunas (status awaiting_payment, atau payment_status unpaid dengan paid_via saluran gateway). Pesanan seperti ini tidak boleh dipasangkan ke driver/mitra travel dan tidak boleh diproses merchant.';

-- 1a. driver_can_take — predikat pencocokan pusat (dipakai driver_available_orders, driver_accept_order, create_order kode driver)
select skema_v2_splice('driver_can_take',
  $a$  and not is_blocked_pair(d.id, o.customer_id)$a$,
  $a$  and not is_blocked_pair(d.id, o.customer_id)
  -- 0104: pesanan bayar-per-order yang belum lunas tidak pernah dipasangkan ke driver
  and not order_payment_pending(o)$a$,
  'order_payment_pending(o)');

-- 1b. driver_accept_order — pesan jelas + syarat atomik di UPDATE
select skema_v2_splice('driver_accept_order',
  $a$  select * into o from orders where id = p_order_id and status = 'searching';$a$,
  $a$  if exists (select 1 from orders x where x.id = p_order_id and order_payment_pending(x)) then   -- 0104 belum lunas
    raise exception 'Pesanan ini belum dibayar pelanggan (menunggu pembayaran). Pesanan baru bisa diterima setelah pembayaran masuk.';
  end if;
  select * into o from orders where id = p_order_id and status = 'searching';$a$,
  '0104 belum lunas');
select skema_v2_splice('driver_accept_order',
  $a$where id = p_order_id and status = 'searching' returning * into o;$a$,
  $a$where id = p_order_id and status = 'searching' and not order_payment_pending(orders) returning * into o;$a$,
  'and not order_payment_pending(orders)');

-- 1c. driver_available_orders — daftar order untuk driver
select skema_v2_splice('driver_available_orders',
  $a$  where o.status = 'searching'
    and driver_can_take(d, o)$a$,
  $a$  where o.status = 'searching'
    and not order_payment_pending(o)   -- 0104 belum lunas
    and driver_can_take(d, o)$a$,
  '0104 belum lunas');

-- 1d. release_scheduled_orders — booking terjadwal baru dicarikan driver bila sudah lunas
select skema_v2_splice('release_scheduled_orders',
  $a$update orders set status = 'searching' where status = 'scheduled' and scheduled_at <= now() + (v_min || ' minutes')::interval returning id$a$,
  $a$update orders set status = 'searching' where status = 'scheduled' and scheduled_at <= now() + (v_min || ' minutes')::interval
      and not order_payment_pending(orders) /* 0104 belum lunas */ returning id$a$,
  '0104 belum lunas');

-- 1e. travel_accept_send / travel_send_available — titipan antar kota via mitra travel
select skema_v2_splice('travel_accept_send',
  $a$  if o.status <> 'searching' or coalesce(o.package_details->>'via','') <> 'travel' then raise exception 'Titipan ini sudah diambil mitra lain'; end if;$a$,
  $a$  if order_payment_pending(o) then   -- 0104 belum lunas
    raise exception 'Titipan ini belum dibayar pengirim (menunggu pembayaran). Titipan baru bisa diambil setelah pembayaran masuk.';
  end if;
  if o.status <> 'searching' or coalesce(o.package_details->>'via','') <> 'travel' then raise exception 'Titipan ini sudah diambil mitra lain'; end if;$a$,
  '0104 belum lunas');
select skema_v2_splice('travel_send_available',
  $a$    where o.service = 'send' and o.status = 'searching' and coalesce(o.package_details->>'via','') = 'travel'$a$,
  $a$    where o.service = 'send' and o.status = 'searching' and coalesce(o.package_details->>'via','') = 'travel'
      and not order_payment_pending(o)   -- 0104 belum lunas$a$,
  '0104 belum lunas');

-- 1f. merchant_update_order — merchant tidak memproses (terima/tolak/siap) pesanan yang belum lunas
select skema_v2_splice('merchant_update_order',
  $a$  if o.status in ('completed','cancelled') then raise exception 'Order sudah selesai/batal'; end if;$a$,
  $a$  if o.status in ('completed','cancelled') then raise exception 'Order sudah selesai/batal'; end if;
  if order_payment_pending(o) then   -- 0104 belum lunas
    raise exception 'Pesanan % belum dibayar pelanggan (menunggu pembayaran). Pesanan bisa diproses setelah pembayaran masuk.', o.code;
  end if;$a$,
  '0104 belum lunas');

-- 1g. cancel_order — pembatalan pesanan yang belum lunas: tidak ada refund; tagihan gateway pending → cancel
--     (payment_status tetap 'unpaid' → cabang refund tidak jalan; ledger fase cancelled refund 0).
--     Dana yang tetap datang sesudahnya ditangani payment_settle (refund ke saldo, 0100).
select skema_v2_splice('cancel_order',
  $a$    payment_status = case when payment_status = 'paid' then 'refunded' else payment_status end
  where id = o.id returning * into o;
$a$,
  $a$    payment_status = case when payment_status = 'paid' then 'refunded' else payment_status end
  where id = o.id returning * into o;
  if order_payment_pending(o) then   -- 0104 belum lunas: belum ada dana masuk → tidak ada refund
    update payments set status = 'cancel', updated_at = now() where order_id = o.id and purpose = 'order' and status = 'pending';
    insert into order_events (order_id, status, actor_id, note) values (o.id, 'payment_cancelled', v_uid,
      'Tagihan ' || payment_channel_label(payment_channel_of(o.paid_via)) || ' dibatalkan — pesanan belum dibayar, tidak ada dana yang dikembalikan');
  end if;
$a$,
  '0104 belum lunas');

select skema_v2_splice('expire_unpaid_orders',
  $a$    perform ledger_post(o.id, 'cancelled', '{}'::jsonb);$a$,
  $a$    update payments set status = 'expire', updated_at = now() where order_id = o.id and purpose = 'order' and status = 'pending';   -- 0104 tagihan kedaluwarsa
    perform ledger_post(o.id, 'cancelled', '{}'::jsonb);$a$,
  '0104 tagihan kedaluwarsa');

-- =====================================================================
-- 2. KEBIJAKAN & ESTIMASI BIAYA PEMBAYARAN UNTUK CHECKOUT
-- =====================================================================
create or replace function public.service_economics_public(p_service service_type)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'service', p_service,
    'customer_platform_fee', coalesce(e.customer_platform_fee, p.platform_fee, 0),
    'service_fee_pct', coalesce(e.service_fee_pct, 0),
    'service_fee_min', coalesce(e.service_fee_min, 0),
    'driver_commission_pct', coalesce(e.driver_commission_pct, 0),
    'pg_fee_policy', coalesce(e.pg_fee_policy, 'platform'))   -- 0104: 'customer' → checkout menampilkan "Biaya pembayaran"
  from (select 1) x
  left join service_economics e on e.service = p_service
  left join pricing p on p.service = p_service;
$$;
grant execute on function public.service_economics_public(service_type) to anon, authenticated;
comment on function public.service_economics_public(service_type) is
  'Rincian aturan bisnis yang boleh dilihat klien (0098, 0104): biaya platform pelanggan, jasa belanja, komisi driver, pg_fee_policy (siapa menanggung biaya pembayaran). Tidak membuka merchant_fee_pct.';

create or replace function public.pg_fee_estimate(p_service service_type, p_channel text, p_amount bigint)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_ch text := payment_channel_of(p_channel); v_gw boolean; v_fee bigint := 0; v_ppn bigint := 0; v_pol text; v_cust bigint;
begin
  if p_amount is null or p_amount < 0 or p_amount > 100000000 then raise exception 'Nominal estimasi harus Rp0–Rp100.000.000'; end if;
  select pg_fee_policy into v_pol from service_economics where service = p_service;
  v_pol := coalesce(v_pol, 'platform');
  v_gw := v_ch = any (payment_gateway_channel_keys());
  if v_gw then
    select f.fee, f.ppn into v_fee, v_ppn from pg_fee_calc(v_ch, p_amount) f;
    v_fee := coalesce(v_fee, 0); v_ppn := coalesce(v_ppn, 0);
  end if;
  v_cust := case when v_pol = 'customer' then v_fee + v_ppn else 0 end;
  return jsonb_build_object(
    'service', p_service, 'channel', v_ch, 'channel_label', payment_channel_label(v_ch), 'is_gateway', v_gw,
    'amount', p_amount, 'fee', v_fee, 'ppn', v_ppn, 'total_fee', v_fee + v_ppn,
    'borne_by', case when v_gw then v_pol end, 'policy', v_pol,
    'customer_fee', v_cust, 'total_with_fee', p_amount + v_cust, 'estimate', true,
    'note', case when not v_gw then 'Bukan saluran payment gateway — tidak ada biaya pembayaran'
                 when v_pol = 'customer' then 'Biaya pembayaran (estimasi) ditambahkan ke total; angka final dihitung ulang saat membayar'
                 else 'Biaya pembayaran ditanggung AntarKita — tidak menambah total' end);
end $$;
revoke all on function public.pg_fee_estimate(service_type, text, bigint) from public;
grant execute on function public.pg_fee_estimate(service_type, text, bigint) to anon, authenticated, service_role;
comment on function public.pg_fee_estimate(service_type, text, bigint) is
  '0104: estimasi biaya payment gateway untuk checkout. p_amount = total SEBELUM biaya pembayaran. {fee, ppn, total_fee, borne_by (platform|customer, null bila bukan gateway), customer_fee (yang ditambahkan ke total bila pg_fee_policy=customer), total_with_fee}. Sumber tarif: payment_channel_fees (PKS Midtrans).';

-- =====================================================================
-- 3. SAKELAR BAYAR PER ORDER LEWAT GATEWAY (terpisah dari AntarPay)
-- =====================================================================
insert into app_settings (key, value) values ('gateway_order_payment_enabled', 'false'::jsonb) on conflict (key) do nothing;

create or replace function public.gateway_order_payment_enabled()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select lower(value #>> '{}') = 'true' from app_settings where key = 'gateway_order_payment_enabled'), false);
$$;
grant execute on function public.gateway_order_payment_enabled() to anon, authenticated, service_role;
comment on function public.gateway_order_payment_enabled() is
  '0104: sakelar bayar PER ORDER lewat payment gateway (default false). Terpisah dari antarpay_enabled(): PKS Midtrans Pasal 7 ayat 4(b) melarang fitur uang elektronik/dompet (stored value) tanpa izin BI — top up AntarPay tetap mati — sedangkan menagih satu pesanan lewat gateway (purpose=order) bukan stored value.';

-- Status mentah satu saluran di app_settings.payment_channels (tanpa induk AntarPay 0088)
create or replace function public.payment_channel_order_enabled(p_key text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare k text := lower(trim(coalesce(p_key, ''))); v jsonb;
begin
  if k = '' then return false; end if;
  if k = any (payment_gateway_channel_keys()) and gateway_order_payment_enabled() then
    select case when jsonb_typeof(value) = 'object' then value else '{}'::jsonb end into v from app_settings where key = 'payment_channels';
    return lower(coalesce(v ->> k, '')) = 'true';   -- saluran gateway: default NONAKTIF, sama seperti 0089
  end if;
  return payment_channel_enabled(k);                -- selain itu: aturan 0088/0089 apa adanya
end $$;
grant execute on function public.payment_channel_order_enabled(text) to anon, authenticated, service_role;
comment on function public.payment_channel_order_enabled(text) is
  '0104: apakah saluran boleh dipakai untuk membayar SATU pesanan. Saluran gateway + gateway_order_payment_enabled → hanya sakelar saluran itu (tidak tergantung AntarPay); selain itu = payment_channel_enabled (0089).';

create or replace function public.payment_channels_order_public()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(t.k, payment_channel_order_enabled(t.k)), '{}'::jsonb) from unnest(payment_channel_keys()) as t(k);
$$;
grant execute on function public.payment_channels_order_public() to anon, authenticated, service_role;

-- Pengganti payment_channel_require untuk bayar pesanan (create_order, order_payment_prepare).
-- Sakelar mati (default) → identik payment_channel_require (0089) → pesan & urutan penolakan e2e S54/S55 tidak berubah.
create or replace function public.payment_channel_require_order(p_paid_via text)
returns void language plpgsql stable security definer set search_path = public as $$
declare v_ch text := payment_channel_of(p_paid_via);
begin
  if v_ch = any (payment_gateway_channel_keys()) and gateway_order_payment_enabled() then
    if payment_channel_order_enabled(v_ch) then return; end if;
    raise exception 'Metode pembayaran % sedang dinonaktifkan. Pilih metode lain.', payment_channel_label(v_ch);
  end if;
  perform payment_channel_require(p_paid_via);
end $$;
revoke all on function public.payment_channel_require_order(text) from public, anon;
grant execute on function public.payment_channel_require_order(text) to authenticated, service_role;
comment on function public.payment_channel_require_order(text) is
  '0104: syarat saluran untuk membayar SATU pesanan. Saluran gateway saat gateway_order_payment_enabled → cukup saluran itu aktif (AntarPay boleh mati, PKS Pasal 7.4b); selain itu = payment_channel_require (0088/0089).';

create or replace function public.admin_set_gateway_order_payment(p_enabled boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_before boolean := gateway_order_payment_enabled();
begin
  if not is_admin() then raise exception 'Hanya admin'; end if;
  perform admin_require_unlock();
  if p_enabled is null then raise exception 'Nilai sakelar wajib diisi'; end if;
  insert into app_settings (key, value) values ('gateway_order_payment_enabled', to_jsonb(p_enabled))
  on conflict (key) do update set value = excluded.value, updated_at = now();
  perform log_activity('gateway_order_payment.toggle', 'app_settings', 'gateway_order_payment_enabled',
    'Bayar per pesanan lewat payment gateway ' || case when p_enabled then 'DIAKTIFKAN' else 'DINONAKTIFKAN' end || ' dari Panel Admin'
      || case when p_enabled and not antarpay_enabled() then ' (AntarPay/top up tetap nonaktif — PKS Midtrans Pasal 7.4b)' else '' end,
    jsonb_build_object('before', v_before, 'after', p_enabled, 'antarpay_enabled', antarpay_enabled()));
  return jsonb_build_object('gateway_order_payment_enabled', gateway_order_payment_enabled(), 'antarpay_enabled', antarpay_enabled(),
    'order_payment_channels', payment_channels_order_public(), 'payment_channels', payment_channels_public());
end $$;
revoke all on function public.admin_set_gateway_order_payment(boolean) from public, anon;
grant execute on function public.admin_set_gateway_order_payment(boolean) to authenticated;
comment on function public.admin_set_gateway_order_payment(boolean) is
  '0104: Panel Admin → sakelar bayar per pesanan lewat gateway (PIN + audit gateway_order_payment.toggle). Tidak menyalakan AntarPay/top up.';

-- 3a. create_order — gerbang AntarPay tidak berlaku untuk saluran gateway per order bila sakelar menyala
select skema_v2_splice('create_order',
  $a$  if v_paid_via <> 'cash' and not antarpay_enabled() then
    raise exception 'AntarPay sedang dinonaktifkan sementara. Gunakan pembayaran tunai.';
  end if;$a$,
  $a$  if v_paid_via <> 'cash' and not antarpay_enabled()
     and not (gateway_order_payment_enabled() and payment_channel_of(v_paid_via) = any (payment_gateway_channel_keys())) then   -- 0104 bayar per order via gateway
    raise exception 'AntarPay sedang dinonaktifkan sementara. Gunakan pembayaran tunai.';
  end if;$a$,
  '0104 bayar per order via gateway');
select skema_v2_splice('create_order',
  $a$  perform payment_channel_require(v_paid_via);$a$,
  $a$  perform payment_channel_require_order(v_paid_via);   -- 0104: gateway per order diatur gateway_order_payment_enabled$a$,
  'payment_channel_require_order(v_paid_via)');

-- 3b. order_payment_prepare (dipanggil midtrans-create purpose=order)
select skema_v2_splice('order_payment_prepare',
  $a$  perform payment_channel_require(v_ch);$a$,
  $a$  perform payment_channel_require_order(v_ch);   -- 0104$a$,
  'payment_channel_require_order(v_ch)');

-- 3c. status ke aplikasi & panel
select skema_v2_splice('app_public_settings',
  $a$    'payment_channels', payment_channels_public()
  );$a$,
  $a$    'payment_channels', payment_channels_public(),
    -- 0104: bayar per pesanan lewat gateway (terpisah dari AntarPay) + batas saldo minus mitra
    'gateway_order_payment_enabled', gateway_order_payment_enabled(),
    'order_payment_channels', payment_channels_order_public(),
    'driver_debt_limit', setting_num('driver_debt_limit', -500000)
  );$a$,
  'gateway_order_payment_enabled');
select skema_v2_splice('gateway_public_config',
  $a$    'payment_channels', payment_channels_public());$a$,
  $a$    'payment_channels', payment_channels_public(),
    'gateway_order_payment_enabled', gateway_order_payment_enabled(),   -- 0104
    'order_payment_channels', payment_channels_order_public());$a$,
  'gateway_order_payment_enabled');
select skema_v2_splice('admin_payment_channels',
  $a$    'antarpay_enabled', antarpay_enabled(),$a$,
  $a$    'antarpay_enabled', antarpay_enabled(),
    'gateway_order_payment_enabled', gateway_order_payment_enabled(),   -- 0104
    'order_payment_channels', payment_channels_order_public(),$a$,
  'gateway_order_payment_enabled');

-- =====================================================================
-- 4. AMBANG BISNIS YANG BISA DIUBAH ADMIN (PIN + validasi + audit)
-- =====================================================================
insert into app_settings (key, value) values ('gate_contribution_weeks', '8'::jsonb) on conflict (key) do nothing;

create or replace function public.business_setting_specs()
returns table(key text, min_value numeric, max_value numeric, is_int boolean, default_value numeric, unit text, label text, note text)
language sql immutable set search_path = public as $$
  select * from (values
    ('take_rate_north_star_pct',    0::numeric, 100::numeric, false, 25::numeric, '%',     'FAKTA SUMBER', 'Target take rate bersih portofolio matang — north-star, bukan target per order (§0.5)'),
    ('gate_contribution_weeks',     1,          52,           true,  8,           'minggu','FAKTA SUMBER', 'Gerbang scale-up: contribution > 0 selama N minggu berturut-turut (§7)'),
    ('gate_payout_on_time_pct',     0,          100,          false, 95,          '%',     'ASUMSI',       'Gerbang scale-up: % pencairan settled dalam SLA'),
    ('gate_retention_driver_pct',   0,          100,          false, 60,          '%',     'ASUMSI',       'Gerbang scale-up: retensi driver 30 hari'),
    ('gate_retention_merchant_pct', 0,          100,          false, 70,          '%',     'ASUMSI',       'Gerbang scale-up: retensi merchant 30 hari'),
    ('gate_refund_max_pct',         0,          100,          false, 2,           '%',     'ASUMSI',       'Gerbang scale-up: batas % pesanan direfund'),
    ('payout_sla_hours',            1,          720,          true,  24,          'jam',   'ASUMSI',       'SLA pencairan sejak disetujui sampai settled'),
    ('payout_fee_per_withdrawal',   0,          100000,       true,  0,           'Rp',    'ASUMSI',       'Biaya transfer per pencairan (tagihan bank/provider) — mengurangi contribution'),
    ('order_payment_timeout_min',   5,          1440,         true,  15,          'menit', 'ASUMSI',       'Batas waktu bayar pesanan gateway sebelum dibatalkan otomatis'),
    ('driver_debt_limit',           -10000000,  0,            true,  -500000,     'Rp',    'ASUMSI',       'Batas saldo minus driver/mitra travel (nilai ≤ 0) sebelum ditolak online/terima order'),
    ('commission_cap_two_wheel',    0,          100,          false, 8,           '%',     'FAKTA SUMBER', 'Batas komisi roda dua (porsi driver ≥ 100 − batas); tidak boleh di bawah komisi ride_motor yang berlaku')
  ) as t(key, min_value, max_value, is_int, default_value, unit, label, note);
$$;
revoke all on function public.business_setting_specs() from public, anon, authenticated;

-- admin_set_settings (0019) ditulis ulang: jalur lama (kunci umum ^[a-z_]+$) tetap, ditambah pagar 0104.
do $$
declare def text := pg_get_functiondef('public.admin_set_settings(jsonb)'::regprocedure);
begin
  if position('0104 ambang bisnis' in def) = 0 and position('Kunci tidak valid: %' in def) = 0 then
    raise exception '0104 batal: admin_set_settings berubah sejak 0019 — tulis ulang dibatalkan, periksa definisi terkini';
  end if;
end $$;

create or replace function public.admin_set_settings(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  k text; v jsonb; s record; n numeric; biz jsonb := '{}'::jsonb; before jsonb := '{}'::jsonb; v_bad text; ringkas text;
  -- 0104 ambang bisnis: sakelar yang punya RPC khusus (PIN + audit sendiri) tidak boleh lewat jalur umum
  protected constant text[] := array['antarpay_enabled', 'payment_channels', 'pg_methods', 'gateway_order_payment_enabled', 'pg_last_webhook_at'];
begin
  if not is_admin() then raise exception 'Hanya admin'; end if;
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'Pengaturan harus objek JSON {kunci: nilai}'; end if;
  -- validasi SEMUA kunci dulu (tidak ada yang ditulis bila satu saja tidak valid)
  for k, v in select * from jsonb_each(p) loop
    if k !~ '^[a-z_]+$' then raise exception 'Kunci tidak valid: %', k; end if;
    if k = any (protected) then raise exception 'Pengaturan % diubah lewat menunya sendiri (PIN + audit), bukan lewat pengaturan umum', k; end if;
    select * into s from business_setting_specs() x where x.key = k;
    if found then
      if jsonb_typeof(v) = 'number' then n := (v #>> '{}')::numeric;
      elsif jsonb_typeof(v) = 'string' and btrim(v #>> '{}') ~ '^-?[0-9]+(\.[0-9]+)?$' then n := btrim(v #>> '{}')::numeric;
      else raise exception 'Nilai % harus angka', k; end if;
      if s.is_int and n <> trunc(n) then raise exception 'Nilai % harus bilangan bulat', k; end if;
      if n < s.min_value or n > s.max_value then raise exception 'Nilai % harus % s.d. % %', k, s.min_value, s.max_value, s.unit; end if;
      biz := biz || jsonb_build_object(k, n);
    end if;
  end loop;

  if biz <> '{}'::jsonb then
    perform admin_require_unlock();   -- ambang yang menyentuh uang/laporan: wajib PIN
    if biz ? 'commission_cap_two_wheel' then
      select string_agg(format('%s %s%%', e.service, e.driver_commission_pct), ', ') into v_bad
        from service_economics e where e.service::text = any (two_wheel_services()) and e.driver_commission_pct > (biz->>'commission_cap_two_wheel')::numeric;
      if v_bad is null then
        select string_agg(format('pricing.%s %s%%', pr.service, pr.commission_pct), ', ') into v_bad
          from pricing pr where pr.service::text = any (two_wheel_services()) and pr.commission_pct > (biz->>'commission_cap_two_wheel')::numeric;
      end if;
      if v_bad is not null then
        raise exception 'Batas komisi roda dua % %% lebih rendah dari komisi yang berlaku (%). Turunkan komisinya dulu di Aturan Bisnis.', biz->>'commission_cap_two_wheel', v_bad;
      end if;
    end if;
    select coalesce(jsonb_object_agg(b.key, a.value), '{}'::jsonb) into before
      from jsonb_object_keys(biz) b(key) left join app_settings a on a.key = b.key;
  end if;

  for k, v in select * from jsonb_each(p) loop
    if biz ? k then v := biz -> k; end if;   -- disimpan sebagai angka JSON (setting_num membaca value::text::numeric)
    insert into app_settings (key, value) values (k, v) on conflict (key) do update set value = excluded.value, updated_at = now();
  end loop;
  perform log_activity('settings.update', 'app_settings', 'batch', 'Pengaturan otomasi diubah: ' || (select string_agg(key, ', ') from jsonb_object_keys(p) key), p);
  if biz <> '{}'::jsonb then
    select string_agg(format('%s: %s → %s', b.key, coalesce(before ->> b.key, '-'), biz ->> b.key), ', ') into ringkas from jsonb_object_keys(biz) b(key);
    perform log_activity('settings.business_updated', 'app_settings', 'business', 'Ambang bisnis diubah: ' || ringkas,
      jsonb_build_object('before', before, 'after', biz));
  end if;
end $$;
revoke all on function public.admin_set_settings(jsonb) from public, anon;
grant execute on function public.admin_set_settings(jsonb) to authenticated;
comment on function public.admin_set_settings(jsonb) is
  'Pengaturan umum app_settings (0019). Sejak 0104: ambang bisnis (business_setting_specs) wajib PIN, divalidasi & disimpan sebagai angka, audit settings.business_updated {before, after}; commission_cap_two_wheel tidak boleh di bawah komisi roda dua yang berlaku; sakelar ber-RPC khusus (antarpay_enabled, payment_channels, pg_methods, gateway_order_payment_enabled) ditolak.';

create or replace function public.admin_business_settings()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Hanya admin'; end if;
  return jsonb_build_object(
    'settings', (select jsonb_agg(jsonb_build_object('key', s.key, 'value', coalesce((a.value #>> '{}')::numeric, s.default_value), 'default', s.default_value,
        'min', s.min_value, 'max', s.max_value, 'integer', s.is_int, 'unit', s.unit, 'label', s.label, 'note', s.note, 'stored', a.key is not null) order by s.key)
      from business_setting_specs() s left join app_settings a on a.key = s.key),
    'requires_pin', true,
    'gateway_order_payment_enabled', gateway_order_payment_enabled(),
    'antarpay_enabled', antarpay_enabled());
end $$;
revoke all on function public.admin_business_settings() from public, anon;
grant execute on function public.admin_business_settings() to authenticated;
comment on function public.admin_business_settings() is '0104: Panel Admin — ambang bisnis yang bisa diubah (nilai, default, rentang, satuan, label FAKTA/ASUMSI). Simpan lewat admin_set_settings (PIN).';

select skema_v2_splice('admin_automation_status',
  $a$'gateway_fee_pct','target_take_rate_pct')$a$,
  $a$'gateway_fee_pct','target_take_rate_pct', /* 0104 ambang bisnis */ 'take_rate_north_star_pct','gate_contribution_weeks','gate_payout_on_time_pct',
      'gate_retention_driver_pct','gate_retention_merchant_pct','gate_refund_max_pct','payout_sla_hours','payout_fee_per_withdrawal','order_payment_timeout_min',
      'driver_debt_limit','commission_cap_two_wheel','gateway_order_payment_enabled')$a$,
  '0104 ambang bisnis');

-- exec_report_v2: gerbang "contribution > 0 selama N minggu" membaca gate_contribution_weeks (sebelumnya 8 tertanam)
select skema_v2_splice('skema_v2_report',
  $a$v_m0 date; v_start date;$a$,
  $a$v_m0 date; v_start date; v_gate_weeks int := greatest(1, least(52, setting_num('gate_contribution_weeks', 8)::int)); /* 0104 */$a$,
  'v_gate_weeks int :=');
select skema_v2_splice('skema_v2_report',
  $a$v_m0, p_to - 56);$a$,
  $a$v_m0, p_to - 7 * v_gate_weeks);$a$,
  'p_to - 7 * v_gate_weeks');
select skema_v2_splice('skema_v2_report',
  $a$date_trunc('week', p_to::timestamp) - interval '7 weeks'$a$,
  $a$date_trunc('week', p_to::timestamp) - make_interval(weeks => v_gate_weeks - 1)$a$,
  'make_interval(weeks => v_gate_weeks - 1)');
select skema_v2_splice('skema_v2_report',
  $a$'weeks_required', 8)$a$,
  $a$'weeks_required', v_gate_weeks)$a$,
  $a$'weeks_required', v_gate_weeks$a$);
select skema_v2_splice('skema_v2_report',
  $a$'gate_contribution_weeks', jsonb_build_object('value', 8,$a$,
  $a$'gate_contribution_weeks', jsonb_build_object('value', v_gate_weeks,$a$,
  $a$jsonb_build_object('value', v_gate_weeks$a$);

-- =====================================================================
-- 5. BUKU BESAR: daftar order tidak seimbang & pencarian lintas sumber
-- =====================================================================
-- Putusan keseimbangan sumber non-orders (travel_bookings/travel_requests/merchant_ads) — internal
create or replace function public.ledger_check_source(p_source text, p_source_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_phase text; agg record; a merchant_ads; v_exp bigint;
begin
  if p_source = 'merchant_ads' then
    select * into a from merchant_ads where id = p_source_id;
    select coalesce(sum(amount), 0) as ads, count(*) as n into agg from order_ledger where source = 'merchant_ads' and source_id = p_source_id;
    v_exp := case when a.activated_at is not null then a.price_paid else 0 end - coalesce(a.refunded, 0);
    return jsonb_build_object('source', p_source, 'source_id', p_source_id, 'status', a.status, 'ads_revenue', agg.ads, 'expected', v_exp,
      'price_paid', a.price_paid, 'refunded', a.refunded, 'balanced', agg.ads = v_exp, 'verdict', case when agg.ads = v_exp then 'balanced' else 'unbalanced' end,
      'formula', 'Σ ads_revenue = price_paid (bila pernah aktif) − refunded', 'rows', agg.n);
  end if;
  select phase into v_phase from order_ledger where source = p_source and source_id = p_source_id
   order by case phase when 'completed' then 0 when 'refunded' then 1 when 'cancelled' then 2 when 'adjusted' then 3 when 'created' then 4 else 5 end limit 1;
  if v_phase is null then return jsonb_build_object('source', p_source, 'source_id', p_source_id, 'verdict', 'no_ledger', 'balanced', null); end if;
  select coalesce(sum(amount) filter (where entry = 'gross_customer'), 0) as gross,
         coalesce(-sum(amount) filter (where entry = 'partner_payable'), 0) as partner,
         coalesce(sum(amount) filter (where entry = 'platform_revenue'), 0) as rev,
         coalesce(-sum(amount) filter (where entry = 'refund'), 0) as refund,
         coalesce(sum(amount) filter (where entry = 'driver_receivable'), 0) as recv, count(*) as n
    into agg from order_ledger where source = p_source and source_id = p_source_id and phase = v_phase;
  if v_phase in ('created', 'adjusted', 'completed') then
    return jsonb_build_object('source', p_source, 'source_id', p_source_id, 'phase', v_phase, 'balanced', agg.gross = agg.partner + agg.rev,
      'verdict', case when agg.gross = agg.partner + agg.rev then 'balanced' else 'unbalanced' end, 'diff', agg.gross - agg.partner - agg.rev,
      'gross_customer', agg.gross, 'partner_payable', agg.partner, 'platform_revenue', agg.rev, 'driver_receivable', agg.recv,
      'formula', 'gross_customer = partner_payable + platform_revenue', 'rows', agg.n);
  end if;
  return jsonb_build_object('source', p_source, 'source_id', p_source_id, 'phase', v_phase, 'balanced', true, 'verdict', 'refund_recorded',
    'refund', agg.refund, 'penalty', agg.rev, 'rows', agg.n);
end $$;
revoke all on function public.ledger_check_source(text, uuid) from public, anon, authenticated;

create or replace function public.admin_ledger_unbalanced(p_limit int default 50)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_lim int := least(500, greatest(1, coalesce(p_limit, 50))); r record; lc jsonb;
  items jsonb := '[]'::jsonb; missing jsonb := '[]'::jsonb; n_checked int := 0; n_bad int := 0; n_miss int := 0; v_from timestamptz := now() - interval '30 days';
begin
  if not is_admin() then raise exception 'Hanya admin'; end if;
  for r in select o.id, o.code, o.service, o.city, o.completed_at, o.ledger_version, o.payment_method, o.paid_via, o.pg_channel, o.total
             from orders o where o.status = 'completed' and o.completed_at >= v_from order by o.completed_at desc loop
    n_checked := n_checked + 1;
    lc := ledger_check(r.id);
    if lc->>'verdict' = 'no_ledger' then
      if coalesce(r.ledger_version, 1) >= 2 then   -- order v2 wajib punya buku besar
        n_miss := n_miss + 1;
        if n_miss <= v_lim then missing := missing || jsonb_build_object('order_id', r.id, 'code', r.code, 'service', r.service, 'completed_at', r.completed_at, 'verdict', 'no_ledger'); end if;
      end if;
    elsif (lc->>'balanced')::boolean is false then
      n_bad := n_bad + 1;
      if n_bad <= v_lim then
        items := items || jsonb_build_object('order_id', r.id, 'code', r.code, 'service', r.service, 'city', r.city, 'completed_at', r.completed_at,
          'payment_method', r.payment_method, 'paid_via', r.paid_via, 'pg_channel', r.pg_channel, 'total', r.total,
          'phase', lc->>'phase', 'verdict', lc->>'verdict', 'diff', lc->'diff', 'diff_components', lc->'diff_components',
          'gross_customer', lc->'gross_customer', 'allocated', lc->'allocated', 'check', lc);
      end if;
    end if;
  end loop;
  return jsonb_build_object('from', v_from, 'to', now(), 'checked', n_checked, 'unbalanced', n_bad, 'missing_ledger', n_miss,
    'limit', v_lim, 'truncated', n_bad > v_lim or n_miss > v_lim, 'items', items, 'missing', missing);
end $$;
revoke all on function public.admin_ledger_unbalanced(int) from public, anon;
grant execute on function public.admin_ledger_unbalanced(int) to authenticated;
comment on function public.admin_ledger_unbalanced(int) is
  '0104: Panel Admin → Buku Besar: order selesai 30 hari terakhir yang ledger_check.balanced = false (maks p_limit, 1–500), plus order ledger_version 2 tanpa baris buku besar (missing).';

create or replace function public.admin_ledger_lookup(p_query text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare q text := nullif(btrim(coalesce(p_query, '')), ''); qu text; v_uuid uuid; res jsonb := '[]'; r record;
begin
  if not is_admin() then raise exception 'Hanya admin'; end if;
  if q is null or length(q) < 3 then raise exception 'Masukkan minimal 3 karakter kode atau ID'; end if;
  if length(q) > 100 then raise exception 'Kata kunci terlalu panjang'; end if;
  qu := upper(q);
  begin v_uuid := q::uuid; exception when invalid_text_representation then v_uuid := null; end;

  -- orders: id persis, kode persis, atau awalan kode (≥ 5 karakter; tanpa wildcard LIKE)
  for r in select o.* from orders o
            where (v_uuid is not null and o.id = v_uuid)
               or (v_uuid is null and (upper(o.code) = qu or (length(q) >= 5 and left(upper(o.code), length(qu)) = qu)))
            order by (upper(o.code) = qu) desc, o.created_at desc limit 20 loop
    res := res || jsonb_build_object('source', 'orders', 'source_id', r.id, 'order_id', r.id, 'code', r.code, 'service', r.service,
      'status', r.status, 'payment_status', r.payment_status, 'payment_method', r.payment_method, 'paid_via', r.paid_via,
      'total', r.total, 'created_at', r.created_at, 'completed_at', r.completed_at, 'ledger_version', r.ledger_version,
      'check', ledger_check(r.id),
      'rows', coalesce((select jsonb_agg(to_jsonb(l) - 'order_id' order by case l.phase when 'created' then 0 when 'adjusted' then 1 when 'completed' then 2 when 'cancelled' then 3 when 'refunded' then 4 else 5 end, l.id)
                        from order_ledger l where l.order_id = r.id and l.source = 'orders'), '[]'::jsonb));
  end loop;

  for r in select 'travel_bookings'::text as src, b.id, b.code, b.status::text as status, b.payment_status::text as payment_status, b.payment_method::text as payment_method,
                  b.price as total, b.created_at from travel_bookings b
            where (v_uuid is not null and b.id = v_uuid) or (v_uuid is null and (upper(b.code) = qu or (length(q) >= 5 and left(upper(b.code), length(qu)) = qu)))
           union all
           select 'travel_requests', t.id, t.code, t.status::text, t.payment_status::text, t.payment_method::text, t.price, t.created_at from travel_requests t
            where (v_uuid is not null and t.id = v_uuid) or (v_uuid is null and (upper(t.code) = qu or (length(q) >= 5 and left(upper(t.code), length(qu)) = qu)))
           order by created_at desc limit 20 loop
    res := res || jsonb_build_object('source', r.src, 'source_id', r.id, 'order_id', null, 'code', r.code, 'service', 'travel',
      'status', r.status, 'payment_status', r.payment_status, 'payment_method', r.payment_method, 'total', r.total, 'created_at', r.created_at,
      'check', ledger_check_source(r.src, r.id),
      'rows', coalesce((select jsonb_agg(to_jsonb(l) order by case l.phase when 'created' then 0 when 'adjusted' then 1 when 'completed' then 2 when 'cancelled' then 3 when 'refunded' then 4 else 5 end, l.id)
                        from order_ledger l where l.source = r.src and l.source_id = r.id), '[]'::jsonb));
  end loop;

  if v_uuid is not null then
    for r in select a.*, m.name as merchant_name from merchant_ads a left join merchants m on m.id = a.merchant_id where a.id = v_uuid loop
      res := res || jsonb_build_object('source', 'merchant_ads', 'source_id', r.id, 'order_id', null, 'code', null, 'service', null,
        'status', r.status, 'merchant_id', r.merchant_id, 'merchant_name', r.merchant_name, 'product_code', r.product_code,
        'total', r.price_paid, 'created_at', r.created_at, 'check', ledger_check_source('merchant_ads', r.id),
        'rows', coalesce((select jsonb_agg(to_jsonb(l) order by l.id) from order_ledger l where l.source = 'merchant_ads' and l.source_id = r.id), '[]'::jsonb));
    end loop;
  end if;
  return jsonb_build_object('query', q, 'count', jsonb_array_length(res), 'results', res);
end $$;
revoke all on function public.admin_ledger_lookup(text) from public, anon;
grant execute on function public.admin_ledger_lookup(text) to authenticated;
comment on function public.admin_ledger_lookup(text) is
  '0104: Panel Admin → Buku Besar: cari orders (kode/ID, awalan kode ≥ 5 karakter), travel_bookings / travel_requests (kode/ID), merchant_ads (ID) → baris order_ledger per fase + putusan keseimbangan (ledger_check / ledger_check_source).';

-- =====================================================================
-- 6. BIAYA TETAP KOTA: hapus sel & kosongkan catatan
-- =====================================================================
drop function if exists public.admin_set_city_fixed_cost(uuid, date, text, bigint, text);
create or replace function public.admin_set_city_fixed_cost(p_city_id uuid, p_month date, p_category text, p_amount bigint,
  p_note text default null, p_delete boolean default false)
returns city_fixed_costs
language plpgsql security definer set search_path = public as $$
declare b city_fixed_costs; a city_fixed_costs; v_month date := date_trunc('month', p_month)::date; v_cat text := lower(trim(coalesce(p_category, ''))); v_city text;
  v_note text := case when p_note is null then null else nullif(btrim(p_note), '') end;
begin
  if not is_admin() then raise exception 'Hanya admin'; end if;
  perform admin_require_unlock();
  select name into v_city from cities where id = p_city_id;
  if v_city is null then raise exception 'Kota tidak ditemukan'; end if;
  if p_month is null then raise exception 'Bulan wajib diisi'; end if;
  if v_cat not in ('tim','akuisisi','kantor','legal','teknologi','lainnya','variable_ops') then
    raise exception 'Kategori harus tim|akuisisi|kantor|legal|teknologi|lainnya|variable_ops';
  end if;
  select * into b from city_fixed_costs where city_id = p_city_id and month = v_month and category = v_cat for update;

  if coalesce(p_delete, false) then   -- 0104: hapus sel (kota, bulan, kategori); tidak ada → tidak ada perubahan
    if coalesce(p_amount, 0) <> 0 then raise exception 'Untuk menghapus biaya, kirim nominal 0 (p_amount = 0)'; end if;
    if b.id is null then return null; end if;
    delete from city_fixed_costs where id = b.id;
    perform log_activity('city_cost.deleted', 'city_fixed_costs', b.id::text,
      format('Biaya %s %s %s dihapus (Rp%s)', v_cat, v_city, to_char(v_month, 'YYYY-MM'), b.amount), jsonb_build_object('before', to_jsonb(b), 'after', null));
    return b;
  end if;

  if v_month < date '2024-01-01' or v_month > (date_trunc('month', now()) + interval '12 months')::date then raise exception 'Bulan di luar rentang wajar (2024 s.d. 12 bulan ke depan)'; end if;
  if p_amount is null or p_amount < 0 or p_amount > 100000000000 then raise exception 'Nominal harus Rp0–Rp100 miliar'; end if;
  if b.id is not null then
    -- p_note null → catatan lama dipertahankan; '' (atau spasi) → catatan dikosongkan (0104)
    update city_fixed_costs set amount = p_amount, note = case when p_note is null then note else v_note end, updated_at = now(), created_by = coalesce(created_by, auth.uid())
     where id = b.id returning * into a;
  else
    insert into city_fixed_costs (city_id, month, category, amount, note, created_by) values (p_city_id, v_month, v_cat, p_amount, v_note, auth.uid())
    returning * into a;
  end if;
  perform log_activity('city_cost.updated', 'city_fixed_costs', a.id::text,
    format('Biaya %s %s %s: Rp%s → Rp%s', v_cat, v_city, to_char(v_month, 'YYYY-MM'), coalesce(b.amount::text, '-'), a.amount),
    jsonb_build_object('before', case when b.id is null then null else to_jsonb(b) end, 'after', to_jsonb(a)));
  return a;
end $$;
revoke all on function public.admin_set_city_fixed_cost(uuid, date, text, bigint, text, boolean) from public, anon;
grant execute on function public.admin_set_city_fixed_cost(uuid, date, text, bigint, text, boolean) to authenticated;
comment on function public.admin_set_city_fixed_cost(uuid, date, text, bigint, text, boolean) is
  'Panel Admin → Biaya Tetap Kota (0102, 0104): upsert satu sel (kota, bulan, kategori) — PIN + audit city_cost.updated. p_delete=true (dengan p_amount 0) menghapus sel (audit city_cost.deleted). p_note null = catatan tetap, '''' = dikosongkan.';

-- =====================================================================
-- 7. RINCIAN MERCHANT: pesanan batal/refund → diterima 0
-- =====================================================================
create or replace function public.merchant_order_breakdown(p_order uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare o orders; v_phase text; agg record; v_lphase text;
begin
  select * into o from orders where id = p_order;
  if not found then raise exception 'Order tidak ditemukan'; end if;
  if o.merchant_id is null then raise exception 'Bukan pesanan merchant'; end if;
  if not (coalesce(owns_merchant(o.merchant_id), false) or coalesce(is_admin(), false)) then raise exception 'Bukan pesanan merchant Anda'; end if;
  if o.status = 'cancelled' or o.payment_status = 'refunded' then
    -- 0104: pesanan batal/direfund — merchant tidak menerima apa pun (fase ledger cancelled/refunded tidak punya merchant_payable)
    select phase into v_lphase from order_ledger where order_id = p_order and source = 'orders' and phase in ('refunded', 'cancelled')
     order by case phase when 'refunded' then 0 else 1 end limit 1;
    return jsonb_build_object('order_id', o.id, 'code', o.code, 'status', o.status, 'phase', 'cancelled', 'ledger_phase', v_lphase,
      'ledger_version', o.ledger_version, 'nilai_pesanan', coalesce(o.items_subtotal, 0), 'fee_pct', coalesce(o.merchant_fee_pct_snap, 0),
      'fee', 0, 'promo_merchant', 0, 'diterima', 0, 'payment_method', o.payment_method, 'payment_status', o.payment_status,
      'cancel_reason', o.cancel_reason,
      'keterangan', 'Pesanan dibatalkan' || case when o.payment_status = 'refunded' then ' dan dana dikembalikan ke pelanggan' else '' end || ' — tidak ada dana yang diterima merchant');
  end if;
  select phase into v_phase from order_ledger where order_id = p_order and source = 'orders' and phase in ('completed', 'adjusted', 'created')
   order by case phase when 'completed' then 0 when 'adjusted' then 1 else 2 end limit 1;
  if v_phase is null then
    return jsonb_build_object('order_id', o.id, 'code', o.code, 'status', o.status, 'phase', null, 'ledger_version', o.ledger_version,
      'nilai_pesanan', o.items_subtotal, 'fee_pct', null, 'fee', o.items_subtotal - o.merchant_earning, 'promo_merchant', 0, 'diterima', o.merchant_earning, 'payment_method', o.payment_method);
  end if;
  select
    coalesce(sum(amount) filter (where entry = 'items_subtotal'), 0) as items,
    coalesce(sum(amount) filter (where entry = 'merchant_fee'), 0) as fee,
    coalesce(-sum(amount) filter (where entry = 'promo_merchant'), 0) as promo_m,
    coalesce(-sum(amount) filter (where entry = 'merchant_payable'), 0) as merch
  into agg from order_ledger where order_id = p_order and source = 'orders' and phase = v_phase;
  return jsonb_build_object('order_id', o.id, 'code', o.code, 'status', o.status, 'phase', v_phase, 'ledger_version', o.ledger_version,
    'nilai_pesanan', agg.items, 'fee_pct', coalesce(o.merchant_fee_pct_snap, 0), 'fee', agg.fee, 'promo_merchant', agg.promo_m,
    'diterima', agg.merch, 'payment_method', o.payment_method,
    'keterangan', case when o.payment_method = 'cash' then 'Dibayar tunai oleh driver saat mengambil pesanan' else 'Dikreditkan ke saldo AntarPay saat order selesai' end);
end $$;
revoke all on function public.merchant_order_breakdown(uuid) from public, anon;
grant execute on function public.merchant_order_breakdown(uuid) to authenticated;
comment on function public.merchant_order_breakdown(uuid) is 'Rincian per order untuk merchant dari order_ledger (§9): nilai pesanan, fee platform %, promo ditanggung merchant, diterima. Sejak 0104 pesanan batal/refund → phase cancelled, diterima 0.';

drop function if exists public.skema_v2_splice(text, text, text, text, boolean);

comment on function public.create_order(jsonb) is
  'Membuat pesanan untuk semua layanan (ride/car/food/send/box/shop/market). '
  'Sejak 0080 pesanan DITOLAK bila titik jemput berada di kota yang layanannya belum dibuka. '
  'Sejak 0083 idempoten: p.client_request_id yang sama mengembalikan pesanan yang sudah ada. '
  'Sejak 0088/0089 paid_via DITOLAK bila AntarPay/salurannya dimatikan admin. '
  'Sejak 0099 komisi/fee/biaya platform dibaca dari service_economics (snapshot ke orders), promo punya pemilik biaya (promos.funded_by), buku besar order_ledger fase created. '
  'Sejak 0100 paid_via saluran gateway (payment_gateway_channel_keys) → status awaiting_payment, payment_status unpaid, saldo TIDAK dipotong; bayar lewat midtrans-create (purpose=order) → payment_settle. '
  'Sejak 0104 saluran gateway per order boleh walau AntarPay nonaktif bila gateway_order_payment_enabled (payment_channel_require_order).';

-- =====================================================================
-- 8. Penjaga migrasi
-- =====================================================================
do $$
declare chk record; def text; miss text := ''; o orders; j jsonb;
begin
  for chk in select * from (values
      ('driver_can_take', 'order_payment_pending(o)'), ('driver_accept_order', '0104 belum lunas'), ('driver_accept_order', 'and not order_payment_pending(orders)'),
      ('driver_available_orders', '0104 belum lunas'), ('release_scheduled_orders', '0104 belum lunas'), ('travel_accept_send', '0104 belum lunas'),
      ('travel_send_available', '0104 belum lunas'), ('merchant_update_order', '0104 belum lunas'), ('cancel_order', '0104 belum lunas'),
      ('expire_unpaid_orders', '0104 tagihan kedaluwarsa'), ('create_order', '0104 bayar per order via gateway'), ('create_order', 'payment_channel_require_order(v_paid_via)'),
      ('order_payment_prepare', 'payment_channel_require_order(v_ch)'), ('app_public_settings', 'gateway_order_payment_enabled'), ('app_public_settings', '''driver_debt_limit'''),
      ('gateway_public_config', 'gateway_order_payment_enabled'), ('admin_payment_channels', 'gateway_order_payment_enabled'),
      ('admin_automation_status', '0104 ambang bisnis'), ('admin_set_settings', '0104 ambang bisnis'),
      ('skema_v2_report', 'v_gate_weeks int :='), ('skema_v2_report', 'p_to - 7 * v_gate_weeks'), ('skema_v2_report', 'make_interval(weeks => v_gate_weeks - 1)'),
      ('skema_v2_report', '''weeks_required'', v_gate_weeks'), ('skema_v2_report', 'jsonb_build_object(''value'', v_gate_weeks'),
      ('service_economics_public', '''pg_fee_policy'''), ('merchant_order_breakdown', '''cancelled''')) as t(fn, marker) loop
    select pg_get_functiondef(p.oid) into def from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace where ns.nspname = 'public' and p.proname = chk.fn;
    if def is null or position(chk.marker in def) = 0 then miss := miss || chk.fn || '[' || chk.marker || '] '; end if;
  end loop;
  if miss <> '' then raise exception '0104 batal: tambalan belum terpasang: %', miss; end if;
  if position('payment_channel_require(v_paid_via)' in pg_get_functiondef('public.create_order(jsonb)'::regprocedure)) > 0 then
    raise exception '0104 batal: create_order masih memanggil payment_channel_require langsung';
  end if;
  if position('interval ''7 weeks''' in pg_get_functiondef('public.skema_v2_report(date,date,jsonb)'::regprocedure)) > 0 then
    raise exception '0104 batal: skema_v2_report masih memakai 8 minggu tertanam';
  end if;
  -- hak akses
  if not has_function_privilege('anon', 'public.pg_fee_estimate(service_type,text,bigint)', 'EXECUTE')
     or not has_function_privilege('anon', 'public.service_economics_public(service_type)', 'EXECUTE') then
    raise exception '0104 batal: pg_fee_estimate/service_economics_public harus bisa dipanggil anon';
  end if;
  if has_function_privilege('anon', 'public.admin_set_gateway_order_payment(boolean)', 'EXECUTE')
     or has_function_privilege('anon', 'public.admin_ledger_unbalanced(integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.admin_ledger_lookup(text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.admin_business_settings()', 'EXECUTE')
     or has_function_privilege('anon', 'public.admin_set_city_fixed_cost(uuid,date,text,bigint,text,boolean)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.ledger_check_source(text,uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.business_setting_specs()', 'EXECUTE') then
    raise exception '0104 batal: RPC admin/internal terbuka untuk klien';
  end if;
  if (select count(*) from pg_proc where proname = 'admin_set_city_fixed_cost' and pronamespace = 'public'::regnamespace) <> 1 then
    raise exception '0104 batal: admin_set_city_fixed_cost harus tepat satu fungsi';
  end if;
  -- perilaku
  if not exists (select 1 from app_settings where key = 'gateway_order_payment_enabled') or not exists (select 1 from app_settings where key = 'gate_contribution_weeks') then
    raise exception '0104 batal: app_settings gateway_order_payment_enabled / gate_contribution_weeks belum ada';
  end if;
  o.status := 'awaiting_payment'; o.payment_status := 'unpaid'; o.paid_via := 'qris';
  if not order_payment_pending(o) then raise exception '0104 batal: order_payment_pending(awaiting_payment) harus true'; end if;
  o.status := 'searching'; o.payment_status := 'unpaid'; o.paid_via := 'cash';
  if order_payment_pending(o) then raise exception '0104 batal: pesanan tunai tidak boleh dianggap belum lunas'; end if;
  o.paid_via := null; o.payment_status := null;
  if order_payment_pending(o) is distinct from false then raise exception '0104 batal: order_payment_pending harus false (bukan null) untuk baris tanpa pembayaran'; end if;
  j := pg_fee_estimate('send', 'qris', 100000);
  if (j->>'fee')::bigint <> 700 or (j->>'ppn')::bigint <> 0 or j->>'borne_by' is null then raise exception '0104 batal: pg_fee_estimate(qris, 100.000) = %', j; end if;
  j := pg_fee_estimate('send', 'cash', 100000);
  if (j->>'total_fee')::bigint <> 0 or j->>'borne_by' is not null then raise exception '0104 batal: pg_fee_estimate(cash) harus 0 tanpa borne_by: %', j; end if;
  if not (service_economics_public('food') ? 'pg_fee_policy') then raise exception '0104 batal: service_economics_public tanpa pg_fee_policy'; end if;
  if not (app_public_settings() ? 'driver_debt_limit') then raise exception '0104 batal: app_public_settings tanpa driver_debt_limit'; end if;
  if (select count(*) from business_setting_specs()) <> 11 then raise exception '0104 batal: spesifikasi ambang bisnis harus 11 kunci'; end if;
  j := skema_v2_report(current_date - 7, current_date, '{}'::jsonb);
  if jsonb_array_length(j->'weeks') <> setting_num('gate_contribution_weeks', 8)::int then
    raise exception '0104 batal: weeks exec_report_v2 (%) ≠ gate_contribution_weeks', jsonb_array_length(j->'weeks');
  end if;
  raise notice '0104 ok: pagar belum-lunas (driver/travel/merchant/jadwal/batal), pg_fee_estimate, sakelar gateway per order (default %), ambang bisnis ber-PIN, admin_ledger_unbalanced/lookup, hapus biaya kota, rincian merchant batal',
    gateway_order_payment_enabled();
end $$;
