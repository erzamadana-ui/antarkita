import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { View, Text, Alert, Platform, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Screen, Row, Avatar, Badge, CircleButton, type IconName } from '@/components/ui';
import { Entrance, PressableScale } from '@/components/motion';
import { TAB_BAR_SPACE } from '@/components/GlassTabBar';
import { useAuth } from '@/store/auth';
import { useMyOrders } from '@/hooks/useOrder';
import { useT, useI18n, LOCALES } from '@/lib/i18n';
import { colors, font, radius, shadow } from '@/lib/theme';
import { phoneDisplay, rupiah } from '@/lib/format';
import { openApp, APP_URL } from '@/lib/app';

type Item = { icon: IconName; color?: string; title: string; subtitle?: string; onPress: () => void; danger?: boolean };

export default function Account() {
  const router = useRouter();
  const [hasExec, setHasExec] = useState(false);
  const uid = useAuth((st) => st.session?.user.id);
  useEffect(() => { if (uid) supabase.from('exec_access').select('user_id').eq('user_id', uid).eq('active', true).maybeSingle().then(({ data }) => setHasExec(!!data)); }, [uid]);
  const { profile, wallet, signOut } = useAuth();
  const { orders } = useMyOrders('customer', uid);
  const t = useT();
  const locale = useI18n((s) => s.locale);

  const confirmSignOut = () => {
    const doIt = async () => { await signOut(); router.replace('/(auth)/welcome'); };
    if (Platform.OS === 'web') { if (confirm('Keluar dari akun?')) doIt(); return; }
    Alert.alert('Keluar', 'Keluar dari akun AntarKita?', [{ text: 'Batal' }, { text: 'Keluar', style: 'destructive', onPress: doIt }]);
  };
  const roleLabel = profile?.role === 'admin' ? 'Admin' : profile?.role === 'driver' ? 'Mitra Driver' : profile?.role === 'merchant' ? 'Merchant' : 'Pelanggan';

  const groups: { title: string; items: Item[] }[] = [
    { title: 'Akun', items: [
      { icon: 'person-outline', title: t('edit_profile'), subtitle: 'Nama, nomor HP, foto', onPress: () => router.push('/account/edit') },
      { icon: 'bookmark-outline', title: t('saved_places'), subtitle: 'Rumah, kantor, dan lainnya', onPress: () => router.push('/account/places') },
      { icon: 'language-outline', title: t('language'), subtitle: LOCALES.find((l) => l.code === locale)?.native, onPress: () => router.push('/account/language') },
      { icon: 'wallet-outline', title: 'AntarPay', subtitle: `Saldo ${rupiah(wallet?.balance ?? 0)}`, onPress: () => router.push('/(customer)/pay') },
    ] },
    { title: t('others'), items: [
      ...(hasExec ? [{ icon: 'shield-half-outline' as IconName, color: colors.primaryDeep, title: 'Portal Eksekutif', subtitle: 'Laporan manajemen & pemegang saham (di aplikasi Admin)', onPress: () => openApp('admin') }] : []),
      ...(profile?.role === 'admin' ? [{ icon: 'shield-checkmark-outline' as IconName, color: colors.info, title: t('admin_panel'), subtitle: APP_URL.admin, onPress: () => openApp('admin') }] : []),
      { icon: 'shield-checkmark-outline', color: colors.danger, title: 'Pusat Keamanan', subtitle: 'Kontak darurat, bagikan perjalanan, SOS', onPress: () => router.push('/safety' as never) },
      { icon: 'chatbubbles-outline', color: colors.info, title: t('help'), subtitle: t('help_sub'), onPress: () => router.push('/support' as never) },
      { icon: 'log-out-outline', title: t('logout'), danger: true, onPress: confirmSignOut },
      { icon: 'trash-outline', title: 'Hapus akun', subtitle: 'Hapus data pribadi secara permanen', danger: true, onPress: () => router.push('/account/delete' as never) },
    ] },
  ];

  return (
    <Screen title={t('account')} bottomSpace={TAB_BAR_SPACE + 16} right={<CircleButton icon="create-outline" onPress={() => router.push('/account/edit')} />}>
      {/* Profil: avatar besar di tengah + dua statistik */}
      <Entrance index={0} from="zoom">
        <View style={{ alignItems: 'center', marginTop: 8 }}>
          <View style={s.avatarRing}><Avatar name={profile?.full_name} url={profile?.avatar_url} size={96} /></View>
          <Text style={[font.h1, { marginTop: 12, textAlign: 'center' }]}>{profile?.full_name}</Text>
          <Text style={[font.small, { textAlign: 'center' }]}>{phoneDisplay(profile?.phone)}{profile?.email ? ` · ${profile.email}` : ''}</Text>
          <Badge text={roleLabel} style={{ marginTop: 8 }} />
        </View>
      </Entrance>
      <Entrance index={1}>
        <View style={s.stats}>
          <PressableScale onPress={() => router.push('/(customer)/orders')} scaleTo={0.97} haptic={false} style={s.stat}>
            <Text style={[font.h2, { color: colors.primary }]}>{orders.length}</Text>
            <Text style={font.tiny}>Pesanan</Text>
          </PressableScale>
          <View style={s.vDivider} />
          <PressableScale onPress={() => router.push('/(customer)/pay')} scaleTo={0.97} haptic={false} style={s.stat}>
            <Text style={[font.h2, { color: colors.primary }]} numberOfLines={1}>{rupiah(wallet?.balance ?? 0)}</Text>
            <Text style={font.tiny}>Saldo AntarPay</Text>
          </PressableScale>
        </View>
      </Entrance>

      {groups.map((g, gi) => (
        <Entrance key={g.title} index={gi + 2}>
          <Text style={[font.label, { marginTop: 22, marginBottom: 8 }]}>{g.title}</Text>
          <View style={s.card}>
            {g.items.map((it, i) => (
              <PressableScale key={it.title} onPress={it.onPress} scaleTo={0.985} haptic={false} style={[s.item, i < g.items.length - 1 && s.itemBorder]}>
                <View style={[s.itemIcon, it.danger && { backgroundColor: colors.dangerLight }, it.color && !it.danger && { backgroundColor: it.color + '14' }]}>
                  <Ionicons name={it.icon} size={20} color={it.danger ? colors.danger : it.color ?? colors.primary} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[font.body, { fontWeight: '700' }, it.danger && { color: colors.danger }]} numberOfLines={1}>{it.title}</Text>
                  {it.subtitle ? <Text style={font.tiny} numberOfLines={1}>{it.subtitle}</Text> : null}
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
              </PressableScale>
            ))}
          </View>
        </Entrance>
      ))}
      <Row style={{ justifyContent: 'center', marginTop: 24 }}><Text style={font.tiny}>AntarKita v3.0</Text></Row>
    </Screen>
  );
}

const s = StyleSheet.create({
  avatarRing: { padding: 4, borderRadius: 60, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, ...shadow.card },
  stats: { flexDirection: 'row', alignItems: 'center', marginTop: 16, padding: 14, borderRadius: radius.lg, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, ...shadow.soft },
  stat: { flex: 1, alignItems: 'center', gap: 2 },
  vDivider: { width: 1, height: 36, backgroundColor: colors.border },
  card: { backgroundColor: '#fff', borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, ...shadow.soft },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  itemBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  itemIcon: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center' },
});
