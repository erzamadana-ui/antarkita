// Admin · Rate Card AntarTravel (migrasi 0124, keputusan GM 7).
// Tabel rpc('admin_travel_rate_cards') → kartu per model mobil (Rp/km, tarif dasar, minimum, porsi mitra, komisi, biaya platform,
// pengali carter, kursi, aktif) + partners_matched & contoh PKU→PDG. Ubah/tambah lewat rpc('admin_set_travel_rate_card', { p })
// (izin pricing + PIN; porsi mitra < driver_min_share_pct ditolak server). Kalkulator contoh memanggil rpc('travel_quote').
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { AdminPage, Panel, DataTable, StatCard, AdminSelect, AdminDialog, Pill, RequirePerm, adminFont as font, adminTone, adminSpace, adminRadius } from '@/components/admin';
import { FootNote } from '@/components/reports';
import { Row, Input, Button, toast } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { rupiah } from '@/lib/format';
import { handleAdminError, useAdminSecurity } from '@/store/adminSecurity';
import { ErrorNote, fmtDate, parseNum, Trunc, WideTableHint } from './_shared';
import { adminTravelRateCards, adminSetTravelRateCard, travelQuote, type TravelRateCard, type TravelQuote, type SetTravelRateCardInput } from '@/lib/admin31';

type CityOpt = { id: string; name: string; province: string | null; service_status: string | null };
const n0 = (v: unknown) => Number(v ?? 0) || 0;
const DRIVER_MIN_SHARE_DEFAULT = 80;

type CardForm = {
  id: string | null; vehicle_model: string; match_regex: string; seats: string; per_km: string; base_fare: string; min_fare: string;
  driver_share_pct: string; platform_fee_pct: string; platform_fee_flat: string; charter_multiplier: string; sort_order: string; active: boolean; note: string;
};
const emptyForm = (): CardForm => ({ id: null, vehicle_model: '', match_regex: '', seats: '7', per_km: '', base_fare: '25000', min_fare: '150000', driver_share_pct: '85', platform_fee_pct: '10', platform_fee_flat: '5000', charter_multiplier: '1', sort_order: '100', active: true, note: '' });
const formFrom = (c: TravelRateCard): CardForm => ({
  id: c.id, vehicle_model: c.vehicle_model, match_regex: c.match_regex ?? '', seats: String(c.seats), per_km: String(c.per_km), base_fare: String(c.base_fare), min_fare: String(c.min_fare),
  driver_share_pct: String(c.driver_share_pct), platform_fee_pct: String(c.platform_fee_pct), platform_fee_flat: String(c.platform_fee_flat), charter_multiplier: String(c.charter_multiplier),
  sort_order: String(c.sort_order), active: !!c.active, note: c.note ?? '',
});

