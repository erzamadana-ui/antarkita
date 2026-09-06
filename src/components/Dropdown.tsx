// Dropdown/select gaya kit "Solid Motion": satu baris ringkas menampilkan pilihan terpilih,
// diketuk → bottom-sheet modal berisi daftar pilihan (nama, keterangan, meta seperti jam buka & jarak).
// Dipakai antara lain untuk memilih gudang AntarSend (asal & tujuan).
import React, { useState } from 'react';
import { View, Text, StyleSheet, Modal, Pressable, ScrollView, Platform, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { PressableScale } from '@/components/motion';
import { colors, font, glass, motion, radius, shadow } from '@/lib/theme';
import type { IconName } from '@/components/ui';

export interface DropdownOption<T = string> {
  value: T;
  /** Baris utama (mis. nama gudang). */
  label: string;
  /** Baris kedua (mis. alamat). */
  sublabel?: string;
  /** Baris ketiga kecil (mis. "Buka 08.00–20.00 · 2,4 km"). */
  meta?: string;
  icon?: IconName;
  disabled?: boolean;
  /** Alasan singkat bila pilihan dinonaktifkan. */
  disabledNote?: string;
}

interface DropdownProps<T> {
  label?: string;
  value: T | null | undefined;
  options: DropdownOption<T>[];
  onChange: (value: T, option: DropdownOption<T>) => void;
  placeholder?: string;
  /** Tampilan baris pilihan khusus (opsional) — dipakai di dalam daftar modal. */
  renderOption?: (option: DropdownOption<T>, selected: boolean) => React.ReactNode;
  /** Judul di kepala daftar; bila kosong memakai `label`. */
  title?: string;
  /** Teks saat daftar kosong. */
  emptyText?: string;
  /** Keterangan kecil di bawah kotak. */
  helper?: string;
  accent?: string;
  disabled?: boolean;
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
}

export function Dropdown<T extends string | number>({
  label, value, options, onChange, placeholder = 'Pilih…', renderOption, title, emptyText = 'Belum ada pilihan.',
  helper, accent = colors.primary, disabled, icon, style,
}: DropdownProps<T>) {
  const [open, setOpen] = useState(false);
  const { height } = useWindowDimensions();
  const selected = options.find((o) => o.value === value) ?? null;
  const pick = (o: DropdownOption<T>) => { if (o.disabled) return; setOpen(false); onChange(o.value, o); };

  return (
    <View style={[{ gap: 6 }, style]}>
      {label ? <Text style={font.label}>{label}</Text> : null}
      <PressableScale
        onPress={() => { if (!disabled) setOpen(true); }}
        disabled={disabled}
        scaleTo={0.99}
        haptic={false}
        accessibilityRole="button"
        accessibilityLabel={`${label ?? 'Pilihan'}: ${selected?.label ?? placeholder}`}
        style={[s.field, open && { borderColor: accent }, disabled && { opacity: 0.6 }]}
      >
        <View style={[s.fieldIcon, { backgroundColor: (selected ? accent : colors.textMuted) + '1A' }]}>
          <Ionicons name={(selected?.icon ?? icon ?? 'list-outline') as never} size={16} color={selected ? accent : colors.textMuted} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[s.value, !selected && { color: colors.textMuted, fontWeight: '600' }]} numberOfLines={1}>{selected?.label ?? placeholder}</Text>
          {selected?.sublabel || selected?.meta ? <Text style={font.tiny} numberOfLines={1}>{[selected?.sublabel, selected?.meta].filter(Boolean).join(' · ')}</Text> : null}
        </View>
        <Ionicons name="chevron-down" size={18} color={colors.textSecondary} />
      </PressableScale>
      {helper ? <Text style={font.tiny}>{helper}</Text> : null}

      <Modal visible={open} transparent animationType={Platform.OS === 'web' ? 'fade' : 'slide'} onRequestClose={() => setOpen(false)}>
        <Pressable style={s.backdrop} onPress={() => setOpen(false)} accessibilityLabel="Tutup daftar">
          <Pressable style={s.sheetWrap} onPress={() => {}}>
            <Animated.View entering={FadeInDown.duration(motion.base)} style={s.sheet}>
              <View style={s.handle} />
              <View style={s.sheetHead}>
                <Text style={font.h3} numberOfLines={1}>{title ?? label ?? 'Pilih'}</Text>
                <PressableScale onPress={() => setOpen(false)} scaleTo={0.9} style={s.close}><Ionicons name="close" size={18} color={colors.textSecondary} /></PressableScale>
              </View>
              <ScrollView style={{ maxHeight: Math.max(220, height * 0.55) }} contentContainerStyle={{ gap: 8, paddingBottom: 6 }} showsVerticalScrollIndicator={false}>
                {options.length === 0 ? <Text style={[font.small, { padding: 12 }]}>{emptyText}</Text> : null}
                {options.map((o, i) => {
                  const sel = o.value === value;
                  return (
                    <Animated.View key={String(o.value)} entering={FadeIn.delay(Math.min(i, 8) * 20).duration(motion.base)}>
                      <PressableScale onPress={() => pick(o)} disabled={o.disabled} scaleTo={0.985} haptic={false} style={[s.option, sel && { borderColor: accent, backgroundColor: accent + '10' }]}>
                        {renderOption ? renderOption(o, sel) : (
                          <>
                            <View style={[s.optIcon, { backgroundColor: (o.disabled ? colors.textMuted : accent) + '1A' }]}>
                              <Ionicons name={(o.icon ?? 'ellipse-outline') as never} size={18} color={o.disabled ? colors.textMuted : accent} />
                            </View>
                            <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
                              <Text style={s.optLabel} numberOfLines={1}>{o.label}</Text>
                              {o.sublabel ? <Text style={font.tiny} numberOfLines={2}>{o.sublabel}</Text> : null}
                              {o.meta ? <Text style={[font.tiny, { color: colors.textSecondary }]} numberOfLines={1}>{o.meta}</Text> : null}
                              {o.disabled && o.disabledNote ? <Text style={[font.tiny, { color: colors.danger }]} numberOfLines={2}>{o.disabledNote}</Text> : null}
                            </View>
                            {sel ? <Ionicons name="checkmark-circle" size={20} color={accent} /> : null}
                          </>
                        )}
                      </PressableScale>
                    </Animated.View>
                  );
                })}
              </ScrollView>
            </Animated.View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  field: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.md, borderWidth: 1.5, borderColor: glass.border, backgroundColor: '#FFFFFF' },
  fieldIcon: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  value: { fontSize: 14, fontWeight: '700', color: colors.text },
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheetWrap: { width: '100%', maxWidth: 640, alignSelf: 'center' },
  sheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: 16, paddingTop: 10, paddingBottom: 24, gap: 10, borderTopWidth: 1, borderColor: glass.border, ...shadow.sheet },
  handle: { width: 44, height: 5, borderRadius: 3, backgroundColor: 'rgba(11,31,42,0.18)', alignSelf: 'center', marginBottom: 6 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'space-between' },
  close: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(11,31,42,0.06)', alignItems: 'center', justifyContent: 'center' },
  option: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: radius.md, borderWidth: 1.5, borderColor: glass.border, backgroundColor: '#FFFFFF' },
  optIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  optLabel: { fontSize: 14, fontWeight: '800', color: colors.text },
});
