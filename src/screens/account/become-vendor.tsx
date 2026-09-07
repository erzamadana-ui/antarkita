// Daftar Pedagang Pasar Tradisional (AntarMarket) — 4 langkah: pasar → lapak → dokumen → rekening → apply_market_vendor
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Screen, Card, Input, Button, Row, Chip, Badge, Empty, toast } from '@/components/ui';
import { Entrance, PressableScale, Skeleton, ProgressBar } from '@/components/motion';
import { ServiceIllustration } from '@/components/ServiceArt';
import { DocUpload } from '@/components/DocUpload';
import { useAuth } from '@/store/auth';
import { useCurrentLocation } from '@/hooks/useLocation';
import { rpc, supabase } from '@/lib/supabase';
import { colors, font, radius, shadow } from '@/lib/theme';
import { km, marketCategoryLabel } from '@/lib/format';
import type { Market, MarketVendor } from '@/lib/types';

const CATS = ['sayur', 'buah', 'bumbu', 'daging_ikan', 'sembako', 'lainnya'] as const;
const BANKS = ['BRI', 'BCA', 'Mandiri', 'BNI', 'BSI', 'Bank Nagari', 'Bank Riau Kepri', 'Lainnya'];
const STEPS = ['Pasar', 'Lapak', 'Dokumen', 'Rekening'];
const digits = (v: string) => v.replace(/\D/g, '');

