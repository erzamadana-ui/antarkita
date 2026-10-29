-- =====================================================================
-- 0120 — Aset merek (logo, ikon, jaket & helm, dokumen produksi) untuk diunduh dari Panel Admin
--   Keputusan GM 29 Okt 2026. Berkas fisik ada di repo public/brand/ (dilayani GitHub Pages di domain resmi);
--   tabel brand_assets hanya katalog + pilihan (selected/recommended). URL publik = 'https://apps.antarkitaindonesia.com/' || file_path
--   (host TIDAK disimpan di kolom; dibentuk di brand_assets_list() lewat setelan site_url bila ada, default domain resmi).
--   • brand_assets_list(): authenticated — admin & mitra (driver/merchant) boleh membaca; pelanggan ditolak.
--   • admin_brand_asset_set(id, patch): admin_require('city'); patch selected | recommended | title | note | sort; log_activity.
--   • Seed idempoten (on conflict file_path): ukuran byte dari `ls -la public/brand` 29 Okt 2026.
-- Idempoten. Rollback: supabase/rollback/0120_down.sql
-- =====================================================================
do $$ begin
  perform _mig_backup('0120', 'public.brand_assets_list()');
  perform _mig_backup('0120', 'public.admin_brand_asset_set(uuid,jsonb)');
  perform _mig_backup('0120', 'public.brand_asset_url(text)');
end $$;

create table if not exists public.brand_assets (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('logo', 'ikon', 'jaket_helm', 'dokumen')),
  title        text not null,
  file_path    text not null unique check (file_path !~ '^(https?:)?//' and file_path !~ '^/' ),
  preview_path text,
  bytes        bigint not null default 0 check (bytes >= 0),
  format       text not null,
  selected     boolean not null default false,
  recommended  boolean not null default false,
  note         text,
  sort         int not null default 100,
  updated_by   uuid references public.profiles(id),
  updated_at   timestamptz not null default now()
);
comment on table public.brand_assets is '0120: katalog aset merek AntarKita (public/brand/). file_path relatif terhadap domain resmi; dibaca brand_assets_list(), diubah admin_brand_asset_set().';
alter table public.brand_assets enable row level security;
revoke all on public.brand_assets from public, anon, authenticated;
grant all on public.brand_assets to service_role;

-- seed katalog (idempoten; kolom selected/recommended/title/note hanya diisi saat baris BARU agar pilihan admin tidak ditimpa)
insert into public.brand_assets (kind, title, file_path, preview_path, bytes, format, selected, recommended, note, sort) values
  ('logo',       'Logo AntarKita C29 ''Dua Tetes Bersatu'' (SVG vektor)', 'brand/logo-antarkita-c29.svg',          null,                                           384,     'svg',  true,  false, 'Master vektor — pakai untuk cetak & skala besar', 10),
  ('logo',       'Logo 1080px latar putih',                              'brand/logo-antarkita-1080-putih.png',   'brand/logo-antarkita-1080-putih.preview.webp', 16396,   'png',  true,  false, null, 20),
  ('ikon',       'Ikon aplikasi 1024px',                                 'brand/ikon-aplikasi-1024.png',          'brand/ikon-aplikasi-1024.preview.webp',        18965,   'png',  false, false, 'Ikon toko aplikasi (Play Store / App Store)', 30),
  ('jaket_helm', 'Konsep utama jaket & helm mitra (5 Sep 2026)',         'brand/jaket-helm-00-konsep-utama.png',  'brand/jaket-helm-00-konsep-utama.preview.webp', 2161777, 'png', true,  false, 'Konsep utama yang dipilih', 40),
  ('jaket_helm', 'Alternatif 01 — Urban Teal',                           'brand/jaket-helm-01-urban-teal.png',    'brand/jaket-helm-01-urban-teal.preview.webp',  1636191, 'png',  false, false, null, 41),
  ('jaket_helm', 'Alternatif 02 — Night Guard',                          'brand/jaket-helm-02-night-guard.png',   'brand/jaket-helm-02-night-guard.preview.webp', 1818598, 'png',  false, true,  'Rekomendasi advisor: reflektor dari konsep 02', 42),
  ('jaket_helm', 'Alternatif 03 — Tropical Air',                         'brand/jaket-helm-03-tropical-air.png',  'brand/jaket-helm-03-tropical-air.preview.webp', 1952645, 'png', false, true,  'Rekomendasi advisor: badan jaket dari konsep 03', 43),
  ('jaket_helm', 'Alternatif 04 — Premium Minimal',                      'brand/jaket-helm-04-premium-minimal.png','brand/jaket-helm-04-premium-minimal.preview.webp', 1446705, 'png', false, true, 'Rekomendasi advisor: helm dari konsep 04', 44),
  ('jaket_helm', 'Alternatif 05 — Nusantara Flow',                       'brand/jaket-helm-05-nusantara-flow.png','brand/jaket-helm-05-nusantara-flow.preview.webp', 1518836, 'png', false, false, null, 45),
  ('jaket_helm', 'Alternatif 06 — Sport Dynamic',                        'brand/jaket-helm-06-sport-dynamic.png', 'brand/jaket-helm-06-sport-dynamic.preview.webp', 1752361, 'png', false, false, null, 46),
  ('jaket_helm', 'Alternatif 07 — Monsoon Shield',                       'brand/jaket-helm-07-monsoon-shield.png','brand/jaket-helm-07-monsoon-shield.preview.webp', 1725239, 'png', false, true, 'Rekomendasi advisor: varian hujan dari konsep 07', 47),
  ('jaket_helm', 'Alternatif 08 — Community Mint',                       'brand/jaket-helm-08-community-mint.png','brand/jaket-helm-08-community-mint.preview.webp', 1440867, 'png', false, false, null, 48),
  ('jaket_helm', 'Alternatif 09 — Tech Grid',                            'brand/jaket-helm-09-tech-grid.png',     'brand/jaket-helm-09-tech-grid.preview.webp',   1764913, 'png',  false, false, null, 49),
  ('jaket_helm', 'Alternatif 10 — Modular Two Season',                   'brand/jaket-helm-10-modular-two-season.png','brand/jaket-helm-10-modular-two-season.preview.webp', 2029152, 'png', false, false, null, 50),
  ('dokumen',    'Spesifikasi produksi jaket & helm',                    'brand/spesifikasi-produksi-jaket-helm.md', null,                                       3311,    'md',   false, false, 'Untuk vendor konveksi/helm', 60),
  ('dokumen',    'Katalog 10 alternatif jaket & helm',                   'brand/katalog-alternatif-jaket-helm.md',   null,                                       2410,    'md',   false, false, null, 61)
