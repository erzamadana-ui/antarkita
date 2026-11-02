// Tarif AntarTravel per km (migrasi 0124) — kartu estimasi `travel_quote` untuk pelanggan & mitra travel.
//  - TravelQuoteCard : jarak (sumber rute/haversine), tarif, rincian breakdown; mode 'customer' tanpa komisi internal,
//                      mode 'partner' menampilkan bersih mitra + rentang ±toleransi (acuan harga trip) atau minimum tawaran (90 %).
// Data dari hooks/useTravelQuote (gagal → kartu menampilkan alasan singkat; pemesanan tetap boleh, server menghitung sendiri).
import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Row, Badge, Button } from '@/components/ui';
import { Skeleton } from '@/components/motion';
import { colors, font, radius } from '@/lib/theme';
import { rupiah } from '@/lib/format';
import { customerQuoteRows, formatKm, offerMinPrice, priceRange, type TravelQuote } from '@/lib/travelQuote';

export function TravelQuoteCard({ quote, loading, error, audience = 'customer', title, accent = colors.travel, guard = 'none', style }: {
  quote: TravelQuote | null; loading?: boolean; error?: string | null;
  /** 'customer' = tanpa komisi internal; 'partner' = tampilkan bersih mitra. */
  audience?: 'customer' | 'partner';
  title?: string; accent?: string;
  /** 'range' = rentang ±toleransi harga trip (mitra); 'offer_min' = minimum tawaran carter (90 %). */
  guard?: 'none' | 'range' | 'offer_min';
  style?: object;
}) {
  const [open, setOpen] = useState(false);
  if (!quote && !loading && !error) return null;
  const head = title ?? (quote?.mode === 'charter' ? 'Estimasi tarif carter' : 'Estimasi tarif per kursi');
  if (!quote) {
    return (
      <View style={[s.card, style]}>
        <Row between><Text style={font.label}>{head}</Text><Ionicons name="calculator-outline" size={16} color={accent} /></Row>
        {loading ? <Skeleton height={28} radius={radius.md} /> : <Text style={font.tiny}>Estimasi belum tersedia{error ? ` (${error})` : ''} — tarif final dihitung server saat memesan.</Text>}
      </View>
    );
  }
  const q = quote;
  const main = q.mode === 'charter' ? q.fare_total : q.fare_per_seat;
  const rows = customerQuoteRows(q);
  const range = guard === 'range' ? priceRange(main, q.tolerance_pct) : null;
  const minOffer = guard === 'offer_min' ? offerMinPrice(q.fare_total, q.offer_min_pct) : null;
  return (
    <View style={[s.card, style]}>
      <Row between>
        <Text style={font.label}>{head}</Text>
        <Badge text={`${formatKm(q.km)} km · ${q.km_source === 'route' ? 'rute resmi' : 'estimasi jalan'}`} color={colors.info} />
      </Row>
      <Row between style={{ alignItems: 'flex-end' }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontSize: 24, fontWeight: '700', color: accent, letterSpacing: -0.5 }}>{rupiah(main)}<Text style={font.tiny}>{q.mode === 'charter' ? ' / mobil' : ' / kursi'}</Text></Text>
          <Text style={font.tiny} numberOfLines={2}>{q.model} ({q.seats} kursi) · Rp{q.per_km.toLocaleString('id-ID')}/km · {q.from_city?.name} → {q.to_city?.name}</Text>
        </View>
        {audience === 'customer' && q.mode === 'shared' && q.pax > 1 ? <View style={{ alignItems: 'flex-end' }}><Text style={font.tiny}>{q.pax} kursi</Text><Text style={{ fontWeight: '700', color: colors.text }}>{rupiah(q.customer_total)}</Text></View> : null}
        {audience === 'customer' && q.mode === 'charter' ? <View style={{ alignItems: 'flex-end' }}><Text style={font.tiny}>Total + biaya aplikasi</Text><Text style={{ fontWeight: '700', color: colors.text }}>{rupiah(q.customer_total)}</Text></View> : null}
        {audience === 'partner' ? <View style={{ alignItems: 'flex-end' }}><Text style={font.tiny}>Bersih untuk Anda</Text><Text style={{ fontWeight: '700', color: colors.success }}>{rupiah(q.driver_net)}</Text></View> : null}
      </Row>
      {range ? <Text style={[font.tiny, { color: colors.text }]}>Harga yang boleh Anda pasang: <Text style={{ fontWeight: '700' }}>{rupiah(range.min)} – {rupiah(range.max)}</Text> (±{q.tolerance_pct} % dari acuan). Kosongkan harga → memakai acuan.</Text> : null}
      {minOffer != null ? <Text style={[font.tiny, { color: colors.text }]}>Tawaran minimal <Text style={{ fontWeight: '700' }}>{rupiah(minOffer)}</Text> ({q.offer_min_pct} % acuan) — di bawah itu server menolak (TRAVEL_OFFER_TOO_LOW).</Text> : null}
      {audience === 'customer' && q.mode === 'charter' ? <Text style={font.tiny}>Mitra mengirim penawaran sendiri; penawaran minimal {q.offer_min_pct} % dari estimasi ini ({rupiah(offerMinPrice(q.fare_total, q.offer_min_pct))}).</Text> : null}
      <Button title={open ? 'Tutup rincian' : 'Rincian tarif'} size="sm" variant="ghost" icon={open ? 'chevron-up' : 'chevron-down'} color={accent} onPress={() => setOpen((v) => !v)} style={{ alignSelf: 'flex-start' }} />
      {open ? (
        <View style={s.detail}>
          {rows.map((r) => (
            <View key={r.label}>
              <Row between><Text style={[font.tiny, { flex: 1 }]}>{r.label}</Text><Text style={font.tiny}>{rupiah(r.value)}</Text></Row>
              {r.hint ? <Text style={[font.tiny, { color: colors.textMuted, fontSize: 11 }]}>{r.hint}</Text> : null}
            </View>
          ))}
          {audience === 'partner' ? (
            <>
              <Row between><Text style={font.tiny}>Komisi platform (termasuk PPN)</Text><Text style={font.tiny}>-{rupiah(q.commission)}</Text></Row>
              <Row between><Text style={[font.tiny, { fontWeight: '700', color: colors.text }]}>Bersih mitra ({q.driver_share_pct_actual} %)</Text><Text style={[font.tiny, { fontWeight: '700', color: colors.success }]}>{rupiah(q.driver_net)}</Text></Row>
            </>
          ) : <Row between><Text style={[font.tiny, { fontWeight: '700', color: colors.text }]}>Estimasi total</Text><Text style={[font.tiny, { fontWeight: '700', color: colors.text }]}>{rupiah(q.customer_total)}</Text></Row>}
          <Text style={[font.tiny, { fontSize: 11 }]}>Sumber: travel_quote (rate card {q.model}; jarak {q.km_source === 'route' ? 'travel_routes' : `pusat kota × ${q.road_factor}`}). Pembulatan ke atas Rp1.000. Harga final yang tampil pada jadwal/penawaran mitra bisa berbeda dalam batas toleransi.</Text>
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  card: { gap: 8, padding: 12, borderRadius: radius.lg, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border },
  detail: { gap: 4, padding: 10, borderRadius: radius.md, backgroundColor: colors.bgSoft },
});
