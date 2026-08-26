import type { NormalizedTrade } from '../types/index.js';

// Agregador client-side de execuções (P0-01 da auditoria do observatório, 26/08).
//
// Contexto verificado: o futures da Binance (fstream.binance.com) NÃO possui stream
// `@aggTrade` (entrega 0 mensagens; o spot possui). O `@trade` entrega execuções
// individuais com id `t`. Para evitar contar fills da mesma ordem como eventos
// separados, agregamos execuções com a MESMA direção agressora dentro de uma janela
// de ~100ms — semântica equivalente à do @aggTrade do spot (agregação por ordem taker
// na janela de ~100ms).
//
// Regras:
//  - janela começa na primeira execução do grupo e dura AGG_WINDOW_MS;
//  - mudança de lado agressor força o flush do grupo atual;
//  - o agregado usa VWAP como preço, soma das quantidades, eventTime = última execução,
//    id = id da última execução (primeiro id preservado em firstId), executions = nº de fills.
export class TradeAggregator {
  private buf: NormalizedTrade[] = [];

  constructor(private windowMs = 100) {}

  /** Recebe uma execução; retorna os agregados completados (em ordem). */
  push(trade: NormalizedTrade): NormalizedTrade[] {
    const out: NormalizedTrade[] = [];
    const start = this.buf.length > 0 ? this.buf[0].eventTime : trade.eventTime;

    // Janela expirada ou lado mudou → flush do grupo atual antes de inserir
    if (this.buf.length > 0) {
      const expired = trade.eventTime - start >= this.windowMs;
      const sideChanged = this.buf[0].side !== trade.side;
      if (expired || sideChanged) {
        out.push(this.flush());
      }
    }

    this.buf.push(trade);

    // Se o grupo ainda está dentro da janela, nada mais a emitir agora.
    return out;
  }

  /** Emite o agregado pendente (chamado no fim, se houver). */
  flushPending(): NormalizedTrade | null {
    if (this.buf.length === 0) return null;
    return this.flush();
  }

  private flush(): NormalizedTrade {
    const group = this.buf;
    this.buf = [];

    let notional = 0;
    let qty = 0;
    let last: NormalizedTrade = group[group.length - 1];
    for (const t of group) {
      notional += t.price * t.quantity;
      qty += t.quantity;
      last = t;
    }

    const aggregated: NormalizedTrade = {
      exchange: 'binance',
      id: last.id,
      firstId: group[0].id,
      executions: group.length,
      eventTime: last.eventTime,
      price: qty > 0 ? notional / qty : last.price,
      quantity: qty,
      side: group[0].side,
      isBuyerMaker: group[0].isBuyerMaker,
    };

    if (group.length > 1) {
      console.log(`[Aggregator] ${group.length} execuções agregadas (${(notional / 1000).toFixed(0)}k USD, ${aggregated.side})`);
    }
    return aggregated;
  }

  reset(): void {
    this.buf = [];
  }
}
