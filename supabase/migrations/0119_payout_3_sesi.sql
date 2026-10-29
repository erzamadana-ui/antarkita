-- =====================================================================
-- 0119 — Pencairan 3 sesi harian (daftar transfer otomatis) untuk merchant & driver dari dana AntarVoucher
--   Keputusan GM 29 Okt 2026:
--   • payout_batch_cutoffs → ["09:00","13:00","17:00"] WIB (nilai lama disimpan di _migration_backup_settings '0119').
--     Setelan baru: payout_auto_batch_enabled (true), payout_min_amount (50.000 [ASUMSI]: pencairan < nominal ini tidak ikut
--     batch otomatis sesi 1–2, dikumpulkan ke sesi TERAKHIR hari itu agar transfer kecil tidak memecah batch; batch manual
--     admin tetap mengambil semua).
--   • Tabel payout_sessions (1 baris per sesi per hari: menunggu | kosong | dibuat | selesai; cutoff 'manual' untuk pemicu manual).
--   • payout_batch_create_internal(actor, label, min_amount) = inti admin_payout_batch_create() lama (0114) tanpa admin_require;
--     admin_payout_batch_create() memanggilnya (perilaku lama tetap: approved + belum punya batch + provider manual; merchant ikut
--     karena request_withdrawal sudah terbuka untuk driver/merchant sejak 0090).
--   • payout_batch_auto(p_now) dipanggil cron tiap 5 menit: tiap cutoff hari ini yang sudah lewat & belum punya sesi → buat sesi;
--     bila ada pencairan approved tanpa batch → batch 'Sesi HH:MM dd-mm-yyyy' + notifikasi admin (notifications, push_outbox
--     source 'payout_session', security_events 'payout.session_ready'); kalau tidak ada → sesi 'kosong'.
--   • Auto-approve: request_withdrawal (0114) sudah menyetujui otomatis driver & merchant ≤ auto_payout_max (1 jt) bila rekening
--     terverifikasi; 0119 menambah syarat merchant harus berstatus approved (setara syarat driver).
--   • admin_payout_sessions(date), admin_payout_batch_create_now(label) (admin + PIN), admin_payout_batch_export_bca(batch) → CSV
--     transfer massal KlikBCA Bisnis [ASUMSI FORMAT — verifikasi dengan template resmi BCA sebelum unggah pertama]:
--     header `No Rekening Tujuan,Nominal,Nama Penerima,Berita,Kode Bank` (Kode Bank kosong untuk sesama BCA; bank lain dari tabel bank_codes).
--   • admin_payout_batch_settle (0114) tetap; saat semua baris batch selesai → payout_sessions.status 'selesai'.
-- Idempoten. Rollback: supabase/rollback/0119_down.sql
-- =====================================================================
do $$
declare s text;
begin
  foreach s in array array[
    -- diubah
    'public.admin_payout_batch_create()', 'public.admin_payout_batch_settle(uuid,jsonb)', 'public.request_withdrawal(bigint,text,text,text)',
    'public.app_setting_specs()',
    -- baru
    'public.payout_batch_create_internal(uuid,text,bigint)', 'public.payout_batch_auto(timestamptz)', 'public.admin_payout_sessions(date)',
    'public.admin_payout_batch_create_now(text)', 'public.admin_payout_batch_export_bca(uuid)', 'public.payout_cutoffs()'] loop
    perform _mig_backup('0119', s);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 1. Setelan
-- ---------------------------------------------------------------------
do $$
begin
  -- nilai lama ditimpa SEKALI (saat cadangan '0119' belum ada); pemasangan ulang tidak menimpa pilihan admin sesudahnya
  if not exists (select 1 from _migration_backup_settings where version = '0119' and key = 'payout_batch_cutoffs') then
    insert into _migration_backup_settings (version, key, value)
    select '0119', key, value from app_settings where key = 'payout_batch_cutoffs';
    insert into _migration_backup_settings (version, key, value) values ('0119', 'payout_batch_cutoffs', null) on conflict (version, key) do nothing;
    insert into app_settings (key, value) values ('payout_batch_cutoffs', '["09:00","13:00","17:00"]'::jsonb)
    on conflict (key) do update set value = excluded.value, updated_at = now();
    raise notice '0119: payout_batch_cutoffs → 09:00/13:00/17:00 (nilai lama di _migration_backup_settings)';
  else
    raise notice '0119: payout_batch_cutoffs sudah pernah ditetapkan, tidak ditimpa (%)', (select value from app_settings where key = 'payout_batch_cutoffs');
  end if;
  insert into app_settings (key, value) values ('payout_auto_batch_enabled', 'true'::jsonb), ('payout_min_amount', '50000'::jsonb)
  on conflict (key) do nothing;
