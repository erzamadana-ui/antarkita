-- =====================================================================
-- 0100 — BIAYA PAYMENT GATEWAY (`payment_channel_fees`) + BAYAR PER ORDER LEWAT GATEWAY
--
-- Sumber: docs/SKEMA-BISNIS-V2-SPEK.md §0.8, §2 (pg_fee), §3 — Kontrak Elektronik Midtrans
-- M568767786_825925_PKS-Pass_M_09_2026 (Ver.Aug-26, Aggregator): Pasal 6 (biaya), SOP B.6 (hold/disburse).
--
-- Sebelum ini:
--   • pg_fee_calc (0099) selalu (0,0) karena tabel biaya belum ada.
--   • payment_settle (0016) SELALU menambah saldo AntarPay (top up) — termasuk pembayaran pesanan;
--     create_order dengan paid_via gopay/qris/… memotong SALDO (rail AntarPay), bukan menagih gateway.
-- Sekarang:
--   • payment_channel_fees = tarif PKS per saluran (bisa diubah admin: PIN + audit).
--   • create_order dengan saluran gateway → status 'awaiting_payment', payment_status 'unpaid', saldo
--     TIDAK dipotong; midtrans-create membuat Snap per order (purpose='order'); webhook → payment_settle
--     → orders.payment_status='paid', status 'searching' (atau 'scheduled'), biaya PG aktual ke orders
--     + ledger fase created ditulis ulang. Pesanan tak dibayar > order_payment_timeout_min (15 menit
--     [ASUMSI]) dibatalkan otomatis oleh expire_unpaid_orders() (pg_cron tiap menit).
--   • Top up: biaya PG dicatat di wallet_transactions.pg_fee (fee + PPN), saldo tetap bertambah penuh.
--   • payments: pg_channel, pg_fee, pg_fee_ppn, settlement_time, hold_until (= settlement + hold H+n).
--
-- CATATAN transaksi: nilai enum 'awaiting_payment' ditambahkan di awal berkas. Di PostgreSQL ≥ 12
-- ALTER TYPE … ADD VALUE boleh di dalam transaksi, tetapi nilainya BELUM boleh DIPAKAI sampai commit.
-- Karena itu nilai baru hanya muncul di badan fungsi plpgsql (dievaluasi saat dipanggil) dan
-- penjaga migrasi membandingkan sebagai teks (status::text), tidak meng-cast literal ke enum.
--
-- Isi:
--   0. Enum order_status + 'awaiting_payment'
--   1. Tabel payment_channel_fees + RLS + nilai PKS
--   2. pg_fee_calc (definisi final, statis) + pg_hold_days
--   3. RPC admin_set_payment_channel_fee / admin_payment_channel_fees
--   4. Kolom payments & wallet_transactions; app_settings.order_payment_timeout_min
--   5. payment_settle(p_external_id, p_status, p_raw, p_channel, p_settlement_time)
--   6. order_payment_prepare(order, channel) — dipakai edge function midtrans-create
--   7. expire_unpaid_orders() + jadwal pg_cron
--   8. Tambalan create_order (skema_v2_splice, jangkar gagal keras)
--   9. Penjaga migrasi
-- Semua blok idempoten.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Status pesanan baru: menunggu pembayaran gateway
-- ---------------------------------------------------------------------
alter type public.order_status add value if not exists 'awaiting_payment' before 'searching';

-- ---------------------------------------------------------------------
-- 1. Tabel biaya saluran pembayaran
-- ---------------------------------------------------------------------
create table if not exists public.payment_channel_fees (
  channel            text primary key,                       -- kunci saluran 0089 (+ saluran PKS yang belum dipakai)
  provider           text not null default 'midtrans',
  label              text,
  fee_pct            numeric(5,2) not null default 0 check (fee_pct between 0 and 100),
  fee_fixed          bigint       not null default 0 check (fee_fixed >= 0),
  ppn_included       boolean      not null default false,   -- true: tarif PKS sudah termasuk PPN → ppn = 0
  ppn_pct            numeric(4,2) not null default 11 check (ppn_pct between 0 and 99.99),  -- [ASUMSI] tarif efektif PPN jasa 11 %
  hold_days          int          not null default 0 check (hold_days between 0 and 90),     -- dana ditahan H+n sejak settlement
  hold_days_by_bank  jsonb        not null default '{}'::jsonb,  -- pengecualian per bank VA, mis. {"bsi":2,"seabank":2}
  min_auto_disburse  bigint       not null default 50000 check (min_auto_disburse >= 0),   -- [FAKTA SOP B.6.a.iii]
  source             text,
  notes              text,
  active             boolean      not null default true,    -- false → tarif tidak berlaku (pg_fee_calc = 0)
  updated_at         timestamptz  not null default now(),
  updated_by         uuid
);
comment on table public.payment_channel_fees is
  'Skema Bisnis v2 (0100): tarif payment gateway per saluran (PKS Midtrans Ver.Aug-26 Pasal 6 / SOP B.6). fee = round(amount × fee_pct/100) + fee_fixed; ppn = 0 bila ppn_included, else round(fee × ppn_pct/100). Diubah hanya lewat admin_set_payment_channel_fee (PIN + audit).';
