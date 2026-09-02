import { CONFIG } from './config.js';
import { connectBinance } from './exchanges/binance/websocket.js';
import { OrderBookManager } from './orderbook/manager.js';
import { ImbalanceTracker } from './orderbook/imbalance.js';
import { processTradeForCvd, getCvdState, resetCvd } from './flow/cvd.js';
import { classifyTrade } from './flow/classification.js';
import { isValidPrice, resolveAbsorption } from './flow/absorption-resolve.js';
import { pollOi, getOiState } from './derivatives/oi.js';
import { pollFunding, getFundingState } from './derivatives/funding.js';
import { RegimeDetector } from './engine/regime.js';
import { FlowRegimeDetector } from './engine/flow-regime.js';
import { AbsorptionDetector } from './engine/absorption.js';
import { computeScore } from './features/score.js';
import { broadcast, startBroadcastServer } from './broadcast/websocket-server.js';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { cleanup as cleanupPersistence } from './orderbook/persistence.js';
import type { MarketSnapshot, MarketEvent, DataQuality, NormalizedTrade } from './types/index.js';

// ── DB Worker (SQLite isolado da Main Thread — single writer) ──
// Apenas a Worker Thread acessa o SQLite (node:sqlite, mesma lib de antes). A Main Thread
// só envia mensagens (postMessage) e NUNCA executa SQLite/DatabaseSync.
const DB_WORKER_IS_TS = /\.ts$/.test(fileURLToPath(import.meta.url));
const dbWorker = new Worker(fileURLToPath(new URL(DB_WORKER_IS_TS ? './storage/db-worker.ts' : './storage/db-worker.js', import.meta.url)));

// Métricas do worker (FASE 1 — só performance, nada muda no comportamento analítico)
let snapshotsSent = 0;
let snapshotsSaved = 0;
let snapshotErrors = 0;
let lastSnapWriteMs = 0;
let lastSnapshotConfirmedTs = 0;

type DbStats = ReturnType<typeof import('./storage/sqlite.js').SQLiteStorage.prototype.getDbStats>;
let lastDbStats: DbStats | null = null;

dbWorker.on('message', (msg: { type?: string; timestamp?: number; writeMs?: number; stats?: DbStats; operation?: string; error?: string }) => {
  switch (msg?.type) {
    case 'snapshot_saved': { snapshotsSaved++; lastSnapWriteMs = msg.writeMs ?? 0; lastSnapshotConfirmedTs = msg.timestamp ?? 0; break; }
    case 'snapshot_error': { snapshotErrors++; break; }
    case 'db_stats': { lastDbStats = msg.stats ?? null; break; }
    case 'error': console.error(`[DB Worker] erro em ${msg.operation}: ${msg.error}`); break;
  }
});
dbWorker.on('error', (err) => console.error('[DB Worker] erro fatal:', err.message));

function dbSnapshot(snapshot: Parameters<typeof import('./storage/sqlite.js').SQLiteStorage.prototype.saveSnapshot>[0]): void {
  snapshotsSent++;
  dbWorker.postMessage({ type: 'snapshot', snapshot });
}
function dbEvent(event: Parameters<typeof import('./storage/sqlite.js').SQLiteStorage.prototype.saveEvent>[0]): void {
  dbWorker.postMessage({ type: 'event', event });
}
function dbRegimeEvent(regimeEvent: Parameters<typeof import('./storage/sqlite.js').SQLiteStorage.prototype.saveRegimeEvent>[0]): void {
  dbWorker.postMessage({ type: 'regime_event', regimeEvent });
}
function reqDbStats(): void {
  dbWorker.postMessage({ type: 'db_stats' });
}

// ── Absorption backtest constants (v2 — dado real mostrou v1 desproporcional) ──
const ABSORPTION_RESOLUTION_THRESHOLD_PCT = 0.05;   // v1: 0.3% — alta demais, nenhum resolved em 10 eventos
const ABSORPTION_RESOLUTION_WINDOW_MINUTES = 5;      // v1: 30min — 300x o tempo de vida real (6-12s)

// ── Eventos do painel (whale_buy / whale_sell) ──
// Máximo de eventos mantidos por ciclo de broadcast; o array é zerado a cada broadcast.
const MAX_EVENTS_PER_CYCLE = 20;

