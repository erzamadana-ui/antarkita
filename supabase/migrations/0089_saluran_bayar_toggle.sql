-- =====================================================================
-- 0089 — SALURAN PEMBAYARAN SATU PER SATU (aktif/nonaktif dari Panel Admin)
--
-- Keputusan komisaris (contoh halaman bayar Alfagift): Panel Admin harus bisa
-- mengaktifkan/menonaktifkan SETIAP saluran pembayaran satu per satu — termasuk
-- AntarPay (saldo) dan e-money kartu NFC — bukan hanya sakelar global 0088.
--
-- HIERARKI SAKELAR (0088 = induk, 0089 = anak):
--   antarpay_enabled() = false  →  SEMUA saluran selain 'cash' efektif NONAKTIF,
--                                  apa pun setelan per-saluran.
--   antarpay_enabled() = true   →  tiap saluran mengikuti app_settings.payment_channels.
--
-- Setelan: app_settings key 'payment_channels' = objek jsonb {"<kunci>": true/false}
--   cash (default TRUE) · antarpay · emoney_nfc · gopay · shopeepay · qris · ovo ·
--   dana · bank_transfer · card (default FALSE — Midtrans belum produksi).
--
-- Penegakan di SERVER (bukan sekadar UI):
--   • create_order / travel_book / travel_request_create — sesudah penjaga 0088.
--   • request_topup — saluran metode top up harus aktif.
--   • edge function midtrans-create — cek payment_channel_enabled(method).
--   • pg_methods tetap disinkronkan agar Snap (midtrans-create) konsisten.
--
-- Cara pasang penjaga: create_order / travel_book / travel_request_create /
-- request_topup SUDAH ditambal berlapis (0021, 0030, 0080, 0083, 0088) → definisi
-- diambil dengan pg_get_functiondef lalu disisipkan di jangkar. Bila jangkar hilang
-- migrasi SENGAJA GAGAL (tidak boleh diam-diam tidak bergerbang).
-- Semua blok idempoten (aman dijalankan ulang).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Daftar kunci saluran + label bahasa Indonesia
-- ---------------------------------------------------------------------
create or replace function public.payment_channel_keys()
returns text[] language sql immutable set search_path = public as $$
  select array['cash','antarpay','emoney_nfc','gopay','shopeepay','qris','ovo','dana','bank_transfer','card']::text[];
$$;
grant execute on function public.payment_channel_keys() to anon, authenticated;
comment on function public.payment_channel_keys() is 'Daftar kunci saluran pembayaran yang dikenal (0089).';

-- Subhimpunan saluran yang dilayani payment gateway (Midtrans) — dipakai untuk sinkron pg_methods.
create or replace function public.payment_gateway_channel_keys()
returns text[] language sql immutable set search_path = public as $$
  select array['gopay','shopeepay','qris','ovo','dana','bank_transfer','card']::text[];
$$;
grant execute on function public.payment_gateway_channel_keys() to anon, authenticated;

create or replace function public.payment_channel_label(p_key text)
returns text language sql immutable set search_path = public as $$
  select case lower(trim(coalesce(p_key, '')))
    when 'cash' then 'Tunai/COD'
    when 'antarpay' then 'AntarPay (saldo)'
    when 'emoney_nfc' then 'E-money (kartu NFC)'
    when 'gopay' then 'GoPay'
    when 'shopeepay' then 'ShopeePay'
    when 'qris' then 'QRIS'
    when 'ovo' then 'OVO'
    when 'dana' then 'DANA'
    when 'bank_transfer' then 'Transfer bank (VA)'
    when 'card' then 'Kartu kredit/debit'
    else coalesce(nullif(trim(coalesce(p_key, '')), ''), 'ini')
  end;
$$;
grant execute on function public.payment_channel_label(text) to anon, authenticated;

-- paid_via / p_method → kunci saluran.
--   '' / null / 'cash' → cash · 'wallet' → antarpay · 'emoney'/'nfc' → emoney_nfc
--   kode e-wallet/gateway yang dikenal → saluran bernama sama
--   kode tak dikenal → antarpay (create_order memperlakukan semua non-cash sebagai bayar dompet)
create or replace function public.payment_channel_of(p_paid_via text)
returns text language sql immutable set search_path = public as $$
  select case
    when coalesce(nullif(trim(lower(coalesce(p_paid_via, ''))), ''), 'cash') = 'cash' then 'cash'
    when trim(lower(p_paid_via)) in ('wallet', 'antarpay', 'saldo') then 'antarpay'
    when trim(lower(p_paid_via)) in ('emoney', 'e-money', 'nfc', 'emoney_nfc') then 'emoney_nfc'
    when trim(lower(p_paid_via)) = any (payment_channel_keys()) then trim(lower(p_paid_via))
    else 'antarpay'
  end;
