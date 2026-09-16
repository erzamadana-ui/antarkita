-- =====================================================================
-- 0088 — SAKELAR AntarPay (dompet + payment gateway Midtrans) DARI PANEL ADMIN
--
-- Keputusan komisaris: AntarPay belum siap 100% → harus bisa DINONAKTIFKAN
-- dari Panel Admin. Default: NONAKTIF sampai pemilik menyalakannya sendiri.
--
-- Yang DIBLOKIR saat nonaktif (jalur BARU uang masuk/keluar):
--   • request_topup            (top up manual transfer bank)
--   • request_withdrawal       (pencairan saldo mitra)
--   • create_order             (paid_via = 'wallet' / kode e-wallet → hanya 'cash' diterima)
--   • travel_book              (idem)
--   • travel_request_create    (idem; perhatikan default payment_method di sana = 'wallet')
--   • edge function midtrans-create (Snap) — cek antarpay_enabled() via RPC, 403 bila nonaktif
--
-- Yang TETAP BERJALAN (sengaja): wallet_apply internal — refund order batal,
-- earning driver/merchant/mitra travel, potongan platform, penyelesaian webhook
-- Midtrans untuk transaksi yang sudah terlanjur dibuat, persetujuan admin atas
-- permintaan top up/penarikan yang sudah masuk, penyesuaian admin. Saldo yang
-- sudah ada tidak boleh macet.
--
-- Cara pasang penjaga:
--   • request_topup (0002) & request_withdrawal (0019) belum pernah ditambal lewat
--     pg_get_functiondef → definisi TERAKHIR disalin utuh ke sini + penjaga di awal.
--   • create_order / travel_book / travel_request_create SUDAH ditambal berlapis
--     (0021, 0030, 0080, 0083) → menyalin ulang berarti menghapus tambalan itu.
--     Dipakai pola pg_get_functiondef + sisip di jangkar (sama seperti 0080/0083).
--     Bila jangkar tidak ditemukan migrasi SENGAJA GAGAL.
-- Semua blok idempoten (aman dijalankan ulang).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Setelan + fungsi pembaca (default false bila baris tidak ada)
-- ---------------------------------------------------------------------
insert into app_settings (key, value) values ('antarpay_enabled', 'false'::jsonb)
on conflict (key) do nothing;

