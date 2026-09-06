-- =====================================================================
-- 0027 — Perbaikan bug yang ditemukan Tim QC saat uji Tahap 9
--        (supabase/tests/simulasi_e2e.sql, skenario S22–S30).
--
-- BUG (skenario S27g) — "Hapus mitra dengan PIN & alasan"
--   admin_delete_partner() memeriksa "pekerjaan aktif" mitra travel hanya lewat
--   travel_bookings & travel_requests. Titipan AntarSend antar kota yang dibawa
--   mitra travel (kolom orders.travel_partner_id, fitur baru migrasi 0025) belum
--   ikut dihitung, sehingga mitra travel yang SEDANG MEMBAWA paket pelanggan
--   masih bisa dihapus-lunak; paket pelanggan lalu menggantung tanpa pembawa dan
--   tanpa driver. Lubang yang sama ada di cabang p_kind = 'user' (akun perorangan
--   yang juga terdaftar sebagai mitra travel).
--
--   Perbaikan: tambahkan hitungan order titipan berstatus aktif
--   (scheduled/searching/accepted/arrived/in_progress) pada kedua cabang, dan
--   sebutkan "titipan" pada pesan penolakan agar admin tahu apa yang harus
--   diselesaikan lebih dulu.
--
-- Ditambal lewat penulisan ulang definisi fungsi yang sedang aktif (pola sama
-- seperti migrasi 0025) supaya migrasi 0026 tidak perlu diubah.
-- =====================================================================
do $do$
declare
  def text;
  old_travel text := $a$         + (select count(*) from travel_requests r where r.partner_id = p_id and r.status in ('offered','accepted','paid','ongoing'))
      into v_active;$a$;
  new_travel text := $b$         + (select count(*) from travel_requests r where r.partner_id = p_id and r.status in ('offered','accepted','paid','ongoing'))
         + (select count(*) from orders o where o.travel_partner_id = p_id and o.status in ('scheduled','searching','accepted','arrived','in_progress'))
      into v_active;$b$;
  old_user text := $c$         + (select count(*) from travel_requests r where (r.customer_id = p_id or r.partner_id = p_id) and r.status in ('offered','accepted','paid','ongoing'))
      into v_active;$c$;
  new_user text := $d$         + (select count(*) from travel_requests r where (r.customer_id = p_id or r.partner_id = p_id) and r.status in ('offered','accepted','paid','ongoing'))
         + (select count(*) from orders o where o.travel_partner_id = p_id and o.status in ('scheduled','searching','accepted','arrived','in_progress'))
      into v_active;$d$;
  old_msg text := 'Mitra travel ini masih punya % booking/permintaan aktif.';
  new_msg text := 'Mitra travel ini masih punya % booking/permintaan/titipan aktif.';
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'admin_delete_partner';
  if def is null then raise exception 'admin_delete_partner belum ada — jalankan migrasi 0026 lebih dulu'; end if;
  if position('o.travel_partner_id = p_id' in def) > 0 then return; end if;   -- sudah ditambal
  if position(old_travel in def) = 0 or position(old_user in def) = 0 then
    raise exception 'anchor admin_delete_partner tidak ditemukan — definisi fungsi sudah berubah';
  end if;
  def := replace(def, old_travel, new_travel);
  def := replace(def, old_user,   new_user);
  def := replace(def, old_msg,    new_msg);
  execute def;
end $do$;

revoke all on function admin_delete_partner(text, uuid, text) from public, anon;
grant execute on function admin_delete_partner(text, uuid, text) to authenticated;

comment on function admin_delete_partner(text, uuid, text) is
  'Tahap 9 — hapus lunak mitra/pengguna (wajib PIN admin + alasan >= 10 huruf). Sejak 0027 titipan AntarSend antar kota yang masih dibawa mitra travel ikut menahan penghapusan.';