comment on column public.payment_channel_fees.ppn_pct is '[ASUMSI] tarif efektif PPN atas jasa gateway 11 % — ubah dari Panel Admin bila konsultan pajak menetapkan lain.';
comment on column public.payment_channel_fees.hold_days is 'Dana settlement ditahan Midtrans H+n hari (SOP B.6.a). payments.hold_until = settlement_time + n hari kalender.';
comment on column public.payment_channel_fees.min_auto_disburse is '[FAKTA SOP B.6.a.iii] batas minimal pencairan otomatis Midtrans ke rekening merchant.';

alter table public.payment_channel_fees enable row level security;
drop policy if exists payment_channel_fees_admin on public.payment_channel_fees;
create policy payment_channel_fees_admin on public.payment_channel_fees
  for select to authenticated using (is_admin());
-- tarif PKS tidak dibuka ke klien (klien memakai pg_fee_calc / order_payment_prepare); tulis hanya lewat RPC
revoke all on public.payment_channel_fees from public, anon, authenticated;
grant select on public.payment_channel_fees to authenticated;
grant all on public.payment_channel_fees to service_role;

do $$
begin
  if to_regprocedure('public.audit_trigger()') is not null
     and not exists (select 1 from pg_trigger where tgname = 't_audit_payment_channel_fees' and tgrelid = 'public.payment_channel_fees'::regclass) then
    create trigger t_audit_payment_channel_fees after insert or delete or update on public.payment_channel_fees
      for each row execute function audit_trigger();
  end if;
end $$;

-- Nilai PKS (tidak menimpa nilai yang sudah diubah admin)
insert into public.payment_channel_fees (channel, provider, label, fee_pct, fee_fixed, ppn_included, ppn_pct, hold_days, hold_days_by_bank, source, notes) values
  ('bank_transfer', 'midtrans', 'Transfer bank (VA)', 0,    4000, false, 11, 1, '{"bsi": 2, "seabank": 2}',
     'PKS Midtrans Ver.Aug-26 Pasal 6 / SOP B.6', '[FAKTA SUMBER] VA Mandiri/BNI/BRI/CIMB/Permata/Danamon/BCA/BSI/SeaBank Rp4.000/transaksi (Pasal 6 ayat 2; SOP B.6.a) belum termasuk PPN; hold H+1, BSI/SeaBank H+2'),
  ('card',          'midtrans', 'Kartu kredit/debit', 2.9,  2000, false, 11, 3, '{}',
     'PKS Midtrans Ver.Aug-26 Pasal 6 / SOP B.6', '[FAKTA SUMBER] Visa/MasterCard/JCB 2,9 % + Rp2.000 belum termasuk PPN; hold H+3'),
  ('gopay',         'midtrans', 'GoPay',              2.0,  0,    true,  11, 1, '{}',
     'PKS Midtrans Ver.Aug-26 Pasal 6 / SOP B.6', '[FAKTA SUMBER] Lampiran GoPay: 2 % transaksi non-digital, termasuk PPN; hold H+1'),
  ('shopeepay',     'midtrans', 'ShopeePay',          2.0,  0,    true,  11, 2, '{}',
     'PKS Midtrans Ver.Aug-26 Pasal 6 / SOP B.6', '[FAKTA SUMBER] Lampiran ShopeePay: 2 % non-digital, termasuk PPN; hold H+2'),
  ('qris',          'midtrans', 'QRIS',               0.7,  0,    true,  11, 1, '{}',
     'PKS Midtrans Ver.Aug-26 Pasal 6 / SOP B.6', '[FAKTA SUMBER] Lampiran QRIS: MDR 0,7 % merchant reguler umum, termasuk PPN; hold H+1'),
  ('dana',          'midtrans', 'DANA',               1.5,  0,    false, 11, 2, '{}',
     'PKS Midtrans Ver.Aug-26 Pasal 6 / SOP B.6', '[FAKTA SUMBER] DANA 1,5 % belum termasuk PPN; hold H+2'),
  ('ovo',           'midtrans', 'OVO',                1.5,  0,    false, 11, 5, '{}',
     'PKS Midtrans Ver.Aug-26 Pasal 6 / SOP B.6', '[FAKTA SUMBER] OVO 1,5 % non-digital domestik belum termasuk PPN; hold tidak disebut → "lainnya" H+5'),
  ('akulaku',       'midtrans', 'Akulaku',            1.7,  0,    false, 11, 5, '{}',
     'PKS Midtrans Ver.Aug-26 Pasal 6 / SOP B.6', '[FAKTA SUMBER] Akulaku 1,7 % (belum dipakai aplikasi); hold H+5'),
  ('kredivo',       'midtrans', 'Kredivo',            2.0,  0,    false, 11, 2, '{}',
     'PKS Midtrans Ver.Aug-26 Pasal 6 / SOP B.6', '[FAKTA SUMBER] Kredivo 2 % (belum dipakai aplikasi); hold H+2'),
  ('alfamart',      'midtrans', 'Alfamart',           0,    5000, false, 11, 5, '{}',
     'PKS Midtrans Ver.Aug-26 Pasal 6 / SOP B.6', '[FAKTA SUMBER] Alfamart Rp5.000/transaksi (belum dipakai aplikasi); hold H+5'),
  ('indomaret',     'midtrans', 'Indomaret',          0,    1000, false, 11, 5, '{}',
     'PKS Midtrans Ver.Aug-26 Pasal 6 / SOP B.6', '[FAKTA SUMBER] Indomaret = biaya mitra Indomaret + Rp1.000; [ASUMSI] fee_fixed hanya bagian Midtrans Rp1.000 — biaya mitra Indomaret belum tercantum, tambahkan dari Panel Admin sebelum saluran dipakai; hold H+5'),
  ('cash',          'internal', 'Tunai/COD',          0,    0,    true,  11, 0, '{}',
     'PKS Midtrans Ver.Aug-26 Pasal 6 / SOP B.6', 'Bukan gateway — tidak ada biaya PG'),
  ('antarpay',      'internal', 'AntarPay (saldo)',   0,    0,    true,  11, 0, '{}',
     'PKS Midtrans Ver.Aug-26 Pasal 6 / SOP B.6', 'Bukan gateway — biaya top up dicatat di wallet_transactions.pg_fee (§2)'),
  ('emoney_nfc',    'internal', 'E-money (kartu NFC)',0,    0,    true,  11, 0, '{}',
     'PKS Midtrans Ver.Aug-26 Pasal 6 / SOP B.6', 'Bukan gateway — tidak ada biaya PG')
