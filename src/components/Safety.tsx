// Fitur keamanan ala Gojek/Grab: tombol SOS (tahan 2 detik), bagikan perjalanan, PIN penjemputan,
// verifikasi wajah driver (selfie) sebelum online, kontak darurat.
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Platform, Share, Linking, TextInput, Modal } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { FadeIn, FadeInDown, FadeOut, ZoomIn, useSharedValue, useAnimatedStyle, withTiming, cancelAnimation } from 'react-native-reanimated';
import { Row, Badge, Button, toast, Card } from '@/components/ui';
import { PressableScale, useShake } from '@/components/motion';
import { BrandGradient } from '@/components/glass';
import { DocUpload } from '@/components/DocUpload';
import { rpc, supabase } from '@/lib/supabase';
import { useAuth } from '@/store/auth';
import { useCurrentLocation } from '@/hooks/useLocation';
import { colors, font, radius, shadow, glass, motion } from '@/lib/theme';
import { formatDate } from '@/lib/format';
import type { Order } from '@/lib/types';

const SITE = process.env.EXPO_PUBLIC_SITE_URL ?? (Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.origin + (process.env.EXPO_PUBLIC_BASE_URL ?? '') : 'https://erzamadana-ui.github.io/antarkita');
export const shareUrl = (token: string) => `${SITE}/share/${token}`;

/** Tombol SOS — tahan 2 detik untuk mengirim alarm (mencegah salah pencet). */
export function SosButton({ orderId, compact, style }: { orderId?: string | null; compact?: boolean; style?: object }) {
  const { location } = useCurrentLocation(false);
  const [sent, setSent] = useState(false);
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progress = useSharedValue(0);
  const bar = useAnimatedStyle(() => ({ width: `${progress.value * 100}%` }));

  const fire = async () => {
    setHolding(false);
    try {
      await rpc('sos_trigger', { p_order: orderId ?? null, p_lat: location.lat, p_lng: location.lng, p_note: 'Tombol SOS ditekan' });
      setSent(true); toast.error('🚨 SOS terkirim ke tim keamanan AntarKita. Tetap tenang, CS akan menghubungi Anda.');
      setTimeout(() => setSent(false), 60000);
    } catch (e) { toast.error((e as Error).message); }
  };
  const start = () => { setHolding(true); progress.value = withTiming(1, { duration: 2000 }); timer.current = setTimeout(fire, 2000); };
  const stop = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } cancelAnimation(progress); progress.value = withTiming(0, { duration: 200 }); setHolding(false); };

  return (
    <View style={style}>
      <Pressable onPressIn={start} onPressOut={stop} disabled={sent} style={[s.sos, compact && s.sosCompact, sent && { opacity: 0.6 }, shadow.glow(colors.danger)]}>
        <BrandGradient colors={['#EF4444', '#B91C1C']} style={StyleSheet.absoluteFill} />
        <Animated.View style={[s.sosBar, bar]} />
        <Ionicons name="alert-circle" size={compact ? 18 : 22} color="#fff" />
        {!compact && <Text style={{ color: '#fff', fontWeight: '800', letterSpacing: 1 }}>{sent ? 'SOS TERKIRIM' : holding ? 'TAHAN…' : 'SOS'}</Text>}
      </Pressable>
      {!compact && <Text style={[font.tiny, { textAlign: 'center', marginTop: 4 }]}>Tahan 2 detik · darurat 112</Text>}
    </View>
  );
}

