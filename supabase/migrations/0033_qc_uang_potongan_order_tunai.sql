-- 0033 — Perbaikan QC uang: potongan platform pada pesanan TUNAI
--
-- Masalah (ditemukan simulasi S40, S41, S42):
--   Rumus lama hanya menagih ke driver: komisi ongkir + biaya jasa aplikasi + (jasa belanja - bagian driver).
--   Padahal pada order tunai driver memegang SELURUH uang pelanggan (orders.total). Akibatnya:
--     * S40  diskon promo pada order tunai dipotong dari pendapatan driver (platform tidak menanggung promonya).
--     * S41  ongkir antar kota (intercity_fare) yang dibayar tunai tidak pernah ditagih; driver menyimpannya,
--            sementara platform tetap membayar mitra travel/gudang dari kasnya sendiri.
--     * S42  pada AntarFood tunai komisi merchant tidak pernah tertagih.
--
-- Perbaikan: potongan = seluruh uang tunai yang dipegang driver
--              dikurangi uang yang ia talangi lebih dulu (belanja AntarShop/AntarMarket, pembayaran ke merchant
--              AntarFood sebesar merchant_earning) dan dikurangi pendapatannya sendiri (di luar tip, karena tip
--              selalu dibayar lewat AntarPay dan dikreditkan terpisah).
--            Hasilnya ekonomi order tunai menjadi persis sama dengan order dompet.
--
-- Catatan operasional: rumus ini mengasumsikan driver membayar merchant AntarFood sebesar merchant_earning
-- (harga menu dikurangi komisi merchant), sama seperti penyelesaian pada order dompet. Bila aplikasi Mitra
-- menyuruh driver membayar harga penuh ke merchant, ubah `o.merchant_earning` menjadi `o.items_subtotal`
-- pada baris v_owed di bawah — angka lain tidak perlu diubah.

create or replace function public.driver_update_order_status(p_order_id uuid, p_status order_status, p_pin text default null)
 returns orders
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare o orders%rowtype; pr pricing%rowtype; v_fee bigint; v_comm bigint; v_owner uuid; v_extra_driver bigint; v_session pricing_sessions; v_bonus bigint := 0; v_pin text; v_owed bigint;
begin
  select * into o from orders where id = p_order_id for update;
  if not found or o.driver_id <> auth.uid() then raise exception 'Bukan order Anda'; end if;
  if not ((o.status = 'accepted' and p_status = 'arrived') or (o.status = 'arrived' and p_status = 'in_progress')
       or (o.status = 'in_progress' and p_status = 'completed')) then
    raise exception 'Transisi status % -> % tidak valid', o.status, p_status;
  end if;
  if p_status = 'in_progress' and o.service = 'food' and o.merchant_status not in ('ready') then
    raise exception 'Tunggu merchant menandai pesanan siap';
  end if;
  if p_status = 'in_progress' then
    select pin into v_pin from order_pins where order_id = o.id;
    if v_pin is not null and (p_pin is null or p_pin <> v_pin) then raise exception 'PIN_REQUIRED'; end if;
  end if;

  update orders set status = p_status,
    arrived_at = case when p_status = 'arrived' then now() else arrived_at end,
    started_at = case when p_status = 'in_progress' then now() else started_at end,
    completed_at = case when p_status = 'completed' then now() else completed_at end,
    payment_status = case when p_status = 'completed' then 'paid' else payment_status end
  where id = o.id returning * into o;
  insert into order_events (order_id, status, actor_id, note) values (o.id, p_status::text, auth.uid(), case when p_status = 'in_progress' and v_pin is not null then 'PIN pelanggan terverifikasi' end);

  if p_status = 'completed' then
    select * into pr from pricing where service = o.service;
    v_comm := o.fare_delivery - o.driver_earning;
    v_extra_driver := o.tip + o.extras_total + o.driver_service_share;
    v_session := current_pricing_session(o.service, o.created_at);
    if v_session.id is not null and v_session.driver_bonus_pct > 0 then
      v_bonus := least(v_comm, floor(o.fare_delivery * v_session.driver_bonus_pct / 100.0));
      v_comm := v_comm - v_bonus;
    end if;
    update orders set driver_earning = driver_earning + v_extra_driver + v_bonus where id = o.id returning * into o;
    if o.payment_method = 'wallet' then
      perform wallet_apply(o.driver_id, 'earning', o.driver_earning, o.id, 'Pendapatan ' || o.code);
      if o.service in ('shop','market') and o.items_subtotal > 0 then
        perform wallet_apply(o.driver_id, 'earning', o.items_subtotal, o.id, 'Penggantian belanja ' || o.code);
      end if;
      if o.merchant_id is not null then
        select owner_id into v_owner from merchants where id = o.merchant_id;
        if v_owner is not null and o.merchant_earning > 0 then
          perform wallet_apply(v_owner, 'earning', o.merchant_earning, o.id, 'Penjualan ' || o.code);
        end if;
      end if;
    else
      -- uang yang ditalangi driver dan tidak boleh ikut disetor ke platform
      v_owed := case when o.service in ('shop','market') then coalesce(o.items_subtotal, 0) else 0 end
              + case when o.service = 'food' then coalesce(o.merchant_earning, 0) else 0 end;
      -- tip tidak pernah dibayar tunai (selalu lewat AntarPay), jadi dikeluarkan dari hak driver atas uang tunai
      v_fee := o.total - v_owed - (o.driver_earning - o.tip);
      if v_fee <> 0 then
        perform wallet_apply(o.driver_id, 'fee', -v_fee, o.id,
          case when v_fee > 0 then 'Potongan platform ' || o.code
               else 'Selisih setoran tunai dikembalikan ' || o.code end);
      end if;
      if o.tip > 0 then perform wallet_apply(o.driver_id, 'earning', o.tip, o.id, 'Tip dari pelanggan ' || o.code); end if;
    end if;
    perform set_config('antaraja.bypass', 'on', true);
    update drivers set total_trips = total_trips + 1 where id = o.driver_id;
    perform set_config('antaraja.bypass', 'off', true);
  end if;
  return o;
end $function$;

revoke all on function public.driver_update_order_status(uuid, order_status, text) from public;
grant execute on function public.driver_update_order_status(uuid, order_status, text) to authenticated;
