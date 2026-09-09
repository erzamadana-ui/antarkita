-- 0036 — Perbaikan QC uang: bagi hasil titipan AntarSend antar kota lewat mitra travel yang dibayar TUNAI
--
-- Masalah (ditemukan simulasi S50g dan invarian global S53e):
--   travel_complete_send selalu MENGKREDIT mitra travel sebesar 80% ongkir antar kota, tanpa memedulikan
--   metode pembayaran. Pada titipan yang dibayar tunai, mitra travel sudah menerima seluruh uang tunai
--   pelanggan (orders.total) di lapangan — lalu platform masih menambah 80% ongkir antar kota dari kasnya.
--   Akibatnya platform membayar tanpa pernah menerima apa pun (uang tercipta dari sisi mitra).
--
-- Perbaikan: pada pembayaran tunai, mitra travel DITAGIH selisih antara uang tunai yang ia pegang dan haknya,
-- sehingga ekonomi titipan tunai persis sama dengan titipan yang dibayar lewat AntarPay.

create or replace function public.travel_complete_send(p_order uuid)
 returns orders
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare o orders%rowtype; v_earn bigint; v_setor bigint;
begin
  select * into o from orders where id = p_order and travel_partner_id = auth.uid() for update;
  if not found then raise exception 'Titipan bukan milik Anda'; end if;
  if o.status <> 'in_progress' then raise exception 'Titipan belum dijemput'; end if;
  v_earn := round(coalesce(o.intercity_fare,0) * setting_num('travel_send_partner_pct', 80) / 100.0)::bigint;
  update orders set status = 'completed', completed_at = now(), updated_at = now(),
    payment_status = case when o.payment_method = 'cash' then 'paid'::payment_status else o.payment_status end
  where id = p_order returning * into o;
  insert into order_events(order_id, status, note) values (p_order, 'completed', 'Titipan diterima di kota tujuan');
  if o.payment_method = 'cash' then
    -- mitra memegang seluruh uang tunai pelanggan; yang boleh disimpan hanya bagiannya
    v_setor := coalesce(o.total, 0) - v_earn;
    if v_setor <> 0 then
      perform wallet_apply(o.travel_partner_id, 'fee', -v_setor, o.id,
        case when v_setor > 0 then 'Setoran platform titipan antar kota ' || o.code
             else 'Selisih setoran tunai dikembalikan ' || o.code end);
    end if;
  else
    if v_earn > 0 then perform wallet_apply(o.travel_partner_id, 'earning', v_earn, o.id, 'Pendapatan titipan antar kota ' || o.code); end if;
  end if;
  insert into notifications (user_id, kind, title, body, data) values (o.customer_id, 'order', 'Titipan sudah sampai', 'Paket ' || o.code || ' sudah diterima di kota tujuan.', jsonb_build_object('order_id', o.id));
  return o;
end $function$;

revoke all on function public.travel_complete_send(uuid) from public;
grant execute on function public.travel_complete_send(uuid) to authenticated;