export default function BecomeVendor() {
  const router = useRouter();
  const { marketVendor: me, loadProfile } = useAuth();
  const { location, hasFix } = useCurrentLocation();
  const [step, setStep] = useState(0);
  const [markets, setMarkets] = useState<Market[] | null>(null);
  const [q, setQ] = useState('');
  const [f, setF] = useState({
    market_id: '', stall_name: '', stall_no: '', categories: [] as string[], open_hours: '', phone: '', description: '',
    photo_url: '', id_card_url: '', market_card_url: '', bank_name: '', bank_account: '', bank_holder: '',
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => setF((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    if (!me) return;
    setF({
      market_id: me.market_id, stall_name: me.stall_name, stall_no: me.stall_no ?? '', categories: me.categories ?? [], open_hours: me.open_hours ?? '', phone: me.phone ?? '', description: me.description ?? '',
      photo_url: me.photo_url ?? '', id_card_url: me.id_card_url ?? '', market_card_url: me.market_card_url ?? '', bank_name: me.bank_name ?? '', bank_account: me.bank_account ?? '', bank_holder: me.bank_holder ?? '',
    });
  }, [me]);

  // pasar terdekat; fallback semua pasar aktif
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      let list: Market[] = [];
      try { list = (await rpc<Market[]>('nearby_markets', { p_lat: location.lat, p_lng: location.lng, p_radius_km: 50 })) ?? []; } catch { list = []; }
      if (list.length === 0) { const { data } = await supabase.from('markets').select('*').eq('active', true).order('name'); list = (data as Market[]) ?? []; }
      if (!cancelled) setMarkets(list);
    };
    load();
    return () => { cancelled = true; };
  }, [location.lat, location.lng]);

  const ql = q.trim().toLowerCase();
  const shownMarkets = useMemo(() => (markets ?? []).filter((m) => !ql || m.name.toLowerCase().includes(ql) || (m.address ?? '').toLowerCase().includes(ql)), [markets, ql]);
  const selectedMarket = markets?.find((m) => m.id === f.market_id) ?? null;
  const toggleCat = (c: string) => setF((p) => ({ ...p, categories: p.categories.includes(c) ? p.categories.filter((x) => x !== c) : [...p.categories, c] }));

  const validate = (i: number): string | null => {
    if (i === 0 && !f.market_id) return 'Pilih pasar tempat lapak Anda';
    if (i === 1) {
      if (f.stall_name.trim().length < 3) return 'Nama lapak minimal 3 huruf';
      if (f.categories.length === 0) return 'Pilih minimal satu kategori dagangan';
      if (digits(f.phone).length < 9) return 'Isi nomor telepon yang bisa dihubungi';
    }
    if (i === 2) {
      if (!f.photo_url) return 'Unggah foto lapak';
      if (!f.id_card_url) return 'Unggah foto KTP';
    }
    if (i === 3) {
      if (!f.bank_name) return 'Pilih bank';
      if (digits(f.bank_account).length < 8) return 'Isi nomor rekening yang valid';
      if (f.bank_holder.trim().length < 3) return 'Isi nama pemilik rekening';
    }
    return null;
  };
  const next = () => { const err = validate(step); if (err) return toast.error(err); setStep((s) => Math.min(STEPS.length - 1, s + 1)); };
  const submit = async () => {
    for (let i = 0; i < STEPS.length; i++) { const err = validate(i); if (err) { setStep(i); return toast.error(err); } }
    setBusy(true);
    try {
      await rpc<MarketVendor>('apply_market_vendor', { p: {
        market_id: f.market_id, stall_name: f.stall_name.trim(), stall_no: f.stall_no.trim() || null, categories: f.categories, description: f.description.trim() || null,
        photo_url: f.photo_url || null, id_card_url: f.id_card_url || null, market_card_url: f.market_card_url || null, phone: digits(f.phone) || null,
        bank_name: f.bank_name, bank_account: digits(f.bank_account), bank_holder: f.bank_holder.trim(), open_hours: f.open_hours.trim() || null,
      } });
      await loadProfile();
      toast.success(me ? 'Data lapak diperbarui' : 'Pendaftaran terkirim. Lengkapi barang dagangan agar cepat tampil ke pelanggan.');
      router.replace('/(vendor)' as never);
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };

  const st = me ? ({ pending: ['Menunggu verifikasi admin', colors.warning], approved: ['Pedagang aktif', colors.success], suspended: ['Ditangguhkan', colors.danger], rejected: ['Ditolak', colors.danger] } as Record<string, [string, string]>)[me.status] : null;
  const last = step === STEPS.length - 1;
  const footer = (
    <Row gap={10}>
      {step > 0 && <Button title="Kembali" variant="secondary" size="lg" icon="arrow-back" onPress={() => setStep((s) => s - 1)} />}
      <Button title={last ? (me ? 'Simpan perubahan' : 'Kirim pendaftaran') : `Lanjut · ${STEPS[step + 1]}`} size="lg" icon={last ? 'paper-plane-outline' : 'arrow-forward'} loading={busy} onPress={last ? submit : next} style={{ flex: 1 }} />
    </Row>
  );

  return (
    <Screen title="Pedagang Pasar" subtitle={`Langkah ${step + 1} dari ${STEPS.length} · ${STEPS[step]}`} band={colors.market} back footer={footer}>
      <View style={{ gap: 16 }}>
        <Entrance index={0} from="zoom">
          <View style={{ alignItems: 'center', marginTop: 4 }}>
            <View style={s.artCircle}><ServiceIllustration kind="market" size={76} /></View>
            <Text style={[font.h1, { textAlign: 'center', marginTop: 12 }]}>Lapak Anda,{'\n'}pelanggan seluruh kota</Text>
            <Text style={[font.small, { textAlign: 'center', marginTop: 6 }]}>Barang Anda tampil di AntarMarket dengan label grade & harga pasti. Driver AntarKita membeli langsung di lapak Anda; pembayaran masuk ke rekening.</Text>
            {st && <Badge text={st[0]} color={st[1]} style={{ marginTop: 10 }} />}
            {me?.status_reason && me.status !== 'approved' && <Text style={[font.small, { color: colors.danger, textAlign: 'center', marginTop: 6 }]}>Catatan admin: {me.status_reason}</Text>}
          </View>
        </Entrance>

        <Entrance index={1}>
          <View style={{ gap: 6 }}>
            <ProgressBar progress={(step + 1) / STEPS.length} color={colors.market} />
            <Row between>{STEPS.map((label, i) => <Text key={label} style={[font.tiny, i === step && { color: colors.primary, fontWeight: '800' }]}>{i + 1}. {label}</Text>)}</Row>
          </View>
        </Entrance>

        {step === 0 && (
          <Entrance index={2}>
            <View style={{ gap: 10 }}>
              <Input icon="search" placeholder="Cari nama pasar" value={q} onChangeText={setQ} />
              <Row gap={6}><Ionicons name={hasFix ? 'location' : 'location-outline'} size={14} color={colors.primary} /><Text style={font.tiny}>{hasFix ? 'Diurutkan dari lokasi Anda saat ini' : 'Aktifkan lokasi untuk melihat pasar terdekat'}</Text></Row>
              {markets === null ? [0, 1].map((i) => <View key={i} style={s.marketRow}><Skeleton width={56} height={56} radius={14} /><View style={{ flex: 1, gap: 6 }}><Skeleton width="60%" height={14} /><Skeleton width="40%" height={12} /></View></View>)
                : shownMarkets.length === 0 ? <Empty icon="basket-outline" title="Pasar tidak ditemukan" subtitle="Belum ada pasar mitra dengan nama itu. Hubungi CS agar pasar Anda ditambahkan." />
                : shownMarkets.map((m, i) => {
                  const active = f.market_id === m.id;
                  return (
                    <Entrance key={m.id} index={Math.min(i, 6)}>
                      <PressableScale onPress={() => set('market_id')(m.id)} scaleTo={0.985} haptic={false} style={[s.marketRow, active && s.marketActive]}>
                        {m.image_url ? <Image source={{ uri: m.image_url }} style={s.marketImg} /> : <View style={[s.marketImg, { alignItems: 'center', justifyContent: 'center' }]}><ServiceIllustration kind="market" size={34} /></View>}
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={[font.body, { fontWeight: '700' }]} numberOfLines={1}>{m.name}</Text>
                          <Row gap={4}><Ionicons name="location-outline" size={12} color={colors.textMuted} /><Text style={font.tiny} numberOfLines={1}>{m.distance_km != null ? `${km(m.distance_km)} · ` : ''}{m.address ?? 'Alamat belum diisi'}</Text></Row>
                        </View>
                        <View style={[s.radio, active && { borderColor: colors.primary }]}>{active && <View style={s.radioDot} />}</View>
                      </PressableScale>
                    </Entrance>
                  );
                })}
            </View>
          </Entrance>
        )}

        {step === 1 && (
          <Entrance index={2}><Card style={{ gap: 12 }}>
            <Row gap={8}><View style={s.iconTint}><Ionicons name="storefront-outline" size={20} color={colors.primary} /></View><View style={{ flex: 1 }}><Text style={font.label}>Lapak di {selectedMarket?.name ?? 'pasar terpilih'}</Text><Text style={font.tiny}>Nama lapak tampil ke pelanggan</Text></View></Row>
            <Row gap={10}>
              <Input label="Nama lapak" placeholder="Lapak Sayur Bu Ani" value={f.stall_name} onChangeText={set('stall_name')} containerStyle={{ flex: 1 }} />
              <Input label="No. lapak" placeholder="B-12" value={f.stall_no} onChangeText={set('stall_no')} containerStyle={{ width: 100 }} />
            </Row>
            <Text style={font.tiny}>Kategori dagangan</Text>
            <Row gap={8} style={{ flexWrap: 'wrap' }}>{CATS.map((c) => <Chip key={c} label={marketCategoryLabel[c] ?? c} active={f.categories.includes(c)} onPress={() => toggleCat(c)} />)}</Row>
            <Row gap={10}>
              <Input label="Jam buka" placeholder="05.00–12.00" icon="time-outline" value={f.open_hours} onChangeText={set('open_hours')} containerStyle={{ flex: 1 }} />
              <Input label="Telepon / WhatsApp" placeholder="08xx" icon="call-outline" keyboardType="phone-pad" value={f.phone} onChangeText={(v) => set('phone')(digits(v))} containerStyle={{ flex: 1 }} />
            </Row>
            <Input label="Deskripsi singkat" placeholder="Contoh: sayur segar dari Alahan Panjang, datang tiap subuh" value={f.description} onChangeText={set('description')} multiline />
          </Card></Entrance>
        )}

        {step === 2 && (
          <Entrance index={2}><Card style={{ gap: 12 }}>
            <Text style={font.label}>Dokumen lapak</Text>
            <DocUpload label="Foto lapak (tampak depan)" hint="Foto jelas dengan barang dagangan terlihat" required value={f.photo_url} onChange={set('photo_url')} bucket="merchant-images" color={colors.market} />
            <DocUpload label="KTP pemilik lapak" required value={f.id_card_url} onChange={set('id_card_url')} color={colors.market} />
            <DocUpload label="Kartu pedagang / bukti sewa lapak (opsional)" hint="Menaikkan skor kualitas +5" value={f.market_card_url} onChange={set('market_card_url')} color={colors.market} />
            <Text style={font.tiny}>KTP dan kartu pedagang disimpan privat, hanya untuk verifikasi admin. Foto lapak tampil ke pelanggan.</Text>
          </Card></Entrance>
        )}

        {step === 3 && (
          <Entrance index={2}><Card style={{ gap: 12 }}>
            <Text style={font.label}>Rekening pencairan</Text>
            <Row gap={8} style={{ flexWrap: 'wrap' }}>{BANKS.map((b) => <Chip key={b} label={b} active={f.bank_name === b} onPress={() => set('bank_name')(b)} />)}</Row>
            {f.bank_name === 'Lainnya' && <Input label="Nama bank" placeholder="Nama bank" value="" onChangeText={(v) => set('bank_name')(v || 'Lainnya')} />}
            <Input label="Nomor rekening" placeholder="1234567890" keyboardType="number-pad" icon="card-outline" value={f.bank_account} onChangeText={(v) => set('bank_account')(digits(v))} />
            <Input label="Atas nama" placeholder="Sesuai buku tabungan" icon="person-outline" value={f.bank_holder} onChangeText={set('bank_holder')} />
            <Text style={font.tiny}>Pembayaran barang yang dibeli driver dicairkan ke rekening ini setelah pesanan selesai.</Text>
          </Card></Entrance>
        )}

        <Entrance index={3}>
          <View style={s.rules}>
            <Text style={[font.label, { marginBottom: 4 }]}>Syarat kualitas lapak</Text>
            {[
              ['camera-outline', 'Foto lapak & foto barang jelas (bukan foto katalog internet).'],
              ['pricetag-outline', 'Harga wajar: maksimal 1,25× harga acuan pasar. Di atas 1,6× otomatis ditolak.'],
              ['refresh-outline', 'Perbarui harga setidaknya tiap 3 hari agar tetap tampil ke pelanggan.'],
              ['ribbon-outline', 'Skor kualitas minimal 60 agar lapak muncul di AntarMarket; rating pelanggan ikut dihitung.'],
            ].map(([icon, text]) => (
              <Row key={text} gap={8} style={{ alignItems: 'flex-start' }}><Ionicons name={icon as never} size={16} color={colors.primary} style={{ marginTop: 1 }} /><Text style={[font.tiny, { flex: 1, color: colors.text }]}>{text}</Text></Row>
            ))}
          </View>
        </Entrance>
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  artCircle: { width: 116, height: 116, borderRadius: 58, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.primaryLight },
  marketRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 20, backgroundColor: '#fff', borderWidth: 1.5, borderColor: colors.border, ...shadow.soft },
  marketActive: { borderColor: colors.primary, backgroundColor: colors.tint },
  marketImg: { width: 56, height: 56, borderRadius: 14, backgroundColor: colors.tint },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  radioDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.primary },
  iconTint: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center' },
  rules: { gap: 8, padding: 12, borderRadius: radius.lg, backgroundColor: colors.tint, borderWidth: 1, borderColor: colors.primaryLight },
});