end $$;

-- ---------------------------------------------------------------------
-- 2. Tabel sesi & kode bank
-- ---------------------------------------------------------------------
create table if not exists public.payout_sessions (
  id            uuid primary key default gen_random_uuid(),
  session_date  date not null,
  cutoff        text not null,
  batch_id      uuid references public.payout_batches(id),
  status        text not null default 'menunggu' check (status in ('menunggu', 'kosong', 'dibuat', 'selesai')),
  items         int not null default 0,
  total         bigint not null default 0,
  note          text,
  created_at    timestamptz not null default now(),
  closed_at     timestamptz
);
-- unik per (tanggal, cutoff) untuk sesi terjadwal; sesi 'manual' boleh berkali-kali sehari
create unique index if not exists payout_sessions_date_cutoff_ux on public.payout_sessions (session_date, cutoff) where cutoff <> 'manual';
create index if not exists payout_sessions_batch_idx on public.payout_sessions (batch_id) where batch_id is not null;
comment on table public.payout_sessions is '0119: sesi transfer harian (cutoff WIB) — satu baris per sesi; dibuat payout_batch_auto()/admin_payout_batch_create_now().';
alter table public.payout_sessions enable row level security;
drop policy if exists payout_sessions_admin on public.payout_sessions;
create policy payout_sessions_admin on public.payout_sessions for select to authenticated using (admin_has('payments_view'));
revoke all on public.payout_sessions from public, anon, authenticated;
grant select on public.payout_sessions to authenticated;
grant all on public.payout_sessions to service_role;

create table if not exists public.bank_codes (
  code      text primary key,
  name      text not null,
  bank_code text not null,
  aliases   text[] not null default '{}'
);
comment on table public.bank_codes is '0119: kode bank (kliring/transfer massal) untuk ekspor CSV BCA; dicocokkan ke withdrawal_requests.bank_name (ILIKE alias).';
insert into public.bank_codes (code, name, bank_code, aliases) values
  ('bca',     'BCA',          '014', array['bca', 'central asia']),
  ('bri',     'BRI',          '002', array['bri', 'rakyat indonesia']),
  ('bni',     'BNI',          '009', array['bni', 'negara indonesia']),
  ('mandiri', 'Bank Mandiri', '008', array['mandiri']),
  ('btn',     'BTN',          '200', array['btn', 'tabungan negara']),
  ('bsi',     'BSI',          '451', array['bsi', 'syariah indonesia']),
  ('cimb',    'CIMB Niaga',   '022', array['cimb', 'niaga']),
  ('permata', 'Permata',      '013', array['permata']),
  ('danamon', 'Danamon',      '011', array['danamon']),
  ('seabank', 'SeaBank',      '535', array['seabank', 'sea bank']),
  ('jago',    'Bank Jago',    '542', array['jago'])
on conflict (code) do update set name = excluded.name, bank_code = excluded.bank_code, aliases = excluded.aliases;
alter table public.bank_codes enable row level security;
drop policy if exists bank_codes_read on public.bank_codes;
create policy bank_codes_read on public.bank_codes for select to authenticated using (true);
revoke all on public.bank_codes from public, anon;
grant select on public.bank_codes to authenticated;
grant all on public.bank_codes to service_role;

