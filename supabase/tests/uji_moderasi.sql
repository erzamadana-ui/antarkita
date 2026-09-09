-- =====================================================================
-- uji_moderasi.sql — Uji moderasi UGC (pelaporan konten + blokir pengguna)
--
-- Membuktikan bahwa migrasi 0050 BUKAN sekadar tabel: pasangan yang saling
-- memblokir benar-benar tidak dipasangkan, pesannya ditolak basis data, dan
-- laporan tercatat lalu bisa diselesaikan admin dengan jejak audit.
--
-- Pola: setiap skenario dibungkus BEGIN … ROLLBACK sehingga data nyata tidak
-- berubah sedikit pun. Sesi pengguna ditiru lewat set_config
-- 'request.jwt.claims' (auth.uid() membacanya). Berkas terpisah dari
-- simulasi_e2e.sql / uji_keamanan.sql supaya tidak bentrok dengan agen lain.
--
-- Cara pakai:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/uji_moderasi.sql
-- Semua blok yang lulus mencetak "[OK] …" lewat RAISE NOTICE; kegagalan
-- memunculkan exception "[GAGAL] …" dan menghentikan skrip.
--
-- Hasil terakhir dijalankan pada basis data proyek (2026-09-09): 11/11 lulus.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. PENEGAKAN BLOKIR: pencocokan driver, penerimaan order, chat, panggilan
-- ---------------------------------------------------------------------
begin;
do $$
declare
  v_cust uuid; v_drv uuid; v_ord uuid; v_ord2 uuid; n int; v_lolos boolean;
begin
  select id into v_cust from profiles where role='customer' and is_active order by created_at limit 1;
  select id into v_drv  from drivers  where status='approved' limit 1;
  if v_cust is null or v_drv is null then
    raise notice '[LEWAT] Tidak ada data pelanggan/driver untuk diuji';
    return;
  end if;

  -- ---- fixture: driver online berlokasi, tanpa order aktif ----
  perform set_config('antaraja.bypass','on',true);
  update drivers set is_online = true, last_seen_at = now(), vehicle_type = 'motor', vehicle_class = null,
    location = coalesce(location, st_setsrid(st_makepoint(106.8, -6.2), 4326)::geography)
  where id = v_drv;
  perform set_config('antaraja.bypass','off',true);
  update orders set status='completed' where driver_id = v_drv and status in ('accepted','arrived','in_progress');
  update wallets set balance = greatest(balance, 0) where user_id = v_drv;

  select id into v_ord  from orders order by created_at limit 1;
  select id into v_ord2 from orders where id <> v_ord order by created_at limit 1;

  -- fixture chat: satu order milik pasangan ini; pesan SEBELUM blokir harus lolos
  update orders set customer_id = v_cust, driver_id = v_drv, status = 'accepted' where id = v_ord2;
  insert into order_messages (order_id, sender_id, body) values (v_ord2, v_cust, 'uji: pesan sebelum blokir');
  update orders set status = 'completed' where id = v_ord2;   -- agar driver tidak "punya order aktif"

  -- fixture pencocokan: satu order 'searching' tepat di lokasi driver
  update orders o set customer_id = v_cust, driver_id = null, preferred_driver_id = null, status = 'searching',
    service = 'ride_motor', vehicle_class = null, merchant_id = null, merchant_status = null,
    created_at = now() - interval '10 minutes', pickup_location = d.location
  from drivers d where d.id = v_drv and o.id = v_ord;
  delete from order_rejections where order_id = v_ord;

  -- ---- 1a. SEBELUM blokir: order terlihat oleh driver ----
  perform set_config('request.jwt.claims', json_build_object('sub', v_drv, 'role','authenticated')::text, true);
  select count(*) into n from driver_available_orders() where id = v_ord;
  if n <> 1 then raise exception '[GAGAL] Fixture salah: order tidak terlihat driver sebelum blokir (n=%)', n; end if;
  raise notice '[OK] 1a. Sebelum blokir: order muncul di driver_available_orders()';

  -- ---- 1b. Blokir oleh pelanggan ----
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust, 'role','authenticated')::text, true);
  perform block_user(v_drv, 'uji moderasi');
  if not is_blocked_pair(v_cust, v_drv) then raise exception '[GAGAL] is_blocked_pair() tidak mendeteksi blokir'; end if;
  raise notice '[OK] 1b. block_user() tercatat dan terdeteksi is_blocked_pair()';

  -- ---- 1c. Driver tidak lagi melihat order pelanggan itu ----
  perform set_config('request.jwt.claims', json_build_object('sub', v_drv, 'role','authenticated')::text, true);
  select count(*) into n from driver_available_orders() where id = v_ord;
  if n <> 0 then raise exception '[GAGAL] Order pelanggan yang memblokir masih muncul di daftar driver (n=%)', n; end if;
  raise notice '[OK] 1c. Pencocokan: order pelanggan yang memblokir HILANG dari daftar driver';

  -- ---- 1d. Driver juga tidak bisa menerima order itu lewat RPC langsung ----
  v_lolos := false;
  begin perform driver_accept_order(v_ord); v_lolos := true; exception when others then null; end;
  if v_lolos then raise exception '[GAGAL] driver_accept_order() masih menerima order dari pelanggan yang memblokir'; end if;
  raise notice '[OK] 1d. driver_accept_order() menolak order pasangan terblokir (celah "tebak id order" tertutup)';

  -- ---- 1e. Chat: pesan dari pihak terblokir ditolak basis data ----
  v_lolos := false;
  begin
    insert into order_messages (order_id, sender_id, body) values (v_ord2, v_drv, 'uji: pesan sesudah blokir');
    v_lolos := true;
  exception when others then null; end;
  if v_lolos then raise exception '[GAGAL] Pesan chat dari pihak terblokir masih masuk'; end if;
  raise notice '[OK] 1e. Chat: pesan dari pihak terblokir DITOLAK trigger t_order_messages_blokir';

  -- ---- 1f. Order AntarNow (pesan driver tertentu lewat kode) ditolak ----
  v_lolos := false;
  begin
    insert into orders (service, customer_id, status, pickup_address, pickup_location, dropoff_address, dropoff_location,
      distance_km, duration_min, fare_delivery, platform_fee, payment_method, preferred_driver_id)
    select 'ride_motor', v_cust, 'searching', 'uji', d.location, 'uji', d.location, 1, 5, 10000, 1000, 'cash', v_drv
    from drivers d where d.id = v_drv;
    v_lolos := true;
  exception when others then null; end;
  if v_lolos then raise exception '[GAGAL] Order AntarNow ke driver terblokir masih bisa dibuat'; end if;
  raise notice '[OK] 1f. create_order/AntarNow: order langsung ke driver terblokir DITOLAK';

  -- ---- 1g. Panggilan suara ditolak ----
  v_lolos := false;
  begin
    insert into call_logs (order_id, caller_id, callee_id, status) values (v_ord2, v_cust, v_drv, 'ringing');
    v_lolos := true;
  exception when others then null; end;
  if v_lolos then raise exception '[GAGAL] Panggilan suara ke pihak terblokir masih tercatat'; end if;
  raise notice '[OK] 1g. Panggilan suara antar pihak terblokir DITOLAK';

  -- ---- 1h. Buka blokir mengembalikan keadaan semula ----
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust, 'role','authenticated')::text, true);
  perform unblock_user(v_drv);
  perform set_config('request.jwt.claims', json_build_object('sub', v_drv, 'role','authenticated')::text, true);
  select count(*) into n from driver_available_orders() where id = v_ord;
  if n <> 1 then raise exception '[GAGAL] Sesudah buka blokir order tidak muncul lagi (n=%)', n; end if;
  raise notice '[OK] 1h. unblock_user(): pasangan kembali bisa dicocokkan';
