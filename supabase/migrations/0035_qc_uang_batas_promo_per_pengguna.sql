-- 0035 — Perbaikan QC uang: batas pemakaian kode promo per pengguna
--
-- Masalah (ditemukan simulasi S43c): apply_promo hanya memeriksa masa berlaku, layanan, minimal transaksi
-- dan KUOTA GLOBAL. Tidak ada catatan siapa memakai kode apa, sehingga satu akun bisa memakai kode yang sama
-- berkali-kali (mis. kode "pengguna baru") sampai kuota global habis.
--
-- Perbaikan: tabel promo_redemptions mencatat pemakaian per pesanan, diisi/dihapus otomatis oleh trigger pada
-- orders (dihapus lagi ketika pesanan dibatalkan, sejalan dengan pengembalian used_count), dan apply_promo
-- menolak bila pemakaian pengguna sudah mencapai promos.per_user_limit.
--
-- PENTING untuk pemilik: kolom per_user_limit berisi 1 untuk SEMUA kode yang sudah ada (aman secara default —
-- satu kali per akun). Untuk kampanye yang memang boleh dipakai berulang, set per_user_limit ke jumlah yang
-- diinginkan, atau 0 / NULL untuk tanpa batas.
-- Riwayat pesanan lama SENGAJA tidak di-backfill: aplikasi belum rilis dan pesanan yang ada hanyalah uji coba,
-- sehingga pembatasan berlaku ke depan saja.

alter table public.promos add column if not exists per_user_limit int default 1;
comment on column public.promos.per_user_limit is 'Batas pemakaian kode per akun. NULL atau 0 = tanpa batas.';

create table if not exists public.promo_redemptions (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  order_id uuid not null unique references public.orders(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists idx_promo_redemptions_code_user on public.promo_redemptions (code, user_id);

alter table public.promo_redemptions enable row level security;
drop policy if exists promo_redemptions_baca_sendiri on public.promo_redemptions;
create policy promo_redemptions_baca_sendiri on public.promo_redemptions
  for select to authenticated using (user_id = auth.uid() or is_admin());

revoke all on table public.promo_redemptions from public, anon;
grant select on table public.promo_redemptions to authenticated;

create or replace function public.trg_promo_redemption()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if tg_op = 'INSERT' then
    if new.promo_code is not null then
      insert into promo_redemptions (code, user_id, order_id) values (new.promo_code, new.customer_id, new.id)
      on conflict (order_id) do nothing;
    end if;
  elsif tg_op = 'UPDATE' then
    if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
      delete from promo_redemptions where order_id = new.id;
    elsif new.promo_code is null and old.promo_code is not null then
      delete from promo_redemptions where order_id = new.id;
    end if;
  end if;
  return null;
end $function$;

drop trigger if exists trg_promo_redemption_ins on public.orders;
create trigger trg_promo_redemption_ins after insert on public.orders
  for each row execute function public.trg_promo_redemption();
drop trigger if exists trg_promo_redemption_upd on public.orders;
create trigger trg_promo_redemption_upd after update on public.orders
  for each row execute function public.trg_promo_redemption();

create or replace function public.apply_promo(p_code text, p_service service_type, p_subtotal bigint)
 returns bigint
 language plpgsql
 stable
 security definer
 set search_path to 'public'
as $function$
declare pr promos%rowtype; v_disc bigint; v_pakai int;
begin
  if p_code is null or p_code = '' then return 0; end if;
  select * into pr from promos where code = upper(p_code) and is_active
    and (valid_from is null or valid_from <= now()) and (valid_to is null or valid_to >= now())
    and (service is null or service = p_service) and (quota is null or used_count < quota);
  if not found then raise exception 'Kode promo tidak valid / kedaluwarsa'; end if;
  if p_subtotal < pr.min_total then raise exception 'Minimal transaksi promo Rp %', pr.min_total; end if;
  if coalesce(pr.per_user_limit, 0) > 0 and auth.uid() is not null then
    select count(*) into v_pakai from promo_redemptions pd where pd.code = pr.code and pd.user_id = auth.uid();
    if v_pakai >= pr.per_user_limit then
      raise exception 'Kode promo % sudah pernah Anda pakai (maksimal %x per akun)', pr.code, pr.per_user_limit;
    end if;
  end if;
  if pr.discount_type = 'percent' then v_disc := floor(p_subtotal * pr.value / 100.0); else v_disc := pr.value; end if;
  if pr.max_discount is not null then v_disc := least(v_disc, pr.max_discount); end if;
  return least(v_disc, p_subtotal);
end $function$;

revoke all on function public.apply_promo(text, service_type, bigint) from public;
grant execute on function public.apply_promo(text, service_type, bigint) to authenticated;
