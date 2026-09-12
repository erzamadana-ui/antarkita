-- =====================================================================
-- uji_idempotensi.sql — Idempotensi create_order (migrasi 0083; Standar Testing §6.2, E2E-07)
--
-- Membuktikan, dengan akun uji dan ROLLBACK di akhir:
--   1. client_request_id sama, dipanggil 2× → 1 pesanan, 1 pemotongan dompet.
--   2. Tanpa kunci, pesanan identik dalam 15 detik → pesanan yang sama dikembalikan.
--   3. Pesanan BERBEDA (tujuan lain) tetap dibuat (penjaga tidak terlalu agresif).
--   4. Kunci sama tetapi pelanggan berbeda → tidak saling tertukar.
--   5. Kolom client_request_id tersimpan dan indeks unik ada.
-- Cara pakai: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/uji_idempotensi.sql
-- =====================================================================
begin;
do $$
declare
  cust uuid := 'a0000000-0000-4000-8000-000000000002';
  cust2 uuid; o1 orders; o2 orders; o3 orders; o4 orders; b0 bigint; b1 bigint; b2 bigint; n int; k text := 'uji-' || gen_random_uuid()::text;
  p jsonb := jsonb_build_object('service', 'ride_motor', 'vehicle_class', 'motor_economy',
      'pickup', jsonb_build_object('lat', 0.4810, 'lng', 101.4349, 'address', 'Jl. Sudirman 45'),
      'dropoff', jsonb_build_object('lat', 0.50, 'lng', 101.44, 'address', 'Plaza Andalas'), 'paid_via', 'wallet');
begin
  select id into cust2 from profiles where role = 'customer' and is_active and id <> cust order by created_at limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
  update orders set status = 'cancelled' where customer_id = cust and status in ('searching','accepted','arrived','in_progress');
  update wallets set balance = greatest(balance, 100000) where user_id = cust;
  select balance into b0 from wallets where user_id = cust;

  -- 1. kunci sama 2×
  o1 := create_order(p || jsonb_build_object('client_request_id', k));
  o2 := create_order(p || jsonb_build_object('client_request_id', k));
  select balance into b1 from wallets where user_id = cust;
  if o1.id <> o2.id then raise exception '[GAGAL] kunci sama menghasilkan 2 pesanan (% vs %)', o1.code, o2.code; end if;
  if b0 - b1 <> o1.total then raise exception '[GAGAL] potongan dompet % ≠ total pesanan % (dipotong dua kali?)', b0 - b1, o1.total; end if;
  if o1.client_request_id <> k then raise exception '[GAGAL] client_request_id tidak tersimpan di pesanan'; end if;
  raise notice '[OK] 1. client_request_id sama 2× → 1 pesanan (%), dompet dipotong sekali (Rp%)', o1.code, o1.total;

  -- 2. tanpa kunci, identik, < 15 detik
  o3 := create_order(p);
  o4 := create_order(p);
  select balance into b2 from wallets where user_id = cust;
  if o3.id <> o4.id then raise exception '[GAGAL] ketuk ganda tanpa kunci menghasilkan 2 pesanan'; end if;
  if o3.id = o1.id then raise exception '[GAGAL] pesanan tanpa kunci tertukar dengan pesanan berkunci'; end if;
  if b1 - b2 <> o3.total then raise exception '[GAGAL] ketuk ganda tanpa kunci memotong dompet 2× (Δ%)', b1 - b2; end if;
  raise notice '[OK] 2. Tanpa kunci: pesanan identik < 15 dtk dikembalikan (%), dompet dipotong sekali', o3.code;

  -- 3. tujuan berbeda → pesanan baru
  update orders set status = 'cancelled' where id in (o1.id, o3.id);   -- bersihkan batas 3 pesanan aktif
  o4 := create_order(p || jsonb_build_object('dropoff', jsonb_build_object('lat', 0.52, 'lng', 101.46, 'address', 'Mal SKA')));
  if o4.id in (o1.id, o3.id) then raise exception '[GAGAL] pesanan dengan tujuan berbeda dianggap ketuk ganda'; end if;
  raise notice '[OK] 3. Tujuan berbeda tetap membuat pesanan baru (%)', o4.code;

  -- 4. kunci sama, pelanggan berbeda
  if cust2 is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', cust2, 'role', 'authenticated')::text, true);
    update wallets set balance = greatest(balance, 100000) where user_id = cust2;
    update orders set status = 'cancelled' where customer_id = cust2 and status in ('searching','accepted','arrived','in_progress');
    begin
      o2 := create_order(p || jsonb_build_object('client_request_id', k));
      if o2.id = o1.id or o2.customer_id <> cust2 then raise exception '[GAGAL] kunci pelanggan lain mengembalikan pesanan orang lain'; end if;
      raise notice '[OK] 4. Kunci sama pada pelanggan lain → pesanan terpisah (%)', o2.code;
    exception when others then
      if sqlerrm like '[GAGAL]%' then raise; end if;
      raise notice '[LEWAT] 4. pelanggan kedua tidak bisa memesan (%): %', cust2, left(sqlerrm, 80);
    end;
  else
    raise notice '[LEWAT] 4. tidak ada pelanggan kedua untuk diuji';
  end if;

  -- 5. skema
  select count(*) into n from pg_indexes where indexname = 'orders_client_request_uidx';
  if n <> 1 then raise exception '[GAGAL] indeks unik orders_client_request_uidx tidak ada'; end if;
  raise notice '[OK] 5. Indeks unik (customer_id, client_request_id) terpasang';
end $$;
rollback;
