// Iklan v3 (KONTRAK-API-V3 §7) sisi Pelanggan.
//  • `ads_serve` dipanggil saat blok Sponsored dirender (server sekaligus mencatat impresi & frequency cap);
//  • `ads_click` dipanggil saat kartu Sponsored diketuk (server men-dedupe klik & menagih cpc);
//  • atribusi: kampanye yang diklik diingat per merchant sampai pesanan dibuat, lalu dikirim ke `create_order`
//    (`ad_campaign_id`) sehingga server bisa mencatat konversi (cpa). Tanpa klik iklan → tidak ada atribusi.
import { create } from 'zustand';
import { supabase } from './supabase';
import type { AdPlacementV3, AdServed, Merchant } from './types';

/** Label transparansi tunggal untuk semua konten berbayar. */
export const SPONSORED_LABEL = 'Sponsored';

/** `ads_serve(p_placement, p_lat, p_lng, p_category, p_q, p_limit)`. Galat → [] (blok iklan opsional, dicatat di konsol). */
export async function serveAds(placement: AdPlacementV3, lat: number, lng: number, o: { category?: string | null; q?: string | null; limit?: number } = {}): Promise<AdServed[]> {
  const { data, error } = await supabase.rpc('ads_serve', {
    p_placement: placement, p_lat: lat, p_lng: lng, p_category: o.category ?? null, p_q: o.q ?? null, p_limit: o.limit ?? 3,
  });
  if (error) { console.warn(`ads_serve(${placement}):`, error.message); return []; }
  return ((data as AdServed[] | null) ?? []).filter((a) => a && a.campaign_id && a.merchant_id);
}

/** `ads_click(p_campaign_id, p_placement)` — tidak memblokir navigasi bila gagal. */
export async function clickAd(campaignId: string, placement: AdPlacementV3): Promise<boolean> {
  const { data, error } = await supabase.rpc('ads_click', { p_campaign_id: campaignId, p_placement: placement });
  if (error) { console.warn('ads_click:', error.message); return false; }
  return !!(data as { charged?: boolean } | null)?.charged;
}

/** Merchant organik yang benar-benar berbayar (server mengisi `ad_label` + `campaign_id`). */
export const isSponsoredMerchant = (m: Pick<Merchant, 'ad_label' | 'campaign_id'>) => !!m.ad_label && !!m.campaign_id;

interface Attribution { byMerchant: Record<string, string>; set: (merchantId: string, campaignId: string) => void; clear: (merchantId?: string) => void }
/** Kampanye iklan yang diklik terakhir per merchant (memori sesi; tidak disimpan ke perangkat). */
export const useAdAttribution = create<Attribution>((set) => ({
  byMerchant: {},
  set: (merchantId, campaignId) => set((s) => ({ byMerchant: { ...s.byMerchant, [merchantId]: campaignId } })),
  clear: (merchantId) => set((s) => {
    if (!merchantId) return { byMerchant: {} };
    const next = { ...s.byMerchant }; delete next[merchantId]; return { byMerchant: next };
  }),
}));
export const adCampaignFor = (merchantId?: string | null) => (merchantId ? useAdAttribution.getState().byMerchant[merchantId] ?? null : null);
