import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Screen, Card, Input, Button, ListItem, Empty, Row, toast } from '@/components/ui';
import { Entrance } from '@/components/motion';
import { useAuth } from '@/store/auth';
import { useBooking } from '@/store/booking';
import { supabase } from '@/lib/supabase';
import { colors, font } from '@/lib/theme';
import type { SavedPlace } from '@/lib/types';

export default function SavedPlaces() {
  const router = useRouter();
  const uid = useAuth((s) => s.session?.user.id);
  const booking = useBooking();
  const [list, setList] = useState<SavedPlace[]>([]);
  const [label, setLabel] = useState('Rumah');
  const [pending, setPending] = useState<{ address: string; lat: number; lng: number } | null>(null);

  const load = useCallback(async () => { if (!uid) return; const { data } = await supabase.from('saved_places').select('*').eq('user_id', uid).order('created_at'); setList((data as SavedPlace[]) ?? []); }, [uid]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const r = booking.consumePickerResult();
    if (r && r.target === 'generic') setPending({ address: r.place.address, lat: r.place.lat, lng: r.place.lng });
  }, [booking.pickerResult]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (!uid || !pending) return;
    const { error } = await supabase.from('saved_places').insert({ user_id: uid, label: label.trim() || 'Alamat', ...pending });
    if (error) return toast.error(error.message);
    setPending(null); toast.success('Alamat disimpan'); load();
  };
  const remove = async (id: string) => { await supabase.from('saved_places').delete().eq('id', id); load(); };

  return (
    <Screen title="Alamat Tersimpan" back>
      <Card style={{ gap: 12 }}>
        <Text style={font.label}>Tambah alamat</Text>
        <Input label="Label" value={label} onChangeText={setLabel} placeholder="Rumah / Kantor / Kos" icon="bookmark-outline" />
        <Pressable onPress={() => router.push({ pathname: '/place-picker', params: { target: 'generic', title: 'Pilih alamat' } } as never)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.bg, padding: 12, borderRadius: 12 }}>
          <Ionicons name="location-outline" size={20} color={colors.primary} />
          <Text style={[font.body, { flex: 1 }, !pending && { color: colors.textMuted }]} numberOfLines={2}>{pending?.address ?? 'Pilih lokasi di peta / cari alamat'}</Text>
        </Pressable>
        <Button title="Simpan alamat" disabled={!pending} onPress={save} />
      </Card>
      <View style={{ height: 16 }} />
      {list.length === 0 ? <Empty icon="bookmark-outline" title="Belum ada alamat tersimpan" /> : (
        <Entrance index={0}>
          <Card padded={false}>
            <View style={{ paddingHorizontal: 12 }}>
              {list.map((p) => (
                <ListItem key={p.id} icon={p.label.toLowerCase().includes('rumah') ? 'home-outline' : p.label.toLowerCase().includes('kantor') ? 'business-outline' : 'bookmark-outline'} title={p.label} subtitle={p.address}
                  right={<Row><Pressable onPress={() => remove(p.id)} hitSlop={8}><Ionicons name="trash-outline" size={20} color={colors.danger} /></Pressable></Row>} />
              ))}
            </View>
          </Card>
        </Entrance>
      )}
    </Screen>
  );
}
