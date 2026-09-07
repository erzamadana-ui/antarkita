// Kartu status pengajuan merchant + label halal
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Card, Row, Badge } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { colors, font, radius } from '@/lib/theme';
import { formatDate } from '@/lib/format';
import type { Merchant, MerchantDocuments } from '@/lib/types';

export function HalalBadge({ merchant, size = 'sm' }: { merchant: Pick<Merchant, 'is_halal' | 'halal_verified'>; size?: 'sm' | 'md' }) {
  if (!merchant.is_halal) return <Badge text="Non-halal" color={colors.textMuted} />;
  return (
    <View style={[s.halal, merchant.halal_verified && { backgroundColor: colors.success, borderColor: colors.success }, size === 'md' && { paddingHorizontal: 10, paddingVertical: 4 }]}>
      <Ionicons name={merchant.halal_verified ? 'shield-checkmark' : 'leaf-outline'} size={size === 'md' ? 13 : 11} color={merchant.halal_verified ? '#fff' : colors.success} />
      <Text style={{ fontSize: size === 'md' ? 12 : 10, fontWeight: '800', color: merchant.halal_verified ? '#fff' : colors.success }}>{merchant.halal_verified ? 'Halal ✓' : 'Halal'}</Text>
    </View>
  );
}

export function useMerchantDocs(merchantId?: string | null) {
  const [docs, setDocs] = useState<MerchantDocuments | null>(null);
  const reload = async () => { if (!merchantId) return; const { data } = await supabase.from('merchant_documents').select('*').eq('merchant_id', merchantId).maybeSingle(); setDocs((data as MerchantDocuments) ?? null); };
  useEffect(() => { reload(); }, [merchantId]); // eslint-disable-line react-hooks/exhaustive-deps
  return { docs, reload };
}

const STATUS: Record<string, { label: string; color: string; icon: string; desc: string }> = {
  pending: { label: 'Menunggu verifikasi admin', color: colors.warning, icon: 'hourglass-outline', desc: 'Pengajuan dan dokumen Anda sedang diperiksa. Biasanya < 1×24 jam kerja.' },
  approved: { label: 'Aktif · terverifikasi', color: colors.success, icon: 'checkmark-circle', desc: 'Toko Anda tampil di AntarFood dan bisa menerima pesanan.' },
  rejected: { label: 'Pengajuan ditolak', color: colors.danger, icon: 'close-circle', desc: 'Perbaiki data/dokumen sesuai catatan admin, lalu ajukan ulang.' },
  suspended: { label: 'Ditangguhkan', color: colors.danger, icon: 'pause-circle', desc: 'Toko disembunyikan sementara. Hubungi CS untuk informasi.' },
};

export function MerchantStatusCard({ merchant }: { merchant: Merchant }) {
  const { docs } = useMerchantDocs(merchant.id);
  const st = STATUS[merchant.status] ?? STATUS.pending;
  const checklist = [
    { label: 'NPWP / NPWPD', ok: !!docs?.npwp_no, required: true },
    { label: 'KTP pemilik', ok: !!docs?.owner_id_card_url, required: true },
    { label: 'Foto tempat usaha', ok: !!docs?.place_photo_url, required: true },
    { label: 'Izin usaha / NIB', ok: !!(docs?.license_no || docs?.license_url), required: false },
    { label: 'Sertifikat halal', ok: !!(docs?.halal_cert_no || docs?.halal_cert_url), required: false },
  ];
  return (
    <Card style={{ gap: 10 }}>
      <Row between>
        <View style={{ flex: 1 }}><Text style={font.h2}>{merchant.name}</Text><Text style={font.small}>{merchant.category} · {merchant.address}</Text></View>
        <HalalBadge merchant={merchant} size="md" />
      </Row>
      <Row gap={10} style={[s.status, { backgroundColor: st.color + '14', borderColor: st.color + '44' }]}>
        <Ionicons name={st.icon as never} size={24} color={st.color} />
        <View style={{ flex: 1 }}><Text style={{ fontWeight: '800', color: st.color }}>{st.label}</Text><Text style={font.tiny}>{st.desc}</Text></View>
      </Row>
      {docs?.review_note && (merchant.status === 'rejected' || merchant.status === 'suspended' || merchant.status === 'approved') && (
        <View style={s.note}><Text style={font.tiny}>Catatan admin{docs.reviewed_at ? ` · ${formatDate(docs.reviewed_at)}` : ''}</Text><Text style={font.body}>{docs.review_note}</Text></View>
      )}
      <View style={{ gap: 6 }}>
        <Text style={font.label}>Kelengkapan dokumen</Text>
        {checklist.map((c) => (
          <Row key={c.label} gap={8}>
            <Ionicons name={c.ok ? 'checkmark-circle' : c.required ? 'alert-circle' : 'ellipse-outline'} size={16} color={c.ok ? colors.success : c.required ? colors.danger : colors.textMuted} />
            <Text style={[font.small, { flex: 1 }]}>{c.label}{!c.required && <Text style={font.tiny}> (opsional)</Text>}</Text>
            <Text style={[font.tiny, { color: c.ok ? colors.success : colors.textMuted }]}>{c.ok ? 'Lengkap' : c.required ? 'Wajib' : '—'}</Text>
          </Row>
        ))}
      </View>
      {!!docs?.submitted_at && <Text style={font.tiny}>Diajukan {formatDate(docs.submitted_at)}</Text>}
    </Card>
  );
}

const s = StyleSheet.create({
  halal: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 7, paddingVertical: 3, borderRadius: radius.full, borderWidth: 1, borderColor: colors.success + '66', backgroundColor: colors.success + '14' },
  status: { padding: 12, borderRadius: radius.md, borderWidth: 1 },
  note: { backgroundColor: 'rgba(245,158,11,0.1)', borderRadius: radius.md, padding: 10, gap: 2 },
});