$$;
grant execute on function public.payment_channel_of(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Setelan app_settings.payment_channels (idempoten; kunci baru diisi default,
--    nilai yang sudah diatur admin TIDAK ditimpa)
-- ---------------------------------------------------------------------
do $$
declare
  -- Default pemasangan PERTAMA = potret keadaan yang SEDANG berjalan, supaya
  -- migrasi ini tidak diam-diam mematikan pembayaran yang hari ini masih dipakai.
  --   cash        : selalu aktif
  --   antarpay    : mengikuti sakelar global 0088 (app_settings.antarpay_enabled)
  --   emoney_nfc  : mengikuti sakelar global 0088 (sebelum 0089 tidak ada kontrol terpisah)
  --   saluran gateway : mengikuti daftar app_settings.pg_methods yang sudah ada
  -- Admin mematikan yang belum siap lewat panel (admin_set_payment_channel).
  v_global boolean := coalesce((select lower(value #>> '{}') = 'true'
                                from app_settings where key = 'antarpay_enabled'), false);
  v_pg text[];
  d jsonb;
  k text;
  v jsonb;
begin
  select coalesce(array(select lower(e) from jsonb_array_elements_text(s.value) e), '{}'::text[])
    into v_pg
    from app_settings s
   where s.key = 'pg_methods' and jsonb_typeof(s.value) = 'array';
  v_pg := coalesce(v_pg, '{}'::text[]);

  d := jsonb_build_object('cash', true, 'antarpay', v_global, 'emoney_nfc', v_global);
  foreach k in array payment_gateway_channel_keys() loop
    d := d || jsonb_build_object(k, v_global and (k = any (v_pg)));
  end loop;

  select value into v from app_settings where key = 'payment_channels';
  if v is null or jsonb_typeof(v) <> 'object' then
    insert into app_settings (key, value) values ('payment_channels', d)
    on conflict (key) do update set value = d, updated_at = now();
    -- Selaraskan pg_methods dengan saluran gateway yang aktif supaya dua kontrol
    -- tidak bertabrakan. Dengan default di atas isinya = pg_methods semula (tak berubah).
    insert into app_settings (key, value)
    values ('pg_methods', coalesce((select jsonb_agg(x) from unnest(payment_gateway_channel_keys()) x
                                    where (d ->> x) = 'true'), '[]'::jsonb))
    on conflict (key) do update set value = excluded.value, updated_at = now();
    raise notice '0089: payment_channels dibuat dari keadaan berjalan (global=%, pg_methods=%)', v_global, v_pg;
  elsif (d || v) <> v then
    update app_settings set value = d || v, updated_at = now() where key = 'payment_channels';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 3. Pembacaan status saluran
--    payment_channel_enabled  = status EFEKTIF (sakelar global 0088 sebagai induk)
--    payment_channels_stored  = setelan MENTAH (apa yang disetel admin, tanpa induk)
--    payment_channels_public  = peta status efektif untuk klien
-- ---------------------------------------------------------------------
create or replace function public.payment_channel_enabled(p_key text)
returns boolean language plpgsql stable security definer set search_path = public as $$
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
end $$;
grant execute on function public.payment_channel_enabled(text) to anon, authenticated;
comment on function public.payment_channel_enabled(text) is
  'Status EFEKTIF satu saluran pembayaran (0089). Selain ''cash'' selalu false bila antarpay_enabled() = false.';

create or replace function public.payment_channels_stored()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb; res jsonb := '{}'::jsonb; k text;
begin
  select case when jsonb_typeof(value) = 'object' then value else '{}'::jsonb end into v
    from app_settings where key = 'payment_channels';
  v := coalesce(v, '{}'::jsonb);
  foreach k in array payment_channel_keys() loop
    res := res || jsonb_build_object(k, case when k = 'cash' then coalesce(lower(v ->> k) <> 'false', true)
                                             else coalesce(lower(v ->> k) = 'true', false) end);
  end loop;
  return res;
end $$;
grant execute on function public.payment_channels_stored() to anon, authenticated;

create or replace function public.payment_channels_public()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(t.k, payment_channel_enabled(t.k)), '{}'::jsonb)
  from unnest(payment_channel_keys()) as t(k);
$$;
grant execute on function public.payment_channels_public() to anon, authenticated;
comment on function public.payment_channels_public() is
  'Peta status EFEKTIF semua saluran pembayaran untuk klien (0089) — sudah memperhitungkan sakelar global AntarPay.';

-- Pesan tunggal supaya aplikasi & simulasi bisa mencocokkan teksnya.
create or replace function public.payment_channel_require(p_paid_via text)
returns void language plpgsql stable security definer set search_path = public as $$
declare v_ch text := payment_channel_of(p_paid_via);
begin
  -- 1) Sakelar global 0088 sebagai induk semua saluran non-tunai.
  if v_ch <> 'cash' and not antarpay_enabled() then
    raise exception 'AntarPay sedang dinonaktifkan sementara. Gunakan pembayaran tunai.';
  end if;

  -- 2) FAKTA RAIL: di create_order/travel_book, SETIAP paid_via selain 'cash'
  --    disetel v_pay = 'wallet' — artinya dana ditarik dari saldo AntarPay,
  --    termasuk untuk GoPay/QRIS/VA/e-money. Maka saluran 'antarpay' adalah
  --    induk teknis semua saluran non-tunai: kalau saldo dimatikan, tidak ada
  --    rail untuk menyelesaikan pembayarannya.
  if v_ch <> 'cash' and not payment_channel_enabled('antarpay') then
    raise exception 'Saluran AntarPay (saldo) sedang dinonaktifkan. Semua pembayaran non-tunai diselesaikan lewat saldo AntarPay, jadi sementara ini gunakan pembayaran tunai.';
  end if;

  -- 3) Saluran yang dipilih itu sendiri.
  if payment_channel_enabled(v_ch) then return; end if;
  raise exception 'Metode pembayaran % sedang dinonaktifkan. Pilih metode lain.', payment_channel_label(v_ch);
