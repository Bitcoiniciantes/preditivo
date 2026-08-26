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
let marketWs: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let marketReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let retries = 0;
let marketRetries = 0;
let handler: BinanceStreamHandler;

// Duas conexões (verificado 26/08, auditoria §20/§21):
//   - base `/stream`: depth20 + bookTicker (NÃO entregam em /market);
//   - `/market/ws`: @aggTrade (só entregue em /market).
export function connectBinance(h: BinanceStreamHandler): () => void {
  handler = h;
  doConnect();
  doConnectMarket();

  return () => {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (marketReconnectTimer) clearTimeout(marketReconnectTimer);
    if (ws) { ws.removeAllListeners(); ws.close(); }
    if (marketWs) { marketWs.removeAllListeners(); marketWs.close(); }
    ws = null;
    marketWs = null;
  };
}

function doConnect() {
  const streams = [
    CONFIG.streams.depth,
    CONFIG.streams.bookTicker,
  ].join('/');

  const url = `${CONFIG.wsUrl}?streams=${streams}`;

  handler.onStatusChange(retries === 0 ? 'connecting' : 'reconnecting');

  ws = new WebSocket(url);

  ws.on('open', () => {
    retries = 0;
    handler.onStatusChange('live');
    console.log('[Binance WS] Base conectado (depth + bookTicker)');
  });

  ws.on('message', (raw: Buffer) => {
    try {
      const msg = JSON.parse(raw.toString());
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
    console.error('[Binance WS] Base error:', err.message);
    ws?.close();
  });
}

// Conexão Market: @aggTrade nativo (só entregue em /market/ws). Não aciona onStatusChange
// (o status do painel reflete a conexão base); se cair, só os whale events param até reconectar.
function doConnectMarket() {
  const url = `${CONFIG.marketWsUrl}/${CONFIG.streams.aggTrade}`;
  console.log(`[Binance WS] Market conectando: ${url}`);

  marketWs = new WebSocket(url);

  marketWs.on('open', () => {
    marketRetries = 0;
    console.log('[Binance WS] Market (aggTrade) conectado');
  });

  marketWs.on('message', (raw: Buffer) => {
    try {
      const msg = JSON.parse(raw.toString());
      handleEvent((msg.data as Record<string, unknown>) || msg);
    } catch {
      // silently drop malformed messages
    }
  });

  marketWs.on('close', () => {
    console.warn('[Binance WS] Market (aggTrade) desconectado — whale events pausados até reconectar');
    scheduleReconnectMarket();
  });

  marketWs.on('error', (err: Error) => {
    console.error('[Binance WS] Market error:', err.message);
    marketWs?.close();
  });
}

function handleEvent(msg: Record<string, unknown>) {
  const event = msg.e as string | undefined;
  if (!event) return;

  switch (event) {
    case 'aggTrade':
    case 'trade': {
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
  console.log(`[Binance WS] Reconnecting base in ${delay}ms (attempt ${retries})`);
  reconnectTimer = setTimeout(doConnect, delay);
}

function scheduleReconnectMarket() {
  const delay = backoffDelay(marketRetries, CONFIG.backoff);
  marketRetries++;
  console.log(`[Binance WS] Reconnecting market in ${delay}ms (attempt ${marketRetries})`);
  marketReconnectTimer = setTimeout(doConnectMarket, delay);
}
