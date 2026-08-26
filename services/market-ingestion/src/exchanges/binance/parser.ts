import type { NormalizedTrade, OrderBookSnapshot } from '../../types/index.js';

export function parseAggTrade(msg: Record<string, unknown>): NormalizedTrade | null {
  try {
    const price = Number(msg.p);
    const qty = Number(msg.q);
    const eventTime = Number(msg.T);
    const isBuyerMaker = Boolean(msg.m);
    // Futures @trade usa 't' (id da execução); spot @aggTrade usa 'a' (id do agregado).
    // Preservado para dedupe (P0-01).
    const rawId = msg.t ?? msg.a;
    const id = Number(rawId);

    if (!isFinite(price) || !isFinite(qty) || price <= 0 || qty <= 0) return null;

    return {
      exchange: 'binance',
      id: Number.isFinite(id) && id > 0 ? id : undefined,
      eventTime,
      price,
      quantity: qty,
      side: isBuyerMaker ? 'SELL' : 'BUY',
      isBuyerMaker,
    };
  } catch {
    return null;
  }
}

export function parseDepth(msg: Record<string, unknown>): OrderBookSnapshot | null {
  try {
    const bids = msg.b as [string, string][] | undefined;
    const asks = msg.a as [string, string][] | undefined;
    const lastUpdateId = Number(msg.u);
    const timestamp = Number(msg.T ?? msg.E);

    if (!bids || !asks || !isFinite(lastUpdateId)) return null;

    return {
      exchange: 'binance',
      lastUpdateId,
      timestamp,
      bids: bids.map(([p, q]) => [Number(p), Number(q)]),
      asks: asks.map(([p, q]) => [Number(p), Number(q)]),
    };
  } catch {
    return null;
  }
}

export function parseTicker(msg: Record<string, unknown>): number {
  try {
    // bookTicker: b = best bid, a = best ask
    const bid = Number(msg.b);
    const ask = Number(msg.a);
    if (bid > 0 && ask > 0) return (bid + ask) / 2;
    if (bid > 0) return bid;
    if (ask > 0) return ask;
    return 0;
  } catch {
    return 0;
  }
}
