-- =====================================================================
-- 0023 — Hapus akun atas permintaan pengguna (kewajiban Google Play "Account deletion")
--
-- Alur: Akun → Lainnya → Hapus akun → ketik HAPUS → rpc request_account_deletion()
--   1. Menolak bila saldo AntarPay ≠ 0, ada pesanan/booking/perjalanan aktif, atau penarikan/top-up masih diproses
--      (pesan kesalahan berbahasa Indonesia yang jelas untuk pengguna).
--   2. Menandai profiles.deletion_requested_at, menonaktifkan akun (is_active=false), menganonimkan nama/HP/foto/email/
--      kontak darurat/push token, mematikan status mitra (driver offline+suspended, merchant tutup, lapak & travel suspended).
--   3. Memblokir login di auth.users (banned_until). Setelah masa tenggang (30 hari) admin memanggil
--      admin_finalize_account_deletion(uid) untuk membersihkan PII tersisa (identitas auth, dokumen KYC) —
--      baris profil anonim & catatan transaksi tetap disimpan sesuai kewajiban pembukuan.
--   4. Mencatat ke audit_logs + security_events.
-- Pengguna yang berubah pikiran dalam masa tenggang bisa menghubungi CS (erzamadana@gmail.com) untuk pemulihan.
-- =====================================================================

alter table profiles add column if not exists deletion_requested_at timestamptz;
create index if not exists profiles_deletion_requested_idx on profiles (deletion_requested_at) where deletion_requested_at is not null;

create or replace function request_account_deletion()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_balance bigint;
  v_active int;
  v_pending int;
  v_email text;
  v_prev text := coalesce(current_setting('antaraja.bypass', true), 'off');
begin
  if v_uid is null then raise exception 'Silakan masuk terlebih dahulu'; end if;
  if exists (select 1 from profiles where id = v_uid and role = 'admin') then
    raise exception 'Akun admin tidak bisa dihapus lewat aplikasi. Minta admin lain menonaktifkan akun Anda.';
  end if;
  if exists (select 1 from profiles where id = v_uid and deletion_requested_at is not null) then
    raise exception 'Permintaan hapus akun sudah tercatat dan sedang diproses.';
  end if;

  -- 1) Saldo AntarPay harus nol (positif → tarik/habiskan; negatif → lunasi deposit)
  select coalesce(balance, 0) into v_balance from wallets where user_id = v_uid;
  if coalesce(v_balance, 0) > 0 then
    raise exception 'Saldo AntarPay Anda masih Rp%. Tarik atau habiskan saldo terlebih dahulu sebelum menghapus akun.', replace(to_char(v_balance, 'FM999G999G999'), ',', '.');
  elsif coalesce(v_balance, 0) < 0 then
    raise exception 'Saldo AntarPay Anda minus Rp%. Lunasi kewajiban ini (top-up) sebelum menghapus akun.', replace(to_char(abs(v_balance), 'FM999G999G999'), ',', '.');
  end if;

  -- 2) Tidak ada pesanan/booking/perjalanan aktif
  select count(*) into v_active from orders o
   where o.status in ('searching','accepted','arrived','in_progress')
     and (o.customer_id = v_uid or o.driver_id = v_uid
          or o.merchant_id in (select id from merchants where owner_id = v_uid));
  if v_active > 0 then
    raise exception 'Masih ada % pesanan aktif. Selesaikan atau batalkan pesanan terlebih dahulu.', v_active;
  end if;
  select count(*) into v_active from travel_bookings b
   where b.customer_id = v_uid and b.status in ('booked','confirmed','picked_up');
  if v_active > 0 then
    raise exception 'Masih ada % booking AntarTravel aktif. Selesaikan atau batalkan booking terlebih dahulu.', v_active;
  end if;
  select count(*) into v_active from travel_trips t
   where t.partner_id = v_uid and t.status in ('open','confirmed','full','departed')
     and exists (select 1 from travel_bookings b where b.trip_id = t.id and b.status in ('booked','confirmed','picked_up'));
  if v_active > 0 then
    raise exception 'Masih ada % jadwal travel dengan penumpang. Selesaikan perjalanan atau batalkan jadwal terlebih dahulu.', v_active;
  end if;

  -- 3) Tidak ada penarikan / top-up yang masih diproses
  select (select count(*) from withdrawal_requests where user_id = v_uid and status = 'pending')
       + (select count(*) from topup_requests where user_id = v_uid and status = 'pending') into v_pending;
  if v_pending > 0 then
    raise exception 'Masih ada % permintaan top-up/penarikan yang sedang diproses. Tunggu sampai selesai.', v_pending;
  end if;

  select email into v_email from profiles where id = v_uid;

  -- 4) Anonimkan & nonaktifkan (lewati guard_profile_update / guard_driver_update)
  perform set_config('antaraja.bypass', 'on', true);
  update profiles set
    full_name = 'Pengguna Terhapus',
    phone = null, email = null, avatar_url = null, push_token = null,
    emergency_contact_name = null, emergency_contact_phone = null,
    is_active = false,
    deletion_requested_at = now(),
    updated_at = now()
  where id = v_uid;
  update drivers set is_online = false, status = 'suspended', status_reason = 'Akun dihapus atas permintaan pengguna'
   where id = v_uid and status <> 'suspended';
  update merchants set is_open = false, status = 'suspended'
   where owner_id = v_uid and status <> 'suspended';
  update market_vendors set status = 'suspended', status_reason = 'Akun dihapus atas permintaan pengguna'
   where id = v_uid and status <> 'suspended';
  update travel_partners set status = 'suspended', status_reason = 'Akun dihapus atas permintaan pengguna'
   where id = v_uid and status <> 'suspended';
  perform set_config('antaraja.bypass', v_prev, true);

  -- 5) Blokir login (jika hak akses ke auth.users tersedia; jika tidak, is_active=false sudah memblokir transaksi)
  begin
    update auth.users set banned_until = 'infinity'::timestamptz where id = v_uid;
  exception when others then
    raise notice 'Tidak bisa mengubah auth.users (%): login hanya diblokir lewat is_active', sqlerrm;
  end;

  -- 6) Catat
  perform log_activity('profile.deletion_requested', 'profiles', v_uid::text, 'Pengguna meminta penghapusan akun',
                       jsonb_build_object('email_hash', md5(coalesce(v_email, '')), 'requested_at', now()));
  insert into security_events (kind, user_id, detail)
  values ('account.delete_request', v_uid, jsonb_build_object('email_hash', md5(coalesce(v_email, ''))));

  return jsonb_build_object('ok', true, 'requested_at', now());
