import type { NormalizedTrade } from '../types/index.js';

export type TradeSize = 'small' | 'medium' | 'large';

let rollingSum = 0;
let rollingCount = 0;
let rollingAvg = 0;

const WINDOW = 500;

export function classifyTrade(trade: NormalizedTrade): TradeSize {
  const usdValue = trade.price * trade.quantity;

  rollingSum += usdValue;
  rollingCount++;

  if (rollingCount > WINDOW) {
    rollingSum -= rollingAvg;
  }

  rollingAvg = rollingSum / Math.min(rollingCount, WINDOW);

  if (usdValue > rollingAvg * 3) return 'large';
  if (usdValue > rollingAvg * 1.2) return 'medium';
  return 'small';
}

export function getRollingAvg(): number {
  return rollingAvg;
}

export function resetClassification(): void {
  rollingSum = 0;
  rollingCount = 0;
  rollingAvg = 0;
}
