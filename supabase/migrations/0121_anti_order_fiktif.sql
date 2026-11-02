-- =====================================================================
-- 0121 — Anti order fiktif (keputusan GM 31 Okt 2026 no. 1) — lihat docs/KONTRAK-31OKT.md §0121
--   • Setelan [ASUMSI semua, dapat diubah admin]: antifraud_new_account_hours 24, antifraud_new_account_cash_max 100.000,
--     antifraud_orders_per_hour_max 3, antifraud_active_orders_max 3 (= batas lama yang sudah hard-coded 'Maksimal 3 pesanan aktif';
--     kontrak menulis 2 — dipertahankan 3 agar uji_idempotensi/uji_kota yang menahan 3 pesanan aktif tetap valid),
--     antifraud_noshow_strike_cash_block 2, antifraud_noshow_strike_suspend 3, antifraud_phone_required true,
--     antifraud_noshow_wait_minutes 5 (driver harus sudah 'arrived' ≥ N menit sebelum boleh melaporkan no-show),
--     antifraud_noshow_fee 0 (biaya batal no-show ke driver; 0 = tidak ada), antifraud_cash_block_days 30.
--   • Tabel customer_strikes + kolom profiles.cash_blocked_until, profiles.strike_count.
--   • Guard create_order lewat antifraud_precheck_order() (telepon, cash_blocked, order/jam) sebelum insert dan
--     antifraud_check_cash_cap() (akun baru → tunai maks) setelah total diketahui. Batas pesanan aktif dibaca dari setelan.
--     Telepon "terverifikasi" = auth.users.phone_confirmed_at terisi ATAU profiles.phone ≥ 9 digit (aplikasi belum punya OTP SMS —
--     kolom phone_verified_at TIDAK dibuat; catat sebagai celah: verifikasi OTP menyusul di sisi auth).
--   • driver_report_no_show(p_order, p_evidence_url, p_note): order 'arrived' → cancelled (cancel_reason 'no_show'), refund saldo
--     dikurangi biaya no-show (bila disetel) yang masuk ke driver, strike +1, fraud_flag 'customer_no_show';
--     strike ≥ cash_block → cash_blocked_until = now()+30 hari (tunai ditolak, AntarVoucher/saldo boleh);
--     strike ≥ suspend → profiles.is_active=false + fraud_flag 'customer_auto_suspend' (high).
--   • Admin: admin_antifraud_summary(), admin_customer_strikes(p_status), admin_customer_strike_clear(p_customer, p_note).
--   • Pelanggan: my_antifraud_status().
--   Guard travel_book/travel_request_create TIDAK ditambal di sini (fungsi milik 0124) — pemilik 0124 cukup memanggil
--   antifraud_precheck_order(auth.uid(), paid_via) dan antifraud_check_cash_cap(auth.uid(), paid_via, total).
-- Idempoten. Rollback: supabase/rollback/0121_down.sql
-- =====================================================================
do $$
declare s text;
begin
  foreach s in array array[
    -- diubah
    'public.create_order(jsonb,uuid)', 'public.app_setting_specs()',
    -- baru
    'public.antifraud_phone_ok(uuid)', 'public.antifraud_limits()', 'public.antifraud_precheck_order(uuid,text)',
    'public.antifraud_check_cash_cap(uuid,text,bigint)', 'public.antifraud_apply_strike(uuid,uuid,text,text,text,uuid)',
    'public.driver_report_no_show(uuid,text,text)', 'public.admin_antifraud_summary()', 'public.admin_customer_strikes(text)',
    'public.admin_customer_strike_clear(uuid,text)', 'public.my_antifraud_status()'] loop
    perform _mig_backup('0121', s);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 1. Setelan
-- ---------------------------------------------------------------------
insert into app_settings (key, value) values
  ('antifraud_new_account_hours',          '24'::jsonb),
  ('antifraud_new_account_cash_max',       '100000'::jsonb),
  ('antifraud_orders_per_hour_max',        '3'::jsonb),
  ('antifraud_active_orders_max',          '3'::jsonb),
  ('antifraud_noshow_strike_cash_block',   '2'::jsonb),
  ('antifraud_noshow_strike_suspend',      '3'::jsonb),
  ('antifraud_phone_required',             'true'::jsonb),
  ('antifraud_noshow_wait_minutes',        '5'::jsonb),
  ('antifraud_noshow_fee',                 '0'::jsonb),
  ('antifraud_cash_block_days',            '30'::jsonb)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 2. Tabel strike + kolom profil
