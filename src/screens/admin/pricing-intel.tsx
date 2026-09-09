// Intelijen harga: harga kompetitor (input admin), sesi harga high/middle/low, dan usulan penyesuaian tarif.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Switch, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { LinearTransition } from 'react-native-reanimated';
import { AdminPage, StatCard, Table, FilterBar, AdminSelect, adminFont as font, adminTone, adminSpace, adminRadius, adminIcon, AdminCard as Card } from '@/components/admin';
import { Row, Input, Button, Badge, Chip, toast } from '@/components/ui';
import { Entrance, PressableScale, ProgressBar } from '@/components/motion';
import { supabase, rpc } from '@/lib/supabase';
import { colors } from '@/lib/theme';
import { serviceLabel, rupiah } from '@/lib/format';
import type { CompetitorPrice, PricingSession, ServiceType } from '@/lib/types';
import { WideTableHint } from './_shared';

type Suggestion = { service: ServiceType; level: 'low' | 'middle' | 'high'; km: number; our_fare: number; competitor_avg: number | null; competitor_n: number; suggested_fare: number; suggested_multiplier: number; driver_earning: number; platform_revenue: number; driver_now: number; platform_now: number };
const LEVELS = [{ key: 'high', label: 'High (sibuk)', color: colors.danger }, { key: 'middle', label: 'Middle (normal)', color: colors.info }, { key: 'low', label: 'Low (sepi)', color: colors.success }] as const;
const DAYS = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
const SERVICES: ServiceType[] = ['ride_motor', 'ride_car', 'food', 'send', 'shop'];
const emptyComp = { competitor: '', service: 'ride_motor' as ServiceType, base_fare: '0', per_km: '', min_fare: '', level: 'middle' as 'low' | 'middle' | 'high', source: '' };
const emptySession = { name: '', level: 'high' as 'low' | 'middle' | 'high', days: [1, 2, 3, 4, 5], start_time: '16:30', end_time: '19:30', multiplier: '1.25', driver_bonus_pct: '5', note: '' };

