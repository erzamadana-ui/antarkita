// Admin · Dashboard Contribution Margin (finpay-v3, kontrak §6):
// rpc('admin_contribution_margin', { p_from, p_to, p_group }) per layanan / kota / merchant / bulan.
import React, { useCallback } from 'react';
import { AdminPage, RequirePerm } from '@/components/admin';
import { rpc } from '@/lib/supabase';
import type { ContributionGroup } from '@/lib/admin';
import { ContributionView } from './_contribution-view';

export default function AdminContribution() {
  const fetch = useCallback((from: string, to: string, group: ContributionGroup) => rpc('admin_contribution_margin', { p_from: from, p_to: to, p_group: group }), []);
  return (
    <AdminPage title="Contribution Margin" subtitle="Unit economics dari buku besar order: pendapatan platform dikurangi biaya PG platform, promo platform, refund/fraud, dan biaya variabel — per layanan, kota, merchant, atau bulan.">
      <RequirePerm perm={['report', 'view']} mode="notice">
        <ContributionView fetch={fetch} />
      </RequirePerm>
    </AdminPage>
  );
}
