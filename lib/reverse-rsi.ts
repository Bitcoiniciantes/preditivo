import type { Candle } from "./types";

export type ReverseRsiProjection = {
  candles: number;
  price: number | null;
  change: number | null;
};

export type ReverseRsiReading = {
  referencePrice: number;
  rsi: number;
  averageGain: number;
  averageLoss: number;
};

const LENGTH = 14;

function rsiFromAverages(averageGain: number, averageLoss: number) {
  return averageLoss === 0 ? (averageGain === 0 ? 50 : 100) : 100 - 100 / (1 + averageGain / averageLoss);
}

/** Returns the exact Wilder state associated with the supplied final close. */
export function reverseRsiReading(candles: Candle[]): ReverseRsiReading | null {
  if (candles.length < LENGTH + 1) return null;
  const closes = candles.map((candle) => candle.close);
  if (!closes.every((close) => Number.isFinite(close) && close > 0)) return null;

  const changes = closes.slice(1).map((close, index) => close - closes[index]);
  let averageGain = changes.slice(0, LENGTH).reduce((sum, value) => sum + Math.max(value, 0), 0) / LENGTH;
  let averageLoss = changes.slice(0, LENGTH).reduce((sum, value) => sum + Math.max(-value, 0), 0) / LENGTH;
  for (const change of changes.slice(LENGTH)) {
    averageGain = (averageGain * (LENGTH - 1) + Math.max(change, 0)) / LENGTH;
    averageLoss = (averageLoss * (LENGTH - 1) + Math.max(-change, 0)) / LENGTH;
  }
  const rsi = rsiFromAverages(averageGain, averageLoss);
  return { referencePrice: closes.at(-1)!, rsi, averageGain, averageLoss };
}

/**
 * Applies the live quote as the provisional close of the candle still in
 * formation. It advances the Wilder averages by one step without appending a
 * candle, so the closed-candle history and averages stay untouched.
 */
export function provisionalReverseRsiReading(reading: ReverseRsiReading, livePrice: number): ReverseRsiReading {
  if (!Number.isFinite(livePrice) || livePrice <= 0) return reading;
  const change = livePrice - reading.referencePrice;
  const averageGain = (reading.averageGain * (LENGTH - 1) + Math.max(change, 0)) / LENGTH;
  const averageLoss = (reading.averageLoss * (LENGTH - 1) + Math.max(-change, 0)) / LENGTH;
  return {
    referencePrice: livePrice,
    rsi: rsiFromAverages(averageGain, averageLoss),
    averageGain,
    averageLoss,
  };
}

export function projectReverseRsi(reading: ReverseRsiReading, targetRsi: number, candles: number): ReverseRsiProjection {
  if (!Number.isFinite(targetRsi) || targetRsi <= 0 || targetRsi >= 100 || !Number.isInteger(candles) || candles < 1) {
    return { candles, price: null, change: null };
  }
  if (Math.abs(targetRsi - reading.rsi) < 1e-10) return { candles, price: reading.referencePrice, change: 0 };
  const q = (LENGTH - 1) / LENGTH;
  const qk = q ** candles;
  const sum = (1 - qk) / (1 - q);
  const ratio = targetRsi / (100 - targetRsi);
  const movement = targetRsi < reading.rsi
    ? LENGTH * qk * (reading.averageGain / ratio - reading.averageLoss) / sum
    : LENGTH * qk * (ratio * reading.averageLoss - reading.averageGain) / sum;
  const price = targetRsi < reading.rsi
    ? reading.referencePrice - candles * movement
    : reading.referencePrice + candles * movement;
  if (!Number.isFinite(price) || price <= 0) return { candles, price: null, change: null };
  return { candles, price, change: (price / reading.referencePrice - 1) * 100 };
}
