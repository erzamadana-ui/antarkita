-- =====================================================================
-- pra/0094_rapikan_kota_lama.sql — fixture data produksi untuk harness LOKAL
-- Dijalankan scripts/db-lokal.sh di transaksi yang sama, TEPAT SEBELUM
-- supabase/migrations/0094_rapikan_kota_lama.sql. Tidak pernah dipakai di produksi.
--
-- Mengapa perlu: 0094 diakhiri "penjaga" yang memverifikasi keadaan DATA
-- produksi, bukan hanya skema:
--   ERROR:  0094 batal: kota aktif 2 (harus tetap 4)
--   CONTEXT:  PL/pgSQL function inline_code_block line 9 at RAISE
-- Di produksi ada 4 kota 'aktif' (Batam, Dumai, Padang, Pekanbaru). Padang &
-- Pekanbaru dibuka oleh migrasi 0079; Batam & Dumai dibuka ADMIN lewat panel
-- (RPC admin_set_city_status, 0079) — perubahan data yang tidak pernah ditulis
-- di migrasi mana pun. Basis data lokal yang dibangun murni dari migrasi hanya
-- punya 2 kota aktif, sehingga penjaga 0094 menggagalkan migrasi.
--
-- Fixture ini meniru hasil admin_set_city_status(<Batam|Dumai>, 'aktif', <semua
-- layanan>) tanpa memerlukan sesi admin. [ASUMSI] layanan yang dibuka: semua —
-- daftar layanan sebenarnya di produksi tidak tercatat di repositori.
-- =====================================================================
do $$
declare c record; sv service_type;
begin
  for c in select id, name from cities where name in ('Batam', 'Dumai') and source = 'admin' and service_status <> 'aktif' loop
    update cities
       set service_status = 'aktif',
           status_note = 'harness lokal (pra/0094): meniru pembukaan kota oleh admin di produksi',
           status_changed_at = now()
     where id = c.id;
    for sv in select unnest(enum_range(null::service_type)) loop
      insert into city_services (city_id, service, enabled, opened_at, updated_at)
      values (c.id, sv, true, now(), now())
      on conflict (city_id, service) do update set enabled = true, opened_at = coalesce(city_services.opened_at, now()), updated_at = now();
    end loop;
    raise notice 'pra/0094: kota % dibuka (aktif, semua layanan) meniru produksi', c.name;
  end loop;
end $$;