on conflict (channel) do nothing;

-- ---------------------------------------------------------------------
-- 2. pg_fee_calc (definisi final: baca tabel langsung) + hold days
-- ---------------------------------------------------------------------
create or replace function public.pg_fee_calc(p_channel text, p_amount bigint)
returns table(fee bigint, ppn bigint)
language plpgsql stable security definer set search_path = public as $$
declare f payment_channel_fees;
begin
  fee := 0; ppn := 0;
  if p_channel is null or p_amount is null or p_amount <= 0 then return next; return; end if;
  select * into f from payment_channel_fees where channel = lower(trim(p_channel));
  if not found or not f.active then return next; return; end if;
  fee := round(p_amount * f.fee_pct / 100.0)::bigint + f.fee_fixed;
  ppn := case when f.ppn_included then 0 else round(fee * f.ppn_pct / 100.0)::bigint end;
  return next;
end $$;
revoke all on function public.pg_fee_calc(text, bigint) from public;
grant execute on function public.pg_fee_calc(text, bigint) to anon, authenticated, service_role;
comment on function public.pg_fee_calc(text, bigint) is
  'Biaya payment gateway (fee, ppn) untuk saluran & nominal dari payment_channel_fees (0100, PKS Midtrans). Saluran tak dikenal/nonaktif → (0,0).';

create or replace function public.pg_hold_days(p_channel text, p_bank text default null)
returns int language sql stable security definer set search_path = public as $$
  select coalesce((f.hold_days_by_bank ->> lower(trim(coalesce(p_bank, ''))))::int, f.hold_days, 0)
  from (select 1) x left join payment_channel_fees f on f.channel = lower(trim(coalesce(p_channel, '')));