/** Bagikan perjalanan — tautan publik (posisi driver, plat, status) ke keluarga/teman. */
export function ShareTripButton({ order, size = 'md', variant = 'secondary' }: { order: Order; size?: 'sm' | 'md'; variant?: 'secondary' | 'outline' | 'glass' }) {
  const share = async () => {
    const token = order.share_token ?? (await supabase.from('orders').select('share_token').eq('id', order.id).maybeSingle()).data?.share_token;
    if (!token) return toast.error('Tautan belum tersedia');
    const url = shareUrl(token);
    const msg = `Saya sedang dalam perjalanan AntarKita (${order.code}). Pantau posisi driver & status di sini: ${url}`;
    if (Platform.OS === 'web') {
      const nav = navigator as Navigator & { share?: (d: { title: string; text: string; url: string }) => Promise<void> };
      if (nav.share) { try { await nav.share({ title: 'Perjalanan AntarKita', text: msg, url }); return; } catch { /* dibatalkan */ } }
      try { await navigator.clipboard.writeText(url); toast.success('Tautan pantau perjalanan disalin'); } catch { window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank'); }
      return;
    }
    await Share.share({ message: msg, url });
  };
  return <Button title="Bagikan perjalanan" icon="share-social-outline" variant={variant} size={size} color={colors.info} onPress={share} />;
}

/** PIN penjemputan — tampil di layar pelanggan; disebutkan ke driver sebelum berangkat. */
export function PinCard({ orderId, status }: { orderId: string; status: string }) {
  const [pin, setPin] = useState<string | null>(null);
  useEffect(() => { supabase.from('order_pins').select('pin').eq('order_id', orderId).maybeSingle().then(({ data }) => setPin((data as { pin: string } | null)?.pin ?? null)); }, [orderId]);
  if (!pin || !['accepted', 'arrived'].includes(status)) return null;
  return (
    <Animated.View entering={FadeInDown.springify().stiffness(280).damping(16)} style={[s.pinCard, shadow.glow(colors.ride)]}>
      <BrandGradient colors={[colors.ride, '#0F766E']} style={StyleSheet.absoluteFill} />
      <View style={{ flex: 1 }}>
        <Row gap={6}><Ionicons name="shield-checkmark" size={16} color="#fff" /><Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>PIN penjemputan</Text></Row>
        <Text style={{ color: 'rgba(255,255,255,0.9)', fontSize: 12, marginTop: 2 }}>Sebutkan ke driver sebelum naik. Pastikan plat nomor sesuai aplikasi.</Text>
      </View>
      <Row gap={6}>{pin.split('').map((d, i) => <View key={i} style={s.pinDigit}><Text style={{ fontSize: 22, fontWeight: '800', color: colors.ride }}>{d}</Text></View>)}</Row>
    </Animated.View>
  );
}

/** Dialog masukkan PIN (driver) saat memulai perjalanan. */
export function PinPrompt({ visible, onCancel, onSubmit }: { visible: boolean; onCancel: () => void; onSubmit: (pin: string) => Promise<void> }) {
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const { style: shake, shake: doShake } = useShake();
  useEffect(() => { if (visible) setPin(''); }, [visible]);
  const submit = async () => {
    if (pin.length !== 4) return doShake();
    setBusy(true);
    try { await onSubmit(pin); } catch (e) { doShake(); toast.error((e as Error).message); setPin(''); } finally { setBusy(false); }
  };
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable onPress={onCancel} style={s.backdrop}>
        <Pressable onPress={() => {}} style={{ width: '100%', maxWidth: 380 }}>
          <Animated.View entering={ZoomIn.duration(motion.base)} style={[s.dialog, shake]}>
            <View style={[s.pinIcon, { backgroundColor: colors.ride + '1A' }]}><Ionicons name="keypad" size={26} color={colors.ride} /></View>
            <Text style={font.h2}>Masukkan PIN pelanggan</Text>
            <Text style={[font.small, { textAlign: 'center' }]}>Minta 4 digit PIN dari pelanggan untuk memastikan Anda menjemput orang yang benar.</Text>
            <TextInput value={pin} onChangeText={(v) => setPin(v.replace(/\D/g, '').slice(0, 4))} keyboardType="number-pad" maxLength={4} autoFocus style={s.pinInput} placeholder="• • • •" placeholderTextColor={colors.textMuted} onSubmitEditing={submit} />
            <Row gap={8} style={{ alignSelf: 'stretch' }}>
              <Button title="Batal" variant="ghost" onPress={onCancel} style={{ flex: 1 }} />
              <Button title="Mulai perjalanan" color={colors.ride} loading={busy} onPress={submit} style={{ flex: 2 }} disabled={pin.length !== 4} />
            </Row>
          </Animated.View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** Verifikasi wajah driver (selfie) — wajib sebelum online, kedaluwarsa tiap N jam (pengaturan admin). */
export function SelfieGate({ visible, onDone, onCancel }: { visible: boolean; onDone: () => void; onCancel: () => void }) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const loadProfile = useAuth((s) => s.loadProfile);
  const submit = async () => {
    if (!url) return toast.error('Ambil foto selfie dulu');
    setBusy(true);
    try { await rpc('driver_selfie_check', { p_url: url }); await loadProfile(); toast.success('Verifikasi wajah berhasil'); onDone(); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={s.backdrop}>
        <Animated.View entering={ZoomIn.duration(motion.base)} style={[s.dialog, { width: '100%', maxWidth: 420, alignItems: 'stretch' }]}>
          <Row gap={10}><View style={[s.pinIcon, { backgroundColor: colors.info + '1A', width: 44, height: 44 }]}><Ionicons name="person-circle" size={26} color={colors.info} /></View><View style={{ flex: 1 }}><Text style={font.h2}>Verifikasi wajah</Text><Text style={font.tiny}>Wajib sebelum online — memastikan akun dipakai mitra terdaftar (seperti Gojek/Grab).</Text></View></Row>
          <DocUpload label="Selfie sekarang" hint="Wajah jelas, tanpa masker/helm, cahaya cukup" required camera value={url} onChange={setUrl} color={colors.info} />
          <Text style={font.tiny}>Foto disimpan privat untuk audit keamanan (UU PDP) dan dibandingkan admin dengan foto KTP.</Text>
          <Row gap={8}>
            <Button title="Nanti" variant="ghost" onPress={onCancel} style={{ flex: 1 }} />
            <Button title="Verifikasi & online" color={colors.info} loading={busy} onPress={submit} style={{ flex: 2 }} disabled={!url} />
          </Row>
        </Animated.View>
      </View>
    </Modal>
  );
}

/** Kontak darurat — dihubungi CS saat SOS. */
export function EmergencyContactCard() {
  const { profile, loadProfile } = useAuth();
  const [name, setName] = useState(profile?.emergency_contact_name ?? '');
  const [phone, setPhone] = useState(profile?.emergency_contact_phone ?? '');
  const [edit, setEdit] = useState(!profile?.emergency_contact_phone);
  const save = async () => {
    if (phone.replace(/\D/g, '').length < 9) return toast.error('Nomor HP tidak valid');
    try { await rpc('set_emergency_contact', { p_name: name, p_phone: phone }); await loadProfile(); setEdit(false); toast.success('Kontak darurat disimpan'); } catch (e) { toast.error((e as Error).message); }
  };
  return (
    <Card style={{ gap: 10 }}>
      <Row between><Text style={font.label}>Kontak darurat</Text>{!edit && <Button size="sm" variant="ghost" title="Ubah" onPress={() => setEdit(true)} />}</Row>
      {edit ? (
        <>
          <TextInput value={name} onChangeText={setName} placeholder="Nama (mis. Istri / Ayah)" placeholderTextColor={colors.textMuted} style={s.input} />
          <TextInput value={phone} onChangeText={setPhone} placeholder="08xxxxxxxxxx" keyboardType="phone-pad" placeholderTextColor={colors.textMuted} style={s.input} />
          <Button title="Simpan" size="sm" onPress={save} />
        </>
      ) : (
        <Row gap={10}>
          <View style={[s.pinIcon, { backgroundColor: colors.danger + '1A', width: 40, height: 40 }]}><Ionicons name="call" size={18} color={colors.danger} /></View>
          <View style={{ flex: 1 }}><Text style={{ fontWeight: '700', color: colors.text }}>{profile?.emergency_contact_name || 'Kontak darurat'}</Text><Text style={font.small}>{profile?.emergency_contact_phone}</Text></View>
          <Button size="sm" variant="outline" color={colors.danger} title="Telepon" icon="call-outline" onPress={() => Linking.openURL(`tel:${profile?.emergency_contact_phone}`)} />
        </Row>
      )}
      <Text style={font.tiny}>Saat Anda menekan SOS, CS AntarKita akan menghubungi Anda dan kontak ini.</Text>
    </Card>
  );
}

/** Kartu verifikasi driver di layar pelanggan — cocokkan plat & wajah sebelum naik. */
export function DriverVerifyCard({ plate, vehicle, name, selfieAt }: { plate: string; vehicle: string; name: string; selfieAt?: string | null }) {
  return (
    <Animated.View entering={FadeIn.duration(motion.base)} style={s.verify}>
      <Ionicons name="shield-checkmark" size={18} color={colors.success} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontWeight: '700', color: colors.text, fontSize: 13 }}>Cocokkan sebelum naik: <Text style={{ color: colors.ride }}>{plate}</Text> · {vehicle}</Text>
        <Text style={font.tiny}>{name} {selfieAt ? `· wajah terverifikasi ${formatDate(selfieAt)}` : '· mitra terverifikasi AntarKita'}</Text>
      </View>
    </Animated.View>
  );
}

