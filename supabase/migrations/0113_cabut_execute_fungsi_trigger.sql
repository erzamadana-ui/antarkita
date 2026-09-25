-- 0113 (25 Sep 2026, pasca go-live v4): tindak lanjut Supabase Security Advisor.
-- Fungsi TRIGGER bersifat SECURITY DEFINER tidak boleh bisa dipanggil lewat /rest/v1/rpc oleh anon/authenticated.
-- Hak EXECUTE tidak diperiksa saat trigger dijalankan, jadi pencabutan ini tidak mengubah perilaku trigger.
do $$ declare r record; n int := 0; begin
  for r in select p.oid::regprocedure s from pg_proc p left join pg_depend d on d.objid = p.oid and d.deptype = 'e'
           where p.pronamespace = 'public'::regnamespace and d.objid is null and p.prorettype = 'trigger'::regtype and p.prosecdef loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.s); n := n + 1;
  end loop;
  raise notice '0113: EXECUTE dicabut dari % fungsi trigger', n;
end $$;
