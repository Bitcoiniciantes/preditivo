import { CONFIG } from '../config.js';
import type { NormalizedTrade, CvdState, TradeBucket } from '../types/index.js';
import { classifyTrade } from './classification.js';

let totalCvd = 0;
let whaleCvd = 0;
let retailCvd = 0;

export function processTradeForCvd(trade: NormalizedTrade): void {
  const usdDelta = trade.side === 'BUY'
    ? trade.price * trade.quantity
    : -(trade.price * trade.quantity);

  totalCvd += usdDelta;

  const size = classifyTrade(trade);
  if (size === 'large') {
    whaleCvd += usdDelta;
  } else {
    retailCvd += usdDelta;
  }
}

export function getCvdState(): CvdState {
  return {
    totalCvd,
    whaleCvd,
    retailCvd,
    delta: totalCvd,
    buyVolume: 0,
    sellVolume: 0,
  };
}

export function computeCvdFromBuckets(buckets: TradeBucket[]): CvdState {
  let cvd = 0;
  let whale = 0;
  let retail = 0;
  let buyVol = 0;
  let sellVol = 0;

  for (const b of buckets) {
    const delta = b.buyVolume - b.sellVolume;
    cvd += delta;
    buyVol += b.buyVolume;
    sellVol += b.sellVolume;
  }

  return {
    totalCvd: cvd,
    whaleCvd: whale,
    retailCvd: retail,
    delta: cvd,
    buyVolume: buyVol,
    sellVolume: sellVol,
  };
}

export function resetCvd(): void {
  totalCvd = 0;
  whaleCvd = 0;
  retailCvd = 0;
}
