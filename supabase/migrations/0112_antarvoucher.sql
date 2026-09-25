-- =====================================================================
-- 0112 AntarVoucher — AntarPay berganti nama menjadi AntarVoucher (saldo tertutup)
--                    + pembelian voucher via transfer ke rekening resmi badan usaha
--                    + ledger saldo lengkap (saldo awal/akhir, idempotensi, maker/checker)
--                    + rekonsiliasi per pemilik saldo
-- Tanggal: 25 Sep 2026 · branch antarvoucher-v4 · dasar: finpay-v3 (0105–0111)
--
-- PRINSIP KOMPATIBILITAS (aplikasi versi lama tetap jalan):
--   • Nama objek DB lama DIPERTAHANKAN: wallets, wallet_transactions, topup_requests, antarpay_enabled(),
--     admin_set_antarpay_enabled(), kunci saluran 'antarpay', paid_via 'wallet'. Tidak ada tabel/kolom yang
--     di-rename atau di-drop → saldo & riwayat lama utuh, API lama tidak rusak.
--   • Nama baru (kanonik) ditambahkan: antarvoucher_enabled(), admin_set_antarvoucher_enabled(), voucher_*.
--   • Label yang tampil ke pengguna dari server diganti "AntarVoucher".
--
-- KEAMANAN UANG:
--   • Voucher HANYA terbit setelah dana dicocokkan dengan MUTASI BANK yang diinput Finance (atau integrasi resmi)
--     dan disetujui admin LAIN (maker ≠ checker). Screenshot/bukti transfer TIDAK pernah menambah saldo.
--   • Rekening tujuan hanya tampil bila: bukan placeholder, atas nama badan usaha resmi (app_settings
--     voucher_legal_entity_name), diverifikasi Finance DAN Legal, aktif.
--   • Fitur pembelian di balik feature flag antarvoucher_purchase_enabled (default FALSE).
--   • Setiap mutasi saldo: saldo awal, saldo akhir, idempotency key, referensi bank, pembuat & approver,
--     alasan koreksi, referensi refund/settlement; ledger append-only (hanya kolom pg_fee boleh diperbarui).
--   • Saldo pelanggan tidak boleh minus oleh transaksi yang ia mulai sendiri / penyesuaian / penarikan.
--   • Batas dana float (voucher_float_cap, default Rp900.000.000 < ambang izin PJP Rp1 miliar PADG 32/2025
--     Pasal 21 — [PERLU VERIFIKASI LEGAL]).
--
-- Rollback: supabase/rollback/0112_down.sql (data transaksi voucher ikut terhapus — hanya sebelum go-live).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Cadangan fungsi yang diubah/ditambah (untuk rollback _mig_restore('0112'))
-- ---------------------------------------------------------------------
do $$
declare s text;
begin
  foreach s in array array[
    'public.payment_channel_label(text)', 'public.antarpay_require_enabled()', 'public.admin_review_topup(uuid,boolean,text)',
    'public.antarvoucher_enabled()', 'public.admin_set_antarvoucher_enabled(boolean)',
    'public.wallet_tx_before_insert()', 'public.wallet_tx_append_only()', 'public.wallet_is_partner(uuid)',
    'public.voucher_setting_bigint(text,bigint)', 'public.voucher_bank_account_public_ok(public.company_bank_accounts)',
    'public.voucher_bank_accounts_public()', 'public.voucher_purchase_create(bigint,text,text)',
    'public.voucher_purchase_mark_sent(uuid,text,text)', 'public.voucher_purchase_cancel(uuid)',
    'public.voucher_purchase_dispute(uuid,text)', 'public.my_voucher_purchases()',
    'public.admin_voucher_bank_upsert(jsonb)', 'public.admin_voucher_bank_verify(uuid,text)', 'public.admin_voucher_bank_list()',
    'public.admin_voucher_mutation_add(uuid,text,bigint,timestamptz,text,text)', 'public.admin_voucher_match(uuid,uuid,text)',
    'public.admin_voucher_approve(uuid,text)', 'public.admin_voucher_reject(uuid,text)',
    'public.admin_voucher_mutation_refund(uuid,text)', 'public.admin_voucher_mutation_refund_done(uuid,text)',
    'public.admin_voucher_refund_request(uuid,text)', 'public.admin_voucher_refund_execute(uuid)',
    'public.admin_voucher_queue(text)', 'public.admin_topup_convert_to_voucher(uuid)',
    'public.voucher_expire_due()', 'public.wallet_statement(uuid,date,date)', 'public.admin_wallet_reconcile(date,date)',
    'public.admin_set_antarvoucher_purchase_enabled(boolean)', 'public.voucher_status_public()'] loop
    perform _mig_backup('0112', s);
  end loop;
end $$;

-- cadangan nilai app_settings yang diubah migrasi ini (dipulihkan 0112_down)
create table if not exists public._migration_backup_settings (
  version text not null, key text not null, value jsonb, saved_at timestamptz not null default now(),
  primary key (version, key));
alter table public._migration_backup_settings enable row level security;
revoke all on public._migration_backup_settings from public, anon, authenticated;
insert into public._migration_backup_settings (version, key, value)
select '0112', key, value from app_settings where key = 'bank_account'
on conflict (version, key) do nothing;

-- ---------------------------------------------------------------------
-- 1. Setelan (feature flag & parameter) — semua default AMAN
-- ---------------------------------------------------------------------
insert into app_settings (key, value) values
  ('antarvoucher_purchase_enabled', 'false'::jsonb),              -- pembelian voucher via transfer (flag terpisah dari antarpay_enabled)
  ('voucher_purchase_ttl_hours', '24'::jsonb),                    -- batas waktu transfer
  ('voucher_purchase_min', '20000'::jsonb),
  ('voucher_purchase_max', '2000000'::jsonb),
  ('voucher_max_open_per_user', '2'::jsonb),
  ('voucher_float_cap', '900000000'::jsonb),                      -- < Rp1 miliar (PADG 32/2025 Ps. 21) [PERLU VERIFIKASI LEGAL]
  ('voucher_legal_entity_name', '"PT Antar Kita Indonesia"'::jsonb), -- [PERLU KONFIRMASI: nama badan usaha persis sesuai akta]
  ('legacy_topup_manual_approval', 'false'::jsonb)                -- false = top up lama TIDAK bisa disetujui tanpa pencocokan mutasi bank
on conflict (key) do nothing;

-- rekening lama di app_settings.bank_account dibaca langsung oleh APK versi lama (layar Top Up) →
-- dinetralkan agar tidak ada lagi instruksi transfer ke rekening yang bukan rekening badan usaha terverifikasi.
update app_settings set value = jsonb_build_object(
    'bank', 'Belum tersedia', 'number', '-', 'name', 'Rekening resmi PT belum terverifikasi — perbarui aplikasi',
    'note', '0112: diganti oleh company_bank_accounts (AntarVoucher)'), updated_at = now()
 where key = 'bank_account';

