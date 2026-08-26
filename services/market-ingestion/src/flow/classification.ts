import { CONFIG } from '../config.js';
import type { NormalizedTrade } from '../types/index.js';

export type TradeSize = 'small' | 'large';

// Classificação "whale" (P0-01 da auditoria do observatório, 26/08):
// threshold ABSOLUTO de nocional, calibrado nos dados — US$ 100.000 por trade agregado
// (~1,27 BTC a US$ 78,5k). O threshold relativo anterior (3× média móvel dos últimos
// 500 trades, com janela com vazamento) capturava varejo: ticket médio 0,33 BTC,
// mediana US$ 16k — não eram "baleias" em termos absolutos.
//
// Nota: com @aggTrade, cada NormalizedTrade já é a agregação das execuções da mesma
// ordem taker (~janela 100ms), então o nocional aqui é o do trade agregado.
export function classifyTrade(trade: NormalizedTrade): TradeSize {
  const usdValue = trade.price * trade.quantity;
  return usdValue >= CONFIG.flow.whaleNotionalUsd ? 'large' : 'small';
}
