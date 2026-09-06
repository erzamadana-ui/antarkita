import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, Pressable, ActivityIndicator, StyleSheet, ViewStyle, TextStyle, TextInputProps, StyleProp,
  Platform, ScrollView, KeyboardAvoidingView, Image,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { BlurView } from 'expo-blur';
import Animated, { FadeInDown, FadeOutUp, useSharedValue, useAnimatedStyle, withSpring, useReducedMotion, LinearTransition } from 'react-native-reanimated';
import { colors, radius, shadow, spacing, font, glass, motion } from '@/lib/theme';
import { initials } from '@/lib/format';
import { PressableScale } from '@/components/motion';
import { LogoPulse } from '@/components/Logo';
import { AmbientBackground, BrandGradient, Glass } from '@/components/glass';

export type IconName = React.ComponentProps<typeof Ionicons>['name'];
export const Icon = Ionicons;

// ---------- Button ----------
interface ButtonProps {
  title: string; onPress?: () => void | Promise<void>; variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'glass';
  loading?: boolean; disabled?: boolean; icon?: IconName; style?: StyleProp<ViewStyle>; size?: 'md' | 'sm' | 'lg'; color?: string;
}
export function Button({ title, onPress, variant = 'primary', loading, disabled, icon, style, size = 'md', color }: ButtonProps) {
  const [busy, setBusy] = useState(false);
  const isLoading = loading || busy;
  const c = color ?? colors.primary;
  const fg = variant === 'primary' || variant === 'danger' ? '#fff' : variant === 'secondary' ? colors.primaryDark : c;
  const height = size === 'lg' ? 54 : size === 'sm' ? 38 : 48;
  const handle = async () => {
    if (!onPress || isLoading || disabled) return;
    try { setBusy(true); await onPress(); } finally { setBusy(false); }
  };
  const inner = isLoading ? <ActivityIndicator color={fg} /> : (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      {icon && <Ionicons name={icon} size={size === 'sm' ? 16 : 20} color={fg} />}
      <Text style={{ color: fg, fontWeight: '800', fontSize: size === 'sm' ? 14 : 16, letterSpacing: 0.1 }}>{title}</Text>
    </View>
  );
  const shape: ViewStyle = { height, borderRadius: size === 'sm' ? 12 : 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: size === 'sm' ? 14 : 20, overflow: 'hidden' };
  if (variant === 'primary' || variant === 'danger') {
    const bgc = variant === 'danger' ? '#E5484D' : c;
    return (
      <PressableScale onPress={handle} disabled={disabled || isLoading} style={[size !== 'sm' && shadow.soft, { borderRadius: shape.borderRadius }, style]}>
        <View style={[shape, { backgroundColor: bgc }]}>{inner}</View>
      </PressableScale>
    );
  }
  const bg = variant === 'secondary' ? c + '1A' : variant === 'glass' ? colors.tint : 'transparent';
  return (
    <PressableScale onPress={handle} disabled={disabled || isLoading} style={[shape, { backgroundColor: bg, borderWidth: variant === 'outline' ? 1.5 : variant === 'glass' ? 1 : 0, borderColor: variant === 'glass' ? glass.border : c }, style]}>
      {inner}
    </PressableScale>
  );
}
function lighten(hex: string) {
  const m = hex.replace('#', '');
  if (m.length !== 6) return hex;
  const n = parseInt(m, 16); const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const f = (v: number) => Math.min(255, Math.round(v + (255 - v) * 0.18));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

// ---------- Input ----------
interface InputProps extends TextInputProps {
  label?: string; error?: string | null; icon?: IconName; right?: React.ReactNode; containerStyle?: StyleProp<ViewStyle>;
}
export function Input({ label, error, icon, right, containerStyle, style, ...rest }: InputProps) {
  const [focus, setFocus] = useState(false);
  const glow = useSharedValue(0);
  useEffect(() => { glow.value = withSpring(focus ? 1 : 0, motion.springSoft); }, [focus, glow]);
  const a = useAnimatedStyle(() => ({ borderColor: focus ? colors.primary : 'rgba(11,31,42,0.10)', shadowOpacity: glow.value * 0.18 }));
  return (
    <View style={[{ gap: 6 }, containerStyle]}>
      {label ? <Text style={s.label}>{label}</Text> : null}
      <Animated.View style={[s.inputWrap, a, error ? { borderColor: colors.danger } : null]}>
        {icon && <Ionicons name={icon} size={18} color={focus ? colors.primary : colors.textMuted} style={{ marginRight: 8 }} />}
        <TextInput placeholderTextColor={colors.textMuted} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} style={[s.input, rest.multiline && { minHeight: 64, textAlignVertical: 'top' }, style]} {...rest}
          value={rest.value == null ? rest.value : String(rest.value)} />
        {right}
      </Animated.View>
      {error ? <Text style={{ color: colors.danger, fontSize: 12 }}>{error}</Text> : null}
    </View>
  );
}

