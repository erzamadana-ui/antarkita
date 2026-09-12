// Penjaga error global: layar tidak "force close" — tampilkan pesan & tombol kembali ke beranda.
import React from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, font, radius } from '@/lib/theme';

type Props = { children: React.ReactNode; onReset?: () => void };
type State = { error: Error | null };

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State { return { error }; }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('[AntarKita] Layar gagal dirender:', error?.message, info?.componentStack?.slice(0, 400));
  }
  reset = () => { this.setState({ error: null }); this.props.onReset?.(); };
  render() {
    if (!this.state.error) return this.props.children;
    const msg = String(this.state.error?.message ?? this.state.error ?? 'Terjadi kesalahan');
    return (
      <ScrollView contentContainerStyle={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 28, backgroundColor: colors.bg }}>
        <View style={{ width: 96, height: 96, borderRadius: 48, backgroundColor: colors.dangerLight, alignItems: 'center', justifyContent: 'center', marginBottom: 18 }}>
          <Ionicons name="alert-circle-outline" size={52} color={colors.danger} />
        </View>
        <Text style={[font.h2, { textAlign: 'center' }]}>Ada yang tidak beres</Text>
        <Text style={[font.small, { textAlign: 'center', marginTop: 8 }]}>Layar ini gagal ditampilkan. Kami sudah mencatatnya. Ketuk tombol di bawah untuk kembali.</Text>
        <Text style={[font.tiny, { textAlign: 'center', marginTop: 12, color: colors.textMuted }]} numberOfLines={4}>{msg}</Text>
        <Pressable onPress={this.reset} accessibilityRole="button" style={{ marginTop: 22, backgroundColor: colors.primary, paddingHorizontal: 24, height: 50, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', minWidth: 220 }}>
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>Kembali ke beranda</Text>
        </Pressable>
      </ScrollView>
    );
  }
}
