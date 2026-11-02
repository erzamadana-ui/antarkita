// Admin · Kebijakan Harga (migrasi 0124, keputusan GM 8: kompetitif, kesejahteraan driver, keberlanjutan — tanpa bakar promo).
// rpc('admin_pricing_policy') → prinsip + setelan kebijakan (driver_min_share_pct, promo_budget_pct_max, promo_default_funded_by,
// fare_floor_per_km_*), ringkasan per layanan, rate card travel, promo bulan berjalan vs anggaran, acuan pasar, daftar pelanggaran.
// rpc('pricing_policy_check') → daftar pelanggaran saja (dipakai untuk penyegaran cepat). Halaman ini baca-saja; perubahan
// dilakukan di Aturan Bisnis (service_economics), Tarif & Promo (pricing/promo), Rate Card Travel, dan Pengaturan.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AdminPage, Panel, DataTable, StatCard, Pill, adminFont as font, adminTone, adminSpace, adminRadius, adminIcon, TONE } from '@/components/admin';
import { FootNote } from '@/components/reports';
import { Row, Button } from '@/components/ui';
import { rupiah, serviceLabel } from '@/lib/format';
import { ErrorNote, fmtDate, Trunc, WideTableHint } from './_shared';
import { adminPricingPolicy, pricingPolicyCheck, POLICY_RULE_LABEL, type PricingPolicy, type PolicyViolation, type PricingPolicyService } from '@/lib/admin31';

const n0 = (v: unknown) => Number(v ?? 0) || 0;
const pct = (v: unknown, d = 1) => `${Number(v ?? 0).toLocaleString('id-ID', { maximumFractionDigits: d })} %`;
const svcLabel = (s: string) => (s === '*' ? 'Semua layanan' : (serviceLabel as Record<string, string>)[s] ?? s);
const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const monthLabel = (iso?: string | null) => { if (!iso) return '—'; const [y, m] = String(iso).split('-').map(Number); return `${BULAN[(m || 1) - 1]} ${y}`; };

/** Tautan tujuan perbaikan per aturan: layar yang sudah ada (Aturan Bisnis / Tarif & Promo / Rate Card Travel / Pengaturan). */
const RULE_TARGET: Record<string, { label: string; href: string }> = {
  driver_share_min: { label: 'Aturan Bisnis', href: '/(admin)/economics' },
  two_wheel_cap: { label: 'Aturan Bisnis', href: '/(admin)/economics' },
  fare_floor_per_km: { label: 'Tarif & Promo', href: '/(admin)/pricing' },
  promo_budget: { label: 'Tarif & Promo', href: '/(admin)/pricing' },
  promo_funded_by: { label: 'Aturan Bisnis', href: '/(admin)/economics' },
};

