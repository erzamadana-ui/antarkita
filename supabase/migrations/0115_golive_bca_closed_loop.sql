-- =====================================================================
-- 0115 GO-LIVE AntarVoucher closed-loop — rekening BCA resmi, verifikasi pemilik, tutup celah G-06 & G-07
--   Keputusan GM 27 Okt 2026: go-live model closed-loop (0114) TANPA payment gateway (Midtrans/Finpay dimatikan).
--   • company_bank_accounts: bank_code diperluas (bca, cimb, permata, danamon, seabank, jago, other); kolom owner_verified_*.
--   • voucher_bank_account_public_ok(): syarat 0112 (aktif, bukan placeholder, nomor 8–20 digit, nama = voucher_legal_entity_name)
--     DAN (verifikasi Finance + Legal oleh dua admin berbeda ATAU verifikasi pemilik owner_verified_at). Produksi hanya punya
--     satu admin aktif sehingga maker≠checker Finance/Legal tidak bisa dijalankan — jalur pemilik menggantikannya (tercatat
--     di audit_logs + security_events 'voucher.bank_owner_verify').
--   • RPC admin_voucher_bank_verify_owner(p_id, p_reason): superadmin (payment_config) + PIN terbuka + alasan ≥ 10 karakter.
--   • Rekening BCA 0181320108 a.n. voucher_legal_entity_name dimasukkan, diverifikasi pemilik (alasan = keputusan GM);
--     placeholder Himbara 0112 dinonaktifkan (tidak dihapus).
--   • Setelan: antarvoucher_purchase_enabled=true (GAGAL bila tak ada rekening lolos), payment_mode=voucher_only, saluran gateway
--     mati, cash & antarpay hidup, pg_methods=[], gateway_order_payment_enabled=false, antarpay_enabled=true,
--     payments_simulation_enabled=false. Nilai lama → _migration_backup_settings versi '0115'.
--   • G-06: admin_unlock / exec_login — PIN salah tidak lagi RAISE (yang membatalkan UPDATE counter + security_events sehingga
--     lockout tidak pernah terjadi); kini mengembalikan {ok:false, error, failed, locked_until}. Klien: src/store/adminSecurity.ts,
--     src/screens/exec/index.tsx membaca ok:false → melempar Error (UX tetap).
--   • G-07: driver_accept_order mengunci baris driver (FOR UPDATE) + index unik parsial orders_one_active_per_driver
--     (satu order aktif per driver) sebagai pagar terakhir; unique_violation → 'Selesaikan order aktif dulu'.
-- Tanggal: 27 Okt 2026 · branch golive-v6 · dasar: 0112 + 0114. Jalankan dalam SATU transaksi (psql -1 / supabase db push).
-- Idempoten: create ... if not exists / or replace; tambalan lewat _v3_splice (penanda '0115 G-07'); backup on conflict do nothing.
-- Rollback: supabase/rollback/0115_down.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Cadangan fungsi yang diubah/ditambah (untuk rollback _mig_restore('0115'))
-- ---------------------------------------------------------------------
do $$
declare s text;
begin
  foreach s in array array[
    -- diubah (definisi lama disimpan)
    'public.voucher_bank_account_public_ok(public.company_bank_accounts)',
    'public.admin_unlock(text)', 'public.exec_login(text)', 'public.driver_accept_order(uuid)',
    -- baru (NULL → dihapus saat rollback)
    'public.admin_voucher_bank_verify_owner(uuid,text)'] loop
    perform _mig_backup('0115', s);
  end loop;
end $$;

-- cadangan setelan & status aktif rekening (dipulihkan 0115_down)
insert into public._migration_backup_settings (version, key, value)
select '0115', key, value from app_settings
 where key in ('antarvoucher_purchase_enabled', 'payment_mode', 'payment_channels', 'pg_methods', 'gateway_order_payment_enabled',
               'antarpay_enabled', 'payments_simulation_enabled')
on conflict (version, key) do nothing;
insert into public._migration_backup_settings (version, key, value)
select '0115', 'company_bank_accounts_active', coalesce(jsonb_object_agg(id::text, active), '{}'::jsonb) from company_bank_accounts
on conflict (version, key) do nothing;

