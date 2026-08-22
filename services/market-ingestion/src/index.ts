import { CONFIG } from './config.js';
import { connectBinance } from './exchanges/binance/websocket.js';
import { OrderBookManager } from './orderbook/manager.js';
import { ImbalanceTracker } from './orderbook/imbalance.js';
import { TradeAccumulator } from './flow/trades.js';
import { processTradeForCvd, getCvdState, resetCvd } from './flow/cvd.js';
import { pollOi, getOiState } from './derivatives/oi.js';
import { pollFunding, getFundingState } from './derivatives/funding.js';
import { updateRegime } from './features/regime.js';
import { computeScore } from './features/score.js';
import { broadcast, startBroadcastServer } from './broadcast/websocket-server.js';
import { dbStorage } from './storage/sqlite.js';
import { cleanup as cleanupPersistence } from './orderbook/persistence.js';
import type { MarketSnapshot, MarketEvent, DataQuality } from './types/index.js';
import type { NormalizedTrade } from './types/index.js';

// ── State ──
let currentPrice = 0;
let lastBroadcast = 0;
let lastSnapshotPersist = 0;
let wsStatus: DataQuality['ws'] = 'DISCONNECTED';
let oiStatus: DataQuality['oi'] = 'UNAVAILABLE';
let fundingStatus: DataQuality['funding'] = 'UNAVAILABLE';
let lastOiPoll = 0;
let lastFundingPoll = 0;

const orderbook = new OrderBookManager();
const imbalanceTracker = new ImbalanceTracker();
const tradeAccumulator = new TradeAccumulator();
const events: MarketEvent[] = [];

// ── Init ──
function main() {
  console.log('[Daemon] Starting market ingestion daemon...');
  console.log(`[Daemon] Symbol: ${CONFIG.symbol}`);
  console.log(`[Daemon] Broadcast port: ${CONFIG.wsPort}`);
  console.log(`[Daemon] Broadcast interval: ${CONFIG.intervals.broadcastMs}ms`);

  startBroadcastServer();

  connectBinance({
    onTrade: handleTrade,
    onDepth: handleDepth,
    onTicker: handleTicker,
    onStatusChange: handleStatusChange,
  });

  setInterval(broadcastLoop, CONFIG.intervals.broadcastMs);
  setInterval(pollDerivatives, 1000);
  setInterval(persistSnapshot, CONFIG.intervals.snapshotPersistMs);

  setInterval(() => {
    cleanupPersistence(300_000, Date.now());
  }, 300_000);

  console.log('[Daemon] Ready.');
}

function handleTrade(trade: NormalizedTrade): void {
  currentPrice = trade.price;
  orderbook.setCurrentPrice(currentPrice);
  processTradeForCvd(trade);
  tradeAccumulator.addTrade(trade);
}

function handleDepth(depth: { lastUpdateId: number; timestamp: number; bids: [number, number][]; asks: [number, number][] }): void {
  orderbook.onSnapshot({ ...depth, exchange: 'binance' as const });

  const state = orderbook.getState();
  if (state.valid) {
    imbalanceTracker.update(state);
  }
}

function handleTicker(price: number): void {
  currentPrice = price;
  orderbook.setCurrentPrice(price);
}

function handleStatusChange(status: 'connecting' | 'live' | 'reconnecting' | 'disconnected'): void {
  wsStatus = status === 'live' ? 'LIVE' : status === 'disconnected' ? 'DISCONNECTED' : 'STALE';

  if (status === 'disconnected') {
    orderbook.reset();
    imbalanceTracker.clear();
    tradeAccumulator.clear();
    resetCvd();
    events.length = 0;
  }
}

async function pollDerivatives(): Promise<void> {
  const now = Date.now();

  if (now - lastOiPoll >= CONFIG.intervals.oiPollMs) {
    lastOiPoll = now;
    await pollOi();
    oiStatus = 'LIVE';
  }

  if (now - lastFundingPoll >= CONFIG.intervals.fundingPollMs) {
    lastFundingPoll = now;
    await pollFunding();
    fundingStatus = 'LIVE';
  }
}

function broadcastLoop(): void {
  const now = Date.now();
  if (now - lastBroadcast < CONFIG.intervals.broadcastMs) return;
  lastBroadcast = now;

  const obState = orderbook.getState();
  const cvdState = getCvdState();
  const oiState = getOiState();
  const fundingState = getFundingState();
  const regime = updateRegime(currentPrice);

  const { score, quality } = computeScore({
    regime,
    imbalance: obState.imbalance,
    cvdDelta: cvdState.delta,
    oiChange: oiState.oiChange,
    fundingRate: fundingState.rate,
    priceChange: 0,
  });

  const snapshot: MarketSnapshot = {
    ts: now,
    p: currentPrice,
    cvd: cvdState.totalCvd,
    cvd_whale: cvdState.whaleCvd,
    imb: obState.imbalance,
    oi: oiState.oi,
    oi_delta: oiState.oiChange,
    funding: fundingState.rate,
    funding_class: fundingState.classification,
    regime,
    score,
    score_quality: quality,
    events: [...events],
    quality: {
      ws: wsStatus,
      oi: oiStatus,
      funding: fundingStatus,
    },
  };

  broadcast(snapshot);
  events.length = 0;
}

function persistSnapshot(): void {
  const now = Date.now();
  if (now - lastSnapshotPersist < CONFIG.intervals.snapshotPersistMs) return;
  lastSnapshotPersist = now;

  const obState = orderbook.getState();
  const cvdState = getCvdState();
  const oiState = getOiState();
  const fundingState = getFundingState();
  const regime = updateRegime(currentPrice);

  const { score } = computeScore({
    regime,
    imbalance: obState.imbalance,
    cvdDelta: cvdState.delta,
    oiChange: oiState.oiChange,
    fundingRate: fundingState.rate,
    priceChange: 0,
  });

  dbStorage.saveSnapshot({
    timestamp: now,
    symbol: CONFIG.symbol,
    price: currentPrice,
    oi: oiState.oi,
    oiChange: oiState.oiChange,
    fundingRate: fundingState.rate,
    cvd: cvdState.totalCvd,
    cvdLarge: cvdState.whaleCvd,
    bookImbalance: obState.imbalance,
    score,
    regime,
  });

  console.log(`[SQLite] Snapshot persisted at ${new Date(now).toISOString()}`);
}

// ── Graceful shutdown ──
process.on('SIGINT', () => {
  console.log('[Daemon] Shutting down...');
  dbStorage.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('[Daemon] Shutting down...');
  dbStorage.close();
  process.exit(0);
});

main();
