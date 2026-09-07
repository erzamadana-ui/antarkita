import React, { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { Platform, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useAuth } from '@/store/auth';
import { useMode } from '@/store/mode';
import { useI18n, applyDirection } from '@/lib/i18n';
import { IncomingCallOverlay } from '@/components/call/IncomingCall';
import { initPush, attachSignOutHook, markNavigationReady } from '@/lib/push';
import { ToastHost, Loading } from '@/components/ui';
import { AmbientBackground } from '@/components/glass';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { colors, FONT_ASSETS } from '@/lib/theme';
import { useFonts } from 'expo-font';
import { APP, APP_NAME } from '@/lib/app';
import { useRouter, useSegments, useRootNavigationState } from 'expo-router';
import { supabase, recoveryFromUrl } from '@/lib/supabase';
import { toast } from '@/components/ui';

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const router = useRouter();
  const [fontsLoaded] = useFonts(FONT_ASSETS);
  const ready = useAuth((s) => s.ready);
  const init = useAuth((s) => s.init);
  const modeLoaded = useMode((s) => s.loaded);
  const loadMode = useMode((s) => s.load);
  const loadLocale = useI18n((s) => s.load);
  const locale = useI18n((s) => s.locale);

  const session = useAuth((s) => s.session);
  const recovery = useAuth((s) => s.recovery);
  const setRecovery = useAuth((s) => s.setRecovery);
  const setPendingRoute = useAuth((s) => s.setPendingRoute);
  const segments = useSegments();
  const navKey = useRootNavigationState()?.key;
  useEffect(() => { init(); loadMode(); loadLocale(); }, [init, loadMode, loadLocale]);
  // Tautan pemulihan kata sandi dari email (web): ambil token dari URL → buat sesi → paksa ke layar buat kata sandi baru
  useEffect(() => {
    if (!ready || !navKey || Platform.OS !== 'web') return;
    const rec = recoveryFromUrl();
    if (!rec) return;
    try { window.history.replaceState(null, '', window.location.pathname); } catch { /* noop */ }
    if ('error' in rec) { setPendingRoute('/(auth)/forgot'); toast.error('Tautan pemulihan kedaluwarsa atau sudah dipakai. Minta tautan baru.'); router.replace('/(auth)/forgot' as never); return; }
    setRecovery(true);
    supabase.auth.setSession({ access_token: rec.access_token, refresh_token: rec.refresh_token })
      .then(({ error }) => { if (error) { setRecovery(false); toast.error('Tautan pemulihan tidak valid. Minta tautan baru.'); router.replace('/(auth)/forgot' as never); } else router.replace('/(auth)/reset' as never); })
      .catch(() => { setRecovery(false); router.replace('/(auth)/forgot' as never); });
  }, [ready, navKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // Penjaga global: tanpa sesi, semua rute di luar grup (auth) diarahkan ke layar sambutan (mis. tautan langsung /food, /admin/users);
  // saat alur pemulihan kata sandi, semua rute diarahkan ke layar buat kata sandi baru sampai selesai
  const top = segments[0] as string | undefined;
  const second = (segments as string[])[1] as string | undefined;
  useEffect(() => {
    if (!ready || !navKey) return;
    if (recovery && session && !(top === '(auth)' && second === 'reset')) { router.replace('/(auth)/reset' as never); return; }
    if (!session && top !== '(auth)') router.replace((useAuth.getState().pendingRoute ?? '/(auth)/welcome') as never);
  }, [ready, navKey, session, top, second, recovery]); // eslint-disable-line react-hooks/exhaustive-deps
  // ------------------------------------------------------------------ push notification
  // Token perangkat didaftarkan SETELAH sesi ada (RPC register_push_token butuh auth.uid()).
  // attachSignOutHook() membungkus aksi signOut di store auth supaya token dilepas SELAGI sesi
  // masih sah — jadi titik logout di layar mana pun tidak perlu diubah.
  // initPush() tidak pernah melempar: izin ditolak / token gagal hanya dicatat diam-diam.
  useEffect(() => {
    if (!ready || !session) return;
    attachSignOutHook();
    initPush().catch(() => { /* fallback aman: aplikasi tetap jalan tanpa push */ });
  }, [ready, session]);
  // Navigator siap → ketukan notifikasi yang tertunda (aplikasi dibuka dari keadaan TERTUTUP)
  // baru boleh berpindah halaman.
  useEffect(() => { if (ready && navKey && session) markNavigationReady(); }, [ready, navKey, session]);

  useEffect(() => { applyDirection(locale); }, [locale]);
  useEffect(() => { if (ready && modeLoaded && fontsLoaded) SplashScreen.hideAsync().catch(() => {}); }, [ready, modeLoaded, fontsLoaded]);
  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      document.title = APP_NAME[APP];
      // Tema selalu terang: abaikan pengaturan dark mode OS/browser
      document.documentElement.style.colorScheme = 'light';
      const meta = document.createElement('meta'); meta.name = 'color-scheme'; meta.content = 'light only'; document.head.appendChild(meta);
      // Deep link dari 404.html GitHub Pages (?r=/rute/asli)
      try { const r = new URLSearchParams(window.location.search).get('r'); if (r && r.startsWith('/') && !/type=recovery|error_code=/.test(r)) { window.history.replaceState(null, '', window.location.pathname); setTimeout(() => router.replace(r as never), 0); } } catch { /* noop */ }
      const style = document.createElement('style');
      style.textContent = [
        'html,body,#root{height:100%;background:#FFFFFF;color-scheme:light only}',
        'body{font-family:"PlusJakartaSans-500",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}',
        '*{box-sizing:border-box}',
        '::-webkit-scrollbar{width:8px;height:8px} ::-webkit-scrollbar-thumb{background:rgba(11,31,42,0.18);border-radius:8px}',
        'a,button,[role=button]{transition:transform .1s cubic-bezier(.2,.8,.2,1),box-shadow .12s,opacity .12s}',
        '[role=button]:hover{filter:brightness(1.03)}',
        '@media (prefers-reduced-motion: reduce){*{animation-duration:.01ms!important;transition-duration:.01ms!important}}',
      ].join('\n');
      document.head.appendChild(style);
    }
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <View style={{ flex: 1, backgroundColor: colors.bg }}>
          <StatusBar style="dark" />
          {!ready || !modeLoaded ? (<><AmbientBackground /><Loading /></>) : (
            <ErrorBoundary onReset={() => { try { router.replace('/' as never); } catch { /* noop */ } }}>
            <Stack screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.bg },
              animation: Platform.OS === 'web' ? 'fade' : 'slide_from_right',
              animationDuration: 130,
              gestureEnabled: true,
              fullScreenGestureEnabled: true,
            }}>
              <Stack.Screen name="place-picker" options={{ animation: Platform.OS === 'web' ? 'fade' : 'slide_from_bottom', presentation: 'card' }} />
              <Stack.Screen name="food/checkout" options={{ animation: Platform.OS === 'web' ? 'fade' : 'slide_from_bottom' }} />
              <Stack.Screen name="order/[id]/chat" options={{ animation: Platform.OS === 'web' ? 'fade' : 'slide_from_bottom' }} />
              <Stack.Screen name="call/[id]" options={{ animation: 'fade', presentation: 'fullScreenModal' }} />
              <Stack.Screen name="pay/gateway" options={{ animation: Platform.OS === 'web' ? 'fade' : 'slide_from_bottom' }} />
            </Stack>
            </ErrorBoundary>
          )}
          {ready && <IncomingCallOverlay />}
          <ToastHost />
        </View>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
