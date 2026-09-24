-- =====================================================================
-- ROLLBACK 0108_refund_dispute.sql (psql -1 -f; setelah 0109_down)
-- Memulihkan: cancel_order, merchant_update_order (tanpa jalur refund gateway), payment_refund_auto &
-- payment_hook_after_ingest (versi 0105: refund ke saldo / tanpa kait), receipt_refundable_note (0105).
-- Menghapus: refund_requests, disputes, RPC refund/sengketa.
-- DATA: permintaan refund & sengketa ikut terhapus — ekspor dulu bila produksi. payments.pay_status
-- REFUND_REQUESTED/PARTIALLY_REFUNDED/REFUNDED tetap (sah menurut 0105). Baris order_ledger fase
-- 'refunded' & source 'disputes' (append-only) tetap.
-- =====================================================================
drop trigger if exists t_audit_refund_requests on public.refund_requests;
drop trigger if exists t_audit_disputes on public.disputes;

select public._mig_restore('0108');
drop function if exists public.admin_refunds(text);

-- refund_requests ↔ disputes saling mereferensi → hapus bersama (CASCADE hanya menghapus FK di antara keduanya)
drop table if exists public.refund_requests, public.disputes cascade;

do $$
begin
  if to_regclass('_lokal.migrasi') is not null then execute $q$delete from _lokal.migrasi where nama like '0108\_%'$q$; end if;
  if to_regclass('supabase_migrations.schema_migrations') is not null then execute $q$delete from supabase_migrations.schema_migrations where version like '0108%'$q$; end if;
end $$;

do $$
begin
  if to_regclass('public.refund_requests') is not null or to_regprocedure('public.refund_policy_calc(uuid)') is not null
     or position('0108' in pg_get_functiondef('public.cancel_order(uuid,text)'::regprocedure)) > 0
     or position('0108' in pg_get_functiondef('public.merchant_update_order(uuid,merchant_order_status)'::regprocedure)) > 0
     or position('refund_requests' in pg_get_functiondef('public.payment_refund_auto(uuid,text)'::regprocedure)) > 0 then
    raise exception '0108_down gagal: objek 0108 masih ada';
  end if;
  raise notice '0108_down ok';
end $$;
