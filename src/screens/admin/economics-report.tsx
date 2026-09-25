// Admin · Laporan Skema Bisnis (Skema Bisnis v2, migrasi 0103).
// rpc('admin_exec_report_v2', { p_from, p_to, p_filters }) — satu sumber kebenaran: order_ledger.
// Isi laporan (filter §7, KPI, tabel, gerbang, label) ada di ./_skema-report agar sama persis dengan
// tab "Skema Bisnis" di Portal Eksekutif.
import React, { useCallback, useState } from 'react';
import { AdminPage } from '@/components/admin';
import { Button } from '@/components/ui';
import { rpc } from '@/lib/supabase';
import type { SkemaReport } from '@/lib/types';
import { SkemaReportView } from './_skema-report';

export default function AdminEconomicsReport() {
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = () => setRefreshKey((k) => k + 1);
  const fetchReport = useCallback((from: string, to: string, filters: Record<string, unknown>) =>
    rpc<SkemaReport>('admin_exec_report_v2', { p_from: from, p_to: to, p_filters: filters }), []);
  return (
    <AdminPage title="Laporan Skema Bisnis" subtitle="Unit economics dari buku besar order: GMV bersih, take rate bersih, contribution, EBITDA kota, dan gerbang scale-up" onRefresh={refresh}
      right={<Button size="sm" variant="outline" title="Segarkan" icon="refresh-outline" onPress={refresh} />}>
      <SkemaReportView fetchReport={fetchReport} refreshKey={refreshKey} />
    </AdminPage>
  );
}
