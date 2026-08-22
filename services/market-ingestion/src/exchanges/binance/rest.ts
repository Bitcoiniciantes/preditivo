import { CONFIG } from '../../config.js';
import type { OrderBookSnapshot } from '../../types/index.js';
import { updateWeightFromHeaders, isRateLimited } from '../../utils/rate-limit.js';

const TIMEOUT_MS = 8_000;

async function fetchJson<T>(url: string): Promise<T | null> {
  if (isRateLimited()) return null;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });

    updateWeightFromHeaders(res.headers);

    if (res.status === 429 || res.status === 418) {
      console.warn(`[REST] Rate limited (${res.status}), skipping`);
      return null;
    }

    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function fetchDepthSnapshot(): Promise<OrderBookSnapshot | null> {
  const url = `${CONFIG.restUrl}/fapi/v1/depth?symbol=${CONFIG.symbol}&limit=${CONFIG.orderbook.depth20Levels}`;
  const data = await fetchJson<{
    lastUpdateId: number;
    bids: [string, string][];
    asks: [string, string][];
    time?: number;
    lastUpdate?: number;
  }>(url);

  if (!data) return null;

  return {
    exchange: 'binance',
    lastUpdateId: data.lastUpdateId,
    timestamp: data.time ?? data.lastUpdate ?? Date.now(),
    bids: data.bids.map(([p, q]) => [Number(p), Number(q)]),
    asks: data.asks.map(([p, q]) => [Number(p), Number(q)]),
  };
}

export async function fetchOpenInterest(): Promise<{ oi: number; timestamp: number } | null> {
  if (isRateLimited()) return null;

  const url = `${CONFIG.restUrl}/fapi/v1/openInterest?symbol=${CONFIG.symbol}`;
  const data = await fetchJson<{ openInterest: string; symbol: string; time: number }>(url);
  if (!data) return null;

  const oi = Number(data.openInterest);
  if (!isFinite(oi)) return null;

  return { oi, timestamp: data.time };
}

export async function fetchFundingRate(): Promise<{ rate: number; timestamp: number } | null> {
  if (isRateLimited()) return null;

  const url = `${CONFIG.restUrl}/fapi/v1/premiumIndex?symbol=${CONFIG.symbol}`;
  const data = await fetchJson<{ lastFundingRate: string; nextFundingTime: number; symbol: string; time: number }>(url);
  if (!data) return null;

  const rate = Number(data.lastFundingRate);
  if (!isFinite(rate)) return null;

  return { rate, timestamp: data.time };
}
