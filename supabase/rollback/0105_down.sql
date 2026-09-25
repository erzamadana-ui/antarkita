-- =====================================================================
-- ROLLBACK 0105_provider_pembayaran_finpay.sql (psql -1 -f; TERAKHIR, setelah 0106_down)
-- Memulihkan: pg_fee_calc(text,bigint), pg_hold_days, pg_fee_estimate, admin_set_payment_channel_fee(text,jsonb),
-- admin_payment_channel_fees(), payment_settle (v2, TANPA pagar K1), order_payment_prepare, gateway_public_config,
-- admin_gateway_status, admin_set_gateway, admin_set_settings, admin_business_settings, create_order, ledger_simulate
-- (definisi sebelum 0105, dari _migration_backup); PK gateway_secrets (provider) & payment_channel_fees (channel).
-- Menghapus: payment_events, kolom kanonik payments, orders.settlement_status/payment_support_ref, RPC v3 pembayaran,
-- app_settings v3, tarif Finpay, pembantu migrasi v3 (_migration_backup, _mig_*, _v3_splice).
-- DATA yang TIDAK kembali: intent PENDING ganda yang ditandai superseded oleh 0105 tetap 'cancel'; tarif versi
-- effective_from selain yang terbaru per kanal & baris Finpay dihapus; kunci gateway: satu baris per provider
-- dipertahankan (utamakan env production), kunci env lain dihapus. Ekspor dulu bila produksi.
-- =====================================================================
drop trigger if exists t_gateway_secrets_sync on public.gateway_secrets;
drop trigger if exists t_payments_sync_status on public.payments;
drop trigger if exists t_orders_settlement_on_complete on public.orders;
drop trigger if exists t_payment_events_append_only on public.payment_events;
drop trigger if exists t_payment_events_no_truncate on public.payment_events;

-- payment_events dulu: kebijakan RLS-nya memakai admin_has() yang dihapus _mig_restore
drop table if exists public.payment_events;

select public._mig_restore('0105');
select public._mig_restore_acl('0105');

-- payments
drop index if exists public.payments_one_pending_per_order;
drop index if exists public.payments_support_ref_key;
drop index if exists public.payments_provider_ref_idx;
drop index if exists public.payments_pay_status_idx;
alter table public.payments drop constraint if exists payments_pay_status_check;
alter table public.payments drop constraint if exists payments_refunded_amount_check;
alter table public.payments drop constraint if exists payments_support_ref_format;
alter table public.payments drop constraint if exists payments_env_check;
alter table public.payments drop column if exists provider_ref, drop column if exists provider_txn_id, drop column if exists checkout_url,
  drop column if exists checkout_token, drop column if exists qr_string, drop column if exists payment_code, drop column if exists expires_at,
  drop column if exists paid_at, drop column if exists pay_status, drop column if exists refunded_amount, drop column if exists reconciled_at,
  drop column if exists support_ref, drop column if exists note, drop column if exists reconcile_run_id, drop column if exists env;

-- orders
drop index if exists public.orders_payment_support_ref_key;
alter table public.orders drop constraint if exists orders_settlement_status_check;
alter table public.orders drop column if exists settlement_status, drop column if exists payment_support_ref;

-- payment_channel_fees: kembali satu baris per kanal (versi terbaru midtrans/internal)
delete from public.payment_channel_fees where provider = 'finpay';
delete from public.payment_channel_fees f where exists (select 1 from public.payment_channel_fees g
  where g.channel = f.channel and (g.effective_from, g.provider) > (f.effective_from, f.provider));
alter table public.payment_channel_fees drop constraint if exists payment_channel_fees_pkey;
alter table public.payment_channel_fees drop constraint if exists payment_channel_fees_qris_no_surcharge;
alter table public.payment_channel_fees drop constraint if exists payment_channel_fees_provider_check;
alter table public.payment_channel_fees drop constraint if exists payment_channel_fees_under100k_check;
drop index if exists public.payment_channel_fees_lookup_idx;
alter table public.payment_channel_fees drop column if exists effective_from, drop column if exists pass_to_customer,
  drop column if exists pass_to_customer_legal_ok, drop column if exists source_label, drop column if exists note, drop column if exists fee_pct_under_100k;
alter table public.payment_channel_fees add constraint payment_channel_fees_pkey primary key (channel);

-- gateway_secrets: kembali PK (provider); satu baris per provider (utamakan production)
delete from public.gateway_secrets g where exists (select 1 from public.gateway_secrets h where h.provider = g.provider
  and (case when h.env = 'production' then 1 else 0 end, h.updated_at) > (case when g.env = 'production' then 1 else 0 end, g.updated_at));
update public.gateway_secrets set is_production = (env = 'production');
alter table public.gateway_secrets drop constraint if exists gateway_secrets_pkey;
alter table public.gateway_secrets drop constraint if exists gateway_secrets_env_check;
alter table public.gateway_secrets drop column if exists env, drop column if exists callback_token, drop column if exists extra;
alter table public.gateway_secrets add constraint gateway_secrets_pkey primary key (provider);

delete from public.app_settings where key in ('payment_provider_active','payment_provider_env','payments_simulation_enabled','refund_dual_approval_min',
  'wallet_adjust_dual_approval_min','disbursement_provider','ads_frequency_cap_per_day','ads_click_dedupe_minutes');

do $$
begin
  if to_regclass('_lokal.migrasi') is not null then execute $q$delete from _lokal.migrasi where nama like '0105\_%'$q$; end if;
  if to_regclass('supabase_migrations.schema_migrations') is not null then execute $q$delete from supabase_migrations.schema_migrations where version like '0105%'$q$; end if;
end $$;

-- pembantu migrasi v3 (terakhir)
drop function if exists public._v3_splice(text, text, text, text, text, boolean);
drop function if exists public._mig_backup(text, text);
drop function if exists public._mig_backup_acl(text, text);
drop function if exists public._mig_restore_acl(text);
do $$
begin
  if exists (select 1 from public._migration_backup) or exists (select 1 from public._migration_backup_acl) then
    raise exception '0105_down gagal: masih ada cadangan versi lain (%) — jalankan down 0110…0106 dulu',
      (select string_agg(distinct version, ',') from public._migration_backup);
  end if;
end $$;
drop function if exists public._mig_restore(text);
drop table if exists public._migration_backup;
drop table if exists public._migration_backup_acl;

do $$
begin
  if to_regprocedure('public.pg_fee_calc(text,bigint)') is null or to_regprocedure('public.pg_fee_calc(text,bigint,text,timestamp with time zone)') is not null
     or to_regclass('public.payment_events') is not null or to_regprocedure('public.payment_event_ingest(text,text,text,text,bigint,boolean,jsonb,text)') is not null
     or position('payments_simulation_active' in pg_get_functiondef('public.payment_settle(text,text,jsonb,text,timestamp with time zone)'::regprocedure)) > 0 then
    raise exception '0105_down gagal: objek 0105 masih ada';
  end if;
  raise notice '0105_down ok';
end $$;
