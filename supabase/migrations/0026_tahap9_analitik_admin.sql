-- =====================================================================
-- 0026 — Tahap 9: Analitik keuangan bertingkat & tindakan admin
--
-- Isi:
--   1. view `order_economics`  — satu sumber kebenaran perhitungan uang per order
--      (komisi driver, marjin merchant, bagian perusahaan dari jasa belanja, ongkos gateway, promo).
--   2. admin_delete_partner()  — hapus lunak mitra/pengguna (wajib PIN admin + alasan >= 10 huruf).
--   3. admin_contact_thread()  — admin memulai / melanjutkan percakapan tiket dengan pengguna atau mitra.
--   4. admin_finance_cascade() — laporan keuangan bertingkat (layanan <-> kota) + daftar order.
--   5. admin_order_split()     — bagi hasil satu order.
--   6. exec_pnl_data()         — bagian `pnl` (laba rugi) untuk portal eksekutif; `exec_report`
--      sekarang menambahkan `pnl` TANPA mengubah field lama (summary, monthly, by_service, dst).
--
-- Catatan akuntansi (dipakai konsisten di seluruh berkas ini):
--   • driver_base  = tarif antar bagian driver SEBELUM tip/biaya tambahan/jasa belanja.
--     Saat order selesai, `orders.driver_earning` sudah ditambah tip + extras + driver_service_share
--     (lihat 0014 driver_update_order_status), jadi nilai dasarnya direkonstruksi kembali di sini.
--   • revenue (pendapatan kotor platform / "take") =
--       platform_fee + komisi tarif + marjin merchant + bagian perusahaan jasa belanja + marjin antar kota.
--   • revenue_billed (pendapatan yang ditagih ke pelanggan untuk jasa + barang) =
--       fare_delivery + platform_fee + service_fee + intercity_fare + items_subtotal (khusus order merchant).
--   • cogs = payout driver + payout merchant + ongkos gateway + promo/diskon yang ditanggung perusahaan.
--   • net_margin = revenue - promo - gateway = revenue_billed - cogs  (dua jalur, hasil sama).
--   • tip adalah uang titipan pelanggan untuk driver: dilaporkan terpisah, bukan pendapatan & bukan COGS.
-- =====================================================================

-- Kolom alasan status untuk merchant (tabel lain sudah punya `status_reason`)
alter table merchants add column if not exists status_reason text;

-- ---------------------------------------------------------------------
-- 1. View perhitungan uang per order (dipakai internal fungsi security definer; tidak diberi grant)
-- ---------------------------------------------------------------------
drop view if exists order_economics;
create view order_economics as
with b as (
  select o.id, o.code, o.created_at, o.completed_at, o.status, o.service,
         o.city_id, coalesce(nullif(trim(c.name), ''), nullif(trim(o.city), ''), 'Lainnya') as city_name,
         o.customer_id, o.driver_id, o.merchant_id, o.payment_method,
         o.total, o.platform_fee, o.fare_delivery, o.items_subtotal, o.merchant_earning,
         o.discount, o.tip, o.extras_total, o.service_fee, o.driver_service_share,
         o.intercity_fare, o.driver_earning,
         case when o.status = 'completed'
              then greatest(0, o.driver_earning - o.tip - o.extras_total - o.driver_service_share)
              else o.driver_earning end as driver_base,
         coalesce((select sum(p.amount) from payments p
                    where p.order_id = o.id and p.status in ('settlement','capture','paid','success')), 0) as gateway_paid,
         coalesce((select sum(abs(t.amount)) from wallet_transactions t
                    where t.order_id = o.id and t.type = 'refund'), 0) as refund
    from orders o
    left join cities c on c.id = o.city_id
)
select b.*,
  (b.fare_delivery - b.driver_base)::bigint as commission,
  (case when b.merchant_id is not null then b.items_subtotal - b.merchant_earning else 0 end)::bigint as merchant_margin,
  (b.service_fee - b.driver_service_share)::bigint as service_company,
  round(b.intercity_fare * (100 - setting_num('intercity_partner_share_pct', 0)) / 100.0)::bigint as intercity_margin,
  round(b.gateway_paid * setting_num('gateway_fee_pct', 1.5) / 100.0)::bigint as gateway_fee,
  (b.driver_base + b.driver_service_share)::bigint as driver_payout,
  b.merchant_earning::bigint as merchant_payout,
  (b.platform_fee + (b.fare_delivery - b.driver_base)
     + (case when b.merchant_id is not null then b.items_subtotal - b.merchant_earning else 0 end)
     + (b.service_fee - b.driver_service_share)
     + round(b.intercity_fare * (100 - setting_num('intercity_partner_share_pct', 0)) / 100.0))::bigint as revenue,
  (b.fare_delivery + b.platform_fee + b.service_fee
     + round(b.intercity_fare * (100 - setting_num('intercity_partner_share_pct', 0)) / 100.0)
     + (case when b.merchant_id is not null then b.items_subtotal else 0 end))::bigint as revenue_billed
