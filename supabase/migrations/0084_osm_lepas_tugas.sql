-- 0084 — Impor OSM: lepaskan tugas segera saat Overpass tidak terjangkau.
--
-- Sebelumnya, bila semua endpoint Overpass gagal, tugas yang sudah di-claim dibiarkan
-- berstatus 'running' dan baru kembali ke antrean setelah 10 menit (osm_claim_tasks).
-- Akibatnya impor nasional "macet" 10 menit per kegagalan jaringan (temuan QC 12 Sep 2026:
-- 2 tugas running tanpa pekerja, 30 pending). Fungsi ini mengembalikan tugas ke 'pending'
-- seketika; batas 3 percobaan tetap dihitung lewat kolom attempts oleh osm_claim_tasks.
create or replace function osm_release_task(p_task bigint, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t osm_import_tasks%rowtype;
begin
  update osm_import_tasks set status = 'pending', claimed_at = null, error = left(nullif(p_reason, ''), 500)
   where id = p_task and status = 'running' returning * into t;
  if t.id is null then return jsonb_build_object('ok', false, 'reason', 'tugas tidak sedang berjalan'); end if;
  return jsonb_build_object('ok', true, 'task', t.id, 'attempts', t.attempts);
end $$;
revoke all on function osm_release_task(bigint, text) from public, anon, authenticated;
comment on function osm_release_task(bigint, text) is 'Dipanggil Edge Function osm-import (service_role) saat Overpass tidak terjangkau: tugas kembali ke antrean tanpa menunggu 10 menit.';
