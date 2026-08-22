import { fetchFundingRate } from '../exchanges/binance/rest.js';
import type { DerivativesState } from '../types/index.js';

let currentRate = 0;
let classification: DerivativesState['fundingClassification'] = 'neutral';
let lastUpdate = 0;

export async function pollFunding(): Promise<void> {
  const data = await fetchFundingRate();
  if (!data) return;

  currentRate = data.rate;
  lastUpdate = data.timestamp;

  const absRate = Math.abs(currentRate);
  if (absRate < 0.0001) {
    classification = 'neutral';
  } else if (absRate > 0.001) {
    classification = 'extreme';
  } else if (currentRate > 0) {
    classification = 'positive';
  } else {
    classification = 'negative';
  }
}

export function getFundingState(): { rate: number; classification: DerivativesState['fundingClassification'] } {
  return { rate: currentRate, classification };
}

export function reset(): void {
  currentRate = 0;
  classification = 'neutral';
  lastUpdate = 0;
}