// ---------- Card ----------
export function Card({ children, style, onPress, padded = true, solid, variant }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; padded?: boolean; solid?: boolean; variant?: 'light' | 'strong' | 'soft' }) {
  const content = solid
    ? <View style={[s.card, padded && { padding: spacing.lg }, style]}>{children}</View>
    : <Glass variant={variant ?? 'strong'} style={style} padded={padded}>{children}</Glass>;
  if (!onPress) return content;
  return <PressableScale onPress={onPress} scaleTo={0.985}>{content}</PressableScale>;
}

// ---------- Screen (header kaca + latar ambien) ----------
interface ScreenProps {
  title?: string; children: React.ReactNode; scroll?: boolean; back?: boolean; right?: React.ReactNode; padded?: boolean;
  bg?: string; headerBg?: string; headerFg?: string; footer?: React.ReactNode; contentStyle?: StyleProp<ViewStyle>; keyboard?: boolean; maxWidth?: number;
  ambient?: boolean | 'teal' | 'amber' | 'mixed'; bottomSpace?: number;
  /** Header band berwarna layanan (teks putih, sudut bawah membulat) — pola "Solid Motion". */
  band?: string; subtitle?: string;
}
export function Screen({ title, children, scroll = true, back, right, padded = true, bg, headerBg, headerFg, footer, contentStyle, keyboard = true, maxWidth = 720, ambient = true, bottomSpace = 40, band, subtitle }: ScreenProps) {
  const router = useRouter();
  // Gaya kit: header selalu putih, judul di tengah; `band` hanya dipakai sebagai aksen ikon kembali
  const accent = band ?? colors.primary; band = undefined;
  headerFg = headerFg ?? colors.text;
  const insets = useSafeAreaInsetsSafe();
  const inner = { width: '100%' as const, maxWidth, alignSelf: 'center' as const };
  const body = scroll ? (
    <ScrollView contentContainerStyle={[padded && { padding: spacing.lg }, { paddingBottom: bottomSpace }, inner, contentStyle]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      {children}
    </ScrollView>
  ) : (
    <View style={[{ flex: 1 }, padded && { padding: spacing.lg }, inner, contentStyle]}>{children}</View>
  );
  return (
    <View style={{ flex: 1, backgroundColor: bg ?? colors.bg }}>
      {ambient ? <AmbientBackground tint={typeof ambient === 'string' ? ambient : 'teal'} /> : null}
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        {(title || back || right) && (
          <View style={[s.header, headerBg ? { backgroundColor: headerBg, borderBottomWidth: 0 } : null, band ? s.band : null]}>
            <View style={[s.headerInner, inner, subtitle ? { height: 66 } : null]}>
              {back ? (
                <PressableScale onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} hitSlop={12} style={[s.backBtn, band ? { backgroundColor: 'rgba(255,255,255,0.18)', borderColor: 'rgba(255,255,255,0.25)' } : null]} scaleTo={0.9}>
                  <Ionicons name="chevron-back" size={20} color={headerBg ? headerFg : accent} />
                </PressableScale>
              ) : <View style={{ width: 40 }} />}
              <View style={{ flex: 1, alignItems: 'center' }}>
                <Text style={[font.h3, { color: headerFg, fontSize: subtitle ? 18 : 17, textAlign: 'center' }]} numberOfLines={1}>{title}</Text>
                {subtitle ? <Text style={[font.tiny, { color: band ? 'rgba(255,255,255,0.85)' : colors.textSecondary, textAlign: 'center' }]} numberOfLines={1}>{subtitle}</Text> : null}
              </View>
              {right ? <View style={{ minWidth: 40, alignItems: 'flex-end' }}>{right}</View> : <View style={{ width: 40 }} />}
            </View>
          </View>
        )}
        {keyboard && Platform.OS === 'ios' ? <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>{body}</KeyboardAvoidingView> : body}
        {footer && (
          <View style={[s.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
            {Platform.OS !== 'android' && <BlurView intensity={glass.blurStrong} tint="light" style={StyleSheet.absoluteFill} />}
            <View style={inner}>{footer}</View>
          </View>
        )}
      </SafeAreaView>
    </View>
  );
}
function useSafeAreaInsetsSafe() { try { return useSafeAreaInsets(); } catch { return { bottom: 0, top: 0, left: 0, right: 0 }; } }

// ---------- Small pieces ----------
export function Row({ children, style, gap = 8, between }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; gap?: number; between?: boolean }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap }, between && { justifyContent: 'space-between' }, style]}>{children}</View>;
}
export function Divider({ style }: { style?: StyleProp<ViewStyle> }) { return <View style={[{ height: 1, backgroundColor: 'rgba(11,31,42,0.07)', marginVertical: spacing.md }, style]} />; }
export function Badge({ text, color = colors.primary, bg, style }: { text: string; color?: string; bg?: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ backgroundColor: bg ?? color + '1A', paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.full, alignSelf: 'flex-start', borderWidth: 1, borderColor: color + '22' }, style]}>
      <Text style={{ color, fontSize: 12, fontWeight: '800' }}>{text}</Text>
    </View>
  );
}
export function Avatar({ name, url, size = 44 }: { name?: string | null; url?: string | null; size?: number }) {
  if (url) return <Image source={{ uri: url }} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.border }} />;
  return (
    <BrandGradient colors={[colors.primaryLight, '#CFE9E7']} style={{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: colors.primaryDark, fontWeight: '800', fontSize: size * 0.38 }}>{initials(name)}</Text>
    </BrandGradient>
  );
}
/** Tombol bulat bergaris (kit): ikon di lingkaran putih 40px dengan border tipis; `filled` → teal penuh. */
export function CircleButton({ icon, onPress, size = 40, color = colors.text, filled, badge, style }: { icon: IconName; onPress?: () => void; size?: number; color?: string; filled?: boolean; badge?: number; style?: StyleProp<ViewStyle> }) {
  return (
    <PressableScale onPress={onPress} scaleTo={0.9} style={[{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: filled ? colors.primary : '#fff', borderWidth: filled ? 0 : 1, borderColor: colors.border }, style]}>
      <Ionicons name={icon} size={Math.round(size * 0.48)} color={filled ? '#fff' : color} />
      {badge ? <View style={{ position: 'absolute', top: -2, right: -2, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 }}><Text style={{ color: '#fff', fontSize: 12, fontWeight: '800' }}>{badge > 9 ? '9+' : badge}</Text></View> : null}
    </PressableScale>
  );
}
export function IconCircle({ name, color = colors.primary, size = 44, bg }: { name: IconName; color?: string; size?: number; bg?: string }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg ?? color + '1A', alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name={name} size={size * 0.5} color={color} />
    </View>
  );
}
export function Loading({ text, compact }: { text?: string; compact?: boolean }) {
  if (compact) return <View style={{ alignItems: 'center', padding: 16 }}><ActivityIndicator color={colors.primary} /></View>;
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 }}>
      <LogoPulse size={64} text={text} />
    </View>
  );
}
export function Empty({ icon = 'file-tray-outline', title, subtitle, action }: { icon?: IconName; title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <Animated.View entering={FadeInDown.duration(motion.slow)} style={{ alignItems: 'center', padding: 32, gap: 8 }}>
      <IconCircle name={icon} size={76} color={colors.textMuted} bg="rgba(11,31,42,0.06)" />
      <Text style={[font.h3, { marginTop: 8 }]}>{title}</Text>
      {subtitle ? <Text style={[font.small, { textAlign: 'center' }]}>{subtitle}</Text> : null}
      {action ? <View style={{ marginTop: 12 }}>{action}</View> : null}
    </Animated.View>
  );
}
export function ListItem({ icon, iconColor = colors.primary, title, subtitle, right, onPress, danger }: { icon?: IconName; iconColor?: string; title: string; subtitle?: string; right?: React.ReactNode; onPress?: () => void; danger?: boolean }) {
  return (
    <PressableScale onPress={onPress} disabled={!onPress} scaleTo={0.985} haptic={false} style={s.listItem}>
      {icon && <IconCircle name={icon} color={danger ? colors.danger : iconColor} size={38} />}
      <View style={{ flex: 1 }}>
        <Text style={[font.body, { fontWeight: '600' }, danger && { color: colors.danger }]}>{title}</Text>
        {subtitle ? <Text style={font.small}>{subtitle}</Text> : null}
      </View>
      {right ?? (onPress ? <Ionicons name="chevron-forward" size={18} color={colors.textMuted} /> : null)}
    </PressableScale>
  );
}
export function Stars({ value, size = 14, onChange }: { value: number; size?: number; onChange?: (v: number) => void }) {
  return (
    <Row gap={2}>
      {[1, 2, 3, 4, 5].map((i) => (
        <PressableScale key={i} onPress={onChange ? () => onChange(i) : undefined} disabled={!onChange} hitSlop={4} scaleTo={0.8}>
          <Ionicons name={i <= Math.round(value) ? 'star' : 'star-outline'} size={size} color={colors.accent} />
        </PressableScale>
      ))}
    </Row>
  );
}
export function Chip({ label, active, onPress, color = colors.primary }: { label: string; active?: boolean; onPress?: () => void; color?: string }) {
  return (
    <PressableScale onPress={onPress} scaleTo={0.94} style={[s.chip, active && { backgroundColor: color, borderColor: color }]}>
      <Text style={{ color: active ? '#fff' : colors.text, fontWeight: '700', fontSize: 13 }}>{label}</Text>
    </PressableScale>
  );
}
export function SectionTitle({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <Row between style={{ marginBottom: 10, marginTop: 4 }}>
      <Text style={font.h3}>{title}</Text>
      {action ? <Pressable onPress={onAction}><Text style={{ color: colors.primary, fontWeight: '700' }}>{action}</Text></Pressable> : null}
    </Row>
  );
}
export function Stepper({ value, onChange, min = 0, max = 99 }: { value: number; onChange: (v: number) => void; min?: number; max?: number }) {
  const btn = (name: IconName, fn: () => void, disabled: boolean) => (
    <PressableScale onPress={fn} disabled={disabled} hitSlop={6} scaleTo={0.85} style={s.stepBtn}>
      <Ionicons name={name} size={16} color={colors.primary} />
    </PressableScale>
  );
  return (
    <Row gap={10}>
      {btn('remove', () => onChange(value - 1), value <= min)}
      <Animated.Text key={value} entering={FadeInDown.duration(motion.fast)} style={{ fontWeight: '800', minWidth: 20, textAlign: 'center', color: colors.text }}>{value}</Animated.Text>
      {btn('add', () => onChange(value + 1), value >= max)}
    </Row>
  );
}