/** Baris aksi keamanan di layar pesanan aktif (SOS + bagikan + laporkan). */
export function SafetyRow({ order, forDriver }: { order: Order; forDriver?: boolean }) {
  const active = ['accepted', 'arrived', 'in_progress'].includes(order.status);
  if (!active) return null;
  return (
    <Animated.View entering={FadeInDown.duration(motion.base)} exiting={FadeOut.duration(motion.fast)} style={s.safetyRow}>
      <SosButton orderId={order.id} compact />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontWeight: '800', color: colors.text, fontSize: 13 }}>Pusat keamanan</Text>
        <Text style={font.tiny} numberOfLines={2}>{forDriver ? 'Nomor pelanggan disamarkan · panggilan lewat aplikasi' : 'Bagikan posisi ke keluarga · nomor Anda disamarkan'}</Text>
      </View>
      {!forDriver && <ShareTripButton order={order} size="sm" variant="glass" />}
    </Animated.View>
  );
}

const s = StyleSheet.create({
  sos: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 52, paddingHorizontal: 22, borderRadius: 26, overflow: 'hidden' },
  sosCompact: { width: 44, height: 44, paddingHorizontal: 0, borderRadius: 22 },
  sosBar: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: 'rgba(255,255,255,0.28)' },
  pinCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: radius.lg, overflow: 'hidden' },
  pinDigit: { width: 34, height: 44, borderRadius: 10, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  backdrop: { flex: 1, backgroundColor: 'rgba(11,31,42,0.45)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  dialog: { backgroundColor: '#fff', borderRadius: radius.xl, padding: 20, gap: 12, alignItems: 'center', ...shadow.card },
  pinIcon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  pinInput: { fontSize: 32, fontWeight: '800', letterSpacing: 16, textAlign: 'center', color: colors.text, borderBottomWidth: 2, borderBottomColor: colors.ride, paddingVertical: 8, width: 200 },
  input: { backgroundColor: 'rgba(255,255,255,0.85)', borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, height: 44, color: colors.text },
  verify: { flexDirection: 'row', gap: 10, alignItems: 'center', backgroundColor: colors.success + '12', borderRadius: radius.md, padding: 10, borderWidth: 1, borderColor: colors.success + '44' },
  safetyRow: { flexDirection: 'row', gap: 12, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: radius.lg, padding: 12, borderWidth: 1, borderColor: glass.border },
});
