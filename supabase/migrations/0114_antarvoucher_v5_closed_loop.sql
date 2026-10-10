-- =====================================================================
-- 0114 AntarVoucher v5 — model closed-loop penuh tanpa payment gateway
--   • payment_mode (voucher_only | gateway): voucher_only = hanya Tunai & AntarVoucher (saldo); saluran gateway,
--     request_topup, order_payment_prepare, edge pay-*/midtrans-create ditolak dengan PAYMENT_MODE_VOUCHER_ONLY.
--   • Kode voucher (voucher_codes AKV-XXXX-XXXX-XXXX) terbit setelah mutasi bank cocok + disetujui admin lain (0112),
--     auto-redeem ke saldo pembeli (kind wallet_transactions 'voucher_redeem'); kode hadiah bisa ditukar manual.
--   • Batas saldo per peran (cap pelanggan/mitra) + pemantau float BI (PADG 32/2025 Ps. 21) + alarm.
--   • Deposit mitra: driver/mitra travel wajib saldo ≥ driver_min_balance_accept (DEPOSIT_REQUIRED).
--   • Pajak: PPN inklusif atas pendapatan platform diposting sebagai entry ledger tax_output (funded_by 'inclusive');
--     platform_revenue tetap kotor, platform_revenue_net = R − tax. PPh mitra = memo (funded_by 'pph') [OPSIONAL].
--   • Pencairan: sla_due_at (+payout_sla_hours), batch transfer massal (payout_batches), settle per baris (ok/failed),
--     pemantau SLA (payout_sla_check → security_events 'payout.sla_breach').
--   • Target kota (city_targets) + progres vs realisasi + COGS/order + rekomendasi biaya layanan.
-- Tanggal: 10 Okt 2026 · branch antarvoucher-v5 · dasar: 0112 AntarVoucher. Kontrak: docs/antarvoucher/KONTRAK-V5.md
-- Idempoten: semua create ... if not exists / or replace; tambalan fungsi lewat _v3_splice (penanda idempoten).
-- Rollback: supabase/rollback/0114_down.sql (nilai enum wallet_tx_type 'voucher_redeem' TIDAK bisa dicabut — PostgreSQL).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Cadangan fungsi yang diubah/ditambah (untuk rollback _mig_restore('0114'))
-- ---------------------------------------------------------------------
do $$
declare s text;
begin
  foreach s in array array[
    -- diubah (definisi lama disimpan)
    'public.payment_channel_enabled(text)', 'public.payment_channel_require(text)', 'public.payment_channel_require_order(text)',
    'public.request_topup(bigint,text,text,text)', 'public.order_payment_prepare(uuid,text)',
    'public.voucher_purchase_create(bigint,text,text)', 'public.voucher_status_public()', 'public.admin_voucher_approve(uuid,text)',
    'public.voucher_expire_due()', 'public.wallet_tx_before_insert()',
    'public.driver_accept_order(uuid)', 'public.driver_set_online(boolean,double precision,double precision)',
    'public.travel_accept_send(uuid)', 'public.travel_offer_create(uuid,bigint,jsonb,text)',
    'public.request_withdrawal(bigint,text,text,text)', 'public.ledger_calc(orders)', 'public.ledger_check(uuid)',
    'public.app_setting_specs()', 'public.admin_set_settings(jsonb)', 'public.setting_json_validate(text,jsonb)',
    -- baru (NULL → dihapus saat rollback)
    'public.payment_mode()', 'public.payment_mode_voucher_only()', 'public.payment_mode_require_channel(text)',
    'public.admin_set_payment_mode(text)', 'public.voucher_public_config()', 'public.tax_settings_public()', 'public.admin_set_tax_settings(jsonb)',
    'public.voucher_code_gen()', 'public.voucher_balance_cap(uuid)', 'public.voucher_float_total()', 'public.voucher_float_status(text)',
    'public.voucher_purchase_limits_check(uuid,bigint)', 'public.voucher_code_purchase_create(bigint,text,text)', 'public.my_voucher_codes()',
    'public.voucher_code_redeem_to(uuid,uuid,uuid)', 'public.voucher_code_redeem(text)', 'public.voucher_code_on_approve(uuid,bigint,text)',
    'public.driver_deposit_require(uuid)', 'public.driver_deposit_status()',
    'public.admin_set_city_targets(jsonb)', 'public.city_targets_progress(date,text)',
    'public.admin_payout_batch_create()', 'public.admin_payout_batch_export(uuid)', 'public.admin_payout_batch_settle(uuid,jsonb)',
    'public.payout_sla_check()', 'public.admin_payout_queue()'] loop
    perform _mig_backup('0114', s);
  end loop;
end $$;

create table if not exists public._migration_backup_settings (
  version text not null, key text not null, value jsonb, saved_at timestamptz not null default now(),
  primary key (version, key));