from b;
revoke all on order_economics from public, anon, authenticated;
comment on view order_economics is 'Tahap 9 — perhitungan uang per order (komisi, marjin, gateway, promo). Internal: hanya dipakai fungsi security definer panel admin & portal eksekutif.';

-- ---------------------------------------------------------------------
-- 2. admin_delete_partner — hapus lunak mitra / pengguna
-- ---------------------------------------------------------------------
create or replace function admin_delete_partner(p_kind text, p_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_reason text := trim(coalesce(p_reason, ''));
  v_prev text := coalesce(current_setting('antaraja.bypass', true), 'off');
  v_user uuid;            -- pemilik akun (profiles.id) yang terdampak
  v_label text;           -- nama entitas untuk catatan
  v_active int := 0;
  v_balance bigint := 0;
  v_email text;
begin
  if not is_admin() then raise exception 'Hanya admin'; end if;
  perform admin_require_unlock();
  if p_kind not in ('driver','merchant','vendor','travel','user') then
    raise exception 'Jenis mitra tidak dikenal: % (pilih driver, merchant, vendor, travel, atau user)', p_kind;
  end if;
  if length(v_reason) < 10 then
    raise exception 'Tulis alasan penghapusan minimal 10 huruf (sekarang % huruf)', length(v_reason);
  end if;
  if p_id is null then raise exception 'ID mitra wajib diisi'; end if;

  -- Tentukan pemilik akun & nama entitas
  if p_kind = 'merchant' then
    select m.owner_id, m.name into v_user, v_label from merchants m where m.id = p_id;
    if v_user is null then raise exception 'Merchant tidak ditemukan'; end if;
  elsif p_kind = 'driver' then
    select d.id, p.full_name into v_user, v_label from drivers d join profiles p on p.id = d.id where d.id = p_id;
    if v_user is null then raise exception 'Driver tidak ditemukan'; end if;
  elsif p_kind = 'vendor' then
    select v.id, coalesce(v.stall_name, p.full_name) into v_user, v_label from market_vendors v join profiles p on p.id = v.id where v.id = p_id;
    if v_user is null then raise exception 'Pedagang pasar tidak ditemukan'; end if;
  elsif p_kind = 'travel' then
    select t.id, coalesce(t.company_name, p.full_name) into v_user, v_label from travel_partners t join profiles p on p.id = t.id where t.id = p_id;
    if v_user is null then raise exception 'Mitra travel tidak ditemukan'; end if;
  else
    select p.id, p.full_name into v_user, v_label from profiles p where p.id = p_id;
    if v_user is null then raise exception 'Pengguna tidak ditemukan'; end if;
    if exists (select 1 from profiles where id = p_id and role = 'admin') then
      raise exception 'Akun admin tidak bisa dihapus dari sini. Cabut peran admin lebih dulu.';
    end if;
  end if;

  -- ---- 1) Order / booking aktif ----
  if p_kind = 'driver' then
    select count(*) into v_active from orders o
     where o.driver_id = p_id and o.status in ('scheduled','searching','accepted','arrived','in_progress');
    if v_active > 0 then raise exception 'Driver ini masih punya % pesanan aktif. Selesaikan atau batalkan dulu sebelum menghapus.', v_active; end if;
  elsif p_kind = 'merchant' then
    select count(*) into v_active from orders o
     where o.merchant_id = p_id and o.status in ('scheduled','searching','accepted','arrived','in_progress');
    if v_active > 0 then raise exception 'Merchant ini masih punya % pesanan aktif. Selesaikan atau batalkan dulu sebelum menghapus.', v_active; end if;
  elsif p_kind = 'vendor' then
    select count(*) into v_active from orders o
     where o.status in ('scheduled','searching','accepted','arrived','in_progress')
       and exists (select 1 from jsonb_array_elements(coalesce(o.shopping_list, '[]'::jsonb)) x where x->>'vendor_id' = p_id::text);
    if v_active > 0 then raise exception 'Pedagang ini masih punya % pesanan aktif. Selesaikan atau batalkan dulu sebelum menghapus.', v_active; end if;
  elsif p_kind = 'travel' then
    select (select count(*) from travel_bookings b join travel_trips t on t.id = b.trip_id
             where t.partner_id = p_id and b.status in ('booked','confirmed','picked_up'))
         + (select count(*) from travel_requests r where r.partner_id = p_id and r.status in ('offered','accepted','paid','ongoing'))
      into v_active;
    if v_active > 0 then raise exception 'Mitra travel ini masih punya % booking/permintaan aktif. Selesaikan atau batalkan dulu sebelum menghapus.', v_active; end if;
  else
    select (select count(*) from orders o where o.status in ('scheduled','searching','accepted','arrived','in_progress')
             and (o.customer_id = p_id or o.driver_id = p_id or o.merchant_id in (select id from merchants where owner_id = p_id)))
         + (select count(*) from travel_bookings b where b.customer_id = p_id and b.status in ('booked','confirmed','picked_up'))
         + (select count(*) from travel_requests r where (r.customer_id = p_id or r.partner_id = p_id) and r.status in ('offered','accepted','paid','ongoing'))
      into v_active;
    if v_active > 0 then raise exception 'Akun ini masih punya % pesanan/booking aktif. Selesaikan atau batalkan dulu sebelum menghapus.', v_active; end if;
  end if;

  -- ---- 2) Saldo dompet harus nol ----
  select coalesce(balance, 0) into v_balance from wallets where user_id = v_user;
  v_balance := coalesce(v_balance, 0);
  if v_balance > 0 then
    raise exception 'Saldo AntarPay akun ini masih Rp%. Cairkan atau nolkan saldo dulu sebelum menghapus.',
      replace(to_char(v_balance, 'FM999G999G999'), ',', '.');
  elsif v_balance < 0 then
    raise exception 'Saldo AntarPay akun ini minus Rp%. Tagih pelunasan dulu sebelum menghapus.',
      replace(to_char(abs(v_balance), 'FM999G999G999'), ',', '.');
  end if;

  -- ---- 3) Hapus lunak (lewati guard_* trigger) ----
  perform set_config('antaraja.bypass', 'on', true);
  if p_kind = 'driver' then
    update drivers set is_online = false, status = 'suspended', status_reason = v_reason where id = p_id;
  elsif p_kind = 'merchant' then
    update merchants set is_open = false, status = 'suspended', status_reason = v_reason where id = p_id;
  elsif p_kind = 'vendor' then
    update market_vendors set status = 'suspended', status_reason = v_reason where id = p_id;
  elsif p_kind = 'travel' then
    update travel_partners set status = 'suspended', status_reason = v_reason where id = p_id;
  end if;

  if p_kind = 'user' then
    -- anonimisasi penuh (pola request_account_deletion di 0023)
    select email into v_email from profiles where id = p_id;
    update profiles set
      full_name = 'Pengguna Terhapus', phone = null, email = null, avatar_url = null, push_token = null,
      emergency_contact_name = null, emergency_contact_phone = null,
      is_active = false, status_reason = v_reason,
      deletion_requested_at = coalesce(deletion_requested_at, now()), updated_at = now()
    where id = p_id;
    update drivers set is_online = false, status = 'suspended', status_reason = v_reason where id = p_id and status <> 'suspended';
    update merchants set is_open = false, status = 'suspended', status_reason = v_reason where owner_id = p_id and status <> 'suspended';
    update market_vendors set status = 'suspended', status_reason = v_reason where id = p_id and status <> 'suspended';
    update travel_partners set status = 'suspended', status_reason = v_reason where id = p_id and status <> 'suspended';
  else
    update profiles set is_active = false, status_reason = v_reason, updated_at = now() where id = v_user;
  end if;
  -- pulihkan nilai bypass sebelumnya (bug lama 0022: memaksa 'off' merusak pemanggil bertingkat)
  perform set_config('antaraja.bypass', v_prev, true);

  if p_kind = 'user' then
    begin
      update auth.users set banned_until = 'infinity'::timestamptz where id = p_id;
    exception when others then
      raise notice 'Tidak bisa mengubah auth.users (%): login diblokir lewat is_active saja', sqlerrm;
    end;
  end if;

  -- ---- 4) Catatan ----
  perform log_activity('admin.partner_delete', case p_kind
      when 'driver' then 'drivers' when 'merchant' then 'merchants' when 'vendor' then 'market_vendors'
      when 'travel' then 'travel_partners' else 'profiles' end,
    p_id::text,
    'Hapus lunak ' || p_kind || coalesce(' "' || v_label || '"', '') || ' · alasan: ' || v_reason,
    jsonb_build_object('kind', p_kind, 'id', p_id, 'reason', v_reason, 'user_id', v_user,
                       'email_hash', case when p_kind = 'user' then md5(coalesce(v_email, '')) end));
  insert into security_events (kind, user_id, detail)
  values ('admin.partner_delete', v_user,
          jsonb_build_object('kind', p_kind, 'id', p_id, 'reason', v_reason,
                             'admin_id', auth.uid(),
                             'admin_name', (select full_name from profiles where id = auth.uid())));

  return jsonb_build_object('ok', true, 'kind', p_kind, 'id', p_id, 'reason', v_reason);