// ---------- Toast (pegas dari atas) ----------
type ToastMsg = { id: number; text: string; type: 'info' | 'error' | 'success' };
let pushToast: ((t: ToastMsg) => void) | null = null;
export const toast = {
  show: (text: string, type: ToastMsg['type'] = 'info') => pushToast?.({ id: Date.now(), text, type }),
  error: (text: string) => pushToast?.({ id: Date.now(), text, type: 'error' }),
  success: (text: string) => pushToast?.({ id: Date.now(), text, type: 'success' }),
};
export function ToastHost() {
  const [msg, setMsg] = useState<ToastMsg | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const insets = useSafeAreaInsetsSafe();
  useEffect(() => {
    pushToast = (t) => { setMsg(t); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => setMsg(null), 3200); };
    return () => { pushToast = null; };
  }, []);
  if (!msg) return null;
  const c = msg.type === 'error' ? colors.danger : msg.type === 'success' ? colors.success : colors.text;
  const icon: IconName = msg.type === 'error' ? 'alert-circle' : msg.type === 'success' ? 'checkmark-circle' : 'information-circle';
  return (
    <Animated.View key={msg.id} entering={FadeInDown.springify().stiffness(280).damping(16)} exiting={FadeOutUp.duration(180)} pointerEvents="none" style={[s.toast, { top: insets.top + 12 }]}>
      <Glass variant="strong" radius={radius.lg} style={{ maxWidth: 520, width: '100%' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14 }}>
          <Ionicons name={icon} size={22} color={c} />
          <Text style={{ color: colors.text, fontWeight: '600', flex: 1 }}>{msg.text}</Text>
        </View>
      </Glass>
    </Animated.View>
  );
}

