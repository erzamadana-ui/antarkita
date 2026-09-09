-- =====================================================================
-- uji_keamanan.sql — Skenario uji keamanan (agen keamanan & perlindungan data)
--
-- Pola: setiap skenario memakai transaksi yang di-ROLLBACK sehingga tidak
-- mengubah data nyata. Meniru sesi pengguna via set_config request.jwt.claims
-- + role authenticated/anon. Jalankan dengan psql (berkas terpisah dari
-- simulasi_e2e.sql untuk menghindari bentrok dengan agen lain).
--
-- Cara pakai:  psql "$DATABASE_URL" -v ON_ERROR_STOP=0 -f supabase/tests/uji_keamanan.sql
-- Semua blok diharapkan menghasilkan pesan "[OK]" via RAISE NOTICE.
-- =====================================================================

\set A '00000000-0000-0000-0000-0000000000aa'

-- ---------- 1. Isolasi RLS: pengguna tak bisa membaca data pengguna lain ----------
-- (gunakan dua id pengguna nyata dari `select id from profiles`; ganti sesuai data)
-- Contoh generik: pastikan pengguna hanya melihat baris miliknya.
do $$
declare v_uid uuid;
begin
  select id into v_uid from profiles where role='customer' limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub',v_uid,'role','authenticated')::text, true);
  perform set_config('role','authenticated', true);
  -- Dompet: hanya milik sendiri
  if exists (select 1 from wallets where user_id <> v_uid) then
    raise exception '[GAGAL] RLS wallets bocor: melihat dompet pengguna lain';
  end if;
  if exists (select 1 from orders where customer_id <> v_uid and driver_id is distinct from v_uid
             and status <> 'searching' and coalesce(merchant_id::text,'')='') then
    raise exception '[GAGAL] RLS orders bocor';
  end if;
  perform set_config('role','none', true);
  raise notice '[OK] RLS: pengguna hanya melihat dompet/orders miliknya';
end $$;

-- ---------- 2. Eskalasi hak: customer tidak bisa jadi admin ----------
do $$
declare v_uid uuid; v_blocked boolean := false;
begin
  select id into v_uid from profiles where role='customer' limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub',v_uid,'role','authenticated')::text, true);
  perform set_config('role','authenticated', true);
  begin
    update profiles set role='admin' where id=v_uid;
  exception when others then v_blocked := true;
  end;
  perform set_config('role','none', true);
  if not v_blocked then raise exception '[GAGAL] Customer berhasil menaikkan diri jadi admin'; end if;
  raise notice '[OK] Eskalasi: update profiles->admin diblokir trigger';
end $$;

-- ---------- 3. Fungsi admin menolak non-admin ----------
do $$
declare v_uid uuid; v_blocked boolean := false;
begin
  select id into v_uid from profiles where role='customer' limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub',v_uid,'role','authenticated')::text, true);
  perform set_config('role','authenticated', true);
  begin
    perform admin_adjust_wallet(v_uid, 999999999, 'uji');
  exception when others then v_blocked := true;
  end;
  perform set_config('role','none', true);
  if not v_blocked then raise exception '[GAGAL] admin_adjust_wallet dijalankan non-admin'; end if;
  raise notice '[OK] Fungsi admin menolak non-admin';
end $$;

-- ---------- 4. Tabel QC internal terkunci dari klien ----------
do $$
declare v_blocked boolean := false;
begin
  perform set_config('role','anon', true);
  begin
    perform 1 from _qc_sim_log limit 1;
  exception when insufficient_privilege then v_blocked := true;
           when others then v_blocked := true;
  end;
  perform set_config('role','none', true);
  if not v_blocked then raise exception '[GAGAL] anon masih bisa membaca _qc_sim_log'; end if;
  raise notice '[OK] _qc_sim_log terkunci dari anon';
end $$;

-- ---------- 5. Anti-spam create_ticket (batas per jam) ----------
-- Diverifikasi manual dalam transaksi rollback: 10 sukses, ke-11 diblokir.
-- (lihat laporan; tidak dijalankan di sini agar tidak mengganggu ticket_seq)

-- ---------- 6. gateway_secrets/push_config tak tersentuh klien ----------
do $$
declare v_blocked boolean := false;
begin
  -- Meniru sesi pelanggan biasa (uuid TIDAK boleh dimasukkan ke v_blocked yang bertipe boolean —
  -- baris lama "select id into v_blocked" selalu melempar "invalid input syntax for type boolean").
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select id from profiles where role='customer' limit 1), 'role','authenticated')::text, true);
  perform set_config('role','authenticated', true);
  begin
    perform 1 from gateway_secrets limit 1;
  exception when others then v_blocked := true;
  end;
  perform set_config('role','none', true);
  if not v_blocked then raise exception '[GAGAL] authenticated bisa membaca gateway_secrets'; end if;
  raise notice '[OK] gateway_secrets deny-all untuk authenticated';
end $$;