export default function AdminRateCardTravel() {
  const router = useRouter();
  const [rows, setRows] = useState<TravelRateCard[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<CardForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [minShare, setMinShare] = useState<number>(DRIVER_MIN_SHARE_DEFAULT);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await adminTravelRateCards()); setErr(null); }
    catch (e) { setRows([]); setErr(`Rate card travel: ${(e as Error).message}`); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    supabase.from('app_settings').select('value').eq('key', 'driver_min_share_pct').maybeSingle().then(({ data }) => { const v = Number(String((data as { value?: unknown } | null)?.value ?? '').replace(/"/g, '')); if (Number.isFinite(v) && v > 0) setMinShare(v); });
  }, []);

  const active = rows.filter((r) => r.active);
  const cheapest = active.length ? active.reduce((a, b) => (b.per_km < a.per_km ? b : a)) : null;
  const floor = rows[0]?.fare_floor_per_km ?? null;
  const belowFloor = rows.filter((r) => r.active && floor != null && n0(r.driver_net_per_km) < n0(floor)).length;
  const sample = rows.find((r) => r.sample_pku_pdg)?.sample_pku_pdg ?? null;

  const save = async () => {
    if (!form) return;
    const model = form.vehicle_model.trim();
    if (model.length < 3) return toast.error('Nama model minimal 3 huruf');
    const seats = parseNum(form.seats), perKm = parseNum(form.per_km), base = parseNum(form.base_fare), min = parseNum(form.min_fare);
    if (!Number.isInteger(seats) || seats < 1 || seats > 60) return toast.error('Kursi harus bilangan bulat 1–60');
    if (!Number.isInteger(perKm) || perKm < 500 || perKm > 100_000) return toast.error('Tarif per km harus bilangan bulat Rp500–Rp100.000');
    if (!Number.isInteger(base) || base < 0 || base > 10_000_000) return toast.error('Tarif dasar harus bilangan bulat Rp0–Rp10 juta');
    if (!Number.isInteger(min) || min < 0 || min > 50_000_000) return toast.error('Tarif minimum harus bilangan bulat Rp0–Rp50 juta');
    const share = parseNum(form.driver_share_pct), feePct = parseNum(form.platform_fee_pct), feeFlat = parseNum(form.platform_fee_flat), mult = parseNum(form.charter_multiplier), sort = parseNum(form.sort_order);
    if (!Number.isFinite(share) || share < minShare || share > 100) return toast.error(`Porsi mitra harus ${minShare}–100 % (kebijakan driver_min_share_pct — keputusan GM 8)`);
    if (!Number.isFinite(feePct) || feePct < 0 || feePct > 100 - minShare) return toast.error(`Komisi platform harus 0–${100 - minShare} % agar porsi mitra ≥ ${minShare} %`);
    if (!Number.isInteger(feeFlat) || feeFlat < 0 || feeFlat > 1_000_000) return toast.error('Biaya platform tetap harus bilangan bulat Rp0–Rp1 juta');
    if (!Number.isFinite(mult) || mult < 0.5 || mult > 5) return toast.error('Pengali carter harus 0,5–5');
    if (!Number.isInteger(sort) || sort < 0 || sort > 10_000) return toast.error('Urutan harus bilangan bulat 0–10.000');
    if (form.match_regex.trim()) { try { new RegExp(form.match_regex.trim()); } catch { return toast.error('Regex pencocokan tidak valid'); } }
    if (!(await useAdminSecurity.getState().ensureUnlocked())) return;
    setBusy(true);
    try {
      const p: SetTravelRateCardInput = {
        vehicle_model: model, match_regex: form.match_regex.trim() || null, seats, per_km: perKm, base_fare: base, min_fare: min,
        driver_share_pct: share, platform_fee_pct: feePct, platform_fee_flat: feeFlat, charter_multiplier: mult, sort_order: sort, active: form.active, note: form.note.trim() || null,
      };
      if (form.id) p.id = form.id;
      await adminSetTravelRateCard(p);
      toast.success(`Rate card ${model} disimpan (log travel.rate_card)`); setForm(null); await load();
    } catch (e) { handleAdminError(e); } finally { setBusy(false); }
  };
  const toggleActive = async (c: TravelRateCard) => {
    if (!(await useAdminSecurity.getState().ensureUnlocked())) return;
    setBusy(true);
    try { await adminSetTravelRateCard({ id: c.id, active: !c.active }); toast.success(`${c.vehicle_model} ${c.active ? 'dinonaktifkan' : 'diaktifkan'}`); await load(); }
    catch (e) { handleAdminError(e); } finally { setBusy(false); }
  };

  return (
    <AdminPage title="Rate Card AntarTravel" subtitle="Tarif antar kota per km menurut model mobil: tarif = max(dasar + km × Rp/km, minimum), dibulatkan ke atas Rp1.000; carter × pengali; per kursi = tarif mobil ÷ kursi × (1 + markup). Mitra boleh menyimpang ±toleransi; tawaran carter < ambang quote ditolak. Menyimpan butuh izin pricing + PIN." onRefresh={load}
      right={<Row gap={8} style={{ flexWrap: 'wrap' }}>
        <Button size="sm" variant="outline" title="Kebijakan Harga" icon="shield-checkmark-outline" onPress={() => router.push('/(admin)/kebijakan-harga' as never)} />
        <Button size="sm" variant="outline" title="Segarkan" icon="refresh-outline" onPress={load} />
      </Row>}>
      <ErrorNote text={err} onRetry={load} />

      <Row gap={adminSpace.md} style={{ flexWrap: 'wrap' }}>
        <StatCard index={0} icon="bus-outline" label="Rate card aktif" value={`${active.length}/${rows.length}`} hint={`${active.reduce((a, r) => a + n0(r.partners_matched), 0)} mitra travel approved tercocok`} color={adminTone.blue} />
        <StatCard index={1} icon="pricetag-outline" label="Termurah (default quote)" value={cheapest ? rupiah(cheapest.per_km) + '/km' : '—'} hint={cheapest ? `${cheapest.vehicle_model} · ${cheapest.seats} kursi · dipakai bila model tidak dikenal` : 'belum ada kartu aktif'} color={adminTone.teal} />
        <StatCard index={2} icon="trending-down-outline" label="Di bawah floor mitra" value={belowFloor} hint={floor != null ? `fare_floor_per_km_travel ${rupiah(n0(floor))}/km bersih mitra` : 'floor belum disetel'} color={belowFloor ? adminTone.red : adminTone.green} />
        <StatCard index={3} icon="navigate-outline" label="Contoh Pekanbaru → Padang" value={sample ? `${Number(sample.km).toLocaleString('id-ID', { maximumFractionDigits: 1 })} km` : '—'} hint={sample ? `sumber km: ${sample.km_source === 'route' ? 'rute aktif' : `haversine × ${sample.road_factor}`}` : 'kota PKU/PDG belum ada'} color={adminTone.violet} />
      </Row>

      <Panel title="Rate card per model" subtitle="Pencocokan model mitra memakai match_regex atas travel_partners.vehicle_model (admin dapat mematok kartu per mitra lewat travel_partners.rate_card_id). Bersih mitra/km = Rp/km × (100 − komisi) %." icon="bus-outline" padded={false}
        right={<RequirePerm perm={['pricing', 'ops']} fallback={<Text style={font.tiny}>Ubah: izin pricing + PIN</Text>}><Button size="sm" title="Tambah rate card" icon="add-outline" onPress={() => setForm(emptyForm())} /></RequirePerm>}>
        <DataTable keyField="id" rows={rows as unknown as Record<string, unknown>[]} emptyText={loading ? 'Memuat…' : err ? 'Tidak bisa membaca rate card — periksa koneksi/izin (view)' : 'Belum ada rate card — tambah dari tombol di kanan atas'} emptyIcon="bus-outline"
          columns={[
            { key: 'vehicle_model', label: 'Model', width: 190, render: (r) => { const c = r as unknown as TravelRateCard; return <View style={{ minWidth: 0, alignSelf: 'stretch' }}><Row gap={6}><Trunc style={font.bodyStrong} title={c.vehicle_model}>{c.vehicle_model}</Trunc>{!c.active ? <Pill text="nonaktif" tone="off" /> : null}</Row><Trunc style={font.tiny} title={c.match_regex ?? ''}>{c.seats} kursi · {c.match_regex ? `regex ${c.match_regex}` : 'tanpa regex'}</Trunc></View>; } },
            { key: 'per_km', label: 'Rp / km', width: 110, align: 'right', mono: true, render: (r) => <Text style={[font.mono, { fontWeight: '700' }]}>{rupiah(n0(r.per_km))}</Text> },
            { key: 'base_fare', label: 'Dasar · minimum', width: 170, align: 'right', mono: true, render: (r) => { const c = r as unknown as TravelRateCard; return <View style={{ alignItems: 'flex-end' }}><Text style={font.mono}>{rupiah(c.base_fare)}</Text><Text style={font.tiny}>min {rupiah(c.min_fare)}</Text></View>; } },
            { key: 'driver_share_pct', label: 'Porsi mitra · komisi', width: 150, align: 'right', mono: true, render: (r) => { const c = r as unknown as TravelRateCard; const low = n0(c.driver_share_pct) < minShare || 100 - n0(c.platform_fee_pct) < minShare; return <View style={{ alignItems: 'flex-end' }}><Text style={[font.mono, low && { color: adminTone.red }]}>{Number(c.driver_share_pct).toLocaleString('id-ID')} %</Text><Text style={font.tiny}>komisi {Number(c.platform_fee_pct).toLocaleString('id-ID')} % + {rupiah(c.platform_fee_flat)}</Text></View>; } },
            { key: 'driver_net_per_km', label: 'Bersih mitra / km', width: 140, align: 'right', mono: true, render: (r) => { const c = r as unknown as TravelRateCard; const bad = floor != null && n0(c.driver_net_per_km) < n0(floor); return <Text style={[font.mono, { color: bad ? adminTone.red : adminTone.green }]}>{rupiah(n0(c.driver_net_per_km))}</Text>; } },
            { key: 'charter_multiplier', label: 'Carter ×', width: 80, align: 'right', mono: true, render: (r) => <Text style={font.mono}>×{Number(r.charter_multiplier).toLocaleString('id-ID', { maximumFractionDigits: 2 })}</Text> },
            { key: 'partners_matched', label: 'Mitra', width: 70, align: 'right', mono: true, render: (r) => <Text style={font.mono}>{n0(r.partners_matched)}</Text> },
            { key: 'sample', label: 'PKU → PDG carter · per kursi', width: 200, align: 'right', mono: true, render: (r) => { const q = (r as unknown as TravelRateCard).sample_pku_pdg; if (!q) return <Text style={font.tiny}>—</Text>; return <View style={{ alignItems: 'flex-end' }}><Text style={font.mono}>{rupiah(n0(q.fare_total))}</Text><Text style={font.tiny}>per kursi {rupiah(n0(q.fare_per_seat))} · mitra {rupiah(n0(q.driver_net))}</Text></View>; } },
            { key: 'updated_at', label: 'Diperbarui', width: 120, render: (r) => <Text style={font.tiny}>{fmtDate(String(r.updated_at), false)}</Text> },
            { key: 'actions', label: 'Aksi', width: 200, align: 'right', render: (r) => { const c = r as unknown as TravelRateCard; return (
              <RequirePerm perm={['pricing', 'ops']} fallback={<Text style={font.tiny}>izin pricing</Text>}>
                <Row gap={6} style={{ justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                  <Button size="sm" variant="secondary" title="Ubah" icon="create-outline" disabled={busy} onPress={() => setForm(formFrom(c))} />
                  <Button size="sm" variant={c.active ? 'outline' : 'primary'} title={c.active ? 'Nonaktifkan' : 'Aktifkan'} icon={c.active ? 'pause-outline' : 'play-outline'} disabled={busy} onPress={() => toggleActive(c)} />
                </Row>
              </RequirePerm>
            ); } },
          ]} />
        <View style={{ padding: adminSpace.md, gap: 6 }}><WideTableHint what="kolom contoh & Aksi" /></View>
      </Panel>

      <QuoteCalculator cards={rows} />

      <AdminDialog visible={!!form} onClose={() => (busy ? undefined : setForm(null))} title={form?.id ? `Ubah rate card · ${form.vehicle_model}` : 'Tambah rate card'} width={680}
        subtitle={`Porsi mitra minimal ${minShare} % (driver_min_share_pct). Komisi platform dipotong dari tarif; biaya platform tetap ditagihkan ke pelanggan di atas tarif. Tersimpan lewat admin_set_travel_rate_card (log travel.rate_card).`}>
        {form ? (
          <View style={{ gap: 10 }}>
            <Row gap={8} style={{ flexWrap: 'wrap' }}>
              <Input label="Model mobil" value={form.vehicle_model} onChangeText={(v) => setForm({ ...form, vehicle_model: v })} placeholder="mis. Hiace Commuter" containerStyle={{ flex: 2, minWidth: 200 }} />
              <Input label="Regex pencocokan (opsional)" value={form.match_regex} autoCapitalize="none" onChangeText={(v) => setForm({ ...form, match_regex: v })} placeholder="mis. hi-?ace.*commuter" containerStyle={{ flex: 2, minWidth: 200 }} />
              <Input label="Kursi" value={form.seats} keyboardType="number-pad" onChangeText={(v) => setForm({ ...form, seats: v.replace(/\D/g, '') })} containerStyle={{ flex: 1, minWidth: 80 }} />
            </Row>
            <Row gap={8} style={{ flexWrap: 'wrap' }}>
              <Input label="Tarif per km (Rp)" value={form.per_km} keyboardType="number-pad" onChangeText={(v) => setForm({ ...form, per_km: v.replace(/\D/g, '') })} containerStyle={{ flex: 1, minWidth: 140 }} />
              <Input label="Tarif dasar (Rp)" value={form.base_fare} keyboardType="number-pad" onChangeText={(v) => setForm({ ...form, base_fare: v.replace(/\D/g, '') })} containerStyle={{ flex: 1, minWidth: 140 }} />
              <Input label="Tarif minimum (Rp)" value={form.min_fare} keyboardType="number-pad" onChangeText={(v) => setForm({ ...form, min_fare: v.replace(/\D/g, '') })} containerStyle={{ flex: 1, minWidth: 140 }} />
            </Row>
            <Row gap={8} style={{ flexWrap: 'wrap' }}>
              <Input label={`Porsi mitra % (≥ ${minShare})`} value={form.driver_share_pct} keyboardType="decimal-pad" onChangeText={(v) => setForm({ ...form, driver_share_pct: v.replace(/[^\d.,]/g, '') })} containerStyle={{ flex: 1, minWidth: 130 }} />
              <Input label="Komisi platform %" value={form.platform_fee_pct} keyboardType="decimal-pad" onChangeText={(v) => setForm({ ...form, platform_fee_pct: v.replace(/[^\d.,]/g, '') })} containerStyle={{ flex: 1, minWidth: 130 }} />
              <Input label="Biaya platform tetap (Rp)" value={form.platform_fee_flat} keyboardType="number-pad" onChangeText={(v) => setForm({ ...form, platform_fee_flat: v.replace(/\D/g, '') })} containerStyle={{ flex: 1, minWidth: 150 }} />
              <Input label="Pengali carter" value={form.charter_multiplier} keyboardType="decimal-pad" onChangeText={(v) => setForm({ ...form, charter_multiplier: v.replace(/[^\d.,]/g, '') })} containerStyle={{ flex: 1, minWidth: 110 }} />
            </Row>
            <Row gap={8} style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <Input label="Urutan tampil" value={form.sort_order} keyboardType="number-pad" onChangeText={(v) => setForm({ ...form, sort_order: v.replace(/\D/g, '') })} containerStyle={{ flex: 1, minWidth: 110 }} />
              <Input label="Catatan" value={form.note} onChangeText={(v) => setForm({ ...form, note: v })} placeholder="mis. [ASUMSI] tarif pasar PKU 2026" containerStyle={{ flex: 3, minWidth: 200 }} />
              <Button size="sm" variant={form.active ? 'secondary' : 'outline'} title={form.active ? 'Aktif' : 'Nonaktif'} icon={form.active ? 'checkmark-circle-outline' : 'ellipse-outline'} onPress={() => setForm({ ...form, active: !form.active })} />
            </Row>
            <Text style={font.tiny}>Pratinjau bersih mitra: {rupiah(Math.round(n0(parseNum(form.per_km)) * (100 - n0(parseNum(form.platform_fee_pct))) / 100))}/km · porsi efektif {100 - n0(parseNum(form.platform_fee_pct))} %. Server menolak bila porsi &lt; {minShare} %.</Text>
            <Row gap={8} style={{ justifyContent: 'flex-end' }}>
              <Button size="sm" variant="ghost" title="Batal" disabled={busy} onPress={() => setForm(null)} />
              <Button size="sm" title={form.id ? 'Simpan perubahan' : 'Tambah rate card'} icon="save-outline" loading={busy} onPress={save} />
            </Row>
          </View>
        ) : null}
      </AdminDialog>

      <FootNote lines={[
        'Sumber: admin_travel_rate_cards(), admin_set_travel_rate_card(p), travel_quote(from, to, model, mode, pax) — migrasi 0124. Seed rate card [ASUMSI agen DB]: Avanza/Xenia 7 kursi Rp3.500/km · Innova Reborn Rp4.500 · Hiace Commuter 14 Rp6.500 · Hiace Premio 11 Rp8.000 · Alphard 6 Rp12.000; dasar Rp25.000, minimum Rp150.000.',
        'Jarak: travel_routes.distance_km bila rute aktif ada (travel_distance_source=route_first; PKU→PDG 355 km), selain itu haversine pusat kota × travel_road_factor 1,25. Per kursi = tarif mobil ÷ kursi × (1 + travel_shared_markup_pct 15 %) [ASUMSI], dibulatkan ke atas Rp1.000.',
        'Integrasi: travel_trip_create memakai quote sebagai harga default; harga manual mitra harus dalam ±travel_price_tolerance_pct 10 % (TRAVEL_PRICE_OUT_OF_RANGE). travel_offer_create menolak tawaran carter < travel_offer_min_pct 90 % quote (TRAVEL_OFFER_TOO_LOW).',
        'Kolom lama travel_bookings.price/platform_fee/partner_earning tidak berubah makna; kolom baru commission, ppn, price_breakdown. PPN inklusif dalam komisi.',
      ]} />
    </AdminPage>
  );
}

/* ───────────────────── Kalkulator contoh travel_quote ───────────────────── */

function QuoteCalculator({ cards }: { cards: TravelRateCard[] }) {
  const [cities, setCities] = useState<CityOpt[]>([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [model, setModel] = useState('');
  const [mode, setMode] = useState<'charter' | 'shared'>('charter');
  const [pax, setPax] = useState('1');
  const [q, setQ] = useState<TravelQuote | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.from('cities').select('id,name,province,service_status').order('name');
      if (error) { setErr(`Daftar kota: ${error.message}`); return; }
      const list = (data as CityOpt[]) ?? [];
      setCities(list);
      const pku = list.find((c) => /pekanbaru/i.test(c.name)), pdg = list.find((c) => /^padang$/i.test(c.name));
      if (pku) setFrom(pku.id); if (pdg) setTo(pdg.id);
    })();
  }, []);
  const cityOpts = useMemo(() => {
    const rank = (s: string | null) => (s === 'aktif' ? 0 : s === 'segera' ? 1 : 2);
    return [...cities].sort((a, b) => rank(a.service_status) - rank(b.service_status) || a.name.localeCompare(b.name)).map((c) => ({ value: c.id, label: c.name, sublabel: `${c.province ?? '—'} · ${c.service_status ?? '—'}` }));
  }, [cities]);
  const modelOpts = useMemo(() => cards.filter((c) => c.active).map((c) => ({ value: c.id, label: c.vehicle_model, sublabel: `${c.seats} kursi · ${rupiah(c.per_km)}/km` })), [cards]);

  const run = async () => {
    if (!from || !to) return toast.error('Pilih kota asal dan tujuan');
    if (from === to) return toast.error('Kota asal dan tujuan harus berbeda');
    const n = parseNum(pax);
    if (!Number.isInteger(n) || n < 1 || n > 60) return toast.error('Jumlah kursi 1–60');
    setBusy(true);
    try { setQ(await travelQuote(from, to, model || null, mode, n)); setErr(null); }
    catch (e) { setQ(null); setErr(`travel_quote: ${(e as Error).message}`); }
    finally { setBusy(false); }
  };

  return (
    <Panel title="Kalkulator contoh (travel_quote)" subtitle="Pilih dua kota dari daftar kota, model (kosong = Rp/km termurah), mode carter/bersama, jumlah kursi — hasil persis seperti yang dipakai travel_trip_create / travel_offer_create." icon="calculator-outline" iconColor={adminTone.violet}>
      <View style={{ gap: adminSpace.md }}>
        <Row gap={8} style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <AdminSelect label="Kota asal" width={200} value={from} options={cityOpts} placeholder="Pilih…" searchable onChange={setFrom} />
          <AdminSelect label="Kota tujuan" width={200} value={to} options={cityOpts} placeholder="Pilih…" searchable onChange={setTo} />
          <AdminSelect label="Model" width={220} value={model} options={modelOpts} placeholder="Termurah (default)" clearable clearLabel="Termurah (default)" onChange={setModel} />
          <AdminSelect label="Mode" width={150} value={mode} options={[{ value: 'charter', label: 'Carter (mobil penuh)' }, { value: 'shared', label: 'Kursi bersama' }]} onChange={(v) => setMode(v as 'charter' | 'shared')} />
          <Input label="Kursi (pax)" value={pax} keyboardType="number-pad" onChangeText={(v) => setPax(v.replace(/\D/g, ''))} containerStyle={{ width: 100 }} />
          <Button size="sm" title="Hitung" icon="calculator-outline" loading={busy} onPress={run} />
        </Row>
        <ErrorNote text={err} onRetry={run} />
        {q ? (
          <Row gap={adminSpace.lg} style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <View style={[st.box, { flex: 1, minWidth: 300 }]}>
              <Text style={font.h3}>{q.from_city?.name} → {q.to_city?.name}</Text>
              <Text style={font.small}>{Number(q.km).toLocaleString('id-ID', { maximumFractionDigits: 1 })} km ({q.km_source === 'route' ? 'rute aktif' : `haversine ${Number(q.km_haversine_x_factor).toLocaleString('id-ID', { maximumFractionDigits: 1 })} km × ${q.road_factor}`}) · {q.model} · {q.seats} kursi · {q.mode === 'charter' ? 'carter' : `bersama ${q.pax} kursi`}</Text>
              <View style={{ gap: 4, marginTop: 6 }}>
                {(q.breakdown ?? []).map((b) => <Row key={b.key} between><Text style={font.small}>{b.label}</Text><Text style={font.mono}>{rupiah(n0(b.amount))}</Text></Row>)}
              </View>
            </View>
            <View style={[st.box, { flex: 1, minWidth: 280, gap: 6 }]}>
              <Row between><Text style={font.small}>Tarif mobil (sebelum pengali)</Text><Text style={font.mono}>{rupiah(n0(q.fare_vehicle))}</Text></Row>
              <Row between><Text style={font.small}>Carter (× {q.charter_multiplier})</Text><Text style={font.mono}>{rupiah(n0(q.fare_total))}</Text></Row>
              <Row between><Text style={font.small}>Per kursi (markup {q.shared_markup_pct} %)</Text><Text style={font.mono}>{rupiah(n0(q.fare_per_seat))}</Text></Row>
              <Row between><Text style={font.bodyStrong}>Tarif yang ditagih</Text><Text style={[font.mono, { fontWeight: '700' }]}>{rupiah(n0(q.fare))}</Text></Row>
              <Row between><Text style={font.small}>+ biaya platform pelanggan</Text><Text style={font.mono}>{rupiah(n0(q.customer_platform_fee))}</Text></Row>
              <Row between><Text style={font.bodyStrong}>Total dibayar pelanggan</Text><Text style={[font.mono, { fontWeight: '700', color: adminTone.teal }]}>{rupiah(n0(q.customer_total))}</Text></Row>
              <View style={{ height: 1, backgroundColor: adminTone.border, marginVertical: 4 }} />
              <Row between><Text style={font.small}>Komisi platform</Text><Text style={font.mono}>{rupiah(n0(q.commission))}</Text></Row>
              <Row between><Text style={font.small}>PPN (inklusif)</Text><Text style={font.mono}>{rupiah(n0(q.ppn))}</Text></Row>
              <Row between><Text style={font.small}>Pendapatan platform bersih</Text><Text style={font.mono}>{rupiah(n0(q.platform_revenue_net))}</Text></Row>
              <Row between><Text style={font.bodyStrong}>Diterima mitra</Text><Text style={[font.mono, { fontWeight: '700', color: adminTone.green }]}>{rupiah(n0(q.driver_net))} ({Number(q.driver_share_pct_actual).toLocaleString('id-ID', { maximumFractionDigits: 1 })} %)</Text></Row>
              <Text style={font.tiny}>Toleransi harga mitra ±{q.tolerance_pct} % · tawaran carter minimal {q.offer_min_pct} % = {rupiah(Math.ceil(n0(q.fare_total) * n0(q.offer_min_pct) / 100))}.</Text>
            </View>
          </Row>
        ) : null}
      </View>
    </Panel>
  );
}

const st = StyleSheet.create({
  box: { padding: adminSpace.md, borderWidth: 1, borderColor: adminTone.border, borderRadius: adminRadius.md, backgroundColor: adminTone.surfaceAlt, gap: 4 },
});
