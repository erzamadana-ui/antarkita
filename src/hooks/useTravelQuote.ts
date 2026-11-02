// Quote tarif AntarTravel (0124 travel_quote / travel_rate_cards_public) — pelanggan & mitra travel.
import { useCallback, useEffect, useRef, useState } from 'react';
import { rpc } from '@/lib/supabase';
import type { TravelQuote, TravelRateCardsPublic } from '@/lib/travelQuote';

let cardsCache: TravelRateCardsPublic | null = null;

/** Kartu tarif publik (model mobil, Rp/km, toleransi, minimum tawaran). Gagal → null (UI menyembunyikan pemilih model). */
export function useTravelRateCards() {
  const [cards, setCards] = useState<TravelRateCardsPublic | null>(cardsCache);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try { cardsCache = await rpc<TravelRateCardsPublic>('travel_rate_cards_public'); setCards(cardsCache); setError(null); }
    catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { if (!cardsCache) void reload(); }, [reload]);
  return { cards, error, reload };
}

/**
 * Quote otomatis saat parameter lengkap (from ≠ to). `model` = id rate card / nama / teks bebas / null (termurah).
 * Hasil null + error bila server menolak (mis. kota belum punya koordinat) — pemesanan tetap boleh, server menghitung sendiri.
 */
export function useTravelQuote(from: string | null | undefined, to: string | null | undefined, model: string | null | undefined, mode: 'shared' | 'charter', pax: number, enabled = true) {
  const [quote, setQuote] = useState<TravelQuote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  const reload = useCallback(async () => {
    if (!enabled || !from || !to || from === to) { setQuote(null); setError(null); return; }
    const my = ++seq.current;
    setLoading(true);
    try {
      const q = await rpc<TravelQuote>('travel_quote', { p_from: from, p_to: to, p_model: model ?? null, p_mode: mode, p_pax: Math.max(1, pax || 1) });
      if (my === seq.current) { setQuote(q); setError(null); }
    } catch (e) { if (my === seq.current) { setQuote(null); setError((e as Error).message); } }
    finally { if (my === seq.current) setLoading(false); }
  }, [enabled, from, to, model, mode, pax]);
  useEffect(() => { void reload(); }, [reload]);
  return { quote, error, loading, reload };
}
