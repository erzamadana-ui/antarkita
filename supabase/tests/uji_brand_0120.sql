-- =====================================================================
-- uji_brand_0120.sql — Aset merek (migrasi 0120)
--   1. Seed: 16 aset (2 logo, 1 ikon, 11 jaket_helm, 2 dokumen); selected = logo SVG, logo PNG, konsep utama; recommended = 02/03/04/07
--   2. brand_assets_list(): admin & driver boleh, pelanggan ditolak; url = https://…/brand/<file>; preview_url
--   3. admin_brand_asset_set: ubah selected/title/note; kunci liar ditolak; non-admin ditolak; audit_logs brand.asset_set
--   4. Berkas yang dikatalogkan memang ada di repo (dicek lewat daftar statis — ukuran byte sama dengan migrasi)
-- Pola (b): begin; do $$ … raise notice '[OK] …' $$; rollback;   Lokal: scripts/db-lokal.sh test supabase/tests/uji_brand_0120.sql
-- =====================================================================
begin;
do $$
declare
  adm  constant uuid := 'a0000000-0000-4000-8000-000000000001';
  cust constant uuid := 'a0000000-0000-4000-8000-000000000002';
  drv  constant uuid := 'a0000000-0000-4000-8000-000000000003';
  n int; n2 int; n3 int; r jsonb; v_msg text; v_id uuid;
begin
  -- ===== 1. seed =====
  select count(*), count(*) filter (where selected), count(*) filter (where recommended) into n, n2, n3 from brand_assets;
  if n <> 16 or n2 <> 3 or n3 <> 4 then raise exception '[GAGAL] seed: total=% selected=% recommended=%', n, n2, n3; end if;
  if (select string_agg(right(file_path, 6), ',' order by file_path) from brand_assets where recommended) <> 'rd.png,ir.png,al.png,ld.png' then
    raise exception '[GAGAL] recommended bukan 02/03/04/07: %', (select string_agg(file_path, ',' order by file_path) from brand_assets where recommended);
  end if;
  if (select count(*) from brand_assets where selected and file_path in ('brand/logo-antarkita-c29.svg', 'brand/logo-antarkita-1080-putih.png', 'brand/jaket-helm-00-konsep-utama.png')) <> 3 then raise exception '[GAGAL] selected seed'; end if;
  if (select count(*) from brand_assets where kind = 'jaket_helm') <> 11 or (select count(*) from brand_assets where kind = 'dokumen') <> 2 then raise exception '[GAGAL] jenis'; end if;
  raise notice '[OK] 1. seed 16 aset: selected 3 (SVG, PNG 1080, konsep utama), recommended 4 (02/03/04/07), 11 jaket_helm, 2 dokumen';

  -- ===== 2. list: admin & driver boleh, pelanggan ditolak; url =====
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  select count(*), count(*) filter (where x->>'url' like 'https://%/brand/%' and (x->>'can_edit')::boolean) into n, n2 from brand_assets_list() x;
  if n <> 16 or n2 <> 16 then raise exception '[GAGAL] list admin: %/%', n, n2; end if;
  select x into r from brand_assets_list() x where x->>'file_path' = 'brand/logo-antarkita-c29.svg';
  if r->>'url' <> brand_asset_url('brand/logo-antarkita-c29.svg') or r->>'preview_url' <> r->>'url' or (r->>'bytes')::int <> 384 then raise exception '[GAGAL] url svg: %', r; end if;
  select x into r from brand_assets_list() x where x->>'file_path' = 'brand/jaket-helm-03-tropical-air.png';
  if r->>'preview_url' not like '%/brand/jaket-helm-03-tropical-air.preview.webp' or not (r->>'recommended')::boolean then raise exception '[GAGAL] preview 03: %', r; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
  select count(*), count(*) filter (where (x->>'can_edit')::boolean) into n, n2 from brand_assets_list() x;
  if n <> 16 or n2 <> 0 then raise exception '[GAGAL] list driver: %/%', n, n2; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
  begin perform brand_assets_list(); raise exception '[GAGAL] pelanggan bisa membaca aset merek'; exception when others then v_msg := sqlerrm; end;
  if v_msg not like 'BRAND_FORBIDDEN%' then raise exception '%', v_msg; end if;
  perform set_config('request.jwt.claims', '', true);
  begin perform brand_assets_list(); raise exception '[GAGAL] anon bisa membaca'; exception when others then v_msg := sqlerrm; end;
  if v_msg like '[GAGAL]%' then raise exception '%', v_msg; end if;
  raise notice '[OK] 2. list: admin 16 (can_edit), driver 16 (baca saja), pelanggan → BRAND_FORBIDDEN, anon → Harus login; url & preview_url benar';

  -- ===== 3. admin_brand_asset_set =====
  select id into v_id from brand_assets where file_path = 'brand/jaket-helm-03-tropical-air.png';
  perform set_config('request.jwt.claims', json_build_object('sub', drv, 'role', 'authenticated')::text, true);
  begin perform admin_brand_asset_set(v_id, '{"selected": true}'); raise exception '[GAGAL] driver bisa mengubah'; exception when others then v_msg := sqlerrm; end;
  if v_msg like '[GAGAL]%' then raise exception '%', v_msg; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  begin perform admin_brand_asset_set(v_id, '{"file_path": "x"}'); raise exception '[GAGAL] kunci liar lolos'; exception when others then v_msg := sqlerrm; end;
  if v_msg not like 'BRAND_PATCH_UNKNOWN%' then raise exception '%', v_msg; end if;
  select count(*) into n from audit_logs where action = 'brand.asset_set';
  r := admin_brand_asset_set(v_id, jsonb_build_object('selected', true, 'title', 'Alternatif 03 — Tropical Air (dipilih GM)', 'note', 'badan jaket'));
  if not (r->>'selected')::boolean or r->>'title' <> 'Alternatif 03 — Tropical Air (dipilih GM)' or r->>'note' <> 'badan jaket' or r->>'updated_by' <> adm::text then raise exception '[GAGAL] set: %', r; end if;
  if (select count(*) from audit_logs where action = 'brand.asset_set') <> n + 1 then raise exception '[GAGAL] audit brand.asset_set'; end if;
  r := admin_brand_asset_set(v_id, '{"selected": false, "note": ""}');
  if (r->>'selected')::boolean or r->>'note' is not null then raise exception '[GAGAL] unset: %', r; end if;
  raise notice '[OK] 3. admin_brand_asset_set: driver ditolak, kunci liar ditolak, selected/title/note diubah + audit, note "" → null';
  raise notice '[OK] SELESAI_BRAND_0120';
end $$;
rollback;
