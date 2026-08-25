import { CONFIG } from './config.js';
import { connectBinance } from './exchanges/binance/websocket.js';
import { OrderBookManager } from './orderbook/manager.js';
import { ImbalanceTracker } from './orderbook/imbalance.js';
import { processTradeForCvd, getCvdState, resetCvd } from './flow/cvd.js';
import { classifyTrade } from './flow/classification.js';
import { pollOi, getOiState } from './derivatives/oi.js';
import { pollFunding, getFundingState } from './derivatives/funding.js';
import { RegimeDetector } from './engine/regime.js';
import { FlowRegimeDetector } from './engine/flow-regime.js';
import { AbsorptionDetector } from './engine/absorption.js';
import { computeScore } from './features/score.js';
import { broadcast, startBroadcastServer } from './broadcast/websocket-server.js';
import { dbStorage } from './storage/sqlite.js';
import { cleanup as cleanupPersistence } from './orderbook/persistence.js';
import type { MarketSnapshot, MarketEvent, DataQuality, NormalizedTrade } from './types/index.js';

// ── Absorption backtest constants (v2 — dado real mostrou v1 desproporcional) ──
const ABSORPTION_RESOLUTION_THRESHOLD_PCT = 0.05;   // v1: 0.3% — alta demais, nenhum resolved em 10 eventos
const ABSORPTION_RESOLUTION_WINDOW_MINUTES = 5;      // v1: 30min — 300x o tempo de vida real (6-12s)

// ── Eventos do painel (whale_buy / whale_sell) ──
// Máximo de eventos mantidos por ciclo de broadcast; o array é zerado a cada broadcast.
const MAX_EVENTS_PER_CYCLE = 20;

// ── State ──
let currentPrice = 0;
let lastBroadcast = 0;
let lastSnapshotPersist = 0;
let wsStatus: DataQuality['ws'] = 'DISCONNECTED';
let oiStatus: DataQuality['oi'] = 'UNAVAILABLE';
let fundingStatus: DataQuality['funding'] = 'UNAVAILABLE';
let lastOiPoll = 0;
let lastFundingPoll = 0;
let lastRegime = 'RANGE';
let lastFlowRegime = 'NEUTRAL_FLOW';
let lastDivergence: string = 'NONE';
let lastAbsorptionState: string = 'NONE';
let absorptionTriggerPrice = 0;
let absorptionTriggerTs = 0;
let absorptionResolutionPending = false;

const orderbook = new OrderBookManager();
const imbalanceTracker = new ImbalanceTracker();
const regimeDetector = new RegimeDetector();
const flowRegimeDetector = new FlowRegimeDetector();
const absorptionDetector = new AbsorptionDetector();
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

// ── Eventos do painel: trade → classificação → events[] → snapshot → WebSocket ──
// Fonte de verdade do CVD e do fluxo de grandes players: processTradeForCvd()/getCvdState()
// (módulo flow/cvd.ts). Eventos de baleia derivam da mesma classificação usada pelo CVD.
function pushTradeEvent(trade: NormalizedTrade): void {
  const size = classifyTrade(trade);
  if (size !== 'large') return;

  const type = trade.side === 'BUY' ? 'whale_buy' : 'whale_sell';
  const direction = trade.side === 'BUY' ? 'bullish' : 'bearish';
  const magnitude = trade.price * trade.quantity;

  events.push({ type, magnitude, direction, timestamp: trade.eventTime });

  // Fase 0 item 5 — persistência do whale event (mesma classificação usada no broadcast).
  // timestamp = trade.eventTime (instante exato do trade, não o horário da persistência);
  // price = trade.price (preço no instante exato do evento — estrutural, não opcional);
  // details = dados adicionais disponíveis em formato estruturado (JSON).
  dbStorage.saveEvent({
    timestamp: trade.eventTime,
    symbol: CONFIG.symbol,
    eventType: type,
    magnitude,
    direction,
    price: trade.price,
    details: JSON.stringify({
      exchange: trade.exchange,
      quantity: trade.quantity,
      side: trade.side,
      isBuyerMaker: trade.isBuyerMaker,
    }),
  });

  // Limita o tamanho do payload por ciclo; o array é zerado após cada broadcast.
  if (events.length > MAX_EVENTS_PER_CYCLE) events.shift();
}