export default function AdminKebijakanHarga() {
  const router = useRouter();
  const [data, setData] = useState<PricingPolicy | null>(null);
  const [viol, setViol] = useState<PolicyViolation[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [violErr, setViolErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [p, v] = await Promise.allSettled([adminPricingPolicy(), pricingPolicyCheck()]);
    if (p.status === 'fulfilled') { setData(p.value); setErr(null); } else { setData(null); setErr(`Kebijakan harga: ${(p.reason as Error).message}`); }
    if (v.status === 'fulfilled') { setViol(v.value); setViolErr(null); } else { setViol(null); setViolErr(`Pemeriksaan kebijakan: ${(v.reason as Error).message}`); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  // Daftar pelanggaran: pricing_policy_check() dulu; bila gagal, pakai violations[] dari admin_pricing_policy (sumber sama).
  const violations = useMemo(() => viol ?? data?.violations ?? [], [viol, data]);
  const nViol = violations.filter((v) => v.severity === 'violation').length;
  const nInfo = violations.length - nViol;
  const pol = data?.policy;
  const promo = data?.promo;
  const services = data?.services ?? [];
  const floors = pol?.fare_floor_per_km ?? {};
  const promoOver = promo?.spend_pct != null && n0(promo.spend_pct) > n0(promo.budget_pct_max);

  const sevTone = (s: string) => (s === 'violation' ? 'bad' : 'info') as 'bad' | 'info';
  const go = (href: string) => router.push(href as never);

  return (
    <AdminPage title="Kebijakan Harga" subtitle={pol?.principle ?? 'Kompetitif, kesejahteraan driver, keberlanjutan aplikasi — tanpa bakar promo (keputusan GM 31 Okt 2026). Halaman pemantau: pelanggaran ditandai, perbaikan dilakukan di layar Aturan Bisnis / Tarif & Promo / Rate Card Travel / Pengaturan.'} onRefresh={load}
      right={<Row gap={8} style={{ flexWrap: 'wrap' }}>
        <Button size="sm" variant="outline" title="Aturan Bisnis" icon="options-outline" onPress={() => go('/(admin)/economics')} />
        <Button size="sm" variant="outline" title="Tarif & Promo" icon="pricetags-outline" onPress={() => go('/(admin)/pricing')} />
        <Button size="sm" variant="outline" title="Rate Card Travel" icon="bus-outline" onPress={() => go('/(admin)/rate-card-travel')} />
        <Button size="sm" variant="outline" title="Segarkan" icon="refresh-outline" onPress={load} />
      </Row>}>
      <ErrorNote text={err} onRetry={load} />

      <Row gap={adminSpace.md} style={{ flexWrap: 'wrap' }}>
        <StatCard index={0} icon={nViol ? 'alert-circle-outline' : 'shield-checkmark-outline'} label="Status kepatuhan" value={loading && !data && !viol ? '…' : nViol ? `${nViol} pelanggaran` : 'Patuh'} hint={`${nInfo} catatan info · ${data?.generated_at ? `dihitung ${fmtDate(data.generated_at)}` : 'pricing_policy_check()'}`} color={nViol ? adminTone.red : adminTone.green} />
        <StatCard index={1} icon="people-outline" label="Porsi minimum driver / mitra" value={pol ? pct(pol.driver_min_share_pct, 0) : '—'} hint={pol ? `komisi roda dua maks ${pct(pol.two_wheel_commission_cap, 0)} (regulasi) · setelan driver_min_share_pct` : 'setelan driver_min_share_pct'} color={adminTone.blue} />
        <StatCard index={2} icon="megaphone-outline" label={`Promo platform · ${monthLabel(promo?.month)}`} value={promo ? (promo.spend_pct == null ? rupiah(n0(promo.promo_platform_spend)) : pct(promo.spend_pct)) : '—'} hint={promo ? `${rupiah(n0(promo.promo_platform_spend))} dari pendapatan ${rupiah(n0(promo.platform_revenue))} · anggaran maks ${pct(promo.budget_pct_max, 0)} · sisa ${rupiah(n0(promo.budget_remaining))}` : 'setelan promo_budget_pct_max'} color={promoOver ? adminTone.red : adminTone.teal} />
        <StatCard index={3} icon="wallet-outline" label="Penanggung promo default" value={pol ? (pol.promo_default_funded_by === 'platform' ? 'Platform' : pol.promo_default_funded_by) : '—'} hint="setelan promo_default_funded_by — promo merchant/sponsor tidak membebani platform" color={adminTone.violet} />
      </Row>

      <Panel title={`Pelanggaran & catatan (${violations.length})`} subtitle="Merah = pelanggaran (harus diperbaiki sebelum tarif/komisi disimpan ulang); biru = info. Nilai vs batas berasal dari service_economics, pricing, travel_rate_cards, dan order_ledger bulan berjalan." icon="warning-outline" iconColor={nViol ? adminTone.red : adminTone.green} padded={false}>
        <View style={{ padding: adminSpace.md, paddingBottom: 0 }}><ErrorNote text={violErr && !data ? violErr : null} onRetry={load} /></View>
        <DataTable keyField="k" rows={violations.map((v, i) => ({ ...v, k: `${v.service}-${v.rule}-${v.rate_card_id ?? i}` }))} emptyText={loading ? 'Memuat…' : err && violErr ? 'Tidak bisa memeriksa kebijakan — periksa koneksi/izin' : 'Tidak ada pelanggaran — semua layanan & rate card patuh'} emptyIcon="shield-checkmark-outline"
          columns={[
            { key: 'severity', label: 'Tingkat', width: 120, render: (r) => <Pill text={r.severity === 'violation' ? 'Pelanggaran' : 'Info'} tone={sevTone(String(r.severity))} icon={r.severity === 'violation' ? 'alert-circle-outline' : 'information-circle-outline'} /> },
            { key: 'service', label: 'Layanan', width: 140, render: (r) => <Text style={font.bodyStrong}>{svcLabel(String(r.service))}</Text> },
            { key: 'rule', label: 'Aturan', width: 210, render: (r) => <View style={{ minWidth: 0 }}><Text style={font.small}>{POLICY_RULE_LABEL[String(r.rule)] ?? String(r.rule)}</Text><Text style={font.tiny}>{String(r.rule)}</Text></View> },
            { key: 'value', label: 'Nilai vs batas', width: 170, align: 'right', mono: true, render: (r) => { const v = r as unknown as PolicyViolation; const money = v.rule === 'fare_floor_per_km'; const f = (x: unknown) => (x == null ? '—' : typeof x === 'number' || /^\d+(\.\d+)?$/.test(String(x)) ? (money ? rupiah(Number(x)) : v.rule === 'promo_funded_by' ? String(x) : pct(x)) : String(x)); return <Text style={[font.mono, { color: v.severity === 'violation' ? adminTone.red : adminTone.ink }]}>{f(v.value)} <Text style={font.tiny}>vs</Text> {f(v.limit)}</Text>; } },
            { key: 'message', label: 'Pesan', width: 360, flex: 1, render: (r) => <Text style={font.small} numberOfLines={3}>{String(r.message)}</Text> },
            { key: 'go', label: 'Perbaiki di', width: 170, align: 'right', render: (r) => { const v = r as unknown as PolicyViolation; const t = v.rate_card_id ? { label: 'Rate Card Travel', href: '/(admin)/rate-card-travel' } : RULE_TARGET[v.rule] ?? { label: 'Pengaturan', href: '/(admin)/settings' }; return <Button size="sm" variant="outline" title={t.label} icon="open-outline" onPress={() => go(t.href)} />; } },
          ]} />
        <View style={{ padding: adminSpace.md }}><WideTableHint what="kolom Perbaiki di" /></View>
      </Panel>

      <Row gap={adminSpace.lg} style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <Panel title="Setelan kebijakan" subtitle="Kunci app_settings (grup pricing/promo); ubah di Pengaturan. Floor = tarif bersih minimum yang harus diterima driver per km setelah komisi." icon="settings-outline" style={{ flex: 1, minWidth: 320 }}
          right={<Button size="sm" variant="ghost" title="Pengaturan" icon="open-outline" onPress={() => go('/(admin)/settings')} />}>
          <View style={{ gap: 8 }}>
            <SettingRow k="driver_min_share_pct" label="Porsi minimum driver/mitra" value={pol ? pct(pol.driver_min_share_pct, 0) : '—'} />
            <SettingRow k="promo_budget_pct_max" label="Anggaran promo platform maks (% pendapatan)" value={pol ? pct(pol.promo_budget_pct_max, 0) : '—'} />
            <SettingRow k="promo_default_funded_by" label="Penanggung promo default" value={pol?.promo_default_funded_by ?? '—'} />
            <SettingRow k="two_wheel_commission_cap" label="Batas komisi roda dua (regulasi)" value={pol ? pct(pol.two_wheel_commission_cap, 0) : '—'} />
            <Text style={[font.label, { marginTop: 6 }]}>fare_floor_per_km_* (Rp bersih driver / km)</Text>
            <Row gap={6} style={{ flexWrap: 'wrap' }}>
              {Object.keys(floors).length ? Object.entries(floors).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => <Pill key={k} text={`${svcLabel(k)} ${rupiah(Number(String(v).replace(/"/g, '')))}`} tone="neutral" />) : <Text style={font.tiny}>{loading ? 'Memuat…' : 'belum ada kunci fare_floor_per_km_* di app_settings'}</Text>}
            </Row>
            <Text style={font.tiny}>Default floor [ASUMSI 0124]: motor 2.000 · mobil 3.500 · send/food/shop/market 2.000 · box 5.000 · travel 3.000 per km.</Text>
          </View>
        </Panel>

        <Panel title="Acuan pasar" subtitle={data?.market_reference?.note ?? '[ASUMSI] acuan tarif kompetitor — belum diverifikasi lapangan'} icon="trending-up-outline" iconColor={adminTone.orange} style={{ flex: 1, minWidth: 320 }}
          right={<Button size="sm" variant="ghost" title="Intelijen Harga" icon="open-outline" onPress={() => go('/(admin)/pricing-intel')} />}>
          {data?.market_reference ? (
            <View style={{ gap: 8 }}>
              <MarketRow label="Motor · Rp/km" range={data.market_reference.ride_motor_per_km} ours={services.find((s) => s.service === 'ride_motor')?.per_km} />
              <MarketRow label="Motor · minimum" range={data.market_reference.ride_motor_min} ours={services.find((s) => s.service === 'ride_motor')?.customer_min_total} />
              <MarketRow label="Mobil · Rp/km" range={data.market_reference.ride_car_per_km} ours={services.find((s) => s.service === 'ride_car')?.per_km} />
              <MarketRow label="Mobil · minimum" range={data.market_reference.ride_car_min} ours={services.find((s) => s.service === 'ride_car')?.customer_min_total} />
              <Text style={font.tiny}>Kolom “kami” = pricing.per_km / (min_fare + biaya platform pelanggan). Angka pasar berlabel [ASUMSI] sampai survei lapangan — jangan dijadikan dasar keputusan tarif tanpa verifikasi.</Text>
            </View>
          ) : <Text style={font.tiny}>{loading ? 'Memuat…' : 'Server tidak mengirim market_reference.'}</Text>}
        </Panel>
      </Row>

      <Panel title="Ringkasan per layanan" subtitle="Komisi driver / fee merchant dari service_economics; tarif dari pricing. Porsi driver = 100 − komisi (travel: 100 − fee mitra). Bersih driver/km merah bila di bawah floor." icon="layers-outline" padded={false}
        right={<Button size="sm" variant="ghost" title="Aturan Bisnis" icon="open-outline" onPress={() => go('/(admin)/economics')} />}>
        <DataTable keyField="service" rows={services as unknown as Record<string, unknown>[]} emptyText={loading ? 'Memuat…' : 'Tidak ada data layanan'} emptyIcon="layers-outline"
          columns={[
            { key: 'service', label: 'Layanan', width: 150, render: (r) => <Trunc style={font.bodyStrong} title={String(r.service)}>{svcLabel(String(r.service))}</Trunc> },
            { key: 'driver_commission_pct', label: 'Komisi driver', width: 110, align: 'right', mono: true, render: (r) => <Text style={font.mono}>{pct(r.driver_commission_pct)}</Text> },
            { key: 'merchant_fee_pct', label: 'Fee merchant/mitra', width: 130, align: 'right', mono: true, render: (r) => <Text style={font.mono}>{pct(r.merchant_fee_pct)}</Text> },
            { key: 'driver_share_pct', label: 'Porsi driver', width: 110, align: 'right', mono: true, render: (r) => { const s = r as unknown as PricingPolicyService; const low = pol && n0(s.driver_share_pct) < n0(pol.driver_min_share_pct); return <Text style={[font.mono, { fontWeight: '700', color: low ? adminTone.red : adminTone.green }]}>{pct(s.driver_share_pct)}</Text>; } },
            { key: 'per_km', label: 'Tarif pelanggan / km', width: 140, align: 'right', mono: true, render: (r) => <Text style={font.mono}>{r.per_km == null ? '—' : rupiah(n0(r.per_km))}</Text> },
            { key: 'driver_net_per_km', label: 'Bersih driver / km', width: 130, align: 'right', mono: true, render: (r) => { const s = r as unknown as PricingPolicyService; if (s.driver_net_per_km == null) return <Text style={font.tiny}>—</Text>; const bad = n0(s.fare_floor_per_km) > 0 && n0(s.driver_net_per_km) < n0(s.fare_floor_per_km); return <Text style={[font.mono, { color: bad ? adminTone.red : adminTone.green }]}>{rupiah(n0(s.driver_net_per_km))}</Text>; } },
            { key: 'fare_floor_per_km', label: 'Floor / km', width: 110, align: 'right', mono: true, render: (r) => <Text style={font.mono}>{n0(r.fare_floor_per_km) ? rupiah(n0(r.fare_floor_per_km)) : '—'}</Text> },
            { key: 'customer_min_total', label: 'Minimum pelanggan', width: 150, align: 'right', mono: true, render: (r) => { const s = r as unknown as PricingPolicyService; return <View style={{ alignItems: 'flex-end' }}><Text style={font.mono}>{s.customer_min_total == null ? '—' : rupiah(n0(s.customer_min_total))}</Text><Text style={font.tiny}>biaya platform {rupiah(n0(s.customer_platform_fee))}</Text></View>; } },
            { key: 'promo_default_funded_by', label: 'Promo ditanggung', width: 130, render: (r) => { const s = r as unknown as PricingPolicyService; const diff = pol && s.promo_default_funded_by !== pol.promo_default_funded_by; return <Pill text={s.promo_default_funded_by} tone={diff ? 'info' : 'neutral'} />; } },
          ]} />
        <View style={{ padding: adminSpace.md, gap: 6 }}>
          <WideTableHint what="kolom promo" />
          {data?.travel_rate_cards?.length ? <Text style={font.tiny}>Travel per rate card: {data.travel_rate_cards.map((c) => `${c.vehicle_model} ${rupiah(n0(c.per_km))}/km → mitra ${rupiah(n0(c.driver_net_per_km))}/km${c.active ? '' : ' (nonaktif)'}`).join(' · ')}</Text> : null}
        </View>
      </Panel>

      <FootNote lines={[
        'Sumber: admin_pricing_policy() & pricing_policy_check() — migrasi 0124 (keputusan GM 8). Aturan: driver_share_min, two_wheel_cap (commission_cap_two_wheel), fare_floor_per_km, promo_budget (promo platform bulan berjalan vs % pendapatan platform dari order_ledger), promo_funded_by (info).',
        'Halaman ini belum memblokir penyimpanan: admin_set_service_economics / admin_set_promo tidak diubah oleh 0124 (usulan guard untuk migrasi berikutnya). Rate card travel sudah ditolak server bila porsi mitra < driver_min_share_pct.',
        'Angka pasar (market_reference) berlabel [ASUMSI 31 Okt 2026] dan belum diverifikasi lapangan. Dokumen kebijakan: docs/KEBIJAKAN-HARGA.md.',
      ]} />
    </AdminPage>
  );
}

function SettingRow({ k, label, value }: { k: string; label: string; value: string }) {
  return (
    <Row between style={[st.setting]}>
      <View style={{ flex: 1, minWidth: 0 }}><Text style={font.small}>{label}</Text><Text style={font.tiny}>{k}</Text></View>
      <Text style={[font.mono, { fontWeight: '700' }]}>{value}</Text>
    </Row>
  );
}

function MarketRow({ label, range, ours }: { label: string; range?: number[] | null; ours?: number | null }) {
  const [lo, hi] = range ?? [];
  const inRange = ours != null && lo != null && hi != null ? (ours >= lo && ours <= hi ? 'ok' : ours < lo ? 'info' : 'wait') : null;
  return (
    <Row between style={[st.setting]}>
      <Text style={[font.small, { flex: 1 }]}>{label}</Text>
      <Text style={font.mono}>{lo != null && hi != null ? `${rupiah(lo)} – ${rupiah(hi)}` : '—'}</Text>
      <View style={{ width: 130, alignItems: 'flex-end' }}>
        {ours == null ? <Text style={font.tiny}>kami —</Text> : <Row gap={4}><Text style={font.tiny}>kami</Text><Text style={[font.mono, { fontWeight: '700' }]}>{rupiah(ours)}</Text>{inRange ? <Ionicons name={inRange === 'ok' ? 'checkmark-circle' : inRange === 'info' ? 'arrow-down-circle' : 'arrow-up-circle'} size={adminIcon.md} color={inRange === 'ok' ? TONE.ok.fg : inRange === 'info' ? TONE.info.fg : TONE.wait.fg} /> : null}</Row>}
      </View>
    </Row>
  );
}

const st = StyleSheet.create({
  setting: { paddingVertical: 6, paddingHorizontal: 10, borderWidth: 1, borderColor: adminTone.border, borderRadius: adminRadius.sm, backgroundColor: adminTone.surfaceAlt, gap: 10 },
});