end $$;
grant execute on function public.payment_channel_require(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. RPC admin: sakelar per saluran (wajib admin + panel terbuka kunci PIN)
-- ---------------------------------------------------------------------
create or replace function public.admin_set_payment_channel(p_key text, p_enabled boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_key text := lower(trim(coalesce(p_key, ''))); v jsonb; v_methods jsonb;
begin
  if not is_admin() then raise exception 'Hanya admin'; end if;
  perform admin_require_unlock();
  if p_enabled is null then raise exception 'Nilai sakelar wajib diisi'; end if;
  if not (v_key = any (payment_channel_keys())) then
    raise exception 'Saluran pembayaran tidak dikenal: %', coalesce(nullif(p_key, ''), '(kosong)');
  end if;

  insert into app_settings (key, value) values ('payment_channels', jsonb_build_object(v_key, p_enabled))
  on conflict (key) do update set
    value = (case when jsonb_typeof(app_settings.value) = 'object' then app_settings.value else '{}'::jsonb end)
            || jsonb_build_object(v_key, p_enabled),
    updated_at = now()
  returning value into v;

  -- Sinkron pg_methods (dipakai gateway_public_config → edge function midtrans-create)
  if v_key = any (payment_gateway_channel_keys()) then
    select coalesce((select value from app_settings where key = 'pg_methods'), '[]'::jsonb) into v_methods;
    if jsonb_typeof(v_methods) <> 'array' then v_methods := '[]'::jsonb; end if;
    if p_enabled then
      if not (v_methods ? v_key) then v_methods := v_methods || to_jsonb(v_key); end if;
    else
      select coalesce(jsonb_agg(e), '[]'::jsonb) into v_methods from jsonb_array_elements_text(v_methods) e where e <> v_key;
    end if;
    insert into app_settings (key, value) values ('pg_methods', v_methods)
    on conflict (key) do update set value = excluded.value, updated_at = now();
  end if;

  if to_regprocedure('public.log_activity(text,text,text,text,jsonb)') is not null then
    perform log_activity('payment_channel.toggle', 'app_settings', 'payment_channels',
      'Saluran ' || payment_channel_label(v_key) || case when p_enabled then ' DIAKTIFKAN' else ' DINONAKTIFKAN' end || ' dari Panel Admin',
      jsonb_build_object('channel', v_key, 'enabled', p_enabled));
  end if;

  return jsonb_build_object(
    'payment_channels', payment_channels_stored(),
    'effective', payment_channels_public(),
    'antarpay_enabled', antarpay_enabled(),
    'pg_methods', coalesce((select value from app_settings where key = 'pg_methods'), '[]'::jsonb));
end $$;
revoke all on function public.admin_set_payment_channel(text, boolean) from public, anon;
grant execute on function public.admin_set_payment_channel(text, boolean) to authenticated;
comment on function public.admin_set_payment_channel(text, boolean) is
  'Panel Admin → Gateway: aktif/nonaktif satu saluran pembayaran (0089). Butuh is_admin() + admin_require_unlock(); ikut menyinkronkan pg_methods.';

-- Pembacaan untuk Panel Admin: nilai MENTAH (yang disetel admin) + status efektif.
create or replace function public.admin_payment_channels()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Hanya admin'; end if;
  return jsonb_build_object(
    'payment_channels', payment_channels_stored(),
    'effective', payment_channels_public(),
    'antarpay_enabled', antarpay_enabled(),
    'pg_methods', coalesce((select value from app_settings where key = 'pg_methods'), '[]'::jsonb));
end $$;
revoke all on function public.admin_payment_channels() from public, anon;
grant execute on function public.admin_payment_channels() to authenticated;

-- ---------------------------------------------------------------------
-- 5. Penegakan di create_order — disisipkan TEPAT SESUDAH penjaga 0088
-- ---------------------------------------------------------------------
do $$
declare
  def text;
  anchor constant text := $a$  if v_paid_via <> 'cash' and not antarpay_enabled() then
    raise exception 'AntarPay sedang dinonaktifkan sementara. Gunakan pembayaran tunai.';
  end if;$a$;
  guard  constant text := $g$
  -- Saluran pembayaran per metode (0089): tolak bila saluran yang dipakai dimatikan admin.
  perform payment_channel_require(v_paid_via);
$g$;
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_order';
  if def is null then raise exception 'create_order tidak ditemukan'; end if;
  if position('payment_channel_require' in def) > 0 then
    raise notice 'Penjaga saluran pembayaran sudah terpasang di create_order — dilewati';
    return;
  end if;
  if position(anchor in def) = 0 then
    raise exception 'Jangkar penjaga 0088 tidak ditemukan di create_order — jalankan migrasi 0088 dulu; penjaga saluran TIDAK terpasang';
  end if;
  execute replace(def, anchor, anchor || guard);
end $$;

-- ---------------------------------------------------------------------
-- 6. travel_book — pesan kursi/carter pada jadwal mitra
-- ---------------------------------------------------------------------
do $$
declare
  def text;
  anchor constant text := $a$  if v_paid_via <> 'cash' and not antarpay_enabled() then
    raise exception 'AntarPay sedang dinonaktifkan sementara. Gunakan pembayaran tunai.';
  end if;$a$;
  guard  constant text := $g$
  -- Saluran pembayaran per metode (0089): tolak bila saluran yang dipakai dimatikan admin.
  perform payment_channel_require(v_paid_via);
$g$;
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'travel_book';
  if def is null then raise exception 'travel_book tidak ditemukan'; end if;
  if position('payment_channel_require' in def) > 0 then
    raise notice 'Penjaga saluran pembayaran sudah terpasang di travel_book — dilewati';
    return;
  end if;
  if position(anchor in def) = 0 then
    raise exception 'Jangkar penjaga 0088 tidak ditemukan di travel_book — jalankan migrasi 0088 dulu; penjaga saluran TIDAK terpasang';
  end if;
  execute replace(def, anchor, anchor || guard);
end $$;

-- ---------------------------------------------------------------------
-- 7. travel_request_create — carter / sopir harian (default payment_method = 'wallet')
-- ---------------------------------------------------------------------
do $$
declare
  def text;
  anchor constant text := $a$  if coalesce(nullif(p->>'paid_via', ''), coalesce(p->>'payment_method', 'wallet')) <> 'cash' and not antarpay_enabled() then
    raise exception 'AntarPay sedang dinonaktifkan sementara. Gunakan pembayaran tunai.';
  end if;$a$;
  guard  constant text := $g$
  -- Saluran pembayaran per metode (0089): tolak bila saluran yang dipakai dimatikan admin.
  perform payment_channel_require(coalesce(nullif(p->>'paid_via', ''), coalesce(p->>'payment_method', 'wallet')));
$g$;
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'travel_request_create';
  if def is null then raise exception 'travel_request_create tidak ditemukan'; end if;
  if position('payment_channel_require' in def) > 0 then
    raise notice 'Penjaga saluran pembayaran sudah terpasang di travel_request_create — dilewati';
    return;
  end if;
  if position(anchor in def) = 0 then
    raise exception 'Jangkar penjaga 0088 tidak ditemukan di travel_request_create — jalankan migrasi 0088 dulu; penjaga saluran TIDAK terpasang';
  end if;
  execute replace(def, anchor, anchor || guard);
end $$;

-- ---------------------------------------------------------------------
-- 8. request_topup — saluran metode top up harus aktif
--    (mis. 'bank_transfer' mati → top up transfer bank ditolak)
-- ---------------------------------------------------------------------
do $$
declare
  def text;
  anchor constant text := $a$  perform antarpay_require_enabled();$a$;
  guard  constant text := $g$
  perform payment_channel_require(coalesce(nullif(p_method, ''), 'bank_transfer'));   -- 0089: saluran top up
$g$;
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'request_topup';
  if def is null then raise exception 'request_topup tidak ditemukan'; end if;
  if position('payment_channel_require' in def) > 0 then
    raise notice 'Penjaga saluran pembayaran sudah terpasang di request_topup — dilewati';
    return;
  end if;
  if position(anchor in def) = 0 then
    raise exception 'Jangkar penjaga 0088 tidak ditemukan di request_topup — jalankan migrasi 0088 dulu; penjaga saluran TIDAK terpasang';
  end if;
  if position('p_method' in def) = 0 then
    raise exception 'request_topup tidak menerima p_method — definisi berubah, penjaga saluran TIDAK terpasang';
  end if;
  execute replace(def, anchor, anchor || guard);
end $$;

-- Penjaga migrasi: keempat jalur benar-benar bergerbang saluran.
do $$
declare n int;
begin
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public'
     and p.proname in ('create_order', 'travel_book', 'travel_request_create', 'request_topup')
     and pg_get_functiondef(p.oid) like '%payment_channel_require%';
  if n <> 4 then raise exception 'Baru % dari 4 jalur saluran pembayaran yang bergerbang — migrasi 0089 gagal', n; end if;
end $$;

-- ---------------------------------------------------------------------
-- 9. Status untuk klien: tambahkan 'payment_channels' ke app_public_settings()
--    dan gateway_public_config(). Definisi TERKINI diambil lewat pg_get_functiondef
--    supaya tambalan 0088 (dan tambalan lain) tidak tertimpa.
-- ---------------------------------------------------------------------
do $$
declare
  def text;
  fn text;
  anchor constant text := $a$'antarpay_enabled', antarpay_enabled()$a$;
  patch  constant text := $p$'antarpay_enabled', antarpay_enabled(),
    'payment_channels', payment_channels_public()$p$;
begin
  foreach fn in array array['app_public_settings', 'gateway_public_config'] loop
    select pg_get_functiondef(p.oid) into def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = fn;
    if def is null then raise exception '% tidak ditemukan', fn; end if;
    if position('payment_channels_public' in def) > 0 then
      raise notice 'payment_channels sudah ada di % — dilewati', fn;
      continue;
    end if;
    if position(anchor in def) = 0 then
      raise exception 'Jangkar antarpay_enabled tidak ditemukan di % — jalankan migrasi 0088 dulu; payment_channels TIDAK ditambahkan', fn;
    end if;
    execute replace(def, anchor, patch);
  end loop;
end $$;

-- Grant bisa hilang saat fungsi dibuat ulang lewat pg_get_functiondef.
grant execute on function app_public_settings() to anon, authenticated;
grant execute on function gateway_public_config() to anon, authenticated;

-- Penjaga migrasi: kedua fungsi pembaca benar-benar mengirim payment_channels.
do $$
declare n int;
begin
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname in ('app_public_settings', 'gateway_public_config')
     and pg_get_functiondef(p.oid) like '%payment_channels_public%';
  if n <> 2 then raise exception 'Baru % dari 2 fungsi publik yang mengirim payment_channels — migrasi 0089 gagal', n; end if;
end $$;

comment on function create_order(jsonb) is
  'Membuat pesanan untuk semua layanan (ride/car/food/send/box/shop/market). '
  'Sejak 0080 pesanan DITOLAK bila titik jemput berada di kota yang layanannya belum dibuka. '
  'Sejak 0083 idempoten: p.client_request_id yang sama mengembalikan pesanan yang sudah ada; tanpa kunci, pesanan identik dalam 15 detik dianggap ketuk ganda. '
  'Sejak 0088 paid_via selain cash DITOLAK bila antarpay_enabled() = false. '
  'Sejak 0089 paid_via DITOLAK bila saluran pembayarannya dimatikan admin (payment_channel_enabled).';