function handleTrade(trade: NormalizedTrade): void {
  currentPrice = trade.price;
  orderbook.setCurrentPrice(currentPrice);
  processTradeForCvd(trade);
  pushTradeEvent(trade);
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
    resetCvd();
    events.length = 0;
    lastAbsorptionState = 'NONE';
    absorptionTriggerPrice = 0;
    absorptionTriggerTs = 0;
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
  const regimeResult = regimeDetector.evaluate(currentPrice, now);
  const flowResult = flowRegimeDetector.evaluate(
    obState.imbalance,
    cvdState.whaleCvd,
    regimeResult.regime,
    regimeResult.confidence,
    now,
  );

  const resolution = flowRegimeDetector.consumeResolution();
  if (resolution) {
    console.log(`[Regime] Divergence ${resolution.eventType}: ${resolution.divergence} → ${resolution.resolvedInto} (duration: ${resolution.durationMs}ms)`);
    dbStorage.saveRegimeEvent({ timestamp: now, eventType: resolution.eventType, fromState: resolution.divergence, toState: resolution.resolvedInto, price: currentPrice, confidence: regimeResult.confidence, extra: `duration_ms:${resolution.durationMs}` });
  }

  if (regimeResult.regime !== lastRegime) {
    const msg = `[Regime] Regime changed: ${lastRegime} → ${regimeResult.regime} @ $${currentPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })} (confidence: ${regimeResult.confidence}%, volatility: ${regimeResult.volatility.toFixed(4)}%)`;
    console.log(msg);
    dbStorage.saveRegimeEvent({ timestamp: now, eventType: 'regime_change', fromState: lastRegime, toState: regimeResult.regime, price: currentPrice, confidence: regimeResult.confidence, extra: `volatility:${regimeResult.volatility.toFixed(4)}` });
    lastRegime = regimeResult.regime;
  }

  if (flowResult.flowRegime !== lastFlowRegime) {
    const msg = `[Flow] Flow regime changed: ${lastFlowRegime} → ${flowResult.flowRegime} @ $${currentPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })} (strength: ${flowResult.flowStrength.toFixed(1)})`;
    console.log(msg);
    dbStorage.saveRegimeEvent({ timestamp: now, eventType: 'flow_change', fromState: lastFlowRegime, toState: flowResult.flowRegime, price: currentPrice, confidence: regimeResult.confidence, extra: `strength:${flowResult.flowStrength.toFixed(1)}` });
    lastFlowRegime = flowResult.flowRegime;
  }

  if (flowResult.divergence !== 'NONE' && flowResult.divergence !== lastDivergence) {
    const msg = `[Regime] Divergence triggered: ${flowResult.divergence} @ $${currentPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })} (confidence: ${regimeResult.confidence}%)`;
    console.log(msg);
    dbStorage.saveRegimeEvent({ timestamp: now, eventType: 'divergence', toState: flowResult.divergence, price: currentPrice, confidence: regimeResult.confidence, extra: `flow:${flowResult.flowRegime},regime:${regimeResult.regime}` });
  }
  lastDivergence = flowResult.divergence;

  const absorptionResult = absorptionDetector.evaluate(
    obState.imbalance,
    cvdState.whaleCvd,
    now,
  );

  // ── Absorption backtest logging ──
  const absorptionStateChanged = absorptionResult.state !== lastAbsorptionState;

  // Transição NONE → BEAR/BULL: triggered
  if (absorptionStateChanged && lastAbsorptionState === 'NONE' && absorptionResult.state !== 'NONE') {
    // Se já havia uma resolução pendente, marcar como failed (interrompida por novo trigger)
    if (absorptionResolutionPending) {
      const oldDeltaPct = Math.abs((currentPrice - absorptionTriggerPrice) / absorptionTriggerPrice * 100);
      const oldElapsed = (now - absorptionTriggerTs) / 60_000;
      console.log(`[Absorption] Interrupted: pending resolution cut short by new trigger | Δ$${oldDeltaPct.toFixed(4)}% (${oldElapsed.toFixed(1)}min)`);
      dbStorage.saveRegimeEvent({
        timestamp: now,
        eventType: 'absorption_interrupted',
        fromState: lastAbsorptionState,
        toState: absorptionResult.state,
        price: currentPrice,
        confidence: regimeResult.confidence,
        extra: `trigger_price:${absorptionTriggerPrice},delta_pct:${oldDeltaPct.toFixed(4)},elapsed_min:${oldElapsed.toFixed(1)}`,
      });
    }

    absorptionTriggerPrice = currentPrice;
    absorptionTriggerTs = now;
    absorptionResolutionPending = true;
    console.log(`[Absorption] Triggered: ${absorptionResult.state} @ $${currentPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    dbStorage.saveRegimeEvent({
      timestamp: now,
      eventType: 'absorption_triggered',
      fromState: 'NONE',
      toState: absorptionResult.state,
      price: currentPrice,
      confidence: regimeResult.confidence,
      extra: `imb:${obState.imbalance.toFixed(3)},whale:${cvdState.whaleCvd.toFixed(0)}`,
    });
  }

  // Resolução pendente: checar a cada tick se preço atingiu threshold ou janela expirou
  if (absorptionResolutionPending) {
    const priceChangePct = Math.abs((currentPrice - absorptionTriggerPrice) / absorptionTriggerPrice * 100);
    const elapsedMin = (now - absorptionTriggerTs) / 60_000;

    if (priceChangePct >= ABSORPTION_RESOLUTION_THRESHOLD_PCT) {
      // Resolvido
      console.log(`[Absorption] Resolved: Δ$${priceChangePct.toFixed(4)}% (${elapsedMin.toFixed(1)}min, trigger=$${absorptionTriggerPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })})`);
      dbStorage.saveRegimeEvent({
        timestamp: now,
        eventType: 'absorption_resolved',
        fromState: lastAbsorptionState !== 'NONE' ? lastAbsorptionState : absorptionResult.state,
        toState: 'NONE',
        price: currentPrice,
        confidence: regimeResult.confidence,
        extra: `trigger_price:${absorptionTriggerPrice},delta_pct:${priceChangePct.toFixed(4)},elapsed_min:${elapsedMin.toFixed(1)}`,
      });
      absorptionResolutionPending = false;
    } else if (elapsedMin > ABSORPTION_RESOLUTION_WINDOW_MINUTES) {
      // Janela expirou
      console.log(`[Absorption] Failed (window expired): Δ$${priceChangePct.toFixed(4)}% (${elapsedMin.toFixed(1)}min)`);
      dbStorage.saveRegimeEvent({
        timestamp: now,
        eventType: 'absorption_failed',
        fromState: lastAbsorptionState !== 'NONE' ? lastAbsorptionState : 'NONE',
        toState: 'NONE',
        price: currentPrice,
        confidence: regimeResult.confidence,
        extra: `trigger_price:${absorptionTriggerPrice},delta_pct:${priceChangePct.toFixed(4)},elapsed_min:${elapsedMin.toFixed(1)},reason:window_expired`,
      });
      absorptionResolutionPending = false;
    }
  }

  lastAbsorptionState = absorptionResult.state;

  const { score, quality } = computeScore({
    regime: regimeResult.regime,
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
    regime: regimeResult.regime,
    regime_volatility: regimeResult.volatility,
    regime_confidence: regimeResult.confidence,
    flow_regime: flowResult.flowRegime,
    flow_strength: flowResult.flowStrength,
    divergence: flowResult.divergence,
    absorption_state: absorptionResult.state,
    absorption_level: absorptionResult.level,
    absorption_intensity: absorptionResult.intensity,
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
  const regimeResult = regimeDetector.evaluate(currentPrice, now);

  const { score } = computeScore({
    regime: regimeResult.regime,
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
    regime: regimeResult.regime,
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