// ── State ──
let currentPrice = 0;
let lastBroadcast = 0;
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
// Estatísticas de acumulação do SQLite para o painel observacional (refresh a cada 5s).
// Agora obtidas via reqDbStats() → resposta do Worker (lastDbStats).
let lastDbStatsAt = 0;

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

  const stopBinance = connectBinance({
    onTrade: handleTrade,
    onDepth: handleDepth,
    onTicker: handleTicker,
    onStatusChange: handleStatusChange,
  });

  setInterval(broadcastLoop, CONFIG.intervals.broadcastMs);
  setInterval(pollDerivatives, 1000);
  scheduleSnapshot();          // snapshots self-correcting (deadline absoluto de 60s)
  startMonitoring();           // Event Loop p99 + métricas SQLite
  (globalThis as { __stopBinance?: () => void }).__stopBinance = stopBinance;

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

  // Fase 0 item 5 — persistência do whale event (fonte: @aggTrade nativo, semântica v3).
  // timestamp = trade.eventTime (instante do agregado, não da persistência);
  // price = trade.price (preço do agregado nativo);
  // tradeId = id `a` do aggTrade (dedupe via índice único); f/l e nº de execuções nos details.
  dbEvent({
    timestamp: trade.eventTime,
    symbol: CONFIG.symbol,
    eventType: type,
    magnitude,
    direction,
    price: trade.price,
    tradeId: trade.id,
    details: JSON.stringify({
      exchange: trade.exchange,
      quantity: trade.quantity,
      side: trade.side,
      isBuyerMaker: trade.isBuyerMaker,
      ...(trade.executions ? { executions: trade.executions } : {}),
      ...(trade.firstId ? { firstId: trade.firstId } : {}),
      ...(trade.lastId ? { lastId: trade.lastId } : {}),
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
    // Absorption — CORREÇÃO CRÍTICA (disconnect): invalidar explicitamente qualquer evento
    // pendente em vez de deixar pending=true com trigger zerado (que produzia Δ$Infinity%
    // e duração absurda após reconnect). Nunca resolver com dados inválidos.
    if (absorptionResolutionPending) {
      console.log('[Absorption] Interrupted: WS disconnect — state invalidated safely (ABSORPTION_INTERRUPTED_WS_DISCONNECT)');
      if (isValidPrice(currentPrice)) {
        dbRegimeEvent({
          timestamp: Date.now(),
          eventType: 'absorption_interrupted',
          fromState: lastAbsorptionState !== 'NONE' ? lastAbsorptionState : 'NONE',
          toState: 'NONE',
          price: currentPrice,
          confidence: 0,
          extra: 'reason:ws_disconnect',
        });
      }
    }
    absorptionResolutionPending = false;
    absorptionTriggerPrice = 0;
    absorptionTriggerTs = 0;
    lastAbsorptionState = 'NONE';
    absorptionDetector.reset(); // reinicia o detector — após reconnect só reativa com dados válidos
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
    dbRegimeEvent({ timestamp: now, eventType: resolution.eventType, fromState: resolution.divergence, toState: resolution.resolvedInto, price: currentPrice, confidence: regimeResult.confidence, extra: `duration_ms:${resolution.durationMs}` });
  }

  if (regimeResult.regime !== lastRegime) {
    const msg = `[Regime] Regime changed: ${lastRegime} → ${regimeResult.regime} @ $${currentPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })} (confidence: ${regimeResult.confidence}%, volatility: ${regimeResult.volatility.toFixed(4)}%)`;
    console.log(msg);
    dbRegimeEvent({ timestamp: now, eventType: 'regime_change', fromState: lastRegime, toState: regimeResult.regime, price: currentPrice, confidence: regimeResult.confidence, extra: `volatility:${regimeResult.volatility.toFixed(4)}` });
    lastRegime = regimeResult.regime;
  }

  if (flowResult.flowRegime !== lastFlowRegime) {
    const msg = `[Flow] Flow regime changed: ${lastFlowRegime} → ${flowResult.flowRegime} @ $${currentPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })} (strength: ${flowResult.flowStrength.toFixed(1)})`;
    console.log(msg);
    dbRegimeEvent({ timestamp: now, eventType: 'flow_change', fromState: lastFlowRegime, toState: flowResult.flowRegime, price: currentPrice, confidence: regimeResult.confidence, extra: `strength:${flowResult.flowStrength.toFixed(1)}` });
    lastFlowRegime = flowResult.flowRegime;
  }

  if (flowResult.divergence !== 'NONE' && flowResult.divergence !== lastDivergence) {
    const msg = `[Regime] Divergence triggered: ${flowResult.divergence} @ $${currentPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })} (confidence: ${regimeResult.confidence}%)`;
    console.log(msg);
    dbRegimeEvent({ timestamp: now, eventType: 'divergence', toState: flowResult.divergence, price: currentPrice, confidence: regimeResult.confidence, extra: `flow:${flowResult.flowRegime},regime:${regimeResult.regime}` });
  }
  lastDivergence = flowResult.divergence;

  const absorptionResult = absorptionDetector.evaluate(
    obState.imbalance,
    cvdState.whaleCvd,
    now,
  );

  // ── Absorption backtest logging ──
  const absorptionStateChanged = absorptionResult.state !== lastAbsorptionState;

  // Transição NONE → BEAR/BULL: triggered (só com preço válido — nunca criar resolução com preço inválido)
  if (absorptionStateChanged && lastAbsorptionState === 'NONE' && absorptionResult.state !== 'NONE' && isValidPrice(currentPrice)) {
    // Se já havia uma resolução pendente, marcar como interrompida por novo trigger
    if (absorptionResolutionPending) {
      const oldDeltaPct = (isValidPrice(currentPrice) && isValidPrice(absorptionTriggerPrice))
        ? Math.abs((currentPrice - absorptionTriggerPrice) / absorptionTriggerPrice * 100)
        : NaN;
      const oldElapsed = Number.isFinite(absorptionTriggerTs) && absorptionTriggerTs > 0
        ? (now - absorptionTriggerTs) / 60_000
        : NaN;
      console.log(`[Absorption] Interrupted: pending resolution cut short by new trigger | Δ$${Number.isFinite(oldDeltaPct) ? oldDeltaPct.toFixed(4) : 'n/a'}% (${Number.isFinite(oldElapsed) ? oldElapsed.toFixed(1) : 'n/a'}min)`);
      dbRegimeEvent({
        timestamp: now,
        eventType: 'absorption_interrupted',
        fromState: lastAbsorptionState,
        toState: absorptionResult.state,
        price: currentPrice,
        confidence: regimeResult.confidence,
        extra: `trigger_price:${absorptionTriggerPrice},delta_pct:${Number.isFinite(oldDeltaPct) ? oldDeltaPct.toFixed(4) : 'n/a'},elapsed_min:${Number.isFinite(oldElapsed) ? oldElapsed.toFixed(1) : 'n/a'}`,
      });
    }

    absorptionTriggerPrice = currentPrice;
    absorptionTriggerTs = now;
    absorptionResolutionPending = true;
    console.log(`[Absorption] Triggered: ${absorptionResult.state} @ $${currentPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    dbRegimeEvent({
      timestamp: now,
      eventType: 'absorption_triggered',
      fromState: 'NONE',
      toState: absorptionResult.state,
      price: currentPrice,
      confidence: regimeResult.confidence,
      extra: `imb:${obState.imbalance.toFixed(3)},whale:${cvdState.whaleCvd.toFixed(0)}`,
    });
  }

  // Resolução pendente: lógica pura com guards (nunca Infinity/NaN/trigger=0)
  if (absorptionResolutionPending) {
    const r = resolveAbsorption({
      currentPrice,
      triggerPrice: absorptionTriggerPrice,
      triggerTs: absorptionTriggerTs,
      now,
      thresholdPct: ABSORPTION_RESOLUTION_THRESHOLD_PCT,
      windowMinutes: ABSORPTION_RESOLUTION_WINDOW_MINUTES,
    });

    if (r.action === 'invalid') {
      // Estado inválido (ex.: trigger zerado por disconnect) — limpar com segurança.
      console.log('[Absorption] Invalid state detected — clearing pending resolution safely (no Infinity / trigger=0)');
      absorptionResolutionPending = false;
      absorptionTriggerPrice = 0;
      absorptionTriggerTs = 0;
    } else if (r.action === 'resolved') {
      // Resolvido
      console.log(`[Absorption] Resolved: Δ$${r.priceChangePct.toFixed(4)}% (${r.elapsedMin.toFixed(1)}min, trigger=$${absorptionTriggerPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })})`);
      dbRegimeEvent({
        timestamp: now,
        eventType: 'absorption_resolved',
        fromState: lastAbsorptionState !== 'NONE' ? lastAbsorptionState : absorptionResult.state,
        toState: 'NONE',
        price: currentPrice,
        confidence: regimeResult.confidence,
        extra: `trigger_price:${absorptionTriggerPrice},delta_pct:${r.priceChangePct.toFixed(4)},elapsed_min:${r.elapsedMin.toFixed(1)}`,
      });
      absorptionResolutionPending = false;
    } else if (r.action === 'failed') {
      // Janela expirou
      console.log(`[Absorption] Failed (window expired): Δ$${r.priceChangePct.toFixed(4)}% (${r.elapsedMin.toFixed(1)}min)`);
      dbRegimeEvent({
        timestamp: now,
        eventType: 'absorption_failed',
        fromState: lastAbsorptionState !== 'NONE' ? lastAbsorptionState : 'NONE',
        toState: 'NONE',
        price: currentPrice,
        confidence: regimeResult.confidence,
        extra: `trigger_price:${absorptionTriggerPrice},delta_pct:${r.priceChangePct.toFixed(4)},elapsed_min:${r.elapsedMin.toFixed(1)},reason:window_expired`,
      });
      absorptionResolutionPending = false;
    }
    // action === 'pending' → aguarda (nada a fazer)
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

  // Painel observacional (Fase 1): estatísticas de acumulação do SQLite, atualizadas
  // no máximo a cada 5s — via Worker (token de leitura é delegado; nada pesado na Main Thread).
  if (now - lastDbStatsAt >= 5_000) {
    lastDbStatsAt = now;
    reqDbStats();
  }

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
    dbStats: lastDbStats ?? undefined,
    quality: {
      ws: wsStatus,
      oi: oiStatus,
      funding: fundingStatus,
    },
  };

  broadcast(snapshot);
  events.length = 0;
}

// ── Snapshots: scheduler self-correcting (60s, deadline absoluto) ──
// Substitui o setInterval antigo: sem drift acumulativo; detecta ciclos perdidos; não dispara
// snapshots atrasados em cascata se o Event Loop ficar bloqueado.
const SNAPSHOT_INTERVAL_MS = CONFIG.intervals.snapshotPersistMs; // 60_000
let nextSnapshotDeadline = Date.now() + SNAPSHOT_INTERVAL_MS;
let snapshotTimer: ReturnType<typeof setTimeout> | null = null;

function buildAndSendSnapshot(): void {
  const now = Date.now();
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

  // SQLite agora é no Worker — só postMessage.
  dbSnapshot({
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

  console.log(`[SQLite] Snapshot enviado ao DB worker (${new Date(now).toISOString()})`);
}

function scheduleSnapshot(): void {
  if (snapshotTimer) clearTimeout(snapshotTimer);
  const delay = Math.max(0, nextSnapshotDeadline - Date.now());
  snapshotTimer = setTimeout(runSnapshot, delay);
}

function runSnapshot(): void {
  const now = Date.now();
  const drift = now - nextSnapshotDeadline;
  // Avançar ao próximo deadline válido; se pulou >= 1 ciclo completo, registrar o gap.
  let missedCycles = 0;
  while (nextSnapshotDeadline <= now) { nextSnapshotDeadline += SNAPSHOT_INTERVAL_MS; missedCycles++; }
  if (missedCycles > 1) {
    console.error(`[SNAPSHOT GAP] drift=${drift}ms missed=${missedCycles - 1}`);
  }
  buildAndSendSnapshot();
  scheduleSnapshot();
}

// ── Monitoramento do Event Loop + métricas do Worker (Fase 1 — só observabilidade) ──
const eventLoopLag = monitorEventLoopDelay({ resolution: 20 });

function startMonitoring(): void {
  eventLoopLag.enable();
  setInterval(() => {
    const backlog = snapshotsSent - snapshotsSaved;
    console.log(
      `[EventLoop] p99=${(eventLoopLag.percentile(99) / 1e6).toFixed(1)}ms ` +
      `sent=${snapshotsSent} saved=${snapshotsSaved} errors=${snapshotErrors} ` +
      `backlog=${backlog} lastWriteMs=${lastSnapWriteMs.toFixed(1)} ` +
      `lastConfirmed=${lastSnapshotConfirmedTs ? new Date(lastSnapshotConfirmedTs).toISOString() : '—'}`,
    );
    if (backlog > 2) {
      console.error(`[ALERTA CRÍTICO] Backlog de snapshots no Worker: ${backlog}`);
    }
    eventLoopLag.reset();
  }, 60_000).unref();
}

// ── Graceful shutdown (drenar Worker antes de encerrar) ──
let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[Daemon] Shutting down (${signal})...`);
  if (snapshotTimer) clearTimeout(snapshotTimer);
  try {
    // parar ingestão (WebSocket)
    (globalThis as { __stopBinance?: () => void }).__stopBinance?.();
  } catch { /* ignore */ }
  try {
    // FIFO: o Worker processa as mensagens pendentes (incl. snapshot) antes de 'close'.
    dbWorker.once('message', (m) => { if (m?.type === 'closed') process.exit(0); });
    dbWorker.postMessage({ type: 'close' });
    // fallback: encerra após 2s caso o Worker não confirme (não matar abruptamente se possível)
    setTimeout(() => { try { dbWorker.terminate(); } catch {} process.exit(0); }, 2000).unref();
  } catch {
    process.exit(0);
  }
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

main();
