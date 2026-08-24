import { CONFIG } from '../config.js';
import type { NormalizedTrade, CvdState } from '../types/index.js';
import { classifyTrade } from './classification.js';

// ── Fonte de verdade do CVD (única) ──
// O CVD e o fluxo de grandes players (whaleCvd) são acumulados aqui, em memória,
// a partir de cada trade processado por processTradeForCvd(). O snapshot do painel
// consome getCvdState(). Não existe segunda fonte: o antigo TradeAccumulator/computeCvdFromBuckets
// nunca foi conectado ao snapshot e foi removido por manter whaleCvd fixo em 0.
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

export function resetCvd(): void {
  totalCvd = 0;
  whaleCvd = 0;
  retailCvd = 0;
}
