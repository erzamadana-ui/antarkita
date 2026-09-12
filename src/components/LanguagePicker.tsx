// Pemilih bahasa: baris bendera (welcome) & daftar lengkap (Akun → Bahasa)
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { PressableScale } from '@/components/motion';
import { toast } from '@/components/ui';
import { useI18n, LOCALES, useT } from '@/lib/i18n';
import { useAuth } from '@/store/auth';
import { supabase } from '@/lib/supabase';
import { colors, radius, glass, font } from '@/lib/theme';
import type { Locale } from '@/lib/types';

export function useSetLocale() {
  const setLocale = useI18n((s) => s.setLocale);
  const session = useAuth((s) => s.session);
  const t = useT();
  return async (l: Locale) => {
    await setLocale(l);
    if (session) supabase.rpc('set_locale', { p_locale: l }).then(() => {});
    toast.success(t('language_saved'));
  };
}

/** Baris kecil bendera (dipakai di welcome). */
export function LanguageRow() {
  const locale = useI18n((s) => s.locale);
  const set = useSetLocale();
  return (
    <View style={s.row}>
      {LOCALES.map((l) => (
        <PressableScale key={l.code} onPress={() => set(l.code)} scaleTo={0.9} haptic={false} style={[s.chip, locale === l.code && s.chipActive]}>
          <Text style={{ fontSize: 16 }}>{l.flag}</Text>
          <Text style={[s.chipText, locale === l.code && { color: colors.primary }]}>{l.code.toUpperCase()}</Text>
        </PressableScale>
      ))}
    </View>
  );
}

/** Daftar lengkap (layar Akun → Bahasa). */
export function LanguageList() {
  const locale = useI18n((s) => s.locale);
  const set = useSetLocale();
  return (
    <View style={{ gap: 10 }}>
      {LOCALES.map((l) => (
        <PressableScale key={l.code} onPress={() => set(l.code)} scaleTo={0.98} style={[s.item, locale === l.code && { borderColor: colors.primary, backgroundColor: colors.primary + '14' }]}>
          <Text style={{ fontSize: 24 }}>{l.flag}</Text>
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: '700', color: colors.text, fontSize: 16 }}>{l.native}</Text>
            <Text style={font.tiny}>{l.label}{l.rtl ? ' · RTL' : ''}</Text>
          </View>
          {locale === l.code && <Ionicons name="checkmark-circle" size={24} color={colors.primary} />}
        </PressableScale>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.full, borderWidth: 1, borderColor: glass.border, backgroundColor: 'rgba(255,255,255,0.92)' },
  chipActive: { borderColor: colors.primary, backgroundColor: colors.primary + '14' },
  chipText: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },
  item: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderRadius: radius.lg, borderWidth: 1.5, borderColor: glass.border, backgroundColor: 'rgba(255,255,255,0.92)' },
});
