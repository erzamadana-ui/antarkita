-- Tahap 8 — perbaikan hasil simulasi E2E (S21 register_driver v2)
-- BUG: register_driver menyalakan antaraja.bypass, lalu insert driver_documents memicu trigger auto_verify_driver
-- yang di dalamnya set bypass 'on' → 'off'. Setelah trigger selesai, bypass sudah 'off' sehingga
-- `update profiles set role = 'driver'` di register_driver ditolak guard_profile_update ("Tidak boleh mengubah role/status akun").
-- Dampak nyata: pendaftaran driver yang dokumennya lengkap (skor auto-verifikasi ≥ 80) selalu GAGAL sejak tahap 7.
-- Perbaikan: (1) auto_verify_* memulihkan nilai bypass sebelumnya (bukan memaksa 'off'), (2) register_driver mengubah role
-- profil SEBELUM menyimpan dokumen dan menyalakan bypass ulang sebelum setiap langkah yang dijaga trigger.

create or replace function auto_verify_driver(p_driver uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_score int; v_min int := setting_num('auto_verify_min_score', 80)::int; v_days int := setting_num('probation_days', 7)::int; d drivers;
  v_prev text := coalesce(current_setting('antaraja.bypass', true), 'off');
begin
  if not coalesce((select value::text::boolean from app_settings where key = 'auto_verify_enabled'), true) then return false; end if;
  select * into d from drivers where id = p_driver; if not found or d.status <> 'pending' then return false; end if;
  if exists (select 1 from fraud_flags where subject_id = p_driver and status = 'open') then return false; end if;
  v_score := verification_score_driver(p_driver);
  update drivers set verify_score = v_score where id = p_driver;
  if v_score < v_min then return false; end if;
  perform set_config('antaraja.bypass', 'on', true);
  update drivers set status = 'approved', auto_verified = true, probation_until = now() + (v_days || ' days')::interval, status_reason = 'Auto-verifikasi (skor ' || v_score || '/100) · masa percobaan ' || v_days || ' hari' where id = p_driver;
  perform set_config('antaraja.bypass', v_prev, true); -- pulihkan nilai sebelumnya agar pemanggil (register_driver) tidak kehilangan bypass
  insert into notifications (user_id, kind, title, body, data) values (p_driver, 'system', 'Akun driver aktif ✔', 'Dokumen Anda lolos verifikasi otomatis. Selama ' || v_days || ' hari pertama, maksimal ' || setting_num('probation_daily_orders', 10)::int || ' order/hari. Selamat bekerja!', jsonb_build_object('score', v_score));
  insert into security_events (kind, user_id, detail) values ('verify.auto', p_driver, jsonb_build_object('entity', 'driver', 'score', v_score));
  perform log_activity('driver.auto_verified', 'drivers', p_driver::text, '[otomatis] Driver disetujui (skor ' || v_score || ')', jsonb_build_object('score', v_score));
  return true;
end $$;

create or replace function auto_verify_merchant(p_merchant uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_score int; v_min int := setting_num('auto_verify_min_score', 80)::int; v_days int := setting_num('probation_days', 7)::int; m merchants;
  v_prev text := coalesce(current_setting('antaraja.bypass', true), 'off');
begin
  if not coalesce((select value::text::boolean from app_settings where key = 'auto_verify_enabled'), true) then return false; end if;
  select * into m from merchants where id = p_merchant; if not found or m.status <> 'pending' then return false; end if;
  if exists (select 1 from fraud_flags where subject_id = m.owner_id and status = 'open') then return false; end if;
  v_score := verification_score_merchant(p_merchant);
  update merchants set verify_score = v_score where id = p_merchant;
  if v_score < v_min then return false; end if;
  perform set_config('antaraja.bypass', 'on', true);
  update merchants set status = 'approved', auto_verified = true, probation_until = now() + (v_days || ' days')::interval where id = p_merchant;
  perform set_config('antaraja.bypass', v_prev, true);
  insert into notifications (user_id, kind, title, body, data) values (m.owner_id, 'system', 'Toko Anda aktif ✔', 'Dokumen usaha lolos verifikasi otomatis. Label halal terverifikasi tetap menunggu pemeriksaan admin.', jsonb_build_object('score', v_score, 'merchant_id', p_merchant));
  insert into security_events (kind, user_id, detail) values ('verify.auto', m.owner_id, jsonb_build_object('entity', 'merchant', 'merchant_id', p_merchant, 'score', v_score));
  perform log_activity('merchant.auto_verified', 'merchants', p_merchant::text, '[otomatis] Merchant "' || m.name || '" disetujui (skor ' || v_score || ')', jsonb_build_object('score', v_score));
  return true;
end $$;

-- register_driver v2 (logika sama dengan 0021) — urutan: kendaraan → role profil → dokumen (trigger auto-verifikasi paling akhir)
create or replace function register_driver(p jsonb)
returns drivers language plpgsql security definer set search_path = public as $$
declare d drivers%rowtype; v_type vehicle_type := coalesce((p->>'vehicle_type')::vehicle_type, 'motor');
  v_year int := nullif(p->>'vehicle_year', '')::int; v_cond text := coalesce(nullif(p->>'vehicle_condition', ''), 'baik');
  v_fuel text := nullif(p->>'fuel_type', ''); v_ev boolean;
begin
  if auth.uid() is null then raise exception 'Harus login'; end if;
  if v_year is not null and (v_year < 1990 or v_year > extract(year from now())::int + 1) then raise exception 'Tahun kendaraan tidak valid'; end if;
  if v_fuel is not null and v_fuel not in ('bensin','diesel','listrik','hybrid') then raise exception 'Jenis bahan bakar tidak valid'; end if;
  if v_type = 'motor' and v_fuel = 'diesel' then raise exception 'Motor tidak memakai diesel — periksa jenis bahan bakar'; end if;
  if length(trim(coalesce(p->>'vehicle_brand',''))) < 2 then raise exception 'Merek kendaraan wajib diisi'; end if;
  v_ev := coalesce((p->>'is_electric')::boolean, v_fuel = 'listrik', false);
  if v_fuel = 'listrik' then v_ev := true; elsif v_fuel in ('bensin','diesel') then v_ev := false; end if;
  perform set_config('antaraja.bypass', 'on', true);
  insert into drivers (id, vehicle_type, vehicle_brand, vehicle_model, fuel_type, vehicle_plate, vehicle_color, vehicle_year, vehicle_condition, is_electric, vehicle_capacity, vehicle_class)
  values (auth.uid(), v_type, p->>'vehicle_brand', nullif(p->>'vehicle_model',''), v_fuel, upper(p->>'vehicle_plate'), p->>'vehicle_color', v_year, v_cond, v_ev, p->>'vehicle_capacity', derive_vehicle_class(v_type, v_year, v_cond, v_ev))
  on conflict (id) do update set vehicle_type = excluded.vehicle_type, vehicle_brand = excluded.vehicle_brand, vehicle_model = excluded.vehicle_model, fuel_type = excluded.fuel_type,
    vehicle_plate = excluded.vehicle_plate, vehicle_color = excluded.vehicle_color, vehicle_year = excluded.vehicle_year,
    vehicle_condition = excluded.vehicle_condition, is_electric = excluded.is_electric, vehicle_capacity = excluded.vehicle_capacity,
    vehicle_class = excluded.vehicle_class,
    status = case when drivers.status in ('suspended','approved') then drivers.status else 'pending' end
  returning * into d;
  -- role profil diubah sebelum dokumen disimpan (trigger auto-verifikasi dokumen bisa mengubah bypass)
  perform set_config('antaraja.bypass', 'on', true);
  update profiles set role = 'driver' where id = auth.uid() and role = 'customer';
  insert into driver_documents (driver_id, license_number, id_card_number, photo_id_url, photo_vehicle_url)
  values (auth.uid(), p->>'license_number', p->>'id_card_number', p->>'photo_id_url', p->>'photo_vehicle_url')
  on conflict (driver_id) do update set license_number = excluded.license_number, id_card_number = excluded.id_card_number,
    photo_id_url = coalesce(excluded.photo_id_url, driver_documents.photo_id_url),
    photo_vehicle_url = coalesce(excluded.photo_vehicle_url, driver_documents.photo_vehicle_url), updated_at = now();
  perform set_config('antaraja.bypass', 'off', true);
  select * into d from drivers where id = auth.uid(); -- status bisa berubah jadi approved oleh auto-verifikasi
  return d;
end $$;
