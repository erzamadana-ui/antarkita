-- =====================================================================
-- 0041 — Batalkan pembatas laju driver_by_code (tidak efektif)
--
-- Alasan: PostgreSQL/PostgREST membatalkan (ROLLBACK) seluruh transaksi
-- ketika sebuah fungsi RAISE EXCEPTION. Jalur penyalahgunaan pada
-- driver_by_code adalah "kode tidak ditemukan" → RAISE → penghitung
-- lookup_rate yang baru dinaikkan ikut ter-rollback, sehingga enumerasi
-- massal TIDAK terbendung. Hanya pencarian yang BERHASIL (jalur sukses)
-- yang commit dan terhitung — justru menghukum pengguna sah, bukan
-- penyerang. Karena kontrol ini menyesatkan (false sense of security),
-- fungsi dikembalikan ke perilaku 0030.
--
-- Mitigasi sebenarnya (LAPORAN, tidak diterapkan otomatis karena berisiko
-- mengubah kontrak klien / UI):
--   1. Kurangi data yang dibocorkan pratinjau: buang `vehicle_plate` dan
--      `last_seen_minutes`/`is_online` — plat & posisi tak diperlukan
--      sebelum order cocok; cukup nama, foto, jenis/kelas kendaraan, rating.
--   2. Pembatasan laju di lapisan gateway/PostgREST (mis. Kong rate-limit)
--      atau via mekanisme commit-otomatis (dblink) — dblink tidak tersedia
--      di proyek ini.
--   3. Pemantauan anomali: blokir akun yang memanggil driver_by_code dgn
--      volume tak wajar (deteksi + ban manual/otomatis oleh admin).
--
-- create_ticket TETAP dibatasi (jalur penyalahgunaannya = jalur sukses
-- yang commit, sehingga pembatas efektif). lookup_rate & rate_take tetap
-- dipakai create_ticket.
-- =====================================================================

create or replace function public.driver_by_code(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^0-9A-Za-z]', '', 'g'));
  d drivers%rowtype; pf profiles%rowtype;
begin
  if length(v_code) <> 6 then
    raise exception 'Kode driver terdiri dari 6 karakter. Periksa kembali kode yang Anda masukkan.';
  end if;
  select * into d from drivers where code = v_code;
  if not found then
    raise exception 'Kode driver % tidak ditemukan. Minta driver membuka menu "Kode Saya" di aplikasi Mitra.', v_code;
  end if;
  select * into pf from profiles where id = d.id;
  if d.status <> 'approved' or not coalesce(pf.is_active, false) then
    raise exception 'Driver dengan kode % sedang tidak aktif. Silakan pesan seperti biasa.', v_code;
  end if;
  return jsonb_build_object(
    'id', d.id, 'code', d.code, 'name', pf.full_name, 'avatar_url', pf.avatar_url,
    'vehicle_type', d.vehicle_type, 'vehicle_class', d.vehicle_class,
    'vehicle_brand', d.vehicle_brand, 'vehicle_model', d.vehicle_model, 'vehicle_plate', d.vehicle_plate,
    'rating_avg', d.rating_avg, 'rating_count', d.rating_count, 'total_trips', d.total_trips,
    'is_online', d.is_online,
    'last_seen_minutes', case when d.last_seen_at is null then null
                              else round((extract(epoch from now() - d.last_seen_at) / 60.0)::numeric, 0)::int end,
    'services', to_jsonb(driver_service_codes(d.vehicle_type)));
end $$;
revoke all on function public.driver_by_code(text) from public, anon;
grant execute on function public.driver_by_code(text) to authenticated;