-- ---------------------------------------------------------------------
alter table public.profiles add column if not exists cash_blocked_until timestamptz;
alter table public.profiles add column if not exists strike_count int not null default 0;
comment on column public.profiles.cash_blocked_until is '0121: sampai kapan pelanggan hanya boleh bayar non-tunai (strike no-show).';
comment on column public.profiles.strike_count is '0121: jumlah strike aktif (belum dibersihkan admin).';

create table if not exists public.customer_strikes (
  id            uuid primary key default gen_random_uuid(),
  customer_id   uuid not null references public.profiles(id) on delete cascade,
  order_id      uuid references public.orders(id) on delete set null,
  kind          text not null check (kind in ('no_show', 'fake_address', 'cancel_abuse')),
  evidence_url  text,
  note          text,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  cleared_at    timestamptz,
  cleared_by    uuid,
  cleared_note  text
);
create index if not exists customer_strikes_customer_idx on public.customer_strikes (customer_id, created_at desc);
create index if not exists customer_strikes_active_idx on public.customer_strikes (customer_id) where cleared_at is null;
create unique index if not exists customer_strikes_order_kind_ux on public.customer_strikes (order_id, kind) where order_id is not null;
comment on table public.customer_strikes is '0121: strike pelanggan (no-show/alamat palsu/cancel abuse) — dasar cash_blocked & suspend otomatis.';
alter table public.customer_strikes enable row level security;
drop policy if exists customer_strikes_own on public.customer_strikes;
create policy customer_strikes_own on public.customer_strikes for select to authenticated using (customer_id = auth.uid() or admin_has('orders_view'));
revoke all on public.customer_strikes from public, anon, authenticated;
grant select on public.customer_strikes to authenticated;
grant all on public.customer_strikes to service_role;

-- ---------------------------------------------------------------------
-- 3. Pembantu: batas, telepon, pra-cek, batas tunai akun baru
-- ---------------------------------------------------------------------
create or replace function public.antifraud_limits()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'new_account_hours',     setting_num('antifraud_new_account_hours', 24),
    'new_account_cash_max',  setting_num('antifraud_new_account_cash_max', 100000)::bigint,
    'orders_per_hour_max',   setting_num('antifraud_orders_per_hour_max', 3)::int,
    'active_orders_max',     setting_num('antifraud_active_orders_max', 3)::int,
    'strike_cash_block',     setting_num('antifraud_noshow_strike_cash_block', 2)::int,
    'strike_suspend',        setting_num('antifraud_noshow_strike_suspend', 3)::int,
    'phone_required',        setting_flag('antifraud_phone_required', true),
    'noshow_wait_minutes',   setting_num('antifraud_noshow_wait_minutes', 5),
    'noshow_fee',            setting_num('antifraud_noshow_fee', 0)::bigint,
    'cash_block_days',       setting_num('antifraud_cash_block_days', 30)::int);
$$;
revoke all on function public.antifraud_limits() from public, anon;
grant execute on function public.antifraud_limits() to authenticated;

