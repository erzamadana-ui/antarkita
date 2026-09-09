-- 0034 — Perbaikan QC uang: tip yang menguap & pembatalan pesanan belanja yang sudah dibayar driver
--
-- Masalah (ditemukan simulasi S44f dan S49):
--   * S44f  add_tip memotong saldo pelanggan dan menyimpan nilainya di orders.tip, tetapi driver baru dikredit
--           saat order selesai. Kalau order dibatalkan, cancel_order hanya mengembalikan orders.total —
--           tip tidak dikembalikan ke pelanggan dan tidak pernah masuk ke driver. Uang benar-benar menguap.
--           Hal yang sama terjadi ketika merchant menolak pesanan (merchant_update_order).
--   * S49   Pada AntarShop/AntarMarket, setelah driver menandai total belanja riil (set_shopping_actual) uang
--           barang sudah keluar dari kantong driver. cancel_order lama tetap mengembalikan 100% ke pelanggan,
--           sehingga driver menombok penuh. Sekarang pembatalan mandiri ditolak; bila admin tetap membatalkan,
--           uang belanja dikembalikan lebih dulu ke driver dan sisanya baru direfund ke pelanggan.
--   * Bonus: merchant_update_order('rejected') kini juga mengembalikan kuota promo, sama seperti cancel_order.

create or replace function public.cancel_order(p_order_id uuid, p_reason text default null)
 returns orders
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_uid uuid := auth.uid(); o orders%rowtype; v_admin boolean := is_admin(); v_tip bigint; v_belanja bigint;
begin
  select * into o from orders where id = p_order_id for update;
  if not found then raise exception 'Order tidak ditemukan'; end if;
  if o.status in ('completed','cancelled') then raise exception 'Order sudah selesai/batal'; end if;

  -- pesanan belanja yang sudah dibayar driver di toko/pasar
  v_belanja := case when o.service in ('shop','market') and (o.actual_items is not null or o.receipt_url is not null)
                         and o.status in ('arrived','in_progress')
                    then coalesce(o.items_subtotal, 0) else 0 end;

  if o.driver_id = v_uid and not v_admin then
    if o.status = 'in_progress' then raise exception 'Perjalanan sudah dimulai, tidak bisa dibatalkan'; end if;
    if v_belanja > 0 then
      raise exception 'Belanja Rp% sudah Anda bayar di toko. Pesanan tidak bisa dilepas — selesaikan atau hubungi CS.', v_belanja;
    end if;
    update orders set driver_id = null, status = 'searching', accepted_at = null, arrived_at = null where id = o.id returning * into o;
    insert into order_events (order_id, status, actor_id, note) values (o.id, 'driver_cancelled', v_uid, coalesce(p_reason, 'Driver membatalkan, mencari driver lain'));
    return o;
  end if;

  if o.customer_id <> v_uid and not v_admin then raise exception 'Tidak berhak'; end if;
  if o.status = 'in_progress' and not v_admin then raise exception 'Perjalanan sedang berlangsung, hubungi CS untuk pembatalan'; end if;
  if v_belanja > 0 and not v_admin then
    raise exception 'Driver sudah membayar belanja Rp% di toko. Pesanan tidak bisa dibatalkan sendiri — hubungi CS.', v_belanja;
  end if;

  v_tip := coalesce(o.tip, 0);
  update orders set status = 'cancelled', cancelled_at = now(), cancelled_by = v_uid, cancel_reason = p_reason, tip = 0,
    payment_status = case when payment_status = 'paid' then 'refunded' else payment_status end
  where id = o.id returning * into o;

  if o.payment_status = 'refunded' then
    if v_belanja > 0 and o.driver_id is not null then
      -- ganti dulu uang belanja yang sudah ditalangi driver, sisanya baru kembali ke pelanggan
      perform wallet_apply(o.driver_id, 'earning', v_belanja, o.id, 'Penggantian belanja pesanan dibatalkan ' || o.code);
      perform wallet_apply(o.customer_id, 'refund', o.total - v_belanja, o.id, 'Refund pembatalan (dikurangi belanja yang sudah dibeli) ' || o.code);
    else
      perform wallet_apply(o.customer_id, 'refund', o.total, o.id, 'Refund pembatalan ' || o.code);
    end if;
  elsif v_belanja > 0 and o.driver_id is not null then
    insert into order_events (order_id, status, actor_id, note)
    values (o.id, 'note', v_uid, 'PERHATIAN: pesanan tunai dibatalkan admin setelah driver membayar belanja Rp' || v_belanja || ' — selesaikan lewat penyesuaian saldo.');
  end if;

  if v_tip > 0 then
    perform wallet_apply(o.customer_id, 'refund', v_tip, o.id, 'Refund tip pesanan dibatalkan ' || o.code);
  end if;

  if o.promo_code is not null then update promos set used_count = greatest(0, used_count - 1) where code = o.promo_code; end if;
  insert into order_events (order_id, status, actor_id, note) values (o.id, 'cancelled', v_uid, p_reason);
  return o;
end $function$;

create or replace function public.merchant_update_order(p_order_id uuid, p_status merchant_order_status)
 returns orders
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare o orders%rowtype; v_tip bigint;
begin
  select * into o from orders where id = p_order_id for update;
  if not found or not owns_merchant(o.merchant_id) then raise exception 'Bukan pesanan merchant Anda'; end if;
  if o.status in ('completed','cancelled') then raise exception 'Order sudah selesai/batal'; end if;
  if not ((o.merchant_status = 'pending' and p_status in ('accepted','rejected')) or (o.merchant_status = 'accepted' and p_status = 'ready')) then
    raise exception 'Transisi % -> % tidak valid', o.merchant_status, p_status;
  end if;
  update orders set merchant_status = p_status where id = o.id returning * into o;
  insert into order_events (order_id, status, actor_id, note) values (o.id, 'merchant_' || p_status::text, auth.uid(), null);
  if p_status = 'rejected' then
    v_tip := coalesce(o.tip, 0);
    update orders set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = 'Merchant menolak pesanan', tip = 0,
      payment_status = case when payment_status = 'paid' then 'refunded' else payment_status end
    where id = o.id returning * into o;
    if o.payment_status = 'refunded' then perform wallet_apply(o.customer_id, 'refund', o.total, o.id, 'Refund ' || o.code); end if;
    if v_tip > 0 then perform wallet_apply(o.customer_id, 'refund', v_tip, o.id, 'Refund tip pesanan ditolak merchant ' || o.code); end if;
    if o.promo_code is not null then update promos set used_count = greatest(0, used_count - 1) where code = o.promo_code; end if;
    insert into order_events (order_id, status, actor_id, note) values (o.id, 'cancelled', auth.uid(), 'Merchant menolak');
  end if;
  return o;
end $function$;

revoke all on function public.cancel_order(uuid, text) from public;
grant execute on function public.cancel_order(uuid, text) to authenticated;
revoke all on function public.merchant_update_order(uuid, merchant_order_status) from public;
grant execute on function public.merchant_update_order(uuid, merchant_order_status) to authenticated;