alter table public._migration_backup_settings enable row level security;
revoke all on public._migration_backup_settings from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 1. Setelan v5 (hanya mengisi yang belum ada; nilai v5 yang MENIMPA pilihan lama ditulis sekali — saat payment_mode belum ada)
-- ---------------------------------------------------------------------
do $$
declare v_first boolean := not exists (select 1 from app_settings where key = 'payment_mode');
begin
  insert into _migration_backup_settings (version, key, value)
  select '0114', key, value from app_settings
   where key in ('driver_debt_limit', 'auto_payout_max', 'auto_payout_daily_max', 'auto_payout_enabled', 'payment_channels', 'pg_methods', 'gateway_order_payment_enabled')
  on conflict (version, key) do nothing;

  insert into app_settings (key, value) values
    ('voucher_denominations',         '[20000,50000,100000,200000,500000,1000000]'::jsonb),
    ('voucher_min_nominal',           '20000'::jsonb),
    ('voucher_max_nominal',           '2000000'::jsonb),
    ('voucher_balance_cap_customer',  '2000000'::jsonb),
    ('voucher_balance_cap_partner',   '5000000'::jsonb),
    ('voucher_float_limit',           '1000000000'::jsonb),     -- ambang BI PADG 32/2025 Ps. 21 [FAKTA SUMBER]
    ('voucher_float_alert_pct',       '65'::jsonb),
    ('voucher_code_ttl_hours',        '720'::jsonb),
    ('voucher_auto_redeem',           'true'::jsonb),
    ('driver_deposit_required',       'true'::jsonb),
    ('driver_min_balance_accept',     '0'::jsonb),
    ('ppn_pct',                       '11'::jsonb),             -- [ASUMSI tarif — konfirmasi konsultan pajak]
    ('ppn_inclusive',                 'true'::jsonb),
    ('pph_partner_pct',               '0'::jsonb),
    ('payout_sla_hours',              '24'::jsonb),
    ('payout_batch_cutoffs',          '["10:00","15:00"]'::jsonb),
    ('payout_fee_per_withdrawal',     '0'::jsonb),
    ('cogs_margin_target_pct',        '30'::jsonb),
    ('auto_payout_enabled',           'true'::jsonb),
    ('auto_payout_max',               '1000000'::jsonb),
    ('auto_payout_daily_max',         '5000000'::jsonb)
  on conflict (key) do nothing;

  if v_first then
    insert into app_settings (key, value) values ('payment_mode', '"voucher_only"'::jsonb) on conflict (key) do nothing;
    -- kontrak §1: driver_debt_limit = 0 bila deposit_required; auto_payout dinaikkan 1 jt / 5 jt per hari
    insert into app_settings (key, value) values ('driver_debt_limit', '0'::jsonb), ('auto_payout_max', '1000000'::jsonb), ('auto_payout_daily_max', '5000000'::jsonb)
    on conflict (key) do update set value = excluded.value, updated_at = now();
    raise notice '0114: pemasangan pertama — payment_mode=voucher_only, driver_debt_limit=0, auto_payout 1jt/5jt (nilai lama di _migration_backup_settings)';
  else
    raise notice '0114: payment_mode sudah ada (%), pilihan admin tidak ditimpa', (select value #>> '{}' from app_settings where key = 'payment_mode');
  end if;
  -- antarvoucher_purchase_enabled SENGAJA tidak diubah (prod false; dibuka admin lewat admin_set_antarvoucher_purchase_enabled setelah rekening terverifikasi)
end $$;

-- ---------------------------------------------------------------------
-- 2. Mode pembayaran
-- ---------------------------------------------------------------------
create or replace function public.payment_mode()
returns text language sql stable security definer set search_path = public as $$
  select case when lower(coalesce((select value #>> '{}' from app_settings where key = 'payment_mode'), 'voucher_only')) = 'gateway' then 'gateway' else 'voucher_only' end;
$$;
grant execute on function public.payment_mode() to anon, authenticated;

create or replace function public.payment_mode_voucher_only()
returns boolean language sql stable security definer set search_path = public as $$
  select payment_mode() = 'voucher_only';
$$;
grant execute on function public.payment_mode_voucher_only() to anon, authenticated;

-- saluran yang boleh di mode voucher_only: cash & antarpay (saldo AntarVoucher)
create or replace function public.payment_mode_require_channel(p_channel text)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if payment_mode_voucher_only() and coalesce(p_channel, '') not in ('cash', 'antarpay') then
    raise exception 'PAYMENT_MODE_VOUCHER_ONLY: pembayaran % tidak tersedia — AntarKita hanya menerima Tunai atau AntarVoucher (saldo)', payment_channel_label(p_channel);
  end if;
end $$;
grant execute on function public.payment_mode_require_channel(text) to anon, authenticated;

-- payment_channel_enabled: saluran selain cash/antarpay = mati di voucher_only (payment_channels_public otomatis mengikuti)
select _v3_splice('0114', 'public.payment_channel_enabled(text)',
  $a$  if k = '' then return false; end if;$a$,
  $a$  if k = '' then return false; end if;
  if k not in ('cash', 'antarpay') and payment_mode_voucher_only() then return false; end if;   -- 0114 v5 payment_mode$a$,
  '0114 v5 payment_mode');

select _v3_splice('0114', 'public.payment_channel_require(text)',
  $a$  -- 1) Sakelar global 0088 sebagai induk semua saluran non-tunai.$a$,
  $a$  perform payment_mode_require_channel(v_ch);   -- 0114 v5: voucher_only → hanya cash & antarpay
  -- 1) Sakelar global 0088 sebagai induk semua saluran non-tunai.$a$,
  '0114 v5: voucher_only');

select _v3_splice('0114', 'public.payment_channel_require_order(text)',
  $a$  if v_ch = any (payment_gateway_channel_keys()) and gateway_order_payment_enabled() then$a$,
  $a$  perform payment_mode_require_channel(v_ch);   -- 0114 v5: voucher_only → hanya cash & antarpay
  if v_ch = any (payment_gateway_channel_keys()) and gateway_order_payment_enabled() then$a$,
  '0114 v5: voucher_only');

-- top up saldo (jalur lama/gateway) tidak ada di voucher_only: saldo hanya bertambah lewat pembelian voucher
select _v3_splice('0114', 'public.request_topup(bigint,text,text,text)',
  $a$  perform antarpay_require_enabled();$a$,
  $a$  if payment_mode_voucher_only() then   -- 0114 v5
    raise exception 'PAYMENT_MODE_VOUCHER_ONLY: top up saldo tidak tersedia — beli AntarVoucher (transfer ke rekening resmi PT) lewat menu AntarVoucher';
  end if;
  perform antarpay_require_enabled();$a$,
  '0114 v5');

select _v3_splice('0114', 'public.order_payment_prepare(uuid,text)',
  $a$  if auth.uid() is null then raise exception 'Harus login'; end if;$a$,
  $a$  if auth.uid() is null then raise exception 'Harus login'; end if;
  if payment_mode_voucher_only() then   -- 0114 v5
    raise exception 'PAYMENT_MODE_VOUCHER_ONLY: pembayaran lewat payment gateway tidak tersedia — gunakan Tunai atau AntarVoucher';
  end if;$a$,
  '0114 v5');

create or replace function public.admin_set_payment_mode(p_mode text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_mode text := lower(trim(coalesce(p_mode, ''))); v_old text := payment_mode(); k text; snap jsonb; v_ch jsonb;
begin
  perform admin_require('payment_config');   -- superadmin (RBAC 0107)
  perform admin_require_unlock();
  if v_mode not in ('voucher_only', 'gateway') then raise exception 'Mode pembayaran harus voucher_only | gateway'; end if;
  if v_mode = 'voucher_only' then
    -- simpan setelan saluran saat ini agar bisa dipulihkan ketika kembali ke gateway (reversibel)
    snap := jsonb_build_object(
      'payment_channels', (select value from app_settings where key = 'payment_channels'),
      'pg_methods', (select value from app_settings where key = 'pg_methods'),
      'gateway_order_payment_enabled', (select value from app_settings where key = 'gateway_order_payment_enabled'),
      'saved_at', now());
    if v_old <> 'voucher_only' or not exists (select 1 from app_settings where key = 'payment_mode_snapshot') then
      insert into app_settings (key, value) values ('payment_mode_snapshot', snap)
      on conflict (key) do update set value = excluded.value, updated_at = now();
    end if;
    select case when jsonb_typeof(value) = 'object' then value else '{}'::jsonb end into v_ch from app_settings where key = 'payment_channels';
    v_ch := coalesce(v_ch, '{}'::jsonb);
    foreach k in array payment_gateway_channel_keys() loop v_ch := v_ch || jsonb_build_object(k, false); end loop;
    v_ch := v_ch || jsonb_build_object('cash', true, 'antarpay', true);
    insert into app_settings (key, value) values
      ('payment_channels', v_ch), ('pg_methods', '[]'::jsonb), ('gateway_order_payment_enabled', 'false'::jsonb), ('antarpay_enabled', 'true'::jsonb)
    on conflict (key) do update set value = excluded.value, updated_at = now();
  else
    select value into snap from app_settings where key = 'payment_mode_snapshot';
    if snap is not null then
      if snap ? 'payment_channels' and jsonb_typeof(snap->'payment_channels') = 'object' then
        insert into app_settings (key, value) values ('payment_channels', snap->'payment_channels') on conflict (key) do update set value = excluded.value, updated_at = now();
      end if;
      if snap ? 'pg_methods' and jsonb_typeof(snap->'pg_methods') = 'array' then
        insert into app_settings (key, value) values ('pg_methods', snap->'pg_methods') on conflict (key) do update set value = excluded.value, updated_at = now();
      end if;
      if snap ? 'gateway_order_payment_enabled' and jsonb_typeof(snap->'gateway_order_payment_enabled') = 'boolean' then
        insert into app_settings (key, value) values ('gateway_order_payment_enabled', snap->'gateway_order_payment_enabled') on conflict (key) do update set value = excluded.value, updated_at = now();
      end if;
    end if;
  end if;
  insert into app_settings (key, value) values ('payment_mode', to_jsonb(v_mode))
  on conflict (key) do update set value = excluded.value, updated_at = now();
  perform log_activity('payment.mode_set', 'app_settings', 'payment_mode', 'Mode pembayaran: ' || v_old || ' → ' || v_mode,
    jsonb_build_object('before', v_old, 'after', v_mode, 'channels', (select value from app_settings where key = 'payment_channels')));
  insert into security_events (kind, user_id, detail) values ('payment.mode_set', auth.uid(), jsonb_build_object('before', v_old, 'after', v_mode));
  return jsonb_build_object('payment_mode', payment_mode(), 'before', v_old, 'payment_channels', payment_channels_public(),
    'gateway_order_payment_enabled', gateway_order_payment_enabled(), 'antarvoucher_enabled', antarvoucher_enabled());
end $$;
revoke all on function public.admin_set_payment_mode(text) from public, anon;
grant execute on function public.admin_set_payment_mode(text) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Pajak (PPN inklusif atas pendapatan platform; PPh mitra memo)
-- ---------------------------------------------------------------------
create or replace function public.tax_settings_public()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('ppn_pct', setting_num('ppn_pct', 11),
    'ppn_inclusive', coalesce((select lower(value #>> '{}') = 'true' from app_settings where key = 'ppn_inclusive'), true),
    'label', 'termasuk PPN ' || setting_num('ppn_pct', 11)::text || ' %');
$$;
grant execute on function public.tax_settings_public() to anon, authenticated;

create or replace function public.admin_set_tax_settings(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare k text; v jsonb; n numeric; before jsonb;
begin
  perform admin_require('fee');   -- finance/superadmin
  perform admin_require_unlock();
  if p is null or jsonb_typeof(p) <> 'object' or p = '{}'::jsonb then raise exception 'Pengaturan pajak harus objek JSON'; end if;
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into before from app_settings where key in ('ppn_pct', 'ppn_inclusive', 'pph_partner_pct');
  for k, v in select * from jsonb_each(p) loop
    if k in ('ppn_pct', 'pph_partner_pct') then
      if jsonb_typeof(v) = 'number' then n := (v #>> '{}')::numeric;
      elsif jsonb_typeof(v) = 'string' and btrim(v #>> '{}') ~ '^[0-9]+(\.[0-9]+)?$' then n := btrim(v #>> '{}')::numeric;
      else raise exception 'Nilai % harus angka', k; end if;
      if n < 0 or n > 30 then raise exception 'Nilai % harus 0–30 %%', k; end if;
      insert into app_settings (key, value) values (k, to_jsonb(n)) on conflict (key) do update set value = excluded.value, updated_at = now();
    elsif k = 'ppn_inclusive' then
      if jsonb_typeof(v) = 'boolean' then insert into app_settings (key, value) values (k, v) on conflict (key) do update set value = excluded.value, updated_at = now();
      elsif lower(coalesce(v #>> '{}', '')) in ('true', 'false') then insert into app_settings (key, value) values (k, to_jsonb(lower(v #>> '{}')::boolean)) on conflict (key) do update set value = excluded.value, updated_at = now();
      else raise exception 'Nilai ppn_inclusive harus true|false'; end if;
    else
      raise exception 'SETTING_UNKNOWN: kunci pajak % tidak dikenal (ppn_pct, ppn_inclusive, pph_partner_pct)', k;
    end if;
  end loop;
  perform log_activity('settings.tax_updated', 'app_settings', 'tax', 'Pengaturan pajak diubah: ' || p::text,
    jsonb_build_object('before', before, 'after', (select jsonb_object_agg(key, value) from app_settings where key in ('ppn_pct', 'ppn_inclusive', 'pph_partner_pct'))));
  return tax_settings_public() || jsonb_build_object('pph_partner_pct', setting_num('pph_partner_pct', 0));
end $$;
revoke all on function public.admin_set_tax_settings(jsonb) from public, anon;
grant execute on function public.admin_set_tax_settings(jsonb) to authenticated;

-- ledger_calc: PPN inklusif T = round(R × ppn/(100+ppn)) → entry tax_output (funded_by 'inclusive', sudah di dalam R);
--              PPh mitra (opsional) → entry tax_output funded_by 'pph' sebagai MEMO (tidak mengurangi driver_payable
--              sampai keputusan pajak; lihat KONTRAK §7). Tidak ada pg_fee di voucher_only (pg_fee order = 0).
select _v3_splice('0114', 'public.ledger_calc(orders)',
  $a$  owner uuid; sess_note text := null; e jsonb := '[]'::jsonb; is_cash boolean := (o.payment_method = 'cash');$a$,
  $a$  owner uuid; sess_note text := null; e jsonb := '[]'::jsonb; is_cash boolean := (o.payment_method = 'cash');
  Tx bigint := 0; Tpph bigint := 0; ppn numeric := setting_num('ppn_pct', 11);   -- 0114 v5 pajak
  ppn_incl boolean := coalesce((select lower(value #>> '{}') = 'true' from app_settings where key = 'ppn_inclusive'), true);
  pph numeric := setting_num('pph_partner_pct', 0);$a$,
  '0114 v5 pajak');
select _v3_splice('0114', 'public.ledger_calc(orders)',
  $a$  R := PF + (C - B) + M + sf_platform + ic_platform + f_platform - Dp;$a$,
  $a$  R := PF + (C - B) + M + sf_platform + ic_platform + f_platform - Dp;
  if ppn_incl and ppn > 0 and R > 0 then Tx := round(R * ppn / (100 + ppn))::bigint; end if;   -- 0114 v5: PPN inklusif
  if pph > 0 and drv > 0 then Tpph := round(drv * pph / 100)::bigint; end if;$a$,
  '0114 v5: PPN inklusif');
select _v3_splice('0114', 'public.ledger_calc(orders)',
  $a$'note', 'PPN biaya gateway'); end if;$a$,
  $a$'note', 'PPN biaya gateway'); end if;
  if Tx <> 0 then e := e || jsonb_build_object('entry', 'tax_output', 'amount', -Tx, 'party_role', 'platform', 'funded_by', 'inclusive',
      'note', 'PPN ' || ppn || '% termasuk dalam pendapatan platform ' || R || ' (0114 v5)'); end if;
  if Tpph <> 0 then e := e || jsonb_build_object('entry', 'tax_output', 'amount', -Tpph, 'party_role', 'driver', 'party_id', o.driver_id, 'funded_by', 'pph',
      'note', 'MEMO PPh ' || pph || '% atas pendapatan mitra ' || drv || ' — belum dipotong (0114 v5)'); end if;$a$,
  '0114 v5)');
select _v3_splice('0114', 'public.ledger_calc(orders)',
  $a$    'contribution', R - case when borne = 'platform' then pgf + pgp else 0 end,$a$,
  $a$    'contribution', R - case when borne = 'platform' then pgf + pgp else 0 end,
    'tax_output', Tx, 'ppn_pct', ppn, 'ppn_inclusive', ppn_incl, 'platform_revenue_net', R - Tx, 'pph_memo', Tpph,   -- 0114 v5$a$,
  $m$'platform_revenue_net', R - Tx$m$);

-- ledger_check: tax_output inklusif/memo tidak menambah alokasi (sudah di dalam platform_revenue / driver_payable)
select _v3_splice('0114', 'public.ledger_check(uuid)',
  $a$    coalesce(-sum(amount) filter (where entry = 'tax_output'), 0) as tax,$a$,
  $a$    coalesce(-sum(amount) filter (where entry = 'tax_output'), 0) as tax,
    coalesce(-sum(amount) filter (where entry = 'tax_output' and funded_by = 'inclusive'), 0) as tax_incl,   -- 0114 v5
    coalesce(-sum(amount) filter (where entry = 'tax_output' and funded_by = 'pph'), 0) as tax_pph,$a$,
  '0114 v5');
select _v3_splice('0114', 'public.ledger_check(uuid)',
  $a$    v_alloc := agg.drv + agg.merch + agg.vendor + agg.partner + agg.rev + agg.pg_cust + agg.tax;$a$,
  $a$    v_alloc := agg.drv + agg.merch + agg.vendor + agg.partner + agg.rev + agg.pg_cust + agg.tax - agg.tax_incl - agg.tax_pph;   -- 0114 v5: PPN inklusif & memo PPh$a$,
  '0114 v5: PPN inklusif');
select _v3_splice('0114', 'public.ledger_check(uuid)',
  $a$      'platform_revenue', agg.rev, 'pg_fee_platform', agg.pg_plat, 'pg_fee_customer', agg.pg_cust, 'tax_output', agg.tax, 'contribution', agg.rev - agg.pg_plat,$a$,
  $a$      'platform_revenue', agg.rev, 'pg_fee_platform', agg.pg_plat, 'pg_fee_customer', agg.pg_cust, 'tax_output', agg.tax, 'contribution', agg.rev - agg.pg_plat,
      'tax_inclusive', agg.tax_incl, 'pph_memo', agg.tax_pph, 'platform_revenue_net', agg.rev - agg.tax_incl,   -- 0114 v5$a$,
  $m$'tax_inclusive', agg.tax_incl$m$);

-- ---------------------------------------------------------------------
-- 4. Kode voucher, cap saldo, float
-- ---------------------------------------------------------------------
alter type public.wallet_tx_type add value if not exists 'voucher_redeem';

create table if not exists public.voucher_codes (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  nominal       bigint not null check (nominal > 0),
  status        text not null default 'pending_payment' check (status in ('pending_payment', 'issued', 'redeemed', 'expired', 'void')),
  purchase_id   uuid references public.voucher_purchases(id),
  buyer_id      uuid references public.profiles(id),
  redeemed_by   uuid references public.profiles(id),
  wallet_tx_id  uuid,
  issued_at     timestamptz,
  redeemed_at   timestamptz,
  expires_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists voucher_codes_buyer_idx on public.voucher_codes (buyer_id, created_at desc);
create index if not exists voucher_codes_status_idx on public.voucher_codes (status, expires_at);
comment on table public.voucher_codes is 'AntarVoucher v5 (0114): kode voucher AKV-XXXX-XXXX-XXXX. Terbit setelah pembelian disetujui (0112), ditukar ke saldo (wallet_transactions.type voucher_redeem).';
alter table public.voucher_codes enable row level security;
drop policy if exists voucher_codes_own on public.voucher_codes;
create policy voucher_codes_own on public.voucher_codes for select to authenticated
  using (buyer_id = auth.uid() or redeemed_by = auth.uid() or admin_has('payments_view'));
revoke all on public.voucher_codes from public, anon, authenticated;
grant select on public.voucher_codes to authenticated;
grant all on public.voucher_codes to service_role;

alter table public.voucher_purchases
  add column if not exists code_id uuid references public.voucher_codes(id),
  add column if not exists buyer_role text check (buyer_role in ('customer', 'partner'));

-- 'voucher_redeem' → sumber ledger 'voucher_purchase' (wallet_statement menghitungnya sebagai pembelian)
select _v3_splice('0114', 'public.wallet_tx_before_insert()',
  $a$    when 'topup' then 'topup' when 'payment' then 'order_payment'$a$,
  $a$    when 'topup' then 'topup' when 'voucher_redeem' then 'voucher_purchase' when 'payment' then 'order_payment'$a$,
  'voucher_redeem');

-- kode: alfabet Crockford tanpa 0/O/1/I/L (anti salah baca), 12 karakter acak (gen_random_bytes bila ada)
create or replace function public.voucher_code_gen()
returns text language plpgsql volatile security definer set search_path = public as $$
declare alpha constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; b bytea; s text := ''; i int;
begin
  begin
    b := extensions.gen_random_bytes(12);
  exception when others then
    b := decode(md5(gen_random_uuid()::text || clock_timestamp()::text), 'hex');
  end;
  for i in 0..11 loop s := s || substr(alpha, (get_byte(b, i) % length(alpha)) + 1, 1); end loop;
  return 'AKV-' || substr(s, 1, 4) || '-' || substr(s, 5, 4) || '-' || substr(s, 9, 4);
end $$;
revoke all on function public.voucher_code_gen() from public, anon, authenticated;

create or replace function public.voucher_balance_cap(p_user uuid)
returns bigint language sql stable security definer set search_path = public as $$
  select case when wallet_is_partner(p_user) then voucher_setting_bigint('voucher_balance_cap_partner', 5000000)
              else voucher_setting_bigint('voucher_balance_cap_customer', 2000000) end;
$$;
revoke all on function public.voucher_balance_cap(uuid) from public, anon, authenticated;

create or replace function public.voucher_float_total()
returns bigint language sql stable security definer set search_path = public as $$
  select coalesce(sum(balance), 0)::bigint from wallets where balance > 0;
$$;
revoke all on function public.voucher_float_total() from public, anon, authenticated;

create or replace function public.voucher_float_status(p_exec_token text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_total bigint; v_cust bigint; v_part bigint; v_lim bigint := voucher_setting_bigint('voucher_float_limit', 1000000000);
  v_pct numeric; v_alert_pct numeric := setting_num('voucher_float_alert_pct', 65);
begin
  if not coalesce(is_admin(), false) and (p_exec_token is null or (select user_id from exec_valid(p_exec_token)) is null) then
    raise exception 'Tidak berhak';
  end if;
  select coalesce(sum(balance), 0), coalesce(sum(balance) filter (where not wallet_is_partner(user_id)), 0), coalesce(sum(balance) filter (where wallet_is_partner(user_id)), 0)
    into v_total, v_cust, v_part from wallets where balance > 0;
  v_pct := case when v_lim > 0 then round(v_total * 100.0 / v_lim, 2) else 100 end;
  return jsonb_build_object('total_outstanding', v_total, 'customers', v_cust, 'partners', v_part, 'limit', v_lim, 'pct', v_pct,
    'alert', v_pct >= v_alert_pct, 'alert_pct', v_alert_pct,
    'cap_customer', voucher_setting_bigint('voucher_balance_cap_customer', 2000000), 'cap_partner', voucher_setting_bigint('voucher_balance_cap_partner', 5000000),
    'legal_note', 'UE closed loop tanpa izin PJP selama float < Rp1 miliar (PADG 32/2025 Ps. 21) — [PERLU VERIFIKASI LEGAL]', 'updated_at', now());
end $$;
revoke all on function public.voucher_float_status(text) from public, anon;
grant execute on function public.voucher_float_status(text) to authenticated;

-- cap saldo per peran + batas float (dipanggil pembelian & penukaran)
create or replace function public.voucher_purchase_limits_check(p_user uuid, p_nominal bigint)
returns void language plpgsql stable security definer set search_path = public as $$
declare v_bal bigint := coalesce((select balance from wallets where user_id = p_user), 0); v_cap bigint := voucher_balance_cap(p_user);
  v_lim bigint := voucher_setting_bigint('voucher_float_limit', 1000000000);
begin
  if v_bal + p_nominal > v_cap then
    raise exception 'VOUCHER_BALANCE_CAP: saldo AntarVoucher maksimal Rp% (saldo sekarang Rp%)', replace(to_char(v_cap, 'FM999,999,999,999'), ',', '.'), replace(to_char(v_bal, 'FM999,999,999,999'), ',', '.');
  end if;
  if voucher_float_total() + p_nominal > v_lim then
    raise exception 'VOUCHER_FLOAT_LIMIT: total dana AntarVoucher beredar akan melampaui ambang Rp% — pembelian ditahan sementara', replace(to_char(v_lim, 'FM999,999,999,999'), ',', '.');
  end if;
end $$;
revoke all on function public.voucher_purchase_limits_check(uuid, bigint) from public, anon, authenticated;

-- kunci batas nominal kanonik v5 (voucher_min_nominal / voucher_max_nominal) menggantikan voucher_purchase_min/max di fungsi 0112
select _v3_splice('0114', 'public.voucher_purchase_create(bigint,text,text)', $a$voucher_setting_bigint('voucher_purchase_min', 20000)$a$, $a$voucher_setting_bigint('voucher_min_nominal', 20000)$a$, 'voucher_min_nominal', true);
select _v3_splice('0114', 'public.voucher_purchase_create(bigint,text,text)', $a$voucher_setting_bigint('voucher_purchase_max', 2000000)$a$, $a$voucher_setting_bigint('voucher_max_nominal', 2000000)$a$, 'voucher_max_nominal', true);
select _v3_splice('0114', 'public.voucher_status_public()', $a$voucher_setting_bigint('voucher_purchase_min', 20000)$a$, $a$voucher_setting_bigint('voucher_min_nominal', 20000)$a$, 'voucher_min_nominal', true);
select _v3_splice('0114', 'public.voucher_status_public()', $a$voucher_setting_bigint('voucher_purchase_max', 2000000)$a$, $a$voucher_setting_bigint('voucher_max_nominal', 2000000)$a$, 'voucher_max_nominal', true);
-- cap + float diperiksa di pembelian (jalur lama & v5 sama-sama lewat sini)
select _v3_splice('0114', 'public.voucher_purchase_create(bigint,text,text)',
  $a$  select * into b from company_bank_accounts where bank_code = lower(trim(p_bank_code)) and voucher_bank_account_public_ok(company_bank_accounts)$a$,
  $a$  perform voucher_purchase_limits_check(v_uid, p_nominal);   -- 0114 v5: cap saldo per peran + batas float BI
  select * into b from company_bank_accounts where bank_code = lower(trim(p_bank_code)) and voucher_bank_account_public_ok(company_bank_accounts)$a$,
  '0114 v5: cap saldo');

create or replace function public.voucher_code_purchase_create(p_nominal bigint, p_bank_code text, p_idempotency_key text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); r jsonb; v voucher_purchases; c voucher_codes; v_try int := 0;
begin
  if v_uid is null then raise exception 'Harus login'; end if;
  r := voucher_purchase_create(p_nominal, p_bank_code, p_idempotency_key);   -- validasi 0112 + cap/float (tambalan 0114)
  select * into v from voucher_purchases where id = (r->>'id')::uuid for update;
  if v.code_id is not null then
    select * into c from voucher_codes where id = v.code_id;
  else
    loop
      v_try := v_try + 1;
      begin
        insert into voucher_codes (code, nominal, status, purchase_id, buyer_id) values (voucher_code_gen(), v.nominal, 'pending_payment', v.id, v.user_id) returning * into c;
        exit;
      exception when unique_violation then
        if v_try >= 10 then raise exception 'VOUCHER_BUSY: coba lagi sebentar'; end if;
      end;
    end loop;
    update voucher_purchases set code_id = c.id, buyer_role = case when wallet_is_partner(v.user_id) then 'partner' else 'customer' end, updated_at = now() where id = v.id;
    perform log_activity('voucher.code_create', 'voucher_codes', c.id::text, 'Kode AntarVoucher ' || c.code || ' (menunggu transfer ' || v.reference || ')', jsonb_build_object('nominal', c.nominal, 'purchase', v.id));
  end if;
  return jsonb_build_object('purchase', r || jsonb_build_object('code_id', c.id, 'buyer_role', (select buyer_role from voucher_purchases where id = v.id)), 'code', to_jsonb(c));
end $$;
revoke all on function public.voucher_code_purchase_create(bigint, text, text) from public, anon;
grant execute on function public.voucher_code_purchase_create(bigint, text, text) to authenticated;

create or replace function public.my_voucher_codes()
returns setof jsonb language sql stable security definer set search_path = public as $$
  select to_jsonb(c) || jsonb_build_object('reference', p.reference, 'purchase_status', p.status, 'transfer_amount', p.transfer_amount,
           'is_buyer', c.buyer_id = auth.uid(), 'can_redeem', c.status = 'issued' and (c.expires_at is null or c.expires_at > now()))
    from voucher_codes c left join voucher_purchases p on p.id = c.purchase_id
   where c.buyer_id = auth.uid() or c.redeemed_by = auth.uid()
   order by c.created_at desc limit 100;
$$;
revoke all on function public.my_voucher_codes() from public, anon;
grant execute on function public.my_voucher_codes() to authenticated;

-- inti penukaran (internal): cap saldo, kredit 'voucher_redeem', kolom audit ledger, status kode
create or replace function public.voucher_code_redeem_to(p_code_id uuid, p_user uuid, p_approver uuid default null)
returns wallet_transactions language plpgsql security definer set search_path = public as $$
declare c voucher_codes; p voucher_purchases; m voucher_bank_mutations; v_bal bigint; v_cap bigint; t wallet_transactions; v_idem text; v_ref text;
begin
  select * into c from voucher_codes where id = p_code_id for update;
  if not found then raise exception 'VOUCHER_CODE_INVALID: kode tidak ditemukan'; end if;
  if c.status = 'redeemed' then raise exception 'VOUCHER_CODE_USED: kode % sudah pernah ditukarkan', c.code; end if;
  if c.status = 'expired' then raise exception 'VOUCHER_CODE_EXPIRED: kode % sudah kedaluwarsa (%)', c.code, to_char(c.expires_at at time zone 'Asia/Jakarta', 'DD Mon YYYY HH24:MI'); end if;
  if c.status <> 'issued' then raise exception 'VOUCHER_CODE_STATE: kode % belum aktif (status %)', c.code, c.status; end if;
  if c.expires_at is not null and c.expires_at <= now() then
    update voucher_codes set status = 'expired', updated_at = now() where id = c.id;
    raise exception 'VOUCHER_CODE_EXPIRED: kode % kedaluwarsa sejak %', c.code, to_char(c.expires_at at time zone 'Asia/Jakarta', 'DD Mon YYYY HH24:MI');
  end if;
  perform antarpay_require_enabled();
  select coalesce(balance, 0) into v_bal from wallets where user_id = p_user for update;
  v_cap := voucher_balance_cap(p_user);
  if coalesce(v_bal, 0) + c.nominal > v_cap then
    raise exception 'VOUCHER_BALANCE_CAP: saldo AntarVoucher maksimal Rp% — gunakan saldo dulu sebelum menukar kode', replace(to_char(v_cap, 'FM999,999,999,999'), ',', '.');
  end if;
  if c.purchase_id is not null then
    select * into p from voucher_purchases where id = c.purchase_id;
    if p.mutation_id is not null then select * into m from voucher_bank_mutations where id = p.mutation_id; end if;
  end if;
  v_idem := case when c.purchase_id is not null then 'voucher:' || c.purchase_id else 'voucher_code:' || c.id end;
  v_ref := coalesce(p.reference, c.code);
  perform wallet_apply(p_user, 'voucher_redeem', c.nominal, null, 'Tukar AntarVoucher ' || c.code, v_ref);
  select * into t from wallet_transactions where user_id = p_user and ref = v_ref and type::text = 'voucher_redeem' order by seq desc limit 1;
  perform set_config('antarkita.ledger_maintenance', 'on', true);
  update wallet_transactions set idempotency_key = v_idem, bank_ref = m.bank_ref, approved_by = p_approver, source = 'voucher_purchase' where id = t.id;
  perform set_config('antarkita.ledger_maintenance', 'off', true);
  update voucher_codes set status = 'redeemed', redeemed_by = p_user, redeemed_at = now(), wallet_tx_id = t.id, updated_at = now() where id = c.id;
  if c.purchase_id is not null then update voucher_purchases set wallet_tx_id = t.id, updated_at = now() where id = c.purchase_id and wallet_tx_id is null; end if;
  perform log_activity('voucher.code_redeem', 'voucher_codes', c.id::text, 'Kode ' || c.code || ' ditukar Rp' || c.nominal, jsonb_build_object('user_id', p_user, 'tx', t.id, 'auto', p_approver is not null));
  select * into t from wallet_transactions where id = t.id;
  return t;
end $$;
revoke all on function public.voucher_code_redeem_to(uuid, uuid, uuid) from public, anon, authenticated;

create or replace function public.voucher_code_redeem(p_code text)
returns wallet_transactions language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); c voucher_codes; v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
begin
  if v_uid is null then raise exception 'Harus login'; end if;
  if not rate_take('voucher_redeem', 10) then raise exception 'RATE_LIMIT: terlalu banyak percobaan tukar kode dalam 1 jam. Coba lagi nanti.'; end if;
  if v_code like 'AKV%' then v_code := substr(v_code, 4); end if;
  if length(v_code) <> 12 then raise exception 'VOUCHER_CODE_INVALID: format kode AKV-XXXX-XXXX-XXXX'; end if;
  v_code := 'AKV-' || substr(v_code, 1, 4) || '-' || substr(v_code, 5, 4) || '-' || substr(v_code, 9, 4);
  select * into c from voucher_codes where code = v_code;
  if not found then
    insert into security_events (kind, user_id, detail) values ('voucher.code_invalid', v_uid, jsonb_build_object('code', v_code));
    raise exception 'VOUCHER_CODE_INVALID: kode tidak ditemukan';
  end if;
  return voucher_code_redeem_to(c.id, v_uid, null);
end $$;
revoke all on function public.voucher_code_redeem(text) from public, anon;
grant execute on function public.voucher_code_redeem(text) to authenticated;

-- dipanggil admin_voucher_approve (0112) bila pembelian punya kode: terbitkan kode sebesar dana diterima, auto-redeem bila disetel
create or replace function public.voucher_code_on_approve(p_purchase uuid, p_amount bigint, p_bank_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v voucher_purchases; c voucher_codes; t wallet_transactions; v_auto boolean := coalesce((select lower(value #>> '{}') = 'true' from app_settings where key = 'voucher_auto_redeem'), true);
  v_ttl int := greatest(1, voucher_setting_bigint('voucher_code_ttl_hours', 720)::int); v_note text := 'issued';
begin
  select * into v from voucher_purchases where id = p_purchase;
  select * into c from voucher_codes where id = v.code_id for update;
  if not found then raise exception 'VOUCHER_CODE_STATE: kode pembelian % tidak ditemukan', v.reference; end if;
  if c.status = 'redeemed' then return jsonb_build_object('code', c.code, 'status', c.status, 'tx_id', c.wallet_tx_id); end if;
  if c.status not in ('pending_payment', 'issued', 'expired') then raise exception 'VOUCHER_CODE_STATE: kode % berstatus %', c.code, c.status; end if;
  update voucher_codes set nominal = p_amount, status = 'issued', issued_at = coalesce(issued_at, now()),
         expires_at = now() + make_interval(hours => v_ttl), updated_at = now() where id = c.id returning * into c;
  if v_auto then
    if coalesce((select balance from wallets where user_id = v.user_id), 0) + c.nominal > voucher_balance_cap(v.user_id) then
      v_note := 'issued_cap';   -- cap saldo: kode tetap terbit, pelanggan menukar sendiri setelah saldo terpakai
    else
      t := voucher_code_redeem_to(c.id, v.user_id, auth.uid());
      v_note := 'redeemed';
    end if;
  end if;
  return jsonb_build_object('code', c.code, 'code_id', c.id, 'status', v_note, 'tx_id', t.id, 'expires_at', c.expires_at);
end $$;
revoke all on function public.voucher_code_on_approve(uuid, bigint, text) from public, anon, authenticated;

select _v3_splice('0114', 'public.admin_voucher_approve(uuid,text)',
  $a$  v_bal := wallet_apply(v.user_id, 'topup', m.amount, null, 'Pembelian AntarVoucher ' || v.reference, v.reference);
  select id into v_tx from wallet_transactions where user_id = v.user_id and ref = v.reference and type = 'topup' order by created_at desc limit 1;
  -- lengkapi baris ledger yang baru dibuat (append-only: gunakan jalur pemeliharaan terkendali untuk kolom audit baris baru ini)
  perform set_config('antarkita.ledger_maintenance', 'on', true);
  update wallet_transactions set idempotency_key = 'voucher:' || v.id, bank_ref = m.bank_ref, approved_by = auth.uid(), source = 'voucher_purchase'
   where id = v_tx;
  perform set_config('antarkita.ledger_maintenance', 'off', true);$a$,
  $a$  if v.code_id is not null then   -- 0114 v5: kode voucher terbit (auto-redeem → kind voucher_redeem)
    v_tx := (voucher_code_on_approve(v.id, m.amount, m.bank_ref)->>'tx_id')::uuid;
    select coalesce(balance, 0) into v_bal from wallets where user_id = v.user_id;
  else
  v_bal := wallet_apply(v.user_id, 'topup', m.amount, null, 'Pembelian AntarVoucher ' || v.reference, v.reference);
  select id into v_tx from wallet_transactions where user_id = v.user_id and ref = v.reference and type = 'topup' order by created_at desc limit 1;
  -- lengkapi baris ledger yang baru dibuat (append-only: gunakan jalur pemeliharaan terkendali untuk kolom audit baris baru ini)
  perform set_config('antarkita.ledger_maintenance', 'on', true);
  update wallet_transactions set idempotency_key = 'voucher:' || v.id, bank_ref = m.bank_ref, approved_by = auth.uid(), source = 'voucher_purchase'
   where id = v_tx;
  perform set_config('antarkita.ledger_maintenance', 'off', true);
  end if;$a$,
  '0114 v5: kode voucher terbit');

-- kedaluwarsa: kode terbit lewat expires_at → expired (saldo tidak tersentuh); kode pembelian batal/tolak/refund → void
select _v3_splice('0114', 'public.voucher_expire_due()', $a$declare n int;$a$, $a$declare n int; n2 int := 0;$a$, 'n2 int');
select _v3_splice('0114', 'public.voucher_expire_due()',
  $a$  get diagnostics n = row_count;$a$,
  $a$  get diagnostics n = row_count;
  update voucher_codes set status = 'expired', updated_at = now() where status = 'issued' and expires_at is not null and expires_at <= now();   -- 0114 v5
  get diagnostics n2 = row_count; n := n + n2;
  update voucher_codes c set status = 'void', updated_at = now() from voucher_purchases p
   where p.id = c.purchase_id and c.status = 'pending_payment' and p.status in ('cancelled', 'rejected', 'refunded');
  get diagnostics n2 = row_count; n := n + n2;$a$,
  '0114 v5');

create or replace function public.voucher_public_config()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'brand', 'AntarVoucher',
    'payment_mode', payment_mode(),
    'enabled', antarvoucher_enabled(),
    'purchase_enabled', (voucher_status_public()->>'purchase_enabled')::boolean,
    'denominations', coalesce((select value from app_settings where key = 'voucher_denominations' and jsonb_typeof(value) = 'array'), '[20000,50000,100000,200000,500000,1000000]'::jsonb),
    'min', voucher_setting_bigint('voucher_min_nominal', 20000), 'max', voucher_setting_bigint('voucher_max_nominal', 2000000),
    'cap_customer', voucher_setting_bigint('voucher_balance_cap_customer', 2000000), 'cap_partner', voucher_setting_bigint('voucher_balance_cap_partner', 5000000),
    'code_ttl_hours', voucher_setting_bigint('voucher_code_ttl_hours', 720),
    'auto_redeem', coalesce((select lower(value #>> '{}') = 'true' from app_settings where key = 'voucher_auto_redeem'), true),
    'purchase_ttl_hours', voucher_setting_bigint('voucher_purchase_ttl_hours', 24),
    'legal_entity', (select value #>> '{}' from app_settings where key = 'voucher_legal_entity_name'),
    'banks', coalesce((select jsonb_agg(to_jsonb(b)) from voucher_bank_accounts_public() b), '[]'::jsonb),
    'tax', tax_settings_public());
$$;
grant execute on function public.voucher_public_config() to anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. Deposit mitra (driver & mitra travel)
-- ---------------------------------------------------------------------
create or replace function public.driver_deposit_require(p_user uuid)
returns void language plpgsql stable security definer set search_path = public as $$
declare v_req boolean := coalesce((select lower(value #>> '{}') = 'true' from app_settings where key = 'driver_deposit_required'), true);
  v_min bigint := greatest(0, setting_num('driver_min_balance_accept', 0))::bigint; v_bal bigint := coalesce((select balance from wallets where user_id = p_user), 0);
begin
  if not v_req then return; end if;
  if v_bal < v_min then
    raise exception 'DEPOSIT_REQUIRED: saldo AntarVoucher minimal Rp% untuk menerima order (saldo Anda Rp%). Beli AntarVoucher dulu.',
      replace(to_char(v_min, 'FM999,999,999,999'), ',', '.'), replace(to_char(v_bal, 'FM999,999,999,999'), ',', '.');
  end if;
end $$;
revoke all on function public.driver_deposit_require(uuid) from public, anon, authenticated;

create or replace function public.driver_deposit_status()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'required', coalesce((select lower(value #>> '{}') = 'true' from app_settings where key = 'driver_deposit_required'), true),
    'min_balance', greatest(0, setting_num('driver_min_balance_accept', 0))::bigint,
    'balance', coalesce((select balance from wallets where user_id = auth.uid()), 0),
    'can_accept', (not coalesce((select lower(value #>> '{}') = 'true' from app_settings where key = 'driver_deposit_required'), true))
                  or coalesce((select balance from wallets where user_id = auth.uid()), 0) >= greatest(0, setting_num('driver_min_balance_accept', 0))::bigint,
    'shortfall', greatest(0, greatest(0, setting_num('driver_min_balance_accept', 0))::bigint - coalesce((select balance from wallets where user_id = auth.uid()), 0)),
    'cap_partner', voucher_setting_bigint('voucher_balance_cap_partner', 5000000),
    'purchase_enabled', (voucher_status_public()->>'purchase_enabled')::boolean);
$$;
revoke all on function public.driver_deposit_status() from public, anon;
grant execute on function public.driver_deposit_status() to authenticated;

select _v3_splice('0114', 'public.driver_accept_order(uuid)',
  $a$  select count(*) into v_active from orders where driver_id = d.id and status in ('accepted','arrived','in_progress');$a$,
  $a$  perform driver_deposit_require(d.id);   -- 0114 v5 deposit AntarVoucher
  select count(*) into v_active from orders where driver_id = d.id and status in ('accepted','arrived','in_progress');$a$,
  '0114 v5 deposit');
select _v3_splice('0114', 'public.driver_set_online(boolean,double precision,double precision)',
  $a$    if p_lat is null and d.location is null then raise exception 'Lokasi belum tersedia, aktifkan GPS'; end if;$a$,
  $a$    perform driver_deposit_require(d.id);   -- 0114 v5 deposit AntarVoucher
    if p_lat is null and d.location is null then raise exception 'Lokasi belum tersedia, aktifkan GPS'; end if;$a$,
  '0114 v5 deposit');
select _v3_splice('0114', 'public.travel_offer_create(uuid,bigint,jsonb,text)',
  $a$  select * into r from travel_requests where id = p_request for update;$a$,
  $a$  perform driver_deposit_require(tp.id);   -- 0114 v5 deposit AntarVoucher
  select * into r from travel_requests where id = p_request for update;$a$,
  '0114 v5 deposit');
select _v3_splice('0114', 'public.travel_accept_send(uuid)',
  $a$  select * into o from orders where id = p_order for update;$a$,
  $a$  perform driver_deposit_require(tp.id);   -- 0114 v5 deposit AntarVoucher
  select * into o from orders where id = p_order for update;$a$,
  '0114 v5 deposit');

-- ---------------------------------------------------------------------
-- 6. Pencairan: SLA, batch transfer massal, pemantau SLA, antrean
-- ---------------------------------------------------------------------
create table if not exists public.payout_batches (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  created_by   uuid references public.profiles(id),
  cutoff       text,
  status       text not null default 'open' check (status in ('open', 'exported', 'settled')),
  total        bigint not null default 0,
  count        int not null default 0,
  exported_at  timestamptz,
  exported_by  uuid references public.profiles(id),
  settled_at   timestamptz,
  settled_by   uuid references public.profiles(id),
  note         text
);
comment on table public.payout_batches is 'AntarVoucher v5 (0114): batch transfer massal pencairan mitra (CSV bank). Ditulis hanya lewat RPC admin.';
alter table public.payout_batches enable row level security;
drop policy if exists payout_batches_admin on public.payout_batches;
create policy payout_batches_admin on public.payout_batches for select to authenticated using (admin_has('payments_view'));
revoke all on public.payout_batches from public, anon, authenticated;
grant select on public.payout_batches to authenticated;
grant all on public.payout_batches to service_role;

alter table public.withdrawal_requests
  add column if not exists sla_due_at timestamptz,
  add column if not exists batch_id uuid references public.payout_batches(id);
create index if not exists withdrawal_requests_batch_idx on public.withdrawal_requests (batch_id) where batch_id is not null;
create index if not exists withdrawal_requests_sla_idx on public.withdrawal_requests (sla_due_at) where settled_at is null and status in ('pending', 'approved');
-- isi balik permintaan lama yang belum selesai
update public.withdrawal_requests set sla_due_at = created_at + make_interval(hours => greatest(1, setting_num('payout_sla_hours', 24)::int))
 where sla_due_at is null and settled_at is null and status in ('pending', 'approved');

select _v3_splice('0114', 'public.request_withdrawal(bigint,text,text,text)',
  $a$  insert into withdrawal_requests (user_id, amount, bank_name, bank_account, account_name) values (auth.uid(), p_amount, p_bank, p_account, p_name) returning * into w;$a$,
  $a$  insert into withdrawal_requests (user_id, amount, bank_name, bank_account, account_name, sla_due_at)   -- 0114 v5: SLA pencairan
  values (auth.uid(), p_amount, p_bank, p_account, p_name, now() + make_interval(hours => greatest(1, setting_num('payout_sla_hours', 24)::int))) returning * into w;$a$,
  '0114 v5: SLA pencairan');

create or replace function public.admin_payout_batch_create()
returns payout_batches language plpgsql security definer set search_path = public as $$
declare b payout_batches; n int; v_total bigint;
begin
  perform admin_require('payout');
  perform admin_require_unlock();
  select count(*), coalesce(sum(amount), 0) into n, v_total from withdrawal_requests
   where status = 'approved' and settled_at is null and batch_id is null and payout_status = 'PAYOUT_PENDING' and provider = 'manual';
  if n = 0 then raise exception 'PAYOUT_BATCH_EMPTY: tidak ada pencairan approved yang menunggu batch'; end if;
  insert into payout_batches (created_by, cutoff, status, total, count)
  values (auth.uid(), to_char(now() at time zone 'Asia/Jakarta', 'YYYY-MM-DD HH24:MI'), 'open', v_total, n) returning * into b;
  update withdrawal_requests set batch_id = b.id
   where status = 'approved' and settled_at is null and batch_id is null and payout_status = 'PAYOUT_PENDING' and provider = 'manual';
  perform log_activity('payout.batch_create', 'payout_batches', b.id::text, 'Batch pencairan dibuat: ' || n || ' transfer, Rp' || v_total, jsonb_build_object('count', n, 'total', v_total));
  return b;
end $$;
revoke all on function public.admin_payout_batch_create() from public, anon;
grant execute on function public.admin_payout_batch_create() to authenticated;

create or replace function public.admin_payout_batch_export(p_batch uuid)
returns table (withdrawal_id uuid, user_id uuid, nama text, bank_code text, account_no text, amount bigint, note text)
language plpgsql security definer set search_path = public as $$
declare b payout_batches;
begin
  perform admin_require('payout');
  select * into b from payout_batches where id = p_batch for update;
  if not found then raise exception 'Batch tidak ditemukan'; end if;
  if b.status = 'open' then
    update payout_batches set status = 'exported', exported_at = now(), exported_by = auth.uid() where id = b.id;
    perform log_activity('payout.batch_export', 'payout_batches', b.id::text, 'Batch pencairan diekspor (' || b.count || ' transfer)', null);
  end if;
  return query
    select w.id, w.user_id, w.account_name, w.bank_name, w.bank_account, w.amount, 'AntarKita payout ' || left(w.id::text, 8)
      from withdrawal_requests w where w.batch_id = p_batch and w.settled_at is null and w.status = 'approved' order by w.created_at;
end $$;
revoke all on function public.admin_payout_batch_export(uuid) from public, anon;
grant execute on function public.admin_payout_batch_export(uuid) to authenticated;

create or replace function public.admin_payout_batch_settle(p_batch uuid, p_refs jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b payout_batches; x jsonb; w withdrawal_requests; v_ok int := 0; v_fail int := 0; v_left int; v_status text; v_reason text;
begin
  perform admin_require('payout');
  perform admin_require_unlock();
  select * into b from payout_batches where id = p_batch for update;
  if not found then raise exception 'Batch tidak ditemukan'; end if;
  if b.status = 'settled' then raise exception 'Batch sudah settled'; end if;
  if p_refs is null or jsonb_typeof(p_refs) <> 'array' or jsonb_array_length(p_refs) = 0 then raise exception 'p_refs harus larik [{withdrawal_id, bank_ref, status: ok|failed, reason}]'; end if;
  for x in select * from jsonb_array_elements(p_refs) loop
    select * into w from withdrawal_requests where id = (x->>'withdrawal_id')::uuid and batch_id = p_batch for update;
    if not found then raise exception 'Penarikan % bukan bagian batch ini', x->>'withdrawal_id'; end if;
    if w.settled_at is not null or w.status <> 'approved' then continue; end if;   -- sudah diproses (idempoten)
    v_status := lower(coalesce(x->>'status', 'ok'));
    if v_status = 'ok' then
      perform admin_mark_withdrawal_settled(w.id, coalesce(nullif(x->>'bank_ref', ''), 'BATCH-' || left(p_batch::text, 8) || '-' || left(w.id::text, 8)));
      v_ok := v_ok + 1;
    elsif v_status = 'failed' then
      v_reason := coalesce(nullif(btrim(x->>'reason'), ''), 'transfer gagal (rekening tidak valid)');
      update withdrawal_requests set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(), review_note = 'Transfer gagal: ' || v_reason,
             failed_reason = v_reason where id = w.id;
      perform wallet_apply(w.user_id, 'refund', w.amount, null, 'Pencairan gagal (' || v_reason || '), saldo dikembalikan', w.id::text);
      insert into notifications (user_id, kind, title, body, data) values (w.user_id, 'system', 'Pencairan gagal, saldo dikembalikan',
        'Transfer Rp' || to_char(w.amount, 'FM999G999G999') || ' ke ' || w.bank_name || ' ' || w.bank_account || ' gagal: ' || v_reason || '. Periksa rekening lalu ajukan lagi.',
        jsonb_build_object('withdrawal_id', w.id));
      perform log_activity('withdrawal.failed', 'withdrawal_requests', w.id::text, 'Pencairan Rp' || w.amount || ' gagal: ' || v_reason, jsonb_build_object('batch', p_batch));
      v_fail := v_fail + 1;
    else
      raise exception 'status % tidak dikenal (ok|failed)', v_status;
    end if;
  end loop;
  select count(*) into v_left from withdrawal_requests where batch_id = p_batch and status = 'approved' and settled_at is null;
  if v_left = 0 then
    update payout_batches set status = 'settled', settled_at = now(), settled_by = auth.uid() where id = p_batch returning * into b;
  end if;
  perform log_activity('payout.batch_settle', 'payout_batches', p_batch::text, 'Batch: ' || v_ok || ' sukses, ' || v_fail || ' gagal, sisa ' || v_left,
    jsonb_build_object('ok', v_ok, 'failed', v_fail, 'remaining', v_left));
  return jsonb_build_object('batch', to_jsonb(b), 'ok', v_ok, 'failed', v_fail, 'remaining', v_left);
end $$;
revoke all on function public.admin_payout_batch_settle(uuid, jsonb) from public, anon;
grant execute on function public.admin_payout_batch_settle(uuid, jsonb) to authenticated;

create or replace function public.payout_sla_check()
returns int language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; a uuid;
begin
  for r in select w.* from withdrawal_requests w
            where w.status in ('pending', 'approved') and w.settled_at is null and w.sla_due_at is not null and w.sla_due_at < now()
              and not exists (select 1 from security_events s where s.kind = 'payout.sla_breach' and s.detail->>'withdrawal_id' = w.id::text) loop
    insert into security_events (kind, user_id, detail) values ('payout.sla_breach', r.user_id,
      jsonb_build_object('withdrawal_id', r.id, 'amount', r.amount, 'status', r.status, 'sla_due_at', r.sla_due_at, 'overdue_min', floor(extract(epoch from now() - r.sla_due_at) / 60)));
    for a in select p.id from profiles p where p.role::text = 'admin' and p.admin_role in ('finance', 'superadmin') and coalesce(p.is_active, true) loop
      insert into notifications (user_id, kind, title, body, data) values (a, 'system', 'SLA pencairan terlampaui',
        'Penarikan Rp' || to_char(r.amount, 'FM999G999G999') || ' (' || r.status || ') lewat SLA sejak ' || to_char(r.sla_due_at at time zone 'Asia/Jakarta', 'DD Mon HH24:MI') || ' WIB.',
        jsonb_build_object('withdrawal_id', r.id, 'kind', 'payout_sla'));
    end loop;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.payout_sla_check() from public, anon, authenticated;
grant execute on function public.payout_sla_check() to service_role;
do $$
begin
  if to_regnamespace('cron') is not null and to_regproc('cron.schedule') is not null then
    perform cron.schedule('antarvoucher-payout-sla', '*/15 * * * *', 'select public.payout_sla_check()');
  end if;
exception when others then raise notice '0114: cron antarvoucher-payout-sla tidak dijadwalkan (%)', sqlerrm;
end $$;

create or replace function public.admin_payout_queue()
returns setof jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform admin_require('payments_view');
  return query
    select to_jsonb(w) || jsonb_build_object('user_name', p.full_name, 'user_role', p.role,
             'sla_remaining_min', case when w.sla_due_at is null then null else floor(extract(epoch from w.sla_due_at - now()) / 60) end,
             'overdue', w.sla_due_at is not null and w.sla_due_at < now(),
             'batch_status', b.status, 'batch_created_at', b.created_at)
      from withdrawal_requests w join profiles p on p.id = w.user_id left join payout_batches b on b.id = w.batch_id
     where w.settled_at is null and w.status in ('pending', 'approved')
     order by (w.sla_due_at is not null and w.sla_due_at < now()) desc, w.sla_due_at nulls last, w.created_at;
end $$;
revoke all on function public.admin_payout_queue() from public, anon;
grant execute on function public.admin_payout_queue() to authenticated;

-- ---------------------------------------------------------------------
-- 7. Target kota & progres (COGS/order, rekomendasi biaya layanan)
-- ---------------------------------------------------------------------
create table if not exists public.city_targets (
  city_id                 uuid not null references public.cities(id) on delete cascade,
  month                   date not null check (extract(day from month) = 1),
  target_orders           int not null default 0 check (target_orders >= 0),
  target_npr              bigint not null default 0 check (target_npr >= 0),
  target_active_drivers   int not null default 0 check (target_active_drivers >= 0),
  target_active_merchants int not null default 0 check (target_active_merchants >= 0),
  pic_ops                 text,
  pic_finance             text,
  note                    text,
  updated_by              uuid references public.profiles(id),
  updated_at              timestamptz not null default now(),
  primary key (city_id, month)
);
comment on table public.city_targets is 'AntarVoucher v5 (0114): target transaksi bulanan per kota (manajer ops & keuangan). Ditulis lewat admin_set_city_targets.';
alter table public.city_targets enable row level security;
drop policy if exists city_targets_admin on public.city_targets;
create policy city_targets_admin on public.city_targets for select to authenticated using (is_admin());
revoke all on public.city_targets from public, anon, authenticated;
grant select on public.city_targets to authenticated;
grant all on public.city_targets to service_role;

create or replace function public.admin_set_city_targets(p jsonb)
returns city_targets language plpgsql security definer set search_path = public as $$
declare t city_targets; b city_targets; v_city uuid := (p->>'city_id')::uuid; v_month date := date_trunc('month', (p->>'month')::date)::date; v_name text;
begin
  if not (admin_has('city') or admin_has('fee')) then raise exception 'ADMIN_FORBIDDEN: target kota hanya untuk admin ops/finance'; end if;
  perform admin_require_unlock();
  if v_city is null or v_month is null then raise exception 'city_id dan month wajib diisi'; end if;
  select name into v_name from cities where id = v_city;
  if v_name is null then raise exception 'Kota tidak ditemukan'; end if;
  if coalesce((p->>'target_orders')::int, 0) < 0 or coalesce((p->>'target_npr')::bigint, 0) < 0 then raise exception 'Target tidak boleh negatif'; end if;
  select * into b from city_targets where city_id = v_city and month = v_month;
  insert into city_targets (city_id, month, target_orders, target_npr, target_active_drivers, target_active_merchants, pic_ops, pic_finance, note, updated_by, updated_at)
  values (v_city, v_month, coalesce((p->>'target_orders')::int, 0), coalesce((p->>'target_npr')::bigint, 0), coalesce((p->>'target_active_drivers')::int, 0),
          coalesce((p->>'target_active_merchants')::int, 0), nullif(btrim(p->>'pic_ops'), ''), nullif(btrim(p->>'pic_finance'), ''), nullif(btrim(p->>'note'), ''), auth.uid(), now())
  on conflict (city_id, month) do update set
    target_orders = coalesce((p->>'target_orders')::int, city_targets.target_orders), target_npr = coalesce((p->>'target_npr')::bigint, city_targets.target_npr),
    target_active_drivers = coalesce((p->>'target_active_drivers')::int, city_targets.target_active_drivers),
    target_active_merchants = coalesce((p->>'target_active_merchants')::int, city_targets.target_active_merchants),
    pic_ops = coalesce(nullif(btrim(p->>'pic_ops'), ''), city_targets.pic_ops), pic_finance = coalesce(nullif(btrim(p->>'pic_finance'), ''), city_targets.pic_finance),
    note = coalesce(nullif(btrim(p->>'note'), ''), city_targets.note), updated_by = auth.uid(), updated_at = now()
  returning * into t;
  perform log_activity('city_target.updated', 'city_targets', v_city::text || ':' || to_char(v_month, 'YYYY-MM'),
    format('Target %s %s: %s order, NPR Rp%s', v_name, to_char(v_month, 'YYYY-MM'), t.target_orders, t.target_npr), jsonb_build_object('before', to_jsonb(b), 'after', to_jsonb(t)));
  return t;
end $$;
revoke all on function public.admin_set_city_targets(jsonb) from public, anon;
grant execute on function public.admin_set_city_targets(jsonb) to authenticated;

create or replace function public.city_targets_progress(p_month date default null, p_exec_token text default null)
returns setof jsonb language plpgsql stable security definer set search_path = public as $$
declare v_month date := date_trunc('month', coalesce(p_month, now()))::date; v_end timestamptz; v_days int; v_elapsed numeric; v_margin numeric := setting_num('cogs_margin_target_pct', 30);
begin
  if not coalesce(is_admin(), false) and (p_exec_token is null or (select user_id from exec_valid(p_exec_token)) is null) then
    raise exception 'Tidak berhak';
  end if;
  v_end := (v_month + interval '1 month')::timestamptz;
  v_days := extract(day from (v_month + interval '1 month' - interval '1 day'))::int;
  v_elapsed := least(v_days, greatest(0, extract(epoch from (least(now(), v_end) - v_month::timestamptz)) / 86400.0));
  return query
  with kota as (
    select c.id, c.name from cities c
     where exists (select 1 from city_targets t where t.city_id = c.id and t.month = v_month)
        or exists (select 1 from city_fixed_costs f where f.city_id = c.id and f.month = v_month)
  ), rl as (
    select o.city_id, count(*) as orders,
           count(distinct o.driver_id) filter (where o.driver_id is not null) as drivers_any,
           count(distinct o.merchant_id) filter (where o.merchant_id is not null) as merchants_any
      from orders o where o.status::text = 'completed' and coalesce(o.completed_at, o.updated_at, o.created_at) >= v_month and coalesce(o.completed_at, o.updated_at, o.created_at) < v_end
     group by o.city_id
  ), drv as (
    select city_id, count(*) as n from (select o.city_id, o.driver_id from orders o where o.status::text = 'completed' and o.driver_id is not null
      and coalesce(o.completed_at, o.updated_at, o.created_at) >= v_month and coalesce(o.completed_at, o.updated_at, o.created_at) < v_end group by o.city_id, o.driver_id having count(*) >= 10) x group by city_id
  ), mer as (
    select city_id, count(*) as n from (select o.city_id, o.merchant_id from orders o where o.status::text = 'completed' and o.merchant_id is not null
      and coalesce(o.completed_at, o.updated_at, o.created_at) >= v_month and coalesce(o.completed_at, o.updated_at, o.created_at) < v_end group by o.city_id, o.merchant_id having count(*) >= 5) x group by city_id
  ), led as (
    select l.city_id,
           coalesce(sum(l.amount) filter (where l.entry::text = 'platform_revenue'), 0) as revenue,
           coalesce(-sum(l.amount) filter (where l.entry::text = 'tax_output' and l.funded_by = 'inclusive'), 0) as tax,
           coalesce(-sum(l.amount) filter (where l.entry::text = 'promo_platform'), 0) as promo
      from order_ledger l where l.source = 'orders' and l.phase = 'completed' and l.created_at >= v_month and l.created_at < v_end
     group by l.city_id
  ), cost as (
    select f.city_id, coalesce(sum(f.amount), 0) as fixed from city_fixed_costs f where f.month = v_month group by f.city_id
  )
  select jsonb_build_object(
    'city_id', k.id, 'city', k.name, 'month', v_month, 'days_in_month', v_days, 'days_elapsed', round(v_elapsed, 2),
    'target_orders', coalesce(t.target_orders, 0), 'target_npr', coalesce(t.target_npr, 0),
    'target_active_drivers', coalesce(t.target_active_drivers, 0), 'target_active_merchants', coalesce(t.target_active_merchants, 0),
    'pic_ops', t.pic_ops, 'pic_finance', t.pic_finance,
    'orders', coalesce(r.orders, 0), 'npr', coalesce(l.revenue, 0) - coalesce(l.tax, 0), 'platform_revenue', coalesce(l.revenue, 0), 'tax_output', coalesce(l.tax, 0), 'promo_platform', coalesce(l.promo, 0),
    'active_drivers', coalesce(d.n, 0), 'active_merchants', coalesce(m.n, 0),
    'pct_orders', case when coalesce(t.target_orders, 0) > 0 then round(coalesce(r.orders, 0) * 100.0 / t.target_orders, 1) else null end,
    'pct_npr', case when coalesce(t.target_npr, 0) > 0 then round((coalesce(l.revenue, 0) - coalesce(l.tax, 0)) * 100.0 / t.target_npr, 1) else null end,
    'expected_orders_to_date', case when coalesce(t.target_orders, 0) > 0 then round(t.target_orders * v_elapsed / v_days, 1) else null end,
    'status', case when coalesce(t.target_orders, 0) = 0 then 'no_target'
                   when v_elapsed <= 0 then 'not_started'
                   when coalesce(r.orders, 0) >= t.target_orders * v_elapsed / v_days then 'on_track'
                   when coalesce(r.orders, 0) >= 0.8 * t.target_orders * v_elapsed / v_days then 'at_risk'
                   else 'behind' end,
    'fixed_costs', coalesce(c.fixed, 0),
    'cogs_per_order', round(coalesce(c.fixed, 0)::numeric / greatest(coalesce(t.target_orders, 0), 1)),
    'cogs_per_order_actual', round(coalesce(c.fixed, 0)::numeric / greatest(coalesce(r.orders, 0), 1)),
    'contribution', (coalesce(l.revenue, 0) - coalesce(l.tax, 0)) - coalesce(c.fixed, 0),
    'margin_target_pct', v_margin,
    'platform_fee_recommended', (ceil((round(coalesce(c.fixed, 0)::numeric / greatest(coalesce(t.target_orders, 0), 1)) * (1 + v_margin / 100.0)) / 500.0) * 500)::bigint)
  from kota k
  left join city_targets t on t.city_id = k.id and t.month = v_month
  left join rl r on r.city_id = k.id
  left join drv d on d.city_id = k.id
  left join mer m on m.city_id = k.id
  left join led l on l.city_id = k.id
  left join cost c on c.city_id = k.id
  order by k.name;
end $$;
revoke all on function public.city_targets_progress(date, text) from public, anon;
grant execute on function public.city_targets_progress(date, text) to authenticated;

create or replace view public.v_city_target_progress as
  select x as data, x->>'city' as city, (x->>'status') as status from city_targets_progress(date_trunc('month', now())::date, null) x;
revoke all on public.v_city_target_progress from public, anon;
grant select on public.v_city_target_progress to authenticated;

-- ---------------------------------------------------------------------
-- 8. Spesifikasi setelan (admin_set_settings) + kunci yang punya menu sendiri
-- ---------------------------------------------------------------------
select _v3_splice('0114', 'public.app_setting_specs()',
  $a$    ('admin_session_minutes',      'int',     5::numeric, 720::numeric, null::text[], '60'::jsonb, 'menit', 'KEAMANAN', 'Durasi sesi PIN panel admin', 'admin_role'),$a$,
  $a$    ('payment_mode',               'text',    null::numeric, null::numeric, array['voucher_only','gateway'], '"voucher_only"'::jsonb, '', 'UANG', '0114 v5: mode pembayaran (ubah lewat admin_set_payment_mode)', 'payment_config'),
    ('voucher_denominations',      'json',    null, null, null, '[20000,50000,100000,200000,500000,1000000]', '', 'UANG', 'Nominal AntarVoucher yang ditawarkan UI', 'payment_config'),
    ('voucher_min_nominal',        'int',     1000, 100000000, null, '20000', 'Rp', 'UANG', 'Nominal pembelian AntarVoucher minimum', 'payment_config'),
    ('voucher_max_nominal',        'int',     1000, 100000000, null, '2000000', 'Rp', 'UANG', 'Nominal pembelian AntarVoucher maksimum', 'payment_config'),
    ('voucher_balance_cap_customer','int',    10000, 1000000000, null, '2000000', 'Rp', 'UANG', 'Batas saldo AntarVoucher pelanggan', 'payment_config'),
    ('voucher_balance_cap_partner','int',     10000, 1000000000, null, '5000000', 'Rp', 'UANG', 'Batas saldo AntarVoucher mitra', 'payment_config'),
    ('voucher_float_limit',        'int',     1000000, 1000000000000, null, '1000000000', 'Rp', 'UANG', 'Ambang float BI (PADG 32/2025 Ps. 21)', 'payment_config'),
    ('voucher_float_alert_pct',    'int',     1, 100, null, '65', '%', 'UANG', 'Alarm float pada % ambang', 'payment_config'),
    ('voucher_code_ttl_hours',     'int',     1, 8760, null, '720', 'jam', 'UANG', 'Masa berlaku kode voucher terbit', 'payment_config'),
    ('voucher_auto_redeem',        'bool',    null, null, null, 'true', '', 'UANG', 'Kode langsung ditukar ke saldo pembeli saat terbit', 'payment_config'),
    ('driver_deposit_required',    'bool',    null, null, null, 'true', '', 'UANG', 'Mitra wajib deposit AntarVoucher untuk menerima order', 'driver'),
    ('driver_min_balance_accept',  'int',     0, 100000000, null, '0', 'Rp', 'UANG', 'Saldo minimum mitra menerima order', 'driver'),
    ('ppn_pct',                    'numeric', 0, 30, null, '11', '%', 'UANG', 'PPN atas pendapatan platform (ubah lewat admin_set_tax_settings)', 'fee'),
    ('ppn_inclusive',              'bool',    null, null, null, 'true', '', 'UANG', 'PPN termasuk dalam biaya layanan (ubah lewat admin_set_tax_settings)', 'fee'),
    ('pph_partner_pct',            'numeric', 0, 30, null, '0', '%', 'UANG', 'PPh atas pembayaran mitra — memo (ubah lewat admin_set_tax_settings)', 'fee'),
    ('payout_batch_cutoffs',       'json',    null, null, null, '["10:00","15:00"]', 'WIB', 'UANG', 'Jam pembuatan batch transfer pencairan', 'payout'),
    ('payout_fee_per_withdrawal',  'int',     0, 100000, null, '0', 'Rp', 'UANG', 'Biaya transfer per pencairan (bila bank mengenakan)', 'payout'),
    ('cogs_margin_target_pct',     'numeric', 0, 500, null, '30', '%', 'UANG', 'Margin di atas COGS/order untuk rekomendasi biaya layanan', 'fee'),
    ('admin_session_minutes',      'int',     5::numeric, 720::numeric, null::text[], '60'::jsonb, 'menit', 'KEAMANAN', 'Durasi sesi PIN panel admin', 'admin_role'),$a$,
  '0114 v5: mode pembayaran');

select _v3_splice('0114', 'public.admin_set_settings(jsonb)',
  $a$  protected constant text[] := array['antarpay_enabled', 'payment_channels', 'pg_methods', 'gateway_order_payment_enabled', 'pg_last_webhook_at', 'services_enabled'];$a$,
  $a$  protected constant text[] := array['antarpay_enabled', 'payment_channels', 'pg_methods', 'gateway_order_payment_enabled', 'pg_last_webhook_at', 'services_enabled',
                                     'payment_mode', 'ppn_pct', 'ppn_inclusive', 'pph_partner_pct'];   -- 0114 v5: admin_set_payment_mode / admin_set_tax_settings$a$,
  '0114 v5: admin_set_payment_mode');

select _v3_splice('0114', 'public.setting_json_validate(text,jsonb)',
  $a$  if p_key = 'bank_account' then$a$,
  $a$  if p_key = 'voucher_denominations' then   -- 0114 v5
    if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) not between 1 and 12 then raise exception 'voucher_denominations harus larik 1–12 nominal'; end if;
    for x in select * from jsonb_array_elements(v) loop
      if jsonb_typeof(x) <> 'number' or (x #>> '{}')::numeric < 1000 or (x #>> '{}')::numeric > 100000000 or (x #>> '{}')::numeric <> trunc((x #>> '{}')::numeric) then
        raise exception 'voucher_denominations: tiap nominal bilangan bulat Rp1.000–Rp100.000.000';
      end if;
    end loop;
    return v;
  elsif p_key = 'payout_batch_cutoffs' then
    if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) not between 1 and 6 then raise exception 'payout_batch_cutoffs harus larik 1–6 jam "HH:MM"'; end if;
    for x in select * from jsonb_array_elements(v) loop
      if jsonb_typeof(x) <> 'string' or (x #>> '{}') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'payout_batch_cutoffs: format jam HH:MM (WIB)'; end if;
    end loop;
    return v;
  end if;
  if p_key = 'bank_account' then$a$,
  '0114 v5');

-- ---------------------------------------------------------------------
-- 9. Penjaga migrasi
-- ---------------------------------------------------------------------
do $$
declare v_pm text := payment_mode();
begin
  if to_regclass('public.voucher_codes') is null or to_regclass('public.payout_batches') is null or to_regclass('public.city_targets') is null then
    raise exception '0114 batal: tabel v5 belum ada';
  end if;
  if not exists (select 1 from pg_enum where enumtypid = 'public.wallet_tx_type'::regtype and enumlabel = 'voucher_redeem') then
    raise exception '0114 batal: wallet_tx_type belum punya voucher_redeem';
  end if;
  if position('payment_mode_require_channel' in pg_get_functiondef('public.payment_channel_require(text)'::regprocedure)) = 0
     or position('payment_mode_require_channel' in pg_get_functiondef('public.payment_channel_require_order(text)'::regprocedure)) = 0
     or position('PAYMENT_MODE_VOUCHER_ONLY' in pg_get_functiondef('public.request_topup(bigint,text,text,text)'::regprocedure)) = 0
     or position('PAYMENT_MODE_VOUCHER_ONLY' in pg_get_functiondef('public.order_payment_prepare(uuid,text)'::regprocedure)) = 0 then
    raise exception '0114 batal: guard payment_mode belum terpasang';
  end if;
  if position('driver_deposit_require' in pg_get_functiondef('public.driver_accept_order(uuid)'::regprocedure)) = 0
     or position('driver_deposit_require' in pg_get_functiondef('public.driver_set_online(boolean,double precision,double precision)'::regprocedure)) = 0
     or position('driver_deposit_require' in pg_get_functiondef('public.travel_accept_send(uuid)'::regprocedure)) = 0
     or position('driver_deposit_require' in pg_get_functiondef('public.travel_offer_create(uuid,bigint,jsonb,text)'::regprocedure)) = 0 then
    raise exception '0114 batal: guard deposit mitra belum terpasang';
  end if;
  if position('tax_output' in pg_get_functiondef('public.ledger_calc(orders)'::regprocedure)) = 0 or position('tax_incl' in pg_get_functiondef('public.ledger_check(uuid)'::regprocedure)) = 0 then
    raise exception '0114 batal: posting PPN di ledger belum terpasang';
  end if;
  if position('voucher_code_on_approve' in pg_get_functiondef('public.admin_voucher_approve(uuid,text)'::regprocedure)) = 0 then
    raise exception '0114 batal: admin_voucher_approve belum menerbitkan kode';
  end if;
  if position('sla_due_at' in pg_get_functiondef('public.request_withdrawal(bigint,text,text,text)'::regprocedure)) = 0 then
    raise exception '0114 batal: request_withdrawal belum mengisi sla_due_at';
  end if;
  if not exists (select 1 from app_setting_specs() where key = 'voucher_float_limit') then raise exception '0114 batal: app_setting_specs belum memuat kunci v5'; end if;
  if v_pm not in ('voucher_only', 'gateway') then raise exception '0114 batal: payment_mode tidak valid (%)', v_pm; end if;
  raise notice '0114 ok (payment_mode=%)', v_pm;
end $$;
