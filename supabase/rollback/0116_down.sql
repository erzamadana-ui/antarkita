-- =====================================================================
-- ROLLBACK 0116_push_secret.sql (jalankan dalam satu transaksi: psql -1 -f)
-- Memulihkan: push_dispatch(integer) dan admin_set_push_config(text,text) ke definisi pra-0116 (_migration_backup).
-- Menghapus : push_vault_available, push_dispatch_secret_get/_set, push_config_missing_event, admin_set_push_dispatch,
--             admin_push_dispatch_status, admin_push_test; kolom push_config.anon_key/dispatch_secret/last_dispatch_at/
--             last_request_id/last_error; rahasia Vault 'push_dispatch_secret' (bila ada).
-- Catatan   : nilai anon_key dikembalikan ke kolom service_key agar push_dispatch lama tetap punya kunci Bearer
--             (anon key TIDAK diterima push-send lama → ganti lagi dengan admin_set_push_config(url, service_role_key)).
--             Baris security_events 'push.config_missing' dan push_outbox source 'push_test' dibiarkan (jejak audit).
-- =====================================================================
do $$
begin
  if to_regclass('vault.secrets') is not null then
    execute $q$delete from vault.secrets where name = 'push_dispatch_secret'$q$;
  end if;
exception when others then raise notice '0116_down: vault tidak disentuh (%)', sqlerrm;
end $$;

update public.push_config set service_key = coalesce(service_key, anon_key) where anon_key is not null;

-- fungsi: yang ditambal dipulihkan, yang baru (def NULL) dihapus
select public._mig_restore('0116');

alter table public.push_config
  drop column if exists anon_key,
  drop column if exists dispatch_secret,
  drop column if exists last_dispatch_at,
  drop column if exists last_request_id,
  drop column if exists last_error;
comment on table  public.push_config is 'Tahap 11 — URL Edge Function push-send + kunci service_role yang dipakai pg_net. Diisi admin lewat admin_set_push_config().';
comment on column public.push_config.service_key is null;

do $$
begin
  if to_regclass('_lokal.migrasi') is not null then execute $q$delete from _lokal.migrasi where nama like '0116\_%'$q$; end if;
  if to_regclass('supabase_migrations.schema_migrations') is not null then execute $q$delete from supabase_migrations.schema_migrations where version like '0116%'$q$; end if;
end $$;

do $$
begin
  if to_regprocedure('public.admin_set_push_dispatch(text,text,text)') is not null
     or to_regprocedure('public.push_dispatch_secret_get()') is not null
     or position('x-push-secret' in pg_get_functiondef('public.push_dispatch(integer)'::regprocedure)) > 0 then
    raise exception '0116_down gagal: objek 0116 masih ada';
  end if;
  raise notice '0116_down ok: push_dispatch & admin_set_push_config kembali ke pra-0116; RPC/kolom 0116 dihapus';
end $$;