-- ---------------------------------------------------------------------
-- 1. company_bank_accounts: daftar bank diperluas + kolom verifikasi pemilik
-- ---------------------------------------------------------------------
alter table public.company_bank_accounts drop constraint if exists company_bank_accounts_bank_code_check;
alter table public.company_bank_accounts add constraint company_bank_accounts_bank_code_check
  check (bank_code in ('bri', 'bni', 'mandiri', 'btn', 'bsi', 'bca', 'cimb', 'permata', 'danamon', 'seabank', 'jago', 'other'));

alter table public.company_bank_accounts
  add column if not exists owner_verified_by     uuid references public.profiles(id),
  add column if not exists owner_verified_at     timestamptz,
  add column if not exists owner_verified_reason text;
comment on column public.company_bank_accounts.owner_verified_at is
  '0115: verifikasi PEMILIK (pengganti maker≠checker Finance/Legal saat hanya ada satu admin). Diisi admin_voucher_bank_verify_owner() atau migrasi go-live.';

-- syarat tampil publik: 0112 DAN (Finance+Legal dua admin berbeda ATAU verifikasi pemilik)
create or replace function public.voucher_bank_account_public_ok(b public.company_bank_accounts)
returns boolean language sql stable security definer set search_path = public as $$
  select b.active and not b.is_placeholder and coalesce(b.account_no, '') ~ '^[0-9]{8,20}$'
     and lower(trim(coalesce(b.account_name, ''))) = lower(trim(coalesce((select value #>> '{}' from app_settings where key = 'voucher_legal_entity_name'), '#')))
     and ((b.finance_verified_at is not null and b.legal_verified_at is not null and b.finance_verified_by is distinct from b.legal_verified_by)
          or b.owner_verified_at is not null);   -- 0115: jalur pemilik
$$;
revoke all on function public.voucher_bank_account_public_ok(public.company_bank_accounts) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. RPC verifikasi pemilik
-- ---------------------------------------------------------------------
create or replace function public.admin_voucher_bank_verify_owner(p_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b company_bank_accounts; v_reason text := btrim(coalesce(p_reason, ''));
begin
  perform admin_require('payment_config');   -- superadmin (RBAC 0107)
  perform admin_require_unlock();
  if length(v_reason) < 10 then raise exception 'Alasan verifikasi pemilik minimal 10 karakter'; end if;
  select * into b from company_bank_accounts where id = p_id for update;
  if not found then raise exception 'Rekening tidak ditemukan'; end if;
  if b.is_placeholder or b.account_no is null then raise exception 'Rekening masih placeholder — isi nomor rekening resmi dulu'; end if;
  if b.account_no !~ '^[0-9]{8,20}$' then raise exception 'Nomor rekening harus 8–20 digit angka'; end if;
  if lower(trim(coalesce(b.account_name, ''))) <> lower(trim(coalesce((select value #>> '{}' from app_settings where key = 'voucher_legal_entity_name'), '#'))) then
    raise exception 'Nama rekening harus sama dengan nama badan usaha (voucher_legal_entity_name)';
  end if;
  update company_bank_accounts set owner_verified_by = auth.uid(), owner_verified_at = now(), owner_verified_reason = v_reason, updated_at = now()
   where id = p_id returning * into b;
  perform log_activity('voucher.bank_owner_verify', 'company_bank_accounts', b.id::text, 'Verifikasi pemilik rekening ' || b.bank_name,
    jsonb_build_object('reason', v_reason, 'account_no_masked', left(b.account_no, 3) || '****' || right(b.account_no, 3), 'public_ok', voucher_bank_account_public_ok(b)));
  insert into security_events (kind, user_id, detail) values ('voucher.bank_owner_verify', auth.uid(),
    jsonb_build_object('bank_account_id', b.id, 'bank_code', b.bank_code, 'reason', v_reason));
  return jsonb_build_object('id', b.id, 'public_ok', voucher_bank_account_public_ok(b), 'owner_verified_at', b.owner_verified_at);
end $$;
revoke all on function public.admin_voucher_bank_verify_owner(uuid, text) from public, anon;
grant execute on function public.admin_voucher_bank_verify_owner(uuid, text) to authenticated;
comment on function public.admin_voucher_bank_verify_owner(uuid, text) is
  '0115: verifikasi rekening oleh pemilik (superadmin + PIN) — pengganti maker≠checker Finance/Legal saat hanya ada satu admin aktif. Tercatat di audit_logs & security_events.';

-- ---------------------------------------------------------------------
-- 3. Rekening BCA resmi (keputusan GM 27 Okt 2026) + nonaktifkan placeholder Himbara
-- ---------------------------------------------------------------------
do $$
declare v_name text := (select value #>> '{}' from app_settings where key = 'voucher_legal_entity_name');
        v_admin uuid; b company_bank_accounts; n int;
begin
  if nullif(btrim(coalesce(v_name, '')), '') is null then raise exception '0115 batal: app_settings.voucher_legal_entity_name kosong'; end if;
  -- admin aktif pertama (produksi: pemilik). Lokal segar (belum seed) → NULL; owner_verified_at tetap diisi karena
  -- migrasi ini SENDIRI adalah pelaksanaan keputusan pemilik (dicatat di owner_verified_reason + audit_logs).
  select id into v_admin from profiles where role = 'admin' and coalesce(is_active, true)
   order by (admin_role = 'superadmin') desc nulls last, (coalesce(email, '') not like '%@antaraja.id') desc, created_at limit 1;

  insert into company_bank_accounts (bank_code, bank_name, account_no, account_name, is_placeholder, active, display_order, note,
                                     owner_verified_by, owner_verified_at, owner_verified_reason)
  values ('bca', 'Bank Central Asia (BCA)', '0181320108', v_name, false, true, 1, 'Keputusan GM 27 Okt 2026',
          v_admin, now(), 'Keputusan GM 27 Okt 2026 — rekening resmi BCA untuk pembelian AntarVoucher')
  on conflict (bank_code, account_no) do update set
    bank_name = excluded.bank_name, account_name = excluded.account_name, is_placeholder = false, active = true, display_order = 1,
    note = coalesce(company_bank_accounts.note, excluded.note),
    owner_verified_by = coalesce(company_bank_accounts.owner_verified_by, excluded.owner_verified_by),
    owner_verified_at = coalesce(company_bank_accounts.owner_verified_at, excluded.owner_verified_at),
    owner_verified_reason = coalesce(company_bank_accounts.owner_verified_reason, excluded.owner_verified_reason),
    updated_at = now()
  returning * into b;

  -- placeholder Himbara 0112 (tanpa nomor rekening): nonaktif, tidak dihapus
  update company_bank_accounts set active = false, updated_at = now()
   where is_placeholder and account_no is null and active;
  get diagnostics n = row_count;

  if not voucher_bank_account_public_ok(b) then
    raise exception '0115 batal: rekening BCA tidak lolos voucher_bank_account_public_ok (nama rekening "%" vs voucher_legal_entity_name "%")', b.account_name, v_name;
  end if;
  perform log_activity('voucher.bank_golive', 'company_bank_accounts', b.id::text,
    'Go-live: rekening resmi ' || b.bank_name || ' diaktifkan & diverifikasi pemilik (keputusan GM 27 Okt 2026)',
    jsonb_build_object('account_no_masked', left(b.account_no, 3) || '****' || right(b.account_no, 3), 'account_name', b.account_name,
                       'owner_verified_by', v_admin, 'placeholder_dinonaktifkan', n));
  raise notice '0115: rekening BCA %****% a.n. "%" aktif (owner_verified_by=%), % placeholder dinonaktifkan', left(b.account_no, 3), right(b.account_no, 3), b.account_name, v_admin, n;
end $$;

-- ---------------------------------------------------------------------
-- 4. Setelan go-live closed-loop
-- ---------------------------------------------------------------------
do $$
declare v_ch jsonb; k text; v_before jsonb;
begin
  if not exists (select 1 from company_bank_accounts b where voucher_bank_account_public_ok(b)) then
    raise exception '0115 batal: tidak ada rekening yang lolos voucher_bank_account_public_ok — antarvoucher_purchase_enabled tidak boleh dibuka';
  end if;
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into v_before from app_settings
   where key in ('antarvoucher_purchase_enabled', 'payment_mode', 'payment_channels', 'pg_methods', 'gateway_order_payment_enabled', 'antarpay_enabled', 'payments_simulation_enabled');

  -- reversibel: admin_set_payment_mode('gateway') memulihkan saluran dari payment_mode_snapshot → simpan keadaan SEBELUM 0115 bila belum ada
  if not exists (select 1 from app_settings where key = 'payment_mode_snapshot') then
    insert into app_settings (key, value) values ('payment_mode_snapshot', jsonb_build_object(
      -- cash & antarpay selalu hidup di snapshot: kembali ke mode gateway tidak boleh mematikan saldo AntarVoucher
      'payment_channels', (select case when jsonb_typeof(value) = 'object' then value else '{}'::jsonb end from app_settings where key = 'payment_channels')
                          || jsonb_build_object('cash', true, 'antarpay', true),
      'pg_methods', (select value from app_settings where key = 'pg_methods'),
      'gateway_order_payment_enabled', (select value from app_settings where key = 'gateway_order_payment_enabled'),
      'saved_at', now(), 'saved_by', '0115'));
  end if;

  select case when jsonb_typeof(value) = 'object' then value else '{}'::jsonb end into v_ch from app_settings where key = 'payment_channels';
  v_ch := coalesce(v_ch, '{}'::jsonb);
  foreach k in array payment_gateway_channel_keys() loop v_ch := v_ch || jsonb_build_object(k, false); end loop;
  v_ch := v_ch || jsonb_build_object('cash', true, 'antarpay', true);

  insert into app_settings (key, value) values
    ('antarvoucher_purchase_enabled', 'true'::jsonb),
    ('payment_mode',                  '"voucher_only"'::jsonb),
    ('payment_channels',              v_ch),
    ('pg_methods',                    '[]'::jsonb),
    ('gateway_order_payment_enabled', 'false'::jsonb),
    ('antarpay_enabled',              'true'::jsonb),
    ('payments_simulation_enabled',   'false'::jsonb)
  on conflict (key) do update set value = excluded.value, updated_at = now();

  perform log_activity('settings.golive_closed_loop', 'app_settings', 'payment_mode',
    'Go-live closed-loop 27 Okt 2026: payment_mode=voucher_only, pembelian AntarVoucher dibuka, saluran gateway dimatikan',
    jsonb_build_object('before', v_before, 'after', (select jsonb_object_agg(key, value) from app_settings
      where key in ('antarvoucher_purchase_enabled', 'payment_mode', 'payment_channels', 'pg_methods', 'gateway_order_payment_enabled', 'antarpay_enabled', 'payments_simulation_enabled'))));
  raise notice '0115: payment_mode=%, purchase_enabled=%, banks_ready=%', payment_mode(), voucher_status_public()->>'purchase_enabled', voucher_status_public()->>'banks_ready';
end $$;

-- ---------------------------------------------------------------------
-- 5. G-06 lockout PIN: PIN salah mengembalikan {ok:false,…} (bukan RAISE) agar counter & security_events tersimpan
-- ---------------------------------------------------------------------
create or replace function public.admin_unlock(p_pin text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare a admin_security; v_min int := setting_num('admin_session_minutes', 60)::int; v_failed int; v_locked timestamptz;
begin
  if not is_admin() then raise exception 'Hanya admin'; end if;
  select * into a from admin_security where user_id = auth.uid() for update;
  if a.pin_hash is null then raise exception 'PIN belum diatur'; end if;
  if a.locked_until is not null and a.locked_until > now() then
    return jsonb_build_object('ok', false, 'failed', a.failed, 'locked_until', a.locked_until,
      'error', format('Terlalu banyak percobaan. Coba lagi dalam %s menit.', ceil(extract(epoch from (a.locked_until - now())) / 60)));
  end if;
  if p_pin is null or a.pin_hash <> extensions.crypt(p_pin, a.pin_hash) then   -- 0115 G-06: jangan RAISE (rollback = lockout tak pernah terjadi)
    v_failed := a.failed + 1;
    v_locked := case when v_failed >= 5 then now() + interval '15 minutes' else a.locked_until end;
    update admin_security set failed = v_failed, locked_until = v_locked, updated_at = now() where user_id = auth.uid();
    insert into security_events (kind, user_id, detail) values ('admin.unlock_failed', auth.uid(), jsonb_build_object('failed', v_failed, 'locked', v_failed >= 5));
    return jsonb_build_object('ok', false, 'failed', v_failed, 'locked_until', v_locked,
      'error', case when v_failed >= 5 then format('PIN salah (%s/5). Terlalu banyak percobaan — coba lagi dalam 15 menit.', v_failed)
                    else format('PIN salah (%s/5)', v_failed) end);
  end if;
  update admin_security set unlocked_until = now() + (v_min || ' minutes')::interval, failed = 0, locked_until = null, updated_at = now() where user_id = auth.uid();
  insert into security_events (kind, user_id, detail) values ('admin.unlock', auth.uid(), jsonb_build_object('minutes', v_min));
  return admin_pin_status() || jsonb_build_object('ok', true);
end $$;
revoke all on function public.admin_unlock(text) from public, anon;
grant execute on function public.admin_unlock(text) to authenticated;

create or replace function public.exec_login(p_pin text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare a exec_access%rowtype; v_token text; v_failed int; v_locked timestamptz; v_exp timestamptz;
begin
  select * into a from exec_access where user_id = auth.uid() and active for update;
  if not found then raise exception 'Akun Anda tidak memiliki akses eksekutif'; end if;
  if a.locked_until is not null and a.locked_until > now() then
    return jsonb_build_object('ok', false, 'failed', a.failed, 'locked_until', a.locked_until,
      'error', format('Terlalu banyak percobaan. Coba lagi dalam %s menit.', ceil(extract(epoch from (a.locked_until - now())) / 60)));
  end if;
  if p_pin is null or a.pin_hash <> crypt(p_pin, a.pin_hash) then   -- 0115 G-06
    v_failed := a.failed + 1;
    v_locked := case when v_failed >= 5 then now() + interval '15 minutes' else a.locked_until end;
    update exec_access set failed = v_failed, locked_until = v_locked where user_id = auth.uid();
    perform log_activity('exec.login_failed', 'exec_access', auth.uid()::text, 'Percobaan login eksekutif gagal (' || v_failed || '/5)', null);
    insert into security_events (kind, user_id, detail) values ('exec.login_failed', auth.uid(), jsonb_build_object('failed', v_failed, 'locked', v_failed >= 5));
    return jsonb_build_object('ok', false, 'failed', v_failed, 'locked_until', v_locked,
      'error', case when v_failed >= 5 then format('PIN eksekutif salah (%s/5). Terlalu banyak percobaan — coba lagi dalam 15 menit.', v_failed)
                    else format('PIN eksekutif salah (%s/5)', v_failed) end);
  end if;
  delete from exec_sessions where expires_at < now();
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_exp := now() + interval '30 minutes';
  insert into exec_sessions (token, user_id, level, expires_at) values (v_token, auth.uid(), a.level, v_exp);
  update exec_access set last_login_at = now(), failed = 0, locked_until = null where user_id = auth.uid();
  perform log_activity('exec.login', 'exec_access', auth.uid()::text, 'Login portal eksekutif (' || a.level || ')', null);
  return jsonb_build_object('ok', true, 'token', v_token, 'level', a.level, 'expires_at', v_exp);
end $$;
revoke all on function public.exec_login(text) from public, anon;
grant execute on function public.exec_login(text) to authenticated;

-- ---------------------------------------------------------------------
-- 6. G-07 race accept ganda: kunci baris driver + index unik satu order aktif per driver
-- ---------------------------------------------------------------------
select _v3_splice('0115', 'public.driver_accept_order(uuid)',
  $a$  select * into d from drivers where id = auth.uid();$a$,
  $a$  select * into d from drivers where id = auth.uid() for update;   -- 0115 G-07: serialisasi accept per driver$a$,
  '0115 G-07: serialisasi');
select _v3_splice('0115', 'public.driver_accept_order(uuid)',
  $a$  update orders set driver_id = d.id, status = 'accepted', accepted_at = now() where id = p_order_id and status = 'searching' and not order_payment_pending(orders) returning * into o;
  if not found then raise exception 'Order sudah diambil driver lain'; end if;$a$,
  $a$  begin
    update orders set driver_id = d.id, status = 'accepted', accepted_at = now() where id = p_order_id and status = 'searching' and not order_payment_pending(orders) returning * into o;
  exception when unique_violation then   -- 0115 G-07: pagar index orders_one_active_per_driver
    raise exception 'Selesaikan order aktif dulu';
  end;
  if not found then raise exception 'Order sudah diambil driver lain'; end if;$a$,
  '0115 G-07: pagar index');

do $$
declare v_list text;
begin
  select string_agg(driver_id::text || ' (' || n || ' order)', ', ') into v_list
    from (select driver_id, count(*) n from orders where driver_id is not null and status in ('accepted', 'arrived', 'in_progress') group by driver_id having count(*) > 1) x;
  if v_list is not null then
    raise exception '0115 batal: ada driver dengan lebih dari satu order aktif — selesaikan/batalkan dulu: %', v_list;
  end if;
end $$;
create unique index if not exists orders_one_active_per_driver on public.orders (driver_id)
  where driver_id is not null and status in ('accepted', 'arrived', 'in_progress');
comment on index public.orders_one_active_per_driver is '0115 G-07: satu order aktif (accepted/arrived/in_progress) per driver — pagar terakhir di luar driver_accept_order.';

-- ---------------------------------------------------------------------
-- 7. Penjaga migrasi
-- ---------------------------------------------------------------------
do $$
declare v_banks int := (select count(*) from company_bank_accounts b where voucher_bank_account_public_ok(b));
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'company_bank_accounts' and column_name = 'owner_verified_at') then
    raise exception '0115 batal: kolom owner_verified_at belum ada';
  end if;
  if position('owner_verified_at' in pg_get_functiondef('public.voucher_bank_account_public_ok(public.company_bank_accounts)'::regprocedure)) = 0 then
    raise exception '0115 batal: voucher_bank_account_public_ok belum memuat jalur pemilik';
  end if;
  if to_regprocedure('public.admin_voucher_bank_verify_owner(uuid,text)') is null then raise exception '0115 batal: RPC verifikasi pemilik belum ada'; end if;
  if not exists (select 1 from company_bank_accounts where bank_code = 'bca' and account_no = '0181320108' and active and not is_placeholder) then
    raise exception '0115 batal: rekening BCA belum aktif';
  end if;
  if v_banks = 0 then raise exception '0115 batal: tidak ada rekening lolos public_ok'; end if;
  if payment_mode() <> 'voucher_only' or not antarvoucher_enabled() or not coalesce((voucher_status_public()->>'purchase_enabled')::boolean, false) then
    raise exception '0115 batal: setelan go-live tidak konsisten (payment_mode=%, antarvoucher_enabled=%, purchase_enabled=%)',
      payment_mode(), antarvoucher_enabled(), voucher_status_public()->>'purchase_enabled';
  end if;
  if payment_channel_enabled('gopay') or payment_channel_enabled('qris') or not payment_channel_enabled('cash') or not payment_channel_enabled('antarpay') then
    raise exception '0115 batal: saluran pembayaran tidak sesuai mode voucher_only';
  end if;
  if position('0115 G-06' in pg_get_functiondef('public.admin_unlock(text)'::regprocedure)) = 0
     or position('0115 G-06' in pg_get_functiondef('public.exec_login(text)'::regprocedure)) = 0 then
    raise exception '0115 batal: perbaikan lockout PIN (G-06) belum terpasang';
  end if;
  if position('for update' in pg_get_functiondef('public.driver_accept_order(uuid)'::regprocedure)) = 0
     or position('0115 G-07: pagar index' in pg_get_functiondef('public.driver_accept_order(uuid)'::regprocedure)) = 0
     or to_regclass('public.orders_one_active_per_driver') is null then
    raise exception '0115 batal: pagar race accept (G-07) belum terpasang';
  end if;
  raise notice '0115 ok (payment_mode=%, banks_ready=%, purchase_enabled=%)', payment_mode(), v_banks, voucher_status_public()->>'purchase_enabled';
end $$;