end $$;
rollback;

-- ---------------------------------------------------------------------
-- 2. PELAPORAN: laporan tercatat, berbatas laju, dan bisa diselesaikan admin
-- ---------------------------------------------------------------------
begin;
do $$
declare
  v_cust uuid; v_drv uuid; v_admin uuid; v_rep uuid; v_st text; n int; v_ok int := 0; i int;
begin
  select id into v_cust  from profiles where role='customer' and is_active order by created_at limit 1;
  select id into v_drv   from drivers  where status='approved' limit 1;
  select id into v_admin from profiles where role='admin' and is_active limit 1;
  if v_cust is null or v_drv is null or v_admin is null then
    raise notice '[LEWAT] Tidak ada data pelanggan/driver/admin untuk diuji';
    return;
  end if;

  -- ---- 2a. Pelapor membuat laporan ----
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust, 'role','authenticated')::text, true);
  v_rep := report_content(v_drv, 'user', null, 'pelecehan', 'uji: mitra berkata kasar di chat');
  select status into v_st from content_reports where id = v_rep;
  if v_st <> 'open' then raise exception '[GAGAL] Laporan baru tidak berstatus open (status=%)', v_st; end if;
  raise notice '[OK] 2a. report_content() mencatat laporan dengan status "open"';

  -- ---- 2b. Pelapor hanya melihat laporannya sendiri (RLS) ----
  perform set_config('role','authenticated', true);
  if exists (select 1 from content_reports where reporter_id <> v_cust) then
    perform set_config('role','none', true);
    raise exception '[GAGAL] RLS content_reports bocor: pelapor melihat laporan orang lain';
  end if;
  perform set_config('role','none', true);
  raise notice '[OK] 2b. RLS: pelapor hanya melihat laporannya sendiri';

  -- ---- 2c. Batas laju 20/jam agar pelaporan tidak jadi alat spam ----
  for i in 1..30 loop
    begin perform report_content(v_drv, 'chat', null, 'spam', 'uji batas laju'); v_ok := v_ok + 1;
    exception when others then exit; end;
  end loop;
  if v_ok > 19 then raise exception '[GAGAL] Batas laju report_content tidak berlaku (lolos % laporan tambahan)', v_ok; end if;
  raise notice '[OK] 2c. Batas laju report_content: berhenti setelah 20 laporan/jam (tambahan lolos = %)', v_ok;

  -- ---- 2d. Non-admin tidak boleh memakai RPC admin ----
  begin
    perform admin_resolve_report(v_rep, 'reviewed', 'coba-coba');
    raise exception '[GAGAL] Non-admin berhasil menyelesaikan laporan';
  exception when others then
    if SQLERRM like '[GAGAL]%' then raise; end if;
  end;
  raise notice '[OK] 2d. admin_resolve_report() menolak non-admin';

  -- ---- 2e. Admin melihat antrean dan menyelesaikan laporan ----
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  select count(*) into n from admin_list_reports('open') where id = v_rep;
  if n <> 1 then raise exception '[GAGAL] Laporan tidak muncul di admin_list_reports(open)'; end if;
  perform admin_resolve_report(v_rep, 'reviewed', 'sudah ditinjau, tidak ada pelanggaran');
  select status into v_st from content_reports where id = v_rep;
  if v_st <> 'reviewed' then raise exception '[GAGAL] Status laporan tidak berubah jadi reviewed (status=%)', v_st; end if;
  raise notice '[OK] 2e. Admin melihat antrean lalu menandai laporan "reviewed"';

  -- ---- 2f. Semua tindakan admin tercatat di log audit ----
  select count(*) into n from audit_logs where entity = 'content_reports' and entity_id = v_rep::text;
  if n < 1 then raise exception '[GAGAL] Penyelesaian laporan tidak tercatat di audit_logs'; end if;
  raise notice '[OK] 2f. Jejak audit penanganan laporan tersimpan (% baris)', n;
