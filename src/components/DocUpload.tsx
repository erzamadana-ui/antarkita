// Kotak unggah dokumen/foto (KTP, NPWP, sertifikat, selfie) → bucket privat 'documents'
import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, Linking } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { toast } from '@/components/ui';
import { pickAndUpload, signedUrl } from '@/lib/upload';
import { useAuth } from '@/store/auth';
import { colors, font, radius } from '@/lib/theme';

export function DocUpload({ label, hint, value, onChange, required, camera, color = colors.primary, bucket = 'documents' }: {
  label: string; hint?: string; value?: string | null; onChange: (path: string) => void; required?: boolean; camera?: boolean; color?: string; bucket?: 'documents' | 'merchant-images' | 'proofs' | 'promo-images';
}) {
  const session = useAuth((s) => s.session);
  const [busy, setBusy] = useState(false);
  const pick = async (useCamera?: boolean) => {
    if (!session) return;
    setBusy(true);
    try { const r = await pickAndUpload(bucket, session.user.id, { camera: useCamera }); if (r) onChange(bucket === 'promo-images' || bucket === 'merchant-images' ? r.url : r.path); }
    catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };
  const open = async () => { if (!value) return; const u = bucket === 'documents' || bucket === 'proofs' ? await signedUrl(bucket, value) : value; if (u) Linking.openURL(u); };
  const ok = !!value;
  return (
    <View style={[s.box, ok && { borderColor: colors.success, borderStyle: 'solid', backgroundColor: colors.success + '0D' }]}>
      <Pressable onPress={() => pick(camera)} disabled={busy} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={[s.icon, { backgroundColor: ok ? colors.success : color + '1A' }]}>
          <Ionicons name={ok ? 'checkmark' : camera ? 'camera-outline' : 'cloud-upload-outline'} size={20} color={ok ? '#fff' : color} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontWeight: '700', color: colors.text, fontSize: 14 }}>{label}{required && <Text style={{ color: colors.danger }}> *</Text>}</Text>
          <Text style={font.tiny} numberOfLines={2}>{busy ? 'Mengunggah…' : ok ? 'Terunggah · ketuk untuk ganti' : hint ?? (camera ? 'Ambil foto dengan kamera' : 'Ketuk untuk pilih foto/PDF')}</Text>
        </View>
        {ok && <Pressable onPress={open} hitSlop={8} style={s.eye}><Ionicons name="eye-outline" size={18} color={colors.textSecondary} /></Pressable>}
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  box: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.border, borderRadius: radius.md, padding: 12, backgroundColor: 'rgba(255,255,255,0.92)' },
  icon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  eye: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(11,31,42,0.06)', alignItems: 'center', justifyContent: 'center' },
});
