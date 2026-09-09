// Admin · Blast Promo — kirim promo merchant/promo kode ke kotak masuk pelanggan (satu arah admin → pelanggan)
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { AdminPage, Table, StatCard, AdminSelect, adminFont as font, adminTone, adminRadius, adminSpace, AdminCard as Card } from '@/components/admin';
import { Row, Input, Button, Badge, toast } from '@/components/ui';
import { PromoCard } from '@/components/PromoCard';
import { DocUpload } from '@/components/DocUpload';
import { rpc, supabase } from '@/lib/supabase';
import { colors } from '@/lib/theme';

import type { Blast, City, Merchant, Promo } from '@/lib/types';
import { fmtDate, fmtAgo, WideTableHint } from './_shared';

const TARGETS = [{ key: 'all', label: 'Semua pengguna aktif' }, { key: 'customers', label: 'Hanya pelanggan' }, { key: 'active30', label: 'Aktif 30 hari terakhir' }, { key: 'city', label: 'Per kota' }];

export default function AdminBlast() {
  const [blasts, setBlasts] = useState<Blast[]>([]);
  const [promos, setPromos] = useState<Promo[]>([]);
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [users, setUsers] = useState(0);
  const [f, setF] = useState({ title: '', body: '', image_url: '', promo_code: '', merchant_id: '', target: 'all', city_id: '' });
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const [{ data: b }, { data: p }, { data: m }, { data: c }, { count }] = await Promise.all([
      supabase.from('blasts').select('*').order('created_at', { ascending: false }).limit(50),
      supabase.from('promos').select('*').eq('is_active', true).order('sort_order'),
      supabase.from('merchants').select('*').eq('status', 'approved').order('name').limit(200),
      supabase.from('cities').select('*').eq('active', true).order('name'),
      supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('is_active', true).neq('role', 'admin'),
    ]);
    setBlasts((b as Blast[]) ?? []); setPromos((p as Promo[]) ?? []); setMerchants((m as Merchant[]) ?? []); setCities((c as City[]) ?? []); setUsers(count ?? 0);
  }, []);
  useEffect(() => { load(); }, [load]);
  const set = (k: keyof typeof f) => (v: string) => setF((p) => ({ ...p, [k]: v }));
  const pickPromo = (p: Promo) => setF((x) => ({ ...x, promo_code: p.code, title: x.title || (p.title ?? p.code), body: x.body || (p.description ?? ''), image_url: x.image_url || (p.image_url ?? '') }));
  const pickMerchant = (m: Merchant) => setF((x) => ({ ...x, merchant_id: m.id, title: x.title || `Promo dari ${m.name}`, image_url: x.image_url || (m.image_url ?? '') }));
  const send = async () => {
    if (f.title.trim().length < 4) return toast.error('Judul minimal 4 huruf');
    if (f.target === 'city' && !f.city_id) return toast.error('Pilih kota');
    setBusy(true);
    try { const b = await rpc<Blast>('admin_blast_promo', { p: { ...f, merchant_id: f.merchant_id || null, promo_code: f.promo_code || null, image_url: f.image_url || null, city_id: f.city_id || null } }); toast.success(`Terkirim ke ${b.sent_count} pengguna`); setF({ title: '', body: '', image_url: '', promo_code: '', merchant_id: '', target: 'all', city_id: '' }); load(); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  const preview: Promo = { code: f.promo_code || 'PROMO', title: f.title || 'Judul promo', description: f.body, discount_type: 'fixed', value: 0, max_discount: null, min_total: 0, service: null, quota: null, used_count: 0, valid_from: null, valid_to: null, is_active: true, image_url: f.image_url || null };

  return (
    <AdminPage title="Blast Promo" subtitle="Satu arah: admin → kotak masuk pelanggan (notifikasi dalam aplikasi, realtime)" onRefresh={load}>
      <Row gap={adminSpace.lg} style={{ flexWrap: 'wrap' }}>
        <StatCard label="Pengguna aktif" icon="people-outline" value={users} color={adminTone.blue} index={0} />
        <StatCard label="Blast terkirim" icon="megaphone-outline" value={blasts.length} color={adminTone.orange} index={1} />
        <StatCard label="Total notifikasi" icon="notifications-outline" value={blasts.reduce((a, b) => a + b.sent_count, 0)} color={adminTone.green} index={2} />
      </Row>
      <Row gap={16} style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <Card style={{ flex: 1.3, minWidth: 340, gap: 12 }}>
          <Text style={font.label}>Susun pesan</Text>
          <Text style={font.tiny}>Ambil dari promo aktif atau merchant yang sedang promo — judul, gambar, dan kode terisi otomatis.</Text>
          <Row gap={adminSpace.sm} style={{ flexWrap: 'wrap' }}>
            <AdminSelect label="Ambil dari promo aktif" icon="pricetag-outline" placeholder="Pilih kode promo" width={220} value={f.promo_code}
              options={promos.map((p) => ({ value: p.code, label: p.code, sublabel: p.title ?? undefined }))}
              onChange={(v) => { const p = promos.find((x) => x.code === v); if (p) pickPromo(p); }} />
            <AdminSelect label="Ambil dari merchant" icon="storefront-outline" placeholder="Pilih merchant" width={240} value={f.merchant_id}
              options={merchants.map((m) => ({ value: m.id, label: m.name, sublabel: m.category }))}
              onChange={(v) => { const m = merchants.find((x) => x.id === v); if (m) pickMerchant(m); }} />
          </Row>
          <Input label="Judul" placeholder="Diskon 20% Sate Padang Mak Syukur hari ini!" value={f.title} onChangeText={set('title')} />
          <Input label="Isi pesan" placeholder="Berlaku s.d. 21.00 WIB, pakai kode MAKANENAK" value={f.body} onChangeText={set('body')} multiline style={{ minHeight: 70 }} />
          <Row gap={10}>
            <Input label="Kode promo (opsional)" value={f.promo_code} onChangeText={(v) => set('promo_code')(v.toUpperCase())} containerStyle={{ flex: 1 }} autoCapitalize="characters" />
            <Input label="URL gambar (opsional)" value={f.image_url} onChangeText={set('image_url')} containerStyle={{ flex: 2 }} />
          </Row>
          <DocUpload label="Unggah gambar banner (16:9)" value={f.image_url.startsWith('http') ? '' : f.image_url} onChange={(p) => set('image_url')(p)} bucket="promo-images" color={colors.accent} />
          <Row gap={adminSpace.sm} style={{ flexWrap: 'wrap' }}>
            <AdminSelect label="Target penerima" icon="people-outline" width={230} value={f.target}
              options={TARGETS.map((t) => ({ value: t.key, label: t.label }))} onChange={(v) => set('target')(v)} />
            {f.target === 'city' ? (
              <AdminSelect label="Kota" icon="location-outline" placeholder="Pilih kota" width={200} value={f.city_id}
                options={cities.map((c) => ({ value: c.id, label: c.name, sublabel: c.province ?? undefined }))} onChange={(v) => set('city_id')(v)} />
            ) : null}
          </Row>
          <Button title="Kirim blast sekarang" icon="send" color={colors.accent} loading={busy} onPress={send} />
          <Text style={font.tiny}>Pelanggan tidak bisa membalas (satu arah). Jangan kirim lebih dari 1–2 blast per hari agar tidak dianggap spam.</Text>
        </Card>
        <View style={{ flex: 1, minWidth: 280, gap: 8 }}>
          <Text style={font.label}>Pratinjau di kotak masuk pelanggan</Text>
          <PromoCard promo={preview} width={280} />
          <View style={s.notif}>
            <Text style={font.h3}>{f.title || 'Judul promo'}</Text>
            <Text style={font.small}>{f.body || 'Isi pesan…'}</Text>
            <Row gap={6}>{f.promo_code ? <Badge text={`Kode: ${f.promo_code}`} color={colors.accent} /> : null}{f.merchant_id ? <Badge text="Lihat merchant →" color={colors.food} /> : null}</Row>
          </View>
        </View>
      </Row>
      <Card padded={false}>
        <View style={{ padding: 14 }}><Text style={font.label}>Riwayat blast</Text></View>
        <Table rows={blasts as unknown as Record<string, unknown>[]} columns={[
          { key: 'created_at', label: 'Waktu', width: 150, render: (r) => <Text style={font.tiny}>{fmtDate(String(r.created_at))}</Text> },
          { key: 'title', label: 'Judul', width: 260, render: (r) => <View style={{ minWidth: 0, alignSelf: 'stretch' }}><Text style={font.bodyStrong} numberOfLines={1}>{String(r.title)}</Text><Text style={font.tiny} numberOfLines={1}>{String(r.body ?? '')}</Text></View> },
          { key: 'promo_code', label: 'Kode', width: 110, render: (r) => <Text style={font.small}>{String(r.promo_code ?? '—')}</Text> },
          { key: 'target', label: 'Target', width: 120, render: (r) => <Badge text={TARGETS.find((t) => t.key === r.target)?.label ?? String(r.target)} color={colors.info} /> },
          { key: 'sent_count', label: 'Terkirim', width: 90, align: 'right', mono: true, render: (r) => <Text style={font.mono}>{String(r.sent_count)}</Text> },
        ]} emptyText="Belum ada blast" />
      </Card>
      <WideTableHint />
    </AdminPage>
  );
}
const s = StyleSheet.create({ notif: { gap: 4, padding: adminSpace.md, borderRadius: adminRadius.card, backgroundColor: adminTone.surface, borderWidth: 1, borderColor: adminTone.border } });
