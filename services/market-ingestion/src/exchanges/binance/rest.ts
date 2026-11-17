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

// Períodos do Global Long/Short Account Ratio utilizados pelo projeto.
// Conjunto fechado: 2h/6h/12h existem na API mas não são coletados (sem
// timeframe correspondente no gráfico).
export type LongShortPeriod = '5m' | '15m' | '30m' | '1h' | '4h' | '1d';

export async function fetchLongShortAccountRatio(
  period: LongShortPeriod,
): Promise<{ ratio: number; longAccount: number; shortAccount: number; timestamp: number } | null> {
  if (isRateLimited()) return null;

  const url = `${CONFIG.restUrl}/futures/data/globalLongShortAccountRatio?symbol=${CONFIG.symbol}&period=${period}&limit=1`;
  const data = await fetchJson<
    { longShortRatio: string; longAccount: string; shortAccount: string; timestamp: number }[]
  >(url);
  if (!data || data.length === 0) return null;

  const row = data[0];
  const ratio = Number(row.longShortRatio);
  const longAccount = Number(row.longAccount);
  const shortAccount = Number(row.shortAccount);
  if (!isFinite(ratio) || !isFinite(longAccount) || !isFinite(shortAccount)) return null;

  const timestamp = typeof row.timestamp === 'number' && isFinite(row.timestamp) ? row.timestamp : Date.now();
  return { ratio, longAccount, shortAccount, timestamp };
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
