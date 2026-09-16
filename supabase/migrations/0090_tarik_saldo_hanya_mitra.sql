-- =====================================================================
-- 0090 — PENARIKAN SALDO HANYA UNTUK MITRA (menutup jalur cash-in/cash-out)
--
-- MASALAH: request_withdrawal() tidak memeriksa peran sama sekali. Pelanggan
-- biasa bisa top up lewat Midtrans lalu menarik saldonya ke rekening bank tanpa
-- pernah memakai layanan. Itu BUKAN dompet tertutup (closed-loop) melainkan
-- pengiriman uang — butuh izin penyelenggara transfer dana di Indonesia, dan
-- membuat deklarasi "Financial features" di Google Play menjadi tidak benar.
-- Tombolnya memang disembunyikan di aplikasi Pelanggan, tetapi rute
-- /pay/withdraw tetap dapat dicapai lewat deep link, jadi perbaikan HARUS di server.
--
-- SETELAH MIGRASI INI: saldo AntarPay pelanggan hanya bisa DIPAKAI untuk layanan,
-- tidak bisa dicairkan. Mitra (driver/merchant) tetap bisa menarik pendapatannya.
-- Sakelar darurat: app_settings.customer_withdrawal_enabled (default false) —
-- JANGAN dinyalakan sebelum ada badan usaha + izin yang sesuai.
-- Idempoten.
-- =====================================================================

create or replace function public.withdrawal_allowed_roles()
returns text[] language sql immutable set search_path = public as $$
  select array['driver','merchant','admin']::text[];
$$;
grant execute on function public.withdrawal_allowed_roles() to anon, authenticated;

create or replace function public.withdrawal_require_allowed()
returns void language plpgsql stable security definer set search_path = public as $$
declare v_role text;
begin
  select role::text into v_role from profiles where id = auth.uid();
  if v_role is null then raise exception 'Harus login'; end if;
  if v_role = any (withdrawal_allowed_roles()) then return; end if;
  -- Pelanggan: hanya bila pemilik sengaja membuka (butuh izin usaha yang sesuai).
  if coalesce((select lower(value #>> '{}') = 'true' from app_settings
               where key = 'customer_withdrawal_enabled'), false) then
    return;
  end if;
  raise exception 'Saldo AntarPay pelanggan dipakai untuk membayar layanan, bukan untuk dicairkan. Penarikan saldo hanya untuk mitra (driver/merchant).';
end $$;
grant execute on function public.withdrawal_require_allowed() to authenticated;
comment on function public.withdrawal_require_allowed() is
  'Penjaga 0090: hanya mitra yang boleh menarik saldo, supaya AntarPay tetap dompet tertutup bagi pelanggan.';

-- Sakelar (default TERTUTUP) supaya statusnya terbaca di Panel Admin/app_settings.
insert into app_settings (key, value) values ('customer_withdrawal_enabled', 'false'::jsonb)
on conflict (key) do nothing;

-- Sisipkan penjaga tepat sesudah jangkar 0088 di request_withdrawal.
do $$
declare
  def text;
  anchor constant text := $a$  perform antarpay_require_enabled();   -- 0088: sakelar AntarPay$a$;
  guard  constant text := $g$
  perform withdrawal_require_allowed();  -- 0090: penarikan hanya untuk mitra
$g$;
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'request_withdrawal';
  if def is null then raise exception 'request_withdrawal tidak ditemukan'; end if;
  if position('withdrawal_require_allowed' in def) > 0 then
    raise notice 'Penjaga penarikan sudah terpasang — dilewati';
    return;
  end if;
  if position(anchor in def) = 0 then
    raise exception 'Jangkar 0088 tidak ditemukan di request_withdrawal — penjaga TIDAK terpasang';
  end if;
  execute replace(def, anchor, anchor || guard);
end $$;

-- Penjaga migrasi: benar-benar terpasang.
do $$
declare n int;
begin
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'request_withdrawal'
     and pg_get_functiondef(p.oid) like '%withdrawal_require_allowed%';
  if n <> 1 then raise exception 'request_withdrawal tidak bergerbang — migrasi 0090 gagal'; end if;
end $$;

comment on function request_withdrawal(bigint, text, text, text) is
  'Permintaan pencairan saldo ke rekening bank. Sejak 0088 ditolak bila AntarPay nonaktif. '
  'Sejak 0090 HANYA untuk peran driver/merchant/admin (lihat withdrawal_require_allowed) '
  'agar saldo pelanggan tetap dompet tertutup.';