$$;
revoke all on function public.pg_hold_days(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. RPC admin: ubah tarif satu saluran (PIN + audit) & baca semua
-- ---------------------------------------------------------------------
create or replace function public.admin_set_payment_channel_fee(p_channel text, p_patch jsonb)
returns payment_channel_fees
language plpgsql security definer set search_path = public as $$
declare
  b payment_channel_fees; a payment_channel_fees; k text; v_key text := lower(trim(coalesce(p_channel, ''))); ringkas text;
  allowed constant text[] := array['label','fee_pct','fee_fixed','ppn_included','ppn_pct','hold_days','hold_days_by_bank',
    'min_auto_disburse','source','notes','active','provider'];
begin
  if not is_admin() then raise exception 'Hanya admin'; end if;
  perform admin_require_unlock();
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception 'Patch kosong: kirim objek {kolom: nilai}';
  end if;
  for k in select jsonb_object_keys(p_patch) loop
    if not (k = any (allowed)) then raise exception 'Kolom tidak dikenal: %', k; end if;
  end loop;
  select * into b from payment_channel_fees where channel = v_key for update;
  if not found then raise exception 'Saluran pembayaran tidak dikenal: %', coalesce(p_channel, 'kosong'); end if;
  a := b;
  begin
    if p_patch ? 'label' then a.label := nullif(trim(p_patch->>'label'), ''); end if;
    if p_patch ? 'fee_pct' then a.fee_pct := (p_patch->>'fee_pct')::numeric; end if;
    if p_patch ? 'fee_fixed' then a.fee_fixed := (p_patch->>'fee_fixed')::bigint; end if;
    if p_patch ? 'ppn_included' then a.ppn_included := (p_patch->>'ppn_included')::boolean; end if;
    if p_patch ? 'ppn_pct' then a.ppn_pct := (p_patch->>'ppn_pct')::numeric; end if;
    if p_patch ? 'hold_days' then a.hold_days := (p_patch->>'hold_days')::int; end if;
    if p_patch ? 'hold_days_by_bank' then a.hold_days_by_bank := coalesce(p_patch->'hold_days_by_bank', '{}'::jsonb); end if;
    if p_patch ? 'min_auto_disburse' then a.min_auto_disburse := (p_patch->>'min_auto_disburse')::bigint; end if;
    if p_patch ? 'source' then a.source := p_patch->>'source'; end if;
    if p_patch ? 'notes' then a.notes := p_patch->>'notes'; end if;
    if p_patch ? 'active' then a.active := (p_patch->>'active')::boolean; end if;
    if p_patch ? 'provider' then a.provider := lower(trim(p_patch->>'provider')); end if;
  exception when invalid_text_representation or numeric_value_out_of_range or datatype_mismatch then
    raise exception 'Nilai patch tidak valid: %', sqlerrm;
  end;
  -- validasi rentang (pesan jelas sebelum constraint tabel)
  if a.fee_pct is null or a.fee_pct < 0 or a.fee_pct > 20 then raise exception 'fee_pct harus 0–20 (%%)'; end if;
  if a.fee_fixed is null or a.fee_fixed < 0 or a.fee_fixed > 100000 then raise exception 'fee_fixed harus Rp0–Rp100.000'; end if;
  if a.ppn_pct is null or a.ppn_pct < 0 or a.ppn_pct > 20 then raise exception 'ppn_pct harus 0–20 (%%)'; end if;
  if a.hold_days is null or a.hold_days < 0 or a.hold_days > 30 then raise exception 'hold_days harus 0–30 hari'; end if;
  if a.min_auto_disburse is null or a.min_auto_disburse < 0 then raise exception 'min_auto_disburse harus ≥ 0'; end if;
  if a.ppn_included is null or a.active is null then raise exception 'ppn_included/active harus true|false'; end if;
  if jsonb_typeof(a.hold_days_by_bank) <> 'object'
     or exists (select 1 from jsonb_each(a.hold_days_by_bank) e where jsonb_typeof(e.value) <> 'number' or (e.value #>> '{}')::numeric not between 0 and 30) then
    raise exception 'hold_days_by_bank harus objek {"bank": hari 0–30}';
  end if;
  if coalesce(a.provider, '') = '' then raise exception 'provider wajib diisi'; end if;

  update payment_channel_fees set label = a.label, fee_pct = a.fee_pct, fee_fixed = a.fee_fixed, ppn_included = a.ppn_included,
    ppn_pct = a.ppn_pct, hold_days = a.hold_days, hold_days_by_bank = a.hold_days_by_bank, min_auto_disburse = a.min_auto_disburse,
    source = a.source, notes = a.notes, active = a.active, provider = a.provider, updated_at = now(), updated_by = auth.uid()
  where channel = v_key returning * into a;

  select string_agg(format('%s: %s → %s', x.key, x.lama, x.baru), ', ') into ringkas
  from (select key, bj.value #>> '{}' as lama, aj.value #>> '{}' as baru
        from jsonb_each(to_jsonb(b)) bj(key, value) join jsonb_each(to_jsonb(a)) aj using (key)
        where key = any (allowed) and bj.value is distinct from aj.value) x;
  perform log_activity('pg_fee.updated', 'payment_channel_fees', v_key,
    'Biaya payment gateway ' || v_key || ' diubah: ' || coalesce(ringkas, '(tidak ada perubahan nilai)'),
    jsonb_build_object('before', to_jsonb(b), 'after', to_jsonb(a), 'patch', p_patch));
  return a;
end $$;
revoke all on function public.admin_set_payment_channel_fee(text, jsonb) from public, anon;
grant execute on function public.admin_set_payment_channel_fee(text, jsonb) to authenticated;
comment on function public.admin_set_payment_channel_fee(text, jsonb) is
  'Panel Admin → Biaya Payment Gateway (0100): ubah tarif satu saluran. is_admin() + admin_require_unlock(); validasi rentang; log_activity pg_fee.updated {before, after}.';

create or replace function public.admin_payment_channel_fees()
returns setof payment_channel_fees
language sql stable security definer set search_path = public as $$
  select * from payment_channel_fees where is_admin()
  order by (provider = 'internal'), channel = any (payment_gateway_channel_keys()) desc, channel;
$$;
revoke all on function public.admin_payment_channel_fees() from public, anon;
grant execute on function public.admin_payment_channel_fees() to authenticated;

-- ---------------------------------------------------------------------
-- 4. Kolom baru
-- ---------------------------------------------------------------------
alter table public.payments add column if not exists order_id uuid references public.orders(id);
alter table public.payments add column if not exists pg_channel text;
alter table public.payments add column if not exists pg_fee bigint not null default 0;
alter table public.payments add column if not exists pg_fee_ppn bigint not null default 0;
alter table public.payments add column if not exists settlement_time timestamptz;
alter table public.payments add column if not exists hold_until timestamptz;
create index if not exists payments_order_idx on public.payments (order_id) where order_id is not null;
create index if not exists payments_settlement_idx on public.payments (settlement_time) where settlement_time is not null;
comment on column public.payments.pg_fee is 'Biaya gateway (tanpa PPN) menurut payment_channel_fees saat settlement (0100).';
comment on column public.payments.hold_until is 'settlement_time + hold H+n (payment_channel_fees.hold_days / hold_days_by_bank): kapan dana boleh dicairkan Midtrans.';

alter table public.wallet_transactions add column if not exists pg_fee bigint not null default 0;
comment on column public.wallet_transactions.pg_fee is 'Biaya payment gateway (fee + PPN) yang ditanggung platform atas top up ini (0100, §2). Saldo pengguna tetap bertambah penuh.';

insert into app_settings (key, value) values ('order_payment_timeout_min', '15'::jsonb) on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 5. payment_settle — menerima saluran & waktu settlement; purpose='order' TIDAK top up
--    (satu fungsi saja: 3 argumen lama tetap bisa dipanggil karena parameter baru ber-default)
-- ---------------------------------------------------------------------
drop function if exists public.payment_settle(text, text, jsonb);
create or replace function public.payment_settle(p_external_id text, p_status text, p_raw jsonb default null,
  p_channel text default null, p_settlement_time timestamptz default null)
returns payments
language plpgsql security definer set search_path = public as $$
declare
  p payments%rowtype; o orders%rowtype; v_ch text; v_fee bigint := 0; v_ppn bigint := 0; v_bank text; v_settle timestamptz;
  v_ok boolean := false; v_reason text; v_label text;
begin
  select * into p from payments where external_id = p_external_id for update;
  if not found then raise exception 'Payment tidak ditemukan'; end if;
  if p.provider <> 'simulated' then
    insert into app_settings (key, value) values ('pg_last_webhook_at', to_jsonb(now())) on conflict (key) do update set value = excluded.value, updated_at = now();
  end if;
  if p.status = 'settlement' then return p; end if;   -- idempoten: notifikasi ganda tidak memproses dua kali
  update payments set status = p_status, raw = coalesce(p_raw, raw), updated_at = now() where id = p.id returning * into p;

  if p_status = 'settlement' then
    -- saluran: dari webhook (payment_type terpetakan) → yang tersimpan → metode yang dipilih saat membuat transaksi
    v_ch := nullif(lower(trim(coalesce(p_channel, ''))), '');
    if v_ch is null then
      v_ch := coalesce(p.pg_channel, case when lower(p.method) = any (payment_gateway_channel_keys()) then lower(p.method) end);
    end if;
    v_label := payment_channel_label(coalesce(v_ch, p.method));
    v_bank := lower(coalesce(p_raw->'va_numbers'->0->>'bank', case when p_raw ? 'permata_va_number' then 'permata' when p_raw->>'payment_type' = 'echannel' then 'mandiri' end, p_raw->>'bank'));
    v_settle := p_settlement_time;
    if v_settle is null and p_raw ? 'settlement_time' then
      begin v_settle := ((p_raw->>'settlement_time')::timestamp at time zone 'Asia/Jakarta');   -- Midtrans mengirim waktu WIB tanpa zona
      exception when others then v_settle := null; end;
    end if;
    v_settle := coalesce(v_settle, now());
    if v_ch is not null then select f.fee, f.ppn into v_fee, v_ppn from pg_fee_calc(v_ch, p.amount) f; end if;
    v_fee := coalesce(v_fee, 0); v_ppn := coalesce(v_ppn, 0);
    update payments set pg_channel = v_ch, pg_fee = v_fee, pg_fee_ppn = v_ppn, settlement_time = v_settle,
      hold_until = v_settle + make_interval(days => pg_hold_days(v_ch, v_bank))
    where id = p.id returning * into p;

    if p.purpose = 'order' then
      -- 0100 bayar per order: tandai lunas, mulai cari driver, tulis ulang buku besar fase created
      if p.order_id is not null then select * into o from orders where id = p.order_id for update; end if;
      if o.id is null then v_reason := 'pesanan tidak ditemukan';
      elsif o.status::text <> 'awaiting_payment' or o.payment_status <> 'unpaid' then v_reason := 'pesanan sudah ' || o.status::text || '/' || o.payment_status::text;
      elsif p.amount <> o.total then v_reason := 'nominal ' || p.amount || ' ≠ total pesanan ' || o.total;
      else v_ok := true; end if;

      if v_ok then
        update orders set payment_status = 'paid', paid_via = coalesce(v_ch, paid_via), pg_channel = coalesce(v_ch, pg_channel),
          -- ditanggung pelanggan: pertahankan biaya yang sudah ditagihkan di total (buku besar tetap seimbang);
          -- selisih dengan biaya aktual terlihat di payments.pg_fee (rekonsiliasi)
          pg_fee = case when pg_fee_borne_by = 'customer' then pg_fee else v_fee end,
          pg_fee_ppn = case when pg_fee_borne_by = 'customer' then pg_fee_ppn else v_ppn end,
          pg_fee_borne_by = case when pg_fee_borne_by = 'customer' then 'customer' when v_fee + v_ppn > 0 then 'platform' else null end,
          status = case when scheduled_at is not null then 'scheduled'::order_status else 'searching'::order_status end
        where id = o.id returning * into o;
        insert into order_events (order_id, status, actor_id, note) values
          (o.id, 'paid', p.user_id, 'Pembayaran ' || v_label || ' diterima (' || p.external_id || ')'),
          (o.id, o.status::text, p.user_id, case when o.status::text = 'scheduled' then 'Booking terjadwal — driver dicarikan menjelang jadwal' else 'Pesanan dibayar, mencari driver' end);
        perform ledger_post(o.id, 'created');
        insert into notifications (user_id, kind, title, body, data) values (p.user_id, 'order', 'Pembayaran berhasil',
          'Pesanan ' || o.code || ' dibayar via ' || v_label || '. ' || case when o.status::text = 'scheduled' then 'Driver dicarikan menjelang jadwal.' else 'Kami sedang mencarikan driver.' end,
          jsonb_build_object('payment_id', p.id, 'order_id', o.id));
      else
        -- dana sudah diterima gateway tetapi pesanan tidak bisa dibayar lagi (batal/kedaluwarsa/nominal beda):
        -- kembalikan ke saldo AntarPay pelanggan (closed-loop, §0.8b) — tercatat & bisa direkonsiliasi lewat ref
        perform wallet_apply(p.user_id, 'refund', p.amount, p.order_id,
          'Refund pembayaran ' || coalesce(o.code, 'pesanan') || ' — ' || v_reason, p.external_id);
        update wallet_transactions set pg_fee = v_fee + v_ppn where ref = p.external_id and user_id = p.user_id and type = 'refund';
        insert into notifications (user_id, kind, title, body, data) values (p.user_id, 'system', 'Pembayaran dikembalikan ke saldo',
          'Rp' || to_char(p.amount, 'FM999G999G999') || ' via ' || v_label || ' diterima setelah ' || coalesce(o.code, 'pesanan') || ' tidak bisa diproses (' || v_reason || '). Dana masuk ke saldo AntarPay Anda.',
          jsonb_build_object('payment_id', p.id, 'order_id', p.order_id));
      end if;
    else
      perform wallet_apply(p.user_id, 'topup', p.amount, p.order_id, 'Top up via ' || p.method || ' (' || p.provider || ')', p.external_id);
      update wallet_transactions set pg_fee = v_fee + v_ppn where ref = p.external_id and user_id = p.user_id and type = 'topup';
      insert into notifications (user_id, kind, title, body, data) values (p.user_id, 'system', 'Top up berhasil', 'Rp' || to_char(p.amount, 'FM999G999G999') || ' masuk ke AntarPay via ' || p.method, jsonb_build_object('payment_id', p.id));
    end if;
  elsif p_status in ('cancel','deny','expire','failure') then
    insert into notifications (user_id, kind, title, body, data) values (p.user_id, 'system', 'Pembayaran ' || p_status,
      'Transaksi ' || p.external_id || ' tidak selesai. ' || case when p.purpose = 'order' then 'Pesanan menunggu pembayaran — coba lagi dengan metode lain sebelum batas waktu.' else 'Coba lagi dengan metode lain.' end,
      jsonb_build_object('payment_id', p.id, 'order_id', p.order_id));
  end if;
  return p;
end $$;
revoke all on function public.payment_settle(text, text, jsonb, text, timestamptz) from public, anon, authenticated;
grant execute on function public.payment_settle(text, text, jsonb, text, timestamptz) to service_role;
comment on function public.payment_settle(text, text, jsonb, text, timestamptz) is
  'Webhook gateway (0100): idempoten per external_id. settlement → biaya PG (pg_fee_calc) + hold_until; purpose=order → orders.payment_status=paid, status searching/scheduled, ledger_post(created) — TIDAK top up; pesanan tak bisa dibayar → refund ke saldo (closed-loop). purpose=topup → wallet topup + wallet_transactions.pg_fee.';

-- ---------------------------------------------------------------------
-- 6. order_payment_prepare — dipanggil midtrans-create (JWT pelanggan) sebelum membuat Snap
-- ---------------------------------------------------------------------
create or replace function public.order_payment_prepare(p_order uuid, p_channel text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare o orders; se service_economics; v_ch text; v_base bigint; v_fee bigint := 0; v_ppn bigint := 0; v_borne text; v_total bigint;
  v_timeout int := greatest(1, setting_num('order_payment_timeout_min', 15)::int);
begin
  if auth.uid() is null then raise exception 'Harus login'; end if;
  select * into o from orders where id = p_order for update;
  if not found or o.customer_id <> auth.uid() then raise exception 'Pesanan tidak ditemukan'; end if;
  if o.status::text <> 'awaiting_payment' or o.payment_status <> 'unpaid' then
    raise exception 'Pesanan % tidak menunggu pembayaran (status %, bayar %)', o.code, o.status, o.payment_status;
  end if;
  if o.created_at < now() - make_interval(mins => v_timeout) then raise exception 'Batas waktu pembayaran pesanan % sudah lewat', o.code; end if;
  v_ch := coalesce(nullif(lower(trim(coalesce(p_channel, ''))), ''), o.pg_channel);
  if not (v_ch = any (payment_gateway_channel_keys())) then raise exception 'Saluran % bukan payment gateway', payment_channel_label(v_ch); end if;
  perform payment_channel_require(v_ch);
  select * into se from service_economics where service = o.service;
  -- dasar = total tanpa biaya pembayaran yang (mungkin) sudah ditagihkan; biaya dihitung ulang untuk saluran final
  v_base := o.total - case when o.pg_fee_borne_by = 'customer' then o.pg_fee + o.pg_fee_ppn else 0 end;
  select f.fee, f.ppn into v_fee, v_ppn from pg_fee_calc(v_ch, v_base) f;
  v_fee := coalesce(v_fee, 0); v_ppn := coalesce(v_ppn, 0);
  v_borne := case when v_fee + v_ppn > 0 then coalesce(se.pg_fee_policy, 'platform') else null end;
  v_total := v_base + case when v_borne = 'customer' then v_fee + v_ppn else 0 end;   -- pg_fee_policy=customer: "Biaya pembayaran" ditambahkan
  if v_total is distinct from o.total or v_ch is distinct from o.pg_channel or v_fee is distinct from o.pg_fee
     or v_ppn is distinct from o.pg_fee_ppn or v_borne is distinct from o.pg_fee_borne_by then
    update orders set total = v_total, paid_via = v_ch, pg_channel = v_ch, pg_fee = v_fee, pg_fee_ppn = v_ppn, pg_fee_borne_by = v_borne
    where id = o.id returning * into o;
    perform ledger_post(o.id, 'created');
  end if;
  return jsonb_build_object('order_id', o.id, 'code', o.code, 'service', o.service, 'channel', v_ch, 'channel_label', payment_channel_label(v_ch),
    'gross', o.total, 'pg_fee', o.pg_fee, 'pg_fee_ppn', o.pg_fee_ppn, 'pg_fee_borne_by', o.pg_fee_borne_by,
    'customer_payment_fee', case when o.pg_fee_borne_by = 'customer' then o.pg_fee + o.pg_fee_ppn else 0 end,
    'expires_at', o.created_at + make_interval(mins => v_timeout), 'timeout_min', v_timeout);
end $$;
revoke all on function public.order_payment_prepare(uuid, text) from public, anon;
grant execute on function public.order_payment_prepare(uuid, text) to authenticated, service_role;
comment on function public.order_payment_prepare(uuid, text) is
  'Bayar per order (0100): validasi pemilik & status awaiting_payment, (opsional) ganti saluran, hitung ulang biaya PG (pg_fee_policy=customer → ditambahkan ke total), kembalikan gross untuk Snap.';

-- ---------------------------------------------------------------------
-- 7. expire_unpaid_orders — pesanan gateway yang tidak dibayar dalam batas waktu dibatalkan
-- ---------------------------------------------------------------------
create or replace function public.expire_unpaid_orders()
returns int
language plpgsql security definer set search_path = public as $$
declare o orders; n int := 0; v_timeout int := greatest(1, setting_num('order_payment_timeout_min', 15)::int);
begin
  perform public.assert_background_or_admin();
  for o in select * from orders where status::text = 'awaiting_payment' and payment_status = 'unpaid'
             and created_at < now() - make_interval(mins => v_timeout) for update skip locked loop
    update orders set status = 'cancelled', cancelled_at = now(), cancel_reason = 'Pembayaran tidak diterima dalam ' || v_timeout || ' menit'
     where id = o.id returning * into o;
    if o.promo_code is not null then update promos set used_count = greatest(0, used_count - 1) where code = o.promo_code; end if;
    perform ledger_post(o.id, 'cancelled', '{}'::jsonb);
    insert into order_events (order_id, status, note) values (o.id, 'cancelled', 'Otomatis: pembayaran tidak diterima dalam ' || v_timeout || ' menit');
    insert into notifications (user_id, kind, title, body, data) values (o.customer_id, 'order', 'Pesanan dibatalkan',
      'Pesanan ' || o.code || ' dibatalkan karena pembayaran tidak diterima dalam ' || v_timeout || ' menit. Bila dana terlanjur terpotong, otomatis dikembalikan ke saldo AntarPay.',
      jsonb_build_object('order_id', o.id));
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.expire_unpaid_orders() from public, anon, authenticated;
grant execute on function public.expire_unpaid_orders() to service_role;

do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'antarkita_expire_unpaid_orders';
  perform cron.schedule('antarkita_expire_unpaid_orders', '* * * * *', $c$select public.expire_unpaid_orders();$c$);
exception when others then
  raise notice '0100: pg_cron tidak tersedia (%) — jadwalkan expire_unpaid_orders() secara manual', sqlerrm;
end $$;

-- ---------------------------------------------------------------------
-- 8. Tambalan create_order — saluran gateway: menunggu pembayaran, saldo tidak dipotong
-- ---------------------------------------------------------------------
create or replace function public.skema_v2_splice(p_fn text, p_anchor text, p_new text, p_marker text, p_all boolean default false)
returns void language plpgsql as $$
declare def text; n int;
begin
  if (select count(*) from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace where ns.nspname = 'public' and p.proname = p_fn) > 1 then
    raise exception 'skema v2 batal: fungsi % punya lebih dari satu overload — tambalan tidak tahu mana yang dimaksud', p_fn;
  end if;
  select pg_get_functiondef(p.oid) into def from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = p_fn;
  if def is null then raise exception 'skema v2 batal: fungsi % tidak ditemukan', p_fn; end if;
  if position(p_marker in def) > 0 then raise notice 'skema v2: % sudah ditambal (%), dilewati', p_fn, p_marker; return; end if;
  n := (length(def) - length(replace(def, p_anchor, ''))) / greatest(1, length(p_anchor));
  if n = 0 then raise exception 'skema v2 batal: jangkar tidak ditemukan di % — definisi berubah, tambalan TIDAK terpasang. Jangkar: %', p_fn, left(p_anchor, 120); end if;
  if n > 1 and not p_all then raise exception 'skema v2 batal: jangkar tidak unik (% kali) di %. Jangkar: %', n, p_fn, left(p_anchor, 120); end if;
  execute replace(def, p_anchor, p_new);
end $$;

select skema_v2_splice('create_order',
  $a$  if v_pay = 'wallet' then
    select balance into v_bal from wallets where user_id = v_uid for update;$a$,
  $a$  if v_pay = 'wallet' and v_pg_ch = any (payment_gateway_channel_keys()) then
    -- 0100 bayar per order lewat gateway: saldo TIDAK dipotong; lunas saat webhook (payment_settle)
    update orders set status = 'awaiting_payment', payment_status = 'unpaid' where id = v_order.id returning * into v_order;
  elsif v_pay = 'wallet' then
    select balance into v_bal from wallets where user_id = v_uid for update;$a$,
  '0100 bayar per order lewat gateway');

select skema_v2_splice('create_order',
  $a$select count(*) into v_active from orders where customer_id = v_uid and status in ('searching','accepted','arrived','in_progress');$a$,
  $a$select count(*) into v_active from orders where customer_id = v_uid and status in ('awaiting_payment','searching','accepted','arrived','in_progress');   -- 0100$a$,
  $a$in ('awaiting_payment','searching'$a$);

select skema_v2_splice('create_order',
  $a$and o.status in ('searching', 'scheduled')$a$,
  $a$and o.status in ('searching', 'scheduled', 'awaiting_payment')$a$,
  $a$'scheduled', 'awaiting_payment'$a$);

select skema_v2_splice('create_order',
  $a$    case when v_sched is not null then 'Booking terjadwal '$a$,
  $a$    case when v_order.status::text = 'awaiting_payment' then 'Menunggu pembayaran ' || payment_channel_label(v_pg_ch) || ' (batas ' || setting_num('order_payment_timeout_min', 15) || ' menit)'   -- 0100
         when v_sched is not null then 'Booking terjadwal '$a$,
  $a$'Menunggu pembayaran '$a$);

drop function if exists public.skema_v2_splice(text, text, text, text, boolean);

comment on function public.create_order(jsonb) is
  'Membuat pesanan untuk semua layanan (ride/car/food/send/box/shop/market). '
  'Sejak 0080 pesanan DITOLAK bila titik jemput berada di kota yang layanannya belum dibuka. '
  'Sejak 0083 idempoten: p.client_request_id yang sama mengembalikan pesanan yang sudah ada. '
  'Sejak 0088/0089 paid_via DITOLAK bila AntarPay/salurannya dimatikan admin. '
  'Sejak 0099 komisi/fee/biaya platform dibaca dari service_economics (snapshot ke orders), promo punya pemilik biaya (promos.funded_by), buku besar order_ledger fase created. '
  'Sejak 0100 paid_via saluran gateway (payment_gateway_channel_keys) → status awaiting_payment, payment_status unpaid, saldo TIDAK dipotong; bayar lewat midtrans-create (purpose=order) → payment_settle.';

-- ---------------------------------------------------------------------
-- 9. Penjaga migrasi
-- ---------------------------------------------------------------------
do $$
declare f bigint; p bigint; def text; n int;
begin
  if not exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'order_status' and e.enumlabel = 'awaiting_payment') then
    raise exception '0100 batal: enum order_status belum punya awaiting_payment';
  end if;
  select count(*) into n from payment_channel_fees;
  if n < 14 then raise exception '0100 batal: payment_channel_fees baru % baris', n; end if;
  select x.fee, x.ppn into f, p from pg_fee_calc('qris', 100000) x;
  if f <> 700 or p <> 0 then raise exception '0100 batal: pg_fee_calc(qris, 100.000) = %/% (harus 700/0: 0,7 %% termasuk PPN)', f, p; end if;
  select x.fee, x.ppn into f, p from pg_fee_calc('bank_transfer', 100000) x;
  if f <> 4000 or p <> 440 then raise exception '0100 batal: pg_fee_calc(bank_transfer) = %/% (harus 4.000/440)', f, p; end if;
  if pg_hold_days('bank_transfer', 'bsi') <> 2 or pg_hold_days('bank_transfer', 'bca') <> 1 then raise exception '0100 batal: hold_days VA salah'; end if;
  select count(*) into n from pg_proc where proname = 'payment_settle' and pronamespace = 'public'::regnamespace;
  if n <> 1 then raise exception '0100 batal: payment_settle harus tepat satu fungsi (ada %)', n; end if;
  def := pg_get_functiondef('public.payment_settle(text,text,jsonb,text,timestamptz)'::regprocedure);
  if position('''payment_id'', p.id' in def) = 0 or position('ledger_post(o.id, ''created'')' in def) = 0 then
    raise exception '0100 batal: payment_settle tidak lengkap';
  end if;
  if has_function_privilege('authenticated', 'public.payment_settle(text,text,jsonb,text,timestamptz)', 'EXECUTE')
     or has_function_privilege('anon', 'public.payment_settle(text,text,jsonb,text,timestamptz)', 'EXECUTE') then
    raise exception '0100 batal: payment_settle terbuka untuk klien';
  end if;
  if has_function_privilege('authenticated', 'public.expire_unpaid_orders()', 'EXECUTE') then raise exception '0100 batal: expire_unpaid_orders terbuka untuk klien'; end if;
  if has_function_privilege('anon', 'public.admin_set_payment_channel_fee(text,jsonb)', 'EXECUTE')
     or has_function_privilege('anon', 'public.order_payment_prepare(uuid,text)', 'EXECUTE') then raise exception '0100 batal: RPC terbuka untuk anon'; end if;
  if has_table_privilege('authenticated', 'public.payment_channel_fees', 'UPDATE') or has_table_privilege('anon', 'public.payment_channel_fees', 'SELECT') then
    raise exception '0100 batal: payment_channel_fees terbuka untuk klien';
  end if;
  def := pg_get_functiondef('public.create_order(jsonb)'::regprocedure);
  if position('0100 bayar per order lewat gateway' in def) = 0 or position('''Menunggu pembayaran ''' in def) = 0 then
    raise exception '0100 batal: tambalan create_order belum terpasang';
  end if;
  if to_regnamespace('cron') is not null and not exists (select 1 from cron.job where jobname = 'antarkita_expire_unpaid_orders') then
    raise exception '0100 batal: jadwal expire_unpaid_orders belum terpasang';
  end if;
  if not exists (select 1 from app_settings where key = 'order_payment_timeout_min') then raise exception '0100 batal: order_payment_timeout_min belum ada'; end if;
  raise notice '0100 ok: % saluran biaya PG, qris 0,7 %% termasuk PPN, VA Rp4.000 + PPN 440, payment_settle per order, expire_unpaid_orders terjadwal', (select count(*) from payment_channel_fees);
end $$;
