// Edit profil — gaya kit: avatar besar dengan tombol kamera, form penuh lebar, email terkunci
import React, { useState } from 'react';
import { View, Pressable, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Screen, Input, Button, Avatar, toast } from '@/components/ui';
import { Entrance } from '@/components/motion';
import { useAuth } from '@/store/auth';
import { pickAndUpload } from '@/lib/upload';
import { colors, font, radius, shadow } from '@/lib/theme';

export default function EditProfile() {
  const router = useRouter();
  const { profile, updateProfile, session } = useAuth();
  const [name, setName] = useState(profile?.full_name ?? '');
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [avatar, setAvatar] = useState(profile?.avatar_url ?? null);
  const [busy, setBusy] = useState(false);
  const phoneOk = phone.trim() === '' || /^(\+62|62|0)8\d{7,12}$/.test(phone.replace(/[\s-]/g, ''));

  const changePhoto = async () => {
    if (!session) return;
    try { const r = await pickAndUpload('avatars', session.user.id); if (r) setAvatar(r.url); } catch (e) { toast.error((e as Error).message); }
  };
  const save = async () => {
    if (name.trim().length < 3) return toast.error('Nama minimal 3 huruf');
    if (!phoneOk) return toast.error('Format nomor HP tidak valid (contoh 0812xxxxxxx)');
    setBusy(true);
    try { await updateProfile({ full_name: name.trim(), phone: phone.replace(/[\s-]/g, '').trim(), avatar_url: avatar }); toast.success('Profil disimpan'); router.back(); }
    catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <Screen title="Edit Profil" back footer={<Button title="Simpan perubahan" size="lg" icon="checkmark" loading={busy} onPress={save} />}>
      <Entrance index={0} from="zoom">
        <View style={{ alignItems: 'center', marginTop: 8, marginBottom: 22 }}>
          <Pressable onPress={changePhoto} accessibilityRole="button" accessibilityLabel="Ganti foto profil" style={s.avatarWrap}>
            <Avatar name={name} url={avatar} size={104} />
            <View style={s.camera}><Ionicons name="camera" size={16} color="#fff" /></View>
          </Pressable>
          <Text style={[font.small, { marginTop: 10 }]}>Ketuk foto untuk mengganti</Text>
        </View>
      </Entrance>
      <Entrance index={1}>
        <View style={s.form}>
          <Input label="Nama lengkap" value={name} onChangeText={setName} icon="person-outline" placeholder="Nama sesuai KTP" autoCapitalize="words" returnKeyType="next" />
          <Input label="Nomor HP" value={phone} onChangeText={setPhone} keyboardType="phone-pad" icon="call-outline" placeholder="0812xxxxxxxx" error={phoneOk ? undefined : 'Gunakan format 08xx / +628xx'} />
          <Input label="Email" value={profile?.email ?? ''} editable={false} icon="mail-outline" style={{ color: colors.textMuted }} containerStyle={{ opacity: 0.85 }} />
          <Text style={font.tiny}>Email dipakai untuk masuk dan tidak bisa diubah dari sini. Hubungi CS bila perlu mengganti email.</Text>
        </View>
      </Entrance>
    </Screen>
  );
}

const s = StyleSheet.create({
  avatarWrap: { position: 'relative' },
  camera: { position: 'absolute', right: -2, bottom: -2, width: 34, height: 34, borderRadius: 17, backgroundColor: colors.primary, borderWidth: 3, borderColor: '#fff', alignItems: 'center', justifyContent: 'center', ...shadow.soft },
  form: { gap: 14, padding: 16, backgroundColor: '#fff', borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, ...shadow.soft },
});
