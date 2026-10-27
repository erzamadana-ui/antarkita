-- Dihasilkan 27 Okt 2026: definisi 20 fungsi pada status 0113 (dari harness lokal, identik dengan produksi setelah normalisasi komentar).
-- Tujuan: memulihkan komentar jangkar di produksi (apply_migration MCP pernah menghapus komentar) agar _v3_splice 0114–0116 menemukan jangkarnya.
CREATE OR REPLACE FUNCTION public.admin_set_settings(p jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  k text; v jsonb; s record; n numeric; t text; biz jsonb := '{}'::jsonb; val jsonb := '{}'::jsonb; before jsonb := '{}'::jsonb;
  before_all jsonb := '{}'::jsonb; v_bad text; ringkas text;
  -- 0104 ambang bisnis: sakelar yang punya RPC khusus (PIN + audit sendiri) tidak boleh lewat jalur umum
  protected constant text[] := array['antarpay_enabled', 'payment_channels', 'pg_methods', 'gateway_order_payment_enabled', 'pg_last_webhook_at', 'services_enabled'];
begin
  -- T3: SEMUA kunci = izin payment_config + PIN; kunci di luar app_setting_specs() ditolak
  perform admin_require('payment_config');
  perform admin_require_unlock();
  if p is null or jsonb_typeof(p) <> 'object' or p = '{}'::jsonb then raise exception 'Pengaturan harus objek JSON {kunci: nilai}'; end if;
  -- validasi SEMUA kunci dulu (tidak ada yang ditulis bila satu saja tidak valid)
  for k, v in select * from jsonb_each(p) loop
    if k !~ '^[a-z_0-9]+$' then raise exception 'Kunci tidak valid: %', k; end if;
    if k = any (protected) then raise exception 'Pengaturan % diubah lewat menunya sendiri (PIN + audit), bukan lewat pengaturan umum', k; end if;
    select * into s from app_setting_specs() x where x.key = k;
    if s.key is null then raise exception 'SETTING_UNKNOWN: kunci pengaturan % tidak dikenal (tidak ada di app_setting_specs)', k; end if;
    perform admin_require(s.perm);
    if s.value_type in ('int', 'numeric') then
      if jsonb_typeof(v) = 'number' then n := (v #>> '{}')::numeric;
      elsif jsonb_typeof(v) = 'string' and btrim(v #>> '{}') ~ '^-?[0-9]+(\.[0-9]+)?$' then n := btrim(v #>> '{}')::numeric;
      else raise exception 'Nilai % harus angka', k; end if;
      if s.value_type = 'int' and n <> trunc(n) then raise exception 'Nilai % harus bilangan bulat', k; end if;
      if (s.min_value is not null and n < s.min_value) or (s.max_value is not null and n > s.max_value) then
        raise exception 'Nilai % harus % s.d. % %', k, s.min_value, s.max_value, coalesce(s.unit, '');
      end if;
      val := val || jsonb_build_object(k, n);
    elsif s.value_type = 'bool' then
      if jsonb_typeof(v) = 'boolean' then val := val || jsonb_build_object(k, v);
      elsif lower(coalesce(v #>> '{}', '')) in ('true', 'false') then val := val || jsonb_build_object(k, lower(v #>> '{}')::boolean);
      else raise exception 'Nilai % harus true|false', k; end if;
    elsif s.value_type = 'text' then
      t := lower(btrim(coalesce(v #>> '{}', '')));
      if jsonb_typeof(v) <> 'string' or not (t = any (s.options)) then raise exception 'Nilai % harus salah satu dari: %', k, array_to_string(s.options, ' | '); end if;
      val := val || jsonb_build_object(k, t);
    elsif s.value_type = 'string' then
      t := btrim(coalesce(v #>> '{}', ''));
      if jsonb_typeof(v) <> 'string' or length(t) < coalesce(s.min_value, 0) or length(t) > coalesce(s.max_value, 200) then
        raise exception 'Nilai % harus teks % s.d. % karakter', k, coalesce(s.min_value, 0), coalesce(s.max_value, 200);
      end if;
      if k = 'support_phone' and t !~ '^\+?[0-9][0-9 -]{5,19}$' then raise exception 'support_phone harus nomor telepon (+62…)'; end if;
      val := val || jsonb_build_object(k, t);
    elsif s.value_type = 'json' then
      val := val || jsonb_build_object(k, setting_json_validate(k, v));
    else
      raise exception 'Tipe pengaturan % tidak dikenal (%)', k, s.value_type;
    end if;
    -- ambang bisnis v2/v3 (audit settings.business_updated seperti 0104)
    if exists (select 1 from business_setting_specs() b where b.key = k) or exists (select 1 from business_setting_specs_v3() b where b.key = k) then
      biz := biz || jsonb_build_object(k, val -> k);
    end if;
  end loop;

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
  select coalesce(jsonb_object_agg(b.key, a.value), '{}'::jsonb) into before_all
    from jsonb_object_keys(val) b(key) left join app_settings a on a.key = b.key;
  select coalesce(jsonb_object_agg(b.key, before_all -> b.key), '{}'::jsonb) into before from jsonb_object_keys(biz) b(key);

  for k, v in select * from jsonb_each(val) loop   -- disimpan dalam bentuk JSON bertipe (angka/boolean/teks/objek)
    insert into app_settings (key, value) values (k, v) on conflict (key) do update set value = excluded.value, updated_at = now();
  end loop;
  perform log_activity('settings.update', 'app_settings', 'batch', 'Pengaturan diubah: ' || (select string_agg(key, ', ') from jsonb_object_keys(val) key),
    jsonb_build_object('before', before_all, 'after', val));
  if biz <> '{}'::jsonb then
    select string_agg(format('%s: %s → %s', b.key, coalesce(before ->> b.key, '-'), biz ->> b.key), ', ') into ringkas from jsonb_object_keys(biz) b(key);
    perform log_activity('settings.business_updated', 'app_settings', 'business', 'Ambang bisnis diubah: ' || ringkas,
      jsonb_build_object('before', before, 'after', biz));
    if biz ? 'payment_provider_active' or biz ? 'payment_provider_env' or biz ? 'payments_simulation_enabled' then
      perform log_activity('payment.provider_switched', 'app_settings', 'payment_provider',
        'Provider pembayaran: ' || payment_provider_active() || ' (' || payment_provider_env() || '), simulasi ' || case when payments_simulation_active() then 'AKTIF' else 'mati' end,
        jsonb_build_object('before', before, 'after', biz));
    end if;
  end if;
end $function$
;

CREATE OR REPLACE FUNCTION public.admin_voucher_approve(p_purchase uuid, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v voucher_purchases; m voucher_bank_mutations; v_bal bigint; v_tx uuid; v_float bigint;
begin
  perform admin_require('wallet_adjust');
  perform admin_require_unlock();
  select * into v from voucher_purchases where id = p_purchase for update;
  if not found then raise exception 'Pembelian tidak ditemukan'; end if;
  if v.status = 'issued' then return to_jsonb(v) || jsonb_build_object('idempotent', true); end if;
  if v.status not in ('matched', 'amount_mismatch') then raise exception 'VOUCHER_STATE: status % belum bisa diterbitkan (butuh mutasi bank tercocok)', v.status; end if;
  if v.matched_by = auth.uid() then raise exception 'MAKER_CHECKER: penerbit voucher harus admin lain dari pencocok mutasi'; end if;
  select * into m from voucher_bank_mutations where id = v.mutation_id;
  if not found or m.status <> 'matched' or m.purchase_id <> v.id then raise exception 'MUTATION_STATE: mutasi bank tidak valid'; end if;
  select coalesce(sum(balance), 0) into v_float from wallets w where balance > 0 and not wallet_is_partner(w.user_id);
  if v_float + m.amount > voucher_setting_bigint('voucher_float_cap', 900000000) then
    raise exception 'VOUCHER_FLOAT_CAP: total saldo voucher akan melampaui batas % (kajian izin PJP) — tahan penerbitan', voucher_setting_bigint('voucher_float_cap', 900000000);
  end if;
  -- terbitkan sebesar dana yang BENAR-BENAR diterima (termasuk kode unik)
  v_bal := wallet_apply(v.user_id, 'topup', m.amount, null, 'Pembelian AntarVoucher ' || v.reference, v.reference);
  select id into v_tx from wallet_transactions where user_id = v.user_id and ref = v.reference and type = 'topup' order by created_at desc limit 1;
  -- lengkapi baris ledger yang baru dibuat (append-only: gunakan jalur pemeliharaan terkendali untuk kolom audit baris baru ini)
  perform set_config('antarkita.ledger_maintenance', 'on', true);
  update wallet_transactions set idempotency_key = 'voucher:' || v.id, bank_ref = m.bank_ref, approved_by = auth.uid(), source = 'voucher_purchase'
   where id = v_tx;
  perform set_config('antarkita.ledger_maintenance', 'off', true);
  update voucher_purchases set status = 'issued', approved_by = auth.uid(), approved_at = now(), issued_amount = m.amount, wallet_tx_id = v_tx,
         reason = coalesce(p_note, reason), updated_at = now() where id = v.id returning * into v;
  perform log_activity('voucher.issue', 'voucher_purchases', v.id::text, 'AntarVoucher terbit ' || v.reference || ' Rp' || m.amount,
    jsonb_build_object('mutation', m.bank_ref, 'balance_after', v_bal));
  if to_regprocedure('public.notify_user(uuid,text,text,jsonb)') is not null then
    execute 'select notify_user($1, $2, $3, $4)' using v.user_id, 'AntarVoucher diterbitkan',
      'Pembelian ' || v.reference || ' terverifikasi. Saldo bertambah Rp' || m.amount || '.', jsonb_build_object('type', 'voucher', 'id', v.id);
  end if;
  return to_jsonb(v) || jsonb_build_object('balance_after', v_bal);
end $function$
;

CREATE OR REPLACE FUNCTION public.app_setting_specs()
 RETURNS TABLE(key text, value_type text, min_value numeric, max_value numeric, options text[], default_value jsonb, unit text, label text, note text, perm text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select s.key, case when s.is_int then 'int' else 'numeric' end, s.min_value, s.max_value, null::text[], to_jsonb(s.default_value),
         s.unit, s.label, s.note, 'payment_config' from business_setting_specs() s
  union all
  select v.key, v.value_type, v.min_value, v.max_value, v.options, v.default_value, v.unit, v.label, v.note, v.perm from business_setting_specs_v3() v
  union all
  select ('max_km_' || e::text), 'numeric', 0.5, 5000, null::text[], null::jsonb, 'km', 'UMUM', 'Batas jarak dalam kota layanan ' || e::text, 'pricing'
    from unnest(enum_range(null::service_type)) e
  union all
  select g.* from (values
    ('admin_session_minutes',      'int',     5::numeric, 720::numeric, null::text[], '60'::jsonb, 'menit', 'KEAMANAN', 'Durasi sesi PIN panel admin', 'admin_role'),
    ('bank_account',               'json',    null, null, null, null, '', 'UANG', 'Rekening tujuan top up manual {bank, name, number}', 'payment_config'),
    ('app_name',                   'string',  1, 60, null, null, '', 'UMUM', 'Nama aplikasi', 'payment_config'),
    ('support_phone',              'string',  6, 20, null, null, '', 'UMUM', 'Nomor CS (+62…)', 'ticket'),
    ('pg_provider',                'text',    null, null, array['midtrans','finpay'], '"midtrans"', '', 'UANG', 'Provider gateway v2 (lama) — v3 memakai payment_provider_active', 'payment_config'),
    ('pg_topup_min',               'int',     1000, 10000000, null, '10000', 'Rp', 'UANG', 'Nominal top up minimum', 'payment_config'),
    ('pg_topup_max',               'int',     10000, 100000000, null, '10000000', 'Rp', 'UANG', 'Nominal top up maksimum', 'payment_config'),
    ('gateway_fee_pct',            'numeric', 0, 10, null, null, '%', 'UANG', 'Asumsi biaya gateway (laporan)', 'fee'),
    ('target_take_rate_pct',       'numeric', 0, 100, null, null, '%', 'UANG', 'Target take rate', 'fee'),
    ('helper_fee',                 'int',     0, 10000000, null, null, 'Rp', 'UANG', 'Biaya helper angkut', 'pricing'),
    ('market_driver_share_pct',    'numeric', 0, 100, null, null, '%', 'UANG', 'Porsi driver jasa belanja pasar', 'pricing'),
    ('market_service_min',         'int',     0, 10000000, null, null, 'Rp', 'UANG', 'Biaya jasa belanja pasar minimum', 'pricing'),
    ('market_service_pct',         'numeric', 0, 100, null, null, '%', 'UANG', 'Biaya jasa belanja pasar', 'pricing'),
    ('shop_driver_share_pct',      'numeric', 0, 100, null, null, '%', 'UANG', 'Porsi driver jasa belanja toko', 'pricing'),
    ('shop_service_min',           'int',     0, 10000000, null, null, 'Rp', 'UANG', 'Biaya jasa belanja toko minimum', 'pricing'),
    ('shop_service_pct',           'numeric', 0, 100, null, null, '%', 'UANG', 'Biaya jasa belanja toko', 'pricing'),
    ('shop_budget_buffer_pct',     'numeric', 0, 100, null, null, '%', 'UANG', 'Cadangan anggaran belanja', 'pricing'),
    ('shop_budget_coef',           'numeric', 1, 5, null, null, '×', 'UANG', 'Koefisien batas total belanja', 'pricing'),
    ('shop_car_factor',            'numeric', 1, 5, null, null, '×', 'UANG', 'Faktor ongkir belanja mobil', 'pricing'),
    ('shop_car_min_budget',        'int',     0, 100000000, null, null, 'Rp', 'UANG', 'Anggaran minimum belanja mobil', 'pricing'),
    ('travel_cancel_free_hours',   'int',     0, 168, null, null, 'jam', 'UANG', 'Batal travel gratis sebelum N jam', 'pricing'),
    ('travel_commission_pct',      'numeric', 0, 100, null, null, '%', 'UANG', 'Komisi travel', 'pricing'),
    ('travel_daily_hours',         'int',     1, 24, null, null, 'jam', 'UMUM', 'Jam operasional travel harian', 'pricing'),
    ('travel_platform_fee',        'int',     0, 10000000, null, null, 'Rp', 'UANG', 'Biaya platform travel', 'pricing'),
    ('travel_request_commission_pct','numeric',0, 100, null, null, '%', 'UANG', 'Komisi permintaan travel', 'pricing'),
    ('travel_send_partner_pct',    'numeric', 0, 100, null, null, '%', 'UANG', 'Porsi mitra kirim antarkota', 'pricing'),
    ('intercity_partner_share_pct','numeric', 0, 100, null, null, '%', 'UANG', 'Porsi mitra antarkota', 'pricing'),
    ('retention_budget_month',     'int',     0, 1000000000, null, null, 'Rp', 'UANG', 'Anggaran promo retensi per bulan', 'promo'),
    ('retention_promo_max',        'int',     0, 10000000, null, null, 'Rp', 'UANG', 'Maks diskon promo retensi', 'promo'),
    ('retention_promo_value',      'numeric', 0, 100, null, null, '%', 'UANG', 'Diskon promo retensi', 'promo'),
    ('retention_cooldown_days',    'int',     1, 365, null, null, 'hari', 'OTOMASI', 'Jeda antar promo retensi', 'promo'),
    ('retention_days',             'int',     1, 365, null, null, 'hari', 'OTOMASI', 'Tidak aktif selama N hari → promo retensi', 'promo'),
    ('retention_enabled',          'bool',    null, null, null, null, '', 'OTOMASI', 'Promo retensi otomatis', 'promo'),
    ('dynamic_pricing_enabled',    'bool',    null, null, null, null, '', 'OTOMASI', 'Harga dinamis', 'pricing'),
    ('dynamic_max_multiplier',     'numeric', 1, 5, null, null, '×', 'OTOMASI', 'Pengganda maksimum', 'pricing'),
    ('dynamic_step',               'numeric', 0, 2, null, null, '×', 'OTOMASI', 'Langkah kenaikan', 'pricing'),
    ('dynamic_radius_km',          'numeric', 0.5, 100, null, null, 'km', 'OTOMASI', 'Radius harga dinamis', 'pricing'),
    ('dynamic_window_min',         'int',     1, 1440, null, null, 'menit', 'OTOMASI', 'Jendela waktu harga dinamis', 'pricing'),
    ('price_coef_min',             'numeric', 0.1, 1, null, null, '×', 'OTOMASI', 'Koef. harga minimum', 'pricing'),
    ('price_coef_max',             'numeric', 1, 10, null, null, '×', 'OTOMASI', 'Koef. harga maksimum', 'pricing'),
    ('price_coef_hard',            'numeric', 1, 10, null, null, '×', 'OTOMASI', 'Koef. tolak (batas keras)', 'pricing'),
    ('auto_verify_enabled',        'bool',    null, null, null, null, '', 'OTOMASI', 'Verifikasi mitra otomatis', 'driver'),
    ('auto_verify_min_score',      'int',     0, 100, null, null, 'skor', 'OTOMASI', 'Skor minimum verifikasi otomatis', 'driver'),
    ('probation_days',             'int',     0, 365, null, null, 'hari', 'OTOMASI', 'Masa percobaan mitra', 'driver'),
    ('probation_daily_orders',     'int',     0, 1000, null, null, 'order', 'OTOMASI', 'Batas order/hari saat percobaan', 'driver'),
    ('driver_selfie_hours',        'int',     1, 168, null, null, 'jam', 'OTOMASI', 'Selfie ulang driver tiap N jam', 'driver'),
    ('driver_code_lookup_per_hour','int',     1, 10000, null, null, 'per jam', 'KEAMANAN', 'Batas cari kode driver per jam', 'driver'),
    ('class_fallback_minutes',     'int',     0, 60, null, null, 'menit', 'OTOMASI', 'Fallback kelas kendaraan', 'orders'),
    ('direct_order_fallback',      'bool',    null, null, null, null, '', 'OTOMASI', 'Order langsung jatuh ke umum bila tidak diterima', 'orders'),
    ('direct_order_hold_seconds',  'int',     0, 3600, null, null, 'detik', 'OTOMASI', 'Tahan order langsung', 'orders'),
    ('schedule_release_min',       'int',     1, 1440, null, null, 'menit', 'OTOMASI', 'Order terjadwal dilepas N menit sebelumnya', 'orders'),
    ('wait_apology_minutes',       'int',     0, 120, null, null, 'menit', 'OTOMASI', 'Pesan maaf bila menunggu lebih dari N menit', 'orders'),
    ('search_radius_km',           'numeric', 0.5, 100, null, null, 'km', 'UMUM', 'Radius pencarian', 'orders'),
    ('max_route_ratio',            'numeric', 1, 10, null, null, '×', 'UMUM', 'Rasio rute maksimum', 'orders'),
    ('fraud_auto_suspend',         'bool',    null, null, null, null, '', 'KEAMANAN', 'Tangguhkan otomatis bila fraud', 'driver'),
    ('fraud_cancel_limit',         'int',     1, 1000, null, null, 'per 24 jam', 'KEAMANAN', 'Pembatalan driver per 24 jam', 'driver'),
    ('fraud_gps_speed_kmh',        'int',     10, 2000, null, null, 'km/jam', 'KEAMANAN', 'Lompatan GPS ditandai di atas', 'driver'),
    ('customer_withdrawal_enabled','bool',    null, null, null, null, '', 'UANG', 'Penarikan saldo oleh pelanggan', 'payment_config'),
    ('reports_enabled',            'bool',    null, null, null, null, '', 'OTOMASI', 'Laporan terjadwal', 'report'),
    ('ticket_per_hour',            'int',     1, 1000, null, null, 'per jam', 'KEAMANAN', 'Batas tiket per jam', 'ticket'),
    ('estimate_per_hour',          'int',     1, 100000, null, null, 'per jam', 'KEAMANAN', 'Batas estimasi tarif per jam', 'orders'),
    ('resolve_per_hour',           'int',     1, 100000, null, null, 'per jam', 'KEAMANAN', 'Batas resolve alamat per jam', 'orders'),
    ('place_auto_approve_reports', 'int',     1, 100, null, null, 'laporan', 'OTOMASI', 'Laporan untuk aktif otomatis', 'city'),
    ('place_dedup_radius_m',       'int',     1, 5000, null, null, 'meter', 'OTOMASI', 'Radius dedup usulan tempat', 'city'),
    ('vendor_quality_min',         'int',     0, 100, null, null, 'skor', 'OTOMASI', 'Skor kualitas minimum pedagang', 'merchant'),
    ('osm_auto_refresh_enabled',   'bool',    null, null, null, null, '', 'PETA', 'Penyegaran impor peta otomatis', 'city'),
    ('osm_auto_refresh_days',      'int',     1, 365, null, null, 'hari', 'PETA', 'Interval penyegaran impor peta', 'city'),
    ('osm_city_assign_max_km',     'numeric', 1, 500, null, null, 'km', 'PETA', 'Jarak maks penetapan kota', 'city'),
    ('osm_import_enabled',         'bool',    null, null, null, null, '', 'PETA', 'Impor tempat dari peta', 'city'),
    ('osm_import_max_per_task',    'int',     50, 3000, null, null, 'tempat', 'PETA', 'Maks tempat per tugas impor', 'city'),
    ('osm_import_pause_ms',        'int',     0, 60000, null, null, 'ms', 'PETA', 'Jeda antar permintaan impor', 'city'),
    ('osm_import_radius_km',       'numeric', 0.5, 100, null, null, 'km', 'PETA', 'Radius impor tempat', 'city'),
    ('pickup_radius_km',           'json',    null, null, null, null, 'km', 'UMUM', 'Radius terima order per layanan {layanan: km}', 'orders'),
    ('priority_tiers',             'json',    null, null, null, null, '', 'UMUM', 'Antrean prioritas driver [{min_rating, delay_s}]', 'orders'),
    ('send_limits',                'json',    null, null, null, null, '', 'UMUM', 'Batas berat/ukuran kirim {kendaraan: {max_kg, max_cm}}', 'orders'),
    ('pin_services',               'json',    null, null, null, null, '', 'UMUM', 'Layanan yang wajib PIN serah terima', 'orders'),
    ('same_city_services',         'json',    null, null, null, null, '', 'UMUM', 'Layanan dalam kota', 'orders')
  ) as g(key, value_type, min_value, max_value, options, default_value, unit, label, note, perm)
  where not exists (select 1 from business_setting_specs() b where b.key = g.key)
    and not exists (select 1 from business_setting_specs_v3() b where b.key = g.key);
$function$
;

CREATE OR REPLACE FUNCTION public.driver_accept_order(p_order_id uuid)
 RETURNS orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare d drivers%rowtype; o orders%rowtype; v_active int; v_bal bigint;
begin
  select * into d from drivers where id = auth.uid();
  if not found or d.status <> 'approved' then raise exception 'Akun driver belum aktif'; end if;
  if not d.is_online then raise exception 'Aktifkan status online dulu'; end if;
  select balance into v_bal from wallets where user_id = d.id;
  if coalesce(v_bal, 0) < setting_num('driver_debt_limit', -500000)::bigint then   -- 0099: batas dari app_settings
    raise exception 'Saldo minus melebihi batas (Rp%). Top up dulu untuk menerima order.', replace(to_char(abs(setting_num('driver_debt_limit', -500000)), 'FM999,999,999,999'), ',', '.');
  end if;
  select count(*) into v_active from orders where driver_id = d.id and status in ('accepted','arrived','in_progress');
  if v_active > 0 then raise exception 'Selesaikan order aktif dulu'; end if;
  if exists (select 1 from orders x where x.id = p_order_id and order_payment_pending(x)) then   -- 0104 belum lunas
    raise exception 'Pesanan ini belum dibayar pelanggan (menunggu pembayaran). Pesanan baru bisa diterima setelah pembayaran masuk.';
  end if;
  select * into o from orders where id = p_order_id and status = 'searching';
  if not found or not driver_can_take(d, o) then raise exception 'Order sudah diambil driver lain atau tidak cocok dengan kendaraan Anda'; end if;
  update orders set driver_id = d.id, status = 'accepted', accepted_at = now() where id = p_order_id and status = 'searching' and not order_payment_pending(orders) returning * into o;
  if not found then raise exception 'Order sudah diambil driver lain'; end if;
  insert into order_events (order_id, status, actor_id, note) values (o.id, 'accepted', d.id, 'Driver menerima pesanan');
  return o;
end $function$
;

CREATE OR REPLACE FUNCTION public.driver_set_online(p_online boolean, p_lat double precision DEFAULT NULL::double precision, p_lng double precision DEFAULT NULL::double precision)
 RETURNS drivers
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare d drivers%rowtype; v_bal bigint; v_hours numeric := setting_num('driver_selfie_hours', 20);
begin
  select * into d from drivers where id = auth.uid();
  if not found then raise exception 'Belum terdaftar sebagai driver'; end if;
  if p_online then
    if d.status <> 'approved' then raise exception 'Akun driver belum disetujui admin'; end if;
    select balance into v_bal from wallets where user_id = d.id;
    if coalesce(v_bal, 0) < setting_num('driver_debt_limit', -500000)::bigint then   -- 0099: batas dari app_settings
      raise exception 'Saldo minus melebihi batas (Rp%). Top up saldo dulu.', replace(to_char(abs(setting_num('driver_debt_limit', -500000)), 'FM999,999,999,999'), ',', '.');
    end if;
    if p_lat is null and d.location is null then raise exception 'Lokasi belum tersedia, aktifkan GPS'; end if;
    if v_hours > 0 and (d.last_selfie_at is null or d.last_selfie_at < now() - (v_hours || ' hours')::interval) then
      raise exception 'SELFIE_REQUIRED';
    end if;
  end if;
  perform set_config('antaraja.bypass', 'on', true);
  update drivers set is_online = p_online, last_seen_at = now(),
    location = case when p_lat is not null then st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography else location end
  where id = d.id returning * into d;
  perform set_config('antaraja.bypass', 'off', true);
  return d;
end $function$
;

CREATE OR REPLACE FUNCTION public.ledger_calc(o orders)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  se service_economics; pr pricing; ses pricing_sessions;
  F bigint := coalesce(o.fare_delivery, 0); PF bigint := coalesce(o.platform_fee, 0); S bigint := coalesce(o.items_subtotal, 0);
  SF bigint := coalesce(o.service_fee, 0); dshare bigint := coalesce(o.driver_service_share, 0); IC bigint := coalesce(o.intercity_fare, 0);
  D bigint := coalesce(o.discount, 0); T bigint := coalesce(o.tip, 0); X bigint := coalesce(o.extras_total, 0); tot bigint := coalesce(o.total, 0);
  dc numeric; mf numeric; C bigint; B bigint := 0; M bigint := 0; Dm bigint := 0; Ds bigint := 0; Dp bigint;
  funded text; has_driver boolean; vendor bigint := 0; merch bigint := 0; partner bigint := 0; ic_platform bigint; f_platform bigint := 0;
  sf_platform bigint; drv bigint := 0; R bigint; pgf bigint := coalesce(o.pg_fee, 0); pgp bigint := coalesce(o.pg_fee_ppn, 0);
  borne text := coalesce(o.pg_fee_borne_by, 'platform'); pg_cust bigint; gross bigint; recv bigint := 0; comp bigint;
  owner uuid; sess_note text := null; e jsonb := '[]'::jsonb; is_cash boolean := (o.payment_method = 'cash');
begin
  select * into se from service_economics where service = o.service;
  select * into pr from pricing where service = o.service;
  dc := coalesce(o.driver_commission_pct_snap, se.driver_commission_pct, pr.commission_pct, 0);
  mf := coalesce(o.merchant_fee_pct_snap, se.merchant_fee_pct, pr.merchant_commission_pct, 0);
  has_driver := (o.driver_id is not null) or (o.travel_partner_id is null);   -- sebelum diterima: dianggap akan ada driver
  C := floor(F * dc / 100.0)::bigint;
  if o.created_at is not null then
    ses := current_pricing_session(o.service, o.created_at);
    if ses.id is not null and coalesce(ses.driver_bonus_pct, 0) > 0 then
      B := least(C, floor(F * ses.driver_bonus_pct / 100.0)::bigint);
      sess_note := 'Bonus sesi ' || ses.name || ' ' || ses.driver_bonus_pct || '%';
    end if;
  end if;
  if o.merchant_id is not null then
    M := floor(S * mf / 100.0)::bigint;
    select owner_id into owner from merchants where id = o.merchant_id;
  end if;
  funded := coalesce(o.promo_funded_by, 'platform');
  if funded = 'merchant' and o.merchant_id is null then funded := 'platform'; end if;
  if funded = 'merchant' then Dm := least(D, greatest(0, S - M)); elsif funded = 'sponsor' then Ds := D; end if;
  Dp := D - Dm - Ds;
  if o.service in ('shop', 'market') then vendor := S; end if;
  if o.merchant_id is not null then merch := S - M - Dm; end if;
  if o.travel_partner_id is not null then partner := round(IC * setting_num('travel_send_partner_pct', 80) / 100.0)::bigint; end if;
  ic_platform := IC - partner;
  if has_driver then
    drv := (F - C + B) + T + X + dshare; sf_platform := SF - dshare;
  else
    f_platform := F; sf_platform := SF; C := 0; B := 0;   -- tanpa driver (titipan via mitra travel): ongkir & jasa ke platform
  end if;
  pg_cust := case when borne = 'customer' then pgf + pgp else 0 end;
  R := PF + (C - B) + M + sf_platform + ic_platform + f_platform - Dp;
  gross := tot + T;
  comp := S + F + PF + SF + IC + T + X - D + pg_cust;
  if is_cash then
    if has_driver then recv := tot - vendor - merch - (drv - T);
    elsif o.travel_partner_id is not null then recv := tot - partner; end if;
  end if;

  -- baris buku besar (hanya yang tidak nol; gross_customer selalu ditulis)
  e := e || jsonb_build_object('entry', 'gross_customer', 'amount', gross, 'party_role', 'customer', 'party_id', o.customer_id, 'note', 'total ' || tot || ' + tip ' || T);
  if S <> 0 then e := e || jsonb_build_object('entry', 'items_subtotal', 'amount', S, 'party_role', 'customer', 'party_id', o.customer_id); end if;
  if F <> 0 then e := e || jsonb_build_object('entry', 'delivery_fee', 'amount', F, 'party_role', 'customer', 'party_id', o.customer_id); end if;
  if PF <> 0 then e := e || jsonb_build_object('entry', 'customer_platform_fee', 'amount', PF, 'party_role', 'customer', 'party_id', o.customer_id); end if;
  if SF <> 0 then e := e || jsonb_build_object('entry', 'service_fee', 'amount', SF, 'party_role', 'customer', 'party_id', o.customer_id); end if;
  if IC <> 0 then e := e || jsonb_build_object('entry', 'intercity_fare', 'amount', IC, 'party_role', 'customer', 'party_id', o.customer_id); end if;
  if T <> 0 then e := e || jsonb_build_object('entry', 'tip', 'amount', T, 'party_role', 'customer', 'party_id', o.customer_id); end if;
  if X <> 0 then e := e || jsonb_build_object('entry', 'extras', 'amount', X, 'party_role', 'customer', 'party_id', o.customer_id); end if;
  if Dp <> 0 then e := e || jsonb_build_object('entry', 'promo_platform', 'amount', -Dp, 'party_role', 'platform', 'funded_by', 'platform', 'note', o.promo_code); end if;
  if Dm <> 0 then e := e || jsonb_build_object('entry', 'promo_merchant', 'amount', -Dm, 'party_role', 'merchant', 'party_id', owner, 'funded_by', 'merchant', 'note', o.promo_code); end if;
  if Ds <> 0 then e := e || jsonb_build_object('entry', 'promo_sponsor', 'amount', -Ds, 'party_role', 'sponsor', 'funded_by', 'sponsor', 'note', o.promo_code); end if;
  if C <> 0 then e := e || jsonb_build_object('entry', 'driver_commission', 'amount', C, 'party_role', 'platform', 'note', 'komisi ' || dc || '% dari ongkir ' || F); end if;
  if B <> 0 then e := e || jsonb_build_object('entry', 'adjustment', 'amount', -B, 'party_role', 'driver', 'party_id', o.driver_id, 'note', sess_note); end if;
  if M <> 0 then e := e || jsonb_build_object('entry', 'merchant_fee', 'amount', M, 'party_role', 'platform', 'note', 'fee merchant ' || mf || '% dari ' || S); end if;
  if drv <> 0 then e := e || jsonb_build_object('entry', 'driver_payable', 'amount', -drv, 'party_role', 'driver', 'party_id', o.driver_id,
      'note', 'ongkir bersih ' || (F - C + B) || ' + tip ' || T || ' + extras ' || X || ' + jasa belanja ' || dshare || case when is_cash then ' (tunai: dipegang driver)' else '' end); end if;
  if merch <> 0 then e := e || jsonb_build_object('entry', 'merchant_payable', 'amount', -merch, 'party_role', 'merchant', 'party_id', owner,
      'note', 'nilai pesanan ' || S || ' − fee ' || M || ' − promo merchant ' || Dm || case when is_cash then ' (tunai: dibayar driver ke merchant)' else '' end); end if;
  if vendor <> 0 then e := e || jsonb_build_object('entry', 'vendor_payable', 'amount', -vendor, 'party_role', 'vendor', 'party_id', o.driver_id,
      'note', 'penggantian belanja yang ditalangi driver di toko/pasar'); end if;
  if partner <> 0 then e := e || jsonb_build_object('entry', 'partner_payable', 'amount', -partner, 'party_role', 'partner', 'party_id', o.travel_partner_id,
      'note', 'porsi mitra travel ' || setting_num('travel_send_partner_pct', 80) || '% dari ongkir antar kota'); end if;
  e := e || jsonb_build_object('entry', 'platform_revenue', 'amount', R, 'party_role', 'platform',
      'note', 'biaya platform ' || PF || ' + komisi ' || (C - B) || ' + fee merchant ' || M || ' + jasa belanja platform ' || sf_platform || ' + antar kota ' || ic_platform || ' + ongkir tanpa driver ' || f_platform || ' − promo platform ' || Dp);
  if pgf <> 0 then e := e || jsonb_build_object('entry', 'pg_fee', 'amount', -pgf, 'party_role', 'gateway', 'funded_by', borne, 'note', 'ditanggung ' || case when borne = 'customer' then 'pelanggan' else 'platform' end); end if;
  if pgp <> 0 then e := e || jsonb_build_object('entry', 'pg_fee_ppn', 'amount', -pgp, 'party_role', 'gateway', 'funded_by', borne, 'note', 'PPN biaya gateway'); end if;
  if is_cash and recv <> 0 then e := e || jsonb_build_object('entry', 'driver_receivable', 'amount', recv,
      'party_role', case when has_driver then 'driver' else 'partner' end, 'party_id', coalesce(o.driver_id, o.travel_partner_id),
      'note', case when recv > 0 then 'setoran ke platform dari uang tunai yang dipegang' else 'platform mengembalikan selisih tunai' end); end if;

  return jsonb_build_object(
    'gross_customer', gross, 'components_total', comp, 'total', tot,
    'delivery_fee', F, 'customer_platform_fee', PF, 'items_subtotal', S, 'service_fee', SF, 'driver_service_share', dshare,
    'intercity_fare', IC, 'tip', T, 'extras', X, 'discount', D,
    'driver_commission_pct', dc, 'driver_commission', C, 'bonus', B, 'merchant_fee_pct', mf, 'merchant_fee', M,
    'promo_funded_by', funded, 'promo_platform', Dp, 'promo_merchant', Dm, 'promo_sponsor', Ds,
    'driver_payable', drv, 'merchant_payable', merch, 'vendor_payable', vendor, 'partner_payable', partner,
    'platform_revenue', R, 'pg_fee', pgf, 'pg_fee_ppn', pgp, 'pg_fee_borne_by', borne, 'pg_channel', o.pg_channel,
    'contribution', R - case when borne = 'platform' then pgf + pgp else 0 end,
    'driver_receivable', recv, 'payment_method', o.payment_method, 'has_driver', has_driver,
    'balanced', (gross + Ds = drv + merch + vendor + partner + R + pg_cust) and (gross = comp),
    'diff', gross + Ds - (drv + merch + vendor + partner + R + pg_cust),
    'diff_components', gross - comp,
    'entries', e);
end $function$
;

CREATE OR REPLACE FUNCTION public.ledger_check(p_order uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_phase text; o orders; agg record; rf record; v_bal boolean; v_diff bigint; v_diffc bigint; v_paid bigint; v_alloc bigint; v_comp bigint;
  v_has_ref boolean := false; v_ref_ok boolean := true; v_ref_diff bigint := 0; v_res jsonb; v_disp record;
begin
  -- pemanggil latar (cron/service_role, auth.uid() NULL; fungsi ini tidak diberikan ke anon) atau admin atau pihak order
  if auth.uid() is not null and not is_admin() and not exists (select 1 from orders x where x.id = p_order and (x.customer_id = auth.uid() or x.driver_id = auth.uid() or x.travel_partner_id = auth.uid() or (x.merchant_id is not null and owns_merchant(x.merchant_id)))) then
    raise exception 'Tidak berhak';
  end if;
  select * into o from orders where id = p_order;
  if not found then return jsonb_build_object('order_id', p_order, 'verdict', 'not_found', 'balanced', null); end if;
  select phase into v_phase from order_ledger where order_id = p_order and source = 'orders'
   order by case phase when 'completed' then 0 when 'refunded' then 1 when 'cancelled' then 2 when 'adjusted' then 3 when 'created' then 4 else 5 end limit 1;
  if v_phase is null then return jsonb_build_object('order_id', p_order, 'code', o.code, 'verdict', 'no_ledger', 'balanced', null, 'ledger_version', o.ledger_version); end if;

  select
    coalesce(sum(amount) filter (where entry = 'gross_customer'), 0) as gross,
    coalesce(sum(amount) filter (where entry = 'items_subtotal'), 0) as items,
    coalesce(sum(amount) filter (where entry = 'delivery_fee'), 0) as fare,
    coalesce(sum(amount) filter (where entry = 'customer_platform_fee'), 0) as pf,
    coalesce(sum(amount) filter (where entry = 'service_fee'), 0) as sf,
    coalesce(sum(amount) filter (where entry = 'intercity_fare'), 0) as ic,
    coalesce(sum(amount) filter (where entry = 'tip'), 0) as tip,
    coalesce(sum(amount) filter (where entry = 'extras'), 0) as extras,
    coalesce(-sum(amount) filter (where entry = 'promo_platform'), 0) as promo_p,
    coalesce(-sum(amount) filter (where entry = 'promo_merchant'), 0) as promo_m,
    coalesce(-sum(amount) filter (where entry = 'promo_sponsor'), 0) as promo_s,
    coalesce(sum(amount) filter (where entry = 'driver_commission'), 0) as comm,
    coalesce(-sum(amount) filter (where entry = 'adjustment' and party_role = 'driver'), 0) as bonus,
    coalesce(sum(amount) filter (where entry = 'merchant_fee'), 0) as mfee,
    coalesce(-sum(amount) filter (where entry = 'driver_payable'), 0) as drv,
    coalesce(-sum(amount) filter (where entry = 'merchant_payable'), 0) as merch,
    coalesce(-sum(amount) filter (where entry = 'vendor_payable'), 0) as vendor,
    coalesce(-sum(amount) filter (where entry = 'partner_payable'), 0) as partner,
    coalesce(sum(amount) filter (where entry = 'platform_revenue'), 0) as rev,
    coalesce(-sum(amount) filter (where entry = 'tax_output'), 0) as tax,
    coalesce(-sum(amount) filter (where entry = 'pg_fee' and funded_by = 'customer'), 0) + coalesce(-sum(amount) filter (where entry = 'pg_fee_ppn' and funded_by = 'customer'), 0) as pg_cust,
    coalesce(-sum(amount) filter (where entry = 'pg_fee' and coalesce(funded_by, 'platform') = 'platform'), 0) + coalesce(-sum(amount) filter (where entry = 'pg_fee_ppn' and coalesce(funded_by, 'platform') = 'platform'), 0) as pg_plat,
    coalesce(sum(amount) filter (where entry = 'driver_receivable'), 0) as recv,
    coalesce(-sum(amount) filter (where entry = 'refund'), 0) as refund,
    count(*) as rows_n
  into agg from order_ledger where order_id = p_order and source = 'orders' and phase = v_phase;

  select exists (select 1 from order_ledger where order_id = p_order and source = 'orders' and phase = 'refunded') into v_has_ref;
  if v_phase = 'completed' and v_has_ref then
    -- 0106: refund sesudah selesai (sengketa/komplain) — refund = Σ pembalikan pro-rata (payable ↑, platform_revenue ↓)
    select coalesce(-sum(amount) filter (where entry = 'refund'), 0) as refund,
           coalesce(sum(amount) filter (where entry = 'driver_payable'), 0) as drv,
           coalesce(sum(amount) filter (where entry = 'merchant_payable'), 0) as merch,
           coalesce(sum(amount) filter (where entry = 'vendor_payable'), 0) as vendor,
           coalesce(sum(amount) filter (where entry = 'partner_payable'), 0) as partner,
           coalesce(-sum(amount) filter (where entry = 'platform_revenue'), 0) as rev
      into rf from order_ledger where order_id = p_order and source = 'orders' and phase = 'refunded';
    v_ref_diff := rf.refund - (rf.drv + rf.merch + rf.vendor + rf.partner + rf.rev);
    v_ref_ok := v_ref_diff = 0;
  end if;
  select count(*) filter (where status in ('open', 'investigating')) as open_n, count(*) as n into v_disp
    from disputes_count_for(p_order);

  if v_phase in ('created', 'adjusted', 'completed') then
    v_alloc := agg.drv + agg.merch + agg.vendor + agg.partner + agg.rev + agg.pg_cust + agg.tax;
    v_diff := agg.gross + agg.promo_s - v_alloc;
    v_comp := agg.items + agg.fare + agg.pf + agg.sf + agg.ic + agg.tip + agg.extras - agg.promo_p - agg.promo_m - agg.promo_s + agg.pg_cust;
    v_diffc := agg.gross - v_comp;
    v_bal := (v_diff = 0 and v_diffc = 0 and agg.gross = o.total + o.tip) and v_ref_ok;
    v_res := jsonb_build_object('order_id', p_order, 'code', o.code, 'service', o.service, 'phase', v_phase, 'status', o.status,
      'verdict', case when v_bal then 'balanced' else 'unbalanced' end, 'balanced', v_bal, 'diff', v_diff, 'diff_components', v_diffc,
      'gross_customer', agg.gross, 'allocated', v_alloc, 'components_total', v_comp,
      'formula', 'gross_customer + promo_sponsor = driver_payable + merchant_payable + vendor_payable + partner_payable + platform_revenue + pg_fee(pelanggan) + tax_output',
      'driver_payable', agg.drv, 'merchant_payable', agg.merch, 'vendor_payable', agg.vendor, 'partner_payable', agg.partner,
      'platform_revenue', agg.rev, 'pg_fee_platform', agg.pg_plat, 'pg_fee_customer', agg.pg_cust, 'tax_output', agg.tax, 'contribution', agg.rev - agg.pg_plat,
      'driver_commission', agg.comm, 'bonus', agg.bonus, 'merchant_fee', agg.mfee,
      'promo_platform', agg.promo_p, 'promo_merchant', agg.promo_m, 'promo_sponsor', agg.promo_s,
      'driver_receivable', agg.recv, 'rows', agg.rows_n);
    if v_has_ref and v_phase = 'completed' then
      v_res := v_res || jsonb_build_object('refund', rf.refund, 'refund_check', jsonb_build_object('ok', v_ref_ok, 'diff', v_ref_diff,
        'formula', 'refund = Δdriver_payable + Δmerchant_payable + Δvendor_payable + Δpartner_payable + Δplatform_revenue (fase refunded)',
        'driver_payable_reversed', rf.drv, 'merchant_payable_reversed', rf.merch, 'platform_revenue_reversed', rf.rev));
    end if;
  else
    -- cancelled/refunded: dikembalikan + penggantian + bagian yang tertahan (merchant/driver/platform) = yang dibayar bila direfund
    v_paid := case when o.payment_status = 'refunded' then o.total else 0 end;
    v_alloc := agg.refund + agg.vendor + agg.rev + agg.merch + agg.drv + agg.partner;
    v_bal := case when o.payment_status = 'refunded' then v_alloc >= v_paid else true end;
    v_res := jsonb_build_object('order_id', p_order, 'code', o.code, 'service', o.service, 'phase', v_phase, 'status', o.status,
      'verdict', case when v_bal then 'refund_ok' else 'refund_short' end, 'balanced', v_bal,
      'diff', v_alloc - v_paid, 'refund', agg.refund, 'reimburse', agg.vendor, 'penalty', agg.rev, 'retained_merchant', agg.merch,
      'retained_driver', agg.drv, 'paid', v_paid, 'rows', agg.rows_n);
  end if;
  return v_res || jsonb_build_object('disputes_open', coalesce(v_disp.open_n, 0));
end $function$
;

CREATE OR REPLACE FUNCTION public.order_payment_prepare(p_order uuid, p_channel text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare o orders; v_ch text; v_base bigint; v_fee bigint := 0; v_ppn bigint := 0; v_borne text; v_total bigint;
  v_timeout int := greatest(1, setting_num('order_payment_timeout_min', 15)::int); v_prov text := payment_provider_active();
begin
  if auth.uid() is null then raise exception 'Harus login'; end if;
  if not rate_take('payment_prepare', greatest(1, setting_num('rate_limit_payment_prepare_per_hour', 30)::int)) then   -- 0107 rate_take
    raise exception 'RATE_LIMIT: terlalu banyak permintaan pembayaran dalam 1 jam. Coba lagi nanti.';
  end if;
  select * into o from orders where id = p_order for update;
  if not found or o.customer_id <> auth.uid() then raise exception 'Pesanan tidak ditemukan'; end if;
  if o.status::text <> 'awaiting_payment' or o.payment_status <> 'unpaid' then
    raise exception 'Pesanan % tidak menunggu pembayaran (status %, bayar %)', o.code, o.status, o.payment_status;
  end if;
  if o.created_at < now() - make_interval(mins => v_timeout) then raise exception 'Batas waktu pembayaran pesanan % sudah lewat', o.code; end if;
  v_ch := coalesce(nullif(lower(trim(coalesce(p_channel, ''))), ''), o.pg_channel);
  if not (v_ch = any (payment_gateway_channel_keys())) then raise exception 'Saluran % bukan payment gateway', payment_channel_label(v_ch); end if;
  perform payment_channel_require_order(v_ch);   -- 0104
  if not payment_channel_provider_ok(v_ch, v_prov) then   -- (a) kanal tidak didukung provider aktif (mis. GoPay di Finpay)
    raise exception 'CHANNEL_UNSUPPORTED: saluran % tidak tersedia di % — pilih metode lain', payment_channel_label(v_ch), payment_provider_label(v_prov);
  end if;
  -- dasar = total tanpa biaya pembayaran yang (mungkin) sudah ditagihkan; biaya dihitung ulang untuk saluran & provider final
  v_base := o.total - case when o.pg_fee_borne_by = 'customer' then o.pg_fee + o.pg_fee_ppn else 0 end;
  select f.fee, f.ppn into v_fee, v_ppn from pg_fee_calc(v_ch, v_base, v_prov) f;
  v_fee := coalesce(v_fee, 0); v_ppn := coalesce(v_ppn, 0);
  v_borne := case when v_fee + v_ppn > 0 then pg_fee_borne_by_for(o.service, v_ch, v_prov) else null end;   -- 0105 §0.5
  v_total := v_base + case when v_borne = 'customer' then v_fee + v_ppn else 0 end;
  if v_total is distinct from o.total or v_ch is distinct from o.pg_channel or v_fee is distinct from o.pg_fee
     or v_ppn is distinct from o.pg_fee_ppn or v_borne is distinct from o.pg_fee_borne_by then
    update orders set total = v_total, paid_via = v_ch, pg_channel = v_ch, pg_fee = v_fee, pg_fee_ppn = v_ppn, pg_fee_borne_by = v_borne
    where id = o.id returning * into o;
    perform ledger_post(o.id, 'created');
  end if;
  if o.payment_support_ref is null then
    update orders set payment_support_ref = gen_support_ref() where id = o.id returning * into o;
  end if;
  return jsonb_build_object('order_id', o.id, 'code', o.code, 'service', o.service, 'channel', v_ch, 'channel_label', payment_channel_label(v_ch),
    'provider', v_prov, 'provider_label', payment_provider_label(v_prov), 'env', payment_provider_env(),
    'gross', o.total, 'pg_fee', o.pg_fee, 'pg_fee_ppn', o.pg_fee_ppn, 'pg_fee_borne_by', o.pg_fee_borne_by,
    'customer_payment_fee', case when o.pg_fee_borne_by = 'customer' then o.pg_fee + o.pg_fee_ppn else 0 end,
    'pg_fee_customer', case when o.pg_fee_borne_by = 'customer' then o.pg_fee + o.pg_fee_ppn else 0 end,
    'pg_fee_label', 'Biaya metode pembayaran (' || payment_provider_label(v_prov) || ')',
    'support_ref', o.payment_support_ref,
    'expires_at', o.created_at + make_interval(mins => v_timeout), 'timeout_min', v_timeout);
end $function$
;

CREATE OR REPLACE FUNCTION public.payment_channel_enabled(p_key text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v jsonb; k text := lower(trim(coalesce(p_key, ''))); t text;
begin
  if k = '' then return false; end if;
  select case when jsonb_typeof(value) = 'object' then value else '{}'::jsonb end into v
    from app_settings where key = 'payment_channels';
  t := lower(coalesce(v ->> k, ''));
  if k = 'cash' then
    return t <> 'false';                                 -- tunai/COD: default AKTIF bila belum diatur
  end if;
  if not antarpay_enabled() then return false; end if;   -- 0088 induk: global mati → semua non-tunai mati
  return t = 'true';                                     -- saluran lain: default NONAKTIF
end $function$
;

CREATE OR REPLACE FUNCTION public.payment_channel_require(p_paid_via text)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_ch text := payment_channel_of(p_paid_via);
begin
  -- 1) Sakelar global 0088 sebagai induk semua saluran non-tunai.
  if v_ch <> 'cash' and not antarpay_enabled() then
    raise exception 'AntarVoucher sedang dinonaktifkan sementara. Gunakan pembayaran tunai.';
  end if;

  -- 2) FAKTA RAIL: di create_order/travel_book, SETIAP paid_via selain 'cash'
  --    disetel v_pay = 'wallet' — artinya dana ditarik dari saldo AntarVoucher,
  --    termasuk untuk GoPay/QRIS/VA/e-money. Maka saluran 'antarpay' adalah
  --    induk teknis semua saluran non-tunai: kalau saldo dimatikan, tidak ada
  --    rail untuk menyelesaikan pembayarannya.
  if v_ch <> 'cash' and not payment_channel_enabled('antarpay') then
    raise exception 'Saluran AntarVoucher (saldo) sedang dinonaktifkan. Semua pembayaran non-tunai diselesaikan lewat saldo AntarVoucher, jadi sementara ini gunakan pembayaran tunai.';
  end if;

  -- 3) Saluran yang dipilih itu sendiri.
  if payment_channel_enabled(v_ch) then return; end if;
  raise exception 'Metode pembayaran % sedang dinonaktifkan. Pilih metode lain.', payment_channel_label(v_ch);
end $function$
;

CREATE OR REPLACE FUNCTION public.payment_channel_require_order(p_paid_via text)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_ch text := payment_channel_of(p_paid_via);
begin
  if v_ch = any (payment_gateway_channel_keys()) and gateway_order_payment_enabled() then
    if payment_channel_order_enabled(v_ch) then return; end if;
    raise exception 'Metode pembayaran % sedang dinonaktifkan. Pilih metode lain.', payment_channel_label(v_ch);
  end if;
  perform payment_channel_require(p_paid_via);
end $function$
;

CREATE OR REPLACE FUNCTION public.request_topup(p_amount bigint, p_method text DEFAULT 'bank_transfer'::text, p_proof_url text DEFAULT NULL::text, p_note text DEFAULT NULL::text)
 RETURNS topup_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare t topup_requests%rowtype;
begin
  perform antarpay_require_enabled();
  perform payment_channel_require(coalesce(nullif(p_method, ''), 'bank_transfer'));   -- 0089: saluran top up
   -- 0088: sakelar AntarVoucher
  if auth.uid() is null then raise exception 'Harus login'; end if;
  if (select count(*) from topup_requests where user_id = auth.uid() and status = 'pending') >= 3 then
    raise exception 'Masih ada permintaan top up yang menunggu verifikasi';
  end if;
  insert into topup_requests (user_id, amount, method, proof_url, sender_note) values (auth.uid(), p_amount, p_method, p_proof_url, p_note) returning * into t;
  return t;
end $function$
;

CREATE OR REPLACE FUNCTION public.request_withdrawal(p_amount bigint, p_bank text, p_account text, p_name text)
 RETURNS withdrawal_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare w withdrawal_requests%rowtype; v_bal bigint; v_auto boolean; v_max bigint := setting_num('auto_payout_max', 500000)::bigint; v_daily bigint := setting_num('auto_payout_daily_max', 1000000)::bigint; v_today bigint; ba bank_accounts;
begin
  perform antarpay_require_enabled();   -- 0088: sakelar AntarVoucher
  perform withdrawal_require_allowed();  -- 0090: penarikan hanya untuk mitra
  if not rate_take('withdrawal', greatest(1, setting_num('rate_limit_withdrawal_per_hour', 30)::int)) then   -- 0107 rate_take
    raise exception 'RATE_LIMIT: terlalu banyak permintaan penarikan dalam 1 jam. Coba lagi nanti.';
  end if;

  if p_amount < 10000 then raise exception 'Minimal penarikan Rp10.000'; end if;
  select balance into v_bal from wallets where user_id = auth.uid() for update;
  if coalesce(v_bal,0) < p_amount then raise exception 'Saldo tidak cukup'; end if;
  perform wallet_apply(auth.uid(), 'withdrawal', -p_amount, null, 'Penarikan saldo (menunggu proses)');
  insert into withdrawal_requests (user_id, amount, bank_name, bank_account, account_name) values (auth.uid(), p_amount, p_bank, p_account, p_name) returning * into w;
  -- rekening tersimpan; verified hanya bila sama dengan rekening yang sudah pernah disetujui admin
  insert into bank_accounts (user_id, bank_name, account_no, holder) values (auth.uid(), p_bank, p_account, p_name)
  on conflict (user_id) do update set verified = case when bank_accounts.account_no = excluded.account_no and bank_accounts.bank_name = excluded.bank_name then bank_accounts.verified else false end,
    bank_name = excluded.bank_name, account_no = excluded.account_no, holder = excluded.holder, updated_at = now();
  select * into ba from bank_accounts where user_id = auth.uid();
  select coalesce(sum(amount), 0) into v_today from withdrawal_requests where user_id = auth.uid() and auto and created_at >= date_trunc('day', now()) and id <> w.id;
  v_auto := coalesce((select value::text::boolean from app_settings where key = 'auto_payout_enabled'), true)
    and ba.verified and p_amount <= v_max and v_today + p_amount <= v_daily
    and not exists (select 1 from fraud_flags where subject_id = auth.uid() and status = 'open' and severity in ('med','high'))
    and not exists (select 1 from drivers where id = auth.uid() and status <> 'approved');
  if v_auto then
    update withdrawal_requests set status = 'approved', auto = true, reviewed_at = now(), review_note = 'Disetujui otomatis (rekening terverifikasi, ≤ batas harian)' where id = w.id returning * into w;
    insert into notifications (user_id, kind, title, body, data) values (auth.uid(), 'system', 'Penarikan disetujui otomatis', 'Rp' || p_amount || ' ke ' || p_bank || ' ' || p_account || ' sedang diproses ke rekening Anda.', jsonb_build_object('withdrawal_id', w.id));
    insert into security_events (kind, user_id, detail) values ('payout.auto', auth.uid(), jsonb_build_object('withdrawal_id', w.id, 'amount', p_amount));
    perform log_activity('withdrawal.auto', 'withdrawal_requests', w.id::text, '[otomatis] Penarikan Rp' || p_amount || ' disetujui', jsonb_build_object('amount', p_amount));
  end if;
  return w;
end $function$
;

CREATE OR REPLACE FUNCTION public.setting_json_validate(p_key text, v jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
declare k text; x jsonb; n numeric; e text;
begin
  if p_key = 'bank_account' then
    if jsonb_typeof(v) <> 'object' then raise exception 'bank_account harus objek {bank, name, number}'; end if;
    for k, x in select * from jsonb_each(v) loop
      if k not in ('bank', 'name', 'number', 'branch', 'note') then raise exception 'bank_account: kolom tidak dikenal %', k; end if;
      if jsonb_typeof(x) <> 'string' or length(x #>> '{}') > 100 then raise exception 'bank_account.% harus teks ≤ 100 karakter', k; end if;
    end loop;
    if coalesce(btrim(v->>'bank'), '') = '' or coalesce(btrim(v->>'name'), '') = '' or coalesce(v->>'number', '') !~ '^[0-9][0-9 .-]{4,29}$' then
      raise exception 'bank_account wajib berisi bank, name, dan number (angka 5–30 digit)';
    end if;
    return v;
  elsif p_key = 'pickup_radius_km' then
    if jsonb_typeof(v) <> 'object' then raise exception 'pickup_radius_km harus objek {layanan: km}'; end if;
    for k, x in select * from jsonb_each(v) loop
      if k !~ '^[a-z_]{2,30}$' or jsonb_typeof(x) <> 'number' then raise exception 'pickup_radius_km.% harus angka', k; end if;
      n := (x #>> '{}')::numeric; if n < 0.1 or n > 500 then raise exception 'pickup_radius_km.% harus 0,1–500 km', k; end if;
    end loop;
    return v;
  elsif p_key = 'priority_tiers' then
    if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) not between 1 and 10 then raise exception 'priority_tiers harus larik 1–10 tingkat'; end if;
    for x in select * from jsonb_array_elements(v) loop
      if jsonb_typeof(x) <> 'object' or (select count(*) from jsonb_object_keys(x) kk where kk not in ('min_rating', 'delay_s')) > 0
         or jsonb_typeof(x->'min_rating') <> 'number' or jsonb_typeof(x->'delay_s') <> 'number'
         or (x->>'min_rating')::numeric not between 0 and 5 or (x->>'delay_s')::numeric not between 0 and 3600 then
        raise exception 'priority_tiers: tiap tingkat {min_rating 0–5, delay_s 0–3600}';
      end if;
    end loop;
    return v;
  elsif p_key = 'send_limits' then
    if jsonb_typeof(v) <> 'object' then raise exception 'send_limits harus objek {kendaraan: {max_kg, max_cm}}'; end if;
    for k, x in select * from jsonb_each(v) loop
      if k !~ '^[a-z_]{2,30}$' or jsonb_typeof(x) <> 'object' or (select count(*) from jsonb_object_keys(x) kk where kk not in ('max_kg', 'max_cm')) > 0
         or jsonb_typeof(x->'max_kg') <> 'number' or jsonb_typeof(x->'max_cm') <> 'number'
         or (x->>'max_kg')::numeric not between 0 and 100000 or (x->>'max_cm')::numeric not between 0 and 10000 then
        raise exception 'send_limits.% harus {max_kg 0–100000, max_cm 0–10000}', k;
      end if;
    end loop;
    return v;
  elsif p_key in ('pin_services', 'same_city_services') then
    if jsonb_typeof(v) <> 'array' then raise exception '% harus larik kode layanan', p_key; end if;
    for x in select * from jsonb_array_elements(v) loop
      e := x #>> '{}';
      if jsonb_typeof(x) <> 'string' or not (e = any (enum_range(null::service_type)::text[])) then raise exception '%: layanan tidak dikenal %', p_key, coalesce(e, x::text); end if;
    end loop;
    return v;
  end if;
  raise exception 'Kunci JSON % tidak punya validator', p_key;
end $function$
;

CREATE OR REPLACE FUNCTION public.travel_accept_send(p_order uuid)
 RETURNS orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare tp travel_partners%rowtype; o orders%rowtype; v_lim jsonb := send_limit('travel');
begin
  select * into tp from travel_partners where id = auth.uid();
  if not found or tp.status <> 'approved' then raise exception 'Hanya mitra travel aktif'; end if;
  select * into o from orders where id = p_order for update;
  if not found then raise exception 'Titipan tidak ditemukan'; end if;
  if order_payment_pending(o) then   -- 0104 belum lunas
    raise exception 'Titipan ini belum dibayar pengirim (menunggu pembayaran). Titipan baru bisa diambil setelah pembayaran masuk.';
  end if;
  if o.status <> 'searching' or coalesce(o.package_details->>'via','') <> 'travel' then raise exception 'Titipan ini sudah diambil mitra lain'; end if;
  if coalesce(o.weight_kg,0) > (v_lim->>'max_kg')::numeric or coalesce(nullif(o.package_details->>'size_cm','')::numeric,0) > (v_lim->>'max_cm')::numeric then
    raise exception 'Ukuran/berat titipan melebihi batas mitra travel (maks % kg, sisi terpanjang % cm)', v_lim->>'max_kg', v_lim->>'max_cm';
  end if;
  update orders set travel_partner_id = tp.id, status = 'accepted', accepted_at = now(), updated_at = now() where id = p_order returning * into o;
  insert into order_events(order_id, status, note) values (p_order, 'accepted', 'Titipan diambil mitra travel ' || coalesce(tp.company_name, tp.driver_name, 'AntarTravel'));
  insert into notifications (user_id, kind, title, body, data) values (o.customer_id, 'order', 'Titipan Anda diambil mitra travel',
    'Paket ' || o.code || ' akan dibawa mitra AntarTravel. Pantau statusnya di aplikasi.', jsonb_build_object('order_id', o.id));
  return o;
end $function$
;

CREATE OR REPLACE FUNCTION public.travel_offer_create(p_request uuid, p_price bigint, p_breakdown jsonb DEFAULT NULL::jsonb, p_message text DEFAULT NULL::text)
 RETURNS travel_offers
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r travel_requests%rowtype; tp travel_partners%rowtype; o travel_offers%rowtype;
begin
  select * into tp from travel_partners where id = auth.uid() and status = 'approved';
  if not found then raise exception 'Bukan mitra travel aktif'; end if;
  if coalesce((select balance from wallets where user_id = tp.id), 0) < setting_num('driver_debt_limit', -500000)::bigint then   -- 0102 driver_debt_limit mitra travel
    raise exception 'Saldo minus melebihi batas (Rp%). Setor/top up dulu sebelum mengirim penawaran.', replace(to_char(abs(setting_num('driver_debt_limit', -500000)), 'FM999,999,999,999'), ',', '.');
  end if;
  select * into r from travel_requests where id = p_request for update;
  if not found or r.status not in ('open','offered') then raise exception 'Permintaan tidak tersedia'; end if;
  if r.partner_id is not null and r.partner_id <> tp.id then raise exception 'Permintaan ditujukan ke mitra lain'; end if;
  if p_price < 50000 or p_price > 50000000 then raise exception 'Harga penawaran tidak wajar'; end if;
  insert into travel_offers (request_id, partner_id, price, breakdown, message) values (r.id, tp.id, p_price, p_breakdown, p_message)
  on conflict (request_id, partner_id) do update set price = excluded.price, breakdown = excluded.breakdown, message = excluded.message, status = 'offered', created_at = now()
  returning * into o;
  update travel_requests set status = 'offered' where id = r.id and status = 'open';
  insert into notifications (user_id, kind, title, body, data) values (r.customer_id, 'order', 'Penawaran travel masuk',
    coalesce(tp.company_name, tp.driver_name, 'Mitra') || ' · ' || tp.vehicle_model || ' · Rp' || to_char(p_price, 'FM999G999G999'), jsonb_build_object('travel_request_id', r.id, 'offer_id', o.id));
  return o;
end $function$
;

CREATE OR REPLACE FUNCTION public.voucher_expire_due()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare n int;
begin
  update voucher_purchases set status = 'expired', updated_at = now(), reason = coalesce(reason, 'Batas waktu transfer lewat')
   where status in ('awaiting_transfer', 'submitted') and expires_at <= now();
  get diagnostics n = row_count;
  return n;
end $function$
;

CREATE OR REPLACE FUNCTION public.voucher_purchase_create(p_nominal bigint, p_bank_code text, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := auth.uid(); b company_bank_accounts; v public.voucher_purchases; v_code int; v_try int := 0; v_ref text;
begin
  if v_uid is null then raise exception 'Harus login'; end if;
  perform antarpay_require_enabled();
  if not coalesce((select (voucher_status_public()->>'purchase_enabled')::boolean), false) then
    raise exception 'VOUCHER_PURCHASE_DISABLED: pembelian AntarVoucher belum dibuka';
  end if;
  if p_nominal is null or p_nominal < voucher_setting_bigint('voucher_purchase_min', 20000) or p_nominal > voucher_setting_bigint('voucher_purchase_max', 2000000) then
    raise exception 'VOUCHER_NOMINAL_INVALID: nominal harus Rp% – Rp%', voucher_setting_bigint('voucher_purchase_min', 20000), voucher_setting_bigint('voucher_purchase_max', 2000000);
  end if;
  if p_nominal % 1000 <> 0 then raise exception 'VOUCHER_NOMINAL_INVALID: nominal harus kelipatan Rp1.000'; end if;
  if p_idempotency_key is not null then
    select * into v from voucher_purchases where user_id = v_uid and idempotency_key = p_idempotency_key;
    if found then return to_jsonb(v) || jsonb_build_object('idempotent', true); end if;
  end if;
  select * into b from company_bank_accounts where bank_code = lower(trim(p_bank_code)) and voucher_bank_account_public_ok(company_bank_accounts)
   order by display_order limit 1;
  if not found then raise exception 'VOUCHER_BANK_NOT_READY: rekening % belum tersedia', coalesce(p_bank_code, '-'); end if;
  if (select count(*) from voucher_purchases where user_id = v_uid and status in ('awaiting_transfer', 'submitted', 'matched', 'amount_mismatch'))
       >= voucher_setting_bigint('voucher_max_open_per_user', 2) then
    raise exception 'VOUCHER_TOO_MANY_OPEN: selesaikan atau batalkan pembelian yang masih berjalan';
  end if;
  loop
    v_try := v_try + 1;
    v_code := 1 + floor(random() * 999)::int;
    v_ref := 'AKV-' || to_char(now() at time zone 'Asia/Jakarta', 'YYMMDD') || '-' || upper(substr(md5(gen_random_uuid()::text), 1, 6));
    begin
      insert into voucher_purchases (reference, user_id, bank_account_id, nominal, unique_code, transfer_amount, expires_at, idempotency_key)
      values (v_ref, v_uid, b.id, p_nominal, v_code, p_nominal + v_code,
              now() + make_interval(hours => voucher_setting_bigint('voucher_purchase_ttl_hours', 24)::int), p_idempotency_key)
      returning * into v;
      exit;
    exception when unique_violation then
      if v_try >= 25 then raise exception 'VOUCHER_BUSY: coba lagi sebentar'; end if;
    end;
  end loop;
  perform log_activity('voucher.purchase_create', 'voucher_purchases', v.id::text, 'Pembelian AntarVoucher ' || v.reference, jsonb_build_object('nominal', v.nominal, 'transfer', v.transfer_amount));
  return to_jsonb(v) || jsonb_build_object('bank_name', b.bank_name, 'account_no', b.account_no, 'account_name', b.account_name, 'idempotent', false);
end $function$
;

CREATE OR REPLACE FUNCTION public.voucher_status_public()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'brand', 'AntarVoucher',
    'enabled', antarvoucher_enabled(),
    'purchase_enabled', antarvoucher_enabled() and coalesce((select lower(value #>> '{}') = 'true' from app_settings where key = 'antarvoucher_purchase_enabled'), false)
                        and exists (select 1 from company_bank_accounts b where voucher_bank_account_public_ok(b)),
    'banks_ready', (select count(*) from company_bank_accounts b where voucher_bank_account_public_ok(b)),
    'min', voucher_setting_bigint('voucher_purchase_min', 20000), 'max', voucher_setting_bigint('voucher_purchase_max', 2000000),
    'ttl_hours', voucher_setting_bigint('voucher_purchase_ttl_hours', 24));
$function$
;

CREATE OR REPLACE FUNCTION public.wallet_tx_before_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  new.balance_before := new.balance_after - new.amount;
  new.created_by := coalesce(new.created_by, auth.uid());
  new.source := coalesce(new.source, case new.type::text
    when 'topup' then 'topup' when 'payment' then 'order_payment' when 'earning' then 'earning' when 'refund' then 'refund_in'
    when 'withdrawal' then 'payout' when 'fee' then 'fee' else 'adjustment' end);
  -- saldo pelanggan (bukan mitra) tidak boleh minus oleh transaksi yang ia mulai sendiri, penyesuaian, atau penarikan
  if new.amount < 0 and new.balance_after < 0 and not wallet_is_partner(new.user_id)
     and (new.user_id = auth.uid() or new.type::text in ('adjustment', 'withdrawal')) then
    raise exception 'SALDO_TIDAK_CUKUP: saldo AntarVoucher tidak cukup (saldo %, dibutuhkan %)', new.balance_before, -new.amount;
  end if;
  if new.type::text = 'adjustment' and coalesce(new.correction_reason, '') = '' then
    new.correction_reason := coalesce(nullif(new.note, ''), 'Penyesuaian (tanpa alasan tertulis — data lama)');
  end if;
  return new;
end $function$
;

