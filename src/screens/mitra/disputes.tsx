// Laporan selisih pembayaran/pencairan milik mitra — rpc('my_disputes') (Finpay v3 §4).
// Laporan baru dibuat dari rincian pesanan ("Laporkan selisih" → dispute_open).
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, RefreshControl, ScrollView } from 'react-native';
import { Screen, Empty, Chip, Row, Button } from '@/components/ui';
import { Entrance, Skeleton } from '@/components/motion';
import { colors, font, radius } from '@/lib/theme';
import { loadMyDisputes, type MyDispute } from '@/lib/mitra';
import { DisputeRow } from './finance';

type Filter = 'open' | 'done' | 'all';

export default function MitraDisputes() {
  const [rows, setRows] = useState<MyDispute[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => {
    try { setRows(await loadMyDisputes()); setErr(null); } catch (e) { setErr((e as Error).message); setRows((r) => r ?? []); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const isOpen = (d: MyDispute) => d.status === 'open' || d.status === 'investigating';
  const list = (rows ?? []).filter((d) => filter === 'all' || (filter === 'open' ? isOpen(d) : !isOpen(d)));
  return (
    <Screen title="Laporan selisih" back scroll={false} padded={false}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 40, maxWidth: 720, width: '100%', alignSelf: 'center' }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
        <Text style={font.small}>Laporan nominal tidak sesuai atau pencairan yang belum masuk. Tim keuangan memeriksa buku besar & data bank/penyedia pembayaran, lalu menuliskan hasilnya di sini.</Text>
        <Row gap={8}>
          {([['all', 'Semua'], ['open', 'Diproses'], ['done', 'Selesai']] as const).map(([k, l]) => <Chip key={k} label={l} active={filter === k} onPress={() => setFilter(k)} />)}
        </Row>
        {err ? (
          <View style={{ padding: 12, borderRadius: radius.md, backgroundColor: colors.warning + '14', gap: 6 }}>
            <Text style={[font.small, { color: colors.text }]}>Daftar belum bisa dimuat: {err}</Text>
            <Button title="Coba lagi" size="sm" variant="ghost" icon="refresh" onPress={load} />
          </View>
        ) : null}
        {!rows ? <View style={{ gap: 8 }}><Skeleton height={64} radius={radius.md} /><Skeleton height={64} radius={radius.md} /></View>
          : list.length === 0 ? <Empty icon="flag-outline" title="Belum ada laporan" subtitle="Buka rincian pesanan selesai lalu ketuk “Laporkan selisih” bila ada nominal yang tidak sesuai." />
          : list.map((d, i) => <Entrance key={d.id} index={Math.min(i, 6)}><DisputeRow d={d} /></Entrance>)}
      </ScrollView>
    </Screen>
  );
}
