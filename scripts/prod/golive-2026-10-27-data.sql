-- =====================================================================
-- scripts/prod/golive-2026-10-27-data.sql — skrip DATA produksi go-live closed-loop (BUKAN migrasi; dijalankan SEKALI
-- oleh pemilik setelah migrasi 0115 diterapkan). Idempoten: aman diulang. Tiap bagian blok DO dengan RAISE NOTICE hasil.
--   psql "$PROD_DB_URL" -X -v ON_ERROR_STOP=1 -1 -f scripts/prod/golive-2026-10-27-data.sql
-- Bagian:
--   1. Akun uji dinonaktifkan: email *@example.com dan profil bernama 'TESTING' (@gmail) → profiles.is_active=false,
--      auth.users.banned_until='infinity', driver/mitra travel/vendor ditangguhkan & offline (pola 0085).
--      TIDAK disentuh: erzamadana@gmail.com, sigitekoprayogo1804@gmail.com, suryadi*, akun lain.
--   2. exec_access admin@antaraja.id → active=false.
--   3. payments provider midtrans yang masih pending → EXPIRED (status legacy 'expire'; CHECK payments_status_check tidak punya
--      'expired'), catatan ditambahkan; dompet TIDAK disentuh.
--   4. osm_import_jobs 'running' > 1 hari → 'failed' + catatan.
--   5. gateway_secrets provider midtrans dihapus; salinan TERMASKER (6 karakter pertama server_key) disimpan ke
--      _migration_backup_settings versi '0115-data' key 'gateway_secrets_midtrans_masked'.
--   6. Verifikasi akhir: payment_mode(), antarvoucher_enabled(), banks_ready, jumlah admin aktif.
-- Uji lokal: scripts/db-lokal.sh psql -v ON_ERROR_STOP=1 -c 'begin' -f scripts/prod/golive-2026-10-27-data.sql -c 'rollback'
-- =====================================================================

-- 1. akun uji
do $$
declare v_ids uuid[]; n_prof int := 0; n_auth int := 0; n_drv int := 0; n_tp int := 0; n_mv int := 0;
begin
  select coalesce(array_agg(u.id), '{}'::uuid[]) into v_ids
    from auth.users u left join public.profiles p on p.id = u.id
   where (lower(u.email) like '%@example.com'
          or (upper(trim(coalesce(p.full_name, ''))) = 'TESTING' and lower(u.email) like '%@gmail.com'))
     and lower(u.email) not in ('erzamadana@gmail.com', 'sigitekoprayogo1804@gmail.com')
     and lower(u.email) not like 'suryadi%'
     and lower(u.email) not like '%@antaraja.id';   -- akun seed sudah ditangani 0085
  if coalesce(array_length(v_ids, 1), 0) = 0 then
    raise notice '[1] akun uji: tidak ada yang perlu dinonaktifkan';
    return;
  end if;
  perform set_config('antaraja.bypass', 'on', true);
  update public.profiles set is_active = false, status_reason = coalesce(status_reason, 'Akun uji dinonaktifkan go-live 27 Okt 2026')
   where id = any(v_ids) and is_active;
  get diagnostics n_prof = row_count;
  update auth.users set banned_until = 'infinity'::timestamptz
   where id = any(v_ids) and (banned_until is null or banned_until < now());
  get diagnostics n_auth = row_count;
  update public.drivers set status = 'suspended', is_online = false, status_reason = coalesce(status_reason, 'Akun uji dinonaktifkan go-live 27 Okt 2026')
   where id = any(v_ids) and (status <> 'suspended' or is_online);
  get diagnostics n_drv = row_count;
  update public.travel_partners set status = 'suspended' where id = any(v_ids) and status <> 'suspended';
  get diagnostics n_tp = row_count;
  update public.market_vendors set status = 'suspended' where id = any(v_ids) and status <> 'suspended';
  get diagnostics n_mv = row_count;
  perform set_config('antaraja.bypass', 'off', true);
  perform public.log_activity('golive.test_accounts_disabled', 'profiles', null,
    format('Go-live 27 Okt 2026: %s akun uji dinonaktifkan & login diblokir', array_length(v_ids, 1)),
    jsonb_build_object('ids', to_jsonb(v_ids), 'profiles', n_prof, 'auth_banned', n_auth, 'drivers', n_drv, 'travel_partners', n_tp, 'market_vendors', n_mv));
  raise notice '[1] akun uji: % kandidat → profil nonaktif %, login diblokir %, driver ditangguhkan %, mitra travel %, vendor %',
    array_length(v_ids, 1), n_prof, n_auth, n_drv, n_tp, n_mv;
end $$;

-- 2. exec_access admin@antaraja.id
do $$
declare n int;
begin
  update public.exec_access e set active = false
    from auth.users u
   where u.id = e.user_id and lower(u.email) = 'admin@antaraja.id' and e.active;
  get diagnostics n = row_count;
  if n > 0 then
    perform public.log_activity('golive.exec_access_disabled', 'exec_access', 'admin@antaraja.id', 'Go-live 27 Okt 2026: akses eksekutif admin@antaraja.id dinonaktifkan', null);
  end if;
  raise notice '[2] exec_access admin@antaraja.id: % baris dinonaktifkan (sisa aktif: %)', n,
    (select count(*) from public.exec_access where active);
end $$;

