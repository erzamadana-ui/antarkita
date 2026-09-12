// Aplikasi Mitra — halaman "Kode AntarNow saya" (Tahap 11 / migrasi 0030).
// Driver membacakan/menunjukkan kode 6 karakter ini kepada pelanggan yang ditemui langsung
// (mangkal, langganan, jemput di lokasi yang sama). Pelanggan memasukkannya di alur pemesanan
// sehingga order LANGSUNG ditawarkan ke driver ini tanpa pencarian acak.
//
// Sumber data: rpc('driver_my_code') → { code, orders_direct_today, share_text }
//              rpc('driver_direct_stats') → { code, today, this_week, total, completed, hold_seconds, fallback }
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Screen, Row, Button, Loading, Empty, Badge, toast } from '@/components/ui';
import { Entrance } from '@/components/motion';
import { BigCode, holdText } from '@/components/antarnow';
import { rpc } from '@/lib/supabase';
import { colors, font, radius, shadow } from '@/lib/theme';
import type { DriverDirectStats, DriverMyCode } from '@/lib/types';

export default function DriverCodeScreen() {
  const [mine, setMine] = useState<DriverMyCode | null>(null);
  const [stats, setStats] = useState<DriverDirectStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [m, st] = await Promise.all([
        rpc<DriverMyCode>('driver_my_code'),
        rpc<DriverDirectStats>('driver_direct_stats').catch(() => null),   // statistik opsional
      ]);
      setMine(m);
      setStats(st);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const code = mine?.code ?? stats?.code ?? null;
  const shareText = mine?.share_text ?? (code ? `Pesan saya langsung di AntarKita! Buka aplikasi → AntarNow → masukkan kode ${code}.` : '');

  const copy = async () => {
    if (!code) return;
    await Clipboard.setStringAsync(code);
    toast.success(`Kode ${code} disalin`);
  };
  const share = async () => {
    if (!shareText) return;
    try { await Share.share({ message: shareText }); } catch { /* dibatalkan pengguna */ }
  };

  if (loading) return <Screen title="Kode AntarNow" back><Loading text="Memuat kode Anda…" /></Screen>;
  if (!code) {
    return (
      <Screen title="Kode AntarNow" back>
        <Empty icon="key-outline" title="Kode belum tersedia"
          subtitle={error ?? 'Kode AntarNow hanya untuk mitra driver yang sudah disetujui admin.'}
          action={<Button title="Coba lagi" variant="secondary" icon="refresh" onPress={load} />} />
      </Screen>
    );
  }

  const holdSeconds = stats?.hold_seconds ?? 120;
  const fallback = stats?.fallback ?? true;

  return (
    <Screen title="Kode AntarNow" subtitle="Pelanggan memesan Anda langsung" back maxWidth={560}>
      <View style={{ gap: 14 }}>
        <Entrance index={0}>
          <View style={s.hero}>
            <Row gap={6}><Ionicons name="flash" size={16} color={colors.primary} /><Text style={[font.label, { color: colors.primary }]}>Kode AntarNow saya</Text></Row>
            <View style={{ marginTop: 12 }}><BigCode code={code} /></View>
            <Text style={[font.tiny, { textAlign: 'center', marginTop: 10 }]}>
              Bacakan atau tunjukkan kode ini kepada pelanggan yang Anda temui langsung.
              Kode tidak memakai angka 0, huruf O, angka 1, dan huruf I agar tidak tertukar.
            </Text>
            {/* alignSelf stretch: induk kartu memakai alignItems center — tanpa ini baris tombol menyusut & judulnya terpotong */}
            <Row gap={8} style={{ marginTop: 14, alignSelf: 'stretch' }}>
              <Button title="Salin" icon="copy-outline" variant="secondary" onPress={copy} style={{ flex: 1 }} />
              <Button title="Bagikan" icon="share-social-outline" onPress={share} style={{ flex: 1 }} />
            </Row>
          </View>
        </Entrance>

        <Entrance index={1}>
          <View style={s.card}>
            <Row between>
              <Text style={font.label}>Order langsung ke saya</Text>
              <Badge text={fallback ? 'Fallback aktif' : 'Tanpa fallback'} color={fallback ? colors.info : colors.warning} />
            </Row>
            <Row gap={8} style={{ marginTop: 10 }}>
              <StatBox label="Hari ini" value={stats?.today ?? mine?.orders_direct_today ?? 0} highlight />
              <StatBox label="Minggu ini" value={stats?.this_week ?? 0} />
            </Row>
            <Row gap={8} style={{ marginTop: 8 }}>
              <StatBox label="Total" value={stats?.total ?? 0} />
              <StatBox label="Selesai" value={stats?.completed ?? 0} />
            </Row>
            {!stats && <Text style={[font.tiny, { marginTop: 8 }]}>Statistik lengkap belum bisa dimuat — angka "hari ini" diambil dari kode Anda.</Text>}
          </View>
        </Entrance>

        <Entrance index={2}>
          <View style={s.card}>
            <Text style={font.label}>Cara kerjanya</Text>
            <Step n={1} text="Pelanggan membuka aplikasi AntarKita, memilih layanan seperti biasa." />
            <Step n={2} text={`Pada halaman pemesanan ia menekan "Punya kode driver? (AntarNow)" lalu mengetik ${code}.`} />
            <Step n={3} text={`Order ditahan ${holdText(holdSeconds)} — HANYA Anda yang melihatnya di daftar order, dengan badge "Order langsung untuk Anda".`} />
            <Step n={4} text={fallback
              ? `Bila Anda tidak menerimanya dalam ${holdText(holdSeconds)}, order dilepas ke driver lain agar pelanggan tidak menunggu terlalu lama.`
              : 'Bila Anda tidak menerimanya, order tetap menunggu Anda (fallback dimatikan admin).'} />
            <Row gap={6} style={{ marginTop: 10, alignItems: 'flex-start' }}>
              <Ionicons name="information-circle-outline" size={16} color={colors.textMuted} />
              <Text style={[font.tiny, { flex: 1 }]}>Pelanggan hanya bisa memesan layanan yang cocok dengan kendaraan Anda. Pastikan Anda online agar tidak melewatkan order langsung.</Text>
            </Row>
          </View>
        </Entrance>

        <Button title="Segarkan" variant="ghost" icon="refresh" color={colors.textSecondary} onPress={load} />
      </View>
    </Screen>
  );
}

function StatBox({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <View style={[s.stat, highlight && { backgroundColor: colors.primaryLight, borderColor: colors.mint }]}>
      <Text style={{ fontSize: 22, fontWeight: '700', color: highlight ? colors.primary : colors.text }}>{value}</Text>
      <Text style={font.tiny}>{label}</Text>
    </View>
  );
}

function Step({ n, text }: { n: number; text: string }) {
  return (
    <Row gap={10} style={{ marginTop: 10, alignItems: 'flex-start' }}>
      <View style={s.stepNo}><Text style={{ fontWeight: '700', color: colors.primary, fontSize: 12 }}>{n}</Text></View>
      <Text style={[font.small, { flex: 1 }]}>{text}</Text>
    </Row>
  );
}

const s = StyleSheet.create({
  hero: { padding: 18, borderRadius: radius.lg, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, alignItems: 'center', ...shadow.card },
  card: { padding: 14, borderRadius: radius.lg, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, ...shadow.soft },
  stat: { flex: 1, padding: 12, borderRadius: radius.md, backgroundColor: colors.bgSoft, borderWidth: 1, borderColor: colors.border, alignItems: 'center', gap: 2 },
  stepNo: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center' },
});