export default function PricingIntel() {
  const [comps, setComps] = useState<CompetitorPrice[]>([]);
  const [sessions, setSessions] = useState<PricingSession[]>([]);
  const [sugg, setSugg] = useState<Suggestion[]>([]);
  const [km, setKm] = useState('3');
  const [svc, setSvc] = useState<string>('ride_motor');
  const [nc, setNc] = useState({ ...emptyComp });
  const [ns, setNs] = useState({ ...emptySession });
  const [current, setCurrent] = useState<PricingSession | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [{ data: c }, { data: s }, cur] = await Promise.all([
      supabase.from('competitor_prices').select('*').order('captured_at', { ascending: false }),
      supabase.from('pricing_sessions').select('*').order('start_time'),
      rpc<PricingSession | null>('current_pricing_session').catch(() => null),
    ]);
    setComps((c as CompetitorPrice[]) ?? []); setSessions((s as PricingSession[]) ?? []); setCurrent(cur && (cur as PricingSession).id ? (cur as PricingSession) : null);
    try { const r = await rpc<Suggestion[]>('pricing_suggestions', { p_km: Number(km) || 3 }); setSugg(Array.isArray(r) ? r : []); } catch (e) { toast.error((e as Error).message); }
  }, [km]);
  useEffect(() => { load(); }, [load]);

  const addComp = async () => {
    if (!nc.competitor || !nc.per_km) return toast.error('Nama kompetitor & tarif per km wajib');
    const { error } = await supabase.from('competitor_prices').insert({ competitor: nc.competitor, service: nc.service, base_fare: Number(nc.base_fare) || 0, per_km: Number(nc.per_km), min_fare: Number(nc.min_fare) || 0, level: nc.level, source: nc.source || null });
    if (error) return toast.error(error.message);
    setNc({ ...emptyComp }); toast.success('Harga kompetitor dicatat'); load();
  };
  const delComp = async (id: string) => { await supabase.from('competitor_prices').delete().eq('id', id); load(); };

  const addSession = async () => {
    if (!ns.name) return toast.error('Nama sesi wajib');
    const { error } = await supabase.from('pricing_sessions').insert({ name: ns.name, level: ns.level, days: ns.days, start_time: ns.start_time, end_time: ns.end_time, multiplier: Number(ns.multiplier) || 1, driver_bonus_pct: Number(ns.driver_bonus_pct) || 0, note: ns.note || null, active: true });
    if (error) return toast.error(error.message);
    setNs({ ...emptySession }); toast.success('Sesi harga ditambahkan'); load();
  };
  const toggleSession = async (s: PricingSession) => { await supabase.from('pricing_sessions').update({ active: !s.active }).eq('id', s.id); load(); };
  const delSession = async (id: string) => { await supabase.from('pricing_sessions').delete().eq('id', id); load(); };
  const applySuggestion = async (sg: Suggestion) => {
    // terapkan multiplier usulan ke semua sesi aktif dengan level yang sama (untuk layanan ini)
    const targets = sessions.filter((s) => s.level === sg.level);
    if (targets.length === 0) return toast.error(`Belum ada sesi ${sg.level}. Tambahkan sesi dulu.`);
    for (const s of targets) await supabase.from('pricing_sessions').update({ multiplier: sg.suggested_multiplier }).eq('id', s.id);
    toast.success(`Multiplier ${sg.suggested_multiplier}× diterapkan ke ${targets.length} sesi ${sg.level}`); load();
  };

  const shown = sugg.filter((x) => x.service === svc);
  const compShown = comps.filter((c) => c.service === svc);

  return (
    <AdminPage title="Intelijen Harga" subtitle="Bandingkan tarif dengan kompetitor & atur sesi harga high/middle/low" onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} refreshing={refreshing}>
      <Row gap={adminSpace.lg} style={{ flexWrap: 'wrap' }}>
        <StatCard index={1} icon="flash-outline" label="Sesi aktif sekarang" value={current ? `${current.name} · ${current.multiplier}×` : 'Normal (1×)'} hint={current ? `Level ${current.level} · bonus driver ${current.driver_bonus_pct}%` : 'Tidak ada sesi yang cocok'} color={current?.level === 'high' ? adminTone.red : current?.level === 'low' ? adminTone.green : adminTone.blue} />
        <StatCard index={2} icon="bar-chart-outline" label="Data kompetitor" value={comps.length} hint="90 hari terakhir dipakai untuk usulan" color={adminTone.orange} />
        <StatCard index={3} icon="time-outline" label="Sesi harga" value={sessions.filter((s) => s.active).length} hint={`${sessions.length} total`} color={adminTone.teal} />
      </Row>

      {/* Usulan */}
      <Entrance index={1}><Card style={{ gap: 12 }}>
        <Row between style={{ flexWrap: 'wrap', gap: 8 }}>
          <View style={{ flex: 1, minWidth: 240 }}><Text style={font.h2}>Usulan penyesuaian tarif</Text><Text style={font.tiny}>Strategi: low 5% di bawah kompetitor, middle setara, high 3% di bawah (tetap unggul saat sibuk). Bonus driver diambil dari komisi platform.</Text></View>
          <Row gap={8}><Text style={font.small}>Simulasi jarak</Text><Input value={km} onChangeText={setKm} keyboardType="decimal-pad" containerStyle={{ width: 96 }} /><Text style={font.small}>km</Text></Row>
        </Row>
        <FilterBar value={svc} onChange={setSvc} options={SERVICES.map((k) => ({ key: k, label: serviceLabel[k] }))} />
        <Row gap={12} style={{ flexWrap: 'wrap', alignItems: 'stretch' }}>
          {LEVELS.map((lv) => {
            const sg = shown.find((x) => x.level === lv.key);
            if (!sg) return null;
            const diff = sg.suggested_fare - sg.our_fare;
            return (
              <Animated.View key={lv.key} layout={LinearTransition.springify().stiffness(280).damping(20)} style={[s.sugg, { borderColor: lv.color + '66' }]}>
                <Row between><Badge text={lv.label} color={lv.color} />{sg.competitor_n > 0 ? <Text style={font.tiny}>{sg.competitor_n} data kompetitor</Text> : <Text style={[font.tiny, { color: colors.warning }]}>tanpa data kompetitor</Text>}</Row>
                <Row between style={{ marginTop: 8 }}><Text style={font.small}>Tarif kita ({sg.km} km)</Text><Text style={font.mono}>{rupiah(sg.our_fare)}</Text></Row>
                <Row between><Text style={font.small}>Rata-rata kompetitor</Text><Text style={font.mono}>{sg.competitor_avg ? rupiah(Math.round(sg.competitor_avg)) : '—'}</Text></Row>
                <View style={s.suggBox}>
                  <Text style={font.tiny}>USULAN</Text>
                  <Row between><Text style={[font.num, { color: lv.color }]} numberOfLines={1}>{rupiah(sg.suggested_fare)}</Text><Badge text={`${sg.suggested_multiplier}×`} color={lv.color} /></Row>
                  <Text style={[font.tiny, { color: diff >= 0 ? colors.success : colors.danger }]}>{diff >= 0 ? '+' : ''}{rupiah(diff)} vs sekarang</Text>
                </View>
                <Row between style={{ marginTop: 6 }}><Text style={font.tiny}>Driver dapat</Text><Text style={font.tiny}>{rupiah(sg.driver_now)} → <Text style={{ fontWeight: '700', color: adminTone.ink }}>{rupiah(sg.driver_earning)}</Text></Text></Row>
                <ProgressBar progress={sg.driver_earning / Math.max(sg.suggested_fare, 1)} color={colors.ride} height={4} />
                <Row between style={{ marginTop: 4 }}><Text style={font.tiny}>Platform dapat</Text><Text style={font.tiny}>{rupiah(sg.platform_now)} → <Text style={{ fontWeight: '700', color: adminTone.ink }}>{rupiah(sg.platform_revenue)}</Text></Text></Row>
                <Button title={`Terapkan ke sesi ${lv.key}`} size="sm" color={lv.color} style={{ marginTop: 8 }} onPress={() => applySuggestion(sg)} />
              </Animated.View>
            );
          })}
        </Row>
      </Card></Entrance>

      {/* Sesi harga */}
      <Entrance index={2}><Card style={{ gap: 10 }}>
        <Text style={font.h2}>Sesi harga (waktu tertentu)</Text>
        <Text style={font.tiny}>Multiplier dikalikan ke tarif dasar saat jam tersebut (WIB). Level high diprioritaskan jika tumpang tindih.</Text>
        {sessions.map((sess) => (
          <Row key={sess.id} between style={s.sessRow}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Row gap={8}><Text style={font.h3}>{sess.name}</Text><Badge text={sess.level} color={sess.level === 'high' ? colors.danger : sess.level === 'low' ? colors.success : colors.info} />{current?.id === sess.id && <Badge text="AKTIF SEKARANG" color={colors.primary} />}</Row>
              <Text style={font.tiny}>{(sess.days ?? []).map((d) => DAYS[d]).join(', ')} · {String(sess.start_time ?? "").slice(0, 5)}–{String(sess.end_time ?? "").slice(0, 5)} · {sess.multiplier}× · bonus driver {sess.driver_bonus_pct}%{sess.note ? ` · ${sess.note}` : ''}</Text>
            </View>
            <Row gap={8}>
              <Switch value={sess.active} onValueChange={() => toggleSession(sess)} trackColor={{ true: colors.success, false: colors.border }} thumbColor="#fff" />
              <PressableScale onPress={() => delSession(sess.id)} scaleTo={0.9} haptic={false}><Ionicons name="trash-outline" size={adminIcon.lg} color={colors.danger} /></PressableScale>
            </Row>
          </Row>
        ))}
        <View style={s.form}>
          <Text style={font.label}>Tambah sesi</Text>
          <Row gap={8} style={{ flexWrap: 'wrap' }}>
            <Input placeholder="Nama sesi (mis. Hujan sore)" value={ns.name} onChangeText={(v) => setNs({ ...ns, name: v })} containerStyle={{ flex: 1, minWidth: 180 }} />
            <AdminSelect label="Level" icon="speedometer-outline" width={180} value={ns.level}
              options={LEVELS.map((lv) => ({ value: lv.key, label: lv.label, color: lv.color }))}
              onChange={(v) => setNs({ ...ns, level: v as 'low' | 'middle' | 'high' })} />
          </Row>
          <Row gap={6} style={{ flexWrap: 'wrap' }}>{DAYS.map((d, i) => <Chip key={d} label={d} active={ns.days.includes(i)} onPress={() => setNs({ ...ns, days: ns.days.includes(i) ? ns.days.filter((x) => x !== i) : [...ns.days, i].sort() })} />)}</Row>
          <Row gap={8} style={{ flexWrap: 'wrap' }}>
            <Input label="Mulai (HH:MM)" value={ns.start_time} onChangeText={(v) => setNs({ ...ns, start_time: v })} containerStyle={{ width: 120 }} />
            <Input label="Selesai" value={ns.end_time} onChangeText={(v) => setNs({ ...ns, end_time: v })} containerStyle={{ width: 120 }} />
            <Input label="Multiplier" value={ns.multiplier} keyboardType="decimal-pad" onChangeText={(v) => setNs({ ...ns, multiplier: v })} containerStyle={{ width: 100 }} />
            <Input label="Bonus driver %" value={ns.driver_bonus_pct} keyboardType="decimal-pad" onChangeText={(v) => setNs({ ...ns, driver_bonus_pct: v })} containerStyle={{ width: 120 }} />
          </Row>
          <Button title="Tambah sesi" size="sm" onPress={addSession} />
        </View>
      </Card></Entrance>

      {/* Kompetitor */}
      <Entrance index={3}><Card style={{ gap: 10 }}>
        <Text style={font.h2}>Harga kompetitor — {serviceLabel[svc as ServiceType]}</Text>
        <Text style={font.tiny}>Catat hasil survei tarif dari aplikasi kompetitor (cek estimasi untuk rute yang sama pada jam sibuk/normal/sepi). Data &gt; 90 hari tidak dipakai.</Text>
        <Table rows={compShown as unknown as Record<string, unknown>[]} emptyText="Belum ada data kompetitor untuk layanan ini" columns={[
          { key: 'competitor', label: 'Kompetitor', width: 140 },
          { key: 'level', label: 'Sesi', width: 90, render: (r) => <Badge text={String(r.level)} color={r.level === 'high' ? colors.danger : r.level === 'low' ? colors.success : colors.info} /> },
          { key: 'base_fare', label: 'Dasar', width: 100, render: (r) => <Text style={font.small}>{rupiah(Number(r.base_fare))}</Text> },
          { key: 'per_km', label: 'Per km', width: 100, render: (r) => <Text style={font.small}>{rupiah(Number(r.per_km))}</Text> },
          { key: 'min_fare', label: 'Minimal', width: 100, render: (r) => <Text style={font.small}>{rupiah(Number(r.min_fare))}</Text> },
          { key: 'captured_at', label: 'Tanggal', width: 110 },
          { key: 'source', label: 'Sumber', width: 220, render: (r) => <Text style={font.tiny} numberOfLines={2}>{String(r.source ?? '-')}</Text> },
          { key: 'x', label: '', width: 50, render: (r) => <PressableScale onPress={() => delComp(String(r.id))} scaleTo={0.9} haptic={false}><Ionicons name="trash-outline" size={adminIcon.lg} color={colors.danger} /></PressableScale> },
        ]} />
        <View style={s.form}>
          <Text style={font.label}>Catat harga kompetitor</Text>
          <Row gap={8} style={{ flexWrap: 'wrap' }}>
            <Input placeholder="Nama kompetitor" value={nc.competitor} onChangeText={(v) => setNc({ ...nc, competitor: v })} containerStyle={{ flex: 1, minWidth: 160 }} />
            <AdminSelect label="Layanan" icon="layers-outline" width={190} value={nc.service}
              options={SERVICES.map((k) => ({ value: k, label: serviceLabel[k] }))} onChange={(v) => setNc({ ...nc, service: v as ServiceType })} />
          </Row>
          <Row gap={8} style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <AdminSelect label="Sesi" icon="speedometer-outline" width={180} value={nc.level}
              options={LEVELS.map((lv) => ({ value: lv.key, label: lv.label, color: lv.color }))} onChange={(v) => setNc({ ...nc, level: v as 'low' | 'middle' | 'high' })} />
            <Input label="Tarif dasar" value={nc.base_fare} keyboardType="number-pad" onChangeText={(v) => setNc({ ...nc, base_fare: v })} containerStyle={{ width: 110 }} />
            <Input label="Per km" value={nc.per_km} keyboardType="number-pad" onChangeText={(v) => setNc({ ...nc, per_km: v })} containerStyle={{ width: 110 }} />
            <Input label="Minimal" value={nc.min_fare} keyboardType="number-pad" onChangeText={(v) => setNc({ ...nc, min_fare: v })} containerStyle={{ width: 110 }} />
          </Row>
          <Input placeholder="Sumber (mis. cek aplikasi X, rute A→B, 17:30)" value={nc.source} onChangeText={(v) => setNc({ ...nc, source: v })} />
          <Button title="Simpan harga kompetitor" size="sm" color={colors.accent} onPress={addComp} />
        </View>
      </Card></Entrance>
      <WideTableHint />
    </AdminPage>
  );
}

const s = StyleSheet.create({
  sugg: { flex: 1, minWidth: 240, borderWidth: 1, borderRadius: adminRadius.card, padding: adminSpace.md, backgroundColor: adminTone.surface },
  suggBox: { marginTop: 8, padding: 10, borderRadius: adminRadius.md, backgroundColor: adminTone.surfaceAlt, borderWidth: 1, borderColor: adminTone.border },
  sessRow: { paddingVertical: 10, borderTopWidth: 1, borderTopColor: adminTone.border },
  form: { gap: 10, padding: adminSpace.md, borderRadius: adminRadius.card, backgroundColor: adminTone.surfaceAlt, borderWidth: 1, borderColor: adminTone.border, marginTop: 6 },
});