create or replace function public.antarpay_enabled()
returns boolean language sql stable security definer set search_path = public as $$
  -- menerima jsonb boolean (true/false) maupun string ("true"); selain itu = false
  select coalesce((select lower(value #>> '{}') = 'true' from app_settings where key = 'antarpay_enabled'), false);
$$;
grant execute on function public.antarpay_enabled() to anon, authenticated;
comment on function public.antarpay_enabled() is
  'Sakelar AntarPay (0088). false = top up, pencairan, dan bayar dengan dompet/e-wallet ditolak; hanya tunai.';

-- Pesan tunggal supaya aplikasi & simulasi bisa mencocokkan teksnya.
create or replace function public.antarpay_require_enabled()
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not antarpay_enabled() then
    raise exception 'AntarPay sedang dinonaktifkan sementara. Gunakan pembayaran tunai.';
  end if;
end $$;
grant execute on function public.antarpay_require_enabled() to anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. RPC admin: nyalakan / matikan (wajib admin + panel terbuka kunci PIN)
-- ---------------------------------------------------------------------
create or replace function public.admin_set_antarpay_enabled(p_enabled boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Hanya admin'; end if;
  perform admin_require_unlock();
  if p_enabled is null then raise exception 'Nilai sakelar wajib diisi'; end if;
  insert into app_settings (key, value) values ('antarpay_enabled', to_jsonb(p_enabled))
  on conflict (key) do update set value = excluded.value, updated_at = now();
  if to_regprocedure('public.log_activity(text,text,text,text,jsonb)') is not null then
    perform log_activity('antarpay.toggle', 'app_settings', 'antarpay_enabled',
      'AntarPay ' || case when p_enabled then 'DIAKTIFKAN' else 'DINONAKTIFKAN' end || ' dari Panel Admin',
      jsonb_build_object('enabled', p_enabled));
  end if;
  return jsonb_build_object('antarpay_enabled', antarpay_enabled());
end $$;
revoke all on function public.admin_set_antarpay_enabled(boolean) from public, anon;
grant execute on function public.admin_set_antarpay_enabled(boolean) to authenticated;
comment on function public.admin_set_antarpay_enabled(boolean) is
  'Panel Admin → Gateway/AntarPay: sakelar enable/disable AntarPay (0088). Butuh is_admin() + admin_require_unlock().';

-- ---------------------------------------------------------------------
-- 3. request_topup — definisi terakhir (0002) disalin utuh + penjaga di awal
-- ---------------------------------------------------------------------
create or replace function request_topup(p_amount bigint, p_method text default 'bank_transfer', p_proof_url text default null, p_note text default null)
returns topup_requests language plpgsql security definer set search_path = public as $$
declare t topup_requests%rowtype;
begin
  perform antarpay_require_enabled();   -- 0088: sakelar AntarPay
  if auth.uid() is null then raise exception 'Harus login'; end if;
  if (select count(*) from topup_requests where user_id = auth.uid() and status = 'pending') >= 3 then
    raise exception 'Masih ada permintaan top up yang menunggu verifikasi';
  end if;
  insert into topup_requests (user_id, amount, method, proof_url, sender_note) values (auth.uid(), p_amount, p_method, p_proof_url, p_note) returning * into t;
  return t;
end $$;
revoke execute on function request_topup(bigint, text, text, text) from public, anon;
grant execute on function request_topup(bigint, text, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 4. request_withdrawal — definisi terakhir (0019) disalin utuh + penjaga di awal
-- ---------------------------------------------------------------------
create or replace function request_withdrawal(p_amount bigint, p_bank text, p_account text, p_name text)
returns withdrawal_requests language plpgsql security definer set search_path = public as $$
declare w withdrawal_requests%rowtype; v_bal bigint; v_auto boolean; v_max bigint := setting_num('auto_payout_max', 500000)::bigint; v_daily bigint := setting_num('auto_payout_daily_max', 1000000)::bigint; v_today bigint; ba bank_accounts;
begin
  perform antarpay_require_enabled();   -- 0088: sakelar AntarPay
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
end $$;
revoke execute on function request_withdrawal(bigint, text, text, text) from public, anon;
grant execute on function request_withdrawal(bigint, text, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 5. create_order — sisip penjaga tepat sesudah cek login (sebelum pekerjaan berbiaya)
--    v_paid_via = coalesce(paid_via, payment_method, 'cash'); selain 'cash' berarti dompet/e-wallet.
-- ---------------------------------------------------------------------
do $$
declare
  def text;
  anchor constant text := $a$  if v_uid is null then raise exception 'Harus login'; end if;$a$;
  guard  constant text := $g$
  -- Sakelar AntarPay (0088): saat nonaktif hanya pembayaran tunai yang diterima.
  if v_paid_via <> 'cash' and not antarpay_enabled() then
    raise exception 'AntarPay sedang dinonaktifkan sementara. Gunakan pembayaran tunai.';
  end if;
$g$;
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_order';
  if def is null then raise exception 'create_order tidak ditemukan'; end if;
  if position('antarpay_enabled' in def) > 0 then
    raise notice 'Sakelar AntarPay sudah terpasang di create_order — dilewati';
    return;
  end if;
  if position(anchor in def) = 0 then
    raise exception 'Jangkar sakelar AntarPay tidak ditemukan di create_order — penjaga TIDAK terpasang';
  end if;
  if position('v_paid_via' in def) = 0 then
    raise exception 'create_order tidak memiliki v_paid_via — definisi fungsi sudah berubah, penjaga TIDAK terpasang';
  end if;
  execute replace(def, anchor, anchor || guard);
end $$;

-- ---------------------------------------------------------------------
-- 6. travel_book — pesan kursi/carter pada jadwal mitra (punya v_paid_via yang sama)
-- ---------------------------------------------------------------------
do $$
declare
  def text;
  anchor constant text := $a$  if v_uid is null then raise exception 'Harus login'; end if;$a$;
  guard  constant text := $g$
  -- Sakelar AntarPay (0088): saat nonaktif hanya pembayaran tunai yang diterima.
  if v_paid_via <> 'cash' and not antarpay_enabled() then
    raise exception 'AntarPay sedang dinonaktifkan sementara. Gunakan pembayaran tunai.';
  end if;
$g$;
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'travel_book';
  if def is null then raise exception 'travel_book tidak ditemukan'; end if;
  if position('antarpay_enabled' in def) > 0 then
    raise notice 'Sakelar AntarPay sudah terpasang di travel_book — dilewati';
    return;
  end if;
  if position(anchor in def) = 0 or position('v_paid_via' in def) = 0 then
    raise exception 'Jangkar sakelar AntarPay tidak ditemukan di travel_book — penjaga TIDAK terpasang';
  end if;
  execute replace(def, anchor, anchor || guard);
end $$;

-- ---------------------------------------------------------------------
-- 7. travel_request_create — carter / sopir harian. Di fungsi ini payment_method
--    DEFAULT-nya 'wallet' (bukan 'cash'), jadi permintaan tanpa payment_method pun ditolak.
-- ---------------------------------------------------------------------
do $$
declare
  def text;
  anchor constant text := $a$  if v_uid is null then raise exception 'Harus login'; end if;$a$;
  guard  constant text := $g$
  -- Sakelar AntarPay (0088): saat nonaktif hanya pembayaran tunai yang diterima.
  if coalesce(nullif(p->>'paid_via', ''), coalesce(p->>'payment_method', 'wallet')) <> 'cash' and not antarpay_enabled() then
    raise exception 'AntarPay sedang dinonaktifkan sementara. Gunakan pembayaran tunai.';
  end if;
$g$;
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'travel_request_create';
  if def is null then raise exception 'travel_request_create tidak ditemukan'; end if;
  if position('antarpay_enabled' in def) > 0 then
    raise notice 'Sakelar AntarPay sudah terpasang di travel_request_create — dilewati';
    return;
  end if;
  if position(anchor in def) = 0 then
    raise exception 'Jangkar sakelar AntarPay tidak ditemukan di travel_request_create — penjaga TIDAK terpasang';
  end if;
  execute replace(def, anchor, anchor || guard);
end $$;

-- Penjaga migrasi: kelima jalur benar-benar bergerbang.
do $$
declare n int;
begin
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public'
     and p.proname in ('create_order', 'travel_book', 'travel_request_create', 'request_topup', 'request_withdrawal')
     and pg_get_functiondef(p.oid) like '%antarpay_%';
  if n <> 5 then raise exception 'Baru % dari 5 jalur AntarPay yang bergerbang — migrasi 0088 gagal', n; end if;
end $$;

-- ---------------------------------------------------------------------
-- 8. Status untuk klien: app_public_settings (dibaca saat mulai + realtime app_settings)
--    dan gateway_public_config (dibaca layar gateway & edge function).
--    Definisi terakhir: app_public_settings = 0025, gateway_public_config = 0016.
-- ---------------------------------------------------------------------
create or replace function app_public_settings()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'services_enabled', coalesce((select value from app_settings where key = 'services_enabled'), '{}'::jsonb),
    'max_km', jsonb_build_object('ride_motor', service_limit_km('ride_motor'), 'ride_car', service_limit_km('ride_car'), 'food', service_limit_km('food'),
                                 'send', service_limit_km('send'), 'shop', service_limit_km('shop'), 'market', service_limit_km('market'), 'box', service_limit_km('box')),
    'osm_import_enabled', coalesce((select value::text::boolean from app_settings where key = 'osm_import_enabled'), true),
    'osm_import_radius_km', setting_num('osm_import_radius_km', 5),
    'pickup_radius_km', coalesce((select value from app_settings where key = 'pickup_radius_km'), '{}'::jsonb),
    'send_limits', coalesce((select value from app_settings where key = 'send_limits'), '{}'::jsonb),
    'priority_tiers', coalesce((select value from app_settings where key = 'priority_tiers'), '[]'::jsonb),
    'wait_apology_minutes', setting_num('wait_apology_minutes', 5),
    'antarpay_enabled', antarpay_enabled()
  );
$$;
grant execute on function app_public_settings() to anon, authenticated;

create or replace function gateway_public_config()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'provider', coalesce((select value #>> '{}' from app_settings where key = 'pg_provider'), 'midtrans'),
    'methods', coalesce((select value from app_settings where key = 'pg_methods'), '[]'::jsonb),
    'topup_min', setting_num('pg_topup_min', 10000), 'topup_max', setting_num('pg_topup_max', 10000000),
    'configured', exists (select 1 from gateway_secrets where provider = 'midtrans' and coalesce(server_key, '') <> ''),
    'is_production', coalesce((select is_production from gateway_secrets where provider = 'midtrans'), false),
    'client_key', (select client_key from gateway_secrets where provider = 'midtrans'),
    'antarpay_enabled', antarpay_enabled());
$$;
grant execute on function gateway_public_config() to anon, authenticated;

comment on function create_order(jsonb) is
  'Membuat pesanan untuk semua layanan (ride/car/food/send/box/shop/market). '
  'Sejak 0080 pesanan DITOLAK bila titik jemput berada di kota yang layanannya belum dibuka. '
  'Sejak 0083 idempoten: p.client_request_id yang sama mengembalikan pesanan yang sudah ada; tanpa kunci, pesanan identik dalam 15 detik dianggap ketuk ganda. '
  'Sejak 0088 paid_via selain cash DITOLAK bila antarpay_enabled() = false.';