create or replace function public.voucher_setting_bigint(p_key text, p_default bigint)
returns bigint language sql stable security definer set search_path = public as $$
  select coalesce((select nullif(value #>> '{}', '')::bigint from app_settings where key = p_key), p_default);
$$;
revoke all on function public.voucher_setting_bigint(text, bigint) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Nama baru AntarVoucher (kanonik) — nama lama tetap sebagai alias
-- ---------------------------------------------------------------------
create or replace function public.antarvoucher_enabled()
returns boolean language sql stable security definer set search_path = public as $$
  select antarpay_enabled();
$$;
grant execute on function public.antarvoucher_enabled() to anon, authenticated;
comment on function public.antarvoucher_enabled() is 'AntarVoucher (0112) — nama kanonik; membaca app_settings.antarpay_enabled (kunci lama dipertahankan demi APK lama).';

create or replace function public.admin_set_antarvoucher_enabled(p_enabled boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  perform admin_require('payment_config');   -- RBAC 0107
  r := admin_set_antarpay_enabled(p_enabled);
  return jsonb_build_object('antarvoucher_enabled', antarvoucher_enabled(), 'antarpay_enabled', r->'antarpay_enabled');
end $$;
revoke all on function public.admin_set_antarvoucher_enabled(boolean) from public, anon;
grant execute on function public.admin_set_antarvoucher_enabled(boolean) to authenticated;

create or replace function public.admin_set_antarvoucher_purchase_enabled(p_enabled boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform admin_require('payment_config');
  perform admin_require_unlock();
  if p_enabled is null then raise exception 'Nilai sakelar wajib diisi'; end if;
  if p_enabled and not exists (select 1 from company_bank_accounts b where voucher_bank_account_public_ok(b)) then
    raise exception 'VOUCHER_BANK_NOT_READY: belum ada rekening badan usaha yang diverifikasi Finance & Legal';
  end if;
  insert into app_settings (key, value) values ('antarvoucher_purchase_enabled', to_jsonb(p_enabled))
  on conflict (key) do update set value = excluded.value, updated_at = now();
  perform log_activity('antarvoucher.purchase_toggle', 'app_settings', 'antarvoucher_purchase_enabled',
    'Pembelian AntarVoucher ' || case when p_enabled then 'DIAKTIFKAN' else 'DINONAKTIFKAN' end, jsonb_build_object('enabled', p_enabled));
  return jsonb_build_object('antarvoucher_purchase_enabled', p_enabled);
end $$;
revoke all on function public.admin_set_antarvoucher_purchase_enabled(boolean) from public, anon;
grant execute on function public.admin_set_antarvoucher_purchase_enabled(boolean) to authenticated;

create or replace function public.payment_channel_label(p_key text)
returns text language sql immutable set search_path = public as $$
  select case lower(trim(coalesce(p_key, '')))
    when 'cash' then 'Tunai/COD'
    when 'antarpay' then 'AntarVoucher (saldo)'
    when 'antarvoucher' then 'AntarVoucher (saldo)'
    when 'emoney_nfc' then 'E-money (kartu NFC)'
    when 'gopay' then 'GoPay'
    when 'shopeepay' then 'ShopeePay'
    when 'qris' then 'QRIS'
    when 'ovo' then 'OVO'
    when 'dana' then 'DANA'
    when 'bank_transfer' then 'Transfer bank (VA)'
    when 'card' then 'Kartu kredit/debit'
    else coalesce(nullif(trim(coalesce(p_key, '')), ''), 'ini')
  end;
$$;
grant execute on function public.payment_channel_label(text) to anon, authenticated;

create or replace function public.antarpay_require_enabled()
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not antarpay_enabled() then
    raise exception 'AntarVoucher sedang dinonaktifkan sementara. Gunakan pembayaran tunai.';
  end if;
end $$;
grant execute on function public.antarpay_require_enabled() to anon, authenticated;

-- 2b. Rebrand pesan server: setiap fungsi public yang memuat teks "AntarPay" (pesan galat/catatan mutasi yang
--     terlihat pengguna) ditulis ulang menjadi "AntarVoucher". Hanya literal ber-huruf kapital "AntarPay" yang diganti
--     (identifier SQL seperti antarpay_enabled huruf kecil → tidak tersentuh). Definisi asli dicadangkan untuk rollback.
do $$
declare r record; n int := 0;
begin
  for r in select p.oid, p.oid::regprocedure::text as sig from pg_proc p
            where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.prosrc like '%AntarPay%'
              and p.proname not like '\_%' loop
    perform _mig_backup('0112', 'public.' || regexp_replace(r.sig, '^public\.', ''));
    execute replace(pg_get_functiondef(r.oid), 'AntarPay', 'AntarVoucher');
    n := n + 1;
  end loop;
  raise notice '0112: % fungsi di-rebrand AntarPay → AntarVoucher', n;
end $$;

-- ---------------------------------------------------------------------
-- 3. Ledger saldo: kolom audit lengkap + append-only + larangan saldo minus pelanggan
-- ---------------------------------------------------------------------
alter table public.wallet_transactions
  add column if not exists balance_before bigint,
  add column if not exists idempotency_key text,
  add column if not exists bank_ref text,
  add column if not exists created_by uuid,
  add column if not exists approved_by uuid,
  add column if not exists correction_reason text,
  add column if not exists refund_ref text,
  add column if not exists settlement_ref text,
  add column if not exists source text,
  add column if not exists status text not null default 'posted',
  add column if not exists seq bigint generated by default as identity;   -- urutan pasti (created_at sama dalam satu transaksi)
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'wallet_transactions_status_check') then
    alter table public.wallet_transactions add constraint wallet_transactions_status_check check (status in ('posted', 'reversed'));
  end if;
end $$;
-- isi balik riwayat lama (sebelum trigger append-only dipasang)
update public.wallet_transactions set balance_before = balance_after - amount where balance_before is null;
update public.wallet_transactions set source = case type::text
    when 'topup' then 'topup' when 'payment' then 'order_payment' when 'earning' then 'earning' when 'refund' then 'refund_in'
    when 'withdrawal' then 'payout' when 'fee' then 'fee' else 'adjustment' end
  where source is null;
create unique index if not exists wallet_transactions_idem_uidx on public.wallet_transactions (idempotency_key) where idempotency_key is not null;
create index if not exists wallet_transactions_bank_ref_idx on public.wallet_transactions (bank_ref) where bank_ref is not null;
comment on column public.wallet_transactions.balance_before is '0112: saldo sebelum mutasi (= balance_after − amount, diisi trigger).';
comment on column public.wallet_transactions.idempotency_key is '0112: kunci idempoten unik (mis. voucher:<id>) — mencegah kredit ganda.';

create or replace function public.wallet_is_partner(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from drivers where id = p_user)
      or exists (select 1 from merchants where owner_id = p_user)
      or (to_regclass('public.travel_partners') is not null and exists (select 1 from profiles where id = p_user and role::text in ('driver', 'merchant')));
$$;
revoke all on function public.wallet_is_partner(uuid) from public, anon, authenticated;

create or replace function public.wallet_tx_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.balance_before := new.balance_after - new.amount;
  new.created_by := coalesce(new.created_by, auth.uid());
  new.source := coalesce(new.source, case new.type::text
    when 'topup' then 'topup' when 'payment' then 'order_payment' when 'earning' then 'earning' when 'refund' then 'refund_in'
    when 'withdrawal' then 'payout' when 'fee' then 'fee' else 'adjustment' end);
  -- saldo pelanggan (bukan mitra) tidak boleh minus oleh transaksi yang ia mulai sendiri, penyesuaian, atau penarikan
  if new.amount < 0 and new.balance_after < 0 and not wallet_is_partner(new.user_id)
     and (new.user_id = auth.uid() or new.type::text in ('adjustment', 'withdrawal')) then
    raise exception 'SALDO_TIDAK_CUKUP: saldo AntarVoucher tidak cukup (saldo %, dibutuhkan %)', new.balance_before, -new.amount;
  end if;
  if new.type::text = 'adjustment' and coalesce(new.correction_reason, '') = '' then
    new.correction_reason := coalesce(nullif(new.note, ''), 'Penyesuaian (tanpa alasan tertulis — data lama)');
  end if;
  return new;
end $$;
drop trigger if exists t_wallet_tx_before_insert on public.wallet_transactions;
create trigger t_wallet_tx_before_insert before insert on public.wallet_transactions
  for each row execute function public.wallet_tx_before_insert();

create or replace function public.wallet_tx_append_only()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('antarkita.ledger_maintenance', true), '') = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'LEDGER_APPEND_ONLY: mutasi saldo tidak boleh dihapus — buat baris koreksi (adjustment) beralasan';
  end if;
  -- satu-satunya kolom yang boleh diperbarui: pg_fee (biaya PG yang ditanggung platform, diisi webhook 0100/0105)
  if (new.id, new.user_id, new.type, new.amount, new.balance_after, new.balance_before, new.order_id, new.ref, new.note, new.created_at,
      new.idempotency_key, new.bank_ref, new.created_by, new.approved_by, new.correction_reason, new.refund_ref, new.settlement_ref, new.source)
     is distinct from
     (old.id, old.user_id, old.type, old.amount, old.balance_after, old.balance_before, old.order_id, old.ref, old.note, old.created_at,
      old.idempotency_key, old.bank_ref, old.created_by, old.approved_by, old.correction_reason, old.refund_ref, old.settlement_ref, old.source) then
    raise exception 'LEDGER_APPEND_ONLY: mutasi saldo tidak boleh diubah — buat baris koreksi (adjustment) beralasan';
  end if;
  return new;
end $$;
drop trigger if exists t_wallet_tx_append_only on public.wallet_transactions;
create trigger t_wallet_tx_append_only before update or delete on public.wallet_transactions
  for each row execute function public.wallet_tx_append_only();

-- ---------------------------------------------------------------------
-- 4. Rekening resmi badan usaha (Himbara) — placeholder sampai diverifikasi Finance & Legal
-- ---------------------------------------------------------------------
create table if not exists public.company_bank_accounts (
  id                 uuid primary key default gen_random_uuid(),
  bank_code          text not null check (bank_code in ('bri', 'bni', 'mandiri', 'btn', 'bsi')),
  bank_name          text not null,
  account_no         text,                         -- NULL = placeholder (JANGAN mengarang nomor)
  account_name       text,
  is_placeholder     boolean not null default true,
  active             boolean not null default false,
  display_order      int not null default 0,
  finance_verified_by uuid references public.profiles(id),
  finance_verified_at timestamptz,
  legal_verified_by  uuid references public.profiles(id),
  legal_verified_at  timestamptz,
  note               text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (bank_code, account_no)
);
comment on table public.company_bank_accounts is 'AntarVoucher 0112: rekening resmi PT untuk pembelian voucher. Tampil ke pengguna hanya bila voucher_bank_account_public_ok(). Ditulis hanya lewat RPC admin.';
alter table public.company_bank_accounts enable row level security;
revoke all on public.company_bank_accounts from public, anon, authenticated;
grant all on public.company_bank_accounts to service_role;

insert into public.company_bank_accounts (bank_code, bank_name, display_order, note)
select v.code, v.name, v.ord, 'PLACEHOLDER — isi nomor & nama rekening resmi PT setelah dibuka; wajib verifikasi Finance + Legal'
from (values ('bri', 'Bank Rakyat Indonesia (BRI)', 1), ('bni', 'Bank Negara Indonesia (BNI)', 2), ('mandiri', 'Bank Mandiri', 3),
             ('btn', 'Bank Tabungan Negara (BTN)', 4), ('bsi', 'Bank Syariah Indonesia (BSI)', 5)) v(code, name, ord)
where not exists (select 1 from public.company_bank_accounts b where b.bank_code = v.code);

create or replace function public.voucher_bank_account_public_ok(b public.company_bank_accounts)
returns boolean language sql stable security definer set search_path = public as $$
  select b.active and not b.is_placeholder and coalesce(b.account_no, '') ~ '^[0-9]{8,20}$'
     and b.finance_verified_at is not null and b.legal_verified_at is not null
     and b.finance_verified_by is distinct from b.legal_verified_by
     and lower(trim(coalesce(b.account_name, ''))) = lower(trim(coalesce((select value #>> '{}' from app_settings where key = 'voucher_legal_entity_name'), '#')));
$$;
revoke all on function public.voucher_bank_account_public_ok(public.company_bank_accounts) from public, anon, authenticated;

create or replace function public.voucher_bank_accounts_public()
returns table (bank_code text, bank_name text, account_no text, account_name text)
language sql stable security definer set search_path = public as $$
  select b.bank_code, b.bank_name, b.account_no, b.account_name from company_bank_accounts b
   where voucher_bank_account_public_ok(b) order by b.display_order;
$$;
revoke all on function public.voucher_bank_accounts_public() from public, anon;
grant execute on function public.voucher_bank_accounts_public() to authenticated;

create or replace function public.voucher_status_public()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'brand', 'AntarVoucher',
    'enabled', antarvoucher_enabled(),
    'purchase_enabled', antarvoucher_enabled() and coalesce((select lower(value #>> '{}') = 'true' from app_settings where key = 'antarvoucher_purchase_enabled'), false)
                        and exists (select 1 from company_bank_accounts b where voucher_bank_account_public_ok(b)),
    'banks_ready', (select count(*) from company_bank_accounts b where voucher_bank_account_public_ok(b)),
    'min', voucher_setting_bigint('voucher_purchase_min', 20000), 'max', voucher_setting_bigint('voucher_purchase_max', 2000000),
    'ttl_hours', voucher_setting_bigint('voucher_purchase_ttl_hours', 24));
$$;
grant execute on function public.voucher_status_public() to anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. Pembelian voucher & mutasi bank
-- ---------------------------------------------------------------------
create table if not exists public.voucher_purchases (
  id               uuid primary key default gen_random_uuid(),
  reference        text not null unique,              -- AKV-YYMMDD-XXXXXX (berita transfer)
  user_id          uuid not null references public.profiles(id),
  bank_account_id  uuid not null references public.company_bank_accounts(id),
  nominal          bigint not null check (nominal > 0),
  unique_code      int not null check (unique_code between 0 and 999),
  transfer_amount  bigint not null,                   -- nominal + kode unik (yang harus ditransfer)
  status           text not null default 'awaiting_transfer' check (status in (
                     'awaiting_transfer', 'submitted', 'matched', 'amount_mismatch', 'issued', 'expired', 'cancelled',
                     'rejected', 'refund_requested', 'refund_pending', 'refunded', 'disputed')),
  expires_at       timestamptz not null,
  idempotency_key  text,
  sender_name      text,
  sender_bank      text,
  submitted_at     timestamptz,
  mutation_id      uuid,
  received_amount  bigint,
  matched_by       uuid references public.profiles(id),
  matched_at       timestamptz,
  approved_by      uuid references public.profiles(id),
  approved_at      timestamptz,
  issued_amount    bigint,
  wallet_tx_id     uuid,
  refund_requested_by uuid references public.profiles(id),
  refund_amount    bigint,
  refund_bank_ref  text,
  reason           text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (transfer_amount = nominal + unique_code),
  check (approved_by is null or matched_by is null or approved_by <> matched_by)
);
create unique index if not exists voucher_purchases_idem_uidx on public.voucher_purchases (user_id, idempotency_key) where idempotency_key is not null;
create index if not exists voucher_purchases_status_idx on public.voucher_purchases (status, created_at desc);
create index if not exists voucher_purchases_user_idx on public.voucher_purchases (user_id, created_at desc);
-- satu kode unik aktif per (rekening, jumlah transfer) → pencocokan otomatis tidak ambigu
create unique index if not exists voucher_purchases_open_amount_uidx on public.voucher_purchases (bank_account_id, transfer_amount)
  where status in ('awaiting_transfer', 'submitted');
comment on table public.voucher_purchases is 'AntarVoucher 0112: pesanan pembelian voucher via transfer. Voucher terbit hanya setelah mutasi bank dicocokkan + disetujui admin lain.';
alter table public.voucher_purchases enable row level security;
drop policy if exists voucher_purchases_own on public.voucher_purchases;
create policy voucher_purchases_own on public.voucher_purchases for select to authenticated using (user_id = auth.uid() or admin_has('payments_view'));
revoke all on public.voucher_purchases from public, anon, authenticated;
grant select on public.voucher_purchases to authenticated;
grant all on public.voucher_purchases to service_role;

create table if not exists public.voucher_bank_mutations (
  id               uuid primary key default gen_random_uuid(),
  bank_account_id  uuid not null references public.company_bank_accounts(id),
  bank_ref         text not null,                     -- nomor referensi mutasi rekening koran / integrasi bank
  amount           bigint not null check (amount > 0),
  trx_at           timestamptz not null,
  sender_name      text,
  raw_note         text,
  status           text not null default 'unmatched' check (status in ('unmatched', 'matched', 'refund_pending', 'refunded', 'ignored')),
  purchase_id      uuid references public.voucher_purchases(id),
  entered_by       uuid references public.profiles(id),
  refund_reason    text,
  refund_bank_ref  text,
  refunded_by      uuid references public.profiles(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (bank_account_id, bank_ref)                  -- mutasi yang sama tidak bisa dicatat dua kali (anti kredit ganda)
);
create unique index if not exists voucher_bank_mutations_purchase_uidx on public.voucher_bank_mutations (purchase_id) where purchase_id is not null and status = 'matched';
comment on table public.voucher_bank_mutations is 'AntarVoucher 0112: mutasi masuk rekening resmi (input Finance / integrasi). Unik per (rekening, bank_ref).';
alter table public.voucher_bank_mutations enable row level security;
drop policy if exists voucher_bank_mutations_admin on public.voucher_bank_mutations;
create policy voucher_bank_mutations_admin on public.voucher_bank_mutations for select to authenticated using (admin_has('payments_view'));
revoke all on public.voucher_bank_mutations from public, anon, authenticated;
grant select on public.voucher_bank_mutations to authenticated;
grant all on public.voucher_bank_mutations to service_role;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'voucher_purchases_mutation_fk') then
    alter table public.voucher_purchases add constraint voucher_purchases_mutation_fk foreign key (mutation_id) references public.voucher_bank_mutations(id);
  end if;
end $$;

-- ---------- Pengguna ----------
create or replace function public.voucher_purchase_create(p_nominal bigint, p_bank_code text, p_idempotency_key text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); b company_bank_accounts; v public.voucher_purchases; v_code int; v_try int := 0; v_ref text;
begin
  if v_uid is null then raise exception 'Harus login'; end if;
  perform antarpay_require_enabled();
  if not coalesce((select (voucher_status_public()->>'purchase_enabled')::boolean), false) then
    raise exception 'VOUCHER_PURCHASE_DISABLED: pembelian AntarVoucher belum dibuka';
  end if;
  if p_nominal is null or p_nominal < voucher_setting_bigint('voucher_purchase_min', 20000) or p_nominal > voucher_setting_bigint('voucher_purchase_max', 2000000) then
    raise exception 'VOUCHER_NOMINAL_INVALID: nominal harus Rp% – Rp%', voucher_setting_bigint('voucher_purchase_min', 20000), voucher_setting_bigint('voucher_purchase_max', 2000000);
  end if;
  if p_nominal % 1000 <> 0 then raise exception 'VOUCHER_NOMINAL_INVALID: nominal harus kelipatan Rp1.000'; end if;
  if p_idempotency_key is not null then
    select * into v from voucher_purchases where user_id = v_uid and idempotency_key = p_idempotency_key;
    if found then return to_jsonb(v) || jsonb_build_object('idempotent', true); end if;
  end if;
  select * into b from company_bank_accounts where bank_code = lower(trim(p_bank_code)) and voucher_bank_account_public_ok(company_bank_accounts)
   order by display_order limit 1;
  if not found then raise exception 'VOUCHER_BANK_NOT_READY: rekening % belum tersedia', coalesce(p_bank_code, '-'); end if;
  if (select count(*) from voucher_purchases where user_id = v_uid and status in ('awaiting_transfer', 'submitted', 'matched', 'amount_mismatch'))
       >= voucher_setting_bigint('voucher_max_open_per_user', 2) then
    raise exception 'VOUCHER_TOO_MANY_OPEN: selesaikan atau batalkan pembelian yang masih berjalan';
  end if;
  loop
    v_try := v_try + 1;
    v_code := 1 + floor(random() * 999)::int;
    v_ref := 'AKV-' || to_char(now() at time zone 'Asia/Jakarta', 'YYMMDD') || '-' || upper(substr(md5(gen_random_uuid()::text), 1, 6));
    begin
      insert into voucher_purchases (reference, user_id, bank_account_id, nominal, unique_code, transfer_amount, expires_at, idempotency_key)
      values (v_ref, v_uid, b.id, p_nominal, v_code, p_nominal + v_code,
              now() + make_interval(hours => voucher_setting_bigint('voucher_purchase_ttl_hours', 24)::int), p_idempotency_key)
      returning * into v;
      exit;
    exception when unique_violation then
      if v_try >= 25 then raise exception 'VOUCHER_BUSY: coba lagi sebentar'; end if;
    end;
  end loop;
  perform log_activity('voucher.purchase_create', 'voucher_purchases', v.id::text, 'Pembelian AntarVoucher ' || v.reference, jsonb_build_object('nominal', v.nominal, 'transfer', v.transfer_amount));
  return to_jsonb(v) || jsonb_build_object('bank_name', b.bank_name, 'account_no', b.account_no, 'account_name', b.account_name, 'idempotent', false);
end $$;
revoke all on function public.voucher_purchase_create(bigint, text, text) from public, anon;
grant execute on function public.voucher_purchase_create(bigint, text, text) to authenticated;

create or replace function public.voucher_purchase_mark_sent(p_id uuid, p_sender_name text default null, p_sender_bank text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v voucher_purchases;
begin
  -- HANYA informasi bantu pencocokan; TIDAK menambah saldo.
  update voucher_purchases set status = 'submitted', submitted_at = now(), sender_name = left(nullif(trim(p_sender_name), ''), 80),
         sender_bank = left(nullif(trim(p_sender_bank), ''), 40), updated_at = now()
   where id = p_id and user_id = auth.uid() and status in ('awaiting_transfer', 'submitted') and expires_at > now()
  returning * into v;
  if not found then raise exception 'VOUCHER_STATE: pembelian tidak ditemukan, sudah diproses, atau kedaluwarsa'; end if;
  return to_jsonb(v);
end $$;
revoke all on function public.voucher_purchase_mark_sent(uuid, text, text) from public, anon;
grant execute on function public.voucher_purchase_mark_sent(uuid, text, text) to authenticated;

create or replace function public.voucher_purchase_cancel(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v voucher_purchases;
begin
  update voucher_purchases set status = 'cancelled', updated_at = now(), reason = 'Dibatalkan pengguna'
   where id = p_id and user_id = auth.uid() and status = 'awaiting_transfer'
  returning * into v;
  if not found then raise exception 'VOUCHER_STATE: hanya pembelian yang belum ditransfer yang bisa dibatalkan (bila sudah transfer, gunakan "Laporkan masalah")'; end if;
  return to_jsonb(v);
end $$;
revoke all on function public.voucher_purchase_cancel(uuid) from public, anon;
grant execute on function public.voucher_purchase_cancel(uuid) to authenticated;

create or replace function public.voucher_purchase_dispute(p_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v voucher_purchases;
begin
  if length(trim(coalesce(p_reason, ''))) < 10 then raise exception 'Jelaskan masalah minimal 10 karakter'; end if;
  update voucher_purchases set status = 'disputed', reason = left(trim(p_reason), 500), updated_at = now()
   where id = p_id and user_id = auth.uid() and status in ('awaiting_transfer', 'submitted', 'expired', 'amount_mismatch', 'rejected', 'cancelled')
  returning * into v;
  if not found then raise exception 'VOUCHER_STATE: pembelian tidak ditemukan atau sudah selesai'; end if;
  perform log_activity('voucher.dispute', 'voucher_purchases', v.id::text, 'Sengketa pembelian ' || v.reference, jsonb_build_object('reason', v.reason));
  return to_jsonb(v);
end $$;
revoke all on function public.voucher_purchase_dispute(uuid, text) from public, anon;
grant execute on function public.voucher_purchase_dispute(uuid, text) to authenticated;

create or replace function public.my_voucher_purchases()
returns setof jsonb language sql stable security definer set search_path = public as $$
  select to_jsonb(v) || jsonb_build_object('bank_name', b.bank_name,
           'account_no', case when voucher_bank_account_public_ok(b) then b.account_no end,
           'account_name', case when voucher_bank_account_public_ok(b) then b.account_name end)
    from voucher_purchases v join company_bank_accounts b on b.id = v.bank_account_id
   where v.user_id = auth.uid() order by v.created_at desc limit 50;
$$;
revoke all on function public.my_voucher_purchases() from public, anon;
grant execute on function public.my_voucher_purchases() to authenticated;

-- ---------- Admin: rekening ----------
create or replace function public.admin_voucher_bank_upsert(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b company_bank_accounts; v_no text := nullif(regexp_replace(coalesce(p->>'account_no', ''), '\D', '', 'g'), '');
begin
  perform admin_require('payment_config');
  perform admin_require_unlock();
  if (p->>'id') is not null then
    select * into b from company_bank_accounts where id = (p->>'id')::uuid for update;
    if not found then raise exception 'Rekening tidak ditemukan'; end if;
  end if;
  if v_no is not null and v_no !~ '^[0-9]{8,20}$' then raise exception 'Nomor rekening harus 8–20 digit angka'; end if;
  if b.id is null then
    insert into company_bank_accounts (bank_code, bank_name, account_no, account_name, is_placeholder, active, display_order, note)
    values (lower(p->>'bank_code'), p->>'bank_name', v_no, nullif(trim(p->>'account_name'), ''), v_no is null, false,
            coalesce((p->>'display_order')::int, 9), p->>'note') returning * into b;
  else
    -- mengubah nomor/nama MEMBATALKAN verifikasi (harus diverifikasi ulang Finance & Legal)
    update company_bank_accounts set
      account_no = coalesce(v_no, account_no),
      account_name = coalesce(nullif(trim(p->>'account_name'), ''), account_name),
      is_placeholder = coalesce(v_no, account_no) is null,
      active = coalesce((p->>'active')::boolean, active),
      display_order = coalesce((p->>'display_order')::int, display_order),
      note = coalesce(p->>'note', note),
      finance_verified_by = case when coalesce(v_no, account_no) is distinct from account_no or coalesce(nullif(trim(p->>'account_name'), ''), account_name) is distinct from account_name then null else finance_verified_by end,
      finance_verified_at = case when coalesce(v_no, account_no) is distinct from account_no or coalesce(nullif(trim(p->>'account_name'), ''), account_name) is distinct from account_name then null else finance_verified_at end,
      legal_verified_by   = case when coalesce(v_no, account_no) is distinct from account_no or coalesce(nullif(trim(p->>'account_name'), ''), account_name) is distinct from account_name then null else legal_verified_by end,
      legal_verified_at   = case when coalesce(v_no, account_no) is distinct from account_no or coalesce(nullif(trim(p->>'account_name'), ''), account_name) is distinct from account_name then null else legal_verified_at end,
      updated_at = now()
    where id = b.id returning * into b;
  end if;
  perform log_activity('voucher.bank_upsert', 'company_bank_accounts', b.id::text, 'Rekening ' || b.bank_name || ' diperbarui',
    jsonb_build_object('account_no_masked', case when b.account_no is null then null else left(b.account_no, 3) || '****' || right(b.account_no, 3) end, 'active', b.active));
  return jsonb_build_object('id', b.id, 'public_ok', voucher_bank_account_public_ok(b));
end $$;
revoke all on function public.admin_voucher_bank_upsert(jsonb) from public, anon;
grant execute on function public.admin_voucher_bank_upsert(jsonb) to authenticated;

create or replace function public.admin_voucher_bank_verify(p_id uuid, p_as text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b company_bank_accounts;
begin
  perform admin_require('reconcile');
  perform admin_require_unlock();
  select * into b from company_bank_accounts where id = p_id for update;
  if not found then raise exception 'Rekening tidak ditemukan'; end if;
  if b.is_placeholder or b.account_no is null then raise exception 'Rekening masih placeholder — isi nomor rekening resmi dulu'; end if;
  if p_as = 'finance' then
    update company_bank_accounts set finance_verified_by = auth.uid(), finance_verified_at = now(), updated_at = now() where id = p_id returning * into b;
  elsif p_as = 'legal' then
    if b.finance_verified_by = auth.uid() then raise exception 'MAKER_CHECKER: verifikasi Legal harus oleh admin lain dari verifikator Finance'; end if;
    update company_bank_accounts set legal_verified_by = auth.uid(), legal_verified_at = now(), updated_at = now() where id = p_id returning * into b;
  else raise exception 'p_as harus finance atau legal'; end if;
  perform log_activity('voucher.bank_verify', 'company_bank_accounts', b.id::text, 'Verifikasi ' || p_as || ' rekening ' || b.bank_name, null);
  return jsonb_build_object('id', b.id, 'public_ok', voucher_bank_account_public_ok(b));
end $$;
revoke all on function public.admin_voucher_bank_verify(uuid, text) from public, anon;
grant execute on function public.admin_voucher_bank_verify(uuid, text) to authenticated;

create or replace function public.admin_voucher_bank_list()
returns setof jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform admin_require('payments_view');
  return query select to_jsonb(b) || jsonb_build_object('public_ok', voucher_bank_account_public_ok(b)) from company_bank_accounts b order by b.display_order;
end $$;
revoke all on function public.admin_voucher_bank_list() from public, anon;
grant execute on function public.admin_voucher_bank_list() to authenticated;

-- ---------- Admin: mutasi & pencocokan ----------
create or replace function public.admin_voucher_mutation_add(p_bank_account uuid, p_bank_ref text, p_amount bigint, p_trx_at timestamptz,
                                                             p_sender_name text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare m voucher_bank_mutations; v voucher_purchases; n int;
begin
  perform admin_require('reconcile');
  perform admin_require_unlock();
  if nullif(trim(coalesce(p_bank_ref, '')), '') is null then raise exception 'Referensi mutasi bank wajib diisi'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Nominal mutasi tidak valid'; end if;
  begin
    insert into voucher_bank_mutations (bank_account_id, bank_ref, amount, trx_at, sender_name, raw_note, entered_by)
    values (p_bank_account, trim(p_bank_ref), p_amount, coalesce(p_trx_at, now()), p_sender_name, p_note, auth.uid()) returning * into m;
  exception when unique_violation then
    raise exception 'MUTATION_DUPLICATE: mutasi % sudah pernah dicatat (anti kredit ganda)', p_bank_ref;
  end;
  -- pencocokan otomatis: jumlah persis (kode unik) di rekening yang sama, pembelian masih terbuka atau terlambat ≤ 7 hari
  select count(*) into n from voucher_purchases where bank_account_id = p_bank_account and transfer_amount = p_amount
     and (status in ('awaiting_transfer', 'submitted') or (status = 'expired' and expires_at > now() - interval '7 days'));
  if n = 1 then
    select * into v from voucher_purchases where bank_account_id = p_bank_account and transfer_amount = p_amount
       and (status in ('awaiting_transfer', 'submitted') or (status = 'expired' and expires_at > now() - interval '7 days')) for update;
    perform admin_voucher_match(v.id, m.id, 'otomatis: jumlah + kode unik cocok');
    select * into m from voucher_bank_mutations where id = m.id;
  end if;
  perform log_activity('voucher.mutation_add', 'voucher_bank_mutations', m.id::text, 'Mutasi ' || m.bank_ref || ' Rp' || m.amount,
    jsonb_build_object('auto_match_candidates', n, 'status', m.status));
  return to_jsonb(m) || jsonb_build_object('auto_match_candidates', n);
end $$;
revoke all on function public.admin_voucher_mutation_add(uuid, text, bigint, timestamptz, text, text) from public, anon;
grant execute on function public.admin_voucher_mutation_add(uuid, text, bigint, timestamptz, text, text) to authenticated;

create or replace function public.admin_voucher_match(p_purchase uuid, p_mutation uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v voucher_purchases; m voucher_bank_mutations; v_status text;
begin
  perform admin_require('reconcile');
  perform admin_require_unlock();
  select * into v from voucher_purchases where id = p_purchase for update;
  if not found then raise exception 'Pembelian tidak ditemukan'; end if;
  if v.status not in ('awaiting_transfer', 'submitted', 'expired', 'disputed') then raise exception 'VOUCHER_STATE: status % tidak bisa dicocokkan', v.status; end if;
  select * into m from voucher_bank_mutations where id = p_mutation for update;
  if not found or m.status <> 'unmatched' then raise exception 'MUTATION_STATE: mutasi tidak ada atau sudah dipakai'; end if;
  if m.bank_account_id <> v.bank_account_id then raise exception 'MUTATION_ACCOUNT: rekening mutasi berbeda dengan rekening tujuan pembelian'; end if;
  v_status := case when m.amount = v.transfer_amount then 'matched' else 'amount_mismatch' end;
  update voucher_purchases set status = v_status, mutation_id = m.id, received_amount = m.amount, matched_by = auth.uid(), matched_at = now(),
         reason = coalesce(p_note, reason), updated_at = now() where id = v.id returning * into v;
  update voucher_bank_mutations set status = 'matched', purchase_id = v.id, updated_at = now() where id = m.id;
  perform log_activity('voucher.match', 'voucher_purchases', v.id::text, 'Mutasi ' || m.bank_ref || ' → ' || v.reference || ' (' || v_status || ')',
    jsonb_build_object('expected', v.transfer_amount, 'received', m.amount));
  return to_jsonb(v);
end $$;
revoke all on function public.admin_voucher_match(uuid, uuid, text) from public, anon;
grant execute on function public.admin_voucher_match(uuid, uuid, text) to authenticated;

create or replace function public.admin_voucher_approve(p_purchase uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v voucher_purchases; m voucher_bank_mutations; v_bal bigint; v_tx uuid; v_float bigint;
begin
  perform admin_require('wallet_adjust');
  perform admin_require_unlock();
  select * into v from voucher_purchases where id = p_purchase for update;
  if not found then raise exception 'Pembelian tidak ditemukan'; end if;
  if v.status = 'issued' then return to_jsonb(v) || jsonb_build_object('idempotent', true); end if;
  if v.status not in ('matched', 'amount_mismatch') then raise exception 'VOUCHER_STATE: status % belum bisa diterbitkan (butuh mutasi bank tercocok)', v.status; end if;
  if v.matched_by = auth.uid() then raise exception 'MAKER_CHECKER: penerbit voucher harus admin lain dari pencocok mutasi'; end if;
  select * into m from voucher_bank_mutations where id = v.mutation_id;
  if not found or m.status <> 'matched' or m.purchase_id <> v.id then raise exception 'MUTATION_STATE: mutasi bank tidak valid'; end if;
  select coalesce(sum(balance), 0) into v_float from wallets w where balance > 0 and not wallet_is_partner(w.user_id);
  if v_float + m.amount > voucher_setting_bigint('voucher_float_cap', 900000000) then
    raise exception 'VOUCHER_FLOAT_CAP: total saldo voucher akan melampaui batas % (kajian izin PJP) — tahan penerbitan', voucher_setting_bigint('voucher_float_cap', 900000000);
  end if;
  -- terbitkan sebesar dana yang BENAR-BENAR diterima (termasuk kode unik)
  v_bal := wallet_apply(v.user_id, 'topup', m.amount, null, 'Pembelian AntarVoucher ' || v.reference, v.reference);
  select id into v_tx from wallet_transactions where user_id = v.user_id and ref = v.reference and type = 'topup' order by created_at desc limit 1;
  -- lengkapi baris ledger yang baru dibuat (append-only: gunakan jalur pemeliharaan terkendali untuk kolom audit baris baru ini)
  perform set_config('antarkita.ledger_maintenance', 'on', true);
  update wallet_transactions set idempotency_key = 'voucher:' || v.id, bank_ref = m.bank_ref, approved_by = auth.uid(), source = 'voucher_purchase'
   where id = v_tx;
  perform set_config('antarkita.ledger_maintenance', 'off', true);
  update voucher_purchases set status = 'issued', approved_by = auth.uid(), approved_at = now(), issued_amount = m.amount, wallet_tx_id = v_tx,
         reason = coalesce(p_note, reason), updated_at = now() where id = v.id returning * into v;
  perform log_activity('voucher.issue', 'voucher_purchases', v.id::text, 'AntarVoucher terbit ' || v.reference || ' Rp' || m.amount,
    jsonb_build_object('mutation', m.bank_ref, 'balance_after', v_bal));
  if to_regprocedure('public.notify_user(uuid,text,text,jsonb)') is not null then
    execute 'select notify_user($1, $2, $3, $4)' using v.user_id, 'AntarVoucher diterbitkan',
      'Pembelian ' || v.reference || ' terverifikasi. Saldo bertambah Rp' || m.amount || '.', jsonb_build_object('type', 'voucher', 'id', v.id);
  end if;
  return to_jsonb(v) || jsonb_build_object('balance_after', v_bal);
end $$;
revoke all on function public.admin_voucher_approve(uuid, text) from public, anon;
grant execute on function public.admin_voucher_approve(uuid, text) to authenticated;

create or replace function public.admin_voucher_reject(p_purchase uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v voucher_purchases;
begin
  perform admin_require('reconcile');
  perform admin_require_unlock();
  if length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'Alasan wajib diisi'; end if;
  select * into v from voucher_purchases where id = p_purchase for update;
  if not found then raise exception 'Pembelian tidak ditemukan'; end if;
  if v.status in ('issued', 'refunded', 'refund_pending', 'refund_requested') then raise exception 'VOUCHER_STATE: status % tidak bisa ditolak', v.status; end if;
  -- mutasi yang sudah tercocok dilepas → wajib dikembalikan (refund) oleh Finance
  if v.mutation_id is not null then
    update voucher_bank_mutations set status = 'refund_pending', refund_reason = 'Pembelian ditolak: ' || p_reason, purchase_id = v.id, updated_at = now()
     where id = v.mutation_id and status = 'matched';
  end if;
  update voucher_purchases set status = 'rejected', reason = p_reason, updated_at = now() where id = v.id returning * into v;
  perform log_activity('voucher.reject', 'voucher_purchases', v.id::text, 'Pembelian ditolak ' || v.reference, jsonb_build_object('reason', p_reason));
  return to_jsonb(v);
end $$;
revoke all on function public.admin_voucher_reject(uuid, text) from public, anon;
grant execute on function public.admin_voucher_reject(uuid, text) to authenticated;

-- mutasi tanpa pembelian (transfer ganda / salah nominal / tidak dikenal) → dikembalikan ke pengirim
create or replace function public.admin_voucher_mutation_refund(p_mutation uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare m voucher_bank_mutations;
begin
  perform admin_require('refund');
  perform admin_require_unlock();
  if length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'Alasan wajib diisi'; end if;
  update voucher_bank_mutations set status = 'refund_pending', refund_reason = p_reason, updated_at = now()
   where id = p_mutation and status = 'unmatched' returning * into m;
  if not found then raise exception 'MUTATION_STATE: hanya mutasi yang belum tercocok yang bisa dikembalikan'; end if;
  perform log_activity('voucher.mutation_refund', 'voucher_bank_mutations', m.id::text, 'Mutasi ' || m.bank_ref || ' dijadwalkan dikembalikan', jsonb_build_object('reason', p_reason));
  return to_jsonb(m);
end $$;
revoke all on function public.admin_voucher_mutation_refund(uuid, text) from public, anon;
grant execute on function public.admin_voucher_mutation_refund(uuid, text) to authenticated;

create or replace function public.admin_voucher_mutation_refund_done(p_mutation uuid, p_refund_bank_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare m voucher_bank_mutations;
begin
  perform admin_require('refund_execute');
  perform admin_require_unlock();
  if nullif(trim(coalesce(p_refund_bank_ref, '')), '') is null then raise exception 'Referensi transfer pengembalian wajib diisi'; end if;
  update voucher_bank_mutations set status = 'refunded', refund_bank_ref = trim(p_refund_bank_ref), refunded_by = auth.uid(), updated_at = now()
   where id = p_mutation and status = 'refund_pending' returning * into m;
  if not found then raise exception 'MUTATION_STATE: mutasi tidak dalam status refund_pending'; end if;
  update voucher_purchases set status = 'refunded', refund_amount = m.amount, refund_bank_ref = m.refund_bank_ref, updated_at = now()
   where id = m.purchase_id and status in ('rejected', 'refund_pending');
  perform log_activity('voucher.mutation_refunded', 'voucher_bank_mutations', m.id::text, 'Pengembalian dana mutasi ' || m.bank_ref || ' selesai', jsonb_build_object('refund_ref', m.refund_bank_ref));
  return to_jsonb(m);
end $$;
revoke all on function public.admin_voucher_mutation_refund_done(uuid, text) from public, anon;
grant execute on function public.admin_voucher_mutation_refund_done(uuid, text) to authenticated;

-- refund voucher yang SUDAH terbit (saldo belum terpakai) — maker (request) ≠ checker (execute)
create or replace function public.admin_voucher_refund_request(p_purchase uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v voucher_purchases;
begin
  perform admin_require('refund');
  perform admin_require_unlock();
  if length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'Alasan wajib diisi'; end if;
  update voucher_purchases set status = 'refund_requested', refund_requested_by = auth.uid(), reason = p_reason, updated_at = now()
   where id = p_purchase and status = 'issued' returning * into v;
  if not found then raise exception 'VOUCHER_STATE: hanya voucher terbit yang bisa diajukan refund'; end if;
  perform log_activity('voucher.refund_request', 'voucher_purchases', v.id::text, 'Pengajuan refund ' || v.reference, jsonb_build_object('reason', p_reason));
  return to_jsonb(v);
end $$;
revoke all on function public.admin_voucher_refund_request(uuid, text) from public, anon;
grant execute on function public.admin_voucher_refund_request(uuid, text) to authenticated;

create or replace function public.admin_voucher_refund_execute(p_purchase uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v voucher_purchases; v_bal bigint; v_amt bigint; v_tx uuid;
begin
  perform admin_require('refund_execute');
  perform admin_require_unlock();
  select * into v from voucher_purchases where id = p_purchase for update;
  if not found or v.status <> 'refund_requested' then raise exception 'VOUCHER_STATE: pembelian tidak dalam status refund_requested'; end if;
  if v.refund_requested_by = auth.uid() then raise exception 'MAKER_CHECKER: eksekusi refund harus admin lain dari pengaju'; end if;
  select coalesce(balance, 0) into v_bal from wallets where user_id = v.user_id for update;
  v_amt := least(coalesce(v_bal, 0), v.issued_amount);   -- hanya sisa yang belum terpakai
  if v_amt <= 0 then raise exception 'VOUCHER_REFUND_ZERO: saldo voucher sudah terpakai seluruhnya'; end if;
  perform wallet_apply(v.user_id, 'adjustment', -v_amt, null, 'Refund AntarVoucher ' || v.reference || ' ke rekening pengirim', 'RFV-' || v.reference);
  select id into v_tx from wallet_transactions where user_id = v.user_id and ref = 'RFV-' || v.reference order by created_at desc limit 1;
  perform set_config('antarkita.ledger_maintenance', 'on', true);
  update wallet_transactions set idempotency_key = 'voucher-refund:' || v.id, approved_by = auth.uid(), created_by = v.refund_requested_by,
         correction_reason = 'Refund voucher: ' || coalesce(v.reason, '-'), refund_ref = 'RFV-' || v.reference, source = 'voucher_refund' where id = v_tx;
  perform set_config('antarkita.ledger_maintenance', 'off', true);
  update voucher_purchases set status = 'refund_pending', refund_amount = v_amt, updated_at = now() where id = v.id returning * into v;
  if v.mutation_id is not null then
    update voucher_bank_mutations set status = 'refund_pending', refund_reason = 'Refund voucher terbit', updated_at = now() where id = v.mutation_id;
  end if;
  perform log_activity('voucher.refund_execute', 'voucher_purchases', v.id::text, 'Refund voucher ' || v.reference || ' Rp' || v_amt, null);
  return to_jsonb(v);
end $$;
revoke all on function public.admin_voucher_refund_execute(uuid) from public, anon;
grant execute on function public.admin_voucher_refund_execute(uuid) to authenticated;

create or replace function public.admin_voucher_queue(p_status text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform admin_require('payments_view');
  return jsonb_build_object(
    'purchases', coalesce((select jsonb_agg(to_jsonb(v) || jsonb_build_object('user_name', p.full_name, 'bank_name', b.bank_name) order by v.created_at desc)
        from (select * from voucher_purchases where p_status is null or status = p_status order by created_at desc limit 200) v
        join profiles p on p.id = v.user_id join company_bank_accounts b on b.id = v.bank_account_id), '[]'::jsonb),
    'mutations', coalesce((select jsonb_agg(to_jsonb(m) || jsonb_build_object('bank_name', b.bank_name) order by m.trx_at desc)
        from (select * from voucher_bank_mutations order by trx_at desc limit 200) m join company_bank_accounts b on b.id = m.bank_account_id), '[]'::jsonb),
    'summary', jsonb_build_object(
        'awaiting', (select count(*) from voucher_purchases where status in ('awaiting_transfer', 'submitted')),
        'to_approve', (select count(*) from voucher_purchases where status in ('matched', 'amount_mismatch')),
        'unmatched_mutations', (select count(*) from voucher_bank_mutations where status = 'unmatched'),
        'refund_pending', (select count(*) from voucher_bank_mutations where status = 'refund_pending'),
        'disputed', (select count(*) from voucher_purchases where status = 'disputed'),
        'float_customer', (select coalesce(sum(balance), 0) from wallets w where balance > 0 and not wallet_is_partner(w.user_id)),
        'float_cap', voucher_setting_bigint('voucher_float_cap', 900000000)));
end $$;
revoke all on function public.admin_voucher_queue(text) from public, anon;
grant execute on function public.admin_voucher_queue(text) to authenticated;

-- top up lama (topup_requests, bukti screenshot) → dikonversi ke pembelian voucher agar hanya bisa terbit lewat mutasi bank
create or replace function public.admin_topup_convert_to_voucher(p_topup uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t topup_requests; b company_bank_accounts; v voucher_purchases;
begin
  perform admin_require('reconcile');
  perform admin_require_unlock();
  select * into t from topup_requests where id = p_topup for update;
  if not found or t.status <> 'pending' then raise exception 'Top up tidak valid / sudah diproses'; end if;
  select * into b from company_bank_accounts x where voucher_bank_account_public_ok(x) order by display_order limit 1;
  if not found then raise exception 'VOUCHER_BANK_NOT_READY: belum ada rekening resmi terverifikasi'; end if;
  insert into voucher_purchases (reference, user_id, bank_account_id, nominal, unique_code, transfer_amount, status, expires_at, reason)
  values ('AKV-L-' || upper(substr(replace(t.id::text, '-', ''), 1, 10)), t.user_id, b.id, t.amount, 0, t.amount, 'submitted', now() + interval '7 days',
          'Konversi top up lama ' || t.id) returning * into v;
  update topup_requests set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(),
         review_note = 'Dipindahkan ke verifikasi AntarVoucher ' || v.reference || ' (saldo terbit setelah mutasi bank cocok)' where id = t.id;
  return to_jsonb(v);
end $$;
revoke all on function public.admin_topup_convert_to_voucher(uuid) from public, anon;
grant execute on function public.admin_topup_convert_to_voucher(uuid) to authenticated;

-- jalur lama admin_review_topup: persetujuan tanpa pencocokan mutasi DITOLAK (kecuali flag darurat legacy)
select _v3_splice('0112', 'public.admin_review_topup(uuid,boolean,text)',
  $a$  perform admin_require_unlock();           -- 0107: wajib PIN$a$,
  $a$  perform admin_require_unlock();           -- 0107: wajib PIN
  if p_approve and not coalesce((select lower(value #>> '{}') = 'true' from app_settings where key = 'legacy_topup_manual_approval'), false) then
    raise exception 'TOPUP_REQUIRE_BANK_MATCH: saldo tidak boleh ditambah berdasarkan bukti/screenshot. Gunakan Panel Admin → AntarVoucher (konversi + cocokkan mutasi bank).';   -- 0112 AntarVoucher
  end if;$a$,
  '0112 AntarVoucher');

-- ---------- Kedaluwarsa (cron) ----------
create or replace function public.voucher_expire_due()
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update voucher_purchases set status = 'expired', updated_at = now(), reason = coalesce(reason, 'Batas waktu transfer lewat')
   where status in ('awaiting_transfer', 'submitted') and expires_at <= now();
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.voucher_expire_due() from public, anon, authenticated;
grant execute on function public.voucher_expire_due() to service_role;
do $$
begin
  if to_regnamespace('cron') is not null and to_regproc('cron.schedule') is not null then
    perform cron.schedule('antarvoucher-expire', '*/15 * * * *', 'select public.voucher_expire_due()');
  end if;
exception when others then raise notice '0112: cron antarvoucher-expire tidak dijadwalkan (%)', sqlerrm;
end $$;

-- ---------------------------------------------------------------------
-- 6. Rekonsiliasi saldo per pemilik
--   saldo awal + pembelian + pendapatan + refund masuk − penggunaan − refund keluar − payout ± koreksi = saldo akhir
-- ---------------------------------------------------------------------
create or replace function public.wallet_statement(p_user uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_open bigint; v_close bigint; r record; v_calc bigint;
begin
  if p_user is distinct from auth.uid() and not admin_has('ledger') then raise exception 'Tidak berhak melihat mutasi ini'; end if;
  select coalesce((select balance_after from wallet_transactions where user_id = p_user and (created_at at time zone 'Asia/Jakarta')::date < p_from
                   order by created_at desc, seq desc limit 1), 0) into v_open;
  select
    coalesce(sum(amount) filter (where source in ('topup', 'voucher_purchase')), 0) as pembelian,
    coalesce(sum(amount) filter (where source = 'earning'), 0) as pendapatan,
    coalesce(sum(amount) filter (where source = 'refund_in'), 0) as refund_masuk,
    coalesce(-sum(amount) filter (where source = 'order_payment'), 0) as penggunaan,
    coalesce(-sum(amount) filter (where source = 'voucher_refund'), 0) as refund_keluar,
    coalesce(-sum(amount) filter (where source = 'payout'), 0) as payout,
    coalesce(sum(amount) filter (where source in ('adjustment', 'fee')), 0) as koreksi,
    coalesce(sum(amount) filter (where source not in ('topup', 'voucher_purchase', 'earning', 'refund_in', 'order_payment', 'voucher_refund', 'payout', 'adjustment', 'fee')), 0) as lain,
    count(*) as n
  into r from wallet_transactions where user_id = p_user and (created_at at time zone 'Asia/Jakarta')::date between p_from and p_to;
  select coalesce((select balance_after from wallet_transactions where user_id = p_user and (created_at at time zone 'Asia/Jakarta')::date <= p_to
                   order by created_at desc, seq desc limit 1), 0) into v_close;
  v_calc := v_open + r.pembelian + r.pendapatan + r.refund_masuk - r.penggunaan - r.refund_keluar - r.payout + r.koreksi + r.lain;
  return jsonb_build_object('user_id', p_user, 'from', p_from, 'to', p_to, 'saldo_awal', v_open,
    'pembelian', r.pembelian, 'pendapatan', r.pendapatan, 'refund_masuk', r.refund_masuk, 'penggunaan', r.penggunaan,
    'refund_keluar', r.refund_keluar, 'payout', r.payout, 'koreksi', r.koreksi, 'lain', r.lain, 'jumlah_mutasi', r.n,
    'saldo_akhir_hitung', v_calc, 'saldo_akhir_ledger', v_close, 'selisih', v_close - v_calc,
    'saldo_dompet_sekarang', (select balance from wallets where user_id = p_user),
    'rumus', 'saldo awal + pembelian + pendapatan + refund masuk − penggunaan − refund keluar − payout ± koreksi = saldo akhir');
end $$;
revoke all on function public.wallet_statement(uuid, date, date) from public, anon;
grant execute on function public.wallet_statement(uuid, date, date) to authenticated;

create or replace function public.admin_wallet_reconcile(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_bad jsonb; v_issued bigint; v_mut bigint;
begin
  perform admin_require('reconcile');
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_bad from (
    select w.user_id, w.balance, coalesce(t.jml, 0) as sum_mutasi, w.balance - coalesce(t.jml, 0) as selisih
      from wallets w left join (select user_id, sum(amount) jml from wallet_transactions group by user_id) t on t.user_id = w.user_id
     where w.balance <> coalesce(t.jml, 0)) x;
  select coalesce(sum(issued_amount), 0) into v_issued from voucher_purchases where status in ('issued', 'refund_requested', 'refund_pending', 'refunded')
     and (approved_at at time zone 'Asia/Jakarta')::date between p_from and p_to;
  select coalesce(sum(m.amount), 0) into v_mut from voucher_bank_mutations m join voucher_purchases v on v.id = m.purchase_id
   where v.status in ('issued', 'refund_requested', 'refund_pending', 'refunded') and (v.approved_at at time zone 'Asia/Jakarta')::date between p_from and p_to;
  return jsonb_build_object('from', p_from, 'to', p_to,
    'dompet_tidak_seimbang', v_bad, 'jumlah_dompet_tidak_seimbang', jsonb_array_length(v_bad),
    'voucher_terbit', v_issued, 'mutasi_bank_tercocok', v_mut, 'selisih_voucher_vs_bank', v_issued - v_mut,
    'mutasi_belum_tercocok', (select coalesce(sum(amount), 0) from voucher_bank_mutations where status = 'unmatched'),
    'dana_wajib_dikembalikan', (select coalesce(sum(amount), 0) from voucher_bank_mutations where status = 'refund_pending'),
    'float_pelanggan', (select coalesce(sum(balance), 0) from wallets w where balance > 0 and not wallet_is_partner(w.user_id)),
    'ok', jsonb_array_length(v_bad) = 0 and v_issued = v_mut);
end $$;
revoke all on function public.admin_wallet_reconcile(date, date) from public, anon;
grant execute on function public.admin_wallet_reconcile(date, date) to authenticated;

-- ---------------------------------------------------------------------
-- 7. Penjaga migrasi
-- ---------------------------------------------------------------------
do $$
begin
  if position('TOPUP_REQUIRE_BANK_MATCH' in pg_get_functiondef('public.admin_review_topup(uuid,boolean,text)'::regprocedure)) = 0 then
    raise exception '0112 batal: admin_review_topup belum memblokir persetujuan berbasis screenshot';
  end if;
  if exists (select 1 from wallet_transactions where balance_before is null) then raise exception '0112 batal: balance_before belum terisi'; end if;
  if exists (select 1 from company_bank_accounts b where voucher_bank_account_public_ok(b)) then
    raise exception '0112 batal: tidak boleh ada rekening tampil publik saat migrasi (harus diverifikasi manual)';
  end if;
  if payment_channel_label('antarpay') <> 'AntarVoucher (saldo)' then raise exception '0112 batal: label saluran belum AntarVoucher'; end if;
  raise notice '0112 ok';
end $$;
