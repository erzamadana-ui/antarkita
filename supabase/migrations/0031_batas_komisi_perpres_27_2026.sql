-- =====================================================================
-- 0031 — Batas komisi roda dua sesuai Perpres 27/2026 (berlaku 1 Juli 2026)
--
-- Temuan audit (tim deck investor, 7 Sep 2026): seed `pricing.commission_pct`
-- untuk layanan 'ride_motor' masih 20% — melanggar batas 8% untuk angkutan
-- sepeda motor berbasis aplikasi. Migrasi ini:
--   1) Menyimpan batas sebagai pengaturan (`commission_cap_two_wheel`) agar bisa
--      disesuaikan bila regulasi berubah, tanpa mengubah kode.
--   2) Menurunkan komisi ride_motor ke batas tersebut.
--   3) Memasang pengawal (trigger) supaya Panel Admin TIDAK BISA menyetel komisi
--      layanan roda dua di atas batas — kesalahan manusia jadi mustahil, bukan
--      hanya "diingatkan".
--
-- CATATAN KEPUTUSAN (menunggu komisaris + opini hukum, TIDAK diubah di sini):
--   • Apakah 'food' dan 'send' yang diantar dengan sepeda motor termasuk dalam
--     batas 8% masih perlu opini hukum. Keduanya SENGAJA dibiarkan 20% agar
--     perubahan pendapatan tidak terjadi diam-diam. Bila opini hukum menyatakan
--     termasuk, tambahkan kodenya ke daftar `two_wheel_services()`.
--   • "Biaya jasa aplikasi" (platform_fee Rp1.000) terhadap batas 8% juga perlu
--     opini hukum tersendiri.
-- =====================================================================

insert into app_settings (key, value) values ('commission_cap_two_wheel', '8')
  on conflict (key) do nothing;

-- Daftar layanan yang tunduk pada batas komisi roda dua.
create or replace function two_wheel_services()
returns text[] language sql immutable as $$ select array['ride_motor']::text[] $$;

create or replace function commission_cap_two_wheel()
returns numeric language sql stable set search_path = public as $$
  select coalesce((select (value #>> '{}')::numeric from app_settings where key = 'commission_cap_two_wheel'), 8)
$$;

-- Turunkan yang sudah terlanjur di atas batas.
update pricing
   set commission_pct = commission_cap_two_wheel()
 where service::text = any (two_wheel_services())
   and commission_pct > commission_cap_two_wheel();

-- Pengawal: tolak penyetelan di atas batas, dengan pesan yang menjelaskan dasarnya.
create or replace function guard_commission_cap()
returns trigger language plpgsql set search_path = public as $$
declare v_cap numeric := commission_cap_two_wheel();
begin
  if new.service::text = any (two_wheel_services()) and new.commission_pct > v_cap then
    raise exception 'Komisi layanan % dibatasi maksimal %%% sesuai Perpres 27/2026 (angkutan sepeda motor berbasis aplikasi). Nilai % ditolak.',
      new.service, v_cap, new.commission_pct;
  end if;
  return new;
end $$;

drop trigger if exists t_guard_commission_cap on pricing;
create trigger t_guard_commission_cap before insert or update of commission_pct on pricing
  for each row execute function guard_commission_cap();

do $$
declare v int;
begin
  select count(*) into v from pricing
   where service::text = any (two_wheel_services()) and commission_pct > commission_cap_two_wheel();
  if v > 0 then raise exception 'Masih ada % baris tarif roda dua di atas batas komisi', v; end if;
end $$;