end $$;
revoke all on function admin_delete_partner(text, uuid, text) from public, anon;
grant execute on function admin_delete_partner(text, uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 3. admin_contact_thread — admin memulai / melanjutkan percakapan dengan pengguna atau mitra
--    Catatan: `tickets.category` dibatasi CHECK (order, payment, driver, merchant, account, app, safety, other)
--    sehingga percakapan yang dimulai admin memakai kategori 'account' (paling dekat: urusan akun/kemitraan).
-- ---------------------------------------------------------------------
create or replace function admin_contact_thread(p_user uuid, p_subject text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t tickets%rowtype; v_role user_role; v_subject text := nullif(trim(coalesce(p_subject, '')), ''); v_new boolean := false;
begin
  if not is_admin() then raise exception 'Hanya admin'; end if;
  if p_user is null then raise exception 'Pengguna wajib dipilih'; end if;
  if not exists (select 1 from profiles where id = p_user) then raise exception 'Pengguna tidak ditemukan'; end if;

  select * into t from tickets
   where user_id = p_user and category = 'account' and status not in ('resolved','closed')
   order by last_message_at desc limit 1;

  if not found then
    v_role := coalesce((select role from profiles where id = p_user), 'customer');
    insert into tickets (code, user_id, role, category, subject, description, priority, status, assigned_to)
    values ('TK' || to_char(now() at time zone 'Asia/Jakarta', 'YYMMDD') || lpad(nextval('ticket_seq')::text, 4, '0'),
            p_user, v_role, 'account', coalesce(v_subject, 'Pesan dari Admin AntarKita'),
            'Percakapan dimulai oleh admin', 'normal', 'open', auth.uid())
    returning * into t;
    insert into ticket_messages (ticket_id, sender_role, body)
    values (t.id, 'system', 'Admin AntarKita memulai percakapan ini.');
    insert into ticket_messages (ticket_id, sender_id, sender_role, body)
    values (t.id, auth.uid(), 'cs',
            coalesce(v_subject, 'Halo, ini Admin AntarKita. Ada yang ingin kami sampaikan terkait akun Anda.'));
    update tickets set last_message_at = now(), first_response_at = coalesce(first_response_at, now()) where id = t.id;
    insert into notifications (user_id, kind, title, body, data)
    values (p_user, 'system', 'Pesan dari Admin AntarKita',
            coalesce(v_subject, 'Admin mengirim pesan untuk Anda. Buka Bantuan untuk membalas.'),
            jsonb_build_object('ticket_id', t.id, 'code', t.code));
    v_new := true;
    perform log_activity('admin.contact_thread', 'tickets', t.id::text,
      'Admin memulai percakapan dengan pengguna', jsonb_build_object('user_id', p_user, 'subject', v_subject));
  else
    update tickets set assigned_to = coalesce(assigned_to, auth.uid()) where id = t.id;
  end if;

  return jsonb_build_object('ticket_id', t.id, 'code', t.code, 'created', v_new, 'status', t.status);
end $$;
revoke all on function admin_contact_thread(uuid, text) from public, anon;
grant execute on function admin_contact_thread(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 4. admin_finance_cascade — laporan keuangan bertingkat
--    Level 1 (p_key null)  : ringkasan per layanan (p_group='service') atau per kota (p_group='city').
--    Level 2 (p_key diisi) : dimensi lawan (layanan <-> kota) + daftar maksimal 200 order terbaru.
--    Nilai uang dihitung dari order berstatus 'completed'; `orders` menghitung seluruh order pada rentang.
--    Identitas yang selalu berlaku: net_margin = revenue - promo - gateway_fee = revenue_billed - cogs.
-- ---------------------------------------------------------------------
create or replace function admin_finance_cascade(p_from date, p_to date, p_group text, p_key text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb; v_key text := nullif(trim(coalesce(p_key, '')), '');
begin
  if not is_admin() then raise exception 'Hanya admin'; end if;
  if p_group not in ('service','city') then raise exception 'Pengelompokan harus "service" atau "city" (diterima: %)', coalesce(p_group, 'kosong'); end if;
  if p_from is null or p_to is null then raise exception 'Tanggal mulai dan tanggal akhir wajib diisi'; end if;
  if p_to < p_from then raise exception 'Tanggal akhir tidak boleh lebih awal dari tanggal mulai'; end if;
  if p_to - p_from > 400 then raise exception 'Rentang maksimal 400 hari'; end if;

  with e as (
    select * from order_economics
     where (created_at at time zone 'Asia/Jakarta')::date between p_from and p_to
       and (v_key is null
            or (p_group = 'service' and service::text = v_key)
            or (p_group = 'city'    and city_name    = v_key))
  ), g as (
    select case when v_key is null
                then (case when p_group = 'service' then service::text else city_name end)
                else (case when p_group = 'service' then city_name    else service::text end) end as k,
      count(*)::bigint as orders,
      count(*) filter (where status = 'completed')::bigint as completed,
      coalesce(sum(total)          filter (where status = 'completed'), 0)::bigint as gmv,
      coalesce(sum(revenue)        filter (where status = 'completed'), 0)::bigint as revenue,
      coalesce(sum(revenue_billed) filter (where status = 'completed'), 0)::bigint as revenue_billed,
      coalesce(sum(driver_payout)  filter (where status = 'completed'), 0)::bigint as driver_payout,
      coalesce(sum(merchant_payout)filter (where status = 'completed'), 0)::bigint as merchant_payout,
      coalesce(sum(discount)       filter (where status = 'completed'), 0)::bigint as promo,
      coalesce(sum(tip)            filter (where status = 'completed'), 0)::bigint as tip,
      coalesce(sum(gateway_fee)    filter (where status = 'completed'), 0)::bigint as gateway_fee,
      coalesce(sum(refund), 0)::bigint as refund
    from e group by 1
  ), gg as (
    select g.*, (driver_payout + merchant_payout + gateway_fee + promo)::bigint as cogs,
           (revenue - promo - gateway_fee)::bigint as net_margin from g
  ), rws as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'key', k, 'label', k, 'orders', orders, 'completed', completed, 'gmv', gmv,
      'revenue', revenue, 'revenue_billed', revenue_billed,
      'driver_payout', driver_payout, 'merchant_payout', merchant_payout,
      'promo', promo, 'tip', tip, 'refund', refund, 'gateway_fee', gateway_fee,
      'cogs', cogs, 'net_margin', net_margin,
      'margin_pct', case when gmv > 0 then round(100.0 * net_margin / gmv, 1) else 0 end) order by gmv desc, k), '[]'::jsonb) j
    from gg
  ), tot as (
    select jsonb_build_object(
      'orders', count(*)::bigint,
      'completed', count(*) filter (where status = 'completed')::bigint,
      'gmv', coalesce(sum(total) filter (where status = 'completed'), 0)::bigint,
      'revenue', coalesce(sum(revenue) filter (where status = 'completed'), 0)::bigint,
      'revenue_billed', coalesce(sum(revenue_billed) filter (where status = 'completed'), 0)::bigint,
      'driver_payout', coalesce(sum(driver_payout) filter (where status = 'completed'), 0)::bigint,
      'merchant_payout', coalesce(sum(merchant_payout) filter (where status = 'completed'), 0)::bigint,
      'promo', coalesce(sum(discount) filter (where status = 'completed'), 0)::bigint,
      'tip', coalesce(sum(tip) filter (where status = 'completed'), 0)::bigint,
      'refund', coalesce(sum(refund), 0)::bigint,
      'gateway_fee', coalesce(sum(gateway_fee) filter (where status = 'completed'), 0)::bigint,
      'cogs', coalesce(sum(driver_payout + merchant_payout + gateway_fee + discount) filter (where status = 'completed'), 0)::bigint,
      'net_margin', coalesce(sum(revenue - discount - gateway_fee) filter (where status = 'completed'), 0)::bigint,
      'margin_pct', case when coalesce(sum(total) filter (where status = 'completed'), 0) > 0
        then round(100.0 * coalesce(sum(revenue - discount - gateway_fee) filter (where status = 'completed'), 0)
                   / sum(total) filter (where status = 'completed'), 1) else 0 end) j
    from e
  ), ord as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', z.id, 'code', z.code, 'created_at', z.created_at, 'service', z.service::text, 'city', z.city_name,
      'status', z.status::text, 'total', z.total, 'platform_fee', z.platform_fee, 'service_fee', z.service_fee,
      'driver_earning', z.driver_earning, 'merchant_earning', z.merchant_earning, 'discount', z.discount,
      'tip', z.tip, 'payment_method', z.payment_method::text,
      'revenue', z.revenue, 'gateway_fee', z.gateway_fee) order by z.created_at desc), '[]'::jsonb) j
    from (select * from e where v_key is not null order by created_at desc limit 200) z
  )
  select jsonb_build_object('from', p_from, 'to', p_to, 'group', p_group, 'key', v_key,
                            'level', case when v_key is null then 1 else 2 end,
                            'sub_group', case when v_key is null then p_group
                                              when p_group = 'service' then 'city' else 'service' end,
                            'rows', rws.j, 'totals', tot.j, 'orders', ord.j)
    into v from rws, tot, ord;
  return v;
