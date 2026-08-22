import { RingBuffer } from '../storage/ring-buffer.js';
import { CONFIG } from '../config.js';
import type { Regime } from '../types/index.js';

const priceHistory = new RingBuffer<number>(CONFIG.ringBufferSize);

export function updateRegime(price: number): Regime {
  priceHistory.push(price);
  const prices = priceHistory.getAll();

  if (prices.length < 10) return 'RANGING';

  const recent = prices.slice(-10);
  const older = prices.slice(-20, -10);

  if (older.length === 0) return 'RANGING';

  const recentHigh = Math.max(...recent);
  const recentLow = Math.min(...recent);
  const olderHigh = Math.max(...older);
  const olderLow = Math.min(...older);

  const recentRange = recentHigh - recentLow;
  const avgPrice = (recentHigh + recentLow) / 2;
  const rangePercent = (recentRange / avgPrice) * 100;

  const trendUp = recentHigh > olderHigh && recentLow > olderLow;
  const trendDown = recentHigh < olderHigh && recentLow < olderLow;

  if (rangePercent < 0.3) return 'LOW_VOLATILITY';
  if (rangePercent > 2.5) return 'HIGH_VOLATILITY';
  if (trendUp) return 'TRENDING_UP';
  if (trendDown) return 'TRENDING_DOWN';

  return 'RANGING';
}

export function reset(): void {
  priceHistory.clear();
}