-- 3. payments midtrans pending → EXPIRED (dompet tidak disentuh)
do $$
declare n int;
begin
  update public.payments
     set pay_status = 'EXPIRED',   -- trigger payments_sync_status → status legacy 'expire'
         note = concat_ws(' | ', note, 'Go-live 27 Okt 2026: gateway Midtrans dimatikan (closed-loop AntarVoucher) — intent kedaluwarsa oleh sistem')
   where lower(provider) = 'midtrans' and status = 'pending' and pay_status = 'PENDING';
  get diagnostics n = row_count;
  if n > 0 then
    perform public.log_activity('golive.midtrans_pending_expired', 'payments', null,
      format('Go-live 27 Okt 2026: %s pembayaran Midtrans pending ditandai EXPIRED', n), jsonb_build_object('count', n));
  end if;
  raise notice '[3] payments midtrans pending → EXPIRED: % baris (midtrans masih pending: %)', n,
    (select count(*) from public.payments where lower(provider) = 'midtrans' and status = 'pending');
end $$;

-- 4. osm_import_jobs running > 1 hari → failed
do $$
declare n int;
begin
  update public.osm_import_jobs
     set status = 'failed', finished_at = coalesce(finished_at, now()),
         note = concat_ws(' | ', note, 'Go-live 27 Okt 2026: job macet (running > 1 hari) ditandai failed oleh sistem')
   where status = 'running' and coalesce(started_at, created_at) < now() - interval '1 day';
  get diagnostics n = row_count;
  raise notice '[4] osm_import_jobs running > 1 hari → failed: % baris (running tersisa: %)', n,
    (select count(*) from public.osm_import_jobs where status = 'running');
end $$;

-- 5. gateway_secrets midtrans: cadangan termasker lalu hapus
do $$
declare n int; v_masked jsonb;
begin
  select jsonb_agg(jsonb_build_object('provider', provider, 'env', env, 'is_production', is_production, 'merchant_id', merchant_id,
           'server_key_prefix', left(coalesce(server_key, ''), 6), 'server_key_len', length(coalesce(server_key, '')),
           'client_key_prefix', left(coalesce(client_key, ''), 6), 'has_callback_token', callback_token is not null,
           'updated_at', updated_at, 'deleted_at', now()))
    into v_masked from public.gateway_secrets where lower(provider) = 'midtrans';
  if v_masked is null then
    raise notice '[5] gateway_secrets midtrans: tidak ada baris';
    return;
  end if;
  insert into public._migration_backup_settings (version, key, value)
  values ('0115-data', 'gateway_secrets_midtrans_masked', v_masked)
  on conflict (version, key) do update set value = public._migration_backup_settings.value || excluded.value, saved_at = now();
  delete from public.gateway_secrets where lower(provider) = 'midtrans';
  get diagnostics n = row_count;
  perform public.log_activity('golive.gateway_secrets_removed', 'gateway_secrets', 'midtrans',
    format('Go-live 27 Okt 2026: %s kredensial Midtrans dihapus dari gateway_secrets (salinan termasker di _migration_backup_settings 0115-data)', n),
    jsonb_build_object('count', n));
  insert into public.security_events (kind, user_id, detail) values ('gateway.secret_removed', null, jsonb_build_object('provider', 'midtrans', 'count', n, 'reason', 'golive-2026-10-27'));
  raise notice '[5] gateway_secrets midtrans: % baris dihapus, salinan termasker tersimpan (ingat: ROTASI kunci di dasbor Midtrans)', n;
end $$;

-- 6. verifikasi akhir
do $$
declare v_cfg jsonb := public.voucher_public_config(); n_admin int; n_bank int;
begin
  select count(*) into n_admin from public.profiles where role = 'admin' and coalesce(is_active, true);
  n_bank := (public.voucher_status_public()->>'banks_ready')::int;
  raise notice '[6] VERIFIKASI: payment_mode=% · antarvoucher_enabled=% · purchase_enabled=% · banks_ready=% (%) · admin aktif=% · gateway_secrets midtrans=% · midtrans pending=%',
    public.payment_mode(), public.antarvoucher_enabled(), v_cfg->>'purchase_enabled', n_bank,
    (select string_agg(bank_code || ' ' || left(account_no, 3) || '****' || right(account_no, 3), ', ') from public.voucher_bank_accounts_public()),
    n_admin, (select count(*) from public.gateway_secrets where lower(provider) = 'midtrans'),
    (select count(*) from public.payments where lower(provider) = 'midtrans' and status = 'pending');
  if public.payment_mode() <> 'voucher_only' or not public.antarvoucher_enabled() or not coalesce((v_cfg->>'purchase_enabled')::boolean, false) or n_bank = 0 then
    raise warning '[6] PERHATIAN: setelan go-live belum lengkap — periksa migrasi 0115';
  end if;
end $$;

select public.payment_mode() as payment_mode, public.antarvoucher_enabled() as antarvoucher_enabled,
       (public.voucher_public_config()->>'purchase_enabled')::boolean as purchase_enabled,
       (public.voucher_status_public()->>'banks_ready')::int as banks_ready,
       (select count(*) from public.profiles where role = 'admin' and coalesce(is_active, true)) as admin_aktif,
       (select count(*) from public.gateway_secrets where lower(provider) = 'midtrans') as gateway_secrets_midtrans,
       (select count(*) from public.payments where lower(provider) = 'midtrans' and status = 'pending') as midtrans_pending;