end $$;
revoke all on function admin_finance_cascade(date, date, text, text) from public, anon;
grant execute on function admin_finance_cascade(date, date, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 5. admin_order_split — bagi hasil satu order
-- ---------------------------------------------------------------------
create or replace function admin_order_split(p_order uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare e order_economics%rowtype; v_net bigint; v_gross bigint;
begin
  if not is_admin() then raise exception 'Hanya admin'; end if;
  select * into e from order_economics where id = p_order;
  if not found then raise exception 'Order tidak ditemukan'; end if;
  v_gross := greatest(e.total, 1);                                   -- pembagi persentase (hindari bagi nol)
  v_net := e.revenue - e.discount - e.gateway_fee;
  return jsonb_build_object(
    'id', e.id, 'code', e.code, 'service', e.service::text, 'city', e.city_name, 'status', e.status::text,
    'created_at', e.created_at, 'completed_at', e.completed_at, 'payment_method', e.payment_method::text,
    'gross', e.total,                       -- pendapatan kotor dari pelanggan (nilai order)
    'revenue_billed', e.revenue_billed,     -- jasa + barang yang ditagih ke pelanggan
    'driver', jsonb_build_object('base', e.driver_base, 'service_share', e.driver_service_share,
                                 'tip', e.tip, 'extras', e.extras_total, 'total', e.driver_earning),
    'merchant', jsonb_build_object('earning', e.merchant_earning, 'margin', e.merchant_margin),
    'platform', jsonb_build_object('platform_fee', e.platform_fee, 'commission', e.commission,
                                   'service_company', e.service_company, 'intercity_margin', e.intercity_margin,
                                   'revenue', e.revenue),
    'items_subtotal', e.items_subtotal,
    'promo', e.discount, 'gateway_fee', e.gateway_fee, 'refund', e.refund,
    'cogs', (e.driver_payout + e.merchant_payout + e.gateway_fee + e.discount)::bigint,
    'net_margin', v_net,
    'driver_payout', e.driver_payout, 'merchant_payout', e.merchant_payout,
    'pct', jsonb_build_object(
      'driver', round(100.0 * e.driver_payout / v_gross, 1),
      'merchant', round(100.0 * e.merchant_payout / v_gross, 1),
      'platform', round(100.0 * e.revenue / v_gross, 1),
      'promo', round(100.0 * e.discount / v_gross, 1),
      'gateway', round(100.0 * e.gateway_fee / v_gross, 1),
      'net_margin', round(100.0 * v_net / v_gross, 1)),
    'margin_pct', round(100.0 * v_net / v_gross, 1));
end $$;
revoke all on function admin_order_split(uuid) from public, anon;
grant execute on function admin_order_split(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Portal eksekutif: bagian `pnl` (laba rugi) — TAMBAHAN, tidak mengubah field lama exec_report
--    revenue      = jasa + barang yang ditagih ke pelanggan (fare + platform_fee + service_fee + antar kota + barang merchant)
--    platform_take= bagian perusahaan saja (platform_fee + komisi + jasa perusahaan + marjin merchant + marjin antar kota)
--    cogs         = payout driver + payout merchant + ongkos gateway + promo
--    gross_margin = revenue - cogs  (identik dengan platform_take - promo - gateway)
-- ---------------------------------------------------------------------
create or replace function exec_pnl_data(p_months integer default 6)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_from timestamptz := date_trunc('month', now()) - ((greatest(1, p_months) - 1) || ' months')::interval;
begin
  return (
    with e as (
      select * from order_economics where created_at >= v_from and status = 'completed'
    ), m as (
      select date_trunc('month', created_at) mm,
        count(*)::bigint n,
        coalesce(sum(total), 0)::bigint gmv,
        coalesce(sum(revenue_billed), 0)::bigint revenue,
        coalesce(sum(revenue), 0)::bigint take,
        coalesce(sum(driver_payout), 0)::bigint driver_payout,
        coalesce(sum(merchant_payout), 0)::bigint merchant_payout,
        coalesce(sum(gateway_fee), 0)::bigint gateway_fee,
        coalesce(sum(discount), 0)::bigint promo
      from e group by 1
    ), s as (
      select service::text svc,
        count(*)::bigint n,
        coalesce(sum(total), 0)::bigint gmv,
        coalesce(sum(revenue_billed), 0)::bigint revenue,
        coalesce(sum(revenue), 0)::bigint take,
        coalesce(sum(driver_payout), 0)::bigint driver_payout,
        coalesce(sum(merchant_payout), 0)::bigint merchant_payout,
        coalesce(sum(gateway_fee), 0)::bigint gateway_fee,
        coalesce(sum(discount), 0)::bigint promo
      from e group by 1
    )
    select jsonb_build_object(
      'from', v_from, 'months', greatest(1, p_months),
      'by_month', (select coalesce(jsonb_agg(jsonb_build_object(
          'month', to_char(g.mo, 'YYYY-MM'), 'orders', coalesce(m.n, 0), 'gmv', coalesce(m.gmv, 0),
          'revenue', coalesce(m.revenue, 0), 'platform_take', coalesce(m.take, 0),
          'driver_payout', coalesce(m.driver_payout, 0), 'merchant_payout', coalesce(m.merchant_payout, 0),
          'gateway_fee', coalesce(m.gateway_fee, 0), 'promo', coalesce(m.promo, 0),
          'cogs', coalesce(m.driver_payout + m.merchant_payout + m.gateway_fee + m.promo, 0),
          'gross_margin', coalesce(m.revenue - (m.driver_payout + m.merchant_payout + m.gateway_fee + m.promo), 0),
          'margin_pct', case when coalesce(m.revenue, 0) > 0
            then round(100.0 * (m.revenue - (m.driver_payout + m.merchant_payout + m.gateway_fee + m.promo)) / m.revenue, 1)
            else 0 end) order by g.mo), '[]'::jsonb)
        from generate_series(v_from, date_trunc('month', now()), interval '1 month') g(mo)
        left join m on m.mm = g.mo),
      'by_service', (select coalesce(jsonb_agg(jsonb_build_object(
          'service', svc, 'orders', n, 'gmv', gmv, 'revenue', revenue, 'platform_take', take,
          'driver_payout', driver_payout, 'merchant_payout', merchant_payout,
          'gateway_fee', gateway_fee, 'promo', promo,
          'cogs', driver_payout + merchant_payout + gateway_fee + promo,
          'gross_margin', revenue - (driver_payout + merchant_payout + gateway_fee + promo),
          'margin_pct', case when revenue > 0
            then round(100.0 * (revenue - (driver_payout + merchant_payout + gateway_fee + promo)) / revenue, 1)
            else 0 end) order by gmv desc), '[]'::jsonb) from s),
      'totals', (select jsonb_build_object(
          'orders', coalesce(sum(n), 0)::bigint, 'gmv', coalesce(sum(gmv), 0)::bigint,
          'revenue', coalesce(sum(revenue), 0)::bigint, 'platform_take', coalesce(sum(take), 0)::bigint,
          'driver_payout', coalesce(sum(driver_payout), 0)::bigint,
          'merchant_payout', coalesce(sum(merchant_payout), 0)::bigint,
          'gateway_fee', coalesce(sum(gateway_fee), 0)::bigint, 'promo', coalesce(sum(promo), 0)::bigint,
          'cogs', coalesce(sum(driver_payout + merchant_payout + gateway_fee + promo), 0)::bigint,
          'gross_margin', coalesce(sum(revenue - (driver_payout + merchant_payout + gateway_fee + promo)), 0)::bigint,
          'margin_pct', case when coalesce(sum(revenue), 0) > 0
            then round(100.0 * sum(revenue - (driver_payout + merchant_payout + gateway_fee + promo)) / sum(revenue), 1)
            else 0 end) from s))
  );
end $$;
revoke all on function exec_pnl_data(integer) from public, anon, authenticated;

-- exec_report v3: field lama tetap (summary, monthly, by_service, by_city, supply, quality, fraud, automation,
-- finance, recommendations, level) + tambahan `pnl`.
create or replace function exec_report(p_token text, p_months integer default 6)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s exec_sessions;
begin
  s := exec_valid(p_token);
  if s.token is null then raise exception 'EXEC_SESSION_EXPIRED'; end if;
  return exec_report_data(p_months) || jsonb_build_object('level', s.level, 'pnl', exec_pnl_data(p_months));
end $$;
revoke all on function exec_report(text, integer) from public, anon;
grant execute on function exec_report(text, integer) to authenticated;
