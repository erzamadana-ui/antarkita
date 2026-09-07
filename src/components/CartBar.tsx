import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { FadeInDown, FadeOutDown, LinearTransition } from 'react-native-reanimated';
import { useCart } from '@/store/cart';
import { PressableScale, AnimatedNumber } from '@/components/motion';
import { BrandGradient } from '@/components/glass';
import { colors, radius, shadow } from '@/lib/theme';
import { rupiah } from '@/lib/format';

/** Bar keranjang melayang ala GoFood — masuk dari bawah, angka berjalan. */
export function CartBar() {
  const router = useRouter();
  const lines = useCart((s) => s.lines);
  const merchant = useCart((s) => s.merchant);
  const count = lines.reduce((a, l) => a + l.qty, 0);
  const subtotal = lines.reduce((a, l) => a + l.qty * l.item.price, 0);
  if (count === 0) return null;
  return (
    <Animated.View entering={FadeInDown.springify().stiffness(280).damping(16)} exiting={FadeOutDown} layout={LinearTransition.springify().stiffness(280).damping(20)}>
      <PressableScale onPress={() => router.push('/food/checkout')} scaleTo={0.97} style={[s.wrap, shadow.glow(colors.food)]}>
        <BrandGradient colors={[colors.food, '#EA580C']} angle="horizontal" style={s.bar}>
          <Animated.View key={count} entering={FadeInDown.duration(220)} style={s.count}><Text style={{ color: colors.food, fontWeight: '800' }}>{count}</Text></Animated.View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ color: '#fff', fontWeight: '800' }} numberOfLines={1}>Lihat keranjang · {merchant?.name}</Text>
            <AnimatedNumber value={subtotal} format={rupiah} style={{ color: 'rgba(255,255,255,0.9)', fontSize: 12, fontWeight: '600' }} duration={400} />
          </View>
          <Ionicons name="cart" size={22} color="#fff" />
        </BrandGradient>
      </PressableScale>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  wrap: { borderRadius: radius.lg, overflow: 'hidden' },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: radius.lg },
  count: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
});
