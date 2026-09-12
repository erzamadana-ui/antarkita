-- =====================================================================
-- uji_turn.sql — Uji lapisan TURN Cloudflare (migrasi 0082)
--
-- Membuktikan:
--   1. api_token TIDAK PERNAH keluar lewat admin_turn_status() (hanya versi tersamar).
--   2. Non-admin tidak bisa membaca/menulis turn_secrets — lewat tabel maupun RPC.
--   3. anon & authenticated tidak punya privilege tabel; RLS menyala di kedua tabel.
--   4. admin_set_turn_config(): kunci kosong = "jangan ubah", clear menghapus, ttl dibatasi.
--
-- Pola: setiap skenario BEGIN … ROLLBACK — kredensial TURN pemilik tidak berubah.
-- Cara pakai: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/uji_turn.sql
-- =====================================================================

begin;
do $$
declare v_admin uuid; v_user uuid; v_st jsonb; v_msg text; n int;
  c_tok constant text := 'RAHASIA-TURN-UJI-JANGAN-BOCOR-77aa';
  v_asli turn_secrets%rowtype;
begin
  -- simpan baris asli (pertahanan ganda selain ROLLBACK: skrip ini juga aman dijalankan lewat alat yang auto-commit)
  select * into v_asli from turn_secrets where id = 1;
  select id into v_admin from profiles where role = 'admin' and is_active order by created_at limit 1;
  select id into v_user  from profiles where role <> 'admin' and is_active order by created_at limit 1;
  if v_admin is null or v_user is null then raise notice '[LEWAT] butuh 1 admin + 1 non-admin'; return; end if;

  -- 1. admin menyimpan kredensial → status tidak membocorkan api_token
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  v_st := admin_set_turn_config(jsonb_build_object('token_id','tokenid-uji-1234', 'api_token', c_tok, 'ttl_seconds', 3600));
  if position(c_tok in v_st::text) > 0 then raise exception '[GAGAL] api_token bocor lewat admin_turn_status()'; end if;
  if not (v_st->>'configured')::boolean then raise exception '[GAGAL] configured=false setelah disimpan'; end if;
  if v_st->>'api_token_masked' not like 'RAHA••••%' then raise exception '[GAGAL] penyamaran api_token salah: %', v_st->>'api_token_masked'; end if;
  if (v_st->>'ttl_seconds')::int <> 3600 then raise exception '[GAGAL] ttl_seconds tidak tersimpan'; end if;
  raise notice '[OK] 1. admin_turn_status() hanya mengembalikan versi tersamar (tanpa api_token)';

  -- 4a. kunci kosong = jangan ubah
  v_st := admin_set_turn_config(jsonb_build_object('token_id','', 'api_token','', 'enabled', false));
  if (v_st->>'enabled')::boolean then raise exception '[GAGAL] enabled=false tidak tersimpan'; end if;
  if (select api_token from turn_secrets where id = 1) <> c_tok then raise exception '[GAGAL] api_token terhapus oleh string kosong'; end if;
  raise notice '[OK] 4a. Kunci kosong tidak menimpa kredensial; sakelar enabled tersimpan';

  -- 4b. ttl di luar batas ditolak oleh CHECK
  begin
    perform admin_set_turn_config(jsonb_build_object('ttl_seconds', 10));
    raise exception '[GAGAL] ttl_seconds=10 diterima (di bawah 300)';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg like '[GAGAL]%' then raise; end if;
    raise notice '[OK] 4b. ttl di luar 300–86400 ditolak (%)', left(v_msg, 60);
  end;

  -- 2. non-admin
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role','authenticated')::text, true);
  begin
    perform admin_turn_status();
    raise exception '[GAGAL] non-admin bisa memanggil admin_turn_status()';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg like '[GAGAL]%' then raise; end if;
    raise notice '[OK] 2a. admin_turn_status() menolak non-admin (%)', v_msg;
  end;
  begin
    perform admin_set_turn_config(jsonb_build_object('api_token','DICURI'));
    raise exception '[GAGAL] non-admin bisa menulis kredensial TURN';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg like '[GAGAL]%' then raise; end if;
    raise notice '[OK] 2b. admin_set_turn_config() menolak non-admin (%)', v_msg;
  end;

  -- 3. hak tabel & RLS
  select count(*) into n from information_schema.role_table_grants
   where table_schema = 'public' and table_name in ('turn_secrets','turn_issue_log') and grantee in ('anon','authenticated');
  if n > 0 then raise exception '[GAGAL] anon/authenticated masih punya % hak tabel pada turn_secrets/turn_issue_log', n; end if;
  raise notice '[OK] 3a. anon & authenticated tidak punya hak apa pun atas turn_secrets/turn_issue_log';
  select count(*) into n from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'public' and c.relname in ('turn_secrets','turn_issue_log') and c.relrowsecurity;
  if n <> 2 then raise exception '[GAGAL] RLS belum menyala di kedua tabel (baru % dari 2)', n; end if;
  raise notice '[OK] 3b. RLS menyala di turn_secrets dan turn_issue_log';
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname in ('admin_turn_status','admin_set_turn_config')
     and has_function_privilege('anon', p.oid, 'execute');
  if n > 0 then raise exception '[GAGAL] anon masih bisa mengeksekusi % fungsi admin TURN', n; end if;
  raise notice '[OK] 3c. anon tidak bisa mengeksekusi fungsi admin TURN';

  -- 4c. clear menghapus
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  v_st := admin_set_turn_config(jsonb_build_object('clear', true));
  if (v_st->>'configured')::boolean then raise exception '[GAGAL] clear tidak menghapus kredensial'; end if;
  raise notice '[OK] 4c. clear=true menghapus kredensial; status kembali "belum dikonfigurasi"';

  -- pulihkan baris asli
  delete from turn_secrets where id = 1;
  if v_asli.id is not null then insert into turn_secrets select v_asli.*; end if;
end $$;
rollback;