on conflict (file_path) do update set kind = excluded.kind, preview_path = excluded.preview_path, bytes = excluded.bytes, format = excluded.format, updated_at = now();

create or replace function public.brand_asset_url(p_path text)
returns text language sql stable security definer set search_path = public as $$
  select case when p_path is null then null
              else rtrim(coalesce(nullif(btrim((select value #>> '{}' from app_settings where key = 'site_url')), ''), 'https://apps.antarkitaindonesia.com'), '/') || '/' || p_path end;
$$;
grant execute on function public.brand_asset_url(text) to anon, authenticated;

create or replace function public.brand_assets_list()
returns setof jsonb language plpgsql stable security definer set search_path = public as $$
declare v_role text;
begin
  select role::text into v_role from profiles where id = auth.uid() and is_active;
  if v_role is null then raise exception 'Harus login'; end if;
  if v_role not in ('admin', 'driver', 'merchant') then raise exception 'BRAND_FORBIDDEN: aset merek hanya untuk admin & mitra'; end if;
  return query
    select to_jsonb(a) || jsonb_build_object('url', brand_asset_url(a.file_path), 'preview_url', brand_asset_url(coalesce(a.preview_path, case when a.format = 'svg' then a.file_path end)),
             'can_edit', v_role = 'admin')
      from brand_assets a order by a.sort, a.title;
end $$;
revoke all on function public.brand_assets_list() from public, anon;
grant execute on function public.brand_assets_list() to authenticated;

create or replace function public.admin_brand_asset_set(p_id uuid, p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a brand_assets; b brand_assets; k text;
begin
  perform admin_require('city');
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then raise exception 'Patch harus objek JSON {selected|recommended|title|note|sort}'; end if;
  for k in select jsonb_object_keys(p_patch) loop
    if k not in ('selected', 'recommended', 'title', 'note', 'sort') then raise exception 'BRAND_PATCH_UNKNOWN: kunci % tidak dikenal', k; end if;
  end loop;
  select * into b from brand_assets where id = p_id for update;
  if not found then raise exception 'Aset tidak ditemukan'; end if;
  update brand_assets set
    selected    = case when p_patch ? 'selected'    then coalesce((p_patch->>'selected')::boolean, selected) else selected end,
    recommended = case when p_patch ? 'recommended' then coalesce((p_patch->>'recommended')::boolean, recommended) else recommended end,
    title       = case when p_patch ? 'title' and nullif(btrim(p_patch->>'title'), '') is not null then left(btrim(p_patch->>'title'), 160) else title end,
    note        = case when p_patch ? 'note' then nullif(left(btrim(p_patch->>'note'), 500), '') else note end,
    sort        = case when p_patch ? 'sort' then coalesce((p_patch->>'sort')::int, sort) else sort end,
    updated_by = auth.uid(), updated_at = now()
   where id = p_id returning * into a;
  perform log_activity('brand.asset_set', 'brand_assets', a.id::text, 'Aset merek "' || a.title || '" diubah: ' || p_patch::text, jsonb_build_object('before', to_jsonb(b), 'after', to_jsonb(a)));
  return to_jsonb(a) || jsonb_build_object('url', brand_asset_url(a.file_path));
end $$;
revoke all on function public.admin_brand_asset_set(uuid, jsonb) from public, anon;
grant execute on function public.admin_brand_asset_set(uuid, jsonb) to authenticated;

-- penjaga
do $$
begin
  if (select count(*) from brand_assets) < 16 then raise exception '0120 batal: seed brand_assets kurang (%)', (select count(*) from brand_assets); end if;
  if (select count(*) from brand_assets where selected) < 1 or (select count(*) from brand_assets where recommended) < 1 then raise exception '0120 batal: selected/recommended seed tidak sesuai'; end if;   -- longgar: pilihan admin boleh berubah setelahnya
  if brand_asset_url('brand/logo-antarkita-c29.svg') not like 'https://%/brand/logo-antarkita-c29.svg' then raise exception '0120 batal: brand_asset_url'; end if;
  raise notice '0120 ok: % aset merek, URL dasar %', (select count(*) from brand_assets), brand_asset_url('');
end $$;