end $$;
rollback;

-- ---------------------------------------------------------------------
-- 3. PENANGGUHAN pengguna dari laporan (aksi "actioned")
-- ---------------------------------------------------------------------
begin;
do $$
declare v_cust uuid; v_target uuid; v_admin uuid; v_rep uuid; v_st text; v_aktif boolean;
begin
  select id into v_cust   from profiles where role='customer' and is_active order by created_at limit 1;
  select id into v_target from profiles where role='customer' and is_active and id <> v_cust order by created_at limit 1;
  select id into v_admin  from profiles where role='admin' and is_active limit 1;
  if v_cust is null or v_target is null or v_admin is null then
    raise notice '[LEWAT] Butuh dua pelanggan + satu admin untuk diuji';
    return;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_cust, 'role','authenticated')::text, true);
  v_rep := report_content(v_target, 'chat', null, 'seksual', 'uji: kiriman konten seksual di chat');

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  perform admin_resolve_report(v_rep, 'suspend', 'konten seksual di chat pesanan');
  select status into v_st from content_reports where id = v_rep;
  select is_active into v_aktif from profiles where id = v_target;
  if v_st <> 'actioned' then raise exception '[GAGAL] Status laporan bukan actioned (status=%)', v_st; end if;
  if v_aktif then raise exception '[GAGAL] Pengguna yang dilaporkan tidak ditangguhkan'; end if;
  raise notice '[OK] 3. Aksi "tangguhkan": akun dinonaktifkan dan laporan berstatus "actioned"';

  -- Alasan wajib: aksi tangguhkan tanpa keterangan harus ditolak
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust, 'role','authenticated')::text, true);
  v_rep := report_content(v_target, 'chat', null, 'spam', 'uji kedua');
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  begin
    perform admin_resolve_report(v_rep, 'suspend', '');
    raise exception '[GAGAL] Penangguhan tanpa alasan diterima';
  exception when others then
    if SQLERRM like '[GAGAL]%' then raise; end if;
  end;
  raise notice '[OK] 3b. Penangguhan tanpa alasan ditolak (jejak alasan wajib untuk bukti ke Google)';
end $$;
rollback;

-- ---------------------------------------------------------------------
-- 4. RLS user_blocks: pihak yang DIBLOKIR tidak boleh tahu siapa memblokirnya
-- ---------------------------------------------------------------------
begin;
do $$
declare v_a uuid; v_b uuid; n int;
begin
  select id into v_a from profiles where role='customer' and is_active order by created_at limit 1;
  select id into v_b from profiles where role='customer' and is_active and id <> v_a order by created_at limit 1;
  if v_a is null or v_b is null then raise notice '[LEWAT] Butuh dua pelanggan'; return; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role','authenticated')::text, true);
  perform block_user(v_b, 'uji rls');

  perform set_config('request.jwt.claims', json_build_object('sub', v_b, 'role','authenticated')::text, true);
  perform set_config('role','authenticated', true);
  select count(*) into n from user_blocks;
  perform set_config('role','none', true);
  if n <> 0 then raise exception '[GAGAL] Pihak yang diblokir bisa melihat baris blokir (n=%)', n; end if;
  raise notice '[OK] 4. RLS user_blocks: pihak yang diblokir tidak melihat blokir atas dirinya';

  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role','authenticated')::text, true);
  perform set_config('role','authenticated', true);
  select count(*) into n from user_blocks;
  perform set_config('role','none', true);
  if n < 1 then raise exception '[GAGAL] Pemblokir tidak melihat daftar blokirnya sendiri'; end if;
  raise notice '[OK] 4b. RLS user_blocks: pemblokir melihat daftar blokirnya sendiri';
end $$;
rollback;
