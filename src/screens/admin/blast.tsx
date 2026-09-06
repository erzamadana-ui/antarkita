// Admin · Blast Promo — kirim promo merchant/promo kode ke kotak masuk pelanggan (satu arah admin → pelanggan)
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { AdminPage, Table, StatCard, adminFont as font, adminTone, AdminCard as Card } from '@/components/admin';
import { Row, Input, Button, Chip, Badge, toast } from '@/components/ui';
import { PromoCard } from '@/components/PromoCard';
import { DocUpload } from '@/components/DocUpload';
import { rpc, supabase } from '@/lib/supabase';
import { colors, radius } from '@/lib/theme';
import { formatDate } from '@/lib/format';
import type { Blast, City, Merchant, Promo } from '@/lib/types';

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
      <Row gap={12} style={{ flexWrap: 'wrap' }}>
        <StatCard label="Pengguna aktif" value={users} color={colors.info} index={0} />
        <StatCard label="Blast terkirim" value={blasts.length} color={colors.accent} index={1} />
        <StatCard label="Total notifikasi" value={blasts.reduce((a, b) => a + b.sent_count, 0)} color={colors.success} index={2} />
      </Row>
      <Row gap={16} style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <Card style={{ flex: 1.3, minWidth: 340, gap: 12 }}>
          <Text style={font.label}>Susun pesan</Text>
          <Text style={font.tiny}>Ambil dari promo aktif atau merchant yang sedang promo — judul, gambar, dan kode terisi otomatis.</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>{promos.map((p) => <Chip key={p.code} label={p.code} active={f.promo_code === p.code} onPress={() => pickPromo(p)} color={colors.accent} />)}</ScrollView>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>{merchants.map((m) => <Chip key={m.id} label={m.name} active={f.merchant_id === m.id} onPress={() => pickMerchant(m)} color={colors.food} />)}</ScrollView>
          <Input label="Judul" placeholder="Diskon 20% Sate Padang Mak Syukur hari ini!" value={f.title} onChangeText={set('title')} />
          <Input label="Isi pesan" placeholder="Berlaku s.d. 21.00 WIB, pakai kode MAKANENAK" value={f.body} onChangeText={set('body')} multiline style={{ minHeight: 70 }} />
          <Row gap={10}>
            <Input label="Kode promo (opsional)" value={f.promo_code} onChangeText={(v) => set('promo_code')(v.toUpperCase())} containerStyle={{ flex: 1 }} autoCapitalize="characters" />
            <Input label="URL gambar (opsional)" value={f.image_url} onChangeText={set('image_url')} containerStyle={{ flex: 2 }} />
          </Row>
          <DocUpload label="Unggah gambar banner (16:9)" value={f.image_url.startsWith('http') ? '' : f.image_url} onChange={(p) => set('image_url')(p)} bucket="promo-images" color={colors.accent} />
          <Text style={font.label}>Target penerima</Text>
          <Row gap={8} style={{ flexWrap: 'wrap' }}>{TARGETS.map((t) => <Chip key={t.key} label={t.label} active={f.target === t.key} onPress={() => set('target')(t.key)} />)}</Row>
          {f.target === 'city' && <Row gap={8} style={{ flexWrap: 'wrap' }}>{cities.map((c) => <Chip key={c.id} label={c.name} active={f.city_id === c.id} onPress={() => set('city_id')(c.id)} color={colors.info} />)}</Row>}
          <Button title="Kirim blast sekarang" icon="send" color={colors.accent} loading={busy} onPress={send} />
          <Text style={font.tiny}>Pelanggan tidak bisa membalas (satu arah). Jangan kirim lebih dari 1–2 blast per hari agar tidak dianggap spam.</Text>
        </Card>
        <View style={{ flex: 1, minWidth: 280, gap: 8 }}>
          <Text style={font.label}>Pratinjau di kotak masuk pelanggan</Text>
          <PromoCard promo={preview} width={280} />
          <View style={s.notif}>
            <Text style={{ fontWeight: '800', color: colors.text }}>{f.title || 'Judul promo'}</Text>
            <Text style={font.small}>{f.body || 'Isi pesan…'}</Text>
            <Row gap={6}>{f.promo_code ? <Badge text={`Kode: ${f.promo_code}`} color={colors.accent} /> : null}{f.merchant_id ? <Badge text="Lihat merchant →" color={colors.food} /> : null}</Row>
          </View>
        </View>
      </Row>
      <Card padded={false}>
        <View style={{ padding: 14 }}><Text style={font.label}>Riwayat blast</Text></View>
        <Table rows={blasts as unknown as Record<string, unknown>[]} columns={[
          { key: 'created_at', label: 'Waktu', width: 150, render: (r) => <Text style={font.tiny}>{formatDate(String(r.created_at))}</Text> },
          { key: 'title', label: 'Judul', width: 260, render: (r) => <View><Text style={{ fontWeight: '700' }}>{String(r.title)}</Text><Text style={font.tiny} numberOfLines={1}>{String(r.body ?? '')}</Text></View> },
          { key: 'promo_code', label: 'Kode', width: 110, render: (r) => <Text style={font.small}>{String(r.promo_code ?? '—')}</Text> },
          { key: 'target', label: 'Target', width: 120, render: (r) => <Badge text={TARGETS.find((t) => t.key === r.target)?.label ?? String(r.target)} color={colors.info} /> },
          { key: 'sent_count', label: 'Terkirim', width: 90, render: (r) => <Text style={{ fontWeight: '800' }}>{String(r.sent_count)}</Text> },
        ]} emptyText="Belum ada blast" />
      </Card>
    </AdminPage>
  );
}
const s = StyleSheet.create({ notif: { gap: 4, padding: 12, borderRadius: radius.lg, backgroundColor: adminTone.surface, borderWidth: 1, borderColor: adminTone.border } });