end $$;
revoke all on function request_account_deletion() from public, anon;
grant execute on function request_account_deletion() to authenticated;

-- Admin: daftar permintaan hapus akun (untuk panel / pemeriksaan manual)
create or replace function admin_list_deletion_requests()
returns table (user_id uuid, requested_at timestamptz, role user_role, days_waiting int)
language sql security definer set search_path = public as $$
  select p.id, p.deletion_requested_at, p.role, extract(day from now() - p.deletion_requested_at)::int
  from profiles p
  where p.deletion_requested_at is not null and is_admin()
  order by p.deletion_requested_at
$$;
revoke all on function admin_list_deletion_requests() from public, anon;
grant execute on function admin_list_deletion_requests() to authenticated;

-- Admin: finalisasi setelah masa tenggang (mis. 30 hari) — hapus PII yang tersisa.
-- Baris profil anonim TETAP ada karena orders/wallet_transactions merujuk profiles(id) tanpa cascade
-- (bukti transaksi & kewajiban pembukuan). Yang dibersihkan: identitas auth (email diganti tombstone sehingga email asli
-- bisa dipakai daftar ulang), metadata auth, identities OAuth, dan data KYC mitra (NIK, SIM, URL dokumen).
create or replace function admin_finalize_account_deletion(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_prev text := coalesce(current_setting('antaraja.bypass', true), 'off');
begin
  if not is_admin() then raise exception 'Hanya admin'; end if;
  if not exists (select 1 from profiles where id = p_user and deletion_requested_at is not null) then
    raise exception 'Pengguna ini tidak meminta penghapusan akun';
  end if;
  perform set_config('antaraja.bypass', 'on', true);
  update driver_documents set photo_id_url = null, photo_vehicle_url = null, license_number = null, id_card_number = null where driver_id = p_user;
  update market_vendors set id_card_url = null, market_card_url = null, photo_url = null, phone = null,
    bank_name = null, bank_account = null, bank_holder = null where id = p_user;
  perform set_config('antaraja.bypass', v_prev, true);
  begin
    delete from auth.identities where user_id = p_user;
    update auth.users set
      email = p_user::text || '@deleted.antarkita.invalid',
      phone = null,
      encrypted_password = md5(gen_random_uuid()::text),
      raw_user_meta_data = '{}'::jsonb,
      banned_until = 'infinity'::timestamptz
    where id = p_user;
  exception when others then
    raise exception 'Gagal membersihkan auth.users: %. Hapus pengguna lewat Supabase Dashboard → Authentication.', sqlerrm;
  end;
  perform log_activity('profile.deletion_finalized', 'profiles', p_user::text, 'PII akun dihapus permanen oleh admin', null);
end $$;
revoke all on function admin_finalize_account_deletion(uuid) from public, anon;
grant execute on function admin_finalize_account_deletion(uuid) to authenticated;