-- ---------------------------------------------------------------------
-- 3. Inti pembuatan batch (internal) + pembungkus admin lama
-- ---------------------------------------------------------------------
create or replace function public.payout_cutoffs()
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce((select array_agg(t.x order by t.x) from (
            select e.v #>> '{}' as x from app_settings a, jsonb_array_elements(a.value) e(v)
             where a.key = 'payout_batch_cutoffs' and jsonb_typeof(a.value) = 'array' and (e.v #>> '{}') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') t),
          array['09:00', '13:00', '17:00']);
$$;
revoke all on function public.payout_cutoffs() from public, anon;
grant execute on function public.payout_cutoffs() to authenticated;

create or replace function public.payout_batch_create_internal(p_actor uuid, p_label text, p_min_amount bigint default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b payout_batches; n int; v_total bigint; v_min bigint := greatest(0, coalesce(p_min_amount, 0));
begin
  perform pg_advisory_xact_lock(hashtext('payout_batch_create'));
  select count(*), coalesce(sum(amount), 0) into n, v_total from withdrawal_requests
   where status = 'approved' and settled_at is null and batch_id is null and payout_status = 'PAYOUT_PENDING' and provider = 'manual' and amount >= v_min;
  if n = 0 then return jsonb_build_object('batch_id', null, 'count', 0, 'total', 0, 'label', p_label); end if;
  insert into payout_batches (created_by, cutoff, status, total, count)
  values (p_actor, coalesce(p_label, to_char(now() at time zone 'Asia/Jakarta', 'YYYY-MM-DD HH24:MI')), 'open', v_total, n) returning * into b;
  update withdrawal_requests set batch_id = b.id
   where status = 'approved' and settled_at is null and batch_id is null and payout_status = 'PAYOUT_PENDING' and provider = 'manual' and amount >= v_min;
  perform log_activity('payout.batch_create', 'payout_batches', b.id::text, 'Batch pencairan dibuat: ' || n || ' transfer, Rp' || v_total || coalesce(' (' || p_label || ')', ''),
    jsonb_build_object('count', n, 'total', v_total, 'label', p_label, 'actor', p_actor, 'min_amount', v_min));
  return jsonb_build_object('batch_id', b.id, 'count', n, 'total', v_total, 'label', b.cutoff, 'batch', to_jsonb(b));
end $$;
revoke all on function public.payout_batch_create_internal(uuid, text, bigint) from public, anon, authenticated;
grant execute on function public.payout_batch_create_internal(uuid, text, bigint) to service_role;

-- pembungkus lama (0114): tanda tangan & perilaku tetap (returns payout_batches; PAYOUT_BATCH_EMPTY bila kosong)
create or replace function public.admin_payout_batch_create()
returns payout_batches language plpgsql security definer set search_path = public as $$
declare r jsonb; b payout_batches;
begin
  perform admin_require('payout');
  perform admin_require_unlock();
  r := payout_batch_create_internal(auth.uid(), to_char(now() at time zone 'Asia/Jakarta', 'YYYY-MM-DD HH24:MI'), 0);
  if r->>'batch_id' is null then raise exception 'PAYOUT_BATCH_EMPTY: tidak ada pencairan approved yang menunggu batch'; end if;
  select * into b from payout_batches where id = (r->>'batch_id')::uuid;
  return b;
end $$;
revoke all on function public.admin_payout_batch_create() from public, anon;
grant execute on function public.admin_payout_batch_create() to authenticated;

-- pemicu manual di luar jadwal → sesi 'manual'
create or replace function public.admin_payout_batch_create_now(p_label text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb; s payout_sessions; v_label text;
begin
  perform admin_require('payout');
  perform admin_require_unlock();
  v_label := coalesce(nullif(btrim(p_label), ''), 'Manual ' || to_char(now() at time zone 'Asia/Jakarta', 'HH24:MI DD-MM-YYYY'));
  r := payout_batch_create_internal(auth.uid(), v_label, 0);
  if r->>'batch_id' is null then raise exception 'PAYOUT_BATCH_EMPTY: tidak ada pencairan approved yang menunggu batch'; end if;
  insert into payout_sessions (session_date, cutoff, batch_id, status, items, total, note)
  values ((now() at time zone 'Asia/Jakarta')::date, 'manual', (r->>'batch_id')::uuid, 'dibuat', (r->>'count')::int, (r->>'total')::bigint, v_label)
  returning * into s;
  perform log_activity('payout.session_manual', 'payout_sessions', s.id::text, 'Sesi transfer manual: ' || s.items || ' transfer, Rp' || s.total, jsonb_build_object('batch_id', s.batch_id, 'label', v_label));
  return jsonb_build_object('session', to_jsonb(s), 'batch', r->'batch');
end $$;
revoke all on function public.admin_payout_batch_create_now(text) from public, anon;
grant execute on function public.admin_payout_batch_create_now(text) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Otomatis per cutoff (cron */5) — p_now untuk simulasi waktu di uji
-- ---------------------------------------------------------------------
create or replace function public.payout_batch_auto(p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_wib timestamp := coalesce(p_now, now()) at time zone 'Asia/Jakarta'; v_date date; v_time time; cut text; cuts text[] := payout_cutoffs();
        v_enabled boolean := coalesce((select lower(value #>> '{}') = 'true' from app_settings where key = 'payout_auto_batch_enabled'), true);
        v_min bigint := greatest(0, setting_num('payout_min_amount', 50000))::bigint; v_last text; s payout_sessions; r jsonb; v_label text;
        a uuid; v_out jsonb := '[]'::jsonb; n_new int := 0;
begin
  v_date := v_wib::date; v_time := v_wib::time;
  v_last := cuts[array_upper(cuts, 1)];
  perform pg_advisory_xact_lock(hashtext('payout_batch_auto'));
  foreach cut in array cuts loop
    continue when cut::time > v_time;
    continue when exists (select 1 from payout_sessions where session_date = v_date and cutoff = cut);
    insert into payout_sessions (session_date, cutoff, status) values (v_date, cut, 'menunggu') returning * into s;
    n_new := n_new + 1;
    v_label := 'Sesi ' || cut || ' ' || to_char(v_date, 'DD-MM-YYYY');
    r := null;
    if v_enabled then
      -- sesi terakhir hari itu mengambil semua nominal; sesi sebelumnya hanya ≥ payout_min_amount
      r := payout_batch_create_internal(null, v_label, case when cut = v_last then 0 else v_min end);
    end if;
    if r is not null and r->>'batch_id' is not null then
      update payout_sessions set status = 'dibuat', batch_id = (r->>'batch_id')::uuid, items = (r->>'count')::int, total = (r->>'total')::bigint where id = s.id returning * into s;
      insert into security_events (kind, user_id, detail) values ('payout.session_ready', null,
        jsonb_build_object('session_id', s.id, 'cutoff', cut, 'date', v_date, 'batch_id', s.batch_id, 'items', s.items, 'total', s.total));
      for a in select p.id from profiles p where p.role::text = 'admin' and coalesce(p.is_active, true) loop
        insert into notifications (user_id, kind, title, body, data) values (a, 'system', 'Daftar transfer ' || cut || ' siap',
          s.items || ' transfer senilai Rp' || replace(to_char(s.total, 'FM999,999,999,999'), ',', '.') || ' menunggu diunggah ke bank (' || v_label || ').',
          jsonb_build_object('kind', 'payout_session', 'session_id', s.id, 'batch_id', s.batch_id));
        perform push_enqueue(a, 'Daftar transfer ' || cut || ' siap', s.items || ' transfer, Rp' || replace(to_char(s.total, 'FM999,999,999,999'), ',', '.'),
          jsonb_build_object('kind', 'payout_session', 'session_id', s.id, 'batch_id', s.batch_id), 'payout_session');
      end loop;
    else
      update payout_sessions set status = 'kosong', closed_at = now(), note = case when not v_enabled then 'batch otomatis nonaktif' else null end where id = s.id returning * into s;
    end if;
    perform log_activity('payout.session_auto', 'payout_sessions', s.id::text, v_label || ': ' || s.status || ' (' || s.items || ' transfer, Rp' || s.total || ')',
      jsonb_build_object('batch_id', s.batch_id, 'items', s.items, 'total', s.total, 'min_amount', case when cut = v_last then 0 else v_min end));
    v_out := v_out || jsonb_build_object('session_id', s.id, 'cutoff', cut, 'status', s.status, 'batch_id', s.batch_id, 'items', s.items, 'total', s.total);
  end loop;
  return jsonb_build_object('date', v_date, 'time', to_char(v_time, 'HH24:MI'), 'cutoffs', to_jsonb(cuts), 'enabled', v_enabled, 'new_sessions', n_new, 'sessions', v_out);
end $$;
revoke all on function public.payout_batch_auto(timestamptz) from public, anon, authenticated;
grant execute on function public.payout_batch_auto(timestamptz) to service_role;

do $$
begin
  if to_regnamespace('cron') is not null then
    perform cron.schedule('antarkita_payout_batch_auto', '*/5 * * * *', 'select public.payout_batch_auto()');
  end if;
exception when others then raise notice '0119: cron antarkita_payout_batch_auto tidak dijadwalkan (%)', sqlerrm;
end $$;

-- ---------------------------------------------------------------------
-- 5. Daftar sesi hari itu (Panel Admin › Keuangan)
-- ---------------------------------------------------------------------
create or replace function public.admin_payout_sessions(p_date date default null)
returns setof jsonb language plpgsql stable security definer set search_path = public as $$
declare v_date date := coalesce(p_date, (now() at time zone 'Asia/Jakarta')::date); v_now time := (now() at time zone 'Asia/Jakarta')::time;
        v_today date := (now() at time zone 'Asia/Jakarta')::date; v_pend_n int; v_pend_t bigint;
begin
  perform admin_require('payments_view');
  select count(*), coalesce(sum(amount), 0) into v_pend_n, v_pend_t from withdrawal_requests
   where status = 'approved' and settled_at is null and batch_id is null and payout_status = 'PAYOUT_PENDING' and provider = 'manual';
  return query
    -- sesi terjadwal (cutoff dari setelan): satu baris per cutoff, 'menunggu' bila belum ada sesinya
    select jsonb_build_object(
      'session_id', s.id, 'session_date', v_date, 'cutoff', j.cutoff,
      'status', coalesce(s.status, 'menunggu'),
      'is_past', v_date < v_today or (v_date = v_today and j.cutoff::time <= v_now),
      'batch_id', s.batch_id, 'batch_status', b.status, 'items', coalesce(s.items, 0), 'total', coalesce(s.total, 0),
      'settled_items', coalesce((select count(*) from withdrawal_requests w where w.batch_id = s.batch_id and w.settled_at is not null), 0),
      'failed_items', coalesce((select count(*) from withdrawal_requests w where w.batch_id = s.batch_id and w.status = 'rejected'), 0),
      'pending_now_items', case when s.id is null then v_pend_n else 0 end,
      'pending_now_total', case when s.id is null then v_pend_t else 0 end,
      'note', s.note, 'created_at', s.created_at, 'closed_at', s.closed_at)
      from unnest(payout_cutoffs()) with ordinality j(cutoff, ord)
      left join payout_sessions s on s.session_date = v_date and s.cutoff = j.cutoff
      left join payout_batches b on b.id = s.batch_id
     order by j.ord;
  return query
    -- sesi manual / cutoff lama yang sudah tidak ada di setelan: apa adanya
    select jsonb_build_object(
      'session_id', s.id, 'session_date', s.session_date, 'cutoff', s.cutoff, 'status', s.status, 'is_past', true,
      'batch_id', s.batch_id, 'batch_status', b.status, 'items', s.items, 'total', s.total,
      'settled_items', coalesce((select count(*) from withdrawal_requests w where w.batch_id = s.batch_id and w.settled_at is not null), 0),
      'failed_items', coalesce((select count(*) from withdrawal_requests w where w.batch_id = s.batch_id and w.status = 'rejected'), 0),
      'pending_now_items', 0, 'pending_now_total', 0,
      'note', s.note, 'created_at', s.created_at, 'closed_at', s.closed_at)
      from payout_sessions s left join payout_batches b on b.id = s.batch_id
     where s.session_date = v_date and s.cutoff <> all (payout_cutoffs())
     order by s.created_at;
end $$;
revoke all on function public.admin_payout_sessions(date) from public, anon;
grant execute on function public.admin_payout_sessions(date) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Ekspor CSV transfer massal BCA [ASUMSI FORMAT]
-- ---------------------------------------------------------------------
create or replace function public.admin_payout_batch_export_bca(p_batch uuid)
returns text language plpgsql security definer set search_path = public as $$
declare b payout_batches; v_csv text; v_rows text;
begin
  perform admin_require('payout');
  select * into b from payout_batches where id = p_batch for update;
  if not found then raise exception 'Batch tidak ditemukan'; end if;
  if b.status = 'open' then
    update payout_batches set status = 'exported', exported_at = now(), exported_by = auth.uid() where id = b.id;
    perform log_activity('payout.batch_export', 'payout_batches', b.id::text, 'Batch pencairan diekspor CSV BCA (' || b.count || ' transfer)', jsonb_build_object('format', 'bca'));
  end if;
  select string_agg(
           regexp_replace(w.bank_account, '[^0-9]', '', 'g') || ',' || w.amount::text || ','
           || left(regexp_replace(coalesce(w.account_name, ''), '[",\r\n]', ' ', 'g'), 40) || ','
           || 'AntarKita ' || left(w.id::text, 8) || ','
           || coalesce((select case when k.code = 'bca' then '' else k.bank_code end from bank_codes k
                         where exists (select 1 from unnest(k.aliases) al where w.bank_name ilike '%' || al || '%') limit 1), ''),
           E'\r\n' order by w.created_at)
    into v_rows
    from withdrawal_requests w where w.batch_id = p_batch and w.settled_at is null and w.status = 'approved';
  v_csv := 'No Rekening Tujuan,Nominal,Nama Penerima,Berita,Kode Bank' || coalesce(E'\r\n' || v_rows, '');
  return v_csv;
end $$;
revoke all on function public.admin_payout_batch_export_bca(uuid) from public, anon;
grant execute on function public.admin_payout_batch_export_bca(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 7. Tambalan fungsi lama (jangkar pada baris kode)
-- ---------------------------------------------------------------------
-- settle: batch selesai → sesi 'selesai'
select _v3_splice('0119', 'public.admin_payout_batch_settle(uuid,jsonb)',
  $a$    update payout_batches set status = 'settled', settled_at = now(), settled_by = auth.uid() where id = p_batch returning * into b;$a$,
  $a$    update payout_batches set status = 'settled', settled_at = now(), settled_by = auth.uid() where id = p_batch returning * into b;
    update payout_sessions set status = 'selesai', closed_at = now() where batch_id = p_batch and status <> 'selesai';$a$,
  'payout_sessions set status');

-- auto-approve: merchant harus berstatus approved (setara syarat driver)
select _v3_splice('0119', 'public.request_withdrawal(bigint,text,text,text)',
  $a$    and not exists (select 1 from drivers where id = auth.uid() and status <> 'approved');$a$,
  $a$    and not exists (select 1 from drivers where id = auth.uid() and status <> 'approved')
    and not exists (select 1 from merchants where owner_id = auth.uid() and status <> 'approved');$a$,
  'merchants where owner_id = auth.uid() and status');

-- spesifikasi setelan
select _v3_splice('0119', 'public.app_setting_specs()',
  $a$    ('payout_batch_cutoffs',       'json',    null, null, null, '["10:00","15:00"]', 'WIB', 'UANG', 'Jam pembuatan batch transfer pencairan', 'payout'),$a$,
  $a$    ('payout_batch_cutoffs',       'json',    null, null, null, '["09:00","13:00","17:00"]', 'WIB', 'UANG', '0119: jam sesi transfer harian (batch otomatis)', 'payout'),
    ('payout_auto_batch_enabled',  'bool',    null, null, null, 'true', '', 'UANG', '0119: buat batch transfer otomatis tiap sesi (cron 5 menit)', 'payout'),
    ('payout_min_amount',          'int',     0, 100000000, null, '50000', 'Rp', 'UANG', '0119: nominal minimum ikut batch otomatis sesi awal; sesi terakhir mengambil semua [ASUMSI]', 'payout'),$a$,
  'payout_auto_batch_enabled');

-- ---------------------------------------------------------------------
-- 8. Penjaga
-- ---------------------------------------------------------------------
do $$
declare v_cron boolean := false;
begin
  if to_regclass('public.payout_sessions') is null or to_regclass('public.bank_codes') is null then raise exception '0119 batal: tabel sesi/kode bank belum ada'; end if;
  if coalesce(array_length(payout_cutoffs(), 1), 0) < 1 then raise exception '0119 batal: payout_batch_cutoffs kosong/tidak valid'; end if;
  if position('payout_batch_create_internal' in pg_get_functiondef('public.admin_payout_batch_create()'::regprocedure)) = 0 then raise exception '0119 batal: admin_payout_batch_create belum memakai inti internal'; end if;
  if position('payout_sessions' in pg_get_functiondef('public.admin_payout_batch_settle(uuid,jsonb)'::regprocedure)) = 0 then raise exception '0119 batal: settle belum menutup sesi'; end if;
  if position('merchants where owner_id' in pg_get_functiondef('public.request_withdrawal(bigint,text,text,text)'::regprocedure)) = 0 then raise exception '0119 batal: auto-approve merchant belum ditambal'; end if;
  if not exists (select 1 from app_setting_specs() where key = 'payout_min_amount') then raise exception '0119 batal: app_setting_specs belum memuat payout_min_amount'; end if;
  if (select count(*) from bank_codes) < 11 then raise exception '0119 batal: bank_codes belum lengkap'; end if;
  if to_regclass('cron.job') is not null then
    execute $q$select exists (select 1 from cron.job where jobname = 'antarkita_payout_batch_auto')$q$ into v_cron;
  end if;
  raise notice '0119 ok: cutoffs=%, cron=%', payout_cutoffs(), v_cron;
end $$;
