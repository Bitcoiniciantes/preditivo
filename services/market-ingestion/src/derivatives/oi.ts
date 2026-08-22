import { fetchOpenInterest } from '../exchanges/binance/rest.js';
import { RingBuffer } from '../storage/ring-buffer.js';
import { CONFIG } from '../config.js';

let currentOi = 0;
let previousOi = 0;
let oiChange = 0;
const history = new RingBuffer<{ oi: number; ts: number }>(CONFIG.ringBufferSize);

export async function pollOi(): Promise<void> {
  const data = await fetchOpenInterest();
  if (!data) return;

  previousOi = currentOi;
  currentOi = data.oi;

  if (previousOi > 0) {
    oiChange = (currentOi - previousOi) / previousOi;
  }

  history.push({ oi: currentOi, ts: data.timestamp });
}

export function getOiState(): { oi: number; oiChange: number } {
  return { oi: currentOi, oiChange };
}

export function reset(): void {
  currentOi = 0;
  previousOi = 0;
  oiChange = 0;
  history.clear();
}