-- telepon dianggap terverifikasi bila auth.users.phone_confirmed_at terisi ATAU profiles.phone berisi ≥ 9 digit
create or replace function public.antifraud_phone_ok(p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select u.phone_confirmed_at is not null from auth.users u where u.id = p_uid), false)
      or coalesce((select length(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g')) >= 9 from profiles p where p.id = p_uid), false);
$$;
revoke all on function public.antifraud_phone_ok(uuid) from public, anon, authenticated;
grant execute on function public.antifraud_phone_ok(uuid) to service_role;

-- dipanggil SEBELUM insert pesanan (create_order; travel/shop bila terpisah)
create or replace function public.antifraud_precheck_order(p_uid uuid, p_paid_via text)
returns void language plpgsql security definer set search_path = public as $$
declare l jsonb := antifraud_limits(); p profiles%rowtype; v_n int;
begin
  if p_uid is null then return; end if;
  select * into p from profiles where id = p_uid;
  if not found then return; end if;
  if (l->>'phone_required')::boolean and not antifraud_phone_ok(p_uid) then
    raise exception 'PHONE_REQUIRED: lengkapi nomor telepon di profil sebelum memesan.';
  end if;
  if coalesce(p_paid_via, 'cash') = 'cash' and p.cash_blocked_until is not null and p.cash_blocked_until > now() then
    raise exception 'CASH_BLOCKED: pembayaran tunai dinonaktifkan untuk akun Anda sampai % karena % laporan tidak hadir (no-show). Gunakan saldo AntarVoucher.',
      to_char(p.cash_blocked_until at time zone 'Asia/Jakarta', 'DD Mon YYYY'), p.strike_count;
  end if;
  select count(*) into v_n from orders where customer_id = p_uid and created_at > now() - interval '1 hour';
  if v_n >= (l->>'orders_per_hour_max')::int then
    raise exception 'ORDER_RATE: maksimal % pesanan per jam. Coba lagi beberapa saat.', (l->>'orders_per_hour_max')::int;
  end if;
end $$;
revoke all on function public.antifraud_precheck_order(uuid, text) from public, anon, authenticated;
grant execute on function public.antifraud_precheck_order(uuid, text) to service_role;

-- dipanggil SETELAH total diketahui: akun < N jam → tunai maksimal Rp X
create or replace function public.antifraud_check_cash_cap(p_uid uuid, p_paid_via text, p_total bigint)
returns void language plpgsql security definer set search_path = public as $$
declare l jsonb := antifraud_limits(); v_created timestamptz; v_hours numeric;
begin
  if p_uid is null or coalesce(p_paid_via, 'cash') <> 'cash' then return; end if;
  v_hours := (l->>'new_account_hours')::numeric;
  if v_hours <= 0 then return; end if;
  select created_at into v_created from profiles where id = p_uid;
  if v_created is not null and v_created > now() - (v_hours || ' hours')::interval and coalesce(p_total, 0) > (l->>'new_account_cash_max')::bigint then
    raise exception 'NEW_ACCOUNT_CASH_CAP: akun baru (< % jam) hanya bisa bayar tunai maksimal Rp%. Gunakan saldo AntarVoucher untuk pesanan ini.',
      v_hours, replace(to_char((l->>'new_account_cash_max')::bigint, 'FM999,999,999,999'), ',', '.');
  end if;
end $$;
revoke all on function public.antifraud_check_cash_cap(uuid, text, bigint) from public, anon, authenticated;
grant execute on function public.antifraud_check_cash_cap(uuid, text, bigint) to service_role;

-- ---------------------------------------------------------------------
-- 4. Strike + eskalasi otomatis
-- ---------------------------------------------------------------------
create or replace function public.antifraud_apply_strike(p_customer uuid, p_order uuid, p_kind text, p_evidence_url text, p_note text, p_by uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l jsonb := antifraud_limits(); s customer_strikes; v_n int; v_action text := 'strike'; v_until timestamptz; v_days int := (l->>'cash_block_days')::int;
begin
  insert into customer_strikes (customer_id, order_id, kind, evidence_url, note, created_by)
  values (p_customer, p_order, p_kind, p_evidence_url, p_note, p_by)
  on conflict (order_id, kind) where order_id is not null do update set note = coalesce(excluded.note, customer_strikes.note)
  returning * into s;
  select count(*) into v_n from customer_strikes where customer_id = p_customer and cleared_at is null;
  perform set_config('antaraja.bypass', 'on', true);
  update profiles set strike_count = v_n where id = p_customer;
  if v_n >= (l->>'strike_cash_block')::int then
    v_until := now() + (v_days || ' days')::interval;
    update profiles set cash_blocked_until = greatest(coalesce(cash_blocked_until, v_until), v_until) where id = p_customer returning cash_blocked_until into v_until;
    v_action := 'cash_blocked';
  end if;
  if v_n >= (l->>'strike_suspend')::int then
    update profiles set is_active = false, status_reason = 'Ditangguhkan otomatis: ' || v_n || ' strike (' || p_kind || '). Hubungi CS.' where id = p_customer and is_active;
    v_action := 'suspended';
  end if;
  perform set_config('antaraja.bypass', 'off', true);
  perform fraud_flag('customer_' || p_kind, case when v_action = 'suspended' then 'high' when v_action = 'cash_blocked' then 'med' else 'low' end,
    p_customer, p_order, jsonb_build_object('strike_id', s.id, 'strikes', v_n, 'action', v_action, 'evidence_url', p_evidence_url, 'note', p_note), false);
  if v_action = 'suspended' then
    perform fraud_flag('customer_auto_suspend', 'high', p_customer, p_order, jsonb_build_object('strikes', v_n, 'kind', p_kind), false);
    insert into security_events (kind, user_id, detail) values ('antifraud.customer_suspend', p_customer, jsonb_build_object('strikes', v_n, 'order_id', p_order, 'kind', p_kind));
    insert into notifications (user_id, kind, title, body, data) values (p_customer, 'system', 'Akun dinonaktifkan sementara',
      'Akun Anda dinonaktifkan karena ' || v_n || ' laporan tidak hadir/penyalahgunaan pesanan. Hubungi CS untuk peninjauan.', jsonb_build_object('kind', 'antifraud_suspend', 'strikes', v_n));
  elsif v_action = 'cash_blocked' then
    insert into notifications (user_id, kind, title, body, data) values (p_customer, 'system', 'Pembayaran tunai dinonaktifkan',
      'Karena ' || v_n || ' laporan tidak hadir, pembayaran tunai dinonaktifkan sampai ' || to_char(v_until at time zone 'Asia/Jakarta', 'DD Mon YYYY') || '. Anda tetap bisa memesan dengan saldo AntarVoucher.',
      jsonb_build_object('kind', 'antifraud_cash_blocked', 'strikes', v_n, 'cash_blocked_until', v_until));
  else
    insert into notifications (user_id, kind, title, body, data) values (p_customer, 'system', 'Peringatan: laporan tidak hadir',
      'Driver melaporkan Anda tidak hadir di titik jemput. Strike ' || v_n || '/' || (l->>'strike_cash_block') || ' — pada strike berikutnya pembayaran tunai akan dinonaktifkan.',
      jsonb_build_object('kind', 'antifraud_strike', 'strikes', v_n));
  end if;
  perform log_activity('antifraud.strike', 'profiles', p_customer::text, 'Strike ' || p_kind || ' #' || v_n || ' → ' || v_action, jsonb_build_object('order_id', p_order, 'strike_id', s.id, 'action', v_action));
  return jsonb_build_object('strike_id', s.id, 'strikes', v_n, 'action', v_action, 'cash_blocked_until', v_until);
end $$;
revoke all on function public.antifraud_apply_strike(uuid, uuid, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.antifraud_apply_strike(uuid, uuid, text, text, text, uuid) to service_role;

-- ---------------------------------------------------------------------
-- 5. Driver melaporkan pelanggan tidak hadir
-- ---------------------------------------------------------------------
create or replace function public.driver_report_no_show(p_order uuid, p_evidence_url text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); o orders%rowtype; l jsonb := antifraud_limits(); v_wait numeric := (l->>'noshow_wait_minutes')::numeric;
        v_fee bigint := (l->>'noshow_fee')::bigint; v_fee_taken bigint := 0; v_refund bigint := 0; v_tip bigint; v_bal bigint; r jsonb;
begin
  if v_uid is null then raise exception 'Harus login'; end if;
  select * into o from orders where id = p_order for update;
  if not found then raise exception 'Order tidak ditemukan'; end if;
  if o.driver_id is distinct from v_uid then raise exception 'Bukan order Anda'; end if;
  if o.status <> 'arrived' then raise exception 'Laporan tidak hadir hanya bisa dibuat setelah Anda tiba di titik jemput (status arrived)'; end if;
  if o.arrived_at is null or o.arrived_at > now() - (v_wait || ' minutes')::interval then
    raise exception 'NOSHOW_WAIT: tunggu minimal % menit di titik jemput sebelum melaporkan pelanggan tidak hadir', v_wait;
  end if;
  if o.service in ('shop', 'market') and (o.actual_items is not null or o.receipt_url is not null) then
    raise exception 'Belanja sudah dibayar di toko — pesanan tidak bisa dibatalkan sebagai no-show, hubungi CS';
  end if;
  v_tip := coalesce(o.tip, 0);
  update orders set status = 'cancelled', cancelled_at = now(), cancelled_by = v_uid, cancel_reason = 'no_show', tip = 0,
    payment_status = case when payment_status = 'paid' and not refund_via_request(o) then 'refunded' else payment_status end
  where id = o.id returning * into o;
  if refund_via_request(o) then perform refund_auto_on_cancel(o.id, v_uid, 'pelanggan tidak hadir (no-show)'); end if;
  if order_payment_pending(o) then
    update payments set status = 'cancel', updated_at = now() where order_id = o.id and purpose = 'order' and status = 'pending';
  end if;
  if o.payment_status = 'refunded' then
    v_fee_taken := least(greatest(v_fee, 0), o.total);
    v_refund := o.total - v_fee_taken;
    if v_refund > 0 then perform wallet_apply(o.customer_id, 'refund', v_refund, o.id, 'Refund pesanan dibatalkan (no-show) ' || o.code); end if;
    perform refund_record_wallet(o.id, v_uid, v_refund, 'pelanggan tidak hadir (no-show)');
  elsif o.payment_method = 'cash' and v_fee > 0 then
    -- tunai: biaya no-show ditarik dari saldo pelanggan hanya bila saldonya cukup (tidak boleh membuat saldo pelanggan minus)
    select balance into v_bal from wallets where user_id = o.customer_id;
    if coalesce(v_bal, 0) >= v_fee then
      v_fee_taken := v_fee;
      perform wallet_apply(o.customer_id, 'fee', -v_fee, o.id, 'Biaya tidak hadir (no-show) ' || o.code);
    end if;
  end if;
  if v_fee_taken > 0 then perform wallet_apply(v_uid, 'earning', v_fee_taken, o.id, 'Kompensasi no-show ' || o.code); end if;
  if v_tip > 0 then perform wallet_apply(o.customer_id, 'refund', v_tip, o.id, 'Refund tip pesanan dibatalkan ' || o.code); end if;
  if o.promo_code is not null then update promos set used_count = greatest(0, used_count - 1) where code = o.promo_code; end if;
  perform ledger_post(o.id, case when o.payment_status = 'refunded' then 'refunded' else 'cancelled' end,
    jsonb_build_object('refund', v_refund, 'reimburse', 0, 'tip_refund', v_tip, 'noshow_fee', v_fee_taken));
  insert into order_events (order_id, status, actor_id, note) values (o.id, 'cancelled', v_uid,
    'Pelanggan tidak hadir di titik jemput (no-show)' || coalesce(': ' || nullif(btrim(p_note), ''), '') || case when v_fee_taken > 0 then ' · biaya Rp' || v_fee_taken || ' ke driver' else '' end);
  r := antifraud_apply_strike(o.customer_id, o.id, 'no_show', nullif(btrim(p_evidence_url), ''), nullif(btrim(p_note), ''), v_uid);
  return jsonb_build_object('ok', true, 'order_id', o.id, 'code', o.code, 'status', o.status, 'refund', v_refund, 'noshow_fee', v_fee_taken,
    'strikes', r->'strikes', 'action', r->'action', 'cash_blocked_until', r->'cash_blocked_until');
end $$;
revoke all on function public.driver_report_no_show(uuid, text, text) from public, anon;
grant execute on function public.driver_report_no_show(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Admin & pelanggan
-- ---------------------------------------------------------------------
create or replace function public.admin_antifraud_summary()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform admin_require('orders_view');
  return jsonb_build_object(
    'strikes_7d',   (select count(*) from customer_strikes where created_at > now() - interval '7 days'),
    'strikes_30d',  (select count(*) from customer_strikes where created_at > now() - interval '30 days'),
    'strikes_open', (select count(*) from customer_strikes where cleared_at is null),
    'customers_with_strikes', (select count(*) from profiles where strike_count > 0),
    'customers_cash_blocked', (select count(*) from profiles where cash_blocked_until > now()),
    'customers_suspended',    (select count(*) from profiles where not is_active and strike_count >= (antifraud_limits()->>'strike_suspend')::int),
    'by_kind_30d',  (select coalesce(jsonb_object_agg(kind, n), '{}'::jsonb) from (select kind, count(*) n from customer_strikes where created_at > now() - interval '30 days' group by kind) q),
    'rejections_24h', jsonb_build_object(
        'cash_blocked',   (select count(*) from fraud_flags where kind = 'customer_no_show' and created_at > now() - interval '24 hours' and detail->>'action' = 'cash_blocked'),
        'auto_suspend',   (select count(*) from fraud_flags where kind = 'customer_auto_suspend' and created_at > now() - interval '24 hours')),
    'limits', antifraud_limits());
end $$;
revoke all on function public.admin_antifraud_summary() from public, anon;
grant execute on function public.admin_antifraud_summary() to authenticated;

-- p_status: 'all' | 'active' (punya strike aktif) | 'cash_blocked' | 'suspended' | 'cleared'
create or replace function public.admin_customer_strikes(p_status text default 'all')
returns setof jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform admin_require('orders_view');
  return query
    select jsonb_build_object(
      'customer_id', p.id, 'full_name', p.full_name, 'phone', p.phone, 'is_active', p.is_active,
      'strike_count', p.strike_count, 'cash_blocked_until', p.cash_blocked_until, 'cash_blocked', p.cash_blocked_until > now(),
      'status', case when not p.is_active and p.strike_count >= (antifraud_limits()->>'strike_suspend')::int then 'suspended'
                     when p.cash_blocked_until > now() then 'cash_blocked'
                     when p.strike_count > 0 then 'active' else 'cleared' end,
      'last_strike_at', (select max(created_at) from customer_strikes s where s.customer_id = p.id),
      'orders_30d', (select count(*) from orders o where o.customer_id = p.id and o.created_at > now() - interval '30 days'),
      'strikes', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'order_id', s.order_id, 'order_code', o.code, 'kind', s.kind, 'evidence_url', s.evidence_url,
                        'note', s.note, 'created_by', s.created_by, 'created_by_name', b.full_name, 'created_at', s.created_at, 'cleared_at', s.cleared_at, 'cleared_note', s.cleared_note)
                        order by s.created_at desc), '[]'::jsonb)
                    from customer_strikes s left join orders o on o.id = s.order_id left join profiles b on b.id = s.created_by where s.customer_id = p.id))
    from profiles p
    where exists (select 1 from customer_strikes s where s.customer_id = p.id)
      and (coalesce(p_status, 'all') = 'all'
           or (p_status = 'active'       and p.strike_count > 0)
           or (p_status = 'cash_blocked' and p.cash_blocked_until > now() and not (not p.is_active and p.strike_count >= (antifraud_limits()->>'strike_suspend')::int))
           or (p_status = 'suspended'    and not p.is_active and p.strike_count >= (antifraud_limits()->>'strike_suspend')::int)
           or (p_status = 'cleared'      and p.strike_count = 0))
    order by (select max(created_at) from customer_strikes s where s.customer_id = p.id) desc
    limit 500;
end $$;
revoke all on function public.admin_customer_strikes(text) from public, anon;
grant execute on function public.admin_customer_strikes(text) to authenticated;

create or replace function public.admin_customer_strike_clear(p_customer uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p profiles%rowtype; v_n int; v_was_suspended boolean;
begin
  perform admin_require('orders');
  select * into p from profiles where id = p_customer for update;
  if not found then raise exception 'Pelanggan tidak ditemukan'; end if;
  v_was_suspended := not p.is_active and p.strike_count >= (antifraud_limits()->>'strike_suspend')::int;
  update customer_strikes set cleared_at = now(), cleared_by = auth.uid(), cleared_note = p_note where customer_id = p_customer and cleared_at is null;
  get diagnostics v_n = row_count;
  perform set_config('antaraja.bypass', 'on', true);
  update profiles set strike_count = 0, cash_blocked_until = null,
    is_active = case when v_was_suspended then true else is_active end,
    status_reason = case when v_was_suspended then null else status_reason end
  where id = p_customer returning * into p;
  perform set_config('antaraja.bypass', 'off', true);
  update fraud_flags set status = 'dismissed', reviewed_by = auth.uid(), reviewed_at = now(), review_note = coalesce(p_note, 'strike dibersihkan admin')
   where subject_id = p_customer and status = 'open' and kind in ('customer_no_show', 'customer_fake_address', 'customer_cancel_abuse', 'customer_auto_suspend');
  insert into notifications (user_id, kind, title, body, data) values (p_customer, 'system', 'Strike dibersihkan',
    'Catatan strike akun Anda telah dibersihkan admin.' || case when v_was_suspended then ' Akun aktif kembali.' else '' end, jsonb_build_object('kind', 'antifraud_cleared'));
  perform log_activity('antifraud.strike_clear', 'profiles', p_customer::text, 'Strike pelanggan dibersihkan (' || v_n || ' strike)' || coalesce(': ' || p_note, ''),
    jsonb_build_object('cleared', v_n, 'reactivated', v_was_suspended));
  return jsonb_build_object('ok', true, 'customer_id', p_customer, 'cleared', v_n, 'reactivated', v_was_suspended, 'strike_count', p.strike_count, 'cash_blocked_until', p.cash_blocked_until, 'is_active', p.is_active);
end $$;
revoke all on function public.admin_customer_strike_clear(uuid, text) from public, anon;
grant execute on function public.admin_customer_strike_clear(uuid, text) to authenticated;

create or replace function public.my_antifraud_status()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); p profiles%rowtype; l jsonb := antifraud_limits();
begin
  if v_uid is null then raise exception 'Harus login'; end if;
  select * into p from profiles where id = v_uid;
  return jsonb_build_object(
    'strike_count', p.strike_count,
    'cash_blocked_until', p.cash_blocked_until,
    'cash_blocked', coalesce(p.cash_blocked_until > now(), false),
    'phone_verified', antifraud_phone_ok(v_uid),
    'account_age_hours', round(extract(epoch from now() - p.created_at) / 3600.0, 1),
    'is_new_account', p.created_at > now() - ((l->>'new_account_hours') || ' hours')::interval,
    'cash_max_now', case when p.created_at > now() - ((l->>'new_account_hours') || ' hours')::interval then (l->>'new_account_cash_max')::bigint else null end,
    'orders_last_hour', (select count(*) from orders where customer_id = v_uid and created_at > now() - interval '1 hour'),
    'active_orders', (select count(*) from orders where customer_id = v_uid and status in ('awaiting_payment', 'searching', 'accepted', 'arrived', 'in_progress')),
    'strikes', (select coalesce(jsonb_agg(jsonb_build_object('kind', s.kind, 'created_at', s.created_at, 'order_id', s.order_id) order by s.created_at desc), '[]'::jsonb)
                from customer_strikes s where s.customer_id = v_uid and s.cleared_at is null),
    'limits', l);
end $$;
revoke all on function public.my_antifraud_status() from public, anon;
grant execute on function public.my_antifraud_status() to authenticated;

-- ---------------------------------------------------------------------
-- 7. Tambalan create_order (jangkar = baris KODE tanpa komentar)
-- ---------------------------------------------------------------------
-- (a) pra-cek sesudah cek akun aktif, sebelum hitung pesanan aktif
select _v3_splice('0121', 'public.create_order(jsonb,uuid)',
  $a$if not exists (select 1 from profiles where id = v_uid and is_active) then raise exception 'Akun nonaktif'; end if;$a$,
  $a$if not exists (select 1 from profiles where id = v_uid and is_active) then raise exception 'Akun nonaktif'; end if;
  perform antifraud_precheck_order(v_uid, v_paid_via);$a$,
  'antifraud_precheck_order(v_uid');

-- (b) batas pesanan aktif dari setelan (perilaku lama = 3)
select _v3_splice('0121', 'public.create_order(jsonb,uuid)',
  $a$if v_active >= 3 then raise exception 'Maksimal 3 pesanan aktif'; end if;$a$,
  $a$if v_active >= greatest(1, setting_num('antifraud_active_orders_max', 3)::int) then raise exception 'Maksimal % pesanan aktif', greatest(1, setting_num('antifraud_active_orders_max', 3)::int); end if;$a$,
  'antifraud_active_orders_max');

-- (c) batas tunai akun baru setelah total diketahui
select _v3_splice('0121', 'public.create_order(jsonb,uuid)',
  $a$v_total := v_fare + v_fee + v_sub + v_ic_fare + v_service_fee - v_disc + v_pg_cust;$a$,
  $a$v_total := v_fare + v_fee + v_sub + v_ic_fare + v_service_fee - v_disc + v_pg_cust;
  perform antifraud_check_cash_cap(v_uid, v_paid_via, v_total);$a$,
  'antifraud_check_cash_cap(v_uid');

-- spesifikasi setelan (Panel Admin › Setelan)
select _v3_splice('0121', 'public.app_setting_specs()',
  $a$('payout_fee_per_withdrawal',  'int',     0, 100000, null, '0', 'Rp', 'UANG', 'Biaya transfer per pencairan (bila bank mengenakan)', 'payout'),$a$,
  $a$('payout_fee_per_withdrawal',  'int',     0, 100000, null, '0', 'Rp', 'UANG', 'Biaya transfer per pencairan (bila bank mengenakan)', 'payout'),
    ('antifraud_new_account_hours',        'int',  0, 720, null, '24', 'jam', 'KEAMANAN', '0121: usia akun yang dianggap baru (0 = nonaktif) [ASUMSI]', 'orders'),
    ('antifraud_new_account_cash_max',     'int',  0, 10000000, null, '100000', 'Rp', 'KEAMANAN', '0121: tunai maksimal untuk akun baru [ASUMSI]', 'orders'),
    ('antifraud_orders_per_hour_max',      'int',  1, 100000, null, '3', 'per jam', 'KEAMANAN', '0121: pesanan baru per pelanggan per jam [ASUMSI]', 'orders'),
    ('antifraud_active_orders_max',        'int',  1, 20, null, '3', 'pesanan', 'KEAMANAN', '0121: pesanan aktif maksimal per pelanggan', 'orders'),
    ('antifraud_noshow_strike_cash_block', 'int',  1, 20, null, '2', 'strike', 'KEAMANAN', '0121: strike no-show → tunai diblokir', 'orders'),
    ('antifraud_noshow_strike_suspend',    'int',  1, 20, null, '3', 'strike', 'KEAMANAN', '0121: strike no-show → akun ditangguhkan', 'orders'),
    ('antifraud_phone_required',           'bool', null, null, null, 'true', '', 'KEAMANAN', '0121: nomor telepon wajib sebelum memesan', 'orders'),
    ('antifraud_noshow_wait_minutes',      'int',  0, 60, null, '5', 'menit', 'KEAMANAN', '0121: driver wajib menunggu N menit setelah tiba sebelum lapor no-show [ASUMSI]', 'orders'),
    ('antifraud_noshow_fee',               'int',  0, 100000, null, '0', 'Rp', 'UANG', '0121: biaya no-show dari pelanggan ke driver (0 = tidak ada) [ASUMSI]', 'orders'),
    ('antifraud_cash_block_days',          'int',  1, 365, null, '30', 'hari', 'KEAMANAN', '0121: lama blokir tunai setelah strike', 'orders'),$a$,
  'antifraud_new_account_hours');

-- ---------------------------------------------------------------------
-- 8. Penjaga
-- ---------------------------------------------------------------------
do $$
declare def text;
begin
  if to_regclass('public.customer_strikes') is null then raise exception '0121 batal: tabel customer_strikes belum ada'; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name in ('cash_blocked_until')) then raise exception '0121 batal: kolom profiles.cash_blocked_until belum ada'; end if;
  def := pg_get_functiondef('public.create_order(jsonb,uuid)'::regprocedure);
  if position('antifraud_precheck_order(v_uid' in def) = 0 then raise exception '0121 batal: create_order belum memanggil antifraud_precheck_order'; end if;
  if position('antifraud_check_cash_cap(v_uid' in def) = 0 then raise exception '0121 batal: create_order belum memanggil antifraud_check_cash_cap'; end if;
  if position('antifraud_active_orders_max' in def) = 0 then raise exception '0121 batal: batas pesanan aktif belum dari setelan'; end if;
  if (select count(*) from app_settings where key like 'antifraud_%') < 10 then raise exception '0121 batal: setelan antifraud belum lengkap'; end if;
  if not exists (select 1 from app_setting_specs() where key = 'antifraud_orders_per_hour_max') then raise exception '0121 batal: app_setting_specs belum memuat antifraud_*'; end if;
  raise notice '0121 ok: limits=%', antifraud_limits();
end $$;
