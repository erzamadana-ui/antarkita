-- 0037 — Lanjutan 0035: pemeriksaan batas promo per pengguna dipindah ke trigger BEFORE INSERT pada orders.
--
-- Alasan: create_order MENYISIPKAN baris orders lebih dulu, baru memanggil apply_promo. Karena trigger
-- pencatat pemakaian berjalan AFTER INSERT, pemakaian pesanan yang sedang dibuat ikut terhitung sehingga
-- pemakaian PERTAMA pun ditolak. Pemeriksaan karena itu dilakukan BEFORE INSERT (saat baris belum ada,
-- dan sebelum saldo pelanggan dipotong), dan dilepas lagi dari apply_promo.

create or replace function public.trg_promo_redemption()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare pr promos%rowtype; v_pakai int;
begin
  if tg_op = 'INSERT' and tg_when = 'BEFORE' then
    if new.promo_code is not null then
      select * into pr from promos where code = new.promo_code;
      if found and coalesce(pr.per_user_limit, 0) > 0 then
        select count(*) into v_pakai from promo_redemptions pd where pd.code = pr.code and pd.user_id = new.customer_id;
        if v_pakai >= pr.per_user_limit then
          raise exception 'Kode promo % sudah pernah Anda pakai (maksimal %x per akun)', pr.code, pr.per_user_limit;
        end if;
      end if;
    end if;
    return new;
  elsif tg_op = 'INSERT' then
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

drop trigger if exists trg_promo_redemption_cek on public.orders;
create trigger trg_promo_redemption_cek before insert on public.orders
  for each row execute function public.trg_promo_redemption();

-- apply_promo kembali tanpa pemeriksaan per pengguna (sudah ditangani trigger di atas)
create or replace function public.apply_promo(p_code text, p_service service_type, p_subtotal bigint)
 returns bigint
 language plpgsql
 stable
 security definer
 set search_path to 'public'
as $function$
declare pr promos%rowtype; v_disc bigint;
begin
  if p_code is null or p_code = '' then return 0; end if;
  select * into pr from promos where code = upper(p_code) and is_active
    and (valid_from is null or valid_from <= now()) and (valid_to is null or valid_to >= now())
    and (service is null or service = p_service) and (quota is null or used_count < quota);
  if not found then raise exception 'Kode promo tidak valid / kedaluwarsa'; end if;
  if p_subtotal < pr.min_total then raise exception 'Minimal transaksi promo Rp %', pr.min_total; end if;
  if pr.discount_type = 'percent' then v_disc := floor(p_subtotal * pr.value / 100.0); else v_disc := pr.value; end if;
  if pr.max_discount is not null then v_disc := least(v_disc, pr.max_discount); end if;
  return least(v_disc, p_subtotal);
end $function$;

revoke all on function public.apply_promo(text, service_type, bigint) from public;
grant execute on function public.apply_promo(text, service_type, bigint) to authenticated;
