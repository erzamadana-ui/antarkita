-- =====================================================================
-- 0083 — IDEMPOTENSI create_order (ketuk ganda / koneksi putus saat submit)
--
-- Temuan QC (simulasi S48c, Standar Testing §6.2 & E2E-07): dua panggilan
-- create_order berturut-turut membuat DUA pesanan dan DUA pemotongan dompet.
-- Tidak ada uang yang hilang, tetapi pelanggan harus membatalkan pesanan kembar
-- sendiri untuk mendapat refund — melanggar syarat "panggilan ulang tidak
-- membuat order/biaya ganda".
--
-- Dua lapis perlindungan:
--   1. KUNCI PERMINTAAN KLIEN  p->>'client_request_id' (UUID dibuat aplikasi per
--      percobaan pesan). Permintaan ulang dengan kunci sama → pesanan yang sama
--      dikembalikan, tanpa potongan kedua. Unik per pelanggan (indeks parsial).
--   2. PENJAGA KETUK GANDA tanpa kunci (build lama): pesanan identik (layanan,
--      titik jemput & tujuan sama, dibuat < 15 detik lalu, masih menunggu)
--      dikembalikan apa adanya, bukan dibuat ulang.
--
-- Cara pasang: pola pg_get_functiondef + sisip di jangkar (seperti 0021/0080)
-- supaya tidak menyalin ulang definisi create_order. Nilai kunci diteruskan ke
-- INSERT lewat set_config transaksi + trigger BEFORE INSERT (tanpa mengubah
-- pernyataan insert di dalam fungsi).
-- =====================================================================

alter table orders add column if not exists client_request_id text;
create unique index if not exists orders_client_request_uidx
  on orders (customer_id, client_request_id) where client_request_id is not null;
comment on column orders.client_request_id is
  'Kunci idempotensi dari aplikasi (UUID per percobaan pesan). Sama → create_order mengembalikan pesanan yang sudah ada.';

create or replace function trg_orders_client_request_id()
returns trigger language plpgsql as $$
begin
  if new.client_request_id is null then
    new.client_request_id := nullif(current_setting('antaraja.client_request_id', true), '');
  end if;
  return new;
end $$;
drop trigger if exists t_orders_client_request_id on orders;
create trigger t_orders_client_request_id before insert on orders
  for each row execute function trg_orders_client_request_id();

do $$
declare
  def text;
  anchor constant text := $a$  if v_pick_lat is null then raise exception 'Lokasi jemput tidak lengkap'; end if;$a$;
  guard  constant text := $g$
  -- Idempotensi (0083): kunci permintaan klien + penjaga ketuk ganda.
  declare v_req text := nullif(btrim(p->>'client_request_id'), ''); v_dup orders%rowtype;
  begin
    if v_req is not null then
      if length(v_req) > 80 then raise exception 'client_request_id terlalu panjang'; end if;
      select * into v_dup from orders where customer_id = v_uid and client_request_id = v_req limit 1;
      if found then return v_dup; end if;
      perform set_config('antaraja.client_request_id', v_req, true);
    else
      perform set_config('antaraja.client_request_id', '', true);
      select * into v_dup from orders o
       where o.customer_id = v_uid and o.service = v_service
         and o.client_request_id is null              -- klien berkunci menyatakan niatnya lewat kunci, bukan heuristik
         and o.status in ('searching', 'scheduled')
         and o.created_at > now() - interval '15 seconds'
         and st_dwithin(o.pickup_location, st_setsrid(st_makepoint(v_pick_lng, v_pick_lat), 4326)::geography, 5)
         and (v_drop_lat is null or st_dwithin(o.dropoff_location, st_setsrid(st_makepoint(v_drop_lng, v_drop_lat), 4326)::geography, 5))
       order by o.created_at desc limit 1;
      if found then return v_dup; end if;
    end if;
  end;
$g$;
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_order';
  if def is null then raise exception 'create_order tidak ditemukan'; end if;
  if position('client_request_id' in def) > 0 then
    raise notice 'Idempotensi sudah terpasang di create_order — dilewati';
    return;
  end if;
  if position(anchor in def) = 0 then
    raise exception 'Jangkar idempotensi tidak ditemukan di create_order — penjaga TIDAK terpasang';
  end if;
  execute replace(def, anchor, anchor || guard);
end $$;

do $$
declare def text;
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_order';
  if position('client_request_id' in def) = 0 then
    raise exception 'create_order tidak memuat penjaga idempotensi — gagal dipasang';
  end if;
end $$;

comment on function create_order(jsonb) is
  'Membuat pesanan untuk semua layanan (ride/car/food/send/box/shop/market). '
  'Sejak 0080 pesanan DITOLAK bila titik jemput berada di kota yang layanannya belum dibuka. '
  'Sejak 0083 idempoten: p.client_request_id yang sama mengembalikan pesanan yang sudah ada; tanpa kunci, pesanan identik dalam 15 detik dianggap ketuk ganda.';
