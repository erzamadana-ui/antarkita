-- =====================================================================
-- 0032 — Perbaikan QC pasca Tahap 11: kembalikan pengerasan hak akses yang
--        hilang, kunci search_path, rapikan pesan pengawal komisi, dan
--        lengkapi indeks foreign key push_outbox.
--
-- Temuan QC (simulasi e2e S0–S37 + Supabase advisors, 7 Sep 2026):
--
--  (1) REGRESI HAK AKSES — `driver_available_orders()`
--      Migrasi 0028 (baris 95) sengaja mencabut EXECUTE dari anon/public.
--      Migrasi 0030 menambal fungsi ini dengan pola DROP + CREATE (karena
--      RETURNS TABLE bertambah kolom direct_for_me/direct_hold_left_s),
--      lalu hanya memberi GRANT ke authenticated. DROP menghapus seluruh
--      ACL sehingga fungsi kembali mewarisi EXECUTE untuk PUBLIC — anon
--      bisa memanggilnya lagi lewat /rest/v1/rpc/driver_available_orders.
--      Dampak data nol (fungsi langsung `return` bila auth.uid() bukan
--      driver), tetapi pengerasan 0028 batal diam-diam.
--
--  (2) Fungsi trigger baru dari 0030 (trg_driver_code, trg_push_call,
--      trg_push_notification, trg_push_order_message) dan pengawal 0031
--      (guard_commission_cap) dibuat tanpa REVOKE, jadi ikut terekspos
--      sebagai RPC untuk anon. Konvensi proyek (lihat 0003/0017) adalah
--      mencabutnya; menjalankan fungsi trigger lewat RPC memang gagal,
--      tetapi permukaan serangnya tidak perlu ada.
--
--  (3) search_path mutable pada auth_ban_ts, service_label,
--      two_wheel_services (advisor: function_search_path_mutable).
--      Ketiganya IMMUTABLE dan tidak melakukan lookup lintas skema, jadi
--      mengunci search_path tidak mengubah perilaku.
--
--  (4) Pesan pengawal komisi 0031 tercetak "maksimal %8" — di RAISE,
--      `%%%` diurai sebagai `%%` (persen literal) lalu `%` (substitusi),
--      sehingga tanda persen muncul SEBELUM angkanya. Diperbaiki dengan
--      merangkai teksnya di argumen.
--
--  (5) Foreign key push_outbox.user_id belum berindeks (advisor:
--      unindexed_foreign_keys) — dibutuhkan saat baris profil dihapus /
--      dinonaktifkan dan saat menelusuri antrean push milik satu pengguna.
--
-- Tidak ada perubahan data pengguna. Tidak ada perubahan logika bisnis.
-- =====================================================================

-- ---------- (1) & (2) kembalikan pengerasan hak akses ----------
revoke execute on function driver_available_orders() from public, anon;
grant  execute on function driver_available_orders() to authenticated;

revoke execute on function trg_driver_code()         from public, anon;
revoke execute on function trg_push_call()           from public, anon;
revoke execute on function trg_push_notification()   from public, anon;
revoke execute on function trg_push_order_message()  from public, anon;
revoke execute on function guard_commission_cap()    from public, anon;

revoke execute on function two_wheel_services()        from public, anon;
revoke execute on function commission_cap_two_wheel()  from public, anon;
grant  execute on function two_wheel_services()        to authenticated;
grant  execute on function commission_cap_two_wheel()  to authenticated;

-- ---------- (3) kunci search_path ----------
alter function auth_ban_ts()                     set search_path = public, pg_temp;
alter function service_label(service_type)       set search_path = public, pg_temp;
alter function two_wheel_services()              set search_path = public, pg_temp;

-- ---------- (4) pesan pengawal komisi: "8%" bukan "%8" ----------
create or replace function guard_commission_cap()
returns trigger language plpgsql set search_path = public as $$
declare v_cap numeric := commission_cap_two_wheel();
begin
  if new.service::text = any (two_wheel_services()) and new.commission_pct > v_cap then
    raise exception 'Komisi layanan % dibatasi maksimal % sesuai Perpres 27/2026 (angkutan sepeda motor berbasis aplikasi). Nilai % ditolak.',
      new.service, trim(trailing '.' from trim(trailing '0' from v_cap::text)) || '%',
      trim(trailing '.' from trim(trailing '0' from new.commission_pct::text)) || '%';
  end if;
  return new;
end $$;
revoke execute on function guard_commission_cap() from public, anon;

-- ---------- (5) indeks foreign key push_outbox.user_id ----------
create index if not exists idx_push_outbox_user on push_outbox (user_id);

-- ---------- verifikasi ----------
do $$
declare v int;
begin
  select count(*) into v
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('driver_available_orders','trg_driver_code','trg_push_call',
                       'trg_push_notification','trg_push_order_message','guard_commission_cap',
                       'two_wheel_services','commission_cap_two_wheel')
     and has_function_privilege('anon', p.oid, 'execute');
  if v > 0 then raise exception 'Masih ada % fungsi yang bisa dieksekusi anon', v; end if;

  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'idx_push_outbox_user') then
    raise exception 'Indeks idx_push_outbox_user gagal dibuat';
  end if;
end $$;