// ---------- Bottom sheet statis (dipakai place-picker) ----------
export function Sheet({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const insets = useSafeAreaInsetsSafe();
  return (
    <Animated.View entering={FadeInDown.duration(motion.base)} layout={LinearTransition} style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 16) }, style]}>
      {Platform.OS !== 'android' && <BlurView intensity={glass.blurStrong} tint="light" style={StyleSheet.absoluteFill} />}
      <View style={s.handle} />
      {children}
    </Animated.View>
  );
}

export function Money({ value, style }: { value: number; style?: TextStyle }) {
  return <Text style={[{ fontWeight: '800', color: colors.text }, style]}>{'Rp' + Math.round(value).toLocaleString('id-ID')}</Text>;
}

export { useReducedMotion };

const s = StyleSheet.create({
  label: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  inputWrap: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: 'rgba(11,31,42,0.10)', borderRadius: radius.md, backgroundColor: '#FFFFFF', paddingHorizontal: 12, minHeight: 50, shadowColor: colors.primary, shadowRadius: 10, shadowOffset: { width: 0, height: 0 } },
  input: { flex: 1, minWidth: 0, fontSize: 15, color: colors.text, paddingVertical: 10, ...(Platform.OS === 'web' ? ({ outlineStyle: 'none', WebkitTextFillColor: colors.text, caretColor: colors.primary } as object) : {}) },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, ...shadow.card },
  header: { overflow: 'hidden', backgroundColor: colors.bg },
  headerInner: { flexDirection: 'row', alignItems: 'center', height: 60, paddingHorizontal: 16, gap: 8 },
  band: { borderBottomLeftRadius: radius.lg, borderBottomRightRadius: radius.lg, paddingBottom: 6, ...shadow.soft },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border },
  footer: { overflow: 'hidden', paddingHorizontal: spacing.lg, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(11,31,42,0.08)', backgroundColor: Platform.OS === 'android' ? 'rgba(255,255,255,0.98)' : 'rgba(255,255,255,0.9)' },
  listItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 4 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, backgroundColor: '#FFFFFF', ...shadow.soft },
  stepBtn: { width: 30, height: 30, borderRadius: 15, borderWidth: 1.5, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' },
  toast: { position: 'absolute', left: 20, right: 20, alignItems: 'center', zIndex: 1000 },
  sheet: { backgroundColor: Platform.OS === 'android' ? 'rgba(255,255,255,0.98)' : 'rgba(255,255,255,0.92)', borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.lg, overflow: 'hidden', borderTopWidth: 1, borderColor: glass.border, ...shadow.sheet },
  handle: { width: 44, height: 5, borderRadius: 3, backgroundColor: 'rgba(11,31,42,0.18)', alignSelf: 'center', marginBottom: 12, marginTop: -6 },
});
