-- =====================================================================
-- 0024 — Akses berkas privat lintas pihak (temuan uji unggah data)
--   • Foto nota belanja (bucket 'proofs', diunggah driver) harus bisa dilihat PELANGGAN pemilik order.
--   • Lampiran tiket CS (bucket 'proofs') harus bisa dilihat kedua pihak: pemilik tiket & admin.
--   Sebelumnya kebijakan "proofs own" hanya mengizinkan pemilik folder (uid pengunggah) atau admin.
-- =====================================================================

drop policy if exists "proofs shared read" on storage.objects;
create policy "proofs shared read" on storage.objects for select to authenticated using (
  bucket_id = 'proofs' and (
    exists (select 1 from public.orders o where o.receipt_url = storage.objects.name and (o.customer_id = auth.uid() or o.driver_id = auth.uid()))
    or exists (select 1 from public.ticket_messages m join public.tickets t on t.id = m.ticket_id
               where m.attachment_url = storage.objects.name and (t.user_id = auth.uid() or m.sender_id = auth.uid()))
  )
);

-- Dokumen mitra travel/driver yang sudah punya URL http (bucket publik lama) tidak terpengaruh.
