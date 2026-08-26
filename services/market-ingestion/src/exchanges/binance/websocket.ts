import WebSocket from 'ws';
import { CONFIG } from '../../config.js';
import { parseAggTrade, parseDepth, parseTicker } from './parser.js';
import { backoffDelay } from '../../utils/backoff.js';
import type { NormalizedTrade, OrderBookSnapshot } from '../../types/index.js';

export type BinanceStreamHandler = {
  onTrade: (trade: NormalizedTrade) => void;
  onDepth: (depth: OrderBookSnapshot) => void;
  onTicker: (price: number) => void;
  onStatusChange: (status: 'connecting' | 'live' | 'reconnecting' | 'disconnected') => void;
};

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let retries = 0;
let handler: BinanceStreamHandler;

export function connectBinance(h: BinanceStreamHandler): () => void {
  handler = h;
  doConnect();

  return () => {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (ws) {
      ws.removeAllListeners();
      ws.close();
    }
    ws = null;
  };
}

function doConnect() {
  const streams = [
    CONFIG.streams.trade,
    CONFIG.streams.depth,
    CONFIG.streams.bookTicker,
  ].join('/');

  const url = `${CONFIG.wsUrl}?streams=${streams}`;

  handler.onStatusChange(retries === 0 ? 'connecting' : 'reconnecting');

  ws = new WebSocket(url);

  ws.on('open', () => {
    retries = 0;
    handler.onStatusChange('live');
    console.log('[Binance WS] Connected');
  });

  ws.on('message', (raw: Buffer) => {
    try {
      const msg = JSON.parse(raw.toString());
      // Binance Futures streams wrap data in {stream, data}
      const data = (msg.data as Record<string, unknown>) || msg;
      handleEvent(data);
    } catch {
      // silently drop malformed messages
    }
  });

  ws.on('close', () => {
    handler.onStatusChange('disconnected');
    scheduleReconnect();
  });

  ws.on('error', (err: Error) => {
    console.error('[Binance WS] Error:', err.message);
    ws?.close();
  });
}

function handleEvent(msg: Record<string, unknown>) {
  const event = msg.e as string | undefined;
  if (!event) return;

  switch (event) {
    case 'trade':
    case 'aggTrade': {
      // O endpoint atual (/stream) entrega @trade (execuções com id 't'). O @aggTrade
      // existe no futures, mas só é entregue pelo endpoint /market (auditoria §20);
      // caso o config aponte para ele, o parser lê o id 'a'. Mantido por robustez.
      const trade = parseAggTrade(msg);
      if (trade) handler.onTrade(trade);
      break;
    }
    case 'depthUpdate': {
      const depth = parseDepth(msg);
      if (depth) handler.onDepth(depth);
      break;
    }
    case 'bookTicker': {
      const price = parseTicker(msg);
      if (price > 0) handler.onTicker(price);
      break;
    }
  }
}

function scheduleReconnect() {
  const delay = backoffDelay(retries, CONFIG.backoff);
  retries++;
  console.log(`[Binance WS] Reconnecting in ${delay}ms (attempt ${retries})`);
  reconnectTimer = setTimeout(doConnect, delay);
}
